import { strict as assert } from "assert";
import {
  type AutoSyncPolicy,
  CompletionAwareAutoSyncScheduler,
  type SyncOutcome,
  type SyncSettlementError,
  beginSyncInvocation,
  createAutoSyncPolicy,
  normalizeAutoSyncSettings,
  runSyncWithSettlement,
  settleSkippedSync,
} from "../src/autoSyncScheduler";

const MINUTE_MS = 60_000;

type TimerEntry = {
  readonly dueAtMs: number;
  readonly callback: () => void;
};

class FakeTime {
  nowMs = 0;
  private nextId = 1;
  readonly timers = new Map<number, TimerEntry>();

  readonly now = () => this.nowMs;
  readonly setTimer = (callback: () => void, delayMs: number): number => {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { dueAtMs: this.nowMs + delayMs, callback });
    return id;
  };
  readonly clearTimer = (id: number): void => {
    this.timers.delete(id);
  };

  async advanceTo(targetMs: number): Promise<void> {
    this.nowMs = targetMs;
    const due = [...this.timers.entries()].filter(
      ([, timer]) => timer.dueAtMs <= targetMs
    );
    for (const [id, timer] of due) {
      this.timers.delete(id);
      timer.callback();
    }
    await Promise.resolve();
    await Promise.resolve();
  }
}

const policy = (baseIntervalMs = 10 * MINUTE_MS): AutoSyncPolicy => ({
  baseIntervalMs,
  night: {
    enabled: false,
    startMinute: 23 * 60,
    endMinute: 7 * 60,
    intervalMs: 2 * 60 * MINUTE_MS,
  },
  inactivity: {
    enabled: false,
    thresholdMs: 30 * MINUTE_MS,
    intervalMs: 60 * MINUTE_MS,
  },
  failureBackoffEnabled: true,
});

const createHarness = (
  time: FakeTime,
  getPolicy: () => AutoSyncPolicy,
  runAutoSync: () => Promise<SyncOutcome>,
  isBusy: () => boolean = () => false
) =>
  new CompletionAwareAutoSyncScheduler({
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    getPolicy,
    isBusy,
    runAutoSync,
  });

describe("Auto sync scheduler lifecycle", () => {
  it("keeps the active run log intact when a second invocation is busy", () => {
    // Given
    let busy = false;
    const activeLog: string[] = [];
    const begin = (trigger: "auto" | "manual") =>
      beginSyncInvocation({
        trigger,
        isBusy: () => busy,
        recordInvocation: () => undefined,
        start: () => {
          busy = true;
          activeLog.length = 0;
          activeLog.push(`started:${trigger}`);
        },
      });
    begin("auto");
    activeLog.push("progress:first");
    // When
    const second = begin("manual");
    activeLog.push("completed:first");
    // Then
    assert.equal(second, "skipped-busy");
    assert.deepEqual(activeLog, [
      "started:auto",
      "progress:first",
      "completed:first",
    ]);
  });

  it("resets manual backoff before a busy return without reanchoring", () => {
    // Given
    const time = new FakeTime();
    const scheduler = createHarness(
      time,
      () => policy(),
      async () => "failure"
    );
    scheduler.start();
    scheduler.recordCompletion({
      trigger: "auto",
      outcome: "failure",
      completedAtMs: 5 * MINUTE_MS,
    });
    const before = scheduler.snapshot().state;
    let started = false;
    // When
    const admission = beginSyncInvocation({
      trigger: "manual",
      isBusy: () => true,
      recordInvocation: (trigger) => scheduler.recordInvocation(trigger),
      start: () => {
        started = true;
      },
    });
    const after = scheduler.snapshot().state;
    // Then
    assert.equal(admission, "skipped-busy");
    assert.equal(started, false);
    assert.equal(before.failureCount, 1);
    assert.equal(after.failureCount, 0);
    assert.equal(after.completionAnchorMs, before.completionAnchorMs);
  });

  it("keeps an already started scheduler anchored when start repeats", () => {
    // Given
    const time = new FakeTime();
    const scheduler = createHarness(
      time,
      () => policy(),
      async () => "success"
    );
    scheduler.start();
    time.nowMs = 2 * MINUTE_MS;
    // When
    scheduler.start();
    // Then
    assert.deepEqual(
      [...time.timers.values()].map((timer) => timer.dueAtMs),
      [10 * MINUTE_MS]
    );
  });

  it("keeps one timer across positive reschedules and clears disabled state", () => {
    // Given
    const time = new FakeTime();
    let currentPolicy = policy();
    const scheduler = createHarness(
      time,
      () => currentPolicy,
      async () => "success"
    );
    // When
    scheduler.start();
    currentPolicy = policy(5 * MINUTE_MS);
    scheduler.reschedule();
    scheduler.reschedule();
    const enabled = scheduler.snapshot();
    currentPolicy = policy(0);
    scheduler.reschedule();
    const disabled = scheduler.snapshot();
    // Then
    assert.equal(enabled.armedTimerCount, 1);
    assert.equal(time.timers.size, 0);
    assert.equal(disabled.armedTimerCount, 0);
    assert.equal(disabled.state.failureCount, 0);
  });

  it("cancels on stop during a wait and resumes with one fresh timer", () => {
    // Given
    const time = new FakeTime();
    const scheduler = createHarness(
      time,
      () => policy(),
      async () => "success"
    );
    scheduler.start();
    // When
    scheduler.stop();
    scheduler.start();
    scheduler.stop();
    scheduler.start();
    // Then
    assert.equal(time.timers.size, 1);
    assert.equal(scheduler.snapshot().armedTimerCount, 1);
  });

  it("does not let an old awaited sync rearm after a generation change", async () => {
    // Given
    const time = new FakeTime();
    let finish: ((outcome: SyncOutcome) => void) | undefined;
    const pending = new Promise<SyncOutcome>((resolve) => {
      finish = resolve;
    });
    const scheduler = createHarness(
      time,
      () => policy(),
      async () => pending
    );
    scheduler.start();
    await time.advanceTo(10 * MINUTE_MS);
    // When
    scheduler.reschedule();
    scheduler.reschedule();
    finish?.("success");
    await Promise.resolve();
    await Promise.resolve();
    // Then
    assert.equal(time.timers.size, 1);
    assert.equal(scheduler.snapshot().state.completionAnchorMs, 0);
  });

  it("does not rearm after stop during an awaited sync", async () => {
    // Given
    const time = new FakeTime();
    let finish: ((outcome: SyncOutcome) => void) | undefined;
    const pending = new Promise<SyncOutcome>((resolve) => {
      finish = resolve;
    });
    const scheduler = createHarness(
      time,
      () => policy(),
      async () => pending
    );
    scheduler.start();
    await time.advanceTo(10 * MINUTE_MS);
    // When
    scheduler.stop();
    finish?.("success");
    await Promise.resolve();
    await Promise.resolve();
    // Then
    assert.equal(time.timers.size, 0);
    assert.equal(scheduler.snapshot().armedTimerCount, 0);
  });

  it("rearms from completion after a long-running sync", async () => {
    // Given
    const time = new FakeTime();
    let finish: ((outcome: SyncOutcome) => void) | undefined;
    const pending = new Promise<SyncOutcome>((resolve) => {
      finish = resolve;
    });
    const scheduler = createHarness(
      time,
      () => policy(),
      async () => pending
    );
    scheduler.start();
    await time.advanceTo(10 * MINUTE_MS);
    // When
    time.nowMs = 25 * MINUTE_MS;
    finish?.("success");
    await Promise.resolve();
    await Promise.resolve();
    // Then
    assert.equal(scheduler.snapshot().state.completionAnchorMs, 25 * MINUTE_MS);
    assert.deepEqual(
      [...time.timers.values()].map((timer) => timer.dueAtMs),
      [35 * MINUTE_MS]
    );
  });

  it("reanchors after an external non-busy completion", () => {
    // Given
    const time = new FakeTime();
    const scheduler = createHarness(
      time,
      () => policy(),
      async () => "success"
    );
    scheduler.start();
    time.nowMs = 4 * MINUTE_MS;
    // When
    scheduler.recordCompletion({
      trigger: "manual",
      outcome: "success",
      completedAtMs: time.nowMs,
    });
    // Then
    assert.equal(scheduler.snapshot().state.completionAnchorMs, 4 * MINUTE_MS);
    assert.deepEqual(
      [...time.timers.values()].map((timer) => timer.dueAtMs),
      [14 * MINUTE_MS]
    );
  });

  it("rearms in finally and backs off when sync cleanup rejects", async () => {
    // Given
    const time = new FakeTime();
    const scheduler = createHarness(
      time,
      () => policy(),
      async () => {
        throw new Error("log persistence failed");
      }
    );
    scheduler.start();
    // When
    await time.advanceTo(10 * MINUTE_MS);
    // Then
    assert.equal(scheduler.snapshot().state.failureCount, 1);
    assert.deepEqual(
      [...time.timers.values()].map((timer) => timer.dueAtMs),
      [30 * MINUTE_MS]
    );
  });

  it("clears failure backoff and the timer when the base is disabled", async () => {
    // Given
    const time = new FakeTime();
    let currentPolicy = policy();
    const scheduler = createHarness(
      time,
      () => currentPolicy,
      async () => "failure"
    );
    scheduler.start();
    await time.advanceTo(10 * MINUTE_MS);
    assert.equal(scheduler.snapshot().state.failureCount, 1);
    // When
    currentPolicy = policy(0);
    scheduler.reschedule();
    // Then
    assert.equal(scheduler.snapshot().state.failureCount, 0);
    assert.equal(scheduler.snapshot().armedTimerCount, 0);
    assert.equal(time.timers.size, 0);
  });

  it("runs once after sleep catch-up and leaves one completion-relative timer", async () => {
    // Given
    const time = new FakeTime();
    let runs = 0;
    const scheduler = createHarness(
      time,
      () => policy(),
      async () => {
        runs += 1;
        return "success";
      }
    );
    scheduler.start();
    // When
    await time.advanceTo(60 * MINUTE_MS);
    // Then
    assert.equal(runs, 1);
    assert.equal(time.timers.size, 1);
    assert.equal(scheduler.snapshot().state.completionAnchorMs, 60 * MINUTE_MS);
  });

  it("treats a busy wake as neutral and does not invoke sync", async () => {
    // Given
    const time = new FakeTime();
    let runs = 0;
    let busy = true;
    const scheduler = createHarness(
      time,
      () => policy(),
      async () => {
        runs += 1;
        return "success";
      },
      () => busy
    );
    scheduler.start();
    // When
    await time.advanceTo(10 * MINUTE_MS);
    const busyState = scheduler.snapshot().state;
    busy = false;
    await time.advanceTo(20 * MINUTE_MS);
    // Then
    assert.equal(runs, 1);
    assert.equal(busyState.failureCount, 0);
    assert.equal(busyState.completionAnchorMs, 0);
    assert.equal(time.timers.size, 1);
  });

  it("preserves mobile base cadence while ignoring adaptive settings", () => {
    // Given
    const normalized = normalizeAutoSyncSettings({
      autoRunEveryMilliseconds: 10 * MINUTE_MS,
      autoRunNightEnabled: true,
      autoRunInactivityEnabled: true,
    });
    // When
    const desktop = createAutoSyncPolicy(normalized, true);
    const mobile = createAutoSyncPolicy(normalized, false);
    // Then
    assert.equal(mobile.baseIntervalMs, 10 * MINUTE_MS);
    assert.equal(mobile.night.enabled, false);
    assert.equal(mobile.inactivity.enabled, false);
    assert.equal(desktop.night.enabled, true);
    assert.equal(desktop.inactivity.enabled, true);
  });

  it("settles every cleanup step and returns failure when persistence rejects", async () => {
    // Given
    const calls: string[] = [];
    const reported: SyncSettlementError[] = [];
    // When
    const outcome = await runSyncWithSettlement({
      runSync: async () => true,
      settlementSteps: () => [
        {
          label: "persist log",
          run: async () => {
            calls.push("persist");
            throw new Error("database unavailable");
          },
        },
        { label: "close resources", run: () => void calls.push("close") },
        { label: "clear profiler", run: () => void calls.push("profiler") },
        { label: "SYNC_DONE", run: () => void calls.push("event") },
        { label: "clear busy", run: () => void calls.push("not-busy") },
      ],
      reportError: (error) => reported.push(error),
    });
    // Then
    assert.equal(outcome, "failure");
    assert.deepEqual(calls, [
      "persist",
      "close",
      "profiler",
      "event",
      "not-busy",
    ]);
    assert.equal(reported.length, 1);
    assert.equal(reported[0].failures.length, 1);
  });

  it("settles cleanup and returns failure when the syncer end callback rejects", async () => {
    // Given
    const calls: string[] = [];
    let settledSuccess = true;
    // When
    const outcome = await runSyncWithSettlement({
      runSync: async () => {
        throw new Error("status end callback rejected");
      },
      settlementSteps: (successful) => {
        settledSuccess = successful;
        return [
          { label: "persist log", run: () => void calls.push("persist") },
          { label: "close resources", run: () => void calls.push("close") },
          { label: "clear profiler", run: () => void calls.push("profiler") },
          { label: "SYNC_DONE", run: () => void calls.push("event") },
          { label: "clear busy", run: () => void calls.push("not-busy") },
        ];
      },
      reportError: () => undefined,
    });
    // Then
    assert.equal(outcome, "failure");
    assert.equal(settledSuccess, false);
    assert.deepEqual(calls, [
      "persist",
      "close",
      "profiler",
      "event",
      "not-busy",
    ]);
  });

  it("returns skipped-busy after attempting every skip cleanup step", async () => {
    // Given
    const calls: string[] = [];
    const reported: SyncSettlementError[] = [];
    // When
    const outcome = await settleSkippedSync(
      [
        {
          label: "persist skip log",
          run: async () => {
            calls.push("persist");
            throw new Error("database unavailable");
          },
        },
        {
          label: "close unused resources",
          run: () => void calls.push("close"),
        },
        {
          label: "clear unused profiler",
          run: () => void calls.push("profiler"),
        },
      ],
      (error) => reported.push(error)
    );
    // Then
    assert.equal(outcome, "skipped-busy");
    assert.deepEqual(calls, ["persist", "close", "profiler"]);
    assert.equal(reported.length, 1);
  });
});

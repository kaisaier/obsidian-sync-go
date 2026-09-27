import { strict as assert } from "assert";
import {
  type AutoSyncPolicy,
  CompletionAwareAutoSyncScheduler,
  applyNormalizedSettingsReplacement,
  getEffectiveIntervalMs,
  installAdaptiveActivityListeners,
} from "../src/autoSyncScheduler";
import {
  type AutoRunDropdown,
  buildAutoSyncSettingsControlModel,
  configureAutoRunDropdown,
} from "../src/autoSyncSettingsControls";

const MINUTE_MS = 60_000;

const policy = (): AutoSyncPolicy => ({
  baseIntervalMs: 10 * MINUTE_MS,
  night: {
    enabled: false,
    startMinute: 23 * 60,
    endMinute: 7 * 60,
    intervalMs: 2 * 60 * MINUTE_MS,
  },
  inactivity: {
    enabled: true,
    thresholdMs: 30 * MINUTE_MS,
    intervalMs: 60 * MINUTE_MS,
  },
  failureBackoffEnabled: true,
});

describe("Auto sync activity integration", () => {
  it("registers the exact capture events, throttles activity, and disposes", () => {
    // Given
    let nowMs = 0;
    const registrations: Array<{
      readonly target: "document" | "window";
      readonly event: string;
      readonly capture: boolean;
      readonly listener: () => void;
    }> = [];
    const disposed: string[] = [];
    const activity: number[] = [];
    const register = (
      target: "document" | "window",
      event: string,
      listener: () => void,
      capture: boolean
    ) => {
      registrations.push({ target, event, listener, capture });
      return () => disposed.push(`${target}:${event}`);
    };
    // When
    const installed = installAdaptiveActivityListeners({
      desktop: true,
      now: () => nowMs,
      onActivity: (activityAtMs) => activity.push(activityAtMs),
      registerDocument: (event, listener, capture) =>
        register("document", event, listener, capture),
      registerWindow: (event, listener, capture) =>
        register("window", event, listener, capture),
    });
    registrations[0].listener();
    nowMs = 999;
    registrations[1].listener();
    nowMs = 1_000;
    registrations[2].listener();
    installed.dispose();
    // Then
    assert.deepEqual(
      registrations.map(({ target, event, capture }) => ({
        target,
        event,
        capture,
      })),
      [
        { target: "document", event: "keydown", capture: true },
        { target: "document", event: "pointerdown", capture: true },
        { target: "document", event: "wheel", capture: true },
        { target: "window", event: "focus", capture: true },
      ]
    );
    assert.deepEqual(activity, [0, 1_000]);
    assert.equal(disposed.length, 4);
  });

  it("registers no adaptive events on mobile", () => {
    // Given
    let registrations = 0;
    // When
    const installed = installAdaptiveActivityListeners({
      desktop: false,
      now: () => 0,
      onActivity: () => undefined,
      registerDocument: () => {
        registrations += 1;
        return undefined;
      },
      registerWindow: () => {
        registrations += 1;
        return undefined;
      },
    });
    installed.dispose();
    // Then
    assert.equal(registrations, 0);
    assert.equal(installed.registrationCount, 0);
  });

  it("resets idle and failure state without moving the completion anchor", () => {
    // Given
    let nowMs = 0;
    const timers = new Map<number, number>();
    let nextTimerId = 1;
    const scheduler = new CompletionAwareAutoSyncScheduler({
      now: () => nowMs,
      setTimer: (_callback, delayMs) => {
        const id = nextTimerId;
        nextTimerId += 1;
        timers.set(id, nowMs + delayMs);
        return id;
      },
      clearTimer: (id) => {
        timers.delete(id);
      },
      getPolicy: policy,
      isBusy: () => false,
      runAutoSync: async () => "success",
    });
    scheduler.start();
    scheduler.recordCompletion({
      trigger: "auto",
      outcome: "failure",
      completedAtMs: 0,
    });
    nowMs = 30 * MINUTE_MS;
    const before = scheduler.snapshot().state;
    const idleInterval = getEffectiveIntervalMs(
      policy(),
      before,
      new Date(nowMs)
    );
    // When
    scheduler.recordActivity(nowMs);
    const after = scheduler.snapshot();
    // Then
    assert.equal(idleInterval, 60 * MINUTE_MS);
    assert.equal(after.state.completionAnchorMs, before.completionAnchorMs);
    assert.equal(after.state.failureCount, 0);
    assert.equal(
      getEffectiveIntervalMs(policy(), after.state, new Date(nowMs)),
      10 * MINUTE_MS
    );
    assert.equal(timers.size, 1);
  });

  it("normalizes, persists, and reschedules one malformed replacement", async () => {
    // Given
    let persists = 0;
    let reschedules = 0;
    let latestBase = 0;
    let latestPassword = "";
    const current = {
      password: "preserved",
      autoRunEveryMilliseconds: 10 * MINUTE_MS,
    };
    // When
    await applyNormalizedSettingsReplacement(
      current,
      {
        autoRunEveryMilliseconds: Number.NaN,
        autoRunNightStartMinute: 60,
        autoRunNightEndMinute: 60,
      },
      async (settings) => {
        persists += 1;
        latestBase = settings.autoRunEveryMilliseconds;
        latestPassword = settings.password;
      },
      () => {
        reschedules += 1;
      }
    );
    // Then
    assert.equal(persists, 1);
    assert.equal(reschedules, 1);
    assert.equal(latestBase, -1);
    assert.equal(latestPassword, "preserved");
  });

  it("routes a Basic auto-run selection through one live change handler", async () => {
    // Given
    const model = buildAutoSyncSettingsControlModel(
      { autoRunEveryMilliseconds: 600_000 },
      true,
      {
        disabled: "disabled",
        minutes: (minutes) => `${minutes}`,
        legacy: (minutes) => `legacy ${minutes}`,
        hour: (hour) => `${hour}`,
      }
    );
    const options = new Map<string, string>();
    let selected = "";
    let changeHandler: ((value: string) => void | Promise<void>) | undefined;
    const dropdown: AutoRunDropdown = {
      addOption: (value, label) => {
        options.set(value, label);
        return dropdown;
      },
      setValue: (value) => {
        selected = value;
        return dropdown;
      },
      onChange: (handler) => {
        changeHandler = handler;
        return dropdown;
      },
    };
    const applied: number[] = [];
    // When
    configureAutoRunDropdown(dropdown, model, async (intervalMs) => {
      applied.push(intervalMs);
    });
    if (changeHandler === undefined) {
      throw new Error("auto-run change handler was not registered");
    }
    await changeHandler("900000");
    // Then
    assert.equal(options.size, 8);
    assert.equal(selected, "600000");
    assert.deepEqual(applied, [900_000]);
  });
});

import { strict as assert } from "assert";
import {
  AUTO_RUN_INTERVAL_PRESETS_MS,
  type AutoSyncPolicy,
  DEFAULT_AUTO_SYNC_POLICY,
  FAILURE_BACKOFF_CAP_MS,
  REMOTE_LISTING_TIMEOUT_PRESETS_MS,
  createAutoSyncState,
  evaluateAutoSyncSchedule,
  getEffectiveIntervalMs,
  getNextNightBoundaryAt,
  isInNightWindow,
  normalizeAutoSyncSettings,
  recordActivity,
  recordSyncInvocation,
  recordSyncOutcome,
} from "../src/autoSyncScheduler";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const policy = (baseIntervalMs = 10 * MINUTE_MS): AutoSyncPolicy => ({
  baseIntervalMs,
  night: {
    enabled: false,
    startMinute: 23 * 60,
    endMinute: 7 * 60,
    intervalMs: 2 * HOUR_MS,
  },
  inactivity: {
    enabled: false,
    thresholdMs: 30 * MINUTE_MS,
    intervalMs: HOUR_MS,
  },
  failureBackoffEnabled: true,
});

const localDate = (day: number, hour: number, minute = 0): Date =>
  new Date(2025, 0, day, hour, minute, 0, 0);

describe("Auto sync scheduler", () => {
  it("publishes the approved disabled adaptive defaults", () => {
    // Given
    const expected = policy(0);
    // When
    const defaults = DEFAULT_AUTO_SYNC_POLICY;
    // Then
    assert.deepEqual(defaults, expected);
  });

  it("disables all periodic decisions when the base interval is disabled", () => {
    // Given
    const defaults = DEFAULT_AUTO_SYNC_POLICY;
    const config: AutoSyncPolicy = {
      ...defaults,
      night: { ...defaults.night, enabled: true },
      inactivity: { ...defaults.inactivity, enabled: true },
    };
    const now = localDate(2, 1);
    const state = createAutoSyncState(now.getTime() - 10 * HOUR_MS);
    // When
    const result = evaluateAutoSyncSchedule(config, state, now);
    // Then
    assert.deepEqual(result.decision, { kind: "disabled" });
  });

  it("uses the approved crossing-midnight night window at exact boundaries", () => {
    // Given
    const bounds = { startMinute: 23 * 60, endMinute: 7 * 60 };
    // When
    const membership = [
      isInNightWindow(localDate(1, 22, 59), bounds),
      isInNightWindow(localDate(1, 23), bounds),
      isInNightWindow(localDate(2, 6, 59), bounds),
      isInNightWindow(localDate(2, 7), bounds),
    ];
    const nextBoundary = getNextNightBoundaryAt(localDate(1, 23), bounds);
    // Then
    assert.deepEqual(membership, [false, true, true, false]);
    assert.equal(nextBoundary, localDate(2, 7).getTime());
  });

  it("normalizes invalid or equal night bounds to 23:00-07:00", () => {
    // Given
    const atMidnight = localDate(2, 0);
    // When
    const equalBoundsMembership = isInNightWindow(atMidnight, {
      startMinute: 60,
      endMinute: 60,
    });
    const invalidBoundsBoundary = getNextNightBoundaryAt(atMidnight, {
      startMinute: Number.NaN,
      endMinute: 1_500,
    });
    // Then
    assert.equal(equalBoundsMembership, true);
    assert.equal(invalidBoundsBoundary, localDate(2, 7).getTime());
  });

  it("enters inactivity at 30 minutes and renewed activity resets it", () => {
    // Given
    const defaults = policy();
    const config: AutoSyncPolicy = {
      ...defaults,
      inactivity: { ...defaults.inactivity, enabled: true },
    };
    const anchor = localDate(1, 12).getTime();
    const state = createAutoSyncState(anchor);
    // When
    const before = getEffectiveIntervalMs(
      config,
      state,
      new Date(anchor + 30 * MINUTE_MS - 1)
    );
    const atThreshold = getEffectiveIntervalMs(
      config,
      state,
      new Date(anchor + 30 * MINUTE_MS)
    );
    const activeState = recordActivity(state, anchor + 31 * MINUTE_MS);
    // Then
    assert.equal(before, 10 * MINUTE_MS);
    assert.equal(atThreshold, HOUR_MS);
    assert.equal(
      getEffectiveIntervalMs(
        config,
        activeState,
        new Date(anchor + 31 * MINUTE_MS)
      ),
      10 * MINUTE_MS
    );
  });

  it("chooses the longest active policy contribution", () => {
    // Given
    const defaults = policy(30 * MINUTE_MS);
    const config: AutoSyncPolicy = {
      ...defaults,
      night: { ...defaults.night, enabled: true },
      inactivity: { ...defaults.inactivity, enabled: true },
    };
    const now = localDate(2, 1);
    const state = {
      ...createAutoSyncState(now.getTime() - 2 * HOUR_MS),
      failureCount: 2,
    };
    // When
    const interval = getEffectiveIntervalMs(config, state, now);
    // Then
    assert.equal(interval, 2 * HOUR_MS);
  });

  it("backs off automatic failures by 2x, 4x, and 8x up to four hours", () => {
    // Given
    const config = policy(30 * MINUTE_MS);
    let state = createAutoSyncState(0);
    const intervals: number[] = [];
    // When
    for (let count = 0; count < 4; count += 1) {
      state = recordSyncOutcome(state, {
        trigger: "auto",
        outcome: "failure",
        completedAtMs: count + 1,
      });
      intervals.push(
        getEffectiveIntervalMs(config, state, new Date(count + 1))
      );
    }
    // Then
    assert.deepEqual(intervals, [
      HOUR_MS,
      2 * HOUR_MS,
      4 * HOUR_MS,
      FAILURE_BACKOFF_CAP_MS,
    ]);
  });

  it("does not increment backoff for non-periodic failures and resets on manual invocation", () => {
    // Given
    const failed = recordSyncOutcome(createAutoSyncState(0), {
      trigger: "auto",
      outcome: "failure",
      completedAtMs: 10,
    });
    // When
    const startupFailure = recordSyncOutcome(failed, {
      trigger: "auto_once_init",
      outcome: "failure",
      completedAtMs: 20,
    });
    const manualStart = recordSyncInvocation(startupFailure, "manual");
    const success = recordSyncOutcome(startupFailure, {
      trigger: "auto_sync_on_save",
      outcome: "success",
      completedAtMs: 30,
    });
    // Then
    assert.equal(startupFailure.failureCount, 1);
    assert.equal(manualStart.failureCount, 0);
    assert.equal(success.failureCount, 0);
  });

  it("treats a busy outcome as neutral", () => {
    // Given
    const state = {
      ...createAutoSyncState(100, 80),
      failureCount: 2,
      overdueRunPending: true,
    };
    // When
    const next = recordSyncOutcome(state, {
      trigger: "auto",
      outcome: "skipped-busy",
      completedAtMs: 200,
    });
    // Then
    assert.deepEqual(next, state);
  });

  it("anchors the next due time to non-busy completion", () => {
    // Given
    const config = policy();
    const completed = recordSyncOutcome(createAutoSyncState(0), {
      trigger: "auto_sync_on_save",
      outcome: "success",
      completedAtMs: 1_000,
    });
    // When
    const result = evaluateAutoSyncSchedule(config, completed, new Date(1_001));
    // Then
    assert.equal(result.decision.kind, "wait");
    if (result.decision.kind === "wait") {
      assert.equal(result.decision.nextDueAtMs, 1_000 + 10 * MINUTE_MS);
    }
  });

  it("wakes at the next policy boundary when it is earlier than cadence", () => {
    // Given
    const defaults = policy(4 * HOUR_MS);
    const config: AutoSyncPolicy = {
      ...defaults,
      night: { ...defaults.night, enabled: true },
    };
    const now = localDate(1, 22);
    const state = createAutoSyncState(now.getTime());
    // When
    const result = evaluateAutoSyncSchedule(config, state, now);
    // Then
    assert.equal(result.decision.kind, "wait");
    if (result.decision.kind === "wait") {
      assert.equal(result.decision.wakeAtMs, localDate(1, 23).getTime());
    }
  });

  it("recomputes against absolute time after forward and backward clock movement", () => {
    // Given
    const config = policy();
    const anchor = localDate(1, 12).getTime();
    const state = createAutoSyncState(anchor);
    // When
    const forward = evaluateAutoSyncSchedule(
      config,
      state,
      new Date(anchor + HOUR_MS)
    );
    const backward = evaluateAutoSyncSchedule(
      config,
      state,
      new Date(anchor - HOUR_MS)
    );
    // Then
    assert.equal(forward.decision.kind, "run");
    assert.equal(backward.decision.kind, "wait");
    if (backward.decision.kind === "wait") {
      assert.equal(backward.decision.wakeAtMs, anchor + 10 * MINUTE_MS);
    }
  });

  it("emits at most one overdue run decision until a completion reanchors", () => {
    // Given
    const config = policy();
    const now = localDate(2, 12);
    const state = createAutoSyncState(now.getTime() - HOUR_MS);
    // When
    const first = evaluateAutoSyncSchedule(config, state, now);
    const second = evaluateAutoSyncSchedule(config, first.state, now);
    // Then
    assert.equal(first.decision.kind, "run");
    assert.equal(second.decision.kind, "wait");
  });
});

describe("sync settings normalization", () => {
  it("preserves a valid current-like settings object", () => {
    // Given
    const current = {
      password: "preserved-secret",
      autoRunEveryMilliseconds: 10 * MINUTE_MS,
      initRunAfterMilliseconds: 5 * MINUTE_MS,
      syncOnSaveAfterMilliseconds: 1_000,
    };
    // When
    const merged = { ...current, ...normalizeAutoSyncSettings(current) };
    // Then
    assert.equal(merged.password, current.password);
    assert.equal(merged.autoRunEveryMilliseconds, 10 * MINUTE_MS);
    assert.equal(merged.initRunAfterMilliseconds, 5 * MINUTE_MS);
    assert.equal(merged.syncOnSaveAfterMilliseconds, 1_000);
  });

  it("applies every approved default when scheduler settings are missing", () => {
    // Given
    const missing = {};
    // When
    const normalized = normalizeAutoSyncSettings(missing);
    // Then
    assert.deepEqual(normalized, {
      autoRunEveryMilliseconds: -1,
      remoteListingTimeoutMilliseconds: 10 * MINUTE_MS,
      autoRunNightEnabled: false,
      autoRunNightStartMinute: 23 * 60,
      autoRunNightEndMinute: 7 * 60,
      autoRunNightIntervalMilliseconds: 2 * HOUR_MS,
      autoRunInactivityEnabled: false,
      autoRunInactivityThresholdMilliseconds: 30 * MINUTE_MS,
      autoRunInactivityIntervalMilliseconds: HOUR_MS,
      autoRunFailureBackoffEnabled: true,
    });
  });

  it("replaces malformed numeric settings with safe defaults", () => {
    // Given
    const malformed = {
      autoRunEveryMilliseconds: Number.POSITIVE_INFINITY,
      remoteListingTimeoutMilliseconds: 7 * MINUTE_MS,
      autoRunNightEnabled: true,
      autoRunNightStartMinute: -1,
      autoRunNightEndMinute: 24 * 60,
      autoRunNightIntervalMilliseconds: 0,
      autoRunInactivityEnabled: true,
      autoRunInactivityThresholdMilliseconds: Number.NaN,
      autoRunInactivityIntervalMilliseconds: -HOUR_MS,
      autoRunFailureBackoffEnabled: false,
    };
    // When
    const normalized = normalizeAutoSyncSettings(malformed);
    // Then
    assert.equal(normalized.autoRunEveryMilliseconds, -1);
    assert.equal(normalized.remoteListingTimeoutMilliseconds, 10 * MINUTE_MS);
    assert.equal(normalized.autoRunNightStartMinute, 23 * 60);
    assert.equal(normalized.autoRunNightEndMinute, 7 * 60);
    assert.equal(normalized.autoRunNightIntervalMilliseconds, 2 * HOUR_MS);
    assert.equal(
      normalized.autoRunInactivityThresholdMilliseconds,
      30 * MINUTE_MS
    );
    assert.equal(normalized.autoRunInactivityIntervalMilliseconds, HOUR_MS);
    assert.equal(normalized.autoRunNightEnabled, true);
    assert.equal(normalized.autoRunInactivityEnabled, true);
    assert.equal(normalized.autoRunFailureBackoffEnabled, false);
  });

  it("resets both night boundaries when they are equal", () => {
    // Given
    const equalBoundaries = {
      autoRunNightStartMinute: 60,
      autoRunNightEndMinute: 60,
    };
    // When
    const normalized = normalizeAutoSyncSettings(equalBoundaries);
    // Then
    assert.equal(normalized.autoRunNightStartMinute, 23 * 60);
    assert.equal(normalized.autoRunNightEndMinute, 7 * 60);
  });

  it("preserves a legacy seven-minute base and safe numeric values", () => {
    // Given
    const valid = {
      autoRunEveryMilliseconds: 7 * MINUTE_MS,
      remoteListingTimeoutMilliseconds: 20 * MINUTE_MS,
      autoRunNightStartMinute: 22 * 60,
      autoRunNightEndMinute: 6 * 60,
      autoRunNightIntervalMilliseconds: 90 * MINUTE_MS,
      autoRunInactivityThresholdMilliseconds: 45 * MINUTE_MS,
      autoRunInactivityIntervalMilliseconds: 75 * MINUTE_MS,
    };
    // When
    const normalized = normalizeAutoSyncSettings(valid);
    // Then
    assert.equal(normalized.autoRunEveryMilliseconds, 7 * MINUTE_MS);
    assert.equal(normalized.remoteListingTimeoutMilliseconds, 20 * MINUTE_MS);
    assert.equal(normalized.autoRunNightStartMinute, 22 * 60);
    assert.equal(normalized.autoRunNightEndMinute, 6 * 60);
    assert.equal(normalized.autoRunNightIntervalMilliseconds, 90 * MINUTE_MS);
    assert.equal(
      normalized.autoRunInactivityThresholdMilliseconds,
      45 * MINUTE_MS
    );
    assert.equal(
      normalized.autoRunInactivityIntervalMilliseconds,
      75 * MINUTE_MS
    );
  });

  it("publishes the approved base and listing timeout choices", () => {
    // Given
    const minute = MINUTE_MS;
    // When
    const choices = {
      base: AUTO_RUN_INTERVAL_PRESETS_MS,
      listing: REMOTE_LISTING_TIMEOUT_PRESETS_MS,
    };
    // Then
    assert.deepEqual(choices.base, [
      -1,
      5 * minute,
      10 * minute,
      15 * minute,
      30 * minute,
      60 * minute,
      120 * minute,
      240 * minute,
    ]);
    assert.deepEqual(choices.listing, [
      2 * minute,
      5 * minute,
      10 * minute,
      20 * minute,
      30 * minute,
      60 * minute,
    ]);
  });
});

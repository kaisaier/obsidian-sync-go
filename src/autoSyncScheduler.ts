// allow: SIZE_OK — scheduler policy and settings normalization are one mandated public boundary.
export const DEFAULT_NIGHT_START_MINUTE = 23 * 60;
export const DEFAULT_NIGHT_END_MINUTE = 7 * 60;
export const DEFAULT_NIGHT_INTERVAL_MS = 2 * 60 * 60 * 1_000;
export const DEFAULT_INACTIVITY_THRESHOLD_MS = 30 * 60 * 1_000;
export const DEFAULT_INACTIVITY_INTERVAL_MS = 60 * 60 * 1_000;
export const FAILURE_BACKOFF_CAP_MS = 4 * 60 * 60 * 1_000;
export const DEFAULT_REMOTE_LISTING_TIMEOUT_MS = 10 * 60 * 1_000;
export const MAX_TIMER_DELAY_MS = 2_147_483_647;
export const AUTO_RUN_INTERVAL_PRESETS_MS = [
  -1,
  5 * 60 * 1_000,
  10 * 60 * 1_000,
  15 * 60 * 1_000,
  30 * 60 * 1_000,
  60 * 60 * 1_000,
  120 * 60 * 1_000,
  240 * 60 * 1_000,
] as const;
export const REMOTE_LISTING_TIMEOUT_PRESETS_MS = [
  2 * 60 * 1_000,
  5 * 60 * 1_000,
  DEFAULT_REMOTE_LISTING_TIMEOUT_MS,
  20 * 60 * 1_000,
  30 * 60 * 1_000,
  60 * 60 * 1_000,
] as const;

export type AutoSyncSettingsInput = {
  readonly autoRunEveryMilliseconds?: number;
  readonly remoteListingTimeoutMilliseconds?: number;
  readonly autoRunNightEnabled?: boolean;
  readonly autoRunNightStartMinute?: number;
  readonly autoRunNightEndMinute?: number;
  readonly autoRunNightIntervalMilliseconds?: number;
  readonly autoRunInactivityEnabled?: boolean;
  readonly autoRunInactivityThresholdMilliseconds?: number;
  readonly autoRunInactivityIntervalMilliseconds?: number;
  readonly autoRunFailureBackoffEnabled?: boolean;
};

export type NormalizedAutoSyncSettings = Required<AutoSyncSettingsInput>;

const isSafeTimerDelay = (value: number | undefined): value is number =>
  value !== undefined &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= MAX_TIMER_DELAY_MS;

const isMinuteOfDay = (value: number | undefined): value is number =>
  value !== undefined &&
  Number.isInteger(value) &&
  value >= 0 &&
  value < 24 * 60;

export const normalizeAutoSyncSettings = (
  settings: AutoSyncSettingsInput
): NormalizedAutoSyncSettings => {
  const nightBoundsAreValid =
    isMinuteOfDay(settings.autoRunNightStartMinute) &&
    isMinuteOfDay(settings.autoRunNightEndMinute) &&
    settings.autoRunNightStartMinute !== settings.autoRunNightEndMinute;
  const listingTimeoutIsPreset = REMOTE_LISTING_TIMEOUT_PRESETS_MS.some(
    (preset) => preset === settings.remoteListingTimeoutMilliseconds
  );
  return {
    autoRunEveryMilliseconds: isSafeTimerDelay(
      settings.autoRunEveryMilliseconds
    )
      ? settings.autoRunEveryMilliseconds
      : -1,
    remoteListingTimeoutMilliseconds: listingTimeoutIsPreset
      ? settings.remoteListingTimeoutMilliseconds ??
        DEFAULT_REMOTE_LISTING_TIMEOUT_MS
      : DEFAULT_REMOTE_LISTING_TIMEOUT_MS,
    autoRunNightEnabled:
      typeof settings.autoRunNightEnabled === "boolean"
        ? settings.autoRunNightEnabled
        : false,
    autoRunNightStartMinute: nightBoundsAreValid
      ? settings.autoRunNightStartMinute ?? DEFAULT_NIGHT_START_MINUTE
      : DEFAULT_NIGHT_START_MINUTE,
    autoRunNightEndMinute: nightBoundsAreValid
      ? settings.autoRunNightEndMinute ?? DEFAULT_NIGHT_END_MINUTE
      : DEFAULT_NIGHT_END_MINUTE,
    autoRunNightIntervalMilliseconds: isSafeTimerDelay(
      settings.autoRunNightIntervalMilliseconds
    )
      ? settings.autoRunNightIntervalMilliseconds
      : DEFAULT_NIGHT_INTERVAL_MS,
    autoRunInactivityEnabled:
      typeof settings.autoRunInactivityEnabled === "boolean"
        ? settings.autoRunInactivityEnabled
        : false,
    autoRunInactivityThresholdMilliseconds: isSafeTimerDelay(
      settings.autoRunInactivityThresholdMilliseconds
    )
      ? settings.autoRunInactivityThresholdMilliseconds
      : DEFAULT_INACTIVITY_THRESHOLD_MS,
    autoRunInactivityIntervalMilliseconds: isSafeTimerDelay(
      settings.autoRunInactivityIntervalMilliseconds
    )
      ? settings.autoRunInactivityIntervalMilliseconds
      : DEFAULT_INACTIVITY_INTERVAL_MS,
    autoRunFailureBackoffEnabled:
      typeof settings.autoRunFailureBackoffEnabled === "boolean"
        ? settings.autoRunFailureBackoffEnabled
        : true,
  };
};

export type NightWindow = {
  readonly startMinute: number;
  readonly endMinute: number;
};

export type AutoSyncPolicy = {
  readonly baseIntervalMs: number;
  readonly night: NightWindow & {
    readonly enabled: boolean;
    readonly intervalMs: number;
  };
  readonly inactivity: {
    readonly enabled: boolean;
    readonly thresholdMs: number;
    readonly intervalMs: number;
  };
  readonly failureBackoffEnabled: boolean;
};

export type SyncOutcome = "success" | "failure" | "skipped-busy";
export type AutoSyncTrigger =
  | "manual"
  | "dry"
  | "auto"
  | "auto_once_init"
  | "auto_sync_on_save";

export type SyncInvocationOptions = {
  readonly trigger: AutoSyncTrigger;
  readonly isBusy: () => boolean;
  readonly recordInvocation: (trigger: AutoSyncTrigger) => void;
  readonly start: () => void;
};

export const beginSyncInvocation = (
  options: SyncInvocationOptions
): "started" | "skipped-busy" => {
  options.recordInvocation(options.trigger);
  if (options.isBusy()) {
    return "skipped-busy";
  }
  options.start();
  return "started";
};

export const DEFAULT_AUTO_SYNC_POLICY: AutoSyncPolicy = {
  baseIntervalMs: 0,
  night: {
    enabled: false,
    startMinute: DEFAULT_NIGHT_START_MINUTE,
    endMinute: DEFAULT_NIGHT_END_MINUTE,
    intervalMs: DEFAULT_NIGHT_INTERVAL_MS,
  },
  inactivity: {
    enabled: false,
    thresholdMs: DEFAULT_INACTIVITY_THRESHOLD_MS,
    intervalMs: DEFAULT_INACTIVITY_INTERVAL_MS,
  },
  failureBackoffEnabled: true,
};

export type AutoSyncState = {
  readonly completionAnchorMs: number;
  readonly lastActivityMs: number;
  readonly failureCount: number;
  readonly overdueRunPending: boolean;
};

export type ScheduleDecision =
  | { readonly kind: "disabled" }
  | { readonly kind: "run"; readonly dueAtMs: number }
  | {
      readonly kind: "wait";
      readonly wakeAtMs: number;
      readonly nextDueAtMs: number;
      readonly effectiveIntervalMs: number;
    };

export type ScheduleEvaluation = {
  readonly decision: ScheduleDecision;
  readonly state: AutoSyncState;
};

export type SyncCompletion = {
  readonly trigger: AutoSyncTrigger;
  readonly outcome: SyncOutcome;
  readonly completedAtMs: number;
};

const normalizeNightWindow = (window: NightWindow): NightWindow => {
  const startIsValid =
    Number.isInteger(window.startMinute) &&
    window.startMinute >= 0 &&
    window.startMinute < 24 * 60;
  const endIsValid =
    Number.isInteger(window.endMinute) &&
    window.endMinute >= 0 &&
    window.endMinute < 24 * 60;
  if (!startIsValid || !endIsValid || window.startMinute === window.endMinute) {
    return {
      startMinute: DEFAULT_NIGHT_START_MINUTE,
      endMinute: DEFAULT_NIGHT_END_MINUTE,
    };
  }
  return window;
};

const localMinuteOfDay = (now: Date): number =>
  now.getHours() * 60 + now.getMinutes();

export const isInNightWindow = (now: Date, window: NightWindow): boolean => {
  const normalized = normalizeNightWindow(window);
  const minute = localMinuteOfDay(now);
  if (normalized.startMinute < normalized.endMinute) {
    return minute >= normalized.startMinute && minute < normalized.endMinute;
  }
  return minute >= normalized.startMinute || minute < normalized.endMinute;
};

export const getNextNightBoundaryAt = (
  now: Date,
  window: NightWindow
): number => {
  const normalized = normalizeNightWindow(window);
  const boundaryMinute = isInNightWindow(now, normalized)
    ? normalized.endMinute
    : normalized.startMinute;
  const candidate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Math.floor(boundaryMinute / 60),
    boundaryMinute % 60,
    0,
    0
  );
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate.getTime();
};

export const createAutoSyncState = (
  completionAnchorMs: number,
  lastActivityMs = completionAnchorMs
): AutoSyncState => ({
  completionAnchorMs,
  lastActivityMs,
  failureCount: 0,
  overdueRunPending: false,
});

export const recordActivity = (
  state: AutoSyncState,
  activityAtMs: number
): AutoSyncState => ({
  ...state,
  lastActivityMs: activityAtMs,
  failureCount: 0,
});

export const recordSyncInvocation = (
  state: AutoSyncState,
  trigger: AutoSyncTrigger
): AutoSyncState =>
  trigger === "manual" || trigger === "dry"
    ? { ...state, failureCount: 0 }
    : state;

export const recordSyncOutcome = (
  state: AutoSyncState,
  completion: SyncCompletion
): AutoSyncState => {
  if (completion.outcome === "skipped-busy") {
    return state;
  }
  const failureCount =
    completion.outcome === "success"
      ? 0
      : state.failureCount + (completion.trigger === "auto" ? 1 : 0);
  return {
    ...state,
    completionAnchorMs: completion.completedAtMs,
    failureCount,
    overdueRunPending: false,
  };
};

export const getEffectiveIntervalMs = (
  policy: AutoSyncPolicy,
  state: AutoSyncState,
  now: Date
): number => {
  if (!(policy.baseIntervalMs > 0) || !Number.isFinite(policy.baseIntervalMs)) {
    return 0;
  }
  const contributions = [policy.baseIntervalMs];
  if (policy.night.enabled && isInNightWindow(now, policy.night)) {
    contributions.push(policy.night.intervalMs);
  }
  const idleAtMs = state.lastActivityMs + policy.inactivity.thresholdMs;
  if (policy.inactivity.enabled && now.getTime() >= idleAtMs) {
    contributions.push(policy.inactivity.intervalMs);
  }
  if (policy.failureBackoffEnabled && state.failureCount > 0) {
    const exponent = Math.min(state.failureCount, 53);
    contributions.push(
      Math.min(policy.baseIntervalMs * 2 ** exponent, FAILURE_BACKOFF_CAP_MS)
    );
  }
  return Math.max(...contributions);
};

export const getNextPolicyBoundaryAt = (
  policy: AutoSyncPolicy,
  state: AutoSyncState,
  now: Date
): number | undefined => {
  const boundaries: number[] = [];
  if (policy.night.enabled) {
    boundaries.push(getNextNightBoundaryAt(now, policy.night));
  }
  const idleAtMs = state.lastActivityMs + policy.inactivity.thresholdMs;
  if (policy.inactivity.enabled && idleAtMs > now.getTime()) {
    boundaries.push(idleAtMs);
  }
  return boundaries.length === 0 ? undefined : Math.min(...boundaries);
};

export const evaluateAutoSyncSchedule = (
  policy: AutoSyncPolicy,
  state: AutoSyncState,
  now: Date
): ScheduleEvaluation => {
  const effectiveIntervalMs = getEffectiveIntervalMs(policy, state, now);
  if (effectiveIntervalMs === 0) {
    return { decision: { kind: "disabled" }, state };
  }
  const nextDueAtMs = state.completionAnchorMs + effectiveIntervalMs;
  if (now.getTime() >= nextDueAtMs && !state.overdueRunPending) {
    return {
      decision: { kind: "run", dueAtMs: nextDueAtMs },
      state: { ...state, overdueRunPending: true },
    };
  }
  const futureDueAtMs =
    now.getTime() >= nextDueAtMs
      ? nextDueAtMs +
        (Math.floor((now.getTime() - nextDueAtMs) / effectiveIntervalMs) + 1) *
          effectiveIntervalMs
      : nextDueAtMs;
  const policyBoundaryAtMs = getNextPolicyBoundaryAt(policy, state, now);
  return {
    decision: {
      kind: "wait",
      wakeAtMs:
        policyBoundaryAtMs === undefined
          ? futureDueAtMs
          : Math.min(futureDueAtMs, policyBoundaryAtMs),
      nextDueAtMs,
      effectiveIntervalMs,
    },
    state,
  };
};

export const createAutoSyncPolicy = (
  settings: NormalizedAutoSyncSettings,
  adaptiveEnabled: boolean
): AutoSyncPolicy => ({
  baseIntervalMs:
    settings.autoRunEveryMilliseconds > 0
      ? settings.autoRunEveryMilliseconds
      : 0,
  night: {
    enabled: adaptiveEnabled && settings.autoRunNightEnabled,
    startMinute: settings.autoRunNightStartMinute,
    endMinute: settings.autoRunNightEndMinute,
    intervalMs: settings.autoRunNightIntervalMilliseconds,
  },
  inactivity: {
    enabled: adaptiveEnabled && settings.autoRunInactivityEnabled,
    thresholdMs: settings.autoRunInactivityThresholdMilliseconds,
    intervalMs: settings.autoRunInactivityIntervalMilliseconds,
  },
  failureBackoffEnabled: settings.autoRunFailureBackoffEnabled,
});

export type AutoSyncSchedulerDependencies = {
  readonly now: () => number;
  readonly setTimer: (callback: () => void, delayMs: number) => number;
  readonly clearTimer: (timerId: number) => void;
  readonly getPolicy: () => AutoSyncPolicy;
  readonly isBusy: () => boolean;
  readonly runAutoSync: () => Promise<SyncOutcome>;
};

export type AutoSyncSchedulerSnapshot = {
  readonly armedTimerCount: 0 | 1;
  readonly generation: number;
  readonly stopped: boolean;
  readonly state: AutoSyncState;
};

export class CompletionAwareAutoSyncScheduler {
  private timerId: number | undefined;
  private generation = 0;
  private stopped = true;
  private state: AutoSyncState;

  constructor(private readonly dependencies: AutoSyncSchedulerDependencies) {
    this.state = createAutoSyncState(dependencies.now());
  }

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.clearArmedTimer();
    this.generation += 1;
    this.stopped = false;
    this.state = createAutoSyncState(this.dependencies.now());
    this.arm(this.generation);
  }

  reschedule(): void {
    this.clearArmedTimer();
    this.generation += 1;
    this.stopped = false;
    this.arm(this.generation);
  }

  stop(): void {
    this.clearArmedTimer();
    this.generation += 1;
    this.stopped = true;
  }

  recordInvocation(trigger: AutoSyncTrigger): void {
    this.state = recordSyncInvocation(this.state, trigger);
  }

  recordActivity(activityAtMs: number): void {
    this.state = recordActivity(this.state, activityAtMs);
    if (this.stopped) {
      return;
    }
    this.clearArmedTimer();
    this.generation += 1;
    this.arm(this.generation);
  }

  recordCompletion(completion: SyncCompletion): void {
    this.state = recordSyncOutcome(this.state, completion);
    if (completion.outcome === "skipped-busy" || this.stopped) {
      return;
    }
    this.clearArmedTimer();
    this.generation += 1;
    this.arm(this.generation);
  }

  snapshot(): AutoSyncSchedulerSnapshot {
    return {
      armedTimerCount: this.timerId === undefined ? 0 : 1,
      generation: this.generation,
      stopped: this.stopped,
      state: this.state,
    };
  }

  private clearArmedTimer(): void {
    if (this.timerId !== undefined) {
      this.dependencies.clearTimer(this.timerId);
      this.timerId = undefined;
    }
  }

  private arm(generation: number): void {
    if (this.stopped || generation !== this.generation) {
      return;
    }
    this.clearArmedTimer();
    const nowMs = this.dependencies.now();
    const evaluation = evaluateAutoSyncSchedule(
      this.dependencies.getPolicy(),
      this.state,
      new Date(nowMs)
    );
    this.state = evaluation.state;
    if (evaluation.decision.kind === "disabled") {
      this.state = createAutoSyncState(nowMs, this.state.lastActivityMs);
      return;
    }
    const wakeAtMs =
      evaluation.decision.kind === "run" ? nowMs : evaluation.decision.wakeAtMs;
    this.setWakeTimer(wakeAtMs, generation);
  }

  private setWakeTimer(wakeAtMs: number, generation: number): void {
    const delayMs = Math.min(
      Math.max(0, wakeAtMs - this.dependencies.now()),
      MAX_TIMER_DELAY_MS
    );
    this.timerId = this.dependencies.setTimer(
      () => void this.handleWake(generation),
      delayMs
    );
  }

  private async handleWake(generation: number): Promise<void> {
    if (this.stopped || generation !== this.generation) {
      return;
    }
    this.timerId = undefined;
    const nowMs = this.dependencies.now();
    const evaluation = evaluateAutoSyncSchedule(
      this.dependencies.getPolicy(),
      this.state,
      new Date(nowMs)
    );
    this.state = evaluation.state;
    if (evaluation.decision.kind !== "run") {
      this.arm(generation);
      return;
    }
    if (this.dependencies.isBusy()) {
      this.state = { ...this.state, overdueRunPending: false };
      const policy = this.dependencies.getPolicy();
      const retryAtMs =
        nowMs + getEffectiveIntervalMs(policy, this.state, new Date(nowMs));
      const boundaryAtMs = getNextPolicyBoundaryAt(
        policy,
        this.state,
        new Date(nowMs)
      );
      this.setWakeTimer(
        boundaryAtMs === undefined
          ? retryAtMs
          : Math.min(retryAtMs, boundaryAtMs),
        generation
      );
      return;
    }

    let outcome: SyncOutcome = "failure";
    try {
      outcome = await this.dependencies.runAutoSync();
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      outcome = "failure";
    } finally {
      if (!this.stopped && generation === this.generation) {
        this.state = recordSyncOutcome(this.state, {
          trigger: "auto",
          outcome,
          completedAtMs: this.dependencies.now(),
        });
        this.arm(generation);
      }
    }
  }
}

export type SyncSettlementStep = {
  readonly label: string;
  readonly run: () => void | Promise<void>;
};

export type SyncSettlementFailure = {
  readonly label: string;
  readonly error: Error;
};

export class SyncSettlementError extends Error {
  constructor(readonly failures: readonly SyncSettlementFailure[]) {
    super("sync settlement failed");
    this.name = "SyncSettlementError";
  }
}

export type SyncSettlementOptions = {
  readonly runSync: () => Promise<boolean>;
  readonly settlementSteps: (
    successful: boolean
  ) => readonly SyncSettlementStep[];
  readonly reportError: (error: SyncSettlementError) => void;
};

const runSettlementSteps = async (
  steps: readonly SyncSettlementStep[]
): Promise<SyncSettlementFailure[]> => {
  const failures: SyncSettlementFailure[] = [];
  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      failures.push({
        label: step.label,
        error:
          error instanceof Error ? error : new Error("unknown sync failure"),
      });
    }
  }
  return failures;
};

const reportSettlementErrors = (
  failures: readonly SyncSettlementFailure[],
  reportError: (error: SyncSettlementError) => void
): void => {
  if (failures.length > 0) {
    reportError(new SyncSettlementError(failures));
  }
};

export const runSyncWithSettlement = async (
  options: SyncSettlementOptions
): Promise<"success" | "failure"> => {
  let successful = false;
  const failures: SyncSettlementFailure[] = [];
  try {
    successful = await options.runSync();
  } catch (error) {
    failures.push({
      label: "run sync",
      error:
        error instanceof Error ? error : new Error("sync failed unexpectedly"),
    });
  }
  failures.push(
    ...(await runSettlementSteps(options.settlementSteps(successful)))
  );
  reportSettlementErrors(failures, options.reportError);
  return successful && failures.length === 0 ? "success" : "failure";
};

export const settleSkippedSync = async (
  steps: readonly SyncSettlementStep[],
  reportError: (error: SyncSettlementError) => void
): Promise<"skipped-busy"> => {
  reportSettlementErrors(await runSettlementSteps(steps), reportError);
  return "skipped-busy";
};

export type AdaptiveActivityListenerOptions = {
  readonly desktop: boolean;
  readonly now: () => number;
  readonly onActivity: (activityAtMs: number) => void;
  readonly registerDocument: (
    event: "keydown" | "pointerdown" | "wheel",
    listener: () => void,
    capture: true
  ) => undefined | (() => void);
  readonly registerWindow: (
    event: "focus",
    listener: () => void,
    capture: true
  ) => undefined | (() => void);
};

export type AdaptiveActivityListenerRegistration = {
  readonly registrationCount: number;
  readonly dispose: () => void;
};

export const installAdaptiveActivityListeners = (
  options: AdaptiveActivityListenerOptions
): AdaptiveActivityListenerRegistration => {
  if (!options.desktop) {
    return { registrationCount: 0, dispose: () => undefined };
  }
  let lastRecordedAtMs: number | undefined;
  const onActivity = () => {
    const nowMs = options.now();
    if (
      lastRecordedAtMs === undefined ||
      nowMs < lastRecordedAtMs ||
      nowMs - lastRecordedAtMs >= 1_000
    ) {
      lastRecordedAtMs = nowMs;
      options.onActivity(nowMs);
    }
  };
  const possibleDisposers = [
    options.registerDocument("keydown", onActivity, true),
    options.registerDocument("pointerdown", onActivity, true),
    options.registerDocument("wheel", onActivity, true),
    options.registerWindow("focus", onActivity, true),
  ];
  const disposers = possibleDisposers.filter(
    (dispose): dispose is () => void => dispose !== undefined
  );
  return {
    registrationCount: possibleDisposers.length,
    dispose: () => {
      for (const dispose of disposers) {
        dispose();
      }
    },
  };
};

export const applyNormalizedSettingsReplacement = async <
  TCurrent extends AutoSyncSettingsInput,
  TReplacement extends AutoSyncSettingsInput,
>(
  current: TCurrent,
  replacement: TReplacement,
  persist: (
    settings: TCurrent & TReplacement & NormalizedAutoSyncSettings
  ) => Promise<void>,
  reschedule: () => void
): Promise<TCurrent & TReplacement & NormalizedAutoSyncSettings> => {
  const merged = { ...current, ...replacement };
  const settings = { ...merged, ...normalizeAutoSyncSettings(merged) };
  await persist(settings);
  reschedule();
  return settings;
};

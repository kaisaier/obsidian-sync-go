import {
  AUTO_RUN_INTERVAL_PRESETS_MS,
  type AutoSyncSettingsInput,
  type NormalizedAutoSyncSettings,
  REMOTE_LISTING_TIMEOUT_PRESETS_MS,
  normalizeAutoSyncSettings,
} from "./autoSyncScheduler";

export type AutoSyncControlLabels = {
  readonly disabled: string;
  readonly minutes: (minutes: number) => string;
  readonly legacy: (minutes: number) => string;
  readonly hour: (hour: number) => string;
};

export type AutoSyncControlOption = {
  readonly value: number;
  readonly label: string;
  readonly legacy?: boolean;
};

export type AutoSyncSettingsControlModel = {
  readonly values: NormalizedAutoSyncSettings;
  readonly baseOptions: readonly AutoSyncControlOption[];
  readonly remoteListingTimeoutOptions: readonly AutoSyncControlOption[];
  readonly hourOptions: readonly AutoSyncControlOption[];
  readonly nightIntervalOptions: readonly AutoSyncControlOption[];
  readonly inactivityThresholdOptions: readonly AutoSyncControlOption[];
  readonly inactivityIntervalOptions: readonly AutoSyncControlOption[];
  readonly adaptiveControlsVisible: boolean;
  readonly nightDependentControlsVisible: boolean;
  readonly inactivityDependentControlsVisible: boolean;
};

export type AutoRunDropdown = {
  addOption(value: string, label: string): AutoRunDropdown;
  setValue(value: string): AutoRunDropdown;
  onChange(handler: (value: string) => void | Promise<void>): AutoRunDropdown;
};

export const configureAutoRunDropdown = (
  dropdown: AutoRunDropdown,
  model: AutoSyncSettingsControlModel,
  applyInterval: (intervalMs: number) => void | Promise<void>
): void => {
  for (const option of model.baseOptions) {
    dropdown.addOption(`${option.value}`, option.label);
  }
  dropdown
    .setValue(`${model.values.autoRunEveryMilliseconds}`)
    .onChange(async (value) => {
      await applyInterval(Number.parseInt(value));
    });
};

const minuteOptions = (
  minutesValues: readonly number[],
  labels: AutoSyncControlLabels
): readonly AutoSyncControlOption[] =>
  minutesValues.map((minutes) => ({
    value: minutes * 60_000,
    label: labels.minutes(minutes),
  }));

export const buildAutoSyncSettingsControlModel = (
  settings: AutoSyncSettingsInput,
  isDesktop: boolean,
  labels: AutoSyncControlLabels
): AutoSyncSettingsControlModel => {
  const values = normalizeAutoSyncSettings(settings);
  const baseOptions: AutoSyncControlOption[] = AUTO_RUN_INTERVAL_PRESETS_MS.map(
    (value) => ({
      value,
      label: value <= 0 ? labels.disabled : labels.minutes(value / 60_000),
    })
  );
  if (
    values.autoRunEveryMilliseconds > 0 &&
    !AUTO_RUN_INTERVAL_PRESETS_MS.some(
      (value) => value === values.autoRunEveryMilliseconds
    )
  ) {
    baseOptions.push({
      value: values.autoRunEveryMilliseconds,
      label: labels.legacy(values.autoRunEveryMilliseconds / 60_000),
      legacy: true,
    });
  }

  return {
    values,
    baseOptions,
    remoteListingTimeoutOptions: REMOTE_LISTING_TIMEOUT_PRESETS_MS.map(
      (value) => ({
        value,
        label: labels.minutes(value / 60_000),
      })
    ),
    hourOptions: Array.from({ length: 24 }, (_, hour) => ({
      value: hour * 60,
      label: labels.hour(hour),
    })),
    nightIntervalOptions: minuteOptions([60, 120, 240], labels),
    inactivityThresholdOptions: minuteOptions([15, 30, 60, 120], labels),
    inactivityIntervalOptions: minuteOptions([30, 60, 120, 240], labels),
    adaptiveControlsVisible: isDesktop,
    nightDependentControlsVisible: isDesktop && values.autoRunNightEnabled,
    inactivityDependentControlsVisible:
      isDesktop && values.autoRunInactivityEnabled,
  };
};

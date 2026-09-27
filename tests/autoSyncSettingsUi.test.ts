import { strict as assert } from "assert";
import {
  applyNormalizedSettingsReplacement,
  normalizeAutoSyncSettings,
} from "../src/autoSyncScheduler";
import { buildAutoSyncSettingsControlModel } from "../src/autoSyncSettingsControls";

const labels = {
  disabled: "disabled",
  minutes: (minutes: number) => `${minutes} minutes`,
  legacy: (minutes: number) => `legacy ${minutes} minutes`,
  hour: (hour: number) => `${hour.toString().padStart(2, "0")}:00`,
};

describe("Auto sync settings controls", () => {
  it("builds every approved base and listing choice with safe defaults", () => {
    const model = buildAutoSyncSettingsControlModel({}, true, labels);

    assert.deepEqual(
      model.baseOptions.map((option) => option.value),
      [
        -1, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000,
        14_400_000,
      ]
    );
    assert.deepEqual(
      model.remoteListingTimeoutOptions.map((option) => option.value),
      [120_000, 300_000, 600_000, 1_200_000, 1_800_000, 3_600_000]
    );
    assert.equal(model.values.remoteListingTimeoutMilliseconds, 600_000);
    assert.equal(model.values.autoRunNightStartMinute, 23 * 60);
    assert.equal(model.values.autoRunNightEndMinute, 7 * 60);
    assert.equal(model.values.autoRunNightIntervalMilliseconds, 7_200_000);
    assert.equal(
      model.values.autoRunInactivityThresholdMilliseconds,
      1_800_000
    );
    assert.equal(model.values.autoRunInactivityIntervalMilliseconds, 3_600_000);
    assert.equal(model.values.autoRunFailureBackoffEnabled, true);
  });

  it("adds a localized positive non-preset legacy value", () => {
    const model = buildAutoSyncSettingsControlModel(
      { autoRunEveryMilliseconds: 7 * 60_000 },
      true,
      labels
    );
    const legacy = model.baseOptions.find((option) => option.legacy);

    assert.deepEqual(legacy, {
      value: 420_000,
      label: "legacy 7 minutes",
      legacy: true,
    });
    assert.equal(model.values.autoRunEveryMilliseconds, 420_000);
  });

  it("derives desktop gating and dependent visibility from normalized values", () => {
    const enabled = {
      autoRunNightEnabled: true,
      autoRunInactivityEnabled: true,
    };
    const desktop = buildAutoSyncSettingsControlModel(enabled, true, labels);
    const mobile = buildAutoSyncSettingsControlModel(enabled, false, labels);
    const disabled = buildAutoSyncSettingsControlModel({}, true, labels);

    assert.equal(desktop.adaptiveControlsVisible, true);
    assert.equal(desktop.nightDependentControlsVisible, true);
    assert.equal(desktop.inactivityDependentControlsVisible, true);
    assert.equal(mobile.adaptiveControlsVisible, false);
    assert.equal(mobile.nightDependentControlsVisible, false);
    assert.equal(mobile.inactivityDependentControlsVisible, false);
    assert.equal(disabled.nightDependentControlsVisible, false);
    assert.equal(disabled.inactivityDependentControlsVisible, false);
  });

  it("normalizes equal night boundaries before controls reopen", () => {
    const model = buildAutoSyncSettingsControlModel(
      {
        autoRunNightEnabled: true,
        autoRunNightStartMinute: 60,
        autoRunNightEndMinute: 60,
      },
      true,
      labels
    );

    assert.equal(model.values.autoRunNightStartMinute, 23 * 60);
    assert.equal(model.values.autoRunNightEndMinute, 7 * 60);
    assert.equal(model.nightDependentControlsVisible, true);
  });

  it("persists and reschedules exactly once through the shared handler", async () => {
    const current = {
      password: "preserved",
      ...normalizeAutoSyncSettings({ autoRunEveryMilliseconds: 600_000 }),
    };
    let persisted = 0;
    let rescheduled = 0;

    const result = await applyNormalizedSettingsReplacement(
      current,
      {
        autoRunNightEnabled: true,
        autoRunNightStartMinute: 60,
        autoRunNightEndMinute: 60,
      },
      async () => {
        persisted += 1;
      },
      () => {
        rescheduled += 1;
      }
    );

    assert.equal(persisted, 1);
    assert.equal(rescheduled, 1);
    assert.equal(result.password, "preserved");
    assert.equal(result.autoRunNightStartMinute, 23 * 60);
    assert.equal(result.autoRunNightEndMinute, 7 * 60);
  });
});

import { strict as assert } from "assert";
import type { MixedEntity } from "../src/baseTypes";
import {
  applyTargetedPushChoice,
  getTargetedPushConflict,
  prepareTargetedSyncPlan,
  selectTargetedSyncPlan,
} from "../src/targetedSync";

const entry = (
  key: string,
  decision: MixedEntity["decision"]
): MixedEntity => ({ key, decision, change: true });

describe("targeted file push", () => {
  it("selects only the requested file and its parent folder operations", () => {
    const plan = {
      "projects/": entry(
        "projects/",
        "folder_existed_local_then_also_create_remote"
      ),
      "projects/notes/": entry(
        "projects/notes/",
        "folder_existed_local_then_also_create_remote"
      ),
      "projects/notes/selected.md": entry(
        "projects/notes/selected.md",
        "local_is_modified_then_push"
      ),
      "projects/notes/other.md": entry(
        "projects/notes/other.md",
        "local_is_modified_then_push"
      ),
    };

    const selected = selectTargetedSyncPlan(
      plan,
      "projects/notes/selected.md"
    );

    assert.deepEqual(Object.keys(selected).sort(), [
      "projects/",
      "projects/notes/",
      "projects/notes/selected.md",
    ]);
  });

  it("omits parent folders that require no cloud operation", () => {
    const plan = {
      "projects/": entry(
        "projects/",
        "folder_existed_both_then_do_nothing"
      ),
      "projects/selected.md": entry(
        "projects/selected.md",
        "local_is_modified_then_push"
      ),
    };

    assert.deepEqual(
      Object.keys(selectTargetedSyncPlan(plan, "projects/selected.md")),
      ["projects/selected.md"]
    );
  });

  it("reports a conflict when the newest-version plan would download", () => {
    const target = {
      ...entry("note.md", "remote_is_modified_then_pull"),
      local: { keyRaw: "note.md", sizeRaw: 1, mtimeCli: 100 },
      remote: { keyRaw: "note.md", sizeRaw: 1, mtimeCli: 200 },
    };

    assert.deepEqual(getTargetedPushConflict(target), {
      localMtime: 100,
      remoteMtime: 200,
      recommendedSide: "remote",
    });
  });

  it("does not interrupt a plan that already uploads the local file", () => {
    const target = entry("note.md", "local_is_modified_then_push");

    assert.equal(getTargetedPushConflict(target), undefined);
  });

  it("reports a conflict when both versions changed even if local is newer", () => {
    const target = {
      ...entry("note.md", "conflict_modified_then_keep_local"),
      local: { keyRaw: "note.md", sizeRaw: 1, mtimeCli: 300 },
      remote: { keyRaw: "note.md", sizeRaw: 1, mtimeCli: 200 },
    };

    assert.deepEqual(getTargetedPushConflict(target), {
      localMtime: 300,
      remoteMtime: 200,
      recommendedSide: "local",
    });
  });

  it("can force a conflicting target to upload the local file", () => {
    const target = entry("note.md", "conflict_modified_then_keep_remote");

    assert.equal(
      applyTargetedPushChoice(target, "force-local").decision,
      "conflict_modified_then_keep_local"
    );
  });

  it("cancels without applying any file operation", async () => {
    const plan = {
      "note.md": entry("note.md", "remote_is_modified_then_pull"),
    };

    const selected = await prepareTargetedSyncPlan(plan, {
      path: "note.md",
      resolveConflict: async () => "cancel",
    });

    assert.deepEqual(selected, {});
  });

  it("rejects a path excluded from the generated sync plan", async () => {
    await assert.rejects(
      prepareTargetedSyncPlan({}, {
        path: "ignored.md",
        resolveConflict: async () => "newest",
      }),
      /ignored\.md/
    );
  });
});

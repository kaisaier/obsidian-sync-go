import { strict as assert } from "assert";
import { rejects } from "assert";
import type { Entity, MixedEntity } from "../../src/baseTypes";
import type { FakeFs } from "../../src/fsAll";
import type { FakeFsEncrypt } from "../../src/fsEncrypt";
import type { InternalDBs } from "../../src/localdb";
import {
  checkIsSkipItemOrNotByName,
  dispatchOperationToActualV3,
  getSyncPlanInplace,
} from "../src/sync";

const entity = (key: string, mtime: number, size = 10): Entity => ({
  key,
  keyRaw: key,
  keyEnc: key,
  mtimeCli: mtime,
  mtimeSvr: mtime,
  size,
  sizeRaw: size,
  sizeEnc: size,
});

describe("Sync: core decision table", () => {
  const decide = async (entry: MixedEntity) => {
    (globalThis as any).window.moment = () => ({ format: () => "" });
    const result = await getSyncPlanInplace(
      { [entry.key]: entry },
      -1,
      "keep_newer",
      "bidirectional",
      undefined,
      { serviceType: "s3", password: "" } as never,
      "manual",
      ".obsidian"
    );
    return result[entry.key].decision;
  };

  it("covers the destructive and conflict branches", async () => {
    const previous = entity("note.md", 100);
    const cases: Array<[string, MixedEntity, string]> = [
      [
        "equal",
        {
          key: "note.md",
          local: entity("note.md", 100),
          remote: entity("note.md", 100),
          prevSync: previous,
        },
        "equal",
      ],
      [
        "local create",
        { key: "note.md", local: entity("note.md", 100) },
        "local_is_created_then_push",
      ],
      [
        "remote create",
        { key: "note.md", remote: entity("note.md", 100) },
        "remote_is_created_then_pull",
      ],
      [
        "local delete",
        { key: "note.md", remote: entity("note.md", 100), prevSync: previous },
        "local_is_deleted_thus_also_delete_remote",
      ],
      [
        "remote delete",
        { key: "note.md", local: entity("note.md", 100), prevSync: previous },
        "remote_is_deleted_thus_also_delete_local",
      ],
      [
        "both modify",
        {
          key: "note.md",
          local: entity("note.md", 300),
          remote: entity("note.md", 200),
          prevSync: previous,
        },
        "conflict_modified_then_keep_local",
      ],
    ];

    for (const [label, input, expected] of cases) {
      assert.equal(await decide(input), expected, label);
    }
  });
});

describe("Sync: per-item history transaction", () => {
  it("keeps previous sync history when a remote deletion fails", async () => {
    let historyRemovals = 0;
    const db = {
      prevSyncRecordsTbl: {
        removeItem: async () => {
          historyRemovals += 1;
        },
      },
    } as unknown as InternalDBs;
    const remote = {
      rm: async () => {
        throw new Error("remote delete failed");
      },
    } as unknown as FakeFsEncrypt;

    await rejects(
      dispatchOperationToActualV3(
        "note.md",
        "vault",
        "profile",
        {
          key: "note.md",
          decision: "local_is_deleted_thus_also_delete_remote",
        },
        {} as FakeFs,
        remote,
        db,
        "keep_newer"
      ),
      /remote delete failed/
    );
    assert.equal(historyRemovals, 0);
  });

  it("clears previous sync history only after remote deletion succeeds", async () => {
    let historyRemovals = 0;
    const db = {
      prevSyncRecordsTbl: {
        removeItem: async () => {
          historyRemovals += 1;
        },
      },
    } as unknown as InternalDBs;
    const remote = { rm: async () => undefined } as unknown as FakeFsEncrypt;

    await dispatchOperationToActualV3(
      "note.md",
      "vault",
      "profile",
      {
        key: "note.md",
        decision: "local_is_deleted_thus_also_delete_remote",
      },
      {} as FakeFs,
      remote,
      db,
      "keep_newer"
    );
    assert.equal(historyRemovals, 1);
  });
});

describe("Sync: checkIsSkipItemOrNotByName", () => {
  it("should be ok everywhere for empty config", async () => {
    let isSkip = checkIsSkipItemOrNotByName(
      "xxx.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ [],
      /* onlyAllowPaths */ []
    ).finalIsIgnored;
    assert.ok(!isSkip);

    isSkip = checkIsSkipItemOrNotByName(
      "xxx.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ [""],
      /* onlyAllowPaths */ ["", "\n"]
    ).finalIsIgnored;
    assert.ok(!isSkip);
  });

  it("should be ok for deny list", async () => {
    let isSkip = checkIsSkipItemOrNotByName(
      "xxx.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ ["xxx"],
      /* onlyAllowPaths */ []
    ).finalIsIgnored;
    assert.ok(isSkip);

    isSkip = checkIsSkipItemOrNotByName(
      "yyy.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ ["xxx"],
      /* onlyAllowPaths */ []
    ).finalIsIgnored;
    assert.ok(!isSkip);

    isSkip = checkIsSkipItemOrNotByName(
      "xxx.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ ["xxx$"],
      /* onlyAllowPaths */ []
    ).finalIsIgnored;
    assert.ok(!isSkip);

    // if we deny a folder, we have to deny all the sub files
    // TODO: it's soooo hard to do the path resolution in this func with regex,
    //       so we defer the detection to later steps now.
    //       the test here doesn't work.
    // isSkip = checkIsSkipItemOrNotByName(
    //   'xxx/yyy.md',
    //   false,
    //   false,
    //   false,
    //   '.obsidian',
    //   /*    ignorePaths */ ['xxx/$'],
    //   /* onlyAllowPaths */ []
    // ).finalIsIgnored;
    // assert.ok(isSkip);
  });

  it("should be ok for allow list", async () => {
    let isSkip = checkIsSkipItemOrNotByName(
      "xxx.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ [],
      /* onlyAllowPaths */ ["xxx"]
    ).finalIsIgnored;
    assert.ok(!isSkip);

    isSkip = checkIsSkipItemOrNotByName(
      "yyy.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ [""],
      /* onlyAllowPaths */ ["xxx"]
    ).finalIsIgnored;
    assert.ok(isSkip);

    isSkip = checkIsSkipItemOrNotByName(
      "xxx.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ [],
      /* onlyAllowPaths */ ["xxx$"]
    ).finalIsIgnored;
    assert.ok(isSkip);

    // should NOT skip because we allow the sub file AND not deny the folder
    // TODO: it's soooo hard to do the path resolution in this func with regex,
    //       so we defer the detection to later steps now.
    //       the test here doesn't work.
    // isSkip = checkIsSkipItemOrNotByName(
    //   'xxx/',
    //   false,
    //   false,
    //   false,
    //   '.obsidian',
    //   /*    ignorePaths */ [],
    //   /* onlyAllowPaths */ ['xxx/yyy.md']
    // ).finalIsIgnored;
    // assert.ok(!isSkip);
  });

  it("should detect the name by two lists together", async () => {
    // should skip because we ignore the path
    let isSkip = checkIsSkipItemOrNotByName(
      "xxx.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ ["xxx"],
      /* onlyAllowPaths */ ["yyy"]
    ).finalIsIgnored;
    assert.ok(isSkip);

    // should skip because we disallow the whole folder
    isSkip = checkIsSkipItemOrNotByName(
      "xxx/yyy.md",
      false,
      false,
      false,
      ".obsidian",
      /*    ignorePaths */ ["xxx"],
      /* onlyAllowPaths */ ["xxx/yyy.md"]
    ).finalIsIgnored;
    assert.ok(isSkip);
  });
});

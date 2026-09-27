import { strict as assert } from "assert";
import type { TransItemType } from "../src/i18n";
import type { SyncLogRecord } from "../src/localdb";
import { buildSyncLogRun } from "../src/syncLogData";

const translate = (key: TransItemType): string => key;

describe("sync log run adapter", () => {
  it("converts one persisted run into Fast Note rows and a summary", () => {
    const record: SyncLogRecord = {
      id: "run-1",
      ts: 1_000,
      tsFmt: "2026-09-13 12:34:56",
      vaultRandomID: "vault",
      remoteType: "s3",
      triggerSource: "manual",
      success: true,
      summary: "Sync completed",
      lines: [
        "[12:34:56] SYNC 0/2 | local_is_modified_then_push | notes/a.md",
        "[12:34:57] SYNC 1/2 | remote_is_created_then_pull | assets/a.png",
      ],
    };

    const run = buildSyncLogRun(record, translate, false);

    assert.equal(run.status, "success");
    assert.equal(run.timeText, "12:34:56");
    assert.deepEqual(
      run.items.map(({ category, direction }) => ({ category, direction })),
      [
        { category: "note", direction: "send" },
        { category: "attachment", direction: "receive" },
      ]
    );
    assert.deepEqual(run.summary.note, {
      upload: 1,
      download: 0,
      delete: 0,
    });
  });

  it("marks live rows pending", () => {
    const record: SyncLogRecord = {
      id: "live",
      ts: 1_000,
      tsFmt: "12:34:56",
      vaultRandomID: "vault",
      remoteType: "s3",
      triggerSource: "manual",
      success: true,
      summary: "Syncing",
      lines: ["SYNC 0/1 | local_is_created_then_push | note.md"],
    };

    assert.equal(buildSyncLogRun(record, translate, true).items[0]?.status, "pending");
  });

  it("does not mark completed operations as failed when their run later fails", () => {
    const record: SyncLogRecord = {
      id: "partial-failure",
      ts: 1_000,
      tsFmt: "12:34:56",
      vaultRandomID: "vault",
      remoteType: "s3",
      triggerSource: "manual",
      success: false,
      summary: "Sync failed after one completed operation",
      lines: [
        "SYNC 1/2 | local_is_created_then_push | note.md",
        "ERROR: WebDAV request timed out",
      ],
    };

    const run = buildSyncLogRun(record, translate, false);
    assert.equal(run.status, "error");
    assert.equal(run.items[0]?.status, "success");
    assert.equal(run.items[0]?.message, "");
    assert.equal(run.message, "WebDAV request timed out");
  });

  it("keeps a useful failure detail when no operation completed", () => {
    const record: SyncLogRecord = {
      id: "early-failure", ts: 1_000, tsFmt: "12:34:56",
      vaultRandomID: "vault", remoteType: "webdav", triggerSource: "manual",
      success: false, summary: "Sync failed",
      lines: ["ERROR: Authentication failed"],
    };
    const run = buildSyncLogRun(record, translate, false);
    assert.equal(run.items.length, 0);
    assert.equal(run.status, "error");
    assert.equal(run.message, "Authentication failed");
  });
});

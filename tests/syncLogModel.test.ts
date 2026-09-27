import { strict as assert } from "assert";
import {
  DEFAULT_SYNC_LOG_FILTERS,
  buildSyncLogSummary,
  classifySyncLogPath,
  filterSyncLogItems,
  mapSyncDecision,
  type SyncLogItem,
} from "../src/syncLogModel";

const item = (
  overrides: Partial<SyncLogItem> = {}
): SyncLogItem => ({
  id: "1",
  timestamp: 100,
  timeText: "12:00:00",
  title: "笔记修改",
  path: "notes/a.md",
  category: "note",
  direction: "send",
  action: "update",
  status: "success",
  message: "",
  decision: "local_is_modified_then_push",
  ...overrides,
});

describe("sync log Fast Note adapter", () => {
  it("classifies paths using Fast Note categories", () => {
    assert.equal(classifySyncLogPath("notes/a.md", false), "note");
    assert.equal(classifySyncLogPath("assets/a.png", false), "attachment");
    assert.equal(classifySyncLogPath(".obsidian/plugins/x/data.json", false), "config");
    assert.equal(classifySyncLogPath("archive/data.bin", false), "other");
    assert.equal(classifySyncLogPath("notes/", true), "folder");
  });

  it("maps upload, download, delete, and conflict decisions", () => {
    assert.deepEqual(mapSyncDecision("local_is_created_then_push"), {
      action: "create",
      direction: "send",
      titleKey: "sync_log_title_create",
    });
    assert.deepEqual(mapSyncDecision("remote_is_modified_then_pull"), {
      action: "update",
      direction: "receive",
      titleKey: "sync_log_title_update",
    });
    assert.deepEqual(
      mapSyncDecision("local_is_deleted_thus_also_delete_remote"),
      {
        action: "delete",
        direction: "send",
        titleKey: "sync_log_title_delete",
      }
    );
    assert.deepEqual(
      mapSyncDecision("conflict_modified_then_smart_conflict"),
      {
        action: "conflict",
        direction: "both",
        titleKey: "sync_log_title_conflict",
      }
    );
    assert.equal(
      mapSyncDecision("folder_to_be_deleted_on_remote").direction,
      "send"
    );
    assert.equal(
      mapSyncDecision("folder_to_be_deleted_on_local").direction,
      "receive"
    );
    assert.equal(
      mapSyncDecision("folder_to_be_deleted_on_both").direction,
      "both"
    );
    assert.equal(
      mapSyncDecision("folder_existed_local_then_also_create_remote").direction,
      "send"
    );
    assert.equal(
      mapSyncDecision("folder_existed_remote_then_also_create_local").direction,
      "receive"
    );
    assert.equal(mapSyncDecision("folder_to_be_created").direction, "send");
  });

  it("combines category, direction, and failed-only filters", () => {
    const items = [
      item(),
      item({ id: "2", category: "attachment", status: "error" }),
      item({ id: "3", direction: "receive", status: "error" }),
    ];

    assert.deepEqual(
      filterSyncLogItems(items, {
        category: "note",
        direction: "receive",
        failedOnly: true,
      }).map((value) => value.id),
      ["3"]
    );
    assert.equal(filterSyncLogItems(items, DEFAULT_SYNC_LOG_FILTERS).length, 3);
  });

  it("builds the compact run summary counts", () => {
    const summary = buildSyncLogSummary([
      item(),
      item({ id: "2", category: "note", action: "delete" }),
      item({ id: "3", category: "attachment", direction: "receive" }),
      item({ id: "4", category: "config", action: "update" }),
    ]);

    assert.deepEqual(summary.note, { upload: 1, download: 0, delete: 1 });
    assert.deepEqual(summary.attachment, {
      upload: 0,
      download: 1,
      delete: 0,
    });
    assert.deepEqual(summary.config, { upload: 1, download: 0, delete: 0 });
  });
});

import type { TransItemType } from "./i18n";

export type SyncLogCategory =
  | "note"
  | "attachment"
  | "folder"
  | "config"
  | "other";
export type SyncLogDirection = "send" | "receive" | "both" | "neutral";
export type SyncLogAction =
  | "create"
  | "update"
  | "delete"
  | "conflict"
  | "folder"
  | "sync";
export type SyncLogStatus = "pending" | "success" | "error";

export type SyncLogItem = {
  readonly id: string;
  readonly timestamp: number;
  readonly timeText: string;
  readonly title: string;
  readonly path: string;
  readonly category: SyncLogCategory;
  readonly direction: SyncLogDirection;
  readonly action: SyncLogAction;
  readonly status: SyncLogStatus;
  readonly message: string;
  readonly decision: string;
};

export type SyncLogFilters = {
  readonly category: SyncLogCategory | "all";
  readonly direction: "send" | "receive" | "all";
  readonly failedOnly: boolean;
};

export type SyncLogDecisionDisplay = {
  readonly action: SyncLogAction;
  readonly direction: SyncLogDirection;
  readonly titleKey: TransItemType;
};

type SummaryCounts = {
  readonly upload: number;
  readonly download: number;
  readonly delete: number;
};

export type SyncLogSummary = Readonly<
  Record<SyncLogCategory, SummaryCounts>
>;

export const DEFAULT_SYNC_LOG_FILTERS: SyncLogFilters = {
  category: "all",
  direction: "all",
  failedOnly: false,
};

const ATTACHMENT_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "pdf",
  "mp3",
  "wav",
  "m4a",
  "mp4",
  "mov",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
]);

export const classifySyncLogPath = (
  path: string,
  isFolder: boolean
): SyncLogCategory => {
  if (isFolder || path.endsWith("/")) return "folder";
  if (path === ".obsidian" || path.startsWith(".obsidian/")) return "config";
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "md" || extension === "canvas") return "note";
  if (extension !== undefined && ATTACHMENT_EXTENSIONS.has(extension)) {
    return "attachment";
  }
  return "other";
};

export const mapSyncDecision = (decision: string): SyncLogDecisionDisplay => {
  const isFolder = decision.includes("folder");
  const isDelete = decision.includes("deleted") || decision.includes("delete");
  const isConflict = decision.includes("conflict");
  const direction: SyncLogDirection = decision.includes("deleted_on_both")
    ? "both"
    : decision.includes("smart_conflict")
    ? "both"
    : decision.includes("push") ||
        decision === "folder_to_be_created" ||
        decision.includes("keep_local") ||
        decision.includes("delete_remote") ||
        decision.includes("deleted_on_remote") ||
        decision.includes("create_remote")
      ? "send"
      : decision.includes("pull") ||
          decision.includes("keep_remote") ||
          decision.includes("delete_local") ||
          decision.includes("deleted_on_local") ||
          decision.includes("create_local")
        ? "receive"
        : "neutral";

  if (isConflict) {
    return { action: "conflict", direction, titleKey: "sync_log_title_conflict" };
  }
  if (isFolder) {
    return {
      action: "folder",
      direction,
      titleKey: isDelete
        ? "sync_log_title_folder_delete"
        : decision.includes("create")
          ? "sync_log_title_folder_create"
          : "sync_log_title_folder",
    };
  }
  if (isDelete) {
    return { action: "delete", direction, titleKey: "sync_log_title_delete" };
  }
  if (decision.includes("created")) {
    return { action: "create", direction, titleKey: "sync_log_title_create" };
  }
  return { action: "update", direction, titleKey: "sync_log_title_update" };
};

export const filterSyncLogItems = (
  items: readonly SyncLogItem[],
  filters: SyncLogFilters
): readonly SyncLogItem[] =>
  items.filter(
    (item) =>
      (filters.category === "all" || item.category === filters.category) &&
      (filters.direction === "all" || item.direction === filters.direction) &&
      (!filters.failedOnly || item.status === "error")
  );

const emptyCounts = (): SummaryCounts => ({ upload: 0, download: 0, delete: 0 });

export const buildSyncLogSummary = (
  items: readonly SyncLogItem[]
): SyncLogSummary => {
  const mutable: Record<SyncLogCategory, { upload: number; download: number; delete: number }> = {
    note: emptyCounts(),
    attachment: emptyCounts(),
    folder: emptyCounts(),
    config: emptyCounts(),
    other: emptyCounts(),
  };
  for (const item of items) {
    const counts = mutable[item.category];
    if (item.action === "delete") counts.delete += 1;
    else if (item.direction === "receive") counts.download += 1;
    else counts.upload += 1;
  }
  return mutable;
};

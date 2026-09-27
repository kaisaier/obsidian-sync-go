import { Notice, TFile, setIcon } from "obsidian";
import { copyTextToClipboard } from "./clipboard";
import type { TransItemType } from "./i18n";
import type RemotelySavePlugin from "./main";
import type { SyncLogRun } from "./syncLogData";
import type {
  SyncLogCategory,
  SyncLogDirection,
  SyncLogFilters,
  SyncLogItem,
} from "./syncLogModel";

export type Translate = (
  key: TransItemType,
  vars?: Record<string, string>
) => string;

const iconButton = (
  parent: HTMLElement,
  icon: string,
  label: string,
  onClick: (event: MouseEvent) => void,
  active = false
): HTMLButtonElement => {
  const button = parent.createEl("button", {
    cls: `sync-go-log-icon-btn clickable-icon${active ? " is-active" : ""}`,
    attr: { "aria-label": label, title: label },
  });
  setIcon(button, icon);
  button.onclick = onClick;
  return button;
};

const categoryLabels: ReadonlyArray<
  readonly [SyncLogCategory | "all", TransItemType]
> = [
  ["all", "sync_log_filter_all"],
  ["note", "sync_log_category_note"],
  ["attachment", "sync_log_category_attachment"],
  ["folder", "sync_log_category_folder"],
  ["config", "sync_log_category_config"],
  ["other", "sync_log_category_other"],
];

const directionLabels: ReadonlyArray<
  readonly ["all" | "send" | "receive", TransItemType]
> = [
  ["all", "sync_log_filter_all"],
  ["send", "sync_log_send"],
  ["receive", "sync_log_receive"],
];

const summaryCategoryLabels: ReadonlyArray<
  readonly [SyncLogCategory, TransItemType]
> = categoryLabels.slice(1).flatMap(([category, label]) =>
  category === "all" ? [] : [[category, label]]
);

const filterChips = <T extends string>(
  parent: HTMLElement,
  options: ReadonlyArray<readonly [T, TransItemType]>,
  current: T,
  translate: Translate,
  onSelect: (value: T) => void
): void => {
  const chips = parent.createDiv("filter-chips");
  for (const [value, labelKey] of options) {
    const chip = chips.createEl("button", {
      cls: `filter-chip${current === value ? " is-active" : ""}`,
      text: translate(labelKey),
    });
    if (value !== "all") {
      chip.prepend(createSpan({ cls: `sync-go-dot sync-go-dot-${value}` }));
    }
    chip.onclick = () => onSelect(value);
  }
};

export const renderFilterPanel = (
  parent: HTMLElement,
  filters: SyncLogFilters,
  translate: Translate,
  update: (filters: SyncLogFilters) => void,
  close: () => void
): void => {
  const panel = parent.createDiv("sync-go-log-filter-panel");
  const category = panel.createDiv("filter-group");
  category.createDiv({
    cls: "filter-label",
    text: translate("sync_log_filter_category"),
  });
  filterChips(category, categoryLabels, filters.category, translate, (value) =>
    update({ ...filters, category: value })
  );

  const direction = panel.createDiv("filter-group");
  direction.createDiv({
    cls: "filter-label",
    text: translate("sync_log_filter_direction"),
  });
  filterChips(direction, directionLabels, filters.direction, translate, (value) =>
    update({ ...filters, direction: value })
  );
  const failedGroup = panel.createDiv("filter-group");
  const failed = failedGroup.createEl("button", {
    cls: `filter-chip${filters.failedOnly ? " is-active" : ""}`,
    text: translate("sync_log_filter_only_failed"),
  });
  failed.onclick = () => update({ ...filters, failedOnly: !filters.failedOnly });

  const footer = panel.createDiv("filter-footer");
  const reset = footer.createEl("button", {
    cls: "filter-reset-btn",
    text: translate("sync_log_filter_reset"),
  });
  reset.onclick = () =>
    update({ category: "all", direction: "all", failedOnly: false });
  const collapse = footer.createEl("button", {
    cls: "filter-close-btn",
    text: translate("sync_log_filter_collapse"),
  });
  collapse.onclick = close;
};

const directionText = (direction: SyncLogDirection, t: Translate): string => {
  if (direction === "send") return t("sync_log_send");
  if (direction === "receive") return t("sync_log_receive");
  if (direction === "both") return t("sync_log_both");
  return t("sync_log_neutral");
};

export const renderLogItem = (
  parent: HTMLElement,
  item: SyncLogItem,
  plugin: RemotelySavePlugin,
  translate: Translate
): void => {
  const row = parent.createDiv(
    `sync-go-log-item sync-go-log-category-${item.category} sync-go-log-status-${item.status} sync-go-log-type-${item.direction}`
  );
  const header = row.createDiv("sync-go-log-item-header");
  header.createSpan({ cls: "sync-go-log-time", text: item.timeText });
  header.createSpan({ cls: "sync-go-log-action", text: item.title });
  const type = header.createSpan({
    cls: "sync-go-log-type-tag",
    text: directionText(item.direction, translate),
  });
  if (item.direction === "send") setIcon(type, "arrow-up");
  if (item.direction === "receive") setIcon(type, "arrow-down");
  if (item.direction === "both") setIcon(type, "arrow-up-down");
  const right = header.createDiv("sync-go-log-header-right");
  right.createSpan({
    cls: `sync-go-log-status-tag status-${item.status}`,
    text: item.status === "success" ? "✓" : item.status === "error" ? "✕" : "…",
  });

  if (item.path !== "") {
    const path = row.createDiv("sync-go-log-path is-clickable");
    path.createSpan({ text: item.path });
    const copy = path.createEl("button", {
      cls: "sync-go-path-action",
      attr: { "aria-label": translate("sync_log_copy") },
    });
    setIcon(copy, "copy");
    copy.onclick = async (event) => {
      event.stopPropagation();
      await copyTextToClipboard(item.path);
      new Notice(translate("sync_log_path_copied"));
    };
    const file = plugin.app.vault.getAbstractFileByPath(item.path);
    if (file instanceof TFile) {
      const open = path.createEl("button", {
        cls: "sync-go-path-action",
        attr: { "aria-label": translate("sync_log_open") },
      });
      setIcon(open, "external-link");
      open.onclick = async (event) => {
        event.stopPropagation();
        await plugin.app.workspace.getLeaf("tab").openFile(file);
      };
      path.onclick = async () => await plugin.app.workspace.getLeaf("tab").openFile(file);
    }
  }
  if (item.message !== "" && item.message.toLowerCase() !== "success") {
    row.createDiv({ cls: "sync-go-log-message", text: item.message });
  }
};

const hasCounts = (run: SyncLogRun): boolean =>
  Object.values(run.summary).some(
    (counts) => counts.upload + counts.download + counts.delete > 0
  );

export const renderSummary = (
  parent: HTMLElement,
  run: SyncLogRun,
  translate: Translate
): void => {
  const changed = hasCounts(run);
  const card = parent.createDiv(
    `sync-go-summary-card${changed ? "" : " no-changes-card"}${run.status === "error" ? " is-error-card" : ""}`
  );
  const header = card.createDiv(`sync-go-summary-header${changed ? " has-border" : ""}`);
  const title = header.createDiv("sync-go-summary-title");
  setIcon(title, run.status === "pending" ? "loader-circle" : run.status === "error" ? "x-circle" : "check-circle-2");
  title.createSpan({
    text: translate(
      run.status === "pending"
        ? "sync_log_summary_live"
        : run.status === "error"
          ? "sync_log_summary_error"
          : "sync_log_summary_run"
    ),
  });
  if (!changed) {
    title.createSpan({
      cls: "sync-go-summary-empty-inline",
      text: `(${translate("sync_log_summary_no_changes")})`,
    });
  }
  const meta = header.createDiv("sync-go-summary-meta");
  meta.createSpan({ cls: "sync-go-summary-type-tag", text: run.triggerSource });
  meta.createSpan({ text: run.timeText });
  if (run.status === "error" && run.message !== "") {
    card.createDiv({ cls: "sync-go-summary-error-message", text: run.message });
  }
  if (!changed) return;

  const rows = card.createDiv("sync-go-summary-rows");
  for (const [category, labelKey] of summaryCategoryLabels) {
    const counts = run.summary[category];
    if (counts.upload + counts.download + counts.delete === 0) continue;
    const row = rows.createDiv("sync-go-summary-row");
    const label = row.createDiv("sync-go-summary-label");
    label.createSpan({ cls: `sync-go-summary-dot sync-go-dot-${category}` });
    label.createSpan({ text: translate(labelKey) });
    const badges = row.createDiv("sync-go-summary-badges");
    if (counts.upload > 0) badges.createSpan({ cls: "summary-badge badge-upload", text: `↑${counts.upload}` });
    if (counts.download > 0) badges.createSpan({ cls: "summary-badge badge-download", text: `↓${counts.download}` });
    if (counts.delete > 0) badges.createSpan({ cls: "summary-badge badge-delete", text: `✕${counts.delete}` });
  }
};

export const renderHeaderActions = (
  parent: HTMLElement,
  translate: Translate,
  callbacks: {
    readonly settings: () => void;
    readonly filter: (event: MouseEvent) => void;
    readonly clear: () => void;
  },
  filterActive: boolean
): void => {
  iconButton(parent, "settings", translate("sync_log_settings"), callbacks.settings);
  iconButton(parent, "filter", translate("sync_log_filter"), callbacks.filter, filterActive);
  iconButton(parent, "brush-cleaning", translate("sync_log_clear"), callbacks.clear);
};

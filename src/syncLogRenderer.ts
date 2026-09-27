import { Menu, Notice, Platform, setIcon } from "obsidian";
import {
  clearAllLoggerOutputRecords,
  readAllSyncLogRecordsByVault,
  type SyncLogRecord,
} from "./localdb";
import type RemotelySavePlugin from "./main";
import {
  renderFilterPanel,
  renderHeaderActions,
  renderLogItem,
  renderSummary,
} from "./syncLogComponents";
import { buildSyncLogRuns, type SyncLogRun } from "./syncLogData";
import {
  DEFAULT_SYNC_LOG_FILTERS,
  filterSyncLogItems,
  type SyncLogFilters,
  type SyncLogItem,
} from "./syncLogModel";

type RenderEntry =
  | { readonly kind: "summary"; readonly run: SyncLogRun }
  | { readonly kind: "item"; readonly item: SyncLogItem };

export class SyncLogRenderer {
  private page = 1;
  private readonly pageSize = 20;
  private filters: SyncLogFilters = DEFAULT_SYNC_LOG_FILTERS;
  private filterOpen = false;

  constructor(private readonly plugin: RemotelySavePlugin) {}

  async render(container: HTMLElement, refresh: () => Promise<void>): Promise<void> {
    container.empty();
    const records = await readAllSyncLogRecordsByVault(
      this.plugin.db,
      this.plugin.vaultRandomID
    );
    const runs = buildSyncLogRuns(
      records,
      this.plugin.i18n.t.bind(this.plugin.i18n),
      this.getLiveRecord()
    );
    const entries = this.buildEntries(runs);
    const maxPage = Math.max(1, Math.ceil(entries.length / this.pageSize));
    this.page = Math.min(Math.max(1, this.page), maxPage);

    const shell = container.createDiv("sync-go-log-container");
    this.renderHeader(shell, refresh);
    if (Platform.isMobile && this.filterOpen) {
      renderFilterPanel(
        shell,
        this.filters,
        this.plugin.i18n.t.bind(this.plugin.i18n),
        (filters) => {
          this.filters = filters;
          this.page = 1;
          void refresh();
        },
        () => {
          this.filterOpen = false;
          void refresh();
        }
      );
    }
    const list = shell.createDiv("sync-go-log-list");
    const pageEntries = entries.slice(
      (this.page - 1) * this.pageSize,
      this.page * this.pageSize
    );
    if (pageEntries.length === 0) {
      list.createDiv({
        cls: "sync-go-log-empty",
        text: this.plugin.i18n.t("sync_log_empty"),
      });
    }
    for (const entry of pageEntries) {
      if (entry.kind === "summary") {
        renderSummary(list, entry.run, this.plugin.i18n.t.bind(this.plugin.i18n));
      } else {
        renderLogItem(
          list,
          entry.item,
          this.plugin,
          this.plugin.i18n.t.bind(this.plugin.i18n)
        );
      }
    }
    if (maxPage > 1) this.renderPager(shell, maxPage, refresh);
  }

  private renderHeader(parent: HTMLElement, refresh: () => Promise<void>): void {
    const header = parent.createDiv("sync-go-log-header");
    const title = header.createDiv("sync-go-log-title-group");
    title.createEl("h3", { text: this.plugin.i18n.t("sync_log_title") });
    const status = title.createDiv({
      cls: `sync-go-log-live-status${this.plugin.isSyncing ? " is-active" : ""}`,
      attr: { "aria-label": this.getStatusText(), title: this.getStatusText() },
    });
    setIcon(status, this.plugin.isSyncing ? "loader-circle" : "wifi");
    status.createSpan({ text: this.getStatusText() });

    const actions = header.createDiv("sync-go-log-header-actions");
    renderHeaderActions(
      actions,
      this.plugin.i18n.t.bind(this.plugin.i18n),
      {
        settings: () => {
          this.plugin.app.setting.open();
          this.plugin.app.setting.openTabById(this.plugin.manifest.id);
        },
        filter: (event) => {
          if (Platform.isMobile) {
            this.filterOpen = !this.filterOpen;
            void refresh();
          } else {
            this.showFilterMenu(event, refresh);
          }
        },
        clear: () => {
          void clearAllLoggerOutputRecords(this.plugin.db).then(async () => {
            this.page = 1;
            new Notice(this.plugin.i18n.t("sync_log_cleared"));
            await refresh();
          });
        },
      },
      this.isFilterActive()
    );
  }

  private showFilterMenu(event: MouseEvent, refresh: () => Promise<void>): void {
    const menu = new Menu();
    const addChoice = <K extends "category" | "direction">(
      field: K,
      value: SyncLogFilters[K],
      title: string
    ): void => {
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setChecked(this.filters[field] === value)
          .onClick(() => {
            this.filters = { ...this.filters, [field]: value };
            this.page = 1;
            void refresh();
          })
      );
    };
    menu.addItem((item) => item.setTitle(this.plugin.i18n.t("sync_log_filter_category")).setIsLabel(true));
    addChoice("category", "all", this.plugin.i18n.t("sync_log_filter_all"));
    addChoice("category", "note", this.plugin.i18n.t("sync_log_category_note"));
    addChoice("category", "attachment", this.plugin.i18n.t("sync_log_category_attachment"));
    addChoice("category", "folder", this.plugin.i18n.t("sync_log_category_folder"));
    addChoice("category", "config", this.plugin.i18n.t("sync_log_category_config"));
    addChoice("category", "other", this.plugin.i18n.t("sync_log_category_other"));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle(this.plugin.i18n.t("sync_log_filter_direction")).setIsLabel(true));
    addChoice("direction", "all", this.plugin.i18n.t("sync_log_filter_all"));
    addChoice("direction", "send", this.plugin.i18n.t("sync_log_send"));
    addChoice("direction", "receive", this.plugin.i18n.t("sync_log_receive"));
    menu.addSeparator();
    menu.addItem((item) =>
      item
        .setTitle(this.plugin.i18n.t("sync_log_filter_only_failed"))
        .setChecked(this.filters.failedOnly)
        .onClick(() => {
          this.filters = { ...this.filters, failedOnly: !this.filters.failedOnly };
          this.page = 1;
          void refresh();
        })
    );
    menu.addItem((item) =>
      item.setTitle(this.plugin.i18n.t("sync_log_filter_reset")).onClick(() => {
        this.filters = DEFAULT_SYNC_LOG_FILTERS;
        this.page = 1;
        void refresh();
      })
    );
    menu.showAtMouseEvent(event);
  }

  private buildEntries(runs: readonly SyncLogRun[]): readonly RenderEntry[] {
    return runs.flatMap((run) => {
      const filtered = filterSyncLogItems(run.items, this.filters);
      const showSummary =
        this.filters.category === "all" &&
        this.filters.direction === "all" &&
        (!this.filters.failedOnly || run.status === "error");
      const items: RenderEntry[] = filtered.map((item) => ({ kind: "item", item }));
      return showSummary ? [{ kind: "summary", run }, ...items] : items;
    });
  }

  private renderPager(
    parent: HTMLElement,
    maxPage: number,
    refresh: () => Promise<void>
  ): void {
    const pager = parent.createDiv("sync-go-log-pagination");
    this.pageButton(pager, "chevrons-left", this.page === 1, () => 1, refresh);
    this.pageButton(pager, "chevron-left", this.page === 1, () => this.page - 1, refresh);
    const info = pager.createDiv("pagination-info");
    info.createSpan({ cls: "page-current", text: String(this.page) });
    info.createSpan({ cls: "page-separator", text: "/" });
    info.createSpan({ cls: "page-total", text: String(maxPage) });
    this.pageButton(pager, "chevron-right", this.page === maxPage, () => this.page + 1, refresh);
    this.pageButton(pager, "chevrons-right", this.page === maxPage, () => maxPage, refresh);
  }

  private pageButton(
    parent: HTMLElement,
    icon: string,
    disabled: boolean,
    nextPage: () => number,
    refresh: () => Promise<void>
  ): void {
    const button = parent.createEl("button", { cls: "pagination-btn clickable-icon" });
    button.disabled = disabled;
    setIcon(button, icon);
    button.onclick = () => {
      this.page = nextPage();
      void refresh();
    };
  }

  private isFilterActive(): boolean {
    return (
      this.filterOpen ||
      this.filters.category !== "all" ||
      this.filters.direction !== "all" ||
      this.filters.failedOnly
    );
  }

  private getStatusText(): string {
    return this.plugin.isSyncing
      ? this.plugin.currSyncStatusText ?? this.plugin.i18n.t("sync_log_status_syncing")
      : this.plugin.i18n.t("sync_log_status_idle");
  }

  private getLiveRecord(): SyncLogRecord | undefined {
    if (!this.plugin.isSyncing || this.plugin.currSyncLogLines.length === 0) return undefined;
    const timestamp = this.plugin.currSyncLogStartTs ?? Date.now();
    return {
      id: "live-sync",
      ts: timestamp,
      tsFmt: new Date(timestamp).toLocaleString(),
      vaultRandomID: this.plugin.vaultRandomID,
      remoteType: this.plugin.settings.serviceType,
      triggerSource: "manual",
      success: true,
      summary: this.getStatusText(),
      lines: this.plugin.currSyncLogLines.slice(),
    };
  }
}

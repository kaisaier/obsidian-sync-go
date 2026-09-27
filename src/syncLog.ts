import { ItemView, Modal, WorkspaceLeaf } from "obsidian";
import type RemotelySavePlugin from "./main";
import { SyncLogRenderer } from "./syncLogRenderer";

export const SYNC_LOG_VIEW_TYPE = "obsidian-sync-go-sync-log";

export class SyncLogModal extends Modal {
  private readonly renderer: SyncLogRenderer;
  private refreshHandler?: () => void;
  private refreshTimer?: number;

  constructor(private readonly plugin: RemotelySavePlugin) {
    super(plugin.app);
    this.renderer = new SyncLogRenderer(plugin);
  }

  async onOpen(): Promise<void> {
    this.modalEl.addClass("sync-go-log-modal");
    if (this.refreshHandler === undefined) {
      this.refreshHandler = () => {
        if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => {
          this.refreshTimer = undefined;
          void this.render();
        }, 100);
      };
      this.plugin.syncEvent?.on("SYNC_LOG_REFRESH", this.refreshHandler);
    }
    await this.render();
  }

  onClose(): void {
    if (this.refreshHandler !== undefined) {
      this.plugin.syncEvent?.off("SYNC_LOG_REFRESH", this.refreshHandler);
      this.refreshHandler = undefined;
    }
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
    this.contentEl.empty();
    this.modalEl.removeClass("sync-go-log-modal");
  }

  private async render(): Promise<void> {
    await this.renderer.render(this.contentEl, async () => await this.render());
  }
}

export class SyncLogView extends ItemView {
  private readonly renderer: SyncLogRenderer;
  private refreshHandler?: () => void;
  private refreshTimer?: number;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: RemotelySavePlugin) {
    super(leaf);
    this.renderer = new SyncLogRenderer(plugin);
  }

  getViewType(): string {
    return SYNC_LOG_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.plugin.i18n.t("sync_log_title");
  }

  getIcon(): string {
    return "arrow-down-up";
  }

  async onOpen(): Promise<void> {
    if (this.refreshHandler === undefined) {
      this.refreshHandler = () => {
        if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => {
          this.refreshTimer = undefined;
          void this.render();
        }, 100);
      };
      this.plugin.syncEvent?.on("SYNC_LOG_REFRESH", this.refreshHandler);
    }
    await this.render();
  }

  async onClose(): Promise<void> {
    if (this.refreshHandler !== undefined) {
      this.plugin.syncEvent?.off("SYNC_LOG_REFRESH", this.refreshHandler);
      this.refreshHandler = undefined;
    }
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer);
    this.contentEl.empty();
  }

  private async render(): Promise<void> {
    await this.renderer.render(this.contentEl, async () => await this.render());
  }
}

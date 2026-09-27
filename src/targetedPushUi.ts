import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type RemotelySavePlugin from "./main";
import type {
  TargetedPushChoice,
  TargetedPushConflict,
} from "./targetedSync";

const formatMtime = (mtime: number | undefined): string =>
  mtime === undefined ? "—" : new Date(mtime).toLocaleString();

class TargetedPushConflictModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly path: string,
    private readonly conflict: TargetedPushConflict,
    private readonly resolveChoice: (choice: TargetedPushChoice) => void,
    private readonly t: RemotelySavePlugin["i18n"]["t"]
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.t("targeted_push_conflict_title"));
    this.contentEl.createEl("p", {
      text: this.t("targeted_push_conflict_desc", { path: this.path }),
    });
    const details = this.contentEl.createDiv("targeted-push-conflict-details");
    details.createEl("div", {
      text: this.t("targeted_push_local_mtime", {
        time: formatMtime(this.conflict.localMtime),
      }),
    });
    details.createEl("div", {
      text: this.t("targeted_push_remote_mtime", {
        time: formatMtime(this.conflict.remoteMtime),
      }),
    });
    details.createEl("strong", {
      text: this.t(
        this.conflict.recommendedSide === "local"
          ? "targeted_push_recommend_local"
          : "targeted_push_recommend_remote"
      ),
    });

    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText(this.t("targeted_push_use_newest"))
          .setCta()
          .onClick(() => this.finish("newest"))
      )
      .addButton((button) =>
        button
          .setButtonText(this.t("targeted_push_force_local"))
          .setWarning()
          .onClick(() => this.finish("force-local"))
      )
      .addButton((button) =>
        button
          .setButtonText(this.t("targeted_push_cancel"))
          .onClick(() => this.finish("cancel"))
      );
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) this.resolveChoice("cancel");
  }

  private finish(choice: TargetedPushChoice): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveChoice(choice);
    this.close();
  }
}

const resolveConflict = (
  plugin: RemotelySavePlugin,
  path: string,
  conflict: TargetedPushConflict
): Promise<TargetedPushChoice> =>
  new Promise((resolve) => {
    new TargetedPushConflictModal(
      plugin.app,
      path,
      conflict,
      resolve,
      plugin.i18n.t.bind(plugin.i18n)
    ).open();
  });

export const registerTargetedPushFileMenu = (
  plugin: RemotelySavePlugin
): void => {
  plugin.registerEvent(
    plugin.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFile)) return;
      menu.addItem((item) => {
        item
          .setTitle(plugin.i18n.t("menu_push_to_cloud"))
          .setIcon("cloud-upload")
          .onClick(async () => {
            if (plugin.isSyncing) {
              new Notice(plugin.i18n.t("targeted_push_busy"));
              return;
            }
            await plugin.syncRun("manual", {
              path: file.path,
              resolveConflict: async (conflict) =>
                await resolveConflict(plugin, file.path, conflict),
            });
          });
      });
    })
  );
};

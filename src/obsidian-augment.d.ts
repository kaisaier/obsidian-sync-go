import "obsidian";

declare module "obsidian" {
  interface App {
    readonly setting: {
      open(): void;
      openTabById(id: string): void;
    };
  }
}

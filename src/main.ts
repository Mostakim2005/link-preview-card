import { Plugin, Notice, TFile, MarkdownView } from "obsidian";
import { DEFAULT_SETTINGS } from "./settings";
import type { LinkPreviewSettings } from "./types";
// Link Preview Card
// (tracker.ts (cleanTrackingParams, parseUrl)) is incremental â€” see README.
export default class LinkPreviewCard extends Plugin {
  settings!: LinkPreviewSettings;

  applyThemePreferences() {
    if (typeof document !== "undefined") {
      document.body.toggleClass("lpc-glassmorphic", Boolean(this.settings.glassmorphism ?? true));
    }
  }

  async onload() {
    const raw = ((await this.loadData()) ?? {}) as Partial<LinkPreviewSettings>;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
    if (raw.visibleActions) {
      this.settings.visibleActions = Object.assign({}, DEFAULT_SETTINGS.visibleActions, raw.visibleActions);
    }
    this.applyThemePreferences();

    this.registerMarkdownCodeBlockProcessor("link-preview", (source, el, ctx) => {
      try {
        el.createEl("div", { text: source, cls: "lpc-card" });
      } catch {
        el.createEl("pre", { text: source });
      }
    });

    this.addCommand({
      id: "manage-links",
      name: "Manage links in current note",
      callback: () => new Notice("Manage links â€” full UI port pending."),
    });
    this.addCommand({
      id: "convert-line-to-preview",
      name: "Convert link on current line to preview",
      callback: () => new Notice("Convert to preview â€” full port pending."),
    });
    this.addCommand({
      id: "clean-tracking-params",
      name: "Clean tracking parameters from all links in note",
      callback: () => new Notice("Clean trackers â€” full port pending."),
    });

    this.addRibbonIcon("link", "Manage links in current note", () => new Notice("Link Preview Card â€” pilot build."));
    this.addSettingTab(new LinkPreviewSettingPlaceholder(this.app, this));
  }

  onunload() {
    if (typeof document !== "undefined") document.body.removeClass("lpc-glassmorphic");
  }

  saveSettings() {
    return this.saveData(this.settings);
  }

  rerenderActivePreviewCards() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) (leaf.view.previewMode as any)?.rerender(true);
    });
  }
}

import { PluginSettingTab, App } from "obsidian";
class LinkPreviewSettingPlaceholder extends PluginSettingTab {
  constructor(app: App, private plugin: LinkPreviewCard) {
    super(app, plugin);
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Link Preview Card â€” pilot" });
    containerEl.createEl("p", { text: "Full settings UI port is next split step. Defaults match Nihon 4.4.0." });
  }
}



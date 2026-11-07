import { PluginSettingTab, Setting, type App } from "obsidian";
import type LinkPreviewCard from "./main";
import { DEFAULT_SETTINGS } from "./settings";
import type { VisibleActions } from "./types";

type ActionKey = keyof VisibleActions;

interface ActionToggleDef {
	key: ActionKey;
	name: string;
	desc: string;
}

const ACTION_TOGGLES: ActionToggleDef[] = [
	{ key: "copy", name: "Copy URL button", desc: "Display the copy URL icon button." },
	{ key: "open", name: "Open link button", desc: "Display the external link open icon button." },
	{ key: "alias", name: "Edit alias button", desc: "Display the edit alias icon button." },
	{ key: "image", name: "Set image button", desc: "Display the custom preview image icon button." },
	{ key: "refresh", name: "Refresh button", desc: "Display the refresh preview icon button." },
	{ key: "revert", name: "Revert button", desc: "Display the turn back to link icon button." },
];

export class LinkPreviewSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: LinkPreviewCard,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Preview pasted links")
			.setDesc("Turn a pasted link on an empty line into a preview card.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoPreview).onChange(async (value) => {
					this.plugin.settings.autoPreview = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Strip tracking parameters & telemetry")
			.setDesc(
				"Automatically strip tracking IDs, UTM markers, and telemetry parameters from YouTube, Twitter/X, Spotify, Facebook, Amazon, Reddit, ChatGPT, etc.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.stripTrackers).onChange(async (value) => {
					this.plugin.settings.stripTrackers = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Frosted glassmorphism theme")
			.setDesc(
				"Enable translucent glass panels with frosted blur backdrops and subtle luminous borders on cards and modals.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.glassmorphism).onChange(async (value) => {
					this.plugin.settings.glassmorphism = value;
					await this.plugin.saveSettings();
					this.plugin.applyThemePreferences();
					this.plugin.rerenderActivePreviewCards();
				}),
			);

		new Setting(containerEl)
			.setName("Default card layout")
			.setDesc("Choose the default visual appearance of cards.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("standard", "Standard (side media container)")
					.addOption("banner", "Banner (top hero media container)")
					.addOption("compact", "Compact (bookmark row)")
					.setValue(this.plugin.settings.cardLayout)
					.onChange(async (value) => {
						this.plugin.settings.cardLayout = value as typeof this.plugin.settings.cardLayout;
						await this.plugin.saveSettings();
						this.plugin.rerenderActivePreviewCards();
					}),
			);

		new Setting(containerEl)
			.setName("Thumbnail media position")
			.setDesc("Position of the media box in standard layout.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("left", "Left side (standard)")
					.addOption("right", "Right side (bookmark style)")
					.setValue(this.plugin.settings.mediaPosition)
					.onChange(async (value) => {
						this.plugin.settings.mediaPosition =
							value as typeof this.plugin.settings.mediaPosition;
						await this.plugin.saveSettings();
						this.plugin.rerenderActivePreviewCards();
					}),
			);

		new Setting(containerEl)
			.setName("Action buttons placement")
			.setDesc("Horizontal alignment of the action buttons row.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("right", "Right aligned (clean)")
					.addOption("space-between", "Evenly balanced across card")
					.addOption("space-evenly", "Evenly spaced")
					.addOption("left", "Left aligned")
					.setValue(this.plugin.settings.actionPlacement)
					.onChange(async (value) => {
						this.plugin.settings.actionPlacement =
							value as typeof this.plugin.settings.actionPlacement;
						await this.plugin.saveSettings();
						this.plugin.rerenderActivePreviewCards();
					}),
			);

		new Setting(containerEl)
			.setName("Card corner radius")
			.setDesc("Styling of the card corner borders.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("rounded", "Rounded (14px)")
					.addOption("sharp", "Subtle (6px)")
					.addOption("pill", "Soft pill (20px)")
					.setValue(this.plugin.settings.cardRadius)
					.onChange(async (value) => {
						this.plugin.settings.cardRadius = value as typeof this.plugin.settings.cardRadius;
						await this.plugin.saveSettings();
						this.plugin.rerenderActivePreviewCards();
					}),
			);

		new Setting(containerEl)
			.setName("Show website favicon")
			.setDesc("Display the website's favicon beside the domain name.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showFavicon).onChange(async (value) => {
					this.plugin.settings.showFavicon = value;
					await this.plugin.saveSettings();
					this.plugin.rerenderActivePreviewCards();
				}),
			);

		new Setting(containerEl)
			.setName("Show description")
			.setDesc("Show the page description under the title.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showDescription).onChange(async (value) => {
					this.plugin.settings.showDescription = value;
					await this.plugin.saveSettings();
					this.plugin.rerenderActivePreviewCards();
				}),
			);

		new Setting(containerEl)
			.setName("No-image placeholder style")
			.setDesc("Choose how the media box looks when a link has no preview image.")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("logo-name", "Website name as logo")
					.addOption("icon-and-name", "Icon / letter + website name")
					.setValue(this.plugin.settings.placeholderStyle)
					.onChange(async (value) => {
						this.plugin.settings.placeholderStyle =
							value as typeof this.plugin.settings.placeholderStyle;
						await this.plugin.saveSettings();
						this.plugin.rerenderActivePreviewCards();
					}),
			);

		new Setting(containerEl)
			.setName("Placeholder custom font")
			.setDesc(
				"Optional font family for the website name in the placeholder box (e.g. Georgia, Playfair Display, JetBrains Mono).",
			)
			.addText((text) =>
				text
					.setPlaceholder("Default theme font")
					.setValue(this.plugin.settings.placeholderFont)
					.onChange(async (value) => {
						this.plugin.settings.placeholderFont = value;
						await this.plugin.saveSettings();
						this.plugin.rerenderActivePreviewCards();
					}),
			);

		new Setting(containerEl).setName("Action buttons visibility").setHeading();

		for (const def of ACTION_TOGGLES) {
			new Setting(containerEl)
				.setName(def.name)
				.setDesc(def.desc)
				.addToggle((toggle) =>
					toggle
						.setValue(
							(this.plugin.settings.visibleActions ?? DEFAULT_SETTINGS.visibleActions)[
								def.key
							] !== false,
						)
						.onChange(async (value) => {
							this.plugin.settings.visibleActions[def.key] = value;
							await this.plugin.saveSettings();
							this.plugin.rerenderActivePreviewCards();
						}),
				);
		}
	}
}

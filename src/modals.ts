import {
	FuzzySuggestModal,
	Modal,
	Notice,
	TFile,
	setIcon,
	type App,
} from "obsidian";
import type LinkPreviewCard from "./main";
import { voidAsync } from "./async";
import { fetchAll } from "./metadata";
import { applyChanges } from "./note-actions";
import { scanLinks } from "./preview-block";
import { FETCH_CONCURRENCY, IMAGE_EXT } from "./settings";
import { hostOf } from "./tracker";
import type { ImageDoneMode, PreviewData, ScanItem } from "./types";

export class AliasModal extends Modal {
	constructor(
		app: App,
		private readonly data: PreviewData,
		private readonly onSave: (alias: string) => void,
	) {
		super(app);
		this.modalEl.addClass("lpc-dialog", "lpc-dialog-small");
	}

	onOpen(): void {
		this.titleEl.setText("Edit alias");
		const wrap = this.contentEl.createDiv({ cls: "lpc-manager lpc-alias" });
		const input = wrap.createEl("input", { type: "text", cls: "lpc-input" });
		input.value = this.data.alias || "";
		input.placeholder = this.data.title || this.data.url;
		input.focus();

		const save = () => {
			const value = input.value.trim();
			this.close();
			this.onSave(value);
		};
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") save();
		});
		wrap.createDiv({ cls: "lpc-hint", text: "Leave empty to show the page title." });

		const foot = wrap.createDiv({ cls: "lpc-footer" });
		foot.createDiv({ cls: "lpc-status" });
		const actions = foot.createDiv({ cls: "lpc-footer-actions" });
		actions
			.createEl("button", {
				cls: "lpc-btn lpc-btn-text",
				text: "Cancel",
				attr: { type: "button" },
			})
			.addEventListener("click", () => this.close());
		actions
			.createEl("button", {
				cls: "lpc-btn lpc-btn-filled",
				text: "Save",
				attr: { type: "button" },
			})
			.addEventListener("click", save);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

const TYPE_LABEL: Record<ScanItem["type"], string> = {
	link: "Link",
	preview: "Preview",
	inline: "Inline",
};
const TYPE_ICON: Record<ScanItem["type"], string> = {
	link: "link",
	preview: "image",
	inline: "text",
};

interface LinkRow {
	i: number;
	input: HTMLInputElement;
	row: HTMLElement;
	convertible: boolean;
}

export class LinksModal extends Modal {
	private items: ScanItem[] = [];
	private readonly selected = new Set<number>();
	private filter = "all";
	private busy = false;
	private rows: LinkRow[] = [];
	private chipEls: Record<string, HTMLButtonElement> = {};
	private countEl!: HTMLElement;
	private listEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private toLinkBtn!: HTMLButtonElement;
	private toPreviewBtn!: HTMLButtonElement;

	constructor(
		app: App,
		private readonly plugin: LinkPreviewCard,
		private readonly file: TFile,
	) {
		super(app);
		this.modalEl.addClass("lpc-dialog");
	}

	async onOpen(): Promise<void> {
		this.titleEl.setText("Manage links");
		await this.reload();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	async reload(): Promise<void> {
		const text = await this.app.vault.read(this.file);
		this.items = scanLinks(text, this.plugin.settings.stripTrackers);
		this.selected.clear();
		this.render();
	}

	private count(type: ScanItem["type"]): number {
		return this.items.filter((item) => item.type === type).length;
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("lpc-manager");

		root.createDiv({
			cls: "lpc-sub",
			text: `${this.file.basename} · ${this.count("preview")} previews · ${this.count("link")} links · ${this.count("inline")} inline`,
		});

		const chips = root.createDiv({
			cls: "lpc-filters",
			attr: { role: "group", "aria-label": "Filter" },
		});
		this.chipEls = {};
		const chipDefs: Array<[string, string, number]> = [
			["all", "All", this.items.length],
			["link", "Links", this.count("link")],
			["preview", "Previews", this.count("preview")],
		];
		for (const [key, label, n] of chipDefs) {
			const chip = chips.createEl("button", {
				cls: "lpc-filter",
				text: `${label} (${n})`,
				attr: { type: "button" },
			});
			chip.addEventListener("click", () => this.setFilter(key));
			this.chipEls[key] = chip;
		}

		const bar = root.createDiv({ cls: "lpc-toolbar" });
		const tool = (icon: string, label: string, handler: () => void): void => {
			const btn = bar.createEl("button", {
				cls: "lpc-btn lpc-btn-text",
				attr: { type: "button" },
			});
			setIcon(btn.createSpan({ cls: "lpc-btn-icon" }), icon);
			btn.createSpan({ text: label });
			btn.addEventListener("click", handler);
		};
		tool("check-check", "All", () => this.selectAll());
		tool("x", "None", () => this.selectNone());
		tool("arrow-left-right", "Invert", () => this.invert());
		tool("shield-check", "Clean trackers", () => {
			voidAsync(async () => {
				await this.plugin.cleanTrackersInFile(this.file);
				await this.reload();
			})();
		});
		this.countEl = bar.createDiv({ cls: "lpc-count" });

		this.listEl = root.createDiv({ cls: "lpc-list" });

		const foot = root.createDiv({ cls: "lpc-footer" });
		this.statusEl = foot.createDiv({ cls: "lpc-status" });
		const actions = foot.createDiv({ cls: "lpc-footer-actions" });
		this.toLinkBtn = actions.createEl("button", {
			cls: "lpc-btn lpc-btn-tonal",
			attr: { type: "button" },
		});
		this.toPreviewBtn = actions.createEl("button", {
			cls: "lpc-btn lpc-btn-filled",
			attr: { type: "button" },
		});
		this.toLinkBtn.addEventListener("click", () => void this.run("toLink"));
		this.toPreviewBtn.addEventListener("click", () => void this.run("toPreview"));

		this.applyFilterState();
		this.renderList();
	}

	private applyFilterState(): void {
		for (const [key, el] of Object.entries(this.chipEls)) {
			el.toggleClass("is-active", key === this.filter);
			el.setAttribute("aria-pressed", String(key === this.filter));
		}
	}

	private setFilter(key: string): void {
		this.filter = key;
		this.applyFilterState();
		this.renderList();
	}

	private visibleIndexes(): number[] {
		const out: number[] = [];
		this.items.forEach((item, i) => {
			if (this.filter === "all" || item.type === this.filter) out.push(i);
		});
		return out;
	}

	private renderList(): void {
		this.listEl.empty();
		this.rows = [];
		const visible = this.visibleIndexes();

		if (!visible.length) {
			const empty = this.listEl.createDiv({ cls: "lpc-empty" });
			setIcon(empty.createDiv({ cls: "lpc-empty-icon" }), "link-2-off");
			empty.createDiv({
				text: this.items.length ? "Nothing in this filter" : "No links in this note",
			});
			this.updateFooter();
			return;
		}

		for (const i of visible) {
			const item = this.items[i];
			if (!item) continue;
			const convertible = item.type !== "inline";

			const row = this.listEl.createEl("label", { cls: "lpc-row" });
			row.toggleClass("is-disabled", !convertible);

			const input = row.createEl("input", { type: "checkbox", cls: "lpc-check" });
			input.disabled = !convertible;
			input.checked = this.selected.has(i);
			row.toggleClass("is-selected", input.checked);
			input.addEventListener("change", () => {
				if (input.checked) this.selected.add(i);
				else this.selected.delete(i);
				row.toggleClass("is-selected", input.checked);
				this.updateFooter();
			});

			setIcon(row.createDiv({ cls: `lpc-lead is-${item.type}` }), TYPE_ICON[item.type]);

			const text = row.createDiv({ cls: "lpc-text" });
			text.createDiv({ cls: "lpc-row-title", text: item.title || hostOf(item.url) });
			text.createDiv({ cls: "lpc-row-sub", text: `Line ${item.line + 1} · ${item.url}` });

			row.createSpan({ cls: `lpc-status-chip is-${item.type}`, text: TYPE_LABEL[item.type] });

			this.rows.push({ i, input, row, convertible });
		}
		this.updateFooter();
	}

	private setRowSelected(entry: LinkRow, on: boolean): void {
		if (!entry.convertible) return;
		entry.input.checked = on;
		if (on) this.selected.add(entry.i);
		else this.selected.delete(entry.i);
		entry.row.toggleClass("is-selected", on);
	}

	private selectAll(): void {
		this.rows.forEach((row) => this.setRowSelected(row, true));
		this.updateFooter();
	}

	private selectNone(): void {
		this.rows.forEach((row) => this.setRowSelected(row, false));
		this.updateFooter();
	}

	private invert(): void {
		this.rows.forEach((row) => this.setRowSelected(row, !this.selected.has(row.i)));
		this.updateFooter();
	}

	private selectedOf(type: ScanItem["type"]): ScanItem[] {
		return [...this.selected]
			.map((i) => this.items[i])
			.filter((item): item is ScanItem => item !== undefined && item.type === type);
	}

	private updateFooter(): void {
		const links = this.selectedOf("link").length;
		const previews = this.selectedOf("preview").length;
		const total = this.selected.size;
		this.countEl.setText(total ? `${total} selected` : "None selected");

		const label = (
			btn: HTMLButtonElement,
			icon: string,
			text: string,
			n: number,
			disabled: boolean,
		): void => {
			btn.empty();
			setIcon(btn.createSpan({ cls: "lpc-btn-icon" }), icon);
			btn.createSpan({ text });
			if (n > 0) btn.createSpan({ cls: "lpc-badge", text: String(n) });
			btn.disabled = disabled;
		};
		label(this.toLinkBtn, "undo", "Back to links", previews, this.busy || previews === 0);
		label(
			this.toPreviewBtn,
			"layout-template",
			"Make previews",
			links,
			this.busy || links === 0,
		);
	}

	private setStatus(text: string): void {
		this.statusEl.setText(text);
	}

	private async run(kind: "toLink" | "toPreview"): Promise<void> {
		if (this.busy) return;
		const targets = this.selectedOf(kind === "toPreview" ? "link" : "preview");
		if (!targets.length) return;

		this.busy = true;
		this.updateFooter();
		try {
			let metas = new Map<string, PreviewData>();
			if (kind === "toPreview") {
				const urls = [...new Set(targets.map((t) => t.url))];
				this.setStatus(`Fetching 0 of ${urls.length}…`);
				metas = await fetchAll(
					urls,
					FETCH_CONCURRENCY,
					(done, total) => this.setStatus(`Fetching ${done} of ${total}…`),
					this.plugin.settings.stripTrackers,
				);
			}
			const { applied, failed } = await applyChanges(this.plugin, this.file, targets, metas);
			new Notice(
				kind === "toPreview"
					? `${applied} converted to previews${failed ? `, ${failed} failed` : ""}`
					: `${applied} turned back into links`,
			);
		} catch {
			new Notice("Something went wrong. No changes were made.");
		} finally {
			this.busy = false;
			this.setStatus("");
			await this.reload();
		}
	}
}

export class ImagePicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		private readonly onChoose: (path: string) => void,
	) {
		super(app);
		this.setPlaceholder("Choose an image from your vault");
	}

	getItems(): TFile[] {
		return this.app.vault
			.getFiles()
			.filter((file) => IMAGE_EXT.includes(file.extension.toLowerCase()));
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file.path);
	}
}

export class ImageModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: LinkPreviewCard,
		private readonly data: PreviewData,
		private readonly sourcePath: string,
		private readonly onDone: (mode: ImageDoneMode, value?: string) => void | Promise<void>,
	) {
		super(app);
		this.modalEl.addClass("lpc-dialog", "lpc-dialog-small");
	}

	onOpen(): void {
		this.titleEl.setText("Preview image");
		const wrap = this.contentEl.createDiv({ cls: "lpc-manager lpc-alias" });

		const input = wrap.createEl("input", { type: "text", cls: "lpc-input" });
		input.value = this.data.image || "";
		input.placeholder = "Image link or path in your vault";

		const row = wrap.createDiv({ cls: "lpc-field-row" });
		const tool = (icon: string, label: string, handler: () => void): void => {
			const btn = row.createEl("button", {
				cls: "lpc-btn lpc-btn-tonal",
				attr: { type: "button" },
			});
			setIcon(btn.createSpan({ cls: "lpc-btn-icon" }), icon);
			btn.createSpan({ text: label });
			btn.addEventListener("click", handler);
		};

		tool("image-plus", "Choose from vault", () => {
			this.plugin.openVaultImageChooser((chosenPath) => {
				if (!chosenPath) return;
				input.value = chosenPath;
				this.close();
				void this.onDone("set", chosenPath);
			});
		});
		tool("image-off", "No image", () => {
			this.close();
			void this.onDone("remove");
		});
		tool("refresh-cw", "Automatic", () => {
			this.close();
			void this.onDone("auto");
		});

		wrap.createDiv({
			cls: "lpc-hint",
			text: "Tip: take a screenshot of the site, then press Ctrl+V here to use it as the image.",
		});

		this.contentEl.addEventListener(
			"paste",
			voidAsync(async (evt: ClipboardEvent) => {
				const files = Array.from(evt.clipboardData?.files ?? []);
				const imageFile = files.find((file) => file.type.startsWith("image/"));
				if (!imageFile) return;
				evt.preventDefault();
				try {
					input.value = await this.plugin.saveImageBlob(imageFile, this.sourcePath);
					new Notice("Image saved to your vault");
				} catch {
					new Notice("Couldn't save the pasted image");
				}
			}),
		);

		const save = () => {
			const value = input.value.trim();
			if (!value) {
				this.close();
				void this.onDone("remove");
				return;
			}
			if (!this.plugin.resolveImage(value, this.sourcePath)) {
				new Notice("Not a valid link or vault image");
				return;
			}
			this.close();
			void this.onDone("set", value);
		};
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") save();
		});

		const foot = wrap.createDiv({ cls: "lpc-footer" });
		foot.createDiv({ cls: "lpc-status" });
		const actions = foot.createDiv({ cls: "lpc-footer-actions" });
		actions
			.createEl("button", {
				cls: "lpc-btn lpc-btn-text",
				text: "Cancel",
				attr: { type: "button" },
			})
			.addEventListener("click", () => this.close());
		actions
			.createEl("button", {
				cls: "lpc-btn lpc-btn-filled",
				text: "Save",
				attr: { type: "button" },
			})
			.addEventListener("click", save);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

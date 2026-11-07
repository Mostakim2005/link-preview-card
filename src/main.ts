import {
	MarkdownView,
	Menu,
	Notice,
	Plugin,
	TFile,
	type Editor,
	type MarkdownPostProcessorContext,
} from "obsidian";
import { voidAsync } from "./async";
import { renderPreviewCard } from "./card-renderer";
import { fetchMeta } from "./metadata";
import { AliasModal, ImageModal, ImagePicker, LinksModal } from "./modals";
import {
	applyChanges,
	cleanTrackersInFile,
	flushActiveNote,
	getActiveEditorForFile,
	insertPreview,
	revertBlock,
	updateBlock,
} from "./note-actions";
import { insideFence, scanLinks } from "./preview-block";
import { DEFAULT_SETTINGS } from "./settings";
import { LinkPreviewSettingTab } from "./settings-tab";
import { cleanTrackingParams, hostOf, parseUrl } from "./tracker";
import type {
	EditorContext,
	ImageDoneMode,
	LinkPreviewSettings,
	PreviewData,
	ScanItem,
} from "./types";

interface NoteToolboxApi {
	openImagePicker?: (
		callback: (file: TFile | null, filePath?: string) => void,
		options: Record<string, unknown>,
	) => void;
	openPicker?: (options: {
		category: string;
		lockCategory: boolean;
		multiple: boolean;
		title: string;
		onSelect: (file: TFile | null, filePath?: string) => void;
	}) => void;
}

interface PluginRegistryHost {
	plugins?: { plugins?: Record<string, unknown> };
}

export default class LinkPreviewCard extends Plugin {
	settings!: LinkPreviewSettings;
	private menuSeen = new WeakSet<Menu>();

	applyThemePreferences(): void {
		if (typeof document !== "undefined") {
			document.body.toggleClass(
				"lpc-glassmorphic",
				Boolean(this.settings.glassmorphism ?? true),
			);
		}
	}

	async onload(): Promise<void> {
		const raw = ((await this.loadData()) ?? {}) as Partial<LinkPreviewSettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);
		if (raw.visibleActions) {
			this.settings.visibleActions = Object.assign(
				{},
				DEFAULT_SETTINGS.visibleActions,
				raw.visibleActions,
			);
		}
		if (Object.keys(raw).some((key) => !(key in DEFAULT_SETTINGS))) {
			await this.saveData(this.settings);
		}

		this.applyThemePreferences();

		this.registerMarkdownCodeBlockProcessor("link-preview", (source, el, ctx) =>
			this.renderCard(source, el, ctx),
		);

		this.registerEvent(
			this.app.workspace.on("editor-paste", (evt, editor) => this.onPaste(evt, editor)),
		);
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor) => this.onEditorMenu(menu, editor)),
		);
		this.registerEvent(
			this.app.workspace.on("url-menu", (menu, url) => this.onUrlMenu(menu, url)),
		);

		this.addCommand({
			id: "manage-links",
			name: "Manage links in current note",
			callback: () => {
				void this.openManager();
			},
		});

		this.addCommand({
			id: "convert-line-to-preview",
			name: "Convert link on current line to preview",
			editorCallback: async (editor) => {
				const line = editor.getCursor().line;
				const rawLine = editor.getLine(line).replace(/^(\s*[-*+]|\s*\d+\.)\s+/, "");
				const url = parseUrl(rawLine);
				if (!url) {
					new Notice("The current line is not a single link.");
					return;
				}
				const targetUrl = this.settings.stripTrackers
					? cleanTrackingParams(url.href)
					: url.href;
				await this.insertPreview(editor, targetUrl, editor.getLine(line), line);
			},
		});

		this.addCommand({
			id: "clean-tracking-params",
			name: "Clean tracking parameters from all links in note",
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!(file instanceof TFile) || file.extension !== "md") {
					new Notice("Open a markdown note first.");
					return;
				}
				await this.cleanTrackersInFile(file, true);
			},
		});

		this.addRibbonIcon("link", "Manage links in current note", () => {
			void this.openManager();
		});

		this.addSettingTab(new LinkPreviewSettingTab(this.app, this));
	}

	onunload(): void {
		if (typeof document !== "undefined") {
			document.body.removeClass("lpc-glassmorphic");
			document.body.style.removeProperty("--lpc-placeholder-font");
		}
	}

	rerenderActivePreviewCards(): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view instanceof MarkdownView) {
				leaf.view.previewMode?.rerender(true);
			}
		});
	}

	saveSettings(): Promise<void> {
		return this.saveData(this.settings);
	}

	openVaultImageChooser(onChoosePath: (path: string) => void): void {
		const registry = (this.app as unknown as PluginRegistryHost).plugins?.plugins;
		const noteToolbox = registry?.["note-toolbox"] as NoteToolboxApi | undefined;
		const resolve = (file: TFile | null, filePath?: string): string | undefined =>
			typeof filePath === "string" ? filePath : file?.path;

		if (noteToolbox && typeof noteToolbox.openImagePicker === "function") {
			noteToolbox.openImagePicker(
				(file, filePath) => {
					const resolved = resolve(file, filePath);
					if (resolved) onChoosePath(resolved);
				},
				{ title: "Choose Preview Image", lockCategory: true, multiple: false },
			);
			return;
		}
		if (noteToolbox && typeof noteToolbox.openPicker === "function") {
			noteToolbox.openPicker({
				category: "image",
				lockCategory: true,
				multiple: false,
				title: "Choose Preview Image",
				onSelect: (file, filePath) => {
					const resolved = resolve(file, filePath);
					if (resolved) onChoosePath(resolved);
				},
			});
			return;
		}
		new ImagePicker(this.app, onChoosePath).open();
	}

	/* ----- link manager ----- */

	flush(file: TFile): Promise<void> {
		return flushActiveNote(this, file);
	}

	async openManager(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile) || file.extension !== "md") {
			new Notice("Open a markdown note first.");
			return;
		}
		await this.flush(file);
		new LinksModal(this.app, this, file).open();
	}

	cleanTrackersInFile(file: TFile, showNotice = false): Promise<number> {
		return cleanTrackersInFile(this, file, showNotice);
	}

	applyChanges(
		file: TFile,
		targets: ScanItem[],
		metas: Map<string, PreviewData>,
	): Promise<{ applied: number; failed: number }> {
		return applyChanges(this, file, targets, metas);
	}

	async convertLink(file: TFile, item: ScanItem): Promise<void> {
		const notice = new Notice("Fetching preview…", 15000);
		try {
			await this.flush(file);
			const targetUrl = this.settings.stripTrackers
				? cleanTrackingParams(item.url)
				: item.url;
			const meta = await fetchMeta(targetUrl, this.settings.stripTrackers);
			const { applied } = await this.applyChanges(
				file,
				[item],
				new Map([[item.url, meta]]),
			);
			if (!applied) new Notice("Couldn't find that link in the note.");
		} catch {
			new Notice("Couldn't load a preview. Kept the plain link.");
		} finally {
			notice.hide();
		}
	}

	async revertItem(file: TFile, item: ScanItem): Promise<void> {
		await this.flush(file);
		await this.applyChanges(file, [item], new Map());
	}

	/* ----- right-click menus ----- */

	activeContext(): EditorContext | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		return view && view.file ? { file: view.file, editor: view.editor } : null;
	}

	addToggleItem(menu: Menu, hit: ScanItem, file: TFile): void {
		this.menuSeen.add(menu);
		const toPreview = hit.type === "link";
		menu.addItem((item) =>
			item
				.setTitle(toPreview ? "Turn link into preview" : "Turn preview back into link")
				.setIcon(toPreview ? "layout-template" : "undo")
				.onClick(() => {
					void (toPreview ? this.convertLink(file, hit) : this.revertItem(file, hit));
				}),
		);
	}

	onEditorMenu(menu: Menu, editor: Editor): void {
		if (this.menuSeen.has(menu)) return;
		const ctx = this.activeContext();
		if (!ctx) return;
		const line = editor.getCursor().line;
		const hit = scanLinks(editor.getValue(), this.settings.stripTrackers).find(
			(item) => item.type !== "inline" && line >= item.line && line <= item.end,
		);
		if (hit) this.addToggleItem(menu, hit, ctx.file);
	}

	onUrlMenu(menu: Menu, url: string): void {
		if (this.menuSeen.has(menu)) return;
		const ctx = this.activeContext();
		const target = parseUrl(url)?.href;
		if (!ctx || !target) return;
		const line = ctx.editor.getCursor().line;
		const matches = scanLinks(ctx.editor.getValue(), this.settings.stripTrackers).filter(
			(item) => item.type === "link" && item.url === target,
		);
		const hit = matches.find((item) => item.line === line) ?? matches[0];
		if (hit) this.addToggleItem(menu, hit, ctx.file);
	}

	/* ----- paste ----- */

	onPaste(evt: ClipboardEvent, editor: Editor): void {
		if (!this.settings.autoPreview || evt.defaultPrevented) return;
		if (editor.somethingSelected()) return;

		const text = evt.clipboardData?.getData("text/plain") ?? "";
		const url = parseUrl(text);
		if (!url) return;

		if (editor.getLine(editor.getCursor().line).trim() !== "") return;
		if (insideFence(editor)) return;

		evt.preventDefault();
		const finalUrl = this.settings.stripTrackers
			? cleanTrackingParams(url.href)
			: url.href;
		void this.insertPreview(editor, finalUrl, text.trim());
	}

	insertPreview(
		editor: Editor,
		href: string,
		original?: string,
		line?: number,
	): Promise<void> {
		return insertPreview(this, editor, href, original, line);
	}

	/* ----- images ----- */

	resolveImage(src: string, sourcePath: string): string {
		if (!src) return "";
		if (/^https?:\/\//i.test(src)) return src;
		const cleanSrc = src.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
		const file =
			this.app.metadataCache.getFirstLinkpathDest(cleanSrc, sourcePath) ||
			this.app.vault.getAbstractFileByPath(cleanSrc);
		return file instanceof TFile ? this.app.vault.getResourcePath(file) : "";
	}

	async saveImageBlob(blob: Blob, sourcePath: string): Promise<string> {
		const ext = (blob.type.split("/")[1] || "png")
			.replace("jpeg", "jpg")
			.replace("svg+xml", "svg");
		const path = await this.app.fileManager.getAvailablePathForAttachment(
			`link-preview-${Date.now()}.${ext}`,
			sourcePath,
		);
		const file = await this.app.vault.createBinary(path, await blob.arrayBuffer());
		return file.path;
	}

	openImageModal(data: PreviewData, sourcePath: string): void {
		new ImageModal(
			this.app,
			this,
			data,
			sourcePath,
			async (mode: ImageDoneMode, value?: string) => {
				if (mode === "set") {
					await this.updateBlock(sourcePath, data, { image: value, imageLocked: true });
				} else if (mode === "remove") {
					await this.updateBlock(sourcePath, data, { image: "", imageLocked: true });
				} else {
					await this.updateBlock(sourcePath, data, { imageLocked: undefined });
					await this.refresh(sourcePath, data);
				}
			},
		).open();
	}

	/* ----- rendering ----- */

	renderCard(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
		renderPreviewCard(this, source, el, ctx);
	}

	async copyUrl(data: PreviewData): Promise<void> {
		const cleanUrl = this.settings.stripTrackers
			? cleanTrackingParams(data.url)
			: data.url;
		await navigator.clipboard.writeText(cleanUrl);
		new Notice("URL copied");
	}

	openAliasModal(data: PreviewData, sourcePath: string): void {
		new AliasModal(this.app, data, (alias) => {
			void this.updateBlock(sourcePath, data, { alias });
		}).open();
	}

	showMenu(evt: MouseEvent, data: PreviewData, sourcePath: string): void {
		const menu = new Menu();
		const add = (title: string, icon: string, handler: () => void): void => {
			menu.addItem((item) => item.setTitle(title).setIcon(icon).onClick(handler));
		};

		add("Copy URL", "copy", () => {
			void this.copyUrl(data);
		});
		add("Copy as Markdown link", "link", () => {
			const cleanUrl = this.settings.stripTrackers
				? cleanTrackingParams(data.url)
				: data.url;
			const md = `[${data.alias || data.title || hostOf(cleanUrl)}](${cleanUrl})`;
			void navigator.clipboard
				.writeText(md)
				.then(() => new Notice("Markdown link copied"));
		});

		if (cleanTrackingParams(data.url) !== data.url) {
			menu.addSeparator();
			add("Clean tracking params from card", "shield-check", () => {
				voidAsync(async () => {
					const cleanUrl = cleanTrackingParams(data.url);
					await this.updateBlock(sourcePath, data, { url: cleanUrl });
					new Notice("Tracking parameters removed from card");
				})();
			});
		}

		menu.addSeparator();
		add("Edit alias…", "pencil", () => this.openAliasModal(data, sourcePath));
		add("Set preview image…", "image-plus", () => this.openImageModal(data, sourcePath));
		add("Choose preview image from vault…", "layout-grid", () => {
			this.openVaultImageChooser((chosenPath) => {
				if (chosenPath) {
					void this.updateBlock(sourcePath, data, {
						image: chosenPath,
						imageLocked: true,
					});
				}
			});
		});
		add("Refresh preview", "refresh-cw", () => {
			void this.refresh(sourcePath, data);
		});
		add("Open link", "external-link", () => {
			window.open(data.url, "_blank", "noopener,noreferrer");
		});
		menu.addSeparator();
		add("Turn back into link", "undo", () => {
			void this.revert(sourcePath, data);
		});
		menu.showAtMouseEvent(evt);
	}

	/* ----- note edits ----- */

	getActiveEditorForFile(file: TFile | null): Editor | null {
		return getActiveEditorForFile(this, file);
	}

	updateBlock(
		path: string,
		data: PreviewData,
		patch: Partial<PreviewData> | ((current: PreviewData) => Partial<PreviewData>),
	): Promise<void> {
		return updateBlock(this, path, data, patch);
	}

	async refresh(path: string, data: PreviewData): Promise<void> {
		const notice = new Notice("Refreshing…", 10000);
		try {
			const targetUrl = this.settings.stripTrackers
				? cleanTrackingParams(data.url)
				: data.url;
			const meta = await fetchMeta(targetUrl, this.settings.stripTrackers);
			await this.updateBlock(path, data, (current) => {
				const patch: Partial<PreviewData> = {
					...meta,
					url: targetUrl,
					fetchedAt: Date.now(),
				};
				if (current.imageLocked) delete patch.image;
				return patch;
			});
			new Notice("Preview refreshed");
		} catch {
			new Notice("Refresh failed");
		} finally {
			notice.hide();
		}
	}

	async revert(path: string, data: PreviewData): Promise<void> {
		await revertBlock(this, path, data);
	}

	/* ----- public API for other plugins ----- */

	/** Removes tracking parameters from one URL. */
	cleanUrl(url: string): string {
		return cleanTrackingParams(url);
	}

	/** Fetches metadata for one URL without touching any note. */
	fetchMetadata(url: string): Promise<PreviewData> {
		return fetchMeta(url, this.settings.stripTrackers);
	}

	/** Inserts a preview block at the cursor of the given editor. */
	insertPreviewCard(editor: Editor, url: string): Promise<void> {
		return this.insertPreview(editor, url);
	}

	/** Cleans tracking parameters in the active note; returns the number changed. */
	async cleanAllLinksInActiveFile(): Promise<number> {
		const file = this.app.workspace.getActiveFile();
		if (!(file instanceof TFile) || file.extension !== "md") {
			new Notice("Open a markdown note first.");
			return 0;
		}
		return this.cleanTrackersInFile(file, true);
	}
}

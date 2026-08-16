import { MarkdownPostProcessorContext, Notice, Plugin, TFile, Modal } from 'obsidian';
import { extractUrls } from './utils/url';
import { blockAtPosition, createBlock, findBlockById, makeId, parseBlocks, replaceBlockByIdentity } from './utils/preview-block';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings';
import type { PluginSettings, PreviewData } from './types';
import { MetadataService } from './services/metadata';
import { LinkPreviewSettingTab } from './settings-tab';
import { CookieSessionManager } from './services/cookies';
import { UrlSelectionModal } from './ui/selection-modal';
import { renderPreview, type RendererActions } from './renderer';
import { CookieManagerModal } from './ui/cookie-manager-modal';

export default class LinkPreviewPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  metadata!: MetadataService;
  cookies!: CookieSessionManager;

  override async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.cookies = new CookieSessionManager(this.app);
    await this.cookies.initialize();
    this.metadata = new MetadataService(() => this.settings, this.cookies);
    this.addSettingTab(new LinkPreviewSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor('link-preview', (source, el, ctx) => this.processPreview(source, el, ctx));
    this.registerEvent(this.app.workspace.on('editor-paste', (event, editor) => {
      if (event.defaultPrevented) return;
      void this.handlePaste(event, editor);
    }));

    this.addCommand({ id: 'scan-note-for-links', name: 'Scan current note for links and manage previews', callback: () => this.scanCurrentNote() });
    this.addCommand({ id: 'convert-links-in-note', name: 'Convert links in current note to previews', callback: () => this.convertAllLinksInCurrentNote() });
    this.addCommand({ id: 'refresh-previews-in-note', name: 'Refresh previews in current note', callback: () => this.refreshCurrentNotePreviews() });
    this.addCommand({ id: 'clear-metadata-cache', name: 'Clear link preview metadata cache', callback: () => { this.metadata.clear(); new Notice('Link preview cache cleared'); } });
    this.addCommand({ id: 'refresh-provider-cookies', name: 'Manage social-provider session cookies', callback: () => this.openCookieManager() });
  }

  override onunload(): void {
    this.metadata.clear();
    this.cookies.dispose();
  }

  private openCookieManager(): void {
    const manager = new CookieManagerModal(this.app, this.cookies);
    manager.open();
  }

  async saveSettings(): Promise<void> {
    this.metadata.reconfigure();
    await this.saveData(this.settings);
  }

  private processPreview(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    try {
      const data = JSON.parse(source) as PreviewData;
      if (!data.url || typeof data.url !== 'string') throw new Error('Missing URL');
      const normalized: PreviewData = { ...data, id: data.id ?? makeId() };
      const actions: RendererActions = {
        refresh: async (current) => { const fresh = await this.metadata.fetch(current.url, true); await this.updatePreviewSource(ctx.sourcePath, current, fresh); },
        edit: async (current, raw) => this.editLink(current, raw),
        changeTitle: async (current, raw) => this.changeTitle(current, raw),
        revert: async (current) => this.revertPreview(ctx.sourcePath, current),
      };
      renderPreview(el, normalized, source, this.settings, actions);
    } catch {
      el.createEl('pre', { text: source });
    }
  }

  private async handlePaste(evt: ClipboardEvent, editor: import('obsidian').Editor): Promise<void> {
    const text = evt.clipboardData?.getData('text/plain')?.trim() ?? '';
    const urls = extractUrls(text);
    if (!urls.length) return;
    evt.preventDefault();

    const from = editor.getCursor('from');
    const inside = blockAtPosition(editor, from);
    const insert = async (selected: string[]): Promise<void> => {
      const replacements = await Promise.all(selected.map(async (url) => createBlock({ ...(await this.metadata.fetch(url)), id: makeId() })));
      const byUrl = new Map(selected.map((url, index) => [url, replacements[index] ?? '']));
      const replacementText = text.replace(/https?:\/\/[^\s<>()"']+/gi, (found) => byUrl.get(found.replace(/[.,;:!?]+$/, '')) ?? found);
      if (inside) editor.replaceRange(replacementText, { line: inside.endLine + 1, ch: 0 });
      else editor.replaceSelection(replacementText);
    };

    if (urls.length === 1 && text === urls[0] && !inside) {
      const data = await this.metadata.fetch(urls[0]);
      editor.replaceSelection(createBlock({ ...data, id: makeId() }));
      return;
    }
    if (urls.length > 1 || text !== urls[0]) new UrlSelectionModal(this.app, urls, (selected) => { void insert(selected); }).open();
    else await insert(urls);
  }

  private async scanCurrentNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice('No active note'); return; }
    const content = await this.app.vault.cachedRead(file);
    const blocks = parseBlocks(content);
    const masked = maskPreviewBlocks(content);
    const urls = extractUrls(masked);
    if (!urls.length && !blocks.length) { new Notice('No links found in note'); return; }
    new Notice(`${urls.length} plain link(s), ${blocks.length} preview(s) found`);
  }

  private async convertAllLinksInCurrentNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice('No active note'); return; }
    const current = await this.app.vault.cachedRead(file);
    const urls = [...new Set(extractUrls(maskPreviewBlocks(current)))];
    if (!urls.length) { new Notice('No plain links found'); return; }
    const data = new Map<string, PreviewData>();
    for (const url of urls) data.set(url, { ...(await this.metadata.fetch(url)), id: makeId() });
    await this.app.vault.process(file, (content) => content.replace(/https?:\/\/[^\s<>()"']+/gi, (found) => data.get(found.replace(/[.,;:!?]+$/, '')) ? createBlock(data.get(found.replace(/[.,;:!?]+$/, ''))!) : found));
    new Notice(`Converted ${urls.length} link(s) to previews`);
  }

  private async refreshCurrentNotePreviews(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice('No active note'); return; }
    const content = await this.app.vault.cachedRead(file);
    const blocks = parseBlocks(content);
    if (!blocks.length) { new Notice('No previews found'); return; }
    const refreshed = new Map<string, PreviewData>();
    for (const block of blocks) refreshed.set(block.data.id ?? block.data.url, { ...(await this.metadata.fetch(block.data.url, true)), id: block.data.id ?? makeId() });
    await this.app.vault.process(file, (latest) => {
      const currentBlocks = parseBlocks(latest);
      let result = latest;
      for (const block of [...currentBlocks].reverse()) {
        const fresh = refreshed.get(block.data.id ?? block.data.url);
        if (!fresh) continue;
        result = replaceBlockByIdentity(result, block, createBlock(fresh));
      }
      return result;
    });
    new Notice(`Refreshed ${blocks.length} preview(s)`);
  }

  private async editLink(data: PreviewData, source: string): Promise<void> {
    this.openTextModal('Edit link URL', data.url, async (next) => {
      const url = extractUrls(next)[0];
      if (!url) { new Notice('Invalid URL'); return; }
      const fresh = await this.metadata.fetch(url, true);
      await this.replacePreviewById(data, source, { ...fresh, id: data.id ?? makeId() });
    });
  }

  private openTextModal(title: string, initialValue: string, onSubmit: (value: string) => Promise<void>): void {
    class TextModal extends Modal {
      override onOpen(): void {
        this.titleEl.setText(title);
        const input = this.contentEl.createEl('input', { type: 'text' });
        input.value = initialValue;
        input.addClass('link-preview-text-input');
        input.focus();
        input.select();
        const submit = (): void => {
          const value = input.value;
          this.close();
          void onSubmit(value);
        };
        input.addEventListener('keydown', (event) => { if (event.key === 'Enter') submit(); });
        this.contentEl.createEl('button', { text: 'Save', cls: 'mod-cta' }).addEventListener('click', submit);
      }
      override onClose(): void { this.contentEl.empty(); }
    }
    new TextModal(this.app).open();
  }

  private async changeTitle(data: PreviewData, source: string): Promise<void> {
    this.openTextModal('Change title', data.title, async (title) => {
      const value = title.trim();
      if (!value) return;
      await this.replacePreviewById(data, source, { ...data, title: value });
    });
  }

  private async replacePreviewById(data: PreviewData, source: string, replacement: PreviewData): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    await this.app.vault.process(file, (content) => {
      const id = data.id;
      const block = id ? findBlockById(content, id) : findLegacyBlock(content, source);
      if (!block) return content;
      return replaceBlockByIdentity(content, block, createBlock(replacement));
    });
    new Notice('Link preview updated');
  }

  private async updatePreviewSource(path: string, current: PreviewData, fresh: PreviewData): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    await this.replacePreviewInFile(file, current, { ...fresh, id: current.id ?? makeId() });
  }

  private async replacePreviewInFile(file: TFile, current: PreviewData, replacement: PreviewData): Promise<void> {
    await this.app.vault.process(file, (content) => {
      const block = current.id ? findBlockById(content, current.id) : findLegacyBlock(content, JSON.stringify(current));
      return block ? replaceBlockByIdentity(content, block, createBlock(replacement)) : content;
    });
  }

  private async revertPreview(path: string, data: PreviewData): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (content) => {
      const block = data.id ? findBlockById(content, data.id) : findLegacyBlock(content, JSON.stringify(data));
      return block ? replaceBlockByIdentity(content, block, `\n${data.url}\n`) : content;
    });
    new Notice('Preview reverted to link');
  }
}

function maskPreviewBlocks(content: string): string {
  return content.replace(/~~~link-preview\n[\s\S]*?\n~~~/g, '%%LINK_PREVIEW%%');
}

function findLegacyBlock(content: string, source: string) {
  return parseBlocks(content).find((block) => block.source === source) ?? null;
}

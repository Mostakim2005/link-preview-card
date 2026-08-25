import { MarkdownPostProcessorContext, Notice, Plugin, TFile, Modal, MarkdownView } from 'obsidian';
import { extractUrls, hostOf, normalizeUrl, parseHttpUrl } from './utils/url';
import { blockAtPosition, createBlock, findBlockById, makeId, parseBlocks, replaceBlockByIdentity } from './utils/preview-block';
import { DEFAULT_SETTINGS, normalizeSettings } from './settings';
import type { PluginSettings, PreviewBehavior, PreviewData } from './types';
import { MetadataService } from './services/metadata';
import { LinkPreviewSettingTab } from './settings-tab';
import { CookieSessionManager } from './services/cookies';
import { UrlSelectionModal } from './ui/selection-modal';
import { renderPreview, type RendererActions } from './renderer';
import { CookieManagerModal } from './ui/cookie-manager-modal';
import { LinkActionModal } from './ui/action-modal';
import { LINK_PREVIEW_VIEW, LinkPreviewSidebarView } from './ui/sidebar-view';

export default class LinkPreviewPlugin extends Plugin {
  settings: PluginSettings = DEFAULT_SETTINGS;
  metadata!: MetadataService;
  cookies!: CookieSessionManager;

  override onload(): void { void this.initialize(); }

  private async initialize(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.cookies = new CookieSessionManager(this.app);
    await this.cookies.initialize();
    this.metadata = new MetadataService(() => this.settings, this.cookies);
    this.addSettingTab(new LinkPreviewSettingTab(this.app, this));
    this.registerView(LINK_PREVIEW_VIEW, (leaf) => new LinkPreviewSidebarView(leaf, this));
    this.registerMarkdownCodeBlockProcessor('link-preview', (source, el, ctx) => this.processPreview(source, el, ctx));
    this.registerEvent(this.app.workspace.on('editor-paste', (event, editor) => {
      if (event.defaultPrevented) return;
      const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
      if (!extractUrls(text).length) return;
      event.preventDefault();
      void this.handlePaste(event, editor, text);
    }));
    this.registerDomEvent(document, 'contextmenu', (event) => this.handleLinkContext(event));
    this.registerDomEvent(document, 'touchstart', (event) => this.handleLinkTouchStart(event), { passive: true });
    this.registerDomEvent(document, 'touchend', () => this.cancelPendingTouch(), { passive: true });
    this.registerDomEvent(document, 'touchmove', () => this.cancelPendingTouch(), { passive: true });

    this.addCommand({ id: 'scan-note-for-links', name: 'Scan current note for links and manage previews', callback: () => { void this.scanCurrentNote(); } });
    this.addCommand({ id: 'convert-links-in-note', name: 'Convert links in current note to previews', callback: () => { void this.convertAllLinksInCurrentNote(); } });
    this.addCommand({ id: 'refresh-previews-in-note', name: 'Refresh previews in current note', callback: () => { void this.refreshCurrentNotePreviews(); } });
    this.addCommand({ id: 'clear-metadata-cache', name: 'Clear link preview metadata cache', callback: () => { this.metadata.clear(); new Notice('Link preview cache cleared'); } });
    this.addCommand({ id: 'refresh-provider-cookies', name: 'Manage link preview session cookies', callback: () => this.openCookieManager() });
    this.addCommand({ id: 'open-link-preview-sidebar', name: 'Open link preview sidebar', callback: () => { void this.openSidebar(); } });
  }

  override onunload(): void {
    this.metadata?.clear();
    this.cookies?.dispose();
    this.cancelPendingTouch();
  }

  async openSidebar(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(LINK_PREVIEW_VIEW)[0];
    if (existing) {
      await existing.setViewState({ type: LINK_PREVIEW_VIEW, active: true });
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: LINK_PREVIEW_VIEW, active: true });
  }

  async saveSettings(): Promise<void> {
    this.metadata.reconfigure();
    await this.saveData(this.settings);
    this.refreshVisiblePreviews();
  }

  async setPreviewBehavior(behavior: PreviewBehavior): Promise<void> { this.settings.previewBehavior = behavior; await this.saveSettings(); }
  async setPreviewCardMode(mode: 'compact' | 'expanded'): Promise<void> { this.settings.previewCardMode = mode; await this.saveSettings(); }

  async setDomainRule(host: string, behavior: PreviewBehavior): Promise<void> {
    const normalized = host.replace(/^www\./, '').toLowerCase();
    this.settings.domainRules[normalized] = { behavior };
    await this.saveSettings();
  }

  async removeDomainRule(host: string): Promise<void> {
    delete this.settings.domainRules[host];
    await this.saveSettings();
  }

  async addBlockedDomain(host: string): Promise<void> {
    const normalized = host.replace(/^www\./, '').toLowerCase();
    this.settings.blockedDomains = [...new Set([...this.settings.blockedDomains, normalized])];
    await this.saveSettings();
  }

  async removeBlockedDomain(host: string): Promise<void> {
    this.settings.blockedDomains = this.settings.blockedDomains.filter((value) => value !== host);
    await this.saveSettings();
  }

  private openCookieManager(): void { new CookieManagerModal(this.app, this.cookies).open(); }

  private processPreview(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext): void {
    try {
      const data = JSON.parse(source) as PreviewData;
      if (!data.url || typeof data.url !== 'string') throw new Error('Missing URL');
      const normalized: PreviewData = { ...data, id: data.id ?? makeId() };
      const actions: RendererActions = {
        refresh: async (current) => { const fresh = await this.fetchAndTrack(current.url, true); await this.updatePreviewSource(ctx.sourcePath, current, fresh); },
        edit: async (current, raw) => this.editLink(current, raw),
        changeTitle: async (current, raw) => this.changeTitle(current, raw),
        revert: async (current) => this.revertPreview(ctx.sourcePath, current),
        convert: async (current) => this.convertPreview(current),
        copyTitle: async (current) => { await navigator.clipboard.writeText(current.title); new Notice('Title copied'); },
      };
      renderPreview(el, normalized, source, this.settings, actions);
    } catch {
      el.createEl('pre', { text: source });
    }
  }

  private async handlePaste(evt: ClipboardEvent, editor: import('obsidian').Editor, pastedText: string): Promise<void> {
    const text = pastedText;
    const urls = extractUrls(text);
    if (!urls.length) return;
    const from = editor.getCursor('from');
    const inside = blockAtPosition(editor, from);
    const insert = async (selected: string[]): Promise<void> => {
      const replacements = await Promise.all(selected.map(async (url) => createBlock({ ...(await this.fetchAndTrack(url)), id: makeId() })));
      const byUrl = new Map(selected.map((url, index) => [url, replacements[index] ?? '']));
      const replacementText = text.replace(/https?:\/\/[^\s<>()"']+/gi, (found) => byUrl.get(found.replace(/[.,;:!?]+$/, '')) ?? found);
      if (inside) editor.replaceRange(replacementText, { line: inside.endLine + 1, ch: 0 });
      else editor.replaceSelection(replacementText);
    };

    if (urls.length === 1 && text === urls[0] && !inside) {
      const behavior = this.getBehavior(urls[0]);
      if (behavior === 'never') { editor.replaceSelection(text); return; }
      const data = await this.fetchAndTrack(urls[0]);
      editor.replaceSelection(createBlock({ ...data, id: makeId() }));
      return;
    }
    if (urls.length > 1 || text !== urls[0]) new UrlSelectionModal(this.app, urls, (selected) => { void insert(selected); }).open();
    else await insert(urls);
    void evt;
  }

  private getBehavior(url: string): PreviewBehavior {
    const host = hostOf(url);
    const domainRule = this.settings.domainRules[host];
    return domainRule?.behavior ?? this.settings.previewBehavior;
  }

  private async fetchAndTrack(url: string, force = false): Promise<PreviewData> {
    try {
      const data = await this.metadata.fetch(url, force);
      this.settings.recentPreviewUrls = [normalizeUrl(url, this.settings.normalizeTrackingParams), ...this.settings.recentPreviewUrls.filter((value) => value !== normalizeUrl(url, this.settings.normalizeTrackingParams))].slice(0, 50);
      await this.saveData(this.settings);
      return data;
    } catch (error) {
      this.settings.failedPreviewUrls = [url, ...this.settings.failedPreviewUrls.filter((value) => value !== url)].slice(0, 30);
      await this.saveData(this.settings);
      throw error;
    }
  }

  private handleLinkContext(event: MouseEvent): void {
    if (this.isInsideOwnUi(event.target)) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!target) return;
    const url = parseHttpUrl(target.href);
    if (!url) return;
    if (!this.shouldOwnInteraction(target)) return;
    event.preventDefault();
    event.stopPropagation();
    void this.openLinkActions(url.href);
  }

  private handleLinkTouchStart(event: TouchEvent): void {
    if (this.isInsideOwnUi(event.target)) return;
    const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!target) return;
    const url = parseHttpUrl(target.href);
    if (!url || !this.shouldOwnInteraction(target)) return;
    const touch = event.touches[0];
    if (!touch) return;
    this.pendingTouch = window.setTimeout(() => { void this.openLinkActions(url.href); }, 550);
  }

  private pendingTouch: number | undefined;

  private cancelPendingTouch(): void {
    if (this.pendingTouch !== undefined) window.clearTimeout(this.pendingTouch);
    this.pendingTouch = undefined;
  }

  private shouldOwnInteraction(target: HTMLAnchorElement): boolean {
    if (target.closest('.link-preview-card')) return false;
    const behavior = this.getBehavior(target.href);
    return behavior !== 'never' || Boolean(this.settings.domainRules[hostOf(target.href)]);
  }

  private isInsideOwnUi(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest('.link-preview-card, .modal-container, .workspace-tab-header-inner-icon'));
  }

  private async openLinkActions(url: string): Promise<void> {
    try {
      const data = await this.fetchAndTrack(url);
      const sourceBehavior = this.getBehavior(url);
      const actions: RendererActions = {
        refresh: async () => { await this.fetchAndTrack(url, true); },
        edit: async () => undefined,
        changeTitle: async () => undefined,
        revert: async () => undefined,
        convert: async (current) => { await this.convertPlainLinkToPreview(current.url); },
      };
      new LinkActionModal(this.app, data, this.settings, actions, async (behavior) => { await this.setDomainRule(hostOf(url), behavior); }, async () => { await this.fetchAndTrack(url, true); }).open();
      void sourceBehavior;
    } catch {
      new Notice('Could not load link metadata');
    }
  }

  private async convertPlainLinkToPreview(url: string): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) return;
    const data = await this.fetchAndTrack(url);
    await this.app.vault.process(file, (content) => {
      const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      return content.replace(regex, createBlock({ ...data, id: makeId() }).trim());
    });
    new Notice('Link converted to preview');
  }

  private async convertPreview(data: PreviewData): Promise<void> { await this.convertPlainLinkToPreview(data.url); }

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
    for (const url of urls) data.set(normalizeUrl(url, this.settings.normalizeTrackingParams), { ...(await this.fetchAndTrack(url)), id: makeId() });
    await this.app.vault.process(file, (content) => content.replace(/https?:\/\/[^\s<>()"']+/gi, (found) => {
      const clean = found.replace(/[.,;:!?]+$/, '');
      const preview = data.get(normalizeUrl(clean, this.settings.normalizeTrackingParams));
      return preview ? createBlock(preview).trim() : found;
    }));
    new Notice(`Converted ${urls.length} link(s) to previews`);
  }

  private async refreshCurrentNotePreviews(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice('No active note'); return; }
    const content = await this.app.vault.cachedRead(file);
    const blocks = parseBlocks(content);
    if (!blocks.length) { new Notice('No previews found'); return; }
    const refreshed = new Map<string, PreviewData>();
    for (const block of blocks) refreshed.set(block.data.id ?? block.data.url, { ...(await this.fetchAndTrack(block.data.url, true)), id: block.data.id ?? makeId() });
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
      const fresh = await this.fetchAndTrack(url, true);
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
        const submit = (): void => { const value = input.value; this.close(); void onSubmit(value); };
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
      const block = id ? findBlockById(content, id) : parseBlocks(content).find((item) => item.source === source) ?? null;
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
      const block = current.id ? findBlockById(content, current.id) : parseBlocks(content).find((item) => item.data.url === current.url) ?? null;
      return block ? replaceBlockByIdentity(content, block, createBlock(replacement)) : content;
    });
  }

  private async revertPreview(path: string, data: PreviewData): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    await this.app.vault.process(file, (content) => {
      const block = data.id ? findBlockById(content, data.id) : parseBlocks(content).find((item) => item.data.url === data.url) ?? null;
      return block ? replaceBlockByIdentity(content, block, `\n${data.url}\n`) : content;
    });
    new Notice('Preview reverted to link');
  }

  private refreshVisiblePreviews(): void {
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    for (const leaf of leaves) if (leaf.view instanceof MarkdownView) leaf.view.previewMode.rerender(true);
  }
}

function maskPreviewBlocks(content: string): string { return content.replace(/~~~link-preview\n[\s\S]*?\n~~~/g, '%%LINK_PREVIEW%%'); }

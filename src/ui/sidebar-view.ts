import { ItemView, MarkdownView, Notice, WorkspaceLeaf } from 'obsidian';
import type LinkPreviewPlugin from '../main';
import type { PreviewBehavior } from '../types';
import { CookieManagerModal } from './cookie-manager-modal';
import { hostOf } from '../utils/url';

export const LINK_PREVIEW_VIEW = 'link-preview-card-sidebar';

export class LinkPreviewSidebarView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private readonly plugin: LinkPreviewPlugin) { super(leaf); }

  getViewType(): string { return LINK_PREVIEW_VIEW; }
  getDisplayText(): string { return 'Link preview'; }

  async onOpen(): Promise<void> { this.render(); }
  async onClose(): Promise<void> { this.contentEl.empty(); }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass('link-preview-sidebar');
    root.createEl('h2', { text: 'Link preview' });

    new SettingBuilder(root).toggle('Automatic preview', 'Use the selected default behavior for links.', this.plugin.settings.previewBehavior !== 'never', async (value) => {
      this.plugin.settings.previewBehavior = value ? 'ask' : 'never';
      await this.plugin.saveSettings();
      this.render();
    });

    const behavior = root.createDiv({ cls: 'link-preview-sidebar-section' });
    behavior.createEl('h3', { text: 'Default link behavior' });
    const select = behavior.createEl('select');
    const options: Array<[PreviewBehavior, string]> = [['automatic', 'Automatic'], ['always', 'Always preview'], ['never', 'Never preview'], ['ask', 'Ask each time']];
    for (const [value, label] of options) select.createEl('option', { value, text: label });
    select.value = this.plugin.settings.previewBehavior;
    select.addEventListener('change', () => { void this.plugin.setPreviewBehavior(select.value as PreviewBehavior); });

    const card = root.createDiv({ cls: 'link-preview-sidebar-section' });
    card.createEl('h3', { text: 'Card appearance' });
    const cardSelect = card.createEl('select');
    for (const value of ['expanded', 'compact']) cardSelect.createEl('option', { value, text: value === 'expanded' ? 'Expanded' : 'Compact' });
    cardSelect.value = this.plugin.settings.previewCardMode;
    cardSelect.addEventListener('change', () => { void this.plugin.setPreviewCardMode(cardSelect.value as 'compact' | 'expanded'); });

    const domains = root.createDiv({ cls: 'link-preview-sidebar-section' });
    domains.createEl('h3', { text: 'Domain rule' });
    const hostInput = domains.createEl('input', { type: 'text', placeholder: 'example.com' });
    const mode = domains.createEl('select');
    for (const [value, label] of options.slice(1)) mode.createEl('option', { value, text: label });
    const add = domains.createEl('button', { text: 'Save rule', cls: 'mod-cta' });
    add.addEventListener('click', () => {
      const host = hostInput.value.trim().toLowerCase().replace(/^www\./, '');
      if (!host) return;
      void this.plugin.setDomainRule(host, mode.value as PreviewBehavior).then(() => this.render());
    });
    for (const [host, rule] of Object.entries(this.plugin.settings.domainRules)) {
      const row = domains.createDiv({ cls: 'link-preview-domain-row' });
      row.createSpan({ text: host });
      row.createSpan({ text: rule.behavior });
      row.createEl('button', { text: 'Clear' }).addEventListener('click', () => { void this.plugin.removeDomainRule(host).then(() => this.render()); });
    }

    const blocked = root.createDiv({ cls: 'link-preview-sidebar-section' });
    blocked.createEl('h3', { text: 'Blocked domains' });
    const blockInput = blocked.createEl('input', { type: 'text', placeholder: 'example.com' });
    const blockBtn = blocked.createEl('button', { text: 'Block' });
    blockBtn.addEventListener('click', () => {
      const host = blockInput.value.trim().toLowerCase().replace(/^www\./, '');
      if (!host) return;
      void this.plugin.addBlockedDomain(host).then(() => this.render());
    });
    for (const host of this.plugin.settings.blockedDomains) {
      const row = blocked.createDiv({ cls: 'link-preview-domain-row' });
      row.createSpan({ text: host });
      row.createEl('button', { text: 'Remove' }).addEventListener('click', () => { void this.plugin.removeBlockedDomain(host).then(() => this.render()); });
    }

    const cache = root.createDiv({ cls: 'link-preview-sidebar-section' });
    cache.createEl('h3', { text: 'Cache' });
    cache.createSpan({ text: `${this.plugin.metadata.cache.size()} cached preview(s)` });
    const cacheBtns = cache.createDiv({ cls: 'link-preview-sidebar-actions' });
    cacheBtns.createEl('button', { text: 'Clear all' }).addEventListener('click', () => { this.plugin.metadata.clear(); new Notice('Preview cache cleared'); this.render(); });
    const file = this.app.workspace.getActiveFile();
    if (file) {
      cacheBtns.createEl('button', { text: 'Clear current domain' }).addEventListener('click', () => {
        const leaf = this.app.workspace.getMostRecentLeaf();
        const view = leaf?.view;
        const url = view instanceof MarkdownView ? view.file?.path : undefined;
        if (url) new Notice('Current note has no single preview domain');
      });
    }

    const recent = root.createDiv({ cls: 'link-preview-sidebar-section' });
    recent.createEl('h3', { text: 'Recent previews' });
    for (const url of this.plugin.settings.recentPreviewUrls.slice(0, 10)) recent.createDiv({ text: url, cls: 'link-preview-sidebar-item' });

    const failed = root.createDiv({ cls: 'link-preview-sidebar-section' });
    failed.createEl('h3', { text: 'Failed previews' });
    if (!this.plugin.settings.failedPreviewUrls.length) failed.createSpan({ text: 'No recent failures.' });
    for (const url of this.plugin.settings.failedPreviewUrls.slice(0, 10)) failed.createDiv({ text: `${hostOf(url)} — ${url}`, cls: 'link-preview-sidebar-item' });

    const cookie = root.createDiv({ cls: 'link-preview-sidebar-section' });
    cookie.createEl('h3', { text: 'Sessions and cookies' });
    cookie.createEl('button', { text: 'Manage sessions' }).addEventListener('click', () => new CookieManagerModal(this.app, this.plugin.cookies).open());
    cookie.createEl('button', { text: 'Open site in browser' }).addEventListener('click', () => { window.open('https://missav.ws', '_blank', 'noopener,noreferrer'); });
  }
}

class SettingBuilder {
  constructor(private readonly parent: HTMLElement) {}
  toggle(name: string, desc: string, value: boolean, onChange: (value: boolean) => Promise<void>): void {
    const row = this.parent.createDiv({ cls: 'link-preview-setting-row' });
    const text = row.createDiv();
    text.createDiv({ text: name, cls: 'link-preview-setting-name' });
    text.createDiv({ text: desc, cls: 'link-preview-setting-desc' });
    const input = row.createEl('input', { type: 'checkbox' });
    input.checked = value;
    input.addEventListener('change', () => { void onChange(input.checked); });
  }
}

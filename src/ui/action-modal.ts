import { Modal, Notice } from 'obsidian';
import type { App } from 'obsidian';
import type { PreviewData, PreviewBehavior, PluginSettings } from '../types';
import { hostOf } from '../utils/url';
import { renderPreview, type RendererActions } from '../renderer';

export class LinkActionModal extends Modal {
  constructor(
    app: App,
    private readonly data: PreviewData,
    private readonly settings: PluginSettings,
    private readonly actions: RendererActions,
    private readonly onBehavior: (behavior: PreviewBehavior) => Promise<void>,
    private readonly onRefresh: () => Promise<void>,
  ) { super(app); }

  override onOpen(): void {
    this.contentEl.empty();
    this.titleEl.setText('Link preview');
    this.contentEl.addClass('link-preview-action-modal');
    const header = this.contentEl.createDiv({ cls: 'link-preview-action-header' });
    header.createDiv({ cls: 'link-preview-action-domain', text: hostOf(this.data.url) });
    header.createDiv({ cls: 'link-preview-action-url', text: this.data.url });
    const status = this.contentEl.createDiv({ cls: 'link-preview-action-status' });
    status.createSpan({ text: this.data.provider ? `Provider: ${this.data.provider}` : 'Provider: generic' });
    status.createSpan({ text: this.data.fetchedAt ? `Fetched: ${new Date(this.data.fetchedAt).toLocaleString()}` : 'Not fetched' });

    const previewHost = this.contentEl.createDiv({ cls: 'link-preview-action-preview' });
    renderPreview(previewHost, this.data, '', this.settings, this.actions);

    const actions = this.contentEl.createDiv({ cls: 'link-preview-action-buttons' });
    this.addButton(actions, 'Copy link', 'copy', async () => {
      await navigator.clipboard.writeText(this.data.url);
      new Notice('Link copied');
    });
    this.addButton(actions, 'Preview now', 'eye', async () => { await this.onRefresh(); new Notice('Preview refreshed'); });
    this.addButton(actions, 'Convert to card', 'layout', async () => { await this.actions.convert?.(this.data); this.close(); });
    this.addButton(actions, 'Keep as normal link', 'link', async () => { await this.onBehavior('never'); this.close(); });
    this.addButton(actions, 'Always preview this domain', 'check', async () => { await this.onBehavior('always'); this.close(); });
    this.addButton(actions, 'Ask each time', 'help-circle', async () => { await this.onBehavior('ask'); this.close(); });
    this.addButton(actions, 'Open original URL', 'external-link', async () => { window.open(this.data.url, '_blank', 'noopener,noreferrer'); });
  }

  private addButton(parent: HTMLElement, label: string, icon: string, action: () => Promise<void>): void {
    parent.createEl('button', { text: label, cls: 'link-preview-action-button' }).addEventListener('click', () => { void action().catch(() => new Notice(`${label} failed`)); });
    void icon;
  }

  override onClose(): void { this.contentEl.empty(); }
}

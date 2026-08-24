import { Modal, Notice, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type { CookieProvider } from '../types';
import type { CookieSessionManager } from '../services/cookies';

const LABELS: Array<[CookieProvider, string, string]> = [
  ['facebook', 'Facebook', 'facebook.com / fb.com'],
  ['instagram', 'Instagram', 'instagram.com'],
  ['reddit', 'Reddit', 'reddit.com / redd.it'],
  ['tiktok', 'TikTok', 'tiktok.com'],
];

const CUSTOM_DOMAINS = ['missav.ws', 'nhentai.net', 'hentaifox.com'];
const EXPIRY_OPTIONS: Array<[string, number | undefined]> = [
  ['30 days', 30], ['90 days', 90], ['180 days', 180], ['1 year', 365], ['No local expiry', undefined],
];

export class CookieManagerModal extends Modal {
  private expiryDays: number | undefined = 90;

  constructor(app: App, private readonly manager: CookieSessionManager) { super(app); }

  override onOpen(): void { void this.render(); }

  private async render(): Promise<void> {
    this.contentEl.empty();
    this.titleEl.setText('Link preview sessions');
    this.contentEl.createEl('p', { text: 'Store your own session cookies in Obsidian secret storage. Treat them like passwords. They are never uploaded by this plugin.' });
    new Setting(this.contentEl).setName('Local expiry').setDesc('Only a local safety limit. The website can expire a session earlier.').addDropdown((dropdown) => {
      for (const [label] of EXPIRY_OPTIONS) dropdown.addOption(label, label);
      dropdown.setValue(this.expiryLabel()).onChange((value) => { this.expiryDays = EXPIRY_OPTIONS.find(([label]) => label === value)?.[1]; });
    });
    for (const [provider, label, domain] of LABELS) await this.addProviderRow(provider, label, domain);

    this.contentEl.createEl('h3', { text: 'Custom site sessions' });
    this.contentEl.createEl('p', { text: 'Useful for sites that require your own logged-in session. The plugin does not bypass login or CAPTCHA.' });
    for (const domain of CUSTOM_DOMAINS) await this.addCustomRow(domain);

    new Setting(this.contentEl).addButton((button) => button.setButtonText('Clear all').setWarning().onClick(() => { void this.manager.clear().then(() => this.render()); })).addButton((button) => button.setButtonText('Done').setCta().onClick(() => this.close()));
  }

  private async addProviderRow(provider: CookieProvider, label: string, domain: string): Promise<void> {
    const status = await this.manager.status(provider);
    const setting = new Setting(this.contentEl).setName(label).setDesc(this.statusText(status, domain));
    setting.addTextArea((text) => { text.setPlaceholder('Name=value; name2=value2'); text.inputEl.rows = 4; text.inputEl.autocomplete = 'off'; text.inputEl.spellcheck = false; text.inputEl.addClass('link-preview-secret-input'); text.inputEl.dataset.cookieProvider = provider; });
    setting.addButton((button) => button.setButtonText(status.configured ? 'Replace' : 'Save').onClick(async () => {
      const textarea = this.contentEl.querySelector<HTMLTextAreaElement>(`textarea[data-cookie-provider="${provider}"]`);
      if (!textarea?.value.trim()) { new Notice('Enter a cookie header value first.'); return; }
      const expiresAt = this.expiryDays ? Date.now() + this.expiryDays * 86_400_000 : undefined;
      if (!await this.manager.set(provider, textarea.value, expiresAt)) { new Notice('Invalid cookie header.'); return; }
      new Notice(`${label} session stored securely`); await this.render();
    }));
    if (status.configured) setting.addButton((button) => button.setButtonText('Clear').setWarning().onClick(() => { void this.manager.clear(provider).then(() => this.render()); }));
  }

  private async addCustomRow(domain: string): Promise<void> {
    const status = await this.manager.statusForDomain(domain);
    const setting = new Setting(this.contentEl).setName(domain).setDesc(this.statusText(status, domain));
    setting.addTextArea((text) => { text.setPlaceholder('Name=value; name2=value2'); text.inputEl.rows = 4; text.inputEl.autocomplete = 'off'; text.inputEl.spellcheck = false; text.inputEl.addClass('link-preview-secret-input'); text.inputEl.dataset.cookieDomain = domain; });
    setting.addButton((button) => button.setButtonText(status.configured ? 'Replace' : 'Save').onClick(async () => {
      const textarea = this.contentEl.querySelector<HTMLTextAreaElement>(`textarea[data-cookie-domain="${domain}"]`);
      if (!textarea?.value.trim()) { new Notice('Enter a cookie header value first.'); return; }
      const expiresAt = this.expiryDays ? Date.now() + this.expiryDays * 86_400_000 : undefined;
      if (!await this.manager.setForDomain(domain, textarea.value, expiresAt)) { new Notice('Invalid cookie header.'); return; }
      new Notice(`${domain} session stored securely`); await this.render();
    }));
    if (status.configured) setting.addButton((button) => button.setButtonText('Clear').setWarning().onClick(() => { void this.manager.clearDomain(domain).then(() => this.render()); }));
  }

  private statusText(status: { configured: boolean; updatedAt?: number; expiresAt?: number; masked?: string }, domain: string): string {
    if (!status.configured) return `${domain}: not configured`;
    const updated = status.updatedAt ? new Date(status.updatedAt).toLocaleDateString() : 'unknown';
    const expiry = status.expiresAt ? new Date(status.expiresAt).toLocaleDateString() : 'no local expiry';
    return `${domain}: ${status.masked ?? 'stored'} • saved ${updated} • local expiry ${expiry}`;
  }

  private expiryLabel(): string { return EXPIRY_OPTIONS.find(([, days]) => days === this.expiryDays)?.[0] ?? '90 days'; }
  override onClose(): void { this.contentEl.empty(); }
}

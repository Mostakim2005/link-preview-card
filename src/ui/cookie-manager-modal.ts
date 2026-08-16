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

const EXPIRY_OPTIONS: Array<[string, number | undefined]> = [
  ['30 days', 30], ['90 days', 90], ['180 days', 180], ['1 year', 365], ['No local expiry', undefined],
];

export class CookieManagerModal extends Modal {
  private expiryDays: number | undefined = 90;

  constructor(app: App, private readonly manager: CookieSessionManager) { super(app); }

  override onOpen(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    this.contentEl.empty();
    this.titleEl.setText('Social provider cookies');
    this.contentEl.createEl('p', {
      text: 'Store your own session cookies once in Obsidian SecretStorage. The plugin keeps only the secret name in plugin settings; cookie values are not written to data.json.',
    });

    new Setting(this.contentEl)
      .setName('Local expiry')
      .setDesc('This is only a local safety limit. The website can expire a cookie earlier.')
      .addDropdown((dropdown) => {
        for (const [label] of EXPIRY_OPTIONS) dropdown.addOption(label, label);
        dropdown.setValue(this.expiryLabel());
        dropdown.onChange((value) => { this.expiryDays = EXPIRY_OPTIONS.find(([label]) => label === value)?.[1]; });
      });

    for (const [provider, label, domain] of LABELS) await this.addProviderRow(provider, label, domain);

    this.contentEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Only HTTP Cookie name=value pairs are accepted. Do not paste passwords, browser exports, cookie attributes, or unrelated domains. Treat session cookies like passwords.',
    });

    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText('Clear all').setWarning().onClick(() => { void this.manager.clear().then(() => this.render()); }))
      .addButton((button) => button.setButtonText('Done').setCta().onClick(() => this.close()));
  }

  private async addProviderRow(provider: CookieProvider, label: string, domain: string): Promise<void> {
    const status = await this.manager.status(provider);
    const setting = new Setting(this.contentEl).setName(label).setDesc(this.statusText(status, domain));
    setting.addTextArea((text) => {
      text.setPlaceholder('name=value; name2=value2');
      text.inputEl.rows = 4;
      text.inputEl.autocomplete = 'off';
      text.inputEl.spellcheck = false;
      text.setValue('');
      text.inputEl.addClass('link-preview-secret-input');
      text.onChange(() => { /* intentionally not persisted until Save */ });
      text.inputEl.dataset.cookieProvider = provider;
    });
    setting.addButton((button) => button.setButtonText(status.configured ? 'Replace' : 'Save').onClick(async () => {
      const textarea = this.contentEl.querySelector<HTMLTextAreaElement>(`textarea[data-cookie-provider="${provider}"]`);
      if (!textarea?.value.trim()) {
        new Notice('Enter a Cookie header value first.');
        return;
      }
      const expiresAt = this.expiryDays ? Date.now() + this.expiryDays * 86_400_000 : undefined;
      const ok = await this.manager.set(provider, textarea.value, expiresAt);
      if (!ok) {
        new Notice('Invalid Cookie header. Use only name=value pairs separated by semicolons.');
        return;
      }
      new Notice(`${label} session stored securely`);
      await this.render();
    }));
    if (status.configured) setting.addButton((button) => button.setButtonText('Clear').setWarning().onClick(() => { void this.manager.clear(provider).then(() => this.render()); }));
  }

  private statusText(status: { configured: boolean; updatedAt?: number; expiresAt?: number; masked?: string }, domain: string): string {
    if (!status.configured) return `${domain}: not configured`;
    const updated = status.updatedAt ? new Date(status.updatedAt).toLocaleDateString() : 'unknown';
    const expiry = status.expiresAt ? new Date(status.expiresAt).toLocaleDateString() : 'no local expiry';
    return `${domain}: ${status.masked ?? 'stored'} • saved ${updated} • local expiry ${expiry}`;
  }

  private expiryLabel(): string {
    const match = EXPIRY_OPTIONS.find(([, days]) => days === this.expiryDays);
    return match?.[0] ?? '90 days';
  }

  override onClose(): void { this.contentEl.empty(); }
}

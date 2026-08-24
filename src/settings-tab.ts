import { PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type LinkPreviewPlugin from './main';
import type { PreviewBehavior, PreviewCardMode } from './types';
import { CookieManagerModal } from './ui/cookie-manager-modal';

export class LinkPreviewSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: LinkPreviewPlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    this.toggle(containerEl, 'Embed YouTube videos', 'Show YouTube players inside preview cards.', 'embedYouTube');
    this.toggle(containerEl, 'Embed Vimeo videos', 'Show Vimeo players inside preview cards.', 'embedVimeo');
    this.toggle(containerEl, 'Embed TikTok', 'Use TikTok oEmbed metadata and optional session cookies.', 'embedTikTok');
    this.toggle(containerEl, 'Enrich Reddit', 'Retrieve Reddit oEmbed/post metadata when available.', 'embedReddit');
    this.toggle(containerEl, 'Enrich X/Twitter', 'Use the X/Twitter oEmbed endpoint when available.', 'embedX');
    this.toggle(containerEl, 'Show preview images', 'Display fetched preview images.', 'showImage');
    this.toggle(containerEl, 'Show video players', 'Allow direct and supported embedded video players.', 'showVideoPlayer');
    this.toggle(containerEl, 'Fetch multiple images', 'Use multiple Open Graph images when available.', 'fetchMultipleImages');
    this.toggle(containerEl, 'Fetch descriptions', 'Show page descriptions under the title.', 'fetchDescription');
    this.toggle(containerEl, 'Fetch author', 'Show author/creator information when available.', 'fetchAuthor');
    this.toggle(containerEl, 'Fetch text content', 'Store supported page/post text in the preview metadata.', 'fetchContent');
    this.toggle(containerEl, 'Show site name', 'Show the provider/site name in the header.', 'fetchSiteName');
    this.toggle(containerEl, 'Lazy-load media', 'Delay image and iframe loading until needed.', 'lazyLoadMedia');
    this.toggle(containerEl, 'Use supplied session cookies', 'Allow metadata requests to use cookies you explicitly stored.', 'useProviderCookies');
    this.toggle(containerEl, 'Refresh stale previews when opened', 'Automatically refresh previews older than the cache duration.', 'autoRefreshOnOpen');
    this.toggle(containerEl, 'Normalize tracking parameters', 'Normalize cache and duplicate matching for common tracking parameters.', 'normalizeTrackingParams');

    new Setting(containerEl).setName('Default link behavior').setDesc('Choose how new/selected links should behave.').addDropdown((drop) => {
      for (const [value, label] of [['automatic', 'Automatic'], ['always', 'Always preview'], ['never', 'Never preview'], ['ask', 'Ask each time']] as Array<[PreviewBehavior, string]>) drop.addOption(value, label);
      drop.setValue(this.plugin.settings.previewBehavior).onChange(async (value) => { await this.plugin.setPreviewBehavior(value as PreviewBehavior); });
    });

    new Setting(containerEl).setName('Preview card mode').setDesc('Choose the default card density.').addDropdown((drop) => {
      drop.addOption('expanded', 'Expanded').addOption('compact', 'Compact');
      drop.setValue(this.plugin.settings.previewCardMode).onChange(async (value) => { await this.plugin.setPreviewCardMode(value as PreviewCardMode); });
    });

    new Setting(containerEl).setName('Session cookies').setDesc('Import your own session cookies for supported sites and domains. Treat these like passwords.').addButton((button) => button.setButtonText('Manage').onClick(() => new CookieManagerModal(this.app, this.plugin.cookies).open()));
    new Setting(containerEl).setName('Open link preview sidebar').setDesc('Manage domain rules, cookies, cache, and recent/failed previews.').addButton((button) => button.setButtonText('Open').onClick(() => { void this.plugin.openSidebar(); }));

    new Setting(containerEl).setName('Cache duration (minutes)').addText((text) => text.setValue(String(this.plugin.settings.cacheMinutes)).onChange(async (value) => this.saveNumber('cacheMinutes', value, 0, 10080)));
    new Setting(containerEl).setName('Maximum cache entries').addText((text) => text.setValue(String(this.plugin.settings.maxCacheEntries)).onChange(async (value) => this.saveNumber('maxCacheEntries', value, 10, 500)));
    new Setting(containerEl).setName('Request timeout (milliseconds)').addText((text) => text.setValue(String(this.plugin.settings.requestTimeoutMs)).onChange(async (value) => this.saveNumber('requestTimeoutMs', value, 3000, 60000)));
    new Setting(containerEl).setName('Failure retry suppression (seconds)').addText((text) => text.setValue(String(this.plugin.settings.failureCacheSeconds)).onChange(async (value) => this.saveNumber('failureCacheSeconds', value, 5, 300)));
    new Setting(containerEl).setName('Maximum description length').addText((text) => text.setValue(String(this.plugin.settings.maxDescriptionLength)).onChange(async (value) => this.saveNumber('maxDescriptionLength', value, 80, 5000)));
    new Setting(containerEl).setName('Maximum content length').addText((text) => text.setValue(String(this.plugin.settings.maxContentLength)).onChange(async (value) => this.saveNumber('maxContentLength', value, 100, 10000)));
    new Setting(containerEl).setName('Maximum gallery images').addText((text) => text.setValue(String(this.plugin.settings.maxGalleryImages)).onChange(async (value) => this.saveNumber('maxGalleryImages', value, 1, 20)));
    new Setting(containerEl).setName('Clear metadata cache').setDesc(`Cached entries: ${this.plugin.metadata.cache.size()}`).addButton((button) => button.setButtonText('Clear').onClick(() => { this.plugin.metadata.clear(); this.display(); }));
  }

  private async saveNumber(key: 'cacheMinutes' | 'maxCacheEntries' | 'maxDescriptionLength' | 'maxContentLength' | 'maxGalleryImages' | 'requestTimeoutMs' | 'failureCacheSeconds', value: string, min: number, max: number): Promise<void> {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    this.plugin.settings[key] = Math.min(max, Math.max(min, Math.round(n)));
    await this.plugin.saveSettings();
  }

  private toggle(container: HTMLElement, name: string, desc: string, key: keyof LinkPreviewPlugin['settings']): void {
    new Setting(container).setName(name).setDesc(desc).addToggle((toggle) => toggle.setValue(Boolean(this.plugin.settings[key])).onChange(async (value) => { this.plugin.settings[key] = value as never; await this.plugin.saveSettings(); }));
  }
}

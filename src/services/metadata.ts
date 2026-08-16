import { requestUrl } from 'obsidian';
import type { PluginSettings, PreviewData } from '../types';
import { MetadataCache } from './cache';
import type { CookieSessionManager } from './cookies';
import { absoluteUrl, hostOf, isDirectVideo, videoEmbedUrl } from '../utils/url';
import { ProviderRegistry } from '../providers/registry';
import type { ProviderContext } from '../providers/types';
import { providerHeaders } from '../providers/oembed';

export class MetadataService {
  private readonly inflight = new Map<string, Promise<PreviewData>>();
  readonly cache: MetadataCache;
  readonly providers = new ProviderRegistry();

  constructor(private readonly getSettings: () => PluginSettings, private readonly cookies: CookieSessionManager) {
    const settings = getSettings();
    this.cache = new MetadataCache(settings.maxCacheEntries, settings.cacheMinutes * 60_000);
  }

  reconfigure(): void {
    const settings = this.getSettings();
    this.cache.configure(settings.maxCacheEntries, settings.cacheMinutes * 60_000);
  }

  async fetch(url: string, forceRefresh = false): Promise<PreviewData> {
    const key = url.trim();
    if (!forceRefresh) {
      const cached = this.cache.get(key);
      if (cached) return cached;
    }
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const task = this.fetchUncached(key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    const data = await task;
    this.cache.set(key, data);
    return data;
  }

  clear(): void { this.cache.clear(); this.inflight.clear(); }

  private async fetchUncached(value: string): Promise<PreviewData> {
    const url = new URL(value);
    const context: ProviderContext = { settings: this.getSettings(), cookies: this.cookies };
    const provider = this.providers.get(url);
    const providerEnabled = this.isProviderEnabled(provider.id, context.settings);
    if (providerEnabled) {
      const specialized = await provider.fetch(url, context);
      if (specialized) return specialized;
    }
    if (isDirectVideo(url.href)) return this.fallback(url.href, true);
    return this.fetchGeneric(url.href, context);
  }

  private async fetchGeneric(url: string, context: ProviderContext): Promise<PreviewData> {
    try {
      const response = await requestUrl({ url, method: 'GET', headers: await providerHeaders(url, context) });
      return this.parseHtml(url, response.text);
    } catch {
      return this.fallback(url, false);
    }
  }

  private parseHtml(url: string, html: string): PreviewData {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const settings = this.getSettings();
    const meta = (selector: string): string => doc.querySelector(selector)?.getAttribute('content')?.trim() ?? '';
    const title = meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || doc.title.trim() || url;
    const descriptionRaw = meta('meta[property="og:description"]') || meta('meta[name="twitter:description"]') || meta('meta[name="description"]');
    const description = settings.fetchDescription ? descriptionRaw.slice(0, settings.maxDescriptionLength) : undefined;
    const images = Array.from(doc.querySelectorAll('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"]'))
      .map((node) => absoluteUrl(url, node.getAttribute('content'))).filter(Boolean);
    const uniqueImages = [...new Set(images)].slice(0, settings.maxGalleryImages);
    const image = uniqueImages[0] || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(url))}&sz=128`;
    const ogVideo = meta('meta[property="og:video"]') || meta('meta[property="og:video:url"]') || meta('meta[name="twitter:player"]');
    const videoUrl = ogVideo ? absoluteUrl(url, ogVideo) : videoEmbedUrl(url) ?? undefined;
    return {
      url, title, description: description || undefined, image,
      images: uniqueImages.length > 1 && settings.fetchMultipleImages ? uniqueImages : [image],
      video: Boolean(videoUrl || doc.querySelector('video')), videoUrl: videoUrl || undefined,
      siteName: settings.fetchSiteName ? (meta('meta[property="og:site_name"]') || hostOf(url)) : undefined,
      provider: 'generic', fetchedAt: Date.now(),
    };
  }

  private fallback(url: string, video: boolean): PreviewData {
    const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(url))}&sz=128`;
    return { url, title: url, image: favicon, images: [favicon], video, videoUrl: videoEmbedUrl(url) ?? undefined, siteName: hostOf(url), provider: 'generic', fetchedAt: Date.now() };
  }

  private isProviderEnabled(id: PreviewData['provider'], settings: PluginSettings): boolean {
    switch (id) {
      case 'youtube': return settings.embedYouTube;
      case 'vimeo': return settings.embedVimeo;
      case 'tiktok': return settings.embedTikTok;
      case 'reddit': return settings.embedReddit;
      case 'x': return settings.embedX;
      case 'instagram':
      case 'facebook':
      case 'generic': return true;
      default: return true;
    }
  }
}

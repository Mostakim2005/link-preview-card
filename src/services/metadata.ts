import { requestUrl } from 'obsidian';
import type { PluginSettings, PreviewData } from '../types';
import { MetadataCache } from './cache';
import type { CookieSessionManager } from './cookies';
import { absoluteUrl, hostOf, isDirectVideo, normalizeUrl, parseHttpUrl, videoEmbedUrl } from '../utils/url';
import { ProviderRegistry } from '../providers/registry';
import type { ProviderContext } from '../providers/types';
import { providerHeaders } from '../providers/oembed';

export class MetadataService {
  private readonly inflight = new Map<string, Promise<PreviewData>>();
  private readonly failures = new Map<string, number>();
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
    const parsed = parseHttpUrl(url);
    if (!parsed) throw new Error('Invalid URL');
    const settings = this.getSettings();
    const key = normalizeUrl(parsed.href, settings.normalizeTrackingParams);
    if (settings.blockedDomains.some((domain) => hostOf(key) === domain || hostOf(key).endsWith(`.${domain}`))) {
      throw new Error(`Preview blocked for ${hostOf(key)}`);
    }
    if (!forceRefresh) {
      const cached = this.cache.get(key);
      if (cached) return cached;
      const failedAt = this.failures.get(key);
      if (failedAt && Date.now() - failedAt < settings.failureCacheSeconds * 1000) return this.fallback(key, false);
    }
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const task = this.fetchUncached(key).catch((error: unknown) => {
      this.failures.set(key, Date.now());
      throw error;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, task);
    try {
      const data = await task;
      this.failures.delete(key);
      this.cache.set(key, data);
      return data;
    } catch (error) {
      const fallback = this.fallback(key, false);
      this.cache.set(key, fallback);
      throw error;
    }
  }

  clear(): void { this.cache.clear(); this.inflight.clear(); this.failures.clear(); }

  clearDomain(host: string): void {
    this.cache.clearHost(host);
    for (const key of [...this.failures.keys()]) if (hostOf(key) === host.replace(/^www\./i, '').toLowerCase()) this.failures.delete(key);
  }

  clearUrl(url: string): void {
    const key = normalizeUrl(url, this.getSettings().normalizeTrackingParams);
    this.cache.delete(key);
    this.failures.delete(key);
  }

  private async fetchUncached(value: string): Promise<PreviewData> {
    const url = new URL(value);
    const context: ProviderContext = { settings: this.getSettings(), cookies: this.cookies };
    const provider = this.providers.get(url);
    const providerEnabled = this.isProviderEnabled(provider.id, context.settings);
    if (providerEnabled) {
      const specialized = await provider.fetch(url, context);
      if (specialized) return this.sanitize(specialized);
    }
    if (isDirectVideo(url.href)) return this.fallback(url.href, true);
    return this.fetchGeneric(url.href, context);
  }

  private async fetchGeneric(url: string, context: ProviderContext): Promise<PreviewData> {
    const response = await requestUrl({ url, method: 'GET', headers: await providerHeaders(url, context), throw: true });
    return this.parseHtml(url, response.text);
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
    return this.sanitize({
      url, title, description: description || undefined, image,
      images: uniqueImages.length > 1 && settings.fetchMultipleImages ? uniqueImages : [image],
      video: Boolean(videoUrl || doc.querySelector('video')), videoUrl: videoUrl || undefined,
      siteName: settings.fetchSiteName ? (meta('meta[property="og:site_name"]') || hostOf(url)) : undefined,
      provider: 'generic', fetchedAt: Date.now(),
    });
  }

  private fallback(url: string, video: boolean): PreviewData {
    const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(url))}&sz=128`;
    return { url, title: url, image: favicon, images: [favicon], video, videoUrl: videoEmbedUrl(url) ?? undefined, siteName: hostOf(url), provider: 'generic', fetchedAt: Date.now() };
  }

  private sanitize(data: PreviewData): PreviewData {
    const cleanUrl = parseHttpUrl(data.url)?.href ?? data.url;
    const cleanImage = parseHttpUrl(data.image ?? '')?.href;
    const images = (data.images ?? []).map((image) => parseHttpUrl(image)?.href).filter((image): image is string => Boolean(image));
    return {
      ...data,
      url: cleanUrl,
      title: data.title.trim().slice(0, 500),
      description: data.description?.trim().slice(0, this.getSettings().maxDescriptionLength),
      contentText: data.contentText?.trim().slice(0, this.getSettings().maxContentLength),
      image: cleanImage,
      images: [...new Set(images)].slice(0, this.getSettings().maxGalleryImages),
      author: data.author?.trim().slice(0, 300),
      authorUrl: parseHttpUrl(data.authorUrl ?? '')?.href,
      videoUrl: parseHttpUrl(data.videoUrl ?? '')?.href,
      fetchedAt: Date.now(),
    };
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

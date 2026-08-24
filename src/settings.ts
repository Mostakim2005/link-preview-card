import type { PluginSettings, PreviewBehavior, PreviewCardMode } from './types';

export const DEFAULT_SETTINGS: PluginSettings = {
  embedYouTube: true,
  embedVimeo: true,
  embedTikTok: true,
  embedReddit: true,
  embedX: true,
  showImage: true,
  showVideoPlayer: true,
  fetchMultipleImages: false,
  fetchDescription: true,
  fetchSiteName: true,
  fetchAuthor: true,
  fetchContent: true,
  lazyLoadMedia: true,
  cacheMinutes: 60,
  maxCacheEntries: 100,
  maxDescriptionLength: 280,
  maxContentLength: 1000,
  maxGalleryImages: 8,
  autoRefreshOnOpen: false,
  useProviderCookies: true,
  previewBehavior: 'ask',
  previewCardMode: 'expanded',
  normalizeTrackingParams: true,
  requestTimeoutMs: 12000,
  failureCacheSeconds: 30,
  blockedDomains: [],
  domainRules: {},
  recentPreviewUrls: [],
  failedPreviewUrls: [],
};

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function behavior(value: unknown, fallback: PreviewBehavior): PreviewBehavior {
  return value === 'automatic' || value === 'always' || value === 'never' || value === 'ask' ? value : fallback;
}

function cardMode(value: unknown, fallback: PreviewCardMode): PreviewCardMode {
  return value === 'compact' || value === 'expanded' ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))] : [];
}

function domainRules(value: unknown): Record<string, { behavior: PreviewBehavior }> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, { behavior: PreviewBehavior }> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const host = key.trim().toLowerCase().replace(/^www\./, '');
    if (!host || !item || typeof item !== 'object') continue;
    const valueRecord = item as Record<string, unknown>;
    result[host] = { behavior: behavior(valueRecord.behavior, 'ask') };
  }
  return result;
}

export function normalizeSettings(data: unknown): PluginSettings {
  const raw = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
  return {
    embedYouTube: bool(raw.embedYouTube, DEFAULT_SETTINGS.embedYouTube),
    embedVimeo: bool(raw.embedVimeo, DEFAULT_SETTINGS.embedVimeo),
    embedTikTok: bool(raw.embedTikTok, DEFAULT_SETTINGS.embedTikTok),
    embedReddit: bool(raw.embedReddit, DEFAULT_SETTINGS.embedReddit),
    embedX: bool(raw.embedX, DEFAULT_SETTINGS.embedX),
    showImage: bool(raw.showImage, DEFAULT_SETTINGS.showImage),
    showVideoPlayer: bool(raw.showVideoPlayer, DEFAULT_SETTINGS.showVideoPlayer),
    fetchMultipleImages: bool(raw.fetchMultipleImages, DEFAULT_SETTINGS.fetchMultipleImages),
    fetchDescription: bool(raw.fetchDescription, DEFAULT_SETTINGS.fetchDescription),
    fetchSiteName: bool(raw.fetchSiteName, DEFAULT_SETTINGS.fetchSiteName),
    fetchAuthor: bool(raw.fetchAuthor, DEFAULT_SETTINGS.fetchAuthor),
    fetchContent: bool(raw.fetchContent, DEFAULT_SETTINGS.fetchContent),
    lazyLoadMedia: bool(raw.lazyLoadMedia, DEFAULT_SETTINGS.lazyLoadMedia),
    cacheMinutes: boundedInt(raw.cacheMinutes, DEFAULT_SETTINGS.cacheMinutes, 0, 7 * 24 * 60),
    maxCacheEntries: boundedInt(raw.maxCacheEntries, DEFAULT_SETTINGS.maxCacheEntries, 10, 500),
    maxDescriptionLength: boundedInt(raw.maxDescriptionLength, DEFAULT_SETTINGS.maxDescriptionLength, 80, 5000),
    maxContentLength: boundedInt(raw.maxContentLength, DEFAULT_SETTINGS.maxContentLength, 100, 10000),
    maxGalleryImages: boundedInt(raw.maxGalleryImages, DEFAULT_SETTINGS.maxGalleryImages, 1, 20),
    autoRefreshOnOpen: bool(raw.autoRefreshOnOpen, DEFAULT_SETTINGS.autoRefreshOnOpen),
    useProviderCookies: bool(raw.useProviderCookies, DEFAULT_SETTINGS.useProviderCookies),
    previewBehavior: behavior(raw.previewBehavior, DEFAULT_SETTINGS.previewBehavior),
    previewCardMode: cardMode(raw.previewCardMode, DEFAULT_SETTINGS.previewCardMode),
    normalizeTrackingParams: bool(raw.normalizeTrackingParams, DEFAULT_SETTINGS.normalizeTrackingParams),
    requestTimeoutMs: boundedInt(raw.requestTimeoutMs, DEFAULT_SETTINGS.requestTimeoutMs, 3000, 60000),
    failureCacheSeconds: boundedInt(raw.failureCacheSeconds, DEFAULT_SETTINGS.failureCacheSeconds, 5, 300),
    blockedDomains: stringArray(raw.blockedDomains).map((host) => host.toLowerCase().replace(/^www\./, '')),
    domainRules: domainRules(raw.domainRules),
    recentPreviewUrls: stringArray(raw.recentPreviewUrls).slice(0, 50),
    failedPreviewUrls: stringArray(raw.failedPreviewUrls).slice(0, 30),
  };
}

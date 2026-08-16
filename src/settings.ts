import type { PluginSettings } from './types';

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
};

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
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
  };
}

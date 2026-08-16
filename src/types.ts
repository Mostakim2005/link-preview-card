export type ProviderId = 'generic' | 'youtube' | 'vimeo' | 'tiktok' | 'reddit' | 'instagram' | 'facebook' | 'x';

export type CookieProvider = 'facebook' | 'instagram' | 'reddit' | 'tiktok';

export interface CookieSessionRecord {
  cookie: string;
  updatedAt: number;
  expiresAt?: number;
}

export interface CookieSessionStatus {
  configured: boolean;
  updatedAt?: number;
  expiresAt?: number;
  masked?: string;
}

export interface PluginSettings {
  embedYouTube: boolean;
  embedVimeo: boolean;
  embedTikTok: boolean;
  embedReddit: boolean;
  embedX: boolean;
  showImage: boolean;
  showVideoPlayer: boolean;
  fetchMultipleImages: boolean;
  fetchDescription: boolean;
  fetchSiteName: boolean;
  fetchAuthor: boolean;
  fetchContent: boolean;
  lazyLoadMedia: boolean;
  cacheMinutes: number;
  maxCacheEntries: number;
  maxDescriptionLength: number;
  maxContentLength: number;
  maxGalleryImages: number;
  autoRefreshOnOpen: boolean;
  useProviderCookies: boolean;
}

export interface PreviewData {
  id?: string;
  url: string;
  title: string;
  description?: string;
  siteName?: string;
  author?: string;
  authorUrl?: string;
  contentText?: string;
  image?: string;
  images?: string[];
  video?: boolean;
  videoUrl?: string;
  provider?: ProviderId;
  fetchedAt?: number;
}

export interface PreviewBlock {
  startLine: number;
  endLine: number;
  source: string;
  data: PreviewData;
}

import { requestUrl } from 'obsidian';
import type { PreviewData } from '../types';
import type { ProviderContext } from './types';
import { absoluteUrl, hostOf } from '../utils/url';

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  author_url?: string;
  provider_name?: string;
  provider_url?: string;
  thumbnail_url?: string;
  description?: string;
  type?: string;
}

export async function fetchOEmbed(url: URL, endpoint: string, provider: PreviewData['provider'], context: ProviderContext): Promise<PreviewData | null> {
  try {
    const response = await requestUrl({
      url: `${endpoint}?url=${encodeURIComponent(url.href)}&format=json`,
      method: 'GET',
      headers: await providerHeaders(url.href, context),
    });
    const json = JSON.parse(response.text) as OEmbedResponse;
    const image = json.thumbnail_url ? absoluteUrl(url.href, json.thumbnail_url) : '';
    const data: PreviewData = {
      url: url.href,
      title: json.title?.trim() || url.href,
      description: trim(json.description, context.settings.maxDescriptionLength),
      author: context.settings.fetchAuthor ? json.author_name?.trim() : undefined,
      authorUrl: json.author_url ? absoluteUrl(url.href, json.author_url) : undefined,
      image,
      images: image ? [image] : [],
      provider,
      siteName: context.settings.fetchSiteName ? (json.provider_name || hostOf(url.href)) : undefined,
      video: json.type === 'video' || provider === 'youtube' || provider === 'vimeo' || provider === 'tiktok',
      fetchedAt: Date.now(),
    };
    return data;
  } catch {
    return null;
  }
}

export async function providerHeaders(url: string, context: ProviderContext): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Obsidian Link Preview Card)',
    Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  };
  if (context.settings.useProviderCookies) {
    // The URL argument is the actual HTTP destination. Cookies are only attached
    // when that destination belongs to a supported provider domain.
    const cookie = await context.cookies.getForUrl(url);
    if (cookie) headers.Cookie = cookie;
  }
  return headers;
}

function trim(value: string | undefined, max: number): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

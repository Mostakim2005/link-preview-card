import { requestUrl } from 'obsidian';
import type { LinkProvider, ProviderContext } from './types';
import type { PreviewData } from '../types';
import { absoluteUrl } from '../utils/url';
import { fetchOEmbed, providerHeaders } from './oembed';

export const youtubeProvider: LinkProvider = {
  id: 'youtube', domains: ['youtube.com', 'youtu.be'],
  match: (url) => ['youtube.com', 'youtu.be'].some((domain) => isSubdomain(url.hostname, domain)),
  fetch: (url, context) => fetchOEmbed(url, 'https://www.youtube.com/oembed', 'youtube', context),
};

export const vimeoProvider: LinkProvider = {
  id: 'vimeo', domains: ['vimeo.com'],
  match: (url) => ['vimeo.com'].some((domain) => isSubdomain(url.hostname, domain)),
  fetch: (url, context) => fetchOEmbed(url, 'https://vimeo.com/api/oembed.json', 'vimeo', context),
};

export const tiktokProvider: LinkProvider = {
  id: 'tiktok', domains: ['tiktok.com'],
  match: (url) => isSubdomain(url.hostname, 'tiktok.com'),
  fetch: async (url, context) => {
    const data = await fetchOEmbed(url, 'https://www.tiktok.com/oembed', 'tiktok', context);
    if (!data) return null;
    data.video = true;
    data.videoUrl = url.href;
    return data;
  },
};

export const redditProvider: LinkProvider = {
  id: 'reddit', domains: ['reddit.com', 'redd.it'],
  match: (url) => ['reddit.com', 'redd.it'].some((domain) => isSubdomain(url.hostname, domain)),
  fetch: async (url, context) => {
    const oembed = await fetchOEmbed(url, 'https://www.reddit.com/oembed', 'reddit', context);
    const post = await fetchRedditPost(url, context);
    return merge(oembed, post, 'reddit');
  },
};

export const xProvider: LinkProvider = {
  id: 'x', domains: ['x.com', 'twitter.com'],
  match: (url) => ['x.com', 'twitter.com'].some((domain) => isSubdomain(url.hostname, domain)),
  fetch: async (url, context) => fetchOEmbed(url, 'https://publish.twitter.com/oembed', 'x', context),
};

export const instagramProvider: LinkProvider = {
  id: 'instagram', domains: ['instagram.com'],
  match: (url) => isSubdomain(url.hostname, 'instagram.com'),
  fetch: async (url, context) => fetchSocialHtml(url, 'instagram', context),
};

export const facebookProvider: LinkProvider = {
  id: 'facebook', domains: ['facebook.com', 'fb.com'],
  match: (url) => ['facebook.com', 'fb.com'].some((domain) => isSubdomain(url.hostname, domain)),
  fetch: async (url, context) => fetchSocialHtml(url, 'facebook', context),
};


function isSubdomain(host: string, domain: string): boolean {
  const normalized = host.toLowerCase().replace(/^www\./, '');
  return normalized === domain || normalized.endsWith(`.${domain}`);
}

export const genericProvider: LinkProvider = {
  id: 'generic', domains: [], match: () => true, fetch: async () => null,
};

async function fetchSocialHtml(url: URL, provider: 'instagram' | 'facebook', context: ProviderContext): Promise<PreviewData | null> {
  try {
    const response = await requestUrl({ url: url.href, method: 'GET', headers: await providerHeaders(url.href, context) });
    const doc = new DOMParser().parseFromString(response.text, 'text/html');
    const meta = (selector: string): string => doc.querySelector(selector)?.getAttribute('content')?.trim() ?? '';
    const jsonLd = parseJsonLd(doc);
    const title = meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || jsonLd.name || doc.title.trim() || url.href;
    const description = meta('meta[property="og:description"]') || meta('meta[name="description"]') || jsonLd.description || '';
    const imageCandidates = [
      meta('meta[property="og:image"]'), meta('meta[property="og:image:url"]'), meta('meta[name="twitter:image"]'), jsonLd.image,
    ].map((value) => absoluteUrl(url.href, value)).filter(Boolean);
    const image = [...new Set(imageCandidates)][0] ?? '';
    const author = jsonLd.author || meta('meta[name="author"]');
    const structured = extractSocialStructuredData(doc);
    const contentText = provider === 'facebook' || provider === 'instagram'
      ? [extractVisibleSocialText(doc), structured.text].filter(Boolean).join('\n')
      : '';
    const structuredImage = structured.image ? absoluteUrl(url.href, structured.image) : '';
    const finalImage = image || structuredImage;
    const finalAuthor = author || structured.author;
    return {
      url: url.href,
      title: title || url.href,
      description: context.settings.fetchDescription ? description.slice(0, context.settings.maxDescriptionLength) || undefined : undefined,
      author: context.settings.fetchAuthor ? finalAuthor || undefined : undefined,
      image: finalImage || undefined,
      images: finalImage ? [finalImage] : [],
      contentText: context.settings.fetchContent ? contentText.slice(0, context.settings.maxContentLength) || undefined : undefined,
      siteName: context.settings.fetchSiteName ? provider : undefined,
      provider,
      video: false,
      videoUrl: undefined,
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

async function fetchRedditPost(url: URL, context: ProviderContext): Promise<PreviewData | null> {
  try {
    const jsonUrl = redditJsonUrl(url);
    if (!jsonUrl) return null;
    const response = await requestUrl({ url: jsonUrl, method: 'GET', headers: await providerHeaders(url.href, context) });
    const parsed = JSON.parse(response.text) as unknown;
    const post = getRedditPost(parsed);
    if (!post) return null;
    return {
      url: post.url || url.href,
      title: post.title || url.href,
      description: context.settings.fetchDescription ? post.selftext?.slice(0, context.settings.maxDescriptionLength) : undefined,
      contentText: context.settings.fetchContent ? post.selftext?.slice(0, context.settings.maxContentLength) : undefined,
      author: context.settings.fetchAuthor ? (post.author ? `u/${post.author}` : undefined) : undefined,
      image: post.thumbnail && /^https?:\/\//i.test(post.thumbnail) ? post.thumbnail : undefined,
      images: post.thumbnail && /^https?:\/\//i.test(post.thumbnail) ? [post.thumbnail] : [],
      siteName: context.settings.fetchSiteName ? (post.subreddit ? `r/${post.subreddit}` : 'Reddit') : undefined,
      provider: 'reddit',
      video: Boolean(post.is_video),
      videoUrl: post.media?.reddit_video?.fallback_url,
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

function redditJsonUrl(url: URL): string | null {
  const match = url.pathname.match(/\/comments\/([a-z0-9]+)(?:\/[^/]*)?/i);
  if (match?.[1]) return `https://www.reddit.com/comments/${match[1]}.json?raw_json=1`;
  if (url.hostname === 'redd.it') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    if (id) return `https://www.reddit.com/comments/${id}.json?raw_json=1`;
  }
  return null;
}

interface RedditPostShape {
  url?: string; title?: string; selftext?: string; author?: string; thumbnail?: string; subreddit?: string;
  is_video?: boolean; media?: { reddit_video?: { fallback_url?: string } };
}

function getRedditPost(value: unknown): RedditPostShape | null {
  if (!Array.isArray(value)) return null;
  const listing = value[0] as { data?: { children?: Array<{ data?: RedditPostShape }> } } | undefined;
  return listing?.data?.children?.[0]?.data ?? null;
}

function merge(first: PreviewData | null, second: PreviewData | null, provider: PreviewData['provider']): PreviewData | null {
  if (!first && !second) return null;
  if (!first) return second;
  if (!second) return first;
  return {
    ...first,
    ...second,
    url: first.url,
    title: first.title !== first.url ? first.title : second.title,
    description: second.description || first.description,
    contentText: second.contentText || first.contentText,
    image: second.image || first.image,
    images: second.images?.length ? second.images : first.images,
    provider,
    siteName: second.siteName || first.siteName,
    author: second.author || first.author,
    authorUrl: second.authorUrl || first.authorUrl,
  };
}

interface JsonLd { name?: string; description?: string; image?: string; author?: string; }

function parseJsonLd(doc: Document): JsonLd {
  for (const node of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const value: unknown = JSON.parse(node.textContent || '');
      const candidates: unknown[] = Array.isArray(value) ? value : [value];
      const candidate = candidates.find((item: unknown) => typeof item === 'object' && item !== null);
      if (typeof candidate === 'object' && candidate !== null) {
        const obj = candidate as Record<string, unknown>;
        const authorObj = typeof obj.author === 'object' && obj.author !== null ? obj.author as Record<string, unknown> : undefined;
        return {
          name: typeof obj.name === 'string' ? obj.name : undefined,
          description: typeof obj.description === 'string' ? obj.description : undefined,
          image: typeof obj.image === 'string' ? obj.image : Array.isArray(obj.image) ? String(obj.image[0] ?? '') : undefined,
          author: typeof obj.author === 'string' ? obj.author : authorObj && typeof authorObj.name === 'string' ? authorObj.name : undefined,
        };
      }
    } catch { /* ignore malformed JSON-LD */ }
  }
  return {};
}


function extractSocialStructuredData(doc: Document): { text: string; image: string; author: string } {
  const values: string[] = [];
  let image = '';
  let author = '';
  const wanted = new Set(['caption', 'description', 'text', 'title', 'alt', 'articleBody', 'headline']);
  const authorKeys = new Set(['username', 'screen_name', 'authorName']);
  const imageKeys = new Set(['display_url', 'thumbnail_url', 'image', 'image_url', 'thumbnailUrl']);
  const visit = (value: unknown, depth: number): void => {
    if (depth > 5 || values.length > 30) return;
    if (typeof value === 'string') return;
    if (Array.isArray(value)) { for (const item of value.slice(0, 30)) visit(item, depth + 1); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (typeof child === 'string') {
        const normalized = child.trim();
        if (wanted.has(key) && normalized.length > 0 && normalized.length < 4000) values.push(normalized);
        if (!author && authorKeys.has(key) && normalized.length > 0 && normalized.length < 300) author = normalized;
        if (!image && imageKeys.has(key) && /^https?:\/\//i.test(normalized)) image = normalized;
      } else {
        visit(child, depth + 1);
      }
    }
  };
  for (const node of Array.from(doc.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')).slice(0, 25)) {
    try { visit(JSON.parse(node.textContent || ''), 0); } catch { /* ignore non-JSON scripts */ }
  }
  const unique = [...new Set(values)];
  return { text: unique.slice(0, 5).join('\n').slice(0, 5000), image, author };
}

function extractVisibleSocialText(doc: Document): string {
  const selectors = ['meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]'];
  for (const selector of selectors) {
    const value = doc.querySelector(selector)?.getAttribute('content')?.trim();
    if (value) return value;
  }
  return '';
}


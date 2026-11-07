import { requestUrl } from "obsidian";
import { TIMEOUT_MS } from "./settings";
import { hostOf, parseUrl, rootDomainOf, cleanTrackingParams } from "./tracker";
import type { PreviewData } from "./types";

interface YouTubeOEmbed {
	title?: string;
	author_name?: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) =>
			window.setTimeout(() => reject(new Error("Timeout")), ms),
		),
	]);
}

/** Fetches OpenGraph/Twitter metadata for one URL. */
export async function fetchMeta(urlStr: string, stripTrackers = true): Promise<PreviewData> {
	const cleanUrl = stripTrackers ? cleanTrackingParams(urlStr) : urlStr;
	const parsed = parseUrl(cleanUrl);
	if (!parsed) throw new Error("Invalid URL");
	const host = hostOf(cleanUrl);

	if (host.includes("youtube.com") || host.includes("youtu.be")) {
		const videoId = host.includes("youtu.be")
			? parsed.pathname.slice(1)
			: parsed.searchParams.get("v") || "";
		if (videoId) {
			const image = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
			try {
				const oembed = await requestUrl({
					url: `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`,
					throw: false,
				});
				if (oembed.status === 200) {
					const json = oembed.json as YouTubeOEmbed;
					return {
						url: cleanUrl,
						title: json.title || "YouTube Video",
						description: json.author_name ? `Channel: ${json.author_name}` : "",
						image,
						icon: "https://www.youtube.com/s/desktop/favicon.ico",
						siteName: "YouTube",
					};
				}
			} catch {
				/* fall back to the standard scraper */
			}
		}
	}

	const res = await withTimeout(
		requestUrl({
			url: cleanUrl,
			headers: {
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"Accept-Language": "en-US,en;q=0.9",
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
			},
			throw: false,
		}),
		TIMEOUT_MS,
	);
	if (res.status >= 400) throw new Error(`HTTP ${res.status}`);

	const doc = new DOMParser().parseFromString(res.text, "text/html");
	const meta = (selector: string): string =>
		doc.querySelector(selector)?.getAttribute("content")?.trim() || "";
	const absolute = (value: string): string => {
		if (!value) return "";
		try {
			const u = new URL(value, cleanUrl);
			return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
		} catch {
			return "";
		}
	};

	const iconLink =
		doc.querySelector('link[rel~="apple-touch-icon"]') ??
		doc.querySelector('link[rel~="icon"]') ??
		doc.querySelector('link[rel="shortcut icon"]');

	const resolvedIcon =
		absolute(iconLink?.getAttribute("href")?.trim() || "") ||
		`https://www.google.com/s2/favicons?domain=${host}&sz=128`;

	return {
		url: cleanUrl,
		title: (
			meta('meta[property="og:title"]') ||
			meta('meta[name="twitter:title"]') ||
			(doc.title || "").trim() ||
			host
		).slice(0, 300),
		description: (
			meta('meta[property="og:description"]') ||
			meta('meta[name="twitter:description"]') ||
			meta('meta[name="description"]')
		).slice(0, 300),
		image: absolute(
			meta('meta[property="og:image"]') ||
				meta('meta[property="og:image:secure_url"]') ||
				meta('meta[property="og:image:url"]') ||
				meta('meta[name="twitter:image"]') ||
				meta('meta[name="twitter:image:src"]') ||
				doc.querySelector('link[rel="image_src"]')?.getAttribute("href")?.trim() ||
				"",
		),
		icon: resolvedIcon,
		siteName: meta('meta[property="og:site_name"]') || rootDomainOf(cleanUrl),
	};
}

/** Fetches metadata for many URLs with bounded concurrency. */
export async function fetchAll(
	urls: string[],
	limit: number,
	onProgress: (done: number, total: number) => void,
	stripTrackers = true,
): Promise<Map<string, PreviewData>> {
	const results = new Map<string, PreviewData>();
	let next = 0;
	let done = 0;

	const worker = async (): Promise<void> => {
		while (next < urls.length) {
			const url = urls[next++];
			if (!url) continue;
			try {
				results.set(url, await fetchMeta(url, stripTrackers));
			} catch {
				/* leave missing */
			}
			onProgress(++done, urls.length);
		}
	};

	await Promise.all(
		Array.from({ length: Math.min(limit, urls.length) }, () => worker()),
	);
	return results;
}

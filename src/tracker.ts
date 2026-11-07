import { SECOND_LEVEL_TLDS } from "./settings";

const UNIVERSAL_TRACKING_PARAMS = new Set([
	// UTM & analytics
	"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
	"utm_id", "utm_source_platform", "utm_creative_format", "utm_marketing_tactic",
	"utm_name", "utm_cid", "utm_reader", "utm_viz_id", "utm_pubreferrer",
	// Facebook / Meta / Instagram / Threads / Messenger
	"fbclid", "igshid", "mibextid", "paipv", "__cft__", "__tn__", "fref",
	// Google / DoubleClick / Ads
	"gclid", "gbraid", "wbraid", "dclid", "gclsrc", "_ga", "_gl",
	// Twitter / X
	"twclid", "ref_src", "ref_url",
	// Microsoft / Bing
	"msclkid",
	// TikTok / Snapchat
	"ttclid", "sccid", "_r", "_t", "tt_from",
	// LinkedIn / professional
	"trackingid", "trk", "trkinfo", "midsig", "midtoken",
	// Reddit
	"rdt_cid", "share_id",
	// Mailchimp / Hubspot / Marketo
	"mc_cid", "mc_eid", "_hsenc", "_hsmi", "hsctatracking", "mkt_tok",
	// Affiliate / click / session trackers
	"wickedid", "zanpid", "yclid", "vero_id", "vero_conv", "irclickid",
	"oly_enc_id", "oly_anon_id", "rb_clickid", "soc_src", "soc_trk",
]);

/**
 * Strips tracking parameters, telemetry identifiers, and user share tokens
 * across YouTube, Twitter/X, Spotify, Amazon, Facebook, Google, Reddit,
 * ChatGPT, Telegram, Substack, and Medium.
 */
export function cleanTrackingParams(urlStr: string): string {
	if (!urlStr || typeof urlStr !== "string") return urlStr;
	try {
		const u = new URL(urlStr.trim());

		if (
			(u.hostname === "www.google.com" || u.hostname === "google.com") &&
			u.pathname === "/url" &&
			u.searchParams.has("q")
		) {
			const target = u.searchParams.get("q");
			if (target && /^https?:\/\//i.test(target)) return cleanTrackingParams(target);
		}
		if (
			(u.hostname.includes("facebook.com") || u.hostname.includes("messenger.com")) &&
			(u.pathname === "/l.php" || u.pathname === "/l/")
		) {
			const target = u.searchParams.get("u");
			if (target && /^https?:\/\//i.test(target)) return cleanTrackingParams(target);
		}

		const host = u.hostname.toLowerCase();

		if (host.includes("amazon.")) {
			const dpMatch = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
			if (dpMatch?.[1]) {
				u.pathname = `/dp/${dpMatch[1]}`;
				u.search = "";
				return u.href;
			}
		}

		const toDelete: string[] = [];
		for (const [key] of u.searchParams.entries()) {
			const lower = key.toLowerCase();
			if (UNIVERSAL_TRACKING_PARAMS.has(lower) || lower.startsWith("utm_")) {
				toDelete.push(key);
				continue;
			}
			if (
				(host.includes("youtube.com") || host.includes("youtu.be")) &&
				["si", "feature", "pp", "embeds_referring_euri", "source_ve_path"].includes(lower)
			) {
				toDelete.push(key);
				continue;
			}
			if (host.includes("spotify.com") && ["si", "nd", "context", "go"].includes(lower)) {
				toDelete.push(key);
				continue;
			}
			if (
				(host.includes("twitter.com") || host.includes("x.com")) &&
				["s", "t", "ref_src", "ref_url"].includes(lower)
			) {
				toDelete.push(key);
				continue;
			}
			if (
				host.includes("reddit.com") &&
				["share_id", "rdt", "ref_source", "ref"].includes(lower)
			) {
				toDelete.push(key);
				continue;
			}
			if (host.includes("chatgpt.com") && ["ref", "referrer", "opencounter"].includes(lower)) {
				toDelete.push(key);
				continue;
			}
			if (
				(host.includes("substack.com") || host.includes("medium.com")) &&
				["source", "r", "publication_id", "post_id"].includes(lower)
			) {
				toDelete.push(key);
				continue;
			}
			if (host.includes("t.me") && lower === "tgwebappstartparam") {
				toDelete.push(key);
				continue;
			}
			if (lower === "ref" || lower === "referrer") {
				toDelete.push(key);
				continue;
			}
		}

		toDelete.forEach((key) => u.searchParams.delete(key));

		return u.href.replace(/\?$/, "").replace(/#$/, "");
	} catch {
		return urlStr;
	}
}

export function parseUrl(text: string, strip = false): URL | null {
	const trimmed = (text || "").trim();
	if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
	try {
		const raw = strip ? cleanTrackingParams(trimmed) : trimmed;
		return new URL(raw);
	} catch {
		return null;
	}
}

export function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
	} catch {
		return url;
	}
}

/**
 * Extracts the main website domain + TLD (chat.deepseek.com -> deepseek.com).
 * Preserves IP addresses and multi-part country TLDs.
 */
export function rootDomainOf(url: string): string {
	const host = hostOf(url);
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;

	const parts = host.split(".").filter(Boolean);
	if (parts.length <= 2) return host;

	const tld = parts[parts.length - 1] ?? "";
	const sld = parts[parts.length - 2] ?? "";
	if (tld.length === 2 && SECOND_LEVEL_TLDS.has(sld.toLowerCase()) && parts.length >= 3) {
		return parts.slice(-3).join(".");
	}
	return parts.slice(-2).join(".");
}

/** Clean label for the placeholder box, falling back to the root domain. */
export function logoLabelOf(data: { url: string; siteName?: string }): string {
	const root = rootDomainOf(data.url);
	const raw = (data.siteName || "").trim();
	if (!raw) return root;
	if (raw.includes(".") || raw.length > 24) return root;
	return raw;
}

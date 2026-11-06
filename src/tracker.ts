// Link Preview Card — tracker stripper + helpers from Nihon 4.4.0 (L50-250)
const UNIVERSAL_TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id", "utm_source_platform", "utm_creative_format", "utm_marketing_tactic", "utm_name", "utm_cid",
  "fbclid", "igshid", "mibextid", "paipv", "__cft__", "__tn__", "fref",
  "gclid", "gbraid", "wbraid", "dclid", "gclsrc", "_ga", "_gl",
  "twclid", "ref_src", "ref_url",
  "msclkid", "ttclid", "sccid", "_r", "_t", "tt_from",
  "trackingid", "trk", "trkinfo",
  "rdt_cid", "share_id",
  "mc_cid", "mc_eid", "_hsenc", "_hsmi", "hsctatracking", "mkt_tok",
  "wickedid", "zanpid", "yclid", "vero_id", "vero_conv", "irclickid",
]);

export function cleanTrackingParams(urlStr: string): string {
  if (!urlStr || typeof urlStr !== "string") return urlStr;
  try {
    let u = new URL(urlStr.trim());
    if ((u.hostname === "www.google.com" || u.hostname === "google.com") && u.pathname === "/url" && u.searchParams.has("q")) {
      const target = u.searchParams.get("q");
      if (target && /^https?:\/\//i.test(target)) return cleanTrackingParams(target);
    }
    if ((u.hostname.includes("facebook.com") || u.hostname.includes("messenger.com")) && (u.pathname === "/l.php" || u.pathname === "/l/")) {
      const target = u.searchParams.get("u");
      if (target && /^https?:\/\//i.test(target)) return cleanTrackingParams(target);
    }
    const host = u.hostname.toLowerCase();
    if (host.includes("amazon.")) {
      const dpMatch = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      if (dpMatch) {
        u.pathname = "/dp/" + dpMatch[1];
        u.search = "";
        return u.href;
      }
    }
    const toDelete: string[] = [];
    for (const [key] of u.searchParams.entries()) {
      const lower = key.toLowerCase();
      if (UNIVERSAL_TRACKING_PARAMS.has(lower) || lower.startsWith("utm_")) { toDelete.push(key); continue; }
      if ((host.includes("youtube.com") || host.includes("youtu.be")) && ["si", "feature", "pp"].includes(lower)) { toDelete.push(key); continue; }
      if (host.includes("spotify.com") && ["si", "nd", "context", "go"].includes(lower)) { toDelete.push(key); continue; }
      if ((host.includes("twitter.com") || host.includes("x.com")) && ["s", "t", "ref_src", "ref_url"].includes(lower)) { toDelete.push(key); continue; }
    }
    for (const k of toDelete) u.searchParams.delete(k);
    return u.href;
  } catch {
    return urlStr;
  }
}

export function parseUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

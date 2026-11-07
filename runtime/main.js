"use strict";

const {
  Plugin,
  PluginSettingTab,
  Setting,
  Modal,
  FuzzySuggestModal,
  Menu,
  Notice,
  TFile,
  MarkdownView,
  requestUrl,
  setIcon,
  setTooltip,
} = require("obsidian");

// Same block format as previous versions for 100% backward compatibility
const FENCE_OPEN = "~~~link-preview";
const FENCE_CLOSE = "~~~";
const DEFAULTS = {
  autoPreview: true,
  showDescription: true,
  stripTrackers: true, // Automatically strip tracking params & telemetry IDs
  cardLayout: "standard", // "standard" | "banner" | "compact"
  mediaPosition: "left", // "left" | "right"
  actionPlacement: "right", // "right" | "space-between" | "space-evenly" | "left"
  cardRadius: "rounded", // "rounded" | "sharp" | "pill"
  showFavicon: true,
  placeholderStyle: "logo-name", // "logo-name" | "icon-and-name"
  placeholderFont: "",
  glassmorphism: true,
  visibleActions: {
    copy: true,
    alias: true,
    image: true,
    refresh: true,
    open: true,
    revert: true,
  },
};
const TIMEOUT_MS = 10000;
const FETCH_CONCURRENCY = 3;

// Common second-level domain parts (for sites like example.co.uk or example.com.bd)
const SECOND_LEVEL_TLDS = new Set([
  "co", "com", "org", "net", "gov", "edu", "ac", "vic", "nsw", "qc", "bc"
]);
const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"];

/* ----------------------------- Tracker Stripping Engine ----------------------------- */

const UNIVERSAL_TRACKING_PARAMS = new Set([
  // UTM & Analytics
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
  
  // LinkedIn / Professional
  "trackingid", "trk", "trkinfo", "midsig", "midtoken",

  // Reddit
  "rdt_cid", "share_id",
  
  // Mailchimp / Hubspot / Marketo
  "mc_cid", "mc_eid", "_hsenc", "_hsmi", "hsctatracking", "mkt_tok",
  
  // Affiliate / General Click / Session Trackers
  "wickedid", "zanpid", "yclid", "vero_id", "vero_conv", "irclickid",
  "oly_enc_id", "oly_anon_id", "rb_clickid", "soc_src", "soc_trk"
]);

/**
 * Strips tracking parameters, telemetry identifiers, and user share tokens
 * across YouTube, Twitter/X, Spotify, Amazon, Facebook, Google, ChatGPT, Telegram, etc.
 */
function cleanTrackingParams(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return urlStr;
  try {
    let u = new URL(urlStr.trim());

    // Unwrap Google and Facebook redirect wrapper links
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

    // Canonicalize Amazon URLs to /dp/ASIN
    if (host.includes("amazon.")) {
      const dpMatch = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
      if (dpMatch) {
        u.pathname = "/dp/" + dpMatch[1];
        u.search = "";
        return u.href;
      }
    }

    const toDelete = [];
    for (const [key] of u.searchParams.entries()) {
      const lower = key.toLowerCase();
      if (UNIVERSAL_TRACKING_PARAMS.has(lower) || lower.startsWith("utm_")) {
        toDelete.push(key);
        continue;
      }
      // YouTube: strip 'si' (share tracker), 'feature', 'pp', etc. Keep 'v', 't', 'list'
      if (
        (host.includes("youtube.com") || host.includes("youtu.be")) &&
        ["si", "feature", "pp", "embeds_referring_euri", "source_ve_path"].includes(lower)
      ) {
        toDelete.push(key);
        continue;
      }
      // Spotify: strip 'si' (personal share tracking token)
      if (host.includes("spotify.com") && ["si", "nd", "context", "go"].includes(lower)) {
        toDelete.push(key);
        continue;
      }
      // Twitter / X: strip 's' and 't' (tweet tracking tokens)
      if ((host.includes("twitter.com") || host.includes("x.com")) && ["s", "t", "ref_src", "ref_url"].includes(lower)) {
        toDelete.push(key);
        continue;
      }
      // Reddit: strip share tracker
      if (host.includes("reddit.com") && ["share_id", "rdt", "ref_source", "ref"].includes(lower)) {
        toDelete.push(key);
        continue;
      }
      // ChatGPT: strip referral tokens
      if (host.includes("chatgpt.com") && ["ref", "referrer", "opencounter"].includes(lower)) {
        toDelete.push(key);
        continue;
      }
      // Substack & Medium
      if ((host.includes("substack.com") || host.includes("medium.com")) && ["source", "r", "publication_id", "post_id"].includes(lower)) {
        toDelete.push(key);
        continue;
      }
      // Telegram web tracking
      if (host.includes("t.me") && ["tgwebappstartparam"].includes(lower)) {
        toDelete.push(key);
        continue;
      }
      // General ref/referrer
      if (lower === "ref" || lower === "referrer") {
        toDelete.push(key);
        continue;
      }
    }

    toDelete.forEach((k) => u.searchParams.delete(k));

    let cleaned = u.href;
    cleaned = cleaned.replace(/\?$/, "").replace(/#$/, "");
    return cleaned;
  } catch {
    return urlStr;
  }
}

/* ----------------------------- Helpers ----------------------------- */

function parseUrl(text, strip = false) {
  const t = (text || "").trim();
  if (!/^https?:\/\/\S+$/i.test(t)) return null;
  try {
    const raw = strip ? cleanTrackingParams(t) : t;
    return new URL(raw);
  } catch {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return url;
  }
}

/**
 * Extracts only the main website domain + TLD (e.g. "chat.deepseek.com" -> "deepseek.com").
 * Correctly preserves IP addresses and multi-part country TLDs.
 */
function rootDomainOf(url) {
  const host = hostOf(url);
  // IP address check: do not mangle 192.168.1.1 into 1.1
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;

  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;

  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  if (tld.length === 2 && SECOND_LEVEL_TLDS.has(sld.toLowerCase()) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

/**
 * Picks a clean label for the placeholder box:
 * - If siteName is missing, is a domain, or is excessively long (> 24 chars),
 *   fallback to the root domain.
 */
function logoLabelOf(data) {
  const root = rootDomainOf(data.url);
  const raw = (data.siteName || "").trim();
  if (!raw) return root;
  if (raw.includes(".") || raw.length > 24) return root;
  return raw;
}

function makeId() {
  return "lp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function clean(obj) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== "" && v !== undefined && v !== null)
  );
}

function serialize(data) {
  return `${FENCE_OPEN}\n${JSON.stringify(clean(data))}\n${FENCE_CLOSE}`;
}

function findBlocks(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (start < 0) {
      if (t === FENCE_OPEN) start = i;
      continue;
    }
    if (t === FENCE_CLOSE) {
      try {
        const rawJson = lines.slice(start + 1, i).join("\n");
        const data = JSON.parse(rawJson);
        if (typeof data.url === "string") out.push({ start, end: i, data });
      } catch {
        /* invalid preview block */
      }
      start = -1;
    }
  }
  return out;
}

function findBlock(text, data) {
  const blocks = findBlocks(text);
  if (data.id) {
    const found = blocks.find((b) => b.data.id === data.id);
    if (found) return found;
  }
  return blocks.find((b) => b.data.url === data.url) || null;
}

function replaceBlock(text, block, replacement) {
  const isCRLF = text.includes("\r\n");
  const newline = isCRLF ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  lines.splice(block.start, block.end - block.start + 1, ...replacement.split(/\r?\n/));
  return lines.join(newline);
}

function scanLinks(text, stripTrackers = false) {
  const lines = text.split(/\r?\n/);
  const owner = new Map();
  for (const b of findBlocks(text)) {
    for (let i = b.start; i <= b.end; i++) owner.set(i, b);
  }

  const items = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const block = owner.get(i);
    if (block) {
      if (i === block.start) {
        items.push({
          type: "preview",
          line: block.start,
          end: block.end,
          url: block.data.url,
          title: block.data.alias || block.data.title || "",
        });
      }
      continue;
    }

    const raw = lines[i].trim();
    if (raw.startsWith("```") || raw.startsWith("~~~")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    // Strip markdown list markers (- , * , + , 1. ) to allow list items to be convertible
    const cleanLine = raw.replace(/^(\s*[-*+]|\s*\d+\.)\s+/, "");
    const whole = parseUrl(cleanLine);
    if (whole) {
      const targetUrl = stripTrackers ? cleanTrackingParams(whole.href) : whole.href;
      items.push({ type: "link", line: i, end: i, url: targetUrl });
      continue;
    }
    for (const m of raw.matchAll(/https?:\/\/[^\s<>()"'\]]+/gi)) {
      const u = parseUrl(m[0].replace(/[.,;:!?]+$/, ""));
      if (u) {
        const targetUrl = stripTrackers ? cleanTrackingParams(u.href) : u.href;
        items.push({ type: "inline", line: i, end: i, url: targetUrl });
      }
    }
  }
  return items;
}

function insideFence(editor) {
  let open = false;
  for (let i = 0; i <= editor.getCursor().line; i++) {
    const t = editor.getLine(i).trim();
    if (t.startsWith("```") || t.startsWith("~~~")) open = !open;
  }
  return open;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => window.setTimeout(() => reject(new Error("Timeout")), ms)),
  ]);
}

async function fetchMeta(urlStr, stripTrackers = true) {
  const cleanUrl = stripTrackers ? cleanTrackingParams(urlStr) : urlStr;
  const parsed = parseUrl(cleanUrl);
  if (!parsed) throw new Error("Invalid URL");
  const host = hostOf(cleanUrl);

  // Specialized zero-network extractors
  // 1. YouTube
  if (host.includes("youtube.com") || host.includes("youtu.be")) {
    let videoId = "";
    if (host.includes("youtu.be")) {
      videoId = parsed.pathname.slice(1);
    } else {
      videoId = parsed.searchParams.get("v") || "";
    }
    if (videoId) {
      const img = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      try {
        const oembed = await requestUrl({
          url: `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`,
          throw: false,
        });
        if (oembed.status === 200) {
          const json = oembed.json;
          return {
            url: cleanUrl,
            title: json.title || "YouTube Video",
            description: json.author_name ? `Channel: ${json.author_name}` : "",
            image: img,
            icon: "https://www.youtube.com/s/desktop/favicon.ico",
            siteName: "YouTube",
          };
        }
      } catch {
        /* fallback to standard scraper */
      }
    }
  }

  // General scraper with browser-like headers
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
    TIMEOUT_MS
  );
  if (res.status >= 400) throw new Error("HTTP " + res.status);

  const doc = new DOMParser().parseFromString(res.text, "text/html");
  const meta = (sel) => doc.querySelector(sel)?.getAttribute("content")?.trim() || "";
  const absolute = (value) => {
    if (!value) return "";
    try {
      const u = new URL(value, cleanUrl);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
    } catch {
      return "";
    }
  };

  const iconLink =
    doc.querySelector('link[rel~="apple-touch-icon"]') ||
    doc.querySelector('link[rel~="icon"]') ||
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
      ""
    ),
    icon: resolvedIcon,
    siteName: meta('meta[property="og:site_name"]') || rootDomainOf(cleanUrl),
  };
}

async function fetchAll(urls, limit, onProgress, stripTrackers = true) {
  const results = new Map();
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++];
      try {
        results.set(url, await fetchMeta(url, stripTrackers));
      } catch {
        /* leave missing */
      }
      onProgress(++done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, urls.length) }, worker));
  return results;
}

/* ---------- alias modal ---------- */

class AliasModal extends Modal {
  constructor(app, data, onSave) {
    super(app);
    this.data = data;
    this.onSave = onSave;
  }

  onOpen() {
    this.modalEl.addClass("lpc-dialog", "lpc-dialog-small");
    this.titleEl.setText("Edit alias");
    const wrap = this.contentEl.createDiv({ cls: "lpc-manager lpc-alias" });
    const input = wrap.createEl("input", { type: "text", cls: "lpc-input" });
    input.value = this.data.alias || "";
    input.placeholder = this.data.title || this.data.url;
    input.focus();

    const save = () => {
      const value = input.value.trim();
      this.close();
      this.onSave(value);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
    });
    wrap.createDiv({ cls: "lpc-hint", text: "Leave empty to show the page title." });

    const foot = wrap.createDiv({ cls: "lpc-footer" });
    foot.createDiv({ cls: "lpc-status" });
    const actions = foot.createDiv({ cls: "lpc-footer-actions" });
    actions
      .createEl("button", { cls: "lpc-btn lpc-btn-text", text: "Cancel", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    actions
      .createEl("button", { cls: "lpc-btn lpc-btn-filled", text: "Save", attr: { type: "button" } })
      .addEventListener("click", save);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ---------- link manager modal ---------- */

const TYPE_LABEL = { link: "Link", preview: "Preview", inline: "Inline" };
const TYPE_ICON = { link: "link", preview: "image", inline: "text" };

class LinksModal extends Modal {
  constructor(app, plugin, file) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.items = [];
    this.selected = new Set();
    this.filter = "all";
    this.busy = false;
    this.rows = [];
  }

  async onOpen() {
    this.modalEl.addClass("lpc-dialog");
    this.titleEl.setText("Manage links");
    await this.reload();
  }

  onClose() {
    this.contentEl.empty();
  }

  async reload() {
    const text = await this.app.vault.read(this.file);
    this.items = scanLinks(text, this.plugin.settings.stripTrackers);
    this.selected.clear();
    this.render();
  }

  count(type) {
    return this.items.filter((it) => it.type === type).length;
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass("lpc-manager");

    root.createDiv({
      cls: "lpc-sub",
      text: `${this.file.basename} · ${this.count("preview")} previews · ${this.count("link")} links · ${this.count("inline")} inline`,
    });

    const chips = root.createDiv({ cls: "lpc-filters", attr: { role: "group", "aria-label": "Filter" } });
    this.chipEls = {};
    for (const [key, label, n] of [
      ["all", "All", this.items.length],
      ["link", "Links", this.count("link")],
      ["preview", "Previews", this.count("preview")],
    ]) {
      const chip = chips.createEl("button", {
        cls: "lpc-filter",
        text: `${label} (${n})`,
        attr: { type: "button" },
      });
      chip.addEventListener("click", () => this.setFilter(key));
      this.chipEls[key] = chip;
    }

    const bar = root.createDiv({ cls: "lpc-toolbar" });
    const tool = (icon, label, handler) => {
      const btn = bar.createEl("button", { cls: "lpc-btn lpc-btn-text", attr: { type: "button" } });
      setIcon(btn.createSpan({ cls: "lpc-btn-icon" }), icon);
      btn.createSpan({ text: label });
      btn.addEventListener("click", handler);
    };
    tool("check-check", "All", () => this.selectAll());
    tool("x", "None", () => this.selectNone());
    tool("arrow-left-right", "Invert", () => this.invert());
    tool("shield-check", "Clean trackers", async () => {
      await this.plugin.cleanTrackersInFile(this.file);
      await this.reload();
    });
    this.countEl = bar.createDiv({ cls: "lpc-count" });

    this.listEl = root.createDiv({ cls: "lpc-list" });

    const foot = root.createDiv({ cls: "lpc-footer" });
    this.statusEl = foot.createDiv({ cls: "lpc-status" });
    const actions = foot.createDiv({ cls: "lpc-footer-actions" });
    this.toLinkBtn = actions.createEl("button", { cls: "lpc-btn lpc-btn-tonal", attr: { type: "button" } });
    this.toPreviewBtn = actions.createEl("button", { cls: "lpc-btn lpc-btn-filled", attr: { type: "button" } });
    this.toLinkBtn.addEventListener("click", () => this.run("toLink"));
    this.toPreviewBtn.addEventListener("click", () => this.run("toPreview"));

    this.applyFilterState();
    this.renderList();
  }

  applyFilterState() {
    for (const [key, el] of Object.entries(this.chipEls)) {
      el.toggleClass("is-active", key === this.filter);
      el.setAttribute("aria-pressed", String(key === this.filter));
    }
  }

  setFilter(key) {
    this.filter = key;
    this.applyFilterState();
    this.renderList();
  }

  visibleIndexes() {
    const out = [];
    this.items.forEach((it, i) => {
      if (this.filter === "all" || it.type === this.filter) out.push(i);
    });
    return out;
  }

  renderList() {
    this.listEl.empty();
    this.rows = [];
    const visible = this.visibleIndexes();

    if (!visible.length) {
      const empty = this.listEl.createDiv({ cls: "lpc-empty" });
      setIcon(empty.createDiv({ cls: "lpc-empty-icon" }), "link-2-off");
      empty.createDiv({ text: this.items.length ? "Nothing in this filter" : "No links in this note" });
      this.updateFooter();
      return;
    }

    for (const i of visible) {
      const item = this.items[i];
      const convertible = item.type !== "inline";

      const row = this.listEl.createEl("label", { cls: "lpc-row" });
      row.toggleClass("is-disabled", !convertible);

      const input = row.createEl("input", { type: "checkbox", cls: "lpc-check" });
      input.disabled = !convertible;
      input.checked = this.selected.has(i);
      row.toggleClass("is-selected", input.checked);
      input.addEventListener("change", () => {
        if (input.checked) this.selected.add(i);
        else this.selected.delete(i);
        row.toggleClass("is-selected", input.checked);
        this.updateFooter();
      });

      setIcon(row.createDiv({ cls: `lpc-lead is-${item.type}` }), TYPE_ICON[item.type]);

      const text = row.createDiv({ cls: "lpc-text" });
      text.createDiv({ cls: "lpc-row-title", text: item.title || hostOf(item.url) });
      text.createDiv({ cls: "lpc-row-sub", text: `Line ${item.line + 1} · ${item.url}` });

      row.createSpan({ cls: `lpc-status-chip is-${item.type}`, text: TYPE_LABEL[item.type] });

      this.rows.push({ i, input, row, convertible });
    }
    this.updateFooter();
  }

  setRowSelected(entry, on) {
    if (!entry.convertible) return;
    entry.input.checked = on;
    if (on) this.selected.add(entry.i);
    else this.selected.delete(entry.i);
    entry.row.toggleClass("is-selected", on);
  }

  selectAll() {
    this.rows.forEach((r) => this.setRowSelected(r, true));
    this.updateFooter();
  }
  selectNone() {
    this.rows.forEach((r) => this.setRowSelected(r, false));
    this.updateFooter();
  }
  invert() {
    this.rows.forEach((r) => this.setRowSelected(r, !this.selected.has(r.i)));
    this.updateFooter();
  }

  selectedOf(type) {
    return [...this.selected].map((i) => this.items[i]).filter((it) => it.type === type);
  }

  updateFooter() {
    const links = this.selectedOf("link").length;
    const previews = this.selectedOf("preview").length;
    const total = this.selected.size;
    this.countEl.setText(total ? `${total} selected` : "None selected");

    const label = (btn, icon, text, n, disabled) => {
      btn.empty();
      setIcon(btn.createSpan({ cls: "lpc-btn-icon" }), icon);
      btn.createSpan({ text });
      if (n > 0) btn.createSpan({ cls: "lpc-badge", text: String(n) });
      btn.disabled = disabled;
    };
    label(this.toLinkBtn, "undo", "Back to links", previews, this.busy || previews === 0);
    label(this.toPreviewBtn, "layout-template", "Make previews", links, this.busy || links === 0);
  }

  setStatus(text) {
    this.statusEl.setText(text);
  }

  async run(kind) {
    if (this.busy) return;
    const targets = this.selectedOf(kind === "toPreview" ? "link" : "preview");
    if (!targets.length) return;

    this.busy = true;
    this.updateFooter();
    try {
      let metas = new Map();
      if (kind === "toPreview") {
        const urls = [...new Set(targets.map((t) => t.url))];
        this.setStatus(`Fetching 0 of ${urls.length}…`);
        metas = await fetchAll(
          urls,
          FETCH_CONCURRENCY,
          (done, total) => this.setStatus(`Fetching ${done} of ${total}…`),
          this.plugin.settings.stripTrackers
        );
      }
      const { applied, failed } = await this.plugin.applyChanges(this.file, targets, metas);
      new Notice(
        kind === "toPreview"
          ? `${applied} converted to previews${failed ? `, ${failed} failed` : ""}`
          : `${applied} turned back into links`
      );
    } catch {
      new Notice("Something went wrong. No changes were made.");
    } finally {
      this.busy = false;
      this.setStatus("");
      await this.reload();
    }
  }
}

/* ---------- preview image modal ---------- */

class ImagePicker extends FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Choose an image from your vault");
  }

  getItems() {
    return this.app.vault.getFiles().filter((f) => IMAGE_EXT.includes(f.extension.toLowerCase()));
  }

  getItemText(file) {
    return file.path;
  }

  onChooseItem(file) {
    this.onChoose(file.path);
  }
}

class ImageModal extends Modal {
  constructor(app, plugin, data, sourcePath, onDone) {
    super(app);
    this.plugin = plugin;
    this.data = data;
    this.sourcePath = sourcePath;
    this.onDone = onDone;
  }

  onOpen() {
    this.modalEl.addClass("lpc-dialog", "lpc-dialog-small");
    this.titleEl.setText("Preview image");
    const wrap = this.contentEl.createDiv({ cls: "lpc-manager lpc-alias" });

    const input = wrap.createEl("input", { type: "text", cls: "lpc-input" });
    input.value = this.data.image || "";
    input.placeholder = "Image link or path in your vault";

    const row = wrap.createDiv({ cls: "lpc-field-row" });
    const tool = (icon, label, handler) => {
      const btn = row.createEl("button", { cls: "lpc-btn lpc-btn-tonal", attr: { type: "button" } });
      setIcon(btn.createSpan({ cls: "lpc-btn-icon" }), icon);
      btn.createSpan({ text: label });
      btn.addEventListener("click", handler);
    };

    tool("image-plus", "Choose from vault", () => {
      this.plugin.openVaultImageChooser((chosenPath) => {
        if (!chosenPath) return;
        input.value = chosenPath;
        this.close();
        void this.onDone("set", chosenPath);
      });
    });
    tool("image-off", "No image", () => {
      this.close();
      void this.onDone("remove");
    });
    tool("refresh-cw", "Automatic", () => {
      this.close();
      void this.onDone("auto");
    });

    wrap.createDiv({
      cls: "lpc-hint",
      text: "Tip: take a screenshot of the site, then press Ctrl+V here to use it as the image.",
    });

    this.contentEl.addEventListener("paste", async (evt) => {
      const file = [...(evt.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (!file) return;
      evt.preventDefault();
      try {
        input.value = await this.plugin.saveImageBlob(file, this.sourcePath);
        new Notice("Image saved to your vault");
      } catch {
        new Notice("Couldn't save the pasted image");
      }
    });

    const save = () => {
      const value = input.value.trim();
      if (!value) {
        this.close();
        void this.onDone("remove");
        return;
      }
      if (!this.plugin.resolveImage(value, this.sourcePath)) {
        new Notice("Not a valid link or vault image");
        return;
      }
      this.close();
      void this.onDone("set", value);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
    });

    const foot = wrap.createDiv({ cls: "lpc-footer" });
    foot.createDiv({ cls: "lpc-status" });
    const actions = foot.createDiv({ cls: "lpc-footer-actions" });
    actions
      .createEl("button", { cls: "lpc-btn lpc-btn-text", text: "Cancel", attr: { type: "button" } })
      .addEventListener("click", () => this.close());
    actions
      .createEl("button", { cls: "lpc-btn lpc-btn-filled", text: "Save", attr: { type: "button" } })
      .addEventListener("click", save);
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ---------- plugin core ---------- */

module.exports = class LinkPreviewCard extends Plugin {
  applyThemePreferences() {
    if (typeof document !== "undefined") {
      document.body.toggleClass("lpc-glassmorphic", Boolean(this.settings.glassmorphism ?? true));
    }
  }

  async onload() {
    const raw = (await this.loadData()) ?? {};
    this.settings = Object.assign({}, DEFAULTS, raw);
    if (raw.visibleActions) {
      this.settings.visibleActions = Object.assign({}, DEFAULTS.visibleActions, raw.visibleActions);
    }
    if (Object.keys(raw).some((k) => !(k in DEFAULTS))) {
      await this.saveData(this.settings);
    }

    this.applyThemePreferences();

    this.menuSeen = new WeakSet();

    this.registerMarkdownCodeBlockProcessor("link-preview", (source, el, ctx) =>
      this.renderCard(source, el, ctx)
    );

    this.registerEvent(
      this.app.workspace.on("editor-paste", (evt, editor) => this.onPaste(evt, editor))
    );
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => this.onEditorMenu(menu, editor))
    );
    this.registerEvent(
      this.app.workspace.on("url-menu", (menu, url) => this.onUrlMenu(menu, url))
    );

    this.addCommand({
      id: "manage-links",
      name: "Manage links in current note",
      callback: () => {
        void this.openManager();
      },
    });

    this.addCommand({
      id: "convert-line-to-preview",
      name: "Convert link on current line to preview",
      editorCallback: async (editor) => {
        const line = editor.getCursor().line;
        const raw = editor.getLine(line).replace(/^(\s*[-*+]|\s*\d+\.)\s+/, "");
        const url = parseUrl(raw);
        if (!url) {
          new Notice("The current line is not a single link.");
          return;
        }
        const targetUrl = this.settings.stripTrackers ? cleanTrackingParams(url.href) : url.href;
        await this.insertPreview(editor, targetUrl, editor.getLine(line), line);
      },
    });

    this.addCommand({
      id: "clean-tracking-params",
      name: "Clean tracking parameters from all links in note",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!(file instanceof TFile) || file.extension !== "md") {
          new Notice("Open a markdown note first.");
          return;
        }
        await this.cleanTrackersInFile(file, true);
      },
    });

    this.addRibbonIcon("link", "Manage links in current note", () => {
      void this.openManager();
    });

    this.addSettingTab(new LinkPreviewSettingTab(this.app, this));
  }

  onunload() {
    if (typeof document !== "undefined") {
      document.body.removeClass("lpc-glassmorphic");
      document.body.style.removeProperty("--lpc-placeholder-font");
    }
  }

  rerenderActivePreviewCards() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        leaf.view.previewMode?.rerender(true);
      }
    });
  }

  saveSettings() {
    return this.saveData(this.settings);
  }

  openVaultImageChooser(onChoosePath) {
    const noteToolbox = this.app.plugins?.plugins?.["note-toolbox"];
    if (noteToolbox && typeof noteToolbox.openImagePicker === "function") {
      noteToolbox.openImagePicker(
        (file, filePath) => {
          const resolved = typeof filePath === "string" ? filePath : file?.path;
          if (resolved) onChoosePath(resolved);
        },
        { title: "Choose Preview Image", lockCategory: true, multiple: false }
      );
      return;
    }
    if (noteToolbox && typeof noteToolbox.openPicker === "function") {
      noteToolbox.openPicker({
        category: "image",
        lockCategory: true,
        multiple: false,
        title: "Choose Preview Image",
        onSelect: (file, filePath) => {
          const resolved = typeof filePath === "string" ? filePath : file?.path;
          if (resolved) onChoosePath(resolved);
        },
      });
      return;
    }
    new ImagePicker(this.app, onChoosePath).open();
  }

  /* ----- link manager & buffer synchronization ----- */

  async flush(file) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view && view.file === file) await view.save();
  }

  async openManager() {
    const file = this.app.workspace.getActiveFile();
    if (!(file instanceof TFile) || file.extension !== "md") {
      new Notice("Open a markdown note first.");
      return;
    }
    await this.flush(file);
    new LinksModal(this.app, this, file).open();
  }

  async cleanTrackersInFile(file, showNotice = false) {
    await this.flush(file);
    let count = 0;
    await this.app.vault.process(file, (text) => {
      const isCRLF = text.includes("\r\n");
      const newline = isCRLF ? "\r\n" : "\n";
      const lines = text.split(/\r?\n/);
      let changed = false;

      // 1. Clean preview blocks
      const blocks = findBlocks(text);
      for (const b of blocks.reverse()) {
        const cleanedUrl = cleanTrackingParams(b.data.url);
        if (cleanedUrl !== b.data.url) {
          const nextData = Object.assign({}, b.data, { url: cleanedUrl });
          lines.splice(b.start, b.end - b.start + 1, ...serialize(nextData).split(/\r?\n/));
          changed = true;
          count++;
        }
      }

      // 2. Clean plain links on lines
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        if (raw.trim().startsWith("```") || raw.trim().startsWith("~~~")) continue;
        const whole = parseUrl(raw.trim());
        if (whole) {
          const cleaned = cleanTrackingParams(whole.href);
          if (cleaned !== whole.href) {
            lines[i] = cleaned;
            changed = true;
            count++;
          }
        }
      }

      return changed ? lines.join(newline) : text;
    });

    if (showNotice) {
      new Notice(count > 0 ? `Cleaned tracking tags from ${count} links` : "No tracking tags found");
    }
    return count;
  }

  async applyChanges(file, targets, metas) {
    let applied = 0;
    let failed = 0;
    await this.flush(file);
    await this.app.vault.process(file, (text) => {
      const isCRLF = text.includes("\r\n");
      const newline = isCRLF ? "\r\n" : "\n";
      const current = scanLinks(text, this.settings.stripTrackers);
      const used = new Set();
      const jobs = [];

      for (const t of targets) {
        let idx = current.findIndex(
          (c, i) => !used.has(i) && c.type === t.type && c.url === t.url && c.line === t.line
        );
        if (idx < 0) {
          idx = current.findIndex((c, i) => !used.has(i) && c.type === t.type && c.url === t.url);
        }
        if (idx >= 0) {
          used.add(idx);
          jobs.push(current[idx]);
        }
      }

      jobs.sort((a, b) => b.line - a.line);
      const lines = text.split(/\r?\n/);
      for (const job of jobs) {
        if (job.type === "preview") {
          lines.splice(job.line, job.end - job.line + 1, job.url);
          applied++;
        } else {
          const meta = metas.get(job.url);
          if (!meta) {
            failed++;
            continue;
          }
          const cleanUrl = this.settings.stripTrackers ? cleanTrackingParams(meta.url) : meta.url;
          const block = serialize({ ...meta, url: cleanUrl, id: makeId(), fetchedAt: Date.now() });
          lines.splice(job.line, 1, ...block.split(/\r?\n/));
          applied++;
        }
      }
      return lines.join(newline);
    });
    return { applied, failed };
  }

  async convertLink(file, item) {
    const notice = new Notice("Fetching preview…", 15000);
    try {
      await this.flush(file);
      const targetUrl = this.settings.stripTrackers ? cleanTrackingParams(item.url) : item.url;
      const meta = await fetchMeta(targetUrl, this.settings.stripTrackers);
      const { applied } = await this.applyChanges(file, [item], new Map([[item.url, meta]]));
      if (!applied) new Notice("Couldn't find that link in the note.");
    } catch {
      new Notice("Couldn't load a preview. Kept the plain link.");
    } finally {
      notice.hide();
    }
  }

  async revertItem(file, item) {
    await this.flush(file);
    await this.applyChanges(file, [item], new Map());
  }

  /* ----- right-click menus (editor) ----- */

  activeContext() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view && view.file ? { file: view.file, editor: view.editor } : null;
  }

  addToggleItem(menu, hit, file) {
    this.menuSeen.add(menu);
    const toPreview = hit.type === "link";
    menu.addItem((item) =>
      item
        .setTitle(toPreview ? "Turn link into preview" : "Turn preview back into link")
        .setIcon(toPreview ? "layout-template" : "undo")
        .onClick(() => {
          void (toPreview ? this.convertLink(file, hit) : this.revertItem(file, hit));
        })
    );
  }

  onEditorMenu(menu, editor) {
    if (this.menuSeen.has(menu)) return;
    const ctx = this.activeContext();
    if (!ctx) return;
    const line = editor.getCursor().line;
    const hit = scanLinks(editor.getValue(), this.settings.stripTrackers).find(
      (it) => it.type !== "inline" && line >= it.line && line <= it.end
    );
    if (hit) this.addToggleItem(menu, hit, ctx.file);
  }

  onUrlMenu(menu, url) {
    if (this.menuSeen.has(menu)) return;
    const ctx = this.activeContext();
    const target = parseUrl(url)?.href;
    if (!ctx || !target) return;
    const line = ctx.editor.getCursor().line;
    const matches = scanLinks(ctx.editor.getValue(), this.settings.stripTrackers).filter(
      (it) => it.type === "link" && it.url === target
    );
    const hit = matches.find((it) => it.line === line) || matches[0];
    if (hit) this.addToggleItem(menu, hit, ctx.file);
  }

  /* ----- paste ----- */

  onPaste(evt, editor) {
    if (!this.settings.autoPreview || evt.defaultPrevented) return;
    if (editor.somethingSelected()) return;

    const text = evt.clipboardData?.getData("text/plain") ?? "";
    const url = parseUrl(text);
    if (!url) return;

    if (editor.getLine(editor.getCursor().line).trim() !== "") return;
    if (insideFence(editor)) return;

    evt.preventDefault();
    const finalUrl = this.settings.stripTrackers ? cleanTrackingParams(url.href) : url.href;
    void this.insertPreview(editor, finalUrl, text.trim());
  }

  async insertPreview(editor, href, original, line) {
    const notice = new Notice("Fetching preview…", 15000);
    try {
      const finalUrl = this.settings.stripTrackers ? cleanTrackingParams(href) : href;
      const meta = await fetchMeta(finalUrl, this.settings.stripTrackers);
      const block = serialize({ ...meta, url: finalUrl, id: makeId(), fetchedAt: Date.now() }) + "\n";
      if (line === undefined) {
        editor.replaceSelection(block);
      } else {
        editor.replaceRange(
          block.trimEnd(),
          { line, ch: 0 },
          { line, ch: editor.getLine(line).length }
        );
      }
    } catch {
      if (line === undefined && original) editor.replaceSelection(original);
      new Notice("Couldn't load a preview. Kept the plain link.");
    } finally {
      notice.hide();
    }
  }

  /* ----- images ----- */

  resolveImage(src, sourcePath) {
    if (!src) return "";
    if (/^https?:\/\//i.test(src)) return src;
    const cleanSrc = src.replace(/^\[\[/, "").replace(/\]\]$/, "").trim();
    const file =
      this.app.metadataCache.getFirstLinkpathDest(cleanSrc, sourcePath) ||
      this.app.vault.getAbstractFileByPath(cleanSrc);
    return file instanceof TFile ? this.app.vault.getResourcePath(file) : "";
  }

  async saveImageBlob(blob, sourcePath) {
    const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg").replace("svg+xml", "svg");
    const path = await this.app.fileManager.getAvailablePathForAttachment(
      `link-preview-${Date.now()}.${ext}`,
      sourcePath
    );
    const file = await this.app.vault.createBinary(path, await blob.arrayBuffer());
    return file.path;
  }

  openImageModal(data, sourcePath) {
    new ImageModal(this.app, this, data, sourcePath, async (mode, value) => {
      if (mode === "set") {
        await this.updateBlock(sourcePath, data, { image: value, imageLocked: true });
      } else if (mode === "remove") {
        await this.updateBlock(sourcePath, data, { image: "", imageLocked: true });
      } else {
        await this.updateBlock(sourcePath, data, { imageLocked: undefined });
        await this.refresh(sourcePath, data);
      }
    }).open();
  }

  /* ----- rendering ----- */

  renderCard(source, el, ctx) {
    let data;
    try {
      data = JSON.parse(source);
      if (typeof data.url !== "string" || !parseUrl(data.url)) throw new Error("bad url");
    } catch {
      el.createEl("pre", { text: source });
      return;
    }

    el.addClass("lpc-root");
    const font = (this.settings.placeholderFont || "").trim();
    if (font) {
      el.style.setProperty("--lpc-placeholder-font", font);
    }

    const layout = data.layout || this.settings.cardLayout || "standard";
    const mediaPos = data.mediaPosition || this.settings.mediaPosition || "left";
    const radius = this.settings.cardRadius || "rounded";

    const card = el.createDiv({
      cls: `lpc-card is-layout-${layout} is-media-${mediaPos} is-radius-${radius}`,
    });
    const media = card.createDiv({ cls: "lpc-media" });
    const host = hostOf(data.url);
    const displaySite = (data.siteName || host).trim();
    const logoLabel = logoLabelOf(data);

    // Full-sized symmetrical placeholder box when the page has no preview image.
    const showPlaceholder = () => {
      media.empty();
      media.removeClass("is-contain");
      card.removeClass("has-image");
      card.addClass("is-placeholder");

      const styleMode = this.settings.placeholderStyle || "logo-name";
      const box = media.createDiv({ cls: `lpc-placeholder is-${styleMode}` });

      if (styleMode === "icon-and-name") {
        const tile = box.createDiv({
          cls: "lpc-avatar",
          text: (logoLabel[0] || host[0] || "?").toUpperCase(),
        });
        if (/^https?:\/\//i.test(data.icon || "")) {
          const icon = tile.createEl("img", {
            cls: "lpc-avatar-img",
            attr: { src: data.icon, alt: "", loading: "lazy", referrerpolicy: "no-referrer" },
          });
          icon.addEventListener("load", () => tile.addClass("has-icon"), { once: true });
          icon.addEventListener("error", () => icon.remove(), { once: true });
        }
        box.createDiv({ cls: "lpc-placeholder-name", text: logoLabel });
      } else {
        // "logo-name": Single-line fluid typography
        const logo = box.createDiv({ cls: "lpc-logo-mark" });
        logo.createSpan({ cls: "lpc-logo-text", text: logoLabel });
      }
    };

    const imageSrc = this.resolveImage(data.image, ctx.sourcePath);
    if (imageSrc) {
      card.addClass("has-image");
      const img = media.createEl("img", {
        cls: "lpc-image",
        attr: { src: imageSrc, alt: "", loading: "lazy", referrerpolicy: "no-referrer" },
      });
      img.addEventListener("load", () => {
        const ratio = img.naturalWidth / (img.naturalHeight || 1);
        if (ratio < 1.25 || img.naturalWidth < 220) media.addClass("is-contain");
      }, { once: true });
      img.addEventListener("error", showPlaceholder, { once: true });
    } else {
      showPlaceholder();
    }

    const body = card.createDiv({ cls: "lpc-body" });

    const siteRow = body.createDiv({ cls: "lpc-site-row" });
    if (this.settings.showFavicon && data.icon && !media.querySelector(".lpc-avatar-img")) {
      siteRow.createEl("img", {
        cls: "lpc-site-favicon",
        attr: { src: data.icon, alt: "", loading: "lazy", referrerpolicy: "no-referrer" },
      });
    }
    siteRow.createDiv({ cls: "lpc-site", text: displaySite });

    body.createEl("a", {
      cls: "lpc-title",
      text: data.alias || data.title || host,
      href: data.url,
      attr: { target: "_blank", rel: "noopener noreferrer" },
    });
    if (this.settings.showDescription && data.description) {
      body.createDiv({ cls: "lpc-desc", text: data.description });
    }

    // Action row: configurable alignment & toggleable buttons
    const placement = this.settings.actionPlacement || "right";
    const actions = body.createDiv({
      cls: `lpc-actions is-actions-${placement}`,
      attr: { role: "toolbar", "aria-label": "Link actions" },
    });

    const iconButton = (icon, label, handler) => {
      const btn = actions.createEl("button", {
        cls: "clickable-icon lpc-icon-btn",
        attr: { type: "button" },
      });
      setIcon(btn, icon);
      setTooltip(btn, label);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        handler(e);
      });
    };

    const vis = this.settings.visibleActions || DEFAULTS.visibleActions;
    if (vis.copy !== false) {
      iconButton("copy", "Copy URL", () => { void this.copyUrl(data); });
    }
    if (vis.alias !== false) {
      iconButton("pencil", "Edit alias", () => this.openAliasModal(data, ctx));
    }
    if (vis.image !== false) {
      iconButton("image-plus", "Set preview image", () => this.openImageModal(data, ctx.sourcePath));
    }
    if (vis.refresh !== false) {
      iconButton("refresh-cw", "Refresh preview", () => { void this.refresh(ctx.sourcePath, data); });
    }
    if (vis.open !== false) {
      iconButton("external-link", "Open link", () => {
        const safe = parseUrl(data.url);
        if (safe) {
          window.open(safe.href, "_blank", "noopener,noreferrer");
        } else {
          new Notice("Invalid or unsafe URL");
        }
      });
    }
    if (vis.revert !== false) {
      iconButton("undo", "Turn back into link", () => { void this.revert(ctx.sourcePath, data); });
    }

    // Notion-style card click: clicking body opens link (without triggering on action button clicks)
    card.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest("a")) return;
      const safe = parseUrl(data.url);
      if (safe) {
        window.open(safe.href, "_blank", "noopener,noreferrer");
      }
    });

    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.showMenu(e, data, ctx);
    });
  }

  async copyUrl(data) {
    const cleanUrl = this.settings.stripTrackers ? cleanTrackingParams(data.url) : data.url;
    await navigator.clipboard.writeText(cleanUrl);
    new Notice("URL copied");
  }

  openAliasModal(data, ctx) {
    new AliasModal(this.app, data, (alias) =>
      this.updateBlock(ctx.sourcePath, data, { alias })
    ).open();
  }

  showMenu(evt, data, ctx) {
    const menu = new Menu();
    const add = (title, icon, handler) =>
      menu.addItem((item) => item.setTitle(title).setIcon(icon).onClick(handler));

    add("Copy URL", "copy", () => { void this.copyUrl(data); });
    add("Copy as Markdown Link", "link", () => {
      const cleanUrl = this.settings.stripTrackers ? cleanTrackingParams(data.url) : data.url;
      const md = `[${data.alias || data.title || hostOf(cleanUrl)}](${cleanUrl})`;
      void navigator.clipboard.writeText(md).then(() => new Notice("Markdown link copied"));
    });

    if (cleanTrackingParams(data.url) !== data.url) {
      menu.addSeparator();
      add("Clean tracking params from card", "shield-check", async () => {
        const cleanUrl = cleanTrackingParams(data.url);
        await this.updateBlock(ctx.sourcePath, data, { url: cleanUrl });
        new Notice("Tracking parameters removed from card");
      });
    }

    menu.addSeparator();
    add("Edit alias…", "pencil", () => this.openAliasModal(data, ctx));
    add("Set preview image…", "image-plus", () => this.openImageModal(data, ctx.sourcePath));
    add("Choose preview image from vault…", "layout-grid", () => {
      this.openVaultImageChooser((chosenPath) => {
        if (chosenPath) {
          void this.updateBlock(ctx.sourcePath, data, { image: chosenPath, imageLocked: true });
        }
      });
    });
    add("Refresh preview", "refresh-cw", () => { void this.refresh(ctx.sourcePath, data); });
    add("Open link", "external-link", () => {
      window.open(data.url, "_blank", "noopener,noreferrer");
    });
    menu.addSeparator();
    add("Turn back into link", "undo", () => { void this.revert(ctx.sourcePath, data); });
    menu.showAtMouseEvent(evt);
  }

  /* ----- note edits ----- */

  getActiveEditorForFile(file) {
    if (!file) return null;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      if (leaf.view?.file?.path === file.path && leaf.view?.editor) {
        return leaf.view.editor;
      }
    }
    return null;
  }

  async updateBlock(path, data, patch) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const editor = this.getActiveEditorForFile(file);
    if (editor) {
      const text = editor.getValue();
      const hit = findBlock(text, data);
      if (hit) {
        const changes = typeof patch === "function" ? patch(hit.data) : patch;
        const next = { ...hit.data, id: hit.data.id || makeId(), ...changes };
        const serialized = serialize(next);
        const startPos = { line: hit.start, ch: 0 };
        const endLineContent = editor.getLine(hit.end) || "";
        const endPos = { line: hit.end, ch: endLineContent.length };
        editor.replaceRange(serialized, startPos, endPos);
        return;
      }
    }
    await this.flush(file);
    await this.app.vault.process(file, (text) => {
      const hit = findBlock(text, data);
      if (!hit) return text;
      const changes = typeof patch === "function" ? patch(hit.data) : patch;
      const next = { ...hit.data, id: hit.data.id || makeId(), ...changes };
      return replaceBlock(text, hit, serialize(next));
    });
  }

  async refresh(path, data) {
    const notice = new Notice("Refreshing…", 10000);
    try {
      const targetUrl = this.settings.stripTrackers ? cleanTrackingParams(data.url) : data.url;
      const meta = await fetchMeta(targetUrl, this.settings.stripTrackers);
      await this.updateBlock(path, data, (current) => {
        const patch = { ...meta, url: targetUrl, images: undefined, fetchedAt: Date.now() };
        if (current.imageLocked) delete patch.image;
        return patch;
      });
      new Notice("Preview refreshed");
    } catch {
      new Notice("Refresh failed");
    } finally {
      notice.hide();
    }
  }

  async revert(path, data) {
    await this.revertBlock(path, data);
  }

  async revertBlock(path, data) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return;
    const editor = this.getActiveEditorForFile(file);
    if (editor) {
      const text = editor.getValue();
      const hit = findBlock(text, data);
      if (hit) {
        const startPos = { line: hit.start, ch: 0 };
        const endLineContent = editor.getLine(hit.end) || "";
        const endPos = { line: hit.end, ch: endLineContent.length };
        editor.replaceRange(data.url, startPos, endPos);
        return;
      }
    }
    await this.flush(file);
    await this.app.vault.process(file, (text) => {
      const hit = findBlock(text, data);
      return hit ? replaceBlock(text, hit, data.url) : text;
    });
  }
};

/* ---------- settings ---------- */

class LinkPreviewSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Preview pasted links")
      .setDesc("Turn a pasted link on an empty line into a preview card.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.autoPreview).onChange(async (v) => {
          this.plugin.settings.autoPreview = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Strip tracking parameters & telemetry")
      .setDesc("Automatically strip tracking IDs, UTM markers, and telemetry parameters from YouTube, Twitter/X, Spotify, Facebook, Amazon, Reddit, ChatGPT, etc.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.stripTrackers ?? true).onChange(async (v) => {
          this.plugin.settings.stripTrackers = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Frosted Glassmorphism Theme")
      .setDesc("Enable translucent glass panels with frosted blur backdrops and subtle luminous borders on cards and modals.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.glassmorphism ?? true).onChange(async (v) => {
          this.plugin.settings.glassmorphism = v;
          await this.plugin.saveSettings();
          this.plugin.applyThemePreferences();
          this.plugin.rerenderActivePreviewCards();
        })
      );

    new Setting(containerEl)
      .setName("Default card layout")
      .setDesc("Choose the default visual appearance of cards.")
      .addDropdown((d) =>
        d
          .addOption("standard", "Standard (Side media container)")
          .addOption("banner", "Banner (Top hero media container)")
          .addOption("compact", "Compact (Bookmark row)")
          .setValue(this.plugin.settings.cardLayout || "standard")
          .onChange(async (v) => {
            this.plugin.settings.cardLayout = v;
            await this.plugin.saveSettings();
            this.plugin.rerenderActivePreviewCards();
          })
      );

    new Setting(containerEl)
      .setName("Thumbnail media position")
      .setDesc("Position of the media box in standard layout.")
      .addDropdown((d) =>
        d
          .addOption("left", "Left side (Standard)")
          .addOption("right", "Right side (Bookmark style)")
          .setValue(this.plugin.settings.mediaPosition || "left")
          .onChange(async (v) => {
            this.plugin.settings.mediaPosition = v;
            await this.plugin.saveSettings();
            this.plugin.rerenderActivePreviewCards();
          })
      );

    new Setting(containerEl)
      .setName("Action buttons placement")
      .setDesc("Horizontal alignment of the action buttons row.")
      .addDropdown((d) =>
        d
          .addOption("right", "Right aligned (Clean)")
          .addOption("space-between", "Evenly balanced across card")
          .addOption("space-evenly", "Evenly spaced")
          .addOption("left", "Left aligned")
          .setValue(this.plugin.settings.actionPlacement || "right")
          .onChange(async (v) => {
            this.plugin.settings.actionPlacement = v;
            await this.plugin.saveSettings();
            this.plugin.rerenderActivePreviewCards();
          })
      );

    new Setting(containerEl)
      .setName("Card corner radius")
      .setDesc("Styling of the card corner borders.")
      .addDropdown((d) =>
        d
          .addOption("rounded", "Rounded (14px)")
          .addOption("sharp", "Subtle (6px)")
          .addOption("pill", "Soft Pill (20px)")
          .setValue(this.plugin.settings.cardRadius || "rounded")
          .onChange(async (v) => {
            this.plugin.settings.cardRadius = v;
            await this.plugin.saveSettings();
            this.plugin.rerenderActivePreviewCards();
          })
      );

    new Setting(containerEl)
      .setName("Show website favicon")
      .setDesc("Display the website's favicon icon beside the domain name.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showFavicon ?? true).onChange(async (v) => {
          this.plugin.settings.showFavicon = v;
          await this.plugin.saveSettings();
          this.plugin.rerenderActivePreviewCards();
        })
      );

    new Setting(containerEl)
      .setName("Show description")
      .setDesc("Show the page description under the title.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showDescription).onChange(async (v) => {
          this.plugin.settings.showDescription = v;
          await this.plugin.saveSettings();
          this.plugin.rerenderActivePreviewCards();
        })
      );

    new Setting(containerEl)
      .setName("No-image placeholder style")
      .setDesc("Choose how the left box looks when a link has no preview image.")
      .addDropdown((d) =>
        d
          .addOption("logo-name", "Website name as logo")
          .addOption("icon-and-name", "Icon / letter + website name")
          .setValue(this.plugin.settings.placeholderStyle || "logo-name")
          .onChange(async (v) => {
            this.plugin.settings.placeholderStyle = v;
            await this.plugin.saveSettings();
            this.plugin.rerenderActivePreviewCards();
          })
      );

    new Setting(containerEl)
      .setName("Placeholder custom font")
      .setDesc("Optional font family for the website name in the placeholder box (e.g. Georgia, Playfair Display, JetBrains Mono).")
      .addText((text) =>
        text
          .setPlaceholder("Default theme font")
          .setValue(this.plugin.settings.placeholderFont || "")
          .onChange(async (v) => {
            this.plugin.settings.placeholderFont = v;
            await this.plugin.saveSettings();
            this.plugin.rerenderActivePreviewCards();
          })
      );

    // Button visibility customization section
    containerEl.createEl("h3", { text: "Action Buttons Visibility" });

    const vis = this.plugin.settings.visibleActions || DEFAULTS.visibleActions;
    const addActionToggle = (key, name, desc) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addToggle((t) =>
          t.setValue(vis[key] !== false).onChange(async (v) => {
            this.plugin.settings.visibleActions[key] = v;
            await this.plugin.saveSettings();
            this.plugin.rerenderActivePreviewCards();
          })
        );
    };

    addActionToggle("copy", "Copy URL button", "Display the copy URL icon button.");
    addActionToggle("open", "Open link button", "Display the external link open icon button.");
    addActionToggle("alias", "Edit alias button", "Display the edit alias icon button.");
    addActionToggle("image", "Set image button", "Display the custom preview image icon button.");
    addActionToggle("refresh", "Refresh button", "Display the refresh preview icon button.");
    addActionToggle("revert", "Revert button", "Display the turn back to link icon button.");
  }
}
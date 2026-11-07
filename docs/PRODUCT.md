# Product Intent & Feature Map (`PRODUCT.md`)
> **1-Line Summary:** The permanent source of truth for what Link Preview Card does for the reader, independent of how the code is implemented.

## 1. Core Vision & User Experience Intent
* **What This App Does (Plain English):** Turns a bare URL in a note into a compact, readable link card with a title, description, thumbnail, site favicon, and a row of one-click actions. The card is stored as plain text in the note, not in a database, so it syncs and survives any vault.
* **How It Must Feel to Use:** Pasting a link on an empty line should produce a finished card in about a second, with no dialog. Every card action edits the note immediately, every conversion is reversible, and unrelated text in the note is never disturbed. A card must still look correct in reading view, live preview, and on a fresh device with no cache.

## 2. Active Features (Do Not Break)

### [FEATURE: Fenced-Preview-Block-Format] | Aliases: link-preview fence, card block, serialized card, note storage format
> **1-Line Summary:** Each card is a `~~~link-preview` fenced block containing one line of JSON, followed by a closing `~~~`.
* **User Intention (Non-Negotiable):** The card must live inside the note as human-readable text that syncs with the vault, is diff-friendly, and degrades to a plain link if the plugin is removed.
* **Visual / UI Behavior:** Reading view renders the block as a card. If the JSON is malformed or has no valid `url`, the raw source is shown in a `<pre>` instead of an empty box.
* **Code Anchors (Grep Targets):**
  * `src/settings.ts` -> `FENCE_OPEN`, `FENCE_CLOSE`
  * `src/preview-block.ts` -> `serialize`, `findBlocks`, `findBlock`
  * `src/types.ts` -> `PreviewData`

### [FEATURE: One-Paste-Card-Creation] | Aliases: paste link, auto preview, paste URL, instant card
> **1-Line Summary:** Pasting a single URL onto an empty line replaces it with a freshly fetched card without any prompt.
* **User Intention (Non-Negotiable):** Pasting must never hijack ordinary text. It fires only when `autoPreview` is on, nothing is selected, the clipboard is exactly one URL, the cursor line is blank, and the cursor is not inside a code fence.
* **Visual / UI Behavior:** A "Fetching preview…" notice appears for the duration; on failure the original pasted text is restored and a plain-link notice is shown.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `LinkPreviewCard.onPaste`
  * `src/preview-block.ts` -> `insideFence`, `parseUrl`
  * `src/note-actions.ts` -> `insertPreview`

### [FEATURE: Tracking-Parameter-Scrubbing] | Aliases: clean URL, strip UTM, telemetry removal, privacy
> **1-Line Summary:** Removes UTM markers, click IDs, share tokens, and host-specific telemetry from every URL the plugin stores, copies, or cleans.
* **User Intention (Non-Negotiable):** Cleaning must never break a link. It only deletes known-tracking keys, unwraps Google and Facebook redirect URLs, and canonicalizes Amazon product links to `/dp/<ASIN>`.
* **Visual / UI Behavior:** A toggle in settings; a note-wide command; a "Clean trackers" button in the link manager; a context-menu entry on cards that still carry parameters. The card action reports how many links changed.
* **Code Anchors (Grep Targets):**
  * `src/tracker.ts` -> `cleanTrackingParams`, `parseUrl`
  * `src/settings.ts` -> `DEFAULT_SETTINGS.stripTrackers`
  * `src/note-actions.ts` -> `cleanTrackersInFile`

### [FEATURE: Metadata-Scraping-And-YouTube-OEmbed] | Aliases: OpenGraph, og:image, favicon, video preview
> **1-Line Summary:** Fetches OpenGraph and Twitter-card metadata with a browser user agent, using YouTube's oEmbed endpoint plus its thumbnail CDN for videos.
* **User Intention (Non-Negotiable):** A slow or hostile site must not hang the UI: every request has a 10-second ceiling, and failures leave the plain link intact. YouTube cards must show a real thumbnail and channel name.
* **Visual / UI Behavior:** Title, description, site name, image, and favicon appear in the card. Short or narrow images are letterboxed rather than cropped.
* **Code Anchors (Grep Targets):**
  * `src/metadata.ts` -> `fetchMeta`, `fetchAll`
  * `src/settings.ts` -> `TIMEOUT_MS`, `FETCH_CONCURRENCY`
  * `src/tracker.ts` -> `rootDomainOf`, `hostOf`

### [FEATURE: Link-Manager-Bulk-Conversion] | Aliases: manage links, convert all, bulk previews, revert links
> **1-Line Summary:** A modal lists every link, preview, and inline URL in the note and converts selected links to cards, or cards back to links, in one pass.
* **User Intention (Non-Negotiable):** Bulk edits must only touch the rows the user selected, must work whether the note is open in an editor or only on disk, and must never corrupt line offsets while converting several links.
* **Visual / UI Behavior:** Filter chips (All / Links / Previews), select All/None/Invert, a per-row checkbox with line number and domain, a live fetch counter in the footer, and a results notice after applying.
* **Code Anchors (Grep Targets):**
  * `src/modals.ts` -> `LinksModal.run`, `LinksModal.renderList`, `LinksModal.updateFooter`
  * `src/note-actions.ts` -> `applyChanges`
  * `src/preview-block.ts` -> `scanLinks`

### [FEATURE: Layout-Media-And-Placeholder-Styling] | Aliases: standard, banner, compact, thumbnail position, logo placeholder
> **1-Line Summary:** Cards render in three layouts with left or right media, three corner radii, two placeholder styles, and an optional custom placeholder font.
* **User Intention (Non-Negotiable):** The chosen defaults must apply to existing cards without rewriting them, while a card's own stored `layout` and `mediaPosition` still win. A card with no image must still look deliberate, never broken.
* **Visual / UI Behavior:** `standard` (side media), `banner` (top hero), `compact` (bookmark row); media left/right; radius rounded/sharp/pill; placeholder either the site name as a logo or an icon tile plus name.
* **Code Anchors (Grep Targets):**
  * `src/card-renderer.ts` -> `renderPreviewCard`
  * `src/settings-tab.ts` -> `LinkPreviewSettingTab.display`
  * `styles.css` -> `.lpc-card`, `.lpc-placeholder`, `.is-layout-*`

### [FEATURE: Card-Action-Toolbar] | Aliases: copy, alias, image, refresh, open, revert, icon buttons
> **1-Line Summary:** Six icon buttons on every card cover copy, alias editing, image replacement, refresh, open, and revert, each independently hideable.
* **User Intention (Non-Negotiable):** Every action edits only the card it belongs to, is identified by the card's URL plus its stored `id`, and never opens the link when the user meant to press a button.
* **Visual / UI Behavior:** A toolbar with configurable alignment (right, left, space-between, space-evenly). Buttons show tooltips; clicking the card body opens the link in a new tab.
* **Code Anchors (Grep Targets):**
  * `src/card-renderer.ts` -> `iconButton`, `visibleActions`
  * `src/main.ts` -> `copyUrl`, `refresh`, `revert`, `openAliasModal`
  * `src/settings-tab.ts` -> `ACTION_TOGGLES`

### [FEATURE: Context-Menu-Card-Actions] | Aliases: right click card, copy markdown, clean card, vault image
> **1-Line Summary:** Right-clicking a card offers copy URL, copy as Markdown, clean trackers, alias, image, refresh, open, and revert.
* **User Intention (Non-Negotiable):** Menu actions must target the clicked card even when several cards share a URL, and the menu must never appear twice for one click.
* **Visual / UI Behavior:** Native Obsidian `Menu` at the pointer, with separators grouping clipboard, cleanup, editing, and destructive actions.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `showMenu`
  * `src/modals.ts` -> `AliasModal`, `ImageModal`

### [FEATURE: Image-Sourcing-And-Paste] | Aliases: preview image, screenshot paste, vault image, lock image
> **1-Line Summary:** A card image can be a URL, a vault path, a picked vault file, or a pasted screenshot saved next to the note.
* **User Intention (Non-Negotiable):** A manually chosen image sets `imageLocked` so Refresh cannot silently replace it. "Automatic" clears the lock and refetches.
* **Visual / UI Behavior:** The image dialog accepts a URL or path, offers "Choose from vault", "No image", and "Automatic", and saves pasted clipboard images as `link-preview-<timestamp>.<ext>` under the attachment folder.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `resolveImage`, `saveImageBlob`, `openImageModal`
  * `src/modals.ts` -> `ImagePicker`, `ImageModal`
  * `src/note-actions.ts` -> `updateBlock`

### [FEATURE: Editor-Menus-And-Commands] | Aliases: right click editor, convert line, clean note, ribbon
> **1-Line Summary:** The editor context menu and URL menu toggle the link under the cursor, and three commands cover the manager, line conversion, and note cleanup.
* **User Intention (Non-Negotiable):** The editor menu must act on the link at the cursor, not on a stale scan, and a URL menu must resolve the correct occurrence when the same URL appears multiple times.
* **Visual / UI Behavior:** "Turn link into preview" / "Turn preview back into link" in the editor and URL menus; a ribbon link icon and command-palette entries for the manager and cleanup.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `onEditorMenu`, `onUrlMenu`, `addToggleItem`
  * `src/preview-block.ts` -> `scanLinks`

### [FEATURE: Inter-Plugin-Image-Chooser] | Aliases: note-toolbox integration, picker fallback, external API
> **1-Line Summary:** Delegates image selection to Note Toolbox when installed and otherwise falls back to its own fuzzy file picker.
* **User Intention (Non-Negotiable):** A missing or older Note Toolbox must never break the dialog; the local picker is always the fallback.
* **Visual / UI Behavior:** Opening the image dialog and choosing "Choose from vault" shows whichever browser is available, filtered to image extensions.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `openVaultImageChooser`
  * `src/modals.ts` -> `ImagePicker`

### [FEATURE: Glassmorphism-Theming] | Aliases: frosted glass, translucency, theme toggle
> **1-Line Summary:** An optional translucent treatment applies to cards and dialogs through one body class, without touching theme files.
* **User Intention (Non-Negotiable):** Turning the toggle off must restore the previous look immediately and remove every injected class on unload.
* **Visual / UI Behavior:** Body class `lpc-glassmorphic` plus a `--lpc-placeholder-font` custom property; the setting rerenders open preview cards in place.
* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `applyThemePreferences`, `onunload`, `rerenderActivePreviewCards`
  * `styles.css` -> `.lpc-glassmorphic`

## 3. Explicit Non-Goals
* No remote database, sync service, or account. Cards are note text.
* No automatic rewriting of links the user did not select or paste.
* No headless browser rendering: metadata comes from HTML tags and a small number of known APIs.

## 4. Public API For Other Plugins
* `cleanUrl(url)` — returns a tracking-free URL.
* `fetchMetadata(url)` — returns `PreviewData` without touching a note.
* `insertPreviewCard(editor, url)` — fetches and inserts a card at the cursor.
* `cleanAllLinksInActiveFile()` — cleans the active note and returns the change count.

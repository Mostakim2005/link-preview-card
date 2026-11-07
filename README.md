# Link Preview Card

> [!NOTE]
> **Live Plug-and-Play Runtime Available:** The `runtime/` directory contains the production-tested JavaScript bundle (`main.js`, `manifest.json`, `styles.css`) that runs in the live Obsidian vault. Copy those three files into `<Vault>/.obsidian/plugins/link-preview-card/` for immediate use. The TypeScript source in `src/` is a full behavioral port of that bundle.

Paste a URL on an empty line and get a real preview card: title, description, thumbnail, favicon, and a row of actions. Every card is stored as a `~~~link-preview` fenced block in the note, so it syncs with the vault and reverts to a plain link at any time.

## Documentation

| File | What it answers |
| --- | --- |
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | What the plugin must do, feature by feature, with code anchors. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Mermaid system maps, the note format, write paths, metadata rules, verification commands, extension recipes. |
| [`docs/DECISIONS_AND_TRAPS.md`](docs/DECISIONS_AND_TRAPS.md) | Why each non-obvious mechanism exists and what must never be changed. |
| [`docs/VISUAL_GUIDE.html`](docs/VISUAL_GUIDE.html) | Self-contained browser dashboard of intent, architecture, decisions and landmines. |
| [`AGENTS.md`](AGENTS.md) | Repository-specific build commands, layout and traps. |

## Source layout

- `src/types.ts` — `LinkPreviewSettings`, `PreviewData`, `BlockHit`, `ScanItem`, `EditorContext`
- `src/settings.ts` — `DEFAULT_SETTINGS`, fence markers, timeout and concurrency constants, extension and TLD sets
- `src/preview-block.ts` — `serialize`, `findBlocks`, `findBlock`, `replaceBlock`, `scanLinks`, `insideFence`
- `src/tracker.ts` — `cleanTrackingParams` with universal and per-host rules, `parseUrl`, `hostOf`, `rootDomainOf`, `logoLabelOf`
- `src/metadata.ts` — `fetchMeta` (YouTube oEmbed + OpenGraph scraper + favicon fallback), `fetchAll` bounded worker pool
- `src/note-actions.ts` — `flushActiveNote`, `getActiveEditorForFile`, `applyChanges`, `cleanTrackersInFile`, `updateBlock`, `revertBlock`, `insertPreview`
- `src/card-renderer.ts` — `renderPreviewCard` (layouts, media, placeholder, action toolbar, card click, context menu)
- `src/modals.ts` — `LinksModal`, `AliasModal`, `ImageModal`, `ImagePicker`
- `src/settings-tab.ts` — settings UI
- `src/main.ts` — plugin entry, commands, ribbon, paste/menu handlers, image plumbing, public API
- `src/async.ts` — `voidAsync` for async DOM listeners

## Parity checklist

- [x] Entry, 3 commands, ribbon icon, settings tab, unload cleanup
- [x] `~~~link-preview` fence codec with empty-value elision and malformed-block fallback
- [x] Paste-to-card guard: autoPreview, no selection, single URL, blank line, outside fence
- [x] Metadata: YouTube oEmbed thumbnail, OpenGraph/Twitter tags, favicon fallback, 10 s timeout, 3-way concurrency
- [x] Tracking cleanup: universal parameters, host rules (YouTube, Spotify, X, Reddit, ChatGPT, Substack/Medium, Telegram), Google/Facebook redirect unwrap, Amazon canonicalization
- [x] `LinksModal`: filter chips, All/None/Invert, per-row line/domain, fetch progress, convert both directions
- [x] Bottom-up splicing with fresh rescan and CRLF preservation
- [x] Editor-first `updateBlock` / `revertBlock` with `vault.process` fallback
- [x] Three layouts, media left/right, three radii, two placeholder styles, custom placeholder font
- [x] Six independently hideable card actions plus configurable alignment
- [x] Card context menu: copy URL, copy Markdown, clean trackers, alias, image, vault image, refresh, open, revert
- [x] Editor and URL context-menu toggles
- [x] Image dialog: URL/path, vault picker, Note Toolbox delegation, screenshot paste into attachments, `imageLocked`
- [x] Glassmorphism body class and placeholder font custom property, removed on unload
- [x] Public API: `cleanUrl`, `fetchMetadata`, `insertPreviewCard`, `cleanAllLinksInActiveFile`
- [x] `styles.css` — live styles copied verbatim
- [x] Data compatibility: live `data.json` shape with nested `visibleActions` merge

## Develop

```bash
npm install
npm run dev     # esbuild watch
npm run build   # tsc --noEmit + production bundle -> main.js
npm run lint
```

Manual install: copy `main.js`, `manifest.json`, `styles.css` to `<Vault>/.obsidian/plugins/link-preview-card/`.

## License

Code: PolyForm Noncommercial 1.0.0 (see `LICENSE`). Docs: CC BY-NC 4.0. Copyright © Mostakim2005. Source-available: free non-commercial use with credit, no commercial use.

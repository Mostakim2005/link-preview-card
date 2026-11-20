# Project Operating Instructions (`AGENTS.md`)
> **Notice:** This project inherits user persona, confirmation gates, visual standards, and documentation blueprints from the global master `AGENTS.md`. Do not duplicate those rules here.

## 1. Project Tech Stack & Environment
* **Runtime / Language:** Node.js 18+, TypeScript 5.8 (`strict` + `noUncheckedIndexedAccess`).
* **Framework / Host:** Obsidian plugin API, `minAppVersion` 1.6.0, desktop and mobile (`isDesktopOnly: false`).
* **Build Output:** `main.js` (CommonJS bundle) at the repository root, shipped with `manifest.json` and `styles.css`.
* **Package Manager / Bundler:** npm + esbuild (`esbuild.config.mjs`, entry `src/main.ts`).
* **Networking:** `requestUrl` only. Do not introduce `fetch` for page metadata; it is blocked by CORS.

## 2. Mandatory Verification & Build Commands
* **Type Check:** `npx tsc -noEmit -skipLibCheck`
* **Lint:** `npm run lint`
* **Build:** `npm run build`
* **Watch / Dev:** `npm run dev`

## 3. Repository Directory Structure & Conventions
* `src/` — modular TypeScript source; one responsibility per file:
  * `main.ts` — plugin lifecycle, host events, menus, image plumbing, public API.
  * `preview-block.ts` — fence codec (`serialize`, `findBlocks`, `findBlock`, `replaceBlock`), `scanLinks`, `insideFence`.
  * `tracker.ts` — `cleanTrackingParams`, `parseUrl`, `hostOf`, `rootDomainOf`, `logoLabelOf`.
  * `metadata.ts` — `fetchMeta`, `fetchAll`, timeout and concurrency.
  * `note-actions.ts` — `applyChanges`, `updateBlock`, `revertBlock`, `cleanTrackersInFile`, `insertPreview`.
  * `card-renderer.ts` — `renderPreviewCard` and all `lpc-*` DOM.
  * `modals.ts` — `LinksModal`, `AliasModal`, `ImageModal`, `ImagePicker`.
  * `settings-tab.ts` — settings UI.
  * `settings.ts` / `types.ts` — defaults and shared contracts.
  * `async.ts` — `voidAsync` wrapper for async DOM listeners.
* `docs/` — Core Markdown documentation suite (`PRODUCT.md`, `ARCHITECTURE.md`, `DECISIONS_AND_TRAPS.md`, `VISUAL_LOG.md`).
* `preview/` — On-demand interactive HTML/CSS/JS visual previews (e.g., `preview/visual-guide.html`), created only upon explicit request.
* `main.js` at the root is a generated build artifact; edit `src/` instead.

## 4. Critical Trap Pointers (1-Line Warnings Only)
* **TRAP 1:** Never change the `~~~link-preview` card fence format or JSON field names without migration — see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Fence-Format-Compatibility]`.
* **TRAP 2:** Splicing bulk conversions must sort in descending line order to prevent offset shifts — see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Splicing-Line-Shift]`.
* **TRAP 3:** Preserve Windows `\r\n` newlines across note writes — see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Line-Ending-Corruption]`.
* **TRAP 4:** Prefer `editor.replaceRange` over `vault.process` to prevent dropping unsaved editor buffers — see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Unsaved-Buffer-Clobber]`.
* **TRAP 5:** Always wrap `requestUrl` in `withTimeout` to prevent hanging paste operations — see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Timeout-Versus-Hanging-Request]`.
* **TRAP 6:** Sanitize incoming URLs and reject `javascript:` schemes before building DOM — see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Untrusted-JSON-In-Notes]`.

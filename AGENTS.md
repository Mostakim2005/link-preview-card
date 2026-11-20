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
* `src/` â€” modular TypeScript source; one responsibility per file:
  * `main.ts` â€” plugin lifecycle, host events, menus, image plumbing, public API.
  * `preview-block.ts` â€” fence codec (`serialize`, `findBlocks`, `findBlock`, `replaceBlock`), `scanLinks`, `insideFence`.
  * `tracker.ts` â€” `cleanTrackingParams`, `parseUrl`, `hostOf`, `rootDomainOf`, `logoLabelOf`.
  * `metadata.ts` â€” `fetchMeta`, `fetchAll`, timeout and concurrency.
  * `note-actions.ts` â€” `applyChanges`, `updateBlock`, `revertBlock`, `cleanTrackersInFile`, `insertPreview`.
  * `card-renderer.ts` â€” `renderPreviewCard` and all `lpc-*` DOM.
  * `modals.ts` â€” `LinksModal`, `AliasModal`, `ImageModal`, `ImagePicker`.
  * `settings-tab.ts` â€” settings UI.
  * `settings.ts` / `types.ts` â€” defaults and shared contracts.
  * `async.ts` â€” `voidAsync` wrapper for async DOM listeners.
* `docs/` â€” Core Markdown documentation suite (`PRODUCT.md`, `ARCHITECTURE.md`, `DECISIONS_AND_TRAPS.md`, `VISUAL_LOG.md`).
* `preview/` â€” On-demand interactive HTML/CSS/JS visual previews (e.g., `preview/visual-guide.html`), created only upon explicit request.
* `main.js` at the root is a generated build artifact; edit `src/` instead.

## 4. Critical Trap Pointers (1-Line Warnings Only)
* **TRAP 1:** Never change the `~~~link-preview` card fence format or JSON field names without migration â€” see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Fence-Format-Compatibility]`.
* **TRAP 2:** Splicing bulk conversions must sort in descending line order to prevent offset shifts â€” see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Splicing-Line-Shift]`.
* **TRAP 3:** Preserve Windows `\r\n` newlines across note writes â€” see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Line-Ending-Corruption]`.
* **TRAP 4:** Prefer `editor.replaceRange` over `vault.process` to prevent dropping unsaved editor buffers â€” see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Unsaved-Buffer-Clobber]`.
* **TRAP 5:** Always wrap `requestUrl` in `withTimeout` to prevent hanging paste operations â€” see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Timeout-Versus-Hanging-Request]`.
* **TRAP 6:** Sanitize incoming URLs and reject `javascript:` schemes before building DOM â€” see `docs/DECISIONS_AND_TRAPS.md` -> `[TRAP: Untrusted-JSON-In-Notes]`.

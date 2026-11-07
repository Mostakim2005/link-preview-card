# Project Operating Instructions (`AGENTS.md`)
> **Notice:** This project inherits user persona, confirmation gates, and documentation blueprints from the global master `AGENTS.md`. Do not duplicate those rules here.

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
* `docs/` — `PRODUCT.md`, `ARCHITECTURE.md`, `DECISIONS_AND_TRAPS.md`, `VISUAL_GUIDE.html`.
* `runtime/` — frozen plug-and-play bundle (`main.js`, `manifest.json`, `styles.css`) kept as the emergency fallback. Never regenerate into this folder.
* `main.js` at the root is a generated build artifact; edit `src/` instead.

## 4. Repository-Specific Engineering Traps
* **TRAP 1:** The card format is user data. Changing `FENCE_OPEN`, the JSON field names, or dropping `id` without a compatibility path silently breaks every existing card.
* **TRAP 2:** Every write must preserve the note's newline style. Detect `text.includes("\r\n")` and join with that separator; a plain `\n` join rewrites entire Windows notes.
* **TRAP 3:** Bulk conversion must sort jobs by descending line before splicing, or card insertions shift the line numbers of the remaining targets.
* **TRAP 4:** Prefer `editor.replaceRange` when the note has an open `MarkdownView`; writing through `vault.process` can discard unsaved buffer content. Flush before the vault fallback.
* **TRAP 5:** `serialize` removes empty strings, `undefined`, and `null` on purpose. Replacing it with plain `JSON.stringify` reintroduces empty fields and breaks image removal.
* **TRAP 6:** `imageLocked` means "the user chose this image". `refresh()` must not overwrite it; only the "Automatic" image action clears it.
* **TRAP 7:** `fetchMeta` must always run under the `withTimeout` race. `requestUrl` has no timeout and a dead host would hang the paste.
* **TRAP 8:** `renderPreviewCard` must validate JSON and the URL scheme before building DOM. A `javascript:` URL must never reach `window.open` or an anchor.
* **TRAP 9:** `.lpc-*` classes are a contract with `styles.css`; renaming one side without the other removes layout, placeholder, or action styling.
* **TRAP 10:** The `visibleActions` settings object needs its own nested merge on load. A shallow merge drops newly added toggles for existing users.
* **TRAP 11:** `scanLinks` classifies whole-line URLs as `link` and embedded URLs as `inline`; `inline` rows must stay non-convertible.
* **TRAP 12:** The public API (`cleanUrl`, `fetchMetadata`, `insertPreviewCard`, `cleanAllLinksInActiveFile`) and `openVaultImageChooser`'s Note Toolbox calls are consumed by other plugins. Do not rename or reorder their arguments.

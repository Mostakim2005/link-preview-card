# Visual Feature & Change Log (`VISUAL_LOG.md`)
> **1-Line Summary:** Plain-English, color-coded Obsidian-compatible Mermaid flowcharts explaining how each major flow in Link Preview Card operates end to end.

## Feature & Change Flowcharts

### [VISUAL: Paste-To-Card-Conversion-Flow] | Aliases: paste handler, metadata scraper, card insertion
> **1-Line Summary:** How pasting a URL on an empty note line automatically fetches OpenGraph/oEmbed metadata and renders a preview card.

* **Plain-English Walkthrough:** When a URL is pasted onto an empty line in a note editor, the paste interceptor checks configuration toggles, selection boundaries, and code fences. If valid, tracking parameters are stripped immediately, and page metadata (title, description, thumbnail, favicon) is fetched with a 10-second timeout. Upon success, a formatted `~~~link-preview` block is serialized and replaces the line. If fetching fails or times out, the raw URL is preserved safely without corrupting the note.

```mermaid
flowchart TD
    %% Color Definitions (Obsidian & GitHub compatible)
    classDef startNode fill:#1d4ed8,stroke:#1e3a8a,color:#ffffff
    classDef processNode fill:#0f766e,stroke:#115e59,color:#ffffff
    classDef outputNode fill:#15803d,stroke:#14532d,color:#ffffff
    classDef trapNode fill:#b91c1c,stroke:#7f1d1d,color:#ffffff

    Start([User pastes URL on empty editor line]):::startNode --> GuardCheck{AutoPreview enabled & Line empty?}:::processNode
    GuardCheck -->|No / Inside Code Fence| NormalPaste([Standard Obsidian Text Paste]):::outputNode
    GuardCheck -->|Yes| StripTrackers[tracker.ts: Clean tracking parameters]:::processNode

    StripTrackers --> FetchWithTimeout[metadata.ts: fetchMeta with 10s timeout]:::processNode
    FetchWithTimeout --> SuccessCheck{Metadata fetch successful?}:::processNode

    SuccessCheck -->|No / Timed out| FallbackText[Restore original URL as plain text]:::trapNode
    FallbackText --> NoticeUser([Post Notice: 'Kept the plain link']):::outputNode

    SuccessCheck -->|Yes| SerializeBlock[preview-block.ts: Serialize PreviewData to ~~~ fence]:::processNode
    SerializeBlock --> EditorReplace[editor.replaceSelection: Insert card fence]:::processNode
    EditorReplace --> RenderDone([Interactive Link Preview Card Rendered]):::outputNode

    subgraph Legend["Legend (Color Guide)"]
        L1([Blue = Starting User Action / Entry Point]):::startNode
        L2[Teal = Processing & Transformation Step]:::processNode
        L3([Green = Successful Final Outcome]):::outputNode
        L4[Red = Timeout / Safety Fallback Path]:::trapNode
    end
```

* **Code Anchors (Grep Targets):**
  * `src/main.ts` -> `onPaste`, `resolveImage`
  * `src/tracker.ts` -> `cleanTrackingParams`
  * `src/metadata.ts` -> `fetchMeta`, `withTimeout`
  * `src/preview-block.ts` -> `serialize`

---

### [VISUAL: Bulk-Link-Scan-And-Conversion-Flow] | Aliases: links modal, bulk converter, bottom up splicing
> **1-Line Summary:** How the Links Modal scans notes for raw links and converts them into card blocks in reverse line order.

* **Plain-English Walkthrough:** When the user opens the Link Manager modal, the note is scanned for raw whole-line URLs and existing preview cards. The user selects links to convert. Before applying, active editor changes are flushed to disk, targeted rows are re-scanned to ensure lines haven't moved, and replacements are sorted in descending line order (bottom-up) so line offsets remain consistent during text splicing.

```mermaid
flowchart TD
    %% Color Definitions (Obsidian & GitHub compatible)
    classDef startNode fill:#1d4ed8,stroke:#1e3a8a,color:#ffffff
    classDef processNode fill:#0f766e,stroke:#115e59,color:#ffffff
    classDef outputNode fill:#15803d,stroke:#14532d,color:#ffffff
    classDef trapNode fill:#b91c1c,stroke:#7f1d1d,color:#ffffff

    Start([User opens LinksModal]):::startNode --> ScanNote[scanLinks: Scan whole-line and inline links]:::processNode
    ScanNote --> UserSelect[/User selects multiple links to convert/]:::processNode

    UserSelect --> FlushEditor[Flush active editor buffer to disk]:::processNode
    FlushEditor --> Rescan[vault.process: Rescan note to verify targets]:::processNode

    Rescan --> MatchCheck{Do target lines match fresh scan?}:::processNode
    MatchCheck -->|No / Moved| SkipVanished[Skip disappeared links gracefully]:::trapNode
    MatchCheck -->|Yes| SortDescending[Sort jobs in descending line order]:::processNode
    SkipVanished --> SortDescending

    SortDescending --> BottomUpSplice[Splice blocks bottom-up to preserve line offsets]:::processNode
    BottomUpSplice --> DetectCRLF[Preserve original CRLF / LF line endings]:::processNode
    DetectCRLF --> WriteVault[Commit changes to active file]:::processNode
    WriteVault --> Done([All Selected Links Converted to Cards]):::outputNode

    subgraph Legend["Legend (Color Guide)"]
        L1([Blue = Starting User Action / Entry Point]):::startNode
        L2[Teal = Processing & Transformation Step]:::processNode
        L3([Green = Successful Final Outcome]):::outputNode
        L4[Red = Stale Line Guard & Skip]:::trapNode
    end
```

* **Code Anchors (Grep Targets):**
  * `src/modals.ts` -> `LinksModal.run`, `LinksModal.reload`
  * `src/note-actions.ts` -> `applyChanges`
  * `src/preview-block.ts` -> `replaceBlock`

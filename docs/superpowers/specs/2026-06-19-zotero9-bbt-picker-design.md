# Zotero 9 compatibility — BBT-search item picker (Paper Note)

Date: 2026-06-19
Scope: **Paper Note (annotation/note export) only.** Citation insert intentionally out of scope for this iteration.

## Problem (confirmed root cause)

The plugin selects items by opening Zotero's CAYW dialog:
`exportToMarkdown` → `getCiteKeys` → `getCAYWJSON` → `GET /better-bibtex/cayw?format=translate&...`.

On Zotero 9 the new citation dialog (`citationDialog.js`) is incompatible: it errors
(`itemTree` non-existant row, empty `getElementById`) and returns selected items
**without a numeric `libraryID`**. `getCiteKeyFromAny` then yields `{ key, library: undefined }`.
Downstream `getItemJSONFromCiteKeys` calls BBT `item.export([keys], translator, libraryID)`
with `libraryID = undefined/NaN`, and BBT fails:
`library.get: {"libraryID":"NaN","group":"NaN"} not found` → Zotero emits
`item ID 'NaN' is not an integer` and `no such column: NaN`.

### Verified headlessly (BBT JSON-RPC, port 23119)
- `item.search`, `item.attachments` (17 annotations), `user.groups` → all clean.
- `item.export([key], translator, 1)` → **clean** (library=1 works).
- `item.export([key], translator, null|"NaN")` → **errors** (reproduces NaN).
- Library name from `item.search` ("내 라이브러리") matches `user.groups` id=1 byte-for-byte.

Conclusion: the data layer is healthy. Only the CAYW UI is broken. Supplying a valid
`library` fixes the export.

## Approach B — bypass CAYW with a built-in BBT-search picker

Replace the broken CAYW dialog with an in-Obsidian `SuggestModal` that uses the
already-working `execSearch` (BBT `item.search`) and resolves the numeric library via
`getLibForCiteKey` (→ 1). This avoids Zotero's dialog entirely and is stable across
Zotero versions.

### Components
- **`src/bbt/searchPicker.ts`** (new)
  - `getCiteKeysViaSearch(database): Promise<CiteKey[]>`
  - Opens `ZoteroSearchModal` (SuggestModal): on input (≥2 chars) → `execSearch` →
    render `title · creators · year · citekey`; on choose → resolve `library` via
    `getLibForCiteKey(key)` (fallback `1` if null) → return `[{ key, library }]`.
- **`src/bbt/export.ts`** (1-line wiring)
  - In `exportToMarkdown`, replace `await getCiteKeys(database)` (the no-explicit-keys
    branch, ~line 605) with `await getCiteKeysViaSearch(database)`.
  - Other `getCiteKeys` call sites (citation/bib flows) left untouched (out of scope).

### Data flow
Paper Note → ZoteroSearchModal → execSearch → pick → `{ key, library:1 }` →
`getItemJSONFromCiteKeys(..., 1)` + existing annotation merge (`item.attachments`) →
template render → write note. No CAYW, no NaN.

## Build / test
- Build: `node esbuild.config.mjs production` → `main.js`.
- Deploy: copy `main.js` + `manifest.json` + `styles.css` into
  `<vault>/.obsidian/plugins/obsidian-zotero-integration/`; reload Obsidian.
- Headless pre-check (done): export pipeline confirmed with library=1.
- Manual check (user, once): run **Paper Note** → search/pick Floquet paper →
  note contains 17 annotations, **zero NaN errors** in Zotero console.

## Success criteria
Running "Paper Note" on Zotero 9 creates the annotated note (17 annotations, color
callouts, `zotero://` links) with no `NaN` / `itemTree` errors.

## Risks
Low. All dependencies (`execSearch`, `getLibForCiteKey`, `item.export` w/ library=1,
annotation merge) are independently verified working on Zotero 9.0.5 / BBT 9.0.29.

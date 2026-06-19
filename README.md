# Obsidian Zotero Integration — Zotero 9 fork

Fork of [mgmeyers/obsidian-zotero-integration](https://github.com/mgmeyers/obsidian-zotero-integration),
patched for **Zotero 9 / Better BibTeX 9**. General plugin usage: see the
[upstream docs](https://github.com/mgmeyers/obsidian-zotero-integration). This README
only covers what the fork changes.

## Why this fork

Upstream 3.2.1 is incompatible with Zotero 9. Item selection relies on Zotero's CAYW
citation dialog (`citationDialog.js`), which on Zotero 9 returns selected items
**without a numeric `libraryID`**. The plugin then calls Better BibTeX with `NaN`
item/library ids → `item ID 'NaN' is not an integer` and `no such column: NaN`, and
the import silently fails (plus `itemTree` "non-existant tree row" noise).

The data layer (Better BibTeX JSON-RPC) is healthy — **only the CAYW UI is broken**,
so this fork bypasses CAYW entirely.

## What's different

- **Built-in picker** instead of the broken CAYW dialog. Selection happens in Obsidian
  via a two-step picker (`src/bbt/searchPicker.ts`, `src/bbt/zoteroLocalApi.ts`):
  - 📖 **Recently opened** — papers by attachment `lastRead` (≈ what you have open)
  - 🔍 **Search all** — Better BibTeX `item.search`
  - 📁 **Collections** — full collection tree (Zotero local Web API `/api/users/0`);
    the collection currently selected in Zotero is surfaced first
- **Paper Note import** and **multi-select citation insert** both use the picker.
- **`Update active note`** command — re-renders the open note **in place** (keeps its
  folder), refreshing annotations + citation without creating a duplicate file
  (overrides `outputPathTemplate` with the active note's path).
- Citations rendered in **English** (locale forced) via `item.bibliography`.
- Area-annotation images named by **stable annotation id** → editing/moving an area
  overwrites the same image instead of piling up duplicates.

## Install

**From a Release (recommended)** — download `main.js`, `manifest.json`, `styles.css`
from [Releases](../../releases) into
`<vault>/.obsidian/plugins/obsidian-zotero-desktop-connector/`, then enable the plugin.

**From source**
```sh
npm install
node esbuild.config.mjs production   # builds main.js (gitignored)
# copy main.js into the plugin folder above
```

Requires the **Better BibTeX** plugin in Zotero. For citations, set a Quick Copy style
in Zotero (Settings → Export).

## Notes

- Personal fork — some choices are opinionated (CAYW fully replaced; citation
  locale/style hardcoded). Not intended as an upstream PR without generalization.
- Design notes: [`docs/superpowers/specs/2026-06-19-zotero9-bbt-picker-design.md`](docs/superpowers/specs/2026-06-19-zotero9-bbt-picker-design.md).

## License

GPL-3.0, same as upstream. Original plugin © mgmeyers.

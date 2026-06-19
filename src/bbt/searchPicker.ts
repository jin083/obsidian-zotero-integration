import { App, Notice, SuggestModal } from 'obsidian';

import { DatabaseWithPort } from '../types';
import { CiteKey } from './cayw';
import { execSearch, getLibForCiteKey } from './jsonRPC';

// Zotero 9's CAYW citation dialog (citationDialog.js) is incompatible and returns
// items without a numeric libraryID, producing NaN itemIDs downstream. This picker
// bypasses CAYW entirely: it selects items via BBT `item.search` (execSearch) and
// resolves the numeric library via `getLibForCiteKey`, both verified working.

function getKey(item: any): string {
  return item?.citekey || item?.citationKey || '';
}

function getCreators(item: any): string {
  if (!Array.isArray(item?.creators) && !Array.isArray(item?.author)) return '';
  const list = Array.isArray(item?.creators) ? item.creators : item.author;
  return list
    .map((c: any) =>
      typeof c === 'string' ? c : c?.lastName || c?.family || c?.name || ''
    )
    .filter(Boolean)
    .slice(0, 3)
    .join(', ');
}

class ZoteroSearchModal extends SuggestModal<any> {
  database: DatabaseWithPort;
  onPick: (item: any | null) => void;
  picked = false;

  constructor(
    app: App,
    database: DatabaseWithPort,
    onPick: (item: any | null) => void
  ) {
    super(app);
    this.database = database;
    this.onPick = onPick;
    this.setPlaceholder('Search Zotero by title, author, or citekey…');
  }

  async getSuggestions(query: string): Promise<any[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const results = await execSearch(q, this.database);
    return Array.isArray(results) ? results.filter((r) => getKey(r)) : [];
  }

  renderSuggestion(item: any, el: HTMLElement) {
    el.createEl('div', { text: item?.title || '(untitled)' });
    const year = (item?.issued?.['date-parts']?.[0]?.[0] ||
      item?.date ||
      item?.year ||
      '')
      .toString()
      .slice(0, 4);
    const meta = [getCreators(item), year, getKey(item)]
      .filter(Boolean)
      .join(' · ');
    if (meta) el.createEl('small', { text: meta });
  }

  onChooseSuggestion(item: any) {
    this.picked = true;
    this.onPick(item);
  }

  onClose() {
    super.onClose();
    // Obsidian fires onClose BEFORE onChooseSuggestion on selection, so defer the
    // "cancelled" resolution to the next tick to let a selection set `picked` first.
    window.setTimeout(() => {
      if (!this.picked) this.onPick(null);
    }, 0);
  }
}

export function getCiteKeysViaSearch(
  database: DatabaseWithPort
): Promise<CiteKey[]> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val: CiteKey[]) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    const modal = new ZoteroSearchModal(app, database, async (item) => {
      if (!item) return finish([]);
      const key = getKey(item);
      if (!key) {
        new Notice(
          'Selected item has no citekey. Ensure Better BibTeX is installed and the item has a citation key.',
          10000
        );
        return finish([]);
      }
      let library = await getLibForCiteKey(key, database);
      if (library == null) library = 1; // fall back to the personal library
      finish([{ key, library }]);
    });
    modal.open();
  });
}

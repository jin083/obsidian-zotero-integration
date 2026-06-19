import { App, Notice, SuggestModal } from 'obsidian';

import { CitationFormat, DatabaseWithPort } from '../types';
import { CiteKey } from './cayw';
import { execSearch, getBibFromCiteKeys, getLibForCiteKey } from './jsonRPC';
import {
  ZCollection,
  ZItem,
  getCollectionItems,
  getCollections,
  getRecentlyReadItems,
  getSelectedCollectionName,
} from './zoteroLocalApi';

// Zotero 9's CAYW citation dialog is incompatible (returns NaN libraryIDs and can't
// be driven externally). This 2-step picker replaces it: step 1 chooses a source
// (recently-opened / global search / a collection), step 2 picks paper(s). Data
// comes from the working BBT JSON-RPC + Zotero local Web API. Supports single
// (Paper Note) and multi (citation) selection.

type Source =
  | { kind: 'recent' }
  | { kind: 'search' }
  | { kind: 'collection'; collection: ZCollection };

type ItemChoice =
  | { type: 'item'; item: ZItem }
  | { type: 'back' }
  | { type: 'done' }
  | { type: 'cancel' };

const BACK_KEY = '__BACK__';
const DONE_KEY = '__DONE__';

function mapBBTResult(r: any): ZItem {
  const creators = Array.isArray(r.author)
    ? r.author
        .map((a: any) =>
          typeof a === 'string' ? a : a.family || a.literal || a.name || ''
        )
        .filter(Boolean)
        .slice(0, 3)
        .join(', ')
    : '';
  const year = (
    (r.issued?.['date-parts']?.[0]?.[0] || r.date || '').toString().match(
      /\d{4}/
    ) || ['']
  )[0];
  return {
    key: r.key || '',
    citekey: r.citekey || r.citationKey || '',
    title: r.title || '(untitled)',
    creators,
    year,
  };
}

function itemMeta(item: ZItem): string {
  return [item.creators, item.year, item.citekey].filter(Boolean).join(' · ');
}

class SourceModal extends SuggestModal<Source> {
  collections: ZCollection[];
  selectedName: string | null;
  onPick: (s: Source | null) => void;
  picked = false;

  constructor(
    app: App,
    collections: ZCollection[],
    selectedName: string | null,
    onPick: (s: Source | null) => void
  ) {
    super(app);
    this.collections = collections;
    this.selectedName = selectedName;
    this.onPick = onPick;
    this.setPlaceholder('Source: recently opened, search, or a collection…');
  }

  getSuggestions(query: string): Source[] {
    const q = query.trim().toLowerCase();
    const specials: Source[] = [{ kind: 'recent' }, { kind: 'search' }];
    let cols = this.collections;
    if (this.selectedName) {
      cols = [...cols].sort(
        (a, b) =>
          (a.name === this.selectedName ? 0 : 1) -
          (b.name === this.selectedName ? 0 : 1)
      );
    }
    const colEntries: Source[] = cols
      .filter((c) => !q || c.path.toLowerCase().includes(q))
      .map((c) => ({ kind: 'collection', collection: c }));
    const specialsMatch = specials.filter(
      (s) =>
        !q ||
        (s.kind === 'recent' && '최근 recent'.includes(q)) ||
        (s.kind === 'search' && 'search 검색 전체'.includes(q))
    );
    return [...specialsMatch, ...colEntries];
  }

  renderSuggestion(s: Source, el: HTMLElement) {
    if (s.kind === 'recent') {
      el.createEl('div', { text: '📖 최근 본 논문 (Recently opened)' });
      return;
    }
    if (s.kind === 'search') {
      el.createEl('div', { text: '🔍 전체 검색 (Search all)' });
      return;
    }
    const isSel = s.collection.name === this.selectedName;
    el.createEl('div', { text: `${isSel ? '📂▸ ' : '📁 '}${s.collection.path}` });
    el.createEl('small', { text: `${s.collection.numItems} items` });
  }

  onChooseSuggestion(s: Source) {
    this.picked = true;
    this.onPick(s);
  }

  onClose() {
    super.onClose();
    window.setTimeout(() => {
      if (!this.picked) this.onPick(null);
    }, 0);
  }
}

class ItemModal extends SuggestModal<ZItem> {
  live?: (q: string) => Promise<ZItem[]>;
  items?: ZItem[];
  selectedCount: number;
  onChoose: (c: ItemChoice) => void;
  picked = false;

  constructor(
    app: App,
    opts: {
      placeholder: string;
      live?: (q: string) => Promise<ZItem[]>;
      items?: ZItem[];
      selectedCount: number;
      onChoose: (c: ItemChoice) => void;
    }
  ) {
    super(app);
    this.live = opts.live;
    this.items = opts.items;
    this.selectedCount = opts.selectedCount;
    this.onChoose = opts.onChoose;
    this.setPlaceholder(opts.placeholder);
  }

  private specials(): ZItem[] {
    const out: ZItem[] = [];
    if (this.selectedCount > 0) {
      out.push({
        key: DONE_KEY,
        citekey: '',
        title: `✓ 완료 — ${this.selectedCount}개 인용 삽입`,
        creators: '',
        year: '',
      });
    }
    out.push({
      key: BACK_KEY,
      citekey: '',
      title: '⬅ 뒤로 (back to sources)',
      creators: '',
      year: '',
    });
    return out;
  }

  async getSuggestions(query: string): Promise<ZItem[]> {
    const specials = this.specials();
    if (this.live) {
      const q = query.trim();
      if (q.length < 2) return specials;
      const res = await this.live(q);
      return [...specials, ...res];
    }
    const q = query.trim().toLowerCase();
    const list = q
      ? (this.items || []).filter((i) =>
          `${i.title} ${i.creators} ${i.citekey}`.toLowerCase().includes(q)
        )
      : this.items || [];
    return [...specials, ...list];
  }

  renderSuggestion(item: ZItem, el: HTMLElement) {
    el.createEl('div', { text: item.title });
    if (item.key !== BACK_KEY && item.key !== DONE_KEY) {
      const meta = itemMeta(item);
      if (meta) el.createEl('small', { text: meta });
    }
  }

  onChooseSuggestion(item: ZItem) {
    this.picked = true;
    if (item.key === BACK_KEY) return this.onChoose({ type: 'back' });
    if (item.key === DONE_KEY) return this.onChoose({ type: 'done' });
    this.onChoose({ type: 'item', item });
  }

  onClose() {
    super.onClose();
    window.setTimeout(() => {
      if (!this.picked) this.onChoose({ type: 'cancel' });
    }, 0);
  }
}

function chooseSource(
  collections: ZCollection[],
  selectedName: string | null
): Promise<Source | null> {
  return new Promise((resolve) => {
    new SourceModal(app, collections, selectedName, resolve).open();
  });
}

function chooseItem(opts: {
  placeholder: string;
  live?: (q: string) => Promise<ZItem[]>;
  items?: ZItem[];
  selectedCount: number;
}): Promise<ItemChoice> {
  return new Promise((resolve) => {
    new ItemModal(app, { ...opts, onChoose: resolve }).open();
  });
}

async function loadSource(
  source: Source,
  database: DatabaseWithPort
): Promise<{
  placeholder: string;
  live?: (q: string) => Promise<ZItem[]>;
  items?: ZItem[];
}> {
  if (source.kind === 'search') {
    return {
      placeholder: 'Search all of Zotero…',
      live: async (q) => {
        const res = await execSearch(q, database);
        return Array.isArray(res)
          ? res.map(mapBBTResult).filter((i) => i.citekey)
          : [];
      },
    };
  }
  if (source.kind === 'recent') {
    return {
      placeholder: 'Recently opened in Zotero…',
      items: await getRecentlyReadItems(database),
    };
  }
  return {
    placeholder: source.collection.path,
    items: await getCollectionItems(database, source.collection.key),
  };
}

async function resolveCiteKey(
  item: ZItem,
  database: DatabaseWithPort
): Promise<CiteKey | null> {
  if (!item.citekey) {
    new Notice('Selected item has no Better BibTeX citekey.', 8000);
    return null;
  }
  let library = await getLibForCiteKey(item.citekey, database);
  if (library == null) library = 1;
  return { key: item.citekey, library };
}

// Core picker. multi=false returns the single chosen citekey; multi=true lets the
// user accumulate several (across sources) and finish via the "완료" entry.
async function pickCiteKeys(
  database: DatabaseWithPort,
  multi: boolean
): Promise<CiteKey[]> {
  const [collections, selectedName] = await Promise.all([
    getCollections(database).catch(() => [] as ZCollection[]),
    getSelectedCollectionName(database).catch(() => null),
  ]);

  const result: CiteKey[] = [];
  const chosen = new Set<string>();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const source = await chooseSource(collections, selectedName);
    if (!source) return result; // cancelled at source picker

    let info;
    try {
      info = await loadSource(source, database);
    } catch (e) {
      new Notice(`Failed to load items: ${e?.message}`, 8000);
      continue;
    }

    let backToSource = false;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const choice = await chooseItem({ ...info, selectedCount: result.length });
      if (choice.type === 'cancel') return result;
      if (choice.type === 'done') return result;
      if (choice.type === 'back') {
        backToSource = true;
        break;
      }
      // choice.type === 'item'
      const ck = await resolveCiteKey(choice.item, database);
      if (ck && !chosen.has(ck.key)) {
        chosen.add(ck.key);
        result.push(ck);
      }
      if (!multi) return result; // single-select: done on first pick
      // multi: loop reopens the same source so more can be added
    }
    if (!backToSource) return result;
  }
}

// Single-select picker (Paper Note export).
export function getCiteKeysViaPicker(
  database: DatabaseWithPort
): Promise<CiteKey[]> {
  return pickCiteKeys(database, false);
}

function buildCitation(citeKeys: CiteKey[], format: CitationFormat): string {
  const keys = citeKeys.map((k) => k.key);
  switch (format.format) {
    case 'pandoc':
      return format.brackets
        ? `[${keys.map((k) => '@' + k).join('; ')}]`
        : keys.map((k) => '@' + k).join('; ');
    case 'latex':
      return `\\${format.command || 'cite'}{${keys.join(',')}}`;
    case 'biblatex':
      return `\\${format.command || 'autocite'}{${keys.join(',')}}`;
    default:
      return keys.map((k) => '@' + k).join('; ');
  }
}

// Multi-select citation insert (replaces the broken CAYW path).
export async function getCitationViaPicker(
  format: CitationFormat,
  database: DatabaseWithPort
): Promise<string | null> {
  const citeKeys = await pickCiteKeys(database, true);
  if (!citeKeys.length) return null;

  if (
    format.format === 'formatted-citation' ||
    format.format === 'formatted-bibliography'
  ) {
    return getBibFromCiteKeys(citeKeys, database, format.cslStyle);
  }
  return buildCitation(citeKeys, format);
}

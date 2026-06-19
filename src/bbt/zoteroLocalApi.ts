import { request } from 'obsidian';

import { DatabaseWithPort } from '../types';
import { defaultHeaders, getPort } from './helpers';

// Helpers over Zotero's built-in local Web API (port 23119, /api/users/0 = current
// user). Used to browse collections / recently-read items for the picker, which the
// CAYW dialog can't provide externally on Zotero 9.

function apiBase(database: DatabaseWithPort) {
  return `http://127.0.0.1:${getPort(
    database.database,
    database.port
  )}/api/users/0`;
}

async function apiGet(database: DatabaseWithPort, path: string): Promise<any> {
  const res = await request({
    method: 'GET',
    url: `${apiBase(database)}${path}`,
    headers: defaultHeaders,
  });
  return JSON.parse(res);
}

export interface ZCollection {
  key: string;
  name: string;
  path: string;
  numItems: number;
}

export interface ZItem {
  key: string;
  citekey: string;
  title: string;
  creators: string;
  year: string;
}

function fmtItem(d: any): ZItem {
  const creators = Array.isArray(d.creators)
    ? d.creators
        .map((c: any) => c.lastName || c.name || '')
        .filter(Boolean)
        .slice(0, 3)
        .join(', ')
    : '';
  const year = ((d.date || '').toString().match(/\d{4}/) || [''])[0];
  return {
    key: d.key,
    citekey: d.citationKey || '',
    title: d.title || '(untitled)',
    creators,
    year,
  };
}

export async function getCollections(
  database: DatabaseWithPort
): Promise<ZCollection[]> {
  const raw = await apiGet(database, '/collections?limit=1000');
  if (!Array.isArray(raw)) return [];
  const byKey: Record<string, any> = {};
  for (const c of raw) byKey[c.key] = c;

  const pathOf = (c: any): string => {
    const parts = [c.data.name];
    let p = c.data.parentCollection;
    const seen = new Set<string>();
    while (p && byKey[p] && !seen.has(p)) {
      seen.add(p);
      parts.unshift(byKey[p].data.name);
      p = byKey[p].data.parentCollection;
    }
    return parts.join('/');
  };

  return raw
    .map((c: any) => ({
      key: c.key,
      name: c.data.name,
      path: pathOf(c),
      numItems: c.meta?.numItems ?? 0,
    }))
    .sort((a: ZCollection, b: ZCollection) => a.path.localeCompare(b.path));
}

export async function getCollectionItems(
  database: DatabaseWithPort,
  collectionKey: string
): Promise<ZItem[]> {
  const raw = await apiGet(
    database,
    `/collections/${collectionKey}/items/top?limit=300`
  );
  if (!Array.isArray(raw)) return [];
  return raw.map((it: any) => fmtItem(it.data)).filter((i: ZItem) => i.citekey);
}

// Approximates "papers currently open in Zotero": attachments carry a `lastRead`
// timestamp that updates when you open them in the reader. (True open tabs are not
// exposed over any HTTP API.)
export async function getRecentlyReadItems(
  database: DatabaseWithPort,
  limit = 25
): Promise<ZItem[]> {
  // sort by dateModified desc so freshly-read attachments float to the top even
  // when the paper was added long ago (reading updates the attachment's mtime).
  const atts = await apiGet(
    database,
    '/items?itemType=attachment&sort=dateModified&direction=desc&limit=200'
  );
  if (!Array.isArray(atts)) return [];
  const ordered = atts
    .filter((a: any) => a.data.lastRead && a.data.parentItem)
    .sort((a: any, b: any) => b.data.lastRead - a.data.lastRead);

  const parents: string[] = [];
  for (const a of ordered) {
    if (!parents.includes(a.data.parentItem)) parents.push(a.data.parentItem);
    if (parents.length >= limit) break;
  }
  if (!parents.length) return [];

  const items = await apiGet(
    database,
    `/items?itemKey=${parents.join(',')}&limit=${parents.length}`
  );
  if (!Array.isArray(items)) return [];

  const rank: Record<string, number> = {};
  parents.forEach((k, i) => (rank[k] = i));
  return items
    .map((it: any) => fmtItem(it.data))
    .filter((i: ZItem) => i.citekey)
    .sort((a: ZItem, b: ZItem) => (rank[a.key] ?? 999) - (rank[b.key] ?? 999));
}

// The collection currently selected in Zotero's pane (best-effort; returns its
// display name, matched against the collection tree by the caller).
export async function getSelectedCollectionName(
  database: DatabaseWithPort
): Promise<string | null> {
  try {
    const res = await request({
      method: 'POST',
      url: `http://127.0.0.1:${getPort(
        database.database,
        database.port
      )}/connector/getSelectedCollection`,
      body: '{}',
      headers: { 'Content-Type': 'application/json', ...defaultHeaders },
    });
    const j = JSON.parse(res);
    return j?.name || null;
  } catch (e) {
    return null;
  }
}

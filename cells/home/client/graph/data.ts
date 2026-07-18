/* ---------------------------------------------------------------------------
 * graph/data.ts — the substrate reads behind the constellation.
 *
 * Paged slice load (salience order, streamed), edge fetch, the change-feed
 * head, and the up-front graph model (salience config, layout atlas,
 * typography). Plus the two result-shaping helpers the graph reacts through.
 * All closure-free — extracted from graph.tsx (decomposition, 2026-07-17).
 * ------------------------------------------------------------------------- */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mcpCall } from '../lib';
import type { ListEntry } from '../facts';
import { setTypeGroup } from './style';

export interface GEdge {
  from: string;
  rel: string;
  to: string;
  derived?: boolean;
}

// The slice has grown past what one unbounded workspace.query can return
// inside the Lambda's own execution window (2026-07-11: an unbounded call
// started 502ing once the corpus crossed a few thousand facts — the query
// itself is fine, the single round trip just no longer fits). `workspace.
// query` already supports cursor paging (docs-sync.mjs's own liveShas() uses
// it the same way) — page through instead of one all-at-once request. The
// page size is arbitrary; large enough to keep round trips few, small enough
// to stay well under the timeout that bit the unbounded form.
//
// Every paged read's FIRST page already reports `total` — once known, every
// remaining page's offset is knowable up front (both `workspace.query` and
// `workspace.graph` use a plain numeric-offset cursor), so the rest fetch
// CONCURRENTLY (bounded).
//
// STREAMING (2026-07-12, owner: "far more incremental… instead of two
// bangs"): `onPage(items, total)` fires for every page as it lands —
// including the first — so the scene APPENDS continuously instead of
// mounting twice. The promise still resolves when the whole stream is done.
// Appearance order = fetch order = salience (the focus band materializes
// first, the periphery fills in); a seq/trajectory-replay ordering — the map
// drawing itself in the order the knowledge accreted — needs a one-line
// server rankBy:'seq' and is noted as a follow-up toggle.
export const INITIAL_ENTRY_LIMIT = 800;
export const LIVE_NODE_HEADROOM = 256;
export const LIVE_EDGE_CAPACITY = 30000;
export const CHANGE_POLL_MS = 12000;

export interface EntryPage {
  ok: boolean;
  items: ListEntry[];
  total: number;
  nextCursor: string | null;
}
export async function fetchEntryPage(cursor?: string | null): Promise<EntryPage> {
  const r = await mcpCall('read', 'workspace.query', {
    rankBy: 'salience',
    shape: 'card',
    limit: INITIAL_ENTRY_LIMIT,
    ...(cursor ? { cursor } : {}),
  });
  if (!r.ok) return { ok: false, items: [], total: 0, nextCursor: null };
  const page = r.value as { entries?: ListEntry[]; total?: number; nextCursor?: string } | null;
  return {
    ok: true,
    items: page?.entries ?? [],
    total: page?.total ?? page?.entries?.length ?? 0,
    nextCursor: page?.nextCursor ?? null,
  };
}

export async function fetchEdgesForKeys(keys: string[]): Promise<{ items: GEdge[]; total: number }> {
  if (!keys.length) return { items: [], total: 0 };
  const r = await mcpCall('read', 'workspace.edges', {
    keys,
    derived: false,
    limit: LIVE_EDGE_CAPACITY,
  });
  if (!r.ok) return { items: [], total: 0 };
  const page = r.value as { edges?: GEdge[]; total?: number } | null;
  return { items: page?.edges ?? [], total: page?.total ?? page?.edges?.length ?? 0 };
}

export interface ChangeEvent {
  op: 'write' | 'supersede' | 'link' | 'unlink' | string;
  key: string | null;
  rel?: string;
  to?: string;
  seq?: number;
}
export interface ChangePage {
  events?: ChangeEvent[];
  entries?: Record<string, Omit<ListEntry, 'key'> | null>;
  seq?: number;
}

export async function fetchChangeHead(): Promise<number | null> {
  const r = await mcpCall('read', 'workspace.changes', {
    sinceSeq: 'head',
    scope: { ops: ['write', 'supersede', 'link', 'unlink'] },
    include: 'entries',
    limit: 200,
  });
  return r.ok && typeof (r.value as ChangePage | null)?.seq === 'number'
    ? (r.value as ChangePage).seq as number
    : null;
}

/** Load the whole slice + projection into a render-ready model: nodes, edges,
 *  the focus band, and the semantic coordinates — REPLACED by the streaming
 *  path (2026-07-12): fetchGraphMeta loads only what positioning needs up
 *  front (salience config, the layout atlas, typography); entries/edges then
 *  STREAM into the mounted scene via the append API. */
export interface GraphMeta {
  coordMap: Record<string, number[]> | null;
  focusThreshold: number;
}
export async function fetchGraphMeta(): Promise<GraphMeta> {
  const [cfgRes, layoutRes, typoRes, shardsRes] = await Promise.all([
    mcpCall('read', 'workspace.peek', { key: '_config/salience' }).catch(() => null),
    mcpCall('read', 'workspace.peek', { key: '_home/embed2d' }).catch(() => null),
    mcpCall('read', 'workspace.peek', { key: '_config/typography' }).catch(() => null),
    // One prefix query replaces a fan-out of 16 individual shard peeks.
    mcpCall('read', 'workspace.query', {
      prefix: '_home/embed2d/s',
      shape: 'full',
      rankBy: 'recency',
      limit: 64,
    }).catch(() => null),
  ]);
  const typoVal = (typoRes && typoRes.ok ? (typoRes.value as { value?: { groups?: Record<string, string> } } | null)?.value : null) ?? null;
  if (typoVal?.groups && typeof typoVal.groups === 'object') setTypeGroup(typoVal.groups);
  const cfgVal = (cfgRes && cfgRes.ok ? (cfgRes.value as { value?: { focusThreshold?: unknown } } | null)?.value : null) ?? null;
  const ftRaw = Number(cfgVal?.focusThreshold);
  const focusThreshold = Number.isFinite(ftRaw) && ftRaw > 0 && ftRaw <= 1 ? ftRaw : 0.5;
  const layoutV = (layoutRes && layoutRes.ok
    ? (layoutRes.value as { value?: { coords?: Record<string, number[]>; shards?: number } } | null)?.value
    : null) ?? null;
  let coordMap: Record<string, number[]> | null = null;
  if (layoutV && typeof layoutV.shards === 'number' && layoutV.shards > 0) {
    const shardEntries = (shardsRes && shardsRes.ok
      ? (shardsRes.value as { entries?: Array<{ value?: { coords?: Record<string, number[]> } }> } | null)?.entries
      : null) ?? [];
    coordMap = {};
    for (const entry of shardEntries) {
      if (entry.value?.coords && typeof entry.value.coords === 'object') Object.assign(coordMap, entry.value.coords);
    }
    if (!Object.keys(coordMap).length) coordMap = null;
  } else if (layoutV?.coords && typeof layoutV.coords === 'object') {
    coordMap = layoutV.coords as Record<string, number[]>;
  }
  return { coordMap, focusThreshold };
}

/** Extract fact keys from an arbitrary console result (search/query/recall/
 *  neighbors/single-fact shapes) — best-effort, empty = no graph reaction. */
export function keysOfResult(value: unknown): string[] {
  const v = value as Record<string, any> | null;
  if (!v || typeof v !== 'object') return [];
  const out = new Set<string>();
  const entries = v.entries;
  if (Array.isArray(entries)) {
    for (const e of entries) if (e?.key) out.add(String(e.key));
  } else if (entries && typeof entries === 'object') {
    for (const k of Object.keys(entries)) out.add(k);
  }
  if (v.focus && typeof v.focus === 'object') for (const k of Object.keys(v.focus)) out.add(k);
  if (Array.isArray(v.members)) for (const m of v.members) if (m?.key) out.add(String(m.key));
  if (typeof v.key === 'string' && v.value !== undefined) out.add(v.key);
  return [...out];
}

/** Substrate plumbing stays out of the node band: reserved-namespace keys
 *  (`_canvas/…` placements, `_home/layout`, `_types/…`) are projections'
 *  raw material, not knowledge — a placement's geometry already surfaces as
 *  the el's `onBoard` edge (ADR-0046); showing the decoration fact too would
 *  scatter edgeless satellites across the graph. */
export const isPlumbing = (e: ListEntry): boolean => e.key.startsWith('_') || (e._meta?.type ?? '') === 'canvas-placement';

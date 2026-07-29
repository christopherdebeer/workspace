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
// `workspace.edges` use a plain numeric-offset cursor), so the rest fetch
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
// SIZED TO THE READ BUDGET (2026-07-29). Every read through the membrane is
// capped at 60KB, and these pages are `shape:'card'` — a value preview per
// entry, which the scene needs because node labels come from value fields
// (`factTitle` → `titleOf`), so `refs` is not an option here.
//
// Measured on the c15r slice: card ≈ 1.16KB/entry, refs ≈ 0.34KB/entry. So the
// old 800 was 931KB — fifteen times the budget — and the graph's FIRST read
// failed outright:
//
//   read("workspace.query") is too large to return whole (931KB over the 60KB
//   read budget)
//
// 800 was chosen when the constraint was a request TIMEOUT ("large enough to
// keep round trips few"), and that reasoning inverted when the constraint became
// response SIZE. 40 × 1.16KB ≈ 46KB leaves real headroom for a slice whose
// per-entry previews grow. This costs round trips and the design already pays
// them gladly: the first page reports `total`, the rest fetch CONCURRENTLY, and
// `onPage` streams each one into the scene as it lands — so more, smaller pages
// is the shape this loader already wanted.
export const INITIAL_ENTRY_LIMIT = 40;
// The fill-in after the fast orientation page trickles in as they arrive (see
// the auto-reveal pump in graph.tsx) — the map accretes continuously. Same
// budget arithmetic; there is no reason for the reveal page to exceed the
// initial one.
export const REVEAL_ENTRY_LIMIT = 40;
export const LIVE_NODE_HEADROOM = 256;
export const LIVE_EDGE_CAPACITY = 30000;
export const CHANGE_POLL_MS = 12000;

export interface EntryPage {
  ok: boolean;
  items: ListEntry[];
  total: number;
  nextCursor: string | null;
}
export async function fetchEntryPage(cursor?: string | null, limit = INITIAL_ENTRY_LIMIT): Promise<EntryPage> {
  const r = await mcpCall('read', 'workspace.query', {
    rankBy: 'salience',
    shape: 'card',
    limit,
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

/** Keys per `workspace.edges` request. Measured on the c15r slice: ~6.4 edges
 *  per key at ~225b each, so ~1.45KB/key — 20 keys ≈ 29KB, comfortably inside
 *  the 60KB read budget with room for a densely-linked node. `LIVE_EDGE_CAPACITY`
 *  stays as the per-request edge ceiling; it was never the binding constraint,
 *  the KEY COUNT is (800 nodes in one call would have been ~1.16MB).
 *
 *  Server-side, `edges({keys, derived:false})` now answers each chunk with
 *  per-key narrow index queries (2 per key), NOT a full edge-partition read —
 *  so chunking bounds response size only; it no longer multiplies read cost. */
const EDGE_KEY_CHUNK = 20;

/**
 * Edges for a set of node keys, chunked to fit the read budget.
 *
 * This used to pass every key in one request with `limit: 30000`. That limit
 * bounds edges, not response size, and the response scales with the key set —
 * so as the scene accreted nodes the call grew without bound and eventually
 * exceeded the budget, taking the graph's edges with it. Chunking bounds the
 * RESPONSE instead: fixed keys per request, concurrent, merged.
 */
/** The membrane's budget refusal is DETERMINISTIC — retrying the same chunk
 *  verbatim can never succeed. A dense chunk (hubs land together in salience
 *  order) can exceed the estimate above, so on refusal SPLIT the chunk and
 *  recurse; a single key still over budget is one hub's whole neighbourhood —
 *  take it knowingly with `whole: true` rather than dropping its edges. */
const BUDGET_REFUSED = /too large to return whole/;
async function fetchEdgeChunk(chunk: string[]): Promise<{ edges: GEdge[]; total: number }> {
  const r = await mcpCall('read', 'workspace.edges', { keys: chunk, derived: false, limit: LIVE_EDGE_CAPACITY });
  if (r.ok) {
    const page = r.value as { edges?: GEdge[]; total?: number } | null;
    return { edges: page?.edges ?? [], total: page?.total ?? page?.edges?.length ?? 0 };
  }
  if (typeof r.value === 'string' && BUDGET_REFUSED.test(r.value)) {
    if (chunk.length === 1) {
      const rw = await mcpCall('read', 'workspace.edges', { keys: chunk, derived: false, limit: LIVE_EDGE_CAPACITY, whole: true });
      if (!rw.ok) return { edges: [], total: 0 };
      const page = rw.value as { edges?: GEdge[]; total?: number } | null;
      return { edges: page?.edges ?? [], total: page?.total ?? page?.edges?.length ?? 0 };
    }
    const mid = Math.ceil(chunk.length / 2);
    const [a, b] = await Promise.all([fetchEdgeChunk(chunk.slice(0, mid)), fetchEdgeChunk(chunk.slice(mid))]);
    return { edges: [...a.edges, ...b.edges], total: a.total + b.total };
  }
  return { edges: [], total: 0 };
}

export async function fetchEdgesForKeys(keys: string[]): Promise<{ items: GEdge[]; total: number }> {
  if (!keys.length) return { items: [], total: 0 };
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += EDGE_KEY_CHUNK) chunks.push(keys.slice(i, i + EDGE_KEY_CHUNK));
  const pages = await Promise.all(chunks.map(fetchEdgeChunk));
  // A chunk boundary can surface the same edge twice (both endpoints in the key
  // set land in different chunks), so dedupe on the edge's identity triple.
  const seen = new Set<string>();
  const items: GEdge[] = [];
  for (const p of pages) {
    for (const e of p.edges) {
      const id = `${e.from}${e.rel}${e.to}`;
      if (seen.has(id)) continue;
      seen.add(id);
      items.push(e);
    }
  }
  return { items, total: items.length };
}

// ── graph tuning as a CONFIG FACT (ADR-0078 `_config/*` namespace) ──────────
// The tuner's overrides live in the substrate, not just localStorage, so they
// are inspectable through the membrane (workspace.peek `_config/home.graph.tune`)
// and follow the owner across devices. The `_`-prefix keeps the fact out of the
// graph scene (isPlumbing). localStorage stays the fast local cache for first
// paint; the fact is merged in before the scene mounts and is the source of
// truth when present.
export const TUNE_CONFIG_KEY = '_config/home.graph.tune';
export async function fetchTuneConfig(): Promise<Record<string, unknown> | null> {
  const r = await mcpCall('read', 'workspace.peek', { key: TUNE_CONFIG_KEY }).catch(() => null);
  if (!r?.ok) return null;
  const v = (r.value as { value?: unknown } | null)?.value;
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}
export async function saveTuneConfig(tune: Record<string, unknown>): Promise<boolean> {
  const r = await mcpCall('act', 'workspace.remember', {
    key: TUNE_CONFIG_KEY,
    value: tune,
    via: 'home.graph tuner',
  }).catch(() => null);
  return !!r?.ok;
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
  /** Per-owner PUBLIC coordMaps (`<owner>/_home/embed2d.pub`, ADR-0092 Inc 2):
   *  grant-folded `owner/key` nodes seat from THEIR owner's map — never from a
   *  flat merged map (each owner's coords live in their own basis; see
   *  graph/seats.ts). Null when no granting owner serves one. */
  pubMaps: Record<string, Record<string, number[]>> | null;
  focusThreshold: number;
}
/** Cap on granting owners whose public layout we fetch — one peek each. */
const PUB_MAP_OWNER_CAP = 12;
export async function fetchGraphMeta(): Promise<GraphMeta> {
  // `whole: true` on the layout reads (the membrane's informed-consent escape
  // hatch): the read budget refuses over-60KB results, and the layout is
  // legitimately large — the root fact alone is ~82KB (a PCA basis is two
  // 1024-float rows) and the shard query ~655KB on the measured slice. These
  // fetches are all defensively caught, so the refusal silently became "no
  // coordinate map" and EVERY star seated at the default ring (2026-07-29,
  // positions-defaulting regression). The UI knows exactly what it is asking
  // for; consent is the point of the flag.
  const [cfgRes, layoutRes, typoRes, shardsRes, sharedRes] = await Promise.all([
    mcpCall('read', 'workspace.peek', { key: '_config/salience' }).catch(() => null),
    mcpCall('read', 'workspace.peek', { key: '_home/embed2d', whole: true }).catch(() => null),
    mcpCall('read', 'workspace.peek', { key: '_config/typography' }).catch(() => null),
    // One prefix query replaces a fan-out of 16 individual shard peeks.
    mcpCall('read', 'workspace.query', {
      prefix: '_home/embed2d/s',
      shape: 'full',
      rankBy: 'recency',
      limit: 64,
      whole: true,
    }).catch(() => null),
    // The owners whose slices fold into this view (`receiving` is the
    // applicable set — direct + public + group; for @guest that's every owner
    // with public shares) — each may serve a public layout (ADR-0092).
    mcpCall('read', 'workspace.shared', {}).catch(() => null),
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
  // Per-owner public layouts (ADR-0092 Inc 2): one peek per granting owner via
  // peek's `owner/key` addressing (resolves through the grant fold — a viewer
  // only ever receives an artifact a `public` grant covers). Misses and owners
  // without one degrade silently to the golden-spiral fallback seat.
  let pubMaps: Record<string, Record<string, number[]>> | null = null;
  const receiving = (sharedRes && sharedRes.ok
    ? (sharedRes.value as { receiving?: Array<{ owner?: string }> } | null)?.receiving
    : null) ?? [];
  const owners = [...new Set(receiving.map((g) => g.owner).filter((o): o is string => typeof o === 'string' && !!o))].slice(0, PUB_MAP_OWNER_CAP);
  if (owners.length) {
    const fetched = await Promise.all(owners.map(async (o) => {
      const r = await mcpCall('read', 'workspace.peek', { key: `${o}/_home/embed2d.pub` }).catch(() => null);
      const coords = r && r.ok ? (r.value as { value?: { coords?: Record<string, number[]> } } | null)?.value?.coords : null;
      return [o, coords] as const;
    }));
    for (const [o, coords] of fetched) {
      if (coords && typeof coords === 'object' && Object.keys(coords).length) (pubMaps ??= {})[o] = coords;
    }
  }
  return { coordMap, pubMaps, focusThreshold };
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
export const isPlumbing = (e: ListEntry): boolean => {
  if (e.key.startsWith('_') || (e._meta?.type ?? '') === 'canvas-placement') return true;
  // Grant-folded plumbing (ADR-0092): a foreign owner's reserved-namespace fact
  // arrives keyed `owner/_…` — e.g. the shared `_home/embed2d.pub` layout
  // artifact or a `_public/` reflection a public grant happens to cover. Same
  // rule, one segment deeper. (An own key whose SECOND segment starts with `_`
  // is caught too — acceptable: that spelling is reserved-namespace-shaped.)
  const slash = e.key.indexOf('/');
  return slash > 0 && e.key.charCodeAt(slash + 1) === 95 /* '_' */;
};

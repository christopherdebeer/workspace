/**
 * Read-response shaping (ADR-0048): reads answer at the caller's altitude.
 *
 * Every collection read accepts one `shape` argument with three tiers — the
 * same progressive-disclosure ladder recall's overview already climbs, made
 * uniform (L4: one structure, not per-command knobs):
 *
 *   - `refs`  — the pointer: key + the salience essentials of `_meta`. No value.
 *   - `card`  — the presentable row: value with long strings truncated and deep
 *               structure summarised (titles/labels/first-lines survive, bodies
 *               don't), `_meta` essentials. What a list/chip/graph node needs.
 *   - `full`  — everything, exactly as stored (today's behavior).
 *
 * Shaping is presentation, never authority: it narrows what is SENT, not what
 * the caller may read — `peek`/`shape:"full"` always restores the whole fact.
 * Shaped entries carry `_meta.shaped` so consumers can tell a truncated body
 * from a short one.
 */
import type { Entry, EntryMeta } from '../../platform/runtime';

export type ReadShape = 'refs' | 'card' | 'full';

/** Max characters a card-tier string keeps (about a title + a first paragraph). */
const CARD_STR = 240;
/** Card tier keeps structure to this depth; deeper nesting is summarised. */
const CARD_DEPTH = 2;
const CARD_LIST = 12;
const CARD_FIELDS = 24;

/** Truncate a value for the card tier, preserving its shape: scalars and field
 *  names survive, long strings are cut (with `…`), deep/large structure is
 *  summarised — so label paths (`value.title`, `value.name`, a content first
 *  line) still resolve on the shaped value. */
export function cardValue(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > CARD_STR ? `${v.slice(0, CARD_STR)}…` : v;
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    if (depth >= CARD_DEPTH) return `[${v.length} items]`;
    const out = v.slice(0, CARD_LIST).map((x) => cardValue(x, depth + 1));
    if (v.length > CARD_LIST) out.push(`… ${v.length - CARD_LIST} more`);
    return out;
  }
  const fields = Object.entries(v as Record<string, unknown>);
  if (depth >= CARD_DEPTH) return `{${fields.length} fields}`;
  const out: Record<string, unknown> = {};
  for (const [k, x] of fields.slice(0, CARD_FIELDS)) out[k] = cardValue(x, depth + 1);
  if (fields.length > CARD_FIELDS) out['…'] = `${fields.length - CARD_FIELDS} more fields`;
  return out;
}

/** The `_meta` slice that survives the refs tier: identity, vocabulary signals
 *  (type/tags — key-prefix routing needs them), salience, freshness. The card
 *  tier keeps `_meta` whole — values are where the weight lives. */
function refsMeta(m: EntryMeta): EntryMeta {
  return {
    type: m.type,
    tags: m.tags,
    score: m.score,
    updatedAt: m.updatedAt,
    superseded: m.superseded,
    shaped: 'refs',
  } as unknown as EntryMeta;
}

export function shapeEntry<E extends { value?: unknown; _meta: EntryMeta }>(e: E, shape: ReadShape | undefined): E {
  if (!shape || shape === 'full') return e;
  if (shape === 'refs') {
    const { value: _drop, ...rest } = e as E & { value?: unknown };
    return { ...rest, _meta: refsMeta(e._meta) } as unknown as E;
  }
  return { ...e, value: cardValue(e.value), _meta: { ...e._meta, shaped: 'card' } as unknown as EntryMeta };
}

/** Shape an entry ARRAY (query/search results, members). */
export function shapeEntryList<E extends { value?: unknown; _meta: EntryMeta }>(list: E[], shape: ReadShape | undefined): E[] {
  if (!shape || shape === 'full') return list;
  return list.map((e) => shapeEntry(e, shape));
}

/** Shape a key→Entry MAP (neighbors' entries, recall's full view). */
export function shapeEntryMap(map: Record<string, Entry>, shape: ReadShape | undefined): Record<string, Entry> {
  if (!shape || shape === 'full') return map;
  const out: Record<string, Entry> = {};
  for (const [k, e] of Object.entries(map)) out[k] = shapeEntry(e, shape);
  return out;
}

export interface EdgeScopeInput {
  /** Only edges touching ANY of these keys (either end). */
  keys?: string[];
  /** Only these rels (e.g. `["onBoard","related"]`). */
  rels?: string[];
  /** Cap the returned edges; the response's `total` still counts every match. */
  limit?: number;
  /** Resume token from a previous page's `nextCursor` (an opaque offset into
   *  the post-filter edge list). CloudFront's default origin timeout caps a
   *  synchronous call at ~30s regardless of the Lambda's own configured
   *  timeout, so a caller whose projection is large enough to risk that (or
   *  the 6MB Lambda response payload ceiling) must page rather than raise
   *  `limit` — see ADR-0081's home-cell incident. */
  cursor?: string;
}

/** Scope an edge list by keys/rels and page it, reporting the pre-page total —
 *  `{limit: 0}` is the idiomatic "just count them". `state.graph`/`state.edges`
 *  still compute the WHOLE projection server-side (paging happens after, over
 *  the already-materialized array) — this bounds response SIZE, not compute
 *  cost; a caller with a projection large enough to time out the computation
 *  itself needs a different fix (streaming the state layer), not this. */
export function scopeEdges<T extends { from: string; rel: string; to: string }>(
  edges: T[],
  input: EdgeScopeInput | undefined,
): { edges: T[]; total: number; nextCursor?: string } {
  let out = edges;
  if (input?.keys?.length) {
    const keys = new Set(input.keys);
    out = out.filter((e) => keys.has(e.from) || keys.has(e.to));
  }
  if (input?.rels?.length) {
    const rels = new Set(input.rels);
    out = out.filter((e) => rels.has(e.rel));
  }
  const total = out.length;
  const offset = Math.max(0, parseInt(input?.cursor ?? '0', 10) || 0);
  if (input?.limit === undefined) return { edges: out.slice(offset), total };
  const limit = Math.max(0, input.limit);
  const page = out.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return { edges: page, total, ...(nextOffset < total ? { nextCursor: String(nextOffset) } : {}) };
}

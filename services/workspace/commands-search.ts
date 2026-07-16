/**
 * Workspace command group (ADR-0044 Inc 5): search/vectors (ADR-0030/0031/0032)
 * — search, reindex, pruneSimilar, suggestions, ratify, plus the async chunked
 * reindex worker.
 */
import {
  requireUser,
  hasScope,
  ServiceAuthError,
  type Identity,
  type EntryMeta,
  type LinkResult,
  type VectorFilter,
  indexForScope,
  embeddableText,
  metadataForFact,
  selectNeighbors,
  similarConfig,
  refreshSimilarEdges,
  authoredPairs,
  pairKey,
  suggestionCandidates,
  dropSimilarPair,
  RATIFY_LINK_TYPES,
  type SuggestionCandidate,
  SIMILAR_REL,
  SIMILAR_WRITER,
  projectionArtifacts,
  layoutShardKey,
  LAYOUT_KEY,
  contentHash,
  isTimerLive,
} from '../../platform/runtime';
import type { EventBridgeHandler } from '../../platform/runtime';
import { shapeEntryList, type ReadShape } from './shape';
import { applicableGrants, grantCovers } from './grants';
import {
  type DepsBuilder,
  type WorkspaceDeps,
  typeDeclsFor,
  affordancesForTypes,
  typesOf,
  type TypeAffordance,
  enforceTypeRead,
} from './shared';
import type { WorkspaceCommands } from './handlers';

/** High-volume runtime/machine fact types that cluster by *format* rather than meaning
 *  (ADR-0032) — excluded from `suggestions` by default so the candidate list stays
 *  curatable; `includeRuntime: true` surfaces them. */
const SUGGESTION_RUNTIME_TYPES = new Set([
  'transcript',
  'agent-run',
  'cell',
  'reindex-status',
  'audit',
  'claim',
  'canvas-element',
  // The machine vocabulary (ADR-0072 live finding): run/trigger/node facts of the
  // same machine cluster at cosine ≈0.9999 by format — the first live `contested`
  // read was 90% these pairs. Plumbing, not meaning; `includeRuntime` re-admits.
  'machine-run',
  'machine-trigger',
  'machine-node',
  'machine-rail',
  'trigger',
]);

/** Reserved key for a scope's suggestion/contested noise policy. The built-in set
 *  above is only the FALLBACK FLOOR — vocabulary is the protocol, and which types
 *  are format-clustered plumbing is a property of a slice's own vocabulary, not of
 *  the platform. A fact here (`{ noiseTypes?: string[], admitTypes?: string[] }`)
 *  extends the floor (`noiseTypes`) and/or re-admits floor entries (`admitTypes`)
 *  — open-ended, per-slice, no redeploy. */
export const SUGGESTIONS_CONFIG_KEY = '_config/suggestions';

/** Resolve the effective noise-type set from the slice's declared config over the
 *  built-in floor (defensive: unknown shapes are ignored, never fatal). */
function noiseTypesFor(records: Array<{ key: string; superseded: boolean; value: unknown }>): Set<string> {
  const out = new Set(SUGGESTION_RUNTIME_TYPES);
  const cfg = records.find((r) => r.key === SUGGESTIONS_CONFIG_KEY && !r.superseded)?.value as
    | { noiseTypes?: unknown; admitTypes?: unknown }
    | undefined;
  if (Array.isArray(cfg?.noiseTypes)) for (const t of cfg.noiseTypes) if (typeof t === 'string') out.add(t);
  if (Array.isArray(cfg?.admitTypes)) for (const t of cfg.admitTypes) if (typeof t === 'string') out.delete(t);
  return out;
}

/** How an adjudicator writes a contested verdict back — existing verbs only (ADR-0072). */
const CONTESTED_HINT =
  'Adjudicate each pair (verdict: contradict | subsumes | duplicate | independent). ' +
  'contradict → remember `contested/<hash>` {a, b, why, verdict} + link a --contradicts--> b. ' +
  'duplicate → consider supersede; subsumes → consider a refines edge. ' +
  'ALWAYS remember `checked/<hash>` {a, b, verdict, versions} (echo this candidate’s `versions`) — ' +
  'the pair then stays out of this read until either fact’s version drifts.';

/** A short human label for a fact, for surfaces that show a key without its full value
 *  (e.g. `suggestions`): prefer a `title`/`name`/`label` on the value, else the key. */
function labelForRecord(key: string, value: unknown): string {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    for (const f of ['title', 'name', 'label', 'summary'] as const) {
      if (typeof v[f] === 'string' && v[f]) return (v[f] as string).slice(0, 120);
    }
  }
  if (typeof value === 'string' && value) return value.slice(0, 120);
  return key;
}

export interface SearchInput {
  /** Natural-language query — embedded and matched by meaning (ADR-0030). */
  text: string;
  /** Restrict to one fact type (also the granular `read:type:<T>` pin). */
  type?: string;
  /** Restrict to facts carrying this (primary) tag. */
  tag?: string;
  /** Max results (1–50, default 10). */
  limit?: number;
  /** Entry tier (ADR-0048): refs/card/full. Default full; result lists want card. */
  shape?: ReadShape;
}
export interface SearchHit {
  key: string;
  value: unknown;
  _meta: EntryMeta;
  /** Cosine similarity to the query (1 = closest). */
  score: number;
}
export interface SearchResult {
  entries: SearchHit[];
  count: number;
  total: number;
  /** Inline affordances (ADR-0029 R1) for the types present — present when ≥1 declared. */
  types?: Record<string, TypeAffordance>;
  /** Present when no vector backend is configured (degraded to query/contains). */
  hint?: string;
}
export interface ReindexInput {
  /** Only reindex facts of this type. */
  type?: string;
  /** Only reindex keys with this prefix. */
  prefix?: string;
  /** Cap on facts scanned (1–5000, default 2000). */
  max?: number;
}
export interface PruneSimilarInput {
  /** Cap on inferred edges deleted in one pass (default: all redundant). */
  max?: number;
}
export interface SuggestionsInput {
  /** Cap on candidates returned (default 25). */
  limit?: number;
  /** Include high-volume runtime/machine facts (transcripts, agent-runs, cells, …) that
   *  are filtered out by default as format-clustered noise. */
  includeRuntime?: boolean;
}
/** A ratification candidate enriched with each endpoint's type + a short label. */
export interface SuggestionEntry extends SuggestionCandidate {
  /** The pair's stable id: what `lease({domain:"suggestion", item})` and the
   *  `checked/<hash>` markers key on (ADR-0086/ADR-0072). */
  pairHash: string;
  fromLabel: string;
  fromType: string | null;
  toLabel: string;
  toType: string | null;
  /** Both endpoints share a content hash: byte-identical text, where the
   *  near-1.0 score is textual identity — a dedupe/prune candidate, not a
   *  connection to ratify (membrane wave 1, F5). */
  identical?: boolean;
  /** A participant currently holds `lease/suggestion/<pairHash>` on this pair
   *  (ADR-0086 Inc 3) — it is in-flight; skip it rather than double-adjudicate. */
  leasedBy?: string | null;
  leasedUntil?: string | null;
}
export interface SuggestionsResult {
  suggestions: SuggestionEntry[];
  /** The recommended relation vocabulary to ratify a suggestion into. */
  vocab: readonly string[];
  /** Total candidates before `limit` (so a caller knows there are more). */
  total: number;
  /** Present when identical pairs were flagged — what the scores imply. */
  hint?: string;
}
export interface RatifyInput {
  from: string;
  to: string;
  /** The relation to assert — recommended one of `RATIFY_LINK_TYPES`, but any string is accepted. */
  rel: string;
  /** Edge strength (default null = full authored weight). */
  strength?: number | null;
}
export interface RatifyResult {
  edge: LinkResult;
  /** Inferred `similarTo` edges dropped between the pair (the suggestion, now redundant). */
  dropped: number;
  ratified: true;
}

// ── ADR-0072 (C7): the contested read — Stage A of the contradiction detector ──

export interface ContestedInput {
  /** Cap on candidates returned (1–50, default 10) — Stage B adjudication is metered. */
  limit?: number;
  /** Cosine floor (default 0.5): contradiction candidates should be CLOSE, not merely related. */
  minScore?: number;
  /** Include high-volume runtime/machine fact types (filtered as format-clustered noise by default). */
  includeRuntime?: boolean;
}
/** One adjudication candidate: a semantically-near, structurally-unconnected pair that
 *  shares a type or tag — worth checking for divergent claims. Carries everything the
 *  adjudicator needs to write its verdict back with existing verbs. */
export interface ContestedCandidate {
  a: string;
  b: string;
  /** Cosine similarity between the pair (from the inferred kinship edge). */
  score: number | null;
  aLabel: string;
  bLabel: string;
  aType: string | null;
  bType: string | null;
  sharedTags: string[];
  /** Unordered pair hash — the `checked/<hash>` / `contested/<hash>` key suffix. */
  hash: string;
  /** Each fact's current content-hash version — store these on the `checked/<hash>`
   *  marker so the pair is re-adjudicated only when either fact actually changes. */
  versions: { a: string; b: string };
}
export interface ContestedResult {
  candidates: ContestedCandidate[];
  /** Candidates before the limit cap (so a caller knows there are more). */
  total: number;
  /** Pairs skipped because a current `checked/<hash>` marker already adjudicated them. */
  checked: number;
  /** How to write a verdict back (existing verbs only — no new write surface). */
  hint: string;
}

/** The search/vectors command handlers (ADR-0044 Inc 5). LAYOUT_KEY re-exported
 *  for existing importers — it now lives in platform/runtime/projection.ts so
 *  the live vector-indexer can read/patch it too. */
export { LAYOUT_KEY };

export function createSearchCommands(build: DepsBuilder): Pick<WorkspaceCommands, 'search' | 'reindex' | 'project' | 'pruneSimilar' | 'suggestions' | 'ratify' | 'contested'> {
  return {
    async search(input, ctx) {
      const viewer = requireUser(ctx.identity);
      const { state, grants, vectors } = build(ctx);
      // No backend wired → degrade gracefully (the substrate still has query/contains).
      if (!vectors) {
        return {
          entries: [],
          count: 0,
          total: 0,
          hint: 'semantic search is not configured on this deployment — use workspace.query (type/tag/prefix filter) or query `contains` (substring search)',
        };
      }
      const text = typeof input?.text === 'string' ? input.text.trim() : '';
      if (!text) throw new Error('text is required');
      enforceTypeRead(ctx.identity, input?.type, ''); // granular read-scope (§B): a type-scoped token must pin `type`
      const limit = Math.min(Math.max(1, input?.limit ?? 10), 50);
      const topK = limit * 4; // over-fetch; the authoritative re-read + grant post-filter trim

      const [queryVector] = await vectors.embedder.embed([text]);
      // Filter on string metadata only (type/tag) — safest across S3 Vectors filter
      // value types. `superseded` is NOT filtered here: the authoritative re-read
      // (Decision 1) drops retired facts, so the filter is pure optimization, and a
      // boolean-filter edge case must never break the whole query.
      const filter: VectorFilter = {};
      if (input?.type) filter.type = input.type;
      if (input?.tag) filter.tag = input.tag;
      const queryOpts = Object.keys(filter).length ? { topK, filter } : { topK };

      // Candidate generation (ADR-0030 Decision 1: the index is NOT an authority).
      // The readable index set mirrors recall's fold: own slice + every applicable
      // grant's owner (direct/public/group). Each hit is re-read authoritatively below.
      type Cand = { owner: string; key: string; outKey: string; score: number };
      const cands: Cand[] = [];
      const dim = vectors.embedder.dimension;
      const ownMatches = await vectors.store.query(indexForScope(viewer, dim), queryVector, queryOpts).catch(() => []);
      for (const m of ownMatches) cands.push({ owner: viewer, key: m.key, outKey: m.key, score: m.score });
      for (const g of await applicableGrants(grants, viewer)) {
        if (g.owner === viewer) continue;
        const matches = await vectors.store.query(indexForScope(g.owner, dim), queryVector, queryOpts).catch(() => []);
        for (const m of matches) {
          if (!grantCovers(g.key, m.key)) continue; // whole-slice / prefix / exact — exactly as peek
          cands.push({ owner: g.owner, key: m.key, outKey: `${g.owner}/${m.key}`, score: m.score });
        }
      }

      // Collapse a key reachable via >1 path to its best score, then rank.
      const best = new Map<string, Cand>();
      for (const c of cands) {
        const prev = best.get(c.outKey);
        if (!prev || c.score > prev.score) best.set(c.outKey, c);
      }
      const ranked = [...best.values()].sort((a, b) => b.score - a.score);

      // Authoritative re-read (Decision 1): scope/grant/timer/supersession re-enforced
      // on the LIVE substrate with the viewer's identity. A stale or wrong vector — a
      // superseded fact still in the index, a lapsed lease — is dropped here, never leaked.
      const entries: Array<{ key: string; value: unknown; _meta: EntryMeta; score: number }> = [];
      for (const c of ranked) {
        if (entries.length >= limit) break;
        const e = await state.get(c.owner, c.key, ctx.identity);
        if (!e || e._meta.superseded) continue;
        entries.push({ key: c.outKey, value: e.value, _meta: e._meta, score: Number(c.score.toFixed(4)) });
      }

      const types = affordancesForTypes(typesOf(entries), await typeDeclsFor(ctx)); // R1 envelope
      const result = { entries: shapeEntryList(entries, input.shape), count: entries.length, total: entries.length };
      return Object.keys(types).length ? { ...result, types } : result;
    },

    async reindex(input, ctx) {
      const scope = requireUser(ctx.identity);
      // Admin-only backfill. ASYNC + CHUNKED (ADR-0030/0031): a full slice is ~hundreds
      // of Titan calls — far over the ~30s edge cap AND the 60s Lambda — so the command
      // only *dispatches*: it records a `running` status fact and emits the first
      // continuation event, returning immediately. `createReindexHandler` then processes
      // one bounded page per invocation off the stream, chaining continuation events
      // (embed all → then similarTo edges, which need the full index present). Poll the
      // status fact. The live stream indexer keeps NEW writes indexed; this is the replay.
      if (!hasScope(ctx.identity, 'workspace:admin') && !hasScope(ctx.identity, 'platform:*')) {
        throw new ServiceAuthError('reindex requires workspace:admin');
      }
      const { state, vectors } = build(ctx);
      if (!vectors) return { status: 'unconfigured', hint: 'semantic search is not configured on this deployment' };
      const statusKey = `_reindex/${scope}`;
      const value: Record<string, unknown> = { status: 'running', phase: 'embed', indexed: 0, skipped: 0, edges: 0, startedAt: new Date().toISOString() };
      if (input?.type) value.type = input.type;
      if (input?.prefix) value.prefix = input.prefix;
      if (input?.max) value.max = input.max;
      await state.put({ scope, key: statusKey, value, via: 'reindex', type: 'reindex-status' }, ctx.identity);
      await ctx.events.emit('workspace.reindex.requested', { scope, type: input?.type, prefix: input?.prefix, max: input?.max, phase: 'embed', indexed: 0, skipped: 0, edges: 0 });
      ctx.logger.info('reindex dispatched (async, chunked)', { scope, type: input?.type, prefix: input?.prefix });
      return { status: 'started', poll: statusKey, hint: `reindex runs async in chunks; poll peek("${statusKey}") for { status, phase, indexed, edges }` };
    },

    async project(_input, ctx) {
      const scope = requireUser(ctx.identity);
      // Compute the 2D SEMANTIC layout (ADR-0047 stage 2): read the whole vector
      // index and project it to a plane the home graph places nodes on. Owner/
      // admin-gated (it reads every vector). SYNCHRONOUS, unlike reindex — PCA
      // over ~1k vectors is a few hundred ms (no per-fact Titan calls; the index
      // is already embedded), so it stays inside the request budget.
      if (!hasScope(ctx.identity, 'workspace:admin') && !hasScope(ctx.identity, 'platform:*')) {
        throw new ServiceAuthError('project requires workspace:admin');
      }
      const { state, vectors } = build(ctx);
      if (!vectors) return { status: 'unconfigured', hint: 'semantic search is not configured on this deployment' };
      const dim = vectors.embedder.dimension;
      const index = indexForScope(scope, dim);
      const records = await vectors.store.list(index);
      if (records.length < 3) {
        return { status: 'empty', count: records.length, hint: 'too few indexed vectors to project — run reindex first' };
      }
      // The sharded atlas (ADR-0082): coords split across hash-bucketed shard
      // facts; the manifest (basis/norm/meta, stable ~40KB) writes LAST so a
      // reader never sees a sharded manifest whose shards aren't there yet.
      const { manifest, shards } = projectionArtifacts(records.map((r) => r.vector), records.map((r) => r.key), dim, new Date().toISOString());
      await Promise.all(shards.map((s, i) =>
        state.put({ scope, key: layoutShardKey(i), value: s, via: 'project', type: 'graph-layout-shard' }, ctx.identity)));
      await state.put({ scope, key: LAYOUT_KEY, value: manifest, via: 'project', type: 'graph-layout' }, ctx.identity);
      ctx.logger.info('semantic projection written', { scope, count: manifest.count, method: manifest.method, shards: manifest.shards });
      return { status: 'ok', count: manifest.count, method: manifest.method, key: LAYOUT_KEY };
    },

    async pruneSimilar(input, ctx) {
      const scope = requireUser(ctx.identity);
      // Vector-free, synchronous edge hygiene (ADR-0031/0032): delete inferred
      // `similarTo` edges whose endpoints an authored edge already connects. A real
      // link a person/grant asserted makes the machine's kinship hint redundant — as
      // structure (it surfaces twice in neighbors/$graph) and as a salience signal
      // (centrality would double-count the same relationship). The live indexer +
      // reindex now skip these on create; this is the one-time backfill.
      if (!hasScope(ctx.identity, 'workspace:admin') && !hasScope(ctx.identity, 'platform:*')) {
        throw new ServiceAuthError('pruneSimilar requires workspace:admin');
      }
      const { store } = build(ctx);
      if (!store) return { status: 'unconfigured', scanned: 0, pruned: 0, remaining: 0 };
      const existing = await store.listEdges(scope);
      const authored = authoredPairs(existing);
      const redundant = existing.filter(
        (e) =>
          e.rel === SIMILAR_REL &&
          e.writer === SIMILAR_WRITER &&
          authored.has(pairKey(e.from, e.to)),
      );
      const cap = input?.max && input.max > 0 ? input.max : redundant.length;
      const toDelete = redundant.slice(0, cap);
      for (const e of toDelete) await store.deleteEdge(scope, e.from, e.rel, e.to);
      ctx.logger.info('pruneSimilar complete', { scope, scanned: redundant.length, pruned: toDelete.length });
      return { status: 'pruned', scanned: redundant.length, pruned: toDelete.length, remaining: redundant.length - toDelete.length };
    },

    async suggestions(input, ctx) {
      const scope = requireUser(ctx.identity);
      // ADR-0032: the inferred `similarTo` edges ARE the suggestions — list them as
      // ratification candidates (deduped to unordered pairs, ranked by cosine), enriched
      // with each endpoint's type + label so a human/grant can judge the connection. The
      // slice's records are read once to type/label every candidate and to filter out
      // high-volume runtime/system facts (transcripts, agent-runs, cells, `_` plumbing)
      // that cluster by format rather than meaning — unless `includeRuntime`.
      const { store } = build(ctx);
      if (!store) return { suggestions: [], vocab: RATIFY_LINK_TYPES, total: 0 };
      const limit = input?.limit && input.limit > 0 ? input.limit : 25;
      const [edges, records] = await Promise.all([store.listEdges(scope), store.list(scope)]);
      const typeByKey = new Map(records.map((r) => [r.key, r.type]));
      const labelByKey = new Map(records.map((r) => [r.key, labelForRecord(r.key, r.value)]));
      const versionByKey = new Map(records.map((r) => [r.key, r.version]));
      const noiseTypes = noiseTypesFor(records); // slice-declared over the floor
      const isNoise = (k: string): boolean =>
        k.startsWith('_') || noiseTypes.has(typeByKey.get(k) ?? '');
      let candidates = suggestionCandidates(edges); // already score-desc
      if (!input?.includeRuntime) candidates = candidates.filter((c) => !isNoise(c.from) && !isNoise(c.to));
      // Work leases (ADR-0086 Inc 3): a pair a participant currently holds under
      // `lease/suggestion/<pairHash>` is IN-FLIGHT — annotate it so parallel
      // judges skip it instead of double-adjudicating (the wave-2 CI race).
      // Leases are ordinary records in the list we already loaded; a lapsed
      // timer reads as released.
      const nowMs = Date.now();
      const leaseByHash = new Map<string, { holder: string | null; until: string | null }>();
      for (const r of records) {
        if (!r.key.startsWith('lease/suggestion/') || r.superseded || !isTimerLive(r, nowMs)) continue;
        leaseByHash.set(r.key.slice('lease/suggestion/'.length), {
          holder: (r.value as { holder?: string } | null)?.holder ?? r.as ?? null,
          until: r.timerExpiresAt,
        });
      }
      // Degeneracy flag (membrane wave 1, F5): a pair whose endpoints share a
      // CONTENT HASH is byte-identical text — boilerplate headings, decompose
      // copies — where ~1.0 cosine is textual identity, not a relationship. The
      // queue head is systematically these; every judge that met them declined
      // to ratify and had to re-derive why. Say what the score implies: flag
      // them `identical` (a prune/dedupe candidate, not a ratification one).
      const suggestions: SuggestionEntry[] = candidates.slice(0, limit).map((c) => {
        const identical = !!versionByKey.get(c.from) && versionByKey.get(c.from) === versionByKey.get(c.to);
        // The pair's stable id — what `lease({domain:"suggestion", item})` and
        // the `checked/<hash>` adjudication markers key on. Returned so a judge
        // can lease a pair WITHOUT re-deriving the server's hash (ADR-0086).
        const pairHash = contentHash(pairKey(c.from, c.to));
        const lease = leaseByHash.get(pairHash);
        return {
          ...c,
          pairHash,
          fromType: typeByKey.get(c.from) ?? null,
          fromLabel: labelByKey.get(c.from) ?? c.from,
          toType: typeByKey.get(c.to) ?? null,
          toLabel: labelByKey.get(c.to) ?? c.to,
          ...(identical ? { identical: true } : {}),
          ...(lease ? { leasedBy: lease.holder, leasedUntil: lease.until } : {}),
        };
      });
      const flagged = suggestions.filter((s) => s.identical).length;
      return {
        suggestions,
        vocab: RATIFY_LINK_TYPES,
        total: candidates.length,
        ...(flagged
          ? { hint: `${flagged} of ${suggestions.length} candidates are byte-identical pairs (identical:true) — dedupe/prune material, not connections to ratify.` }
          : {}),
      };
    },

    // ADR-0072 (C7) Stage A: the contradiction-candidate read. Semantic debt, as a
    // derived read — semantically-near pairs (the inferred `similarTo` kinship) that no
    // authored edge connects, sharing a type or tag, not yet adjudicated. Stage B (any
    // agent — a models.agent pass, the consolidation organ, a person) reads this,
    // judges each pair, and writes the verdict back with EXISTING verbs:
    //   contradict → remember `contested/<hash>` {a,b,why} + link a --contradicts--> b
    //   duplicate  → a supersede candidate · subsumes → propose a refines edge
    //   ALWAYS     → remember `checked/<hash>` {a,b,verdict,versions} — the idempotence
    //                marker; the pair only re-surfaces when either fact's version drifts.
    async contested(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { store } = build(ctx);
      if (!store) return { candidates: [], total: 0, checked: 0, hint: CONTESTED_HINT };
      const limit = Math.min(Math.max(input?.limit ?? 10, 1), 50);
      const minScore = input?.minScore ?? 0.5;
      const [edges, records] = await Promise.all([store.listEdges(scope), store.list(scope)]);
      const byKey = new Map(records.map((r) => [r.key, r]));
      const noiseTypes = noiseTypesFor(records); // slice-declared over the floor
      const isNoise = (k: string): boolean =>
        k.startsWith('_') || noiseTypes.has(byKey.get(k)?.type ?? '');
      // A current adjudication: a live `checked/<hash>` marker whose stored versions
      // still match both facts — version drift re-opens the pair (ADR-0066 hashes).
      const markers = new Map<string, { a?: string; b?: string; versions?: Record<string, string> }>();
      for (const r of records) {
        if (r.key.startsWith('checked/') && !r.superseded) {
          markers.set(r.key.slice('checked/'.length), (r.value ?? {}) as { versions?: Record<string, string> });
        }
      }
      const versionOf = (k: string): string => {
        const r = byKey.get(k);
        return r?.version || contentHash(r?.value ?? null);
      };
      const authored = authoredPairs(edges);
      let checkedCount = 0;
      const out: ContestedCandidate[] = [];
      for (const c of suggestionCandidates(edges)) {
        const a = byKey.get(c.from);
        const b = byKey.get(c.to);
        if (!a || !b || a.superseded || b.superseded) continue;
        if ((c.score ?? 0) < minScore) continue;
        if (!input?.includeRuntime && (isNoise(c.from) || isNoise(c.to))) continue;
        // "No authored edge" is Stage A's precondition — normally guaranteed at
        // similarTo write time, but assert it here so a hand-written edge can't slip a
        // connected pair back into adjudication.
        if (authored.has(pairKey(c.from, c.to))) continue;
        const sharedTags = a.tags.filter((t) => b.tags.includes(t));
        const sameType = !!a.type && a.type === b.type;
        if (!sameType && sharedTags.length === 0) continue; // divergence needs common ground
        const hash = contentHash(pairKey(c.from, c.to));
        const [vA, vB] = [versionOf(c.from), versionOf(c.to)];
        const marker = markers.get(hash);
        if (marker?.versions && marker.versions[c.from] === vA && marker.versions[c.to] === vB) {
          checkedCount++;
          continue; // adjudicated and unchanged since — idempotent skip
        }
        out.push({
          a: c.from,
          b: c.to,
          score: c.score,
          aLabel: labelForRecord(c.from, a.value),
          bLabel: labelForRecord(c.to, b.value),
          aType: a.type,
          bType: b.type,
          sharedTags,
          hash,
          versions: { a: vA, b: vB },
        });
      }
      return { candidates: out.slice(0, limit), total: out.length, checked: checkedCount, hint: CONTESTED_HINT };
    },

    async ratify(input, ctx) {
      const scope = requireUser(ctx.identity);
      if (!input?.from || !input?.to || !input?.rel) throw new Error('from, to, and rel are required');
      if (input.from === input.to) throw new Error('cannot ratify a self-link');
      // ADR-0032 Option C: graduate a machine suggestion into curated structure. The
      // authored edge is written through the normal `link` path (writer = you, full
      // weight), then the now-redundant inferred `similarTo` between the pair is dropped
      // (dedup-on-create would prune it on the next reindex anyway; this is immediate).
      const { state, store } = build(ctx);
      const edge = await state.link(scope, input.from, input.rel, input.to, input.strength ?? null, ctx.identity);
      let dropped = 0;
      if (store) dropped = await dropSimilarPair(store, scope, input.from, input.to, await store.listEdges(scope));
      ctx.logger.info('suggestion ratified', { scope, from: input.from, rel: input.rel, to: input.to, dropped });
      return { edge, dropped, ratified: true };
    },
  };
}

/** The platform principal that the async reindex writes under (status fact + edges). */
const REINDEX_IDENTITY: Identity = { user: 'platform/reindex', scopes: [] };
const REINDEX_CHUNK = Number(process.env.VECTOR_REINDEX_CHUNK ?? 50);

interface ReindexParams {
  type?: string;
  prefix?: string;
  max?: number;
  phase: 'embed' | 'edges';
  cursor?: string;
  indexed: number;
  skipped: number;
  edges: number;
}

/** Process ONE bounded page of a reindex (ADR-0030/0031), returning whether the whole
 *  job is done and the next continuation params. Two phases: `embed` fills the vector
 *  index page by page; once exhausted it flips to `edges`, which (re-embedding each
 *  fact only to get its query vector — the index is already full) wires `similarTo`
 *  edges against the complete index. Each call stays well under the 60s Lambda. */
async function reindexChunk(deps: WorkspaceDeps, scope: string, p: ReindexParams): Promise<{ done: boolean; next: ReindexParams }> {
  const { state, vectors, store } = deps;
  if (!vectors) return { done: true, next: p };
  const dim = vectors.embedder.dimension;
  const index = indexForScope(scope, dim);
  let { indexed, skipped, edges } = p;

  const page = await state.query(scope, { type: p.type, prefix: p.prefix, limit: REINDEX_CHUNK, cursor: p.cursor }, REINDEX_IDENTITY);
  const embeddable = page.entries
    .map((e) => ({ key: e.key, text: embeddableText(e.key, e.value), type: e._meta.type, tags: e._meta.tags }))
    .filter((e): e is { key: string; text: string; type: string | null; tags: string[] } => !!e.text);

  if (p.phase === 'embed') {
    await vectors.store.ensureIndex(index, { dimension: dim });
    skipped += page.entries.length - embeddable.length;
    if (embeddable.length) {
      const vecs = await vectors.embedder.embed(embeddable.map((e) => e.text));
      await vectors.store.put(index, embeddable.map((e, i) => ({ key: e.key, vector: vecs[i], metadata: metadataForFact({ type: e.type ?? undefined, tags: e.tags, superseded: false }) })));
      indexed += embeddable.length;
    }
    const capped = p.max !== undefined && indexed + skipped >= p.max;
    if (page.nextCursor && !capped) return { done: false, next: { ...p, cursor: page.nextCursor, indexed, skipped, edges } };
    // Embed complete → start the edge phase from the top (the full index is now present).
    return { done: false, next: { ...p, phase: 'edges', cursor: undefined, indexed, skipped, edges } };
  }

  // phase === 'edges'
  const sim = similarConfig();
  if (sim.enabled && store && embeddable.length) {
    const now = new Date().toISOString();
    const existing = await store.listEdges(scope);
    const vecs = await vectors.embedder.embed(embeddable.map((e) => e.text)); // re-embed only to get the query vector (index already full)
    for (let i = 0; i < embeddable.length; i++) {
      const matches = await vectors.store.query(index, vecs[i], { topK: sim.k + 1 });
      const neighbors = selectNeighbors(matches, embeddable[i].key, { k: sim.k, minScore: sim.minScore });
      await refreshSimilarEdges(store, scope, embeddable[i].key, neighbors, sim.strength, existing, now);
      edges += neighbors.length;
    }
  }
  if (page.nextCursor) return { done: false, next: { ...p, cursor: page.nextCursor, indexed, skipped, edges } };
  return { done: true, next: { ...p, cursor: undefined, indexed, skipped, edges } };
}

/** The async reindex worker (`workspace.reindex.requested`): runs one chunk, writes the
 *  pollable `_reindex/<scope>` status, and either chains the next continuation event or
 *  marks the job done. A chunk failure throws → EventBridge retries it (idempotent:
 *  re-embed/re-put + refreshSimilarEdges reconcile). */
export function createReindexHandler(build: DepsBuilder): EventBridgeHandler {
  return async (detail, ctx, meta) => {
    if (meta.source !== 'workspace') {
      ctx.logger.warn('workspace.reindex.requested from unexpected source refused', { source: meta.source });
      return;
    }
    const scope = typeof detail.scope === 'string' ? detail.scope : '';
    if (!scope) return;
    const deps = build(ctx);
    const statusKey = `_reindex/${scope}`;
    const params: ReindexParams = {
      type: typeof detail.type === 'string' ? detail.type : undefined,
      prefix: typeof detail.prefix === 'string' ? detail.prefix : undefined,
      max: typeof detail.max === 'number' ? detail.max : undefined,
      phase: detail.phase === 'edges' ? 'edges' : 'embed',
      cursor: typeof detail.cursor === 'string' ? detail.cursor : undefined,
      indexed: Number(detail.indexed ?? 0),
      skipped: Number(detail.skipped ?? 0),
      edges: Number(detail.edges ?? 0),
    };
    const index = deps.vectors ? indexForScope(scope, deps.vectors.embedder.dimension) : '';
    try {
      const { done, next } = await reindexChunk(deps, scope, params);
      const base = { phase: next.phase, indexed: next.indexed, skipped: next.skipped, edges: next.edges, index };
      if (done) {
        await deps.state.put({ scope, key: statusKey, value: { status: 'done', ...base, finishedAt: new Date().toISOString() }, via: 'reindex', type: 'reindex-status' }, REINDEX_IDENTITY);
        ctx.logger.info('reindex complete', { scope, ...base });
      } else {
        await deps.state.put({ scope, key: statusKey, value: { status: 'running', ...base, cursor: next.cursor, updatedAt: new Date().toISOString() }, via: 'reindex', type: 'reindex-status' }, REINDEX_IDENTITY);
        await ctx.events.emit('workspace.reindex.requested', { scope, type: next.type, prefix: next.prefix, max: next.max, phase: next.phase, cursor: next.cursor, indexed: next.indexed, skipped: next.skipped, edges: next.edges });
      }
    } catch (err) {
      ctx.logger.error('reindex chunk failed (EventBridge will retry)', { scope, phase: params.phase, error: (err as Error).message });
      throw err;
    }
  };
}

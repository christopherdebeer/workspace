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
  indexableText,
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
  // The $types home for the same declaration (wave-5, cross-vendor session): a
  // type-decl `_types/<name>` carrying {operational: true} (or {embed: false})
  // marks a slice's own coordination vocabulary — its leases, adjudication
  // markers, presence rows — as machinery, never a suggestion/contested
  // candidate. The platform ships the mechanism; each slice binds its own
  // names (the same trust seam $types already carries for render/edit
  // affordances). Declared operational wins over `admitTypes` — a type cannot
  // be simultaneously machinery and a candidate.
  for (const r of records) {
    if (r.superseded || !r.key.startsWith('_types/')) continue;
    const v = r.value as { operational?: unknown; embed?: unknown } | null;
    if (v?.operational === true || v?.embed === false) out.add(r.key.slice('_types/'.length));
  }
  return out;
}

/** How an adjudicator writes a contested verdict back — existing verbs only (ADR-0072). */
const CONTESTED_HINT =
  'Adjudicate each pair (verdict: contradict | subsumes | duplicate | independent). ' +
  'contradict → remember `contested/<hash>` {a, b, why, verdict} + link a --contradicts--> b. ' +
  'duplicate → consider supersede; subsumes → consider a refines edge. ' +
  'ALWAYS remember `checked/<hash>` {a, b, verdict, versions} (echo this candidate’s `versions`) — ' +
  'the pair then stays out of this read until either fact’s version drifts. ' +
  'Adjudicating in parallel? lease({domain:"suggestion", item:<hash>}) BEFORE judging (NB the ' +
  'domain is "suggestion", keyed on this candidate’s `hash`) — a peer’s live lease then shows on ' +
  '`suggestions` so nobody double-judges (ADR-0086).';

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
  /** Skip this many candidates first (paging — W3e: `query` honors it, so this does too). */
  offset?: number;
  /** Include high-volume runtime/machine facts (transcripts, agent-runs, cells, …) that
   *  are filtered out by default as format-clustered noise. */
  includeRuntime?: boolean;
  /** Only pairs worth a judge's attention: drop byte-identical pairs, mechanical
   *  degeneracies (same-source siblings/containment), and pairs another participant
   *  currently holds a lease on (W3b — every judge that met the degenerate head
   *  declined it and had to re-derive why). */
  genuineOnly?: boolean;
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
  /** The pair is mechanically derived from one source (W3b): `same-source` =
   *  fragments of the same document/run (sibling blocks, snapshot vs latest);
   *  `contains` = one endpoint is the other's parent/source (a block vs its own
   *  doc, a decompose copy vs the original). Near-1.0 cosine by construction —
   *  structure the graph already knows, not a connection to ratify. */
  degenerate?: 'same-source' | 'contains';
  /** A participant currently holds `lease/suggestion/<pairHash>` on this pair
   *  (ADR-0086 Inc 3) — it is in-flight; skip it rather than double-adjudicate. */
  leasedBy?: string | null;
  leasedUntil?: string | null;
}
/** A key reduced to the SOURCE it derives from (W3b): lowercase, colon
 *  namespace off (`doc-block:docs/x/4` → `docs/x/4`), file extension off
 *  (`file/docs/x.md` → `file/docs/x`), trailing numeric fragment segments off
 *  (`docs/x/4` → `docs/x`). Conservative on `/`-namespaces (only extensions and
 *  numeric tails are stripped) so `goal/123` and `note/123` stay distinct. */
function keyBase(key: string): string {
  return key
    .toLowerCase()
    .replace(/^[a-z][\w.-]*:/, '')
    .replace(/\.[a-z0-9]{1,8}$/, '')
    .replace(/(\/\d+)+$/, '');
}

/** A base's namespaced CORE: the path after its first segment, only when what
 *  remains is still multi-segment (`file/docs/x/y` → `docs/x/y`; `essay/alpha`
 *  → null — one bare word is too weak a signal to match across namespaces). */
function coreOf(base: string): string | null {
  const i = base.indexOf('/');
  if (i < 0) return null;
  const rest = base.slice(i + 1);
  return rest.includes('/') ? rest : null;
}

/** The mechanical degeneracy class of a pair, if any (W3b, membrane waves 1–3):
 *  two facts derived from the same source cluster at ~1.0 cosine by
 *  construction — sibling blocks of one doc (`same-source`), a block vs its own
 *  parent doc/file or a decompose/snapshot copy vs its original (`contains`,
 *  including across namespaces: `decompose-run/<path>/40` vs `file/<path>.md`).
 *  Every judge that met these declined to ratify and had to re-derive why;
 *  say what the key structure implies instead. */
function degeneracyOf(from: string, to: string): 'same-source' | 'contains' | undefined {
  const a = keyBase(from);
  const b = keyBase(to);
  if (!a || !b) return undefined;
  if (a === b) return 'same-source';
  // Parent/source containment — path-prefix either way, tolerating a leading
  // namespace segment on one side (`file/docs/x` vs `docs/x`).
  if (a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) return 'contains';
  if (a.endsWith(`/${b}`) || b.endsWith(`/${a}`)) return 'contains';
  // Cross-namespace: both sides carry their own namespace segment over the
  // same source path (`decompose-run/docs/x/40` vs `file/docs/x.md`).
  const ca = coreOf(a);
  const cb = coreOf(b);
  if (ca && (ca === b || b.endsWith(`/${ca}`) || ca.endsWith(`/${b}`))) return 'contains';
  if (cb && (cb === a || a.endsWith(`/${cb}`) || cb.endsWith(`/${a}`))) return 'contains';
  if (ca && cb && ca === cb) return 'contains';
  return undefined;
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
  /** Pairs skipped as mechanically degenerate (same-source / containment — they
   *  cannot contradict; W4c). A judge no longer has to lease + inspect them. */
  degenerate: number;
  /** Pairs skipped because an endpoint is ephemeral machinery: a delete-timer
   *  fact (lease, presence) — live or lapsed-awaiting-TTL. Coordination
   *  exhaust, never a contradiction candidate (wave-5). */
  ephemeral: number;
  /** How to write a verdict back (existing verbs only — no new write surface). */
  hint: string;
}

/** The search/vectors command handlers (ADR-0044 Inc 5). LAYOUT_KEY re-exported
 *  for existing importers — it now lives in platform/runtime/projection.ts so
 *  the live vector-indexer can read/patch it too. */
export { LAYOUT_KEY };

export function createSearchCommands(build: DepsBuilder): Pick<WorkspaceCommands, 'reindex' | 'project' | 'pruneSimilar' | 'suggestions' | 'ratify' | 'contested'> {
  return {


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
      // A pair an AUTHORED edge already connects is not a suggestion — it is
      // structure (wave-4 live finding: a judge's `duplicates` edge written via
      // plain `link` left the inferred similarTo listed, so the ratified pair
      // kept resurfacing). Same precondition `contested` enforces; also makes
      // the queue self-heal when `ratify`'s drop is skipped or raced.
      const authored = authoredPairs(edges);
      candidates = candidates.filter((c) => !authored.has(pairKey(c.from, c.to)));
      if (!input?.includeRuntime) candidates = candidates.filter((c) => !isNoise(c.from) && !isNoise(c.to));
      // Ephemeral machinery (wave-5, cross-vendor finding): a fact carrying a
      // delete-effect timer — a lease, a presence row — is coordination exhaust
      // whatever its type is named; it can never be a durable connection
      // candidate. And once the timer lapses the RAW ROW lingers until DDB TTL
      // fires (expiry + 24h grace), so timer-liveness must be re-checked here
      // rather than trusted to the store: timer-deleted `lease/suggestion/*`
      // rows led the live contested read at 0.99 cosine for the whole lag
      // window. A missing endpoint (dangling similarTo edge) drops the same way.
      const nowMs = Date.now();
      const recByKey = new Map(records.map((r) => [r.key, r]));
      const isEphemeral = (k: string): boolean => {
        const r = recByKey.get(k);
        return !r || r.timerEffect === 'delete' || !isTimerLive(r, nowMs);
      };
      candidates = candidates.filter((c) => !isEphemeral(c.from) && !isEphemeral(c.to));
      // Work leases (ADR-0086 Inc 3): a pair a participant currently holds under
      // `lease/suggestion/<pairHash>` is IN-FLIGHT — annotate it so parallel
      // judges skip it instead of double-adjudicating (the wave-2 CI race).
      // Leases are ordinary records in the list we already loaded; a lapsed
      // timer reads as released.
      // Accept BOTH the documented domain (`suggestion`) and the intuitive one a
      // judge naturally reaches for (`pair`) — the wave-4 consolidate driver leased
      // its adjudication pair under `lease/pair/<hash>` (domain "pair"), which the
      // suggestion-only scan didn't see, so a parallel judge would have missed it
      // (W4b). The keys are hash-suffixed identically; honor either prefix.
      const leaseByHash = new Map<string, { holder: string | null; until: string | null }>();
      for (const r of records) {
        if (r.superseded || !isTimerLive(r, nowMs)) continue;
        const prefix = ['lease/suggestion/', 'lease/pair/'].find((p) => r.key.startsWith(p));
        if (!prefix) continue;
        leaseByHash.set(r.key.slice(prefix.length), {
          holder: (r.value as { holder?: string } | null)?.holder ?? r.as ?? null,
          until: r.timerExpiresAt,
        });
      }
      // Degeneracy flags (membrane waves 1–3, F5 + W3b): a pair whose endpoints
      // share a CONTENT HASH is byte-identical text; a pair mechanically derived
      // from one source (sibling blocks, block vs own doc, snapshot vs latest)
      // clusters at ~1.0 cosine by construction. Neither is a relationship. The
      // queue head is systematically these; every judge that met them declined
      // to ratify and had to re-derive why. Say what the score implies — flag
      // `identical` / `degenerate`, and let `genuineOnly` skip them wholesale.
      const enrich = (c: SuggestionCandidate): SuggestionEntry => {
        const identical = !!versionByKey.get(c.from) && versionByKey.get(c.from) === versionByKey.get(c.to);
        const degenerate = degeneracyOf(c.from, c.to);
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
          ...(degenerate ? { degenerate } : {}),
          ...(lease ? { leasedBy: lease.holder, leasedUntil: lease.until } : {}),
        };
      };
      // `genuineOnly` (W3b): only pairs worth a judge's attention — not identical,
      // not mechanically degenerate, not currently leased by another participant.
      let enriched = candidates.map(enrich);
      if (input?.genuineOnly) enriched = enriched.filter((s) => !s.identical && !s.degenerate && !s.leasedBy);
      // SWARM-E (wave-5, unanimous across both CI probe drivers): byte-identical /
      // same-source pairs score ~0.9999 and so LED every default page — a judge met
      // the degenerate head first and had to re-call with genuineOnly. Sink flagged
      // pairs (identical / degenerate / leased-by-a-peer) below genuine ones. The
      // SET is unchanged and `genuineOnly` still drops them entirely; only the
      // order changes, and V8's stable sort preserves score-desc WITHIN each group.
      const flaggedRank = (s: SuggestionEntry): number => (s.identical || s.degenerate || s.leasedBy ? 1 : 0);
      enriched = [...enriched].sort((a, b) => flaggedRank(a) - flaggedRank(b));
      // W3e: `offset` pages the ranked list (query grew this in wave 2; the same
      // reach here was silently ignored — membrane principle: honor or reject).
      const offset = typeof input?.offset === 'number' && input.offset > 0 ? input.offset : 0;
      const suggestions = enriched.slice(offset, offset + limit);
      const flagged = suggestions.filter((s) => s.identical || s.degenerate).length;
      return {
        suggestions,
        vocab: RATIFY_LINK_TYPES,
        total: enriched.length,
        ...(flagged
          ? { hint: `${flagged} of ${suggestions.length} candidates are byte-identical or same-source pairs (identical/degenerate) — dedupe/prune material, not connections to ratify. Pass {genuineOnly:true} to skip them.` }
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
      if (!store) return { candidates: [], total: 0, checked: 0, degenerate: 0, ephemeral: 0, hint: CONTESTED_HINT };
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
      const nowMs = Date.now();
      let checkedCount = 0;
      let degenerateCount = 0;
      let ephemeralCount = 0;
      const out: ContestedCandidate[] = [];
      for (const c of suggestionCandidates(edges)) {
        const a = byKey.get(c.from);
        const b = byKey.get(c.to);
        if (!a || !b || a.superseded || b.superseded) continue;
        // Ephemeral machinery (wave-5, cross-vendor finding): a delete-timer
        // fact — a lease, a presence row — is coordination exhaust whatever its
        // type is named, and once its timer lapses the RAW ROW lingers until
        // DDB TTL fires (expiry + 24h grace). Timer-liveness is a READ-time
        // contract; re-check it here rather than trusting the store list:
        // timer-deleted `lease/suggestion/*` rows led this read at 0.99 cosine
        // for the whole lag window, crowding out every genuine candidate.
        if (
          a.timerEffect === 'delete' || b.timerEffect === 'delete' ||
          !isTimerLive(a, nowMs) || !isTimerLive(b, nowMs)
        ) {
          ephemeralCount++;
          continue;
        }
        if ((c.score ?? 0) < minScore) continue;
        if (!input?.includeRuntime && (isNoise(c.from) || isNoise(c.to))) continue;
        // "No authored edge" is Stage A's precondition — normally guaranteed at
        // similarTo write time, but assert it here so a hand-written edge can't slip a
        // connected pair back into adjudication.
        if (authored.has(pairKey(c.from, c.to))) continue;
        // Mechanical degeneracy (W3b/W4c): a same-source or containment pair
        // (sibling doc-blocks, a block vs its own parent, a decompose/snapshot
        // copy) shares a type by CONSTRUCTION and scores ~1.0 by construction —
        // it cannot *contradict* itself, so it is never a Stage-A candidate. The
        // wave-4 consolidate driver read `contested`, met exactly such a pair
        // (the ADR-0068/0069 doc-block containment), and had to lease + inspect
        // it to learn what the key structure already said. Skip it here, counted.
        if (degeneracyOf(c.from, c.to)) {
          degenerateCount++;
          continue;
        }
        // Byte-identical CONTENT (same content-hash version) is degenerate even
        // when the keys are unrelated (W4l — the wave-4 consolidate driver
        // adjudicated 8 such pairs, all `### Shape` / `## Phases` boilerplate
        // shared across DIFFERENT docs, every one `independent`: identical text
        // cannot contradict). The key-structural `degeneracyOf` misses these
        // cross-document twins; the version equality catches them.
        if (versionOf(c.from) && versionOf(c.from) === versionOf(c.to)) {
          degenerateCount++;
          continue;
        }
        const sharedTags = a.tags.filter((t) => b.tags.includes(t));
        const sameType = !!a.type && a.type === b.type;
        if (!sameType && sharedTags.length === 0) continue; // divergence needs common ground
        const hash = contentHash(pairKey(c.from, c.to));
        const [vA, vB] = [versionOf(c.from), versionOf(c.to)];
        const marker = markers.get(hash);
        // The marker echoes the candidate's `versions` object, which is keyed
        // POSITIONALLY `{a, b}` — not by fact key. The prior check indexed
        // `marker.versions[c.from]` / `[c.to]` (by fact key), which is always
        // undefined, so NO marker ever suppressed a pair: `contested` reported
        // `checked:0` even with valid, version-matched markers present (wave-5
        // W5-1, reproduced end-to-end). Compare the stored version VALUES to the
        // pair's current versions, order-independently — the marker is already
        // pair-scoped by `hash`, and byte-identical pairs (vA === vB) are skipped
        // above, so set membership is exact.
        if (marker?.versions) {
          const stored = new Set(Object.values(marker.versions));
          if (stored.has(vA) && stored.has(vB)) {
            checkedCount++;
            continue; // adjudicated and unchanged since — idempotent skip
          }
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
      return { candidates: out.slice(0, limit), total: out.length, checked: checkedCount, degenerate: degenerateCount, ephemeral: ephemeralCount, hint: CONTESTED_HINT };
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
  // Membership via the ONE shared rule (`indexableText`) — the same gate the
  // stream indexer applies. `query` already hides superseded and timer-DEAD
  // facts, but a LIVE (unexpired) delete-timer lease passes it; gating only on
  // "has text" re-embedded those ephemera on every full reindex, leaking them
  // into search's candidates and recall's relevance until their TTL fired.
  const embeddable = page.entries
    .map((e) => ({ key: e.key, text: indexableText({ key: e.key, value: e.value, timerEffect: e._meta.timer?.effect }), type: e._meta.type, tags: e._meta.tags }))
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

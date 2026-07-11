/**
 * Workspace command group (ADR-0044 Inc 5): read/query/recall projections +
 * attention/changes/tending — recall, peek, query, changes, attention, tend,
 * with the recall-overview builders.
 */
import {
  requireUser,
  indexForScope,
  INTENT_PRESET,
  type ChangesResult,
  type ChangesScope,
  type Entry,
  type ReadResult,
  type QueryResult,
  type SalienceLens,
  type SalienceOptions,
} from '../../platform/runtime';
import { shapeEntry, shapeEntryList, shapeEntryMap, type ReadShape } from './shape';
import { applicableGrants, grantCovers, WHOLE_SLICE } from './grants';
import {
  type DepsBuilder,
  type WorkspaceDeps,
  typeDeclsFor,
  typeRulesFor,
  affordancesForTypes,
  typesOf,
  type TypeAffordance,
  enforceTypeRead,
} from './shared';
import { runTend } from './event-handlers';
import type { WorkspaceCommands } from './handlers';

/** Candidate-set size for a stated intent (ADR-0051): the vector top-K IS the
 *  bounded relevance pool; keys outside it score relevance 0. */
const INTENT_TOP_K = 200;

/**
 * Per-key relevance to a stated intent (ADR-0051): embed the text once, take the
 * scope's vector index top-K as `{ key: cosine }`. `undefined` when no semantic
 * backend is configured — the read proceeds unweighted (the index is a candidate
 * generator, never an authority; ADR-0030 Decision 1 unchanged).
 */
async function relevanceFor(
  vectors: WorkspaceDeps['vectors'],
  scope: string,
  text: string,
): Promise<Record<string, number> | undefined> {
  if (!vectors) return undefined;
  const [queryVector] = await vectors.embedder.embed([text]);
  const matches = await vectors.store
    .query(indexForScope(scope, vectors.embedder.dimension), queryVector, { topK: INTENT_TOP_K })
    .catch(() => []);
  const rel: Record<string, number> = {};
  for (const m of matches) rel[m.key] = m.score;
  return rel;
}

/** The effective per-call salience for a read that stated an intent: the intent
 *  preset (relevance leads) under any explicit caller override. */
function intentSalience(override?: Partial<SalienceOptions>): Partial<SalienceOptions> {
  return { ...INTENT_PRESET, ...override };
}

// ─── the recall digest (ADR-0050 move 4) ────────────────────────────
//
// A bare recall — the hottest call an agent makes — is served from a CACHE
// record when nothing in the scope changed since it was built. Realized as a
// seq-validated write-behind rather than a stream consumer: the digest stores
// the seq head it was computed at, and the read path compares it to the LIVE
// head — exact by construction (any write advances seq and invalidates), no
// new infrastructure, no eventual consistency. Written through the raw store
// (no seq advance, no trajectory, no touch), because a cache is not a fact.

/** Where a scope's recall digest lives. Excluded from recall's own content. */
const DIGEST_KEY = '_index/overview';
/** Recompute past this age even at the same seq — recency decay drifts band
 *  membership slowly; an hour bounds the drift. */
const DIGEST_MAX_AGE_MS = 60 * 60 * 1000;

interface DigestValue {
  seq: number;
  at: string;
  result: RecallOverview;
}

/** The cached overview when it is seq-exact and fresh, else `null` plus the
 *  live head (captured BEFORE the recompute, so a write racing the recompute
 *  can only make the stored digest conservatively stale, never wrongly fresh). */
async function readDigest(
  store: NonNullable<WorkspaceDeps['store']>,
  scope: string,
): Promise<{ cached: RecallOverview | null; head: number }> {
  const [rec, head] = await Promise.all([store.get(scope, DIGEST_KEY), store.currentSeq(scope)]);
  const v = rec?.value as DigestValue | undefined;
  const fresh =
    !!v && typeof v.seq === 'number' && !!v.result && v.seq === head && Date.now() - Date.parse(v.at) < DIGEST_MAX_AGE_MS;
  return { cached: fresh ? v.result : null, head };
}

/** Persist the freshly-computed overview as the scope's digest — best-effort
 *  (a cache write must never fail a read; an oversized digest just isn't cached). */
async function writeDigest(
  store: NonNullable<WorkspaceDeps['store']>,
  scope: string,
  head: number,
  result: RecallOverview,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const prev = await store.get(scope, DIGEST_KEY);
    await store.put({
      scope,
      key: DIGEST_KEY,
      value: { seq: head, at: now, result } satisfies DigestValue,
      revision: (prev?.revision ?? 0) + 1,
      seq: head,
      firstSeq: prev?.firstSeq ?? head,
      writer: 'platform/digest',
      via: 'recall:digest',
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      writers: ['platform/digest'],
      superseded: false,
      supersededBy: null,
      type: null,
      tags: [],
      timerExpiresAt: null,
      timerEffect: null,
    });
  } catch {
    /* not cached this time — the next bare recall recomputes */
  }
}

/** Attach the inline `types` affordance map to a single returned fact (`peek`),
 *  leaving a `null` (absent) fact untouched (ADR-0029 R1). */
function withAffordance(entry: Entry | null, decls: Record<string, Record<string, unknown>>): Entry | (Entry & { types: Record<string, TypeAffordance> }) | null {
  if (!entry) return entry;
  const types = affordancesForTypes([entry._meta.type], decls);
  return Object.keys(types).length ? { ...entry, types } : entry;
}

/** The leading segment of a fact key — the "namespace" for an overview breakdown
 *  (`kb/concept_x` → `kb`, `cell:abc` → `cell`, `tending/latest` → `tending`). */
function keyPrefix(key: string): string {
  const slash = key.indexOf('/');
  const colon = key.indexOf(':');
  const cut = [slash, colon].filter((i) => i >= 0).sort((a, b) => a - b)[0];
  return cut === undefined ? key : key.slice(0, cut);
}

export interface RecallOverview {
  /** A broad, succinct orientation over the assembled view (ADR-0033). */
  overview: {
    total: number;
    /** Facts merged in from other slices' grants (counted in `total`). */
    granted: number;
    bands: { focus: number; peripheral: number; elided: number };
    byType: Array<{ type: string | null; count: number }>;
    byPrefix: Array<{ prefix: string; count: number }>;
  };
  /** The top facts by salience, in full — the entry points worth reading now. */
  focus: Record<string, Entry>;
  /** How to dig deeper — this is progressive disclosure, not the whole view. */
  hints: string[];
  types?: Record<string, TypeAffordance>;
}

/** Cap on facts returned in full in an overview's `focus` block. */
const OVERVIEW_FOCUS = 12;

/**
 * Distil the assembled, scored view into a broad+succinct orientation (ADR-0033) —
 * the default for a bare `recall()` so a context-less agent gets counts + the top
 * facts + drill pointers, not a full dump it must parse. `merged` is the scored
 * entry map; `bands` are the shaping counts (reused so we don't re-tier).
 */
function buildOverview(
  merged: Record<string, Entry>,
  bands: { focus: number; peripheral: number; elided: number },
  granted: number,
  decls: Record<string, Record<string, unknown>>,
): RecallOverview {
  const entries = Object.entries(merged);
  const byType = new Map<string | null, number>();
  const byPrefix = new Map<string, number>();
  for (const [key, e] of entries) {
    byType.set(e._meta.type ?? null, (byType.get(e._meta.type ?? null) ?? 0) + 1);
    byPrefix.set(keyPrefix(key), (byPrefix.get(keyPrefix(key)) ?? 0) + 1);
  }
  const topN = <K,>(m: Map<K, number>, n: number): Array<{ count: number; k: K }> =>
    [...m.entries()].map(([k, count]) => ({ k, count })).sort((a, b) => b.count - a.count).slice(0, n);
  const focusEntries = entries
    .sort((a, b) => (b[1]._meta.score ?? 0) - (a[1]._meta.score ?? 0))
    .slice(0, OVERVIEW_FOCUS);
  const focus: Record<string, Entry> = {};
  for (const [k, e] of focusEntries) focus[k] = e;
  const types = affordancesForTypes(typesOf(focus), decls);
  return {
    overview: {
      total: entries.length,
      granted,
      bands,
      byType: topN(byType, 15).map(({ k, count }) => ({ type: k, count })),
      byPrefix: topN(byPrefix, 12).map(({ k, count }) => ({ prefix: k, count })),
    },
    focus,
    hints: [
      'This is a succinct overview (the default). For the whole shaped view: recall({ view: "full" }).',
      'Drill by structure: query({ type | prefix | tag | contains }) — filtered + paged.',
      'Drill by meaning: search({ text }) — semantic candidates across your slice.',
      'One fact: peek({ key }); its links: neighbors({ key }); the graph: read("$graph").',
      'Connection candidates the index proposes: suggestions().',
    ],
    ...(Object.keys(types).length ? { types } : {}),
  };
}

export interface RecallInput {
  /**
   * Default (when bare): `'overview'` — a broad, succinct orientation (counts by
   * type/prefix, salience bands, the top focus facts, drill hints) instead of the
   * whole shaped view (ADR-0033). `'full'` returns every focus/peripheral fact with
   * elided stubs. Passing ANY shaping arg (elision/expand/lens/salience/explain)
   * implies `'full'` — so configured callers are unaffected; only the context-less
   * bare `recall()` gets the overview.
   */
  view?: 'overview' | 'full';
  /** Orient relative to a goal (ADR-0051): free text, embedded and matched by
   *  meaning. Relevance joins the salience blend (the intent preset leads with
   *  it), so the focus band, counts, and elision are all conditioned on what you
   *  are reading FOR. Without a semantic backend the read proceeds unweighted. */
  text?: string;
  elision?: 'auto' | 'none';
  expand?: string[];
  includeSuperseded?: boolean;
  /** Bias salience via a named lens — compiled (recent/connected/durable/
   *  active) or slice-declared (`_config/lenses`, ADR-0078). Unknown ⇒ ignored. */
  lens?: SalienceLens | (string & {});
  /** Precise per-call salience override (merges over the lens + defaults). */
  salience?: Partial<SalienceOptions>;
  /** Attach `_meta.explain` (signals · weights · contributions) per entry. */
  explain?: boolean;
  /** Entry tier for the FULL view (ADR-0048): `'card'` (default — values with
   *  long strings truncated, structure summarised), `'refs'` (no values), or
   *  `'full'` (whole values — the pre-ADR-0048 behavior). Keys named in
   *  `expand` always come back full. The overview ignores this. */
  shape?: ReadShape;
}
export interface PeekInput {
  key: string;
  /** Read-through: the slice owner to read from (requires a grant covering the key). */
  owner?: string;
}
export interface QueryInput {
  type?: string;
  tag?: string;
  prefix?: string;
  /** Rank by meaning as well as structure (ADR-0051): free text, embedded and
   *  matched semantically. Relevance joins the salience blend under the intent
   *  preset — `query({text})` alone is semantic search that still respects
   *  standing/attention; `query({type, text})` is the hybrid. Elision and
   *  ranking are both intent-conditioned. */
  text?: string;
  rankBy?: 'salience' | 'recency';
  /** Bias salience via a named lens — compiled (recent/connected/durable/
   *  active) or slice-declared (`_config/lenses`, ADR-0078). Unknown ⇒ ignored. */
  lens?: SalienceLens | (string & {});
  /** Precise per-call salience override (merges over the lens + defaults). */
  salience?: Partial<SalienceOptions>;
  limit?: number;
  /** Resume token from a previous page's `nextCursor`. */
  cursor?: string;
  includeSuperseded?: boolean;
  /** Find a fact by what's inside it: keep only facts whose key or value
   *  (stringified) contains this substring, case-insensitively. */
  contains?: string;
  /** Attach `_meta.explain` (signals · weights · contributions) per entry. */
  explain?: boolean;
  /** Entry tier (ADR-0048): `'refs'` (key + _meta essentials, no value),
   *  `'card'` (values truncated to presentable previews), `'full'` (default —
   *  whole values). Lists/graphs want card; only a body-renderer wants full. */
  shape?: ReadShape;
}

export interface ChangesInput {
  /** Events after this seq; `'head'` returns no events, just the current head to tail from. */
  sinceSeq?: number | 'head';
  limit?: number;
  /** The NEWEST n events (ascending) — the "recent activity" read. A bare
   *  `changes()` defaults to `last: 200` (ADR-0048) instead of the whole
   *  TTL-bounded trajectory; pass `sinceSeq` to tail forward instead. */
  last?: number;
  /** ADR-0055: slice the feed server-side — key `prefixes` (link/unlink also
   *  match on `to`, so edges INTO the slice count) and/or an `ops` whitelist.
   *  Filtering happens BEFORE windowing; the head `seq` stays global. */
  scope?: ChangesScope;
  /** ADR-0055 Inc 2: `'entries'` inlines the CURRENT entry (card-shaped) for
   *  each written/superseded key on the page — one response instead of a
   *  follow-up fetch per event. Touch-free: inlining is a projection read and
   *  never inflates salience. Absent/expired keys map to null. */
  include?: 'events' | 'entries';
}

/** `changes` result: the feed page, plus inline entries when `include:'entries'`. */
export interface ChangesWithEntries extends ChangesResult {
  /** Current card-shaped entry per written key; `_meta.superseded` is the
   *  tombstone marker, null = gone (expired or never visible). */
  entries?: Record<string, Entry | null>;
}

export interface AttentionInput {
  /** Age (ms) beyond which a live fact counts as stale. Default 14 days. */
  staleMs?: number;
  limit?: number;
  /** Also surface `_`-prefixed system namespaces (default false). */
  includeSystem?: boolean;
}

// ── ADR-0071 (C2): the one read, by candidate source ─────────────────────

export type ReadSource = 'slice' | 'store' | 'vector' | 'key' | 'changes';

/** One entry's periphery: a one-hop neighbour at the refs tier — key, rel,
 *  direction, neighbour type, derived flag. No values: the periphery is a hint,
 *  never a second read (ADR-0071, owner direction: perception has a periphery). */
export interface ContextRef {
  key: string;
  rel: string;
  dir: 'in' | 'out';
  type?: string | null;
  derived?: boolean;
}

export interface ComposedReadInput extends RecallInput, Omit<QueryInput, 'shape' | 'lens' | 'salience' | 'explain'>, Partial<Pick<PeekInput, 'key' | 'owner'>>, ChangesInput {
  /** Where candidates come from. Inferred when omitted: `key` → key; trajectory
   *  args → changes; structural filters → store; bare `text` → vector (semantic,
   *  salience-aware — the fixed form of the deprecated `search`); else slice. */
  source?: ReadSource;
  /** Secondary context (ADR-0071): `'refs'` folds each result's one-hop
   *  neighbourhood (elided tier — no values) into `_context`. Default `'none'`,
   *  so parity with the presets holds. Applies to key/store/vector reads and the
   *  slice FULL view; the overview and the changes feed skip it. */
  context?: 'none' | 'refs';
  /** Cap on `_context` refs per entry (default 8, max 24). */
  contextLimit?: number;
}

export type ComposedReadResult = ReadResult | RecallOverview | QueryResult | Entry | ChangesWithEntries | null;

// ADR-0078 resolved ADR-0074's open question 4: lens names are open vocabulary
// end-to-end. A posture's lens passes through verbatim — resolution happens in
// the state layer (compiled floor ← `_config/lenses` declared presets), and an
// unknown name is ignored there, never fatal.

/**
 * The PRINCIPAL layer of the defaults merge (ADR-0074, live):
 * `defaults ← config ← PRINCIPAL ← lens ← override`. A principal that has
 * ADOPTED a posture (`auth.adoptGoal` — a goal, a lens, a salience bias) gets
 * it applied to every composed read without per-call plumbing. The posture
 * rides the validated token into `ctx.identity`; this maps it to read terms.
 * `goal` stays unresolved here — a `goal/<id>` fact reference is resolved by
 * `read()` against the caller's own slice (title/detail → relevance text).
 * No posture ⇒ null ⇒ reads are byte-identical to before.
 */
export function principalPosture(
  identity: unknown,
): { goal?: string; lens?: SalienceLens; salience?: Partial<SalienceOptions> } | null {
  const posture = (identity as { posture?: { goal?: string; lens?: string; salience?: Record<string, number> } } | undefined)
    ?.posture;
  if (!posture) return null;
  const lens = typeof posture.lens === 'string' && posture.lens.trim() ? (posture.lens as SalienceLens) : undefined;
  const salience =
    posture.salience && Object.keys(posture.salience).length ? (posture.salience as Partial<SalienceOptions>) : undefined;
  const goal = typeof posture.goal === 'string' && posture.goal.trim() ? posture.goal.trim() : undefined;
  if (!goal && !lens && !salience) return null;
  return { ...(goal ? { goal } : {}), ...(lens ? { lens } : {}), ...(salience ? { salience } : {}) };
}

/** Derive relevance text from a referenced goal fact's value — the
 *  `@c15r/tasks` shape (`title`/`detail`) first, generic text fields after. */
export function goalTextOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const str = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x.trim() : undefined);
  const head = str(v.title) ?? str(v.name);
  const body = str(v.detail) ?? str(v.content) ?? str(v.text);
  return head && body ? `${head} — ${body}` : (head ?? body ?? null);
}

/** Infer the candidate source from the arguments (explicit `source` wins).
 *  An explicit `view` names the assembled slice view even when `text` is also
 *  present — `read({view:'full', text})` is a goal-conditioned recall
 *  (ADR-0051), not a vector search. */
export function inferSource(input?: ComposedReadInput): ReadSource {
  if (input?.source) return input.source;
  if (input?.key) return 'key';
  if (input?.sinceSeq !== undefined || input?.last !== undefined || input?.include !== undefined) return 'changes';
  if (input?.type || input?.tag || input?.prefix || input?.contains || input?.cursor || input?.rankBy) return 'store';
  if (input?.view) return 'slice';
  if (typeof input?.text === 'string' && input.text.trim()) return 'vector';
  return 'slice';
}

/** The read/query/recall + attention/changes/tending command handlers (ADR-0044
 *  Inc 5) + the composed `read` (ADR-0071). */
export function createReadCommands(build: DepsBuilder): Pick<WorkspaceCommands, 'recall' | 'peek' | 'query' | 'changes' | 'attention' | 'tend' | 'read'> {
  /** One shared periphery pass: index the Reference projection by endpoint once,
   *  then hand each result key its capped, refs-tier neighbourhood. */
  async function peripheryFor(ctx: Parameters<DepsBuilder>[0], keys: string[], cap: number): Promise<Record<string, ContextRef[]>> {
    const scope = requireUser(ctx.identity);
    const { state, store } = build(ctx);
    const g = await state.graph(scope, { typeRules: await typeRulesFor(ctx) });
    const typeByKey = store ? new Map((await store.list(scope)).map((r) => [r.key, r.type])) : new Map<string, string | null>();
    const byEnd = new Map<string, ContextRef[]>();
    const push = (k: string, ref: ContextRef) => {
      const arr = byEnd.get(k) ?? [];
      if (arr.length < cap) arr.push(ref);
      byEnd.set(k, arr);
    };
    for (const e of g.edges) {
      const derived = (e as { derived?: boolean }).derived ? { derived: true } : {};
      push(e.from, { key: e.to, rel: e.rel, dir: 'out', ...(typeByKey.has(e.to) ? { type: typeByKey.get(e.to) } : {}), ...derived });
      push(e.to, { key: e.from, rel: e.rel, dir: 'in', ...(typeByKey.has(e.from) ? { type: typeByKey.get(e.from) } : {}), ...derived });
    }
    const out: Record<string, ContextRef[]> = {};
    for (const k of keys) {
      const refs = byEnd.get(k);
      if (refs?.length) out[k] = refs;
    }
    return out;
  }

  const cmds: Pick<WorkspaceCommands, 'recall' | 'peek' | 'query' | 'changes' | 'attention' | 'tend' | 'read'> = {
    async recall(input, ctx) {
      const viewer = requireUser(ctx.identity);
      const { state, grants, vectors, store } = build(ctx);
      const includeSuperseded = input?.includeSuperseded;

      // Own slice, scored (under the per-call lens) but not yet shaped
      // (elision:'none' keeps values present so granted slices merge cleanly).
      const lens = input?.lens;
      const explain = input?.explain;
      // A stated intent (ADR-0051): relevance joins the blend (intent preset
      // under any explicit override) and each slice contributes its own
      // vector-index candidates, exactly like search's per-grant fold.
      const text = typeof input?.text === 'string' ? input.text.trim() : '';
      const salience = text ? intentSalience(input?.salience) : input?.salience;

      // ADR-0033 discrimination, computed early so the digest fast path can gate on it.
      const shapedAny = input as Record<string, unknown> | undefined;
      const askedFull =
        input?.view === 'full' ||
        (input?.view !== 'overview' &&
          !!shapedAny &&
          ['elision', 'expand', 'lens', 'salience', 'explain', 'includeSuperseded'].some((k) => shapedAny[k] !== undefined));
      // The digest fast path (ADR-0050 move 4): a BARE recall — no intent, no
      // lens, no overrides — is answered from the seq-validated cache. Grants
      // are checked LIVE so a new foreign grant always falls through to the
      // full fold (grant writes don't advance the viewer's seq).
      const bare = !askedFull && !text && !lens && !explain && !includeSuperseded && !input?.salience;
      const grantList = await applicableGrants(grants, viewer);
      const foreign = grantList.some((g) => g.owner !== viewer);
      let digestHead: number | undefined;
      if (bare && store && !foreign) {
        const { cached, head } = await readDigest(store, viewer);
        if (cached) return cached;
        digestHead = head;
      }

      // The viewer's stored salience policy (`_config/salience`) governs the whole
      // assembled view — scoring (read) and tiering (shape) alike — so granted
      // slices are scored under the viewer's policy, not each owner's. Precedence:
      // instance defaults ← viewer config ← lens ← per-call `salience` override.
      const salienceConfig = await state.salienceConfig(viewer);
      // Declared lens presets (ADR-0078) resolve under the VIEWER's config,
      // exactly like the salience policy — granted slices are read through
      // the reader's lenses, never the owner's.
      const lensesConfig = await state.lensesConfig(viewer);
      const typeRules = await typeRulesFor(ctx);
      const relevance = text ? await relevanceFor(vectors, viewer, text) : undefined;
      const own = await state.read(
        viewer,
        { elision: 'none', includeSuperseded, lens, salience, explain, salienceConfig, lensesConfig, typeRules, relevance },
        ctx.identity,
      );
      const merged: Record<string, Entry> = { ...own.entries };
      delete merged[DIGEST_KEY]; // the digest is a cache, not content

      // Fold in the subsets granted to this viewer — directly, via `public`, or
      // via a group they belong to (docs/scope-grants.md). A grant key is a
      // pattern: `*` = whole slice, trailing `*` = prefix.
      for (const g of grantList) {
        if (g.owner === viewer) continue;
        if (g.key === WHOLE_SLICE || g.key.endsWith('*')) {
          const gRelevance = text ? await relevanceFor(vectors, g.owner, text) : undefined;
          const slice = await state.read(
            g.owner,
            { elision: 'none', includeSuperseded, lens, salience, explain, salienceConfig, lensesConfig, typeRules, relevance: gRelevance },
            ctx.identity,
          );
          const prefix = g.key === WHOLE_SLICE ? '' : g.key.slice(0, -1);
          for (const [k, e] of Object.entries(slice.entries)) {
            if (k.startsWith(prefix)) merged[`${g.owner}/${k}`] = e;
          }
        } else {
          const e = await state.get(g.owner, g.key, ctx.identity);
          if (e && (!e._meta.superseded || includeSuperseded)) merged[`${g.owner}/${g.key}`] = e;
        }
      }

      // Shape the whole assembled view once (lens echoes into _shaping).
      const shaped = state.shape(merged, { elision: input?.elision, expand: input?.expand, lens, salience, salienceConfig, lensesConfig });
      const decls = await typeDeclsFor(ctx);

      // ADR-0033: progressive disclosure by default. A *bare* recall (the context-less
      // agent's first read) returns a broad, succinct overview — counts + top focus +
      // drill hints — not the whole view. Any shaping arg (or view:'full') opts into the
      // full shaped view, so configured callers are unchanged. (`askedFull`/`bare`
      // were computed up top, before the digest fast path.)
      if (!askedFull) {
        const c = shaped._shaping.counts;
        const granted = Object.keys(merged).length - Object.keys(own.entries).length + (own.entries[DIGEST_KEY] ? 1 : 0);
        const overview = buildOverview(merged, { focus: c.focus, peripheral: c.peripheral, elided: c.elided }, granted, decls);
        if (text) {
          overview.hints.unshift(
            relevance
              ? 'Goal-conditioned (ADR-0051): focus, counts, and elision are weighted by relevance to your `text`.'
              : 'A `text` intent was given but no semantic backend is configured — results are unweighted by relevance.',
          );
        }
        // Write-behind (ADR-0050): the digest carries the seq head captured
        // BEFORE the recompute, so a racing write leaves it conservatively
        // stale (invalidated on the next read), never wrongly fresh.
        if (bare && store && !foreign && digestHead !== undefined) await writeDigest(store, viewer, digestHead, overview);
        return overview;
      }

      // R1 (ADR-0029): inline affordances — include elided stubs' types so an
      // agent can act on a withheld fact's type after `expand`.
      const types = affordancesForTypes(typesOf(shaped.entries, ...(shaped.elided ?? []).map((s) => s.type)), decls);
      // ADR-0048: the full view defaults to CARD entries (the pre-shaping full
      // view could exceed the response ceiling outright). `expand`ed keys stay
      // full — that's the explicit "this one, whole" gesture; `shape:'full'`
      // restores everything.
      const tier = input?.shape ?? 'card';
      let entries = shapeEntryMap(shaped.entries, tier);
      for (const k of input?.expand ?? []) if (shaped.entries[k]) entries = { ...entries, [k]: shaped.entries[k] };
      const result = { ...shaped, entries };
      return Object.keys(types).length ? { ...result, types } : result;
    },

    async peek(input, ctx) {
      const caller = requireUser(ctx.identity);
      if (!input?.key) throw new Error('key is required');
      const { state, grants } = build(ctx);
      if (input.owner && input.owner !== caller) {
        const held = await applicableGrants(grants, caller);
        const ok = held.some((g) => g.owner === input.owner && grantCovers(g.key, input.key));
        if (!ok) {
          throw new Error(
            `grant_denied: no grant from "${input.owner}" covers "${input.key}". ` +
              `Request one: act("workspace.requestGrant", { resource: "workspace:${input.owner}:${input.key}:read" })`,
          );
        }
        const granted = await state.get(input.owner, input.key, ctx.identity);
        enforceTypeRead(ctx.identity, granted?._meta.type ?? undefined, input.key); // granular read-scope (§B); inert for coarse tokens
        return withAffordance(granted, await typeDeclsFor(ctx));
      }
      const own = await state.get(caller, input.key, ctx.identity);
      enforceTypeRead(ctx.identity, own?._meta.type ?? undefined, input.key); // granular read-scope (§B); inert for coarse tokens
      return withAffordance(own, await typeDeclsFor(ctx));
    },

    async query(input, ctx) {
      const started = Date.now();
      const scope = requireUser(ctx.identity);
      const { state, vectors } = build(ctx);
      enforceTypeRead(ctx.identity, input?.type, ''); // granular read-scope (§B): a type-scoped token must pin `type`; inert for coarse tokens
      // A stated intent (ADR-0051): `query({text})` alone is semantic search
      // that still respects earned salience; with filters it's the hybrid
      // neither query nor search could do. Relevance enters the one blend via
      // the intent preset (an explicit `salience` override still wins).
      const text = typeof input?.text === 'string' ? input.text.trim() : '';
      const relevance = text ? await relevanceFor(vectors, scope, text) : undefined;
      const result = await state.query(
        scope,
        {
          type: input?.type,
          tag: input?.tag,
          prefix: input?.prefix,
          rankBy: input?.rankBy,
          lens: input?.lens,
          salience: text ? intentSalience(input?.salience) : input?.salience,
          explain: input?.explain,
          limit: input?.limit,
          cursor: input?.cursor,
          includeSuperseded: input?.includeSuperseded,
          contains: input?.contains,
          typeRules: await typeRulesFor(ctx),
          relevance,
        },
        ctx.identity,
      );
      // R1 (ADR-0029): inline what the agent can DO with each returned type.
      const types = affordancesForTypes(typesOf(result.entries), await typeDeclsFor(ctx));
      const shaped = { ...result, entries: shapeEntryList(result.entries, input?.shape) };
      // Observability (ADR-0081 home-cell incident): latency/size, so a future
      // CloudFront-timeout or 6MB-payload regression is diagnosable from logs
      // rather than manual CloudWatch archaeology.
      ctx.logger.info('workspace.query complete', {
        scope,
        type: input?.type,
        entries: shaped.entries.length,
        cursor: !!input?.cursor,
        nextCursor: !!result.nextCursor,
        durationMs: Date.now() - started,
      });
      return Object.keys(types).length ? { ...shaped, types } : shaped;
    },

    async changes(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      // ADR-0048: a bare call means "what happened lately?", not "replay
      // everything" — newest 200, ascending. Tailing (`sinceSeq`) and explicit
      // windows (`limit`/`last`) behave exactly as asked.
      const bare = input?.sinceSeq === undefined && input?.limit === undefined && input?.last === undefined;
      const sinceSeq = input?.sinceSeq === 'head' ? 'head' : (input?.sinceSeq ?? 0);
      const result = bare
        ? await state.changes(scope, 0, undefined, 200, input?.scope)
        : await state.changes(scope, sinceSeq, input?.limit, input?.last, input?.scope);
      if (input?.include !== 'entries') return result;
      // ADR-0055 Inc 2: inline the CURRENT entry for each written key on the
      // page — card-shaped, touch-free (a projection read must not inflate
      // salience), one batched read instead of a client fetch per event.
      const keys = [...new Set(result.events.filter((e) => (e.op === 'write' || e.op === 'supersede') && e.key !== null).map((e) => e.key as string))];
      if (!keys.length) return { ...result, entries: {} };
      const fetched = await state.getMany(scope, keys);
      const entries: Record<string, Entry | null> = {};
      for (const k of keys) {
        const e = fetched[k];
        entries[k] = e ? shapeEntry(e, 'card') : null;
      }
      return { ...result, entries };
    },

    async attention(input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state } = build(ctx);
      return state.attention(scope, {
        staleMs: input?.staleMs,
        limit: input?.limit,
        includeSystem: input?.includeSystem,
        typeRules: await typeRulesFor(ctx),
      });
    },

    async tend(_input, ctx) {
      const scope = requireUser(ctx.identity);
      const { state, store } = build(ctx);
      return runTend(state, scope, ctx, 'manual', ctx.identity, store);
    },

    // ADR-0071 (C2): one read, parameterized by candidate source + shape. A pure
    // dispatch over the presets (behaviour-preserving by construction, the C1/C3
    // pattern) plus the two enrichments: `context:'refs'` periphery, and the
    // reserved principal layer (ADR-0074) applied between defaults and the call.
    async read(input, ctx): Promise<ComposedReadResult> {
      // The PRINCIPAL layer (ADR-0074, live): posture supplies what the call
      // didn't say; anything the caller passes still wins. The SHAPE stays the
      // caller's — the source is inferred from the caller's own args BEFORE the
      // merge, so a standing goal *conditions* the read (recall({text})
      // semantics, ADR-0051) but never flips an overview into a search.
      const source = inferSource(input);
      const merged: ComposedReadInput = { ...(input ?? {}) };
      const posture = principalPosture(ctx.identity);
      if (posture && ctx.identity.user) {
        if (posture.goal && merged.text === undefined && (source === 'slice' || source === 'store' || source === 'vector')) {
          // A `goal/<id>` posture references the goal graph: resolve the fact
          // (touch-free, own slice) to its title/detail; free text passes as-is.
          let text: string | null = posture.goal;
          if (posture.goal.includes('/')) {
            const { store } = build(ctx);
            const rec = store ? await store.get(ctx.identity.user, posture.goal).catch(() => null) : null;
            if (rec && !rec.superseded) text = goalTextOf(rec.value) ?? posture.goal;
          }
          if (text) merged.text = text;
        }
        if (posture.lens && merged.lens === undefined) merged.lens = posture.lens;
        if (posture.salience) merged.salience = { ...posture.salience, ...merged.salience };
      }
      const cap = Math.min(Math.max(merged.contextLimit ?? 8, 1), 24);
      const wantContext = merged.context === 'refs';

      if (source === 'key') {
        const entry = await cmds.peek({ key: merged.key!, owner: merged.owner }, ctx);
        if (!wantContext || !entry) return entry;
        const p = await peripheryFor(ctx, [merged.key!], cap);
        return p[merged.key!] ? ({ ...entry, _context: p[merged.key!] } as Entry & { _context: ContextRef[] }) : entry;
      }

      if (source === 'changes') {
        // The trajectory is events, not facts — the periphery doesn't apply.
        return cmds.changes(
          { sinceSeq: merged.sinceSeq, limit: merged.limit, last: merged.last, scope: merged.scope, include: merged.include },
          ctx,
        );
      }

      if (source === 'store' || source === 'vector') {
        const result = await cmds.query(
          {
            type: merged.type,
            tag: merged.tag,
            prefix: merged.prefix,
            text: merged.text,
            rankBy: merged.rankBy,
            lens: merged.lens,
            salience: merged.salience,
            limit: merged.limit,
            cursor: merged.cursor,
            includeSuperseded: merged.includeSuperseded,
            contains: merged.contains,
            explain: merged.explain,
            shape: merged.shape,
          },
          ctx,
        );
        if (!wantContext) return result;
        const p = await peripheryFor(ctx, result.entries.map((e) => e.key), cap);
        return { ...result, entries: result.entries.map((e) => (p[e.key] ? { ...e, _context: p[e.key] } : e)) };
      }

      // slice — the assembled view (overview by default, exactly as recall).
      const result = await cmds.recall(
        {
          view: merged.view,
          text: merged.text,
          elision: merged.elision,
          expand: merged.expand,
          includeSuperseded: merged.includeSuperseded,
          lens: merged.lens,
          salience: merged.salience,
          explain: merged.explain,
          shape: merged.shape,
        },
        ctx,
      );
      if (!wantContext || !('entries' in result)) return result; // overview skips the periphery
      const keys = Object.keys(result.entries);
      const p = await peripheryFor(ctx, keys, cap);
      const entries: ReadResult['entries'] = {};
      for (const k of keys) entries[k] = p[k] ? ({ ...result.entries[k], _context: p[k] } as Entry) : result.entries[k];
      return { ...result, entries };
    },
  };
  return cmds;
}

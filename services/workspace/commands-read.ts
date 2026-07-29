/**
 * Workspace command group (ADR-0044 Inc 5): read/query/recall projections +
 * attention/changes/tending — recall, peek, query, changes, attention, tend,
 * with the recall-overview builders.
 */
import {
  requireUser,
  indexForScope,
  isTimerLive,
  INTENT_PRESET,
  type ChangesResult,
  type ChangesScope,
  type Entry,
  type ReadResult,
  type QueryResult,
  type SalienceLens,
  type SalienceOptions,
} from '../../platform/runtime';
import { shapeEntry, shapeEntryList, shapeEntryMap, orientEntry, type ReadShape } from './shape';
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
import { degeneracyOf } from './commands-search';
import { TOOL_DESCRIPTORS } from './descriptors';
import type { WorkspaceCommands } from './handlers';

/** Candidate-set size for a stated intent (ADR-0051): the vector top-K IS the
 *  bounded relevance pool; keys outside it score relevance 0. */
const INTENT_TOP_K = 200;

/**
 * The key prefixes to scan so a granted owner's page cap bounds the COVERED set
 * rather than their whole slice (the grant fold in `query`).
 *
 * Every grant pattern is one of three shapes (`grantCovers`): `*` (whole slice),
 * `prefix*`, or an exact key — and all three reduce to a prefix scan. An exact
 * key over-scans slightly (it also matches keys extending it); `grantCovers`
 * discards those, so the result is exact.
 *
 * `callerPrefix` is any `prefix` the caller already asked for; the two must both
 * hold, so the narrower wins and a disjoint pair is dropped (it cannot match).
 * Redundant patterns are collapsed — a pattern already inside a broader prefix
 * adds a query and no facts. `''` means "whole slice" and, once present, is the
 * only scan needed.
 */
export function coveredScanPrefixes(patterns: string[], callerPrefix?: string): string[] {
  const cp = callerPrefix ?? '';
  const out: string[] = [];
  for (const p of patterns) {
    const gp = p === WHOLE_SLICE ? '' : p.endsWith('*') ? p.slice(0, -1) : p;
    // Both constraints must hold: keep the narrower, drop a disjoint pair.
    if (gp.startsWith(cp)) out.push(gp);
    else if (cp.startsWith(gp)) out.push(cp);
  }
  if (!out.length) return [];
  if (out.includes('')) return ['']; // whole slice subsumes every other scan
  const uniq = [...new Set(out)].sort();
  return uniq.filter((p, i) => !uniq.some((q, j) => j !== i && p !== q && p.startsWith(q)));
}

/**
 * Per-key relevance to a stated intent (ADR-0051): embed the text once, take the
 * scope's vector index top-K as `{ key: cosine }`. `undefined` when no semantic
 * backend is configured — the read proceeds unweighted (the index is a candidate
 * generator, never an authority; ADR-0030 Decision 1 unchanged).
 *
 * `cover` (ADR-0092 A4 — the granted-owner call): the viewer's grant patterns
 * for this owner. Without it, a granted owner's top-K is taken over their WHOLE
 * index, so a viewer covering 8 public facts among 3,000 gets a candidate set
 * dominated by keys they can't see — the covered facts score relevance 0 and
 * rank as if irrelevant (topK starvation; ranking degrades, nothing leaks — the
 * entry fold enforces coverage regardless). With `cover`: widen the k-NN and
 * keep only covered candidates before building the relevance map. Coverage on
 * the returned ENTRIES stays enforced downstream exactly as before.
 */
async function relevanceFor(
  vectors: WorkspaceDeps['vectors'],
  scope: string,
  text: string,
  cover?: string[],
): Promise<Record<string, number> | undefined> {
  if (!vectors) return undefined;
  const [queryVector] = await vectors.embedder.embed([text]);
  const matches = await vectors.store
    .query(indexForScope(scope, vectors.embedder.dimension), queryVector, { topK: cover ? INTENT_TOP_K * 3 : INTENT_TOP_K })
    .catch(() => []);
  const rel: Record<string, number> = {};
  for (const m of matches) {
    if (cover && !cover.some((p) => grantCovers(p, m.key))) continue;
    rel[m.key] = m.score;
  }
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

/**
 * The ambient frame (ADR-0084 Open #4, ADR-0086 Inc 2) — what you should NOTICE,
 * beside what you asked for.
 *
 * `adaptive-salience.md`: *"The substrate's capacity to direct attention toward
 * what matters, including things the participant doesn't know to ask about …
 * The environment should manage attention, not just comply with requests."*
 *
 * Why a HEADER and not the focus band: the focus band ranks the whole slice on
 * one blended score, and in a docs-heavy corpus durable prose wins it — a live
 * measurement found 10 of 12 focus cards were `doc`/`markdown`. Open work is not
 * *more salient* than an essay; it is a **standing wait-condition**, a different
 * kind of thing. ADR-0084 already ruled on where those belong: *"Parked driven
 * runs are standing wait-conditions and belong in every driver's perception"* —
 * "scoped to a frame header instead of a payload." So this adds a frame; it does
 * NOT re-rank, and it withholds nothing (`adaptive-salience.md`: *"adds
 * metadata; it does not withhold data"*).
 *
 * Size discipline, inherited from `livePresence()`: a few thin rows, never a
 * roster dump; every block omitted when empty; never fails the read it decorates.
 */
export interface AmbientFrame {
  /** What this session is FOR (ADR-0074's silent bias, made visible). */
  posture?: { goal?: string; lens?: string };
  /** Who else is acting right now (ADR-0086) — thin rows off `_presence/*`. */
  participants?: Array<{ participant: string; actor?: string; lastTarget?: string }>;
  /** Standing wait-conditions, per type that DECLARES itself ambient in its
   *  `types.json`. Tier-1 never learns a cell's name: the vocabulary says what
   *  counts as pending, exactly as it says how to render or key a fact. */
  standing?: Record<
    string,
    {
      count: number;
      /** WHAT `count` counted, in the type's own words (e.g. "todo or doing").
       *  The frame counts everything standing; the `verb` may apply readiness or
       *  dependency rules the frame cannot see, so the two legitimately differ —
       *  and a probe caught the frame reporting 3 where the verb returned 2
       *  while the hint called the verb's answer "the full list" (wave-8
       *  W8-D-01). Saying what was counted is what makes the difference honest
       *  instead of a silent loss. */
      basis?: string;
      verb?: string;
      top?: Array<{ key: string; title?: string }>;
    }
  >;
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
  /** What to NOTICE — posture, peers, and standing work. Omitted when empty. */
  frame?: AmbientFrame;
  /** The top facts by salience, in full — the entry points worth reading now. */
  focus: Record<string, Entry>;
  /** How to dig deeper — this is progressive disclosure, not the whole view. */
  hints: string[];
  types?: Record<string, TypeAffordance>;
}

/** Cap on facts returned in full in an overview's `focus` block. */
const OVERVIEW_FOCUS = 12;
/** Frame caps — a header, not a payload. */
const FRAME_PEERS = 6;
const FRAME_TOP = 3;

/** A type's `ambient` declaration, when it carries one. */
interface AmbientDecl {
  /** The class this type contributes to, e.g. `"work"`. */
  as: string;
  /** Field→allowed-values predicate over `value`; all listed fields must match. */
  when?: Record<string, string[]>;
  /** Dotted path to a human label on `value` (e.g. `value.title`). */
  label?: string;
  /** The verb that answers this class authoritatively — the frame only points. */
  verb?: string;
}

function ambientDecl(decl: Record<string, unknown> | undefined): AmbientDecl | null {
  const a = decl?.ambient as Record<string, unknown> | undefined;
  if (!a || typeof a !== 'object' || typeof a.as !== 'string' || !a.as.trim()) return null;
  const when: Record<string, string[]> = {};
  if (a.when && typeof a.when === 'object') {
    for (const [k, v] of Object.entries(a.when as Record<string, unknown>)) {
      if (Array.isArray(v)) when[k] = v.map(String);
    }
  }
  return {
    as: a.as.trim(),
    ...(Object.keys(when).length ? { when } : {}),
    ...(typeof a.label === 'string' ? { label: a.label } : {}),
    ...(typeof a.verb === 'string' ? { verb: a.verb } : {}),
  };
}

/** Read a `value.x.y` path off an entry, tolerantly. */
function atPath(value: unknown, path: string | undefined): string | undefined {
  if (!path) return undefined;
  let cur: unknown = { value };
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return typeof cur === 'string' && cur.trim() ? cur.trim() : undefined;
}

/**
 * Assemble the frame from facts ALREADY in hand — `merged` is the whole scored
 * slice, so counting costs no extra round trip (the co-sizing discipline applies
 * to latency as well as bytes).
 */
export function buildFrame(
  merged: Record<string, Entry>,
  decls: Record<string, Record<string, unknown>>,
  posture?: { goal?: string; lens?: string } | null,
): AmbientFrame | undefined {
  const frame: AmbientFrame = {};
  if (posture?.goal || posture?.lens) {
    frame.posture = { ...(posture.goal ? { goal: posture.goal } : {}), ...(posture.lens ? { lens: posture.lens } : {}) };
  }

  // Peers: `_presence/*` leases. Liveness is the timer — a lapsed lease is
  // already gone at read, so presence needs no filtering here (ADR-0086).
  const peers: NonNullable<AmbientFrame['participants']> = [];
  for (const [key, e] of Object.entries(merged)) {
    if (!key.startsWith('_presence/') || peers.length >= FRAME_PEERS) continue;
    const v = (e.value ?? {}) as { participant?: string; actor?: string; lastTarget?: string };
    const participant = v.participant || key.slice('_presence/'.length);
    if (!participant) continue;
    peers.push({ participant, ...(v.actor ? { actor: v.actor } : {}), ...(v.lastTarget ? { lastTarget: v.lastTarget } : {}) });
  }
  if (peers.length) frame.participants = peers;

  // Standing work, by declared ambient class.
  const ambient = new Map<string, AmbientDecl>();
  for (const [type, decl] of Object.entries(decls)) {
    const a = ambientDecl(decl);
    if (a) ambient.set(type, a);
  }
  if (ambient.size) {
    const byClass = new Map<
      string,
      { count: number; verb?: string; basis?: string; hits: Array<{ key: string; title?: string; score: number }> }
    >();
    for (const [key, e] of Object.entries(merged)) {
      const a = e._meta.type ? ambient.get(e._meta.type) : undefined;
      if (!a) continue;
      const v = (e.value ?? {}) as Record<string, unknown>;
      if (a.when && !Object.entries(a.when).every(([f, allowed]) => allowed.includes(String(v[f])))) continue;
      const slot = byClass.get(a.as) ?? { count: 0, ...(a.verb ? { verb: a.verb } : {}), hits: [] };
      slot.count += 1;
      if (!slot.verb && a.verb) slot.verb = a.verb;
      // Say what was counted, derived from the type's own `when` predicate — so
      // a caller can see WHY the frame's number and the verb's may differ.
      if (a.when) {
        const stated = Object.values(a.when).flat().join(' or ');
        slot.basis = slot.basis && slot.basis !== stated ? `${slot.basis} or ${stated}` : stated;
      }
      slot.hits.push({ key, title: atPath(e.value, a.label), score: e._meta.score ?? 0 });
      byClass.set(a.as, slot);
    }
    const standing: NonNullable<AmbientFrame['standing']> = {};
    for (const [cls, slot] of byClass) {
      const top = slot.hits
        .sort((x, y) => y.score - x.score)
        .slice(0, FRAME_TOP)
        .map(({ key, title }) => ({ key, ...(title ? { title } : {}) }));
      standing[cls] = {
        count: slot.count,
        ...(slot.basis ? { basis: slot.basis } : {}),
        ...(slot.verb ? { verb: slot.verb } : {}),
        ...(top.length ? { top } : {}),
      };
    }
    if (Object.keys(standing).length) frame.standing = standing;
  }

  return Object.keys(frame).length ? frame : undefined;
}

/** The verbs this service actually declares — the live vocabulary, read off the
 *  same descriptor list `describeTools` serves the gateway. */
const LIVE_VERBS = new Set(TOOL_DESCRIPTORS.map((d) => d.name));

/**
 * Orientation hints as (verbs, text) pairs rather than free prose.
 *
 * A hint is INSTRUCTION — a bare `recall()` is the most-read teaching surface in
 * the system — so it must never name a verb the membrane no longer accepts.
 * Hard-coded prose drifts: this list shipped `search({ text })` and
 * `neighbors({ key })` long after ADR-0069/0071 retired both, so every agent that
 * followed the hints got `capability_retired` (wave-7). Each hint now DECLARES
 * the verbs it mentions; `liveHints()` drops any hint naming a verb that is not
 * in the live descriptor set, and the jest gate fails on one — so retiring a verb
 * silences its hint in prod and breaks the build in CI, instead of rotting.
 */
export const OVERVIEW_HINTS: ReadonlyArray<{ verbs: string[]; text: string }> = [
  { verbs: ['recall'], text: 'This is a succinct overview (the default). For the whole shaped view: recall({ view: "full" }).' },
  { verbs: ['query'], text: 'Drill by structure: query({ type | prefix | tag | contains }) — filtered + paged.' },
  { verbs: ['query'], text: 'Drill by meaning: query({ text }) — semantic candidates across your slice.' },
  { verbs: ['peek', 'edges'], text: 'One fact: peek({ key }); its links: edges({ around: key }); the graph: read("$graph").' },
  { verbs: ['suggestions'], text: 'Connection candidates the index proposes: suggestions().' },
];

/** The hints whose every named verb is still live, plus — when the frame carries
 *  standing work — a pointer to the verb that answers it authoritatively. The
 *  frame teases a count; the hint says how to get the list. */
export function liveHints(
  frame?: AmbientFrame,
  hints: ReadonlyArray<{ verbs: string[]; text: string }> = OVERVIEW_HINTS,
): string[] {
  const out = hints.filter((h) => h.verbs.every((v) => LIVE_VERBS.has(v))).map((h) => h.text);
  for (const [cls, s] of Object.entries(frame?.standing ?? {})) {
    if (!s.verb) continue;
    // NOT "the full list" — the verb may apply readiness or dependency rules the
    // frame's census cannot see, and claiming otherwise loses items silently
    // (wave-8 W8-D-01: frame said 3, the verb returned 2).
    const basis = s.basis ? ` (${s.basis})` : '';
    out.unshift(
      `You have ${s.count} standing ${cls} item${s.count === 1 ? '' : 's'}${basis} — see frame.standing.${cls}. read("${s.verb}") lists the ones actionable now, which may be fewer.`,
    );
  }
  return out;
}

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
  focusShape: ReadShape = 'card',
  posture?: { goal?: string; lens?: string } | null,
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
  // ONE SLOT PER SOURCE (W3-F1 — unanimous across four probe replicas across
  // waves 1–3, never implemented until now). A decomposed document exists as
  // `doc:X`, `file/X.md`, and N `doc-block:X/i` facts; they are near-identical by
  // construction and score within ~0.05 of each other, so a single freshly-synced
  // doc used to sweep several of the twelve slots (measured: 3 sibling blocks of
  // one README plus a doc+file pair of another, i.e. 5 of 12 spent on 2 sources).
  // The focus band is the ignition threshold — spending it on the same thing
  // three times is exactly the flooding the co-sizing principle warns against.
  // `degeneracyOf` is the SAME predicate `suggestions()` already uses to refuse
  // ratifying a block against its own parent — it knows `doc:docs/x`,
  // `file/docs/x.md` and `doc-block:docs/x/3` are one source across three
  // namespaces. Reused here rather than reimplemented, so the two surfaces can
  // never disagree about what "the same thing" means. Bounded: at most
  // OVERVIEW_FOCUS comparisons per candidate, and the scan stops once full.
  const focusEntries: Array<[string, Entry]> = [];
  for (const pair of entries.sort((a, b) => (b[1]._meta.score ?? 0) - (a[1]._meta.score ?? 0))) {
    if (focusEntries.length >= OVERVIEW_FOCUS) break;
    if (focusEntries.some(([seen]) => degeneracyOf(seen, pair[0]))) continue;
    focusEntries.push(pair);
  }
  // Shape the focus band for orientation (ADR-0048): the overview is a "what do
  // I have?" skim, so each top fact carries key + type + salience + a value
  // preview — NOT its whole body (a long ADR/doc could be ~10KB, and its
  // near-duplicate doc-block slice ships it twice) NOR its full provenance
  // envelope repeated a dozen times. The default (`focusShape` unset → 'card')
  // uses `orientEntry`: card value + refs `_meta` slice. `recall({shape:"full"})`
  // keeps whole entries; `{shape:"refs"}` drops values; `peek`/`recall({view:"full"})`
  // always restore the whole fact.
  const shapeFocus = (e: Entry): Entry =>
    focusShape === 'full' ? e : focusShape === 'refs' ? shapeEntry(e, 'refs') : orientEntry(e);
  const focus: Record<string, Entry> = {};
  for (const [k, e] of focusEntries) focus[k] = shapeFocus(e);
  const types = affordancesForTypes(typesOf(focus), decls);
  // Best-effort: the frame is decoration, and must never fail the read it
  // decorates (the `livePresence()` contract, applied on this side too).
  let frame: AmbientFrame | undefined;
  try {
    frame = buildFrame(merged, decls, posture);
  } catch {
    frame = undefined;
  }
  return {
    overview: {
      total: entries.length,
      granted,
      bands,
      byType: topN(byType, 15).map(({ k, count }) => ({ type: k, count })),
      byPrefix: topN(byPrefix, 12).map(({ k, count }) => ({ prefix: k, count })),
    },
    ...(frame ? { frame } : {}),
    focus,
    hints: liveHints(frame),
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
  /** Match-any over tags (W4i) — the plural spelling; a fact matches if it
   *  carries at least one. Silently ignored before wave 4 (it returned the
   *  whole slice), so honored explicitly now. */
  tags?: string[];
  prefix?: string;
  /** Rank by meaning as well as structure (ADR-0051): free text, embedded and
   *  matched semantically. Relevance joins the salience blend under the intent
   *  preset — `query({text})` alone is semantic search that still respects
   *  standing/attention; `query({type, text})` is the hybrid. Elision and
   *  ranking are both intent-conditioned. */
  text?: string;
  rankBy?: 'salience' | 'recency' | 'relevance';
  /** Bias salience via a named lens — compiled (recent/connected/durable/
   *  active) or slice-declared (`_config/lenses`, ADR-0078). Unknown ⇒ ignored. */
  lens?: SalienceLens | (string & {});
  /** Precise per-call salience override (merges over the lens + defaults). */
  salience?: Partial<SalienceOptions>;
  limit?: number;
  /** Resume token from a previous page's `nextCursor`. */
  cursor?: string;
  /** Numeric alias for `cursor` (which is structurally a plain offset into the
   *  fresh ranking). Previously accepted-and-ignored — the worst API answer. */
  offset?: number;
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

/** Where a participant's adopted posture lives (ADR-0086 Inc 4): a plain fact,
 *  sibling of `_presence/<participant>`. Written with `remember` (value
 *  {goal?, lens?, salience?}, optionally timer-expiring), read here per
 *  composed read when the dispatch carried a participant key. Substrate-native
 *  by design: a fanned-out specialist adopts ITS goal without hijacking the
 *  session token's standing posture (auth.adoptGoal, which stays token-level),
 *  and the posture is visible/editable/expirable like any other fact. */
export const PARTICIPANT_POSTURE_PREFIX = '_posture/';

/** The participant's own posture fact, mapped to the same shape
 *  `principalPosture` yields — it OVERRIDES the token posture when present
 *  (the finer key wins; provenance-grade, biases ranking only, never
 *  membership or authority). Absent/lapsed/superseded ⇒ null ⇒ token posture. */
export async function participantPosture(
  store: WorkspaceDeps['store'],
  user: string | undefined,
  participant: string | undefined,
): Promise<{ goal?: string; lens?: SalienceLens; salience?: Partial<SalienceOptions> } | null> {
  if (!store || !user || !participant) return null;
  const rec = await store.get(user, `${PARTICIPANT_POSTURE_PREFIX}${participant}`).catch(() => null);
  if (!rec || rec.superseded || !isTimerLive(rec, Date.now())) return null;
  return principalPosture({ posture: rec.value });
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
  if (input?.type || input?.tag || (input?.tags && input.tags.length) || input?.prefix || input?.contains || input?.cursor || input?.rankBy) return 'store';
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
      // full fold (grant writes don't advance the viewer's seq). An explicit
      // `shape` also disqualifies it: the cached digest is built at the default
      // (card) focus tier, so `recall({shape:"full"|"refs"})` must recompute.
      // An adopted POSTURE also disqualifies it: the digest is a per-SLICE cache
      // and the ambient frame echoes the principal's own posture (ADR-0084 Open
      // #4), so caching it would serve one session's goal to the next. Postured
      // sessions are the rare case; correctness beats the cache hit.
      const posture = (ctx.identity.posture ?? null) as { goal?: string; lens?: string } | null;
      const bare =
        !askedFull && !text && !lens && !explain && !includeSuperseded && !input?.salience && !input?.shape && !posture;
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
          const gRelevance = text ? await relevanceFor(vectors, g.owner, text, [g.key]) : undefined;
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
        const overview = buildOverview(merged, { focus: c.focus, peripheral: c.peripheral, elided: c.elided }, granted, decls, input?.shape ?? 'card', posture);
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
      // Grant-aware key resolution (the peek twin of recall's fold): a viewer
      // reading someone else's public/shared fact addresses it EITHER as the
      // recall-style `owner/key` (how folded reads key foreign facts) OR bare
      // (a known public key like `file/docs/x.md`). Resolve both through grants —
      // `owner/key` when the leading segment is a granting owner, else a bare key
      // a grant covers — so query→node→peek and the file-body fallback all work
      // for a signed-out `@guest`. Own-slice keys (no matching owner/grant) are
      // untouched — this only ever *adds* reach a grant already permits.
      const held = await applicableGrants(grants, caller);
      const foreign = held.filter((g) => g.owner !== caller);
      const slash = input.key.indexOf('/');
      if (slash > 0) {
        const owner = input.key.slice(0, slash);
        const rest = input.key.slice(slash + 1);
        // SELF-folded spelling (`<me>/key`): the canonical /r/<owner>/<key>
        // address a grant-folded surface mints works for the owner too —
        // `applicableGrants` excludes own grants, so without this the owner
        // refreshing their own folded deep link got a false null (ADR-0090).
        // A LITERAL own key that happens to start `<me>/` still wins first.
        if (owner === caller) {
          const literal = await state.get(caller, input.key, ctx.identity);
          const own = literal ?? (await state.get(caller, rest, ctx.identity));
          const ownKey = literal ? input.key : rest;
          enforceTypeRead(ctx.identity, own?._meta.type ?? undefined, ownKey);
          return withAffordance(own, await typeDeclsFor(ctx));
        }
        if (foreign.some((g) => g.owner === owner && grantCovers(g.key, rest))) {
          const granted = await state.get(owner, rest, ctx.identity);
          enforceTypeRead(ctx.identity, granted?._meta.type ?? undefined, rest);
          return withAffordance(granted, await typeDeclsFor(ctx));
        }
      }
      const own = await state.get(caller, input.key, ctx.identity);
      if (!own) {
        for (const g of foreign) {
          if (!grantCovers(g.key, input.key)) continue;
          const e = await state.get(g.owner, input.key, ctx.identity);
          if (e && !e._meta.superseded) {
            enforceTypeRead(ctx.identity, e._meta.type ?? undefined, input.key);
            return withAffordance(e, await typeDeclsFor(ctx));
          }
        }
      }
      enforceTypeRead(ctx.identity, own?._meta.type ?? undefined, input.key); // granular read-scope (§B); inert for coarse tokens
      return withAffordance(own, await typeDeclsFor(ctx));
    },

    async query(input, ctx) {
      const started = Date.now();
      const scope = requireUser(ctx.identity);
      const { state, vectors, grants } = build(ctx);
      enforceTypeRead(ctx.identity, input?.type, ''); // granular read-scope (§B): a type-scoped token must pin `type`; inert for coarse tokens
      // A stated intent (ADR-0051): `query({text})` alone is semantic search
      // that still respects earned salience; with filters it's the hybrid
      // neither query nor search could do. Relevance enters the one blend via
      // the intent preset (an explicit `salience` override still wins).
      const text = typeof input?.text === 'string' ? input.text.trim() : '';
      const relevance = text ? await relevanceFor(vectors, scope, text) : undefined;
      // F7 (membrane wave 1): an intent query (`text` present) is an ORIENTATION
      // read — "which few entries matter for this goal?" — not a corpus dump.
      // Un-limited, it returned the WHOLE ranked slice with full `_meta` per hit
      // (102 capability facts = 77KB, blowing a caller's result window with a
      // shortlist it only needed the head of). Default intent queries to a
      // top-20 shortlist; an explicit `limit` still wins, filters-only queries
      // are unchanged.
      // W4f (wave-4, 3 drivers independently): a filter-only query with no
      // limit returned the WHOLE slice as FULL entries — `type:knowledge` (60KB)
      // and `lens:recent` (262KB) both blew the caller's token ceiling. Bound it
      // to a generous default page (nextCursor signals more — never lossy), the
      // same discipline intent queries already have. An explicit limit still wins.
      const DEFAULT_FILTER_LIMIT = 50;
      const limit = input?.limit ?? (text ? 20 : DEFAULT_FILTER_LIMIT);
      // F9: `cursor` is a plain offset into the fresh ranking, but callers
      // naturally reach for `offset` — which was silently ignored (RT-A got
      // page 1 twice). Honor it as the alias it structurally is.
      const cursor = input?.cursor ?? (typeof input?.offset === 'number' && input.offset > 0 ? String(input.offset) : undefined);
      // ADR-0085 Inc 3 (W3c): a stated intent DRIVES the order — relevance
      // first, salience as tiebreak, no-relevance tail dropped (salience used
      // to pad the shortlist with rows the intent never reached: "link above
      // ratify" for a ratification goal). An explicit rankBy still wins, and
      // without a semantic backend the ranking degrades to salience unchanged.
      const rankBy = input?.rankBy ?? (relevance && Object.keys(relevance).length ? 'relevance' : undefined);
      const typeRules = await typeRulesFor(ctx);
      const qOpts = {
        type: input?.type,
        tag: input?.tag,
        tags: input?.tags,
        prefix: input?.prefix,
        rankBy,
        lens: input?.lens,
        salience: text ? intentSalience(input?.salience) : input?.salience,
        explain: input?.explain,
        includeSuperseded: input?.includeSuperseded,
        contains: input?.contains,
        typeRules,
      };
      // Grant fold (the query twin of recall's fan-out): a viewer's query also
      // ranges over the slices shared to them — public/shared facts keyed
      // `owner/key`, exactly as recall and the edges fold key them — so a
      // signed-out `@guest` gets the owner's public slice as graph nodes, not an
      // empty own-slice. Own-slice-only callers skip the fold (behaviour-preserved).
      const foreignGrants = (await applicableGrants(grants, scope)).filter((g) => g.owner !== scope);
      let result: Awaited<ReturnType<typeof state.query>>;
      if (!foreignGrants.length) {
        result = await state.query(scope, { ...qOpts, relevance, limit, cursor }, ctx.identity);
      } else {
        // Merge own + each granted owner's matching facts, re-rank across the
        // union, then offset-page (query's cursor IS an offset). Bounded per
        // partition so a large shared slice can't blow the payload.
        const FOLD_CAP = 1200;
        const rankVal = (e: { _meta: unknown }): number => {
          const m = (e._meta ?? {}) as { score?: number; relevance?: number };
          return Number((text ? (m.relevance ?? m.score) : m.score) ?? 0);
        };
        const byOwner = new Map<string, string[]>();
        for (const g of foreignGrants) { const a = byOwner.get(g.owner) ?? []; a.push(g.key); byOwner.set(g.owner, a); }
        const own = await state.query(scope, { ...qOpts, limit: FOLD_CAP }, ctx.identity);
        const merged = own.entries.slice();
        for (const [owner, pats] of byOwner) {
          const oRel = text ? await relevanceFor(vectors, owner, text, pats) : undefined;
          // COVERAGE GOES INTO THE QUERY, not just the filter after it.
          //
          // This used to take the owner's top-FOLD_CAP by salience over their
          // WHOLE slice and then drop what the viewer can't see. That is the
          // same topK starvation `relevanceFor`'s `cover` argument was added to
          // fix for the semantic path (see its docstring), left in place on the
          // non-semantic one — and it is worse here, because the surviving count
          // becomes the reported `total`.
          //
          // Measured 2026-07-29 on the c15r public slice: 19 public grants cover
          // ~135 facts, of which 115 are `doc-block:*` sitting at salience
          // 0.12–0.14. The owner's top 1200 of a 7,600-fact slice is all
          // 0.2–0.8, so essentially NO block made the window: an unauthenticated
          // home graph reported `20/20` — the handful of high-salience `doc:` and
          // `file/` identity facts — while every block it was entitled to read
          // was invisible. Selecting a node then pulled in more, because
          // per-key reads never went through this fold.
          //
          // Every grant pattern is whole-slice, `prefix*`, or an exact key
          // (`grantCovers`), so each reduces to a prefix scan. Querying per
          // pattern makes FOLD_CAP bound the COVERED set. `grantCovers` still
          // runs on the results, so coverage enforcement is unchanged — this
          // only stops the candidate generator from starving it.
          const scanPrefixes = coveredScanPrefixes(pats, qOpts.prefix);
          const pages = await Promise.all(
            scanPrefixes.map((prefix) =>
              state.query(owner, { ...qOpts, relevance: oRel, ...(prefix ? { prefix } : {}), limit: FOLD_CAP }, ctx.identity),
            ),
          );
          const seen = new Set<string>();
          for (const fq of pages) {
            for (const e of fq.entries) {
              if (!pats.some((p) => grantCovers(p, e.key))) continue;
              if (seen.has(e.key)) continue; // the same fact can match two patterns
              seen.add(e.key);
              merged.push({ ...e, key: `${owner}/${e.key}` });
            }
          }
        }
        merged.sort((a, b) => rankVal(b) - rankVal(a));
        const offset = Number(cursor ?? 0) || 0;
        result = { ...own, entries: merged.slice(offset, offset + limit), total: merged.length, nextCursor: offset + limit < merged.length ? String(offset + limit) : undefined };
      }
      // R1 (ADR-0029): inline what the agent can DO with each returned type.
      const types = affordancesForTypes(typesOf(result.entries), await typeDeclsFor(ctx));
      // Intent queries also default to the ORIENTATION entry shape (card value
      // preview + refs `_meta` incl. relevance — the same tier as recall's focus
      // band): a ranked shortlist wants each hit's identity, preview, and WHY
      // (relevance), not its full provenance envelope. Explicit `shape` wins;
      // filters-only queries keep whole entries as before.
      const entries = input?.shape
        ? shapeEntryList(result.entries, input.shape)
        : text
          ? result.entries.map((e) => orientEntry(e))
          : result.entries;
      const shaped = { ...result, entries };
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
      // The stale/unlinked/dangling arrays are illustrative SAMPLES — the
      // `*Total` counts carry the real magnitude (and a tending audit reads
      // only those). So the orientation default is a small sample (8), not 25:
      // a driven-machine probe measured this read as its top sink, streaming
      // ~24 dangling rows (each a spelled-out reason) when the signal was three
      // integers plus a couple of examples. A caller who wants the fuller list
      // passes an explicit `limit`.
      return state.attention(scope, {
        staleMs: input?.staleMs,
        limit: input?.limit ?? 8,
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
      // ADR-0086 Inc 4: the dispatch's participant key resolves ITS OWN posture
      // first — a `_posture/<participant>` fact — so a fanned-out specialist
      // reads through its task's lens without hijacking the session token's
      // standing posture. The finer key wins; the token posture is the fallback.
      const posture =
        (await participantPosture(build(ctx).store, ctx.identity.user, ctx.identity.participant)) ??
        principalPosture(ctx.identity);
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
            tags: merged.tags,
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

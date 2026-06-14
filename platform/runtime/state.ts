/**
 * Observed state — the substrate primitive.
 *
 * The platform can already spin up *organs* (isolated `forge` cells: bounded,
 * serialized execution). What it has lacked is the monotonic **substrate** those
 * organs are meant to live in: shared state that is *observed*, not merely
 * stored. This module is the first brick of it. See `docs/substrate.md` and the
 * sync design corpus it draws on (`the-substrate-thesis`, `sigma-calculus`,
 * `what-becomes-true`, `adaptive-salience`).
 *
 * The model, faithfully:
 *   - Every datum is a **fact** at a located key `(scope, key)` — the Σ-calculus
 *     `Loc`. Authority is the `scope`; provenance is server-stamped, never
 *     client-supplied.
 *   - Every entry is **wrapped**: `{ value, _meta }`, where `_meta` carries
 *     provenance and dynamics (revision, seq, writer, writers, timestamps) and,
 *     computed at read time, **salience** (score, velocity).
 *   - **Facts over events.** The current fact is reality; a trajectory log is
 *     kept only so salience can be computed — "the projection is reality, the log
 *     is implementation."
 *   - **Supersede, don't delete.** Knowledge accretes; an entry is retired by
 *     pointing it at its successor, never erased.
 *   - **Reads are shaped by salience** into Focus / Peripheral / Elided tiers, so
 *     a person or an agent gets the slice that matters with a `_shaping` summary.
 *
 * The substrate-gap primitives (see `docs/substrate-gaps.md` and
 * `docs/substrate-storage.md`) live here too:
 *   - **Indexable attributes** — `type` + `tags` are first-class on a fact, so
 *     `query` can project a slice without recall-all.
 *   - **Conditional writes (CAS)** — `ifRevision`/`ifAbsent` make multi-writer
 *     coordination safe (a failed precondition throws, mapping to a 409).
 *   - **Links** — first-class typed edges with an inbound index; `neighbors`
 *     traverses them, `supersede` can migrate them to a successor.
 *   - **Change feed** — `changes(sinceSeq)` tails the trajectory.
 *   - **Attention** — a derived "what needs tending" read (stale / unlinked /
 *     dangling), composing the above. The just-in-time cron, as a read.
 *
 * Storage-agnostic: the semantics live here; a `StateStore` is injected (an
 * in-memory one ships for tests/local, a DynamoDB-backed one for production,
 * mirroring how the `auth` cell separates `AuthStore` from its backends).
 */
import type { Identity } from './auth';

// ── wrapped entry (the read-facing shape) ──────────────────────────

export interface EntryMeta {
  /** Monotonic per-(scope,key) write count. */
  revision: number;
  /** Monotonic per-scope sequence of the last write — the trajectory ordinal. */
  seq: number;
  /** The principal who last wrote (server-stamped from identity). */
  writer: string | null;
  /** Optional label for *how* it was written (e.g. an action/command name). */
  via: string | null;
  /** When the key first came into being. */
  createdAt: string;
  /** When it was last written. */
  updatedAt: string;
  /** Distinct principals who have ever written it. */
  writers: string[];
  /** True once retired (hidden from default reads); a fresh write revives it. */
  superseded: boolean;
  /** Successor key when retired *toward* one, else null. */
  supersededBy: string | null;
  /** Optional fact type (indexable; e.g. "decision", "todo"). */
  type: string | null;
  /** Optional tags (filterable in `query`). */
  tags: string[];
  /** The fact's timer (lease/reveal), when set. Liveness is computed at read. */
  timer: { expiresAt: string; effect: 'delete' | 'enable' } | null;
  /** Salience score in [0,1], computed at read time from the trajectory. */
  score: number;
  /** Recent write rate (writes per minute over the salience window). */
  velocity: number;
  /** Cumulative earned importance in [0,1] (saturating log of lifetime reads+writes). */
  standing: number;
  /** Structural importance in [0,1] (saturating graph degree). */
  centrality: number;
  /** True when the value was withheld because the entry fell below the tier. */
  elided: boolean;
}

export interface Entry<V = unknown> {
  /** The stored value, or `null` when elided by salience shaping. */
  value: V | null;
  _meta: EntryMeta;
}

export type Tier = 'focus' | 'peripheral' | 'elided';

export interface ShapingSummary {
  focusThreshold: number;
  elideThreshold: number;
  elision: 'auto' | 'none';
  /** The salience lens this read was computed under, when not the default. */
  lens?: SalienceLens;
  counts: { focus: number; peripheral: number; elided: number; total: number };
}

/**
 * The compact form an elided entry takes in a shaped read. Elision exists to
 * protect a bounded observer's attention; shipping a full `_meta` envelope per
 * hidden fact defeats that, so below the elide threshold an entry collapses to
 * this stub. `expand: [key]` (or `peek`) pulls the full entry back.
 */
export interface ElidedStub {
  key: string;
  type: string | null;
  score: number;
}

export interface ReadResult {
  entries: Record<string, Entry>;
  /** Stubs for entries withheld by elision (score-descending). Absent when nothing was elided. */
  elided?: ElidedStub[];
  _shaping: ShapingSummary;
}

/** Thrown when an `ifRevision`/`ifAbsent` precondition does not hold (→ 409). */
export class StatePreconditionError extends Error {
  readonly code = 'precondition_failed';
  constructor(message: string) {
    super(`precondition_failed: ${message}`);
    this.name = 'StatePreconditionError';
  }
}

// ── per-entry timers (sync's lease/visibility primitive) ──────────

/**
 * A fact timer, evaluated **lazily at read** — no scheduler (sync's model).
 *
 *   - `effect: 'delete'` — the fact is live now and *vanishes* at expiry. This
 *     is the lease / visibility-timeout: a claim that auto-disappears so the
 *     work reappears. (The only deliberate exception to "nothing is lost" —
 *     a timer declares the fact ephemeral; DynamoDB TTL eventually GCs it.)
 *   - `effect: 'enable'` — the fact is *dormant* until expiry, then live
 *     (scheduled reveal / cooldown release).
 */
export interface FactTimer {
  /** Relative expiry in ms from the write. */
  ms?: number;
  /** Absolute ISO expiry. Exactly one of `ms`/`at` is required. */
  at?: string;
  effect: 'delete' | 'enable';
}

/** Is a record live right now, per its timer? (No timer = live.) */
export function isTimerLive(rec: Pick<StateRecord, 'timerExpiresAt' | 'timerEffect'>, nowMs: number): boolean {
  if (!rec.timerExpiresAt || !rec.timerEffect) return true;
  const expired = nowMs >= Date.parse(rec.timerExpiresAt);
  return rec.timerEffect === 'delete' ? !expired : expired;
}

function resolveTimer(timer: FactTimer, nowMs: number): { expiresAt: string; effect: 'delete' | 'enable' } {
  const hasMs = typeof timer.ms === 'number';
  const hasAt = typeof timer.at === 'string';
  if (hasMs === hasAt) throw new Error('timer requires exactly one of `ms` or `at`');
  if (timer.effect !== 'delete' && timer.effect !== 'enable') throw new Error('timer.effect must be "delete" or "enable"');
  let expiresMs: number;
  if (hasMs) {
    if (!Number.isFinite(timer.ms) || (timer.ms as number) <= 0) throw new Error('timer.ms must be a positive number');
    expiresMs = nowMs + (timer.ms as number);
  } else {
    expiresMs = Date.parse(timer.at as string);
    if (Number.isNaN(expiresMs)) throw new Error('timer.at must be an ISO timestamp');
  }
  return { expiresAt: new Date(expiresMs).toISOString(), effect: timer.effect };
}

// ── storage contract (injected) ────────────────────────────────────

export interface StateRecord {
  scope: string;
  key: string;
  value: unknown;
  revision: number;
  /** seq of the last write. */
  seq: number;
  /** seq of the first write (createdAt ordinal). */
  firstSeq: number;
  writer: string | null;
  via: string | null;
  createdAt: string;
  updatedAt: string;
  writers: string[];
  superseded: boolean;
  supersededBy: string | null;
  type: string | null;
  tags: string[];
  /** ISO expiry when a timer is set, else null. Liveness is computed at read. */
  timerExpiresAt: string | null;
  timerEffect: 'delete' | 'enable' | null;
}

/** A typed, directed edge between two located keys within one scope. */
export interface EdgeRecord {
  scope: string;
  from: string;
  rel: string;
  to: string;
  strength: number | null;
  createdAt: string;
  writer: string | null;
}

export interface TrajectoryEvent {
  op: 'read' | 'write' | 'supersede' | 'link' | 'unlink';
  scope: string;
  key: string | null;
  at: string;
  seq: number;
}

/**
 * Store-level optimistic guard: assert the *physical* item is unchanged since
 * it was read (`expectRevision: null` = the item must not exist). The
 * semantic CAS (`ifRevision`/`ifAbsent` against the *live* view, timers
 * considered) is evaluated in the primitive; this guard closes the race
 * window atomically at the storage layer.
 */
export interface PutGuard {
  expectRevision: number | null;
}

export interface StateStore {
  /** Allocate the next monotonic sequence number for a scope. */
  nextSeq(scope: string): Promise<number>;
  /** The current head of a scope's sequence, without advancing it. */
  currentSeq(scope: string): Promise<number>;
  get(scope: string, key: string): Promise<StateRecord | null>;
  /**
   * Persist a record. When `guard` is given the write is atomic on the stored
   * item's revision (DynamoDB `ConditionExpression`); a failed guard throws
   * `StatePreconditionError`.
   */
  put(record: StateRecord, guard?: PutGuard): Promise<void>;
  list(scope: string): Promise<StateRecord[]>;
  /** Records of a given indexable `type` within a scope (GSI-backed in prod). */
  listByType(scope: string, type: string): Promise<StateRecord[]>;
  putEdge(edge: EdgeRecord): Promise<void>;
  deleteEdge(scope: string, from: string, rel: string, to: string): Promise<void>;
  /** Outbound edges of `from` (optionally one `rel`). */
  edgesFrom(scope: string, from: string, rel?: string): Promise<EdgeRecord[]>;
  /** Inbound edges of `to` (optionally one `rel`) — the inbound index. */
  edgesTo(scope: string, to: string, rel?: string): Promise<EdgeRecord[]>;
  /** Every edge in a scope (bounded; used by the derived attention view). */
  listEdges(scope: string): Promise<EdgeRecord[]>;
  appendTrajectory(event: TrajectoryEvent): Promise<void>;
  /** Trajectory events for a scope at or after `sinceMs` (epoch ms). */
  recentTrajectory(scope: string, sinceMs: number): Promise<TrajectoryEvent[]>;
}

// ── salience ───────────────────────────────────────────────────────

export interface SalienceOptions {
  /** Recency half-life (ms). Older writes decay toward 0. Default 7d — a
   *  personal-workspace cadence, where a week-old note can still matter (the
   *  earlier 1h default decayed everything idle to ~0 within hours). */
  halfLifeMs?: number;
  /** Window for counting recent reads/writes (ms) — the velocity/attention burst
   *  window. Default 1h. */
  windowMs?: number;
  /** Writes-in-window that saturate the velocity term. Default 5. */
  velocitySaturation?: number;
  /** Reads-in-window that saturate the attention term. Default 5. */
  attentionSaturation?: number;
  /** Lifetime reads+writes at which the cumulative `standing` term saturates
   *  (log-compressed, so it can't run away the way the legacy unbounded score
   *  did). Default 20 — tuned to personal scale: a "well-attended" fact is ~15–20
   *  touches, not 50 (a tending-audit calibration over the live corpus, which is
   *  read-light; 50 was too coarse to register accruing attention). */
  standingSaturation?: number;
  /** Graph degree at which the `centrality` term saturates. Default 5 — at personal
   *  scale, being linked at all is signal (1 edge → 0.2). */
  centralitySaturation?: number;
  /** Score-term weights (should sum to ≤1 so the score stays in [0,1] and the
   *  thresholds keep their meaning). Defaults: recency .45, velocity .10,
   *  attention .15, standing .20, centrality .10 — velocity (recent writes) is a
   *  rare, bursty signal already mostly captured by recency, so its weight goes
   *  to attention (reads), the signal a used workspace actually accrues. */
  recencyWeight?: number;
  velocityWeight?: number;
  attentionWeight?: number;
  standingWeight?: number;
  centralityWeight?: number;
  /** Score at/above which an entry is Focus (full value + meta). Default 0.5. */
  focusThreshold?: number;
  /** Score below which an entry is Elided (value withheld). Default 0.1. */
  elideThreshold?: number;
}

interface ResolvedSalience extends Required<SalienceOptions> {}

function resolveSalience(o?: SalienceOptions): ResolvedSalience {
  return {
    halfLifeMs: o?.halfLifeMs ?? 7 * 24 * 60 * 60 * 1000,
    windowMs: o?.windowMs ?? 60 * 60 * 1000,
    velocitySaturation: o?.velocitySaturation ?? 5,
    attentionSaturation: o?.attentionSaturation ?? 5,
    standingSaturation: o?.standingSaturation ?? 20,
    centralitySaturation: o?.centralitySaturation ?? 5,
    recencyWeight: o?.recencyWeight ?? 0.45,
    velocityWeight: o?.velocityWeight ?? 0.1,
    attentionWeight: o?.attentionWeight ?? 0.15,
    standingWeight: o?.standingWeight ?? 0.2,
    centralityWeight: o?.centralityWeight ?? 0.1,
    focusThreshold: o?.focusThreshold ?? 0.5,
    elideThreshold: o?.elideThreshold ?? 0.1,
  };
}

/**
 * Named salience lenses — ergonomic per-read biases over the tuned defaults, for
 * the common "I want a particular view" cases. Each preset's weights sum to 1 so
 * the score stays in [0,1] and the elision tiers keep their meaning. For precise
 * control, pass a raw `salience: Partial<SalienceOptions>` instead (or as well —
 * a raw override merges on top of the preset). Lensing recomputes the score, so
 * it shifts BOTH the ranking and the focus/peripheral/elided tiers consistently —
 * unlike `rankBy`, which only reorders an already-scored set.
 */
export type SalienceLens = 'salience' | 'recent' | 'connected' | 'durable' | 'active';

const LENS_PRESETS: Record<SalienceLens, Partial<SalienceOptions>> = {
  salience: {},
  // Freshness: shorter half-life + heavier recency.
  recent: {
    halfLifeMs: 24 * 60 * 60 * 1000,
    recencyWeight: 0.6,
    velocityWeight: 0.15,
    attentionWeight: 0.1,
    standingWeight: 0.1,
    centralityWeight: 0.05,
  },
  // Graph structure: what's well-connected.
  connected: { recencyWeight: 0.25, velocityWeight: 0.05, attentionWeight: 0.1, standingWeight: 0.2, centralityWeight: 0.4 },
  // Earned, cumulative importance — survives idleness.
  durable: { recencyWeight: 0.2, velocityWeight: 0.05, attentionWeight: 0.1, standingWeight: 0.5, centralityWeight: 0.15 },
  // What's being touched now (reads + writes in-window).
  active: { recencyWeight: 0.3, velocityWeight: 0.25, attentionWeight: 0.25, standingWeight: 0.1, centralityWeight: 0.1 },
};

/** Resolve the salience params for one call: instance defaults ← lens preset ←
 *  raw override. Returns the base unchanged when neither is set. A raw override
 *  is NOT auto-normalized (it's an escape hatch — the caller owns the weights). */
function callSalience(base: ResolvedSalience, lens?: SalienceLens, override?: Partial<SalienceOptions>): ResolvedSalience {
  if (!lens && !override) return base;
  return resolveSalience({ ...base, ...(lens ? LENS_PRESETS[lens] : {}), ...override });
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Salience figures are signals, not measurements — 4 decimals is already generous. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Per-key salience inputs, derived from the trajectory + edges in one pass. */
export interface KeySignals {
  /** Reads within the salience window (velocity/attention burst window). */
  windowReads: number;
  /** Non-read ops (write/supersede/link/unlink) within the window. */
  windowWrites: number;
  /** Lifetime read ops (cumulative — drives `standing`). */
  lifetimeReads: number;
  /** Lifetime non-read ops (cumulative — drives `standing`). */
  lifetimeWrites: number;
  /** Graph degree (in + out edges — drives `centrality`). */
  degree: number;
}

const EMPTY_SIGNALS: KeySignals = { windowReads: 0, windowWrites: 0, lifetimeReads: 0, lifetimeWrites: 0, degree: 0 };

/** Per-key term breakdown, for `_meta` instrumentation (Q4: measure, don't assert). */
export interface ScoreParts {
  score: number;
  recency: number;
  velocity: number;
  attention: number;
  standing: number;
  centrality: number;
}

/**
 * Salience score in [0,1] — a weighted blend of five computed signals (never
 * configured per fact):
 *   - **recency**: exponential decay since last write (default 7d half-life);
 *   - **velocity**: recent writes (burst window);
 *   - **attention**: recent reads (burst window);
 *   - **standing**: cumulative earned importance — saturating log of lifetime
 *     reads+writes, so an old-but-loved fact keeps a floor (and a hub can't run
 *     away unbounded the way the legacy additive score did);
 *   - **centrality**: structural importance from graph degree, saturating.
 * Recency leads but no longer dominates: standing + centrality give idle-yet-
 * important facts (and a freshly-ported corpus) a non-zero floor above elision.
 */
export function computeScore(
  args: { updatedAtMs: number; nowMs: number } & Partial<KeySignals>,
  s: ResolvedSalience,
): number {
  return scoreParts(args, s).score;
}

/** `computeScore` with the term breakdown exposed (for `_meta` + tuning). */
export function scoreParts(
  args: { updatedAtMs: number; nowMs: number } & Partial<KeySignals>,
  s: ResolvedSalience,
): ScoreParts {
  const age = Math.max(0, args.nowMs - args.updatedAtMs);
  const recency = Math.pow(2, -age / s.halfLifeMs);
  const velocity = Math.min((args.windowWrites ?? 0) / s.velocitySaturation, 1);
  const attention = Math.min((args.windowReads ?? 0) / s.attentionSaturation, 1);
  const lifetime = (args.lifetimeReads ?? 0) + (args.lifetimeWrites ?? 0);
  // log1p compression: each additional touch matters less; saturates at the
  // configured lifetime total. lifetime 0 → 0, lifetime == standingSaturation → 1.
  const standing = s.standingSaturation > 0 ? Math.min(Math.log1p(lifetime) / Math.log1p(s.standingSaturation), 1) : 0;
  const centrality = s.centralitySaturation > 0 ? Math.min((args.degree ?? 0) / s.centralitySaturation, 1) : 0;
  const score = clamp01(
    s.recencyWeight * recency +
      s.velocityWeight * velocity +
      s.attentionWeight * attention +
      s.standingWeight * standing +
      s.centralityWeight * centrality,
  );
  return { score, recency, velocity, attention, standing, centrality };
}

/** Fold a scope's trajectory + edges into per-key salience signals in one pass. */
export function buildSignals(
  events: TrajectoryEvent[],
  edges: EdgeRecord[],
  nowMs: number,
  windowMs: number,
): Map<string, KeySignals> {
  const m = new Map<string, KeySignals>();
  const sig = (k: string): KeySignals => {
    let v = m.get(k);
    if (!v) {
      v = { windowReads: 0, windowWrites: 0, lifetimeReads: 0, lifetimeWrites: 0, degree: 0 };
      m.set(k, v);
    }
    return v;
  };
  const windowStart = nowMs - windowMs;
  for (const e of events) {
    if (!e.key) continue; // scope-level reads (key=null) aren't per-fact attention
    const v = sig(e.key);
    const inWindow = Date.parse(e.at) >= windowStart;
    if (e.op === 'read') {
      v.lifetimeReads++;
      if (inWindow) v.windowReads++;
    } else {
      v.lifetimeWrites++;
      if (inWindow) v.windowWrites++;
    }
  }
  for (const ed of edges) {
    sig(ed.from).degree++;
    if (ed.to !== ed.from) sig(ed.to).degree++;
  }
  return m;
}

function tierFor(score: number, s: ResolvedSalience): Tier {
  if (score >= s.focusThreshold) return 'focus';
  if (score >= s.elideThreshold) return 'peripheral';
  return 'elided';
}

// ── the observed-state API ─────────────────────────────────────────

export interface WriteInput {
  scope: string;
  key: string;
  value: unknown;
  /** Optional label for how the write happened (e.g. an action name). */
  via?: string;
  /** Optional indexable fact type. */
  type?: string;
  /** Optional tags. */
  tags?: string[];
  /** CAS: require the stored revision to equal this (0 = must not exist). */
  ifRevision?: number;
  /** CAS: require the key not to exist. */
  ifAbsent?: boolean;
  /**
   * Lease/reveal timer, evaluated at read: `effect:'delete'` = live now,
   * vanishes at expiry (a lease); `effect:'enable'` = dormant until expiry.
   * CAS treats an expired-delete fact as absent — the crash-safe claim.
   */
  timer?: FactTimer;
}

export interface ReadOptions {
  /** `none` disables elision (everything returns its value). Default `auto`. */
  elision?: 'auto' | 'none';
  /** Keys to force to the Focus tier regardless of score. */
  expand?: string[];
  /** Include superseded entries (excluded by default). */
  includeSuperseded?: boolean;
  /** Per-read threshold overrides. */
  focusThreshold?: number;
  elideThreshold?: number;
  /** Bias salience for this read via a named lens (recent/connected/durable/active). */
  lens?: SalienceLens;
  /** Precise per-read salience override (merges over the lens + instance defaults). */
  salience?: Partial<SalienceOptions>;
}

export interface QueryOptions {
  /** Only facts of this indexable type (GSI-served in production). */
  type?: string;
  /** Only facts carrying this tag. */
  tag?: string;
  /** Only keys with this prefix. */
  prefix?: string;
  /** Ranking: read-time salience (default) or last-write recency. */
  rankBy?: 'salience' | 'recency';
  /** Bias salience for this query via a named lens (recent/connected/durable/active). */
  lens?: SalienceLens;
  /** Precise per-query salience override (merges over the lens + instance defaults). */
  salience?: Partial<SalienceOptions>;
  limit?: number;
  /**
   * Resume token from a previous page's `nextCursor`. Pages are computed over
   * a fresh ranking, so a cursor is a best-effort resume, not a snapshot.
   */
  cursor?: string;
  includeSuperseded?: boolean;
}

export interface QueryResult {
  /** Ranked, keyed entries (full values — query is a projection, not a shaping). */
  entries: Array<{ key: string } & Entry>;
  /** Entries in this page. */
  count: number;
  /** Entries matching the filters overall. */
  total: number;
  /** Present when more pages remain; pass back as `cursor`. */
  nextCursor?: string;
}

export interface NeighborsOptions {
  dir?: 'in' | 'out' | 'both';
  rel?: string;
}

export interface NeighborsResult {
  outbound: EdgeRecord[];
  inbound: EdgeRecord[];
  /** Wrapped entries for every distinct neighbor key that exists. */
  entries: Record<string, Entry>;
}

export interface ChangesResult {
  events: TrajectoryEvent[];
  /** The scope's current sequence head (resume from here next time). */
  seq: number;
}

/**
 * A written edge plus existence hints for its endpoints, so a caller learns at
 * write time — not at the next tending pass — that it just created a dangling
 * edge. Dangling edges are allowed (surfaced, not blocked); the hint is free.
 */
export interface LinkResult extends EdgeRecord {
  /** The `from` key currently resolves to a live, unretired fact. */
  fromExists: boolean;
  /** The `to` key currently resolves to a live, unretired fact. */
  toExists: boolean;
}

export interface AttentionOptions {
  /** Age (ms) beyond which a live fact counts as stale. Default 14 days. */
  staleMs?: number;
  limit?: number;
  /**
   * Also surface `_`-prefixed system namespaces (`_canvas/`, `_actions/`, …).
   * Default false: tending is about knowledge health, not surface plumbing.
   */
  includeSystem?: boolean;
}

export interface AttentionResult {
  /** Live facts not written for `staleMs` (oldest first). */
  stale: Array<{ key: string; updatedAt: string; type: string | null }>;
  /** Live facts with no edges in either direction. */
  unlinked: string[];
  /** Edges whose endpoints are missing or retired without a successor. */
  dangling: Array<{ from: string; rel: string; to: string; reason: string }>;
}

export interface SupersedeOptions {
  /** Re-point the fact's edges at the successor (requires `by`). */
  migrateLinks?: boolean;
}

export interface ObservedState {
  put(input: WriteInput, identity?: Identity): Promise<Entry>;
  get(scope: string, key: string, identity?: Identity): Promise<Entry | null>;
  read(scope: string, opts?: ReadOptions, identity?: Identity): Promise<ReadResult>;
  /**
   * Apply salience tiering + elision to an already-scored set of entries. Lets a
   * caller assemble a view from several scopes (e.g. own slice + granted subsets)
   * and shape the whole thing *once*. Pure: does not mutate its input.
   */
  shape(entries: Record<string, Entry>, opts?: ReadOptions): ReadResult;
  /** Projection over the slice: filter by type/tag/prefix, rank, limit. */
  query(scope: string, opts?: QueryOptions, identity?: Identity): Promise<QueryResult>;
  /** Add a typed, directed edge `from --rel--> to` within the scope. */
  link(scope: string, from: string, rel: string, to: string, strength: number | null, identity?: Identity): Promise<LinkResult>;
  unlink(scope: string, from: string, rel: string, to: string, identity?: Identity): Promise<{ ok: true }>;
  /** Edges (and neighbor entries) around a key. */
  neighbors(scope: string, key: string, opts?: NeighborsOptions, identity?: Identity): Promise<NeighborsResult>;
  /** Every edge in the scope (bounded; boards project their edges from this). */
  edges(scope: string): Promise<EdgeRecord[]>;
  /** Tail the trajectory from a sequence number — the change feed. `'head'` returns just the current seq (no events), so tailing starts in one call. */
  changes(scope: string, sinceSeq: number | 'head', limit?: number): Promise<ChangesResult>;
  /** Derived maintenance view — the just-in-time cron, as a read. */
  attention(scope: string, opts?: AttentionOptions): Promise<AttentionResult>;
  /** Retire `key` by pointing it at successor `by` (or just marking it). */
  supersede(scope: string, key: string, by: string | null, identity?: Identity, opts?: SupersedeOptions): Promise<Entry | null>;
}

/** Edge fields are embedded in sort keys with `|`; keep it out of the parts. */
const EDGE_DELIM = '|';
function assertEdgePart(label: string, v: string): void {
  if (!v) throw new Error(`link requires a non-empty \`${label}\``);
  if (v.includes(EDGE_DELIM)) throw new Error(`\`${label}\` must not contain "${EDGE_DELIM}"`);
}

export function createObservedState(store: StateStore, salience?: SalienceOptions): ObservedState {
  const s = resolveSalience(salience);

  /** Build per-key salience signals for a whole scope (one trajectory + edge
   *  pass). Lifetime (cumulative) terms need the full trajectory, so this reads
   *  from seq 0 — the price of `standing`. Callers in bulk paths build it once
   *  and share it across `wrap`s. */
  async function signalsFor(scope: string, nowMs: number, windowMs: number): Promise<Map<string, KeySignals>> {
    const [events, edges] = await Promise.all([store.recentTrajectory(scope, 0), store.listEdges(scope)]);
    return buildSignals(events, edges, nowMs, windowMs);
  }

  /** Wrap a stored record into a read-facing entry with a computed score. Pass a
   *  precomputed `signals` map (bulk paths) to avoid a per-record scope scan, and
   *  `sCall` to score under a per-read lens (defaults to the instance settings). */
  async function wrap(rec: StateRecord, nowMs: number, signals?: Map<string, KeySignals>, sCall: ResolvedSalience = s): Promise<Entry> {
    const sig = (signals ?? (await signalsFor(rec.scope, nowMs, sCall.windowMs))).get(rec.key) ?? EMPTY_SIGNALS;
    const parts = scoreParts({ updatedAtMs: Date.parse(rec.updatedAt), nowMs, ...sig }, sCall);
    const windowMin = sCall.windowMs / 60000;
    return {
      value: rec.value,
      _meta: {
        revision: rec.revision,
        seq: rec.seq,
        writer: rec.writer,
        via: rec.via,
        createdAt: rec.createdAt,
        updatedAt: rec.updatedAt,
        writers: rec.writers,
        superseded: rec.superseded,
        supersededBy: rec.supersededBy,
        type: rec.type,
        tags: rec.tags,
        timer:
          rec.timerExpiresAt && rec.timerEffect ? { expiresAt: rec.timerExpiresAt, effect: rec.timerEffect } : null,
        score: round4(parts.score),
        velocity: round4(windowMin > 0 ? sig.windowWrites / windowMin : 0),
        standing: round4(parts.standing),
        centrality: round4(parts.centrality),
        elided: false,
      },
    };
  }

  /** Pure salience shaping over an already-scored set (own + granted, merged). */
  function shapeEntries(entries: Record<string, Entry>, opts?: ReadOptions, sCall: ResolvedSalience = s): ReadResult {
    const elision = opts?.elision ?? 'auto';
    const focusThreshold = opts?.focusThreshold ?? sCall.focusThreshold;
    const elideThreshold = opts?.elideThreshold ?? sCall.elideThreshold;
    const expand = new Set(opts?.expand ?? []);
    const out: Record<string, Entry> = {};
    const stubs: ElidedStub[] = [];
    const counts = { focus: 0, peripheral: 0, elided: 0, total: 0 };
    for (const [key, src] of Object.entries(entries)) {
      let tier = tierFor(src._meta.score, { ...sCall, focusThreshold, elideThreshold });
      if (expand.has(key)) tier = 'focus';
      counts[tier]++;
      counts.total++;
      if (tier === 'elided' && elision === 'auto') {
        // Below the threshold the *entry* is withheld, not just its value — a
        // shaped read must cost attention proportional to what it surfaces.
        stubs.push({ key, type: src._meta.type, score: src._meta.score });
        continue;
      }
      out[key] = { value: src.value, _meta: { ...src._meta, elided: false } };
    }
    stubs.sort((a, b) => b.score - a.score);
    return {
      entries: out,
      ...(stubs.length ? { elided: stubs } : {}),
      _shaping: { focusThreshold, elideThreshold, elision, ...(opts?.lens ? { lens: opts.lens } : {}), counts },
    };
  }

  return {
    async put(input: WriteInput, identity?: Identity): Promise<Entry> {
      if (!input?.scope || !input?.key) throw new Error('state.put requires `scope` and `key`');
      const writer = identity?.user ?? null;
      const now = new Date();
      const nowMs = now.getTime();
      const nowIso = now.toISOString();
      const prev = await store.get(input.scope, input.key);
      // CAS sees the *live* view: an expired-delete fact counts as absent
      // (that lapse is exactly what makes a lease claim crash-safe).
      const livePrev = prev && isTimerLive(prev, nowMs) ? prev : null;

      // CAS: fail fast on what we just read; the store's revision guard
      // closes the remaining race window atomically.
      const hasCas = input.ifRevision !== undefined || !!input.ifAbsent;
      if (hasCas) {
        if (input.ifAbsent && livePrev) {
          throw new StatePreconditionError(`"${input.key}" already exists (revision ${livePrev.revision})`);
        }
        if (input.ifRevision !== undefined && (livePrev?.revision ?? 0) !== input.ifRevision) {
          throw new StatePreconditionError(
            `"${input.key}" is at revision ${livePrev?.revision ?? 0}, expected ${input.ifRevision}`,
          );
        }
      }

      const timer = input.timer ? resolveTimer(input.timer, nowMs) : null;
      const seq = await store.nextSeq(input.scope);
      const writers = prev
        ? writer && !prev.writers.includes(writer)
          ? [...prev.writers, writer]
          : prev.writers
        : writer
          ? [writer]
          : [];
      const record: StateRecord = {
        scope: input.scope,
        key: input.key,
        value: input.value,
        // physical continuity even across a lapsed lease — monotonic always
        revision: (prev?.revision ?? 0) + 1,
        seq,
        firstSeq: prev?.firstSeq ?? seq,
        writer,
        via: input.via ?? null,
        createdAt: prev?.createdAt ?? nowIso,
        updatedAt: nowIso,
        writers,
        // a fresh write to a superseded key revives it
        superseded: false,
        supersededBy: null,
        // omitting type/tags on a rewrite preserves what is already stored
        type: input.type !== undefined ? input.type : (prev?.type ?? null),
        tags: input.tags !== undefined ? input.tags : (prev?.tags ?? []),
        timerExpiresAt: timer?.expiresAt ?? null,
        timerEffect: timer?.effect ?? null,
      };
      await store.put(record, hasCas ? { expectRevision: prev?.revision ?? null } : undefined);
      await store.appendTrajectory({ op: 'write', scope: input.scope, key: input.key, at: nowIso, seq });
      return wrap(record, nowMs);
    },

    async get(scope: string, key: string, _identity?: Identity): Promise<Entry | null> {
      const rec = await store.get(scope, key);
      const now = new Date();
      if (!rec || !isTimerLive(rec, now.getTime())) return null;
      const seq = await store.nextSeq(scope);
      await store.appendTrajectory({ op: 'read', scope, key, at: now.toISOString(), seq });
      return wrap(rec, now.getTime());
    },

    shape(entries: Record<string, Entry>, opts?: ReadOptions): ReadResult {
      // Re-tiers an already-scored set, so a lens here only adjusts thresholds
      // (it can't recompute scores without the scope's signals).
      return shapeEntries(entries, opts, callSalience(s, opts?.lens, opts?.salience));
    },

    async read(scope: string, opts?: ReadOptions, _identity?: Identity): Promise<ReadResult> {
      const nowMs = Date.now();
      const sCall = callSalience(s, opts?.lens, opts?.salience);
      const records = await store.list(scope);
      const signals = await signalsFor(scope, nowMs, sCall.windowMs);

      // Score every live entry (no elision yet); shape in one pass below.
      const scored: Record<string, Entry> = {};
      for (const rec of records) {
        if (rec.superseded && !opts?.includeSuperseded) continue;
        if (!isTimerLive(rec, nowMs)) continue;
        scored[rec.key] = await wrap(rec, nowMs, signals, sCall);
      }

      // Reading the scope is itself attention on every surfaced key.
      const seq = await store.nextSeq(scope);
      await store.appendTrajectory({ op: 'read', scope, key: null, at: new Date(nowMs).toISOString(), seq });

      return shapeEntries(scored, opts, sCall);
    },

    async query(scope: string, opts?: QueryOptions, _identity?: Identity): Promise<QueryResult> {
      const nowMs = Date.now();
      const sCall = callSalience(s, opts?.lens, opts?.salience);
      // Type is index-served; tag/prefix filter the (bounded) candidate set.
      const records = opts?.type ? await store.listByType(scope, opts.type) : await store.list(scope);
      const signals = await signalsFor(scope, nowMs, sCall.windowMs);
      const candidates = records.filter((rec) => {
        if (rec.superseded && !opts?.includeSuperseded) return false;
        if (!isTimerLive(rec, nowMs)) return false;
        if (opts?.tag && !rec.tags.includes(opts.tag)) return false;
        if (opts?.prefix && !rec.key.startsWith(opts.prefix)) return false;
        return true;
      });
      const wrapped = await Promise.all(candidates.map(async (rec) => ({ key: rec.key, ...(await wrap(rec, nowMs, signals, sCall)) })));
      const rankBy = opts?.rankBy ?? 'salience';
      wrapped.sort((a, b) =>
        rankBy === 'recency'
          ? Date.parse(b._meta.updatedAt) - Date.parse(a._meta.updatedAt)
          : b._meta.score - a._meta.score,
      );
      // Cursor = a plain offset into the fresh ranking: best-effort resume,
      // honest about salience reordering between pages (no snapshot to leak).
      const offset = opts?.cursor ? Math.max(0, Number.parseInt(opts.cursor, 10) || 0) : 0;
      const end = opts?.limit !== undefined ? offset + Math.max(0, opts.limit) : undefined;
      const page = wrapped.slice(offset, end);
      const consumed = offset + page.length;
      return {
        entries: page,
        count: page.length,
        total: wrapped.length,
        ...(consumed < wrapped.length && opts?.limit !== undefined ? { nextCursor: String(consumed) } : {}),
      };
    },

    async link(scope, from, rel, to, strength, identity?: Identity): Promise<LinkResult> {
      assertEdgePart('from', from);
      assertEdgePart('rel', rel);
      assertEdgePart('to', to);
      const now = new Date();
      const edge: EdgeRecord = {
        scope,
        from,
        rel,
        to,
        strength: strength ?? null,
        createdAt: now.toISOString(),
        writer: identity?.user ?? null,
      };
      await store.putEdge(edge);
      // Linking is attention on the source fact.
      const seq = await store.nextSeq(scope);
      await store.appendTrajectory({ op: 'link', scope, key: from, at: edge.createdAt, seq });
      // Endpoint hints: dangling edges stay allowed, but the writer should not
      // have to wait for a tending pass to learn it just made one.
      const resolves = async (key: string): Promise<boolean> => {
        const rec = await store.get(scope, key);
        return !!rec && isTimerLive(rec, now.getTime()) && !rec.superseded;
      };
      const [fromExists, toExists] = await Promise.all([resolves(from), resolves(to)]);
      return { ...edge, fromExists, toExists };
    },

    async unlink(scope, from, rel, to, _identity?: Identity): Promise<{ ok: true }> {
      assertEdgePart('from', from);
      assertEdgePart('rel', rel);
      assertEdgePart('to', to);
      await store.deleteEdge(scope, from, rel, to);
      const seq = await store.nextSeq(scope);
      await store.appendTrajectory({ op: 'unlink', scope, key: from, at: new Date().toISOString(), seq });
      return { ok: true };
    },

    async neighbors(scope, key, opts?, _identity?: Identity): Promise<NeighborsResult> {
      const dir = opts?.dir ?? 'both';
      const [outbound, inbound] = await Promise.all([
        dir !== 'in' ? store.edgesFrom(scope, key, opts?.rel) : Promise.resolve([]),
        dir !== 'out' ? store.edgesTo(scope, key, opts?.rel) : Promise.resolve([]),
      ]);
      const nowMs = Date.now();
      const signals = await signalsFor(scope, nowMs, s.windowMs);
      const neighborKeys = new Set<string>();
      for (const e of outbound) neighborKeys.add(e.to);
      for (const e of inbound) neighborKeys.add(e.from);
      neighborKeys.delete(key);
      const entries: Record<string, Entry> = {};
      for (const nk of neighborKeys) {
        const rec = await store.get(scope, nk);
        if (rec && isTimerLive(rec, nowMs)) entries[nk] = await wrap(rec, nowMs, signals);
      }
      return { outbound, inbound, entries };
    },

    async edges(scope): Promise<EdgeRecord[]> {
      return store.listEdges(scope);
    },

    async changes(scope, sinceSeq, limit?): Promise<ChangesResult> {
      const head = await store.currentSeq(scope);
      // 'head' = "where do I start tailing from?" — answered without paying
      // for (or wading through) the scope's whole recent history.
      if (sinceSeq === 'head') return { events: [], seq: head };
      // The trajectory is TTL-bounded, so the partition stays small; seq rises
      // with time, so time-ordered events are seq-ordered too.
      const events = (await store.recentTrajectory(scope, 0))
        .filter((e) => e.seq > sinceSeq)
        .sort((a, b) => a.seq - b.seq);
      const limited = limit !== undefined ? events.slice(0, Math.max(0, limit)) : events;
      return { events: limited, seq: head };
    },

    async attention(scope, opts?): Promise<AttentionResult> {
      const staleMs = opts?.staleMs ?? 14 * 24 * 60 * 60 * 1000;
      const limit = opts?.limit ?? 25;
      const nowMs = Date.now();
      // Tending is about knowledge health; `_` namespaces are surface plumbing
      // (canvas elements, declared vocabulary) and would drown the signal.
      const isSystem = (key: string): boolean => key.startsWith('_');
      const includeSystem = opts?.includeSystem ?? false;
      const [records, edges] = await Promise.all([store.list(scope), store.listEdges(scope)]);
      const byKey = new Map(records.map((r) => [r.key, r]));
      const linked = new Set<string>();
      for (const e of edges) {
        linked.add(e.from);
        linked.add(e.to);
      }
      const live = records.filter(
        (r) => !r.superseded && isTimerLive(r, nowMs) && (includeSystem || !isSystem(r.key)),
      );
      const stale = live
        .filter((r) => nowMs - Date.parse(r.updatedAt) > staleMs)
        .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
        .slice(0, limit)
        .map((r) => ({ key: r.key, updatedAt: r.updatedAt, type: r.type }));
      const unlinked = live
        .filter((r) => !linked.has(r.key))
        .map((r) => r.key)
        .slice(0, limit);
      const dangling: AttentionResult['dangling'] = [];
      for (const e of edges) {
        if (dangling.length >= limit) break;
        if (!includeSystem && (isSystem(e.from) || isSystem(e.to))) continue;
        for (const [end, k] of [['from', e.from], ['to', e.to]] as const) {
          const rec = byKey.get(k);
          if (!rec) dangling.push({ from: e.from, rel: e.rel, to: e.to, reason: `${end} "${k}" missing` });
          else if (rec.superseded && !rec.supersededBy)
            dangling.push({ from: e.from, rel: e.rel, to: e.to, reason: `${end} "${k}" retired without successor` });
        }
      }
      return { stale, unlinked, dangling };
    },

    async supersede(scope, key, by, identity?: Identity, opts?: SupersedeOptions): Promise<Entry | null> {
      const rec = await store.get(scope, key);
      if (!rec) return null;
      const now = new Date();
      const nowIso = now.toISOString();
      const seq = await store.nextSeq(scope);
      const updated: StateRecord = {
        ...rec,
        superseded: true,
        supersededBy: by,
        writer: identity?.user ?? rec.writer,
        updatedAt: nowIso,
        seq,
      };
      await store.put(updated);
      await store.appendTrajectory({ op: 'supersede', scope, key, at: nowIso, seq });

      // Carry the graph to the successor so retiring a fact doesn't rot it.
      if (opts?.migrateLinks && by) {
        const [outbound, inbound] = await Promise.all([store.edgesFrom(scope, key), store.edgesTo(scope, key)]);
        for (const e of outbound) {
          await store.deleteEdge(scope, e.from, e.rel, e.to);
          if (e.to !== by) await store.putEdge({ ...e, from: by });
        }
        for (const e of inbound) {
          await store.deleteEdge(scope, e.from, e.rel, e.to);
          if (e.from !== by) await store.putEdge({ ...e, to: by });
        }
      }
      return wrap(updated, now.getTime());
    },
  };
}

// ── in-memory store (tests / local; no AWS) ────────────────────────

export function createMemoryStateStore(): StateStore {
  const records = new Map<string, StateRecord>();
  const edges = new Map<string, EdgeRecord>();
  const trajectory: TrajectoryEvent[] = [];
  const seqByScope = new Map<string, number>();
  const k = (scope: string, key: string): string => `${scope} ${key}`;
  const ek = (scope: string, from: string, rel: string, to: string): string => `${scope} ${from}|${rel}|${to}`;

  return {
    async nextSeq(scope: string): Promise<number> {
      const next = (seqByScope.get(scope) ?? 0) + 1;
      seqByScope.set(scope, next);
      return next;
    },
    async currentSeq(scope: string): Promise<number> {
      return seqByScope.get(scope) ?? 0;
    },
    async get(scope: string, key: string): Promise<StateRecord | null> {
      const r = records.get(k(scope, key));
      return r ? { ...r, writers: [...r.writers], tags: [...r.tags] } : null;
    },
    async put(record: StateRecord, guard?: PutGuard): Promise<void> {
      if (guard) {
        const stored = records.get(k(record.scope, record.key));
        if ((stored?.revision ?? null) !== guard.expectRevision) {
          throw new StatePreconditionError(`"${record.key}" failed its write condition`);
        }
      }
      records.set(k(record.scope, record.key), { ...record, writers: [...record.writers], tags: [...record.tags] });
    },
    async list(scope: string): Promise<StateRecord[]> {
      return [...records.values()]
        .filter((r) => r.scope === scope)
        .map((r) => ({ ...r, writers: [...r.writers], tags: [...r.tags] }));
    },
    async listByType(scope: string, type: string): Promise<StateRecord[]> {
      return [...records.values()]
        .filter((r) => r.scope === scope && r.type === type)
        .map((r) => ({ ...r, writers: [...r.writers], tags: [...r.tags] }));
    },
    async putEdge(edge: EdgeRecord): Promise<void> {
      edges.set(ek(edge.scope, edge.from, edge.rel, edge.to), { ...edge });
    },
    async deleteEdge(scope, from, rel, to): Promise<void> {
      edges.delete(ek(scope, from, rel, to));
    },
    async edgesFrom(scope, from, rel?): Promise<EdgeRecord[]> {
      return [...edges.values()].filter((e) => e.scope === scope && e.from === from && (!rel || e.rel === rel)).map((e) => ({ ...e }));
    },
    async edgesTo(scope, to, rel?): Promise<EdgeRecord[]> {
      return [...edges.values()].filter((e) => e.scope === scope && e.to === to && (!rel || e.rel === rel)).map((e) => ({ ...e }));
    },
    async listEdges(scope): Promise<EdgeRecord[]> {
      return [...edges.values()].filter((e) => e.scope === scope).map((e) => ({ ...e }));
    },
    async appendTrajectory(event: TrajectoryEvent): Promise<void> {
      trajectory.push({ ...event });
    },
    async recentTrajectory(scope: string, sinceMs: number): Promise<TrajectoryEvent[]> {
      return trajectory.filter((e) => e.scope === scope && Date.parse(e.at) >= sinceMs);
    },
  };
}

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
import { resolveType, type Type } from './type-schema';
import { layer } from './resolution';
import { matchesSelector } from './selector';

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
  /** Full salience breakdown, attached only when a read sets `explain` — the
   *  score stage made inspectable for tuning (which signal, at which weight,
   *  contributed what). Absent on normal reads. */
  explain?: ScoreExplain;
}

/** The score stage made legible: each normalized signal, the weight it was
 *  blended by (resolved defaults ← config ← lens ← override), and its weighted
 *  contribution to the final score — so a tuner can see *why* a fact scored. */
export interface ScoreExplain {
  signals: { recency: number; velocity: number; attention: number; standing: number; centrality: number };
  weights: { recency: number; velocity: number; attention: number; standing: number; centrality: number };
  contribution: { recency: number; velocity: number; attention: number; standing: number; centrality: number };
  /** Raw inbound+outbound graph degree feeding centrality (pre-saturation). */
  degree: number;
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
  /**
   * Import priors: cumulative read/write counts carried in from a migrated corpus
   * (e.g. legacy `read_count`). Folded into `standing` at read time so a ported
   * fact arrives with its earned importance instead of cold. Absent for native
   * facts; never decays (it's a one-time floor on the cumulative term).
   */
  seedReads?: number;
  seedWrites?: number;
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
  /**
   * For inferred (`similarTo`) edges: the raw cosine similarity that produced the
   * edge (ADR-0032). Distinct from `strength` — `strength` stays fixed (0.3) so
   * `centrality` weighting is unchanged, while `score` ranks ratification
   * candidates by actual relevance. Absent on authored edges.
   */
  score?: number | null;
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
  /** All live+superseded fact records in a scope, or — with `keyPrefix` — only
   *  those whose key begins with it (a prefix-scoped partition read, e.g.
   *  `note:` / `_doc/<id>/`). The prefix is pushed to the store query so a cell
   *  reading a small namespace doesn't scan the whole slice (ADR-0042 Inc 1a). */
  list(scope: string, keyPrefix?: string): Promise<StateRecord[]>;
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
    // Re-tuned against the warm imported corpus (2026-06-15): at sw .20 the
    // default elided ~95 earned (multi-read) knowledge entries once they aged;
    // sw .30 / rw .35 keeps all standing≥0.3 knowledge above elision while still
    // budgeting away the read-once tail, and leaves fresh native work visible
    // (recency still leads for recent facts). See the trajectory doc.
    recencyWeight: o?.recencyWeight ?? 0.35,
    velocityWeight: o?.velocityWeight ?? 0.1,
    attentionWeight: o?.attentionWeight ?? 0.15,
    standingWeight: o?.standingWeight ?? 0.3,
    centralityWeight: o?.centralityWeight ?? 0.1,
    focusThreshold: o?.focusThreshold ?? 0.5,
    elideThreshold: o?.elideThreshold ?? 0.1,
  };
}

/**
 * Reserved key for a scope's salience policy. A fact written here whose value is
 * a `Partial<SalienceOptions>` (e.g. `{ focusThreshold: 0.62, elideThreshold: 0.62 }`)
 * re-tunes that owner's *own* `recall`/`query` shaping without a redeploy — the
 * substrate-native, per-user config seam. The whole `_config/*` namespace is
 * system plumbing (excluded from tending), so the fact itself stays out of the way.
 */
export const SALIENCE_CONFIG_KEY = '_config/salience';

/** Numeric `SalienceOptions` fields a config fact may set, and which are unit [0,1]. */
const SALIENCE_NUMERIC_KEYS = [
  'halfLifeMs',
  'windowMs',
  'velocitySaturation',
  'attentionSaturation',
  'standingSaturation',
  'centralitySaturation',
  'recencyWeight',
  'velocityWeight',
  'attentionWeight',
  'standingWeight',
  'centralityWeight',
  'focusThreshold',
  'elideThreshold',
] as const satisfies ReadonlyArray<keyof SalienceOptions>;
const SALIENCE_UNIT_KEYS = new Set<keyof SalienceOptions>(['focusThreshold', 'elideThreshold']);

/**
 * Extract a sanitized `Partial<SalienceOptions>` from a stored config fact's value
 * — best-effort and defensive: only known numeric fields survive, non-finite or
 * negative values are dropped, and thresholds are clamped to [0,1]. Accepts the
 * options object directly or wrapped under a `salience` key (so a config fact can
 * be `{ focusThreshold }` or `{ salience: { focusThreshold } }`). Returns `null`
 * when nothing usable is present, so the caller falls back to instance defaults.
 */
export function parseSalienceConfig(value: unknown): Partial<SalienceOptions> | null {
  const wrapped = value as { salience?: unknown } | null | undefined;
  const src =
    wrapped && typeof wrapped === 'object' && wrapped.salience && typeof wrapped.salience === 'object'
      ? wrapped.salience
      : value;
  if (!src || typeof src !== 'object') return null;
  const rec = src as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const k of SALIENCE_NUMERIC_KEYS) {
    const v = rec[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue;
    out[k] = SALIENCE_UNIT_KEYS.has(k) ? Math.min(v, 1) : v;
  }
  return Object.keys(out).length ? (out as Partial<SalienceOptions>) : null;
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
  // Centrality is *weighted* degree (ADR-0009): each edge contributes its strength,
  // so authored evidence (default 1.0; a `null` authored strength = 1.0) outweighs a
  // derived `supports` (0.6), which outweighs plumbing like `instanceOf` (0.2). A flat
  // count would let type-anchor edges dominate the signal.
  for (const ed of edges) {
    const w = ed.strength ?? 1;
    sig(ed.from).degree += w;
    if (ed.to !== ed.from) sig(ed.to).degree += w;
  }
  return m;
}

function tierFor(score: number, s: ResolvedSalience): Tier {
  if (score >= s.focusThreshold) return 'focus';
  if (score >= s.elideThreshold) return 'peripheral';
  return 'elided';
}

// ── derived structural backbone ────────────────────────────────────
//
// Authored edges are sparse — most facts are written without anyone linking
// them, so they score `centrality: 0` and sit near the elision floor even when
// they are perfectly real (the `_types/*` vocabulary, freshly-captured notes).
// But a fact is never *structurally* alone: it is an instance of its type, that
// type is managed by a cell and drawn by a renderer, and a view is the set of
// facts its query selects. Those relationships are already implied by fields the
// fact (and the vocabulary) carry — so we **derive** them at read time as virtual
// edges rather than materialising (and having to maintain) real ones. They lift
// weak-but-typed facts off the floor and make the graph navigable
// (`neighbors("_types/doc")` → every doc; a type → its cell), while the authored
// graph — what `links`, `changes`, and `attention.unlinked` report — stays clean.

export const TYPES_PREFIX = '_types/';
export const RENDERERS_PREFIX = '_renderers/';
export const VIEWS_PREFIX = '_views/';

/** Backbone edge relations (distinct from authored rels; never persisted). */
export const BACKBONE_RELS = {
  instanceOf: 'instanceOf', // fact → its type declaration (`_types/<type>`)
  managedBy: 'managedBy', // type → the cell that manages it
  rendersWith: 'rendersWith', // type → its renderer (`_renderers/<type>`)
  inView: 'inView', // fact → a view whose query selects it
} as const;

/** Reference relations that express *membership in a collection* (ADR-0005): a fact
 *  `inView` a view, `inDoc` a doc. A collection's extensional members are the facts
 *  with one of these edges pointing at it. */
export const MEMBERSHIP_RELS = new Set<string>(['inView', 'inDoc', 'onBoard']);

/**
 * Per-rule Reference strength (ADR-0009). Derived edges carry graded weight so a
 * hand-drawn (authored) link still dominates a fact's centrality, and *evidence*
 * edges (an embedded `supports`/`grounds` ref) outweigh mere *plumbing*
 * (`instanceOf`/`managedBy`). Authored edges default to 1.0 (a `null` authored
 * strength = 1.0 in `buildSignals`); these are the derived tiers below it:
 *   authored 1.0  >  embedded 0.6  >  membership 0.4  >  structural 0.2
 */
const STRUCTURAL_STRENGTH = 0.2; // instanceOf / managedBy / rendersWith — type plumbing
const MEMBERSHIP_STRENGTH = 0.4; // inView / inDoc — collection membership (ADR-0005)
const EMBEDDED_STRENGTH = 0.6; // a `ref` field (supports / grounds) — embedded evidence

/** A `ref` field on a type → an embedded Reference rule (ADR-0003): the value(s)
 *  at `name` are fact keys; emit `fact —(rel ?? name)→ key` (each, when `list`). */
export interface RefRule {
  name: string;
  rel?: string;
  list?: boolean;
}

/** A key-encoded Reference rule (ADR-0003): a `from/rel/to` edge whose endpoints are
 *  `{group}` captures from a type's `keyPattern` (or literals). */
export interface KeyEdgeRule {
  from: string;
  rel: string;
  to: string;
}

/** The Reference-rule inputs a type contributes (resolved from its declaration by the
 *  handler): its managing cell, its `ref` fields, and its key-encoded edges. */
export interface TypeRules {
  manager?: string;
  refs?: RefRule[];
  keyPattern?: string;
  keyEdges?: KeyEdgeRule[];
}

/** The Reference rules a *resolved* Type carries (ADR-0003): its `ref` fields
 *  (embedded edges), `manager`, and key-encoded edges. The single extractor —
 *  both the read-time backbone synthesis (`rulesFromDecl`) and the per-request
 *  rule map (`typeRulesFor` in workspace handlers) fold a decl through this, so
 *  a slice-declared type contributes rules identically to a cell-canonical one.
 *  Returns the (possibly empty) rules; callers decide whether to keep an empty. */
export function extractTypeRules(t: Type): TypeRules {
  const refs = (t.shape.fields ?? []).filter((f) => f.type === 'ref').map((f) => ({ name: f.name, rel: f.rel, list: f.list }));
  const r: TypeRules = {};
  if (t.manager) r.manager = t.manager;
  if (refs.length) r.refs = refs;
  if (t.shape.keyPattern && t.shape.keyEdges?.length) {
    r.keyPattern = t.shape.keyPattern;
    r.keyEdges = t.shape.keyEdges;
  }
  return r;
}

/** Compile a `keyPattern` (`_doc/{doc}/{block}`) into a total matcher; `null` if malformed. */
function compileKeyPattern(pattern: string): { rx: RegExp; names: string[] } | null {
  const names: string[] = [];
  let rx = '^';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '{') {
      const end = pattern.indexOf('}', i);
      if (end < 0) return null;
      const name = pattern.slice(i + 1, end);
      if (!/^[A-Za-z0-9_]+$/.test(name)) return null;
      names.push(name);
      rx += '([^/]+)';
      i = end + 1;
    } else {
      rx += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  try {
    return { rx: new RegExp(rx + '$'), names };
  } catch {
    return null;
  }
}

/** Substitute `{group}` placeholders in an endpoint/rel template. */
function substGroups(tpl: string, groups: Record<string, string>): string {
  return tpl.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, n: string) => groups[n] ?? '');
}

/** Fold a *slice* `_types/<type>` decl into Reference rules, so a slice-declared
 *  type (e.g. `claim`) contributes rules just like a cell-canonical one. The
 *  extraction is the shared `extractTypeRules`; this just resolves the decl. */
function rulesFromDecl(decl: unknown): TypeRules {
  return extractTypeRules(resolveType(decl));
}

/** An edge plus whether it was derived (vs authored). Stored edges omit the flag. */
export type AnnotatedEdge = EdgeRecord & {
  derived?: boolean;
  /** For a key-encoded edge (ADR-0003), the decoration fact whose key produced it.
   *  Lets a consumer recover the decoration's payload (e.g. a doc-order `seq`). */
  source?: string;
};

/** Normalise a cell address/manager handle for matching: `/@c15r/lit`, `@c15r/lit`
 *  and a bare name all collapse so a type's `manager` resolves to its cell fact. */
function normalizeCellHandle(h: string): string {
  return h.replace(/^\//, '');
}

/**
 * Compute the virtual backbone edges implied by a scope's own facts — pure, and
 * conditioned on the target fact existing in the scope, so a backbone edge never
 * dangles. Targets: a fact's `_types/<type>` anchor; that anchor's managing cell
 * (matched against `cell` facts' address/name) and its `_renderers/<type>`; and
 * `_views/<id>` for any view whose query selects the fact. Edges are timeless
 * (`createdAt: ''`, `writer: null`) and flagged derived.
 *
 * A type's manager comes from the type-decl's own `manager` field when set, else
 * from `typeManagers` — the canonical type→manager map a cell stamps on deploy
 * (`cells.describeTypes`), so a cell-managed type links to its cell without the
 * per-slice anchor having to carry the manager itself.
 */
export function deriveBackboneEdges(
  records: StateRecord[],
  typeRules?: Record<string, TypeRules>,
): AnnotatedEdge[] {
  const live = records.filter((r) => !r.superseded);
  const present = new Set(live.map((r) => r.key));
  const scope = live[0]?.scope ?? '';

  // Index cells by every handle they answer to, the views with a usable query, and
  // the manager a slice type-decl declares for itself (overrides the canonical map).
  const cellByHandle = new Map<string, string>();
  const views: Array<{ key: string; type?: string; tag?: string; prefix?: string }> = [];
  const sliceRules = new Map<string, TypeRules>();
  const typeNames = new Set<string>(); // every type that appears, anchored or not
  for (const r of live) {
    if (r.type && !r.key.startsWith(TYPES_PREFIX)) typeNames.add(r.type);
    if (r.type === 'cell') {
      const v = (r.value ?? {}) as { address?: unknown; name?: unknown };
      for (const h of [v.address, v.name]) {
        if (typeof h === 'string' && h) cellByHandle.set(normalizeCellHandle(h), r.key);
      }
    }
    if (r.key.startsWith(TYPES_PREFIX)) {
      const t = r.key.slice(TYPES_PREFIX.length);
      typeNames.add(t);
      sliceRules.set(t, rulesFromDecl(r.value));
    }
    if (r.key.startsWith(VIEWS_PREFIX)) {
      const q = ((r.value ?? {}) as { query?: unknown }).query;
      if (q && typeof q === 'object') {
        const { type, tag, prefix } = q as { type?: unknown; tag?: unknown; prefix?: unknown };
        // An unfiltered view selects everything — too coarse to be a useful edge.
        if (typeof type === 'string' || typeof tag === 'string' || typeof prefix === 'string') {
          views.push({
            key: r.key,
            type: typeof type === 'string' ? type : undefined,
            tag: typeof tag === 'string' ? tag : undefined,
            prefix: typeof prefix === 'string' ? prefix : undefined,
          });
        }
      }
    }
  }

  // A type's effective rules: its slice `_types/<type>` decl wins per facet over the
  // canonical (cell-declared) rules — Resolution (ADR-0010), the same per-facet
  // last-wins merge as `$types`/`mergeTypeDecl`.
  const effectiveRules = (t: string): TypeRules => layer<TypeRules>(typeRules?.[t], sliceRules.get(t));

  const edges: AnnotatedEdge[] = [];
  // The `_types/<type>` anchor is a well-known node, so `instanceOf` is emitted
  // even when the anchor isn't materialised as a fact (most cell-managed content
  // types are canonical-only) — that's what gives every typed fact its floor.
  // Edges to *other* targets (a cell, renderer, view) still require the target to
  // exist, so they never dangle.
  const push = (from: string, rel: string, to: string, requireTarget = true, strength = STRUCTURAL_STRENGTH, source?: string): void => {
    if (from === to || (requireTarget && !present.has(to))) return;
    edges.push({ scope, from, rel, to, strength, createdAt: '', writer: null, derived: true, source });
  };

  for (const r of live) {
    // fact → its type anchor (a type-decl is not an instance of itself)
    if (r.type && !r.key.startsWith(TYPES_PREFIX)) push(r.key, BACKBONE_RELS.instanceOf, `${TYPES_PREFIX}${r.type}`, false);
    // fact → each view whose query selects it
    for (const view of views) {
      if (view.key === r.key) continue;
      if (!matchesSelector(r, view)) continue; // the one structural predicate (ADR-0011)
      push(r.key, BACKBONE_RELS.inView, view.key, true, MEMBERSHIP_STRENGTH);
    }
    // ── declared Reference rules (ADR-0003), from the fact's own type ──
    const rules = r.type ? effectiveRules(r.type) : undefined;
    if (rules) {
      // embedded: a `ref` field's value(s) are fact keys → fact —rel→ key
      const value = (r.value ?? {}) as Record<string, unknown>;
      for (const ref of rules.refs ?? []) {
        const raw = value[ref.name];
        const keys = ref.list ? (Array.isArray(raw) ? raw : []) : raw != null ? [raw] : [];
        for (const k of keys) if (typeof k === 'string') push(r.key, ref.rel ?? ref.name, k, true, EMBEDDED_STRENGTH);
      }
      // key-encoded: parse this fact's key, emit the declared edge(s)
      if (rules.keyPattern && rules.keyEdges?.length) {
        const compiled = compileKeyPattern(rules.keyPattern);
        const groups = compiled?.rx.exec(r.key);
        if (compiled && groups) {
          const g: Record<string, string> = {};
          compiled.names.forEach((n, i) => (g[n] = groups[i + 1]));
          // `source: r.key` = the decoration that ordered/placed the member, so
          // extensional membership can recover its narrative `seq` (ADR-0005).
          for (const e of rules.keyEdges) push(substGroups(e.from, g), substGroups(e.rel, g), substGroups(e.to, g), true, MEMBERSHIP_STRENGTH, r.key);
        }
      }
    }
  }

  // type anchor → its managing cell + renderer. The anchor itself may be virtual,
  // so this runs over every type that appears (not just materialised type-decls);
  // manager is the slice decl's own field when set, else the canonical map.
  for (const t of typeNames) {
    const anchor = `${TYPES_PREFIX}${t}`;
    const manager = effectiveRules(t).manager;
    if (manager) {
      const cellKey = cellByHandle.get(normalizeCellHandle(manager));
      if (cellKey) push(anchor, BACKBONE_RELS.managedBy, cellKey);
    }
    push(anchor, BACKBONE_RELS.rendersWith, `${RENDERERS_PREFIX}${t}`);
  }
  return edges;
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
  /**
   * Import-only: preserve a migrated fact's original timestamps (recency reflects
   * true age) and carry its cumulative read/write counts as `standing` priors.
   * `import.createdAt` only applies on first write (creation).
   */
  import?: { createdAt?: string; updatedAt?: string; seedReads?: number; seedWrites?: number };
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
  /** Attach `_meta.explain` (signals · weights · contributions) to every entry —
   *  the score stage made inspectable for tuning. Off by default. */
  explain?: boolean;
  /**
   * The scope's stored salience policy (a `_config/salience` fact), layered over
   * the instance defaults as the *base* — so it sits below the lens and the
   * per-call `salience` override (defaults ← config ← lens ← override). `read`
   * and `query` load this themselves from their scope; the scopeless `shape`
   * (used by `recall` to tier a merged view) takes it explicitly so the viewer's
   * policy governs the assembled result. Pass `null` to force instance defaults.
   */
  salienceConfig?: Partial<SalienceOptions> | null;
  /** Resolved per-type Reference rules (`cells.describeTypes` → resolveType): manager
   *  (managedBy), `ref` fields (embedded edges), keyPattern/keyEdges. Injected by the handler. */
  typeRules?: Record<string, TypeRules>;
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
  /** Attach `_meta.explain` (signals · weights · contributions) to each entry. */
  explain?: boolean;
  limit?: number;
  /**
   * Resume token from a previous page's `nextCursor`. Pages are computed over
   * a fresh ranking, so a cursor is a best-effort resume, not a snapshot.
   */
  cursor?: string;
  includeSuperseded?: boolean;
  /** Full-text-ish filter: keep only facts whose key or value (stringified)
   *  contains this substring, case-insensitively. Lets a caller find a fact by
   *  what's *inside* it (e.g. a board element whose `value.content` holds a
   *  script) without paging the whole partition. Applied after type/tag/prefix. */
  contains?: string;
  /** Resolved per-type Reference rules (managedBy + embedded `ref` + key-encoded).
   *  Injected by the handler. */
  typeRules?: Record<string, TypeRules>;
}

/** Does a record's key or value contain `needle` (case-insensitive)? Backs the
 *  `contains` query filter — a substring scan over the value JSON, so nested
 *  fields (markdown content, an element's inline script) are all searchable. */
export function recordContains(rec: { key: string; value: unknown }, needle: string): boolean {
  const n = needle.toLowerCase();
  if (rec.key.toLowerCase().includes(n)) return true;
  const v = rec.value;
  if (typeof v === 'string') return v.toLowerCase().includes(n);
  if (v == null) return false;
  try { return JSON.stringify(v).toLowerCase().includes(n); } catch { return false; }
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
  /** Resolved per-type Reference rules (managedBy + embedded + key-encoded), so a
   *  type's derived edges show up in traversal. Injected by the handler. */
  typeRules?: Record<string, TypeRules>;
}

export interface NeighborsResult {
  /** One-hop edges. Authored edges and the derived structural backbone are both
   *  included; backbone edges carry `derived: true`. */
  outbound: AnnotatedEdge[];
  inbound: AnnotatedEdge[];
  /** Wrapped entries for every distinct neighbor key that exists. */
  entries: Record<string, Entry>;
}

/** A collection member: the fact (key + value + _meta) plus, for an extensional
 *  member, the `placement` from its ordering decoration (`_doc/<doc>/<key>` = {seq,
 *  fold}) — so a consumer (lit) gets membership + order + presentation in one read. */
export type MemberEntry = { key: string; placement?: { seq?: number; fold?: boolean } } & Entry;

export interface MembersResult {
  key: string;
  membership: 'intensional' | 'extensional';
  /**
   * How the extensional members are ordered: `seq` when at least one member is
   * placed by an ordering decoration (a doc-order `seq` — narrative position),
   * else `salience`. Intensional results inherit the query's own ordering and
   * report `query`.
   */
  order: 'seq' | 'salience' | 'query';
  members: MemberEntry[];
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
  /** The scope's stored salience policy (`_config/salience`), sanitized — or `null`
   *  when unset/malformed. Recall loads the viewer's once to shape the merged view. */
  salienceConfig(scope: string): Promise<Partial<SalienceOptions> | null>;
  /** Add a typed, directed edge `from --rel--> to` within the scope. */
  link(scope: string, from: string, rel: string, to: string, strength: number | null, identity?: Identity): Promise<LinkResult>;
  unlink(scope: string, from: string, rel: string, to: string, identity?: Identity): Promise<{ ok: true }>;
  /** Edges (and neighbor entries) around a key. */
  neighbors(scope: string, key: string, opts?: NeighborsOptions, identity?: Identity): Promise<NeighborsResult>;
  /** Every edge in the scope (bounded; boards project their edges from this). */
  edges(scope: string): Promise<EdgeRecord[]>;
  /** The full Reference projection (ADR-0003/0004): authored edges + the derived rule
   *  edges (structural backbone + embedded `ref` + key-encoded). The `$graph` surface. */
  graph(scope: string, opts?: { typeRules?: Record<string, TypeRules> }): Promise<{ edges: AnnotatedEdge[] }>;
  /** A collection's member facts (ADR-0005): **intensional** when the collection fact
   *  carries a `query` (a view) — evaluated via `query`; else **extensional** — the
   *  facts with an inbound membership edge (`inView`/`inDoc`) in the projection.
   *  Salience-ranked; ordered extensional membership (by decoration `seq`) is a follow-on. */
  members(scope: string, key: string, opts?: { typeRules?: Record<string, TypeRules> }): Promise<MembersResult>;
  /** Tail the trajectory from a sequence number — the change feed. `'head'` returns just the current seq (no events), so tailing starts in one call.
   *  `limit` pages FORWARD from sinceSeq; `last` keeps the NEWEST n instead (still ascending) — the "recent activity" window (ADR-0048). */
  changes(scope: string, sinceSeq: number | 'head', limit?: number, last?: number): Promise<ChangesResult>;
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
  async function signalsFor(
    scope: string,
    nowMs: number,
    windowMs: number,
    records?: StateRecord[],
    typeRules?: Record<string, TypeRules>,
  ): Promise<Map<string, KeySignals>> {
    const [events, edges, recs] = await Promise.all([
      store.recentTrajectory(scope, 0),
      store.listEdges(scope),
      records ? Promise.resolve(records) : store.list(scope),
    ]);
    // Centrality counts the derived backbone alongside authored edges, so a
    // typed-but-unlinked fact earns a structural floor instead of scoring zero.
    return buildSignals(events, [...edges, ...deriveBackboneEdges(recs, typeRules)], nowMs, windowMs);
  }

  /** Load a scope's `_config/salience` policy (best-effort: a missing, retired, or
   *  malformed fact yields `null` and the read proceeds on instance defaults — a
   *  config fact must never be able to break a read). */
  async function loadSalienceConfig(scope: string): Promise<Partial<SalienceOptions> | null> {
    let rec: StateRecord | null;
    try {
      rec = await store.get(scope, SALIENCE_CONFIG_KEY);
    } catch {
      return null;
    }
    if (!rec || rec.superseded || !isTimerLive(rec, Date.now())) return null;
    return parseSalienceConfig(rec.value);
  }

  /** The per-call base: a scope's config layered over the instance defaults, sitting
   *  below the lens + per-call override (defaults ← config ← lens ← override). */
  const baseSalience = (cfg?: Partial<SalienceOptions> | null): ResolvedSalience =>
    cfg ? resolveSalience({ ...s, ...cfg }) : s;

  /** Wrap a stored record into a read-facing entry with a computed score. Pass a
   *  precomputed `signals` map (bulk paths) to avoid a per-record scope scan, and
   *  `sCall` to score under a per-read lens (defaults to the instance settings). */
  async function wrap(rec: StateRecord, nowMs: number, signals?: Map<string, KeySignals>, sCall: ResolvedSalience = s, explain = false): Promise<Entry> {
    const sig = (signals ?? (await signalsFor(rec.scope, nowMs, sCall.windowMs))).get(rec.key) ?? EMPTY_SIGNALS;
    // Import priors fold into the cumulative (standing) counts only — never the
    // recent window — so a ported fact's earned importance shows without faking
    // current activity.
    const parts = scoreParts(
      {
        updatedAtMs: Date.parse(rec.updatedAt),
        nowMs,
        ...sig,
        lifetimeReads: sig.lifetimeReads + (rec.seedReads ?? 0),
        lifetimeWrites: sig.lifetimeWrites + (rec.seedWrites ?? 0),
      },
      sCall,
    );
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
        ...(explain ? { explain: explainScore(parts, sig, sCall) } : {}),
      },
    };
  }

  /** Build the inspectable breakdown for a scored entry: the five signals, the
   *  weights they were blended by, and each one's weighted contribution. */
  function explainScore(parts: ScoreParts, sig: KeySignals, sCall: ResolvedSalience): ScoreExplain {
    const signals = {
      recency: round4(parts.recency),
      velocity: round4(parts.velocity),
      attention: round4(parts.attention),
      standing: round4(parts.standing),
      centrality: round4(parts.centrality),
    };
    const weights = {
      recency: sCall.recencyWeight,
      velocity: sCall.velocityWeight,
      attention: sCall.attentionWeight,
      standing: sCall.standingWeight,
      centrality: sCall.centralityWeight,
    };
    return {
      signals,
      weights,
      contribution: {
        recency: round4(parts.recency * weights.recency),
        velocity: round4(parts.velocity * weights.velocity),
        attention: round4(parts.attention * weights.attention),
        standing: round4(parts.standing * weights.standing),
        centrality: round4(parts.centrality * weights.centrality),
      },
      degree: sig.degree ?? 0,
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

  const api: ObservedState = {
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
        // Import preserves the migrated fact's real timestamps (so recency
        // reflects true age); native writes stamp now.
        createdAt: prev?.createdAt ?? input.import?.createdAt ?? nowIso,
        updatedAt: input.import?.updatedAt ?? nowIso,
        writers,
        // a fresh write to a superseded key revives it
        superseded: false,
        supersededBy: null,
        // omitting type/tags on a rewrite preserves what is already stored
        type: input.type !== undefined ? input.type : (prev?.type ?? null),
        tags: input.tags !== undefined ? input.tags : (prev?.tags ?? []),
        timerExpiresAt: timer?.expiresAt ?? null,
        timerEffect: timer?.effect ?? null,
        // Carry import priors (cumulative legacy reads/writes) so `standing`
        // reflects earned importance; preserved across rewrites.
        ...(input.import?.seedReads !== undefined || prev?.seedReads !== undefined
          ? { seedReads: input.import?.seedReads ?? prev?.seedReads }
          : {}),
        ...(input.import?.seedWrites !== undefined || prev?.seedWrites !== undefined
          ? { seedWrites: input.import?.seedWrites ?? prev?.seedWrites }
          : {}),
      };
      await store.put(record, hasCas ? { expectRevision: prev?.revision ?? null } : undefined);
      // The trajectory write event carries the (possibly historical) updatedAt so
      // an import doesn't read as a recent burst.
      await store.appendTrajectory({ op: 'write', scope: input.scope, key: input.key, at: record.updatedAt, seq });
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
      // (it can't recompute scores without the scope's signals). Being scopeless,
      // it takes the salience config explicitly (recall passes the viewer's).
      return shapeEntries(entries, opts, callSalience(baseSalience(opts?.salienceConfig), opts?.lens, opts?.salience));
    },

    async read(scope: string, opts?: ReadOptions, _identity?: Identity): Promise<ReadResult> {
      const nowMs = Date.now();
      // Honor a handler-supplied config (recall scores granted slices under the
      // viewer's policy); otherwise load this scope's own `_config/salience`.
      const cfg = opts?.salienceConfig !== undefined ? opts.salienceConfig : await loadSalienceConfig(scope);
      const sCall = callSalience(baseSalience(cfg), opts?.lens, opts?.salience);
      const records = await store.list(scope);
      const signals = await signalsFor(scope, nowMs, sCall.windowMs, records, opts?.typeRules);

      // Score every live entry (no elision yet); shape in one pass below.
      const scored: Record<string, Entry> = {};
      for (const rec of records) {
        if (rec.superseded && !opts?.includeSuperseded) continue;
        if (!isTimerLive(rec, nowMs)) continue;
        scored[rec.key] = await wrap(rec, nowMs, signals, sCall, opts?.explain);
      }

      // Reading the scope is itself attention on every surfaced key.
      const seq = await store.nextSeq(scope);
      await store.appendTrajectory({ op: 'read', scope, key: null, at: new Date(nowMs).toISOString(), seq });

      return shapeEntries(scored, opts, sCall);
    },

    async query(scope: string, opts?: QueryOptions, _identity?: Identity): Promise<QueryResult> {
      const nowMs = Date.now();
      const sCall = callSalience(baseSalience(await loadSalienceConfig(scope)), opts?.lens, opts?.salience);
      const queryTypeRules = opts?.typeRules;
      // Type is index-served; tag/prefix filter the (bounded) candidate set.
      const records = opts?.type ? await store.listByType(scope, opts.type) : await store.list(scope);
      // Reuse the full-partition read for signals when there's no type filter —
      // otherwise `signalsFor` issues a SECOND `store.list(scope)` (a duplicate
      // multi-page DDB scan, ~half the query's latency). With a type filter the
      // candidates are a subset, so signals still need the whole graph.
      const signals = await signalsFor(scope, nowMs, sCall.windowMs, opts?.type ? undefined : records, queryTypeRules);
      const candidates = records.filter((rec) => {
        if (rec.superseded && !opts?.includeSuperseded) return false;
        if (!isTimerLive(rec, nowMs)) return false;
        // type is index-served (listByType); tag/prefix via the shared predicate (ADR-0011).
        if (!matchesSelector(rec, { tag: opts?.tag, prefix: opts?.prefix })) return false;
        // Content search: find a fact by what's inside it (substring over value JSON).
        if (opts?.contains && !recordContains(rec, opts.contains)) return false;
        return true;
      });
      const wrapped = await Promise.all(candidates.map(async (rec) => ({ key: rec.key, ...(await wrap(rec, nowMs, signals, sCall, opts?.explain)) })));
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

    async salienceConfig(scope: string): Promise<Partial<SalienceOptions> | null> {
      return loadSalienceConfig(scope);
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
      const nowMs = Date.now();
      // Honor the scope's `_config/salience` so neighbor scores match recall (ADR-0006).
      const sCall = baseSalience(await loadSalienceConfig(scope));
      const [authoredOut, authoredIn, records] = await Promise.all([
        dir !== 'in' ? store.edgesFrom(scope, key, opts?.rel) : Promise.resolve([]),
        dir !== 'out' ? store.edgesTo(scope, key, opts?.rel) : Promise.resolve([]),
        store.list(scope),
      ]);
      // The derived backbone is one hop too: a fact's type/cell/renderer/views.
      const derived = deriveBackboneEdges(records, opts?.typeRules).filter((e) => !opts?.rel || e.rel === opts.rel);
      const outbound: AnnotatedEdge[] = [...authoredOut, ...(dir !== 'in' ? derived.filter((e) => e.from === key) : [])];
      const inbound: AnnotatedEdge[] = [...authoredIn, ...(dir !== 'out' ? derived.filter((e) => e.to === key) : [])];
      const signals = await signalsFor(scope, nowMs, sCall.windowMs, records, opts?.typeRules);
      const neighborKeys = new Set<string>();
      for (const e of outbound) neighborKeys.add(e.to);
      for (const e of inbound) neighborKeys.add(e.from);
      neighborKeys.delete(key);
      const byKey = new Map(records.map((r) => [r.key, r]));
      const entries: Record<string, Entry> = {};
      for (const nk of neighborKeys) {
        const rec = byKey.get(nk) ?? (await store.get(scope, nk));
        if (rec && isTimerLive(rec, nowMs)) entries[nk] = await wrap(rec, nowMs, signals, sCall);
      }
      return { outbound, inbound, entries };
    },

    async edges(scope): Promise<EdgeRecord[]> {
      return store.listEdges(scope);
    },

    async graph(scope, opts): Promise<{ edges: AnnotatedEdge[] }> {
      const nowMs = Date.now();
      const [records, authored] = await Promise.all([store.list(scope), store.listEdges(scope)]);
      const live = records.filter((r) => !r.superseded && isTimerLive(r, nowMs));
      const derived = deriveBackboneEdges(live, opts?.typeRules);
      return { edges: [...authored, ...derived] };
    },

    async members(scope, key, opts): Promise<MembersResult> {
      const nowMs = Date.now();
      const fact = await store.get(scope, key);
      const q = (fact?.value as { query?: unknown } | undefined)?.query;
      // Intensional: the collection IS a query (a view) — evaluate it.
      if (q && typeof q === 'object') {
        const res = await api.query(scope, { ...(q as QueryOptions), typeRules: opts?.typeRules });
        return { key, membership: 'intensional', order: 'query', members: res.entries };
      }
      // Extensional: the facts with an inbound membership edge in the projection.
      // A key-encoded membership edge carries `source` — the decoration that placed
      // the member — so we can recover its narrative `seq` and order by it.
      //
      // ONE partition read serves it all: the membership edges (from the records +
      // authored edges), the member records, the decoration records, AND signals.
      // The previous shape did `api.graph` (list + listEdges) + a duplicate
      // `signalsFor` list + listEdges + an N+1 `store.get` PER member and PER
      // decoration — pathological for a doc with many blocks.
      const [records, authored] = await Promise.all([store.list(scope), store.listEdges(scope)]);
      const byKey = new Map(records.map((r) => [r.key, r]));
      const live = records.filter((r) => !r.superseded && isTimerLive(r, nowMs));
      const edges: AnnotatedEdge[] = [...authored, ...deriveBackboneEdges(live, opts?.typeRules)];
      const memberKeys: string[] = [];
      const seen = new Set<string>();
      const decorationOf = new Map<string, string>();
      for (const e of edges) {
        if (e.to === key && MEMBERSHIP_RELS.has(e.rel) && !seen.has(e.from)) {
          seen.add(e.from);
          memberKeys.push(e.from);
          if (e.source) decorationOf.set(e.from, e.source);
        }
      }
      // Honor the scope's `_config/salience` (the intensional branch already does, via query).
      const sCall = baseSalience(await loadSalienceConfig(scope));
      const signals = await signalsFor(scope, nowMs, sCall.windowMs, records, opts?.typeRules);
      const members: MemberEntry[] = [];
      const seqOf = new Map<string, number>();
      for (const k of memberKeys) {
        const rec = byKey.get(k);
        if (!rec || rec.superseded || !isTimerLive(rec, nowMs)) continue;
        // Surface the placing decoration (`_doc/<doc>/<key>` = {seq, fold}) so a consumer
        // gets membership + order + presentation in one read, not a second decoration scan.
        let placement: MemberEntry['placement'];
        const decKey = decorationOf.get(k);
        if (decKey) {
          const dv = (byKey.get(decKey)?.value ?? {}) as { seq?: unknown; fold?: unknown };
          const seq = typeof dv.seq === 'number' && Number.isFinite(dv.seq) ? dv.seq : undefined;
          if (seq !== undefined) seqOf.set(k, seq);
          if (seq !== undefined || typeof dv.fold === 'boolean') {
            placement = { ...(seq !== undefined ? { seq } : {}), ...(typeof dv.fold === 'boolean' ? { fold: dv.fold } : {}) };
          }
        }
        members.push({ key: k, ...(await wrap(rec, nowMs, signals, sCall)), ...(placement ? { placement } : {}) });
      }
      // Narrative order when any member is placed by a `seq` decoration; the rest
      // (and ties) fall back to salience so nothing is lost.
      const ordered = seqOf.size > 0;
      if (ordered) {
        members.sort((a, b) => {
          const sa = seqOf.get(a.key);
          const sb = seqOf.get(b.key);
          if (sa !== undefined && sb !== undefined && sa !== sb) return sa - sb;
          if (sa !== undefined && sb === undefined) return -1;
          if (sa === undefined && sb !== undefined) return 1;
          return b._meta.score - a._meta.score;
        });
      } else {
        members.sort((a, b) => b._meta.score - a._meta.score);
      }
      return { key, membership: 'extensional', order: ordered ? 'seq' : 'salience', members };
    },

    async changes(scope, sinceSeq, limit?, last?): Promise<ChangesResult> {
      const head = await store.currentSeq(scope);
      // 'head' = "where do I start tailing from?" — answered without paying
      // for (or wading through) the scope's whole recent history.
      if (sinceSeq === 'head') return { events: [], seq: head };
      // The trajectory is TTL-bounded, so the partition stays small; seq rises
      // with time, so time-ordered events are seq-ordered too.
      const events = (await store.recentTrajectory(scope, 0))
        .filter((e) => e.seq > sinceSeq)
        .sort((a, b) => a.seq - b.seq);
      // `limit` pages FORWARD (tailing); `last` keeps the NEWEST n, still
      // ascending — the "recent activity" window (ADR-0048).
      const limited =
        last !== undefined ? (last > 0 ? events.slice(-last) : []) : limit !== undefined ? events.slice(0, Math.max(0, limit)) : events;
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
  return api;
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
    async list(scope: string, keyPrefix?: string): Promise<StateRecord[]> {
      return [...records.values()]
        .filter((r) => r.scope === scope && (keyPrefix === undefined || r.key.startsWith(keyPrefix)))
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

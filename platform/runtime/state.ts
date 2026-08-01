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
import type { ActorClass, Identity } from './auth';
import { leafActOf } from './auth';
import { resolveType, type Type } from './type-schema';
import { layer } from './resolution';
import { matchesSelector } from './selector';
import { contentHash } from './content-hash';

// ── wrapped entry (the read-facing shape) ──────────────────────────

export interface EntryMeta {
  /** Monotonic per-(scope,key) write count. */
  revision: number;
  /** Content hash of the value — the unforgeable proof-of-read token for
   *  `ifVersion` conditional writes (ADR-0066). Echo it back to guard a write. */
  version: string;
  /** Monotonic per-scope sequence of the last write — the trajectory ordinal. */
  seq: number;
  /** The principal who last wrote (server-stamped from identity). */
  writer: string | null;
  /** Optional label for *how* it was written (e.g. an action/command name). */
  via: string | null;
  /** The self-declared participant key behind the last write (ADR-0086):
   *  WHICH embodied actor within the writer's connection acted — provenance
   *  at `via`'s trust grade, never authority. Absent when none was declared. */
  as?: string;
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
  /** Cosine similarity to the read's intent (`text`), present only on a read
   *  that stated one (ADR-0051). */
  relevance?: number;
  /** The fact's persisted earned-salience term (ADR-0070), present only when
   *  set. Contributes `rewardWeight × reward` to the score (default weight 0). */
  reward?: number;
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
  signals: { recency: number; velocity: number; attention: number; standing: number; centrality: number; relevance: number; reward: number };
  weights: { recency: number; velocity: number; attention: number; standing: number; centrality: number; relevance: number; reward: number };
  contribution: { recency: number; velocity: number; attention: number; standing: number; centrality: number; relevance: number; reward: number };
  /** Raw inbound+outbound graph degree feeding centrality (pre-saturation). */
  degree: number;
  /** The type prior the blended score was multiplied by (ADR-0050). */
  prior: number;
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
  /** The salience lens this read was computed under, when not the default —
   *  a compiled name or a slice-declared one (ADR-0078). */
  lens?: SalienceLens | (string & {});
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
  /** Content hash of `value` — the proof-of-read `version` token (ADR-0066).
   *  Set on every native write; absent (`undefined`) on facts written before the
   *  ADR — reads compute it on the fly, the next write persists it. */
  version?: string;
  /** seq of the last write. */
  seq: number;
  /** seq of the first write (createdAt ordinal). */
  firstSeq: number;
  writer: string | null;
  via: string | null;
  /** The self-declared participant key behind the last write (ADR-0086) —
   *  provenance decoration at `via`'s trust grade, never authority. Absent for
   *  writes made without one. */
  as?: string;
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
  /**
   * Earned salience (ADR-0070): a persisted per-fact number in [0,1], the
   * seventh score signal. Written when work involving this fact demonstrably
   * paid off — canonically by the consolidation pass, whose backlog delta is the
   * substrate's opinion about trajectory quality. Weighted by `rewardWeight`
   * (default 0, so inert until configured). Preserved across rewrites like the
   * import seeds; absent = 0.
   */
  reward?: number;
  /**
   * Cumulative touch counters by actor class (ADR-0050) — the durable form of
   * "lifetime reads+writes". Maintained on every touch (a write folds them into
   * the rewritten record; a read is one counter increment via `recordTouch`), so
   * `standing` no longer depends on scanning a TTL-bounded trajectory. Absent on
   * facts written before ADR-0050 (they stand on their import seeds).
   */
  touches?: TouchCounters;
  /**
   * The current burst-window bucket (ADR-0050): touch counts within the bucket
   * `b = floor(now / windowMs)`. Feeds `velocity`/`attention` without a
   * trajectory scan; a stale bucket reads as zero (the burst has passed).
   */
  window?: TouchWindow;
}

// ── actor-classed touches (ADR-0050) ───────────────────────────────

/**
 * Who touched a fact, coarsely: the substrate's own machinery (`platform/*`
 * principals — deploys, indexers, reactions), a cell/agent principal
 * (`@owner/cell` tokens), or a person. Salience weights these differently —
 * the 2026-07-02 audit found machinery churn indistinguishable from human
 * attention, which made salience a mirror of the system's own activity.
 * The class itself lives in `auth` (ADR-0022 mediation: the auth layer stamps
 * `identity.actor` from the validated token — a DCR client token is an agent
 * embodiment even though its subject is the user); this module classifies by
 * PRINCIPAL NAME only as the fallback for un-stamped identities.
 */
export type { ActorClass } from './auth';

export function actorClassOf(principal: string | null | undefined): ActorClass {
  if (!principal || principal.startsWith('platform/')) return 'platform';
  if (principal.startsWith('@')) return 'agent';
  return 'human';
}

/** The embodiment behind an identity: the auth-stamped `actor` (mediation-aware,
 *  ADR-0022) when present, else classified from the principal name. */
export function actorOf(identity: Identity | undefined): ActorClass {
  return identity?.actor ?? actorClassOf(identity?.user);
}

/** Compact per-class read/write counters (`hr` = human reads, `aw` = agent
 *  writes, …) — compact because they live as flat item attributes so a read can
 *  bump one with a single `ADD` update. */
export interface TouchCounters {
  hr?: number;
  hw?: number;
  ar?: number;
  aw?: number;
  pr?: number;
  pw?: number;
}

/** A burst-window bucket: `TouchCounters` scoped to bucket ordinal `b`. */
export interface TouchWindow extends TouchCounters {
  b: number;
}

/** The counter key for an actor class + op (`human`+`read` → `hr`). */
export function touchKey(actor: ActorClass, op: 'read' | 'write'): keyof TouchCounters {
  return `${actor === 'human' ? 'h' : actor === 'agent' ? 'a' : 'p'}${op === 'read' ? 'r' : 'w'}` as keyof TouchCounters;
}

/** Pure counter bump (write paths fold this into the record they rewrite). */
export function bumpTouches(t: TouchCounters | undefined, actor: ActorClass, op: 'read' | 'write'): TouchCounters {
  const k = touchKey(actor, op);
  return { ...(t ?? {}), [k]: ((t?.[k] as number | undefined) ?? 0) + 1 };
}

/** Bump the window bucket, resetting it when `bucket` has rolled over. */
export function bumpWindow(w: TouchWindow | undefined, actor: ActorClass, op: 'read' | 'write', bucket: number): TouchWindow {
  const base: TouchWindow = w && w.b === bucket ? w : { b: bucket };
  return { ...bumpTouches(base, actor, op), b: bucket };
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
  /**
   * Edge endpoints, present on `link`/`unlink` events (ADR-0055): `key` is the
   * edge's `from`. With endpoints on the event, a scoped consumer can judge
   * relevance directly instead of refetching the whole link set.
   */
  rel?: string;
  to?: string;
}

/**
 * Server-side slice of the change feed (ADR-0055): a surface pays for its
 * slice, not the workspace. `prefixes` match the event key — and, for
 * link/unlink, the `to` endpoint too, so edges INTO the slice are in scope.
 */
export interface ChangesScope {
  prefixes?: string[];
  ops?: TrajectoryEvent['op'][];
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
  /**
   * Record attention on one fact as counter increments (ADR-0050): the lifetime
   * counter for `(actor, op)` plus the burst-window bucket (reset when `bucket`
   * rolled over). One conditional update, no trajectory event, no seq — this is
   * how a read stops paying (and stops serializing on) the write path. A miss
   * (fact absent) is a silent no-op.
   */
  recordTouch(scope: string, key: string, actor: ActorClass, op: 'read' | 'write', bucket: number): Promise<void>;
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
  /** Graph degree at which the `centrality` term saturates. Log-compressed
   *  (ADR-0050) so the top is not pinned: default 50 keeps "linked at all" a real
   *  signal (degree 1 → ~0.18) while a heavily-cited hub can still outrank board
   *  plumbing (the old hard cap at 5 made everything on a board `centrality: 1`). */
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
  /** Weight of the per-read `relevance` signal (ADR-0051) — cosine similarity to
   *  a caller-supplied intent (`text`). Default 0: a read with no intent pays and
   *  changes nothing. Callers passing `text` layer the intent preset instead. */
  relevanceWeight?: number;
  /** Weight of the per-fact `reward` signal (ADR-0070) — a persisted, EARNED
   *  number in [0,1] (normally written by the consolidation pass, whose backlog
   *  delta is the substrate's first opinion about trajectory quality). Default 0:
   *  inert until configured (`_config/salience`) or supplied per-call — the same
   *  discipline `relevanceWeight` followed, so every existing read is unchanged. */
  rewardWeight?: number;
  /** How much a touch by each actor class counts toward attention/velocity/
   *  standing (ADR-0050). Defaults: human 1, agent 0.25, platform 0 — the
   *  substrate's own machinery no longer manufactures salience by churning. */
  humanTouchWeight?: number;
  agentTouchWeight?: number;
  platformTouchWeight?: number;
  /** Per-type salience prior (ADR-0050): a multiplier on the AMBIENT part of
   *  the blend (recency/velocity/attention/standing/centrality) by `_meta.type`.
   *  Plumbing types (canvas-placement, log, machine-run) declare < 1 so they
   *  stop competing with knowledge in a goal-less read. The `relevance` term is
   *  NOT scaled — a stated intent lifts a demoted type at full strength
   *  (ADR-0052: capability facts stay quiet until a goal names them). */
  typePriors?: Record<string, number>;
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
    centralitySaturation: o?.centralitySaturation ?? 50,
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
    relevanceWeight: o?.relevanceWeight ?? 0,
    rewardWeight: o?.rewardWeight ?? 0,
    humanTouchWeight: o?.humanTouchWeight ?? 1,
    agentTouchWeight: o?.agentTouchWeight ?? 0.25,
    platformTouchWeight: o?.platformTouchWeight ?? 0,
    typePriors: o?.typePriors ?? {},
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

/**
 * Where the LEARNED per-type bias lives — derived, platform-written, and layered
 * UNDER `_config/salience` so a human pin always wins (ADR-0094 Inc 1).
 *
 * `_index/*` is the derived namespace (`_index/overview` is the recall digest,
 * `_index/ranking` the bare-query ranking digest),
 * distinct from `_config/*` which is what the owner asserts.
 */
export const TYPE_BIAS_KEY = '_index/type-bias';

/** Where a scope's bare-query ranking digest lives (see `query`'s hot path). */
export const RANKING_KEY = '_index/ranking';
/** How many ranked keys the digest keeps. A page past the cap goes cold — the
 *  cap exists so the digest stays one comfortably-sized item (~1200 × ~55B ≈
 *  65KB, well under the DynamoDB 400KB item limit) while covering ~30 pages of
 *  a 40-entry paginated load, far beyond any real browse. */
export const RANKING_CAP = 1200;
/** Recompute past this age even at the same seq: recency decay drifts scores
 *  and band membership slowly, and TTL reaps don't advance seq — an hour
 *  bounds both drifts. Same tolerance as the recall digest. */
export const RANKING_MAX_AGE_MS = 60 * 60 * 1000;
/** Bounded staleness under churn (2026-08-01 cost review): a digest whose seq
 *  is behind head still serves if younger than this — so a write burst costs
 *  at most one cold full-partition re-rank per grace window instead of one
 *  per write. The map lags fresh writes by ≤ this; ranking is presentation,
 *  not truth, and every fact read hydrates by point-get regardless. */
export const RANKING_STALE_GRACE_MS = 45 * 1000;

/** The ranking digest's stored shape (parallel arrays keep the item compact). */
interface RankingDigest {
  seq: number;
  at: string;
  /** The full ranked count — `total` for every warm page, even past the cap. */
  total: number;
  keys: string[];
  degrees: number[];
}

/**
 * Only a BARE salience query may touch the ranking digest — no filter, no lens,
 * no intent, no explain: the exact question the cache answered. A top-N cache
 * answering a differently-shaped question is how the grant fold starved
 * `total`; eligibility is the guard against re-learning that lesson here.
 * (`typeRules` stay eligible: they are derived from the scope's own `_types/*`
 * facts, so a change to them advances seq and invalidates the digest.)
 */
export function isBareSalienceQuery(opts?: QueryOptions): boolean {
  return (
    !opts?.type &&
    !opts?.tag &&
    !opts?.tags?.length &&
    !opts?.prefix &&
    !opts?.contains &&
    !opts?.keyFilter &&
    !opts?.relevance &&
    !opts?.lens &&
    !opts?.salience &&
    !opts?.explain &&
    !opts?.includeSuperseded &&
    (opts?.rankBy ?? 'salience') === 'salience'
  );
}

export interface TypeBiasOptions {
  /** Facts of a type before its evidence is fully trusted. Below this the prior
   *  shrinks toward 1 — a type with three facts should not swing the ranking on
   *  one peek. Default 40. */
  confidenceK?: number;
  /** A learned prior is a bias, not a verdict: it can quiet a type but never
   *  silence it, so a wrongly-demoted type stays reachable and can recover. */
  minPrior?: number;
  /** Default 1: the learner DEMOTES ONLY. See the note on `learnTypePriors`. */
  maxPrior?: number;
}

/** A learned prior within this of 1 is not worth recording — keeps the derived
 *  map small and legible next to a hand-written one. */
const BIAS_DEADBAND = 0.05;

/**
 * Learn a per-type salience prior from what the slice actually CHOOSES to read.
 *
 * The signal is deliberate reads per fact, relative to the slice average:
 *
 *     lift(T) = (chosen(T) / Σchosen) / (facts(T) / Σfacts)
 *
 * `chosen` counts human + agent READ touches only. That is the load-bearing
 * detail, and it is what makes this non-circular: **being surfaced is not a
 * touch.** `recall`/`query`/`read`/`getMany` record nothing (ADR-0050 via
 * ADR-0055 — "rendering must not inflate salience"); only `get`/`peek` and the
 * explicit capability wire do. So appearing in the focus band raises a type's
 * DENOMINATOR (its share of the corpus) and never its numerator. A type that
 * keeps winning the band and never gets opened is demoted BY winning it.
 *
 * That inverts the failure mode a naive "popularity" prior would have. It is
 * `adaptive-salience.md`'s evaporation, stated as arithmetic: *"Views never
 * referenced, actions never invoked, state keys never read — these are stale
 * pheromone trails. Salience should track usage, not just existence."*
 *
 * Platform reads (`pr`) are excluded: machinery reading machinery is not a
 * choice. Writes are excluded entirely — a type written constantly by a cell
 * (every `task` status flip, every layout shard) must not thereby look wanted.
 *
 * **It demotes only** (`maxPrior` 1). The first live run promoted
 * `graph-layout-shard`, `config` and `frame` to the ceiling — tiny types that a
 * rendering client and a verification probe fetch BY KEY, over and over. Those
 * are programmatic fetches wearing the owner's identity, and nothing bounds
 * them: a client that polls a fact hard enough can promote its whole type. There
 * is no such hazard on the demotion side, where the floor and the unpriored
 * `relevance` path both guarantee recovery. So the asymmetry is structural, not
 * a tuning choice — and it is what the source doctrine actually says:
 * *"Actively reinforced vocabulary stays prominent. Abandoned vocabulary
 * fades."* Stays prominent is 1. Fades is below it. This is an evaporation
 * mechanism, not a popularity contest.
 *
 * Pure and total: no I/O, no clock. Returns `{}` when there is no evidence at
 * all, so a cold slice ranks exactly as it does today.
 */
export function learnTypePriors(
  records: ReadonlyArray<Pick<StateRecord, 'type' | 'touches' | 'superseded'>>,
  opts?: TypeBiasOptions,
): Record<string, number> {
  const K = opts?.confidenceK ?? 40;
  const min = opts?.minPrior ?? 0.2;
  const max = opts?.maxPrior ?? 1;

  const facts = new Map<string, number>();
  const chosen = new Map<string, number>();
  let totalFacts = 0;
  let totalChosen = 0;
  for (const r of records) {
    if (r.superseded) continue;
    const t = r.type ?? '';
    // Deliberate reads only: a human or an agent asking for THIS fact by key.
    const c = (r.touches?.hr ?? 0) + (r.touches?.ar ?? 0);
    facts.set(t, (facts.get(t) ?? 0) + 1);
    chosen.set(t, (chosen.get(t) ?? 0) + c);
    totalFacts += 1;
    totalChosen += c;
  }
  // No deliberate read anywhere: nothing has been chosen, so nothing is
  // evidence. Stay neutral rather than inventing a ranking.
  if (!totalFacts || !totalChosen) return {};

  // Smooth with pseudo-counts rather than a linear shrink toward 1: a type is
  // judged as if it also carried `K` facts drawn at the slice's own average
  // rate. A type with three facts therefore reads as "mostly average" until it
  // has the exposure to say otherwise, while a type with thousands is judged on
  // its own record. This is the standard fix for a ratio over small denominators
  // — without it, a 3-fact type that happens to absorb half the slice's peeks
  // computes a lift near 80 and pins the ceiling on what is really noise.
  const globalRate = totalChosen / totalFacts;
  const out: Record<string, number> = {};
  for (const [t, n] of facts) {
    const rate = ((chosen.get(t) ?? 0) + K * globalRate) / (n + K);
    const prior = Math.min(max, Math.max(min, rate / globalRate));
    if (Math.abs(prior - 1) > BIAS_DEADBAND) out[t] = Math.round(prior * 100) / 100;
  }
  return out;
}

/** Layer a learned bias under an asserted config. `typePriors` merge per TYPE —
 *  pinning one type must not discard everything the slice learned about the
 *  others — and every other field is the owner's outright. */
export function layerTypeBias(
  learned: Record<string, number> | null | undefined,
  asserted: Partial<SalienceOptions> | null | undefined,
): Partial<SalienceOptions> | null {
  if (!learned || !Object.keys(learned).length) return asserted ?? null;
  return { ...(asserted ?? {}), typePriors: { ...learned, ...(asserted?.typePriors ?? {}) } };
}

/**
 * Reserved key for a scope's DECLARED lens presets (ADR-0078): a fact whose
 * value is `{ <name>: Partial<SalienceOptions> }` — e.g.
 * `{ review: { rewardWeight: 0.4, recencyWeight: 0.2 } }` — names a reusable
 * per-read bias the slice itself defined. The compiled `LENS_PRESETS` five are
 * the FLOOR (never shadowable); an unknown name is ignored, never fatal.
 * Everything that takes `lens` benefits at once — per-call reads and adopted
 * posture (ADR-0074) alike — because resolution happens inside `callSalience`.
 */
export const LENSES_CONFIG_KEY = '_config/lenses';

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
  'relevanceWeight',
  'rewardWeight',
  'humanTouchWeight',
  'agentTouchWeight',
  'platformTouchWeight',
  'focusThreshold',
  'elideThreshold',
] as const satisfies ReadonlyArray<keyof SalienceOptions>;
const SALIENCE_UNIT_KEYS = new Set<keyof SalienceOptions>(['focusThreshold', 'elideThreshold']);
/** Cap on a configured type prior — a prior is a bias, not a bypass. */
const TYPE_PRIOR_MAX = 2;

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
  const out: Record<string, unknown> = {};
  for (const k of SALIENCE_NUMERIC_KEYS) {
    const v = rec[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue;
    out[k] = SALIENCE_UNIT_KEYS.has(k) ? Math.min(v, 1) : v;
  }
  // Per-type priors (ADR-0050): a `{ type: multiplier }` map; only finite
  // non-negative numbers survive, capped so a prior biases rather than bypasses.
  if (rec.typePriors && typeof rec.typePriors === 'object') {
    const priors: Record<string, number> = {};
    for (const [t, v] of Object.entries(rec.typePriors as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) priors[t] = Math.min(v, TYPE_PRIOR_MAX);
    }
    if (Object.keys(priors).length) out.typePriors = priors;
  }
  return Object.keys(out).length ? (out as Partial<SalienceOptions>) : null;
}

/**
 * Extract sanitized declared lens presets (ADR-0078) from a `_config/lenses`
 * fact's value: `{ <name>: Partial<SalienceOptions> }`, each preset run through
 * the same defensive numeric filter as `_config/salience` (a config fact must
 * never be able to break a read). Accepts the map directly or wrapped under a
 * `lenses` key. Floor names are dropped here (never shadowable). Returns `null`
 * when nothing usable is present.
 */
export function parseLensesConfig(value: unknown): Record<string, Partial<SalienceOptions>> | null {
  const wrapped = value as { lenses?: unknown } | null | undefined;
  const src =
    wrapped && typeof wrapped === 'object' && wrapped.lenses && typeof wrapped.lenses === 'object'
      ? wrapped.lenses
      : value;
  if (!src || typeof src !== 'object') return null;
  const out: Record<string, Partial<SalienceOptions>> = {};
  for (const [name, preset] of Object.entries(src as Record<string, unknown>)) {
    if (!name || name.length > 64) continue;
    if ((LENS_PRESETS as Record<string, unknown>)[name] !== undefined) continue; // the floor wins
    const parsed = parseSalienceConfig(preset);
    if (parsed) out[name] = parsed;
  }
  return Object.keys(out).length ? out : null;
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

/**
 * The intent lens (ADR-0051): the weight shift a read gets when the caller
 * states what it is reading FOR (`text`). Relevance leads; the activity terms
 * keep enough weight that, among equally-relevant facts, the attended ones
 * still rise. Sums to 1 like the named lenses. Layered as a per-call override
 * base — an explicit caller `salience` still wins on top.
 */
export const INTENT_PRESET: Partial<SalienceOptions> = {
  recencyWeight: 0.2,
  velocityWeight: 0.05,
  attentionWeight: 0.1,
  standingWeight: 0.15,
  centralityWeight: 0.1,
  relevanceWeight: 0.4,
};

/** Resolve the salience params for one call: instance defaults ← lens preset ←
 *  raw override. Returns the base unchanged when neither is set. A raw override
 *  is NOT auto-normalized (it's an escape hatch — the caller owns the weights).
 *  Lens resolution (ADR-0078): the compiled floor first (never shadowable),
 *  then the scope's declared `_config/lenses` presets; an unknown name is
 *  ignored — a lens can bias a read, never break one. */
function callSalience(
  base: ResolvedSalience,
  lens?: string,
  override?: Partial<SalienceOptions>,
  declared?: Record<string, Partial<SalienceOptions>> | null,
): ResolvedSalience {
  const preset = lens ? ((LENS_PRESETS as Record<string, Partial<SalienceOptions> | undefined>)[lens] ?? declared?.[lens]) : undefined;
  if (!preset && !override) return base;
  return resolveSalience({ ...base, ...preset, ...override });
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

/**
 * A record's persisted touch counters → weighted activity signals (ADR-0050).
 * Lifetime terms come from the cumulative counters (no trajectory scan — and no
 * 24h TTL silently amputating "lifetime"); window terms from the current burst
 * bucket (a stale bucket reads zero: the burst has passed). Each touch counts
 * at its actor class's weight, so machinery churn stops manufacturing salience.
 */
export function touchSignals(
  rec: Pick<StateRecord, 'touches' | 'window'>,
  nowMs: number,
  s: Pick<ResolvedSalience, 'windowMs' | 'humanTouchWeight' | 'agentTouchWeight' | 'platformTouchWeight'>,
): Omit<KeySignals, 'degree'> {
  const wh = s.humanTouchWeight;
  const wa = s.agentTouchWeight;
  const wp = s.platformTouchWeight;
  const reads = (t?: TouchCounters): number => wh * (t?.hr ?? 0) + wa * (t?.ar ?? 0) + wp * (t?.pr ?? 0);
  const writes = (t?: TouchCounters): number => wh * (t?.hw ?? 0) + wa * (t?.aw ?? 0) + wp * (t?.pw ?? 0);
  const bucket = s.windowMs > 0 ? Math.floor(nowMs / s.windowMs) : 0;
  const win = rec.window && rec.window.b === bucket ? rec.window : undefined;
  return {
    windowReads: reads(win),
    windowWrites: writes(win),
    lifetimeReads: reads(rec.touches),
    lifetimeWrites: writes(rec.touches),
  };
}

/** Per-key term breakdown, for `_meta` instrumentation (Q4: measure, don't assert). */
export interface ScoreParts {
  score: number;
  recency: number;
  velocity: number;
  attention: number;
  standing: number;
  centrality: number;
  /** Cosine similarity to the read's intent (`text`), 0 when none (ADR-0051). */
  relevance: number;
  /** The fact's persisted earned-salience term, 0 when unset (ADR-0070). */
  reward: number;
  /** The type prior the blend was multiplied by (ADR-0050); 1 when undeclared. */
  prior: number;
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
  args: { updatedAtMs: number; nowMs: number; relevance?: number; reward?: number; prior?: number } & Partial<KeySignals>,
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
  // Log-compressed like standing (ADR-0050): degree 1 still registers (~0.18 at
  // the default 50) but a hub keeps discriminating instead of pinning at 1.
  const centrality =
    s.centralitySaturation > 0 ? Math.min(Math.log1p(args.degree ?? 0) / Math.log1p(s.centralitySaturation), 1) : 0;
  const relevance = clamp01(args.relevance ?? 0);
  const reward = clamp01(args.reward ?? 0);
  const prior = args.prior ?? 1;
  // The type prior scales the AMBIENT terms only — "plumbing when you have no
  // intent" is a statement about the intent-free part of the blend. Relevance
  // rides unprioered, so a matching goal genuinely lifts a demoted type
  // (ADR-0052: a capability fact stays quiet until an intent names it).
  // Reward rides unprioered too (ADR-0070): earned importance is fact-specific,
  // not an ambient type bias — and its weight defaults to 0, so it is inert
  // until a config/lens/override opts in.
  const score = clamp01(
    prior *
      (s.recencyWeight * recency +
        s.velocityWeight * velocity +
        s.attentionWeight * attention +
        s.standingWeight * standing +
        s.centralityWeight * centrality) +
      s.relevanceWeight * relevance +
      s.rewardWeight * reward,
  );
  return { score, recency, velocity, attention, standing, centrality, relevance, reward, prior };
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
// graph — what `links` and `changes` report — stays clean. (`attention.unlinked`
// counts placement/evidence derivations as connectivity, but never the pure
// backbone: an `instanceOf` must not mask an unwoven fact.)

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
 *  `inView` a view, `inDoc` a doc, `onBoard` a board — and, generically (ADR-0057,
 *  the one collections family), `memberOf` a `collection:` fact. A collection's
 *  extensional members are the facts with one of these edges pointing at it. */
export const MEMBERSHIP_RELS = new Set<string>(['inView', 'inDoc', 'onBoard', 'memberOf']);

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
      // key-encoded: parse this fact's key, emit the declared edge(s). A
      // placeholder's per-segment key regex (`[^/]+`, compileKeyPattern) can't
      // capture a group that itself spans multiple `/`-separated path
      // components — e.g. `_doc/{doc}/{block}` breaks the moment `doc` is a
      // nested path slug (`docs/architecture/adr/x`), which is now the norm
      // for ADR-0081-synced docs (2026-07-12 lit-doc-empties incident: the key
      // regex silently matched nothing, so EVERY such doc's membership derived
      // to zero). There's no way to disambiguate that generically from the key
      // alone (the doc slug is embedded twice with no distinguishing
      // delimiter), so a placeholder the key couldn't bind falls back to a
      // same-named field on the fact's own VALUE — the source of truth moves
      // from "parse it back out of the key" to "the writer already told us."
      if (rules.keyPattern && rules.keyEdges?.length) {
        const compiled = compileKeyPattern(rules.keyPattern);
        if (compiled) {
          const groups = compiled.rx.exec(r.key);
          const g: Record<string, string> = {};
          if (groups) compiled.names.forEach((n, i) => (g[n] = groups[i + 1]));
          for (const n of compiled.names) {
            if (g[n] !== undefined) continue;
            const v = value[n];
            if (typeof v === 'string' && v) g[n] = v;
          }
          if (compiled.names.every((n) => g[n] !== undefined)) {
            // `source: r.key` = the decoration that ordered/placed the member, so
            // extensional membership can recover its narrative `seq` (ADR-0005).
            for (const e of rules.keyEdges) push(substGroups(e.from, g), substGroups(e.rel, g), substGroups(e.to, g), true, MEMBERSHIP_STRENGTH, r.key);
          }
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
  /** CAS (proof-of-read, ADR-0066): require the stored content hash to equal this.
   *  `""` = the key must not exist (create-only). Unforgeable without a read. */
  ifVersion?: string;
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
  /**
   * Earned salience (ADR-0070): set/replace this fact's persisted `reward` in
   * [0,1] (clamped). Omit to preserve what is stored — like the import seeds.
   * Weighted by `rewardWeight` (default 0), so writing it is inert until a
   * config/lens/override opts in.
   */
  reward?: number;
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
  /** Bias salience for this read via a named lens — compiled
   *  (recent/connected/durable/active) or slice-declared (`_config/lenses`,
   *  ADR-0078). Unknown names are ignored. */
  lens?: SalienceLens | (string & {});
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
  /** Declared lens presets to resolve `lens` against (ADR-0078) — same
   *  handler-supplied semantics as `salienceConfig` (recall passes the
   *  viewer's); `undefined` = load this scope's own `_config/lenses`. */
  lensesConfig?: Record<string, Partial<SalienceOptions>> | null;
  /** Resolved per-type Reference rules (`cells.describeTypes` → resolveType): manager
   *  (managedBy), `ref` fields (embedded edges), keyPattern/keyEdges. Injected by the handler. */
  typeRules?: Record<string, TypeRules>;
  /** Per-key relevance to the read's intent (ADR-0051): cosine similarity from
   *  the vector index for a caller-supplied `text`, keyed by fact key. Feeds the
   *  `relevance` signal (weight via `relevanceWeight` / the intent preset); keys
   *  absent from the map score relevance 0. Injected by the handler. */
  relevance?: Record<string, number>;
}

export interface QueryOptions {
  /** Only facts of this indexable type (GSI-served in production). */
  type?: string;
  /** Only facts carrying this tag. */
  tag?: string;
  /** Only facts carrying at least one of these tags (match-any; W4i). */
  tags?: string[];
  /** Only keys with this prefix. */
  prefix?: string;
  /**
   * An arbitrary key predicate, applied with `prefix`/`tag`/`contains` — BEFORE
   * ranking, the page slice, and `total`.
   *
   * This exists for visibility folds. A caller assembling a granted view has a
   * membership rule (`grantCovers` over a grant's patterns) that cannot be
   * expressed as one prefix, and filtering AFTER the query means the page cap
   * has already been spent on facts the viewer cannot see — so `total` counts
   * survivors of a truncation rather than the covered set. Measured 2026-07-29:
   * an unauthenticated home graph reported `20/20` against ~135 genuinely public
   * facts, because 115 of them were `doc-block:*` at salience 0.12–0.14 and the
   * owner's top 1200 of 8,600 facts never reached them.
   *
   * Kept as a predicate rather than a grant-shaped option so the platform stays
   * ignorant of grant vocabulary — this layer knows keys, not authority. It is
   * a FILTER only: it can never widen what the query would otherwise return.
   */
  keyFilter?: (key: string) => boolean;
  /** Ranking: read-time salience (default), last-write recency, or intent
   *  relevance (ADR-0085 Inc 3 — the default when a `relevance` map is present:
   *  an intent query is "which few entries matter for THIS goal", so cosine
   *  drives the order and salience only breaks ties; keys the intent didn't
   *  reach are dropped, not padded in by standing salience). */
  rankBy?: 'salience' | 'recency' | 'relevance';
  /** Bias salience for this query via a named lens — compiled or
   *  slice-declared (`_config/lenses`, ADR-0078). Unknown names are ignored. */
  lens?: SalienceLens | (string & {});
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
  /** Per-key relevance to the query's intent (ADR-0051) — see `ReadOptions.relevance`. */
  relevance?: Record<string, number>;
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
  /** Reference rules for the derived projection, so placement/evidence edges
   *  (a `ref` field, an `onBoard`/`inDoc` decoration) count as connectivity. */
  typeRules?: Record<string, TypeRules>;
  /** `standing` at or above which an old fact is *settled* (earned its idleness)
   *  rather than stale. Default 0.25. */
  settledStanding?: number;
}

export interface AttentionResult {
  /** Old facts that have NOT earned their idleness (no authored structure, low
   *  standing) — the actionable rot, oldest first, capped at `limit`. */
  stale: Array<{ key: string; updatedAt: string; type: string | null }>;
  /** Facts with no asserted or placed connectivity — no authored edge (inferred
   *  `similarTo` doesn't count), no embedded-ref edge, no membership placement
   *  (`onBoard`/`inDoc`). The pure type backbone (`instanceOf`/`managedBy`/
   *  `rendersWith`) and query-derived `inView` never mask the weave signal.
   *  Capped at `limit`. */
  unlinked: string[];
  /** Edges whose endpoints are missing or retired without a successor. Capped at `limit`. */
  dangling: Array<{ from: string; rel: string; to: string; reason: string }>;
  /** Uncapped totals — the capped arrays above are samples; these are the real
   *  counts, so an observer (or a machine's Assess node) can see trend, not a
   *  saturated constant. */
  staleTotal: number;
  unlinkedTotal: number;
  danglingTotal: number;
  /** Old facts recognised as settled (authored structure or earned standing) and
   *  deliberately NOT flagged stale — age alone is not rot. */
  settled: number;
}

export interface SupersedeOptions {
  /** Re-point the fact's edges at the successor (requires `by`). */
  migrateLinks?: boolean;
}

export interface ObservedState {
  put(input: WriteInput, identity?: Identity): Promise<Entry>;
  get(scope: string, key: string, identity?: Identity): Promise<Entry | null>;
  /** Record attention on a fact WITHOUT reading it (ADR-0050 counters, ADR-0085
   *  usage signal): one actor-classed counter increment, absent-key-safe (a miss
   *  is a silent no-op). The capability-salience wire rides this — invoking a
   *  verb touches its `_caps/<target>` fact, so used capabilities accrue
   *  attention/velocity/standing and rise through recall like any other fact.
   *  `op` follows the fact semantics: 'read' feeds attention, 'write' velocity. */
  touch(scope: string, key: string, identity?: Identity, op?: 'read' | 'write'): Promise<void>;
  /** Batched, TOUCH-FREE entry read (ADR-0055 `include:'entries'`): a change-feed
   *  page inlining its post-write facts is a projection, not attention — no read
   *  touch is recorded (ADR-0050: rendering must not inflate salience). Superseded
   *  entries return wrapped (the `_meta.superseded` marker IS the tombstone);
   *  absent/expired keys map to null. */
  getMany(scope: string, keys: string[]): Promise<Record<string, Entry | null>>;
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
  /** The scope's declared lens presets (`_config/lenses`, ADR-0078), sanitized —
   *  the handler-facing accessor (recall folds granted slices under the
   *  VIEWER's declared lenses, exactly as with `salienceConfig`). */
  lensesConfig(scope: string): Promise<Record<string, Partial<SalienceOptions>> | null>;
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
   *  `limit` pages FORWARD from sinceSeq; `last` keeps the NEWEST n instead (still ascending) — the "recent activity" window (ADR-0048).
   *  `filter` (ADR-0055) drops out-of-scope events server-side BEFORE windowing, so `last: n` means "the newest n RELEVANT events";
   *  the returned head `seq` stays global, so an empty filtered page + advanced seq is progress, not silence. */
  changes(scope: string, sinceSeq: number | 'head', limit?: number, last?: number, filter?: ChangesScope): Promise<ChangesResult>;
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

  /** Build per-key GRAPH signals (degree) for a whole scope in one edge pass.
   *  Activity signals no longer come from here: lifetime + window terms live on
   *  each record as actor-classed counters (ADR-0050 — `touchSignals`), so the
   *  trajectory is never scanned to score a read. Callers in bulk paths build
   *  this once and share it across `wrap`s. */
  async function signalsFor(
    scope: string,
    nowMs: number,
    windowMs: number,
    records?: StateRecord[],
    typeRules?: Record<string, TypeRules>,
  ): Promise<Map<string, KeySignals>> {
    const [edges, recs] = await Promise.all([
      store.listEdges(scope),
      records ? Promise.resolve(records) : store.list(scope),
    ]);
    // Centrality counts the derived backbone alongside authored edges, so a
    // typed-but-unlinked fact earns a structural floor instead of scoring zero.
    return buildSignals([], [...edges, ...deriveBackboneEdges(recs, typeRules)], nowMs, windowMs);
  }

  /** Load a scope's `_config/salience` policy (best-effort: a missing, retired, or
   *  malformed fact yields `null` and the read proceeds on instance defaults — a
   *  config fact must never be able to break a read). */
  /** Load a scope's declared lens presets (`_config/lenses`, ADR-0078) — same
   *  best-effort posture as the salience config: absent/retired/malformed ⇒ null. */
  async function loadLensesConfig(scope: string): Promise<Record<string, Partial<SalienceOptions>> | null> {
    let rec: StateRecord | null;
    try {
      rec = await store.get(scope, LENSES_CONFIG_KEY);
    } catch {
      return null;
    }
    if (!rec || rec.superseded || !isTimerLive(rec, Date.now())) return null;
    return parseLensesConfig(rec.value);
  }

  async function loadSalienceConfig(scope: string): Promise<Partial<SalienceOptions> | null> {
    // Both reads are store-side (no touch, no seq): reading your own policy must
    // not itself register as attention. Either may be absent; either may fail.
    const [asserted, learned] = await Promise.all([
      store
        .get(scope, SALIENCE_CONFIG_KEY)
        .then((rec) => (!rec || rec.superseded || !isTimerLive(rec, Date.now()) ? null : parseSalienceConfig(rec.value)))
        .catch(() => null),
      loadTypeBias(scope),
    ]);
    // defaults ← LEARNED bias ← asserted config. A human pin always wins, per
    // type, so the owner can correct the learner without discarding it.
    return layerTypeBias(learned, asserted);
  }

  /** The scope's cached bare-query ranking (see the hot-path comment in
   *  `query`). Served when seq-exact — OR when merely SECONDS stale (bounded
   *  staleness, 2026-08-01 cost review): the old seq-exact-only rule meant a
   *  WRITE BURST (docs-sync chains, a tuner drag, a cell push) invalidated the
   *  digest on every write, sending every concurrent page query cold — two
   *  full-partition reads each, thousands of times per burst (the Jul 29-30
   *  storm re-ranked its way to ~900M RRUs). A star map does not need
   *  write-level freshness: during churn we serve a ranking up to
   *  {@link RANKING_STALE_GRACE_MS} old and let AT MOST one cold recompute per
   *  grace window absorb the drift. Malformed or genuinely stale → `null`,
   *  cold path. */
  async function readRanking(scope: string): Promise<RankingDigest | null> {
    try {
      const [rec, head] = await Promise.all([store.get(scope, RANKING_KEY), store.currentSeq(scope)]);
      const v = rec?.value as RankingDigest | undefined;
      const shaped =
        !!v &&
        typeof v.seq === 'number' &&
        typeof v.total === 'number' &&
        Array.isArray(v.keys) &&
        Array.isArray(v.degrees) &&
        v.keys.length === v.degrees.length &&
        Date.now() - Date.parse(v.at) < RANKING_MAX_AGE_MS;
      if (!shaped) return null;
      const fresh = v.seq === head || Date.now() - Date.parse(v.at) < RANKING_STALE_GRACE_MS;
      return fresh ? v : null;
    } catch {
      return null;
    }
  }

  /** Persist a bare query's ranking (ordered keys + per-key degree, capped) as
   *  the scope's ranking digest — raw-store write (a cache is not a fact: no
   *  seq advance, no trajectory, no reaction), best-effort like the recall
   *  digest. Degree rides along because it is the one `wrap` input that needs
   *  the full-partition reads; a write invalidates the digest at the next
   *  grace-window boundary (see readRanking's bounded staleness), so a cached
   *  degree is never more than seconds behind. */
  async function writeRanking(
    scope: string,
    head: number,
    ranked: Array<{ key: string }>,
    signals: Map<string, KeySignals>,
  ): Promise<void> {
    try {
      const top = ranked.slice(0, RANKING_CAP);
      const now = new Date().toISOString();
      const prev = await store.get(scope, RANKING_KEY);
      const value: RankingDigest = {
        seq: head,
        at: now,
        total: ranked.length,
        keys: top.map((e) => e.key),
        degrees: top.map((e) => signals.get(e.key)?.degree ?? 0),
      };
      await store.put({
        scope,
        key: RANKING_KEY,
        value,
        revision: (prev?.revision ?? 0) + 1,
        seq: head,
        firstSeq: prev?.firstSeq ?? head,
        writer: 'platform/digest',
        via: 'query:ranking',
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
      /* not cached this time — the next cold bare query retries */
    }
  }

  /** The derived per-type bias (`_index/type-bias`), sanitized through the same
   *  defensive filter as an asserted config — a derived fact is still a fact,
   *  and a corrupt one must never be able to break a read. */
  async function loadTypeBias(scope: string): Promise<Record<string, number> | null> {
    try {
      const rec = await store.get(scope, TYPE_BIAS_KEY);
      if (!rec || rec.superseded || !isTimerLive(rec, Date.now())) return null;
      const parsed = parseSalienceConfig(rec.value);
      return parsed?.typePriors ?? null;
    } catch {
      return null;
    }
  }

  /** The per-call base: a scope's config layered over the instance defaults, sitting
   *  below the lens + per-call override (defaults ← config ← lens ← override). */
  const baseSalience = (cfg?: Partial<SalienceOptions> | null): ResolvedSalience =>
    cfg ? resolveSalience({ ...s, ...cfg }) : s;

  /** Wrap a stored record into a read-facing entry with a computed score. Pass a
   *  precomputed `signals` map (bulk paths) to avoid a per-record scope scan, and
   *  `sCall` to score under a per-read lens (defaults to the instance settings).
   *  `relevance` is the read's per-key intent map (ADR-0051), when it has one. */
  async function wrap(
    rec: StateRecord,
    nowMs: number,
    signals?: Map<string, KeySignals>,
    sCall: ResolvedSalience = s,
    explain = false,
    relevance?: Record<string, number>,
  ): Promise<Entry> {
    const sig = (signals ?? (await signalsFor(rec.scope, nowMs, sCall.windowMs))).get(rec.key) ?? EMPTY_SIGNALS;
    // Activity terms come from the record's own actor-classed counters; import
    // priors fold into the cumulative (standing) counts only — never the recent
    // window — so a ported fact's earned importance shows without faking
    // current activity. The window bucket is keyed by the INSTANCE windowMs so
    // read and write agree on bucket boundaries regardless of per-call lenses.
    const touch = touchSignals(rec, nowMs, { ...sCall, windowMs: s.windowMs });
    const rel = relevance?.[rec.key];
    const parts = scoreParts(
      {
        updatedAtMs: Date.parse(rec.updatedAt),
        nowMs,
        ...touch,
        degree: sig.degree,
        lifetimeReads: touch.lifetimeReads + (rec.seedReads ?? 0),
        lifetimeWrites: touch.lifetimeWrites + (rec.seedWrites ?? 0),
        relevance: rel,
        reward: rec.reward,
        prior: sCall.typePriors[rec.type ?? ''] ?? 1,
      },
      sCall,
    );
    const windowMin = sCall.windowMs / 60000;
    return {
      value: rec.value,
      _meta: {
        revision: rec.revision,
        // Proof-of-read token (ADR-0066): computed for pre-ADR facts that lack it.
        version: rec.version || contentHash(rec.value),
        seq: rec.seq,
        writer: rec.writer,
        via: rec.via,
        ...(rec.as ? { as: rec.as } : {}),
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
        velocity: round4(windowMin > 0 ? touch.windowWrites / windowMin : 0),
        standing: round4(parts.standing),
        centrality: round4(parts.centrality),
        ...(rel !== undefined ? { relevance: round4(parts.relevance) } : {}),
        ...(rec.reward !== undefined ? { reward: round4(parts.reward) } : {}),
        elided: false,
        ...(explain ? { explain: explainScore(parts, { ...sig, ...touch }, sCall) } : {}),
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
      relevance: round4(parts.relevance),
      reward: round4(parts.reward),
    };
    const weights = {
      recency: sCall.recencyWeight,
      velocity: sCall.velocityWeight,
      attention: sCall.attentionWeight,
      standing: sCall.standingWeight,
      centrality: sCall.centralityWeight,
      relevance: sCall.relevanceWeight,
      reward: sCall.rewardWeight,
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
        relevance: round4(parts.relevance * weights.relevance),
        reward: round4(parts.reward * weights.reward),
      },
      degree: sig.degree ?? 0,
      prior: parts.prior,
    };
  }

  /** The burst-window bucket ordinal for `nowMs`, on the INSTANCE windowMs so
   *  every writer and reader of a scope agrees on bucket boundaries. */
  const bucketOf = (nowMs: number): number => (s.windowMs > 0 ? Math.floor(nowMs / s.windowMs) : 0);

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
      // ADR-0024 §3: a delegated credential stamps its LEAF actor — the
      // sub-agent that actually wrote — while authorization stays anchored to
      // identity.user (the subject). Root tokens stamp the user, unchanged.
      const writer = leafActOf(identity) ?? identity?.user ?? null;
      const now = new Date();
      const nowMs = now.getTime();
      const nowIso = now.toISOString();
      const prev = await store.get(input.scope, input.key);
      // CAS sees the *live* view: an expired-delete fact counts as absent
      // (that lapse is exactly what makes a lease claim crash-safe).
      const livePrev = prev && isTimerLive(prev, nowMs) ? prev : null;

      // CAS: fail fast on what we just read; the store's revision guard
      // closes the remaining race window atomically.
      const hasCas = input.ifRevision !== undefined || !!input.ifAbsent || input.ifVersion !== undefined;
      if (hasCas) {
        if (input.ifAbsent && livePrev) {
          throw new StatePreconditionError(`"${input.key}" already exists (revision ${livePrev.revision})`);
        }
        if (input.ifRevision !== undefined && (livePrev?.revision ?? 0) !== input.ifRevision) {
          throw new StatePreconditionError(
            `"${input.key}" is at revision ${livePrev?.revision ?? 0}, expected ${input.ifRevision}`,
          );
        }
        // Proof-of-read (ADR-0066): the caller must echo the current content hash.
        // `""` asserts the key is absent (create-only). Pre-ADR facts have no stored
        // `version`, so hash the live value on the fly — the same fn used everywhere,
        // over the same stored value, so it agrees with the read that produced the token.
        if (input.ifVersion !== undefined) {
          const liveVersion = livePrev ? (livePrev.version || contentHash(livePrev.value)) : '';
          if (liveVersion !== input.ifVersion) {
            throw new StatePreconditionError(
              `"${input.key}" failed proof-of-read (content changed since it was read)`,
            );
          }
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
        // Proof-of-read token (ADR-0066): the value's content hash, persisted so
        // reads can hand it out and a later `ifVersion` write can demand it back.
        version: contentHash(input.value),
        // physical continuity even across a lapsed lease — monotonic always
        revision: (prev?.revision ?? 0) + 1,
        seq,
        firstSeq: prev?.firstSeq ?? seq,
        writer,
        via: input.via ?? null,
        // The participant key (ADR-0086): WHICH embodied actor within the
        // writer's connection acted. Provenance beside `via`, never authority.
        ...(identity?.participant ? { as: identity.participant } : {}),
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
        // Earned salience (ADR-0070): set/replace when supplied, else preserved —
        // the same carry rule as the import seeds. Clamped: a reward is a signal
        // in [0,1], not an unbounded boost.
        ...(input.reward !== undefined || prev?.reward !== undefined
          ? { reward: clamp01(input.reward ?? prev?.reward ?? 0) }
          : {}),
        // Actor-classed touch counters (ADR-0050): a write folds its own touch
        // into the record it rewrites — no extra round trip, no trajectory scan
        // to reconstruct "lifetime" later.
        touches: bumpTouches(prev?.touches, actorOf(identity), 'write'),
        window: bumpWindow(prev?.window, actorOf(identity), 'write', bucketOf(nowMs)),
      };
      await store.put(record, hasCas ? { expectRevision: prev?.revision ?? null } : undefined);
      // The trajectory write event carries the (possibly historical) updatedAt so
      // an import doesn't read as a recent burst.
      await store.appendTrajectory({ op: 'write', scope: input.scope, key: input.key, at: record.updatedAt, seq });
      return wrap(record, nowMs);
    },

    async get(scope: string, key: string, identity?: Identity): Promise<Entry | null> {
      const rec = await store.get(scope, key);
      const now = new Date();
      if (!rec || !isTimerLive(rec, now.getTime())) return null;
      // Reading is attention — recorded as ONE actor-classed counter increment
      // (ADR-0050), not a seq allocation + trajectory event: reads no longer
      // serialize on the write path or manufacture trajectory the scorer must
      // scan. The entry is wrapped from the pre-touch record; the bump shows on
      // the next read (attention is about the future ranking, not this response).
      await store.recordTouch(scope, key, actorOf(identity), 'read', bucketOf(now.getTime()));
      return wrap(rec, now.getTime());
    },

    async touch(scope: string, key: string, identity?: Identity, op: 'read' | 'write' = 'read'): Promise<void> {
      // The bare counter bump `get` performs, without the read: no seq, no
      // trajectory event, no value returned. recordTouch's conditional update
      // makes an absent key a no-op, so callers may touch speculatively (e.g.
      // a capability target whose `_caps/*` projection hasn't covered it yet).
      await store.recordTouch(scope, key, actorOf(identity), op, bucketOf(Date.now()));
    },

    async getMany(scope: string, keys: string[]): Promise<Record<string, Entry | null>> {
      if (!keys.length) return {};
      const nowMs = Date.now();
      // One signals pass for the whole batch — wrap would otherwise rescan the
      // scope per key. Touch-free by design (see the interface note).
      const signals = await signalsFor(scope, nowMs, s.windowMs);
      const out: Record<string, Entry | null> = {};
      await Promise.all(
        keys.map(async (key) => {
          const rec = await store.get(scope, key);
          out[key] = rec && isTimerLive(rec, nowMs) ? await wrap(rec, nowMs, signals) : null;
        }),
      );
      return out;
    },

    shape(entries: Record<string, Entry>, opts?: ReadOptions): ReadResult {
      // Re-tiers an already-scored set, so a lens here only adjusts thresholds
      // (it can't recompute scores without the scope's signals). Being scopeless,
      // it takes the salience config explicitly (recall passes the viewer's).
      return shapeEntries(entries, opts, callSalience(baseSalience(opts?.salienceConfig), opts?.lens, opts?.salience, opts?.lensesConfig));
    },

    async read(scope: string, opts?: ReadOptions, _identity?: Identity): Promise<ReadResult> {
      const nowMs = Date.now();
      // Honor a handler-supplied config (recall scores granted slices under the
      // viewer's policy); otherwise load this scope's own `_config/salience`.
      const cfg = opts?.salienceConfig !== undefined ? opts.salienceConfig : await loadSalienceConfig(scope);
      const lenses = opts?.lensesConfig !== undefined ? opts.lensesConfig : await loadLensesConfig(scope);
      const sCall = callSalience(baseSalience(cfg), opts?.lens, opts?.salience, lenses);
      const records = await store.list(scope);
      const signals = await signalsFor(scope, nowMs, sCall.windowMs, records, opts?.typeRules);

      // Score every live entry (no elision yet); shape in one pass below.
      // (A scope-wide read is NOT per-fact attention — no touch, no trajectory:
      // reads are free, per ADR-0050.)
      const scored: Record<string, Entry> = {};
      for (const rec of records) {
        if (rec.superseded && !opts?.includeSuperseded) continue;
        if (!isTimerLive(rec, nowMs)) continue;
        scored[rec.key] = await wrap(rec, nowMs, signals, sCall, opts?.explain, opts?.relevance);
      }

      return shapeEntries(scored, opts, sCall);
    },

    async query(scope: string, opts?: QueryOptions, _identity?: Identity): Promise<QueryResult> {
      const nowMs = Date.now();
      // ── the ranking digest: the bare-query hot path (paginated graph loads) ──
      //
      // A bare salience query — no filters, no lens, no intent — is what a
      // paginated surface (the home graph) issues over and over with only the
      // cursor changing. The cold path below costs TWO full-partition reads
      // (every fact, then every edge for centrality) plus a full re-rank, PER
      // PAGE, because the cursor is an offset into a fresh ranking. Twenty pages
      // of forty entries re-read and re-scored an 8,600-fact slice twenty times.
      //
      // The recall digest (ADR-0050 move 4) already established the answer:
      // seq-validate a cached computation against the scope's write head. Here
      // the cached computation is the RANKING — the ordered keys plus each key's
      // graph degree, which is the ONLY signal `wrap` needs that comes from the
      // full-partition reads; every other input is on the page's own records.
      // So a warm page is: one digest get + one seq get + the page's records by
      // point-get — O(page), not O(slice) — and `wrap` recomputes the same meta
      // it would have cold (recency live, degree from the digest, and the digest
      // can never serve a stale degree because ANY write advances seq).
      //
      // Anything filtered or exotic (type/tag/prefix/contains/keyFilter/lens/
      // relevance/explain/includeSuperseded/rankBy≠salience) takes the cold path
      // unchanged — a top-N cache must never answer a differently-shaped
      // question (that is how the grant fold starved `total`).
      const bare = isBareSalienceQuery(opts);
      const offset0 = opts?.cursor ? Math.max(0, Number.parseInt(opts.cursor, 10) || 0) : 0;
      if (bare && opts?.limit !== undefined) {
        const warm = await readRanking(scope);
        if (warm) {
          const end = offset0 + Math.max(0, opts.limit);
          const complete = warm.keys.length >= warm.total;
          if (offset0 >= warm.total) {
            return { entries: [], count: 0, total: warm.total };
          }
          if (end <= warm.keys.length || complete) {
            const sCall = callSalience(baseSalience(await loadSalienceConfig(scope)), undefined, undefined, await loadLensesConfig(scope));
            const pageKeys = warm.keys.slice(offset0, end);
            const degreeOf = new Map(pageKeys.map((k, i) => [k, warm.degrees[offset0 + i] ?? 0]));
            // Point-gets, not a partition read. A key gone dead since the digest
            // was written is impossible via a write (seq invalidates) but
            // possible via a lapsed timer or TTL reap (no seq advance) — drop
            // those defensively; the page shrinks by a hair rather than lies.
            const recs = (await Promise.all(pageKeys.map((k) => store.get(scope, k)))).filter(
              (r): r is StateRecord => !!r && !r.superseded && isTimerLive(r, nowMs),
            );
            const pageSignals = new Map(recs.map((r) => [r.key, { ...EMPTY_SIGNALS, degree: degreeOf.get(r.key) ?? 0 }]));
            const entries = await Promise.all(
              recs.map(async (rec) => ({ key: rec.key, ...(await wrap(rec, nowMs, pageSignals, sCall)) })),
            );
            // Cursor consumption counts RANKING SLOTS, not surviving entries, so
            // a defensive drop can never re-serve the same slot.
            const consumed = offset0 + pageKeys.length;
            return {
              entries,
              count: entries.length,
              total: warm.total,
              ...(consumed < warm.total ? { nextCursor: String(consumed) } : {}),
            };
          }
          // Fresh digest, but the page reaches past the cached cap → cold.
        }
      }
      // Captured BEFORE the partition read, so a write racing the computation
      // can only make the stored ranking conservatively stale, never wrongly
      // fresh (the same ordering rule as the recall digest).
      const rankingHead = bare && opts?.limit !== undefined ? await store.currentSeq(scope) : null;
      const sCall = callSalience(baseSalience(await loadSalienceConfig(scope)), opts?.lens, opts?.salience, await loadLensesConfig(scope));
      const queryTypeRules = opts?.typeRules;
      // Type is index-served; tag/prefix filter the (bounded) candidate set.
      const records = opts?.type ? await store.listByType(scope, opts.type) : await store.list(scope);
      // Reuse the full-partition read for signals when there's no type filter —
      // otherwise `signalsFor` issues a SECOND `store.list(scope)` (a duplicate
      // multi-page DDB scan, ~half the query's latency). With a type filter the
      // candidates are a subset, so signals still need the whole graph.
      const signals = await signalsFor(scope, nowMs, sCall.windowMs, opts?.type ? undefined : records, queryTypeRules);
      const candidates = records.filter((rec) => {
        // A cache is not content (recall's rule for its digest, applied to the
        // whole `_index/` derived namespace): the ranking digest would otherwise
        // surface as a pseudo-fact in the very queries it accelerates — a ~65KB
        // value with no meaning to a reader. Explicitly prefixing into
        // `_index/` still reaches them (inspection stays possible).
        if (rec.key.startsWith('_index/') && !opts?.prefix?.startsWith('_index')) return false;
        if (rec.superseded && !opts?.includeSuperseded) return false;
        if (!isTimerLive(rec, nowMs)) return false;
        // type is index-served (listByType); tag/prefix via the shared predicate (ADR-0011).
        if (!matchesSelector(rec, { tag: opts?.tag, tags: opts?.tags, prefix: opts?.prefix })) return false;
        // Content search: find a fact by what's inside it (substring over value JSON).
        if (opts?.contains && !recordContains(rec, opts.contains)) return false;
        // Visibility fold (see `keyFilter`): applied HERE so the cap and `total`
        // are both computed over what the caller can actually see.
        if (opts?.keyFilter && !opts.keyFilter(rec.key)) return false;
        return true;
      });
      const wrapped = await Promise.all(
        candidates.map(async (rec) => ({ key: rec.key, ...(await wrap(rec, nowMs, signals, sCall, opts?.explain, opts?.relevance)) })),
      );
      // ADR-0085 Inc 3 (W3c): rankBy:'relevance' — cosine first, salience as
      // tiebreak — drops the no-relevance tail (rows the intent never reached,
      // which pure salience used to pad the shortlist with: "link above ratify"
      // for a ratification goal). OPT-IN here: a bare relevance map still only
      // adds the sixth signal (never an authority, ADR-0051) — the workspace
      // intent path is what defaults `text` queries to this ranking.
      const rankBy = opts?.rankBy ?? 'salience';
      let ranked = wrapped;
      if (rankBy === 'relevance') {
        ranked = wrapped.filter((e) => (e._meta.relevance ?? 0) > 0);
        ranked.sort((a, b) => (b._meta.relevance ?? 0) - (a._meta.relevance ?? 0) || b._meta.score - a._meta.score);
      } else {
        ranked.sort((a, b) =>
          rankBy === 'recency'
            ? Date.parse(b._meta.updatedAt) - Date.parse(a._meta.updatedAt)
            : b._meta.score - a._meta.score,
        );
      }
      // A cold bare page persists its ranking for the pages that follow it —
      // best-effort and awaited (Lambda gives no post-return execution; a
      // dropped write would just mean every page pays the cold cost again).
      if (rankingHead !== null) {
        await writeRanking(scope, rankingHead, ranked, signals);
      }
      // Cursor = a plain offset into the fresh ranking: best-effort resume,
      // honest about salience reordering between pages (no snapshot to leak).
      const offset = opts?.cursor ? Math.max(0, Number.parseInt(opts.cursor, 10) || 0) : 0;
      const end = opts?.limit !== undefined ? offset + Math.max(0, opts.limit) : undefined;
      const page = ranked.slice(offset, end);
      const consumed = offset + page.length;
      return {
        entries: page,
        count: page.length,
        total: ranked.length,
        ...(consumed < ranked.length && opts?.limit !== undefined ? { nextCursor: String(consumed) } : {}),
      };
    },

    async salienceConfig(scope: string): Promise<Partial<SalienceOptions> | null> {
      return loadSalienceConfig(scope);
    },

    async lensesConfig(scope: string): Promise<Record<string, Partial<SalienceOptions>> | null> {
      return loadLensesConfig(scope);
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
        writer: leafActOf(identity) ?? identity?.user ?? null,
      };
      await store.putEdge(edge);
      // Linking is attention on the source fact — both the write-ledger event
      // (for `changes`) and the touch counter (for `standing`, ADR-0050).
      const seq = await store.nextSeq(scope);
      await store.appendTrajectory({ op: 'link', scope, key: from, rel, to, at: edge.createdAt, seq });
      await store.recordTouch(scope, from, actorOf(identity), 'write', bucketOf(now.getTime()));
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
      await store.appendTrajectory({ op: 'unlink', scope, key: from, rel, to, at: new Date().toISOString(), seq });
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
      // Declared-extensional (ADR-0057): a collection fact may NAME its members
      // directly — `value.members: ['el:a', …]` (the group/frame shape) — instead
      // of (or as well as) being pointed at by membership edges. Union with the
      // edge-derived set, deduped; a declared list is an ORDERED list, so array
      // position supplies each declared member's seq unless a placing decoration
      // asserts one explicitly (decoration seq wins — it's the finer statement).
      const declaredSeq = new Map<string, number>();
      const declared = (fact?.value as { members?: unknown } | undefined)?.members;
      if (Array.isArray(declared)) {
        declared.forEach((k, i) => {
          if (typeof k !== 'string' || !k) return;
          declaredSeq.set(k, i);
          if (!seen.has(k)) {
            seen.add(k);
            memberKeys.push(k);
          }
        });
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
        // A declared member's array position orders it when no decoration spoke.
        if (!seqOf.has(k) && declaredSeq.has(k)) seqOf.set(k, declaredSeq.get(k)!);
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

    async changes(scope, sinceSeq, limit?, last?, filter?): Promise<ChangesResult> {
      const head = await store.currentSeq(scope);
      // 'head' = "where do I start tailing from?" — answered without paying
      // for (or wading through) the scope's whole recent history.
      if (sinceSeq === 'head') return { events: [], seq: head };
      // ADR-0055: scope the feed server-side, BEFORE windowing — `last: n`
      // means "the newest n relevant events". A key prefix matches the event
      // key, or (link/unlink) the `to` endpoint — edges INTO the slice count.
      const inScope = (e: TrajectoryEvent): boolean => {
        if (filter?.ops?.length && !filter.ops.includes(e.op)) return false;
        if (filter?.prefixes?.length) {
          return filter.prefixes.some((p) => (e.key !== null && e.key.startsWith(p)) || (e.to !== undefined && e.to.startsWith(p)));
        }
        return true;
      };
      // The trajectory is TTL-bounded, so the partition stays small; seq rises
      // with time, so time-ordered events are seq-ordered too.
      const events = (await store.recentTrajectory(scope, 0))
        .filter((e) => e.seq > sinceSeq && inScope(e))
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
      const settledStanding = opts?.settledStanding ?? 0.25;
      const nowMs = Date.now();
      // Tending is about knowledge health; `_` namespaces are surface plumbing
      // (canvas elements, declared vocabulary) and would drown the signal.
      const isSystem = (key: string): boolean => key.startsWith('_');
      const includeSystem = opts?.includeSystem ?? false;
      const [records, edges] = await Promise.all([store.list(scope), store.listEdges(scope)]);
      const byKey = new Map(records.map((r) => [r.key, r]));
      // Derivation needs the WHOLE live slice — `_types/*` decls and `_canvas/*`
      // decorations are `_`-prefixed but produce the placement/evidence edges;
      // only the *reporting* below filters system keys.
      const liveAll = records.filter((r) => !r.superseded && isTimerLive(r, nowMs));
      const live = liveAll.filter((r) => includeSystem || !isSystem(r.key));
      // Connectivity for the weave signal: asserted structure only. Authored
      // edges count unless machine-inferred (`similarTo` is a *suggestion*, not
      // an assertion); derived edges count when they express placement or
      // evidence — an embedded `ref` field (0.6) or a decoration-placed
      // membership like `onBoard`/`inDoc` (0.4). The pure type backbone
      // (`instanceOf`/`managedBy`/`rendersWith`, 0.2) and the query-derived
      // `inView` are ambient — counting them would mask genuinely-unwoven facts.
      const authoredAsserted = new Set<string>();
      for (const e of edges) {
        if (e.rel === 'similarTo') continue;
        authoredAsserted.add(e.from);
        authoredAsserted.add(e.to);
      }
      const linked = new Set<string>(authoredAsserted);
      for (const e of deriveBackboneEdges(liveAll, opts?.typeRules)) {
        if ((e.strength ?? 0) < MEMBERSHIP_STRENGTH || e.rel === BACKBONE_RELS.inView) continue;
        linked.add(e.from);
        linked.add(e.to);
      }
      // Settled vs stale: age alone is not rot. An old fact with authored
      // structure, or with earned standing (lifetime reads/writes incl. import
      // priors), has earned its idleness — recall already elides it gracefully.
      const sCall = baseSalience(await loadSalienceConfig(scope));
      const signals = await signalsFor(scope, nowMs, sCall.windowMs, records, opts?.typeRules);
      const isSettled = (r: StateRecord): boolean => {
        if (authoredAsserted.has(r.key)) return true;
        const sig = signals.get(r.key) ?? EMPTY_SIGNALS;
        const lifetime = sig.lifetimeReads + (r.seedReads ?? 0) + sig.lifetimeWrites + (r.seedWrites ?? 0);
        const standing =
          sCall.standingSaturation > 0 ? Math.min(Math.log1p(lifetime) / Math.log1p(sCall.standingSaturation), 1) : 0;
        return standing >= settledStanding;
      };
      const old = live
        .filter((r) => nowMs - Date.parse(r.updatedAt) > staleMs)
        .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
      const rotting = old.filter((r) => !isSettled(r));
      const stale = rotting.slice(0, limit).map((r) => ({ key: r.key, updatedAt: r.updatedAt, type: r.type }));
      const unlinkedAll = live.filter((r) => !linked.has(r.key)).map((r) => r.key);
      const unlinked = unlinkedAll.slice(0, limit);
      const dangling: AttentionResult['dangling'] = [];
      let danglingTotal = 0;
      for (const e of edges) {
        if (!includeSystem && (isSystem(e.from) || isSystem(e.to))) continue;
        for (const [end, k] of [['from', e.from], ['to', e.to]] as const) {
          const rec = byKey.get(k);
          let reason: string | null = null;
          if (!rec) reason = `${end} "${k}" missing`;
          else if (rec.superseded && !rec.supersededBy) reason = `${end} "${k}" retired without successor`;
          if (reason) {
            danglingTotal++;
            if (dangling.length < limit) dangling.push({ from: e.from, rel: e.rel, to: e.to, reason });
          }
        }
      }
      return {
        stale,
        unlinked,
        dangling,
        staleTotal: rotting.length,
        unlinkedTotal: unlinkedAll.length,
        danglingTotal,
        settled: old.length - rotting.length,
      };
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
        writer: leafActOf(identity) ?? identity?.user ?? rec.writer,
        updatedAt: nowIso,
        seq,
        touches: bumpTouches(rec.touches, identity ? actorOf(identity) : actorClassOf(rec.writer), 'write'),
        window: bumpWindow(rec.window, identity ? actorOf(identity) : actorClassOf(rec.writer), 'write', bucketOf(now.getTime())),
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
    async recordTouch(scope, key, actor, op, bucket): Promise<void> {
      const r = records.get(k(scope, key));
      if (!r) return; // a miss is a silent no-op, like the conditional update
      r.touches = bumpTouches(r.touches, actor, op);
      r.window = bumpWindow(r.window, actor, op, bucket);
    },
  };
}

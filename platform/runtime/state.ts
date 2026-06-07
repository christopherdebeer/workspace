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
 * Storage-agnostic: the semantics live here; a `StateStore` is injected (an
 * in-memory one ships for tests/local, a DynamoDB-backed one is the next step,
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
  /** Successor key if this entry has been superseded, else null. */
  supersededBy: string | null;
  /** Salience score in [0,1], computed at read time from the trajectory. */
  score: number;
  /** Recent write rate (writes per minute over the salience window). */
  velocity: number;
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
  counts: { focus: number; peripheral: number; elided: number; total: number };
}

export interface ReadResult {
  entries: Record<string, Entry>;
  _shaping: ShapingSummary;
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
  supersededBy: string | null;
}

export interface TrajectoryEvent {
  op: 'read' | 'write' | 'supersede';
  scope: string;
  key: string | null;
  at: string;
  seq: number;
}

export interface StateStore {
  /** Allocate the next monotonic sequence number for a scope. */
  nextSeq(scope: string): Promise<number>;
  get(scope: string, key: string): Promise<StateRecord | null>;
  put(record: StateRecord): Promise<void>;
  list(scope: string): Promise<StateRecord[]>;
  appendTrajectory(event: TrajectoryEvent): Promise<void>;
  /** Trajectory events for a scope at or after `sinceMs` (epoch ms). */
  recentTrajectory(scope: string, sinceMs: number): Promise<TrajectoryEvent[]>;
}

// ── salience ───────────────────────────────────────────────────────

export interface SalienceOptions {
  /** Recency half-life (ms). Older writes decay toward 0. Default 1h. */
  halfLifeMs?: number;
  /** Window for counting recent reads/writes (ms). Default 1h. */
  windowMs?: number;
  /** Writes-in-window that saturate the velocity term. Default 5. */
  velocitySaturation?: number;
  /** Reads-in-window that saturate the attention term. Default 5. */
  attentionSaturation?: number;
  /** Score at/above which an entry is Focus (full value + meta). Default 0.5. */
  focusThreshold?: number;
  /** Score below which an entry is Elided (value withheld). Default 0.1. */
  elideThreshold?: number;
}

interface ResolvedSalience extends Required<SalienceOptions> {}

function resolveSalience(o?: SalienceOptions): ResolvedSalience {
  return {
    halfLifeMs: o?.halfLifeMs ?? 60 * 60 * 1000,
    windowMs: o?.windowMs ?? 60 * 60 * 1000,
    velocitySaturation: o?.velocitySaturation ?? 5,
    attentionSaturation: o?.attentionSaturation ?? 5,
    focusThreshold: o?.focusThreshold ?? 0.5,
    elideThreshold: o?.elideThreshold ?? 0.1,
  };
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Salience score in [0,1] = a recency term (exponential decay since last write),
 * a velocity term (recent writes), and an attention term (recent reads). The
 * weights favour recency, then velocity, then attention — the substrate's
 * "what should you notice" signal, computed, not configured.
 */
export function computeScore(
  args: { updatedAtMs: number; writesInWindow: number; readsInWindow: number; nowMs: number },
  s: ResolvedSalience,
): number {
  const age = Math.max(0, args.nowMs - args.updatedAtMs);
  const recency = Math.pow(2, -age / s.halfLifeMs);
  const velocity = Math.min(args.writesInWindow / s.velocitySaturation, 1);
  const attention = Math.min(args.readsInWindow / s.attentionSaturation, 1);
  return clamp01(0.5 * recency + 0.3 * velocity + 0.2 * attention);
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
}

export interface ObservedState {
  put(input: WriteInput, identity?: Identity): Promise<Entry>;
  get(scope: string, key: string, identity?: Identity): Promise<Entry | null>;
  read(scope: string, opts?: ReadOptions, identity?: Identity): Promise<ReadResult>;
  /** Retire `key` by pointing it at successor `by` (or just marking it). */
  supersede(scope: string, key: string, by: string | null, identity?: Identity): Promise<Entry | null>;
}

export function createObservedState(store: StateStore, salience?: SalienceOptions): ObservedState {
  const s = resolveSalience(salience);

  /** Wrap a stored record into a read-facing entry with a computed score. */
  async function wrap(rec: StateRecord, nowMs: number, traj?: TrajectoryEvent[]): Promise<Entry> {
    const events = traj ?? (await store.recentTrajectory(rec.scope, nowMs - s.windowMs));
    let writes = 0;
    let reads = 0;
    for (const e of events) {
      if (e.key !== rec.key) continue;
      if (e.op === 'read') reads++;
      else writes++;
    }
    const score = computeScore(
      { updatedAtMs: Date.parse(rec.updatedAt), writesInWindow: writes, readsInWindow: reads, nowMs },
      s,
    );
    const windowMin = s.windowMs / 60000;
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
        supersededBy: rec.supersededBy,
        score,
        velocity: windowMin > 0 ? writes / windowMin : 0,
        elided: false,
      },
    };
  }

  return {
    async put(input: WriteInput, identity?: Identity): Promise<Entry> {
      if (!input?.scope || !input?.key) throw new Error('state.put requires `scope` and `key`');
      const writer = identity?.user ?? null;
      const now = new Date();
      const nowIso = now.toISOString();
      const seq = await store.nextSeq(input.scope);
      const prev = await store.get(input.scope, input.key);
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
        revision: (prev?.revision ?? 0) + 1,
        seq,
        firstSeq: prev?.firstSeq ?? seq,
        writer,
        via: input.via ?? null,
        createdAt: prev?.createdAt ?? nowIso,
        updatedAt: nowIso,
        writers,
        // a fresh write to a superseded key revives it
        supersededBy: null,
      };
      await store.put(record);
      await store.appendTrajectory({ op: 'write', scope: input.scope, key: input.key, at: nowIso, seq });
      return wrap(record, now.getTime());
    },

    async get(scope: string, key: string, _identity?: Identity): Promise<Entry | null> {
      const rec = await store.get(scope, key);
      if (!rec) return null;
      const now = new Date();
      const seq = await store.nextSeq(scope);
      await store.appendTrajectory({ op: 'read', scope, key, at: now.toISOString(), seq });
      return wrap(rec, now.getTime());
    },

    async read(scope: string, opts?: ReadOptions, _identity?: Identity): Promise<ReadResult> {
      const elision = opts?.elision ?? 'auto';
      const focusThreshold = opts?.focusThreshold ?? s.focusThreshold;
      const elideThreshold = opts?.elideThreshold ?? s.elideThreshold;
      const expand = new Set(opts?.expand ?? []);
      const nowMs = Date.now();

      const records = await store.list(scope);
      const traj = await store.recentTrajectory(scope, nowMs - s.windowMs);
      const entries: Record<string, Entry> = {};
      const counts = { focus: 0, peripheral: 0, elided: 0, total: 0 };

      for (const rec of records) {
        if (rec.supersededBy && !opts?.includeSuperseded) continue;
        const entry = await wrap(rec, nowMs, traj);
        let tier = tierFor(entry._meta.score, { ...s, focusThreshold, elideThreshold });
        if (expand.has(rec.key)) tier = 'focus';
        counts[tier]++;
        counts.total++;
        if (tier === 'elided' && elision === 'auto') {
          entry.value = null;
          entry._meta.elided = true;
        }
        entries[rec.key] = entry;
      }

      // Reading the scope is itself attention on every surfaced key.
      const seq = await store.nextSeq(scope);
      await store.appendTrajectory({ op: 'read', scope, key: null, at: new Date(nowMs).toISOString(), seq });

      return {
        entries,
        _shaping: { focusThreshold, elideThreshold, elision, counts },
      };
    },

    async supersede(scope: string, key: string, by: string | null, identity?: Identity): Promise<Entry | null> {
      const rec = await store.get(scope, key);
      if (!rec) return null;
      const now = new Date();
      const nowIso = now.toISOString();
      const seq = await store.nextSeq(scope);
      const updated: StateRecord = {
        ...rec,
        supersededBy: by,
        writer: identity?.user ?? rec.writer,
        updatedAt: nowIso,
        seq,
      };
      await store.put(updated);
      await store.appendTrajectory({ op: 'supersede', scope, key, at: nowIso, seq });
      return wrap(updated, now.getTime());
    },
  };
}

// ── in-memory store (tests / local; no AWS) ────────────────────────

export function createMemoryStateStore(): StateStore {
  const records = new Map<string, StateRecord>();
  const trajectory: TrajectoryEvent[] = [];
  const seqByScope = new Map<string, number>();
  const k = (scope: string, key: string): string => `${scope} ${key}`;

  return {
    async nextSeq(scope: string): Promise<number> {
      const next = (seqByScope.get(scope) ?? 0) + 1;
      seqByScope.set(scope, next);
      return next;
    },
    async get(scope: string, key: string): Promise<StateRecord | null> {
      const r = records.get(k(scope, key));
      return r ? { ...r, writers: [...r.writers] } : null;
    },
    async put(record: StateRecord): Promise<void> {
      records.set(k(record.scope, record.key), { ...record, writers: [...record.writers] });
    },
    async list(scope: string): Promise<StateRecord[]> {
      return [...records.values()]
        .filter((r) => r.scope === scope)
        .map((r) => ({ ...r, writers: [...r.writers] }));
    },
    async appendTrajectory(event: TrajectoryEvent): Promise<void> {
      trajectory.push({ ...event });
    },
    async recentTrajectory(scope: string, sinceMs: number): Promise<TrajectoryEvent[]> {
      return trajectory.filter((e) => e.scope === scope && Date.parse(e.at) >= sinceMs);
    },
  };
}

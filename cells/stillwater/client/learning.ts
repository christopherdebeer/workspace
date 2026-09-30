/**
 * What the river remembers, and how it paces the asks. Pure: no DOM, no clock
 * (callers pass `now`), no randomness except the `rand` handed in — so all of
 * it is unit-tested. See LEARNING-DESIGN.md (P1–P3, P5, P7) for the why.
 *
 *  - Facts: every answer the child makes is a fact ("3+4", "4×3"). Each has a
 *    memory half-life; a clean quick recall lengthens it (more so when it had
 *    nearly been forgotten — the spacing effect), a struggle shortens it.
 *    A fact is due for review when its recall probability has fallen.
 *  - Fluency: how an answer was made (latency, leaves, friction, help) becomes
 *    a quality 0..1, never shown to the child.
 *  - Stretches: asks come in short arcs — warm-up, reach, consolidate, relief,
 *    finale — the sawtooth that makes effort feel paid back.
 */
import type { Rule, Stage } from './numeracy';

// ─── facts ───────────────────────────────────────────────────────────────────

export interface FactMemory {
  /** Half-life of recall, seconds. */
  h: number;
  /** Last seen, ms since epoch. */
  t: number;
  /** Times answered. */
  n: number;
  /** Times answered fluently. */
  f: number;
  /** For groups: the orientations answered so far ("3x4" = 3 leaves of 4). */
  o?: string[];
}

export interface Fact {
  key: string;
  rule: Rule;
  value: number;
  /** Sum: the parts, ascending. Groups: [leaves, perLeaf] as answered. */
  parts: number[];
}

const H_MIN = 30;
const H_MAX = 60 * 86400;
const H_FIRST_GOOD = 150;
const H_FIRST_POOR = 45;

/** The fact a set of chosen leaves (their drop counts) expresses. */
export function factOf(rule: Rule, chosen: readonly number[]): Fact {
  const value = chosen.reduce((s, c) => s + c, 0);
  if (rule === 'groups') {
    const k = chosen[0];
    const m = chosen.length;
    return { key: `g:${Math.min(k, m)}x${Math.max(k, m)}`, rule, value, parts: [m, k] };
  }
  const parts = [...chosen].sort((a, b) => a - b);
  return { key: `s:${parts.join('+')}`, rule, value, parts };
}

/** Parse a key back into its rule, value and canonical parts. */
export function parseKey(key: string): Fact {
  if (key.startsWith('g:')) {
    const [a, b] = key.slice(2).split('x').map(Number);
    return { key, rule: 'groups', value: a * b, parts: [a, b] };
  }
  const parts = key.slice(2).split('+').map(Number);
  return { key, rule: 'sum', value: parts.reduce((s, c) => s + c, 0), parts };
}

export function recall(m: FactMemory, now: number): number {
  const age = Math.max(0, (now - m.t) / 1000);
  return Math.pow(2, -age / m.h);
}

export class Memory {
  items: Record<string, FactMemory> = {};

  constructor(saved?: unknown) {
    if (saved && typeof saved === 'object') {
      for (const [k, v] of Object.entries(saved as Record<string, FactMemory>)) {
        if (v && typeof v.h === 'number' && typeof v.t === 'number') this.items[k] = { ...v, h: clampH(v.h) };
      }
    }
  }

  get(key: string): FactMemory | undefined {
    return this.items[key];
  }

  /**
   * An answer made. quality 0..1 (see `quality`). Returns whether this was the
   * first time the fact was made this way round (for groups; "both ways").
   */
  record(fact: Fact, q: number, now: number): { newWay: boolean } {
    const m = this.items[fact.key];
    const way = fact.rule === 'groups' ? `${fact.parts[0]}x${fact.parts[1]}` : '';
    if (!m) {
      this.items[fact.key] = { h: q >= 0.7 ? H_FIRST_GOOD : H_FIRST_POOR, t: now, n: 1, f: q >= 0.85 ? 1 : 0, o: way ? [way] : undefined };
      return { newWay: false };
    }
    const p = recall(m, now);
    if (q >= 0.7) {
      // the spacing effect: a recall that was nearly lost strengthens most
      m.h *= 1 + q * (0.6 + 2.2 * (1 - p));
    } else if (q >= 0.5) {
      m.h *= 1.1;
    } else {
      m.h *= 0.55;
    }
    m.h = clampH(m.h);
    m.t = now;
    m.n++;
    if (q >= 0.85) m.f++;
    let newWay = false;
    if (way) {
      m.o = m.o ?? [];
      if (!m.o.includes(way)) {
        newWay = m.o.length > 0;
        m.o.push(way);
      }
    }
    return { newWay };
  }

  /**
   * Facts due for review, most urgent first: recall has fallen below 0.75, it
   * wasn't seen in the last 45 s, and `inBand` says the child's current range
   * includes it. Shaky facts (short half-life) rank above solid ones.
   */
  due(now: number, inBand: (f: Fact) => boolean, limit = 6): Fact[] {
    const out: Array<{ f: Fact; u: number }> = [];
    for (const [key, m] of Object.entries(this.items)) {
      if (now - m.t < 45_000) continue;
      const p = recall(m, now);
      if (p >= 0.75) continue;
      const f = parseKey(key);
      if (!inBand(f)) continue;
      out.push({ f, u: (1 - p) / (1 + Math.log10(m.h)) });
    }
    return out.sort((a, b) => b.u - a.u).slice(0, limit).map((x) => x.f);
  }

  /** Is this fact fluent (answered cleanly and quickly, and holding)? */
  fluent(key: string, now: number): boolean {
    const m = this.items[key];
    return !!m && m.f >= 2 && m.h >= 600 && recall(m, now) > 0.6;
  }

  /** How established a fact is, 0..1 (drives pattern → scatter dew layouts). */
  strength(key: string): number {
    const m = this.items[key];
    if (!m) return 0;
    return Math.min(1, Math.log2(m.h / H_MIN) / Math.log2(86400 / H_MIN));
  }

  toJSON() {
    // keep the store small: the 400 most recently seen facts
    const entries = Object.entries(this.items).sort((a, b) => b[1].t - a[1].t).slice(0, 400);
    return Object.fromEntries(entries);
  }
}

const clampH = (h: number) => Math.max(H_MIN, Math.min(H_MAX, h));

// ─── fluency ─────────────────────────────────────────────────────────────────

export interface Observation {
  /** Seconds from the ask appearing to the answer. */
  secs: number;
  /** Leaves in the answer. */
  leaves: number;
  value: number;
  /** Over / mismatch moments on the way. */
  friction: number;
  /** Help given (0 none … 3). */
  scaffold: number;
  /** Counting stage (drops are counted one by one, so time grows with the value). */
  counting: boolean;
}

/** Time a fluent answer should take: finding the leaves, not counting the drops. */
export function expectedSecs(o: Pick<Observation, 'leaves' | 'value' | 'counting'>): number {
  return 2.2 + 1.1 * o.leaves + (o.counting ? 0.35 * o.value : 0);
}

/** How well an answer was made, 0..1. ≥ 0.85 counts as fluent. */
export function quality(o: Observation): number {
  let q = 1;
  q -= 0.3 * Math.max(0, o.friction);
  q -= 0.22 * Math.max(0, o.scaffold);
  // Exploration and motor/search time are not a valid measure of mathematical fluency.
  return Math.max(0.1, Math.min(1, q));
}

// ─── solutions ───────────────────────────────────────────────────────────────

/**
 * One way to make `target` from the counts (indices), using as few leaves as
 * possible, or null. `exactly` forces a number of leaves (the bond ask).
 */
export function solutionFor(rule: Rule, counts: readonly number[], target: number, maxParts: number, exactly?: number): number[] | null {
  const idx = counts.map((c, i) => i).filter((i) => counts[i] > 0);
  if (rule === 'groups') {
    let best: number[] | null = null;
    for (let k = 2; k <= target; k++) {
      if (target % k) continue;
      const m = target / k;
      if (m < 2 || m > maxParts || (exactly && m !== exactly)) continue;
      const have = idx.filter((i) => counts[i] === k);
      if (have.length >= m && (!best || m < best.length)) best = have.slice(0, m);
    }
    return best;
  }
  const lo = exactly ?? 1;
  const hi = exactly ?? maxParts;
  for (let parts = lo; parts <= hi; parts++) {
    const found = combo(idx, counts, target, parts, 0, []);
    if (found) return found;
  }
  return null;
}

function combo(idx: number[], counts: readonly number[], rest: number, parts: number, from: number, acc: number[]): number[] | null {
  if (parts === 0) return rest === 0 ? acc : null;
  for (let j = from; j < idx.length; j++) {
    const c = counts[idx[j]];
    if (c > rest) continue;
    const r = combo(idx, counts, rest - c, parts - 1, j + 1, [...acc, idx[j]]);
    if (r) return r;
  }
  return null;
}

/** Fewest leaves that make `target` from these counts (Infinity if none). */
export function fewestLeaves(rule: Rule, counts: readonly number[], target: number, maxParts: number): number {
  const s = solutionFor(rule, counts, target, maxParts);
  return s ? s.length : Infinity;
}

// ─── elegance (P4) ───────────────────────────────────────────────────────────

export interface Elegance {
  /** Made with the fewest leaves possible (a bond, not a pile). */
  fewest: boolean;
  /** Two equal leaves (a double). */
  double: boolean;
  /** Passed exactly through ten on the way (bridging through ten). */
  ten: boolean;
  /** A product answered the other way round from before (commutativity). */
  bothWays: boolean;
  /** Quick and clean. */
  fluent: boolean;
}

export function elegance(rule: Rule, chosen: readonly number[], available: readonly number[], maxParts: number, q: number, newWay: boolean): Elegance {
  const value = chosen.reduce((s, c) => s + c, 0);
  const sum = rule === 'sum';
  let ten = false;
  if (sum && value > 10) {
    let run = 0;
    for (let i = 0; i < chosen.length - 1; i++) {
      run += chosen[i];
      if (run === 10) ten = true;
    }
  }
  const least = fewestLeaves(rule, [...available, ...chosen], value, maxParts);
  return {
    // only worth noticing when a longer answer was the easier grab
    fewest: sum && chosen.length <= least && chosen.length <= 2 && value >= 5,
    double: sum && chosen.length === 2 && chosen[0] === chosen[1],
    ten,
    bothWays: rule === 'groups' && newWay,
    fluent: q >= 0.85,
  };
}

// ─── stretches (P3) ──────────────────────────────────────────────────────────

export type Phase = 'warm' | 'reach' | 'consolidate' | 'relief' | 'finale';

export interface Outcome {
  q: number;
  friction: number;
}

/**
 * A stretch of river: a short arc of asks. Its shape adapts to how the last
 * one went — a smooth stretch reaches twice; a hard reach earns more relief.
 */
export class Stretch {
  phases: Phase[];
  at = 0;
  outcomes: Array<{ phase: Phase } & Outcome> = [];

  constructor(prev: Stretch | null, welcome = false) {
    const smooth = prev ? prev.firstTryRate() >= 0.8 : false;
    const warm: Phase[] = welcome ? ['warm', 'warm'] : ['warm'];
    const reach: Phase[] = smooth ? ['reach', 'reach'] : ['reach'];
    this.phases = [...warm, ...reach, 'consolidate', 'relief', 'relief', 'finale'];
  }

  get phase(): Phase {
    return this.phases[Math.min(this.at, this.phases.length - 1)];
  }

  get done(): boolean {
    return this.at >= this.phases.length;
  }

  /** An ask in this phase was answered. A struggled reach adds a breather. */
  answered(o: Outcome) {
    const phase = this.phase;
    this.outcomes.push({ phase, ...o });
    if (phase === 'reach' && o.q < 0.55 && this.phases.filter((p) => p === 'relief').length < 3) {
      this.phases.splice(this.phases.lastIndexOf('relief'), 0, 'relief');
    }
    this.at++;
  }

  finished() {
    this.at = this.phases.length;
  }

  firstTryRate(): number {
    if (!this.outcomes.length) return 0;
    return this.outcomes.filter((o) => o.friction === 0).length / this.outcomes.length;
  }
}

/** How the proficiency field is shifted for each phase (easier warm-up and relief, a step up to reach). */
export const PHASE_OFFSET: Record<Phase, number> = { warm: -0.12, reach: 0.08, consolidate: 0, relief: -0.22, finale: 0 };
/** Pause after an answer before the next ask, by the phase just finished (relief comes quick). */
export const PHASE_PAUSE: Record<Phase, number> = { warm: 3.0, reach: 3.4, consolidate: 2.8, relief: 1.8, finale: 2.5 };

// ─── which stage a fact lives in ─────────────────────────────────────────────

/** The activity a fact belongs to, given the stages (so due facts are asked in their own form). */
export function stageOfFact(f: Fact, stages: readonly Stage[], preferTimes: boolean): Stage {
  const by = (id: Stage['id']) => stages.find((s) => s.id === id)!;
  if (f.rule === 'groups') return preferTimes ? by('times') : by('groups');
  const max = Math.max(...f.parts);
  if (f.value <= 5 && max <= 3) return by('gather');
  if (f.value <= 10) return by('add');
  return by('more');
}

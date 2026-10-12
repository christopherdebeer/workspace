/**
 * Taohua: the ways up the hill. No one path: a way that climbs the hill and branches as it goes,
 * like a tree laid on the slope, that the walker takes one fork of and then another, choosing as
 * they go. Just a journey.
 *
 * The hill comes first: it rises up the slope (z), gently in some bands and steeply in others, the
 * same all across it (x). On it, the ways grow from the foot of the hill, a branch at a time, always
 * the lowest first: from where it's reached, each branch goes on (a long reach up and across the
 * hill, turning a little), or forks in two, the forks going their own ways; now and then a short
 * spur leaves it to one side, up to a temple, a pavilion or a shrine on the slope above; now and
 * then a branch ends, at a temple of its own or a quiet clearing; rarely, two branches that have
 * drawn near meet again. Never more than three at once, never fewer than one. No way crosses
 * another, nor runs close beside one: where there's no room for a branch to go on, it ends.
 *
 * Each way takes the hill's height as it goes: where its going is steep (the hill steep there, or
 * the way heading straight up it) it climbs in steps; where it's gentle, it's a trail. A temple's
 * gate stands across a way now and then, the way going in at its front and on from its back; a
 * branch's end is a building's terrace, the way climbing its stair to it. On forever, made as far
 * ahead as it's needed, from the seed: the same seed, the same hillside.
 *
 * World: y up; z up the hill; x across it.
 */
import { hash, noise1, seeded, type Rand } from '../kit/rng';

export type V3 = [number, number, number];

/** a way's width; a step's rise; a hall's terrace's depth */
export const WIDTH = 1.9, RISE = 0.16, TERRACE = 7.2;

/** what stands at a junction where a branch ends: a building (its terrace the way's end), or a clearing */
export type EndKind = 'hall' | 'pavilion' | 'pagoda' | 'shrine' | 'cast';
export interface Junction {
  id: string; n: number; x: number; z: number; y: number;
  /** a gate hall stands across the way here: the way comes up to its front and goes on from its back */
  gate: boolean;
  /** where a branch ends: what's there (none, where it goes on) */
  end: EndKind | null;
  /** the way a building here looks out (its front), and how far from its middle its front stair's foot is (0: no building) */
  face: [number, number]; reach: number;
  /** the ways that come up to it, and those that go on from it */
  ins: Way[]; outs: Way[];
}
/** a stretch of a way that climbs in steps: from u0 to u1 along it, so many steps */
export interface StairRun { u0: number; u1: number; n: number; h0: number; h1: number }
export interface Way {
  id: string; n: number; from: Junction; to: Junction;
  /** its curve across the ground (a, c, b; their heights the hill's); and where it truly starts and ends (a0, b1), straight to and from the curve (onto a building's terrace up its stair; from a gate's, down its back) */
  a: V3; c: V3; b: V3; a0: V3; b1: V3; head: number; tail: number;
  /** its length across the ground (all of it); how far along its curve each of its samples is */
  len: number; samp: Float64Array;
  /** where it climbs in steps */
  stairs: StairRun[];
  /** a short spur to a building or a clearing, off a branch that goes on */
  spur: boolean;
  /** its extent across the ground */
  box: [number, number, number, number];
  /** (its line across the ground, as points (x, z) and how far along each is: for nearness) */
  pts: Float64Array;
}
export interface Near { d: number; w: Way; u: number; p: V3 }

const N = 40;
const bez = (a: V3, c: V3, b: V3, t: number): V3 => {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], u * u * a[2] + 2 * u * t * c[2] + t * t * b[2]];
};
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rot = (d: [number, number], a: number): [number, number] => [d[0] * Math.cos(a) + d[1] * Math.sin(a), -d[0] * Math.sin(a) + d[1] * Math.cos(a)];
/** a building's terrace's half-depth, by kind */
export const TERRACE_OF: Record<string, number> = { hall: TERRACE / 2, gate: TERRACE / 2, pavilion: 2.4, pagoda: 3, shrine: 2 };
/** how far apart ways must keep (m between their middles), and junctions */
const APART = 8, JAPART = 16;
/** the size of a bucket of the index, up the hill */
const BUCKET = 32;

interface Tip { j: Junction; d: [number, number] }

export class Ways {
  constructor(readonly seed: number) {
    const root = this.junction(0, 2, null);
    this.tips.push({ j: root, d: [0, 1] });
  }

  // ─── the hill ──────────────────────────────────────────────────────────────────────────────────
  /** how steeply the hill rises at z: mostly gently, in bands steeply */
  slope(z: number): number {
    if (z < 0) return 0.12;
    const n = noise1(hash(this.seed, 0x51), z / 30) * 0.65 + noise1(hash(this.seed, 0x52), z / 11) * 0.35;
    return 0.05 + 0.28 * smooth(0.42, 0.85, n);
  }
  private hillT: number[] = [0];
  /** The hill's height at z (the same all across it): its slope, summed up the hill. */
  hill(z: number): number {
    if (z <= 0) return z * 0.12;
    const D = 0.25, T = this.hillT;
    while ((T.length - 1) * D < z + D) { const z0 = (T.length - 1) * D; T.push(T[T.length - 1] + this.slope(z0 + D / 2) * D); }
    const i = Math.floor(z / D), f = z / D - i;
    return T[i] + (T[i + 1] - T[i]) * f;
  }

  // ─── what's been made, and where ───────────────────────────────────────────────────────────────
  private js: Junction[] = [];
  private all: Way[] = [];
  private ids = new Map<string, Way>();
  private tips: Tip[] = [];
  private wb = new Map<number, Way[]>();
  private jb = new Map<number, Junction[]>();
  private junction(x: number, z: number, end: EndKind | null): Junction {
    const j: Junction = { id: `j${this.js.length}`, n: this.js.length, x, z, y: this.hill(z), gate: false, end, face: [0, -1], reach: 0, ins: [], outs: [] };
    return j;
  }
  private commitJ(j: Junction) {
    this.js.push(j);
    const k = Math.floor(j.z / BUCKET);
    (this.jb.get(k) ?? this.jb.set(k, []).get(k)!).push(j);
  }
  private commitW(w: Way) {
    w.n = this.all.length; w.id = `w${w.n}`;
    this.all.push(w); this.ids.set(w.id, w);
    w.from.outs.push(w); w.to.ins.push(w);
    for (let k = Math.floor(w.box[2] / BUCKET); k <= Math.floor(w.box[3] / BUCKET); k++) (this.wb.get(k) ?? this.wb.set(k, []).get(k)!).push(w);
    w.stairs = this.stairsOf(w);
  }
  /** Made as far up the hill as z (and a good way more). */
  extend(z: number) {
    for (let guard = 0; guard < 400; guard++) {
      let lo = Infinity;
      for (const t of this.tips) lo = Math.min(lo, t.j.z);
      if (lo > z + 150) break;
      this.grow();
    }
  }
  /** The ways that run between z0 and z1, in the order they were made. */
  waysNear(z0: number, z1: number): Way[] {
    this.extend(z1);
    const seen = new Set<Way>();
    for (let k = Math.floor(z0 / BUCKET); k <= Math.floor(z1 / BUCKET); k++) for (const w of this.wb.get(k) ?? []) if (w.box[3] >= z0 && w.box[2] <= z1) seen.add(w);
    return [...seen].sort((a, b) => a.n - b.n);
  }
  /** The junctions between z0 and z1. */
  junctionsNear(z0: number, z1: number): Junction[] {
    this.extend(z1);
    const out: Junction[] = [];
    for (let k = Math.floor(z0 / BUCKET); k <= Math.floor(z1 / BUCKET); k++) for (const j of this.jb.get(k) ?? []) if (j.z >= z0 && j.z <= z1) out.push(j);
    return out.sort((a, b) => a.n - b.n);
  }
  into(j: Junction): Way[] { return j.ins; }
  outOf(j: Junction): Way[] { return j.outs; }
  /** A way by its name (as the address keeps it). */
  byId(id: string): Way | null {
    const n = Number(id.replace(/^w/, ''));
    if (!Number.isFinite(n) || n < 0 || n > 20000) return null;
    for (let z = 200; !this.ids.has(id) && z < 200000; z += 200) { this.extend(z); if (this.all.length > n) break; }
    return this.ids.get(id) ?? null;
  }
  /** the first way, from the foot of the hill */
  first(): Way { this.extend(0); return this.all[0]; }

  // ─── growing ───────────────────────────────────────────────────────────────────────────────────
  /** The lowest branch's tip, grown on: on, or forked, or ended, or met with a neighbour's. */
  private grow() {
    let ti = 0;
    for (let i = 1; i < this.tips.length; i++) if (this.tips[i].j.z < this.tips[ti].j.z) ti = i;
    const tip = this.tips.splice(ti, 1)[0];
    const j = tip.j, r = seeded(hash(this.seed, j.n, 0x33));
    const live = this.tips.length + 1;
    // (the way on leans up the hill, drawn back toward the middle when it's wandered far)
    let base: [number, number] = norm2([tip.d[0] * 0.6 - j.x / 260, tip.d[1] * 0.6 + 0.4]);
    if (j.gate) base = [-j.face[0], -j.face[1]];
    const early = j.n < 2;
    const roll = r();
    const pFork = early ? 0 : live === 1 ? 0.38 : live === 2 ? 0.14 : 0;
    const pEnd = early ? 0 : live === 1 ? 0 : live === 2 ? 0.16 : 0.42;
    const pMeet = early ? 0 : live === 1 ? 0 : 0.12;
    // (rarely: meet a neighbour that's drawn near)
    if (!j.gate && roll < pMeet) {
      const nb = this.tips.find((t) => Math.abs(t.j.x - j.x) < 46 && t.j.z - j.z < 30 && !t.j.gate);
      if (nb && this.meet(tip, nb, r)) return;
    }
    if (!j.gate && roll >= pMeet && roll < pMeet + pEnd) {
      // (it ends: a last reach, to a building or a clearing)
      if (this.reach(tip, base, r, pick(r, END_KINDS), 24, 44)) return;
    }
    if (!j.gate && roll >= pMeet + pEnd && roll < pMeet + pEnd + pFork) {
      // (it forks: two ways, one to either side)
      const s = ramp(r, 0.45, 0.85), t = ramp(r, 0.45, 0.85);
      const a = this.reach(tip, rot(base, s), r, null, 34, 64);
      const b = this.reach(tip, rot(base, -t), r, null, 34, 64);
      if (a || b) { this.spur(tip, base, r); return; }
    }
    // (it goes on; now and then through a gate)
    const gate = !early && j.n > 4 && r() < 0.14;
    if (this.reach(tip, base, r, null, 34, 64, gate)) { if (!j.gate) this.spur(tip, base, r); return; }
    // (through a gate the way always goes on: straight up the hill if it must)
    if (j.gate) { this.reach(tip, base, r, null, 34, 44, false, true); return; }
    if (live > 1) { if (!j.end) j.end = 'cast'; return; }
    // (the only branch, with nowhere to go: straight on up the hill)
    this.reach(tip, [0, 1], r, null, 40, 40, false, true);
  }
  /** Now and then, a short spur off to one side, up to a building or a clearing of its own. */
  private spur(tip: Tip, base: [number, number], r: Rand) {
    if (tip.j.n < 2 || r() > 0.32) return;
    const side = r() < 0.5 ? -1 : 1;
    this.reach(tip, rot(base, side * ramp(r, 1.0, 1.35)), r, pick(r, SPUR_KINDS), 14, 24, false, false, true);
  }
  /**
   * A way from the tip, so far along so (tried a few ways, turning a little more each time): to a
   * new junction (a branch going on, its tip kept), or to an end. Kept only if it crosses no way nor
   * runs close by one, and its junction is clear of the others.
   */
  private reach(tip: Tip, d: [number, number], r: Rand, end: EndKind | null, L0: number, L1: number, gate = false, force = false, spur = false): boolean {
    const j = tip.j;
    for (let k = 0; k < 7; k++) {
      let dir = k === 0 ? d : rot(d, (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.22);
      if (j.gate) dir = d;
      if (dir[1] < (spur ? 0.22 : 0.32)) dir = norm2([Math.sign(dir[0]) || 1, spur ? 0.22 : 0.32]);
      const L = ramp(r, L0, L1) * (k > 3 ? 0.8 : 1);
      const to = this.junction(j.x + dir[0] * L, j.z + dir[1] * L, end);
      to.gate = gate && !end;
      if (end && end !== 'cast') { to.face = norm2([-dir[0] * 0.6, -dir[1] * 0.6 - 0.4]); to.reach = TERRACE_OF[end] + 1.8; }
      if (to.gate) { to.face = norm2([-dir[0], -dir[1] - 0.2]); to.reach = TERRACE_OF.gate + 1.8; }
      for (const bend of [1, 0]) {
        const w = this.make(j, to, r, bend, spur);
        if (force || this.fits(w, [])) {
          this.commitJ(to); this.commitW(w);
          if (!end) this.tips.push({ j: to, d: dir });
          return true;
        }
      }
      if (j.gate) break;
    }
    return false;
  }
  /** Two tips meeting at a junction above them both. */
  private meet(a: Tip, b: Tip, r: Rand): boolean {
    const z = Math.max(a.j.z, b.j.z) + ramp(r, 30, 46), x = (a.j.x + b.j.x) / 2 + ramp(r, -4, 4);
    const m = this.junction(x, z, null);
    const wa = this.make(a.j, m, r, 0, false), wb = this.make(b.j, m, r, 0, false);
    if (!this.fits(wa, [wb]) || !this.fits(wb, [wa]) || this.crossesAny(wa, [wb])) return false;
    this.commitJ(m); this.commitW(wa); this.commitW(wb);
    this.tips.splice(this.tips.indexOf(b), 1);
    this.tips.push({ j: m, d: norm2([0, 1]) });
    return true;
  }
  private crossesAny(w: Way, others: Way[]) { return others.some((o) => crosses(w, o)); }
  /** Whether a way would fit: crossing none, close by none (but those it shares its foot with, at its foot), its junction clear of the others. */
  private fits(w: Way, also: Way[]): boolean {
    const to = w.to;
    for (const j of this.junctionsAt(to.z - JAPART, to.z + JAPART)) if (j !== w.from && j !== to && Math.hypot(j.x - to.x, j.z - to.z) < JAPART) return false;
    const others = [...this.waysAt(w.box[2] - APART, w.box[3] + APART), ...also];
    const P = w.pts;
    for (const e of others) {
      if (e === w) continue;
      const shared = e.from === w.from || e.to === w.from || e.to === w.to;
      if (shared ? crosses(w, e, 0.6) : crosses(w, e)) return false;
      if (e.box[0] > w.box[1] + APART || e.box[1] < w.box[0] - APART) continue;
      for (let i = 0; i < P.length; i += 3) {
        // (near a junction they share, they may draw together)
        const nearFoot = shared && Math.hypot(P[i] - w.from.x, P[i + 1] - w.from.z) < 12;
        const nearHead = shared && Math.hypot(P[i] - w.to.x, P[i + 1] - w.to.z) < 12;
        if (nearFoot || nearHead) continue;
        if (distTo(e.pts, P[i], P[i + 1]) < APART + (e.to.reach || w.to.reach ? 2 : 0)) return false;
      }
    }
    // (a building at its end: its terrace clear of every other way)
    if (to.reach) for (const e of others) if (e !== w && distTo(e.pts, to.x, to.z) < TERRACE_OF.hall + 6) return false;
    return true;
  }
  /** (as made so far: no growing) */
  private waysAt(z0: number, z1: number): Way[] {
    const seen = new Set<Way>();
    for (let k = Math.floor(z0 / BUCKET); k <= Math.floor(z1 / BUCKET); k++) for (const w of this.wb.get(k) ?? []) seen.add(w);
    return [...seen];
  }
  private junctionsAt(z0: number, z1: number): Junction[] {
    const out: Junction[] = [];
    for (let k = Math.floor(z0 / BUCKET); k <= Math.floor(z1 / BUCKET); k++) out.push(...(this.jb.get(k) ?? []));
    return out;
  }
  /** A way's shape, from one junction to another: a curve, bent a little (`bend` 0: straight); through a building's front, straight up its stair. */
  private make(from: Junction, to: Junction, r: Rand, bend: number, spur: boolean): Way {
    const a0: V3 = [from.x, from.y, from.z], b1: V3 = [to.x, to.y, to.z];
    const a: V3 = from.gate ? [from.x - from.face[0] * from.reach, 0, from.z - from.face[1] * from.reach] : [...a0];
    const b: V3 = to.reach ? [to.x + to.face[0] * to.reach, 0, to.z + to.face[1] * to.reach] : [...b1];
    a[1] = this.hill(a[2]); b[1] = this.hill(b[2]);
    const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1;
    const bb = bend * (hash(this.seed, from.n, Math.round(to.x * 10), 0xbe) % 1000 / 1000 - 0.5) * 0.4 * L;
    let c: V3 = [(a[0] + b[0]) / 2 + (dz / L) * bb, 0, (a[2] + b[2]) / 2 - (dx / L) * bb];
    // (into a building's front, out of a gate's back: its curve meets the straight on its line)
    if (to.reach) c = [b[0] + to.face[0] * L * 0.4, 0, b[2] + to.face[1] * L * 0.4];
    if (from.gate) c = [a[0] - from.face[0] * L * 0.4, 0, a[2] - from.face[1] * L * 0.4];
    c[2] = Math.max(Math.min(a[2], b[2]) + 0.3, Math.min(Math.max(a[2], b[2]) - 0.3, c[2]));
    c[1] = this.hill(c[2]);
    void r;
    const w: Way = { id: '', n: -1, from, to, a, c, b, a0, b1, head: 0, tail: 0, len: 0, samp: new Float64Array(N + 1), stairs: [], spur, box: [0, 0, 0, 0], pts: new Float64Array(0) };
    const head = Math.hypot(a[0] - a0[0], a[2] - a0[2]), tail = Math.hypot(b1[0] - b[0], b1[2] - b[2]);
    w.head = head; w.tail = tail;
    w.box = [Math.min(a0[0], a[0], b[0], c[0], b1[0]), Math.max(a0[0], a[0], b[0], c[0], b1[0]), Math.min(a0[2], a[2], b[2], b1[2]), Math.max(a0[2], a[2], b[2], b1[2])];
    let len = 0, q = a;
    for (let t = 1; t <= N; t++) { const p = bez(a, c, b, t / N); len += Math.hypot(p[0] - q[0], p[2] - q[2]); w.samp[t] = len; q = p; }
    w.len = head + len + tail;
    const P: number[] = [];
    if (head > 0) P.push(a0[0], a0[2], 0);
    for (let t = 0; t <= N; t++) { const p = bez(a, c, b, t / N); P.push(p[0], p[2], head + w.samp[t]); }
    if (tail > 0) P.push(b1[0], b1[2], w.len);
    w.pts = new Float64Array(P);
    return w;
  }
  /** Where along a way it climbs in steps: where its height, as the hill gives it, rises steeply for its going. */
  private stairsOf(w: Way): StairRun[] {
    const steep: boolean[] = [];
    const M = 64;
    for (let i = 0; i < M; i++) {
      const u0 = (i / M) * w.len, u1 = ((i + 1) / M) * w.len;
      const h0 = this.hill(this.at(w, u0, true).p[2]), h1 = this.hill(this.at(w, u1, true).p[2]);
      steep.push((h1 - h0) / (u1 - u0) > 0.13);
    }
    // (runs of steep: short gentle gaps in a stair taken into it; short steep bits left as trail)
    const runs: StairRun[] = [];
    let i = 0;
    while (i < M) {
      if (!steep[i]) { i++; continue; }
      let j = i;
      while (j < M && (steep[j] || (j + 2 < M && steep[j + 1] && steep[j + 2]))) j++;
      const u0 = (i / M) * w.len, u1 = (j / M) * w.len;
      const h0 = this.hill(this.at(w, u0, true).p[2]), h1 = this.hill(this.at(w, u1, true).p[2]);
      const n = Math.round((h1 - h0) / RISE);
      if (u1 - u0 > 1.2 && n >= 3) runs.push({ u0, u1, n, h0, h1 });
      i = j;
    }
    return runs;
  }

  // ─── along a way ───────────────────────────────────────────────────────────────────────────────
  /** A way's t on its curve, so far along it. */
  tAt(w: Way, u: number): number {
    const S = w.samp;
    u -= w.head;
    if (u <= 0) return 0;
    if (u >= S[N]) return 1;
    let k = 1;
    while (S[k] < u) k++;
    return (k - 1 + (u - S[k - 1]) / (S[k] - S[k - 1] || 1)) / N;
  }
  /** Where a way is, so far along it: its middle, standing on it (on a step, the step's tread), and its going there. `bare`: the curve only. */
  at(w: Way, u: number, bare = false): { p: V3; dir: [number, number] } {
    const straight = (p0: V3, p1: V3, f: number) => {
      const dx = p1[0] - p0[0], dz = p1[2] - p0[2], l = Math.hypot(dx, dz) || 1;
      const p: V3 = [p0[0] + dx * f, 0, p0[2] + dz * f];
      p[1] = bare ? this.hill(p[2]) : this.surface(w, u, p[2]);
      return { p, dir: [dx / l, dz / l] as [number, number] };
    };
    if (w.head > 0 && u < w.head) return straight(w.a0, w.a, Math.max(0, u / w.head));
    if (w.tail > 0 && u > w.len - w.tail) return straight(w.b, w.b1, Math.min(1, (u - (w.len - w.tail)) / w.tail));
    const t = this.tAt(w, u);
    const p = bez(w.a, w.c, w.b, t), p2 = bez(w.a, w.c, w.b, Math.min(1, t + 0.01)), p1 = bez(w.a, w.c, w.b, Math.max(0, t - 0.01));
    const dx = p2[0] - p1[0], dz = p2[2] - p1[2], l = Math.hypot(dx, dz) || 1;
    if (!bare) p[1] = this.surface(w, u, p[2]);
    return { p, dir: [dx / l, dz / l] };
  }
  /** The height one stands at on a way, so far along it: on a stair, the tread; else the hill. */
  surface(w: Way, u: number, z?: number): number {
    for (const s of w.stairs) if (u >= s.u0 && u < s.u1) {
      const k = Math.min(s.n - 1, Math.floor(((u - s.u0) / (s.u1 - s.u0)) * s.n));
      return s.h0 + ((k + 1) / s.n) * (s.h1 - s.h0);
    }
    return this.hill(z ?? this.at(w, u, true).p[2]);
  }
  /** On a stair there? */
  stairAt(w: Way, u: number): StairRun | null {
    for (const s of w.stairs) if (u >= s.u0 && u < s.u1) return s;
    return null;
  }

  // ─── nearness ──────────────────────────────────────────────────────────────────────────────────
  private near = new Map<number, Near>();
  /** How far a point (x, z) is from the nearest way's middle line, across the ground, and where on it. */
  nearest(x: number, z: number): Near {
    // (asked for again and again about the same places as the hill is made: remembered, to a hand's breadth)
    const key = Math.round(x * 8) * 4194304 + Math.round(z * 8);
    const got = this.near.get(key);
    if (got) return got;
    if (this.near.size > 400000) this.near.clear();
    let best = Infinity, bw: Way | null = null, bu = 0;
    for (let R = 18; !bw || best > R; R *= 2) {
      for (const w of this.waysNear(z - R, z + R)) {
        const bx = w.box;
        if (x < bx[0] - best || x > bx[1] + best || z < bx[2] - best || z > bx[3] + best) continue;
        const P = w.pts;
        for (let i = 3; i < P.length; i += 3) {
          const qx = P[i - 3], qz = P[i - 2], dx = P[i] - qx, dz = P[i + 1] - qz, L2 = dx * dx + dz * dz || 1;
          let t = ((x - qx) * dx + (z - qz) * dz) / L2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = x - qx - dx * t, ez = z - qz - dz * t, d2 = ex * ex + ez * ez;
          if (d2 < best * best) { best = Math.sqrt(d2); bw = w; bu = P[i - 1] + t * (P[i + 2] - P[i - 1]); }
        }
      }
      if (R > 200) break;
    }
    const out: Near = { d: best, w: bw!, u: bu, p: this.at(bw!, bu, true).p };
    this.near.set(key, out);
    return out;
  }

  // ─── the journey: from where one is to where one would be ──────────────────────────────────────
  /**
   * The way from (w, u) to (gw, gu), as legs along ways: each a way and from where along it to
   * where. Through the junctions, the shortest across the ground (up or down the hill, as needed).
   */
  route(w: Way, u: number, gw: Way, gu: number): Array<{ w: Way; u0: number; u1: number }> {
    if (w === gw) return [{ w, u0: u, u1: gu }];
    // (the junctions about the two, and the ways between them)
    const lo = Math.min(w.box[2], gw.box[2]) - 250, hi = Math.max(w.box[3], gw.box[3]) + 250;
    const dist = new Map<Junction, number>(), via = new Map<Junction, Way>();
    const todo: Junction[] = [];
    const seed = (j: Junction, d: number) => { if (d < (dist.get(j) ?? Infinity)) { dist.set(j, d); todo.push(j); } };
    seed(w.from, u); seed(w.to, w.len - u);
    via.set(w.from, w); via.set(w.to, w);
    while (todo.length) {
      todo.sort((a, b) => dist.get(a)! - dist.get(b)!);
      const j = todo.shift()!, d = dist.get(j)!;
      for (const e of [...this.into(j), ...this.outOf(j)]) {
        if (e === w || e.box[3] < lo || e.box[2] > hi) continue;
        const o = e.from === j ? e.to : e.from;
        if (d + e.len < (dist.get(o) ?? Infinity)) { dist.set(o, d + e.len); via.set(o, e); todo.push(o); }
      }
    }
    // (into the goal's way from whichever end is nearer, all told)
    const viaFrom = (dist.get(gw.from) ?? Infinity) + gu, viaTo = (dist.get(gw.to) ?? Infinity) + (gw.len - gu);
    const end = viaFrom <= viaTo ? gw.from : gw.to;
    if (!Number.isFinite(Math.min(viaFrom, viaTo))) return [];
    // (back from that end to where one is, junction by junction)
    const legs: Array<{ w: Way; u0: number; u1: number }> = [{ w: gw, u0: end === gw.from ? 0 : gw.len, u1: gu }];
    let j = end;
    for (let guard = 0; guard < 200; guard++) {
      const e = via.get(j)!;
      if (e === w) { legs.unshift({ w, u0: u, u1: j === w.from ? 0 : w.len }); break; }
      const o = e.from === j ? e.to : e.from;
      legs.unshift({ w: e, u0: e.from === o ? 0 : e.len, u1: e.from === o ? e.len : 0 });
      j = o;
    }
    return legs;
  }
}
/** whether two ways' lines cross, away from their ends */
function crosses(u: Way, v: Way, clear = 0): boolean {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  const A = u.pts, B = v.pts;
  // (where they share a junction, not within `clear` of it: there they meet, as they must)
  const ends = [u.from, u.to].filter((j) => j === v.from || j === v.to);
  const nearEnd = (x: number, z: number) => ends.some((j) => Math.hypot(x - j.x, z - j.z) < clear);
  const lo = clear ? 0 : 3;
  for (let i = lo; i + 3 < A.length; i += 3) for (let j = lo; j + 3 < B.length; j += 3) {
    const [ax, az, bx, bz, cx, cz, dx, dz] = [A[i], A[i + 1], A[i + 3], A[i + 4], B[j], B[j + 1], B[j + 3], B[j + 4]];
    if (clear && (nearEnd(ax, az) || nearEnd(cx, cz))) continue;
    if (o(ax, az, bx, bz, cx, cz) * o(ax, az, bx, bz, dx, dz) < 0 && o(cx, cz, dx, dz, ax, az) * o(cx, cz, dx, dz, bx, bz) < 0) return true;
  }
  return false;
}
const norm2 = (v: [number, number]): [number, number] => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

/** how far (x, z) is from a way's line */
function distTo(P: Float64Array, x: number, z: number): number {
  let best = Infinity;
  for (let i = 3; i < P.length; i += 3) {
    const qx = P[i - 3], qz = P[i - 2], dx = P[i] - qx, dz = P[i + 1] - qz, L2 = dx * dx + dz * dz || 1;
    let t = ((x - qx) * dx + (z - qz) * dz) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - qx - dx * t, ez = z - qz - dz * t;
    best = Math.min(best, ex * ex + ez * ez);
  }
  return Math.sqrt(best);
}
const ramp = (r: Rand, a: number, b: number) => a + r() * (b - a);
/** what a branch ends at, and what a spur goes up to, and how often */
const END_KINDS: Array<[EndKind, number]> = [['hall', 0.3], ['pavilion', 0.22], ['pagoda', 0.16], ['shrine', 0.14], ['cast', 0.18]];
const SPUR_KINDS: Array<[EndKind, number]> = [['pavilion', 0.3], ['shrine', 0.24], ['hall', 0.14], ['pagoda', 0.1], ['cast', 0.22]];
function pick<T>(r: Rand, xs: Array<[T, number]>): T {
  let t = r() * xs.reduce((a, x) => a + x[1], 0);
  for (const [v, p] of xs) { t -= p; if (t <= 0) return v; }
  return xs[xs.length - 1][0];
}

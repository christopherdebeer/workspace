/**
 * Taohua: the path. A way up a hillside: flights of stone steps, turned a little to one side of
 * straight up the hill or the other (not always in turn), a stretch of level ground at each turn;
 * and between them, now and then, a gentle trail wandering on up the slope, no steps, only a few
 * stones and a worn line to show where it goes, sometimes through an open glade. Made as far ahead
 * as it's needed, each piece from the seed and its number, so the same seed is the same climb.
 *
 * World: y up; z up the hill (the path's way on, on the whole); x across it. The hill's height is
 * the path's: at any z, the ground stands where the path does there (the path only ever goes on
 * up the hill, so there's one place on it at each z), and a little noise.
 */
import { hash, seeded } from '../kit/rng';

export type V3 = [number, number, number];

/** the stair's width; a step's rise; a landing's depth; a temple's terrace's depth (when the path goes through it) */
export const WIDTH = 1.9, RISE = 0.16, LANDING = 2.2, TERRACE = 7.2;

/** temples: one standing beside the path (its side: -1 left, +1 right of the way on); a gate the path goes through */
export const BESIDE_L = -1, BESIDE_R = 1, GATE = 2;

export interface Flight {
  /** a flight of steps, or a trail with none */
  kind: 'stair' | 'trail';
  /** its foot (the landing's far edge) and its head, and its way at its head (unit, across the ground) */
  a: V3; b: V3; dir: [number, number];
  /** a stair's steps: so many, each so deep */
  steps: number; run: number;
  /** a trail's bend (it leaves its foot along the way the path was going, and bends to its own) */
  ctrl: V3;
  /** its length across the ground, not counting its landing */
  flat: number;
  /** where along the whole path (m, across the ground) it starts, and its length with the landing before it */
  s0: number; len: number;
  /** the landing at its foot: its middle, and how deep it is (none before a trail; a gate's terrace is deep) */
  land: V3; ll: number;
  /** a temple: through which the path goes at its head (GATE), or beside it partway (BESIDE_L/R), or none (0) */
  temple: number;
  /** an open glade about its middle, so wide (0: none): no trees there */
  glade: number;
  /** (a trail's shape, sampled: how far along it each of its N+1 samples is) */
  samp: Float64Array;
  /** (its extent across the ground, its landing with it: least and most x, least and most z) */
  box: [number, number, number, number];
}

const N = 16;
const boxOf = (ps: V3[]): [number, number, number, number] => [Math.min(...ps.map((p) => p[0])), Math.max(...ps.map((p) => p[0])), Math.min(...ps.map((p) => p[2])), Math.max(...ps.map((p) => p[2]))];
export const bez = (a: V3, c: V3, b: V3, t: number): V3 => {
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1], u * u * a[2] + 2 * u * t * c[2] + t * t * b[2]];
};

export class Path {
  readonly flights: Flight[] = [];
  constructor(readonly seed: number) { this.extend(0); }

  /** Made as far as z (and a piece more). */
  extend(z: number) {
    while (!this.flights.length || this.flights[this.flights.length - 1].b[2] < z + 40) this.next();
  }

  private next() {
    const i = this.flights.length;
    const r = seeded(hash(this.seed, i, 0x7a0));
    const prev = this.flights[i - 1];
    const start: V3 = prev ? [...prev.b] : [0, 0, 0];
    const pd = prev ? prev.dir : [0, 1] as [number, number];
    const s0 = prev ? prev.s0 + prev.len : 0;
    // (a temple now and then, not too often: seven pieces at least since the last; mostly beside the path, sometimes across it)
    let since = 99;
    for (let k = i - 1; k >= 0 && k > i - 8; k--) if (this.flights[k].temple) { since = i - k; break; }
    const templeHere = i > 1 && since >= 7 && hash(this.seed, i, 0x7e) % 4 === 0;
    const gate = templeHere && r() < 0.34;
    // (which way it turns: back across the hill more often than not, and always back toward the middle if it's wandered far)
    const prevSide = prev ? Math.sign(prev.dir[0]) || 1 : 1;
    let side = r() < 0.68 ? -prevSide : prevSide;
    if (start[0] > 8) side = -1; else if (start[0] < -8) side = 1;
    const trail = i > 1 && prev?.temple !== GATE && ((templeHere && !gate) || (!templeHere && r() < 0.55));
    if (trail) {
      // a trail: no steps, a gentle rise; it leaves along the way the path was going and bends to its own
      // (the temple on the side away from where the path has wandered, so it stands on the hill, not off its edge)
      const temple = templeHere ? (start[0] > 2 ? BESIDE_L : start[0] < -2 ? BESIDE_R : r() < 0.5 ? BESIDE_L : BESIDE_R) : 0;
      // (beside a temple, level and straight up the hill, through a glade, so its terrace stands on level ground)
      // (mostly across the hill, rising gently: the way winds from side to side as much as it climbs)
      const L = temple ? 10 : 6 + r() * 8;
      let ang = temple ? 0 : side * (0.45 + r() * 0.7);
      if (Math.abs(start[0] + Math.sin(ang) * L) > 11) ang = -ang;
      const dir: [number, number] = [Math.sin(ang), Math.cos(ang)];
      const slope = temple ? 0 : 0.05 + r() * 0.1;
      const a: V3 = [...start];
      const b: V3 = [a[0] + dir[0] * L, a[1] + L * slope, a[2] + dir[1] * L];
      const ctrl: V3 = temple ? [(a[0] + b[0]) / 2, a[1], (a[2] + b[2]) / 2] : [a[0] + pd[0] * L * 0.5, (a[1] + b[1]) / 2, a[2] + pd[1] * L * 0.5];
      // (its length, and how far along it each sample of the curve falls)
      const samp = new Float64Array(N + 1);
      let len = 0, q = a;
      for (let k = 1; k <= N; k++) { const p = bez(a, ctrl, b, k / N); len += Math.hypot(p[0] - q[0], p[2] - q[2]); samp[k] = len; q = p; }
      const ex = bez(a, ctrl, b, 1 - 1 / N), ed = Math.hypot(b[0] - ex[0], b[2] - ex[2]) || 1;
      const glade = temple ? 7 : r() < 0.3 ? 3 + r() * 3.5 : 0;
      this.flights.push({ kind: 'trail', a, b, dir: [(b[0] - ex[0]) / ed, (b[2] - ex[2]) / ed], steps: 0, run: 0, ctrl, flat: len, s0, len, land: a, ll: 0, temple, glade, samp, box: boxOf([a, ctrl, b]) });
      return;
    }
    // a flight of steps: first a landing on along the last piece's way, where the turn happens (through a gate's terrace, if the last flight had one at its head)
    const ll = prev?.temple === GATE ? TERRACE : prev?.kind === 'trail' ? 0.6 : LANDING * (0.75 + r() * 0.7);
    const land: V3 = [start[0] + pd[0] * ll / 2, start[1], start[2] + pd[1] * ll / 2];
    const a: V3 = [start[0] + pd[0] * ll, start[1], start[2] + pd[1] * ll];
    const ang = gate ? side * 0.06 : side * (0.15 + r() * 0.85) * (i === 0 ? 0.3 : 1);
    const dir: [number, number] = [Math.sin(ang), Math.cos(ang)];
    // (some steps, each a hand's rise; deep treads where it's gentler)
    const steps = gate ? 10 + Math.floor(r() * 6) : 4 + Math.floor(r() * 9);
    const run = 0.3 + r() * 0.12;
    const flat = steps * run;
    const b: V3 = [a[0] + dir[0] * flat, a[1] + steps * RISE, a[2] + dir[1] * flat];
    this.flights.push({ kind: 'stair', a, b, dir, steps, run, ctrl: a, flat, s0, len: ll + flat, land, ll, temple: gate ? GATE : 0, glade: 0, samp: new Float64Array(0), box: boxOf([start, a, b]) });
  }

  /** The piece that's at s along the path (from the start, across the ground). */
  flightAt(s: number): Flight {
    const f = this.flights;
    while (f[f.length - 1].s0 + f[f.length - 1].len < s) this.next();
    let lo = 0, hi = f.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (f[m].s0 <= s) lo = m; else hi = m - 1; }
    return f[lo];
  }

  /** A trail's t on its curve, so far along it. */
  tAt(f: Flight, u: number): number {
    const S = f.samp;
    if (u <= 0) return 0;
    if (u >= S[N]) return 1;
    let k = 1;
    while (S[k] < u) k++;
    return (k - 1 + (u - S[k - 1]) / (S[k] - S[k - 1] || 1)) / N;
  }

  /**
   * Where the path is at s: its middle, standing on it (on a step's tread, the step's own height),
   * and its way on there.
   */
  at(s: number): { p: V3; dir: [number, number] } {
    const f = this.flightAt(Math.max(0, s));
    const d = Math.max(0, s) - f.s0;
    if (f.kind === 'trail') {
      const t = this.tAt(f, d);
      const p = bez(f.a, f.ctrl, f.b, t), p2 = bez(f.a, f.ctrl, f.b, Math.min(1, t + 0.02)), p1 = bez(f.a, f.ctrl, f.b, Math.max(0, t - 0.02));
      const dx = p2[0] - p1[0], dz = p2[2] - p1[2], l = Math.hypot(dx, dz) || 1;
      return { p, dir: [dx / l, dz / l] };
    }
    if (d < f.ll) {
      // (on the landing: from the last piece's head, along its way, turning to this one's at the last)
      const prev = this.flights[this.flights.indexOf(f) - 1];
      const pd = prev ? prev.dir : f.dir;
      const t = Math.max(0, 1 - (f.ll - d) / LANDING);
      const start: V3 = prev ? prev.b : [0, 0, 0];
      const dir: [number, number] = [pd[0] * (1 - t) + f.dir[0] * t, pd[1] * (1 - t) + f.dir[1] * t];
      const l = Math.hypot(dir[0], dir[1]);
      return { p: [start[0] + pd[0] * d, f.a[1], start[2] + pd[1] * d], dir: [dir[0] / l, dir[1] / l] };
    }
    const u = d - f.ll;
    const k = Math.min(f.steps - 1, Math.floor(u / f.run));
    return { p: [f.a[0] + f.dir[0] * u, f.a[1] + (k + 1) * RISE, f.a[2] + f.dir[1] * u], dir: f.dir };
  }

  /** The hill's height at z: where the path stands there, smoothly (not stepped). */
  hill(z: number): number {
    this.extend(z);
    const f = this.flights;
    if (z <= 0) return z * 0.3;
    // (the first piece whose head is above z: z is on it, or on the landing before it)
    let lo = 0, hi = f.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (f[m].b[2] < z) lo = m + 1; else hi = m; }
    for (let i = lo; i < f.length; i++) {
      const fl = f[i];
      if (z < fl.a[2]) return fl.a[1];
      if (z <= fl.b[2]) {
        if (fl.kind === 'stair') return fl.a[1] + ((z - fl.a[2]) / (fl.b[2] - fl.a[2])) * (fl.b[1] - fl.a[1]);
        // (a trail: where on its curve it's at z; the ground there as high as the trail)
        let t0 = 0, t1 = 1;
        for (let k = 0; k < 20; k++) { const t = (t0 + t1) / 2; if (bez(fl.a, fl.ctrl, fl.b, t)[2] < z) t0 = t; else t1 = t; }
        return bez(fl.a, fl.ctrl, fl.b, (t0 + t1) / 2)[1];
      }
    }
    return f[f.length - 1].b[1];
  }

  /** How far a point (x, z) is from the path's middle line, across the ground; and how far along the path that nearest place is. */
  nearest(x: number, z: number): { d: number; s: number } {
    // (asked for again and again about the same places as the hill is made: remembered, to a hand's breadth)
    const xi = Math.round(x * 8), zi = Math.round(z * 8), key = xi * 4194304 + zi;
    const got = this.near.get(key);
    if (got) return got;
    if (this.near.size > 400000) this.near.clear();
    const out = this.nearestAt(x, z);
    this.near.set(key, out);
    return out;
  }
  private near = new Map<number, { d: number; s: number }>();
  private nearestAt(x: number, z: number): { d: number; s: number } {
    this.extend(z);
    let best = Infinity, bs = 0;
    const F = this.flights;
    let lo = 0, hi = 0;
    const seg = (p: V3, q: V3, s0: number) => {
      const dx = q[0] - p[0], dz = q[2] - p[2], L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[2]) * dz) / L2));
      const d = Math.hypot(x - p[0] - dx * t, z - p[2] - dz * t);
      if (d < best) { best = d; bs = s0 + t * Math.sqrt(L2); }
    };
    const visit = (i: number) => {
      const f = F[i], bx = f.box;
      // (not if all of it is further than the nearest yet)
      if (x < bx[0] - best || x > bx[1] + best || z < bx[2] - best || z > bx[3] + best) return;
      if (f.kind === 'trail') {
        // (the trail's curve, a piece at a time)
        let q = f.a;
        for (let k = 1; k <= N; k++) { const p = bez(f.a, f.ctrl, f.b, k / N); seg(q, p, f.s0 + f.samp[k - 1]); q = p; }
        return;
      }
      // (the landing, a short piece; the flight, a long one)
      const start: V3 = i > 0 ? F[i - 1].b : [0, 0, 0];
      seg(start, f.a, f.s0);
      seg(f.a, f.b, f.s0 + f.ll);
    };
    // (from the piece at z, outward up and down the hill, until the pieces are further off in z than the nearest yet)
    lo = 0; hi = F.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (F[m].b[2] < z) lo = m + 1; else hi = m; }
    for (let i = lo; i < F.length && F[i].box[2] - z < best; i++) visit(i);
    for (let i = lo - 1; i >= 0 && z - F[i].box[3] < best; i--) visit(i);
    return { d: best, s: bs };
  }
}

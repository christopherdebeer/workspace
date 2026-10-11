/**
 * Taohua: the path. A stone stair up a hillside, zigzagging: flight after flight, each turned a
 * little to one side of straight up the hill, then the other, a landing at each turn; on forever,
 * made as far ahead as it's needed, each flight from the seed and its number, so the same seed is
 * the same climb.
 *
 * World: y up; z up the hill (the path's way on, on the whole); x across it. The hill's height is
 * the path's: at any z, the ground stands where the path does there (the path only ever goes on
 * up the hill, so there's one place on it at each z), and a little noise.
 */
import { hash, seeded } from '../kit/rng';

export type V3 = [number, number, number];

/** the stair's width; a step's rise; a landing's depth */
export const WIDTH = 2.3, RISE = 0.16, LANDING = 2.6;

export interface Flight {
  /** its foot (the landing's far edge) and its head, and its way (unit, across the ground) */
  a: V3; b: V3; dir: [number, number];
  /** its steps: so many, each so deep */
  steps: number; run: number;
  /** where along the whole path (m, across the ground) it starts, and its length across the ground (with the landing before it) */
  s0: number; len: number;
  /** the landing at its foot: its middle */
  land: V3;
  /** a temple beside the landing at its head, which side (+1: right of the way on), if any */
  temple: number;
}

export class Path {
  readonly flights: Flight[] = [];
  constructor(readonly seed: number) { this.extend(0); }

  /** Made as far as z (and a flight more). */
  extend(z: number) {
    while (!this.flights.length || this.flights[this.flights.length - 1].b[2] < z + 40) this.next();
  }

  private next() {
    const i = this.flights.length;
    const r = seeded(hash(this.seed, i, 0x7a0));
    const prev = this.flights[i - 1];
    const start: V3 = prev ? [...prev.b] : [0, 0, 0];
    // (the landing at its foot: on along the last flight's way, so the turn happens on it)
    const pd = prev ? prev.dir : [0, 1] as [number, number];
    const land: V3 = [start[0] + pd[0] * LANDING / 2, start[1], start[2] + pd[1] * LANDING / 2];
    const a: V3 = [start[0] + pd[0] * LANDING, start[1], start[2] + pd[1] * LANDING];
    // (zigzag: turned to one side of straight up, then the other; back toward the middle if it's wandered)
    let side = i % 2 === 0 ? 1 : -1;
    if (a[0] > 6) side = -1; else if (a[0] < -6) side = 1;
    const ang = side * (0.35 + r() * 0.5) * (i === 0 ? 0.3 : 1);
    const dir: [number, number] = [Math.sin(ang), Math.cos(ang)];
    // (a flight: some steps, each a hand's rise; deep treads where it's gentler)
    const steps = 14 + Math.floor(r() * 26);
    const run = 0.3 + r() * 0.18;
    const flat = steps * run;
    const b: V3 = [a[0] + dir[0] * flat, a[1] + steps * RISE, a[2] + dir[1] * flat];
    const s0 = prev ? prev.s0 + prev.len : 0;
    // (now and then, at the head of a flight, a temple beside the landing, away from where the path turns)
    const temple = i > 1 && hash(this.seed, i, 0x7e) % 5 === 0 ? -side : 0;
    this.flights.push({ a, b, dir, steps, run, s0, len: LANDING + flat, land, temple });
  }

  /** The flight that's at s along the path (from the start, across the ground). */
  flightAt(s: number): Flight {
    const f = this.flights;
    while (f[f.length - 1].s0 + f[f.length - 1].len < s) this.next();
    let lo = 0, hi = f.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (f[m].s0 <= s) lo = m; else hi = m - 1; }
    return f[lo];
  }

  /**
   * Where the path is at s: its middle, standing on it (on a step's tread, the step's own height),
   * and its way on there.
   */
  at(s: number): { p: V3; dir: [number, number] } {
    const f = this.flightAt(Math.max(0, s));
    const d = Math.max(0, s) - f.s0;
    const prev = this.flights[this.flights.indexOf(f) - 1];
    if (d < LANDING) {
      // (on the landing: from the last flight's head, along its way, turning to this one's)
      const pd = prev ? prev.dir : f.dir;
      const t = d / LANDING;
      const start: V3 = prev ? prev.b : [0, 0, 0];
      const dir: [number, number] = [pd[0] * (1 - t) + f.dir[0] * t, pd[1] * (1 - t) + f.dir[1] * t];
      const l = Math.hypot(dir[0], dir[1]);
      return { p: [start[0] + pd[0] * d, f.a[1], start[2] + pd[1] * d], dir: [dir[0] / l, dir[1] / l] };
    }
    const u = d - LANDING;
    const k = Math.min(f.steps - 1, Math.floor(u / f.run));
    return { p: [f.a[0] + f.dir[0] * u, f.a[1] + (k + 1) * RISE, f.a[2] + f.dir[1] * u], dir: f.dir };
  }

  /** The hill's height at z: where the path stands there, smoothly (not stepped). */
  hill(z: number): number {
    this.extend(z);
    const f = this.flights;
    if (z <= 0) return z * 0.3;
    for (let i = 0; i < f.length; i++) {
      const fl = f[i];
      if (z < fl.a[2]) return fl.a[1];
      if (z <= fl.b[2]) return fl.a[1] + ((z - fl.a[2]) / (fl.b[2] - fl.a[2])) * (fl.b[1] - fl.a[1]);
    }
    return f[f.length - 1].b[1];
  }

  /** How far a point (x, z) is from the path's middle line, across the ground; and how far along the path that nearest place is. */
  nearest(x: number, z: number): { d: number; s: number } {
    this.extend(z);
    let best = Infinity, bs = 0;
    for (const f of this.flights) {
      if (f.b[2] < z - 30 || f.land[2] > z + 30) continue;
      // (the landing, a short piece; the flight, a long one)
      const prev = this.flights[this.flights.indexOf(f) - 1];
      const start: V3 = prev ? prev.b : [0, 0, 0];
      for (const [p, q, s0] of [[start, f.a, f.s0], [f.a, f.b, f.s0 + LANDING]] as Array<[V3, V3, number]>) {
        const dx = q[0] - p[0], dz = q[2] - p[2], L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[2]) * dz) / L2));
        const d = Math.hypot(x - p[0] - dx * t, z - p[2] - dz * t);
        if (d < best) { best = d; bs = s0 + t * Math.sqrt(L2); }
      }
    }
    return { d: best, s: bs };
  }
}

/**
 * Taohua: the water on the hill. Now and then a stream comes down it: from a spring among rocks, it
 * runs down the hill, wandering across it as it goes, to a pond (or a marsh) at its foot. Where the
 * hill is gentle it slows and pools; where it's steep it runs white over rocks, or falls, in steps
 * from pool to pool or all at once into a deep pool under a cliff.
 *
 * It's laid out before the ways, from the seed alone, a stream at a time up the hill, so any part of
 * it can be made without the rest; the ways cross it where they can (see Ways.fits). Each stream's
 * water lies level across it; down it, its level follows the hill, or stands level in a pool, or
 * drops at a fall. The ground is carved to hold it (see `bed`).
 */
import { hash, noise1, seeded, type Rand } from '../kit/rng';

const ramp = (r: Rand, a: number, b: number) => a + r() * (b - a);
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export type PoolKind = 'pool' | 'pond' | 'marsh' | 'spring' | 'plunge';
/** A pool: an ellipse of still water, level, its long side across the hill. */
export interface Pool { x: number; z: number; rx: number; rz: number; L: number; kind: PoolKind }
/** A run of falls down a steep stretch: the lips (downstream edges) of its pools, from the foot up; a single fall has one. */
export interface Falls { za: number; zb: number; lips: number[]; single: boolean }
export interface Stream {
  k: number;
  /** its foot (lowest) and its spring (highest), up the hill */
  z0: number; z1: number;
  x0: number; A: number[]; lam: number[]; ph: number[];
  /** its half-width, on the whole */
  w0: number;
  pools: Pool[];
  falls: Falls[];
  /** what its foot is */
  foot: 'pond' | 'marsh';
}
/** What the water is at a place, if near: how far outside its edge (negative within), its level, and what kind of water. */
export interface Wet {
  s: number; L: number;
  kind: 'flow' | 'falls' | PoolKind;
  st: Stream;
  /** how steeply its banks rise from it (rock where steep) */
  bank: number;
  /** how fast it runs here: the hill's slope under it, if it's flowing */
  run: number;
  /** (for a stream: how far across from its middle line, signed) */
  across: number;
}

/** the levels' drop below the hill, where a stream runs */
const SINK = 0.12;

export class Water {
  private streams: Stream[] = [];
  constructor(readonly seed: number, private hill: (z: number) => number, private slope: (z: number) => number) {}

  /** The streams that run anywhere between z0 and z1. */
  streamsNear(z0: number, z1: number): Stream[] {
    while (!this.streams.length || this.streams[this.streams.length - 1].z0 < z1 + 400) this.lay();
    return this.streams.filter((s) => s.z1 + 20 >= z0 && s.z0 - 32 <= z1);
  }

  /** The next stream up the hill: its foot well above the last one's spring. */
  private lay() {
    const k = this.streams.length, r = seeded(hash(this.seed, k, 0x57e));
    const prev = this.streams[k - 1];
    const z0 = prev ? prev.z1 + ramp(r, 140, 320) : ramp(r, 70, 130);
    const z1 = z0 + ramp(r, 170, 330);
    const st: Stream = {
      k, z0, z1, x0: ramp(r, -26, 26),
      A: [ramp(r, 7, 15), ramp(r, 2, 5)], lam: [ramp(r, 34, 60), ramp(r, 11, 19)], ph: [r() * 6.3, r() * 6.3],
      w0: ramp(r, 0.95, 1.5), pools: [], falls: [], foot: r() < 0.35 ? 'marsh' : 'pond',
    };
    // (where it's steep: runs of falls, now and then; else it runs white down the slope)
    let z = z0 + 14;
    while (z < z1 - 12) {
      if (this.slope(z) < 0.2) { z += 1; continue; }
      let zb = z;
      while (zb < z1 - 8 && this.slope(zb) >= 0.2) zb += 1;
      const len = zb - z, rise = this.hill(zb) - this.hill(z);
      if (len >= 7 && r() < 0.6) {
        const single = rise > 2.4 && r() < 0.45;
        const lips: number[] = [];
        if (single) {
          // (one fall, from as high as it's 2.5 to 4.5 metres above the foot of the steep, into a deep pool cut into the hill under it)
          const drop = Math.min(rise - 0.3, ramp(r, 2.5, 4.5));
          let lip = z;
          while (lip < zb && this.hill(lip) - this.hill(z) < drop) lip += 0.25;
          lips.push(lip);
          const L = this.hill(z) - SINK + 0.06, rz = (lip - z) * 0.55 + 1.2;
          st.pools.push({ x: 0, z: z + (lip - z) * 0.4, rx: ramp(r, 3.6, 5.4), rz, L, kind: 'plunge' });
        } else { const n = Math.max(2, Math.round(len / 5.5)); for (let i = 0; i < n; i++) lips.push(z + 1 + (i * (len - 1)) / n); }
        st.falls.push({ za: z, zb, lips, single });
      }
      z = zb + 6;
    }
    // (where it's gentle, now and then a pool)
    for (let z = z0 + 26; z < z1 - 18; z += 1) {
      if (this.slope(z) > 0.085 || st.falls.some((f) => z > f.za - 12 && z < f.zb + 8) || st.pools.some((p) => Math.abs(p.z - z) < 30)) continue;
      if (r() < 0.06) { const rz = Math.min(ramp(r, 2.4, 4), 0.9 / (1.7 * Math.max(0.05, this.slope(z)))); st.pools.push({ x: 0, z, rx: ramp(r, 3.2, 6), rz, L: this.rimLevel(z, rz), kind: 'pool' }); }
    }
    // (at its spring, a small pool among rocks; at its foot, a pond or a marsh)
    st.pools.push({ x: 0, z: z1, rx: ramp(r, 1.6, 2.4), rz: ramp(r, 1.4, 2), L: this.hill(z1) - SINK, kind: 'spring' });
    // (the foot's pool where the hill's gentlest, about where it would be)
    const fr = st.foot === 'marsh' ? [ramp(r, 9, 14), ramp(r, 5, 7.5)] : [ramp(r, 7, 12), ramp(r, 4.5, 7)];
    let fz = z0 - fr[1] * 0.6;
    for (let z = z0 - 24; z <= z0 + 6; z += 1) if (this.slope(z) < this.slope(fz) - 0.01) fz = z;
    // (no deeper into the hill at its back than a metre or so: on a slope, shallower up it)
    fr[1] = Math.min(fr[1], 0.9 / (1.7 * Math.max(0.05, this.slope(fz))));
    st.pools.push({ x: 0, z: fz, rx: fr[0], rz: fr[1], L: this.rimLevel(fz, fr[1]), kind: st.foot });
    // (the stream runs on into it, wherever it lies)
    st.z0 = fz + fr[1] * 0.4;
    for (const p of st.pools) p.x = this.xAt(st, p.z);
    this.streams.push(st);
  }

  /** A pool's level: held at its downhill rim, so it's cut into the hill behind (rather than banked up before it). */
  private rimLevel(z: number, rz: number) { return this.hill(z - rz * 0.85) - SINK + 0.08; }
  /** Where across the hill a stream runs, at z. */
  xAt(st: Stream, z: number): number {
    return st.x0 + st.A[0] * Math.sin(z / st.lam[0] + st.ph[0]) + st.A[1] * Math.sin(z / st.lam[1] + st.ph[1]);
  }
  /** its going across the hill for its going down it, at z */
  private dxAt(st: Stream, z: number): number {
    return (st.A[0] / st.lam[0]) * Math.cos(z / st.lam[0] + st.ph[0]) + (st.A[1] / st.lam[1]) * Math.cos(z / st.lam[1] + st.ph[1]);
  }
  /** its half-width at z: narrow at its spring, wider toward its foot, wider in a run of falls' pools */
  halfAt(st: Stream, z: number): number {
    const n = noise1(hash(this.seed, st.k, 0x3d), z / 9);
    return st.w0 * (0.75 + 0.5 * n) * (0.55 + 0.45 * smooth(st.z1, st.z1 - 30, z)) * (this.slope(z) > 0.2 ? 0.8 : 1);
  }
  /** Its level at z, along its line: following the hill, or level in a pool or a step of falls. */
  levelAt(st: Stream, z: number): { L: number; kind: Wet['kind'] } {
    for (const f of st.falls) if (z >= f.za - 1 && z <= f.zb) {
      if (f.single) return z < f.lips[0] ? { L: this.hill(f.za) - SINK + 0.06, kind: 'plunge' } : { L: this.hill(z) - SINK, kind: 'flow' };
      // (each step's pool level with its lip, a little above the hill there: the rock holds it)
      let lip = f.lips[0];
      for (const l of f.lips) if (l <= z) lip = l;
      if (z < f.lips[0]) return { L: this.hill(z) - SINK, kind: 'flow' };
      return { L: this.hill(lip) + 0.1, kind: 'falls' };
    }
    // (through a pool it's the pool: see `at`; the pool's water stands over it, the stream running in at its head)
    return { L: this.hill(z) - SINK, kind: 'flow' };
  }

  private memo = new Map<number, Wet[]>();
  /** All the water whose banks reach (x, z): each stream's channel, and its pools. */
  near(x: number, z: number): Wet[] {
    const key = Math.round(x * 8) * 4194304 + Math.round(z * 8);
    const got = this.memo.get(key);
    if (got) return got;
    if (this.memo.size > 600000) this.memo.clear();
    const out: Wet[] = [];
    for (const st of this.streamsNear(z, z)) {
      if (z < st.z0 - 30 || z > st.z1 + 6) continue;
      // (its channel: from its spring down into its foot's pool)
      if (z <= st.z1 && z >= st.z0 - 4) {
        const lv = this.levelAt(st, z);
        const xc = this.xAt(st, z), d = Math.abs(x - xc) / Math.hypot(1, this.dxAt(st, z));
        const s = d - this.halfAt(st, z) * (lv.kind === 'falls' ? 1.5 : 1);
        if (s < 14) out.push({ s, L: lv.L, kind: lv.kind, st, bank: lv.kind === 'falls' ? 1.3 : lv.kind === 'plunge' ? 1.6 : 0.35, run: lv.kind === 'flow' ? this.slope(z) : 0, across: (x - xc) / Math.hypot(1, this.dxAt(st, z)) });
      }
      for (const p of st.pools) {
        const dx = (x - p.x) / p.rx, dz = (z - p.z) / p.rz, e = Math.hypot(dx, dz);
        if (e > 6) continue;
        // (its edge wavers, so no pond is an ellipse)
        const wob = 1 + 0.12 * Math.sin(Math.atan2(dz, dx) * 3 + p.z) + 0.07 * Math.sin(Math.atan2(dz, dx) * 5 + p.x);
        const s = (e / wob - 1) * Math.min(p.rx, p.rz);
        if (s < 14) out.push({ s, L: p.L, kind: p.kind, st, bank: p.kind === 'plunge' ? 1.6 : 0.3, run: 0, across: 0 });
      }
    }
    this.memo.set(key, out);
    return out;
  }
  /** The water nearest (x, z), within a few metres (within a pool, the pool, its level the pool's); null if there's none so near. */
  at(x: number, z: number): Wet | null {
    let best: Wet | null = null;
    for (const w of this.near(x, z)) {
      const pool = w.kind !== 'flow' && w.kind !== 'falls';
      if (!best || w.s < best.s || (pool && w.s < 0 && best.kind === 'flow')) best = pool && best && best.s < w.s ? { ...w, s: best.s } : w;
    }
    return best;
  }

  /**
   * The ground, carved for the water: under it, a bed, deeper toward its middle; about it, banks
   * rising from its edge to meet the hill (steep and rocky by falls), or, where the hill lies below
   * the water's level (a pool's lip on a slope), raised to hold it. Each water carves (or raises) its
   * own; the ground takes the deepest cut and the highest raise of them. `g` is the ground as it would be.
   */
  bed(x: number, z: number, g: number): { y: number; cut: number } {
    const ws = this.near(x, z);
    if (!ws.length) return { y: g, cut: 0 };
    // (the deepest any carves it, and the most any raises it: so where two meet it's one ground)
    // (a raise, though, gives way where another water runs: a pool's outflow cuts through its rim)
    let lo = 0, hi = 0;
    for (const w of ws) {
      const d = this.bedOf(w, g) - g;
      lo = Math.min(lo, d);
      if (d > 0) { let o = Infinity; for (const v of ws) if (v !== w) o = Math.min(o, v.s); hi = Math.max(hi, d * smooth(-0.2, 1.4, o)); }
    }
    return { y: g + lo + hi, cut: -lo };
  }
  private bedOf(w: Wet, g: number): number {
    if (w.s < 0) {
      const deep = w.kind === 'pond' || w.kind === 'plunge' ? 1.5 : w.kind === 'marsh' ? 0.35 : w.kind === 'pool' || w.kind === 'falls' ? 0.9 : 0.6;
      return w.L - Math.min(deep, 0.08 + 0.5 * -w.s);
    }
    // (its edge lies just under the water, so the water draws the shore: see the drawing's water; a
    // little out, the bank, rising)
    const rim = w.L - 0.04 + 0.09 * smooth(0.45, 0.8, w.s);
    if (g > rim) return Math.min(g, rim + w.bank * Math.max(0, w.s - 0.45));
    return rim + (g - rim) * smooth(1.4, 4, w.s);
  }
}

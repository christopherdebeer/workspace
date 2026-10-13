/**
 * Taohua: the water on the hill. Now and then a stream comes down it: from a spring among rocks, it
 * runs down the hill, wandering across it as it goes, to a pond (or a marsh) at its foot. Where the
 * hill is gentle it slows and pools; where it's steep it runs white over rocks, or falls, in steps
 * from pool to pool or all at once into a deep pool under a cliff.
 *
 * And across the hill's foot, a wide river, where the journey starts: the hill rises from its near bank
 * (a jetty there, a boat moored at it); its far bank a low plain. It lies level, its near bank wandering
 * a little across the hill, its width its own along it (see `river`).
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
  kind: 'flow' | 'falls' | PoolKind | 'river';
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
/** the river's level; and where its near bank is at x = 0 (its jetty there) */
export const RIVER_L = -0.64, RIVER_NEAR = -4.6;

export class Water {
  private streams: Stream[] = [];
  private fixed = false;
  constructor(readonly seed: number, private hill: (z: number) => number, private slope: (z: number) => number) {}

  /** The streams that run anywhere between z0 and z1. */
  /**
   * The river: (as a stream to whatever asks which water it is, though it runs across the hill, not
   * down it; it's none of the streams.) Its near bank at x, its half-width there, its middle line.
   */
  readonly river: Stream = { k: -1, z0: -60, z1: 0, x0: 0, A: [0, 0, 0], lam: [1, 1, 1], ph: [0, 0, 0], w0: 9, pools: [], falls: [], foot: 'pond' };
  riverNearBank(x: number): number {
    // (in long bends, so its banks run across the picture, not along it: drawn back from the hill's
    // foot either side of the jetty (never up into the hill where the ways begin), and wandering a
    // little of its own)
    const ph = (this.seed % 997) * 0.37, f = (x: number) => -4.5 * (1 - Math.cos(x / 23 + 0.4 * Math.sin(ph))) + 1.1 * Math.sin(x / 9.5 + ph) + 0.25 * Math.sin(x / 4.1 + ph * 2.3);
    return RIVER_NEAR + f(x) - f(0);
  }
  /**
   * its half-width at x: upstream (+x) it opens out into broad water whose far bank's lost to the eye;
   * coming down to the jetty it narrows; below, a river of a fair width
   */
  riverHalf(x: number): number { return 8 + 2.5 * noise1(hash(this.seed, 0x71e), x / 45) + 22 * smooth(14, 70, x); }
  riverMid(x: number): number { return this.riverNearBank(x) - this.riverHalf(x); }
  /**
   * The river's current at (x, z): which way it runs and how fast (m/s), as [along x, along z, speed].
   * It runs down the river (toward -x), along its course; quick in the narrows and slow on the broad
   * water above (the same water through a wider way), quickest down its middle and slack along its
   * banks; and behind the jetty (downstream of it, between its end and the bank) an eddy, where it
   * idles and turns a little back on itself. (Its marks are drawn from it: see marks.ts.)
   */
  riverFlow(x: number, z: number): [number, number, number] {
    const hw = this.riverHalf(x), a = (z - this.riverMid(x)) / hw;
    if (Math.abs(a) > 1.02) return [0, 0, 0];
    const dm = this.riverMid(x + 0.5) - this.riverMid(x - 0.5), l = Math.hypot(1, dm);
    const s0 = Math.max(0.1, Math.min(0.62, (0.55 * 8.5) / hw));
    const prof = 0.18 + 0.82 * Math.pow(Math.max(0, 1 - a * a), 0.6);
    const near = this.riverNearBank(x), eddy = smooth(-7.5, -4, x) * smooth(0.2, -1.2, x) * smooth(-6.5, -4.8, z - near) * smooth(0.6, -0.6, z - near);
    const sp = s0 * prof * (1 - 1.3 * eddy);
    return [(-1 / l) * sp, (-dm / l) * sp, Math.abs(sp)];
  }
  /** whether the river (or its banks) reach anywhere between z0 and z1 */
  riverNear(z0: number, z1: number): boolean { return z0 < RIVER_NEAR + 6 && z1 > RIVER_NEAR - 80; }

  streamsNear(z0: number, z1: number): Stream[] {
    while (!this.fixed && (!this.streams.length || this.streams[this.streams.length - 1].z0 < z1 + 400)) this.lay();
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
      A: [ramp(r, 7, 15), ramp(r, 2, 5), ramp(r, 0.6, 1.1)], lam: [ramp(r, 34, 60), ramp(r, 11, 19), ramp(r, 1, 1.35)], ph: [r() * 6.3, r() * 6.3, r() * 6.3],
      w0: ramp(r, 0.6, 1), pools: [], falls: [], foot: r() < 0.35 ? 'marsh' : 'pond',
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

  /**
   * For a bench: these streams and no others, laid as given: where each runs, its pools, and (if it
   * has one) a single fall, its lip at `fall`, dropping into a deep pool cut under it from `foot`.
   */
  fix(specs: Array<{ z0: number; z1: number; x0: number; A: [number, number, number]; lam: [number, number, number]; w0: number; pools: Array<{ z: number; rx: number; rz: number; kind: PoolKind }>; fall?: { lip: number; foot: number } }>) {
    this.streams = specs.map((sp, k) => {
      const st: Stream = { k, z0: sp.z0, z1: sp.z1, x0: sp.x0, A: sp.A, lam: sp.lam, ph: [0.4, 1.3, 2.1], w0: sp.w0, pools: [], falls: [], foot: 'pond' };
      if (sp.fall) {
        const { lip, foot } = sp.fall;
        st.falls.push({ za: foot, zb: lip + 6, lips: [lip], single: true });
        st.pools.push({ x: 0, z: foot + (lip - foot) * 0.4, rx: 4.6, rz: (lip - foot) * 0.55 + 1.2, L: this.hill(foot) - SINK + 0.06, kind: 'plunge' });
      }
      for (const p of sp.pools) st.pools.push({ x: 0, z: p.z, rx: p.rx, rz: p.rz, L: p.kind === 'spring' ? this.hill(p.z) - SINK : this.rimLevel(p.z, p.rz), kind: p.kind });
      for (const p of st.pools) p.x = this.xAt(st, p.z);
      return st;
    });
    this.fixed = true;
    this.memo.clear();
  }

  /** A pool's level: held at its downhill rim, so it's cut into the hill behind (rather than banked up before it). */
  private rimLevel(z: number, rz: number) { return this.hill(z - rz * 0.85) - SINK + 0.08; }
  /** Where across the hill a stream runs, at z. */
  xAt(st: Stream, z: number): number {
    // (in long bends across the hill, shorter ones, and short wiggles of its own, as a stream winds among stones)
    return st.x0 + st.A[0] * Math.sin(z / st.lam[0] + st.ph[0]) + st.A[1] * Math.sin(z / st.lam[1] + st.ph[1]) + st.A[2] * Math.sin(z / st.lam[2] + st.ph[2]) * (0.6 + 0.4 * Math.sin(z / 23 + st.ph[0]));
  }
  /** its going across the hill for its going down it, at z */
  private dxAt(st: Stream, z: number): number {
    return (st.A[0] / st.lam[0]) * Math.cos(z / st.lam[0] + st.ph[0]) + (st.A[1] / st.lam[1]) * Math.cos(z / st.lam[1] + st.ph[1]) + (st.A[2] / st.lam[2]) * Math.cos(z / st.lam[2] + st.ph[2]) * (0.6 + 0.4 * Math.sin(z / 23 + st.ph[0]));
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
    // (the river: its edge where it is across its middle line by its half-width)
    if (z < RIVER_NEAR + 18 && z > RIVER_NEAR - 100) {
      const zc = this.riverMid(x), hw = this.riverHalf(x), s = Math.abs(z - zc) - hw;
      if (s < 14) out.push({ s, L: RIVER_L, kind: 'river', st: this.river, bank: 0.7, run: 0, across: z - zc });
    }
    for (const st of this.streamsNear(z, z)) {
      if (z < st.z0 - 30 || z > st.z1 + 6) continue;
      // (its channel: from its spring down into its foot's pool)
      if (z <= st.z1 && z >= st.z0 - 4) {
        const lv = this.levelAt(st, z);
        const xc = this.xAt(st, z), d = Math.abs(x - xc) / Math.hypot(1, this.dxAt(st, z));
        const s = d - this.halfAt(st, z) * (lv.kind === 'falls' ? 1.5 : 1);
        if (s < 14) out.push({ s, L: lv.L, kind: lv.kind, st, bank: lv.kind === 'falls' ? 1.3 : lv.kind === 'plunge' ? 1.6 : Math.max(0.35, this.steep(z)), run: lv.kind === 'flow' ? this.slope(z) : 0, across: (x - xc) / Math.hypot(1, this.dxAt(st, z)) });
      }
      for (const p of st.pools) {
        const dx = (x - p.x) / p.rx, dz = (z - p.z) / p.rz, e = Math.hypot(dx, dz);
        if (e > 6) continue;
        // (its edge wavers, so no pond is an ellipse)
        const wob = 1 + 0.12 * Math.sin(Math.atan2(dz, dx) * 3 + p.z) + 0.07 * Math.sin(Math.atan2(dz, dx) * 5 + p.x);
        const s = (e / wob - 1) * Math.min(p.rx, p.rz);
        if (s < 14) out.push({ s, L: p.L, kind: p.kind, st, bank: p.kind === 'plunge' ? 1.6 : Math.max(0.3, this.steep(z)), run: 0, across: 0 });
      }
    }
    this.memo.set(key, out);
    return out;
  }
  /** how steeply a bank must rise from the water, at least, to meet the hill there and not run on along it as a shelf: well steeper than the hill */
  private steep(z: number) { return 0.6 + 2.2 * this.slope(z); }
  /** The water nearest (x, z), within a few metres (within a pool, the pool, its level the pool's); null if there's none so near. */
  at(x: number, z: number): Wet | null {
    let best: Wet | null = null;
    for (const w of this.near(x, z)) {
      const pool = w.kind !== 'flow' && w.kind !== 'falls' && w.kind !== 'river';
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
      const deep = w.kind === 'river' ? 1.8 : w.kind === 'pond' || w.kind === 'plunge' ? 1.5 : w.kind === 'marsh' ? 0.35 : w.kind === 'pool' || w.kind === 'falls' ? 0.9 : 0.6;
      return w.L - Math.min(deep, 0.08 + 0.5 * -w.s);
    }
    // (its edge lies just under the water, so the water draws the shore: see the drawing's water; a
    // little out, the bank, rising)
    const rim = w.L - 0.04 + 0.09 * smooth(0.45, 0.8, w.s);
    if (g > rim) return Math.min(g, rim + w.bank * Math.max(0, w.s - 0.45));
    return rim + (g - rim) * smooth(1.4, 4, w.s);
  }
}

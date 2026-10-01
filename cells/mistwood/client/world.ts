/**
 * The wood in the mist, from one seed: paths that wind and fork through it,
 * its own set of tree species, and where each tree and tuft of grass stands.
 * Nothing is stored — any part of the wood is placed the same again from
 * (seed, cell), in every direction.
 *
 * Paths are where two smooth noise fields cross their middle value: each
 * field's zero line winds by itself, and where the two families meet, paths
 * join and fork. The ground shader (render.ts) computes exactly the same — the
 * same hash, the same noise — so the trees keep off what is drawn.
 *
 * The lie of the land (relief), and what it makes of each place: the
 * hollows are wet (mist pools there, the deepest hold still water), some
 * stretches are open (glades), some disturbed (windthrow: fallen logs, birch
 * and saplings coming up). Each species keeps to the places that suit it, and
 * old veteran trees stand here and there, a clearing about them. The shaders
 * compute the same relief and fields (render.ts NOISE), so the ground, the
 * mist and the trees agree.
 *
 * Species: each wood draws its own from the space of growth parameters around
 * the archetypes (tree.ts `sampleGenome`), and each species has a small pool
 * of grown trees, placed again and again at different sizes and turns.
 */
import { hash, lerp, seeded } from './rng';
import { grow, growLog, growPatch, growScrub, sampleGenome, type Genome, type Species, type Structure } from './tree';

/** Metres per cell of the wood's grid (it goes on in every direction). */
export const CELL = 10;
/** How far the wood is drawn (metres); the fog has it all by then. */
export const VIEW = 75;

/** A species id ('t0', 'b1', …) or ground cover. */
export type Kind = string;

export interface Placed {
  x: number;
  z: number;
  kind: Kind;
  /** which of the pool's structures */
  pool: number;
  scale: number;
  /** its turn about the vertical (a 3D tree seen from a different side) */
  rot: number;
  flip: boolean;
  phase: number;
}

/** What a place is like. */
export interface Place {
  /** ground height (m) */
  h: number;
  /** 0 dry … 1 a wet hollow */
  wet: number;
  /** 0 under the canopy … 1 a glade */
  open: number;
  /** 0 … 1 windthrow (fallen trees, a gap filling again) */
  disturb: number;
  /** depth of standing water here (m; 0 if none) */
  water: number;
}

/** Where each archetype grows (its share of the species' rate, at most `CAP`). */
const AFFINITY: Record<Species, (f: Place) => number> = {
  tall: (f) => 1.1 * (1 - 0.9 * f.open) * (1 - 0.6 * f.wet) * (1 - 0.7 * f.disturb),
  leaner: (f) => (1 - 0.7 * f.open) * (0.5 + 1.3 * f.wet),
  birch: (f) => (0.25 + 1.1 * f.open + 1.6 * f.disturb) * (1 - 0.6 * f.wet),
  sapling: (f) => 0.4 + 2 * f.disturb + 0.8 * f.open,
  shrub: (f) => (0.5 + 0.9 * f.open + 0.9 * f.disturb) * (1 - 0.4 * f.wet),
};
const CAP = 2.5;
/** The veterans' grid (m): at most one old tree to each square. */
const VET = 70;

/**
 * Stone that stands in the wood: a ruined round tower, now and then; rarer, a viaduct striding
 * over a path on tall piers (render.ts traces them; these are the same shapes, for where you
 * cannot walk and where nothing grows).
 */
export interface Structure3 {
  kind: 'tower' | 'viaduct';
  x: number;
  z: number;
  /** turn about the vertical (rad): a viaduct's axis runs along its local x */
  rot: number;
  /** the ground height it stands on (m) */
  base: number;
  /** tower: height, radius, seed · viaduct: deck height, span, piers */
  a: number;
  b: number;
  c: number;
}
/** A stretch of dry-stone wall: from (x0, z0) to (x1, z1), the ground at either end, its height, which ends taper to a gap (1 start, 2 end), and a seed. */
export interface WallStretch {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  y0: number;
  y1: number;
  h: number;
  caps: number;
  seed: number;
}
const WALL_GRID = 150;
/** The grids structures are placed on (m): a tower to some squares, a viaduct to fewer, larger ones. */
const TOWER_GRID = 220;
const VIADUCT_GRID = 340;

export interface SpeciesIn {
  id: Kind;
  genome: Genome;
  /** trees per cell, how far they keep off a path, how much they crowd its sides */
  per: number;
  clear: number;
  nearPath: number;
  pool: number;
}

// ─── the same noise as the shaders' (render.ts NOISE): pcg hash, value noise ──────────────────
function pcg(v: number): number {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
function h2(x: number, y: number, seed: number): number {
  return pcg((Math.imul(x >>> 0, 1973) ^ pcg(((y | 0) + seed) >>> 0)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy, seed);
  const b = h2(ix + 1, iy, seed);
  const c = h2(ix, iy + 1, seed);
  const d = h2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Wood {
  readonly seed: number;
  /** The two path fields' scales (1/m) and the path's half-width (m). */
  readonly path: [number, number, number];
  /** How thick this wood's fog is (per metre). */
  readonly density: number;
  /** The relief: amplitude (m), its scale (1/m), the water level (m), the small swells' amplitude (m). */
  readonly relief: [number, number, number, number];
  /** How open this wood is, overall (glades more or less common): a shift of the glades' field. */
  readonly openness: number;
  readonly species: SpeciesIn[] = [];
  private cache = new Map<number, Placed[]>();
  private pool = new Map<string, Structure>();
  /** Debug (`?only=birch`): every tree of one archetype, to look at it. */
  only: Species | null = null;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const r = seeded(hash(seed, 1));
    this.path = [1 / (55 + 30 * r()), 1 / (85 + 40 * r()), 0.9 + 0.35 * r()];
    this.density = 0.03 + 0.016 * r();
    const amp = 0.9 + 2.2 * r();
    // the water level: in some woods the deepest hollows hold ponds, in others never
    this.relief = [amp, 1 / (65 + 45 * r()), -amp * (0.5 + 0.35 * r()), 0.25 + 0.2 * r()];
    this.openness = (r() - 0.5) * 0.2;
    // this wood's species: around the archetypes, a couple of wild cards further out
    const add = (id: string, archetype: Species, per: number, clear: number, nearPath: number, pool: number, wild = 1) =>
      this.species.push({ id, genome: sampleGenome(seeded(hash(seed, 41, this.species.length)), archetype, wild), per, clear, nearPath, pool });
    const talls = 2 + Math.floor(r() * 2);
    for (let i = 0; i < talls; i++) add(`t${i}`, 'tall', 1.3 / talls, 2.4, 0, 6);
    const leaners = 1 + Math.floor(r() * 2);
    for (let i = 0; i < leaners; i++) add(`l${i}`, 'leaner', 0.1 / leaners, 1.8, 0.35 / leaners, 5);
    if (r() < 0.75) add('b0', 'birch', 0.1, 2.4, 0, 5);
    add('s0', 'sapling', 0.25, 1.6, 0.25, 5);
    add('h0', 'shrub', 0.4, 1.1, 0, 5);
    add('h1', 'shrub', 0.3, 1.1, 0.2, 5);
    const wilds = Math.floor(r() * 3);
    const arch: Species[] = ['tall', 'leaner', 'sapling', 'shrub', 'birch'];
    for (let i = 0; i < wilds; i++) add(`w${i}`, arch[Math.floor(r() * arch.length)], 0.12, 2, 0.1, 4, 1.8);
  }

  /** Roughly how far (m) from the nearest path. */
  pathDist(x: number, z: number): number {
    let best = 1e3;
    for (let i = 0; i < 2; i++) {
      const k = this.path[i];
      const off = i * 37.1;
      const f = (px: number, pz: number) => vnoise(px * k + off, pz * k + off, this.seed) * 0.7 + vnoise(px * k * 2.3 + off * 1.7, pz * k * 2.3 + off * 1.7, this.seed) * 0.3;
      const e = 0.25;
      const n = f(x, z) - 0.5;
      const gx = (f(x + e, z) - f(x - e, z)) / (2 * e);
      const gz = (f(x, z + e) - f(x, z - e)) / (2 * e);
      best = Math.min(best, Math.abs(n) / Math.max(Math.hypot(gx, gz), 1e-4));
    }
    return best;
  }

  /** The nearest point on a path to (x, z) along a line across, and the path's way there. */
  findPath(x: number, z: number): { x: number; z: number; heading: number } {
    let bx = x;
    let bz = z;
    let bd = Infinity;
    for (let r = 0; r <= 120; r += 1)
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r;
        const pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
        const d = this.pathDist(px, pz);
        if (d < bd) {
          bd = d;
          bx = px;
          bz = pz;
        }
        if (bd < 0.15) break;
      }
    // the path's way: the direction from here in which it stays nearest
    let heading = 0;
    let hd = Infinity;
    for (let a = 0; a < 32; a++) {
      const h = (a / 32) * Math.PI * 2;
      if (Math.cos(h) < -0.2) continue; // (onwards, not back)
      let d = 0;
      for (const step of [3, 6, 9, 12]) d += this.pathDist(bx + Math.sin(h) * step, bz + Math.cos(h) * step);
      if (d < hd) {
        hd = d;
        heading = h;
      }
    }
    return { x: bx, z: bz, heading };
  }

  /** The ground's height (m). (render.ts `groundH` is the same.) */
  groundH(x: number, z: number): number {
    const [a, k, , b] = this.relief;
    const s = this.seed;
    return a * ((vnoise(x * k + 71.3, z * k + 71.3, s) - 0.5) * 1.6 + (vnoise(x * k * 2.7 + 5.9, z * k * 2.7 + 5.9, s) - 0.5) * 0.4) + b * (vnoise(x / 22 + 33.3, z / 22 + 33.3, s) - 0.5) * 2;
  }

  /** What the place at (x, z) is like. (render.ts has the same wet and open.) */
  place(x: number, z: number): Place {
    const h = this.groundH(x, z);
    const [a, , wl] = this.relief;
    const wet = 1 - smooth01(wl, wl + a * 0.8, h);
    const open = smooth01(0.55, 0.75, vnoise(x / 110 + 211.1, z / 110 + 211.1, this.seed) + this.openness);
    const disturb = smooth01(0.62, 0.8, vnoise(x / 65 + 151.7, z / 65 + 151.7, this.seed));
    return { h, wet, open, disturb, water: Math.max(0, wl - h) };
  }

  /** The mist's density (per metre) at (x, y, z) at time t: drifting banks, and mist lying in the hollows. (render.ts mistDensity is the same.) */
  mistDensity(x: number, y: number, z: number, t: number): number {
    const s = this.seed;
    const gh = this.groundH(x, z);
    const qx = x * 0.05 + z * 0.021 + t * 0.014;
    const qz = z * 0.05 - x * 0.017 + t * 0.004;
    const n = vnoise(qx, qz, s) * 0.65 + vnoise(qx * 2.7 + 5, qz * 2.7 + 5, s) * 0.35;
    const above = Math.max(y - gh, 0);
    const banks = smooth01(0.45, 0.8, n) * Math.exp(-above * 0.08);
    const [a, , wl] = this.relief;
    const wet = 1 - smooth01(wl, wl + a * 0.8, gh);
    const lying = wet > 0.01 ? smooth01(0.2, 1, wet) * Math.exp(-above * 1.1) * (0.4 + 0.6 * vnoise(x * 0.07 + t * 0.006, z * 0.07, s)) : 0;
    const low = smooth01(0.5, 0.78, vnoise(x * 0.09 + t * 0.01 + 31, z * 0.09 - t * 0.004 + 31, s)) * Math.exp(-above * 0.55);
    return banks * 0.05 + lying * 0.12 + low * 0.07;
  }

  /** The mist along the way from (ex, ey, ez) to (x, y, z): its optical depth (a few steps of it). */
  mistAlong(ex: number, ey: number, ez: number, x: number, y: number, z: number, t: number, steps = 6): number {
    const len = Math.hypot(x - ex, y - ey, z - ez);
    let tau = 0;
    for (let i = 0; i < steps; i++) {
      const f = (i + 0.5) / steps;
      tau += this.mistDensity(ex + (x - ex) * f, ey + (y - ey) * f, ez + (z - ez) * f, t);
    }
    return (tau * len) / steps;
  }

  /** Fog density here: thick in the hollows, thinner on the rises — a property of the place, the same each time you come by. */
  densityAt(x: number, z: number): number {
    const n = vnoise(x / 70, z / 70, hash(this.seed, 5)) * 0.7 + vnoise(x / 23 + 11.3, z / 23 + 4.1, hash(this.seed, 6)) * 0.3;
    return this.density * (0.7 + 0.4 * n) * (1 + 0.1 * this.place(x, z).wet);
  }

  genomeOf(kind: Kind): Genome | null {
    return this.species.find((sp) => sp.id === kind)?.genome ?? null;
  }

  /** A pooled structure, grown the first time it is wanted. */
  structure(kind: Kind, i: number): Structure {
    const key = `${kind}:${i}`;
    let s = this.pool.get(key);
    if (!s) {
      const sub = hash(this.seed, 31, i, kind.charCodeAt(0) * 31 + (kind.charCodeAt(1) || 0));
      s =
        kind === 'patch' || kind === 'rush'
          ? growPatch(sub, 2.5 + (i % 3) * 0.8, kind === 'rush')
          : kind === 'log'
            ? growLog(sub)
            : kind === 'scrub'
              ? growScrub(sub, 2.2 + (i % 3) * 0.7)
            : grow(sub, this.genomeOf(kind)!);
      this.pool.set(key, s);
    }
    return s;
  }
  grown(kind: Kind, i: number) {
    return this.pool.has(`${kind}:${i}`);
  }

  /** What stands in one cell of the grid, placed the same every time. */
  cell(i: number, j: number): Placed[] {
    const key = i * 100003 + j;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const r = seeded(hash(this.seed, 7, i, j));
    const x0 = i * CELL;
    const z0 = j * CELL;
    const out: Placed[] = [];
    const centre = this.pathDist(x0 + CELL / 2, z0 + CELL / 2);
    // the old trees near here, and the clearing each keeps about it
    const vets = this.veterans(x0 - 8, z0 - 8, x0 + CELL + 8, z0 + CELL + 8);
    for (const v of vets) if (v.x >= x0 && v.x < x0 + CELL && v.z >= z0 && v.z < z0 + CELL) out.push(v);
    const stone = this.structuresNear(x0 + CELL / 2, z0 + CELL / 2, CELL);
    const cellWalls = this.wallsNear(x0 + CELL / 2, z0 + CELL / 2, CELL);
    const hasStone = stone.length > 0 || cellWalls.length > 0;
    const crowded = (x: number, z: number) => vets.some((v) => Math.hypot(v.x - x, v.z - z) < 5.5) || (hasStone && this.stoneDist(x, z, stone, cellWalls) < 2.5);
    /** Place up to `count` of a kind, each kept where `fits` (the same draws from `r` whatever is kept). */
    const place = (kind: Kind, count: number, clear: number, pool: number, fits: (f: Place, x: number, z: number) => number, grass = false) => {
      const whole = Math.floor(count) + (r() < count % 1 ? 1 : 0);
      for (let k = 0; k < whole; k++) {
        const x = x0 + r() * CELL;
        const z = z0 + r() * CELL;
        const pr = r();
        const scale = lerp(0.8, 1.2, r());
        const rot = r() * 6.283;
        const flip = r() < 0.5;
        const phase = r() * 6.28;
        const keep = r();
        const edge = r();
        // keep off the paths (the grass thins on them; trees stand back)
        const pd = clear > 0 || grass ? this.pathDist(x, z) : 99;
        if (pd < clear || (grass && pd < this.path[2] * 0.8 + edge * 0.7)) continue;
        if (hasStone && this.stoneDist(x, z, stone, cellWalls) < (grass ? 0.15 : 1.5)) continue;
        if (keep >= fits(this.place(x, z), x, z)) continue;
        out.push({ x, z, kind, pool: Math.floor(pr * pool), scale, rot, flip, phase });
      }
    };
    for (const sp of this.species) {
      if (this.only && sp.genome.archetype !== this.only) continue;
      const aff = AFFINITY[sp.genome.archetype];
      const count = (sp.per + sp.nearPath * Math.max(0, 1 - centre / 12)) * (this.only ? 3 : 1) * CAP;
      place(sp.id, count, sp.clear, sp.pool, (f, x, z) => (f.water > 0 || crowded(x, z) ? 0 : (this.only ? 1 : aff(f)) / CAP));
    }
    // a fallen tree, now and then, many where the wind has been through
    const fd = this.place(x0 + CELL / 2, z0 + CELL / 2).disturb;
    place('log', 0.06 + 0.7 * fd, 2.2, 4, (f) => (f.water > 0 ? 0 : 1));
    // grass, thick in the glades, thin under the trees (leaf litter there); rushes in the wet,
    // standing out into the shallows
    place('patch', 48, 0, 12, (f) => (f.water > 0 || f.wet > 0.55 ? 0 : (0.62 + 0.38 * f.open) * (1 - 0.5 * f.wet)), true);
    // scrub: the waist-high mass of the open wood — tussocks, bramble, heather, seedlings — thick
    // in the glades and the gaps, thinner under the canopy, none in the wet
    place('scrub', 40, 0, 10, (f) => (f.water > 0 || f.wet > 0.6 ? 0 : (0.3 + 0.7 * Math.max(f.open, f.disturb)) * (1 - 0.6 * f.wet)), true);
    place('rush', 12, 0, 6, (f) => (f.water > 0.3 ? 0 : smooth01(0.4, 0.8, f.wet)), true);
    this.cache.set(key, out);
    if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value!);
    return out;
  }

  private built = new Map<string, Structure3 | null>();
  private walls = new Map<string, WallStretch[]>();

  /** The stretches of dry-stone wall within `radius` of (x, z). */
  wallsNear(x: number, z: number, radius: number): WallStretch[] {
    const out: WallStretch[] = [];
    if (this.only) return out;
    for (let I = Math.floor((x - radius - 180) / WALL_GRID); I <= Math.floor((x + radius + 180) / WALL_GRID); I++)
      for (let J = Math.floor((z - radius - 180) / WALL_GRID); J <= Math.floor((z + radius + 180) / WALL_GRID); J++) {
        const key = `${I},${J}`;
        let ws = this.walls.get(key);
        if (!ws) {
          ws = this.wall(I, J);
          this.walls.set(key, ws);
        }
        for (const w of ws) {
          // (distance to the stretch)
          const dx = w.x1 - w.x0;
          const dz = w.z1 - w.z0;
          const L2 = dx * dx + dz * dz || 1;
          const f = Math.max(0, Math.min(1, ((x - w.x0) * dx + (z - w.z0) * dz) / L2));
          if (Math.hypot(x - w.x0 - dx * f, z - w.z0 - dz * f) < radius) out.push(w);
        }
      }
    return out;
  }

  /**
   * One wall to some squares: an old field boundary, 80–170 m, wandering a little in 10 m
   * stretches; a gap where a path crosses it (its ends tapering down), here and there a stretch
   * fallen low enough to step over; it stops at water.
   */
  private wall(I: number, J: number): WallStretch[] {
    const r = seeded(hash(this.seed, 97, I, J));
    if (r() > 0.5) return [];
    const out: WallStretch[] = [];
    let x = (I + r()) * WALL_GRID;
    let z = (J + r()) * WALL_GRID;
    let a = r() * 6.283;
    const H = 1.05 + r() * 0.45;
    const steps = 8 + Math.floor(r() * 9);
    let gapBefore = true;
    for (let k = 0; k < steps; k++) {
      a += (r() - 0.5) * 0.35;
      const nx = x + Math.sin(a) * 10;
      const nz = z + Math.cos(a) * 10;
      if (this.place(nx, nz).water > 0 || this.place(x, z).water > 0) break;
      const fallen = r() < 0.1;
      const seed = Math.floor(r() * 999);
      // where a path crosses this stretch: leave a gap there (3 m), the wall tapering into it
      let cut = -1;
      for (let s = 0; s <= 10; s += 0.5) {
        const px = x + Math.sin(a) * s;
        const pz = z + Math.cos(a) * s;
        if (this.pathDist(px, pz) < this.path[2] + 0.4) {
          cut = s;
          break;
        }
      }
      const piece = (s0: number, s1: number, capStart: boolean, capEnd: boolean) => {
        if (s1 - s0 < 0.6) return;
        const ax = x + Math.sin(a) * s0;
        const az = z + Math.cos(a) * s0;
        const bx = x + Math.sin(a) * s1;
        const bz = z + Math.cos(a) * s1;
        out.push({ x0: ax, z0: az, x1: bx, z1: bz, y0: this.groundH(ax, az), y1: this.groundH(bx, bz), h: fallen ? 0.45 : H, caps: (capStart ? 1 : 0) + (capEnd ? 2 : 0), seed });
      };
      if (cut < 0) {
        piece(0, 10, gapBefore, false);
        gapBefore = false;
      } else {
        piece(0, cut - 1.6, gapBefore, true);
        // past the path (it may cross again further on: then the rest of this stretch is left out)
        let back = 10;
        for (let s = cut; s <= 10; s += 0.5) {
          if (this.pathDist(x + Math.sin(a) * s, z + Math.cos(a) * s) >= this.path[2] + 0.4) {
            back = s;
            break;
          }
        }
        piece(back + 1.6, 10, true, false);
        gapBefore = back + 1.6 >= 10;
      }
      x = nx;
      z = nz;
    }
    // (the last stretch's end tapers)
    if (out.length) out[out.length - 1].caps |= 2;
    return out;
  }

  /** The stone structures within `radius` of (x, z). */
  structuresNear(x: number, z: number, radius: number): Structure3[] {
    const out: Structure3[] = [];
    const take = (grid: number, kind: 'tower' | 'viaduct') => {
      for (let I = Math.floor((x - radius - 200) / grid); I <= Math.floor((x + radius + 200) / grid); I++)
        for (let J = Math.floor((z - radius - 200) / grid); J <= Math.floor((z + radius + 200) / grid); J++) {
          const key = `${kind}:${I},${J}`;
          let s = this.built.get(key);
          if (s === undefined) {
            s = kind === 'tower' ? this.tower(I, J) : this.viaduct(I, J);
            this.built.set(key, s);
          }
          if (!s) continue;
          const reach = s.kind === 'viaduct' ? (s.c * s.b) / 2 + 5 : s.b + 2;
          if (Math.hypot(s.x - x, s.z - z) < radius + reach) out.push(s);
        }
    };
    if (!this.only) {
      take(TOWER_GRID, 'tower');
      take(VIADUCT_GRID, 'viaduct');
    }
    return out;
  }

  private tower(I: number, J: number): Structure3 | null {
    const r = seeded(hash(this.seed, 91, I, J));
    if (r() > 0.32) return null;
    // somewhere open and dry, off the paths
    let best: [number, number] | null = null;
    let bs = -Infinity;
    for (let k = 0; k < 10; k++) {
      const x = (I + 0.15 + 0.7 * r()) * TOWER_GRID;
      const z = (J + 0.15 + 0.7 * r()) * TOWER_GRID;
      const f = this.place(x, z);
      const pd = this.pathDist(x, z);
      const score = f.open * 0.5 + (1 - f.wet) - (pd < 9 ? 5 : 0) - (f.water > 0 ? 9 : 0) + r() * 0.3;
      if (score > bs) {
        bs = score;
        best = [x, z];
      }
    }
    if (!best || bs < 0) return null;
    const [x, z] = best;
    return { kind: 'tower', x, z, rot: r() * 6.283, base: this.groundH(x, z) - 0.3, a: 9 + r() * 7, b: 3.1 + r() * 1.4, c: r() * 100 };
  }

  private viaduct(I: number, J: number): Structure3 | null {
    const r = seeded(hash(this.seed, 93, I, J));
    if (r() > 0.3) return null;
    // across a path: its middle over the path, the path running under the middle of a span
    const at = this.findPath((I + 0.3 + 0.4 * r()) * VIADUCT_GRID, (J + 0.3 + 0.4 * r()) * VIADUCT_GRID);
    if (this.place(at.x, at.z).water > 0) return null;
    const span = 14 + r() * 5;
    const piers = 2 * (4 + Math.floor(r() * 3));
    // its axis across the path's way (local x along the axis)
    const rot = -at.heading;
    return { kind: 'viaduct', x: at.x, z: at.z, rot, base: this.groundH(at.x, at.z), a: 20 + r() * 9, b: span, c: piers };
  }

  /** How far (m) from (x, z) to the nearest stone you cannot walk through (negative inside), at walking height. */
  stoneDist(x: number, z: number, near?: Structure3[], walls?: WallStretch[]): number {
    let best = 1e3;
    for (const w of walls ?? this.wallsNear(x, z, 12)) {
      // a fallen stretch you step over
      if (w.h < 0.7) continue;
      const dx = w.x1 - w.x0;
      const dz = w.z1 - w.z0;
      const L2 = dx * dx + dz * dz || 1;
      const f = Math.max(0, Math.min(1, ((x - w.x0) * dx + (z - w.z0) * dz) / L2));
      let d = Math.hypot(x - w.x0 - dx * f, z - w.z0 - dz * f) - 0.4;
      // (the tapered ends: low enough to pass at the very end)
      const along = f * Math.sqrt(L2);
      if (((w.caps & 1) && along < 0.6) || ((w.caps & 2) && Math.sqrt(L2) - along < 0.6)) d = Math.max(d, 0.5);
      best = Math.min(best, d);
    }
    for (const s of near ?? this.structuresNear(x, z, 30)) {
      const dx = x - s.x;
      const dz = z - s.z;
      const c = Math.cos(s.rot);
      const sn = Math.sin(s.rot);
      const lx = c * dx + sn * dz;
      const lz = -sn * dx + c * dz;
      if (s.kind === 'tower') {
        const R = s.b * 1.05;
        let d = Math.abs(Math.hypot(lx, lz) - R) - 0.5;
        // (the doorway, along local x: a way in)
        if (lx > 0 && Math.abs(lz) < 0.55) d = Math.max(d, 0.6);
        best = Math.min(best, d);
      } else {
        // the piers: between the arches, a pier every span
        const S = s.b;
        const N = s.c;
        const k = Math.max(0, Math.min(N - 1, Math.round(lx / S + (N - 1) / 2)));
        const px = lx - (k - (N - 1) / 2) * S;
        const hx = 1.25;
        const hz = 2.75;
        const qx = Math.abs(px) - hx;
        const qz = Math.abs(lz) - hz;
        best = Math.min(best, Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0));
      }
    }
    return best;
  }

  /** The veteran trees whose squares overlap the box (x0, z0)–(x1, z1): old, huge, few. */
  veterans(x0: number, z0: number, x1: number, z1: number): Placed[] {
    const out: Placed[] = [];
    const big = this.species.filter((sp) => (sp.genome.archetype === 'tall' || sp.genome.archetype === 'leaner') && (!this.only || sp.genome.archetype === this.only));
    if (!big.length) return out;
    for (let I = Math.floor(x0 / VET); I <= Math.floor(x1 / VET); I++)
      for (let J = Math.floor(z0 / VET); J <= Math.floor(z1 / VET); J++) {
        const r = seeded(hash(this.seed, 13, I, J));
        if (r() > 0.5) continue;
        const x = I * VET + 12 + r() * (VET - 24);
        const z = J * VET + 12 + r() * (VET - 24);
        const sp = big[Math.floor(r() * big.length)];
        const v: Placed = { x, z, kind: sp.id, pool: 50 + Math.floor(r() * 6), scale: 1.65 + r() * 0.35, rot: r() * 6.283, flip: false, phase: r() * 6.28 };
        if (x < x0 || x >= x1 || z < z0 || z >= z1) continue;
        if (this.pathDist(x, z) < 4.5 || this.place(x, z).water > 0) continue;
        out.push(v);
      }
    return out;
  }

  /** Everything within `radius` of (x, z). */
  around(x: number, z: number, radius: number): Placed[] {
    const out: Placed[] = [];
    for (let i = Math.floor((x - radius) / CELL); i <= Math.floor((x + radius) / CELL); i++)
      for (let j = Math.floor((z - radius) / CELL); j <= Math.floor((z + radius) / CELL); j++) for (const p of this.cell(i, j)) out.push(p);
    return out;
  }
}

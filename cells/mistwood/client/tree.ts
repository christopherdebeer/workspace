/**
 * Trees as silhouettes: grown, not drawn. A tree is a set of line segments in
 * its own plane (metres, base at the origin, y up), each with a width at either
 * end — from a trunk a hand across down to twigs of three millimetres — which
 * the GPU rasterises once into a card (bake.ts). In mist only the outline
 * reads, so all the effort goes there: kinked twigs, sympodial zig-zags,
 * branches that lean to the light, birch twigs that hang, a beech that keeps
 * last year's leaves.
 *
 * Species (from the photograph): a small leaning tree with a wide, flat crown
 * (the hero); tall trunks fading into the fog; birch (a white trunk); beech
 * saplings with russet leaves; low twiggy shrubs and bramble.
 */
import { hash, seeded, type Rand } from './rng';

export type Species = 'leaner' | 'tall' | 'birch' | 'sapling' | 'shrub';

/** Per segment: x0, y0, z0, x1, y1, z1 (m, tree-local, y up), w0, w1, tone (0 dark bark … 1 birch white), leaf (0/1). */
export const SEG = 10;

export interface Structure {
  /** Segments, thickest first (so the first N are the tree as far as it can be seen at a distance). */
  segs: Float32Array;
  count: number;
  /** each segment's greater width, in the same (descending) order */
  widths: Float32Array;
  /** how far the wood reaches from the trunk's axis (m), and how high */
  radius: number;
  maxY: number;
  species: Species;
}

/** How many of a structure's segments are at least `w` metres wide (they are sorted, thickest first). */
export function countWider(s: Structure, w: number): number {
  let lo = 0;
  let hi = s.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.widths[mid] >= w) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Sort segments thickest first, and note the reach. */
function finish(raw: Float32Array, n: number, species: Species): Structure {
  const order = Array.from({ length: n }, (_, i) => i);
  const wOf = (i: number) => Math.max(raw[i * SEG + 6], raw[i * SEG + 7]);
  order.sort((a, b) => wOf(b) - wOf(a));
  const segs = new Float32Array(n * SEG);
  const widths = new Float32Array(n);
  let radius = 0.1;
  let maxY = 0.1;
  order.forEach((src, k) => {
    segs.set(raw.subarray(src * SEG, src * SEG + SEG), k * SEG);
    widths[k] = wOf(src);
    const o = k * SEG;
    radius = Math.max(radius, Math.hypot(segs[o + 3], segs[o + 5]) + segs[o + 7], Math.hypot(segs[o], segs[o + 2]) + segs[o + 6]);
    maxY = Math.max(maxY, segs[o + 4] + segs[o + 7], segs[o + 1] + segs[o + 6]);
  });
  return { segs, count: n, widths, radius, maxY, species };
}

type V3 = [number, number, number];
const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** Turn `d` away from itself by `angle`, towards azimuth `phi` around it. */
function turn(d: V3, angle: number, phi: number): V3 {
  // a basis perpendicular to d
  const ref: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm([d[1] * ref[2] - d[2] * ref[1], d[2] * ref[0] - d[0] * ref[2], d[0] * ref[1] - d[1] * ref[0]]);
  const v: V3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  return norm([d[0] * c + (u[0] * cp + v[0] * sp) * sn, d[1] * c + (u[1] * cp + v[1] * sp) * sn, d[2] * c + (u[2] * cp + v[2] * sp) * sn]);
}

export interface Params {
  /** trunk: length (m), base width (m), angle from vertical (rad) */
  trunk: [number, number];
  width: [number, number];
  lean: number;
  /** below this fraction of the trunk, no branches */
  clear: number;
  /** branch angle off the parent (rad) */
  spread: number;
  /** random turn per segment (rad), grows towards the twigs */
  kink: number;
  /** turn towards vertical per metre (the light), and droop per metre for thin, long twigs */
  up: number;
  droop: number;
  /** chance of a side branch per segment, by order */
  lateral: number[];
  /** child length as a share of what remains of the parent */
  lenDecay: number;
  /** child width as a share of the parent's there */
  wDecay: number;
  maxOrder: number;
  /** the finest twig (m) */
  minW: number;
  /** segment length (m) for the trunk; finer for twigs */
  seg: number;
  /** fork into two at a branch end */
  fork: number;
  /** white bark on everything thicker than this (m); 0 none */
  white: number;
  /** leaves at twig ends (chance) */
  leaves: number;
  /** stems from the base (shrubs) */
  stems: [number, number];
  /** chance of a twiglet per segment of thin wood */
  twigs: number;
}

const P: Record<Species, Params> = {
  leaner: {
    trunk: [2.2, 3.4], width: [0.09, 0.14], lean: 0.32, clear: 0.4, spread: 0.7, kink: 0.34, up: 0.06, droop: 0.02,
    lateral: [0.22, 0.45, 0.55, 0.6, 0.6, 0.55, 0.5, 0.4], lenDecay: 0.78, wDecay: 0.62, maxOrder: 7, minW: 0.003, seg: 0.28, fork: 0.75, white: 0, leaves: 0, stems: [1, 1], twigs: 0.8,
  },
  tall: {
    trunk: [11, 19], width: [0.22, 0.38], lean: 0.07, clear: 0.45, spread: 0.55, kink: 0.18, up: 0.14, droop: 0.02,
    lateral: [0.2, 0.35, 0.45, 0.5, 0.5, 0.45, 0.4], lenDecay: 0.6, wDecay: 0.5, maxOrder: 6, minW: 0.004, seg: 0.6, fork: 0.5, white: 0, leaves: 0, stems: [1, 1], twigs: 0.7,
  },
  birch: {
    trunk: [10, 17], width: [0.16, 0.26], lean: 0.06, clear: 0.4, spread: 0.6, kink: 0.14, up: 0.05, droop: 0.22,
    lateral: [0.22, 0.4, 0.5, 0.55, 0.55, 0.5, 0.4], lenDecay: 0.62, wDecay: 0.5, maxOrder: 6, minW: 0.003, seg: 0.5, fork: 0.35, white: 0.05, leaves: 0, stems: [1, 1], twigs: 0.75,
  },
  sapling: {
    trunk: [2, 4], width: [0.04, 0.07], lean: 0.12, clear: 0.15, spread: 0.7, kink: 0.25, up: 0.18, droop: 0.04,
    lateral: [0.35, 0.45, 0.5, 0.5, 0.45], lenDecay: 0.62, wDecay: 0.6, maxOrder: 5, minW: 0.003, seg: 0.18, fork: 0.5, white: 0, leaves: 0.75, stems: [1, 1], twigs: 0.6,
  },
  shrub: {
    trunk: [0.6, 1.8], width: [0.015, 0.03], lean: 0.6, clear: 0.05, spread: 0.6, kink: 0.4, up: 0.06, droop: 0.12,
    lateral: [0.4, 0.45, 0.45, 0.4], lenDecay: 0.6, wDecay: 0.6, maxOrder: 4, minW: 0.0025, seg: 0.1, fork: 0.4, white: 0, leaves: 0.05, stems: [4, 9], twigs: 0.5,
  },
};

/**
 * A species is a point in the space of these parameters, with a bark colour: an archetype
 * (the five above) shifted along every axis — taller or squatter, steeper or flatter branching,
 * straighter or more kinked, weeping or reaching, sparse or dense in twig, some holding their
 * dead leaves, a few pale-barked, now and then a coppiced one of several stems. Each wood
 * draws its own set, so no two woods have the same trees.
 */
export interface Genome extends Params {
  archetype: Species;
  /** bark colour (dark wood; birch white is separate) */
  bark: [number, number, number];
  /** bark up close: how deeply fissured (0 smooth … 1 deep plates), the scale of its pattern,
   * how much lichen and moss it carries */
  barkRough: number;
  barkScale: number;
  lichen: number;
  moss: number;
  /** roots: how widely and shallowly they run (shallow ones show further from the trunk) */
  rootSpread: number;
}

export function sampleGenome(r: Rand, archetype: Species, wild = 1): Genome {
  const b = P[archetype];
  const j = (lo: number, hi: number) => 1 + ((lo - 1) + ((hi - 1) - (lo - 1)) * r()) * wild;
  const c01 = (x: number) => Math.max(0, Math.min(1, x));
  const g: Genome = {
    ...b,
    archetype,
    trunk: [b.trunk[0] * j(0.75, 1.3), b.trunk[1] * j(0.75, 1.3)],
    width: [b.width[0] * j(0.8, 1.25), b.width[1] * j(0.8, 1.25)],
    lean: b.lean * j(0.4, 1.8),
    clear: c01(b.clear + (r() - 0.5) * 0.3 * wild),
    spread: b.spread * j(0.7, 1.35),
    kink: b.kink * j(0.5, 1.7),
    up: b.up * j(0.4, 1.8),
    droop: b.droop * j(0.3, 2.6),
    lateral: b.lateral.map((x) => Math.min(0.85, x * j(0.75, 1.25))),
    lenDecay: Math.max(0.4, Math.min(0.9, b.lenDecay + (r() - 0.5) * 0.2 * wild)),
    wDecay: Math.max(0.4, Math.min(0.75, b.wDecay + (r() - 0.5) * 0.12 * wild)),
    maxOrder: Math.max(3, Math.min(8, b.maxOrder + (r() < 0.25 ? -1 : r() > 0.8 ? 1 : 0))),
    fork: Math.min(1, b.fork * j(0.7, 1.3)),
    twigs: Math.min(0.95, b.twigs * j(0.6, 1.2)),
    leaves: b.leaves || (r() < 0.15 ? 0.2 + r() * 0.4 : 0),
    white: b.white || (r() < 0.06 ? 0.06 : 0),
    stems: archetype === 'tall' && r() < 0.12 ? [2, 4] : b.stems,
    bark: [0, 0, 0],
    barkRough: 0,
    barkScale: 1,
    lichen: 0,
    moss: 0,
    rootSpread: 1,
  };
  // bark: dark, a little greener (moss) or warmer (brown), lighter or darker; beech-like
  // saplings smooth and grey, the big trees deeply fissured
  const light = 0.8 + r() * 0.6;
  const hue = r();
  const smooth = archetype === 'sapling' || (archetype === 'leaner' && r() < 0.3);
  const base: [number, number, number] = smooth ? [0.2, 0.2, 0.185] : hue < 0.4 ? [0.13, 0.14, 0.11] : hue < 0.75 ? [0.15, 0.135, 0.115] : [0.17, 0.13, 0.1];
  g.bark = [base[0] * light, base[1] * light, base[2] * light];
  const range = (lo: number, hi: number) => lo + (hi - lo) * r();
  g.barkRough = smooth ? range(0, 0.15) : archetype === 'tall' ? range(0.55, 1) : archetype === 'shrub' ? range(0.1, 0.35) : range(0.3, 0.75);
  g.barkScale = range(0.6, 1.6);
  g.lichen = range(0.15, archetype === 'birch' ? 0.5 : 0.85);
  g.moss = range(0.1, archetype === 'shrub' ? 0.3 : 0.9);
  g.rootSpread = range(0.6, archetype === 'birch' || smooth ? 1.7 : 1.2);
  return g;
}

/** No tree grows past this many segments (a phone must be able to bake it). */
const CAP = 60000;

export function grow(seed: number, genome: Genome): Structure {
  const p = genome;
  const species = genome.archetype;
  const r: Rand = seeded(hash(seed, 0x7ee));
  let segs = new Float32Array(SEG * 4096);
  let n = 0;
  const push = (a: V3, b: V3, w0: number, w1: number, tone: number, leaf: number) => {
    if (n >= CAP) return;
    if ((n + 1) * SEG > segs.length) {
      const next = new Float32Array(segs.length * 2);
      next.set(segs);
      segs = next;
    }
    segs.set([a[0], a[1], a[2], b[0], b[1], b[2], w0, w1, tone, leaf], n * SEG);
    n++;
  };
  // Folded dry leaves: narrow attachment, broad shoulder, curled tapered tip.
  // Separate stream preserves the seeded tree architecture when detail changes.
  const detail = seeded(hash(seed, 0x1eaf));
  const dryLeaf = (at: V3, length = 0.055) => {
    const az = detail() * 6.283;
    const span = length * (0.22 + detail() * 0.48);
    const tilt = 0.3 + detail() * 0.7;
    const a: V3 = [Math.cos(az) * tilt, -0.65, Math.sin(az) * tilt];
    const mid: V3 = [at[0] + a[0] * length * .48, at[1] + a[1] * length * .48, at[2] + a[2] * length * .48];
    const tip: V3 = [at[0] + a[0] * length + Math.sin(az) * length * .2, at[1] - length * .62, at[2] + a[2] * length - Math.cos(az) * length * .2];
    push(at, mid, .002, span, 0, 1);
    push(mid, tip, span, .001, 0, 1);
  };
  const GOLDEN = 2.39996;
  let spiral = r() * 6.28;

  /** One branch in 3D: a kinked polyline that tapers, with side branches spiralling round it and a fork at its end. */
  const branch = (at: V3, dir: V3, len: number, w0: number, order: number, clear: number) => {
    const wEnd = Math.max(p.minW, w0 * (order === 0 ? 0.5 : 0.36));
    const segLen = Math.max(0.02, p.seg * Math.pow(0.62, order));
    const steps = Math.max(2, Math.ceil(len / segLen));
    const step = len / steps;
    const white = p.white > 0;
    let pos = at;
    let d = dir;
    // a trunk's foot: its first 90 cm in short steps, flaring out towards the ground and easing
    // into the trunk (part of the trunk, so its bark runs on without a seam)
    if (order === 0 && len > 1.5 && w0 > 0.03) {
      const fw = (hh: number) => w0 * (1 + 0.75 * Math.exp(-hh * 4.5));
      for (let k = 0; k < 6; k++) {
        const next: V3 = [pos[0] + d[0] * 0.15, pos[1] + d[1] * 0.15, pos[2] + d[2] * 0.15];
        push(pos, next, fw(k * 0.15), fw((k + 1) * 0.15), white && w0 > p.white ? 1 : 0, 0);
        pos = next;
      }
      len -= 0.9;
    }
    for (let i = 0; i < steps; i++) {
      const f0 = i / steps;
      const f1 = (i + 1) / steps;
      const wa = w0 + (wEnd - w0) * f0;
      const wb = w0 + (wEnd - w0) * f1;
      // the kink grows towards the twigs; thick wood bends to the light, thin long twigs hang
      d = turn(d, (r() - 0.5) * p.kink * (0.5 + order * 0.35) * 1.2, r() * 6.28);
      const up = p.up * step * (wa > 0.02 ? 1 : 0.4);
      d = norm([d[0] * (1 - up), d[1] * (1 - up) + up, d[2] * (1 - up)]);
      if (wa < 0.015) {
        const dr = p.droop * step * (0.5 + order * 0.3);
        d = norm([d[0], d[1] - dr, d[2]]);
      }
      const next: V3 = [pos[0] + d[0] * step, Math.max(0, pos[1] + d[1] * step), pos[2] + d[2] * step];
      push(pos, next, wa, wb, white && wa > p.white ? 1 : 0, 0);
      // side branches (none low on the trunk), spiralling round it
      if (order < p.maxOrder && wb > p.minW * 1.6 && f1 > clear && r() < (p.lateral[order] ?? 0.3)) {
        spiral += GOLDEN;
        const remain = len * (1 - f1);
        const cl = (remain * 0.7 + len * 0.3) * p.lenDecay * (0.55 + r() * 0.6);
        branch(next, turn(d, p.spread * (0.55 + r() * 0.7), spiral), cl, Math.max(p.minW, wb * p.wDecay * (0.7 + r() * 0.5)), order + 1, 0);
      }
      // the fine stuff: short kinked twiglets all along the thin wood (most of what the mist shows)
      if (order >= 2 && wa < 0.025 && r() < p.twigs) {
        let tp = next;
        let td = turn(d, 0.45 + r() * 0.6, r() * 6.28);
        const tl = 0.04 + r() * 0.2;
        const tw = Math.max(p.minW, Math.min(wb * 0.7, p.minW * 1.6));
        for (let k = 0; k < 3; k++) {
          td = norm([td[0] + (r() - 0.5) * 0.5, td[1] + (r() - 0.5) * 0.5 + 0.12, td[2] + (r() - 0.5) * 0.5]);
          const e: V3 = [tp[0] + (td[0] * tl) / 3, tp[1] + (td[1] * tl) / 3, tp[2] + (td[2] * tl) / 3];
          push(tp, e, tw, Math.max(p.minW * 0.7, tw * 0.8), 0, 0);
          tp = e;
        }
        if (p.leaves && r() < p.leaves * 0.5) { r(); r(); dryLeaf(tp); }
      }
      pos = next;
    }
    // the end: a fork (the leader goes on one way, the other shoot another), or a twig tip
    if (order < p.maxOrder && wEnd > p.minW * 1.3 && (order < 3 || r() < p.fork)) {
      const kids = order === 0 ? 2 + Math.floor(r() * 3) : r() < 0.3 ? 3 : 2;
      const phi0 = r() * 6.28;
      for (let k = 0; k < kids; k++) {
        const cd = turn(d, p.spread * 0.5 * (0.8 + r() * 0.6), phi0 + (k / kids) * 6.28 + (r() - 0.5) * 0.6);
        branch(pos, cd, len * p.lenDecay * (0.7 + r() * 0.4), Math.max(p.minW, wEnd * 0.8), order + 1, 0);
      }
    } else if (p.leaves && r() < p.leaves) {
      // a few dry leaves on the last twig, hanging
      const count = 1 + Math.floor(r() * 3);
      for (let k = 0; k < count; k++) {
        const ll = 0.035 + r() * 0.04;
        const ld = norm([(r() - 0.5) * 1.2, -1, (r() - 0.5) * 1.2]);
        r(); void ld; dryLeaf(pos, ll * 1.3);
      }
    }
  };

  const stems = p.stems[0] + Math.floor(r() * (p.stems[1] - p.stems[0] + 1));
  for (let s = 0; s < stems; s++) {
    const len = p.trunk[0] + r() * (p.trunk[1] - p.trunk[0]);
    const w = p.width[0] + r() * (p.width[1] - p.width[0]);
    // lean: any way round (shrubs splay their stems outwards)
    const lean = (stems > 1 ? 0.3 + r() * 0.7 : r()) * p.lean * (stems > 1 ? 2.2 : 2);
    const az = stems > 1 ? (s / stems) * 6.28 + r() : r() * 6.28;
    const base: V3 = stems > 1 ? [(r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3] : [0, 0, 0];
    // the roots — the tree inverted: the same growth, spiralling round, kinking, tapering, but
    // pulled down instead of up. Only what is above the ground is drawn (each root's ridge as it
    // leaves the trunk and dives into the soil); the rest is underground. Generated first, from
    // their own random stream, so the crown is unchanged.
    if (w > 0.03) {
      const count = 5 + Math.floor(detail() * 4);
      for (let k = 0; k < count; k++) {
        const ra = az + k * GOLDEN + detail() * 0.4;
        let dir: V3 = norm([Math.cos(ra), -0.1 - detail() * 0.22, Math.sin(ra)]);
        let pos: V3 = [base[0] + Math.cos(ra) * w * 0.3, w * 0.5, base[2] + Math.sin(ra) * w * 0.3];
        let rw = w * (0.45 + detail() * 0.3);
        for (let i = 0; i < 30; i++) {
          const step = Math.max(0.025, rw * 0.8);
          // meandering, and pulled down (the inverse of reaching for the light); shallow-rooted
          // trees' roots run further before they dive
          dir = turn(dir, (detail() - 0.5) * 0.55, detail() * 6.28);
          dir = norm([dir[0], dir[1] - (0.3 * step) / genome.rootSpread, dir[2]]);
          const next: V3 = [pos[0] + dir[0] * step, pos[1] + dir[1] * step, pos[2] + dir[2] * step];
          const nw = rw * 0.86;
          // what shows is the ridge above the ground: its top, resting on the ground
          const top0 = pos[1] + rw / 2;
          const top1 = next[1] + nw / 2;
          if (top1 <= 0.002) break;
          push([pos[0], top0 / 2, pos[2]], [next[0], top1 / 2, next[2]], Math.min(rw, top0), Math.min(nw, top1), 0, 0);
          pos = next;
          rw = nw;
        }
      }
    }
    branch(base, norm([Math.sin(lean) * Math.cos(az), Math.cos(lean), Math.sin(lean) * Math.sin(az)]), len, w, 0, p.clear);
  }
  return finish(segs, n, species);
}

/**
 * A patch of ground cover (a card lying across the ground, seen edge on): dry
 * grass blades with seed heads, bramble arching over, dead bracken. Width (m)
 * across, a little under a metre tall. Same segment format; tone is the straw's
 * lightness.
 */
export function growPatch(seed: number, width: number): Structure {
  const r: Rand = seeded(hash(seed, 0x9a55));
  const out: number[] = [];
  const seg = (x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, tone: number, leaf = 0) => out.push(x0, y0, 0, x1, y1, 0, w0, w1, tone, leaf);
  // grass: curved blades, leaning with a shared breeze and their own
  const lean = (r() - 0.5) * 0.5;
  const blades = Math.round(width * 150);
  for (let i = 0; i < blades; i++) {
    // denser in the middle, thinning to nothing at the ends (no straight card edges)
    let x = (r() + r() + r() - 1.5) * (width / 3);
    // fake depth: a blade further back in the tussock roots higher on the card, and is a little
    // shorter and paler — so the foot of a patch is as ragged as its tips, never a straight edge
    const back = Math.pow(r(), 1.4);
    let y = back * 0.16;
    const h = (0.06 + Math.pow(r(), 1.2) * 0.62) * (1 - back * 0.35);
    const fallen = r() < .08;
    let a = fallen ? (r() < .5 ? .55 : Math.PI - .55) : Math.PI / 2 + lean + (r() - .5) * 1.25;
    const bend = (r() - 0.5) * 0.25 + lean * 0.3;
    const steps = 5;
    const w = (0.0015 + Math.pow(r(), 3) * 0.006) * (1 - back * 0.3);
    const tone = Math.min(1, r() * (1 - back * 0.3) + back * 0.35);
    for (let k = 0; k < steps; k++) {
      const len = fallen ? h * 0.45 : h;
      const nx = x + (Math.cos(a) * len) / steps;
      const ny = Math.max(.008, y + (Math.sin(a) * len) / steps);
      seg(x, y, nx, ny, w * (1 - k / steps), w * (1 - (k + 1) / steps) + 0.0005, tone);
      x = nx;
      y = ny;
      a -= bend + (k / steps) * 0.15 * Math.sign(Math.cos(a));
    }
    // a seed head on some: a drooping spray of tiny grains
    if (r() < 0.12) {
      for (let k = 0; k < 9; k++) {
        const ga = -Math.PI / 2 + (r() - 0.5) * 2.2;
        const gl = 0.01 + r() * 0.03;
        seg(x, y, x + Math.cos(ga) * gl, y + Math.sin(ga) * gl, 0.0012, 0.0025, Math.min(1, tone + 0.3));
      }
    }
  }
  // bramble: long arching stems with thorns
  const brambles = r() < 0.45 ? 1 : 0;
  for (let b = 0; b < brambles; b++) {
    let x = (r() - 0.5) * width;
    let y = 0;
    let a = Math.PI / 2 - (r() < 0.5 ? -1 : 1) * (0.2 + r() * 0.3);
    const turn = (Math.cos(a) > 0 ? -1 : 1) * (0.09 + r() * 0.06);
    for (let k = 0; k < 11 + Math.floor(r() * 8) && y >= 0; k++) {
      const nx = x + Math.cos(a) * 0.06;
      const ny = y + Math.sin(a) * 0.06;
      seg(x, y, nx, ny, 0.007, 0.006, 0.1);
      if (r() < 0.5) {
        const ta = a + (r() < 0.5 ? 1 : -1) * 1.2;
        seg(nx, ny, nx + Math.cos(ta) * 0.012, ny + Math.sin(ta) * 0.012, 0.003, 0.0008, 0.1);
      }
      x = nx;
      y = ny;
      // arching, but never a clean circle: the stem wanders and droops more as it lengthens
      a += turn * (0.4 + r() * 1.2) + (r() - 0.5) * 0.25;
    }
  }
  // Bracken crowns: several arching fronds, broken pinnae and fine leaflets.
  if (r() < .5) {
    const bx = (r() - .5) * width * .65;
    const fronds = 3 + Math.floor(r() * 3);
    for (let f = 0; f < fronds; f++) {
      const h = .25 + r() * .48;
      let a = Math.PI / 2 + (f / (fronds - 1) - .5) * 1.8;
      const bend = (a > Math.PI / 2 ? 1 : -1) * (.025 + r() * .05);
      let x = bx, y = .015;
      for (let k = 0; k < 12; k++) {
        const nx = x + Math.cos(a) * h / 12, ny = Math.max(.015, y + Math.sin(a) * h / 12);
        seg(x, y, nx, ny, .004 * (1-k/14), .002, .38);
        if (k > 2) for (const side of [-1, 1]) {
          if (r() < .17) continue;
          const fa = a + side * 1.04;
          const fl = h * .27 * Math.sin((k-2)/10*Math.PI) * (.65+r()*.35);
          const ex = nx + Math.cos(fa)*fl, ey = ny + Math.sin(fa)*fl - .02;
          seg(nx, ny, ex, ey, .003, .001, .48);
          for (let j = 1; j < 5; j++) {
            const u=j/5, lx=nx+(ex-nx)*u, ly=ny+(ey-ny)*u;
            for (const wing of [-1,1]) {
              const la=fa+wing*.85, ll=fl*.24*(1-u*.65);
              seg(lx,ly,lx+Math.cos(la)*ll,ly+Math.sin(la)*ll-.008,.005,.0007,.4+r()*.25);
            }
          }
        }
        x=nx; y=ny; a+=bend;
      }
    }
  }
  const st = finish(new Float32Array(out), out.length / SEG, 'shrub');
  st.radius = width / 2 + 0.1;
  return st;
}


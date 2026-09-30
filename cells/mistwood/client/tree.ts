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

/** Per segment: x0, y0, x1, y1, w0, w1, tone (0 dark bark … 1 birch white), leaf (0/1). */
export const SEG = 8;

export interface Structure {
  segs: Float32Array;
  count: number;
  minX: number;
  maxX: number;
  maxY: number;
  species: Species;
}

interface Params {
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

/** No tree grows past this many segments (a phone must be able to bake it). */
const CAP = 60000;

export function grow(seed: number, species: Species): Structure {
  const p = P[species];
  const r: Rand = seeded(hash(seed, 0x7ee));
  let segs = new Float32Array(SEG * 4096);
  let n = 0;
  let minX = 0;
  let maxX = 0;
  let maxY = 0;
  const push = (x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, tone: number, leaf: number) => {
    if (n >= CAP) return;
    if ((n + 1) * SEG > segs.length) {
      const next = new Float32Array(segs.length * 2);
      next.set(segs);
      segs = next;
    }
    const o = n * SEG;
    segs[o] = x0;
    segs[o + 1] = y0;
    segs[o + 2] = x1;
    segs[o + 3] = y1;
    segs[o + 4] = w0;
    segs[o + 5] = w1;
    segs[o + 6] = tone;
    segs[o + 7] = leaf;
    n++;
    minX = Math.min(minX, x1 - w1);
    maxX = Math.max(maxX, x1 + w1);
    maxY = Math.max(maxY, y1 + w1);
  };
  const UP = Math.PI / 2;

  /** One branch: a kinked polyline that tapers, with side branches along it and a fork at its end. */
  const branch = (x: number, y: number, a: number, len: number, w0: number, order: number, clear: number) => {
    const wEnd = Math.max(p.minW, w0 * (order === 0 ? 0.5 : 0.36));
    const segLen = Math.max(0.02, p.seg * Math.pow(0.62, order));
    const steps = Math.max(2, Math.ceil(len / segLen));
    const step = len / steps;
    const white = p.white > 0;
    for (let i = 0; i < steps; i++) {
      const f0 = i / steps;
      const f1 = (i + 1) / steps;
      const wa = w0 + (wEnd - w0) * f0;
      const wb = w0 + (wEnd - w0) * f1;
      // the kink grows towards the twigs; thick wood bends to the light, thin long twigs hang
      a += (r() - 0.5) * p.kink * (0.5 + order * 0.35);
      a += (UP - a) * p.up * step * (wa > 0.02 ? 1 : 0.4);
      if (wa < 0.015) a -= p.droop * step * (0.5 + order * 0.3) * Math.sign(Math.cos(a) || 1);
      const nx = x + Math.cos(a) * step;
      const ny = Math.max(0, y + Math.sin(a) * step);
      push(x, y, nx, ny, wa, wb, white && wa > p.white ? 1 : 0, 0);
      // side branches (none low on the trunk)
      if (order < p.maxOrder && wb > p.minW * 1.6 && f1 > clear && r() < (p.lateral[order] ?? 0.3)) {
        const side = r() < 0.5 ? -1 : 1;
        const ca = a + side * p.spread * (0.55 + r() * 0.7);
        const remain = len * (1 - f1);
        const cl = (remain * 0.7 + len * 0.3) * p.lenDecay * (0.55 + r() * 0.6);
        branch(nx, ny, ca, cl, Math.max(p.minW, wb * p.wDecay * (0.7 + r() * 0.5)), order + 1, 0);
      }
      // the fine stuff: short kinked twiglets all along the thin wood (most of what the mist shows)
      if (order >= 2 && wa < 0.025 && r() < p.twigs) {
        let tx = nx;
        let ty = ny;
        let ta = a + (r() < 0.5 ? -1 : 1) * (0.45 + r() * 0.6);
        const tl = 0.04 + r() * 0.2;
        const tw = Math.max(p.minW, Math.min(wb * 0.7, p.minW * 1.6));
        for (let k = 0; k < 3; k++) {
          ta += (r() - 0.5) * 0.7 + (UP - ta) * 0.15;
          const ex = tx + (Math.cos(ta) * tl) / 3;
          const ey = ty + (Math.sin(ta) * tl) / 3;
          push(tx, ty, ex, ey, tw, Math.max(p.minW * 0.7, tw * 0.8), 0, 0);
          tx = ex;
          ty = ey;
        }
        if (p.leaves && r() < p.leaves * 0.5) push(tx, ty, tx + (r() - 0.5) * 0.03, ty - 0.05, 0.022, 0.012, 0, 1);
      }
      x = nx;
      y = ny;
    }
    // the end: a fork (the leader goes on one way, the other shoot another), or a twig tip
    if (order < p.maxOrder && wEnd > p.minW * 1.3 && (order < 3 || r() < p.fork)) {
      const kids = order === 0 ? 2 + Math.floor(r() * 3) : r() < 0.3 ? 3 : 2;
      for (let k = 0; k < kids; k++) {
        const ca = a + (k / (kids - 1) - 0.5) * p.spread * (1 + r() * 0.5);
        branch(x, y, ca, len * p.lenDecay * (0.7 + r() * 0.4), Math.max(p.minW, wEnd * 0.8), order + 1, 0);
      }
    } else if (p.leaves && r() < p.leaves) {
      // a few dry leaves on the last twig, hanging
      const count = 1 + Math.floor(r() * 3);
      for (let k = 0; k < count; k++) {
        const la = -UP + (r() - 0.5) * 1.6;
        const ll = 0.035 + r() * 0.04;
        push(x, y, x + Math.cos(la) * ll, y + Math.sin(la) * ll, 0.02 + r() * 0.012, 0.012, 0, 1);
      }
    }
  };

  const stems = p.stems[0] + Math.floor(r() * (p.stems[1] - p.stems[0] + 1));
  for (let s = 0; s < stems; s++) {
    const len = p.trunk[0] + r() * (p.trunk[1] - p.trunk[0]);
    const w = p.width[0] + r() * (p.width[1] - p.width[0]);
    const lean = (r() - 0.5) * 2 * p.lean + (stems > 1 ? (s / (stems - 1) - 0.5) * 1.4 : 0);
    branch((r() - 0.5) * 0.1 * (stems > 1 ? 3 : 0), 0, UP + lean, len, w, 0, p.clear);
  }
  return { segs: segs.subarray(0, n * SEG), count: n, minX, maxX, maxY, species };
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
  const seg = (x0: number, y0: number, x1: number, y1: number, w0: number, w1: number, tone: number, leaf = 0) => out.push(x0, y0, x1, y1, w0, w1, tone, leaf);
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
    let a = Math.PI / 2 + lean + (r() - 0.5) * 0.7;
    const bend = (r() - 0.5) * 0.25 + lean * 0.3;
    const steps = 5;
    const w = (0.0015 + r() * 0.003) * (1 - back * 0.3);
    const tone = Math.min(1, r() * (1 - back * 0.3) + back * 0.35);
    for (let k = 0; k < steps; k++) {
      const nx = x + (Math.cos(a) * h) / steps;
      const ny = y + (Math.sin(a) * h) / steps;
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
    for (let k = 0; k < 26 && y >= 0; k++) {
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
  // dead bracken: a stem, then alternating fronds
  if (r() < 0.5) {
    const bx = (r() - 0.5) * width;
    const h = 0.35 + r() * 0.4;
    let a = Math.PI / 2 + (r() - 0.5) * 0.4;
    let x = bx;
    let y = 0;
    for (let k = 0; k < 14; k++) {
      const nx = x + Math.cos(a) * (h / 14);
      const ny = y + Math.sin(a) * (h / 14);
      seg(x, y, nx, ny, 0.004, 0.0035, 0.55);
      if (k > 4)
        for (const side of [-1, 1]) {
          const fa = a + side * 1.25;
          const fl = 0.09 * (1 - k / 16);
          seg(nx, ny, nx + Math.cos(fa) * fl, ny + Math.sin(fa) * fl - 0.02, 0.006, 0.002, 0.65);
        }
      x = nx;
      y = ny;
      a -= 0.06;
    }
  }
  const segs = new Float32Array(out);
  let maxY = 0;
  for (let i = 0; i < segs.length; i += SEG) maxY = Math.max(maxY, segs[i + 1], segs[i + 3]);
  return { segs, count: segs.length / SEG, minX: -width / 2 - 0.1, maxX: width / 2 + 0.1, maxY: maxY + 0.02, species: 'shrub' };
}

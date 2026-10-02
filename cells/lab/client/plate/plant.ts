/**
 * A plant, from one seed, as a botanical plate shows it: the whole specimen lifted from the
 * ground, roots and all — stem, leaves at their nodes, a flower or an inflorescence at the top.
 *
 * It is not a mesh but what an engraver draws: lines (stems, roots, petioles, a leaf's outline,
 * its midrib and veins, stamens) and blades (a leaf's or a petal's surface, to hide what is behind
 * it and to carry its hatching). Every part has a time of birth and of full size, so the plant can
 * be drawn growing: `at(T)` is the specimen at T (0 a seed, 1 grown).
 *
 * Metres, y up, the ground at y = 0 (roots below it).
 */
import { hash, seeded, type Rand } from '../kit/rng';

export type V3 = [number, number, number];

/** A drawn line: from a to b, its width at each end (m), when it grows, which stroke it is part
 * of and how far along it (m) — so the pencil runs on along it — and its kind. */
export interface Line {
  a: V3;
  b: V3;
  wa: number;
  wb: number;
  t0: number;
  t1: number;
  stroke: number;
  arc: number;
  kind: LineKind;
  /** where it grows from, and over when: lines on a blade (its outline, its veins) grow with the
   * blade, scaled about its base as it unfolds */
  from?: V3;
  grow?: [number, number];
}
export const enum LineKind {
  Stem = 0,
  Root = 1,
  Outline = 2,
  Vein = 3,
  Fine = 4,
}

/** A surface: a leaf's or a petal's, as rows across it from base to tip (left, middle, right). */
export interface Blade {
  rows: Array<{ l: V3; m: V3; r: V3 }>;
  base: V3;
  t0: number;
  t1: number;
  /** 0 a leaf (hatched as it turns from the light), 1 a petal (left pale) */
  kind: 0 | 1;
}

export interface Specimen {
  lines: Line[];
  blades: Blade[];
  /** its extent: height above ground, depth below, reach to the side (m) */
  height: number;
  depth: number;
  reach: number;
  name: string;
  /** the plate's note: habit, leaves, flowers, in a few words */
  note: string;
}

// ─── small vector arithmetic ─────────────────────────────────────────────────────────────────────
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
const dist = (a: V3, b: V3) => len(add(a, mul(b, -1)));
/** a direction at azimuth az (rad), elevation el (rad, from level) */
const dirOf = (az: number, el: number): V3 => [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
/** lerp */
const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

type Shape = 'lanceolate' | 'ovate' | 'cordate' | 'lobed' | 'pinnate';
type Habit = 'erect' | 'branching' | 'rosette';
type Bloom = 'solitary' | 'spike' | 'umbel';

interface Genome {
  habit: Habit;
  shape: Shape;
  bloom: Bloom;
  /** leaf arrangement: the angle between one node's leaf and the next (and how many at a node) */
  divergence: number;
  perNode: number;
  nodes: number;
  height: number;
  stemW: number;
  leafL: number;
  leafW: number;
  petiole: number;
  teeth: number;
  lobes: number;
  droop: number;
  petals: number;
  petalL: number;
  /** petals: broad and round, or narrow */
  petalW: number;
  curve: number;
}

function genome(r: Rand): Genome {
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const habit = pick<Habit>(['erect', 'erect', 'branching', 'rosette']);
  const shape = pick<Shape>(['lanceolate', 'ovate', 'cordate', 'lobed', 'pinnate']);
  const arr = r();
  return {
    habit,
    shape,
    bloom: habit === 'rosette' ? pick<Bloom>(['solitary', 'umbel', 'spike']) : pick<Bloom>(['solitary', 'spike', 'umbel']),
    divergence: arr < 0.55 ? 2.39996 : arr < 0.85 ? Math.PI / 2 : Math.PI / 3,
    perNode: arr < 0.55 ? 1 : arr < 0.85 ? 2 : 3,
    nodes: habit === 'rosette' ? 7 + Math.floor(r() * 6) : 5 + Math.floor(r() * 6),
    height: 0.22 + r() * 0.22,
    stemW: 0.004 + r() * 0.005,
    leafL: (shape === 'pinnate' ? 0.14 : 0.1) + r() * 0.07,
    leafW: shape === 'lanceolate' ? 0.16 + r() * 0.08 : shape === 'cordate' ? 0.5 + r() * 0.15 : 0.32 + r() * 0.14,
    petiole: shape === 'lanceolate' ? r() * 0.08 : 0.12 + r() * 0.25,
    teeth: r() < 0.5 ? 0 : 8 + Math.floor(r() * 14),
    lobes: 2 + Math.floor(r() * 3),
    droop: 0.1 + r() * 0.5,
    petals: [4, 5, 5, 5, 6][Math.floor(r() * 5)],
    petalL: 0.018 + r() * 0.022,
    petalW: 0.35 + r() * 0.5,
    curve: (r() - 0.5) * 0.25,
  };
}

/** The leaf's half-width at u (0 base … 1 tip), as a fraction of its width. */
function widthAt(g: Genome, u: number, shape: Shape = g.shape): number {
  const s = Math.PI;
  let w: number;
  switch (shape) {
    case 'lanceolate':
      w = Math.pow(Math.sin(s * Math.pow(u, 0.75)), 0.9);
      break;
    case 'ovate':
      w = Math.pow(Math.sin(s * Math.pow(u, 0.6)), 0.8);
      break;
    case 'cordate':
      w = Math.pow(Math.sin(s * Math.pow(u, 0.55)), 0.7) + 0.35 * Math.pow(1 - u, 8);
      break;
    case 'lobed':
      w = Math.pow(Math.sin(s * Math.pow(u, 0.65)), 0.8) * (1 - 0.42 * Math.pow(Math.abs(Math.sin(u * s * (g.lobes + 0.5))), 0.7) * smooth(0.1, 0.25, u));
      break;
    default:
      w = Math.pow(Math.sin(s * Math.pow(u, 0.7)), 0.9);
  }
  // a toothed edge: a small saw, each tooth pointing forward
  if (g.teeth) w *= 1 + 0.07 * (1 - ((u * g.teeth) % 1)) * smooth(0.08, 0.2, u) * smooth(1, 0.85, u);
  return Math.max(0, w);
}

export function grow(seed: number): Specimen {
  const r = seeded(hash(seed, 0x61a7));
  const g = genome(r);
  const lines: Line[] = [];
  const blades: Blade[] = [];
  let strokes = 1;
  const UP: V3 = [0, 1, 0];

  /** A polyline as lines: one stroke, its arc running on, growing from t0 to t1 along it. */
  const polyline = (pts: V3[], w0: number, w1: number, t0: number, t1: number, kind: LineKind, from?: V3, grow?: [number, number]) => {
    const id = strokes++;
    let arc = 0;
    const n = pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const f0 = i / n;
      const f1 = (i + 1) / n;
      lines.push({ a, b, wa: w0 + (w1 - w0) * f0, wb: w0 + (w1 - w0) * f1, t0: t0 + (t1 - t0) * f0, t1: t0 + (t1 - t0) * f1, stroke: id, arc, kind, from, grow });
      arc += dist(a, b);
    }
  };

  /** A blade (leaf, leaflet, petal, sepal) from base along d, its side s: its surface, outline, midrib and veins. */
  const blade = (base: V3, d: V3, L: number, W: number, t0: number, t1: number, kind: 0 | 1, shape: Shape, droop: number, veins: boolean) => {
    let side = cross(UP, d);
    if (len(side) < 1e-4) side = [1, 0, 0];
    side = norm(side);
    const n = norm(cross(d, side));
    const K = 14;
    const rows: Blade['rows'] = [];
    for (let k = 0; k <= K; k++) {
      const u = k / K;
      // the midrib: out along d, bending down as it goes (and its tip curling a little)
      const m = add(add(base, mul(d, u * L)), mul(UP, -droop * L * u * u));
      const hw = widthAt(g, u, shape) * W * L * 0.5;
      // a little folded along the midrib (a shallow V)
      const fold = mul(n, hw * 0.22);
      rows.push({ l: add(add(m, mul(side, -hw)), fold), m, r: add(add(m, mul(side, hw)), fold) });
    }
    blades.push({ rows, base, t0, t1, kind });
    const ol = rows.map((x) => x.l);
    const orr = rows.map((x) => x.r);
    const ow = kind ? 0.0004 : 0.0005;
    const gw: [number, number] = [t0, t1];
    const early = t0 + (t1 - t0) * 0.35;
    polyline(ol, ow, ow * 0.6, t0, early, LineKind.Outline, base, gw);
    polyline(orr, ow, ow * 0.6, t0, early, LineKind.Outline, base, gw);
    if (veins) {
      polyline(rows.map((x) => x.m), 0.0008, 0.0002, t0, early, LineKind.Vein, base, gw);
      // side veins: from the midrib out toward the edge, angled forward, alternate sides
      const V = Math.max(3, Math.round(L / 0.012));
      for (let j = 1; j < V; j++) {
        const u = j / V;
        const k = Math.round(u * K);
        const k2 = Math.min(K, k + 2);
        const toward = j % 2 ? rows[k2].l : rows[k2].r;
        const from = rows[k].m;
        polyline([from, mix3(from, toward, 0.55), mix3(from, toward, 0.88)], 0.0003, 0.00012, early, t1, LineKind.Vein, base, gw);
      }
    }
  };

  /** A leaf at a node: its petiole, then its blade (or, pinnate, a rachis with pairs of leaflets). */
  const leaf = (node: V3, az: number, el: number, size: number, t0: number) => {
    const t1 = t0 + 0.2;
    const L = g.leafL * size;
    let d = dirOf(az, el);
    let base = node;
    const pl = L * g.petiole;
    if (pl > 0.004) {
      const tip = add(node, mul(d, pl));
      polyline([node, tip], 0.0016, 0.001, t0, t0 + 0.06, LineKind.Stem);
      base = tip;
      d = norm(add(d, mul(UP, -0.25 * g.droop)));
    }
    if (g.shape === 'pinnate') {
      const pairs = 3 + Math.floor(L / 0.025);
      const rach: V3[] = [];
      for (let k = 0; k <= pairs; k++) rach.push(add(add(base, mul(d, (k / pairs) * L)), mul(UP, -g.droop * L * (k / pairs) ** 2 * 0.6)));
      polyline(rach, 0.0012, 0.0005, t0, t1, LineKind.Stem, base);
      let side = norm(cross(UP, d));
      for (let k = 1; k <= pairs; k++) {
        const at = rach[k];
        const lL = L * 0.32 * (1 - 0.35 * (k / pairs));
        for (const sg of [-1, 1]) {
          if (k === pairs && sg > 0) continue;
          const ld = k === pairs ? d : norm(add(mul(side, sg), mul(d, 0.5)));
          blade(at, ld, lL, 0.42, t0 + 0.04 * k, t1 + 0.04 * k, 0, 'lanceolate', g.droop * 0.4, true);
        }
        side = norm(cross(UP, d));
      }
      return;
    }
    blade(base, d, L, g.leafW, t0, t1, 0, g.shape, g.droop, true);
  };

  /** A flower at the end of p along d: sepals, petals opening from a bud, stamens. */
  const flower = (p: V3, d: V3, size: number, t0: number) => {
    const t1 = t0 + 0.22;
    let side = cross(UP, d);
    if (len(side) < 1e-4) side = [1, 0, 0];
    side = norm(side);
    const up2 = norm(cross(d, side));
    const P = g.petals;
    const pL = g.petalL * size;
    for (let k = 0; k < P; k++) {
      const a = (k / P) * Math.PI * 2;
      const out = norm(add(mul(side, Math.cos(a)), mul(up2, Math.sin(a))));
      // a petal: out from the centre and forward (a cup, open)
      blade(p, norm(add(mul(out, 0.85), mul(d, 0.55))), pL, g.petalW, t0 + 0.04, t1, 1, 'ovate', -0.15, false);
      // a sepal behind it, small and narrow
      const outS = norm(add(mul(side, Math.cos(a + Math.PI / P)), mul(up2, Math.sin(a + Math.PI / P))));
      blade(p, norm(add(mul(outS, 0.8), mul(d, -0.2))), pL * 0.45, 0.35, t0, t0 + 0.12, 0, 'lanceolate', 0.1, false);
    }
    // stamens: fine filaments, each with its anther (a short thick dash)
    const S = P * 2;
    for (let k = 0; k < S; k++) {
      const a = (k / S) * Math.PI * 2 + 0.3;
      const out = norm(add(mul(side, Math.cos(a)), mul(up2, Math.sin(a))));
      const tip = add(p, add(mul(d, pL * 0.45), mul(out, pL * 0.18)));
      polyline([p, tip], 0.0002, 0.0002, t0 + 0.1, t1, LineKind.Fine);
      polyline([tip, add(tip, mul(out, 0.0012))], 0.0009, 0.0009, t1 - 0.05, t1, LineKind.Fine);
    }
  };

  /** A stem from base along d: nodes with their leaves, side shoots, and its flowering end. */
  const stem = (base: V3, d0: V3, height: number, w: number, t0: number, depth: number, nodes: number, firstPhase: number) => {
    const pts: V3[] = [base];
    let d = d0;
    let p = base;
    const tEnd = t0 + 0.55 * (height / g.height);
    const nodePts: Array<{ p: V3; t: number; i: number }> = [];
    const per = 3;
    for (let i = 1; i <= nodes; i++) {
      // internodes longer lower down, shorter towards the top
      const f = i / nodes;
      const seg = (height / nodes) * (1.25 - 0.5 * f);
      for (let k = 1; k <= per; k++) {
        d = norm(add(d, [(r() - 0.5) * 0.06 + g.curve * 0.04, 0.03, (r() - 0.5) * 0.06]));
        p = add(p, mul(d, seg / per));
        pts.push(p);
      }
      nodePts.push({ p, t: t0 + (tEnd - t0) * f, i });
    }
    polyline(pts, w, w * 0.45, t0, tEnd, LineKind.Stem);
    for (const nd of nodePts) {
      const f = nd.i / nodes;
      // the leaves at this node, round the stem by the arrangement; smaller and more upright higher up
      if (f < 0.92) {
        for (let q = 0; q < g.perNode; q++) {
          const az = firstPhase + nd.i * g.divergence + (q / g.perNode) * Math.PI * 2;
          leaf(nd.p, az, 0.35 + 0.6 * f, (1 - 0.55 * f) * (depth ? 0.7 : 1), nd.t + 0.02);
        }
      }
      // a side shoot here and there (branching plants; none on side shoots themselves)
      if (g.habit === 'branching' && !depth && f > 0.3 && f < 0.8 && r() < 0.55) {
        const az = firstPhase + nd.i * g.divergence + Math.PI * 0.5;
        stem(nd.p, norm(add(dirOf(az, 0.9), mul(d, 0.6))), height * (0.45 + r() * 0.2) * (1 - f * 0.4), w * 0.55, nd.t + 0.03, 1, Math.max(3, Math.round(nodes * 0.45)), az);
      }
    }
    // the flowering end
    inflorescence(p, d, w * 0.45, tEnd, depth ? 0.8 : 1);
  };

  const inflorescence = (p: V3, d: V3, w: number, t0: number, size: number) => {
    if (g.bloom === 'solitary') {
      flower(p, d, size * 1.4, t0 + 0.02);
      return;
    }
    if (g.bloom === 'umbel') {
      const rays = 5 + Math.floor(r() * 5);
      for (let k = 0; k < rays; k++) {
        const az = (k / rays) * Math.PI * 2 + r() * 0.3;
        const rd = norm(add(d, mul(dirOf(az, 0), 0.75)));
        const rl = 0.025 + r() * 0.015;
        const tip = add(p, mul(rd, rl));
        polyline([p, tip], w * 0.5, w * 0.35, t0, t0 + 0.06, LineKind.Stem);
        flower(tip, rd, size * 0.55, t0 + 0.05 + r() * 0.06);
      }
      return;
    }
    // a spike: the stem goes on, flowers on short stalks up it, open below, buds above
    const n = 6 + Math.floor(r() * 6);
    const spikeL = 0.05 + r() * 0.05;
    let q = p;
    const pts: V3[] = [p];
    for (let k = 1; k <= n; k++) {
      q = add(q, mul(d, spikeL / n));
      pts.push(q);
      const az = k * 2.39996;
      const sd = norm(add(dirOf(az, 0.4), mul(d, 0.5)));
      const tip = add(q, mul(sd, 0.006));
      polyline([q, tip], 0.0008, 0.0006, t0 + (0.2 * k) / n, t0 + (0.2 * k) / n + 0.04, LineKind.Stem);
      // (the top ones never open: still buds when the plant is grown)
      flower(tip, sd, size * (0.75 - 0.35 * (k / n)), t0 + (0.25 * k) / n + (k > n * 0.7 ? 0.5 : 0));
    }
    polyline(pts, w, w * 0.4, t0, t0 + 0.2, LineKind.Stem);
  };

  // ─── the plant ─────────────────────────────────────────────────────────────────────────────────
  const phase = r() * Math.PI * 2;
  if (g.habit === 'rosette') {
    // a rosette of leaves at the ground, and a flowering stalk from its middle
    for (let i = 0; i < g.nodes; i++) {
      const az = phase + i * 2.39996;
      leaf([0, 0.004, 0], az, 0.12 + 0.25 * (i / g.nodes), 1.25 - 0.35 * (i / g.nodes), 0.03 + 0.25 * (i / g.nodes));
    }
    stem([0, 0, 0], norm([g.curve, 1, 0]), g.height * 0.8, g.stemW * 0.7, 0.25, 0, 3, phase);
  } else {
    stem([0, 0, 0], norm([g.curve * 0.5, 1, 0]), g.height, g.stemW, 0.04, 0, g.nodes, phase);
  }
  // the roots: a taproot and fibrous side roots, fine and branching, down and out
  const roots = 4 + Math.floor(r() * 5);
  for (let k = 0; k < roots; k++) {
    let p: V3 = [0, 0, 0];
    let d = norm(add(dirOf(phase + k * 2.1, -1.2 + r() * 0.5), [0, -0.6, 0]));
    const L = (k === 0 ? 0.12 : 0.05) + r() * 0.06;
    const pts: V3[] = [p];
    for (let i = 0; i < 9; i++) {
      d = norm(add(d, [(r() - 0.5) * 0.5, -0.12, (r() - 0.5) * 0.5]));
      p = add(p, mul(d, L / 9));
      pts.push(p);
      if (i > 1 && i < 7 && r() < 0.35) {
        let q = p;
        const sub: V3[] = [q];
        let sd = norm(add(d, [(r() - 0.5) * 1.6, -0.2, (r() - 0.5) * 1.6]));
        for (let j = 0; j < 4; j++) {
          sd = norm(add(sd, [(r() - 0.5) * 0.6, -0.15, (r() - 0.5) * 0.6]));
          q = add(q, mul(sd, L * 0.06));
          sub.push(q);
        }
        polyline(sub, 0.0006, 0.0002, 0.02 + 0.03 * i, 0.12 + 0.03 * i, LineKind.Root);
      }
    }
    polyline(pts, k === 0 ? g.stemW * 0.8 : 0.0012, 0.0003, 0, 0.3, LineKind.Root);
  }

  // its extent
  let height = 0.01;
  let depth = 0.01;
  let reach = 0.01;
  for (const l of lines)
    for (const p of [l.a, l.b]) {
      height = Math.max(height, p[1]);
      depth = Math.max(depth, -p[1]);
      reach = Math.max(reach, Math.hypot(p[0], p[2]));
    }
  return { lines, blades, height, depth, reach, name: binomial(seed, g), note: describe(g) };
}

/** Its name: a genus made from the seed, an epithet from what it is like. */
function binomial(seed: number, g: Genome): string {
  const r = seeded(hash(seed, 0xb1));
  const on = ['br', 'c', 'd', 'f', 'g', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'th', 'ph', 'st', 'cl', 'tr'];
  const vo = ['a', 'e', 'i', 'o', 'u', 'ae', 'ia', 'y'];
  const end = ['ia', 'um', 'is', 'a', 'ella', 'aria', 'ops', 'anthe'];
  const syl = () => on[Math.floor(r() * on.length)] + vo[Math.floor(r() * vo.length)];
  let genus = syl() + syl() + end[Math.floor(r() * end.length)];
  genus = genus[0].toUpperCase() + genus.slice(1);
  const shape = { lanceolate: 'lanceolata', ovate: 'ovata', cordate: 'cordifolia', lobed: 'lobata', pinnate: 'pinnatifolia' }[g.shape];
  const other = g.habit === 'rosette' ? 'acaulis' : g.habit === 'branching' ? 'ramosa' : g.bloom === 'spike' ? 'spicata' : g.bloom === 'umbel' ? 'umbellata' : 'erecta';
  return `${genus} ${r() < 0.5 ? shape : other}`;
}

function describe(g: Genome): string {
  const habit = { erect: 'an upright herb', branching: 'a branching herb', rosette: 'a rosette, flowering on a stalk' }[g.habit];
  const arr = g.perNode === 1 ? 'alternate' : g.perNode === 2 ? 'opposite' : 'whorled';
  const leaves = `${g.shape} leaves, ${arr}${g.teeth ? ', toothed' : ''}`;
  const bloom = { solitary: 'a single flower', spike: 'flowers in a spike', umbel: 'flowers in an umbel' }[g.bloom];
  return `${habit}; ${leaves}; ${bloom} of ${g.petals} petals`;
}

/** Where a line is at growth T: none of it before t0, all of it after t1, the part between growing
 * from a; and a blade's line scaled about the blade's base as the blade unfolds. */
export function lineAt(l: Line, T: number): { a: V3; b: V3; wa: number; wb: number } | null {
  if (T <= l.t0) return null;
  const f = Math.min(1, (T - l.t0) / Math.max(l.t1 - l.t0, 1e-4));
  let a = l.a;
  let b = mix3(l.a, l.b, f);
  if (l.from && l.grow) {
    const s = Math.max(0.05, smooth(l.grow[0], l.grow[1], T));
    a = mix3(l.from, a, s);
    b = mix3(l.from, b, s);
  }
  return { a, b, wa: l.wa, wb: l.wa + (l.wb - l.wa) * f };
}

/** How grown a part born between t0 and t1 is at T (0 … 1). */
export const grownAt = (t0: number, t1: number, T: number) => smooth(t0, t1, T);

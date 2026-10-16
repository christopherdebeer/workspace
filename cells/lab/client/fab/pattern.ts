/**
 * Pattern making, for one family of garment: the skirt. A skirt's the simplest thing that's truly made: flat pieces,
 * cut, joined round a body and hung from one line (the waist); and nearly every move a dressmaker has shows in it.
 *
 * The grammar. A skirt is a waistband and n panels round it, side by side, each joined to the next along a side seam.
 * The design's intentions:
 * - length (cm, down from the waist);
 * - fullness: how much wider the hem is than the hips (1: no wider; 3: three times round);
 * - where that fullness comes from (the method): cut into the panels' shape as flare (each panel a sector, its hem
 *   longer than its top), or cut as straight width and taken in at the waist, gathered (eased in evenly) or pleated
 *   (folded, stitched down a little way);
 * - how many panels, and where on the cloth's grain they're cut (straight, or toward the bias);
 * - which cloth, and what's printed on it.
 *
 * What follows, as it does on a cutting table:
 * - the waist is smaller than the hips, so something must take the difference in: a flare wide enough already does;
 *   else each side seam curves in a little (no more than a seam can: 2 cm); what's left is taken in by darts, as many
 *   as needed, none deeper than 3 cm (fewer panels, so fewer seams: more darts);
 * - each panel must fit across the cloth's width (140 cm) along its grain; one that doesn't is cut in more panels;
 * - a circle can't be fuller than a circle: flare stops at a full circle.
 * Silhouette, the folds, how it swings, are never set: they're what the simulated cloth does with the cut.
 *
 * Out of it: the pieces (each a grid over its flat shape, in centimetres, with its grain), which grid points are sewn
 * to which (side seams, darts, pleats), where the waist edge is held along the band, notes on what the cut needed,
 * and checks of the pattern itself (does every seam meet a seam its length; does the waist edge, darts and pleats
 * closed, fit the band; does it clear the hips; does each piece fit on the cloth).
 */
import { TORSO_FOOT, WAIST_Y, girth, section, type V3 } from './body';
import type { Fabric } from './fabric';

export type Method = 'flare' | 'gather' | 'pleat';
export interface Design {
  /** cm down from the waist */
  length: number;
  /** hem round ÷ hips round, 1 → 4 */
  fullness: number;
  method: Method;
  panels: number;
  /** degrees off the straight grain: 0 straight, 45 the true bias */
  grain: number;
  fabric: string; print: number; colour: number;
}
export const DEFAULT_DESIGN: Design = { length: 34, fullness: 2.2, method: 'flare', panels: 4, grain: 0, fabric: 'lawn', print: 2, colour: 1 };

/** a point of a piece's grid: piece, column, row */
export type At = [number, number, number];
export interface Piece {
  name: string; kind: 'panel' | 'band';
  /** grid points across and down, less one */
  nu: number; nv: number;
  /** the flat pattern, cm (x across, y up: down the skirt is negative) */
  flat: (u: number, v: number) => [number, number];
  /** the warp's direction on the piece: radians from its centre line (straight down) */
  grain: number;
  /** where it's laid out round the figure before it's sewn: on a surface it lies on without stretching */
  start: (u: number, v: number) => V3;
}
export interface Pair { a: At; b: At; why: 'side seam' | 'dart' | 'pleat' }
/** a point held on the waistband: `s` cm round it from the front, `y` its height */
export interface Hold { at: At; s: number; y: number }
export interface Check { name: string; ok: boolean; detail: string }
export interface Skirt {
  design: Design; pieces: Piece[]; pairs: Pair[]; holds: Hold[];
  band: number; notes: string[]; checks: Check[];
  /** the darts and pleats on each panel, as drawn on the pattern: columns where each starts, how many it closes, how far down it's sewn */
  marks: Array<{ kind: 'dart' | 'pleat'; c: number; k: number; down: number }>;
  m: { waist: number; hip: number; hem: number; length: number; panels: number; darts: number; pleats: number; flare: number; area: number };
}

/** wearing ease: how much bigger round than the body a skirt must be anywhere it's sewn closed (its own thickness off
 * the body, and room to move) */
export const BOLT = 140, SEAM_CURVE = 2, DART_MAX = 3, PLEAT_STITCH = 5, BAND_H = 2.5, EASE = 4;
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** the body's round at a depth below the waist (the widest it gets from there up is what a skirt must clear) */
const roundAt = (y: number) => girth(WAIST_Y - y);
const HIP_DEPTH = (() => { let best = 0, at = 0; for (let y = 0; y <= WAIST_Y - TORSO_FOOT; y += 0.5) { const g = roundAt(y); if (g > best) { best = g; at = y; } } return at; })();

export function draft(d0: Design): Skirt {
  const d: Design = { ...d0, length: clamp(d0.length, 10, 62), fullness: clamp(d0.fullness, 1, 4), panels: clamp(Math.round(d0.panels), 1, 12), grain: clamp(d0.grain, 0, 45) };
  const notes: string[] = [];
  const L = d.length, yh = Math.min(HIP_DEPTH, L - 2), waist = roundAt(0), band = waist + 1.5;
  const hipNeed = Math.max(...Array.from({ length: Math.ceil(yh) + 1 }, (_, y) => roundAt(y))) + 4;
  const g = (d.grain * Math.PI) / 180;

  // (the cut: each panel's half-width at a depth, its flare, and what's taken in at the waist; with as many panels as
  // it takes to fit each on the cloth)
  const lay = (n: number) => {
    let cut = cutPanels(d, n, L, yh, band, hipNeed);
    const share = band / n;
    // (the grid: about 2 cm, coarser for a big skirt so the cloth stays a size a phone can move)
    let width = (y: number) => 2 * cut.hw(y);
    const maxW = Math.max(width(0), width(L));
    const area = n * Array.from({ length: 21 }, (_, k) => width((k / 20) * L)).reduce((s, w) => s + w, 0) * (L / 21);
    const h = Math.max(1.9, Math.sqrt((n * maxW * L) / 1600));
    const nv = Math.max(6, Math.round(L / h)), nu = Math.max(4, Math.round(maxW / h));
    let du0 = width(0) / nu;
    // (the folds at the waist, in grid columns: each dart or pleat closes k columns to a point. A fold's a whole
    // number of columns, so the waist's re-cut to make what's left between the folds exactly the band: it must fit)
    let k = cut.foldsPer > 0 ? Math.max(1, Math.round(cut.foldK / du0)) : 0, fp = cut.foldsPer;
    // (a dart no deeper than a dart can be: rounded to columns it may need one more dart)
    if (d.method === 'flare' && fp > 0 && k * du0 > DART_MAX + 0.3) { k = Math.max(1, Math.floor((DART_MAX + 0.3) / du0)); fp = Math.ceil(cut.intake / (k * du0) - 0.15); }
    const kept = nu - fp * k;
    if (fp > 0) { cut = cutPanels(d, n, L, yh, band, hipNeed, (nu * share) / kept / 2); cut.foldsPer = fp; width = (y: number) => 2 * cut.hw(y); du0 = share / kept; }
    return { cut, share, width, area, nu, nv, du0, k, kept };
  };
  // (as many panels as it takes to fit each on the cloth)
  let n = d.panels, lo = lay(n);
  while (n < 12 && acrossGrain(lo.cut.hw, lo.cut.R0, L, g) > BOLT) lo = lay(++n);
  if (n > d.panels) notes.push(`too wide for the cloth in ${d.panels}: cut in ${n} panels`);
  const { cut, share, width, area, nu, nv, du0, k, kept } = lo, { foldsPer, hw, R0, theta, intake, dartLen } = cut;
  const folds: number[] = [];
  for (let p = 0; p < foldsPer; p++) folds.push(clamp(Math.round(((p + 0.5) / foldsPer) * nu - k / 2), 1, nu - k - 1));

  const flat = (u: number, v: number): [number, number] => {
    const y = v * L, r = R0 + y, phi = ((u - 0.5) * width(y)) / r;
    return [r * Math.sin(phi), -(r * Math.cos(phi) - R0)];
  };
  // (laid out round the figure: a surface of revolution whose round at each depth is the panels' width there, and
  // whose height falls by as much as the cloth's length down it allows: nothing's stretched to start with)
  const rho = (y: number) => (n * width(y)) / TAU;
  const drop: number[] = [0];
  for (let j = 1; j <= nv; j++) { const y0 = ((j - 1) / nv) * L, y1 = (j / nv) * L, dr = rho(y1) - rho(y0); drop.push(drop[j - 1] + Math.sqrt(Math.max(0.15 * (y1 - y0) ** 2, (y1 - y0) ** 2 - dr * dr))); }
  const dropAt = (v: number) => { const x = v * nv, j = Math.min(nv - 1, Math.floor(x)); return drop[j] + (drop[j + 1] - drop[j]) * (x - j); };

  const pieces: Piece[] = [];
  const names = n === 1 ? ['skirt'] : n === 2 ? ['front', 'back'] : Array.from({ length: n }, (_, p) => `panel ${p + 1}`);
  for (let p = 0; p < n; p++) {
    pieces.push({
      name: names[p], kind: 'panel', nu, nv, flat, grain: g,
      start: (u, v) => { const a = (TAU * (p + u - 0.5)) / n, r = rho(v * L) + 0.8; return [Math.sin(a) * r, WAIST_Y - dropAt(v), Math.cos(a) * r]; },
    });
  }
  // (the waistband: a straight strip on the straight grain, held round the waist, the panels sewn to it)
  const bu = Math.max(8, Math.round(band / 1.5));
  pieces.push({
    name: 'waistband', kind: 'band', nu: bu, nv: 1, flat: (u, v) => [(u - 0.5) * band, BAND_H * (1 - v)], grain: Math.PI / 2,
    start: (u, v) => bandAt((u - 0.5) * band, WAIST_Y + BAND_H * (1 - v), band),
  });

  // (what's sewn: side seams; and in each panel, its darts (tapering to nothing) or pleats (stitched down a little))
  const pairs: Pair[] = [];
  for (let p = 0; p < n; p++) for (let j = 0; j <= nv; j++) pairs.push({ a: [p, nu, j], b: [(p + 1) % n, 0, j], why: 'side seam' });
  // (no fold closes so far that what's left won't go round the body there: a pleat's stitching lets it out as the
  // hips widen; a dart narrows to nothing)
  for (let j = 1; j <= nv; j++) {
    const y = (j / nv) * L, duj = width(y) / nu;
    const room = Math.floor((n * width(y) - (roundAt(y) + EASE)) / (n * Math.max(1, folds.length) * duj));
    for (const c of folds) {
      if (d.method === 'pleat') {
        const kj = Math.min(k, room);
        if (y <= PLEAT_STITCH + 0.01 && kj >= 1) for (let p = 0; p < n; p++) pairs.push({ a: [p, c, j], b: [p, c + kj, j], why: 'pleat' });
      } else if (y < dartLen) {
        // (its legs sewn together, and what's between them folded flat against the seam, as a dart's pressed)
        const kj = Math.min(Math.round(k * (1 - y / dartLen)), room), a = c + Math.floor((k - kj) / 2);
        if (kj >= 1) for (let p = 0; p < n; p++) for (let q = 1; q <= kj; q++) pairs.push({ a: [p, a, j], b: [p, a + q, j], why: 'dart' });
      }
    }
  }
  // (what's held: each panel's waist edge along its share of the band, its folds closed to a point; the band itself)
  const holds: Hold[] = [];
  for (let p = 0; p < n; p++) {
    let col = 0;
    for (let i = 0; i <= nu; i++) {
      const f = folds.find((c) => i > c && i <= c + k);
      if (f === undefined && i > 0) col++;
      const at = d.method === 'gather' ? (i / nu) * share : (col / kept) * share;
      holds.push({ at: [p, i, 0], s: (p - 0.5) * share + at, y: WAIST_Y });
    }
  }
  for (let i = 0; i <= bu; i++) for (let j = 0; j <= 1; j++) holds.push({ at: [n, i, j], s: (i / bu - 0.5) * band, y: WAIST_Y + BAND_H * (1 - j) });

  // (what the cut needed)
  if (d.method === 'flare') {
    const deg = (theta * n * 180) / Math.PI;
    if (deg >= 359) notes.push('a full circle: as full as a flare can be');
    else if (deg > 2) notes.push(`flared through ${Math.round(deg)}° in all`);
    else notes.push('straight: no flare');
  }
  if (intake > 0.05 && d.method === 'flare') notes.push(`${n * foldsPer} dart${n * foldsPer > 1 ? 's' : ''} take in the waist`);
  if (d.method === 'gather') notes.push(`${(width(0) * n / band).toFixed(1)}× the band, gathered in`);
  if (d.method === 'pleat') notes.push(`${n * foldsPer} pleats, stitched down ${PLEAT_STITCH} cm`);
  if (d.grain >= 30) notes.push('cut on the bias'); else if (d.grain >= 8) notes.push('cut off the grain');

  const sk: Skirt = {
    design: { ...d, panels: n }, pieces, pairs, holds, band, notes, checks: [],
    marks: folds.map((c) => ({ kind: d.method === 'pleat' ? 'pleat' as const : 'dart' as const, c, k, down: d.method === 'pleat' ? Math.min(PLEAT_STITCH, L) : dartLen })),
    m: { waist, hip: hipNeed, hem: n * width(L), length: L, panels: n, darts: d.method === 'flare' ? n * foldsPer : 0, pleats: d.method === 'pleat' ? n * foldsPer : 0, flare: (theta * n * 180) / Math.PI, area: area / 1e4 },
  };
  sk.checks = check(sk, { hw, R0, g, L, yh, n, nu, nv, k, folds, kept, du0, dartLen, method: d.method });
  return sk;
}

/** each panel's shape for n panels: its half-width down it, the radius its flat rows are arcs of, flare, and its folds */
function cutPanels(d: Design, n: number, L: number, yh: number, band: number, hipNeed: number, waistHalf?: number) {
  const shareB = band / n, shareH = hipNeed / n;
  let hw: (y: number) => number, theta = 0, R0 = 1e5, intake = 0, foldsPer = 0, foldK = 0, dartLen = 0;
  if (d.method === 'flare') {
    // (the flare: the hem `fullness` times the hips; a sector from the waist (its apex above), no more than a circle)
    theta = Math.min(TAU / n, ((d.fullness - 1) * hipNeed) / Math.max(4, L - yh) / n);
    const sector = (y: number) => shareB / 2 + (y * theta) / 2;
    // (what it must clear: the hips; a side seam curves in up to SEAM_CURVE, darts take the rest)
    const hipHalf = Math.max(sector(yh), shareH / 2);
    const top = waistHalf ?? Math.max(shareB / 2, hipHalf - SEAM_CURVE - (yh * theta) / 2);
    intake = 2 * (top - shareB / 2);
    if (intake > 0.05) { foldsPer = Math.ceil(intake / DART_MAX); foldK = intake / foldsPer; dartLen = Math.min(yh * 0.85, 7 + foldK * 1.5); }
    hw = (y: number) => {
      if (y >= yh) return hipHalf + ((y - yh) * theta) / 2;
      const t = y / yh, curve = 1 - (1 - t) * (1 - t);
      // (a piece can't wrap past a whole circle: a one-piece circle skirt's rows stop at it)
      return Math.min(Math.max(sector(y), top + (hipHalf - top) * curve, y > 1.5 ? (roundAt(y) + EASE) / (2 * n) : 0), (R0 + y) * Math.PI * 0.999);
    };
    if (theta > 1e-4) R0 = shareB / theta;
  } else {
    // (straight width, `fullness` times the hips, taken in at the waist)
    const W = waistHalf ? 2 * waistHalf : Math.max(shareH, d.fullness * shareH);
    hw = () => W / 2;
    intake = W - shareB;
    if (d.method === 'pleat' && intake > 0.5) {
      foldsPer = Math.max(1, Math.round(shareB / 4.5));
      foldK = intake / foldsPer;
    }
  }
  return { hw, theta, R0, intake, foldsPer, foldK, dartLen };
}

/** the widest a panel is across its grain (the cloth's width runs across the warp) */
function acrossGrain(hw: (y: number) => number, R0: number, L: number, g: number) {
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j <= 24; j++) for (let i = 0; i <= 24; i++) {
    const y = (j / 24) * L, r = R0 + y, phi = ((i / 24 - 0.5) * 2 * hw(y)) / r, x = r * Math.sin(phi), yy = -(r * Math.cos(phi) - R0);
    const a = x * Math.cos(g) - yy * Math.sin(g);
    lo = Math.min(lo, a); hi = Math.max(hi, a);
  }
  return hi - lo;
}

/** a point on the waistband, `s` cm round it from the front centre (round the waist's own ellipse, by arc length) */
const ARC: number[] = [];
const ARC_N = 256;
{
  const s0 = sectionAtWaist();
  let acc = 0; ARC.push(0);
  for (let k = 1; k <= ARC_N; k++) { const a0 = ((k - 1) / ARC_N) * TAU, a1 = (k / ARC_N) * TAU; acc += Math.hypot(Math.sin(a1) * s0.rx - Math.sin(a0) * s0.rx, Math.cos(a1) * s0.rz - Math.cos(a0) * s0.rz); ARC.push(acc); }
}
function sectionAtWaist() { return section(WAIST_Y); }
export function bandAt(s: number, y: number, band: number, out = 0.75): V3 {
  const total = ARC[ARC_N], t = (((s / band) % 1) + 1) % 1 * total;
  let lo = 0, hi = ARC_N;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ARC[m] <= t) lo = m; else hi = m; }
  const a = ((lo + (t - ARC[lo]) / Math.max(1e-6, ARC[lo + 1] - ARC[lo])) / ARC_N) * TAU, s0 = sectionAtWaist();
  return [Math.sin(a) * (s0.rx + out), y, s0.cz + Math.cos(a) * (s0.rz + out)];
}

// ─── checking the pattern ──────────────────────────────────────────────────────────────────────
function check(sk: Skirt, c: { hw: (y: number) => number; R0: number; g: number; L: number; yh: number; n: number; nu: number; nv: number; k: number; folds: number[]; kept: number; du0: number; dartLen: number; method: Method }): Check[] {
  const out: Check[] = [], P = sk.pieces[0];
  const len = (pts: Array<[number, number]>) => pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);
  const edge = (u: number) => Array.from({ length: 41 }, (_, j) => P.flat(u, j / 40));
  // (1: every side seam's two edges the same length, so they can be sewn without easing)
  const l0 = len(edge(0)), l1 = len(edge(1));
  out.push({ name: 'side seams match', ok: Math.abs(l0 - l1) / l1 < 0.01, detail: `${l1.toFixed(1)} cm and ${l0.toFixed(1)} cm` });
  // (2: the waist edge, its folds closed, fits the band)
  const closed = c.n * (c.method === 'gather' ? 0 : 1) * c.kept * c.du0, fit = c.method === 'gather' ? 1 : closed / sk.band;
  out.push({ name: 'waist fits the band', ok: Math.abs(fit - 1) < 0.04, detail: c.method === 'gather' ? `${(c.n * c.nu * c.du0).toFixed(1)} cm eased into ${sk.band.toFixed(1)} cm` : `${closed.toFixed(1)} cm sewn to ${sk.band.toFixed(1)} cm (${((fit - 1) * 100).toFixed(1)}%)` });
  // (3: it clears the body all the way down to the hips: its round at each row, with what's sewn closed there taken
  // out, at least the body's)
  let worst = Infinity, at = 0;
  for (let j = 1; j <= c.nv; j++) {
    const y = (j / c.nv) * c.L;
    if (y > c.yh + 0.01) break;
    let w = 2 * c.hw(y);
    for (const q of sk.pairs) if (q.why !== 'side seam' && q.a[0] === 0 && q.a[2] === j) w -= ((q.b[1] - q.a[1]) * 2 * c.hw(y)) / c.nu;
    const spare = c.n * w - roundAt(y) - EASE;
    if (spare < worst) { worst = spare; at = y; }
  }
  out.push({ name: 'clears the hips', ok: worst >= -0.05, detail: `${(worst + EASE).toFixed(1)} cm of ease at its tightest (${at.toFixed(0)} cm down; ${EASE} needed)` });
  // (4: each piece fits on the cloth, along its grain)
  const across = acrossGrain(c.hw, c.R0, c.L, c.g);
  out.push({ name: 'fits on the cloth', ok: across <= BOLT + 0.5, detail: `${across.toFixed(0)} cm across the grain, of ${BOLT}` });
  // (5: darts a dressmaker could sew: no deeper than 3 cm, ending above the hips)
  if (c.method === 'flare' && c.folds.length) {
    const deep = c.k * c.du0;
    out.push({ name: 'darts sewable', ok: deep <= DART_MAX + 0.6 && c.dartLen <= c.yh + 0.01, detail: `${c.folds.length * c.n} darts, ${deep.toFixed(1)} cm deep, ${c.dartLen.toFixed(1)} cm long` });
  }
  // (6: the piece is a simple shape: rows widen and keep their order, no row wraps past a full circle)
  let simple = true;
  for (let j = 0; j <= c.nv; j++) { const y = (j / c.nv) * c.L; if (!(c.hw(y) > 0) || (2 * c.hw(y)) / (c.R0 + y) > TAU * 1.001) simple = false; }
  out.push({ name: 'a simple outline', ok: simple, detail: simple ? 'no row folds back on itself' : 'a row overlaps itself' });
  return out;
}

/** what the cloth needs of a skirt: its pieces, what's sewn, and where its held points are on the figure */
export function toBuild(sk: Skirt, fabric: Fabric) {
  return { pieces: sk.pieces, pairs: sk.pairs, holds: sk.holds.map((h) => ({ at: h.at, p: bandAt(h.s, h.y, sk.band) })), fabric };
}

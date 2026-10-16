/**
 * Pattern making, for one family of garment: the skirt: flat pieces, cut, joined round a body and hung from one line
 * (the waist). Nearly every move a dressmaker has shows in it.
 *
 * A skirt's a **recipe**: its length, how many panels, where on the grain they're cut, its cloth and print, and the
 * **moves** made on a panel's paper (cut.ts): slash and spread, fold a pleat, add width and gather it, close a dart
 * into flare or release it. Every panel's cut the same. Drafting starts from the straight skirt block drafted to the
 * figure (side seams curved in as far as a seam can, darts for the rest: fewer panels, more darts) and makes the moves
 * in order.
 *
 * What follows from the cut, as on a cutting table:
 * - what's sewn: side seams; darts, tapering to their points (one closed into flare is sewn shut above its point);
 *   pleats, stitched a little way down, but never so far that what's left won't go round the hips;
 * - how the waist meets its band: what's cloth is sewn to it, what's a fold or a dart is closed to a point, what's
 *   gathered is eased in (the ease declared on that seam, as GarmentCode does). A waist cut longer than its band with
 *   nothing to take it in is eased in all round, and the check says so;
 * - checks of the pattern itself: side seams the same length; the waist fits its band; it clears the hips with
 *   wearing ease; each piece fits across the cloth along its grain; darts a dressmaker could sew; paper that doesn't
 *   overlap itself; every move could be made.
 *
 * Silhouette, folds and swing are never set: they're what the simulated cloth does with the cut.
 *
 * The older way in (`Design`: a length, a fullness and a way of making it) is kept as a shortcut that writes moves:
 * the dials, the workshop's rail and the evidence bench go through it, so they test the same cutting.
 *
 * A skirt's also a component of other garments (garment.ts): a dress's skirt is cut to its bodice's hem rather than its
 * own waistband (`band`), and sewn to it. `Design` carries the other families' fields too.
 */
import { TORSO_FOOT, WAIST_Y, girth, section, type V3 } from './body';
import type { Fabric } from './fabric';
import { apply, block, outline, ribAt, selfOverlaps, stripWidths, widthAt, type Move, type Panel, type Rib } from './cut';
import type { At as At0, Check as Check0, Piece as Piece0 } from './edges';
export type { Move } from './cut';

export type Method = 'flare' | 'gather' | 'pleat';
/** what's made: a skirt; a top (a bodice, its neckline, sleeves and collar); a dress (a bodice sewn to a skirt at the
 * waist); trousers; a jumpsuit (a bodice sewn to trousers) */
export type Family = 'skirt' | 'top' | 'dress' | 'trousers' | 'jumpsuit';
export type Neck = 'round' | 'v' | 'square' | 'boat' | 'scoop';
export type SleeveCut = 'plain' | 'puff' | 'bell';
export type Collar = 'none' | 'peterpan' | 'band' | 'frill';
export interface Design {
  family: Family;
  /** skirts: tiers, each gathered onto the hem of the one above (1: none) */
  tiers: number;
  /** tops: cm below the waist the hem comes (less than 0: cropped above it) */
  bodyLen: number;
  /** tops: wearing ease round the chest, cm (snug 4 → roomy 16) */
  ease: number;
  /** tops: how much wider the hem is than the chest (1 straight, 1.6 a swing top) */
  swing: number;
  neck: Neck;
  /** tops: cm lower (or higher, below 0) the front neckline is than its own shape's usual */
  neckDepth: number;
  /** tops: cm of sleeve down the arm from the armhole (0: sleeveless) */
  sleeveLen: number;
  sleeve: SleeveCut;
  collar: Collar;
  /** trousers: cm of leg below the crotch (shorts 5 → full length 33) */
  legLen: number;
  /** trousers: room in the leg (1 slim → 2 wide) */
  legWidth: number;
  /** trousers: the hem's width over the knee's (0.8 tapered → 1.8 flared) */
  flare: number;
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
export const DEFAULT_DESIGN: Design = {
  family: 'skirt', length: 34, fullness: 2.2, method: 'flare', panels: 4, grain: 0, fabric: 'lawn', print: 2, colour: 1, tiers: 1,
  bodyLen: 8, ease: 8, swing: 1.15, neck: 'round', neckDepth: 0, sleeveLen: 8, sleeve: 'plain', collar: 'none',
  legLen: 26, legWidth: 1.3, flare: 1,
};

/** a point of a piece's grid: piece, column, row */
export type At = At0;
/** a piece: a grid over its flat shape (x across, y up: down the skirt is negative), its grain, and where it's laid out
 * round the figure before it's sewn (for a skirt's panels, on a surface they lie on without stretching) (edges.ts) */
export type Piece = Piece0;
export interface Pair { a: At; b: At; why: 'side seam' | 'dart' | 'pleat' }
/** a point held on the waistband: `s` cm round it from the front, `y` its height */
export interface Hold { at: At; s: number; y: number }
export type Check = Check0;
/** a skirt as made: its length, panels, grain (degrees off straight), cloth, print, and the moves made on a panel */
export interface Recipe {
  length: number; panels: number; grain: number; fabric: string; print: number; colour: number; moves: Move[];
  /** the round its waist is sewn to, if not its own waistband's: a dress's skirt, cut to its bodice's hem (so the paper,
   * the dials and the garment all cut the same skirt) */
  band?: number;
  /** made one's own: the cloth's qualities changed from its swatch's, the palette's inks, the print's scale */
  cloth?: Partial<import('./fabric').Fabric>; inks?: [string, string, string]; printScale?: number;
}
export interface Skirt {
  recipe: Recipe; pieces: Piece[]; pairs: Pair[]; holds: Hold[];
  band: number; notes: string[]; checks: Check[];
  /** a panel's paper as cut, and which strip each grid column's in */
  cut: Panel; cols: number[];
  /** each move: could it be made? */
  made: boolean[];
  m: { waist: number; hip: number; hem: number; length: number; panels: number; darts: number; pleats: number; fullness: number; area: number; gathered: number };
}

/** wearing ease: how much bigger round than the body a skirt must be anywhere it's sewn closed (its own thickness off
 * the body, and room to move) */
export const BOLT = 140, SEAM_CURVE = 2, DART_MAX = 3, BAND_H = 2.5, EASE = 4;
const TAU = Math.PI * 2;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** the body's round at a depth below the waist (the widest it gets from there up is what a skirt must clear) */
export const roundAt = (y: number) => girth(WAIST_Y - y);
export const HIP_DEPTH = (() => { let best = 0, at = 0; for (let y = 0; y <= WAIST_Y - TORSO_FOOT; y += 0.5) { const g = roundAt(y); if (g > best) { best = g; at = y; } } return at; })();

/** the figure's measurements a skirt's drafted to: its band, the hips it must clear, how far down they are */
function measures(L: number, round?: number) {
  const yh = Math.min(HIP_DEPTH, L - 2), waist = roundAt(0), band = round ?? waist + 1.5;
  const hip = Math.max(...Array.from({ length: Math.ceil(yh) + 1 }, (_, y) => roundAt(y))) + EASE;
  return { yh, waist, band, hip };
}
const clampRecipe = (r: Recipe): Recipe => ({ ...r, length: clamp(r.length, 10, 62), panels: clamp(Math.round(r.panels), 1, 12), grain: clamp(r.grain, 0, 45), moves: r.moves ?? [] });
/** a panel of a recipe: its block, and its moves made (`band`: the round its waist's sewn to, if not its own band's) */
export function cutOf(r0: Recipe, band = r0.band) {
  const r = clampRecipe(r0), M = measures(r.length, band);
  const base = block({ L: r.length, waist: M.band / r.panels, hip: M.hip / r.panels, hipDepth: M.yh, seamCurve: SEAM_CURVE, dartMax: DART_MAX });
  return { r, M, base, ...apply(base, r.moves) };
}

/** `budget`: about how many points of cloth it should come to (fewer for one hanging on a rail). `band`: the round its
 * waist is sewn to, if not its own waistband's (a dress's bodice hem) */
export function draftRecipe(r0: Recipe, budget = 1600, o: { band?: number } = {}): Skirt {
  const { r, M, panel, ok: made, notes: moveNotes } = cutOf(r0, o.band ?? r0.band);
  const L = r.length, n = r.panels, share = M.band / n, g = (r.grain * Math.PI) / 180;
  const notes: string[] = [...moveNotes];

  // (the grid. Paper that's one piece (cloth, and what's been slashed and spread or a dart closed into it: taped back
  // into one) is a region, meshed with rulings from waist to hem evenly spaced along each, as a polar grid is; what's
  // structure (a fold, a dart still sewn) is its own region, so its edges fall on columns. About 2 cm, coarser for a
  // big skirt so the cloth stays a size a phone can move.)
  const W0 = widthAt(panel, 0, L).w, W1 = widthAt(panel, 1, L).w, maxW = Math.max(W0, W1);
  const h = Math.max(1.9, Math.sqrt((n * maxW * L) / budget));
  const nv = Math.max(6, Math.round(L / h));
  const regions: Region[] = [];
  panel.strips.forEach((st, k) => {
    const joins = st.kind === 'cloth' || st.kind === 'wedge' || st.kind === 'ease', last = regions[regions.length - 1];
    if (joins && last?.kind === 'cloth') last.k1 = k;
    else regions.push({ kind: joins ? 'cloth' : st.kind === 'pleat' ? 'pleat' : 'dart', k0: k, k1: k, cols: 1, stitch: st.stitch });
  });
  for (const rg of regions) {
    const line = (e: 'top' | 'knee' | 'bottom') => polyLen(panel.ribs.slice(rg.k0, rg.k1 + 2).map((r) => r[e]));
    rg.cols = rg.kind === 'dart' ? 1 : Math.max(1, Math.round(Math.max(line('top'), line('knee'), line('bottom')) / h));
  }
  const cum = [0]; for (const rg of regions) cum.push(cum[cum.length - 1] + rg.cols);
  const nu = cum[cum.length - 1];
  const regionOf = (x: number) => { let r = 0; while (r < regions.length - 1 && x > cum[r + 1] - 1e-9) r++; return r; };
  const cols: number[] = Array.from({ length: nu + 1 }, (_, i) => regionOf(Math.min(i, nu - 1e-6)));
  /** a ruling a fraction f across region rg: through its waist, its knees and its hem, each at f of the way along by length */
  const ruling = (rg: Region, f: number): Rib => {
    const at = (e: 'top' | 'knee' | 'bottom') => alongPoly(panel.ribs.slice(rg.k0, rg.k1 + 2).map((r) => r[e]), f);
    return { top: at('top'), knee: at('knee'), bottom: at('bottom') };
  };
  const flat = (u: number, v: number): [number, number] => {
    const x = u * nu, r = regionOf(Math.min(x, nu - 1e-6)), rg = regions[r];
    return ribAt(ruling(rg, Math.max(0, Math.min(1, (x - cum[r]) / rg.cols))), v);
  };
  // (each row's length across, column by column, for laying it out round the figure)
  const rows = Array.from({ length: nv + 1 }, (_, j) => {
    const pts = Array.from({ length: nu + 1 }, (_, i) => flat(i / nu, j / nv)), acc = [0];
    for (let i = 1; i <= nu; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { acc, w: acc[nu] };
  });

  // (laid out round the figure: a surface of revolution whose round at each depth is the panels' width there, and
  // whose height falls by as much as the cloth's length down it allows: nothing's stretched to start with)
  const rho = (j: number) => (n * rows[j].w) / TAU;
  const drop: number[] = [0];
  for (let j = 1; j <= nv; j++) { const dy = L / nv, dr = rho(j) - rho(j - 1); drop.push(drop[j - 1] + Math.sqrt(Math.max(0.15 * dy * dy, dy * dy - dr * dr))); }
  const rowAt = (v: number) => Math.min(nv, Math.max(0, Math.round(v * nv)));

  const pieces: Piece[] = [];
  const names = n === 1 ? ['skirt'] : n === 2 ? ['front', 'back'] : Array.from({ length: n }, (_, p) => `panel ${p + 1}`);
  for (let p = 0; p < n; p++) {
    pieces.push({
      name: names[p], kind: 'panel', nu, nv, flat, grain: g,
      start: (u, v) => {
        const j = rowAt(v), row = rows[j], x = u * nu, i0 = Math.min(nu - 1, Math.floor(x));
        const f = (row.acc[i0] + (row.acc[i0 + 1] - row.acc[i0]) * (x - i0)) / Math.max(1e-6, row.w), a = (TAU * (p + f - 0.5)) / n, rr = rho(j) + 0.8;
        return [Math.sin(a) * rr, WAIST_Y - drop[j], Math.cos(a) * rr];
      },
    });
  }
  // (the waistband: a straight strip on the straight grain, held round the waist, the panels sewn to it)
  const bu = Math.max(8, Math.round(M.band / 1.5));
  pieces.push({
    name: 'waistband', kind: 'band', nu: bu, nv: 1, flat: (u, v) => [(u - 0.5) * M.band, BAND_H * (1 - v)], grain: Math.PI / 2,
    start: (u, v) => bandAt((u - 0.5) * M.band, WAIST_Y + BAND_H * (1 - v), M.band),
  });

  // (what's sewn: side seams; darts, tapering to their points; a closed dart above its point; pleats' stitching. No
  // fold closes so far that what's left won't go round the body there.)
  const pairs: Pair[] = [];
  for (let p = 0; p < n; p++) for (let j = 0; j <= nv; j++) pairs.push({ a: [p, nu, j], b: [(p + 1) % n, 0, j], why: 'side seam' });
  for (let j = 1; j <= nv; j++) {
    const y = (j / nv) * L;
    // (a pleat's stitching lets it out where what's left wouldn't go round the hips)
    let closing = 0;
    regions.forEach((rg, r) => { if ((rg.kind === 'pleat' && y <= (rg.stitch ?? 0) + 0.01) || rg.kind === 'dart') closing += rows[j].acc[cum[r + 1]] - rows[j].acc[cum[r]]; });
    const room = y > M.yh || n * (rows[j].w - closing) - (roundAt(y) + EASE) >= 0;
    regions.forEach((rg, r) => {
      const a = cum[r], b = cum[r + 1];
      if (rg.kind === 'pleat' && y <= (rg.stitch ?? 0) + 0.01 && room) for (let p = 0; p < n; p++) pairs.push({ a: [p, a, j], b: [p, b, j], why: 'pleat' });
      // (a dart's legs sewn down to its point; below it they're one line, sewn as one)
      if (rg.kind === 'dart') for (let p = 0; p < n; p++) pairs.push({ a: [p, a, j], b: [p, b, j], why: 'dart' });
    });
  }
  // (how the waist meets its band: cloth sewn to it; folds and darts closed to a point; what's gathered eased in. Ease
  // is declared on the seam, as a ratio, not cut into the cloth)
  let C = 0, E = 0;
  panel.strips.forEach((st, k) => { const w = stripWidths(panel, k).top; if (st.kind === 'cloth' || st.kind === 'wedge') C += w; else if (st.kind === 'ease') E += w; });
  // (cloth's sewn flat to the band and the gathers take what's left of it; if the cloth fills it already, it's all
  // gathered evenly, as a dirndl is)
  let rc = 1, re = 1;
  if (E > 0 && C < share - 0.5) { re = (share - C) / E; rc = 1; if (re > 1) { re = 1; rc = share / (C + E); } }
  else { rc = share / Math.max(1e-6, C + E); re = rc; }
  // (each waist point's place on the band: along its region's waist, cloth counted as cut, gathers eased, folds and
  // darts closed to where they start)
  const ratio = (k: number) => { const st = panel.strips[k].kind; return st === 'ease' ? re : st === 'cloth' || st === 'wedge' ? rc : 0; };
  const bandPos: number[] = [];
  let base = 0;
  regions.forEach((rg, r) => {
    const tops = panel.ribs.slice(rg.k0, rg.k1 + 2).map((rb) => rb.top), segs = tops.slice(1).map((q, i) => Math.hypot(q[0] - tops[i][0], q[1] - tops[i][1])), total = segs.reduce((a, b) => a + b, 0);
    for (let c = r === 0 ? 0 : 1; c <= rg.cols; c++) {
      let d = (c / rg.cols) * total, pos = 0;
      for (let q = 0; q < segs.length && d > 0; q++) { const take = Math.min(d, segs[q]); pos += take * ratio(rg.k0 + q); d -= take; }
      bandPos.push(base + pos);
    }
    for (let q = 0; q < segs.length; q++) base += segs[q] * ratio(rg.k0 + q);
  });
  const holds: Hold[] = [];
  for (let p = 0; p < n; p++) for (let i = 0; i <= nu; i++) holds.push({ at: [p, i, 0], s: (p - 0.5) * share + bandPos[i], y: WAIST_Y });
  for (let i = 0; i <= bu; i++) for (let j = 0; j <= 1; j++) holds.push({ at: [n, i, j], s: (i / bu - 0.5) * M.band, y: WAIST_Y + BAND_H * (1 - j) });

  // (what the cut came to)
  const count = (kind: string) => panel.strips.filter((st) => st.kind === kind).length;
  const hem = n * W1, fullness = hem / M.hip, gathered = E > 0 ? (C + E) / share : 1;
  const area = n * polyArea(outline(panel, 8));
  if (count('wedge')) notes.push(fullness >= 3.3 ? 'as full as a circle' : `flared ${fullness.toFixed(1)}× round at the hem`);
  if (count('dart')) notes.push(`${n * count('dart')} dart${n * count('dart') > 1 ? 's' : ''} take in the waist`);
  if (count('pleat')) notes.push(`${n * count('pleat')} pleats`);
  if (E > 0) notes.push(`${gathered.toFixed(1)}× the band, gathered in`);
  else if (Math.abs(rc - 1) > 0.04) notes.push(rc < 1 ? `the waist's ${((C + E) * n - M.band).toFixed(0)} cm longer than its band: it's eased in all round (gather it, pleat it or dart it?)` : `the waist's ${(M.band - (C + E) * n).toFixed(0)} cm short of its band`);
  if (r.grain >= 30) notes.push('cut on the bias'); else if (r.grain >= 8) notes.push('cut off the grain');

  const sk: Skirt = {
    recipe: r, pieces, pairs, holds, band: M.band, notes, checks: [], cut: panel, cols, made,
    m: { waist: M.waist, hip: M.hip, hem, length: L, panels: n, darts: n * count('dart'), pleats: n * count('pleat'), fullness, area: area / 1e4, gathered },
  };
  sk.checks = check(sk, { g, L, yh: M.yh, n, nu, nv, rc, re, E, share, rows });
  return sk;
}
interface Region { kind: 'cloth' | 'pleat' | 'dart'; k0: number; k1: number; cols: number; stitch?: number }
const polyLen = (q: Array<[number, number]>) => q.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - q[i][0], p[1] - q[i][1]), 0);
/** a point a fraction f along a polyline by length */
function alongPoly(q: Array<[number, number]>, f: number): [number, number] {
  const total = polyLen(q); let d = f * total;
  for (let i = 1; i < q.length; i++) {
    const l = Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
    if (d <= l || i === q.length - 1) { const t = l > 1e-9 ? Math.min(1, d / l) : 0; return [q[i - 1][0] + (q[i][0] - q[i - 1][0]) * t, q[i - 1][1] + (q[i][1] - q[i - 1][1]) * t]; }
    d -= l;
  }
  return q[0];
}
const polyArea = (o: Array<[number, number]>) => Math.abs(o.reduce((s, p, i) => { const q = o[(i + 1) % o.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

/** the older way in: a length, a fullness and a way of making it, written as moves on the block, as a cutter would:
 * flare by closing the darts into the hem and slashing and spreading for the rest; gathers by releasing the darts and
 * adding width; pleats by adding folds. Cut in more panels if one won't go across the cloth. */
export function fromDesign(d: Design, band?: number): Recipe {
  const base: Recipe = { length: clamp(d.length, 10, 62), panels: clamp(Math.round(d.panels), 1, 12), grain: clamp(d.grain, 0, 45), fabric: d.fabric, print: d.print, colour: d.colour, moves: [], ...(band ? { band } : {}) };
  const write = (n: number): Recipe => {
    const r: Recipe = { ...base, panels: n, moves: [] }, { M, base: blk } = cutOf(r, band), share = M.band / n, hipShare = M.hip / n, darts = blk.strips.filter((s) => s.kind === 'dart').length;
    const F = clamp(d.fullness, 1, 4);
    if (d.method === 'flare') {
      if (F >= 1.2) for (let k = 0; k < darts; k++) r.moves.push({ kind: 'close-dart', dart: 0 });
      const now = widthAt(cutOf(r, band).panel, 1, r.length).w, want = (F * M.hip) / n, more = want - now;
      if (more > 0.5) {
        const cuts = clamp(Math.round(more / 14), 1, 5);
        // (each slash measured on the hem as it is by then: the ones already opened have lengthened it)
        const hem0 = now;
        for (let c = 0; c < cuts; c++) r.moves.push({ kind: 'spread', at: (((c + 0.5) / cuts) * hem0 + (c * more) / cuts) / (hem0 + (c * more) / cuts), open: more / cuts });
      }
    } else if (d.method === 'gather') {
      for (let k = 0; k < darts; k++) r.moves.push({ kind: 'release-dart', dart: 0 });
      const add = Math.max(0, F * hipShare - widthAt(cutOf(r, band).panel, 0, r.length).w);
      const w0 = stripWaist(cutOf(r, band).panel);
      if (add > 0.5) [0.2, 0.5, 0.8].forEach((at, c) => r.moves.push({ kind: 'gather', at: (at * w0 + (c * add) / 3) / (w0 + (c * add) / 3), add: add / 3 }));
    } else {
      const folds = Math.max(1, Math.round(share / 4.5)), add = Math.max(0, F * hipShare - widthAt(cutOf(r, band).panel, 0, r.length).w);
      // (evenly along the waist as cut: each fold measured on the waist as it is by then, the ones already made added in)
      const w0 = stripWaist(cutOf(r, band).panel);
      if (add > 0.5) for (let c = 0; c < folds; c++) r.moves.push({ kind: 'pleat', at: (((c + 0.5) / folds) * w0 + (c * add) / folds) / (w0 + (c * add) / folds), depth: add / folds / 2 });
    }
    // (no more than the paper will take: a panel spread round past itself can't be cut)
    for (let tries = 0; tries < 30 && selfOverlaps(cutOf(r, band).panel); tries++) r.moves = r.moves.map((m) => (m.kind === 'spread' ? { ...m, open: m.open * 0.9 } : m));
    return r;
  };
  let n = base.panels, r = write(n);
  while (n < 12 && across(r) > BOLT) r = write(++n);
  return r;
}
/** a panel's waist edge, its whole length as cut (folds and darts too) */
const stripWaist = (p: Panel) => p.strips.reduce((a, _, k) => a + stripWidths(p, k).top, 0);
/** how wide a panel is across the cloth's grain (the bolt's width runs across the warp) */
function across(r: Recipe) {
  const { panel } = cutOf(r), g = (r.grain * Math.PI) / 180;
  let lo = Infinity, hi = -Infinity;
  for (const q of outline(panel, 8)) { const a = q[0] * Math.cos(g) - q[1] * Math.sin(g); lo = Math.min(lo, a); hi = Math.max(hi, a); }
  return hi - lo;
}
/** the older way in, drafted */
export function draft(d: Design, budget = 1600, o: { band?: number } = {}): Skirt { return draftRecipe(fromDesign(d, o.band), budget, o); }
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
function check(sk: Skirt, c: { g: number; L: number; yh: number; n: number; nu: number; nv: number; rc: number; re: number; E: number; share: number; rows: Array<{ acc: number[]; w: number }> }): Check[] {
  const out: Check[] = [], P = sk.cut, last = P.ribs.length - 1;
  const ribLen = (k: number) => { const r = P.ribs[k]; return Math.hypot(r.knee[0] - r.top[0], r.knee[1] - r.top[1]) + Math.hypot(r.bottom[0] - r.knee[0], r.bottom[1] - r.knee[1]); };
  // (1: every side seam's two edges the same length, so they can be sewn without easing)
  const l0 = ribLen(0), l1 = ribLen(last);
  out.push({ name: 'side seams match', ok: Math.abs(l0 - l1) / l1 < 0.01, detail: `${l1.toFixed(1)} cm and ${l0.toFixed(1)} cm` });
  // (2: the waist fits its band: sewn to it as cut (eased no more than 4%), or gathered into it (never stretched))
  const ok2 = c.E > 0 ? c.re <= 1.0001 && c.rc <= 1.04 : Math.abs(c.rc - 1) < 0.04;
  out.push({ name: 'waist fits the band', ok: ok2, detail: c.E > 0 ? (c.re <= 1.0001 ? `gathered ${(1 / c.re).toFixed(2)}× into it` : 'too little to gather: the waist is short of its band') : `${((1 / c.rc - 1) * 100).toFixed(1)}% to ease in` });
  // (3: it clears the body down to the hips: its round at each row, what's sewn closed there taken out, at least the
  // body's and its wearing ease)
  let worst = Infinity, at = 0;
  // (what's sewn closed at each row of the first panel: the widest each fold or dart closes there)
  const shut = new Map<number, Map<number, number>>();
  for (const q of sk.pairs) {
    if (q.why === 'side seam' || q.a[0] !== 0 || (q.a[2] / c.nv) * c.L > c.yh + 0.01) continue;
    const row = shut.get(q.a[2]) ?? new Map<number, number>(); shut.set(q.a[2], row);
    const fa = sk.pieces[0].flat(q.a[1] / c.nu, q.a[2] / c.nv), fb = sk.pieces[0].flat(q.b[1] / c.nu, q.a[2] / c.nv), d = Math.hypot(fa[0] - fb[0], fa[1] - fb[1]);
    row.set(q.a[1], Math.max(row.get(q.a[1]) ?? 0, d));
  }
  for (let j = 1; j <= c.nv; j++) {
    const y = (j / c.nv) * c.L;
    if (y > c.yh + 0.01) break;
    let w = c.rows[j].w;
    for (const d of shut.get(j)?.values() ?? []) w -= d;
    const spare = c.n * w - roundAt(y) - EASE;
    if (spare < worst) { worst = spare; at = y; }
  }
  out.push({ name: 'clears the hips', ok: worst >= -0.05, detail: `${(worst + EASE).toFixed(1)} cm of ease at its tightest (${at.toFixed(0)} cm down; ${EASE} needed)` });
  // (4: each piece fits on the cloth, along its grain)
  const ac = across(sk.recipe);
  out.push({ name: 'fits on the cloth', ok: ac <= BOLT + 0.5, detail: `${ac.toFixed(0)} cm across the grain, of ${BOLT}` });
  // (5: darts a dressmaker could sew: no deeper than 3 cm (and a bit), their points above the hips)
  const darts = P.strips.map((s, k) => (s.kind === 'dart' ? k : -1)).filter((k) => k >= 0);
  if (darts.length) {
    const deep = Math.max(...darts.map((k) => stripWidths(P, k).top)), long = Math.max(...darts.map((k) => -P.ribs[k].knee[1]));
    out.push({ name: 'darts sewable', ok: deep <= DART_MAX + 0.6 && long <= c.yh + 0.5, detail: `${darts.length * c.n} darts, ${deep.toFixed(1)} cm deep, ${long.toFixed(1)} cm long` });
  }
  // (6: the paper doesn't overlap itself (a panel spread round past itself can't be cut))
  const over = selfOverlaps(P);
  out.push({ name: 'a simple outline', ok: !over, detail: over ? 'the paper overlaps itself: spread less, or cut more panels' : 'the paper lies flat without overlapping' });
  // (7: every move could be made)
  const unmade = sk.made.filter((m) => !m).length;
  if (sk.made.length) out.push({ name: 'every move made', ok: unmade === 0, detail: unmade ? `${unmade} of ${sk.made.length} did nothing here` : `${sk.made.length} move${sk.made.length > 1 ? 's' : ''}` });
  return out;
}

/** what the cloth needs of a skirt: its pieces, what's sewn, and where its held points are on the figure */
export function toBuild(sk: Skirt, fabric: Fabric) {
  return { pieces: sk.pieces, pairs: sk.pairs, holds: sk.holds.map((h) => ({ at: h.at, p: bandAt(h.s, h.y, sk.band) })), fabric };
}

/** a skirt hung up: its waistband held flat in a hanger's two clips, the skirt below it, the waist at y = 0 */
export function toHangerBuild(sk: Skirt, fabric: Fabric) {
  // (the band, flattened: an ellipse 1.6 cm deep whose round is the band's)
  const rz = 1.6, round = (a: number) => { const h = ((a - rz) / (a + rz)) ** 2; return Math.PI * (a + rz) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))); };
  let lo = rz, hi = sk.band; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (round(m) < sk.band) lo = m; else hi = m; }
  const loop = byArc(lo, rz), at = (s: number, y: number): V3 => { const [x, z] = loop(s / sk.band); return [x, y, z]; };
  return {
    pieces: sk.pieces.map((p) => ({ ...p, start: (u: number, v: number): V3 => { const q = p.start(u, v); return [q[0], q[1] - WAIST_Y, q[2]]; } })),
    pairs: sk.pairs, holds: sk.holds.map((h) => ({ at: h.at, p: at(h.s, h.y - WAIST_Y) })), fabric, collider: null, floor: false,
  };
}

/** a skirt in plain words: "a knee-length flared skirt" */
export function describe(x: Design | Recipe): string {
  const r = 'moves' in x ? x : fromDesign(x), sk = cutOf(r), L = r.length, n = r.panels;
  const len = L < 22 ? 'mini' : L < 36 ? 'knee-length' : L < 50 ? 'midi' : 'maxi', has = (k: string) => sk.panel.strips.some((s) => s.kind === k);
  const full = (n * widthAt(sk.panel, 1, L).w) / sk.M.hip;
  const how = has('pleat') ? 'pleated' : has('ease') && full > 1.3 ? 'gathered' : full >= 3.3 ? 'circle' : full > 1.15 ? 'flared' : 'straight';
  return `a ${len} ${how}${r.grain > 30 ? ', bias-cut' : ''} skirt`;
}

/** a point on an ellipse (half-widths rx across, rz deep) a fraction of the way round it by length, from the front */
function byArc(rx: number, rz: number) {
  const N = 256, acc = [0];
  for (let k = 1; k <= N; k++) { const a0 = ((k - 1) / N) * TAU, a1 = (k / N) * TAU; acc.push(acc[k - 1] + Math.hypot((Math.sin(a1) - Math.sin(a0)) * rx, (Math.cos(a1) - Math.cos(a0)) * rz)); }
  return (f: number): [number, number] => {
    const t = (((f % 1) + 1) % 1) * acc[N];
    let lo = 0, hi = N;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (acc[m] <= t) lo = m; else hi = m; }
    const a = ((lo + (t - acc[lo]) / Math.max(1e-9, acc[lo + 1] - acc[lo])) / N) * TAU;
    return [Math.sin(a) * rx, Math.cos(a) * rz];
  };
}

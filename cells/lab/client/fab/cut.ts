/**
 * The cutting table: a skirt panel as a pattern cutter works it. A **block** (the dressmaker's straight skirt block,
 * drafted to the figure, darts and all) and a **history** of moves made on the paper, applied in order:
 *
 * - **spread** (scissors): slash from the hem up to the waist, leaving a hinge, and open the hem by so much: flare;
 * - **pleat** (fold): slash down from the waist, spread it parallel, and fold the new cloth into a knife pleat,
 *   stitched a little way down;
 * - **gather** (thread): slash and spread parallel, and ease the new width into the band where it was added;
 * - **close a dart**: pivot the cloth beside it about its point until its legs meet: the waist's taken in just the
 *   same, and the hem below opens (a dart's turned into flare);
 * - **release a dart**: don't sew it; gather its width into the band instead.
 *
 * The moves are the grammar. They don't commute: a pleat folded and then slashed through flares with the skirt (it
 * opens toward the hem); slashed first and then pleated, it hangs straight. Each move records what it made, so the
 * pattern's history is its provenance, and a move can be taken back by replaying the rest.
 *
 * A panel's a row of **ribs** (lines from waist to hem, bent once: at the hips at its sides, at a dart's point) and
 * the **strips** between them, each cloth, a wedge someone spread, a pleat, a dart, or eased width. Moves insert ribs
 * and turn or slide everything to one side of them, so a strip's always exactly the paper it was. What's sewn (side
 * seams, darts, pleats' stitching) and how the waist meets its band (its ease, declared on that seam) follow from the
 * strips, after (pattern.ts).
 *
 * Flat coordinates in centimetres: x across, y up; the waist at y = 0, the hem below it.
 */
export type V2 = [number, number];
export interface Rib { top: V2; knee: V2; bottom: V2 }
export type StripKind = 'cloth' | 'wedge' | 'pleat' | 'dart' | 'ease';
export interface Strip {
  kind: StripKind;
  /** which move made it (−1: the block) */
  by: number;
  /** a pleat's stitching, how far down (cm) */
  stitch?: number;
  /** a dart closed into flare: how far down its rib its point is (a fraction); above it, its legs are sewn as one */
  tip?: number;
}
export interface Panel { ribs: Rib[]; strips: Strip[] }

export type Move =
  | { kind: 'spread'; at: number; open: number }
  | { kind: 'pleat'; at: number; depth: number }
  | { kind: 'gather'; at: number; add: number }
  | { kind: 'close-dart'; dart: number }
  | { kind: 'release-dart'; dart: number };

export const PLEAT_STITCH = 5;

const lerp2 = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const len2 = (a: V2, b: V2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const rot = (p: V2, c: V2, a: number): V2 => { const s = Math.sin(a), co = Math.cos(a), x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * co - y * s, c[1] + x * s + y * co]; };
const ribMap = (r: Rib, f: (p: V2) => V2): Rib => ({ top: f(r.top), knee: f(r.knee), bottom: f(r.bottom) });

/** a point a fraction `s` of the way down a rib, by length */
export function ribAt(r: Rib, s: number): V2 {
  const a = len2(r.top, r.knee), b = len2(r.knee, r.bottom), d = s * (a + b);
  return d <= a ? lerp2(r.top, r.knee, a > 1e-9 ? d / a : 0) : lerp2(r.knee, r.bottom, b > 1e-9 ? (d - a) / b : 0);
}

// ─── the block ─────────────────────────────────────────────────────────────────────────────────
export interface BlockSpec {
  /** length, its share of the band at the waist, its share of the hips' round (with ease), how far down the hips are */
  L: number; waist: number; hip: number; hipDepth: number;
  /** how far a side seam can curve in, and how deep a dart can be */
  seamCurve: number; dartMax: number;
}
/** the straight skirt block: straight down from the hips; its side seams curve in toward the waist as far as a seam
 * can; darts take in the rest, as many as it needs, evenly across */
export function block(b: BlockSpec): Panel {
  const wH = b.hip, curve = Math.min(b.seamCurve, Math.max(0, (wH - b.waist) / 2)), w0 = wH - 2 * curve, D = Math.max(0, w0 - b.waist);
  // (the side seam's hip curve reaches the hips' full width a little over halfway down to them, as a block's does;
  // darts end well above the hips)
  const nd = D > 0.3 ? Math.ceil(D / b.dartMax) : 0, dk = nd ? D / nd : 0, dl = Math.min(b.hipDepth * 0.6, 5.5 + dk), yh = Math.min(b.hipDepth * 0.55, b.L - 1);
  const ribs: Rib[] = [{ top: [-w0 / 2, 0], knee: [-wH / 2, -yh], bottom: [-wH / 2, -b.L] }];
  const strips: Strip[] = [];
  // (the darts' centres, evenly across the hip; their legs on the waist either side, meeting at the point)
  for (let k = 0; k < nd; k++) {
    // (each dart's point below where it sits on the hips; its legs either side of the matching place on the waist)
    const xc = -wH / 2 + ((k + 0.5) / nd) * wH, c = xc * (w0 / wH);
    strips.push({ kind: 'cloth', by: -1 });
    ribs.push({ top: [c - dk / 2, 0], knee: [xc, -dl], bottom: [xc, -b.L] });
    strips.push({ kind: 'dart', by: -1 });
    ribs.push({ top: [c + dk / 2, 0], knee: [xc, -dl], bottom: [xc, -b.L] });
  }
  strips.push({ kind: 'cloth', by: -1 });
  ribs.push({ top: [w0 / 2, 0], knee: [wH / 2, -yh], bottom: [wH / 2, -b.L] });
  return { ribs, strips };
}

// ─── the moves ─────────────────────────────────────────────────────────────────────────────────
/** where a fraction `at` of the way across the panel's waist (or hem) is: which strip, and how far across it */
function locate(p: Panel, at: number, edge: 'top' | 'bottom', avoid: StripKind[] = ['pleat', 'dart']): { k: number; t: number } {
  const w = p.strips.map((_, k) => len2(p.ribs[k][edge], p.ribs[k + 1][edge])), total = w.reduce((s, x) => s + x, 0);
  let d = Math.max(0, Math.min(1, at)) * total, k = 0;
  while (k < w.length - 1 && d > w[k]) { d -= w[k]; k++; }
  let t = w[k] > 1e-9 ? d / w[k] : 0.5;
  // (a slash doesn't go through a fold or a dart: it goes beside it)
  if (avoid.includes(p.strips[k].kind)) { t = t < 0.5 ? 0 : 1; }
  return { k, t };
}
/** a new rib across strip k at t (a copy of what's there), so the paper can be cut along it */
function split(p: Panel, k: number, t: number): number {
  if (t <= 1e-6) return k;
  if (t >= 1 - 1e-6) return k + 1;
  const a = p.ribs[k], b = p.ribs[k + 1];
  const r: Rib = { top: lerp2(a.top, b.top, t), knee: lerp2(a.knee, b.knee, t), bottom: lerp2(a.bottom, b.bottom, t) };
  p.ribs.splice(k + 1, 0, r);
  p.strips.splice(k + 1, 0, { ...p.strips[k] });
  return k + 1;
}
/** everything right of rib i moved by f (rib i itself copied first, so a new strip opens between) */
function open(p: Panel, i: number, kind: StripKind, by: number, f: (q: V2) => V2, extra: Partial<Strip> = {}) {
  const copy = { ...p.ribs[i] };
  p.ribs.splice(i + 1, 0, copy);
  p.strips.splice(i, 0, { kind, by, ...extra });
  for (let j = i + 1; j < p.ribs.length; j++) p.ribs[j] = ribMap(p.ribs[j], f);
}

export interface Applied { panel: Panel; ok: boolean[]; notes: string[] }
/** the block, with every move made on it in order; a move that can't be made here (a dart that isn't there) is kept
 * in the history but marks itself as doing nothing */
export function apply(base: Panel, moves: Move[]): Applied {
  const p: Panel = { ribs: base.ribs.map((r) => ({ ...r })), strips: base.strips.map((s) => ({ ...s })) };
  const ok: boolean[] = [], notes: string[] = [];
  const darts = () => p.strips.map((s, k) => (s.kind === 'dart' ? k : -1)).filter((k) => k >= 0);
  moves.forEach((m, n) => {
    if (m.kind === 'spread') {
      // (slash at the hem, up to the waist; hinge at the waist; the cloth to the right swung out at the hem)
      const { k, t } = locate(p, m.at, 'bottom'), i = split(p, k, t), r = p.ribs[i], R = len2(r.top, r.bottom);
      const a = 2 * Math.asin(Math.min(0.999, Math.max(0, m.open) / (2 * Math.max(1, R)))), dir = waistDir(p, i);
      const pivot = r.top;
      void dir;
      open(p, i, 'wedge', n, (q) => rot(q, pivot, a));
      ok.push(m.open > 0);
    } else if (m.kind === 'pleat' || m.kind === 'gather') {
      // (slash from the waist down, spread it parallel (along the waist there), the new cloth folded or eased)
      const { k, t } = locate(p, m.at, 'top'), i = split(p, k, t), dir = waistDir(p, i);
      const w = m.kind === 'pleat' ? 2 * Math.max(0, m.depth) : Math.max(0, m.add);
      open(p, i, m.kind === 'pleat' ? 'pleat' : 'ease', n, (q) => [q[0] + dir[0] * w, q[1] + dir[1] * w], m.kind === 'pleat' ? { stitch: PLEAT_STITCH } : {});
      ok.push(w > 0);
    } else {
      const ks = darts(), k = ks[m.dart];
      if (k === undefined) { ok.push(false); notes.push(`no dart ${m.dart + 1} on this panel to ${m.kind === 'close-dart' ? 'close' : 'release'}`); return; }
      if (m.kind === 'release-dart') { p.strips[k] = { kind: 'ease', by: n }; ok.push(true); return; }
      // (pivot everything right of the dart about its point until its legs meet at the waist: the hem opens below)
      const tip = p.ribs[k].knee, a0 = Math.atan2(p.ribs[k].top[1] - tip[1], p.ribs[k].top[0] - tip[0]), a1 = Math.atan2(p.ribs[k + 1].top[1] - tip[1], p.ribs[k + 1].top[0] - tip[0]);
      let da = a0 - a1; if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      const turn = da;
      for (let j = k + 1; j < p.ribs.length; j++) p.ribs[j] = ribMap(p.ribs[j], (q) => rot(q, tip, turn));
      const r = p.ribs[k], tipS = len2(r.top, r.knee) / Math.max(1e-6, len2(r.top, r.knee) + len2(r.knee, r.bottom));
      p.strips[k] = { kind: 'wedge', by: n, tip: tipS };
      ok.push(true);
    }
  });
  upright(p);
  return { panel: p, ok, notes };
}
/** the direction along the waist at rib i (from the cloth to its left to the cloth to its right) */
function waistDir(p: Panel, i: number): V2 {
  const a = p.ribs[Math.max(0, i - 1)].top, b = p.ribs[Math.min(p.ribs.length - 1, i + 1)].top, l = len2(a, b);
  return l > 1e-6 ? [(b[0] - a[0]) / l, (b[1] - a[1]) / l] : [1, 0];
}
/** turn the whole panel so its middle hangs straight down (its centre line from the middle of the waist to the middle
 * of the hem): where the grain's laid from, as a cutter lays it */
function upright(p: Panel) {
  const mid = (edge: 'top' | 'bottom'): V2 => {
    const w = p.strips.map((_, k) => len2(p.ribs[k][edge], p.ribs[k + 1][edge])), total = w.reduce((s, x) => s + x, 0);
    let d = total / 2, k = 0;
    while (k < w.length - 1 && d > w[k]) { d -= w[k]; k++; }
    return lerp2(p.ribs[k][edge], p.ribs[k + 1][edge], w[k] > 1e-9 ? d / w[k] : 0.5);
  };
  const a = mid('top'), b = mid('bottom'), ang = Math.atan2(b[0] - a[0], -(b[1] - a[1]));
  for (let j = 0; j < p.ribs.length; j++) p.ribs[j] = ribMap(p.ribs[j], (q) => { const r = rot(q, a, ang); return [r[0] - a[0], r[1] - a[1]]; });
}

// ─── reading a panel ───────────────────────────────────────────────────────────────────────────
/** a strip's width at its waist, hem, and widest */
export function stripWidths(p: Panel, k: number) {
  const a = p.ribs[k], b = p.ribs[k + 1];
  return { top: len2(a.top, b.top), bottom: len2(a.bottom, b.bottom), max: Math.max(len2(a.top, b.top), len2(a.bottom, b.bottom), len2(a.knee, b.knee)) };
}
/** the panel's width across at a fraction s down it, and how much of that's sewn closed there (darts, a pleat's stitching) */
export function widthAt(p: Panel, s: number, L: number) {
  let w = 0, closed = 0;
  p.strips.forEach((st, k) => {
    const x = len2(ribAt(p.ribs[k], s), ribAt(p.ribs[k + 1], s));
    w += x;
    const tipS = st.kind === 'dart' ? len2(p.ribs[k].top, p.ribs[k].knee) / (len2(p.ribs[k].top, p.ribs[k].knee) + len2(p.ribs[k].knee, p.ribs[k].bottom)) : 0;
    if ((st.kind === 'dart' && s < tipS) || (st.kind === 'pleat' && s * L <= (st.stitch ?? 0))) closed += x;
  });
  return { w, closed };
}
/** the panel's outline (waist left to right, down the right side, hem right to left, up the left side) */
export function outline(p: Panel, steps = 8): V2[] {
  const o: V2[] = [];
  const n = p.ribs.length - 1;
  for (let j = 0; j <= n; j++) o.push(p.ribs[j].top);
  for (let i = 1; i <= steps; i++) o.push(ribAt(p.ribs[n], i / steps));
  for (let j = n - 1; j >= 0; j--) o.push(p.ribs[j].bottom);
  for (let i = steps - 1; i > 0; i--) o.push(ribAt(p.ribs[0], i / steps));
  return o;
}
/** does the paper overlap itself? (its outline crosses itself) */
export function selfOverlaps(p: Panel): boolean {
  const o = outline(p, 6), n = o.length;
  const cross = (a: V2, b: V2, c: V2, d: V2) => {
    const d1 = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]), d2 = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    const d3 = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (a[0] - c[0]), d4 = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (b[0] - c[0]);
    return d1 * d2 < -1e-6 && d3 * d4 < -1e-6;
  };
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (cross(o[i], o[(i + 1) % n], o[j], o[(j + 1) % n])) return true;
  }
  return false;
}

/**
 * Shapes as signed distance fields, and the symmetries a fill repeats under.
 *
 * A region to fill, a zone to keep clear and a line to stay off are all the same thing: a shape
 * whose `sdf` is negative inside, zero on its edge, positive outside (the distance to it). Shapes
 * compose — union, intersection, difference, grow — so a card's frame is a rounded box minus a
 * smaller one, a corner piece is a disc cut by the frame's inside, and a label's safe zone is a
 * box sized to its text. Pure; any units.
 */
export type Pt = [number, number];
export type Shape =
  | { k: 'circle'; c: Pt; r: number }
  | { k: 'ring'; c: Pt; r0: number; r1: number }
  /** a rounded box by its centre and half-sizes */
  | { k: 'box'; c: Pt; hw: number; hh: number; rx?: number }
  | { k: 'poly'; pts: Pt[] }
  /** a thick segment */
  | { k: 'capsule'; a: Pt; b: Pt; r: number }
  /** a circle's line, w either side */
  | { k: 'stroke'; c: Pt; r: number; w: number }
  | { k: 'union'; of: Shape[] }
  | { k: 'inter'; of: Shape[] }
  | { k: 'diff'; a: Shape; minus: Shape[] }
  | { k: 'grow'; s: Shape; by: number };

const len = (x: number, y: number) => Math.sqrt(x * x + y * y);
export function sdf(s: Shape, p: Pt): number {
  switch (s.k) {
    case 'circle': return len(p[0] - s.c[0], p[1] - s.c[1]) - s.r;
    case 'ring': { const d = len(p[0] - s.c[0], p[1] - s.c[1]); return Math.max(s.r0 - d, d - s.r1); }
    case 'box': {
      const rx = Math.min(s.rx ?? 0, s.hw, s.hh);
      const qx = Math.abs(p[0] - s.c[0]) - s.hw + rx, qy = Math.abs(p[1] - s.c[1]) - s.hh + rx;
      return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rx;
    }
    case 'poly': {
      const v = s.pts;
      let d = Infinity, inside = false;
      for (let i = 0, j = v.length - 1; i < v.length; j = i++) {
        const ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1], wx = p[0] - v[i][0], wy = p[1] - v[i][1];
        const h = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
        d = Math.min(d, len(wx - ex * h, wy - ey * h));
        if ((v[i][1] > p[1]) !== (v[j][1] > p[1]) && p[0] < ((v[j][0] - v[i][0]) * (p[1] - v[i][1])) / (v[j][1] - v[i][1]) + v[i][0]) inside = !inside;
      }
      return inside ? -d : d;
    }
    case 'capsule': {
      const pax = p[0] - s.a[0], pay = p[1] - s.a[1], bax = s.b[0] - s.a[0], bay = s.b[1] - s.a[1];
      const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay || 1)));
      return len(pax - bax * h, pay - bay * h) - s.r;
    }
    case 'stroke': return Math.abs(len(p[0] - s.c[0], p[1] - s.c[1]) - s.r) - s.w;
    case 'union': return s.of.reduce((m, x) => Math.min(m, sdf(x, p)), Infinity);
    case 'inter': return s.of.reduce((m, x) => Math.max(m, sdf(x, p)), -Infinity);
    case 'diff': return s.minus.reduce((m, x) => Math.max(m, -sdf(x, p)), sdf(s.a, p));
    case 'grow': return sdf(s.s, p) - s.by;
  }
}
/** the distance to the nearest of several shapes (Infinity for none) */
export const sdfAll = (ss: Shape[], p: Pt) => ss.reduce((m, s) => Math.min(m, sdf(s, p)), Infinity);

export type Box = [number, number, number, number];
export function bounds(s: Shape): Box {
  switch (s.k) {
    case 'circle': return [s.c[0] - s.r, s.c[1] - s.r, s.c[0] + s.r, s.c[1] + s.r];
    case 'ring': return [s.c[0] - s.r1, s.c[1] - s.r1, s.c[0] + s.r1, s.c[1] + s.r1];
    case 'box': return [s.c[0] - s.hw, s.c[1] - s.hh, s.c[0] + s.hw, s.c[1] + s.hh];
    case 'poly': return [Math.min(...s.pts.map((q) => q[0])), Math.min(...s.pts.map((q) => q[1])), Math.max(...s.pts.map((q) => q[0])), Math.max(...s.pts.map((q) => q[1]))];
    case 'capsule': return [Math.min(s.a[0], s.b[0]) - s.r, Math.min(s.a[1], s.b[1]) - s.r, Math.max(s.a[0], s.b[0]) + s.r, Math.max(s.a[1], s.b[1]) + s.r];
    case 'stroke': return [s.c[0] - s.r - s.w, s.c[1] - s.r - s.w, s.c[0] + s.r + s.w, s.c[1] + s.r + s.w];
    case 'union': { const bs = s.of.map(bounds); return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))]; }
    case 'inter': { const bs = s.of.map(bounds); return [Math.max(...bs.map((b) => b[0])), Math.max(...bs.map((b) => b[1])), Math.min(...bs.map((b) => b[2])), Math.min(...bs.map((b) => b[3]))]; }
    case 'diff': return bounds(s.a);
    case 'grow': { const b = bounds(s.s); return [b[0] - s.by, b[1] - s.by, b[2] + s.by, b[3] + s.by]; }
  }
}
export const grow = (s: Shape, by: number): Shape => (by ? { k: 'grow', s, by } : s);

/** a shape's outline as SVG (for overlays): its primitives, each drawn */
export function shapeOutline(s: Shape, attrs: string): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  switch (s.k) {
    case 'circle': return `<circle cx="${f(s.c[0])}" cy="${f(s.c[1])}" r="${f(s.r)}" ${attrs}/>`;
    case 'ring': return `<path fill-rule="evenodd" d="M${f(s.c[0] - s.r1)} ${f(s.c[1])}a${f(s.r1)} ${f(s.r1)} 0 1 0 ${f(2 * s.r1)} 0a${f(s.r1)} ${f(s.r1)} 0 1 0 ${f(-2 * s.r1)} 0ZM${f(s.c[0] - s.r0)} ${f(s.c[1])}a${f(s.r0)} ${f(s.r0)} 0 1 0 ${f(2 * s.r0)} 0a${f(s.r0)} ${f(s.r0)} 0 1 0 ${f(-2 * s.r0)} 0Z" ${attrs}/>`;
    case 'box': return `<rect x="${f(s.c[0] - s.hw)}" y="${f(s.c[1] - s.hh)}" width="${f(2 * s.hw)}" height="${f(2 * s.hh)}" rx="${f(s.rx ?? 0)}" ${attrs}/>`;
    case 'poly': return `<path d="M${s.pts.map((q) => `${f(q[0])} ${f(q[1])}`).join('L')}Z" ${attrs}/>`;
    case 'capsule': return `<path d="M${f(s.a[0])} ${f(s.a[1])}L${f(s.b[0])} ${f(s.b[1])}" stroke-width="${f(2 * s.r)}" stroke-linecap="round" ${attrs.replace(/fill="[^"]*"/, 'fill="none"').replace(/stroke="[^"]*"/, '')} stroke="currentColor"/>`;
    case 'stroke': return `<circle cx="${f(s.c[0])}" cy="${f(s.c[1])}" r="${f(s.r)}" fill="none" stroke="currentColor" stroke-width="${f(2 * s.w)}" ${attrs.replace(/fill="[^"]*"/, '').replace(/stroke="[^"]*"/, '')}/>`;
    case 'union': case 'inter': return s.of.map((x) => shapeOutline(x, attrs)).join('');
    case 'diff': return shapeOutline(s.a, attrs) + s.minus.map((x) => shapeOutline(x, attrs)).join('');
    case 'grow': return shapeOutline(s.s, attrs);
  }
}

// ─── symmetry ─────────────────────────────────────────────────────────────────────────────────
/** what a fill repeats under: `rot` — fold turns about c, each mirrored (a seal); `d2` — mirrored
 *  left–right and top–bottom about c (a card, a frame, its corners); `none` */
export type Sym = { kind: 'rot'; c: Pt; fold: number } | { kind: 'd2'; c: Pt } | { kind: 'none' };
export interface Copy { p: Pt; a: number; m: number }
const rad = (a: number) => (a * Math.PI) / 180;
/** every copy of a point (and an orientation a, degrees clockwise from up) under the symmetry;
 *  copies that land on each other (a point on a mirror) are kept once */
export function copies(sym: Sym, p: Pt, a: number): Copy[] {
  let out: Copy[];
  if (sym.kind === 'none') return [{ p, a, m: 1 }];
  const [cx, cy] = sym.c, x = p[0] - cx, y = p[1] - cy;
  if (sym.kind === 'd2') {
    out = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => ({ p: [cx + sx * x, cy + sy * y] as Pt, a: sx === 1 && sy === 1 ? a : sx === -1 && sy === 1 ? -a : sx === 1 ? 180 - a : 180 + a, m: sx * sy }));
  } else {
    out = [];
    for (let k = 0; k < sym.fold; k++) for (const m of [1, -1]) {
      const t = rad((k * 360) / sym.fold), mx = m * x;
      out.push({ p: [cx + mx * Math.cos(t) - y * Math.sin(t), cy + mx * Math.sin(t) + y * Math.cos(t)], a: m * a + (k * 360) / sym.fold, m });
    }
  }
  const kept: Copy[] = [];
  for (const c of out) if (!kept.some((k) => Math.abs(k.p[0] - c.p[0]) < 1e-3 && Math.abs(k.p[1] - c.p[1]) < 1e-3)) kept.push(c);
  return kept;
}
/** a random point in the symmetry's fundamental domain (null when it falls outside the bounds) */
export function sampleDomain(sym: Sym, b: Box, r: () => number): Pt {
  if (sym.kind === 'none') return [b[0] + r() * (b[2] - b[0]), b[1] + r() * (b[3] - b[1])];
  const [cx, cy] = sym.c;
  if (sym.kind === 'd2') return [cx + r() * Math.max(Math.abs(b[0] - cx), Math.abs(b[2] - cx)), cy + r() * Math.max(Math.abs(b[1] - cy), Math.abs(b[3] - cy))];
  const R = Math.max(...[[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(([x, y]) => len(x - cx, y - cy)));
  const a = rad(r() * (180 / sym.fold)), rr = R * Math.sqrt(r());
  return [cx + rr * Math.sin(a), cy - rr * Math.cos(a)];
}
/** a point close to a mirror, put on it (so the axes carry ornaments rather than a seam) */
export function snap(sym: Sym, p: Pt, tol: number): Pt {
  if (sym.kind === 'none' || tol <= 0) return p;
  const [cx, cy] = sym.c, x = p[0] - cx, y = p[1] - cy;
  if (sym.kind === 'd2') return [cx + (Math.abs(x) < tol ? 0 : x), cy + (Math.abs(y) < tol ? 0 : y)];
  const rr = len(x, y), a = Math.atan2(x, -y), w = rad(180 / sym.fold);
  if (rr * Math.sin(a) < tol) return [cx, cy - rr];
  if (rr * Math.sin(w - a) < tol) return [cx + rr * Math.sin(w), cy - rr * Math.cos(w)];
  return p;
}

// ─── an index of shapes, for distances that only matter up to a reach ─────────────────────────
/** shapes bucketed on a grid by their bounds grown by `reach`: `near(p)` is every shape that
 *  could be within `reach` of p (anything further can't matter to a disc capped at reach) */
export class ShapeIndex {
  private cells = new Map<number, Shape[]>();
  private wide: Shape[] = [];
  constructor(shapes: Shape[], private reach: number, private cell = Math.max(1, reach * 2)) {
    for (const s of shapes) {
      const b = bounds(s);
      const x0 = Math.floor((b[0] - reach) / this.cell), x1 = Math.floor((b[2] + reach) / this.cell);
      const y0 = Math.floor((b[1] - reach) / this.cell), y1 = Math.floor((b[3] + reach) / this.cell);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) { this.wide.push(s); continue; }
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = x * 92821 + y; (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(s); }
    }
  }
  /** the distance to the nearest shape, or Infinity past the reach */
  dist(p: Pt): number {
    let d = Infinity;
    for (const s of this.cells.get(Math.floor(p[0] / this.cell) * 92821 + Math.floor(p[1] / this.cell)) ?? []) d = Math.min(d, sdf(s, p));
    for (const s of this.wide) d = Math.min(d, sdf(s, p));
    return d;
  }
}

/**
 * The seal's geometry for any shape. A seal is a construction before it is ornament: rules
 * parallel to its edge, a band of beads and ticks, a star lattice and spokes through its key
 * points, medallions at its nodes. Here the same construction is made from a shape's distance
 * field, so a frame, a corner piece or a lens carries it as a seal does:
 *
 * - **key points**: rays along the symmetry's axes (and to the corners); where a ray runs inside
 *   the shape, its deepest point is a node and carries a medallion (a small seal of the suit's
 *   own: rings, beads, a star polygon); where it crosses the inner rule is a lattice point;
 * - **rules**: contour lines inset from the edge (marching squares on the field) — of the shape
 *   less its medallions and safe zones, so the rules wrap round both, like cartouches;
 * - **band**: a bead rule, then ticks along a contour (a scale; or fans at the nodes, for rays);
 * - **lattice**: a star polygon through the lattice points, spokes from the centre to them, arcs
 *   round the nodes — clipped to the shape, so across a frame they become rungs and bracing;
 * - everything scales down to the shape's depth: a thin frame keeps its rules, fewer of them.
 *
 * `ornate` is construction then fill (ornament.ts): the fill packs what the construction leaves.
 */
import { hash } from '../kit/rng';
import { bounds, sdf, type Pt, type Shape, type Sym } from './field';
import { add, f, fill, glyph, pol, pt, type FillResult, type Mark } from './ornament';
import type { Style } from './styles';

const sq = (x: number) => x * x;
const dist = (a: Pt, b: Pt) => Math.sqrt(sq(a[0] - b[0]) + sq(a[1] - b[1]));

// ─── the field on a grid, and its contours ────────────────────────────────────────────────────
interface Grid { x0: number; y0: number; step: number; nx: number; ny: number; v: Float64Array }
function sampleGrid(s: Shape, step: number): Grid {
  const b = bounds(s), pad = step * 2;
  const x0 = b[0] - pad, y0 = b[1] - pad, nx = Math.ceil((b[2] - b[0] + 2 * pad) / step) + 1, ny = Math.ceil((b[3] - b[1] + 2 * pad) / step) + 1;
  const v = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = sdf(s, [x0 + i * step, y0 + j * step]);
  return { x0, y0, step, nx, ny, v };
}
/** the field sampled on a grid (for `isolines`) */
export const sampleGridFor = (s: Shape, step: number) => sampleGrid(s, step);
/** the lines where the field equals L, as polylines (closed ones end where they start) */
export function isolines(g: { x0: number; y0: number; step: number; nx: number; ny: number; v: Float64Array }, L: number): Pt[][] {
  const { nx, ny, v, x0, y0, step } = g;
  const at = (i: number, j: number) => v[j * nx + i];
  // (a crossing is named by its grid edge: 2·cell for the horizontal edge, +1 for the vertical)
  const pos = new Map<number, Pt>();
  const cross = (i: number, j: number, horiz: boolean): number => {
    const id = (j * nx + i) * 2 + (horiz ? 0 : 1);
    if (!pos.has(id)) {
      const a = at(i, j), b = horiz ? at(i + 1, j) : at(i, j + 1), t = (L - a) / (b - a || 1e-12);
      pos.set(id, horiz ? [x0 + (i + t) * step, y0 + j * step] : [x0 + i * step, y0 + (j + t) * step]);
    }
    return id;
  };
  const segs: Array<[number, number]> = [];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = at(i, j) > L, b = at(i + 1, j) > L, c = at(i + 1, j + 1) > L, d = at(i, j + 1) > L;
    const idx = (+a << 3) | (+b << 2) | (+c << 1) | +d;
    if (idx === 0 || idx === 15) continue;
    const T = () => cross(i, j, true), B = () => cross(i, j + 1, true), Lf = () => cross(i, j, false), R = () => cross(i + 1, j, false);
    const mid = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 > L;
    switch (idx) {
      case 1: case 14: segs.push([Lf(), B()]); break;
      case 2: case 13: segs.push([B(), R()]); break;
      case 3: case 12: segs.push([Lf(), R()]); break;
      case 4: case 11: segs.push([T(), R()]); break;
      case 6: case 9: segs.push([T(), B()]); break;
      case 7: case 8: segs.push([T(), Lf()]); break;
      case 5: if (mid) segs.push([T(), Lf()], [B(), R()]); else segs.push([T(), R()], [Lf(), B()]); break;
      case 10: if (mid) segs.push([T(), R()], [Lf(), B()]); else segs.push([T(), Lf()], [B(), R()]); break;
    }
  }
  // join the segments end to end
  const ends = new Map<number, number[]>();
  segs.forEach(([p, q], k) => { (ends.get(p) ?? ends.set(p, []).get(p)!).push(k); (ends.get(q) ?? ends.set(q, []).get(q)!).push(k); });
  const used = new Uint8Array(segs.length);
  const lines: Pt[][] = [];
  const walk = (start: number, from: number): number[] => {
    const ids = [from];
    let cur = from, k = start;
    for (;;) {
      used[k] = 1;
      const next = segs[k][0] === cur ? segs[k][1] : segs[k][0];
      ids.push(next);
      const nk = (ends.get(next) ?? []).find((x) => !used[x]);
      if (nk === undefined) break;
      cur = next; k = nk;
    }
    return ids;
  };
  for (let k = 0; k < segs.length; k++) {
    if (used[k]) continue;
    // (start an open line at its loose end, if it has one)
    let a = segs[k][0];
    const fwd = walk(k, a);
    const back = (ends.get(a) ?? []).find((x) => !used[x]);
    let ids = fwd;
    if (back !== undefined) { const other = walk(back, a); ids = [...other.reverse(), ...fwd.slice(1)]; a = ids[0]; }
    lines.push(ids.map((id) => pos.get(id)!));
  }
  return lines;
}
/** a polyline smoothed once (Chaikin), kept closed if it was */
function smooth(ps: Pt[]): Pt[] {
  if (ps.length < 3) return ps;
  const closed = dist(ps[0], ps[ps.length - 1]) < 1e-6;
  const out: Pt[] = closed ? [] : [ps[0]];
  for (let i = 0; i < ps.length - 1; i++) {
    const a = ps[i], b = ps[i + 1];
    out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
  }
  if (closed) out.push(out[0]); else out.push(ps[ps.length - 1]);
  return out;
}
const linePath = (ps: Pt[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${pt(p)}`).join('') + (ps.length > 2 && dist(ps[0], ps[ps.length - 1]) < 1e-6 ? 'Z' : '');
/** the field's inward direction at p */
function inward(s: Shape, p: Pt, h: number): Pt {
  const gx = sdf(s, [p[0] + h, p[1]]) - sdf(s, [p[0] - h, p[1]]), gy = sdf(s, [p[0], p[1] + h]) - sdf(s, [p[0], p[1] - h]);
  const l = Math.sqrt(gx * gx + gy * gy) || 1;
  return [-gx / l, -gy / l];
}

// ─── key points ───────────────────────────────────────────────────────────────────────────────
/** the rays a symmetry casts: its mirrors (and, for a box, toward its corners) */
function rayAngles(sym: Sym, s: Shape, centre: Pt): number[] {
  if (sym.kind === 'rot') return Array.from({ length: 2 * sym.fold }, (_, i) => (i * 180) / sym.fold);
  const b = bounds(s), hw = Math.max(centre[0] - b[0], b[2] - centre[0]), hh = Math.max(centre[1] - b[1], b[3] - centre[1]);
  const c = (Math.atan2(hw, hh) * 180) / Math.PI;
  return [0, c, 90, 180 - c, 180, 180 + c, 270, 360 - c];
}
/** along a ray, the deepest point of each run inside the shape */
function deepest(s: Shape, centre: Pt, a: number, R: number, step: number): Array<{ p: Pt; depth: number }> {
  const out: Array<{ p: Pt; depth: number }> = [];
  let best: { p: Pt; depth: number } | null = null;
  for (let t = 0; t <= R; t += step) {
    const p = add(centre, pol(t, a)), d = -sdf(s, p);
    if (d > 0) { if (!best || d > best.depth) best = { p, depth: d }; }
    else if (best) { out.push(best); best = null; }
  }
  if (best) out.push(best);
  return out;
}
/** along a ray, coming in from outside, the first point at depth `level` */
function firstAt(s: Shape, centre: Pt, a: number, R: number, level: number, step: number): Pt | null {
  for (let t = R; t >= 0; t -= step) {
    if (-sdf(s, add(centre, pol(t, a))) >= level) {
      let lo = t, hi = t + step;
      for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (-sdf(s, add(centre, pol(m, a))) >= level) lo = m; else hi = m; }
      return add(centre, pol(lo, a));
    }
  }
  return null;
}
/** a symmetric noise in 0..1: the same at every copy of a point */
function symNoise(sym: Sym, p: Pt, seed: number, scale: number): number {
  const q = canonical(sym, p);
  const x = q[0] / scale, y = q[1] / scale, i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j;
  const h = (a: number, b: number) => hash(seed, a, b) / 4294967296;
  const s = (t: number) => t * t * (3 - 2 * t);
  return (h(i, j) * (1 - s(u)) + h(i + 1, j) * s(u)) * (1 - s(v)) + (h(i, j + 1) * (1 - s(u)) + h(i + 1, j + 1) * s(u)) * s(v);
}
/** a point's image in the symmetry's fundamental domain */
function canonical(sym: Sym, p: Pt): Pt {
  if (sym.kind === 'none') return p;
  const x = p[0] - sym.c[0], y = p[1] - sym.c[1];
  if (sym.kind === 'd2') return [Math.abs(x), Math.abs(y)];
  const r = Math.sqrt(x * x + y * y), w = 360 / sym.fold;
  let a = (((Math.atan2(x, -y) * 180) / Math.PI) % w + w) % w;
  if (a > w / 2) a = w - a;
  return pol(r, a);
}

// ─── a medallion: the suit's seal, small ──────────────────────────────────────────────────────
function medallion(c: Pt, r: number, s: Style, W: number, a: number): Mark[] {
  const out: Mark[] = [];
  const circ = (rr: number, w: number, fill: 'none' | 'ink' | 'paper' = 'none', at: Pt = c) => out.push({ k: 'circle', x: f(at[0]), y: f(at[1]), r: f(rr), w, fill, layer: 'ground' });
  circ(r, W * 1.2, 'paper');
  circ(r * 0.88, W * 0.45);
  if (s.beads > 0.05 && r > 2.2) { const n = Math.max(8, Math.round((r * 6) / 4) * 4); let d = ''; const br = Math.min(0.45, r * 0.035); for (let i = 0; i < n; i++) { const q = add(c, pol(r * 0.94, a + (i * 360) / n)); d += `M${pt([q[0] - br, q[1]])}a${f(br)} ${f(br)} 0 1 0 ${f(2 * br)} 0a${f(br)} ${f(br)} 0 1 0 ${f(-2 * br)} 0`; } out.push({ k: 'path', d, w: 0, fill: 'ink', layer: 'ground' }); }
  const n = s.star >= 4 ? s.star : 8, k = Math.max(1, Math.min(Math.floor((n - 1) / 2), s.star >= 4 ? Math.round(s.starSkip) : 3));
  const v = Array.from({ length: n }, (_, i) => add(c, pol(r * 0.8, a + (i * 360) / n)));
  let d = '';
  for (let i = 0; i < n; i++) d += `M${pt(v[i])}L${pt(v[(i + k) % n])}`;
  if (s.spokes) for (let i = 0; i < s.spokes; i++) d += `M${pt(add(c, pol(r * 0.3, a + (i * 360) / s.spokes)))}L${pt(add(c, pol(r * 0.8, a + (i * 360) / s.spokes)))}`;
  out.push({ k: 'path', d, w: W * 0.5, fill: 'none', layer: 'ground' });
  for (const q of v) circ(Math.max(0.2, r * 0.06), W * 0.4, 'paper', q);
  circ(r * 0.3, W * 0.7, 'paper');
  out.push({ k: 'path', d: glyph(s.motif, c, r * 0.2, a), w: W * 0.6, fill: s.motifFill ? 'ink' : 'paper', layer: 'ground' });
  return out;
}

// ─── the construction ─────────────────────────────────────────────────────────────────────────
export interface Structure {
  marks: Mark[];
  /** lines and medallions the fill keeps off */
  avoid: Shape[];
  /** where the fill goes: inside the innermost rule, less the medallions */
  inner: Shape;
  /** the region's outline, for clipping the lattice (even–odd) */
  clip: string;
  /** the deepest point's depth (half the width of a band) */
  depth: number;
}
export function structure(o: { region: Shape; zones: Shape[]; sym: Sym; style: Style; seed: number; k: number; centre: Pt }): Structure {
  const s = o.style, k = o.k, W = s.weight * k, edge = s.packEdge * k;
  const out: Mark[] = [];
  const avoid: Shape[] = [];
  const b = bounds(o.region);
  const R = Math.max(...[[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map((q) => dist(q as Pt, o.centre)));
  const step = Math.max(b[2] - b[0], b[3] - b[1]) / 170;
  // the region less the labels' zones: the construction gives way to them
  const base: Shape = o.zones.length ? { k: 'diff', a: o.region, minus: o.zones } : o.region;
  // nodes: the deepest point on each ray's run inside, the same on every copy
  const angles = rayAngles(o.sym, o.region, o.centre);
  const nodes: Array<{ p: Pt; depth: number; a: number; axis: boolean }> = [];
  angles.forEach((a, i) => { for (const n of deepest(base, o.centre, a, R, step)) nodes.push({ ...n, a, axis: i % 2 === 0 }); });
  const depth = Math.max(0, ...nodes.map((n) => n.depth));
  // the budget: the construction takes at most this share of the depth, scaled to fit
  const ringSpace = s.rings * s.ringGap * k, beadSpace = s.beads > 0.02 ? (2.6 + 2 * s.beadR) * k : 0, bandSpace = s.band !== 'none' ? (s.bandLen + 1) * k : 0;
  // medallions at the nodes (not too small, not too many: one per ray-run, deduplicated)
  const capR = s.packMax * k * 1.5;
  const meds: Array<{ c: Pt; r: number; a: number }> = [];
  for (const n of nodes) {
    // (on the rays the suit puts its motifs: the axes, the diagonals, or both)
    if (s.medal <= 0.02 || (s.motifAt === 'axes' && !n.axis) || (s.motifAt === 'diagonals' && n.axis)) continue;
    const r = Math.min(capR * s.medal, n.depth * 0.9);
    if (r < s.packMax * k * 0.6 || meds.some((m) => dist(m.c, n.p) < (m.r + r) * 0.9)) continue;
    meds.push({ c: n.p, r, a: n.a });
  }
  const medShapes: Shape[] = meds.map((m) => ({ k: 'circle', c: m.c, r: m.r + 0.8 * k }));
  const framed: Shape = medShapes.length ? { k: 'diff', a: base, minus: medShapes } : base;
  const g = sampleGrid(framed, step);
  // (the budget is of what the medallions leave: the construction takes at most a third of it)
  let depth2 = 0;
  for (let i = 0; i < g.v.length; i++) depth2 = Math.max(depth2, -g.v[i]);
  const scale = Math.min(1, (0.32 * depth2) / Math.max(1e-6, ringSpace + beadSpace + bandSpace));
  // the rules
  let level = 0;
  const rules: number[] = [];
  for (let i = 0; i < s.rings; i++) { rules.push(level + 0.35 * k); level += s.ringGap * k * scale; }
  for (const [i, L] of rules.entries()) for (const ln of isolines(g, -L)) out.push({ k: 'path', d: linePath(smooth(ln)), w: W * (i === 0 ? 1.4 : i % 2 ? 0.5 : 0.85), fill: 'none', layer: 'ground' });
  // a bead rule
  if (s.beads > 0.02 && scale > 0.25) {
    const L = level + (1.1 + s.beadR) * k * scale, sp = (2.2 - s.beads * 1.2) * k, br = s.beadR * k * Math.max(0.6, scale);
    let d = '';
    for (const ln of isolines(g, -L)) {
      let acc = 0;
      for (let i = 1; i < ln.length; i++) {
        const seg = dist(ln[i - 1], ln[i]);
        for (acc += seg; acc >= sp; acc -= sp) { const t = 1 - (acc - sp) / seg - 0, q: Pt = [ln[i - 1][0] + (ln[i][0] - ln[i - 1][0]) * Math.min(1, t), ln[i - 1][1] + (ln[i][1] - ln[i - 1][1]) * Math.min(1, t)]; d += `M${pt([q[0] - br, q[1]])}a${f(br)} ${f(br)} 0 1 0 ${f(2 * br)} 0a${f(br)} ${f(br)} 0 1 0 ${f(-2 * br)} 0`; }
      }
    }
    if (d) out.push({ k: 'path', d, w: 0, fill: 'ink', layer: 'ground' });
    level = L + (s.beadR + 1.3) * k * scale;
    for (const ln of isolines(g, -level)) out.push({ k: 'path', d: linePath(smooth(ln)), w: W * 0.6, fill: 'none', layer: 'ground' });
  }
  // the band: ticks inward from a contour — a scale, or fans at the nodes
  const bandLen = s.bandLen * k * scale;
  if (s.band !== 'none' && bandLen > 0.8 * k) {
    const L0 = level + 0.6 * k, sp = (0.75 * k) / s.bandDensity;
    const spread = Math.max(...meds.map((m) => m.r), depth) * (0.6 + 1.6 * s.bandSpan);
    let d = '';
    for (const ln of isolines(g, -L0)) {
      let acc = 0;
      for (let i = 1; i < ln.length; i++) {
        const seg = dist(ln[i - 1], ln[i]);
        for (acc += seg; acc >= sp; acc -= sp) {
          const t = Math.min(1, 1 - (acc - sp) / seg), q: Pt = [ln[i - 1][0] + (ln[i][0] - ln[i - 1][0]) * t, ln[i - 1][1] + (ln[i][1] - ln[i - 1][1]) * t];
          let len = bandLen * (0.3 + 0.7 * ((1 - s.bandRough) * 0.75 + s.bandRough * symNoise(o.sym, q, o.seed, 2.2 * k)));
          if (s.band === 'rays') { const dn = Math.min(...meds.map((m) => dist(m.c, q) - m.r), Infinity); if (!(dn < spread)) continue; len *= 1 - (0.7 * dn) / spread; }
          const n = inward(framed, q, step * 0.5);
          d += `M${pt(q)}L${pt([q[0] + n[0] * len, q[1] + n[1] * len])}`;
        }
      }
    }
    if (d) out.push({ k: 'path', d, w: W * 0.42, fill: 'none', layer: 'ground' });
    level = L0 + bandLen + 0.5 * k;
    for (const ln of isolines(g, -level)) out.push({ k: 'path', d: linePath(smooth(ln)), w: W * 0.5, fill: 'none', layer: 'ground' });
  }
  const inner: Shape = { k: 'grow', s: framed, by: -(level + edge) };
  // the lattice, clipped to the shape: a star through the lattice points, spokes, arcs at nodes
  if (s.lines) {
    const lp = angles.map((a) => firstAt(base, o.centre, a, R, level + 1.5 * k, step)).filter((q): q is Pt => !!q);
    const n = lp.length;
    let d = '';
    if (s.star >= 3 && n >= 4) {
      const skip = Math.max(1, Math.min(Math.floor((n - 1) / 2), Math.round((s.starSkip * n) / Math.max(4, s.star))));
      for (let i = 0; i < n; i++) { const a = lp[i], c = lp[(i + skip) % n]; d += `M${pt(a)}L${pt(c)}`; avoid.push({ k: 'capsule', a, b: c, r: W * 0.3 + edge }); }
    }
    if (s.spokes) for (const q of lp) { d += `M${pt(o.centre)}L${pt(q)}`; avoid.push({ k: 'capsule', a: o.centre, b: q, r: W * 0.25 + edge }); }
    if (s.petals || s.lenses) for (const m of meds) { const rr = m.r * (1.3 + (s.petalOffset - 0.3) * 0.8); out.push({ k: 'circle', x: f(m.c[0]), y: f(m.c[1]), r: f(rr), w: W * 0.5, fill: 'none', layer: 'ground', clip: true }); avoid.push({ k: 'stroke', c: m.c, r: rr, w: W * 0.25 + edge }); }
    if (d) out.push({ k: 'path', d, w: W * 0.55, fill: 'none', layer: 'ground', clip: true });
    for (const q of lp) { out.push({ k: 'circle', x: f(q[0]), y: f(q[1]), r: f(1.1 * k), w: W * 0.8, fill: 'paper', layer: 'ground' }); avoid.push({ k: 'circle', c: q, r: 1.1 * k + edge }); }
  }
  for (const m of meds) { out.push(...medallion(m.c, m.r, s, W, m.a)); avoid.push({ k: 'circle', c: m.c, r: m.r + edge }); }
  // the clip: the shape's own outline
  const gb = sampleGrid(base, step);
  const clip = isolines(gb, 0).map((ln) => linePath(ln) + (dist(ln[0], ln[ln.length - 1]) < 1e-6 ? '' : 'Z')).join('');
  return { marks: out, avoid, inner, clip, depth };
}

/** the construction, then the fill in what it leaves. A label changes the construction all
 *  round (every ray from the centre meets it), so the fill packs the construction as made: its
 *  symmetric pass checks every copy, leaving mirrored gaps where the construction isn't
 *  symmetric, and the unsymmetric refill closes them. */
export function ornate(o: { region: Shape; zones: Shape[]; sym: Sym; style: Style; seed: number; k: number; centre: Pt; stats?: boolean }): { structure: Structure; fill: FillResult } {
  const st = structure(o);
  const b = bounds(o.region);
  // (the outside of the fill's region, as a zone: it clears nothing, but it asks for the refill)
  const outside: Shape = { k: 'diff', a: { k: 'box', c: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], hw: (b[2] - b[0]) / 2 + 10, hh: (b[3] - b[1]) / 2 + 10 }, minus: [st.inner] };
  const res = fill({ region: st.inner, avoid: st.avoid, zones: o.zones.length ? [outside] : [], sym: o.sym, style: o.style, seed: hash(o.seed, 0xf111), k: o.k, centre: o.centre, stats: o.stats });
  return { structure: st, fill: res };
}

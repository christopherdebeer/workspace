/**
 * The brush: a procedural drawing medium in which a scene is expressed through marks that occupy space, respond to
 * form, and stay coherent as you move through them. The pipeline:
 *
 *   scene structure → drawing instructions → strokes and washes → splats → image
 *
 * A scene supplies structure (a curve on a surface, an edge, a region of a face, a point). A drawing rule picks what to
 * say about it and how much. This module turns that into **strokes** and **washes**, objects that keep their identity
 * (their path, gesture, material, place in a group), and only then into splats (`deposit`). Because the stroke survives
 * as itself, it can be shortened, re-pressured, regenerated at another density, or withdrawn with its group, and the
 * gesture is kept.
 *
 * Three operations, the same for a stone's seam, a bamboo culm, an architectural corner or a handwritten curve:
 * 1. **`stroke`**: a gesture along a path. *Support*: lying on a surface (each point's surface normal given: the mark
 *    lies flat on it and wraps over it) or in open space (no normals: a round cross-section, the same from every side).
 *    *Gesture*: width, pressure along it, taper in and out, breaks, a little tremor. *Material*: ink (dense, crisp),
 *    dry (fragmenting where the pressure's light), wash-line (a soft halo round a core).
 * 2. **`wash`**: tone laid within a region (a patch of a surface: it can sample itself, say whether a point is on it,
 *    and project a point onto it), firm along an anchor edge and softening away, its reach from the anchor uneven, with
 *    places it leaves open. *Material*: wash (broad discs), dry (hatching in rows along a direction, with gaps).
 * 3. **`group`**: a principal stroke, its supporting wash, its accents, simplifying together: one rank for the group,
 *    the principal kept longest, the wash withdrawing toward its anchor, the accents dropping to the one that matters.
 *
 * Each stroke says where its meaning lives (its *heart*, a place along it or, for a wash, its anchor), so as the detail
 * falls it reduces toward that, and goes as a whole.
 */
type V = [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const len = (a: V) => Math.hypot(a[0], a[1], a[2]);
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export { add, sub, mul, dot, cross, norm, len, smooth };
export type { V };

export const INK: V = [36, 31, 27], MOSS: V = [96, 110, 50];

/** a path: points, and (lying on a surface) the surface's normal at each */
export interface Path { pts: V[]; normals?: V[] }
export interface Gesture {
  /** the mark's width at full pressure */
  width: number;
  /** pressure along it (0..1 → 0..1) */
  pressure?: (u: number) => number;
  /** how much of each end tapers in and out */
  taper?: [number, number];
  /** stretches left out (from, to, along 0..1) */
  breaks?: Array<[number, number]>;
  /** a little tremor across the path, as a share of the width */
  tremor?: number;
}
export type Material = 'ink' | 'dry' | 'washline';
/** where along a stroke its meaning lives: as the detail falls it reduces toward there (0..1 along, or 'middle') */
export type Heart = number | 'middle' | 'ends';

export interface Stroke {
  kind: 'stroke'; id: number; path: Path; gesture: Gesture; material: Material; heart: Heart;
  colour: V; alpha: number; mark: number; feature: number;
  /** its rank (set by its group): when it goes as a whole; and how much of it goes before its heart */
  rank: number; span: number;
  /** the second face's normal, for a mark that shows only on the profile (render.ts: contour) */
  profile?: V;
}
export interface Region {
  /** a point on it at random, with the surface's normal there */
  sample(rnd: () => number): { p: V; n: V };
  /** its area (roughly) */
  area: number;
  /** whether a point is on it */
  on(p: V): boolean;
  /** a point taken onto it (and the normal there), or null */
  project(p: V): { p: V; n: V } | null;
  /** places it leaves open (paper showing) */
  open?(p: V): boolean;
}
export interface Wash {
  kind: 'wash'; id: number; region: Region; anchor: V[]; reach: number; material: 'wash' | 'dry';
  /** the hatching's direction at a point (dry) */
  direction?: (p: V, n: V) => V;
  /** how dark (0..1) */
  depth: number; colour: V; mark: number; feature: number; rank: number; span: number;
  /** how uneven its far boundary is (0 even) and the noise's phase */
  uneven: number; phase: number;
}
export type Element = Stroke | Wash;

let nextId = 1;
export function stroke(path: Path, gesture: Gesture, o: { material?: Material; heart?: Heart; colour?: V; alpha?: number; mark?: number; feature?: number; profile?: V } = {}): Stroke {
  return { kind: 'stroke', id: nextId++, path, gesture, material: o.material ?? 'ink', heart: o.heart ?? 'middle', colour: o.colour ?? INK, alpha: o.alpha ?? 0.9, mark: o.mark ?? 1, feature: o.feature ?? 0, rank: 0.9, span: 0.3, profile: o.profile };
}
export function wash(region: Region, anchor: V[], o: { reach?: number; material?: 'wash' | 'dry'; depth?: number; direction?: (p: V, n: V) => V; colour?: V; mark?: number; feature?: number; uneven?: number } = {}): Wash {
  return { kind: 'wash', id: nextId++, region, anchor, reach: o.reach ?? 0.3, material: o.material ?? 'wash', direction: o.direction, depth: o.depth ?? 0.6, colour: o.colour ?? INK, mark: o.mark ?? 2, feature: o.feature ?? 0, rank: 0.6, span: 0.5, uneven: o.uneven ?? 0.35, phase: (nextId * 2.399) % 6.283 };
}
/**
 * A group: a principal, its supports, its accents, simplifying together. The group's rank is the principal's; the
 * supports go a step earlier and withdraw toward their anchors; the accents earlier again, the first the last of them.
 */
export function group(rank: number, principal: Element | null, supports: Element[] = [], accents: Element[] = []): Element[] {
  const out: Element[] = [];
  if (principal) { principal.rank = rank; principal.span = 0.3; out.push(principal); }
  supports.forEach((s, k) => { s.rank = rank - 0.08 - 0.04 * k; s.span = 0.55; out.push(s); });
  accents.forEach((a, k) => { a.rank = rank - 0.2 - 0.07 * k; a.span = 0.35; out.push(a); });
  return out;
}

/** a splat as deposited: where, its axes and sizes, colour, and which element (and where along it) it came from */
export interface Dep { p: V; ax: [V, V, V]; s: V; c: V; a: number; rank: number; mark: number; feature: number; element: number; u: number; n1?: V; profile?: V }

function frame(n: V, along: V): [V, V, V] {
  let t = sub(along, mul(n, dot(along, n)));
  if (len(t) < 1e-6) t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  t = norm(sub(t, mul(n, dot(t, n))));
  return [t, cross(n, t), n];
}
const heartDist = (h: Heart, u: number) => (h === 'middle' ? Math.abs(2 * u - 1) : h === 'ends' ? 1 - Math.abs(2 * u - 1) : Math.min(1, Math.abs(u - h) / Math.max(h, 1 - h)));

/** a stroke into splats, at a density (1 as made; less, fewer and longer) */
export function depositStroke(s: Stroke, rnd: () => number, density = 1): Dep[] {
  const P = s.path.pts, N = s.path.normals, out: Dep[] = [];
  if (P.length < 2) return out;
  // (its length along, to place splats at even spacing whatever the path's sampling)
  const cum = [0]; for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + len(sub(P[i], P[i - 1])));
  const L = cum[cum.length - 1], g = s.gesture, step = Math.max(0.003, (g.width * 1.6) / density), ti = Math.max(1e-3, (g.taper ?? [0.12, 0.2])[0]), to = Math.max(1e-3, (g.taper ?? [0.12, 0.2])[1]);
  let seg = 0;
  for (let d = 0; d <= L; d += step) {
    while (seg < P.length - 2 && cum[seg + 1] < d) seg++;
    const t = (d - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]), u = d / L;
    if (g.breaks?.some(([a, b]) => u > a && u < b)) continue;
    const p = add(P[seg], mul(sub(P[seg + 1], P[seg]), t)), tan = norm(sub(P[seg + 1], P[seg]));
    const pr = (g.pressure?.(u) ?? 1) * smooth(0, ti, u) * smooth(1, 1 - to, u);
    if (pr < 0.05) continue;
    // (dry: the light-pressure stretches fragment)
    if (s.material === 'dry' && rnd() > 0.35 + 0.65 * pr) continue;
    const n = N ? norm(add(mul(N[seg], 1 - t), mul(N[seg + 1], t))) : null;
    const w = g.width * pr, rank = s.rank - s.span * heartDist(s.heart, u);
    const across = n ? norm(cross(n, tan)) : norm(cross(tan, Math.abs(tan[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const q = add(add(p, mul(across, (rnd() - 0.5) * (g.tremor ?? 0.15) * w)), n ? mul(n, 0.003) : [0, 0, 0]);
    // (on a surface: flat on it; in open space: round, the same from every side)
    const ax: [V, V, V] = n ? frame(n, tan) : [tan, across, norm(cross(tan, across))];
    const sz: V = n ? [step * 0.9, w * 0.5, 0.001] : [step * 0.9, w * 0.5, w * 0.5];
    out.push({ p: q, ax, s: sz, c: s.colour, a: s.alpha * (s.material === 'washline' ? 0.85 : 1) * (0.75 + 0.25 * pr), rank, mark: s.mark, feature: s.feature, element: s.id, u, n1: s.profile ? n ?? undefined : undefined, profile: s.profile });
    if (s.material === 'washline' && n) out.push({ p: add(q, mul(n, 0.0005)), ax, s: [step * 1.4, w * 1.6, 0.001], c: s.colour, a: s.alpha * 0.12 * pr, rank: rank - 0.05, mark: s.mark, feature: s.feature, element: s.id, u });
  }
  return out;
}

/** a wash into splats */
export function depositWash(w: Wash, rnd: () => number, density = 1): Dep[] {
  const out: Dep[] = [], A = w.anchor, R = w.region;
  if (A.length < 2) return out;
  const nearest = (p: V) => { let d = Infinity, k = 0; for (let i = 0; i < A.length; i += 1) { const e = len(sub(A[i], p)); if (e < d) { d = e; k = i; } } return { d, k }; };
  const reach = (k: number) => w.reach * (1 - w.uneven * 0.5 + w.uneven * (0.6 * 0.5 * (1 + Math.sin(w.phase + k * 0.07)) + 0.4 * 0.5 * (1 + Math.sin(w.phase * 1.7 + k * 0.21))));
  const heart = (f: number, k: number) => Math.max(f, Math.abs((2 * k) / Math.max(1, A.length - 1) - 1) * 0.85);
  const g = () => { let u = 0; for (let q = 0; q < 4; q++) u += rnd(); return (u - 2) / 0.58; };
  const rankOf = (f: number, k: number) => w.rank - w.span * heart(f, k);
  // (the firm edge: a band along the anchor, just inside the region, long along it)
  for (let k = 0; k < A.length; k++) {
    const a0 = A[k], tan = norm(sub(A[Math.min(A.length - 1, k + 1)], A[Math.max(0, k - 1)])), pa = R.project(a0); if (!pa) continue;
    let inw = norm(cross(pa.n, tan)); if (!R.on(add(a0, mul(inw, 0.02)))) inw = mul(inw, -1);
    if (!R.on(add(a0, mul(inw, 0.02)))) continue;
    for (let q = 0; q < 3 * density; q++) {
      const off = 0.006 + 0.022 * rnd() ** 1.5, pp = R.project(add(a0, mul(inw, off))); if (!pp || R.open?.(pp.p)) continue;
      const f = off / reach(k);
      if (w.material === 'dry') out.push({ p: add(pp.p, mul(pp.n, 0.0025)), ax: frame(pp.n, tan), s: [0.02, 0.0018, 0.001], c: w.colour, a: 0.7 * (1 - f), rank: rankOf(f, k), mark: w.mark, feature: w.feature, element: w.id, u: f });
      else out.push({ p: add(pp.p, mul(pp.n, 0.0025)), ax: frame(pp.n, tan), s: [0.024, 0.008 + 0.006 * rnd(), 0.001], c: w.colour, a: (0.1 + 0.12 * w.depth) * (1 - off * 18), rank: rankOf(f, k), mark: w.mark, feature: w.feature, element: w.id, u: f });
    }
  }
  // (the body: filled to a density within its reach of the anchor, leaving open what it leaves open)
  const want = Math.round(R.area * (w.material === 'dry' ? 900 : 420) * w.depth * density);
  for (let q = 0, got = 0; got < want && q < want * 14; q++) {
    const { p, n } = R.sample(rnd); if (R.open?.(p)) continue;
    const { d, k } = nearest(p), D = reach(k), f = d / D;
    if (f >= 1) continue;
    got++;
    if (w.material === 'dry') {
      if (rnd() > Math.pow(1 - f, 0.8)) continue;
      const dir = w.direction?.(p, n) ?? norm(cross(n, [0, 1, 0])), Ls = 0.016 + 0.045 * (1 - f) * (0.7 + 0.3 * rnd());
      out.push({ p: add(p, mul(n, 0.002)), ax: frame(n, dir), s: [Ls / 2, 0.0019, 0.001], c: w.colour, a: 0.5 + 0.3 * (1 - f), rank: rankOf(f, k), mark: w.mark, feature: w.feature, element: w.id, u: f });
    } else {
      const rad = Math.min(0.014 + 0.08 * f * (0.6 + 0.4 * rnd()), Math.max(0.007, d * 0.9));
      out.push({ p: add(p, mul(n, 0.002)), ax: frame(n, [g(), g(), g()]), s: [rad * 1.08, rad * 0.92, 0.002], c: w.colour, a: (0.17 - 0.1 * f) * (0.55 + 0.45 * w.depth), rank: rankOf(f, k), mark: w.mark, feature: w.feature, element: w.id, u: f });
    }
  }
  return out;
}

export function deposit(e: Element, rnd: () => number, density = 1): Dep[] { return e.kind === 'stroke' ? depositStroke(e, rnd, density) : depositWash(e, rnd, density); }

// ─── regions ───
/** a region of a plane: a point of it, its normal, and what's on it (a test in world space) */
export function planeRegion(n: V, through: V, on: (p: V) => boolean, extent = 1.4, open?: (p: V) => boolean): Region {
  const e1 = norm(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0])), e2 = cross(n, e1);
  const proj = (p: V): V => sub(p, mul(n, dot(sub(p, through), n)));
  const pick = (rnd: () => number) => add(through, add(mul(e1, (rnd() * 2 - 1) * extent), mul(e2, (rnd() * 2 - 1) * extent)));
  let r = 7; const rr = () => ((r = (r * 48271) % 2147483647) / 2147483647);
  let hit = 0; for (let k = 0; k < 3000; k++) if (on(pick(rr))) hit++;
  return {
    area: (hit / 3000) * (2 * extent) ** 2,
    sample: (rnd) => { for (let k = 0; k < 4000; k++) { const p = pick(rnd); if (on(p)) return { p, n }; } return { p: through, n }; },
    on: (p) => on(proj(p)), project: (p) => { const q = proj(p); return on(q) ? { p: q, n } : null; }, open,
  };
}
/** a region of an upright cylinder (axis at x z, from y0 to y1, radius r), over a range of angles */
export function cylinderRegion(x: number, z: number, r: number, y0: number, y1: number, a0: number, a1: number, open?: (p: V) => boolean): Region {
  const wrap = (a: number) => { let d = a - a0; while (d < 0) d += 2 * Math.PI; while (d >= 2 * Math.PI) d -= 2 * Math.PI; return d; };
  const span = wrap(a1) || 2 * Math.PI;
  const at = (a: number, y: number): { p: V; n: V } => ({ p: [x + Math.cos(a) * r, y, z + Math.sin(a) * r], n: [Math.cos(a), 0, Math.sin(a)] });
  return {
    area: span * r * (y1 - y0),
    sample: (rnd) => at(a0 + rnd() * span, y0 + rnd() * (y1 - y0)),
    on: (p) => p[1] >= y0 && p[1] <= y1 && wrap(Math.atan2(p[2] - z, p[0] - x)) <= span,
    project: (p) => { const a = Math.atan2(p[2] - z, p[0] - x); if (p[1] < y0 || p[1] > y1 || wrap(a) > span) return null; return at(a, p[1]); },
    open,
  };
}

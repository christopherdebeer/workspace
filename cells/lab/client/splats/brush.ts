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
 *
 * **Dependable deposition** (what makes the same instructions give the same drawing):
 * - *Identity*: an element's id is a hash of its key: given (`key`), or made from the scope it was made in and its place
 *   there (`scope('stone', ...)`: `stone/s0`, `stone/w3`, ...), or, outside any scope, from its content. Never from a
 *   global counter, so building one subject doesn't depend on what was built before it.
 * - *Randomness*: each element deposits from its own random stream, seeded by its id, so one element's marks don't
 *   change when another's do, and an edited stroke keeps its tremor.
 * - *Sampling*: strokes and washes are measured along their paths by arc length in scene units, so resampling the same
 *   curve gives the same drawing.
 * - *Density* changes fidelity, not tone: where marks are scattered (a wash's), d times as many are each 1/d as opaque
 *   (or, where that can't be, wider), so the light through the drawing is held (`faint`); a stroke's marks are spaced by
 *   the density and sized to their spacing, so their overlap, and tone, is the same at any. Checked by
 *   `splats.test.mjs` on a CPU rasterisation at 0.5, 1 and 2.
 * - *Support* is explicit on every splat (`SUPPORT`): on a surface (lies flat, takes the surface's depth under each
 *   corner), on an edge (a crease between two faces: shown by the profile, keeps its centre's depth), or free (in open
 *   space or a volume: round, keeps its centre's depth).
 */
import { alloc, type Splats } from './format';
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

/** where a splat is attached (render.ts reads it): none (a captured splat), a surface, an edge between two faces, free */
export const SUPPORT = { none: 0, surface: 1, edge: 2, free: 3 } as const;

/** a 32-bit hash of a string (FNV-1a, then mixed) */
export function hashKey(k: string): number {
  let h = 2166136261;
  for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return (h >>> 0) || 1;
}
/** a random stream from a seed (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const scopes: Array<{ name: string; n: Record<string, number> }> = [];
/** make elements within a named scope: those without a key are keyed by the scope and their order in it */
export function scope<T>(name: string, fn: () => T): T {
  const parent = scopes[scopes.length - 1];
  scopes.push({ name: parent ? `${parent.name}/${name}` : name, n: {} });
  try { return fn(); } finally { scopes.pop(); }
}
const r3 = (v: V) => v.map((x) => x.toFixed(3)).join(',');
function keyFor(kind: 's' | 'w', given: string | undefined, content: () => string): string {
  if (given) { const sc = scopes[scopes.length - 1]; return sc ? `${sc.name}/${given}` : given; }
  const sc = scopes[scopes.length - 1];
  if (sc) { const k = (sc.n[kind] = (sc.n[kind] ?? 0) + 1) - 1; return `${sc.name}/${kind}${k}`; }
  return `${kind}:${content()}`;
}

/** a path: points, and (lying on a surface) the surface's normal at each */
export interface Path { pts: V[]; normals?: V[] }
/**
 * A path from control points (the editable form of a stroke): a Catmull–Rom curve through them, resampled every `step`
 * (scene units), and, given a surface, each point taken onto it with its normal there (a point the surface won't take
 * keeps its place and the last normal).
 */
export function pathFrom(ctrl: V[], onto?: Region, step = 0.01): Path {
  const P = ctrl, pts: V[] = [];
  if (P.length < 2) return { pts: [...P] };
  const at = (i: number) => P[Math.max(0, Math.min(P.length - 1, i))];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2), n = Math.max(2, Math.ceil(len(sub(p2, p1)) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      pts.push([0, 1, 2].map((a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)) as V);
    }
  }
  pts.push(P[P.length - 1]);
  if (!onto) return { pts };
  let last: V = [0, 1, 0]; const out: V[] = [], ns: V[] = [];
  for (const p of pts) { const q = onto.project(p); if (q?.n) last = q.n; out.push(q ? q.p : p); ns.push(last); }
  return { pts: out, normals: ns };
}
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
  kind: 'stroke'; id: number; key: string; path: Path;
  /** which object of a scene it belongs to (1–255; 0 none): render.ts breaks a mark where a different, nearer object's
   * silhouette passes just in front of it (the halo) */
  object?: number; gesture: Gesture; material: Material; heart: Heart;
  colour: V; alpha: number; mark: number; feature: number;
  /** its rank (set by its group): when it goes as a whole; and how much of it goes before its heart */
  rank: number; span: number;
  /** the second face's normal, for a mark that shows only on the profile (render.ts: contour) */
  profile?: V;
}
export interface Region {
  /** a point on it at random, with the surface's normal there (none: a volume) */
  sample(rnd: () => number): { p: V; n?: V };
  /** its area (roughly) */
  area: number;
  /** whether a point is on it */
  on(p: V): boolean;
  /** a point taken onto it (and the normal there; none in a volume), or null */
  project(p: V): { p: V; n?: V } | null;
  /** places it leaves open (paper showing) */
  open?(p: V): boolean;
}
export interface Wash {
  kind: 'wash'; id: number; key: string; region: Region; object?: number; anchor: V[]; reach: number; material: 'wash' | 'dry';
  /** the hatching's direction at a point (dry) */
  direction?: (p: V, n: V) => V;
  /** how dark (0..1) */
  depth: number; colour: V; mark: number; feature: number; rank: number; span: number;
  /** how uneven its far boundary is (0 even) and the noise's phase */
  uneven: number; phase: number;
  /** an anchor of several pieces (`pieces`): the segments joining one piece to the next (left out), and each anchor
   * point's own reach (a multiple of `reach`) */
  cuts?: Set<number>; reachAt?: number[];
}
/** one anchor from several pieces, each with its own reach: for a wash anchored in several places at once (a ground
 * shadow made of every object's shadow, the same whichever object came first) */
export function pieces(parts: Array<{ pts: V[]; reach: number }>): { anchor: V[]; cuts: Set<number>; reachAt: number[] } {
  const anchor: V[] = [], cuts = new Set<number>(), reachAt: number[] = [];
  for (const pt of parts) { if (pt.pts.length < 2) continue; if (anchor.length) cuts.add(anchor.length - 1); for (const p of pt.pts) { anchor.push(p); reachAt.push(pt.reach); } }
  return { anchor, cuts, reachAt };
}
/**
 * What a scene knows about an element beyond its marks:
 * - `group`: the group it was drawn in (kept, not flattened: its principal, supports, accents and minimum stay
 *   reachable from every member);
 * - `structural`: part of its object's minimum description, the marks that must survive, together, for the object to
 *   read at all (shape, contact, overlap). Structure is decided separately from emphasis (how strong the contrasts
 *   are) and from material detail (what can go freely);
 * - `facing` / `toneArea`: for a wash that carries tone, the way its surface faces and how much of it there is, so a
 *   scene can work out, view by view, how much of an object's tone is in sight;
 * - `alt`: an anchored alternative description, shown only when the view calls for it (render.ts gates it by a value
 *   the scene sets each frame);
 * - `gate`: the index of that value.
 */
export interface Tags { group?: Group; structural?: boolean;
  /** its group's index in the scene (1-based), carried onto its marks for a drawing policy */
  gi?: number; facing?: V; toneArea?: number; alt?: string; gate?: number }
export type Element = (Stroke | Wash) & Tags;
/** a group as an object: its members by role, and its minimum (the structural members) */
export interface Group { key: string; rank: number; principal: Element | null; supports: Element[]; accents: Element[]; minimum: Element[] }

export function stroke(path: Path, gesture: Gesture, o: { key?: string; material?: Material; heart?: Heart; colour?: V; alpha?: number; mark?: number; feature?: number; profile?: V } = {}): Stroke {
  const key = keyFor('s', o.key, () => `${path.pts.map(r3).join(';')}|${gesture.width}|${o.mark ?? 1}|${o.feature ?? 0}`);
  return { kind: 'stroke', id: hashKey(key), key, path, gesture, material: o.material ?? 'ink', heart: o.heart ?? 'middle', colour: o.colour ?? INK, alpha: o.alpha ?? 0.9, mark: o.mark ?? 1, feature: o.feature ?? 0, rank: 0.9, span: 0.3, profile: o.profile };
}
export function wash(region: Region, anchor: V[], o: { key?: string; reach?: number; material?: 'wash' | 'dry'; depth?: number; direction?: (p: V, n: V) => V; colour?: V; mark?: number; feature?: number; uneven?: number } = {}): Wash {
  const key = keyFor('w', o.key, () => `${anchor.map(r3).join(';')}|${o.reach ?? 0.3}|${o.depth ?? 0.6}|${o.material ?? 'wash'}|${o.mark ?? 2}`), id = hashKey(key);
  return { kind: 'wash', id, key, region, anchor, reach: o.reach ?? 0.3, material: o.material ?? 'wash', direction: o.direction, depth: o.depth ?? 0.6, colour: o.colour ?? INK, mark: o.mark ?? 2, feature: o.feature ?? 0, rank: 0.6, span: 0.5, uneven: o.uneven ?? 0.35, phase: (id % 6283) / 1000 };
}
/**
 * A group: a principal, its supports, its accents, simplifying together. The group's rank is the principal's; the
 * supports go a step earlier and withdraw toward their anchors; the accents earlier again, the first the last of them.
 */
export function group(rank: number, principal: Element | null, supports: Element[] = [], accents: Element[] = [], key?: string): Element[] {
  const out: Element[] = [];
  if (principal) { principal.rank = rank; principal.span = 0.3; out.push(principal); }
  supports.forEach((s, k) => { s.rank = rank - 0.08 - 0.04 * k; s.span = 0.55; out.push(s); });
  accents.forEach((a, k) => { a.rank = rank - 0.2 - 0.07 * k; a.span = 0.35; out.push(a); });
  // (the group kept as itself: each member points to it; its minimum is whichever members are structural, read when
  // asked, so a scene can mark them after)
  const g: Group = { key: key ?? principal?.key ?? out[0]?.key ?? 'group', rank, principal, supports, accents, get minimum() { return out.filter((e) => e.structural); } };
  for (const e of out) e.group = g;
  return out;
}
/** the distinct groups of a list of elements, in order */
export function groupsOf(els: Element[]): Group[] { const seen = new Set<Group>(); for (const e of els) if (e.group) seen.add(e.group); return [...seen]; }

/** a splat as deposited: where, its axes and sizes, colour, and which element (and where along it) it came from */
export interface Dep { p: V; ax: [V, V, V]; s: V; c: V; a: number; rank: number; mark: number; feature: number; element: number; u: number; support: number; n1?: V; n2?: V; object?: number; gi?: number }
/**
 * A mark's opacity, and how much wider it must be, when `d` times as many are scattered over the same place: the marks
 * fall at random, so the light through a point is exp(−(number over it × opacity × footprint)) on average, and holding
 * that means dividing the opacity by `d`; where that would pass nearly opaque (few strong marks, at a low density) the
 * rest goes into the mark's footprint instead.
 */
export function faint(a: number, d: number): [number, number] { const x = Math.max(0, a) / Math.max(1e-3, d); return x <= 0.95 ? [x, 1] : [0.95, x / 0.95]; }

function frame(n: V, along: V): [V, V, V] {
  let t = sub(along, mul(n, dot(along, n)));
  if (len(t) < 1e-6) t = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
  t = norm(sub(t, mul(n, dot(t, n))));
  return [t, cross(n, t), n];
}
const heartDist = (h: Heart, u: number) => (h === 'middle' ? Math.abs(2 * u - 1) : h === 'ends' ? 1 - Math.abs(2 * u - 1) : Math.min(1, Math.abs(u - h) / Math.max(h, 1 - h)));

/** a stroke into splats, at a density (1 as made; less, fewer and longer: each mark's length follows its spacing, so the
 * overlap, and so the tone, is the same at any density) */
export function depositStroke(s: Stroke, density = 1, rnd: () => number = rng(s.id)): Dep[] {
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
    const support = s.profile ? SUPPORT.edge : n ? SUPPORT.surface : SUPPORT.free;
    out.push({ p: q, ax, s: sz, c: s.colour, a: s.alpha * (s.material === 'washline' ? 0.85 : 1) * (0.75 + 0.25 * pr), rank, mark: s.mark, feature: s.feature, element: s.id, u, support, n1: n ?? undefined, n2: s.profile });
    if (s.material === 'washline') out.push({ p: n ? add(q, mul(n, 0.0005)) : q, ax, s: n ? [step * 1.4, w * 1.6, 0.001] : [step * 1.4, w * 1.6, w * 1.6], c: s.colour, a: s.alpha * 0.12 * pr, rank: rank - 0.05, mark: s.mark, feature: s.feature, element: s.id, u, support: n ? SUPPORT.surface : SUPPORT.free, n1: n ?? undefined });
  }
  return out;
}

/**
 * A wash into splats. Measured along its anchor by arc length (scene units): the reach's unevenness and the heart vary
 * with distance along it, the firm edge is laid at even spacing along it, and each point of the body is placed by its
 * true distance from the anchor polyline, so the same curve sampled differently gives the same wash. Its marks' number
 * grows with the density at fixed sizes, so each is made fainter to keep the tone. On a volume region (no normals) its
 * marks are round and free; the firm edge is then a core round the anchor.
 */
export function depositWash(w: Wash, density = 1, rnd: () => number = rng(w.id)): Dep[] {
  const out: Dep[] = [], A = w.anchor, R = w.region;
  if (A.length < 2) return out;
  const cum = [0]; for (let i = 1; i < A.length; i++) cum.push(cum[i - 1] + len(sub(A[i], A[i - 1])));
  const L = cum[cum.length - 1] || 1e-6;
  const cuts = w.cuts, RA = w.reachAt;
  /** the nearest point of the anchor: its distance, how far along (arc length), and that place's own reach */
  const nearest = (p: V) => {
    let d = Infinity, s = 0, k = 1;
    for (let i = 0; i < A.length - 1; i++) {
      if (cuts?.has(i)) continue;
      const e = sub(A[i + 1], A[i]), l2 = dot(e, e) || 1e-12, t = Math.max(0, Math.min(1, dot(sub(p, A[i]), e) / l2)), q = add(A[i], mul(e, t)), dd = len(sub(p, q));
      if (dd < d) { d = dd; s = cum[i] + t * Math.sqrt(l2); k = RA ? RA[i] + (RA[i + 1] - RA[i]) * t : 1; }
    }
    return { d, s, k };
  };
  const pointAt = (s: number): { p: V; tan: V; cut: boolean; k: number } => {
    let i = 0; while (i < A.length - 2 && cum[i + 1] < s) i++;
    const t = Math.max(0, Math.min(1, (s - cum[i]) / Math.max(1e-9, cum[i + 1] - cum[i])));
    return { p: add(A[i], mul(sub(A[i + 1], A[i]), t)), tan: norm(sub(A[i + 1], A[i])), cut: !!cuts?.has(i), k: RA ? RA[i] + (RA[i + 1] - RA[i]) * t : 1 };
  };
  // (its far boundary's unevenness: two waves along the anchor, wavelengths in scene units)
  const reach = (s: number, k = 1) => k * w.reach * (1 - w.uneven * 0.5 + w.uneven * (0.6 * 0.5 * (1 + Math.sin(w.phase + s * 6.5)) + 0.4 * 0.5 * (1 + Math.sin(w.phase * 1.7 + s * 19.5))));
  const heart = (f: number, s: number) => Math.max(f, Math.abs((2 * s) / L - 1) * 0.85);
  const g = () => { let u = 0; for (let q = 0; q < 4; q++) u += rnd(); return (u - 2) / 0.58; };
  const rankOf = (f: number, s: number) => w.rank - w.span * heart(f, s);
  const base = { c: w.colour, mark: w.mark, feature: w.feature, element: w.id };
  // (the firm edge: a band along the anchor, just inside the region, long along it; laid every DS along the anchor)
  const DS = 0.012, edgeN = 3 * density;
  for (let s = DS / 2; s < L; s += DS) {
    const { p: a0, tan, cut, k: rk } = pointAt(s); if (cut) continue;
    const pa = R.project(a0); if (!pa) continue;
    let inw: V | null = null;
    if (pa.n) { inw = norm(cross(pa.n, tan)); if (!R.on(add(a0, mul(inw, 0.02)))) inw = mul(inw, -1); if (!R.on(add(a0, mul(inw, 0.02)))) continue; }
    for (let q = 0; q < edgeN; q++) {
      if (q + 1 > edgeN && rnd() > edgeN - q) break;
      const off = 0.006 + 0.022 * rnd() ** 1.5, f = off / reach(s, rk);
      // (on a surface, inward from the anchor; in a volume, any way across it)
      const dir = inw ?? norm(cross(tan, [g(), g(), g()]));
      const pp = R.project(add(a0, mul(dir, off))); if (!pp || R.open?.(pp.p)) continue;
      if (pp.n) {
        const at = add(pp.p, mul(pp.n, 0.0025));
        if (w.material === 'dry') { const [a, k] = faint(0.7 * (1 - f), density); out.push({ ...base, p: at, ax: frame(pp.n, tan), s: [0.02, 0.0018 * k, 0.001], a, rank: rankOf(f, s), u: f, support: SUPPORT.surface, n1: pp.n }); }
        else { const [a, k] = faint((0.1 + 0.12 * w.depth) * (1 - off * 18), density); out.push({ ...base, p: at, ax: frame(pp.n, tan), s: [0.024 * Math.sqrt(k), (0.008 + 0.006 * rnd()) * Math.sqrt(k), 0.001], a, rank: rankOf(f, s), u: f, support: SUPPORT.surface, n1: pp.n }); }
      } else {
        const [a, k] = faint((0.1 + 0.12 * w.depth) * (1 - off * 18), density), r = (0.008 + 0.006 * rnd()) * Math.cbrt(k);
        out.push({ ...base, p: pp.p, ax: frame(norm([g(), g(), g()]), tan), s: [r, r, r], a, rank: rankOf(f, s), u: f, support: SUPPORT.free });
      }
    }
  }
  // (the body: filled to a density within its reach of the anchor, leaving open what it leaves open)
  const want = Math.round(R.area * (w.material === 'dry' ? 900 : 420) * w.depth * density);
  for (let q = 0, got = 0; got < want && q < want * 14; q++) {
    const { p, n } = R.sample(rnd); if (R.open?.(p)) continue;
    const { d, s, k } = nearest(p), D = reach(s, k), f = d / D;
    if (f >= 1) continue;
    got++;
    if (!n) {
      // (a volume: round soft marks, larger away from the anchor)
      const [a, k] = faint((0.17 - 0.1 * f) * (0.55 + 0.45 * w.depth), density), rad = Math.min(0.014 + 0.08 * f * (0.6 + 0.4 * rnd()), Math.max(0.007, d * 0.9)) * Math.cbrt(k);
      out.push({ ...base, p, ax: frame(norm([g(), g(), g()]), [1, 0, 0]), s: [rad, rad, rad], a, rank: rankOf(f, s), u: f, support: SUPPORT.free });
    } else if (w.material === 'dry') {
      if (rnd() > Math.pow(1 - f, 0.8)) continue;
      const dir = w.direction?.(p, n) ?? norm(cross(n, [0, 1, 0])), Ls = 0.016 + 0.045 * (1 - f) * (0.7 + 0.3 * rnd());
      const [a, k] = faint(0.5 + 0.3 * (1 - f), density);
      out.push({ ...base, p: add(p, mul(n, 0.002)), ax: frame(n, dir), s: [Ls / 2, 0.0019 * k, 0.001], a, rank: rankOf(f, s), u: f, support: SUPPORT.surface, n1: n });
    } else {
      const [a, k] = faint((0.17 - 0.1 * f) * (0.55 + 0.45 * w.depth), density), rad = Math.min(0.014 + 0.08 * f * (0.6 + 0.4 * rnd()), Math.max(0.007, d * 0.9)) * Math.sqrt(k);
      out.push({ ...base, p: add(p, mul(n, 0.002)), ax: frame(n, [g(), g(), g()]), s: [rad * 1.08, rad * 0.92, 0.002], a, rank: rankOf(f, s), u: f, support: SUPPORT.surface, n1: n });
    }
  }
  return out;
}

/** an element into splats, from its own random stream (each carrying the element's object) */
export function deposit(e: Element, density = 1): Dep[] {
  const d = e.kind === 'stroke' ? depositStroke(e, density) : depositWash(e, density);
  if (e.object) for (const m of d) m.object = e.object;
  if (e.gi) for (const m of d) m.gi = e.gi;
  return d;
}

/** splats as the renderer takes them, from deposits (each keeps its element, support, feature and both normals) */
export type Drawing = Splats & { mark: Uint8Array; rank: Float32Array; normal: Float32Array; normal2: Float32Array; support: Uint8Array; feature: Uint32Array; element: Uint32Array; object: Uint8Array; group: Uint32Array };
export function toSplats(deps: Dep[], extra = 0): Drawing {
  const n = deps.length + extra;
  const s = Object.assign(alloc(n), { mark: new Uint8Array(n), rank: new Float32Array(n), normal: new Float32Array(n * 3), normal2: new Float32Array(n * 3), support: new Uint8Array(n), feature: new Uint32Array(n), element: new Uint32Array(n), object: new Uint8Array(n), group: new Uint32Array(n) });
  deps.forEach((d, i) => {
    s.pos.set(d.p, i * 3); s.scale.set(d.s, i * 3); s.rot.set(quat(d.ax), i * 4);
    s.rgba.set([d.c[0], d.c[1], d.c[2], Math.round(Math.max(0, Math.min(1, d.a)) * 255)], i * 4);
    s.mark[i] = d.mark; s.rank[i] = Math.max(0, Math.min(1, d.rank)); s.normal.set(d.n1 ?? d.ax[2], i * 3); if (d.n2) s.normal2.set(d.n2, i * 3);
    s.support[i] = d.support; s.feature[i] = d.feature; s.element[i] = d.element; s.object[i] = d.object ?? 0; s.group[i] = d.gi ?? 0;
  });
  return s;
}
/** a rotation (unit quaternion w x y z) from an orthonormal frame (its three axes, the columns) */
export function quat([x, y, z]: [V, V, V]): [number, number, number, number] {
  const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2], tr = m00 + m11 + m22;
  let w, a, b, c;
  if (tr > 0) { const q = Math.sqrt(tr + 1) * 2; w = q / 4; a = (m21 - m12) / q; b = (m02 - m20) / q; c = (m10 - m01) / q; }
  else if (m00 > m11 && m00 > m22) { const q = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / q; a = q / 4; b = (m01 + m10) / q; c = (m02 + m20) / q; }
  else if (m11 > m22) { const q = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / q; a = (m01 + m10) / q; b = q / 4; c = (m12 + m21) / q; }
  else { const q = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / q; a = (m02 + m20) / q; b = (m12 + m21) / q; c = q / 4; }
  const l = Math.hypot(w, a, b, c); return [w / l, a / l, b / l, c / l];
}

// ─── regions ───
/** a region of a plane: a point of it, its normal, and what's on it (a test in world space) */
export function planeRegion(n: V, through: V, on: (p: V) => boolean, extent = 1.4, open?: (p: V) => boolean): Region {
  const e1 = norm(Math.abs(n[1]) < 0.9 ? cross(n, [0, 1, 0]) : cross(n, [1, 0, 0])), e2 = cross(n, e1);
  const proj = (p: V): V => sub(p, mul(n, dot(sub(p, through), n)));
  const pick = (rnd: () => number) => add(through, add(mul(e1, (rnd() * 2 - 1) * extent), mul(e2, (rnd() * 2 - 1) * extent)));
  // (its area, measured the first time it's asked: so a region whose test depends on things made after it, such as a
  // shadow kept off later objects' footprints, is measured once they all exist)
  let area: number | null = null;
  const measure = () => { let r = 7; const rr = () => ((r = (r * 48271) % 2147483647) / 2147483647); let hit = 0; for (let k = 0; k < 3000; k++) if (on(pick(rr))) hit++; return (hit / 3000) * (2 * extent) ** 2; };
  return {
    get area() { return (area ??= measure()); },
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
/** a volume: an ellipsoid round a centre (radii along x y z); its points have no normal, so marks in it are free. Its
 * "area" (what sets a wash's number of marks) is its broadest cross-section, not its volume: seen from any side its marks
 * pile up through its depth, so it's filled to the tone of a surface the size of its silhouette */
export function volumeRegion(c: V, r: V, open?: (p: V) => boolean): Region {
  const inside = (p: V) => ((p[0] - c[0]) / r[0]) ** 2 + ((p[1] - c[1]) / r[1]) ** 2 + ((p[2] - c[2]) / r[2]) ** 2 <= 1;
  const [ra, rb] = [...r].sort((a, b) => b - a);
  return {
    area: Math.PI * ra * rb,
    sample: (rnd) => { for (let k = 0; k < 200; k++) { const p: V = [c[0] + (rnd() * 2 - 1) * r[0], c[1] + (rnd() * 2 - 1) * r[1], c[2] + (rnd() * 2 - 1) * r[2]]; if (inside(p)) return { p }; } return { p: c }; },
    on: inside, project: (p) => (inside(p) ? { p } : null), open,
  };
}

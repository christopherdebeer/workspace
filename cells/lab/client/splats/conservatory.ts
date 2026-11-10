/**
 * The room (`?scene=room`): a flooded conservatory overtaken by a giant willow, drawn entirely as marks (marks.ts).
 *
 * Three regions round one looped route, the willow in the middle of the loop:
 * - **the root tunnel** (west): a boardwalk under roots arching over it, strands hanging, a wash of mist beyond;
 * - **the open pool** (north and east): stepping stones, a veil of water at the far side, a far bridge, and one
 *   gesture in open space attached to nothing;
 * - **the canopy** (south): a deck under hanging fronds (canopy.ts: washes far off, fronds close to).
 * There is no outline pass and no surface to shade: every mark is a stroke or a wash put there by the scene. Limbs
 * are strokes laid round a tube, so they are a band of the same weight from wherever they're seen. The styles the
 * marks are drawn in can be the ones fitted to the teacher's marks in the sparse studies (devtools/splats-marks-fit.mjs:
 * a root stroke's, a spray's, a veil's), or plain.
 *
 * Frozen: nothing moves unless the page asks (a mark's `sway`), and the water is still (its mirror is the renderer's).
 */
import { strokeMark, washMark, blobMark, paramRange, keyMarks, spine, knots, SP, KN, RESID, type Mark, type V } from './marks';
import { canopyPatch, OLIVE, type Level, type LeafStyle } from './canopy';

/** fitted styles, by role: a stroke's or a wash's parameters */
export interface Styles { root?: number[]; strand?: number[]; dabs?: number[]; veil?: number[]; wash?: number[] }
export interface Room { marks: Mark[]; route: V[]; views: Record<string, { s: number; at: V }>; regions: Record<string, number>;
  /** its level solids (the deck, the boardwalk, the stones' tops) as triangles: what `occluder` starts from */
  solids: number[] }
/**
 * What a mark is, for teaching: marks of one role share a style. (A trunk, an arch, a lesser limb; a strand, its dabs,
 * a canopy's wash; mist; a plank, a post, an edge; a stone's rim, far side, wash and waterline; the veil; a thin line
 * of the far bridge or the house; the gesture; a leaf; the rag.)
 */
export function roleOf(name = ''): string {
  const last = name.slice(name.lastIndexOf('/') + 1);
  // (a limb in parts: each part of each kind of limb its own role, so each can be weighed)
  const part = last === 'near' || last === 'edges' || last === 'sweep' ? ` ${last}` : '';
  if (name.startsWith('willow/trunk')) return `trunk${part}`; if (name.startsWith('tunnel/arch')) return `arch${part}`;
  if (name.startsWith('willow/') || name.startsWith('tunnel/root')) return `limb${part}`;
  if (/^strand \d+$/.test(last)) return 'strand'; if (/^dabs \d+$/.test(last)) return 'dabs';
  if (name.startsWith('pool/stone')) return name.endsWith('rim') ? 'stone rim' : name.endsWith('far') ? 'stone far' : name.endsWith('wash') ? 'stone wash' : 'waterline';
  if (last === 'wash') return 'canopy wash';
  if (name === 'tunnel/mist' || name === 'pool/veil mist' || name === 'house/far canopy') return 'mist';
  if (last === 'plank') return 'plank'; if (last.endsWith('post') && !name.startsWith('pool/bridge')) return 'post';
  if (last === 'edge' || name === 'canopy/deck edge' || name === 'canopy/rail') return 'edge';
  if (/^pool\/veil \d/.test(name)) return 'veil'; if (name.startsWith('pool/gesture')) return 'gesture'; if (name === 'house/leaf') return 'leaf'; if (name === 'canopy/rag') return 'rag';
  return 'line';
}
/**
 * A route for the eventual test: six views nothing has been taught from, fitted to, or used to choose between ways of
 * drawing. The eight views in `Room.views` have all been used for one or another of those (three to teach from; the
 * other five to compare representations, twice: they validate now, they don't test). These stand between them on the
 * same loop and look other ways. They aren't shown on the page, and nothing should be chosen by looking at them.
 */
export const TEST_VIEWS: Record<string, { s: number; at: V }> = {
  'the tunnel mouth': { s: 0.4 / 14, at: [-5.5, 2.4, -0.5] }, 'out through the roots': { s: 2.3 / 14, at: [1.5, 1.8, -1.5] }, 'the tunnel from the pool': { s: 5.4 / 14, at: [-6.3, 2.2, 0.6] },
  'the willow from the east': { s: 7.8 / 14, at: [1, 3, 0.5] }, 'down the deck': { s: 10.2 / 14, at: [-2, 1.4, 8.4] }, 'up into the canopy': { s: 12.3 / 14, at: [1.2, 3.9, 5.8] },
};
/**
 * What the room was taught from drawn views (devtools/splats-room-fit.mjs), kept by role and by each mark's key (so
 * adding a mark to the scene moves nothing onto another):
 * - `roles`: for each role, an offset to every parameter of every mark of that role (a style, shared);
 * - `gains`: a mark's own weight: a stroke's ink, width and dryness; a wash's tone and size;
 * - `resid`: a mark's deposits' own residuals (as the mark keeps them).
 */
export interface Taught { roles: Record<string, number[]>; gains?: Record<string, number[]>; resid?: Record<string, number[]>; note?: string }
export function applyTaught(marks: Mark[], T: Taught): Mark[] {
  for (const m of marks) {
    // (a limb drawn as a stroke keeps its own style; what's taught to it is only how much ink it carries)
    if (m.band) { const o = T.roles[m.role ?? roleOf(m.name)], gb = T.gains?.[m.key ?? '']; for (let j = 0; j < SP.width; j++) { const [lo, hi] = paramRange(m, j); m.params[j] = Math.max(lo, Math.min(hi, m.params[j] + (o?.[j] ?? 0) + (gb?.[0] ?? 0))); } continue; }
    // (formed leaves keep their own style too: read off the teacher's leaves, not taught by tone)
    if (m.leaf) continue;
    const off = T.roles[m.role ?? roleOf(m.name)], g = T.gains?.[m.key ?? ''], stroke = m.kind === 'stroke';
    for (let j = 0; j < m.params.length; j++) {
      let v = m.params[j] + (off?.[j] ?? 0);
      if (g) { if (stroke) { if (j < SP.width) v += g[0]; else if (j < SP.u0) v += g[1]; else if (j >= SP.dry && j < SP.drySide) v += g[2]; } else v += j < 9 ? g[0] : g[1]; }
      const [lo, hi] = paramRange(m, j); m.params[j] = Math.max(lo, Math.min(hi, v));
    }
    const r = T.resid?.[m.key ?? '']; if (r && r.length === m.count * RESID) m.resid = r.slice();
  }
  return marks;
}
/**
 * A limb as a loaded stroke: its style, shared by every limb (devtools/splats-root.mjs fits it so the room's limbs
 * read as the teacher's strokes do in their own frame): its ink and dryness, how long and wide its deposits, how
 * thick its band (`arc`), how sharply it ends inside (`fall`), how its thickness wavers (`bristle`); and how much each
 * limb's own pressure varies along it: its ink (`vink`), its width (`vwide`), its side-to-side (`voff`).
 */
export interface RootStyle { ink: number; dry: number; along: number; spread: number; arc: number; fall: number; bristle: number; vink?: number; vwide?: number; voff?: number }
/** a limb made a stroke whose band is as it's seen (marks.ts `band: 'seen'`), in a style; its own pressure from its id */
export function asSeen(m: Mark, style: RootStyle, base: number[] = m.params): Mark {
  const P = m.params, set = (j: number, v: number) => { const [lo, hi] = paramRange(m, j); P[j] = Math.max(lo, Math.min(hi, v)); };
  const xi = (k: number, salt: number) => { let h = (Math.imul(m.id | 0, 374761393) + Math.imul(k + 1, 668265263) + Math.imul(salt, 2147483647)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1; };
  const w0 = base.slice(SP.width, SP.width + KN.width);
  for (let k = 0; k < KN.ink; k++) set(SP.ink + k, style.ink + (style.vink ?? 0) * 3 * xi(k, 1)); for (let k = 0; k < KN.dry; k++) set(SP.dry + k, style.dry);
  for (let k = 0; k < KN.width; k++) set(SP.width + k, w0[k] + (style.vwide ?? 0) * xi(k, 2)); for (let k = 0; k < KN.offset; k++) set(SP.offset + k, (style.voff ?? 0) * xi(k, 3));
  set(SP.along, style.along); set(SP.spread, style.spread); m.band = 'seen'; m.shade = 0; set(SP.arc, style.arc); set(SP.fall, style.fall); set(SP.bristle, style.bristle);
  return m;
}
/**
 * A limb by how large it looks, as the teacher draws one from its bare geometry: far off, where it's narrow on the
 * screen, one loaded stroke filling it; close to, where it's wide, a line along each of its edges and a dry, graded
 * stroke between, darkest to one side. Three marks on the one limb, the far one handing over to the near two by the
 * limb's width on the screen (marks.ts `lod`, set from the limb's own radius): `hand` the two widths between which it
 * hands over (log2 of the limb's half-width in screen heights).
 */
export interface RootParts { far: RootStyle; near: RootStyle;
  /** close to, under the loaded stroke: a broad pale sweep across most of the limb, dry */
  sweep?: RootStyle; edges: { ink: number; dry: number; arc: number; fall: number; spread: number; along: number }; hand: [number, number]; up?: boolean }
export function limbParts(m: Mark, R: RootParts): Mark[] {
  const copy = (name: string): Mark => ({ ...m, name: `${m.name}/${name}`, params: m.params.slice(), resid: m.resid.slice(), view: m.view.slice() });
  const r = 0.5 * (m.width ?? 0.1), lo = R.hand[0] - Math.log2(r), hi = R.hand[1] - Math.log2(r), base = m.params.slice();
  const far = asSeen(m, R.far, base); far.bandUp = R.up; far.lod = [hi, lo];
  const near = asSeen(copy('near'), R.near, base); near.bandUp = R.up; near.lod = [lo, hi]; near.ghost = true;
  const ed = copy('edges'), set = (j: number, v: number) => { const [a, b] = paramRange(ed, j); ed.params[j] = Math.max(a, Math.min(b, v)); };
  for (let k = 0; k < KN.ink; k++) set(SP.ink + k, R.edges.ink); for (let k = 0; k < KN.dry; k++) set(SP.dry + k, R.edges.dry); for (let k = 0; k < KN.width; k++) set(SP.width + k, far.params[SP.width + k]); for (let k = 0; k < KN.offset; k++) set(SP.offset + k, far.params[SP.offset + k]);
  set(SP.arc, R.edges.arc); set(SP.fall, R.edges.fall); set(SP.spread, R.edges.spread); set(SP.along, R.edges.along); ed.band = 'edges'; ed.bandUp = undefined; ed.shade = 0; ed.lod = [lo, hi]; ed.ghost = true;
  const out = [far, near, ed];
  if (R.sweep) { const sw = asSeen(copy('sweep'), R.sweep, base); sw.bandUp = R.up; sw.lod = [lo, hi]; sw.ghost = true; out.push(sw); }
  return out;
}
/**
 * A limb as one sweep of a loaded brush (marks.ts `sweep`), with or without accents: stretches of a line along one
 * edge or the other, each there or not on its own. Which side the sweep is loaded on is the stroke's own (from its
 * key; `upper`: how many of them the upper, as the teacher's are: the variation between strokes is kept, not made a
 * rule), and so are where its accents fall. `deposits`: about how many the limb lays (its rows all round, as many
 * columns as that allows).
 */
export interface SweepStyle { ink: number; fall: number; along: number; spread: number; tmin: number; tmax: number; dry: number; decay: number; vary: number; taper: number; jitter: number; runs?: number; wet?: number; ragged?: number; rows?: number; upper: number; accent?: AccentStyle }
/** a sweep's accents: a line along an edge: its ink, how thin (`arc`), how much of the limb's length one runs (`share`,
 * each its own length about that), and how often an edge has one at all (`there`; each edge on its own) */
export interface AccentStyle { ink: number; arc: number; share: number; there?: number }
export function limbSweep(m: Mark, S: SweepStyle, deposits = 1900): Mark[] {
  const rnd = (salt: number) => { let h = (Math.imul(m.id | 0, 374761393) + Math.imul(salt, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const rows = S.rows ?? 24, acc = S.accent ? Math.round(deposits * 0.22) : 0, set = (q: Mark, j: number, v: number) => { const [lo, hi] = paramRange(q, j); q.params[j] = Math.max(lo, Math.min(hi, v)); };
  const sw = m; sw.rows = rows; sw.count = rows * Math.max(8, Math.round((deposits - acc) / rows)); sw.resid = new Array(sw.count * RESID).fill(0);
  for (let k = 0; k < KN.ink; k++) set(sw, SP.ink + k, S.ink); for (let k = 0; k < KN.dry; k++) set(sw, SP.dry + k, 0); for (let k = 0; k < KN.offset; k++) set(sw, SP.offset + k, 0);
  set(sw, SP.along, S.along); set(sw, SP.spread, S.spread); set(sw, SP.fall, S.fall); set(sw, SP.bristle, S.ragged ?? 0.3); sw.band = 'seen'; sw.shade = 0; sw.bandUp = rnd(1) < S.upper;
  sw.sweep = { tmin: S.tmin, tmax: S.tmax, dry: S.dry, decay: S.decay, vary: S.vary, taper: S.taper, jitter: S.jitter, runs: S.runs, wet: S.wet };
  const out = [sw];
  if (S.accent) for (const up of [true, false]) for (const half of [0, 1]) {
    // (an accent: a stretch of this edge, somewhere in this half of the limb; each there or not on its own)
    const salt = (up ? 10 : 20) + half * 4; if (rnd(salt) > (S.accent.there ?? 0.75)) continue;
    // (a line needs few rows round the limb: only those edge-on to the eye show)
    const len = Math.min(0.44, (S.accent.share / 2) * (0.6 + 0.8 * rnd(salt + 1))), at = half * 0.5 + 0.02 + rnd(salt + 2) * (0.46 - len), end = at + len, arows = 12, cols = Math.max(4, Math.round(acc / 4 / arows));
    const e: Mark = { ...m, name: `${m.name}/accent ${up ? 'upper' : 'lower'} ${half}`, params: m.params.slice(), rows: arows, count: arows * cols, resid: new Array(arows * cols * RESID).fill(0), view: m.view.slice(), sweep: undefined, band: 'edges', bandUp: up, ghost: true, span: [Math.max(0, at - 0.03), Math.min(1, end + 0.03)] };
    for (let k = 0; k < KN.ink; k++) set(e, SP.ink + k, S.accent.ink); set(e, SP.arc, S.accent.arc); set(e, SP.fall, 3); set(e, SP.spread, -0.3); set(e, SP.along, 0); for (let k = 0; k < KN.dry; k++) set(e, SP.dry + k, 0.3); set(e, SP.u0, at); set(e, SP.u1, end); set(e, SP.sharp0, -1); set(e, SP.sharp1, -1.5);
    out.push(e);
  }
  return out;
}
/**
 * What hides what: the room's solids as triangles, for the renderer's depth and the fitter's. A drawing made only of
 * marks still needs its unpainted interiors to conceal what's behind them: the deck, the boardwalk and the stones
 * (level, just under their marks), and each limb as a tube just inside its deposits, as wide as the limb is drawn now.
 */
export function occluder(room: Room): Float32Array {
  const tris: number[] = [...room.solids], SIDES = 8;
  for (const m of room.marks) {
    if (m.normal !== 'tube' || m.ghost) continue;
    const S = spine(m), w0 = m.width ?? 0.1, n = S.pts.length, ring = (i: number): V[] => {
      const a = S.pts[Math.max(0, i - 1)], b = S.pts[Math.min(n - 1, i + 1)], t: V = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], tl = Math.hypot(t[0], t[1], t[2]) || 1; t[0] /= tl; t[1] /= tl; t[2] /= tl;
      const up: V = Math.abs(t[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0], d = up[0] * t[0] + up[1] * t[1] + up[2] * t[2], N: V = [up[0] - t[0] * d, up[1] - t[1] * d, up[2] - t[2] * d], nl = Math.hypot(N[0], N[1], N[2]) || 1; N[0] /= nl; N[1] /= nl; N[2] /= nl;
      const B: V = [t[1] * N[2] - t[2] * N[1], t[2] * N[0] - t[0] * N[2], t[0] * N[1] - t[1] * N[0]], r = 0.5 * w0 * Math.exp(knots(m.params, SP.width, KN.width, S.cum[i] / S.L)) * 0.86, c = add(S.pts[i], N, knots(m.params, SP.offset, KN.offset, S.cum[i] / S.L) * w0);
      return Array.from({ length: SIDES }, (_, k) => { const th = (k / SIDES) * Math.PI * 2; return [c[0] + (N[0] * Math.cos(th) + B[0] * Math.sin(th)) * r, c[1] + (N[1] * Math.cos(th) + B[1] * Math.sin(th)) * r, c[2] + (N[2] * Math.cos(th) + B[2] * Math.sin(th)) * r] as V; });
    };
    let prev = ring(0);
    for (let i = 2; i < n; i += 2) { const cur = ring(Math.min(n - 1, i)); for (let k = 0; k < SIDES; k++) { const a = prev[k], b = prev[(k + 1) % SIDES], c = cur[k], d = cur[(k + 1) % SIDES]; tris.push(...a, ...b, ...d, ...a, ...d, ...c); } prev = cur; }
  }
  return new Float32Array(tris);
}
const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const lerp = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const UP: V = [0, 1, 0];

/** the route: a closed loop (the walking surface's height; the eye is 1.5 above it) */
export const ROUTE: V[] = [[-9.5, 0.3, 6], [-8.2, 0.3, 3.2], [-6.5, 0.3, 0.2], [-4.6, 0.3, -3], [-3, 0.3, -5.6], [-0.5, 0.15, -6.8], [3, 0.15, -6.6], [6.2, 0.15, -4.4], [8.2, 0.15, -1], [8.4, 0.2, 2.6], [7, 0.35, 6], [3.5, 0.35, 8], [-1, 0.35, 8.6], [-5.5, 0.33, 8.2]];
export const EYE = 1.5, WATER = 0;
/** a point of the route (s: 0…1 round the loop), and the way it's heading there */
export function routeAt(s: number, R: V[] = ROUTE): { p: V; dir: V } {
  const n = R.length, x = (((s % 1) + 1) % 1) * n, i = Math.floor(x), t = x - i, P = (k: number) => R[((i + k) % n + n) % n];
  const at = (t: number): V => { const p0 = P(-1), p1 = P(0), p2 = P(1), p3 = P(2), t2 = t * t, t3 = t2 * t; return [0, 1, 2].map((a) => 0.5 * (2 * p1[a] + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)) as V; };
  const a = at(t), b = at(t + 0.02), d: V = [b[0] - a[0], 0, b[2] - a[2]], l = Math.hypot(d[0], d[2]) || 1;
  return { p: a, dir: [d[0] / l, 0, d[2] / l] };
}

/**
 * `light`: where the light comes from (a unit vector), if it's somewhere: each limb's loaded stroke keeps to the side
 * turned away from it, and a stone's heavy rim to its far side. None: every limb inked along its underside and the
 * stones as they fell, which is how the room was when it was taught.
 */
export function conservatory(styles: Styles = {}, level: Level = 'both', taught?: Taught, light?: V, root?: RootStyle | RootParts, leaf?: LeafStyle): Room {
  let id = 1, r = 12345; const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
  const marks: Mark[] = [], regions: Record<string, number> = {}, solids: number[] = [];
  const quad = (a: V, b: V, c: V, d: V) => solids.push(...a, ...b, ...c, ...a, ...c, ...d);
  const count = (name: string, from: number) => { regions[name] = (regions[name] ?? 0) + marks.slice(from).reduce((a, m) => a + m.count, 0); };
  /** a limb: a stroke round a tube, tapering; in the root style if there is one */
  const limb = (ctrl: V[], width: number, name: string, taper = 0.9, cols = 0) => {
    let L = 0; for (let i = 1; i < ctrl.length; i++) L += Math.hypot(ctrl[i][0] - ctrl[i - 1][0], ctrl[i][1] - ctrl[i - 1][1], ctrl[i][2] - ctrl[i - 1][2]);
    const rows = width > 0.4 ? 12 : width > 0.2 ? 9 : 6, m = strokeMark(id++, ctrl, 'tube', width, rows * (cols || Math.max(10, Math.round(L / Math.max(0.09, width * 0.3)))), rows, name);
    if (styles.root) { m.params = styles.root.slice(); m.params[SP.u0] = -0.04; m.params[SP.u1] = 1.04; for (let k = 0; k < KN.offset; k++) m.params[SP.offset + k] *= 0.3; }
    else { for (let k = 0; k < KN.dry; k++) m.params[SP.dry + k] = 0.8; for (let k = 0; k < KN.ink; k++) m.params[SP.ink + k] = 0.9; }
    m.shade = 0.8; if (light) m.light = light;
    // (its own taper over whatever the style's width does, kept within a stroke's range)
    for (let k = 0; k < KN.width; k++) m.params[SP.width + k] = Math.max(-1.6, Math.min(0.6, m.params[SP.width + k] * 0.5 + 0.15 - taper * (k / (KN.width - 1))));
    marks.push(m); return m;
  };
  /** a thin line in open space (a rib, a rail, a strand) */
  const line = (ctrl: V[], width: number, n: number, ink: number, name: string, dry = 0.25) => { const m = strokeMark(id++, ctrl, undefined, width, n, 1, name); for (let k = 0; k < KN.ink; k++) m.params[SP.ink + k] = ink; for (let k = 0; k < KN.dry; k++) m.params[SP.dry + k] = dry; marks.push(m); return m; };
  /** a stroke on a level surface (a plank, a stone's rim, a dash on the water) */
  const flat = (ctrl: V[], width: number, n: number, ink: number, name: string, rows = 1, dry = 0.3) => { const m = strokeMark(id++, ctrl, UP, width, n, rows, name); for (let k = 0; k < KN.ink; k++) m.params[SP.ink + k] = ink; for (let k = 0; k < KN.dry; k++) m.params[SP.dry + k] = dry; marks.push(m); return m; };
  const tone = (m: Mark, t: number, edge = -1.2) => { for (let k = 0; k < 9; k++) m.params[k] = k === 4 ? t : t + edge * 0.5; return m; };

  // ─── the willow: a trunk of three limbs, its crown, its roots ───
  let from = marks.length;
  limb([[1.3, -0.3, 0.3], [1.0, 1.5, 0.1], [0.4, 3.2, -0.3], [-0.3, 4.6, -0.2], [-1.2, 5.6, 0.2]], 0.85, 'willow/trunk a', 0.7);
  limb([[0.6, -0.3, -0.4], [0.9, 1.4, -0.5], [1.5, 3.0, -0.9], [2.4, 4.4, -1.2], [3.6, 5.4, -1.0]], 0.7, 'willow/trunk b', 0.7);
  limb([[1.6, -0.3, -0.3], [1.7, 1.2, 0.3], [1.9, 2.8, 1.2], [2.2, 4.2, 2.4], [2.0, 5.2, 3.8]], 0.6, 'willow/trunk c', 0.7);
  limb([[2.0, 5.2, 3.8], [2.5, 5.6, 5.5], [3.5, 5.4, 7.5], [5, 4.9, 9]], 0.3, 'willow/crown south');
  limb([[2.2, 4.2, 2.4], [4, 4.8, 4], [6, 4.9, 6], [8, 4.4, 7.5]], 0.28, 'willow/crown south-east');
  limb([[-1.2, 5.6, 0.2], [-2.5, 5.9, 2.5], [-3, 5.6, 5], [-4, 5.0, 7.5]], 0.3, 'willow/crown south-west');
  limb([[3.6, 5.4, -1.0], [5.5, 5.8, -2], [7.5, 5.5, -3.5], [9.5, 4.8, -4]], 0.28, 'willow/crown east');
  limb([[-0.3, 4.6, -0.2], [-2.5, 5.2, -2], [-5, 5.4, -3], [-7.5, 5.0, -3.5]], 0.3, 'willow/crown west');
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + 0.3, c = Math.cos(a), s = Math.sin(a), l = 2.2 + rnd() * 1.4; limb([[1 + c * 0.5, 0.6, s * 0.5], [1 + c * l * 0.5, 0.75 + rnd() * 0.3, s * l * 0.5], [1 + c * l * 0.85, 0.3, s * l * 0.85], [1 + c * l, -0.2, s * l]], 0.16 + rnd() * 0.1, `willow/root ${k}`); }
  count('willow', from);

  // ─── the root tunnel: arches over the boardwalk, strands, a wash of mist beyond ───
  from = marks.length;
  const T0: V = [-8.5, 0, 4], T1: V = [-3.5, 0, -4.5], dT: V = [0.507, 0, -0.862], eT: V = [0.862, 0, 0.507];
  for (let i = 0; i < 6; i++) {
    const P = add(lerp(T0, T1, 0.08 + i * 0.17), dT, (rnd() - 0.5) * 0.8), lean = (rnd() - 0.5) * 1.2, h = 2.9 + rnd() * 0.7, w = 0.3 + rnd() * 0.25;
    limb([add(add(P, eT, 3.0 + rnd()), UP, -0.3), add(add(add(P, eT, 1.9), UP, h * 0.72), dT, lean * 0.4), add(add(add(P, eT, 0.2), UP, h), dT, lean), add(add(add(P, eT, -1.7), UP, h * 0.74), dT, lean * 0.6), add(add(P, eT, -2.9 - rnd() * 0.6), UP, -0.3)], w, `tunnel/arch ${i}`, 0.5);
  }
  for (let i = 0; i < 3; i++) limb([[1 - 0.3 * i, 0.5, 0.2 * i], [-1 - i * 0.4, 0.9 + 0.2 * i, 0.6 - i * 0.9], [-2.6 - i * 0.5, 0.35, 1.3 - i * 1.6], [-3.6 - i * 0.6, -0.25, 1.9 - i * 2.2]], 0.3, `tunnel/root ${i}`);
  for (let i = 0; i < 3; i++) for (const m of canopyPatch(0, { c: add(lerp(T0, T1, 0.2 + i * 0.3), UP, 2.5), r: [1.7, 0.5, 1.7], fronds: 12, seed: 40 + i, reach: 2.6 }, 'fronds', undefined, undefined, `tunnel/strands ${i}`, leaf)) marks.push(m);
  { const m = tone(blobMark(id++, [-3.6, 1.5, -4.4], [2.4, 1.5, 2.4], 20, 'tunnel/mist'), -2.0); m.lod = [-1.5, -2.5]; marks.push(m); }
  // (the boardwalk: planks as lines across it, its two edges, posts)
  const walk = (a: number, b: number, name: string) => {
    for (let s = a; s < b; s += 0.0032) {
      const { p, dir } = routeAt(s), ac: V = [-dir[2], 0, dir[0]], k = Math.round((s - a) / 0.0032);
      flat([add(p, ac, -0.62), p, add(p, ac, 0.62)], k % 3 ? 0.022 : 0.04, 9, k % 3 ? 0.2 : 1.1, `${name}/plank`);
      if (k % 5 === 0) for (const side of [-0.7, 0.7]) line([add(add(p, ac, side), UP, -0.35), add(add(p, ac, side), UP, 0.15), add(add(p, ac, side), UP, 0.5)], 0.07, 7, 1.6, `${name}/post`, 0.1);
    }
    // (the boardwalk as a solid, just under its planks)
    { let last: [V, V] | null = null; for (let s = a; s <= b + 1e-6; s += 0.0096) { const { p, dir } = routeAt(Math.min(b, s)), ac: V = [-dir[2], 0, dir[0]], q: [V, V] = [add(add(p, ac, -0.64), UP, -0.02), add(add(p, ac, 0.64), UP, -0.02)]; if (last) quad(last[0], last[1], q[1], q[0]); last = q; } }
    for (const side of [-0.64, 0.64]) { const pts: V[] = []; for (let s = a; s <= b + 1e-6; s += (b - a) / 14) { const { p, dir } = routeAt(s); pts.push(add(p, [-dir[2], 0, dir[0]], side)); } flat(pts, 0.03, 90, 0.9, `${name}/edge`, 1, 0.9); }
  };
  walk(0.0, 4 / 14, 'tunnel/boardwalk');
  count('tunnel', from);

  // ─── the open pool: stones, the veil, a far bridge, and one gesture in open space ───
  from = marks.length;
  for (let i = 0; i < 9; i++) {
    const { p, dir } = routeAt((4.45 + i * 0.56) / 14), ac: V = [-dir[2], 0, dir[0]], c = add(add(p, ac, (i % 2 ? 0.25 : -0.25)), UP, -p[1] + 0.12), rx = 0.5 + rnd() * 0.25, rz = 0.38 + rnd() * 0.2, fell = rnd() * 3, turn = light ? Math.atan2(-light[2], -light[0]) - 1.75 : fell;
    const ring = (a0: number, a1: number, n = 7): V[] => Array.from({ length: n }, (_, k) => { const a = a0 + ((a1 - a0) * k) / (n - 1) + turn; return [c[0] + Math.cos(a) * rx, c[1], c[2] + Math.sin(a) * rz] as V; });
    flat(ring(0.2, 3.3), 0.11, 54, 1.6, `pool/stone ${i} rim`, 3, 0.6); flat(ring(3.5, 6.1), 0.03, 20, 0.2, `pool/stone ${i} far`, 1, 0.8);
    for (let k = 0; k < 12; k++) { const a0 = (k / 12) * Math.PI * 2, a1 = ((k + 1) / 12) * Math.PI * 2; solids.push(c[0], c[1] - 0.02, c[2], c[0] + Math.cos(a0) * rx, c[1] - 0.02, c[2] + Math.sin(a0) * rz, c[0] + Math.cos(a1) * rx, c[1] - 0.02, c[2] + Math.sin(a1) * rz); }
    const poly = ring(0, 5.6, 9); marks.push(tone(washMark(id++, poly.map((q, k) => [c, q, poly[(k + 1) % poly.length]]), UP, 14, `pool/stone ${i} wash`), -1.3));
    flat([add(c, [-rx * 0.9, -0.115, rz * 1.15]), add(c, [0, -0.115, rz * 1.3]), add(c, [rx * 0.9, -0.115, rz * 1.15])], 0.02, 8, -0.4, `pool/stone ${i} waterline`);
  }
  for (let k = 0; k < 5; k++) { const x = 9.6 + k * 0.36, m = line([[x, 5.4, -8.2], [x + 0.03, 3.6, -8.2], [x - 0.02, 1.8, -8.15], [x, 0.05, -8.1]], 0.3, 54, -1.7, `pool/veil ${k}`); m.rows = 3; if (styles.veil) { m.params = styles.veil.slice(); } m.sway = 0.02; }
  marks.push(tone(blobMark(id++, [10.3, 0.5, -7.7], [1.5, 0.6, 1.1], 16, 'pool/veil mist'), -2.1));
  line([[9.2, 5.45, -8.3], [10.3, 5.5, -8.3], [11.4, 5.45, -8.3]], 0.06, 20, 0.6, 'pool/veil lip');
  // (the far bridge: its deck, its posts and the arches between them, all pale)
  line([[-10, 2.6, -15], [-3, 2.7, -15], [3, 2.7, -15], [10, 2.6, -15]], 0.07, 110, -0.3, 'pool/bridge deck'); line([[-10, 3.2, -15], [0, 3.3, -15], [10, 3.2, -15]], 0.035, 90, -1.0, 'pool/bridge rail', 0.8);
  for (let k = 0; k <= 8; k++) { const x = -9.6 + k * 2.4; line([[x, 2.6, -15], [x, 1.3, -15], [x, 0, -15]], 0.05, 14, -0.6, 'pool/bridge post'); if (k < 8) line([[x, 0.9, -15], [x + 0.6, 2.0, -15], [x + 1.2, 2.35, -15], [x + 1.8, 2.0, -15], [x + 2.4, 0.9, -15]], 0.035, 26, -1.0, 'pool/bridge arch'); }
  // (the gesture: a run of seeds on the air over the pool, joined by a dotted thread; it stands on nothing)
  { const g: V[] = [[3.6, 1.5, -2.6], [4.0, 1.85, -2.4], [4.5, 1.6, -2.1], [5.0, 1.35, -2.3], [5.5, 1.6, -2.6], [6.0, 1.3, -2.4], [6.3, 1.45, -2.0]];
    const th = line(g, 0.012, 34, 0.2, 'pool/gesture thread', 0); th.params[SP.along] = -1.0; th.sway = 0.03;
    g.forEach((p, k) => { const d = line([add(p, [-0.012, 0, 0]), p, add(p, [0.012, 0, 0])], 0.035, 2, 2.2, `pool/gesture seed ${k}`, 0); d.sway = 0.03; for (let h = 0; h < 6; h++) { const a = (h / 6) * Math.PI * 2 + k, e: V = [Math.cos(a) * 0.09, Math.sin(a) * 0.09, Math.sin(a * 1.7) * 0.03]; const t = line([add(p, e, 0.3), add(p, e, 0.65), add(p, e)], 0.006, 4, -0.2, `pool/gesture hair ${k}`, 0); t.sway = 0.03; } }); }
  for (const m of canopyPatch(0, { c: [9, 3.7, -4], r: [1.7, 1.0, 1.7], fronds: 50, seed: 7, reach: 1.2 }, level, undefined, styles.wash, 'pool/canopy', leaf)) marks.push(m);
  count('pool', from);

  // ─── the canopy: a deck under hanging fronds, its rail and a rag on it ───
  from = marks.length;
  for (let k = 0; k < 26; k++) { const x = 1.6 + k * 0.31; flat([[x, 0.35, 4.9], [x + 0.02, 0.35, 7.4], [x, 0.35, 9.7]], k % 4 ? 0.02 : 0.035, 22, k % 4 ? 0.1 : 0.9, 'canopy/plank', 1, 0.5); }
  quad([1.5, 0.33, 4.85], [9.6, 0.33, 4.85], [9.6, 0.33, 9.75], [1.5, 0.33, 9.75]);
  flat([[1.5, 0.35, 4.85], [5.5, 0.35, 4.85], [9.6, 0.35, 4.85]], 0.04, 60, 1.0, 'canopy/deck edge', 1, 0.7); flat([[1.5, 0.35, 9.75], [5.5, 0.35, 9.75], [9.6, 0.35, 9.75]], 0.04, 60, 1.0, 'canopy/deck edge', 1, 0.7);
  for (let k = 0; k <= 5; k++) { const x = 1.6 + k * 1.6; line([[x, 0.3, 9.8], [x, 0.9, 9.8], [x, 1.4, 9.8]], 0.08, 9, 1.7, 'canopy/rail post', 0.1); }
  line([[1.5, 1.38, 9.8], [5.5, 1.42, 9.8], [9.7, 1.38, 9.8]], 0.05, 80, 1.2, 'canopy/rail', 0.9);
  { const o: V = [4.9, 0.95, 9.82], rag = washMark(id++, [[o, [4.1, 1.36, 9.82], [5.7, 1.36, 9.82]], [o, [5.7, 1.36, 9.82], [5.5, 0.55, 9.82]], [o, [5.5, 0.55, 9.82], [4.6, 0.7, 9.82]], [o, [4.6, 0.7, 9.82], [4.1, 1.36, 9.82]]], [0, 0, -1], 18, 'canopy/rag'); marks.push(tone(rag, -1.9)); }
  const patches: Array<[V, number]> = [[[3.5, 3.6, 7.5], 80], [[6, 3.5, 6.2], 80], [[1.2, 3.7, 5.6], 70], [[-3.2, 3.8, 6.4], 70], [[7.6, 3.4, 8.6], 60], [[-7, 3.8, -3.4], 45]];
  patches.forEach(([c, n], k) => { for (const m of canopyPatch(0, { c, r: [1.8, 1.1, 1.8], fronds: n, seed: 20 + k, reach: 1.25 }, level, undefined, styles.wash, `canopy/patch ${k}`, leaf)) marks.push(m); });
  walk(12 / 14, 1, 'canopy/boardwalk');
  count('canopy', from);

  // ─── the glasshouse over it all, far masses of foliage, and a few leaves on the water ───
  from = marks.length;
  for (const z of [-17, -10.5, -4, 2.5, 9, 15]) line(Array.from({ length: 7 }, (_, k) => { const a = (k / 6) * Math.PI; return [-13.5 * Math.cos(a), 9.2 * Math.sin(a), z] as V; }), 0.05, 80, -1.9, 'house/rib', 0.5);
  line([[0, 9.2, -17], [0, 9.2, -1], [0, 9.2, 15]], 0.05, 90, -2.0, 'house/ridge', 0.5);
  for (const sx of [-1, 1]) line([[sx * 9.5, 6.5, -17], [sx * 9.5, 6.5, -1], [sx * 9.5, 6.5, 15]], 0.04, 90, -2.2, 'house/purlin', 0.5);
  marks.push(tone(blobMark(id++, [-6, 4.6, -13], [3.6, 1.8, 2], 22, 'house/far canopy'), -2.2), tone(blobMark(id++, [5.5, 5.6, -13.5], [4, 2, 2], 24, 'house/far canopy'), -2.3));
  for (let k = 0; k < 16; k++) { const x = -9 + rnd() * 19, z = -9 + rnd() * 17, a = rnd() * 3; const m = flat([[x, 0.004, z], [x + Math.cos(a) * 0.09, 0.004, z + Math.sin(a) * 0.09]], 0.035, 2, 0.6, 'house/leaf', 1, 0); m.colour = OLIVE; }
  count('house', from);

  if (styles.strand || styles.dabs) for (const m of marks) { if (styles.strand && /\/strand \d+$/.test(m.name ?? '')) { const lod = m.lod; m.params = styles.strand.slice(); m.lod = lod; } }
  keyMarks(marks, roleOf);
  if (root && 'far' in root) {
    // (each limb in its three parts: laid after its key and id are its own, so its parts share its pressure)
    const all: Mark[] = []; for (const m of marks) { if (m.normal === 'tube') all.push(...limbParts(m, root)); else all.push(m); }
    marks.length = 0; marks.push(...all); keyMarks(marks, roleOf);
  } else if (root) for (const m of marks) if (m.normal === 'tube') asSeen(m, root);
  if (taught) applyTaught(marks, taught);
  return { marks, route: ROUTE, regions, solids, views: { tunnel: { s: 1.15 / 14, at: [-4.2, 1.7, -3.6] }, pool: { s: 4.2 / 14, at: [3, 1.8, -2.5] }, canopy: { s: 11.3 / 14, at: [0.5, 2.4, -3] }, 'between tunnel and pool': { s: 4.5 / 14, at: [4, 1.4, -4] }, 'between pool and canopy': { s: 9.2 / 14, at: [4.5, 2.4, 7.5] }, 'between canopy and tunnel': { s: 13.4 / 14, at: [-7.5, 1.8, 2] }, 'back along the tunnel': { s: 3.3 / 14, at: [-8.2, 1.9, 3.4] }, 'sideways from the stones': { s: 6.6 / 14, at: [0.8, 2.6, 0.2] } } };
}

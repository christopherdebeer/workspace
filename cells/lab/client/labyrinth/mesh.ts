/**
 * The labyrinth's stone, as triangles: the intended solid and its resolution (model.ts), each face with how it's lit
 * (its normal, how shut in it is), what it's made of, and how it rises (when it was laid, the height it grows from).
 *
 * - **blocks**: their faces where nothing hides them, darker at the foot where they meet a floor;
 * - **stairs**: six steps up a level;
 * - **arches**: under a run of stone carried over nothing, an arch from the stone each side, springing as low as the
 *   resolution let it; the stone over it is spandrels each side and a deck, its underside lit from within;
 * - **piers**: slender columns under what has nothing else to stand on, with a base and a capital; stepped aside to the
 *   edge of their cell when they stand on a way, so it stays open;
 * - **thin walls**: a wall's thickness, full height, running out to the stone beside them;
 * - **courtyards**: paved; water where the rules put it, a rim round it; cypresses;
 * - **the stone and the table**: the travertine slab, on a table in the sun;
 * - **dressing**: each stone's kind (travertine, brick, marble), moss and ivy (drawn over it, in the shader), parapets
 *   (by hand, and along a bridge or a high arcade of their own accord), lanterns, pots with a shrub in them. Lintels: an arch read flat.
 *
 * x and z are centred on the slab; y up, the slab's top at 0.
 */
import { hash } from '../kit/rng';
import { character, look } from './character';
import { buildings, opening, underRoof, type Building, type Opening } from './buildings';
import { BUT, BUTH, BUTW, WT, buttresses, inBlock, outline, reach, wallCell, type Edge } from './form';
import { CENTER, DECK, DIRS, DRESS, key, unkey, type Span, type World } from './model';
import { LAND, surfaceY } from './land';
import { groundY, retaining } from './context';

/** floats a vertex: position, normal, ao (1 open .. 0 shut in), material (MAT), its rising (when laid, the height it
 * grows from, how), and a seed for its stone's tone */
export const STRIDE = 12;
export const MAT = { stone: 0, within: 1, water: 2, leaves: 3, bark: 4, slab: 5, slabSide: 6, table: 7, court: 8, lamp: 9, clay: 10, door: 11, glass: 12, tile: 13, lead: 14, wood: 15 };
/** the land (the slab's own, marked: drawn barely, its steep faces rock) */
export const LANDMAT = MAT.slab + 16;
/** how far a foundation goes down into the land under what's built on it */
export const FOUND = 0.75;
/** a material cut through (with KIND × 3 over stone: a jali; over wood: a mashrabiya's lattice) */
export const PIERCED = 3 * 64;
/** a stone's dressing, over its material (stone, or the light within an arch): 16 moss, 32 ivy, 64 × which stone
 * (travertine, brick, marble) */
export const MOSS = 16, IVY = 32, KIND = 64;
/** what's taken up (select): tinted, and outlined where it meets what isn't */
export const SEL = 256;
/** how deep a flat lintel is */
export const LINTEL = 0.34;
/** where an arch's underside is, across it (`u` from its middle): its crown's height `ys`, its rise, its half-width;
 * a lintel's is flat */
export function soffit(sp: Span) {
  const half = sp.n / 2, yD = sp.k + 1 - DECK;
  if (sp.flat) return { half, rise: 0, ys: sp.k + 1 - LINTEL, at: () => sp.k + 1 - LINTEL };
  const rise = Math.min(half, yD - sp.low), ys = yD - rise;
  return { half, rise, ys, at: (u: number) => ys + rise * Math.sqrt(Math.max(0, 1 - (u / half) ** 2)) };
}
export const MARGIN = 0.6, SLAB = 0.42;
const STEPS = 6, CURVE = 14, HW = 0.3;
/** how wide a block's bevelled edges are */
const BEVEL = 0.035;
/** a thin wall's half-thickness */
export const TH = 0.15;
/**
 * A pier's column: slender (the higher it stands and the taller it runs, the slimmer), and where it stands in its cell:
 * in the middle on open ground, but stepped aside to the cell's edge when it stands on a way (a walkway, a landing), so
 * the way past it stays open.
 */
export function pierShape(w: World, k: number, i: number, j: number): { ox: number; oz: number; r: number; foot: number; top: number; column: boolean } {
  let foot = k; while (w.pier(foot - 1, i, j)) foot--;
  let top = k; while (w.pier(top + 1, i, j)) top++;
  // (under a colonnade: a column, massive, in the middle of its cell)
  if (DIRS.some(([a, b]) => w.span(top + 1, i + a, j + b)?.order === 'colonnade')) return { ox: 0, oz: 0, r: 0.21, foot, top, column: true };
  const r = Math.max(0.1, 0.17 - 0.012 * foot - 0.006 * (top - foot));
  const way = DIRS.map(([a, b]) => w.floor(foot, i + a, j + b) && !w.stone(foot, i + a, j + b) && w.stair(foot, i + a, j + b) < 0);
  const n = way.filter(Boolean).length;
  if (n === 0 || n === 4 || (foot === 0 && n >= 3)) return { ox: 0, oz: 0, r, foot, top, column: false };
  // (to the side that isn't the way: across it if the way runs straight through, else away from where it comes in)
  const side = [0, 1, 2, 3].filter((d) => !way[d]).sort((p, q) => Number(way[(q + 2) % 4]) - Number(way[(p + 2) % 4]))[0];
  const o = 0.5 - r - 0.05;
  return { ox: DIRS[side][0] * o, oz: DIRS[side][1] * o, r, foot, top, column: false };
}
/** a block standing on a colonnade's column: drawn as the entablature's depth, the column running on up under it */
export function onColumn(w: World, k: number, i: number, j: number) { return w.block(k, i, j) && w.pier(k - 1, i, j) && pierShape(w, k - 1, i, j).column; }
/** which ways a thin wall runs out from its middle: toward stone beside it at its level, or, with none, along its axis */
export function wallArms(w: World, k: number, i: number, j: number): boolean[] {
  const arms = DIRS.map(([a, b]) => w.stone(k, i + a, j + b) || w.stair(k, i + a, j + b) >= 0);
  if (!arms.some(Boolean)) { const a = Math.max(0, w.wall(k, i, j)); arms[a] = arms[a + 2] = true; }
  return arms;
}

export interface Mesh { data: Float32Array; count: number }
type V3 = [number, number, number];
const X = (i: number) => i - CENTER, Z = (j: number) => j - CENTER;
const tone = (k: number, i: number, j: number) => (((k * 73856093) ^ (i * 19349663) ^ (j * 83492791)) >>> 0) / 4294967296;

/** the land drawn bleeding into the page (no sides, no table under it): see the renderer's `bleed` */
let bleed = false;
export const setBleed = (b: boolean) => { bleed = b; };
export function buildMesh(w: World, plain = false, selected: Set<number> = new Set()): Mesh {
  /** how a cell's dressed: the rules' dressing and the hand's (`plain`: the hand's alone) */
  const dressed = (k: number, i: number, j: number) => look(w, k, i, j, plain);
  const out: number[] = [];
  let cur = { born: -1e3, pivot: 0, how: 1, tone: 0, dress: 0, sel: false };
  /** a cell's dressing, as it's drawn over its stone */
  const dressOf = (k: number, i: number, j: number) => { const d = dressed(k, i, j); return d ? (d.mat ?? 0) * KIND + (d.moss ? MOSS : 0) + (d.ivy ? IVY : 0) : 0; };
  const at = (born: number, pivot: number, k: number, i: number, j: number, how = 1) => ({ born, pivot, how, tone: tone(k, i, j), dress: dressOf(k, i, j), sel: selected.has(key(k, i, j)) });
  const vert = (p: V3, n: V3, ao: number, mat: number) => out.push(p[0], p[1], p[2], n[0], n[1], n[2], ao, (mat === MAT.stone || mat === MAT.within ? mat + cur.dress : mat) + (cur.sel ? SEL : 0), cur.born, cur.pivot, cur.how, cur.tone);
  const quad = (a: V3, b: V3, c: V3, d: V3, n: V3, ao: number[] | number, mat: number) => {
    const A = typeof ao === 'number' ? [ao, ao, ao, ao] : ao;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const flip = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0;
    const P = flip ? [a, d, c, b] : [a, b, c, d], Q = flip ? [A[0], A[3], A[2], A[1]] : A;
    for (const k of [0, 1, 2, 0, 2, 3]) vert(P[k], n, Q[k], mat);
  };
  const tri = (a: V3, b: V3, c: V3, n: V3, ao: number, mat: number) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const flip = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0;
    for (const p of flip ? [a, c, b] : [a, b, c]) vert(p, n, ao, mat);
  };
  /** a face toward a neighbour hidden against it: a plain block, or a stair's back */
  const hides = (k: number, i: number, j: number, d: number) => {
    const ni = i + DIRS[d][0], nj = j + DIRS[d][1];
    // (against the land itself: no face)
    if (w.earth(k, ni, nj)) return true;
    if (w.block(k, ni, nj)) return !wallCell(w, k, ni, nj);
    const aw = w.archway(k, ni, nj);
    if (aw >= 0) return aw !== d % 2;
    const s = w.stair(k, ni, nj);
    return s >= 0 && (s + 2) % 4 === d;
  };
  const floored = (k: number, i: number, j: number) => !w.occupied(k, i, j) && w.floor(k, i, j);
  /** on the land, at its column's ground: what's built there goes down into it, so it meets the slope */
  const founded = (k: number, i: number, j: number) => !!w.land && k === w.ground(i, j);
  const cornerAo = (k: number, i: number, j: number) => {
    // (only a mass shuts the ground in by cells: a wall's thickness, curve or diagonal doesn't follow them)
    const s = (a: number, b: number) => (w.block(k, i + a, j + b) && !wallCell(w, k, i + a, j + b) ? 1 : 0);
    const c = (a: number, b: number) => { const s1 = s(a, 0), s2 = s(0, b), d = s(a, b); return s1 && s2 ? 0 : 3 - s1 - s2 - d; };
    return [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)].map((v) => 0.55 + v * 0.15);
  };
  const sides = (k: number, i: number, j: number, y0: number, y1: number, mat: number) => {
    const x0 = X(i), z0 = Z(j);
    for (let d = 0; d < 4; d++) {
      if (hides(k, i, j, d)) continue;
      const [a, b] = DIRS[d], foot = floored(k, i + a, j + b) ? 0.6 : 1;
      const A: V3 = a ? [a > 0 ? x0 + 1 : x0, y0, z0] : [x0, y0, b > 0 ? z0 + 1 : z0], B: V3 = a ? [A[0], y0, z0 + 1] : [x0 + 1, y0, A[2]];
      quad(A, B, [B[0], y1, B[2]], [A[0], y1, A[2]], [a, 0, b], [foot, foot, 1, 1], mat);
    }
  };
  /** a loop's corners moved in (or out, given less than nothing) along each edge's normal by as much as it says, each
   * corner where its two edges' new lines meet */
  const shift = (E: Edge[], by: (e: Edge) => number): Array<{ a: [number, number]; b: [number, number] }> => {
    const nOf = (e: Edge) => { const dx = e.b[0] - e.a[0], dz = e.b[1] - e.a[1], l = Math.hypot(dx, dz) || 1; return [dz / l, -dx / l, dx / l, dz / l]; };
    const pts = E.map((e2, n) => {
      const e1 = E[(n + E.length - 1) % E.length], [n1x, n1z, d1x, d1z] = nOf(e1), [n2x, n2z, d2x, d2z] = nOf(e2), o1 = by(e1), o2 = by(e2), v = e2.a;
      const cr = d1x * d2z - d1z * d2x;
      if (Math.abs(cr) < 1e-6) return [v[0] - n2x * Math.max(o1, o2), v[1] - n2z * Math.max(o1, o2)] as [number, number];
      // (t·d1 − s·d2 = n1·o1 − n2·o2)
      const rx = n1x * o1 - n2x * o2, rz = n1z * o1 - n2z * o2, t = (rx * -d2z - rz * -d2x) / (d1x * -d2z - d1z * -d2x);
      return [v[0] - n1x * o1 + t * d1x, v[1] - n1z * o1 + t * d1z] as [number, number];
    });
    return E.map((_, n) => ({ a: pts[n], b: pts[(n + 1) % E.length] }));
  };
  /**
   * A block, as its form says (form.ts): its outline drawn up from its floor, open sides only, an opening where a
   * building has one; its top edges bevelled and its top capped (in stone, over brick); a plinth splayed at its foot on
   * the stone, a cornice under a mass's top up high, a string course where the stone changes kind; a post's cap on a
   * wall where it turns or ends; buttresses along a long run.
   */
  const blockFaces = (k: number, i: number, j: number) => {
    const y0 = k, y1 = k + 1, B = BEVEL, cx = X(i) + 0.5, cz = Z(j) + 0.5;
    const ol = outline(w, k, i, j), E = ol.edges;
    const lid = !(w.stair(k + 1, i, j) >= 0) && !(w.block(k + 1, i, j) && wallCell(w, k + 1, i, j) === ol.wall), bt = lid ? B : 0;
    const L = (p: [number, number], y: number): V3 => [cx + p[0], y, cz + p[1]];
    const P = (d: number, s: number, y: number, inset = 0): V3 => { const [a, b] = DIRS[d], [ta, tb] = DIRS[(d + 1) % 4]; return [cx + a * (0.5 - inset) + ta * s, y, cz + b * (0.5 - inset) + tb * s]; };
    const brick = cur.dress >= KIND && Math.floor(cur.dress / KIND) === 1, keep = cur.dress, cap = () => { if (brick) cur.dress = keep - KIND; };
    const nOf = (e: Edge): V3 => { const dx = e.b[0] - e.a[0], dz = e.b[1] - e.a[1], l = Math.hypot(dx, dz) || 1; return [dz / l, 0, -dx / l]; };
    const footOf = (e: Edge) => (e.face >= 0 && floored(k, i + DIRS[e.face][0], j + DIRS[e.face][1]) ? 0.6 : e.face < 0 ? 0.8 : 1);
    const inner = shift(E, (e) => (lid && e.open ? B : 0));
    E.forEach((e, n) => {
      if (!e.open) return;
      const nv = nOf(e), foot = footOf(e);
      const op = e.face >= 0 && Math.abs(e.dist - 0.5) < 1e-6 ? opening(w, k, i, j, e.face) : null;
      if (op) { const [ta, tb] = DIRS[(e.face + 1) % 4]; holed(e.face, e.a[0] * ta + e.a[1] * tb, e.b[0] * ta + e.b[1] * tb, y0, y1 - bt, op, P, nv, foot); }
      else quad(L(e.a, y0), L(e.b, y0), L(e.b, y1 - bt), L(e.a, y1 - bt), nv, [foot, foot, 1, 1], MAT.stone);
      if (lid) { cap(); quad(L(e.a, y1 - B), L(e.b, y1 - B), L(inner[n].b, y1), L(inner[n].a, y1), [nv[0] * Math.SQRT1_2, Math.SQRT1_2, nv[2] * Math.SQRT1_2], 1, MAT.stone); cur.dress = keep; }
    });
    // (its top: a strip across a flowing wall, else a fan from its middle; and its underside, where it's over air)
    const flat = (pts: Array<[number, number]>, y: number, up: boolean, ao: number) => {
      if (ol.pairs) for (let q = 0; q + 1 < ol.pairs.length; q++) { const [a0, b0] = ol.pairs[q], [a1, b1] = ol.pairs[q + 1]; quad(L(pts[a0], y), L(pts[a1], y), L(pts[b1], y), L(pts[b0], y), [0, up ? 1 : -1, 0], ao, MAT.stone); }
      else pts.forEach((p, q) => tri(L([0, 0], y), L(p, y), L(pts[(q + 1) % pts.length], y), [0, up ? 1 : -1, 0], ao, MAT.stone));
    };
    if (lid && w.basin(k + 1, i, j)) { cap(); basinTop(k, i, j); cur.dress = keep; }
    else if (lid) { cap(); flat(inner.map((e) => e.a), y1, true, 0.95); cur.dress = keep; }
    if (k > 0 && !w.stone(k - 1, i, j) && w.stair(k - 1, i, j) < 0) flat(E.map((e) => e.a), y0, false, 0.5);
    // (a band round its open sides, out a little from them: front, top and underside)
    const band = (ya: number, yb: number, out: number, slope = 0) => {
      const o = shift(E, (e) => (e.open ? -out : 0));
      E.forEach((e, n) => {
        if (!e.open) return;
        const nv = nOf(e);
        quad(L(o[n].a, ya), L(o[n].b, ya), L(o[n].b, yb), L(o[n].a, yb), nv, 0.85, MAT.stone);
        quad(L(o[n].a, yb), L(o[n].b, yb), L(e.b, yb + slope), L(e.a, yb + slope), [nv[0] * 0.6, 0.8, nv[2] * 0.6], 1, MAT.stone);
        if (ya > k + 0.01) quad(L(o[n].a, ya), L(o[n].b, ya), L(e.b, ya), L(e.a, ya), [0, -1, 0], 0.55, MAT.stone);
      });
    };
    // (its plinth on the stone, its cornice under a high mass's top, a string course where the stone changes kind)
    if (k === w.ground(i, j)) band(k, k + 0.09, 0.03, 0.05);
    // (its foundation: on the land, down into it under each open side, rougher, shut in)
    if (founded(k, i, j)) { const keep2 = cur.dress; cur.dress = keep2 % KIND; E.forEach((e) => { if (e.open) quad(L(e.a, y0 - FOUND), L(e.b, y0 - FOUND), L(e.b, y0), L(e.a, y0), nOf(e), [0.35, 0.35, 0.6, 0.6], MAT.stone); }); cur.dress = keep2; }
    if (lid && !ol.wall && k >= 1) { cur.dress = 0; band(y1 - 0.15, y1 - 0.09, 0.035); cur.dress = keep; }
    const under = w.block(k - 1, i, j) ? dressOf(k - 1, i, j) : -1;
    if (under >= 0 && Math.floor(under / KIND) !== Math.floor(keep / KIND)) { cur.dress = 0; band(y0 - 0.02, y0 + 0.05, 0.025); cur.dress = keep; }
    // (a wall's post where it turns, meets another, or ends: capped a little above it)
    if (ol.wall && !ol.straight && !ol.flow && lid) { cap(); const h = ol.post + 0.02; box(cx - h, cx + h, y1, y1 + 0.045, cz - h, cz + h, MAT.stone, 0.95); cur.dress = keep; }
    // (buttresses along a long run on the stone: out from the wall, up, and sloped back into it)
    for (const d of buttresses(w, k, i, j)) {
      const [a, b] = DIRS[d], [ta, tb] = DIRS[(d + 1) % 4];
      const Q = (s: number, r: number, y: number): V3 => [cx + a * r + ta * s, y, cz + b * r + tb * s];
      const r0 = WT, r1 = WT + BUT, yT = y0 + BUTH, yS = yT + 0.25;
      quad(Q(-BUTW, r1, y0), Q(BUTW, r1, y0), Q(BUTW, r1, yT), Q(-BUTW, r1, yT), [a, 0, b], [0.6, 0.6, 1, 1], MAT.stone);
      quad(Q(-BUTW, r1, yT), Q(BUTW, r1, yT), Q(BUTW, r0, yS), Q(-BUTW, r0, yS), [a * 0.9, 0.44, b * 0.9], 1, MAT.stone);
      for (const sg of [-1, 1]) { face([Q(sg * BUTW, r0, y0), Q(sg * BUTW, r1, y0), Q(sg * BUTW, r1, yT), Q(sg * BUTW, r0, yS)], MAT.stone, 0.8, true, Q(0, (r0 + r1) / 2, y0 + 0.3)); }
    }
  };
  /**
   * A face with an opening in it: a door (an arched way in, its leaf of planks set back in the wall, a step at its
   * foot), or a window (arched, square, or a slit; its glass set back, a sill under it). The wall round it, the opening's
   * reveals and head, and what's at the back of it.
   */
  const holed = (d: number, s0: number, s1: number, y0: number, yt: number, op: Opening, P: (d: number, s: number, y: number, inset?: number) => V3, n: V3, foot: number) => {
    const k = Math.floor(y0 + 0.001);
    const door = op.kind === 'door', slit = op.style === 'slit', arched = door || op.style === 'arched' || slit;
    const hw = door ? 0.17 : slit ? 0.04 : op.style === 'square' ? 0.12 : 0.11;
    const yb = door ? k : k + (slit ? 0.28 : 0.38), sp = door ? k + 0.5 : slit ? k + 0.7 : k + (op.style === 'square' ? 0.72 : 0.62);
    const head = (t: number) => (arched ? sp + Math.sqrt(Math.max(0, hw * hw - t * t)) : sp), top = arched ? sp + hw : sp, r = door ? 0.13 : 0.09;
    const [ta, tb] = DIRS[(d + 1) % 4];
    // (the wall round it)
    quad(P(d, s0, y0), P(d, -hw, y0), P(d, -hw, yt), P(d, s0, yt), n, [foot, foot, 1, 1], MAT.stone);
    quad(P(d, hw, y0), P(d, s1, y0), P(d, s1, yt), P(d, hw, yt), n, [foot, foot, 1, 1], MAT.stone);
    if (yb > y0 + 0.001) quad(P(d, -hw, y0), P(d, hw, y0), P(d, hw, yb), P(d, -hw, yb), n, [foot, foot, 1, 1], MAT.stone);
    const N = arched ? 8 : 1;
    for (let q = 0; q < N; q++) {
      const t0 = -hw + (2 * hw * q) / N, t1 = -hw + (2 * hw * (q + 1)) / N;
      quad(P(d, t0, head(t0)), P(d, t1, head(t1)), P(d, t1, yt), P(d, t0, yt), n, 1, MAT.stone);
      // (its head, set back)
      const tm = (t0 + t1) / 2, hn = arched ? [-(tm / hw), -Math.sqrt(Math.max(0, 1 - (tm / hw) ** 2))] : [0, -1];
      quad(P(d, t0, head(t0)), P(d, t1, head(t1)), P(d, t1, head(t1), r), P(d, t0, head(t0), r), [ta * hn[0], hn[1], tb * hn[0]], 0.6, MAT.stone);
      // (and the back of it, under the head)
      quad(P(d, t0, sp, r), P(d, t1, sp, r), P(d, t1, head(t1), r), P(d, t0, head(t0), r), n, 0.7, door ? MAT.door : MAT.glass);
    }
    // (its reveals, its sill or threshold, and what's at the back: the door's planks, or glass)
    quad(P(d, -hw, yb), P(d, -hw, yb, r), P(d, -hw, sp, r), P(d, -hw, sp), [ta, 0, tb], 0.65, MAT.stone);
    quad(P(d, hw, yb), P(d, hw, yb, r), P(d, hw, sp, r), P(d, hw, sp), [-ta, 0, -tb], 0.65, MAT.stone);
    quad(P(d, -hw, yb), P(d, hw, yb), P(d, hw, yb, r), P(d, -hw, yb, r), [0, 1, 0], 0.8, MAT.stone);
    quad(P(d, -hw, yb, r), P(d, hw, yb, r), P(d, hw, sp, r), P(d, -hw, sp, r), n, 0.7, door ? MAT.door : MAT.glass);
    const ledge = (s: number, y: number, h: number, out: number) => {
      quad(P(d, -s, y, -out), P(d, s, y, -out), P(d, s, y + h, -out), P(d, -s, y + h, -out), n, 0.9, MAT.stone);
      quad(P(d, -s, y + h, -out), P(d, s, y + h, -out), P(d, s, y + h), P(d, -s, y + h), [0, 1, 0], 1, MAT.stone);
      quad(P(d, -s, y, -out), P(d, s, y, -out), P(d, s, y), P(d, -s, y), [0, -1, 0], 0.5, MAT.stone);
      quad(P(d, -s, y, -out), P(d, -s, y), P(d, -s, y + h), P(d, -s, y + h, -out), [-ta, 0, -tb], 0.8, MAT.stone);
      quad(P(d, s, y, -out), P(d, s, y), P(d, s, y + h), P(d, s, y + h, -out), [ta, 0, tb], 0.8, MAT.stone);
    };
    if (door) ledge(hw + 0.05, k, 0.03, 0.06); else if (!slit) ledge(hw + 0.03, yb - 0.04, 0.04, 0.035);
    const dr = dressed(op.k, op.i, op.j);
    // (colonnettes: slim shafts framing it, a pair each side of a door, one each side of an arched window, each on a
    // little base and under a little capital where the arch springs)
    if (dr?.colonnettes && arched && !slit) {
      const keep = cur.dress;
      cur.dress = 2 * KIND;
      for (const sg of [-1, 1]) for (const off of door ? [0.035, 0.085] : [0.03]) {
        const c = P(d, sg * (hw + off), 0, -0.022), ya = door ? k + 0.03 : yb, rc = 0.017;
        box(c[0] - 0.026, c[0] + 0.026, ya, ya + 0.04, c[2] - 0.026, c[2] + 0.026, MAT.stone, 0.8);
        lathe(c[0], c[2], [[rc, ya + 0.04], [rc * 0.9, sp - 0.04]], MAT.stone, 6);
        lathe(c[0], c[2], [[rc * 0.9, sp - 0.04], [0.03, sp - 0.005]], MAT.stone, 6);
        box(c[0] - 0.031, c[0] + 0.031, sp - 0.005, sp + 0.02, c[2] - 0.031, c[2] + 0.031, MAT.stone, 0.95);
      }
      cur.dress = keep;
    }
    // (a mashrabiya over an upper window: a box of fine turned lattice out from the wall on corbels, solid at its foot and
    // head, a little roof over it; the light through it in points)
    if (dr?.oriel && !door && !slit && k >= 1) {
      const keep = cur.dress, OW = 0.26, OD = 0.24, ya = k + 0.24, yb2 = Math.min(k + 0.93, top + 0.2), L = MAT.wood + PIERCED;
      const Q = (s: number, out: number, y: number) => P(d, s, y, -out);
      cur.dress = 0;
      // (its floor and its foot, solid; its lattice front and sides; a band at its head)
      face([Q(-OW, 0, ya), Q(OW, 0, ya), Q(OW, OD, ya), Q(-OW, OD, ya)], MAT.wood, 0.5, false);
      const panel = (y0: number, y1: number, mat: number) => {
        quad(Q(-OW, OD, y0), Q(OW, OD, y0), Q(OW, OD, y1), Q(-OW, OD, y1), n, 0.9, mat);
        quad(Q(-OW, 0, y0), Q(-OW, OD, y0), Q(-OW, OD, y1), Q(-OW, 0, y1), [-ta, 0, -tb], 0.8, mat);
        quad(Q(OW, 0, y0), Q(OW, OD, y0), Q(OW, OD, y1), Q(OW, 0, y1), [ta, 0, tb], 0.8, mat);
      };
      panel(ya, ya + 0.1, MAT.wood); panel(ya + 0.1, yb2 - 0.06, L); panel(yb2 - 0.06, yb2, MAT.wood);
      // (its inner face of lattice too, so it reads from within as a screen with depth)
      quad(Q(-OW + 0.02, OD - 0.03, ya + 0.1), Q(OW - 0.02, OD - 0.03, ya + 0.1), Q(OW - 0.02, OD - 0.03, yb2 - 0.06), Q(-OW + 0.02, OD - 0.03, yb2 - 0.06), n, 0.6, L);
      // (its roof: a lean-to of boards out over it)
      face([Q(-OW - 0.03, OD + 0.05, yb2), Q(OW + 0.03, OD + 0.05, yb2), Q(OW + 0.03, 0, yb2 + 0.1), Q(-OW - 0.03, 0, yb2 + 0.1)], MAT.wood, 1, true);
      face([Q(-OW - 0.03, OD + 0.05, yb2 - 0.02), Q(OW + 0.03, OD + 0.05, yb2 - 0.02), Q(OW + 0.03, OD + 0.05, yb2), Q(-OW - 0.03, OD + 0.05, yb2)], MAT.wood, 0.8, true, Q(0, 0, yb2));
      // (the corbels under it: two brackets out of the wall)
      for (const sg of [-0.7, 0.7]) {
        const s0 = sg * OW - 0.025, s1 = sg * OW + 0.025;
        for (const sx of [s0, s1]) face([Q(sx, 0, ya - 0.16), Q(sx, 0, ya), Q(sx, OD * 0.85, ya)], MAT.wood, 0.7, true, Q(sg * OW, 0.05, ya - 0.05));
        face([Q(s0, 0, ya - 0.16), Q(s1, 0, ya - 0.16), Q(s1, OD * 0.85, ya), Q(s0, OD * 0.85, ya)], MAT.wood, 0.6, false);
      }
      cur.dress = keep;
    }
  };
  const topFace = (k: number, i: number, j: number, y: number) => {
    if (w.block(k + 1, i, j) || w.stair(k + 1, i, j) >= 0) return;
    if (w.archway(k + 1, i, j) >= 0 && w.archway(k, i, j) === w.archway(k + 1, i, j)) return;
    const x0 = X(i), z0 = Z(j);
    quad([x0, y, z0], [x0 + 1, y, z0], [x0 + 1, y, z0 + 1], [x0, y, z0 + 1], [0, 1, 0], cornerAo(k + 1, i, j), MAT.stone);
  };

  // ─── the land, and the table it's on ───
  if (w.land) landMesh();
  // ─── the stone, and the table it's on ───
  else {
    const ex = w.extent(), xa = X(ex.i0) - MARGIN, xb = X(ex.i1 + 1) + MARGIN, za = Z(ex.j0) - MARGIN, zb = Z(ex.j1 + 1) + MARGIN;
    for (let j = ex.j0 - 1; j <= ex.j1 + 1; j++) for (let i = ex.i0 - 1; i <= ex.i1 + 1; i++) {
      const inside = i >= ex.i0 && j >= ex.j0 && i <= ex.i1 && j <= ex.j1;
      // (under a mass, or a stair, no stone shows; round a wall's thickness, it does)
      if (inside && (w.pool(i, j) || (w.block(0, i, j) && !wallCell(w, 0, i, j)) || w.stair(0, i, j) >= 0)) continue;
      const x0 = i < ex.i0 ? xa : X(i), x1 = i > ex.i1 ? xb : X(i + 1), z0 = j < ex.j0 ? za : Z(j), z1 = j > ex.j1 ? zb : Z(j + 1);
      const court = inside && w.courts.has(key(0, i, j));
      cur = { born: -1e3, pivot: 0, how: 1, tone: 0, dress: 0, sel: inside && selected.has(key(0, i, j)) };
      quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [0, 1, 0], inside ? cornerAo(0, i, j) : 1, court ? MAT.court : MAT.slab);
    }
    const T = 90, R = 1.6;
    // (its sides, and the table round it, shut in close to its foot)
    const cs: V3[] = [[xa, 0, za], [xb, 0, za], [xb, 0, zb], [xa, 0, zb]], os: V3[] = [[xa - R, -SLAB, za - R], [xb + R, -SLAB, za - R], [xb + R, -SLAB, zb + R], [xa - R, -SLAB, zb + R]];
    const ns: V3[] = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];
    for (let q = 0; q < 4; q++) {
      const c0 = cs[q], c1 = cs[(q + 1) % 4];
      quad(c0, c1, [c1[0], -SLAB, c1[2]], [c0[0], -SLAB, c0[2]], ns[q], [1, 1, 0.7, 0.7], MAT.slabSide);
      quad([c0[0], -SLAB, c0[2]], [c1[0], -SLAB, c1[2]], os[(q + 1) % 4], os[q], [0, 1, 0], [0.5, 0.5, 1, 1], MAT.table);
    }
    for (const [x0, z0, x1, z1] of [[-T, -T, T, za - R], [-T, zb + R, T, T], [-T, za - R, xa - R, zb + R], [xb + R, za - R, T, zb + R]]) quad([x0, -SLAB, z0], [x1, -SLAB, z0], [x1, -SLAB, z1], [x0, -SLAB, z1], [0, 1, 0], 1, MAT.table);
  }

  // ─── the hand's stone: blocks and stairs ───
  const ext = w.extent();
  for (let k = 0; k < w.levels; k++) for (let j = ext.j0; j <= ext.j1; j++) for (let i = ext.i0; i <= ext.i1; i++) {
    const x0 = X(i), z0 = Z(j), y0 = k, y1 = k + 1;
    if (w.block(k, i, j)) {
      cur = at(w.born(k, i, j), y0, k, i, j);
      // (over a colonnade's column: only the entablature's depth of stone, the column running on up under it)
      if (onColumn(w, k, i, j)) {
        const yL = y1 - LINTEL;
        for (let d = 0; d < 4; d++) {
          const [a, b] = DIRS[d];
          if (w.stone(k, i + a, j + b) || w.stair(k, i + a, j + b) >= 0) continue;
          const A: V3 = a ? [a > 0 ? x0 + 1 : x0, yL, z0] : [x0, yL, b > 0 ? z0 + 1 : z0], B: V3 = a ? [A[0], yL, z0 + 1] : [x0 + 1, yL, A[2]];
          quad(A, B, [B[0], y1, B[2]], [A[0], y1, A[2]], [a, 0, b], 0.9, MAT.stone);
        }
        quad([x0, yL, z0], [x0, yL, z0 + 1], [x0 + 1, yL, z0 + 1], [x0 + 1, yL, z0], [0, -1, 0], 0.5, MAT.stone);
        topFace(k, i, j, y1);
        continue;
      }
      blockFaces(k, i, j);
      // (over a thin wall, its underside shows either side of it)
      if (w.wall(k - 1, i, j) >= 0) quad([x0, y0, z0], [x0, y0, z0 + 1], [x0 + 1, y0, z0 + 1], [x0 + 1, y0, z0], [0, -1, 0], 0.55, MAT.stone);
      continue;
    }
    if (w.wall(k, i, j) >= 0) { cur = at(w.born(k, i, j), y0, k, i, j); thinWall(k, i, j); continue; }
    if (w.archway(k, i, j) >= 0 && !w.span(k, i, j)) { cur = at(w.born(k, i, j), y0, k, i, j); archCell(k, i, j, w.archway(k, i, j)); continue; }
    const d = w.stair(k, i, j);
    if (d >= 0) {
      cur = at(w.born(k, i, j), y0, k, i, j);
      const [a, b] = DIRS[d];
      const pt = (u: number, wv: number, y: number): V3 => { const cx = x0 + 0.5, cz = z0 + 0.5; return a ? [cx + a * (u - 0.5), y, cz + (wv - 0.5)] : [cx + (wv - 0.5), y, cz + b * (u - 0.5)]; };
      const across = [(d + 1) % 4, (d + 3) % 4];
      for (let s = 0; s < STEPS; s++) {
        const u0 = s / STEPS, u1 = (s + 1) / STEPS, h = y0 + (s + 1) / STEPS, h0 = y0 + s / STEPS;
        // (each tread with a nosing a little proud of the riser under it)
        const nz = 0.025, nh = 0.028;
        quad(pt(u0 - nz, 0, h), pt(u1, 0, h), pt(u1, 1, h), pt(u0 - nz, 1, h), [0, 1, 0], [0.8, 0.95, 0.95, 0.8], MAT.stone);
        quad(pt(u0 - nz, 0, h - nh), pt(u0 - nz, 1, h - nh), pt(u0 - nz, 1, h), pt(u0 - nz, 0, h), [-a, 0, -b], 1, MAT.stone);
        quad(pt(u0 - nz, 0, h - nh), pt(u0, 0, h - nh), pt(u0, 1, h - nh), pt(u0 - nz, 1, h - nh), [0, -1, 0], 0.55, MAT.stone);
        quad(pt(u0, 0, h0), pt(u0, 1, h0), pt(u0, 1, h - nh), pt(u0, 0, h - nh), [-a, 0, -b], [0.6, 0.6, 0.8, 0.8], MAT.stone);
        for (const q of across) {
          if (hides(k, i, j, q)) continue;
          const dd = DIRS[q], wv = (a ? dd[1] : dd[0]) > 0 ? 1 : 0;
          quad(pt(u0, wv, y0), pt(u1, wv, y0), pt(u1, wv, h), pt(u0, wv, h), [dd[0], 0, dd[1]], [0.7, 0.7, 1, 1], MAT.stone);
        }
      }
      if (!hides(k, i, j, d)) quad(pt(1, 0, y0), pt(1, 1, y0), pt(1, 1, y1), pt(1, 0, y1), [a, 0, b], [0.7, 0.7, 1, 1], MAT.stone);
      // (its underside, where it's over nothing: carried on a pier, or out over a drop)
      if (k > w.ground(i, j) && !w.occupied(k - 1, i, j)) quad(pt(0, 0, y0), pt(0, 1, y0), pt(1, 1, y0), pt(1, 0, y0), [0, -1, 0], 0.5, MAT.stone);
      // (on the land, its foundation down into it)
      if (founded(k, i, j)) for (let q = 0; q < 4; q++) { const [qa, qb] = DIRS[q]; if (w.occupied(k, i + qa, j + qb)) continue; const A: V3 = qa ? [qa > 0 ? x0 + 1 : x0, y0 - FOUND, z0] : [x0, y0 - FOUND, qb > 0 ? z0 + 1 : z0], B: V3 = qa ? [A[0], y0 - FOUND, z0 + 1] : [x0 + 1, y0 - FOUND, A[2]]; quad(A, B, [B[0], y0, B[2]], [A[0], y0, A[2]], [qa, 0, qb], [0.35, 0.35, 0.6, 0.6], MAT.stone); }
      continue;
    }
    if (w.pier(k, i, j)) {
      // (a pier: a slender column, a little tapered; a base where it stands, a capital where it meets what it carries)
      cur = at(w.born(k, i, j), 0, k, i, j);
      const ps = pierShape(w, k, i, j), cx = x0 + 0.5 + ps.ox, cz = z0 + 0.5 + ps.oz, H = ps.top + 1 - ps.foot;
      if (ps.column) { column(cx, cz, k, ps); continue; }
      const rAt = (y: number) => ps.r * (1.06 - 0.12 * ((y - ps.foot) / H));
      // (under a block, standing in the middle of its cell, with no arch beside it: it meets what it carries in a cove,
      // curving out from its head to the block's edges, so piers side by side make round arches between them)
      const coved = k === ps.top && !ps.ox && !ps.oz && w.block(k + 1, i, j), CH = ps.top > ps.foot ? 0.6 : 0.42;
      const ya = k === ps.foot ? y0 + 0.09 : y0, yb = k === ps.top ? (coved ? y1 - CH - 0.05 : y1 - 0.11) : y1;
      lathe(cx, cz, [[rAt(ya), ya], [rAt(yb), yb]], MAT.stone, 8);
      if (k === ps.foot) { box(cx - ps.r - 0.05, cx + ps.r + 0.05, founded(k, i, j) ? y0 - FOUND : y0, y0 + 0.06, cz - ps.r - 0.05, cz + ps.r + 0.05, MAT.stone, 0.7); box(cx - ps.r - 0.025, cx + ps.r + 0.025, y0 + 0.06, y0 + 0.09, cz - ps.r - 0.025, cz + ps.r + 0.025, MAT.stone, 0.8); }
      if (coved) {
        // (toward an arch springing from it, it rises straight: the arch makes the curve there)
        const s0 = ps.r + 0.04, yc = y1 - CH, R = [0, 1, 2, 3].map((d) => (w.span(k + 1, i + DIRS[d][0], j + DIRS[d][1]) ? s0 : reach(w, k + 1, i, j, d)));
        box(cx - s0 - 0.01, cx + s0 + 0.01, yc - 0.05, yc, cz - s0 - 0.01, cz + s0 + 0.01, MAT.stone, 0.85);
        const corner = (d: number, r: (q: number) => number): [number, number] => { const e = (d + 1) % 4; return [DIRS[d][0] * r(d) + DIRS[e][0] * r(e), DIRS[d][1] * r(d) + DIRS[e][1] * r(e)]; };
        const M = 6, inside: V3 = [cx, y1 - 0.01, cz];
        for (let d = 0; d < 4; d++) {
          const c0i = corner((d + 3) % 4, () => s0), c1i = corner(d, () => s0), c0o = corner((d + 3) % 4, (q) => R[q]), c1o = corner(d, (q) => R[q]);
          const pt = (ci: [number, number], co: [number, number], t: number): V3 => { const th = (t * Math.PI) / 2, f = 1 - Math.cos(th); return [cx + ci[0] + (co[0] - ci[0]) * f, yc + CH * Math.sin(th), cz + ci[1] + (co[1] - ci[1]) * f]; };
          for (let m = 0; m < M; m++) face([pt(c0i, c0o, m / M), pt(c1i, c1o, m / M), pt(c1i, c1o, (m + 1) / M), pt(c0i, c0o, (m + 1) / M)], MAT.stone, 0.55 + 0.4 * (m / M), true, inside);
        }
        continue;
      }
      if (k === ps.top) {
        const rc = ps.r + 0.07;
        box(cx - ps.r - 0.02, cx + ps.r + 0.02, y1 - 0.11, y1 - 0.06, cz - ps.r - 0.02, cz + ps.r + 0.02, MAT.stone, 0.85);
        box(cx - rc, cx + rc, y1 - 0.06, y1, cz - rc, cz + rc, MAT.stone, 0.9);
        quad([cx - rc, y1 - 0.06, cz - rc], [cx + rc, y1 - 0.06, cz - rc], [cx + rc, y1 - 0.06, cz + rc], [cx - rc, y1 - 0.06, cz + rc], [0, -1, 0], 0.6, MAT.stone);
      }
    }
  }
  for (const sp of w.spans) span(sp);
  // (corbels: under stone held out from the stone beside it, two brackets out of that stone's face, curving up and out
  // to carry it, so the way under it stays open)
  for (const [v, d] of w.corbels) {
    const [k, i, j] = unkey(v), y0 = k, cx = X(i) + 0.5, cz = Z(j) + 0.5, [a, b] = DIRS[d], [ta, tb] = DIRS[(d + 1) % 4], U = 0.86, HW2 = 0.075;
    cur = at(w.born(k, i, j), y0, k, i, j);
    const P = (u: number, sv: number, y: number): V3 => [cx + a * (0.5 - u) + ta * sv, y, cz + b * (0.5 - u) + tb * sv];
    const prof: Array<[number, number]> = [[0, y0], [U, y0], [U, y0 - 0.1]];
    for (let q = 6; q >= 0; q--) { const th = (q / 6) * (Math.PI / 2); prof.push([U * (1 - Math.cos(th)), y0 - 0.75 + 0.65 * Math.sin(th)]); }
    // (as many brackets as what they carry is wide: one under a thin wall, closer under a wall, three under a block)
    const thinW = w.wall(k, i, j) >= 0, spread = thinW ? [0] : wallCell(w, k, i, j) ? [-0.2, 0.2] : [-0.32, 0, 0.32];
    for (const sc of spread) {
      const inside = P(0.25, sc, y0 - 0.1);
      for (let q = 1; q + 1 < prof.length; q++) for (const sv of [sc - HW2, sc + HW2]) face([P(prof[0][0], sv, prof[0][1]), P(prof[q][0], sv, prof[q][1]), P(prof[q + 1][0], sv, prof[q + 1][1])], MAT.stone, 0.8, true, inside);
      for (let q = 1; q + 1 < prof.length; q++) face([P(prof[q][0], sc - HW2, prof[q][1]), P(prof[q + 1][0], sc - HW2, prof[q + 1][1]), P(prof[q + 1][0], sc + HW2, prof[q + 1][1]), P(prof[q][0], sc + HW2, prof[q][1])], MAT.stone, 0.55 + 0.35 * (q / prof.length), true, inside);
    }
  }
  for (const b of buildings(w).list) if (b.roof) roof(b);

  // ─── what grows in the courtyards ───
  const hand = [...[...w.pools.entries()].map(([v, b]) => { const [, i, j] = unkey(v); return { kind: 'pool' as const, i, j, born: b, k: w.ground(i, j) }; }), ...[...w.trees.entries()].map(([v, b]) => { const [k, i, j] = unkey(v); return { kind: 'cypress' as const, i, j, born: b, k }; })];
  for (const dc of [...w.decor.map((d) => ({ ...d, k: w.ground(d.i, d.j) })), ...hand]) {
    cur = { born: dc.born, pivot: -0.4, how: 1, tone: 0.5, dress: 0, sel: false };
    const x0 = X(dc.i), z0 = Z(dc.j);
    if (dc.kind === 'pool') {
      const lv = dc.k - 0.1, g0 = dc.k;
      quad([x0, lv, z0], [x0 + 1, lv, z0], [x0 + 1, lv, z0 + 1], [x0, lv, z0 + 1], [0, 1, 0], 1, MAT.water);
      for (let d = 0; d < 4; d++) {
        const [a, b] = DIRS[d];
        if (w.pool(dc.i + a, dc.j + b)) continue;
        const A: V3 = a ? [a > 0 ? x0 + 1 : x0, lv, z0] : [x0, lv, b > 0 ? z0 + 1 : z0], B: V3 = a ? [A[0], lv, z0 + 1] : [x0 + 1, lv, A[2]];
        quad(A, B, [B[0], g0, B[2]], [A[0], g0, A[2]], [-a, 0, -b], [0.6, 0.6, 0.9, 0.9], MAT.court);
      }
    } else if (dc.kind === 'pot') pot(dc.i, dc.j, dc.k, dc.born);
    else cypress(dc.i, dc.j, dc.k, dc.born);
  }

  // ─── water falling: from a basin's spout to what's below it, a splash where it lands, a bowl to catch it ───
  for (const f of w.falls) {
    const [a, b] = DIRS[f.d], [ta, tb] = DIRS[(f.d + 1) % 4], cx = X(f.i) + 0.5, cz = Z(f.j) + 0.5, x = f.i + a, z = f.j + b;
    const y0 = f.k - 0.07, y1 = f.into === 'water' ? f.land - (f.land === w.ground(x, z) ? (w.land?.water.has(z * 1000 + x) ? 0.17 : 0.1) : 0.07) : f.into === 'bowl' ? f.land + 0.12 : f.land + 0.01;
    cur = { born: f.born, pivot: y1, how: 1, tone: 0.5, dress: 0, sel: false };
    fall(cx + a * 0.66, cz + b * 0.66, a, b, ta, tb, y0, y1, 0.34);
    if (f.into === 'bowl') bowl(X(x) + 0.5, Z(z) + 0.5, f.land, f.born);
    foam(cx + a * 1.0, y1 + 0.012, cz + b * 1.0, f.i * 7 + f.j * 13 + f.d);
  }
  /**
   * A sheet of falling water: from a lip (x, z, at y0) out the way (a, b) and down to y1, curving out as it falls,
   * spreading a little; seen from either side
   */
  function fall(x: number, z: number, a: number, b: number, ta: number, tb: number, y0: number, y1: number, wd: number) {
    const N = 9, drop = y0 - y1, P = (t: number, s: number): V3 => { const o = 0.34 * Math.sqrt(t) * Math.min(1, 0.5 + drop * 0.3), w2 = (wd + 0.08 * t) / 2; return [x + a * o + ta * s * w2, y0 - drop * t, z + b * o + tb * s * w2]; };
    for (let q = 0; q < N; q++) {
      const t0 = q / N, t1 = (q + 1) / N, A = P(t0, -1), B = P(t0, 1), C = P(t1, 1), D = P(t1, -1);
      const nx = a * 0.95, nz = b * 0.95;
      quad(A, B, C, D, [nx, 0.3, nz], 1, MAT.water);
      quad(A, D, C, B, [-nx, 0.3, -nz], 0.8, MAT.water);
    }
  }
  /** where falling water lands: a few patches of white */
  function foam(x: number, y: number, z: number, seed: number) {
    const keep = cur.tone;
    cur.tone = 0.995;
    for (let n = 0; n < 7; n++) {
      const r = (q: number) => { const v = Math.sin((seed * 31 + n * 7 + q) * 12.9898) * 43758.5453; return v - Math.floor(v); };
      const px = x + (r(1) - 0.5) * 0.42, pz = z + (r(2) - 0.5) * 0.42, rad = 0.035 + 0.06 * r(3), seg = 6;
      for (let s = 0; s < seg; s++) {
        const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2;
        tri([px, y, pz], [px + Math.cos(a0) * rad, y, pz + Math.sin(a0) * rad], [px + Math.cos(a1) * rad, y, pz + Math.sin(a1) * rad], [0, 1, 0], 1, MAT.water);
      }
    }
    cur.tone = keep;
  }
  /** a round stone bowl where the rules catch falling water: a moulded rim, the water in it */
  function bowl(cx: number, cz: number, y: number, born: number) {
    cur = { born, pivot: y, how: 1, tone: 0.5, dress: 0, sel: false };
    lathe(cx, cz, [[0.3, y], [0.4, y + 0.03], [0.43, y + 0.15], [0.45, y + 0.17], [0.37, y + 0.18], [0.35, y + 0.08]], MAT.stone, 14);
    for (let s = 0; s < 14; s++) { const a0 = (s / 14) * Math.PI * 2, a1 = ((s + 1) / 14) * Math.PI * 2; tri([cx, y + 0.12, cz], [cx + Math.cos(a0) * 0.36, y + 0.12, cz + Math.sin(a0) * 0.36], [cx + Math.cos(a1) * 0.36, y + 0.12, cz + Math.sin(a1) * 0.36], [0, 1, 0], 1, MAT.water); }
  }
  /**
   * A basin let into a top: a stone rim round it (none where it runs on into the next basin), its water a little under;
   * at its spout, the rim cut and a lip run out over the edge for the water to leave by
   */
  function basinTop(k: number, i: number, j: number) {
    const y1 = k + 1, wl = y1 - 0.07, cx = X(i) + 0.5, cz = Z(j) + 0.5, R = 0.1;
    const spout = w.falls.find((f) => f.k === k + 1 && f.i === i && f.j === j);
    const open = DIRS.map(([a, b]) => w.basin(k + 1, i + a, j + b));
    const r = (d: number) => (open[d] ? 0 : R);
    // (its water)
    quad([cx - 0.5 + r(2), wl, cz - 0.5 + r(3)], [cx + 0.5 - r(0), wl, cz - 0.5 + r(3)], [cx + 0.5 - r(0), wl, cz + 0.5 - r(1)], [cx - 0.5 + r(2), wl, cz + 0.5 - r(1)], [0, 1, 0], 1, MAT.water);
    for (let d = 0; d < 4; d++) {
      if (open[d]) continue;
      const [a, b] = DIRS[d], [ta, tb] = DIRS[(d + 1) % 4];
      // (the rim along this side: its top, its inner face down to the water; cut where the spout is)
      const seg = (s0: number, s1: number) => {
        const P = (s: number, inset: number, y: number): V3 => [cx + a * (0.5 - inset) + ta * s, y, cz + b * (0.5 - inset) + tb * s];
        quad(P(s0, 0, y1), P(s1, 0, y1), P(s1, R, y1), P(s0, R, y1), [0, 1, 0], 0.95, MAT.stone);
        quad(P(s0, R, y1), P(s1, R, y1), P(s1, R, wl), P(s0, R, wl), [-a, 0, -b], 0.7, MAT.stone);
      };
      if (spout && spout.d === d) {
        seg(-0.5, -0.17); seg(0.17, 0.5);
        // (the lip: a trough of stone out over the edge, the water running in it)
        const P = (s: number, out: number, y: number): V3 => [cx + a * (0.5 + out) + ta * s, y, cz + b * (0.5 + out) + tb * s];
        quad(P(-0.17, -R, wl - 0.03), P(0.17, -R, wl - 0.03), P(0.17, 0.16, wl - 0.03), P(-0.17, 0.16, wl - 0.03), [0, 1, 0], 0.8, MAT.stone);
        quad(P(-0.17, -R, wl), P(0.17, -R, wl), P(0.17, 0.16, wl), P(-0.17, 0.16, wl), [0, 1, 0], 1, MAT.water);
        quad(P(-0.17, 0.16, wl - 0.1), P(0.17, 0.16, wl - 0.1), P(0.17, 0.16, wl - 0.03), P(-0.17, 0.16, wl - 0.03), [a, 0, b], 0.75, MAT.stone);
        quad(P(-0.17, 0, wl - 0.1), P(0.17, 0, wl - 0.1), P(0.17, 0.16, wl - 0.1), P(-0.17, 0.16, wl - 0.1), [0, -1, 0], 0.5, MAT.stone);
        for (const s of [-0.17, 0.17]) quad(P(s, 0, wl - 0.1), P(s, 0.16, wl - 0.1), P(s, 0.16, wl - 0.03), P(s, 0, wl - 0.03), [ta * Math.sign(s), 0, tb * Math.sign(s)], 0.75, MAT.stone);
      } else seg(-0.5, 0.5);
    }
  }

  // ─── dressing: parapets (by hand, and along a bridge of its own accord), lanterns and pots ───
  // (first, which edges of which tops have one: open edges, with nothing at that height beyond them)
  const { edges, rails, flowRails, roofed } = parapets(w, plain);
  const T = 0.12, PH = 0.3, C = 0.025, PP = 0.1;
  for (const [v, es] of edges) {
    const [k, i, j] = unkey(v), y0 = k + 1, y1 = y0 + PH, cx = X(i) + 0.5, cz = Z(j) + 0.5, kind = rails.get(v)!;
    cur = at(w.born(k, i, j), y0, k, i, j);
    const keep = cur.dress;
    for (let q = 0; q < 4; q++) {
      if (!es[q]) continue;
      const [a, b] = DIRS[q], [ta, tb] = DIRS[(q + 1) % 4];
      // (along that edge, on its face as its form has it (a wall's is nearer its middle): a low wall, a wall's thickness
      // all along, its coping a little proud either side; or a balustrade, a rail on a row of turned balusters; or a jali,
      // a screen of pierced stone)
      const r = reach(w, k, i, j, q), th = kind === DRESS.jali ? 0.07 : T;
      const [bx0, bx1, bz0, bz1] = a > 0 ? [cx + r - th, cx + r, cz - 0.5, cz + 0.5] : a < 0 ? [cx - r, cx - r + th, cz - 0.5, cz + 0.5] : b > 0 ? [cx - 0.5, cx + 0.5, cz + r - th, cz + r] : [cx - 0.5, cx + 0.5, cz - r, cz - r + th];
      const [cx0, cx1, cz0, cz1] = a ? [bx0 - C, bx1 + C, bz0, bz1] : [bx0, bx1, bz0 - C, bz1 + C];
      if (kind === DRESS.balustrade) {
        // (a plinth, the balusters on it close set, a rail over them)
        box(bx0, bx1, y0, y0 + 0.05, bz0, bz1, MAT.stone, [0.6, 0.6, 0.9, 0.9]);
        const mx = a ? (bx0 + bx1) / 2 : 0, mz = a ? 0 : (bz0 + bz1) / 2, N = 9;
        for (let s = 0; s < N; s++) { const u = -0.5 + (s + 0.5) / N; baluster(a ? mx : cx + ta * u, a ? cz + tb * u : mz, y0 + 0.05, y1 - 0.04); }
        box(cx0, cx1, y1 - 0.04, y1 + 0.03, cz0, cz1, MAT.stone, 0.95);
      } else {
        if (kind === DRESS.jali) cur.dress = (keep % KIND) + PIERCED;
        box(bx0, bx1, y0, y1, bz0, bz1, MAT.stone, [0.6, 0.6, 1, 1]);
        cur.dress = keep;
        box(cx0, cx1, y1, y1 + 0.05, cz0, cz1, MAT.stone, 0.95);
      }
      // (its ends: where it doesn't run on, or turns a corner, a post a little taller, capped; a balustrade's pedestal)
      for (const t of [(q + 1) % 4, (q + 3) % 4]) {
        // (only where it truly ends: running on, or turning a corner, it needs no post)
        const [ea, eb] = DIRS[t], on = edges.get(key(k, i + ea, j + eb))?.[q], turns = es[t];
        if (on || (turns && (kind !== DRESS.balustrade || t < q))) continue;
        // (at a balustrade's corner, one pedestal, square in the corner)
        const e = turns ? reach(w, k, i, j, t) - PP : 0.5 - PP, px = cx + a * (r - (turns ? PP : T / 2)) + ea * e, pz = cz + b * (r - (turns ? PP : T / 2)) + eb * e;
        box(px - PP, px + PP, y0, y1 + 0.1, pz - PP, pz + PP, MAT.stone, [0.6, 0.6, 1, 1]);
        box(px - PP - C, px + PP + C, y1 + 0.1, y1 + 0.15, pz - PP - C, pz + PP + C, MAT.stone, 0.95);
      }
    }
  }
  for (const [v, kind] of flowRails) {
    const [k, i, j] = unkey(v), E = outline(w, k, i, j).edges, y0 = k + 1, y1 = y0 + PH, cx = X(i) + 0.5, cz = Z(j) + 0.5, th = kind === DRESS.jali ? 0.07 : T;
    cur = at(w.born(k, i, j), y0, k, i, j);
    const keep = cur.dress, inn = shift(E, (e) => (e.open ? th : 0)), L = (p: [number, number], y: number): V3 => [cx + p[0], y, cz + p[1]];
    E.forEach((e, n) => {
      if (!e.open) return;
      const dx = e.b[0] - e.a[0], dz = e.b[1] - e.a[1], l = Math.hypot(dx, dz) || 1, nv: V3 = [dz / l, 0, -dx / l];
      // (a ribbon of stone along the edge: its outer face, its inner, its top)
      const ribbon = (ya: number, yb: number) => {
        quad(L(e.a, ya), L(e.b, ya), L(e.b, yb), L(e.a, yb), nv, [0.6, 0.6, 1, 1], MAT.stone);
        quad(L(inn[n].a, ya), L(inn[n].b, ya), L(inn[n].b, yb), L(inn[n].a, yb), [-nv[0], 0, -nv[2]], 0.8, MAT.stone);
        quad(L(e.a, yb), L(e.b, yb), L(inn[n].b, yb), L(inn[n].a, yb), [0, 1, 0], 0.95, MAT.stone);
      };
      if (kind === DRESS.balustrade) {
        ribbon(y0, y0 + 0.05); ribbon(y1 - 0.04, y1 + 0.03);
        const m = (t: number): [number, number] => [(e.a[0] + inn[n].a[0]) / 2 + t * ((e.b[0] + inn[n].b[0]) / 2 - (e.a[0] + inn[n].a[0]) / 2), (e.a[1] + inn[n].a[1]) / 2 + t * ((e.b[1] + inn[n].b[1]) / 2 - (e.a[1] + inn[n].a[1]) / 2)];
        const N = Math.max(1, Math.round(l / 0.11));
        for (let q = 0; q < N; q++) { const p = m((q + 0.5) / N); baluster(cx + p[0], cz + p[1], y0 + 0.05, y1 - 0.04); }
      } else {
        if (kind === DRESS.jali) cur.dress = (keep % KIND) + PIERCED;
        ribbon(y0, y1);
        cur.dress = keep;
        ribbon(y1, y1 + 0.05);
      }
    });
  }
  // (a stair's open sides, where it's dressed so: a balustrade (or a jali) climbing with it, a newel at its foot and head)
  for (const v of w.stairs.keys()) {
    const [k, i, j] = unkey(v), d = dressed(k, i, j);
    if (!d?.parapet) continue;
    const dir = w.stair(k, i, j), [a, b] = DIRS[dir], x0 = X(i), z0 = Z(j), kind = d.rail || DRESS.balustrade;
    cur = at(w.born(k, i, j), k, k, i, j);
    const keep = cur.dress;
    const pt = (u: number, wv: number, y: number): V3 => { const cx = x0 + 0.5, cz = z0 + 0.5; return a ? [cx + a * (u - 0.5), y, cz + (wv - 0.5)] : [cx + (wv - 0.5), y, cz + b * (u - 0.5)]; };
    for (const q of [(dir + 1) % 4, (dir + 3) % 4]) {
      const [qa, qb] = DIRS[q];
      if (w.stone(k, i + qa, j + qb) || w.earth(k, i + qa, j + qb) || w.stair(k, i + qa, j + qb) >= 0 || w.stone(k + 1, i + qa, j + qb)) continue;
      const wv = (a ? qb : qa) > 0 ? 0.95 : 0.05, rise = (u: number) => k + u;
      if (kind === DRESS.jali) {
        cur.dress = (keep % KIND) + PIERCED;
        for (const o of [-0.03, 0.03]) quad(pt(0, wv + o, k), pt(1, wv + o, k + 1), pt(1, wv + o, k + 1 + PH), pt(0, wv + o, k + PH), [qa, 0, qb], 0.9, MAT.stone);
        cur.dress = keep;
      } else for (let s = 0; s < STEPS; s++) { const u = (s + 0.5) / STEPS, p = pt(u, wv, 0); baluster(p[0], p[2], k + (s + 1) / STEPS, rise(u) + PH - 0.04); }
      bar(pt(-0.04, wv, rise(-0.04) + PH - 0.04), pt(1.04, wv, rise(1.04) + PH - 0.04), 0.09, 0.07, MAT.stone);
      for (const u of [0.04, 0.96]) { const p = pt(u, wv, 0), y = u < 0.5 ? k : k + 1, h = PH + 0.12; if (u > 0.5 && w.stone(k, i + a, j + b)) continue; box(p[0] - 0.06, p[0] + 0.06, u < 0.5 ? k : k + 1, y + h, p[2] - 0.06, p[2] + 0.06, MAT.stone, [0.6, 0.6, 1, 1]); box(p[0] - 0.08, p[0] + 0.08, y + h, y + h + 0.04, p[2] - 0.08, p[2] + 0.08, MAT.stone, 0.95); }
    }
  }
  for (const v of [...w.mass.keys()]) {
    const [k, i, j] = unkey(v), d = dressed(k, i, j);
    if (d?.ivy) ivy(k, i, j, w.born(k, i, j));
    if (w.occupied(k + 1, i, j) || w.tree(k + 1, i, j) || roofed.has(v) || w.basin(k + 1, i, j)) continue;
    // (on a flowing wall, at the middle of its stone, not of its cell)
    const ol = w.block(k, i, j) ? outline(w, k, i, j) : null, mid = ol?.flow ? ol.edges.reduce((m, e) => [m[0] + e.a[0] / ol.edges.length, m[1] + e.a[1] / ol.edges.length], [0, 0]) : [0, 0];
    if (d?.prop === DRESS.lantern) lantern(i + mid[0], j + mid[1], k + 1, w.born(k, i, j));
    if (d?.prop === DRESS.pot) pot(i + mid[0], j + mid[1], k + 1, w.born(k, i, j));
  }
  pergolas();
  return { data: new Float32Array(out), count: out.length / STRIDE };

  /**
   * Pergolas, over the places dressed so: posts at the corners of the ground they cover (and along a long side, every
   * other cell; none where a wall stands to take the beam), beams round their edge resting on them, rafters across the
   * short way close set and out a little past the beams, and a vine climbing the posts and spreading over the rafters.
   */
  function pergolas() {
    const at3 = new Set<number>();
    for (const v of [...w.dress.keys(), ...(plain ? [] : character(w).keys())]) { const [k, i, j] = unkey(v); if (dressed(k, i, j)?.pergola && w.free(k, i, j) && w.floor(k, i, j)) at3.add(v); }
    const seen = new Set<number>();
    for (const v0 of at3) {
      if (seen.has(v0)) continue;
      const [k] = unkey(v0), cells: Array<[number, number]> = [], st = [v0];
      seen.add(v0);
      while (st.length) { const [, i, j] = unkey(st.pop()!); cells.push([i, j]); for (const [a, b] of DIRS) { const u = key(k, i + a, j + b); if (at3.has(u) && !seen.has(u)) { seen.add(u); st.push(u); } } }
      const has = (i: number, j: number) => at3.has(key(k, i, j)), yB = k + 0.86, BH = 0.07, yR = yB + BH, RH = 0.05;
      const i0 = Math.min(...cells.map((c) => c[0])), i1 = Math.max(...cells.map((c) => c[0])), j0 = Math.min(...cells.map((c) => c[1])), j1 = Math.max(...cells.map((c) => c[1]));
      const across = i1 - i0 >= j1 - j0 ? 1 : 0;
      const born = Math.max(-1e3, ...cells.map(([i, j]) => w.born(k - 1, i, j))) + 0.4;
      cur = { born, pivot: k, how: 1, tone: 0.5, dress: 0, sel: cells.some(([i, j]) => selected.has(key(k, i, j))) };
      const walled = (i: number, j: number) => w.stone(k, i, j) || w.wall(k, i, j) >= 0;
      // (posts: at each corner of the ground it covers that's a corner of it, or along its edge every other cell)
      const corners = new Map<string, [number, number]>();
      for (const [i, j] of cells) for (const [ci, cj] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) corners.set(`${ci}.${cj}`, [ci, cj]);
      const vines: V3[] = [];
      for (const [ci, cj] of corners.values()) {
        const round = [[ci - 1, cj - 1], [ci, cj - 1], [ci - 1, cj], [ci, cj]], n = round.filter(([x, z]) => has(x, z)).length;
        if (n === 4 || round.some(([x, z]) => walled(x, z))) continue;
        // (a corner of it; or along a side, every other cell, but not a cell short of its end)
        const corner = n !== 2 || (has(ci - 1, cj - 1) === has(ci, cj)), along = across === 1 ? ci - i0 : cj - j0, far = across === 1 ? i1 + 1 - ci : j1 + 1 - cj;
        if (!corner && (along % 2 !== 0 || far < 2)) continue;
        const x = X(ci), z = Z(cj), PW = 0.045;
        box(x - PW, x + PW, k, yB, z - PW, z + PW, MAT.wood, [0.6, 0.6, 1, 1]);
        box(x - PW - 0.02, x + PW + 0.02, k, k + 0.05, z - PW - 0.02, z + PW + 0.02, MAT.stone, 0.7);
        vines.push([x, k, z]);
      }
      // (beams round its edge, and rafters across it)
      for (const [i, j] of cells) for (let d = 0; d < 4; d++) {
        const [a, b] = DIRS[d];
        if (has(i + a, j + b)) continue;
        const [ta, tb] = DIRS[(d + 1) % 4], cx = X(i) + 0.5 + a * 0.5, cz = Z(j) + 0.5 + b * 0.5;
        const ext = (t: number) => (has(i + DIRS[t][0], j + DIRS[t][1]) ? 0.5 : 0.56);
        bar([cx - ta * ext((d + 3) % 4), yB, cz - tb * ext((d + 3) % 4)], [cx + ta * ext((d + 1) % 4), yB, cz + tb * ext((d + 1) % 4)], 0.06, BH, MAT.wood);
      }
      const R = 5;
      for (const [i, j] of cells) for (let r = 0; r < R; r++) {
        const s = (r + 0.5) / R, [ai, aj] = across === 1 ? [0, 1] : [1, 0];
        const x = X(i) + (across === 1 ? s : 0), z = Z(j) + (across === 1 ? 0 : s);
        const lo = has(i - ai, j - aj) ? 0 : -0.14, hi = has(i + ai, j + aj) ? 1 : 1.14;
        bar(across === 1 ? [x, yR, z + lo] : [x + lo, yR, z], across === 1 ? [x, yR, z + hi] : [x + hi, yR, z], 0.035, RH, MAT.wood);
      }
      // (the vine: up each post, then out over the rafters in clumps)
      const rnd = (...n: number[]) => hash(w.seed, ...n) / 4294967296;
      const leaf = (c: V3, sz: number, nrm: V3, q: number) => {
        const ang = rnd(q, 1) * Math.PI * 2, u: V3 = [Math.cos(ang) * sz, 0, Math.sin(ang) * sz], vv: V3 = [-Math.sin(ang) * sz * 0.6, sz * 0.5, Math.cos(ang) * sz * 0.6];
        cur.tone = rnd(q, 2); cur.how = 2;
        quad([c[0] - u[0], c[1] - u[1], c[2] - u[2]], [c[0] + vv[0], c[1] + vv[1], c[2] + vv[2]], [c[0] + u[0], c[1] + u[1], c[2] + u[2]], [c[0] - vv[0], c[1] - vv[1], c[2] - vv[2]], nrm, 0.75, MAT.leaves);
      };
      vines.forEach(([x, y, z], p) => { if (rnd(x * 7, z * 13, 3) > 0.6) return; for (let q = 0; q < 26; q++) { const t = q / 26, a = t * 14 + p; leaf([x + Math.cos(a) * 0.06, y + 0.1 + t * (yB - y - 0.05), z + Math.sin(a) * 0.06], 0.035, [Math.cos(a), 0.3, Math.sin(a)], p * 100 + q); } });
      for (const [i, j] of cells) {
        const clumps = 1 + Math.floor(rnd(i, j, k, 4) * 3);
        for (let c = 0; c < clumps; c++) {
          const mx = X(i) + 0.15 + 0.7 * rnd(i, j, c, 5), mz = Z(j) + 0.15 + 0.7 * rnd(i, j, c, 6), rr = 0.12 + 0.12 * rnd(i, j, c, 7);
          for (let q = 0; q < 22; q++) {
            const a = rnd(i, j, c, q, 8) * Math.PI * 2, d = Math.sqrt(rnd(i, j, c, q, 9)) * rr, hang = rnd(i, j, c, q, 10) < 0.25 ? rnd(i, j, c, q, 11) * 0.22 : 0;
            leaf([mx + Math.cos(a) * d, yR + RH + 0.01 - hang, mz + Math.sin(a) * d], 0.04, hang ? [Math.cos(a), 0.2, Math.sin(a)] : [0, 1, 0], i * 1000 + j * 100 + c * 30 + q);
          }
        }
      }
    }
  }

  /**
   * The land (land.ts): its ground as a surface, fine enough to show its banks and shelves, drawn barely (the shader);
   * its sides, rock, down to the table it stands on; the stream in its bed, falling where its bed steps; and a few
   * things of its own, sparing: rocks at the foot of its cliffs, on the outcrop and along the stream; low shrubs on its
   * banks; a cypress or two. None of them where anything's built.
   */
  function landMesh() {
    const land = w.land!, B = w.extent(), x0 = B.i0, x1 = B.i1 + 1, z0 = B.j0, z1 = B.j1 + 1, RES = (x1 - x0) * (z1 - z0) > 500 ? 3 : 4;
    const Y = (gx: number, gz: number) => groundY(w, Math.min(x1 - 1e-4, Math.max(x0, gx)), Math.min(z1 - 1e-4, Math.max(z0, gz)));
    cur = { born: -1e3, pivot: 0, how: 1, tone: 0.5, dress: 0, sel: false };
    const nx = (x1 - x0) * RES, nz = (z1 - z0) * RES;
    const P = (a: number, b: number): V3 => { const gx = x0 + a / RES, gz = z0 + b / RES; return [gx - CENTER, Y(gx, gz), gz - CENTER]; };
    const Nrm = (a: number, b: number): V3 => {
      const gx = x0 + a / RES, gz = z0 + b / RES, e = 0.5 / RES, dx = Y(gx + e, gz) - Y(gx - e, gz), dz = Y(gx, gz + e) - Y(gx, gz - e), l = Math.hypot(dx, 2 * e, dz);
      return [-dx / l, (2 * e) / l, -dz / l];
    };
    const pts: V3[][] = [], nrm: V3[][] = [];
    for (let a = 0; a <= nx; a++) { pts.push([]); nrm.push([]); for (let b = 0; b <= nz; b++) { pts[a].push(P(a, b)); nrm[a].push(Nrm(a, b)); } }
    const v = (a: number, b: number, ao = 1) => vert(pts[a][b], nrm[a][b], ao, LANDMAT);
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) { v(a, b); v(a, b + 1); v(a + 1, b); v(a, b + 1); v(a + 1, b + 1); v(a + 1, b); }
    // (its sides: rock, down from its edge to the table; bleeding into the page, after Taohua, neither: the land's
    // ground is all there is of it)
    const foot = -SLAB;
    if (!bleed) {
    const side = (p: V3[], n: V3) => { for (let q = 0; q + 1 < p.length; q++) quad(p[q], p[q + 1], [p[q + 1][0], foot, p[q + 1][2]], [p[q][0], foot, p[q][2]], n, [1, 1, 0.6, 0.6], LANDMAT); };
    side(pts.map((c) => c[0]), [0, 0, -1]); side(pts.map((c) => c[nz]), [0, 0, 1]); side(pts[0], [-1, 0, 0]); side(pts[nx], [1, 0, 0]);
    // (the table round it)
    const T = 90, R = 1.6, xa = x0 - CENTER, xb = x1 - CENTER, za = z0 - CENTER, zb = z1 - CENTER;
    quad([xa - R, foot, za - R], [xb + R, foot, za - R], [xb + R, foot, zb + R], [xa - R, foot, zb + R], [0, 1, 0], 1, MAT.table);
    for (const [qa, qb, qc, qd] of [[-T, -T, T, za - R], [-T, zb + R, T, T], [-T, za - R, xa - R, zb + R], [xb + R, za - R, T, zb + R]]) quad([qa, foot, qb], [qc, foot, qb], [qc, foot, qd], [qa, foot, qd], [0, 1, 0], 1, MAT.table);
    }
    // (the stream: its water a little under its banks, a fall where its bed steps down to the next)
    const wet = (i: number, j: number) => land.water.has(j * 1000 + i);
    for (const [i, j] of land.stream) {
      if (!w.onSlab(i, j)) continue;
      const g = w.ground(i, j), y = g - 0.17, cx = X(i), cz = Z(j);
      cur = { born: -1e3, pivot: 0, how: 1, tone: 0.5, dress: 0, sel: false };
      quad([cx - 0.05, y, cz - 0.05], [cx + 1.05, y, cz - 0.05], [cx + 1.05, y, cz + 1.05], [cx - 0.05, y, cz + 1.05], [0, 1, 0], 1, MAT.water);
      for (let d = 0; d < 4; d++) {
        const [a, b] = DIRS[d];
        if (!wet(i + a, j + b) || w.ground(i + a, j + b) >= g) continue;
        const y1 = w.ground(i + a, j + b) - 0.17, [ta, tb] = DIRS[(d + 1) % 4], ex = cx + 0.5 + a * 0.5, ez = cz + 0.5 + b * 0.5;
        quad([ex - ta * 0.42, y1, ez - tb * 0.42], [ex + ta * 0.42, y1, ez + tb * 0.42], [ex + ta * 0.42, y, ez + tb * 0.42], [ex - ta * 0.42, y, ez - tb * 0.42], [a, 0.3, b], 1, MAT.water);
        foam(ex + a * 0.22, y1 + 0.012, ez + b * 0.22, i * 5 + j * 11 + d);
      }
    }
    // (a court's paving, and a way's on the ground: flags laid on the land's level middles)
    for (let j = B.j0; j <= B.j1; j++) for (let i = B.i0; i <= B.i1; i++) {
      const court = w.courts.has(key(0, i, j)), paved = w.paved(i, j);
      if (!court && !paved) continue;
      const g = w.ground(i, j), y = g + 0.012, cx = X(i), cz = Z(j), e = (d: number) => { const [a, b] = DIRS[d]; return w.ground(i + a, j + b) === g && (w.courts.has(key(0, i + a, j + b)) || w.paved(i + a, j + b) || w.occupied(g, i + a, j + b)) ? 0 : 0.12; };
      cur = { born: -1e3, pivot: 0, how: 1, tone: 0, dress: 0, sel: selected.has(key(g, i, j)) };
      quad([cx + e(2), y, cz + e(3)], [cx + 1 - e(0), y, cz + e(3)], [cx + 1 - e(0), y, cz + 1 - e(1)], [cx + e(2), y, cz + 1 - e(1)], [0, 1, 0], 0.95, MAT.court);
    }
    // (banks held by walls, where what's beside them is used: context.ts)
    for (const r of new Set(retaining(w).values())) retainingWall(r);
    cur = { born: -1e3, pivot: 0, how: 1, tone: 0.5, dress: 0, sel: false };
    // (what grows and lies on it, sparing, where nothing's built)
    const r = (...n: number[]) => hash(land.seed, ...n) / 4294967296;
    const bare = (i: number, j: number) => { const g = w.ground(i, j); return !w.occupied(g, i, j) && !w.occupied(g + 1, i, j) && !w.pool(i, j) && !w.courts.has(key(0, i, j)) && !w.way(g, i, j) && !w.paved(i, j); };
    const at = (i: number, j: number, fx: number, fz: number): V3 => { const gx = i + 0.5 + fx, gz = j + 0.5 + fz; return [gx - CENTER, Y(gx, gz), gz - CENTER]; };
    const boulder = (p: V3, s: number, q: number) => {
      const seg = 6 + (q % 3), turn = r(q, 2) * 6.28;
      for (let n = 0; n < seg; n++) {
        const a0 = turn + (n / seg) * 6.28, a1 = turn + ((n + 1) / seg) * 6.28, k0 = 0.75 + 0.5 * r(q, n, 3), k1 = 0.75 + 0.5 * r(q, (n + 1) % seg, 3);
        const lo = (a: number, k: number): V3 => [p[0] + Math.cos(a) * s * k, p[1] - 0.05, p[2] + Math.sin(a) * s * k * 0.85];
        const mid = (a: number, k: number): V3 => [p[0] + Math.cos(a) * s * k * 0.8, p[1] + s * 0.55, p[2] + Math.sin(a) * s * k * 0.7];
        const top: V3 = [p[0] + s * 0.1, p[1] + s * 0.8, p[2]];
        face([lo(a0, k0), lo(a1, k1), mid(a1, k1), mid(a0, k0)], LANDMAT, 0.8, true, [p[0], p[1] + s * 0.3, p[2]]);
        face([mid(a0, k0), mid(a1, k1), top], LANDMAT, 1, true, [p[0], p[1] + s * 0.3, p[2]]);
      }
    };
    const shrub = (p: V3, s: number, q: number) => {
      cur = { born: -1e3, pivot: p[1], how: 3 + 0.999 * r(q, 41), tone: r(q, 5), dress: 0, sel: false };
      lathe(p[0], p[2], Array.from({ length: 6 }, (_, n) => { const t = (n / 5) * Math.PI; return [Math.sin(t) * s * (1 + 0.1 * Math.sin(n * 2.3 + q)), p[1] - 0.02 + s * 0.7 * (1 - Math.cos(t))] as [number, number]; }), MAT.leaves, 8);
      cur = { born: -1e3, pivot: 0, how: 1, tone: 0.5, dress: 0, sel: false };
    };
    for (let j = B.j0; j <= B.j1; j++) for (let i = B.i0; i <= B.i1; i++) {
      if (!bare(i, j)) continue;
      const g = w.ground(i, j), q = (j - LAND.j0) * 100 + (i - LAND.i0);
      const higher = DIRS.map(([a, b]) => w.ground(i + a, j + b) - g), cliff = higher.findIndex((h) => h >= 2), bank = higher.some((h) => h !== 0);
      const nearRock = Math.abs(i - land.rock[0]) + Math.abs(j - land.rock[1]) <= 1, byWater = DIRS.some(([a, b]) => land.water.has((j + b) * 1000 + i + a));
      // (rocks: at a cliff's foot, on the outcrop, by the stream)
      if ((cliff >= 0 && r(q, 1) < 0.45) || (nearRock && r(q, 6) < 0.7) || (byWater && r(q, 7) < 0.3)) {
        const [a, b] = cliff >= 0 ? DIRS[cliff] : [r(q, 8) - 0.5, r(q, 9) - 0.5];
        // (each thing on the land marked as such, with its own chance of being drawn where the land bleeds away)
        cur = { born: -1e3, pivot: 0, how: 3 + 0.999 * r(q, 40), tone: 0.5, dress: 0, sel: false };
        boulder(at(i, j, a * 0.28, b * 0.28), 0.16 + 0.14 * r(q, 10), q);
        if (r(q, 11) < 0.5) boulder(at(i, j, a * 0.1 + (r(q, 12) - 0.5) * 0.4, b * 0.1 + (r(q, 13) - 0.5) * 0.4), 0.08 + 0.06 * r(q, 14), q + 7);
      }
      // (shrubs on the banks; a cypress now and then on open ground)
      if (bank && r(q, 20) < 0.18) for (let n = 0; n < 1 + Math.floor(r(q, 21) * 3); n++) shrub(at(i, j, (r(q, 22, n) - 0.5) * 0.7, (r(q, 23, n) - 0.5) * 0.7), 0.1 + 0.08 * r(q, 24, n), q + n);
      else if (!bank && r(q, 30) < 0.035) cypress(i, j, g, -1e3, 3 + 0.999 * r(q, 42));
    }
    cur = { born: -1e3, pivot: 0, how: 1, tone: 0, dress: 0, sel: false };
  }
  /**
   * A retaining wall, holding a bank where it's used: along the edge between the high cell and the low, its face out
   * into the low one, battered (thicker at its foot), from a little under the low ground up to the high, coped; a low
   * upstand over the coping where the ground above is open; an end where it doesn't run on
   */
  function retainingWall(r: { i: number; j: number; d: number; lo: number; hi: number }) {
    const [a, b] = DIRS[r.d], [ta, tb] = DIRS[(r.d + 1) % 4], bx = X(r.i) + 0.5 + a * 0.5, bz = Z(r.j) + 0.5 + b * 0.5;
    const up = w.occupied(r.hi, r.i, r.j) ? 0 : 0.1, yb = r.lo - 0.35, yt = r.hi + up, TB = 0.24, TT = 0.13, C = 0.05;
    const P = (s: number, u: number, y: number): V3 => [bx + ta * s + a * u, y, bz + tb * s + b * u];
    const on = (sg: number) => retaining(w).has(`${r.i + sg * ta}.${r.j + sg * tb}.${r.d}`);
    cur = { born: -1e3, pivot: yb, how: 1, tone: (((r.i * 73856093) ^ (r.j * 19349663) ^ (r.d * 83492791)) >>> 0) / 4294967296, dress: 0, sel: false };
    const n = Math.hypot(yt - yb, TB - TT);
    quad(P(-0.5, TB, yb), P(0.5, TB, yb), P(0.5, TT, yt), P(-0.5, TT, yt), [a * (yt - yb) / n, (TB - TT) / n, b * (yt - yb) / n], [0.55, 0.55, 0.9, 0.9], MAT.stone);
    // (its coping: out a little either side, its top, its edges)
    const c0 = -0.07, c1 = TT + 0.04;
    quad(P(-0.5, c0, yt + C), P(0.5, c0, yt + C), P(0.5, c1, yt + C), P(-0.5, c1, yt + C), [0, 1, 0], 1, MAT.stone);
    quad(P(-0.5, c1, yt), P(0.5, c1, yt), P(0.5, c1, yt + C), P(-0.5, c1, yt + C), [a, 0, b], 0.9, MAT.stone);
    quad(P(-0.5, c1, yt), P(0.5, c1, yt), P(0.5, TT, yt), P(-0.5, TT, yt), [0, -1, 0], 0.5, MAT.stone);
    if (up > 0) quad(P(-0.5, c0, r.hi), P(0.5, c0, r.hi), P(0.5, c0, yt + C), P(-0.5, c0, yt + C), [-a, 0, -b], 0.85, MAT.stone);
    for (const sg of [-1, 1]) {
      if (on(sg)) continue;
      const s = sg * 0.5;
      quad(P(s, 0, yb), P(s, TB, yb), P(s, TT, yt), P(s, 0, yt), [ta * sg, 0, tb * sg], 0.8, MAT.stone);
      quad(P(s, c0, yt), P(s, c1, yt), P(s, c1, yt + C), P(s, c0, yt + C), [ta * sg, 0, tb * sg], 0.9, MAT.stone);
      if (up > 0) quad(P(s, c0, r.hi), P(s, 0, r.hi), P(s, 0, yt), P(s, c0, yt), [ta * sg, 0, tb * sg], 0.85, MAT.stone);
    }
  }
  /** a thin wall: a wall's thickness, full height, running out from its middle to the stone beside it */
  function thinWall(k: number, i: number, j: number) {
    const cx = X(i) + 0.5, cz = Z(j) + 0.5, y0 = founded(k, i, j) ? k - FOUND : k, y1 = k + 1, arms = wallArms(w, k, i, j), lid = !w.stone(k + 1, i, j) && w.stair(k + 1, i, j) < 0;
    const ao = floored(k, i, j) || k === w.ground(i, j) ? [0.6, 0.6, 1, 1] : 1;
    // (a jali: the screen pierced through)
    if (dressed(k, i, j)?.screen) cur.dress = (cur.dress % KIND) + PIERCED;
    // (its middle, then each arm out to the cell's edge; faces only where nothing's against them)
    const part = (x0: number, x1: number, z0: number, z1: number, open: boolean[]) => {
      if (open[0]) quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], ao, MAT.stone);
      if (open[1]) quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], ao, MAT.stone);
      if (open[2]) quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], ao, MAT.stone);
      if (open[3]) quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], ao, MAT.stone);
      if (lid) quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], 1, MAT.stone);
    };
    part(cx - TH, cx + TH, cz - TH, cz + TH, [!arms[3], !arms[1], !arms[2], !arms[0]]);
    const end = (d: number) => { const [a, b] = DIRS[d]; return !(w.stone(k, i + a, j + b) || w.stair(k, i + a, j + b) >= 0); };
    if (arms[0]) part(cx + TH, cx + 0.5, cz - TH, cz + TH, [true, true, false, end(0)]);
    if (arms[2]) part(cx - 0.5, cx - TH, cz - TH, cz + TH, [true, true, end(2), false]);
    if (arms[1]) part(cx - TH, cx + TH, cz + TH, cz + 0.5, [false, end(1), true, true]);
    if (arms[3]) part(cx - TH, cx + TH, cz - 0.5, cz - TH, [end(3), false, true, true]);
  }
  /**
   * Ivy: on each open side of a stone, a few trailing strands hanging from its top, each a run of leaves, every leaf its
   * own (its size, its tilt, how far it stands off the stone, its shade); a few at the top lean out over the edge, so
   * the ivy breaks the stone's outline rather than being painted on it.
   */
  function ivy(k: number, i: number, j: number, born: number) {
    if (w.block(k, i, j) && outline(w, k, i, j).flow) return;
    const cx = X(i) + 0.5, cz = Z(j) + 0.5, y1 = k + 1, more = !!dressed(k + 1, i, j)?.ivy, below = w.stone(k - 1, i, j);
    for (let d = 0; d < 4; d++) {
      const [a, b] = DIRS[d], [ta, tb] = DIRS[(d + 1) % 4];
      if (w.stone(k, i + a, j + b) || w.stair(k, i + a, j + b) >= 0) continue;
      const rnd = (...n: number[]) => hash(w.seed, k, i, j, d, ...n) / 4294967296;
      const strands = 2 + Math.floor(rnd(0) * 3);
      for (let s = 0; s < strands; s++) {
        let u = -0.4 + 0.8 * ((s + 0.2 + 0.6 * rnd(s, 1)) / strands);
        const len = more ? 1 : 0.3 + 0.7 * rnd(s, 2), stop = below && rnd(s, 3) > 0.5 ? y1 - 1.25 : y1 - Math.min(0.98, len);
        let n = 0;
        for (let y = y1 + (more ? 0 : 0.03); y > stop; y -= 0.055 + 0.02 * rnd(s, n, 4), n++) {
          u = Math.max(-0.47, Math.min(0.47, u + (rnd(s, n, 5) - 0.5) * 0.05));
          const side = n % 2 ? 1 : -1, r = rnd(s, n, 6), sz = 0.035 + 0.03 * r, off = 0.006 + 0.022 * rnd(s, n, 7);
          // (at the top, some lean out over the edge)
          const over = !more && y > y1 - 0.06 && rnd(s, n, 8) > 0.4;
          const lu = u + side * 0.022, ang = (rnd(s, n, 9) - 0.5) * 1.6 + side * 0.5;
          const rr = reach(w, k, i, j, d), c: V3 = [cx + a * (rr + off) + ta * lu, y, cz + b * (rr + off) + tb * lu];
          // (the leaf: a diamond, pointing down and out a little, turned)
          const dx = Math.sin(ang), dy = -Math.cos(ang), up = over ? 0.6 : 0.15;
          const along: V3 = [ta * dx * sz + a * up * sz, dy * sz * (over ? 0.4 : 1) + (over ? sz * 0.5 : 0), tb * dx * sz + b * up * sz], across: V3 = [ta * -dy * sz * 0.6, dx * sz * 0.6, tb * -dy * sz * 0.6];
          const nl = Math.hypot(a + (over ? 0 : 0), over ? 0.9 : 0.25, b) || 1, nrm: V3 = [a / nl, (over ? 0.9 : 0.25) / nl, b / nl];
          cur = { born: born + 0.3 + 0.02 * n, pivot: y, how: 2, tone: rnd(s, n, 10), dress: 0, sel: false };
          quad([c[0] - along[0], c[1] - along[1], c[2] - along[2]], [c[0] + across[0], c[1] + across[1], c[2] + across[2]], [c[0] + along[0], c[1] + along[1], c[2] + along[2]], [c[0] - across[0], c[1] - across[1], c[2] - across[2]], nrm, 0.75 + 0.25 * r, MAT.leaves);
        }
      }
    }
  }
  /** a face of any shape (three or four corners), its normal worked out from them: turned up (or down), or, given a point
   * inside, turned away from it */
  function face(p: V3[], mat: number, ao = 1, up = true, from?: V3) {
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    let n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(...n) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
    if (from) { const c = p.reduce((a, q) => [a[0] + q[0] / p.length, a[1] + q[1] / p.length, a[2] + q[2] / p.length], [0, 0, 0]); if (n[0] * (c[0] - from[0]) + n[1] * (c[1] - from[1]) + n[2] * (c[2] - from[2]) < 0) n = [-n[0], -n[1], -n[2]]; }
    else if ((n[1] < 0) === up) n = [-n[0], -n[1], -n[2]];
    if (p.length === 3) tri(p[0], p[1], p[2], n, ao, mat); else quad(p[0], p[1], p[2], p[3], n, ao, mat);
  }
  /**
   * A roof over a building (buildings.ts says which): hipped (a pyramid on a square plan, a ridge along a long one),
   * gabled (two slopes, the ends walled up in stone), a shed roof (one slope, falling away from the taller stone it
   * leans on), or a dome on a drum. Tiled in terracotta (the dome in lead), out over the walls at the eaves, its
   * underside showing; a ridge along the top.
   */
  function roof(b: Building) {
    const O = 0.12, y = b.h, ye = y + 0.02;
    // (over the plan, or the part of it left beside a terrace)
    const P = b.roofPlan ?? b, xa = X(P.i0), xb = X(P.i1 + 1), za = Z(P.j0), zb = Z(P.j1 + 1), along = xb - xa >= zb - za ? 0 : 1;
    cur = { born: Math.max(...b.cols.map(([i, j]) => w.born(b.h - 1, i, j))) + 0.2, pivot: y, how: 1, tone: 0.5, dress: 0, sel: b.cols.some(([i, j]) => selected.has(key(b.h - 1, i, j))) };
    // (each slope a slab of tiles with a thickness: its top, its underside a little below, and its edges (the eaves, the
    // verges over a gable, the hips) closed, so where it overhangs a wall it reads as a roof, not a cut)
    const RT = 0.07;
    const slope = (p: V3[]) => {
      const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map((x) => x / l); if (n[1] < 0) n = n.map((x) => -x);
      const q = p.map((c) => [c[0] - n[0] * RT, c[1] - n[1] * RT, c[2] - n[2] * RT] as V3), mid = p.reduce((a, c) => [a[0] + c[0] / p.length, a[1] + c[1] / p.length, a[2] + c[2] / p.length], [0, 0, 0]) as V3;
      face(p, MAT.tile, 1, true); face(q, MAT.tile, 0.45, false);
      for (let e = 0; e < p.length; e++) { const a = p[e], b = p[(e + 1) % p.length]; face([a, b, q[(e + 1) % p.length], q[e]], MAT.tile, 0.8, true, [mid[0] - n[0] * RT / 2, mid[1] - n[1] * RT / 2, mid[2] - n[2] * RT / 2]); }
    };
    // (over a gable's ends, only a little past the wall: the verge)
    const OG = b.roof === 'gable' ? 0.05 : O;
    const X0 = xa - (along === 0 ? OG : O), X1 = xb + (along === 0 ? OG : O), Z0 = za - (along === 1 ? OG : O), Z1 = zb + (along === 1 ? OG : O), cx = (xa + xb) / 2, cz = (za + zb) / 2;
    if (b.roof === 'dome') {
      const r = Math.min(xb - xa, zb - za) * 0.42;
      lathe(cx, cz, [[r + 0.04, y], [r + 0.04, y + 0.06], [r, y + 0.06], [r, y + 0.2]], MAT.stone, 16);
      cur.dress = 0;
      lathe(cx, cz, Array.from({ length: 9 }, (_, q) => { const t = (q / 8) * (Math.PI / 2); return [r * Math.cos(t), y + 0.2 + r * 0.95 * Math.sin(t)] as [number, number]; }), MAT.lead, 16);
      lathe(cx, cz, [[0.03, y + 0.2 + r * 0.95], [0.02, y + 0.32 + r * 0.95], [0.045, y + 0.36 + r * 0.95], [0, y + 0.42 + r * 0.95]], MAT.lead, 6);
      return;
    }
    if (b.roof === 'shed') {
      // (high against what it leans on, falling to the eave the other side)
      const f = b.fall, H = 0.45, hy = (x: number, z: number) => { const t = f === 0 ? (x - X0) / (X1 - X0) : f === 2 ? (X1 - x) / (X1 - X0) : f === 1 ? (z - Z0) / (Z1 - Z0) : (Z1 - z) / (Z1 - Z0); return ye + H * (1 - t); };
      const c: V3[] = [[X0, 0, Z0], [X1, 0, Z0], [X1, 0, Z1], [X0, 0, Z1]].map(([x, , z]) => [x, hy(x, z), z] as V3);
      slope(c);
      // (its two sides walled up under the slope, in the planes of the walls across the fall)
      const mid: V3 = [cx, y, cz], sides: Array<[V3, V3]> = f % 2 === 0 ? [[[xa, 0, za], [xb, 0, za]], [[xa, 0, zb], [xb, 0, zb]]] : [[[xa, 0, za], [xa, 0, zb]], [[xb, 0, za], [xb, 0, zb]]];
      for (const [p, q] of sides) face([[p[0], y, p[2]], [q[0], y, q[2]], [q[0], hy(q[0], q[2]), q[2]], [p[0], hy(p[0], p[2]), p[2]]], MAT.stone, 0.9, true, mid);
      return;
    }
    // (hipped, or gabled: a ridge along the long way, at a pitch a little under half the short span)
    const S = along === 0 ? Z1 - Z0 : X1 - X0, H = S * 0.42;
    const r0: V3 = along === 0 ? [b.roof === 'hipped' ? X0 + S / 2 : X0, ye + H, cz] : [cx, ye + H, b.roof === 'hipped' ? Z0 + S / 2 : Z0];
    const r1: V3 = along === 0 ? [b.roof === 'hipped' ? X1 - S / 2 : X1, ye + H, cz] : [cx, ye + H, b.roof === 'hipped' ? Z1 - S / 2 : Z1];
    const A: V3 = [X0, ye, Z0], B: V3 = [X1, ye, Z0], C: V3 = [X1, ye, Z1], D: V3 = [X0, ye, Z1];
    if (along === 0) { slope([A, B, r1, r0]); slope([D, C, r1, r0]); } else { slope([A, D, r1, r0]); slope([B, C, r1, r0]); }
    if (b.roof === 'hipped') {
      if (along === 0) { slope([A, D, r0]); slope([B, C, r1]); } else { slope([A, B, r0]); slope([D, C, r1]); }
    } else {
      // (the gable ends: walled up in stone, in the plane of the wall, a band at their foot along the eaves' line)
      const hAt = (d: number) => ye + H * (1 - d / (S / 2));
      const mid: V3 = [cx, y, cz];
      if (along === 0) for (const x of [xa, xb]) { face([[x, y, za], [x, y, zb], [x, hAt(O), zb], [x, hAt(O), za]], MAT.stone, 0.85, true, mid); face([[x, hAt(O), za], [x, hAt(O), zb], [x, ye + H, cz]], MAT.stone, 0.85, true, mid); const o = x === xa ? -0.03 : 0.03; box(Math.min(x, x + o), Math.max(x, x + o), y - 0.02, y + 0.04, za, zb, MAT.stone, 0.9); }
      else for (const z of [za, zb]) { face([[xa, y, z], [xb, y, z], [xb, hAt(O), z], [xa, hAt(O), z]], MAT.stone, 0.85, true, mid); face([[xa, hAt(O), z], [xb, hAt(O), z], [cx, ye + H, z]], MAT.stone, 0.85, true, mid); const o = z === za ? -0.03 : 0.03; box(xa, xb, y - 0.02, y + 0.04, Math.min(z, z + o), Math.max(z, z + o), MAT.stone, 0.9); }
    }
    // (the ridge)
    const RW = 0.035;
    if (along === 0) box(r0[0], r1[0], ye + H - 0.01, ye + H + 0.04, cz - RW, cz + RW, MAT.tile, 0.9); else box(cx - RW, cx + RW, ye + H - 0.01, ye + H + 0.04, r0[2], r1[2], MAT.tile, 0.9);
  }
  /**
   * A colonnade's column, the part of it in level k: massive, swelling a little a third of the way up (entasis) and
   * tapering to its head; a square plinth and a moulded base at its foot, a cushion (echinus) and a square slab (abacus)
   * at its head, under the entablature it carries.
   */
  function column(cx: number, cz: number, k: number, ps: ReturnType<typeof pierShape>) {
    const R = ps.r, foot = ps.foot, yTop = ps.top + 2 - LINTEL, yS = foot + 0.16, yC = yTop - 0.2, H = yC - yS;
    const rAt = (y: number) => { const t = Math.max(0, Math.min(1, (y - yS) / H)); return R * (1 - 0.17 * t) + 0.012 * Math.sin(Math.PI * Math.min(1, t * 1.5)); };
    const ya = Math.max(k, yS), yb = Math.min(k === ps.top ? yC : k + 1, yC);
    if (yb > ya) { const n = Math.max(1, Math.ceil((yb - ya) / 0.2)), rings: Array<[number, number]> = []; for (let q = 0; q <= n; q++) { const y = ya + ((yb - ya) * q) / n; rings.push([rAt(y), y]); } lathe(cx, cz, rings, MAT.stone, 16); }
    if (k === foot) {
      const P0 = R + 0.07;
      box(cx - P0, cx + P0, k, k + 0.06, cz - P0, cz + P0, MAT.stone, 0.7);
      lathe(cx, cz, [[R + 0.05, k + 0.06], [R + 0.055, k + 0.085], [R + 0.03, k + 0.11], [R + 0.025, k + 0.13], [R + 0.01, k + 0.145], [rAt(yS), yS]], MAT.stone, 16);
    }
    if (k === ps.top) {
      const rn = rAt(yC), A = R + 0.08;
      lathe(cx, cz, [[rn, yC], [rn + 0.015, yC + 0.01], [rn + 0.015, yC + 0.03], [rn, yC + 0.04], [rn + 0.02, yC + 0.06], [A - 0.01, yC + 0.11], [A - 0.01, yC + 0.12]], MAT.stone, 16);
      box(cx - A, cx + A, yC + 0.12, yTop, cz - A, cz + A, MAT.stone, 0.95);
      quad([cx - A, yC + 0.12, cz - A], [cx + A, yC + 0.12, cz - A], [cx + A, yC + 0.12, cz + A], [cx - A, yC + 0.12, cz + A], [0, -1, 0], 0.55, MAT.stone);
    }
  }
  /** a turned baluster, from y0 to y1: a vase, swelling low and necked high */
  function baluster(x: number, z: number, y0: number, y1: number) {
    const h = y1 - y0, P: Array<[number, number]> = [[0.026, 0], [0.026, 0.06], [0.02, 0.09], [0.034, 0.3], [0.03, 0.45], [0.016, 0.66], [0.014, 0.78], [0.024, 0.86], [0.026, 1]];
    lathe(x, z, P.map(([r, t]) => [r, y0 + t * h]), MAT.stone, 6);
  }
  /** a bar from p0 to p1 (the middle of its underside), wd wide and ht high: a rail, a beam, a rafter */
  function bar(p0: V3, p1: V3, wd: number, ht: number, mat: number, ao = 0.9) {
    const dx = p1[0] - p0[0], dz = p1[2] - p0[2], l = Math.hypot(dx, dz) || 1, sx = (-dz / l) * (wd / 2), sz = (dx / l) * (wd / 2);
    const c = (p: V3, s: number, up: number): V3 => [p[0] + s * sx, p[1] + up, p[2] + s * sz], mid: V3 = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 + ht / 2, (p0[2] + p1[2]) / 2];
    face([c(p0, -1, ht), c(p1, -1, ht), c(p1, 1, ht), c(p0, 1, ht)], mat, 1, true, mid);
    face([c(p0, -1, 0), c(p1, -1, 0), c(p1, 1, 0), c(p0, 1, 0)], mat, 0.5, false, mid);
    for (const s of [-1, 1]) face([c(p0, s, 0), c(p1, s, 0), c(p1, s, ht), c(p0, s, ht)], mat, ao, true, mid);
    for (const p of [p0, p1]) face([c(p, -1, 0), c(p, 1, 0), c(p, 1, ht), c(p, -1, ht)], mat, ao, true, mid);
  }
  /** a box's sides and top */
  function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: number, ao: number[] | number = 1) {
    quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], ao, mat);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], ao, mat);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], ao, mat);
    quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], ao, mat);
    quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], 1, mat);
  }
  /** a turned shape round an upright through (cx, cz): rings of (radius, height) */
  function lathe(cx: number, cz: number, rings: Array<[number, number]>, mat: number, seg = 10) {
    for (let q = 0; q + 1 < rings.length; q++) for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2, [r0, y0] = rings[q], [r1, y1] = rings[q + 1];
      const am = (a0 + a1) / 2, dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy) || 1;
      quad([cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0], [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0], [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1], [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1], [(Math.cos(am) * dy) / l, -dr / l, (Math.sin(am) * dy) / l], 0.6 + 0.4 * (q / rings.length), mat);
    }
  }
  /** a lantern on a post: a dark post and cap, the lamp lit */
  function lantern(i: number, j: number, y: number, born: number) {
    cur = { born, pivot: y, how: 1, tone: 0.5, dress: 0, sel: false };
    const cx = X(i) + 0.5, cz = Z(j) + 0.5;
    box(cx - 0.06, cx + 0.06, y, y + 0.04, cz - 0.06, cz + 0.06, MAT.bark, 0.7);
    lathe(cx, cz, [[0.028, y + 0.04], [0.022, y + 0.33]], MAT.bark, 6);
    box(cx - 0.065, cx + 0.065, y + 0.33, y + 0.35, cz - 0.065, cz + 0.065, MAT.bark, 0.8);
    box(cx - 0.055, cx + 0.055, y + 0.35, y + 0.49, cz - 0.055, cz + 0.055, MAT.lamp);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(cx + sx * 0.058 - 0.01, cx + sx * 0.058 + 0.01, y + 0.35, y + 0.49, cz + sz * 0.058 - 0.01, cz + sz * 0.058 + 0.01, MAT.bark, 0.85);
    lathe(cx, cz, [[0.09, y + 0.49], [0.075, y + 0.51], [0.0, y + 0.58]], MAT.bark, 4);
  }
  /** a terracotta pot with a clipped shrub in it */
  function pot(i: number, j: number, y: number, born: number) {
    cur = { born, pivot: y, how: 2, tone: 0.5, dress: 0, sel: false };
    const cx = X(i) + 0.5, cz = Z(j) + 0.5;
    lathe(cx, cz, [[0.11, y], [0.13, y + 0.05], [0.17, y + 0.22], [0.19, y + 0.25], [0.15, y + 0.25]], MAT.clay, 12);
    const r = 0.21, c = y + 0.25 + r * 0.8;
    lathe(cx, cz, Array.from({ length: 9 }, (_, q) => { const t = (q / 8) * Math.PI; return [Math.sin(t) * r * (1 + 0.06 * Math.sin(q * 2.7)), c - Math.cos(t) * r] as [number, number]; }), MAT.leaves, 12);
  }

  /** stone with a way through it along an axis; tall, with an arch the same way under or over it */
  function archCell(k: number, i: number, j: number, a: number) {
    const y1 = k + 1, lower = w.archway(k + 1, i, j) === a, upper = w.archway(k - 1, i, j) === a;
    const ys = k + (upper ? 0.55 : 0.5), cx = X(i) + 0.5, cz = Z(j) + 0.5, y0 = founded(k, i, j) ? k - FOUND : k;
    const P = (u: number, wv: number, y: number): V3 => (a === 0 ? [cx + u, y, cz + wv] : [cx + wv, y, cz + u]);
    const nU = (s: number): V3 => (a === 0 ? [s, 0, 0] : [0, 0, s]), nW = (s: number): V3 => (a === 0 ? [0, 0, s] : [s, 0, 0]);
    // (its solid sides, across the way)
    const x0 = X(i), z0 = Z(j);
    for (let d = 0; d < 4; d++) {
      if (d % 2 === a || hides(k, i, j, d)) continue;
      const [da, db] = DIRS[d], foot = floored(k, i + da, j + db) ? 0.6 : 1;
      const A: V3 = da ? [da > 0 ? x0 + 1 : x0, y0, z0] : [x0, y0, db > 0 ? z0 + 1 : z0], B: V3 = da ? [A[0], y0, z0 + 1] : [x0 + 1, y0, A[2]];
      quad(A, B, [B[0], y1, B[2]], [A[0], y1, A[2]], [da, 0, db], [foot, foot, 1, 1], MAT.stone);
    }
    const head = (t: number) => (lower ? y1 : ys + Math.sqrt(Math.max(0, HW * HW - t * t)));
    for (const s of [-1, 1]) {
      const d = a === 0 ? (s > 0 ? 0 : 2) : s > 0 ? 1 : 3;
      if (hides(k, i, j, d)) continue;
      const foot = floored(k, i + DIRS[d][0], j + DIRS[d][1]) && !upper ? 0.6 : 1;
      quad(P(s * 0.5, -0.5, y0), P(s * 0.5, -HW, y0), P(s * 0.5, -HW, y1), P(s * 0.5, -0.5, y1), nU(s), [foot, foot, 1, 1], MAT.stone);
      quad(P(s * 0.5, HW, y0), P(s * 0.5, 0.5, y0), P(s * 0.5, 0.5, y1), P(s * 0.5, HW, y1), nU(s), [foot, foot, 1, 1], MAT.stone);
      if (!lower) for (let q = 0; q < CURVE; q++) {
        const t0 = -HW + (2 * HW * q) / CURVE, t1 = -HW + (2 * HW * (q + 1)) / CURVE;
        quad(P(s * 0.5, t0, head(t0)), P(s * 0.5, t1, head(t1)), P(s * 0.5, t1, y1), P(s * 0.5, t0, y1), nU(s), 1, MAT.stone);
      }
    }
    for (const s of [-1, 1]) quad(P(-0.5, s * HW, y0), P(0.5, s * HW, y0), P(0.5, s * HW, lower ? y1 : ys), P(-0.5, s * HW, lower ? y1 : ys), nW(-s), upper ? 0.85 : [0.7, 0.7, 0.95, 0.95], MAT.within);
    if (!lower) for (let q = 0; q < CURVE; q++) {
      const t0 = -HW + (2 * HW * q) / CURVE, t1 = -HW + (2 * HW * (q + 1)) / CURVE, tm = (t0 + t1) / 2;
      const n = nW(-tm / HW); n[1] = -Math.sqrt(Math.max(0, HW * HW - tm * tm)) / HW;
      quad(P(-0.5, t0, head(t0)), P(0.5, t0, head(t0)), P(0.5, t1, head(t1)), P(-0.5, t1, head(t1)), n, 0.95, MAT.within);
    }
    // (its ring of voussoirs, on each open face)
    if (!lower) for (const s of [-1, 1]) {
      const d = a === 0 ? (s > 0 ? 0 : 2) : s > 0 ? 1 : 3;
      if (hides(k, i, j, d)) continue;
      const R0 = HW, R1 = HW + 0.08, V = 7, off = s * (0.5 + 0.012);
      const ring = (r: number, th: number, u: number): V3 => P(u, -r * Math.cos(th), ys + r * Math.sin(th));
      for (let v = 0; v < V; v++) {
        const ta = (Math.PI * v) / V + 0.012, tb = (Math.PI * (v + 1)) / V - 0.012, ro = v === 3 ? R1 + 0.025 : R1;
        quad(ring(R0, ta, off), ring(R0, tb, off), ring(ro, tb, off), ring(ro, ta, off), nU(s), 0.95, MAT.stone);
      }
    }
    if (lower) { if (!w.block(k + 1, i, j)) for (const [w0, w1] of [[-0.5, -HW], [HW, 0.5]]) quad(P(-0.5, w0, y1), P(0.5, w0, y1), P(0.5, w1, y1), P(-0.5, w1, y1), [0, 1, 0], 1, MAT.stone); }
    else topFace(k, i, j, y1);
  }

  /** an arch under a run of stone, and the stone over it: spandrels, deck, its underside lit from within */
  function span(sp: Span) {
    const { k, a, n } = sp, [di, dj] = DIRS[a], yT = k + 1;
    const { half, rise, ys, at: arc } = soffit(sp);
    cur = at(sp.born, yT, k, sp.i, sp.j); cur.sel = Array.from({ length: n }, (_, q) => selected.has(key(k, sp.i + q * di, sp.j + q * dj))).some(Boolean);
    const cx = X(sp.i) + 0.5 + (di * (n - 1)) / 2, cz = Z(sp.j) + 0.5 + (dj * (n - 1)) / 2;
    const P = (u: number, wv: number, y: number): V3 => (a === 0 ? [cx + u, y, cz + wv] : [cx + wv, y, cz + u]);
    const nW = (s: number): V3 => (a === 0 ? [0, 0, s] : [s, 0, 0]);
    const S = Math.max(CURVE, n * 10);
    // (which cell of the run a point along it is in, and whether a side's hidden there)
    const cellAt = (u: number) => Math.min(n - 1, Math.max(0, Math.floor(u + half)));
    const sideHidden = (q: number, s: number) => { const ci = sp.i + q * di, cj = sp.j + q * dj, d = a === 0 ? (s > 0 ? 1 : 3) : s > 0 ? 0 : 2; return hides(k, ci, cj, d) || w.span(k, ci + DIRS[d][0], cj + DIRS[d][1])?.a === a; };
    for (let q = 0; q < S; q++) {
      const u0 = -half + (n * q) / S, u1 = -half + (n * (q + 1)) / S, um = (u0 + u1) / 2, c = cellAt(um);
      for (const s of [-1, 1]) if (!sideHidden(c, s)) quad(P(u0, s * 0.5, arc(u0)), P(u1, s * 0.5, arc(u1)), P(u1, s * 0.5, yT), P(u0, s * 0.5, yT), nW(s), [0.85, 0.85, 1, 1], MAT.stone);
      const slope = (arc(u1) - arc(u0)) / (u1 - u0), l = Math.hypot(slope, 1);
      const nu: V3 = a === 0 ? [slope / l, -1 / l, 0] : [0, -1 / l, slope / l];
      const ao = 0.55 + 0.45 * Math.min(1, (arc(um) - ys) / Math.max(0.2, rise));
      quad(P(u0, -0.5, arc(u0)), P(u1, -0.5, arc(u1)), P(u1, 0.5, arc(u1)), P(u0, 0.5, arc(u0)), nu, ao, MAT.within);
    }
    // (a colonnade's lintel is an entablature: an architrave a little proud, the frieze, a cornice out over it; run on over
    // the columns to the next bay)
    if (sp.order === 'colonnade') {
      const beyond = (e: number) => { const q = e < 0 ? -1 : n, ci = sp.i + q * di, cj = sp.j + q * dj; return w.pier(k - 1, ci, cj) ? 0.5 : 0; };
      const u0 = -half - beyond(-1), u1 = half + beyond(1);
      for (const s of [-1, 1]) {
        if (sideHidden(cellAt(0), s)) continue;
        const band = (ya: number, yb: number, out: number) => {
          const o = s * (0.5 + out);
          quad(P(u0, o, ya), P(u1, o, ya), P(u1, o, yb), P(u0, o, yb), nW(s), 0.9, MAT.stone);
          quad(P(u0, s * 0.5, yb), P(u1, s * 0.5, yb), P(u1, o, yb), P(u0, o, yb), [0, 1, 0], 1, MAT.stone);
          quad(P(u0, s * 0.5, ya), P(u1, s * 0.5, ya), P(u1, o, ya), P(u0, o, ya), [0, -1, 0], 0.5, MAT.stone);
        };
        band(yT - LINTEL, yT - LINTEL + 0.1, 0.02);
        band(yT - 0.08, yT - 0.02, 0.05);
      }
    }
    // (an arch is built, not cut: a ring of voussoirs a little proud of the face, a keystone at its crown, and an impost
    // where it springs)
    if (!sp.flat && rise > 0.15) {
      const mid = cellAt(0), RW = 0.11, off = 0.014, V = Math.max(5, Math.round((Math.PI * (half + rise)) / 2 / 0.2) | 1);
      for (const s of [-1, 1]) {
        if (sideHidden(mid, s)) continue;
        const ring = (r: number, th: number, wv: number): V3 => P(-(half + r) * Math.cos(th), wv, ys + (rise + r) * Math.sin(th));
        for (let v = 0; v < V; v++) {
          const ta = (Math.PI * v) / V + 0.01, tb = (Math.PI * (v + 1)) / V - 0.01, ro = v === (V - 1) / 2 ? RW + 0.035 : RW, wv = s * (0.5 + off);
          quad(ring(0, ta, wv), ring(0, tb, wv), ring(ro, tb, wv), ring(ro, ta, wv), nW(s), 0.95, MAT.stone);
          const tm = (ta + tb) / 2, rn = [Math.cos(tm) * -(1 / (half + ro)), Math.sin(tm) / (rise + ro)], l = Math.hypot(rn[0], rn[1]) || 1;
          quad(ring(ro, ta, s * 0.5), ring(ro, tb, s * 0.5), ring(ro, tb, wv), ring(ro, ta, wv), a === 0 ? [rn[0] / l, rn[1] / l, 0] : [0, rn[1] / l, rn[0] / l], 0.9, MAT.stone);
        }
      }
      // (the imposts: a little ledge on each side's face where the arch springs)
      if (ys - sp.low > 0.12) for (const e of [-1, 1]) {
        const u0 = e * half, u1 = e * (half - 0.04), yb = ys - 0.07;
        quad(P(u1, -0.5, yb), P(u1, 0.5, yb), P(u1, 0.5, ys), P(u1, -0.5, ys), a === 0 ? [-e, 0, 0] : [0, 0, -e], 0.85, MAT.stone);
        quad(P(u0, -0.5, ys), P(u1, -0.5, ys), P(u1, 0.5, ys), P(u0, 0.5, ys), [0, 1, 0], 1, MAT.stone);
        quad(P(u0, -0.5, yb), P(u1, -0.5, yb), P(u1, 0.5, yb), P(u0, 0.5, yb), [0, -1, 0], 0.55, MAT.stone);
      }
    }
    for (let s = 0; s < n; s++) { cur = at(sp.born, yT, k, sp.i + s * di, sp.j + s * dj); topFace(k, sp.i + s * di, sp.j + s * dj, yT); }
  }

  /** a cypress: a dark spindle of leaves on a short trunk */
  function cypress(i: number, j: number, y0: number, born: number, how = 2) {
    const cx = X(i) + 0.5, cz = Z(j) + 0.5, Ht = 1.85, SEG = 12, RINGS = 16, seed = i * 31 + j * 17;
    cur = { born, pivot: y0, how, tone: 0.5, dress: 0, sel: selected.has(key(y0, i, j)) };
    const rnd = (q: number) => { const x = Math.sin((seed * 97 + q) * 12.9898) * 43758.5453; return x - Math.floor(x); };
    for (let s = 0; s < 6; s++) {
      const a0 = (s / 6) * Math.PI * 2, a1 = ((s + 1) / 6) * Math.PI * 2, r = 0.05;
      const n: V3 = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      quad([cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r], [cx + Math.cos(a1) * r, y0 + 0.2, cz + Math.sin(a1) * r], [cx + Math.cos(a0) * r, y0 + 0.2, cz + Math.sin(a0) * r], n, 0.6, MAT.bark);
    }
    const prof = (t: number) => 0.27 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.92) ** 0.8), 0.85);
    const lean = rnd(99) * 0.06;
    const at = (q: number, s: number): V3 => {
      const t = q / RINGS, ang = (s / SEG) * Math.PI * 2, bump = 1 + 0.1 * Math.sin(ang * 3 + q * 1.7 + rnd(1) * 6) * Math.sin(q * 2.3);
      const r = prof(t) * (q === RINGS ? 0 : bump);
      return [cx + Math.cos(ang) * r + lean * t, y0 + 0.12 + t * Ht, cz + Math.sin(ang) * r];
    };
    for (let q = 0; q < RINGS; q++) for (let s = 0; s < SEG; s++) {
      const a = at(q, s), b = at(q, s + 1), c = at(q + 1, s + 1), d = at(q + 1, s);
      const ang = ((s + 0.5) / SEG) * Math.PI * 2, t = (q + 0.5) / RINGS, dr = (prof(t + 0.01) - prof(t - 0.01)) / (0.02 * Ht);
      const l = Math.hypot(1, dr);
      quad(a, b, c, d, [Math.cos(ang) / l, -dr / l, Math.sin(ang) / l], 0.55 + 0.45 * t, MAT.leaves);
    }
  }
}

/**
 * Which tops have a parapet round them (by hand, or along a bridge or a high arcade of their own accord; a balustrade
 * along a colonnade), and on which edges (open edges, with nothing at that height beyond them); on a flowing wall, round
 * it as its form has it. Not on a roofed top.
 */
export function parapets(w: World, plain = false) {
  const dressed = (k: number, i: number, j: number) => look(w, k, i, j, plain);
  const edges = new Map<number, boolean[]>(), rails = new Map<number, number>(), flowRails = new Map<number, number>(), roofed = new Set<number>();
  for (const b of buildings(w).list) for (const [x, z] of underRoof(b)) roofed.add(key(b.h - 1, x, z));
  for (const v of [...w.mass.keys()]) {
    const [k, i, j] = unkey(v), d = dressed(k, i, j), sp = w.span(k, i, j);
    // (not on a thin wall: it's too thin to carry one)
    if (w.occupied(k + 1, i, j) || w.tree(k + 1, i, j) || roofed.has(v) || w.wall(k, i, j) >= 0) continue;
    // (a parapet of its own accord along anything carried high: a bridge, or an arch two levels up or more; along a
    // colonnade, a balustrade)
    const colonnade = sp?.order === 'colonnade' || onColumn(w, k, i, j);
    const bridge = (!!sp && k >= 1 && (sp.n >= 3 || k >= 2 || w.bridge(k, i, j))) || colonnade;
    if (!d?.parapet && !bridge) continue;
    // (on a flowing wall, round its curve or along its diagonal)
    if (w.block(k, i, j) && outline(w, k, i, j).flow) { flowRails.set(v, d?.parapet && d.rail ? d.rail : DRESS.parapet); continue; }
    const along = sp ? sp.a : colonnade ? (w.span(k, i + 1, j) || w.span(k, i - 1, j) ? 0 : 1) : -1;
    edges.set(v, DIRS.map(([a, b], q) => (!!d?.parapet || q % 2 !== along) && !(w.stone(k, i + a, j + b) || w.earth(k, i + a, j + b) || w.stair(k, i + a, j + b) >= 0 || w.occupied(k + 1, i + a, j + b) || w.stair(k + 1, i + a, j + b) >= 0)));
    rails.set(v, d?.parapet && d.rail ? d.rail : colonnade ? DRESS.balustrade : DRESS.parapet);
  }
  return { edges, rails, flowRails, roofed };
}

/** Whether a point's in stone (anything a touch would strike), and so where a ray meets the build */
export function inStone(w: World, x: number, y: number, z: number): boolean {
  if (y < 0) { const ex = w.extent(); return y > -SLAB && x > X(ex.i0) - MARGIN && x < X(ex.i1 + 1) + MARGIN && z > Z(ex.j0) - MARGIN && z < Z(ex.j1 + 1) + MARGIN; }
  const i = Math.floor(x + CENTER), j = Math.floor(z + CENTER), k = Math.floor(y);
  if (k >= w.levels || !w.onSlab(i, j)) return false;
  if (inLand(w, x, y, z)) return true;
  const fx = x + CENTER - i - 0.5, fz = z + CENTER - j - 0.5, fy = y - k;
  // (a block: as its form has it, the same outline it's drawn from)
  if (onColumn(w, k, i, j)) return fy > 1 - LINTEL || Math.hypot(fx, fz) < pierShape(w, k - 1, i, j).r + 0.04;
  if (w.block(k, i, j)) return inBlock(w, k, i, j, fx, fz, fy);
  if (w.wall(k, i, j) >= 0) {
    const arms = wallArms(w, k, i, j);
    return (Math.abs(fx) < TH && Math.abs(fz) < TH) || (Math.abs(fz) < TH && ((arms[0] && fx > 0) || (arms[2] && fx < 0))) || (Math.abs(fx) < TH && ((arms[1] && fz > 0) || (arms[3] && fz < 0)));
  }
  if (w.stone(k, i, j)) {
    const sp = w.span(k, i, j), aw = w.archway(k, i, j);
    if (!sp && aw >= 0) { const wv = aw === 0 ? fz : fx; return Math.abs(wv) > HW || (w.archway(k + 1, i, j) !== aw && fy > 0.5 + Math.sqrt(Math.max(0, HW * HW - wv * wv))); }
    if (!sp) return true;
    // (over an arch: stone above its curve)
    const so = soffit(sp), u = (sp.a === 0 ? i - sp.i : j - sp.j) + (sp.a === 0 ? fx : fz) + 0.5 - so.half;
    return y > so.at(u);
  }
  const d = w.stair(k, i, j);
  if (d >= 0) { const [a, b] = DIRS[d], u = 0.5 + (a ? a * fx : b * fz); return fy < Math.ceil(Math.max(0.001, u) * STEPS) / STEPS; }
  if (w.pier(k, i, j)) { const ps = pierShape(w, k, i, j); return Math.abs(fx - ps.ox) < ps.r + 0.04 && Math.abs(fz - ps.oz) < ps.r + 0.04; }
  if (w.tree(k, i, j) || w.tree(k - 1, i, j)) return Math.hypot(fx, fz) < 0.26;
  // (the air under an arch over this cell: its upper part's the arch's stone)
  for (let kk = k + 1; kk < w.levels; kk++) {
    const sp = w.span(kk, i, j);
    if (!sp) { if (w.occupied(kk, i, j)) break; continue; }
    const so = soffit(sp), u = (sp.a === 0 ? i - sp.i : j - sp.j) + (sp.a === 0 ? fx : fz) + 0.5 - so.half;
    return y > so.at(u);
  }
  return false;
}

/** whether a point's under the land's ground, as it's drawn (the same surface it's drawn from) */
export function inLand(w: World, x: number, y: number, z: number): boolean {
  if (!w.land) return false;
  if (!w.onSlab(Math.floor(x + CENTER), Math.floor(z + CENTER))) return false;
  const sy = groundY(w, x + CENTER, z + CENTER);
  return sy >= 0 && y < sy;
}

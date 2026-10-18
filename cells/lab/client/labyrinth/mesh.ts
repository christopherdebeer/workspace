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
import { look } from './character';
import { CENTER, DECK, DIRS, DRESS, key, unkey, type Span, type World } from './model';

/** floats a vertex: position, normal, ao (1 open .. 0 shut in), material (MAT), its rising (when laid, the height it
 * grows from, how), and a seed for its stone's tone */
export const STRIDE = 12;
export const MAT = { stone: 0, within: 1, water: 2, leaves: 3, bark: 4, slab: 5, slabSide: 6, table: 7, court: 8, lamp: 9, clay: 10 };
/** a stone's dressing, over its material (stone, or the light within an arch): 16 moss, 32 ivy, 64 × which stone
 * (travertine, brick, marble) */
export const MOSS = 16, IVY = 32, KIND = 64;
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
/** a thin wall's half-thickness */
export const TH = 0.15;
/**
 * A pier's column: slender (the higher it stands and the taller it runs, the slimmer), and where it stands in its cell:
 * in the middle on open ground, but stepped aside to the cell's edge when it stands on a way (a walkway, a landing), so
 * the way past it stays open.
 */
export function pierShape(w: World, k: number, i: number, j: number): { ox: number; oz: number; r: number; foot: number; top: number } {
  let foot = k; while (w.pier(foot - 1, i, j)) foot--;
  let top = k; while (w.pier(top + 1, i, j)) top++;
  const r = Math.max(0.1, 0.17 - 0.012 * foot - 0.006 * (top - foot));
  const way = DIRS.map(([a, b]) => w.floor(foot, i + a, j + b) && !w.stone(foot, i + a, j + b) && w.stair(foot, i + a, j + b) < 0);
  const n = way.filter(Boolean).length;
  if (n === 0 || n === 4 || (foot === 0 && n >= 3)) return { ox: 0, oz: 0, r, foot, top };
  // (to the side that isn't the way: across it if the way runs straight through, else away from where it comes in)
  const side = [0, 1, 2, 3].filter((d) => !way[d]).sort((p, q) => Number(way[(q + 2) % 4]) - Number(way[(p + 2) % 4]))[0];
  const o = 0.5 - r - 0.05;
  return { ox: DIRS[side][0] * o, oz: DIRS[side][1] * o, r, foot, top };
}
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

export function buildMesh(w: World, plain = false): Mesh {
  /** how a cell's dressed: the rules' dressing and the hand's (`plain`: the hand's alone) */
  const dressed = (k: number, i: number, j: number) => look(w, k, i, j, plain);
  const out: number[] = [];
  let cur = { born: -1e3, pivot: 0, how: 1, tone: 0, dress: 0 };
  /** a cell's dressing, as it's drawn over its stone */
  const dressOf = (k: number, i: number, j: number) => { const d = dressed(k, i, j); return d ? (d.mat ?? 0) * KIND + (d.moss ? MOSS : 0) + (d.ivy ? IVY : 0) : 0; };
  const at = (born: number, pivot: number, k: number, i: number, j: number, how = 1) => ({ born, pivot, how, tone: tone(k, i, j), dress: dressOf(k, i, j) });
  const vert = (p: V3, n: V3, ao: number, mat: number) => out.push(p[0], p[1], p[2], n[0], n[1], n[2], ao, mat === MAT.stone || mat === MAT.within ? mat + cur.dress : mat, cur.born, cur.pivot, cur.how, cur.tone);
  const quad = (a: V3, b: V3, c: V3, d: V3, n: V3, ao: number[] | number, mat: number) => {
    const A = typeof ao === 'number' ? [ao, ao, ao, ao] : ao;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const flip = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2] < 0;
    const P = flip ? [a, d, c, b] : [a, b, c, d], Q = flip ? [A[0], A[3], A[2], A[1]] : A;
    for (const k of [0, 1, 2, 0, 2, 3]) vert(P[k], n, Q[k], mat);
  };
  /** a face toward a neighbour hidden against it: a plain block, or a stair's back */
  const hides = (k: number, i: number, j: number, d: number) => {
    const ni = i + DIRS[d][0], nj = j + DIRS[d][1];
    if (w.block(k, ni, nj)) return true;
    const aw = w.archway(k, ni, nj);
    if (aw >= 0) return aw !== d % 2;
    const s = w.stair(k, ni, nj);
    return s >= 0 && (s + 2) % 4 === d;
  };
  const floored = (k: number, i: number, j: number) => !w.occupied(k, i, j) && (k === 0 ? !w.pool(i, j) : w.stone(k - 1, i, j));
  const cornerAo = (k: number, i: number, j: number) => {
    const s = (a: number, b: number) => (w.block(k, i + a, j + b) ? 1 : 0);
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
  const topFace = (k: number, i: number, j: number, y: number) => {
    if (w.block(k + 1, i, j) || w.stair(k + 1, i, j) >= 0) return;
    if (w.archway(k + 1, i, j) >= 0 && w.archway(k, i, j) === w.archway(k + 1, i, j)) return;
    const x0 = X(i), z0 = Z(j);
    quad([x0, y, z0], [x0 + 1, y, z0], [x0 + 1, y, z0 + 1], [x0, y, z0 + 1], [0, 1, 0], cornerAo(k + 1, i, j), MAT.stone);
  };

  // ─── the stone, and the table it's on ───
  {
    const ex = w.extent(), xa = X(ex.i0) - MARGIN, xb = X(ex.i1 + 1) + MARGIN, za = Z(ex.j0) - MARGIN, zb = Z(ex.j1 + 1) + MARGIN;
    for (let j = ex.j0 - 1; j <= ex.j1 + 1; j++) for (let i = ex.i0 - 1; i <= ex.i1 + 1; i++) {
      const inside = i >= ex.i0 && j >= ex.j0 && i <= ex.i1 && j <= ex.j1;
      if (inside && (w.pool(i, j) || w.block(0, i, j) || w.stair(0, i, j) >= 0)) continue;
      const x0 = i < ex.i0 ? xa : X(i), x1 = i > ex.i1 ? xb : X(i + 1), z0 = j < ex.j0 ? za : Z(j), z1 = j > ex.j1 ? zb : Z(j + 1);
      const court = inside && w.courts.has(key(0, i, j));
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
      sides(k, i, j, y0, y1, MAT.stone);
      topFace(k, i, j, y1);
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
        quad(pt(u0, 0, h), pt(u1, 0, h), pt(u1, 1, h), pt(u0, 1, h), [0, 1, 0], [0.8, 0.95, 0.95, 0.8], MAT.stone);
        quad(pt(u0, 0, h0), pt(u0, 1, h0), pt(u0, 1, h), pt(u0, 0, h), [-a, 0, -b], [0.65, 0.65, 0.9, 0.9], MAT.stone);
        for (const q of across) {
          if (hides(k, i, j, q)) continue;
          const dd = DIRS[q], wv = (a ? dd[1] : dd[0]) > 0 ? 1 : 0;
          quad(pt(u0, wv, y0), pt(u1, wv, y0), pt(u1, wv, h), pt(u0, wv, h), [dd[0], 0, dd[1]], [0.7, 0.7, 1, 1], MAT.stone);
        }
      }
      if (!hides(k, i, j, d)) quad(pt(1, 0, y0), pt(1, 1, y0), pt(1, 1, y1), pt(1, 0, y1), [a, 0, b], [0.7, 0.7, 1, 1], MAT.stone);
      continue;
    }
    if (w.pier(k, i, j)) {
      // (a pier: a slender column, a little tapered; a base where it stands, a capital where it meets what it carries)
      cur = at(w.born(k, i, j), 0, k, i, j);
      const ps = pierShape(w, k, i, j), cx = x0 + 0.5 + ps.ox, cz = z0 + 0.5 + ps.oz, H = ps.top + 1 - ps.foot;
      const rAt = (y: number) => ps.r * (1.06 - 0.12 * ((y - ps.foot) / H));
      const ya = k === ps.foot ? y0 + 0.09 : y0, yb = k === ps.top ? y1 - 0.11 : y1;
      lathe(cx, cz, [[rAt(ya), ya], [rAt(yb), yb]], MAT.stone, 8);
      if (k === ps.foot) { box(cx - ps.r - 0.05, cx + ps.r + 0.05, y0, y0 + 0.06, cz - ps.r - 0.05, cz + ps.r + 0.05, MAT.stone, 0.7); box(cx - ps.r - 0.025, cx + ps.r + 0.025, y0 + 0.06, y0 + 0.09, cz - ps.r - 0.025, cz + ps.r + 0.025, MAT.stone, 0.8); }
      if (k === ps.top) {
        const rc = ps.r + 0.07;
        box(cx - ps.r - 0.02, cx + ps.r + 0.02, y1 - 0.11, y1 - 0.06, cz - ps.r - 0.02, cz + ps.r + 0.02, MAT.stone, 0.85);
        box(cx - rc, cx + rc, y1 - 0.06, y1, cz - rc, cz + rc, MAT.stone, 0.9);
        quad([cx - rc, y1 - 0.06, cz - rc], [cx + rc, y1 - 0.06, cz - rc], [cx + rc, y1 - 0.06, cz + rc], [cx - rc, y1 - 0.06, cz + rc], [0, -1, 0], 0.6, MAT.stone);
      }
    }
  }
  for (const sp of w.spans) span(sp);

  // ─── what grows in the courtyards ───
  const hand = [...[...w.pools.entries()].map(([v, b]) => { const [, i, j] = unkey(v); return { kind: 'pool' as const, i, j, born: b, k: 0 }; }), ...[...w.trees.entries()].map(([v, b]) => { const [k, i, j] = unkey(v); return { kind: 'cypress' as const, i, j, born: b, k }; })];
  for (const dc of [...w.decor.map((d) => ({ ...d, k: 0 })), ...hand]) {
    cur = { born: dc.born, pivot: -0.4, how: 1, tone: 0.5, dress: 0 };
    const x0 = X(dc.i), z0 = Z(dc.j);
    if (dc.kind === 'pool') {
      const lv = -0.1;
      quad([x0, lv, z0], [x0 + 1, lv, z0], [x0 + 1, lv, z0 + 1], [x0, lv, z0 + 1], [0, 1, 0], 1, MAT.water);
      for (let d = 0; d < 4; d++) {
        const [a, b] = DIRS[d];
        if (w.pool(dc.i + a, dc.j + b)) continue;
        const A: V3 = a ? [a > 0 ? x0 + 1 : x0, lv, z0] : [x0, lv, b > 0 ? z0 + 1 : z0], B: V3 = a ? [A[0], lv, z0 + 1] : [x0 + 1, lv, A[2]];
        quad(A, B, [B[0], 0, B[2]], [A[0], 0, A[2]], [-a, 0, -b], [0.6, 0.6, 0.9, 0.9], MAT.court);
      }
    } else if (dc.kind === 'pot') pot(dc.i, dc.j, 0, dc.born);
    else cypress(dc.i, dc.j, dc.k, dc.born);
  }

  // ─── dressing: parapets (by hand, and along a bridge of its own accord), lanterns and pots ───
  for (const v of [...w.mass.keys()]) {
    const [k, i, j] = unkey(v), d = dressed(k, i, j), sp = w.span(k, i, j);
    if (w.occupied(k + 1, i, j) || w.tree(k + 1, i, j)) continue;
    // (a parapet of its own accord along anything carried high: a bridge, or an arch two levels up or more)
    const bridge = !!sp && k >= 1 && (sp.n >= 3 || k >= 2 || w.bridge(k, i, j));
    if (d?.parapet || bridge) {
      cur = at(w.born(k, i, j), k + 1, k, i, j);
      for (let q = 0; q < 4; q++) {
        const [a, b] = DIRS[q];
        if (!d?.parapet && q % 2 === sp!.a) continue;
        if (w.stone(k, i + a, j + b) || w.stair(k, i + a, j + b) >= 0 || w.occupied(k + 1, i + a, j + b) || w.stair(k + 1, i + a, j + b) >= 0) continue;
        // (a low wall along that edge, a coping on it)
        const x0 = X(i), z0 = Z(j), T = 0.11, y0 = k + 1, y1 = y0 + 0.3, C = 0.025;
        const [bx0, bx1, bz0, bz1] = a > 0 ? [x0 + 1 - T, x0 + 1, z0, z0 + 1] : a < 0 ? [x0, x0 + T, z0, z0 + 1] : b > 0 ? [x0, x0 + 1, z0 + 1 - T, z0 + 1] : [x0, x0 + 1, z0, z0 + T];
        box(bx0, bx1, y0, y1, bz0, bz1, MAT.stone, [0.75, 0.75, 1, 1]);
        // (its coping: a little proud of it either side)
        const [cx0, cx1, cz0, cz1] = a ? [bx0 - C, bx1 + C, bz0, bz1] : [bx0, bx1, bz0 - C, bz1 + C];
        box(cx0, cx1, y1, y1 + 0.05, cz0, cz1, MAT.stone, 0.95);
      }
    }
    if (d?.prop === DRESS.lantern) lantern(i, j, k + 1, w.born(k, i, j));
    if (d?.prop === DRESS.pot) pot(i, j, k + 1, w.born(k, i, j));
  }
  return { data: new Float32Array(out), count: out.length / STRIDE };

  /** a thin wall: a wall's thickness, full height, running out from its middle to the stone beside it */
  function thinWall(k: number, i: number, j: number) {
    const cx = X(i) + 0.5, cz = Z(j) + 0.5, y0 = k, y1 = k + 1, arms = wallArms(w, k, i, j), lid = !w.stone(k + 1, i, j) && w.stair(k + 1, i, j) < 0;
    const ao = floored(k, i, j) || k === 0 ? [0.6, 0.6, 1, 1] : 1;
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
    cur = { born, pivot: y, how: 1, tone: 0.5, dress: 0 };
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
    cur = { born, pivot: y, how: 2, tone: 0.5, dress: 0 };
    const cx = X(i) + 0.5, cz = Z(j) + 0.5;
    lathe(cx, cz, [[0.11, y], [0.13, y + 0.05], [0.17, y + 0.22], [0.19, y + 0.25], [0.15, y + 0.25]], MAT.clay, 12);
    const r = 0.21, c = y + 0.25 + r * 0.8;
    lathe(cx, cz, Array.from({ length: 9 }, (_, q) => { const t = (q / 8) * Math.PI; return [Math.sin(t) * r * (1 + 0.06 * Math.sin(q * 2.7)), c - Math.cos(t) * r] as [number, number]; }), MAT.leaves, 12);
  }

  /** stone with a way through it along an axis; tall, with an arch the same way under or over it */
  function archCell(k: number, i: number, j: number, a: number) {
    const y0 = k, y1 = k + 1, lower = w.archway(k + 1, i, j) === a, upper = w.archway(k - 1, i, j) === a;
    const ys = y0 + (upper ? 0.55 : 0.5), cx = X(i) + 0.5, cz = Z(j) + 0.5;
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
    if (lower) { if (!w.block(k + 1, i, j)) for (const [w0, w1] of [[-0.5, -HW], [HW, 0.5]]) quad(P(-0.5, w0, y1), P(0.5, w0, y1), P(0.5, w1, y1), P(-0.5, w1, y1), [0, 1, 0], 1, MAT.stone); }
    else topFace(k, i, j, y1);
  }

  /** an arch under a run of stone, and the stone over it: spandrels, deck, its underside lit from within */
  function span(sp: Span) {
    const { k, a, n } = sp, [di, dj] = DIRS[a], yT = k + 1;
    const { half, rise, ys, at: arc } = soffit(sp);
    cur = at(sp.born, yT, k, sp.i, sp.j);
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
    for (let s = 0; s < n; s++) { cur = at(sp.born, yT, k, sp.i + s * di, sp.j + s * dj); topFace(k, sp.i + s * di, sp.j + s * dj, yT); }
  }

  /** a cypress: a dark spindle of leaves on a short trunk */
  function cypress(i: number, j: number, y0: number, born: number) {
    const cx = X(i) + 0.5, cz = Z(j) + 0.5, Ht = 1.85, SEG = 12, RINGS = 16, seed = i * 31 + j * 17;
    cur = { born, pivot: y0, how: 2, tone: 0.5, dress: 0 };
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

/** Whether a point's in stone (anything a touch would strike), and so where a ray meets the build */
export function inStone(w: World, x: number, y: number, z: number): boolean {
  if (y < 0) { const ex = w.extent(); return y > -SLAB && x > X(ex.i0) - MARGIN && x < X(ex.i1 + 1) + MARGIN && z > Z(ex.j0) - MARGIN && z < Z(ex.j1 + 1) + MARGIN; }
  const i = Math.floor(x + CENTER), j = Math.floor(z + CENTER), k = Math.floor(y);
  if (k >= w.levels || !w.onSlab(i, j)) return false;
  const fx = x + CENTER - i - 0.5, fz = z + CENTER - j - 0.5, fy = y - k;
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

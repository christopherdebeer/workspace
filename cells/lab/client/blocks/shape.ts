/**
 * The shape of the blocks: each cell's small cubes (voxels.ts), and the faces of them that show. A face shows where a
 * cube meets nothing, in this cell or the next, so a cell's mesh is made from its own cubes and the cubes of the 26
 * cells round it; those are filled from the reads two cells each way round this one, so a cell's mesh is named by
 * those (its patch) and kept: the same arrangement anywhere is the same mesh, made once. Faces of the same stuff in a
 * plane, shaded alike, are merged into one quad; each corner is shaded by the cubes round it.
 *
 * Every cube's faces lie on the lattice of twelfths, the same from either cell: the build is closed, whatever was built
 * in what order.
 */
import { voxels, M, type Grid, type Near } from './voxels';
import type { Read } from './rules';

/** a cell's mesh, in its own coordinates, 4 floats a vertex: position, and face, stuff and occlusion packed (face +
 * 6 × (stuff + 16 × occlusion)); and triangles */
export type Mesh = { v: Float32Array; i: Uint32Array };
export const VERTEX = 4;
const cache = new Map<string, Mesh>();
export const cacheStats = { hits: 0, made: 0 };
const NONE: Mesh = { v: new Float32Array(0), i: new Uint32Array(0) };

/** the reads of the cells round a cell (two each way), as a little array, and the cell's own name from them;
 * `floor`: how high the cell is over the ground (up to 3) */
export type Patch = { reads: Read[]; name: string; floor: number };
export const PATCH = 5;
const at = (a: number, b: number, c: number) => ((a + 2) * PATCH + (b + 2)) * PATCH + (c + 2);

/** a cell's patch: the reads of the cells two each way round it, named by their names */
export function patch(readAt: (x: number, y: number, z: number) => Read, x: number, y: number, z: number): Patch {
  const reads: Read[] = new Array(PATCH ** 3);
  let h1 = 0x811c9dc5, h2 = 0x9747b28c, any = false;
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) {
    const r = readAt(x + a, y + b, z + c);
    reads[at(a, b, c)] = r;
    if (r.solid && Math.max(Math.abs(a), Math.abs(b), Math.abs(c)) <= 1) any = true;
    h1 = Math.imul(h1 ^ r.h1, 0x01000193) >>> 0;
    h2 = Math.imul((h2 ^ r.h2) + 0x9e3779b9, 0x85ebca77) >>> 0;
  }
  // (or something of its own: a court's paving, water, a bed, a tree)
  const own = reads[at(0, 0, 0)];
  if (own.pool || own.bed || own.tree || (own.court >= 3 && own.level === 0 && y === 0)) any = true;
  const floor = Math.max(0, Math.min(y, 3));
  return { reads, name: any ? `${floor}|${h1.toString(36)}.${h2.toString(36)}` : '', floor };
}

/** the mesh of a cell, named by its patch and kept */
export function cellMesh(p: Patch): Mesh {
  if (!p.name) return NONE;
  const hit = cache.get(p.name);
  if (hit) { cacheStats.hits++; return hit; }
  cacheStats.made++;
  const m = surface(p.reads);
  if (cache.size > 20000) cache.clear();
  cache.set(p.name, m);
  return m;
}

// ─── each cell's cubes, kept by the reads that fill them ───
const grids = new Map<string, Grid>();
function gridAt(P: Read[], a: number, b: number, c: number): Grid {
  let h1 = 0x811c9dc5, h2 = 0x9747b28c;
  for (let p = -1; p <= 1; p++) for (let q = -1; q <= 1; q++) for (let r = -1; r <= 1; r++) {
    const rd = P[at(a + p, b + q, c + r)];
    h1 = Math.imul(h1 ^ rd.h1, 0x01000193) >>> 0;
    h2 = Math.imul((h2 ^ rd.h2) + 0x9e3779b9, 0x85ebca77) >>> 0;
  }
  const name = `${h1}.${h2}`;
  let g = grids.get(name);
  if (!g) {
    const N: Near = (p, q, r) => P[at(a + p, b + q, c + r)];
    g = voxels(N);
    if (grids.size > 30000) grids.clear();
    grids.set(name, g);
  }
  return g;
}

// (the six faces: their axis and which way)
const FACE_AXIS = [0, 0, 1, 1, 2, 2], FACE_SIGN = [1, -1, 1, -1, 1, -1];

export function surface(P: Read[]): Mesh {
  // (the cubes of the cell and the 26 round it)
  const G: Grid[] = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) G.push(gridAt(P, a, b, c));
  const own = G[13];
  let anything = false;
  for (let n = 0; n < own.length && !anything; n++) anything = own[n] !== 0;
  if (!anything) return NONE;
  // (a cube by its place, from −M to 2M − 1 each way: in this cell or the next)
  const cube = (i: number, j: number, k: number) => {
    const a = i < 0 ? 0 : i >= M ? 2 : 1, b = j < 0 ? 0 : j >= M ? 2 : 1, c = k < 0 ? 0 : k >= M ? 2 : 1;
    return G[(a * 3 + b) * 3 + c][((i - (a - 1) * M) * M + (j - (b - 1) * M)) * M + (k - (c - 1) * M)];
  };
  const vs: number[] = [], is: number[] = [];
  const mask = new Int32Array(M * M);
  const p = [0, 0, 0], d = [0, 0, 0], e = [0, 0, 0];
  for (let f = 0; f < 6; f++) {
    const ax = FACE_AXIS[f], sg = FACE_SIGN[f], ua = (ax + 1) % 3, va = (ax + 2) % 3;
    for (let s = 0; s < M; s++) {
      // (which faces of this layer show, and how each is shaded at its corners)
      for (let u = 0; u < M; u++) for (let v = 0; v < M; v++) {
        p[ax] = s; p[ua] = u; p[va] = v;
        const m = own[(p[0] * M + p[1]) * M + p[2]];
        let key = 0;
        if (m) {
          d[0] = p[0]; d[1] = p[1]; d[2] = p[2]; d[ax] += sg;
          if (!cube(d[0], d[1], d[2])) {
            let ao = 0;
            for (let corner = 0; corner < 4; corner++) {
              const du = corner === 1 || corner === 2 ? 1 : -1, dv = corner >= 2 ? 1 : -1;
              e[0] = d[0]; e[1] = d[1]; e[2] = d[2];
              e[ua] += du; const s1 = cube(e[0], e[1], e[2]) ? 1 : 0;
              e[va] += dv; const cn = cube(e[0], e[1], e[2]) ? 1 : 0;
              e[ua] -= du; const s2 = cube(e[0], e[1], e[2]) ? 1 : 0;
              ao |= (s1 && s2 ? 0 : 3 - (s1 + s2 + cn)) << (corner * 2);
            }
            key = 1 + m + 16 * ao;
          }
        }
        mask[u * M + v] = key;
      }
      // (merged into rectangles of the same stuff and shading)
      for (let u = 0; u < M; u++) for (let v = 0; v < M;) {
        const key = mask[u * M + v];
        if (!key) { v++; continue; }
        let h = 1;
        while (v + h < M && mask[u * M + v + h] === key) h++;
        let w = 1;
        grow: while (u + w < M) { for (let q = 0; q < h; q++) if (mask[(u + w) * M + v + q] !== key) break grow; w++; }
        for (let a = 0; a < w; a++) for (let q = 0; q < h; q++) mask[(u + a) * M + v + q] = 0;
        quad(vs, is, f, ax, ua, va, sg, s, u, v, w, h, key - 1);
        v += h;
      }
    }
  }
  return { v: new Float32Array(vs), i: new Uint32Array(is) };
}

function quad(vs: number[], is: number[], f: number, ax: number, ua: number, va: number, sg: number, s: number, u: number, v: number, w: number, h: number, key: number) {
  const m = key & 15, ao = key >> 4, base = vs.length / VERTEX;
  const plane = sg > 0 ? s + 1 : s;
  const corners = [[u, v], [u + w, v], [u + w, v + h], [u, v + h]];
  const o = [0, 1, 2, 3].map((c) => (ao >> (c * 2)) & 3);
  for (let c = 0; c < 4; c++) {
    const q = [0, 0, 0];
    q[ax] = plane; q[ua] = corners[c][0]; q[va] = corners[c][1];
    vs.push(q[0] / M - 0.5, q[1] / M - 0.5, q[2] / M - 0.5, f + 6 * (m + 16 * o[c]));
  }
  // (wound to face out; split along the diagonal that keeps the shading even)
  const tri = o[0] + o[2] < o[1] + o[3] ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
  for (let t = 0; t < 6; t += 3) {
    if (sg > 0) is.push(base + tri[t], base + tri[t + 1], base + tri[t + 2]);
    else is.push(base + tri[t], base + tri[t + 2], base + tri[t + 1]);
  }
}

export const clearShapes = () => { cache.clear(); grids.clear(); };
/** a shape already made, by its patch's name */
export const known = (name: string) => cache.get(name);
/** a shape made elsewhere (a worker), kept */
export function keep(name: string, m: Mesh) { if (cache.size > 20000) cache.clear(); cache.set(name, m); cacheStats.made++; }
/** a cell's cubes, from its patch (for tests) */
export const cubesOf = (p: Patch) => gridAt(p.reads, 0, 0, 0);

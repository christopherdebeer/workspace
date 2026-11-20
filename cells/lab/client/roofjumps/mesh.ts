/**
 * Roof Jumps' triangles: the city's boxes and the figure's bones as flat-shaded faces, and nothing more. Two
 * triangles a face, five faces a box (no undersides), six a bone. Each vertex is its place, its face's normal, its
 * box's tag, and where on the box it is (the box's footprint and its bottom and top, and a number the box keeps for
 * itself: a seed, the same every time it's built; for the figure, what it's made of: character.ts MAT). What a face is and where, never what
 * colour it is: a look is the renderer's business (looks.ts).
 */
import type { Chunk } from './city';
import { CHUNK, TAG } from './city';
import type { Bone } from './rig';
import { point } from './m4';

/** floats a vertex: x y z, nx ny nz, tag, the box's x0 z0 x1 z1, its y0 y1, its seed (the figure: its bone's kind) */
export const VERTEX = 14;
/** the figure's bones by kind, for a look to dress them */
export const BONE_KIND: Record<string, number> = { pelvis: 0, torso: 1, head: 2, upperArm: 3, foreArm: 4, thigh: 5, shin: 6, foot: 7 };
/** what a box keeps for itself: a number in 0..1 from where it stands, the same every time it's built */
const seedOf = (x0: number, z0: number, y1: number) => { let h = Math.imul(Math.round(x0 * 4) | 0, 73856093) ^ Math.imul(Math.round(z0 * 4) | 0, 19349663) ^ Math.imul(Math.round(y1 * 4) | 0, 83492791); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
type Extra = [number, number, number, number, number, number, number];
type V3 = [number, number, number];

/** a quad a b c d as two triangles, its normal turned to face away from `c0` */
function quad(o: Float32Array, at: number, a: V3, b: V3, c: V3, d: V3, tag: number, c0: V3, x: Extra): number {
  let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
  let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  let vs = [a, b, c, a, c, d];
  if (nx * (a[0] - c0[0]) + ny * (a[1] - c0[1]) + nz * (a[2] - c0[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; vs = [a, c, b, a, d, c]; }
  for (const v of vs) { o[at++] = v[0]; o[at++] = v[1]; o[at++] = v[2]; o[at++] = nx; o[at++] = ny; o[at++] = nz; o[at++] = tag; for (let i = 0; i < 7; i++) o[at++] = x[i]; }
  return at;
}

/** A chunk: its ground, and each box's top and sides (and its props', drawn the same). */
export function chunkMesh(c: Chunk): Float32Array {
  const o = new Float32Array(((c.boxes.length + c.props.length) * 5 + 1) * 6 * VERTEX);
  let at = 0;
  const x = c.cx * CHUNK, z = c.cz * CHUNK;
  at = quad(o, at, [x, 0, z], [x + CHUNK, 0, z], [x + CHUNK, 0, z + CHUNK], [x, 0, z + CHUNK], TAG.GROUND, [x, -1, z], [x, z, x + CHUNK, z + CHUNK, 0, 0, seedOf(x, z, 0)]);
  for (const b of [...c.boxes, ...c.props]) {
    const m: V3 = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2], e: Extra = [b.x0, b.z0, b.x1, b.z1, b.y0, b.y1, seedOf(b.x0, b.z0, b.y1)];
    const p = (i: number, j: number, k: number): V3 => [i ? b.x1 : b.x0, j ? b.y1 : b.y0, k ? b.z1 : b.z0];
    at = quad(o, at, p(0, 1, 0), p(1, 1, 0), p(1, 1, 1), p(0, 1, 1), b.tag, m, e);
    at = quad(o, at, p(0, 0, 0), p(1, 0, 0), p(1, 1, 0), p(0, 1, 0), b.tag, m, e);
    at = quad(o, at, p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1), b.tag, m, e);
    at = quad(o, at, p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0), b.tag, m, e);
    at = quad(o, at, p(1, 0, 0), p(1, 0, 1), p(1, 1, 1), p(1, 1, 0), b.tag, m, e);
  }
  return o;
}

/** floats the figure takes: thirteen bones, six faces each; and room for what a character wears (up to twelve blocks);
 * and room for eight such, for the menu's line of characters (each dressed from its own eight of the palette) */
export const FIGURE_BASE = 13 * 6 * 6 * VERTEX, FIGURE = (13 + 12) * 6 * 6 * VERTEX * 8;

/** The figure: each bone's tapered block, through its matrix. */
export function figureMesh(bones: Bone[], o: Float32Array): number {
  let at = 0;
  for (const b of bones) {
    if (at + 36 * VERTEX > o.length) break;
    const p = (i: number, j: number, k: number): V3 => {
      const w = j ? b.w1 : b.w0, d = j ? b.d1 : b.d0;
      return point(b.m, (b.x ?? 0) + (i ? 0.5 : -0.5) * w, j ? b.y1 : b.y0, b.zc + (k ? 0.5 : -0.5) * d);
    };
    // (its seed: what it's made of (character.ts MAT), for a look to dress it from the character's palette)
    const m = point(b.m, b.x ?? 0, (b.y0 + b.y1) / 2, b.zc), e: Extra = [0, 0, 0, 0, 0, 0, b.mat ?? BONE_KIND[b.name.replace(/[LR]$/, '')] ?? 0];
    at = quad(o, at, p(0, 1, 0), p(1, 1, 0), p(1, 1, 1), p(0, 1, 1), TAG.PLAYER, m, e);
    at = quad(o, at, p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1), TAG.PLAYER, m, e);
    at = quad(o, at, p(0, 0, 0), p(1, 0, 0), p(1, 1, 0), p(0, 1, 0), TAG.PLAYER, m, e);
    at = quad(o, at, p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1), TAG.PLAYER, m, e);
    at = quad(o, at, p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0), TAG.PLAYER, m, e);
    at = quad(o, at, p(1, 0, 0), p(1, 0, 1), p(1, 1, 1), p(1, 1, 0), TAG.PLAYER, m, e);
  }
  return at / VERTEX;
}

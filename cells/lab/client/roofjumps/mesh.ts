/**
 * Roof Jumps' triangles: the city's boxes and the figure's bones as flat-shaded faces, and nothing more. Two
 * triangles a face, five faces a box (no undersides), six a bone. Each vertex is its place, its face's normal and its
 * box's tag (VERTEX floats): what a face is, never what colour it is. A look is the renderer's business.
 */
import type { Chunk } from './city';
import { CHUNK, TAG } from './city';
import type { Bone } from './rig';
import { point } from './m4';

/** floats a vertex: x y z, nx ny nz, tag */
export const VERTEX = 7;
type V3 = [number, number, number];

/** a quad a b c d as two triangles, its normal turned to face away from `c0` */
function quad(o: Float32Array, at: number, a: V3, b: V3, c: V3, d: V3, tag: number, c0: V3): number {
  let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
  let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  let vs = [a, b, c, a, c, d];
  if (nx * (a[0] - c0[0]) + ny * (a[1] - c0[1]) + nz * (a[2] - c0[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; vs = [a, c, b, a, d, c]; }
  for (const v of vs) { o[at++] = v[0]; o[at++] = v[1]; o[at++] = v[2]; o[at++] = nx; o[at++] = ny; o[at++] = nz; o[at++] = tag; }
  return at;
}

/** A chunk: its ground, and each box's top and sides (and its props', drawn the same). */
export function chunkMesh(c: Chunk): Float32Array {
  const o = new Float32Array(((c.boxes.length + c.props.length) * 5 + 1) * 6 * VERTEX);
  let at = 0;
  const x = c.cx * CHUNK, z = c.cz * CHUNK;
  at = quad(o, at, [x, 0, z], [x + CHUNK, 0, z], [x + CHUNK, 0, z + CHUNK], [x, 0, z + CHUNK], TAG.GROUND, [x, -1, z]);
  for (const b of [...c.boxes, ...c.props]) {
    const m: V3 = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2];
    const p = (i: number, j: number, k: number): V3 => [i ? b.x1 : b.x0, j ? b.y1 : b.y0, k ? b.z1 : b.z0];
    at = quad(o, at, p(0, 1, 0), p(1, 1, 0), p(1, 1, 1), p(0, 1, 1), b.tag, m);
    at = quad(o, at, p(0, 0, 0), p(1, 0, 0), p(1, 1, 0), p(0, 1, 0), b.tag, m);
    at = quad(o, at, p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1), b.tag, m);
    at = quad(o, at, p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0), b.tag, m);
    at = quad(o, at, p(1, 0, 0), p(1, 0, 1), p(1, 1, 1), p(1, 1, 0), b.tag, m);
  }
  return o;
}

/** floats the figure takes: thirteen bones, six faces each */
export const FIGURE = 13 * 6 * 6 * VERTEX;

/** The figure: each bone's tapered block, through its matrix. */
export function figureMesh(bones: Bone[], o: Float32Array): number {
  let at = 0;
  for (const b of bones) {
    const p = (i: number, j: number, k: number): V3 => {
      const w = j ? b.w1 : b.w0, d = j ? b.d1 : b.d0;
      return point(b.m, (i ? 0.5 : -0.5) * w, j ? b.y1 : b.y0, b.zc + (k ? 0.5 : -0.5) * d);
    };
    const m = point(b.m, 0, (b.y0 + b.y1) / 2, b.zc);
    at = quad(o, at, p(0, 1, 0), p(1, 1, 0), p(1, 1, 1), p(0, 1, 1), TAG.PLAYER, m);
    at = quad(o, at, p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1), TAG.PLAYER, m);
    at = quad(o, at, p(0, 0, 0), p(1, 0, 0), p(1, 1, 0), p(0, 1, 0), TAG.PLAYER, m);
    at = quad(o, at, p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1), TAG.PLAYER, m);
    at = quad(o, at, p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0), TAG.PLAYER, m);
    at = quad(o, at, p(1, 0, 0), p(1, 0, 1), p(1, 1, 1), p(1, 1, 0), TAG.PLAYER, m);
  }
  return at / VERTEX;
}

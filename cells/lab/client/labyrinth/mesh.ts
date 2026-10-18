/**
 * The labyrinth's stone, as triangles: what the model says is there (model.ts), each face with how it's lit (its
 * normal, how shut in it is) and how it rises (when it was built, and the height it grows from).
 *
 * - **Blocks**: a solid voxel's faces where nothing solid's against them; their feet darkened where they meet a floor.
 *   A bridge's piers are blocks too, standing alone.
 * - **Vaults**: an open voxel carrying what's above it has a ceiling. A passage, a barrel vault between the posts either
 *   side; a room, a cross vault on its four corner posts (where its four arches meet, the groins). Each is a surface
 *   y = f(x, z) under a deck; where the open voxel beside it has nothing over it, its arch shows in a face (a spandrel)
 *   from the curve up to the deck. Under a bridge, the same arches, from pier to pier, with the open air beneath.
 * - **Stairs**: steps up a dead end, onto the wall at its end.
 * - **The stone**: the flat slab it's all built on.
 *
 * x and z are centred on the slab; y up, the slab's top at 0.
 */
import { DIRS, EMPTY, H, LEVELS, N, OPEN, PIER, SOLID, isPost, isRoom, type Labyrinth } from './model';

/** floats a vertex: position, normal, ao (1 open .. 0 shut in), material (the level, or the slab: −1 top, −2 side),
 * and its rising: when it was built, the height it grows from, which way (1 up from there; −1 down) */
export const STRIDE = 12;
/** the deck over a vault, and the steps a stair has */
const DECK = 0.16, STEPS = 5, CURVE = 8;
/** the slab's margin round the labyrinth and its thickness */
export const MARGIN = 0.8, SLAB = 0.55;

export interface Mesh { data: Float32Array; count: number; bounds: { top: number } }

type V3 = [number, number, number];
const X = (i: number) => i - N / 2, Z = (j: number) => j - N / 2;

export function buildMesh(m: Labyrinth): Mesh {
  const out: number[] = [];
  let top = 0;
  const vert = (p: V3, n: V3, ao: number, mat: number, born: number, pivot: number, dir: number) => out.push(p[0], p[1], p[2], n[0], n[1], n[2], ao, mat, born, pivot, dir, 0);
  /** a quad a b c d (in order round it), facing n: two triangles, wound to face it */
  const quad = (a: V3, b: V3, c: V3, d: V3, n: V3, ao: [number, number, number, number], mat: number, born: number, pivot: number, dir = 1) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const P = flip ? [a, d, c, b] : [a, b, c, d], A = flip ? [ao[0], ao[3], ao[2], ao[1]] : ao;
    for (const k of [0, 1, 2, 0, 2, 3]) vert(P[k], n, A[k], mat, born, pivot, dir);
  };
  const solid = (k: number, i: number, j: number) => m.solid(k, i, j);
  /** what's walkable at the foot of a face at level k, beside column (i, j): a floor there (stone, a block's top, a deck) */
  const floorAt = (k: number, i: number, j: number) => (k === 0 ? i >= -1 && j >= -1 && i <= N && j <= N : solid(k - 1, i, j) || m.ceiled(k - 1, i, j));
  /** a top face's corners shut in by blocks on the level over it (as voxel games do it) */
  const cornerAo = (k: number, i: number, j: number): [number, number, number, number] => {
    const s = (a: number, b: number) => (solid(k, i + a, j + b) ? 1 : 0);
    const c = (a: number, b: number) => { const s1 = s(a, 0), s2 = s(0, b), d = s(a, b); return s1 && s2 ? 0 : 3 - s1 - s2 - d; };
    return [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)].map((v) => 0.58 + v * 0.14) as [number, number, number, number];
  };

  // ─── the stone ───
  {
    const e = N / 2 + MARGIN, born = -1e3;
    for (let j = -1; j <= N; j++) for (let i = -1; i <= N; i++) {
      if (solid(0, i, j)) continue;
      const x0 = i < 0 ? -e : X(i), x1 = i >= N ? e : X(i + 1), z0 = j < 0 ? -e : Z(j), z1 = j >= N ? e : Z(j + 1);
      quad([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [0, 1, 0], cornerAo(0, i, j), -1, born, 0);
    }
    for (let d = 0; d < 4; d++) {
      const [a, b] = DIRS[d], n: V3 = [a, 0, b];
      const c0: V3 = a ? [a * e, 0, -e] : [-e, 0, b * e], c1: V3 = a ? [a * e, 0, e] : [e, 0, b * e];
      quad(c0, c1, [c1[0], -SLAB, c1[2]], [c0[0], -SLAB, c0[2]], n, [1, 1, 0.75, 0.75], -2, born, 0);
      // (its plinth, set in under it)
      const f = e - 0.35, p0: V3 = a ? [a * f, -SLAB, -f] : [-f, -SLAB, b * f], p1: V3 = a ? [a * f, -SLAB, f] : [f, -SLAB, b * f];
      quad(p0, p1, [p1[0], -SLAB - 0.5, p1[2]], [p0[0], -SLAB - 0.5, p0[2]], n, [0.5, 0.5, 0.3, 0.3], -3, born, 0);
    }
  }

  for (let k = 0; k < LEVELS; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = m.kind(k, i, j), bridge = c === EMPTY && m.arched(k, i, j);
    if (c === EMPTY && !bridge) continue;
    const x0 = X(i), x1 = x0 + 1, z0 = Z(j), z1 = z0 + 1, y0 = k * H, y1 = y0 + H, born = m.born(k, i, j);
    top = Math.max(top, y1);
    if (c === SOLID || c === PIER) {
      // (its sides, where they're not against stone)
      for (let d = 0; d < 4; d++) {
        const [a, b] = DIRS[d], ni = i + a, nj = j + b;
        if (solid(k, ni, nj)) continue;
        const foot = floorAt(k, ni, nj) ? 0.6 : 1;
        const p = a ? (a > 0 ? x1 : x0) : 0, q = b ? (b > 0 ? z1 : z0) : 0;
        const A: V3 = a ? [p, y0, z0] : [x0, y0, q], B: V3 = a ? [p, y0, z1] : [x1, y0, q];
        quad(A, B, [B[0], y1, B[2]], [A[0], y1, A[2]], [a, 0, b], [foot, foot, 1, 1], k, born, y0);
      }
      if (!solid(k + 1, i, j)) quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], cornerAo(k + 1, i, j), k, born, y0);
      continue;
    }
    // (open: a vault, if it carries what's above)
    if ((c === OPEN && m.vaulted(k, i, j)) || bridge) {
      const vb = m.born(k + 1, i, j), crown = y1 - DECK, r = 0.5, ys = crown - r;
      // (a passage's arch spans it from post to post: across x if its posts are either side in x. Under a bridge, from
      // the bridge's own posts (its piers): the level above's)
      const lv = bridge ? k + 1 : k, room = isRoom(lv, i, j), acrossX = !room && isPost(lv, i + 1, j);
      const arch = (t: number) => Math.sqrt(Math.max(0, r * r - t * t));
      const f = (dx: number, dz: number) => ys + (room ? Math.max(arch(dx), arch(dz)) : acrossX ? arch(dx) : arch(dz));
      const g = (dx: number, dz: number): V3 => {
        const e = 0.001, fx = (f(Math.min(r - e, dx + e), dz) - f(Math.max(-r + e, dx - e), dz)) / (2 * e), fz = (f(dx, Math.min(r - e, dz + e)) - f(dx, Math.max(-r + e, dz - e))) / (2 * e);
        const l = Math.hypot(fx, 1, fz); return [fx / l, -1 / l, fz / l];
      };
      const aoAt = (y: number) => 0.5 + 0.5 * Math.pow(Math.max(0, (y - ys) / r), 0.7);
      for (let b = 0; b < CURVE; b++) for (let a = 0; a < CURVE; a++) {
        const P = (u: number, v: number): V3 => { const dx = -r + (u / CURVE), dz = -r + (v / CURVE); return [x0 + 0.5 + dx, f(dx, dz), z0 + 0.5 + dz]; };
        const pts = [P(a, b), P(a + 1, b), P(a + 1, b + 1), P(a, b + 1)], mid = g(-r + (a + 0.5) / CURVE, -r + (b + 0.5) / CURVE);
        quad(pts[0], pts[1], pts[2], pts[3], mid, pts.map((p) => aoAt(p[1])) as [number, number, number, number], k, vb, y1);
      }
      // (its arch in a face, where it opens on the sky)
      for (let d = 0; d < 4; d++) {
        const [a, b] = DIRS[d], ni = i + a, nj = j + b;
        if (solid(k, ni, nj) || m.ceiled(k, ni, nj)) continue;
        for (let s = 0; s < CURVE; s++) {
          const t0 = -r + s / CURVE, t1 = -r + (s + 1) / CURVE;
          const at = (t: number): V3 => (a ? [x0 + 0.5 + a * r, 0, z0 + 0.5 + t] : [x0 + 0.5 + t, 0, z0 + 0.5 + b * r]);
          const y = (t: number) => (a ? f(a * r, t) : f(t, b * r));
          const p0 = at(t0), p1 = at(t1);
          quad([p0[0], y(t0), p0[2]], [p1[0], y(t1), p1[2]], [p1[0], y1, p1[2]], [p0[0], y1, p0[2]], [a, 0, b], [aoAt(y(t0)), aoAt(y(t1)), 1, 1], k, vb, y1);
        }
      }
      // (and its deck's top: the floor of what's above)
      if (!solid(k + 1, i, j)) quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], cornerAo(k + 1, i, j), k, vb, y1);
      continue;
    }
    // (a stair: steps from its open end up to the wall at the other)
    const sd = m.stair(k, i, j);
    if (sd >= 0) {
      const [a, b] = DIRS[sd];
      for (let s = 0; s < STEPS; s++) {
        const u0 = s / STEPS, u1 = (s + 1) / STEPS, h = y0 + ((s + 1) / STEPS) * H;
        // (u runs from the foot (the opening) to the wall it climbs onto)
        const pt = (u: number, w: number, y: number): V3 => {
          const cx = x0 + 0.5, cz = z0 + 0.5, along = -0.5 + u, across = -0.5 + w;
          return a ? [cx + a * along, y, cz + across] : [cx + across, y, cz + b * along];
        };
        quad(pt(u0, 0, h), pt(u1, 0, h), pt(u1, 1, h), pt(u0, 1, h), [0, 1, 0], [0.85, 0.95, 0.95, 0.85], k, born, y0);
        quad(pt(u0, 0, h - H / STEPS), pt(u0, 1, h - H / STEPS), pt(u0, 1, h), pt(u0, 0, h), [-a, 0, -b], [0.7, 0.7, 0.9, 0.9], k, born, y0);
      }
    }
  }
  return { data: new Float32Array(out), count: out.length / STRIDE, bounds: { top } };
}

/**
 * Whether a point's in stone (for finding what a ray touches): the slab, a block, a vault's deck, a step.
 */
export function inStone(m: Labyrinth, x: number, y: number, z: number): boolean {
  const e = N / 2 + MARGIN;
  if (y < 0) return y > -SLAB && Math.abs(x) < e && Math.abs(z) < e;
  const i = Math.floor(x + N / 2), j = Math.floor(z + N / 2), k = Math.floor(y / H);
  if (m.solid(k, i, j)) return true;
  const fy = y - k * H;
  if (m.ceiled(k, i, j)) {
    const dx = x + N / 2 - i - 0.5, dz = z + N / 2 - j - 0.5, r = 0.5, arch = (t: number) => Math.sqrt(Math.max(0, r * r - t * t));
    const lv = m.arched(k, i, j) ? k + 1 : k, room = isRoom(lv, i, j), acrossX = !room && isPost(lv, i + 1, j);
    const ceil = H - DECK - r + (room ? Math.max(arch(dx), arch(dz)) : acrossX ? arch(dx) : arch(dz));
    if (fy > ceil) return true;
  }
  const sd = m.kind(k, i, j) === OPEN ? m.stair(k, i, j) : -1;
  if (sd >= 0) {
    const [a, b] = DIRS[sd], u = 0.5 + (a ? a * (x + N / 2 - i - 0.5) : b * (z + N / 2 - j - 0.5));
    if (fy < Math.ceil(Math.max(0.001, u) * STEPS) / STEPS * H) return true;
  }
  return false;
}

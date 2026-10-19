/**
 * Form: the shape the stone takes inside each cell, worked out from what's round it, so blocks that meet join as
 * architecture rather than sitting side by side as cubes. The cells stay what's built, selected and walked (model.ts);
 * this is how each is drawn (mesh.ts) and struck by a touch (`inStone`), both from the same outline, so they can't drift.
 *
 * - **Mass**: a block that's part of something two or more deep (or of a building, or a pillar on its own) fills its
 *   cell, its outside corners rounded where open air meets on both sides.
 * - **Wall**: a block in a run a cell thick (its neighbours at its level are only blocks, thin walls, or a gate through
 *   the run, and what's on it is wall too) is a wall's thickness, not a cell's. Where the run goes straight on, just that; where it turns, meets
 *   another, or ends, a post a little wider, capped. On the stone, a long straight run has a buttress every third cell
 *   either side.
 *
 * An outline is a loop round the cell's shape (x, z from its middle), each edge with the way it faces (a DIRS index, or
 * −1 on a curve), how far out it lies, and whether it's open (drawn) or runs on into the stone beside it.
 */
import { DIRS, key, type World } from './model';
import { buildings } from './buildings';

/** a wall's half-thickness, a post's, how round an outside corner is, and a buttress (how far out from the wall, half
 * its width, how high before its slope) */
export const WT = 0.34, POST = 0.4, ROUND = 0.1, BUT = 0.12, BUTW = 0.09, BUTH = 0.6;

export interface Edge { a: [number, number]; b: [number, number]; face: number; dist: number; open: boolean }
export interface Outline { edges: Edge[]; wall: boolean; straight: boolean; arms: boolean[]; post: number }

const cache = new WeakMap<World, { v: number; wall: Map<number, boolean>; out: Map<number, Outline> }>();
const store = (w: World) => { let c = cache.get(w); if (!c || c.v !== w.version) { c = { v: w.version, wall: new Map(), out: new Map() }; cache.set(w, c); } return c; };

/** a block in a run a cell thick: drawn as a wall's thickness */
export function wallCell(w: World, k: number, i: number, j: number): boolean {
  if (!w.block(k, i, j)) return false;
  const c = store(w), v = key(k, i, j);
  if (c.wall.has(v)) return c.wall.get(v)!;
  c.wall.set(v, false);
  let r = !buildings(w).of.has(v);
  // (part of something two deep: mass)
  if (r) for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) if (w.block(k, i + a, j) && w.block(k, i, j + b) && w.block(k, i + a, j + b)) r = false;
  let n = 0;
  if (r) for (let d = 0; d < 4; d++) {
    const [a, b] = DIRS[d];
    if (w.block(k, i + a, j + b) || w.wall(k, i + a, j + b) >= 0) { n++; continue; }
    // (a gate in the run, its way through across the wall: the wall runs on to it, and it stands a little proud)
    if (w.archway(k, i + a, j + b) >= 0 && w.archway(k, i + a, j + b) !== d % 2 && !w.span(k, i + a, j + b)) { n++; continue; }
    // (beside a span, a stair, an arch the other way: it stands full, to meet them)
    if (w.stone(k, i + a, j + b) || w.stair(k, i + a, j + b) >= 0) r = false;
  }
  // (a pillar on its own stays whole; and what's on a wall is wall too)
  if (r && n === 0) r = false;
  if (r && (w.stone(k + 1, i, j) || w.stair(k + 1, i, j) >= 0) && !wallCell(w, k + 1, i, j)) r = false;
  c.wall.set(v, r);
  return r;
}

/** whether the stone beside a block, the way d, covers that whole side (so there's no face there) */
export function covered(w: World, k: number, i: number, j: number, d: number) {
  const x = i + DIRS[d][0], z = j + DIRS[d][1];
  if (w.block(k, x, z)) return !wallCell(w, k, x, z);
  const aw = w.archway(k, x, z);
  if (aw >= 0) return aw !== d % 2;
  const s = w.stair(k, x, z);
  return s >= 0 && (s + 2) % 4 === d;
}

/** the outline of a block's shape in its cell */
export function outline(w: World, k: number, i: number, j: number): Outline {
  const c = store(w), v = key(k, i, j), had = c.out.get(v);
  if (had) return had;
  const edges: Edge[] = [];
  const add = (a: [number, number], b: [number, number], open: boolean) => {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) return;
    // (the way it faces: out, to its right as the loop goes round)
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz), nx = dz / l, nz = -dx / l;
    const face = DIRS.findIndex(([p, q]) => Math.abs(p - nx) < 1e-6 && Math.abs(q - nz) < 1e-6);
    edges.push({ a, b, face, dist: a[0] * nx + a[1] * nz, open });
  };
  const N = (d: number): [number, number] => [DIRS[d][0], DIRS[d][1]];
  const at = (d: number, s: number, r: number): [number, number] => { const [a, b] = N(d), [ta, tb] = N((d + 1) % 4); return [a * r + ta * s, b * r + tb * s]; };
  let o: Outline;
  if (wallCell(w, k, i, j)) {
    const arms = DIRS.map(([a, b]) => w.stone(k, i + a, j + b) || w.stair(k, i + a, j + b) >= 0);
    const straight = (arms[0] && arms[2] && !arms[1] && !arms[3]) || (arms[1] && arms[3] && !arms[0] && !arms[2]);
    const h = straight ? WT : POST;
    for (let d = 0; d < 4; d++) {
      if (!arms[d]) { add(at(d, -h, h), at(d, h, h), true); continue; }
      add(at(d, -h, h), at(d, -WT, h), true);
      add(at(d, -WT, h), at(d, -WT, 0.5), true);
      add(at(d, -WT, 0.5), at(d, WT, 0.5), false);
      add(at(d, WT, 0.5), at(d, WT, h), true);
      add(at(d, WT, h), at(d, h, h), true);
    }
    o = { edges, wall: true, straight, arms, post: h };
  } else {
    // (a mass: its whole cell, an outside corner rounded where open air meets on both sides)
    const open = [0, 1, 2, 3].map((d) => !covered(w, k, i, j, d));
    const air = (d: number) => !w.stone(k, i + DIRS[d][0], j + DIRS[d][1]) && w.stair(k, i + DIRS[d][0], j + DIRS[d][1]) < 0;
    const round = [0, 1, 2, 3].map((d) => air(d) && air((d + 1) % 4));
    for (let d = 0; d < 4; d++) {
      const prev = (d + 3) % 4, s0 = round[prev] ? -0.5 + ROUND : -0.5, s1 = round[d] ? 0.5 - ROUND : 0.5;
      add(at(d, s0, 0.5), at(d, s1, 0.5), open[d]);
      if (round[d]) {
        // (round the corner to the next side, a quarter at a time)
        const [a, b] = N(d), [ta, tb] = N((d + 1) % 4), cx = (a + ta) * (0.5 - ROUND), cz = (b + tb) * (0.5 - ROUND), S = 4;
        for (let q = 0; q < S; q++) {
          const t0 = (q / S) * (Math.PI / 2), t1 = ((q + 1) / S) * (Math.PI / 2);
          const p = (t: number): [number, number] => [cx + ROUND * (a * Math.cos(t) + ta * Math.sin(t)), cz + ROUND * (b * Math.cos(t) + tb * Math.sin(t))];
          add(p(t0), p(t1), true);
        }
      }
    }
    o = { edges, wall: false, straight: false, arms: [false, false, false, false], post: 0.5 };
  }
  c.out.set(v, o);
  return o;
}

/** whether a straight run of wall has a buttress here (every third cell along it, on the stone), and on which sides */
export function buttresses(w: World, k: number, i: number, j: number): number[] {
  if (k !== 0 || !wallCell(w, k, i, j)) return [];
  const o = outline(w, k, i, j);
  if (!o.straight) return [];
  const along = o.arms[0] ? i : j;
  if (((along % 3) + 3) % 3 !== 0) return [];
  return [0, 1, 2, 3].filter((d) => !o.arms[d] && !w.stone(0, i + DIRS[d][0], j + DIRS[d][1]) && w.stair(0, i + DIRS[d][0], j + DIRS[d][1]) < 0);
}

/** whether a point of a block's cell (x, z from its middle, y up from its floor) is in its stone */
export function inBlock(w: World, k: number, i: number, j: number, x: number, z: number, y: number): boolean {
  const o = outline(w, k, i, j);
  // (inside the loop: crossings of a ray out along +x)
  let inside = false;
  for (const e of o.edges) {
    const [ax, az] = e.a, [bx, bz] = e.b;
    if ((az > z) !== (bz > z) && x < ax + ((z - az) * (bx - ax)) / (bz - az)) inside = !inside;
  }
  if (inside) return true;
  for (const d of buttresses(w, k, i, j)) {
    const [a, b] = DIRS[d], across = x * a + z * b, along = Math.abs(x * b - z * a);
    if (along < BUTW && across >= WT && across <= WT + BUT && y < BUTH + ((WT + BUT - across) / BUT) * 0.25) return true;
  }
  return false;
}

/** how far out from a block's middle its face the way d lies (a wall's is nearer) */
export function reach(w: World, k: number, i: number, j: number, d: number): number {
  if (!wallCell(w, k, i, j)) return 0.5;
  const o = outline(w, k, i, j);
  return o.arms[d] ? 0.5 : o.post;
}

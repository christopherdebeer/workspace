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
 * - **A stair tower** (`RULE.tower`): its open corners cut back on the diagonal, an octagonal turret.
 * - **Flowing walls**: a wall that turns once sweeps round a quarter circle from one side of its cell to the other,
 *   rather than meeting at a post; a run of turns one after another (a stair-step, as a diagonal stroke lays it) is
 *   one straight diagonal wall, each cell of it a band from one side's middle to the next. Either meets a straight wall
 *   beside it at exactly its thickness, so the run flows on without a seam.
 *
 * An outline is a loop round the cell's shape (x, z from its middle), each edge with the way it faces (a DIRS index, or
 * −1 on a curve), how far out it lies, and whether it's open (drawn) or runs on into the stone beside it.
 */
import { DIRS, isTower, key, type World } from './model';
import { buildings } from './buildings';

/** a wall's half-thickness, a post's, how round an outside corner is, and a buttress (how far out from the wall, half
 * its width, how high before its slope) */
export const WT = 0.34, POST = 0.4, ROUND = 0.1, BUT = 0.12, BUTW = 0.09, BUTH = 0.6;
/** how far back a stair tower's corners are cut */
export const TURRET = 0.2;

export interface Edge { a: [number, number]; b: [number, number]; face: number; dist: number; open: boolean }
export interface Outline {
  edges: Edge[]; wall: boolean; straight: boolean; arms: boolean[]; post: number;
  /** a flowing wall: round a curve, or on the diagonal; and its top as a strip, pairs of its corners across it */
  flow?: 'curve' | 'diagonal'; pairs?: Array<[number, number]>;
}

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
  const turn = turnOf(w, k, i, j);
  if (turn) {
    // (a flowing wall: its loop worked out as points, each edge open or not, turned the way the others go round)
    const [d1, d2] = turn, P: Array<[number, number]> = [], O: boolean[] = [];
    const n1 = N(d1), n2 = N(d2), C: [number, number] = [(n1[0] + n2[0]) / 2, (n1[1] + n2[1]) / 2];
    const diagonal = staircase(w, k, i, j, turn);
    if (diagonal) {
      // (a band from the middle of one side to the next, as thick across each side as a straight wall)
      P.push([n1[0] / 2 + n2[0] * WT, n1[1] / 2 + n2[1] * WT], [n2[0] / 2 + n1[0] * WT, n2[1] / 2 + n1[1] * WT], [n2[0] / 2 - n1[0] * WT, n2[1] / 2 - n1[1] * WT], [n1[0] / 2 - n2[0] * WT, n1[1] / 2 - n2[1] * WT]);
      O.push(true, false, true, false);
    } else {
      // (a quarter circle round the corner between its arms, from the middle of one side to the middle of the other)
      const S = 8, at2 = (t: number, r: number): [number, number] => { const a = (t * Math.PI) / 2, c = Math.cos(a), sn = Math.sin(a); return [C[0] - r * (c * n2[0] + sn * n1[0]), C[1] - r * (c * n2[1] + sn * n1[1])]; };
      for (let q = 0; q <= S; q++) { P.push(at2(q / S, 0.5 + WT)); O.push(q < S); }
      O[S] = false;
      for (let q = S; q >= 0; q--) { P.push(at2(q / S, 0.5 - WT)); O.push(q > 0); }
      O[2 * S + 1] = false;
    }
    const n = P.length;
    let area = 0;
    for (let q = 0; q < n; q++) area += P[q][0] * P[(q + 1) % n][1] - P[(q + 1) % n][0] * P[q][1];
    const flip = area < 0, Pts = flip ? [...P].reverse() : P, Op = flip ? Pts.map((_, q) => O[(2 * n - 2 - q) % n]) : O;
    Pts.forEach((p, q) => add(p, Pts[(q + 1) % n], Op[q]));
    const at = (q: number) => (flip ? n - 1 - q : q);
    const pairs: Array<[number, number]> = diagonal ? [[at(0), at(3)], [at(1), at(2)]] : Array.from({ length: n / 2 }, (_, q) => [at(q), at(n - 1 - q)] as [number, number]);
    const arms = DIRS.map(([a, b]) => w.stone(k, i + a, j + b) || w.stair(k, i + a, j + b) >= 0);
    o = { edges, wall: true, straight: false, arms, post: WT, flow: diagonal ? 'diagonal' : 'curve', pairs };
  } else if (wallCell(w, k, i, j)) {
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
    // (a stair tower: its open corners cut back on the diagonal, an octagonal turret)
    const turret = isTower(w.rules.get(key(0, i, j))), RC = turret ? TURRET : ROUND;
    for (let d = 0; d < 4; d++) {
      const prev = (d + 3) % 4, s0 = round[prev] ? -0.5 + RC : -0.5, s1 = round[d] ? 0.5 - RC : 0.5;
      add(at(d, s0, 0.5), at(d, s1, 0.5), open[d]);
      if (round[d] && turret) add(at(d, s1, 0.5), at((d + 1) % 4, -0.5 + RC, 0.5), true);
      else if (round[d]) {
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

/** a wall that turns once in its cell (two arms, at right angles): the two ways, or null */
export function turnOf(w: World, k: number, i: number, j: number): [number, number] | null {
  if (!wallCell(w, k, i, j)) return null;
  const arms = [0, 1, 2, 3].filter((d) => w.stone(k, i + DIRS[d][0], j + DIRS[d][1]) || w.stair(k, i + DIRS[d][0], j + DIRS[d][1]) >= 0);
  return arms.length === 2 && arms[1] - arms[0] !== 2 ? [arms[0], arms[1]] : null;
}
/** whether a turn is one of a run of turns, each the other way about (a stair-step: a diagonal) */
function staircase(w: World, k: number, i: number, j: number, [d1, d2]: [number, number]): boolean {
  for (const [d, e] of [[d1, d2], [d2, d1]]) {
    const t = turnOf(w, k, i + DIRS[d][0], j + DIRS[d][1]);
    if (t && t.includes((d + 2) % 4) && t.includes((e + 2) % 4)) return true;
  }
  return false;
}

/** whether a straight run of wall has a buttress here (every third cell along it, on the stone), and on which sides */
export function buttresses(w: World, k: number, i: number, j: number): number[] {
  if (k !== w.ground(i, j) || !wallCell(w, k, i, j)) return [];
  const o = outline(w, k, i, j);
  if (!o.straight) return [];
  const along = o.arms[0] ? i : j;
  if (((along % 3) + 3) % 3 !== 0) return [];
  return [0, 1, 2, 3].filter((d) => !o.arms[d] && !w.occupied(k, i + DIRS[d][0], j + DIRS[d][1]) && w.ground(i + DIRS[d][0], j + DIRS[d][1]) === k);
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

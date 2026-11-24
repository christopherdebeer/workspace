/**
 * Roof Jumps' reachability: which roofs a runner can get to from which, under the dials as they stand, and what the city does
 * about the ones it can't get off. Wherever the street is a fall (`streetFail`), a roof with no way on is a trap: the city
 * bridges it to a neighbour it can reach, and places its checkpoints (things to collect, each a place to come back to) only
 * on roofs with ways on.
 *
 * The envelope is the leap's own sums (runner.ts `leap`), conservatively: how far across a gap the fastest leap carries for a
 * given rise or drop, how high a spring and a catch can get up. It doesn't count holds (a fire escape, a pipe, a ladder), so a
 * roof it calls a dead end may still have a way up a face: it errs toward bridging.
 */
import { STOREY, TAG } from './city';
import type { Box } from './city';
import { TUNE } from './tune';

/** the street: below this, a fall */
export const STREET = 0.5;
/** how far up a spring and a hand on the lip get (m): the `rise` dial and about a metre of reach */
export const upReach = () => TUNE.rise + 1.0;

/** how far across (m) a leap clears to land `dh` higher (negative: lower), at most; 0 if it can't get up there */
export function maxGap(dh: number): number {
  if (dh > upReach()) return 0;
  const G = TUNE.gravity, v = Math.min(TUNE.leapSpeed, Math.max(TUNE.sprint, TUNE.dash * 0.9));
  const apex = Math.max(0, dh) + 0.6 + TUNE.hang, T = Math.sqrt((2 * apex) / G) + Math.sqrt((2 * Math.max(0, apex - dh)) / G);
  // (four fifths of it: a leap is rarely taken at its fastest and best, and it has to land with room)
  return Math.min(v * T, TUNE.jumpReach + TUNE.sprint) * 0.8;
}

/** a roof: a box something can stand on above the street */
// (made when first asked: city.ts and this import each other)
let ROOF: Set<number> | null = null;
export const isRoof = (b: Box) => (ROOF ??= new Set<number>([TAG.BUILDING, TAG.BEAM, TAG.SLAB, TAG.HUT, TAG.MANSARD])).has(b.tag) && b.y1 >= STOREY && !b.fixture;

/** the gap between two roofs' footprints across one axis, with how much of the other axis they share; diagonal: none */
function gapOf(a: Box, b: Box): { g: number; share: number; axis: 0 | 1 } | null {
  const gx = Math.max(0, b.x0 - a.x1, a.x0 - b.x1), gz = Math.max(0, b.z0 - a.z1, a.z0 - b.z1);
  if (gx > 0 && gz > 0) return null;
  if (gx > 0) return { g: gx, share: Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0), axis: 0 };
  if (gz > 0) return { g: gz, share: Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), axis: 1 };
  // (touching or overlapping: stepped, climbed or dropped onto)
  return { g: 0, share: 1, axis: 0 };
}

/** whether a runner on `a` can get onto `b`: across the gap, up to it (a spring and a catch) or down onto it */
export function canReach(a: Box, b: Box): boolean {
  const o = gapOf(a, b); if (!o || o.share < 1) return false;
  const dh = b.y1 - a.y1;
  if (o.g === 0) return dh <= upReach();
  return o.g <= maxGap(dh);
}

/** the roofs of a set of boxes, each with the others it can reach */
export function roofGraph(boxes: Box[]): { roofs: Box[]; out: number[][] } {
  const roofs = boxes.filter(isRoof), out = roofs.map(() => [] as number[]);
  for (let i = 0; i < roofs.length; i++) for (let j = 0; j < roofs.length; j++) if (i !== j && canReach(roofs[i], roofs[j])) out[i].push(j);
  return { roofs, out };
}

/** the roofs with no way on to another roof (the street the only way off) */
export function deadEnds(boxes: Box[]): Box[] {
  const { roofs, out } = roofGraph(boxes);
  return roofs.filter((r, i) => out[i].length === 0 && r.tag !== TAG.SLAB);
}

/**
 * A dead end's bridge: a metre-and-a-bit-wide slab at its own height across the narrowest gap to a neighbour it could then get
 * onto (level, lower, or within a spring up), where nothing else stands in the way. Returns the slabs added.
 */
export function bridgeDeadEnds(boxes: Box[]): Box[] {
  const added: Box[] = [];
  for (const a of deadEnds(boxes)) {
    let best: { b: Box; g: number; axis: 0 | 1 } | null = null;
    for (const b of boxes) {
      if (b === a || !isRoof(b) || b.tag === TAG.SLAB) continue;
      const o = gapOf(a, b); if (!o || o.g === 0 || o.g > 10 || o.share < 1.6) continue;
      if (b.y1 - a.y1 > TUNE.rise) continue;
      if (!best || o.g < best.g) best = { b, g: o.g, axis: o.axis };
    }
    if (!best) continue;
    const b = best.b, H = a.y1;
    let s: Box;
    if (best.axis === 0) {
      const lo = Math.max(a.z0, b.z0), hi = Math.min(a.z1, b.z1), m = Math.round((lo + hi) / 2) - 1, east = b.x0 >= a.x1;
      s = { x0: east ? a.x1 : b.x1, x1: east ? b.x0 : a.x0, z0: m, z1: m + 2, y0: H - 1, y1: H, tag: TAG.SLAB };
    } else {
      const lo = Math.max(a.x0, b.x0), hi = Math.min(a.x1, b.x1), m = Math.round((lo + hi) / 2) - 1, north = b.z0 >= a.z1;
      s = { x0: m, x1: m + 2, z0: north ? a.z1 : b.z1, z1: north ? b.z0 : a.z0, y0: H - 1, y1: H, tag: TAG.SLAB };
    }
    // (the alley under it and over it clear: nothing standing where it goes)
    if ([...boxes, ...added].some((o) => o !== a && o !== b && o.x0 < s.x1 && o.x1 > s.x0 && o.z0 < s.z1 && o.z1 > s.z0 && o.y1 > H - 3)) continue;
    added.push(s);
  }
  boxes.push(...added);
  return added;
}

/** a checkpoint to collect: where it stands */
export interface Item { id: string; x: number; y: number; z: number }

/**
 * A chunk's checkpoints: on up to `n` of its roofs that have two or more ways on and room to stand, each in a clear spot on
 * the roof (nothing taller within a metre and a half of it), by the chunk's own dice (`rand`).
 */
export function placeItems(boxes: Box[], cx: number, cz: number, rand: () => number, n = 3): Item[] {
  const { roofs, out } = roofGraph(boxes), items: Item[] = [];
  const top = (x: number, z: number) => { let h = 0; for (const o of boxes) if (x >= o.x0 && x < o.x1 && z >= o.z0 && z < o.z1) h = Math.max(h, o.y1); return h; };
  const ok = roofs.map((r, i) => ({ r, i })).filter(({ r, i }) => out[i].length >= 2 && r.tag !== TAG.SLAB && r.tag !== TAG.BEAM && (r.x1 - r.x0) * (r.z1 - r.z0) >= 30);
  for (let k = 0; k < n && ok.length; k++) {
    const { r } = ok.splice(Math.floor(rand() * ok.length), 1)[0];
    for (let tries = 0; tries < 6; tries++) {
      const x = r.x0 + 1.5 + rand() * Math.max(0, r.x1 - r.x0 - 3), z = r.z0 + 1.5 + rand() * Math.max(0, r.z1 - r.z0 - 3);
      if ([[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].every(([a, b]) => top(x + a, z + b) === r.y1)) { items.push({ id: `${cx},${cz},${k}`, x, y: r.y1, z }); break; }
    }
  }
  return items;
}

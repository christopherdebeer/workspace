/**
 * Where a cat can be: a second way of reading what's built, beside the walk (nav.ts), worked out from the same resolved
 * world and checked against the stone as it's drawn (`inStone`), so a cat goes where the picture says it can.
 *
 * - **Places** (`Spot`): every place a figure could stand (a floor, a stair, a way through an arch), and more a cat
 *   finds: the top of a thin wall (a coping, narrow: one cat at a time), the edge of a top over a drop (a ledge, looking
 *   out), the top of a parapet (narrow, high).
 * - **Ways between them** (`Link`): the walk's own (along floors, up stairs, through arches; inside a building, from one
 *   of its doors to another, unseen), along a coping only the way its wall runs, up and down a bank of the land, and a
 *   cat's own: a **hop** up onto a top a level higher (or onto a parapet), down from one (two levels at most), and a
 *   **leap** across a gap a cell wide (a slot, the stream), each only where the air it would pass through is clear.
 * - **What each place is like**: in the sun or not (a ray toward it through the stone), sheltered (stone round it and
 *   over it), how high over the ground, looking out over a drop, by water, in a court. A cat chooses where to rest by
 *   these, as it's inclined (cats.ts).
 * - **How many cats it's home for** (`capacity`): from how much habitable place there is (raised terraces, ledges, copings,
 *   sheltered corners, courts), not how much stone: a solid tower is home to fewer than the same stone in terraces.
 *
 * Positions are in the room (x, z centred as the mesh has them; y up, a level 1 high).
 */
import { CENTER, DIRS, key, unkey, type Cell, type World } from './model';
import { navigate } from './nav';
import { buildings } from './buildings';
import { inStone, parapets, wallArms } from './mesh';
import { reach } from './form';
import { surfaceY } from './land';
import { SUN } from './render';

export type SpotKind = 'floor' | 'stair' | 'arch' | 'coping' | 'ledge' | 'rail';
export interface Link {
  to: number; kind: 'walk' | 'hop' | 'leap' | 'inside'; cost: number;
  /** a hop or a leap: where it springs from (on the place it leaves) and where it lands (on the place it goes to) */
  from?: [number, number, number]; land?: [number, number, number];
}
export interface Spot {
  id: number; kind: SpotKind;
  /** its cell (the level stood at, then the column) */
  k: number; i: number; j: number;
  /** where a cat stands there (the ground under its feet) */
  x: number; y: number; z: number;
  /** which way it faces, if it has a way (a ledge or a parapet looks out; a stair climbs); else −1 */
  d: number;
  /** one cat at a time (a coping, a parapet's top, a ledge) */
  narrow: boolean;
  links: Link[];
  /** in the sun (0..1), sheltered (0..1), how high over the ground (levels), looking out over a drop (0..1), by water,
   * in a court, on the land's own ground */
  sun: number; shelter: number; high: number; out: number; water: boolean; court: boolean; ground: boolean;
  /** somewhere to rest (not a stair or a way through an arch) */
  rest: boolean;
  /** what it's called, the same from one working out to the next while it's there */
  name: string;
}
export interface Perches { spots: Spot[]; byName: Map<string, number>; capacity: number; habitable: number }

const X = (i: number) => i - CENTER + 0.5, Z = (j: number) => j - CENTER + 0.5;

/** how high a cat's feet are on a stair, `u` of the way up its cell (0 its foot's edge, 1 its head's): along the line of
 * its steps' noses, a step up from where it starts, eased on at its foot */
export function stairY(k: number, u: number): number {
  if (u < -0.15) return k;
  if (u < 0) return k + (1 / 6) * (u + 0.15) / 0.15;
  return k + Math.min(1, u + 1 / 6);
}
/** where cats can be in a world, and the ways between */
export function perches(w: World): Perches {
  const spots: Spot[] = [], byName = new Map<string, number>(), atCell = new Map<number, number>();
  const solid = (x: number, y: number, z: number) => inStone(w, x, y, z);
  /** room for a cat: nothing in the way of its body over where it stands */
  const roomy = (x: number, y: number, z: number) => !solid(x, y + 0.07, z) && !solid(x, y + 0.2, z);
  const nav = navigate(w), B = buildings(w), rails = parapets(w);
  const roofTop = new Set<number>();
  for (const b of B.list) if (b.roof) for (const [x, z] of b.cols) roofTop.add(key(b.h, x, z));
  const decor = new Set(w.decor.filter((d) => d.kind !== 'pool').map((d) => d.j * 1000 + d.i));
  const add = (kind: SpotKind, k: number, i: number, j: number, x: number, y: number, z: number, d = -1, narrow = false): Spot | null => {
    const name = `${kind}.${k}.${i}.${j}.${d}`;
    if (byName.has(name)) return spots[byName.get(name)!];
    const s: Spot = { id: spots.length, kind, k, i, j, x, y, z, d, narrow, links: [], sun: 0, shelter: 0, high: 0, out: 0, water: false, court: false, ground: false, rest: kind !== 'stair' && kind !== 'arch', name };
    spots.push(s); byName.set(name, s.id);
    return s;
  };
  const link = (a: Spot, b: Spot, kind: Link['kind'], cost: number, from?: Link['from'], land?: Link['land']) => {
    if (a.links.some((l) => l.to === b.id)) return;
    a.links.push({ to: b.id, kind, cost, from, land });
  };
  const both = (a: Spot, b: Spot, kind: Link['kind'], cost: number) => { link(a, b, kind, cost); link(b, a, kind, cost); };

  // ─── the walk's places ───
  for (const v of nav.places) {
    const [k, i, j] = unkey(v), g = w.ground(i, j), x = X(i), z = Z(j);
    if (w.stair(k, i, j) >= 0) { const s = add('stair', k, i, j, x, stairY(k, 0.5), z, w.stair(k, i, j)); if (s) atCell.set(v, s.id); continue; }
    if (w.archway(k, i, j) >= 0 && !w.span(k, i, j)) { const s = add('arch', k, i, j, x, k, z, w.archway(k, i, j)); if (s) atCell.set(v, s.id); continue; }
    if (roofTop.has(v)) continue;
    if (k === g && decor.has(j * 1000 + i)) continue;
    const y = w.land && k === g ? surfaceY(w.land, i + 0.5, j + 0.5) : k;
    if (k > g && !solid(x, y - 0.04, z)) continue;
    if (!roomy(x, y, z)) continue;
    const coping = k > 0 && w.wall(k - 1, i, j) >= 0;
    const s = add(coping ? 'coping' : 'floor', k, i, j, x, y, z, -1, coping);
    if (s) { s.ground = k === g; atCell.set(v, s.id); }
  }
  const spotAt = (k: number, i: number, j: number) => { const id = atCell.get(key(k, i, j)); return id === undefined ? null : spots[id]; };
  const copingArms = (s: Spot) => wallArms(w, s.k - 1, s.i, s.j);
  for (const [v, ns] of nav.next) {
    const a = atCell.get(v);
    if (a === undefined) continue;
    const A = spots[a];
    for (const u of ns) {
      const b = atCell.get(u);
      if (b === undefined) continue;
      const Bs = spots[b], d = DIRS.findIndex(([p, q]) => p === Bs.i - A.i && q === Bs.j - A.j);
      // (along a coping only the way its wall runs)
      if (A.kind === 'coping' && (d < 0 || !copingArms(A)[d])) continue;
      if (Bs.kind === 'coping' && (d < 0 || !copingArms(Bs)[(d + 2) % 4])) continue;
      link(A, Bs, 'walk', Math.hypot(Bs.x - A.x, Bs.y - A.y, Bs.z - A.z) * (A.narrow || Bs.narrow ? 1.4 : 1));
    }
  }
  // (inside a building: from one door to another, or up to its top, unseen)
  for (const [p, q] of B.inside) {
    const a = spotAt(...p), b = spotAt(...q);
    if (a && b) both(a, b, 'inside', 2 + Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 1.5);
  }
  // (up and down a bank of the land: ground a level from its neighbour's)
  if (w.land) for (const a of spots) {
    if (!a.ground) continue;
    for (const [p, q] of DIRS) {
      const b = spotAt(w.ground(a.i + p, a.j + q), a.i + p, a.j + q);
      if (b?.ground && Math.abs(b.k - a.k) === 1) link(a, b, 'walk', 1.7);
    }
  }

  // ─── a cat's own places: ledges over a drop, parapets' tops ───
  const floorBelow = (k: number, i: number, j: number) => {
    // (the highest place to stand under level k in a column: its height, or the ground)
    for (let h = k - 1; h > w.ground(i, j); h--) if (spotAt(h, i, j)) return h;
    return w.ground(i, j);
  };
  for (const s of [...spots]) {
    if (s.kind !== 'floor' || s.ground) continue;
    const railed = rails.edges.get(key(s.k - 1, s.i, s.j));
    for (let d = 0; d < 4; d++) {
      const [p, q] = DIRS[d], ni = s.i + p, nj = s.j + q;
      if (spotAt(s.k, ni, nj) || w.occupied(s.k, ni, nj) || w.stair(s.k - 1, ni, nj) >= 0) continue;
      if (s.k - floorBelow(s.k, ni, nj) < 1) continue;
      if (railed?.[d]) {
        // (a parapet's top: narrow, high; a hop up from the top it rings)
        const r = reach(w, s.k - 1, s.i, s.j, d), kind = rails.rails.get(key(s.k - 1, s.i, s.j));
        const x = s.x + p * (r - 0.06), z = s.z + q * (r - 0.06), y = s.k + (kind === 8 ? 0.33 : 0.35);
        if (!roomy(x, y, z)) continue;
        const rail = add('rail', s.k, s.i, s.j, x, y, z, d, true)!;
        rail.out = 1;
        link(s, rail, 'hop', 1.4, [s.x + p * 0.12, s.y, s.z + q * 0.12], [x, y, z]);
        link(rail, s, 'hop', 1.2, [x, y, z], [s.x + p * 0.12, s.y, s.z + q * 0.12]);
        continue;
      }
      const x = s.x + p * 0.32, z = s.z + q * 0.32;
      if (!solid(x, s.y - 0.04, z) || !roomy(x, s.y, z)) continue;
      const ledge = add('ledge', s.k, s.i, s.j, x, s.y, z, d, true)!;
      ledge.out = 1;
      both(s, ledge, 'walk', 0.4);
    }
  }
  // (along a parapet, its top runs on into the next cell's)
  for (const r of spots) {
    if (r.kind !== 'rail') continue;
    for (const t of [(r.d + 1) % 4, (r.d + 3) % 4]) {
      const o = byName.get(`rail.${r.k}.${r.i + DIRS[t][0]}.${r.j + DIRS[t][1]}.${r.d}`);
      if (o !== undefined && Math.abs(spots[o].y - r.y) < 0.05) link(r, spots[o], 'walk', 1.3);
    }
  }

  // ─── a cat's own ways: hops up and down, leaps across ───
  /** the air a jump passes through, clear: an arc from where it springs to where it lands, over what it clears */
  const clearArc = (a: [number, number, number], b: [number, number, number], h: number) => {
    for (let n = 1; n < 8; n++) {
      const t = n / 8, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t, y = a[1] + (b[1] - a[1]) * t + h * 4 * t * (1 - t);
      if (solid(x, y + 0.06, z) || solid(x, y + 0.2, z)) return false;
    }
    return true;
  };
  const jumpers = spots.filter((s) => s.kind === 'floor' || s.kind === 'coping');
  const inColumn = new Map<number, Spot[]>();
  for (const s of jumpers) { const c = s.j * 1000 + s.i; (inColumn.get(c) ?? inColumn.set(c, []).get(c)!).push(s); }
  for (const a of jumpers) {
    for (let d = 0; d < 4; d++) {
      const [p, q] = DIRS[d];
      const edge = (s: Spot, sgn: number, e: number): [number, number, number] => [s.x + sgn * p * (s.kind === 'floor' ? e : 0), s.y, s.z + sgn * q * (s.kind === 'floor' ? e : 0)];
      // (a coping's sides are sheer: off it, or onto it, only from its side)
      for (const b of inColumn.get((a.j + q) * 1000 + a.i + p) ?? []) {
        const dy = b.y - a.y;
        if (a.links.some((l) => l.to === b.id)) continue;
        if (!(dy > 0.3 && dy <= 1.1) && !(dy < -0.3 && dy >= -2.1)) continue;
        const from = edge(a, 1, 0.3), land = edge(b, -1, 0.28);
        if (!clearArc(from, land, dy > 0 ? dy / 2 + 0.18 : 0.15)) continue;
        link(a, b, 'hop', dy > 0 ? 1.4 + dy * 1.6 : 1.1 + -dy * 0.9, from, land);
      }
      // (a leap across a gap a cell wide, level, or near it)
      if (a.kind !== 'floor') continue;
      const mi = a.i + p, mj = a.j + q;
      if ((inColumn.get(mj * 1000 + mi) ?? []).some((s) => s.y > a.y - 0.7 && s.y < a.y + 0.4) || spotAt(Math.round(a.y), mi, mj)) continue;
      for (const b of inColumn.get((a.j + 2 * q) * 1000 + a.i + 2 * p) ?? []) {
        if (b.kind !== 'floor' || Math.abs(b.y - a.y) > 0.35 || a.links.some((l) => l.to === b.id)) continue;
        const from = edge(a, 1, 0.3), land = edge(b, -1, 0.3);
        if (!clearArc(from, land, 0.32)) continue;
        link(a, b, 'leap', 2.6, from, land);
      }
    }
  }

  // ─── what each place is like ───
  const top = w.top() + 1.5;
  for (const s of spots) {
    s.high = s.y - w.ground(s.i, s.j);
    // (the sun: a ray toward it, through anything built, at the height a cat's body is)
    let lit = 0;
    for (const [ox, oz] of [[0, 0], [0.12, 0.08]]) {
      let x = s.x + ox, y = s.y + 0.12, z = s.z + oz, hit = false;
      for (let t = 0; t < 40 && y < top; t++) { x += SUN[0] * 0.14; y += SUN[1] * 0.14; z += SUN[2] * 0.14; if (solid(x, y, z)) { hit = true; break; } }
      if (!hit) lit += 0.5;
    }
    s.sun = lit;
    // (sheltered: stone close round it at a cat's height, and over it)
    let sh = 0;
    for (const [p, q] of DIRS) if (solid(s.x + p * 0.55, s.y + 0.25, s.z + q * 0.55)) sh++;
    for (let h = 0.5; h < 2.2; h += 0.25) if (solid(s.x, s.y + h, s.z)) { sh += 1.5; break; }
    s.shelter = Math.min(1, sh / 3.5);
    if (s.kind === 'floor' && !s.ground) s.out = DIRS.filter(([p, q]) => !spotAt(s.k, s.i + p, s.j + q) && !w.occupied(s.k, s.i + p, s.j + q)).length / 4;
    s.water = DIRS.concat([[0, 0]]).some(([p, q]) => w.pool(s.i + p, s.j + q));
    s.court = s.ground && w.courts.has(key(0, s.i, s.j));
  }

  // ─── how many it's home for ───
  let habitable = 0;
  for (const s of spots) {
    if (!s.rest) { habitable += 0.12; continue; }
    const base = s.kind === 'ledge' ? 0.25 : s.kind === 'rail' ? 0.2 : s.kind === 'coping' ? 0.3 : s.court ? 0.4 : s.ground ? (w.paved(s.i, s.j) ? 0.08 : 0.02) : 0.6;
    habitable += base + (s.ground && !s.court ? 0 : s.shelter * 0.4);
  }
  const capacity = Math.max(0, Math.min(7, Math.floor(habitable / 12 + 0.3)));
  return { spots, byName, capacity, habitable };
}

/** the cheapest way from one place to another (a list of links, the start's first), keeping off `avoid` */
export function route(P: Perches, from: number, to: number, avoid: (s: Spot) => boolean = () => false, scale: (l: Link) => number = () => 1): Link[] | null {
  if (from === to) return [];
  const n = P.spots.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), via: Array<Link | null> = Array(n).fill(null);
  dist[from] = 0;
  // (a small heap would do; the graphs are a few hundred places)
  const open = new Set([from]);
  while (open.size) {
    let u = -1, best = Infinity;
    for (const v of open) if (dist[v] < best) { best = dist[v]; u = v; }
    open.delete(u);
    if (u === to) break;
    for (const l of P.spots[u].links) {
      if (l.to !== to && avoid(P.spots[l.to])) continue;
      const nd = dist[u] + l.cost * scale(l);
      if (nd < dist[l.to]) { dist[l.to] = nd; prev[l.to] = u; via[l.to] = l; open.add(l.to); }
    }
  }
  if (!isFinite(dist[to])) return null;
  const out: Link[] = [];
  for (let v = to; v !== from; v = prev[v]) out.unshift(via[v]!);
  return out;
}
/** how far (by cost) every place is from one */
export function reachable(P: Perches, from: number): Float64Array {
  const n = P.spots.length, dist = new Float64Array(n).fill(Infinity), open = [from];
  dist[from] = 0;
  while (open.length) {
    let bi = 0;
    for (let q = 1; q < open.length; q++) if (dist[open[q]] < dist[open[bi]]) bi = q;
    const u = open.splice(bi, 1)[0];
    for (const l of P.spots[u].links) { const nd = dist[u] + l.cost; if (nd < dist[l.to]) { if (!isFinite(dist[l.to])) open.push(l.to); dist[l.to] = nd; } }
  }
  return dist;
}
/** a place's cell */
export const cellOf = (s: Spot): Cell => [s.k, s.i, s.j];

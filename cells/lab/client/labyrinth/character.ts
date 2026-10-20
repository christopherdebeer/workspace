/**
 * The rules' own dressing: what the stone gets of its own accord, so auto builds come out with some character, not bare.
 * Worked out from the resolved world and its motifs (motifs.ts), never kept as operations: it follows whatever's built.
 * Seeded (by the world's seed and where things are), so the same build is always dressed the same way; decided a whole
 * motif at a time, so it's coherent (a tower is all marble or none of it; a terrace's parapet runs all round or not at
 * all). The hand's dressing always wins, part by part: what the hand set on stays on, what it set off stays off.
 *
 * - **towers**: marble now and then, or brick; a lantern on top, often; sometimes a parapet round the top;
 * - **walls**: brick now and then; moss along their foot;
 * - **arcades and bridges**: now and then in brick, piers and all;
 * - **flights**: a lantern beside where they arrive (never in the way), often; a balustrade climbing a long or high one, now and then (a jali's
 *   pierced stone, rarely);
 * - **terraces**: pots at a corner or two; a lantern sometimes;
 * - **courts**: ivy, now and then, up a few of the walls round them (a cell or two high); moss at their foot;
 * - **anything high with a drop at its edge**: a parapet round it, taken a top at a time: a plain one, a balustrade
 *   (the dense, quick rhythm of its balusters), or a jali (a pierced stone screen);
 * - **thin walls beside a court**: now and then pierced, a jali, so the court is screened rather than shut off;
 * - **houses**: now and then mashrabiya over their upper windows (a lattice box out from the wall, on corbels); where a
 *   house's windows are arched, now and then colonnettes framing them and its doors; at its door, now and then a
 *   pergola over the way out (the house giving on to the yard; more often on to a court);
 * - **the edge of water**: moss on the stone beside a pool;
 * - **the stone at the foot of things**: a little moss, here and there.
 *
 * Dressing is kept sparing: a few things dressed well read better than everything dressed. And nothing the rules put
 * stands in a stair's way (`World.way`).
 */
import { hash } from '../kit/rng';
import { DIRS, DRESS, key, unkey, type Cell, type Dress, type World } from './model';
import { height, motifs } from './motifs';
import { buildings, cellsOf, underRoof } from './buildings';
import { outline } from './form';

const cache = new WeakMap<World, { v: number; map: Map<number, Dress> }>();

/** the rules' dressing for a world (worked out once for each state of it) */
export function character(w: World): Map<number, Dress> {
  const c = cache.get(w);
  if (c && c.v === w.version) return c.map;
  const map = dressUp(w);
  cache.set(w, { v: w.version, map });
  return map;
}

/** how a cell's dressed: the rules' dressing, and over it whatever the hand set (`plain`: the hand's alone) */
export function look(w: World, k: number, i: number, j: number, plain = false): Dress | null {
  const hand = w.dressed(k, i, j), auto = plain ? undefined : character(w).get(key(k, i, j));
  if (!hand) return auto ?? null;
  if (!auto) return hand;
  const out: Dress = { ...auto };
  for (const [f, v] of Object.entries(hand)) if (v !== undefined) (out as Record<string, unknown>)[f] = v;
  return out;
}

function dressUp(w: World): Map<number, Dress> {
  const map = new Map<number, Dress>();
  /** a chance, the same every time for the same things */
  const chance = (p: number, ...n: number[]) => hash(w.seed, ...n) % 1000 < p * 1000;
  // (nothing goes on a top that has a roof over it)
  const roofed = new Set<number>();
  for (const b of buildings(w).list) for (const [x, z] of underRoof(b)) roofed.add(key(b.h - 1, x, z));
  // (and nothing stands in a stair's way (its foot, its head, the room over them), nor before a door)
  const doorways = new Set(buildings(w).list.flatMap((b) => b.openings.filter((o) => o.kind === 'door').map((o) => key(o.k, o.i + DIRS[o.d][0], o.j + DIRS[o.d][1]))));
  const put = (c: Cell, d: Dress) => { const v = key(...c); if (roofed.has(v) && (d.prop || d.parapet)) return; if (d.prop && (w.way(c[0] + 1, c[1], c[2]) || doorways.has(key(c[0] + 1, c[1], c[2])) || w.basin(c[0] + 1, c[1], c[2]))) return; if (d.pergola && w.way(...c)) return; const o = map.get(v) ?? {}; map.set(v, { ...o, ...d }); };
  const stone = (c: Cell) => w.stone(...c) || w.pier(...c);
  /** a top with room over it (for a lantern or a pot) */
  const roomy = (c: Cell) => w.stone(...c) && !w.occupied(c[0] + 1, c[1], c[2]) && !w.tree(c[0] + 1, c[1], c[2]) && !(w.block(...c) && outline(w, ...c).flow);
  const id = (cells: Cell[]) => cells.reduce((m, c) => Math.min(m, key(...c)), Infinity);

  for (const m of motifs(w)) {
    const n = id(m.cells);
    if (m.kind === 'tower') {
      const r = hash(w.seed, n, 1) % 100, mat = r < 35 ? DRESS.marble : r < 50 ? DRESS.brick : -1;
      if (mat >= 0) for (const c of m.cells) if (stone(c)) put(c, { mat });
      const tops = m.cells.filter(roomy).filter((c) => c[0] === Math.max(...m.cells.map((q) => q[0])));
      if (tops.length && chance(0.65, n, 2)) put(tops[hash(w.seed, n, 3) % tops.length], { prop: DRESS.lantern });
      if (chance(0.25, n, 4)) for (const c of tops) put(c, { parapet: true });
    } else if (m.kind === 'wall') {
      if (chance(0.25, n, 1)) for (const c of m.cells) if (stone(c)) put(c, { mat: DRESS.brick });
      if (chance(0.4, n, 2)) for (const c of m.cells) if (c[0] === 0 && stone(c)) put(c, { moss: true });
    } else if (m.kind === 'arcade' || m.kind === 'bridge') {
      if (chance(0.2, n, 1)) for (const c of m.cells) if (stone(c)) put(c, { mat: DRESS.brick });
    } else if (m.kind === 'flight') {
      // (where it arrives: the stone under the place at its head)
      // (beside where it arrives, not in the way: on the stone to one side of the place at its head)
      const [k, i, j] = m.cells[m.cells.length - 1], d = w.stair(k, i, j), [a, b] = DIRS[d], [ta, tb] = DIRS[(d + 1) % 4];
      const beside = ([1, -1] as const).map((s): Cell => [k, i + a + ta * s, j + b + tb * s]).filter((c) => roomy(c) && !w.way(c[0] + 1, c[1], c[2]));
      if (beside.length && chance(0.6, n, 1)) put(beside[hash(w.seed, n, 4) % beside.length], { prop: DRESS.lantern });
      const stairs = m.cells.filter((c) => w.stair(...c) >= 0);
      // (a flight with a drop beside it is railed, always, and the landings between its stairs with it; a long or high one
      // with none, now and then)
      const over = (c: Cell) => DIRS.some(([a, b]) => { const x = c[1] + a, z = c[2] + b; return !w.occupied(c[0], x, z) && w.stair(c[0], x, z) < 0 && Math.max(height(w, x, z), w.ground(x, z)) < c[0] - 1; });
      const drop = stairs.some(over);
      if (drop || ((stairs.length >= 3 || k >= 2) && chance(0.4, n, 2))) {
        const rail = chance(0.2, n, 3) ? DRESS.jali : DRESS.balustrade;
        for (const c of stairs) put(c, { parapet: true, rail });
        for (const c of m.cells) if (w.stone(...c) && !w.occupied(c[0] + 1, c[1], c[2]) && w.laidBy(...c)) put(c, { parapet: true, rail });
      }
    } else if (m.kind === 'terrace') {
      const open = (c: Cell) => DIRS.filter(([a, b]) => Math.max(height(w, c[1] + a, c[2] + b), w.ground(c[1] + a, c[2] + b)) < c[0] + 1).length;
      const corners = m.cells.filter((c) => roomy(c) && open(c) >= 2);
      corners.forEach((c, q) => { if (q < 3 && chance(0.5, n, 10 + q)) put(c, { prop: DRESS.pot }); });
      const free = corners.filter((c) => !map.get(key(...c))?.prop);
      if (free.length && chance(0.3, n, 2)) put(free[0], { prop: DRESS.lantern });
    } else if (m.kind === 'court') {
      // (the walls round it: ivy climbing them, moss at their foot)
      const ivy = chance(0.3, n, 1), moss = chance(0.4, n, 2);
      for (const [, i, j] of m.cells) for (const [a, b] of DIRS) {
        const x = i + a, z = j + b, h = height(w, x, z);
        const gx = w.ground(x, z);
        if (!w.stone(gx, x, z)) continue;
        if (moss) put([gx, x, z], { moss: true });
        // (on a few columns of the wall, in a clump, a cell or two up from the foot)
        if (ivy && hash(w.seed, Math.floor(x / 3), Math.floor(z / 3), 5) % 100 < 45) { const up = 1 + (hash(w.seed, x, z, 6) % 2); for (let k = 0; k < Math.min(h, up); k++) if (w.stone(k, x, z)) put([k, x, z], { ivy: true }); }
      }
    }
  }

  // (any stair with a real drop beside it, flight or no: railed; a step or two up off the ground stays plain, a stoop,
  // not a balustraded stair)
  for (const v of w.stairs.keys()) {
    const c = unkey(v);
    if (map.get(v)?.parapet) continue;
    if (DIRS.some(([a, b]) => { const x = c[1] + a, z = c[2] + b; return !w.occupied(c[0], x, z) && w.stair(c[0], x, z) < 0 && Math.max(height(w, x, z), w.ground(x, z)) < c[0] - 1; })) put(c, { parapet: true, rail: DRESS.balustrade });
  }
  // (anything high with a drop at its edge: a parapet round it, a top at a time, all of it or none)
  const tops = new Set<number>(), seen = new Set<number>();
  for (const v of w.mass.keys()) { const [k, i, j] = unkey(v); if (k >= 1 && !w.occupied(k + 1, i, j) && !w.tree(k + 1, i, j) && w.wall(k, i, j) < 0) tops.add(v); }
  for (const v of tops) {
    if (seen.has(v)) continue;
    const [k] = unkey(v), region: Cell[] = [], st = [v];
    seen.add(v);
    while (st.length) {
      const u = st.pop()!, [, i, j] = unkey(u);
      region.push([k, i, j]);
      for (const [a, b] of DIRS) { const q = key(k, i + a, j + b); if (tops.has(q) && !seen.has(q)) { seen.add(q); st.push(q); } }
    }
    const drop = region.some(([, i, j]) => DIRS.some(([a, b]) => Math.max(height(w, i + a, j + b), w.ground(i + a, j + b)) <= k - 1));
    if (drop && region.length >= 3 && chance(0.35, id(region), 9)) {
      const r = hash(w.seed, id(region), 10) % 100, rail = r < 40 ? DRESS.balustrade : r < 55 ? DRESS.jali : DRESS.parapet;
      for (const c of region) put(c, { parapet: true, rail });
    }
  }
  // (thin walls beside a court, now and then a jali, a stretch at a time)
  for (const v of w.thin.keys()) {
    const [k, i, j] = unkey(v);
    if (DIRS.some(([a, b]) => w.courts.has(key(0, i + a, j + b))) && chance(0.45, Math.floor(i / 3), Math.floor(j / 3), k, 12)) put([k, i, j], { screen: true });
  }
  // (houses: mashrabiya at the upper windows; colonnettes where the windows are arched; a pergola where a door gives on a court)
  const kept = new Set(w.decor.map((d) => key(0, d.i, d.j)));
  for (const b of buildings(w).list) {
    const all = cellsOf(b).filter((c) => w.block(...c));
    const upper = b.openings.some((o) => o.kind === 'window' && o.k >= 1 && o.style !== 'slit');
    if (b.roof && upper && chance(0.3, b.id, 21)) for (const c of all) if (c[0] > w.ground(c[1], c[2])) put(c, { oriel: true });
    if (b.openings.some((o) => o.style === 'arched' && o.kind === 'window') && chance(0.4, b.id, 22)) for (const c of all) put(c, { colonnettes: true });
    for (const o of b.openings) {
      if (o.kind !== 'door' || o.k !== w.ground(o.i, o.j)) continue;
      const [a, bb] = DIRS[o.d], x = o.i + a, z = o.j + bb;
      // (a house's door on to a court, or on to open ground: the way out from it, now and then shaded)
      if (!b.roof || !chance(w.courts.has(key(0, x, z)) ? 0.5 : 0.3, b.id, o.i, o.j, 23)) continue;
      const [ta, tb] = DIRS[(o.d + 1) % 4], fit = (p: number, q: number) => { const g = w.ground(p, q); return w.ground(x, z) === g && w.free(g, p, q) && !w.arched(g, p, q) && !w.pier(g, p, q) && !kept.has(key(0, p, q)) && w.free(g + 1, p, q); };
      for (const s of [0, -1, 1]) if (fit(x + ta * s, z + tb * s)) put([w.ground(x + ta * s, z + tb * s), x + ta * s, z + tb * s], { pergola: true }); else if (s === 0) break;
    }
  }
  // (moss at the damp edges of water: the stone beside a pool)
  for (let j = w.extent().j0; j <= w.extent().j1; j++) for (let i = w.extent().i0; i <= w.extent().i1; i++) {
    if (!w.pool(i, j)) continue;
    for (const [a, b] of DIRS) { const gx = w.ground(i + a, j + b); if (w.stone(gx, i + a, j + b)) put([gx, i + a, j + b], { moss: true }); }
  }
  // (a little moss at the foot of things)
  for (const v of w.mass.keys()) { const [k, i, j] = unkey(v); if (k === w.ground(i, j) && chance(0.06, i, j, 11)) put([k, i, j], { moss: true }); }
  return map;
}

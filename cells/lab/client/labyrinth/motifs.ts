/**
 * Motifs: the things a labyrinth is made of, bigger than a cell, found in the resolved world (model.ts) so a hand can
 * take one up whole (select.ts) and the rules can keep it coherent.
 *
 * - **arcade**: arches end to end in a row at a level, over piers between them (the rules make their bays alike);
 * - **bridge**: one arch of three cells or more, or a bridge's stone;
 * - **flight**: stairs one after another, each a level up the same way;
 * - **wall**: a run of three or more columns on the stone, one cell thick;
 * - **tower**: one column, or a few together, three or more high, standing over everything round it;
 * - **terrace**: four or more tops side by side at the same height, two or more deep each way (not a wall's top);
 * - **court**: the ground walled in.
 *
 * Each has the cells it covers (what's drawn round it when it's selected), and which of them are the hand's (what
 * taking it away cuts).
 */
import { DIRS, inGrid, key, unkey, type Cell, type Span, type World } from './model';

export type MotifKind = 'arcade' | 'bridge' | 'flight' | 'wall' | 'tower' | 'terrace' | 'court';
export interface Motif { kind: MotifKind; label: string; cells: Cell[]; hand: Cell[]; spans: Span[] }

const spanCells = (sp: Span): Cell[] => Array.from({ length: sp.n }, (_, s) => [sp.k, sp.i + s * DIRS[sp.a][0], sp.j + s * DIRS[sp.a][1]] as Cell);
/** how high a column's stone (or stair) reaches: the level over the highest */
export function height(w: World, i: number, j: number) { for (let k = w.levels - 1; k >= 0; k--) if (w.stone(k, i, j) || w.stair(k, i, j) >= 0) return k + 1; return 0; }
const column = (w: World, i: number, j: number): Cell[] => { const out: Cell[] = []; for (let k = w.ground(i, j); k < w.levels; k++) if (w.occupied(k, i, j)) out.push([k, i, j]); return out; };
const mine = (w: World, c: Cell) => w.stone(...c) || w.stair(...c) >= 0;

const found = new WeakMap<World, { v: number; list: Motif[] }>();
/** the motifs in a world (found once for each state of it) */
export function motifs(w: World): Motif[] {
  const c = found.get(w);
  if (c && c.v === w.version) return c.list;
  const list = find(w);
  found.set(w, { v: w.version, list });
  return list;
}
function find(w: World): Motif[] {
  const out: Motif[] = [];
  const e = w.extent();
  // (arcades: arches end to end over piers; what's left over, if it's long, a bridge)
  const along = (sp: Span) => (sp.a === 0 ? sp.i : sp.j), line = (sp: Span) => (sp.a === 0 ? sp.j : sp.i);
  const row = [...w.spans].sort((p, q) => p.k - q.k || p.a - q.a || line(p) - line(q) || along(p) - along(q));
  for (let q = 0; q < row.length;) {
    let r = q + 1;
    const piers: Cell[] = [];
    while (r < row.length) {
      const p = row[r - 1], c = row[r], [di, dj] = DIRS[p.a], gi = p.i + p.n * di, gj = p.j + p.n * dj;
      if (c.k !== p.k || c.a !== p.a || line(c) !== line(p) || along(c) !== along(p) + p.n + 1 || !w.pier(p.k - 1, gi, gj)) break;
      piers.push([p.k, gi, gj]);
      for (let k = p.k - 1; k >= 0 && w.pier(k, gi, gj); k--) piers.push([k, gi, gj]);
      r++;
    }
    const spans = row.slice(q, r);
    if (spans.length > 1) {
      const cells = [...spans.flatMap(spanCells), ...piers];
      out.push({ kind: 'arcade', label: `an arcade of ${spans.length} bays`, cells, hand: cells.filter((c) => mine(w, c)), spans });
    } else if (spans[0].n >= 3 || w.bridge(spans[0].k, spans[0].i, spans[0].j)) {
      const cells = spanCells(spans[0]);
      out.push({ kind: 'bridge', label: `a bridge of ${spans[0].n}, on ${spans[0].flat ? 'a lintel' : 'one arch'}`, cells, hand: cells, spans });
    }
    q = r;
  }
  // (flights: from each stair with none of its flight below it, up as far as it goes)
  for (const v of w.stairs.keys()) {
    const [k, i, j] = unkey(v), d = w.stair(k, i, j), [di, dj] = DIRS[d];
    if (w.stair(k - 1, i - di, j - dj) === d) continue;
    const cells: Cell[] = [[k, i, j]];
    for (let s = 1; w.stair(k + s, i + s * di, j + s * dj) === d; s++) cells.push([k + s, i + s * di, j + s * dj]);
    if (cells.length >= 2) out.push({ kind: 'flight', label: `a flight of ${cells.length} steps`, cells, hand: cells, spans: [] });
  }
  // (walls: a run of columns on the stone, one cell thick)
  const footed = (i: number, j: number) => { const g = w.ground(i, j); return w.block(g, i, j) || w.archway(g, i, j) >= 0 || w.wall(g, i, j) >= 0; };
  for (const a of [0, 1]) {
    const [di, dj] = DIRS[a], [pi, pj] = DIRS[1 - a];
    const thin = (i: number, j: number) => footed(i, j) && !footed(i + pi, j + pj) && !footed(i - pi, j - pj);
    for (let j = e.j0; j <= e.j1; j++) for (let i = e.i0; i <= e.i1; i++) {
      if (!thin(i, j) || thin(i - di, j - dj)) continue;
      let n = 1;
      while (thin(i + n * di, j + n * dj)) n++;
      if (n < 3) continue;
      const cells = Array.from({ length: n }, (_, s) => column(w, i + s * di, j + s * dj)).flat();
      out.push({ kind: 'wall', label: `a wall, ${n} long`, cells, hand: cells.filter((c) => mine(w, c)), spans: [] });
    }
  }
  // (towers and terraces: solid columns, up from the stone, side by side at the same height; over what's round them, or
  // many of them. What's carried on arches between them isn't part of them)
  const seen = new Set<number>();
  const solid = (i: number, j: number, h: number) => { const g = w.ground(i, j); return height(w, i, j) === h && w.topFrom(g, i, j) === h && w.stone(g, i, j) && w.stone(h - 1, i, j); };
  for (let j = e.j0; j <= e.j1; j++) for (let i = e.i0; i <= e.i1; i++) {
    const h = height(w, i, j);
    if (h < 1 || seen.has(key(0, i, j)) || !solid(i, j, h)) continue;
    const group: Array<[number, number]> = [[i, j]], st: Array<[number, number]> = [[i, j]];
    seen.add(key(0, i, j));
    while (st.length) {
      const [x, z] = st.pop()!;
      for (const [a, b] of DIRS) { const x2 = x + a, z2 = z + b; if (inGrid(x2, z2) && !seen.has(key(0, x2, z2)) && solid(x2, z2, h)) { seen.add(key(0, x2, z2)); group.push([x2, z2]); st.push([x2, z2]); } }
    }
    const inside = new Set(group.map(([x, z]) => key(0, x, z)));
    const over = group.every(([x, z]) => DIRS.every(([a, b]) => inside.has(key(0, x + a, z + b)) || height(w, x + a, z + b) < h || !w.stone(w.ground(x + a, z + b), x + a, z + b)));
    const cells = group.flatMap(([x, z]) => column(w, x, z));
    const tall = h - Math.min(...group.map(([x, z]) => w.ground(x, z)));
    if (tall >= 3 && group.length <= 4 && over) out.push({ kind: 'tower', label: `a tower, ${tall} high`, cells, hand: cells.filter((c) => mine(w, c)), spans: [] });
    else if (group.length >= 4 && Math.min(Math.max(...group.map((c) => c[0])) - Math.min(...group.map((c) => c[0])), Math.max(...group.map((c) => c[1])) - Math.min(...group.map((c) => c[1]))) >= 1) out.push({ kind: 'terrace', label: `a terrace of ${group.length} at ${tall} high`, cells: group.map(([x, z]) => [h - 1, x, z] as Cell), hand: [], spans: [] });
  }
  // (courts)
  const inCourt = new Set<number>();
  for (const v of w.courts) {
    if (inCourt.has(v)) continue;
    const cells: Cell[] = [], st = [v];
    inCourt.add(v);
    while (st.length) {
      const u = st.pop()!, [, x, z] = unkey(u);
      cells.push([w.ground(x, z), x, z]);
      for (const [a, b] of DIRS) { const n = key(0, x + a, z + b); if (inGrid(x + a, z + b) && w.courts.has(n) && !inCourt.has(n)) { inCourt.add(n); st.push(n); } }
    }
    out.push({ kind: 'court', label: `a court of ${cells.length}`, cells, hand: [], spans: [] });
  }
  return out;
}

/** the motifs a cell is part of, the smallest first (a second touch on a selection takes up the next of these) */
export function around(list: Motif[], c: Cell): Motif[] {
  const v = key(...c);
  return list.filter((m) => m.cells.some((q) => key(...q) === v) || (m.kind === 'court' || m.kind === 'terrace') && m.cells.some((q) => q[1] === c[1] && q[2] === c[2])).sort((p, q) => p.cells.length - q.cells.length);
}

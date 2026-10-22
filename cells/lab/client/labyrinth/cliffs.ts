/**
 * The land's cliffs as forms (after the in-situ target sheets): where the land steps down from one terrace to the next,
 * a face of limestone, in a few broad blocks. Not a sampled slope; one description that the mesh builds its rock from
 * and the drawing draws its lines from, so the picture's cliff and the drawing's are the same cliff.
 *
 * - **A run**: the edges where the land drops, chained along the drop with the high ground on the left, so a cliff is
 *   followed round its corners as one thing (a loop round a rise, or a run that ends where a wall or a flight takes over).
 * - **A segment**: a straight stretch of a run at one height, from one corner (or change of height) to the next.
 * - **Tiers**: the drop in a few courses, the same down a whole run (its strata), each a little further out than the one
 *   over it, with a ledge between.
 * - **Blocks**: each segment cut along into blocks of unequal length, each set a little forward or back of the next and
 *   leaning back a little, so the face is a few broad planes with joints between, not one sheet and not a crumple.
 *
 * Offsets are out from the edge between the cells into the low one (the rock stands on the low ground, against the
 * high); a corner of the high ground (convex) runs each face on to meet the next, a corner in it (concave) stops each at
 * the next.
 */
import { hash } from '../kit/rng';
import { DIRS, type World } from './model';
import { onLand } from './land';
import { walled } from './context';

/** a course of a block: from its top to its bottom, out from the edge so far at each */
export interface Tier { top: number; bot: number; rTop: number; rBot: number }
export interface Block { s0: number; s1: number; tiers: Tier[] }
/** how a segment meets the next: round the high ground's corner, into a corner of it, on at another height, or not */
export type Join = 'convex' | 'concave' | 'straight' | 'open';
export interface Seg {
  /** where it starts on the grid's lines (cells: cell (i, j) spans i..i+1), its way along, its way out over the low ground */
  x: number; z: number; t: [number, number]; o: [number, number];
  /** how long (cells), how high its top, how low its foot */
  n: number; hi: number; lo: number;
  blocks: Block[];
  /** the high cells along it, in order */
  cells: Array<[number, number]>;
  prev: Seg | null; next: Seg | null; pj: Join; nj: Join;
}
export interface Run { id: number; segs: Seg[]; closed: boolean }

/** the ground's level at a cell, as drawn: the stream's bed a little under its banks */
export const levelAt = (w: World, i: number, j: number) => w.ground(i, j) - (w.land?.water.has(j * 1000 + i) ? 0.3 : 0);

/** how far out a block's face is at a height (none above its top) */
export function offsetAt(b: Block, y: number): number {
  const T = b.tiers;
  if (y > T[0].top + 1e-6) return 0;
  for (const t of T) if (y >= t.bot - 1e-6) return t.rTop + ((t.rBot - t.rTop) * (t.top - y)) / Math.max(1e-6, t.top - t.bot);
  return T[T.length - 1].rBot;
}
/** a point on a segment: so far along, so far out, at a height (grid units) */
export const along = (sg: Seg, s: number, r: number, y: number): [number, number, number] => [sg.x + sg.t[0] * s + sg.o[0] * r, y, sg.z + sg.t[1] * s + sg.o[1] * r];
/** how far a block's face runs past its end (or stops short of it, negative) at a height, to meet the next segment's */
export function reachAt(sg: Seg, end: 0 | 1, y: number): number {
  const j = end ? sg.nj : sg.pj, nb = end ? sg.next : sg.prev;
  if (!nb || (j !== 'convex' && j !== 'concave')) return 0;
  const r = offsetAt(end ? nb.blocks[0] : nb.blocks[nb.blocks.length - 1], y);
  return j === 'convex' ? r : -r;
}

/** how much a course's top edge is rounded off (a water's bank, less) */
export const BEVEL = 0.055, BEVEL_SMALL = 0.02;
/** the bevel of a segment's courses */
export const bevelOf = (sg: Seg) => (sg.hi - sg.lo < 0.6 ? BEVEL_SMALL : BEVEL);

const rng = (...n: number[]) => { let s = hash(...n) >>> 0; return () => { s = hash(s, 0x51ed) >>> 0; return s / 4294967296; }; };
const ramp = (r: () => number, a: number, b: number) => a + r() * (b - a);

interface Edge { i: number; j: number; d: number; hi: number; lo: number; sx: number; sz: number; ex: number; ez: number }
const cache = new WeakMap<World, { v: number; box: string; runs: Run[]; back: Map<string, number>; edges: Set<string> }>();

/** the cliffs over a box of cells (where a wall holds the bank, a flight climbs it or what's built fills it, none) */
export function cliffs(w: World, B: { i0: number; i1: number; j0: number; j1: number }): Run[] {
  const box = `${B.i0}.${B.i1}.${B.j0}.${B.j1}`, c = cache.get(w);
  if (c && c.v === w.version && c.box === box) return c.runs;
  const runs: Run[] = [], back = new Map<string, number>(), edgeSet = new Set<string>();
  if (w.land) {
    const wet = (i: number, j: number) => w.land!.water.has(j * 1000 + i);
    const seed = w.land.seed, sharp = walled(w), within = (i: number, j: number) => i >= B.i0 && i <= B.i1 && j >= B.j0 && j <= B.j1 && onLand(i, j);
    const from = new Map<string, Edge[]>(), edges: Edge[] = [];
    for (let j = B.j0; j <= B.j1; j++) for (let i = B.i0; i <= B.i1; i++) for (let d = 0; d < 4; d++) {
      const [a, b] = DIRS[d], x = i + a, z = j + b;
      if (!within(i, j) || !within(x, z)) continue;
      const hi = levelAt(w, i, j), lo = levelAt(w, x, z);
      if (hi - lo < 0.05 || sharp(i, j, d)) continue;
      const back = (d + 2) % 4, gl = w.ground(x, z), gh = w.ground(i, j);
      if (gh > gl && (w.stair(gl, x, z) === back || w.stair(gh - 1, x, z) === back)) continue;
      const [ta, tb] = DIRS[(d + 1) % 4], mx = i + 0.5 + a * 0.5, mz = j + 0.5 + b * 0.5;
      const e: Edge = { i, j, d, hi, lo, sx: mx - ta * 0.5, sz: mz - tb * 0.5, ex: mx + ta * 0.5, ez: mz + tb * 0.5 };
      edges.push(e); edgeSet.add(`${i}.${j}.${d}`);
      const k = `${e.sx},${e.sz}`;
      (from.get(k) ?? from.set(k, []).get(k)!).push(e);
    }
    // (each edge's next along the drop: round the high ground's corner first, then on, then into a corner of it)
    const next = new Map<Edge, Edge>(), prev = new Map<Edge, Edge>();
    for (const e of edges) {
      const cand = from.get(`${e.ex},${e.ez}`) ?? [];
      for (const dd of [(e.d + 1) % 4, e.d, (e.d + 3) % 4]) {
        const n = cand.find((q) => q.d === dd && !prev.has(q));
        if (n) { next.set(e, n); prev.set(n, e); break; }
      }
    }
    const seen = new Set<Edge>();
    const chain = (e0: Edge): Edge[] => { const out: Edge[] = []; for (let e: Edge | undefined = e0; e && !seen.has(e); e = next.get(e)) { seen.add(e); out.push(e); } return out; };
    const lists: Array<{ es: Edge[]; closed: boolean }> = [];
    for (const e of edges) if (!prev.has(e)) lists.push({ es: chain(e), closed: false });
    // (loops: from their least edge, so a loop's the same whichever way it's found)
    const key = (e: Edge) => (e.j * 4096 + e.i) * 4 + e.d;
    for (const e of [...edges].sort((p, q) => key(p) - key(q))) if (!seen.has(e)) lists.push({ es: chain(e), closed: true });
    for (const { es, closed } of lists) {
      const id = hash(seed, es[0].i, es[0].j, es[0].d, 0xc11f) >>> 0, segs: Seg[] = [];
      // (its tiers: by the run and the drop, the same strata all along it)
      const tiersFor = (hi: number, lo: number) => {
        const r = rng(id, Math.round(hi * 10), Math.round(lo * 10), 7), drop = hi - lo;
        const nT = drop < 0.6 ? 1 : drop < 1.4 ? (r() < 0.3 ? 1 : 2) : Math.max(2, Math.min(4, Math.round(drop * ramp(r, 1, 1.5))));
        const cuts: number[] = [hi];
        for (let q = 1; q < nT; q++) cuts.push(hi - (drop * q) / nT + (r() - 0.5) * 0.24 * (drop / nT));
        cuts.push(lo - 0.1);
        return cuts;
      };
      for (let q = 0; q < es.length;) {
        const e = es[q];
        let n = 1;
        while (q + n < es.length && es[q + n].d === e.d && es[q + n].hi === e.hi && es[q + n].lo === e.lo) n++;
        const [ta, tb] = DIRS[(e.d + 1) % 4], [oa, ob] = DIRS[e.d], r = rng(seed, e.i, e.j, e.d, 0xb10c), cuts = tiersFor(e.hi, e.lo);
        const small = e.hi - e.lo < 0.6, blocks: Block[] = [];
        // (down to the stream, cut back into the bank: its rim well back from the water's edge, its foot at it, so the
        // channel opens upward and the water's seen from above, not a slot; the terrace over it stops at the rim)
        // (not where what's built leans on the bank's ground, on it or beside it along the edge: its faces against that
        // ground aren't drawn, and cut back, the ground wouldn't be there)
        const leans = es.slice(q, q + n).some((x) => [[0, 0], [ta, tb], [-ta, -tb]].some(([a, b]) => { const ci = x.i + a, cj = x.j + b; for (let k = Math.floor(x.lo) - 1; k <= Math.ceil(x.hi); k++) if (w.stone(k, ci, cj) || w.pier(k, ci, cj) || w.stair(k, ci, cj) >= 0) return true; return w.paved(ci, cj) || w.way(w.ground(ci, cj), ci, cj); }));
        const wetBelow = !small && wet(e.i + oa, e.j + ob) && !leans, S = wetBelow ? ramp(r, 0.3, 0.42) : 0;
        if (wetBelow) for (let q2 = q; q2 < q + n; q2++) back.set(`${es[q2].i}.${es[q2].j}.${e.d}`, S);
        const nT = cuts.length - 1;
        for (let s = 0; s < n - 1e-6;) {
          let L = ramp(r, 0.45, 1.5);
          if (n - s - L < 0.35) L = n - s;
          const tiers: Tier[] = [];
          // (each course's top edge rounded off by the run's bevel: so a course stands at least that far out of the one
          // over it, or of the terrace's edge)
          const bv = small ? BEVEL_SMALL : BEVEL;
          let rr = small ? bv + ramp(r, 0, 0.02) : wetBelow ? -S + bv : bv + ramp(r, 0, 0.09);
          for (let k = 0; k < nT; k++) {
            const top = cuts[k], bot = cuts[k + 1];
            let rTop: number, rBot: number;
            if (wetBelow) { rTop = k ? rr + bv + ramp(r, 0, 0.04) : rr; rBot = Math.max(rTop, -S + (S * (k + 1)) / nT - ramp(r, 0.02, 0.06)); }
            else { rTop = k ? rr + bv + ramp(r, 0, 0.08) : rr; rBot = rTop + (small ? 0.01 : ramp(r, 0.03, 0.14)) * (top - bot); }
            tiers.push({ top, bot, rTop, rBot }); rr = rBot;
          }
          blocks.push({ s0: s, s1: s + L, tiers });
          s += L;
        }
        // (the rim broken: now and then a block between the segment's ends its top a little under the terrace, the
        // terrace's edge standing over it; not at the ends, where it meets the next segment round a corner)
        if (!small && !wetBelow) for (let q2 = 1; q2 + 1 < blocks.length; q2++) {
          const t0 = blocks[q2].tiers[0];
          if (r() < 0.4 && t0.top - t0.bot > 0.45) t0.top -= ramp(r, 0.06, 0.22);
        }
        segs.push({ x: e.sx, z: e.sz, t: [ta, tb], o: [oa, ob], n, hi: e.hi, lo: e.lo, blocks, cells: es.slice(q, q + n).map((x) => [x.i, x.j] as [number, number]), prev: null, next: null, pj: 'open', nj: 'open' });
        q += n;
      }
      const joinOf = (A: Seg, Bs: Seg): Join => {
        const dA = DIRS.findIndex(([a, b]) => a === A.o[0] && b === A.o[1]), dB = DIRS.findIndex(([a, b]) => a === Bs.o[0] && b === Bs.o[1]);
        return dB === dA ? 'straight' : dB === (dA + 1) % 4 ? 'convex' : 'concave';
      };
      for (let k = 0; k < segs.length; k++) {
        const nx = k + 1 < segs.length ? segs[k + 1] : closed ? segs[0] : null;
        if (!nx || nx === segs[k]) continue;
        const j = joinOf(segs[k], nx);
        segs[k].next = nx; segs[k].nj = j; nx.prev = segs[k]; nx.pj = j;
      }
      runs.push({ id, segs, closed });
    }
  }
  cache.set(w, { v: w.version, box, runs, back, edges: edgeSet });
  return runs;
}
/** the edges that are cliffs (`i.j.d`, from the high cell) */
export function cliffEdges(w: World, B: { i0: number; i1: number; j0: number; j1: number }): Set<string> {
  cliffs(w, B);
  return cache.get(w)!.edges;
}
/** how far a cell's terrace stops short of its edge its way d, where its cliff's cut back to the stream below (cells.d) */
export function cutBack(w: World, B: { i0: number; i1: number; j0: number; j1: number }): Map<string, number> {
  cliffs(w, B);
  return cache.get(w)!.back;
}

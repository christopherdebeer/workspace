/**
 * Taking something up with the select brush: a piece (the hand's stone, a stair, a cypress, or what the rules made: an
 * arch, a pier) or a whole motif (motifs.ts). What it is, said plainly; the other ways it could be read, to switch
 * between; and taking it away.
 *
 * Switching is how auto is corrected rather than chosen ahead: paint, then take up what came out wrong and try it
 * another way. Each reading is an operation like any other (an arch read as a lintel, a pier forced under a run, stone
 * where there was air, a block turned arch or stair), so it's undone, replayed and resolved like any other, and it's
 * the hand's from then on.
 */
import { DIRS, RULE, type Cell, type Op, type Span, type World } from './model';
import type { Motif } from './motifs';

export interface Reading { label: string; op: Op | null }
export interface Selection {
  title: string;
  /** what's drawn round it */
  cells: Cell[];
  /** the ways it could be read; `at`, the one it is now (its op is null: it's how it already is) */
  readings: Reading[]; at: number;
  /** taking it away, if it can be */
  remove: Op | null;
  /** its stone, for dressing it whole */
  stone: Cell[];
  motif?: Motif;
}

const spanCells = (sp: Span): Cell[] => Array.from({ length: sp.n }, (_, s) => [sp.k, sp.i + s * DIRS[sp.a][0], sp.j + s * DIRS[sp.a][1]] as Cell);
/** stone filling the air under a run (piers too), down to the stone below */
const fill = (w: World, cells: Cell[], now: number): Op => {
  const add: Array<[number, number, number, number]> = [];
  for (const [k, i, j] of cells) for (let kk = k - 1; kk >= 0 && !w.stone(kk, i, j) && w.stair(kk, i, j) < 0; kk--) add.push([kk, i, j, now]);
  return { add, why: 'solid' };
};
/** readings of arches the rules made: as they are, lintels, two bays each (if long enough), solid */
function arches(w: World, spans: Span[], now: number, between: Cell[] = []): { readings: Reading[]; at: number } {
  const cells = spans.flatMap(spanCells), clear: Op['rule'] = cells.map(([k, i, j]) => [k, i, j, RULE.none]);
  const readings: Reading[] = [
    { label: spans.length > 1 ? 'arches' : 'an arch', op: { rule: clear, why: 'reading' } },
    { label: spans.length > 1 ? 'lintels' : 'a lintel', op: { rule: cells.map(([k, i, j]) => [k, i, j, RULE.lintel]), why: 'reading' } },
  ];
  if (spans.every((sp) => sp.n >= 3)) readings.push({ label: spans.length > 1 ? 'two bays each' : 'two bays', op: { rule: spans.map((sp) => { const m = Math.floor(sp.n / 2); return [sp.k, sp.i + m * DIRS[sp.a][0], sp.j + m * DIRS[sp.a][1], RULE.pier]; }), why: 'reading' } });
  readings.push({ label: 'solid', op: { ...fill(w, [...cells, ...between], now), why: 'reading' } });
  const at = spans.every((sp) => sp.flat) ? 1 : 0;
  readings[at].op = null;
  return { readings, at };
}

export function selectCell(w: World, c: Cell, view: number, now: number): Selection | null {
  const [k, i, j] = c;
  const sp = w.span(k, i, j);
  if (sp) {
    const r = arches(w, [sp], now);
    return { title: `${sp.flat ? 'a lintel' : 'an arch'} of ${sp.n}, carrying what's over it`, cells: spanCells(sp), ...r, remove: { cut: spanCells(sp), why: 'take' }, stone: spanCells(sp) };
  }
  if (w.pier(k, i, j)) {
    const col: Cell[] = [];
    let top = k; while (w.pier(top + 1, i, j)) top++;
    for (let kk = top; kk >= 0 && w.pier(kk, i, j); kk--) col.push([kk, i, j]);
    const readings: Reading[] = [{ label: 'a pier', op: null }, { label: 'solid', op: { add: col.map(([kk]) => [kk, i, j, now] as [number, number, number, number]), why: 'reading' } }];
    return { title: 'a pier, the rules\' own, carrying what has nothing else under it', cells: col, readings, at: 0, remove: null, stone: col };
  }
  const d = w.stair(k, i, j);
  if (d >= 0) {
    const readings: Reading[] = [0, 1, 2, 3].map((q) => ({ label: ['climbing east', 'climbing south', 'climbing west', 'climbing north'][(d + q) % 4], op: q === 0 ? null : { stairs: [[k, i, j, (d + q) % 4, now]], why: 'reading' } as Op }));
    readings.push({ label: 'a block', op: { cut: [c], add: [[k, i, j, now]], why: 'reading' } });
    return { title: 'a stair', cells: [c], readings, at: 0, remove: { cut: [c], why: 'take' }, stone: [c] };
  }
  if (w.tree(k, i, j) || w.tree(k - 1, i, j)) {
    const t: Cell = w.tree(k, i, j) ? c : [k - 1, i, j];
    return { title: 'a cypress', cells: [t, [t[0] + 1, i, j]], readings: [{ label: 'a cypress', op: null }], at: 0, remove: { cut: [t], why: 'take' }, stone: [] };
  }
  if (w.stone(k, i, j)) {
    const aw = w.archway(k, i, j), laid = w.laidBy(k, i, j);
    const block: Reading = { label: 'a block', op: { cut: [c], add: [[k, i, j, now]], why: 'reading' } };
    const thin: Reading = { label: 'a thin wall', op: { walls: [[k, i, j, Math.max(0, w.wall(k, i, j) >= 0 ? w.wall(k, i, j) : (view + 1) % 2), now]], why: 'reading' } };
    const arch = (a: number): Reading => ({ label: a === 0 ? 'an arch, east to west' : 'an arch, north to south', op: { arches: [[k, i, j, a, now]], why: 'reading' } });
    const stair: Reading = { label: 'a stair', op: { stairs: [[k, i, j, (view + 2) % 4, now]], why: 'reading' } };
    const tw = w.wall(k, i, j);
    const readings = aw >= 0 ? [arch(aw), arch(1 - aw), block, thin, stair] : tw >= 0 ? [thin, block, arch(view % 2), stair] : [block, thin, arch(view % 2), arch(1 - (view % 2)), stair];
    readings[0].op = null;
    const who = laid ? 'stone a connection laid' : 'stone you laid';
    return { title: aw >= 0 ? `an arch, ${who}` : tw >= 0 ? `a thin wall, ${who}` : who, cells: [c], readings, at: 0, remove: { cut: [c], why: 'take' }, stone: [c] };
  }
  return null;
}

export function selectMotif(w: World, m: Motif, now: number): Selection {
  const base = { title: m.label, cells: m.cells, motif: m, stone: m.cells.filter((c) => w.stone(...c) || w.pier(...c) || w.stair(...c) >= 0), remove: m.hand.length ? { cut: m.hand, why: 'take' } as Op : null };
  // (an arcade's stone over its piers, filled with the rest if it's read solid)
  if (m.kind === 'arcade' || m.kind === 'bridge') return { ...base, ...arches(w, m.spans, now, m.cells.filter((c) => c[0] === m.spans[0].k && !w.span(...c))) };
  if (m.kind === 'wall') {
    // (its foot as an arcade: a way through each cell of it, across it)
    const foot = m.cells.filter((c) => c[0] === 0), a = foot.length > 1 && foot[0][1] === foot[1][1] ? 0 : 1;
    const arched = foot.every((c) => w.archway(...c) >= 0), thin = m.hand.every((c) => w.wall(...c) >= 0);
    const stoneOf = m.hand.filter((c) => w.stone(...c));
    const readings: Reading[] = [
      { label: 'a wall', op: { cut: stoneOf, add: stoneOf.map(([k, i, j]) => [k, i, j, now] as [number, number, number, number]), why: 'reading' } },
      { label: 'a thin wall', op: { walls: stoneOf.map(([k, i, j]) => [k, i, j, 1 - a, now] as [number, number, number, number, number]), why: 'reading' } },
      { label: 'an arcaded wall', op: { arches: foot.map(([k, i, j]) => [k, i, j, a, now] as [number, number, number, number, number]), why: 'reading' } },
    ];
    const at = arched ? 2 : thin ? 1 : 0;
    readings[at].op = null;
    return { ...base, readings, at };
  }
  return { ...base, readings: [{ label: m.label, op: null }], at: 0, remove: m.kind === 'court' || m.kind === 'terrace' ? null : base.remove };
}

/** everything joined to a cell, stone to stone (piers and stairs too): the whole structure it's part of */
export function selectStructure(w: World, c: Cell): Selection | null {
  const part = (k: number, i: number, j: number) => w.occupied(k, i, j);
  if (!part(...c)) return null;
  const seen = new Set([c.join('.')]), cells: Cell[] = [c], st: Cell[] = [c];
  while (st.length) {
    const [k, i, j] = st.pop()!;
    for (const [a, b, d] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const n: Cell = [k + d, i + a, j + b], id = n.join('.');
      if (!seen.has(id) && part(...n)) { seen.add(id); cells.push(n); st.push(n); }
    }
  }
  const hand = cells.filter((q) => w.stone(...q) || w.stair(...q) >= 0);
  return { title: `a structure of ${hand.length} stone${hand.length === 1 ? '' : 's'}, all joined`, cells, readings: [{ label: 'as built', op: null }], at: 0, remove: hand.length ? { cut: hand, why: 'take' } : null, stone: cells.filter((q) => w.stone(...q) || w.pier(...q)) };
}

// An atlas of encounters (node cells/lab/devtools/labyrinth-atlas.mjs): a pairing of forms (a wall and a stair, to begin
// with), set up in each of the ways they can meet, and a third thing added to some; each made by the production
// reading of a stroke (gesture.ts `stroke`: no intent in hand), and what came of it recorded and classed:
//   adapts    one of them changed for the other: the wall opened, thickened, became walked or a screen; the flight
//             carried by the wall, folded, turned, passed through it
//   attaches  something was laid, but beside the other, neither changed
//   refused   nothing laid
// What each case would be at its best (from the encounters exercise and Astra's notes) is written beside it, so the
// gaps are plain.   --render (devtools/out/atlas/*.png)   --only=NAME   --json
import './labyrinth-node.mjs';
const { World, DIRS, key, unkey, PLANT } = await import('../client/labyrinth/model.ts');
const G = await import('../client/labyrinth/gesture.ts');
const NAV = await import('../client/labyrinth/nav.ts');
const BU = await import('../client/labyrinth/buildings.ts');
const ME = await import('../client/labyrinth/mesh.ts');

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));

/** the setting's pieces, laid directly (the setting isn't what's being read; the stroke is) */
const S = {
  wall: (w, i0, i1, j, h, born = 0) => { const add = []; for (let i = i0; i <= i1; i++) for (let k = 0; k < h; k++) add.push([w.ground(i, j) + k, i, j, born]); w.apply({ add, born, why: 'wall' }); },
  thin: (w, i0, i1, j, h, born = 0) => { const walls = []; for (let i = i0; i <= i1; i++) for (let k = 0; k < h; k++) walls.push([k, i, j, 0, born]); w.apply({ walls, born, why: 'thin wall' }); },
  block: (w, i0, i1, j0, j1, h, born = 0) => { const add = []; for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (let k = 0; k < h; k++) add.push([k, i, j, born]); w.apply({ add, born, why: 'raise' }); },
  steps: (w, cells, born = 0) => { const add = []; for (const [i, j, h] of cells) for (let k = 0; k < h; k++) add.push([k, i, j, born]); w.apply({ add, born, why: 'raise' }); },
  tree: (w, i, j, kind = PLANT.olive) => w.apply({ plants: [[w.ground(i, j), i, j, kind, 0]], born: 0, why: 'plant' }),
  pools: (w, cells) => w.apply({ pools: cells.map(([i, j]) => [i, j, 0]), born: 0, why: 'pool' }),
};
const pick = (w, [i, j]) => { const t = w.topFrom(w.ground(i, j) - 1, i, j); return w.stone(t - 1, i, j) ? { face: 'top', hit: [t - 1, i, j], to: [t, i, j] } : { face: 'ground', hit: [w.ground(i, j) - 1, i, j], to: [w.ground(i, j), i, j] }; };
/** a stroke through points (cells), ending on what's under the last if `onto`, read as the app reads it */
function stroke(w, pts, onto = true) {
  const path = G.connect(pts), end = onto ? pick(w, pts[pts.length - 1]) : null;
  return G.stroke(w, pick(w, pts[0]), path, end && end.face === 'top' ? end : null, () => 1, 1, []);
}

/**
 * The cases: a name, the setting, the stroke, and what it would be at its best. `wall` names the cells of the wall
 * (or walls) the stair meets, to see whether they changed.
 */
export const CASES = [
  {
    name: 'beside: a stair up beside a wall to a terrace past its end',
    best: 'cantilevered steps, hung from the wall; the wall the stair\'s spine',
    set(w) { S.wall(w, 3, 8, 5, 3); S.block(w, 9, 10, 3, 4, 3); },
    pts: [[2, 4], [9, 4]],
  },
  {
    name: 'across: a stair up across a wall to a terrace beyond it',
    best: 'an ascending passage: the stair cuts through the wall, the wall arched over it',
    set(w) { S.wall(w, 2, 10, 5, 4); S.block(w, 5, 7, 7, 8, 2); },
    pts: [[6, 2], [6, 7]],
  },
  {
    name: 'fold: a stair folding back against a wall, up to a terrace',
    best: 'two flights and a shared landing against the wall; a door in the wall at the landing',
    set(w) { S.wall(w, 2, 10, 5, 3); S.block(w, 2, 3, 2, 3, 3); },
    pts: [[4, 4], [9, 4], [9, 3], [4, 3], [3, 3]],
  },
  {
    name: 'thick: a stair up a wall two cells thick, to its top',
    best: 'the stair contained in the wall\'s thickness, entered by a door at its foot, out on the top',
    set(w) { S.block(w, 2, 10, 5, 6, 3); },
    pts: [[1, 5], [9, 5]],
  },
  {
    name: 'thin: a stair beside a thin wall, up to a terrace',
    best: 'the thin wall a screen (a jali) beside an exposed stair',
    set(w) { S.thin(w, 3, 8, 5, 3); S.block(w, 9, 10, 3, 4, 3); },
    pts: [[2, 4], [9, 4]],
  },
  {
    name: 'top: a stair up to a long wall\'s top',
    best: 'the wall becomes a promenade: walked along its top, railed, the stair arriving at its end or middle',
    set(w) { S.wall(w, 2, 10, 5, 2); },
    pts: [[3, 3], [6, 3], [6, 5]],
  },
  {
    name: 'spine: a stroke along a wall that steps up, from its low end to its high',
    best: 'a stepped spine: the wall\'s top a stair, inhabited, each step a landing',
    set(w) { S.steps(w, [[3, 5, 1], [4, 5, 1], [5, 5, 2], [6, 5, 2], [7, 5, 3], [8, 5, 3], [9, 5, 4]]); },
    pts: [[3, 5], [9, 5]],
  },
  {
    name: 'cut: a stroke from the ground along a wall\'s length, up to its top at the far end',
    best: 'steps cut into the wall, climbing inside its thickness, the wall over them kept; out on its top',
    set(w) { S.wall(w, 3, 10, 5, 3); },
    pts: [[2, 5], [9, 5]],
  },
  {
    name: 'water: a stair beside a wall with pools at its foot',
    best: 'a dry stair and a cascade sharing the wall that retains them',
    set(w) { S.wall(w, 3, 8, 5, 3); S.block(w, 9, 10, 3, 4, 3); S.pools(w, [[4, 3], [5, 3], [6, 3], [7, 3]]); },
    pts: [[2, 4], [9, 4]],
  },
  // (a third thing)
  {
    name: 'beside + tree: a stair up beside a wall, an olive in its way',
    best: 'the stair yields round the tree (a landing that bows round it), or the tree in a pit the stair passes',
    set(w) { S.wall(w, 3, 8, 5, 3); S.block(w, 9, 10, 3, 4, 3); S.tree(w, 6, 4); },
    pts: [[2, 4], [9, 4]],
  },
  {
    name: 'across + way: a stair across a wall, a way along the wall\'s far side',
    best: 'the stair passes through the wall and lands on the way: a threshold where they cross',
    set(w) { S.wall(w, 2, 10, 5, 4); S.block(w, 5, 7, 7, 8, 2); w.apply({ pave: [[2, 6], [3, 6], [4, 6], [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6]], born: 0, why: 'way' }); },
    pts: [[6, 2], [6, 7]],
  },
  {
    name: 'top + house: a stair up to a wall\'s top where the wall runs into a house',
    best: 'the wall-top promenade arrives at a door in the house\'s face',
    set(w) { S.wall(w, 2, 7, 5, 2); S.block(w, 8, 9, 4, 6, 3); },
    pts: [[3, 3], [5, 3], [5, 5]],
  },
  {
    name: 'beside + stair: a second stair beside the first, along the same wall, the other way',
    best: 'the two flights interlock: one landing shared, a switchback against the wall',
    set(w) { S.wall(w, 3, 8, 5, 3); S.block(w, 9, 10, 3, 4, 3); const op = stroke(w, [[2, 4], [9, 4]]); if (op && !op.refused) w.apply({ ...op, alts: undefined }); S.block(w, 1, 2, 2, 3, 3); },
    pts: [[8, 3], [2, 3]],
  },
];

/** whether each case came to what it would be at its best (`before`: the setting's stone) */
const stairIn = (w, before) => before.filter((c) => w.stair(...c) >= 0 || w.passage(...c) >= 0).length;
const BEST = {
  beside: (w) => w.flights.some((f) => f.carriage === 'hung'),
  across: (w, before) => before.some((c) => w.archway(...c) >= 0 || w.stair(...c) >= 0),
  fold: (w) => w.flights.length >= 2,
  thick: (w, before) => stairIn(w, before) >= 2,
  thin: (w) => [...w.thin.keys()].some((v) => w.dress.get(v)?.screen),
  top: (w, before) => { const { edges } = ME.parapets(w); return before.filter((c) => (edges.get(key(...c)) ?? []).some(Boolean)).length >= 4; },
  spine: (w) => NAV.reaches(BU.walkable(w), [1, 3, 5], [4, 9, 5]) && w.flights.every((f) => f.cells.every(([, i, j]) => j === 5)),
  cut: (w, before) => stairIn(w, before) >= 2,
  water: (w) => [...w.basins.keys()].length >= 2,
  'beside + tree': (w) => [...w.trees.keys()].length === 1 && w.flights.length >= 1,
  'across + way': (w, before) => before.some((c) => w.archway(...c) >= 0 || w.stair(...c) >= 0),
  'top + house': (w) => BU.buildings(w).list.some((b) => b.openings.some((o) => o.kind === 'door' && o.k > 0)),
  'beside + stair': (w) => { const nav = BU.walkable(w), [f, g] = w.flights; if (!f || !g) return false; const hk = (x) => x.cells[x.cells.length - 1]; return NAV.reaches(nav, hk(f), g.cells[0]) && Math.abs(hk(f)[1] - g.cells[0][1]) + Math.abs(hk(f)[2] - g.cells[0][2]) <= 3; },
};
/** what a world is, to compare before and after: each wall cell's state, the walked places, the flights */
function state(w, cells) {
  const nav = BU.walkable(w);
  return {
    cells: new Map(cells.map((c) => [key(...c), JSON.stringify([w.stone(...c), w.wall(...c), w.archway(...c), w.dress.get(key(...c)) ?? null, w.stair(...c)])])),
    tops: new Set(cells.filter(([k, i, j]) => nav.places.has(key(k + 1, i, j))).map((c) => key(...c))),
    flights: w.flights.map((f) => ({ n: f.cells.length, carriage: f.carriage, wall: f.wall, d: f.d })),
  };
}
const results = [];
for (const C of CASES) {
  if (opt.only && !C.name.includes(opt.only)) continue;
  const w = new World(1);
  C.set(w);
  // (the wall: the stone the setting laid, before the stroke)
  const before = [...w.mass.keys()].map(unkey), s0 = state(w, before), f0 = w.flights.length;
  const op = stroke(w, C.pts), refused = !op || 'refused' in op;
  if (!refused) w.apply({ ...op, alts: undefined }, 1);
  const s1 = state(w, before);
  const changed = before.filter((c) => s0.cells.get(key(...c)) !== s1.cells.get(key(...c)));
  const walkedTop = [...s1.tops].filter((v) => !s0.tops.has(v));
  const flights = s1.flights.slice(f0), hung = flights.filter((f) => f.carriage === 'hung' || f.wall >= 0);
  const how = [];
  if (changed.length) how.push(`the wall changed in ${changed.length} cell${changed.length > 1 ? 's' : ''} (${[...new Set(changed.map((c) => (w.archway(...c) >= 0 ? 'arched' : !w.stone(...c) ? 'cut' : w.stair(...c) >= 0 ? 'a stair' : 'dressed')))].join(', ')})`);
  if (walkedTop.length) how.push(`its top walked (${walkedTop.length} cell${walkedTop.length > 1 ? 's' : ''})`);
  if (hung.length) how.push('a flight hung from it');
  if (flights.length > 1) how.push(`${flights.length} flights`);
  const verdict = refused ? 'refused' : how.length ? 'adapts' : 'attaches';
  const met = !refused && !!BEST[C.name.split(':')[0]]?.(w, before);
  results.push({ name: C.name, best: C.best, verdict, met, reading: refused ? op?.refused ?? 'nothing' : op.reading ?? op.note ?? op.why, how: how.join('; '), alts: refused ? (op?.alts ?? []).map((a) => a.label) : (op.alts ?? []).map((a) => a.label), flights: flights.map((f) => `${f.n} steps, ${f.carriage}`), ops: w.encode() });
}
const pad = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
for (const r of results) console.log(`${r.met ? '✓' : '·'} ${pad(r.verdict, 9)} ${pad(r.name.split(':')[0], 16)} ${r.reading}${r.how ? ` — ${r.how}` : ''}\n${' '.repeat(27)}best: ${r.best}${r.alts.length ? `\n${' '.repeat(27)}also: ${r.alts.join(' · ')}` : ''}`);
const tally = results.reduce((t, r) => ((t[r.verdict] = (t[r.verdict] ?? 0) + 1), t), {});
console.log(`\n${results.length} cases: ${Object.entries(tally).map(([k, n]) => `${n} ${k}`).join(', ')}; ${results.filter((r) => r.met).length} come to what they'd be at their best`);
if (opt.json) (await import('node:fs')).writeFileSync(opt.json, JSON.stringify(results.map(({ ops, ...r }) => r), null, 1));
if (opt.render) {
  process.env.EXPERIMENT = 'labyrinth'; process.env.READY = '__labyrinth';
  const { withWood } = await import('./harness.mjs'), { mkdirSync } = await import('node:fs');
  const dir = new URL('./out/atlas/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  await withWood(async (lab) => {
    for (const [n, r] of results.entries()) {
      const p = await lab.open(`instant&cats=0&zoom=${opt.zoom ?? 0.42}&turn=${opt.turn ?? 1}&el=0.62&at=6.5&ops=${encodeURIComponent(r.ops)}`);
      await p.waitForTimeout(8000);
      const file = new URL(`${String(n + 1).padStart(2, '0')}-${r.name.split(':')[0].replace(/[^a-z]+/gi, '-')}.png`, dir).pathname;
      await p.screenshot({ path: file, timeout: 300000 });
      console.log(`drawn: ${file}`);
      await p.close();
    }
  }, { width: 600, height: 600 });
}

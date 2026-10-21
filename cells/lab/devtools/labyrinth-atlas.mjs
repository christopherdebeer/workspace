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
const { World, DIRS, key, unkey, PLANT, replay } = await import('../client/labyrinth/model.ts');
const G = await import('../client/labyrinth/gesture.ts');
const NAV = await import('../client/labyrinth/nav.ts');
const BU = await import('../client/labyrinth/buildings.ts');
const ME = await import('../client/labyrinth/mesh.ts');
const CH = await import('../client/labyrinth/character.ts');
const P = await import('../client/labyrinth/palette.ts');
const look = (w, k, i, j) => CH.look(w, k, i, j);

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
    best: 'the stair contained in its thickness (two deep, it\'s a house): in at a door at its foot, up inside, out on its top',
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
    set(w) { S.steps(w, [[3, 5, 1], [4, 5, 1], [5, 5, 2], [6, 5, 2], [7, 5, 3], [8, 5, 3], [9, 5, 3]]); },
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
    set(w) { S.wall(w, 3, 8, 5, 3); S.block(w, 9, 10, 3, 4, 3); S.pools(w, [[4, 3], [5, 3]]); },
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
    name: 'beside + stair: a stair up beside a wall to a low terrace, then from it a second back the other way, higher',
    best: 'the two flights interlock: the terrace their shared landing, a switchback against the wall',
    set(w) { S.wall(w, 3, 8, 5, 4); S.block(w, 9, 10, 3, 4, 2); w.apply({ dress: [[1, 9, 3], [1, 10, 3], [1, 9, 4], [1, 10, 4]].map((c) => [...c, 5, 1]), born: 0, why: 'dress' }); const op = stroke(w, [[2, 4], [9, 4]]); if (op && !op.refused) w.apply({ ...op, alts: undefined }); S.block(w, 1, 2, 2, 3, 4); },
    pts: [[9, 3], [2, 3]],
  },
].map((c) => ({ group: 'wall-stair', ...c }));

/** taps, each read as the app reads one (no intent in hand) and laid; the last one's reading returned */
function taps(w, cells) { let last = null; for (const c of cells) { const op = G.touch(w, pick(w, c), 1); if (op && !('refused' in op)) { w.apply({ ...op, alts: undefined }, 1); last = op; } } return last && { ...last, laid: true }; }
/** the cells of a block from i0..i1, j0..j1 but the one at (ci, cj), each tapped `h` times (a course a tap) */
const ringOf = (i0, i1, j0, j1, ci, cj, h) => Array.from({ length: h }, () => { const c = []; for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (i !== ci || j !== cj) c.push([i, j]); return c; }).flat();
/** a stroke from a place one goes from (paving laid there first, so it's read as a way) */
const fromPlace = (w, pts) => { w.apply({ pave: [pts[0]], born: 0, why: 'way' }); return stroke(w, pts); };

/**
 * Yield: what gives way to what. A tree, a well (a pool), a railed edge, met by a wall, a way, a stair, a terrace, a
 * house: at their best the one gives way round the other (notched, bowed, stepped back, wrapped), the other kept.
 */
CASES.push(...[
  {
    name: 'wall × tree: a wall drawn straight through an olive',
    best: 'the wall bows round the tree, a cell out and back, the tree kept',
    set(w) { S.tree(w, 6, 5); },
    pts: [[2, 5], [10, 5]],
  },
  {
    name: 'way × tree: a way drawn straight through an olive',
    best: 'the way bows round it (or opens into a ring round it), the tree kept',
    set(w) { S.tree(w, 6, 5); },
    act: (w) => fromPlace(w, [[2, 5], [10, 5]]),
  },
  {
    name: 'stair × tree: a stair up to a terrace, an olive on its line',
    best: 'the flight yields: steps round the tree, or the tree in a pit beside a landing',
    set(w) { S.block(w, 9, 10, 4, 6, 2); S.tree(w, 5, 5); },
    pts: [[2, 5], [9, 5]],
  },
  {
    name: 'terrace × tree: a terrace tapped up round an olive',
    best: 'the terrace notched round the trunk: a pit, the tree growing up through it',
    set(w) { S.tree(w, 6, 6); },
    act: (w) => taps(w, [[5, 5], [6, 5], [7, 5], [5, 6], [7, 6], [5, 7], [6, 7], [7, 7], [6, 6]]),
  },
  {
    name: 'house × tree: a house raised round an olive',
    best: 'the house wraps the tree: a court open to the sky in the middle of it, the tree in it',
    set(w) { S.tree(w, 6, 6); },
    act: (w) => taps(w, ringOf(4, 8, 4, 8, 6, 6, 2)),
  },
  {
    name: 'wall × well: a wall drawn straight across a pool',
    best: 'the wall carried over the water on an arch (a water gate), or bowed round it',
    set(w) { S.pools(w, [[6, 5]]); },
    pts: [[2, 5], [10, 5]],
  },
  {
    name: 'house × well: a house raised round a pool',
    best: 'the house wraps the well: a court with the well in it',
    set(w) { S.pools(w, [[6, 6]]); },
    act: (w) => taps(w, ringOf(4, 8, 4, 8, 6, 6, 2)),
  },
  {
    name: 'rail × arrival: a way up on to the edge of a railed terrace',
    best: 'the rail opens where the way arrives, and runs on round the rest',
    set(w) { S.block(w, 6, 9, 4, 7, 2); w.apply({ dress: [6, 7, 8, 9].flatMap((i) => [4, 5, 6, 7].map((j) => [1, i, j, 5, 1])), born: 0, why: 'dress' }); },
    pts: [[1, 5], [6, 5]],
  },
  {
    name: 'wall × tree × way: a wall through an olive, then a way across the wall beside it',
    best: 'the wall bows round the tree and opens a gate for the way beside it',
    set(w) { S.tree(w, 6, 5); const op = stroke(w, [[2, 5], [10, 5]]); if (op && !op.refused) w.apply({ ...op, alts: undefined }); },
    act: (w) => fromPlace(w, [[7, 2], [7, 9]]),
  },
].map((c) => ({ group: 'yield', ...c })));

/** taps on the sides of stone ([k, i, j] struck, [i, j] the cell before it), each read and laid */
function sides(w, list) { let last = null; for (const [k, i, j, x, z] of list) { const op = G.touch(w, { face: 'side', hit: [k, i, j], to: [k, x, z] }, 1); if (op && !('refused' in op)) { w.apply({ ...op, alts: undefined }, 1); last = op; } } return last && { ...last, laid: true }; }
/** a ring of wall round i0..i1, j0..j1 (a court's), `h` high */
const ring = (w, i0, i1, j0, j1, h) => { const add = []; for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (i === i0 || i === i1 || j === j0 || j === j1) for (let k = 0; k < h; k++) add.push([k, i, j, 0]); w.apply({ add, born: 0, why: 'wall' }); };
/**
 * Reactions: pairings that call on several capabilities at once (penetrate, accompany, exchange roles, interlock,
 * develop).
 */
CASES.push(...[
  {
    name: 'court × way: a way drawn straight across a walled court',
    best: 'a gate where it goes in, across the court, a gate where it comes out: thresholds',
    set(w) { ring(w, 4, 8, 4, 8, 2); },
    act: (w) => fromPlace(w, [[6, 1], [6, 11]]),
  },
  {
    name: 'tower × bridge: a walkway from a terrace through a tower to another',
    best: 'the walkway passes through the tower: a passage through it at that height, the tower over it',
    set(w) { S.block(w, 2, 3, 5, 6, 2); S.block(w, 6, 6, 5, 5, 5); S.block(w, 9, 10, 5, 6, 2); },
    pts: [[3, 5], [9, 5]],
  },
  {
    name: 'roof × stair: a stair up on to a roofed house',
    best: 'the roof gives way where the stair arrives: a terrace there, the roof kept over the rest',
    set(w) { S.block(w, 6, 9, 4, 7, 2); },
    pts: [[2, 5], [6, 5]],
  },
  {
    name: 'alongside: a way drawn along the inside of a court\'s wall',
    best: 'it accompanies the wall: a gallery along it (a pergola, a loggia), the court\'s middle kept open',
    set(w) { ring(w, 3, 9, 3, 9, 2); w.apply({ pave: [[4, 4]], born: 0, why: 'way' }); },
    pts: [[4, 4], [8, 4]],
  },
  {
    name: 'bridge × bridge: two walkways crossing at one height',
    best: 'they share the crossing: one deck where they meet, the walk on each way from it',
    set(w) { S.block(w, 1, 2, 5, 5, 2); S.block(w, 10, 11, 5, 5, 2); S.block(w, 6, 6, 1, 2, 2); S.block(w, 6, 6, 9, 10, 2); const op = stroke(w, [[2, 5], [10, 5]]); if (op && !op.refused) w.apply({ ...op, alts: undefined }); },
    pts: [[6, 2], [6, 9]],
  },
  {
    name: 'retrace: a wall drawn, then drawn along again',
    best: 'drawn again it develops: a course higher (again: higher still, or arcaded)',
    set(w) { const op = stroke(w, [[2, 5], [10, 5]]); if (op && !op.refused) w.apply({ ...op, alts: undefined }); },
    pts: [[2, 5], [10, 5]],
  },
].map((c) => ({ group: 'reactions', ...c })));

/** a stroke read and laid, the kind of wall it makes chosen by label if `kind` (an alt's label) */
const lay = (w, pts, kind) => { let op = stroke(w, pts); if (op && kind) op = op.note?.startsWith(kind) ? op : (op.alts ?? []).find((a) => a.label === kind)?.op ?? op; if (op && !op.refused) w.apply({ ...op, alts: undefined }); return op; };
/** a piece in hand, put where it's touched */
const put = (w, hand, c) => { const op = P.place(w, hand, pick(w, c), 0, 1); if (op) w.apply(op, 1); return op && { ...op, laid: true }; };
/**
 * Combinations: an arcade met, water with a terrace, and the reactions above with a third thing.
 */
CASES.push(...[
  {
    name: 'arcade on: a wall drawn on from the end of an arcade',
    best: 'the arcade goes on, its rhythm kept across the join (no two arches side by side, no gap in the beat)',
    set(w) { lay(w, [[1, 5], [6, 5]], 'an arcaded wall'); },
    pts: [[7, 5], [11, 5]],
  },
  {
    name: 'arcade × wall: a wall drawn up to the middle of an arcade',
    best: 'it lands on a pier: the bay it meets made solid, the arches either side kept',
    set(w) { lay(w, [[1, 5], [11, 5]], 'an arcaded wall'); },
    pts: [[6, 10], [6, 6]],
  },
  {
    name: 'water × terrace: a basin let into a terrace at its edge, a pool below',
    best: 'the basin spills over the edge into the pool: water with levels',
    set(w) { S.block(w, 6, 9, 4, 7, 2); S.pools(w, [[5, 5], [4, 5], [5, 6], [4, 6]]); },
    act: (w) => put(w, 'pool', [6, 5]),
  },
  {
    name: 'terrace × water: a terrace drawn out over a pool',
    best: 'the terrace stands out over the water on arches, the pool kept under it',
    set(w) { S.block(w, 7, 9, 4, 7, 2); S.pools(w, [[5, 5], [4, 5], [5, 6], [4, 6], [6, 5], [6, 6]]); },
    act: (w) => sides(w, [[1, 7, 5, 6, 5], [1, 7, 6, 6, 6], [1, 6, 5, 5, 5], [1, 6, 6, 5, 6]]),
  },
  {
    name: 'court × way × tree: a way across a walled court, an olive in its middle',
    best: 'gates in and out, the way bowing round the tree in the court',
    set(w) { ring(w, 4, 8, 4, 8, 2); S.tree(w, 6, 6); },
    act: (w) => fromPlace(w, [[6, 1], [6, 11]]),
  },
  {
    name: 'court × way × way: a second way across a court, crossing the first',
    best: 'four gates, the two ways crossing in the court\'s middle',
    set(w) { ring(w, 4, 8, 4, 8, 2); const op = fromPlace(w, [[6, 1], [6, 11]]); if (op && !op.refused) w.apply({ ...op, alts: undefined }); },
    act: (w) => fromPlace(w, [[1, 6], [11, 6]]),
  },
  {
    name: 'tower × bridge × bridge: two walkways through one tower, crossing in it',
    best: 'both pass through the tower, crossing inside it under a cross vault',
    set(w) { S.block(w, 6, 6, 6, 6, 5); S.block(w, 2, 3, 6, 6, 2); S.block(w, 9, 10, 6, 6, 2); S.block(w, 6, 6, 2, 3, 2); S.block(w, 6, 6, 9, 10, 2); const op = stroke(w, [[3, 6], [9, 6]]); if (op && !op.refused) w.apply({ ...op, alts: undefined }); },
    pts: [[6, 3], [6, 9]],
  },
  {
    name: 'roof × stair × wall: a stair beside a wall, up on to a roofed house',
    best: 'hung from the wall, arriving on a terrace let into the roof',
    set(w) { S.wall(w, 1, 5, 4, 3); S.block(w, 6, 9, 4, 7, 2); },
    pts: [[2, 5], [6, 5]],
  },
  {
    name: 'alongside × tree: a way along the inside of a court\'s wall, an olive on its line',
    best: 'a gallery along the wall, giving way round the tree',
    set(w) { ring(w, 2, 10, 2, 10, 2); w.apply({ pave: [[3, 3]], born: 0, why: 'way' }); S.tree(w, 6, 3); },
    pts: [[3, 3], [9, 3]],
  },
].map((c) => ({ group: 'combinations', ...c })));

/** a top railed all round (so it's a terrace, walked, not a house's roof) */
const railed = (w, i0, i1, j0, j1, k) => { const dress = []; for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) dress.push([k, i, j, 5, 1]); w.apply({ dress, born: 0, why: 'dress' }); };
/** a plant put where it's touched, by hand */
const plant = (w, kind, [i, j]) => { const op = { plants: [[w.ground(i, j), i, j, kind, 1]], born: 1, why: 'plant' }; w.apply(op, 1); return { ...op, laid: true, note: 'planted' }; };
/**
 * Reshape: the hand's outline changed in place where it meets something: cut back round a tree's crown (a terrace
 * notched, a roof cut back, a tower stepped back), reaching round a cypress, set back where a way arrives. And which
 * answer, by what came first.
 */
CASES.push(...[
  {
    name: 'terrace × olive: a terrace laid up to an olive at its edge',
    best: 'notched round the crown, open to the sky, the lower course kept as a ledge at its foot',
    set(w) { S.tree(w, 6, 5); },
    act: (w) => { S.block(w, 4, 8, 5, 7, 2); railed(w, 4, 8, 5, 7, 1); return { laid: true, note: 'a terrace laid round it' }; },
  },
  {
    name: 'roof × olive: a house raised against an olive',
    best: 'its roof cut back round the crown, the plan notched, the roof winged round the notch',
    set(w) { S.tree(w, 6, 5); },
    act: (w) => { S.block(w, 4, 8, 5, 8, 3); return { laid: true, note: 'a house raised against it' }; },
  },
  {
    name: 'tower × pine: a tower raised beside a stone pine',
    best: 'the tower stepped back where the pine spreads at its height, full below',
    set(w) { S.tree(w, 6, 5, PLANT.pine); },
    act: (w) => { S.block(w, 5, 7, 6, 7, 5); return { laid: true, note: 'a tower raised beside it' }; },
  },
  {
    name: 'terrace × cypress: a cypress planted at the foot of a terrace\'s edge',
    best: 'the edge reaches round it, a bay for it, carried on corbels, the rail following round',
    set(w) { S.block(w, 4, 8, 6, 8, 3); railed(w, 4, 8, 6, 8, 2); },
    act: (w) => plant(w, PLANT.cypress, [6, 5]),
  },
  {
    name: 'way × house: a way drawn up to a house\'s face',
    best: 'the door set back under an arch, a porch, the way running into it',
    set(w) { S.block(w, 4, 8, 5, 8, 2); },
    act: (w) => fromPlace(w, [[6, 1], [6, 4]]),
  },
  {
    name: 'olive × terrace: an olive planted at the edge of a terrace already there',
    best: 'the terrace kept (it was there first), the crown pruned round it',
    set(w) { S.block(w, 4, 8, 5, 7, 2); railed(w, 4, 8, 5, 7, 1); },
    act: (w) => plant(w, PLANT.olive, [6, 4]),
  },
].map((c) => ({ group: 'reshape', ...c })));

/** a terrace two deep beside step `s` of the first flight, on its left, level with that step's top */
const besideStep = (w, s = 1) => { const f = w.flights[0]; if (!f) return; const [k, i, j] = f.cells[s], [sa, sb] = DIRS[(f.d + 1) % 4], [a, b] = DIRS[f.d], add = []; for (const u of [-1, 0, 1]) for (const t of [1, 2]) { const x = i + sa * t + a * u, z = j + sb * t + b * u; for (let q = w.ground(x, z); q <= k; q++) add.push([q, x, z, 0]); } w.apply({ add, born: 1, why: 'raise' }, 1); w.apply({ dress: add.filter(([q, x, z]) => q === k).map(([q, x, z]) => [q, x, z, 5, 1]), born: 1, why: 'dress' }, 1); };
/**
 * Junctions: where two things meet, the piece they share rebuilt as one: a landing let into a flight level with a
 * terrace (whichever came first), two stairs as one broad flight, a stair and a cascade one mass.
 */
CASES.push(...[
  {
    name: 'flight × terrace: a terrace laid beside a flight, level with a step',
    best: 'a landing let into the flight level with the terrace, its lower steps moved back: one shared landing, the flight going on up from it',
    set(w) { S.block(w, 9, 10, 4, 5, 4); lay(w, [[3, 4], [9, 4]]); },
    act: (w) => { besideStep(w, 1); return { laid: true, note: 'a terrace laid beside it' }; },
  },
  {
    name: 'terrace × flight: a flight drawn up past a terrace beside its line',
    best: 'the same: the landing let in where it passes the terrace, whichever was there first',
    set(w) { S.block(w, 9, 10, 4, 5, 4); S.block(w, 6, 8, 2, 3, 2); railed(w, 6, 8, 2, 3, 1); },
    pts: [[3, 4], [9, 4]],
  },
  {
    name: 'broaden: a second stair drawn beside the first, to the same top',
    best: 'one broad flight, drawn as one: one carriage, rails only at its outer sides',
    set(w) { S.block(w, 9, 10, 4, 5, 3); lay(w, [[2, 4], [9, 4]]); },
    pts: [[4, 5], [9, 5]],
  },
  {
    name: 'stair × cascade: a stair up beside a wall, a pool at its foot',
    best: 'the stair and the cascade one mass, built up solid together, the water let in beside the steps',
    set(w) { S.wall(w, 3, 8, 6, 3); S.block(w, 9, 10, 4, 5, 3); S.pools(w, [[4, 5], [5, 5]]); },
    pts: [[2, 4], [9, 4]],
  },
].map((c) => ({ group: 'junctions', turn: 2, ...c })));

/** whether each case came to what it would be at its best (`before`: the setting's stone) */
const stairIn = (w, before) => before.filter((c) => w.stair(...c) >= 0 || w.passage(...c) >= 0).length;
const BEST = {
  beside: (w) => w.flights.some((f) => f.carriage === 'hung'),
  across: (w, before) => before.some((c) => w.archway(...c) >= 0 || w.stair(...c) >= 0),
  fold: (w) => w.flights.length >= 2,
  thick: (w) => BU.buildings(w).list.some((b) => b.inside && b.walked && b.openings.some((o) => o.kind === 'door' && o.k === b.base[0])),
  thin: (w) => [...w.thin.keys()].filter((v) => CH.look(w, ...unkey(v))?.screen).length >= 2 && w.flights.every((f) => f.carriage !== 'hung'),
  top: (w, before) => { const { edges } = ME.parapets(w); return before.filter((c) => (edges.get(key(...c)) ?? []).some(Boolean)).length >= 4; },
  spine: (w) => NAV.reaches(BU.walkable(w), [1, 3, 5], [3, 9, 5]) && w.flights.length > 0 && w.flights.every((f) => f.cells.every(([, i, j]) => j === 5)),
  cut: (w, before) => stairIn(w, before) >= 2,
  water: (w) => [...w.basins.keys()].length >= 2,
  'beside + tree': (w) => [...w.trees.keys()].length === 1 && w.flights.length >= 1,
  'across + way': (w, before) => before.some((c) => w.archway(...c) >= 0 || w.stair(...c) >= 0),
  'top + house': (w) => BU.buildings(w).list.some((b) => b.openings.some((o) => o.kind === 'door' && o.k > 0)),
  'wall × tree': (w) => w.plant(0, 6, 5) >= 0 && (w.stone(0, 6, 4) || w.stone(0, 6, 6)) && w.stone(0, 5, 5) && w.stone(0, 7, 5),
  'way × tree': (w) => w.plant(0, 6, 5) >= 0 && [...w.walks.values()].some((cs) => cs.some(([, i]) => i >= 9)),
  'stair × tree': (w) => w.plant(0, 5, 5) >= 0 && w.flights.length > 0 && [...w.reached.values()].some((r) => r.reached),
  'terrace × tree': (w) => w.plant(0, 6, 6) >= 0 && !w.stone(0, 6, 6) && w.stone(0, 5, 6) && w.stone(0, 7, 6),
  'house × tree': (w) => w.plant(0, 6, 6) >= 0 && BU.buildings(w).list.some((b) => b.cols.length >= 6) && !w.stone(1, 6, 6),
  'wall × well': (w) => w.pool(6, 5) && (!!w.span(0, 6, 5) || w.stone(0, 6, 4) || w.stone(0, 6, 6)) && w.stone(0, 5, 5) && w.stone(0, 7, 5),
  'house × well': (w) => w.pool(6, 6) && BU.buildings(w).list.some((b) => b.cols.length >= 6),
  'rail × arrival': (w) => { const { edges } = ME.parapets(w); const e = edges.get(key(1, 6, 5)); const others = [[1, 6, 6], [1, 6, 7], [1, 9, 5]].filter((c) => (edges.get(key(...c)) ?? []).some(Boolean)).length; return !!e && !e[2] && others >= 2 && [...w.reached.values()].some((r) => r.reached); },
  'wall × tree × way': (w) => w.plant(0, 6, 5) >= 0 && [4, 5, 6].some((j) => [5, 6, 7, 8].some((i) => w.archway(0, i, j) >= 0)),
  'court × way': (w) => [[6, 4], [6, 8]].every(([i, j]) => w.archway(0, i, j) >= 0) && [...w.reached.values()].some((r) => r.reached),
  'tower × bridge': (w) => w.archway(2, 6, 5) >= 0 && w.stone(3, 6, 5) && NAV.reaches(BU.walkable(w), [2, 3, 5], [2, 9, 5]),
  'roof × stair': (w) => BU.buildings(w).list.some((b) => b.roof && b.terrace?.length),
  alongside: (w) => [5, 6, 7, 8].some((i) => look(w, 0, i, 4)?.pergola || w.dressed(0, i, 4)?.pergola || w.span(1, i, 4)),
  'bridge × bridge': (w) => { const nav = BU.walkable(w); return NAV.reaches(nav, [2, 2, 5], [2, 6, 9]) && NAV.reaches(nav, [2, 6, 2], [2, 10, 5]); },
  retrace: (w) => [3, 4, 5, 6, 7, 8, 9].filter((i) => w.stone(1, i, 5)).length >= 5,
  'arcade on': (w) => { const a = (i) => w.archway(0, i, 5) >= 0; const xs = [2, 3, 4, 5, 6, 7, 8, 9, 10].map(a); return [7, 8, 9, 10].filter(a).length >= 2 && xs.every((x, q) => q === 0 || !(x && xs[q - 1])) && xs.every((x, q) => q < 2 || x || xs[q - 1] || xs[q - 2]); },
  'arcade × wall': (w) => w.archway(0, 6, 5) < 0 && w.stone(0, 6, 5) && w.stone(0, 6, 7) && [2, 3, 4, 5, 7, 8, 9, 10].filter((i) => w.archway(0, i, 5) >= 0).length >= 3 && [5, 7].some((i) => w.stone(0, i, 5)),
  'water × terrace': (w) => w.falls.some((f) => f.into === 'water'),
  'terrace × water': (w) => [[5, 5], [6, 5], [5, 6], [6, 6]].filter(([i, j]) => w.pool(i, j)).length >= 3 && [[5, 5], [6, 5], [5, 6], [6, 6]].filter(([i, j]) => w.block(1, i, j) || w.block(0, i, j)).length >= 2 && [[5, 5], [6, 5], [5, 6], [6, 6]].every(([i, j]) => !w.stone(0, i, j) || w.archway(0, i, j) >= 0),
  'court × way × tree': (w) => w.plant(0, 6, 6) >= 0 && [[6, 4], [6, 8]].every(([i, j]) => w.archway(0, i, j) >= 0) && [...w.reached.values()].some((r) => r.reached),
  'court × way × way': (w) => [[6, 4], [6, 8], [4, 6], [8, 6]].every(([i, j]) => w.archway(0, i, j) >= 0),
  'tower × bridge × bridge': (w) => w.archway(2, 6, 6) >= 0 && w.stone(3, 6, 6) && w.cross(2, 6, 6) && NAV.reaches(BU.walkable(w), [2, 3, 6], [2, 9, 6]) && NAV.reaches(BU.walkable(w), [2, 6, 3], [2, 6, 9]),
  'roof × stair × wall': (w) => w.flights.some((f) => f.carriage === 'hung') && BU.buildings(w).list.some((b) => b.roof && b.terrace?.length),
  'alongside × tree': (w) => w.plant(0, 6, 3) >= 0 && [[3, 4, 5], [7, 8, 9]].every((is) => is.some((i) => look(w, 0, i, 3)?.pergola)) && [...w.reached.values()].some((r) => r.reached),
  'terrace × olive': (w) => w.plant(0, 6, 5) >= 0 && [[5, 5], [7, 5], [5, 6], [6, 6], [7, 6]].every(([i, j]) => !w.stone(1, i, j) && w.stone(0, i, j)) && w.stone(1, 4, 5) && w.stone(1, 8, 7),
  'roof × olive': (w) => w.plant(0, 6, 5) >= 0 && [[5, 5], [7, 5], [5, 6], [6, 6], [7, 6]].every(([i, j]) => !w.stone(1, i, j) && w.stone(0, i, j)) && BU.buildings(w).list.some((b) => b.roof && b.cols.length >= 10),
  'tower × pine': (w) => w.plant(0, 6, 5) >= 0 && [5, 6, 7].every((i) => !w.stone(3, i, 6) && w.stone(2, i, 6) && w.stone(4, i, 7)),
  'terrace × cypress': (w) => w.plant(0, 6, 5) >= 0 && w.stone(2, 5, 5) && w.stone(2, 7, 5) && !w.stone(1, 5, 5) && !w.stone(2, 6, 5),
  'way × house': (w) => w.archway(0, 6, 5) >= 0 && w.stone(1, 6, 5) && BU.buildings(w).list.some((b) => b.openings.some((o) => o.kind === 'door' && o.i === 6 && o.j === 6 && o.k === 0)),
  'olive × terrace': (w) => w.plant(0, 6, 4) >= 0 && [5, 6, 7].every((i) => w.stone(1, i, 5)),
  'flight × terrace': (w) => w.meetings.some((m) => m.rule === 'flight-meets-terrace' && m.laid === 1) && NAV.reaches(BU.walkable(w), [0, 3, 4], [4, 9, 4]),
  'terrace × flight': (w) => w.meetings.some((m) => m.rule === 'flight-meets-terrace' && m.laid === 1) && NAV.reaches(BU.walkable(w), [0, 3, 4], [4, 9, 4]),
  broaden: (w) => w.flights.length === 2 && w.flights[0].cells.every(([k, i, j], q) => { const [k2, i2, j2] = w.flights[1].cells[q] ?? []; return k === k2 && Math.abs(i - i2) + Math.abs(j - j2) === 1; }),
  'stair × cascade': (w) => [...w.basins.keys()].length >= 2 && w.flights.some((f) => f.cells.every(([k, i, j]) => k === w.ground(i, j) || w.stone(k - 1, i, j))),
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
  if (opt.set && C.group !== opt.set) continue;
  const w = new World(1);
  C.set(w);
  // (the wall: the stone the setting laid, before the stroke)
  const before = [...w.mass.keys()].map(unkey), s0 = state(w, before), f0 = w.flights.length;
  const m0 = new Set(w.meetings.map((m) => `${m.rule}.${key(...m.anchor)}.${m.laid}`));
  const nOps = w.ops.length, op = C.act ? C.act(w) : stroke(w, C.pts), refused = !op || 'refused' in op;
  if (!refused && !op.laid) w.apply({ ...op, alts: undefined }, 1);
  void nOps;
  const s1 = state(w, before);
  const changed = before.filter((c) => s0.cells.get(key(...c)) !== s1.cells.get(key(...c)));
  const walkedTop = [...s1.tops].filter((v) => !s0.tops.has(v));
  const flights = s1.flights.slice(f0), hung = flights.filter((f) => f.carriage === 'hung' || f.wall >= 0);
  const how = [];
  if (changed.length) how.push(`the wall changed in ${changed.length} cell${changed.length > 1 ? 's' : ''} (${[...new Set(changed.map((c) => (w.archway(...c) >= 0 ? 'arched' : JSON.parse(s0.cells.get(key(...c)))[2] >= 0 && w.stone(...c) ? 'filled' : !w.stone(...c) ? 'cut' : w.stair(...c) >= 0 ? 'a stair' : 'dressed')))].join(', ')})`);
  if (walkedTop.length) how.push(`its top walked (${walkedTop.length} cell${walkedTop.length > 1 ? 's' : ''})`);
  if (hung.length) how.push('a flight hung from it');
  if (flights.length > 1) how.push(`${flights.length} flights`);
  // (and what the meetings it made reshaped: an outline cut back, carried round, set back)
  const reacted = w.meetings.filter((m) => !m0.has(`${m.rule}.${key(...m.anchor)}.${m.laid}`) && m.laid >= 0 && Object.keys(m.candidates.find((c) => c.level === m.laid)?.op ?? {}).length);
  for (const m of reacted) how.push(`met: ${m.candidates.find((c) => c.level === m.laid).label}`);
  const verdict = refused ? 'refused' : how.length ? 'adapts' : 'attaches';
  const met = !refused && !!BEST[C.name.split(':')[0]]?.(w, before);
  // (not as it's laid, but a reading away: a meeting it made, chosen at another rung)
  let offered = '', offeredOps = '';
  if (!refused && !met) for (const m of w.meetings) for (const c of m.candidates) {
    if (offered || c.level === m.laid) continue;
    const v = replay(w.encode(), w.seed); v.apply({ choose: [[...m.anchor, c.level]], why: 'reading' });
    if (BEST[C.name.split(':')[0]]?.(v, before)) { offered = c.label; offeredOps = v.encode(); }
  }
  if (opt.v && !refused) console.log(C.name.split(':')[0], JSON.stringify({ from: op.connect?.from, to: op.connect?.to, took: op.took, flights: w.flights.map((f) => [f.cells[0], f.cells.length]) }));
  results.push({ group: C.group, name: C.name, best: C.best, verdict, met, offered, reading: refused ? op?.refused ?? 'nothing' : op.reading ?? op.note ?? op.why, how: how.join('; '), alts: refused ? (op?.alts ?? []).map((a) => a.label) : (op.alts ?? []).map((a) => a.label), flights: flights.map((f) => `${f.n} steps, ${f.carriage}`), ops: offeredOps || w.encode(), turn: C.turn });
}
const pad = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
for (const r of results) console.log(`${r.met ? '✓' : r.offered ? '○' : '·'} ${pad(r.verdict, 9)} ${pad(r.name.split(':')[0], 16)} ${r.reading}${r.how ? ` — ${r.how}` : ''}\n${' '.repeat(27)}best: ${r.best}${r.alts.length ? `\n${' '.repeat(27)}also: ${r.alts.join(' · ')}` : ''}`);
const tally = results.reduce((t, r) => ((t[r.verdict] = (t[r.verdict] ?? 0) + 1), t), {});
console.log(`\n${results.length} cases: ${Object.entries(tally).map(([k, n]) => `${n} ${k}`).join(', ')}; ${results.filter((r) => r.met).length} come to what they'd be at their best, ${results.filter((r) => r.offered).length} more a reading away`);
if (opt.json) (await import('node:fs')).writeFileSync(opt.json, JSON.stringify(results.map(({ ops, ...r }) => r), null, 1));
if (opt.render) {
  process.env.EXPERIMENT = 'labyrinth'; process.env.READY = '__labyrinth';
  const { withWood } = await import('./harness.mjs'), { mkdirSync } = await import('node:fs');
  const dir = new URL(`./out/atlas/${opt.set ? `${opt.set}/` : ''}`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  await withWood(async (lab) => {
    for (const [n, r] of results.entries()) {
      const p = await lab.open(`instant&cats=0&zoom=${opt.zoom ?? 0.42}&turn=${opt.turn ?? r.turn ?? 1}&el=0.62&at=6.5&ops=${encodeURIComponent(r.ops)}`);
      await p.waitForTimeout(8000);
      const file = new URL(`${String(n + 1).padStart(2, '0')}-${r.name.split(':')[0].replace(/[^a-z]+/gi, '-')}${r.offered ? '-a-reading-away' : ''}.png`, dir).pathname;
      await p.screenshot({ path: file, timeout: 300000 });
      console.log(`drawn: ${file}`);
      await p.close();
    }
  }, { width: 600, height: 600 });
}

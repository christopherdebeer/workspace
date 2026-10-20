// The connectors of static/labyrinth-connective.md, checked (node cells/lab/devtools/labyrinth-connectors.mjs): each a
// small scene made by gestures through the production gesture.ts, in both edit orders where the order could matter,
// turned to all four sides of the grid and mirrored, and each checked for the failure it exists to prevent (a passage
// shut by what's added over it, a route stopped by a wall it was drawn through, a tower reached at a blank face, a
// whole roof lost to a step on to part of it). Endpoints and clearance, not just that the world joins up somewhere.
//   --only=NAME   --ops (print each scene's ops, to replay with ?ops= in the browser)
import './labyrinth-node.mjs';
const { World, key } = await import('../client/labyrinth/model.ts');
const G = await import('../client/labyrinth/gesture.ts');
const NAV = await import('../client/labyrinth/nav.ts');
const BU = await import('../client/labyrinth/buildings.ts');

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
let checks = 0, fails = 0;
const ok = (name, cond, saw) => { checks++; if (!cond) { fails++; console.log(`FAIL  ${name}${saw !== undefined ? ` — saw ${JSON.stringify(saw)?.slice(0, 300)}` : ''}`); } else if (opt.v) console.log(`ok    ${name}`); };

// (the grid turned a quarter `r` times about (6, 6), and mirrored: every scene drawn in each)
const C = 6;
const turn = (r, m) => ([i, j]) => { let [x, z] = [i - C, j - C]; if (m) x = -x; for (let q = 0; q < r; q++) [x, z] = [-z, x]; return [x + C, z + C]; };
const ORIENT = [0, 1, 2, 3].flatMap((r) => [[r, false], [r, true]]);

/** the scene's hand, in one orientation: what it touches turned with it */
function hand(w, T) {
  const top = (c) => { const [i, j] = T(c), t = w.topFrom(w.ground(i, j) - 1, i, j); return w.stone(t - 1, i, j) ? { face: 'top', hit: [t - 1, i, j], to: [t, i, j] } : { face: 'ground', hit: [w.ground(i, j) - 1, i, j], to: [w.ground(i, j), i, j] }; };
  const apply = (op, what) => { if (!op || op.refused) throw new Error(`${what}: ${op?.refused ?? 'nothing'}`); w.apply({ ...op, alts: undefined }); return op; };
  return {
    T,
    /** a stroke from a to b (cells, in the scene's frame), with mass or a way in hand */
    stroke: (a, b, intent, end = null) => { const cells = G.connect([T(a), T(b)]); return apply(G.trace(w, top(a), cells, end ? top(end) : null, () => 0, 0, [], intent), `stroke ${a}→${b}`); },
    /** a tap, with mass or a way in hand */
    tap: (c, intent = 'mass') => apply(G.tap(w, top(c), 0, false, intent), `tap ${c}`),
    /** stone laid as a block is, by the hand (a column `n` high) */
    column: (c, n) => { const [i, j] = T(c), g = w.ground(i, j); w.apply({ add: Array.from({ length: n }, (_, k) => [g + k, i, j, 0]) }); },
  };
}
const walks = (w, a, b) => NAV.reaches(BU.walkable(w), a, b);
const at = (w, T, c) => { const [i, j] = T(c); return [w.ground(i, j), i, j]; };

const SCENES = [
  {
    name: 'passage kept under added mass: a way, then a block tapped on to it',
    run(w, H) {
      H.stroke([3, 6], [9, 6], 'way');
      H.tap([6, 6], 'mass');
      const [k, i, j] = at(w, H.T, [6, 6]);
      ok(`${this.tag}: the stone over the way is an archway`, w.stone(k, i, j) && w.archway(k, i, j) >= 0, { stone: w.stone(k, i, j), arch: w.archway(k, i, j) });
      ok(`${this.tag}: and the way still walks end to end`, walks(w, at(w, H.T, [3, 6]), at(w, H.T, [9, 6])));
    },
  },
  {
    name: 'passage kept under added mass: a way, then a wall drawn across it',
    run(w, H) {
      H.stroke([3, 6], [9, 6], 'way');
      H.stroke([6, 3], [6, 9], 'mass');
      const [k, i, j] = at(w, H.T, [6, 6]);
      ok(`${this.tag}: where the wall crosses the way, a gate`, w.stone(k, i, j) && w.archway(k, i, j) >= 0);
      ok(`${this.tag}: and the way still walks end to end`, walks(w, at(w, H.T, [3, 6]), at(w, H.T, [9, 6])));
    },
  },
  {
    name: 'route through a wall: a wall, then a way drawn across it',
    run(w, H) {
      H.stroke([6, 3], [6, 9], 'mass');
      const op = H.stroke([3, 6], [9, 6], 'way');
      const [k, i, j] = at(w, H.T, [6, 6]);
      ok(`${this.tag}: a gate opened where the way goes through`, w.stone(k, i, j) && w.archway(k, i, j) >= 0, { note: op.note });
      ok(`${this.tag}: the way walks end to end`, walks(w, at(w, H.T, [3, 6]), at(w, H.T, [9, 6])));
      ok(`${this.tag}: and isn't routed round it`, !op.took?.includes('routed-round'), op.took);
    },
  },
  {
    name: 'no pier in a passage: a way, then a bridge over it',
    run(w, H) {
      H.stroke([6, 3], [6, 9], 'way');
      H.column([3, 6], 2); H.column([9, 6], 2);
      H.stroke([3, 6], [9, 6], 'mass', [9, 6]);
      const piers = [];
      for (let q = 3; q <= 9; q++) { const [, i, j] = at(w, H.T, [6, q]); for (let k = 0; k < 3; k++) if (w.pier(k, i, j) && w.passage(k, i, j) >= 0) piers.push([k, i, j]); }
      ok(`${this.tag}: no pier stands in the way under the bridge`, !piers.length, piers);
      ok(`${this.tag}: the way under it still walks`, walks(w, at(w, H.T, [6, 3]), at(w, H.T, [6, 9])));
    },
  },
  {
    name: 'tower landing: a way to a tower\'s foot finds a door, not a blank face',
    run(w, H) {
      for (const c of [[7, 6], [8, 6], [7, 7], [8, 7]]) H.column(c, 4);
      H.stroke([2, 6], [6, 6], 'way');
      const b = BU.buildings(w).list.find((x) => x.cols.some(([i, j]) => { const [a, c] = H.T([7, 6]); return i === a && j === c; }));
      const [, i0, j0] = at(w, H.T, [6, 6]);
      const door = b?.openings.find((o) => o.kind === 'door' && Math.abs(o.i - i0) + Math.abs(o.j - j0) === 1);
      ok(`${this.tag}: a door on the face the way arrives at`, !!door, b?.openings.filter((o) => o.kind === 'door'));
    },
  },
];

const t0 = Date.now();
for (const S of SCENES) {
  if (opt.only && !S.name.includes(opt.only)) continue;
  for (const [r, m] of ORIENT) {
    const w = new World(1), H = hand(w, turn(r, m));
    S.tag = `${S.name.split(':')[0]} (turned ${r}${m ? ', mirrored' : ''})`;
    try { S.run(w, H); } catch (e) { checks++; fails++; console.log(`FAIL  ${S.tag}: ${String(e.message ?? e).slice(0, 200)}`); }
    if (opt.ops && r === 0 && !m) console.log(`${S.name}\n  ?ops=${encodeURIComponent(w.encode())}`);
  }
}
console.log(`${checks - fails} of ${checks} connector checks hold (${SCENES.length} scenes × ${ORIENT.length} orientations, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exitCode = fails ? 1 : 0;

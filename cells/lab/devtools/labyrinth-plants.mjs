// What grows, and how it meets what's built (node cells/lab/devtools/labyrinth-plants.mjs): scenes of plants among
// stone, made by the production gesture.ts where a gesture makes them, turned to all four sides and mirrored, checked
// for how architecture and planting answer each other (a crown leaning from a wall, pruned round stone; a pit left in a
// terrace laid round a trunk; a tree on a top in a planter; ways going round trunks), and drawn in WebGL with --render.
//   --only=NAME   --render (devtools/out/plants/*.png)   --zoom=   --turn=
import './labyrinth-node.mjs';
const { World, DIRS, PLANT, CENTER } = await import('../client/labyrinth/model.ts');
const G = await import('../client/labyrinth/gesture.ts');
const NAV = await import('../client/labyrinth/nav.ts');
const BU = await import('../client/labyrinth/buildings.ts');
const PL = await import('../client/labyrinth/plants.ts');

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
let checks = 0, fails = 0;
const ok = (name, cond, saw) => { checks++; if (!cond) { fails++; console.log(`FAIL  ${name}${saw !== undefined ? ` — saw ${JSON.stringify(saw)?.slice(0, 300)}` : ''}`); } else if (opt.v) console.log(`ok    ${name}`); };
const C = 6, turn = (r, m) => ([i, j]) => { let [x, z] = [i - C, j - C]; if (m) x = -x; for (let q = 0; q < r; q++) [x, z] = [-z, x]; return [x + C, z + C]; };
const ORIENT = [0, 1, 2, 3].flatMap((r) => [[r, false], [r, true]]);
function hand(w, T) {
  const pick = (c) => { const [i, j] = T(c), t = w.topFrom(w.ground(i, j) - 1, i, j); return w.stone(t - 1, i, j) ? { face: 'top', hit: [t - 1, i, j], to: [t, i, j] } : { face: 'ground', hit: [w.ground(i, j) - 1, i, j], to: [w.ground(i, j), i, j] }; };
  const apply = (op, what) => { if (!op || op.refused) throw new Error(`${what}: ${op?.refused ?? 'nothing'}`); w.apply({ ...op, alts: undefined }); return op; };
  return {
    T, pick,
    block: (i0, i1, j0, j1, n, from = 0) => { const add = []; for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const [x, z] = T([i, j]); for (let k = from; k < from + n; k++) add.push([k, x, z, 0]); } w.apply({ add }); },
    plant: (c, kind, k = null) => { const [i, j] = T(c); w.apply({ plants: [[k ?? w.topFrom(w.ground(i, j) - 1, i, j), i, j, kind, 0]] }); },
    /** a tap, and its planting reading taken (held, chosen), or what it is if that's planting already (a plant grown) */
    tap: (c) => { const op = G.tap(w, pick(c), 0, false, 'mass'); return apply(op?.plants ? op : op?.alts?.find((a) => a.op.plants)?.op, `tap ${c}`); },
    stroke: (a, b) => { const op = G.trace(w, pick(a), G.connect([T(a), T(b)]), null, () => 0, 0, [], 'mass'); return apply(op?.plants ? op : op?.alts?.find((x) => x.op.plants)?.op ? { ...op.alts.find((x) => x.op.plants).op, alts: op.alts.filter((x) => x.op.plants) } : null, `stroke ${a}→${b}`); },
  };
}
const at = (w, T, c, k) => { const [i, j] = T(c); return [k ?? w.ground(i, j), i, j]; };
const centroid = (cs) => cs.reduce((a, c) => [a[0] + c.x / cs.length, a[1] + c.z / cs.length], [0, 0]);

export const SCENES = [
  {
    name: 'against a wall: a stone pine beside a tall wall leans from it, its crown pruned round the stone',
    run(w, H) {
      for (let j = 2; j <= 9; j++) H.block(7, 7, j, j, 4);
      H.plant([6, 5], PLANT.pine);
      const [k, i, j] = at(w, H.T, [6, 5]), g = PL.grow(w, k, i, j, PLANT.pine), [wi] = H.T([7, 5]), [cx, cz] = centroid(g.crown);
      const wallSide = (H.T([7, 5])[0] - i) || 0, wallSideZ = H.T([7, 5])[1] - j;
      ok(`${this.tag}: a crown, nothing of it in the stone`, g.crown.length > 10 && g.crown.every((c) => !w.occupied(Math.floor(c.y), Math.floor(c.x + CENTER), Math.floor(c.z + CENTER))), g.crown.length);
      ok(`${this.tag}: leaning away from the wall`, (cx - (i - CENTER + 0.5)) * wallSide + (cz - (j - CENTER + 0.5)) * wallSideZ < -0.2, { cx, cz, wallSide, wallSideZ });
      void wi;
    },
  },
  {
    name: 'a pit: a terrace laid round an olive leaves its trunk a pit',
    run(w, H) {
      H.plant([6, 6], PLANT.olive);
      H.block(4, 8, 4, 8, 1);
      const [k, i, j] = at(w, H.T, [6, 6]);
      ok(`${this.tag}: the olive still there`, w.plant(k, i, j) === PLANT.olive, w.plant(k, i, j));
      ok(`${this.tag}: no stone where it grows`, !w.stone(k, i, j));
      ok(`${this.tag}: the terrace round it`, w.stone(k, i + 1, j) && w.stone(k, i, j + 1));
    },
  },
  {
    name: 'on a top: an olive on a terrace stands in a planter, and the terrace is walked round it',
    run(w, H) {
      H.block(4, 8, 4, 8, 2);
      H.plant([6, 6], PLANT.olive);
      const [, i, j] = at(w, H.T, [6, 6]);
      ok(`${this.tag}: growing from the top`, w.plant(2, i, j) === PLANT.olive);
      ok(`${this.tag}: not stood in`, !NAV.standing(w, 2, i, j));
      ok(`${this.tag}: walked round`, NAV.reaches(BU.walkable(w), at(w, H.T, [5, 6], 2), at(w, H.T, [7, 6], 2)));
    },
  },
  {
    name: 'a hedge and shrubs: a clipped row along a way, shrubs at its ends',
    run(w, H) {
      for (let i = 3; i <= 8; i++) H.plant([i, 4], PLANT.hedge);
      H.plant([2, 4], PLANT.shrub); H.plant([9, 4], PLANT.shrub);
      H.plant([6, 7], PLANT.pine); H.plant([3, 7], PLANT.olive);
      ok(`${this.tag}: the row's cells not stood in`, [3, 5, 8].every((i) => !NAV.standing(w, ...at(w, H.T, [i, 4]))));
    },
  },
  {
    name: 'planting taps: an olive in the open, a cypress against a wall, grown when tapped again, never on a way',
    run(w, H) {
      for (let j = 2; j <= 9; j++) H.block(9, 9, j, j, 3);
      const op = H.tap([4, 5]), [k, i, j] = at(w, H.T, [4, 5]);
      ok(`${this.tag}: an olive in the open`, w.plant(k, i, j) === PLANT.olive, op.note);
      H.tap([4, 5]);
      ok(`${this.tag}: tapped again, grown to a stone pine`, w.plant(k, i, j) === PLANT.pine, w.plant(k, i, j));
      const op2 = H.tap([8, 5]);
      ok(`${this.tag}: against the wall, a cypress`, w.plant(...at(w, H.T, [8, 5])) === PLANT.cypress, op2.note);
      w.apply({ ...G.trace(w, H.pick([2, 8]), G.connect([H.T([2, 8]), H.T([7, 8])]), null, () => 0, 0, [], 'way'), alts: undefined });
      const r = G.tap(w, H.pick([4, 8]), 0, false, 'mass');
      ok(`${this.tag}: not on a way (no planting offered there)`, !r?.plants && !r?.alts?.some((a) => a.op.plants), r?.alts?.map((a) => a.label));
    },
  },
  {
    name: 'planting strokes: an avenue of cypresses along a wall, a grove in a ring',
    run(w, H) {
      for (let i = 2; i <= 9; i++) H.block(i, i, 2, 2, 3);
      const row = H.stroke([2, 3], [9, 3]);
      ok(`${this.tag}: along the wall, an avenue of cypresses`, row.plants?.length >= 3 && row.plants.every((p) => p[3] === PLANT.cypress), row.note);
      ok(`${this.tag}: a hedge, the other reading`, row.alts?.some((a) => a.label === 'a hedge'));
      const ring = [[3, 6], [8, 6], [8, 10], [3, 10], [3, 6]].map(H.T);
      const r0 = G.trace(w, H.pick([3, 6]), G.connect(ring), null, () => 0, 0, [], 'mass'), op = r0?.alts?.find((a) => a.op.plants)?.op;
      ok(`${this.tag}: a ring, a grove in it`, op?.plants?.length >= 4 && op.plants.every(([, i, j]) => { const [x0, z0] = H.T([3, 6]), [x1, z1] = H.T([8, 10]); return i > Math.min(x0, x1) && i < Math.max(x0, x1) && j > Math.min(z0, z1) && j < Math.max(z0, z1); }), op?.note ?? op?.refused);
      w.apply({ ...op, alts: undefined });
    },
  },
  {
    name: 'a garden: a court with its olive, a way with its avenue, a pine over the wall, a hedge along the terrace',
    run(w, H) {
      // (a court walled round, big enough for an olive of its own)
      for (let i = 2; i <= 8; i++) { H.block(i, i, 2, 2, 2); H.block(i, i, 8, 8, 2); }
      for (let j = 3; j <= 7; j++) { H.block(2, 2, j, j, 2); H.block(8, 8, j, j, 2); }
      w.apply({ ...G.trace(w, H.pick([0, 10]), G.connect([H.T([0, 10]), H.T([10, 10])]), null, () => 0, 0, [], 'way'), alts: undefined });
      H.stroke([1, 9], [9, 9]);
      H.plant([10, 4], PLANT.pine);
      ok(`${this.tag}: the court has a tree of its own`, w.decor.some((d) => d.kind === 'olive' || d.kind === 'cypress'), w.decor.map((d) => d.kind));
    },
  },
];

const t0 = Date.now(), scenes = [];
for (const S of SCENES) {
  if (opt.only && !S.name.includes(opt.only)) continue;
  for (const [r, m] of ORIENT) {
    const w = new World(1), H = hand(w, turn(r, m));
    S.tag = `${S.name.split(':')[0]} (turned ${r}${m ? ', mirrored' : ''})`;
    try { S.run(w, H); } catch (e) { checks++; fails++; console.log(`FAIL  ${S.tag}: ${String(e.message ?? e).slice(0, 200)}`); }
    if (r === 0 && !m) scenes.push({ name: S.name, ops: w.encode() });
  }
}
console.log(`${checks - fails} of ${checks} plant checks hold (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exitCode = fails ? 1 : 0;
if (opt.render) {
  process.env.EXPERIMENT = 'labyrinth'; process.env.READY = '__labyrinth';
  const { withWood } = await import('./harness.mjs'), { mkdirSync } = await import('node:fs');
  const dir = new URL(`./out/plants${opt.tag ? `-${opt.tag}` : ''}/`, import.meta.url);
  mkdirSync(dir, { recursive: true });
  await withWood(async (lab) => {
    for (const [n, sc] of scenes.entries()) {
      const p = await lab.open(`instant&zoom=${opt.zoom ?? 0.5}&turn=${opt.turn ?? 1}&ops=${encodeURIComponent(sc.ops)}`);
      await p.waitForTimeout(9000);
      const file = new URL(`${String(n + 1).padStart(2, '0')}-${sc.name.split(':')[0].replace(/[^a-z]+/gi, '-')}.png`, dir).pathname;
      await p.screenshot({ path: file, timeout: 300000 });
      console.log(`drawn: ${file}`);
      await p.close();
    }
  }, { width: 700, height: 700 });
}

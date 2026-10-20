// Stairs in their settings (node cells/lab/devtools/labyrinth-stairs.mjs): flights made by gestures through the
// production gesture.ts, each where a flight's setting decides how it's carried and how it's come to (free-standing to a
// tower's top, along a wall, up a bank, over a lane, from beside its foot), turned to all four sides and mirrored, and
// checked: walked end to end, approached as the setting allows, carried as its setting says.
//   --only=NAME   --render (devtools/out/stairs/*.png)   --zoom=   --turn=   --ops
import './labyrinth-node.mjs';
const { World, key, DIRS, replay } = await import('../client/labyrinth/model.ts');
const G = await import('../client/labyrinth/gesture.ts');
const NAV = await import('../client/labyrinth/nav.ts');
const BU = await import('../client/labyrinth/buildings.ts');
const FL = await import('../client/labyrinth/flights.ts').catch(() => null);

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
let checks = 0, fails = 0;
const ok = (name, cond, saw) => { checks++; if (!cond) { fails++; console.log(`FAIL  ${name}${saw !== undefined ? ` — saw ${JSON.stringify(saw)?.slice(0, 300)}` : ''}`); } else if (opt.v) console.log(`ok    ${name}`); };
const C = 6;
const turn = (r, m) => ([i, j]) => { let [x, z] = [i - C, j - C]; if (m) x = -x; for (let q = 0; q < r; q++) [x, z] = [-z, x]; return [x + C, z + C]; };
const ORIENT = [0, 1, 2, 3].flatMap((r) => [[r, false], [r, true]]);
function hand(w, T) {
  const top = (c) => { const [i, j] = T(c), t = w.topFrom(w.ground(i, j) - 1, i, j); return w.stone(t - 1, i, j) ? { face: 'top', hit: [t - 1, i, j], to: [t, i, j] } : { face: 'ground', hit: [w.ground(i, j) - 1, i, j], to: [w.ground(i, j), i, j] }; };
  const apply = (op, what) => { if (!op || op.refused) throw new Error(`${what}: ${op?.refused ?? 'nothing'}`); w.apply({ ...op, alts: undefined }); return op; };
  return {
    T,
    /** a stroke through several points (each a cell, in the scene's frame) */
    trace: (pts, intent, end = null) => apply(G.trace(w, top(pts[0]), G.connect(pts.map(T)), end ? top(end) : null, () => 0, 0, [], intent), `trace ${pts}`),
    stroke: (a, b, intent, end = null) => apply(G.trace(w, top(a), G.connect([T(a), T(b)]), end ? top(end) : null, () => 0, 0, [], intent), `stroke ${a}→${b}`),
    column: (c, n) => { const [i, j] = T(c), g = w.ground(i, j); w.apply({ add: Array.from({ length: n }, (_, k) => [g + k, i, j, 0]) }); },
    block: (i0, i1, j0, j1, n) => { const add = []; for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const [x, z] = T([i, j]), g = w.ground(x, z); for (let k = 0; k < n; k++) add.push([g + k, x, z, 0]); } w.apply({ add }); },
    flight: (c, d, n, from = 0) => { const [i, j] = T(c), [a, b] = DIRS[d], [x1, z1] = T([c[0] + a, c[1] + b]), dd = DIRS.findIndex(([p, q]) => p === x1 - i && q === z1 - j); const st = []; for (let q = 0; q < n; q++) { const [x, z] = T([c[0] + a * q, c[1] + b * q]); st.push([from + q, x, z, dd, 0]); } w.apply({ stairs: st }); },
  };
}
const walks = (w, a, b) => NAV.reaches(BU.walkable(w), a, b);
const at = (w, T, c, k) => { const [i, j] = T(c); return [k ?? w.ground(i, j), i, j]; };
const stairsOf = (w) => [...w.stairs.keys()];
const piersUnder = (w) => [...w.piers.keys()].filter((v) => { const [k, i, j] = [Math.floor(v / 1e6), 0, 0]; return true; });

const carried = (w, H, c, k) => { const [i, j] = H.T(c); return w.flight(k, i, j)?.f.carriage; };
export const SCENES = [
  {
    name: 'free-standing: a way from the ground to a tower\'s top',
    run(w, H) {
      H.block(8, 9, 5, 6, 4);
      H.stroke([2, 5], [8, 5], 'way', [8, 5]);
      ok(`${this.tag}: walked from the ground to the top`, walks(w, at(w, H.T, [3, 5]), at(w, H.T, [8, 5], 4)));
      ok(`${this.tag}: on a rampant arch`, carried(w, H, [7, 5], 3) === 'rampant', carried(w, H, [7, 5], 3));
      ok(`${this.tag}: and walked under, where it's high`, walks(w, at(w, H.T, [6, 4]), at(w, H.T, [6, 6])) && NAV.standing(w, ...at(w, H.T, [6, 5])), { under: NAV.standing(w, ...at(w, H.T, [6, 5])) });
    },
  },
  {
    name: 'along a wall: a way up beside a wall to the top of a block at its end',
    run(w, H) {
      for (let i = 2; i <= 9; i++) H.column([i, 4], 4);
      H.block(8, 9, 5, 6, 4);
      H.stroke([2, 5], [8, 5], 'way', [8, 5]);
      ok(`${this.tag}: walked from the ground to the top`, walks(w, at(w, H.T, [3, 5]), at(w, H.T, [8, 5], 4)));
      ok(`${this.tag}: hung from the wall`, carried(w, H, [7, 5], 3) === 'hung', carried(w, H, [7, 5], 3));
      ok(`${this.tag}: no pier under it`, ![...w.piers.keys()].length, w.piers.size);
    },
  },
  {
    name: 'over a lane: a flight to a tower, a lane under it',
    run(w, H) {
      H.stroke([5, 2], [5, 10], 'way');
      H.block(8, 9, 5, 6, 4);
      H.stroke([1, 5], [8, 5], 'way', [8, 5]);
      ok(`${this.tag}: walked from the ground to the top`, walks(w, at(w, H.T, [2, 5]), at(w, H.T, [8, 5], 4)));
      ok(`${this.tag}: and the lane still walks under it`, walks(w, at(w, H.T, [5, 3]), at(w, H.T, [5, 9])));
    },
  },
  {
    name: 'come to from the side: a flight\'s foot walled off, a lane beside its first step',
    run(w, H) {
      H.block(8, 9, 5, 6, 3);
      H.column([4, 5], 2);
      H.flight([5, 5], 0, 3);
      H.stroke([2, 4], [9, 4], 'way');
      ok(`${this.tag}: from the lane, up it to the top`, walks(w, at(w, H.T, [3, 4]), at(w, H.T, [8, 5], 3)));
    },
  },
  {
    name: 'left from the side: a flight\'s head against a wall, a terrace beside its last step',
    run(w, H) {
      H.block(5, 9, 6, 7, 3);
      H.column([8, 5], 4);
      H.flight([5, 5], 0, 3);
      ok(`${this.tag}: up it, and off sideways on to the terrace`, walks(w, at(w, H.T, [4, 5]), at(w, H.T, [6, 7], 3)));
      ok(`${this.tag}: hung from the terrace's side`, carried(w, H, [7, 5], 2) === 'hung', carried(w, H, [7, 5], 2));
    },
  },
  {
    name: 'switchback: a short stroke to a tall tower, folded back on itself',
    run(w, H) {
      H.block(8, 9, 5, 6, 5);
      const op = H.stroke([6, 5], [8, 5], 'way', [8, 5]);
      ok(`${this.tag}: read as a switchback, the tower the other reading`, op.took?.includes('switchback') && op.alts?.some((a) => a.label === 'a stair tower'), { took: op.took, note: op.note, alts: op.alts?.map((a) => a.label) });
      ok(`${this.tag}: walked from the ground to the top`, walks(w, at(w, H.T, [7, 8]), at(w, H.T, [8, 5], 5)));
      ok(`${this.tag}: two flights, each carried`, w.flights.length === 2 && w.flights.every((f) => f.carriage !== 'pier'), w.flights.map((f) => [f.cells.length, f.carriage]));
    },
  },
  {
    name: 'folded by hand: a hairpin stroke climbing to a tower, followed as drawn',
    run(w, H) {
      H.block(8, 9, 5, 6, 4);
      const op = H.trace([[7, 6], [3, 6], [3, 5], [8, 5]], 'way', [8, 5]);
      ok(`${this.tag}: followed as drawn (not smoothed, not a ring, not refolded)`, !!op.connect && !op.took?.includes('switchback') && op.connect.path.length >= 8, { took: op.took, note: op.note, path: op.connect?.path?.length });
      ok(`${this.tag}: walked from the ground to the top`, walks(w, at(w, H.T, [7, 7]), at(w, H.T, [8, 5], 4)));
    },
  },
  {
    name: 'a ladder: too steep, no room to fold, against a wall',
    run(w, H) {
      for (let j = 3; j <= 8; j++) H.column([8, j], 4);
      for (let j = 3; j <= 8; j++) if (j !== 5) H.column([6, j], 2);
      H.column([7, 4], 1); H.column([7, 6], 1);
      const op = H.stroke([7, 5], [8, 5], 'way', [8, 5]);
      ok(`${this.tag}: a ladder, the lightest way up`, op.why === 'ladder', { why: op.why, note: op.note, took: op.took });
      ok(`${this.tag}: climbed, from its foot to the top`, walks(w, at(w, H.T, [7, 5]), at(w, H.T, [8, 5], 4)));
    },
  },
  {
    name: 'chosen: a free-standing flight made solid, then hung on piers',
    run(w, H) {
      H.block(8, 9, 5, 6, 4);
      H.stroke([2, 5], [8, 5], 'way', [8, 5]);
      const f = w.flight(...at(w, H.T, [7, 5], 3))?.f;
      ok(`${this.tag}: offers what its setting allows`, f && f.options.includes('rampant') && f.options.includes('solid') && f.options.includes('pier') && !f.options.includes('hung'), f?.options);
      w.apply({ rule: [[...f.cells[0], 30]], why: 'reading' });
      ok(`${this.tag}: solid when chosen`, carried(w, H, [7, 5], 3) === 'solid', carried(w, H, [7, 5], 3));
      ok(`${this.tag}: and nothing walks under it then`, !NAV.standing(w, ...at(w, H.T, [6, 5])));
      w.apply({ rule: [[...f.cells[0], 2]], why: 'reading' });
      ok(`${this.tag}: on piers when chosen`, carried(w, H, [7, 5], 3) === 'pier' && w.piers.size > 0, carried(w, H, [7, 5], 3));
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
    if (r === 0 && !m) { scenes.push({ name: S.name, ops: w.encode() }); if (opt.ops) console.log(`${S.name}\n  ?ops=${encodeURIComponent(w.encode())}`); }
  }
}
console.log(`${checks - fails} of ${checks} stair checks hold (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exitCode = fails ? 1 : 0;
if (opt.render) {
  process.env.EXPERIMENT = 'labyrinth'; process.env.READY = '__labyrinth';
  const { withWood } = await import('./harness.mjs'), { mkdirSync } = await import('node:fs');
  const dir = new URL(`./out/stairs${opt.tag ? `-${opt.tag}` : ''}/`, import.meta.url);
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

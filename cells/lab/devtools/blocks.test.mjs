// Blocks' rules and shapes, on their own: what a block reads as from what's round it; the mesh of a build closed
// (no crack where two cells' meshes meet, whatever's built), facing out; the same build the same whatever the order it
// was built in; one block changing nothing more than four cells off; and what a shape costs.
// (node cells/lab/devtools/blocks.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const lab = new URL('../client/blocks/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './world'; export * from './rules'; export * from './shape'; export * from './demos';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const g = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const { World, key, unkey, Reads, ROLE, patch, cellMesh, cacheStats, clearShapes, DEMOS } = g;

const worldOf = (cells) => { const w = new World(); for (const c of cells) w.cells.add(key(...c)); return w; };
const readsOf = (w) => new Reads((x, y, z) => w.has(x, y, z));
/** every cell's patch name and mesh (cells within one of a block) */
function shapes(w, R = readsOf(w)) {
  const m = new Map();
  for (const k of w.cells) { const [x, y, z] = unkey(k); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { if (y + b < 0) continue; const kk = key(x + a, y + b, z + c); if (m.has(kk)) continue; const [p, q, r] = unkey(kk); const P = patch((i, j, l) => R.at(i, j, l), p, q, r); m.set(kk, { name: P.name, mesh: cellMesh(P) }); } }
  return m;
}
/** the meshes put together, welded where they meet: edges each met once each way (closed), and the volume (outward) */
function closure(m) {
  const id = new Map(), wv = [], tris = [];
  const weld = (x, y, z) => { const k = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`; let n = id.get(k); if (n === undefined) { n = id.size; id.set(k, n); wv.push([x, y, z]); } return n; };
  for (const [k, { mesh }] of m) {
    const [x, y, z] = unkey(k), base = [];
    for (let q = 0; q < mesh.v.length; q += 8) base.push(weld(mesh.v[q] + x, mesh.v[q + 1] + y, mesh.v[q + 2] + z));
    for (let q = 0; q < mesh.i.length; q += 3) tris.push([base[mesh.i[q]], base[mesh.i[q + 1]], base[mesh.i[q + 2]]]);
  }
  const edges = new Map(); let vol = 0;
  for (const [a, b, c] of tris) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) if (u !== v) edges.set(u + ',' + v, (edges.get(u + ',' + v) ?? 0) + 1);
    const [A, B, C] = [wv[a], wv[b], wv[c]];
    vol += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
  }
  let open = 0; const where = [];
  for (const [k, n] of edges) { const [u, v] = k.split(','); if ((edges.get(v + ',' + u) ?? 0) !== n) { open++; if (where.length < 400) where.push(wv[+u]); } }
  return { open, vol, tris: tris.length, where };
}

// ─── what a block reads as ───
{
  const w = worldOf([[0, 2, 0]]), R = readsOf(w);
  assert.equal(R.at(0, 2, 0).role, ROLE.pebble, 'alone, off the ground: a pebble');
  const c = worldOf([[0, 0, 0], [0, 1, 0], [0, 2, 0]]), Rc = readsOf(c);
  assert.equal(Rc.at(0, 1, 0).role, ROLE.column, 'a run up, nothing beside: a column');
  assert.ok(Rc.at(0, 0, 0).ends & 1, 'its foot: a base');
  assert.ok(Rc.at(0, 2, 0).ends & 2, 'its top: a capital');
  // (a wall three high: windows in rhythm, on its open faces)
  const wall = []; for (let x = 0; x < 6; x++) for (let y = 0; y < 3; y++) wall.push([x, y, 0]);
  const Rw = readsOf(worldOf(wall));
  assert.equal(Rw.at(2, 1, 0).role, ROLE.wall);
  assert.ok([0, 1, 2, 3, 4, 5].some((x) => Rw.at(x, 1, 0).windows), 'windows somewhere along it');
  assert.ok([0, 1, 2, 3, 4, 5].some((x) => !Rw.at(x, 1, 0).windows), 'not every block a window');
  // (an arch: carried both ways over a gap, its underside springing from what stands either side)
  const arch = worldOf([[0, 0, 0], [0, 1, 0], [2, 0, 0], [2, 1, 0], [0, 2, 0], [1, 2, 0], [2, 2, 0]]), Ra = readsOf(arch);
  assert.equal(Ra.at(1, 2, 0).role, ROLE.span);
  assert.ok(Ra.at(1, 2, 0).under & (1 << ((-1 + 2) * 5 + 2)) && Ra.at(1, 2, 0).under & (1 << ((1 + 2) * 5 + 2)), 'it sees both supports');
  // (battlements on a wall's top, none on a column's head)
  const Rk = readsOf(worldOf(DEMOS.castle()));
  assert.ok(Rk.at(2, 2, 7).merlons, 'the castle wall has battlements');
  const Rr = readsOf(worldOf(DEMOS.arcade()));
  assert.equal(Rr.at(4, 2, 0).merlons, 0, 'a column head has none');
  console.log('reads ok');
}

// ─── closed, facing out: every demo, and a scatter ───
let rnd = 7; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const scatter = []; for (let i = 0; i < 160; i++) scatter.push([Math.floor(rand() * 7), Math.floor(rand() * rand() * 6), Math.floor(rand() * 7)]);
for (const [name, cells] of [...Object.entries(DEMOS).map(([n, f]) => [n, f()]), ['scatter', scatter]]) {
  clearShapes(); cacheStats.made = 0;
  const t = performance.now(), m = shapes(worldOf(cells)), ms = performance.now() - t;
  const c = closure(m);
  console.log(`${name}: ${m.size} cells shaped (${cacheStats.made} made, ${(ms / Math.max(cacheStats.made, 1)).toFixed(2)} ms each), ${c.tris} triangles, ${c.open} open edges, volume ${c.vol.toFixed(1)}`);
  if (c.open && process.env.WHERE) { const h = {}; for (const p of c.where) { const k = p.map((v) => Math.round(v)).join(','); h[k] = (h[k] ?? 0) + 1; } console.log(Object.entries(h).sort((a, b) => b[1] - a[1]).slice(0, 12), c.where.slice(0, 5)); }
  assert.equal(c.open, 0, `${name}: closed`);
  assert.ok(c.vol > 0, `${name}: facing out`);
}

// ─── the same whatever the order; one block reaches four cells, no further ───
{
  const cells = DEMOS.house(), a = worldOf(cells), b = worldOf([...cells].reverse());
  const ma = shapes(a), mb = shapes(b);
  for (const [k, v] of ma) assert.equal(mb.get(k)?.name, v.name, 'same build, same shapes');
  const R = readsOf(a), before = shapes(a, R);
  a.apply([key(2, 4, 2)]); R.changed(2, 4, 2);
  const after = shapes(a, R);
  let far = 0, changed = 0;
  for (const [k, v] of after) if (before.get(k)?.name !== v.name) { changed++; const [x, y, z] = unkey(k); far = Math.max(far, Math.abs(x - 2), Math.abs(y - 4), Math.abs(z - 2)); }
  console.log(`one block on the roof: ${changed} shapes change, the furthest ${far} cells off`);
  assert.ok(far <= 4, 'nothing further than four cells changes');
  // (and undone, every shape is as it was)
  a.undo(); R.changed(2, 4, 2);
  for (const [k, v] of shapes(a, R)) assert.equal(before.get(k)?.name, v.name, 'undone: as it was');
}
console.log('blocks ok');

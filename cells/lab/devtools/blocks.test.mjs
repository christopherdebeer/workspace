// Blocks' reads and shapes, on their own: what a block reads as from what's round it, and what that makes of it
// (a stack tapers, its foot steps out; a run is drawn in less than a stone alone, its end least; an arch sees both its
// supports and its underside is cut; a pier pushed from one side spreads its foot the other way); what an empty cell
// reads as (a court, its water, beds, trees) and what grows there; blocks with the same surroundings, however turned,
// read alike; the mesh of a build closed (no crack where two cells' meshes meet), facing out; the same build the same
// whatever the order it was built in; one block changing nothing further than a court reaches; and what a shape costs.
// (node cells/lab/devtools/blocks.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const lab = new URL('../client/blocks/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './world'; export * from './rules'; export * from './shape'; export * from './voxels'; export * from './demos';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const g = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const { World, key, unkey, Reads, thinning, patch, cellMesh, cubesOf, cacheStats, clearShapes, VERTEX, DEMOS, COURT, M, MAT } = g;

const worldOf = (cells) => { const w = new World(); for (const c of cells) w.cells.add(key(...c)); return w; };
const readsOf = (w) => new Reads((x, y, z) => w.has(x, y, z));
/** every cell's patch name and mesh (cells within one of a block, and the ground and what grows on it within a court
 * of one) */
function shapes(w, R = readsOf(w)) {
  const m = new Map();
  const add = (p, q, r) => { if (q < 0) return; const kk = key(p, q, r); if (m.has(kk)) return; const P = patch((i, j, l) => R.at(i, j, l), p, q, r); m.set(kk, { name: P.name, mesh: cellMesh(P) }); };
  for (const k of w.cells) {
    const [x, y, z] = unkey(k);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) add(x + a, y + b, z + c);
    if (y === 0) for (let a = -COURT; a <= COURT; a++) for (let c = -COURT; c <= COURT; c++) for (let b = 0; b <= 2; b++) add(x + a, b, z + c);
  }
  return m;
}
/** a cell's small cubes, and how many of them are of a stuff, or filled, in a row */
const cubes = (R, x, y, z) => cubesOf(patch((i, j, l) => R.at(i, j, l), x, y, z));
const count = (G, f) => { let n = 0; for (let q = 0; q < G.length; q++) if (f(G[q], q)) n++; return n; };
const row = (G, j) => count(G, (m, q) => m !== 0 && Math.floor(q / M) % M === j);
const has = (G, stuff) => count(G, (m) => m === stuff) > 0;
/** the meshes put together, cut back into the faces of the small cubes (a merged quad meets smaller ones mid-edge):
 * every edge of every face met from the other side (closed), and the volume (outward) */
const AXIS = [0, 0, 1, 1, 2, 2], SIGN = [1, -1, 1, -1, 1, -1];
function closure(m) {
  const edges = new Map(); let vol = 0, tris = 0;
  const edge = (p, q) => { const k = p.join(',') + '>' + q.join(','); edges.set(k, (edges.get(k) ?? 0) + 1); };
  for (const [k, { mesh }] of m) {
    const [x, y, z] = unkey(k);
    tris += mesh.i.length / 3;
    for (let q = 0; q < mesh.v.length; q += 4 * VERTEX) {
      const f = mesh.v[q + 3] % 6, ax = AXIS[f], ua = (ax + 1) % 3, va = (ax + 2) % 3, sg = SIGN[f];
      const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let c = 0; c < 4; c++) for (let d = 0; d < 3; d++) {
        const t = Math.round((mesh.v[q + c * VERTEX + d] + 0.5 + [x, y, z][d]) * M);
        lo[d] = Math.min(lo[d], t); hi[d] = Math.max(hi[d], t);
      }
      vol += (sg * lo[ax] * (hi[ua] - lo[ua]) * (hi[va] - lo[va])) / M ** 3 / 3;
      for (let u = lo[ua]; u < hi[ua]; u++) for (let v = lo[va]; v < hi[va]; v++) {
        const P = (du, dv) => { const r = [0, 0, 0]; r[ax] = lo[ax]; r[ua] = u + du; r[va] = v + dv; return r; };
        const ring = sg > 0 ? [P(0, 0), P(1, 0), P(1, 1), P(0, 1)] : [P(0, 0), P(0, 1), P(1, 1), P(1, 0)];
        for (let c = 0; c < 4; c++) edge(ring[c], ring[(c + 1) % 4]);
      }
    }
  }
  // (open: an edge with no face on its other side, or met more often one way than the other: a hole)
  let open = 0;
  for (const [k, n] of edges) { const [u, v] = k.split('>'); if ((edges.get(v + '>' + u) ?? 0) !== n) open++; }
  return { open, vol, tris };
}

// ─── what a block reads as, and what that makes of it ───
{
  const R = readsOf(worldOf([[0, 0, 0]])), r = R.at(0, 0, 0);
  assert.ok(r.solid && r.standing && r.above === 0, 'one block on the ground stands, nothing on it');
  assert.deepEqual([r.open[0], r.open[2], r.open[3]], [4, 4, 0], 'open at its sides and top, closed by the ground under it');
  // (a stack of three: drawn in all round, and tapering as one, slender at its top, full where it carries)
  const Rs = readsOf(worldOf([[0, 0, 0], [0, 1, 0], [0, 2, 0]])), [b0, b1, b2] = [Rs.at(0, 0, 0), Rs.at(0, 1, 0), Rs.at(0, 2, 0)];
  assert.deepEqual(thinning(b1), [1, 1], 'a stone in a stack, open all round, is drawn in fully both ways');
  assert.equal(b0.above, 2); assert.equal(b2.above, 0);
  const [g0, g1, g2] = [cubes(Rs, 0, 0, 0), cubes(Rs, 0, 1, 0), cubes(Rs, 0, 2, 0)];
  assert.ok(row(g2, M - 1) <= row(g1, M >> 1) && row(g1, M >> 1) <= row(g0, M >> 1), 'it tapers toward its top');
  assert.ok(row(g0, 0) > row(g0, M >> 1), 'its foot steps out on the ground');
  // (a wall: drawn in across less than a stone alone; its end, less again: it stands as a pier)
  const wall = []; for (let x = 0; x < 6; x++) wall.push([x, 0, 0], [x, 1, 0]);
  const Rw = readsOf(worldOf(wall));
  const [inner, end] = [thinning(Rw.at(3, 1, 0))[1], thinning(Rw.at(0, 1, 0))[1]];
  assert.ok(inner < 1 && end < inner && thinning(Rw.at(3, 1, 0))[0] === 0, 'a run is drawn in across it only, less than a stone alone, its end least');
  // (an arch: nothing under it, and it sees what stands either side)
  const Ra = readsOf(worldOf([[0, 0, 0], [0, 1, 0], [2, 0, 0], [2, 1, 0], [0, 2, 0], [1, 2, 0], [2, 2, 0]])), span = Ra.at(1, 2, 0);
  assert.ok(!span.standing && span.under & (1 << ((-1 + 2) * 5 + 2)) && span.under & (1 << ((1 + 2) * 5 + 2)), 'a span sees both supports');
  const ga = cubes(Ra, 1, 2, 0);
  assert.ok(row(ga, 0) < row(ga, M - 1) && has(ga, MAT.tile), 'its underside is cut in an arch, its edge in tile');
  // (a pier pushed from one side spreads its foot the other way; pushed from both, neither)
  const Rr = readsOf(worldOf(DEMOS.arcade()));
  assert.deepEqual(Rr.at(0, 0, 0).thrust, [0, 3, 0, 3], 'the corner pier is pushed inward both ways: it spreads outward both ways');
  assert.equal(Rr.at(4, 0, 0).thrust[0] + Rr.at(4, 0, 0).thrust[1], 0, 'a pier between two arches: no spread along the run');
  // (the same surroundings, however turned, read alike, turned)
  const corners = [[0, 0, 0], [12, 0, 0], [12, 0, 4], [0, 0, 4]].map((c) => Rr.at(...c));
  assert.equal(new Set(corners.map((r) => r.code)).size, 1, 'the four corners of the arcade read alike');
  assert.equal(new Set(corners.map((r) => r.frame)).size, 4, 'each turned its own way');
  assert.equal(Rw.at(0, 0, 0).code, Rw.at(5, 0, 0).code, "a wall's two ends read alike");
  assert.notEqual(Rw.at(0, 0, 0).code, Rw.at(2, 0, 0).code, 'and unlike its middle');
  console.log('reads ok');
}

// ─── an empty cell: the court it's in, and what that makes of it ───
{
  const R = readsOf(worldOf(DEMOS.courtyard()));
  const [mid, bed, corner, iwan, out] = [R.at(4, 0, 3), R.at(2, 0, 3), R.at(2, 0, 1), R.at(5, 0, 7), R.at(5, 0, -3)];
  assert.equal(mid.court, 4, 'the court meets walls all four ways');
  assert.ok(mid.pool && !bed.pool && !corner.pool, 'water where the walls are far, not against them');
  assert.ok(bed.bed && !bed.tree && corner.tree === 1, 'against a wall a bed, in a corner a tree');
  assert.equal(R.at(2, 1, 1).tree, 2, 'the tree goes on up');
  assert.ok(!iwan.bed && !iwan.tree && !iwan.pool, 'nothing grows under cover');
  assert.ok(out.court < 3 && !out.pool && !out.bed, 'outside the walls, no court');
  assert.ok(has(cubes(R, 5, 0, 3), MAT.water), 'water in the basin');
  assert.ok(has(cubes(R, 2, 0, 3), MAT.leaf), 'shrubs in the bed');
  assert.ok(has(cubes(R, 2, 1, 1), MAT.leaf), 'the tree in the cell over its foot');
  assert.ok(has(cubes(R, 5, 0, 5), MAT.paving), 'paving in the court');
  // (the wall facing the court has windows; the back of the porch, a door)
  assert.ok(has(cubes(R, 3, 1, 6), MAT.glass), 'a window onto the court');
  assert.ok(has(cubes(R, 5, 0, 8), MAT.wood), 'a door at the back of the porch');
  console.log('court ok');
}

// ─── closed, facing out: every demo, and a scatter ───
let rnd = 7; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const scatter = []; for (let i = 0; i < 160; i++) scatter.push([Math.floor(rand() * 7), Math.floor(rand() * rand() * 6), Math.floor(rand() * 7)]);
for (const [name, cells] of [...Object.entries(DEMOS).map(([n, f]) => [n, f()]), ['scatter', scatter]]) {
  clearShapes(); cacheStats.made = 0;
  const t = performance.now(), m = shapes(worldOf(cells)), ms = performance.now() - t;
  const c = closure(m);
  console.log(`${name}: ${m.size} cells shaped (${cacheStats.made} made, ${(ms / Math.max(cacheStats.made, 1)).toFixed(2)} ms each), ${c.tris} triangles, ${c.open} open edges, volume ${c.vol.toFixed(1)}`);
  assert.equal(c.open, 0, `${name}: closed`);
  assert.ok(c.vol > 0, `${name}: facing out`);
}

// ─── the same whatever the order; one block reaches no further than a court and the cells round it ───
{
  const cells = DEMOS.courtyard(), a = worldOf(cells), b = worldOf([...cells].reverse());
  const ma = shapes(a), mb = shapes(b);
  for (const [k, v] of ma) assert.equal(mb.get(k)?.name, v.name, 'same build, same shapes');
  const R = readsOf(a), before = shapes(a, R);
  a.apply([key(5, 0, 3)]); R.changed(5, 0, 3);
  const after = shapes(a, R);
  let far = 0, changed = 0;
  for (const [k, v] of after) if (before.get(k)?.name !== v.name) { changed++; const [x, y, z] = unkey(k); far = Math.max(far, Math.abs(x - 5), Math.abs(y), Math.abs(z - 3)); }
  console.log(`one block in the court: ${changed} shapes change, the furthest ${far} cells off`);
  assert.ok(far <= COURT + 2, 'nothing further than a court and the cells round it changes');
  // (and undone, every shape is as it was)
  a.undo(); R.changed(5, 0, 3);
  for (const [k, v] of shapes(a, R)) assert.equal(before.get(k)?.name, v.name, 'undone: as it was');
}
console.log('blocks ok');

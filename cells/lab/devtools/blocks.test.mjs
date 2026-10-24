// Blocks' reads and shapes, on their own: what a block reads as from what's round it, and what that makes of it
// (a stack tapers as one, a run is drawn in less than a stone alone, its end least; an arch sees both its supports; a
// pier pushed from one side spreads its foot the other way); blocks with the same surroundings, however turned, read
// alike; the mesh of a build closed (no crack where two cells' meshes meet), facing out; the same build the same
// whatever the order it was built in; one block changing nothing more than four cells off; and what a shape costs.
// (node cells/lab/devtools/blocks.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const lab = new URL('../client/blocks/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './world'; export * from './rules'; export * from './shape'; export * from './demos';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const g = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
const { World, key, unkey, Reads, thinning, patch, cellMesh, cacheStats, clearShapes, sideAt, VERTEX, DEMOS } = g;

const worldOf = (cells) => { const w = new World(); for (const c of cells) w.cells.add(key(...c)); return w; };
const readsOf = (w) => new Reads((x, y, z) => w.has(x, y, z));
/** every cell's patch name and mesh (cells within one of a block) */
function shapes(w, R = readsOf(w)) {
  const m = new Map();
  for (const k of w.cells) { const [x, y, z] = unkey(k); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { if (y + b < 0) continue; const kk = key(x + a, y + b, z + c); if (m.has(kk)) continue; const [p, q, r] = unkey(kk); const P = patch((i, j, l) => R.at(i, j, l), p, q, r); m.set(kk, { name: P.name, mesh: cellMesh(P) }); } }
  return m;
}
/** the meshes put together, welded where they meet: every edge met from both sides (closed), and the volume (outward) */
function closure(m) {
  const id = new Map(), wv = [], tris = [];
  // (by distance, not by rounding: two copies of a vertex either side of a rounding boundary are still one)
  const weld = (x, y, z) => {
    const gx = Math.round(x * 1e4), gy = Math.round(y * 1e4), gz = Math.round(z * 1e4);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      for (const n of id.get(`${gx + a},${gy + b},${gz + c}`) ?? []) { const v = wv[n]; if (Math.abs(v[0] - x) < 2e-5 && Math.abs(v[1] - y) < 2e-5 && Math.abs(v[2] - z) < 2e-5) return n; }
    }
    const n = wv.length, k = `${gx},${gy},${gz}`;
    wv.push([x, y, z]); id.set(k, [...(id.get(k) ?? []), n]);
    return n;
  };
  for (const [k, { mesh }] of m) {
    const [x, y, z] = unkey(k), base = [];
    for (let q = 0; q < mesh.v.length; q += VERTEX) base.push(weld(mesh.v[q] + x, mesh.v[q + 1] + y, mesh.v[q + 2] + z));
    for (let q = 0; q < mesh.i.length; q += 3) tris.push([base[mesh.i[q]], base[mesh.i[q + 1]], base[mesh.i[q + 2]]]);
  }
  const edges = new Map(); let vol = 0;
  for (const [a, b, c] of tris) {
    for (const [u, v] of [[a, b], [b, c], [c, a]]) if (u !== v) edges.set(u + ',' + v, (edges.get(u + ',' + v) ?? 0) + 1);
    const [A, B, C] = [wv[a], wv[b], wv[c]];
    vol += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6;
  }
  // (open: an edge with no triangle on its other side, a hole; uneven: met more often one way than the other, where
  // two vertices are welded into one, no hole)
  let open = 0, uneven = 0;
  for (const [k, n] of edges) { const [u, v] = k.split(','), r = edges.get(v + ',' + u) ?? 0; if (!r) open++; else if (r !== n) uneven++; }
  return { open, uneven, vol, tris: tris.length };
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
  assert.ok(sideAt(b2, 0, 0.5) < sideAt(b2, 0, -0.5) && sideAt(b2, 0, -0.5) < sideAt(b1, 0, -0.5), 'it tapers toward its top');
  assert.ok(Math.abs(sideAt(b2, 0, -0.5) - sideAt(b1, 0, 0.5)) < 1e-9 && Math.abs(sideAt(b1, 0, -0.5) - sideAt(b0, 0, 0.5)) < 1e-9, 'blocks stacked agree where they meet');
  assert.ok(sideAt(b0, 0, -0.5) > sideAt(b0, 0, 0), 'its foot flares on the ground');
  // (a wall: drawn in across less than a stone alone; its end, less again: it stands as a pier)
  const wall = []; for (let x = 0; x < 6; x++) wall.push([x, 0, 0], [x, 1, 0]);
  const Rw = readsOf(worldOf(wall));
  const [inner, end] = [thinning(Rw.at(3, 1, 0))[1], thinning(Rw.at(0, 1, 0))[1]];
  assert.ok(inner < 1 && end < inner && thinning(Rw.at(3, 1, 0))[0] === 0, 'a run is drawn in across it only, less than a stone alone, its end least');
  // (an arch: nothing under it, and it sees what stands either side)
  const Ra = readsOf(worldOf([[0, 0, 0], [0, 1, 0], [2, 0, 0], [2, 1, 0], [0, 2, 0], [1, 2, 0], [2, 2, 0]])), span = Ra.at(1, 2, 0);
  assert.ok(!span.standing && span.under & (1 << ((-1 + 2) * 5 + 2)) && span.under & (1 << ((1 + 2) * 5 + 2)), 'a span sees both supports');
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

// ─── closed, facing out: every demo, and a scatter ───
let rnd = 7; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
const scatter = []; for (let i = 0; i < 160; i++) scatter.push([Math.floor(rand() * 7), Math.floor(rand() * rand() * 6), Math.floor(rand() * 7)]);
for (const [name, cells] of [...Object.entries(DEMOS).map(([n, f]) => [n, f()]), ['scatter', scatter]]) {
  clearShapes(); cacheStats.made = 0;
  const t = performance.now(), m = shapes(worldOf(cells)), ms = performance.now() - t;
  const c = closure(m);
  console.log(`${name}: ${m.size} cells shaped (${cacheStats.made} made, ${(ms / Math.max(cacheStats.made, 1)).toFixed(2)} ms each), ${c.tris} triangles, ${c.open} open edges (${c.uneven} uneven), volume ${c.vol.toFixed(1)}`);
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

// Roof Jumps' geometry and runner, on their own: a chunk is the same whenever and in whatever order it's made; every
// box is on the lattice, inside its chunk, and buildings are whole storeys; the mesh is five faces a box; and a runner
// holding a direction (any of sixteen, in several cities) crosses the city in it: it keeps its pace, leaps, climbs,
// never stops for long, never leaves the surface it's standing on. (node cells/lab/devtools/roofjumps.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './city'; export * from './runner'; export * from './rig'; export * from './mesh'; export * from './plan'; export * from './tune';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { plan, foresee, TUNE, HOUSE, DIALS, City, Runner, Rig, CHUNK, STOREY, TAG, VERTEX, chunkMesh, figureMesh, FIGURE } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

// the same chunk, whatever was made before it
{
  const a = new City(3), b = new City(3);
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) a.chunk(i, j);
  assert.deepEqual(b.chunk(1, -2).boxes, a.chunk(1, -2).boxes);
  assert.notDeepEqual(new City(4).chunk(1, -2).boxes, a.chunk(1, -2).boxes);
}
// on the lattice, in the chunk, whole storeys; and a street between chunks
{
  const c = new City(1); let n = 0;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    const ch = c.chunk(i, j);
    assert.ok(ch.boxes.length > 4, 'a chunk has buildings');
    for (const b of ch.boxes) {
      n++;
      for (const v of [b.x0, b.x1, b.z0, b.z1, b.y0, b.y1]) assert.equal(v, Math.round(v));
      assert.ok(b.x0 < b.x1 && b.z0 < b.z1 && b.y0 < b.y1);
      assert.ok(b.x0 >= i * CHUNK + 1 && b.x1 <= (i + 1) * CHUNK - 1 && b.z0 >= j * CHUNK + 1 && b.z1 <= (j + 1) * CHUNK - 1);
      if (b.tag === TAG.BUILDING) { assert.equal(b.y0, 0); assert.equal(b.y1 % STOREY, 0); }
    }
    assert.equal(chunkMesh(ch).length, (ch.boxes.length * 5 + 1) * 6 * VERTEX);
    assert.equal(c.heightAt(i * CHUNK + 0.5, j * CHUNK + 20), 0);
  }
  console.log(`${n} boxes in 49 chunks (${(n / 49).toFixed(0)} a chunk, ${(n * 10 / 49).toFixed(0)} triangles)`);
}
// a runner holding a direction crosses the city in it
{
  const DT = 1 / 120, SECONDS = 60;
  let worst = Infinity, leaps = 0, climbs = 0; const moves = {};
  for (const seed of [1, 2, 7, 31]) for (let k = 0; k < 16; k++) {
    const a = (k / 16) * 2 * Math.PI + 0.1, dx = Math.sin(a), dz = Math.cos(a);
    const city = new City(seed), r = new Runner(city), rig = new Rig(), x0 = r.x, z0 = r.z;
    let stopped = 0, longest = 0;
    for (let i = 0; i < SECONDS / DT; i++) {
      r.step(DT, { x: dx, z: dz, jump: false }); rig.update(DT, r);
      assert.ok(Number.isFinite(r.x + r.y + r.z + r.heading), 'finite');
      const h = city.heightAt(r.x, r.z);
      if (r.state === 'ground') assert.ok(Math.abs(r.y - h) < 1e-6, `stands on the surface (seed ${seed}, dir ${k}, t ${(i * DT).toFixed(2)}: y ${r.y}, surface ${h})`);
      if (r.state === 'air') assert.ok(r.y > h - 0.7, `never inside a building (seed ${seed}, dir ${k}, t ${(i * DT).toFixed(2)}: y ${r.y}, surface ${h})`);
      stopped = r.state !== 'climb' && r.speed < 1 ? stopped + DT : 0; longest = Math.max(longest, stopped);
      if (i % 600 === 0) city.evict(Math.floor(r.x / CHUNK), Math.floor(r.z / CHUNK), 3);
    }
    const made = (r.x - x0) * dx + (r.z - z0) * dz;
    assert.ok(longest < 0.5, `never stops for long (seed ${seed}, dir ${k}: ${longest.toFixed(2)}s)`);
    worst = Math.min(worst, made / SECONDS); leaps += r.leaps; climbs += r.climbs; for (const [m, n] of Object.entries(r.made)) moves[m] = (moves[m] ?? 0) + n;
    const bones = rig.bones(r), o = new Float32Array(FIGURE);
    assert.equal(bones.length, 13); assert.equal(figureMesh(bones, o) * VERTEX, FIGURE);
    assert.ok(o.every(Number.isFinite));
  }
  assert.ok(worst > 5, `makes its way at a run (slowest ${worst.toFixed(1)} m/s made good)`);
  console.log(`64 runs of ${SECONDS}s: slowest ${worst.toFixed(1)} m/s made good; ${leaps} leaps, ${climbs} walls run up`);
  console.log('  moves: ' + Object.entries(moves).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${n}`).join(', '));
  for (const m of ['vault', 'bound', 'flip', 'spring', 'dive', 'glide', 'roll', 'dash', 'wallrun', 'climb']) assert.ok(moves[m] > 20, `it ${m}s`);
}
// the holds: the same whenever made; each a line on its box (an edge along a top, a sill on a face at a storey, a pipe up
// a face, a rail down the middle of something narrow); the boxes the same with or without them; and what the hands reach
// for is on one of them: up a wall, a sill, a pipe or the top edge, in arm's reach; over a unit, its edge
{
  const a = new City(5), b = new City(5); b.chunk(2, 2); b.chunk(-1, 0);
  assert.deepEqual(a.chunk(0, 1).holds, b.chunk(0, 1).holds);
  const kinds = {};
  for (const h of a.chunk(0, 1).holds) {
    kinds[h.kind] = (kinds[h.kind] ?? 0) + 1;
    const mx = (h.ax + h.bx) / 2, mz = (h.az + h.bz) / 2;
    if (h.kind === 'pipe') { assert.ok(h.ax === h.bx && h.az === h.bz && h.ay === 0 && h.by > 0); continue; }
    assert.equal(h.ay, h.by);
    // (just inside what it's on: the surface there is at least as high as it)
    assert.ok(a.heightAt(mx - h.nx * 0.01, mz - h.nz * 0.01) >= h.ay, `${h.kind} is on something`);
    if (h.kind === 'sill') assert.equal(h.ay % STOREY, 0);
  }
  for (const k of ['edge', 'sill', 'pipe', 'rail']) assert.ok(kinds[k] > 0, `a chunk has ${k}s`);
  console.log(`holds in a chunk: ${Object.entries(kinds).map(([k, n]) => `${n} ${k}s`).join(', ')}`);
  let climbs = 0, gripped = 0, vaults = 0, planted = 0;
  for (const seed of [1, 7]) for (const ang of [0.3, 2.1, 4.4]) {
    const city = new City(seed), r = new Runner(city), dx = Math.sin(ang), dz = Math.cos(ang);
    for (let i = 0; i < 120 * 60; i++) {
      r.step(1 / 120, { x: dx, z: dz, jump: false });
      const hands = [r.reach.hl, r.reach.hr].filter(Boolean);
      if (r.state === 'climb') { climbs++; if (hands.length) gripped++; }
      if (r.move === 'vault') { vaults++; if (hands.length) planted++; }
      if (r.state !== 'climb' && r.move !== 'vault') continue;
      for (const p of hands) {
        assert.ok(city.gripAt(p[0], p[1], p[2], 0.05), `a hand's on a hold (${r.move})`);
        if (r.state === 'climb') assert.ok(p[1] - r.y <= TUNE.armReach + 1e-6 && p[1] - r.y > 1 - 1e-6, 'in reach');
      }
    }
  }
  assert.ok(gripped > climbs * 0.25 && planted > vaults * 0.4, `hands find holds (up walls ${gripped} of ${climbs} steps, over things ${planted} of ${vaults})`);
  console.log(`up walls, a hand on a hold ${(100 * gripped / climbs).toFixed(0)}% of the time; over things, ${(100 * planted / vaults).toFixed(0)}%`);
}
// the plan is what happens: a route foreseen is the route run, for as long as the heading holds; the fan has the way
// asked in the middle and a best either side; and a dial turned changes what's foreseen
{
  for (const d of DIALS) assert.ok(d.house >= d.min && d.house <= d.max, `${d.key} within its range`);
  const STEPS = Math.round(TUNE.horizon * 120);
  for (const seed of [1, 7]) for (const a of [0.3, 2.1, 4.4]) {
    const r = new Runner(new City(seed)), dx = Math.sin(a), dz = Math.cos(a);
    for (let i = 0; i < 400; i++) r.step(1 / 120, { x: dx, z: dz, jump: false });
    const route = foresee(r, dx, dz), p = plan(r, dx, dz), before = [r.x, r.y, r.z, r.leaps];
    assert.deepEqual([r.x, r.y, r.z, r.leaps], before, 'thinking moves nothing');
    assert.equal(p.all.length, 2 * TUNE.fan + 1); assert.equal(p.primary.off, 0);
    assert.ok(p.left.off < 0 && p.right.off > 0 && p.best.score >= p.primary.score);
    assert.deepEqual(p.primary.pts, route.pts);
    for (let i = 0; i < STEPS; i++) r.step(1 / 120, { x: dx, z: dz, jump: false });
    const n = route.pts.length;
    assert.ok(Math.hypot(r.x - route.pts[n - 3], r.y - route.pts[n - 2], r.z - route.pts[n - 1]) < 1e-9, 'the route foreseen is the route run');
    assert.ok(route.legs.length >= 3, 'a route is more than the next jump');
  }
  const r = new Runner(new City(1)); for (let i = 0; i < 400; i++) r.step(1 / 120, { x: 0, z: 1, jump: false });
  const a = foresee(r, 0, 1); TUNE.gravity = 9; const b = foresee(r, 0, 1); TUNE.gravity = HOUSE.gravity;
  assert.notDeepEqual(a.pts, b.pts, 'a dial turned is felt');
}
console.log('roofjumps: ok');

// Roof Jumps' geometry and runner, on their own: a chunk is the same whenever and in whatever order it's made; every
// box is on the lattice, inside its chunk, and buildings are whole storeys; the mesh is five faces a box; and a runner
// holding a direction (any of sixteen, in several cities) crosses the city in it: it keeps its pace, leaps, climbs,
// never stops for long, never leaves the surface it's standing on. (node cells/lab/devtools/roofjumps.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const lab = new URL('../client/roofjumps/', import.meta.url).pathname;
const out = await build({ stdin: { contents: `export * from './city'; export * from './runner'; export * from './rig'; export * from './mesh';`, resolveDir: lab, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { City, Runner, Rig, CHUNK, STOREY, TAG, VERTEX, chunkMesh, figureMesh, FIGURE } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

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
  let worst = Infinity, leaps = 0, climbs = 0;
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
    worst = Math.min(worst, made / SECONDS); leaps += r.leaps; climbs += r.climbs;
    const bones = rig.bones(r), o = new Float32Array(FIGURE);
    assert.equal(bones.length, 13); assert.equal(figureMesh(bones, o) * VERTEX, FIGURE);
    assert.ok(o.every(Number.isFinite));
  }
  assert.ok(worst > 5, `makes its way at a run (slowest ${worst.toFixed(1)} m/s made good)`);
  console.log(`64 runs of ${SECONDS}s: slowest ${worst.toFixed(1)} m/s made good; ${leaps} leaps, ${climbs} walls run up`);
}
console.log('roofjumps: ok');

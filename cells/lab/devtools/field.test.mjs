// Field Journal: the anomalies are seeded and stable, few and far between, named by their
// specimens; they clear the wood in their hearts; the projection is the wood's.
// (node cells/lab/devtools/field.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const o = await build({ entryPoints: [new URL('../client/field/finds.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
const F = await import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64'));
const a = F.findsNear(1234, 0, 0, 1200), b = F.findsNear(1234, 0, 0, 1200);
assert.ok(a.length >= 20 && a.length <= 110, `anomalies in a wood, few (${a.length})`);
assert.deepEqual(a, b, 'the same anomalies');
assert.ok(a.some((f) => f.kind === 'crystal') && a.some((f) => f.kind === 'fungus'), 'both kinds');
for (const f of a) assert.ok(f.name && f.name.length > 2 && f.reach >= 30, `named, with a reach: ${f.kind} ${f.name}`);
for (const f of a) for (const g of a) if (f !== g) assert.ok(Math.hypot(f.x - g.x, f.z - g.z) > 60, `apart: ${f.id} ${g.id}`);
assert.notDeepEqual(F.findsNear(99, 0, 0, 1200).map((f) => f.id), a.map((f) => f.id), 'another wood, other anomalies');
// one ahead of you as you arrive
const first = F.findIn(1234, 0, 0);
const st = F.startOf(1234);
assert.ok(first && Math.hypot(first.x - st.x, first.z - st.z) > 64 && Math.hypot(first.x - st.x, first.z - st.z) < 72, `the first is ahead of where you arrive (${first && Math.hypot(first.x - st.x, first.z - st.z).toFixed(0)} m)`);
// cleared in the heart, untouched far off
assert.equal(F.clearedAt(1234, first.x, first.z), 1, 'nothing grows in its heart');
assert.equal(F.clearedAt(1234, first.x + first.reach, first.z), 0, 'the wood at its reach still stands');
// the projection: straight ahead is the middle of the screen; to the right, right of it; behind, nothing
const v = { x: 0, z: 0, eye: 1.6, yaw: 0, f: 800, horizon: 400, W: 1000, H: 1000 };
const ahead = F.project(v, 0, 10, 1.6);
assert.ok(Math.abs(ahead.px - 500) < 1e-6 && Math.abs(ahead.py - 600) < 1e-6, 'ahead, on the horizon');
assert.ok(F.project(v, 3, 10, 1.6).px > 500, 'to the right');
assert.equal(F.project(v, 0, -10, 1.6), null, 'behind');
assert.ok(F.project(v, 0, 10, 0).py > ahead.py, 'the ground is below the horizon');
console.log('field ok', a.length, 'anomalies in 1.2 km;', a.slice(0, 4).map((f) => `${f.kind}: ${f.name} (${f.reach} m)`).join(' · '));

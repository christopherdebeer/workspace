// Field Journal: the finds are seeded and stable, named by their specimens; the projection is the wood's.
// (node cells/lab/devtools/field.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const o = await build({ entryPoints: [new URL('../client/field/finds.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
const F = await import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64'));
const a = F.findsNear(1234, 0, 0, 300), b = F.findsNear(1234, 0, 0, 300);
assert.ok(a.length > 20, `finds in a wood (${a.length})`);
assert.deepEqual(a, b, 'the same finds');
assert.ok(a.some((f) => f.kind === 'crystal') && a.some((f) => f.kind === 'fungus'), 'both kinds');
for (const f of a) assert.ok(f.name && f.name.length > 2, `named: ${f.kind} ${f.name}`);
assert.notDeepEqual(F.findsNear(99, 0, 0, 300).map((f) => f.id), a.map((f) => f.id), 'another wood, other finds');
assert.equal(F.findIn(1234, 0, 0), null, 'none in the clearing you start in');
// the projection: straight ahead is the middle of the screen; to the right, right of it; behind, nothing
const v = { x: 0, z: 0, eye: 1.6, yaw: 0, f: 800, horizon: 400, W: 1000, H: 1000 };
const ahead = F.project(v, 0, 10, 1.6);
assert.ok(Math.abs(ahead.px - 500) < 1e-6 && Math.abs(ahead.py - 600) < 1e-6, 'ahead, on the horizon');
assert.ok(F.project(v, 3, 10, 1.6).px > 500, 'to the right');
assert.equal(F.project(v, 0, -10, 1.6), null, 'behind');
assert.ok(F.project(v, 0, 10, 0).py > ahead.py, 'the ground is below the horizon');
console.log('field ok', a.length, 'finds;', a.slice(0, 3).map((f) => `${f.kind}: ${f.name}`).join(' · '));

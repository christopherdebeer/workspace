// Hat-throwers' rules, on their own: the same seed is the same species and patch; a stalk's day
// runs in order; the vesicle sits at the top. (node cells/lab/devtools/fungi.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const out = await build({ entryPoints: [new URL('../client/fungi/genome.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
const { species, patch, state, along, radius, DAY } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

assert.deepEqual(species(31), species(31));
assert.deepEqual(patch(31, species(31)), patch(31, species(31)));
let throwers = 0;
for (let seed = 1; seed <= 200; seed++) {
  const g = species(seed);
  if (g.throws) throwers++;
  const ps = patch(seed, g);
  assert.equal(ps.length, g.count);
  for (const st of ps.slice(0, 10)) {
    // its day in order, and (a thrower) thrown before the day is out
    assert.ok(st.t0 < st.t1 && st.t1 < st.tv);
    if (g.throws) assert.ok(st.tl > st.tv && st.tl < DAY, `seed ${seed}: throws at ${st.tl}`);
    const mid = state(st, st.tv + 1.5);
    assert.ok(mid.grown === 1 && (!g.throws || mid.swell > 0.5));
    // the vesicle (or the knob) is the widest part, near the top
    const top = Math.max(...[0.85, 0.9, 0.95, 0.98, 0.99].map((u) => radius(st, mid, u)));
    assert.ok(top > radius(st, mid, 0.5), `seed ${seed}: a head on it`);
    const after = state(st, st.tl + 3);
    if (g.throws) assert.ok(after.thrown > 0 && after.slump > 0.9);
    assert.ok(along(st, mid, 1).p[1] > 0);
  }
}
console.log(`${throwers} of 200 throw`);
assert.ok(throwers > 100 && throwers < 190);
console.log('ok');

// Hat-throwers' rules, on their own: the same seed is the same species and patch; all four kinds
// come up; a stalk's day runs in order; an ascus ripens before it fires.
// (node cells/lab/devtools/fungi.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const out = await build({ entryPoints: [new URL('../client/fungi/genome.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
const { species, patch, cushions, litter, state, ascusState, along, radius, DAY } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

assert.deepEqual(species(31), species(31));
assert.deepEqual(patch(31, species(31)), patch(31, species(31)));
const forms = {};
for (let seed = 1; seed <= 300; seed++) {
  const g = species(seed);
  (forms[g.form] ??= []).push(seed);
  const ps = patch(seed, g);
  const cs = cushions(seed, g);
  litter(seed, g);
  if (g.form === 'cup') {
    assert.equal(ps.length, 0);
    assert.equal(cs.length, g.count);
    for (const c of cs) for (const a of c.asci) {
      assert.ok(a.t0 < a.tr && a.tr < a.tl && a.tl < DAY + 4);
      const s = ascusState(a, a.tl - 0.01);
      assert.ok(s.up === 1 && s.ripe === 1 && s.fired < 0);
    }
    continue;
  }
  assert.equal(ps.length, g.count);
  for (const st of ps.slice(0, 10)) {
    assert.ok(st.t0 < st.t1 && st.t1 < st.tv);
    if (g.throws) assert.ok(st.tl > st.tv && st.tl < DAY, `seed ${seed}: throws at ${st.tl}`);
    const mid = state(st, st.tv + 1.5);
    assert.ok(mid.grown === 1 && (!g.throws || mid.swell > 0.5));
    if (g.form === 'thrower' || g.form === 'pin') {
      const top = Math.max(...[0.85, 0.9, 0.95, 0.98, 0.99].map((u) => radius(st, mid, u)));
      assert.ok(top > radius(st, mid, 0.5), `seed ${seed}: a head on it`);
    }
    if (g.form === 'inkcap') {
      assert.ok(st.bell > 0);
      const late = state(st, st.t1 + (st.t1 - st.t0) * 1.7);
      assert.ok(late.open > 0.95, `seed ${seed}: open in its own time`);
    }
    assert.ok(along(st, mid, 1).p[1] > 0);
  }
}
for (const f of ['thrower', 'pin', 'inkcap', 'cup']) {
  console.log(f.padEnd(8), forms[f].length, 'e.g.', forms[f].slice(0, 6).join(' '));
  assert.ok(forms[f].length > 20, f);
}
console.log('ok');

// Crystals' specimens, on their own: the same seed is the same specimen; every variety can be
// asked for; every hull is convex and holds its own centre; growth runs 0 → 1.
// (node cells/lab/devtools/crystals.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const out = await build({ entryPoints: [new URL('../client/crystals/mineral.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
const M = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
assert.deepEqual(M.specimen(31), M.specimen(31));
for (const sp of M.SPECIES) { const s = M.specimen(7, sp.name); assert.equal(s.species.name, sp.name, `asked for ${sp.name}`); }
const kinds = new Set();
for (let seed = 1; seed <= 200; seed++) {
  const s = M.specimen(seed);
  kinds.add(s.species.kind);
  assert.ok(s.crystals.length >= 3 && s.crystals.length <= 12);
  for (const c of s.crystals) {
    for (const g of [0.001, 0.5, 1]) {
      const pl = M.planesOf(c, s.species, g);
      assert.ok(pl.length >= 6 && pl.length <= 24, 'a hull of 6..24 planes');
      for (const p of pl) assert.ok(Math.abs(Math.hypot(...p.n) - 1) < 1e-6, 'unit normals');
      // a point a little way up the axis is inside
      const ax = M.rot(c.R, [0, 1, 0]);
      const h = s.species.habit === 'prism' ? c.len * g * 0.5 : c.r * 0.45;
      assert.ok(M.inside([c.at[0] + ax[0] * h, c.at[1] + ax[1] * h, c.at[2] + ax[2] * h], pl), `seed ${seed}: the axis is inside the hull`);
      const b = M.bound(c, s.species, g);
      assert.ok(b[3] > 0);
    }
    assert.equal(M.growth(c, c.t0 - 1), 0); assert.equal(M.growth(c, c.t0 + c.dur + 1), 1);
  }
}
assert.ok(kinds.size >= 8, `many kinds come up: ${[...kinds].join(', ')}`);
console.log('crystals ok');

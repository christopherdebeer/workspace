// Bamboo's ridge (node cells/lab/devtools/bamboo-ridge.mjs): the cliff tops a playtest found janky (seed 1, at -710, -414,
// running on along -3.01 without turning): the runner taken over them for 15 s. Checks it keeps its pace from top to top
// (bounds that gather speed, not hops braked to their flight), never stalls there, and goes on bounding: it's the
// playtest's own line, kept as its acceptance test.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const CELL = join(dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(join(CELL, 'package.json'))('esbuild');
const o = await build({ stdin: { contents: "export * from './client/bamboo/world.ts'; export * from './client/bamboo/runner.ts'; export * from './client/bamboo/footing.ts';", resolveDir: CELL, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const B = await import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64'));
const world = new B.World(1), me = new B.Runner(world), dt = 1 / 30, T = 15;
const X0 = -709.97, Z0 = -414;
me.x = X0; me.z = Z0; me.heading = me.move = -3.01; me.stream(X0, Z0, 200); me.y = me.feet.at(X0, Z0).y; me.v = B.LOPE;
const seq = [];
let dist = 0, stall = 0, longest = 0, t = 0;
me.onAct = (a) => seq.push(`${a}@${t.toFixed(1)}`);
for (; t < T; t += dt) {
  const px = me.x, pz = me.z;
  me.update(dt, { go: true, turn: 0 }); me.stream(me.x, me.z, 1);
  dist += Math.hypot(me.x - px, me.z - pz);
  if (me.v < 1) { stall += dt; longest = Math.max(longest, stall); } else stall = 0;
}
const bounds = seq.filter((s) => /^(leap|hop)@/.test(s) && Number(s.split('@')[1]) < 4).length;
console.log('moves', seq.join(' '));
console.log(`ran ${dist.toFixed(0)} m in ${T} s (mean ${(dist / T).toFixed(2)} m/s) · longest stall ${longest.toFixed(1)} s · bounds in the first 4 s ${bounds}`);
const ok = [dist / T > 4.5, longest < 1, bounds >= 4];
console.log(ok.every(Boolean) ? 'ok' : `FAIL ${JSON.stringify(ok)}`);
process.exit(ok.every(Boolean) ? 0 : 1);

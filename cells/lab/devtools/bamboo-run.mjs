// Bamboo's run, without drawing (node cells/lab/devtools/bamboo-run.mjs [seconds] [seed]): the runner loping on, turning
// as `auto` turns it, for so long; what it met and how it went. Checks it never runs through a culm, never stalls for
// long, and keeps up its pace.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const CELL = join(dirname(fileURLToPath(import.meta.url)), '..');
const { build } = createRequire(join(CELL, 'package.json'))('esbuild');
const o = await build({ stdin: { contents: "export * from './client/bamboo/world.ts'; export * from './client/bamboo/runner.ts';", resolveDir: CELL, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const B = await import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64'));
const T = Number(process.argv[2] ?? 180), seed = Number(process.argv[3] ?? 1), dt = 1 / 30;
const world = new B.World(seed), me = new B.Runner(world);
me.stream(0, 0, 400); me.y = me.groundAt(0, 0);
let dist = 0, stopped = 0, trail = 0, air = 0, stairs = 0, steps = 0, closest = 9, longestStall = 0, stall = 0, jumps = 0, wasAir = false, minY = 1e9, maxY = -1e9;
me.onStep = (stone) => { steps++; if (stone) stairs++; };
for (let t = 0; t < T; t += dt) {
  const turn = (Math.sin(t * 0.13 + 1.3) * 0.25 + Math.sin(t * 0.051) * 0.2) * dt;
  const px = me.x, pz = me.z;
  me.step(dt, { go: true, turn });
  me.stream(me.x, me.z, 1);
  const d = Math.hypot(me.x - px, me.z - pz); dist += d;
  if (me.v < 1) { stopped += dt; stall += dt; longestStall = Math.max(longestStall, stall); } else stall = 0;
  if (me.onTrail) trail += dt;
  if (me.air) { air += dt; if (!wasAir) jumps++; } wasAir = me.air;
  for (const c of me.culmsNear(me.x, me.z, 1.2)) closest = Math.min(closest, Math.hypot(c.x - me.x, c.z - me.z) - c.r);
  minY = Math.min(minY, me.y); maxY = Math.max(maxY, me.y);
}
const row = (k, v) => console.log(k.padEnd(28), v);
row('ran', `${dist.toFixed(0)} m in ${T} s (mean ${(dist / T).toFixed(2)} m/s)`);
row('on a trail', `${trail.toFixed(0)} s (${((100 * trail) / T).toFixed(0)}%)`);
row('footfalls on stone steps', `${stairs} of ${steps}`);
row('leaps', `${jumps}, ${air.toFixed(1)} s in the air`);
row('slow or stopped', `${stopped.toFixed(1)} s; longest ${longestStall.toFixed(1)} s`);
row('closest to a culm', `${closest.toFixed(2)} m from its skin`);
row('height range', `${minY.toFixed(1)} … ${maxY.toFixed(1)} m`);
const ok = [closest > 0.15, dist / T > 3.5, longestStall < 6];
console.log(ok.every(Boolean) ? 'ok' : `FAIL ${JSON.stringify(ok)}`);

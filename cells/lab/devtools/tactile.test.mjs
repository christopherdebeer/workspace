/**
 * Tactile, end to end and headless: the firmware core (wasm), the virtual hand and IMU, and the
 * scripted operator. Checks that the simulated sensors speak the firmware's axes (a clockwise
 * turn speeds reading up, top-edge-away enters), that a person following the tutorial's own
 * hints completes it, that the narrative's links can be visited and left, and that sensor
 * realism (tremor, noise, walking) is accounted for in false-action counts.
 *
 *   node cells/lab/devtools/tactile.test.mjs
 */
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(tmpdir(), `tactile-test-${Date.now()}.mjs`);
await build({ stdin: { contents: `
  export { Core } from './core'; export { CORE } from './core.gen';
  export * from './imu'; export { Operator } from './operator'; export { run } from './session';`,
  resolveDir: join(here, '../client/tactile'), loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'warning' });
const T = await import(out);

const bytes = Buffer.from(T.CORE.wasm, 'base64');

// 1. axes: a clockwise turn read by the firmware is +roll; top edge away is +pitch
{
  const h = new T.Hand(T.STILL);
  h.place(0.3, 0);
  let a = T.anglesOf(h.step(0.02).accel);
  assert.ok(Math.abs(a.roll - 0.3) < 1e-6 && Math.abs(a.pitch) < 1e-6, 'clockwise is +roll');
  h.place(0, 0.3);
  a = T.anglesOf(h.step(0.02).accel);
  assert.ok(Math.abs(a.pitch - 0.3) < 1e-6 && Math.abs(a.roll) < 1e-6, 'top edge away is +pitch');
  h.place(0, 0); h.targetRoll = 0.4;
  let wz = 0; for (let i = 0; i < 10; i++) wz = Math.min(wz, h.step(0.02).gyro[2]);
  assert.ok(wz < -0.25, 'turning clockwise spins the screen axis past the firmware engage speed');
}

// 2. a person following the hints completes the tutorial, then visits every linked word
{
  const r = await T.run(bytes, { seconds: 240, realism: T.NATURAL, seed: 7 });
  assert.equal(r.tutorialDoneAt !== null, true, `tutorial completes (stuck at ${r.lastStage})`);
  console.log(`  tutorial: ${r.tutorialDoneAt.toFixed(1)} s, per stage ${Object.entries(r.stages).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`);
  for (const w of ['bell', 'study', 'garden', 'stairs']) assert.ok(r.entered.includes(w === 'stairs' ? 'cellar' : w), `entered ${w} (entered: ${r.entered.join(' ')})`);
  assert.ok(r.exits >= 4, 'returned from each');
  console.log(`  narrative: entered ${r.entered.join(', ')}; ${r.words} words shown; notices ${JSON.stringify(r.notices)}`);
}

// 3. holding still, with tremor and noise, does nothing but read
{
  const r = await T.run(bytes, { seconds: 120, realism: T.NATURAL, seed: 3, tutorialDone: true, idle: true });
  assert.equal(r.entered.length, 0, 'no accidental enter while held still');
  assert.equal(r.exits, 0, 'no accidental exit while held still');
  assert.ok(Math.abs(r.finalRate - 1) < 0.01, `pace retained (${r.finalRate})`);
  console.log('  still hand, 120 s: no depth events, pace retained');
}

// 4. walking while reading: count what the gait does to an untouched reader
{
  const r = await T.run(bytes, { seconds: 120, realism: { ...T.NATURAL, walk: 1 }, seed: 5, tutorialDone: true, idle: true });
  console.log(`  walking, 120 s, no intent: ${r.entered.length} enters, ${r.exits} exits, final rate ${r.finalRate.toFixed(2)}, notices ${JSON.stringify(r.notices)}`);
}
console.log('tactile simulator: firmware core, IMU axes, operator and realism checks passed');

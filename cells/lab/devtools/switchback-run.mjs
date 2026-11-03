// Switchback's ride test (node cells/lab/devtools/switchback-run.mjs [seconds] [seed…]): the auto rider down a seeded
// course, no page: does it keep to the line, clear the kickers, hold its pace. Prints a line per seed and ok / FAIL.
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url));
const outfile = join(tmpdir(), `switchback-${process.pid}.mjs`);
await build({ stdin: { contents: `export * from './client/switchback/sim'; export * from './client/switchback/course';`, resolveDir: join(here, '..'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { Rider, Course, autoRide } = await import(outfile);
const secs = Number(process.argv[2] ?? 180), seeds = process.argv.slice(3).map(Number);
let bad = 0;
for (const seed of seeds.length ? seeds : [1, 2, 3]) {
  const r = new Rider(new Course(seed)), dt = 1 / 120;
  let vSum = 0, n = 0, launches = 0, kickers = 0, cleared = 0, inKicker = false, crashAt = 0, pins = 0, inPin = false, walls = 0;
  for (let t = 0; t < secs; t += dt) {
    const f = r.course.at(r.s).feature, was = r.crashes;
    if (f === 'ramp' && !inKicker) { inKicker = true; kickers++; crashAt = r.crashes; }
    if (inKicker && f === 'none' && !r.air) { inKicker = false; if (r.crashes === crashAt) cleared++; }
    r.step(dt, autoRide(r));
    void was; vSum += r.v; n++;
    const pin = r.course.at(r.s).pin; if (pin && !inPin) pins++; inPin = pin;
    for (const e of r.events.splice(0)) if (e.kind === 'wall') walls++;
  }
  launches = r.jumps;
  const mean = vSum / n, ok = r.crashes <= 2 && mean > 16 && pins >= 4 && (kickers === 0 || cleared >= kickers - 1);
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  seed ${seed}: ${r.dist.toFixed(0)} m in ${secs} s, mean ${(mean * 3.6).toFixed(0)} km/h, ${r.crashes} crashes, ${walls} walls, ${pins} hairpins, kickers ${cleared}/${kickers}, ${launches} launches, best air ${r.bestAir.toFixed(2)} s`);
}
// (and nothing steers for you: hands off, the bike runs straight on and leaves the line at the first real bend)
{
  const r = new Rider(new Course(1)); let t = 0;
  for (; t < 60 && !r.crashes && Math.abs(r.u) < r.course.at(r.s).width / 2 + 3; t += 1 / 120) r.step(1 / 120, { steer: 0, brake: false });
  const ok = t < 30; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  hands off: off the line after ${t.toFixed(1)} s (nothing steers for you)`);
}
process.exit(bad ? 1 : 0);

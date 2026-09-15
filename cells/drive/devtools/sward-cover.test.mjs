/**
 * ── THE COVER RASTER STOPS DRAWING RECTANGLES IN THE GRASS, IN PURE NODE ──
 *
 *   node cells/drive/devtools/sward-cover.test.mjs
 *
 * The claim is about a BOUNDARY, so the test is a transect across one: an
 * authored raster that is grass on one side of a line and bare on the other,
 * sampled every metre. What it must show is that the old read produces a step
 * and the new one produces a ramp — and, because a blurred straight line is
 * still a straight line, that the ramp is not in the same place all the way
 * along the boundary.
 *
 * `strength 0` reproduces the old read exactly, which is what makes every one
 * of these a measurement rather than an assertion about a number nobody can
 * compare.
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..'), ROOT = join(HERE, '../../..');
const OUT = join(ROOT, 'node_modules/.cache/sward-cover');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'sward-cover.mjs');
execSync(`npx esbuild ${join(CELL, 'client/sward-cover.ts')} --bundle --platform=node --format=esm --outfile=${BUNDLE}`,
  { stdio: 'inherit' });
const { swardCoverEvidence, GRASS_M2, SWARD_EV } = await import(BUNDLE);

let fails = 0;
const ok = (name, cond, detail = '') => {
  if (cond) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};
/** A z12 cover raster: ~30 m pixels, grass west of x=0 and bare east of it. */
const PX = 30;
const split = (west, east) => (x) => (Math.floor(x / PX) < 0 ? west : east);

console.log('the priors are priors, not fences:');
{
  ok('bare ground is no longer mathematically impossible grass',
    GRASS_M2[60] > 0.02, `bare ${GRASS_M2[60]}`);
  ok('…but it is still far short of a meadow', GRASS_M2[60] < GRASS_M2[30] * 0.15,
    `${GRASS_M2[60]} against ${GRASS_M2[30]}`);
  ok('built ground keeps its verges', GRASS_M2[50] > 0.02);
  ok('water and snow are the two real zeroes',
    GRASS_M2[80] === 0 && GRASS_M2[70] === 0);
}

console.log('\na grass/bare boundary is a ramp, not a step:');
{
  const cover = split(30, 60);
  const at = (x, s) => swardCoverEvidence((cx) => cover(cx), x, 0, s);
  const xs = [];
  for (let x = -60; x <= 60; x += 3) xs.push(x);
  const oldR = xs.map((x) => at(x, 0)), newR = xs.map((x) => at(x, 1));
  // ── THE MEASUREMENT IS THE TRANSITION'S WIDTH AND HOW MANY LEVELS IT HAS ──
  //
  // Not a jump threshold, which the first cut used and which a 3 m transect
  // confounds: over a binary boundary the evidence can only take as many
  // values as the kernel has weight units, so the levels are discrete BY
  // CONSTRUCTION and two of them landing within one transect step reads as one
  // large jump. What matters is that the change is spread over metres of
  // ground instead of happening between two adjacent raster pixels, and that
  // it arrives in several steps rather than one.
  const hi = GRASS_M2[30], lo = GRASS_M2[60], range = hi - lo;
  const width = (s) => {
    let a = NaN, b = NaN;
    for (let x = -80; x <= 80; x += 0.5) {
      const v = at(x, s);
      if (a !== a && v < lo + range * 0.9) a = x;
      if (v < lo + range * 0.1) { b = x; break; }
    }
    return b - a;
  };
  const levels = (r) => new Set(r.map((v) => v.toFixed(3))).size;
  console.log(`  old: ${oldR.map((v) => v.toFixed(2)).join(' ')}`);
  console.log(`  new: ${newR.map((v) => v.toFixed(2)).join(' ')}`);
  console.log(`  transition width: old ${width(0).toFixed(1)} m, new ${width(1).toFixed(1)} m`
    + ` · distinct levels across the transect: old ${levels(oldR)}, new ${levels(newR)}`);
  ok('the old read changes between two adjacent raster pixels', width(0) < 1.5,
    `${width(0).toFixed(1)} m`);
  ok('the new one is spread over metres of ground', width(1) > 12, `${width(1).toFixed(1)} m`);
  ok('…in several steps and not one', levels(newR) >= 6, `${levels(newR)} levels`);
  // …AND IT IS STILL A BOUNDARY. A kernel wide enough to remove the step and
  // wide enough to remove the MEADOW would be a worse answer than the step.
  ok('the meadow is still a meadow well inside it', newR[0] > GRASS_M2[30] * 0.85,
    `${newR[0].toFixed(2)} against ${GRASS_M2[30]}`);
  ok('…and the bare ground is still bare well past it',
    newR[newR.length - 1] < GRASS_M2[60] * 2.2, `${newR[newR.length - 1].toFixed(3)}`);
  const span = (r) => Math.max(...r) - Math.min(...r);
  ok('the full range survives', span(newR) > span(oldR) * 0.8,
    `${span(newR).toFixed(2)} against ${span(oldR).toFixed(2)}`);
}

console.log('\n…and the boundary is irregular, not a blurred straight line:');
{
  // Where the ramp crosses its own half-way point, measured along the edge. A
  // blur of a straight raster boundary crosses at the same x at every z; an
  // edge whose SAMPLES are warped does not, and that is the whole difference
  // between this and simply blurring WorldCover.
  const cover = split(30, 60);
  const half = (GRASS_M2[30] + GRASS_M2[60]) / 2;
  const cross = (z) => {
    let prev = swardCoverEvidence((cx) => cover(cx), -70, z, 1);
    for (let x = -70; x <= 70; x += 0.5) {
      const v = swardCoverEvidence((cx) => cover(cx), x, z, 1);
      if (prev > half && v <= half) return x;
      prev = v;
    }
    return NaN;
  };
  const zs = [];
  for (let z = -90; z <= 90; z += 9) zs.push(cross(z));
  const good = zs.filter((v) => v === v);
  const spread = Math.max(...good) - Math.min(...good);
  const sd = Math.sqrt(good.reduce((a, v) => a + (v - good.reduce((p, q) => p + q, 0) / good.length) ** 2, 0) / good.length);
  console.log(`  half-way crossing along the edge: ${good.map((v) => v.toFixed(1)).join(' ')}`);
  console.log(`  spread ${spread.toFixed(1)} m, sd ${sd.toFixed(1)} m`);
  ok('the edge wanders along its own length', spread > 6, `${spread.toFixed(1)} m`);
  ok('…and not so far that the patch stops being a patch', spread < SWARD_EV.radiusM * 4,
    `${spread.toFixed(1)} m against a ${SWARD_EV.radiusM} m footprint`);
}

console.log('\nwater and snow are surfaces, and keep their own edges:');
{
  const lake = split(30, 80);
  const onWater = swardCoverEvidence((x) => lake(x), 45, 0, 1);
  const onGrass = swardCoverEvidence((x) => lake(x), -45, 0, 1);
  const nearShore = swardCoverEvidence((x) => lake(x), -6, 0, 1);
  console.log(`  grass ${onGrass.toFixed(2)} · six metres short of the shore ${nearShore.toFixed(2)}`
    + ` · on the water ${onWater.toFixed(2)}`);
  ok('no grass grows on the lake', onWater === 0, `${onWater}`);
  ok('…however much meadow surrounds it', swardCoverEvidence((x) => lake(x), 31, 0, 1) === 0);
  ok('and the bank still thins toward it', nearShore < onGrass * 0.92,
    `${nearShore.toFixed(2)} against ${onGrass.toFixed(2)}`);
  const snow = split(30, 70);
  ok('snow is the same rule', swardCoverEvidence((x) => snow(x), 45, 0, 1) === 0);
}

console.log('\nand the control reproduces the old read exactly:');
{
  const cover = (x) => (Math.floor(x / PX) % 3 === 0 ? 30 : Math.floor(x / PX) % 3 === 1 ? 60 : 10);
  let same = true;
  for (let x = -200; x <= 200; x += 1.3) {
    const exp = GRASS_M2[cover(x)];
    if (Math.abs(swardCoverEvidence((cx) => cover(cx), x, 0, 0) - exp) > 1e-12) same = false;
  }
  ok('strength 0 is the nearest-neighbour table, to the bit', same);
  ok('an unmapped point abstains toward the middle rather than voting bare',
    swardCoverEvidence(() => null, 0, 0, 1) > 0.2);
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok — the raster stops drawing rectangles');
process.exit(fails ? 1 : 0);

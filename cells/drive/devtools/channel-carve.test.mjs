/**
 * THE CARVE MEASURES TO THE SEGMENT, NOT TO ITS INFINITE LINE.
 *
 *   node cells/drive/devtools/channel-carve.test.mjs
 *
 * `channelFloorAt` clamps `t` to the segment and then decides how far the point
 * is from the channel. For an INTERIOR `t` the foot of the perpendicular is on
 * the segment and every way of measuring agrees. For a CLAMPED `t` the foot is
 * an ENDPOINT, and the cross product of the unit direction with the vector to
 * the point is the offset from the segment's INFINITE LINE — the along-line
 * overshoot thrown away. That is what shipped, and it let a five-metre stretch
 * of river carve ground sixty metres past its own end.
 *
 * The old expression is the control here, as `clip.test.mjs` keeps the vertex
 * walk it replaced: a regression test that does not fail on the bug it names is
 * decoration. Two claims, and the first matters more than the second:
 *
 *   - WHERE `t` IS INTERIOR NOTHING MOVED. Both rules are run over a dense grid
 *     beside the segment and must agree to the bit, `barRise`'s bank shelf
 *     included — so the fix cannot be carrying a second change in with it.
 *   - PAST AN END THE OLD RULE CARVES AND THIS ONE DOES NOT, and a bend still
 *     carves, because the union of segment capsules already tiles a corner.
 *
 * Pure node: the kernel is bundled and given a store holding one channel.
 */
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..'), ROOT = join(HERE, '../../..');
const OUT = join(ROOT, 'node_modules/.cache/channel-carve');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'terrain-kernel.mjs');
execSync(`npx esbuild ${join(CELL, 'client/terrain-kernel.ts')} --bundle --platform=node --format=esm --outfile=${BUNDLE}`,
  { stdio: 'inherit' });
const K = (await import(BUNDLE)).createTerrainKernel(
  () => ({ a: new Uint8Array(0), b: new Uint8Array(0) }), 1);

let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** A store holding the given channels in every cell the test asks about, so
 *  what is under test is the DISTANCE RULE and never the index's own reach. */
const storeOf = (...segs) => {
  const channels = { get: () => segs, size: segs.length };
  return { grid: 24, channels, baseElev: 0, onRoad: () => false, crossingAt: () => null };
};
/** THE RULE THAT SHIPPED, reproduced for the control. Identical to the kernel's
 *  loop but for the one line: `across` off the infinite line. */
const oldFloor = (segs, x, z, ceiling) => {
  let best = null;
  for (const c of segs) {
    const dx = c.bx - c.ax, dz = c.bz - c.az;
    const t = clamp(((x - c.ax) * dx + (z - c.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const px = c.ax + dx * t, pz = c.az + dz * t;
    const length = Math.hypot(dx, dz) || 1;
    const signedAcross = (dx * (z - pz) - dz * (x - px)) / length;
    const across = Math.abs(signedAcross);
    const out = across - c.hw;
    if (out > 3) continue;
    const cv = c.cv ?? 0;
    const curveT = clamp((Math.abs(cv) - .0015) / (.009 - .0015), 0, 1);
    const curve = curveT * curveT * (3 - 2 * curveT);
    const n = signedAcross / Math.max(.5, c.hw);
    const acrossT = clamp((Math.abs(n) - .30) / (.94 - .30), 0, 1);
    const shelf = acrossT * acrossT * (3 - 2 * acrossT);
    const inside = cv * n > 0 ? 1 : 0;
    const barRise = curve * inside * shelf * Math.min(.48, .12 + c.hw * .035);
    const y = c.ya + (c.yb - c.ya) * t + barRise + Math.max(0, out);
    if (best === null || y < best) best = y;
  }
  return best === null || best >= ceiling ? null : best;
};

const river = { ax: 0, az: 0, bx: 100, bz: 0, hw: 7, ya: 10, yb: 10, cv: 0.006 };
const S = storeOf(river);
const now = (x, z, ceiling = 1000) => K.channelFloorAt(S, x, z, ceiling);

console.log('where t is interior, the fix moved nothing:');
{
  // The grid deliberately misses the ramp's own edge (|z| = hw + 3 exactly) and
  // both segment ends: `|signedAcross|` and `hypot` are equal in the reals for
  // an interior `t` and are two different float computations, so a point sitting
  // exactly on the `out > 3` boundary can fall either side of it by one ulp.
  // That is a property of the comparison, not of the change.
  let n = 0, worst = 0, mismatched = 0, carved = 0;
  for (let x = 6.3; x <= 93.3; x += 0.7) for (let z = -12.1; z <= 12.1; z += 0.2) {
    const a = now(x, z), b = oldFloor([river], x, z, 1000);
    n++;
    if ((a === null) !== (b === null)) { mismatched++; continue; }
    if (a !== null) { carved++; worst = Math.max(worst, Math.abs(a - b)); }
  }
  check(n > 8000, `a dense interior grid was sampled (${n} points)`);
  check(carved > 2000, `and most of it is inside the corridor (${carved} carved)`);
  check(mismatched === 0, `every point agrees about WHETHER it is carved (${mismatched} differ)`);
  check(worst < 1e-9, `and about the floor, barRise included (worst ${worst.toExponential(2)} m)`);
}

console.log('\npast a segment end, the shipped rule carves and this one does not:');
for (const [x, z, trueD] of [[112, 2, 12.2], [160, 2, 60.0], [300, 2, 200.0], [-60, 1, 60.0]]) {
  const a = now(x, z), b = oldFloor([river], x, z, 1000);
  check(b !== null, `CONTROL: the old rule carves (${x},${z}), ${trueD} m from the segment`);
  check(a === null, `and this one leaves it alone`);
}

console.log('\nbeside the segment it carves exactly as before:');
{
  // A STRAIGHT REACH, because the 1:1 bank is a claim about `out` and the
  // curved river above it correctly adds its point-bar shelf on the inside
  // bank (0.24 m at z = 9 with cv 0.006), which would be read as the ramp
  // being wrong. Two questions, two segments.
  const F = storeOf({ ax: 0, az: 0, bx: 100, bz: 0, hw: 7, ya: 10, yb: 10 });
  const at = (x, z, ceiling = 1000) => K.channelFloorAt(F, x, z, ceiling);
  check(at(50, 2) === 10, `the bed at the centre is the invert (${at(50, 2)})`);
  check(Math.abs(at(50, 9) - 12) < 1e-9, `the bank rises 1:1 outside the half width (${at(50, 9)})`);
  check(at(50, 11) === null, `and stops at the 3 m ramp's end (${at(50, 11)})`);
  check(at(50, 2, 5) === null, `a ceiling below the bed refuses (${at(50, 2, 5)})`);
  check(Math.abs(at(50, -9) - 12) < 1e-9, `and both banks alike without a curvature (${at(50, -9)})`);
}

console.log('\na bend keeps its corner, because segment capsules already tile one:');
{
  const a = { ax: 0, az: 0, bx: 100, bz: 0, hw: 7, ya: 10, yb: 10 };
  const b = { ax: 100, az: 0, bx: 100, bz: 100, hw: 7, ya: 10, yb: 12 };
  const B = storeOf(a, b);
  const at = (x, z) => K.channelFloorAt(B, x, z, 1000);
  check(at(100, 0) === 10, `the shared vertex is carved (${at(100, 0)})`);
  check(at(104, -4) !== null, `the outer side of the corner, inside the half width (${at(104, -4)?.toFixed(2)})`);
  check(at(105, -5) !== null, `and at its rim (${at(105, -5)?.toFixed(2)})`);
  check(at(140, -2) === null, `but not forty metres past the bend (${at(140, -2)})`);
  check(at(98, 50) !== null, `the second arm carves along its own length (${at(98, 50)?.toFixed(2)})`);
}

console.log('\nthe bank shelf still knows which bank it is on:');
{
  const l = now(50, 5), r = now(50, -5);
  check(l !== r, `the two banks differ under a curvature (${l?.toFixed(3)} vs ${r?.toFixed(3)})`);
  check(l === oldFloor([river], 50, 5, 1000) && r === oldFloor([river], 50, -5, 1000),
    'and both are what the shipped rule produced');
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);

/**
 * THE FIXTURE WORLD BUILDS THE REAL MESHES, AND ASKS NOBODY FOR THEM.
 *
 *   node cells/drive/devtools/fixture-world.test.mjs
 *
 * Two claims, and the test is worthless without both.
 *
 * THE MESHES ARE THE SHIPPING ONES. Every other lab drives a solver directly,
 * which is exactly why none of them can say anything about the ribbon, the
 * batter, the kerb, the junction, the sward or a façade — those are built by
 * main's own code, and a lab that reimplemented them would be testing the
 * copy. Here the whole game boots and the census names what came out.
 *
 * AND NOTHING WAS FETCHED. The point of authoring the ground is that the world
 * is the same every time it is opened, which stops being true the moment one
 * real tile leaks in. `__demsrc()` counts every DEM source the game has; all
 * zero is the only proof that the ridge on screen is the ridge in the file.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// What each fixture exists to show, as the mesh name the census reports it
// under. `road` covers the carriageway ribbon in every case; the rest is what
// makes that particular fixture worth having.
const CASES = [
  { id: 'crossroads', wants: ['ribbon', 'sward'] },
  { id: 'tee', wants: ['ribbon', 'sward'] },
  { id: 'hairpin', wants: ['ribbon'] },
  { id: 'village', wants: ['ribbon', 'building'] },
  { id: 'ridgeline', wants: ['ribbon', 'veg'] },
];

const errors = [];
for (const c of CASES) {
  const d = await openDrive({
    spot: `fixture=${c.id}&cam=chase&time=DAY`,
    tag: `fixture-${c.id}`, settle: 7000, bootTimeout: 90000,
  });
  await d.page.waitForTimeout(6000);

  const seen = await d.page.evaluate(() => ({
    world: window.__fixworld(),
    dem: window.__demsrc(),
    census: window.__census(),
  }));
  const kinds = Object.keys(seen.census.byCount ?? {});
  const has = (p) => kinds.some((k) => k.toLowerCase().includes(p));

  ok(`${c.id}: the fixture is the world`, seen.world.id === c.id, seen.world);
  ok(`${c.id}: its ways reached the renderer`,
    seen.world.ways > 0 && seen.world.seenWays > 0, seen.world);
  ok(`${c.id}: the corridor was carved`, seen.world.roadCells > 0, seen.world);
  ok(`${c.id}: its ground cover was answered`, seen.world.cover > 0, seen.world);
  // THE CLAIM THAT MAKES THE REST MEAN ANYTHING.
  ok(`${c.id}: not one DEM tile was fetched`,
    (seen.dem.mth | 0) === 0 && (seen.dem.aws | 0) === 0, seen.dem);
  for (const w of c.wants) ok(`${c.id}: built ${w} meshes`, has(w), kinds);

  await d.shot(`fixture-${c.id}`);
  errors.push(...d.errors);
  await d.close();
}

// ── AND THE TUNE TRAVELS ──────────────────────────────────────────
// A fixture nobody can change is a screenshot. The tune rides in the URL, so
// this is the one thing that proves the dials on /lab/world do anything: the
// same fixture, two links, two different worlds.
{
  const d = await openDrive({
    spot: 'fixture=crossroads&ft=relief%3A0%2Ccover%3Aforest%2CroadClass%3Atrack&cam=chase&time=DAY',
    tag: 'fixture-tune', settle: 7000, bootTimeout: 90000,
  });
  await d.page.waitForTimeout(4000);
  const w = await d.page.evaluate(() => window.__fixworld());
  ok('the tune arrives off the URL',
    w.tune?.relief === 0 && w.tune?.cover === 'forest' && w.tune?.roadClass === 'track', w.tune);
  // relief 0 is a billiard table — the one tune whose effect can be asserted
  // rather than looked at.
  const g = w.ground ?? [];
  const flat = g.length ? Math.max(...g) - Math.min(...g) : NaN;
  ok('relief 0 really is flat ground', Number.isFinite(flat) && flat < 1.5, flat);
  errors.push(...d.errors);
  await d.close();
}

console.log(bad ? `\n${bad} FAILED` : '\nall good — the shipping meshes, over authored ground, off the network');
report(errors);
if (bad) process.exitCode = 1;

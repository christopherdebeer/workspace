/**
 * A REPAIRED TILE HAS TO SAY WHICH TILE IT WAS.
 *
 *   node cells/drive/devtools/dem-blame.test.mjs
 *
 * __dem() answered a spike hunt with `tilesRepaired: 2, pixels: 421` — one
 * tile with 413 bad pixels in it, which is the only hard evidence that the
 * elevation data was ever wrong. It could not be followed up, because a count
 * does not say WHERE. Three tiles sampled by hand were clean; the two that
 * were not stayed anonymous.
 *
 * The first attempt at naming them was worse than the gap. fetchHeights set a
 * module-level `demAt` on entry and appended its source after the await, so
 * with tiles streaming concurrently every in-flight call appended to whichever
 * tile was current — `11/1127/1230 mth mth mth mth …` — and a repair would
 * have been filed against the wrong tile. Which is worse than filing it
 * against none, because it reads as evidence.
 *
 * Repairs are rare and cannot be summoned, so what is asserted here is the
 * plumbing they ride on: the label is built from LOCALS and written once, so
 * it names exactly one tile and one source however many fetches overlap.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const d = await openDrive({
  spot: 'lat=-34.09905&lon=18.37835&h=0&cam=chase&wx=clear&time=NOON',
  tag: 'dem-blame', settle: 15000,
});

const dem = await d.page.evaluate(() => window.__dem());
check('the DEM was actually read, so there is a label to check',
  typeof dem.at === 'string' && dem.at.length > 0, dem);
check('ONE TILE AND ONE SOURCE — not a tide mark of every fetch in flight',
  /^\d+\/\d+\/\d+ (mth|aws)$/.test(dem.at ?? ''), dem.at);

// Whatever repairs did happen carry the same label shape, since they are
// written from the same locals.
for (const f of dem.per ?? []) {
  check(`a repair names its tile (${f.what})`,
    /^\d+\/\d+\/\d+ (mth|aws)$/.test(f.tile ?? ''), f);
}
console.log(`      ${dem.tilesRepaired} repaired, ${dem.pixels}px, last read ${dem.at}`);

report(d.errors);
await d.close();
if (bad) process.exitCode = 1;
console.log(bad ? `${bad} FAILED` : 'all good');

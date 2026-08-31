/**
 * WHAT A LINE ON THE CHART WEIGHS.
 *
 *   node cells/drive/devtools/chart-weight.test.mjs
 *
 * Reported from the seat, with two screenshots: the overview's ways are "too
 * bold at close zoom and too faint at far". Both are one fault. The ribbons
 * were built at a width in METRES, scaled off the level's tile size, so their
 * width ON SCREEN was whatever the zoom made of it — fourteen pixels of band
 * across a road at driving zoom, a third of a pixel at regional zoom, from the
 * same class of road.
 *
 * A map's line weight is a statement about IMPORTANCE, and importance does not
 * change when you pinch. So:
 *
 *   A CHART LINE HOLDS ITS WIDTH IN PIXELS AT EVERY ZOOM.
 *
 * Which is checkable without a single tile: the width is a uniform in metres,
 * recomputed from the chart camera, so it must track the zoom in exact
 * proportion. A width that is CONSTANT in metres across two zooms is the old
 * bug; a width that tracks them is the fix.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const SPOT = 'lat=-20.1338&lon=-67.4891&h=45&cam=top&wx=clear';
const errors = [];
/** Boot the chart at one zoom and read what a ribbon is worth there. */
async function at(z) {
  const d = await openDrive({ spot: `${SPOT}&z=${z}`, tag: `weight${z}`, settle: 6000 });
  const ov = await d.page.evaluate(() => window.__overview());
  errors.push(...d.errors);
  await d.close();
  return ov;
}

const near = await at(12);
const far = await at(400);

check('the chart reports its weight in pixels as well as metres',
  near.ribbonPx > 0 && near.pixH > 0, near);
check('near zoom: a ribbon is metres, not kilometres', near.ribbonW > 1 && near.ribbonW < 60, near.ribbonW);
// The whole law, as one ratio: 400/12 of the zoom must be 400/12 of the width.
const want = 400 / 12, got = far.ribbonW / near.ribbonW;
check('a line holds its width in PIXELS across a 33x zoom change',
  Math.abs(got / want - 1) < 0.06, { near: near.ribbonW, far: far.ribbonW, want, got });
// …and the pixel it holds is the one the world is rendered at, not a CSS one.
const px = (w, ov) => w / (ov.ribbonW / ov.ribbonPx);
check('both zooms agree on what one ribbon is worth in pixels',
  Math.abs(px(near.ribbonW, near) - px(far.ribbonW, far)) < 0.01,
  { near: px(near.ribbonW, near), far: px(far.ribbonW, far) });

console.log(bad ? `\n${bad} FAILED` : '\nall good — the chart weighs its lines in pixels');
report(errors);
if (bad) process.exitCode = 1;

/**
 * A MARK GOES WHERE YOU LOOKED.
 *
 *   node cells/drive/devtools/fix-place.test.mjs
 *
 * Reported from the seat: "I double tap in the distance only to have the POI
 * placed ~100m behind and left of me." Two faults, both in chartToWorld, and
 * both from it having been written for the chart and then asked to serve the
 * windscreen.
 *
 * THE FALLBACK HAD NO HEADING IN IT. A tap above the horizon fell through to
 * the flat-chart approximation, which maps screen offsets straight onto world
 * X and Z — true looking down a north-up map, meaningless from the seat. A tap
 * high on the screen therefore went to world -Z whichever way the truck was
 * pointing, at a range set by the chart's zoom: about a hundred metres, in a
 * direction with no relationship to the thumb. Exactly the report.
 *
 * AND THE MARCH BELONGED TO THE WRONG CAMERA. tFar is measured down to a plane
 * 1500m under the chart centre. From a cab 1.5m off the ground a tap near the
 * horizon leaves ray.y near -0.01, so that asks for a march 150km long, still
 * sampled 96 times — one sample per 1.5km, which steps over every hill between
 * here and the horizon.
 *
 * SO THE ASSERTION IS ABOUT DIRECTION BEFORE DISTANCE. Where exactly a mark
 * lands on a distant hillside is a judgement call; whether it lands in FRONT of
 * a truck the driver was looking out of is not. The dot product against the
 * heading is the whole complaint, and it is what fails on the old build.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

/** A double tap at a screen point, through real pointer events. */
async function dbl(page, x, y) {
  for (let i = 0; i < 2; i++) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(700);
}

const errors = [];
// Four headings, because a bug that maps the screen onto world -Z is invisible
// from whichever heading happens to agree with it. Facing north, "behind and
// left" and "ahead" are the same axis — one heading would have passed.
for (const h of [0, 90, 180, 270]) {
  const d = await openDrive({
    spot: `lat=-30.6944&lon=27.7642&h=${h}&cam=cab&wx=clear&t=NOON`,
    tag: `fix-${h}`, settle: 30000,
  });
  const before = await d.page.evaluate(() => ({ x: window.__drive.x, z: window.__drive.z, hdg: window.__drive.heading }));
  // Upper middle of the screen: the distance, out of the windscreen, and the
  // half of the frame where a tap is allowed to mark from the seat.
  await dbl(d.page, 195, 250);
  const fixes = await d.page.evaluate(() => window.__poiList().filter((p) => p.kind === 'survey'));
  check(`h=${h}: the double tap dropped a mark`, fixes.length === 1, fixes);
  if (fixes.length === 1) {
    const at = await d.page.evaluate(() => window.__fixat());
    // NEGATIVE Z IS FORWARD in this world, so the forward vector is
    // (sin h, -cos h) and the mark's offset has to project positively onto it.
    const fx = at.x - before.x, fz = at.z - before.z;
    const fwd = Math.sin(before.hdg) * fx + -Math.cos(before.hdg) * fz;
    const dist = Math.hypot(fx, fz);
    console.log(`      h=${h}: mark ${dist.toFixed(0)}m away, ${fwd.toFixed(0)}m of it AHEAD`);
    check(`h=${h}: the mark is in front of the truck, not behind it`,
      fwd > 0 && fwd > dist * 0.5, { fwd: +fwd.toFixed(1), dist: +dist.toFixed(1) });
  }
  errors.push(...d.errors);
  await d.close();
}

console.log(bad ? `\n${bad} FAILED` : '\nall good — a mark goes where you looked');
report(errors);
if (bad) process.exitCode = 1;

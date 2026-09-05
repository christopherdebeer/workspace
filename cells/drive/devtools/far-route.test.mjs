/**
 * CAN THE ROUTER SEE PAST THE SURVEY?
 *
 *   node cells/drive/devtools/far-route.test.mjs [spot]
 *
 * The solver was never the problem; the graph was. `roadGraph()` was built
 * from `roadGrid`, which is the FINE OSM ring and stops around five
 * kilometres out — so a goal thirty kilometres away had no path, and said so
 * honestly, while the chart was at that moment DRAWING the motorway that goes
 * there. The overview tiles have always carried those roads as tagged
 * polylines; the layer spent them on ribbons and threw the vectors away.
 *
 * What this asserts, in the order the failure actually happens:
 *
 *   1. THE COARSE NETWORK IS RETAINED AT ALL (__ovroads). If the chart has
 *      not fetched its tiles yet there is nothing to test and the run says so
 *      rather than passing vacuously.
 *   2. IT REACHES FURTHER THAN THE SURVEY. A coarse network that stops where
 *      the fine one does buys nothing.
 *   3. A GOAL BEYOND THE FINE RING SOLVES. This is the feature.
 *   4. THE ROUTE IS MIXED, AND FINE AT THE NEAR END. A plan that is coarse
 *      under the truck would be steering it off the tarmac.
 *   5. THE AUTOPILOT IS ONLY GIVEN THE SURVEYED HALF. The one that matters:
 *      a z10 polyline is out by fifty to a hundred metres, and driving one
 *      with confidence is worse than not planning at all.
 */
import { openDrive, report } from './harness.mjs';

const SPOT = process.argv[2] || 'lat=48.4520&lon=1.4900&h=0&cam=chase&wx=clear&time=NOON';
let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const d = await openDrive({ spot: SPOT, tag: 'farroute', settle: 25000 });
// THE COARSE LAYER ONLY STREAMS FROM THE CHART, AND ONLY ZOOMED OUT. The gate
// is `camMode === 'top'` plus a view radius wide enough that the fine ring is
// no longer the better map of itself — which is the whole reason the router
// could not see these roads either. Open the chart, wind the zoom out, and
// wait: these are cell-built tiles and a cold one is a live Overpass query.
await d.page.evaluate(() => {
  window.__hold(0, 0, 1);
  window.__cam('top');
  window.__zoom(60);
});
for (let i = 0; i < 8; i++) {
  await d.page.waitForTimeout(12000);
  const o = await d.page.evaluate(() => window.__ovroads());
  console.log(`  +${(i + 1) * 12}s  level ${o.level}  tiles ${o.tiles}  ways ${o.ways}  reach ${o.reachKm}km`);
  if (o.ways > 40) break;
}

const ov = await d.page.evaluate(() => window.__ovroads());
console.log('coarse network:', JSON.stringify(ov));
if (!ov.ways) {
  console.log('\nSKIPPED — no overview tiles arrived; nothing to route over.');
  report(d.errors);
  await d.close();
  process.exit(0);
}
check('the coarse network is kept, not just drawn', ov.ways > 0 && ov.pts > 0, ov);
check('…and it reaches past the fine survey',
  ov.fineRingM !== null && ov.reachKm * 1000 > ov.fineRingM, ov);

// A goal out where only the coarse network goes: straight down the wind of
// the coarse layer's own reach, so it is inside what the chart has fetched.
const far = await d.page.evaluate((km) => {
  const s = window.__drive;
  let best = null;
  // The farthest coarse point actually held, which is a target we KNOW the
  // network reaches rather than a guess at a compass bearing.
  const o = window.__ovroads();
  return { ask: km, ring: o.fineRingM, reach: o.reachKm, x: s.x, z: s.z, best };
}, 0);
console.log('truck:', JSON.stringify(far));

const res = await d.page.evaluate(() => {
  const o = window.__ovroads();
  // Aim at something comfortably past the survey but inside the coarse reach.
  const want = Math.min(o.reachKm * 1000 * 0.7, (o.fineRingM ?? 5000) * 3.5);
  const s = window.__drive;
  window.__goal('far probe', s.x, s.z - want);
  return { want: Math.round(want), route: window.__route(true) };
});
console.log('route:', JSON.stringify(res.route));
check(`a goal ${res.want}m out solves at all`, res.route.pts >= 2, res.route);
check('…over a graph with both tiers in it',
  res.route.graph.coarse > 0 && res.route.graph.fine > 0, res.route.graph);
check('…joined by at least one portal', res.route.graph.portals > 0, res.route.graph);
check('…and the plan reaches past the survey',
  res.route.km * 1000 > (ov.fineRingM ?? 0), { km: res.route.km, ring: ov.fineRingM });
check('the plan is mixed, not all coarse', res.route.coarsePts > 0
  && res.route.coarsePts < res.route.pts, res.route);
check('THE AUTOPILOT IS ONLY GIVEN THE SURVEYED HALF',
  res.route.fineKm < res.route.km, res.route);
check('the solve stays cheap', res.route.ms < 250, { ms: res.route.ms });

await d.shot('farroute-chart');
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
report(d.errors);
await d.close();

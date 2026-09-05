/**
 * CAN THE ROUTER SEE PAST THE SURVEY?
 *
 *   node cells/drive/devtools/far-route.test.mjs [spot]
 *
 * The solver was never the problem; the graph was. `roadGraph()` was built
 * from `roadGrid`, which is the FINE OSM ring and stops a couple of kilometres
 * out — so a goal thirty kilometres away had no path, and said so honestly,
 * while the chart was at that moment DRAWING the trunk road that goes there.
 *
 * WHY THE COARSE NETWORK IS INJECTED RATHER THAN AWAITED. Three runs went by
 * measuring Overpass instead of the router: z13 arriving after 36s with four
 * kilometres of reach (not enough to prove anything), then z8 not arriving at
 * all in two minutes. The tile path is exercised by the chart every time
 * anyone opens it. What needs a deterministic bench is the part that was
 * written here — the two-tier graph, the portals across the handover, and the
 * rule that keeps the autopilot off a simplified line. So a known network is
 * pushed in with __ovinject and the live one is reported beside it.
 */
import { openDrive, report } from './harness.mjs';

const SPOT = process.argv[2] || 'lat=48.4520&lon=1.4900&h=0&cam=chase&wx=clear&time=NOON';
let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const d = await openDrive({ spot: SPOT, tag: 'farroute', settle: 25000 });
// A spawn coordinate is a wish. The router's first question is which node the
// truck is standing on, and it must be a surveyed one.
const onRoad = await d.page.evaluate(() => window.__toroad(400));
console.log('to road:', JSON.stringify(onRoad));
check('the truck is on a surveyed road', onRoad.ok === true, onRoad);
await d.page.evaluate(() => window.__hold(0, 0, 1));

const geom = await d.page.evaluate(() => {
  const o = window.__ovroads();
  return { ring: o.fineRingM, handover: o.handoverM, x: window.__drive.x, z: window.__drive.z };
});
console.log('geometry:', JSON.stringify(geom));

// A trunk road running north from just inside the handover to 30km out, with a
// deliberate kink so the plan cannot be mistaken for a straight-line fallback.
const built = await d.page.evaluate((g) => {
  const pts = [];
  for (let m = g.handover * 0.9; m <= 30000; m += 250) {
    pts.push([g.x + Math.sin(m / 9000) * 900, g.z - m]);
  }
  return window.__ovinject([pts]);
}, geom);
console.log('injected:', JSON.stringify(built));

const res = await d.page.evaluate((g) => {
  window.__goal('far probe', g.x, g.z - 26000);
  const route = window.__route(true);
  return { route, ov: window.__ovroads() };
}, geom);
console.log('route:', JSON.stringify(res.route));

check('a goal 26km out solves at all', res.route.pts >= 2, res.route);
check('…over a graph with both tiers in it',
  res.route.graph.coarse > 0 && res.route.graph.fine > 0, res.route.graph);
check('…joined by at least one portal', res.route.graph.portals > 0, res.route.graph);
check('…and the plan reaches past the survey',
  res.route.km * 1000 > geom.ring * 2, { km: res.route.km, ring: geom.ring });
check('the plan is mixed, not all coarse',
  res.route.coarsePts > 0 && res.route.coarsePts < res.route.pts, res.route);
// THE ONE THAT MATTERS. A coarse leg is right about the valley and out by a
// hundred metres about the tarmac; steering down one with confidence is worse
// than not planning at all.
check('THE AUTOPILOT IS ONLY GIVEN THE SURVEYED HALF',
  res.route.fineKm > 0 && res.route.fineKm < res.route.km, res.route);
check('…and the driving line it hands over is short',
  res.route.driveTo === 0 || res.route.fineKm * 1000 < geom.ring * 1.6, res.route);
check('the solve stays cheap', res.route.ms < 250, { ms: res.route.ms });

// With the coarse tier taken away again, the same goal must fall back to the
// old honest answer rather than keeping a stale plan.
const off = await d.page.evaluate(() => {
  window.__ovinject();
  return window.__route(true);
});
check('without the coarse tier the far goal is unreachable again',
  off.pts === 0 || off.km * 1000 < geom.ring * 2, off);
console.log('without coarse:', JSON.stringify({ pts: off.pts, km: off.km, last: off.last }));

console.log(`\nplanned ${res.route.km}km, of which ${res.route.fineKm}km is surveyed and `
  + `driveable; ${res.route.coarsePts} of ${res.route.pts} points are the chart's; `
  + `${res.route.graph.portals} portal(s) across a ${res.route.graph.inner}m handover; `
  + `solve ${res.route.ms.toFixed(1)}ms over ${res.route.nodes} nodes.`);
console.log(`the live coarse layer meanwhile: ${JSON.stringify(res.ov)}`);

console.log(bad ? `\n${bad} FAILED` : '\nall ok');
report(d.errors);
await d.close();

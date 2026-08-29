/**
 * POST-MORTEM ON THE SERVICE-WEB JOINS the seam net records but no longer
 * gates on. The net names offending nodes; this stands at Bixby, waits for
 * the same population floor, and dumps the raw end rows at each — heights,
 * cambers, tangents — so the 0.5m steps decompose into WHICH mechanism
 * failed: centrelines parting (deck anchor missed), cambers parting (tilt
 * anchor refused or absent), or a switchback angle the collinearity gate
 * rightly refused.
 */
import { openDrive, report } from './harness.mjs';

const SPOT = 'lat=36.37145&lon=-121.90158&h=340&cam=chase&time=NOON&sunalt=55&wx=clear';
const d = await openDrive({ spot: SPOT, tag: 'join-pm' });
let ks = { joins: 0 };
for (let w = 0; w < 30 && ks.joins < 100; w++) {
  await d.page.waitForTimeout(5000);
  ks = await d.page.evaluate(() => window.__kerbseams(260));
}
console.log('joins:', ks.joins, 'worst:', ks.worstM, 'at:', ks.worstAt);
// The repeat offenders across every run of the net.
const NODES = ks.bad
  .map((b) => b.at)
  .filter((v, i, a) => a.indexOf(v) === i)
  .slice(0, 5)
  .map((s) => s.split(',').map(Number));
for (const [nx, nz] of NODES) {
  const rows = await d.page.evaluate(([x, z]) => window.__joinAt(x, z, 3), [nx, nz]);
  console.log(`\nnode ${nx},${nz}: ${rows.length} ends`);
  for (const r of rows) console.log(' ', JSON.stringify(r));
}
report(d.errors);
await d.close();
process.exit(0);

/**
 * POST-MORTEM ON THE SERVICE-WEB JOINS the seam net records but no longer
 * gates on. The net names offending nodes; this stands at Bixby, waits for
 * the FULL population (a partial one carries different offenders), and dumps
 * the raw end rows at each — heights, cambers, tangents — so the 0.5m steps
 * decompose into WHICH mechanism failed: centrelines parting (deck anchor
 * missed), cambers parting (tilt anchor refused or absent), or two different
 * roads meeting at an angle where kerb-against-kerb is not even the right
 * question. Then it drives the camera to the worst node and photographs it,
 * because a metric arguing with a probe is settled by looking.
 */
import { openDrive, report } from './harness.mjs';

const SPOT = 'lat=36.37145&lon=-121.90158&h=340&cam=chase&time=NOON&sunalt=55&wx=clear';
const d = await openDrive({ spot: SPOT, tag: 'join-pm' });
let ks = { joins: 0 };
for (let w = 0; w < 40 && ks.joins < 300; w++) {
  await d.page.waitForTimeout(5000);
  ks = await d.page.evaluate(() => window.__kerbseams(260));
}
console.log('joins:', ks.joins, 'worst:', ks.worstM, 'at:', ks.worstAt);
const NODES = [[-88, -109], ...ks.bad
  .map((b) => b.at)
  .filter((v, i, a) => a.indexOf(v) === i)
  .slice(0, 4)
  .map((s) => s.split(',').map(Number))]
  .filter((v, i, a) => a.findIndex((q) => q[0] === v[0] && q[1] === v[1]) === i);
for (const [nx, nz] of NODES) {
  const rows = await d.page.evaluate(([x, z]) => window.__joinAt(x, z, 3), [nx, nz]);
  console.log(`\nnode ${nx},${nz}: ${rows.length} ends`);
  for (const r of rows) console.log(' ', JSON.stringify(r));
}
// EYES ON THE WORST NODE. Park a short look back from it, aimed at it.
const [wx, wz] = (ks.worstAt ?? '-88,-109').split(',').map(Number);
await d.page.evaluate(([x, z]) => {
  const s = window.__drive;
  const dx = x - s.x, dz = z - s.z, l = Math.hypot(dx, dz) || 1;
  s.x = x - (dx / l) * 18; s.z = z - (dz / l) * 18;
  s.heading = Math.atan2(dx, -dz);
}, [wx, wz]);
await d.simWait(6);
await d.shot('join-pm-worst');
report(d.errors);
await d.close();
process.exit(0);

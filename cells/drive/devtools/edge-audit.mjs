/**
 * WHAT EVERY ROAD EDGE IN REACH ACTUALLY GOT — the barrier/batter audit.
 *
 *   node cells/drive/devtools/edge-audit.mjs [--spot='lat=..&lon=..&h=..'] \
 *        [--to=lat,lon] [--settle=30000]
 *
 * Reads the three instruments that matter at a kerb, then screenshots:
 *   __edges       what the whole neighbourhood's kerbs were given — earth met,
 *                 railed-or-posted, junction-clipped, or nothing
 *   __railsNear   the PHYSICAL parapets in the wall grid. The difference
 *                 between this and __edges' "railedOrPosted" is the posts:
 *                 first run at Big Sur's Coast Road read 55 marked kerbs and
 *                 ZERO rails, because `unclassified` is 7m wide and the
 *                 parapet gate (RAIL_MIN_W) starts at 7.2m.
 *   __kerbseams   junction join quality where two ways meet
 *
 * `--to` walks the rig in, because junction defects live on arrival paths.
 */
import { openDrive, report, walkTo, WORK } from './harness.mjs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (k, dflt) => {
  const a = args.find((v) => v.startsWith(`--${k}=`));
  return a === undefined ? dflt : a.slice(k.length + 3);
};
const spot = arg('spot', 'lat=36.36521&lon=-121.89010&h=324&cam=chase&time=NOON&sunalt=45');
const to = arg('to', '');
const settle = Number(arg('settle', 30000));

const d = await openDrive({ spot, tag: 'edge' });
await d.page.waitForTimeout(settle);
if (to) {
  const [tlat, tlon] = to.split(',').map(Number);
  await walkTo(d.page, tlat, tlon);
  await d.page.waitForTimeout(12000);
}
console.log('contact:', JSON.stringify(await d.page.evaluate(() => {
  const s = window.__drive;
  return window.__contact(s.x, s.z);
})));
console.log('edges:', JSON.stringify(await d.page.evaluate(() => window.__edges(300))));
console.log('railsNear:', JSON.stringify(await d.page.evaluate(() => window.__railsNear(120))).slice(0, 500));
console.log('kerbseams:', JSON.stringify(await d.page.evaluate(() => window.__kerbseams(200))).slice(0, 500));
await d.shot('edge-audit');
console.log(`-> ${join(WORK, 'edge-audit.png')}`);
report(d.errors);
await d.close();

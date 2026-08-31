/**
 * WHAT THE TRUCK HITS, AND WHAT THE LEDGER SAYS IT SOUNDED LIKE. Two runs:
 *  rail  — Chapman's Peak, held steer into the cliff-side barrier: expects
 *          'metal' impacts and scrape frames.
 *  stone — Monument Valley floor, straight line through the rocks: expects
 *          'stone' impacts.
 * The __impacts ledger records kind+force whether or not audio is armed.
 */
import { openDrive, report } from './harness.mjs';

const runs = [
  { tag: 'rail', spot: 'lat=-34.09885&lon=18.380684&h=255&cam=chase&sunalt=45&wx=clear', steer: 0.14, secs: 14 },
  { tag: 'stone', spot: 'lat=37.0491&lon=-110.0978&h=300&cam=chase&sunalt=45&wx=clear', steer: 0, secs: 16 },
];
for (const r of runs) {
  const d = await openDrive({ spot: r.spot, tag: `col-${r.tag}` });
  await d.page.waitForTimeout(22000);
  await d.page.evaluate((s) => { window.__hold(s, 0.85); }, r.steer);
  await d.simWait(r.secs);
  const out = await d.page.evaluate(() => ({
    impacts: window.__impacts(),
    susp: window.__susp(),
    kmh: window.__real().kmh,
    hull: window.__drive.hull ?? null,
  }));
  await d.page.evaluate(() => { window.__hold(null); });
  const kinds = {};
  for (const q of out.impacts) kinds[q.kind] = (kinds[q.kind] || 0) + 1;
  console.log(`${r.tag}: impacts=${out.impacts.length} kinds=${JSON.stringify(kinds)} kmh=${out.kmh}`);
  console.log(`${r.tag} last:`, JSON.stringify(out.impacts.slice(-6)));
  await d.shot(`col-${r.tag}`);
  report(d.errors);
  await d.close();
}

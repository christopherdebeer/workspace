/**
 * THE MIX, MEASURED AT THE FAULTS. Chapman's Peak: lean on the rail, then
 * throw the truck at a corner — and read the channel gains while it
 * happens. The claim to beat: squeal and scrape at a real fraction of the
 * engine's own gain, not asserted audible but measured so.
 */
import { openDrive, report } from './harness.mjs';

const d = await openDrive({ spot: 'lat=-34.09885&lon=18.380684&h=255&cam=chase&sunalt=45&wx=clear', tag: 'mix' });
await d.page.waitForTimeout(22000);
console.log('arm:', await d.page.evaluate(() => window.__armAudio()));

await d.page.evaluate(() => { window.__hold(0.14, 0.85); });   // into the rail
let peak = { scrape: 0, squeal: 0, eng: 0 };
for (let i = 0; i < 8; i++) {
  await d.simWait(1.2);
  const m = await d.page.evaluate(() => window.__mix());
  peak.scrape = Math.max(peak.scrape, m.scrape); peak.eng = Math.max(peak.eng, m.eng);
  if (i === 0) console.log('mix@rail:', JSON.stringify(m));
}
console.log('rail peaks:', JSON.stringify(peak));

await d.page.evaluate(() => { window.__hold(-0.85, 0.9); });   // hard lock, tarmac
for (let i = 0; i < 6; i++) {
  await d.simWait(1);
  const m = await d.page.evaluate(() => window.__mix());
  peak.squeal = Math.max(peak.squeal, m.squeal);
  if (i === 2) console.log('mix@corner:', JSON.stringify(m), 'skid:', await d.page.evaluate(() => window.__susp().grounded));
}
console.log('final peaks:', JSON.stringify(peak));
await d.page.evaluate(() => { window.__hold(null); });
report(d.errors);
await d.close();

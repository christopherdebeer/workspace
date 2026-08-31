/**
 * ROAD MESH EVIDENCE TOUR. Three hard spots — coast road kerbs, Bixby's
 * deck, Chapman's switchbacks — each photographed solid and in WIRE (the
 * mesh itself), with the seam/edge probes dumped alongside. The material
 * for the ribbon/batter/rail/junction audit.
 */
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const SPOTS = [
  { tag: 'coast', spot: 'lat=36.36521&lon=-121.89010&h=324&cam=chase&time=NOON&sunalt=55&wx=clear' },
  { tag: 'bixby', spot: 'lat=36.37145&lon=-121.90158&h=340&cam=chase&time=NOON&sunalt=55&wx=clear' },
  { tag: 'chapmans', spot: 'lat=-34.09885&lon=18.380684&h=255&cam=chase&time=NOON&sunalt=55&wx=clear' },
];
for (const s of SPOTS) {
  const d = await openDrive({ spot: s.spot, tag: `road-${s.tag}` });
  await d.page.waitForTimeout(35000);
  await d.shot(`road-${s.tag}-solid`);
  console.log(`${s.tag} edges:`, JSON.stringify(await d.page.evaluate(() => window.__edges?.(250) ?? null)).slice(0, 600));
  console.log(`${s.tag} kerbseams:`, JSON.stringify(await d.page.evaluate(() => window.__kerbseams?.(250) ?? null)).slice(0, 900));
  await d.page.evaluate(() => { window.__dial('xray', 2); });
  await d.page.waitForTimeout(5000);
  await d.shot(`road-${s.tag}-wire`);
  await d.page.evaluate(() => { window.__dial('xray', 0); });
  console.log(`-> ${join(WORK, `road-${s.tag}-{solid,wire}.png`)}`);
  report(d.errors);
  await d.close();
}

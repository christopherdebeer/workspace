/**
 * THE SUMMITS, AS SEEN.
 *
 *   node cells/drive/devtools/peaks-view.mjs [--spot=...] [--live]
 *
 * Injects real summits around Big Sur at their real elevations (so the run is
 * the same every time, and needs no Overpass slot) and reads the ranking back:
 * the order must be by APPARENT SIZE, and anything the earth has curved in
 * front of must be flagged rather than drawn as a view. `--live` skips the
 * injection and reads whatever the peak tiles actually delivered.
 */
import { openDrive, report, WORK } from './harness.mjs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const a = args.find((v) => v.startsWith(`--${k}=`)); return a === undefined ? d : a.slice(k.length + 3); };
const spot = arg('spot', 'lat=36.3745&lon=-121.9043&h=90&cam=chase&time=NOON&sunalt=45&wx=clear');

// Real summits, real heights — a local ridge, the Sierra crest ~250km inland,
// and one far enough east that the earth is unarguably in the way.
const FIXTURE = [
  ['Junipero Serra Peak', 36.1447, -121.4225, 1787],
  ['Cone Peak', 36.0505, -121.5085, 1571],
  ['Mount Whitney', 36.5785, -118.2923, 4421],
  ['Mount Shasta', 41.4092, -122.1949, 4322],
  ['Boundary Peak', 37.8460, -118.3512, 4007],
];

const d = await openDrive({ spot, tag: 'peaks' });
await d.page.waitForTimeout(30000);
if (!args.includes('--live')) {
  await d.page.evaluate((fx) => { for (const [n, la, lo, e] of fx) window.__peakadd(n, la, lo, e); }, FIXTURE);
  await d.page.waitForTimeout(1500);
}
const m = await d.page.evaluate(() => window.__peaks(8));
console.log('layer:', JSON.stringify({ tiles: m.tiles, known: m.known, reachKm: m.reachKm, ringKm: m.ringKm }));
for (const p of m.top) {
  console.log(`  ${p.deg.toFixed(2).padStart(6)}deg  ${String(p.ele).padStart(5)}m  ${String(p.km).padStart(7)}km`
    + `  ${p.overHorizon ? 'over-horizon' : 'in view     '}  ${p.name}`);
}
// The ranking must be by apparent angle, not by distance.
const byApp = m.top.every((p, i) => i === 0 || m.top[i - 1].deg >= p.deg);
console.log(`ranking by apparent size: ${byApp ? 'ok' : 'FAIL'}`);
// And the physics: √(2Rh) is the range at which a peak of height h clears the
// horizon, so anything flagged over-horizon must be beyond its own.
let physOk = true;
for (const p of m.top) {
  const reach = Math.sqrt(2 * 6371000 * Math.max(p.ele, 1)) / 1000;
  if (p.overHorizon && p.km < reach * 0.6) physOk = false;
}
console.log(`horizon flags plausible: ${physOk ? 'ok' : 'FAIL'}`);
const drawn = await d.page.evaluate(() => window.__pins().drawn.filter((p) => p.t.includes('M ')));
console.log('drawn peak pins:', JSON.stringify(drawn.map((p) => p.t)));
await d.shot('peaks-view');
console.log(`-> ${join(WORK, 'peaks-view.png')}`);
report(d.errors);
await d.close();
process.exitCode = byApp && physOk ? 0 : 1;

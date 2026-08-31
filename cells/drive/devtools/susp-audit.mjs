/**
 * THE BOUNCE, MEASURED. At the user's Stelvio slope the truck reportedly
 * bounces and slams into the ground on a straight forward drive. Hold a
 * steady throttle with __hold and sample the suspension's frame truth every
 * frame: body vs target, vertical rate vs the ground's own rate, grounded
 * fraction, grade. A bounce loop shows as grounded sawing 1 -> 0 -> 1 with
 * vBodyY flipping sign against terrainVy.
 */
import { openDrive, report } from './harness.mjs';

const spot = process.argv[2] || 'lat=46.55525&lon=10.43907&h=277&cam=chase&sunalt=45&wx=clear';
const d = await openDrive({ spot, tag: 'susp' });
await d.page.waitForTimeout(25000);

await d.page.evaluate(() => { window.__hold(0, 0.8); });
// Collect one sample per rendered frame, in-page, until ~30 sim seconds.
const rows = await d.page.evaluate(() => new Promise((res) => {
  const out = [];
  const t0 = window.__clock().simS;
  const tick = () => {
    const s = window.__susp();
    const r = window.__real();
    out.push({ simS: +(window.__clock().simS - t0).toFixed(2), kmh: r.kmh, ...s });
    if (window.__clock().simS - t0 < 30 && out.length < 400) requestAnimationFrame(tick);
    else res(out);
  };
  requestAnimationFrame(tick);
}));
await d.page.evaluate(() => { window.__hold(null); });

// The story, compressed: min/max grounded, bounce events (grounded < 0.3),
// and the frame rows around each event.
let air = 0, worst = null;
for (let i = 0; i < rows.length; i++) {
  const q = rows[i];
  if (q.grounded < 0.3) { air++; if (!worst || q.grounded < worst.grounded) worst = q; }
}
console.log(`frames=${rows.length} airFrames=${air} (${((air / rows.length) * 100).toFixed(0)}%)`);
console.log('worst:', JSON.stringify(worst));
for (const q of rows.filter((_, i) => i % 4 === 0).slice(0, 60)) {
  console.log(`t=${String(q.simS).padStart(5)} v=${String(q.kmh).padStart(5)}km/h ` +
    `grade=${String(q.gradeDeg).padStart(5)}° gnd=${q.grounded.toFixed(2)} ` +
    `bodyY=${q.bodyY} tY=${q.tY} vBodyY=${String(q.vBodyY).padStart(6)} terrainVy=${String(q.terrainVy).padStart(6)} dt=${q.dt}`);
}
await d.shot('susp-scene');
report(d.errors);
await d.close();

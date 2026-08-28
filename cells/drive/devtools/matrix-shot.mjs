/**
 * EYE CHECK for the control matrix polish: cells fill the strait between
 * map and dial, one uniform gap, drone battery banded under its glyph.
 * Busiest state on purpose — drone up, AUTO engaged, WPT lit, then paused.
 */
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const d = await openDrive({ spot: 'lat=-34.06719&lon=18.37021&h=27&cam=chase&sunalt=55', tag: 'matrix' });
await d.page.waitForTimeout(25000);
await d.page.evaluate(() => { window.__dial('auto', 1); window.__dial('poi', 2); });
await d.page.waitForTimeout(1000);
const tap = async (name) => {
  await d.page.evaluate((n) => {
    const s = window.__autorect().s;
    const r = n === 'auto' ? window.__autorect() : window.__hudrects()[n];
    const c = document.querySelector('canvas');
    const x = (r.x + r.w / 2) * s, y = (r.y + r.h / 2) * s;
    for (const t of ['pointerdown', 'pointerup']) {
      c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, pointerId: 7, bubbles: true }));
    }
  }, name);
};
await tap('auto');
await tap('drone');
console.log('rects:', JSON.stringify(await d.page.evaluate(() => window.__hudrects())));
await d.page.waitForTimeout(8000);           // drone climbs; AGL + battery live
await d.shot('matrix', { timeout: 90000 });
console.log(`-> ${join(WORK, 'matrix.png')}`);
report(d.errors);
await d.close();

/**
 * EYE CHECK for the transport row: rewind · AUTO · WPT at the bottom middle,
 * statuses above, and the justified top row (clock · heading · MENU). AUTO
 * dial flipped to HUD TAB and engaged so the status row speaks.
 */
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const d = await openDrive({ spot: 'lat=-34.06719&lon=18.37021&h=27&cam=cab&sunalt=55', tag: 'hudrow' });
await d.page.waitForTimeout(25000);
await d.page.evaluate(() => {
  window.__dial('auto', 1);          // offer the tab
  window.__dial('poi', 2);           // WPT NEAR so the mode label shows
});
await d.page.waitForTimeout(1000);
// Engage via the chip itself, through the same rect the finger uses.
await d.page.evaluate(() => {
  const r = window.__autorect();
  const c = document.querySelector('canvas');
  const x = (r.x + r.w / 2) * r.s, y = (r.y + r.h / 2) * r.s;
  for (const t of ['pointerdown', 'pointerup']) {
    c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, pointerId: 7, bubbles: true }));
  }
});
await d.page.waitForTimeout(4000);
await d.shot('hud-row', { timeout: 90000 });
console.log(`-> ${join(WORK, 'hud-row.png')}`);
report(d.errors);
await d.close();

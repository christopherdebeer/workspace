/**
 * THE CHART'S KEY (T5–T10 in chart-vocab.md), photographed in named states.
 *
 *   node cells/drive/devtools/chart-key-shot.mjs [tag]   → $DRIVE_WORK/key-<tag>-<state>.png
 *
 * Boots the Camps Bay fixture on the chart, then for each STATE runs its
 * setup in the page and crops the top of the frame, where the key lives.
 * STATES=name1,name2 narrows the list. A reference for judging the key's
 * layout from the seat, not a measurement.
 */
import { join } from 'node:path';
import { openDrive, WORK } from './harness.mjs';

const TAG = process.argv[2] ?? 'now';
const ALL = {
  // What a player who has never touched the key sees.
  default: 'window.__chartlayers?.()',
  // Every checkbox chip on and a ground view up.
  busy: `(() => { const L = window.__chartlayers; for (const id of ['tiles','stream','cover']) L(id, true); })()`,
  // HYDRO switched on last, so T9 shows it and tags itself 1 of 3.
  hydro: `window.__chartlayers('hydro', true)`,
  // A tap on the legend: the same press a finger makes, at the legend's own box.
  rotated: `(() => { const at = window.__chartlayers().legendAt; const c = document.querySelector('canvas');
    for (const t of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(t, { clientX: at.x, clientY: at.y, pointerId: 7, bubbles: true })); })()`,
  // …and once more, to the grid key.
  rotated2: `(() => { const at = window.__chartlayers().legendAt; const c = document.querySelector('canvas');
    for (const t of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(t, { clientX: at.x, clientY: at.y, pointerId: 8, bubbles: true })); })()`,
  // ECO on the ground, pulled out to a regional chart, then from the seat.
  ecowide: `(() => { window.__chartlayers('eco', true); window.__zoom(300); })()`,
  ecoseat: `window.__setcam('chase')`,
  // The seat with TILES and STREAM: the grid over the world, the readout.
  seat: `(() => { window.__setcam('chase'); window.__chartlayers('tiles', true); window.__chartlayers('stream', true); })()`,
  // M2 and M3 flipped by their own taps: heading-up and the cab.
  flipped: `(() => { const h = window.__hudrects(), s = h.s; const c = document.querySelector('canvas');
    let id = 30; for (const r of [h.mapUp, h.pov]) { const x = (r.x + r.w / 2) * s, y = (r.y + r.h / 2) * s;
      for (const t of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, pointerId: id++, bubbles: true })); } })()`,
  // The seat, with the key on it.
  chase: `window.__setcam('chase')`,
  // M7 tapped: the key goes, the views stay.
  keyoff: `(() => { const r = window.__hudrects().key, s = window.__hudrects().s; const c = document.querySelector('canvas');
    const x = (r.x + r.w / 2) * s, y = (r.y + r.h / 2) * s;
    for (const t of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(t, { clientX: x, clientY: y, pointerId: 9, bubbles: true })); })()`,
  // OFF: the whole HUD goes.
  off: `window.__chartlayers('off', true)`,
};
const want = process.env.STATES ? process.env.STATES.split(',') : Object.keys(ALL);
const d = await openDrive({ spot: process.env.SPOT || 'fixture=at-campsbay&cam=top&time=NOON&wx=clear', tag: 'chartkey', settle: 0, bootTimeout: 180000 });
await d.page.waitForTimeout(Number(process.env.BOOT_WAIT || 15000));
await d.page.evaluate(() => document.querySelector('.m-x, .m-close')?.click());
for (const name of want) {
  await d.page.evaluate(ALL[name]);
  await d.page.waitForTimeout(Number(process.env.STATE_WAIT || 6000));
  const st = await d.page.evaluate(() => { const r = window.__chartlayers(); return { on: r.layers.filter((l) => l.on).map((l) => l.id + (l.view ? ':' + l.view : '')), legend: r.legendOrder }; });
  console.log(name, JSON.stringify(st));
  const p = join(WORK, `key-${TAG}-${name}.png`);
  await d.page.screenshot({ path: p, timeout: 240000, ...(process.env.FULL ? {} : { clip: { x: 0, y: 0, width: 390, height: 300 } }) });
  console.log('->', p);
}
console.log('errors', JSON.stringify(d.errors ?? []));
await d.close();

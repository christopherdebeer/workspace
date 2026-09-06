/**
 * ── DOES THE CARD-EDGE FADE ACTUALLY DO ANYTHING? ──
 *
 * Carrying a uniform proves nothing: a shader that fails to link logs to the
 * console and throws, so a frame that still draws trees is not evidence the
 * new branch ran. Two frames of the SAME stand, the only difference being
 * `uEzEdge` — 1.0 is the old behaviour (a card seen edge-on takes whatever the
 * sun gives it) and the shipped 0.62 pulls it toward its neighbours. The
 * measurement is the difference between the two runs, never against nothing.
 *
 *   node devtools/ez-edge-ab.mjs [--place=YOSEMITE]
 */
import { openDrive, report, WORK, decodePng } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const PLACE = arg('place', 'AMAZON');
const errors = [];
const d = await openDrive({
  pagePath: '/lab/flora', tag: 'ez-edge',
  viewport: { width: 900, height: 620 }, settle: 0, bootTimeout: 60000,
});
d.page.on('pageerror', (e) => errors.push(String(e)));
const setDials = (vals) => d.page.evaluate((v) => {
  for (const [id, value] of Object.entries(v)) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`no dial "${id}"`);
    if (el.type === 'checkbox') el.checked = !!value; else el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}, vals);

await d.page.waitForTimeout(2500);
// A canopy filling the frame, still, so the two shots differ in one thing only.
const BASE = { place: PLACE, orbit: false, patch: 40, count: 150, dist: 26, eye: 9, turn: 0.6, seed: 4, bark: 0 };
const shot = async (edge, name) => {
  await setDials({ ...BASE, cardEdge: edge });
  await d.page.waitForTimeout(900);
  await d.shot(name);
  return decodePng(readFileSync(join(WORK, `${name}.png`)));
};
const off = await shot(1, 'ezedge-off');
const on = await shot(0.62, 'ezedge-on');

// Only the stand pane — the dial panel and the charts are identical by
// construction and would dilute the figure toward zero.
let moved = 0, total = 0, worst = 0;
const { w, h, ch } = off;
const x0 = Math.floor(w * 0.36), yEnd = Math.floor(Math.min(h, on.h) * 0.5);
for (let y = 0; y < yEnd; y++) {
  for (let x = x0; x < w; x++) {
    const i = (y * w + x) * ch;
    const dm = Math.max(
      Math.abs(off.px[i] - on.px[i]),
      Math.abs(off.px[i + 1] - on.px[i + 1]),
      Math.abs(off.px[i + 2] - on.px[i + 2]));
    if (dm > worst) worst = dm;
    if (dm > 6) moved++;
    total++;
  }
}
const pct = (100 * moved) / total;
console.log(`\ncard edge 1.00 → 0.62 at ${PLACE}: ${pct.toFixed(2)}% of the stand moved, worst channel ${worst}/255`);
console.log(`frames: ${join(WORK, 'ezedge-off.png')} / ezedge-on.png`);
console.log(pct > 0.5
  ? 'ok   the branch runs and the fade is visible'
  : 'FAIL the two frames are the same — the branch did not run');
await d.close();
report(errors);

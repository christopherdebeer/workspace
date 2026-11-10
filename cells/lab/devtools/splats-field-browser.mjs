// A fitted field drawn by the real renderer from the wireframes' right view (node cells/lab/devtools/
// splats-field-browser.mjs <field> <teacher>): read back as darkness into devtools/out/field/dump-browser-<field>-
// <teacher>-right.json, to score beside the optimiser's own picture of the same field (the fitters' --dump). The two
// should agree; where they don't, a score taken from the optimiser's picture isn't the drawing's.
import { withWood } from './harness.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const [field, teacher] = process.argv.slice(2), dir = new URL('./out/field/', import.meta.url).pathname;
const cam = JSON.parse(readFileSync(`${dir}wires.json`)).find((w) => w.name === 'right');
await withWood(async (wood) => {
  const page = await wood.open(`scene=field&field=${field}&res=1&clean`);
  page.on('pageerror', (e) => console.log('page error', e.message));
  await page.waitForFunction(() => window.__splats.scene?.name === 'field' && window.__splats.drawn > 0, null, { timeout: 180000 });
  await page.evaluate((c) => window.__splats.camera({ yaw: c.yaw, pitch: c.pitch, dist: c.dist, target: c.target, fov: c.fov }), cam);
  await page.waitForTimeout(4000);
  const g = await page.evaluate(() => window.__splats.grab());
  writeFileSync(`${dir}dump-browser-${field}-${teacher}-right.json`, JSON.stringify({ w: g.w, h: g.h, style: teacher, view: 'right', C: g.L.map((L) => +Math.max(0, Math.min(1, (0.906 - L) / (0.906 - 0.12))).toFixed(3)) }));
  console.log(await wood.shot(page, `field-browser-${field}`));
}, { width: 1024, height: 683 });

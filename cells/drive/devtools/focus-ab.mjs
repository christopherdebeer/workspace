/**
 * ── REAL-TIME DEPTH OF FIELD: ONE WORLD, ALL CONTROLS ──
 *
 *   node devtools/focus-ab.mjs
 *   FIX=at-campsbay OUT=docs/images/dof-2026-09-17 node devtools/focus-ab.mjs
 *
 * The run settles one fixture, then changes only live lens uniforms and the
 * art-resolution dial. It captures:
 *
 *   - DOF off against camera DOF with the truck left visible;
 *   - a near-to-far focus pull, including an in-flight frame;
 *   - the same camera lens at 240P, 320P and 480P;
 *   - miniature mode against off on the top camera, including water.
 *
 * Headless Drive can take many wall seconds per frame. Every capture therefore
 * waits for COMPLETED game frames through `__clock().frames`; a timeout alone
 * can photograph the cleared framebuffer while a large frame is still being
 * rasterised and manufacture a byte-identical black A/B.
 */
import { openDrive } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const FIX = process.env.FIX ?? 'at-campsbay';
const OUT = process.env.OUT ?? '/tmp/drive-tools/focus';
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const d = await openDrive({
  spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear&nodraw=1&airblur=0&dof=off&tilt=stock`,
  tag: 'dof-contact', settle: 0, bootTimeout: 240000, dpr: 1,
  headed: process.env.HEADED === '1',
});
const q = (f, ...a) => d.page.evaluate(f, ...a);
async function waitFrames(count = 2) {
  const from = (await q(() => window.__clock())).frames;
  await d.page.waitForFunction(({ from: f, count: n }) => window.__clock().frames >= f + n,
    { from, count }, { timeout: 240000, polling: 100 });
}

let quiet = 0, pw = -1, pc = -1, pb = -1;
for (let i = 0; i < 90; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.seenWays === pw && t.roadCells === pc && t.builds === pb && t.seenWays > 0)
    ? quiet + 1 : 0;
  pw = t.seenWays; pc = t.roadCells; pb = t.builds;
  if (quiet >= 4) break;
}
console.log(`[${elapsed()}] settled: ways ${pw}, roadCells ${pc}, builds ${pb}`);
await q(() => window.__toroad?.(400));
await q(() => { window.__draw(true); window.__hud(false); });
await waitFrames(2);

const pixIndex = { 240: 0, 320: 1, 480: 2 };
async function lens(opts) {
  return q((o) => window.__dof(o), opts);
}
async function setPix(px) {
  await q((i) => window.__dial('pix', i), pixIndex[px]);
}
async function shot(name, { waitMs = 0, frames = 2 } = {}) {
  if (waitMs) await d.page.waitForTimeout(waitMs);
  await waitFrames(frames);
  const probe = await q(() => window.__dof());
  const buffers = probe.active ? await q(() => window.__dofbuf()) : null;
  writeFileSync(`${OUT}/${name}.png`, await d.page.screenshot({ timeout: 240000 }));
  console.log(`  [${elapsed()}] ${name}: ${JSON.stringify(probe)}`);
  if (buffers) console.log(`    buffers: ${JSON.stringify(buffers)}`);
}

await q(() => window.__cam('chase'));
await setPix(320);
await lens({ mode: 'off' });
await shot('01-chase-off-320');

await lens({ mode: 'camera', quality: 'high', aperture: 3, focus: 30, snap: true });
await shot('02-chase-camera-30m-320');

// A focus pull, not two teleports. The transition frame is three completed
// renders after the target moves; the settled endpoint is then snapped so the
// screenshot matrix remains practical under SwiftShader.
await lens({ focus: 15, snap: true });
await shot('03-focus-near-15m-settled');
await lens({ focus: 150 });
await shot('04-focus-far-transition', { frames: 3 });
await lens({ focus: 150, snap: true });
await shot('05-focus-far-150m-settled');

// Same camera, subject and aperture; only the art grid changes.
await lens({ focus: 30, snap: true });
for (const px of [240, 320, 480]) {
  await setPix(px);
  await shot(`06-camera-resolution-${px}`);
}

// The chart is the miniature mode's native view. Camps Bay keeps sea and
// shoreline in the frame, exercising depth-writing water beside land.
await q(() => window.__cam('top'));
await q(() => window.__zoom(0.9));
await setPix(320);
await lens({ mode: 'off' });
await shot('07-top-off-water-320', { waitMs: 6000 });
await lens({ mode: 'miniature', quality: 'high', aperture: 3, focus: 'auto' });
await q(() => window.__tilt({ mode: 'stock', amount: null }));
await shot('08-top-miniature-water-320');

const errs = await q(() => window.__errors?.() ?? []);
console.log(`  page errors: ${errs.length}${errs.length ? ' ' + JSON.stringify(errs.slice(0, 5)) : ''}`);
await d.close();
if (errs.length) process.exitCode = 1;

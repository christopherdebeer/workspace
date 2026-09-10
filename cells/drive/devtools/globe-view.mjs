// THE PLANET, FROM THE CHART, AT FOUR ALTITUDES.
//
//   node cells/drive/devtools/globe-view.mjs
//
// The globe is a BACKDROP: it becomes visible by the streamed shell ceasing to
// reach, so the only way to know it is right is to stand at four zooms across
// that hand-over and look. The numbers beside each frame are the ones that can
// be wrong without being visible — where the sphere is tangent, where its sun
// is, the sun's height at the truck (which must match the world's own sky),
// and whether the far plane clears the horizon.
import { openDrive, WORK } from './harness.mjs';
import { join } from 'node:path';

const TIME = process.env.TIME ? `&time=${process.env.TIME}` : '';
const SPOT = `lat=-29.9872&lon=24.7765&h=0&cam=top&wx=clear${TIME}`;
const ZOOMS = (process.env.Z ?? '2200,11000,40000,110000').split(',').map(Number);
const { page, close } = await openDrive({ spot: `${SPOT}&z=${ZOOMS[0]}`, tag: 'globe', menu: true, settle: 0 });

for (const z of ZOOMS) {
  await page.evaluate((zz) => { window.__cam('top'); window.__zoom(zz); }, z);
  for (let i = 0; i < 80; i++) {
    const at = await page.evaluate((zz) => Math.abs(window.__cam().zoom - zz) < Math.max(1, zz * 0.02), z);
    if (at) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  // The texture is fetched on the first wide chart; give it a moment to land.
  for (let i = 0; i < 40; i++) {
    if (await page.evaluate(() => window.__globe().tex)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  // AND THE RING. A frame taken while the shell is still landing is a frame
  // of one tile standing on the planet with its neighbours missing — which is
  // exactly what a broken placement would look like, and proves nothing. The
  // shell only draws below the hand-over, so past it there is nothing to wait
  // for.
  for (let i = 0; i < 100; i++) {
    const f = await page.evaluate(() => { const x = window.__far(); const g = window.__globe(); return { home: x.inFlight === 0 && x.queued === 0 && x.tiles >= x.asked, free: g.free }; });
    if (f.free > 0 || f.home) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log(`  far: ${JSON.stringify(await page.evaluate(() => { const x = window.__far(); return { tiles: x.tiles, asked: x.asked, level: x.level, sphere: x.sphere, seam: x.seam }; }))}`);
  const g = await page.evaluate(() => window.__globe());
  const sky = await page.evaluate(() => window.__sky());
  console.log(`\nzoom ${z}: ${JSON.stringify(g)}`);
  console.log(`  world's own sun altitude: ${sky.sunAlt ?? sky.alt ?? '(not reported)'}`);
  await page.evaluate(() => window.__draw(true));
  const f0 = await page.evaluate(() => window.__clock().frames);
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__clock().frames) - f0 >= 4) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const shot = join(WORK, `globe-${z}${process.env.TIME ? '-' + process.env.TIME : ''}.png`);
  await page.screenshot({ path: shot, timeout: 240000 });
  console.log(`  frame: ${shot}`);
  await page.evaluate(() => window.__draw(false));
}
const errs = await page.evaluate(() => window.__pageErrors ?? []);
console.log(`\npageerrors: ${errs.length} ${JSON.stringify(errs.slice(0, 3))}`);
await close();

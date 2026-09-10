// WHERE DO THE BLOBS IN THE WIDE CHART'S TERRAIN COME FROM?
//
//   node cells/drive/devtools/far-circles.mjs
//
// Reported from the seat: browsing the wide chart, the streamed far shell
// carries large round dithered patches that the baked globe under it does
// not. Four frames over ONE scene render, so nothing but the named term
// differs between them — the trap `composite()` was put outside the frame
// loop for. The post chain is ablated first because it is the cheapest
// suspect and the one that turns a smooth ramp into a visible boundary:
// 14 levels with a Bayer weave on every boundary it crosses.
import { openDrive, WORK } from './harness.mjs';
import { join } from 'node:path';

const LAT = process.env.LAT ?? '47.0', LON = process.env.LON ?? '8.0';
const Z = Number(process.env.Z ?? 19300);
const SPOT = `lat=${LAT}&lon=${LON}&h=0&cam=top&z=${Z}&wx=clear&time=${process.env.TIME ?? 'DAY'}`;
const { page, close } = await openDrive({ spot: SPOT, tag: 'farcircles', menu: true, settle: 0 });

await page.evaluate((zz) => { window.__cam('top'); window.__zoom(zz); }, Z);
// The shell is 25 z5 DEM fetches through the curl relay. Wait on the ring,
// not on a timeout: a frame taken while it fills is a frame of the globe.
let far = null;
for (let i = 0; i < 200; i++) {
  far = await page.evaluate(() => window.__far());
  if (far.meshes >= 25 && far.inFlight === 0 && far.queued === 0) break;
  await new Promise((r) => setTimeout(r, 3000));
}
const cam = await page.evaluate(() => window.__cam());
const globe = await page.evaluate(() => window.__globe());
console.log(`far    ${JSON.stringify(far)}`);
console.log(`cam    ${JSON.stringify(cam)}`);
console.log(`globe  ${JSON.stringify(globe)}`);
console.log(`dither ${JSON.stringify(await page.evaluate(() => window.__dither()))}`);

await page.evaluate(() => window.__draw(true));
const f0 = await page.evaluate(() => window.__clock().frames);
for (let i = 0; i < 160; i++) {
  if (await page.evaluate(() => window.__clock().frames) - f0 >= 4) break;
  await new Promise((r) => setTimeout(r, 500));
}
await page.evaluate(() => window.__draw(false));

const shots = [];
const shoot = async (name) => {
  const p = join(WORK, `farc-${name}.png`);
  await page.screenshot({ path: p, timeout: 240000 });
  shots.push(p); console.log(`  frame ${name}: ${p}`);
};
// 1. As shipped. 2. The quantiser and the weave taken off the SAME scene
// render, so anything that survives is in the terrain, not in the post.
await shoot('shipped');
await page.evaluate(() => window.__dither({ levels: 256, amt: 0 }));
await shoot('nopost');
await page.evaluate(() => window.__dither({ levels: 14, amt: 0 }));
await shoot('quant-nodither');
// 3. The shell away entirely: the baked globe alone, for the comparison the
// seat is actually making.
await page.evaluate(() => { window.__dither({ levels: 14, amt: 1 }); window.__hide('far'); window.__draw(true); });
const f1 = await page.evaluate(() => window.__clock().frames);
for (let i = 0; i < 160; i++) {
  if (await page.evaluate(() => window.__clock().frames) - f1 >= 4) break;
  await new Promise((r) => setTimeout(r, 500));
}
await page.evaluate(() => window.__draw(false));
await shoot('globe-only');

console.log(`\npageerrors: ${JSON.stringify((await page.evaluate(() => window.__pageErrors ?? [])).slice(0, 3))}`);
await close();

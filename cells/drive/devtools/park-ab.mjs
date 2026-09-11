// WHAT A SHELL TILE COSTS TO PARK, MEASURED IN A LIVE PAGE.
//
//   node cells/drive/devtools/park-ab.mjs            (TAG=fix Z=11000 SPIN=40)
//
// `devtools/park-bytes.mjs` derives the per-tile size from `farSeg`'s own rule;
// this reads what the running game actually charges itself, which is the number
// the budget is spent against — and it takes the frame beside it, because every
// cut to that size is a cut to what a tile STORES and could be a cut to what it
// looks like. Run it on the working tree and again on a control worktree, then
// compare the two printed lines and the two frames.
//
// The spin out and back is not decoration: the park is only populated by an
// EVICTION, so a run that never leaves the ring measures an empty map.
import { openDrive, WORK } from './harness.mjs';
import { join } from 'node:path';

const TAG = process.env.TAG ?? 'fix';
const Z = Number(process.env.Z ?? 11000);
const SPIN = Number(process.env.SPIN ?? 40);
const SPOT = `lat=-29.9872&lon=24.7765&h=0&cam=top&wx=clear&time=NOON&z=${Z}`;
const { page, close } = await openDrive({ spot: SPOT, tag: `park-${TAG}`, menu: true, settle: 0 });

const far = () => page.evaluate(() => window.__far());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ringHome(tries = 100) {
  for (let i = 0; i < tries; i++) {
    const x = await far();
    if (x.inFlight === 0 && x.queued === 0 && x.tiles >= x.asked) return x;
    await sleep(3000);
  }
  return far();
}
await page.evaluate((zz) => { window.__cam('top'); window.__zoom(zz); }, Z);
for (let i = 0; i < 80; i++) {
  if (await page.evaluate((zz) => Math.abs(window.__cam().zoom - zz) < Math.max(1, zz * 0.02), Z)) break;
  await sleep(250);
}
const home = await ringHome();
console.log(`level z${home.level} · ${home.tiles}/${home.asked} tiles`);

// THE FRAME FIRST, while the ring is the one that was built at this focus.
await page.evaluate(() => window.__draw(true));
const f0 = await page.evaluate(() => window.__clock().frames);
for (let i = 0; i < 120; i++) {
  if (await page.evaluate(() => window.__clock().frames) - f0 >= 4) break;
  await sleep(500);
}
const shot = join(WORK, `park-${TAG}-${Z}.png`);
await page.screenshot({ path: shot, timeout: 240000 });
await page.evaluate(() => window.__draw(false));
console.log(`frame: ${shot}`);

// …then the eviction that fills the park, and the return that spends it.
await page.evaluate((d) => window.__globespin(0, d), SPIN);
await sleep(2000);
const away = await ringHome();
console.log(`spun away: ${JSON.stringify(away.park)}`);
await page.evaluate((d) => window.__globespin(0, -d), SPIN);
await sleep(2000);
const back = await ringHome();
console.log(`came back: ${JSON.stringify(back.park)}`);
const p = back.park ?? {};
if (p.tiles) console.log(`PER TILE: ${(p.mb / p.tiles).toFixed(3)} MB   (${p.tiles} parked, cap ${p.capMb} MB, ${p.hits} hits)`);
const errs = await page.evaluate(() => window.__pageErrors ?? []);
console.log(`pageerrors: ${errs.length} ${JSON.stringify(errs.slice(0, 3))}`);
await close();

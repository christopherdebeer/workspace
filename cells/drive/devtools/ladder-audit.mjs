/**
 * WHAT THE LADDER DOES AS YOU PULL OUT — which level is current, how many
 * tiles are standing, and where the streamed ground stops being the picture.
 *
 *   node devtools/ladder-audit.mjs [--spot=...] [Z=z1,z2,...]
 *
 * Written for one question and it answered it on the first run: from the
 * equator the shell NEVER LEAVES z6. `farLevelFor` is fed a radius capped at
 * SIGHT_MAX (1,500km) and a z6 5x5 ring reaches 1,565km there, so z5 — the
 * last rung of FAR_LEVELS — is unreachable at that latitude, and a 375x
 * zoom-out moves nothing. The camera saturates too: 120,000 and 3,000,000
 * produce pixel-identical frames. See LADDER-BELOW-Z5-2026-09-11.md.
 *
 * It prints a row per zoom and leaves a frame per zoom in $DRIVE_WORK. The
 * rows are the evidence; the frames are how you tell whether the numbers
 * describe what a player sees.
 */
import { openDrive, WORK } from './harness.mjs';
import { join } from 'node:path';
// Tshuapa, DRC — on the equator ON PURPOSE: it is where cos(lat) is 1 and the
// ladder's last rung is therefore out of reach. A spot at 30 degrees hides
// that, which is how the rung survived.
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).slice(k.length + 3);
const SPOT = arg('spot', 'lat=0.5000&lon=22.0000&h=0&cam=top&wx=clear&t=NOON');
const ZOOMS = (process.env.Z ?? '2000,8000,30000,120000,600000,3000000').split(',').map(Number);
const { page, close } = await openDrive({ spot: `${SPOT}&z=${ZOOMS[0]}`, tag: 'ladder', menu: true, settle: 0 });
for (const z of ZOOMS) {
  await page.evaluate((zz) => { window.__cam('top'); window.__zoom(zz); }, z);
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate((zz) => Math.abs(window.__cam().zoom - zz) < Math.max(1, zz * 0.02), z)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  for (let i = 0; i < 60; i++) {
    const f = await page.evaluate(() => { const x = window.__far(); return x.inFlight === 0 && x.queued === 0 && x.tiles >= x.asked; });
    if (f) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  const far = await page.evaluate(() => window.__far());
  const globe = await page.evaluate(() => window.__globe());
  const cam = await page.evaluate(() => window.__cam());
  console.log(`zoom ${String(z).padStart(8)} | farZ ${String(far.level).padStart(2)} tiles ${String(far.tiles).padStart(3)}/${String(far.asked).padStart(3)} retired ${far.retired ?? '?'} | globe free ${globe.free} vis ${globe.on ?? globe.visible ?? '?'} | mpp ${cam.mpp ?? '?'}`);
  await page.evaluate(() => window.__draw(true));
  const f0 = await page.evaluate(() => window.__clock().frames);
  for (let i = 0; i < 120; i++) { if (await page.evaluate(() => window.__clock().frames) - f0 >= 4) break; await new Promise((r) => setTimeout(r, 400)); }
  await page.screenshot({ path: join(WORK, `ladder-${z}.png`) });
}
console.log('shots in', WORK);
await close();

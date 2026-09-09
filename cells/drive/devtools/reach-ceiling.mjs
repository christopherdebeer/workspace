// THE CHART AT ITS CEILING, AND WHAT IS UNDER IT.
//
//   node cells/drive/devtools/reach-ceiling.mjs            # the ceiling
//   Z=4000 node cells/drive/devtools/reach-ceiling.mjs     # any zoom
//
// The reach moved from 600km to 1,500km (SIGHT_MAX), which is a zoom ceiling
// of about 11,500 (derived) and a camera two thousand kilometres up. Each
// layer has a rung that only exists to serve it — far z5, cover z4, overview
// z5 — and a rung that nobody has stood on is a rung that may not hold. So:
// arrive at the ceiling, wait for every ring the streamer asks for, and read
// what each layer says of itself, with a frame for the eye.
//
// What a pass looks like: far level 5 with 25/25 tiles and none blind, wide
// cover level 4 with 25/25, overview level 5 with its ring home, viewRadius
// at SIGHT_MAX, no page errors, and the shell's seams under a tenth.
import { openDrive, WORK } from './harness.mjs';
import { join } from 'node:path';

const Z = Number(process.env.Z ?? 11400);
const SPOT = `lat=-29.9872&lon=24.7765&h=0&cam=top&z=${Z}&wx=clear&time=NOON&nodraw=1`;
const { page, close } = await openDrive({ spot: SPOT, tag: `ceiling-${Z}`, menu: true, settle: 0 });

const t0 = Date.now();
let last = '', homeAt = 0;
while (Date.now() - t0 < 600000) {
  const s = await page.evaluate(() => {
    const f = window.__far(), c = window.__cover(), o = window.__ov?.() ?? {}, cam = window.__cam();
    return { zoom: cam.zoom, dist: cam.dist, mpp: cam.mpp, viewR: f.radius,
      far: { z: f.level, tiles: f.tiles, asked: f.asked, retired: f.retired, inFlight: f.inFlight, blind: f.cover?.blind ?? null, mean: f.cover?.mean ?? null },
      cover: c.wide, ov: { z: o.level ?? null, have: o.have ?? null, want: o.want ?? null, wire: o.inFlight ?? null } };
  });
  const line = JSON.stringify(s);
  if (line !== last) { console.log(`  [+${((Date.now() - t0) / 1000).toFixed(0)}s] ${line}`); last = line; }
  const farHome = s.far.asked > 0 && s.far.tiles >= s.far.asked && s.far.inFlight === 0 && s.far.retired === 0;
  const covHome = !s.cover || s.cover.asked === 0 || s.cover.tiles >= s.cover.asked;
  const ovHome = s.ov.want === null || s.ov.have === null || s.ov.have >= s.ov.want;
  if (farHome && covHome && ovHome) { if (!homeAt) homeAt = Date.now(); else if (Date.now() - homeAt > 15000) break; }
  else homeAt = 0;
  await new Promise((r) => setTimeout(r, 3000));
}
const far = await page.evaluate(() => window.__far());
const cam = await page.evaluate(() => window.__cam());
console.log(`\nceiling: zoom ${cam.zoom}, camera ${Math.round(cam.dist / 1000)}km up, ${cam.mpp}m a pixel, viewRadius ${Math.round(far.radius / 1000)}km`);
console.log(`far: z${far.level} ${far.tiles}/${far.asked} tiles, cover ${JSON.stringify(far.cover)}, tint spread ${far.tint?.spread}`);
console.log(`seams: ${JSON.stringify(far.seams)}`);
const live = far.perTile.filter((t) => t.key.startsWith(`${far.level}/`));
console.log(`bake levels on the live shell: ${[...new Set(live.map((t) => t.coverZ))].map((z) => `z${z}:${live.filter((t) => t.coverZ === z).length}`).join(' ')}`);
await page.evaluate(() => window.__draw(true));
const f0 = await page.evaluate(() => window.__clock().frames);
for (let i = 0; i < 120; i++) { const f = await page.evaluate(() => window.__clock().frames); if (f - f0 >= 4) break; await new Promise((r) => setTimeout(r, 500)); }
const shot = join(WORK, `ceiling-${Z}.png`);
await page.screenshot({ path: shot, timeout: 240000 });
console.log(`frame: ${shot}`);
const errs = await page.evaluate(() => window.__pageErrors ?? []);
console.log(`pageerrors: ${errs.length} ${JSON.stringify(errs.slice(0, 3))}`);
await close();

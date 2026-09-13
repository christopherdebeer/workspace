/**
 * ── WHAT A RAILWAY LOOKS LIKE, ON THE SEAT'S OWN SPOT ──
 *
 *   node devtools/railway-shots.mjs            (the fixture, top and cab)
 *   REV=<sha> node devtools/railway-shots.mjs  (the same frames on a control)
 *
 * `at-glencairn` is the first fixture in this repo with a railway in it, so
 * this is the first railway measurement that does not depend on Overpass
 * answering. Four ways of the PRASA Southern Line, the M4 running parallel for
 * the whole length — which is the comparison that matters, because the
 * complaint was that the railway looked like a road and the road is right
 * there in the same frame to be compared with.
 */
import { openDrive } from './harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.env.OUT ?? '/tmp/drive-tools/railway';
mkdirSync(OUT, { recursive: true });
const TAG = process.env.REV ? 'before' : 'after';
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const d = await openDrive({
  spot: 'fixture=at-glencairn&cam=top&time=NOON&wx=clear&cprobe=1&nodraw=1',
  tag: `rail-${TAG}`, settle: 0, bootTimeout: 240000, dpr: 1,
  ...(process.env.REV ? { rev: process.env.REV } : {}),
});
const q = (f, ...a) => d.page.evaluate(f, ...a);
let quiet = 0, pw = -1, pc = -1;
for (let i = 0; i < 90; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.seenWays === pw && t.roadCells === pc && t.roadCells > 0) ? quiet + 1 : 0;
  pw = t.seenWays; pc = t.roadCells;
  if (quiet >= 4) break;
}
const rw = await q(() => window.__railways?.() ?? null);
console.log(`[${el()}] __railways: ${rw ? JSON.stringify({ n: rw.n, kinds: rw.kinds, gauges: rw.gauges, electrified: rw.electrified, materials: rw.materials }) : 'no probe on this build'}`);
if (rw?.list?.length) console.log(`  first way: ${JSON.stringify(rw.list[0])}`);
const cen = await q(() => { const c = window.__census(); return { ribbon: c.byTris?.ribbon ?? null }; });
console.log(`  ribbon triangles: ${JSON.stringify(cen)}`);

// THE TRACK UNDER THE CAMERA, from the probe rather than from a coordinate
// typed in. The first run of this tool guessed and photographed a residential
// street: at a 29 m frame everything is a grey band, and "that must be it" is
// not a measurement. `__railways().list` is sorted longest first, so this is
// the main line and not a siding.
const at = rw?.list?.[0] ? { x: rw.list[0].x, z: rw.list[0].z } : null;
if (!at) throw new Error('no railway in range — the probe found none to stand on');
await q((p) => { window.__place(p.x, p.z); window.__drive.speed = 0; }, at);
console.log(`  standing on way ${rw.list[0].id} at ${at.x},${at.z} (${rw.list[0].len} m of ${rw.list[0].kind})`);
// AND THE CAMERA HAS TO BE TOLD AGAIN AFTER A PLACE. Framing is worthless if
// the rig is drawn over the thing being framed, and the top view centres on it.
await q(() => window.__hide('rig'));
await q(() => window.__draw(true));
await q(() => window.__hud(false));
for (const [name, mode, zoom] of [['top', 'top', 0.35], ['wide', 'top', 1.1]]) {
  await q((m) => window.__cam(m), mode);
  await q((z) => window.__zoom(z), zoom);
  let mpp = -1;
  for (let i = 0; i < 30; i++) {
    await d.page.waitForTimeout(600);
    const m = await q(() => window.__scale().mppCss);
    if (Math.abs(m - mpp) < 1e-4) break;
    mpp = m;
  }
  await d.page.waitForTimeout(2500);
  writeFileSync(`${OUT}/${name}-${TAG}.png`, await d.page.screenshot({ timeout: 180000 }));
}
await q(() => window.__cam('cab'));
await q(() => window.__hide('rig', false));
await d.page.waitForTimeout(4000);
writeFileSync(`${OUT}/cab-${TAG}.png`, await d.page.screenshot({ timeout: 180000 }));
// NO TRANSECT HERE. One was written — find the ballast in the frame, walk a
// line along it, report the autocorrelation at the sleeper pitch — and it was
// abandoned on the seat's own call ("stop the measurement, I can see the
// sleepers"), which is the right call: the thing being judged is whether a
// railway READS as a railway, the frames answer that directly, and the
// instrument had already needed two fixes of its own (it sampled the frame's
// centre, which on a seventy-degree chart is not the ground under the truck;
// then it took the brightest PIXEL and landed on a bloomed speck rather than
// on the three-metre band). An instrument that needs more rounds than the
// thing it measures is not earning its place. The contrast argument that
// mattered is recorded where it belongs, beside the colours in railway.ts.
console.log(`[${el()}] page errors ${d.errors.length} ${JSON.stringify(d.errors.slice(0, 2))}`);
await d.close();
console.log(`frames in ${OUT}`);

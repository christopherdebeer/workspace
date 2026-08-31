/**
 * WHAT THE WATER IS DOING — the instrument for rivers and the truck in them.
 *
 *   node cells/drive/devtools/water.mjs [--spot='lat=..&lon=..&h=..'] \
 *        [--settle=25000] [--scan=1500]
 *
 * Three readings, each aimed at a claim the water code makes:
 *
 *   __rivers        the aggregate the flow solver produced — speeds, rocks,
 *                   and now foamBays, the bays some boulder's wake reaches.
 *                   foamBays at 0 beside a non-zero rock count means the wake
 *                   attribute never made it from the builder to the ribbon.
 *   the field scan  __waterinfo over a grid: does the physics see the same
 *                   rivers the renderer drew, and with what depth and current.
 *   the drift test  park the truck mid-river, hands off, and integrate. The
 *                   current is real only if the truck actually leaves, and
 *                   downstream — the cosine against the channel's own flow
 *                   vector is the number, not just the metres.
 *
 * Ends on a screenshot for the eye check, because every number above can be
 * right while the picture shows a wall.
 */
import { join } from 'node:path';
import { openDrive, report, WORK } from './harness.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => {
  const a = args.find((v) => v.startsWith(`--${k}=`));
  return a === undefined ? d : a.slice(k.length + 3);
};
const spot = arg('spot', 'lat=62.4498&lon=7.6684&h=27&cam=chase');
const settle = Number(arg('settle', 25000));
const scan = Number(arg('scan', 1500));

const d = await openDrive({ spot, tag: 'water' });
await d.page.waitForTimeout(settle);

console.log('rivers:', JSON.stringify(await d.page.evaluate(() => window.__rivers())));

// ON-CHANNEL first: __riverpts stands on the built ribbon, so __waterinfo
// there MUST answer with a current — a zero here is a channel-lookup bug, not
// a sparse scan.
const onChan = await d.page.evaluate(() => window.__riverpts(10).map((p) => ({
  x: p[0], z: p[1], shaderSpeed: p[2], ...window.__waterinfo(p[0], p[1]),
})));
for (const p of onChan.slice(0, 6)) {
  console.log(`  on-channel (${p.x}, ${p.z})  shader ${p.shaderSpeed}  physics ${p.speed}`
    + `  depth ${p.depth}  surface ${p.surface}`);
}

// The field: every point the PHYSICS calls moving water, within reach.
const pts = await d.page.evaluate((r) => {
  const out = [];
  const s = window.__drive;
  for (let dz = -r; dz <= r; dz += 30) {
    for (let dx = -r; dx <= r; dx += 30) {
      const wi = window.__waterinfo(s.x + dx, s.z + dz);
      if (wi.surface === 'water') out.push({ x: s.x + dx, z: s.z + dz, ...wi });
    }
  }
  return out;
}, scan);
const moving = pts.filter((p) => p.speed > 0);
console.log(`water points: ${pts.length}, in current: ${moving.length}`);
const lively = [...moving, ...onChan.filter((p) => p.speed > 0)];
if (lively.length) {
  const sp = lively.map((p) => p.speed).sort((a, b) => a - b);
  console.log(`  deep (>0.9m): ${pts.filter((p) => p.depth > 0.9).length}`
    + `  breaking (>1.35): ${lively.filter((p) => p.speed > 1.35).length}`
    + `  median speed: ${sp[sp.length >> 1].toFixed(2)}`);
  // THE DRIFT TEST, at the liveliest point found.
  const p = lively.reduce((a, b) => (b.speed > a.speed ? b : a));
  const from = await d.page.evaluate((pt) => {
    const s = window.__drive;
    s.x = pt.x; s.z = pt.z; s.speed = 0;
    return { x: s.x, z: s.z };
  }, p);
  await d.simWait(6);
  const after = await d.page.evaluate(() => ({ x: window.__drive.x, z: window.__drive.z }));
  const moved = Math.hypot(after.x - from.x, after.z - from.z);
  const cos = moved > 0.05
    ? ((after.x - from.x) * p.fx + (after.z - from.z) * p.fz) / moved : 0;
  console.log(`  drift: ${moved.toFixed(1)}m in 6 sim-s at water speed ${p.speed}`
    + ` (depth ${p.depth}m), downstream cosine ${cos.toFixed(2)}`);
}
await d.shot('water');
console.log(`-> ${join(WORK, 'water.png')}`);
report(d.errors);
await d.close();

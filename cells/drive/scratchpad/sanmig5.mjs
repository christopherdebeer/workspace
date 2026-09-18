// THE SEAT'S OWN SPOT, AFTER THE CARVE FIX. The transect the investigation
// measured the 112m flat-bottomed trench on, read through __ground (dem, mesh,
// ground, water) so the mesh and the natural ground come from one probe; plus a
// frame with the lens out of the way.
import { openDrive } from '../devtools/harness.mjs';
import { writeFileSync } from 'node:fs';
const d = await openDrive({
  spot: 'lat=37.86119&lon=-107.87094&h=321&cam=chase&tdbg=0&wxlive=0&time=NOON&dof=off&tilt=off',
  tag: 'sanmig5', settle: 0, bootTimeout: 300000,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);
await d.page.waitForTimeout(210000);            // stream, carve and settle

const out = await q(() => {
  const sec = [];
  for (let t = -60; t <= 60; t += 4) {
    const x = 30 + t * Math.cos(Math.PI / 3), z = -50 + t * Math.sin(Math.PI / 3);
    const g = window.__ground(x, z);
    sec.push({ t, dem: g.dem, mesh: g.mesh, ground: g.ground, w: g.water });
  }
  // and the whole grid: how deep is the mesh under the natural ground, wet or dry
  const dig = [];
  for (let z = -300; z <= 300; z += 10) for (let x = -300; x <= 300; x += 10) {
    const g = window.__ground(x, z);
    if (g.dem === null || g.mesh === null) continue;
    dig.push({ x, z, d: g.dem - g.mesh, wet: !!g.water });
  }
  return { sec, dig, origin: window.__origin(), tiles: window.__tstats?.() ?? null };
});
const med = (a) => a.length ? a.slice().sort((p, q2) => p - q2)[a.length >> 1] : NaN;
const pct = (a, p) => a.length ? a.slice().sort((p2, q2) => p2 - q2)[Math.floor(a.length * p)] : NaN;
const all = out.dig.map((r) => r.d), wet = out.dig.filter((r) => r.wet).map((r) => r.d);
writeFileSync(new URL('./sanmig5.json', import.meta.url).pathname,
  JSON.stringify({ ...out, errors: d.errors }, null, 1));
await d.page.screenshot({ path: new URL('./sanmig5.png', import.meta.url).pathname });
console.log('errors', d.errors);
console.log('posts', out.dig.length, 'of them wet', wet.length);
console.log('natural - mesh, ALL   med', med(all).toFixed(2), 'p90', pct(all, 0.9).toFixed(2), 'max', Math.max(...all).toFixed(2));
console.log('natural - mesh, WET   med', med(wet).toFixed(2), 'p90', pct(wet, 0.9).toFixed(2), 'max', (wet.length ? Math.max(...wet) : NaN).toFixed(2));
console.log('   t       dem      mesh    ground   level  cov');
for (const r of out.sec) console.log(
  String(r.t).padStart(4),
  (r.dem ?? NaN).toFixed(2).padStart(10),
  (r.mesh ?? NaN).toFixed(2).padStart(10),
  (r.ground ?? NaN).toFixed(2).padStart(10),
  (r.w?.resting ?? NaN).toFixed(2).padStart(8),
  (r.w?.coverage ?? NaN).toFixed(2).padStart(5));
await d.close();

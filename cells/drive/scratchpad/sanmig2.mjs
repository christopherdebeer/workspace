// WHO DUG THE TRENCH THE WATER IS STANDING OVER. Cross-sections through the
// drawn river: every authority on the ground at each offset, in absolute metres.
import { openDrive } from '../devtools/harness.mjs';
import { writeFileSync } from 'node:fs';
const d = await openDrive({
  spot: 'lat=37.86119&lon=-107.87094&h=321&cam=chase&tdbg=0&wxlive=0&time=NOON',
  tag: 'sanmig2', settle: 0, bootTimeout: 300000,
  src: '/home/user/workspace/cells/drive/client/__xsec-rev.ts',
});
const q = (f, ...a) => d.page.evaluate(f, ...a);
await d.page.waitForTimeout(240000);

const out = await q(() => {
  const R = {};
  R.tiles = window.__hydrotiles().map((t) => ({ key: t.key, feats: t.feats, wet: t.wet,
    shoreSegments: t.shoreSegments, shoreRefinedCells: t.shoreRefinedCells, res: t.resolution, built: t.built }));
  R.refine = window.__refine();
  R.swardmask = (() => { const m = window.__swardmask(); return { channels: m.channels, channelCells: m.channelCells, waterPolys: m.waterPolys, waterPolysAll: m.waterPolysAll }; })();
  // Find drawn-wet posts on a 600 m box, pick the four nearest the truck that
  // are on a coverage ridge, and cut a transect through each.
  const wet = [];
  for (let z = -400; z <= 400; z += 10) for (let x = -400; x <= 400; x += 10) {
    const s = window.__layers(x, z);
    if (s.cov !== null && s.cov >= 0.5) wet.push({ x, z, d: Math.hypot(x, z), s });
  }
  wet.sort((a, b) => a.d - b.d);
  R.wetPosts = wet.length;
  // The flow direction at each pick, so the cut is across the channel.
  const picks = [];
  for (const w of wet) { if (picks.every((p) => Math.hypot(p.x - w.x, p.z - w.z) > 150)) picks.push(w); if (picks.length >= 4) break; }
  R.sections = picks.map((p) => {
    const seg = window.__chanseg(p.x, p.z, 200);
    // Cut across the nearest channel's bearing when there is one, else N-S.
    const c = seg[0];
    let ux = 1, uz = 0;
    if (c) { /* across = perpendicular to the channel, recovered from two probes */ }
    // Recover the local channel bearing by walking coverage.
    let bestB = 0, bestRun = -1;
    for (let b = 0; b < 180; b += 10) {
      const bx = Math.cos(b * Math.PI / 180), bz = Math.sin(b * Math.PI / 180);
      let run = 0;
      for (let t = -60; t <= 60; t += 6) { const s = window.__layers(p.x + bx * t, p.z + bz * t); if (s.cov >= 0.5) run++; }
      if (run > bestRun) { bestRun = run; bestB = b; }
    }
    const ax = Math.cos((bestB + 90) * Math.PI / 180), az = Math.sin((bestB + 90) * Math.PI / 180);
    const row = [];
    for (let t = -70; t <= 70; t += 5) row.push({ t, ...window.__layers(p.x + ax * t, p.z + az * t) });
    return { at: [p.x, p.z], alongDeg: bestB, channels: seg, row };
  });
  return R;
});
writeFileSync(new URL('./sanmig2.json', import.meta.url), JSON.stringify(out));
console.log('wetPosts', out.wetPosts, 'sections', out.sections.length);
console.log('swardmask', JSON.stringify(out.swardmask));
console.log('refine', JSON.stringify({ on: out.refine.on, tiles: out.refine.tiles, cells: out.refine.cells, tris: out.refine.tris, plainTris: out.refine.plainTris }));
for (const s of out.sections) {
  console.log('\n=== SECTION at', JSON.stringify(s.at), 'channel bearing', s.alongDeg + '°');
  console.log('channels:', JSON.stringify(s.channels));
  console.log('   t   nat    mesh   chanFl  hydFl   level   cov   kind');
  for (const r of s.row) console.log(
    String(r.t).padStart(5), String(r.natAbs).padStart(8), String(r.meshAbs).padStart(8),
    String(r.chanFloorAbs).padStart(8), String(r.hydroFloorAbs).padStart(8),
    String(r.lvl).padStart(8), String(r.cov).padStart(6), ' ' + r.kind);
}
console.log('\nerrors', d.errors.slice(0, 4));
await d.page.screenshot({ path: new URL('./sanmig2.png', import.meta.url).pathname });
await d.close();

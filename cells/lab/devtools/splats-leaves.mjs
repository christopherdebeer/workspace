// Fronds, for reading their leaves (node cells/lab/devtools/splats-leaves.mjs [--shots] [--plain]).
// Writes devtools/out/leaves/strands.json: for each of the room's views, each strand's line on the picture (x, y at
// 1536×1024, its depth, and how many pixels a metre is there), and its length in metres: where the fronds are, and
// at what scale. With --shots, the room's strands and leaves alone (no limbs, no water's mirror) from each view in
// the real renderer, at the restyles' size: out/leaves/ours-<view>.png (the leaf style in static/splats/leaf-style.json),
// and with --plain, out/leaves/dabs-<view>.png: a dab a leaf, as the room had them.
// With --walk, one cluster close to (?scene=walk from 2.6 m): out/leaves/walk-ours.png, walk-dabs.png.
// devtools/splats-leaves.py reads the teacher's leaves and these the same way.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const C = await load('../client/splats/conservatory.ts'), M = await load('../client/splats/marks.ts');
const dir = new URL('./out/leaves/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const W = 1536, H = 1024, FOV = (55 * Math.PI) / 180, fy = H / (2 * Math.tan(FOV / 2));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const room = C.conservatory({}, 'fronds'), out = {};
for (const [name, v] of Object.entries(room.views)) {
  const p = C.routeAt(v.s).p, E = [p[0], p[1] + C.EYE, p[2]], f = norm([v.at[0] - E[0], v.at[1] - E[1], v.at[2] - E[2]]), r = norm(cross(f, [0, 1, 0])), u = cross(r, f), strands = [];
  for (const m of room.marks) {
    if (m.role !== 'strand') continue;
    const S = M.spine(m), pts = [];
    for (let i = 0; i < S.pts.length; i += 2) { const q0 = [S.pts[i][0] - E[0], S.pts[i][1] - E[1], S.pts[i][2] - E[2]], z = dot(q0, f); if (z < 0.3) continue; pts.push([+(W / 2 + (fy * dot(q0, r)) / z).toFixed(1), +(H / 2 - (fy * dot(q0, u)) / z).toFixed(1), +z.toFixed(2), +(fy / z).toFixed(1)]); }
    if (pts.some((q) => q[0] >= 0 && q[0] < W && q[1] >= 0 && q[1] < H)) strands.push({ key: m.key, L: +S.L.toFixed(3), pts });
  }
  out[name.replace(/ /g, '-')] = strands;
}
writeFileSync(`${dir}strands.json`, JSON.stringify(out));
console.log(Object.entries(out).map(([k, v]) => `${k}: ${v.length} strands`).join('; '));
if (process.argv.includes('--shots') || process.argv.includes('--plain') || process.argv.includes('--walk')) {
  const { withWood } = await import('./harness.mjs');
  process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
  await withWood(async (wood) => {
    for (const [tag, q] of [...(process.argv.includes('--shots') ? [['ours', '']] : []), ...(process.argv.includes('--plain') ? [['dabs', '&leaves=0']] : [])]) {
      const page = await wood.open(`scene=room&res=1&clean&style=plain&mirror=0&roles=strand,dabs${q}`);
      page.on('pageerror', (e) => console.log('page error', e.message));
      await page.waitForFunction(() => window.__splats.scene?.name === 'room' && window.__splats.drawn > 0, null, { timeout: 240000 });
      const st = await page.evaluate(() => window.__splats.room.state); console.log(tag, st.n, 'deposits');
      for (const v of Object.keys(st.views)) { await page.evaluate((v) => window.__splats.room.view(v), v); await page.waitForTimeout(1300); await page.screenshot({ path: `${dir}${tag}-${v.replace(/ /g, '-')}.png` }); }
      await page.close();
    }
    // (one cluster close to: the canopy patch of ?scene=walk from 2.6 m, its leaves formed and a dab a leaf)
    if (process.argv.includes('--walk')) for (const [tag, q] of [['walk-ours', ''], ['walk-dabs', '&leaves=0']]) {
      const page = await wood.open(`scene=walk&res=1&clean&d=2.6${q}`);
      await page.waitForFunction(() => window.__splats.scene?.name === 'walk' && window.__splats.drawn > 0, null, { timeout: 240000 });
      await page.waitForTimeout(1500); await page.screenshot({ path: `${dir}${tag}.png` }); console.log(tag, (await page.evaluate(() => window.__splats.walk.state)).n, 'deposits'); await page.close();
    }
  }, { width: W, height: H });
}

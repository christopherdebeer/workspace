// One limb, three ways, in the real renderer (node cells/lab/devtools/splats-limb-shots.mjs): each way from far,
// medium and close (devtools/out/limb/<way>-<far|mid|close>.png), and the camera's whole move in steps
// (<way>-move-<k>.png), with how much ink each frame holds: a continuous move should have no jump in it.
import { withWood } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const dir = new URL('./out/limb/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const W = Number(process.env.W ?? 960), H = Number(process.env.H ?? 640), STEPS = Number(process.env.STEPS ?? 25);
const AT = { far: 13, mid: 5.5, close: 2.6 }, TAG = process.env.TAG ?? '', FAR = 14, CLOSE = 2.2, out = {};
await withWood(async (wood) => {
  const page = await wood.open('scene=limb&res=1&clean&way=parts');
  page.on('pageerror', (e) => console.log('page error', e.message)); page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
  await page.waitForFunction(() => window.__splats.scene?.name === 'limb' && window.__splats.drawn > 0, null, { timeout: 240000 });
  // (how much ink a frame holds: the mean darkness of the canvas)
  const ink = () => page.evaluate(() => { const g = window.__splats.grab(); let s = 0; for (let i = 0; i < g.D.length; i++) s += g.D[i]; return s / g.D.length; });
  for (const way of (process.env.WAYS ?? 'parts,sweep,accents').split(',')) {
    await page.evaluate((w) => window.__splats.limb.way(w), way); await page.waitForTimeout(600);
    const st = await page.evaluate(() => window.__splats.limb.state); console.log(way, st.laid, 'deposits laid');
    for (const [name, d] of Object.entries(AT)) { await page.evaluate((d) => window.__splats.limb.set(d), d); await page.waitForTimeout(1200); await page.screenshot({ path: `${dir}${way}-${name}${TAG}.png` }); }
    if (!STEPS) continue;
    const series = [];
    for (let k = 0; k < STEPS; k++) { const d = FAR * Math.pow(CLOSE / FAR, k / (STEPS - 1)); await page.evaluate((d) => window.__splats.limb.set(d), d); await page.waitForTimeout(500); series.push({ d: +d.toFixed(2), ink: +(await ink()).toFixed(5) }); if (k % 3 === 0) await page.screenshot({ path: `${dir}${way}-move-${String(k).padStart(2, '0')}.png` }); }
    // (the largest step in ink between neighbouring frames, against the frame's ink: the ink grows as the limb's
    // area on the screen does, about 17% a step here while all of it is in view; a jump shows as much more)
    let worst = 0, at = 0; for (let k = 1; k < series.length; k++) { const r = Math.abs(Math.log(series[k].ink / series[k - 1].ink)); if (r > worst) { worst = r; at = series[k].d; } }
    out[way] = { laid: st.laid, series, worst: +worst.toFixed(3), at }; console.log(`  ink along the move: ${series.map((s) => (s.ink * 100).toFixed(2)).join(' ')}\n  largest step ×${Math.exp(worst).toFixed(2)} at ${at} m`);
  }
  await page.close();
}, { width: W, height: H });
if (STEPS) writeFileSync(`${dir}move.json`, JSON.stringify(out, null, 1));

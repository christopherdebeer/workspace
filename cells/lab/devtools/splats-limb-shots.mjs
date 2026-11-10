// One limb in the real renderer (node cells/lab/devtools/splats-limb-shots.mjs).
// By default, at 960×640: each way (WAYS=parts,sweep,accents,shader,fitted) from far, medium and close
// (devtools/out/limb/<way>-<far|mid|close>.png), close with its crown bent (…-bent.png), and the camera's whole move
// in steps (<way>-move-<k>.png), with how much ink each frame holds: a continuous move should have no jump in it.
// With CAMS=1, at the restyles' size (run with W=1536 H=1024): each way from the five views the teacher drew this limb
// in (r-<way>-<view>.png, and its darkness a byte a pixel, .bin), for reading it as the teacher's strokes are read.
import { withWood } from './harness.mjs';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const dir = new URL('./out/limb/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const W = Number(process.env.W ?? 960), H = Number(process.env.H ?? 640), STEPS = Number(process.env.STEPS ?? 25), CAMS = !!process.env.CAMS;
const AT = { far: 13, mid: 5.5, close: 2.6 }, TAG = process.env.TAG ?? '', FAR = 14, CLOSE = 2.2, BEND = 0.6, out = {};
const VIEWS = ['tunnel', 'back along the tunnel', 'canopy', 'between canopy and tunnel', 'sideways from the stones'];
const load = async (f) => { const o = await build({ entryPoints: [new URL(f, import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' }); return import('data:text/javascript;base64,' + Buffer.from(o.outputFiles[0].text).toString('base64')); };
const C = await load('../client/splats/conservatory.ts'), room = C.conservatory({});
await withWood(async (wood) => {
  const page = await wood.open('scene=limb&res=1&clean&way=sweep');
  page.on('pageerror', (e) => console.log('page error', e.message));
  await page.waitForFunction(() => window.__splats.scene?.name === 'limb' && window.__splats.drawn > 0, null, { timeout: 240000 });
  // (how much ink a frame holds: the mean darkness of the canvas)
  const ink = () => page.evaluate(() => { const g = window.__splats.limb.dark(), b = atob(g.d); let s = 0; for (let i = 0; i < b.length; i++) s += b.charCodeAt(i); return s / b.length / 255; });
  for (const way of (process.env.WAYS ?? 'parts,sweep,accents,shader,fitted').split(',')) {
    await page.evaluate((w) => window.__splats.limb.way(w), way); await page.waitForTimeout(700);
    const st = await page.evaluate(() => window.__splats.limb.state); console.log(way, st.laid, 'deposits laid');
    if (CAMS) {
      for (const v of VIEWS) {
        const p = C.routeAt(room.views[v].s).p, eye = [p[0], p[1] + C.EYE, p[2]], name = v.replace(/ /g, '-');
        await page.evaluate(([e, a]) => window.__splats.limb.look(e, a), [eye, room.views[v].at]); await page.waitForTimeout(1300);
        await page.screenshot({ path: `${dir}r-${way}-${name}.png` }); const g = await page.evaluate(() => window.__splats.limb.dark()); writeFileSync(`${dir}r-${way}-${name}.bin`, Buffer.from(g.d, 'base64'));
      }
      continue;
    }
    for (const [name, d] of Object.entries(AT)) { await page.evaluate((d) => window.__splats.limb.set(d), d); await page.waitForTimeout(1200); await page.screenshot({ path: `${dir}${way}-${name}${TAG}.png` }); }
    // (an edit: its crown pulled out and up; every way has to follow)
    await page.evaluate((b) => window.__splats.limb.bend(b), BEND); await page.waitForTimeout(1500); await page.screenshot({ path: `${dir}${way}-bent${TAG}.png` }); await page.evaluate(() => window.__splats.limb.bend(0)); await page.waitForTimeout(900);
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
if (STEPS && !CAMS) writeFileSync(`${dir}move${TAG}.json`, JSON.stringify(out, null, 1));

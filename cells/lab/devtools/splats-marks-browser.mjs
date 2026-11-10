// The marks drawn by the real renderer (node cells/lab/devtools/splats-marks-browser.mjs): each sheet of
// static/splats/marks-bench.json alone, from the camera it was fitted from, at the size it was fitted at, each way; read
// back as darkness into devtools/out/marks/browser.json. The fitter's own pictures should agree with these (it scores
// them with `node devtools/splats-marks-fit.mjs --browser`); and the lab's existing brush, which the fitter can't
// draw, is drawn here on the same spines, over a few settings of its knobs (width, material; a wash's depth and
// reach): the best of them by tone is kept.
import { withWood } from './harness.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const dir = new URL('./out/marks/', import.meta.url).pathname, bench = JSON.parse(readFileSync(new URL('../static/splats/marks-bench.json', import.meta.url)));
const out = {};
await withWood(async (wood) => {
  const page = await wood.open('scene=marks&res=1&clean');
  page.on('pageerror', (e) => console.log('page error', e.message));
  await page.waitForFunction(() => window.__splats.scene?.name === 'marks' && window.__splats.drawn > 0, null, { timeout: 180000 });
  // (drawn at K times the size it was fitted at, and averaged down: the page's layout isn't made for a window a hundred
  // pixels high, and a fitted mark's ink doesn't depend on the size it's drawn at)
  const K = 4;
  const grab = async () => { await page.waitForTimeout(700); return page.evaluate((K) => { const g = window.__splats.grab(), w = g.w / K, h = g.h / K, D = []; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let j = 0; j < K; j++) for (let i = 0; i < K; i++) s += g.D[(y * K + j) * g.w + x * K + i]; D.push(+(s / (K * K)).toFixed(3)); } return { w, h, D }; }, K); };
  for (const s of bench.sheets) {
    await page.setViewportSize({ width: s.w * K, height: s.h * K });
    out[s.name] = {};
    for (const way of ['organised', 'organised+deposits', 'independent', 'style']) {
      if (way === 'style' && !s.of) continue;
      await page.evaluate(([n, w]) => window.__splats.marks.only(n, w), [s.name, way]);
      const g = await grab(); if (g.w !== s.w || g.h !== s.h) throw new Error(`${s.name}: drawn at ${g.w}×${g.h}, fitted at ${s.w}×${s.h}`);
      out[s.name][way === 'style' ? `style of ${s.of}` : way] = g.D;
    }
    // (the existing brush, a few settings)
    await page.evaluate((n) => window.__splats.marks.only(n, 'brush'), s.name);
    const knobs = s.kind === 'wash' ? [0.08, 0.15, 0.25, 0.45].flatMap((depth) => [0.6, 1].map((reach) => ({ depth, reach }))) : [0.3, 0.5, 0.7, 1].flatMap((width) => ['ink', 'dry'].flatMap((material) => [0.3, 1].map((weight) => ({ width, material, weight }))));
    for (const k of knobs) { await page.evaluate((k) => window.__splats.marks.brushed(k), k); out[s.name][`brush ${JSON.stringify(k)}`] = (await grab()).D; }
    console.log(s.name, Object.keys(out[s.name]).length, 'pictures');
  }
}, { width: 400, height: 300 });
writeFileSync(`${dir}browser.json`, JSON.stringify(out));

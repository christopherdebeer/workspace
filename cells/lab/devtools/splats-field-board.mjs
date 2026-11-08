// The fitted field against its teacher (node cells/lab/devtools/splats-field-board.mjs [look]): on views it wasn't
// fitted to, the brush-drawn stone (the teacher), the fitted field, and the baseline (the same discs, one constant
// opacity each), all drawn by the real renderer at twice the fitting resolution (devtools/out/field-board-<look>.png).
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const look = process.argv[2] ?? 'wash';
const views = [[0.6, 0.24], [1.65, 0.48], [2.7, 0.24], [3.75, 0.48], [4.8, 0.24], [5.85, 0.48]];
await withWood(async (wood) => {
  const cols = { teacher: `scene=stone&look=${look}&detail=1`, field: 'scene=field', baseline: 'scene=field&field=flat' }, shots = {};
  for (const [nm, q] of Object.entries(cols)) {
    const page = await wood.open(`${q}&res=1&clean`);
    page.on('pageerror', (e) => console.log('page error', e.message));
    await page.waitForFunction(() => window.__splats.drawn > 0, null, { timeout: 120000 });
    shots[nm] = [];
    for (const [y, p] of views) { await page.evaluate(([y, p]) => window.__splats.stone.at(y, p), [y, p]); await page.waitForTimeout(1600); shots[nm].push(await wood.shot(page, `field-${look}-${nm}-${y}`)); }
    await page.close();
  }
  const sh = [], lb = [];
  views.forEach(([y, p], i) => { for (const nm of Object.keys(cols)) { sh.push(shots[nm][i]); lb.push(`${nm} · yaw ${y} pitch ${p}`); } });
  await wood.montage(sh, `field-board-${look}`, { height: 240, labels: lb, columns: 3 });
}, { width: 320, height: 240 });

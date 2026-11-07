// Splats in the browser (node cells/lab/devtools/splats-shot.mjs [scene…]): each scene opened, drawn in each way of
// seeing it, and a board of them (devtools/out/splats-board.png). The default is the garden (made here, no download);
// name plush, nike or train to fetch those too. Fails if the page throws or draws nothing.
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const scenes = process.argv.slice(2).length ? process.argv.slice(2) : ['garden'];
const shots = [], labels = [];
let bad = 0;
await withWood(async (wood) => {
  for (const sc of scenes) {
    const page = await wood.open(`scene=${sc}&res=1`);
    await page.waitForFunction(() => window.__splats.scene && window.__splats.drawn > 0, null, { timeout: 300000 });
    const info = await page.evaluate(() => ({ ...window.__splats.scene, sort: window.__splats.sortMs }));
    console.log(sc, JSON.stringify(info));
    for (const m of sc === 'garden' ? [0, 1, 2, 3] : [0, 1]) {
      await page.evaluate((m) => window.__splats.setMode(m), m);
      await page.waitForTimeout(2500);
      shots.push(await wood.shot(page, `splats-${sc}-${m}`)); labels.push(`${sc} · ${['splats', 'ellipses', 'footprints', 'centres'][m]}`);
    }
    if (page.errors.length) { console.log('errors', page.errors); bad++; }
    await page.close();
  }
  await wood.montage(shots, 'splats-board', { height: 520, labels });
}, { width: 390, height: 700 });
process.exit(bad ? 1 : 0);

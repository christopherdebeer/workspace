// Mist's board (node cells/lab/devtools/splats-mist.mjs): the same splats, camera and resolution, lit four ways (the
// expensive reference, baked, analytic, the tiny network): a training bank under an unseen sun, and the unseen bank
// under two unseen suns. Writes devtools/out/mist-board.png.
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
await withWood(async (wood) => {
  const page = await wood.open('scene=mist&res=1&clean&count=8000');
  page.on('pageerror', (e) => console.log('page error', e.message));
  await page.waitForFunction(() => window.__splats.scene?.name === 'mist' && window.__splats.drawn > 0, null, { timeout: 120000 });
  const M = (f, ...a) => page.evaluate(([f, a]) => window.__splats.mist[f](...a), [f, a]);
  const shots = [], labels = [];
  for (const [bank, az, el, what] of [[1, 1.5, 0.9, 'trained bank · unseen sun'], [9, 1.75, 0.5, 'unseen bank · unseen sun'], [9, 5.2, 0.66, 'unseen bank · unseen sun (back-lit)']]) {
    await M('setBank', bank); await page.waitForFunction(() => window.__splats.drawn > 0);
    for (const l of ['reference', 'baked', 'analytic', 'neural']) {
      await M('setSun', az, el); await M('setLight', l);
      await page.waitForFunction(() => window.__splats.mist.ready, null, { timeout: 300000 });
      await page.waitForTimeout(2200);
      shots.push(await wood.shot(page, `mist-${bank}-${az}-${l}`)); labels.push(`${l} · ${what}`);
    }
  }
  await wood.montage(shots, 'mist-board', { height: 360, labels, columns: 4 });
  // (the error view: each splat by how far its light is from the reference; the unseen bank, unseen sun)
  const es = [], el = [];
  await M('setBank', 9); await page.waitForFunction(() => window.__splats.drawn > 0); await M('setSun', 1.75, 0.5); await M('setDiff', true);
  for (const l of ['baked', 'analytic', 'neural']) { await M('setLight', l); await page.waitForFunction(() => window.__splats.mist.ready, null, { timeout: 300000 }); await page.waitForTimeout(2200); es.push(await wood.shot(page, `mist-err-${l}`)); el.push(`error from the reference · ${l}`); }
  await wood.montage(es, 'mist-error', { height: 360, labels: el, columns: 3 });
  if (page.errors.length) console.log('errors', page.errors);
}, { width: 420, height: 360 });

// Blocks, headless: each demo build drawn when its shaping has settled, and the hand tried (a tap sets a block, a
// drag lays a run, a hold takes one, undo), checked from what the page reports.
// (node cells/lab/devtools/blocks-shot.mjs [outdir] [demo,demo…])
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'blocks';
process.env.READY = '__blocks';
const out = process.argv[2] ?? new URL('./out', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const only = process.argv[3]?.split(',');
const settle = (page) => page.waitForFunction(() => window.__blocks.settled() && window.__blocks.frames > 3, null, { timeout: 300000 });
await withWood(async (wood) => {
  const views = [['castle', 'demo=castle', [-0.7, 0.55, 22]], ['arcade', 'demo=arcade', [-0.5, 0.42, 19]], ['house', 'demo=house', [-0.8, 0.5, 14]], ['harbour', 'demo=harbour', [-0.3, 0.38, 16]]];
  for (const [name, q, v] of views) {
    if (only && !only.includes(name)) continue;
    const page = await wood.open(q);
    await page.evaluate((v) => window.__blocks.view(...v), v);
    await settle(page);
    await page.waitForTimeout(800);
    const s = await page.evaluate(() => ({ workers: __blocks.workers, cells: __blocks.cells, drawn: __blocks.drawn, cache: { ...__blocks.cache } }));
    console.log(name, JSON.stringify(s), page.errors.length ? page.errors : '');
    await page.screenshot({ path: join(out, `blocks-${name}.png`), timeout: 300000 });
    await page.close();
  }
  if (only && !only.includes('hand')) return;
  // (the hand, on an empty world)
  const page = await wood.open('', { hasTouch: false });
  await page.evaluate(() => { localStorage.clear(); window.__blocks.view(-0.6, 0.62, 14); });
  await page.waitForTimeout(500);
  const W = 390, H = 844, cx = W / 2, cy = H / 2;
  await page.mouse.click(cx, cy);
  await settle(page);
  let n = await page.evaluate(() => __blocks.cells);
  assert.equal(n, 1, 'a tap sets one block');
  // (a drag across the ground lays a run)
  await page.mouse.move(cx + 60, cy + 40); await page.mouse.down(); for (let i = 1; i <= 12; i++) await page.mouse.move(cx + 60 + i * 8, cy + 40 - i * 3); await page.mouse.up();
  await settle(page);
  n = await page.evaluate(() => __blocks.cells);
  assert.ok(n > 3, `a drag lays a run (${n})`);
  console.log('after the run', n, 'last edit ms', await page.evaluate(() => __blocks.lastEditMs.toFixed(1)));
  await page.screenshot({ path: join(out, 'blocks-hand.png') });
  // (a hold on a block takes it)
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up();
  await settle(page);
  const m = await page.evaluate(() => __blocks.cells);
  assert.equal(m, n - 1, 'a hold takes one');
  await page.evaluate(() => __blocks.undo()); await settle(page);
  assert.equal(await page.evaluate(() => __blocks.cells), n, 'undo puts it back');
  assert.deepEqual(page.errors, []);
  console.log('hand ok');
  await page.close();
});

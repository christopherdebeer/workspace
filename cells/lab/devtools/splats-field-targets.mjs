// The teacher for a fitted field (node cells/lab/devtools/splats-field-targets.mjs [look]): the brush-drawn stone
// (?scene=stone) rendered by the real renderer from many views, each view's lightness and camera kept
// (devtools/out/field/targets-<look>.json): training views round it at three heights, held-out views between them.
import { withWood } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const look = process.argv[2] ?? 'wash', dir = new URL('./out/field/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const views = [];
for (const pitch of [0.12, 0.35, 0.6]) for (let k = 0; k < 12; k++) views.push({ yaw: (k / 12) * Math.PI * 2 + pitch, pitch, split: 'train' });
for (const pitch of [0.24, 0.48]) for (let k = 0; k < 6; k++) views.push({ yaw: ((k + 0.5) / 6) * Math.PI * 2 + 0.1, pitch, split: 'test' });
await withWood(async (wood) => {
  const out = [];
  let page = null;
  for (let i = 0; i < views.length; i++) {
    if (i % 12 === 0) {
      if (page) await page.close();
      page = await wood.open(`scene=stone&res=1&clean&look=${look}&detail=1`);
      page.on('pageerror', (e) => console.log('page error', e.message));
      await page.waitForFunction(() => window.__splats.scene?.name === 'stone' && window.__splats.drawn > 0, null, { timeout: 120000 });
    }
    const v = views[i];
    await page.evaluate(([y, p]) => window.__splats.stone.at(y, p), [v.yaw, v.pitch]);
    await page.waitForTimeout(1500);
    out.push({ ...v, ...(await page.evaluate(() => window.__splats.grab())) });
  }
  await page.close();
  writeFileSync(`${dir}targets-${look}.json`, JSON.stringify(out));
  console.log(`${out.length} views (${out[0].w}×${out[0].h}) → ${dir}targets-${look}.json`);
}, { width: 160, height: 120 });

// A check of a reference study's alignment (node cells/lab/devtools/splats-field-refcheck.mjs): the composed scene drawn from the study's fitted camera (splats-field-refcam.mjs), read back into devtools/out/field/proc-at-refcam.json, for overlaying on the warped study.
import { withWood } from './harness.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const R = JSON.parse(readFileSync(new URL('./out/field/ref-resolved.json', import.meta.url)));
await withWood(async (wood) => {
  const page = await wood.open('scene=composed&res=1&clean&look=wash&detail=1&policy=ranks');
  await page.waitForFunction(() => window.__splats.scene?.name === 'composed' && window.__splats.drawn > 0, null, { timeout: 180000 });
  await page.evaluate((c) => { window.__splats.stone.setDetail(1); window.__splats.camera(c); }, R.camera);
  await page.waitForTimeout(2500);
  const g = await page.evaluate(() => window.__splats.grab());
  writeFileSync(new URL('./out/field/proc-at-refcam.json', import.meta.url), JSON.stringify(g));
  console.log(g.w, g.h);
}, { width: 192, height: 128 });

// Canvases for a redrawn teacher (node cells/lab/devtools/splats-field-canvas.mjs): the composed scene drawn at the
// reference studies' size (1024 × 683) from the reference camera and a view either side of it, each with its camera
// (devtools/out/field/canvas-<view>.png and canvases.json). Redrawn in the studies' manner with the geometry kept
// exactly (every edge, culm and node where it is), a canvas becomes a teacher the fitted field can learn from directly:
// the reference studies themselves can't be, as they're compositions after the scene, not drawings of it.
import { withWood } from './harness.mjs';
import { writeFileSync } from 'node:fs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
await withWood(async (wood) => {
  const page = await wood.open('scene=composed&res=1&clean&look=wash&detail=1&policy=ranks');
  await page.waitForFunction(() => window.__splats.scene?.name === 'composed' && window.__splats.drawn > 0, null, { timeout: 180000 });
  await page.evaluate(() => { window.__splats.composed.camRef(); window.__splats.stone.setDetail(1); });
  const out = [];
  for (const [name, dy] of [['ref', 0], ['left', -0.45], ['right', 0.45]]) {
    await page.evaluate((dy) => { window.__splats.composed.camRef(); const c = window.__splats.grab(); window.__splats.stone.at(3.7417 + dy, 0.24); }, dy);
    await page.waitForTimeout(2500);
    const g = await page.evaluate(() => { const g = window.__splats.grab(); return { eye: g.eye, target: g.target, fov: g.fov, w: g.w, h: g.h }; });
    out.push({ name, file: `canvas-${name}.png`, ...g, yaw: 3.7417 + dy, pitch: 0.24 });
    await wood.shot(page, `field/canvas-${name}`);
  }
  writeFileSync(new URL('./out/field/canvases.json', import.meta.url), JSON.stringify(out, null, 1));
  console.log(out.map((o) => `${o.file} ${o.w}×${o.h}`).join('\n'));
}, { width: 1024, height: 683 });

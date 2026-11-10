// The teacher for a fitted field (node cells/lab/devtools/splats-field-targets.mjs [stone|composed] [look]): a drawing
// rendered by the real renderer from many views, each view's lightness and camera kept
// (devtools/out/field/targets-<scene>-<look>.json, or targets-<look>.json for the stone):
// - stone: the brush-drawn stone (?scene=stone) at 160 × 120, 36 training views round it at three heights, 12 held out;
// - composed: the composed scene at full detail (?scene=composed, by its ranks: every mark) at 192 × 128 (the
//   reference studies' shape), orbiting the reference camera's target at its distance: 36 training views, 12 held
//   out, and the reference view itself (split 'ref'), which the reference studies are aligned to.
import { withWood } from './harness.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const scene = process.argv[2] === 'composed' ? 'composed' : 'stone', look = process.argv[3] ?? (process.argv[2] !== 'composed' && process.argv[2] !== 'stone' ? process.argv[2] : undefined) ?? 'wash';
const dir = new URL('./out/field/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const REF = { yaw: 0.6 + Math.PI, pitch: 0.24 };
const views = [];
if (scene === 'stone') {
  for (const pitch of [0.12, 0.35, 0.6]) for (let k = 0; k < 12; k++) views.push({ yaw: (k / 12) * Math.PI * 2 + pitch, pitch, split: 'train' });
  for (const pitch of [0.24, 0.48]) for (let k = 0; k < 6; k++) views.push({ yaw: ((k + 0.5) / 6) * Math.PI * 2 + 0.1, pitch, split: 'test' });
} else {
  views.push({ ...REF, split: 'ref' });
  for (const pitch of [0.1, 0.28, 0.5]) for (let k = 0; k < 12; k++) views.push({ yaw: REF.yaw + (k / 12) * Math.PI * 2 + 0.13 + pitch, pitch, split: 'train' });
  for (const pitch of [0.2, 0.4]) for (let k = 0; k < 6; k++) views.push({ yaw: REF.yaw + ((k + 0.5) / 6) * Math.PI * 2, pitch, split: 'test' });
}
const url = scene === 'stone' ? `scene=stone&res=1&clean&look=${look}&detail=1` : `scene=composed&res=1&clean&look=${look}&detail=1&policy=ranks`;
await withWood(async (wood) => {
  const out = [];
  let page = null;
  for (let i = 0; i < views.length; i++) {
    if (i % 12 === 0) {
      if (page) await page.close();
      page = await wood.open(url);
      page.on('pageerror', (e) => console.log('page error', e.message));
      await page.waitForFunction((s) => window.__splats.scene?.name === s && window.__splats.drawn > 0, scene, { timeout: 180000 });
      if (scene === 'composed') await page.evaluate(() => { window.__splats.composed.camRef(); window.__splats.stone.setDetail(1); });
    }
    const v = views[i];
    await page.evaluate(([y, p]) => window.__splats.stone.at(y, p), [v.yaw, v.pitch]);
    await page.waitForTimeout(1600);
    out.push({ ...v, ...(await page.evaluate(() => window.__splats.grab())) });
  }
  await page.close();
  const f = scene === 'stone' ? `${dir}targets-${look}.json` : `${dir}targets-composed-${look}.json`;
  writeFileSync(f, JSON.stringify(out));
  console.log(`${out.length} views (${out[0].w}×${out[0].h}) → ${f}`);
}, { width: scene === 'stone' ? 160 : 192, height: scene === 'stone' ? 120 : 128 });

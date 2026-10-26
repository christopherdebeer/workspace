// Rescue · Rocky Coast against its target (node cells/lab/devtools/rescue-coast-fidelity.mjs [out-dir]): the reference
// scenes (`?ref=hero`, `?ref=rescue`, `?ref=coast`: one fixed frame each, composed like the target studies' panels 01
// and 02 and the second board's coastal landscape), each
// rendered and put beside its panel, so every change to the drawing is judged by the picture it makes. Writes
// fidelity-<scene>.jpg and fidelity.jpg (all, stacked; `--only=a,b` for some) to devtools/fidelity/ (or the dir given).
process.env.EXPERIMENT = 'rescue-coast'; process.env.READY = '__rescue';
import { join } from 'node:path';
const { withWood, CELL } = await import('./harness.mjs');
const out = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(CELL, 'devtools/fidelity');
const SCENES = [
  { name: 'hero', target: 'target-hero.jpg', size: { width: 1280, height: 630 } },
  { name: 'rescue', target: 'target-rescue.jpg', size: { width: 820, height: 642 } },
  { name: 'coast', target: 'target-b2-coast.jpg', size: { width: 1280, height: 747 } },
];
// (--only=hero,coast: just those)
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
await withWood(async (lab) => {
  const shots = [];
  for (const s of SCENES.filter((s) => !only || only.includes(s.name))) {
    const p = await lab.open(`seed=1&ref=${s.name}`, s.size);
    await p.waitForTimeout(4000);
    const file = join(out, `render-${s.name}.png`);
    await p.screenshot({ path: file });
    if (p.errors?.length) console.log(s.name, p.errors.slice(0, 2));
    shots.push([join(CELL, 'devtools/fidelity', s.target), file, s.name]);
    await p.close();
  }
  // (side by side: the target's panel on the left, the drawing on the right, the same height)
  const page = await lab.browser.newPage({ viewport: { width: 2600, height: 2000 } });
  const { readFileSync } = await import('node:fs');
  const img = (f) => `data:image/${f.endsWith('png') ? 'png' : 'jpeg'};base64,${readFileSync(f).toString('base64')}`;
  await page.setContent(`<style>body{margin:0;background:#1d2533;font:600 16px system-ui;color:#dfe6f0}.row{display:flex;gap:10px;padding:10px}figure{margin:0}img{height:560px;display:block}figcaption{padding:4px 2px}</style>${shots.map(([t, r, n]) => `<div class="row" id="${n}"><figure><img src="${img(t)}"><figcaption>target · ${n}</figcaption></figure><figure><img src="${img(r)}"><figcaption>rescue-coast · ?ref=${n}</figcaption></figure></div>`).join('')}`);
  await page.waitForTimeout(300);
  for (const [, , n] of shots) await page.locator('#' + n).screenshot({ path: join(out, `fidelity-${n}.jpg`), type: 'jpeg', quality: 85 });
  await page.locator('body').screenshot({ path: join(out, 'fidelity.jpg'), type: 'jpeg', quality: 82 });
  await page.close();
  console.log('wrote', join(out, 'fidelity.jpg'));
});

// Bamboo against its board (node cells/lab/devtools/bamboo-fidelity.mjs [out-dir]): the three reference frames
// (`?ref=a`, `?ref=b`, `?ref=c`: the near frame, how it thins, the walk), each rendered at a phone's size and put beside
// its target from devtools/bamboo/board.jpg, so every change to the drawing is judged by the picture it makes. Writes
// render-<ref>.png, fidelity.jpg (all three, side by side) to devtools/bamboo/fidelity/ (or the dir given).
// `--clean`: without the shafts and the paper's grain.
process.env.EXPERIMENT = 'bamboo'; process.env.READY = '__bamboo';
import { join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
const { withWood, CELL } = await import('./harness.mjs');
const out = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? join(CELL, 'devtools/bamboo/fidelity');
mkdirSync(out, { recursive: true });
const SCENES = [
  { name: 'a', target: 'r3-8-lit-stairs.png', title: 'A · the near frame' },
  { name: 'b', target: 'r3-5-ink-path.png', title: 'B · how it thins' },
  { name: 'c', target: 'r3-6-contour-valley.png', title: 'C · the walk' },
];
const clean = process.argv.includes('--clean'), suffix = clean ? '-clean' : '';
await withWood(async (lab) => {
  const shots = [];
  for (const s of SCENES) {
    const p = await lab.open(`seed=1&ref=${s.name}&t=8&still${clean ? '&clean' : ''}`, { width: 390, height: 844 });
    await p.waitForTimeout(4000);
    const file = join(out, `render-${s.name}${suffix}.png`);
    await p.screenshot({ path: file, timeout: 300000 });
    if (p.errors?.length) console.log(s.name, p.errors.slice(0, 2));
    shots.push([join(CELL, 'devtools/bamboo', s.target), file, s.title]);
    await p.close();
  }
  const page = await lab.browser.newPage({ viewport: { width: 2400, height: 1100 } });
  const img = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  await page.setContent(`<style>body{margin:0;background:#efe6d2;font:600 15px Georgia,serif;color:#2a251e;display:flex;gap:26px;padding:14px}.pair{display:flex;gap:6px;flex-direction:column}.imgs{display:flex;gap:6px}img{height:700px;display:block}</style>${shots.map(([t, r, n]) => `<div class="pair"><div class="imgs"><img src="${img(t)}"><img src="${img(r)}"></div><div>${n} · board | drawing</div></div>`).join('')}`);
  await page.waitForTimeout(300);
  await page.locator('body').screenshot({ path: join(out, `fidelity${suffix}.jpg`), type: 'jpeg', quality: 84 });
  await page.close();
  console.log('wrote', join(out, `fidelity${suffix}.jpg`));
});

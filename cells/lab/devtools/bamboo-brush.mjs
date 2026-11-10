// Bamboo, a culm laid as a brush lays one (node cells/lab/devtools/bamboo-brush.mjs [gate…]): four of the gates' pinned
// scenes (a giant culm close to; culms looked up; the ink's reach; the contour run), each as the board and in ink alone,
// as Bamboo draws its culms now and with `?brush=sweep` (render.ts: the Splats lab's sweep on the culm's own surface).
// Writes devtools/bamboo/brush/<gate>.jpg and brush.jpg.
process.env.EXPERIMENT = 'bamboo'; process.env.READY = '__bamboo';
import { join } from 'node:path';
import { mkdirSync, readFileSync } from 'node:fs';
const { withWood, CELL } = await import('./harness.mjs');
const out = join(CELL, 'devtools/bamboo/brush'); mkdirSync(out, { recursive: true });
const SCENES = [
  { name: '06-material', title: 'a giant culm, close to', scene: 'seed=1&cam=-250.72,-298.42,0.36,-0.22&t=8' },
  { name: '02-culm-scale', title: 'culms, looked up', scene: 'seed=1&cam=44.7,87.88,1.57,1.05&t=8' },
  { name: '03-ink-reach', title: 'the ink\'s reach', scene: 'seed=1&cam=414.87,-22.89,2.48,-0.14&t=8' },
  { name: '01-contour-run', title: 'the contour run', scene: 'seed=1&cam=380.62,149.24,0.58,-0.16&t=8' },
];
const MODES = [['board', '', 'as it is'], ['board-sweep', 'brush=sweep', 'culms as a sweep'], ['ink', 'look=ink', 'ink alone, as it is'], ['ink-sweep', 'look=ink&brush=sweep', 'ink alone, culms as a sweep']];
const only = process.argv.slice(2), scenes = only.length ? SCENES.filter((g) => only.some((o) => g.name.startsWith(o))) : SCENES;
await withWood(async (lab) => {
  const img = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`, sheets = [];
  for (const g of scenes) {
    const shots = [];
    for (const [name, q, label] of MODES) {
      const p = await lab.open(`${g.scene}&still${q ? '&' + q : ''}`, { width: 390, height: 844 });
      await p.waitForTimeout(3500); const file = join(out, `${g.name}-${name}.png`); await p.screenshot({ path: file, timeout: 300000 });
      if (p.errors?.length) console.log(g.name, name, p.errors.slice(0, 2)); shots.push([file, label]); await p.close();
    }
    const page = await lab.browser.newPage({ viewport: { width: 1500, height: 780 } });
    await page.setContent(`<style>body{margin:0;background:#efe6d2;font:600 15px Georgia,serif;color:#2a251e;padding:12px}.row{display:flex;gap:8px}.c{display:flex;flex-direction:column;gap:4px}img{height:700px;display:block}</style><div>${g.title}</div><div class="row">${shots.map(([f, l]) => `<div class="c"><img src="${img(f)}"><span>${l}</span></div>`).join('')}</div>`);
    await page.waitForTimeout(300); const sheet = join(out, `${g.name}.jpg`); await page.locator('body').screenshot({ path: sheet, type: 'jpeg', quality: 84 }); await page.close(); sheets.push(sheet); console.log('wrote', sheet);
  }
});

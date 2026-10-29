// Bamboo's gates (node cells/lab/devtools/bamboo-gates.mjs [gate…]): each of the five target studies
// (devtools/bamboo/targets/, and gates.md there for what each is judged by) beside its pinned scene, drawn three ways
// at a phone's size: the **picture** (full colour, no marks, no shafts or paper grain: gate 0, geometry and composition),
// **ink only** (no colour, the whole drawing, no frame: gate 1, does the route and bank still read), and the **board**
// (the default: gate 2). Each scene is pinned exactly (`?cam=x,z,heading,pitch`, a seed, a time), never found afresh, so
// a change to the drawing is judged on the same frame. Writes devtools/bamboo/gates/<gate>.jpg and gates.jpg (all).
process.env.EXPERIMENT = 'bamboo'; process.env.READY = '__bamboo';
import { join } from 'node:path';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
const { withWood, CELL } = await import('./harness.mjs');
const out = join(CELL, 'devtools/bamboo/gates');
mkdirSync(out, { recursive: true });

/** each gate: its target, and the scene it's judged on (pinned) */
export const GATES = [
  { name: '01-contour-run', title: '01 · the contour run', scene: 'seed=1&cam=380.62,149.24,0.58,-0.16&t=8' },
  { name: '02-culm-scale', title: '02 · culm scale', scene: 'seed=1&cam=44.7,87.88,1.57,1.05&t=8' },
  { name: '03-ink-reach', title: '03 · ink reach', scene: 'seed=1&cam=414.87,-22.89,2.48,-0.14&t=8' },
  { name: '04-stair-event', title: '04 · the stair', scene: 'seed=1&cam=-247.89,312.03,2.7,0.15&t=8' },
  { name: '05-gust-motion', title: '05 · a gust', scene: 'seed=1&cam=248.02,-179.13,-2.99,0.3&t=8&ref=gust' },
  // (no target: a close material study, a giant culm by the path, a stone bedded in the bank beside it, leaves caught
  // round their feet; it asks the contact between things that the wide frames hide)
  { name: '06-material', title: '06 · material study (a giant culm, a bedded stone)', scene: 'seed=1&cam=347.54,244,-2.27,-0.22&t=8' },
];
const MODES = [
  // (the forms alone: one clay, lit, shadows cast; no paper, no ink)
  { name: 'clay', query: 'clay&look=picture' },
  { name: 'picture', query: 'look=picture&marks=0&clean' },
  { name: 'ink', query: 'look=ink' },
  { name: 'board', query: '' },
  // (the hard test: no bamboo, no colour; the mountain and its path must still read)
  { name: 'land', query: 'grove=0&look=ink' },
];
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const gates = only.length ? GATES.filter((g) => only.some((o) => g.name.startsWith(o))) : GATES;

await withWood(async (lab) => {
  const img = (f) => `data:image/${f.endsWith('png') ? 'png' : 'jpeg'};base64,${readFileSync(f).toString('base64')}`;
  const sheets = [];
  for (const g of gates) {
    const shots = [];
    for (const m of MODES) {
      const p = await lab.open(`${g.scene}&still${m.query ? '&' + m.query : ''}`, { width: 390, height: 844 });
      await p.waitForTimeout(3500);
      const file = join(out, `${g.name}-${m.name}.png`);
      await p.screenshot({ path: file, timeout: 300000 });
      if (p.errors?.length) console.log(g.name, m.name, p.errors.slice(0, 2));
      shots.push([file, m.name]);
      await p.close();
    }
    const page = await lab.browser.newPage({ viewport: { width: 2400, height: 780 } });
    const target = join(CELL, 'devtools/bamboo/targets', `${g.name}.jpg`);
    const cells = [...(existsSync(target) ? [[target, 'target']] : []), ...shots];
    await page.setContent(`<style>body{margin:0;background:#efe6d2;font:600 15px Georgia,serif;color:#2a251e;padding:12px}.row{display:flex;gap:8px}.c{display:flex;flex-direction:column;gap:4px}img{height:700px;display:block}</style><div>${g.title}</div><div class="row">${cells.map(([f, n]) => `<div class="c"><img src="${img(f)}"><div>${n}</div></div>`).join('')}</div>`);
    await page.waitForTimeout(300);
    const sheet = join(out, `${g.name}.jpg`);
    await page.locator('body').screenshot({ path: sheet, type: 'jpeg', quality: 82 });
    await page.close();
    sheets.push(sheet);
    console.log('wrote', sheet);
  }
});

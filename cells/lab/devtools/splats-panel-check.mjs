// The control panel at a phone's size (node cells/lab/devtools/splats-panel-check.mjs): for the scenes with the most
// controls, the panel as it opens, capped and scrolling, its sections one at a time (devtools/out/panel-check.png).
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
await withWood(async (wood) => {
  const sh = [], lb = [];
  for (const [q, nm, open] of [['scene=composed', 'composed', null], ['scene=composed', 'composed · composition open', 'composition'], ['scene=bench', 'bench', null], ['scene=mist', 'mist', null], ['scene=stone', 'stone · display open', 'display']]) {
    const page = await wood.open(q);
    page.on('pageerror', (e) => console.log('page error', nm, e.message));
    await page.waitForFunction(() => window.__splats.drawn > 0, null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    if (open) await page.evaluate((k) => { const d = document.querySelector(`#panel details[data-key="${k}"]`); if (d) d.open = true; }, open);
    await page.waitForTimeout(600);
    const m = await page.evaluate(() => { const p = document.getElementById('panel').getBoundingClientRect(), s = document.querySelector('#panel .sections'); return { top: Math.round(p.top), height: Math.round(p.height), scrolls: s.scrollHeight > s.clientHeight + 1, open: [...document.querySelectorAll('#panel details[open]')].map((d) => d.dataset.key) }; });
    console.log(nm.padEnd(30), JSON.stringify(m));
    sh.push(await wood.shot(page, `panel-${nm.replace(/[^a-z]+/g, '-')}`)); lb.push(nm);
    await page.close();
  }
  await wood.montage(sh, 'panel-check', { height: 640, labels: lb, columns: 5 });
}, { width: 390, height: 760 });

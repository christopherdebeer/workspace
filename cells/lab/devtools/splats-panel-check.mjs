// Splats' panel, a drawer (client/drawer), at a phone's size (node cells/lab/devtools/splats-panel-check.mjs): the
// composed scene with the drawer closed, at focus and full (the subject lifting clear), the bench and mist full, and a
// control alone in focus mode (devtools/out/panel-check.png).
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
await withWood(async (wood) => {
  const sh = [], lb = [];
  const cases = [['scene=composed', 'composed · closed', 'closed'], ['scene=composed', 'composed · focus', 'focus'], ['scene=composed', 'composed · full', 'full'], ['scene=bench', 'bench · full', 'full'], ['scene=mist', 'mist · full', 'full'], ['scene=composed', 'focus mode: detail alone', 'focus-mode']];
  for (const [q, nm, st] of cases) {
    const page = await wood.open(q);
    page.on('pageerror', (e) => console.log('page error', nm, e.message));
    // (from a clean slate: nothing remembered from an earlier run)
    await page.evaluate(() => { localStorage.removeItem('splats-panel'); localStorage.removeItem('splats-drawer'); }); await page.reload();
    await page.waitForFunction(() => window.__splats.drawn > 0, null, { timeout: 120000 });
    await page.waitForTimeout(1200);
    await page.evaluate((st) => {
      const grip = document.getElementById('grip'), want = st === 'focus-mode' ? 'full' : st;
      for (let k = 0; k < 4 && document.getElementById('panel').dataset.drawer !== want; k++) grip.dispatchEvent(new KeyboardEvent('keydown', { key: ['closed', 'focus', 'full'].indexOf(want) > ['closed', 'focus', 'full'].indexOf(document.getElementById('panel').dataset.drawer) ? 'ArrowUp' : 'ArrowDown', bubbles: true }));
    }, st);
    await page.waitForTimeout(900);
    if (st === 'focus-mode') { await page.click('#stone-controls .sliders label', { position: { x: 6, y: 5 } }); await page.waitForTimeout(700); }
    const m = await page.evaluate(() => ({ state: document.getElementById('panel').dataset.drawer, height: getComputedStyle(document.documentElement).getPropertyValue('--drawer'), open: [...document.querySelectorAll('#panel details[open]')].map((d) => d.dataset.key).join(',') }));
    console.log(nm.padEnd(28), JSON.stringify(m));
    sh.push(await wood.shot(page, `panel-${nm.replace(/[^a-z]+/g, '-')}`)); lb.push(`${nm} · ${m.height}`);
    await page.close();
  }
  await wood.montage(sh, 'panel-check', { height: 640, labels: lb, columns: 6 });
}, { width: 390, height: 760 });

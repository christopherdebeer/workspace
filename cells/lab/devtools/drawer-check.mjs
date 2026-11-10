// The drawer at a phone's size (node cells/lab/devtools/drawer-check.mjs): its three heights, stepped by tap and by
// keyboard, Escape, focus mode, the scene lifting clear of it; in the paper and dark themes (devtools/out/drawer-check.png).
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'drawer'; process.env.READY = '__drawer';
await withWood(async (wood) => {
  const sh = [], lb = [], log = [];
  const page = await wood.open('drawer=closed');
  page.on('pageerror', (e) => log.push(`page error: ${e.message}`));
  await page.waitForFunction(() => window.__drawer, null, { timeout: 60000 });
  const st = () => page.evaluate(() => ({ state: window.__drawer.state, height: Math.round(window.__drawer.height), shift: +window.__drawer.shift.toFixed(3) }));
  const shot = async (nm) => { await page.waitForTimeout(700); sh.push(await wood.shot(page, `drawer-${nm.replace(/[^a-z]+/g, '-')}`)); lb.push(`${nm} · ${JSON.stringify(await st())}`); };
  await shot('closed');
  await page.click('#grip'); await shot('tapped: focus');
  await page.click('#grip'); await shot('tapped: full');
  await page.focus('#grip'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(500); log.push(`↓ → ${(await st()).state}`);
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(500); log.push(`↓ → ${(await st()).state}`);
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(500); log.push(`↑↑ → ${(await st()).state}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500); log.push(`Esc → ${(await st()).state}`);
  await page.keyboard.press('ArrowUp'); await page.waitForTimeout(500);
  // (focus mode: the subject section open, its size slider's name tapped)
  await page.evaluate(() => { const d = document.querySelector('details[data-key=subject]'); d.open = true; });
  await page.waitForTimeout(400);
  await page.click('details[data-key=subject] [data-focus] label', { position: { x: 8, y: 6 } });
  await shot('focus mode: size alone');
  log.push(`focused: ${await page.evaluate(() => !!window.__drawer.sections.focused)}`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300); log.push(`Esc → focused ${await page.evaluate(() => !!window.__drawer.sections.focused)}`);
  await page.evaluate(() => document.querySelector('[data-theme=dark]').click()); await shot('dark');
  await page.close();
  console.log(log.join('\n'));
  await wood.montage(sh, 'drawer-check', { height: 640, labels: lb, columns: 5 });
}, { width: 390, height: 760 });

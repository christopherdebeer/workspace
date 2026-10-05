// Crystals, headless: a few specimens rendered to devtools/out, and the probe checked.
// (node cells/lab/devtools/crystals-shot.mjs [outdir])
import { join } from 'node:path';
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'crystals';
const out = process.argv[2] ?? new URL('./out', import.meta.url).pathname;
await withWood(async (wood) => {
  for (const [name, q] of [['amethyst', 'mineral=amethyst&seed=12&still&q=high'], ['fluorite', 'mineral=fluorite&seed=5&still&q=high'], ['zircon', 'mineral=zircon&seed=8&still&q=high'], ['any', 'seed=1947&still&q=mid'], ['map', 'mineral=amethyst&seed=12&still&q=high&debug=caustic'], ['id', 'mineral=amethyst&seed=12&still&q=low&debug=id']]) {
    const page = await wood.browser.newPage({ viewport: { width: 720, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(wood.base + '?' + q, { timeout: 120000 });
    await page.waitForFunction(() => window.__crystals && window.__crystals.probe().frames > 3, null, { timeout: 180000 });
    const probe = await page.evaluate(() => window.__crystals.probe());
    console.log(name, JSON.stringify(probe), errors.length ? errors : '');
    await page.screenshot({ path: join(out, `crystals-${name}.png`), timeout: 120000 });
    await page.close();
  }
});

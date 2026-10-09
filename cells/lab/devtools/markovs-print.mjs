// Render Markovs Chains' print set to PDF and PNGs, and check the geometry (no clipping, one
// sheet a page). node cells/lab/devtools/markovs-print.mjs <outdir>
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'markovs';
const out = process.argv[2] ?? '.';
await withWood(async (wood) => {
  const page = await wood.browser.newPage({ viewport: { width: 900, height: 1200 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(wood.base + '?players=4&bots=0111&seed=1941' + (process.env.CARDS ? `&cards=${process.env.CARDS}` : ''));
  await page.waitForFunction(() => window.__markovs);
  // the playtest pages: the cell's public numbers, fetched here (the page tries too, but a dev
  // origin may not be allowed to) and handed to the page
  try {
    const base = 'https://parc.land/@c15r/playtest';
    const game = await (await fetch(`${base}/api/game/markovs-chains`, { headers: { accept: 'application/json' } })).json();
    const head = game?.head?.version;
    const evals = game?.evals ?? [];
    const baseline = [...evals].reverse().find((e) => e.version === head && /baseline/.test(e.tag)) ?? [...evals].reverse().find((e) => e.version === head);
    const ev = baseline ? await (await fetch(`${base}/api/eval/${baseline.id}`, { headers: { accept: 'application/json' } })).json() : null;
    await page.evaluate((d) => window.__markovs.playtest(d), { game, eval: ev });
    console.log('playtest: head', head, 'baseline', baseline?.id ?? 'none');
  } catch (e) { console.log('playtest numbers unavailable:', String(e).slice(0, 120)); }
  // the screen: the table with square parking spaces, a card turned
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.__markovs.lift());
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, 'markovs-screen.png'), fullPage: false });
  // print media: measure every page section
  await page.emulateMedia({ media: 'print' });
  const mm = 96 / 25.4;
  const geo = await page.evaluate(() => [...document.querySelectorAll('.print-page')].map((s) => {
    const r = s.getBoundingClientRect();
    const kids = [...s.querySelectorAll('.print-card, .ins-sheet, svg')].map((k) => k.getBoundingClientRect());
    const maxRight = Math.max(...kids.map((k) => k.right)), maxBottom = Math.max(...kids.map((k) => k.bottom));
    return { w: r.width, h: r.height, overflowX: maxRight - r.right, overflowY: maxBottom - r.bottom, scrollW: s.scrollWidth, scrollH: s.scrollHeight };
  }));
  console.log('pages', geo.length);
  for (const [i, g] of geo.entries()) console.log(`page ${i + 1}: ${(g.w / mm).toFixed(1)} × ${(g.h / mm).toFixed(1)} mm; content over the right edge ${(g.overflowX / mm).toFixed(1)} mm, over the bottom ${(g.overflowY / mm).toFixed(1)} mm; scroll ${(g.scrollW / mm).toFixed(0)}×${(g.scrollH / mm).toFixed(0)}`);
  await page.pdf({ path: join(out, 'markovs-chains.pdf'), format: 'A4', margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' }, printBackground: true, preferCSSPageSize: true });
  // each page section as a PNG, for looking
  await page.setViewportSize({ width: 800, height: 1150 });
  const sections = await page.$$('.print-page');
  for (const [i, s] of sections.entries()) await s.screenshot({ path: join(out, `markovs-print-${i + 1}.png`) });
  console.log('errors', errors);
});

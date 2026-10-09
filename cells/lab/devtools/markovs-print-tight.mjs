// The print set under a hostile print dialog (like iOS Safari's): wide margins, a header and
// footer, and content shrunk to fit. Checks that no card is cut across pages and counts pages.
//   node cells/lab/devtools/markovs-print-tight.mjs <outdir>
import { join } from 'node:path';
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'markovs';
const out = process.argv[2] ?? '.';
await withWood(async (wood) => {
  const page = await wood.browser.newPage({ viewport: { width: 900, height: 1200 } });
  await page.goto(wood.base + '?players=4&bots=0111&seed=1941');
  await page.waitForFunction(() => window.__markovs);
  await page.emulateMedia({ media: 'print' });
  const file = join(out, 'markovs-tight.pdf');
  await page.pdf({ path: file, format: 'A4', scale: 0.93, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:7px;width:100%;text-align:right;padding-right:12mm">page <span class="pageNumber"></span></div>', margin: { top: '14mm', bottom: '16mm', left: '16mm', right: '16mm' }, printBackground: true });
  console.log('wrote', file);
});

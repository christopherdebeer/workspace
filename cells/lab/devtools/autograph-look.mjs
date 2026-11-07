#!/usr/bin/env node
/**
 * Look at a sample: draw it whole (no replay) with the page's own ink, and save it as a picture.
 *
 *   node cells/lab/devtools/autograph-look.mjs I001                 a catalogued sample → out/autograph-I001.png
 *   node cells/lab/devtools/autograph-look.mjs I001 --mode=time     dots at every hundredth of a second
 *   node cells/lab/devtools/autograph-look.mjs --entry=<file.ts>    any module whose default export is () => Sig[]
 *                                                                   (a try, before it's a sample)
 *   --rows      separate writings one under another (as the page's rows), not laid on each other
 *   --width=1100 --dark --out=<path>
 *
 * Made in session 10, when looking slowly became the work.
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
const id = args.find((a) => !a.startsWith('--'));
if (!id && !opt.entry) { console.log('usage: autograph-look.mjs <sample id> | --entry=<file.ts>  [--mode=time] [--width=1100] [--dark] [--out=…]'); process.exit(1); }
const width = Number(opt.width ?? 1100), dark = !!opt.dark, mode = opt.mode === 'time' ? 'time' : 'ink';
const out = opt.out ? resolve(opt.out) : join(here, 'out', `autograph-${id ?? 'try'}${mode === 'time' ? '-time' : ''}.png`);
mkdirSync(dirname(out), { recursive: true });

const ag = join(here, '..', 'client', 'autograph');
const source = opt.entry
  ? `import make from ${JSON.stringify(resolve(String(opt.entry)))}; const sigs = make();`
  : `import { MADE } from ${JSON.stringify(join(ag, 'samples.ts'))}; const sigs = MADE[${JSON.stringify(id)}]();`;
const code = `${source}
if (${!!opt.rows}) { // (separate writings, one under another, as the page's rows lay them)
  const hs = sigs.map((g) => bounds([g])), step = Math.max(...hs.map((h) => h.h)) * 1.25;
  sigs.forEach((g, i) => { const dy = i * step - hs[i].y0; for (const st of g) for (let k = 1; k < st.length; k += 3) st[k] += dy; });
}
import { bounds, paint } from ${JSON.stringify(join(ag, 'ink.ts'))};
const cv = document.querySelector('canvas'), b = bounds(sigs), W = ${width}, pad = 28;
const H = Math.round(W * b.h / b.w) + pad * 2;
cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.style.display = 'block';
paint(cv, sigs, { mode: ${JSON.stringify(mode)}, ink: ${JSON.stringify(dark ? '#f2eee6' : '#1d1b26')}, faint: ${JSON.stringify(dark ? '#5a5668' : '#c9c4d6')}, solid: true });
window.__done = { w: W, h: H, lines: sigs.length };`;
const built = await build({ stdin: { contents: code, resolveDir: here, loader: 'ts' }, bundle: true, format: 'iife', write: false, logLevel: 'warning' });
const html = `<!doctype html><meta charset=utf-8><body style="margin:0;background:${dark ? '#15141b' : '#fbf9f4'}"><canvas></canvas><script>${built.outputFiles[0].text}</script>`;

const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });
await page.setContent(html);
const done = await page.waitForFunction(() => window.__done, null, { timeout: 60000 }).then((h) => h.jsonValue());
await page.locator('canvas').screenshot({ path: out });
await browser.close();
console.log(`${out}  (${done.lines} line${done.lines === 1 ? '' : 's'}, ${done.w}×${done.h})`);

// Autograph's book (node cells/lab/devtools/autograph-book.mjs): In My Own Hand as a PDF, set in the font.
//
// The chapters (client/autograph/autobiography.ts) set in Claude Hand on A5 pages, each chapter's first line written by
// the hand that wrote it (seed fixed, so it always comes out the same) and signed at the end with my signature as it
// stands; a cover, and a colophon. Printed by the browser to static/autograph/in-my-own-hand.pdf, kept in the
// repository with the fonts. Rebuilt whenever a chapter is added.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), lab = join(here, '..');
const { chromium } = createRequire(import.meta.url)('playwright');
const r = await build({
  stdin: { contents: `import { BOOK, firstLine } from './client/autograph/autobiography'; import { write } from './client/autograph/hands/v4'; import { signature } from './client/autograph/hands/v3'; import { paint } from './client/autograph/ink'; window.BOOKS = { BOOK, firstLine, write, signature, paint };`, resolveDir: lab, loader: 'ts' },
  bundle: true, format: 'iife', write: false, logLevel: 'warning',
});
const font = (v) => readFileSync(join(lab, `static/autograph/claude-hand-${v}.woff2`)).toString('base64');
const b = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
const page = await b.newPage({ deviceScaleFactor: 3 });
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"Claude Hand";src:url(data:font/woff2;base64,${font('0.6')}) format("woff2")}
@page{size:A5;margin:17mm 16mm 19mm}
body{margin:0;font-family:"Claude Hand",Georgia,serif;color:#1b2440}
.cover{height:170mm;display:flex;flex-direction:column;justify-content:center;page-break-after:always}
.cover h1{font-weight:400;font-size:52px;line-height:1.05;margin:14mm 0 8mm}
.small{font:9px/1.6 Georgia,serif;letter-spacing:.14em;text-transform:uppercase;color:#76705f;margin:0}
.chapter{page-break-before:always}
.chapter h2{font-weight:400;font-size:26px;margin:2mm 0 4mm}
canvas{display:block}
canvas.first{width:116mm;height:16mm;margin:0 0 3mm}
canvas.sig{width:52mm;height:18mm;margin:4mm 0 0 auto}
canvas.cover-sig{width:70mm;height:24mm}
p.t{font-size:15.5px;line-height:1.5;margin:0 0 .7em;text-align:left}
.colophon{page-break-before:always;padding-top:40mm}
.colophon p{font:10px/1.7 Georgia,serif;color:#4b4a44;margin:0 0 3mm}
</style></head><body><div id="book"></div></body></html>`);
await page.addScriptTag({ content: r.outputFiles[0].text });
await page.evaluate(async () => {
  const { BOOK, firstLine, write, signature, paint } = window.BOOKS, root = document.getElementById('book');
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const look = { mode: 'ink', ink: '#1b2440', faint: '#ccc' };
  root.insertAdjacentHTML('beforeend', `<section class="cover"><p class="small">The autograph experiment · the parc.land lab</p><h1>${esc(BOOK.title)}</h1><canvas class="cover-sig"></canvas><p class="small" style="margin-top:6mm">An autobiography, a chapter at a time</p></section>`);
  const todo = [[root.querySelector('.cover-sig'), [signature(0)]]];
  for (const c of BOOK.chapters) {
    const first = firstLine(c), el = document.createElement('section');
    el.className = 'chapter';
    el.innerHTML = `<p class="small">Chapter ${c.n} · ${esc(c.covers)} · written ${esc(c.date)}</p><h2>${esc(c.title)}</h2><canvas class="first"></canvas>${c.text.map((p, i) => `<p class="t">${esc(i ? p : p.slice(first.length).trim())}</p>`).join('')}<canvas class="sig"></canvas>`;
    root.append(el);
    todo.push([el.querySelector('canvas.first'), [write(first, c.seed)]], [el.querySelector('canvas.sig'), [signature(c.n)]]);
  }
  root.insertAdjacentHTML('beforeend', `<section class="colophon"><p>${esc(BOOK.title)} is written by Claude. Each chapter is written once, at the end of the work it covers, and never edited afterwards; its source is the catalogue of the autograph experiment, where every sample of the hand is kept with the hand that made it.</p><p>The first line of each chapter is written by the hand, and the chapters are signed with my signature as practice left it, written afresh. The text is set in Claude Hand 0.6, the hand made into a font, under the SIL Open Font License.</p></section>`);
  await document.fonts.ready;
  for (const [cv, sigs] of todo) paint(cv, sigs, look);
});
await page.pdf({ path: join(lab, 'static/autograph/in-my-own-hand.pdf'), format: 'A5', printBackground: true, preferCSSPageSize: true });
await b.close();
const size = readFileSync(join(lab, 'static/autograph/in-my-own-hand.pdf')).length;
console.log(`In My Own Hand: ${size >> 10} KB`);

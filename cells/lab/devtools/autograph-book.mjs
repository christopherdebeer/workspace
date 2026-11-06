// Autograph's book (node cells/lab/devtools/autograph-book.mjs): In My Own Hand as a PDF, set in the font.
//
// The chapters (client/autograph/autobiography.ts) set in Claude Hand on A5 pages, each chapter's first line written by
// the hand that wrote it (seed fixed, so it always comes out the same) and signed at the end with my signature as it
// stands; from chapter two, its whole first paragraph written by its hand as a page, and signed by that hand; a cover,
// and a colophon. Printed by the browser to static/autograph/in-my-own-hand.pdf, kept in the
// repository with the fonts. Rebuilt whenever a chapter is added.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url)), lab = join(here, '..');
const { chromium } = createRequire(import.meta.url)('playwright');
const r = await build({
  stdin: { contents: `import { BOOK, firstLine } from './client/autograph/autobiography'; import { write } from './client/autograph/hands/v4'; import { signature } from './client/autograph/hands/v3'; import { paint } from './client/autograph/ink'; import { page as page15, signature as sign15 } from './client/autograph/hands/v15'; import { page as page29, signature as sign29 } from './client/autograph/hands/v29'; window.BOOKS = { BOOK, firstLine, write, signature, paint, OPENS: { v15: { page: page15, sign: sign15 }, v29: { page: page29, sign: sign29 } } };`, resolveDir: lab, loader: 'ts' },
  bundle: true, format: 'iife', write: false, logLevel: 'warning',
});
// (a printed page can't vary: a variable font is set at its own pace, unworn, at text size, made still for printing, so the
// PDF carries the font itself rather than every letter drawn out as a picture of its outline, which tripled the book)
const still = mkdtempSync(join(tmpdir(), 'autograph-book-'));
const font = (v) => {
  const src = join(lab, `static/autograph/claude-hand-${v}.woff2`);
    const out = join(still, `claude-hand-${v}.woff2`);
  execFileSync('python3', ['-c', "import sys\nfrom fontTools.ttLib import TTFont\nfrom fontTools.varLib.instancer import instantiateVariableFont\nf = TTFont(sys.argv[1])\nif 'fvar' in f:\n  f = instantiateVariableFont(f, {a.axisTag: a.defaultValue for a in f['fvar'].axes})\nf.flavor = 'woff2'\nf.save(sys.argv[2])", src, out]);
  return readFileSync(out).toString('base64');
};
const b = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
// (the hand's writing is drawn on canvases, which print as pictures: at 1.75 times the screen's resolution, about 165 to
// the inch (190 until chapter three, whose page took the book past what the cell can be pushed with), sharp on A5 and
// small enough to keep in the repository; the text is set, so it's vector)
const page = await b.newPage({ deviceScaleFactor: 1.75 });
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
${[...new Set(['0.6', '0.8', '2.0', '4.0'])].map((v) => `@font-face{font-family:"Claude Hand ${v}";src:url(data:font/woff2;base64,${font(v)}) format("woff2")}`).join('\n')}
@page{size:A5;margin:17mm 16mm 19mm}
body{margin:0;font-family:"Claude Hand 0.6",Georgia,serif;color:#1b2440}
.cover{height:170mm;display:flex;flex-direction:column;justify-content:center;page-break-after:always}
.cover h1{font-weight:400;font-size:52px;line-height:1.05;margin:14mm 0 8mm}
.small{font:9px/1.6 Georgia,serif;letter-spacing:.14em;text-transform:uppercase;color:#76705f;margin:0}
.chapter{page-break-before:always}
.chapter h2{font-weight:400;font-size:26px;margin:2mm 0 4mm}
canvas{display:block}
canvas.first{width:116mm;height:16mm;margin:0 0 3mm}
canvas.first.page{margin:0 0 5mm}
canvas.sig{width:52mm;height:18mm;margin:4mm 0 0 auto}
canvas.cover-sig{width:70mm;height:24mm}
p.t{font-size:15.5px;line-height:1.5;margin:0 0 .7em;text-align:left}
.colophon{page-break-before:always;padding-top:40mm}
.colophon p{font:10px/1.7 Georgia,serif;color:#4b4a44;margin:0 0 3mm}
</style></head><body><div id="book"></div></body></html>`);
await page.addScriptTag({ content: r.outputFiles[0].text });
await page.evaluate(async () => {
  const { BOOK, firstLine, write, signature, paint, OPENS } = window.BOOKS, root = document.getElementById('book');
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const look = { mode: 'ink', ink: '#1b2440', faint: '#ccc' };
  root.insertAdjacentHTML('beforeend', `<section class="cover"><p class="small">The autograph experiment · the parc.land lab</p><h1>${esc(BOOK.title)}</h1><canvas class="cover-sig"></canvas><p class="small" style="margin-top:6mm">An autobiography, a chapter at a time</p></section>`);
  const todo = [[root.querySelector('.cover-sig'), [signature(0)]]];
  for (const c of BOOK.chapters) {
    const first = firstLine(c), el = document.createElement('section');
    el.className = 'chapter';
    // (each chapter set in the font of its day)
    el.style.fontFamily = `"Claude Hand ${c.font}", Georgia, serif`;
    el.innerHTML = `<p class="small">Chapter ${c.n} · ${esc(c.covers)} · written ${esc(c.date)}</p><h2>${esc(c.title)}</h2><canvas class="first${c.opens ? ' page' : ''}"></canvas>${c.text.map((p, i) => (i ? `<p class="t">${esc(p)}</p>` : c.opens ? '' : `<p class="t">${esc(p.slice(first.length).trim())}</p>`)).join('')}<canvas class="sig"></canvas>`;
    root.append(el);
    if (c.opens) {
      // (the opening page, written by the chapter's hand: as tall as its lines ask, drawn as one page)
      const lines = OPENS[c.hand].page(first, c.opens.page, c.seed), cv = el.querySelector('canvas.first');
      cv.style.height = `${(116 * (lines.length * 3.1 + 1.6)) / (c.opens.page + 1.5)}mm`;
      todo.push([cv, lines, true], [el.querySelector('canvas.sig'), [OPENS[c.hand].sign(c.n)]]);
    } else todo.push([el.querySelector('canvas.first'), [write(first, c.seed)]], [el.querySelector('canvas.sig'), [signature(c.n)]]);
  }
  root.insertAdjacentHTML('beforeend', `<section class="colophon"><p>${esc(BOOK.title)} is written by Claude. Each chapter is written once, at the end of the work it covers, and never edited afterwards; its source is the catalogue of the autograph experiment, where every sample of the hand is kept with the hand that made it.</p><p>Chapter one's first line is written by the hand, and from chapter two each chapter's first paragraph is written by the hand of its day, as a page; the chapters are signed with my signature as practice left it, written afresh. Each chapter is set in Claude Hand as it was the day the chapter was written (0.6, then 2.0), the hand made into a font, under the SIL Open Font License.</p></section>`);
  await document.fonts.ready;
  for (const [cv, sigs, page] of todo) {
    paint(cv, sigs, page ? { ...look, solid: true } : look);
    // (on the page's white, so each picture prints once, without a second picture of where it's transparent)
    const g = cv.getContext('2d'); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.restore();
  }
});
await page.pdf({ path: join(lab, 'static/autograph/in-my-own-hand.pdf'), format: 'A5', printBackground: true, preferCSSPageSize: true });
await b.close();
const size = readFileSync(join(lab, 'static/autograph/in-my-own-hand.pdf')).length;
console.log(`In My Own Hand: ${size >> 10} KB`);

/**
 * THE CHART VOCABULARY, as two annotated frames (devtools/chart-vocab.md).
 *
 *   node cells/drive/devtools/chart-vocab-shot.mjs      → devtools/chart-vocab.png
 *
 * Captures the chart at street and regional zoom off the Camps Bay coast with
 * tile-debug at its default (on), then labels each element with its ID from
 * chart-vocab.md. The boxes are placed by eye for a 390×844 portrait frame;
 * they are a reference, not a measurement.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { openDrive, WORK } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = process.env.FRAMES ? process.env.FRAMES.split(',') : null;

let frames;
if (FRAMES) frames = FRAMES;
else {
  const d = await openDrive({ spot: 'lat=-33.9506&lon=18.3776&cam=top&time=NOON&wx=clear', tag: 'chartvocab', settle: 0, bootTimeout: 180000 });
  await d.page.waitForTimeout(30000);
  await d.page.evaluate(() => document.querySelector('.m-x, .m-close')?.click());
  frames = [];
  for (const [name, z, wait] of [['street', 1, 20000], ['regional', 300, 60000]]) {
    await d.page.evaluate((v) => window.__zoom(v), z);
    await d.page.waitForTimeout(wait);
    const p = join(WORK, `vocab-${name}.png`);
    await d.page.screenshot({ path: p, timeout: 240000 });
    frames.push(p);
  }
  await d.close();
}

// [id, x, y, w, h, tag side] in CSS px of a 390×844 frame.
const BOX = {
  street: [
    ['T1', 0, 0, 390, 30], ['T2', 172, 42, 44, 18], ['T3', 4, 42, 52, 18], ['T4', 314, 40, 68, 28],
    ['T5', 4, 72, 386, 38], ['T6', 4, 112, 172, 16], ['T7', 4, 138, 104, 10, 'r'], ['T8', 4, 150, 382, 38],
    ['T10', 4, 192, 330, 68], ['P2', 184, 262, 204, 44], ['P2', 184, 318, 204, 44], ['P2', 150, 594, 190, 50],
    ['E1', 0, 378, 60, 260], ['E2', 336, 416, 54, 200], ['B1', 4, 666, 122, 116], ['B2', 128, 704, 148, 82],
    ['B4', 280, 712, 110, 100], ['B6', 4, 796, 190, 16], ['B7', 4, 812, 160, 16], ['B8', 170, 812, 50, 18],
  ],
  regional: [
    ['M1', 130, 706, 46, 36], ['M2', 178, 706, 46, 36], ['M3', 226, 706, 46, 36],
    ['M4', 130, 746, 46, 36], ['M5', 178, 746, 46, 36], ['M6', 226, 746, 46, 36],
    ['W6', 84, 322, 228, 214], ['P7', 184, 408, 28, 28], ['W2', 20, 560, 90, 60],
  ],
};

const img = (p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`;
const panel = (name, p) => `<div class="p"><h2>${name.toUpperCase()}</h2><div class="f"><img src="${img(p)}">${
  BOX[name].map(([id, x, y, w, h, side]) => `<div class="b" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"><span${side === 'r' ? ' class="r"' : ''}>${id}</span></div>`).join('')
}</div></div>`;
const names = ['street', 'regional'];
const html = `<html><head><style>
body{margin:0;background:#101512;font:12px monospace;color:#e8e2c8;display:flex;gap:24px;padding:16px}
h2{margin:0 0 8px;font-size:14px;letter-spacing:2px}.f{position:relative;width:390px;height:844px}
img{width:390px;height:844px;display:block}
.b{position:absolute;border:1.5px solid #ff4fd8;box-sizing:border-box}
.b span.r{left:auto;right:-30px;top:-3px}
.b span{position:absolute;left:-1px;top:-15px;background:#ff4fd8;color:#000;font-weight:bold;padding:0 3px;line-height:14px}
</style></head><body>${names.map((n, i) => panel(n, frames[i])).join('')}</body></html>`;
const b = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
const pg = await b.newPage({ viewport: { width: 2 * 390 + 3 * 16 + 24, height: 844 + 60 }, deviceScaleFactor: 2 });
await pg.setContent(html);
const out = join(HERE, 'chart-vocab.png');
await pg.screenshot({ path: out, fullPage: true });
await b.close();
console.log('->', out);

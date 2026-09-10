// HOW MUCH OF THE WIDE CHART IS ROAD INK — the seat's five Afsluitdijk frames
// as numbers, control against fix.
//
//   node cells/drive/devtools/chart-ink.mjs            (the working tree)
//   REV=<sha> node cells/drive/devtools/chart-ink.mjs  (a control)
//
// Stands where the seat stood (Súdwest-Fryslân, on the Afsluitdijk) and
// photographs the chart at four zooms that land on four rungs of the overview
// ladder, each with its ring home. Per frame: the share of the terrain pane
// that is ribbon gold, and the mean luma of that gold against the ground's —
// the two numbers "too bold" is made of. Labels are gold too and are the same
// in both runs, so the DIFFERENCE between runs is the ribbons'.
import { openDrive, WORK } from './harness.mjs';
import { readPng } from './png-lite.mjs';
import { join } from 'node:path';

const REV = process.env.REV || '';
const tag = REV ? `ink-${REV.slice(0, 7)}` : 'ink-fix';
const ZOOMS = (process.env.Z ?? '30,300,2000,19300').split(',').map(Number);
const { page, close } = await openDrive({ spot: `lat=53.0179&lon=5.2061&h=0&cam=top&z=${ZOOMS[0]}&nodraw=1&wx=clear&time=DAY`, tag, menu: true, settle: 0, rev: REV });
const rows = [];
for (const z of ZOOMS) {
  await page.evaluate((zz) => { window.__cam('top'); window.__zoom(zz); }, z);
  for (let i = 0; i < 80; i++) {
    if (await page.evaluate((zz) => Math.abs(window.__cam().zoom - zz) < Math.max(0.5, zz * 0.02), z)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  // The ring, then the frame. `word` is the chart's own "MAP z8 · 3/25" and
  // is empty once the level is home.
  let ov = null;
  for (let i = 0; i < 60; i++) {
    ov = await page.evaluate(() => { const o = window.__ov(); return { level: o.level, tiles: o.tiles, word: o.word, px: o.ribbonPx, ink: o.ink }; });
    if (!ov.word) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  await page.evaluate(() => window.__draw(true));
  const f0 = await page.evaluate(() => window.__clock().frames);
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__clock().frames) - f0 >= 4) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const shot = join(WORK, `ink-${REV ? 'ctl' : 'fix'}-${z}.png`);
  await page.screenshot({ path: shot, timeout: 240000 });
  await page.evaluate(() => window.__draw(false));
  // Art resolution, the terrain pane, gold against the rest.
  const p = readPng(shot), AW = 148, S = p.w / AW;
  let gold = 0, n = 0, gl = 0, groundL = 0, gn = 0;
  for (let ay = 26; ay < 236; ay++) for (let ax = 26; ax < 122; ax++) {
    const x = Math.min(p.w - 1, Math.round(ax * S + S / 2)), y = Math.min(p.h - 1, Math.round(ay * S + S / 2));
    const i = (y * p.w + x) * p.bpp, r = p.data[i], g = p.data[i + 1], b = p.data[i + 2];
    const L = r * 0.2126 + g * 0.7152 + b * 0.0722;
    n++;
    if (r > 140 && r - b > 60 && g > 100) { gold++; gl += L; } else { groundL += L; gn++; }
  }
  const row = { z, level: ov?.level, ribbonPx: ov?.px, ink: ov?.ink, goldShare: +(100 * gold / n).toFixed(2), goldLuma: gold ? +(gl / gold).toFixed(0) : 0, groundLuma: +(groundL / Math.max(1, gn)).toFixed(0), frame: shot, sc: await page.evaluate(() => window.__scale().label) };
  rows.push(row);
  console.log(JSON.stringify(row));
}
console.log(`pageerrors: ${JSON.stringify((await page.evaluate(() => window.__pageErrors ?? [])).slice(0, 3))}`);
await close();

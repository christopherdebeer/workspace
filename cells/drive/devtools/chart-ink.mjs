// HOW MUCH OF THE WIDE CHART IS ROAD INK — the seat's five Afsluitdijk frames
// as numbers, control against fix.
//
//   node cells/drive/devtools/chart-ink.mjs            (the working tree)
//   REV=<sha> node cells/drive/devtools/chart-ink.mjs  (a control)
//
// Stands where the seat stood (Súdwest-Fryslân, on the Afsluitdijk) and
// photographs the chart at four zooms that land on four rungs of the overview
// ladder, each with its ring home — twice: with the overview layer and with
// it hidden (`__hide('ov')`), the scene otherwise the same. The pixels that
// differ ARE the ribbons, so the two numbers "too bold" is made of fall out
// without a colour test: the FOOTPRINT (the share of the terrain pane the
// ribbons change) and the CONTRAST (how far, in luma, they move it). A gold
// share is kept beside them for the eye, and it is the weaker instrument: it
// cannot see muted ink, which is the point of the fix.
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
  // The same frame without the layer. The HUD's labels ride on top in both,
  // and every pixel the two frames disagree on is the overview's.
  await page.evaluate(() => { window.__hide('ov', true); window.__draw(true); });
  const f1 = await page.evaluate(() => window.__clock().frames);
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => window.__clock().frames) - f1 >= 4) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const bare = join(WORK, `ink-${REV ? 'ctl' : 'fix'}-${z}-bare.png`);
  await page.screenshot({ path: bare, timeout: 240000 });
  await page.evaluate(() => { window.__draw(false); window.__hide('ov', false); });
  // Art resolution, the terrain pane.
  const p = readPng(shot), q = readPng(bare), AW = 148, S = p.w / AW;
  let n = 0, changed = 0, dSum = 0, gold = 0, groundL = 0, gn = 0;
  for (let ay = 26; ay < 236; ay++) for (let ax = 26; ax < 122; ax++) {
    const x = Math.min(p.w - 1, Math.round(ax * S + S / 2)), y = Math.min(p.h - 1, Math.round(ay * S + S / 2));
    const i = (y * p.w + x) * p.bpp, r = p.data[i], g = p.data[i + 1], b = p.data[i + 2];
    const L = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const L0 = q.data[i] * 0.2126 + q.data[i + 1] * 0.7152 + q.data[i + 2] * 0.0722;
    n++;
    if (Math.abs(L - L0) > 12) { changed++; dSum += L - L0; } else { groundL += L0; gn++; }
    if (r > 140 && r - b > 60 && g > 100) gold++;
  }
  const row = { z, level: ov?.level, footprint: +(100 * changed / n).toFixed(2), contrast: changed ? +(dSum / changed).toFixed(0) : 0,
    groundLuma: +(groundL / Math.max(1, gn)).toFixed(0), goldShare: +(100 * gold / n).toFixed(2), frame: shot,
    sc: await page.evaluate(() => (window.__scale ? window.__scale().label : '(no scale on this revision)')) };
  rows.push(row);
  console.log(JSON.stringify(row));
}
console.log(`pageerrors: ${JSON.stringify((await page.evaluate(() => window.__pageErrors ?? [])).slice(0, 3))}`);
await close();

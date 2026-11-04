// One explorer case looked into (node cells/lab/devtools/labyrinth-probe.mjs CASE_DIR): the columns under its stroke
// (ground, what stands, stair or pier, paving, water) and what the gesture code makes of it now: for fixing as you go.
import './labyrinth-node.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const { replay } = await import('../client/labyrinth/model.ts');
const G = await import('../client/labyrinth/gesture.ts');
const dir = process.argv[2], b = JSON.parse(readFileSync(join(dir, 'before.json'), 'utf8')), g = b.gesture, w = replay(b.world);
const column = (i, j) => { const gr = w.ground(i, j); let k = gr; while (w.stone(k, i, j) || w.stair(k, i, j) >= 0) k++; return { g: gr, top: k, built: k > gr }; };
const pickAt = (i, j) => { const c = column(i, j); return c.built ? { face: 'top', hit: [c.top - 1, i, j], to: [c.top, i, j] } : { face: 'ground', hit: [c.g - 1, i, j], to: [c.g, i, j] }; };
const desc = ([i, j]) => { const c = column(i, j), s = []; for (let k = c.g; k < c.top; k++) s.push(w.stair(k, i, j) >= 0 ? `s${w.stair(k, i, j)}` : w.archway(k, i, j) >= 0 ? 'A' : '#'); return `(${i},${j}) g${c.g}${w.pool(i, j) ? '~' : ''}${w.paved(i, j) ? '=' : ''} ${s.join('') || '-'} top${c.top}`; };
console.log(g.kind, g.intent, g.by ?? '');
for (const c of g.path ?? [g.at]) console.log(' ', desc(c));
let op;
if (g.kind === 'tap' || g.kind === 'tapTop') op = G.tap(w, pickAt(...g.at), 0, false, g.intent);
else if (g.kind === 'lift') op = G.lift(w, pickAt(...g.at), g.by, 0);
else { const last = g.path.at(-1), end = g.path.length > 1 && column(...last).built && (last[0] !== g.path[0][0] || last[1] !== g.path[0][1]) ? pickAt(...last) : null; op = G.trace(w, pickAt(...g.path[0]), g.path, end, () => 0, 0, g.rests, g.intent); }
console.log(op && JSON.stringify({ ...op, born: undefined }, (k, v) => (k === 'at' || k === 'cells' ? undefined : v)).slice(0, 900));
// (with a file named after it: before and after drawn side by side, there)
if (process.argv[3] && op && !('refused' in op)) {
  const { iso } = await import('./labyrinth-iso.mjs'), { chromium } = await import('playwright'), { existsSync } = await import('node:fs');
  const w1 = replay(b.world); w1.apply({ ...op, alts: undefined }, 0);
  const o = { focus: g.path ?? [g.at], stroke: g.path ?? null, rests: g.rests ?? [], tap: g.path ? null : g.at, margin: 4 };
  const browser = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined }), page = await browser.newPage();
  await page.setContent(`<html><body style="margin:0;display:flex;background:#f4efe4">${iso(w, { ...o, title: 'before' })}${iso(w1, { ...o, title: `after · ${op.note ?? op.why}` })}</body></html>`);
  await page.setViewportSize({ width: 1400, height: 600 }); await page.screenshot({ path: process.argv[3], fullPage: true }); await browser.close();
}

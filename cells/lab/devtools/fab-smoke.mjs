/**
 * Fab, before every deploy: is each place where it should be, and does the paper still answer?
 *
 *   node cells/lab/devtools/fab-smoke.mjs
 *
 * - each family, at the figure: the figure's on the screen, above the drawer, and nothing's thrown;
 * - at the table, opened there: the piece is on the screen above the drawer, and a drag on its hem makes it longer;
 * - at the rails: there's a garment in front;
 * - a tap on the table from the figure goes there, and on the figure from the table comes back.
 * Exits 1 on any failure. (Slow software GL: a minute or two.)
 */
import { withWood, checks } from './harness.mjs';
process.env.EXPERIMENT = 'fab'; process.env.READY = '__fab';
const c = checks();
await withWood(async (lab) => {
  const W = 430, H = 900;
  const open = async (q) => { const p = await lab.open(q, { width: W, height: H }); await p.waitForTimeout(2500); return p; };
  const top = (p) => p.evaluate(() => document.getElementById('bench').getBoundingClientRect().top);
  const on = (pt, drawerTop) => pt[0] > 0 && pt[0] < W && pt[1] > 60 && pt[1] < drawerTop;
  for (const fam of ['skirt', 'top', 'dress', 'trousers', 'jumpsuit']) {
    const p = await open(`settle=20&fam=${fam}&fabric=lawn`);
    const at = await p.evaluate(() => window.__fab.roomToScreen([0, 70, 0])), mode = await p.evaluate(() => window.__fab.probe().mode);
    c.ok(`${fam}: opens at the figure, the figure on the screen above the drawer`, mode === 'bench' && on(at, await top(p)), { mode, at });
    c.ok(`${fam}: nothing thrown`, !p.errors.length, p.errors);
    await p.close();
  }
  {
    const p = await open('at=table&settle=10&len=34&panels=4&fabric=lawn&m=');
    const b = await p.evaluate(() => window.__fab.paper.bounds()), cx = (b.x0 + b.x1) / 2;
    const S = (x, y) => p.evaluate(([a, d]) => window.__fab.sheetToScreen(a, d), [x, y]);
    const mid = await S(cx, (b.y0 + b.y1) / 2);
    c.ok('table: the piece is on the screen above the drawer', on(mid, await top(p)), mid);
    const a = await S(cx, b.y1 - 4), z = await S(cx, b.y1 + 60);
    await p.mouse.move(a[0], a[1]); await p.mouse.down();
    for (let k = 1; k <= 10; k++) { await p.mouse.move(a[0] + ((z[0] - a[0]) * k) / 10, a[1] + ((z[1] - a[1]) * k) / 10); await p.waitForTimeout(30); }
    await p.mouse.up(); await p.waitForTimeout(500);
    const len = await p.evaluate(() => window.__fab.probe().recipe.length);
    c.ok('table: dragging the hem makes it longer', len > 34, len);
    // (tap the figure across the room: back to it)
    const f = await p.evaluate(() => window.__fab.roomToScreen([0, 80, 0]));
    if (on(f, await top(p))) { await p.mouse.click(f[0], f[1]); await p.waitForTimeout(400); c.ok('table: a tap on the figure goes to it', (await p.evaluate(() => window.__fab.probe().mode)) === 'bench'); }
    c.ok('table: nothing thrown', !p.errors.length, p.errors);
    await p.close();
  }
  for (const [fam, key] of [['top', 'bodyLen'], ['trousers', 'legLen']]) {
    // (a top's or trousers' whole pattern at the table: the hand drags a lit hem longer; the scissors spread it)
    const p = await open(`at=table&settle=10&fam=${fam}&fabric=lawn`);
    const drag = async (dx, dy) => {
      const h = (await p.evaluate(() => window.__fab.wholeHems()))[0];
      const a = await p.evaluate(([x, y]) => window.__fab.sheetToScreen(x, y), h.mid), z = await p.evaluate(([x, y]) => window.__fab.sheetToScreen(x, y), [h.mid[0] + dx, h.mid[1] + dy]);
      await p.mouse.move(a[0], a[1]); await p.mouse.down();
      for (let k = 1; k <= 10; k++) { await p.mouse.move(a[0] + ((z[0] - a[0]) * k) / 10, a[1] + ((z[1] - a[1]) * k) / 10); await p.waitForTimeout(30); }
      await p.mouse.up(); await p.waitForTimeout(500);
      return p.evaluate(() => window.__fab.probe().design);
    };
    const d0 = await p.evaluate(() => window.__fab.probe().design), d1 = await drag(0, 60);
    c.ok(`${fam} at the table: dragging a hem makes it longer`, d1[key] > d0[key], [d0[key], d1[key]]);
    await p.click('.tool[data-tool="scissors"]'); await p.waitForTimeout(500);
    const sk = fam === 'top' ? 'swing' : 'flare', d2 = await drag(120, 0);
    c.ok(`${fam} at the table: slashing a hem flares it`, d2[sk] > d1[sk], [d1[sk], d2[sk]]);
    c.ok(`${fam} at the table: nothing thrown`, !p.errors.length, p.errors);
    await p.close();
  }
  {
    const p = await open('rails&warm');
    const s = await p.evaluate(() => window.__fab.probe());
    c.ok('rails: opens at the rails, a garment in front', s.mode === 'rails' && s.onRail > 0 && s.front >= 0, s);
    c.ok('rails: nothing thrown', !p.errors.length, p.errors);
    await p.close();
  }
}, { width: 430, height: 900 });
c.done();

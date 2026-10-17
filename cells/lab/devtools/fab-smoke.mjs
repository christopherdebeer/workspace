/**
 * Fab, before every deploy: is each place where it should be, and does the paper still answer?
 *
 *   node cells/lab/devtools/fab-smoke.mjs
 *
 * - each family, at the figure: the figure's on the screen, above the drawer, and nothing's thrown;
 * - at the table, opened there: the piece is on the screen above the drawer, and a drag on its hem makes it longer;
 * - a top's and trousers' pattern: a tap picks a piece, its hem and corner dragged lengthen and flare it, the drawer lists
 *   what each edge does, and a tap on the paper round it goes back to the whole pattern;
 * - at the rails: there's a garment in front; with one on, another as well makes two, instead one;
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
  {
    // (posing: its joints marked; an elbow taken hold of and moved, the arm goes with it; stood as it was again)
    const p = await open('settle=20&fam=dress&fabric=lawn&drawer=closed');
    await p.click('#posing'); await p.waitForTimeout(500);
    const a = await p.evaluate(() => window.__fab.jointOnScreen('el', 0));
    await p.mouse.move(a[0], a[1]); await p.mouse.down();
    for (let k = 1; k <= 10; k++) { await p.mouse.move(a[0], a[1] - 8 * k); await p.waitForTimeout(50); }
    await p.waitForTimeout(1200); await p.mouse.up();
    const b = await p.evaluate(() => window.__fab.jointOnScreen('el', 0));
    c.ok('posing: an elbow taken hold of and lifted, the arm goes up', b[1] < a[1] - 20 && (await p.evaluate(() => window.__fab.posedByHand())), [a, b]);
    await p.click('#unpose'); await p.waitForTimeout(500);
    c.ok('posing: stood as it was again', !(await p.evaluate(() => window.__fab.posedByHand())));
    c.ok('posing: nothing thrown', !p.errors.length, p.errors);
    await p.close();
  }
  for (const [fam, key, sk] of [['top', 'bodyLen', 'swing'], ['trousers', 'legLen', 'flare']]) {
    // (a top's or trousers' whole pattern at the table: a tap on a piece picks it, its edges lit; its hem dragged makes it
    // longer, its corner dragged out flares it; a tap on the paper round it, back to the whole pattern)
    const p = await open(`at=table&settle=10&fam=${fam}&fabric=lawn`);
    const S = (x, y) => p.evaluate(([a, b]) => window.__fab.sheetToScreen(a, b), [x, y]);
    const piece = (await p.evaluate(() => window.__fab.pieces())).find((x) => x.name === 'front') ?? (await p.evaluate(() => window.__fab.pieces()))[0];
    const at = await S(...piece.mid);
    await p.mouse.click(at[0], at[1]); await p.waitForTimeout(600);
    const picked = await p.evaluate(() => window.__fab.editor.selected);
    c.ok(`${fam} at the table: a tap on a piece picks it, its edges to drag`, !!picked && (await p.evaluate(() => window.__fab.wholeHems().length)) > 0, picked);
    const drag = async (k, dx, dy) => {
      const h = (await p.evaluate(() => window.__fab.wholeHems())).find((x) => x.key === k);
      if (!h) return null;
      const a = await S(...h.mid), z = await S(h.mid[0] + dx, h.mid[1] + dy);
      await p.mouse.move(a[0], a[1]); await p.mouse.down();
      for (let k2 = 1; k2 <= 10; k2++) { await p.mouse.move(a[0] + ((z[0] - a[0]) * k2) / 10, a[1] + ((z[1] - a[1]) * k2) / 10); await p.waitForTimeout(30); }
      await p.mouse.up(); await p.waitForTimeout(500);
      return p.evaluate(() => window.__fab.probe().design);
    };
    const d0 = await p.evaluate(() => window.__fab.probe().design), d1 = await drag(key, 0, 60);
    c.ok(`${fam} at the table: dragging its hem makes it longer`, d1 && d1[key] > d0[key], [d0[key], d1?.[key]]);
    const d2 = await drag(sk, 120, 0);
    c.ok(`${fam} at the table: dragging its hem's corner out flares it`, d2 && d2[sk] > (d1 ?? d0)[sk], [(d1 ?? d0)[sk], d2?.[sk]]);
    const gest = await p.evaluate(() => [...document.querySelectorAll('#gestures .gest')].map((e) => e.textContent));
    c.ok(`${fam} at the table: the drawer lists what each edge does`, gest.some((t) => /drag the hem/.test(t)), gest);
    // (off the piece, on the paper: the whole pattern again)
    // (beside the piece, low on the screen above the drawer: the table, or the paper round it)
    const off = [16, (await top(p)) - 40];
    await p.mouse.click(off[0], off[1]); await p.waitForTimeout(600);
    c.ok(`${fam} at the table: a tap on the paper round it, the whole pattern again`, (await p.evaluate(() => window.__fab.editor.selected)) === '');
    c.ok(`${fam} at the table: nothing thrown`, !p.errors.length, p.errors);
    await p.close();
  }
  {
    const p = await open('rails&warm');
    const s = await p.evaluate(() => window.__fab.probe());
    c.ok('rails: opens at the rails, a garment in front', s.mode === 'rails' && s.onRail > 0 && s.front >= 0, s);
    // (put one on; then another, as well: two worn; then another instead: one)
    await p.evaluate(() => window.__fab.wear(window.__fab.room.front())); await p.waitForTimeout(1500);
    await p.evaluate(() => window.__fab.backToRails()); await p.waitForTimeout(1500);
    c.ok('rails: with something on, it asks: instead, or as well', await p.evaluate(() => !document.getElementById('railwith').hidden));
    await p.click('#railwith [data-with=also]');
    await p.evaluate(() => { const r = window.__fab.room; r.goTo(Math.min(r.states[r.active].hung.length - 1, r.front() + 1)); });
    await p.waitForTimeout(1500);
    await p.evaluate(() => window.__fab.wear(window.__fab.room.front())); await p.waitForTimeout(1500);
    const two = await p.evaluate(() => window.__fab.outfit().length);
    c.ok('as well: two on the figure', two === 2, two);
    // (a tap on the figure finds what's worn there)
    const hit = await p.evaluate(() => { const [x, y] = window.__fab.roomToScreen([0, 62, 0]); return window.__fab.pickWorn(x, y); });
    c.ok('two on: a tap on the figure finds a garment there', !!hit, hit);
    await p.evaluate(() => window.__fab.backToRails()); await p.waitForTimeout(1500);
    await p.click('#railwith [data-with=instead]');
    await p.evaluate(() => { const r = window.__fab.room; r.goTo(Math.max(0, r.front() - 1)); });
    await p.waitForTimeout(1500);
    await p.evaluate(() => window.__fab.wear(window.__fab.room.front())); await p.waitForTimeout(1500);
    const one = await p.evaluate(() => window.__fab.outfit().length);
    c.ok('instead: one on the figure', one === 1, one);
    c.ok('rails: nothing thrown', !p.errors.length, p.errors);
    await p.close();
  }
}, { width: 430, height: 900 });
c.done();

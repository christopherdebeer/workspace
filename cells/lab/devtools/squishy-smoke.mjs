/**
 * Squishy, before every deploy: does every place open, and is the dumpling where it should be?
 *
 *   node cells/lab/devtools/squishy-smoke.mjs
 *
 * - the title: in title mode, the two of them on it, nothing thrown;
 * - the first level of each place, and a level from the jelly's own run: the opening flythrough cut short by a tap,
 *   the dumpling at rest on its start, on the screen and able to be flicked, its volume kept, nothing thrown;
 * - a bench: opens, nothing thrown.
 * Fast-forwarded (`fast=12`, small and plain): about a minute and a half. Exits 1 on any failure. For the deeper
 * checks, `squishy-shot.mjs --test` (in the browser, ~2 min) and `squishy.test.mjs` (no browser, ~10 min).
 */
import { withWood, checks } from './harness.mjs';
process.env.EXPERIMENT = 'squishy'; process.env.READY = '__squishy';
const c = checks(), FQ = 'fast=12&scale=0.3', W = 390, H = 844;
await withWood(async (lab) => {
  const open = (q) => lab.open(q ? `${q}&${FQ}` : FQ, { width: W, height: H });
  const errs = (p) => p.errors.filter((e) => !e.includes('404'));
  {
    const p = await open('');
    await p.waitForFunction(() => window.__squishyAt().title.length === 2, null, { timeout: 90000, polling: 250 }).catch(() => {});
    const s = await lab.state(p), t = (await p.evaluate(() => window.__squishyAt())).title;
    c.ok('title: the title, the two of them on it', s.mode === 'title' && t.length === 2, { mode: s.mode, n: t.length });
    c.ok('title: nothing thrown', !errs(p).length, errs(p));
    await p.close();
  }
  for (const n of [1, 5, 9, 13, 17]) {
    const p = await open(`level=${n}`);
    await p.waitForTimeout(1500);
    await p.mouse.click(30, 420);
    await p.waitForFunction(() => window.__squishy.fly < 0 && window.__squishy.contacts > 0 && window.__squishy.speed < 3, null, { timeout: 120000, polling: 250 }).catch(() => {});
    // (two frames apart, so the camera's come to rest on it)
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const s = await lab.state(p), a = (await p.evaluate(() => window.__squishyAt())).at;
    c.ok(`level ${n} (${s.chapter}): at rest on its start, able to be flicked, its volume kept`, s.contacts > 0 && s.speed < 3 && s.canFlick && Math.abs(s.volume - 1) < 0.03 && s.falls === 0, s);
    c.ok(`level ${n}: the dumpling on the screen`, !!a && a[0] > 0 && a[0] < W && a[1] > 0 && a[1] < H, a);
    c.ok(`level ${n}: nothing thrown`, !errs(p).length, errs(p));
    await p.close();
  }
  {
    const p = await open('bench=coats');
    await p.waitForFunction(() => window.__squishy.contacts > 0, null, { timeout: 90000, polling: 250 }).catch(() => {});
    c.ok('a bench opens, the dumpling on it', (await lab.state(p)).contacts > 0);
    c.ok('bench: nothing thrown', !errs(p).length, errs(p));
    await p.close();
  }
}, { width: W, height: H });
c.done();

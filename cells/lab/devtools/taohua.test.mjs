/**
 * TAOHUA, IN THE BROWSER — the journey runs, and keeps running.
 *
 *   node cells/lab/devtools/taohua.test.mjs
 *
 * 1. The arrival: a key pressed while the boat comes in doesn't walk the walker (they're in the
 *    boat); the arrival ends on the jetty's deck and the page keeps drawing.
 * 2. A tap while arriving ends it at once.
 * 3. Walking: told to go somewhere on the ways, the walker gets there and stops.
 * 4. The same seed and place make the same hillside about the walker.
 * 5. The boat: its pole keeps its length, the hands on it, and a burst of taps (more than are
 *    queued) comes to an end with the pole lifted out, at a release.
 */
process.env.EXPERIMENT ??= 'taohua';
process.env.READY ??= '__taohua';
const { withWood, checks } = await import('./harness.mjs');

const c = checks();
await withWood(async (wood) => {
  const s = (page) => page.evaluate(() => ({ ...window.__taohua, intro: window.__taohua.intro(), here: window.__taohua.here(), off: window.__taohua.off() }));
  /** whether the page is still drawing: it reports itself afresh each frame (given 4 s: a headless, software-drawn frame can take 2) */
  const alive = async (page) => {
    const was = await page.evaluateHandle(() => window.__taohua);
    await page.waitForTimeout(4000);
    return page.evaluate((w) => w !== window.__taohua, was);
  };

  // 1. a key during the arrival
  {
    // (a couple of seconds before its end, however long it is)
    const probe = await wood.open('seed=1&intro=0');
    const T = await probe.evaluate(() => window.__taohua.arriveT);
    await probe.close();
    const page = await wood.open(`seed=1&intro=${(T - 2).toFixed(1)}`);
    const t0 = await s(page);
    c.ok('the arrival is going on', t0.intro >= 0 && t0.intro < t0.arriveT, t0.intro);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(300);
    c.ok('… a key then doesn\'t walk them (no way to join)', !(await s(page)).off?.join, (await s(page)).off);
    await page.waitForFunction(() => window.__taohua.intro() < 0, null, { timeout: 600000, polling: 250 });
    c.ok('… it ends', true);
    c.ok('… still drawing after it', await alive(page));
    const t1 = await s(page);
    c.ok('… on the jetty\'s deck', t1.at.startsWith('@'), t1.at);
    c.ok('… no errors in the page', page.errors.length === 0, page.errors);
    await page.close();
  }

  // 2. a tap ends it at once
  {
    const page = await wood.open('seed=1&intro=2');
    await page.mouse.click(195, 600);
    await page.waitForTimeout(500);
    const t = await s(page);
    c.ok('a tap while arriving ends it', t.intro < 0, t.intro);
    c.ok('… still drawing', await alive(page));
    c.ok('… no errors in the page', page.errors.length === 0, page.errors);
    await page.close();
  }

  // 3. walking by the ways
  {
    const page = await wood.open('seed=1&at=w3:30&pace=8');
    await page.evaluate(() => window.__taohua.go('w3', 40));
    // (what it reports is a frame's: wait for a frame that's heard, then for them to arrive)
    await page.waitForFunction(() => window.__taohua.goal !== null, null, { timeout: 60000, polling: 50 });
    await page.waitForFunction(() => window.__taohua.legs === 0 && window.__taohua.goal === null, null, { timeout: 600000, polling: 250 });
    const t = await s(page);
    c.ok('told to go along the way, they get there', t.here.id === 'w3' && Math.abs(t.here.u - 40) < 0.2, t.here);
    c.ok('… no errors in the page', page.errors.length === 0, page.errors);
    await page.close();
  }

  // 5. the boat: a pole of its own length, and a stroke always ends with it out of the water
  {
    const page = await wood.open('seed=1&at=@0.5,-8.0&pace=6');
    await page.waitForTimeout(2000);
    const b = await page.evaluate(() => window.__taohua.boat());
    await page.mouse.click(b.scr[0], b.scr[1]);
    await page.waitForFunction(() => window.__taohua.boat().afloat && !window.__taohua.boat().hop, null, { timeout: 300000, polling: 200 });
    c.ok('a tap on the boat, and they\'re afloat', true);
    const tap = () => page.evaluate(() => { const a = window.__taohua.boat().afloat; window.__taohua.strokeAt(a.p[0] + 4, a.p[1] - 10); });
    /** the pole: its length, and how far the hands are from its tip */
    const pole = () => page.evaluate(() => {
      const q = window.__taohua.pole(), a = window.__taohua.boat().afloat, d = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);
      return { L: d(q[0], q[1]), hands: d(q[2], q[1]), s: a.s, sTo: a.sTo, tip: a.tip };
    });
    // (a burst of taps, more than the queue holds, the last while the pole's planted)
    await tap(); await tap(); await tap();
    const planted = await page.waitForFunction(() => { const a = window.__taohua.boat().afloat; const ph = ((a.s % 1) + 1) % 1; return a.tip && ph > 0.8 && ph < 0.95; }, null, { timeout: 300000, polling: 20 }).then(() => true, () => false);
    c.ok('… a stroke plants the pole and drives', planted, await pole());
    await tap(); await tap();
    const seen = [];
    for (let i = 0; i < 400; i++) {
      const r = await pole();
      seen.push(r);
      if (!r.tip && r.s >= r.sTo - 1e-6) break;
      await page.waitForTimeout(100);
    }
    const end = seen[seen.length - 1];
    c.ok('… the pole keeps its length', seen.every((r) => Math.abs(r.L - 3.8) < 0.01), seen.map((r) => +r.L.toFixed(2)).filter((L) => Math.abs(L - 3.8) >= 0.01).slice(0, 5));
    c.ok('… the hands stay on it', seen.every((r) => r.hands <= 3.8), Math.max(...seen.map((r) => r.hands)));
    c.ok('… the strokes come to an end, the pole out of the water', !end.tip && end.s >= end.sTo - 1e-6, end);
    c.ok('… at a release', Math.abs(((end.s % 1) + 1) % 1 - 0.25) < 1e-3, end.s);
    c.ok('… no errors in the page', page.errors.length === 0, page.errors);
    await page.close();
  }

  // 4. the same seed and place, the same hillside
  {
    const look = async () => {
      const page = await wood.open('seed=1&at=w3:40&review');
      // (the tiles come one a frame, and a headless frame can take seconds: wait till none's come for a while)
      let n = -1, same = 0;
      for (let k = 0; k < 200 && same < 3; k++) { await page.waitForTimeout(1500); const b = (await s(page)).bands; same = b === n ? same + 1 : 0; n = b; }
      const t = await s(page);
      await page.close();
      return { bands: t.bands, puffs: t.puffs, pos: t.pos.map((v) => +v.toFixed(3)) };
    };
    const a = await look(), b = await look();
    c.ok('the same seed and place make the same hillside', JSON.stringify(a) === JSON.stringify(b), { a, b });
  }
});
c.done();

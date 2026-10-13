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
 */
process.env.EXPERIMENT ??= 'taohua';
process.env.READY ??= '__taohua';
const { withWood, checks } = await import('./harness.mjs');

const c = checks();
await withWood(async (wood) => {
  const s = (page) => page.evaluate(() => ({ ...window.__taohua, intro: window.__taohua.intro(), here: window.__taohua.here(), off: window.__taohua.off() }));
  /** whether the page is still drawing: it reports itself afresh each frame */
  const alive = async (page) => {
    const was = await page.evaluateHandle(() => window.__taohua);
    await page.waitForTimeout(1500);
    return page.evaluate((w) => w !== window.__taohua, was);
  };

  // 1. a key during the arrival
  {
    const page = await wood.open('seed=1&intro=33');
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

  // 4. the same seed and place, the same hillside
  {
    const look = async () => {
      const page = await wood.open('seed=1&at=w3:40&review');
      // (the tiles come one a frame: wait for them to stop coming)
      let n = -1;
      for (let k = 0; k < 120; k++) { await page.waitForTimeout(500); const b = (await s(page)).bands; if (b === n) break; n = b; }
      const t = await s(page);
      await page.close();
      return { bands: t.bands, puffs: t.puffs, pos: t.pos.map((v) => +v.toFixed(3)) };
    };
    const a = await look(), b = await look();
    c.ok('the same seed and place make the same hillside', JSON.stringify(a) === JSON.stringify(b), { a, b });
  }
});
c.done();

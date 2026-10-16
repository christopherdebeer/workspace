/**
 * Squishy's views: the pictures its README (static/squishy.md) is written around, each made by playing the page. Made
 * with `node cells/lab/views.mjs squishy` (see views.mjs there); each is `static/squishy/v-<name>.jpg`.
 *
 * Every page is fast-forwarded (`fast=20`: twenty steps of the game a drawn frame) and drawn at full size: without a
 * graphics card a frame takes seconds, and at one step a frame nothing would have happened by the shot.
 */
export const ready = '__squishy';
/** how far the flicks' pull is drawn down the glass (px): onto the jelly ahead, on level 3 */
const PULL = 60;
const Q = (q, fast = 20) => `${q}${q ? '&' : ''}fast=${fast}&scale=1&samples=2`;

export const helpers = (page, v) => {
  const h = {
    /** the game's own state, and where the dumpling is on the glass */
    state: () => page.evaluate(() => window.__squishy),
    /** where the dumpling is on the glass (once it's in front of the camera) */
    at: async () => {
      // (and still there: the camera comes to rest after a flythrough, over a few frames)
      // (compared frame to frame: the game's state is a new object each frame drawn)
      await page.waitForFunction(() => {
        const f = window.__squishy, w = window.__views ?? (window.__views = {});
        if (f === w.frame) return false;
        const a = window.__squishyAt().at, l = w.at; w.frame = f; w.at = a;
        return !!a && !!l && Math.hypot(a[0] - l[0], a[1] - l[1]) < 2;
      }, null, { timeout: 240000, polling: 300 });
      return page.evaluate(() => window.__squishyAt());
    },
    /** past the level's opening flythrough (a touch cuts it short), the camera back on it, and the dumpling at rest */
    skip: async () => {
      await page.mouse.click(30, 420);
      await page.waitForFunction(() => window.__squishy.fly < 0, null, { timeout: 120000, polling: 200 });
      await h.settle();
    },
    settle: () => page.waitForFunction(() => window.__squishy.contacts > 0 && window.__squishy.speed < 3, null, { timeout: 180000, polling: 200 }).then(() => v.wait(800)),
    /** take hold of it and pull (down the glass, toward you: a flick ahead), shot with the finger still down */
    pull: async (dy = 110, dx = 0, at) => {
      const a = (await h.at()).at;
      await page.mouse.move(a[0], a[1] - 4); await page.mouse.down();
      for (let k = 1; k <= 10; k++) { await page.mouse.move(a[0] + (dx * k) / 10, a[1] - 4 + (dy * k) / 10); await page.waitForTimeout(40); }
      // (until the game's taken it as an aim: a frame or two, and frames are slow here)
      await page.waitForFunction(() => window.__squishy.aiming && window.__squishy.power > 0.05, null, { timeout: 120000, polling: 100 });
      await page.waitForTimeout(500);
      if (at) await at();
    },
  };
  return h;
};

export const views = [
  // ─── the title ───
  { name: 'title', group: 'The title', title: 'The title', caption: 'its name in dough over the first place; the dumpling and the jelly, to play with', query: Q(''), settle: 6000 },
  {
    name: 'title-stretch', group: 'The title', title: 'Pulled, on the title', caption: 'it stretches after the finger and springs back: where to feel how each gives', query: Q(''), settle: 6000,
    run: async (v) => {
      await v.page.waitForFunction(() => window.__squishyAt().title.length === 2, null, { timeout: 60000 });
      const s = (await v.at()).title[0];
      await v.drag(s.top, [s.top[0] + 40, s.top[1] - 90], { at: v.shot });
    },
  },

  // ─── a flick ───
  { name: 'start', group: 'A flick', title: 'At the start', caption: 'the dumpling on its cloth; the next top ahead', query: Q('level=3'), run: async (v) => { await v.skip(); } },
  { name: 'aim', group: 'A flick', title: 'Pulled back', caption: 'drawn out where it\'s held, wound up; the arc and the ring where it\'ll land', query: Q('level=3&aim=easy'), run: async (v) => { await v.skip(); await v.pull(PULL, 0, v.shot); } },
  {
    name: 'air', group: 'A flick', title: 'In the air', caption: 'its middle flies the arc it was shown', query: Q('level=3&aim=easy', 6),
    run: async (v) => { await v.skip(); await v.pull(PULL); await v.page.mouse.up(); await v.page.waitForFunction(() => window.__squishy.contacts === 0, null, { timeout: 60000, polling: 20 }); await v.shot(); },
  },
  {
    name: 'landed', group: 'A flick', title: 'Landed', caption: 'squashed wide where it came down, and righting itself', query: Q('level=3&aim=easy', 6),
    run: async (v) => { await v.skip(); await v.pull(PULL); await v.page.mouse.up(); await v.page.waitForFunction(() => window.__squishy.contacts === 0, null, { timeout: 60000, polling: 20 }); await v.page.waitForFunction(() => window.__squishy.contacts > 0, null, { timeout: 120000, polling: 20 }); await v.shot(); },
  },

  // ─── the places ───
  ...[[1, 'The Preparation Table'], [5, 'The Counter by the Window'], [9, 'The Sink'], [13, 'The Stovetop'], [17, 'The Whole Kitchen']].map(([n, t]) => ({
    name: `place-${n}`, group: 'The places', title: t, caption: `level ${n}, as it opens`, query: Q(`level=${n}`), run: async (v) => { await v.skip(); },
  })),

  // ─── the benches ───
  ...[['jelly', 'Three jellies'], ['coats', 'Coatings'], ['look', 'A still life'], ['breakfast', 'The Breakfast Counter']].map(([b, t]) => ({
    name: `bench-${b}`, group: 'Benches', title: t, caption: `?bench=${b}`, query: Q(`bench=${b}`), run: async (v) => { await v.settle(); },
  })),
];

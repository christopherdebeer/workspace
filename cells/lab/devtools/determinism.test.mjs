/**
 * ONE SEED, ONE WOOD — the same address shows the same wood, page after page.
 *
 *   node cells/lab/devtools/determinism.test.mjs [query]
 *
 * Two fresh pages (one after the other) at the same seed, place, hour and clock; each settled
 * and photographed (with the clock frozen, so wind, mist and grain hold still); compared in the
 * browser, full size and blurred (10× smaller).
 */
import { withWood, checks } from './harness.mjs';

// (frozen: the clock stands at `time`, so wind, mist and grain are the same in both)
const query = process.argv[2] ?? 'seed=moss-ford-7&fixed&freeze&hour=11&x=120&y=-40&heading=90&time=5';
const c = checks();
await withWood(async (wood) => {
  const shots = [];
  for (const name of ['determinism-a', 'determinism-b']) {
    const page = await wood.open(query);
    c.ok(`${name} settles`, await wood.settle(page));
    shots.push(await wood.shot(page, name));
    await page.close();
  }
  // compare in a page: both images drawn small, mean absolute difference per channel (0 … 255)
  const page = await wood.browser.newPage();
  const { readFileSync } = await import('node:fs');
  const [a, b] = shots.map((p) => `data:image/png;base64,${readFileSync(p).toString('base64')}`);
  const diff = await page.evaluate(
    async ([a, b]) => {
      const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const measure = (scale) => {
        const w = Math.round(ia.width / scale), h = Math.round(ia.height / scale);
        const px = (img) => { const cv = new OffscreenCanvas(w, h); const g = cv.getContext('2d'); g.drawImage(img, 0, 0, w, h); return g.getImageData(0, 0, w, h).data; };
        const da = px(ia), db = px(ib);
        let s = 0;
        for (let i = 0; i < da.length; i += 4) s += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
        return s / ((da.length / 4) * 3);
      };
      return { full: measure(1), blurred: measure(10) };
    },
    [a, b],
  );
  console.log('mean difference', diff);
  c.ok('the same address shows the same wood (difference < 0.5/255)', diff.full < 0.5 && diff.blurred < 0.5, diff);
});
c.done();

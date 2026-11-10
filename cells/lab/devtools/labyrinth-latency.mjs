// How long a touch takes to show in Labyrinth (node cells/lab/devtools/labyrinth-latency.mjs [story] [noworkers]): a
// story opened, the ground tapped beside what's built a few times, and for each tap, how long until something's drawn
// for it (the provisional stone, or the mesh), until the mesh with it is drawn, and the longest frame in between (the
// page's thread held up). Software GL and a desktop CPU: the numbers are for comparing, not for a phone.
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'labyrinth'; process.env.READY = '__labyrinth';
const story = process.argv[2] ?? '22', flags = process.argv.slice(3).join('&');
await withWood(async (wood) => {
  const page = await wood.open(`story=${story}&instant=0${flags ? '&' + flags : ''}`);
  page.on('pageerror', (e) => console.log('page error', e.message));
  await page.waitForFunction(() => window.__labyrinth?.meshState && window.__labyrinth.meshState().built > 0 && !window.__labyrinth.meshState().out, null, { timeout: 120000 });
  await page.evaluate(() => window.__labyrinth.setBrush('auto'));
  await page.waitForTimeout(1500);
  const rows = [];
  for (let n = 0; n < 4; n++) {
    // (a bare ground cell near the middle of what's built, on the screen)
    const at = await page.evaluate((n) => {
      const L = window.__labyrinth, w = L.world, e = w.extent();
      const ci = Math.round((e.i0 + e.i1) / 2), cj = Math.round((e.j0 + e.j1) / 2);
      for (let r = 2 + n; r < 14; r++) for (let a = -r; a <= r; a++) for (const [i, j] of [[ci + a, cj - r], [ci + a, cj + r], [ci - r, cj + a], [ci + r, cj + a]]) {
        const g = w.ground(i, j);
        if (w.occupied(g, i, j) || w.occupied(g + 1, i, j) || w.pool(i, j) || w.occupied(g, i + 1, j) || w.occupied(g, i, j + 1)) continue;
        const [x, y] = L.screenOf(i, j, g);
        if (x > 30 && x < innerWidth - 30 && y > 90 && y < innerHeight - 110) return { i, j, x, y, stone: w.mass.size };
      }
      return null;
    }, n);
    if (!at) { console.log('no cell to tap'); break; }
    const [t0, v0] = await page.evaluate(() => [performance.now(), window.__labyrinth.world.version]);
    await page.mouse.click(at.x, at.y);
    const r = await page.evaluate(async ({ t0, v0, stone }) => {
      const L = window.__labyrinth;
      let shown = null, meshed = null;
      while (performance.now() - t0 < 20000) {
        await new Promise((ok) => requestAnimationFrame(ok));
        const s = L.meshState(), t = performance.now() - t0;
        if (L.world.version === v0) continue;
        if (shown === null && (s.provisional > 0 || (!s.out && s.shownVersion === L.world.version))) shown = t;
        if (!s.out && s.shownVersion === L.world.version && s.provisional === 0) { meshed = t; break; }
        if (!s.out && s.shownVersion === L.world.version && s.worker) { meshed = t; break; }
      }
      // (the frames since the tap)
      let frames = 0; { const f0 = window.__f0 ?? 0; frames = 60; }
      return { shown, meshed, build: L.meshState().last, raised: L.world.mass.size - stone, frameMax: L.frameMax(Math.max(2, Math.round((performance.now() - t0) / 16))) };
    }, { t0, v0, stone: at.stone });
    rows.push(r);
    console.log(`tap ${n + 1} at ${at.i},${at.j}: +${r.raised} stone · shown ${r.shown?.toFixed(0)} ms · meshed ${r.meshed?.toFixed(0)} ms (build ${r.build.toFixed(0)}) · longest frame ${r.frameMax.interval.toFixed(0)} ms, its thread busy ${r.frameMax.busy.toFixed(0)} ms`);
    await page.waitForTimeout(800);
  }
  const rep = await page.evaluate(() => window.__labyrinth.perf());
  const top = Object.entries(rep.spans).sort((a, b) => b[1].total - a[1].total).slice(0, 14);
  console.log('frames', rep.frames, 'interval', JSON.stringify(rep.interval), 'cpu', JSON.stringify(rep.cpu));
  for (const [k, v] of top) console.log('  ', k.padEnd(34), 'total', v.total, 'max', v.max, 'frames', v.framesWith);
  await wood.shot(page, `latency-${story}`);
  await page.close();
}, { width: Number(process.env.W ?? 390), height: Number(process.env.H ?? 844) });

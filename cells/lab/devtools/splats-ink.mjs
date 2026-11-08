// A captured scene drawn in ink (node cells/lab/devtools/splats-ink.mjs [plush|nike|train|garden]): as captured, then in
// ink at full detail and spare, from three sides (devtools/out/ink-<scene>.png).
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const name = process.argv[2] ?? 'plush';
await withWood(async (wood) => {
  const sh = [], lb = [];
  for (const ink of [false, true]) {
    const page = await wood.open(`scene=${name}&res=1&clean${ink ? '&ink' : ''}`);
    page.on('pageerror', (e) => console.log('page error', e.message));
    await page.waitForFunction(() => window.__splats.drawn > 0, null, { timeout: 300000 });
    if (ink) console.log(JSON.stringify(await page.evaluate(() => window.__splats.ink.stats)));
    const S = (f, ...a) => page.evaluate(([f, a]) => window.__splats.stone[f](...a), [f, a]);
    for (const [yaw, nm] of [[0.6, 'front'], [2.2, 'side'], [3.8, 'back']]) {
      for (const d of ink ? [1, 0.35] : [1]) {
        await S('at', yaw, 0.3); await S('setDetail', d); await page.waitForTimeout(2500);
        sh.push(await wood.shot(page, `ink-${name}-${ink ? 'ink' : 'cap'}-${nm}-${d}`)); lb.push(`${ink ? `ink · detail ${d}` : 'as captured'} · ${nm}`);
      }
    }
    await page.close();
  }
  await wood.montage(sh, `ink-${name}`, { height: 360, labels: lb, columns: 3 });
}, { width: 520, height: 520 });

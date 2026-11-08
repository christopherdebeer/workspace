// The on-device measurement, run headless to check it works (node cells/lab/devtools/splats-perf.mjs [composed|mist]):
// the page opened with &perf, its table printed. Headless Chrome renders in software, so these numbers say nothing about
// a phone; open ?scene=composed&perf (or ?scene=mist&perf) on the phone for those.
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const sc = process.argv[2] ?? 'composed';
await withWood(async (wood) => {
  const page = await wood.open(`scene=${sc}&res=1&perf`);
  await page.waitForFunction(() => window.__perf, null, { timeout: 400000, polling: 1000 });
  console.log(await page.evaluate(() => window.__perf));
  await wood.shot(page, `perf-${sc}`);
}, { width: 390, height: 720 });

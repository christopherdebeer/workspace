// Piste's look, beside the targets (node cells/lab/devtools/piste-look.mjs [query …]): renders each query at phone
// size (390×844, dpr 2) and puts them in a montage with the art-direction studies, to compare at the size a person
// sees them. Writes devtools/out/look-*.png and devtools/out/look-montage.png.
process.env.EXPERIMENT = 'piste'; process.env.READY = '__piste';
import { existsSync } from 'node:fs';
const { withWood } = await import('./harness.mjs');
const TARGETS = '/root/.claude/uploads/d7be4694-5f20-5a44-a137-1af6948e984d/';
const queries = process.argv.slice(2).length ? process.argv.slice(2) : ['t=0.5&still', 'study&t=4.5&still', 'auto&t=2.6&still', 'auto&view=side&t=12.27&still'];
await withWood(async (lab) => {
  const shots = [], labels = [];
  for (const q of queries) {
    const page = await lab.open(q, { width: 390, height: 844, dpr: Number(process.env.DPR ?? 1) });
    await page.waitForTimeout(1500);
    const t0 = Date.now(); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); const ms = Date.now() - t0;
    shots.push(await lab.shot(page, 'look-' + q.replace(/[^a-z0-9]+/gi, '_').slice(0, 40))); labels.push(q);
    console.log(q, page.errors.length ? page.errors : 'clean', `(two frames ${ms} ms, software GL)`);
    await page.close();
  }
  const refs = ['43cfcafd-image.png', '5f9af2ef-image.png', '61b102a6-image.png'].map((f) => TARGETS + f).filter(existsSync);
  console.log(await lab.montage([...shots, ...refs], 'look-montage', { height: 700, labels: [...labels, 'target: daylight club', 'target: painted', 'target: distance'] }));
});

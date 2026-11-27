// Piste's look against the targets it's aiming at (node cells/lab/devtools/piste-baseline.mjs [query …]): the reference
// pictures (devtools/refs/piste: a fencer seen from inside the other's mask, down the piste of a daylit hall) beside the
// game framed the same way: the study's quiet seconds, a step closer, the opponent extending. A baseline to judge kit,
// fabric and tailoring changes by, before and after. Writes devtools/out/piste-baseline.png.
process.env.EXPERIMENT = 'piste'; process.env.READY = '__piste';
import { readdirSync } from 'node:fs';
const { withWood } = await import('./harness.mjs');
const refs = new URL('./refs/piste/', import.meta.url).pathname;
const targets = readdirSync(refs).filter((f) => /^target-\d+\.jpg$/.test(f)).sort().map((f) => refs + f);
const queries = process.argv.slice(2).length ? process.argv.slice(2) : ['study=near&t=0.8&still', 'study=near&t=2.6&still', 'study=near&t=2.6&still&body=bare', 'study&t=0.8&still'];
await withWood(async (lab) => {
  const shots = [];
  for (const q of queries) {
    const page = await lab.open(q);
    await page.waitForTimeout(1500);
    shots.push(await lab.shot(page, 'piste-baseline-' + q.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)));
    await page.close();
  }
  console.log(await lab.montage([...targets, ...shots], 'piste-baseline', { height: 640, labels: [...targets.map((_, i) => `target ${i + 1}`), ...queries] }));
});

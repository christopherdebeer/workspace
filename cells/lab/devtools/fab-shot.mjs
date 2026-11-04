/**
 * Fab in the browser: one of each kind of garment, sewn and settled on the figure; the pattern sheet; the rails.
 *
 *   node cells/lab/devtools/fab-shot.mjs           screenshots to devtools/out/, and a montage (fab-all.png)
 *   node cells/lab/devtools/fab-shot.mjs dress     only those whose name has "dress" in it
 */
import { withWood, checks } from './harness.mjs';
process.env.EXPERIMENT = 'fab';
process.env.READY = '__fab';

const only = process.argv[2];
const SHOTS = [
  ['fab-skirt', 'fam=skirt&settle=200'],
  ['fab-skirt-tiers', 'fam=skirt&cut=gather&full=1.8&len=44&tiers=3&fabric=lawn&print=4&settle=240'],
  ['fab-top', 'fam=top&fabric=jersey&print=1&colour=1&settle=200'],
  ['fab-blouse', 'fam=top&sleeve=puff&collar=peterpan&print=3&colour=0&settle=200'],
  ['fab-tunic', 'fam=top&slen=30&neck=boat&collar=band&blen=20&fabric=flannel&colour=4&settle=200'],
  ['fab-dress', 'fam=dress&cut=gather&full=2.4&sleeve=puff&collar=peterpan&print=2&colour=0&settle=240'],
  ['fab-dress-tiers', 'fam=dress&cut=gather&full=2&tiers=3&sleeve=bell&slen=12&neck=v&len=50&fabric=chiffon&print=4&colour=3&settle=240'],
  ['fab-trousers', 'fam=trousers&fabric=linen&print=2&colour=4&settle=200'],
  ['fab-shorts', 'fam=trousers&llen=5&lwidth=1.5&fabric=jersey&print=1&colour=1&settle=200'],
  ['fab-jumpsuit', 'fam=jumpsuit&llen=30&slen=8&neck=v&collar=band&fabric=jersey&print=1&colour=4&settle=240'],
  ['fab-sheet', 'fam=dress&sleeve=puff&collar=peterpan&sheet&settle=10'],
  ['fab-rails', 'rails&warm'],
];
const c = checks();
await withWood(async (lab) => {
  const paths = [], labels = [];
  for (const [name, q] of SHOTS) {
    if (only && !name.includes(only)) continue;
    const page = await lab.open(q);
    await page.waitForTimeout(q.includes('rails') ? 6000 : 1500);
    const s = await page.evaluate(() => window.__fab.probe());
    const p = await lab.shot(page, name);
    paths.push(p); labels.push(name.replace('fab-', ''));
    console.log(name, JSON.stringify({ what: s.what, particles: s.particles, stepMs: s.stepMs, seams: s.seams && +s.seams.max.toFixed(2), bad: s.checks.filter((x) => x.startsWith('BAD')) }));
    c.ok(`${name}: no errors`, page.errors.length === 0, page.errors);
    if (!q.includes('rails') && !q.includes('sheet')) c.ok(`${name}: sewn up`, s.seams && s.seams.max < 2.5, s.seams);
    await page.close();
  }
  console.log(await lab.montage(paths, 'fab-all', { height: 520, labels }));
});
c.done?.();

// The composed scene against its reference drawings (node cells/lab/devtools/splats-targets.mjs [wash|dry]).
// devtools/splats/targets/composed-{sparse,intermediate,resolved}.png are three studies of a stone, a culm across it,
// two culms behind and an architectural corner, made as artistic targets (generated, so their geometry is close to
// the scene's but not the same: they're judged by eye for what survives together at each state, not compared pixel by
// pixel). Each state beside them, from the camera nearest their composition (?cam=ref), drawn by the scene's own ranks
// and by the hand-written rules at the same number of marks. Writes devtools/out/targets-<look>.png.
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const look = process.argv[2] ?? 'wash';
await withWood(async (wood) => {
  const page = await wood.open(`scene=composed&res=1&clean&look=${look}&cam=ref`);
  await page.waitForFunction(() => window.__splats.scene?.name === 'composed' && window.__splats.drawn > 0, null, { timeout: 120000 });
  const S = (f, ...a) => page.evaluate(([f, a]) => window.__splats.stone[f](...a), [f, a]);
  const C = (f, ...a) => page.evaluate(([f, a]) => window.__splats.composed[f](...a), [f, a]);
  const sh = [], lb = [];
  for (const [nm, d] of [['sparse', 0.25], ['intermediate', 0.55], ['resolved', 1]]) {
    sh.push(new URL(`./splats/targets/composed-${nm}.png`, import.meta.url).pathname); lb.push(`target · ${nm}`);
    for (const m of ['ranks', 'rules']) {
      await C('setPolicy', m); await S('setDetail', d); await C('camRef');
      await page.waitForTimeout(1800);
      sh.push(await wood.shot(page, `targets-${look}-${nm}-${m}`)); lb.push(`${m} · ${nm}`);
    }
  }
  await wood.montage(sh, `targets-${look}`, { height: 340, labels: lb, columns: 3 });
}, { width: 768, height: 512 });

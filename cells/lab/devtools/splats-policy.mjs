// The drawing policy's board (node cells/lab/devtools/splats-policy.mjs [wash|dry]): the composed scene at the sparse
// state from six views, each drawn by the ranks (the scene's own) and by the hand-written rules, at the same number of
// marks (devtools/out/policy-<look>.png); and the judging page, one pair made and one choice recorded
// (devtools/out/policy-judge.png).
import { withWood } from './harness.mjs';
process.env.EXPERIMENT = 'splats'; process.env.READY = '__splats';
const look = process.argv[2] ?? 'wash';
await withWood(async (wood) => {
  let page = await wood.open(`scene=composed&res=1&clean&look=${look}&detail=0.25`);
  await page.waitForFunction(() => window.__splats.scene?.name === 'composed' && window.__splats.drawn > 0, null, { timeout: 120000 });
  const S = (f, ...a) => page.evaluate(([f, a]) => window.__splats.stone[f](...a), [f, a]);
  const C = (f, ...a) => page.evaluate(([f, a]) => window.__splats.composed[f](...a), [f, a]);
  const shot = async (name) => { await page.waitForTimeout(1600); return wood.shot(page, name); };
  await S('frame', null); await S('setDetail', 0.25);
  const sh = [], lb = [];
  for (const yaw of [0.6, 1.4, 2.4, 3.7, 4.8, 5.7]) for (const m of ['ranks', 'rules']) {
    await C('setPolicy', m); await S('at', yaw, 0.3);
    sh.push(await shot(`policy-${look}-${m}-${yaw}`));
    const p = await page.evaluate(() => window.__splats.composed.policy); lb.push(`${m} · ${Math.round((yaw - 0.6) * 57.3)}° · ${m === 'ranks' ? 'own ranks' : p.note.split('· ')[1]}`);
  }
  await wood.montage(sh, `policy-${look}`, { height: 330, labels: lb, columns: 6 });
  // ─── judging ───
  await page.close();
  page = await wood.open(`scene=composed&res=1&clean&look=${look}&judge`);
  await page.waitForFunction(() => window.__splats.composed?.judge?.stage === 'shown', null, { timeout: 120000 });
  const pair = await page.evaluate(() => { const p = window.__splats.composed.judge.pair; return { A: p.A.kind, B: p.B.kind, groups: p.F.length, budget: p.budget }; });
  const j = await wood.shot(page, 'policy-judge');
  await page.click('#j-a'); await page.waitForFunction(() => window.__splats.composed.judge.count >= 1, null, { timeout: 30000 });
  console.log('judge pair', pair, 'recorded', await page.evaluate(() => window.__splats.composed.judge.count));
  await wood.montage([j], 'policy-judge', { height: 520, labels: [`judging: ${pair.A} vs ${pair.B} (unlabelled on the page)`], columns: 1 });
  if (page.errors?.length) console.log('errors', page.errors);
}, { width: 390, height: 520 });

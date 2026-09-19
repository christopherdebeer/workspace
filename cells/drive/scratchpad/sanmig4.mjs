// WHAT THE CARVE IS MEASURING FROM. channelFloorAt clamps t to the segment and
// then takes the offset from the segment's INFINITE LINE, so a watercourse
// carves straight on past its own end. This replays the kernel's own loop beside
// a distance-to-the-SEGMENT rule and reports the difference as metres of trench.
import { openDrive } from '../devtools/harness.mjs';
import { writeFileSync } from 'node:fs';
const d = await openDrive({
  spot: 'lat=37.86119&lon=-107.87094&h=321&cam=chase&tdbg=0&wxlive=0&time=NOON',
  tag: 'sanmig4', settle: 0, bootTimeout: 300000,
  src: '/home/user/workspace/cells/drive/client/__xsec-rev.ts',
});
const q = (f, ...a) => d.page.evaluate(f, ...a);
await d.page.waitForTimeout(240000);

const out = await q(() => {
  const posts = [];
  for (let z = -300; z <= 300; z += 10) for (let x = -300; x <= 300; x += 10) {
    const w = window.__chanwhy(x, z);
    if (w.chanFloorAbs === null && w.segRuleAbs === null) continue;
    posts.push({ x, z, w, cov: (window.__layers(x, z).cov ?? null) });
  }
  const carved = posts.filter((p) => p.w.chanFloorAbs !== null);
  const reach = carved.filter((p) => p.w.winner && !p.w.winner.segRuleTakes);
  // six of the worst reaches, spread out
  const picks = [];
  for (const p of reach.slice().sort((a, b) => (a.w.chanFloorAbs - a.w.natAbs) - (b.w.chanFloorAbs - b.w.natAbs))) {
    if (picks.every((k) => Math.hypot(k.x - p.x, k.z - p.z) > 70)) picks.push(p);
    if (picks.length >= 6) break;
  }
  // a cross-section through the drawn river, perpendicular to the channel
  const wet = posts.filter((p) => p.cov !== null && p.cov >= 0.5);
  const seed = wet[Math.floor(wet.length / 2)] ?? carved[0];
  const sec = [];
  if (seed) for (let t = -80; t <= 80; t += 4) {
    const bx = seed.x + t * Math.cos(Math.PI / 3), bz = seed.z + t * Math.sin(Math.PI / 3);
    const w = window.__chanwhy(bx, bz);
    sec.push({ t, nat: w.natAbs, mesh: w.meshAbs, kernel: w.chanFloorAbs, seg: w.segRuleAbs,
      takes: w.kernelTakes, segTakes: w.segRuleTakes, reaching: w.reachingPastEnd });
  }
  return {
    nPosts: posts.length, nCarved: carved.length, nWet: wet.length,
    nWinnerReaching: reach.length,
    replayAgrees: carved.filter((p) => Math.abs(p.w.replayAbs - p.w.chanFloorAbs) < 0.01).length,
    kernelDepth: carved.map((p) => +(p.w.natAbs - p.w.chanFloorAbs).toFixed(2)),
    segDepth: carved.filter((p) => p.w.segRuleAbs !== null).map((p) => +(p.w.natAbs - p.w.segRuleAbs).toFixed(2)),
    onlyKernel: carved.filter((p) => p.w.segRuleAbs === null).length,
    beyond: carved.map((p) => (p.w.worstReach ? p.w.worstReach.beyond : 0)),
    picks: picks.map((p) => p.w), sec, seed: seed ? [seed.x, seed.z] : null,
    errors: (window.__errs ?? []),
  };
});
writeFileSync(new URL('./sanmig4.json', import.meta.url), JSON.stringify(out));
const stat = (a, label) => { a = a.filter(Number.isFinite).sort((x, y) => x - y);
  const qq = (p) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
  console.log(label.padEnd(40), `n=${a.length} min=${a[0]} p10=${qq(.1)} med=${qq(.5)} p90=${qq(.9)} max=${a[a.length-1]}`); };
console.log('posts', out.nPosts, '· carved', out.nCarved, '· drawn-wet', out.nWet);
console.log('REPLAY AGREES WITH channelFloorAt on', out.replayAgrees, 'of', out.nCarved);
console.log('posts whose WINNER reaches past its segment end:', out.nWinnerReaching,
  `(${(100 * out.nWinnerReaching / Math.max(1, out.nCarved)).toFixed(0)}%)`);
console.log('posts carved ONLY by the line rule (no segment within reach):', out.onlyKernel);
stat(out.kernelDepth, 'trench depth, THE SHIPPED LINE RULE');
stat(out.segDepth, 'trench depth, distance to the SEGMENT');
stat(out.beyond, 'metres past a segment end, worst per post');
for (const w of out.picks) {
  console.log('\n=== at', JSON.stringify(w.at), '· nat', w.natAbs, '· mesh', w.meshAbs,
    '· kernel', w.chanFloorAbs, '· segment rule', w.segRuleAbs);
  console.log('   in 3x3', w.inNeighbourhood, '· kernel takes', w.kernelTakes,
    '· segment rule takes', w.segRuleTakes, '· reaching past an end', w.reachingPastEnd);
  console.log('   WINNER  ', JSON.stringify(w.winner));
  console.log('   seg-rule', JSON.stringify(w.winnerSegRule));
}
console.log('\nSECTION through', JSON.stringify(out.seed));
console.log('   t     nat     mesh   kernel   segRule  takes/segTakes/reaching');
for (const r of out.sec) console.log(String(r.t).padStart(5),
  String(r.nat).padStart(8), String(r.mesh).padStart(8), String(r.kernel).padStart(8),
  String(r.seg).padStart(9), `   ${r.takes}/${r.segTakes}/${r.reaching}`);
console.log('\nerrors', JSON.stringify(out.errors));
await d.close();

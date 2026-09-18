// WHY THE CARVE SITS BELOW THE INVERT THE WATER STANDS ON. Reports the INPUTS
// to channelFloorAt's own minimum at the wet posts, never a copy of its rule.
import { openDrive } from '../devtools/harness.mjs';
import { writeFileSync } from 'node:fs';
const d = await openDrive({
  spot: 'lat=37.86119&lon=-107.87094&h=321&cam=chase&tdbg=0&wxlive=0&time=NOON',
  tag: 'sanmig3', settle: 0, bootTimeout: 300000,
  src: '/home/user/workspace/cells/drive/client/__xsec-rev.ts',
});
const q = (f, ...a) => d.page.evaluate(f, ...a);
await d.page.waitForTimeout(240000);

const out = await q(() => {
  const wet = [];
  for (let z = -300; z <= 300; z += 10) for (let x = -300; x <= 300; x += 10) {
    const s = window.__layers(x, z);
    if (s.cov !== null && s.cov >= 0.5 && s.meshAbs !== null) wet.push({ x, z, s });
  }
  const picks = [];
  for (const w of wet) { if (picks.every((p) => Math.hypot(p.x - w.x, p.z - w.z) > 90)) picks.push(w); if (picks.length >= 6) break; }
  // The whole wet set, as a distribution rather than six anecdotes.
  const gap = wet.map((w) => +(w.s.lvl - w.s.meshAbs).toFixed(2));
  const overNat = wet.map((w) => +(w.s.lvl - w.s.natAbs).toFixed(2));
  const carveVsNat = wet.map((w) => +(w.s.natAbs - w.s.meshAbs).toFixed(2));
  const meshIsCarve = wet.filter((w) => w.s.chanFloorAbs !== null)
    .map((w) => +(w.s.meshAbs - w.s.chanFloorAbs).toFixed(2));
  return { n: wet.length, gap, overNat, carveVsNat, meshIsCarve,
    why: picks.map((p) => window.__chanwhy(p.x, p.z)) };
});
writeFileSync(new URL('./sanmig3.json', import.meta.url), JSON.stringify(out));
const stat = (a, label) => { a = a.filter(Number.isFinite).sort((x, y) => x - y);
  const q2 = (p) => a[Math.min(a.length - 1, Math.floor(p * (a.length - 1)))];
  console.log(label.padEnd(34), `n=${a.length} min=${a[0]} p10=${q2(.1)} med=${q2(.5)} p90=${q2(.9)} max=${a[a.length-1]}`); };
console.log('drawn-wet posts', out.n);
stat(out.gap, 'level - RENDERED mesh');
stat(out.overNat, 'level - natural ground');
stat(out.carveVsNat, 'natural ground - mesh (the trench)');
stat(out.meshIsCarve, 'mesh - channelFloorAt (0 = the carve)');
for (const w of out.why) {
  console.log('\n=== at', JSON.stringify(w.at), '· nat', w.natAbs, '· mesh', w.meshAbs, '· chanFloor', w.chanFloorAbs);
  console.log('   segments in the 3x3:', w.inNeighbourhood, '· considered (out<=3):', w.considered,
    '· INVERT SPREAD among them:', w.invertSpread, 'm');
  console.log('   nearest by plan:', JSON.stringify(w.nearestByPlan));
  console.log('   lowest offered :', JSON.stringify(w.lowestThree));
}
console.log('\nerrors', d.errors.slice(0, 3));
await d.close();

/**
 * THE MESH-SEAM NET. The road audit's regression fixture: the seam probes
 * have existed for rounds with no fixture asserting on them, so a tranche
 * could quietly trade one seam for another. Bars sit just above the values
 * measured at re-baseline time (2026-08-29, after the probe learned the
 * difference between a node and a rounding bucket, and between a
 * continuation and a fork) — they catch regressions now and RATCHET DOWN
 * as fixes land.
 *
 * CONTINUATIONS (same width, in line, different builds) are judged on the
 * kerb step; MEETS (everything else sharing a node) on the centreline
 * disagreement. Absolute counts, not rates: the honest join populations are
 * a couple dozen, where one offender is a fifth of everything.
 *
 * Standing offenders on the Tranche C ledger, measured at re-baseline:
 *   bixby     meet 0.894 at -138,-139 (service way vs Cabrillo node)
 *   chapmans  continuation 0.178 at -51,65 (same-way fragments, weld missed)
 */
import { openDrive, report } from './harness.mjs';

const SPOTS = [
  { tag: 'bixby', spot: 'lat=36.37145&lon=-121.90158&h=340&cam=chase&time=NOON&sunalt=55&wx=clear',
    minJoins: 5, bars: { p95M: 0.15, over: 2, worstM: 0.15, meetWorstM: 1.0 } },
  { tag: 'chapmans', spot: 'lat=-34.09885&lon=18.380684&h=255&cam=chase&time=NOON&sunalt=55&wx=clear',
    minJoins: 10, bars: { p95M: 0.15, over: 2, worstM: 0.15, meetWorstM: 0.5 } },
];
let fails = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok   ' : 'FAIL '} ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) fails++;
};
for (const s of SPOTS) {
  const d = await openDrive({ spot: s.spot, tag: `seam-${s.tag}` });
  // WAIT FOR THE WORLD TO SETTLE, NOT A COUNT. The honest join counts are
  // too small for absolute floors to mean "streamed in"; what matters is
  // that the numbers stopped moving. Flat at zero is an unbuilt world, not
  // a settled one.
  let ks = { joins: 0 };
  let prev = -1, flat = 0;
  for (let w = 0; w < 48 && flat < 4; w++) {
    await d.page.waitForTimeout(5000);
    ks = await d.page.evaluate(() => window.__kerbseams(260));
    // Flatness only counts once the streamer has had real time: one run
    // plateaued at 2 joins for 15 seconds mid-stream and the early flat
    // check called that settled.
    flat = w >= 18 && ks.joins > 0 && ks.joins === prev ? flat + 1 : 0;
    prev = ks.joins;
  }
  const seatOver = await d.page.evaluate(() =>
    (window.__cropwhy ? window.__cropwhy() : []).filter?.((q) => String(q.why || '').startsWith('seat-over-budget')).length ?? -1);
  console.log(`${s.tag}:`, JSON.stringify(ks));
  console.log(`${s.tag} seat-over-budget logged:`, seatOver);
  ok(`${s.tag} population sane`, ks.joins >= s.minJoins, `joins=${ks.joins} >= ${s.minJoins}`);
  ok(`${s.tag} main p95 kerb step`, ks.mainP95M <= s.bars.p95M, `${ks.mainP95M} <= ${s.bars.p95M}`);
  ok(`${s.tag} main joins over 10cm`, ks.mainOver10cm <= s.bars.over, `${ks.mainOver10cm} <= ${s.bars.over}`);
  ok(`${s.tag} main worst step`, ks.mainWorstM <= s.bars.worstM, `${ks.mainWorstM} <= ${s.bars.worstM}`);
  ok(`${s.tag} worst meet`, ks.meetWorstM <= s.bars.meetWorstM, `${ks.meetWorstM} <= ${s.bars.meetWorstM} at ${ks.meetAt}`);
  for (const b of (ks.bad ?? []).slice(0, 6)) console.log(`  bad: ${JSON.stringify(b)}`);
  report(d.errors);
  await d.close();
}
console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);

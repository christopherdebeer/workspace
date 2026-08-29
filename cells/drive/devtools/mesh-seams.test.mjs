/**
 * THE MESH-SEAM NET. The road audit's regression fixture: the seam probes
 * have existed for rounds with no fixture asserting on them, so a tranche
 * could quietly trade one seam for another. Bars sit just above the values
 * measured at audit time (2026-08-29, road-audit.mjs) — they catch
 * regressions now and RATCHET DOWN as tranches B/C land improvements.
 *
 * THE BARS JUDGE MAIN-ROAD JOINS (either side hw >= 3). The unnamed
 * service-way web above Bixby welds nondeterministically with tile arrival
 * order — same build, different offenders per run — so a net gating on it
 * gates on the streamer's mood. The carriageways the player drives get the
 * strict bar; the all-joins picture is printed for the record, and the
 * service-way chaos is a Tranche C fix of its own.
 *
 *   bixby     mainJoins ~40  mainP95 0.0x   (all: joins 117 p95 0.034 full pop)
 *   chapmans  mainJoins ~74  mainP95 0
 */
import { openDrive, report } from './harness.mjs';

// RATIOS, NOT COUNTS. The join population varies run to run with the tile
// streamer's mood, and a half-streamed neighbourhood carries genuinely
// worse transient joins (cross-tile crops still pending) — one run read
// p95 0.242 over a partial population and 0.034 over the full one, same
// build. So each spot waits for its population floor and is judged on the
// over-10cm RATE.
// Floors re-baselined 2026-08-29 after the probe learned the difference
// between a node and a rounding bucket: pair counts fell to the genuine
// continuation joins (the Bixby service-loop fictions are gone), so the old
// floors would poll forever.
const SPOTS = [
  { tag: 'bixby', spot: 'lat=36.37145&lon=-121.90158&h=340&cam=chase&time=NOON&sunalt=55&wx=clear',
    minJoins: 40, bars: { p95M: 0.15, overRate: 0.08, worstM: 0.4 } },
  { tag: 'chapmans', spot: 'lat=-34.09885&lon=18.380684&h=255&cam=chase&time=NOON&sunalt=55&wx=clear',
    minJoins: 30, bars: { p95M: 0.15, overRate: 0.08, worstM: 0.35 } },
];
let fails = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'ok   ' : 'FAIL '} ${name}${detail ? '  (' + detail + ')' : ''}`);
  if (!cond) fails++;
};
for (const s of SPOTS) {
  const d = await openDrive({ spot: s.spot, tag: `seam-${s.tag}` });
  // WAIT FOR THE DATA, NOT THE CLOCK. The upstream rate-limits tiles at
  // whim; a fixed settle read joins=0 at a spot that measures 116 when the
  // roads have actually landed. Poll until the neighbourhood is populated.
  let ks = { joins: 0 };
  for (let w = 0; w < 30 && ks.joins < s.minJoins; w++) {
    await d.page.waitForTimeout(5000);
    ks = await d.page.evaluate(() => window.__kerbseams(260));
  }
  const sh = await d.page.evaluate(() => window.__shells ? window.__shells('ribbon') : null);
  const seatOver = await d.page.evaluate(() =>
    (window.__cropwhy ? window.__cropwhy() : []).filter?.((q) => String(q.why || '').startsWith('seat-over-budget')).length ?? -1);
  console.log(`${s.tag}:`, JSON.stringify(ks));
  console.log(`${s.tag} shells:`, JSON.stringify(sh)?.slice(0, 300));
  console.log(`${s.tag} seat-over-budget logged:`, seatOver);
  ok(`${s.tag} population settled`, ks.joins >= s.minJoins, `joins=${ks.joins} >= ${s.minJoins}`);
  ok(`${s.tag} main p95 kerb step`, ks.mainP95M <= s.bars.p95M, `${ks.mainP95M} <= ${s.bars.p95M}`);
  const rate = ks.mainJoins ? ks.mainOver10cm / ks.mainJoins : 0;
  ok(`${s.tag} main over-10cm rate`, rate <= s.bars.overRate, `${(rate * 100).toFixed(1)}% <= ${s.bars.overRate * 100}%`);
  ok(`${s.tag} main worst step`, ks.mainWorstM <= s.bars.worstM, `${ks.mainWorstM} <= ${s.bars.worstM}`);
  for (const b of (ks.bad ?? []).slice(0, 6)) console.log(`  bad: ${JSON.stringify(b)}`);
  report(d.errors);
  await d.close();
}
console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);

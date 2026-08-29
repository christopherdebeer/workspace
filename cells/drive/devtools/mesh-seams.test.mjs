/**
 * THE MESH-SEAM NET. The road audit's regression fixture: the seam probes
 * have existed for rounds with no fixture asserting on them, so a tranche
 * could quietly trade one seam for another. Bars sit just above the values
 * measured at audit time (2026-08-29, road-audit.mjs) — they catch
 * regressions now and RATCHET DOWN as tranches B/C land improvements.
 *
 *   bixby     joins 116  p95 0.199  over10cm 13  worst 0.505
 *   chapmans  joins 321  p95 0.152  over10cm 30  worst 0.271
 */
import { openDrive, report } from './harness.mjs';

const SPOTS = [
  { tag: 'bixby', spot: 'lat=36.37145&lon=-121.90158&h=340&cam=chase&time=NOON&sunalt=55&wx=clear',
    bars: { p95M: 0.22, over10cm: 15, worstM: 0.6 } },
  { tag: 'chapmans', spot: 'lat=-34.09885&lon=18.380684&h=255&cam=chase&time=NOON&sunalt=55&wx=clear',
    bars: { p95M: 0.18, over10cm: 33, worstM: 0.35 } },
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
  for (let w = 0; w < 24 && ks.joins < 50; w++) {
    await d.page.waitForTimeout(5000);
    ks = await d.page.evaluate(() => window.__kerbseams(260));
  }
  const sh = await d.page.evaluate(() => window.__shells ? window.__shells('ribbon') : null);
  const seatOver = await d.page.evaluate(() =>
    (window.__cropwhy ? window.__cropwhy() : []).filter?.((q) => String(q.why || '').startsWith('seat-over-budget')).length ?? -1);
  console.log(`${s.tag}:`, JSON.stringify(ks));
  console.log(`${s.tag} shells:`, JSON.stringify(sh)?.slice(0, 300));
  console.log(`${s.tag} seat-over-budget logged:`, seatOver);
  ok(`${s.tag} joins found`, ks.joins > 50, `joins=${ks.joins}`);
  ok(`${s.tag} p95 kerb step`, ks.p95M <= s.bars.p95M, `${ks.p95M} <= ${s.bars.p95M}`);
  ok(`${s.tag} steps over 10cm`, ks.over10cm <= s.bars.over10cm, `${ks.over10cm} <= ${s.bars.over10cm}`);
  ok(`${s.tag} worst step`, ks.worstM <= s.bars.worstM, `${ks.worstM} <= ${s.bars.worstM}`);
  report(d.errors);
  await d.close();
}
console.log(fails ? `\n${fails} FAILED` : '\nall good');
process.exit(fails ? 1 : 0);

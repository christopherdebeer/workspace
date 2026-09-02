/**
 * A JUNCTION PIN SURVIVES THE PER-WAY BUILD.
 *
 *   node cells/drive/devtools/through-node.test.mjs        (~6min)
 *
 * The chain planner reconciles junctions: where two roads share a node it pins
 * the later chain to the earlier one's deck. Measured at Camps Bay with
 * __hintsAt, the planner was RIGHT at every one of the eight worst node steps —
 * 0.404 and 0.404 at a node whose two built decks were 1.81 and -0.373 — and
 * __stagewhy then found the per-way GRADE LINE (a ±200m running mean that
 * overwrites every interior station) erasing the pin on both roads. 262
 * through-node stations, 179 lost their hint by over 10cm, 128 of them to that
 * one stage.
 *
 * This holds the bars at the numbers measured BEFORE the fix, so it fails if
 * the regression ever comes back, and it ratchets down as the fix proves out.
 * Two worlds: the authored `junctions` crossroads, which are flat and fast, and
 * the Camps Bay capture, which is where the metre-high steps were found.
 *
 * WAITS FOR THE ROADS, NOT THE CARVE. `dirty === 0` says the terrain queue has
 * drained; roadCells kept climbing for ninety seconds after that on this
 * fixture, and every number read before it stopped was a number about an
 * eighth of a world.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const errors = [];

async function settle(d, q) {
  let quiet = 0, pw = -1, pc = -1;
  for (let i = 0; i < 130; i++) {
    await d.page.waitForTimeout(3000);
    const t = await q(() => window.__tstats());
    quiet = (t.dirty === 0 && t.seenWays === pw && t.roadCells === pc) ? quiet + 1 : 0;
    pw = t.seenWays; pc = t.roadCells;
    if (quiet >= 6) return (i + 1) * 3;
  }
  return null;
}
const stagewhy = () => {
  const ORDER = ['1-branch', '2-ruled', '2b-gradeline', '2c-devclamp', '3-seated', '4-smoothed', '5-reruled', '6-welded'];
  const log = window.__stagewhy(0, 0, 1e9); const h = {}; let total = 0, moved = 0, maxDev = 0;
  for (const r of log) {
    if (r.hint === null) continue; total++; let first = null;
    for (const k of ORDER) { if (r.st[k] === undefined) continue; if (Math.abs(r.st[k] - r.hint) > 0.1) { first = k; break; } }
    if (first) { moved++; h[first] = (h[first] ?? 0) + 1; }
    const fin = r.st['6-welded'] ?? r.st['5-reruled']; if (fin !== undefined) maxDev = Math.max(maxDev, Math.abs(fin - r.hint));
  }
  return { stations: total, lost: moved, by: h, worst: +maxDev.toFixed(2) };
};

// Bars are the PRE-FIX measurements (2026-09-02). Lower them as fixes land;
// never raise them.
const WORLDS = [
  // junctions, measured after the fix on 2026-09-02: over10cm 0, over30cm 0,
  // worst 0.05, 44 pinned stations and none lost. The bars sit one notch up.
  { id: 'junctions', bars: { over10cm: 1, over30cm: 0, worstM: 0.1, lostFrac: 0.05 } },
  { id: 'at-campsbay', bars: { over10cm: 32, over30cm: 5, worstM: 2.18, lostFrac: 179 / 262 } },
];
for (const w of WORLDS) {
  const d = await openDrive({
    spot: `fixture=${w.id}&cam=chase&time=NOON&cprobe=1`,
    tag: `through-${w.id}`, settle: 9000, bootTimeout: 150000,
  });
  const q = async (fn, ...a) => d.page.evaluate(fn, ...a);
  const at = await settle(d, q);
  const seams = await q(() => window.__seams(1400));
  const st = await q(stagewhy);
  const steep = await q(() => window.__steep(1400, 1));
  errors.push(...d.errors);
  await d.close();

  console.log(`\n  ${w.id}: settled ${at === null ? 'NEVER' : `t+${at}s`}  joins=${seams.joins} over10cm=${seams.over10cm} over30cm=${seams.over30cm} worst=${seams.worst[0]?.step ?? 0}m`);
  console.log(`  through-node stations ${st.stations}, lost ${st.lost} (${JSON.stringify(st.by)}), worst dev ${st.worst}m; steep over20% ${steep.over20pct}`);
  check(`${w.id}: the world settled`, at !== null, at);
  check(`${w.id}: node steps over 10cm do not exceed the bar`, seams.over10cm <= w.bars.over10cm, { over10cm: seams.over10cm, bar: w.bars.over10cm });
  check(`${w.id}: node steps over 30cm do not exceed the bar`, seams.over30cm <= w.bars.over30cm, { over30cm: seams.over30cm, bar: w.bars.over30cm });
  check(`${w.id}: the worst node step does not exceed the bar`, (seams.worst[0]?.step ?? 0) <= w.bars.worstM, { worst: seams.worst[0], bar: w.bars.worstM });
  // THE MECHANISM, not just the symptom: the share of planner-pinned stations
  // the per-way build lets go of.
  check(`${w.id}: pinned stations kept through the per-way build`,
    st.stations === 0 || st.lost / st.stations <= w.bars.lostFrac, { lost: st.lost, of: st.stations, bar: w.bars.lostFrac });
}
console.log(bad ? `\n${bad} FAILED` : '\nall good — what the planner pins, the ribbon keeps');
report(errors);
if (bad) process.exitCode = 1;

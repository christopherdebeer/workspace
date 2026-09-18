/**
 * ── DOES A TAGGED BRIDGE'S DECK STAND OVER THE WATER? ──
 *
 *   node cells/drive/devtools/bridge-water.mjs
 *   FIX=at-senqu-ford node .../bridge-water.mjs
 *
 * Probed from the seat at the uMngeni mouth in Durban: the M4 Ellis Brown
 * Viaduct and the Athlone Bridge upriver both ran ALONG THE RIVER BED. The
 * measurement that says so is one number per station — the built deck minus
 * the water resting under it — and the structural witness beside it is
 * whether `2d-chord` appears in the fragment's own stage log at all.
 *
 * WHY THE STAGE LOG IS THE WITNESS AND THE HEIGHT IS ONLY THE SYMPTOM. A
 * bridge whose deck happens to sit above the water proves nothing: a chord
 * along flat banks does that by accident. What says the bridge machinery RAN
 * is `2d-chord` in `__fragwhy`'s stages. A deck under the water with no
 * `2d-chord` is the chord never running; a deck under the water WITH one is
 * the lift deciding wrongly, which is a different fault in a different
 * module. The pair separates them, and neither alone can.
 *
 * ON A FIXTURE, because a live Durban run is ten minutes through the curl
 * relay and its answer moves with tile arrival order, while the defect is in
 * the per-way build and is deterministic once the ways are in.
 */
import { openDrive } from './harness.mjs';

const FIX = process.env.FIX ?? 'at-umgeni';
// The river's own centreline crossing on each deck, read out of the cell's
// z16 tiles before any of this ran — see the note on the capture card.
const CROSSINGS = (process.env.CROSSINGS ? JSON.parse(process.env.CROSSINGS) : [
  ['Ellis Brown Viaduct (M4)', -29.81136, 31.03829],
  ['Athlone Bridge (Kenneth Kaunda)', -29.81003, 31.03252],
]);

const d = await openDrive({
  spot: `fixture=${FIX}&cam=chase&time=NOON&wx=clear&nodraw=1`,
  tag: 'bridge-water', settle: 0, bootTimeout: 420000,
});
const q = (f, ...a) => d.page.evaluate(f, ...a);
let quiet = 0, pb = -1, pw = -1, pc = -1;
for (let i = 0; i < 100; i++) {
  await d.page.waitForTimeout(3000);
  const t = await q(() => window.__tstats());
  quiet = (t.dirty === 0 && t.builds === pb && t.seenWays === pw && t.roadCells === pc && t.roadCells > 0)
    ? quiet + 1 : 0;
  pb = t.builds; pw = t.seenWays; pc = t.roadCells;
  if (i % 6 === 0) console.log(`  t+${i * 3}s dirty ${t.dirty} builds ${t.builds} ways ${t.seenWays} cells ${t.roadCells}`);
  if (quiet >= 3) break;
}
const settled = quiet >= 3;

const rows = await q((crossings) => {
  const o = window.__origin(), R = 6378137;
  const loc = (lat, lon) => [
    (lon - o.lon) * Math.cos(o.lat * Math.PI / 180) * Math.PI / 180 * R,
    -(lat - o.lat) * Math.PI / 180 * R,
  ];
  const out = [];
  for (const [label, lat, lon] of crossings) {
    const [x, z] = loc(lat, lon);
    for (const f of window.__fragwhy(x, z, 90)) {
      // Bridge-tagged ways only: a fragment of the approach at grade is not
      // the thing under test and would dilute the minimum.
      const tags = window.__wayTags(f.wid) ?? {};
      if (!tags.bridge || tags.bridge === 'no') continue;
      let minClear = Infinity, minAt = null, wet = 0, n = 0;
      const stages = new Set();
      for (const st of f.stations) {
        for (const k of Object.keys(st.st ?? {})) stages.add(k);
        const deck = st.st?.['7-warped'] ?? st.st?.['6-welded'];
        if (deck === undefined) continue;
        const w = window.__hydrowhy(st.x, st.z);
        if (!w || w.coverage === undefined || w.coverage < 0.5) continue;
        const level = w.restingLevelM;
        if (typeof level !== 'number') continue;
        wet++; n++;
        const clear = (deck + o.baseElev) - level;
        if (clear < minClear) { minClear = clear; minAt = [+st.x.toFixed(1), +st.z.toFixed(1), +level.toFixed(2), +(deck + o.baseElev).toFixed(2)]; }
      }
      out.push({
        label, wid: f.wid, nm: f.nm ?? null, highway: tags.highway ?? tags.railway ?? '?',
        bridgeName: tags['bridge:name'] ?? null, layer: tags.layer ?? null,
        pb: f.pb, stations: f.stations.length, wetStations: wet,
        chord: stages.has('2d-chord'), lift: stages.has('2e-lift'),
        minClearM: minClear === Infinity ? null : +minClear.toFixed(2), minAt,
      });
    }
  }
  return out;
}, CROSSINGS);

console.log(`\n${FIX} · ${settled ? 'SETTLED' : 'NOT SETTLED'} · ${rows.length} bridge fragments at the crossings\n`);
let bad = 0;
for (const r of rows) {
  const drowned = r.minClearM !== null && r.minClearM < 0;
  if (drowned || !r.chord) bad++;
  console.log(`${drowned || !r.chord ? 'FAIL' : 'ok  '}  ${r.label}`);
  console.log(`        ${r.wid}  ${r.highway} layer ${r.layer} bridge:name ${JSON.stringify(r.bridgeName)}`);
  console.log(`        branch ${r.pb} · ${r.stations} stations, ${r.wetStations} over water`
    + ` · 2d-chord ${r.chord ? 'RAN' : 'NEVER RAN'} · 2e-lift ${r.lift ? 'ran' : 'absent'}`);
  console.log(`        least clearance over the water: ${r.minClearM === null ? 'no wet station' : `${r.minClearM} m`}`
    + (r.minAt ? `  at (${r.minAt[0]}, ${r.minAt[1]}) — water ${r.minAt[2]} m, deck ${r.minAt[3]} m` : ''));
}
if (!rows.length) { console.log('  no bridge fragment reached the crossings — the ways did not stream'); bad++; }
console.log(`\npage/harness errors: ${d.errors.length}`);
console.log(bad ? `\n${bad} FAILED` : '\nall good — every tagged bridge ran its chord and stands over its water');
await d.close();
process.exit(bad ? 1 : 0);

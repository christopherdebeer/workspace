/**
 * WHY A TRACK CROSSING A RIVER HAS NO FORD TREATMENT, AT A PLACE.
 *
 *   node cells/drive/devtools/ford-why.mjs        [SPOT=lat,lon] [R=]
 *
 * "No ford treatment" has at least four causes that look identical from the
 * seat, and only the terms tell them apart: the crossing registry already
 * called the place a bridge, a culvert or a causeway and the ford rule stood
 * down; the deck is genuinely above the water; nothing registered a crossing
 * at all; or the CONTACT says you are wading and the GEOMETRY was never dipped
 * to the water, so the physics fords a crossing the picture does not.
 *
 * TWO AUTHORITIES ANSWER "IS THIS WATER", AND THEY ASK DIFFERENT QUESTIONS.
 * `fordM` is the legacy rule — the drawn water's resting level against the
 * road deck — which is what `legacySurfaceAt` reads. On an ordinary URL
 * `surfaceAt` never reaches it: the substrate contact answers first, and its
 * `fluid` is the column standing above whichever layer it chose as SUPPORT.
 * So a deck twenty centimetres clear of the water is not a ford by the legacy
 * rule and IS wading by the contact's, whenever the support under that point
 * is the ground rather than the deck. This tool classifies from `__ford`'s own
 * terms rather than replaying either rule — the San Miguel lesson, where a
 * probe that replayed a rule verbatim could only ever confirm it — and prints
 * `support`, `drive`, `fluid` and `crossing` beside the verdict so the two can
 * be told apart.
 *
 * `__wetmap` at the foot is the same classifier the wet overlay paints with,
 * so what this prints and what the seat sees are one rule: D is a deck over
 * water, F a ford, W drawn water, U water under the mesh.
 */
import { openDrive } from './harness.mjs';

const SPOT = process.env.SPOT || '-34.0877,18.4185';
const [lat, lon] = SPOT.split(',').map(Number);
const R = +(process.env.R || 220);
const d = await openDrive({
  spot: `lat=${lat}&lon=${lon}&cam=chase&nodraw=1&tdbg=0&wxlive=0&time=NOON`,
  tag: 'ford-why', settle: 0, bootTimeout: 300000,
});
// The doctrine's own settle rule for roads: dirty is not enough, the way
// count and the road cells have to stop moving too.
let prev = '', still = 0;
for (let i = 0; i < 80; i++) {
  await d.page.waitForTimeout(3000);
  const s = await d.page.evaluate(() => {
    const w = window;
    const t = w.__tstats ? w.__tstats() : {};
    // `__hydro().tiles` does not exist — the first cut read it, got undefined,
    // printed a constant 0 and contributed nothing to the gate. `buildProf`
    // carries the hydro build count, which is the signal that was wanted.
    const h = w.__hydro ? w.__hydro() : null;
    return `${t.builds ?? 0}/${t.roadCells ?? 0}/${t.seenWays ?? 0}/${h?.buildProf?.builds ?? -1}`;
  });
  if (s === prev) { if (++still >= 4) break; } else { still = 0; prev = s; }
}
console.log(`settled at ${prev}  (terrainBuilds/roadCells/seenWays/hydroBuilds)`);

const out = await d.page.evaluate((half) => {
  const w = window, s = w.__drive;
  // `__ford` carries every term in one call; classify from those, never from a
  // second copy of either rule (see the header).
  // ON THE CARRIAGEWAY IS `out <= 0`, NOT "roadEdge answered". `roadEdge`
  // returns the NEAREST segment in the point's 24 m grid cell whatever its
  // distance — `out` is d − halfWidth and may be metres positive — so a bare
  // non-null reads as "on a road" for every wet texel with a track anywhere
  // in the same cell. The first run of this tool counted 344 points that way
  // and 305 of them had no carriageway under them at all (`drive: null`).
  // Three buckets now: on the deck, within the shoulder the crossing
  // finder's own reach uses (halfWidth + 0.8), and merely nearby.
  const onRoadWet = [], fords = [], step = 4, SHOULDER = 0.8;
  // `fordSign` is the whole point of the pair: how many of the wet-on-road
  // points the LEGACY rule would have called a ford (fordM > 0.01) against
  // how many the contact actually calls water. A verdict count on its own
  // cannot show the two rules disagreeing.
  const tally = { dryRoad: 0, wetNoRoad: 0, wetOnRoad: 0, wetNearRoad: 0, ford: 0, deckOver: 0, nothing: 0,
    crossing: {}, support: {}, fordSign: { legacyFord: 0, legacyDry: 0 },
    waterWithLegacyDry: 0, deckWithLegacyFord: 0 };
  for (let dz = -half; dz <= half; dz += step) {
    for (let dx = -half; dx <= half; dx += step) {
      const x = s.x + dx, z = s.z + dz;
      const f = w.__ford(x, z);
      const wet = !!f.wet && f.wet.coverage >= 0.5;
      const onDeck = !!f.edge && f.edge.out <= SHOULDER;
      if (!wet && !onDeck) { tally.nothing++; continue; }
      if (!wet) { tally.dryRoad++; continue; }
      if (!onDeck) { if (f.edge) tally.wetNearRoad++; else tally.wetNoRoad++; continue; }
      tally.wetOnRoad++;
      const row = { x: Math.round(x), z: Math.round(z), surface: f.surface, fordM: f.fordM,
        resting: f.wet.resting, kind: f.wet.kind, cov: f.wet.coverage,
        deck: +(f.edge.y + f.base).toFixed(2), out: f.edge.out, track: f.edge.track,
        ground: +(f.ground + f.base).toFixed(2),
        crossing: f.crossing, lookup: f.lookup,
        support: f.support ? `${f.support.kind}@${f.support.y}` : null,
        drive: f.drive ? f.drive.y : null,
        fluidOver: f.fluid ? f.fluid.over : null };
      const legacyFord = f.fordM > 0.01;
      if (legacyFord) tally.fordSign.legacyFord++; else tally.fordSign.legacyDry++;
      if (f.surface === 'water' && !legacyFord) tally.waterWithLegacyDry++;
      if (f.surface !== 'water' && legacyFord) tally.deckWithLegacyFord++;
      tally.crossing[f.crossing ?? 'none'] = (tally.crossing[f.crossing ?? 'none'] ?? 0) + 1;
      tally.support[f.support ? f.support.kind : 'none'] = (tally.support[f.support ? f.support.kind : 'none'] ?? 0) + 1;
      if (f.surface === 'water') { tally.ford++; fords.push(row); }
      else { tally.deckOver++; onRoadWet.push(row); }
    }
  }
  return { tally, onRoadWet, fords, at: { x: Math.round(s.x), z: Math.round(s.z) },
    substrate: w.__substrate ? w.__substrate() : null,
    hydro: w.__hydro ? { tiles: w.__hydro().tiles } : null,
    map: w.__wetmap ? w.__wetmap(160, 41) : null };
}, R);

console.log(`\nover the ${2 * R} m box:`, JSON.stringify(out.tally));
console.log(`substrate mode:`, JSON.stringify(out.substrate).slice(0, 300));
console.log(`\nTHE TWO RULES, over the ${out.tally.wetOnRoad} drawn-wet points ON the carriageway`
  + ` (${out.tally.wetNearRoad} more are wet with a road in the cell but off its deck):`);
console.log(`  the CONTACT says water: ${out.tally.ford}   the LEGACY deck rule says ford: ${out.tally.fordSign.legacyFord}`);
console.log(`  water where the legacy rule says the deck is clear: ${out.tally.waterWithLegacyDry}`);
console.log(`  not water where the legacy rule says ford:          ${out.tally.deckWithLegacyFord}`);
console.log(`\nWET-ON-ROAD, by the registry's word:`, JSON.stringify(out.tally.crossing));
console.log(`WET-ON-ROAD, by the layer the contact chose as SUPPORT:`, JSON.stringify(out.tally.support));
console.log(`\nsurfaceAt says WATER on a road (${out.fords.length}):`);
for (const r of out.fords.slice(0, 10)) console.log(' ', JSON.stringify(r));
console.log(`\nDRAWN WATER on a road that is NOT a ford (${out.onRoadWet.length}) — the river over the track:`);
for (const r of out.onRoadWet.slice(0, 14)) console.log(' ', JSON.stringify(r));
if (out.map) console.log('\n' + (Array.isArray(out.map) ? out.map.join('\n') : String(out.map)));
if (d.errors.length) console.log(`\npage errors: ${JSON.stringify(d.errors).slice(0, 300)}`);
await d.close();

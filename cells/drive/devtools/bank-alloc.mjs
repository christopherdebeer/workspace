/**
 * WHOSE SHORE THE CENSUS COULD NOT DESCRIBE, PER TILE.
 *
 *   node cells/drive/devtools/bank-alloc.mjs        [FIX=at-senqu-top]
 *
 * The census reports `uncoveredM` aggregated over the tiles that reach its
 * window and cannot say WHY: a chain the budget could not reach at all and a
 * seat the field refused both land there, because `coveredM` only accumulates
 * where a station got past the no-water / no-ground tests. The resolver's own
 * per-tile stats separate them, and `__banktransect(...).bankStats` is where
 * they are. Named rather than guessed at.
 */
import { openDrive } from './harness.mjs';

const fixture = process.env.FIX || 'at-senqu-top';
const d = await openDrive({
  spot: `fixture=${fixture}&cam=chase&nodraw=1&tdbg=0&wxlive=0&time=NOON`,
  tag: `bankalloc-${fixture}`, settle: 0, bootTimeout: 240000,
});
await d.page.waitForTimeout(75000);
const out = await d.page.evaluate(() => {
  const w = window;
  const seen = new Map();
  // Walk a coarse grid of the census window and collect each tile's stats
  // once, through the transect probe's own lookup — one authority, not a
  // second copy of the tile arithmetic.
  const s = w.__drive;
  for (let dz = -384; dz <= 384; dz += 96) {
    for (let dx = -384; dx <= 384; dx += 96) {
      const t = w.__banktransect(s.x + dx, s.z + dz, 1, 1);
      if (!t || !t.bankStats) continue;
      const k = JSON.stringify([t.bankStats.shoreM, t.bankStats.chains, t.bankStats.stations]);
      if (!seen.has(k)) seen.set(k, t.bankStats);
    }
  }
  return { tiles: [...seen.values()], fringe: w.__bankfringe(384, 129) };
});
for (const st of out.tiles) {
  console.log(`shore ${st.shoreM} m · ${st.chains} chains · ${st.stations} stations · spacing ${st.spacingM} m`);
  console.log(`  covered ${st.coveredM} · uncovered ${st.uncoveredM} · dropped ${st.dropped}`);
  console.log(`  resolved ${st.resolved} · nothingToCut ${st.nothingToCut} · unresolved ${JSON.stringify(st.unresolved)}`);
}
const f = out.fringe;
console.log(`window: ${f.bankTiles}/${f.bankTilesRing} tiles · ${f.bankStations}/${f.bankStationsRing} stations`
  + ` · coarsest ${f.bankSpacingWorstM} m · shore ${f.bankShoreM} · uncovered ${f.bankUncoveredM} · dropped ${f.bankDropped}`);
if (d.errors.length) console.log(`page errors: ${JSON.stringify(d.errors).slice(0, 200)}`);
await d.close();

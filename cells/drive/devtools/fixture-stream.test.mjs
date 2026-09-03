/**
 * A FIXTURE IS A BOX, AND THE STREAMER HAS TO BELIEVE IT.
 *
 *   node cells/drive/devtools/fixture-stream.test.mjs        (~2min)
 *
 * The streamer sizes every ring from the VIEW, which is right for a world that
 * goes on for ever and wrong for one that stops. A z14 tile is about two
 * kilometres and `tRing` is 2 to 3, so a fixture whose whole subject is 1.4km
 * across used to build a five-by-five to seven-by-seven block of ground —
 * roughly ten kilometres on a side — and carve every tile of it at one tile per
 * 200ms. Measured on the Big Sur capture: 25 height tiles, 25 meshes, and a
 * carve queue that took NINETY SECONDS to drain, of which four tiles held every
 * road in the fixture and the other twenty-one held the height grid's edge row
 * smeared outward with nothing on it.
 *
 * Two laws, and the second one is the one nobody would have thought to check:
 *
 *   1. every streamed layer stops at the fixture's own extent, and
 *   2. THE TWO LAYERS A FIXTURE CANNOT ANSWER ARE NEVER ASKED FOR.
 *
 * `loadOvTile` and `loadPeakTile` go straight to the cell — they are the only
 * parts of the stream a fixture does not intercept. So a top-view frame of an
 * authored world was fetching the REAL road network and the REAL summits at the
 * fixture's coordinates, which for the authored ones is the country above
 * Geneva: coarse ribbons of somebody else's roads drawn over a synthetic
 * crossroads, and the Alps seated on its horizon. The fixture world's whole
 * claim is that nothing reaches the network; that was the hole in it.
 *
 * Asserted from `__fixworld().built` rather than from a request log because the
 * harness relays every request through curl and is structurally unable to
 * witness one. The set the ask would have filled is the only witness there is.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const errors = [];

// One captured world and one authored one, in TOP view — the view that fires
// the overview layer, so the network laws are actually put to the question.
// (A chase-cam boot would pass them by never reaching the branch.)
for (const [id, maxTerrain] of [['at-campsbay', 9], ['crossroads', 9]]) {
  const t0 = Date.now();
  const d = await openDrive({
    spot: `fixture=${id}&cam=top&z=0.8&time=NOON&cprobe=1`,
    tag: `fixstream-${id}`, settle: 9000, bootTimeout: 120000,
  });
  const q = async (fn, ...a) => d.page.evaluate(fn, ...a);
  // Wait for the CARVE, not a clock: the queue rebuilds one tile per 200ms and
  // every count read before it drains is a count about a half-built world.
  let quiet = 0, settled = null;
  for (let i = 0; i < 40; i++) {
    await d.page.waitForTimeout(3000);
    if ((await q(() => window.__tstats().dirty)) === 0) quiet++; else quiet = 0;
    if (quiet >= 3) { settled = (i + 1) * 3; break; }
  }
  const w = await q(() => { const o = window.__fixworld(); delete o.tune; delete o.ground; return o; });
  const dem = await q(() => window.__demsrc());
  errors.push(...d.errors);
  await d.close();

  console.log(`\n  ${id}  r=${w.r}m  settled t+${settled ?? '>120'}s  boot+settle ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  console.log(`  asked ${JSON.stringify(w.tiles)}   built ${JSON.stringify(w.built)}`);

  check(`${id}: the fixture is the world`, w.id === id, w.id);
  check(`${id}: the carve finished inside the budget`, settled !== null, settled);
  // THE RATIO IS THE CLAIM. 9 is a 3x3 of z14 tiles, which is what a ~2.5km
  // box needs when it straddles a tile edge in both axes; the old ring was 25
  // to 49 whatever the fixture was.
  check(`${id}: the terrain ring is the fixture's box, not the view's`,
    w.tiles.terrain > 0 && w.tiles.terrain <= maxTerrain, w.tiles);
  // ── AND THE SECOND MECHANISM, WHICH IS NOT THE STREAMER'S ──
  //
  // More ground gets BUILT than the streamer asks for, and that is not a leak
  // in the clamp. `renderGated` will not build a vector tile until the height
  // tiles covering it have landed, and it takes them with a ONE-TILE MARGIN
  // for spilling geometry — one tile at TERRAIN_Z, which is ±2km. So a 2km box
  // whose 5x5 of z16 vector tiles spans 2.5km pulls a 4x4 of z14 ground
  // whatever the streamer asked: measured, 4 asked and 16 built, on both a
  // capture and an authored fixture.
  //
  // Deliberately left alone. That margin is on the path every road in the game
  // is built through, and shrinking it for fixtures would mean geometry that
  // spills past the box finds no height — `hasHeight` fails, the way counts as
  // unbuilt, and the tile is re-asked every three seconds for ever. A busy loop
  // is a worse trade than twelve tiles of edge smear.
  //
  // So the law is the RATIO, not equality: everything the streamer asked for is
  // built, and the total stays well under the 25-to-49 the view-sized ring
  // produced for any fixture at all.
  check(`${id}: the ground built is the box plus renderGated's margin, not a view ring`,
    w.built.terrain >= w.tiles.terrain && w.built.terrain < 25,
    { asked: w.tiles.terrain, built: w.built.terrain });
  check(`${id}: the coarse backdrop stops at the box too`,
    w.built.far <= w.tiles.terrain, { far: w.built.far, box: w.tiles.terrain });

  // ── the network laws ──
  check(`${id}: not one DEM tile was fetched`, (dem.mth | 0) === 0 && (dem.aws | 0) === 0, dem);
  check(`${id}: no overview vectors were asked for`, w.built.ov === 0, w.built);
  check(`${id}: no summits were asked for`, w.built.peaks === 0, w.built);
}

console.log(bad ? `\n${bad} FAILED` : '\nall good — the fixture streams its own box and nothing else');
report(errors);
if (bad) process.exitCode = 1;

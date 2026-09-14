/**
 * TILE-OWNED MUTABLE ROAD BATTER PACKETS.
 *
 *   node cells/drive/devtools/substrate-batter-render.test.mjs
 *
 * Refined terrain normally owns the road wedge and suppresses separate batter
 * strips. Disabling refinement in the authored side-hill fixture positively
 * exercises the rollback geometry: mutable toe arrays stay in the drape
 * registry, while only the matching substrate tile's packet mesh enters the
 * scene after terrain re-seating.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const ok = (name, condition, saw) => {
  if (!condition) bad++;
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${name}${condition ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const d = await openDrive({
  spot: 'fixture=sidehill&cam=chase&substrate=render&refine=0&time=DAY',
  tag: 'substrate-batter-render-cutover',
  settle: 18000,
  bootTimeout: 90000,
});
await d.page.waitForTimeout(12000);

const state = await d.page.evaluate(() => ({
  render: window.__substrate?.().render,
  strips: window.__stripAudit?.(3000, 5),
}));

ok('the authored side hill produces mutable batter geometry',
  state.render?.roadBatterCandidates > 0
    && state.strips?.strips === state.render?.roadBatterCandidates
    && state.strips?.verts > 0,
  state);
ok('every batter contribution is a direct tile packet',
  state.render?.roadBatterPacketMeshes === state.render?.roadBatterCandidates
    && state.render?.roadDirectAuthoredPacketMeshes
      === state.render?.roadPacketMeshes
    && state.render?.roadRedrapeAuthoredPacketMeshes
      === state.render?.roadPacketMeshes,
  state.render);
ok('the mutable source registry retains no renderer mesh',
  state.render?.retainedRoadSourceMeshes === 0
    && state.render?.legacyRoadCandidateMeshes === 0
    && state.render?.drivePacketFailures === 0,
  state.render);
ok('only committed substrate road packets are visible',
  state.render?.roadPacketMeshes === state.render?.roadInstantiatedMeshes
    && state.render?.roadInstantiatedMeshes === state.render?.visibleRoads
    && state.render?.uncommittedVisibleRoads === 0,
  state.render);
ok('batter toes never seat on missing ground or hang as high sheets',
  state.strips?.vertsWithoutGround === 0
    && state.strips?.stripsInAirOver5m === 0
    && state.strips?.stripsSpanningOver25m === 0,
  state.strips);

report(d.errors);
await d.close();
if (d.errors.length) bad++;
console.log(bad ? `\n${bad} FAILED`
  : '\nall good — mutable batter arrays re-seat privately and render only through substrate tiles');
if (bad) process.exitCode = 1;

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

// A road packet can arrive while its owner tile is between terrain revisions.
// Wait for the queue and the packet/redrape/commit lifecycle to converge,
// rather than sampling the legitimate atomic refusal in that short window.
let quiet = 0;
let previousSignature = '';
const settleDeadline = Date.now() + 60000;
while (Date.now() < settleDeadline && quiet < 4) {
  await d.page.waitForTimeout(500);
  const settled = await d.page.evaluate(() => {
    const terrain = window.__tstats?.();
    const render = window.__substrate?.().render;
    return {
      ready: terrain?.dirty === 0
        && terrain?.inFlight === 0
        && terrain?.queued === 0
        && render?.pendingReconciliations === 0
        && render?.roadPacketMeshes === render?.roadRedrapeAuthoredPacketMeshes
        && render?.roadPacketMeshes === render?.roadInstantiatedMeshes,
      signature: JSON.stringify([
        terrain?.builds,
        terrain?.seenWays,
        terrain?.roadCells,
        render?.atomicCommits,
        render?.roadPacketMeshes,
        render?.roadInstantiatedMeshes,
      ]),
    };
  });
  quiet = settled.ready && settled.signature === previousSignature ? quiet + 1 : 0;
  previousSignature = settled.signature;
}

const state = await d.page.evaluate((settled) => ({
  render: window.__substrate?.().render,
  strips: window.__stripAudit?.(3000, 5),
  settled,
}), quiet >= 4);

ok('the authored side hill produces mutable batter geometry',
  state.settled
    && state.render?.roadBatterCandidates > 0
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

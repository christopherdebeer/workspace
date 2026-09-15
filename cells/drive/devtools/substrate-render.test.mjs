/**
 * GUARDED SUBSTRATE HYDRO RENDER CUTOVER — shipping authored Senqu world.
 *
 *   node cells/drive/devtools/substrate-render.test.mjs
 *
 * HydroSystem still builds the cross-tile body field during migration, but in
 * `?substrate=render` it must not create GPU resources itself. The immutable
 * production substrate tile captures that exact field identity and revision,
 * then commits it to rendering. This test proves both halves of that contract.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const ok = (name, condition, saw) => {
  if (!condition) bad++;
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${name}${condition ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const d = await openDrive({
  spot: 'fixture=at-senqu-ford&cam=chase&substrate=render&time=DAY',
  tag: 'substrate-render-cutover',
  settle: 12000,
  bootTimeout: 90000,
});
const readState = () => d.page.evaluate(() => ({
  substrate: window.__substrate?.(),
  terrainField: window.__substrateField?.(),
  hydro: window.__hydro?.(),
  hydroTiles: window.__hydrotiles?.() ?? [],
  waterPoints: window.__substrateWaterPoints?.(32, 3000) ?? [],
}));

// The streamed ring can admit one final terrain tile while its asynchronous
// hydro field is still building. A fixed sleep snapshots that legitimate
// atomic handoff at random. Require the whole authority to be quiescent and
// unchanged for a short window instead: no pending field/reconciliation, no
// retained source wrapper, and exact candidate/commit parity.
let state;
let stableSignature = '';
let stableSince = 0;
const settleDeadline = Date.now() + 60000;
while (Date.now() < settleDeadline) {
  state = await readState();
  const render = state.substrate?.render;
  const hydro = state.hydro?.stats;
  const settled = render?.terrainCandidates > 0
    && render.terrainCandidates === render.terrainCommitted
    && render.retainedTerrainSourceMeshes === 0
    && render.pendingReconciliations === 0
    && hydro?.pendingBuilds === 0
    && hydro?.dirtyTiles === 0;
  const signature = JSON.stringify([
    render?.terrainCandidates,
    render?.terrainCommitted,
    render?.atomicCommits,
    render?.hydroShoreBreakLineSegments,
    state.substrate?.tiles?.revision,
    hydro?.tiles,
    state.hydroTiles.length,
  ]);
  if (settled && signature === stableSignature) {
    if (Date.now() - stableSince >= 1500) break;
  } else {
    stableSignature = signature;
    stableSince = Date.now();
  }
  await d.page.waitForTimeout(250);
}
state ??= await readState();

ok('render mode reports the substrate tile as render authority',
  state.substrate?.mode === 'render'
    && state.substrate?.renderAuthority === 'substrate-tile',
  state.substrate);
ok('versioned substrate tiles capture exact production hydro',
  state.substrate?.tiles?.tiles > 0
    && state.substrate?.tiles?.waters > 0
    && state.waterPoints.length > 0,
  { tiles: state.substrate?.tiles, points: state.waterPoints.length });
ok('the terrain packet and geomorphic field share one tile revision',
  state.substrate?.at?.terrainField
    && state.terrainField?.built
    && state.terrainField?.tile === state.substrate?.at?.key,
  { tile: state.substrate?.at, field: state.terrainField });
ok('every observed production crossing has resolved semantics and implementation',
  state.substrate?.crossings?.total > 0
    && state.substrate?.crossings?.unresolved === 0
    && state.substrate?.crossings?.missingImplementation === 0,
  {
    crossings: state.substrate?.crossings,
    records: state.substrate?.crossingRecords,
  });
ok('only substrate-committed terrain candidates enter the scene',
  state.substrate?.render?.atomicCommits > 0
    && state.substrate?.render?.terrainPacketMeshes > 0
    && state.substrate?.render?.terrainBuildAuthoredPacketMeshes
      === state.substrate?.render?.terrainPacketMeshes
    && state.substrate?.render?.terrainPacketMeshes
      === state.substrate?.render?.terrainInstantiatedMeshes
    && state.substrate?.render?.terrainInstantiatedMeshes
      === state.substrate?.render?.visibleTerrain
    && state.substrate?.render?.retainedTerrainSourceMeshes === 0
    && state.substrate?.render?.legacyTerrainCandidateMeshes === 0
    && state.substrate?.render?.terrainPacketFailures === 0
    && state.substrate?.render?.terrainCommitted > 0
    && state.substrate?.render?.visibleTerrain === state.substrate?.render?.terrainCommitted
    && state.substrate?.render?.uncommittedVisibleTerrain === 0,
  state.substrate?.render);
ok('the committed tile versions its exact drive layer',
  state.substrate?.at?.sourceRevisions?.drive > 0
    && state.substrate?.at?.driveSegments > 0
    && state.substrate?.at?.driveRenderMeshes > 0,
  state.substrate?.at);
ok('only substrate-owned carriageway packets enter the scene',
  state.substrate?.render?.roadCandidates > 0
    && state.substrate?.render?.roadPacketMeshes > 0
    && state.substrate?.render?.roadDirectAuthoredPacketMeshes > 0
    && state.substrate?.render?.roadDirectAuthoredPacketMeshes
      === state.substrate?.render?.roadPacketMeshes
    && state.substrate?.render?.roadRedrapeAuthoredPacketMeshes
      === state.substrate?.render?.roadPacketMeshes
    && state.substrate?.render?.retainedRoadSourceMeshes === 0
    && state.substrate?.render?.roadPacketMeshes
      >= state.substrate?.render?.roadInstantiatedMeshes
    && state.substrate?.render?.roadInstantiatedMeshes
      === state.substrate?.render?.visibleRoads
    && state.substrate?.render?.legacyRoadCandidateMeshes === 0
    && state.substrate?.render?.drivePacketFailures === 0
    && state.substrate?.render?.roadCommittedTiles > 0
    && state.substrate?.render?.visibleRoads > 0
    && state.substrate?.render?.uncommittedVisibleRoads === 0,
  state.substrate?.render);
ok('no uncommitted crossing structure enters the scene',
  state.substrate?.render?.uncommittedVisibleStructures === 0,
  state.substrate?.render);
ok('river-bed rapid meshes and colliders commit as one detail packet',
  state.substrate?.render?.hydroDetailCandidates > 0
    && state.substrate?.render?.hydroDetailDirectAuthoredPacketMeshes
      === state.substrate?.render?.hydroDetailPacketMeshes
    && state.substrate?.render?.hydroDetailRedrapeAuthoredPacketMeshes
      === state.substrate?.render?.hydroDetailPacketMeshes
    && state.substrate?.render?.retainedHydroDetailSourceMeshes === 0
    && state.substrate?.render?.hydroDetailPacketMeshes
      === state.substrate?.render?.hydroDetailInstantiatedMeshes
    && state.substrate?.render?.hydroDetailInstantiatedMeshes
      === state.substrate?.render?.visibleHydroDetails
    && state.substrate?.render?.legacyHydroDetailCandidateMeshes === 0
    && state.substrate?.render?.hydroDetailPacketFailures === 0
    && state.substrate?.render?.hydroDetailColliderCandidates > 0
    && state.substrate?.render?.hydroDetailTileColliders
      === state.substrate?.render?.hydroDetailColliderCandidates
    && state.substrate?.render?.visibleHydroDetails
      === state.substrate?.render?.hydroDetailCandidates
    && state.substrate?.render?.activeHydroDetailColliders
      === state.substrate?.render?.hydroDetailColliderCandidates
    && state.substrate?.render?.uncommittedVisibleHydroDetails === 0
    && state.substrate?.render?.uncommittedHydroDetailColliders === 0,
  state.substrate?.render);
ok('every built hydro record is render-deferred',
  state.hydroTiles.some((tile) => tile.built)
    && state.hydroTiles.filter((tile) => tile.built).every((tile) => tile.renderDeferred),
  state.hydroTiles);
ok('a substrate-committed flowing tile owns one edge-blended body mesh',
  state.hydroTiles.some((tile) => tile.mesh && tile.flowingMesh && tile.edgeBlendMesh
    && tile.resolution === 256 && tile.gutter === 12
    && tile.shoreSegments > 0 && tile.shoreGroundSpanM >= 0
    && tile.shoreRefinedCells > 0),
  state.hydroTiles);
ok('the exact flowing shoreline constrains production terrain topology',
  state.substrate?.render?.hydroShoreBreakLineTiles > 0
    && state.substrate?.render?.hydroShoreBreakLineSegments > 0,
  state.substrate?.render);
ok('non-flowing records retain the base field tier',
  state.hydroTiles.filter((tile) => tile.built && !tile.kinds
    ?.some((kind) => ['river', 'stream', 'canal'].includes(kind)))
    .every((tile) => tile.resolution === 128),
  state.hydroTiles);
ok('deferred records without exposed water do not acquire meshes',
  state.hydroTiles.filter((tile) => tile.built && !tile.hasWater)
    .every((tile) => !tile.mesh),
  state.hydroTiles);
ok('hydro and substrate agree on the visible tile count',
  state.hydro?.stats?.visibleTiles
    === state.hydroTiles.filter((tile) => tile.mesh).length,
  { stats: state.hydro?.stats, tiles: state.hydroTiles });

report(d.errors);
await d.close();
if (d.errors.length) bad++;
console.log(bad ? `\n${bad} FAILED` : '\nall good — substrate tiles commit exact hydro fields to rendering');
if (bad) process.exitCode = 1;

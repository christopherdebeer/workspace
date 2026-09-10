/**
 * GUARDED SUBSTRATE STRUCTURE RENDER CUTOVER.
 *
 *   node cells/drive/devtools/substrate-structure-render.test.mjs
 *
 * The authored structures world contains an explicit stream conduit under one
 * road and a separate tagged causeway. Unlike the Senqu ford, it positively
 * exercises production culvert geometry: bore and headwalls must remain hidden
 * until the terrain tile captures their structure generation and crossing
 * revision in one substrate commit. The causeway must consume its explicit
 * authority before construction and therefore must not generate another bore.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const ok = (name, condition, saw) => {
  if (!condition) bad++;
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${name}${condition ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const d = await openDrive({
  spot: 'fixture=structures&cam=chase&substrate=render&time=DAY',
  tag: 'substrate-structure-render-cutover',
  settle: 14000,
  bootTimeout: 90000,
});
await d.page.waitForTimeout(9000);

const state = await d.page.evaluate(() => ({
  now: performance.now(),
  substrate: window.__substrate?.(),
  culverts: window.__culverts?.(),
  terrain: window.__tstats?.(),
  buildLog: window.__buildLog?.(),
}));

ok('the authored fixture builds a production conduit',
  state.culverts?.runs === 1 && state.substrate?.crossings?.culvert > 0,
  state);
ok('the authored causeway suppresses conduit construction',
  state.substrate?.crossings?.causeway > 0
    && state.substrate?.crossings?.missingImplementation === 0
    && state.culverts?.runs === 1,
  state);
ok('production diagnostics retain per-crossing authority evidence',
  state.substrate?.crossingRecords?.some((record) =>
    record.kind === 'culvert'
      && record.authority === 'explicit-tag'
      && record.evidence.some((item) => item.includes('tunnel=culvert')))
    && state.substrate?.crossingRecords?.some((record) =>
      record.kind === 'causeway'
        && record.authority === 'explicit-tag'
        && record.evidence.some((item) => item.includes('embankment=yes')))
    && !state.substrate?.crossingRecords?.some((record) => record.kind === 'unresolved'),
  state.substrate?.crossingRecords);
const culvertEarthwork = state.substrate?.crossingEarthworks?.find((record) =>
  record.kind === 'culvert' && record.implementation === 'built');
const causewayEarthwork = state.substrate?.crossingEarthworks?.find((record) =>
  record.kind === 'causeway' && record.implementation === 'built');
ok('the culvert terrain keeps the channel bed open below the road',
  Number.isFinite(culvertEarthwork?.groundY)
    && Math.abs(culvertEarthwork.groundToBedM) < 1.25
    && culvertEarthwork.groundToDeckM < -0.5,
  culvertEarthwork);
ok('the causeway terrain retains solid fill to the authored road',
  Number.isFinite(causewayEarthwork?.groundY)
    && Math.abs(causewayEarthwork.groundToDeckM) < 0.5,
  causewayEarthwork);
const crossingRebuilds = state.buildLog?.filter((entry) => entry.why === 'crossing') ?? [];
const latestCrossingRebuild = crossingRebuilds.at(-1);
const implementedCrossings = state.substrate?.crossingEarthworks?.filter((record) =>
  record.kind !== 'unresolved' && record.implementation !== 'missing').length ?? 0;
ok('crossing earthwork invalidation converges',
  crossingRebuilds.length > 0
    && crossingRebuilds.length <= implementedCrossings * 4
    && state.now - latestCrossingRebuild.at > 3000,
  { now: state.now, crossingRebuilds, implementedCrossings, terrain: state.terrain });
ok('the substrate captures a versioned structure candidate',
  state.substrate?.render?.structureCandidateTiles > 0
    && state.substrate?.render?.structureCandidates >= 3,
  state.substrate?.render);
ok('tile-owned drive packets retain indexed transformed tunnel geometry',
  state.substrate?.render?.roadPacketVertices > 0
    && state.substrate?.render?.roadPacketBytes > 0
    && state.substrate?.render?.roadIndexedPackets > 0
    && state.substrate?.render?.roadTransformedPackets > 0
    && state.substrate?.render?.roadDirectAuthoredPacketMeshes
      === state.substrate?.render?.roadPacketMeshes
    && state.substrate?.render?.legacyRoadCandidateMeshes === 0
    && state.substrate?.render?.drivePacketFailures === 0,
  state.substrate?.render);
ok('the matching substrate tile admits the complete structure packet',
  state.substrate?.render?.structureCommittedTiles > 0
    && state.substrate?.render?.structurePacketMeshes > 0
    && state.substrate?.render?.structureBuildAuthoredPacketMeshes
      === state.substrate?.render?.structurePacketMeshes
    && state.substrate?.render?.structurePacketMeshes
      === state.substrate?.render?.structureInstantiatedMeshes
    && state.substrate?.render?.structureInstantiatedMeshes
      === state.substrate?.render?.visibleStructures
    && state.substrate?.render?.visibleStructures
      === state.substrate?.render?.structureCandidates
    && state.substrate?.render?.retainedStructureSourceMeshes === 0
    && state.substrate?.render?.legacyStructureCandidateMeshes === 0
    && state.substrate?.render?.structurePacketFailures === 0
    && state.substrate?.render?.uncommittedVisibleStructures === 0,
  state.substrate?.render);

report(d.errors);
await d.close();
if (d.errors.length) bad++;
console.log(bad ? `\n${bad} FAILED`
  : '\nall good — crossing intent controls conduit construction and substrate commits it atomically');
if (bad) process.exitCode = 1;

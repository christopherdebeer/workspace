/**
 * REPRESENTATIVE SUBSTRATE WATER DRIVE — shipping game, authored Senqu world.
 *
 *   node cells/drive/devtools/substrate-drive.test.mjs
 *
 * The test targets exact field water through __substrateWaterPoints rather
 * than retired river ribbon meshes. It enters exposed fluid, leaves it on dry
 * support, and checks the one shared evidence history before its real-time
 * stamps expire.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const ok = (name, condition, saw) => {
  if (!condition) bad++;
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${name}${condition ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const d = await openDrive({
  spot: 'fixture=at-senqu-ford&cam=chase&substrate=render&time=DAY',
  tag: 'substrate-render-drive',
  settle: 12000,
  bootTimeout: 90000,
});
await d.page.waitForTimeout(10000);

const points = await d.page.evaluate(() => window.__substrateWaterPoints?.(96, 3000) ?? []);
const fluidPoints = points.filter((point) => point.fluid)
  .sort((a, b) => (b.depthAboveSupportM ?? 0) - (a.depthAboveSupportM ?? 0));
const wet = fluidPoints.find((point) => point.crossing === 'ford')
  ?? fluidPoints.find((point) => point.crossing === null)
  ?? fluidPoints[0]
  ?? null;
ok('field-native probe finds exposed vehicle fluid away from the bridge deck', !!wet, {
  count: points.length,
  first: points[0] ?? null,
});

if (wet) {
  await d.page.evaluate((point) => {
    window.__substrate?.('reset');
    window.__drive.x = point.x;
    window.__drive.z = point.z;
    window.__drive.speed = 1.5;
  }, wet);
}
// Shadow observes every 15 ticks. Wait for more than one full observation
// interval so this assertion does not depend on the tick phase at teleport.
await d.simWait(.9);
await d.page.evaluate(() => window.__substrateParityProbe?.());

const immersed = await d.page.evaluate(() => ({
  evidence: window.__waterEvidence?.(),
  substrate: window.__substrate?.(),
  wetfx: window.__wetfx?.(),
}));
ok('canonical contact drives a live wake', immersed.evidence?.inWater
  && immersed.evidence.authority === 'substrate'
  && immersed.evidence.wakeStrength > 0, immersed.evidence);
ok('the integrated render mode owns both pixels and contact',
  immersed.substrate?.mode === 'render'
    && immersed.substrate?.renderAuthority === 'substrate-tile'
    && immersed.substrate?.render?.atomicCommits > 0,
  immersed.substrate);
ok('loaded vehicle consumers require no legacy contact fallback',
  immersed.substrate?.contactAvailability?.queries > 0
    && immersed.substrate?.contactAvailability?.fallbackQueries === 0
    && immersed.substrate?.contactAvailability?.reasons?.invalidTile === 0,
  immersed.substrate?.contactAvailability);
ok('cutover readiness exposes each production gate structurally',
  ['wet-disagreement-rate', 'depth-p95', 'depth-maximum', 'support-p95',
    'speed-authority', 'crossing-authority']
    .every((id) => immersed.substrate?.gates?.some((gate) => gate.id === id)),
  immersed.substrate?.gates);
ok('fluid-contact patches retain tyre wetness', immersed.evidence?.tyreWetness
  ?.some((value) => value > .5), immersed.evidence?.tyreWetness);
ok('immersed probe is backed by exact terrain and hydro',
  immersed.substrate?.wetDisagreement === 0
  && immersed.substrate?.at?.exactGround
  && immersed.substrate?.at?.exactHydro
  && wet?.depthAboveSupportM > 0,
  immersed.substrate);
ok('guarded mode compares against an independent wet legacy observation',
  immersed.substrate?.depth?.compared > 0
  && immersed.substrate?.last?.legacy?.wet
  && immersed.substrate?.last?.canonical?.fluid,
  {
    depth: immersed.substrate?.depth,
    last: immersed.substrate?.last,
  });
ok('splash gate uses the same exposed contact', immersed.wetfx?.why === 'wet',
  immersed.wetfx);

const dry = wet ? await d.page.evaluate(() => {
  const state = window.__drive;
  for (let radius = 15; radius <= 140; radius += 5) {
    for (let angle = 0; angle < 16; angle++) {
      const x = state.x + Math.cos(angle * Math.PI / 8) * radius;
      const z = state.z + Math.sin(angle * Math.PI / 8) * radius;
      if (window.__waterinfo(x, z).surface === 'water') continue;
      state.x = x;
      state.z = z;
      state.speed = 3.5;
      return { x, z };
    }
  }
  return null;
}) : null;
ok('representative drive finds dry support after the water', !!dry, dry);
await d.simWait(.55);

const exited = await d.page.evaluate(() => ({
  evidence: window.__waterEvidence?.(),
  substrate: window.__substrate?.(),
}));
ok('wet tyres leave terrain evidence after exit',
  exited.evidence?.activeTracks > 0, exited.evidence);
ok('the draining hull leaves post-exit drips',
  exited.evidence?.activeDrips > 0, exited.evidence);
ok('tyre and hull wetness carry onto dry support',
  exited.evidence?.tyreWetness?.some((value) => value > .1)
  && exited.evidence?.hullWetness > .1,
  exited.evidence);
ok('exact support remains within the cutover tolerance',
  (exited.substrate?.support?.maxAbsDeltaM ?? Infinity) <= .03,
  {
    wet,
    support: exited.substrate?.support,
    gates: exited.substrate?.gates,
    last: exited.substrate?.last,
    at: exited.substrate?.at,
  });

const audit = await d.page.evaluate(() => {
  window.__substrate?.('reset');
  return window.__substrateParityAudit?.(96, 3000);
});
ok('representative bank and crossing audit reaches production sample gates',
  audit?.sampled >= 100
  && audit?.hydroWater >= 25
  && audit?.depth?.compared >= 10
  && audit?.driveWaterOverlap >= 1,
  audit);
ok('representative bank and crossing audit clears every cutover gate',
  audit?.readyForCutover
  && audit?.blockers?.length === 0
  && audit?.wetDisagreement === 0
  && audit?.unresolvedCrossing === 0,
  audit);
console.log('      parity audit', JSON.stringify({
  sampled: audit?.sampled,
  waterSeeds: audit?.waterSeeds,
  readyForCutover: audit?.readyForCutover,
  blockers: audit?.blockers,
  wetDisagreementRate: audit?.wetDisagreementRate,
  depth: audit?.depth,
  support: audit?.support,
  unknownSpeed: audit?.unknownSpeed,
  unresolvedCrossing: audit?.unresolvedCrossing,
  ...(audit?.readyForCutover ? {} : {
    mismatches: audit?.mismatches,
    unresolved: audit?.unresolved,
    worstDepthDeltas: audit?.worstDepthDeltas,
  }),
}));

report(d.errors);
await d.close();
if (d.errors.length) bad++;
console.log(bad ? `\n${bad} FAILED` : '\nall good — canonical water contact leaves persistent vehicle evidence');
if (bad) process.exitCode = 1;

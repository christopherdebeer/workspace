/**
 * REPRESENTATIVE SUBSTRATE CONTACT PARITY MATRIX.
 *
 *   node cells/drive/devtools/substrate-parity-matrix.test.mjs
 *
 * One valley can prove the mechanism and still miss a coastal mask, a steep
 * road shoulder, or hidden crossing water. Exercise four deterministic worlds
 * and aggregate the production cutover gates across them:
 *
 *   Senqu       flowing river, ford/bridge and persistent shallows
 *   Bixby       cliff coast and sparse road topology
 *   Camps Bay   steep coastal terrain and dense profiled roads
 *   structures  explicit culvert and causeway semantics
 */
import { openDrive, report } from './harness.mjs';

const WORLDS = [
  {
    tag: 'senqu',
    spot: 'fixture=at-senqu-ford&cam=chase&substrate=render&time=DAY',
    settle: 12000,
  },
  {
    tag: 'bixby',
    spot: 'fixture=at-bixby&cam=chase&substrate=render&time=DAY',
    settle: 12000,
  },
  {
    tag: 'campsbay',
    spot: 'fixture=at-campsbay&cam=chase&substrate=render&time=DAY',
    settle: 16000,
  },
  {
    tag: 'structures',
    spot: 'fixture=structures&cam=chase&substrate=render&time=DAY',
    settle: 14000,
  },
];
const requestedWorlds = new Set(process.argv.slice(2));
const selectedWorlds = requestedWorlds.size
  ? WORLDS.filter((world) => requestedWorlds.has(world.tag))
  : WORLDS;
if (!selectedWorlds.length) {
  throw new Error(`unknown parity world: ${[...requestedWorlds].join(', ')}`);
}

let bad = 0;
const ok = (name, condition, saw) => {
  if (!condition) bad++;
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${name}${condition ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const audits = [];
for (const world of selectedWorlds) {
  const d = await openDrive({
    spot: world.spot,
    tag: `substrate-parity-${world.tag}`,
    settle: world.settle,
    bootTimeout: 90000,
  });
  let stableSignature = '';
  let stableSince = 0;
  let readiness;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    readiness = await d.page.evaluate(() => ({
      substrate: window.__substrate?.(),
      waterSeeds: window.__substrateWaterPoints?.(16, 3000)?.length ?? 0,
    }));
    const render = readiness.substrate?.render;
    const settled = readiness.substrate?.tiles?.tiles > 0
      && readiness.waterSeeds > 0
      && render?.pendingReconciliations === 0
      && render?.terrainCandidates === render?.terrainCommitted
      && render?.retainedTerrainSourceMeshes === 0;
    const signature = JSON.stringify([
      readiness.substrate?.tiles?.revision,
      readiness.substrate?.tiles?.tiles,
      readiness.waterSeeds,
      render?.atomicCommits,
      render?.terrainCommitted,
    ]);
    if (settled && signature === stableSignature) {
      if (Date.now() - stableSince >= 1500) break;
    } else {
      stableSignature = signature;
      stableSince = Date.now();
    }
    await d.page.waitForTimeout(250);
  }
  const result = await d.page.evaluate(() => {
    window.__substrate?.('reset');
    return {
      audit: window.__substrateParityAudit?.(96, 3000),
      crossingRecords: window.__substrate?.()?.crossingRecords ?? [],
    };
  });
  const { audit, crossingRecords } = result;
  audits.push({ tag: world.tag, audit });
  const concise = {
    sampled: audit?.sampled,
    waterSeeds: audit?.waterSeeds,
    hydroWater: audit?.hydroWater,
    driveWaterOverlap: audit?.driveWaterOverlap,
    wetDisagreement: audit?.wetDisagreement,
    depth: audit?.depth,
    support: audit?.support,
    fallbackProbes: audit?.fallbackProbes,
    unknownSpeed: audit?.unknownSpeed,
    unresolvedCrossing: audit?.unresolvedCrossing,
    blockers: audit?.blockers,
  };
  console.log(`${world.tag}: ${JSON.stringify(concise)}`);
  ok(`${world.tag} samples a loaded water/shore field`,
    audit?.sampled >= 100 && audit?.waterSeeds > 0 && audit?.hydroWater > 0,
    concise);
  ok(`${world.tag} has no tile fallback or wet classification disagreement`,
    audit?.fallbackProbes === 0 && audit?.wetDisagreement === 0,
    { mismatches: audit?.mismatches, crossingRecords });
  ok(`${world.tag} resolves current and crossing authority`,
    audit?.unknownSpeed === 0 && audit?.unresolvedCrossing === 0,
    { unresolved: audit?.unresolved, crossingRecords });
  ok(`${world.tag} support remains within cutover tolerance`,
    audit?.support?.compared >= 100
      && audit.support.p95AbsDeltaM <= .03,
    audit?.support);
  if ((audit?.depth?.compared ?? 0) >= 10) {
    ok(`${world.tag} immersed depth remains within cutover tolerance`,
      audit.depth.p95AbsDeltaM <= .1
        && audit.depth.maxAbsDeltaM <= .25,
      audit.depth);
  }
  report(d.errors);
  if (d.errors.length) bad++;
  await d.close();
}

const aggregate = audits.reduce((sum, { audit }) => ({
  probes: sum.probes + (audit?.probes ?? 0),
  hydroWater: sum.hydroWater + (audit?.hydroWater ?? 0),
  depthCompared: sum.depthCompared + (audit?.depth?.compared ?? 0),
  driveWaterOverlap: sum.driveWaterOverlap + (audit?.driveWaterOverlap ?? 0),
  wetDisagreement: sum.wetDisagreement + (audit?.wetDisagreement ?? 0),
  fallbackProbes: sum.fallbackProbes + (audit?.fallbackProbes ?? 0),
  unknownSpeed: sum.unknownSpeed + (audit?.unknownSpeed ?? 0),
  unresolvedCrossing: sum.unresolvedCrossing + (audit?.unresolvedCrossing ?? 0),
}), {
  probes: 0,
  hydroWater: 0,
  depthCompared: 0,
  driveWaterOverlap: 0,
  wetDisagreement: 0,
  fallbackProbes: 0,
  unknownSpeed: 0,
  unresolvedCrossing: 0,
});
if (!requestedWorlds.size) {
  ok('the representative matrix clears aggregate production cutover coverage',
    aggregate.probes >= 400
      && aggregate.hydroWater >= 75
      && aggregate.depthCompared >= 30
      && aggregate.driveWaterOverlap >= 1
      && aggregate.wetDisagreement === 0
      && aggregate.fallbackProbes === 0
      && aggregate.unknownSpeed === 0
      && aggregate.unresolvedCrossing === 0,
    aggregate);
}

console.log(bad ? `\n${bad} FAILED`
  : '\nall good — representative river, coast, terrain and crossing contacts agree');
if (bad) process.exitCode = 1;

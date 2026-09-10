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
const bridge = points.find((point) => point.crossing === 'bridge' && !point.fluid) ?? null;
const wet = points.find((point) => point.fluid && point.crossing === 'ford')
  ?? points.find((point) => point.fluid && point.crossing === null)
  ?? null;
ok('the explicit bridge keeps water below vehicle support',
  !!bridge && !bridge.fluid && bridge.depthAboveSupportM === null, bridge);
ok('field-native probe finds exposed vehicle fluid away from the bridge deck', !!wet, {
  count: points.length,
  first: points[0] ?? null,
});

if (wet) {
  await d.page.evaluate((point) => {
    window.__substrate?.('reset');
    window.__drive.x = point.x;
    window.__drive.z = point.z;
    window.__drive.speed = 2.5;
  }, wet);
}
await d.simWait(1.1);

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

report(d.errors);
await d.close();
if (d.errors.length) bad++;
console.log(bad ? `\n${bad} FAILED` : '\nall good — canonical water contact leaves persistent vehicle evidence');
if (bad) process.exitCode = 1;

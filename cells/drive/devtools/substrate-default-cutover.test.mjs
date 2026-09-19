/**
 * DEFAULT CONTACT CUTOVER + EXPLICIT ROLLBACK.
 *
 *   node cells/drive/devtools/substrate-default-cutover.test.mjs
 *
 * The ordinary production URL must consume canonical support/fluid contact AND
 * own the picture: `mode.ts`'s `default:` case is `render` now, so a default
 * that answered `contact` would be the cutover silently reverting. Both
 * rollbacks are exercised — `?substrate=contact` keeps the substrate on the
 * wheels with the legacy owners drawing, and `?substrate=legacy` goes further
 * back to the old consumer — and neither may disable the revisioned tile or
 * its independent parity shadow.
 *
 * THIS IS THE GATE THE DEFAULT FLIP HAD TO CORRECT, and it was nearly missed:
 * it lives beside the four render suites, all of which asked for the flag
 * explicitly and so could not have noticed which way the default pointed.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const ok = (name, condition, saw) => {
  if (!condition) bad++;
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${name}${condition ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const exercise = async (mode) => {
  const suffix = mode ? `&substrate=${mode}` : '';
  const d = await openDrive({
    spot: `fixture=at-senqu-ford&cam=chase&time=DAY${suffix}`,
    tag: `substrate-default-${mode || 'contact'}`,
    settle: 12000,
    bootTimeout: 90000,
  });
  // SETTLE ON THE QUANTITY, NOT ON A CLOCK. A fixed wait here is a coin toss
  // about tile arrival order and nothing else: measured at this fixture, one
  // boot answered 96 water points with 91 fluid and the next answered NONE
  // with `roads: 0, waters: 0, crossings: 0` on tiles that had been rebuilt
  // 149 times — in BOTH modes, so it is this fixture's construction and not
  // the render path's. Every assertion below rests on a loaded wet point, so
  // the wet point is what the gate waits for, and a run that never gets one
  // says so rather than reporting the world's arrival order as a cutover
  // failure.
  let wet = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await d.page.waitForTimeout(2500);
    wet = await d.page.evaluate(() =>
      (window.__substrateWaterPoints?.(96, 3000) ?? [])
        .find((point) => point.fluid) ?? null);
    if (wet) break;
  }
  if (!wet) console.log(`      ${mode || 'default'}: no loaded wet point in 90 s`);
  if (wet) {
    await d.page.evaluate((point) => {
      window.__substrate?.('reset');
      window.__drive.x = point.x;
      window.__drive.z = point.z;
      window.__drive.speed = 1.5;
    }, wet);
    await d.simWait(.7);
  }
  // Background surface/fluid consumers legitimately probe outside the loaded
  // terrain ring and are counted as explicit `no-tile` fallbacks. Isolate the
  // cutover assertion to the known loaded wet point: reset and exercise the
  // shipping surface, fluid and wheel-support wrappers in one browser task, so
  // no wildlife/frame query can enter between the calls and the snapshot.
  const state = await d.page.evaluate((point) => {
    window.__substrate?.('reset');
    if (point) {
      window.__waterinfo?.(point.x, point.z);
      window.__contact?.(point.x, point.z);
      window.__substrateParityProbe?.(point.x, point.z);
    }
    return {
      substrate: window.__substrate?.(),
      evidence: window.__waterEvidence?.(),
    };
  }, wet);
  report(d.errors);
  const errors = [...d.errors];
  await d.close();
  return { wet, state, errors };
};

const canonical = await exercise('');
ok('ordinary URLs default to the substrate owning contact AND the picture',
  canonical.state.substrate?.mode === 'render'
    && canonical.state.substrate?.contactAuthority === 'substrate-tile'
    && canonical.state.substrate?.renderAuthority === 'substrate-tile'
    && canonical.state.evidence?.authority === 'substrate',
  canonical);
ok('the default has a loaded tile and no consumer fallback',
  canonical.wet
    && canonical.state.substrate?.tiles?.tiles > 0
    && canonical.state.substrate?.contactAvailability?.queries > 0
    && canonical.state.substrate?.contactAvailability?.fallbackQueries === 0,
  canonical.state.substrate?.contactAvailability);

// The NEARER rollback: the substrate still answers the wheels and the legacy
// owners draw again. This is the one a seat report about the picture should
// reach for, and it is the control every render-path measurement is taken
// against, so it has to be shown to actually change who draws.
const contactRollback = await exercise('contact');
ok('contact hands the picture back without giving up canonical contact',
  contactRollback.state.substrate?.mode === 'contact'
    && contactRollback.state.substrate?.contactAuthority === 'substrate-tile'
    && contactRollback.state.substrate?.renderAuthority === 'hydro-system'
    && contactRollback.state.evidence?.authority === 'substrate'
    && !contactRollback.state.substrate?.rollback,
  contactRollback);

const rollback = await exercise('legacy');
ok('legacy query restores the old contact consumer',
  rollback.state.substrate?.mode === 'legacy'
    && rollback.state.substrate?.contactAuthority === 'legacy'
    && rollback.state.substrate?.rollback
    && rollback.state.evidence?.authority === 'legacy',
  rollback);
ok('rollback retains canonical tiles and independent shadow evidence',
  rollback.wet
    && rollback.state.substrate?.tiles?.tiles > 0
    && rollback.state.substrate?.last?.canonical?.fluid
    && rollback.state.substrate?.last?.legacy?.wet,
  rollback.state.substrate);

if (canonical.errors.length || contactRollback.errors.length || rollback.errors.length) bad++;
if (bad) {
  console.error(`\n${bad} FAILED`);
  process.exit(1);
}
console.log('\nall good — the substrate is the default authority, and both rollbacks remain observable');

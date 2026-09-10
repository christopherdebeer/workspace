/**
 * DEFAULT CONTACT CUTOVER + EXPLICIT ROLLBACK.
 *
 *   node cells/drive/devtools/substrate-default-cutover.test.mjs
 *
 * The ordinary production URL must consume canonical support/fluid contact.
 * `?substrate=legacy` must restore the old consumer without disabling the
 * revisioned tile or its independent parity shadow.
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
  await d.page.waitForTimeout(8000);
  const wet = await d.page.evaluate(() =>
    (window.__substrateWaterPoints?.(96, 3000) ?? [])
      .find((point) => point.fluid) ?? null);
  if (wet) {
    await d.page.evaluate((point) => {
      window.__substrate?.('reset');
      window.__drive.x = point.x;
      window.__drive.z = point.z;
      window.__drive.speed = 1.5;
    }, wet);
    await d.simWait(.7);
    await d.page.evaluate(() => window.__substrateParityProbe?.());
  }
  const state = await d.page.evaluate(() => ({
    substrate: window.__substrate?.(),
    evidence: window.__waterEvidence?.(),
  }));
  report(d.errors);
  const errors = [...d.errors];
  await d.close();
  return { wet, state, errors };
};

const canonical = await exercise('');
ok('ordinary URLs default to canonical contact',
  canonical.state.substrate?.mode === 'contact'
    && canonical.state.substrate?.contactAuthority === 'substrate-tile'
    && canonical.state.substrate?.renderAuthority === 'hydro-system'
    && canonical.state.evidence?.authority === 'substrate',
  canonical);
ok('default contact has a loaded tile and no consumer fallback',
  canonical.wet
    && canonical.state.substrate?.tiles?.tiles > 0
    && canonical.state.substrate?.contactAvailability?.queries > 0
    && canonical.state.substrate?.contactAvailability?.fallbackQueries === 0,
  canonical.state.substrate?.contactAvailability);

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

if (canonical.errors.length || rollback.errors.length) bad++;
if (bad) {
  console.error(`\n${bad} FAILED`);
  process.exit(1);
}
console.log('\nall good — canonical contact is default and legacy rollback remains observable');

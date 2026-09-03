/**
 * The regression this pins is the one that broke the first release run: an
 * unconfigured GitHub secret arrives as an empty string, and electron-builder
 * reads an empty CSC_LINK as a certificate path rather than as absence.
 *
 * The first case below asks electron-builder itself whether that is still
 * true, because the day it stops being true is the day this whole module can
 * go. It is written so that a dependency that renames or moves the entry point
 * reports "could not be checked" rather than a red build — the answer we want
 * from it is evidence, and a missing module is not evidence either way.
 */
import { strict as assert } from 'node:assert';
import { createRequire } from 'node:module';
import { signingEnv } from './signing-env.mjs';

const require = createRequire(import.meta.url);
const project = process.cwd();

try {
  const { importCertificate } = require('app-builder-lib/out/codeSign/codesign.js');
  await assert.rejects(
    () => importCertificate('', { getTempFile: async () => '/tmp/unused.p12' }, project),
    (error) => /not a file/.test(error.message),
    'electron-builder should still reject an empty CSC_LINK as a bad path',
  );
  console.log('ok: an empty CSC_LINK is still a build failure in electron-builder');
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  console.log('skip: electron-builder internals moved; the hazard could not be checked');
}

// The workflow shape that caused it: every signing variable present, all empty.
const ci = signingEnv({
  PATH: '/usr/bin',
  CSC_LINK: '',
  CSC_KEY_PASSWORD: '',
  APPLE_ID: '',
  APPLE_APP_SPECIFIC_PASSWORD: '',
  APPLE_TEAM_ID: '',
});
for (const name of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
  assert.equal(name in ci, false, `${name} should be absent, not empty`);
}
assert.equal(ci.PATH, '/usr/bin', 'unrelated variables must survive');
assert.equal(ci.CSC_IDENTITY_AUTO_DISCOVERY, 'false');
console.log('ok: blank signing secrets are removed and discovery is off');

// A configured certificate must pass through untouched, and must NOT have
// discovery forced off underneath it.
const signed = signingEnv({ CSC_LINK: 'https://example.test/drive.p12', CSC_KEY_PASSWORD: 'hunter2' });
assert.equal(signed.CSC_LINK, 'https://example.test/drive.p12');
assert.equal(signed.CSC_KEY_PASSWORD, 'hunter2');
assert.equal(signed.CSC_IDENTITY_AUTO_DISCOVERY, undefined);
console.log('ok: a configured certificate is left alone');

// An identity named in the runner's keychain counts as configured too.
assert.equal(signingEnv({ CSC_NAME: 'Developer ID Application: someone' }).CSC_IDENTITY_AUTO_DISCOVERY, undefined);
// And an explicit choice is never overridden.
assert.equal(signingEnv({ CSC_IDENTITY_AUTO_DISCOVERY: 'true' }).CSC_IDENTITY_AUTO_DISCOVERY, 'true');
console.log('ok: discovery is only forced off when nothing else can name an identity');

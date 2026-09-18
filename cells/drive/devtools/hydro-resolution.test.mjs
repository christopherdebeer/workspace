/**
 * HYDRO SHORELINE RESOLUTION / COST GATE.
 *
 *   node cells/drive/devtools/hydro-resolution.test.mjs
 *
 * Measures the production-sized 2.4km tile at the current 128 field and the
 * proposed 256 tier. The gate requires materially lower bank-position error
 * while bounding the expected fourfold field memory and build-cost growth.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'hydro-resolution-'));
const built = join(tmp, 'hydro-resolution-test.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/hydro/resolution.test.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`],
{ cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { runHydroResolutionTest } = await import(pathToFileURL(built).href);

try {
  const results = runHydroResolutionTest();
  for (const result of results) {
    console.log(`ok    ${result.resolution}² field — `
      + `${result.meanBuildMs.toFixed(1)}ms, ${result.fieldMiB.toFixed(2)}MiB, `
      + `${result.meanBankErrorM.toFixed(2)}m mean bank error`);
  }
  console.log('\nall good — higher shoreline sampling buys measured bank fidelity');
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
}

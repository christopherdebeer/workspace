/**
 * HYDRO PIPELINE TESTS — no browser, no renderer, no truck.
 *
 *   node cells/drive/devtools/hydro.test.mjs
 *
 * The module has carried `runHydroSelfTest` since it was written, and nothing
 * ever ran it — a self-test nobody invokes is documentation that can rot.
 * Same route as climate.test.mjs: esbuild compiles the shipping module on the
 * spot, so the code under test is the code the game runs.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'hydro-'));
const built = join(tmp, 'hydro-test.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/hydro/hydro.test.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`],
{ cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { runHydroSelfTest } = await import(pathToFileURL(built).href);

try {
  runHydroSelfTest();
  console.log('ok    hydro self-test — fields, spine, river space, spans');
  console.log('\nall good');
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
}

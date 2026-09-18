/**
 * HYDRO RENDER REVISION / IDENTITY GATE.
 *
 *   node cells/drive/devtools/hydro-render-cutover.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'hydro-render-cutover-'));
const built = join(tmp, 'hydro-render-cutover-test.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/hydro/render-cutover.test.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`],
{ cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { runHydroRenderCutoverTest } = await import(pathToFileURL(built).href);

try {
  await runHydroRenderCutoverTest();
  console.log('ok    hydro render cutover — deferred commit, revision and identity lock');
  console.log('\nall good');
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
}

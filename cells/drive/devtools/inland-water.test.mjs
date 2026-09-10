/**
 * The inland-water tracer's self-test, run in node:
 *   node cells/drive/devtools/inland-water.test.mjs
 * Bundled with esbuild the way hydro.test.mjs is, so the TypeScript needs no
 * loader.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'inland-'));
const built = join(tmp, 'inland-water-test.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/inland-water.test.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`],
{ cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { runInlandWaterSelfTest } = await import(pathToFileURL(built).href);

try {
  runInlandWaterSelfTest();
  console.log('ok    inland-water self-test — components, rings, holes, corners, shaping');
  console.log('\nall good');
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
}

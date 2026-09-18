/**
 * THE COAST FIELD: travel time from the waterline over the bathymetry, the
 * seaward direction and exposure — solved, monotone, refracting, sheltered.
 *
 *   node cells/drive/devtools/hydro-coast.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'hydro-coast-'));
const built = join(tmp, 'hydro-coast-test.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/hydro/coast-field.test.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`],
{ cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { runCoastFieldTest } = await import(pathToFileURL(built).href);

try {
  runCoastFieldTest();
  console.log('ok    coast field — travel time, refraction, direction, exposure, the tile build');
  console.log('\nall good');
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
}

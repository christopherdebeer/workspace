/**
 * HYDRO FLOWING-FIELD RESOLUTION / COVERED-SHARE GATE.
 *
 *   node cells/drive/devtools/hydro-flowing-share.test.mjs
 *
 * `flowingFieldResolution` used to fire on any river/stream/canal
 * OBSERVATION in the tile at all — a fourfold grid for a river that merely
 * clips a corner (Yosemite: ~4 texels in a thousand), same as for one that
 * fills the frame. This holds the replacement: the tier is sized from a
 * cheap pre-build estimate of the covered SHARE (`estimateFlowingCoverageShare`
 * in build-tile.ts), so a thread pays close to nothing extra and only a
 * river approaching `FLOWING_FULL_SHARE` earns the full tier.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'hydro-flowing-share-'));
const built = join(tmp, 'hydro-flowing-share-test.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/hydro/flowing-share.test.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`],
{ cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { runHydroFlowingShareTest } = await import(pathToFileURL(built).href);

try {
  await runHydroFlowingShareTest();
  console.log('ok    hydro flowing-field resolution — sized from the covered share');
  console.log('\nall good');
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
}

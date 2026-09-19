import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'world-authoring-raster-'));
const built = join(tmp, 'world-authoring-raster-test.mjs');

execFileSync('npx', [
  'esbuild',
  join(HERE, '../client/world-authoring-raster.test.ts'),
  '--bundle',
  '--format=esm',
  `--outfile=${built}`,
], { cwd: join(HERE, '../../..'), stdio: 'pipe' });

const { runWorldAuthoringRasterSelfTest } = await import(pathToFileURL(built).href);
try {
  runWorldAuthoringRasterSelfTest();
  console.log('ok    world authoring raster — cross-tile paint, stroke undo and reset');
  console.log('\nall good');
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
}

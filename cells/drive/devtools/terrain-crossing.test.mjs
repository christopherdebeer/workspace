import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'terrain-crossing-'));
const built = join(tmp, 'terrain-crossing-test.mjs');

execFileSync('npx', [
  'esbuild',
  join(HERE, '../client/terrain-crossing.test.ts'),
  '--bundle',
  '--format=esm',
  `--outfile=${built}`,
], {
  cwd: join(HERE, '../../..'),
  stdio: 'pipe',
});

const { runTerrainCrossingSelfTest } = await import(pathToFileURL(built).href);
try {
  runTerrainCrossingSelfTest();
  console.log('ok    terrain crossing self-test — open channels and solid causeway fill');
  console.log('\nall good');
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
}

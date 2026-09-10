/**
 * JOINT ROAD / TERRAIN / WATER KERNEL — no browser and no renderer.
 *
 *   node cells/drive/devtools/substrate.test.mjs
 *
 * esbuild compiles the shipping TypeScript module on the spot. The integrated
 * lab imports the same kernel and fixture builder.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'substrate-'));
const built = join(tmp, 'substrate-test.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/substrate/substrate.test.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`],
{ cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { runSubstrateSelfTest } = await import(pathToFileURL(built).href);

try {
  runSubstrateSelfTest();
  console.log('ok    substrate self-test — layered crossings, support, fluid, flow');
  console.log('\nall good');
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
}

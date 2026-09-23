/**
 * The filmic curve and authored decisions, without a browser.
 *
 *   node cells/drive/devtools/filmic-grade.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'filmic-grade-'));
const built = join(tmp, 'filmic-grade.test.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/filmic-grade.test.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`],
{ cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { runFilmicGradeSelfTest } = await import(pathToFileURL(built).href);

try {
  runFilmicGradeSelfTest();
  console.log('ok    filmic grade — dawn/noon CDL held, ACES shoulder monotonic, highlights below clip');
  console.log('\nall good');
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
}

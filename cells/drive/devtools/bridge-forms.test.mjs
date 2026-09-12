/**
 * The bridge painter, over authored decks.
 *
 *   node cells/drive/devtools/bridge-forms.test.mjs
 *
 * Pure node: esbuild the module and run it. What it holds is what each
 * family must stand up from a deck and a spec — where the towers go, how
 * tall, that a twin carriageway gets one tower between its decks and not
 * two beside them, that an authored station only fixes the position along
 * the bridge, that a suspension cable sags and a through arch rises, and
 * that a girder paints nothing at all.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'bridgeforms-'));
const built = join(tmp, 'bridge-forms.test.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/bridge-forms.test.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`],
{ cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { runBridgeFormsSelfTest } = await import(pathToFileURL(built).href);

try {
  runBridgeFormsSelfTest();
  console.log('ok    bridge-forms — tags name the family, towers stand at the stations and between twin decks, cables sag, arches rise, a girder paints nothing');
  console.log('\nall good');
} catch (e) {
  console.log('FAIL ', e.message);
  process.exit(1);
}

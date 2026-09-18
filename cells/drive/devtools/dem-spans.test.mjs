/**
 * The bridge-deck repair, over authored rasters.
 *
 *   node cells/drive/devtools/dem-spans.test.mjs
 *
 * Pure node: esbuild the module and run it. What it holds is the set of
 * confusions that would each be a visible fault in the world — a hill trenched
 * because the rule read the tile's low ground instead of the deck's own sides,
 * an embankment flattened because nothing checked that the walk gets off the
 * structure, a cutting filled because a lowering rule was written as an
 * assignment — and, from the seat's own photograph of the Pont de Normandie,
 * a deck the cover calls water (every texel of an estuary span is class 80,
 * so the first step off the deck must not count as the bed), a pylon's foot
 * wider than the reach, and the lake behind a dam that the flank fill must
 * never cross into.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'demspans-'));
const built = join(tmp, 'dem-spans.test.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/dem-spans.test.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`],
{ cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { runDemSpanSelfTest } = await import(pathToFileURL(built).href);

try {
  runDemSpanSelfTest();
  console.log('ok    dem-spans — deck cleared, hill kept, embankment refused, cutting left alone, the water-called deck and the pylon blob down, the dam held');
  console.log('\nall good');
} catch (error) {
  console.error(`FAIL  ${error.message}`);
  process.exit(1);
}

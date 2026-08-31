/**
 * The shipped solver, compiled for the bench.
 *
 * Built from `client/roadprofile.ts` on the spot rather than copied, so the
 * bench can never drift into measuring a fork of the thing it is meant to be
 * measuring. This is the same trick roadsolve.test.mjs uses and for the same
 * reason.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../..');
const tmp = mkdtempSync(join(tmpdir(), 'roadbench-'));
const built = join(tmp, 'roadprofile.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../../client/roadprofile.ts'), '--bundle',
  '--format=esm', `--outfile=${built}`], { cwd: ROOT, stdio: 'pipe' });
export const { solveChain, latCands, chosenOffsets, benchFlat, ruleGrade,
  BENCH_OFFS, BENCH_K, BENCH_C, WEIGHTS } = await import(pathToFileURL(built).href);

/**
 * How big is a wide overview tile, rung by rung?
 *
 *   node cells/drive/devtools/ov-wide-size.mjs
 *
 * The vector chart stops at z5 while the cover ladder reaches z2 and the far
 * shell z3, so a chart wider than ~2,500km has no map under it at all. Before
 * lowering the floor, the question is what a z4, z3 or z2 tile WEIGHS: one
 * z2 tile is a sixteenth of the planet, and the rank cut is the only thing
 * between that and every road Natural Earth knows.
 *
 * Runs the shipping bake and the shipping trim, over the tiles that cover a
 * few real places, and reports elements and gzipped bytes.
 */
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
// Built INSIDE the cell so `__dirname` lands where the asset is: ne-wide.ts
// reads `static/ne-wide.b64` relative to itself, and a bundle in /tmp cannot
// see it.
const tmp = join(HERE, '..');
const built = join(tmp, '.ov-wide-probe.mjs');
// `__dirname` does not exist in an ESM bundle, and ne-wide.ts resolves its
// asset against it — undefined there means the loader throws, latches the
// failure and answers null for ever after. Defined here as the cell's own
// directory, which is what it is inside the Lambda.
const CELL = join(HERE, '..');
execFileSync('npx', ['esbuild', join(HERE, '../ne-wide.ts'), '--bundle', '--platform=node',
  '--format=esm', '--external:node:*', `--define:__dirname=${JSON.stringify(CELL)}`,
  `--outfile=${built}`], { cwd: join(HERE, '../../..'), stdio: 'pipe' });
const idx = join(tmp, '.ov-wide-index.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../index.ts'), '--bundle', '--platform=node',
  '--format=esm', '--external:node:*', '--external:@aws-sdk/*',
  `--define:__dirname=${JSON.stringify(CELL)}`, `--outfile=${idx}`],
{ cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { neWideTile, neWide, neWideError, NE_SCALERANK, NE_PLACE_RANK } = await import(pathToFileURL(built).href);
const set = neWide();
console.log('asset', set ? `${set.lines.length} lines · ${set.places.length} places · ${(set.bytes / 1048576).toFixed(2)}MB in ${set.ms}ms` : 'MISSING: ' + neWideError());
const { trimOverview } = await import(pathToFileURL(idx).href);

const tileOf = (lat, lon, z) => {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return [Math.floor(((lon + 180) / 360) * n),
    Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)];
};
const PLACES = [['Europe', 49.4, 0.28], ['California', 37.8, -122.5],
  ['Cape', -33.9, 18.4], ['Pacific', 0, -150], ['Himalaya', 28, 85]];

console.log('rank cuts  scalerank', JSON.stringify(NE_SCALERANK), ' place', JSON.stringify(NE_PLACE_RANK));
console.log('z    place        tile        ways    trimmed  gzip KB');
for (const z of [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]) {
  for (const [nm, la, lo] of PLACES) {
    const [x, y] = tileOf(la, lo, z);
    const t0 = Date.now();
    const raw = neWideTile(z, x, y);
    if (!raw) { console.log(String(z).padEnd(5), nm.padEnd(12), 'no asset'); continue; }
    const trimmed = trimOverview(raw, z);
    const gz = gzipSync(Buffer.from(JSON.stringify({ v: 1, z, x, y, ways: trimmed }), 'utf8'), { level: 9 });
    console.log(String(z).padEnd(5), nm.padEnd(12), `${x}/${y}`.padEnd(11),
      String(raw.length).padEnd(7), String(trimmed.length).padEnd(8),
      (gz.length / 1024).toFixed(1).padStart(7), `  ${Date.now() - t0}ms`);
  }
}
rmSync(built, { force: true });
rmSync(idx, { force: true });

/**
 * The proxy's relation ring assembly, run in node:
 *   node cells/drive/devtools/osm-rings.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'rings-'));
const built = join(tmp, 'osm-rings.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../osm-rings.ts'),
  '--bundle', '--format=esm', '--platform=node', `--outfile=${built}`],
{ cwd: join(HERE, '../../..'), stdio: 'pipe' });
const { assembleRelationRings, joinWays } = await import(pathToFileURL(built).href);

const g = (...pts) => pts.map(([lat, lon]) => ({ lat, lon }));
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'ok   ' : 'FAIL '} ${msg}`); if (!cond) failed++; };

// A square split into two outer ways, the second reversed, plus an inner ring.
const members = [
  { type: 'way', role: 'outer', geometry: g([0, 0], [0, 10], [10, 10]) },
  { type: 'way', role: 'outer', geometry: g([0, 0], [10, 0], [10, 10]) },      // runs the other way
  { type: 'way', role: 'inner', geometry: g([4, 4], [4, 6], [6, 6], [6, 4], [4, 4]) },
  { type: 'node', ref: 1 },
];
const rings = assembleRelationRings(members);
ok(rings && rings.length === 1, `one polygon (${rings?.length})`);
ok(rings && rings[0].outer.length === 5 && rings[0].outer[0][0] === rings[0].outer[4][0], 'outer ring closed with five points');
ok(rings && rings[0].holes.length === 1, `inner ring became a hole (${rings?.[0].holes.length})`);

// An open chain does not close: nothing is invented.
const open = assembleRelationRings([{ type: 'way', role: 'outer', geometry: g([0, 0], [0, 10], [10, 10]) }]);
ok(open === null, 'an open outer yields null');

// Two separate outers, the hole lands in the right one.
const two = assembleRelationRings([
  { type: 'way', role: 'outer', geometry: g([0, 0], [0, 1], [1, 1], [1, 0], [0, 0]) },
  { type: 'way', role: 'outer', geometry: g([5, 5], [5, 9], [9, 9], [9, 5], [5, 5]) },
  { type: 'way', role: 'inner', geometry: g([6, 6], [6, 7], [7, 7], [7, 6], [6, 6]) },
]);
ok(two && two.length === 2 && two[1].holes.length === 1 && two[0].holes.length === 0, 'hole sorted into the outer that contains it');

// The cap drops the giant instead of truncating it.
const big = assembleRelationRings([{ type: 'way', role: 'outer', geometry: g(...Array.from({ length: 7000 }, (_, i) => [i, 0])) }]);
ok(big === null, 'a relation over the point cap is dropped');

// joinWays: a way given twice is used once.
ok(joinWays([[[0, 0], [0, 1], [1, 1], [0, 0]], [[0, 0], [0, 1], [1, 1], [0, 0]]]).length === 2, 'two closed ways are two rings');

console.log(failed ? `\n${failed} failed` : '\nall good');
process.exit(failed ? 1 : 0);

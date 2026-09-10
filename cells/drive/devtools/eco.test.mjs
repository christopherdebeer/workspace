/**
 * THE ECOREGION LOOKUP, IN NODE, IN A SECOND.
 *
 * Two halves, and they answer different questions:
 *
 *  - the UNIT half drives `decodeEcoTile`/`ecoLookup` over authored geometry —
 *    a hole, a multipolygon, a vertex sitting exactly on the eastward ray, a
 *    point on the far side of a bounding box that overlaps. No network, so it
 *    can never be skipped and never be flaky.
 *  - the LIVE half asks the deployed cell for the tiles under the climate
 *    fixture sites and checks that the region returned is the one a botanist
 *    would name. That is the whole value of the dataset — the Cape has to come
 *    back FYNBOS and not "Mediterranean scrub" — and it is a network test, so
 *    it says SKIP out loud rather than passing quietly when the tiles refuse.
 *
 * The module is bundled with esbuild and imported, the route `culture.test.mjs`
 * takes: seconds, no browser, no harness, and it drives the SHIPPING code.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const out = mkdtempSync(join(tmpdir(), 'eco-'));
const bundle = join(out, 'eco.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/eco.ts'),
  '--bundle', '--format=esm', `--outfile=${bundle}`, '--log-level=error'], { stdio: 'inherit' });
const { decodeEcoTile, ecoLookup, ecoTileOf, ecoBiomeName } = await import(bundle);

let fails = 0;
const ok = (cond, what) => { console.log(`${cond ? 'ok   ' : 'FAIL '} ${what}`); if (!cond) fails++; };

// ── the unit half ─────────────────────────────────────────────────────────
// A square with a square hole in it, and a second disjoint square, as one
// MultiPolygon — every structural case in one feature.
const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const authored = {
  v: 1,
  regions: [{
    id: 1, biome: 12, name: 'Authored', realm: 'XX',
    g: {
      type: 'MultiPolygon',
      coordinates: [
        [sq(0, 0, 10, 10), sq(4, 4, 6, 6)],   // outer with a hole
        [sq(20, 0, 30, 10)],                  // a disjoint lobe
      ],
    },
  }],
};
const A = decodeEcoTile(authored);
ok(A.length === 1 && A[0].polys.length === 2, 'a multipolygon decodes to its lobes');
ok(A[0].polys[0].holes.length === 1, 'and the hole rides with its outer ring');
ok(ecoLookup(A, 2, 2)?.name === 'Authored', 'a point inside the outer ring hits');
ok(ecoLookup(A, 5, 5) === null, 'a point inside the hole does not');
ok(ecoLookup(A, 25, 5)?.name === 'Authored', 'the disjoint lobe hits too');
ok(ecoLookup(A, 15, 5) === null, 'the gap between the lobes is inside the bbox and outside the region');
ok(ecoLookup(A, -1, 5) === null, 'and west of everything is a bbox reject');
// The ray leaves the point eastward, so a vertex ON that latitude is the
// classic double-count. Both of these lie exactly on an authored vertex row.
ok(ecoLookup(A, 2, 0) !== null || ecoLookup(A, 2, 10) !== null, 'an edge is not a hole');
ok(ecoLookup(A, 2, 4) !== null, 'a point on the hole\'s own latitude, west of it, is still inside');
ok(decodeEcoTile(null).length === 0 && decodeEcoTile({}).length === 0, 'an empty payload decodes to nothing');
ok(decodeEcoTile({ regions: [{ id: 2, biome: 1, name: 'Bad', g: { type: 'Polygon', coordinates: [[[0, 0]]] } }] }).length === 0,
  'a region whose geometry will not parse is dropped, not thrown');
ok(ecoBiomeName(12).startsWith('Mediterranean') && ecoBiomeName(99) === 'unclassified', 'biome numbers name themselves');

// The tile arithmetic, against the numbers the cell route serves.
ok(String(ecoTileOf(-34.05, 18.35)) === '17,19', 'the Cape is z5 17/19');
ok(String(ecoTileOf(37.75, -119.6)) === '5,12', 'Yosemite is z5 5/12');
ok(String(ecoTileOf(46.02, 7.75)) === '16,11', 'Zermatt is z5 16/11');

// ── the live half ─────────────────────────────────────────────────────────
const BASE = process.env.DRIVE_CELL ?? 'https://c15r-drive.on.parc.land';
const SITES = [
  ['the Cape', -34.05, 18.35, /fynbos/i],
  ['Yosemite', 37.75, -119.6, /sierra nevada/i],
  ['Zermatt', 46.02, 7.75, /alps/i],
  ['Tamanrasset', 22.79, 5.53, /sahara/i],
  ['Manaus', -3.1, -60.02, /solim\u00f5es-negro/i],
];
const tiles = new Map();
let net = true;
for (const [name, lat, lon, want] of SITES) {
  const [tx, ty] = ecoTileOf(lat, lon);
  const key = `${tx}/${ty}`;
  if (!tiles.has(key)) {
    try {
      const res = await fetch(`${BASE}/~/eco/v1/5/${tx}/${ty}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      tiles.set(key, decodeEcoTile(await res.json()));
    } catch (err) {
      console.log(`SKIP  ${name}: the cell would not serve 5/${key} (${err.message})`);
      net = false;
      continue;
    }
  }
  const regs = tiles.get(key);
  const t0 = performance.now();
  let hit = null;
  for (let i = 0; i < 200; i++) hit = ecoLookup(regs, lon, lat);
  const us = ((performance.now() - t0) / 200) * 1000;
  console.log(`      ${name}: ${hit ? `${hit.name} [${ecoBiomeName(hit.biome)}]` : 'NO REGION'}`
    + ` · ${regs.length} regions in the tile · ${us.toFixed(0)}us a lookup`);
  ok(hit !== null && want.test(hit.name), `${name} names its own ecoregion`);
  ok(us < 2000, `${name} answers in under 2ms`);
}
// The commonest tile on earth: mid-ocean, a real empty answer.
try {
  const [tx, ty] = ecoTileOf(-30, -140);
  const res = await fetch(`${BASE}/~/eco/v1/5/${tx}/${ty}`);
  const regs = decodeEcoTile(await res.json());
  ok(ecoLookup(regs, -140, -30) === null, 'the South Pacific has no terrestrial ecoregion');
} catch (err) {
  console.log(`SKIP  open ocean: ${err.message}`);
  net = false;
}
if (!net) console.log('\nNOTE: part of the live half was skipped — that is not a pass.');
console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);

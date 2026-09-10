/** Resolve a list of candidate lab places against the LIVE ecoregion tiles —
 *  the same route the game streams — so the flora lab's table is a record of
 *  what is there and not a plausible invention. */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));

const out = mkdtempSync(join(tmpdir(), 'ecop-'));
const bundle = join(out, 'eco.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/eco.ts'),
  '--bundle', '--format=esm', `--outfile=${bundle}`, '--log-level=error'], { stdio: 'inherit' });
const { decodeEcoTile, ecoLookup, ecoTileOf, ecoBiomeName } = await import(bundle);
const BASE = 'https://c15r-drive.on.parc.land';

const SITES = [
  ['CAPE PENINSULA', -34.0958, 18.3602, 300],
  ['BIG SUR',         36.3752, -121.9048, 356],
  ['SERENGETI',       -2.3333, 34.8333, 1500],
  ['SUNDARBANS',      21.9500, 89.1800, 2],
  ['YOSEMITE',        37.7500, -119.5900, 1900],
  ['AMAZON',          -3.1000, -60.0200, 60],
  ['SAHARA',          22.7900, 5.5300, 1380],
  ['ALPS',            46.0200, 7.7500, 1600],
  ['PARIS',           48.8000, 2.2000, 100],
  ['SIBERIAN TAIGA',  62.0000, 105.0000, 400],
  ['AUSTRALIAN OUTBACK', -25.0000, 133.0000, 400],
  ['YAMAL TUNDRA',    68.0000, 70.0000, 40],
  ['SONORAN DESERT',  32.2500, -111.1600, 750],
  ['BORNEO',          1.5000, 113.5000, 300],
  ['PATAGONIAN STEPPE', -47.0000, -70.5000, 500],
  ['GREAT PLAINS',    41.5000, -100.5000, 900],
  ['KAKADU',          -12.8500, 132.4000, 30],
  ['NEW ZEALAND FIORD', -44.6700, 167.9200, 300],
];
const tiles = new Map();
for (const [name, lat, lon, elev] of SITES) {
  const [tx, ty] = ecoTileOf(lat, lon);
  const key = `${tx}/${ty}`;
  if (!tiles.has(key)) {
    try {
      const res = await fetch(`${BASE}/~/eco/v1/5/${tx}/${ty}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      tiles.set(key, decodeEcoTile(await res.json()));
    } catch (err) { console.log(`SKIP ${name}: ${err.message}`); continue; }
  }
  const hit = ecoLookup(tiles.get(key), lon, lat);
  if (!hit) { console.log(`NONE ${name} (${lat},${lon}) — no terrestrial ecoregion, drop it`); continue; }
  console.log(`  { label: '${name}', lat: ${lat}, lon: ${lon}, elev: ${elev},`);
  console.log(`    eco: { id: ${hit.id}, biome: ${hit.biome}, name: ${JSON.stringify(hit.name)}, realm: '${hit.realm}' } },   // ${ecoBiomeName(hit.biome)}`);
}

/**
 * THE FOOTPRINT CENSUS OVER THE SHIPPED CAPTURES — no browser, no network.
 *
 *   node cells/drive/devtools/building-census.mjs [world-*.json …]
 *
 * Runs `client/morphology.ts` — the SAME module `__bldcensus()` runs in the
 * game — over `static/fixtures/`, and prints the morphology beside the tag
 * vocabulary. This is the table the building work is planned against: what
 * the footprints can say (attachment, runs, plots, grid) against what the
 * tags cannot (a `building=yes` on three quarters of everything).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const FIX = join(HERE, '../static/fixtures');
const cache = join(ROOT, 'node_modules/.cache');
mkdirSync(cache, { recursive: true });
const built = join(cache, 'drive-morphology.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/morphology.ts'), '--bundle', '--format=esm',
  `--outfile=${built}`], { cwd: ROOT, stdio: 'pipe' });
const { morphology } = await import(pathToFileURL(built).href);

const files = process.argv.slice(2).length ? process.argv.slice(2)
  : readdirSync(FIX).filter((f) => f.startsWith('world-') && f.endsWith('.json'));
const pad = (s, n) => String(s).padStart(n);
console.log('capture                    n  attached   runs  med  max     p25   p50   p75   p95 m²   grid   modal°   kinds (top 4)');
const all = { kinds: {}, tags: {}, n: 0 };
for (const f of files) {
  const j = JSON.parse(readFileSync(join(FIX, f), 'utf8'));
  const ways = (j.ways ?? []).filter((w) => w.tags?.building && Array.isArray(w.pts) && w.pts.length >= 3);
  if (!ways.length) { console.log(`${f.padEnd(24)}     0  (no buildings)`); continue; }
  const m = morphology(ways.map((w) => ({ id: w.id, pts: w.pts })));
  const s = m.summary;
  const kinds = {};
  for (const w of ways) {
    kinds[w.tags.building] = (kinds[w.tags.building] ?? 0) + 1;
    all.kinds[w.tags.building] = (all.kinds[w.tags.building] ?? 0) + 1;
    for (const k of Object.keys(w.tags)) all.tags[k] = (all.tags[k] ?? 0) + 1;
    all.n++;
  }
  const top = Object.entries(kinds).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ');
  console.log(`${f.replace('world-', '').replace('.json', '').padEnd(24)}${pad(s.n, 6)}${pad((100 * s.attachedShare).toFixed(0) + '%', 9)}`
    + `${pad(s.runs, 7)}${pad(s.runMedian, 5)}${pad(s.runMax, 5)}   ${s.areaQ.map((a) => pad(Math.round(a), 5)).join(' ')}`
    + `${pad((100 * s.gridCoherence).toFixed(0) + '%', 8)}${pad(s.modalAng.toFixed(1), 8)}   ${top}`);
}
const pct = (v) => `${(100 * v / all.n).toFixed(1)}%`;
console.log(`\n${all.n} footprints. kinds: ${Object.entries(all.kinds).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${pct(v)}`).join(' · ')}`);
const want = ['building:levels', 'height', 'roof:shape', 'roof:levels', 'building:material', 'building:colour', 'roof:colour', 'amenity', 'shop', 'name', 'start_date', 'historic'];
console.log(`tags: ${want.map((k) => `${k} ${pct(all.tags[k] ?? 0)}`).join(' · ')}`);

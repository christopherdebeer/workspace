/**
 * THE PEAK TILES: what the route keeps, and what it refuses.
 *
 *   node cells/drive/devtools/peaks.test.mjs [--live]
 *
 * `parseEle` and `trimPeaks` are the whole contract of the layer — OSM `ele`
 * is free text, and the cap is what keeps an Alpine tile from being a
 * megabyte. Those run offline. `--live` also asks the real Overpass for two
 * real tiles: Big Sur (sparse, 151 summits) and Mont Blanc (dense, 7268), the
 * two ends of the density problem this layer exists to survive.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'peaks-'));
const out = join(dir, 'index.cjs');
execSync(`npx esbuild cells/drive/index.ts --bundle --platform=node --format=cjs --external:@aws-sdk/* --outfile=${out}`,
  { stdio: 'pipe', cwd: process.cwd() });
const { parseEle, trimPeaks, handler } = await import(out);

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// ── ele, which is free text and behaves like it ──
for (const [raw, want] of [
  ['1234', 1234], ['1234.5', 1234.5], ['1234 m', 1234], [' 4807.3 ', 4807.3],
  ['4,808', 4808], ['-86', -86],            // Badwater is a real place
  ['8849', 8849],                            // Everest, and the ceiling is just above it
  ['8900', null],                            // above the roof of the world: not metres
  ['12000', null],                           // feet, unmarked — refused rather than guessed
  ['about 300', null], ['', null], [undefined, null],
]) check(`ele ${JSON.stringify(raw)} -> ${want}`, parseEle(raw) === want, parseEle(raw));

// ── the cap keeps the TALLEST, which is what a landmark layer needs ──
const many = Array.from({ length: 400 }, (_, i) => ({
  type: 'node', lat: 46 + i * 1e-4, lon: 8 + i * 1e-4, tags: { name: `P${i}`, ele: String(1000 + i) },
}));
const trimmed = trimPeaks(many);
check('cap applied', trimmed.length === 150, trimmed.length);
check('tallest kept', trimmed[0].e === 1399, trimmed[0]);
check('sorted descending', trimmed.every((p, i) => i === 0 || trimmed[i - 1].e >= p.e), true);
check('nameless dropped', trimPeaks([{ type: 'node', lat: 1, lon: 1, tags: { ele: '900' } }]).length === 0, null);
check('ele-less dropped', trimPeaks([{ type: 'node', lat: 1, lon: 1, tags: { name: 'X' } }]).length === 0, null);
check('coords rounded to 5dp', trimPeaks([{ type: 'node', lat: 46.123456789, lon: 8.1, tags: { name: 'X', ele: '900' } }])[0].la === 46.12346, null);

// ── the route's own guards ──
const call = (p) => handler({ rawPath: p, requestContext: { http: { method: 'GET' } } });
for (const [name, path] of [
  ['wrong zoom refused', '/~/osm/peak1/9/1/1'],
  ['x out of range refused', '/~/osm/peak1/7/9999/1'],
]) {
  const r = await call(path);
  check(name, r.statusCode === 400, r.statusCode);
}

// ── the two ends of the density problem ──
if (process.argv.includes('--live')) {
  for (const [name, x, y] of [['big sur', 20, 50], ['mont blanc', 66, 45]]) {
    const t0 = Date.now();
    const r = await call(`/~/osm/peak1/7/${x}/${y}`);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    if (r.statusCode !== 200) { console.log(`skip  ${name}: upstream said ${r.statusCode} (${secs}s)`); continue; }
    const j = JSON.parse((await import('node:zlib')).gunzipSync(Buffer.from(r.body, 'base64')).toString());
    const kb = (Buffer.from(r.body, 'base64').length / 1024).toFixed(1);
    check(`${name}: within the cap`, j.peaks.length <= 150, j.peaks.length);
    check(`${name}: tallest first`, j.peaks.every((p, i) => i === 0 || j.peaks[i - 1].e >= p.e), true);
    console.log(`      ${name}: ${j.peaks.length} summits, ${kb}KB gz, ${secs}s, top = ${j.peaks[0]?.n} ${j.peaks[0]?.e}m`);
  }
}

rmSync(dir, { recursive: true, force: true });
console.log(bad ? `\n${bad} FAILED` : '\nall good');
process.exitCode = bad ? 1 : 0;

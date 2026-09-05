/**
 * DISTANCE TO THE SEA, BAKED ONCE FOR THE WHOLE WORLD.
 *
 *   node cells/drive/devtools/bake-coast.mjs
 *
 * Continentality is the difference between Reykjavik and Irkutsk — twelve
 * degrees of latitude apart and thirty of annual range — and the site model
 * cannot compute it, only look it up. The lookup has to work at four hundred
 * kilometres, which is the one scale nothing the game streams can answer: the
 * fine ring reaches five kilometres and the chart's overview forty-seven.
 *
 * So it is a static asset. Natural Earth's 110m land polygons (127 features,
 * 5143 vertices, 138KB) rasterised to a half-degree land mask, then distance-
 * transformed to the nearest sea cell and stored as one byte a cell.
 *
 * ── WHY HALF A DEGREE, AND WHY ONE BYTE ──
 *
 * The e-folding is 400km, so a 55km cell is a twentieth of the thing being
 * measured — precision far beyond what the answer is used for. And the byte is
 * SQRT-SCALED rather than linear: what matters is the ratio d/400km, so the
 * resolution should be fine where the number is small and coarse where it is
 * large. Square-rooted over a 3000km range that is half a kilometre per step
 * at the coast and twelve at the far interior, which is the right way round.
 *
 * ── THE TRANSFORM IS ANISOTROPIC, BECAUSE THE GRID IS ──
 *
 * An equirectangular cell is 55.6km tall everywhere and 55.6·cos(lat) wide, so
 * a chamfer pass in CELLS would report a Siberian cell as far from the sea as
 * an equatorial one at the same column count. The horizontal step cost is
 * computed per row, and longitude wraps, because the world does.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson';
const STEP = 0.5;                    // degrees per cell
const W = Math.round(360 / STEP), H = Math.round(180 / STEP);
const MAX_KM = 3000;                 // beyond this the answer stops mattering
const KM_PER_DEG = 111.32;

console.log(`fetching ${SRC}`);
const geo = await (await fetch(SRC)).json();

// ── rings, bucketed by latitude band so the point test is not 5143 long ──
const rings = [];
for (const f of geo.features) {
  const g = f.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) for (const ring of poly) rings.push(ring);
}
const BANDS = 180;
const band = Array.from({ length: BANDS }, () => []);
for (const ring of rings) {
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    if (y1 === y2) continue;                       // horizontal edges never cross a ray
    const b0 = Math.max(0, Math.floor((Math.min(y1, y2) + 90) / 180 * BANDS));
    const b1 = Math.min(BANDS - 1, Math.floor((Math.max(y1, y2) + 90) / 180 * BANDS));
    for (let b = b0; b <= b1; b++) band[b].push([x1, y1, x2, y2]);
  }
}
console.log(`${rings.length} rings, ${band.reduce((n, b) => n + b.length, 0)} edge-band entries`);

/** Even-odd crossing test against the edges in this point's latitude band. */
function isLand(lon, lat) {
  const b = Math.min(BANDS - 1, Math.max(0, Math.floor((lat + 90) / 180 * BANDS)));
  let inside = false;
  for (const [x1, y1, x2, y2] of band[b]) {
    if ((y1 > lat) !== (y2 > lat)) {
      const xAt = x1 + ((lat - y1) / (y2 - y1)) * (x2 - x1);
      if (lon < xAt) inside = !inside;
    }
  }
  return inside;
}

const land = new Uint8Array(W * H);
for (let j = 0; j < H; j++) {
  const lat = 90 - (j + 0.5) * STEP;
  for (let i = 0; i < W; i++) {
    const lon = -180 + (i + 0.5) * STEP;
    if (isLand(lon, lat)) land[j * W + i] = 1;
  }
}
const nLand = land.reduce((n, v) => n + v, 0);
console.log(`raster ${W}x${H}, land ${nLand} (${((nLand / (W * H)) * 100).toFixed(1)}%)`);

// ── the anisotropic chamfer ──
const INF = 1e9;
const d = new Float32Array(W * H).fill(INF);
for (let k = 0; k < W * H; k++) if (!land[k]) d[k] = 0;       // sea is the source
const dy = STEP * KM_PER_DEG;
const dxAt = (j) => STEP * KM_PER_DEG * Math.cos(((90 - (j + 0.5) * STEP) * Math.PI) / 180);
const wrap = (i) => (i + W) % W;
const relax = (j, order) => {
  const dx = Math.max(1e-3, dxAt(j));
  const diag = Math.hypot(dx, dy);
  for (const i of order) {
    const k = j * W + i;
    let best = d[k];
    for (const [oi, oj, c] of [[-1, 0, dx], [1, 0, dx], [0, -1, dy], [0, 1, dy],
      [-1, -1, diag], [1, -1, diag], [-1, 1, diag], [1, 1, diag]]) {
      const nj = j + oj;
      if (nj < 0 || nj >= H) continue;
      const v = d[nj * W + wrap(i + oi)] + c;
      if (v < best) best = v;
    }
    d[k] = best;
  }
};
const fwd = [...Array(W).keys()], bwd = [...fwd].reverse();
// Four sweeps: information travels one way per pass, so down-then-up twice
// settles a field this smooth. Checked below against known coast distances.
for (let pass = 0; pass < 2; pass++) {
  for (let j = 0; j < H; j++) relax(j, fwd);
  for (let j = H - 1; j >= 0; j--) relax(j, bwd);
}

const out = new Uint8Array(W * H);
for (let k = 0; k < W * H; k++) {
  out[k] = Math.round(255 * Math.sqrt(Math.min(d[k], MAX_KM) / MAX_KM));
}

// ── does it agree with the world? ──
const km = (lon, lat) => {
  const i = Math.min(W - 1, Math.max(0, Math.floor((lon + 180) / STEP)));
  const j = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / STEP)));
  const v = out[j * W + i] / 255;
  return v * v * MAX_KM;
};
console.log('\nsite                 baked      real');
for (const [n, lon, lat, real] of [
  ['Cape Town',        18.42, -34.0,   '~2 km'],
  ['Reykjavik',       -21.94,  64.14,  '~2 km'],
  ['Singapore',       103.82,   1.35,  '~5 km'],
  ['Irkutsk',         104.30,  52.29,  '~2000 km'],
  ['Ulaanbaatar',     106.92,  47.89,  '~1500 km'],
  ['Yosemite',       -119.55,  37.75,  '~200 km'],
  ['Zermatt',           7.75,  46.02,  '~250 km'],
  ['Manaus',          -60.02,  -3.12,  '~1300 km'],
  ['Kashgar (driest)', 75.99,  39.47,  '~2500 km'],
]) console.log(`${n.padEnd(18)} ${String(Math.round(km(lon, lat))).padStart(6)} km   ${real}`);

const b64 = Buffer.from(out).toString('base64');
const OUT = join(HERE, '../client/coast-baked.ts');
writeFileSync(OUT, `// GENERATED by devtools/bake-coast.mjs — do not edit; re-bake.
// Distance to the sea for the whole world: a ${W}x${H} half-degree grid, one
// byte a cell, SQRT-scaled over 0-${MAX_KM}km so the resolution is half a
// kilometre at the coast and twelve in the far interior. From Natural Earth
// 110m land, rasterised and chamfer-transformed with a per-row horizontal step
// (an equirectangular cell is ${dy.toFixed(1)}km tall everywhere and narrower
// the further from the equator).
export const COAST_W = ${W};
export const COAST_H = ${H};
export const COAST_STEP = ${STEP};
export const COAST_MAX_KM = ${MAX_KM};
export const COAST_B64 = '${b64}';
`);
console.log(`\nwrote ${OUT}  (${(b64.length / 1024).toFixed(0)} KB base64, ${(W * H / 1024).toFixed(0)} KB raw)`);

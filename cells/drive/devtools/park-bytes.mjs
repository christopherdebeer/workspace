/**
 * WHAT A PARKED FAR TILE COSTS, BY LEVEL — the arithmetic behind FAR_PARK_BYTES.
 *
 * Pure: it re-runs `farSeg`'s own rule (main.ts) over FAR_LEVELS and sizes what
 * a tile actually keeps, so the table can be re-derived after any change to the
 * lattice without booting a browser. `devtools/park-ab.mjs` is the other half —
 * what a running page charges itself — and the two must agree; they do, at
 * 0.34 MB a tile at z5 and 0.42 at z7.
 *
 * The `was` column is the shape before the sharing pass: uv and index per tile
 * as Float32/Uint16, colour and normal as vec3 Float32, and an RGBA normal map.
 * It is kept because the cut is only legible against it.
 *
 *   node devtools/park-bytes.mjs [lat] [pixelHeight]
 */
const LEVELS = [13, 11, 9, 7, 6, 5, 4, 3], RING = 2, M_PER_VERT = 250, PX_PER_VERT = 1.5;
const lat = Number(process.argv[2] ?? -29.9872);   // Letsemeng, where the park was measured
const pixY = Number(process.argv[3] ?? 320);       // the art frame's height, not the glass
const tileM = (z) => (40075016.7 / 2 ** z) * Math.cos((lat * Math.PI) / 180);
const bandFloor = (z) => { const i = LEVELS.indexOf(z); return i <= 0 ? 0 : tileM(LEVELS[i - 1]) * (RING + 0.5); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const farSeg = (z) => {
  const ground = tileM(z) / M_PER_VERT, floor = bandFloor(z);
  const mpp = floor > 0 ? (2 * floor) / (1.35 * Math.max(2, pixY)) : 0;
  const screen = mpp > 0 ? tileM(z) / (mpp * PX_PER_VERT) : Infinity;
  return clamp(Math.round(Math.min(ground, screen) / 8) * 8, 32, 128);
};
const MB = (b) => (b / 1048576).toFixed(3);
console.log('seg  level  verts    pos    col    nrm    map     TILE     was    shared(level)');
const segs = new Map();
for (const z of LEVELS) {
  const seg = farSeg(z), v = (seg + 1) ** 2;
  const pos = v * 3 * 4;                    // vec3 Float32 — the sphere, per tile
  const col = v * 3;                        // vec3 Uint8 normalized
  const nrm = v * 3;                        // vec3 Int8 normalized
  const map = 256 * 256 * 2;                // the tile's own RG object-space normal map
  const tile = pos + col + nrm + map;
  const uv = v * 2 * 4, idx = seg * seg * 6 * (v > 65535 ? 4 : 2);
  const was = v * 3 * 4 * 3 + uv + idx + 256 * 256 * 4;
  segs.set(seg, uv + idx);
  console.log(`${String(seg).padStart(3)}  z${String(z).padEnd(4)} ${String(v).padStart(6)}  `
    + `${MB(pos)}  ${MB(col)}  ${MB(nrm)}  ${MB(map)}  ${MB(tile)}  ${MB(was)}   ${MB(uv + idx)}`);
}
const shared = [...segs.values()].reduce((a, b) => a + b, 0);
const most = Math.max(...segs.values());
console.log(`\nshared uv + index: ${MB(shared)} MB for ALL ${segs.size} distinct segment counts together,`);
console.log(`held once each for as long as the page lives. Before, every tile carried its own`);
console.log(`level's copy — ${MB(most)} MB on a 128 lattice, so a ring of 25 carried ${MB(most * 25)} MB of it.`);

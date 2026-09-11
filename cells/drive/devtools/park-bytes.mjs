/**
 * WHAT A PARKED FAR TILE COSTS, BY LEVEL — the arithmetic behind FAR_PARK_BYTES.
 *
 * Pure: it re-runs `farSeg`'s own rule (main.ts) over FAR_LEVELS and sizes the
 * attributes three would allocate, so the table can be re-derived after any
 * change to the lattice rule without booting a browser. The check that it is
 * not fiction is the last row: a z5 ring of 25 is 23.2MB, which is what
 * `__far().park` reported on the live spin-away measurement.
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
const MB = (b) => (b / 1048576).toFixed(2);
console.log('seg  level(s)   verts    attrs  index    map     tile    ring25   (MB)');
for (const z of LEVELS) {
  const seg = farSeg(z), v = (seg + 1) ** 2;
  // position + colour + normal as vec3 f32, uv as vec2 f32 — what the bake sets.
  const attrs = v * 3 * 4 * 3 + v * 2 * 4;
  const index = seg * seg * 6 * (v > 65535 ? 4 : 2);
  const map = 256 * 256 * 4;             // the tile's own object-space normal map, RGBA8
  const tile = attrs + index + map;
  console.log(`${String(seg).padStart(3)}  z${String(z).padEnd(8)} ${String(v).padStart(6)}   `
    + `${MB(attrs).padStart(5)}  ${MB(index).padStart(5)}  ${MB(map).padStart(5)}  `
    + `${MB(tile).padStart(6)}  ${MB(25 * tile).padStart(6)}`);
}

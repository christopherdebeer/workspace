/**
 * HOW FAR DOWN THE ZOOMS CAN `~/cover/v1/` GO, AND WHAT THE ALTERNATIVE COSTS.
 *
 *   node devtools/cover-reach.mjs        # both halves
 *
 * Two measurements, because the answer to "why does the wide shell have no
 * cover" is the first and the answer to "so what do we do" is the second.
 *
 * ONE: the route range-reads 3-degree WorldCover COGs, and a mercator tile at
 * a coarse level lands on a LOT of them — z5 on 20, z4 on 64, z2 on 690. That
 * is why COVER_WIDE_LEVELS stops at 4, and there is no global overview product
 * to escape to (the ESA bucket has the 3-degree COGs and multi-GB zips of the
 * same 10m data; the web viewer is Terrascope's own WMTS).
 *
 * TWO: so bake it, the way ne-wide.ts bakes the roads, and this says how big
 * that bake is — measured on real class-index PNGs the cell already serves
 * rather than guessed. It came out at 0.044 bytes a texel: the whole planet at
 * twice globe-base.png's delivered resolution for about 90KB.
 *
 * See LADDER-BELOW-Z5-2026-09-11.md.
 */
const COVER_PX = 256, WC_SPAN = 3;
for (const z of [12, 10, 8, 6, 5, 4, 3, 2]) {
  const n = 2 ** z;
  // a tile near the equator over Africa
  const x = Math.floor(((22 + 180) / 360) * n), y = Math.floor(n / 2);
  const files = new Set();
  const lonOf = (px) => ((x + px / COVER_PX) / n) * 360 - 180;
  const latOf = (py) => { const t = Math.PI * (1 - (2 * (y + py / COVER_PX)) / n); return (Math.atan(Math.sinh(t)) * 180) / Math.PI; };
  for (let j = 0; j < COVER_PX; j++) for (let i = 0; i < COVER_PX; i++) {
    files.add(`${Math.floor(latOf(j + 0.5) / WC_SPAN)}/${Math.floor(lonOf(i + 0.5) / WC_SPAN)}`);
  }
  const span = 40075016 / n / 1000;
  console.log(`z${String(z).padStart(2)}  tile ${span.toFixed(0).padStart(6)} km  ${(span*1000/COVER_PX).toFixed(0).padStart(6)} m/texel  source files: ${files.size}`);
}
// ── TWO: how big would a GLOBAL coarse cover raster actually be? ──
// Measured on real tiles the cell already serves. They are class-index PNGs,
// which is exactly what this raster would be, so their own size IS the answer
// per texel — there is nothing to re-encode and nothing to model.
console.log('');
const CELL = 'https://c15r-drive.on.parc.land';
const Z = Number(process.env.Z ?? 5);
const n = 2 ** Z;
// A band across the middle of the world: Africa, Asia, the Americas, ocean.
const rows = [Math.floor(n * 0.40), Math.floor(n * 0.50), Math.floor(n * 0.60)];
const cols = [];
for (let i = 0; i < 8; i++) cols.push(Math.floor((i / 8) * n));
let got = 0, raw = 0;
const bufs = [];
for (const y of rows) for (const x of cols) {
  const r = await fetch(`${CELL}/~/cover/v1/${Z}/${x}/${y}`);
  if (!r.ok) { console.log(`  ${Z}/${x}/${y} -> ${r.status}`); continue; }
  const b = Buffer.from(await r.arrayBuffer());
  bufs.push(b); got++; raw += b.length;
}
// The PNGs are already deflated class indices, so their own size IS the
// answer per texel — no need to re-encode.
const texels = got * 256 * 256;
console.log(`z${Z}: ${got} tiles, ${(raw/1024).toFixed(0)} KB of PNG for ${texels} class texels`);
console.log(`     ${(raw / texels).toFixed(3)} bytes per texel`);
for (const [name, w, h] of [['z2-equivalent 1024x512', 1024, 512], ['z3-equivalent 2048x1024', 2048, 1024], ['z4-equivalent 4096x2048', 4096, 2048]]) {
  console.log(`  a global ${name} class raster ≈ ${((raw / texels) * w * h / 1024).toFixed(0)} KB`);
}

/**
 * THE PLANET, BAKED ONCE — the base the globe chart is painted on.
 *
 *   node cells/drive/devtools/bake-globe.mjs
 *
 * Tier 1 stretched the tangent plane to 1,500km and that is as far as a plane
 * honestly goes (see SIGHT_MAX's note: `toLocal` is equirectangular scaled by
 * cos(origin.lat), 8% too wide ten degrees away at 30°). Past it the honest
 * answer is a sphere, and a sphere needs one thing the streamed world cannot
 * give it: a picture of the WHOLE Earth, at a resolution a 400-pixel globe can
 * use, available before anything has streamed.
 *
 * ── IT IS COLOURED BY THE GAME'S OWN RULES, NOT BY A SATELLITE PHOTO ──
 *
 * The obvious asset is a NASA Blue Marble tile. It would be prettier and it
 * would be WRONG here: this world's ground is `GROUND_RAMPS` under
 * `climCompute`, a solarpunk palette where the emerald comes from the plants
 * standing on the sand rather than from the sand. A photographic Earth would
 * read as a different game's map the moment you zoomed from the shell onto it.
 * So every texel is coloured by importing `client/climate.ts` and calling the
 * same `climCompute` → `groundColourAt` the terrain painter calls, over real
 * elevation and real land cover. The globe and the hillside agree because they
 * are the same two functions.
 *
 * ── THE TWO RASTERS ──
 *
 * Elevation: AWS terrarium z4 (16×16 tiles, 4096² mercator, ~9.8km a pixel at
 * the equator). Land cover: the cell's own `~/cover/v1/` at z4, the same route
 * the shell's wide tier reads. Both cached on disk under node_modules/.cache,
 * so a re-bake after a palette change costs no network at all — which is the
 * point, because the palette is the part anyone will want to iterate on.
 *
 * Mercator stops at ±85.05°, so the last rows of the equirect output have no
 * data and clamp to the edge row. That is Antarctica's coast southward and the
 * Arctic ocean northward, both of which the alpine ramp's top band paints white
 * anyway — the one place where running out of evidence and being right happen
 * to coincide.
 *
 * Output: `static/globe-base.png`, an equirect RGB image, sRGB-encoded (the
 * client marks the texture SRGBColorSpace and three linearises it, which is
 * the same value the terrain's vertex colours carry). It must stay under the
 * ~750KB cell-sync binary cap — see the note in `ne-wide.ts` — and the bake
 * says so out loud if it does not.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readPng, writePngRGB } from './png-lite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..');
const CACHE = join(CELL, 'node_modules', '.cache', 'globe-tiles');
const OUT = join(CELL, 'static', 'globe-base.png');
mkdirSync(CACHE, { recursive: true });

const Z = Number(process.env.Z ?? 4);            // mosaic zoom for both rasters
const N = 2 ** Z;                                 // tiles per side
const MOS = N * 256;                              // mosaic pixels per side
const OUT_W = Number(process.env.W ?? 1024), OUT_H = OUT_W / 2;
const CELL_BASE = 'https://c15r-drive.on.parc.land';

// ── the game's own colour rules, imported rather than restated ───────────
const BUNDLE = join(CELL, '.globe-climate.mjs');
await build({ entryPoints: [join(CELL, 'client/climate.ts')], outfile: BUNDLE,
  bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
const { climCompute, groundColourAt, BIOME_ORDER } = await import(`file://${BUNDLE}?${Date.now()}`);
const COASTB = join(CELL, '.globe-coast.mjs');
await build({ entryPoints: [join(CELL, 'client/coast.ts')], outfile: COASTB,
  bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
const { onLand, coastKm } = await import(`file://${COASTB}?${Date.now()}`);

async function tile(kind, x, y) {
  const f = join(CACHE, `${kind}-${Z}-${x}-${y}.png`);
  if (existsSync(f)) return readPng(readFileSync(f));
  const url = kind === 'dem'
    ? `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`
    : `${CELL_BASE}/~/cover/v1/${Z}/${x}/${y}`;
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      writeFileSync(f, buf);
      return readPng(buf);
    } catch (e) {
      if (a === 3) { console.log(`  ${kind} ${Z}/${x}/${y}: ${e.message} — left as no-data`); return null; }
      await new Promise((s) => setTimeout(s, 700 * (a + 1)));
    }
  }
  return null;
}

async function mosaic(kind, into, put) {
  const jobs = [];
  for (let ty = 0; ty < N; ty++) for (let tx = 0; tx < N; tx++) jobs.push([tx, ty]);
  let done = 0, at = 0;
  const lanes = kind === 'dem' ? 8 : 5;    // our own cell gets the gentler number
  await Promise.all(Array.from({ length: lanes }, async () => {
    while (at < jobs.length) {
      const [tx, ty] = jobs[at++];
      const t = await tile(kind, tx, ty);
      if (t) put(into, t, tx, ty);
      if (++done % 32 === 0) process.stdout.write(`\r  ${kind}: ${done}/${jobs.length}`);
    }
  }));
  console.log(`\r  ${kind}: ${done}/${jobs.length} tiles`);
}

console.log(`mosaic z${Z} = ${MOS}x${MOS}, output ${OUT_W}x${OUT_H}`);
const elev = new Int16Array(MOS * MOS);
const cover = new Uint8Array(MOS * MOS);
await mosaic('dem', elev, (dst, t, tx, ty) => {
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * t.bpp;
    const v = t.data[i] * 256 + t.data[i + 1] + t.data[i + 2] / 256 - 32768;
    dst[(ty * 256 + y) * MOS + tx * 256 + x] = Math.max(-11000, Math.min(9000, Math.round(v)));
  }
});
await mosaic('cover', cover, (dst, t, tx, ty) => {
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    dst[(ty * 256 + y) * MOS + tx * 256 + x] = t.data[(y * 256 + x) * t.bpp];
  }
});

// ── equirect sampling ────────────────────────────────────────────────────
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const merY = (lat) => {
  const la = clamp(lat, -85.0511, 85.0511) * Math.PI / 180;
  return clamp((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2, 0, 1) * MOS;
};
const merX = (lon) => clamp(((lon + 180) % 360 + 360) % 360 / 360, 0, 1) * MOS;
const at = (arr, px, py) => arr[clamp(Math.floor(py), 0, MOS - 1) * MOS + (((Math.floor(px) % MOS) + MOS) % MOS)];

// linear → sRGB, so the eight bits are spent where the eye is.
const enc = (v) => {
  const c = clamp(v, 0, 1);
  return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
};
// The sea, by depth, from the arid ramp's own shallows entry outward. Deep
// ocean is not "shallows, darker": it is bluer as well, because what comes
// back from 4km of water is the short end of the spectrum and nothing else.
// …AND THE RAMP IS THE SHELF'S, NOT THE ABYSS'S. The first bake spread the
// transition over 0-4000m, which put the mid-ocean ridges — 2,500m of relief
// standing off a 5,000m floor — halfway to shallow, and the Atlantic came out
// veined with bright turquoise swirls. A shelf is 0-200m and everything past
// about 600m is simply deep; that is why every printed atlas draws it that way.
const SHELF_M = 600;
const SHALLOW = [0.07, 0.30, 0.35], DEEP = [0.02, 0.09, 0.20];
const ICE = [0.90, 0.93, 0.96];

const rgb = Buffer.alloc(OUT_W * OUT_H * 3);
// A neighbourhood in MOSAIC TEXELS, not in metres. `moistureAt` walks ±2 steps
// of 400m — written for a 10m cover raster and meaningless on a 9.8km one,
// where all twenty-five samples land in a single texel and the aridity term
// (which reads the VARIETY around a point) is blind. The env below maps one
// 400m step to one mosaic texel, so the five-by-five spans ~50km and the rule
// sees what it was written to see, at this raster's own scale.
const STEP = 400;
let land = 0, sea = 0, ice = 0, noData = 0;
const t0 = Date.now();
for (let j = 0; j < OUT_H; j++) {
  const lat = 90 - (j + 0.5) * (180 / OUT_H);
  const py = merY(lat);
  const rowFlat = Math.abs(lat) > 85.0511;      // past mercator: no evidence
  for (let i = 0; i < OUT_W; i++) {
    const lon = -180 + (i + 0.5) * (360 / OUT_W);
    const px = merX(lon);
    const e = at(elev, px, py);
    const cv = at(cover, px, py);
    const wet = cv === 80;
    const dry = onLand(lat, lon);
    let col;
    if (rowFlat && !dry) { col = DEEP; noData++; }
    else if (cv === 70) { col = ICE; ice++; }
    else if (wet || (!dry && e <= 0)) {
      // NO BATHYMETRY IS NOT SHALLOW WATER. Terrarium carries real depths in
      // most of the world and zeroes in some of it — the Arctic among them —
      // and reading that zero as the surface painted the whole polar ocean as
      // a lagoon in the first bake. A sea texel the DEM has nothing to say
      // about is open ocean until something says otherwise; only a real
      // negative reading earns the shelf.
      const d = e < 0 ? Math.min(1, -e / SHELF_M) : 0.85;
      col = [0, 1, 2].map((k) => SHALLOW[k] + (DEEP[k] - SHALLOW[k]) * d);
      sea++;
    } else {
      const env = {
        latAbsAt: () => Math.abs(lat),
        groundAt: (x, z) => at(elev, px + x / STEP, py + z / STEP),
        coverAt: (x, z) => { const c = at(cover, px + x / STEP, py + z / STEP); return c === 0 ? null : c; },
      };
      const c = climCompute(env, 0, 0, 1);
      col = groundColourAt(c.w, Math.max(0, e));
      land++;
    }
    // HILLSHADE, because a planet without relief reads as a political map. The
    // gradient is taken in mosaic texels and scaled by the texel's own ground
    // size, which shrinks with cos(lat) — without that, Norway is a cliff and
    // the tropics are flat.
    const mPerTexel = (40075016.7 / MOS) * Math.max(0.15, Math.cos(lat * Math.PI / 180));
    const dzx = (at(elev, px + 1, py) - at(elev, px - 1, py)) / (2 * mPerTexel);
    const dzy = (at(elev, px, py + 1) - at(elev, px, py - 1)) / (2 * mPerTexel);
    const nl = Math.hypot(dzx, dzy, 1);
    // Light from the north-west, the cartographer's convention, at 45°.
    const sh = clamp((-dzx * -0.5 + -dzy * -0.5 + 0.707) / nl, 0, 1);
    // Only the land is shaded: relief under four kilometres of water is not
    // something light does, and shading the sea floor is what made the ridges
    // legible in the first place.
    const shade = e > 0 ? 0.72 + 0.45 * sh : 1;
    const o = (j * OUT_W + i) * 3;
    for (let c2 = 0; c2 < 3; c2++) rgb[o + c2] = enc(col[c2] * shade);
  }
  if (j % 64 === 0) process.stdout.write(`\r  painting row ${j}/${OUT_H}`);
}
console.log(`\r  painted ${OUT_W * OUT_H} texels in ${((Date.now() - t0) / 1000).toFixed(1)}s` +
  `  — land ${land}, sea ${sea}, ice ${ice}, past-mercator ${noData}`);

const png = writePngRGB(OUT_W, OUT_H, rgb);
writeFileSync(OUT, png);
const KB = png.length / 1024;
console.log(`\nwrote ${OUT}  ${KB.toFixed(0)}KB`);
console.log(KB > 730
  ? `  !! OVER the ~750KB cell-sync binary cap — re-run with W=${OUT_W / 2}`
  : `  under the ~750KB binary cap, by ${(730 - KB).toFixed(0)}KB`);

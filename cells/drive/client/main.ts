/**
 * drive — a top-down car game over the real world.
 *
 * Pipeline: pick a (near-)random point on Earth with roads → stream real GIS
 * around the car as it moves — elevation from AWS's public terrarium tiles
 * (decoded to heightfields, rendered as displaced, slope-shaded terrain) and
 * OSM vectors from Overpass (roads as ribbons, buildings extruded, water and
 * green draped flat) — all in local metres around the spawn. Fog of war is a
 * canvas-masked overlay: driving burns a hole in it, and the world beyond
 * what you've seen stays night.
 *
 * Deliberately dependency-light: three.js only (esm.sh, pinned in
 * imports.json), no physics engine (arcade bicycle model), no tile server of
 * our own — the public endpoints named in the cell's CSP are the whole
 * backend.
 */
import * as THREE from 'three';

// ── tuning ─────────────────────────────────────────────────────────
const TERRAIN_Z = 14;         // terrarium tile zoom (~2.4km/cos(lat), ~9.5m/px — z13 washed out the hills roads tunnel through)
const TERRAIN_SEG = 128;      // terrain mesh vertices per tile edge — sets the cell the road cut must out-span
const OSM_Z = 16;             // overpass tile zoom (~600m — keeps per-query weight low)
const OSM_RING = 1;           // load a (2R+1)² neighbourhood of vector tiles
const TERRAIN_RING = 2;       // wider ring at the finer zoom keeps the horizon populated
const REVEAL_M = 150;         // fog hole radius around the car, metres
const FOG_SPAN = 12000;       // fog canvas coverage, metres (centred on spawn)
const FOG_PX = 1024;
// Equilibrium speed is accel/drag — the old 0.7 drag capped the car at 72km/h
// no matter what maxFwd said. Road drag now yields ~180km/h flat out; grass
// ~36; water a wallow. Steering authority FALLS with speed (below) so 180
// doesn't mean a 180°/s twitch.
const CAR = { accel: 16, brake: 26, maxRev: 9, wheelbase: 2.9, steerMax: 0.6 };
const CAM = { base: 175, perKmh: 1.1, tilt: 70 };
// 44 put the camera 6.8km up over a 4.8×8.3km view — a regional chart, but
// only just, and the streaming never followed it out there. 260 reaches ~40km
// across, which is a whole mountain range, a coastline, or the far end of a
// pass you have not driven yet.
const ZOOM_MIN = 0.25, ZOOM_MAX = 260;
const CAR_R = 2.4;            // collision circle — a real car's half-diagonal plus a whisker

// ── geo helpers (local metres around the spawn; x=east, z=south) ───
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const M_LAT = 111320;
let origin = { lat: 0, lon: 0, mLon: M_LAT };
const toLocal = (lat: number, lon: number): [number, number] => [
  (lon - origin.lon) * origin.mLon,
  -(lat - origin.lat) * M_LAT, // north = -z (screen up)
];
const tileAt = (lat: number, lon: number, z: number): [number, number] => {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [x, clamp(y, 0, n - 1)];
};
const tileBounds = (x: number, y: number, z: number) => {
  const n = 2 ** z;
  const lonW = (x / n) * 360 - 180;
  const lonE = ((x + 1) / n) * 360 - 180;
  const latN = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const latS = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return { latN, latS, lonW, lonE };
};
/** The middle of an OSM tile in local metres — what the tile queue sorts by. */
const tileCentreLocal = (x: number, y: number): [number, number] => {
  const b = tileBounds(x, y, OSM_Z);
  return toLocal((b.latN + b.latS) / 2, (b.lonW + b.lonE) / 2);
};

// ── boot UI ────────────────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id) as HTMLElement;
const bootMsg = (m: string) => { $('boot-msg').textContent = m; };

// ── spawn: a random place on Earth that actually has roads ─────────
const FALLBACKS: Array<[number, number, string]> = [
  [35.011, 135.768, 'Kyoto'], [41.383, 2.176, 'Barcelona'], [-33.925, 18.424, 'Cape Town'],
  [59.913, 10.752, 'Oslo'], [37.774, -122.419, 'San Francisco'], [-34.606, -58.381, 'Buenos Aires'],
  [55.676, 12.568, 'Copenhagen'], [13.756, 100.501, 'Bangkok'], [45.438, 12.335, 'Venice'],
  [64.146, -21.94, 'Reykjavík'], [30.048, 31.236, 'Cairo'], [-36.848, 174.763, 'Auckland'],
  [52.52, 13.405, 'Berlin'], [19.432, -99.133, 'Mexico City'], [1.352, 103.82, 'Singapore'],
  [60.472, 8.469, 'Hardangervidda'], [46.207, 6.146, 'Geneva'], [-22.907, -43.173, 'Rio'],
];
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
let overpassI = 0;
async function overpass(query: string): Promise<any> {
  for (let attempt = 0; attempt < OVERPASS.length; attempt++) {
    // The index must come from `attempt` ALONE. Bumping overpassI inside the
    // loop as well made each failure advance the cursor twice, so four attempts
    // reached two distinct mirrors and skipped the other two entirely.
    const idx = (overpassI + attempt) % OVERPASS.length;
    // And a mirror that ACCEPTS the connection then never answers is the common
    // failure, not one that refuses it — fetch has no default timeout, so a
    // single sulking mirror stalled the whole world stream indefinitely. That
    // is what "waited ages for roads" looked like from the inside.
    const ctl = new AbortController();
    // Generous: a busy-but-alive mirror can take half a minute on a dense
    // urban tile, and cutting those off is worse than the hang this prevents.
    // The bound only has to be finite.
    const bail = setTimeout(() => ctl.abort(), 45000);
    try {
      const res = await fetch(OVERPASS[idx], {
        method: 'POST', body: 'data=' + encodeURIComponent(query), signal: ctl.signal,
      });
      if (res.status === 429 || res.status === 504) throw new Error('busy');
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      overpassI = idx; // stick with whichever mirror is actually answering today
      return json;
    } catch {
      /* next mirror */
    } finally {
      clearTimeout(bail);
    }
  }
  throw new Error('overpass unreachable');
}
async function findSpawn(): Promise<{ lat: number; lon: number; name: string | null }> {
  const p = new URLSearchParams(location.search);
  const qlat = parseFloat(p.get('lat') ?? ''), qlon = parseFloat(p.get('lon') ?? '');
  if (Number.isFinite(qlat) && Number.isFinite(qlon)) return { lat: qlat, lon: qlon, name: null };
  // Default: a KNOWN start (testing/demos want determinism) — the west side of
  // Central Park. Random-anywhere is the deliberate gesture: `elsewhere ↻`
  // (which navigates with ?random=1) or a hand-typed param.
  // Probed against the live road grid: this is ON West Drive (tarmac from
  // frame one), not mid-meadow — a spawn that answers the throttle instantly.
  if (!p.has('random')) return { lat: 40.7816, lon: -73.972, name: 'Central Park, New York' };
  for (let i = 0; i < 4; i++) {
    // Uniform over the sphere (asin), clipped to the inhabited belt.
    const lat = clamp((Math.asin(Math.random() * 2 - 1) * 180) / Math.PI, -50, 66);
    const lon = Math.random() * 360 - 180;
    bootMsg(`probing ${lat.toFixed(2)}, ${lon.toFixed(2)} for roads… (${i + 1}/4)`);
    try {
      const r = await overpass(`[out:json][timeout:8];way["highway"](around:2500,${lat.toFixed(4)},${lon.toFixed(4)});out ids 8;`);
      if ((r.elements?.length ?? 0) >= 6) return { lat, lon, name: null };
    } catch { /* mirror trouble — fall through to the next probe */ }
  }
  const [lat, lon, name] = FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)];
  return { lat: lat + (Math.random() - 0.5) * 0.02, lon: lon + (Math.random() - 0.5) * 0.02, name };
}
async function placeName(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10`);
    const j = await res.json();
    const a = j.address ?? {};
    return [a.village ?? a.town ?? a.city ?? a.municipality ?? a.county, a.state, a.country].filter(Boolean).slice(0, 2).join(', ') || j.display_name?.split(',').slice(0, 2).join(',') || null;
  } catch { return null; }
}

// ── terrain: terrarium heightfields → displaced, slope-shaded mesh ─
interface HeightTile { tx: number; ty: number; xs: number; zs: number; w: number; h: number; data: Float32Array }
const heightTiles = new Map<string, HeightTile>();
let baseElev = 0;
// One texel on the GLOBAL z-level pixel grid; overflowing pixel coords walk
// into the neighbouring tile. Returns null where no tile is loaded.
function texel(tx: number, ty: number, px: number, pz: number): number | null {
  const t = heightTiles.get(`${tx + Math.floor(px / 256)}/${ty + Math.floor(pz / 256)}`);
  if (!t) return null;
  return t.data[(((pz % 256) + 256) % 256) * 256 + (((px % 256) + 256) % 256)];
}
// ── the DEM lies, sometimes ────────────────────────────────────────
// The terrarium mosaic is not maintained and carries local corruption. Central
// Reykjavik is the case that found this: a smooth 918m cone sitting in the
// middle of the harbour, where Copernicus reads 0m — measured, not guessed.
// Downtown Manhattan carries a -742m void, Hong Kong -7006m. Rendered, these
// are the black spires and the bottomless pits.
//
// Nothing about the repair knows any geography. It rests on one fact about
// LAND: a hill of height H has a footprint. Even a volcanic plug or a sea
// cliff does not climb H metres within H/1.7 metres of run and then close back
// on itself, and if it did it would run off the side of a 1km tile rather than
// standing alone in the middle of one. So a blob is corrupt when BOTH:
//
//   · it is far too narrow for its height (radius < 0.6 of what the slope
//     limit demands), and
//   · it dwarfs the tile it sits in (more than 3x the tile's own relief) —
//     which is what keeps a real summit inside a mountain range safe, since
//     there the relief is already large.
//
// Validated against 28 of the hardest real landforms on Earth — Half Dome, El
// Capitan, Devils Tower, Uluru (including tiles clipping only its edge),
// Matterhorn, Cerro Torre, Meteora, Preikestolen, Gibraltar, Monument Valley,
// the Grand Canyon, Cliffs of Moher, Death Valley: ZERO pixels touched on all
// 28, while every known-bad tile comes back to a sane range.
const DEM_RISE = 80;     // metres clear of the ground before a blob is even considered
const DEM_SLOPE = 1.7;   // ~60°, the steepest slope a real landform sustains
const DEM_RATIO = 0.6;   // how much narrower than that it must be to be called a lie
const DEM_DWARF = 3;     // and how far it must tower over everything else around
/** Repaired-pixel counts, newest last — so a probe can ask what the DEM cost. */
const demFixes: Array<{ t: string; n: number }> = [];
function repairDem(e: Float32Array, mpp: number): Float32Array {
  const W = 256;
  const s = Float32Array.from(e).sort();
  const at = (f: number): number => s[Math.min(s.length - 1, Math.floor(s.length * f))];
  const ground = at(0.2);
  const relief = Math.max(30, at(0.95) - ground);
  const flag = new Uint8Array(e.length);
  const seen = new Uint8Array(e.length);
  const stack = new Int32Array(e.length);
  const cells = new Int32Array(e.length);
  let flagged = 0;
  for (const dir of [1, -1]) {
    // A pit is ground missing from below the GROUND, not below the roof —
    // basing it on a high percentile made every low-lying city one crater.
    const base = dir > 0 ? ground : at(0.05);
    seen.fill(0);
    for (let st = 0; st < e.length; st++) {
      if (seen[st] || (e[st] - base) * dir <= DEM_RISE) continue;
      let sp = 0, nc = 0, peak = 0;
      stack[sp++] = st; seen[st] = 1;
      while (sp) {
        const i = stack[--sp];
        cells[nc++] = i;
        const h = (e[i] - base) * dir;
        if (h > peak) peak = h;
        const x = i % W, y = (i / W) | 0;
        if (x > 0) { const j = i - 1; if (!seen[j] && (e[j] - base) * dir > DEM_RISE) { seen[j] = 1; stack[sp++] = j; } }
        if (x < W - 1) { const j = i + 1; if (!seen[j] && (e[j] - base) * dir > DEM_RISE) { seen[j] = 1; stack[sp++] = j; } }
        if (y > 0) { const j = i - W; if (!seen[j] && (e[j] - base) * dir > DEM_RISE) { seen[j] = 1; stack[sp++] = j; } }
        if (y < W - 1) { const j = i + W; if (!seen[j] && (e[j] - base) * dir > DEM_RISE) { seen[j] = 1; stack[sp++] = j; } }
      }
      if (peak <= DEM_DWARF * relief) continue;
      if (Math.sqrt(nc / Math.PI) / (peak / (DEM_SLOPE * mpp)) >= DEM_RATIO) continue;
      for (let k = 0; k < nc; k++) { flag[cells[k]] = 1; flagged++; }
    }
  }
  // A "repair" that rewrites a fifth of the tile is far likelier to be this
  // rule misfiring than real corruption. Leave the tile exactly as it came.
  if (!flagged || flagged > e.length * 0.2) return e;
  // Diffuse the surviving ground into the holes, so what is left is the land
  // the blob was standing on rather than a flat plate.
  const out = Float32Array.from(e);
  let left = flagged;
  const next = new Uint8Array(e.length);
  for (let pass = 0; pass < 300 && left; pass++) {
    next.set(flag);
    for (let i = 0; i < e.length; i++) {
      if (!flag[i]) continue;
      const x = i % W, y = (i / W) | 0;
      let sum = 0, n = 0;
      if (x > 0 && !flag[i - 1]) { sum += out[i - 1]; n++; }
      if (x < W - 1 && !flag[i + 1]) { sum += out[i + 1]; n++; }
      if (y > 0 && !flag[i - W]) { sum += out[i - W]; n++; }
      if (y < W - 1 && !flag[i + W]) { sum += out[i + W]; n++; }
      if (n) { out[i] = sum / n; next[i] = 0; left--; }
    }
    flag.set(next);
  }
  for (let i = 0; i < e.length; i++) if (flag[i]) out[i] = ground;
  demFixes.push({ t: `${flagged}px`, n: flagged });
  if (demFixes.length > 40) demFixes.shift();
  return out;
}
async function fetchHeights(x: number, y: number, z: number = TERRAIN_Z): Promise<Float32Array | null> {
  try {
    const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`);
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const cv = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(256, 256)
      : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    const cx = (cv as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D;
    cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, 256, 256).data;
    const out = new Float32Array(256 * 256);
    for (let i = 0; i < 256 * 256; i++) out[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
    // Metres per pixel at THIS tile's latitude — the footprint test is a
    // statement about the ground, so it has to be in ground units.
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / 2 ** z))) * 180) / Math.PI;
    const mpp = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (2 ** z * 256);
    return repairDem(out, mpp);
  } catch { return null; }
}
// ── land cover: what is actually growing here ──────────────────────
// ESA WorldCover, 10m, global, through this cell's namespace (the bucket has no
// CORS, so the browser cannot reach it directly — see the cover route). The
// tile is an 8-bit greyscale PNG whose PIXEL VALUE IS THE CLASS, which means it
// decodes through the same createImageBitmap path as terrarium elevation and
// costs no new decoder. Measured live: 784 BYTES for the 9.8km of Death Valley,
// ~5KB for a tile of Manhattan — a whole session's ecology for less than one
// vector tile.
const COVER_Z = 12;   // ~9.8km per tile; the source pyramid has a level at 37m/px
// The WorldCover legend, as the values actually stored in the pixel.
const COVER = { tree: 10, shrub: 20, grass: 30, crop: 40, built: 50, bare: 60,
  snow: 70, water: 80, wetland: 90, mangrove: 95, moss: 100 } as const;
const COVER_NAME: Record<number, string> = {
  10: 'FOREST', 20: 'SCRUB', 30: 'GRASS', 40: 'FARMLAND', 50: 'URBAN', 60: 'BARREN',
  70: 'ICE', 80: 'WATER', 90: 'WETLAND', 95: 'MANGROVE', 100: 'TUNDRA',
};
interface CoverTile { xs: number; zs: number; w: number; h: number; data: Uint8Array }
const coverTiles = new Map<string, CoverTile>();
const coverAsked = new Set<string>();
async function loadCoverTile(x: number, y: number): Promise<void> {
  const key = `${x}/${y}`;
  if (coverAsked.has(key)) return;
  coverAsked.add(key);
  try {
    const res = await fetch(`${CELL_BASE}/~/cover/v1/${COVER_Z}/${x}/${y}`);
    if (!res.ok) throw new Error(`cover ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    const cv = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(256, 256)
      : Object.assign(document.createElement('canvas'), { width: 256, height: 256 });
    const cx = (cv as OffscreenCanvas).getContext('2d') as OffscreenCanvasRenderingContext2D;
    cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, 256, 256).data;
    const data = new Uint8Array(256 * 256);
    for (let i = 0; i < data.length; i++) data[i] = d[i * 4];   // red channel IS the class
    const b = tileBounds(x, y, COVER_Z);
    const [wx0, wz0] = toLocal(b.latN, b.lonW);
    const [wx1, wz1] = toLocal(b.latS, b.lonE);
    coverTiles.set(key, {
      xs: Math.min(wx0, wx1), zs: Math.min(wz0, wz1),
      w: Math.abs(wx1 - wx0), h: Math.abs(wz1 - wz0), data,
    });
    // Terrain built before this arrived was coloured from a guess and, more
    // importantly, has no seabed under its water. Rebuild what this tile
    // covers — staggered by the rebuild throttle, so it costs a few frames
    // spread over seconds rather than a hitch.
    coverDirtiedTerrain(Math.min(wx0, wx1), Math.min(wz0, wz1), Math.abs(wx1 - wx0), Math.abs(wz1 - wz0));
  } catch {
    // Let a later pass ask again — a cover miss is a softer failure than a road
    // one (everything downstream has a fallback), so it just retries slowly.
    setTimeout(() => coverAsked.delete(key), 20000);
  }
}
/** The land-cover class at a world point, or `null` where nothing has loaded.
 *  NEAREST, never interpolated: halfway between forest (10) and shrub (20) is
 *  not "15", it is a different class entirely. Every caller must handle null
 *  and keep whatever it did before — cover refines the world, it does not gate
 *  it, and a tile that has not arrived must never blank the ground. */
function sampleCover(ex: number, ez: number): number | null {
  for (const t of coverTiles.values()) {
    if (ex < t.xs || ez < t.zs || ex >= t.xs + t.w || ez >= t.zs + t.h) continue;
    const px = Math.min(255, Math.max(0, Math.floor(((ex - t.xs) / t.w) * 256)));
    const pz = Math.min(255, Math.max(0, Math.floor(((ez - t.zs) / t.h) * 256)));
    const v = t.data[pz * 256 + px];
    return v || null;   // 0 is "no class here" (open ocean), not a class
  }
  return null;
}
/** Is there any elevation data under this point at all? sampleHeight answers
 *  0 where there is none — "spawn level" — which is a fiction anything built
 *  against will be wrong by the depth of whatever basin it is crossing. */
function hasHeight(ex: number, ez: number): boolean {
  for (const t of heightTiles.values()) {
    if (ex >= t.xs && ez >= t.zs && ex < t.xs + t.w && ez < t.zs + t.h) return true;
  }
  return false;
}
function sampleHeight(ex: number, ez: number): number {
  for (const t of heightTiles.values()) {
    if (ex < t.xs || ez < t.zs || ex >= t.xs + t.w || ez >= t.zs + t.h) continue;
    // GLOBAL pixel grid: sample i is centred at xs + (i+0.5)·w/256 and the
    // bilinear neighbourhood crosses into adjacent tiles. The old per-tile
    // 0..255 stretch pinned two DIFFERENT global samples to the same border
    // line (this tile's 255, the neighbour's 0) and clamped instead of
    // crossing — a visible crack along every tile edge.
    const u = ((ex - t.xs) / t.w) * 256 - 0.5, v = ((ez - t.zs) / t.h) * 256 - 0.5;
    const x0 = Math.floor(u), z0 = Math.floor(v), fx = u - x0, fz = v - z0;
    const base = texel(t.tx, t.ty, clamp(x0, 0, 255), clamp(z0, 0, 255)) ?? 0;
    const g = (px: number, pz: number): number => texel(t.tx, t.ty, px, pz) ?? base;
    return (g(x0, z0) * (1 - fx) + g(x0 + 1, z0) * fx) * (1 - fz)
      + (g(x0, z0 + 1) * (1 - fx) + g(x0 + 1, z0 + 1) * fx) * fz - baseElev;
  }
  return 0;
}
// ── biomes: one palette per world, not one world ───────────────────
// The reference art gets its character from tight per-scene palettes — canyon
// purple-gold, jungle grey-green, desert teal-sand. A biome drives the sky,
// the haze, the ground ramp, the vegetation and the light together, so Cairo
// and Edinburgh read as different worlds rather than the same world at
// different times of day. Classified from latitude and elevation (a crude
// stand-in for climate — good enough to feel authored, and overridable with
// ?biome= for art direction).
type Rgb = [number, number, number];
interface Biome {
  name: string;
  zenith: Rgb; horizon: Rgb; sunDisc: Rgb; below: Rgb;
  hazeBase: Rgb; hazeSun: Rgb;
  ramp: Array<[number, Rgb]>;         // [max elevation, colour]
  vegHue: [number, number]; vegLit: [number, number];
  sun: number; sunI: number; hemiSky: number; hemiGnd: number; hemiI: number;
}
const BIOMES: Record<string, Biome> = {
  arid: {
    name: 'arid',
    zenith: [0.055, 0.135, 0.30], horizon: [0.55, 0.48, 0.36], sunDisc: [1.0, 0.86, 0.55], below: [0.30, 0.26, 0.22],
    hazeBase: [0.24, 0.21, 0.17], hazeSun: [0.50, 0.35, 0.17],
    ramp: [[0.5, [0.07, 0.30, 0.35]], [60, [0.44, 0.37, 0.22]], [300, [0.41, 0.33, 0.19]], [900, [0.37, 0.27, 0.15]], [1800, [0.33, 0.28, 0.23]], [1e9, [0.62, 0.63, 0.65]]],
    vegHue: [0.18, 0.06], vegLit: [0.18, 0.14],
    sun: 0xffe0b0, sunI: 1.5, hemiSky: 0xbcd2ee, hemiGnd: 0x6a5a3c, hemiI: 0.95,
  },
  tropical: {
    name: 'tropical',
    zenith: [0.05, 0.14, 0.26], horizon: [0.40, 0.46, 0.38], sunDisc: [1.0, 0.92, 0.70], below: [0.16, 0.20, 0.16],
    hazeBase: [0.20, 0.24, 0.20], hazeSun: [0.42, 0.40, 0.22],
    ramp: [[0.5, [0.06, 0.26, 0.30]], [60, [0.14, 0.27, 0.14]], [300, [0.13, 0.24, 0.13]], [900, [0.16, 0.24, 0.14]], [1800, [0.24, 0.26, 0.20]], [1e9, [0.60, 0.62, 0.64]]],
    vegHue: [0.26, 0.08], vegLit: [0.14, 0.16],
    sun: 0xfff0cc, sunI: 1.35, hemiSky: 0xa8c8dc, hemiGnd: 0x2c4426, hemiI: 1.0,
  },
  temperate: {
    name: 'temperate',
    zenith: [0.05, 0.12, 0.28], horizon: [0.46, 0.44, 0.40], sunDisc: [1.0, 0.88, 0.62], below: [0.22, 0.22, 0.20],
    hazeBase: [0.22, 0.22, 0.20], hazeSun: [0.46, 0.36, 0.20],
    ramp: [[0.5, [0.07, 0.28, 0.33]], [60, [0.25, 0.29, 0.17]], [300, [0.24, 0.27, 0.16]], [900, [0.28, 0.26, 0.17]], [1800, [0.31, 0.29, 0.25]], [1e9, [0.66, 0.67, 0.69]]],
    vegHue: [0.24, 0.07], vegLit: [0.16, 0.16],
    sun: 0xffe6c2, sunI: 1.4, hemiSky: 0xb4ccea, hemiGnd: 0x4c5238, hemiI: 0.9,
  },
  boreal: {
    name: 'boreal',
    zenith: [0.05, 0.11, 0.27], horizon: [0.40, 0.44, 0.48], sunDisc: [1.0, 0.84, 0.62], below: [0.20, 0.22, 0.24],
    hazeBase: [0.20, 0.23, 0.26], hazeSun: [0.42, 0.36, 0.26],
    ramp: [[0.5, [0.06, 0.24, 0.31]], [60, [0.18, 0.25, 0.19]], [300, [0.17, 0.23, 0.18]], [900, [0.21, 0.23, 0.19]], [1800, [0.30, 0.31, 0.30]], [1e9, [0.74, 0.76, 0.78]]],
    vegHue: [0.30, 0.06], vegLit: [0.12, 0.13],
    sun: 0xffe2cc, sunI: 1.25, hemiSky: 0xaec6e4, hemiGnd: 0x3a4438, hemiI: 0.95,
  },
  alpine: {
    name: 'alpine',
    zenith: [0.04, 0.10, 0.30], horizon: [0.52, 0.54, 0.58], sunDisc: [1.0, 0.94, 0.80], below: [0.26, 0.27, 0.29],
    hazeBase: [0.26, 0.28, 0.31], hazeSun: [0.48, 0.44, 0.36],
    ramp: [[0.5, [0.08, 0.28, 0.36]], [60, [0.28, 0.30, 0.24]], [300, [0.30, 0.30, 0.26]], [900, [0.34, 0.33, 0.30]], [1800, [0.44, 0.45, 0.46]], [1e9, [0.86, 0.88, 0.90]]],
    vegHue: [0.29, 0.05], vegLit: [0.13, 0.12],
    sun: 0xfff2e0, sunI: 1.6, hemiSky: 0xc4d8f2, hemiGnd: 0x5a5e58, hemiI: 1.05,
  },
};
let biome: Biome = BIOMES.temperate;
/** The latitude guess. It is a poor one — it gives a whole world ONE palette,
 *  so the Sahara and the Nile delta came out identical — but it is what stands
 *  in until real land cover arrives, and cover is never guaranteed. */
function pickBiome(lat: number, elevAbs: number): Biome {
  const q = new URLSearchParams(location.search).get('biome');
  if (q && BIOMES[q]) return BIOMES[q];
  if (elevAbs > 1500) return BIOMES.alpine;
  const a = Math.abs(lat);
  if (a <= 15) return BIOMES.tropical;
  if (a <= 32) return BIOMES.arid;
  if (a <= 50) return BIOMES.temperate;
  return BIOMES.boreal;
}
/** …and the answer, once WorldCover has landed: what is actually growing over
 *  the ground around you. Latitude still breaks the ties a cover class cannot —
 *  forest is boreal at 60° and jungle at 5°, and the pixel says only "trees". */
function biomeFromCover(lat: number, elevAbs: number): Biome | null {
  if (new URLSearchParams(location.search).get('biome')) return null;  // art direction wins
  const hist = new Map<number, number>();
  let n = 0;
  for (let dz = -2400; dz <= 2400; dz += 200) {
    for (let dx = -2400; dx <= 2400; dx += 200) {
      const c = sampleCover(state.x + dx, state.z + dz);
      if (c === null) continue;
      hist.set(c, (hist.get(c) ?? 0) + 1); n++;
    }
  }
  if (n < 40) return null;                              // not enough cover to judge on
  // Water and built-up say nothing about climate — a harbour and a city sit in
  // whatever biome surrounds them — so they get no vote.
  let top = 0, best = 0;
  for (const [c, k] of hist) {
    if (c === COVER.water || c === COVER.built || !c) continue;
    if (k > best) { best = k; top = c; }
  }
  if (!top) return null;
  const a = Math.abs(lat);
  if (top === COVER.snow || elevAbs > 2000) return BIOMES.alpine;
  if (top === COVER.mangrove) return BIOMES.tropical;
  if (top === COVER.bare) return BIOMES.arid;
  if (top === COVER.shrub) return a >= 55 ? BIOMES.boreal : BIOMES.arid;
  if (top === COVER.moss) return elevAbs > 1200 ? BIOMES.alpine : BIOMES.boreal;
  if (top === COVER.tree || top === COVER.wetland) {
    return a <= 20 ? BIOMES.tropical : a >= 52 ? BIOMES.boreal : BIOMES.temperate;
  }
  // Grass and cropland are temperate almost everywhere, but savannah is real.
  if (top === COVER.grass) return a <= 18 ? BIOMES.tropical : a >= 58 ? BIOMES.boreal : BIOMES.temperate;
  return BIOMES.temperate;
}
// Settled ONCE, the first time cover reaches the car. Re-picking mid-drive
// would pop the sky, the haze and the light together, and a seam you can see is
// worse than a biome that is a shade wrong for the last mile of a long crossing.
let biomeSettled = false;

// Where each land-cover class pulls the ground colour. Deliberately muted and
// inside the existing solarpunk range: these are a shift in character, not a
// satellite photograph. Bare has no entry — the ramp is already sand and rock,
// which is exactly what bare ground is.
const COVER_TINT: Record<number, Rgb> = {
  10: [0.16, 0.26, 0.15],   // tree      — deep canopy
  20: [0.34, 0.33, 0.19],   // shrub     — olive scrub
  30: [0.40, 0.42, 0.22],   // grass     — dry sward
  40: [0.46, 0.41, 0.18],   // crop      — worked earth and stubble
  50: [0.38, 0.37, 0.35],   // built     — the grey of a made surface
  70: [0.86, 0.89, 0.93],   // snow
  80: [0.13, 0.29, 0.34],   // water
  90: [0.24, 0.30, 0.22],   // wetland
  95: [0.15, 0.27, 0.20],   // mangrove
  100: [0.36, 0.38, 0.32],  // moss/lichen
};
const COVER_MIX = 0.55;     // how far toward the tint the biome ramp is pulled
const terrainPalette = (elev: number, slope: number, cover?: number | null): [number, number, number] => {
  // Solarpunk desert: cyan shallows → warm sand → ochre scrub → dry upland →
  // bare rock → snow. The emerald in this world comes from the VEGETATION
  // standing on the sand, not from painting the ground green.
  let c: Rgb = biome.ramp[biome.ramp.length - 1][1];
  // THE SHALLOWS BAND IS ABOUT WATER, NOT ABOUT ALTITUDE. Every ramp opens
  // with a cyan for ground at or below sea level, which is right on a coast
  // and catastrophic in a basin: Death Valley's floor is 86m down, so the
  // whole of it — salt pan, alluvial fan, the road itself — came out painted
  // as sea shallows, and every screenshot of it looked like a flood. Where
  // this world has already proved it has dry land below sea level, skip
  // straight to the land colours.
  const start = dryAt ? 1 : 0;
  for (let i = start; i < biome.ramp.length; i++) {
    const [max, col] = biome.ramp[i];
    if (elev <= max || i === biome.ramp.length - 1) { c = col; break; }
  }
  // WHAT IS ACTUALLY GROWING ON IT. The elevation ramp knows how high the
  // ground is and nothing else, so farmland, forest and salt pan at the same
  // altitude came out the same colour. Cover pulls the ramp toward the real
  // character of the ground — but only PART of the way, because the ramp is
  // where the art direction lives and a photographic land-cover map would
  // flatten the whole look. Data sets the fact; the palette keeps the feel.
  if (cover !== null && cover !== undefined) {
    const t = COVER_TINT[cover];
    if (t) c = [c[0] + (t[0] - c[0]) * COVER_MIX, c[1] + (t[1] - c[1]) * COVER_MIX, c[2] + (t[2] - c[2]) * COVER_MIX];
  }
  const shade = 1 - clamp(slope * 1.4, 0, 0.45);
  return [c[0] * shade, c[1] * shade, c[2] * shade];
};

// ── the scene ──────────────────────────────────────────────────────
const canvas = $('scene') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070c);
const camera = new THREE.PerspectiveCamera(55, 1, 1, 30000);
// The near plane moves with the chart camera; only rebuild the projection when
// it actually changes, since every uniform derived from it follows.
let nearLock = 0;   // test handle: force a near plane to measure the difference
function setNear(n: number, far = 30000): void {
  if (nearLock) n = nearLock;
  if (Math.abs(camera.near - n) < n * 0.02 && camera.far === far) return;
  camera.near = n;
  // The FAR plane has to move too. A camera 43km up over a chart at full zoom
  // sits well outside a fixed 30km frustum and clips the entire world away —
  // which is what raising the zoom ceiling would otherwise have bought.
  camera.far = far;
  camera.updateProjectionMatrix();
}

// ── sky ────────────────────────────────────────────────────────────
// A real sky, not a backdrop color: gradient dome with the sun sitting low
// on the horizon (mostly north-ish so the default chase view catches it),
// and the scene's directional light aimed from the same place.
// GOLDEN HOUR, not night: the sun climbs off the horizon so the world is lit
// rather than merely silhouetted, while keeping the long warm rake.
// WHERE THE SUN ACTUALLY IS. This was a constant — altitude 19.9°, azimuth 28°,
// on every point of the Earth, forever. Measured against the real thing at one
// instant: 43° wrong in elevation over Death Valley, and four of five test
// spawns should have been in the dark while the game rendered mid-afternoon.
//
// It needs NO DATASET AND NO NETWORK: solar position is arithmetic on the date
// and the place, good to well under a degree, and about forty lines. And the
// sky shader was already written for a moving sun — it warms the horizon toward
// the sun's azimuth, draws the disc from a dot product, and lights its cloud
// layer by sampling the noise field offset TOWARD the sun. Nothing is baked.
// The vector below is MUTATED IN PLACE rather than replaced, because every
// shader uniform holds a reference to this exact object; move it and the whole
// atmosphere follows for free.
const SUN_DIR = new THREE.Vector3(0.42, 0.34, -0.78).normalize();
// Where the LIGHT comes from, which below the horizon is not where the sun is.
const LIGHT_DIR = new THREE.Vector3().copy(SUN_DIR);
/** Sun altitude and azimuth for a place and an instant (NOAA's low-precision
 *  algorithm — a fraction of a degree, which is far finer than a pixel). */
function solarAngles(lat: number, lon: number, when: Date): { alt: number; az: number } {
  const d = when.getTime() / 86400000 + 2440587.5 - 2451545.0;   // days from J2000
  const rad = Math.PI / 180;
  const g = (357.529 + 0.98560028 * d) * rad;                    // mean anomaly
  const q = 280.459 + 0.98564736 * d;                            // mean longitude
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;  // ecliptic longitude
  const e = (23.439 - 0.00000036 * d) * rad;                     // obliquity
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;      // sidereal time at Greenwich
  const ha = ((gmst * 15 + lon) * rad) - ra;                     // local hour angle
  const la = lat * rad;
  const alt = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  return { alt, az };
}
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    sunDir: { value: SUN_DIR },
    uZenith: { value: new THREE.Vector3() },
    uHorizon: { value: new THREE.Vector3() },
    uSunDisc: { value: new THREE.Vector3() },
    uBelow: { value: new THREE.Vector3() },
    uCloud: { value: 0 }, uTime: { value: 0 },
    // The deck drifts on the REAL wind: direction and speed from the live
    // observation, so the sky moves the way the sky over that place is moving.
    uWind: { value: new THREE.Vector2(0.006, 0.0022) },
  },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform vec3 sunDir; uniform vec3 uZenith; uniform vec3 uHorizon;
    uniform vec3 uSunDisc; uniform vec3 uBelow; uniform float uCloud; uniform float uTime;
    uniform vec2 uWind;
    varying vec3 vDir;
    // Value-noise fBm. Clouds are GENERATED, not photographed: a skybox set
    // would be fixed images that could never answer to the weather system,
    // where this deck thickens, darkens and drifts with it — and inherits the
    // biome palette for free.
    float h21(vec2 p){ p = fract(p * vec2(127.31, 311.7)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
    float vnoise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
                 mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
    }
    float fbm(vec2 p){
      float a = 0.5, s = 0.0;
      for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.07; a *= 0.5; }
      return s;
    }
    void main(){
      vec3 d = normalize(vDir);
      float az = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0), 3.0);
      vec3 hor = mix(uHorizon, uSunDisc * 0.86, az);   // horizon warming toward the sun
      vec3 col = mix(hor, uZenith, pow(clamp(d.y, 0.0, 1.0), 0.42));
      float sd = max(dot(d, sunDir), 0.0);
      // A BIG disc, the way pixel-art skies draw it — ~7° across with a broad
      // halo, not the 1° pinprick physical accuracy would give you.
      col += uSunDisc * smoothstep(0.9915, 0.9945, sd) * 1.5;
      col += uSunDisc * (pow(sd, 60.0) * 0.5 + pow(sd, 8.0) * 0.22);
      // ── cloud deck ──
      if (d.y > 0.015 && uCloud > 0.01) {
        // Project onto a flat deck: no parallax (the dome rides the camera),
        // which is right for cloud at altitude, and it stretches toward the
        // horizon exactly as a real deck does.
        vec2 p = d.xz / max(d.y, 0.05) * 1.4 + uWind * uTime;
        float n = fbm(p);
        // Coverage opens up as the front arrives; a storm nearly fills the sky.
        float cov = smoothstep(0.62 - uCloud * 0.42, 0.92 - uCloud * 0.30, n);
        // Fake lighting: sample again a step toward the sun — where the deck
        // thins in that direction the edge is lit, where it thickens it is base.
        float lit = clamp((n - fbm(p + normalize(sunDir.xz + vec2(0.001)) * 0.35)) * 3.2 + 0.5, 0.0, 1.0);
        vec3 base = mix(uZenith * 1.6, uSunDisc * 0.5, 0.35) * (1.0 - uCloud * 0.55);
        vec3 top = mix(vec3(0.86, 0.88, 0.92), uSunDisc, 0.35 + az * 0.4);
        vec3 cloud = mix(base, top, lit) * (1.0 - uCloud * 0.35);
        // Fade the deck out at the horizon so it never cuts a hard line.
        cov *= smoothstep(0.015, 0.16, d.y);
        col = mix(col, cloud, clamp(cov, 0.0, 1.0) * 0.95);
      }
      col = mix(uBelow, col, smoothstep(-0.06, 0.02, d.y));
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(20000, 32, 16), skyMat);
skyDome.frustumCulled = false;
skyDome.renderOrder = -10;
scene.add(skyDome);

const hemi = new THREE.HemisphereLight(0xbcd2ee, 0x6a5a3c, 0.72); // sky fill + ground bounce
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe0b0, 1.5);
sun.position.copy(SUN_DIR).multiplyScalar(2000);
scene.add(sun);

// ── the clock ──────────────────────────────────────────────────────
// LIVE means the real sun over the real place at the real moment, which is the
// point of the exercise. But a world you can only photograph at whatever
// o'clock it happens to be is a world you cannot art-direct, so the dial and
// `?t=` force a LOCAL SOLAR hour: noon is when the sun crosses the meridian
// HERE, which is what makes "noon" mean the same thing in Bormio and Borneo.
const TIME_MODES = ['LIVE', 'DAWN', 'NOON', 'DUSK', 'NIGHT'] as const;
const TIME_HOUR: Record<number, number | null> = { 0: null, 1: 6, 2: 12, 3: 18, 4: 0 };
let timeMode = 0;
// Read here, APPLIED AFTER the dials load — see the boot sequence. A dial that
// remembers itself in localStorage will otherwise stamp on the query parameter.
const timeFromUrl = TIME_MODES.indexOf(
  ((new URLSearchParams(location.search).get('t') ?? '').toUpperCase()) as typeof TIME_MODES[number]);
if (timeFromUrl >= 0) timeMode = timeFromUrl;
function worldNow(): Date {
  const h = TIME_HOUR[timeMode];
  if (h === null) return new Date();
  // Local solar hour → UTC. Longitude is the whole of the conversion: the sun
  // is over the meridian at local solar noon by definition.
  const now = new Date();
  const utcH = h - origin.lon / 15;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)
    + utcH * 3600000);
}
// Night sky, for the colours the biome only supplies in daylight versions.
const NIGHT_SKY: { zenith: Rgb; horizon: Rgb; disc: Rgb; below: Rgb } = {
  zenith: [0.010, 0.017, 0.042], horizon: [0.045, 0.055, 0.095],
  disc: [0.20, 0.23, 0.31],       // a cold glow, never a second sun
  below: [0.015, 0.017, 0.028],
};
/** 0 in the dark, 1 in open daylight, smooth across civil twilight. Everything
 *  that used to be a fixed brightness is scaled by this. */
let dayF = 1;
let sunAlt = 0.35, sunAz = 0.5;
const sunSetV = new THREE.Vector3();
function stepSun(): void {
  const { alt, az } = solarAngles(origin.lat, origin.lon, worldNow());
  sunAlt = alt; sunAz = az;
  // World axes: +x east, −z north. Azimuth runs from north through east.
  const ca = Math.cos(alt);
  SUN_DIR.set(ca * Math.sin(az), Math.sin(alt), -ca * Math.cos(az));
  // TWO VECTORS, and conflating them put a moon the size of a hillside in the
  // night sky. SUN_DIR is where the sun ACTUALLY IS — the sky shader draws its
  // disc from it, so below the horizon there is correctly no disc at all. The
  // LIGHT is a different question: it must still come from above or the terrain
  // is lit from underneath and every hill turns inside out, so at night it
  // keeps the compass bearing and takes a shallow rake. That is moonlight.
  LIGHT_DIR.copy(SUN_DIR);
  if (LIGHT_DIR.y < 0.02) {
    sunSetV.set(LIGHT_DIR.x, 0, LIGHT_DIR.z).normalize().multiplyScalar(0.93);
    LIGHT_DIR.set(sunSetV.x, 0.36, sunSetV.z).normalize();
  }
  sun.position.copy(LIGHT_DIR).multiplyScalar(2000);
  const sxz = skyMat.uniforms.sunXZ as { value: THREE.Vector2 } | undefined;
  if (sxz) sxz.value.set(LIGHT_DIR.x, LIGHT_DIR.z).normalize();
  const degs = (alt * 180) / Math.PI;
  dayF = clamp((degs + 6) / 9, 0, 1);              // civil twilight is −6° to +3°
  // GOLDEN HOUR IS NOT A FILTER. Low sun travels through more atmosphere, so it
  // reddens — the same physics that makes the horizon warm in the sky shader.
  const low = clamp(1 - degs / 12, 0, 1);
  const warm = new THREE.Color(biome.sun).lerp(new THREE.Color(0xff7a2e), low * 0.75);
  sun.color.copy(dayF > 0.02 ? warm : new THREE.Color(0x9fb4d8));   // moonlight is cold
  applySkyTint();
}
/** The biome's daylight palette, faded toward night by the sun's altitude. */
function applySkyTint(): void {
  const b = biome;
  const mix = (a: Rgb, c: Rgb): THREE.Vector3 =>
    new THREE.Vector3(a[0] + (c[0] - a[0]) * dayF, a[1] + (c[1] - a[1]) * dayF, a[2] + (c[2] - a[2]) * dayF);
  const u = skyMat.uniforms as Record<string, { value: THREE.Vector3 }>;
  u.uZenith.value.copy(mix(NIGHT_SKY.zenith, b.zenith));
  u.uHorizon.value.copy(mix(NIGHT_SKY.horizon, b.horizon));
  u.uSunDisc.value.copy(mix(NIGHT_SKY.disc, b.sunDisc));
  u.uBelow.value.copy(mix(NIGHT_SKY.below, b.below));
  const c = compMat.uniforms as Record<string, { value: THREE.Vector3 }>;
  c.uHazeBase.value.copy(mix(NIGHT_SKY.zenith, b.hazeBase));
  c.uHazeSun.value.copy(mix(NIGHT_SKY.horizon, b.hazeSun));
}

const worldGroup = new THREE.Group();
worldGroup.name = 'world';   // so a pick can say WHERE a mesh came from
scene.add(worldGroup);

let resizePost: (() => void) | null = null; // set by the atmosphere pipeline below
function resize(): void {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  resizePost?.();
}
addEventListener('resize', resize);
resize();

// ── fog of war ─────────────────────────────────────────────────────
const fogCanvas = document.createElement('canvas');
fogCanvas.width = fogCanvas.height = FOG_PX;
const fogCtx = fogCanvas.getContext('2d')!;
fogCtx.fillStyle = 'rgba(4,6,11,0.985)';
fogCtx.fillRect(0, 0, FOG_PX, FOG_PX);
const fogTex = new THREE.CanvasTexture(fogCanvas);
// ── atmosphere pipeline (fog of war as depth, not a veil) ──────────
// The fog is a POST-PROCESS now. A transparent overlay could only dim at one
// flat opacity, which read as a grey wall pasted on the screen. Instead the
// scene renders to a target, a half-res blurred copy is built from it, and a
// composite pass reconstructs each pixel's GROUND point through the camera
// (so the fog stays pinned to the world at any zoom or tilt) and mixes
// sharp -> blurred -> haze by how far and how unexplored that point is:
// distance genuinely blurs and dims, and the haze warms toward the sun.
const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const rtType = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float')
  ? THREE.HalfFloatType
  : THREE.UnsignedByteType;
const mkRT = (depth: boolean, nearest = false): THREE.WebGLRenderTarget => {
  const rt = new THREE.WebGLRenderTarget(2, 2, { type: rtType, depthBuffer: depth });
  rt.texture.minFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  rt.texture.magFilter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  return rt;
};
// PIXEL GRID. The scene is rendered into a genuinely low-resolution buffer and
// magnified with NearestFilter — that is what pixelates GEOMETRY EDGES, which
// no amount of low-res texturing can do on its own. It also costs a fraction
// of the fill rate, which buys back everything the post chain spends.
let PIX_H = 320; // vertical resolution of the rendered world — a live dial
// The live pixel-grid size. Shared BY REFERENCE with the composite's uniform,
// so resize can run before the material exists without any ordering dance.
const pixSize = new THREE.Vector2(2, 2);
const rtScene = mkRT(true, true);
rtScene.samples = 0; // MSAA would soften exactly the edges we want hard
// Real per-pixel depth: fog by each pixel's TRUE distance, not by where its
// screen ray meets the ground plane — otherwise a tall building far away gets
// a haze seam across it (fogged base, "sky-crisp" top).
rtScene.depthTexture = new THREE.DepthTexture(2, 2);
const rtA = mkRT(false), rtB = mkRT(false);
const rtC = mkRT(false), rtD = mkRT(false); // bright-pass ping-pong for bloom
resizePost = () => {
  const h = Math.min(PIX_H, Math.round(innerHeight));
  const w = Math.max(2, Math.round((innerWidth / innerHeight) * h));
  rtScene.setSize(w, Math.max(2, h));
  rtA.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
  rtB.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
  rtC.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
  rtD.setSize(Math.max(2, w >> 1), Math.max(2, h >> 1));
  pixSize.set(w, Math.max(2, h));
};
resizePost();
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadScene = new THREE.Scene();
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
quad.frustumCulled = false;
quadScene.add(quad);
const runPass = (mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void => {
  quad.material = mat;
  renderer.setRenderTarget(target);
  renderer.render(quadScene, quadCam);
};
const blurMat = new THREE.ShaderMaterial({
  uniforms: { src: { value: null }, dirPx: { value: new THREE.Vector2() } },
  vertexShader: QUAD_VS,
  fragmentShader: `
    uniform sampler2D src; uniform vec2 dirPx; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(src, vUv).rgb * 0.2270270270;
      vec2 o1 = dirPx * 1.3846153846, o2 = dirPx * 3.2307692308;
      c += (texture2D(src, vUv + o1).rgb + texture2D(src, vUv - o1).rgb) * 0.3162162162;
      c += (texture2D(src, vUv + o2).rgb + texture2D(src, vUv - o2).rgb) * 0.0702702703;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
// Bright-pass for bloom: keep only what is genuinely emitting — the sun disc,
// lamps, tail lights, the solar array's specular. Everything else is lit
// surface and must not smear.
const brightMat = new THREE.ShaderMaterial({
  uniforms: { src: { value: null }, uCut: { value: 0.62 } },
  vertexShader: QUAD_VS,
  fragmentShader: `
    uniform sampler2D src; uniform float uCut; varying vec2 vUv;
    void main(){
      vec3 c = texture2D(src, vUv).rgb;
      float b = max(c.r, max(c.g, c.b));
      gl_FragColor = vec4(c * smoothstep(uCut, uCut + 0.35, b), 1.0);
    }`,
});
const compMat = new THREE.ShaderMaterial({
  uniforms: {
    sceneTex: { value: null },
    softTex: { value: null },
    depthTex: { value: rtScene.depthTexture },
    mask: { value: fogTex },
    invPV: { value: new THREE.Matrix4() },
    camPos: { value: new THREE.Vector3() },
    span: { value: FOG_SPAN },
    sunXZ: { value: new THREE.Vector2(LIGHT_DIR.x, LIGHT_DIR.z).normalize() },
    uPix: { value: pixSize }, // the low-res grid, for dithering
    uHazeBase: { value: new THREE.Vector3() },
    uHazeSun: { value: new THREE.Vector3() },
    bloomTex: { value: null },
    uFlash: { value: 0 },
    uSunUv: { value: new THREE.Vector2(0.5, 1.4) },
    uSunVis: { value: 0 },
    uBloom: { value: 0.75 },
    uScan: { value: 0.06 },
    uLevels: { value: 14 },
    uFow: { value: 0 },
    uFlare: { value: 1 },
  },
  vertexShader: QUAD_VS,
  fragmentShader: `
    uniform sampler2D sceneTex; uniform sampler2D softTex; uniform sampler2D depthTex;
    uniform sampler2D bloomTex; uniform float uBloom; uniform float uScan;
    uniform float uLevels; uniform float uFow; uniform float uFlare;
    uniform float uFlash; uniform vec2 uSunUv; uniform float uSunVis;
    uniform sampler2D mask; uniform mat4 invPV; uniform vec3 camPos; uniform float span;
    uniform vec2 sunXZ; uniform vec2 uPix; uniform vec3 uHazeBase; uniform vec3 uHazeSun; varying vec2 vUv;
    vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
    // Ordered (Bayer) dither, computed without array indexing so it compiles
    // on GLSL ES 1.0. Recursive 2x2 → 4x4.
    float bayer2(vec2 a){ a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
    float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    vec3 hazeAt(vec3 d){
      // Sun-warming only for rays that travel HORIZONTALLY through air. A
      // near-vertical ray has a near-zero xz to normalize — noise blew up
      // into a starburst at the nadir and painted half the chart brown.
      float horiz = clamp(length(d.xz) * 1.6, 0.0, 1.0);
      vec2 dir2 = d.xz / max(length(d.xz), 1e-4);
      float w = pow(max(dot(dir2, sunXZ), 0.0), 3.0) * horiz * horiz;
      return mix(uHazeBase, uHazeSun, w); // the biome's haze, warming toward the sun
    }
    void main(){
      vec3 sharp = texture2D(sceneTex, vUv).rgb;
      vec3 soft = texture2D(softTex, vUv).rgb;
      float z = texture2D(depthTex, vUv).r;
      vec4 far = invPV * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec3 dir = normalize(far.xyz / far.w - camPos);
      vec3 col;
      if (z >= 0.99995) {
        // Nothing drawn here (the sky dome writes no depth): crisp sky with a
        // soft luminous band hugging the horizon.
        float band = exp(-abs(dir.y) * 26.0);
        col = mix(sharp, mix(soft, hazeAt(dir), 0.5), band * 0.5);
      } else {
        // Fog by the pixel's TRUE surface point: distance sets how much it
        // blurs and dims (aerial perspective); the fog-of-war mask at that
        // point sets how much is hidden. Buildings fog as whole objects.
        vec4 wp4 = invPV * vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
        vec3 wp = wp4.xyz / wp4.w;
        float t = distance(wp, camPos);
        vec2 uv = (wp.xz + span * 0.5) / span;
        float m = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? 1.0 : texture2D(mask, uv).a / 0.985;
        // uFow 0 hands the whole world over as explored, leaving only aerial
        // perspective — the fog of war becomes a setting rather than a law.
        m *= uFow;
        // Fog of war starts BEYOND a clear bubble. You can obviously see the
        // ground at your own wheels whether or not you have "explored" it; a
        // ramp that began at zero metres put 55% milk over the near field the
        // moment the haze turned daylight-bright.
        // A LONG, soft falloff. A 300m ramp meant the world ended just past
        // the next junction; over ~900m the fog reads as distance rather than
        // as a wall, and a ridge two kilometres out is still a suggestion.
        float near = 1.0 - exp(-max(t - 260.0, 0.0) / 900.0);
        // Aerial perspective scales with how much AIR the ray crosses — a
        // survey view straight down stays legible at any zoom, the horizon
        // keeps its haze. (Fog-of-war hiding is m-driven and unaffected.)
        float vFac = clamp(1.4 - abs(dir.y) * 1.3, 0.15, 1.0);
        float deep = (1.0 - exp(-t / 1400.0)) * vFac;
        float blurF = clamp(m * (0.1 + 0.9 * near) + deep * 0.3, 0.0, 1.0);
        // Never fully opaque: the unexplored world stays a SUGGESTION behind
        // the haze — you can make out a coastline or a ridge to steer toward.
        float dimF = min(m * mix(0.10, 0.86, near) + (1.0 - m) * deep * 0.3, 0.86);
        col = mix(sharp, soft, blurF);
        col = mix(col, hazeAt(dir), dimF);
      }
      // Never hand a negative (or NaN) to pow(): one bad fragment upstream
      // must not be able to punch a black hole through the finished frame.
      col = max(col, vec3(0.0));
      // BLOOM: added in linear space, before the tonemap, so a bright lamp
      // blooms into the haze around it rather than onto the finished image.
      col += texture2D(bloomTex, vUv).rgb * uBloom;
      // LENS FLARE — restrained, and only when the sun is actually in frame
      // and unoccluded. Three ghosts stepped along the sun-to-centre axis plus
      // a soft horizontal streak; the palette quantiser downstream turns them
      // into flat rings rather than a modern lens sim.
      // Occluded by terrain or a building? Then there is no flare — one depth
      // fetch at the sun's own screen position settles it.
      float sunVis = uSunVis * step(0.99985, texture2D(depthTex, clamp(uSunUv, 0.0, 1.0)).r);
      if (sunVis > 0.001) {
        vec2 axis = vec2(0.5) - uSunUv;
        float f = 0.0;
        f += smoothstep(0.10, 0.0, length(vUv - (uSunUv + axis * 0.36))) * 0.55;
        f += smoothstep(0.055, 0.0, length(vUv - (uSunUv + axis * 0.72))) * 0.40;
        f += smoothstep(0.13, 0.0, length(vUv - (uSunUv + axis * 1.28))) * 0.20;
        float dy = abs(vUv.y - uSunUv.y);
        f += smoothstep(0.006, 0.0, dy) * smoothstep(0.6, 0.0, abs(vUv.x - uSunUv.x)) * 0.28;
        col += mix(vec3(1.0, 0.82, 0.52), vec3(0.55, 0.85, 1.0), 0.35) * f * sunVis * 0.085 * uFlare;
      }
      col += vec3(0.85, 0.90, 1.0) * uFlash;   // lightning fills the whole frame
      vec3 enc = srgb(col);
      // GRADE. Physically-correct lighting through a haze lands flat and
      // milky; the reference art is saturated with deep shadows. Saturation
      // lift plus a contrast S-curve, applied before quantisation so the
      // palette steps land on the graded image rather than the raw one.
      float l = dot(enc, vec3(0.299, 0.587, 0.114));
      enc = clamp(mix(vec3(l), enc, 1.35), 0.0, 1.0);
      enc = clamp((enc - 0.5) * 1.18 + 0.47, 0.0, 1.0);
      // PALETTE QUANTISATION with an ordered dither, in perceptual space and
      // keyed to the LOW-RES grid (not the screen), so the dither pattern is
      // one texel per step. This is the difference between authored pixel art
      // and a merely pixelated render: flat bands of colour, gradients broken
      // up by a visible weave rather than a smooth ramp.
      // Partial-amplitude dither: full strength turned every flat surface into
      // a visible checkerboard once magnified. 0.6 keeps the weave in
      // gradients while flat areas stay flat.
      float d = (bayer4(floor(vUv * uPix)) - 0.5) * 0.6;
      enc = floor(enc * uLevels + d + 0.5) / uLevels;
      // Scanlines on the PIXEL grid (every other buffer row), so they scale
      // with the art instead of shimmering against the display's real pixels.
      enc *= 1.0 - uScan * mod(floor(vUv.y * uPix.y), 2.0);
      gl_FragColor = vec4(clamp(enc, 0.0, 1.0), 1.0);
    }`,
});
let lastRevealX = Infinity, lastRevealZ = Infinity;
// One soft punch at a world point.
function revealStamp(ex: number, ez: number): void {
  const px = ((ex + FOG_SPAN / 2) / FOG_SPAN) * FOG_PX;
  // flipY: CanvasTexture uploads row 0 at v=1, so +z (v up) writes low rows.
  const pz = FOG_PX - ((ez + FOG_SPAN / 2) / FOG_SPAN) * FOG_PX;
  const pr = (REVEAL_M / FOG_SPAN) * FOG_PX;
  const grad = fogCtx.createRadialGradient(px, pz, pr * 0.15, px, pz, pr);
  // FULLY opaque core, long feather. The core must reach 1.0 or the swath you
  // drive through never clears completely — a 0.85 core left permanent haze
  // that no amount of driving could scrub off. The feather is what keeps
  // overlapping stamps integrating smoothly instead of reading as discs.
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.92)');
  grad.addColorStop(0.75, 'rgba(0,0,0,0.4)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  fogCtx.globalCompositeOperation = 'destination-out';
  fogCtx.fillStyle = grad;
  fogCtx.beginPath();
  fogCtx.arc(px, pz, pr, 0, Math.PI * 2);
  fogCtx.fill();
  fogCtx.globalCompositeOperation = 'source-over';
}
function reveal(ex: number, ez: number): void {
  const step = REVEAL_M * 0.06; // ~9m — dense enough that stamps blur together
  const d = Math.hypot(ex - lastRevealX, ez - lastRevealZ);
  if (d < step) return;
  if (!Number.isFinite(lastRevealX)) {
    revealStamp(ex, ez);
  } else {
    // STAMP ALONG THE PATH, not just at the new position: at 180km/h a frame
    // covers 50m, so discrete punches left scalloped gaps behind the car.
    const n = Math.min(24, Math.ceil(d / step));
    for (let i = 1; i <= n; i++) {
      revealStamp(lastRevealX + ((ex - lastRevealX) * i) / n, lastRevealZ + ((ez - lastRevealZ) * i) / n);
    }
  }
  lastRevealX = ex; lastRevealZ = ez;
  fogTex.needsUpdate = true;
}

// ── ghosting (x-ray along the camera→car sight line) ───────────────
// When a hill (or the ground above a tunnel) sits between the viewer and the
// car, its fragments dissolve into a screen-door pattern so the car stays
// visible. Patched into the terrain/green materials via onBeforeCompile.
const ghostU = {
  uGhostCar: { value: new THREE.Vector3() },
  uGhostCam: { value: new THREE.Vector3() },
  uCloudS: { value: 0 },                       // cover, for cloud shadows
  uWind: { value: new THREE.Vector2() },       // the deck's drift, shared with the sky
};
// (Pattern per SimonDev's "customizing materials": extend the built-ins by
// splicing GLSL into their chunk includes rather than rewriting materials —
// the same hook carries the ghost corridor and the terrain's detail mottle.)
function ghostify(mat: THREE.Material, opts: { detail?: boolean } = {}): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGhostCar = ghostU.uGhostCar;
    sh.uniforms.uGhostCam = ghostU.uGhostCam;
    sh.uniforms.uCloudS = ghostU.uCloudS;
    sh.uniforms.uWind = ghostU.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGhostW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGhostW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGhostW; uniform vec3 uGhostCar; uniform vec3 uGhostCam;
        uniform float uCloudS; uniform vec2 uWind;
        float gh21(vec2 p){ p = fract(p * vec2(127.31, 311.7)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
        float gvn(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(gh21(i), gh21(i + vec2(1.0, 0.0)), f.x),
                     mix(gh21(i + vec2(0.0, 1.0)), gh21(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float gfbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * gvn(p); p *= 2.07; a *= 0.5; } return s; }`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
      // CLOUD SHADOWS: the same kind of noise the sky draws its deck from,
      // projected on the ground and drifting on the same wind — so shadow
      // patches sweep across the terrain as a front comes over.
      if (uCloudS > 0.01) {
        float cs = gfbm(vGhostW.xz * 0.0035 + uWind);
        gl_FragColor.rgb *= 1.0 - uCloudS * smoothstep(0.42, 0.72, cs) * 0.5;
      }
      {
        vec3 ab = uGhostCar - uGhostCam;
        float t = dot(vGhostW - uGhostCam, ab) / max(dot(ab, ab), 1.0);
        if (t > 0.05 && t < 0.97) {
          vec3 p = uGhostCam + ab * t;
          // Only fragments that rise ABOVE the sight line are occluders —
          // without the height test the corridor dissolved the ordinary
          // ground grazing beneath the ray in chase cam.
          float gDist = length(vGhostW.xz - p.xz);
          float gRad = 6.0 + t * 8.0;
          if (gDist < gRad && vGhostW.y > p.y - 0.3) {
            // 50% screen-door at the fringe, 75% in the core: a single
            // checkerboard left the truck readable as a silhouette but the
            // road under it as murk — "ghosted" was only ever half done.
            if (mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 1.0) discard;
            if (gDist < gRad * 0.55 && mod(floor(gl_FragCoord.y), 2.0) < 1.0) discard;
          }
        }
      }`);
    if (opts.detail) {
      // World-space mottle (~30–80m blobs) breaks the flat-shaded banding of
      // the vertex-colored terrain without any texture upload.
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec2 gp = vGhostW.xz;
        float gn = sin(gp.x * 0.131 + sin(gp.y * 0.093) * 2.0) * sin(gp.y * 0.117 + sin(gp.x * 0.071) * 2.0);
        diffuseColor.rgb *= 0.955 + 0.045 * gn;
      }`);
    }
  };
}
// A procedural NORMAL MAP gives the terrain surface relief the 9.5m-per-pixel
// heightfield can never carry — tussocks and stony ground catching the low
// sun. Built from a summed-octave value-noise height field, differentiated
// into tangent-space normals. Deterministic, ~40kB of canvas, no download.
function normalTex(size: number, seed: number, octaves: number, strength: number, repeat: number): THREE.Texture {
  const r = mulberry32(seed);
  // Wrapping value noise: a lattice of random values, bilinearly interpolated
  // with a smoothstep fade, tiled so the texture repeats seamlessly.
  const lattice = (g: number): Float32Array => {
    const a = new Float32Array(g * g);
    for (let i = 0; i < a.length; i++) a[i] = r();
    return a;
  };
  const h = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const g = 4 << o;               // lattice resolution doubles each octave
    const L = lattice(g);
    const f = (t: number): number => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * g, y0 = Math.floor(gy), fy = f(gy - y0);
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * g, x0 = Math.floor(gx), fx = f(gx - x0);
        const i00 = L[(y0 % g) * g + (x0 % g)], i10 = L[(y0 % g) * g + ((x0 + 1) % g)];
        const i01 = L[((y0 + 1) % g) * g + (x0 % g)], i11 = L[((y0 + 1) % g) * g + ((x0 + 1) % g)];
        h[y * size + x] += amp * ((i00 * (1 - fx) + i10 * fx) * (1 - fy) + (i01 * (1 - fx) + i11 * fx) * fy);
      }
    }
    total += amp;
    amp *= 0.55;
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx2 = cv.getContext('2d')!;
  const img = ctx2.createImageData(size, size);
  const at = (x: number, y: number): number => h[((y + size) % size) * size + ((x + size) % size)] / total;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Central differences → slope → tangent-space normal, packed to 0..255.
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
    img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
    img.data[i + 2] = (1 / len) * 0.5 * 255 + 127.5;
    img.data[i + 3] = 255;
  }
  ctx2.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  return t;
}
const terrainMat = new THREE.MeshLambertMaterial({
  vertexColors: true,
  normalMap: normalTex(256, 9001, 4, 9, 70), // tile UVs are 0..1 over ~2.4km ⇒ ~34m per repeat
  normalScale: new THREE.Vector2(0.32, 0.32), // relief, not crumpled foil
});
ghostify(terrainMat, { detail: true });

// ── terrain meshes ─────────────────────────────────────────────────
const terrainReady = new Map<string, Promise<void>>(); // per-tile load promise
const terrainMeshes = new Map<string, THREE.Mesh>();
function buildTerrainMesh(t: HeightTile): void {
  const key = `${t.tx}/${t.ty}`;
  const SEG = TERRAIN_SEG;
  const geo = new THREE.PlaneGeometry(t.w, t.h, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const cxm = t.xs + t.w / 2, czm = t.zs + t.h / 2;
  const cell = t.w / SEG;
  for (let i = 0; i < pos.count; i++) {
    const ex = pos.getX(i) + cxm, ez = pos.getZ(i) + czm;
    // The SAME bilinear field the roads/buildings/car sample (groundAt) —
    // a nearest-pixel mesh disagreed with it by metres and swallowed every
    // draped layer under the terrain skin. groundAt also applies the road
    // corridor cut, so a hillside can never stand in a carriageway's airspace.
    const cv = sampleCover(ex, ez);
    let elev = groundAt(ex, ez);
    // GIVE THE SEA A FLOOR. The elevation source carries no bathymetry: it
    // fills the ocean with a flat plate AT the waterline, so once the water
    // plane was placed correctly the Pacific rendered as a 40cm lagoon over
    // its own bed — measured 0.4m deep for two kilometres straight out. Where
    // cover says water, the bed drops to a depth that reads as sea. It only
    // ever lowers ground, and the step at the shoreline is itself underwater.
    //
    // ONLY THE SEA GETS A FLOOR. Cover calls mountain rivers and tarns water
    // too, and they run hundreds of metres above sea level — cutting those to
    // the waterline carves a chasm down the hillside they sit on, and leaves
    // whatever escaped the cut standing over it as a slab. So the cut applies
    // only where the ground is ALREADY at the water: within two metres of the
    // sea surface, which is precisely the flat ocean plate the DEM draws and
    // nothing else. That also makes it safe against a bad sea datum, which is
    // the failure that found this.
    if (cv === COVER.water) {
      const seaLocal = seaSurfaceAbs() - baseElev;
      if (elev <= seaLocal + 2) elev = Math.min(elev, seaLocal - SEA_BED);
    }
    const elevAbs = elev + baseElev;
    pos.setY(i, elev);
    const u = clamp(Math.round(((ex - t.xs) / t.w) * 255), 0, 255);
    const v = clamp(Math.round(((ez - t.zs) / t.h) * 255), 0, 255);
    const du = t.data[v * 256 + Math.min(255, u + 1)] - t.data[v * 256 + u];
    const dv = t.data[Math.min(255, v + 1) * 256 + u] - t.data[v * 256 + u];
    const [r, g, bb] = terrainPalette(elevAbs, Math.hypot(du, dv) / Math.max(cell, 1), cv);
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = bb;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const old = terrainMeshes.get(key);
  if (old) { worldGroup.remove(old); old.geometry.dispose(); }
  const mesh = new THREE.Mesh(geo, terrainMat);
  mesh.position.set(cxm, 0, czm);
  terrainMeshes.set(key, mesh);
  worldGroup.add(mesh);
}
// Rebuilds are not free — 16.6k vertices, each sampling the heightfield and
// asking the road grid whether it is in a cutting. A tile arriving used to
// rebuild all eight neighbours SYNCHRONOUSLY, and roads now want rebuilds too,
// so they queue instead and the main loop spends one per frame on them.
const terrainDirty = new Set<string>();
/** How far under the surface the seabed is dropped where cover says water.
 *  Deep enough to read as open sea through the water shader, shallow enough
 *  that the shelf at the shoreline stays a shelf rather than a trench. */
const SEA_BED = 6;
/** Every built terrain tile overlapping a world rectangle, marked for rebuild. */
function coverDirtiedTerrain(xs: number, zs: number, w: number, h: number): void {
  for (const [key, t] of heightTiles) {
    if (t.xs > xs + w || t.zs > zs + h || t.xs + t.w < xs || t.zs + t.h < zs) continue;
    markTerrainDirty(key);
  }
}
function markTerrainDirty(key: string): void {
  if (terrainMeshes.has(key)) terrainDirty.add(key);
}
// Every terrain tile a run of road passes through, plus a margin for the cut.
// Sampled, not exhaustive: terrain tiles are ~2km across and road vertices are
// 12m apart, so walking every one of them would ask the same question a hundred
// times per tile.
function dirtyTerrainAround(pts: Array<[number, number]>): void {
  for (let i = 0; i < pts.length; i += 8) {
    const [x, z] = pts[i];
    const [tx, ty] = tileAt(origin.lat - z / M_LAT, origin.lon + x / origin.mLon, TERRAIN_Z);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) markTerrainDirty(`${tx + dx}/${ty + dy}`);
  }
  const [lx, lz] = pts[pts.length - 1];
  const [tx, ty] = tileAt(origin.lat - lz / M_LAT, origin.lon + lx / origin.mLon, TERRAIN_Z);
  markTerrainDirty(`${tx}/${ty}`);
}
// One rebuild at a time, and never two in the same fifth of a second. A tile is
// ~9400 vertices, each sampling the heightfield and asking the road grid about
// cuttings — cheap enough to hide in a frame, not cheap enough to do every
// frame while a city streams in around you.
let terrainAt = 0;
function flushTerrain(now: number): void {
  if (now - terrainAt < 200) return;
  for (const key of terrainDirty) {
    terrainDirty.delete(key);
    const t = heightTiles.get(key);
    if (t) { terrainAt = now; buildTerrainMesh(t); return; }
  }
}
function loadTerrainTile(x: number, y: number): Promise<void> {
  const key = `${x}/${y}`;
  const existing = terrainReady.get(key);
  if (existing) return existing;
  const p = loadTerrainTileInner(x, y);
  terrainReady.set(key, p);
  return p;
}
async function loadTerrainTileInner(x: number, y: number): Promise<void> {
  const key = `${x}/${y}`;
  const data = await fetchHeights(x, y);
  if (!data) return;
  const b = tileBounds(x, y, TERRAIN_Z);
  const [wx0, wz0] = toLocal(b.latN, b.lonW);
  const [wx1, wz1] = toLocal(b.latS, b.lonE);
  const tile: HeightTile = { tx: x, ty: y, xs: Math.min(wx0, wx1), zs: Math.min(wz0, wz1), w: Math.abs(wx1 - wx0), h: Math.abs(wz1 - wz0), data };
  heightTiles.set(key, tile);
  buildTerrainMesh(tile);
  // A tile built before its neighbour arrived clamped its border strip.
  // Rebuild the loaded neighbours so both sides of every edge sample the
  // same cross-tile field — this is what stitches the seams shut.
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    if (!dx && !dy) continue;
    markTerrainDirty(`${x + dx}/${y + dy}`);
  }
}

// ── OSM vectors ────────────────────────────────────────────────────
const osmLoaded = new Set<string>();
// Keyed by STRING, not id: a clipped line is one key per vector tile it
// crosses, an area is its bare id.
const seenWays = new Set<string>();
/** Ribbons refused because the ground under them had not arrived. Should stay
 *  at or near zero once clipping is doing its job — a rising count means the
 *  gate is leaking again. */
let unbuilt = 0;
// THE TILE GATE. Two-at-a-time with a plain FIFO queue is what breaks a long
// drive: a slow tile (measured: 9–12.5s when the upstream rate-limits) holds
// half the pipe, a backlog forms, and FIFO then serves the tile you drove past
// forty seconds ago before the one under your bonnet. Six at a time, served
// NEAREST-FIRST to where the car is about to be, and anything that has fallen
// out of the ring while it waited is dropped rather than fetched.
const OSM_GATE = 6;
let osmInFlight = 0;
interface OsmWait { x: number; y: number; go: (run: boolean) => void }
const osmQueue: OsmWait[] = [];
/** Where tiles are wanted (the car thrown forward along its heading), and how
 *  far from the CAR a tile may sit before the queue gives up on it. */
let osmFocusX = 0, osmFocusZ = 0, osmCarX = 0, osmCarZ = 0, osmRingR = Infinity;
function osmRelease(): void {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < osmQueue.length; i++) {
    const w = osmQueue[i];
    const [wx, wz] = tileCentreLocal(w.x, w.y);
    if (Math.hypot(wx - osmCarX, wz - osmCarZ) > osmRingR) {
      osmQueue.splice(i, 1); i--;
      w.go(false);            // left the ring — forget it, a later pass can ask again
      continue;
    }
    const d = Math.hypot(wx - osmFocusX, wz - osmFocusZ);
    if (d < bestD) { bestD = d; best = i; }
  }
  if (best >= 0 && osmInFlight < OSM_GATE) osmQueue.splice(best, 1)[0].go(true);
}
// Full carriageway widths (both directions), not lane widths — OSM ways are
// centerlines, and rendering them single-lane narrow made the real-size car
// look like it straddled the whole street.
const ROAD_W: Record<string, number> = { motorway: 13, trunk: 12, primary: 10.5, secondary: 9.5, tertiary: 8.5, residential: 7.5, unclassified: 7, service: 4.5, living_street: 6.5, track: 6.5, footway: 4.5, path: 4.5, cycleway: 5, bridleway: 5, steps: 2.2, pedestrian: 6 };
// ── procedural detail textures (deterministic, weathered) ──────────
// Known details render as TEXTURE, not just flat colour — and the world is
// DECAYING GRACEFULLY: cracked asphalt with growth in the seams, crumbling
// walls with moss and vines, weathered roofs. Everything is generated from a
// seeded RNG (mulberry32), so the same crumbling world grows back identically
// on every device — the first brick of the solarpunk overhaul.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rng = () => number;
function canvasTex(size: number, repeatX: number, repeatY: number, seed: number, draw: (c: CanvasRenderingContext2D, s: number, r: Rng) => void): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size, mulberry32(seed));
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  // NEAREST everywhere: crisp texels are half the pixel look. Mipmapping stays
  // ON (nearest-within-mip) or distant surfaces shimmer as texels fall below
  // the pixel grid — the classic failure of naive pixel-art 3D.
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.repeat.set(repeatX, repeatY);
  return t;
}
function speckle(c: CanvasRenderingContext2D, s: number, r: Rng, colors: string[], n: number, rad = 1.6): void {
  for (let i = 0; i < n; i++) {
    c.fillStyle = colors[i % colors.length];
    c.fillRect(r() * s, r() * s, rad + r() * rad, rad + r() * rad);
  }
}
// A crack is a random walk with momentum — jagged, branchless, believable.
function cracks(c: CanvasRenderingContext2D, s: number, r: Rng, n: number, color: string): void {
  c.strokeStyle = color;
  c.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    let x = r() * s, y = r() * s, ang = r() * Math.PI * 2;
    c.beginPath();
    c.moveTo(x, y);
    for (let j = 0, steps = 4 + Math.floor(r() * 5); j < steps; j++) {
      ang += (r() - 0.5) * 1.2;
      x += Math.cos(ang) * (3 + r() * 6);
      y += Math.sin(ang) * (3 + r() * 6);
      c.lineTo(x, y);
    }
    c.stroke();
  }
}
// Moss/overgrowth: clustered soft blobs in layered greens.
function moss(c: CanvasRenderingContext2D, s: number, r: Rng, n: number, colors: string[]): void {
  for (let i = 0; i < n; i++) {
    const cx = r() * s, cy = r() * s, blob = 2 + r() * 5;
    for (let j = 0; j < 6; j++) {
      c.fillStyle = colors[j % colors.length];
      c.beginPath();
      c.arc(cx + (r() - 0.5) * blob * 2, cy + (r() - 0.5) * blob * 2, 1 + (r() * blob) / 2, 0, Math.PI * 2);
      c.fill();
    }
  }
}
// Road: u spans the width, v runs 20m per wrap — centre dash ≈ 8m on / 12m off,
// pale edge lines, cracked and patched, growth creeping in from the verges.
const roadTex = canvasTex(128, 1, 1, 101, (c, s, r) => {
  c.fillStyle = '#3a3f46'; c.fillRect(0, 0, s, s);
  speckle(c, s, r, ['rgba(255,255,255,0.045)', 'rgba(0,0,0,0.12)'], 260);
  for (let i = 0; i < 3; i++) { // tar patches over old repairs
    c.fillStyle = 'rgba(20,23,28,0.35)';
    c.fillRect(10 + r() * (s - 40), r() * s, 14 + r() * 22, 8 + r() * 14);
  }
  cracks(c, s, r, 6, 'rgba(12,14,18,0.5)');
  c.fillStyle = 'rgba(226,220,203,0.45)';
  c.fillRect(5, 0, 3, s); c.fillRect(s - 8, 0, 3, s);      // worn edge lines
  c.fillStyle = 'rgba(232,226,208,0.7)';
  c.fillRect(s / 2 - 2, 0, 4, Math.round(s * 0.4));        // centre dash
  for (let i = 0; i < 26; i++) { // the verges are losing to the green
    const edge = r() < 0.5 ? 2 + r() * 8 : s - 2 - r() * 8;
    c.fillStyle = i % 2 ? 'rgba(64,96,44,0.5)' : 'rgba(40,66,32,0.55)';
    c.fillRect(edge, r() * s, 1.5 + r() * 2.5, 2 + r() * 3);
  }
});
const pathTex = canvasTex(64, 1, 1, 102, (c, s, r) => {
  c.fillStyle = '#847d6c'; c.fillRect(0, 0, s, s);
  speckle(c, s, r, ['rgba(60,54,40,0.35)', 'rgba(255,250,235,0.12)'], 90);
  cracks(c, s, r, 3, 'rgba(50,44,32,0.4)');
  moss(c, s, r, 3, ['rgba(64,96,44,0.4)', 'rgba(42,70,32,0.35)']);
});
// The cut face under a carriageway: a road is a SOLID, not a decal, and what
// you see at its edge is the shoulder gravel over compacted sub-base over
// earth. v runs DOWN the face (0 at the tarmac), so the strata read in order.
const vergeTex = canvasTex(64, 1, 1, 119, (c, s, r) => {
  c.fillStyle = '#4a4034'; c.fillRect(0, 0, s, s);
  // Strata: pale shoulder chippings at the lip, darker base course, then soil.
  const band = (y0: number, y1: number, fill: string): void => { c.fillStyle = fill; c.fillRect(0, y0 * s, s, (y1 - y0) * s); };
  band(0, 0.1, '#6e6553');   // the shoulder itself, catching light
  band(0.1, 0.26, '#3c3830'); // bound base course
  band(0.26, 1, '#453a2c');   // subsoil
  speckle(c, s, r, ['rgba(20,16,10,0.45)', 'rgba(214,204,180,0.18)'], 260, 1.4);
  // Stones sit proud of the face and catch the light along their top edge.
  for (let i = 0; i < 40; i++) {
    const x = r() * s, y = 0.08 * s + r() * 0.92 * s, w = 1.5 + r() * 3, h = 1 + r() * 2.4;
    c.fillStyle = `rgba(${120 + r() * 60 | 0},${112 + r() * 52 | 0},${94 + r() * 44 | 0},0.5)`;
    c.fillRect(x, y, w, h);
    c.fillStyle = 'rgba(236,228,206,0.22)';
    c.fillRect(x, y, w, 1);
  }
  moss(c, s, r, 4, ['rgba(58,86,40,0.35)', 'rgba(40,64,30,0.3)']);
  cracks(c, s, r, 4, 'rgba(16,13,8,0.4)');
});
// A parapet: solid kerb, open balusters, capped rail. Alpha-cut, so the sky
// shows between the posts — a solid wall at this height would read as a
// trench, and the gaps are what make a drop legible as a drop.
const railTex = canvasTex(32, 1, 1, 121, (c, s, r) => {
  c.clearRect(0, 0, s, s);
  const px = (x: number, y: number, w: number, h: number, f: string): void => { c.fillStyle = f; c.fillRect(x, y, w, h); };
  px(0, 0, s, Math.round(s * 0.16), '#8a877c');                 // the capping rail
  px(0, Math.round(s * 0.14), s, 2, 'rgba(20,20,18,0.5)');      // its shadow
  px(0, Math.round(s * 0.7), s, Math.round(s * 0.3), '#6b675c'); // the solid kerb
  px(0, Math.round(s * 0.7), s, 2, 'rgba(236,230,212,0.35)');
  for (let x = 2; x < s; x += 8) {                              // balusters
    px(x, Math.round(s * 0.16), 3, Math.round(s * 0.54), '#7b776c');
    px(x, Math.round(s * 0.16), 1, Math.round(s * 0.54), 'rgba(236,230,212,0.28)');
  }
  speckle(c, s, r, ['rgba(0,0,0,0.16)', 'rgba(255,255,255,0.07)'], 60, 1);
});
// ── road furniture ────────────────────────────────────────────────
// One atlas, three panels side by side in u: chevrons for a bend, a warning
// triangle, hazard stripes. All of them BATTERED — faded, dented, shot at,
// rusting from the fixings out — but the legend still legible, because a sign
// you cannot read is set dressing and a sign you can read is information.
// v splits top/bottom into face and back (the back is bare galvanised).
// 0 chevrons · 1 warning triangle · 2 hazard stripes · 3 direction board ·
// 4 edge delineator. The last two exist because a road lined end to end with
// yellow hazard boards reads as roadworks, not as a road: most furniture on a
// real route is a marker post, and the only sign that earns a whole board on a
// straight is one telling you where the turning goes.
const SIGN_KINDS = 5;
const signTex = canvasTex(192, 1, 1, 122, (c, s, r) => {
  const W = s / SIGN_KINDS;
  const rust = (x: number, y: number, w: number, h: number, n: number): void => {
    for (let i = 0; i < n; i++) {
      const rx = x + r() * w, ry = y + r() * h;
      c.fillStyle = `rgba(${120 + r() * 60 | 0},${60 + r() * 40 | 0},${28 + r() * 24 | 0},${0.15 + r() * 0.5})`;
      c.fillRect(rx, ry, 1 + r() * 4, 1 + r() * 4);
    }
  };
  // Dents and shot holes read as dark pits with a bright lip on the light side.
  const dings = (x: number, w: number, n: number): void => {
    for (let i = 0; i < n; i++) {
      const dx = x + 4 + r() * (w - 8), dy = 4 + r() * (s / 2 - 8), rad = 1.5 + r() * 3;
      c.fillStyle = 'rgba(24,20,16,0.72)';
      c.beginPath(); c.arc(dx, dy, rad, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(236,230,214,0.5)';
      c.beginPath(); c.arc(dx - rad * 0.3, dy - rad * 0.3, rad * 0.55, 0, Math.PI * 2); c.fill();
    }
  };
  for (let k = 0; k < SIGN_KINDS; k++) {
    const x0 = k * W;
    // The retroreflective ground. Yellow-green is the real-world colour for a
    // temporary/hazard board and it is the one that survives this palette; a
    // direction board is the dark green of a route sign, a delineator white.
    // A delineator's BODY is dark on purpose. The retroreflective pass adds
    // diffuse back into the fragment, so a near-white panel caught square in
    // the headlights clips to a featureless white slab — which is exactly what
    // the first version of this post did. Keep the body dark and let the
    // reflector band be the only thing that lights up.
    c.fillStyle = k === 3 ? '#1f4034' : k === 4 ? '#4a5049' : k === 1 ? '#d8cf4a' : '#d5c93f';
    c.fillRect(x0, 0, W, s / 2);
    // DRAWN FOR THE RESOLUTION IT IS SEEN AT. The scene renders at PIX_H and is
    // magnified, so a board 26m away is roughly twenty pixels across — three
    // slim chevrons became three grey smudges. Everything here is deliberately
    // coarse: two fat marks instead of three fine ones, a two-pixel border
    // instead of three, nothing thinner than a sixth of the panel.
    const H = s / 2;
    // A delineator has no border — it is a post, not a board, and a frame drawn
    // round something six pixels wide is the whole thing.
    if (k !== 4) {
      c.fillStyle = k === 3 ? 'rgba(226,232,220,0.92)' : 'rgba(30,26,18,0.9)';
      c.fillRect(x0 + 2, 2, W - 4, 2); c.fillRect(x0 + 2, H - 4, W - 4, 2);
      c.fillRect(x0 + 2, 2, 2, H - 4); c.fillRect(x0 + W - 4, 2, 2, H - 4);
    }
    c.fillStyle = '#141109';
    if (k === 3) {
      // A direction board: one fat arrow and two weight bars standing in for a
      // destination and its distance. Actual lettering is unreadable at the
      // twenty-odd pixels this is seen across, and a smudge of fake text reads
      // worse than an honest glyph.
      c.fillStyle = '#e8efe2';
      const my = H / 2 - 2, ah = 13;
      c.beginPath();
      c.moveTo(x0 + W - 10, my); c.lineTo(x0 + W - 24, my - ah); c.lineTo(x0 + W - 24, my - 5);
      c.lineTo(x0 + 10, my - 5); c.lineTo(x0 + 10, my + 5); c.lineTo(x0 + W - 24, my + 5);
      c.lineTo(x0 + W - 24, my + ah);
      c.closePath(); c.fill();
      c.fillRect(x0 + 10, H - 16, W - 34, 4);
    } else if (k === 4) {
      // A delineator post: one reflective band near the top, nothing else. The
      // most common thing at a roadside and the cheapest to read at speed.
      c.fillStyle = '#d24334';
      c.fillRect(x0 + 5, 9, W - 10, 15);
    } else if (k === 0) {
      // TWO fat chevrons: the sign that means THE ROAD GOES THIS WAY, NOW.
      for (let i = 0; i < 2; i++) {
        const cx = x0 + 8 + i * 26, w = 13, t = 11;
        c.beginPath();
        c.moveTo(cx, 9); c.lineTo(cx + w, H / 2); c.lineTo(cx, H - 9);
        c.lineTo(cx + t, H - 9); c.lineTo(cx + w + t, H / 2); c.lineTo(cx + t, 9);
        c.closePath(); c.fill();
      }
    } else if (k === 1) {
      // A warning triangle, filled with a bar knocked out of it — a hollow
      // outline disappears at this size, a solid mass does not.
      c.beginPath();
      c.moveTo(x0 + W / 2, 7); c.lineTo(x0 + W - 9, H - 9); c.lineTo(x0 + 9, H - 9);
      c.closePath(); c.fill();
      c.fillStyle = '#d5c93f';
      c.fillRect(x0 + W / 2 - 4, H / 2 - 6, 8, 18);
      c.fillRect(x0 + W / 2 - 4, H - 18, 8, 5);
    } else {
      // Hazard stripes: four wide bands, not eight narrow ones.
      c.save();
      c.beginPath(); c.rect(x0 + 5, 5, W - 10, H - 10); c.clip();
      for (let i = -Math.round(H); i < W + H; i += 30) {
        c.beginPath();
        c.moveTo(x0 + i, 5); c.lineTo(x0 + i + 15, 5);
        c.lineTo(x0 + i + 15 + H, H); c.lineTo(x0 + i + H, H);
        c.closePath(); c.fill();
      }
      c.restore();
    }
    // Weather, in this order: grime over the legend, rust from the edges in,
    // then the dents on top of everything (they are the most recent event).
    // A hazard board has stood there for years; a route sign gets replaced when
    // it stops being readable, so it wears at about a third the rate.
    const wear = k >= 3 ? 0.35 : 1;
    c.fillStyle = `rgba(96,88,60,${0.16 * wear})`; c.fillRect(x0, 0, W, s / 2);
    rust(x0, 0, W, 8, 40 * wear); rust(x0, s / 2 - 10, W, 10, 40 * wear);
    rust(x0, 0, 8, s / 2, 30 * wear); rust(x0 + W - 8, 0, 8, s / 2, 30 * wear);
    dings(x0, W, Math.round((5 + Math.floor(r() * 4)) * wear));
    // The back: galvanised, streaked, nothing to read.
    c.fillStyle = '#6d6f6b'; c.fillRect(x0, s / 2, W, s / 2);
    for (let i = 0; i < 40; i++) {           // rain streaks down the backplate
      c.fillStyle = `rgba(${40 + r() * 30 | 0},${40 + r() * 26 | 0},${36 + r() * 22 | 0},${0.06 + r() * 0.14})`;
      c.fillRect(x0 + r() * W, s / 2 + r() * (s / 2), 1 + r(), 4 + r() * 20);
    }
    rust(x0, s / 2, W, s / 2, 50);
  }
});
// A deck fascia, for where the carriageway rides clear of the ground: the
// same volume, but poured rather than cut.
const deckTex = canvasTex(64, 1, 1, 120, (c, s, r) => {
  c.fillStyle = '#5b5c58'; c.fillRect(0, 0, s, s);
  c.fillStyle = 'rgba(20,22,24,0.4)'; c.fillRect(0, 0, s, Math.round(s * 0.12)); // shadow line under the lip
  speckle(c, s, r, ['rgba(0,0,0,0.14)', 'rgba(255,255,255,0.06)'], 200, 1.3);
  c.fillStyle = 'rgba(0,0,0,0.22)';
  for (let x = 6; x < s; x += 21) c.fillRect(x, 0, 2, s);   // shutter joints
  cracks(c, s, r, 3, 'rgba(22,24,26,0.35)');
  moss(c, s, r, 3, ['rgba(56,84,40,0.3)', 'rgba(38,62,30,0.25)']);
});
// A TRACK IS TWO RUTS, not a ribbon. The ribbon's u runs across the width and
// v along the length, so ruts are two bands at fixed u. Everything outside them
// fades to fully transparent — that is what makes a track read as wear ON the
// hillside rather than a strip of pavement laid over it, and it means the
// terrain's own colour carries straight through the middle.
const trackTex = canvasTex(64, 1, 1, 118, (c, s, r) => {
  c.clearRect(0, 0, s, s);
  const RUT = [0.29, 0.71];
  for (let y = 0; y < s; y++) {
    // A slow wander, so the ruts are not drawn with a ruler.
    const wob = Math.sin(y * 0.19) * 0.018 + Math.sin(y * 0.07 + 1.7) * 0.012;
    for (const u of RUT) {
      const cx = (u + wob) * s, half = s * 0.088;
      for (let x = Math.floor(cx - half * 2.2); x <= Math.ceil(cx + half * 2.2); x++) {
        const t = Math.abs(x - cx) / half;
        const a = t < 1 ? 0.9 : Math.max(0, 0.9 - (t - 1) * 0.75);   // hard core, soft shoulder
        if (a <= 0.01) continue;
        const lit = 0.55 + 0.45 * r();
        c.fillStyle = `rgba(${Math.round(150 * lit)},${Math.round(138 * lit)},${Math.round(112 * lit)},${a})`;
        c.fillRect((x + s) % s, y, 1, 1);
      }
    }
    // The crown between the ruts keeps its scrub — scuffed, not bare.
    for (let x = Math.round(s * 0.4); x < Math.round(s * 0.6); x++) {
      if (r() > 0.34) continue;
      c.fillStyle = `rgba(122,118,92,${0.1 + r() * 0.22})`;
      c.fillRect(x, y, 1, 1);
    }
  }
  speckle(c, s, r, ['rgba(48,44,34,0.5)', 'rgba(226,218,196,0.28)'], 120, 1.1); // grit in the ruts
});
// Shape/roof UVs are world metres (ShapeGeometry copies XY into UV) — repeat
// scales metres→tiles.
const waterTex = canvasTex(128, 1 / 26, 1 / 26, 103, (c, s, r) => {
  c.fillStyle = '#1d3a55'; c.fillRect(0, 0, s, s);
  c.strokeStyle = 'rgba(126,168,204,0.14)'; c.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    c.beginPath();
    const y = r() * s;
    c.moveTo(0, y); c.bezierCurveTo(s / 3, y - 6, (2 * s) / 3, y + 6, s, y);
    c.stroke();
  }
});
const greenTex = canvasTex(128, 1 / 20, 1 / 20, 104, (c, s, r) => {
  c.fillStyle = '#1c3320'; c.fillRect(0, 0, s, s);
  speckle(c, s, r, ['rgba(10,24,12,0.5)', 'rgba(58,96,52,0.28)'], 240, 2.6);
  speckle(c, s, r, ['rgba(88,120,58,0.3)', 'rgba(70,104,48,0.25)'], 70, 1.2); // grass blades catching light
  for (let i = 0; i < 8; i++) { // sparse wildflowers
    c.fillStyle = i % 2 ? 'rgba(214,196,120,0.5)' : 'rgba(196,150,170,0.4)';
    c.fillRect(r() * s, r() * s, 1.5, 1.5);
  }
});
const roofTex = canvasTex(128, 1 / 10, 1 / 10, 105, (c, s, r) => {
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s);
  speckle(c, s, r, ['rgba(0,0,0,0.10)', 'rgba(0,0,0,0.05)'], 300);
  c.strokeStyle = 'rgba(0,0,0,0.10)'; c.lineWidth = 1;
  for (let i = 16; i < s; i += 26) { c.beginPath(); c.moveTo(0, i); c.lineTo(s, i); c.stroke(); } // panel seams
  cracks(c, s, r, 3, 'rgba(30,26,18,0.25)');
  moss(c, s, r, 6, ['rgba(64,96,44,0.45)', 'rgba(42,70,32,0.4)', 'rgba(96,128,60,0.3)']);
});
// Crumbling walls, two variants so neighbouring parcels don't twin: floor
// bands, cracks, and moss/vines claiming the concrete. White base — the
// per-parcel material colour tints it.
const wallTexes = [7101, 7102].map((seed) => canvasTex(128, 1 / 9, 1 / 9, seed, (c, s, r) => {
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s);
  c.fillStyle = 'rgba(0,0,0,0.10)';
  for (let y = 10; y < s; y += 24) c.fillRect(0, y, s, 3); // floor bands
  speckle(c, s, r, ['rgba(0,0,0,0.08)', 'rgba(255,255,255,0.05)'], 240);
  cracks(c, s, r, 5, 'rgba(20,16,10,0.35)');
  moss(c, s, r, 7, ['rgba(64,96,44,0.5)', 'rgba(42,70,32,0.45)', 'rgba(96,128,60,0.35)']);
}));
// DoubleSide throughout: ribbon winding and the rotate+mirror extrusion leave
// face orientation mixed — lighting both sides costs little at this scene size
// and makes every surface reliably visible from the top-down camera.
const DS = THREE.DoubleSide;
// The headlight the signs answer to. Updated once a frame from the car; the
// signs read it in the fragment shader, so a whole roadside of them costs one
// uniform write rather than a per-object light calculation.
const beamProbe = {
  uBeamPos: { value: new THREE.Vector3() },
  uBeamDir: { value: new THREE.Vector3(0, 0, -1) },
  uBeamAmt: { value: 1 },
};
/**
 * RETROREFLECTION, which is not the same thing as being shiny. A road sign
 * sends light back toward wherever it CAME FROM, so it is dazzling from the
 * driver's seat and almost invisible from anywhere else — that asymmetry is the
 * whole effect, and a normal specular highlight cannot produce it because it
 * answers to the surface, not to the observer.
 *
 * So: brightness = (is the sign facing the car) × (is the car's beam pointed at
 * the sign) × (falloff with distance). It lands in `emissive`, which means the
 * bright-pass picks it up and the sign BLOOMS in the headlights, at night, from
 * the one seat that should see it.
 */
function retroreflective(mat: THREE.Material): THREE.Material {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBeamPos = beamProbe.uBeamPos;
    shader.uniforms.uBeamDir = beamProbe.uBeamDir;
    shader.uniforms.uBeamAmt = beamProbe.uBeamAmt;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 rrW = modelMatrix * vec4(transformed, 1.0);
        vWPos = rrW.xyz;
        vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNrm;
        uniform vec3 uBeamPos;
        uniform vec3 uBeamDir;
        uniform float uBeamAmt;`)
      .replace('#include <dithering_fragment>', `
        vec3 rrToCar = uBeamPos - vWPos;
        float rrDist = length(rrToCar);
        vec3 rrDirToCar = rrToCar / max(rrDist, 0.001);
        // Facing the car at all? DoubleSide flips the normal, so take |dot| —
        // the back of a sign is dark because the TEXTURE is, not because the
        // geometry faces away.
        float rrFace = abs(dot(normalize(vWNrm), rrDirToCar));
        // Inside the beam? A tight cone: a sign off to the side stays dark
        // until you are pointed at it, which is what makes a bend light up as
        // you turn into it rather than all at once.
        float rrAim = max(dot(uBeamDir, -rrDirToCar), 0.0);
        float rrCone = pow(rrAim, 22.0);
        // Real retroreflectors fall off far more slowly than a diffuse surface
        // (they return the beam rather than scattering it), so this is 1/d, not
        // 1/d². 90m of usable range on a dark road.
        float rrFall = clamp(1.0 - rrDist / 90.0, 0.0, 1.0);
        float rr = pow(rrFace, 3.0) * rrCone * rrFall * uBeamAmt;
        // 1.3, not 2.6. At 2.6 the panel clipped to flat white in the beam and
        // the chevrons went with it — a sign you cannot read is a lamp. This
        // keeps it the brightest thing in the frame while the legend survives,
        // which is the whole point of putting a legend on it.
        gl_FragColor.rgb += diffuseColor.rgb * rr * 1.3;
        #include <dithering_fragment>`);
  };
  mat.needsUpdate = true;
  return mat;
}
const MAT = {
  road: new THREE.MeshLambertMaterial({ map: roadTex, side: DS }),
  minor: new THREE.MeshLambertMaterial({ map: pathTex, transparent: true, opacity: 0.85, side: DS }),
  // Ruts: alpha-cut, and depth-offset because it lies a few centimetres over
  // terrain it is meant to look part of.
  track: new THREE.MeshLambertMaterial({
    map: trackTex, transparent: true, side: DS, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  }),
  // polygonOffset as well as the lift: water and terrain are two nearly
  // coincident surfaces, and a constant lift alone cannot win at every camera
  // distance. The offset is in depth-buffer units, so it scales with the
  // precision available instead of with metres.
  water: new THREE.MeshLambertMaterial({ map: waterTex, side: DS, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
  green: new THREE.MeshLambertMaterial({ map: greenTex, side: DS }),
  // The road's own thickness. FrontSide would be right if the winding were
  // reliable; it isn't (see DS above), and a one-sided apron flickers out
  // whenever the camera crosses the road.
  verge: new THREE.MeshLambertMaterial({ map: vergeTex, side: DS }),
  deck: new THREE.MeshLambertMaterial({ map: deckTex, side: DS }),
  // alphaTest, not blending: a parapet is seen against sky, water and its own
  // deck at once, and a sorted transparent has no right answer for that.
  rail: new THREE.MeshLambertMaterial({ map: railTex, side: DS, transparent: true, alphaTest: 0.5 }),
  sign: retroreflective(new THREE.MeshLambertMaterial({ map: signTex, side: DS })),
  // Tunnel interior: emissive so the tube reads even with no light inside.
  tunnel: new THREE.MeshLambertMaterial({ color: 0x2a2d34, emissive: 0x0b0d12, side: DS }),
  portal: new THREE.MeshLambertMaterial({ color: 0x4d4a42, side: DS }),
} as const;
// Green drapes conform to the terrain, so a wooded hill occludes like one —
// and the tunnel shell is the carved hill itself, so it ghosts too (the car
// inside stays visible through the screen-door).
ghostify(MAT.green);
// NOT the tunnel shell: dithering holes in a dark interior against the sky
// reads as a ragged black cut-out, not as transparency. A buried tube needs
// no ghosting anyway — the hillside above it is already doing the work.
// ── façades ────────────────────────────────────────────────────────
// A wall texture gives you grain; it cannot give you a BUILDING. Openings have
// to land on floors, doors have to be at street level, and ivy has to climb
// from the ground — none of which a tiling bitmap knows about. So the openings
// are generated in the fragment shader from the world position, with the
// building's own base height taken from its model matrix, which means floors
// line up per building no matter what the terrain under it is doing.
function facade(mat: THREE.Material): void {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFacW; varying vec3 vFacN; varying float vFacH;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 facW = modelMatrix * vec4(transformed, 1.0);
        vFacW = facW.xyz;
        vFacN = mat3(modelMatrix) * objectNormal;
        vFacH = facW.y - modelMatrix[3][1];`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFacW; varying vec3 vFacN; varying float vFacH;
        float fah(vec2 p){ p = fract(p * vec2(127.31, 311.7)); p += dot(p, p + 41.31); return fract(p.x * p.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 fn = normalize(vFacN);
        // Roofs and floor slabs get grime and nothing else — a window in the
        // ceiling is the giveaway that this is a texture and not a building.
        if (abs(fn.y) < 0.55) {
          // Run the bay grid along whichever horizontal axis this wall faces.
          float u = abs(fn.x) > abs(fn.z) ? vFacW.z : vFacW.x;
          vec2 cell = vec2(u / 2.75, vFacH / 3.1);
          vec2 idc = floor(cell), f = fract(cell);
          float r = fah(idc + vec2(7.13, 3.31));
          float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.34, f.y) * step(f.y, 0.86);
          float door = step(0.33, f.x) * step(f.x, 0.67) * step(0.03, f.y) * step(f.y, 0.6);
          // Street level is doorways and shopfronts; above it, windows.
          float ground = step(vFacH, 3.1);
          float open = mix(win, mix(win * step(0.52, f.y), door, step(r, 0.36)), ground);
          open *= step(r, 0.76);                    // the rest are bricked up
          // Glass: mostly dark voids, a few catching the low sun.
          vec3 glass = mix(vec3(0.05, 0.055, 0.07), vec3(0.13, 0.15, 0.17), fah(idc + vec2(2.7)));
          glass = mix(glass, vec3(0.62, 0.44, 0.2), step(0.94, fah(idc + vec2(11.3, 5.7))) * 0.75);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, open * 0.9);
          // A one-pixel lintel/sill so the opening has an edge, not just a hole.
          float lint = step(0.86, f.y) * step(0.2, f.x) * step(f.x, 0.8) * (1.0 - ground);
          diffuseColor.rgb *= 1.0 - lint * 0.25;
          // IVY. Whole columns of wall get claimed, thickest at the base and
          // thinning as it climbs — which is what makes a ruin read as reclaimed
          // rather than merely dirty.
          float colv = floor(u * 0.8);
          float vine = smoothstep(0.6, 0.95, fah(vec2(colv, 17.3)))
            * exp(-vFacH * 0.13)
            * (0.5 + 0.5 * fah(vec2(colv, floor(vFacH * 0.75))));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.21, 0.09), clamp(vine, 0.0, 0.8));
        }
        // Water staining below every horizontal break, on every face.
        diffuseColor.rgb *= 1.0 - 0.16 * fah(floor(vFacW.xz * 1.7) + floor(vFacH * 2.3));
      }`);
  };
}
// Building tints vary per way id so a block reads as parcels, not one slab.
// Extrude material slots: [0]=caps (roof), [1]=side walls (darker).
const B_MATS = [0xa59a85, 0x92897a, 0x9d937f, 0x878071].map((c, i) => {
  // Walls carry the detail now — openings, lintels, ivy — and at 0.72 under a
  // low sun there was not enough wall left for any of it to read against.
  const side = new THREE.Color(c).multiplyScalar(0.88);
  const wall = new THREE.MeshLambertMaterial({ color: side, map: wallTexes[i % wallTexes.length], side: DS });
  facade(wall);
  return [
    new THREE.MeshLambertMaterial({ color: c, map: roofTex, side: DS }),
    wall,
  ] as [THREE.Material, THREE.Material];
});
// Ruins carry their weathering in vertex colours instead of a map, so every
// wall segment can rot at its own rate.
const ruinMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DS });
facade(ruinMat);
// Water gets its own surface treatment. A static ripple texture reads as wet
// paint; this scrolls two noise layers against each other for the swell,
// brightens the crests, and adds a sun glint that tracks the light — enough
// motion to look like liquid without leaving the palette.
const waterU = { uWTime: { value: 0 } };
function waterize(mat: THREE.Material): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWTime = waterU.uWTime;
    sh.uniforms.uWSun = { value: LIGHT_DIR };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; uniform float uWTime; uniform vec3 uWSun;
        float wh(vec2 p){ p = fract(p * vec2(127.31, 311.7)); p += dot(p, p + 34.23); return fract(p.x * p.y); }
        float wn(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wh(i), wh(i + vec2(1.0, 0.0)), f.x),
                     mix(wh(i + vec2(0.0, 1.0)), wh(i + vec2(1.0, 1.0)), f.x), f.y);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        // Two layers drifting against each other: where they agree, a crest.
        float a = wn(vWPos.xz * 0.09 + vec2(uWTime * 0.35, uWTime * 0.11));
        float b = wn(vWPos.xz * 0.15 - vec2(uWTime * 0.21, uWTime * 0.4));
        float swell = a * 0.6 + b * 0.4;
        diffuseColor.rgb *= 0.72 + swell * 0.7;
        // Glint: crests facing the sun catch it, and only on the sun's side.
        vec2 toSun = normalize(uWSun.xz + vec2(1e-4));
        float face = max(dot(normalize(vWPos.xz - cameraPosition.xz + 1e-4), toSun), 0.0);
        diffuseColor.rgb += vec3(1.0, 0.94, 0.78) * pow(smoothstep(0.72, 1.0, swell), 2.0) * face * 0.55;
      }`);
  };
}

// ── the sea ────────────────────────────────────────────────────────
// Terrarium tiles carry BATHYMETRY and OSM's open sea has no water polygon
// (coastline ≠ natural=water), so coasts rendered as sunken seabed. One vast
// plane at sea level fills every below-sea basin; land simply occludes it.
// Disabled when the spawn itself sits in a true depression (Death Valley).
const seaTex = waterTex.clone();
seaTex.repeat.set(1550, 1550); // plane UVs are 0..1 across 40km → ~26m ripple tiles
seaTex.needsUpdate = true;
const seaMat = new THREE.MeshLambertMaterial({ map: seaTex, side: DS });
waterize(seaMat);
waterize(MAT.water);
const sea = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), seaMat);
sea.rotation.x = -Math.PI / 2;
sea.position.y = -1e6; // parked until boot anchors sea level
scene.add(sea);
let seaOn = false;
// ── dry land below sea level ───────────────────────────────────────
// The sea used to be a BOOT decision: spawn at or above sea level and a 40km
// plane sits at absolute zero for the rest of the session. Then you drive
// into Death Valley — Badwater Road bottoms out 85m below sea level — and the
// game floods it: the road runs under a rippling teal ceiling, because the
// plane cannot know the basin is dry. Coastline data would settle it properly
// and OSM's open sea has none, so the evidence used instead is the map itself:
// A DRIVABLE ROAD BELOW SEA LEVEL MEANS THE LAND THERE IS DRY (Badwater,
// the Dead Sea shore, a Dutch polder). While the car is near such evidence
// the plane is drawn down out of sight; drive back toward a real coast —
// which never has roads below the waterline — and it rises home. Latched by
// place, not for the session, so one desert basin does not drain the Atlantic.
let dryAt: [number, number] | null = null;
// ── where the water actually sits ──────────────────────────────────
// "Sea level is elevation zero" is an assumption about the DEM's datum, and
// terrarium does not keep it. Measured 4km due west into the open Pacific off
// Big Sur: the mosaic has no bathymetry there and fills the ocean at a FLAT
// +1.2m, while the sea plane sat at +0.1 — so the seabed skin covered the
// water and the truck drove to the horizon on a green plain, with deer
// standing on it. WorldCover called every one of those samples water.
//
// So ask the water where it is. Cover says which ground is water and the
// heightfield says how high that ground stands; the sea belongs just above it.
// This only ever NUDGES sea level — a measurement further than 60m from zero
// is a mountain lake, not an ocean, and is ignored rather than used to flood
// the world to its level.
//
// AND IT IS NOT ALLOWED TO GUESS EARLY. Cover streams in, and this used to
// latch on the first pass that found any water at all. Measured twice at the
// same inland ridge above Big Sur: 45 samples put "sea level" at 30.9m, 370
// samples put it at 1.2m — and the first answer was frozen for the session,
// because it only ever measured once. It now needs a real sample at both ends
// and has to say the same thing three passes running before it stops looking.
let seaDatum: number | null = null;
let seaDatumN = 0;
let seaDatumSteady = 0;
const SEA_MIN_SAMPLES = 150;
function measureSeaDatum(): void {
  const wet: number[] = [], dry: number[] = [];
  for (let a = 0; a < 48; a++) {
    const c = Math.cos((a / 48) * Math.PI * 2), s = Math.sin((a / 48) * Math.PI * 2);
    for (let r = 200; r <= 5000; r += 200) {
      const x = state.x + c * r, z = state.z + s * r;
      const cv = sampleCover(x, z);
      if (cv === null) continue;
      (cv === COVER.water ? wet : dry).push(sampleHeight(x, z) + baseElev);
    }
  }
  // A pond must never move the ocean, and neither must three tiles of cover
  // that happened to land first. Both ends of the comparison have to be real.
  if (wet.length < SEA_MIN_SAMPLES || dry.length < SEA_MIN_SAMPLES) return;
  wet.sort((p, q) => p - q);
  // The MEDIAN. Measured off Big Sur, the ocean fill is a flat plate: p25
  // through p90 all read exactly 1.2m, with a thin tail near 0 and a lone 45m
  // outlier where a river was caught. The median is the plate; a low
  // percentile lands in the tail and leaves the plate proud of the water.
  const lvl = wet[wet.length >> 1];
  if (Math.abs(lvl) > 60) return;          // that far from zero is a lake, not the sea
  // And the sea is the LOWEST thing in a landscape. If this water stands above
  // a fifth of the dry land around it, it is a tarn perched in the hills and
  // must not be allowed to set the level everything else drowns under.
  dry.sort((p, q) => p - q);
  if (lvl > dry[Math.floor(dry.length * 0.2)]) return;
  seaDatumSteady = seaDatum !== null && Math.abs(lvl - seaDatum) < 1 ? seaDatumSteady + 1 : 0;
  seaDatum = lvl;
  seaDatumN = wet.length;
}
/** Absolute elevation of the sea surface. The 0.4 is freeboard: the DEM's
 *  ocean fill is a flat plate, and a plane at exactly its height z-fights with
 *  it instead of covering it. */
function seaSurfaceAbs(): number { return seaDatum === null ? 0.1 : seaDatum + 0.4; }
function noteDryLand(x: number, z: number, y: number): void {
  if (y + baseElev > seaSurfaceAbs() - 1.1) return;   // not meaningfully below sea level
  // Keep the evidence nearest the car, so leaving the basin actually raises
  // the sea again instead of chasing the most recently streamed tile.
  if (!dryAt || Math.hypot(x - state.x, z - state.z) < Math.hypot(dryAt[0] - state.x, dryAt[1] - state.z)) {
    dryAt = [x, z];
  }
}
/** The sea surface's local y where it is live, or null where it is sunk. */
function seaLevelY(): number | null {
  if (!seaOn) return null;
  // 30km, not 8. A dry basin is a REGION — Death Valley's floor runs 200km —
  // and an 8km leash meant driving one valley put the anchor behind you and
  // flooded the ground you were standing on. The cost is the genuine inverse
  // case: a polder within 30km of a real coast will hold the sea down where
  // it should be visible. That is a rarer world and a milder failure than an
  // ocean closing over a truck parked below sea level on dry salt.
  if (dryAt && Math.hypot(dryAt[0] - state.x, dryAt[1] - state.z) < 30000) return null;
  return seaSurfaceAbs() - baseElev;
}

// ── vegetation: a recycling field, not a one-shot pool ─────────────
// The old version planted each polygon once into a fixed pool and stopped
// when it filled — drive far enough and the world went bare forever. Now
// every green polygon deposits cheap SITES (a handful of floats each, held in
// a spatial grid), and the instanced meshes are refilled each second from the
// sites nearest the truck. Plants far behind are recycled to dress the ground
// ahead, so density is constant however far you drive, and the site list can
// hold tens of thousands for the cost of the numbers.
type VegKind = 'broadleaf' | 'conifer' | 'palm' | 'snag' | 'bush' | 'rock';
interface VegSite { x: number; z: number; k: VegKind; s: number; rot: number; h: number; c: THREE.Color }
const VEG_CELL = 220;                       // spatial bucket, metres
const vegGrid = new Map<string, VegSite[]>();
const VEG_RANGE = 700;                      // plants are shown within this
const vegKey = (x: number, z: number): string => `${Math.floor(x / VEG_CELL)},${Math.floor(z / VEG_CELL)}`;

// Archetypes. Each is a squat, flat-shaded silhouette that survives the pixel
// grid; variety comes from shape as much as tint.
function conifer(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(1, 2.6, 6);
  g.translate(0, 1.3, 0);
  return g;
}
function broadleaf(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(1, 0.82, 1);
  g.translate(0, 1, 0);
  return g;
}
function palm(): THREE.BufferGeometry {
  // A flattened star of fronds — reads as a palm crown in silhouette.
  const g = new THREE.ConeGeometry(1.5, 0.5, 5, 1, true);
  g.rotateX(Math.PI);
  g.translate(0, 1.1, 0);
  return g;
}
function snag(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.1, 0.22, 2.4, 5);
  g.translate(0, 1.2, 0);
  return g;
}
function bushGeo(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(1.1, 0.7, 1.1);
  g.translate(0, 0.6, 0);
  return g;
}
function rockGeo(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  g.scale(1.2, 0.6, 0.95);
  g.translate(0, 0.35, 0);
  return g;
}
const VEG_CAP: Record<VegKind, number> = { broadleaf: 1600, conifer: 1400, palm: 600, snag: 450, bush: 2600, rock: 900 };
const vegDummy = new THREE.Object3D();
function vegMesh(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.count = 0;
  m.frustumCulled = false;                  // instances span the whole field
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  scene.add(m);
  return m;
}
// White base colours: every plant's hue arrives through instanceColor.
const leafMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
const woodMat = new THREE.MeshLambertMaterial({ color: 0x4a3826, flatShading: true });
const stoneMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
ghostify(leafMat);
ghostify(stoneMat);
const vegMeshes: Record<VegKind, THREE.InstancedMesh> = {
  broadleaf: vegMesh(broadleaf(), leafMat, VEG_CAP.broadleaf),
  conifer: vegMesh(conifer(), leafMat, VEG_CAP.conifer),
  palm: vegMesh(palm(), leafMat, VEG_CAP.palm),
  snag: vegMesh(snag(), woodMat, VEG_CAP.snag),
  bush: vegMesh(bushGeo(), leafMat, VEG_CAP.bush),
  rock: vegMesh(rockGeo(), stoneMat, VEG_CAP.rock),
};
const trunkGeo2 = new THREE.CylinderGeometry(0.14, 0.2, 1, 5);
trunkGeo2.translate(0, 0.5, 0);
const trunks = vegMesh(trunkGeo2, woodMat, 3600);
const TRUNKED: VegKind[] = ['broadleaf', 'conifer', 'palm'];

// What grows where. Weights per biome, so a palm never appears in Tromsø and
// the desert gets snags and rock instead of canopy.
const VEG_MIX: Record<string, Array<[VegKind, number]>> = {
  arid: [['bush', 5], ['rock', 4], ['snag', 2], ['palm', 1], ['broadleaf', 1]],
  tropical: [['broadleaf', 5], ['palm', 4], ['bush', 4], ['rock', 1]],
  temperate: [['broadleaf', 5], ['conifer', 3], ['bush', 4], ['rock', 1], ['snag', 1]],
  boreal: [['conifer', 7], ['bush', 3], ['rock', 2], ['snag', 2]],
  alpine: [['conifer', 4], ['rock', 6], ['bush', 2], ['snag', 2]],
};
// Thickets per VEG_CELL by land-cover class. The point of the spread is that
// the ground now differs from itself: a forest cell and the ploughed field
// beside it are 18 and 1, where before both took the biome's single number.
const COVER_VEG: Record<number, number> = {
  10: 18,   // tree     — closed canopy
  20: 8,    // shrub
  30: 4,    // grass    — the odd thicket in open sward
  40: 1,    // crop     — a worked field is worked
  50: 2,    // built    — street trees and gardens
  60: 0,    // bare     — nothing grows on a salt pan
  70: 0,    // snow
  80: 0,    // water
  90: 7,    // wetland
  95: 14,   // mangrove
  100: 1,   // moss/lichen
};
/** WHAT species, from what is actually there. Cover names the ground; the
 *  biome's own mix still supplies the character, so a boreal forest is
 *  conifers and a tropical one is palms without cover having to say so. */
function coverKind(cover: number | null, r: () => number): VegKind {
  if (cover === COVER.mangrove) return r() < 0.75 ? 'palm' : 'broadleaf';
  if (cover === COVER.tree) {
    const mix = VEG_MIX[biome.name] ?? VEG_MIX.temperate;
    // Drop bushes and rocks: this pixel says CANOPY, so pick a tree from the
    // biome's mix and only fall back to the general roll if it has none.
    const trees = mix.filter(([k]) => k === 'broadleaf' || k === 'conifer' || k === 'palm');
    if (trees.length) {
      let total = 0;
      for (const [, w] of trees) total += w;
      let t = r() * total;
      for (const [k, w] of trees) { t -= w; if (t <= 0) return k; }
      return trees[0][0];
    }
  }
  if (cover === COVER.shrub || cover === COVER.grass || cover === COVER.crop) {
    return r() < 0.82 ? 'bush' : pickKind(r);
  }
  return pickKind(r);
}
function pickKind(r: () => number): VegKind {
  const mix = VEG_MIX[biome.name] ?? VEG_MIX.temperate;
  let total = 0;
  for (const [, w] of mix) total += w;
  let t = r() * total;
  for (const [k, w] of mix) { t -= w; if (t <= 0) return k; }
  return mix[0][0];
}

// Plants grow in COMPANY. A clump is one dominant species with a scatter of
// members packed toward its centre (sqrt-biased radius), plus the odd
// interloper of another species — which is what stops a wood reading as a
// grid of lone trees. Members land in whichever bucket they fall in, so a
// clump straddling a cell boundary still works.
const vegTint = new THREE.Color();
function pushSite(x: number, z: number, kind: VegKind, r: () => number): void {
  if (surfaceAt(x, z) !== 'ground') return;         // not on tarmac or water
  for (const seg of wallGrid.get(gkey(x, z)) ?? []) {
    const [cx2, cz2] = closestOnSeg(x, z, seg);
    if (Math.hypot(x - cx2, z - cz2) < 5) return;   // nor inside a building
  }
  const big = kind === 'bush' || kind === 'rock';
  vegTint.setHSL(
    kind === 'rock' ? 0.09 + r() * 0.04 : biome.vegHue[0] + r() * biome.vegHue[1],
    kind === 'rock' ? 0.05 + r() * 0.06 : 0.32 + r() * 0.25,
    kind === 'rock' ? 0.22 + r() * 0.14 : biome.vegLit[0] + r() * biome.vegLit[1],
  );
  const site: VegSite = {
    x, z, k: kind,
    s: big ? 0.6 + r() * 0.9 : 1.4 + r() * 2.2,
    rot: r() * Math.PI * 2,
    h: TRUNKED.includes(kind) ? 1.1 + r() * 2.2 : 0,
    c: vegTint.clone(),
  };
  const key = vegKey(x, z);
  let cell = vegGrid.get(key);
  if (!cell) vegGrid.set(key, (cell = []));
  cell.push(site);
}
function plantClump(cx: number, cz: number, rad: number, count: number, dominant: VegKind, r: () => number): void {
  for (let i = 0; i < count; i++) {
    // sqrt-biased radius packs members toward the middle and thins the edge,
    // so a clump has a core and a fringe rather than a hard disc.
    const t = Math.pow(r(), 0.62) * rad;
    const a = r() * Math.PI * 2;
    // One member in six is a different species — mixed stands, not monoculture.
    pushSite(cx + Math.cos(a) * t, cz + Math.sin(a) * t, r() < 0.83 ? dominant : pickKind(r), r);
  }
}
// Where clumps WANT to be: a low-frequency field, so woodland gathers into
// belts and thickets across cell boundaries instead of respecting the grid.
function vegDensity(x: number, z: number): number {
  const h = (px: number, pz: number): number => {
    const n = Math.sin(px * 12.9898 + pz * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };
  const sx = x * 0.0011, sz = z * 0.0011;
  const ix = Math.floor(sx), iz = Math.floor(sz);
  const fx = sx - ix, fz = sz - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return (h(ix, iz) * (1 - u) + h(ix + 1, iz) * u) * (1 - v)
    + (h(ix, iz + 1) * (1 - u) + h(ix + 1, iz + 1) * u) * v;
}

// Deposit sites for a polygon — no GPU work, just numbers in a bucket.
function scatterVeg(pts: Array<[number, number]>, seed: number, tags: Record<string, string>): void {
  let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
  for (const [x, z] of pts) {
    minx = Math.min(minx, x); maxx = Math.max(maxx, x);
    minz = Math.min(minz, z); maxz = Math.max(maxz, z);
  }
  const w = maxx - minx, d = maxz - minz;
  if (w < 6 || d < 6 || w > 6000 || d > 6000) return;
  const wooded = tags.landuse === 'forest' || tags.natural === 'wood';
  const bare = tags.leisure === 'pitch' || tags.landuse === 'grass' || tags.landuse === 'meadow';
  // Area per CLUMP, not per plant — a wood is a handful of thickets.
  const per = wooded ? 900 : bare ? 9000 : 3000;
  const n = Math.min(120, Math.floor((w * d) / per));
  if (n < 1) return;
  const r = mulberry32(seed >>> 0);
  for (let k = 0, tries = 0; k < n && tries < n * 5; tries++) {
    const x = minx + r() * w, z = minz + r() * d;
    if (!pointInPoly(x, z, pts)) continue;
    // THE GROUND OVERRULES THE TAG. A polygon says what someone mapped; cover
    // says what is actually there, and an OSM `landuse=grass` over a salt pan
    // or a frozen lake should not sprout a thicket because of it.
    const cv = sampleCover(x, z);
    if (cv !== null && (COVER_VEG[cv] ?? 6) <= 0) continue;
    k++;
    const dominant: VegKind = wooded && r() < 0.8
      ? (biome.name === 'boreal' || biome.name === 'alpine' ? 'conifer' : 'broadleaf')
      : pickKind(r);
    const rad = wooded ? 10 + r() * 20 : 5 + r() * 13;
    plantClump(x, z, rad, Math.round((wooded ? 14 : 7) + r() * (wooded ? 22 : 12)), dominant, r);
  }
}

// AMBIENT SCATTER. Polygons alone can never dress the world: the big parks
// and forests are OSM *relations*, and our query only asks for ways, so a
// place like Central Park deposits nothing. Every cell near the truck is
// therefore seeded procedurally from a hash of its own coordinates —
// deterministic, so the same scrub grows in the same spot forever — and
// polygon scatter then piles extra density into the parks we DO get.
const vegSeeded = new Set<string>();
function seedCell(gx: number, gz: number): void {
  const key = `${gx},${gz}`;
  if (vegSeeded.has(key)) return;
  vegSeeded.add(key);
  const r = mulberry32(((gx * 73856093) ^ (gz * 19349663)) >>> 0);
  if (!vegGrid.has(key)) vegGrid.set(key, []);
  const mx = gx * VEG_CELL + VEG_CELL / 2, mz = gz * VEG_CELL + VEG_CELL / 2;
  // WHAT GROWS HERE IS A FACT, not a guess. The biome ceiling below stands in
  // only until WorldCover has this ground: it is one number for a whole world,
  // so the wheat field, the shelterbelt beside it and the bare hill behind
  // were all planted at the same rate out of the same species mix.
  const cover = sampleCover(mx, mz);
  const ceiling = cover !== null
    ? (COVER_VEG[cover] ?? 6)
    : (biome.name === 'arid' ? 4 : biome.name === 'tropical' ? 14 : biome.name === 'boreal' ? 12 : 9);
  // …and HOW MUCH of it, where, is still the noise field's business. Cover is
  // 37m data; it must never become a visible grid of thickets, so the density
  // field keeps deciding which patch of a cover class is thick and which is
  // open, exactly as before.
  const dens = vegDensity(mx, mz);
  const clumps = Math.round(ceiling * (0.15 + dens * 1.25));
  for (let i = 0; i < clumps; i++) {
    const x = gx * VEG_CELL + r() * VEG_CELL, z = gz * VEG_CELL + r() * VEG_CELL;
    const rad = 6 + r() * 16 * (0.4 + dens);
    const count = Math.round((5 + r() * 14) * (0.5 + dens));
    plantClump(x, z, rad, count, coverKind(sampleCover(x, z), r), r);
  }
  // A few genuine loners — a lone snag or boulder still reads as deliberate.
  // Bare ground and ice get boulders and nothing else: a dead tree standing in
  // a salt pan is the kind of detail that reads as a bug.
  const strays = Math.round(r() * 3);
  const stony = cover === COVER.bare || cover === COVER.snow || cover === COVER.built;
  for (let i = 0; i < strays; i++) {
    pushSite(gx * VEG_CELL + r() * VEG_CELL, gz * VEG_CELL + r() * VEG_CELL,
      stony || r() < 0.5 ? 'rock' : 'snag', r);
  }
}

// Refill the instanced meshes from the sites nearest the truck. Called on a
// slow tick — the field only needs to change as fast as you drive through it.
let vegAt = 0;
function refreshVeg(): void {
  const counts: Record<string, number> = { broadleaf: 0, conifer: 0, palm: 0, snag: 0, bush: 0, rock: 0 };
  let trunkN = 0;
  const cx = Math.floor(state.x / VEG_CELL), cz = Math.floor(state.z / VEG_CELL);
  const reach = Math.ceil(VEG_RANGE / VEG_CELL);
  const r2 = VEG_RANGE * VEG_RANGE;
  // NEAREST FIRST. Walk cells in rings outward from the truck, so when a pool
  // fills it is the far plants that get dropped — visiting the grid in raster
  // order let distant thickets eat the caps and leave the ground you are
  // actually looking at bare.
  const ring: Array<[number, number]> = [];
  for (let d = 0; d <= reach; d++) {
    for (let gx = cx - d; gx <= cx + d; gx++) {
      for (let gz = cz - d; gz <= cz + d; gz++) {
        if (Math.max(Math.abs(gx - cx), Math.abs(gz - cz)) === d) ring.push([gx, gz]);
      }
    }
  }
  for (const [gx, gz] of ring) {
    {
      seedCell(gx, gz);
      const cell = vegGrid.get(`${gx},${gz}`);
      if (!cell) continue;
      for (const v of cell) {
        const dx = v.x - state.x, dz = v.z - state.z;
        if (dx * dx + dz * dz > r2) continue;
        const mesh = vegMeshes[v.k];
        const i = counts[v.k];
        if (i >= VEG_CAP[v.k] * vegScale) continue;
        const y = groundAt(v.x, v.z);
        vegDummy.position.set(v.x, y + v.h, v.z);
        vegDummy.rotation.set(0, v.rot, 0);
        vegDummy.scale.setScalar(v.s);
        vegDummy.updateMatrix();
        mesh.setMatrixAt(i, vegDummy.matrix);
        mesh.setColorAt(i, v.c);
        counts[v.k] = i + 1;
        if (v.h > 0 && trunkN < 3600) {
          vegDummy.position.set(v.x, y, v.z);
          vegDummy.rotation.set(0, 0, 0);
          vegDummy.scale.set(v.s * 0.42, v.h + v.s * 0.3, v.s * 0.42);
          vegDummy.updateMatrix();
          trunks.setMatrixAt(trunkN++, vegDummy.matrix);
        }
      }
    }
  }
  for (const k of Object.keys(vegMeshes) as VegKind[]) {
    const m = vegMeshes[k];
    m.count = counts[k];
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  trunks.count = trunkN;
  trunks.instanceMatrix.needsUpdate = true;
  // Forget buckets far behind so a long drive cannot grow the site list
  // without bound. They regenerate identically if you come back.
  if (vegGrid.size > 900) {
    for (const key of vegGrid.keys()) {
      const [kx, kz] = key.split(',').map(Number);
      if (Math.abs(kx - cx) > reach + 3 || Math.abs(kz - cz) > reach + 3) {
        vegGrid.delete(key);
        vegSeeded.delete(key);
      }
    }
  }
}

// ── wildlife ───────────────────────────────────────────────────────
// Two populations, both boids-lite and both aware of the truck. They live in
// a box that follows the car and wraps, like the rain — so the world always
// has something alive in it without simulating a planet.
const BIRD_N = 46, BIRD_BOX = 260;
const birdGeo = new THREE.ConeGeometry(0.5, 1.6, 3);   // a chevron in silhouette
birdGeo.rotateX(-Math.PI / 2);
const birdMat = new THREE.MeshLambertMaterial({ color: 0x2a2f36, flatShading: true });
const birds = new THREE.InstancedMesh(birdGeo, birdMat, BIRD_N);
birds.frustumCulled = false;
birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(birds);
// ── the herd: three real animals, not one box ──────────────────────
// Each species is a pile of coloured boxes welded into ONE BufferGeometry, so
// a whole herd of them is still a single instanced draw. Local +z is forward
// (that is what `yaw = atan2(vx, vz)` below implies), y=0 is the ground.
function boxPart(w: number, h: number, d: number, x: number, y: number, z: number, col: number, rx = 0, ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  // Vertex colours live in LINEAR space — three converts a hex through
  // ColorManagement on the way into Color, and does not touch the attribute.
  const c = new THREE.Color(col);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    col.set(g.attributes.color.array as Float32Array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
// Legs at the four corners, one call.
const legs = (w: number, h: number, d: number, sx: number, fz: number, bz: number, col: number): THREE.BufferGeometry[] =>
  [[-sx, fz], [sx, fz], [-sx, bz], [sx, bz]].map(([x, z]) => boxPart(w, h, d, x, h / 2, z, col));
// DEER — light, long-legged, head carried high, antlers.
const deerGeo = mergeParts([
  boxPart(0.52, 0.6, 1.3, 0, 0.98, 0, 0x8a6136),          // barrel
  boxPart(0.44, 0.3, 0.9, 0, 0.78, -0.15, 0xb09371),      // pale belly
  boxPart(0.3, 0.24, 0.34, 0, 0.98, -0.7, 0xd8cdb4),      // rump patch
  boxPart(0.26, 0.56, 0.28, 0, 1.4, 0.6, 0x8a6136, 0.35), // neck, raked forward
  boxPart(0.23, 0.24, 0.48, 0, 1.66, 0.88, 0x7d5730),     // head
  boxPart(0.32, 0.1, 0.1, 0, 1.76, 0.72, 0x6b4a2a),       // ears
  ...[-0.09, 0.09].flatMap((sx) => [                       // antlers: beam + tines
    boxPart(0.05, 0.42, 0.05, sx, 1.96, 0.74, 0xbdae90),
    boxPart(0.05, 0.05, 0.3, sx, 2.1, 0.86, 0xbdae90),
    boxPart(0.18, 0.05, 0.05, sx * 2.4, 2.14, 0.7, 0xbdae90),
  ]),
  boxPart(0.14, 0.2, 0.12, 0, 1.02, -0.72, 0xd8cdb4),     // flag tail
  ...legs(0.11, 0.92, 0.13, 0.2, 0.48, -0.48, 0x5f4126),
]);
// BISON — mass forward: a shoulder hump twice the height of the hindquarters,
// head slung low, stubby legs. The silhouette is the whole character.
const bisonGeo = mergeParts([
  boxPart(0.88, 0.8, 1.05, 0, 1.18, -0.5, 0x4a3a2c),      // hindquarters
  boxPart(1.02, 1.12, 1.0, 0, 1.36, 0.42, 0x5d4a35),      // hump/shoulder shag
  boxPart(0.9, 0.5, 0.5, 0, 1.02, 0.92, 0x382c22),        // chest
  boxPart(0.58, 0.56, 0.62, 0, 0.96, 1.26, 0x2f2620),     // head, carried low
  boxPart(0.5, 0.34, 0.2, 0, 0.66, 1.3, 0x241c17),        // beard
  ...[-1, 1].map((s) => boxPart(0.3, 0.11, 0.11, s * 0.4, 1.22, 1.24, 0xa89a7d)),  // horns out
  ...[-1, 1].map((s) => boxPart(0.11, 0.16, 0.11, s * 0.52, 1.32, 1.22, 0xa89a7d)),// and up
  boxPart(0.12, 0.34, 0.12, 0, 1.1, -1.02, 0x2f2620),     // tail
  ...legs(0.22, 0.82, 0.24, 0.32, 0.6, -0.6, 0x2b221b),
]);
// HORSE — the long one: deep barrel, arched neck, mane and a full tail.
const horseGeo = mergeParts([
  boxPart(0.6, 0.76, 1.7, 0, 1.3, -0.1, 0x6b4a34),        // barrel
  boxPart(0.52, 0.3, 1.2, 0, 1.02, -0.1, 0x7d5b40),       // belly
  boxPart(0.3, 0.72, 0.44, 0, 1.72, 0.78, 0x6b4a34, 0.42),// neck
  boxPart(0.25, 0.28, 0.6, 0, 2.02, 1.06, 0x5c3e2b),      // head
  boxPart(0.27, 0.16, 0.2, 0, 1.94, 1.32, 0x3a2618),      // muzzle
  boxPart(0.12, 0.42, 0.66, 0, 1.98, 0.72, 0x2a2018),     // mane
  boxPart(0.18, 0.6, 0.18, 0, 1.34, -1.0, 0x2a2018),      // tail
  ...legs(0.15, 1.12, 0.17, 0.24, 0.62, -0.66, 0x4a3324),
]);
const HERD_GEO = [deerGeo, bisonGeo, horseGeo];
// Who lives where. Weights per biome — no bison in the rainforest, and the
// desert is horse country.
const HERD_MIX: Record<string, number[]> = {
  arid: [3, 1, 5], tropical: [7, 0, 2], temperate: [5, 3, 3], boreal: [6, 4, 1], alpine: [5, 3, 3],
};
const HERD_N = 26, HERD_BOX = 240;
// White base: the product of the vertex colour and the per-instance tint IS
// the final colour, so the material must not scale either of them.
const herdMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, flatShading: true });
const herds = HERD_GEO.map((g) => {
  const m = new THREE.InstancedMesh(g, herdMat, HERD_N);
  m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(HERD_N * 3).fill(1), 3);
  m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  scene.add(m);
  return m;
});
// No animal is ever allowed within this of the truck. Wider than CAR_R (2.4)
// by enough that even the bison's bulk clears the bodywork.
const HERD_CLEAR = 4.8;
// The closest any of them has come this session — a test drives at the herd
// and asserts this never drops to the truck.
let herdClosest = Infinity;
interface Critter { x: number; y: number; z: number; vx: number; vy: number; vz: number; ph: number; sp: number; tint: THREE.Color }
function pickSpecies(): number {
  const mix = HERD_MIX[biome.name] ?? HERD_MIX.temperate;
  let total = 0;
  for (const w of mix) total += w;
  let t = Math.random() * total;
  for (let i = 0; i < mix.length; i++) { t -= mix[i]; if (t <= 0) return i; }
  return 0;
}
const mkPop = (n: number, box: number, air: boolean): Critter[] =>
  Array.from({ length: n }, () => ({
    x: (Math.random() - 0.5) * box, y: air ? 30 + Math.random() * 40 : 0, z: (Math.random() - 0.5) * box,
    vx: (Math.random() - 0.5) * 6, vy: 0, vz: (Math.random() - 0.5) * 6, ph: Math.random() * 6.283,
    sp: air ? 0 : pickSpecies(),
    // A coat is never twice the same: ±15% brightness, a touch warm or cool.
    tint: new THREE.Color().setHSL(0.07 + Math.random() * 0.05, 0.18 + Math.random() * 0.2, 0.44 + Math.random() * 0.16)
      .multiplyScalar(2.1),
  }));
const flock = mkPop(BIRD_N, BIRD_BOX, true);
const graze = mkPop(HERD_N, HERD_BOX, false);
const critterDummy = new THREE.Object3D();
// Yaw FIRST, then pitch about the animal's own axis — with the default XYZ
// order a galloping bob would pitch about the world x and shear the herd.
critterDummy.rotation.order = 'YXZ';
// One boids step: cohere to the local centre, separate from close neighbours,
// align with their heading — then flee the truck, which overrides everything.
function stepPop(pop: Critter[], meshes: THREE.InstancedMesh[], dt: number, o: {
  box: number; air: boolean; speed: number; fear: number; sep: number; turn: number;
}): void {
  const cx = camera.position.x, cz = camera.position.z;
  let mx = 0, mz = 0, mvx = 0, mvz = 0;
  for (const c of pop) { mx += c.x; mz += c.z; mvx += c.vx; mvz += c.vz; }
  mx /= pop.length; mz /= pop.length; mvx /= pop.length; mvz /= pop.length;
  const counts = meshes.map(() => 0);
  for (const c of pop) {
    let ax = (mx - c.x) * 0.06 + (mvx - c.vx) * 0.35;   // cohesion + alignment
    let az = (mz - c.z) * 0.06 + (mvz - c.vz) * 0.35;
    for (const d of pop) {                               // separation
      if (d === c) continue;
      const dx = c.x - d.x, dz = c.z - d.z;
      const q = dx * dx + dz * dz;
      if (q < o.sep * o.sep && q > 1e-4) { const f = (o.sep - Math.sqrt(q)) * 0.5; ax += (dx / Math.sqrt(q)) * f; az += (dz / Math.sqrt(q)) * f; }
    }
    // FLEE. Close to the truck they break formation entirely — that reaction
    // is what makes them read as alive rather than as scenery that moves.
    //
    // Panic scales with how close the truck is AND how fast it is coming, and
    // the bolt is biased SIDEWAYS: an animal sprinting straight down the line
    // of a vehicle that is faster than it is an animal about to be hit, which
    // is exactly how the old "run directly away" rule played out.
    const fx = c.x - state.x, fz = c.z - state.z;
    const fd = Math.hypot(fx, fz) || 1e-3;
    const carV = Math.abs(state.speed);
    // Reaction DISTANCE, not a fixed radius: what matters is how long they have
    // before it arrives. A parked truck barely bothers them — you can idle up
    // and watch — while one doing 90 sends the herd moving from 80m out.
    const fear = o.fear + carV * (o.air ? 0.5 : 2.2);
    const panic = fd < fear ? 1 - fd / fear : 0;
    if (panic > 0) {
      const hx = Math.sin(state.heading), hz = -Math.cos(state.heading); // truck forward
      const side = Math.sign(fx * -hz + fz * hx) || 1;   // which flank it is already on
      const mix = 0.4 + 0.6 * panic;                     // closer ⇒ more sideways
      const ex = (fx / fd) * (1 - mix) + -hz * side * mix;
      const ez = (fz / fd) * (1 - mix) + hx * side * mix;
      const el = Math.hypot(ex, ez) || 1;
      const p = panic * panic * o.speed * 30;
      ax += (ex / el) * p;
      az += (ez / el) * p;
      if (o.air) c.vy += 9 * dt;                          // birds climb away
    }
    c.vx += ax * dt * o.turn * (1 + panic * 3); c.vz += az * dt * o.turn * (1 + panic * 3);
    c.ph += dt * (o.air ? 9 : 3 + panic * 9);
    // Hold a cruising speed rather than accelerating forever — except in a
    // panic, where the whole point is to out-run whatever is chasing them.
    const sp = Math.hypot(c.vx, c.vz) || 1e-3;
    const flatOut = Math.min(Math.max(o.speed * 4.5, carV * 1.2), o.air ? 30 : 22);
    const want = o.speed + (flatOut - o.speed) * panic;
    const k = Math.min(1, dt * (2 + 16 * panic));         // and accelerate hard
    c.vx = (c.vx / sp) * (sp + (want - sp) * k);
    c.vz = (c.vz / sp) * (sp + (want - sp) * k);
    c.x += c.vx * dt; c.z += c.vz * dt;
    // THE GUARANTEE. Everything above is a force model, and a force model can
    // only ever make a collision unlikely: the truck tops out around 25m/s and
    // nothing on four legs here does. So a hard minimum separation backstops
    // it — placed mostly sideways, because pushing an animal straight down the
    // truck's line would drag it along the bumper instead of clearing it.
    if (!o.air) {
      const gx = c.x - state.x, gz = c.z - state.z;
      const gd = Math.hypot(gx, gz);
      if (gd < HERD_CLEAR) {
        const hx = Math.sin(state.heading), hz = -Math.cos(state.heading);
        const side = Math.sign(gx * -hz + gz * hx) || 1;
        const ex = (gd > 1e-3 ? gx / gd : 0) * 0.3 + -hz * side * 0.7;
        const ez = (gd > 1e-3 ? gz / gd : 0) * 0.3 + hx * side * 0.7;
        const el = Math.hypot(ex, ez) || 1;
        c.x = state.x + (ex / el) * HERD_CLEAR;
        c.z = state.z + (ez / el) * HERD_CLEAR;
      }
      herdClosest = Math.min(herdClosest, Math.hypot(c.x - state.x, c.z - state.z));
    }
    if (o.air) {
      c.vy += (34 + Math.sin(c.ph * 0.2) * 12 - c.y) * 0.25 * dt;  // hold altitude
      c.vy *= 0.96;
      c.y += c.vy * dt;
    } else {
      c.y = groundAt(c.x, c.z);
    }
    // Wrap around the camera so the population is always where you are.
    const h = o.box / 2;
    if (c.x - cx > h) c.x -= o.box; else if (cx - c.x > h) c.x += o.box;
    if (c.z - cz > h) c.z -= o.box; else if (cz - c.z > h) c.z += o.box;
    // NOTHING GRAZES ON THE SEA. The herd wraps around the camera, so on a
    // coast half of it lands on open water. It keeps simulating out there —
    // the flock forces will walk it back ashore within seconds — but it is not
    // drawn, because a deer standing on the Pacific is worse than no deer.
    if (!o.air && surfaceAt(c.x, c.z) === 'water') continue;
    const yaw = Math.atan2(c.vx, c.vz);
    // GAIT. Four legs welded to the body can't stride, so the animal rides its
    // own stride instead: a bob and a pitch on the same phase, scaled by how
    // hard it is actually running. At a walk it is barely there; fleeing the
    // truck the whole herd starts porpoising.
    const gait = o.air ? 0 : Math.min(1, Math.hypot(c.vx, c.vz) / (o.speed * 2));
    critterDummy.position.set(c.x, c.y + (o.air ? 0 : Math.abs(Math.sin(c.ph * 1.7)) * 0.14 * gait), c.z);
    critterDummy.rotation.set(
      o.air ? 0 : Math.sin(c.ph * 1.7 + 0.9) * 0.11 * gait,
      yaw,
      o.air ? Math.sin(c.ph) * 0.5 : Math.sin(c.ph * 0.85) * 0.04 * gait, // birds bank; beasts sway
    );
    critterDummy.scale.setScalar(o.air ? 1 : 0.94 + (c.sp === 1 ? 0.06 : 0.12) * Math.sin(c.ph * 0.5) + 0.06);
    critterDummy.updateMatrix();
    const mesh = meshes[c.sp] ?? meshes[0];
    const idx = counts[c.sp] ?? counts[0];
    mesh.setMatrixAt(idx, critterDummy.matrix);
    mesh.instanceColor?.setXYZ(idx, c.tint.r, c.tint.g, c.tint.b);
    counts[c.sp] = idx + 1;
  }
  for (let i = 0; i < meshes.length; i++) {
    meshes[i].count = counts[i];
    meshes[i].instanceMatrix.needsUpdate = true;
    if (meshes[i].instanceColor) meshes[i].instanceColor!.needsUpdate = true;
  }
}
function stepWildlife(dt: number): void {
  // Rain grounds the birds; a storm keeps them down entirely.
  birds.visible = wx.rain < 0.5;
  if (birds.visible) stepPop(flock, [birds], dt, { box: BIRD_BOX, air: true, speed: 11, fear: 55, sep: 7, turn: 1 });
  stepPop(graze, herds, dt, { box: HERD_BOX, air: false, speed: 2.4, fear: 24, sep: 6, turn: 1.6 });
}

// ── the map layer (minimap base, FOG_SPAN frame, north-up) ─────────
// Streamed features draw themselves here as they register; the minimap
// composites this under the fog mask, so the map only shows what the fog has
// ceded — the chart fills in as you explore.
const MAP_PX = 1024;
const mapLayer = document.createElement('canvas');
mapLayer.width = mapLayer.height = MAP_PX;
const mapCtx = mapLayer.getContext('2d')!;
mapCtx.fillStyle = '#141b14';
mapCtx.fillRect(0, 0, MAP_PX, MAP_PX);
const mapPt = (x: number, z: number): [number, number] => [((x + FOG_SPAN / 2) / FOG_SPAN) * MAP_PX, ((z + FOG_SPAN / 2) / FOG_SPAN) * MAP_PX];
const M_PER_PX = FOG_SPAN / MAP_PX;
function mapSeg(ax: number, az: number, bx: number, bz: number, width: number, color: string): void {
  const [x0, z0] = mapPt(ax, az), [x1, z1] = mapPt(bx, bz);
  mapCtx.strokeStyle = color;
  mapCtx.lineWidth = Math.max(1, width / M_PER_PX);
  mapCtx.lineCap = 'round';
  mapCtx.beginPath(); mapCtx.moveTo(x0, z0); mapCtx.lineTo(x1, z1); mapCtx.stroke();
}
function mapPoly(pts: Array<[number, number]>, color: string): void {
  mapCtx.fillStyle = color;
  mapCtx.beginPath();
  pts.forEach(([x, z], i) => { const [px, pz] = mapPt(x, z); i ? mapCtx.lineTo(px, pz) : mapCtx.moveTo(px, pz); });
  mapCtx.closePath(); mapCtx.fill();
}

// ── collision & surface grids (24m cells) ──────────────────────────
// The three rungs of the surface ladder, as qualities. Declared here because
// the road grid and surfaceAt both stand on them; the tables and the physics
// that read them live down with SURFACE.
const Q_ROAD = 1, Q_TRACK = 0.55, Q_GROUND = 0.2;
const GRID = 24;
const gkey = (x: number, z: number): string => `${Math.floor(x / GRID)},${Math.floor(z / GRID)}`;
interface Seg { ax: number; az: number; bx: number; bz: number; hw: number; ya?: number; yb?: number; tk?: boolean; tn?: boolean;
  /** The way's OSM name. Streets were deliberately excluded from the POI set
   *  ("named streets are not destinations") — but the road you are ON is not a
   *  destination, it is your position, and that is worth saying. */
  nm?: string;
  /** A guard rail rather than a wall. Still solid, but glancing it costs you
   *  almost nothing — see the collision scrub. */
  sl?: boolean;
  /** Surface quality 0..1 from the way's surface/smoothness/tracktype tags —
   *  see wayQuality. Absent where the way said nothing, and then the class
   *  default stands in. */
  sq?: number }
const wallGrid = new Map<string, Seg[]>();   // building edges — solid
const roadGrid = new Map<string, Seg[]>();   // drivable centrelines + half-width
const waterCells = new Set<string>();        // coarse water mask
function addSeg(grid: Map<string, Seg[]>, seg: Seg): void {
  const m = seg.hw + 8; // insert with margin so a single-cell query suffices
  const x0 = Math.floor((Math.min(seg.ax, seg.bx) - m) / GRID), x1 = Math.floor((Math.max(seg.ax, seg.bx) + m) / GRID);
  const z0 = Math.floor((Math.min(seg.az, seg.bz) - m) / GRID), z1 = Math.floor((Math.max(seg.az, seg.bz) + m) / GRID);
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
    const k = `${cx},${cz}`;
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(seg);
  }
}
function closestOnSeg(px: number, pz: number, s: Seg): [number, number] {
  const dx = s.bx - s.ax, dz = s.bz - s.az;
  const t = clamp(((px - s.ax) * dx + (pz - s.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return [s.ax + dx * t, s.az + dz * t];
}
function pointInPoly(px: number, pz: number, pts: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// ── never inside a building ────────────────────────────────────────
// The wall grid alone cannot save you here. It pushes the car off any edge
// within CAR_R, which is exactly the wrong behaviour once you are PAST the
// edge: stand in the middle of a warehouse and no segment is near enough to
// push at all, and the moment you drive at a wall from the inside it shoves
// you back in. You can spawn there, or a building can stream in on top of you.
// So footprints are indexed as POLYGONS too, and containment is escaped by
// leaving through the nearest wall rather than by bouncing off it.
const plotGrid = new Map<string, Array<Array<[number, number]>>>();
function addPlot(pts: Array<[number, number]>): void {
  let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
  for (const [x, z] of pts) { minx = Math.min(minx, x); minz = Math.min(minz, z); maxx = Math.max(maxx, x); maxz = Math.max(maxz, z); }
  for (let cx = Math.floor(minx / GRID); cx <= Math.floor(maxx / GRID); cx++)
    for (let cz = Math.floor(minz / GRID); cz <= Math.floor(maxz / GRID); cz++) {
      const k = `${cx},${cz}`;
      let arr = plotGrid.get(k);
      if (!arr) plotGrid.set(k, (arr = []));
      arr.push(pts);
    }
}
// Nearest point on a polygon's boundary, and how far away it is.
function nearestOnPoly(px: number, pz: number, pts: Array<[number, number]>): [number, number, number] {
  let bx = px, bz = pz, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [cx, cz] = pts[(i + 1) % pts.length];
    const dx = cx - ax, dz = cz - az;
    const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const qx = ax + dx * t, qz = az + dz * t;
    const d = Math.hypot(px - qx, pz - qz);
    if (d < bd) { bd = d; bx = qx; bz = qz; }
  }
  return [bx, bz, bd];
}
function insidePlot(x: number, z: number): boolean {
  for (const pts of plotGrid.get(gkey(x, z)) ?? []) if (pointInPoly(x, z, pts)) return true;
  return false;
}
// If (x,z) is inside any footprint, return a point OUTSIDE every footprint;
// otherwise null.
//
// Leaving through the nearest wall is the cheap case and handles a lone
// building. It is NOT enough on a real city block: Manhattan footprints share
// party walls, so the nearest wall is often an interior one and stepping
// through it just lands you in the neighbour. Measured on 456 drops into
// midtown, wall-stepping alone left 280 still indoors. So when the cheap path
// fails to find daylight, sweep outward on rings until a free point turns up —
// that terminates as long as the block is finite, which every block is.
function escapeBuildings(x: number, z: number, clear: number): [number, number] | null {
  if (!insidePlot(x, z)) return null;
  let ox = x, oz = z;
  for (let pass = 0; pass < 6; pass++) {
    let hit = false;
    for (const pts of plotGrid.get(gkey(ox, oz)) ?? []) {
      if (!pointInPoly(ox, oz, pts)) continue;
      const [bx, bz, d] = nearestOnPoly(ox, oz, pts);
      // `d` points INWARD (we are inside, b is on the wall), so stepping the
      // other way from b leaves the building. Sitting exactly on the boundary
      // makes that direction degenerate — then take the centroid as "inward".
      let dx = ox - bx, dz = oz - bz;
      if (d < 1e-3) {
        let cx = 0, cz = 0;
        for (const [px, pz] of pts) { cx += px; cz += pz; }
        dx = cx / pts.length - bx; dz = cz / pts.length - bz;
      }
      const len = Math.hypot(dx, dz) || 1;
      ox = bx - (dx / len) * clear;
      oz = bz - (dz / len) * clear;
      hit = true;
    }
    if (!hit) return [ox, oz];
  }
  // Still boxed in after six wall-steps: we are somewhere in the middle of a
  // solid block. Sweep outward for daylight, preferring tarmac — the street is
  // where a driver wants to be spat out anyway.
  let fallback: [number, number] | null = null;
  for (let rad = 8; rad <= 220; rad += 8) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2 + rad * 0.37; // stagger, so rings don't align
      const px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad;
      if (insidePlot(px, pz)) continue;
      const surf = surfaceAt(px, pz);
      if (surf === 'road') return [px, pz];
      if (surf === 'ground' && !fallback) fallback = [px, pz];
    }
    if (fallback) return fallback;
  }
  // Nothing free within 220m. Returning the wall-stepped point would drop the
  // car inside ANOTHER building, and then this whole sweep would run again on
  // the next frame, and the next — a teleport loop that also eats the frame
  // budget. Better to report failure and leave the car where it is.
  return null;
}
// Put the car outside. Called both when a building streams in around it and
// every frame, so there is no way to end up sealed in — not by spawning, not
// by a teleport, not by a push-out that overshoots through a party wall.
function evictFromBuildings(): boolean {
  const out = escapeBuildings(state.x, state.z, CAR_R + 1.2);
  if (!out) return false;
  state.x = out[0];
  state.z = out[1];
  state.speed *= 0.3; // being spat through a wall should cost you your momentum
  return true;
}
// First wall crossing (as a 0..1 fraction along a→b) that stands taller than
// camY — used to pull the chase camera in front of façades instead of letting
// it phase inside buildings (the "black slab across the sky" failure).
function wallHitAlong(ax: number, az: number, bx: number, bz: number, camY: number): number {
  let sMin = 1;
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (GRID / 2)));
  const seen = new Set<Seg[]>();
  for (let i = 0; i <= steps; i++) {
    const segs = wallGrid.get(gkey(ax + ((bx - ax) * i) / steps, az + ((bz - az) * i) / steps));
    if (!segs || seen.has(segs)) continue;
    seen.add(segs);
    for (const s of segs) {
      if (s.ya !== undefined && camY > s.ya) continue; // clean over the roof
      const r1x = bx - ax, r1z = bz - az, r2x = s.bx - s.ax, r2z = s.bz - s.az;
      const den = r1x * r2z - r1z * r2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((s.ax - ax) * r2z - (s.az - az) * r2x) / den;
      const u = ((s.ax - ax) * r1z - (s.az - az) * r1x) / den;
      if (t >= 0.02 && t <= 1 && u >= 0 && u <= 1 && t < sMin) sMin = t;
    }
  }
  return sMin;
}
type Surface = 'road' | 'track' | 'water' | 'ground';
/**
 * The surface quality that the LAST call to `surfaceAt` resolved — 1 for new
 * tarmac, down to 0.1 for a sand piste. Read it straight after the call that
 * set it.
 *
 * A side channel rather than a returned pair because `surfaceAt` runs four
 * times a frame for the wheels alone and again for every ring point of a
 * building escape sweep, and allocating a result object on that path buys
 * nothing but garbage.
 */
let surfQ = Q_ROAD;
function surfaceAt(x: number, z: number): Surface {
  // Scan them ALL: tarmac wins wherever a track crosses or joins a road, and
  // returning on the first hit made that depend on insertion order. Where two
  // of a kind overlap the BETTER surface wins for the same reason — you are
  // driving on the top one.
  let road = -1, track = -1;
  for (const seg of roadGrid.get(gkey(x, z)) ?? []) {
    const [cx, cz] = closestOnSeg(x, z, seg);
    if (Math.hypot(x - cx, z - cz) > seg.hw + 0.8) continue;
    if (seg.tk) track = Math.max(track, seg.sq ?? Q_TRACK);
    else road = Math.max(road, seg.sq ?? Q_ROAD);
  }
  if (road >= 0) { surfQ = road; return 'road'; }
  if (track >= 0) { surfQ = track; return 'track'; }
  surfQ = Q_GROUND;
  if (waterCells.has(gkey(x, z))) return 'water';
  // WHAT THE GROUND IS beats how high the DEM thinks it is. Off Big Sur the
  // elevation source fills the whole ocean at a flat +1.2m, so the height test
  // below called four kilometres of open Pacific dry ground and let the truck
  // drive out onto it. WorldCover knows the difference at 10m, and a road laid
  // over water is a bridge, which is why this sits AFTER the carriageways.
  if (sampleCover(x, z) === COVER.water) return 'water';
  const sl = seaLevelY();
  return sl !== null && sampleHeight(x, z) < sl - 0.7 ? 'water' : 'ground';
}
/**
 * The way you are on, or the nearest one you are not.
 *
 * Returns `{ name, on }` — `on` is true when the point is actually within the
 * carriageway, false when the nearest named road is merely the closest thing
 * to where you have parked in a field. The distinction is the whole value of
 * the line: "OU KAAPSE WEG" and "NEAR OU KAAPSE WEG" are different facts, and
 * a driver reading a HUD deserves to be told which one they are living in.
 *
 * Widening rings rather than one big sweep: on a road the answer is in the
 * first ring and costs one grid cell, which is the case that runs every frame.
 */
function wayAt(x: number, z: number): { name: string; on: boolean } | null {
  let best: string | null = null, bd = Infinity, on = false;
  for (const reach of [0, 1, 2]) {
    for (let cx = -reach; cx <= reach; cx++) for (let cz = -reach; cz <= reach; cz++) {
      if (reach > 0 && Math.max(Math.abs(cx), Math.abs(cz)) < reach) continue;  // ring only
      for (const seg of roadGrid.get(`${Math.floor(x / GRID) + cx},${Math.floor(z / GRID) + cz}`) ?? []) {
        if (!seg.nm) continue;
        const [px, pz] = closestOnSeg(x, z, seg);
        const d = Math.hypot(x - px, z - pz);
        if (d < bd) { bd = d; best = seg.nm; on = d <= seg.hw + 1; }
      }
    }
    if (best) break;   // nearest ring with a named road wins
  }
  return best ? { name: best, on } : null;
}
/** Proper 2D segment crossing — endpoints touching does not count. */
function segsCross(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  const s1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const s2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const s3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx);
  const s4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return s1 > 0 !== s2 > 0 && s3 > 0 !== s4 > 0;
}
/**
 * Does a parapet run here cut across another road?
 *
 * A rail is drawn parallel to its own centreline, so its own road can never
 * cross it — but a side road joining does, and a barrier sealing off a
 * junction is both wrong to look at and wrong to drive. The test is a genuine
 * crossing rather than a proximity check precisely because of that asymmetry:
 * proximity would fire on the road the rail belongs to.
 */
function railCrossesRoad(ax: number, az: number, bx: number, bz: number): boolean {
  const L = Math.hypot(bx - ax, bz - az);
  // Reach a little past each end, so the gap opens wide enough to drive through
  // rather than leaving a stub of rail across the mouth of the turning.
  const ex = L > 0.01 ? ((bx - ax) / L) * 5 : 0, ez = L > 0.01 ? ((bz - az) / L) * 5 : 0;
  const x0 = ax - ex, z0 = az - ez, x1 = bx + ex, z1 = bz + ez;
  const seen = new Set<Seg>();
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (GRID / 2)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    for (const seg of roadGrid.get(gkey(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) ?? []) {
      if (seen.has(seg)) continue;
      seen.add(seg);
      if (segsCross(x0, z0, x1, z1, seg.ax, seg.az, seg.bx, seg.bz)) return true;
    }
  }
  return false;
}
/**
 * Do two or more differently-aligned roads meet within reach of this point?
 *
 * Used to decide where a direction board earns its place. Alignment is the
 * test, not count: a single road passing through contributes many nearly
 * parallel segments, and counting those would put a route sign every fifty
 * metres of open highway.
 */
function junctionNear(x: number, z: number, reach = 22): boolean {
  let base: [number, number] | null = null;
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    for (const seg of roadGrid.get(`${Math.floor(x / GRID) + cx},${Math.floor(z / GRID) + cz}`) ?? []) {
      const [px, pz] = closestOnSeg(x, z, seg);
      if (Math.hypot(x - px, z - pz) > reach) continue;
      const l = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az) || 1;
      const ux = (seg.bx - seg.ax) / l, uz = (seg.bz - seg.az) / l;
      if (!base) { base = [ux, uz]; continue; }
      // |cos| so a segment pointing back down the same road still counts as
      // parallel; 0.82 is about 35° apart.
      if (Math.abs(base[0] * ux + base[1] * uz) < 0.82) return true;
    }
  }
  return false;
}
// The road's own elevation at (x,z) — differs from the terrain wherever the
// profile smoothing decided a stretch is a tunnel or bridge.
function roadHeightAt(x: number, z: number): number | null {
  let best: number | null = null, bd = Infinity;
  for (const seg of roadGrid.get(gkey(x, z)) ?? []) {
    if (seg.ya === undefined || seg.yb === undefined) continue;
    const dx = seg.bx - seg.ax, dz = seg.bz - seg.az;
    const t = clamp(((x - seg.ax) * dx + (z - seg.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const d = Math.hypot(x - (seg.ax + dx * t), z - (seg.az + dz * t));
    if (d <= seg.hw + 0.8 && d < bd) { bd = d; best = seg.ya + (seg.yb - seg.ya) * t; }
  }
  return best;
}

// ── the road corridor: a volume, not a decal ───────────────────────
// A ribbon draped on the heightfield is a zero-thickness surface, and the
// terrain MESH is not the heightfield: it carries one vertex every ~21m and
// interpolates flat between them, while the ribbon samples the bilinear field
// every 12m and again at both kerbs. On any curved hillside the two disagree
// by metres, and the road either floats or is swallowed. Two halves fix it:
//
//   DOWN — every carriageway is extruded into a solid (see `apron` below), so
//          the gap under a floating road is filled with earth instead of sky.
//   UP   — the terrain is cut back out of the corridor, so nothing stands in
//          the road's airspace. The cut is graded outward into a bank rather
//          than left as a wall.
// The ceiling sits BELOW the tarmac across the carriageway and rises beyond
// the kerb — but NOT at the batter straight away, and the reason is the
// terrain mesh's own sampling. The cut lives in a FIELD; the mesh samples it
// at TERRAIN_SEG vertices per tile (~16m apart) and draws straight triangles
// between them. A ceiling that rises 32° from the kerb permits a vertex 10m
// out to stand 6m over the road, and the chord from there to the far side
// bridges clean over the corridor: Natural Bridge Road measured 5.6% of its
// length under such chords, the truck roof-deep in a hillside that the field
// said was cut. So the ceiling holds a near-flat BENCH (a 1.7° wash, enough
// to shed the dead-level look) out to the mesh cell diagonal — every corner
// of every triangle a road can pass through is inside that distance, so no
// chord can stand higher than wash·slack ≈ 0.7m below the road surface — and
// only beyond the bench does the 32° batter climb away.
const CUT_BATTER = 0.62;   // rise per metre out past the bench — a ~32° cut face
// The bench lip must finish below the road SURFACE, and the surface just came
// down from profile+0.6 to profile+0.22. At 0.03 the lip rose 0.66m over a
// 22m bench — a third of a metre ABOVE the new tarmac, which would bury the
// road the bench exists to protect. 0.008 keeps it ~0.3m clear at every
// latitude while still shedding the dead-level look.
const CUT_WASH = 0.008;    // the bench's own fall, kerb to lip
const CUT_TAIL = 14;       // how far past the bench the batter grades before nature resumes
const CUT_REACH = 14;      // tracks only: a worn groove, not an engineered cutting
let CUT_SLACK = 23;        // bench width — the mesh cell diagonal, set from the origin latitude
// A cutting has an angle of repose and so does an embankment, and it is the
// same earth either way — so the ground is protected outward from a road at
// the batter's own slope. See the bed, below.
const CUT_FILL = CUT_BATTER;
// …but only as far as the apron can follow it down. The bed is a claim that
// the ground here belongs to a road, and a claim reaching further than the
// 3.6m skirt would raise earth the road cannot meet — a wall standing beside
// the carriageway wherever a ramp runs past a street. Past this the ground is
// the neighbouring terrace's business again, which is the old behaviour, so
// the fix can only ever fill a hole and never build one.
const CUT_BED = 3.6 / CUT_FILL;   // ≈5.8m — where the bed has fallen one apron
// The highest the ground is allowed to stand at (x,z), or null where no road
// has an opinion. Tunnels are excluded: being buried is the entire point of
// one, and carving their corridor would open every tunnel into a trench.
//
// A CUT AND A BED, not just a cut. The bench above is a flat terrace at the
// road's own level reaching CUT_SLACK past the kerb, and combining terraces
// with a bare `min` says: wherever two roads come within two bench-widths of
// each other, the lower one planes the ground down to itself — straight
// through the upper one's foundation. There is no vertical term anywhere in
// the old test, so a road 21m away and 2m lower excavated the ground from
// under this one and left it standing over a flat-bottomed trench on a 3.6m
// skirt. Measured before this, as the share of road undercut deeper than the
// apron can reach: Bormio 8.6%, Chapman's Peak 11.5%, and — flat, median
// cross-fall 0.07 — CAIRO 19.6%, worst case 23.9m.
//
// So it is not an alpine bug at all. It needs two roads within two terraces of
// each other at different heights, which is a switchback, a terraced street
// and a grade-separated junction alike; what a mountain adds is bare ground to
// see it against.
//
// So each segment now contributes two numbers — a CEILING it cuts down to
// (min: any cutting in reach may remove ground) and a BED it stands on (max:
// no cutting may pass through a road's own foundation), the bed falling away
// at the fill slope so the protection tapers into the neighbouring terrace
// instead of stepping down to it.
// `hard` keeps the guarantee the bench was built for: under a carriageway the
// ground stays below that carriageway, whatever any other road wants.
function roadCeiling(x: number, z: number): number | null {
  let ceil: number | null = null;   // what the cuttings take away
  let bed: number | null = null;    // what no cutting may take
  let hard: number | null = null;   // carriageways directly overhead
  const R = CUT_SLACK + CUT_TAIL + 2;
  const cx0 = Math.floor((x - R) / GRID), cx1 = Math.floor((x + R) / GRID);
  const cz0 = Math.floor((z - R) / GRID), cz1 = Math.floor((z + R) / GRID);
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
    const arr = roadGrid.get(`${cx},${cz}`);
    if (!arr) continue;
    for (const seg of arr) {
      if (seg.tn || seg.ya === undefined || seg.yb === undefined) continue;
      const dx = seg.bx - seg.ax, dz = seg.bz - seg.az;
      const t = clamp(((x - seg.ax) * dx + (z - seg.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const d = Math.hypot(x - (seg.ax + dx * t), z - (seg.az + dz * t));
      const out = d - (seg.hw + 0.6);
      // A track is worn, not engineered: it keeps its narrow, shallow groove
      // rather than a benched cutting. It also FOLLOWS the terrain instead of
      // holding a profile, so the chord problem the bench exists for cannot
      // bury one.
      if (seg.tk ? out > CUT_REACH * 0.45 : out > CUT_SLACK + CUT_TAIL) continue;
      const y = seg.ya + (seg.yb - seg.ya) * t;
      const c = seg.tk
        ? y - 0.3 + Math.max(0, out) * CUT_BATTER * 1.7
        : y - 0.3 + Math.min(Math.max(out, 0), CUT_SLACK) * CUT_WASH
          + Math.max(0, out - CUT_SLACK) * CUT_BATTER;
      if (ceil === null || c < ceil) ceil = c;
      if (out <= CUT_BED) {
        const b = y - 0.3 - Math.max(0, out) * CUT_FILL;
        if (bed === null || b > bed) bed = b;
      }
      if (out <= 0 && (hard === null || y - 0.3 < hard)) hard = y - 0.3;
    }
  }
  if (ceil === null) return null;
  let g = bed === null ? ceil : Math.max(ceil, bed);
  // A road ten metres above and twenty across has a real embankment between
  // you and it — but its toe stops at your kerb, it does not roll over your
  // carriageway. Without this the bed would bury the lower road.
  if (hard !== null && g > hard) g = hard;
  return g;
}
// The VISIBLE ground: the heightfield, cut back where a road runs through it.
// Everything that has to agree on where the surface is — the terrain mesh, the
// wheels, the scatter — goes through this, so the cut is not a lie told only to
// the renderer.
function groundAt(x: number, z: number): number {
  const h = sampleHeight(x, z);
  const c = roadCeiling(x, z);
  return c === null || c >= h ? h : c;
}

// Aprons accumulate across a whole vector tile and go up as two meshes, not two
// per way. A city block is a thousand ways, and a thousand extra draw calls to
// draw the same brown wall is the kind of thing that quietly costs 20fps.
const apron = {
  cutV: [] as number[], cutUV: [] as number[],
  dckV: [] as number[], dckUV: [] as number[],
  rlV: [] as number[], rlUV: [] as number[],
  sgV: [] as number[], sgUV: [] as number[],
};
const spanStats = {
  piers: 0, railM: 0, deckM: 0, signs: 0, maxDaylight: 0,
  at: null as [number, number] | null,
  // Where the boards went, and which way each faces — bounded, for probes.
  signAt: [] as Array<{ x: number; z: number; fx: number; fz: number; kind: number }>,
};
function flushAprons(): void {
  for (const [v, u, m] of [
    [apron.cutV, apron.cutUV, MAT.verge],
    [apron.dckV, apron.dckUV, MAT.deck],
    [apron.rlV, apron.rlUV, MAT.rail],
    [apron.sgV, apron.sgUV, MAT.sign],
  ] as const) {
    if (!v.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(u), 2));
    g.computeVertexNormals();
    worldGroup.add(new THREE.Mesh(g, m));
    v.length = 0; u.length = 0;
  }
}
type RoadMode = 'none' | 'auto' | 'tunnel' | 'bridge';
const TUNNEL_TOL = 5;  // metres of terrain above the smoothed profile ⇒ tunnel
const TUNNEL_H = 5;    // clearance of the carved tube
function ribbon(pts: Array<[number, number]>, width: number, mat: THREE.Material, lift: number, drivable = false, mode: RoadMode = 'none', track = false, name?: string, sq?: number): void {
  // BELT TO THE CLIPPER'S BRACES. Clipping to the gated tile should mean every
  // point here has real elevation under it; if one does not, the profile would
  // be built against sampleHeight's 0 and bake a causeway that no later tile
  // can ever correct, because a way is rendered exactly once. Refusing is the
  // right failure: the OSM tile is retried, and it comes back with terrain.
  for (const [px, pz] of pts) if (!hasHeight(px, pz)) { unbuilt++; return; }
  // Subdivide to ~12m steps first: OSM ways only carry vertices where the road
  // BENDS, so a long straight segment used to bridge every terrain dip between
  // its endpoints like a causeway. Dense sampling makes the ribbon hug the
  // heightfield.
  const dense: Array<[number, number]> = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 12));
    for (let s = 1; s <= steps; s++) dense.push([ax + ((bx - ax) * s) / steps, az + ((bz - az) * s) / steps]);
  }
  // Only carriageways get a solid edge. A track is two ruts worn into the
  // hillside — its ribbon is transparent everywhere but the ruts, so a pair of
  // earth walls would stand along it with nothing on top of them.
  const apronOn = drivable && !track;
  const n = dense.length;
  const elev = dense.map(([x, z]) => sampleHeight(x, z));
  // Terrain across the tube's FULL WIDTH, not just the centreline. A road in
  // a cutting has ground overhead at the centre while the hillside falls away
  // at the edges — sizing on the centreline alone left the walls standing
  // proud of the slope (measured 3.6m out in Cairo).
  const halfW = width / 2 + 1.2;
  const elevMin = dense.map(([x, z], i) => {
    const [ax2, az2] = dense[Math.max(0, i - 1)], [bx2, bz2] = dense[Math.min(n - 1, i + 1)];
    const tx = bx2 - ax2, tz = bz2 - az2, tl = Math.hypot(tx, tz) || 1;
    const ox = (-tz / tl) * halfW, oz = (tx / tl) * halfW;
    return Math.min(sampleHeight(x, z), sampleHeight(x + ox, z + oz), sampleHeight(x - ox, z - oz));
  });
  // Roads get their own longitudinal PROFILE. Terrain draping alone sends a
  // road over every hill in its path; real roads keep grade and go THROUGH.
  // Where a ~500m-smoothed profile sits more than TUNNEL_TOL below the terrain
  // the run becomes a tunnel: the road takes the portal-to-portal chord and a
  // carved tube is built around it. OSM tunnel/bridge tags force whole-way runs.
  const prof = elev.slice();
  const runs: Array<[number, number]> = [];
  if (mode !== 'none' && n > 4) {
    if (mode === 'tunnel' || mode === 'bridge') runs.push([0, n - 1]);
    else {
      const avg = (src: number[]): number[] => src.map((_, i) => {
        let s = 0, c = 0;
        for (let j = Math.max(0, i - 20); j <= Math.min(n - 1, i + 20); j++) { s += src[j]; c++; }
        return s / c;
      });
      const sm = avg(avg(elev));
      let a = -1;
      for (let i = 0; i < n; i++) {
        const deep = elev[i] - sm[i] > TUNNEL_TOL;
        if (deep && a < 0) a = i;
        if ((!deep || i === n - 1) && a >= 0) {
          if (i - a >= 2) runs.push([Math.max(0, a - 1), Math.min(n - 1, i)]);
          a = -1;
        }
      }
    }
    for (const [a, b] of runs) for (let i = a; i <= b; i++) {
      const chord = elev[a] + ((elev[b] - elev[a]) * (i - a)) / (b - a);
      // Tagged tunnels cap at the terrain: the z13 heightfield can't resolve
      // small knolls, and an uncapped chord under flat data left a giant
      // exposed tube sitting on the ground. Bridges ride the chord.
      prof[i] = mode === 'tunnel' ? Math.min(chord, elev[i]) : chord;
    }
  }
  const flat = mode !== 'none'; // profiled roads get a flat cross-section
  const verts: number[] = [];
  const uvs: number[] = [];
  // The road's THICKNESS. Two side faces hanging off the kerbs, closing the
  // gap between the carriageway and whatever the terrain mesh actually does
  // underneath it. Earth where the road is cut into the ground, concrete where
  // it rides clear of it, decided by how much daylight is under the run — which
  // gets viaducts right without needing the OSM tag to be honest.
  const segsOf: Seg[] = [];
  const DECK_GAP = 3;     // above this much daylight it is a structure, not a bank
  const APRON = 3.6;      // how far the cut face reaches below the ground it meets
  const APRON_MAX = 16;   // …but never a cliff: a hillside is the terrain's job
  const PIER_AT = 5;      // daylight past which a span needs holding up
  const PIER_SPAN = 26;   // metres between piers
  const RAIL_AT = 2.6;    // drop past the kerb that earns a parapet
  const RAIL_H = 1;       // parapet height
  // 2×CAR_R of push-out plus a lane to drive in. Below this a barrier would
  // protect you from the drop by wedging you against the cliff instead.
  const RAIL_MIN_W = 2 * CAR_R + 2.4;
  // Metres of straight road between roadside furniture. Was 85, which lined an
  // ordinary suburban street with hazard boards every few seconds and made the
  // whole world read as a permanent contraflow. On a straight the default is
  // now a marker post, and a hazard board only appears where there is a drop
  // to be warned about.
  const SIGN_EVERY = 190;
  const SIGN_DROP = 2.2;  // metres of fall past the kerb that earns a real warning
  const BEND_DEG = 14;    // heading change over one 12m step that reads as "a bend"
  // Deterministic per way: the same road grows the same signs on every device
  // and every reload, which is what makes them landmarks rather than litter.
  const signRng = mulberry32(Math.abs(Math.round(dense[0][0] * 31 + dense[0][1] * 17)) + n);
  let signRun = SIGN_EVERY;   // so a way can post one early rather than never
  /** Heading change at dense point `i`, in radians — how hard the road turns. */
  const bendAt = (i: number): number => {
    if (i <= 0 || i >= n - 1) return 0;
    const ax2 = dense[i][0] - dense[i - 1][0], az2 = dense[i][1] - dense[i - 1][1];
    const bx2 = dense[i + 1][0] - dense[i][0], bz2 = dense[i + 1][1] - dense[i][1];
    const la = Math.hypot(ax2, az2) || 1, lb = Math.hypot(bx2, bz2) || 1;
    return Math.acos(clamp((ax2 * bx2 + az2 * bz2) / (la * lb), -1, 1));
  };
  /** WHICH WAY it turns: the cross product's sign. The inside of the bend is
   *  the `+n` side when this is positive, so the outside — where the sign goes,
   *  and where your lights sweep as you turn in — is the negation. */
  const bendSign = (i: number): number => {
    if (i <= 0 || i >= n - 1) return 0;
    const ax2 = dense[i][0] - dense[i - 1][0], az2 = dense[i][1] - dense[i - 1][1];
    const bx2 = dense[i + 1][0] - dense[i][0], bz2 = dense[i + 1][1] - dense[i][1];
    return ax2 * bz2 - az2 * bx2;
  };
  // SMOOTHED along the way, and shared by both kerbs. Deciding per quad and per
  // side made adjacent quads flip between a 4m curtain of soil and a 1.35m
  // concrete lip, so the road's underside broke into floating blocks.
  //
  // Measured from the ground under the road's OWN CENTRELINE, not from the
  // lowest ground across its width. `elevMin` reaches a half-width out to each
  // side and takes the minimum, which on a side slope is just half-width times
  // the cross-fall — so a shelf road CUT INTO a hillside read as a road flying
  // over one, and got a concrete deck and piers for it. Chapman's Peak was
  // rendering 12% of its length as viaduct and 6% on piers with not one real
  // viaduct on it. A bridge is a road with air under its middle; a bank is a
  // road with a hill on one side, and telling them apart is what the
  // centreline does and the minimum cannot. `elevMin` still sizes the apron
  // faces, which is the side-slope job it was added for.
  const daylight = apronOn
    ? dense.map((_, i) => (flat ? prof[i] : elev[i]) + lift - elev[i])
    : [];
  // WHERE THE RAIL GOES, decided for the whole way before any of it is drawn.
  // Emitting per quad left holes: one 12m step whose drop dipped under the
  // threshold — the inside of a bend, a bench in the slope — opened a gap you
  // could drive straight out through at speed. Measured: the truck left the
  // road through one and fell 34.5m with the barrier still reading "solid",
  // because it never touched it. So the drop is sampled per index, then
  // DILATED by two steps each way: a short gap closes, and the rail runs a
  // little past the danger, which is what a real one does.
  const railOn: boolean[][] = [[], []];
  if (apronOn) {
    const raw: boolean[][] = [[], []];
    for (let i = 0; i < n; i++) {
      const [ax2, az2] = dense[Math.max(0, i - 1)], [bx2, bz2] = dense[Math.min(n - 1, i + 1)];
      const tx = bx2 - ax2, tz = bz2 - az2, tl = Math.hypot(tx, tz) || 1;
      const px = (-tz / tl) * (width / 2), pz = (tx / tl) * (width / 2);
      const ky = (flat ? prof[i] : sampleHeight(dense[i][0], dense[i][1])) + lift;
      for (let sd = 0; sd < 2; sd++) {
        const sgn = sd === 0 ? 1 : -1;
        const ex = dense[i][0] + px * sgn, ez = dense[i][1] + pz * sgn;
        const g = Math.min(sampleHeight(ex, ez), sampleHeight(ex + px * sgn, ez + pz * sgn));
        raw[sd][i] = width > RAIL_MIN_W && ky - g > RAIL_AT;
      }
    }
    for (let sd = 0; sd < 2; sd++) {
      for (let i = 0; i < n; i++) {
        let on = false;
        for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) on = on || raw[sd][j];
        railOn[sd][i] = on;
      }
    }
  }
  // A TAGGED bridge is a deck whatever the heightfield thinks. Someone stood
  // there and wrote `bridge=yes`, and that beats a z14 DEM which cannot resolve
  // the gully it spans — Chapman's Peak's one real bridge measures barely any
  // daylight and would otherwise be drawn as a bank across a dip.
  const deckRun = daylight.map((_, i) => {
    if (mode === 'bridge') return true;
    let s = 0, c = 0;
    for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) { s += daylight[j]; c++; }
    return s / c > DECK_GAP;
  });
  // A viaduct's beam gets deeper as it gets longer — a 1.35m lip under a
  // thirty-metre span reads as paper. Depth follows the daylight it crosses.
  const deckDepth = (gap: number): number => clamp(1.15 + gap * 0.085, 1.15, 3.6);
  const face = (
    xA: number, yA: number, zA: number, xB: number, yB: number, zB: number,
    bA: number, bB: number, u0: number, u1: number, deck: boolean,
  ): void => {
    const V = deck ? apron.dckV : apron.cutV, U = deck ? apron.dckUV : apron.cutUV;
    const d0 = (yA - bA) / 4, d1 = (yB - bB) / 4;
    V.push(xA, yA, zA, xB, yB, zB, xA, bA, zA, xB, yB, zB, xB, bB, zB, xA, bA, zA);
    U.push(u0, 0, u1, 0, u0, d0, u1, 0, u1, d1, u0, d0);
  };
  // Any quad, in world space, into a chosen accumulator. The soffit needs a
  // horizontal face and `face` only makes vertical ones.
  const quad = (V: number[], U: number[], p: number[], uv: number[]): void => {
    V.push(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8],
      p[3], p[4], p[5], p[9], p[10], p[11], p[6], p[7], p[8]);
    U.push(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[2], uv[3], uv[6], uv[7], uv[4], uv[5]);
  };
  // A pier: four splayed faces from the soffit down into whatever is below,
  // which for the bridge in the screenshot is the bed of a lake. Wider across
  // the carriageway than along it, so it reads as holding the road up rather
  // than as a post someone left there.
  const pier = (cx: number, cz: number, ax: number, az: number, top: number, bot: number, halfW: number): void => {
    const tl = Math.hypot(ax, az) || 1;
    const ux = ax / tl, uz = az / tl;              // along the road
    const vx = -uz, vz = ux;                       // across it
    const corner = (s: number, k: number): [number, number] => [
      cx + vx * halfW * s + ux * 1.05 * k, cz + vz * halfW * s + uz * 1.05 * k,
    ];
    spanStats.piers++;
    const SPLAY = 1.22;                            // the base is broader than the neck
    const cs: Array<[number, number]> = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [s0, k0] = cs[i], [s1, k1] = cs[(i + 1) % 4];
      const [tx0, tz0] = corner(s0, k0), [tx1, tz1] = corner(s1, k1);
      const [bx0, bz0] = corner(s0 * SPLAY, k0 * SPLAY), [bx1, bz1] = corner(s1 * SPLAY, k1 * SPLAY);
      const h = (top - bot) / 4;
      quad(apron.dckV, apron.dckUV,
        [tx0, top, tz0, tx1, top, tz1, bx0, bot, bz0, bx1, bot, bz1],
        [0, 0, 1, 0, 0, h, 1, h]);
    }
  };
  // The parapet, standing on the deck's own overhang — and SOLID. A barrier you
  // can see and drive straight through is worse than no barrier: it tells you
  // the edge is protected and then isn't. It goes in the wall grid, where the
  // car's push-out already lives; `ya` carries its top, and `wallHitAlong`
  // skips any wall the camera is above, so a 1m rail never occludes a chase cam
  // sitting four metres over the truck.
  const rail = (
    xA: number, yA: number, zA: number, xB: number, yB: number, zB: number, u0: number, u1: number,
  ): void => {
    spanStats.railM += Math.hypot(xB - xA, zB - zA);
    quad(apron.rlV, apron.rlUV,
      [xA, yA + RAIL_H, zA, xB, yB + RAIL_H, zB, xA, yA - 0.15, zA, xB, yB - 0.15, zB],
      [u0, 0, u1, 0, u0, 1, u1, 1]);
    const top = Math.max(yA, yB) + RAIL_H;
    addSeg(wallGrid, { ax: xA, az: zA, bx: xB, bz: zB, hw: 0, ya: top, yb: top, sl: true });
  };
  /**
   * A hazard board on a post, facing back down the road at whoever is coming.
   * `side` is which kerb it stands on; `kind` picks a panel from the atlas.
   * The panel is turned a few degrees INTO the traffic — a real one is, so the
   * retroreflection reaches the driver rather than the sky.
   */
  const sign = (
    px: number, py: number, pz: number, fwdX: number, fwdZ: number, side: number, kind: number,
    scale = 1, wide = 1,
  ): void => {
    const l = Math.hypot(fwdX, fwdZ) || 1;
    const fx = fwdX / l, fz = fwdZ / l;
    // Facing back along the way, canted 12° toward the carriageway.
    const a = Math.atan2(-fx, -fz) + side * 0.21;
    const rx = Math.cos(a), rz = -Math.sin(a);      // the panel's own width axis
    // A 1.64m board at scale 1, low enough to sit in the beam. Scale drives the
    // width and the panel's own height while leaving the FOOT on the ground:
    // a delineator is a short post, a direction board a wide one, and both
    // still stand in the dirt rather than floating at hazard-board height.
    // Width is separate from height because the atlas cell is one aspect and
    // roadside furniture is not: a delineator is a narrow post, a direction
    // board a wide plate, and both are the same texture.
    const HW = 0.82 * scale * wide, TOP = 0.86 + 1.14 * scale, BOT = 0.86;
    const u0 = kind / SIGN_KINDS, u1 = (kind + 1) / SIGN_KINDS;
    // Face (upper half of the atlas) and back (lower half) as one double-sided
    // quad each, offset a few centimetres so they never z-fight.
    for (const [n, v0, v1] of [[1, 0, 0.5], [-1, 0.5, 1]] as Array<[number, number, number]>) {
      const ox = -rz * 0.03 * n, oz = rx * 0.03 * n;
      quad(apron.sgV, apron.sgUV, [
        px - rx * HW + ox, py + TOP, pz - rz * HW + oz,
        px + rx * HW + ox, py + TOP, pz + rz * HW + oz,
        px - rx * HW + ox, py + BOT, pz - rz * HW + oz,
        px + rx * HW + ox, py + BOT, pz + rz * HW + oz,
      ], [u0, v0, u1, v0, u0, v1, u1, v1]);
    }
    // The post. Same atlas, sampled from a blank corner of the backplate, so it
    // reads as galvanised steel without needing a second material.
    const PW = 0.055;
    for (const [ax2, az2] of [[rx, rz], [-rz, rx]] as Array<[number, number]>) {
      quad(apron.sgV, apron.sgUV, [
        px - ax2 * PW, py + TOP, pz - az2 * PW,
        px + ax2 * PW, py + TOP, pz + az2 * PW,
        px - ax2 * PW, py - 0.3, pz - az2 * PW,
        px + ax2 * PW, py - 0.3, pz + az2 * PW,
      ], [u0 + 0.005, 0.97, u0 + 0.02, 0.97, u0 + 0.005, 0.99, u0 + 0.02, 0.99]);
    }
    spanStats.signs++;
    if (spanStats.signAt.length < 400) spanStats.signAt.push({ x: px, z: pz, fx, fz, kind });
  };
  let along = 0; // metres travelled — v wraps every 20m (the roadTex period)
  let pierRun = PIER_SPAN;  // so the first bay of a span gets one
  for (let i = 0; i < n - 1; i++) {
    const [x0, z0] = dense[i], [x1, z1] = dense[i + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * width / 2, nz = (dx / len) * width / 2;
    const y00 = (flat ? prof[i] : sampleHeight(x0 + nx, z0 + nz)) + lift;
    const y01 = (flat ? prof[i] : sampleHeight(x0 - nx, z0 - nz)) + lift;
    const y10 = (flat ? prof[i + 1] : sampleHeight(x1 + nx, z1 + nz)) + lift;
    const y11 = (flat ? prof[i + 1] : sampleHeight(x1 - nx, z1 - nz)) + lift;
    const v0 = along / 20, v1 = (along + len) / 20;
    verts.push(
      x0 + nx, y00, z0 + nz, x1 + nx, y10, z1 + nz, x0 - nx, y01, z0 - nz,
      x1 + nx, y10, z1 + nz, x1 - nx, y11, z1 - nz, x0 - nx, y01, z0 - nz,
    );
    uvs.push(0, v0, 0, v1, 1, v0, 0, v1, 1, v1, 1, v0);
    if (drivable) {
      const s: Seg = { ax: x0, az: z0, bx: x1, bz: z1, hw: width / 2, ya: prof[i], yb: prof[i + 1], tk: track, nm: name, sq };
      addSeg(roadGrid, s);
      segsOf.push(s);
    }
    if (apronOn) {
      // Sample a whisker OUTBOARD of the kerb as well: on a side-slope the
      // ground falls away past the edge, and a face that stopped at the kerb's
      // own height left a sliver of daylight along the downhill side.
      const ox = (-dz / len) * 2.2, oz = (dx / len) * 2.2;
      const uA = along / 8, uB = (along + len) / 8;
      const deck = deckRun[i] || deckRun[i + 1];
      const dd = deckDepth(Math.max(daylight[i], daylight[i + 1]));
      const bot: number[] = [];
      const drop: number[] = [];
      for (const sgn of [1, -1]) {
        const ex0 = x0 + nx * sgn, ez0 = z0 + nz * sgn;
        const ex1 = x1 + nx * sgn, ez1 = z1 + nz * sgn;
        const ey0 = sgn > 0 ? y00 : y01, ey1 = sgn > 0 ? y10 : y11;
        const g0 = Math.min(sampleHeight(ex0, ez0), sampleHeight(ex0 + ox * sgn, ez0 + oz * sgn));
        const g1 = Math.min(sampleHeight(ex1, ez1), sampleHeight(ex1 + ox * sgn, ez1 + oz * sgn));
        const b0 = deck ? ey0 - dd : Math.max(Math.min(ey0, g0) - APRON, ey0 - APRON_MAX);
        const b1 = deck ? ey1 - dd : Math.max(Math.min(ey1, g1) - APRON, ey1 - APRON_MAX);
        face(ex0, ey0, ez0, ex1, ey1, ez1, b0, b1, uA, uB, deck);
        bot.push(b0, b1);
        drop.push(Math.max(ey0 - g0, ey1 - g1));
        // A parapet wherever the ground falls away past the kerb — the seaward
        // side of a shelf road as much as a bridge. It is the only thing that
        // tells you, at a glance, that the edge is an edge.
        // From the dilated map above, not from this quad's own drop.
        const sd = sgn > 0 ? 0 : 1;
        if (railOn[sd][i] || railOn[sd][i + 1]) {
          // Right on the kerb line, not outboard of it: set any further out and
          // the parapet hangs in the air beside its own fascia.
          const rx0 = ex0 + ox * sgn * 0.04, rz0 = ez0 + oz * sgn * 0.04;
          const rx1 = ex1 + ox * sgn * 0.04, rz1 = ez1 + oz * sgn * 0.04;
          // Open at junctions. This deliberately reintroduces the kind of gap
          // the dilated rail map exists to prevent — but a gap where a road
          // leaves is a turning, not a hole over a drop.
          if (!railCrossesRoad(rx0, rz0, rx1, rz1)) {
            rail(rx0, ey0, rz0, rx1, ey1, rz1, along / 2.5, (along + len) / 2.5);
          }
        }
      }
      // ── roadside furniture ──
      // WHAT the sign is now follows from what the road is doing, rather than
      // every post being a hazard board. A chevron means the road turns here
      // and there is somewhere to fall; a triangle means it turns; a marker
      // post means nothing at all, which is what most roadside furniture
      // means, and is why it can be common without becoming noise.
      {
        const turn = i + 1 < n - 1 ? bendAt(i + 1) : 0;
        const sharp = turn > (BEND_DEG * Math.PI) / 180;
        const fall = Math.max(drop[0], drop[1]) > SIGN_DROP;
        // Chevrons still march through a bend with a drop — that is the case
        // they were added for and it is the one worth keeping dense.
        const gap = sharp && fall ? 18 : sharp ? 60 : SIGN_EVERY * (0.55 + signRng() * 0.9);
        signRun += len;
        if (signRun > gap) {
          signRun = 0;
          // Outside of the bend = the side the road is turning AWAY from. On a
          // straight, whichever side has the drop, else a coin.
          const outward = sharp
            ? -Math.sign(bendSign(i + 1)) || 1
            : (drop[0] > drop[1] ? 1 : drop[1] > drop[0] ? -1 : signRng() < 0.5 ? 1 : -1);
          const sx = x1 + nx * outward * 1.34, sz = z1 + nz * outward * 1.34;
          const sy = (outward > 0 ? y10 : y11) - 0.1;
          // Never plant one where the ground has fallen away — a post needs
          // something to stand in, and a sign hanging over a cliff reads as a bug.
          if (sy - sampleHeight(sx, sz) < 2.2) {
            let kind: number, scale: number, wide: number;
            if (sharp && fall) { kind = 0; scale = 1; wide = 1; }
            else if (sharp) { kind = 1; scale = 0.86; wide = 1; }
            else if (fall) { kind = 2; scale = 0.9; wide = 1; }
            else if (junctionNear(sx, sz)) { kind = 3; scale = 1.2; wide = 1.4; }
            else { kind = 4; scale = 0.55; wide = 0.42; }
            // A little size jitter on top, so a run of posts is not a stencil.
            sign(sx, sy, sz, dx, dz, outward, kind, scale * (0.88 + signRng() * 0.24), wide);
          }
        }
      }
      if (deck) {
        spanStats.deckM += len;
        if (daylight[i] > spanStats.maxDaylight) { spanStats.maxDaylight = daylight[i]; spanStats.at = [x0, z0]; }
        // Close the beam underneath. A pair of fascias with nothing between
        // them is a curtain, and from below — which is exactly where you see a
        // viaduct from — it read as a black void with no bottom.
        quad(apron.dckV, apron.dckUV,
          [x0 + nx, bot[0], z0 + nz, x1 + nx, bot[1], z1 + nz,
            x0 - nx, bot[2], z0 - nz, x1 - nx, bot[3], z1 - nz],
          [0, uA, 0, uB, width / 4, uA, width / 4, uB]);
        // And hold it up. Otherwise the road is simply hanging there, which is
        // what a thirty-metre span over a lake looked like.
        pierRun += len;
        if (daylight[i] > PIER_AT && pierRun >= PIER_SPAN) {
          pierRun = 0;
          pier(x0, z0, dx, dz, (bot[0] + bot[2]) / 2 + 0.05,
            Math.min(elevMin[i], sampleHeight(x0, z0)) - 1.2, width * 0.32);
        }
      }
      // Close the ends, so a way that stops at a junction shows a cut face
      // rather than a hollow shell you can see straight into.
      for (const [i0, at] of [[0, i === 0], [1, i === n - 2]] as Array<[number, boolean]>) {
        if (!at) continue;
        const px = i0 ? x1 : x0, pz = i0 ? z1 : z0;
        const yL = i0 ? y10 : y00, yR = i0 ? y11 : y01;
        const gL = sampleHeight(px + nx, pz + nz), gR = sampleHeight(px - nx, pz - nz);
        const bL = deck ? yL - dd : Math.max(Math.min(yL, gL) - APRON, yL - APRON_MAX);
        const bR = deck ? yR - dd : Math.max(Math.min(yR, gR) - APRON, yR - APRON_MAX);
        face(px + nx, yL, pz + nz, px - nx, yR, pz - nz, bL, bR, 0, width / 8, deck);
      }
    }
    along += len;
    // Tracks read as a fainter line on the chart — they are a route, not a road.
    mapSeg(x0, z0, x1, z1, drivable && !track ? Math.max(width, 14) : 9,
      track ? 'rgba(150,140,112,0.62)' : drivable ? '#a8a294' : 'rgba(150,142,120,0.4)');
  }
  if (!verts.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.computeVertexNormals();
  worldGroup.add(new THREE.Mesh(geo, mat));
  // The corridor cut is applied by the terrain builder, which may already have
  // run for this ground — so tell it to run again.
  if (drivable) dirtyTerrainAround(dense);
  // A drivable road below sea level is proof the land here is dry — the
  // evidence that keeps the sea plane out of Badwater and a polder alike.
  // Tunnels excluded: an undersea tunnel is under a sea that is really there.
  if (drivable && mode !== 'tunnel') {
    for (let i = 0; i < dense.length; i += 10) noteDryLand(dense[i][0], dense[i][1], prof[i]);
  }
  if (mode !== 'bridge') for (const [a, b] of runs) {
    // Tube only where the road is genuinely BURIED — where the terrain covers
    // the profile. An unburied stretch (coarse heightfield, shallow cut) stays
    // an open road; the tube would otherwise stand exposed like a dark box.
    let s = -1;
    for (let i = a; i <= b; i++) {
      // FULLY buried: there must be enough ground overhead to contain the
      // whole tube. The old 1.2m threshold let a 5m shell stand almost four
      // metres proud of flat ground — the black arch hanging over the road.
      const buried = elevMin[i] - prof[i] > TUNNEL_H + 0.6;
      if (buried && s < 0) s = i;
      if ((!buried || i === b) && s >= 0) {
        const e = buried ? i : i - 1;
        if (e - s >= 2) {
          tunnelTube(dense, prof, elevMin, s, e, width, lift);
          // These segments live UNDER the hill on purpose. Exempt them from the
          // corridor cut, which would otherwise open every tunnel into a trench.
          for (let k = s; k < e && k < segsOf.length; k++) segsOf[k].tn = true;
        }
        s = -1;
      }
    }
  }
}
// The carved space: side walls + ceiling along a tunnel run, portal lintels at
// the mouths, and solid collision so the car can't drive out through the rock.
function tunnelTube(dense: Array<[number, number]>, prof: number[], elev: number[], a: number, b: number, width: number, lift: number): void {
  // Belt and braces: the ceiling can never poke out through the hillside.
  const ceil = (i: number): number => Math.min(prof[i] + lift + TUNNEL_H, elev[i] - 0.4);
  const tv: number[] = [];
  const quadPush = (...p: number[]): void => {
    tv.push(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[3], p[4], p[5], p[9], p[10], p[11], p[6], p[7], p[8]);
  };
  for (let i = a; i < b; i++) {
    const [x0, z0] = dense[i], [x1, z1] = dense[i + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * (width / 2 + 0.6), nz = (dx / len) * (width / 2 + 0.6);
    const yA = prof[i] + lift, yB = prof[i + 1] + lift;
    const cA = ceil(i), cB = ceil(i + 1);
    quadPush(x0 + nx, yA, z0 + nz, x1 + nx, yB, z1 + nz, x0 + nx, cA, z0 + nz, x1 + nx, cB, z1 + nz);
    quadPush(x0 - nx, yA, z0 - nz, x1 - nx, yB, z1 - nz, x0 - nx, cA, z0 - nz, x1 - nx, cB, z1 - nz);
    quadPush(x0 + nx, cA, z0 + nz, x1 + nx, cB, z1 + nz, x0 - nx, cA, z0 - nz, x1 - nx, cB, z1 - nz);
    const top = Math.max(cA, cB);
    addSeg(wallGrid, { ax: x0 + nx, az: z0 + nz, bx: x1 + nx, bz: z1 + nz, hw: 0, ya: top, yb: top });
    addSeg(wallGrid, { ax: x0 - nx, az: z0 - nz, bx: x1 - nx, bz: z1 - nz, hw: 0, ya: top, yb: top });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tv), 3));
  geo.computeVertexNormals();
  const tube = new THREE.Mesh(geo, MAT.tunnel);
  tube.userData.tunnel = true; // so a probe can check none of it breaches the surface
  worldGroup.add(tube);
  for (const end of [a, b]) {
    const i0 = end === a ? a : b - 1, i1 = end === a ? a + 1 : b;
    const [x0, z0] = dense[i0], [x1, z1] = dense[i1];
    const ang = Math.atan2(z1 - z0, x1 - x0);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(width + 3, 1.6, 1.2), MAT.portal);
    const [px, pz] = dense[end];
    lintel.position.set(px, ceil(end) + 0.3, pz);
    lintel.rotation.y = ang + Math.PI / 2; // across the road, not along it
    worldGroup.add(lintel);
  }
}
// Everything a solid footprint owes the rest of the world: wall segments for
// collision and camera occlusion, the polygon itself for containment, and an
// immediate eviction if it just landed on the car.
function claimSolid(pts: Array<[number, number]>, top: number): void {
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    // ya carries the ROOF height so the chase camera knows whether a wall
    // actually occludes it or it is looking clean over the top.
    addSeg(wallGrid, { ax, az, bx, bz, hw: 0, ya: top, yb: top });
  }
  addPlot(pts);
  // This building may have just materialised around the car — vectors stream in
  // long after the spawn, and the spawn point is chosen before any of them
  // exist. Evict immediately rather than waiting for the driver to notice they
  // are sealed in.
  if (pointInPoly(state.x, state.z, pts)) evictFromBuildings();
}
// ── a building, not a block ────────────────────────────────────────
// Which way a given footprint goes is decided by its OSM id, so a street looks
// the same on every reload and across every session. Roughly two in five of
// the low-rise stock is an open shell: walls chewed down to varying heights,
// whole bays collapsed, no roof, and something growing in the middle of it.
// Towers stay intact — a twenty-storey open shell reads as a modelling bug.
const buildStats = { intact: 0, ruin: 0, ruins: [] as Array<[number, number]> };
function building(pts: Array<[number, number]>, id: number, levels: number): void {
  const height = clamp(levels * 3.1, 3, 90);
  const r = mulberry32((id * 2654435761) >>> 0);
  r(); // first draw off a hashed seed is poorly distributed
  if (height > 24 || r() > 0.42) {
    buildStats.intact++;
    polygon(pts, B_MATS[id % B_MATS.length], 0.9, height, 'solid');
    return;
  }
  let minH = Infinity, cx = 0, cz = 0;
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (const [x, z] of pts) {
    minH = Math.min(minH, sampleHeight(x, z));
    cx += x; cz += z;
    minx = Math.min(minx, x); maxx = Math.max(maxx, x);
    minz = Math.min(minz, z); maxz = Math.max(maxz, z);
  }
  cx /= pts.length; cz /= pts.length;
  const foot = minH - 0.6;                       // bury the base on the uphill side
  const standing = Math.max(2.4, height * (0.5 + r() * 0.35));
  const parts: THREE.BufferGeometry[] = [];
  let tallest = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.6) continue;
    const ang = Math.atan2(bx - ax, bz - az);    // local +z runs along the edge
    const bays = Math.max(1, Math.round(len / 2.6));
    for (let s = 0; s < bays; s++) {
      if (r() < 0.12) continue;                  // a bay that came down entirely
      const t = (s + 0.5) / bays;
      // The chewed top: each bay keeps its own share of the wall, so the
      // skyline of a ruin is ragged instead of a clean horizontal cut.
      const top = standing * (0.42 + r() * 0.62);
      tallest = Math.max(tallest, top);
      const w = 0.55 + r() * 0.12;
      const shade = 0.5 + r() * 0.34;            // each bay weathers differently
      // y is relative to `foot`; the mesh is then placed AT foot, so the façade
      // shader can read the building's base off the model matrix like it does
      // for an extruded one. Built in absolute world y with the mesh at the
      // origin, every ruin would have keyed its floors and doorways to sea
      // level instead of to its own ground line.
      parts.push(boxPart(
        w, top, (len / bays) * 1.04,
        ax + (bx - ax) * t, top / 2, az + (bz - az) * t,
        new THREE.Color(0x9a8f7c).multiplyScalar(shade).getHex(), 0, ang,
      ));
    }
  }
  if (!parts.length) { buildStats.intact++; polygon(pts, B_MATS[id % B_MATS.length], 0.9, height, 'solid'); return; }
  buildStats.ruin++;
  if (buildStats.ruins.length < 400) buildStats.ruins.push([cx, cz]);
  // Rubble where the roof landed, and scrub that moved in after it. The normal
  // vegetation pass refuses to plant within 5m of a wall, which is exactly
  // where a reclaimed ruin needs plants — so a ruin grows its own.
  for (let i = 0; i < 14; i++) {
    const a = r() * Math.PI * 2, rad = Math.sqrt(r());
    const px = cx + Math.cos(a) * rad * (maxx - minx) * 0.42;
    const pz = cz + Math.sin(a) * rad * (maxz - minz) * 0.42;
    if (!pointInPoly(px, pz, pts)) continue;
    const gy = sampleHeight(px, pz) - foot;      // same local frame as the walls
    if (r() < 0.45) {
      const s = 0.5 + r() * 1.3;                 // slab of fallen roof
      parts.push(boxPart(s, 0.3 + r() * 0.4, s * (0.6 + r()), px, gy + 0.2, pz,
        new THREE.Color(0x8e8474).multiplyScalar(0.45 + r() * 0.3).getHex(), 0, r() * 3));
    } else {
      const s = 0.9 + r() * 1.8, h = 1.1 + r() * 2.6;
      parts.push(boxPart(s, h, s, px, gy + h / 2, pz,
        new THREE.Color().setHSL(biome.vegHue[0] + r() * biome.vegHue[1], 0.34 + r() * 0.2, 0.15 + r() * 0.1).getHex(), 0, r() * 3));
    }
  }
  const shell = new THREE.Mesh(mergeParts(parts), ruinMat);
  shell.position.y = foot;                       // the base the façade shader reads
  worldGroup.add(shell);
  mapPoly(pts, 'rgba(70,66,58,0.9)');
  claimSolid(pts, foot + tallest);
}
function polygon(pts: Array<[number, number]>, mat: THREE.Material | THREE.Material[], lift: number, extrude = 0, collide?: 'solid' | 'water'): void {
  if (pts.length < 3) return;
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length; cz /= pts.length;
  const geo = extrude > 0
    ? new THREE.ExtrudeGeometry(shape, { depth: extrude, bevelEnabled: false })
    : new THREE.ShapeGeometry(shape);
  geo.rotateX(Math.PI / 2); // shape XY → world XZ (y down after rotate; extrude goes up via scale)
  if (extrude > 0) geo.scale(1, -1, 1);
  const mesh = new THREE.Mesh(geo, mat);
  if (extrude > 0) {
    // A building sits on its footprint's LOWEST corner so it never floats on a
    // slope (the roof stays level; the downhill wall just gets taller).
    let minH = Infinity;
    for (const [x, z] of pts) minH = Math.min(minH, sampleHeight(x, z));
    mesh.position.y = minH + lift;
  } else {
    // Flat drapes CONFORM to the terrain per-vertex — a centroid-height plane
    // floated above (or sank under) any park/lake bigger than the local slope,
    // swallowing the car and its halo (Central Park made this vivid).
    const posA = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < posA.count; i++) posA.setY(i, groundAt(posA.getX(i), posA.getZ(i)) + lift);
    geo.computeVertexNormals();
    mesh.position.y = 0;
  }
  worldGroup.add(mesh);
  mapPoly(pts, collide === 'solid' ? 'rgba(70,66,58,0.9)' : collide === 'water' ? '#1d3a55' : 'rgba(34,54,32,0.9)');
  if (collide === 'solid') {
    claimSolid(pts, (mesh.position.y || 0) + extrude);
  } else if (collide === 'water') {
    let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
    for (const [x, z] of pts) { minx = Math.min(minx, x); minz = Math.min(minz, z); maxx = Math.max(maxx, x); maxz = Math.max(maxz, z); }
    for (let gx = Math.floor(minx / GRID); gx <= Math.floor(maxx / GRID); gx++)
      for (let gz = Math.floor(minz / GRID); gz <= Math.floor(maxz / GRID); gz++)
        if (pointInPoly(gx * GRID + GRID / 2, gz * GRID + GRID / 2, pts)) waterCells.add(`${gx},${gz}`);
  }
}
// ── OSM tile cache (IndexedDB, LRU by timestamp) ───────────────────
// Overpass is a shared public instance with moods; a tile you have seen once
// should never depend on it again. localStorage was the wrong pot: this cell
// shares the parc.land origin's ~5MB quota with every other cell, and one
// dense urban tile (buildings with full geometry) is hundreds of KB — every
// write quota-failed silently and a reload refetched the whole ring.
// IndexedDB gets an origin quota in the hundreds of MB.
interface OsmWay {
  id: number; tags?: Record<string, string>; geometry: Array<{ lat: number; lon: number }>;
  /** Dedupe key. A way clipped across several vector tiles arrives once per
   *  tile under the SAME id, so the id alone would render the first piece and
   *  silently drop the rest. */
  ck?: string;
}
// Only the tags renderWays actually reads — the rest is dead weight per way.
// amenity/shop feed repair POIs; surface/smoothness/tracktype feed wayQuality.
// The S3 tiles keep EVERY tag — this list is only the client cache's diet.
const KEEP_TAGS = ['highway', 'building', 'building:levels', 'natural', 'waterway', 'landuse', 'leisure', 'tunnel', 'bridge', 'layer', 'name', 'amenity', 'shop', 'surface', 'smoothness', 'tracktype'];
let osmDb: IDBDatabase | null = null;
const osmDbReady: Promise<void> = new Promise((resolve) => {
  try {
    const req = indexedDB.open('drive-cache', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('osm').createIndex('ts', 'ts'); };
    req.onsuccess = () => { osmDb = req.result; resolve(); };
    req.onerror = () => resolve();
  } catch { resolve(); }
});
// Free the shared origin quota from the failed localStorage era.
try { for (const k of Object.keys(localStorage)) if (k.startsWith('drive.osm.')) localStorage.removeItem(k); } catch { /* fine */ }
const osmCacheKey = (x: number, y: number): string => `5/${OSM_Z}/${x}/${y}`; // v5: nodes, rivers, rails
async function readTileCache(x: number, y: number): Promise<OsmWay[] | null> {
  await osmDbReady;
  if (!osmDb) return null;
  return new Promise((resolve) => {
    try {
      const rq = osmDb!.transaction('osm', 'readonly').objectStore('osm').get(osmCacheKey(x, y));
      rq.onsuccess = () => resolve((rq.result as { ways?: OsmWay[] } | undefined)?.ways ?? null);
      rq.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
let osmWritesSincePrune = 0;
function writeTileCache(x: number, y: number, els: OsmWay[]): void {
  if (!osmDb) return;
  const ways = els.map((e) => {
    let tags: Record<string, string> | undefined;
    for (const t of KEEP_TAGS) { const v = e.tags?.[t]; if (v !== undefined) (tags ??= {})[t] = v; }
    return { id: e.id, tags, geometry: e.geometry };
  });
  try {
    osmDb.transaction('osm', 'readwrite').objectStore('osm').put({ ts: Date.now(), ways }, osmCacheKey(x, y));
    if (++osmWritesSincePrune >= 25) { osmWritesSincePrune = 0; pruneTileCache(); }
  } catch { /* cache is best-effort */ }
}
function pruneTileCache(): void {
  // Keep the newest ~600 tiles (a few days of wandering); drop oldest-first.
  try {
    const store = osmDb!.transaction('osm', 'readwrite').objectStore('osm');
    const count = store.count();
    count.onsuccess = () => {
      let extra = count.result - 600;
      if (extra <= 0) return;
      const cur = store.index('ts').openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || extra-- <= 0) return;
        c.delete();
        c.continue();
      };
    };
  } catch { /* cache is best-effort */ }
}

// ── points of interest (named features become HUD waypoints) ───────
interface Poi { name: string; x: number; z: number; kind: 'park' | 'water' | 'place' | 'mission' | 'repair'; pinned?: boolean }
const pois = new Map<string, Poi>();
function notePoi(tags: Record<string, string>, pts: Array<[number, number]>): void {
  const name = tags.name;
  if (!name || pois.has(name) || pois.size >= 400) return;
  // A garage or a fuel stop is worth marking even before the game does
  // anything with it — and now the game does: they are where the rig heals.
  const fix = ['fuel', 'charging_station', 'car_wash'].includes(tags.amenity ?? '')
    || ['car_repair', 'car', 'car_parts', 'tyres'].includes(tags.shop ?? '');
  const kind: Poi['kind'] | null =
    fix ? 'repair'
    : tags.natural === 'water' || tags.waterway ? 'water'
    : tags.building ? 'place'
    : tags.leisure || tags.landuse ? 'park'
    : null; // named streets are not destinations
  if (!kind) return;
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  pois.set(name, { name, x: cx / pts.length, z: cz / pts.length, kind });
}

// Watercourse widths, by class. A stream you can straddle, a canal you cannot.
const WATER_W: Record<string, number> = { river: 14, canal: 9, stream: 4.5 };
/** Is this way an AREA we should fill and plant, or a line we should not?
 *  `natural=scrub|wetland|sand|bare_rock` are areas; `coastline` and `cliff`
 *  share the key and are lines, which is exactly the trap. */
const AREA_TAG = (t: Record<string, string>): boolean =>
  !!t.landuse || !!t.leisure
  || ['scrub', 'wetland', 'sand', 'bare_rock', 'wood', 'grassland', 'heath'].includes(t.natural ?? '');
function renderWays(els: OsmWay[]): void {
  for (const el of els) {
    // Clipped lines carry their own key; areas still dedupe on the bare id, so
    // a lake straddling two vector tiles is still drawn exactly once.
    const dk = el.ck ?? String(el.id);
    if (!el.geometry || seenWays.has(dk)) continue;
    // Marked BEFORE the build, and unmarked below if the build refused — a way
    // that could not be drawn for want of terrain has to stay eligible.
    seenWays.add(dk);
    const refusedAt = unbuilt;
    const pts: Array<[number, number]> = el.geometry.map((g) => toLocal(g.lat, g.lon));
    const tags = el.tags ?? {};
    notePoi(tags, pts);
    // A POINT is a place, not a shape. Fuel stations, garages, viewpoints and
    // summits arrive as single-node geometries; notePoi above has already put
    // them on the map, and there is nothing to extrude, drape or scatter.
    if (pts.length < 2) continue;
    if (tags.highway) {
      const w = ROAD_W[tags.highway] ?? 5;
      // THREE tiers, not two. A mountain path used to render as decoration you
      // could not feel underfoot — you crossed Chapman's Peak reading ROUGH the
      // whole way. Tracks now carry their own grip, and are drawn as ruts.
      const track = ['track', 'path', 'bridleway', 'cycleway', 'footway'].includes(tags.highway);
      const stairs = tags.highway === 'steps';   // nothing drives up steps
      // These MUST equal SURFACE[].lift — the ribbon is drawn at profile+lift
      // and the tyre sits at profile+lift, so a disagreement is a truck
      // hovering over its own road. Stack order: green .08 < water .12 <
      // track .18 < road .22.
      const mode: RoadMode = track || stairs ? 'none'
        : tags.tunnel && tags.tunnel !== 'no' ? 'tunnel'
        : tags.bridge && tags.bridge !== 'no' ? 'bridge'
        : 'auto';
      ribbon(pts, w, stairs ? MAT.minor : track ? MAT.track : MAT.road,
        track || stairs ? 0.18 : 0.22, !stairs, mode, track, tags.name, wayQuality(tags, track));
      if (unbuilt !== refusedAt) { seenWays.delete(dk); continue; }
      // Steps are named and drawn but nothing drives them, so they earn no
      // checkpoints — a road you cannot survey should not sit in the log.
      if (tags.name && !stairs) noteSurvey(tags.name, pts, track);
    } else if (WATER_W[tags.waterway ?? '']) {
      // A RIVER IS A LINE. Only `riverbank` polygons used to be fetched, and
      // almost every watercourse in OSM is a line with no polygon at all — so
      // anything short of a major river simply did not exist. Drawn as a draped
      // ribbon at the water lift, wide by class, and NOT drivable: it is water,
      // and the surface field already knows to slow you in it.
      ribbon(pts, WATER_W[tags.waterway as string], MAT.water, 0.12, false, 'none', false, tags.name);
    } else if (tags.railway) {
      // Rails read as a narrow dark line across the country and a thing you
      // bump over at a crossing. Not drivable — nobody drives a railway.
      ribbon(pts, 3.4, MAT.minor, 0.2, false, 'none', false, tags.name);
    } else if (tags.building) {
      building(pts, el.id, parseFloat(tags['building:levels'] ?? '') || 2);
    } else if (tags.natural === 'water' || tags.waterway === 'riverbank') {
      polygon(pts, MAT.water, 0.12, 0, 'water');
    } else if (AREA_TAG(tags)) {
      polygon(pts, MAT.green, 0.08);
      scatterVeg(pts, el.id, tags);
    }
    // Anything else — a coastline, a cliff edge, an unrecognised line — is
    // deliberately dropped rather than fed to the polygon path. The old `else`
    // caught everything, which was harmless while the query only returned
    // areas; with lines in the answer it would paint a river green.
  }
  flushAprons();
}

// ── survey: invisible checkpoints along named ways ─────────────────
// A named road is not a line. Measured against live OSM: it arrives as a
// median of 4 fragments here and 39 for one Paris avenue, and those
// fragments frequently refuse to chain end-to-end (longest chain covers
// only 32% of "Avenue de New York"). So checkpoints are laid down PER
// FRAGMENT by arc length and never by chaining — chaining bought 2 points
// of spacing quality and cost robustness everywhere it mattered.
//
// The dedup radius is not tidiness, it is the difference between a
// winnable mechanic and a broken one. A city street carries its
// carriageways, service road and pavement under one name; sampling all of
// them doubles the denominator while the player can only ever drive one,
// so a majority becomes unreachable. Collapsing same-road candidates
// within DEDUP lifted the worst-case single-traverse coverage from 38% to
// 50% across Trocadero.
const SURVEY_P = 250;          // metres between checkpoints along a fragment
const SURVEY_DEDUP = 100;      // same-road candidates closer than this collapse
const SURVEY_CAPTURE = 12;     // how near counts as collected
const SURVEY_MIN = 400;        // roads shorter than this are not worth claiming
const SURVEY_MAJORITY = 0.5;   // "a majority" — measured as reachable on 95%+ of roads
interface Checkpoint { x: number; z: number; key: string; got: boolean; at?: number }
interface SurveyRoad {
  name: string;
  cps: Checkpoint[];
  len: number;
  got: number;
  track: boolean;
  /** The vector tiles this road's geometry actually crosses. */
  tiles: Set<string>;
  /** Latched once claimed — a road never un-unlocks. */
  claimed: boolean;
  claimedAt: number;
}
const survey = new Map<string, SurveyRoad>();
/** Checkpoints already collected, keyed by position so the record survives a
 *  reload and a different spawn origin. */
const surveyGot = new Set<string>();
const surveyClaimed = new Set<string>();
/** OSM tiles whose ways have actually been rendered — NOT the same as the
 *  requested set, which is marked before the fetch even starts. */
const osmDone = new Set<string>();
const cpKey = (x: number, z: number): string => {
  const [lat, lon] = localToLatLon(x, z);
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;   // ~1m — a checkpoint's identity is its place
};
/** Lay checkpoints along one fragment of a named road. */
function noteSurvey(name: string, pts: Array<[number, number]>, track: boolean): void {
  let r = survey.get(name);
  if (!r) survey.set(name, (r = { name, cps: [], len: 0, got: 0, track,
    tiles: new Set(), claimed: false, claimedAt: 0 }));
  // Phase at P/2 so a fragment shorter than the pitch still earns one
  // checkpoint at its middle rather than nothing at all.
  let acc = SURVEY_P / 2;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    r.len += L;
    // Stamp the tiles the road itself crosses, sampling inside long segments so
    // a straight kilometre does not skip the tiles it passes through.
    for (let s = 0; s <= Math.ceil(L / 200); s++) {
      const t = s / Math.max(1, Math.ceil(L / 200));
      const [plat, plon] = localToLatLon(ax + (bx - ax) * t, az + (bz - az) * t);
      const [tx, ty] = tileAt(plat, plon, OSM_Z);
      r.tiles.add(`${tx}/${ty}`);
    }
    let s = 0;
    while (acc <= L - s + 1e-9) {
      s += acc;
      const t = s / L, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      acc = SURVEY_P;
      let dup = false;
      for (const c of r.cps) if (Math.hypot(c.x - x, c.z - z) < SURVEY_DEDUP) { dup = true; break; }
      if (dup) continue;
      const key = cpKey(x, z);
      const got = surveyGot.has(key);
      r.cps.push({ x, z, key, got });
      if (got) r.got++;
    }
    acc -= L - s;
  }
  if (surveyClaimed.has(name)) r.claimed = true;
}
/** Is the road's extent settled? The denominator grows while tiles stream —
 *  Ou Kaapse Weg reads 4352m from one ring of tiles and 10058m from two — so
 *  claiming before the survey closes would let you take a 10km pass by
 *  driving its first half-kilometre. A road is only claimable once every
 *  vector tile touching its bounding box has actually rendered. */
// Memoised against the number of rendered tiles: the answer can only change
// when a new tile lands, and the walk is ~270 set lookups for a long road that
// the HUD would otherwise repeat every frame for every road on screen.
// Both counts matter: a new tile can complete the ring, and a new fragment can
// extend the road into tiles nobody has asked for yet.
const surveyedCache = new Map<string, { done: number; tiles: number; v: boolean }>();
function surveyed(r: SurveyRoad): boolean {
  const c = surveyedCache.get(r.name);
  if (c && c.done === osmDone.size && c.tiles === r.tiles.size) return c.v;
  const v = surveyedRaw(r);
  surveyedCache.set(r.name, { done: osmDone.size, tiles: r.tiles.size, v });
  return v;
}
function surveyedRaw(r: SurveyRoad): boolean {
  if (!r.tiles.size) return false;
  // The tiles the road CROSSES, dilated by one — not the tiles of its bounding
  // box. A bounding box is the wrong shape for a road: Chapman's Peak coils
  // through 15km inside a 3km square, and demanding the box's corners would
  // ask the player to drive to places the road never goes, so a road driven
  // end to end sat at 9/9 collected and never became claimable. The dilation
  // is what answers the real question — does this road continue into a tile I
  // have not seen? — because a road can only extend past a loaded tile through
  // one of its neighbours.
  for (const k of r.tiles) {
    const [tx, ty] = k.split('/').map(Number);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      if (!osmDone.has(`${tx + dx}/${ty + dy}`)) return false;
  }
  return true;
}
const surveyEligible = (r: SurveyRoad): boolean => r.len >= SURVEY_MIN && r.cps.length >= 2;
/** The road under the wheels, its progress, and whether it can be claimed. */
function surveyHere(): { r: SurveyRoad; frac: number; ready: boolean } | null {
  const w = wayAt(state.x, state.z);
  if (!w) return null;
  const r = survey.get(w.name);
  if (!r || !surveyEligible(r)) return null;
  return { r, frac: r.got / r.cps.length, ready: surveyed(r) };
}
let surveyFlash = 0;          // capture ping, decays over a few frames
let surveyClaim: { name: string; at: number; n: number } | null = null;
let surveyLast: [number, number] | null = null;
function stepSurvey(now: number): void {
  // SWEPT, not sampled. Testing the car's position once a frame makes capture a
  // function of frame rate: at 180km/h on a 20fps phone you jump 2.5m a frame,
  // and on a browser throttled to 4fps you jump 12.5m — past a 12m checkpoint
  // without ever being inside it. Test the SEGMENT travelled since last frame
  // and the radius means the same thing at every frame rate.
  let prev = surveyLast;
  surveyLast = [state.x, state.z];
  // A respawn moves the car kilometres between two frames. Sweeping THAT would
  // draw a line across the map and collect every checkpoint it crossed, so any
  // jump too long to be driving is treated as no previous position at all.
  // 60m in a frame is 3.6km/h faster than the car can go at 60fps.
  if (prev && Math.hypot(state.x - prev[0], state.z - prev[1]) > 60) prev = null;
  const nearSwept = (cx: number, cz: number): number => {
    if (!prev) return Math.hypot(cx - state.x, cz - state.z);
    const dx = state.x - prev[0], dz = state.z - prev[1];
    const t = clamp(((cx - prev[0]) * dx + (cz - prev[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    return Math.hypot(cx - (prev[0] + dx * t), cz - (prev[1] + dz * t));
  };
  const w = wayAt(state.x, state.z);
  // Capture demands you actually be ON the named way. 15% of checkpoints sit
  // within 12m of a DIFFERENT named road (junctions, slip roads), so pure
  // proximity would credit the wrong street. Strict capture, lenient
  // completion: the majority threshold is where the tolerance lives.
  if (w && w.on) {
    const r = survey.get(w.name);
    if (r) {
      for (const c of r.cps) {
        if (c.got) continue;
        if (nearSwept(c.x, c.z) > SURVEY_CAPTURE) continue;
        c.got = true; c.at = now; r.got++;
        surveyGot.add(c.key);
        surveyFlash = 1;
        audio.stone();
        saveSurvey();
      }
      if (!r.claimed && surveyEligible(r) && r.got / r.cps.length > SURVEY_MAJORITY && surveyed(r)) {
        r.claimed = true; r.claimedAt = now;
        surveyClaimed.add(r.name);
        surveyClaim = { name: r.name, at: now, n: r.cps.length };
        audio.thud(2);
        saveSurvey();
      }
    }
  }
  if (surveyFlash > 0) surveyFlash = Math.max(0, surveyFlash - 0.04);
}
// Positions, not indices: a reload spawns a new origin and every local
// coordinate shifts, but a checkpoint's latitude does not.
const SURVEY_CAP = 20000;
function saveSurvey(): void {
  try {
    const got = [...surveyGot];
    localStorage.setItem('drive.survey.cp', JSON.stringify(got.slice(-SURVEY_CAP)));
    localStorage.setItem('drive.survey.done', JSON.stringify([...surveyClaimed]));
  } catch { /* a full quota costs progress, never the drive */ }
}
try {
  for (const k of JSON.parse(localStorage.getItem('drive.survey.cp') ?? '[]') as string[]) surveyGot.add(k);
  for (const k of JSON.parse(localStorage.getItem('drive.survey.done') ?? '[]') as string[]) surveyClaimed.add(k);
} catch { /* fine */ }

// NEVER render features onto terrain that hasn't arrived. Heights are
// sampled ONCE at build time; against the flat 0-fallback, a whole street
// ends up hanging in the sky when the real slope loads underneath it (and
// the OSM cache made this a near-certainty on reload — cached vectors beat
// the S3 elevation fetches every time). Gate each vector tile on the
// elevation tiles covering it, with a one-tile margin for spilling geometry.
/**
 * Cut a polyline down to the runs that lie inside a lat/lon box, adding the
 * exact crossing point wherever it leaves or re-enters.
 *
 * This is what makes the elevation gate above mean anything. Overpass `out
 * geom` returns a way's COMPLETE geometry, never clipped to the bbox that
 * asked for it — Badwater Road comes back as one way spanning 34km — so
 * "gate the tile on the terrain under it" was gating a 600m tile and then
 * building 34km of road, 72% of it over ground where sampleHeight has no
 * data and answers 0. Adjacent tiles produce pieces that meet exactly on the
 * shared boundary, so there is neither a gap nor doubled geometry.
 */
function clipToBounds(
  geom: Array<{ lat: number; lon: number }>,
  b: { latN: number; latS: number; lonW: number; lonE: number },
): Array<Array<{ lat: number; lon: number }>> {
  const inside = (p: { lat: number; lon: number }): boolean =>
    p.lat <= b.latN && p.lat >= b.latS && p.lon >= b.lonW && p.lon <= b.lonE;
  // Where the segment a→b crosses the box edge, as a fraction along it.
  const cross = (a: { lat: number; lon: number }, c: { lat: number; lon: number }): number => {
    let t = 1;
    const hit = (num: number, den: number): void => {
      if (Math.abs(den) < 1e-12) return;
      const q = num / den;
      if (q > 0 && q < t) {
        const lat = a.lat + (c.lat - a.lat) * q, lon = a.lon + (c.lon - a.lon) * q;
        // Only a crossing that lands ON the box counts; the other three edge
        // lines are hit somewhere out in space.
        if (lat <= b.latN + 1e-9 && lat >= b.latS - 1e-9 && lon >= b.lonW - 1e-9 && lon <= b.lonE + 1e-9) t = q;
      }
    };
    hit(b.latN - a.lat, c.lat - a.lat); hit(b.latS - a.lat, c.lat - a.lat);
    hit(b.lonW - a.lon, c.lon - a.lon); hit(b.lonE - a.lon, c.lon - a.lon);
    return t;
  };
  const runs: Array<Array<{ lat: number; lon: number }>> = [];
  let cur: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < geom.length; i++) {
    const p = geom[i], pin = inside(p);
    if (pin) {
      if (!cur.length && i > 0) {
        // Entering: walk back from p toward the outside point for the edge.
        const t = cross(p, geom[i - 1]);
        cur.push({ lat: p.lat + (geom[i - 1].lat - p.lat) * t, lon: p.lon + (geom[i - 1].lon - p.lon) * t });
      }
      cur.push(p);
      continue;
    }
    if (cur.length) {
      const a = geom[i - 1], t = cross(a, p);
      cur.push({ lat: a.lat + (p.lat - a.lat) * t, lon: a.lon + (p.lon - a.lon) * t });
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length > 1);
}
async function renderGated(x: number, y: number, ways: OsmWay[]): Promise<void> {
  const b = tileBounds(x, y, OSM_Z);
  const [txA, tyA] = tileAt(b.latN, b.lonW, TERRAIN_Z);
  const [txB, tyB] = tileAt(b.latS, b.lonE, TERRAIN_Z);
  const waits: Array<Promise<void>> = [];
  for (let tx = Math.min(txA, txB) - 1; tx <= Math.max(txA, txB) + 1; tx++)
    for (let ty = Math.min(tyA, tyB) - 1; ty <= Math.max(tyA, tyB) + 1; ty++)
      waits.push(loadTerrainTile(tx, ty));
  await Promise.all(waits);
  // Clip the LINES; leave the areas alone. A building or a lake is a closed
  // ring — cutting it with a polyline clipper would leave an open chain that
  // fills as a wedge — and they are small enough to sit inside the gate's
  // one-tile margin anyway.
  const out: OsmWay[] = [];
  const key = `${x}/${y}`;
  for (const el of ways) {
    if (!el.geometry) continue;
    if (!(el.tags ?? {}).highway) { out.push(el); continue; }
    const runs = clipToBounds(el.geometry, b);
    for (let i = 0; i < runs.length; i++) out.push({ ...el, geometry: runs[i], ck: `${el.id}@${key}#${i}` });
  }
  renderWays(out);
}

// "No roads yet" must read as LOADING, not a broken world.
const osmStatus = document.createElement('div'); // retained only as a no-op sink
osmStatus.textContent = '';
Object.assign(osmStatus.style, {
  position: 'fixed', left: '12px', top: 'calc(max(10px, env(safe-area-inset-top)) + 44px)', zIndex: '10',
  color: 'rgba(245,196,83,0.85)', font: '0.68rem ui-monospace, monospace',
  textShadow: '0 1px 4px rgba(0,0,0,0.8)', pointerEvents: 'none', display: 'none',
} as Partial<CSSStyleDeclaration>);
document.body.appendChild(osmStatus);
let osmPending = 0;
const osmNote = (d: number): void => { osmPending += d; streaming = osmPending > 0; };
// Overpass is a busy public service that 504s under load, and when it does the
// HUD used to sit on "STREAMING" forever with no way to tell a quiet corner of
// the map from an outage. Two failures in a row is an outage; any success
// clears it.
let osmFails = 0;
let osmDown = false;

// This cell's own path prefix. On the apex the page lives at `/@c15r/drive`;
// on the cell host it lives at `/` and a CloudFront Function prepends the same
// prefix. Deriving it from the pathname makes one relative fetch correct in
// both places, which a hard-coded string is not.
const CELL_BASE = (location.pathname.match(/^\/@[^/]+\/[^/]+/) ?? [''])[0];
let tileProxyOk = true;   // one clean failure retires it for the session

/**
 * The tile, from this cell's public namespace (ADR-0095). A hit is CloudFront
 * and S3 with no compute anywhere; a miss lands on the cell, which asks
 * Overpass once for everybody and writes the object. Returns null if the proxy
 * is unavailable, so the caller can fall back to hitting Overpass directly —
 * a bad deploy here degrades to the old behaviour rather than an empty world.
 */
// A SLOT IS THE SCARCE THING, not a tile. At 30s this waited out the cell's
// whole upstream budget and then spent the same slot asking Overpass directly
// as well — so one unlucky tile could occupy a sixth of the pipe for the better
// part of a minute. Measured after mirrors went in: six slots stuck at once and
// NOT ONE tile completed for 3.6km of driving. Nine seconds, then let go: the
// tile is re-queued by a later pass, and by then it is often warm because the
// cell filled it in the background anyway.
const TILE_WAIT_MS = 9000;
async function proxyTile(x: number, y: number): Promise<OsmWay[] | null> {
  if (!tileProxyOk) return null;
  const ctl = new AbortController();
  const bail = setTimeout(() => ctl.abort(), TILE_WAIT_MS);
  try {
    const res = await fetch(`${CELL_BASE}/~/osm/v2/${OSM_Z}/${x}/${y}`, { signal: ctl.signal });
    // 503 is the cell telling us Overpass just failed IT — a real answer, and a
    // reason to retry this tile later, not to abandon the proxy.
    if (res.status === 503) throw new Error('fill failed');
    if (!res.ok) { tileProxyOk = false; return null; }
    const json = await res.json() as { ways?: Array<{ id: number; tags?: Record<string, string>; geometry?: Array<[number, number]> }> };
    // Stored as [lat, lon] pairs — a third of the bytes of {lat, lon} objects,
    // and the renderer wants the object shape, so widen on the way in.
    return (json.ways ?? []).map((w) => ({
      id: w.id,
      tags: w.tags,
      geometry: (w.geometry ?? []).map(([lat, lon]) => ({ lat, lon })),
    })) as OsmWay[];
  } finally { clearTimeout(bail); }
  // NOTE: no catch. A timeout or a network blip is THIS TILE failing, and the
  // caller's backoff already handles that; swallowing it here dropped the
  // request into the direct-Overpass path and paid for the same tile twice.
  // `null` now means one thing only — the proxy itself is not answering — so
  // the fallback still covers a bad deploy and nothing else.
}

async function loadOsmTile(x: number, y: number): Promise<void> {
  const key = `${x}/${y}`;
  if (osmLoaded.has(key)) return;
  osmLoaded.add(key);
  const cached = await readTileCache(x, y);
  if (cached) {
    const before = unbuilt;
    await renderGated(x, y, cached);
    if (unbuilt !== before) setTimeout(() => osmLoaded.delete(key), 3000);
    else osmDone.add(key);
    return;
  }
  osmNote(1);
  if (osmInFlight >= OSM_GATE) {
    const run = await new Promise<boolean>((r) => { osmQueue.push({ x, y, go: r }); });
    // Dropped: the car left this tile behind while it sat in the queue. Forget
    // it was ever asked for, so a later pass can ask again if you come back.
    if (!run) { osmLoaded.delete(key); osmNote(-1); return; }
  }
  osmInFlight++;
  try {
    let ways = await proxyTile(x, y);
    if (!ways) {
      // The proxy could not answer. Go straight to the mirrors, exactly as
      // before this cell had a namespace.
      const b = tileBounds(x, y, OSM_Z);
      const bbox = `${b.latS},${b.lonW},${b.latN},${b.lonE}`;
      const q = `[out:json][timeout:15];(
        way["highway"](${bbox});
        way["building"](${bbox});
        way["natural"="water"](${bbox});
        way["waterway"="riverbank"](${bbox});
        way["landuse"~"forest|meadow|grass|recreation_ground"](${bbox});
        way["leisure"~"park|pitch|garden"](${bbox});
      );out geom 2000;`;
      const r = await overpass(q);
      ways = ((r.elements ?? []) as Array<OsmWay & { type?: string }>).filter((e) => e.type === 'way' && e.geometry);
    }
    osmFails = 0;
    osmDown = false;
    writeTileCache(x, y, ways);
    const before = unbuilt;
    await renderGated(x, y, ways);
    // A tile that refused any ribbon for want of terrain is NOT done. Let it
    // be requested again once the elevation it needed has landed, or the road
    // is simply missing for the rest of the session.
    if (unbuilt !== before) setTimeout(() => osmLoaded.delete(key), 3000);
    else osmDone.add(key);
  } catch {
    if (++osmFails >= 2) osmDown = true;
    setTimeout(() => osmLoaded.delete(key), 8000); /* backoff, then a later pass retries */
  }
  finally {
    osmInFlight--;
    osmNote(-1);
    osmRelease();
  }
}

// ── streaming around the car ───────────────────────────────────────
function localToLatLon(ex: number, ez: number): [number, number] {
  return [origin.lat - ez / M_LAT, origin.lon + ex / origin.mLon];
}
/** Ground metres across one tile at a zoom, at this world's latitude. */
const tileMetres = (z: number): number =>
  (40075016.7 / 2 ** z) * Math.cos((origin.lat * Math.PI) / 180);
/** Half the ground the camera can see — the radius streaming has to serve.
 *  Derived from the rig, not guessed: distance × tan(half-fov) with the tilt
 *  folded in, which is what the frustum actually lands on. */
function viewRadius(): number {
  if (camMode !== 'top') return 900;
  const dist = CAM.base * zoomCur + Math.abs(state.speed) * 3.6 * CAM.perKmh;
  const halfV = Math.tan(((camera.fov / 2) * Math.PI) / 180);
  // The far edge of a tilted frustum reaches further than the near edge; the
  // /cos term is that stretch, capped so a near-horizon tilt cannot ask for
  // the whole planet.
  return Math.min(60000, dist * halfV * Math.max(1, 1 / Math.cos(((90 - CAM.tilt) * Math.PI) / 180)) * 1.35);
}
// Two budgets, and they are budgets rather than radii because the cost of the
// two layers is nothing alike. A terrain tile is a PNG and a mesh; an OSM tile
// is a vector query whose geometry cost is unbounded in a city. So terrain
// widens generously and roads widen a little.
// 7×7 fine tiles ≈ 14km. Not larger: every fine tile is 16.6k vertices each
// asking the road grid about cuttings, so 9×9 is 1.35M vertices of rebuild
// queued behind a 200ms throttle — nearly a minute of hitching for ground the
// coarse shell renders for a three-hundredth of the cost.
const TERRAIN_RING_MAX = 3;
// 9×9 vector tiles ≈ 4.5km, and this is the one that cannot be solved by
// widening. Covering a 47km chart at OSM_Z would be 8649 tiles; the road
// network is a disc around the car by construction, and the wide view is
// landform. Anything more honest than this needs a coarser road source.
const OSM_RING_MAX = 4;
function streamWorld(ex: number, ez: number): void {
  const [lat, lon] = localToLatLon(ex, ez);
  const r = viewRadius();
  const [tx, ty] = tileAt(lat, lon, TERRAIN_Z);
  // Rings grow with the VIEW, not just the car. Zooming out used to change
  // nothing at all — measured: 25 height tiles and 65 ways at zoom 1 and at
  // zoom 44 alike — so the chart was an aerial photograph of a 1.5km disc of
  // roads adrift in blank hillside.
  const tRing = clamp(Math.ceil(r / tileMetres(TERRAIN_Z)), TERRAIN_RING, TERRAIN_RING_MAX);
  for (let dx = -tRing; dx <= tRing; dx++)
    for (let dy = -tRing; dy <= tRing; dy++) void loadTerrainTile(tx + dx, ty + dy);
  // Land cover, over the FULL terrain footprint rather than the road ring: it
  // paints the ground and plants the vegetation, so it has to reach as far as
  // you can see, and at ~1–5KB a tile covering 9.8km that costs nothing.
  {
    const cRing = clamp(Math.ceil(r / tileMetres(COVER_Z)), 1, 3);
    const [cx0, cy0] = tileAt(lat, lon, COVER_Z);
    for (let dx = -cRing; dx <= cRing; dx++)
      for (let dy = -cRing; dy <= cRing; dy++) void loadCoverTile(cx0 + dx, cy0 + dy);
    // Cover also knows which ground is water, and water is the only honest
    // witness to where sea level sits in THIS DEM's datum. Kept OUTSIDE the
    // biome latch on purpose: the biome is happy to settle on the first decent
    // sample, and sea level is not — it keeps re-measuring as cover streams in
    // until three passes running agree.
    if (seaDatumSteady < 3) {
      const was = seaDatum;
      measureSeaDatum();
      // The waterline just moved, and every seabed was cut against the old
      // one. Everything already built has to be cut again.
      if (seaDatum !== was) for (const k of terrainMeshes.keys()) terrainDirty.add(k);
    }
    // The moment there is enough real cover to judge on, the world stops being
    // a latitude band and becomes the place it actually is. Once only.
    if (!biomeSettled) {
      const b = biomeFromCover(origin.lat, baseElev);
      if (b) {
        biomeSettled = true;
        if (b !== biome) {
          applyBiome(b);
          // Everything already painted was painted from the guess: the ground
          // colour, and every thicket the old species mix planted.
          for (const k of terrainMeshes.keys()) terrainDirty.add(k);
          vegSeeded.clear();
          vegGrid.clear();
        }
      }
    }
  }
  const [ox, oy] = tileAt(lat, lon, OSM_Z);
  const oRing = clamp(Math.ceil(r / tileMetres(OSM_Z)), OSM_RING, OSM_RING_MAX);
  // WHERE THE CAR IS ABOUT TO BE. A symmetric ring spends half its tiles behind
  // you: in cab view the ring is 5×5 and only ten of those tiles are ahead, so
  // at 126km/h you have ~1.0–1.5km of forward margin and the queue is busy
  // fetching the country you have already crossed. The disc around the car
  // stays (you must never lose the ground under the wheels) and an extra ring
  // is added AHEAD only — a lozenge, not a bigger circle, so the cost is a
  // handful of tiles rather than the square of the radius.
  const tm = tileMetres(OSM_Z);
  const look = Math.min(oRing * tm, Math.abs(state.speed) * 14);   // ~14s of travel
  osmCarX = ex; osmCarZ = ez;
  osmFocusX = ex + Math.sin(state.heading) * look;
  osmFocusZ = ez - Math.cos(state.heading) * look;
  const ext = oRing + 1;
  osmRingR = (ext + 0.75) * tm;   // past this the queue stops believing in a tile
  for (let dx = -ext; dx <= ext; dx++) for (let dy = -ext; dy <= ext; dy++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= oRing) { void loadOsmTile(ox + dx, oy + dy); continue; }
    const [cx, cz] = tileCentreLocal(ox + dx, oy + dy);
    if (Math.hypot(cx - osmFocusX, cz - osmFocusZ) <= oRing * tm) void loadOsmTile(ox + dx, oy + dy);
  }
  // Beyond the fine layer's reach, a COARSE shell so the land does not simply
  // stop. Only fetched once the view is wide enough to see past the fine ring.
  if (r > tileMetres(TERRAIN_Z) * 1.5) {
    const [fx, fy] = tileAt(lat, lon, FAR_Z);
    const fRing = clamp(Math.ceil(r / tileMetres(FAR_Z)), 1, FAR_RING_MAX);
    for (let dx = -fRing; dx <= fRing; dx++)
      for (let dy = -fRing; dy <= fRing; dy++) void loadFarTile(fx + dx, fy + dy);
  }
}

// ── the far shell: coarse terrain for the wide view ────────────────
// Raising the zoom ceiling without this just shows a bigger void. Fine tiles
// cannot be the answer — covering 40km at TERRAIN_Z would be 441 tiles and
// seven million vertices — so distance gets its own layer three zooms coarser:
// 25 tiles cover ~80km for about 60k vertices, one three-hundredth the cost.
//
// It is a BACKDROP, never a surface. Nothing samples it: not the wheels, not
// the scatter, not groundAt. It is drawn only when the chart is zoomed far
// enough out that the fine ring cannot fill the frame, which also means the
// seam between the two layers is never on screen at an angle where a few
// metres of disagreement could show.
const FAR_Z = 11;
const FAR_RING_MAX = 2;       // 5×5 coarse tiles ≈ 81km, which covers the widest chart
const FAR_SEG = 48;
const farTiles = new Set<string>();
const farMeshes = new Map<string, THREE.Mesh>();
const farGroup = new THREE.Group();
farGroup.name = 'far';
farGroup.visible = false;
worldGroup.add(farGroup);
// Four at a time. Asking for a whole ring at once is a thundering herd against
// one S3 bucket: a measured 49-tile request landed 9 meshes and left the rest
// racing each other for sockets.
let farInFlight = 0;
const farQueue: Array<() => void> = [];
async function loadFarTile(x: number, y: number): Promise<void> {
  const key = `${x}/${y}`;
  if (farTiles.has(key)) return;
  farTiles.add(key);
  if (farInFlight >= 4) await new Promise<void>((go) => farQueue.push(go));
  farInFlight++;
  const data = await fetchHeights(x, y, FAR_Z).finally(() => {
    farInFlight--;
    farQueue.shift()?.();
  });
  if (!data) { farTiles.delete(key); return; }
  const b = tileBounds(x, y, FAR_Z);
  const [wx0, wz0] = toLocal(b.latN, b.lonW);
  const [wx1, wz1] = toLocal(b.latS, b.lonE);
  const xs = Math.min(wx0, wx1), zs = Math.min(wz0, wz1);
  const w = Math.abs(wx1 - wx0), h = Math.abs(wz1 - wz0);
  const geo = new THREE.PlaneGeometry(w, h, FAR_SEG, FAR_SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  // SLOPE IS SHADED PER TEXEL, NOT PER VERTEX. du/dv are the rise across one
  // heightfield pixel, so the divisor has to be a pixel's ground width — and
  // the fine builder happens to use twice that. Dividing by this layer's own
  // vertex spacing instead made every coarse hillside read five times flatter
  // than the same hillside in the fine layer, which is what drew a hard-edged
  // rectangle of "real" terrain around the car on the wide chart.
  const cell = w / 128;
  for (let i = 0; i < pos.count; i++) {
    // Sampled from THIS tile's own pixels — no cross-tile bilinear, no road
    // grid, no cut. A seam of a few metres between coarse tiles is invisible
    // from the only altitude this layer is ever seen at.
    const u = clamp(Math.round(((pos.getX(i) + w / 2) / w) * 255), 0, 255);
    const v = clamp(Math.round(((pos.getZ(i) + h / 2) / h) * 255), 0, 255);
    const raw = data[v * 256 + u];
    pos.setY(i, raw - baseElev - FAR_DROP);
    const du = data[v * 256 + Math.min(255, u + 1)] - raw;
    const dv = data[Math.min(255, v + 1) * 256 + u] - raw;
    const [r, g, bb] = terrainPalette(raw, Math.hypot(du, dv) / Math.max(cell, 1));
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = bb;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, terrainMat);
  mesh.position.set(xs + w / 2, 0, zs + h / 2);
  farMeshes.set(key, mesh);
  farGroup.add(mesh);
}
/** Sunk far enough that the fine layer always wins where both exist, shallow
 *  enough that the lip around the fine ring does not draw its own shadow. The
 *  boundary is still findable on the wide chart — inside it there are road
 *  cuttings and outside there are not — but that is honest level of detail
 *  rather than an artefact. */
const FAR_DROP = 12;

// ── the car: monster-truck stance with per-wheel suspension ────────
// The group's origin is the AXLE PLANE (wheel centres at rest). The body
// rides high above it; each wheel hangs in a steering pivot whose local y is
// its suspension deflection, so wheels track the terrain while the sprung
// body lags on its springs.
// ── to the spec sheet ──────────────────────────────────────────────
// PARIS → DAKAR, class overland/rally: 4.90m long, 2.15m wide, 2.35m tall,
// 3.10m wheelbase, 0.45m ground clearance. The hull was already the right
// LENGTH (4.88m) and badly wrong everywhere else — 3.08m across and 3.22m tall,
// which is a monster truck, not a rally rig. The authored geometry below is
// left in the numbers that read well, and SX/SY squeeze it onto the sheet;
// z needs no factor because the length was already right.
//
// Everything the wheels touch follows from clearance: the lowest hull part
// sits exactly on the axle plane, so GROUND CLEARANCE *is* the wheel radius,
// and overall height is the hull top plus that radius.
const SX = 0.7, SY = 0.8;
// WHEEL_R drives the physics (contact plane, spin rate); WHEEL_W is cosmetic.
const WHEEL_R = 0.45, WHEEL_W = 0.36, TRACK = 1.18 * SX, AXLE = 1.55;
// Local wheel anchors [x, z] — FL, FR, RL, RR (forward is -z).
const WHEELS: Array<[number, number]> = [[-TRACK, -AXLE], [TRACK, -AXLE], [-TRACK, AXLE], [TRACK, AXLE]];
// ── bodywork ───────────────────────────────────────────────────────
// Flat paint on flat slabs is what makes the hull read as a toy. This is the
// truck's paint job: panel seams, weathered camo blotches over the red, and
// road dust climbing the sills.
//
// It works in CAR-LOCAL space, taken straight from the vertex buffer, which is
// why `add` bakes placement into the geometry. World space would swim as the
// truck drives; per-part object space would restart the pattern on every box;
// and UVs on BoxGeometry are 0..1 per face, so a texture map would land at a
// different scale on every panel. Local position has none of those problems
// and needs no UVs at all.
function bodywork(mat: THREE.Material, amount: number): void {
  mat.onBeforeCompile = (sh) => {
    // ONE shared uniform so the weathering dial can move every painted panel at
    // once; each material's own share is baked into the source as a literal.
    sh.uniforms.uWear = wearU;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBodyP; varying vec3 vBodyN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBodyP = position;\nvBodyN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBodyP; varying vec3 vBodyN; uniform float uWear;
        #define WEAR (uWear * SHARE)
        float bh(vec2 p){ p = fract(p * vec2(127.31, 311.7)); p += dot(p, p + 37.19); return fract(p.x * p.y); }
        float bn(vec2 p){
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(bh(i), bh(i + vec2(1.0, 0.0)), f.x),
                     mix(bh(i + vec2(0.0, 1.0)), bh(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float bfbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * bn(p); p *= 2.03; a *= 0.5; } return s; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        // Project onto whichever plane this face plants on, so seams run ALONG
        // a panel instead of cutting across it at an angle.
        vec3 an = abs(normalize(vBodyN));
        vec2 uv = an.x > max(an.y, an.z) ? vBodyP.zy : (an.y > an.z ? vBodyP.xz : vBodyP.xy);
        // Weathered camo over the paint: big soft patches of faded olive and
        // sand, the reference's palette rather than a second colour of car.
        float blot = smoothstep(0.46, 0.66, bfbm(uv * 1.5 + 4.3));
        vec3 camo = mix(vec3(0.20, 0.23, 0.15), vec3(0.42, 0.38, 0.26), bfbm(uv * 2.6 + 9.1));
        diffuseColor.rgb = mix(diffuseColor.rgb, camo, blot * 0.34 * WEAR);
        // Panel seams on a 0.34m grid, and a shadow just under each one.
        vec2 g = fract(uv / 0.34);
        float line = min(min(g.x, 1.0 - g.x), min(g.y, 1.0 - g.y));
        diffuseColor.rgb *= 1.0 - (1.0 - smoothstep(0.0, 0.045, line)) * 0.3;
        // Road dust up the sills — heaviest at the bottom, thrown as streaks.
        float dust = smoothstep(0.62, 0.02, vBodyP.y) * (0.55 + 0.45 * bfbm(vec2(uv.x * 5.0, uv.y * 1.2)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.52, 0.45, 0.33), clamp(dust * 0.3 * WEAR, 0.0, 0.4));
        // And a fine grime speckle so no panel is ever a flat field of colour.
        diffuseColor.rgb *= 1.0 - 0.13 * WEAR * bfbm(uv * 9.0);
      }`).replace(/SHARE/g, amount.toFixed(3));
  };
}
let bodyMat: THREE.MeshLambertMaterial | null = null;
const tailMat = new THREE.MeshBasicMaterial({ color: 0x8e1a12 }); // brightens under braking
const car = new THREE.Group();
car.name = 'car';
car.rotation.order = 'YXZ'; // yaw first, then pitch/roll about the CAR's axes
const wheelPivots: THREE.Group[] = [];
const wheelMeshes: THREE.Mesh[] = [];
{
  // Built against the reference: a boxy overland 4x4 — glasshouse cab set
  // back, short bonnet, open rear tub, fender flares tying the wheels to the
  // body, and the gear an expedition truck actually carries. Every part is a
  // slab or a cylinder; the silhouette does the work at pixel resolution.
  const RED = 0xc4402c, DARK = 0x1b1f26, STEEL = 0x2a2f36, TAN = 0x6b6250;
  // DoubleSide: the extruded wheel arches are the one part whose winding is
  // not under our control, and a flipped face there renders as a black hole.
  const redMat = new THREE.MeshLambertMaterial({ color: RED, flatShading: true, side: DS });
  const glassMat = new THREE.MeshLambertMaterial({ color: DARK, flatShading: true });
  const steelMat = new THREE.MeshLambertMaterial({ color: STEEL, flatShading: true });
  const cargoMat = new THREE.MeshLambertMaterial({ color: TAN, flatShading: true });
  bodyMat = redMat;
  bodywork(redMat, 1);
  bodywork(steelMat, 0.35);
  bodywork(cargoMat, 0.5);
  const panelMat = new THREE.MeshLambertMaterial({ color: 0x14304e, emissive: 0x060f1c, flatShading: true });
  // Dark trim: arch lips, shut lines, handles. Unweathered — these are the
  // rubber-and-plastic parts, and the paint shader would only muddy them.
  const trimMat = new THREE.MeshLambertMaterial({ color: 0x241f1c, flatShading: true, side: DS });
  const tireMat = new THREE.MeshLambertMaterial({ color: 0x14171c, flatShading: true });
  const hubMat = new THREE.MeshLambertMaterial({ color: 0x8f8574, flatShading: true });
  // Every hull part sits DROP metres lower than its written y. The suspension
  // geometry wants the group origin on the axle plane, but hanging the body
  // where that put it left 1.3m of daylight under the tub and the truck walked
  // on stilts. One offset here beats re-deriving thirty numbers.
  const DROP = 0.3;
  // Both the geometry and its placement go through the spec-sheet squeeze, so
  // the authored numbers below stay readable and the sheet is honoured in
  // exactly one place. Every geometry handed in here is freshly built, so
  // scaling it in place is safe.
  // Placement is baked into the GEOMETRY, not carried on the mesh. The bodywork
  // shader below reads `position` straight out of the vertex buffer and needs
  // it in CAR space — with the offset on the mesh instead, every part would
  // have been centred on its own origin and the panel lines, dust gradient and
  // camo would have restarted on each box.
  // `rx` rakes a panel (windscreen, bonnet, solar) about its own centre, so it
  // has to happen after the squeeze and before the translate.
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0): THREE.Mesh => {
    geo.scale(SX, SY, 1);
    if (rx) geo.rotateX(rx);
    geo.translate(x * SX, (y - DROP) * SY, z);
    const m = new THREE.Mesh(geo, mat);
    car.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number): THREE.BoxGeometry => new THREE.BoxGeometry(w, h, d);
  // ── hull ──
  add(box(1.95, 0.85, 4.2), redMat, 0, 0.9, 0);                 // body tub
  add(box(1.35, 0.24, 3.4), steelMat, 0, 0.42, 0);              // exposed frame rails
  // ── the nose is not a brick ──
  // The bonnet falls away toward the grille and the leading edge is chamfered,
  // so the front three-quarter reads as a vehicle rather than a shipping crate.
  add(box(1.7, 0.34, 1.05), redMat, 0, 1.52, -1.46, -0.11);     // bonnet, sloping down
  add(box(1.66, 0.2, 0.4), redMat, 0, 1.4, -1.98, -0.34);        // chamfer into the grille
  for (const sx of [-0.8, 0.8]) add(box(0.16, 0.3, 1.0), redMat, sx, 1.5, -1.48, -0.11); // wing tops
  // The cab is RED with a dark GLASS BAND through it, not a black block. That
  // banding — red waist, black glass, red header and roof — is what makes the
  // reference read as one painted truck instead of a cargo pod on a chassis.
  add(box(1.7, 0.78, 1.62), redMat, 0, 1.7, -0.31);             // cab shell
  add(box(1.74, 0.34, 1.66), glassMat, 0, 1.86, -0.31);         // side glazing
  // RAKED WINDSCREEN. A vertical pane is the single most box-like thing about
  // the old hull; the reference leans it back over the bonnet. Sitting proud of
  // the cab on its own tilt, it also gives the roofline something to end on.
  add(box(1.66, 0.52, 0.1), glassMat, 0, 1.88, -1.2, 0.42);
  for (const px of [-0.85, 0.85]) add(box(0.14, 0.56, 0.13), redMat, px, 1.88, -1.2, 0.42); // A-pillars, on the rake
  // B and C pillars split the side glass into windows. They sit ON the glass
  // face (x = 0.87, the band's own half-width), not inboard of it: at 0.8 they
  // were buried inside it and invisible from the side elevation.
  for (const pz of [-0.4, 0.42]) {
    for (const px of [-0.87, 0.87]) add(box(0.16, 0.36, 0.15), redMat, px, 1.86, pz);
  }
  add(box(1.74, 0.14, 1.78), redMat, 0, 2.14, -0.39);           // roof cap
  add(box(1.7, 0.13, 0.3), redMat, 0, 2.11, -1.32, 0.3);        // roof leading edge, faired down
  // ── rear tub: side rails and a tailgate, so the back reads as open cargo ──
  for (const sx of [-0.92, 0.92]) add(box(0.11, 0.34, 1.7), redMat, sx, 1.5, 1.2);
  add(box(1.9, 0.34, 0.12), redMat, 0, 1.5, 2.02);
  // Sand ladders strapped along the tub — pure silhouette texture at 320p.
  for (const sx of [-1.0, 1.0]) add(box(0.07, 0.3, 1.45), cargoMat, sx, 1.5, 1.2);
  // ── wheel arches: ARCHES ──
  // Four rectangles over four round tyres was the most obviously wrong thing on
  // the side elevation. These are extruded annulus sectors, so the flare
  // actually follows the tyre. They are built in FINAL metres and added
  // directly — pushing a circle through the SX/SY squeeze would turn it into an
  // ellipse while the tyre beside it stayed round.
  {
    const arch = (r0: number, r1: number, wid: number, mat: THREE.Material): void => {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, r1, 0.12, Math.PI - 0.12, false);
      shape.absarc(0, 0, r0, Math.PI - 0.12, 0.12, true);
      const proto = new THREE.ExtrudeGeometry(shape, { depth: wid, bevelEnabled: false });
      proto.rotateY(Math.PI / 2);        // arch plane → the truck's flank
      proto.translate(-wid / 2, 0, 0);   // and centre it on the wheel
      for (const [fx, fz] of WHEELS) {
        const g = proto.clone();
        g.translate(fx, 0, fz);
        car.add(new THREE.Mesh(g, mat));
      }
      proto.dispose();
    };
    const R1 = WHEEL_R + 0.07;
    // Body-coloured flare, then a dark trim lip WRAPPING its outer edge. Red on
    // red, the flare vanished into the flank; every 4x4 that has flares this
    // wide has them edged in something that isn't paint.
    arch(R1, R1 + 0.16, WHEEL_W + 0.08, redMat);
    arch(R1 + 0.13, R1 + 0.22, WHEEL_W + 0.14, trimMat);
  }
  // ── door cuts and handles ──
  // The shader's panel grid is regular by nature; a door is not. These are the
  // shut lines an eye actually looks for on a flank.
  for (const sx of [-0.99, 0.99]) {
    for (const dz of [-1.12, 0.02, 0.5]) add(box(0.05, 0.62, 0.05), trimMat, sx, 1.34, dz);
    add(box(0.05, 0.05, 1.1), trimMat, sx, 1.63, -0.55);        // waist line
    for (const dz of [-0.72, 0.3]) add(box(0.06, 0.06, 0.2), trimMat, sx, 1.5, dz); // handles
  }
  // ── protection: bull bar, winch, rock sills, tow points ──
  add(box(2.0, 0.26, 0.2), steelMat, 0, 0.95, -2.2);
  add(box(0.52, 0.24, 0.28), steelMat, 0, 1.0, -2.34);          // winch drum
  for (const sx of [-0.62, 0.62]) add(box(0.12, 0.5, 0.12), steelMat, sx, 1.2, -2.2);
  for (const sx of [-1.03, 1.03]) add(box(0.13, 0.13, 2.5), steelMat, sx, 0.52, 0);
  add(box(1.7, 0.22, 0.16), steelMat, 0, 0.95, 2.16);
  // ── roof rack, solar array, cargo ──
  add(box(1.66, 0.07, 2.6), steelMat, 0, 2.26, -0.1);
  for (const [px, pz] of [[-0.74, 1.08], [0.74, 1.08], [-0.74, -1.28], [0.74, -1.28]]) {
    add(box(0.09, 0.16, 0.09), steelMat, px, 2.18, pz);
  }
  for (const cz of [-1.0, 0, 1.0]) add(box(1.62, 0.05, 0.09), steelMat, 0, 2.31, cz);
  // SIX panels in a 2x3 array, framed by the rack showing through the gaps —
  // the plan view of two big slabs read as one undifferentiated blue mass.
  for (const px of [-0.4, 0.4]) for (const pz of [-1.06, -0.24, 0.58]) {
    add(box(0.72, 0.05, 0.74), panelMat, px, 2.33, pz, -0.05);
  }
  for (const px of [-0.5, 0.5]) add(box(0.28, 0.38, 0.2), cargoMat, px, 2.48, 1.16); // jerry cans
  add(box(1.2, 0.12, 0.14), steelMat, 0, 2.35, -1.42);           // light bar
  for (const px of [-0.38, 0.38]) {
    add(box(0.2, 0.15, 0.08), new THREE.MeshBasicMaterial({ color: 0xfff1cf }), px, 2.35, -1.5);
  }
  // ── spare on a swing-out carrier, ladder opposite, snorkel up the A-pillar ──
  // OFF-CENTRE and smaller: dead-centre and full size it was a black hole where
  // the back of the truck should be, and it buried both tail lights.
  const spareGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.28, 10);
  spareGeo.rotateX(Math.PI / 2);
  add(spareGeo, new THREE.MeshLambertMaterial({ color: 0x1c2026, flatShading: true }), 0.52, 1.42, 2.26);
  const spareHub = new THREE.CylinderGeometry(0.19, 0.19, 0.32, 8);
  spareHub.rotateX(Math.PI / 2);
  add(spareHub, hubMat, 0.52, 1.42, 2.26);                       // pale centre, so it isn't a void
  for (const sx of [-0.72, -0.3]) add(box(0.07, 0.95, 0.07), steelMat, sx, 1.75, 2.22); // ladder rails
  for (const ry of [1.42, 1.76, 2.1]) add(box(0.5, 0.06, 0.06), steelMat, -0.51, ry, 2.22);
  add(box(0.13, 1.15, 0.13), steelMat, 0.86, 1.75, -1.2);
  add(box(0.13, 0.13, 0.42), steelMat, 0.86, 2.28, -1.36);
  // ── the face ── grille between the lamps, so the nose is not a blank slab.
  add(box(1.12, 0.34, 0.1), glassMat, 0, 1.28, -2.1);
  for (const gy of [1.18, 1.3, 1.42]) add(box(1.06, 0.05, 0.13), steelMat, 0, gy, -2.11);
  // ── lamps ── small and set into the corners; big ones bloom into blobs.
  const headMat2 = new THREE.MeshBasicMaterial({ color: 0xfff1cf });
  for (const sx of [-0.66, 0.66]) add(box(0.3, 0.2, 0.1), headMat2, sx, 1.08, -2.13);
  for (const sx of [-0.78, 0.78]) add(box(0.22, 0.26, 0.08), tailMat, sx, 1.1, 2.12);
  // ── wheels ──
  for (const [wx, wz] of WHEELS) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0, wz);
    const tireGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 12);
    tireGeo.rotateZ(Math.PI / 2);
    const wheel = new THREE.Mesh(tireGeo, tireMat);
    const hubGeo = new THREE.CylinderGeometry(WHEEL_R * 0.42, WHEEL_R * 0.42, WHEEL_W + 0.08, 8);
    hubGeo.rotateZ(Math.PI / 2);
    wheel.add(new THREE.Mesh(hubGeo, hubMat));
    pivot.add(wheel);
    car.add(pivot);
    wheelPivots.push(pivot);
    wheelMeshes.push(wheel);
  }
}
// ── beams ──────────────────────────────────────────────────────────
// Front is -z. The BEAMS are additive cones that fade along their length, and
// one real spotlight throws a pool down the road. Parented to the car, so
// they sweep with pitch and roll over every crest.
const BEAM_LEN = 26, BEAM_R = 4.0;

const beamGeo = new THREE.ConeGeometry(BEAM_R, BEAM_LEN, 18, 1, true);
beamGeo.translate(0, -BEAM_LEN / 2, 0); // apex to the origin (the lamp)
beamGeo.rotateX(Math.PI / 2);           // and open it along -z, straight ahead
const beamMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  uniforms: { uLen: { value: BEAM_LEN }, uRad: { value: BEAM_R }, uAmp: { value: 1 } },
  vertexShader: `
    uniform float uLen; uniform float uRad;
    varying float vD; varying float vR;
    void main(){
      vD = clamp(-position.z / uLen, 0.0, 1.0);
      vR = clamp(length(position.xy) / max(vD * uRad, 0.001), 0.0, 1.0); // 0 on axis, 1 at the rim
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform float uAmp; varying float vD; varying float vR;
    void main(){
      // EVERY term clamped. Interpolation can overshoot a varying by an ulp at
      // grazing angles, and pow() with a negative base is NaN in GLSL — one NaN
      // fragment in an additive pass poisons the render target, smears through
      // the half-res blur, and comes out of the tonemap as a hard black blob.
      // That was the "black arch" over the truck, not the tunnels.
      float d = clamp(vD, 0.0, 1.0), r = clamp(vR, 0.0, 1.0);
      // Daylight: the beam is a hint, not a searchlight. (The old night value
      // painted a white wedge across a sunlit desert.)
      float a = max(pow(max(1.0 - d, 0.0), 1.7) * (1.0 - r * r) * 0.07 * uAmp, 0.0);
      gl_FragColor = vec4(vec3(1.0, 0.94, 0.78) * a, a);
    }`,
});
const beams: THREE.Mesh[] = [];
for (const sx of [-0.62, 0.62]) {
  // The lamps themselves are part of the hull now; this loop only hangs the
  // visible beam cones off them.
  const beam = new THREE.Mesh(beamGeo, beamMat);
  // Hung off the hull lamps, so it takes the same spec-sheet squeeze they do.
  beam.position.set(sx * SX, 0.78 * SY, -2.05);
  // Aimed properly DOWN at the tarmac: a shallow beam ran level to the
  // horizon and read as two searchlights pointing at the sky over the roof.
  beam.rotation.x = -0.11;
  beam.renderOrder = 20;
  beams.push(beam);
  car.add(beam);
}
// One spotlight for the actual pool of light (two would double the cost of
// every lit material for a difference nobody can see). Intensity is in
// CANDELA since three r155 — the old "3.2" was a rounding error, not a lamp.
const headSpot = new THREE.SpotLight(0xfff0d0, 90, 110, 0.52, 0.65, 1.0);
headSpot.position.set(0, 0.78 * SY, -2.0); // likewise
headSpot.target.position.set(0, -1.6, -30);
car.add(headSpot, headSpot.target);
// REAL SIZE (owner: the 3.2x cartographic car straddled whole roads and made
// every speed read as a crawl). In the top chart view the car is small — the
// halo is the position marker; in chase it reads true against lane widths.
const halo = new THREE.Mesh(
  // A RING, not a disc — a filled circle drawn depth-free painted straight
  // over the truck, so the chart view showed a gold coin where the vehicle
  // should be. The ring frames it instead.
  // A HAIRLINE — 0.55m where it was 1.4m, a gold doughnut that hid the truck it
  // was supposed to point at. It scales with zoom, so its SCREEN thickness is
  // constant at every distance; thinner than this and it falls under one pixel
  // of the 320p buffer and disappears entirely.
  new THREE.RingGeometry(6.05, 6.6, 40),
  // A MARKER, not scenery: no depth test, drawn late — the player's position
  // is never allowed to be swallowed by a drape or a rooftop.
  new THREE.MeshBasicMaterial({ color: 0xf5c453, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false }),
);
halo.renderOrder = 40;
halo.rotation.x = -Math.PI / 2;
halo.position.y = 0.15;
car.add(halo);
scene.add(car);
// ── the studio ─────────────────────────────────────────────────────
// The menu's VEHICLE panel needs the truck on a clean backdrop, not wherever
// it happens to be parked at dusk in the rain. Rather than clone it — four
// materials, a suspension rig and two lamps deep — the real truck is BORROWED
// into this scene for the one render and handed straight back, which also
// means the panel can never show a stale copy of the model.
const studio = new THREE.Scene();
studio.add(new THREE.HemisphereLight(0xdaeef6, 0x2b2a22, 2.2));
const studioKey = new THREE.DirectionalLight(0xfff2dc, 2.4);
studioKey.position.set(5, 7, 4);
studio.add(studioKey, studioKey.target);
const studioFill = new THREE.DirectionalLight(0x9ecbe8, 0.85);
studioFill.position.set(-6, 3, -5);
studio.add(studioFill, studioFill.target);
const studioCam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
let studioSpin = 0.6;
// ── elevations ─────────────────────────────────────────────────────
// The sheet is a set of ORTHOGRAPHIC views, and you cannot check a model
// against them from a perspective 3/4: perspective foreshortens, so every
// proportion you try to read off it is a guess. These are true elevations,
// framed from the hull's own bounding box, with the suspension and steering
// frozen so it is a drawing rather than a snapshot of a truck mid-bounce.
// `dir` is the direction the camera looks ALONG; `up` orients the frame; `w`
// and `h` name which local axes the view's width and height measure.
const VIEWS: Array<{ id: string; dir: [number, number, number]; up: [number, number, number]; w: 'x' | 'y' | 'z'; h: 'x' | 'y' | 'z' }> = [
  { id: '3/4', dir: [0, 0, 0], up: [0, 1, 0], w: 'z', h: 'y' },   // the perspective turntable
  { id: 'FRONT', dir: [0, 0, 1], up: [0, 1, 0], w: 'x', h: 'y' }, // nose is -z, so look along +z
  { id: 'REAR', dir: [0, 0, -1], up: [0, 1, 0], w: 'x', h: 'y' },
  { id: 'LEFT', dir: [1, 0, 0], up: [0, 1, 0], w: 'z', h: 'y' },
  { id: 'RIGHT', dir: [-1, 0, 0], up: [0, 1, 0], w: 'z', h: 'y' },
  { id: 'TOP', dir: [0, -1, 0], up: [0, 0, -1], w: 'x', h: 'z' }, // nose up the frame
];
let vehView = 0;
const studioOrtho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
const AXIS_SIZE = (b: THREE.Box3, a: 'x' | 'y' | 'z'): number => b.max[a] - b.min[a];
// Half-extents in METRES for a given elevation at a given viewport aspect —
// computed the same way by the renderer and by the HUD, so the grid the HUD
// draws over the bay lines up with the truck the renderer puts in it.
function orthoExtents(view: number, aspect: number): { hw: number; hh: number } {
  const v = VIEWS[view];
  const pad = 1.14;
  let hw = (AXIS_SIZE(specBox, v.w) / 2) * pad, hh = (AXIS_SIZE(specBox, v.h) / 2) * pad;
  if (hw / hh < aspect) hw = hh * aspect; else hh = hw / aspect;
  return { hw, hh };
}
// The bay renders through the SAME pixel grid as the world. A smooth,
// anti-aliased truck sitting inside a hand-built bitmap HUD reads as a leak
// from another program — so it goes to a low-res target and is magnified with
// nearest sampling, exactly like the scene pass.
const rtVeh = mkRT(true, true);
const vehCopyMat = new THREE.ShaderMaterial({
  uniforms: {
    src: { value: null as THREE.Texture | null },
    uPix: { value: new THREE.Vector2(2, 2) },
    uLevels: { value: 14 },
  },
  vertexShader: QUAD_VS,
  // The target is LINEAR, like the scene pass — so this has to do the encode,
  // the GRADE and the palette step the composite ends on, or an inset comes out
  // near-black and in smoother, flatter colour than everything around it.
  fragmentShader: `
    uniform sampler2D src; uniform vec2 uPix; uniform float uLevels; varying vec2 vUv;
    vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
    float bayer2(vec2 a){ a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
    float bayer4(vec2 a){ return bayer2(0.5 * a) * 0.25 + bayer2(a); }
    void main(){
      vec3 enc = srgb(max(texture2D(src, vUv).rgb, 0.0));
      float l = dot(enc, vec3(0.299, 0.587, 0.114));
      enc = clamp(mix(vec3(l), enc, 1.35), 0.0, 1.0);
      enc = clamp((enc - 0.5) * 1.18 + 0.47, 0.0, 1.0);
      float d = (bayer4(floor(vUv * uPix)) - 0.5) * 0.6;
      enc = floor(enc * uLevels + d + 0.5) / uLevels;
      gl_FragColor = vec4(enc, 1.0);
    }`,
  depthTest: false,
  depthWrite: false,
});
// ── weather ────────────────────────────────────────────────────────
// Four states that drift into one another on a slow clock, biased by biome
// (the desert rarely storms; the tropics rarely stay clear). Everything reads
// from `wx`: sun and fill strength, haze density, rain, and — the part that
// matters for driving — how much grip the ground has left.
type Sky = 'clear' | 'haze' | 'rain' | 'storm';
const WX: Record<Sky, { cloud: number; rain: number; label: string }> = {
  clear: { cloud: 0, rain: 0, label: 'CLEAR' },
  haze: { cloud: 0.45, rain: 0, label: 'HAZE' },
  rain: { cloud: 0.75, rain: 0.6, label: 'RAIN' },
  storm: { cloud: 0.95, rain: 1, label: 'STORM' },
};
const wx = { sky: 'clear' as Sky, next: 'clear' as Sky, cloud: 0, rain: 0, wet: 0, at: 0, warn: 0, flash: 0, bolt: 0 };
// ── the weather that is actually happening ─────────────────────────
// The chain below invents a front every couple of minutes out of a six-entry
// table. It is a decent toy and it stays — as the OFFLINE fallback, and because
// a real sky that is clear for an hour is boring to develop against. But the
// truth is one fetch away: Open-Meteo answers with CORS and no key, and knows
// the cloud cover, the rain, the temperature and — the one that changes how the
// sky MOVES — the wind that is pushing it all along.
const live = {
  on: false, at: 0, tempC: null as number | null,
  windKmh: 0, windDeg: 0, code: 0,
};
async function fetchLiveWeather(): Promise<void> {
  if (performance.now() < live.at) return;
  live.at = performance.now() + 900000;   // the upstream updates every 15 minutes
  try {
    const u = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${origin.lat.toFixed(4)}&longitude=${origin.lon.toFixed(4)}`
      + '&current=temperature_2m,cloud_cover,precipitation,wind_speed_10m,wind_direction_10m,weather_code'
      + '&timezone=UTC';
    const res = await fetch(u);
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json() as { current?: Record<string, number> };
    const c = j.current;
    if (!c) throw new Error('no current');
    live.tempC = c.temperature_2m ?? null;
    live.windKmh = c.wind_speed_10m ?? 0;
    live.windDeg = c.wind_direction_10m ?? 0;
    live.code = c.weather_code ?? 0;
    // WMO code is the honest signal for precipitation type and violence; cloud
    // cover alone cannot tell drizzle from a thunderstorm.
    const code = live.code, cover = (c.cloud_cover ?? 0) / 100;
    wx.next = code >= 95 ? 'storm'
      : code >= 51 || (c.precipitation ?? 0) > 0.05 ? 'rain'
      : cover > 0.25 ? 'haze' : 'clear';
    // Cloud cover is a MEASUREMENT, so it overrides the sky state's nominal
    // value: an overcast dry day is not the same picture as a rainy one.
    WX_LIVE.cloud = cover;
    live.on = true;
    wx.at = performance.now() + 900000;   // stand the synthetic chain down
  } catch {
    live.on = false;
    live.at = performance.now() + 120000; // try again in a couple of minutes
  }
}
const WX_LIVE = { cloud: 0 };
function rollWeather(now: number): void {
  if (live.on) return;                    // the real sky is in charge
  if (now < wx.at) return;
  wx.at = now + (90 + Math.random() * 150) * 1000; // a front lasts 1.5–4 minutes
  // Biome bias: arid stays dry, tropical turns often, boreal broods.
  const b = biome.name;
  const table: Sky[] = b === 'arid' ? ['clear', 'clear', 'clear', 'haze', 'haze', 'rain']
    : b === 'tropical' ? ['clear', 'haze', 'rain', 'rain', 'storm', 'haze']
    : b === 'boreal' ? ['haze', 'haze', 'clear', 'rain', 'storm', 'haze']
    : b === 'alpine' ? ['clear', 'haze', 'clear', 'storm', 'haze', 'rain']
    : ['clear', 'haze', 'clear', 'rain', 'haze', 'storm'];
  wx.next = table[Math.floor(Math.random() * table.length)];
  wx.warn = wx.next === 'storm' && wx.sky !== 'storm' ? now + 12000 : 0;
}
function stepWeather(now: number, dt: number): void {
  rollWeather(now);
  void fetchLiveWeather();
  const t = WX[wx.next];
  const k = Math.min(1, dt * 0.12);                 // fronts arrive slowly
  // Live cover is a measurement and beats the sky state's nominal figure: an
  // overcast dry day and a rainy one are the same word and a different picture.
  wx.cloud += ((live.on ? WX_LIVE.cloud : t.cloud) - wx.cloud) * k;
  wx.rain += (t.rain - wx.rain) * k;
  wx.sky = wx.cloud > 0.85 ? 'storm' : wx.rain > 0.15 ? 'rain' : wx.cloud > 0.25 ? 'haze' : 'clear';
  // Ground stays wet after the rain stops, and dries out slowly.
  wx.wet = clamp(wx.wet + (wx.rain > 0.1 ? dt * 0.09 : -dt * 0.02), 0, 1);
  // Everything that was a fixed brightness is now scaled by where the sun is.
  // The night floor is not zero: a pitch-black world is not atmospheric, it is
  // unplayable, so moonlight keeps about a tenth of the key and the hemisphere
  // fill stays up to carry shape without colour.
  sun.intensity = biome.sunI * (1 - wx.cloud * 0.72) * (0.09 + 0.91 * dayF);
  hemi.intensity = biome.hemiI * (1 + wx.cloud * 0.35) * (0.30 + 0.70 * dayF);
  compMat.uniforms.uBloom.value = (0.75 - wx.cloud * 0.35) * (0.45 + 0.55 * dayF);
  skyMat.uniforms.uCloud.value = wx.cloud;
  skyMat.uniforms.uTime.value = now / 1000;
  waterU.uWTime.value = now / 1000;
  // Cloud shadows read the same cover and drift as the deck overhead.
  ghostU.uCloudS.value = cloudShadowOn ? wx.cloud : 0;
  // ONE WIND, and it is the real one. Open-Meteo reports the direction the air
  // is coming FROM, so the deck travels toward bearing+180; the sample offset
  // runs the other way again, because shifting a noise field moves what you see
  // in the opposite direction. Both the sky deck and the shadows it throws on
  // the ground read this, so they can never drift apart.
  {
    const toDeg = (live.on ? live.windDeg : 250) + 180;
    const t = (toDeg * Math.PI) / 180;
    const spd = (live.on ? live.windKmh : 12) * 0.0005;   // 12km/h ≈ the old fixed drift
    const wxv = -Math.sin(t) * spd, wzv = Math.cos(t) * spd;
    (skyMat.uniforms.uWind as { value: THREE.Vector2 }).value.set(wxv, wzv);
    ghostU.uWind.value.set(wxv * (now / 1000), wzv * (now / 1000));
  }
  // LIGHTNING. A strike is a double flash — the leader, then the return
  // stroke a beat later — and the thunder arrives after the sound has had
  // time to travel, which is what sells the distance.
  wx.flash = Math.max(0, wx.flash - dt * 7);
  if (wx.bolt > 0 && now >= wx.bolt) { wx.flash = 0.55; wx.bolt = 0; }
  if (wx.sky === 'storm' && wx.flash <= 0 && wx.bolt === 0 && Math.random() < dt * 0.22) {
    wx.flash = 0.9;
    wx.bolt = now + 60 + Math.random() * 90;             // the return stroke
    const far = 0.25 + Math.random() * 0.75;             // 0 = overhead, 1 = far off
    setTimeout(() => audio.thunder(far), far * 5200);
  }
  compMat.uniforms.uFlash.value = wx.flash * 0.5;
  if (wx.flash > 0) { sun.intensity += wx.flash * 1.6; hemi.intensity += wx.flash * 1.2; }
  // Overcast desaturates the haze toward slate and thickens it.
  const g = (c: Rgb): THREE.Vector3 => {
    const l = (c[0] + c[1] + c[2]) / 3;
    const m = 1 - wx.cloud * 0.7;
    return new THREE.Vector3(
      (c[0] * m + l * (1 - m)) * (1 + wx.cloud * 0.25),
      (c[1] * m + l * (1 - m)) * (1 + wx.cloud * 0.28),
      (c[2] * m + l * (1 - m)) * (1 + wx.cloud * 0.4),
    );
  };
  compMat.uniforms.uHazeBase.value.copy(g(biome.hazeBase));
  compMat.uniforms.uHazeSun.value.copy(g(biome.hazeSun));
  (skyMat.uniforms.uZenith.value as THREE.Vector3).copy(g(biome.zenith));
  (skyMat.uniforms.uHorizon.value as THREE.Vector3).copy(g(biome.horizon));
  stepRain(dt);
}

// Rain lives in a box that FOLLOWS the camera and wraps, so a few hundred
// streaks look like weather everywhere instead of a patch you drive out of.
const RAIN_N = 900, RAIN_BOX = 46;
const rainPos = new Float32Array(RAIN_N * 3);
for (let i = 0; i < RAIN_N; i++) {
  rainPos[i * 3] = (Math.random() - 0.5) * RAIN_BOX;
  rainPos[i * 3 + 1] = Math.random() * RAIN_BOX;
  rainPos[i * 3 + 2] = (Math.random() - 0.5) * RAIN_BOX;
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uAmt: { value: 0 } },
  vertexShader: `
    uniform float uAmt; varying float vA;
    void main(){
      vA = uAmt;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = max(1.0, 2.5 * (40.0 / max(-mv.z, 1.0)));
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying float vA;
    void main(){
      // A streak, not a dot: squash the sprite vertically.
      vec2 d = (gl_PointCoord - 0.5) * vec2(4.0, 1.0);
      if (dot(d, d) > 0.25) discard;
      gl_FragColor = vec4(0.72, 0.82, 0.92, vA * 0.5);
    }`,
});
const rain = new THREE.Points(rainGeo, rainMat);
rain.frustumCulled = false;
scene.add(rain);
function stepRain(dt: number): void {
  rainMat.uniforms.uAmt.value = wx.rain;
  rain.visible = wx.rain > 0.02;
  if (!rain.visible) return;
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  const fall = (14 + wx.rain * 12) * dt;
  for (let i = 0; i < RAIN_N; i++) {
    let y = rainPos[i * 3 + 1] - fall;
    let x = rainPos[i * 3], z = rainPos[i * 3 + 2];
    // Wrap relative to the camera in all three axes.
    if (y < cy - RAIN_BOX * 0.35) { y += RAIN_BOX; x = cx + (Math.random() - 0.5) * RAIN_BOX; z = cz + (Math.random() - 0.5) * RAIN_BOX; }
    if (x - cx > RAIN_BOX / 2) x -= RAIN_BOX; else if (cx - x > RAIN_BOX / 2) x += RAIN_BOX;
    if (z - cz > RAIN_BOX / 2) z -= RAIN_BOX; else if (cz - z > RAIN_BOX / 2) z += RAIN_BOX;
    rainPos[i * 3] = x; rainPos[i * 3 + 1] = y; rainPos[i * 3 + 2] = z;
  }
  (rainGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
}

// ── dust: what the tires throw up off-road ─────────────────────────
// A world-space particle pool (no per-frame allocation). Emitted at the rear
// contacts when the wheels are on loose ground, drifting up and back before
// settling — the visual proof that the surface under you changed.
const DUST_N = 220;
const dustPos = new Float32Array(DUST_N * 3);
const dustVel = new Float32Array(DUST_N * 3);
const dustLife = new Float32Array(DUST_N);   // 1 → 0
const dustSeed = new Float32Array(DUST_N);   // size jitter
const dustKind = new Float32Array(DUST_N);  // 0 = dust, 1 = water
let dustHead = 0;
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
dustGeo.setAttribute('aLife', new THREE.BufferAttribute(dustLife, 1));
dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dustSeed, 1));
dustGeo.setAttribute('aKind', new THREE.BufferAttribute(dustKind, 1));
dustGeo.frustumCulled = false;
const dustPoints = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: { uColor: { value: new THREE.Color(0x9a8f76) }, uWater: { value: new THREE.Color(0xcfe6f2) } },
  vertexShader: `
    attribute float aLife; attribute float aSeed; attribute float aKind;
    varying float vLife; varying float vKind;
    void main(){
      vLife = aLife; vKind = aKind;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      // Billowing, but CAPPED. The 1/distance term is unbounded, and the oldest
      // puffs — which were also the biggest — end up nearest the chase camera:
      // a single one reached ~290px on a 320px-tall target, so the trail
      // stopped being a plume and became a windscreen. Cap the projected size
      // and let the puff grow modestly instead of doubling.
      // Water droplets stay small — a wading truck displaces water, it does
      // not throw a plume.
      float sz = mix(4.6 + aSeed * 5.2, 3.5 + aSeed * 4.5, aKind);
      gl_PointSize = min(sz * (1.5 - aLife * 0.5) * (175.0 / max(-mv.z, 1.0)), 34.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform vec3 uWater; varying float vLife; varying float vKind;
    void main(){
      vec2 d = gl_PointCoord - 0.5;
      float r = dot(d, d);
      if (r > 0.25) discard;                       // round puff
      float soft = smoothstep(0.25, 0.02, r);
      // Water throws bright, hard-edged droplets; dry ground throws soft dust.
      vec3 col = mix(uColor, uWater, vKind);
      // Dust thins on the SQUARE of its life: the trailing end of the plume is
      // the part hanging in front of the camera, so it has to be nearly gone by
      // the time the truck has driven out from under it.
      float a = mix(soft * vLife * vLife * 0.2, smoothstep(0.25, 0.12, r) * vLife * 0.5, vKind);
      gl_FragColor = vec4(col, a);
    }`,
}));
dustPoints.frustumCulled = false;
dustPoints.renderOrder = 30;
scene.add(dustPoints);
function emitDust(x: number, y: number, z: number, vx: number, vz: number, water = false): void {
  const i = dustHead = (dustHead + 1) % DUST_N;
  const spread = water ? 1.6 : 0.8;
  dustPos[i * 3] = x + (Math.random() - 0.5) * spread;
  dustPos[i * 3 + 1] = y + (water ? 0.05 : 0.15);
  dustPos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
  // A splash is thrown OUT and up hard, then falls back; dust drifts.
  dustVel[i * 3] = vx + (Math.random() - 0.5) * (water ? 5.5 : 2.2);
  dustVel[i * 3 + 1] = water ? 2.2 + Math.random() * 2.6 : 0.7 + Math.random() * 1.1;
  dustVel[i * 3 + 2] = vz + (Math.random() - 0.5) * (water ? 5.5 : 2.2);
  dustLife[i] = 1;
  dustSeed[i] = Math.random();
  dustKind[i] = water ? 1 : 0;
}
function stepDust(dt: number): void {
  let any = false;
  for (let i = 0; i < DUST_N; i++) {
    if (dustLife[i] <= 0) continue;
    any = true;
    dustLife[i] = Math.max(0, dustLife[i] - dt * (dustKind[i] > 0.5 ? 1.8 : 0.9));
    const wet = dustKind[i] > 0.5;
    const k = Math.exp((wet ? -0.7 : -1.8) * dt); // droplets carry; dust settles
    dustVel[i * 3] *= k;
    dustVel[i * 3 + 2] *= k;
    dustVel[i * 3 + 1] = dustVel[i * 3 + 1] * k - (wet ? 9.0 : 0.9) * dt;
    dustPos[i * 3] += dustVel[i * 3] * dt;
    dustPos[i * 3 + 1] += dustVel[i * 3 + 1] * dt;
    dustPos[i * 3 + 2] += dustVel[i * 3 + 2] * dt;
  }
  if (any) {
    (dustGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (dustGeo.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    (dustGeo.attributes.aSeed as THREE.BufferAttribute).needsUpdate = true;
    (dustGeo.attributes.aKind as THREE.BufferAttribute).needsUpdate = true;
  }
}

const state = { x: 0, z: 0, heading: 0, speed: 0 };

// ── real drive: the device is the controller ───────────────────────
// The whole world already runs off real coordinates streamed from real
// elevation and real roads. The only fiction is the bicycle model in tick().
// Take that out, feed the position straight from the GPS, and the game becomes
// an instrument you can put on the dash of an actual car: the road you are on
// named in the corner, checkpoints on the way ahead, the survey filling in as
// you actually drive it.
//
// It is a MODE, not a dial, because it changes what the controls mean. There
// is no throttle, no collision, no way to be stuck in a building — the car is
// wherever the device says it is, and everything else in the frame is there to
// be looked at, never touched.
interface RealFix { lat: number; lon: number; acc: number; head: number | null; spd: number | null; at: number }
const real = {
  on: false,
  watch: 0,
  fix: null as RealFix | null,
  prev: null as RealFix | null,
  err: '' as string,
  /** Metres from the world origin — past ~5km the fog and chart canvases,
   *  which are baked around the spawn, run out of frame. */
  drift: 0,
  wake: null as { release: () => Promise<void> } | null,
};
/** Ask once, so the permission prompt happens on a real tap and we can report a
 *  refusal, then reboot the world anchored where the device actually is. */
function startRealDrive(): void {
  if (!navigator.geolocation) { real.err = 'NO GPS ON THIS DEVICE'; return; }
  real.err = 'WAITING FOR A FIX';
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const h = Number.isFinite(p.coords.heading as number) ? (p.coords.heading as number) : 0;
      // A reload, exactly as a curated drive does it: the world's origin is set
      // at boot and everything local — fog, chart, float precision — is baked
      // around it, so ARRIVING somewhere is cheaper and safer than moving the
      // world under a running session.
      location.href = `${location.pathname}?lat=${p.coords.latitude.toFixed(5)}`
        + `&lon=${p.coords.longitude.toFixed(5)}&h=${Math.round(h)}&cam=cab&real=1`;
    },
    (e) => {
      real.err = e.code === e.PERMISSION_DENIED ? 'LOCATION PERMISSION REFUSED'
        : e.code === e.POSITION_UNAVAILABLE ? 'NO POSITION AVAILABLE' : 'LOCATION TIMED OUT';
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
  );
}
/** Keep the screen awake. Dropped whenever the tab is hidden, so it has to be
 *  re-taken on the way back — a phone on a windscreen mount will background
 *  itself at every notification. */
async function takeWakeLock(): Promise<void> {
  try {
    const n = navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } };
    if (!n.wakeLock) return;
    real.wake = await n.wakeLock.request('screen');
  } catch { /* a refused wake lock is a dimmer screen, not a broken drive */ }
}
function beginRealWatch(): void {
  real.on = true;
  real.err = 'WAITING FOR A FIX';
  void takeWakeLock();
  addEventListener('visibilitychange', () => { if (!document.hidden && real.on) void takeWakeLock(); });
  real.watch = navigator.geolocation.watchPosition(
    (p) => {
      const c = p.coords;
      real.prev = real.fix;
      real.fix = {
        lat: c.latitude, lon: c.longitude, acc: c.accuracy,
        head: Number.isFinite(c.heading as number) ? (c.heading as number) : null,
        spd: Number.isFinite(c.speed as number) ? (c.speed as number) : null,
        at: performance.now(),
      };
      real.err = '';
    },
    (e) => { real.err = e.code === e.PERMISSION_DENIED ? 'LOCATION PERMISSION REFUSED' : 'GPS SIGNAL LOST'; },
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 1000 },
  );
}
/** Drive `state` from the fix. Returns false when there is nothing to go on,
 *  so the caller can leave the truck parked rather than teleport it to 0,0. */
function stepReal(dt: number): boolean {
  const f = real.fix;
  if (!f) return false;
  const [tx, tz] = toLocal(f.lat, f.lon);
  real.drift = Math.hypot(tx, tz);
  // Ease toward the fix rather than snapping to it. A consumer GPS reports at
  // 1Hz with metres of jitter; snapping makes a parked car twitch and a moving
  // one stutter between samples. 3.5/s covers a 1Hz sample without visible lag.
  const k = 1 - Math.exp(-3.5 * dt);
  state.x += (tx - state.x) * k;
  state.z += (tz - state.z) * k;
  // Heading: the receiver's own course when it has one — it only does above a
  // few km/h — else the bearing between the last two fixes, else hold. NEVER
  // derive it from jitter while stopped, or the truck spins on the spot.
  let want: number | null = null;
  if (f.head !== null && (f.spd ?? 0) > 1.4) want = (f.head * Math.PI) / 180;
  else if (real.prev) {
    const [px, pz] = toLocal(real.prev.lat, real.prev.lon);
    if (Math.hypot(tx - px, tz - pz) > 4) want = Math.atan2(tx - px, -(tz - pz));
  }
  if (want !== null) {
    const d = Math.atan2(Math.sin(want - state.heading), Math.cos(want - state.heading));
    state.heading += d * (1 - Math.exp(-2.5 * dt));
  }
  // Speed is reported, not integrated: the odometer and the engine note should
  // agree with the car you are sitting in, not with a differentiated position.
  // A STALE FIX IS NOT A SPEED. Holding the last reported figure leaves a
  // stationary truck reading 50km/h under a tunnel, which is the one number on
  // this screen a driver might actually believe. After three seconds without a
  // sample the speedo winds down, and the coordinate line says why.
  const stale = (performance.now() - f.at) / 1000;
  const target = stale > 3 ? 0
    : f.spd !== null ? Math.abs(f.spd)
    : Math.hypot(tx - state.x, tz - state.z) / Math.max(dt, 0.016);
  state.speed += (target - state.speed) * (1 - Math.exp(-2 * dt));
  // RE-ANCHOR, BUT ONLY AT A STANDSTILL. The chart and the fog are canvases
  // baked around the spawn and 12km wide; past about 5km out the minimap has
  // nothing left to draw. The 3D world, the roads and the survey are all
  // unbounded and carry on regardless, so the failure is a blank corner rather
  // than a broken drive — which is what makes it safe to wait. Re-anchoring
  // means a reload, and a reload at 100km/h is a black screen on a windscreen
  // mount, so it waits for you to stop. Survey progress is keyed by position
  // in localStorage and survives it.
  if (real.drift > 5000 && Math.abs(state.speed) < 2) {
    location.href = `${location.pathname}?lat=${f.lat.toFixed(5)}&lon=${f.lon.toFixed(5)}`
      + `&h=${Math.round(((state.heading * 180) / Math.PI + 360) % 360)}&cam=${camMode}&real=1`;
  }
  return true;
}
(window as unknown as { __drive?: object; __surfaceAt?: (x: number, z: number) => string }).__drive = state;
(window as unknown as { __surfaceAt?: (x: number, z: number) => string }).__surfaceAt = surfaceAt; // debug/test handles (read-only use)
(window as unknown as { __coverAt?: (x: number, z: number) => number | null }).__coverAt = sampleCover;
/** WHAT IS UNDER THAT PIXEL. Screen point in NDC (-1..1), and every mesh the
 *  ray passes through, nearest first — the only honest way to name a thing you
 *  can see but cannot find in the data. */
(window as unknown as { __pick?: object }).__pick = (nx: number, ny: number): object => {
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(nx, ny), camera);
  rc.far = 60000;
  const box = new THREE.Box3();
  return rc.intersectObjects(scene.children, true).slice(0, 6).map((h) => {
    box.setFromObject(h.object);
    const m = h.object as THREE.Mesh;
    return {
      dist: Math.round(h.distance),
      point: [Math.round(h.point.x), Math.round(h.point.y), Math.round(h.point.z)],
      span: Math.round(Math.max(box.max.x - box.min.x, box.max.z - box.min.z)),
      high: Math.round(box.max.y - box.min.y),
      tris: Math.round((m.geometry?.getAttribute('position')?.count ?? 0) / 3),
      parent: m.parent?.name ?? '',
      data: JSON.stringify(m.userData ?? {}).slice(0, 80),
    };
  });
};
/** THE BIGGEST THINGS IN THE SCENE, by world bounding box. When something
 *  enormous is standing in the sky, the fastest question is not "what could it
 *  be" but "what IS it" — so this walks the graph and names the offenders. */
(window as unknown as { __big?: object }).__big = (n = 8): object => {
  const box = new THREE.Box3();
  const out: Array<Record<string, unknown>> = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    box.setFromObject(m);
    if (!Number.isFinite(box.min.x)) return;
    const sx = box.max.x - box.min.x, sy = box.max.y - box.min.y, sz = box.max.z - box.min.z;
    out.push({
      span: Math.round(Math.max(sx, sz)), high: Math.round(sy),
      top: Math.round(box.max.y), bot: Math.round(box.min.y),
      at: [Math.round((box.min.x + box.max.x) / 2), Math.round((box.min.z + box.max.z) / 2)],
      name: m.name || (m.parent?.name ?? ''),
      mat: (m.material as THREE.Material & { name?: string })?.name ?? '',
      tris: (m.geometry.getAttribute('position')?.count ?? 0) / 3,
      data: Object.keys(m.userData ?? {}).join(','),
    });
  });
  return out.sort((a, b) => (b.high as number) - (a.high as number)).slice(0, n);
};
(window as unknown as { __wx?: object }).__wx = wx; // debug/test handle
(window as unknown as { __life?: object }).__life = () => ({
  roadCells: roadGrid.size,
  wallCells: wallGrid.size,
  sites: [...vegGrid.values()].reduce((n, c) => n + c.length, 0),
  cells: vegGrid.size,
  shown: Object.fromEntries(Object.entries(vegMeshes).map(([k, m]) => [k, m.count])),
  trunks: trunks.count,
  birds: birds.count,
  herd: { deer: herds[0].count, bison: herds[1].count, horse: herds[2].count },
});
// Is a point sealed inside a building footprint? (0 = free.) A test drops the
// car into the middle of every building it can find and asserts this stays 0.
(window as unknown as { __inside?: object }).__inside = (x?: number, z?: number): boolean =>
  (plotGrid.get(gkey(x ?? state.x, z ?? state.z)) ?? []).some((pts) => pointInPoly(x ?? state.x, z ?? state.z, pts));
(window as unknown as { __built?: object }).__built = (): object => ({ ...buildStats });
(window as unknown as { __plots?: object }).__plots = (): object =>
  [...new Set([...plotGrid.values()].flat())].map((pts) => {
    let cx = 0, cz = 0;
    for (const [x, z] of pts) { cx += x; cz += z; }
    return { x: cx / pts.length, z: cz / pts.length, n: pts.length };
  });
// What the HUD is currently pinning, and how far each one is — so a test can
// walk the car in and confirm nothing vanishes as it arrives.
(window as unknown as { __pins?: object }).__pins = (): object => {
  const sorted = [...pois.values()]
    .map((p) => ({ p, d: Math.hypot(p.x - state.x, p.z - state.z) }))
    .sort((a, b) => a.d - b.d);
  return {
    drawn: poiDraw.map((p) => ({ t: p.t, edge: p.edge, rng: p.rng, hidden: p.hid, world: p.w })),
    nearest: sorted.slice(0, 3).map((e) => +e.d.toFixed(1)),
    to: sorted[0] ? { x: sorted[0].p.x, z: sorted[0].p.z, name: sorted[0].p.name } : null,
    range: POI_RANGE,
  };
};
// Closest approach since the last call (and reset) — the "can you hit one?"
// measurement. Anything at or above HERD_CLEAR means nothing was ever touched.
(window as unknown as { __closest?: object }).__closest = (): object => {
  const d = herdClosest;
  herdClosest = Infinity;
  return { closest: +d.toFixed(2), clearance: HERD_CLEAR };
};
// Where the herd actually is, so a test can go and look at it.
(window as unknown as { __herd?: object }).__herd = (): object =>
  graze.map((c) => ({ x: +c.x.toFixed(1), z: +c.z.toFixed(1), sp: ['deer', 'bison', 'horse'][c.sp] }));
(window as unknown as { __probe?: object }).__probe = (x: number, z: number) =>
  ({ surface: surfaceAt(x, z), terrain: sampleHeight(x, z), road: roadHeightAt(x, z) });
/** The nearest drivable centreline: how far OUTSIDE its kerb this point is
 *  (negative on the carriageway), and the road's own surface height there. */
function roadEdge(x: number, z: number): { out: number; y: number; track: boolean } | null {
  let best: { out: number; y: number; track: boolean } | null = null;
  for (const seg of roadGrid.get(gkey(x, z)) ?? []) {
    if (seg.ya === undefined || seg.yb === undefined) continue;
    const dx = seg.bx - seg.ax, dz = seg.bz - seg.az;
    const t = clamp(((x - seg.ax) * dx + (z - seg.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const d = Math.hypot(x - (seg.ax + dx * t), z - (seg.az + dz * t));
    const out = d - seg.hw;
    if (!best || out < best.out) best = { out, y: seg.ya + (seg.yb - seg.ya) * t, track: !!seg.tk };
  }
  return best;
}
/** Where a tyre sits, as ONE CONTINUOUS FIELD.
 *
 * The old version switched between the road profile and the terrain on a hard
 * in/out test and added a different constant to each — so a wheel crossing a
 * kerb teleported. Measured on Ou Kaapse Weg: 1.09m in a single 0.5m step,
 * of which 0.35m was nothing but the two lift constants disagreeing. Those
 * constants are a RENDER z-order device (green under water under track under
 * road, so draped layers do not fight for depth); reusing them as a wheel
 * offset turned the draw order into a kerb the suspension had to climb.
 *
 * Now the road's surface is faired into the verge over KERB_FAIR metres with
 * a smoothstep, which is what a real shoulder is anyway.
 */
const KERB_FAIR = 2.2;
function tyreHeight(x: number, z: number, sk: Surface, near: number): number {
  const gnd = groundAt(x, z) + SURFACE.ground.lift;
  if (sk === 'water') {
    let g = groundAt(x, z);
    const sl = seaLevelY();
    if (sl !== null) g = Math.max(g, sl - 0.45);
    return g - WHEEL_R * 0.85 + SURFACE.water.lift;
  }
  const e = roadEdge(x, z);
  if (!e || e.out > KERB_FAIR) return gnd;
  // The tunnel guard, kept: a road chording under a hill must not drag the
  // wheels down to it just because the corridor is overhead.
  if (Math.abs(e.y - near) > 4) return gnd;
  const top = e.y + (e.track ? SURFACE.track.lift : SURFACE.road.lift);
  const t = clamp(1 - e.out / KERB_FAIR, 0, 1);
  return gnd + (top - gnd) * (t * t * (3 - 2 * t));
}
/** The height a WHEEL would sit at here — the same expression the suspension
 *  uses, so a probe can walk across a kerb and read the step the tyres feel
 *  rather than the one the eye reports. */
(window as unknown as { __rig?: object }).__rig = (): object => ({
  batt: +rig.batt.toFixed(3), solarKw: +rig.solarKw.toFixed(2), drawKw: +rig.drawKw.toFixed(2),
  tyre: +rig.tyre.toFixed(4), hull: +rig.hull.toFixed(4), susp: +rig.susp.toFixed(4),
  accel: +rig.accel.toFixed(2), svc: rig.svc,
});
(window as unknown as { __rigset?: object }).__rigset = (o: Partial<typeof rig>): void => { Object.assign(rig, o); };
// What a set of OSM tags is worth as a driving surface, and the physics it
// buys — so the tag ladder can be measured directly rather than inferred from
// how the truck felt.
(window as unknown as { __surfq?: object }).__surfq = (tags: Record<string, string>, track = false): object => {
  const q = wayQuality(tags, track);
  const p = surfaceFor(track ? 'track' : 'road', q);
  return { q: +q.toFixed(3), mu: +p.mu.toFixed(3), drag: +p.drag.toFixed(3), rough: +p.rough.toFixed(4), max: +p.max.toFixed(1) };
};
(window as unknown as { __contact?: object }).__contact = (x: number, z: number): object => {
  const sk = surfaceAt(x, z);
  const q = surfQ;                    // before anything else can re-resolve it
  const e = roadEdge(x, z);
  return {
    surface: sk, q: +q.toFixed(3), mu: +surfaceFor(sk, q).mu.toFixed(3),
    contact: +tyreHeight(x, z, sk, groundAt(x, z)).toFixed(3),
    base: +groundAt(x, z).toFixed(3), out: e ? +e.out.toFixed(2) : null,
  };
};
// The truck's ACTUAL dimensions, MEASURED off the built scene graph rather
// than off the arithmetic that was supposed to produce them. The vehicle panel
// in the menu shows these beside the sheet's targets, so the model can be
// checked against the reference instead of assumed to match it.
// Halo and beam cones are furniture, not bodywork, and are excluded.
const SPEC_TARGET = { length: 4.9, width: 2.15, height: 2.35, wheelbase: 3.1, clearance: 0.45 };
let specCache: Record<string, number> | null = null;
// The hull's own bounding box, in car-local metres — the elevations frame
// themselves from it, so a view is always the whole truck at a known scale.
const specBox = new THREE.Box3();
function truckSpec(): Record<string, number> {
  if (specCache) return specCache;
  // In the CAR's own frame, from vertices. A world-space Box3 of a yawed truck
  // on live suspension is an axis-aligned box around a rotated one, which
  // reported this hull 24cm taller than it is.
  const bb = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const child of car.children) {
    const geo = (child as THREE.Mesh).geometry;
    if (!geo || child === halo || beams.includes(child as THREE.Mesh)) continue;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) bb.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(child.matrix));
  }
  // The wheels hang off pivots that move with the suspension, so the hull box
  // stops at the axle plane; the tyres reach a radius below it.
  specBox.copy(bb);
  specBox.min.y = Math.min(specBox.min.y, -WHEEL_R);
  specBox.min.x = Math.min(specBox.min.x, -TRACK - WHEEL_W / 2);
  specBox.max.x = Math.max(specBox.max.x, TRACK + WHEEL_W / 2);
  const r = (n: number): number => +n.toFixed(2);
  return (specCache = {
    length: r(bb.max.z - bb.min.z),
    width: r(Math.max(bb.max.x - bb.min.x, TRACK * 2 + WHEEL_W)),
    height: r(bb.max.y + WHEEL_R),
    wheelbase: r(AXLE * 2),
    clearance: r(WHEEL_R + bb.min.y),
  });
}
(window as unknown as { __spec?: object }).__spec = (): object => ({ ...truckSpec(), spec: SPEC_TARGET });
// Open the vehicle bay on a named elevation, so a test can capture all five
// and they can be compared against the sheet side by side.
// The curated starts, and a way to take one without a tap.
// The slope the wheels are actually on, and the sideways creep it is causing.
(window as unknown as { __grade?: object }).__grade = (): object => ({
  pitch: +((gradePitch * 180) / Math.PI).toFixed(1),
  roll: +((gradeRoll * 180) / Math.PI).toFixed(1),
  slide: +slideV.toFixed(2),
  speed: +state.speed.toFixed(2),
  grip: +groundedF.toFixed(2),
});
// Force the near plane (0 restores automatic) so a test can measure what the
// depth-precision fix is actually worth.
// What the road grid actually holds, by tier — the difference between "there
// are no tracks here" and "the classifier never fired".
(window as unknown as { __tiers?: object }).__tiers = (): object => {
  const seen = new Set<Seg>();
  for (const arr of roadGrid.values()) for (const g of arr) seen.add(g);
  let road = 0, track = 0;
  let sample: [number, number] | null = null;
  for (const g of seen) {
    if (g.tk) { track++; if (!sample) sample = [(g.ax + g.bx) / 2, (g.az + g.bz) / 2]; } else road++;
  }
  return { roadSegs: road, trackSegs: track, sample };
};
(window as unknown as { __susp?: object }).__susp = (): object => dbgSusp;
(window as unknown as { __near?: object }).__near = (n?: number): object => {
  nearLock = n ?? 0;
  return { near: camera.near, lock: nearLock };
};
(window as unknown as { __odo?: object }).__odo = (): object => ({ total: Math.round(odo.total), trip: Math.round(odo.trip) });
(window as unknown as { __drives?: object }).__drives = (n?: number): object => {
  if (n === undefined) return DRIVES.map((d, i) => ({ i, name: d.name, sub: d.sub, lat: d.lat, lon: d.lon, h: d.h }));
  const d = DRIVES[n];
  if (!d) return { error: `no drive ${n}` };
  startDrive(d);
  return { going: d.name };
};
(window as unknown as { __view?: object }).__view = (id?: string): object => {
  if (id !== undefined) {
    const i = VIEWS.findIndex((v) => v.id === id.toUpperCase());
    if (i < 0) return { error: `no such view: ${id}`, views: VIEWS.map((v) => v.id) };
    menuTab = 0;
    vehView = i;
  }
  return { view: VIEWS[vehView].id, views: VIEWS.map((v) => v.id) };
};
// How much of the frame the truck actually occupies. Chase framing is easy to
// get wrong by eye — on a portrait phone the 55° fov is VERTICAL, so the
// horizontal one is only ~30° and a stand-off that looks generous in plan puts
// the truck across half the screen. Percentages, not vibes.
(window as unknown as { __frame?: object }).__frame = (): object => {
  // The HULL's own extents, in car-local space. `setFromObject` would swallow
  // the halo ring and the 26m beam cones and report 200%-of-screen nonsense.
  const v = new THREE.Vector3();
  let minX = 9, maxX = -9, minY = 9, maxY = -9;
  for (const x of [-1.08, 1.08]) for (const y of [-WHEEL_R, 1.9]) for (const z of [-2.45, 2.45]) {
    v.set(x, y, z).applyMatrix4(car.matrixWorld).project(camera);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  return {
    widthPct: Math.round(((maxX - minX) / 2) * 100),
    heightPct: Math.round(((maxY - minY) / 2) * 100),
    centreY: Math.round(((minY + maxY) / 2) * 100), // -100 = bottom edge, +100 = top
    dist: +Math.hypot(camera.position.x - car.position.x, camera.position.z - car.position.z).toFixed(1),
    lift: +(camera.position.y - car.position.y).toFixed(1),
  };
};
// Fog-of-war opacity at a world point (0 = fully cleared, 1 = untouched).
(window as unknown as { __fogAt?: object }).__fogAt = (x: number, z: number): number => {
  const px = Math.round(((x + FOG_SPAN / 2) / FOG_SPAN) * FOG_PX);
  const pz = Math.round(FOG_PX - ((z + FOG_SPAN / 2) / FOG_SPAN) * FOG_PX);
  return fogCtx.getImageData(clamp(px, 0, FOG_PX - 1), clamp(pz, 0, FOG_PX - 1), 1, 1).data[3] / 251;
};
// Every tunnel shell vertex that stands proud of the terrain it should be under.
(window as unknown as { __tunnelBreach?: object }).__tunnelBreach = (): object => {
  let meshes = 0, worst = -Infinity, breaching = 0;
  worldGroup.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh || !o.userData.tunnel) return;
    meshes++;
    const p = ((o as THREE.Mesh).geometry.attributes.position as THREE.BufferAttribute);
    let bad = false;
    for (let i = 0; i < p.count; i++) {
      const over = p.getY(i) - sampleHeight(p.getX(i), p.getZ(i));
      if (over > worst) worst = over;
      if (over > 0.5) bad = true;
    }
    if (bad) breaching++;
  });
  return { meshes, breaching, worstAboveGround: worst === -Infinity ? null : +worst.toFixed(2) };
};
// What the tyres are doing: sideways velocity, how much of it is a slide, and
// what the drivetrain thinks its own speed is.
(window as unknown as { __slip?: object }).__slip = (): object => ({
  slideV: +slideV.toFixed(2), skid: +skid.toFixed(3), grip: +groundedF.toFixed(2),
  rev: +engRev.toFixed(2), gear: engGear,
  kmh: Math.round(Math.abs(state.speed) * 3.6),
  roll: +((gradeRoll * 180) / Math.PI).toFixed(1),
});
// The road corridor at a point: the raw heightfield, what the cut allows, and
// therefore how much ground was taken out of the carriageway's airspace.
(window as unknown as { __cut?: object }).__cut = (x?: number, z?: number): object => {
  const px = x ?? state.x, pz = z ?? state.z;
  const raw = sampleHeight(px, pz), ceil = roadCeiling(px, pz);
  return { raw: +raw.toFixed(2), ceiling: ceil === null ? null : +ceil.toFixed(2),
    ground: +groundAt(px, pz).toFixed(2), cut: ceil === null ? 0 : +Math.max(0, raw - ceil).toFixed(2),
    pending: terrainDirty.size };
};
// What the bridge builder actually built.
(window as unknown as { __span?: object }).__span = (): object => ({
  ...spanStats, signAt: spanStats.signAt.length, railM: Math.round(spanStats.railM),
  deckM: Math.round(spanStats.deckM), maxDaylight: +spanStats.maxDaylight.toFixed(1),
});
/** The RENDERED terrain surface at (x,z) — a raycast against the actual
 *  meshes, which is not the same thing as groundAt: the mesh linearly
 *  interpolates between vertices, and the road-corridor cut lives in the
 *  field, not the triangles. The difference between these two numbers is
 *  exactly the burial bug this handle exists to measure. */
const meshRay = new THREE.Raycaster();
const meshRayO = new THREE.Vector3(), meshRayD = new THREE.Vector3(0, -1, 0);
function meshHeightAt(x: number, z: number): number | null {
  meshRayO.set(x, 4000, z);
  meshRay.set(meshRayO, meshRayD);
  const hits = meshRay.intersectObjects([...terrainMeshes.values()], false);
  return hits.length ? +(4000 - hits[0].distance).toFixed(2) : null;
}
(window as unknown as { __meshAt?: object }).__meshAt = meshHeightAt;
/** The sky's whole case file: where the sun is, what hour the world thinks it
 *  is, and whether the weather is a measurement or the synthetic chain. */
(window as unknown as { __sky?: object }).__sky = (): object => ({
  time: TIME_MODES[timeMode],
  utc: worldNow().toISOString(),
  sunAltDeg: +((sunAlt * 180) / Math.PI).toFixed(1),
  sunAzDeg: +((((sunAz * 180) / Math.PI) % 360 + 360) % 360).toFixed(0),
  dayF: +dayF.toFixed(3),
  night: sunAlt < 0,
  live: live.on,
  tempC: live.tempC, windKmh: live.windKmh, windDeg: live.windDeg, wmo: live.code,
  sky: wx.sky, cloud: +wx.cloud.toFixed(2), rain: +wx.rain.toFixed(2),
});
/** Which palette the world settled on, and whether real cover chose it or the
 *  latitude guess is still standing in. */
(window as unknown as { __biome?: object }).__biome = (): object =>
  ({ name: biome.name, fromCover: biomeSettled });
/** What the world is actually made of around the car, straight off WorldCover.
 *  The class under the wheels, and the mix over a radius — which is the number
 *  the biome is chosen from, so it is the one worth being able to read. */
(window as unknown as { __cover?: object }).__cover = (radius = 3000, step = 120): object => {
  const here = sampleCover(state.x, state.z);
  const hist = new Map<number, number>();
  let n = 0;
  for (let dz = -radius; dz <= radius; dz += step) {
    for (let dx = -radius; dx <= radius; dx += step) {
      if (dx * dx + dz * dz > radius * radius) continue;
      const c = sampleCover(state.x + dx, state.z + dz);
      if (c === null) continue;
      hist.set(c, (hist.get(c) ?? 0) + 1); n++;
    }
  }
  return {
    tiles: coverTiles.size, asked: coverAsked.size,
    here: here === null ? null : `${here} ${COVER_NAME[here] ?? '?'}`,
    samples: n,
    mix: [...hist.entries()].sort((a, b) => b[1] - a[1])
      .map(([c, k]) => `${COVER_NAME[c] ?? c} ${((k / Math.max(1, n)) * 100).toFixed(0)}%`),
  };
};
/** What the elevation source got wrong here, and how much of it we repaired. */
(window as unknown as { __dem?: object }).__dem = (): object => ({
  tilesRepaired: demFixes.length,
  pixels: demFixes.reduce((a, f) => a + f.n, 0),
  per: demFixes.map((f) => f.n),
});
(window as unknown as { __tstats?: object }).__tstats = (): object => ({
  heightTiles: heightTiles.size, meshes: terrainMeshes.size, dirty: terrainDirty.size,
  roadCells: roadGrid.size, seenWays: seenWays.size, unbuilt,
  osmDone: osmDone.size, inFlight: osmInFlight, queued: osmQueue.length,
});
/** IS THE ROAD AHEAD THERE YET? Walks the car's heading in `step` metres and
 *  reports, per sample, whether the vector tile covering that point has
 *  finished loading. The whole streaming question in one array: a run of
 *  `true` is road you can drive into, the first `false` is where the world
 *  runs out in front of you. */
(window as unknown as { __ahead?: object }).__ahead = (upTo = 2500, step = 250): object => {
  const out: boolean[] = [];
  for (let d = 0; d <= upTo; d += step) {
    const x = state.x + Math.sin(state.heading) * d;
    const z = state.z - Math.cos(state.heading) * d;
    const [la, lo] = localToLatLon(x, z);
    const [tx, ty] = tileAt(la, lo, OSM_Z);
    out.push(osmDone.has(`${tx}/${ty}`));
  }
  const firstGap = out.indexOf(false);
  return { step, cover: out, ready: firstGap < 0 ? upTo : firstGap * step, inFlight: osmInFlight, queued: osmQueue.length };
};
/** The sea's whole case file: anchored where, live or stood down, and why. */
(window as unknown as { __sea?: object }).__sea = (force?: boolean): object => {
  if (force === true) { dryAt = null; sea.position.y = seaSurfaceAbs() - baseElev; }  // re-flood, to reproduce the bug
  return {
    seaOn, y: +sea.position.y.toFixed(1), live: seaLevelY() !== null, baseElev: +baseElev.toFixed(1),
    datum: seaDatum === null ? null : +seaDatum.toFixed(2), datumN: seaDatumN,
    dryAt: dryAt ? [Math.round(dryAt[0]), Math.round(dryAt[1])] : null,
    dryDist: dryAt ? Math.round(Math.hypot(dryAt[0] - state.x, dryAt[1] - state.z)) : null,
  };
};
/** The inverse of __bury: where the ROAD stands above the terrain it should be
 *  lying on. Also reports whether the ground under each offender was inside a
 *  loaded height tile when the ribbon was built, because sampleHeight answers
 *  0 — spawn level — for anywhere it has no tile, and a road built against
 *  that fiction floats by exactly the depth of the basin it is crossing. */
(window as unknown as { __float?: object }).__float = (name: string): object => {
  const seen = new Set<Seg>();
  const rows: Array<{ at: number[]; lift: number; tiled: boolean }> = [];
  for (const arr of roadGrid.values()) for (const s of arr) {
    if (s.nm !== name || s.tn || s.ya === undefined || seen.has(s)) continue;
    seen.add(s);
    const mx = (s.ax + s.bx) / 2, mz = (s.az + s.bz) / 2;
    const road = ((s.ya as number) + (s.yb as number)) / 2;
    const g = sampleHeight(mx, mz);
    // Is there a height tile covering this point at all?
    let tiled = false;
    for (const t of heightTiles.values()) {
      if (mx >= t.xs && mz >= t.zs && mx < t.xs + t.w && mz < t.zs + t.h) { tiled = true; break; }
    }
    rows.push({ at: [Math.round(mx), Math.round(mz)], lift: +(road - g).toFixed(1), tiled });
  }
  const lifts = rows.map((r) => r.lift).sort((a, b) => a - b);
  const bad = rows.filter((r) => r.lift > 4);
  return {
    name, segs: rows.length,
    lift: lifts.length ? { min: lifts[0], med: lifts[lifts.length >> 1], max: lifts[lifts.length - 1] } : null,
    over4m: bad.length,
    pct: rows.length ? +(bad.length / rows.length * 100).toFixed(1) : 0,
    untiled: rows.filter((r) => !r.tiled).length,
    worst: rows.slice().sort((a, b) => b.lift - a.lift).slice(0, 5),
  };
};
/** Walk a named road and report where the rendered terrain stands above the
 *  carriageway — the "road buried in the hillside" defect, quantified. */
(window as unknown as { __bury?: object }).__bury = (name: string): object => {
  const segs: Seg[] = [];
  const seen = new Set<Seg>();
  for (const arr of roadGrid.values()) for (const s of arr) {
    if (s.nm !== name || s.tn || s.ya === undefined || seen.has(s)) continue;
    seen.add(s); segs.push(s);
  }
  let n = 0, buried = 0, worst = 0, worstAt: number[] | null = null, sum = 0;
  for (const s of segs) {
    const L = Math.hypot(s.bx - s.ax, s.bz - s.az);
    for (let t = 0; t <= 1; t += Math.max(0.2, 24 / Math.max(L, 1))) {
      const x = s.ax + (s.bx - s.ax) * t, z = s.az + (s.bz - s.az) * t;
      const top = (s.ya as number) + ((s.yb as number) - (s.ya as number)) * t + 0.6;
      const m = meshHeightAt(x, z);
      if (m === null) continue;
      n++;
      const d = m - top;
      if (d > 0.05) { buried++; sum += d; if (d > worst) { worst = d; worstAt = [+x.toFixed(0), +z.toFixed(0)]; } }
    }
  }
  return { name, segs: segs.length, samples: n, buried, pct: n ? +(buried / n * 100).toFixed(1) : 0,
    meanDepth: buried ? +(sum / buried).toFixed(2) : 0, worst: +worst.toFixed(2), worstAt };
};
/** THE CROSS-SECTION. `__bury` and `__float` both walk the centreline, and a
 *  road on a hillside is a thing that goes wrong ACROSS its width — the uphill
 *  bank, the downhill fall, the cut, the deck. This cuts a transect at every
 *  sampled point and reports what each layer says at each offset, so a delta
 *  can be attributed instead of guessed at.
 *
 *  `slope` is the terrain's own cross-fall at the road (metres per metre) —
 *  the number every cross-slope defect scales with, and the one thing no
 *  existing handle reports. */
(window as unknown as { __xsec?: object }).__xsec = (name?: string, step = 60): object => {
  const seen = new Set<Seg>();
  const segs: Seg[] = [];
  for (const arr of roadGrid.values()) for (const s of arr) {
    if (s.tn || s.ya === undefined || seen.has(s)) continue;
    if (name !== undefined && s.nm !== name) continue;
    seen.add(s); segs.push(s);
  }
  const OFF = [-30, -20, -12, -6, 0, 6, 12, 20, 30];
  const rows: Array<Record<string, unknown>> = [];
  let along = 0;
  for (const s of segs) {
    const L = Math.hypot(s.bx - s.ax, s.bz - s.az) || 1;
    along += L;
    if (along < step) continue;
    along = 0;
    const x = (s.ax + s.bx) / 2, z = (s.az + s.bz) / 2;
    const ux = (s.bx - s.ax) / L, uz = (s.bz - s.az) / L;
    const px = -uz, pz = ux;                       // across the carriageway
    const road = ((s.ya as number) + (s.yb as number)) / 2;
    const cut: Array<number | null> = [], fld: number[] = [], msh: Array<number | null> = [];
    for (const o of OFF) {
      const qx = x + px * o, qz = z + pz * o;
      fld.push(+sampleHeight(qx, qz).toFixed(2));
      const c = roadCeiling(qx, qz);
      cut.push(c === null ? null : +c.toFixed(2));
      const m = meshHeightAt(qx, qz);
      msh.push(m === null ? null : +(m - road).toFixed(2));
    }
    // The cross-fall, and the `daylight` the deck/pier classifier derives —
    // recomputed here exactly as `ribbon` does it, from the centreline. The
    // authority on what was actually BUILT is `__span`; this is the input.
    const hw = s.hw + 1.2;
    const gL = sampleHeight(x + px * hw, z + pz * hw);
    const gR = sampleHeight(x - px * hw, z - pz * hw);
    // THE NUMBER. `roadCeiling` is a MIN over every segment in reach, so a
    // road 30m away and 12m lower carves the ground out from under THIS one.
    // Its own bed asks for road−0.3; anything below that was taken by a
    // neighbour, and the road is left standing over the hole on a 3.6m skirt.
    const ownBed = road - 0.3;
    const c0 = roadCeiling(x, z);
    // WHICH segment won the min, and where it stands relative to this road:
    // `d` its plan distance, `dy` how far below. A neighbour that is far in
    // plan AND far below is a road on a different bench — it has no business
    // excavating this one, and if that is what keeps winning, the min is the
    // defect rather than the mesh that samples it.
    let won: { d: number; dy: number } | null = null;
    {
      let best = Infinity;
      const R = CUT_SLACK + CUT_TAIL + 2;
      for (let cx = Math.floor((x - R) / GRID); cx <= Math.floor((x + R) / GRID); cx++) {
        for (let cz = Math.floor((z - R) / GRID); cz <= Math.floor((z + R) / GRID); cz++) {
          for (const q of roadGrid.get(`${cx},${cz}`) ?? []) {
            if (q.tn || q.ya === undefined || q.yb === undefined) continue;
            const qdx = q.bx - q.ax, qdz = q.bz - q.az;
            const qt = clamp(((x - q.ax) * qdx + (z - q.az) * qdz) / (qdx * qdx + qdz * qdz || 1), 0, 1);
            const qd = Math.hypot(x - (q.ax + qdx * qt), z - (q.az + qdz * qt));
            const out = qd - (q.hw + 0.6);
            if (q.tk ? out > CUT_REACH * 0.45 : out > CUT_SLACK + CUT_TAIL) continue;
            const qy = q.ya + (q.yb - q.ya) * qt;
            const ceil = q.tk
              ? qy - 0.3 + Math.max(0, out) * CUT_BATTER * 1.7
              : qy - 0.3 + Math.min(Math.max(out, 0), CUT_SLACK) * CUT_WASH
                + Math.max(0, out - CUT_SLACK) * CUT_BATTER;
            if (ceil < best) { best = ceil; won = { d: +qd.toFixed(1), dy: +(road - qy).toFixed(1) }; }
          }
        }
      }
    }
    rows.push({
      at: [Math.round(x), Math.round(z)], nm: s.nm ?? null,
      road: +road.toFixed(2),
      undercut: c0 === null ? 0 : +Math.max(0, ownBed - c0).toFixed(2),
      by: won,
      slope: +(Math.abs(gL - gR) / (2 * hw)).toFixed(2),
      daylight: +(road + 0.22 - sampleHeight(x, z)).toFixed(2),
      fieldRel: fld.map((v) => +(v - road).toFixed(2)),   // terrain − road
      cutRel: cut.map((v) => (v === null ? null : +(v - road).toFixed(2))),
      meshRel: msh,                                       // rendered mesh − road
    });
  }
  const dl = rows.map((r) => r.daylight as number).sort((a, b) => a - b);
  const sl = rows.map((r) => r.slope as number).sort((a, b) => a - b);
  const uc = rows.map((r) => r.undercut as number).sort((a, b) => a - b);
  // INDEPENDENT of `roadCeiling` — a raycast against the triangles that were
  // actually drawn, at the centreline and just outside each kerb. `undercut`
  // is computed from the same function the fix changes and would agree with
  // itself; this asks the rendered world instead. How far the ground has
  // dropped away beneath the carriageway is the defect, in one number.
  const kerb = OFF.indexOf(0);
  const gap = rows.flatMap((r) => {
    const m = r.meshRel as Array<number | null>;
    return [m[kerb], m[kerb - 1], m[kerb + 1]].filter((v): v is number => v !== null).map((v) => -v);
  }).sort((a, b) => a - b);
  return {
    offsets: OFF, samples: rows.length,
    slope: sl.length ? { med: sl[sl.length >> 1], max: sl[sl.length - 1] } : null,
    daylight: dl.length ? { med: dl[dl.length >> 1], max: dl[dl.length - 1] } : null,
    undercut: uc.length ? { med: uc[uc.length >> 1], max: uc[uc.length - 1] } : null,
    meshGap: gap.length ? { med: +gap[gap.length >> 1].toFixed(2), max: +gap[gap.length - 1].toFixed(2) } : null,
    // Past APRON (3.6m) the drawn skirt cannot reach the drawn ground: open air.
    gapOverApron: gap.length ? +(gap.filter((v) => v > 3.6).length / gap.length * 100).toFixed(1) : 0,
    // Past APRON (3.6m) the skirt cannot reach the ground the cut has left.
    overApron: rows.length ? +(rows.filter((r) => (r.undercut as number) > 3.6).length / rows.length * 100).toFixed(1) : 0,
    deckPct: rows.length ? +(rows.filter((r) => (r.daylight as number) > 3).length / rows.length * 100).toFixed(1) : 0,
    pierPct: rows.length ? +(rows.filter((r) => (r.daylight as number) > 5).length / rows.length * 100).toFixed(1) : 0,
    rows: rows.slice(0, 24),
  };
};
/** The sign atlas as drawn, so the panels can be checked without hunting for
 *  one in the world and photographing a different sign by mistake. */
(window as unknown as { __signtex?: object }).__signtex = (): string =>
  (signTex.image as HTMLCanvasElement).toDataURL();
/** Every guard rail and every road centreline, so a probe can check that no
 *  barrier has been drawn across a turning. */
(window as unknown as { __rails?: object }).__rails = (): number[][] => {
  const out: number[][] = [], seen = new Set<Seg>();
  for (const arr of wallGrid.values()) for (const s of arr) {
    if (!s.sl || seen.has(s)) continue;
    seen.add(s);
    out.push([+s.ax.toFixed(2), +s.az.toFixed(2), +s.bx.toFixed(2), +s.bz.toFixed(2)]);
  }
  return out;
};
/** Solid BUILDING edges — the other half of wallGrid, which `__rails` filters
 *  out. A probe that wants to measure what a real crash costs needs something
 *  to crash into, and a guard rail is deliberately the cheap case. */
(window as unknown as { __walls?: object }).__walls = (): number[][] => {
  const out: number[][] = [], seen = new Set<Seg>();
  for (const arr of wallGrid.values()) for (const s of arr) {
    if (s.sl || seen.has(s)) continue;
    seen.add(s);
    out.push([+s.ax.toFixed(2), +s.az.toFixed(2), +s.bx.toFixed(2), +s.bz.toFixed(2)]);
  }
  return out;
};
(window as unknown as { __roadsegs?: object }).__roadsegs = (): number[][] => {
  const out: number[][] = [], seen = new Set<Seg>();
  for (const arr of roadGrid.values()) for (const s of arr) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push([+s.ax.toFixed(2), +s.az.toFixed(2), +s.bx.toFixed(2), +s.bz.toFixed(2)]);
  }
  return out;
};
/** Every hazard board placed so far, so a probe can stand in front of one. */
(window as unknown as { __signs?: object }).__signs = (): object => spanStats.signAt;
// The job: phase, both waypoints, and how far is left.
(window as unknown as { __mission?: object }).__mission = (): object => ({
  id: mission?.id ?? null, phase: missionPhase, ready: missionReady,
  giver: missionGiver ? { pinned: !!missionGiver.pinned, d: +Math.hypot(missionGiver.x - state.x, missionGiver.z - state.z).toFixed(1) } : null,
  dest: missionDest ? { pinned: !!missionDest.pinned, listed: pois.has(missionDest.name), d: +Math.hypot(missionDest.x - state.x, missionDest.z - state.z).toFixed(1) } : null,
  best: missionBest === Infinity ? null : Math.round(missionBest),
});
(window as unknown as { __accept?: object }).__accept = (): void => acceptMission(performance.now());
// The survey: the road under the wheels, and every road worth claiming.
(window as unknown as { __survey?: object }).__survey = (): object => {
  const here = surveyHere();
  const roads = [...survey.values()].filter(surveyEligible).sort((a, b) => b.len - a.len).map((r) => ({
    name: r.name, len: Math.round(r.len), cps: r.cps.length, got: r.got,
    frac: +(r.got / r.cps.length).toFixed(2), surveyed: surveyed(r), claimed: r.claimed, track: r.track,
  }));
  return {
    here: here ? { name: here.r.name, got: here.r.got, cps: here.r.cps.length,
      frac: +here.frac.toFixed(2), surveyed: here.ready, claimed: here.r.claimed } : null,
    roads: roads.slice(0, 20),
    totals: { roads: roads.length, claimed: roads.filter((r) => r.claimed).length,
      cps: roads.reduce((s, r) => s + r.cps, 0), got: roads.reduce((s, r) => s + r.got, 0) },
  };
};
/** Every checkpoint of a named road, for a probe that wants to drive them. */
(window as unknown as { __cps?: object }).__cps = (name: string): object =>
  (survey.get(name)?.cps ?? []).map((c) => ({ x: +c.x.toFixed(1), z: +c.z.toFixed(1), got: c.got }));
/** Checkpoint marker visibility, and how many markers a frame actually put on
 *  screen — the only honest answer to "why can't I see them". */
(window as unknown as { __setcpv?: object }).__setcpv = (v: number): void => { cpVis = v; };
(window as unknown as { __menutab?: object }).__menutab = (t?: number | null): number | null => {
  if (t !== undefined) menuTab = t;
  return menuTab;
};
(window as unknown as { __setcam?: object }).__setcam = (m: CamMode): void => setCam(m);
(window as unknown as { __zoom?: object }).__zoom = (z: number): void => { zoomT = clamp(z, ZOOM_MIN, ZOOM_MAX); };
/** How much GROUND the camera actually covers, by unprojecting the screen
 *  corners onto the car's ground plane. The honest answer to "how far out can
 *  I see", which no constant in this file states directly. */
(window as unknown as { __far?: object }).__far = (): object =>
  ({ tiles: farMeshes.size, shown: farGroup.visible, radius: Math.round(viewRadius()), farPlane: camera.far });
(window as unknown as { __viewSpan?: object }).__viewSpan = (): object => {
  const y0 = groundAt(state.x, state.z);
  const hit = (nx: number, ny: number): [number, number] | null => {
    const a = new THREE.Vector3(nx, ny, -1).unproject(camera);
    const bq = new THREE.Vector3(nx, ny, 1).unproject(camera);
    const d = bq.sub(a);
    if (Math.abs(d.y) < 1e-6) return null;
    const t = (y0 - a.y) / d.y;
    if (t < 0) return null;                     // that corner looks at the sky
    return [a.x + d.x * t, a.z + d.z * t];
  };
  const c = [hit(-1, -1), hit(1, -1), hit(-1, 1), hit(1, 1)];
  const got = c.filter(Boolean) as Array<[number, number]>;
  if (got.length < 2) return { wide: null, deep: null, note: 'horizon in frame' };
  const xs = got.map((q) => q[0]), zs = got.map((q) => q[1]);
  return {
    wide: Math.round(Math.max(...xs) - Math.min(...xs)),
    deep: Math.round(Math.max(...zs) - Math.min(...zs)),
    corners: got.length,
  };
};
/** Real drive's whole state, and a way to inject fixes so the mode can be
 *  tested without a car: __real() reads, __feed(lat,lon,head,spd) writes one. */
(window as unknown as { __real?: object }).__real = (): object => ({
  on: real.on, err: real.err, drift: Math.round(real.drift),
  fix: real.fix ? { acc: real.fix.acc, head: real.fix.head, spd: real.fix.spd, ageMs: Math.round(performance.now() - real.fix.at) } : null,
  car: [Math.round(state.x), Math.round(state.z)],
  headingDeg: Math.round(((state.heading * 180) / Math.PI + 360) % 360),
  kmh: +(state.speed * 3.6).toFixed(1),
});
(window as unknown as { __toll?: object }).__toll = (x: number, z: number): [number, number] => localToLatLon(x, z);
(window as unknown as { __feed?: object }).__feed =
  (lat: number, lon: number, head: number | null = null, spd: number | null = null, acc = 8): void => {
    real.on = true;
    real.prev = real.fix;
    real.fix = { lat, lon, acc, head, spd, at: performance.now() };
    real.err = '';
  };
(window as unknown as { __cpdraw?: object }).__cpdraw = (): number => cpDraw.length;
(window as unknown as { __cpwhy?: object }).__cpwhy = (): object => cpCull;
/** A named road's drivable centrelines, so a test can traverse the ROAD rather
 *  than teleport onto the checkpoints and grade its own homework. */
(window as unknown as { __wayGeom?: object }).__wayGeom = (name: string): number[][] => {
  const out: number[][] = [], seen = new Set<string>();
  for (const arr of roadGrid.values()) for (const s of arr) {
    if (s.nm !== name) continue;
    const k = `${s.ax.toFixed(1)},${s.az.toFixed(1)},${s.bx.toFixed(1)},${s.bz.toFixed(1)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([+s.ax.toFixed(2), +s.az.toFixed(2), +s.bx.toFixed(2), +s.bz.toFixed(2)]);
  }
  return out;
};
(window as unknown as { __camPos?: object }).__camPos = (): number[] =>
  [camera.position.x, camera.position.y, camera.position.z];
// The way under the wheels, and the coordinate the HUD reports.
(window as unknown as { __way?: object }).__way = (): object => {
  const [la, lo] = localToLatLon(state.x, state.z);
  return { way: wayAt(state.x, state.z), lat: +la.toFixed(5), lon: +lo.toFixed(5) };
};
// What stands between the truck and the drop at (x,z): the nearest parapet
// segment, how far off it is, and how high its top sits. A rail that renders
// but has no wall segment is the failure this exists to catch.
(window as unknown as { __barrier?: object }).__barrier = (x?: number, z?: number): object => {
  const px = x ?? state.x, pz = z ?? state.z;
  let near = Infinity, top: number | null = null, count = 0;
  let at: [number, number] | null = null;
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    for (const seg of wallGrid.get(`${Math.floor(px / GRID) + cx},${Math.floor(pz / GRID) + cz}`) ?? []) {
      count++;
      const [ax, az] = closestOnSeg(px, pz, seg);
      const d = Math.hypot(px - ax, pz - az);
      if (d < near) { near = d; top = seg.ya ?? null; at = [ax, az]; }
    }
  }
  return { walls: count, nearest: near === Infinity ? null : +near.toFixed(2),
    at, topY: top === null ? null : +top.toFixed(2), carR: CAR_R };
};
(window as unknown as { __roadDir?: (x: number, z: number) => [number, number] | null }).__roadDir = (x, z) => {
  let best: Seg | null = null, bd = Infinity;
  for (const seg of roadGrid.get(gkey(x, z)) ?? []) {
    const [cx, cz] = closestOnSeg(x, z, seg);
    const d = Math.hypot(x - cx, z - cz);
    if (d < bd) { bd = d; best = seg; }
  }
  if (!best) return null;
  const dx = best.bx - best.ax, dz = best.bz - best.az, l = Math.hypot(dx, dz) || 1;
  return [dx / l, dz / l];
};

// ── input: keyboard + a VISIBLE one-thumb stick, second finger = brake ──
const keys = new Set<string>();
addEventListener('keydown', (e) => { keys.add(e.key.toLowerCase()); });
addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); });

// The stick appears WHERE the thumb lands (no fixed gutter to find blind),
// with a base ring + nub so the current input is always visible. Dead zone
// then a squared response curve: fine steering near centre, full lock at the
// rim. Any second finger anywhere is the brake — the two-finger gesture you
// make instinctively when something is coming up fast.
const STICK_R = 56, STICK_DEAD = 8;
function stickEl(size: number, style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed', width: `${size}px`, height: `${size}px`, borderRadius: '50%',
    transform: 'translate(-50%, -50%)', pointerEvents: 'none', display: 'none', zIndex: '12',
  } as Partial<CSSStyleDeclaration>, style);
  document.body.appendChild(el);
  return el;
}
const stickBase = stickEl(STICK_R * 2 + 12, { border: '1.5px solid rgba(245,196,83,0.4)', background: 'rgba(8,12,20,0.25)' });
// HOLLOW. A solid disc was fine parked in a corner, but the nub now rests on
// the truck in the chart view and a filled one blanked out the vehicle it is
// steering — you could see the ring and not the thing inside it. A heavy rim
// over a wash of colour reads just as clearly as an input and lets the truck,
// its halo and its heading show straight through.
const stickNub = stickEl(46, {
  background: 'rgba(245,196,83,0.16)', border: '3px solid rgba(245,196,83,0.8)',
  boxSizing: 'border-box', boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
});
let stick: { id: number; x0: number; y0: number; dx: number; dy: number } | null = null;
let brakeId: number | null = null;
// The chart (top) view pans and zooms like a map: the stick lives PINNED at
// bottom-right there; dragging anywhere else pans, pinching zooms, and the
// wheel zooms on desktop. Chase keeps the appear-where-the-thumb-lands stick
// with second-finger brake.
let panX = 0, panZ = 0, zoomT = 1, zoomCur = 1;
const panPtrs = new Map<number, { x: number; y: number }>();
// ON THE TRUCK, not in the corner. Pinned bottom-right the stick sat straight
// on top of the tachometer and read as a lens flare rather than a control. In
// the chart view the vehicle already carries a ring — the halo — at the exact
// size of the stick base, so the two become one object: the thing you steer and
// the control that steers it are in the same place, and your thumb is over the
// truck rather than over the instruments. Clamped inboard so a hard pan can
// never leave the stick off-screen or under the corner readouts.
const stickVec = new THREE.Vector3();
const stickHome = (): { x: number; y: number } => {
  car.updateWorldMatrix(true, false);
  stickVec.setFromMatrixPosition(car.matrixWorld).project(camera);
  const m = STICK_R + 14;
  // Behind the camera projects to a mirrored point; treat it as off-screen.
  const off = stickVec.z > 1;
  let x = clamp((off ? -stickVec.x : stickVec.x) * 0.5 * innerWidth + innerWidth / 2, m, innerWidth - m);
  const y = clamp((0.5 - (off ? -stickVec.y : stickVec.y) * 0.5) * innerHeight, m, innerHeight - m);
  // PAN THE TRUCK OFF-SCREEN and the clamp slides the stick along the edge —
  // straight back onto the tachometer, which is the corner this move exists to
  // get off. The instrument cluster is the one place it may not rest, so shove
  // it clear rather than let the fallback undo the fix.
  const cx = innerWidth * 0.56, cy = innerHeight * 0.70;
  if (x > cx && y > cy) x = Math.max(m, cx - STICK_R * 0.5);
  return { x, y };
};
function updateStickHome(): void {
  // Nothing to steer with when the car is steering itself. Leaving a live stick
  // on screen in a moving vehicle is an invitation to touch it.
  if (real.on) { stickBase.style.display = stickNub.style.display = 'none'; return; }
  if (camMode === 'top') {
    const h = stickHome();
    stickBase.style.display = 'block';
    stickBase.style.left = `${h.x}px`;
    stickBase.style.top = `${h.y}px`;
    if (!stick) {
      stickNub.style.display = 'block';
      stickNub.style.left = `${h.x}px`;
      stickNub.style.top = `${h.y}px`;
    }
  } else if (!stick) {
    stickBase.style.display = stickNub.style.display = 'none';
  }
}
addEventListener('resize', updateStickHome);
const setStickFrom = (e: PointerEvent): void => {
  if (!stick) return;
  const rx = e.clientX - stick.x0, ry = e.clientY - stick.y0;
  const len = Math.hypot(rx, ry);
  const cl = Math.min(len, STICK_R);
  const ux = len ? rx / len : 0, uy = len ? ry / len : 0;
  stickNub.style.left = `${stick.x0 + ux * cl}px`;
  stickNub.style.top = `${stick.y0 + uy * cl}px`;
  const mag = Math.max(0, cl - STICK_DEAD) / (STICK_R - STICK_DEAD);
  stick.dx = ux * mag;
  stick.dy = uy * mag;
};
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (hudTap(e.clientX, e.clientY)) return; // an instrument swallowed it
  // Capture: without it, a finger lifted over interactive chrome (the reroll
  // button) never fires pointerup HERE — the brake finger leaked and stayed
  // held forever, which read as "the car is stuck".
  try { canvas.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
  if (camMode === 'top') {
    const h = stickHome();
    if (!stick && Math.hypot(e.clientX - h.x, e.clientY - h.y) <= STICK_R * 1.4) {
      stick = { id: e.pointerId, x0: h.x, y0: h.y, dx: 0, dy: 0 };
      setStickFrom(e);
    } else {
      panPtrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    return;
  }
  if (!stick) {
    stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
    stickBase.style.display = stickNub.style.display = 'block';
    stickBase.style.left = stickNub.style.left = `${e.clientX}px`;
    stickBase.style.top = stickNub.style.top = `${e.clientY}px`;
  } else if (brakeId === null) {
    brakeId = e.pointerId; // second finger, anywhere: brake
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (stick?.id === e.pointerId) { setStickFrom(e); return; }
  const prev = panPtrs.get(e.pointerId);
  if (!prev || camMode !== 'top') return;
  const cur = { x: e.clientX, y: e.clientY };
  if (panPtrs.size === 1) {
    // metres per screen px at the current viewing distance
    const k = (CAM.base * zoomCur + Math.abs(state.speed) * 3.6 * CAM.perKmh) / innerHeight;
    panX -= (cur.x - prev.x) * k;
    panZ -= (cur.y - prev.y) * k;
  } else if (panPtrs.size === 2) {
    const other = [...panPtrs.entries()].find(([id]) => id !== e.pointerId)?.[1];
    if (other) {
      const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
      const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
      if (d0 > 12 && d1 > 12) zoomT = clamp(zoomT * (d0 / d1), ZOOM_MIN, ZOOM_MAX); // survey a whole region
    }
  }
  panPtrs.set(e.pointerId, cur);
});
addEventListener('wheel', (e) => {
  if (camMode !== 'top') return;
  zoomT = clamp(zoomT * Math.exp(e.deltaY * 0.0012), ZOOM_MIN, ZOOM_MAX);
  e.preventDefault();
}, { passive: false });
const endStick = (e: PointerEvent): void => {
  panPtrs.delete(e.pointerId);
  if (stick?.id === e.pointerId) {
    stick = null;
    updateStickHome();
  }
  if (brakeId === e.pointerId) brakeId = null;
};
canvas.addEventListener('pointerup', endStick);
canvas.addEventListener('pointercancel', endStick);
// Belt to the capture's braces: any release anywhere clears these too.
addEventListener('pointerup', endStick);
addEventListener('pointercancel', endStick);
addEventListener('blur', () => { stick = null; brakeId = null; panPtrs.clear(); keys.clear(); updateStickHome(); });
function input(): { throttle: number; steer: number; brake: boolean } {
  let throttle = 0, steer = 0, stickBrake = false;
  if (keys.has('w') || keys.has('arrowup')) throttle += 1;
  if (keys.has('s') || keys.has('arrowdown')) throttle -= 1;
  if (keys.has('a') || keys.has('arrowleft')) steer -= 1;
  if (keys.has('d') || keys.has('arrowright')) steer += 1;
  if (stick) {
    const mag = Math.min(1, Math.hypot(stick.dx, stick.dy));
    if (camMode === 'top' && mag > 0.02) {
      // The chart view is always north-up, so the stick is DIRECTIONAL there:
      // push where you want to go on screen and the car steers itself onto
      // that bearing. (Relative gas/steer read inverted whenever the car
      // pointed south.)
      const want = Math.atan2(stick.dx, -stick.dy);
      const diff = Math.atan2(Math.sin(want - state.heading), Math.cos(want - state.heading));
      if (Math.abs(diff) > 2.7 && Math.abs(state.speed) > 0.5) {
        stickBrake = true; // pulling straight against travel = brake
      } else {
        steer += clamp(diff / 0.5, -1, 1);
        // Full throttle on the bearing; a steering creep when it's behind —
        // the car arcs around instead of confusingly reversing.
        throttle += mag * clamp(Math.cos(diff) * 1.4, 0.35, 1);
      }
    } else {
      // Squared response: |v|·v — precision near centre, authority at the rim.
      throttle += -(stick.dy * Math.abs(stick.dy));
      steer += stick.dx * Math.abs(stick.dx);
    }
  }
  return { throttle: clamp(throttle, -1, 1), steer: clamp(steer, -1, 1), brake: brakeId !== null || keys.has(' ') || stickBrake };
}

// ── minimap: north-up, fog-masked, car-centred ─────────────────────
const MINI = 138, MINI_SPAN = 1500; // px, metres across
// The corner DOCK always shows the OTHER view — chart minimap while chasing,
// live POV preview while charting — and tapping it swaps which is fullscreen.
const mapDock = document.createElement('div'); // offscreen holder for the map canvas
Object.assign(mapDock.style, {
  position: 'fixed', left: '12px', bottom: 'max(44px, calc(env(safe-area-inset-bottom) + 34px))',
  width: `${MINI}px`, height: `${MINI}px`, zIndex: '10', cursor: 'pointer',
  border: '1px solid rgba(245,196,83,0.35)', borderRadius: '10px', overflow: 'hidden',
} as Partial<CSSStyleDeclaration>);
mapDock.style.display = 'none';
document.body.appendChild(mapDock);
const mini = document.createElement('canvas');
mini.width = mini.height = MINI * 2;
Object.assign(mini.style, {
  position: 'absolute', inset: '0', width: '100%', height: '100%',
  background: 'rgba(4,6,11,0.9)', pointerEvents: 'none',
} as Partial<CSSStyleDeclaration>);
mapDock.appendChild(mini);
function updateDock(): void { /* the HUD decides what the corner shows */ }
const miniCtx = mini.getContext('2d')!;
function drawMinimap(): void {
  const S = MINI * 2;
  const spanPx = MINI_SPAN / M_PER_PX;                 // map-layer px the window spans
  const [cx, cz] = mapPt(state.x, state.z);
  const sx = cx - spanPx / 2, sz = cz - spanPx / 2;
  miniCtx.clearRect(0, 0, S, S);
  miniCtx.save();
  miniCtx.beginPath();
  miniCtx.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
  miniCtx.clip();
  miniCtx.fillStyle = '#0a0f0a';
  miniCtx.fillRect(0, 0, S, S);
  miniCtx.drawImage(mapLayer, sx, sz, spanPx, spanPx, 0, 0, S, S);
  // Fog over the chart: the fog canvas is stored flipped for the GPU (flipY),
  // so flip it back while compositing — unexplored stays unknown on the map too.
  // With the fog dialled off the chart is a chart, not a scratchcard.
  if ((compMat.uniforms.uFow as { value: number }).value > 0) {
    miniCtx.save();
    miniCtx.translate(0, S);
    miniCtx.scale(1, -1);
    miniCtx.drawImage(fogCanvas, sx, FOG_PX - sz - spanPx, spanPx, spanPx, 0, 0, S, S);
    miniCtx.restore();
  }
  // The car: an amber heading wedge, always centre.
  miniCtx.translate(S / 2, S / 2);
  miniCtx.rotate(state.heading);
  miniCtx.fillStyle = '#f5c453';
  miniCtx.beginPath();
  miniCtx.moveTo(0, -9); miniCtx.lineTo(6, 7); miniCtx.lineTo(-6, 7);
  miniCtx.closePath(); miniCtx.fill();
  miniCtx.restore();
  // North tick.
  miniCtx.fillStyle = 'rgba(245,196,83,0.8)';
  miniCtx.font = '600 18px ui-monospace, monospace';
  miniCtx.textAlign = 'center';
  miniCtx.fillText('N', S / 2, 24);
}

// ── camera modes: top-down chart → low chase → the driver's seat ───
// Three rigs, cycled by the same control. CAB is the one that costs nothing
// and changes everything: the world at 1.6m with the A-pillars in the way is
// a different game from the world at 18m behind, and it is the seat the
// headlights, the wipers and the retroreflective signs were all built for.
type CamMode = 'top' | 'chase' | 'cab';
const CAM_ORDER: CamMode[] = ['top', 'chase', 'cab'];
let camMode: CamMode = 'top';
const camPos = new THREE.Vector3();
const camAim = new THREE.Vector3();
let camInit = false;
const miniCam = new THREE.PerspectiveCamera(60, 1, 1, 30000); // the dock's POV preview rig
/** The driver's eye, in the car's own frame: right-hand seat, just behind the
 *  windscreen (which stands at z −1.2) and below the roof band at y 2.09. */
const EYE = { x: 0.42, y: 1.9, z: -0.42 };
function setCam(m: CamMode): void {
  camMode = m;
  halo.visible = camMode === 'top'; // the marker is chart furniture, not scenery
  if (camMode !== 'top') halo.scale.setScalar(1);
  camInit = false;                  // snap to the new rig, then resume smoothing
  panX = panZ = 0;                  // pan is a glance, not a state to carry over
  // From the driver's seat you are INSIDE the shell, so the near plane has to
  // clear the dashboard rather than the bonnet.
  camera.fov = camMode === 'cab' ? 68 : 55;
  camera.updateProjectionMatrix();
  updateStickHome();
  updateDock();
}
function toggleCam(): void {
  setCam(CAM_ORDER[(CAM_ORDER.indexOf(camMode) + 1) % CAM_ORDER.length]);
}
addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'c') toggleCam(); });
updateStickHome(); // boot in top mode: the pinned stick is visible from frame one
updateDock();


// ── «translation»: place names in an alien script ──────────────────
// Tap the location (top-left) to toggle. Deterministic per string — the same
// place always garbles to the same glyphs, so landmarks stay RECOGNIZABLE
// even unreadable (the future trek mechanic depends on that). Yi syllables:
// a big, coherent block that renders everywhere and reads properly foreign.
let alien = false;
try { alien = localStorage.getItem('drive.alien') === '1'; } catch { /* fine */ }
const alienCache = new Map<string, string>();
function alienize(s: string): string {
  if (!alien) return s;
  let out = alienCache.get(s);
  if (out !== undefined) return out;
  out = '';
  let h = 2166136261;
  for (const ch of s) {
    if (/[a-z0-9]/i.test(ch)) {
      h = Math.imul(h ^ ch.toLowerCase().charCodeAt(0), 16777619) >>> 0;
      out += String.fromCharCode(0xa000 + (h % 0x48c));
    } else out += ch; // keep spaces & punctuation: the name's rhythm survives
  }
  alienCache.set(s, out);
  return out;
}
let placeLabel = '…';
// The HUD reads placeLine each frame; toggling translation just rewrites it.
const renderPlace = (): void => { placeLine = alienize(placeLabel).toUpperCase(); };
function toggleAlien(): void {
  alien = !alien;
  try { localStorage.setItem('drive.alien', alien ? '1' : '0'); } catch { /* fine */ }
  alienCache.clear();
  renderPlace();
}

// ── POI waypoints ──────────────────────────────────────────────────
// Named parks/waters/buildings from the OSM stream become waypoints. This
// only COMPUTES them; the pixel HUD draws them, so labels share the world's
// grid and font instead of being browser text floating above it.
const POI_COLORS: Record<Poi['kind'], string> = { park: '#7fae6a', water: '#6aa3d8', place: '#d8b46a', mission: '#f5c453', repair: '#e2703a' };
const poiVec = new THREE.Vector3(), poiView = new THREE.Vector3(), camFwd = new THREE.Vector3();
const fmtDist = (m: number): string => (m < 950 ? `${Math.round(m / 10) * 10}M` : `${(m / 1000).toFixed(1)}KM`);
// Close enough to act on. The pins used to be CULLED inside 25m, which threw
// away exactly the moment they matter — you arrive at a place and it vanishes.
// They now stay all the way in and switch to an in-range presentation instead.
const POI_RANGE = 55;
/**
 * Is the ground in the way? Marches the sight line from the camera to the
 * waypoint and asks whether the terrain ever rises above it.
 *
 * A label is drawn in screen space, so it happily paints a place that is
 * behind a hill as though it were sitting on the bonnet — "SILVERMINE DAM
 * 860M" floating beside the truck with an entire ridge between the two. The
 * label is not wrong about WHERE the dam is; it is wrong about whether you can
 * SEE it, and those are different claims. Occluded ones get ghosted rather than
 * hidden: you still want the bearing, you just should not read it as a view.
 *
 * Step count scales with distance (~14m apart, capped) — a fixed count would
 * stride straight over a thin ridge at 900m and call it clear.
 */
function sightBlocked(px: number, py: number, pz: number): boolean {
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  const dist = Math.hypot(px - cx, pz - cz);
  if (dist < 12) return false;
  const steps = Math.round(clamp(dist / 14, 8, 70));
  // Skip the ends: the ground under the camera and under the pin are both
  // "in the way" of a ray that starts and finishes at ground level.
  for (let i = 2; i < steps - 1; i++) {
    const t = i / steps;
    const sx = cx + (px - cx) * t, sz = cz + (pz - cz) * t;
    // 1.5m of slack, so a kerb or a bump in the heightfield does not count as
    // a mountain. What we are looking for is terrain, not noise.
    if (groundAt(sx, sz) > cy + (py - cy) * t + 1.5) return true;
  }
  return false;
}
// Occlusion changes slowly — you have to drive somewhere for a ridge to move
// out of the way — while `sightBlocked` marches up to 70 ground samples per
// pin. Recomputing that for three pins every frame is ~200 heightfield lookups
// a frame for an answer that is the same as it was 100ms ago. Cached per pin,
// refreshed on a stagger so the three never land on the same frame.
const sightCache = new Map<string, { at: number; hid: boolean }>();
function sightBlockedCached(name: string, px: number, py: number, pz: number, i: number): boolean {
  const now = performance.now();
  const c = sightCache.get(name);
  if (c && now - c.at < 140) return c.hid;
  const hid = sightBlocked(px, py, pz);
  sightCache.set(name, { at: now + i * 23, hid });
  return hid;
}
function updatePois(): void {
  // Pinned waypoints (a mission's giver and its destination) are NOT subject to
  // the nearest-three rule — the whole point of a destination is that it is far
  // away and stays on screen the entire way there.
  const all = [...pois.values()].map((p) => ({ p, d: Math.hypot(p.x - state.x, p.z - state.z) }));
  const pinned = all.filter((e) => e.p.pinned).sort((a, b) => a.d - b.d);
  const near = pinned.concat(
    all.filter((e) => !e.p.pinned && e.d < 3000).sort((a, b) => a.d - b.d).slice(0, 3 - Math.min(2, pinned.length)),
  );
  camera.getWorldDirection(camFwd);
  poiDraw = [];
  for (let i = 0; i < near.length; i++) {
    const { p, d } = near[i];
    const dx = p.x - state.x, dz = p.z - state.z;
    const dc = Math.min(d, 900); // beyond ~900m: pin to the horizon on its bearing
    const wx = state.x + (dx / d) * dc, wz = state.z + (dz / d) * dc;
    poiVec.set(wx, groundAt(wx, wz) + 2, wz);
    poiView.copy(poiVec).applyMatrix4(camera.matrixWorldInverse);
    const rng = d < POI_RANGE;
    // Occluded by the ground, or by a building tall enough to matter. Both are
    // "you cannot see this from here", and the label should say so.
    const hid = sightBlockedCached(p.name, poiVec.x, poiVec.y, poiVec.z, i)
      || wallHitAlong(camera.position.x, camera.position.z, wx, wz, camera.position.y) < 0.98;
    const label = `${alienize(p.name).toUpperCase()} ${fmtDist(d)}`;
    if (poiView.z < -1) {
      poiVec.project(camera);
      if (Math.abs(poiVec.x) <= 0.92) {
        poiDraw.push({
          x: (poiVec.x * 0.5 + 0.5) * innerWidth,
          y: clamp((-poiVec.y * 0.5 + 0.5) * innerHeight, innerHeight * 0.16, innerHeight * 0.8),
          t: label, c: POI_COLORS[p.kind], edge: 0, rng, hid,
          w: [wx, wz, groundAt(wx, wz) + 2],
        });
        continue;
      }
    }
    // Off-screen: an edge chip on the side the waypoint actually lies.
    const right = camFwd.x * dz - camFwd.z * dx > 0;
    poiDraw.push({
      x: 0, y: innerHeight * (0.34 + i * 0.055),
      // An edge chip is a BEARING, never a view — it points off-screen by
      // definition — so it is never ghosted.
      t: right ? `${label} >` : `< ${label}`, c: POI_COLORS[p.kind], edge: right ? 1 : -1, rng, hid: false,
    });
  }
  updateCps();
}
// Checkpoint markers, only when a dial has asked for them. The mechanic is
// designed around NOT drawing these — the tally moving is the whole signal —
// but "invisible feels right" is a claim you can only test by driving the
// version that isn't.
interface CpDraw { x: number; y: number; tx: number; ty: number; got: boolean; age: number; d: number }
let cpDraw: CpDraw[] = [];
// 700m was too short to ever see one: checkpoints sit 250m apart on a road
// that bends, so from any given spot most of them are behind you or round the
// next headland. A beam stands 26m tall and reads from well over a kilometre.
const CP_SIGHT = 1400;     // how far a marker carries
const CP_BEAM_H = 26;      // metres of light column in BEAM mode
const cpCull = { vis: 0, total: 0, taken: 0, far: 0, behind: 0, offscreen: 0, drawn: 0 };
function updateCps(): void {
  cpDraw = [];
  cpCull.vis = cpVis;
  cpCull.total = cpCull.taken = cpCull.far = cpCull.behind = cpCull.offscreen = cpCull.drawn = 0;
  if (cpVis === 0) return;
  const now = performance.now();
  // THE ROAD YOU ARE ON, and only that one. Drawing every nearby road turned a
  // junction into a thicket of markers belonging to streets you were not
  // driving. wayAt() is what makes this safe to scope: it answers with the
  // nearest NAMED road whether or not you are between its kerbs, so a wheel on
  // the verge no longer blanks the markers you are steering at.
  const here = wayAt(state.x, state.z);
  const road = here ? survey.get(here.name) : null;
  if (road) {
    for (const c of road.cps) {
      cpCull.total++;
      const age = c.at ? now - c.at : Infinity;
      // PING shows ONLY what you just took, and nothing else, ever. The other
      // modes add the ones still out there.
      if (cpVis === 1 ? age > 1400 : c.got && age > 1400) { cpCull.taken++; continue; }
      const d = Math.hypot(c.x - state.x, c.z - state.z);
      // The chart shows the WHOLE way. Its whole job is the shape of a road you
      // are not looking at, and a 1.4km horizon on a view that zooms to 44x
      // would clip the run exactly where surveying it gets interesting.
      if (camMode !== 'top' && d > CP_SIGHT) { cpCull.far++; continue; }
      const g = groundAt(c.x, c.z);
      poiVec.set(c.x, g + 1.2, c.z);
      if (poiView.copy(poiVec).applyMatrix4(camera.matrixWorldInverse).z > -1) { cpCull.behind++; continue; }
      poiVec.project(camera);
      // Horizontal only. Culling on Y threw away every checkpoint whose foot
      // sits below the viewport — which is most of the near ones under a chase
      // camera, and exactly the ones whose beam would be tallest on screen.
      if (Math.abs(poiVec.x) > 1.25) { cpCull.offscreen++; continue; }
      cpCull.drawn++;
      const sx = (poiVec.x * 0.5 + 0.5) * innerWidth;
      const sy = (-poiVec.y * 0.5 + 0.5) * innerHeight;
      // Project the top of the column too, so the beam keeps real perspective
      // — a fixed pixel height would stand up straight on a hillside and lie
      // about which way is up.
      poiVec.set(c.x, g + CP_BEAM_H, c.z).project(camera);
      cpDraw.push({
        x: sx, y: sy,
        tx: (poiVec.x * 0.5 + 0.5) * innerWidth,
        ty: (-poiVec.y * 0.5 + 0.5) * innerHeight,
        got: c.got, age, d,
      });
      if (cpDraw.length >= (camMode === 'top' ? 400 : 60)) return;
    }
  }
}

// ── audio: everything synthesised, nothing downloaded ──────────────
// Foundations only, but real: an engine whose pitch follows the drivetrain,
// tire roar coloured by the surface underneath, wind that rises with speed,
// and impacts when the suspension bottoms out. One noise buffer, a handful of
// nodes, no assets — and it must be armed by a gesture (iOS autoplay policy).
const audio = (() => {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let engA: OscillatorNode, engB: OscillatorNode, engFilt: BiquadFilterNode, engGain: GainNode;
  let roarGain: GainNode, roarFilt: BiquadFilterNode, windGain: GainNode, windFilt: BiquadFilterNode;
  let gritSrc: AudioBufferSourceNode, gritGain: GainNode, gritFilt: BiquadFilterNode;
  let squealGain: GainNode, squealFilt: BiquadFilterNode, squealOsc: OscillatorNode;
  let noiseBuf: AudioBuffer;
  let on = true;
  try { on = localStorage.getItem('drive.mute') !== '1'; } catch { /* fine */ }
  const build = (): void => {
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
    const Ctor = AC.AudioContext ?? AC.webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = on ? 0.55 : 0;
    master.connect(ctx.destination);
    // Two seconds of white noise, looped — the source of tires and wind.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Engine: detuned saw + square through a lowpass that opens with revs.
    engFilt = ctx.createBiquadFilter(); engFilt.type = 'lowpass'; engFilt.frequency.value = 700;
    engGain = ctx.createGain(); engGain.gain.value = 0;
    engFilt.connect(engGain); engGain.connect(master);
    engA = ctx.createOscillator(); engA.type = 'sawtooth'; engA.frequency.value = 40;
    engB = ctx.createOscillator(); engB.type = 'square'; engB.frequency.value = 60;
    const engMix = ctx.createGain(); engMix.gain.value = 0.5;
    engA.connect(engFilt); engB.connect(engMix); engMix.connect(engFilt);
    engA.start(); engB.start();
    // Tire roar: bandpassed noise, centre frequency set by the surface.
    const roarSrc = ctx.createBufferSource(); roarSrc.buffer = noiseBuf; roarSrc.loop = true;
    roarFilt = ctx.createBiquadFilter(); roarFilt.type = 'bandpass'; roarFilt.frequency.value = 300; roarFilt.Q.value = 0.7;
    roarGain = ctx.createGain(); roarGain.gain.value = 0;
    roarSrc.connect(roarFilt); roarFilt.connect(roarGain); roarGain.connect(master); roarSrc.start();
    // GRIT: the gravel bed. Not steady noise — a few seconds of individual
    // stone impacts (sharp attack, short decay, random pitch), looped and
    // sped up with the truck so loose ground CRUNCHES rather than hisses.
    const gritBuf = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const gd = gritBuf.getChannelData(0);
    const grains = Math.floor(ctx.sampleRate * 4 * 0.012); // ~530 stones/sec of loop
    for (let g = 0; g < grains; g++) {
      const at = Math.floor(Math.random() * (gd.length - 900));
      const len = 60 + Math.floor(Math.random() * 700);
      const amp = 0.25 + Math.random() * 0.75;
      const ring = 0.04 + Math.random() * 0.5; // a little pitch per stone
      for (let i = 0; i < len; i++) {
        const env = Math.exp((-i / len) * 6);
        gd[at + i] += (Math.random() * 2 - 1) * env * amp * 0.5 + Math.sin(i * ring) * env * amp * 0.12;
      }
    }
    let peak = 0;
    for (let i = 0; i < gd.length; i++) peak = Math.max(peak, Math.abs(gd[i]));
    if (peak > 0) for (let i = 0; i < gd.length; i++) gd[i] /= peak;
    gritSrc = ctx.createBufferSource(); gritSrc.buffer = gritBuf; gritSrc.loop = true;
    gritFilt = ctx.createBiquadFilter(); gritFilt.type = 'bandpass'; gritFilt.frequency.value = 1400; gritFilt.Q.value = 0.5;
    gritGain = ctx.createGain(); gritGain.gain.value = 0;
    gritSrc.connect(gritFilt); gritFilt.connect(gritGain); gritGain.connect(master); gritSrc.start();
    // SQUEAL: a tyre that is sliding rather than rolling. Noise through a very
    // narrow bandpass, plus a thin sawtooth at the same pitch so it has an edge
    // — pure filtered noise reads as wind, not rubber.
    const sqSrc = ctx.createBufferSource(); sqSrc.buffer = noiseBuf; sqSrc.loop = true;
    squealFilt = ctx.createBiquadFilter(); squealFilt.type = 'bandpass';
    squealFilt.frequency.value = 1500; squealFilt.Q.value = 14;
    squealGain = ctx.createGain(); squealGain.gain.value = 0;
    sqSrc.connect(squealFilt);
    squealOsc = ctx.createOscillator(); squealOsc.type = 'sawtooth'; squealOsc.frequency.value = 1500;
    const sqMix = ctx.createGain(); sqMix.gain.value = 0.05;
    squealOsc.connect(sqMix); sqMix.connect(squealFilt);
    squealFilt.connect(squealGain); squealGain.connect(master);
    sqSrc.start(); squealOsc.start();
    // Wind: highpassed noise that climbs with the square of speed.
    const windSrc = ctx.createBufferSource(); windSrc.buffer = noiseBuf; windSrc.loop = true;
    windFilt = ctx.createBiquadFilter(); windFilt.type = 'highpass'; windFilt.frequency.value = 900;
    windGain = ctx.createGain(); windGain.gain.value = 0;
    windSrc.connect(windFilt); windFilt.connect(windGain); windGain.connect(master); windSrc.start();
  };
  const arm = (): void => {
    // iOS mutes Web Audio with the RINGER SWITCH unless the page declares a
    // playback session (16.4+). Without this the graph runs perfectly and you
    // hear nothing — which is exactly how it failed on the phone.
    try {
      const ns = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (ns) ns.type = 'playback';
    } catch { /* not supported — silent switch still applies */ }
    if (!ctx) build();
    if (!ctx) return;
    // Must be *inside* the gesture: resume, then push a 1-sample silent buffer
    // through — Safari only truly unlocks once something has been played.
    if (ctx.state !== 'running') void ctx.resume();
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      s.connect(ctx.destination);
      s.start(0);
    } catch { /* fine */ }
    syncBtn();
  };
  return {
    arm,
    get on(): boolean { return on; },
    get state(): string { return ctx ? ctx.state : 'none'; },
    toggle(): boolean {
      on = !on;
      try { localStorage.setItem('drive.mute', on ? '0' : '1'); } catch { /* fine */ }
      if (on) arm();
      if (master && ctx) master.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.05);
      return on;
    },
    // Called every frame; all parameters glide so nothing zippers.
    update(speed: number, throttle: number, surf: Surface, grounded: number, rainAmt = 0, rev = 0, gear = 0, slip = 0): void {
      if (!ctx || !master || ctx.state !== 'running') return;
      const t = ctx.currentTime, v = Math.abs(speed);
      // Revs come from the DRIVETRAIN, not from road speed — the two part
      // company the moment the wheels leave the ground, and the flare over a
      // jump is the whole reason for the distinction.
      const f = 42 + rev * 96 + gear * 10;
      engA.frequency.setTargetAtTime(f, t, 0.07);
      engB.frequency.setTargetAtTime(f * 1.5, t, 0.07);
      engFilt.frequency.setTargetAtTime(500 + rev * 1500 + v * 22, t, 0.09);
      // Airborne the engine gets LOUDER, not quieter: it is unloaded and
      // screaming. Multiplying by `grounded` had it fade out over every jump.
      engGain.gain.setTargetAtTime(
        0.1 + Math.abs(throttle) * 0.16 * (0.45 + 0.55 * grounded)
          + (1 - grounded) * rev * 0.1 + Math.min(v / 60, 0.1), t, 0.09,
      );
      // Rubber that has stopped rolling. Loud on tarmac, largely lost under the
      // gravel off it — and silent below a walking pace, where a slide is a
      // slither, not a skid.
      const bite = surf === 'road' ? 1 : surf === 'track' ? 0.45 : 0.18;
      const sf = 1250 + Math.min(v * 14, 620) + slip * 260;
      squealFilt.frequency.setTargetAtTime(sf, t, 0.08);
      squealOsc.frequency.setTargetAtTime(sf, t, 0.08);
      squealGain.gain.setTargetAtTime(slip * bite * grounded * Math.min(v / 7, 1) * 0.19, t, 0.06);
      // Tarmac hisses high and thin; loose ground growls low and loud. A graded
      // track sits between the two — you can hear which tier you are on.
      const road = surf === 'road';
      const hard = road ? 1 : surf === 'track' ? 0.55 : 0;
      roarFilt.frequency.setTargetAtTime(320 + hard * 830, t, 0.12);
      roarGain.gain.setTargetAtTime(Math.min(v / 34, 1) * (0.26 - hard * 0.16) * grounded, t, 0.1);
      // Rain rides the wind channel: same filtered noise, opened up and lifted.
      windFilt.frequency.setTargetAtTime(900 - rainAmt * 500, t, 0.4);
      windGain.gain.setTargetAtTime(Math.min((v * v) / 2600, 0.9) * 0.13 + rainAmt * 0.16, t, 0.15);
      // Gravel: absent on tarmac, dominant off it. Rate (playbackRate) AND
      // level rise with speed, so the crunch density tracks the wheels.
      const loose = road ? 0 : surf === 'water' ? 0.12 : surf === 'track' ? 0.45 : 1;
      gritSrc.playbackRate.setTargetAtTime(0.55 + Math.min(v / 26, 1.35), t, 0.12);
      gritFilt.frequency.setTargetAtTime(surf === 'water' ? 700 : 900 + Math.min(v * 26, 1400), t, 0.15);
      gritGain.gain.setTargetAtTime(Math.min(v / 12, 1) * 0.3 * loose * grounded, t, 0.09);
    },
    // Thunder: a low rumble whose attack softens and whose tail lengthens with
    // distance — a near strike cracks, a far one rolls.
    thunder(far: number): void {
      if (!ctx || !master || ctx.state !== 'running' || !on) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 420 - far * 300; lp.Q.value = 0.7;
      const g = ctx.createGain();
      const dur = 0.9 + far * 2.6, atk = 0.005 + far * 0.35;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.55 - far * 0.32, t + atk);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start(t); src.stop(t + dur + 0.1);
    },
    // A stone spat out from under a tire — sharp, pitched, very short.
    stone(): void {
      if (!ctx || !master || ctx.state !== 'running' || !on) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1100 + Math.random() * 2600; bp.Q.value = 4 + Math.random() * 8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.16 + Math.random() * 0.14, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + Math.random() * 0.06);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.14);
    },
    // A short filtered burst — landings, kerb strikes, scrapes.
    thud(force: number): void {
      if (!ctx || !master || ctx.state !== 'running' || !on) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 220 + force * 180;
      const g = ctx.createGain();
      g.gain.setValueAtTime(Math.min(0.5, force * 0.42), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t); src.stop(t + 0.3);
    },
  };
})();
// The sound button reports the TRUTH: 'TAP' means the context exists but the
// browser hasn't unlocked it yet, so a silent failure is never mistaken for a
// working mix.
const syncBtn = (): void => { /* label is drawn from audio state each frame */ };
// ANY first gesture arms the context. iOS grants user activation on
// touchend/click far more reliably than on pointerdown, so listen broadly and
// keep listening (a backgrounded tab suspends the context again).
for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) {
  addEventListener(ev, () => audio.arm(), { passive: true });
}
addEventListener('visibilitychange', () => { if (!document.hidden) audio.arm(); });

// ── main loop ──────────────────────────────────────────────────────
let last = performance.now();
let streamAt = 0;
let miniAt = 0;
let urlAt = 0, urlX = Infinity, urlZ = 0, urlH = 0;
const writeUrl = (la: number, lo: number): void => {
  const deg = (((state.heading * 180) / Math.PI) % 360 + 360) % 360;
  try {
    // The mission id rides along, so the URL the game keeps rewriting stays a
    // resumable link: reload mid-drive and the job is still on.
    const m = mission && missionPhase !== 'done' ? `&m=${mission.id}` : '';
    history.replaceState(null, '', `?lat=${la.toFixed(5)}&lon=${lo.toFixed(5)}&h=${deg.toFixed(0)}${camMode === 'top' ? '' : `&cam=${camMode}`}${m}`);
  } catch { /* fine */ }
};
// Surface grip: tarmac is fast, everything else asks you to slow down —
// which turns "follow the real roads" into the game. `lift` is how proud the
// drawn drape sits of the sampled field (wheels touch the visible surface);
// `rough` scales the spatial roughness field the tires ride over.
// Equilibrium speed is accel/drag, so `drag` — not `max` — is the real
// governor: off-road doubles to ~115km/h by halving drag (0.5 = 16/32).
// `mu` is the friction circle's radius in g: how much acceleration the contact
// patch can supply in ANY direction. A corner asks for v·ω of it; whatever the
// tyres can't find becomes sideways velocity, and that is the whole of the
// drift model. `lat` is how fast that sideways velocity scrubs off — tarmac
// bites and recovers, gravel keeps sliding.
const SURFACE = {
  // `lift` is how far a tyre sits above the sampled surface. It doubles as the
  // draped layers' z-order, so the two must agree or the truck floats over the
  // road it is drawn on — but at 0.6/0.5/0.25 the stack was CURB HEIGHT, and
  // every road became a platform to climb onto. Compressed to real kerb scale;
  // the ordering that keeps green under water under track under road survives.
  road: { max: 50, drag: 0.28, lift: 0.22, rough: 0.015, mu: 1.05, lat: 6.5 },
  // The middle tier: a graded dirt track. Equilibrium speed is accel/drag, so
  // 0.36 sits it between tarmac's 57m/s and open ground's 32 — quick enough
  // that finding a track is a relief, rough enough that it is not a road.
  track: { max: 40, drag: 0.36, lift: 0.18, rough: 0.07, mu: 0.8, lat: 5 },
  ground: { max: 32, drag: 0.5, lift: 0.10, rough: 0.16, mu: 0.6, lat: 3.2 }, // monster truck: off-road is its element
  water: { max: 3.5, drag: 3.5, lift: 0.12, rough: 0.05, mu: 0.3, lat: 2 },
} as const;
type SurfParams = { max: number; drag: number; lift: number; rough: number; mu: number; lat: number };
// ── what the road is actually made of ──────────────────────────────
// `highway=*` says what a way is FOR. It says nothing about what it is MADE OF,
// and OSM has been telling us all along: `surface`, `smoothness` and
// `tracktype` were cached on every way and read by nobody, so a sand piste
// through the Sahara and a fresh German autobahn were the same three numbers.
// They are now one continuous quality 0..1 — 1 is new tarmac, 0 is barely a
// surface at all — and every grip, drag and wear term reads it.
const SURF_Q: Record<string, number> = {
  asphalt: 1, concrete: 0.97, 'concrete:plates': 0.88, chipseal: 0.95, paved: 0.93,
  paving_stones: 0.85, metal: 0.82, wood: 0.76, bricks: 0.72, sett: 0.6,
  cobblestone: 0.55, unhewn_cobblestone: 0.45, compacted: 0.7, fine_gravel: 0.62,
  gravel: 0.5, pebblestone: 0.44, rock: 0.34, unpaved: 0.45, ground: 0.38,
  dirt: 0.36, earth: 0.36, grass: 0.34, woodchips: 0.3, mud: 0.22, sand: 0.24,
  stone: 0.5, grass_paver: 0.62, snow: 0.3, ice: 0.22, salt: 0.55,
};
// A rider's judgement of the ride, which is a different fact from the material:
// a resurfaced gravel road can be smoother than a broken asphalt one.
const SMOOTH_Q: Record<string, number> = {
  excellent: 1, good: 0.9, intermediate: 0.75, bad: 0.55, very_bad: 0.4,
  horrible: 0.28, very_horrible: 0.18, impassable: 0.1,
};
// The forestry grading, which is the only surface fact most tracks carry.
const TRACK_Q: Record<string, number> = { grade1: 0.82, grade2: 0.62, grade3: 0.5, grade4: 0.38, grade5: 0.26 };
/**
 * A way's surface quality from its tags, defaulting to the quality that its
 * class already implied — so an untagged road behaves EXACTLY as it did before
 * this existed, and only real data moves it.
 *
 * `surface` and `tracktype` are both statements about what the way IS, so
 * either one REPLACES the class default rather than being capped by it — a
 * grade1 track is firmer than a nameless one, and refusing to let it say so
 * would make the tag worthless. Where both are present the worse wins, and
 * `smoothness` — a rider's verdict on the ride, which is a different fact from
 * the material — caps whatever the material claimed: `surface=asphalt` with
 * `smoothness=very_bad` is a broken road, not a good one.
 */
function wayQuality(tags: Record<string, string>, track: boolean): number {
  const mat = SURF_Q[tags.surface ?? ''];
  const grade = TRACK_Q[tags.tracktype ?? ''];
  let q = mat !== undefined && grade !== undefined ? Math.min(mat, grade)
    : mat ?? grade ?? (track ? Q_TRACK : Q_ROAD);
  const ride = SMOOTH_Q[tags.smoothness ?? ''];
  if (ride !== undefined) q = Math.min(q, ride);
  return clamp(q, 0.1, 1);
}
/**
 * The physics of a surface of quality `q`. ROAD / TRACK / GROUND stop being
 * three discrete tiers and become three rungs of one continuous ladder, so the
 * whole range between them is now reachable and the endpoints are unchanged:
 * q=1 is the old road, q=0.55 the old track, q=0.2 the old open ground.
 *
 * `lift` is NOT interpolated. It is the draped layers' z-order as much as it is
 * a ride height, and a road drawn at road lift whose tyres sat at track lift is
 * a truck hovering over its own carriageway.
 */
function surfaceFor(kind: Surface, q: number): SurfParams {
  const base = SURFACE[kind];
  if (kind === 'water') return base;
  const [A, B, t] = q >= Q_TRACK
    ? [SURFACE.road, SURFACE.track, (Q_ROAD - q) / (Q_ROAD - Q_TRACK)]
    : [SURFACE.track, SURFACE.ground, (Q_TRACK - q) / (Q_TRACK - Q_GROUND)];
  const f = clamp(t, 0, 1);
  return {
    max: A.max + (B.max - A.max) * f, drag: A.drag + (B.drag - A.drag) * f,
    rough: A.rough + (B.rough - A.rough) * f, mu: A.mu + (B.mu - A.mu) * f,
    lat: A.lat + (B.lat - A.lat) * f, lift: base.lift,
  };
}
// Deterministic washboard: bumps live in the WORLD (wavelengths ~2–4m), so
// shake frequency scales with speed and each wheel rides its own profile.
function roughNoise(x: number, z: number): number {
  return Math.sin(x * 1.7 + Math.sin(z * 0.9) * 2.0) * 0.5 + Math.sin(z * 2.3 + x * 0.8) * 0.35 + Math.sin((x - z) * 3.7) * 0.15;
}
// Sprung body: damped springs for heave/pitch/roll. Downward acceleration is
// capped at gravity, so a crest taken fast LAUNCHES the truck; landings
// compress hard and bounce off the bump stops.
// Travel and droop scale with the wheel: on a 0.9m tyre the old 0.42m of
// travel was most of the tyre's radius and the truck pogoed.
// Droop is now the longer half of the travel, as it is on anything built to go
// where this truck goes: a wheel that can reach further DOWN keeps its load
// through a dip instead of hanging, which is grip you get to keep.
const SUSP = { k: 55, d: 8.5, ka: 40, da: 7.6, travel: 0.26, droop: 0.34 };
let bodyY = 0, vBodyY = 0, pitchC = 0, vPitch = 0, rollC = 0, vRoll = 0;
// The TERRAIN's grade under the wheels — what gravity actually pulls against —
// and the lateral creep it produces. Written by the suspension pass, read by
// the next frame's drive step; one frame of lag at 60fps is nothing.
let gradePitch = 0, gradeRoll = 0, slideV = 0;
// How hard the tyres are currently being asked to work beyond what they have
// (0 = planted, 1 = fully away). Drives the squeal, the dust, and the HUD.
let skid = 0;
let rigPrevV = 0, rigPrevGrounded = 1;
// ── the rig's own condition ────────────────────────────────────────
// Every one of these is INTEGRATED FROM WHAT ACTUALLY HAPPENS, because a gauge
// that moves on a timer is worse than no gauge: it teaches you to ignore the
// instruments. Battery is a real energy balance against the sheet's 2.4kW
// array and 10kWh pack; tyres wear on slip and rough ground; the hull takes
// what the barriers and the landings give it; suspension is live travel.
const rig = {
  batt: 1,        // state of charge, 0..1
  solarKw: 0,     // what the array is making right now
  drawKw: 0,      // what the drive is taking
  tyre: 1,        // tread left
  hull: 1,        // bodywork
  susp: 1,        // dampers and bushes — a STOCK, spent by landings and washboard
  accel: 0,       // m/s², smoothed — what the driver feels
  svc: false,     // parked at a place that can work on the rig
};
const BATT_KWH = 10, SOLAR_KW = 2.4;
// HOW THE RIG BEARS ON THE DRIVE. Until now every one of these stocks was
// written, drawn, and read by nothing — you could grind the tyres to the canvas
// and the truck handled identically, which makes the gauges decoration. Each
// wear stock now buys a real term, and each keeps a floor: a ruined rig is
// meant to be worse to drive, not stranded on a hillside with no way home.
const rigGrip = (): number => 0.72 + 0.28 * rig.tyre;    // tread → mu and lateral
const rigDamp = (): number => 0.55 + 0.45 * rig.susp;    // dampers → body control
// A bent truck pushes more air and binds somewhere; a flat pack limps. Below
// 8% charge the drive is rationed rather than cut, because being unable to move
// is the one failure with no way out of it.
const rigPower = (): number =>
  (0.75 + 0.25 * rig.hull) * (rig.batt <= 0 ? 0.3 : rig.batt < 0.08 ? 0.55 : 1);
// Player tuning, from the RIG tab. Grip is a genuine trade: a softer compound
// finds more of the surface and gives its tread up to do it.
const tune = { steer: 1, susp: 1, grip: 1, tyreWear: 1 };
function stepRig(dt: number, v: number, q: number, sunUp: number): void {
  if (dt <= 0) return;
  // Solar: the array only makes power with the sun up and the sky open.
  rig.solarKw = SOLAR_KW * clamp(sunUp, 0, 1) * (1 - wx.cloud * 0.65);
  // Draw: a standing load plus a square law on speed. Tuned so a full pack
  // runs about three hours flat out, and daylight cruising roughly breaks
  // even — which is the whole point of a solar overlander.
  rig.drawKw = 0.3 + (v / 28) ** 2 * 2.7;
  rig.batt = clamp(rig.batt + ((rig.solarKw - rig.drawKw) * (dt / 3600)) / BATT_KWH, 0, 1);
  // Tread goes to slip first and abrasion second; rock and gravel eat it far
  // faster than tarmac.
  //
  // The slip term was 0.004 per frame at 60fps — 0.24 of the tread PER SECOND
  // of full slide, so four seconds of drifting took a new set of tyres to the
  // canvas. It is now 0.02/s at full slip, and scaled by speed: locking up at
  // walking pace is not what destroys a tyre. A hard sideways minute costs
  // about a fifth of the tread, which is punishing without being a countdown.
  //
  // Abrasion is now a function of the SURFACE QUALITY rather than the road
  // class, so the sett-paved lane and the sand piste each cost what they should
  // instead of both being "not tarmac". The rungs land on the old numbers:
  // q=1 → 0.02, q=0.55 → 0.12, q=0.2 → 0.2.
  const abrasive = 0.02 + (1 - clamp(q, 0, 1)) * 0.225;
  const slipWear = skid * 0.02 * clamp(v / 14, 0, 1);
  rig.tyre = clamp(rig.tyre - (slipWear + (v / 28) * abrasive * 0.0012) * tune.tyreWear * dt, 0, 1);
  // The suspension wears on washboard at speed — the environment costing you,
  // slowly, the way the odometer climbs. Same ladder: a graded track is now
  // genuinely gentler on the dampers than open desert, which it is.
  rig.susp = clamp(rig.susp - (v / 28) * (0.008 + (1 - clamp(q, 0, 1)) * 0.115) * 0.0072 * dt, 0, 1);
}
/** A landing. Severity 0..1 from how hard the body came down. */
function rigLanding(sev: number): void {
  rig.susp = clamp(rig.susp - sev * 0.03, 0, 1);
  rig.tyre = clamp(rig.tyre - sev * 0.008, 0, 1);
  if (sev > 0.6) rig.hull = clamp(rig.hull - (sev - 0.6) * 0.02, 0, 1);
}
/** A hit, charged on the SPEED IT ACTUALLY COST YOU rather than per frame.
 *  The scrape loop runs every frame you are in contact, and the old flat 0.02
 *  a frame meant 1.2 of hull per second — a second of leaning on a guard rail
 *  wrote the truck off. Billing the impulse gets both ends right for free: a
 *  graze along a barrier sheds almost no speed and costs almost nothing, while
 *  driving into a façade sheds all of it at once and hurts. */
function rigImpact(lost: number): void {
  if (lost <= 0.15) return;
  rig.hull = clamp(rig.hull - lost * 0.006, 0, 1);
}
// The drivetrain's own state, separate from road speed — which is the point:
// with the wheels off the ground they are no longer the same number.
let engRev = 0, engGear = 0;
let dbgSusp: object = {};
// A shade over 9.81. Real gravity left long climbs feeling weightless once the
// truck has 16m/s^2 of thrust to spend against it; this gives a hill enough
// authority that you pick your line up it.
const GRAV = 11.5;
let wheelSpin = 0, groundedF = 1, bodyInit = false;
let steerCur = 0; // smoothed — keyboard taps ramp instead of snapping
let prevGround: number | null = null; // last frame's resolved ground (tunnel guard)
let dustBudget = 0;                   // fractional particles carried between frames
const sunScreen = new THREE.Vector3();
function tick(now: number): void {
  // PAUSED WHILE THE MENU IS UP, and the "when appropriate" is real drive: the
  // car outside is still moving whatever this screen is doing, so freezing the
  // position there would just desync the map from the road you are on. The
  // world still RENDERS while paused — the menu is a scrim over a live scene,
  // not a black screen — but nothing integrates, so you can open it mid-corner
  // and come back to the same corner.
  const paused = menuTab !== null && !real.on;
  const dt = paused ? 0 : Math.min(0.05, (now - last) / 1000);
  last = now;
  const { throttle, steer, brake } = real.on || paused
    ? { throttle: 0, steer: 0, brake: false }
    : input();
  stepSun();
  stepWeather(now, dt);
  const surfKind = surfaceAt(state.x, state.z);
  const surfQual = surfQ;                       // set by the call above
  const surf = surfaceFor(surfKind, surfQual);
  if (real.on) stepReal(dt);
  // Arcade bicycle model: thrust minus drag, steering authority grows then
  // saturates with speed so the car neither pivots in place nor becomes twitchy.
  // SKIPPED ENTIRELY under real drive — the position is a measurement, and
  // integrating a model on top of it would fight the receiver for the truck.
  // A battered hull and a flat pack cost DRIVE; worn tyres cost BRAKING, which
  // is the same contact patch the cornering budget comes out of below.
  const power = rigPower();
  const thrust = real.on ? 0 : brake
    ? -Math.sign(state.speed) * CAR.brake * 1.4 * rigGrip()
    : throttle >= 0 ? throttle * CAR.accel * power : throttle * CAR.brake * rigGrip();
  // Grip comes from wheels on the ground: airborne there's no drive, no
  // braking, barely any steering — and gravity along the body's pitch makes
  // climbs cost speed and descents pay it back.
  const grip = groundedF;
  let yawRate = 0;
  if (!real.on) {
    state.speed += thrust * grip * dt;
    // Gravity acts on the GROUND's grade, not on the sprung body's pitch. pitchC
    // is damped by the suspension, carries a throttle-squat fudge, and is clamped
    // to 26 degrees — so it under-read every real hill and lagged the ones it did
    // see. gradePitch comes straight off the four wheel contacts.
    state.speed -= GRAV * Math.sin(gradePitch) * grip * dt;
    // Wet ground drags and caps lower — the weather is felt through the wheels.
    const wetDrag = 1 + wx.wet * (surfKind === 'road' ? 0.35 : 0.7);
    state.speed -= state.speed * surf.drag * wetDrag * (0.1 + 0.9 * grip) * dt;
    if (brake && grip > 0.4 && Math.abs(state.speed) < 1.2) state.speed = 0;
    state.speed = clamp(state.speed, -CAR.maxRev, surf.max * (1.25 - wx.wet * 0.2)); // downhill may overrun the flat cap
    const SRATE = 7 * tune.steer; // full-lock in ~0.14s at STOCK
    steerCur += clamp(steer - steerCur, -SRATE * dt, SRATE * dt);
    if (Math.abs(state.speed) > 0.1) {
      // Authority decays with speed (like a real wheel): full lock is a parking
      // move, a nudge at 180 — turn RATE stays sane across the whole range.
      const authority = (0.15 + 0.85 * grip) * tune.steer / (1 + Math.abs(state.speed) / 12);
      yawRate = (steerCur * CAR.steerMax * authority * state.speed) / CAR.wheelbase;
      state.heading += yawRate * dt;
    }
    state.x += Math.sin(state.heading) * state.speed * dt;
    state.z -= Math.cos(state.heading) * state.speed * dt;
  }
  // ── the tyres have a budget, and it is spent in every direction at once ──
  // Two things pull the truck sideways. A SIDE-SLOPE, always — nothing used
  // to, and you could traverse a 40° face as if it were a car park. And a
  // CORNER: turning at v with yaw rate ω demands v·ω of centripetal
  // acceleration, while the contact patch can supply mu·g and no more, less
  // whatever the throttle or the brakes have already claimed. What the tyres
  // cannot supply, the truck keeps as sideways velocity — it runs wide, and on
  // gravel it keeps running until the scrub bleeds it off. That is the drift.
  if (!real.on) {
    const sH = Math.sin(state.heading), cH = Math.cos(state.heading);
    // Tread and compound both act here, on the one thing a tyre actually is:
    // how much acceleration the contact patch can supply before it lets go.
    const budget = surf.mu * rigGrip() * tune.grip * GRAV * grip * (1 - wx.wet * 0.28);
    // Friction circle: hard braking or full throttle eats into cornering.
    // Only partly — a fully coupled circle makes an arcade car undriveable.
    const longG = Math.min(Math.abs(thrust), budget);
    const lateral = Math.sqrt(Math.max(0, budget * budget - longG * longG * 0.5));
    const gravLat = GRAV * Math.sin(gradeRoll) * grip;   // + = pulled to the car's LEFT
    const demand = state.speed * yawRate;                // + = wants to accelerate RIGHT
    // The slope's pull is served first; the corner gets what's left.
    const spare = Math.max(0, lateral - Math.abs(gravLat));
    const over = Math.max(0, Math.abs(demand) - spare);
    // SATURATING, not linear. Full lock at 110km/h asks for five g of corner;
    // feeding the whole 47m/s² shortfall in as sideways acceleration would fire
    // the truck off the map sideways. What has to be true for the feel is that
    // the slide appears the moment you pass the limit and deepens the further
    // past it you go — not that the number is dimensionally honest.
    slideV -= Math.sign(demand) * 8 * (1 - Math.exp(-over / 12)) * dt;
    slideV -= gravLat * dt;                              // the hill you're standing on
    slideV -= slideV * surf.lat * (0.3 + 0.7 * grip) * dt;
    state.x += cH * slideV * dt;   // (cos, sin) is the car's own right
    state.z += sH * slideV * dt;
    // Sliding sideways is drag you chose. It also decides what you HEAR and
    // what the wheels throw up.
    if (Math.abs(slideV) > 0.6) state.speed *= Math.exp(-Math.min(1.4, Math.abs(slideV) * 0.16) * dt);
    const want = clamp((Math.abs(slideV) - 0.5) / 3.5, 0, 1);
    skid += (want - skid) * Math.min(1, (want > skid ? 9 : 3.5) * dt);
  }
  // ── revs: what the engine is doing, not what the road is doing ──
  // Grounded, the two agree and the box shifts every 14m/s. Airborne there is
  // no load at all: the throttle spins the engine straight up against its own
  // inertia and it HANGS there, gear held, until the wheels land and drag it
  // back. That flare is the sound of a jump.
  {
    const vAbs = Math.abs(state.speed);
    if (grip > 0.06) {
      engGear = Math.floor(vAbs / 14);
      const t = (vAbs - engGear * 14) / 14;
      engRev += (t - engRev) * Math.min(1, 15 * dt);
    } else {
      const t = throttle > 0.02 ? 1.06 + throttle * 0.1 : 0.14;
      engRev += (t - engRev) * Math.min(1, (throttle > 0.02 ? 2.4 : 1.4) * dt);
    }
    engRev = clamp(engRev, 0, 1.2);
  }
  // INSIDE a footprint beats every edge test: no wall is within CAR_R from the
  // middle of a room, so the push-out below would happily leave you sealed in
  // and then shove you back off the inner face of every wall you drove at.
  // Check containment first, every frame.
  // NOT under real drive: OSM footprints are approximate and a real road often
  // runs within a metre of a mapped building. Shoving the truck out would fight
  // the receiver and desync the whole frame from the car you are sitting in —
  // and being "stuck in a building" is not a thing that can happen to you.
  if (!real.on) evictFromBuildings();
  // Buildings are solid: push the car circle out of any nearby wall edge and
  // scrub speed while in contact — sliding along a façade falls out of the
  // push-out geometry for free.
  // How square the hit was, worst case over everything touched this frame: 0 is
  // a graze straight along the barrier, 1 is driving into it head-on.
  let scrape = -1;
  for (let pass = 0; pass < 2 && !real.on; pass++) {
    const walls = wallGrid.get(gkey(state.x, state.z));
    if (!walls) break;
    let hit = false;
    for (const seg of walls) {
      const [cx2, cz2] = closestOnSeg(state.x, state.z, seg);
      const d = Math.hypot(state.x - cx2, state.z - cz2);
      if (d < CAR_R) {
        const push = (CAR_R - d) / (d || 1e-4);
        state.x += (state.x - cx2) * push;
        state.z += (state.z - cz2) * push;
        hit = true;
        // A GUARD RAIL IS NOT A WALL. Losing the same speed to a barrier you
        // brushed at five degrees as to one you hit square made a mountain
        // pass punish the exact line you want to be driving — tight to the
        // edge. Charge only for the component of travel that went INTO the
        // rail; along it is free. Buildings keep the flat penalty: hitting a
        // façade at any angle is a crash, not a lean.
        let sq = 1;
        if (seg.sl) {
          const sx = seg.bx - seg.ax, sz = seg.bz - seg.az;
          const sl = Math.hypot(sx, sz) || 1;
          const along = Math.abs((Math.sin(state.heading) * sx + -Math.cos(state.heading) * sz) / sl);
          sq = clamp(1 - along, 0, 1);
        }
        if (sq > scrape) scrape = sq;
      }
    }
    if (!hit) break;
  }
  if (scrape >= 0) {
    const was = Math.abs(state.speed);
    state.speed *= Math.exp(-5 * scrape * dt);
    rigImpact(was - Math.abs(state.speed));
  }
  // ── suspension: the truck LIES on the terrain via 4 wheel contacts ──
  const sinH = Math.sin(state.heading), cosH = Math.cos(state.heading);
  const contacts: number[] = [];
  // The same four contacts WITHOUT the washboard. The sprung body must not be
  // thrown by every pebble: the noise field runs at 2–4m wavelengths, so at
  // 60km/h it asks the chassis for accelerations twenty times gravity, and the
  // 1g descent cap means the body simply cannot follow — it hangs, the wheels
  // reach full droop, and grip collapses on ground that is merely BUMPY. The
  // body rides the smooth plane; the wheels ride the bumps. That is what a
  // suspension is.
  const smooth: number[] = [];
  const wheelWorld: Array<[number, number]> = [];
  const wheelSurf: Surface[] = [];
  let rawSum = 0;
  for (const [wx, wz] of WHEELS) {
    const wxw = state.x + wx * cosH - wz * sinH;
    const wzw = state.z + wx * sinH + wz * cosH;
    const sk = surfaceAt(wxw, wzw);
    const sw = surfaceFor(sk, surfQ);   // this wheel's own surface, its own tags
    wheelWorld.push([wxw, wzw]);
    wheelSurf.push(sk);
    // ONE continuous field, lift already folded in — see tyreHeight. The kerb
    // is faired rather than stepped, so a wheel crossing it is a shoulder and
    // not a stair.
    const g = tyreHeight(wxw, wzw, sk, prevGround ?? groundAt(wxw, wzw));
    rawSum += g;
    smooth.push(g);
    contacts.push(g + roughNoise(wxw, wzw) * sw.rough);
  }
  prevGround = rawSum / 4;
  const [cFL, cFR, cRL, cRR] = smooth;
  const ground = (cFL + cFR + cRL + cRR) / 4;
  const tY = ground + WHEEL_R; // axle-plane target
  const drive = brake ? -Math.sign(state.speed) * CAR.brake : throttle * (throttle >= 0 ? CAR.accel : CAR.brake);
  // ATAN, not asin. The argument is rise over run — a TANGENT — and asin of a
  // tangent both under-reports every slope and saturates: clamped at 0.45 it
  // could not express more than 27 degrees. On anything steeper the body stayed
  // flat while the ground fell away, the suspension ran out of droop, and
  // `groundedF` went to zero — so the truck lost thrust, braking, steering AND
  // gravity exactly when it was on the steepest ground. That is what made hills
  // feel uncontrollable, and no amount of extra gravity would have fixed it,
  // because gravity is multiplied by the grip that had just vanished.
  const tPitch = clamp(Math.atan((cFL + cFR - cRL - cRR) / 2 / (2 * AXLE)), -1.0, 1.0)
    + clamp(drive * 0.004, -0.06, 0.06); // throttle squat / brake dive
  const tRoll = clamp(Math.atan((cFR + cRR - cFL - cRL) / 2 / (2 * TRACK)), -1.0, 1.0)
    + clamp(steerCur * Math.abs(state.speed) * 0.004, -0.09, 0.09); // lean out of the corner
  // atan2, not asin: the pitch/roll above are clamped for the BODY's benefit
  // (a 45 degree lean looks wrong), but gravity should see the real angle.
  gradePitch = Math.atan2((cFL + cFR - cRL - cRR) / 2, 2 * AXLE);
  gradeRoll = Math.atan2((cFR + cRR - cFL - cRL) / 2, 2 * TRACK);
  if (!bodyInit) { bodyInit = true; bodyY = tY; pitchC = tPitch; rollC = tRoll; }
  // SNAP when the ground moves further than any suspension could follow. The
  // body descends at 9.81 and no faster (that cap is what makes crests launch
  // you), so after anything that repositions the truck — a spawn, a curated
  // start, a shove out of a building, a tunnel chord, terrain streaming in at a
  // different height — it can be left hundreds of metres in the air, falling
  // for tens of seconds with all four wheels drooped and therefore ZERO grip:
  // no thrust, no braking, no steering, no gravity. Measured 3.9km of daylight
  // under the hull after a relocation.
  if (Math.abs(tY - bodyY) > 6) { bodyY = tY; vBodyY = 0; pitchC = tPitch; rollC = tRoll; }
  // THE DESCENT BUG. Capping downward acceleration at 1g is what makes a crest
  // launch the truck, and it must stay — but it was applied in the WORLD frame,
  // against a damper that wanted vBodyY = 0. On a sustained descent the ground
  // is not standing still: at 20m/s down a 20° grade it falls away at 7.3m/s,
  // and a body starting from zero needs 0.75s of free fall to match it — during
  // which it is 2.7m behind, twelve times the suspension's droop. All four
  // wheels hang, groundedF goes to zero, and with it thrust, braking, steering
  // and gravity. Every dip re-triggered it, which is exactly why downhill felt
  // like ice and uphill (where the spring PUSHES, uncapped, at k=55) felt fine.
  //
  // So the damper chases the ground's own vertical rate instead of zero. Its
  // steady state on a constant grade is "planted, wheels loaded", and the 1g
  // floor now only bites where the grade BREAKS — which is the launch we wanted.
  // DOWNWARD ONLY. Climbing, the ground rises to meet a spring that is already
  // pushing up at k=55 with nothing capping it, and that case was always fine —
  // feeding it a positive reference instead had the damper shove the body
  // skyward at 8.5×10.9 = 93m/s², which launched the truck off every hill it
  // drove up. Measured: uphill grip fell from 1.00 to 0.26 before this clamp.
  const terrainVy = clamp(state.speed * Math.tan(gradePitch), -28, 0);
  // The SOFTNESS dial moves the spring; worn dampers only lose damping, which
  // is what a tired damper actually does — the truck starts to float and keep
  // moving after the bump has finished, and the wheels spend longer light.
  const sK = tune.susp, sD = rigDamp();
  let aY = SUSP.k * sK * (tY - bodyY) - SUSP.d * sD * (vBodyY - terrainVy);
  if (aY < -9.81) aY = -9.81; // falling is gravity's job — crests launch
  vBodyY += aY * dt; bodyY += vBodyY * dt;
  if (bodyY < tY - SUSP.travel) {
    bodyY = tY - SUSP.travel;
    if (vBodyY < 0) { if (vBodyY < -2.5) audio.thud(Math.min(3, -vBodyY / 3)); vBodyY *= -0.25; } // bump stop
  }
  vPitch += (SUSP.ka * sK * (tPitch - pitchC) - SUSP.da * sD * vPitch) * dt; pitchC += vPitch * dt;
  vRoll += (SUSP.ka * sK * (tRoll - rollC) - SUSP.da * sD * vRoll) * dt; rollC += vRoll * dt;
  // Articulation: wheels chase their own contact while the sprung body lags.
  groundedF = 0;
  for (let i = 0; i < 4; i++) {
    const [wx, wz] = WHEELS[i];
    // TAN, to match the atan above. The wheel's ground sample is taken at a
    // horizontal offset of wz, so the terrain rises by wz*tan(grade) across it
    // — a sin here needed pitchC = asin(tan(grade)), which has no solution past
    // 45 degrees and is why the old model capped out and let go of the ground.
    const plane = bodyY - wz * Math.tan(pitchC) + wx * Math.tan(rollC);
    const def = clamp(contacts[i] + WHEEL_R - plane, -SUSP.droop, SUSP.travel);
    // A RAMP, not a step. A wheel three centimetres off full droop used to
    // count for nothing at all, so grip fell off a cliff over a single frame
    // and the truck went from planted to helpless with no warning through the
    // controls. Load fades in over the last 10cm of extension instead.
    groundedF += 0.25 * clamp((def + SUSP.droop) / 0.1, 0, 1);
    wheelPivots[i].position.y = def;
    wheelMeshes[i].scale.y = 1 - (0.1 * Math.max(0, def)) / SUSP.travel; // tire give under load
    wheelMeshes[i].rotation.x = wheelSpin;
    if (i < 2) wheelPivots[i].rotation.y = -steerCur * 0.42;
  }
  dbgSusp = { bodyY: +bodyY.toFixed(2), tY: +tY.toFixed(2), ground: +ground.toFixed(2),
    defs: wheelPivots.map((p) => +p.position.y.toFixed(3)),
    contacts: contacts.map((c) => +c.toFixed(2)),
    pitch: +((pitchC * 180) / Math.PI).toFixed(1), grounded: groundedF };
  // With no load the wheels follow the ENGINE, not the road — so they blur up
  // over a jump and are still spinning when the truck lands.
  wheelSpin += ((groundedF > 0.06 ? state.speed : engRev * 26 * (throttle < -0.02 ? -1 : 1)) / WHEEL_R) * dt;
  car.position.set(state.x, bodyY, state.z);
  car.rotation.set(pitchC, -state.heading, rollC);
  // Brake lights flare; reversing washes them pale. Beams brighten with the
  // dust they have to cut through, and dim in the chart view where a pair of
  // 34m cones would just be glare on the map.
  // Idle lenses have to out-saturate the body they sit on — 0x8e1a12 vanished
  // against 0xc4402c paint the moment the truck was in its own shadow.
  tailMat.color.setHex(brake ? 0xff3a24 : state.speed < -0.5 ? 0xe8ded0 : 0xa8221a);
  // Volumetric beam: strongest where the eye is nearly in line with it.
  beamMat.uniforms.uAmp.value = camMode === 'cab' ? 1.25 : camMode === 'chase' ? 1 : 0.25;
  // Feed the signs the headlight they answer to: one uniform write for the
  // whole roadside. Taken from the LAMP, not the hull centre — a sign a few
  // metres ahead is well inside the cone from the bumper and outside it from
  // the middle of the truck. Dimmed in daylight, because a retroreflector that
  // out-blooms the sun is a party trick, not a road sign.
  beamProbe.uBeamPos.value.set(state.x + sinH * 2.3, bodyY + 0.75, state.z - cosH * 2.3);
  beamProbe.uBeamDir.value.set(sinH, -0.06, -cosH).normalize();
  // This world is permanently golden hour — there is no night to switch on for
  // — so the effect is scaled to the light that DOES vary: cloud. Under a storm
  // the ambient drops and the boards answer harder, which is exactly when a
  // driver wants them and when the bloom has some dark to sit against.
  // Retroreflection is an ANGLE, and from the driver's seat that angle is
  // almost exactly zero — which is the entire physical reason road signs are
  // built this way, so the cab is where they should blaze.
  beamProbe.uBeamAmt.value = (camMode === 'cab' ? 1.5 : camMode === 'chase' ? 1 : 0.35) * (0.55 + 0.45 * wx.cloud);
  // Dust off the loose stuff — rate follows speed, thrown back along travel.
  const v = Math.abs(state.speed);
  if (v > 3 && groundedF > 0.2) {
    const anyWater = wheelSurf.some((k) => k === 'water');
    // Wet ground raises no dust — but water itself throws plenty.
    // A sliding tyre tears up far more than a rolling one.
    dustBudget += v * dt * (anyWater ? 2.2 : 1.15 * (1 - wx.wet * 0.9)) * (1 + skid * 1.7);
    while (dustBudget >= 1) {
      dustBudget -= 1;
      // WATER throws from the FRONT wheels — that is where a bow wave comes
      // from; dry ground throws from the rears, where the drive is.
      const water = wheelSurf[0] === 'water' || wheelSurf[2] === 'water';
      const i = water ? Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 2);
      // Tarmac raises nothing — unless the tyres are sliding across it, which
      // raises smoke.
      if (wheelSurf[i] === 'road' && skid < 0.3) continue;
      const [wxw, wzw] = wheelWorld[i];
      const wet = wheelSurf[i] === 'water';
      // Barely any launch velocity: dust is LEFT BEHIND, not thrown backward.
      // Pushing it back down the heading drove it straight into the chase
      // camera and greyed out the whole view.
      emitDust(wxw, contacts[i], wzw, -sinH * v * 0.05, cosH * v * 0.05, wet);
      if (wet) {
        // The WAKE: a pair of droplets thrown sideways from the hull, so the
        // truck leaves a widening V behind it rather than a plume.
        const side = (Math.random() < 0.5 ? 1 : -1) * (1.1 + Math.random() * 0.6);
        emitDust(state.x + cosH * side, contacts[i], state.z + sinH * side,
          cosH * side * 2.2 - sinH * v * 0.1, sinH * side * 2.2 + cosH * v * 0.1, true);
      } else if (Math.random() < 0.1) audio.stone(); // the pings ride the same plume

    }
  } else dustBudget = 0;
  stepDust(dt);
  flushTerrain(now);
  // The sea keeps its station off a coast and stands down over dry basins.
  // Slewed, not snapped: the transition happens kilometres before the basin
  // floor is reachable, and a falling waterline reads as the lake this basin
  // once was rather than a render toggle.
  if (seaOn) {
    const sl = seaLevelY();
    const target = sl ?? groundAt(state.x, state.z) - 60;
    sea.position.y += clamp(target - sea.position.y, -0.5, 0.5);
  }
  if (wildlifeOn) stepWildlife(dt);
  stepOdo(dt, now);
  // The rig's condition, from the frame that just happened. SUN_DIR.y is the
  // sun's elevation, so it doubles as "is the array making anything".
  {
    const prevV = rigPrevV; rigPrevV = state.speed;
    if (dt > 0) rig.accel += ((state.speed - prevV) / dt - rig.accel) * Math.min(1, 6 * dt);
    // A LANDING: airborne last frame, planted this frame, with the body still
    // falling hard. This is where jumps and drops spend the rig.
    if (groundedF > 0.5 && rigPrevGrounded < 0.2 && vBodyY < -5) {
      rigLanding(clamp((-vBodyY - 5) / 9, 0, 1));
    }
    rigPrevGrounded = groundedF;
    // The array sees the TRUE sun, not the raked moonlight vector: at night it
    // makes nothing, which is the whole reason the pack matters.
    stepRig(dt, Math.abs(state.speed), surfQual,
      Math.max(0, Math.sin(sunAlt)) * (1 - wx.cloud * 0.2));
    // SERVICE. Stop beside somewhere that plausibly has tools — a marked
    // garage or fuel stop heals fast, any named building slowly — and the rig
    // is worked on while you wait. Driving off stops the work.
    rig.svc = false;
    if (dt > 0 && Math.abs(state.speed) < 0.8) {
      for (const poi of pois.values()) {
        if (poi.kind !== 'repair' && poi.kind !== 'place') continue;
        if (Math.hypot(poi.x - state.x, poi.z - state.z) > POI_RANGE) continue;
        rig.svc = true;
        const rate = poi.kind === 'repair' ? 3 : 1;
        rig.batt = clamp(rig.batt + dt * 0.02 * rate, 0, 1);
        for (const k of ['tyre', 'hull', 'susp'] as const) rig[k] = clamp(rig[k] + dt * 0.008 * rate, 0, 1);
        break;
      }
    }
  }
  stepMission(now);
  stepSurvey(now);
  // THE CAR IS EVIDENCE TOO. Dry-land proof used to come only from a ribbon
  // being built, and Badwater Road is a single OSM way — so it fired once, at
  // the spawn, and never again. Drive 8km up the valley and the anchor was
  // left behind, the sea judged itself back on, and Death Valley flooded to
  // absolute zero around a truck standing on its floor. Sitting on a road
  // below sea level is the same proof, and it follows you.
  if (seaOn && (surfKind === 'road' || surfKind === 'track')) {
    noteDryLand(state.x, state.z, groundAt(state.x, state.z));
  }
  if (now > vegAt) { vegAt = now + 900; refreshVeg(); }
  audio.update(state.speed, throttle, surfKind, groundedF, wx.rain, engRev, engGear, skid);
  reveal(state.x, state.z);
  if (now > streamAt) { streamAt = now + 1200; streamWorld(state.x, state.z); }
  // Two rigs. TOP: the chart view, tilted a touch for relief. CHASE: low and
  // behind, where speed is legible and the fog reads as a night horizon.
  const fwdX = Math.sin(state.heading), fwdZ = -Math.cos(state.heading);
  if (camMode === 'top') {
    zoomCur += (zoomT - zoomCur) * Math.min(1, 8 * dt);
    // The coarse shell is a backdrop for the wide view and nothing else: shown
    // only once the frustum reaches past the fine ring, so its seam is never
    // on screen at an angle that could reveal it.
    farGroup.visible = zoomCur > 6;
    halo.scale.setScalar(Math.max(1, zoomCur)); // the ring must survive the zoom-out
    // Pan is a glance around the chart — it drifts home once you drive.
    if (stick || Math.abs(state.speed) > 6) { const f = Math.exp(-2.5 * dt); panX *= f; panZ *= f; }
    const dist = CAM.base * zoomCur + Math.abs(state.speed) * 3.6 * CAM.perKmh;
    const tiltRad = (CAM.tilt * Math.PI) / 180;
    const tgtY = sampleHeight(state.x + panX, state.z + panZ);
    camPos.set(state.x + panX, tgtY + dist * Math.sin(tiltRad), state.z + panZ + dist * Math.cos(tiltRad));
    // PUSH THE NEAR PLANE OUT with the camera. Depth precision is governed by
    // the near/far RATIO, and at 1:30000 a lake drape sitting a few centimetres
    // over the terrain lands in the same depth bucket as the ground — which is
    // the flicker, and it gets worse the further out you zoom. Nothing is
    // within 8% of the orbit distance from a camera tilted 70° off the ground,
    // so this is free.
    setNear(Math.max(1, dist * 0.08), Math.max(30000, dist * 4));
  } else if (camMode === 'cab') {
    farGroup.visible = false;
    // THE DRIVER'S SEAT. The eye is a point on the body, so it takes the body's
    // whole attitude — pitch, roll and the suspension's own heave — which is
    // what makes a cattle grid felt rather than watched. Everything else in
    // this branch exists because you are now inside the shell: the near plane
    // has to clear the dashboard, and the aim point rides the same rotation
    // rather than a fixed world offset, or the truck would appear to steer
    // separately from the view through its own screen.
    setNear(0.12);
    const cs = Math.cos(pitchC), sn = Math.sin(pitchC);
    // The car's own basis: forward is -z in model space, and the group is
    // rotated (pitchC, -heading, rollC) in YXZ order.
    const eyeLocalY = EYE.y * cs - EYE.z * sn;
    const eyeLocalZ = EYE.y * sn + EYE.z * cs;
    const rx = Math.cos(state.heading), rz = Math.sin(state.heading);   // the car's right
    camPos.set(
      state.x + rx * EYE.x + fwdX * -eyeLocalZ,
      bodyY + eyeLocalY,
      state.z + rz * EYE.x + fwdZ * -eyeLocalZ,
    );
    // Look down the bonnet, 40m out, carrying pitch so a crest shows sky and a
    // descent shows road.
    camAim.set(
      camPos.x + fwdX * 40 * cs,
      camPos.y - Math.sin(pitchC) * 40,
      camPos.z + fwdZ * 40 * cs,
    );
  } else {
    farGroup.visible = false;
    setNear(1);
    // Framed like the reference art: the rig in the lower third with the track
    // running to a vanishing point. On a PORTRAIT phone the 55° figure is the
    // VERTICAL fov, so the horizontal one is only ~30° — at 12.5m the truck ate
    // half the width. Stand off far enough that it reads as a vehicle in a
    // landscape, and sit high enough to look over its own dust.
    // Distances came down with the truck: on the spec-sheet body (2.15m wide
    // against the old 3.08m) the previous stand-off left it a speck.
    const back = 13 + Math.abs(state.speed) * 0.26;
    camPos.set(
      state.x - fwdX * back,
      // ABOVE the vehicle, always: on a steep climb the ground under the
      // camera is far below the truck, so tie the floor to the body and add
      // pitch lift to keep looking down the slope at it.
      Math.max(
        groundAt(state.x - fwdX * back, state.z - fwdZ * back) + 4.6,
        bodyY + 4.0 + Math.max(0, Math.sin(pitchC)) * back,
      ),
      state.z - fwdZ * back,
    );
    // Building in the sight line? Slide the camera in front of the façade
    // (and down toward the truck) rather than phasing through the wall.
    const hit = wallHitAlong(state.x, state.z, camPos.x, camPos.z, camPos.y);
    if (hit < 1) {
      const s = Math.max(0.18, hit - 0.08);
      camPos.set(
        state.x + (camPos.x - state.x) * s,
        Math.max(bodyY + 2.6, camPos.y - (1 - s) * (camPos.y - bodyY - 2.6)),
        state.z + (camPos.z - state.z) * s,
      );
    }
  }
  // Critically-damped-ish follow: snap on mode change, ease in play (the chase
  // rig swings through corners instead of being welded to the bumper).
  // The cab is WELDED to the body — no smoothing at all. A lerped eye lags the
  // shell it is supposed to be inside, and at 25/s that reads as the whole
  // truck sliding around the camera every time you turn in.
  if (!camInit || camMode === 'cab') { camera.position.copy(camPos); camInit = true; }
  else camera.position.lerp(camPos, 1 - Math.exp(-(camMode === 'top' ? 10 : 4.5) * dt));
  if (camMode === 'top') camera.lookAt(state.x + panX, sampleHeight(state.x + panX, state.z + panZ), state.z + panZ);
  else if (camMode === 'cab') { camera.lookAt(camAim); camera.rotateZ(-rollC); }
  else camera.lookAt(state.x + fwdX * 28, ground + 1.4, state.z + fwdZ * 28);
  camera.updateMatrixWorld();
  skyDome.position.copy(camera.position);
  ghostU.uGhostCar.value.set(state.x, ground + 1.2, state.z);
  ghostU.uGhostCam.value.copy(camera.position);
  compMat.uniforms.camPos.value.copy(camera.position);
  // Where the sun sits on screen, for the flare. Occlusion is left to the
  // shader (one depth fetch); here we only ask whether it is in frame at all.
  sunScreen.copy(SUN_DIR).multiplyScalar(9000).add(camera.position).project(camera);
  const onScreen = sunScreen.z < 1 && Math.abs(sunScreen.x) < 1.5 && Math.abs(sunScreen.y) < 1.5;
  compMat.uniforms.uSunUv.value.set(sunScreen.x * 0.5 + 0.5, sunScreen.y * 0.5 + 0.5);
  compMat.uniforms.uSunVis.value = onScreen
    ? clamp(1 - Math.max(Math.abs(sunScreen.x), Math.abs(sunScreen.y)) * 0.55, 0, 1) * (1 - wx.cloud * 0.85)
    : 0;
  compMat.uniforms.invPV.value.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse).invert();
  drawHud(surfKind, surfQual, Math.round(Math.abs(state.speed) * 3.6), groundedF);
  if (camMode !== 'top' && now > miniAt) { miniAt = now + 250; drawMinimap(); }
  updatePois(); // every frame — throttled pins juddered against the camera
  // Progress lives in the URL: reloading resumes here, not at the spawn.
  if (now > urlAt) {
    urlAt = now + 3000;
    const dh = Math.abs(Math.atan2(Math.sin(state.heading - urlH), Math.cos(state.heading - urlH)));
    if (Math.hypot(state.x - urlX, state.z - urlZ) > 8 || dh > 0.3) {
      urlX = state.x; urlZ = state.z; urlH = state.heading;
      const [la, lo] = localToLatLon(state.x, state.z);
      writeUrl(la, lo);
    }
  }
  // scene → target, two separable blur rounds at half res, composite to canvas
  renderer.setRenderTarget(rtScene);
  renderer.render(scene, camera);
  blurMat.uniforms.src.value = rtScene.texture; blurMat.uniforms.dirPx.value.set(1 / rtA.width, 0); runPass(blurMat, rtA);
  blurMat.uniforms.src.value = rtA.texture; blurMat.uniforms.dirPx.value.set(0, 1 / rtA.height); runPass(blurMat, rtB);
  blurMat.uniforms.src.value = rtB.texture; blurMat.uniforms.dirPx.value.set(2 / rtA.width, 0); runPass(blurMat, rtA);
  blurMat.uniforms.src.value = rtA.texture; blurMat.uniforms.dirPx.value.set(0, 2 / rtA.height); runPass(blurMat, rtB);
  // Bright-pass, then two blur rounds of its own — bloom must not reuse the
  // depth-of-field blur, which is built from the WHOLE image.
  brightMat.uniforms.src.value = rtScene.texture; runPass(brightMat, rtC);
  blurMat.uniforms.src.value = rtC.texture; blurMat.uniforms.dirPx.value.set(1.5 / rtC.width, 0); runPass(blurMat, rtD);
  blurMat.uniforms.src.value = rtD.texture; blurMat.uniforms.dirPx.value.set(0, 1.5 / rtC.height); runPass(blurMat, rtC);
  compMat.uniforms.sceneTex.value = rtScene.texture;
  compMat.uniforms.softTex.value = rtB.texture;
  compMat.uniforms.bloomTex.value = rtC.texture;
  runPass(compMat, null);
  if (camMode === 'top') {
    // The dock's POV preview: raw scene from the chase rig, scissored into
    // the corner over the composite (autoClear respects the scissor).
    const dr = dockRect;
    const vx = dr.x * hudS, vy = innerHeight - (dr.y + dr.h) * hudS, vw = dr.w * hudS, vh = dr.h * hudS;
    miniCam.position.set(
      state.x - fwdX * 11,
      Math.max(groundAt(state.x - fwdX * 11, state.z - fwdZ * 11) + 4.3, bodyY + 3.6),
      state.z - fwdZ * 11,
    );
    miniCam.lookAt(state.x + fwdX * 20, ground + 1.3, state.z + fwdZ * 20);
    halo.visible = false; // the zoom-scaled chart ring has no place in the POV
    // Through the SAME low-res target, nearest magnification, sRGB encode,
    // grade and palette dither as the world. Rendered straight to the screen it
    // was a smooth, full-colour window inside a hand-built bitmap HUD — the one
    // thing on screen that did not look like the game.
    blitPixelated(scene, miniCam, vx, vy, vw, vh);
    halo.visible = true;
  }
  if (vehRect.w > 0) renderStudio(dt);
  // The stick rides the truck in the chart view, so its home moves whenever the
  // truck or the pan does — which is every frame, not just on resize.
  if (camMode === 'top' && !stick) updateStickHome();
  requestAnimationFrame(tick);
}
// The menu's vehicle bay. The truck is BORROWED out of the world into the
// studio for one render and handed straight back — no clone to drift out of
// sync with the model, and a clean backdrop instead of whatever weather the
// world happens to be having.
// Render a scene into a corner of the screen THROUGH the world's pixel grid:
// a low-res target, nearest magnification, and the same encode/grade/palette
// the composite ends on. Both insets — the POV dock and the vehicle bay — go
// through here, because a smooth full-colour window inside a bitmap HUD reads
// as a leak from another program.
function blitPixelated(
  what: THREE.Scene, cam: THREE.Camera, vx: number, vy: number, vw: number, vh: number, clear = 0x05070c,
): void {
  const grid = PIX_H / Math.max(1, innerHeight);   // same pixels per metre as the world
  const rw = Math.max(2, Math.round(vw * grid)), rh = Math.max(2, Math.round(vh * grid));
  rtVeh.setSize(rw, rh);
  vehCopyMat.uniforms.uPix.value.set(rw, rh);
  vehCopyMat.uniforms.uLevels.value = (compMat.uniforms.uLevels as { value: number }).value;
  renderer.setRenderTarget(rtVeh);
  renderer.setClearColor(clear, 1);
  renderer.clear(true, true, false);
  renderer.render(what, cam);
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x05070c, 1);
  renderer.setScissorTest(true);
  renderer.setViewport(vx, vy, vw, vh);
  renderer.setScissor(vx, vy, vw, vh);
  vehCopyMat.uniforms.src.value = rtVeh.texture;
  runPass(vehCopyMat, null);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
}
function renderStudio(dt: number): void {
  studioSpin += dt * 0.45;
  const vx = vehRect.x * hudS, vw = vehRect.w * hudS, vh = vehRect.h * hudS;
  const vy = innerHeight - (vehRect.y + vehRect.h) * hudS;
  const pos = car.position.clone(), rot = car.rotation.clone();
  const haloWas = halo.visible, spotWas = headSpot.visible;
  const beamWas = beams.map((b) => b.visible);
  // Beam cones are 26m long; at 8m from the camera they would fill the bay
  // with additive haze. Chart furniture and the headlamp pool go too.
  halo.visible = false;
  headSpot.visible = false;
  for (const b of beams) b.visible = false;
  studio.add(car);                       // reparent: three removes it from `scene`
  car.position.set(0, 0, 0);
  const aspect = vw / Math.max(1, vh);
  let cam: THREE.Camera = studioCam;
  // An ELEVATION has to be a drawing, not a snapshot: freeze the suspension,
  // the steering and the wheel spin so what you are comparing against the sheet
  // is the model, not whatever the truck was doing when you opened the menu.
  const susp = wheelPivots.map((p) => ({ y: p.position.y, ry: p.rotation.y }));
  const spin = wheelMeshes.map((w) => w.rotation.x);
  if (vehView === 0) {
    car.rotation.set(0, studioSpin, 0);
    // Far enough that a 4.9m truck fits broadside: the 30° figure is the
    // VERTICAL fov, and at 8m the nose and the spare were cropped off the
    // sides every time it turned side-on.
    const dist = 10.5;
    studioCam.aspect = aspect;
    // Low, like the sheet's side elevations — looking down on it flattened the
    // cab into the roof rack.
    studioCam.position.set(Math.sin(0.9) * dist, 2.1, Math.cos(0.9) * dist);
    studioCam.lookAt(0, 1.05, 0);
    studioCam.updateProjectionMatrix();
  } else {
    const v = VIEWS[vehView];
    car.rotation.set(0, 0, 0);
    for (const p of wheelPivots) { p.position.y = 0; p.rotation.y = 0; }
    for (const w of wheelMeshes) w.rotation.x = 0;
    const { hw, hh } = orthoExtents(vehView, aspect);
    studioOrtho.left = -hw; studioOrtho.right = hw;
    studioOrtho.top = hh; studioOrtho.bottom = -hh;
    studioOrtho.updateProjectionMatrix();
    // Ortho: the stand-off only has to clear the far plane, so park it well out
    // and aim through the hull's centre.
    const c = specBox.getCenter(new THREE.Vector3());
    studioOrtho.up.set(v.up[0], v.up[1], v.up[2]);
    studioOrtho.position.set(c.x - v.dir[0] * 40, c.y - v.dir[1] * 40, c.z - v.dir[2] * 40);
    studioOrtho.lookAt(c);
    cam = studioOrtho;
  }
  // Lighter than it looks: the copy pass applies the world's contrast curve,
  // which crushes a near-black backdrop to flat black.
  blitPixelated(studio, cam, vx, vy, vw, vh, 0x17343d);
  wheelPivots.forEach((p, i) => { p.position.y = susp[i].y; p.rotation.y = susp[i].ry; });
  wheelMeshes.forEach((w, i) => { w.rotation.x = spin[i]; });
  scene.add(car);                        // and hand it back
  car.position.copy(pos);
  car.rotation.copy(rot);
  halo.visible = haloWas;
  headSpot.visible = spotWas;
  beams.forEach((b, i) => { b.visible = beamWas[i]; });
}

// Dress every palette-driven surface from one biome. Declared late so it can
// reach the sky, the composite, the lights and the sea alike.
function applyBiome(b: Biome): void {
  biome = b;
  // The herd is built at module load, before the spawn's biome is known — so
  // re-roll which species are out there whenever the biome actually lands.
  for (const c of graze) c.sp = pickSpecies();
  // The six sky colours are the DAYLIGHT versions of themselves; how much of
  // each survives depends on where the sun is, so the clock paints them.
  applySkyTint();
  sun.intensity = b.sunI;
  hemi.color.setHex(b.hemiSky); hemi.groundColor.setHex(b.hemiGnd); hemi.intensity = b.hemiI;
  // The sea takes the biome's own shallows, so a tropical coast isn't the
  // same water as a boreal one.
  const shallow = b.ramp[0][1];
  seaMat.color.setRGB(shallow[0] * 2.2, shallow[1] * 2.2, shallow[2] * 2.2);
}

// ── pixel font ─────────────────────────────────────────────────────
// A real 5x7 bitmap font, not a system font shrunk down. Each glyph is seven
// rows of five bits, base32-encoded (0-v = 0-31, bit 4 leftmost). Drawn as
// literal rectangles into the low-res HUD buffer, so every stroke lands on the
// pixel grid — the thing a hinted, anti-aliased system font can never do.
const GLYPHS: Record<string, string> = {
  ' ': '0000000', A: 'ehhvhhh', B: 'uhhuhhu', C: 'ehggghe', D: 'sihhhis', E: 'vgguggv',
  F: 'vgguggg', G: 'ehgnhhf', H: 'hhhvhhh', I: 'e44444e', J: '72222ic', K: 'hikokih',
  L: 'ggggggv', M: 'hrllhhh', N: 'hhpljhh', O: 'ehhhhhe', P: 'uhhuggg', Q: 'ehhhlid',
  R: 'uhhukih', S: 'fgge11u', T: 'v444444', U: 'hhhhhhe', V: 'hhhhha4', W: 'hhhllrh',
  X: 'hha4ahh', Y: 'hha4444', Z: 'v1248gv',
  '0': 'ehjlphe', '1': '4c4444e', '2': 'eh1248v', '3': 'v4221he', '4': '26aiv22',
  '5': 'vgu11he', '6': '68guhhe', '7': 'v124888', '8': 'ehhehhe', '9': 'ehhf12c',
  '.': '00000cc', ',': '0000c48', ':': '0cc0cc0', '/': '122488g', '-': '000v000',
  '%': 'hi4449h', '·': '000c000', '!': '4444404', '?': 'eh12404', '(': '2488842',
  ')': '8422248', '+': '044v440', '>': '8421248', '<': '248g842', '=': '00v0v00',
  '#': 'alvlvla', '*': '04ava40', '"': 'aa00000', "'": '4400000', '°': 'cic0000',
};
// A 3x5 face for secondary text. You cannot half-scale a bitmap font — 5x7 at
// 0.5 is mush — so small text gets its own grid: three bits a row, five rows,
// octal-encoded. Roughly half the area of the 5x7, still perfectly crisp.
const GLYPHS_S: Record<string, string> = {
  ' ': '00000', A: '25755', B: '65656', C: '34443', D: '65556', E: '74647', F: '74644',
  G: '34553', H: '55755', I: '72227', J: '11152', K: '55655', L: '44447', M: '57755',
  N: '57555', O: '25552', P: '65644', Q: '25563', R: '65655', S: '34216', T: '72222',
  U: '55557', V: '55552', W: '55775', X: '55255', Y: '55222', Z: '71247',
  '0': '75557', '1': '26227', '2': '61247', '3': '61216', '4': '55711', '5': '74616',
  '6': '34652', '7': '71222', '8': '25252', '9': '25316',
  '.': '00002', ',': '00024', '·': '00200', '-': '00700', '>': '42124', '<': '12421',
  '/': '11244', "'": '22000', ':': '02020', '!': '22202', '?': '61202', '%': '52125',
};
const B32 = '0123456789abcdefghijklmnopqrstuv';
const FW = 5, FH = 7;
function glyphRows(ch: string): string {
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS['?'];
}
/** Width in pixels of `s` at scale `sc` (1px letter spacing). */
const textW = (s: string, sc = 1): number => s.length * (FW + 1) * sc;
/** The 3x5 face: width, and a draw that mirrors `text` on the smaller grid. */
const textSW = (s: string): number => s.length * 4;
/** `fit` for the 3x5 micro font — the 5x7 version truncates it by a third. */
const fitS = (s: string, maxPx: number): string => {
  const n = Math.max(1, Math.floor(maxPx / 4));
  return s.length <= n ? s : `${s.slice(0, n - 1)}.`;
};
function textSmall(c: CanvasRenderingContext2D, s: string, x: number, y: number, col: string): void {
  c.fillStyle = col;
  let cx = x;
  for (const ch of s) {
    // Same system-font escape hatch the 5x7 face has. Without it the micro font
    // silently mapped every unknown character to '?', so a POI pin in Giza or
    // Reykjavík came out as a row of question marks — the curated destinations
    // walk straight into Arabic and Icelandic, which is how this surfaced.
    if (!GLYPHS_S[ch] && !GLYPHS_S[ch.toUpperCase()] && ch !== ' ') {
      c.font = '6px ui-monospace, monospace';
      c.textAlign = 'left';
      c.fillText(ch, cx, y + 5);
      c.fillStyle = col;
      cx += 4;
      continue;
    }
    const rows = GLYPHS_S[ch] ?? GLYPHS_S[ch.toUpperCase()] ?? GLYPHS_S['?'];
    for (let r = 0; r < 5; r++) {
      const bits = Number(rows[r]);
      if (!bits) continue;
      for (let b = 0; b < 3; b++) if (bits & (1 << (2 - b))) c.fillRect(cx + b, y + r, 1, 1);
    }
    cx += 4;
  }
}
/** Hard-truncate to fit a pixel width — no ellipsis glyph in a 5x7 font. */
const fit = (s: string, maxPx: number): string => {
  const n = Math.max(1, Math.floor(maxPx / (FW + 1)));
  return s.length <= n ? s : `${s.slice(0, n - 1)}.`;
};
function text(c: CanvasRenderingContext2D, s: string, x: number, y: number, col: string, sc = 1): void {
  c.fillStyle = col;
  let cx = x;
  for (const ch of s) {
    // Anything outside the bitmap set — Arabic, Yi, accented Latin — is drawn
    // from the system font at glyph size. It lands on the same low-res buffer
    // and gets magnified with everything else, so a Cairo or Tromsø place name
    // still reads as pixels rather than as a row of '?'.
    if (!GLYPHS[ch] && !GLYPHS[ch.toUpperCase()] && ch !== ' ') {
      c.font = `${FH * sc}px ui-monospace, monospace`;
      c.textAlign = 'left';
      c.fillText(ch, cx, y + FH * sc);
      cx += (FW + 1) * sc;
      continue;
    }
    const rows = glyphRows(ch);
    for (let r = 0; r < FH; r++) {
      const bits = B32.indexOf(rows[r]);
      if (bits <= 0) continue;
      for (let b = 0; b < FW; b++) {
        if (bits & (1 << (FW - 1 - b))) c.fillRect(cx + b * sc, y + r * sc, sc, sc);
      }
    }
    cx += (FW + 1) * sc;
  }
}

// ── HUD: one low-res canvas, drawn in the pixel font ───────────────
// The DOM version could never reach the reference: system fonts are hinted
// and anti-aliased, CSS borders sit on CSS pixels, and none of it shares the
// world's pixel grid. Everything is now drawn into a buffer roughly a third
// of screen resolution and magnified with nearest-neighbour, so the HUD is
// made of the same pixels as the world behind it.
const hud = document.createElement('canvas');
Object.assign(hud.style, {
  position: 'fixed', inset: '0', width: '100%', height: '100%', zIndex: '10',
  pointerEvents: 'none', imageRendering: 'pixelated',
} as Partial<CSSStyleDeclaration>);
hud.classList.add('ui');
document.body.appendChild(hud);
const hctx = hud.getContext('2d')!;
// The reference's limited palette.
const UI = {
  ink: '#0a1417', edge: '#57c9b0', dim: '#3d6f66', text: '#d6efe7', soft: '#7fa39c',
  gold: '#f2c14e', hot: '#e2703a', good: '#6fe0a0', bad: '#d94f4f',
};
let hudS = 3;            // world pixels per HUD pixel
let HW = 2, HH = 2;      // HUD buffer size
function hudResize(): void {
  // Two screen pixels per HUD pixel on a phone: chunky enough to read as
  // 8-bit, fine enough that a place name and the instruments coexist.
  hudS = innerWidth < 760 ? 2 : 3;
  HW = Math.max(80, Math.round(innerWidth / hudS));
  HH = Math.max(80, Math.round(innerHeight / hudS));
  hud.width = HW; hud.height = HH;
  hctx.imageSmoothingEnabled = false;
}
addEventListener('resize', hudResize);
hudResize();
// Panel: 1px rule, corner brackets, dark fill — the reference's whole chrome
// vocabulary in one primitive.
function panel(x: number, y: number, w: number, h: number, edge = UI.edge): void {
  hctx.fillStyle = 'rgba(8,20,23,0.78)';
  hctx.fillRect(x, y, w, h);
  hctx.fillStyle = UI.dim;
  hctx.fillRect(x, y, w, 1); hctx.fillRect(x, y + h - 1, w, 1);
  hctx.fillRect(x, y, 1, h); hctx.fillRect(x + w - 1, y, 1, h);
  hctx.fillStyle = edge;                       // brackets, 4px arms
  for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w - 1, y, -1, 1], [x, y + h - 1, 1, -1], [x + w - 1, y + h - 1, -1, -1]] as const) {
    hctx.fillRect(cx + (dx < 0 ? -3 : 0), cy, 4, 1);
    hctx.fillRect(cx, cy + (dy < 0 ? -3 : 0), 1, 4);
  }
}
// `panel` minus the fill: a border for a hole the RENDERER draws through.
function frame(x: number, y: number, w: number, h: number, edge = UI.edge): void {
  hctx.clearRect(x, y, w, h);
  hctx.fillStyle = UI.dim;
  hctx.fillRect(x, y, w, 1); hctx.fillRect(x, y + h - 1, w, 1);
  hctx.fillRect(x, y, 1, h); hctx.fillRect(x + w - 1, y, 1, h);
  hctx.fillStyle = edge;
  for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w - 1, y, -1, 1], [x, y + h - 1, 1, -1], [x + w - 1, y + h - 1, -1, -1]] as const) {
    hctx.fillRect(cx + (dx < 0 ? -3 : 0), cy, 4, 1);
    hctx.fillRect(cx, cy + (dy < 0 ? -3 : 0), 1, 4);
  }
}
// Legibility WITHOUT a box: a one-pixel dark outline around the glyphs. Boxes
// are reserved for real instruments (things you read a value off, or press);
// labels floating over the world just get an edge.
function textEdgeS(s: string, x: number, y: number, col: string): void {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    textSmall(hctx, s, x + dx, y + dy, 'rgba(4,10,11,0.85)');
  }
  textSmall(hctx, s, x, y, col);
}
function textEdge(s: string, x: number, y: number, col: string, sc = 1): void {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    text(hctx, s, x + dx * sc, y + dy * sc, 'rgba(4,10,11,0.85)', sc);
  }
  text(hctx, s, x, y, col, sc);
}
// Glow on accents the way pixel art does it: the same shape drawn one pixel
// out at low alpha. A real blur would soften the font and undo the point of
// the bitmap grid.
function glowText(s: string, x: number, y: number, col: string, sc = 1): void {
  hctx.globalAlpha = 0.22;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) text(hctx, s, x + dx * sc, y + dy * sc, col, sc);
  hctx.globalAlpha = 1;
  text(hctx, s, x, y, col, sc);
}
function meter(x: number, y: number, n: number, lit: number, col: string, w = 3, h = 5, gap = 1): void {
  for (let i = 0; i < n; i++) {
    hctx.fillStyle = i < lit ? col : 'rgba(87,201,176,0.16)';
    hctx.fillRect(x + i * (w + gap), y, w, h);
  }
}
// One MENU chip holds the affordances, so the top of the screen belongs to the
// compass. It opens a MODAL — a dropdown had nowhere to put a vehicle bay, and
// the sheet this game is drawn from is a page of panels, not a context menu.
interface Item { label: () => string; hit: () => void; col: () => string }
// DRIVE is the splash: the screen the game opens on, and the same screen the
// MENU button opens later. There is no separate title card any more — the
// boot overlay is a progress readout and nothing else, so "start" and "main
// menu" are one place rather than two that say different things.
const TABS = ['DRIVE', 'SURVEY', 'RIG', 'WORLD', 'SYSTEM'];
const T_DRIVE = 0, T_SURVEY = 1, T_RIG = 2, T_WORLD = 3, T_SYSTEM = 4;
const TAB_ITEMS: Item[][] = [
  [
    // The splash's own buttons: go, or change what "go" means. Closing the
    // menu IS starting, which is why this reads DRIVE rather than RESUME —
    // there is nothing behind it that has not already begun.
    { col: () => UI.good, label: () => 'DRIVE', hit: () => { audio.arm(); menuTab = null; } },
    // A mode, not a dial: it changes what every control means.
    {
      col: () => (real.on ? UI.good : real.err ? UI.bad : UI.hot),
      label: () => (real.on ? 'REAL DRIVE ON' : real.err ? fit(real.err, 150) : 'REAL DRIVE'),
      hit: () => {
        if (real.on) { location.href = location.pathname; return; }  // back to the menu, model driving
        startRealDrive();
      },
    },
    { col: () => UI.gold, label: () => 'ELSEWHERE', hit: () => { location.href = location.pathname + '?random=1'; } },
  ],
  [],   // the survey is a readout
  [],   // and so is the vehicle bay
  [
    // SAVE THIS SPOT sits in WORLD, beside the destinations it writes into —
    // the list and the thing that adds to it are one control surface.
    { col: () => UI.gold, label: () => 'SAVE THIS SPOT', hit: () => saveSpot() },
    { col: () => UI.edge, label: () => (alien ? 'SCRIPT ALIEN' : 'SCRIPT PLAIN'), hit: () => toggleAlien() },
  ],
  [
    {
      col: () => (audio.on && audio.state === 'running' ? UI.good : UI.soft),
      label: () => (!audio.on ? 'SOUND OFF' : audio.state === 'running' ? 'SOUND ON' : 'SOUND TAP'),
      hit: () => {
        const blocked = audio.on && audio.state !== 'running';
        audio.arm();
        if (!blocked) audio.toggle();
      },
    },
    { col: () => UI.soft, label: () => 'HIDE HUD', hit: () => { menuTab = null; setClean(true); } },
  ],
];
// ── curated starts ─────────────────────────────────────────────────
// `ELSEWHERE` drops you anywhere on Earth with roads, which is the whole point
// of it — and also means the good stuff is a lottery. These are AUTHORED: real
// coordinates on real roads, each facing the way the place is worth looking at.
// The spawn URL already carries lat/lon, a heading and a camera mode, so a
// drive is nothing more than a composed link — which is also what makes this
// the natural place to hang checkpoints and missions off later.
//
// Names are kept inside the 5x7 bitmap set (no diacritics, no apostrophes);
// anything outside it falls back to the system font and breaks the grid.
// ── missions ───────────────────────────────────────────────────────
// The smallest thing that is actually a mission and not a waypoint: somewhere
// you are GIVEN it, somewhere you have to GET to, and a state that survives the
// drive between them. Both ends are pinned POIs, so the giver does not vanish
// when you park at it and the destination does not vanish because it is 15km
// away — the two failure modes that make a waypoint useless as a mission.
//
// Deliberately data, hung off a curated drive. A second mission is a second
// entry, not a second system.
interface Mission {
  id: string;
  giver: { name: string; lat: number; lon: number };
  title: string;
  brief: string;
  dest: { name: string; lat: number; lon: number };
  /** How close counts as arrived. */
  within: number;
  /** The way you are supposed to take. Arriving is not enough — checkpoints on
   *  this road must be collected, which is the only thing that distinguishes
   *  driving the pass from driving over the mountain at it.
   *
   *  `atLeast` is a COUNT, not a fraction, and defaults to a majority. A
   *  majority is the right rule for claiming a road, where the whole road is
   *  the subject. It is the wrong rule for a job, where the road is only the
   *  route: Chapman's Peak Drive measures 15km of switchbacks and a player
   *  joining it near the headland would drive the pass honestly and still be
   *  refused. A count states what the job actually asks for. */
  via?: { name: string; atLeast?: number };
}
type MissionPhase = 'none' | 'offered' | 'active' | 'done';
let mission: Mission | null = null;
let missionPhase: MissionPhase = 'none';
let missionGiver: Poi | null = null, missionDest: Poi | null = null;
let missionAt = 0;         // when the current phase started (for the banner)
let missionBest = Infinity; // closest approach to the destination so far
/** Seed a mission's two pinned waypoints once the world origin is known. */
function armMission(m: Mission): void {
  mission = m;
  missionPhase = 'offered';
  const [gx, gz] = toLocal(m.giver.lat, m.giver.lon);
  const [dx, dz] = toLocal(m.dest.lat, m.dest.lon);
  missionGiver = { name: m.giver.name, x: gx, z: gz, kind: 'mission', pinned: true };
  missionDest = { name: m.dest.name, x: dx, z: dz, kind: 'mission', pinned: true };
  // The giver is pinned from the start; the destination only appears once the
  // job is taken. A mission you have not accepted should not be telling you
  // where to go.
  pois.set(missionGiver.name, missionGiver);
}
/** Progress along a mission's required way — null when it asks for none. The
 *  survey gate is deliberately NOT applied here. Claiming a road permanently
 *  demands its full extent be known; a job only demands you took it, and by
 *  the time you reach the far end you have streamed the whole road by driving
 *  it. Applying the gate would leave a mission uncompletable on a stretch the
 *  player had honestly driven. */
function viaProgress(m: Mission): { got: number; need: number; met: boolean } | null {
  if (!m.via) return null;
  const r = survey.get(m.via.name);
  const n = r?.cps.length ?? 0;
  const need = m.via.atLeast ?? Math.floor(n / 2) + 1;
  const got = r?.got ?? 0;
  // A road that has not streamed yet reports need 1 and got 0, which is
  // correctly "not met" rather than accidentally "met" on an empty set.
  return { got, need: Math.max(1, need), met: got >= Math.max(1, need) };
}
const viaMet = (m: Mission): boolean => { const v = viaProgress(m); return !v || v.met; };
function stepMission(now: number): void {
  if (!mission) return;
  const near = (p: Poi | null): number => (p ? Math.hypot(p.x - state.x, p.z - state.z) : Infinity);
  if (missionPhase === 'offered' && near(missionGiver) < POI_RANGE) {
    // The prompt is drawn by the HUD; acceptance is a tap on it.
    missionReady = true;
  } else if (missionPhase === 'offered') {
    missionReady = false;
  }
  if (missionPhase === 'active') {
    const d = near(missionDest);
    missionBest = Math.min(missionBest, d);
    if (d < mission.within && viaMet(mission)) {
      missionPhase = 'done';
      missionAt = now;
      if (missionDest) missionDest.pinned = false;
      audio.thud(2);
    }
  }
}
function acceptMission(now: number): void {
  if (!mission || missionPhase !== 'offered' || !missionDest) return;
  missionPhase = 'active';
  missionAt = now;
  missionReady = false;
  pois.set(missionDest.name, missionDest);
  if (missionGiver) missionGiver.pinned = false;
  audio.stone();
}
let missionReady = false;         // in range of the giver, not yet accepted
let missionRect = { x: 0, y: 0, w: 0, h: 0 };

interface Drive { name: string; sub: string; lat: number; lon: number; h: number; mission?: Mission }
const DRIVES: Drive[] = [
  { name: 'PARIS', sub: 'TROCADERO · THE START', lat: 48.8617, lon: 2.289, h: 135 },
  { name: 'LAC ROSE', sub: 'SENEGAL · THE FINISH', lat: 14.839, lon: -17.235, h: 90 },
  { name: 'GIZA', sub: 'EGYPT · THE PYRAMIDS', lat: 29.9765, lon: 31.132, h: 45 },
  { name: 'WADI RUM', sub: 'JORDAN · VALLEY OF THE MOON', lat: 29.5765, lon: 35.42, h: 90 },
  { name: 'SOSSUSVLEI', sub: 'NAMIBIA · THE RED DUNES', lat: -24.728, lon: 15.345, h: 90 },
  { name: 'UYUNI', sub: 'BOLIVIA · THE SALT FLAT', lat: -20.2, lon: -67.5, h: 270 },
  { name: 'DEATH VALLEY', sub: 'BADWATER BASIN', lat: 36.2296, lon: -116.7665, h: 0 },
  { name: 'MONUMENT VALLEY', sub: 'UTAH · US 163', lat: 37.103, lon: -109.993, h: 200 },
  { name: 'BIG SUR', sub: 'CALIFORNIA · HIGHWAY 1', lat: 36.3731, lon: -121.90433, h: 127 },
  { name: 'STELVIO', sub: 'ITALY · 48 HAIRPINS', lat: 46.5285, lon: 10.4541, h: 200 },
  { name: 'TROLLSTIGEN', sub: 'NORWAY · THE TROLL LADDER', lat: 62.4558, lon: 7.671, h: 180 },
  { name: 'TRANSFAGARASAN', sub: 'ROMANIA · THE RIDGE ROAD', lat: 45.6017, lon: 24.6172, h: 180 },
  { name: 'NORDSCHLEIFE', sub: 'EIFEL · THE GREEN HELL', lat: 50.3356, lon: 6.9475, h: 200 },
  { name: 'ICEFIELDS', sub: 'ALBERTA · THE PARKWAY', lat: 52.22, lon: -117.225, h: 160 },
  // Starts at the reserve's admin office on Ou Kaapse Weg, not on the pass
  // itself: a drive should begin somewhere you are GIVEN a reason to go, and
  // end at the thing worth arriving at. The old spawn (-34.079, 18.362) is now
  // the destination.
  {
    name: 'CHAPMANS PEAK', sub: 'CAPE TOWN · THE RUN OUT WEST', lat: -34.08716, lon: 18.42083, h: 290,
    mission: {
      id: 'chapmans-run',
      giver: { name: 'ADMIN OFFICE', lat: -34.08716, lon: 18.42083 },
      title: 'THE RUN OUT WEST',
      brief: 'TAKE THE PASS TO THE HEADLAND',
      dest: { name: 'CHAPMANS PEAK', lat: -34.079, lon: 18.362 },
      // 120, not 90: the pass passes no nearer than 104m to the headland, so a
      // 90m radius could only be reached by leaving the road at the end.
      within: 120,
      // The brief says TAKE THE PASS. Without this it was a suggestion — the
      // headland is reachable by pointing the truck at it and climbing.
      //
      // SIX, and a count rather than a majority, because the headland sits at
      // the MIDDLE of the pass: 4496m of road, 18 checkpoints, closest
      // approach to the destination at 48% along it. Driving in from either
      // end collects 9 — exactly half, never a majority — so requiring one
      // would have shipped a mission that cannot be completed. Six is about
      // 1.5km of pass: enough that you have to have driven it, low enough to
      // survive joining part way along.
      via: { name: "Chapman's Peak Drive", atLeast: 6 },
    },
  },
  { name: 'JOKULSARLON', sub: 'ICELAND · THE RING ROAD', lat: 64.048, lon: -16.18, h: 270 },
];
const startDrive = (d: Drive): void => {
  const m = d.mission ? `&m=${d.mission.id}` : '';
  location.href = `${location.pathname}?lat=${d.lat}&lon=${d.lon}&h=${d.h}&cam=chase${m}`;
};
/** A drive's mission, by the id the spawn URL carries — so a shared link
 *  arrives with the job already on it. */
const missionById = (id: string): Mission | null =>
  DRIVES.find((d) => d.mission?.id === id)?.mission ?? null;
// ── spots you found yourself ───────────────────────────────────────
// The curated drives are authored links. A spot is the same shape, written by
// the player instead: park somewhere worth coming back to and it joins the
// list. Deliberately the SAME `Drive` record, so everything downstream —
// rendering, the tap target, startDrive, the shareable URL — already works.
//
// It names itself. A text field would mean a DOM input over a canvas menu and
// a keyboard over a phone-sized viewport, to ask for something the game
// already knows: the road under the wheels and the place around it. Both are
// already on the HUD, and both are already in the bitmap set.
const SPOTS_KEY = 'drive.spots.v1';
let spots: Drive[] = [];
function loadSpots(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(SPOTS_KEY) ?? '[]') as Drive[];
    spots = Array.isArray(raw)
      ? raw.filter((d) => d && typeof d.lat === 'number' && typeof d.lon === 'number').slice(0, 40)
      : [];
  } catch { spots = []; }
}
function saveSpots(): void {
  try { localStorage.setItem(SPOTS_KEY, JSON.stringify(spots)); } catch { /* full or blocked: the list is still live this session */ }
}
/** Everything the destinations list shows: your own first, then the authored
 *  ones. Recomputed per frame — the list is tens of entries, not thousands. */
const allDrives = (): Drive[] => [...spots, ...DRIVES];
/** Save where the truck is standing, named from what is around it. */
function saveSpot(): void {
  const [la, lo] = localToLatLon(state.x, state.z);
  const h = Math.round((((state.heading * 180) / Math.PI) % 360 + 360) % 360);
  const w = wayAt(state.x, state.z);
  // Kept inside the 5x7 bitmap set, like the authored names: anything outside
  // it falls back to the system font mid-word and breaks the grid, and OSM is
  // full of Sæbraut and Kärntner Straße.
  const safe = (t: string): string => t.toUpperCase().replace(/[^A-Z0-9 ,·.-]/g, '').replace(/\s+/g, ' ').trim();
  // The road is the better name — it is what you would say to someone else —
  // and the place is the context. With no road, the place carries the name and
  // the coordinate carries the detail.
  const place = placeLabel === '…' ? '' : safe(placeLabel);
  const coord = `${la.toFixed(3)} ${lo.toFixed(3)}`;
  const road = w ? safe(w.name) : '';
  const name = road || place || 'WAYPOINT';
  const sub = road ? place || coord : coord;
  spots.unshift({ name, sub, lat: +la.toFixed(5), lon: +lo.toFixed(5), h });
  if (spots.length > 40) spots.length = 40;
  saveSpots();
  drivePage = 0;                       // the new one is at the top of page one
  audio.stone();
}
let drivePage = 0, drivePages = 1;
const driveRects: Array<{ x: number; y: number; w: number; h: number; i: number }> = [];
/** The delete target on a saved row, carrying that row's index in `spots`. */
const spotDelRects: Array<{ x: number; y: number; w: number; h: number; i: number }> = [];
let drivePageRect = { x: 0, y: 0, w: 0, h: 0 };

// ── dials ──────────────────────────────────────────────────────────
// Every one of these was a constant buried somewhere in the render chain. A
// dial CYCLES rather than sliding: a stepped list reads at 3x5 pixels, a slider
// does not, and there is nothing here whose value is worth more resolution than
// four named steps.
interface Dial { key: string; label: string; opts: string[]; apply: (i: number) => void; at: number; bar?: boolean }
interface DialGroup { title: string; dials: Dial[] }
const dial = (key: string, label: string, opts: string[], def: number, apply: (i: number) => void, bar = false): Dial =>
  ({ key, label, opts, apply, at: def, bar });
const cu = compMat.uniforms as Record<string, { value: number }>;
let vegScale = 1;         // multiplies every VEG_CAP
let wildlifeOn = true;
let cloudShadowOn = true;
// 0 hidden · 1 ping the take only · 2 ghost the ones still out there · 3 beam
let cpVis = 0;
const wearU = { value: 1 };  // shared by every bodywork material
const BODY_COLORS: Array<[string, number]> = [
  ['RUST', 0xc4402c], ['EMBER', 0xd0642a], ['SAND', 0xc0a068],
  ['OLIVE', 0x6a7245], ['FOREST', 0x3d5a3c], ['STEEL', 0x44647c],
];
const DIAL_GROUPS: DialGroup[] = [
  {
    title: 'RENDER',
    dials: [
      dial('pix', 'PIXEL', ['240P', '320P', '480P', 'FULL'], 1, (i) => {
        PIX_H = [240, 320, 480, 4096][i];
        resizePost();
      }),
      dial('pal', 'PALETTE', ['8', '14', '24', 'OFF'], 1, (i) => { cu.uLevels.value = [8, 14, 24, 255][i]; }),
      dial('scan', 'SCANLINES', ['OFF', 'LOW', 'HIGH'], 1, (i) => { cu.uScan.value = [0, 0.06, 0.14][i]; }),
      dial('bloom', 'BLOOM', ['OFF', 'LOW', 'MED', 'HIGH'], 2, (i) => { cu.uBloom.value = [0, 0.4, 0.75, 1.2][i]; }),
      dial('flare', 'LENS FLARE', ['OFF', 'ON'], 1, (i) => { cu.uFlare.value = i; }),
    ],
  },
  {
    title: 'WORLD',
    dials: [
      // Default OFF. It was the right call when the world was empty and the
      // point was to reward exploring; now it mostly hides the scenery you
      // came for, and every roof reads black because you can never drive
      // inside a building footprint to reveal it.
      dial('fow', 'FOG OF WAR', ['OFF', 'ON'], 0, (i) => { cu.uFow.value = i; }),
      dial('veg', 'VEGETATION', ['NONE', 'SPARSE', 'FULL'], 2, (i) => { vegScale = [0, 0.35, 1][i]; }),
      dial('life', 'WILDLIFE', ['OFF', 'ON'], 1, (i) => {
        wildlifeOn = i === 1;
        birds.visible = wildlifeOn;
        for (const h of herds) h.visible = wildlifeOn;
      }),
      dial('cloud', 'CLOUD SHADOW', ['OFF', 'ON'], 1, (i) => { cloudShadowOn = i === 1; }),
      // LIVE is the real sun over the real place at this moment. The rest force
      // a LOCAL SOLAR hour, so "noon" means the same thing at every longitude.
      dial('time', 'TIME', [...TIME_MODES], 0, (i) => { timeMode = i; }),
      // How much a checkpoint tells you about itself. HIDDEN is the design as
      // asked for — you feel the tally move and nothing else. The other two
      // exist because "invisible" is a claim about feel that can only be
      // settled by driving the alternatives.
      dial('cpv', 'CHECKPOINTS', ['HIDDEN', 'PING', 'GHOST', 'BEAM'], 0, (i) => { cpVis = i; }),
    ],
  },
  {
    title: 'VEHICLE',
    dials: [
      dial('wear', 'WEATHERING', ['CLEAN', 'WORN', 'BEATEN'], 1, (i) => { wearU.value = [0.15, 1, 1.8][i]; }),
      dial('paint', 'PAINT', BODY_COLORS.map(([n]) => n), 0, (i) => { bodyMat?.color.setHex(BODY_COLORS[i][1]); }),
    ],
  },
  // The SETUP a driver would actually change between stages, and unlike the
  // render dials these are felt rather than seen. Every one is a trade, or it
  // would just be a difficulty slider with extra steps.
  {
    title: 'SETUP',
    dials: [
      // Rack speed AND authority together: QUICK turns in harder and gets there
      // sooner, which on gravel is exactly how you spin it.
      dial('steer', 'STEERING', ['CALM', 'STOCK', 'QUICK', 'RALLY'], 1,
        (i) => { tune.steer = [0.72, 1, 1.3, 1.65][i]; }, true),
      // Spring rate. SOFT soaks up washboard and wallows through corners;
      // STIFF holds a line on tarmac and skates over anything rough.
      dial('susp', 'SUSPENSION', ['SOFT', 'STOCK', 'FIRM', 'STIFF'], 1,
        (i) => { tune.susp = [0.62, 1, 1.45, 2][i]; }, true),
      // Compound. Grip is bought with tread: the sticky set finds another
      // quarter of the surface and gives itself up three times as fast.
      dial('grip', 'TYRES', ['HARD', 'STOCK', 'SOFT', 'STICKY'], 1, (i) => {
        tune.grip = [0.88, 1, 1.12, 1.25][i];
        tune.tyreWear = [0.5, 1, 1.9, 3.2][i];
      }, true),
    ],
  },
];
const DIALS: Dial[] = DIAL_GROUPS.flatMap((g) => g.dials);
const dialRects: Array<{ x: number; y: number; w: number; h: number; d: Dial }> = [];
function applyDials(): void {
  for (const d of DIALS) d.apply(d.at);
}
function saveDials(): void {
  try { localStorage.setItem('drive.dials', JSON.stringify(Object.fromEntries(DIALS.map((d) => [d.key, d.at])))); } catch { /* fine */ }
}
function loadDials(): void {
  try {
    const raw = JSON.parse(localStorage.getItem('drive.dials') ?? '{}') as Record<string, number>;
    for (const d of DIALS) if (Number.isInteger(raw[d.key])) d.at = clamp(raw[d.key], 0, d.opts.length - 1);
  } catch { /* fine */ }
}

// ── odometer ───────────────────────────────────────────────────────
// Metres, cumulative across every session on this device, plus the distance
// since this page loaded. Persisted on a slow clock — this is a number you
// want to survive a reload, not one worth a write per frame.
const odo = { total: 0, trip: 0, at: 0 };
try { odo.total = Number(localStorage.getItem('drive.odo') ?? 0) || 0; } catch { /* fine */ }
const fmtKm = (m: number): string => (m < 1000 ? `${Math.round(m)} M` : `${(m / 1000).toFixed(m < 100000 ? 1 : 0)} KM`);
function stepOdo(dt: number, now: number): void {
  const d = Math.abs(state.speed) * dt;
  odo.total += d;
  odo.trip += d;
  if (now > odo.at) {
    odo.at = now + 8000;
    try { localStorage.setItem('drive.odo', String(Math.round(odo.total))); } catch { /* fine */ }
  }
}
// Straight off the sheet — the parts of the rig that are not geometry.
const SPEC_TEXT: Array<[string, string]> = [
  ['CLASS', 'OVERLAND / RALLY'], ['DRIVE', '4X4'], ['CURB', '2100KG'], ['PAYLOAD', '800KG'],
  ['FUEL', 'BIODIESEL / ALGAE'], ['RANGE', '1200KM EST'], ['SOLAR', '2.4KW PEAK'],
  ['BATTERY', '10KWH LIFEPO4'], ['WATER', '120L'],
];
let menuTab: number | null = null;   // null = closed
let menuRect = { x: 0, y: 0, w: 0, h: 0 };
let closeRect = { x: 0, y: 0, w: 0, h: 0 };
// The hole the renderer scissors the studio render into (HUD pixels).
let vehRect = { x: 0, y: 0, w: 0, h: 0 };
const tabRects: Array<{ x: number; y: number; w: number; h: number; i: number }> = [];
const viewRects: Array<{ x: number; y: number; w: number; h: number; i: number }> = [];
const itemRects: Array<{ x: number; y: number; w: number; h: number; i: number }> = [];
const CARD8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
let placeLine = '';
// POI pins, filled by updatePois and drawn in the pixel font.
interface PoiDraw { x: number; y: number; t: string; c: string; edge: 0 | -1 | 1; rng: boolean; hid: boolean;
  /** Where the pin actually is, so a probe can check the sight line itself. */
  w?: [number, number, number] }
let poiDraw: PoiDraw[] = [];
let streaming = false;

function drawHud(surf: Surface, sq: number, kmh: number, grip: number): void {
  hctx.clearRect(0, 0, HW, HH);
  const pad = 4;
  // Filled and hollow diamonds, plotted a row at a time. At this resolution a
  // marker is about seven pixels across, so it is drawn, not stroked.
  function diamond(cx: number, cy: number, r: number): void {
    for (let dy = -r; dy <= r; dy++) {
      const w = r - Math.abs(dy);
      hctx.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
    }
  }
  function diamondOutline(cx: number, cy: number, r: number): void {
    for (let dy = -r; dy <= r; dy++) {
      const w = r - Math.abs(dy);
      if (Math.abs(dy) === r) { hctx.fillRect(cx - w, cy + dy, w * 2 + 1, 1); continue; }
      hctx.fillRect(cx - w, cy + dy, 1, 1);
      hctx.fillRect(cx + w, cy + dy, 1, 1);
    }
  }
  // ── checkpoint markers, under everything ──
  // Never a label and never a distance: the moment a checkpoint tells you how
  // far away it is you drive to IT instead of driving the road, which is the
  // one thing this mechanic exists to avoid. Shape and brightness only.
  for (const c of cpDraw) {
    const x = Math.round(c.x / hudS), y = Math.round(c.y / hudS);
    const ty0 = Math.round(c.ty / hudS);
    if (x < -4 || x > HW + 4) continue;
    // A beam whose foot is below the screen still shows its column, so the
    // vertical test has to consider the top of the marker as well as its base.
    if (Math.min(y, ty0) > HH + 4 || Math.max(y, ty0) < -4) continue;
    if (c.got) {
      // The take: a cross that blooms outward and fades. This is the whole of
      // PING, and it rides along under GHOST and BEAM too.
      const k = clamp(1 - c.age / 1400, 0, 1);
      const rr = Math.round(2 + (1 - k) * 6);
      hctx.save();
      hctx.globalAlpha = k;
      hctx.fillStyle = UI.good;
      hctx.fillRect(x - rr, y, rr * 2 + 1, 1);
      hctx.fillRect(x, y - rr, 1, rr * 2 + 1);
      hctx.globalAlpha = k * 0.8;
      hctx.fillRect(x - 1, y - 1, 3, 3);
      hctx.restore();
      continue;
    }
    // Nearer reads brighter, so a wall of distant markers never out-shouts the
    // one you are about to reach — and the falloff is STEPPED, in four bands,
    // not a smooth ramp. Everything else on this canvas is quantised; a
    // continuous fade over a hundred markers reads as a rendering artefact
    // where four discrete depths read as a legend. On the chart every marker
    // is equally far from a camera five hundred metres up, so the banding
    // there is by distance from the CAR, which is the thing being answered.
    const bands = 4;
    const near = Math.round(clamp(1 - c.d / CP_SIGHT, 0, 1) * (bands - 1)) / (bands - 1);
    hctx.save();
    if (camMode === 'top') {
      // Chart furniture: a flat pip, no stem and no column. A stem drawn under
      // a camera looking straight down is a single pixel of nothing, and the
      // beam would stand toward the lens.
      hctx.globalAlpha = 0.35 + 0.65 * near;
      hctx.fillStyle = UI.ink;
      diamond(x, y, 3);
      hctx.fillStyle = cpVis === 3 ? UI.gold : UI.edge;
      diamondOutline(x, y, 2);
      hctx.restore();
      continue;
    }
    if (cpVis === 3) {
      // BEAM: a column of light standing on the checkpoint. Drawn as stacked
      // pixels rather than a stroked line because a 1px diagonal line
      // antialiases into a grey smear at this resolution, and everything else
      // on this canvas is hard-edged.
      const ty = ty0, tx = c.tx / hudS;
      const h = y - ty;
      if (h > 1) {
        hctx.fillStyle = UI.edge;
        for (let i = 0; i <= h; i++) {
          const t = i / h;                       // 0 at the foot, 1 at the top
          hctx.globalAlpha = (0.85 - t * 0.72) * (0.35 + 0.65 * near);
          // Lean with the projection: a column beside the camera leans away,
          // and a beam drawn dead vertical would read as a HUD overlay rather
          // than something standing in the world.
          hctx.fillRect(Math.round(x + (tx - x) * t), y - i, t < 0.35 ? 2 : 1, 1);
        }
      }
      hctx.globalAlpha = 0.5 + 0.5 * near;
      hctx.fillStyle = UI.gold;
      diamond(x, y, 3);
      hctx.restore();
      continue;
    }
    // GHOST: a hollow diamond on a short stem. It has to survive being drawn
    // over scrub and shadow at 2px per HUD pixel, so it gets a dark seat
    // underneath it — the same trick the POI pins use — rather than more alpha.
    hctx.globalAlpha = 0.85;
    hctx.fillStyle = UI.ink;
    diamond(x, y - 5, 4);
    hctx.fillRect(x, y - 4, 1, 5);
    hctx.globalAlpha = 0.45 + 0.55 * near;
    hctx.fillStyle = UI.edge;
    diamondOutline(x, y - 5, 3);
    hctx.fillRect(x, y - 2, 1, 3);
    hctx.fillRect(x - 1, y, 3, 1);
    hctx.restore();
  }
  // ── POI pins next, so panels overlay them ──
  const btnW = textW('ELSEWHERE') + 8;
  for (const p of poiDraw) {
    const label = fit(p.t, Math.round(HW * 0.62));
    const w = textSW(label) + 6;
    if (p.edge === 0) {
      const x = clamp(Math.round(p.x / hudS - w / 2), 2, HW - w - 2);
      const y = clamp(Math.round(p.y / hudS), 22, HH - 40);
      // GHOSTED WHEN YOU CANNOT SEE IT. A screen-space label knows where a
      // place is, not whether there is a mountain in front of it — so a dam
      // 860m away behind a ridge was painting itself beside the bonnet at full
      // strength, which reads as "there it is" rather than "it is that way".
      // Occluded pins keep their position and lose their solidity: dimmed text,
      // a dashed stem, and a hollow head. Still a bearing; no longer a sighting.
      const cxm = Math.round(x + w / 2);
      if (p.hid) {
        hctx.save();
        hctx.globalAlpha = 0.42;
        textEdgeS(label, x + 3, y - 9, p.rng ? UI.gold : UI.dim);
        hctx.fillStyle = p.c;
        for (let sy = y - 3; sy < y + 2; sy += 2) hctx.fillRect(cxm, sy, 1, 1);   // dashed stem
        hctx.fillRect(cxm - 1, y + 2, 3, 1);                                      // hollow head
        hctx.fillRect(cxm - 1, y + 4, 3, 1);
        hctx.fillRect(cxm - 1, y + 3, 1, 1);
        hctx.fillRect(cxm + 1, y + 3, 1, 1);
        hctx.restore();
        continue;
      }
      textEdgeS(label, x + 3, y - 9, p.rng ? UI.gold : UI.text);
      hctx.fillStyle = p.c;
      hctx.fillRect(Math.round(x + w / 2), y - 3, 1, 5);      // stem
      hctx.fillRect(Math.round(x + w / 2) - 1, y + 2, 3, 3);  // pin head
      if (p.rng) {
        // IN RANGE: brackets around the label. This is the state that becomes
        // the interaction later — a place you have arrived AT, rather than one
        // you are navigating toward.
        const cxp = Math.round(x + w / 2);
        hctx.fillStyle = UI.gold;
        for (const s of [-1, 1]) {
          const bx = cxp + s * Math.round(w / 2 + 2);
          hctx.fillRect(bx, y - 12, 1, 8);
          hctx.fillRect(bx - (s > 0 ? 2 : 0), y - 12, 3, 1);
          hctx.fillRect(bx - (s > 0 ? 2 : 0), y - 5, 3, 1);
        }
        hctx.fillRect(cxp - 2, y + 1, 5, 1);                  // a base, not a point
      }
    } else {
      const y = clamp(Math.round(p.y / hudS), 20, HH - 30);
      const x = p.edge > 0 ? HW - w - 3 : 3;
      textEdgeS(label, x + 3, y + 2, p.rng ? UI.gold : p.c);
    }
  }
  // ── compass: the full width of the screen, centred ──
  const cw = HW - pad * 2, cx0 = pad, cy0 = pad;
  const deg = (((state.heading * 180) / Math.PI) % 360 + 360) % 360;
  const perDeg = cw / 150;
  // Walk ABSOLUTE bearings (fixed multiples of 5 degrees) and place each at its
  // offset from the heading. Walking offsets from a moving heading meant a
  // tick was "major" only when round(heading + d) happened to land on 45 — so
  // the cardinals blinked on and off instead of sliding.
  for (let b = 0; b < 360; b += 5) {
    let d = b - deg;
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    if (Math.abs(d) > 75) continue;
    const x = Math.round(cx0 + cw / 2 + d * perDeg);
    if (x < cx0 + 3 || x > cx0 + cw - 3) continue;
    const major = b % 45 === 0;
    hctx.fillStyle = major ? UI.gold : UI.dim;
    hctx.fillRect(x, cy0 + (major ? 9 : 11), 1, major ? 4 : 2);
    if (major) {
      const lab = CARD8[(b / 45) % 8];
      textEdge(lab, Math.round(x - textW(lab) / 2), cy0 + 1, UI.text);
    }
  }
  hctx.fillStyle = UI.gold;                      // heading needle, dead centre
  hctx.fillRect(Math.round(cx0 + cw / 2) - 2, cy0 + 16, 5, 1);
  hctx.fillRect(Math.round(cx0 + cw / 2) - 1, cy0 + 17, 3, 1);
  hctx.fillRect(Math.round(cx0 + cw / 2), cy0 + 18, 1, 1);
  // ── the menu button ──
  // The top of the screen belongs to the COMPASS now. Place and weather used to
  // sit under it and were the first thing your eye hit while driving, which is
  // backwards: they are things you check, not things you steer by.
  const row = cy0 + 22;
  const menuW = textW('MENU') + 8;
  menuRect = { x: HW - menuW - pad, y: row, w: menuW, h: 12 };
  panel(menuRect.x, menuRect.y, menuW, 12, UI.edge);
  text(hctx, 'MENU', menuRect.x + 4, row + 3, UI.edge);
  if (wx.warn && performance.now() < wx.warn) {
    const t2 = 'STORM APPROACHING';
    const w2 = textW(t2) + 10;
    const x2 = Math.round((HW - w2) / 2);
    textEdge(t2, x2 + 5, Math.round(HH * 0.32) + 3, UI.bad);
  }
  itemRects.length = 0;
  tabRects.length = 0;
  viewRects.length = 0;
  driveRects.length = 0;
  spotDelRects.length = 0;
  dialRects.length = 0;
  vehRect = { x: 0, y: 0, w: 0, h: 0 };
  // ── the dock, bottom-left: whichever view ISN'T fullscreen ──
  // While charting, the renderer scissors a live POV preview into this square,
  // so the HUD must leave it EMPTY — blitting the minimap here painted straight
  // over that preview, and it only ever looked right on a session that had
  // never been in chase (a blank minimap canvas let the POV show through).
  // The left column reads bottom-up: WHERE you are under the chart, and the
  // CONDITIONS you are driving in above it. Laid out from the bottom edge so
  // the stack stays put whatever the screen height is.
  const mw = Math.min(58, Math.floor(HW * 0.34));
  // Three lines now: the place, the way under the wheels, and the coordinate.
  const infoH = 23;
  const infoY = HH - pad - infoH;
  const my = infoY - mw - 3;
  // ── the job ──
  // Drawn LATER (mid-top, see below); this only clears last frame's hit target.
  missionRect = { x: 0, y: 0, w: 0, h: 0 };
  const mx = pad;
  // The conditions used to sit in a boxed panel above the chart, bottom LEFT,
  // with the speedometer alone in the opposite corner — so reading "what am I
  // driving on" and "how fast" was a glance across the whole screen. Both are
  // answers about the vehicle, and they now share one corner. Drawn bare, with
  // the one-pixel ink outline the world labels use: a black box over a game
  // this dark is a hole in the picture, and none of this is a control.
  // ── the chart / POV dock ──
  const chart = camMode === 'top';
  if (chart) frame(mx, my, mw, mw, UI.dim);
  else {
    panel(mx, my, mw, mw, UI.dim);
    hctx.save();
    hctx.beginPath(); hctx.rect(mx + 1, my + 1, mw - 2, mw - 2); hctx.clip();
    hctx.drawImage(mini, mx + 1, my + 1, mw - 2, mw - 2);
    hctx.restore();
  }
  text(hctx, chart ? 'POV' : 'N', mx + mw / 2 - (chart ? 8 : 3), my + 2, UI.gold);
  dockRect = { x: mx, y: my, w: mw, h: mw };
  // ── where you are, and whether the world is still arriving ──
  {
    const shown = fit(placeLine || '', Math.round(HW * 0.62));
    if (shown) {
      textEdge(shown, pad + 1, infoY, UI.text);
      placeRect = { x: pad, y: infoY - 1, w: textW(shown) + 4, h: 10 }; // tap toggles «translation»
    } else {
      placeRect = { x: 0, y: 0, w: 0, h: 0 };
    }
    // The WAY under the wheels, which is the finest-grained "where am I" the
    // world can answer. The place name says Cape Town; this says Ou Kaapse Weg,
    // and off the tarmac it says which road you left. Streaming/outage takes
    // the line when there is nothing to report, since both mean the same thing:
    // the world does not know where you are yet.
    if (osmDown) textEdgeS('NO WORLD DATA', pad + 1, infoY + 9, UI.bad);
    else {
      const w = wayAt(state.x, state.z);
      const line = w ? (w.on ? alienize(w.name).toUpperCase() : `NEAR ${alienize(w.name).toUpperCase()}`)
        : streaming ? 'STREAMING' : '';
      // The survey tally rides on the way line and takes its room first, so the
      // road name is what gets clipped. A count you cannot read is worse than a
      // name you can only half read.
      const s = surveyHere();
      const tally = s ? (s.r.claimed ? 'DRIVEN' : `${s.r.got}/${s.r.cps.length}`) : '';
      const tw = tally ? textSW(tally) + 4 : 0;
      if (line) textEdgeS(fitS(line, Math.round(HW * 0.6) - tw), pad + 1, infoY + 9, w?.on ? UI.soft : UI.dim);
      if (s && line) {
        // Dim while the extent is still settling — the denominator is not yet
        // trustworthy and the HUD should not pretend otherwise.
        const col = s.r.claimed ? UI.good : !s.ready ? UI.dim : s.frac > SURVEY_MAJORITY ? UI.gold : UI.soft;
        textEdgeS(tally, pad + 1 + Math.min(textSW(line), Math.round(HW * 0.6) - tw) + 4, infoY + 9, col);
      }
    }
    // GPS: TERTIARY. Present because a coordinate is the one thing you can act
    // on outside the game — paste it, share it, come back to it — but in the
    // micro face and the dimmest ink, under everything else. It is a reference,
    // not a reading.
    {
      const [la, lo] = localToLatLon(state.x, state.z);
      const g = `${la.toFixed(4)} ${lo.toFixed(4)}`;
      textEdgeS(g, pad + 1, infoY + 16, UI.dim);
      // Under real drive the coordinate stops being a reference and becomes a
      // reading off an instrument, so it says how much to trust it: the fix
      // accuracy, and how long since one arrived. A stale fix looks exactly
      // like a stationary car unless the HUD says otherwise.
      if (real.on) {
        const f = real.fix;
        const age = f ? (performance.now() - f.at) / 1000 : Infinity;
        const s = !f ? (real.err || 'NO FIX')
          : age > 12 ? `FIX ${age.toFixed(0)}S OLD`
          : `±${Math.round(f.acc)}M`;
        const col = !f || age > 12 ? UI.bad : f.acc > 25 ? UI.gold : UI.good;
        textEdgeS(s, pad + 1 + textSW(g) + 5, infoY + 16, col);
      }
    }
  }
  // ── the rig, bottom-right ──
  // The corner is three instruments now, and each owns its ground. The TABLE:
  // micro label RIGHT-ALIGNED above a right-aligned bar, no values — the bar
  // IS the value, and a percentage beside every bar was the same number said
  // twice. Two headed groups, ENV over RIG, every row persistent. The LEDs
  // live OUTSIDE the table, a small stack beside the dial where they balance
  // the corner instead of crowding the header. And the TACHOMETER is a
  // tachometer: the lit sweep is the ENGINE — the same engRev the audio
  // whines with, gear-ratcheted, flaring into the redline when the wheels
  // leave the ground — with the speed as the number in the middle of it.
  {
    const R = HW - pad;                      // the shared right edge
    const CELLS = 10, PITCH = 3, BARW = CELLS * PITCH - 1;
    const cells = (f: number): number => Math.round(clamp(f, 0, 1) * CELLS);
    // ── the dial ──
    const DR = 26;
    const cx = R - DR, cy = HH - pad - DR - 9;
    {
      // The bezel, as the reference draws it: fine minor ticks the whole way
      // round, a longer major every quarter-turn octant — the ring exists
      // even where the sweep is dark.
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const major = i % 6 === 0;
        hctx.fillStyle = major ? 'rgba(87,201,176,0.4)' : 'rgba(87,201,176,0.16)';
        for (let r = DR; r <= DR + (major ? 1 : 0); r++) {
          hctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
        }
      }
      // The sweep: REVS, not speed. engRev runs 0..1.2 — the last sixth is
      // the flare band the audio screams through, so the geometry and the
      // sound redline together.
      const SEGS = 18;
      const A0 = 0.75 * Math.PI, SWEEP = 1.5 * Math.PI;
      const frac = clamp(engRev / 1.2, 0, 1);
      const lit = Math.round(frac * SEGS);
      for (let i = 0; i < SEGS; i++) {
        const a = A0 + ((i + 0.5) / SEGS) * SWEEP;
        const on = i < lit;
        let col = (i + 1) / SEGS > 0.83 ? UI.hot : UI.gold;
        if (on && i === lit - 1) col = rig.accel > 1.5 ? UI.good : rig.accel < -2.5 ? UI.bad : col;
        hctx.fillStyle = on ? col : 'rgba(87,201,176,0.22)';
        for (let r = DR - 7; r <= DR - 3; r += 2) {
          hctx.fillRect(Math.round(cx + Math.cos(a) * r) - 1, Math.round(cy + Math.sin(a) * r) - 1, 2, 2);
        }
      }
      // The card in the middle, top to bottom as the reference sets it:
      // speed, its unit, the rev scale, the revs.
      const digits = String(kmh);
      glowText(digits, cx - Math.round(textW(digits, 2) / 2) + 1, cy - 15, UI.gold, 2);
      textEdgeS('KM/H', cx - Math.round(textSW('KM/H') / 2) + 1, cy + 2, UI.edge);
      textEdgeS('X1000 RPM', cx - Math.round(textSW('X1000 RPM') / 2) + 1, cy + 9, UI.dim);
      const rk = String(Math.max(1, Math.round(1 + engRev * 6)));
      glowText(rk, cx - Math.round(textW(rk) / 2), cy + 16, engRev > 1 ? UI.hot : UI.edge);
      // TRIP, under the speedometer — the number that belongs to this drive.
      const o = `${fmtKm(odo.trip)} · ${fmtKm(odo.total)}`;
      textEdgeS(o, R - textSW(o), HH - pad - 6, UI.dim);
    }
    // ── the LEDs, beside the dial ──
    // Momentary truths, out of the table: always present, ink when dark.
    {
      const lx = cx - DR - 6;
      let ly = cy - 8;
      const led = (label: string, on: boolean, col: string): void => {
        textEdgeS(label, lx - textSW(label), ly, on ? col : 'rgba(87,201,176,0.28)');
        ly += 8;
      };
      led(skid > 0.55 ? 'SLIP!' : 'SLIP', skid > 0.06, skid > 0.55 ? UI.bad : UI.gold);
      led('SOL', rig.solarKw > rig.drawKw, UI.gold);
      led('SVC', rig.svc, UI.edge);
    }
    // ── the table: label over bar, right-aligned, no numbers ──
    let y = cy - DR - 14;
    const row = (label: string, lit: number, col: string, labelCol = UI.dim): void => {
      textEdgeS(label, R - textSW(label), y, labelCol);
      meter(R - BARW, y + 6, CELLS, lit, col, 2, 3, 1);
      y -= 12;
    };
    // RIG, right column: the stocks the world spends, beside the instrument
    // they are read against.
    row('SUSP', cells(rig.susp), rig.susp < 0.3 ? UI.bad : rig.susp < 0.6 ? UI.gold : UI.soft);
    row('HULL', cells(rig.hull), rig.hull < 0.4 ? UI.bad : rig.hull < 0.75 ? UI.gold : UI.soft);
    row('TYRE', cells(rig.tyre), rig.tyre < 0.3 ? UI.bad : rig.tyre < 0.6 ? UI.gold : UI.soft);
    row('BATT', cells(rig.batt), rig.batt < 0.15 ? UI.bad : rig.batt < 0.35 ? UI.gold : UI.good);
    textEdgeS('RIG', R - textSW('RIG'), y, UI.edge);
    // ── ENV, the LEFT column: what the world is doing ──
    // The two groups answer different questions and were stacked in one corner
    // reading as one table. ENV is about the world, and the left column is
    // already where the world is described — the place, the way, the
    // coordinate — so it belongs on that side, mirrored: label over bar, both
    // aligned LEFT to the same edge the place name uses.
    {
      const L = pad + 1;
      let ey = my - 13;                // stacked upward, clear of the chart/POV dock
      const erow = (label: string, lit: number, col: string, labelCol = UI.dim): void => {
        meter(L, ey + 6, CELLS, lit, col, 2, 3, 1);
        textEdgeS(label, L, ey, labelCol);
        ey -= 12;
      };
      erow('WET', cells(wx.wet), wx.wet > 0.5 ? UI.bad : UI.edge);
      // Named from the SURFACE QUALITY, not the OSM class. A residential street
      // tagged surface=sand is not a road to drive like one, and the panel that
      // tells you what is under the wheels should say so — the three words are
      // the three rungs of the same ladder the physics is standing on.
      const sname = surf === 'water' ? 'WATER' : sq >= 0.8 ? 'ROAD' : sq >= 0.45 ? 'TRACK' : 'ROUGH';
      const scol = sname === 'ROAD' ? UI.good : sname === 'TRACK' ? UI.edge : UI.hot;
      erow(sname, cells(grip), scol, scol);
      const w = WX[wx.sky];
      const hs = `${CARD8[Math.round(deg / 45) % 8]}${Math.round(deg)}`;
      textEdgeS('ENV', L, ey, UI.edge);
      let lx = L + textSW('ENV') + 5;
      textEdgeS(w.label, lx, ey, wx.sky === 'storm' ? UI.bad : wx.rain > 0.1 ? UI.edge : UI.soft);
      lx += textSW(w.label) + 5;
      textEdgeS(hs, lx, ey, UI.gold);
    }
  }
  // ── the job, as a modal ──
  // Mid-top and CENTRED, not a strip tucked over the conditions panel. A job is
  // the only thing on this screen that asks something of you rather than
  // reporting on you, and it should not have to compete with the instruments
  // for a glance. Sized to its own content, with the title on its own line —
  // room for a brief that reads like a sentence rather than a label.
  {
    missionRect = { x: 0, y: 0, w: 0, h: 0 };
    const live = mission && missionPhase !== 'none'
      && (missionPhase !== 'done' || performance.now() - missionAt < 9000);
    if (mission && live) {
      let kicker = '', head = '', body = '', col = UI.gold;
      if (missionPhase === 'offered') {
        kicker = alienize(mission.giver.name).toUpperCase();
        head = mission.title;
        body = missionReady ? 'TAP TO ACCEPT' : 'PULL UP TO TAKE THE JOB';
        col = missionReady ? UI.good : UI.dim;
      } else if (missionPhase === 'active') {
        const d = missionDest ? Math.hypot(missionDest.x - state.x, missionDest.z - state.z) : 0;
        const v = viaProgress(mission);
        kicker = 'ON THE JOB';
        head = mission.title;
        // Once you are at the destination the distance stops being the news —
        // what is left of the route does. Standing on the finish reading
        // "0M" with nothing happening would look like a broken mission.
        body = v && d < mission.within && !v.met
          ? `TAKE ${alienize(mission.via?.name ?? '').toUpperCase()} · ${v.got}/${v.need}`
          : v && !v.met
            ? `${mission.brief} · ${fmtDist(d)} · ${v.got}/${v.need}`
            : `${mission.brief} · ${fmtDist(d)}`;
        if (v && d < mission.within && !v.met) col = UI.hot;
      } else {
        kicker = 'ARRIVED';
        head = mission.title;
        body = `${(odo.trip / 1000).toFixed(1)}KM ON THE CLOCK`;
        col = UI.good;
      }
      const inner = Math.max(textW(head), textSW(body) + 2, textSW(kicker) + 2);
      const bw = Math.min(HW - pad * 2, inner + 16);
      const bx = Math.round((HW - bw) / 2);
      const by = Math.round(HH * 0.17);
      const bh = 30;
      panel(bx, by, bw, bh, col);
      textSmall(hctx, fitS(kicker, bw - 10), bx + 5, by + 4, UI.dim);
      glowText(fit(head, bw - 10), bx + 5, by + 11, col);
      textSmall(hctx, fitS(body, bw - 10), bx + 5, by + 21, missionReady ? col : UI.text);
      // Only an offer you can actually take is a tap target — an "on the job"
      // panel that swallowed taps would eat the camera toggle for a whole drive.
      if (missionReady) missionRect = { x: bx, y: by, w: bw, h: bh };
    }
    // ── a road claimed ──
    // Deliberately NOT a modal. Claiming a road is something you did, not
    // something you must answer, so it sits under the mission slot, states
    // itself, and leaves. Nothing to dismiss and nothing to tap.
    if (surveyClaim && performance.now() - surveyClaim.at < 6000) {
      const head = alienize(surveyClaim.name).toUpperCase();
      const body = `${surveyClaim.n} CHECKPOINTS`;
      const bw = Math.min(HW - pad * 2, Math.max(textW(head), textSW(body) + 2, textSW('SURVEYED') + 2) + 16);
      const bx = Math.round((HW - bw) / 2);
      const by = Math.round(HH * 0.17) + (mission ? 36 : 0);
      panel(bx, by, bw, 30, UI.good);
      textSmall(hctx, 'SURVEYED', bx + 5, by + 4, UI.dim);
      glowText(fit(head, bw - 10), bx + 5, by + 11, UI.good);
      textSmall(hctx, fitS(body, bw - 10), bx + 5, by + 21, UI.text);
    }
  }
  // LAST: the modal covers the instruments, not the other way round.
  if (menuTab !== null) drawMenu(menuTab, kmh, surf);
}
// The interstitial. A scrim over the whole screen, a bordered page, tabs, and
// on VEHICLE a hole the renderer draws the truck into — the same scissor trick
// the POV dock uses, so the HUD must leave that rectangle EMPTY.
function drawMenu(tab: number, kmh: number, surf: Surface): void {
  hctx.fillStyle = 'rgba(6,14,17,0.9)';
  hctx.fillRect(0, 0, HW, HH);
  const MX = 5, MY = 5, MW = HW - 10, MH = HH - 10;
  panel(MX, MY, MW, MH, UI.gold);
  // ── header ──
  text(hctx, 'PARIS', MX + 5, MY + 5, UI.gold);
  // The arrow is drawn, not typed: → is not in the 5x7 set and the system-font
  // fallback renders it as a stray dash at this size.
  {
    const ax = MX + 8 + textW('PARIS'), ay = MY + 8;
    hctx.fillStyle = UI.hot;
    hctx.fillRect(ax, ay, 7, 1);
    hctx.fillRect(ax + 4, ay - 1, 1, 1); hctx.fillRect(ax + 5, ay - 2, 1, 1);
    hctx.fillRect(ax + 4, ay + 1, 1, 1); hctx.fillRect(ax + 5, ay + 2, 1, 1);
  }
  text(hctx, 'DAKAR', MX + 19 + textW('PARIS'), MY + 5, UI.gold);
  textSmall(hctx, 'SOLARPUNK RALLY RIG', MX + 5, MY + 14, UI.dim);
  const cw2 = textW('X') + 8;
  closeRect = { x: MX + MW - cw2 - 3, y: MY + 3, w: cw2, h: 12 };
  panel(closeRect.x, closeRect.y, cw2, 12, UI.hot);
  text(hctx, 'X', closeRect.x + 4, MY + 6, UI.hot);
  hctx.fillStyle = UI.dim;
  hctx.fillRect(MX + 4, MY + 21, MW - 8, 1);
  // ── tabs ──
  // Wrapped, because five sections do not fit one row on a narrow phone and a
  // tab you cannot reach is worse than a tab on a second line.
  let tx = MX + 5, ty2 = MY + 25;
  for (let i = 0; i < TABS.length; i++) {
    const w = textW(TABS[i]) + 8;
    if (tx + w > MX + MW - 5) { tx = MX + 5; ty2 += 14; }
    const on = tab === i;
    if (on) panel(tx, ty2, w, 12, UI.gold);
    text(hctx, TABS[i], tx + 4, ty2 + 3, on ? UI.gold : UI.soft);
    tabRects.push({ x: tx, y: ty2, w, h: 12, i });
    tx += w + 3;
  }
  const tabBottom = ty2 + 12;
  const top = tabBottom + 4;
  if (tab === T_DRIVE) {
    // ── the splash ──
    // Where you are, big; what you have driven; and the three things that
    // change what happens next. Deliberately sparse: this is the screen the
    // game opens on, and a wall of controls is not a title card.
    let y = top + 4;
    glowText(fit((placeLine || 'LOCATING').toUpperCase(), MW - 12), MX + 6, y, UI.gold);
    y += 12;
    const [la0, lo0] = localToLatLon(state.x, state.z);
    textSmall(hctx, `${biome.name.toUpperCase()} · ${WX[wx.sky].label} · ${la0.toFixed(3)} ${lo0.toFixed(3)}`,
      MX + 6, y, UI.dim);
    y += 12;
    hctx.fillStyle = UI.dim; hctx.fillRect(MX + 5, y, MW - 10, 1);
    y += 6;
    const claimed = [...survey.values()].filter((r) => r.claimed).length;
    for (const [k, v] of [
      ['DRIVEN', `${fmtKm(odo.trip)} TRIP · ${fmtKm(odo.total)} TOTAL`],
      ['SURVEYED', `${claimed} ${claimed === 1 ? 'ROAD' : 'ROADS'} CLAIMED`],
      ['MODE', real.on ? 'REAL DRIVE · GPS' : 'FREE DRIVE'],
      ['WORLD', osmDown ? 'VECTORS UNAVAILABLE' : streaming ? 'STREAMING' : 'LOADED'],
    ] as Array<[string, string]>) {
      textSmall(hctx, k, MX + 6, y, UI.dim);
      textSmall(hctx, v, MX + 52, y, UI.text);
      y += 8;
    }
    const items = TAB_ITEMS[T_DRIVE];
    y = MY + MH - 6 - (items.length * 16 + 8);
    for (let i = 0; i < items.length; i++) {
      const w = Math.max(textW(items[i].label()) + 10, 84);
      panel(MX + 5, y, w, 13, items[i].col());
      text(hctx, items[i].label(), MX + 10, y + 4, items[i].col());
      itemRects.push({ x: MX + 5, y, w, h: 13, i });
      y += 16;
    }
  } else if (tab === T_SURVEY) {
    // ── the survey ──
    // The road under the wheels first, because that is the one you can change
    // right now, then every road worth claiming, longest first. A bar rather
    // than a percentage: the question is "how much of this is left", and a bar
    // answers it without being read.
    let y = top;
    const here = surveyHere();
    const roads = [...survey.values()].filter(surveyEligible).sort((a, b) => b.len - a.len);
    const totalCps = roads.reduce((n, r) => n + r.cps.length, 0);
    const gotCps = roads.reduce((n, r) => n + r.got, 0);
    textSmall(hctx, 'UNDER THE WHEELS', MX + 6, y, UI.dim);
    y += 9;
    if (here) {
      text(hctx, fit(alienize(here.r.name).toUpperCase(), MW - 60), MX + 6, y, UI.text);
      const tally = here.r.claimed ? 'DRIVEN' : `${here.r.got}/${here.r.cps.length}`;
      textSmall(hctx, tally, MX + MW - textSW(tally) - 7, y + 2,
        here.r.claimed ? UI.good : here.ready ? UI.gold : UI.dim);
      y += 11;
      meter(MX + 6, y, 24, Math.round(here.frac * 24), here.r.claimed ? UI.good : UI.edge, 3, 3, 1);
      y += 8;
      // The gate, stated plainly — a road at 100% that will not claim is the
      // single most confusing state this mechanic can be in.
      textSmall(hctx, here.r.claimed ? 'CLAIMED' : here.ready ? 'SURVEYED · DRIVE A MAJORITY' : 'STILL SURVEYING THIS ROAD',
        MX + 6, y, here.r.claimed ? UI.good : here.ready ? UI.soft : UI.dim);
      y += 11;
    } else {
      textSmall(hctx, osmDown ? 'NO WORLD DATA' : 'NO NAMED ROAD NEARBY', MX + 6, y, UI.dim);
      y += 11;
    }
    hctx.fillStyle = UI.dim; hctx.fillRect(MX + 5, y, MW - 10, 1);
    y += 5;
    textSmall(hctx, `ROADS ${roads.length}`, MX + 6, y, UI.dim);
    {
      const lab = `${gotCps}/${totalCps} CHECKPOINTS`;
      textSmall(hctx, lab, MX + MW - textSW(lab) - 7, y, UI.dim);
    }
    y += 9;
    const room = Math.max(0, MY + MH - 8 - y);
    for (const r of roads.slice(0, Math.floor(room / 10))) {
      const frac = r.got / r.cps.length;
      const col = r.claimed ? UI.good : frac > SURVEY_MAJORITY ? UI.gold : UI.soft;
      // Four columns, and each one owns its own strip: the name is CLIPPED to
      // its column rather than allowed to run, because a long road name walked
      // straight over the distance beside it.
      const nameW = Math.floor(MW * 0.46) - 8;
      const kmX = MX + 6 + nameW + 4;          // distance, right-aligned into the gap
      const barX = Math.round(MX + MW * 0.62);
      textSmall(hctx, fitS(alienize(r.name).toUpperCase(), nameW), MX + 6, y, col);
      const km = r.len >= 1000 ? `${(r.len / 1000).toFixed(1)}K` : `${Math.round(r.len)}M`;
      textSmall(hctx, km, Math.max(kmX, barX - 6 - textSW(km)), y, UI.dim);
      meter(barX, y + 1, 10, Math.round(frac * 10), col, 2, 3, 1);
      const n = `${r.got}/${r.cps.length}`;
      textSmall(hctx, n, MX + MW - textSW(n) - 7, y, UI.dim);
      y += 10;
    }
  } else if (tab === T_RIG) {
    truckSpec(); // populates specBox, which the elevations frame themselves from
    // ── view picker ──
    // Drawn in the MICRO face and a row shorter than the tabs above: these
    // choose a view WITHIN a section, and at the same weight they competed with
    // the section tabs for which row of chips you were meant to read first.
    let vx2 = MX + 5, vy2 = top;
    for (let i = 0; i < VIEWS.length; i++) {
      const w = textSW(VIEWS[i].id) + 6;
      if (vx2 + w > MX + MW - 5) { vx2 = MX + 5; vy2 += 11; }  // wrap, phone-width
      const on = vehView === i;
      if (on) frame(vx2, vy2, w, 9, UI.gold);
      textSmall(hctx, VIEWS[i].id, vx2 + 3, vy2 + 2, on ? UI.gold : UI.soft);
      viewRects.push({ x: vx2, y: vy2, w, h: 9, i });
      vx2 += w + 3;
    }
    vy2 -= 3; // the shorter chips leave the bay too far down otherwise
    // ── the bay: a live window onto the actual truck ──
    // Its SHAPE follows the view. A side elevation is 4.9m by 2.35m and a plan
    // is the other way up; forcing both into one square window wastes most of
    // the panel on empty backdrop and shrinks the thing you came to look at.
    const bayTop = vy2 + 16;
    const bw = MW - 8;
    const view = VIEWS[vehView];
    const natural = vehView === 0 ? 1.3 : AXIS_SIZE(specBox, view.w) / AXIS_SIZE(specBox, view.h);
    // The bay takes WHAT IS LEFT, not a fixed fraction. SETUP added three rows
    // at the foot of this tab and TYRES fell off the bottom of the panel; a
    // fraction of MH did not fix it because the 3/4 view's natural height was
    // already under the cap, so the clamp never bound. Everything below the bay
    // is a known number of known-height rows, so subtract them and the bay can
    // never crowd a control off the screen again — on any phone.
    const tailH = 8 + 5 * 7 + 4 + SPEC_TEXT.length * 7 + 5   // dims + spec sheet
      + 2 * 13 + 5 * 9 + 6                                   // 2 dial groups, 5 dials
      + 12;                                                  // and clear of the frame
    const vh = clamp(Math.round(bw / natural), 78, Math.max(78, MY + MH - bayTop - tailH));
    vehRect = { x: MX + 4, y: bayTop, w: bw, h: vh };
    frame(vehRect.x, vehRect.y, vehRect.w, vehRect.h, UI.edge);
    if (vehView > 0) {
      // A METRE GRID over the elevation, from the same extents the renderer
      // frames with — the point of an orthographic view is that you can read
      // proportions off it, and you cannot do that without a scale.
      const { hw, hh } = orthoExtents(vehView, (vehRect.w * hudS) / (vehRect.h * hudS));
      const pxPerM = vehRect.w / (hw * 2);
      const cx3 = vehRect.x + vehRect.w / 2, cy3 = vehRect.y + vehRect.h / 2;
      hctx.fillStyle = 'rgba(87,201,176,0.13)';
      for (let m = -Math.ceil(hw); m <= hw; m++) {
        const px = Math.round(cx3 + m * pxPerM);
        if (px > vehRect.x && px < vehRect.x + vehRect.w) hctx.fillRect(px, vehRect.y + 1, 1, vehRect.h - 2);
      }
      for (let m = -Math.ceil(hh); m <= hh; m++) {
        const py = Math.round(cy3 + m * pxPerM);
        if (py > vehRect.y && py < vehRect.y + vehRect.h) hctx.fillRect(vehRect.x + 1, py, vehRect.w - 2, 1);
      }
      textSmall(hctx, `${AXIS_SIZE(specBox, view.w).toFixed(2)} X ${AXIS_SIZE(specBox, view.h).toFixed(2)} M  ·  1M GRID`,
        vehRect.x + 4, vehRect.y + 3, UI.dim);
    }
    textSmall(hctx, 'DAK 23', vehRect.x + 4, vehRect.y + vehRect.h - 8, UI.gold);
    // ── measured against the sheet ──
    const spec = truckSpec();
    let y = bayTop + vh + 6;
    textSmall(hctx, 'DIMENSIONS      BUILT   SPEC', MX + 6, y, UI.dim);
    y += 8;
    for (const k of ['length', 'width', 'height', 'wheelbase', 'clearance'] as const) {
      const built = spec[k], want = SPEC_TARGET[k];
      const ok = Math.abs(built - want) <= 0.03;
      textSmall(hctx, k.toUpperCase(), MX + 6, y, UI.soft);
      textSmall(hctx, `${built.toFixed(2)}M`, MX + 68, y, ok ? UI.good : UI.hot);
      textSmall(hctx, `${want.toFixed(2)}M`, MX + 96, y, UI.dim);
      y += 7;
    }
    y += 4;
    for (const [k, v] of SPEC_TEXT) {
      textSmall(hctx, k, MX + 6, y, UI.soft);
      textSmall(hctx, v, MX + 46, y, UI.text);
      y += 7;
    }
    // The rig's own dials live with the rig, not in a settings screen — how it
    // looks, and now how it drives.
    drawDials(DIAL_GROUPS.filter((g) => g.title === 'VEHICLE' || g.title === 'SETUP'), MX, MW, y + 5);
  } else {
    // ── readouts, then the controls for this tab ──
    let y = top;
    const rows: Array<[string, string]> = tab === T_WORLD
      ? [
        ['HERE', fitS(placeLine || 'LOCATING', MW - 60).toUpperCase()],
        ['BIOME', `${biome.name.toUpperCase()} · ${WX[wx.sky].label}${wx.wet > 0.05 ? ' WET' : ''}`],
        // No degree sign: it is not in the 3x5 set and renders as '?'.
        ['HEADING', `${Math.round((((state.heading * 180) / Math.PI) % 360 + 360) % 360)} DEG · ${kmh} KM/H`],
      ]
      : [
        ['SOUND', audio.on ? (audio.state === 'running' ? 'ON' : 'NEEDS TAP') : 'OFF'],
        ['SCRIPT', alien ? 'ALIEN' : 'PLAIN'],
      ];
    if (tab === T_WORLD) {
      rows.push(['DRIVEN', `${fmtKm(odo.trip)} TRIP · ${fmtKm(odo.total)} TOTAL`]);
      rows.push(['VECTORS', osmDown ? 'UNAVAILABLE - RETRYING' : streaming ? 'STREAMING' : 'LOADED']);
    }
    for (const [k, v] of rows) {
      textSmall(hctx, k, MX + 6, y, UI.dim);
      textSmall(hctx, v, MX + 52, y, UI.text);
      y += 8;
    }
    // VEHICLE and SETUP both belong to the rig and are drawn in that tab.
    if (tab === T_SYSTEM) {
      y = drawDials(DIAL_GROUPS.filter((g) => g.title !== 'VEHICLE' && g.title !== 'SETUP'), MX, MW, y + 4);
    }
    y += 6;
    const items = TAB_ITEMS[tab];
    if (tab === T_WORLD) {
      // ── the curated starts ──
      // The list takes whatever room is left between the readouts and the
      // buttons, and pages if the screen is too short for all of it — a phone
      // in landscape has barely a third of the height of one held upright.
      const btnH = items.length * 16 + 8;
      const room = Math.max(2, MY + MH - 6 - btnH - (y + 10));
      const list = allDrives();
      const perPage = Math.max(3, Math.floor(room / 11));
      const pages = Math.ceil(list.length / perPage);
      drivePages = pages;
      drivePage = clamp(drivePage, 0, pages - 1);
      textSmall(hctx, 'DESTINATIONS', MX + 6, y, UI.dim);
      if (pages > 1) {
        const lab = `${drivePage + 1}/${pages} >`;
        drivePageRect = { x: MX + MW - textSW(lab) - 10, y: y - 2, w: textSW(lab) + 8, h: 9 };
        textSmall(hctx, lab, drivePageRect.x + 4, y, UI.gold);
      } else {
        drivePageRect = { x: 0, y: 0, w: 0, h: 0 };
      }
      y += 9;
      const from = drivePage * perPage;
      for (let i = from; i < Math.min(list.length, from + perPage); i++) {
        const d = list[i];
        // Yours read in gold and carry a delete target; the authored ones do
        // not, because you cannot delete the map.
        const mine = i < spots.length;
        const delW = mine ? 11 : 0;
        text(hctx, fit(d.name, MW * 0.52), MX + 6, y, mine ? UI.gold : UI.text);
        const sub = fitS(d.sub, MW * 0.46 - delW);
        textSmall(hctx, sub, MX + MW - textSW(sub) - 7 - delW, y + 2, UI.dim);
        if (mine) {
          textSmall(hctx, 'X', MX + MW - 11, y + 2, UI.soft);
          spotDelRects.push({ x: MX + MW - 16, y: y - 2, w: 14, h: 11, i });
        }
        driveRects.push({ x: MX + 4, y: y - 2, w: MW - 8 - delW, h: 11, i });
        y += 11;
      }
      y = MY + MH - 6 - btnH;
    }
    for (let i = 0; i < items.length; i++) {
      const w = Math.max(textW(items[i].label()) + 10, 70);
      panel(MX + 5, y, w, 13, items[i].col());
      text(hctx, items[i].label(), MX + 10, y + 4, items[i].col());
      itemRects.push({ x: MX + 5, y, w, h: 13, i });
      y += 16;
    }
  }
}
// A group of dials: a rule with its title, then one row each. The value sits
// right-aligned in gold, which is the only thing on the row you can change, and
// the whole row is the target — chasing a 20px-wide word with a thumb is not a
// control.
function drawDials(groups: DialGroup[], MX: number, MW: number, y0: number): number {
  let y = y0;
  for (const g of groups) {
    // Rule to the RIGHT of the title, not behind it. Clearing a gap for the
    // text punched a hole straight through the modal's scrim to the world.
    textSmall(hctx, g.title, MX + 7, y, UI.edge);
    hctx.fillStyle = UI.dim;
    const tw = textSW(g.title) + 12;
    hctx.fillRect(MX + tw, y + 2, MW - tw - 7, 1);
    y += 9;
    for (const d of g.dials) {
      textSmall(hctx, d.label, MX + 8, y, UI.soft);
      const v = d.opts[d.at];
      const vx = MX + MW - textSW(v) - 9;
      textSmall(hctx, v, vx, y, UI.gold);
      // A SETUP dial also draws its position in the range, in the same meter
      // the cluster uses for everything else. A render option is a choice
      // between named things and a word says it all; a setup is a point on a
      // scale, and "FIRM" alone does not tell you how much of the travel is
      // left above it.
      if (d.bar) meter(vx - d.opts.length * 3 - 4, y + 1, d.opts.length, d.at + 1, UI.gold, 2, 4, 1);
      dialRects.push({ x: MX + 5, y: y - 2, w: MW - 10, h: 9, d });
      y += 9;
    }
    y += 4;
  }
  return y;
}
let dockRect = { x: 0, y: 0, w: 0, h: 0 };
function setClean(on: boolean): void {
  document.body.classList.toggle('clean', on);
  if (!on) updateStickHome(); // the pinned stick has to come back with it
  try { localStorage.setItem('drive.clean', on ? '1' : '0'); } catch { /* fine */ }
}
// Taps: buttons first, then the camera dock, then fall through to driving.
function hudTap(cx: number, cy: number): boolean {
  if (document.body.classList.contains('clean')) return false;
  const x = cx / hudS, y = cy / hudS;
  const inside = (r: { x: number; y: number; w: number; h: number }, m = 2): boolean =>
    x >= r.x - m && x <= r.x + r.w + m && y >= r.y - m && y <= r.y + r.h + m;
  if (menuTab !== null) {
    // The modal is MODAL: every tap inside it belongs to it, and none of them
    // reach the world underneath.
    const tab = menuTab; // switching tabs below reassigns it mid-block
    if (inside(closeRect)) { menuTab = null; return true; }
    for (const r of tabRects) if (inside(r, 0)) { menuTab = r.i; return true; }
    for (const r of viewRects) if (inside(r, 0)) { vehView = r.i; return true; }
    for (const r of dialRects) {
      if (!inside(r, 0)) continue;
      r.d.at = (r.d.at + 1) % r.d.opts.length;   // dials CYCLE; there is no slider
      r.d.apply(r.d.at);
      saveDials();
      return true;
    }
    if (drivePageRect.w && inside(drivePageRect, 2)) { drivePage = (drivePage + 1) % drivePages; return true; }
    // Delete before select: the X sits inside the row it belongs to.
    for (const r of spotDelRects) if (inside(r, 0)) { spots.splice(r.i, 1); saveSpots(); audio.stone(); return true; }
    for (const r of driveRects) { const d = allDrives()[r.i]; if (d && inside(r, 0)) { startDrive(d); return true; } }
    for (const r of itemRects) if (inside(r, 0)) { TAB_ITEMS[tab]?.[r.i]?.hit(); return true; }
    return true;
  }
  if (inside(menuRect)) { menuTab = 0; return true; }
  // Before the dock, because the accept prompt sits above it and a tap that
  // lands on both should take the job rather than flip the camera.
  if (missionReady && missionRect.w && inside(missionRect, 4)) { acceptMission(performance.now()); return true; }
  if (inside(dockRect, 0)) { toggleCam(); return true; }
  if (inside(placeRect)) { toggleAlien(); return true; }
  return false;
}
let placeRect = { x: 0, y: 0, w: 0, h: 0 };

// ── clean viewport ─────────────────────────────────────────────────
// Everything chrome-like carries .ui, so one class on <body> strips the screen
// back to raw pixels — no minimap, no pins, no text. 'h' or the ⛶ button, and
// a double-tap anywhere brings it back (never trust a hidden button to undo
// itself). Declared last: every element it references must already exist.
{
  const st = document.createElement('style');
  // The shell's own text chrome is retired — everything is drawn in the HUD
  // buffer now. Keep only the boot card.
  st.textContent = 'body.clean .ui { display: none !important; } .hud, #reroll { display: none !important; }';
  document.head.appendChild(st);
  for (const el of [mini, stickBase, stickNub]) el.classList.add('ui');
  const clean = (): boolean => document.body.classList.contains('clean');
  try { if (localStorage.getItem('drive.clean') === '1') document.body.classList.add('clean'); } catch { /* fine */ }
  let lastTap = 0;
  canvas.addEventListener('pointerdown', () => {
    const t = performance.now();
    if (clean() && t - lastTap < 320) setClean(false);
    lastTap = t;
  });
  addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'h') setClean(!clean()); });
}

// ── boot ───────────────────────────────────────────────────────────
// Settings first: PIXEL resizes the render targets and PAINT reaches into a
// material, so they have to land before the first frame rather than on the
// first time the menu is opened.
loadDials();
loadSpots();
applyDials();
// …and THEN the URL, because a dial that persists to localStorage will happily
// overwrite a query parameter that was read before it. `?t=DUSK` silently did
// nothing for exactly this reason: every mode rendered the live sun.
if (timeFromUrl >= 0) {
  const d = DIALS.find((x) => x.key === 'time');
  if (d) { d.at = timeFromUrl; d.apply(timeFromUrl); }
}
$('reroll').addEventListener('click', () => { location.href = location.pathname + '?random=1'; });
(async () => {
  const spawn = await findSpawn();
  origin = { lat: spawn.lat, lon: spawn.lon, mLon: M_LAT * Math.cos((spawn.lat * Math.PI) / 180) };
  // The bench must span the terrain mesh's cell diagonal — the farthest any
  // triangle corner can sit from a road passing through it. Tile ground width
  // shrinks with cos(latitude), so this is a per-world number, not a constant.
  CUT_SLACK = ((40075016.7 / 2 ** TERRAIN_Z) * Math.cos((spawn.lat * Math.PI) / 180) / TERRAIN_SEG) * Math.SQRT2;
  placeLabel = spawn.name ?? '…';
  renderPlace();
  // Resume orientation and camera from the URL (written live while driving).
  const q = new URLSearchParams(location.search);
  const h0 = parseFloat(q.get('h') ?? '');
  if (Number.isFinite(h0)) state.heading = (h0 * Math.PI) / 180;
  { const c = q.get('cam'); if (c === 'chase' || c === 'cab') setCam(c); }
  // Armed here, taken up once the splash gesture lands: watchPosition before
  // that would burn a fix (and a permission prompt) against a world that has
  // not finished streaming.
  real.on = q.get('real') === '1';
  // The job, if this spawn carries one. Armed AFTER `origin` is set, because
  // both its waypoints are lat/lon and have to be projected into local metres.
  const mid = q.get('m');
  if (mid) { const m = missionById(mid); if (m) armMission(m); }
  writeUrl(spawn.lat, spawn.lon);
  void placeName(spawn.lat, spawn.lon).then((n) => { if (n) { placeLabel = n; renderPlace(); } });
  bootMsg('reading the terrain…');
  // Anchor elevation: the spawn tile loads first so heights are relative to it.
  const [tx, ty] = tileAt(spawn.lat, spawn.lon, TERRAIN_Z);
  const anchor = await fetchHeights(tx, ty);
  if (anchor) {
    const b = tileBounds(tx, ty, TERRAIN_Z);
    const u = clamp(Math.round(((spawn.lon - b.lonW) / (b.lonE - b.lonW)) * 255), 0, 255);
    const v = clamp(Math.round(((b.latN - spawn.lat) / (b.latN - b.latS)) * 255), 0, 255);
    baseElev = anchor[v * 256 + u];
  }
  // Anchor the sea to true sea level — unless the land here is itself below
  // it (a depression), in which case there is no sea to show.
  // The sea is on for every spawn that could ever reach a coast; a spawn
  // already in a depression starts with its own dry-land evidence so the
  // basin is never flooded, not even for a frame.
  seaOn = true;
  if (baseElev >= -2) { sea.position.y = seaSurfaceAbs() - baseElev; }
  else { dryAt = [0, 0]; sea.position.y = -60; }
  // Dress the world BEFORE any terrain mesh is built — the ground ramp is
  // baked into vertex colours at build time.
  applyBiome(pickBiome(spawn.lat, baseElev));
  bootMsg('laying down the roads…');
  // The spawn tile must be IN the height field before the first frame — the
  // car, drapes, and camera all read it; starting on y=0 then popping up a
  // second later read as "stuck in the terrain".
  await loadTerrainTile(tx, ty);
  streamWorld(0, 0);
  reveal(0, 0);
  // TAP TO START. The splash is the natural place to take the gesture the
  // browser demands before any audio can play — arming it here means sound is
  // simply on when the world appears, instead of the player discovering a
  // muted game and hunting for a button.
  // `ready` then `done` in the same breath: ready is the signal that the world
  // is up (a probe waits on it), done is the overlay lifting off the menu.
  bootMsg('ready');
  $('boot').classList.add('ready');
  $('boot').classList.add('done');
  // START AND THE MAIN MENU ARE THE SAME THING — one screen, not a title card
  // that hands off to a different screen with different words on it. The boot
  // overlay is now purely a progress readout; when the world is up it lifts
  // and the menu is there, on its DRIVE tab, with the place you spawned in
  // live behind it. The browser's audio gesture is taken by whatever you tap
  // first, which on this screen is a button that means something.
  // A link that already says where to go skips it: that asked for a drive.
  if (real.on) beginRealWatch();
  else if (!q.get('lat') && !q.get('m')) menuTab = T_DRIVE;
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick); });
})();

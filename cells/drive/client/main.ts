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
async function fetchHeights(x: number, y: number): Promise<Float32Array | null> {
  try {
    const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TERRAIN_Z}/${x}/${y}.png`);
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
    return out;
  } catch { return null; }
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

const terrainPalette = (elev: number, slope: number): [number, number, number] => {
  // Solarpunk desert: cyan shallows → warm sand → ochre scrub → dry upland →
  // bare rock → snow. The emerald in this world comes from the VEGETATION
  // standing on the sand, not from painting the ground green.
  let c: Rgb = biome.ramp[biome.ramp.length - 1][1];
  for (const [max, col] of biome.ramp) if (elev <= max) { c = col; break; }
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
function setNear(n: number): void {
  if (nearLock) n = nearLock;
  if (Math.abs(camera.near - n) < n * 0.02) return;
  camera.near = n;
  camera.updateProjectionMatrix();
}

// ── sky ────────────────────────────────────────────────────────────
// A real sky, not a backdrop color: gradient dome with the sun sitting low
// on the horizon (mostly north-ish so the default chase view catches it),
// and the scene's directional light aimed from the same place.
// GOLDEN HOUR, not night: the sun climbs off the horizon so the world is lit
// rather than merely silhouetted, while keeping the long warm rake.
const SUN_DIR = new THREE.Vector3(0.42, 0.34, -0.78).normalize();
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
  },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform vec3 sunDir; uniform vec3 uZenith; uniform vec3 uHorizon;
    uniform vec3 uSunDisc; uniform vec3 uBelow; uniform float uCloud; uniform float uTime;
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
        vec2 p = d.xz / max(d.y, 0.05) * 1.4 + vec2(uTime * 0.006, uTime * 0.0022);
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

const worldGroup = new THREE.Group();
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
    sunXZ: { value: new THREE.Vector2(SUN_DIR.x, SUN_DIR.z).normalize() },
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
          if (length(vGhostW.xz - p.xz) < 6.0 + t * 8.0 && vGhostW.y > p.y - 0.3
              && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 1.0) discard;
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
  const SEG = 96;
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
    const elev = groundAt(ex, ez);
    const elevAbs = elev + baseElev;
    pos.setY(i, elev);
    const u = clamp(Math.round(((ex - t.xs) / t.w) * 255), 0, 255);
    const v = clamp(Math.round(((ez - t.zs) / t.h) * 255), 0, 255);
    const du = t.data[v * 256 + Math.min(255, u + 1)] - t.data[v * 256 + u];
    const dv = t.data[Math.min(255, v + 1) * 256 + u] - t.data[v * 256 + u];
    const [r, g, bb] = terrainPalette(elevAbs, Math.hypot(du, dv) / Math.max(cell, 1));
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
// Rebuilds are not free — 9409 vertices, each sampling the heightfield and
// asking the road grid whether it is in a cutting. A tile arriving used to
// rebuild all eight neighbours SYNCHRONOUSLY, and roads now want rebuilds too,
// so they queue instead and the main loop spends one per frame on them.
const terrainDirty = new Set<string>();
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
const seenWays = new Set<number>();
let osmInFlight = 0;
const osmQueue: Array<() => void> = [];
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
const SIGN_KINDS = 3;
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
    // temporary/hazard board and it is the one that survives this palette.
    c.fillStyle = k === 1 ? '#d8cf4a' : '#d5c93f';
    c.fillRect(x0, 0, W, s / 2);
    // DRAWN FOR THE RESOLUTION IT IS SEEN AT. The scene renders at PIX_H and is
    // magnified, so a board 26m away is roughly twenty pixels across — three
    // slim chevrons became three grey smudges. Everything here is deliberately
    // coarse: two fat marks instead of three fine ones, a two-pixel border
    // instead of three, nothing thinner than a sixth of the panel.
    const H = s / 2;
    c.fillStyle = 'rgba(30,26,18,0.9)';
    c.fillRect(x0 + 2, 2, W - 4, 2); c.fillRect(x0 + 2, H - 4, W - 4, 2);
    c.fillRect(x0 + 2, 2, 2, H - 4); c.fillRect(x0 + W - 4, 2, 2, H - 4);
    c.fillStyle = '#141109';
    if (k === 0) {
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
    c.fillStyle = 'rgba(96,88,60,0.16)'; c.fillRect(x0, 0, W, s / 2);
    rust(x0, 0, W, 8, 40); rust(x0, s / 2 - 10, W, 10, 40);
    rust(x0, 0, 8, s / 2, 30); rust(x0 + W - 8, 0, 8, s / 2, 30);
    dings(x0, W, 5 + Math.floor(r() * 4));
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
    sh.uniforms.uWSun = { value: SUN_DIR };
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
  // How many thickets this cell wants: biome sets the ceiling, the density
  // field decides whether this particular patch of ground is woodland or open.
  const ceiling = biome.name === 'arid' ? 4 : biome.name === 'tropical' ? 14 : biome.name === 'boreal' ? 12 : 9;
  const dens = vegDensity(gx * VEG_CELL + VEG_CELL / 2, gz * VEG_CELL + VEG_CELL / 2);
  const clumps = Math.round(ceiling * (0.15 + dens * 1.25));
  for (let i = 0; i < clumps; i++) {
    const x = gx * VEG_CELL + r() * VEG_CELL, z = gz * VEG_CELL + r() * VEG_CELL;
    const rad = 6 + r() * 16 * (0.4 + dens);
    const count = Math.round((5 + r() * 14) * (0.5 + dens));
    plantClump(x, z, rad, count, pickKind(r), r);
  }
  // A few genuine loners — a lone snag or boulder still reads as deliberate.
  const strays = Math.round(r() * 3);
  for (let i = 0; i < strays; i++) {
    pushSite(gx * VEG_CELL + r() * VEG_CELL, gz * VEG_CELL + r() * VEG_CELL, r() < 0.5 ? 'rock' : 'snag', r);
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
const GRID = 24;
const gkey = (x: number, z: number): string => `${Math.floor(x / GRID)},${Math.floor(z / GRID)}`;
interface Seg { ax: number; az: number; bx: number; bz: number; hw: number; ya?: number; yb?: number; tk?: boolean; tn?: boolean;
  /** The way's OSM name. Streets were deliberately excluded from the POI set
   *  ("named streets are not destinations") — but the road you are ON is not a
   *  destination, it is your position, and that is worth saying. */
  nm?: string }
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
function surfaceAt(x: number, z: number): Surface {
  // Scan them ALL: tarmac wins wherever a track crosses or joins a road, and
  // returning on the first hit made that depend on insertion order.
  let onTrack = false;
  for (const seg of roadGrid.get(gkey(x, z)) ?? []) {
    const [cx, cz] = closestOnSeg(x, z, seg);
    if (Math.hypot(x - cx, z - cz) > seg.hw + 0.8) continue;
    if (!seg.tk) return 'road';
    onTrack = true;
  }
  if (onTrack) return 'track';
  if (waterCells.has(gkey(x, z))) return 'water';
  return seaOn && sampleHeight(x, z) < -baseElev - 0.6 ? 'water' : 'ground';
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
// The ceiling sits BELOW the tarmac across the carriageway and rises at the
// batter beyond the kerb, so the corridor's guaranteed clear airspace is ~3.2m
// over the road and for five metres either side of it before a bank may start.
const CUT_BATTER = 0.62;   // rise per metre out from the kerb — a ~32° cut face
const CUT_REACH = 14;      // how far out the cut grades before nature resumes
// The highest the ground is allowed to stand at (x,z), or null where no road
// has an opinion. Tunnels are excluded: being buried is the entire point of
// one, and carving their corridor would open every tunnel into a trench.
function roadCeiling(x: number, z: number): number | null {
  let best: number | null = null;
  const cx0 = Math.floor((x - CUT_REACH) / GRID), cx1 = Math.floor((x + CUT_REACH) / GRID);
  const cz0 = Math.floor((z - CUT_REACH) / GRID), cz1 = Math.floor((z + CUT_REACH) / GRID);
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
    const arr = roadGrid.get(`${cx},${cz}`);
    if (!arr) continue;
    for (const seg of arr) {
      if (seg.tn || seg.ya === undefined || seg.yb === undefined) continue;
      const dx = seg.bx - seg.ax, dz = seg.bz - seg.az;
      const t = clamp(((x - seg.ax) * dx + (z - seg.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      const d = Math.hypot(x - (seg.ax + dx * t), z - (seg.az + dz * t));
      // A track is worn, not engineered: it gets a narrow, shallow cut so a
      // hillside path reads as a groove rather than a road cutting.
      const reach = seg.tk ? CUT_REACH * 0.45 : CUT_REACH;
      const out = d - (seg.hw + 0.6);
      if (out > reach) continue;
      const y = seg.ya + (seg.yb - seg.ya) * t;
      const ceil = y - 0.3 + Math.max(0, out) * (seg.tk ? CUT_BATTER * 1.7 : CUT_BATTER);
      if (best === null || ceil < best) best = ceil;
    }
  }
  return best;
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
function ribbon(pts: Array<[number, number]>, width: number, mat: THREE.Material, lift: number, drivable = false, mode: RoadMode = 'none', track = false, name?: string): void {
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
  const SIGN_EVERY = 85;  // metres of straight road between hazard boards
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
  const daylight = apronOn
    ? dense.map((_, i) => (flat ? prof[i] : elev[i]) + lift - elevMin[i])
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
  const deckRun = daylight.map((_, i) => {
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
    addSeg(wallGrid, { ax: xA, az: zA, bx: xB, bz: zB, hw: 0, ya: top, yb: top });
  };
  /**
   * A hazard board on a post, facing back down the road at whoever is coming.
   * `side` is which kerb it stands on; `kind` picks a panel from the atlas.
   * The panel is turned a few degrees INTO the traffic — a real one is, so the
   * retroreflection reaches the driver rather than the sky.
   */
  const sign = (
    px: number, py: number, pz: number, fwdX: number, fwdZ: number, side: number, kind: number,
  ): void => {
    const l = Math.hypot(fwdX, fwdZ) || 1;
    const fx = fwdX / l, fz = fwdZ / l;
    // Facing back along the way, canted 12° toward the carriageway.
    const a = Math.atan2(-fx, -fz) + side * 0.21;
    const rx = Math.cos(a), rz = -Math.sin(a);      // the panel's own width axis
    const HW = 0.82, TOP = 2.0, BOT = 0.86;         // a 1.64m board, low enough to sit in the beam
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
      const s: Seg = { ax: x0, az: z0, bx: x1, bz: z1, hw: width / 2, ya: prof[i], yb: prof[i + 1], tk: track, nm: name };
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
          rail(ex0 + ox * sgn * 0.04, ey0, ez0 + oz * sgn * 0.04,
            ex1 + ox * sgn * 0.04, ey1, ez1 + oz * sgn * 0.04, along / 2.5, (along + len) / 2.5);
        }
      }
      // ── hazard boards ──
      // Two rules, and the second is the one that matters. On a straight, a
      // sign every ~85m with a wide jitter, so the roadside has furniture
      // without a rhythm. On a BEND, always — and on the OUTSIDE of it, which
      // is both where the real ones go and where your headlights are pointing
      // as you turn in. A chevron you meet mid-corner is the difference between
      // reading the road and discovering it.
      {
        const turn = i + 1 < n - 1 ? bendAt(i + 1) : 0;
        const sharp = turn > (BEND_DEG * Math.PI) / 180;
        signRun += len;
        if (sharp ? signRun > 16 : signRun > SIGN_EVERY * (0.55 + signRng() * 0.9)) {
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
            sign(sx, sy, sz, dx, dz, outward, sharp ? 0 : signRng() < 0.5 ? 1 : 2);
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
interface OsmWay { id: number; tags?: Record<string, string>; geometry: Array<{ lat: number; lon: number }> }
// Only the tags renderWays actually reads — the rest is dead weight per way.
const KEEP_TAGS = ['highway', 'building', 'building:levels', 'natural', 'waterway', 'landuse', 'leisure', 'tunnel', 'bridge', 'layer', 'name'];
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
const osmCacheKey = (x: number, y: number): string => `3/${OSM_Z}/${x}/${y}`; // v3: keeps tunnel/bridge/name tags
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
interface Poi { name: string; x: number; z: number; kind: 'park' | 'water' | 'place' | 'mission'; pinned?: boolean }
const pois = new Map<string, Poi>();
function notePoi(tags: Record<string, string>, pts: Array<[number, number]>): void {
  const name = tags.name;
  if (!name || pois.has(name) || pois.size >= 400) return;
  const kind: Poi['kind'] | null =
    tags.natural === 'water' || tags.waterway ? 'water'
    : tags.building ? 'place'
    : tags.leisure || tags.landuse ? 'park'
    : null; // named streets are not destinations
  if (!kind) return;
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  pois.set(name, { name, x: cx / pts.length, z: cz / pts.length, kind });
}

function renderWays(els: OsmWay[]): void {
  for (const el of els) {
    if (!el.geometry || seenWays.has(el.id)) continue;
    seenWays.add(el.id);
    const pts: Array<[number, number]> = el.geometry.map((g) => toLocal(g.lat, g.lon));
    const tags = el.tags ?? {};
    notePoi(tags, pts);
    if (tags.highway) {
      const w = ROAD_W[tags.highway] ?? 5;
      // THREE tiers, not two. A mountain path used to render as decoration you
      // could not feel underfoot — you crossed Chapman's Peak reading ROUGH the
      // whole way. Tracks now carry their own grip, and are drawn as ruts.
      const track = ['track', 'path', 'bridleway', 'cycleway', 'footway'].includes(tags.highway);
      const stairs = tags.highway === 'steps';   // nothing drives up steps
      // Curb-scale lifts (was 1.6m — roads read as elevated causeways). The
      // stack keeps its z-order: green 0.2 < water 0.3 < track 0.5 < road 0.6.
      const mode: RoadMode = track || stairs ? 'none'
        : tags.tunnel && tags.tunnel !== 'no' ? 'tunnel'
        : tags.bridge && tags.bridge !== 'no' ? 'bridge'
        : 'auto';
      ribbon(pts, w, stairs ? MAT.minor : track ? MAT.track : MAT.road,
        track || stairs ? 0.5 : 0.6, !stairs, mode, track, tags.name);
      // Steps are named and drawn but nothing drives them, so they earn no
      // checkpoints — a road you cannot survey should not sit in the log.
      if (tags.name && !stairs) noteSurvey(tags.name, pts, track);
    } else if (tags.building) {
      building(pts, el.id, parseFloat(tags['building:levels'] ?? '') || 2);
    } else if (tags.natural === 'water' || tags.waterway === 'riverbank') {
      polygon(pts, MAT.water, 0.45, 0, 'water');
    } else {
      polygon(pts, MAT.green, 0.2);
      scatterVeg(pts, el.id, tags);
    }
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
async function renderGated(x: number, y: number, ways: OsmWay[]): Promise<void> {
  const b = tileBounds(x, y, OSM_Z);
  const [txA, tyA] = tileAt(b.latN, b.lonW, TERRAIN_Z);
  const [txB, tyB] = tileAt(b.latS, b.lonE, TERRAIN_Z);
  const waits: Array<Promise<void>> = [];
  for (let tx = Math.min(txA, txB) - 1; tx <= Math.max(txA, txB) + 1; tx++)
    for (let ty = Math.min(tyA, tyB) - 1; ty <= Math.max(tyA, tyB) + 1; ty++)
      waits.push(loadTerrainTile(tx, ty));
  await Promise.all(waits);
  renderWays(ways);
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
async function proxyTile(x: number, y: number): Promise<OsmWay[] | null> {
  if (!tileProxyOk) return null;
  const ctl = new AbortController();
  const bail = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch(`${CELL_BASE}/~/osm/v1/${OSM_Z}/${x}/${y}`, { signal: ctl.signal });
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
  } catch {
    return null;
  } finally { clearTimeout(bail); }
}

async function loadOsmTile(x: number, y: number): Promise<void> {
  const key = `${x}/${y}`;
  if (osmLoaded.has(key)) return;
  osmLoaded.add(key);
  const cached = await readTileCache(x, y);
  if (cached) { await renderGated(x, y, cached); osmDone.add(key); return; }
  osmNote(1);
  if (osmInFlight >= 2) { await new Promise<void>((r) => osmQueue.push(r)); }
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
    await renderGated(x, y, ways);
    osmDone.add(key);
  } catch {
    if (++osmFails >= 2) osmDown = true;
    setTimeout(() => osmLoaded.delete(key), 8000); /* backoff, then a later pass retries */
  }
  finally {
    osmInFlight--;
    osmNote(-1);
    osmQueue.shift()?.();
  }
}

// ── streaming around the car ───────────────────────────────────────
function localToLatLon(ex: number, ez: number): [number, number] {
  return [origin.lat - ez / M_LAT, origin.lon + ex / origin.mLon];
}
function streamWorld(ex: number, ez: number): void {
  const [lat, lon] = localToLatLon(ex, ez);
  const [tx, ty] = tileAt(lat, lon, TERRAIN_Z);
  for (let dx = -TERRAIN_RING; dx <= TERRAIN_RING; dx++)
    for (let dy = -TERRAIN_RING; dy <= TERRAIN_RING; dy++) void loadTerrainTile(tx + dx, ty + dy);
  const [ox, oy] = tileAt(lat, lon, OSM_Z);
  for (let dx = -OSM_RING; dx <= OSM_RING; dx++)
    for (let dy = -OSM_RING; dy <= OSM_RING; dy++) void loadOsmTile(ox + dx, oy + dy);
}

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
function rollWeather(now: number): void {
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
  const t = WX[wx.next];
  const k = Math.min(1, dt * 0.12);                 // fronts arrive slowly
  wx.cloud += (t.cloud - wx.cloud) * k;
  wx.rain += (t.rain - wx.rain) * k;
  wx.sky = wx.cloud > 0.85 ? 'storm' : wx.rain > 0.15 ? 'rain' : wx.cloud > 0.25 ? 'haze' : 'clear';
  // Ground stays wet after the rain stops, and dries out slowly.
  wx.wet = clamp(wx.wet + (wx.rain > 0.1 ? dt * 0.09 : -dt * 0.02), 0, 1);
  sun.intensity = biome.sunI * (1 - wx.cloud * 0.72);
  hemi.intensity = biome.hemiI * (1 + wx.cloud * 0.35);
  compMat.uniforms.uBloom.value = 0.75 - wx.cloud * 0.35;
  skyMat.uniforms.uCloud.value = wx.cloud;
  skyMat.uniforms.uTime.value = now / 1000;
  waterU.uWTime.value = now / 1000;
  // Cloud shadows read the same cover and drift as the deck overhead.
  ghostU.uCloudS.value = cloudShadowOn ? wx.cloud : 0;
  ghostU.uWind.value.set((now / 1000) * 0.006, (now / 1000) * 0.0022);
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
(window as unknown as { __drive?: object; __surfaceAt?: (x: number, z: number) => string }).__drive = state;
(window as unknown as { __surfaceAt?: (x: number, z: number) => string }).__surfaceAt = surfaceAt; // debug/test handles (read-only use)
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
const stickNub = stickEl(46, { background: 'rgba(245,196,83,0.75)', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' });
let stick: { id: number; x0: number; y0: number; dx: number; dy: number } | null = null;
let brakeId: number | null = null;
// The chart (top) view pans and zooms like a map: the stick lives PINNED at
// bottom-right there; dragging anywhere else pans, pinching zooms, and the
// wheel zooms on desktop. Chase keeps the appear-where-the-thumb-lands stick
// with second-finger brake.
let panX = 0, panZ = 0, zoomT = 1, zoomCur = 1;
const panPtrs = new Map<number, { x: number; y: number }>();
const stickHome = (): { x: number; y: number } => ({ x: innerWidth - 84, y: innerHeight - 118 });
function updateStickHome(): void {
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
      if (d0 > 12 && d1 > 12) zoomT = clamp(zoomT * (d0 / d1), 0.25, 44); // survey a whole region
    }
  }
  panPtrs.set(e.pointerId, cur);
});
addEventListener('wheel', (e) => {
  if (camMode !== 'top') return;
  zoomT = clamp(zoomT * Math.exp(e.deltaY * 0.0012), 0.25, 44);
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

// ── camera modes: top-down chart ⇄ low chase ───────────────────────
let camMode: 'top' | 'chase' = 'top';
const camPos = new THREE.Vector3();
let camInit = false;
const miniCam = new THREE.PerspectiveCamera(60, 1, 1, 30000); // the dock's POV preview rig
function toggleCam(): void {
  camMode = camMode === 'top' ? 'chase' : 'top';
  halo.visible = camMode === 'top'; // the marker is chart furniture, not scenery
  if (camMode === 'chase') halo.scale.setScalar(1);
  camInit = false;                  // snap to the new rig, then resume smoothing
  panX = panZ = 0;                  // pan is a glance, not a state to carry over
  updateStickHome();
  updateDock();
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
const POI_COLORS: Record<Poi['kind'], string> = { park: '#7fae6a', water: '#6aa3d8', place: '#d8b46a', mission: '#f5c453' };
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
  // EVERY nearby road, not just the one under the wheels. Scoping this to
  // wayAt() was why ghosts looked broken: the marker for the checkpoint you
  // are driving towards vanished the moment a wheel touched the verge, and
  // never appeared at all for the road you were about to turn onto.
  for (const r of survey.values()) {
    for (const c of r.cps) {
      cpCull.total++;
      const age = c.at ? now - c.at : Infinity;
      // PING shows ONLY what you just took, and nothing else, ever. The other
      // modes add the ones still out there.
      if (cpVis === 1 ? age > 1400 : c.got && age > 1400) { cpCull.taken++; continue; }
      const d = Math.hypot(c.x - state.x, c.z - state.z);
      if (d > CP_SIGHT) { cpCull.far++; continue; }
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
      if (cpDraw.length >= 60) return;
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
    history.replaceState(null, '', `?lat=${la.toFixed(5)}&lon=${lo.toFixed(5)}&h=${deg.toFixed(0)}${camMode === 'chase' ? '&cam=chase' : ''}${m}`);
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
  road: { max: 50, drag: 0.28, lift: 0.6, rough: 0.015, mu: 1.05, lat: 6.5 },
  // The middle tier: a graded dirt track. Equilibrium speed is accel/drag, so
  // 0.36 sits it between tarmac's 57m/s and open ground's 32 — quick enough
  // that finding a track is a relief, rough enough that it is not a road.
  track: { max: 40, drag: 0.36, lift: 0.5, rough: 0.07, mu: 0.8, lat: 5 },
  ground: { max: 32, drag: 0.5, lift: 0.25, rough: 0.16, mu: 0.6, lat: 3.2 }, // monster truck: off-road is its element
  water: { max: 3.5, drag: 3.5, lift: 0.3, rough: 0.05, mu: 0.3, lat: 2 },
} as const;
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
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const { throttle, steer, brake } = input();
  stepWeather(now, dt);
  const surfKind = surfaceAt(state.x, state.z);
  const surf = SURFACE[surfKind];
  // Arcade bicycle model: thrust minus drag, steering authority grows then
  // saturates with speed so the car neither pivots in place nor becomes twitchy.
  const thrust = brake
    ? -Math.sign(state.speed) * CAR.brake * 1.4
    : throttle >= 0 ? throttle * CAR.accel : throttle * CAR.brake;
  // Grip comes from wheels on the ground: airborne there's no drive, no
  // braking, barely any steering — and gravity along the body's pitch makes
  // climbs cost speed and descents pay it back.
  const grip = groundedF;
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
  const SRATE = 7; // full-lock in ~0.14s — responsive but not snappy
  steerCur += clamp(steer - steerCur, -SRATE * dt, SRATE * dt);
  let yawRate = 0;
  if (Math.abs(state.speed) > 0.1) {
    // Authority decays with speed (like a real wheel): full lock is a parking
    // move, a nudge at 180 — turn RATE stays sane across the whole range.
    const authority = (0.15 + 0.85 * grip) / (1 + Math.abs(state.speed) / 12);
    yawRate = (steerCur * CAR.steerMax * authority * state.speed) / CAR.wheelbase;
    state.heading += yawRate * dt;
  }
  state.x += Math.sin(state.heading) * state.speed * dt;
  state.z -= Math.cos(state.heading) * state.speed * dt;
  // ── the tyres have a budget, and it is spent in every direction at once ──
  // Two things pull the truck sideways. A SIDE-SLOPE, always — nothing used
  // to, and you could traverse a 40° face as if it were a car park. And a
  // CORNER: turning at v with yaw rate ω demands v·ω of centripetal
  // acceleration, while the contact patch can supply mu·g and no more, less
  // whatever the throttle or the brakes have already claimed. What the tyres
  // cannot supply, the truck keeps as sideways velocity — it runs wide, and on
  // gravel it keeps running until the scrub bleeds it off. That is the drift.
  {
    const sH = Math.sin(state.heading), cH = Math.cos(state.heading);
    const budget = surf.mu * GRAV * grip * (1 - wx.wet * 0.28);
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
  evictFromBuildings();
  // Buildings are solid: push the car circle out of any nearby wall edge and
  // scrub speed while in contact — sliding along a façade falls out of the
  // push-out geometry for free.
  let scraping = false;
  for (let pass = 0; pass < 2; pass++) {
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
      }
    }
    scraping = scraping || hit;
    if (!hit) break;
  }
  if (scraping) state.speed *= Math.exp(-5 * dt);
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
    wheelWorld.push([wxw, wzw]);
    wheelSurf.push(sk);
    // groundAt, not sampleHeight: where a road is cut into a hillside the
    // terrain has been carved back, and the wheels must ride what is drawn.
    let g = groundAt(wxw, wzw);
    if (sk === 'road') {
      // Ride the ROAD's profile (tunnel chords included) — but only near the
      // car's current level, so the hill above a tunnel doesn't swallow us.
      const rh = roadHeightAt(wxw, wzw);
      if (rh !== null && Math.abs(rh - (prevGround ?? g)) < 4) g = rh;
    } else if (sk === 'water') {
      // Float LOW. The truck wades rather than skims: the hull settles until
      // the water is up around the axles, which is why the splashes shrink —
      // there is far less wheel left above the surface to throw anything.
      if (seaOn) g = Math.max(g, -baseElev - 0.35);   // the surface, not the seabed
      g -= WHEEL_R * 0.85;
    }
    rawSum += g;
    const sw = SURFACE[sk];
    smooth.push(g + sw.lift);
    contacts.push(g + sw.lift + roughNoise(wxw, wzw) * sw.rough);
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
  let aY = SUSP.k * (tY - bodyY) - SUSP.d * (vBodyY - terrainVy);
  if (aY < -9.81) aY = -9.81; // falling is gravity's job — crests launch
  vBodyY += aY * dt; bodyY += vBodyY * dt;
  if (bodyY < tY - SUSP.travel) {
    bodyY = tY - SUSP.travel;
    if (vBodyY < 0) { if (vBodyY < -2.5) audio.thud(Math.min(3, -vBodyY / 3)); vBodyY *= -0.25; } // bump stop
  }
  vPitch += (SUSP.ka * (tPitch - pitchC) - SUSP.da * vPitch) * dt; pitchC += vPitch * dt;
  vRoll += (SUSP.ka * (tRoll - rollC) - SUSP.da * vRoll) * dt; rollC += vRoll * dt;
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
  beamMat.uniforms.uAmp.value = camMode === 'chase' ? 1 : 0.25;
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
  beamProbe.uBeamAmt.value = (camMode === 'chase' ? 1 : 0.35) * (0.55 + 0.45 * wx.cloud);
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
  if (wildlifeOn) stepWildlife(dt);
  stepOdo(dt, now);
  stepMission(now);
  stepSurvey(now);
  if (now > vegAt) { vegAt = now + 900; refreshVeg(); }
  audio.update(state.speed, throttle, surfKind, groundedF, wx.rain, engRev, engGear, skid);
  reveal(state.x, state.z);
  if (now > streamAt) { streamAt = now + 1200; streamWorld(state.x, state.z); }
  // Two rigs. TOP: the chart view, tilted a touch for relief. CHASE: low and
  // behind, where speed is legible and the fog reads as a night horizon.
  const fwdX = Math.sin(state.heading), fwdZ = -Math.cos(state.heading);
  if (camMode === 'top') {
    zoomCur += (zoomT - zoomCur) * Math.min(1, 8 * dt);
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
    setNear(Math.max(1, dist * 0.08));
  } else {
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
  if (!camInit) { camera.position.copy(camPos); camInit = true; }
  else camera.position.lerp(camPos, 1 - Math.exp(-(camMode === 'top' ? 10 : 4.5) * dt));
  if (camMode === 'top') camera.lookAt(state.x + panX, sampleHeight(state.x + panX, state.z + panZ), state.z + panZ);
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
  drawHud(surfKind, Math.round(Math.abs(state.speed) * 3.6), groundedF);
  if (camMode === 'chase' && now > miniAt) { miniAt = now + 250; drawMinimap(); }
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
  const v = (u: { value: THREE.Vector3 }, c: Rgb): void => u.value.set(c[0], c[1], c[2]);
  v(skyMat.uniforms.uZenith as { value: THREE.Vector3 }, b.zenith);
  v(skyMat.uniforms.uHorizon as { value: THREE.Vector3 }, b.horizon);
  v(skyMat.uniforms.uSunDisc as { value: THREE.Vector3 }, b.sunDisc);
  v(skyMat.uniforms.uBelow as { value: THREE.Vector3 }, b.below);
  v(compMat.uniforms.uHazeBase as { value: THREE.Vector3 }, b.hazeBase);
  v(compMat.uniforms.uHazeSun as { value: THREE.Vector3 }, b.hazeSun);
  sun.color.setHex(b.sun); sun.intensity = b.sunI;
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
const TABS = ['VEHICLE', 'WORLD', 'SYSTEM'];
const TAB_ITEMS: Item[][] = [
  [],   // the vehicle bay is a readout, not a control panel
  [
    { col: () => UI.gold, label: () => 'ELSEWHERE', hit: () => { location.href = location.pathname + '?random=1'; } },
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
  { name: 'BIG SUR', sub: 'CALIFORNIA · BIXBY CREEK', lat: 36.3714, lon: -121.9019, h: 340 },
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
let drivePage = 0, drivePages = 1;
const driveRects: Array<{ x: number; y: number; w: number; h: number; i: number }> = [];
let drivePageRect = { x: 0, y: 0, w: 0, h: 0 };

// ── dials ──────────────────────────────────────────────────────────
// Every one of these was a constant buried somewhere in the render chain. A
// dial CYCLES rather than sliding: a stepped list reads at 3x5 pixels, a slider
// does not, and there is nothing here whose value is worth more resolution than
// four named steps.
interface Dial { key: string; label: string; opts: string[]; apply: (i: number) => void; at: number }
interface DialGroup { title: string; dials: Dial[] }
const dial = (key: string, label: string, opts: string[], def: number, apply: (i: number) => void): Dial =>
  ({ key, label, opts, apply, at: def });
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

function drawHud(surf: Surface, kmh: number, grip: number): void {
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
    // one you are about to reach.
    const near = clamp(1 - c.d / CP_SIGHT, 0, 1);
    hctx.save();
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
  // Floor sized so the widest weather word (STORM) and the widest bearing
  // (NE270) both fit whole on one line with air between them.
  const CONDW = Math.max(82, mw + 16);
  const condH = 42;
  const sy = my - condH - 3;
  // ── conditions: surface, grip, weather, wetness, heading ──
  panel(pad, sy, CONDW, condH);
  const sname = surf === 'road' ? 'ROAD' : surf === 'track' ? 'TRACK' : surf === 'water' ? 'WATER' : 'ROUGH';
  const scol = surf === 'road' ? UI.good : surf === 'track' ? UI.edge : UI.hot;
  textSmall(hctx, 'SURFACE', pad + 3, sy + 3, UI.dim);
  glowText(sname, pad + 3, sy + 10, scol);
  meter(pad + 3, sy + 18, 10, Math.round(clamp(grip, 0, 1) * 10), scol, 3, 3, 1);
  {
    // Weather belongs with the other things that decide how the truck behaves,
    // not floating under the place name where it read as a caption.
    const w = WX[wx.sky];
    const wcol = wx.sky === 'storm' ? UI.bad : wx.rain > 0.1 ? UI.edge : UI.soft;
    textSmall(hctx, 'WEATHER', pad + 3, sy + 25, UI.dim);
    // The bearing rides on the weather line, not the wet line: beside a bar it
    // had four pixels of air and read as part of the meter.
    const hs = `${CARD8[Math.round(deg / 45) % 8]}${Math.round(deg)}`;
    // Two readouts on one line need a hard divider between them, or CLEAR and
    // W290 butt together into one word. Clip the label, never the bearing.
    const hx = pad + CONDW - textSW(hs) - 4;
    textSmall(hctx, fitS(w.label, hx - (pad + 34) - 4), pad + 34, sy + 25, wcol);
    textSmall(hctx, hs, hx, sy + 25, UI.gold);
    // Standing water is grip you have already lost — worth its own bar.
    textSmall(hctx, 'WET', pad + 3, sy + 34, UI.dim);
    meter(pad + 20, sy + 34, 12, Math.round(clamp(wx.wet, 0, 1) * 12), wx.wet > 0.5 ? UI.bad : UI.edge, 3, 3, 1);
    // Grip you are losing RIGHT NOW. Only shown while it is happening — a
    // permanently empty bar is noise, and this line is the one you glance at
    // mid-corner.
    if (skid > 0.06) {
      const s = `SLIP${skid > 0.55 ? '!' : ''}`;
      textSmall(hctx, s, pad + CONDW - textSW(s) - 4, sy + 34, skid > 0.55 ? UI.bad : UI.gold);
    }
  }
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
    }
  }
  // ── speed, bottom-right ──
  const digits = String(kmh);
  const sw = textW(digits, 2) + textW('KM/H') + 12;
  const sx = HW - sw - pad, spy = HH - 20 - pad;
  panel(sx, spy, sw, 18, UI.gold);
  glowText(digits, sx + 4, spy + 3, UI.gold, 2);
  text(hctx, 'KM/H', sx + 8 + textW(digits, 2), spy + 9, UI.edge);
  // The odometer rides above the speed, in the micro face — it is a number you
  // glance at between drives, not one you read at 90km/h.
  {
    const o = fmtKm(odo.total);
    textEdgeS(o, HW - textSW(o) - pad - 1, spy - 8, UI.soft);
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
  let tx = MX + 5;
  for (let i = 0; i < TABS.length; i++) {
    const w = textW(TABS[i]) + 8;
    const on = tab === i;
    if (on) panel(tx, MY + 25, w, 12, UI.gold);
    text(hctx, TABS[i], tx + 4, MY + 28, on ? UI.gold : UI.soft);
    tabRects.push({ x: tx, y: MY + 25, w, h: 12, i });
    tx += w + 3;
  }
  const top = MY + 41;
  if (tab === 0) {
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
    const vh = clamp(Math.round(bw / natural), 78, Math.round(MH * 0.5));
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
    // The rig's own dials live with the rig, not in a settings screen.
    drawDials(DIAL_GROUPS.filter((g) => g.title === 'VEHICLE'), MX, MW, y + 5);
  } else {
    // ── readouts, then the controls for this tab ──
    let y = top;
    const rows: Array<[string, string]> = tab === 1
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
    if (tab === 1) {
      rows.push(['DRIVEN', `${fmtKm(odo.trip)} TRIP · ${fmtKm(odo.total)} TOTAL`]);
      rows.push(['VECTORS', osmDown ? 'UNAVAILABLE - RETRYING' : streaming ? 'STREAMING' : 'LOADED']);
    }
    for (const [k, v] of rows) {
      textSmall(hctx, k, MX + 6, y, UI.dim);
      textSmall(hctx, v, MX + 52, y, UI.text);
      y += 8;
    }
    if (tab === 2) y = drawDials(DIAL_GROUPS.filter((g) => g.title !== 'VEHICLE'), MX, MW, y + 4);
    y += 6;
    const items = TAB_ITEMS[tab];
    if (tab === 1) {
      // ── the curated starts ──
      // The list takes whatever room is left between the readouts and the
      // buttons, and pages if the screen is too short for all of it — a phone
      // in landscape has barely a third of the height of one held upright.
      const btnH = items.length * 16 + 8;
      const room = Math.max(2, MY + MH - 6 - btnH - (y + 10));
      const perPage = Math.max(3, Math.floor(room / 11));
      const pages = Math.ceil(DRIVES.length / perPage);
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
      for (let i = from; i < Math.min(DRIVES.length, from + perPage); i++) {
        const d = DRIVES[i];
        text(hctx, fit(d.name, MW * 0.52), MX + 6, y, UI.text);
        const sub = fitS(d.sub, MW * 0.46);
        textSmall(hctx, sub, MX + MW - textSW(sub) - 7, y + 2, UI.dim);
        driveRects.push({ x: MX + 4, y: y - 2, w: MW - 8, h: 11, i });
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
      textSmall(hctx, v, MX + MW - textSW(v) - 9, y, UI.gold);
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
    for (const r of driveRects) if (inside(r, 0)) { startDrive(DRIVES[r.i]); return true; }
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
applyDials();
$('reroll').addEventListener('click', () => { location.href = location.pathname + '?random=1'; });
(async () => {
  const spawn = await findSpawn();
  origin = { lat: spawn.lat, lon: spawn.lon, mLon: M_LAT * Math.cos((spawn.lat * Math.PI) / 180) };
  placeLabel = spawn.name ?? '…';
  renderPlace();
  // Resume orientation and camera from the URL (written live while driving).
  const q = new URLSearchParams(location.search);
  const h0 = parseFloat(q.get('h') ?? '');
  if (Number.isFinite(h0)) state.heading = (h0 * Math.PI) / 180;
  if (q.get('cam') === 'chase' && camMode === 'top') toggleCam();
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
  if (baseElev >= -2) { seaOn = true; sea.position.y = -baseElev + 0.1; }
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
  bootMsg('tap to start');
  $('boot').classList.add('ready');
  await new Promise<void>((go) => {
    const start = (): void => {
      audio.arm();
      removeEventListener('pointerdown', start);
      removeEventListener('keydown', start);
      go();
    };
    addEventListener('pointerdown', start);
    addEventListener('keydown', start);
  });
  $('boot').classList.add('done');
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick); });
})();

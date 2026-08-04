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
    const url = OVERPASS[(overpassI + attempt) % OVERPASS.length];
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query) });
      if (res.status === 429 || res.status === 504) throw new Error('busy');
      if (!res.ok) throw new Error(String(res.status));
      return await res.json();
    } catch {
      overpassI++; // rotate mirrors on failure
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
  },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform vec3 sunDir; uniform vec3 uZenith; uniform vec3 uHorizon;
    uniform vec3 uSunDisc; uniform vec3 uBelow; varying vec3 vDir;
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
const PIX_H = 320; // vertical resolution of the rendered world
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
    uBloom: { value: 0.75 },
    uScan: { value: 0.06 },
  },
  vertexShader: QUAD_VS,
  fragmentShader: `
    uniform sampler2D sceneTex; uniform sampler2D softTex; uniform sampler2D depthTex;
    uniform sampler2D bloomTex; uniform float uBloom; uniform float uScan;
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
        // Fog of war starts BEYOND a clear bubble. You can obviously see the
        // ground at your own wheels whether or not you have "explored" it; a
        // ramp that began at zero metres put 55% milk over the near field the
        // moment the haze turned daylight-bright.
        float near = 1.0 - exp(-max(t - 130.0, 0.0) / 300.0);
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
      enc = floor(enc * LEVELS + d + 0.5) / LEVELS;
      // Scanlines on the PIXEL grid (every other buffer row), so they scale
      // with the art instead of shimmering against the display's real pixels.
      enc *= 1.0 - uScan * mod(floor(vUv.y * uPix.y), 2.0);
      gl_FragColor = vec4(clamp(enc, 0.0, 1.0), 1.0);
    }`.replace(/LEVELS/g, '14.0'),
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
};
// (Pattern per SimonDev's "customizing materials": extend the built-ins by
// splicing GLSL into their chunk includes rather than rewriting materials —
// the same hook carries the ghost corridor and the terrain's detail mottle.)
function ghostify(mat: THREE.Material, opts: { detail?: boolean } = {}): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGhostCar = ghostU.uGhostCar;
    sh.uniforms.uGhostCam = ghostU.uGhostCam;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGhostW;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGhostW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGhostW;\nuniform vec3 uGhostCar;\nuniform vec3 uGhostCam;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
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
    // The SAME bilinear field the roads/buildings/car sample (sampleHeight) —
    // a nearest-pixel mesh disagreed with it by metres and swallowed every
    // draped layer under the terrain skin.
    const elev = sampleHeight(ex, ez);
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
    const nt = heightTiles.get(`${x + dx}/${y + dy}`);
    if (nt && terrainMeshes.has(`${x + dx}/${y + dy}`)) buildTerrainMesh(nt);
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
const ROAD_W: Record<string, number> = { motorway: 13, trunk: 12, primary: 10.5, secondary: 9.5, tertiary: 8.5, residential: 7.5, unclassified: 7, service: 4.5, living_street: 6.5, track: 3.5, footway: 2.2, path: 2.0, cycleway: 2.6, pedestrian: 6 };
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
const MAT = {
  road: new THREE.MeshLambertMaterial({ map: roadTex, side: DS }),
  minor: new THREE.MeshLambertMaterial({ map: pathTex, transparent: true, opacity: 0.85, side: DS }),
  water: new THREE.MeshLambertMaterial({ map: waterTex, side: DS }),
  green: new THREE.MeshLambertMaterial({ map: greenTex, side: DS }),
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
// Building tints vary per way id so a block reads as parcels, not one slab.
// Extrude material slots: [0]=caps (roof), [1]=side walls (darker).
const B_MATS = [0xa59a85, 0x92897a, 0x9d937f, 0x878071].map((c, i) => {
  const side = new THREE.Color(c).multiplyScalar(0.72);
  return [
    new THREE.MeshLambertMaterial({ color: c, map: roofTex, side: DS }),
    new THREE.MeshLambertMaterial({ color: side, map: wallTexes[i % wallTexes.length], side: DS }),
  ] as [THREE.Material, THREE.Material];
});
// ── the sea ────────────────────────────────────────────────────────
// Terrarium tiles carry BATHYMETRY and OSM's open sea has no water polygon
// (coastline ≠ natural=water), so coasts rendered as sunken seabed. One vast
// plane at sea level fills every below-sea basin; land simply occludes it.
// Disabled when the spawn itself sits in a true depression (Death Valley).
const seaTex = waterTex.clone();
seaTex.repeat.set(1550, 1550); // plane UVs are 0..1 across 40km → ~26m ripple tiles
seaTex.needsUpdate = true;
const sea = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshLambertMaterial({ map: seaTex, side: DS }));
sea.rotation.x = -Math.PI / 2;
sea.position.y = -1e6; // parked until boot anchors sea level
scene.add(sea);
let seaOn = false;

// ── vegetation: two instanced archetypes, deterministically scattered ──
// Overgrowth is GEOMETRY, not texture. Every green polygon seeds its own
// mulberry32 from its way id, so the same park grows the same trees on every
// device and every visit. Two InstancedMeshes cover the whole world — two
// draw calls, however many thousand plants.
const VEG_MAX = 3600;
const vegDummy = new THREE.Object3D();
function vegMesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, VEG_MAX);
  m.count = 0;
  m.frustumCulled = false; // instances are spread across the whole world
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(m);
  return m;
}
// Canopy: a squashed icosahedron, flat-shaded — chunky enough to survive the
// eventual pixel-art pass, cheap enough to plant thousands of.
const canopyGeo = new THREE.IcosahedronGeometry(1, 0);
canopyGeo.scale(1, 0.85, 1);
const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1, 5);
trunkGeo.translate(0, 0.5, 0);
// NOT vertexColors: per-instance tint arrives through instanceColor, which
// three defines independently. Asking for vertexColors on geometry that has
// no color attribute multiplies by an unbound (black) attribute.
const treeMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
const trunkMat = new THREE.MeshLambertMaterial({ color: 0x3a2c20, flatShading: true });
const bushMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
const trees = vegMesh(canopyGeo, treeMat);
const trunks = vegMesh(trunkGeo, trunkMat);
const bushes = vegMesh(canopyGeo, bushMat);
for (const m of [trees, bushes]) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(VEG_MAX * 3), 3);
ghostify(treeMat);
ghostify(bushMat);
const vegTint = new THREE.Color();
function plant(kind: 'tree' | 'bush', x: number, z: number, y: number, r: () => number): void {
  const mesh = kind === 'tree' ? trees : bushes;
  if (mesh.count >= VEG_MAX) return;
  const i = mesh.count++;
  const s = kind === 'tree' ? 1.7 + r() * 2.3 : 0.7 + r() * 0.9;
  const trunkH = kind === 'tree' ? 1.4 + r() * 1.8 : 0;
  vegDummy.position.set(x, y + trunkH + s * 0.55, z);
  vegDummy.rotation.set((r() - 0.5) * 0.25, r() * Math.PI, (r() - 0.5) * 0.25);
  vegDummy.scale.set(s, s * (0.8 + r() * 0.5), s);
  vegDummy.updateMatrix();
  mesh.setMatrixAt(i, vegDummy.matrix);
  // Sun-bleached to deep shade, so a stand of trees never reads as one blob.
  vegTint.setHSL(biome.vegHue[0] + r() * biome.vegHue[1], 0.32 + r() * 0.25, biome.vegLit[0] + r() * biome.vegLit[1]);
  mesh.setColorAt(i, vegTint);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  if (kind === 'tree' && trunks.count < VEG_MAX) {
    const j = trunks.count++;
    vegDummy.position.set(x, y, z);
    vegDummy.rotation.set(0, 0, 0);
    vegDummy.scale.set(s * 0.5, trunkH + s * 0.4, s * 0.5);
    vegDummy.updateMatrix();
    trunks.setMatrixAt(j, vegDummy.matrix);
    trunks.instanceMatrix.needsUpdate = true;
  }
}
// Scatter inside a polygon by rejection sampling — density and mix set by
// what the land actually is.
function scatterVeg(pts: Array<[number, number]>, seed: number, tags: Record<string, string>): void {
  let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
  for (const [x, z] of pts) {
    minx = Math.min(minx, x); maxx = Math.max(maxx, x);
    minz = Math.min(minz, z); maxz = Math.max(maxz, z);
  }
  const w = maxx - minx, d = maxz - minz;
  if (w < 6 || d < 6 || w > 4000 || d > 4000) return;
  const wooded = tags.landuse === 'forest' || tags.natural === 'wood';
  const bare = tags.leisure === 'pitch' || tags.landuse === 'grass' || tags.landuse === 'meadow';
  const per = wooded ? 260 : bare ? 2600 : 900; // m² per plant
  const n = Math.min(90, Math.floor((w * d) / per));
  if (n < 1) return;
  const r = mulberry32(seed >>> 0);
  for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
    const x = minx + r() * w, z = minz + r() * d;
    if (!pointInPoly(x, z, pts)) continue;
    if (surfaceAt(x, z) === 'road') continue; // never in the carriageway
    k++;
    plant(wooded || r() < 0.45 ? 'tree' : 'bush', x, z, sampleHeight(x, z), r);
  }
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
interface Seg { ax: number; az: number; bx: number; bz: number; hw: number; ya?: number; yb?: number }
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
type Surface = 'road' | 'water' | 'ground';
function surfaceAt(x: number, z: number): Surface {
  for (const seg of roadGrid.get(gkey(x, z)) ?? []) {
    const [cx, cz] = closestOnSeg(x, z, seg);
    if (Math.hypot(x - cx, z - cz) <= seg.hw + 0.8) return 'road';
  }
  if (waterCells.has(gkey(x, z))) return 'water';
  return seaOn && sampleHeight(x, z) < -baseElev - 0.6 ? 'water' : 'ground';
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

type RoadMode = 'none' | 'auto' | 'tunnel' | 'bridge';
const TUNNEL_TOL = 5;  // metres of terrain above the smoothed profile ⇒ tunnel
const TUNNEL_H = 5;    // clearance of the carved tube
function ribbon(pts: Array<[number, number]>, width: number, mat: THREE.Material, lift: number, drivable = false, mode: RoadMode = 'none'): void {
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
  let along = 0; // metres travelled — v wraps every 20m (the roadTex period)
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
    along += len;
    verts.push(
      x0 + nx, y00, z0 + nz, x1 + nx, y10, z1 + nz, x0 - nx, y01, z0 - nz,
      x1 + nx, y10, z1 + nz, x1 - nx, y11, z1 - nz, x0 - nx, y01, z0 - nz,
    );
    uvs.push(0, v0, 0, v1, 1, v0, 0, v1, 1, v1, 1, v0);
    if (drivable) addSeg(roadGrid, { ax: x0, az: z0, bx: x1, bz: z1, hw: width / 2, ya: prof[i], yb: prof[i + 1] });
    mapSeg(x0, z0, x1, z1, drivable ? Math.max(width, 14) : 8, drivable ? '#a8a294' : 'rgba(150,142,120,0.4)');
  }
  if (!verts.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.computeVertexNormals();
  worldGroup.add(new THREE.Mesh(geo, mat));
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
        if (e - s >= 2) tunnelTube(dense, prof, elevMin, s, e, width, lift);
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
    for (let i = 0; i < posA.count; i++) posA.setY(i, sampleHeight(posA.getX(i), posA.getZ(i)) + lift);
    geo.computeVertexNormals();
    mesh.position.y = 0;
  }
  worldGroup.add(mesh);
  mapPoly(pts, collide === 'solid' ? 'rgba(70,66,58,0.9)' : collide === 'water' ? '#1d3a55' : 'rgba(34,54,32,0.9)');
  if (collide === 'solid') {
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
      // ya carries the ROOF height so the chase camera knows whether a wall
      // actually occludes it or it is looking clean over the top.
      const top = (mesh.position.y || 0) + extrude;
      addSeg(wallGrid, { ax, az, bx, bz, hw: 0, ya: top, yb: top });
    }
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
interface Poi { name: string; x: number; z: number; kind: 'park' | 'water' | 'place' }
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
      // Foot infrastructure renders but doesn't grip like tarmac.
      const minor = ['footway', 'path', 'cycleway', 'track'].includes(tags.highway);
      // Curb-scale lifts (was 1.6m — roads read as elevated causeways). The
      // stack keeps its z-order: green 0.2 < water 0.3 < minor 0.45 < road 0.6.
      const mode: RoadMode = minor ? 'none'
        : tags.tunnel && tags.tunnel !== 'no' ? 'tunnel'
        : tags.bridge && tags.bridge !== 'no' ? 'bridge'
        : 'auto';
      ribbon(pts, w, minor ? MAT.minor : MAT.road, minor ? 0.45 : 0.6, !minor, mode);
    } else if (tags.building) {
      const levels = parseFloat(tags['building:levels'] ?? '') || 2;
      polygon(pts, B_MATS[el.id % B_MATS.length], 0.9, clamp(levels * 3.1, 3, 90), 'solid');
    } else if (tags.natural === 'water' || tags.waterway === 'riverbank') {
      polygon(pts, MAT.water, 0.3, 0, 'water');
    } else {
      polygon(pts, MAT.green, 0.2);
      scatterVeg(pts, el.id, tags);
    }
  }
}

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

async function loadOsmTile(x: number, y: number): Promise<void> {
  const key = `${x}/${y}`;
  if (osmLoaded.has(key)) return;
  osmLoaded.add(key);
  const cached = await readTileCache(x, y);
  if (cached) { await renderGated(x, y, cached); return; }
  osmNote(1);
  if (osmInFlight >= 2) { await new Promise<void>((r) => osmQueue.push(r)); }
  osmInFlight++;
  try {
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
    const ways = ((r.elements ?? []) as Array<OsmWay & { type?: string }>).filter((e) => e.type === 'way' && e.geometry);
    writeTileCache(x, y, ways);
    await renderGated(x, y, ways);
  } catch { setTimeout(() => osmLoaded.delete(key), 8000); /* backoff, then a later pass retries */ }
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
const WHEEL_R = 0.85, WHEEL_W = 0.62, TRACK = 1.18, AXLE = 1.52;
// Local wheel anchors [x, z] — FL, FR, RL, RR (forward is -z).
const WHEELS: Array<[number, number]> = [[-TRACK, -AXLE], [TRACK, -AXLE], [-TRACK, AXLE], [TRACK, AXLE]];
const car = new THREE.Group();
car.rotation.order = 'YXZ'; // yaw first, then pitch/roll about the CAR's axes
const wheelPivots: THREE.Group[] = [];
const wheelMeshes: THREE.Mesh[] = [];
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 4.0), new THREE.MeshLambertMaterial({ color: 0xd8442e }));
  body.position.y = 0.88;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 1.8), new THREE.MeshLambertMaterial({ color: 0x20242c }));
  cabin.position.set(0, 1.5, -0.15);
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.24, 3.3), new THREE.MeshLambertMaterial({ color: 0x2a2118 }));
  chassis.position.y = 0.4; // exposed frame under the raised body
  car.add(body, cabin, chassis);
  // THE RIG. The roof array is this vehicle's identity — an overland truck
  // that carries its own power. Rack, panels, jerry cans, light bar.
  const rackMat = new THREE.MeshLambertMaterial({ color: 0x22262c, flatShading: true });
  const panelMat = new THREE.MeshLambertMaterial({ color: 0x14304e, emissive: 0x060f1c, flatShading: true });
  const cargoMat = new THREE.MeshLambertMaterial({ color: 0x6b6250, flatShading: true });
  const rack = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.07, 2.5), rackMat);
  rack.position.set(0, 1.86, -0.05);
  car.add(rack);
  for (const [px, pz] of [[-0.72, 1.05], [0.72, 1.05], [-0.72, -1.1], [0.72, -1.1]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.09), rackMat);
    post.position.set(px, 1.78, pz);
    car.add(post);
  }
  // Two panels, tilted a few degrees to catch the low sun.
  for (const pz of [-0.62, 0.52]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 1.02), panelMat);
    panel.position.set(0, 1.93, pz);
    panel.rotation.x = -0.06;
    car.add(panel);
  }
  for (const px of [-0.52, 0.52]) { // jerry cans strapped at the tail of the rack
    const can = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.22), cargoMat);
    can.position.set(px, 2.09, 1.12);
    car.add(can);
  }
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.14), rackMat);
  bar.position.set(0, 1.95, -1.28);
  car.add(bar);
  for (const px of [-0.38, 0.38]) { // spot pods on the light bar
    const pod = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.08), new THREE.MeshBasicMaterial({ color: 0xfff1cf }));
    pod.position.set(px, 1.95, -1.36);
    car.add(pod);
  }
  const tireMat = new THREE.MeshLambertMaterial({ color: 0x14171c, flatShading: true });
  const hubMat = new THREE.MeshLambertMaterial({ color: 0x8f8574, flatShading: true });
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
// ── lamps and beams ────────────────────────────────────────────────
// Front is -z. Lamps are emissive quads (they read at any distance); the
// BEAMS are additive cones that fade along their length, and one real
// spotlight throws an actual pool of light down the road. All parented to the
// car, so the beams sweep with pitch and roll over every crest.
const headMat = new THREE.MeshBasicMaterial({ color: 0xfff1cf });
const tailMat = new THREE.MeshBasicMaterial({ color: 0x8e1a12 });
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
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.1), headMat);
  lamp.position.set(sx, 1.02, -2.02);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(sx, 1.02, -2.05);
  // Aimed properly DOWN at the tarmac: a shallow beam ran level to the
  // horizon and read as two searchlights pointing at the sky over the roof.
  beam.rotation.x = -0.11;
  beam.renderOrder = 20;
  beams.push(beam);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.1), tailMat);
  tail.position.set(sx, 1.02, 2.02);
  car.add(lamp, beam, tail);
}
// One spotlight for the actual pool of light (two would double the cost of
// every lit material for a difference nobody can see). Intensity is in
// CANDELA since three r155 — the old "3.2" was a rounding error, not a lamp.
const headSpot = new THREE.SpotLight(0xfff0d0, 90, 110, 0.52, 0.65, 1.0);
headSpot.position.set(0, 1.1, -2.0);
headSpot.target.position.set(0, -1.6, -30);
car.add(headSpot, headSpot.target);
// REAL SIZE (owner: the 3.2x cartographic car straddled whole roads and made
// every speed read as a crawl). In the top chart view the car is small — the
// halo is the position marker; in chase it reads true against lane widths.
const halo = new THREE.Mesh(
  // A RING, not a disc — a filled circle drawn depth-free painted straight
  // over the truck, so the chart view showed a gold coin where the vehicle
  // should be. The ring frames it instead.
  new THREE.RingGeometry(5.2, 6.6, 32),
  // A MARKER, not scenery: no depth test, drawn late — the player's position
  // is never allowed to be swallowed by a drape or a rooftop.
  new THREE.MeshBasicMaterial({ color: 0xf5c453, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false }),
);
halo.renderOrder = 40;
halo.rotation.x = -Math.PI / 2;
halo.position.y = 0.15;
car.add(halo);
scene.add(car);
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
const wx = { sky: 'clear' as Sky, next: 'clear' as Sky, cloud: 0, rain: 0, wet: 0, at: 0, warn: 0 };
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
      // Big, billowing puffs (two thirds of the first pass — full size buried
      // the truck, metre-scale read as pinpricks).
      gl_PointSize = (7.0 + aSeed * 9.0) * (2.1 - aLife) * (175.0 / max(-mv.z, 1.0));
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
      float a = mix(soft * vLife * 0.14, smoothstep(0.25, 0.12, r) * vLife * 0.5, vKind);
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
  dustVel[i * 3 + 1] = water ? 2.2 + Math.random() * 2.6 : 1.1 + Math.random() * 1.6;
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
(window as unknown as { __probe?: object }).__probe = (x: number, z: number) =>
  ({ surface: surfaceAt(x, z), terrain: sampleHeight(x, z), road: roadHeightAt(x, z) });
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
      if (d0 > 12 && d1 > 12) zoomT = clamp(zoomT * (d0 / d1), 0.25, 12); // survey the whole fog span
    }
  }
  panPtrs.set(e.pointerId, cur);
});
addEventListener('wheel', (e) => {
  if (camMode !== 'top') return;
  zoomT = clamp(zoomT * Math.exp(e.deltaY * 0.0012), 0.25, 12);
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
  miniCtx.save();
  miniCtx.translate(0, S);
  miniCtx.scale(1, -1);
  miniCtx.drawImage(fogCanvas, sx, FOG_PX - sz - spanPx, spanPx, spanPx, 0, 0, S, S);
  miniCtx.restore();
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
const POI_COLORS: Record<Poi['kind'], string> = { park: '#7fae6a', water: '#6aa3d8', place: '#d8b46a' };
const poiVec = new THREE.Vector3(), poiView = new THREE.Vector3(), camFwd = new THREE.Vector3();
const fmtDist = (m: number): string => (m < 950 ? `${Math.round(m / 10) * 10}M` : `${(m / 1000).toFixed(1)}KM`);
function updatePois(): void {
  const near = [...pois.values()]
    .map((p) => ({ p, d: Math.hypot(p.x - state.x, p.z - state.z) }))
    .filter((e) => e.d > 25 && e.d < 3000)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);
  camera.getWorldDirection(camFwd);
  poiDraw = [];
  for (let i = 0; i < near.length; i++) {
    const { p, d } = near[i];
    const dx = p.x - state.x, dz = p.z - state.z;
    const dc = Math.min(d, 900); // beyond ~900m: pin to the horizon on its bearing
    const wx = state.x + (dx / d) * dc, wz = state.z + (dz / d) * dc;
    poiVec.set(wx, sampleHeight(wx, wz) + 2, wz);
    poiView.copy(poiVec).applyMatrix4(camera.matrixWorldInverse);
    const label = `${alienize(p.name).toUpperCase()} ${fmtDist(d)}`;
    if (poiView.z < -1) {
      poiVec.project(camera);
      if (Math.abs(poiVec.x) <= 0.92) {
        poiDraw.push({
          x: (poiVec.x * 0.5 + 0.5) * innerWidth,
          y: clamp((-poiVec.y * 0.5 + 0.5) * innerHeight, innerHeight * 0.16, innerHeight * 0.8),
          t: label, c: POI_COLORS[p.kind], edge: 0,
        });
        continue;
      }
    }
    // Off-screen: an edge chip on the side the waypoint actually lies.
    const right = camFwd.x * dz - camFwd.z * dx > 0;
    poiDraw.push({
      x: 0, y: innerHeight * (0.34 + i * 0.055),
      t: right ? `${label} >` : `< ${label}`, c: POI_COLORS[p.kind], edge: right ? 1 : -1,
    });
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
    update(speed: number, throttle: number, surf: Surface, grounded: number, rainAmt = 0): void {
      if (!ctx || !master || ctx.state !== 'running') return;
      const t = ctx.currentTime, v = Math.abs(speed);
      // Revs: rising within a gear, dropping as it "shifts" every ~14m/s.
      const gear = Math.floor(v / 14);
      const rev = (v - gear * 14) / 14;
      const f = 42 + rev * 96 + gear * 10;
      engA.frequency.setTargetAtTime(f, t, 0.07);
      engB.frequency.setTargetAtTime(f * 1.5, t, 0.07);
      engFilt.frequency.setTargetAtTime(500 + rev * 1500 + v * 22, t, 0.09);
      engGain.gain.setTargetAtTime(0.1 + Math.abs(throttle) * 0.16 * grounded + Math.min(v / 60, 0.1), t, 0.09);
      // Tarmac hisses high and thin; loose ground growls low and loud.
      const road = surf === 'road';
      roarFilt.frequency.setTargetAtTime(road ? 1150 : 320, t, 0.12);
      roarGain.gain.setTargetAtTime(Math.min(v / 34, 1) * (road ? 0.1 : 0.26) * grounded, t, 0.1);
      // Rain rides the wind channel: same filtered noise, opened up and lifted.
      windFilt.frequency.setTargetAtTime(900 - rainAmt * 500, t, 0.4);
      windGain.gain.setTargetAtTime(Math.min((v * v) / 2600, 0.9) * 0.13 + rainAmt * 0.16, t, 0.15);
      // Gravel: absent on tarmac, dominant off it. Rate (playbackRate) AND
      // level rise with speed, so the crunch density tracks the wheels.
      const loose = road ? 0 : surf === 'water' ? 0.12 : 1;
      gritSrc.playbackRate.setTargetAtTime(0.55 + Math.min(v / 26, 1.35), t, 0.12);
      gritFilt.frequency.setTargetAtTime(surf === 'water' ? 700 : 900 + Math.min(v * 26, 1400), t, 0.15);
      gritGain.gain.setTargetAtTime(Math.min(v / 12, 1) * 0.3 * loose * grounded, t, 0.09);
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
    history.replaceState(null, '', `?lat=${la.toFixed(5)}&lon=${lo.toFixed(5)}&h=${deg.toFixed(0)}${camMode === 'chase' ? '&cam=chase' : ''}`);
  } catch { /* fine */ }
};
// Surface grip: tarmac is fast, everything else asks you to slow down —
// which turns "follow the real roads" into the game. `lift` is how proud the
// drawn drape sits of the sampled field (wheels touch the visible surface);
// `rough` scales the spatial roughness field the tires ride over.
// Equilibrium speed is accel/drag, so `drag` — not `max` — is the real
// governor: off-road doubles to ~115km/h by halving drag (0.5 = 16/32).
const SURFACE = {
  road: { max: 50, drag: 0.28, lift: 0.6, rough: 0.015 },
  ground: { max: 32, drag: 0.5, lift: 0.25, rough: 0.16 }, // monster truck: off-road is its element
  water: { max: 3.5, drag: 3.5, lift: 0.3, rough: 0.05 },
} as const;
// Deterministic washboard: bumps live in the WORLD (wavelengths ~2–4m), so
// shake frequency scales with speed and each wheel rides its own profile.
function roughNoise(x: number, z: number): number {
  return Math.sin(x * 1.7 + Math.sin(z * 0.9) * 2.0) * 0.5 + Math.sin(z * 2.3 + x * 0.8) * 0.35 + Math.sin((x - z) * 3.7) * 0.15;
}
// Sprung body: damped springs for heave/pitch/roll. Downward acceleration is
// capped at gravity, so a crest taken fast LAUNCHES the truck; landings
// compress hard and bounce off the bump stops.
const SUSP = { k: 55, d: 8.5, ka: 40, da: 7.6, travel: 0.42, droop: 0.4 };
let bodyY = 0, vBodyY = 0, pitchC = 0, vPitch = 0, rollC = 0, vRoll = 0;
let wheelSpin = 0, groundedF = 1, bodyInit = false;
let steerCur = 0; // smoothed — keyboard taps ramp instead of snapping
let prevGround: number | null = null; // last frame's resolved ground (tunnel guard)
let dustBudget = 0;                   // fractional particles carried between frames
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
  state.speed -= 9.81 * Math.sin(pitchC) * grip * dt;
  // Wet ground drags and caps lower — the weather is felt through the wheels.
  const wetDrag = 1 + wx.wet * (surfKind === 'road' ? 0.35 : 0.7);
  state.speed -= state.speed * surf.drag * wetDrag * (0.1 + 0.9 * grip) * dt;
  if (brake && grip > 0.4 && Math.abs(state.speed) < 1.2) state.speed = 0;
  state.speed = clamp(state.speed, -CAR.maxRev, surf.max * (1.25 - wx.wet * 0.2)); // downhill may overrun the flat cap
  const SRATE = 7; // full-lock in ~0.14s — responsive but not snappy
  steerCur += clamp(steer - steerCur, -SRATE * dt, SRATE * dt);
  if (Math.abs(state.speed) > 0.1) {
    // Authority decays with speed (like a real wheel): full lock is a parking
    // move, a nudge at 180 — turn RATE stays sane across the whole range.
    const authority = (0.15 + 0.85 * grip) / (1 + Math.abs(state.speed) / 12);
    state.heading += (steerCur * CAR.steerMax * authority * state.speed * dt) / CAR.wheelbase;
  }
  state.x += Math.sin(state.heading) * state.speed * dt;
  state.z -= Math.cos(state.heading) * state.speed * dt;
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
  const wheelWorld: Array<[number, number]> = [];
  const wheelSurf: Surface[] = [];
  let rawSum = 0;
  for (const [wx, wz] of WHEELS) {
    const wxw = state.x + wx * cosH - wz * sinH;
    const wzw = state.z + wx * sinH + wz * cosH;
    const sk = surfaceAt(wxw, wzw);
    wheelWorld.push([wxw, wzw]);
    wheelSurf.push(sk);
    let g = sampleHeight(wxw, wzw);
    if (sk === 'road') {
      // Ride the ROAD's profile (tunnel chords included) — but only near the
      // car's current level, so the hill above a tunnel doesn't swallow us.
      const rh = roadHeightAt(wxw, wzw);
      if (rh !== null && Math.abs(rh - (prevGround ?? g)) < 4) g = rh;
    } else if (sk === 'water' && seaOn) {
      g = Math.max(g, -baseElev - 0.35); // wallow at the SURFACE, not the seabed
    }
    rawSum += g;
    const sw = SURFACE[sk];
    contacts.push(g + sw.lift + roughNoise(wxw, wzw) * sw.rough);
  }
  prevGround = rawSum / 4;
  const [cFL, cFR, cRL, cRR] = contacts;
  const ground = (cFL + cFR + cRL + cRR) / 4;
  const tY = ground + WHEEL_R; // axle-plane target
  const drive = brake ? -Math.sign(state.speed) * CAR.brake : throttle * (throttle >= 0 ? CAR.accel : CAR.brake);
  const tPitch = Math.asin(clamp((cFL + cFR - cRL - cRR) / 2 / (2 * AXLE), -0.45, 0.45))
    + clamp(drive * 0.004, -0.06, 0.06); // throttle squat / brake dive
  const tRoll = Math.asin(clamp((cFR + cRR - cFL - cRL) / 2 / (2 * TRACK), -0.45, 0.45))
    + clamp(steerCur * Math.abs(state.speed) * 0.004, -0.09, 0.09); // lean out of the corner
  if (!bodyInit) { bodyInit = true; bodyY = tY; pitchC = tPitch; rollC = tRoll; }
  let aY = SUSP.k * (tY - bodyY) - SUSP.d * vBodyY;
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
    const plane = bodyY - wz * Math.sin(pitchC) + wx * Math.sin(rollC);
    const def = clamp(contacts[i] + WHEEL_R - plane, -SUSP.droop, SUSP.travel);
    if (def > -SUSP.droop + 0.03) groundedF += 0.25;
    wheelPivots[i].position.y = def;
    wheelMeshes[i].scale.y = 1 - (0.1 * Math.max(0, def)) / SUSP.travel; // tire give under load
    wheelMeshes[i].rotation.x = wheelSpin;
    if (i < 2) wheelPivots[i].rotation.y = -steerCur * 0.42;
  }
  wheelSpin += (state.speed / WHEEL_R) * dt;
  car.position.set(state.x, bodyY, state.z);
  car.rotation.set(pitchC, -state.heading, rollC);
  // Brake lights flare; reversing washes them pale. Beams brighten with the
  // dust they have to cut through, and dim in the chart view where a pair of
  // 34m cones would just be glare on the map.
  tailMat.color.setHex(brake ? 0xff3a24 : state.speed < -0.5 ? 0xe8ded0 : 0x8e1a12);
  beamMat.uniforms.uAmp.value = camMode === 'chase' ? 1 : 0.25;
  // Dust off the loose stuff — rate follows speed, thrown back along travel.
  const v = Math.abs(state.speed);
  if (v > 3 && groundedF > 0.2) {
    const anyWater = wheelSurf.some((k) => k === 'water');
    // Wet ground raises no dust — but water itself throws plenty.
    dustBudget += v * dt * (anyWater ? 2.2 : 1.15 * (1 - wx.wet * 0.9));
    while (dustBudget >= 1) {
      dustBudget -= 1;
      // WATER throws from the FRONT wheels — that is where a bow wave comes
      // from; dry ground throws from the rears, where the drive is.
      const water = wheelSurf[0] === 'water' || wheelSurf[2] === 'water';
      const i = water ? Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 2);
      if (wheelSurf[i] === 'road') continue;
      const [wxw, wzw] = wheelWorld[i];
      const wet = wheelSurf[i] === 'water';
      emitDust(wxw, contacts[i], wzw, -sinH * v * (wet ? 0.1 : 0.28), cosH * v * (wet ? 0.1 : 0.28), wet);
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
  audio.update(state.speed, throttle, surfKind, groundedF, wx.rain);
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
  } else {
    // Framed like the reference art: close and low, the rig filling the lower
    // third with the track running to a vanishing point on the horizon.
    const back = 12.5 + Math.abs(state.speed) * 0.28;
    camPos.set(
      state.x - fwdX * back,
      // ABOVE the vehicle, always: on a steep climb the ground under the
      // camera is far below the truck, so tie the floor to the body and add
      // pitch lift to keep looking down the slope at it.
      Math.max(
        sampleHeight(state.x - fwdX * back, state.z - fwdZ * back) + 4.2,
        bodyY + 3.4 + Math.max(0, Math.sin(pitchC)) * back,
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
  else camera.lookAt(state.x + fwdX * 24, ground + 2.4, state.z + fwdZ * 24);
  camera.updateMatrixWorld();
  skyDome.position.copy(camera.position);
  ghostU.uGhostCar.value.set(state.x, ground + 1.2, state.z);
  ghostU.uGhostCam.value.copy(camera.position);
  compMat.uniforms.camPos.value.copy(camera.position);
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
      state.x - fwdX * 13,
      Math.max(sampleHeight(state.x - fwdX * 13, state.z - fwdZ * 13) + 5.4, bodyY + 4.2),
      state.z - fwdZ * 13,
    );
    miniCam.lookAt(state.x + fwdX * 18, ground + 1.6, state.z + fwdZ * 18);
    renderer.setScissorTest(true);
    renderer.setViewport(vx, vy, vw, vh);
    renderer.setScissor(vx, vy, vw, vh);
    halo.visible = false; // the zoom-scaled chart ring has no place in the POV
    renderer.render(scene, miniCam);
    halo.visible = true;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, innerWidth, innerHeight);
  }
  requestAnimationFrame(tick);
}

// Dress every palette-driven surface from one biome. Declared late so it can
// reach the sky, the composite, the lights and the sea alike.
function applyBiome(b: Biome): void {
  biome = b;
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
  (sea.material as THREE.MeshLambertMaterial).color.setRGB(shallow[0] * 2.2, shallow[1] * 2.2, shallow[2] * 2.2);
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
const B32 = '0123456789abcdefghijklmnopqrstuv';
const FW = 5, FH = 7;
function glyphRows(ch: string): string {
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS['?'];
}
/** Width in pixels of `s` at scale `sc` (1px letter spacing). */
const textW = (s: string, sc = 1): number => s.length * (FW + 1) * sc;
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
// Legibility WITHOUT a box: a one-pixel dark outline around the glyphs. Boxes
// are reserved for real instruments (things you read a value off, or press);
// labels floating over the world just get an edge.
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
// Buttons live in HUD space; taps are hit-tested against these rects.
interface Btn { x: number; y: number; w: number; h: number; label: () => string; hit: () => void; col: () => string }
const buttons: Btn[] = [];
function hudButton(b: Btn): void { buttons.push(b); }
hudButton({
  x: 0, y: 0, w: 0, h: 0, col: () => UI.gold, label: () => 'ELSEWHERE',
  hit: () => { location.href = location.pathname + '?random=1'; },
});
hudButton({
  x: 0, y: 0, w: 0, h: 0,
  col: () => (audio.on && audio.state === 'running' ? UI.good : UI.soft),
  label: () => (!audio.on ? 'SND OFF' : audio.state === 'running' ? 'SND ON' : 'SND TAP'),
  hit: () => {
    const blocked = audio.on && audio.state !== 'running';
    audio.arm();
    if (!blocked) audio.toggle();
  },
});
hudButton({ x: 0, y: 0, w: 0, h: 0, col: () => UI.soft, label: () => 'HIDE', hit: () => setClean(true) });
const CARD8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
let placeLine = '';
// POI pins, filled by updatePois and drawn in the pixel font.
interface PoiDraw { x: number; y: number; t: string; c: string; edge: 0 | -1 | 1 }
let poiDraw: PoiDraw[] = [];
let streaming = false;

function drawHud(surf: Surface, kmh: number, grip: number): void {
  hctx.clearRect(0, 0, HW, HH);
  const pad = 4;
  // ── POI pins first, so panels overlay them ──
  const btnW = textW('ELSEWHERE') + 8;
  for (const p of poiDraw) {
    const label = fit(p.t, Math.round(HW * 0.62));
    const w = textW(label) + 6;
    if (p.edge === 0) {
      const x = clamp(Math.round(p.x / hudS - w / 2), 2, HW - w - 2);
      const y = clamp(Math.round(p.y / hudS), 22, HH - 40);
      textEdge(label, x + 3, y - 11, UI.text);
      hctx.fillStyle = p.c;
      hctx.fillRect(Math.round(x + w / 2), y - 3, 1, 5);      // stem
      hctx.fillRect(Math.round(x + w / 2) - 1, y + 2, 3, 3);  // pin head
    } else {
      const y = clamp(Math.round(p.y / hudS), 20, HH - 30);
      const x = p.edge > 0 ? HW - w - 3 : 3;
      textEdge(label, x + 3, y + 2, p.c);
    }
  }
  // ── place ──
  if (placeLine) {
    const avail = HW - btnW - pad * 3;
    const shown = fit(placeLine, avail - 8);
    const w = Math.min(avail, textW(shown) + 8);
    textEdge(shown, pad + 1, pad + 3, UI.text);
    placeRect = { x: pad, y: pad, w, h: 12 }; // tap it to toggle «translation»
  }
  // ── weather ──
  {
    const w = WX[wx.sky];
    const wet = wx.wet > 0.05;
    const lab = wet && wx.rain < 0.1 ? `${w.label} WET` : w.label;
    textEdge(lab, pad + 1, pad + 15, wx.sky === 'storm' ? UI.bad : wx.rain > 0.1 ? UI.edge : UI.soft);
  }
  if (wx.warn && performance.now() < wx.warn) {
    const t2 = 'STORM APPROACHING';
    const w2 = textW(t2) + 10;
    const x2 = Math.round((HW - w2) / 2);
    textEdge(t2, x2 + 5, Math.round(HH * 0.32) + 3, UI.bad);
  }
  // ── buttons, stacked top-right ──
  let by = pad;
  for (const b of buttons) {
    b.w = textW(b.label()) + 8; b.h = 12; b.x = HW - b.w - pad; b.y = by;
    panel(b.x, b.y, b.w, b.h, b.col());
    text(hctx, b.label(), b.x + 4, b.y + 3, b.col());
    by += b.h + 3;
  }
  // ── compass ribbon ──
  const cw = Math.min(116, HW - btnW - pad * 6);
  const cx0 = Math.max(pad, Math.round((HW - btnW - pad * 2 - cw) / 2)), cy0 = pad + 30;
  hctx.fillStyle = UI.dim;                       // two hairline rails, no slab
  hctx.fillRect(cx0, cy0 + 8, cw, 1);
  hctx.fillRect(cx0, cy0 + 14, cw, 1);
  const deg = (((state.heading * 180) / Math.PI) % 360 + 360) % 360;
  const perDeg = cw / 140;
  // Walk ABSOLUTE bearings (fixed multiples of 5 degrees) and place each at its
  // offset from the heading. Walking offsets from a moving heading meant a
  // tick was "major" only when round(heading + d) happened to land on 45 — so
  // the cardinals blinked on and off instead of sliding.
  for (let b = 0; b < 360; b += 5) {
    let d = b - deg;
    if (d > 180) d -= 360; else if (d < -180) d += 360;
    if (Math.abs(d) > 70) continue;
    const x = Math.round(cx0 + cw / 2 + d * perDeg);
    if (x < cx0 + 3 || x > cx0 + cw - 3) continue;
    const major = b % 45 === 0;
    hctx.fillStyle = major ? UI.gold : UI.dim;
    hctx.fillRect(x, cy0 + (major ? 9 : 11), 1, major ? 4 : 2);
    if (major) {
      const lab = CARD8[(b / 45) % 8];
      textEdge(lab, Math.round(x - textW(lab) / 2), cy0 + 2, UI.text);
    }
  }
  hctx.fillStyle = UI.gold;
  hctx.fillRect(cx0 + cw / 2 - 1, cy0 + 1, 3, 1);
  hctx.fillRect(cx0 + cw / 2, cy0 + 1, 1, 3);
  if (streaming) textEdge('STREAMING', pad + 1, pad + 26, UI.soft);
  // ── minimap, bottom-left ──
  const mw = Math.min(58, Math.floor(HW * 0.34));
  const mx = pad, my = HH - mw - pad - 20;
  panel(mx, my, mw, mw, UI.dim);
  hctx.save();
  hctx.beginPath(); hctx.rect(mx + 1, my + 1, mw - 2, mw - 2); hctx.clip();
  hctx.drawImage(mini, mx + 1, my + 1, mw - 2, mw - 2);
  hctx.restore();
  text(hctx, 'N', mx + mw / 2 - 3, my + 2, UI.gold);
  dockRect = { x: mx, y: my, w: mw, h: mw };
  // ── surface + grip, above the map ──
  const sy = my - 26;
  panel(pad, sy, 52, 24);
  text(hctx, 'SURFACE', pad + 3, sy + 3, UI.dim);
  const sname = surf === 'road' ? 'ROAD' : surf === 'water' ? 'WATER' : 'ROUGH';
  glowText(sname, pad + 3, sy + 11, surf === 'road' ? UI.good : UI.hot);
  meter(pad + 3, sy + 19, 10, Math.round(clamp(grip, 0, 1) * 10), surf === 'road' ? UI.good : UI.hot, 3, 3, 1);
  // ── speed, bottom-right ──
  const digits = String(kmh);
  const sw = textW(digits, 2) + textW('KM/H') + 12;
  const sx = HW - sw - pad, spy = HH - 20 - pad;
  panel(sx, spy, sw, 18, UI.gold);
  glowText(digits, sx + 4, spy + 3, UI.gold, 2);
  text(hctx, 'KM/H', sx + 8 + textW(digits, 2), spy + 9, UI.edge);
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
  for (const b of buttons) {
    if (x >= b.x - 2 && x <= b.x + b.w + 2 && y >= b.y - 2 && y <= b.y + b.h + 2) { b.hit(); return true; }
  }
  const d = dockRect;
  if (x >= d.x && x <= d.x + d.w && y >= d.y && y <= d.y + d.h) { toggleCam(); return true; }
  const p = placeRect;
  if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) { toggleAlien(); return true; }
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

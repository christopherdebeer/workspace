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
const terrainPalette = (elev: number, slope: number): [number, number, number] => {
  // Sea → shore → lowland green → upland ochre → rock → snow, dimmed by slope.
  let r: number, g: number, b: number;
  if (elev <= 0.5) [r, g, b] = [0.09, 0.16, 0.24];
  else if (elev < 60) [r, g, b] = [0.16, 0.24, 0.14];
  else if (elev < 300) [r, g, b] = [0.2, 0.26, 0.15];
  else if (elev < 900) [r, g, b] = [0.29, 0.26, 0.17];
  else if (elev < 1800) [r, g, b] = [0.32, 0.29, 0.26];
  else [r, g, b] = [0.55, 0.58, 0.62];
  const shade = 1 - clamp(slope * 1.6, 0, 0.55);
  return [r * shade, g * shade, b * shade];
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
const SUN_DIR = new THREE.Vector3(0.45, 0.075, -0.8).normalize();
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: { sunDir: { value: SUN_DIR } },
  vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform vec3 sunDir; varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir);
      float az = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sunDir.x, 0.0, sunDir.z))), 0.0), 3.0);
      vec3 zen = vec3(0.010, 0.016, 0.038);
      vec3 hor = mix(vec3(0.085, 0.115, 0.16), vec3(0.50, 0.22, 0.075), az);
      vec3 col = mix(hor, zen, pow(clamp(d.y, 0.0, 1.0), 0.42));
      float sd = max(dot(d, sunDir), 0.0);
      col += vec3(1.0, 0.55, 0.22) * (smoothstep(0.9996, 0.99985, sd) * 1.4 + pow(sd, 24.0) * 0.30);
      col = mix(vec3(0.012, 0.017, 0.026), col, smoothstep(-0.06, 0.005, d.y));
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(20000, 32, 16), skyMat);
skyDome.frustumCulled = false;
skyDome.renderOrder = -10;
scene.add(skyDome);

scene.add(new THREE.HemisphereLight(0x93a6c8, 0x2c3629, 0.62));
const sun = new THREE.DirectionalLight(0xffd2a0, 1.15);
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
const mkRT = (depth: boolean): THREE.WebGLRenderTarget => {
  const rt = new THREE.WebGLRenderTarget(2, 2, { type: rtType, depthBuffer: depth });
  rt.texture.minFilter = THREE.LinearFilter;
  rt.texture.magFilter = THREE.LinearFilter;
  return rt;
};
const rtScene = mkRT(true);
rtScene.samples = 4; // the canvas's MSAA doesn't apply to render targets
// Real per-pixel depth: fog by each pixel's TRUE distance, not by where its
// screen ray meets the ground plane — otherwise a tall building far away gets
// a haze seam across it (fogged base, "sky-crisp" top).
rtScene.depthTexture = new THREE.DepthTexture(2, 2);
const rtA = mkRT(false), rtB = mkRT(false);
resizePost = () => {
  const w = Math.max(2, Math.round(innerWidth * renderer.getPixelRatio()));
  const h = Math.max(2, Math.round(innerHeight * renderer.getPixelRatio()));
  rtScene.setSize(w, h);
  rtA.setSize(w >> 1, h >> 1);
  rtB.setSize(w >> 1, h >> 1);
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
  },
  vertexShader: QUAD_VS,
  fragmentShader: `
    uniform sampler2D sceneTex; uniform sampler2D softTex; uniform sampler2D depthTex;
    uniform sampler2D mask; uniform mat4 invPV; uniform vec3 camPos; uniform float span;
    uniform vec2 sunXZ; varying vec2 vUv;
    vec3 srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c)); }
    vec3 hazeAt(vec3 d){
      // Sun-warming only for rays that travel HORIZONTALLY through air. A
      // near-vertical ray has a near-zero xz to normalize — noise blew up
      // into a starburst at the nadir and painted half the chart brown.
      float horiz = clamp(length(d.xz) * 1.6, 0.0, 1.0);
      vec2 dir2 = d.xz / max(length(d.xz), 1e-4);
      float w = pow(max(dot(dir2, sunXZ), 0.0), 3.0) * horiz * horiz;
      return mix(vec3(0.030, 0.042, 0.062), vec3(0.19, 0.11, 0.05), w);
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
        float near = 1.0 - exp(-t / 260.0);  // fast ramp: the fog-of-war wall
        // Aerial perspective scales with how much AIR the ray crosses — a
        // survey view straight down stays legible at any zoom, the horizon
        // keeps its haze. (Fog-of-war hiding is m-driven and unaffected.)
        float vFac = clamp(1.4 - abs(dir.y) * 1.3, 0.15, 1.0);
        float deep = (1.0 - exp(-t / 1400.0)) * vFac;
        float blurF = clamp(m * (0.45 + 0.55 * near) + deep * 0.55, 0.0, 1.0);
        // Never fully opaque: the unexplored world stays a SUGGESTION behind
        // the haze — you can make out a coastline or a ridge to steer toward.
        float dimF = min(m * mix(0.55, 0.86, near) + (1.0 - m) * deep * 0.55, 0.86);
        col = mix(sharp, soft, blurF);
        col = mix(col, hazeAt(dir), dimF);
      }
      gl_FragColor = vec4(srgb(col), 1.0);
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
  // A LONG feather (0.15r solid → 0 at the rim) with many overlapping stamps
  // integrates into a smooth field; the old short 0.35r ramp left each punch
  // legible as its own disc, which read as the fog clearing in patches.
  grad.addColorStop(0, 'rgba(0,0,0,0.85)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.35)');
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
const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
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
ghostify(MAT.tunnel);
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
      const buried = elev[i] - prof[i] > 1.2;
      if (buried && s < 0) s = i;
      if ((!buried || i === b) && s >= 0) {
        const e = buried ? i : i - 1;
        if (e - s >= 2) tunnelTube(dense, prof, s, e, width, lift);
        s = -1;
      }
    }
  }
}
// The carved space: side walls + ceiling along a tunnel run, portal lintels at
// the mouths, and solid collision so the car can't drive out through the rock.
function tunnelTube(dense: Array<[number, number]>, prof: number[], a: number, b: number, width: number, lift: number): void {
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
    quadPush(x0 + nx, yA, z0 + nz, x1 + nx, yB, z1 + nz, x0 + nx, yA + TUNNEL_H, z0 + nz, x1 + nx, yB + TUNNEL_H, z1 + nz);
    quadPush(x0 - nx, yA, z0 - nz, x1 - nx, yB, z1 - nz, x0 - nx, yA + TUNNEL_H, z0 - nz, x1 - nx, yB + TUNNEL_H, z1 - nz);
    quadPush(x0 + nx, yA + TUNNEL_H, z0 + nz, x1 + nx, yB + TUNNEL_H, z1 + nz, x0 - nx, yA + TUNNEL_H, z0 - nz, x1 - nx, yB + TUNNEL_H, z1 - nz);
    const top = Math.max(yA, yB) + TUNNEL_H;
    addSeg(wallGrid, { ax: x0 + nx, az: z0 + nz, bx: x1 + nx, bz: z1 + nz, hw: 0, ya: top, yb: top });
    addSeg(wallGrid, { ax: x0 - nx, az: z0 - nz, bx: x1 - nx, bz: z1 - nz, hw: 0, ya: top, yb: top });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tv), 3));
  geo.computeVertexNormals();
  worldGroup.add(new THREE.Mesh(geo, MAT.tunnel));
  for (const end of [a, b]) {
    const i0 = end === a ? a : b - 1, i1 = end === a ? a + 1 : b;
    const [x0, z0] = dense[i0], [x1, z1] = dense[i1];
    const ang = Math.atan2(z1 - z0, x1 - x0);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(width + 3, 1.6, 1.2), MAT.portal);
    const [px, pz] = dense[end];
    lintel.position.set(px, prof[end] + lift + TUNNEL_H + 0.3, pz);
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
const osmStatus = document.createElement('div');
osmStatus.textContent = '🛰 streaming roads…';
Object.assign(osmStatus.style, {
  position: 'fixed', left: '12px', top: 'calc(max(10px, env(safe-area-inset-top)) + 44px)', zIndex: '10',
  color: 'rgba(245,196,83,0.85)', font: '0.68rem ui-monospace, monospace',
  textShadow: '0 1px 4px rgba(0,0,0,0.8)', pointerEvents: 'none', display: 'none',
} as Partial<CSSStyleDeclaration>);
document.body.appendChild(osmStatus);
let osmPending = 0;
const osmNote = (d: number): void => { osmPending += d; osmStatus.style.display = osmPending > 0 ? 'block' : 'none'; };

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
// ── dust: what the tires throw up off-road ─────────────────────────
// A world-space particle pool (no per-frame allocation). Emitted at the rear
// contacts when the wheels are on loose ground, drifting up and back before
// settling — the visual proof that the surface under you changed.
const DUST_N = 220;
const dustPos = new Float32Array(DUST_N * 3);
const dustVel = new Float32Array(DUST_N * 3);
const dustLife = new Float32Array(DUST_N);   // 1 → 0
const dustSeed = new Float32Array(DUST_N);   // size jitter
let dustHead = 0;
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
dustGeo.setAttribute('aLife', new THREE.BufferAttribute(dustLife, 1));
dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dustSeed, 1));
dustGeo.frustumCulled = false;
const dustPoints = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: { uColor: { value: new THREE.Color(0x9a8f76) } },
  vertexShader: `
    attribute float aLife; attribute float aSeed; varying float vLife;
    void main(){
      vLife = aLife;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      // Metre-scale puffs that billow as they age (the 260 constant made each
      // particle a 300px blob — the truck vanished inside its own dust).
      gl_PointSize = (3.2 + aSeed * 3.4) * (1.9 - aLife) * (95.0 / max(-mv.z, 1.0));
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uColor; varying float vLife;
    void main(){
      vec2 d = gl_PointCoord - 0.5;
      float r = dot(d, d);
      if (r > 0.25) discard;                       // round puff
      float soft = smoothstep(0.25, 0.02, r);
      gl_FragColor = vec4(uColor, soft * vLife * 0.14); // haze, not smoke screen
    }`,
}));
dustPoints.frustumCulled = false;
dustPoints.renderOrder = 30;
scene.add(dustPoints);
function emitDust(x: number, y: number, z: number, vx: number, vz: number): void {
  const i = dustHead = (dustHead + 1) % DUST_N;
  dustPos[i * 3] = x + (Math.random() - 0.5) * 0.8;
  dustPos[i * 3 + 1] = y + 0.15;
  dustPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.8;
  dustVel[i * 3] = vx + (Math.random() - 0.5) * 2.2;
  dustVel[i * 3 + 1] = 1.1 + Math.random() * 1.6;
  dustVel[i * 3 + 2] = vz + (Math.random() - 0.5) * 2.2;
  dustLife[i] = 1;
  dustSeed[i] = Math.random();
}
function stepDust(dt: number): void {
  let any = false;
  for (let i = 0; i < DUST_N; i++) {
    if (dustLife[i] <= 0) continue;
    any = true;
    dustLife[i] = Math.max(0, dustLife[i] - dt * 1.05);
    const k = Math.exp(-1.8 * dt); // air drag settles the plume
    dustVel[i * 3] *= k;
    dustVel[i * 3 + 2] *= k;
    dustVel[i * 3 + 1] = dustVel[i * 3 + 1] * k - 0.9 * dt;
    dustPos[i * 3] += dustVel[i * 3] * dt;
    dustPos[i * 3 + 1] += dustVel[i * 3 + 1] * dt;
    dustPos[i * 3 + 2] += dustVel[i * 3 + 2] * dt;
  }
  if (any) {
    (dustGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (dustGeo.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    (dustGeo.attributes.aSeed as THREE.BufferAttribute).needsUpdate = true;
  }
}

const state = { x: 0, z: 0, heading: 0, speed: 0 };
(window as unknown as { __drive?: object; __surfaceAt?: (x: number, z: number) => string }).__drive = state;
(window as unknown as { __surfaceAt?: (x: number, z: number) => string }).__surfaceAt = surfaceAt; // debug/test handles (read-only use)
(window as unknown as { __probe?: object }).__probe = (x: number, z: number) =>
  ({ surface: surfaceAt(x, z), terrain: sampleHeight(x, z), road: roadHeightAt(x, z) });
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
const mapDock = document.createElement('div');
Object.assign(mapDock.style, {
  position: 'fixed', left: '12px', bottom: 'max(44px, calc(env(safe-area-inset-bottom) + 34px))',
  width: `${MINI}px`, height: `${MINI}px`, zIndex: '10', cursor: 'pointer',
  border: '1px solid rgba(245,196,83,0.35)', borderRadius: '10px', overflow: 'hidden',
} as Partial<CSSStyleDeclaration>);
document.body.appendChild(mapDock);
mapDock.addEventListener('click', () => toggleCam());
const mini = document.createElement('canvas');
mini.width = mini.height = MINI * 2;
Object.assign(mini.style, {
  position: 'absolute', inset: '0', width: '100%', height: '100%',
  background: 'rgba(4,6,11,0.9)', pointerEvents: 'none',
} as Partial<CSSStyleDeclaration>);
mapDock.appendChild(mini);
function updateDock(): void {
  mini.style.visibility = camMode === 'top' ? 'hidden' : 'visible'; // hidden ⇒ the GL POV preview shows through
}
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
const renderPlace = (): void => { $('place-name').textContent = alienize(placeLabel); };
{
  const placeHud = $('place');
  placeHud.style.pointerEvents = 'auto';
  placeHud.style.cursor = 'pointer';
  placeHud.title = 'toggle translation';
  placeHud.addEventListener('click', () => {
    alien = !alien;
    try { localStorage.setItem('drive.alien', alien ? '1' : '0'); } catch { /* fine */ }
    renderPlace();
  });
}

// ── POI HUD: bearing labels to nearby named places ─────────────────
// Named parks/waters/buildings from the OSM stream become waypoints. On
// screen they sit at their world position (far ones pinned to the horizon
// along their bearing, not to a ground point buried in haze); off screen
// they clamp to the side edge with an arrow.
const poiWrap = document.createElement('div');
Object.assign(poiWrap.style, { position: 'fixed', inset: '0', zIndex: '9', pointerEvents: 'none', overflow: 'hidden' } as Partial<CSSStyleDeclaration>);
document.body.appendChild(poiWrap);
const POI_COLORS: Record<Poi['kind'], string> = { park: '#7fae6a', water: '#6aa3d8', place: '#d8b46a' };
// On-screen POIs are MAP PINS: label over a stem over a dot, the dot sitting
// exactly on the world point. Off-screen ones collapse to edge arrows.
const poiEls = Array.from({ length: 5 }, () => {
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    // Positioned ENTIRELY via translate3d each frame — left/top writes forced
    // layout and, updated on a 150ms throttle, made the pins judder against
    // the 60fps camera. Compositor-only motion, every frame, stays glued.
    position: 'absolute', left: '0', top: '0', display: 'none', flexDirection: 'column', alignItems: 'center',
    willChange: 'transform',
  } as Partial<CSSStyleDeclaration>);
  const label = document.createElement('div');
  Object.assign(label.style, {
    font: '0.6rem ui-monospace, monospace', color: '#efe9dc', whiteSpace: 'nowrap',
    background: 'rgba(8,12,20,0.55)', padding: '2px 7px', borderRadius: '7px',
    border: '1px solid rgba(239,233,220,0.16)', textShadow: '0 1px 3px rgba(0,0,0,0.9)',
    maxWidth: '46vw', overflow: 'hidden', textOverflow: 'ellipsis',
  } as Partial<CSSStyleDeclaration>);
  const stem = document.createElement('div');
  Object.assign(stem.style, {
    width: '1.5px', height: '15px',
    background: 'linear-gradient(rgba(239,233,220,0.75), rgba(239,233,220,0.1))',
  } as Partial<CSSStyleDeclaration>);
  const dot = document.createElement('div');
  Object.assign(dot.style, {
    width: '7px', height: '7px', borderRadius: '50%', marginTop: '-1px',
    boxShadow: '0 1px 5px rgba(0,0,0,0.8)',
  } as Partial<CSSStyleDeclaration>);
  wrap.append(label, stem, dot);
  poiWrap.appendChild(wrap);
  return { wrap, label, stem, dot, text: '' };
});
const poiVec = new THREE.Vector3(), poiView = new THREE.Vector3(), camFwd = new THREE.Vector3();
const fmtDist = (m: number): string => (m < 950 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`);
function updatePois(): void {
  const near = [...pois.values()]
    .map((p) => ({ p, d: Math.hypot(p.x - state.x, p.z - state.z) }))
    .filter((e) => e.d > 25 && e.d < 3000)
    .sort((a, b) => a.d - b.d)
    .slice(0, poiEls.length);
  camera.getWorldDirection(camFwd);
  for (let i = 0; i < poiEls.length; i++) {
    const el = poiEls[i];
    const e = near[i];
    if (!e) { el.wrap.style.display = 'none'; continue; }
    const { p, d } = e;
    const dx = p.x - state.x, dz = p.z - state.z;
    const dc = Math.min(d, 900); // beyond ~900m: pin to the horizon on its bearing
    const wx = state.x + (dx / d) * dc, wz = state.z + (dz / d) * dc;
    poiVec.set(wx, sampleHeight(wx, wz) + 2, wz);
    poiView.copy(poiVec).applyMatrix4(camera.matrixWorldInverse);
    el.wrap.style.display = 'flex';
    el.dot.style.background = POI_COLORS[p.kind];
    const setText = (t: string): void => { if (el.text !== t) { el.text = t; el.label.textContent = t; } };
    if (poiView.z < -1) {
      poiVec.project(camera);
      if (Math.abs(poiVec.x) <= 0.94) {
        // MAP PIN: the dot sits on the spot, the label floats off it.
        setText(`${alienize(p.name)} · ${fmtDist(d)}`);
        el.stem.style.display = el.dot.style.display = 'block';
        const px = (poiVec.x * 0.5 + 0.5) * innerWidth;
        const py = clamp((-poiVec.y * 0.5 + 0.5) * innerHeight, innerHeight * 0.14, innerHeight * 0.82);
        el.wrap.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -100%)`;
        continue;
      }
    }
    // Off-screen: side chip with an arrow, stacked by proximity rank.
    el.stem.style.display = el.dot.style.display = 'none';
    const py = innerHeight * (0.28 + i * 0.055);
    if (camFwd.x * dz - camFwd.z * dx > 0) {
      setText(`${alienize(p.name)} · ${fmtDist(d)} ▶`);
      el.wrap.style.transform = `translate3d(${innerWidth - 8}px, ${py.toFixed(1)}px, 0) translateX(-100%)`;
    } else {
      setText(`◀ ${alienize(p.name)} · ${fmtDist(d)}`);
      el.wrap.style.transform = `translate3d(8px, ${py.toFixed(1)}px, 0)`;
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
    // Wind: highpassed noise that climbs with the square of speed.
    const windSrc = ctx.createBufferSource(); windSrc.buffer = noiseBuf; windSrc.loop = true;
    windFilt = ctx.createBiquadFilter(); windFilt.type = 'highpass'; windFilt.frequency.value = 900;
    windGain = ctx.createGain(); windGain.gain.value = 0;
    windSrc.connect(windFilt); windFilt.connect(windGain); windGain.connect(master); windSrc.start();
  };
  const arm = (): void => {
    if (!ctx) build();
    if (ctx?.state === 'suspended') void ctx.resume();
  };
  return {
    arm,
    get on(): boolean { return on; },
    toggle(): boolean {
      on = !on;
      try { localStorage.setItem('drive.mute', on ? '0' : '1'); } catch { /* fine */ }
      if (on) arm();
      if (master && ctx) master.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.05);
      return on;
    },
    // Called every frame; all parameters glide so nothing zippers.
    update(speed: number, throttle: number, surf: Surface, grounded: number): void {
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
      roarGain.gain.setTargetAtTime(Math.min(v / 34, 1) * (road ? 0.1 : 0.3) * grounded, t, 0.1);
      windGain.gain.setTargetAtTime(Math.min((v * v) / 2600, 0.9) * 0.13, t, 0.15);
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
const sndBtn = document.createElement('button');
sndBtn.textContent = audio.on ? '♪ on' : '♪ off';
Object.assign(sndBtn.style, {
  position: 'fixed', right: '12px', top: 'calc(max(10px, env(safe-area-inset-top)) + 40px)', zIndex: '11',
  background: 'rgba(8,12,20,0.55)', color: '#f5c453', border: '1px solid rgba(245,196,83,0.4)',
  borderRadius: '8px', padding: '0.35rem 0.7rem', font: 'inherit', fontSize: '0.74rem', cursor: 'pointer',
} as Partial<CSSStyleDeclaration>);
document.body.appendChild(sndBtn);
sndBtn.addEventListener('click', () => { sndBtn.textContent = audio.toggle() ? '♪ on' : '♪ off'; });
// Any first gesture arms the context (autoplay policy).
canvas.addEventListener('pointerdown', () => audio.arm(), { once: false });
addEventListener('keydown', () => audio.arm());

// ── main loop ──────────────────────────────────────────────────────
const speedEl = $('speed');
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
  state.speed -= state.speed * surf.drag * (0.1 + 0.9 * grip) * dt;
  if (brake && grip > 0.4 && Math.abs(state.speed) < 1.2) state.speed = 0;
  state.speed = clamp(state.speed, -CAR.maxRev, surf.max * 1.25); // downhill may overrun the flat cap
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
  // Dust off the loose stuff — rate follows speed, thrown back along travel.
  const v = Math.abs(state.speed);
  if (v > 3 && groundedF > 0.2) {
    dustBudget += v * dt * 1.1;
    while (dustBudget >= 1) {
      dustBudget -= 1;
      const i = 2 + Math.floor(Math.random() * 2); // rear wheels
      if (wheelSurf[i] === 'road') continue;
      const [wxw, wzw] = wheelWorld[i];
      emitDust(wxw, contacts[i], wzw, -sinH * v * 0.28, cosH * v * 0.28);
    }
  } else dustBudget = 0;
  stepDust(dt);
  audio.update(state.speed, throttle, surfKind, groundedF);
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
    const back = 13 + Math.abs(state.speed) * 0.35;
    camPos.set(
      state.x - fwdX * back,
      // ABOVE the vehicle, always: on a steep climb the ground under the
      // camera is far below the truck, so tie the floor to the body and add
      // pitch lift to keep looking down the slope at it.
      Math.max(
        sampleHeight(state.x - fwdX * back, state.z - fwdZ * back) + 5.4,
        bodyY + 4.2 + Math.max(0, Math.sin(pitchC)) * back,
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
  else camera.lookAt(state.x + fwdX * 18, ground + 1.6, state.z + fwdZ * 18);
  camera.updateMatrixWorld();
  skyDome.position.copy(camera.position);
  ghostU.uGhostCar.value.set(state.x, ground + 1.2, state.z);
  ghostU.uGhostCam.value.copy(camera.position);
  compMat.uniforms.camPos.value.copy(camera.position);
  compMat.uniforms.invPV.value.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse).invert();
  speedEl.innerHTML = `${Math.round(Math.abs(state.speed) * 3.6)}<small> km/h</small>`;
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
  compMat.uniforms.sceneTex.value = rtScene.texture;
  compMat.uniforms.softTex.value = rtB.texture;
  runPass(compMat, null);
  if (camMode === 'top') {
    // The dock's POV preview: raw scene from the chase rig, scissored into
    // the corner over the composite (autoClear respects the scissor).
    const r = mapDock.getBoundingClientRect();
    const vx = r.left, vy = innerHeight - r.bottom, vw = r.width, vh = r.height;
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

// ── boot ───────────────────────────────────────────────────────────
$('reroll').addEventListener('click', () => { location.href = location.pathname + '?random=1'; });
(async () => {
  const spawn = await findSpawn();
  origin = { lat: spawn.lat, lon: spawn.lon, mLon: M_LAT * Math.cos((spawn.lat * Math.PI) / 180) };
  $('place-coords').textContent = `${spawn.lat.toFixed(4)}, ${spawn.lon.toFixed(4)}`;
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
  bootMsg('laying down the roads…');
  // The spawn tile must be IN the height field before the first frame — the
  // car, drapes, and camera all read it; starting on y=0 then popping up a
  // second later read as "stuck in the terrain".
  await loadTerrainTile(tx, ty);
  streamWorld(0, 0);
  reveal(0, 0);
  $('boot').classList.add('done');
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick); });
})();

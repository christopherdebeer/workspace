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
const TERRAIN_Z = 13;         // terrarium tile zoom (~4.9km/cos(lat) per tile)
const OSM_Z = 16;             // overpass tile zoom (~600m — keeps per-query weight low)
const OSM_RING = 1;           // load a (2R+1)² neighbourhood of vector tiles
const TERRAIN_RING = 1;
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
interface HeightTile { xs: number; zs: number; w: number; h: number; data: Float32Array }
const heightTiles = new Map<string, HeightTile>();
let baseElev = 0;
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
    const u = ((ex - t.xs) / t.w) * 255, v = ((ez - t.zs) / t.h) * 255;
    const x0 = Math.floor(u), z0 = Math.floor(v), fx = u - x0, fz = v - z0;
    const x1 = Math.min(255, x0 + 1), z1 = Math.min(255, z0 + 1);
    const g = (xx: number, zz: number) => t.data[zz * 256 + xx];
    return (g(x0, z0) * (1 - fx) + g(x1, z0) * fx) * (1 - fz) + (g(x0, z1) * (1 - fx) + g(x1, z1) * fx) * fz - baseElev;
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
scene.add(new THREE.AmbientLight(0xbfd0e8, 0.55));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.0);
sun.position.set(-600, 900, -400);
scene.add(sun);

const worldGroup = new THREE.Group();
scene.add(worldGroup);

function resize(): void {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
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
// SCREEN-SPACE fog pass. The old 3D fog plane sat ~50m under the camera, so
// the screen sampled a tiny, hugely magnified window of the mask — the "fog"
// was a blurry blob that lagged the reveal throttle (dark while driving,
// clearing when you stopped). This fullscreen pass reconstructs each pixel's
// GROUND point through the camera and samples the mask exactly — the fog is
// pinned to the world at any zoom, speed, or tilt.
const fogMat = new THREE.ShaderMaterial({
  transparent: true,
  depthTest: false,
  depthWrite: false,
  uniforms: {
    mask: { value: fogTex },
    invPV: { value: new THREE.Matrix4() },
    camPos: { value: new THREE.Vector3() },
    groundY: { value: 0 },
    span: { value: FOG_SPAN },
  },
  vertexShader: 'varying vec2 vNdc; void main(){ vNdc = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D mask; uniform mat4 invPV; uniform vec3 camPos;
    uniform float groundY; uniform float span; varying vec2 vNdc;
    void main(){
      vec4 far = invPV * vec4(vNdc, 1.0, 1.0);
      vec3 dir = normalize(far.xyz / far.w - camPos);
      float t = (groundY - camPos.y) / min(dir.y, -1e-4);
      vec3 wp = camPos + dir * t;
      vec2 uv = (wp.xz + span * 0.5) / span;
      float a = (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) ? 0.985 : texture2D(mask, uv).a;
      gl_FragColor = vec4(0.016, 0.024, 0.043, a);
    }`,
});
const fogPass = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fogMat);
fogPass.frustumCulled = false;
fogPass.renderOrder = 100;
scene.add(fogPass);
let lastRevealX = Infinity, lastRevealZ = Infinity;
function reveal(ex: number, ez: number): void {
  if (Math.hypot(ex - lastRevealX, ez - lastRevealZ) < REVEAL_M * 0.18) return;
  lastRevealX = ex; lastRevealZ = ez;
  const px = ((ex + FOG_SPAN / 2) / FOG_SPAN) * FOG_PX;
  // flipY: CanvasTexture uploads row 0 at v=1, so +z (v up) writes low rows.
  const pz = FOG_PX - ((ez + FOG_SPAN / 2) / FOG_SPAN) * FOG_PX;
  const pr = (REVEAL_M / FOG_SPAN) * FOG_PX;
  const grad = fogCtx.createRadialGradient(px, pz, pr * 0.35, px, pz, pr);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  fogCtx.globalCompositeOperation = 'destination-out';
  fogCtx.fillStyle = grad;
  fogCtx.beginPath();
  fogCtx.arc(px, pz, pr, 0, Math.PI * 2);
  fogCtx.fill();
  fogCtx.globalCompositeOperation = 'source-over';
  fogTex.needsUpdate = true;
}

// ── terrain meshes ─────────────────────────────────────────────────
const terrainLoaded = new Set<string>();
async function loadTerrainTile(x: number, y: number): Promise<void> {
  const key = `${x}/${y}`;
  if (terrainLoaded.has(key)) return;
  terrainLoaded.add(key);
  const data = await fetchHeights(x, y);
  if (!data) return;
  const b = tileBounds(x, y, TERRAIN_Z);
  const [wx0, wz0] = toLocal(b.latN, b.lonW);
  const [wx1, wz1] = toLocal(b.latS, b.lonE);
  heightTiles.set(key, { xs: Math.min(wx0, wx1), zs: Math.min(wz0, wz1), w: Math.abs(wx1 - wx0), h: Math.abs(wz1 - wz0), data });
  const SEG = 96;
  const geo = new THREE.PlaneGeometry(Math.abs(wx1 - wx0), Math.abs(wz1 - wz0), SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const cxm = (wx0 + wx1) / 2, czm = (wz0 + wz1) / 2;
  const cell = Math.abs(wx1 - wx0) / SEG;
  for (let i = 0; i < pos.count; i++) {
    const ex = pos.getX(i) + cxm, ez = pos.getZ(i) + czm;
    // The SAME bilinear field the roads/buildings/car sample (sampleHeight) —
    // a nearest-pixel mesh disagreed with it by metres and swallowed every
    // draped layer under the terrain skin.
    const elev = sampleHeight(ex, ez);
    const elevAbs = elev + baseElev;
    pos.setY(i, elev);
    const u = clamp(Math.round(((ex - Math.min(wx0, wx1)) / Math.abs(wx1 - wx0)) * 255), 0, 255);
    const v = clamp(Math.round(((ez - Math.min(wz0, wz1)) / Math.abs(wz1 - wz0)) * 255), 0, 255);
    const du = data[v * 256 + Math.min(255, u + 1)] - data[v * 256 + u];
    const dv = data[Math.min(255, v + 1) * 256 + u] - data[v * 256 + u];
    const [r, g, bb] = terrainPalette(elevAbs, Math.hypot(du, dv) / Math.max(cell, 1));
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = bb;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.position.set(cxm, 0, czm);
  worldGroup.add(mesh);
}

// ── OSM vectors ────────────────────────────────────────────────────
const osmLoaded = new Set<string>();
const seenWays = new Set<number>();
let osmInFlight = 0;
const osmQueue: Array<() => void> = [];
const ROAD_W: Record<string, number> = { motorway: 9, trunk: 8, primary: 7.5, secondary: 6.5, tertiary: 6, residential: 5, unclassified: 5, service: 3.2, living_street: 4.5, track: 2.8, footway: 2.2, path: 2.0, cycleway: 2.4, pedestrian: 4 };
// ── procedural detail textures ─────────────────────────────────────
// Known details render as TEXTURE, not just flat colour: lane markings on the
// asphalt, grain on the terrain, ripple on water, stipple foliage, roof grain.
// All generated once on a small canvas — zero downloads, tinted by the same
// Lambert lighting as everything else.
function canvasTex(size: number, repeatX: number, repeatY: number, draw: (c: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  return t;
}
function speckle(c: CanvasRenderingContext2D, s: number, colors: string[], n: number, r = 1.6): void {
  for (let i = 0; i < n; i++) {
    c.fillStyle = colors[i % colors.length];
    c.fillRect(Math.random() * s, Math.random() * s, r + Math.random() * r, r + Math.random() * r);
  }
}
// Road: u spans the width, v runs 20m per wrap — centre dash ≈ 8m on / 12m off,
// solid pale edge lines. Drawn horizontal-major then used vertically via UVs.
const roadTex = canvasTex(128, 1, 1, (c, s) => {
  c.fillStyle = '#3a3f46'; c.fillRect(0, 0, s, s);
  speckle(c, s, ['rgba(255,255,255,0.045)', 'rgba(0,0,0,0.12)'], 260);
  c.fillStyle = 'rgba(226,220,203,0.5)';
  c.fillRect(5, 0, 3, s); c.fillRect(s - 8, 0, 3, s);      // edge lines
  c.fillStyle = 'rgba(232,226,208,0.75)';
  c.fillRect(s / 2 - 2, 0, 4, Math.round(s * 0.4));        // centre dash
});
const pathTex = canvasTex(64, 1, 1, (c, s) => {
  c.fillStyle = '#847d6c'; c.fillRect(0, 0, s, s);
  speckle(c, s, ['rgba(60,54,40,0.35)', 'rgba(255,250,235,0.12)'], 90);
});
const grainTex = canvasTex(256, 200, 200, (c, s) => {
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s);
  speckle(c, s, ['rgba(0,0,0,0.10)', 'rgba(0,0,0,0.05)', 'rgba(255,255,255,0.06)'], 900);
});
// Shape/roof UVs are world metres (ShapeGeometry copies XY into UV) — repeat
// scales metres→tiles.
const waterTex = canvasTex(128, 1 / 26, 1 / 26, (c, s) => {
  c.fillStyle = '#1d3a55'; c.fillRect(0, 0, s, s);
  c.strokeStyle = 'rgba(126,168,204,0.14)'; c.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    c.beginPath();
    const y = Math.random() * s;
    c.moveTo(0, y); c.bezierCurveTo(s / 3, y - 6, (2 * s) / 3, y + 6, s, y);
    c.stroke();
  }
});
const greenTex = canvasTex(128, 1 / 20, 1 / 20, (c, s) => {
  c.fillStyle = '#1c3320'; c.fillRect(0, 0, s, s);
  speckle(c, s, ['rgba(10,24,12,0.5)', 'rgba(58,96,52,0.28)'], 240, 2.6);
});
const roofTex = canvasTex(128, 1 / 10, 1 / 10, (c, s) => {
  c.fillStyle = '#ffffff'; c.fillRect(0, 0, s, s);
  speckle(c, s, ['rgba(0,0,0,0.10)', 'rgba(0,0,0,0.05)'], 300);
});
// DoubleSide throughout: ribbon winding and the rotate+mirror extrusion leave
// face orientation mixed — lighting both sides costs little at this scene size
// and makes every surface reliably visible from the top-down camera.
const DS = THREE.DoubleSide;
const MAT = {
  road: new THREE.MeshLambertMaterial({ map: roadTex, side: DS }),
  minor: new THREE.MeshLambertMaterial({ map: pathTex, transparent: true, opacity: 0.85, side: DS }),
  water: new THREE.MeshLambertMaterial({ map: waterTex, side: DS }),
  green: new THREE.MeshLambertMaterial({ map: greenTex, side: DS }),
};
// Building tints vary per way id so a block reads as parcels, not one slab.
// Extrude material slots: [0]=caps (roof), [1]=side walls (darker).
const B_MATS = [0xa59a85, 0x92897a, 0x9d937f, 0x878071].map((c) => {
  const side = new THREE.Color(c).multiplyScalar(0.72);
  return [
    new THREE.MeshLambertMaterial({ color: c, map: roofTex, side: DS }),
    new THREE.MeshLambertMaterial({ color: side, side: DS }),
  ] as [THREE.Material, THREE.Material];
});
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
interface Seg { ax: number; az: number; bx: number; bz: number; hw: number }
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
type Surface = 'road' | 'water' | 'ground';
function surfaceAt(x: number, z: number): Surface {
  for (const seg of roadGrid.get(gkey(x, z)) ?? []) {
    const [cx, cz] = closestOnSeg(x, z, seg);
    if (Math.hypot(x - cx, z - cz) <= seg.hw + 0.8) return 'road';
  }
  return waterCells.has(gkey(x, z)) ? 'water' : 'ground';
}

function ribbon(pts: Array<[number, number]>, width: number, mat: THREE.Material, lift: number, drivable = false): void {
  const verts: number[] = [];
  const uvs: number[] = [];
  let along = 0; // metres travelled — v wraps every 20m (the roadTex period)
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * width / 2, nz = (dx / len) * width / 2;
    const y00 = sampleHeight(x0 + nx, z0 + nz) + lift, y01 = sampleHeight(x0 - nx, z0 - nz) + lift;
    const y10 = sampleHeight(x1 + nx, z1 + nz) + lift, y11 = sampleHeight(x1 - nx, z1 - nz) + lift;
    const v0 = along / 20, v1 = (along + len) / 20;
    along += len;
    verts.push(
      x0 + nx, y00, z0 + nz, x1 + nx, y10, z1 + nz, x0 - nx, y01, z0 - nz,
      x1 + nx, y10, z1 + nz, x1 - nx, y11, z1 - nz, x0 - nx, y01, z0 - nz,
    );
    uvs.push(0, v0, 0, v1, 1, v0, 0, v1, 1, v1, 1, v0);
    if (drivable) addSeg(roadGrid, { ax: x0, az: z0, bx: x1, bz: z1, hw: width / 2 });
    mapSeg(x0, z0, x1, z1, drivable ? Math.max(width, 14) : 8, drivable ? '#a8a294' : 'rgba(150,142,120,0.4)');
  }
  if (!verts.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.computeVertexNormals();
  worldGroup.add(new THREE.Mesh(geo, mat));
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
      addSeg(wallGrid, { ax, az, bx, bz, hw: 0 });
    }
  } else if (collide === 'water') {
    let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
    for (const [x, z] of pts) { minx = Math.min(minx, x); minz = Math.min(minz, z); maxx = Math.max(maxx, x); maxz = Math.max(maxz, z); }
    for (let gx = Math.floor(minx / GRID); gx <= Math.floor(maxx / GRID); gx++)
      for (let gz = Math.floor(minz / GRID); gz <= Math.floor(maxz / GRID); gz++)
        if (pointInPoly(gx * GRID + GRID / 2, gz * GRID + GRID / 2, pts)) waterCells.add(`${gx},${gz}`);
  }
}
// ── OSM tile cache (localStorage, LRU) ─────────────────────────────
// Overpass is a shared public instance with moods; a tile you have seen once
// should never depend on it again. Slimmed way geometry per tile, ~50-tile
// LRU — the Central Park default becomes instant and offline-proof on the
// second visit.
interface OsmWay { id: number; tags?: Record<string, string>; geometry: Array<{ lat: number; lon: number }> }
const OSM_CACHE_V = 1;
const osmCacheKey = (x: number, y: number): string => `drive.osm.${OSM_CACHE_V}.${OSM_Z}.${x}.${y}`;
function readTileCache(x: number, y: number): OsmWay[] | null {
  try {
    const raw = localStorage.getItem(osmCacheKey(x, y));
    return raw ? (JSON.parse(raw) as OsmWay[]) : null;
  } catch { return null; }
}
function writeTileCache(x: number, y: number, els: OsmWay[]): void {
  const k = osmCacheKey(x, y);
  const slim = JSON.stringify(els.map((e) => ({ id: e.id, tags: e.tags, geometry: e.geometry })));
  const put = (): void => {
    localStorage.setItem(k, slim);
    const idx: string[] = JSON.parse(localStorage.getItem('drive.osm.idx') ?? '[]').filter((v: string) => v !== k);
    idx.push(k);
    while (idx.length > 50) localStorage.removeItem(idx.shift()!);
    localStorage.setItem('drive.osm.idx', JSON.stringify(idx));
  };
  try { put(); } catch {
    // Quota: evict the oldest half and try once more.
    try {
      const idx: string[] = JSON.parse(localStorage.getItem('drive.osm.idx') ?? '[]');
      idx.splice(0, Math.ceil(idx.length / 2)).forEach((old) => localStorage.removeItem(old));
      localStorage.setItem('drive.osm.idx', JSON.stringify(idx));
      put();
    } catch { /* give up gracefully */ }
  }
}

function renderWays(els: OsmWay[]): void {
  for (const el of els) {
    if (!el.geometry || seenWays.has(el.id)) continue;
    seenWays.add(el.id);
    const pts: Array<[number, number]> = el.geometry.map((g) => toLocal(g.lat, g.lon));
    const tags = el.tags ?? {};
    if (tags.highway) {
      const w = ROAD_W[tags.highway] ?? 4;
      // Foot infrastructure renders but doesn't grip like tarmac.
      const minor = ['footway', 'path', 'cycleway', 'track'].includes(tags.highway);
      ribbon(pts, w, minor ? MAT.minor : MAT.road, minor ? 1.2 : 1.6, !minor);
    } else if (tags.building) {
      const levels = parseFloat(tags['building:levels'] ?? '') || 2;
      polygon(pts, B_MATS[el.id % B_MATS.length], 0.9, clamp(levels * 3.1, 3, 90), 'solid');
    } else if (tags.natural === 'water' || tags.waterway === 'riverbank') {
      polygon(pts, MAT.water, 1.0, 0, 'water');
    } else {
      polygon(pts, MAT.green, 0.6);
    }
  }
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
  const cached = readTileCache(x, y);
  if (cached) { renderWays(cached); return; }
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
    renderWays(ways);
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

// ── the car ────────────────────────────────────────────────────────
const car = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.9, 4.4), new THREE.MeshLambertMaterial({ color: 0xd8442e }));
  body.position.y = 0.75;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 2), new THREE.MeshLambertMaterial({ color: 0x20242c }));
  cabin.position.set(0, 1.4, -0.2);
  const wheelGeo = new THREE.BoxGeometry(0.4, 0.6, 0.9);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x11141a });
  for (const [wx, wz] of [[-1.05, 1.45], [1.05, 1.45], [-1.05, -1.45], [1.05, -1.45]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(wx, 0.35, wz);
    car.add(wheel);
  }
  car.add(body, cabin);
}
// REAL SIZE (owner: the 3.2x cartographic car straddled whole roads and made
// every speed read as a crawl). In the top chart view the car is small — the
// halo is the position marker; in chase it reads true against lane widths.
const halo = new THREE.Mesh(
  new THREE.CircleGeometry(7, 28),
  // A MARKER, not scenery: no depth test, drawn late — the player's position
  // is never allowed to be swallowed by a drape or a rooftop.
  new THREE.MeshBasicMaterial({ color: 0xf5c453, transparent: true, opacity: 0.35, depthWrite: false, depthTest: false }),
);
halo.renderOrder = 40;
halo.rotation.x = -Math.PI / 2;
halo.position.y = 0.15;
car.add(halo);
scene.add(car);
const state = { x: 0, z: 0, heading: 0, speed: 0 };
(window as unknown as { __drive?: object; __surfaceAt?: (x: number, z: number) => string }).__drive = state;
(window as unknown as { __surfaceAt?: (x: number, z: number) => string }).__surfaceAt = surfaceAt; // debug/test handles (read-only use)
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
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  // Capture: without it, a finger lifted over interactive chrome (the reroll
  // button) never fires pointerup HERE — the brake finger leaked and stayed
  // held forever, which read as "the car is stuck".
  try { canvas.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
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
  if (stick?.id !== e.pointerId) return;
  const rx = e.clientX - stick.x0, ry = e.clientY - stick.y0;
  const len = Math.hypot(rx, ry);
  const cl = Math.min(len, STICK_R);
  const ux = len ? rx / len : 0, uy = len ? ry / len : 0;
  stickNub.style.left = `${stick.x0 + ux * cl}px`;
  stickNub.style.top = `${stick.y0 + uy * cl}px`;
  const mag = Math.max(0, cl - STICK_DEAD) / (STICK_R - STICK_DEAD);
  stick.dx = ux * mag;
  stick.dy = uy * mag;
});
const endStick = (e: PointerEvent): void => {
  if (stick?.id === e.pointerId) {
    stick = null;
    stickBase.style.display = stickNub.style.display = 'none';
  }
  if (brakeId === e.pointerId) brakeId = null;
};
canvas.addEventListener('pointerup', endStick);
canvas.addEventListener('pointercancel', endStick);
// Belt to the capture's braces: any release anywhere clears these too.
addEventListener('pointerup', endStick);
addEventListener('pointercancel', endStick);
addEventListener('blur', () => { stick = null; brakeId = null; keys.clear(); stickBase.style.display = stickNub.style.display = 'none'; });
function input(): { throttle: number; steer: number; brake: boolean } {
  let throttle = 0, steer = 0;
  if (keys.has('w') || keys.has('arrowup')) throttle += 1;
  if (keys.has('s') || keys.has('arrowdown')) throttle -= 1;
  if (keys.has('a') || keys.has('arrowleft')) steer -= 1;
  if (keys.has('d') || keys.has('arrowright')) steer += 1;
  if (stick) {
    // Squared response: |v|·v — precision near centre, authority at the rim.
    throttle += -(stick.dy * Math.abs(stick.dy));
    steer += stick.dx * Math.abs(stick.dx);
  }
  return { throttle: clamp(throttle, -1, 1), steer: clamp(steer, -1, 1), brake: brakeId !== null || keys.has(' ') };
}

// ── minimap: north-up, fog-masked, car-centred ─────────────────────
const MINI = 138, MINI_SPAN = 1500; // px, metres across
const mini = document.createElement('canvas');
mini.width = mini.height = MINI * 2;
Object.assign(mini.style, {
  position: 'fixed', left: '12px', bottom: 'max(44px, calc(env(safe-area-inset-bottom) + 34px))',
  width: `${MINI}px`, height: `${MINI}px`, zIndex: '10', pointerEvents: 'none',
  border: '1px solid rgba(245,196,83,0.35)', borderRadius: '10px',
  background: 'rgba(4,6,11,0.9)',
} as Partial<CSSStyleDeclaration>);
document.body.appendChild(mini);
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
const camBtn = document.createElement('button');
camBtn.textContent = 'cam: top';
Object.assign(camBtn.style, {
  position: 'fixed', right: '12px', top: 'calc(max(10px, env(safe-area-inset-top)) + 40px)', zIndex: '11',
  background: 'rgba(8,12,20,0.55)', color: '#f5c453', border: '1px solid rgba(245,196,83,0.4)',
  borderRadius: '8px', padding: '0.35rem 0.7rem', font: 'inherit', fontSize: '0.74rem', cursor: 'pointer',
} as Partial<CSSStyleDeclaration>);
document.body.appendChild(camBtn);
function toggleCam(): void {
  camMode = camMode === 'top' ? 'chase' : 'top';
  camBtn.textContent = `cam: ${camMode}`;
  halo.visible = camMode === 'top'; // the marker is chart furniture, not scenery
  camInit = false;                  // snap to the new rig, then resume smoothing
}
camBtn.addEventListener('click', toggleCam);
addEventListener('keydown', (e) => { if (e.key.toLowerCase() === 'c') toggleCam(); });

// ── main loop ──────────────────────────────────────────────────────
const speedEl = $('speed');
let last = performance.now();
let streamAt = 0;
let miniAt = 0;
// Surface grip: tarmac is fast, everything else asks you to slow down —
// which turns "follow the real roads" into the game. `ride` is the car's
// height over the sampled field (roads are draped 1.6m proud of it).
const SURFACE = {
  road: { max: 50, drag: 0.28, ride: 1.75 },
  ground: { max: 12, drag: 1.6, ride: 0.9 },
  water: { max: 3.5, drag: 3.5, ride: 0.55 },
} as const;
let steerCur = 0; // smoothed — keyboard taps ramp instead of snapping
let rideCur = 1.75; // eased ride height (road drape ⇄ bare ground)
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
  state.speed += thrust * dt;
  state.speed -= state.speed * surf.drag * dt;
  if (brake && Math.abs(state.speed) < 1.2) state.speed = 0;
  state.speed = clamp(state.speed, -CAR.maxRev, surf.max);
  const SRATE = 7; // full-lock in ~0.14s — responsive but not snappy
  steerCur += clamp(steer - steerCur, -SRATE * dt, SRATE * dt);
  if (Math.abs(state.speed) > 0.1) {
    // Authority decays with speed (like a real wheel): full lock is a parking
    // move, a nudge at 180 — turn RATE stays sane across the whole range.
    const authority = 1 / (1 + Math.abs(state.speed) / 12);
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
  const ground = sampleHeight(state.x, state.z);
  // Off-road is BUMPY (realism foundation, aesthetics later): a speed-scaled
  // shake in ride height + pitch/roll, plus body roll into the steer. Two
  // incommensurate sines read as rattle, not metronome.
  const tsec = now / 1000;
  const bumpAmp = surfKind === 'ground' && Math.abs(state.speed) > 2 ? Math.min(1, Math.abs(state.speed) / 8) : 0;
  const bump = bumpAmp * (Math.sin(tsec * 23.7) * 0.6 + Math.sin(tsec * 13.1) * 0.4);
  rideCur += clamp(surf.ride - rideCur, -6 * dt, 6 * dt); // ease across kerbs
  car.position.set(state.x, ground + rideCur + bump * 0.22, state.z);
  car.rotation.set(bump * 0.05, -state.heading, -steerCur * 0.06 * Math.min(1, Math.abs(state.speed) / 15) + bump * 0.04);
  reveal(state.x, state.z);
  if (now > streamAt) { streamAt = now + 1200; streamWorld(state.x, state.z); }
  // Two rigs. TOP: the chart view, tilted a touch for relief. CHASE: low and
  // behind, where speed is legible and the fog reads as a night horizon.
  const fwdX = Math.sin(state.heading), fwdZ = -Math.cos(state.heading);
  if (camMode === 'top') {
    const dist = CAM.base + Math.abs(state.speed) * 3.6 * CAM.perKmh;
    const tiltRad = (CAM.tilt * Math.PI) / 180;
    camPos.set(state.x, ground + dist * Math.sin(tiltRad), state.z + dist * Math.cos(tiltRad));
  } else {
    const back = 11 + Math.abs(state.speed) * 0.35;
    camPos.set(
      state.x - fwdX * back,
      sampleHeight(state.x - fwdX * back, state.z - fwdZ * back) + 4.8 + bump * 0.12,
      state.z - fwdZ * back,
    );
  }
  // Critically-damped-ish follow: snap on mode change, ease in play (the chase
  // rig swings through corners instead of being welded to the bumper).
  if (!camInit) { camera.position.copy(camPos); camInit = true; }
  else camera.position.lerp(camPos, 1 - Math.exp(-(camMode === 'top' ? 10 : 4.5) * dt));
  if (camMode === 'top') camera.lookAt(state.x, ground, state.z);
  else camera.lookAt(state.x + fwdX * 15, ground + 1.6, state.z + fwdZ * 15);
  camera.updateMatrixWorld();
  fogMat.uniforms.groundY.value = ground;
  fogMat.uniforms.camPos.value.copy(camera.position);
  fogMat.uniforms.invPV.value.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse).invert();
  speedEl.innerHTML = `${Math.round(Math.abs(state.speed) * 3.6)}<small> km/h</small>`;
  if (now > miniAt) { miniAt = now + 250; drawMinimap(); }
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// ── boot ───────────────────────────────────────────────────────────
$('reroll').addEventListener('click', () => { location.href = location.pathname + '?random=1'; });
(async () => {
  const spawn = await findSpawn();
  origin = { lat: spawn.lat, lon: spawn.lon, mLon: M_LAT * Math.cos((spawn.lat * Math.PI) / 180) };
  $('place-coords').textContent = `${spawn.lat.toFixed(4)}, ${spawn.lon.toFixed(4)}`;
  $('place-name').textContent = spawn.name ?? '…';
  history.replaceState(null, '', `?lat=${spawn.lat.toFixed(5)}&lon=${spawn.lon.toFixed(5)}`);
  void placeName(spawn.lat, spawn.lon).then((n) => { if (n) $('place-name').textContent = n; });
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

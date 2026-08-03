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
const CAR = { accel: 14, brake: 22, drag: 0.7, maxFwd: 38, maxRev: 8, wheelbase: 3.2, steerMax: 0.62 };
const CAM = { base: 210, perKmh: 1.1, tilt: 70 };

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
    const cv = new OffscreenCanvas(256, 256);
    const cx = cv.getContext('2d')!;
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
const fogPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(FOG_SPAN, FOG_SPAN),
  new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, depthWrite: false }),
);
fogPlane.rotation.x = -Math.PI / 2;
// Height set per-frame: it rides ~150m above the car's ground so the camera
// (~197m+ up) always looks THROUGH it. Tall peaks may pierce it — distant
// summits standing out of the mist is a feature, not a bug.
fogPlane.renderOrder = 50;
scene.add(fogPlane);
let lastRevealX = Infinity, lastRevealZ = Infinity;
function reveal(ex: number, ez: number): void {
  if (Math.hypot(ex - lastRevealX, ez - lastRevealZ) < REVEAL_M * 0.18) return;
  lastRevealX = ex; lastRevealZ = ez;
  const px = ((ex + FOG_SPAN / 2) / FOG_SPAN) * FOG_PX;
  const pz = ((ez + FOG_SPAN / 2) / FOG_SPAN) * FOG_PX;
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
// DoubleSide throughout: ribbon winding and the rotate+mirror extrusion leave
// face orientation mixed — lighting both sides costs little at this scene size
// and makes every surface reliably visible from the top-down camera.
const MAT = {
  road: new THREE.MeshLambertMaterial({ color: 0x3c4148, side: THREE.DoubleSide }),
  minor: new THREE.MeshLambertMaterial({ color: 0x8a8474, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  building: new THREE.MeshLambertMaterial({ color: 0x9a8f7c, side: THREE.DoubleSide }),
  water: new THREE.MeshLambertMaterial({ color: 0x1d3a55, side: THREE.DoubleSide }),
  green: new THREE.MeshLambertMaterial({ color: 0x1c3320, side: THREE.DoubleSide }),
};
function ribbon(pts: Array<[number, number]>, width: number, mat: THREE.Material, lift: number): void {
  const verts: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * width / 2, nz = (dx / len) * width / 2;
    const y00 = sampleHeight(x0 + nx, z0 + nz) + lift, y01 = sampleHeight(x0 - nx, z0 - nz) + lift;
    const y10 = sampleHeight(x1 + nx, z1 + nz) + lift, y11 = sampleHeight(x1 - nx, z1 - nz) + lift;
    verts.push(
      x0 + nx, y00, z0 + nz, x1 + nx, y10, z1 + nz, x0 - nx, y01, z0 - nz,
      x1 + nx, y10, z1 + nz, x1 - nx, y11, z1 - nz, x0 - nx, y01, z0 - nz,
    );
  }
  if (!verts.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.computeVertexNormals();
  worldGroup.add(new THREE.Mesh(geo, mat));
}
function polygon(pts: Array<[number, number]>, mat: THREE.Material, lift: number, extrude = 0): void {
  if (pts.length < 3) return;
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
  let cx = 0, cz = 0;
  for (const [x, z] of pts) { cx += x; cz += z; }
  cx /= pts.length; cz /= pts.length;
  const base = sampleHeight(cx, cz) + lift;
  const geo = extrude > 0
    ? new THREE.ExtrudeGeometry(shape, { depth: extrude, bevelEnabled: false })
    : new THREE.ShapeGeometry(shape);
  geo.rotateX(Math.PI / 2); // shape XY → world XZ (y down after rotate; extrude goes up via scale)
  if (extrude > 0) geo.scale(1, -1, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = base;
  worldGroup.add(mesh);
}
async function loadOsmTile(x: number, y: number): Promise<void> {
  const key = `${x}/${y}`;
  if (osmLoaded.has(key)) return;
  osmLoaded.add(key);
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
    for (const el of r.elements ?? []) {
      if (el.type !== 'way' || !el.geometry || seenWays.has(el.id)) continue;
      seenWays.add(el.id);
      const pts: Array<[number, number]> = el.geometry.map((g: { lat: number; lon: number }) => toLocal(g.lat, g.lon));
      const tags = el.tags ?? {};
      if (tags.highway) {
        const w = ROAD_W[tags.highway] ?? 4;
        const minor = w < 2.5;
        ribbon(pts, w, minor ? MAT.minor : MAT.road, minor ? 1.2 : 1.6);
      } else if (tags.building) {
        const levels = parseFloat(tags['building:levels'] ?? '') || 2;
        polygon(pts, MAT.building, 0.9, clamp(levels * 3.1, 3, 90));
      } else if (tags.natural === 'water' || tags.waterway === 'riverbank') {
        polygon(pts, MAT.water, 1.0);
      } else {
        polygon(pts, MAT.green, 0.6);
      }
    }
  } catch { setTimeout(() => osmLoaded.delete(key), 8000); /* backoff, then a later pass retries */ }
  finally {
    osmInFlight--;
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
// Cartographic, not to-scale: from a 200m camera a 4m car is two pixels.
car.scale.setScalar(3.2);
const halo = new THREE.Mesh(
  new THREE.CircleGeometry(3.4, 24),
  new THREE.MeshBasicMaterial({ color: 0xf5c453, transparent: true, opacity: 0.35, depthWrite: false }),
);
halo.rotation.x = -Math.PI / 2;
halo.position.y = 0.15;
car.add(halo);
scene.add(car);
const state = { x: 0, z: 0, heading: 0, speed: 0 };

// ── input: keyboard + one-thumb touch stick ────────────────────────
const keys = new Set<string>();
addEventListener('keydown', (e) => { keys.add(e.key.toLowerCase()); });
addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); });
let stick: { id: number; x0: number; y0: number; dx: number; dy: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || stick) return;
  stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
});
canvas.addEventListener('pointermove', (e) => {
  if (stick?.id !== e.pointerId) return;
  stick.dx = clamp((e.clientX - stick.x0) / 70, -1, 1);
  stick.dy = clamp((e.clientY - stick.y0) / 70, -1, 1);
});
const endStick = (e: PointerEvent) => { if (stick?.id === e.pointerId) stick = null; };
canvas.addEventListener('pointerup', endStick);
canvas.addEventListener('pointercancel', endStick);
function input(): { throttle: number; steer: number } {
  let throttle = 0, steer = 0;
  if (keys.has('w') || keys.has('arrowup')) throttle += 1;
  if (keys.has('s') || keys.has('arrowdown')) throttle -= 1;
  if (keys.has('a') || keys.has('arrowleft')) steer -= 1;
  if (keys.has('d') || keys.has('arrowright')) steer += 1;
  if (stick) { throttle += -stick.dy; steer += stick.dx; }
  return { throttle: clamp(throttle, -1, 1), steer: clamp(steer, -1, 1) };
}

// ── main loop ──────────────────────────────────────────────────────
const speedEl = $('speed');
let last = performance.now();
let streamAt = 0;
function tick(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const { throttle, steer } = input();
  // Arcade bicycle model: thrust minus drag, steering authority grows then
  // saturates with speed so the car neither pivots in place nor becomes twitchy.
  const thrust = throttle >= 0 ? throttle * CAR.accel : throttle * CAR.brake;
  state.speed += thrust * dt;
  state.speed -= state.speed * CAR.drag * dt;
  state.speed = clamp(state.speed, -CAR.maxRev, CAR.maxFwd);
  if (Math.abs(state.speed) > 0.1) {
    const dir = state.speed >= 0 ? 1 : -1;
    state.heading += (steer * CAR.steerMax * clamp(Math.abs(state.speed) / 9, 0.25, 1) * state.speed * dt * dir) / CAR.wheelbase;
  }
  state.x += Math.sin(state.heading) * state.speed * dt;
  state.z -= Math.cos(state.heading) * state.speed * dt;
  const ground = sampleHeight(state.x, state.z);
  car.position.set(state.x, ground + 1.8, state.z);
  car.rotation.y = -state.heading;
  reveal(state.x, state.z);
  fogPlane.position.y = ground + 150;
  if (now > streamAt) { streamAt = now + 1200; streamWorld(state.x, state.z); }
  // Chase-from-above camera: mostly top-down, tilted a touch for the relief.
  const dist = CAM.base + Math.abs(state.speed) * 3.6 * CAM.perKmh;
  const tiltRad = (CAM.tilt * Math.PI) / 180;
  camera.position.set(state.x, ground + dist * Math.sin(tiltRad), state.z + dist * Math.cos(tiltRad));
  camera.lookAt(state.x, ground, state.z);
  speedEl.innerHTML = `${Math.round(Math.abs(state.speed) * 3.6)}<small> km/h</small>`;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// ── boot ───────────────────────────────────────────────────────────
$('reroll').addEventListener('click', () => { location.href = location.pathname; });
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
  streamWorld(0, 0);
  reveal(0, 0);
  $('boot').classList.add('done');
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick); });
})();

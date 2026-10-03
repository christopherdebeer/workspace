/**
 * Settle: blocks, slowly. A square bed in a still, pale light; pieces come one at a time, and you
 * put each wherever it fits — on the bed, on what's there, out from its side. Nothing falls and
 * nothing hurries. A layer filled edge to edge dissolves with a chime, and what was above comes
 * down to rest.
 *
 * Touch: one finger moves the piece (it rides a little above your finger, so you can see it);
 * tap it to set it down, or tap anywhere to send it there. Two fingers turn the view and pinch it
 * closer. `turn` spins the piece, `tip` tips it away from you. Mouse: it follows the pointer,
 * click to set, drag to turn the view, wheel to come closer; Q/E turn, W/S tip, space sets.
 *
 * Drawn in WebGL2: instanced cubes, lit by a low sun whose shadows are marched through the bed's
 * cells (a tiny 3D texture), with ambient occlusion from the same cells. `?seed=` the bag;
 * `?preview` plays itself, small and quiet (the lab's index).
 */
import { Bag, Bed, choose, COLOURS, H, N, placeFor, raycast, rotate, type C3, type Hit, type Piece } from './game';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
const STORE = 'settle:v1';

const canvas = document.getElementById('bed') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })!;
if (!gl) throw new Error('WebGL2 is needed');
if (preview) document.body.classList.add('preview');

// ─── the colours: stone and earth, nothing loud ─────────────────────────────────────────────────
const PALETTE: C3[] = [
  [0.6, 0.69, 0.57], // sage
  [0.8, 0.57, 0.47], // clay
  [0.87, 0.78, 0.58], // sand
  [0.5, 0.59, 0.7], // slate
  [0.79, 0.61, 0.66], // rose
  [0.82, 0.67, 0.39], // ochre
];

// ─── shaders ────────────────────────────────────────────────────────────────────────────────────
const SKY_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); vUV = p * .5 + .5; gl_Position = vec4(p, .999, 1.); }`;
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform vec3 uTop, uLow;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = mix(uLow, uTop, smoothstep(.15, 1., vUV.y));
  // (a little grain, so the gradient doesn't band)
  c += (h(gl_FragCoord.xy) - .5) / 255.;
  o = vec4(c, 1.);
}`;

const CUBE_VS = `#version 300 es
in vec3 aPos;
in vec3 aNor;
in vec3 aOff;
in vec3 aScale;
in vec4 aCol;
in float aKind;
uniform mat4 uVP;
out vec3 vWorld;
out vec3 vLocal;
flat out vec3 vN;
out vec4 vCol;
flat out float vKind;
void main() {
  vec3 w = aOff + aPos * aScale;
  vWorld = w;
  vLocal = aPos;
  vN = aNor;
  vCol = aCol;
  vKind = aKind;
  gl_Position = uVP * vec4(w, 1.);
}`;

const CUBE_FS = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec3 vWorld;
in vec3 vLocal;
flat in vec3 vN;
in vec4 vCol;
flat in float vKind;
out vec4 o;
uniform sampler3D uOcc;
uniform vec3 uSun, uEye, uFog;
uniform float uNear; // how far the bed's middle is: the air thickens beyond it
uniform float uTime;
const ivec3 DIM = ivec3(${N}, ${H}, ${N});
float occ(ivec3 c) {
  if (c.y < 0) return (c.x >= 0 && c.x < DIM.x && c.z >= 0 && c.z < DIM.z) ? 1. : 0.;
  if (any(lessThan(c, ivec3(0))) || any(greaterThanEqual(c, DIM))) return 0.;
  return texelFetch(uOcc, c, 0).r > .5 ? 1. : 0.;
}
// the sun's light at p: marched through the bed's cells toward it
float sunlight(vec3 p) {
  float lit = 1.;
  for (int i = 1; i < 90; i++) {
    vec3 q = p + uSun * (float(i) * .09);
    if (q.y > float(DIM.y)) break;
    if (occ(ivec3(floor(q))) > .5) { lit = 0.; break; }
  }
  return lit;
}
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
void main() {
  vec3 n = vN;
  // where on its face: two coordinates across it (0..1), and how near an edge
  vec3 a = abs(n);
  vec2 f = a.x > .5 ? vLocal.yz : a.y > .5 ? vLocal.xz : vLocal.xy;
  float edge = min(min(f.x, 1. - f.x), min(f.y, 1. - f.y));
  if (vKind > .5 && vKind < 1.5) {
    // the piece in hand: clear, its edges drawn, breathing
    float line = 1. - smoothstep(.02, .06, edge);
    float breathe = .5 + .5 * sin(uTime * 2.2);
    // (its edges a deeper shade of its colour, so it shows on a pale bed as on a dark stack)
    vec3 c = mix(mix(vCol.rgb, vec3(1.), .2 + .15 * breathe), vCol.rgb * .55, line);
    float al = mix(.3 + .08 * breathe, .95, line);
    o = vec4(c * al, al);
    return;
  }
  if (vKind > 1.5 && vKind < 2.5) {
    // where it would come to rest below: a soft mark
    float m = smoothstep(0., .25, edge) * .22;
    o = vec4(vec3(.25, .22, .2) * m, m);
    return;
  }
  vec3 base = vCol.rgb;
  float ao = 1.;
  float sun = 1.;
  if (vKind > 3.5 && vKind < 4.5) {
    // (the next piece, shown in its corner: lit simply)
  } else {
    // ambient occlusion from the cells around this face's corner of the world
    ivec3 cell = ivec3(floor(vWorld - n * .5));
    ivec3 front = cell + ivec3(n);
    ivec3 t1 = a.x > .5 ? ivec3(0, 1, 0) : ivec3(1, 0, 0);
    ivec3 t2 = a.z > .5 ? ivec3(0, 1, 0) : ivec3(0, 0, 1);
    vec3 l = vWorld - vec3(cell);
    float u1 = a.x > .5 ? l.y : l.x;
    float u2 = a.z > .5 ? l.y : l.z;
    float s = 0.;
    s += occ(front + t1) * smoothstep(.5, 0., 1. - u1);
    s += occ(front - t1) * smoothstep(.5, 0., u1);
    s += occ(front + t2) * smoothstep(.5, 0., 1. - u2);
    s += occ(front - t2) * smoothstep(.5, 0., u2);
    s += occ(front + t1 + t2) * smoothstep(.5, 0., 1. - u1) * smoothstep(.5, 0., 1. - u2);
    s += occ(front + t1 - t2) * smoothstep(.5, 0., 1. - u1) * smoothstep(.5, 0., u2);
    s += occ(front - t1 + t2) * smoothstep(.5, 0., u1) * smoothstep(.5, 0., 1. - u2);
    s += occ(front - t1 - t2) * smoothstep(.5, 0., u1) * smoothstep(.5, 0., u2);
    ao = 1. - .32 * min(s, 1.6);
    sun = dot(n, uSun) > 0. ? sunlight(vWorld + n * .01) : 0.;
  }
  if (vKind > 4.5) {
    // the bed: pale stone, its cells faintly marked
    vec2 g = abs(fract(vWorld.xz) - .5);
    float grid = (n.y > .5 && vWorld.x > 0. && vWorld.x < float(DIM.x) && vWorld.z > 0. && vWorld.z < float(DIM.z))
      ? smoothstep(.47, .5, max(g.x, g.y)) * .07 : 0.;
    base *= 1. - grid;
    base *= .97 + .05 * vn(vWorld.xz * 3. + vWorld.y);
  } else {
    // a cube: soft-edged, faintly mottled like fired clay
    base *= .95 + .06 * vn(f * 6. + vWorld.xz * 1.7 + vWorld.y * 3.1);
    base *= mix(.86, 1., smoothstep(.0, .05, edge));
    base += smoothstep(.06, .0, edge) * .04;
  }
  float diff = max(0., dot(n, uSun)) * sun;
  // sky light from above, a warm bounce from below, the sun
  vec3 light = vec3(.7, .72, .76) * (.74 + .26 * n.y) + vec3(.07, .06, .05) * max(0., -n.y);
  light = light * ao + vec3(1., .93, .82) * diff * .45;
  vec3 c = base * light;
  // the air: further is paler
  float d = length(vWorld - uEye);
  c = mix(c, uFog, smoothstep(uNear, uNear + 30., d) * .5);
  o = vec4(c * vCol.a, vCol.a);
}`;

function program(vs: string, fs: string): WebGLProgram {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}
const skyProg = program(SKY_VS, SKY_FS);
const cubeProg = program(CUBE_VS, CUBE_FS);
const u = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);

// ─── the cube, and its instances ────────────────────────────────────────────────────────────────
const cubeVerts: number[] = [];
{
  // six faces, each two triangles, outward
  const faces: Array<[C3, C3, C3]> = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  for (const [n, s, t] of faces) {
    // (the face lies on its normal's side of the unit cube; s × t = n, so it winds outward)
    const c = n.map((v) => (v > 0 ? 1 : 0));
    const at = (i: number, j: number) => [0, 1, 2].map((a) => c[a] + s[a] * i + t[a] * j);
    for (const [i, j] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) cubeVerts.push(...at(i, j), ...n);
  }
}
const cubeVao = gl.createVertexArray()!;
gl.bindVertexArray(cubeVao);
const cubeBuf = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cubeVerts), gl.STATIC_DRAW);
for (const [name, size, off] of [['aPos', 3, 0], ['aNor', 3, 3]] as const) {
  const loc = gl.getAttribLocation(cubeProg, name);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 24, off * 4);
}
const instBuf = gl.createBuffer()!;
gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
const STRIDE = 11;
for (const [name, size, off] of [['aOff', 3, 0], ['aScale', 3, 3], ['aCol', 4, 6], ['aKind', 1, 10]] as const) {
  const loc = gl.getAttribLocation(cubeProg, name);
  if (loc < 0) continue;
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4);
  gl.vertexAttribDivisor(loc, 1);
}
gl.bindVertexArray(null);
const skyVao = gl.createVertexArray()!;

// the bed's cells, for the light: a tiny 3D texture
const occTex = gl.createTexture()!;
gl.bindTexture(gl.TEXTURE_3D, occTex);
gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, N, H, N, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(N * H * N));
function uploadOcc() {
  const d = new Uint8Array(N * H * N);
  for (let z = 0; z < N; z++) for (let y = 0; y < H; y++) for (let x = 0; x < N; x++) d[x + N * (y + H * z)] = bed.at(x, y, z) ? 255 : 0;
  gl.bindTexture(gl.TEXTURE_3D, occTex);
  gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, N, H, N, gl.RED, gl.UNSIGNED_BYTE, d);
}

// ─── the game ───────────────────────────────────────────────────────────────────────────────────
let seed = Number(params.get('seed')) || Math.floor(Math.random() * 90000) + 1;
let bed = new Bed();
let bag = new Bag(seed);
let layers = 0;
let piece: Piece;
let next: Piece;
/** how far each cell still has to come down (it settles visibly) */
let lift = new Float32Array(N * H * N);
/** cubes dissolving out of a finished layer */
let fading: Array<{ p: C3; colour: number; t: number }> = [];

interface Saved { seed: number; drawn: number; cells: number[]; layers: number; cubes: C3[] }
function save() {
  if (preview) return;
  try {
    const s: Saved = { seed, drawn: bag.drawn, cells: [...bed.cells], layers, cubes: piece.cubes };
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch { /* (private window: no memory, still plays) */ }
}
function begin(fresh: boolean) {
  let s: Saved | null = null;
  if (!fresh && !preview && !params.get('seed')) {
    try { s = JSON.parse(localStorage.getItem(STORE) ?? 'null'); } catch { s = null; }
  }
  if (s && s.cells?.length === N * H * N) {
    seed = s.seed;
    bed = new Bed();
    bed.cells.set(s.cells);
    // (the bag picks up where it was: the piece in hand was its last but one)
    bag = new Bag(seed, Math.max(0, s.drawn - 2));
    piece = bag.next();
    piece.cubes = s.cubes ?? piece.cubes;
    next = bag.next();
    layers = s.layers ?? 0;
  } else {
    // (the first time here: a word on how)
    if (!fresh && !preview) document.getElementById('hint')?.classList.add('on');
    if (fresh) seed = Math.floor(Math.random() * 90000) + 1;
    bed = new Bed();
    bag = new Bag(seed);
    piece = bag.next();
    next = bag.next();
    layers = 0;
  }
  lift = new Float32Array(N * H * N);
  fading = [];
  ghostAt = null;
  uploadOcc();
  showCount();
  save();
}

// ─── the piece in hand ──────────────────────────────────────────────────────────────────────────
let lastHit: Hit | null = null;
let ghostAt: C3 | null = null;
function aimHit(hit: Hit | null) {
  if (!hit) return;
  const at = placeFor(bed, piece.cubes, hit);
  if (!at) return;
  lastHit = hit;
  if (!ghostAt || at.some((v, i) => v !== ghostAt![i])) {
    ghostAt = at;
    tick();
  }
}
function reaim() {
  if (lastHit) {
    const at = placeFor(bed, piece.cubes, lastHit);
    ghostAt = at;
  }
  if (!ghostAt) {
    // (nowhere yet: the middle of the bed, on whatever's there)
    aimHit(raycast(bed, [N / 2, H + 2, N / 2], [0, -1, 0]));
  }
}
function turn(axis: number, dir: number) {
  piece.cubes = rotate(piece.cubes, axis, dir);
  reaim();
  tick(1.5);
  save();
}
function tipAway() {
  // tip it away from you: about whichever of the bed's level axes lies most across your view
  const rx = -Math.sin(yaw);
  const rz = Math.cos(yaw);
  if (Math.abs(rx) > Math.abs(rz)) turn(0, rx > 0 ? -1 : 1);
  else turn(2, rz > 0 ? 1 : -1);
}
function set() {
  if (!ghostAt) reaim();
  if (!ghostAt || !bed.fits(piece.cubes, ghostAt)) return;
  const at = ghostAt;
  bed.place(piece, at);
  for (const c of piece.cubes) lift[bed.idx(c[0] + at[0], c[1] + at[1], c[2] + at[2])] = 0.18;
  chime(piece, at);
  // full layers dissolve; what's above comes down
  const full = bed.full();
  for (const y of [...full].reverse()) {
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      fading.push({ p: [x, y + lift[bed.idx(x, y, z)], z], colour: bed.at(x, y, z) - 1, t: 0 });
    }
    bed.remove(y);
    lift.copyWithin(y * N * N, (y + 1) * N * N);
    lift.fill(0, (H - 1) * N * N);
    for (let i = y * N * N; i < lift.length; i++) if (bed.cells[i]) lift[i] += 1;
    layers++;
  }
  if (full.length) settleSound(full.length);
  piece = next;
  next = bag.next();
  uploadOcc();
  reaim();
  showCount();
  save();
}

// ─── the view ───────────────────────────────────────────────────────────────────────────────────
let yaw = -2.2;
let pitch = 0.62;
let dist = 15;
let lookY = 2;
function camera() {
  const W = canvas.width;
  const Hh = canvas.height;
  const aspect = W / Hh;
  const fov = 0.62;
  // (far enough back that the bed fits across the window, however narrow; `dist` is a zoom on that)
  const t = Math.tan(fov / 2);
  const d = (dist / 15) * Math.max(15, 4.9 / (t * aspect));
  const target: C3 = [N / 2, lookY, N / 2];
  const eye: C3 = [
    target[0] + Math.cos(pitch) * Math.cos(yaw) * d,
    target[1] + Math.sin(pitch) * d,
    target[2] + Math.cos(pitch) * Math.sin(yaw) * d,
  ];
  const fwd = normalize(sub(target, eye));
  const right = normalize(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  return { eye, d, fwd, right, up, aspect, fov, vp: viewProj(eye, fwd, right, up, fov, aspect) };
}
function ray(px: number, py: number): { o: C3; d: C3 } {
  const c = camera();
  const r = canvas.getBoundingClientRect();
  const nx = ((px - r.left) / r.width) * 2 - 1;
  const ny = 1 - ((py - r.top) / r.height) * 2;
  const t = Math.tan(c.fov / 2);
  const d = normalize([0, 1, 2].map((a) => c.fwd[a] + c.right[a] * nx * t * c.aspect + c.up[a] * ny * t) as C3);
  return { o: c.eye, d };
}
/** Aim at a point on the screen: the face under it, or (missing everything) the column below. */
function aimAt(px: number, py: number) {
  const { o, d } = ray(px, py);
  let hit = raycast(bed, o, d);
  if (!hit && d[1] < 0) {
    const t = -o[1] / d[1];
    const x = Math.max(0, Math.min(N - 1, Math.floor(o[0] + d[0] * t)));
    const z = Math.max(0, Math.min(N - 1, Math.floor(o[2] + d[2] * t)));
    hit = raycast(bed, [x + 0.5, H + 1, z + 0.5], [0, -1, 0]);
  }
  aimHit(hit);
}
/** Whether a point on the screen is on the piece in hand. */
function onGhost(px: number, py: number): boolean {
  if (!ghostAt) return false;
  const { o, d } = ray(px, py);
  for (const c of piece.cubes) {
    const lo = [c[0] + ghostAt[0] - 0.15, c[1] + ghostAt[1] - 0.15, c[2] + ghostAt[2] - 0.15];
    let t0 = 0;
    let t1 = 1e9;
    let ok = true;
    for (let a = 0; a < 3 && ok; a++) {
      if (Math.abs(d[a]) < 1e-9) { ok = o[a] >= lo[a] && o[a] <= lo[a] + 1.3; continue; }
      let ta = (lo[a] - o[a]) / d[a];
      let tb = (lo[a] + 1.3 - o[a]) / d[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      ok = t0 <= t1;
    }
    if (ok) return true;
  }
  return false;
}

// ─── hands ──────────────────────────────────────────────────────────────────────────────────────
const RIDE = 64; // a finger's piece rides this far above it (CSS px)
const pointers = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number; type: string; moved: boolean }>();
let twoFinger: { d: number; x: number; y: number } | null = null;
let idle = 0;
canvas.addEventListener('pointerdown', (e) => {
  wake();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), type: e.pointerType, moved: false });
  twoFinger = null;
  idle = 0;
  document.getElementById('hint')?.classList.remove('on');
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  idle = 0;
  if (!p) {
    // a mouse with no button down: the piece follows it
    if (e.pointerType === 'mouse') aimAt(e.clientX, e.clientY);
    return;
  }
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 8) p.moved = true;
  if (pointers.size >= 2) {
    p.x = e.clientX;
    p.y = e.clientY;
    const [a, b] = [...pointers.values()];
    const now = { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (twoFinger) {
      yaw += (now.x - twoFinger.x) * 0.008;
      pitch = clamp(pitch + (now.y - twoFinger.y) * 0.006, 0.12, 1.35);
      if (twoFinger.d > 0) dist = clamp(dist * (twoFinger.d / now.d), 7, 30);
    }
    twoFinger = now;
    for (const q of pointers.values()) q.moved = true;
    return;
  }
  p.x = e.clientX;
  p.y = e.clientY;
  if (p.type === 'mouse') {
    // a mouse dragging: the view turns
    if (p.moved) {
      yaw += dx * 0.008;
      pitch = clamp(pitch + dy * 0.006, 0.12, 1.35);
    }
  } else if (p.moved) {
    aimAt(e.clientX, e.clientY - RIDE);
  }
});
const up = (e: PointerEvent) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) twoFinger = null;
  if (!p || p.moved || performance.now() - p.t0 > 600) return;
  // a tap: on the piece, set it; elsewhere, send it there
  if (onGhost(e.clientX, e.clientY)) set();
  else if (p.type === 'mouse') { aimAt(e.clientX, e.clientY); set(); }
  else aimAt(e.clientX, e.clientY);
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); twoFinger = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  dist = clamp(dist * Math.exp(e.deltaY * 0.0012), 7, 30);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  wake();
  const k = e.key.toLowerCase();
  if (k === 'q') turn(1, -1);
  else if (k === 'e') turn(1, 1);
  else if (k === 'w') tipAway();
  else if (k === 's') { tipAway(); tipAway(); tipAway(); }
  else if (k === ' ' || k === 'enter') { e.preventDefault(); set(); }
});
const btn = (id: string, f: () => void) => document.getElementById(id)?.addEventListener('click', (e) => { e.stopPropagation(); wake(); f(); });
btn('turn', () => turn(1, 1));
btn('tip', tipAway);
btn('set', set);
btn('again', () => begin(true));
btn('sound', () => {
  soundOn = !soundOn;
  showSound();
  try { localStorage.setItem(STORE + ':sound', soundOn ? '1' : '0'); } catch { /* */ }
  if (master && ac) master.gain.setTargetAtTime(soundOn ? 1 : 0, ac.currentTime, 0.3);
});
function showCount() {
  const el = document.getElementById('count');
  if (el) el.textContent = layers ? `${layers} ${layers === 1 ? 'layer' : 'layers'} settled` : '';
}

// ─── sound: soft tones, a low drone ─────────────────────────────────────────────────────────────
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let space: AudioNode | null = null;
let soundOn = (() => { try { return localStorage.getItem(STORE + ':sound') !== '0'; } catch { return true; } })();
function showSound() {
  const el = document.getElementById('sound');
  if (el) el.textContent = soundOn ? 'sound · on' : 'sound · off';
}
showSound();
const SCALE = [0, 2, 4, 7, 9]; // pentatonic
function wake() {
  if (ac || preview) return;
  try {
    ac = new AudioContext();
  } catch {
    return;
  }
  master = ac.createGain();
  master.gain.value = soundOn ? 1 : 0;
  master.connect(ac.destination);
  // a room: a soft feedback echo, darkened
  const delay = ac.createDelay(1);
  delay.delayTime.value = 0.31;
  const fb = ac.createGain();
  fb.gain.value = 0.38;
  const dark = ac.createBiquadFilter();
  dark.type = 'lowpass';
  dark.frequency.value = 1800;
  const wet = ac.createGain();
  wet.gain.value = 0.35;
  delay.connect(dark).connect(fb).connect(delay);
  dark.connect(wet).connect(master);
  const input = ac.createGain();
  input.connect(master);
  input.connect(delay);
  space = input;
  // the drone: two low tones, a breath apart, under a slowly moving filter
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 320;
  const lfo = ac.createOscillator();
  lfo.frequency.value = 0.05;
  const lfoAmt = ac.createGain();
  lfoAmt.gain.value = 140;
  lfo.connect(lfoAmt).connect(lp.frequency);
  lfo.start();
  const g = ac.createGain();
  g.gain.value = 0;
  g.gain.setTargetAtTime(0.045, ac.currentTime, 3);
  for (const f of [73.4, 110.2, 146.4]) {
    const o = ac.createOscillator();
    o.type = f > 140 ? 'sine' : 'triangle';
    o.frequency.value = f;
    o.connect(lp);
    o.start();
  }
  lp.connect(g).connect(master);
}
function tone(freq: number, when: number, dur: number, gain: number) {
  if (!ac || !space) return;
  const t = ac.currentTime + when;
  const env = ac.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  for (const [mult, type, k] of [[1, 'sine', 1], [2, 'sine', 0.18], [3.01, 'triangle', 0.05]] as const) {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = freq * mult;
    const og = ac.createGain();
    og.gain.value = k;
    o.connect(og).connect(env);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  env.connect(space);
}
const note = (step: number) => 220 * Math.pow(2, (SCALE[((step % 5) + 5) % 5] + 12 * Math.floor(step / 5)) / 12);
let lastTick = 0;
function tick(k = 1) {
  if (!ac) return;
  const now = performance.now();
  if (now - lastTick < 70) return;
  lastTick = now;
  tone(1760 + Math.random() * 200, 0, 0.05, 0.012 * k);
}
function chime(p: Piece, at: C3) {
  const y = at[1] + Math.min(...p.cubes.map((c) => c[1]));
  tone(note(p.colour + y), 0, 1.6, 0.12);
  tone(note(p.colour + y + 2) / 2, 0.02, 2.2, 0.05);
}
function settleSound(n: number) {
  for (let i = 0; i < 5 + n; i++) tone(note(i * 2 + 3), i * 0.11, 2.6, 0.08);
}

// ─── drawing ────────────────────────────────────────────────────────────────────────────────────
const SUN = normalize([0.55, 0.85, 0.35]);
const FOG: C3 = [0.93, 0.9, 0.86];
let dpr = 1;
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2) * (preview ? 0.5 : 1);
  const w = Math.round(innerWidth * dpr);
  const h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
addEventListener('resize', resize);
resize();

const inst: number[] = [];
function push(off: C3, scale: C3, col: C3, a: number, kind: number) {
  inst.push(off[0], off[1], off[2], scale[0], scale[1], scale[2], col[0], col[1], col[2], a, kind);
}
let last = performance.now();
let time = 0;
let auto = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  idle += dt;
  resize();
  if (preview) {
    // the index's card plays itself, slowly turning
    yaw += dt * 0.12;
    auto += dt;
    if (auto > 1.3) {
      auto = 0;
      if (bed.height() > H - 5) begin(true);
      const c = choose(bed, piece.cubes);
      if (c) {
        piece.cubes = c.cubes;
        ghostAt = c.at;
        set();
      } else begin(true);
    }
  }
  // what's above a finished layer comes down; a set piece settles in
  for (let i = 0; i < lift.length; i++) if (lift[i] > 0) lift[i] = Math.max(0, lift[i] - Math.max(lift[i] * dt * 3.2, dt * 0.4));
  for (const f of fading) f.t += dt / 1.8;
  fading = fading.filter((f) => f.t < 1);
  // the view rises with the stack
  const top = Math.max(bed.height(), ghostAt ? ghostAt[1] + 1 : 0);
  lookY += (Math.max(1.5, top * 0.55 + 0.8) - lookY) * Math.min(1, dt * 1.5);

  const cam = camera();
  const W = canvas.width;
  const Hh = canvas.height;
  gl.viewport(0, 0, W, Hh);
  gl.disable(gl.SCISSOR_TEST);
  gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
  gl.depthMask(true);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  // the sky
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(skyProg);
  gl.uniform3f(u(skyProg, 'uTop'), 0.78, 0.81, 0.84);
  gl.uniform3f(u(skyProg, 'uLow'), FOG[0], FOG[1], FOG[2]);
  gl.bindVertexArray(skyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // solid: the bed, the cubes, the fading
  inst.length = 0;
  push([-0.35, -0.6, -0.35], [N + 0.7, 0.6, N + 0.7], [0.9, 0.87, 0.82], 1, 5);
  for (let y = 0; y < H; y++) for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const v = bed.at(x, y, z);
    if (!v) continue;
    push([x, y + lift[bed.idx(x, y, z)], z], [1, 1, 1], PALETTE[(v - 1) % COLOURS], 1, 0);
  }
  const solids = inst.length / STRIDE;
  for (const f of fading) {
    // (a dissolving cube: rising a little, shrinking, paling)
    const e = f.t * f.t;
    const s = 1 - 0.5 * e;
    const c = PALETTE[f.colour % COLOURS].map((v) => v + (1 - v) * f.t * 0.7) as C3;
    push([f.p[0] + (1 - s) / 2, f.p[1] + (1 - s) / 2 + e * 0.6, f.p[2] + (1 - s) / 2], [s, s, s], c, 1 - f.t, 3);
  }
  const ghostStart = inst.length / STRIDE;
  // the piece in hand, and where each of its cubes would rest below it
  if (ghostAt && !preview) {
    const col = PALETTE[piece.colour];
    const g = ghostAt;
    for (const c of piece.cubes) {
      const p: C3 = [c[0] + g[0], c[1] + g[1], c[2] + g[2]];
      push([p[0] - 0.01, p[1] - 0.01, p[2] - 0.01], [1.02, 1.02, 1.02], col, 0.5, 1);
    }
    for (const c of piece.cubes) {
      const p: C3 = [c[0] + g[0], c[1] + g[1], c[2] + g[2]];
      if (piece.cubes.some((d) => d[0] === c[0] && d[2] === c[2] && d[1] < c[1])) continue;
      let y = p[1] - 1;
      while (y >= 0 && !bed.at(p[0], y, p[2])) y--;
      if (y + 1 === p[1]) continue;
      push([p[0] + 0.1, y + 1 + 0.003, p[2] + 0.1], [0.8, 0.01, 0.8], [0, 0, 0], 1, 2);
    }
  }
  const total = inst.length / STRIDE;
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(inst), gl.DYNAMIC_DRAW);
  gl.useProgram(cubeProg);
  gl.uniformMatrix4fv(u(cubeProg, 'uVP'), false, cam.vp);
  gl.uniform3fv(u(cubeProg, 'uSun'), SUN);
  gl.uniform3fv(u(cubeProg, 'uEye'), cam.eye);
  gl.uniform3fv(u(cubeProg, 'uFog'), FOG);
  gl.uniform1f(u(cubeProg, 'uNear'), cam.d);
  gl.uniform1f(u(cubeProg, 'uTime'), time);
  gl.uniform1i(u(cubeProg, 'uOcc'), 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_3D, occTex);
  gl.bindVertexArray(cubeVao);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, solids);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  // (the fading, then the marks, then the piece in hand: see-through, over everything)
  drawRange(solids, ghostStart);
  drawRange(ghostStart, total);
  gl.depthMask(true);

  // the next piece, in its corner
  if (!preview && next) {
    const s = Math.round(78 * dpr);
    const x0 = W - s - Math.round(14 * dpr);
    const y0 = Hh - s - Math.round(40 * dpr);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x0, y0, s, s);
    gl.viewport(x0, y0, s, s);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    inst.length = 0;
    const m = [0, 1, 2].map((a) => (Math.max(...next.cubes.map((c) => c[a])) + 1) / 2);
    for (const c of next.cubes) push([c[0] - m[0], c[1] - m[1], c[2] - m[2]], [1, 1, 1], PALETTE[next.colour], 1, 4);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(inst), gl.DYNAMIC_DRAW);
    const a = time * 0.5;
    const eye: C3 = [Math.cos(a) * 6.5, 4.2, Math.sin(a) * 6.5];
    const fwd = normalize(sub([0, 0, 0], eye));
    const right = normalize(cross(fwd, [0, 1, 0]));
    gl.uniformMatrix4fv(u(cubeProg, 'uVP'), false, viewProj(eye, fwd, right, cross(right, fwd), 0.62, 1));
    gl.uniform3fv(u(cubeProg, 'uEye'), eye);
    gl.uniform1f(u(cubeProg, 'uNear'), 100);
    gl.disable(gl.BLEND);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, inst.length / STRIDE);
    gl.disable(gl.SCISSOR_TEST);
  }
  gl.bindVertexArray(null);
  (window as unknown as { __settle: unknown }).__settle = { seed, layers, height: bed.height(), cubes: bed.count(), ghost: ghostAt, piece: piece.shape };
  requestAnimationFrame(frame);
}
function drawRange(from: number, to: number) {
  if (to <= from) return;
  // (instanced attributes start at the range's first instance)
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  for (const [name, size, off] of [['aOff', 3, 0], ['aScale', 3, 3], ['aCol', 4, 6], ['aKind', 1, 10]] as const) {
    const loc = gl.getAttribLocation(cubeProg, name);
    if (loc < 0) continue;
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, (from * STRIDE + off) * 4);
  }
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, to - from);
  for (const [name, size, off] of [['aOff', 3, 0], ['aScale', 3, 3], ['aCol', 4, 6], ['aKind', 1, 10]] as const) {
    const loc = gl.getAttribLocation(cubeProg, name);
    if (loc < 0) continue;
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4);
  }
}

// ─── small maths ────────────────────────────────────────────────────────────────────────────────
function sub(a: C3, b: C3): C3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: C3, b: C3): C3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(a: C3): C3 { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function viewProj(eye: C3, f: C3, r: C3, up: C3, fov: number, aspect: number): Float32Array {
  const dot = (a: C3, b: C3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z: C3 = [-f[0], -f[1], -f[2]];
  const view = [r[0], up[0], z[0], 0, r[1], up[1], z[1], 0, r[2], up[2], z[2], 0, -dot(r, eye), -dot(up, eye), -dot(z, eye), 1];
  const t = 1 / Math.tan(fov / 2);
  const near = 0.1;
  const far = 200;
  const proj = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) out[c * 4 + rr] = proj[rr] * view[c * 4] + proj[4 + rr] * view[c * 4 + 1] + proj[8 + rr] * view[c * 4 + 2] + proj[12 + rr] * view[c * 4 + 3];
  return out;
}

begin(false);
reaim();
requestAnimationFrame(frame);

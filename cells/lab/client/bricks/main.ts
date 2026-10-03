/**
 * Bricks: a baseplate and a tray of bricks, and nothing to do but build. Choose a size, brick or
 * plate, a colour; move it with a finger (it rides a little above, so you can see it), tap it to
 * press it on. Bricks connect as the real ones do — on studs, or under something — and stay.
 * `take` lifts bricks off again; `undo` steps back. What you build is kept in this browser.
 *
 * Touch: one finger on the build moves the brick, on the sky turns the view; two fingers pinch
 * closer, twist to turn, drag to slide. Mouse: the brick follows the pointer, click to press it
 * on, drag to turn the view, right-drag (or shift-drag) to slide, the wheel to come closer.
 * Keys: R turns the brick, space presses it on, T takes, Z undoes.
 *
 * Drawn in WebGL2: instanced boxes and studs, glossy, lit by a sun whose shadows are found by
 * walking the grid toward it (the build's cells in a small 3D texture), with ambient occlusion
 * from the same cells. `?preview` builds a little town by itself, slowly (the lab's index).
 */
import { COLOURS, H, N, PLATE, SIZES, World, placeFor, raycast, town, type Brick, type C3, type Hit } from './build';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
/** builds by itself: the lab's preview, or `?town` to watch it full size */
const auto = preview || params.has('town');
const STORE = 'bricks:v1';

const canvas = document.getElementById('build') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })!;
if (!gl) throw new Error('WebGL2 is needed');
if (auto) document.body.classList.add('preview');

const STUD_R = 0.3; // 4.8 mm across, on an 8 mm pitch
const STUD_H = 0.21; // 1.7 mm
const BASE: C3 = [0.25, 0.52, 0.27]; // the baseplate's green
const GAP = 0.012; // between neighbours: the line where two bricks meet

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
void main() { o = vec4(mix(uLow, uTop, smoothstep(.1, 1., vUV.y)) + (h(gl_FragCoord.xy) - .5) / 255., 1.); }`;

const VS = `#version 300 es
in vec3 aPos;
in vec3 aNor;
in vec3 aOff;
in vec3 aScale;
in vec4 aCol;
in float aKind;
uniform mat4 uVP;
out vec3 vWorld;
out vec3 vLocal;
out vec3 vNor;
flat out vec3 vScale;
out vec4 vCol;
flat out float vKind;
void main() {
  vec3 w = aOff + aPos * aScale;
  vWorld = w;
  vLocal = aPos;
  vNor = aNor;
  vScale = aScale;
  vCol = aCol;
  vKind = aKind;
  gl_Position = uVP * vec4(w, 1.);
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec3 vWorld;
in vec3 vLocal;
in vec3 vNor;
flat in vec3 vScale;
in vec4 vCol;
flat in float vKind; // 0 a brick, 1 see-through (the brick in hand, or one about to be taken), 3 the baseplate
out vec4 o;
uniform sampler3D uOcc;
uniform vec3 uSun, uEye, uFog;
uniform float uTime, uNear, uTop;
uniform float uStud; // 1: drawing studs
const ivec3 DIM = ivec3(${N}, ${H}, ${N});
const float CH = ${PLATE.toFixed(3)};
float occ(ivec3 c) {
  if (c.y < 0) return (c.x >= 0 && c.x < DIM.x && c.z >= 0 && c.z < DIM.z) ? 1. : 0.;
  if (any(lessThan(c, ivec3(0))) || any(greaterThanEqual(c, DIM))) return 0.;
  return texelFetch(uOcc, c, 0).r > .5 ? 1. : 0.;
}
// sunlight at a point: walk the grid toward the sun, cell by cell, until something's in the way
float sunlight(vec3 pw) {
  vec3 p = vec3(pw.x, pw.y / CH, pw.z);
  vec3 d = normalize(vec3(uSun.x, uSun.y / CH, uSun.z));
  ivec3 c = ivec3(floor(p));
  vec3 st = sign(d);
  vec3 tD = abs(1. / d);
  vec3 tM = (vec3(c) + max(st, 0.) - p) / d;
  for (int i = 0; i < 160; i++) {
    if (tM.x < tM.y && tM.x < tM.z) { c.x += int(st.x); tM.x += tD.x; }
    else if (tM.y < tM.z) { c.y += int(st.y); tM.y += tD.y; }
    else { c.z += int(st.z); tM.z += tD.z; }
    if (float(c.y) >= uTop || c.x < 0 || c.z < 0 || c.x >= DIM.x || c.z >= DIM.z) return 1.;
    if (occ(c) > .5) return 0.;
  }
  return 1.;
}
void main() {
  vec3 n = normalize(vNor);
  vec3 V = normalize(uEye - vWorld);
  if (vKind > .5 && vKind < 1.5) {
    // see-through: its colour, breathing; its edges drawn
    float breathe = .5 + .5 * sin(uTime * 2.4);
    float line = 0.;
    if (uStud < .5) {
      vec3 q = vLocal * vScale;
      vec3 a = abs(n);
      vec2 f = a.x > .5 ? q.yz : a.y > .5 ? q.xz : q.xy;
      vec2 s = a.x > .5 ? vScale.yz : a.y > .5 ? vScale.xz : vScale.xy;
      float e = min(min(f.x, s.x - f.x), min(f.y, s.y - f.y));
      line = 1. - smoothstep(.03, .07, e);
    }
    vec3 c = mix(mix(vCol.rgb, vec3(1.), .25 + .15 * breathe), vCol.rgb * .5, line);
    float al = mix(.32 + .1 * breathe, .95, line);
    o = vec4(c * al, al);
    return;
  }
  vec3 base = vCol.rgb;
  // ambient occlusion from the cells around this face's corner
  float ao = 1.;
  if (uStud < .5) {
    vec3 cs = vec3(vWorld.x, vWorld.y / CH, vWorld.z);
    vec3 a = abs(n);
    ivec3 cell = ivec3(floor(cs - n * .5));
    ivec3 front = cell + ivec3(round(n));
    ivec3 t1 = a.x > .5 ? ivec3(0, 1, 0) : ivec3(1, 0, 0);
    ivec3 t2 = a.z > .5 ? ivec3(0, 1, 0) : ivec3(0, 0, 1);
    vec3 l = cs - vec3(cell);
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
    ao = 1. - .3 * min(s, 1.6);
    // its moulded edges: a fine dark line where it meets the next, a glint just inside
    vec3 q = vLocal * vScale;
    vec2 f = a.x > .5 ? q.yz : a.y > .5 ? q.xz : q.xy;
    vec2 sz = a.x > .5 ? vScale.yz : a.y > .5 ? vScale.xz : vScale.xy;
    float e = min(min(f.x, sz.x - f.x), min(f.y, sz.y - f.y));
    if (vKind < 2.5) {
      base *= mix(.72, 1., smoothstep(.0, .025, e));
      base += smoothstep(.05, .02, e) * smoothstep(.0, .02, e) * .05;
    }
  } else {
    // a stud's foot sits in the corner it makes with the brick
    ao = mix(.75, 1., smoothstep(0., .08, vLocal.y));
  }
  // (from just outside its own face: past the hairline gap, into the next cell)
  float sun = dot(n, uSun) > 0. ? sunlight(vWorld + n * .03) : 0.;
  float diff = max(0., dot(n, uSun)) * sun;
  // sky from above, a little warm bounce from below, the sun; and the plastic's shine
  vec3 light = vec3(.62, .65, .7) * (.72 + .28 * n.y) * ao + vec3(.08, .07, .06) * max(0., -n.y);
  light += vec3(1., .95, .86) * diff * .62;
  vec3 c = base * light;
  vec3 hv = normalize(uSun + V);
  float gloss = vKind > 2.5 ? .12 : .4;
  c += vec3(1., .97, .92) * pow(max(dot(n, hv), 0.), 70.) * gloss * sun;
  c += vec3(.85, .9, 1.) * pow(1. - max(dot(n, V), 0.), 5.) * .1 * ao;
  float d = length(vWorld - uEye);
  c = mix(c, uFog, smoothstep(uNear, uNear + 60., d) * .55);
  o = vec4(c, 1.);
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
const prog = program(VS, FS);
const u = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);

// ─── meshes: a unit box, a stud ─────────────────────────────────────────────────────────────────
function boxMesh(): number[] {
  const v: number[] = [];
  const faces: Array<[C3, C3, C3]> = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  for (const [n, s, t] of faces) {
    // (s × t = n: wound outward)
    const c = n.map((x) => (x > 0 ? 1 : 0));
    const at = (i: number, j: number) => [0, 1, 2].map((a) => c[a] + s[a] * i + t[a] * j);
    for (const [i, j] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) v.push(...at(i, j), ...n);
  }
  return v;
}
function studMesh(): number[] {
  // a cylinder on the unit cell's top centre (in studs: y from 0 up), its top cap, wound outward
  const v: number[] = [];
  const S = 20;
  for (let i = 0; i < S; i++) {
    const a0 = (i / S) * Math.PI * 2;
    const a1 = ((i + 1) / S) * Math.PI * 2;
    const p = (a: number, y: number) => [0.5 + Math.cos(a) * STUD_R, y, 0.5 + Math.sin(a) * STUD_R];
    const nn = (a: number) => [Math.cos(a), 0, Math.sin(a)];
    const [b0, b1, t0, t1] = [p(a0, 0), p(a1, 0), p(a0, STUD_H), p(a1, STUD_H)];
    v.push(...b0, ...nn(a0), ...t1, ...nn(a1), ...b1, ...nn(a1));
    v.push(...b0, ...nn(a0), ...t0, ...nn(a0), ...t1, ...nn(a1));
    v.push(0.5, STUD_H, 0.5, 0, 1, 0, ...t1, 0, 1, 0, ...t0, 0, 1, 0);
  }
  return v;
}
const STRIDE = 11;
const ATTRS = [['aOff', 3, 0], ['aScale', 3, 3], ['aCol', 4, 6], ['aKind', 1, 10]] as const;
function meshVao(verts: number[], inst: WebGLBuffer) {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const b = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  for (const [name, size, off] of [['aPos', 3, 0], ['aNor', 3, 3]] as const) {
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 24, off * 4);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  for (const [name, size, off] of ATTRS) {
    const loc = gl.getAttribLocation(prog, name);
    if (loc < 0) continue;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4);
    gl.vertexAttribDivisor(loc, 1);
  }
  gl.bindVertexArray(null);
  return { vao, count: verts.length / 6 };
}
const boxInst = gl.createBuffer()!;
const studInst = gl.createBuffer()!;
const ghostBoxInst = gl.createBuffer()!;
const ghostStudInst = gl.createBuffer()!;
const BOX = boxMesh();
const STUD = studMesh();
const box = meshVao(BOX, boxInst);
const stud = meshVao(STUD, studInst);
const ghostBox = meshVao(BOX, ghostBoxInst);
const ghostStud = meshVao(STUD, ghostStudInst);
const skyVao = gl.createVertexArray()!;

// the build's cells, for the light
const occTex = gl.createTexture()!;
gl.bindTexture(gl.TEXTURE_3D, occTex);
gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, N, H, N, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array(N * H * N));

// ─── the build ──────────────────────────────────────────────────────────────────────────────────
let world = new World();
type Act = { add: number } | { take: number; brick: Brick };
let history: Act[] = [];
/** how far a brick still has to come down (it presses on visibly) */
const lift = new Map<number, number>();
let dirty = true;

let size = 7; // 2×4
let turned = false;
let plate = false;
let colour = 4; // red
let taking = false;

function dims(): [number, number, number] {
  const [a, b] = SIZES[size];
  return turned ? [b, a, plate ? 1 : 3] : [a, b, plate ? 1 : 3];
}

interface Saved { bricks: Brick[]; size: number; turned: boolean; plate: boolean; colour: number }
function save() {
  if (auto) return;
  try {
    const s: Saved = { bricks: world.list(), size, turned, plate, colour };
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch { /* (a private window: it still builds, it just won't remember) */ }
}
function load() {
  if (auto) return;
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null') as Saved | null;
    if (!s) {
      document.getElementById('hint')?.classList.add('on');
      return;
    }
    for (const b of s.bricks ?? []) if (world.fits(b.w, b.d, b.h, b.at)) world.add(b);
    size = s.size ?? size;
    turned = !!s.turned;
    plate = !!s.plate;
    colour = s.colour ?? colour;
  } catch { /* */ }
}
function changed() {
  dirty = true;
  const d = new Uint8Array(N * H * N);
  for (let z = 0; z < N; z++) for (let y = 0; y < H; y++) for (let x = 0; x < N; x++) d[x + N * (y + H * z)] = world.at(x, y, z) ? 255 : 0;
  gl.bindTexture(gl.TEXTURE_3D, occTex);
  gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0, N, H, N, gl.RED, gl.UNSIGNED_BYTE, d);
}

// ─── the brick in hand ──────────────────────────────────────────────────────────────────────────
let lastHit: Hit | null = null;
let ghostAt: C3 | null = null;
/** in `take`: the brick under the finger */
let marked = -1;
function aimHit(hit: Hit | null) {
  if (taking) {
    const m = hit && hit.brick >= 0 ? hit.brick : -1;
    if (m !== marked) {
      marked = m;
      if (m >= 0) tick();
    }
    return;
  }
  if (!hit) return;
  const [w, d, h] = dims();
  const at = placeFor(world, w, d, h, hit);
  if (!at) return;
  lastHit = hit;
  if (!ghostAt || at.some((v, i) => v !== ghostAt![i])) {
    ghostAt = at;
    tick();
  }
}
function reaim() {
  const [w, d, h] = dims();
  ghostAt = lastHit ? placeFor(world, w, d, h, lastHit) : null;
  if (!ghostAt) aimHit(raycast(world, [N / 2, H * PLATE + 2, N / 2], [0, -1, 0]));
}
function press() {
  if (taking) return take(marked);
  if (!ghostAt) reaim();
  const [w, d, h] = dims();
  if (!ghostAt || !world.fits(w, d, h, ghostAt) || !world.connects(w, d, h, ghostAt)) return;
  const id = world.add({ w, d, h, colour, at: ghostAt });
  history.push({ add: id });
  lift.set(id, 0.35);
  clickSound(ghostAt[1]);
  changed();
  reaim();
  save();
}
function take(id: number) {
  if (id < 0) return;
  const b = world.remove(id);
  if (!b) return;
  history.push({ take: id, brick: b });
  popSound();
  marked = -1;
  changed();
  save();
}
function undo() {
  const a = history.pop();
  if (!a) return;
  if ('add' in a) world.remove(a.add);
  else world.restore(a.take, a.brick);
  popSound();
  changed();
  reaim();
  save();
}

// ─── the view ───────────────────────────────────────────────────────────────────────────────────
let yaw = -2.25;
let pitch = 0.7;
// (begin close enough to see the studs; pinch out for the whole plate)
let zoom = preview ? 1 : auto ? 1.3 : 1.9;
const look: C3 = [N / 2, 0, N / 2];
function camera() {
  const W = canvas.width;
  const Hh = canvas.height;
  const aspect = W / Hh;
  const fov = 0.62;
  const t = Math.tan(fov / 2);
  // (far enough back that the plate fits across the window, however narrow)
  const fit = Math.max(N * 1.05, (N * 0.62) / (t * aspect));
  const d = fit / zoom;
  const eye: C3 = [
    look[0] + Math.cos(pitch) * Math.cos(yaw) * d,
    look[1] + Math.sin(pitch) * d,
    look[2] + Math.cos(pitch) * Math.sin(yaw) * d,
  ];
  const fwd = normalize(sub(look, eye));
  const right = normalize(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  // (the picture lifted to the middle of what the tray leaves free)
  const shift = trayFrac();
  return { eye, d, fwd, right, up, aspect, fov, shift, vp: viewProj(eye, fwd, right, up, fov, aspect, shift) };
}
let trayPx = 0;
function trayFrac() {
  return innerHeight > 0 ? trayPx / innerHeight : 0;
}
function ray(px: number, py: number): { o: C3; d: C3 } {
  const c = camera();
  const r = canvas.getBoundingClientRect();
  const nx = ((px - r.left) / r.width) * 2 - 1;
  const ny = 1 - ((py - r.top) / r.height) * 2 - c.shift;
  const t = Math.tan(c.fov / 2);
  return { o: c.eye, d: normalize([0, 1, 2].map((a) => c.fwd[a] + c.right[a] * nx * t * c.aspect + c.up[a] * ny * t) as C3) };
}
function hitAt(px: number, py: number): Hit | null {
  const { o, d } = ray(px, py);
  return raycast(world, o, d);
}
function aimAt(px: number, py: number) {
  aimHit(hitAt(px, py));
}
/** Whether a point on the screen is on the brick in hand. */
function onGhost(px: number, py: number): boolean {
  if (!ghostAt) return false;
  const [w, d, h] = dims();
  const { o, d: dir } = ray(px, py);
  const lo = [ghostAt[0] - 0.2, ghostAt[1] * PLATE - 0.2, ghostAt[2] - 0.2];
  const hi = [ghostAt[0] + w + 0.2, (ghostAt[1] + h) * PLATE + 0.4, ghostAt[2] + d + 0.2];
  let t0 = 0;
  let t1 = 1e9;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dir[a]) < 1e-9) {
      if (o[a] < lo[a] || o[a] > hi[a]) return false;
      continue;
    }
    let ta = (lo[a] - o[a]) / dir[a];
    let tb = (hi[a] - o[a]) / dir[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
  }
  return t0 <= t1;
}

// ─── hands ──────────────────────────────────────────────────────────────────────────────────────
const RIDE = 64; // a finger's brick rides this far above it (CSS px)
type Ptr = { x: number; y: number; x0: number; y0: number; t0: number; type: string; moved: boolean; orbit: boolean; button: number; shift: boolean };
const pointers = new Map<number, Ptr>();
let two: { d: number; a: number; x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  wake();
  canvas.setPointerCapture(e.pointerId);
  // (a finger that comes down on the sky turns the view; on the build, it moves the brick)
  const orbit = e.pointerType !== 'mouse' && !hitAt(e.clientX, e.clientY);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), type: e.pointerType, moved: false, orbit, button: e.button, shift: e.shiftKey });
  two = null;
  document.getElementById('hint')?.classList.remove('on');
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) {
    if (e.pointerType === 'mouse') aimAt(e.clientX, e.clientY);
    return;
  }
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 8) p.moved = true;
  p.x = e.clientX;
  p.y = e.clientY;
  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const now = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (two) {
      if (two.d > 0) zoom = clamp(zoom * (now.d / two.d), 0.6, 6);
      let da = now.a - two.a;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      yaw += da;
      slide(now.x - two.x, now.y - two.y);
    }
    two = now;
    for (const q of pointers.values()) q.moved = true;
    return;
  }
  if (p.type === 'mouse') {
    if (!p.moved) return;
    if (p.button === 2 || p.shift) slide(dx, dy);
    else orbit(dx, dy);
  } else if (p.orbit) {
    if (p.moved) orbit(dx, dy);
  } else if (p.moved) {
    aimAt(e.clientX, e.clientY - (taking ? 0 : RIDE));
  }
});
function orbit(dx: number, dy: number) {
  yaw += dx * 0.008;
  pitch = clamp(pitch + dy * 0.006, 0.08, 1.45);
}
/** Slide the view over the plate with the fingers. */
function slide(dx: number, dy: number) {
  const c = camera();
  const k = (2 * Math.tan(c.fov / 2) * c.d) / canvas.getBoundingClientRect().height;
  const f = normalize([c.fwd[0], 0, c.fwd[2]]);
  const r = normalize([c.right[0], 0, c.right[2]]);
  for (let a = 0; a < 3; a += 2) look[a] = clamp(look[a] - r[a] * dx * k + f[a] * dy * k / Math.max(0.3, Math.sin(pitch)), -2, N + 2);
}
canvas.addEventListener('pointerup', (e) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) two = null;
  if (!p || p.moved || p.orbit || performance.now() - p.t0 > 600 || p.button === 2) return;
  // a tap: in `take`, take what's under it; else on the brick in hand, press it on; else send it there
  if (taking) {
    aimAt(e.clientX, e.clientY);
    take(marked);
  } else if (p.type === 'mouse') {
    aimAt(e.clientX, e.clientY);
    press();
  } else if (onGhost(e.clientX, e.clientY)) press();
  else aimAt(e.clientX, e.clientY);
});
canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); two = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0012), 0.6, 6);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'r') turn();
  else if (k === ' ' || k === 'enter') { e.preventDefault(); press(); }
  else if (k === 't') setTaking(!taking);
  else if (k === 'z') undo();
  else if (k === 'p') { plate = !plate; tray(); reaim(); }
});

// ─── the tray ───────────────────────────────────────────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id)!;
function turn() {
  turned = !turned;
  reaim();
  tick(1.5);
  save();
}
function setTaking(on: boolean) {
  taking = on;
  marked = -1;
  document.body.classList.toggle('taking', on);
  tray();
}
function studsSvg(w: number, d: number): string {
  // a little top view of a brick: its studs
  const s = 7;
  const pad = 2;
  let c = '';
  for (let j = 0; j < w; j++) for (let i = 0; i < d; i++) c += `<circle cx="${pad + i * s + s / 2}" cy="${pad + j * s + s / 2}" r="2.3"/>`;
  return `<svg width="${d * s + pad * 2}" height="${w * s + pad * 2}" viewBox="0 0 ${d * s + pad * 2} ${w * s + pad * 2}"><rect x="1" y="1" width="${d * s + pad * 2 - 2}" height="${w * s + pad * 2 - 2}" rx="2"/>${c}</svg>`;
}
function tray() {
  const sizes = $('sizes');
  if (!sizes.childElementCount) {
    SIZES.forEach(([a, b], i) => {
      const el = document.createElement('button');
      el.className = 'size';
      el.innerHTML = `${studsSvg(a, b)}<span>${a}×${b}</span>`;
      el.addEventListener('click', () => { size = i; turned = false; setTaking(false); reaim(); save(); });
      sizes.appendChild(el);
    });
    COLOURS.forEach((c, i) => {
      const el = document.createElement('button');
      el.className = 'swatch';
      el.title = c.name;
      el.style.background = `rgb(${c.rgb.map((v) => Math.round(v * 255)).join(',')})`;
      el.addEventListener('click', () => { colour = i; setTaking(false); save(); });
      $('colours').appendChild(el);
    });
  }
  [...sizes.children].forEach((el, i) => el.classList.toggle('on', i === size));
  [...$('colours').children].forEach((el, i) => el.classList.toggle('on', i === colour));
  $('brick').classList.toggle('on', !plate);
  $('plate').classList.toggle('on', plate);
  $('take').classList.toggle('on', taking);
  $('take').textContent = taking ? 'taking' : 'take';
}
const btn = (id: string, f: () => void) => $(id).addEventListener('click', (e) => { e.stopPropagation(); wake(); f(); tray(); });
btn('brick', () => { plate = false; setTaking(false); reaim(); save(); });
btn('plate', () => { plate = true; setTaking(false); reaim(); save(); });
btn('turn', turn);
btn('set', press);
btn('undo', undo);
btn('take', () => setTaking(!taking));
let clearArmed = 0;
btn('again', () => {
  // (twice, to be sure: a build is a lot to lose)
  const now = performance.now();
  if (now - clearArmed > 3000) {
    clearArmed = now;
    $('again').textContent = 'clear it all?';
    setTimeout(() => { $('again').textContent = 'begin again'; }, 3000);
    return;
  }
  clearArmed = 0;
  $('again').textContent = 'begin again';
  world = new World();
  history = [];
  lift.clear();
  changed();
  reaim();
  save();
});
btn('sound', () => {
  soundOn = !soundOn;
  showSound();
  try { localStorage.setItem(STORE + ':sound', soundOn ? '1' : '0'); } catch { /* */ }
  if (master && ac) master.gain.setTargetAtTime(soundOn ? 1 : 0, ac.currentTime, 0.3);
});

// ─── sound: a click as it presses on, a soft tone, a low drone ──────────────────────────────────
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let space: AudioNode | null = null;
let noise: AudioBuffer | null = null;
let soundOn = (() => { try { return localStorage.getItem(STORE + ':sound') !== '0'; } catch { return true; } })();
function showSound() { $('sound').textContent = soundOn ? 'sound · on' : 'sound · off'; }
showSound();
function wake() {
  if (ac || auto) return;
  try { ac = new AudioContext(); } catch { return; }
  master = ac.createGain();
  master.gain.value = soundOn ? 1 : 0;
  master.connect(ac.destination);
  const delay = ac.createDelay(1);
  delay.delayTime.value = 0.27;
  const fb = ac.createGain();
  fb.gain.value = 0.3;
  const dark = ac.createBiquadFilter();
  dark.type = 'lowpass';
  dark.frequency.value = 1600;
  const wet = ac.createGain();
  wet.gain.value = 0.28;
  delay.connect(dark).connect(fb).connect(delay);
  dark.connect(wet).connect(master);
  const input = ac.createGain();
  input.connect(master);
  input.connect(delay);
  space = input;
  noise = ac.createBuffer(1, ac.sampleRate * 0.05, ac.sampleRate);
  const ch = noise.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.004));
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 300;
  const lfo = ac.createOscillator();
  lfo.frequency.value = 0.05;
  const amt = ac.createGain();
  amt.gain.value = 120;
  lfo.connect(amt).connect(lp.frequency);
  lfo.start();
  const g = ac.createGain();
  g.gain.value = 0;
  g.gain.setTargetAtTime(0.035, ac.currentTime, 3);
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
  env.gain.linearRampToValueAtTime(gain, t + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  for (const [mult, k] of [[1, 1], [2, 0.15]] as const) {
    const o = ac.createOscillator();
    o.frequency.value = freq * mult;
    const og = ac.createGain();
    og.gain.value = k;
    o.connect(og).connect(env);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  env.connect(space);
}
function snap(freq: number, gain: number) {
  if (!ac || !space || !noise) return;
  const s = ac.createBufferSource();
  s.buffer = noise;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 3;
  const g = ac.createGain();
  g.gain.value = gain;
  s.connect(bp).connect(g).connect(space);
  s.start();
}
const SCALE = [0, 2, 4, 7, 9];
const note = (step: number) => 196 * Math.pow(2, (SCALE[((step % 5) + 5) % 5] + 12 * Math.floor(step / 5)) / 12);
let lastTick = 0;
function tick(k = 1) {
  if (!ac) return;
  const now = performance.now();
  if (now - lastTick < 60) return;
  lastTick = now;
  snap(5200, 0.05 * k);
}
function clickSound(y: number) {
  snap(2600, 0.5);
  setTimeout(() => snap(3400, 0.3), 28);
  tone(note(colour + Math.floor(y / 3)), 0.02, 1.4, 0.07);
}
function popSound() {
  snap(1500, 0.35);
  tone(note(colour) / 2, 0, 0.8, 0.04);
}

// ─── drawing ────────────────────────────────────────────────────────────────────────────────────
const SUN = normalize([0.5, 0.86, 0.32]);
const FOG: C3 = [0.91, 0.91, 0.9];
let dpr = 1;
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 1.75) * (preview ? 0.6 : 1);
  const w = Math.round(innerWidth * dpr);
  const h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
addEventListener('resize', resize);

let boxCount = 0;
let studCount = 0;
function rebuild() {
  const bi: number[] = [];
  const si: number[] = [];
  // the baseplate, and its studs where nothing stands
  bi.push(-0.02, -0.32, -0.02, N + 0.04, 0.32, N + 0.04, ...BASE, 1, 3);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) if (!world.at(x, 0, z)) si.push(x, 0, z, 1, 1, 1, ...BASE, 1, 3);
  world.bricks.forEach((b, id) => {
    if (!b) return;
    const l = (lift.get(id) ?? 0) * PLATE * 3;
    const c = COLOURS[b.colour].rgb;
    const y0 = b.at[1] * PLATE + l;
    bi.push(b.at[0] + GAP, y0, b.at[2] + GAP, b.w - GAP * 2, b.h * PLATE - GAP * 0.5, b.d - GAP * 2, ...c, 1, 0);
    const top = b.at[1] + b.h - 1;
    for (let z = 0; z < b.d; z++) for (let x = 0; x < b.w; x++) {
      if (world.studShows(b.at[0] + x, top, b.at[2] + z)) si.push(b.at[0] + x, y0 + b.h * PLATE, b.at[2] + z, 1, 1, 1, ...c, 1, 0);
    }
  });
  gl.bindBuffer(gl.ARRAY_BUFFER, boxInst);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bi), gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, studInst);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(si), gl.DYNAMIC_DRAW);
  boxCount = bi.length / STRIDE;
  studCount = si.length / STRIDE;
}
function ghost(): [number, number] {
  const bi: number[] = [];
  const si: number[] = [];
  if (taking && marked >= 0) {
    const b = world.bricks[marked];
    if (b) {
      // the brick about to be taken: a pale veil over it
      bi.push(b.at[0] - 0.03, b.at[1] * PLATE - 0.03, b.at[2] - 0.03, b.w + 0.06, b.h * PLATE + 0.06, b.d + 0.06, 1, 1, 1, 1, 1);
    }
  } else if (ghostAt && !taking) {
    const [w, d, h] = dims();
    const c = COLOURS[colour].rgb;
    const y0 = ghostAt[1] * PLATE;
    bi.push(ghostAt[0] + GAP, y0, ghostAt[2] + GAP, w - GAP * 2, h * PLATE, d - GAP * 2, ...c, 1, 1);
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) si.push(ghostAt[0] + x, y0 + h * PLATE, ghostAt[2] + z, 1, 1, 1, ...c, 1, 1);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, ghostBoxInst);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bi), gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, ghostStudInst);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(si), gl.DYNAMIC_DRAW);
  return [bi.length / STRIDE, si.length / STRIDE];
}

// the quiet builder (preview)
let builder = town(Number(params.get('seed')) || 21);
let townSeed = Number(params.get('seed')) || 21;
let builderT = 0;
let restT = 0;

let last = performance.now();
let time = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  resize();
  if (auto) {
    yaw += dt * 0.1;
    builderT += dt;
    if (restT > 0) {
      restT -= dt;
      if (restT <= 0) {
        world = new World();
        lift.clear();
        builder = town(++townSeed);
        changed();
      }
    } else {
      while (builderT > 0.12) {
        builderT -= 0.12;
        const n = builder.next();
        if (n.done) { restT = 5; break; }
        const b = n.value;
        if (world.fits(b.w, b.d, b.h, b.at) && world.connects(b.w, b.d, b.h, b.at)) {
          lift.set(world.add(b), 0.5);
          changed();
          break;
        }
      }
    }
  }
  // bricks press on: each eases down the last little way
  for (const [id, l] of lift) {
    const n = Math.max(0, l - Math.max(l * dt * 7, dt * 0.3));
    if (n <= 0) lift.delete(id);
    else lift.set(id, n);
    dirty = true;
  }
  if (dirty) {
    rebuild();
    dirty = false;
  }
  const [gb, gs] = ghost();

  const cam = camera();
  const W = canvas.width;
  const Hh = canvas.height;
  gl.viewport(0, 0, W, Hh);
  gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
  gl.depthMask(true);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.useProgram(skyProg);
  gl.uniform3f(u(skyProg, 'uTop'), 0.72, 0.8, 0.88);
  gl.uniform3f(u(skyProg, 'uLow'), FOG[0], FOG[1], FOG[2]);
  gl.bindVertexArray(skyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  gl.useProgram(prog);
  gl.uniformMatrix4fv(u(prog, 'uVP'), false, cam.vp);
  gl.uniform3fv(u(prog, 'uSun'), SUN);
  gl.uniform3fv(u(prog, 'uEye'), cam.eye);
  gl.uniform3fv(u(prog, 'uFog'), FOG);
  gl.uniform1f(u(prog, 'uTime'), time);
  gl.uniform1f(u(prog, 'uNear'), cam.d);
  gl.uniform1f(u(prog, 'uTop'), world.height() + 1);
  gl.uniform1i(u(prog, 'uOcc'), 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_3D, occTex);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.uniform1f(u(prog, 'uStud'), 0);
  gl.bindVertexArray(box.vao);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, box.count, boxCount);
  gl.uniform1f(u(prog, 'uStud'), 1);
  gl.bindVertexArray(stud.vao);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, stud.count, studCount);
  // the brick in hand (or the veil over one to take): see-through, over the rest
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  gl.uniform1f(u(prog, 'uStud'), 0);
  gl.bindVertexArray(ghostBox.vao);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, ghostBox.count, gb);
  gl.uniform1f(u(prog, 'uStud'), 1);
  gl.bindVertexArray(ghostStud.vao);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, ghostStud.count, gs);
  gl.depthMask(true);
  gl.bindVertexArray(null);
  (window as unknown as { __bricks: unknown }).__bricks = { bricks: world.count(), height: world.height(), ghost: ghostAt, taking, marked };
  requestAnimationFrame(frame);
}

// ─── small maths ────────────────────────────────────────────────────────────────────────────────
function sub(a: C3, b: C3): C3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: C3, b: C3): C3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(a: C3): C3 { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function clamp(v: number, a: number, b: number) { return Math.max(a, Math.min(b, v)); }
function viewProj(eye: C3, f: C3, r: C3, up: C3, fov: number, aspect: number, shift = 0): Float32Array {
  const dot = (a: C3, b: C3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const z: C3 = [-f[0], -f[1], -f[2]];
  const view = [r[0], up[0], z[0], 0, r[1], up[1], z[1], 0, r[2], up[2], z[2], 0, -dot(r, eye), -dot(up, eye), -dot(z, eye), 1];
  const t = 1 / Math.tan(fov / 2);
  const near = 0.2;
  const far = 600;
  const proj = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, -shift, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) out[c * 4 + rr] = proj[rr] * view[c * 4] + proj[4 + rr] * view[c * 4 + 1] + proj[8 + rr] * view[c * 4 + 2] + proj[12 + rr] * view[c * 4 + 3];
  return out;
}

function measureTray() {
  const el = document.getElementById('tray');
  trayPx = !auto && el ? el.getBoundingClientRect().height : 0;
}
addEventListener('resize', measureTray);

resize();
load();
changed();
if (!auto) tray();
measureTray();
reaim();
requestAnimationFrame(frame);

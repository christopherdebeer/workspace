/**
 * Spray: the phone is the can. Hold it like one, aim it with the middle of the screen, and keep a
 * thumb on the glass to spray; the paint stays on the wall in front of you, out in the world.
 *
 * Three ways of knowing where the can points:
 *
 * - `ar` (WebXR, where there is it: Android): the phone is tracked in space and the wall is found —
 *   the first spray lands on a real surface (a wall, the floor, a table), and you can walk about.
 *   The can's distance from the wall is real: near is a thin, dense line that runs if you
 *   linger; far is a soft mist.
 * - `camera` (everywhere else, iPhone among them): the camera's picture behind, and the phone's
 *   gyroscope for which way it points. The paint stays put as you turn, but not as you walk (the
 *   phone isn't tracked in space), and how near the can is comes from the slider under your thumb.
 * - `wall` (no camera, or a desk): a brick wall to paint, aimed with a finger or the mouse.
 *
 * Shake the phone and the can rattles. `?preview` (the lab's index) and `?tag` tag a wall by
 * themselves.
 */
import { seeded, hash } from '../kit/rng';
import { CANS, Painter, add, cross, hitWall, norm, program, scale, sub, wallAhead, wallOn, type V3 } from './paint';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
const auto = preview || params.has('tag');

const canvas = document.getElementById('paint') as HTMLCanvasElement;
const video = document.getElementById('cam') as HTMLVideoElement;
const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, xrCompatible: true } as WebGLContextAttributes)!;
if (!gl) throw new Error('WebGL2 is needed');
if (preview) document.body.classList.add('preview');
const $ = (id: string) => document.getElementById(id)!;

type Mode = 'start' | 'ar' | 'camera' | 'wall';
let mode: Mode = 'start';

// ─── the wall, drawn: its paint, over bricks (the `wall` mode) or over nothing (the camera's) ────
const WALL_VS = `#version 300 es
in vec2 aUV;
uniform mat4 uVP;
uniform vec3 uC, uR, uU;
uniform vec2 uSize;
out vec2 vUV;
out vec3 vW;
void main() {
  vUV = aUV;
  vec3 w = uC + uR * (aUV.x - .5) * uSize.x + uU * (aUV.y - .5) * uSize.y;
  vW = w;
  gl_Position = uVP * vec4(w, 1.);
}`;
const WALL_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vW;
out vec4 o;
uniform sampler2D uPaint;
uniform float uBrick;
uniform vec2 uSize;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
vec3 bricks(vec2 m) {
  // stretcher bond: 215 × 65 mm bricks, 10 mm joints
  vec2 b = vec2(.225, .075);
  float row = floor(m.y / b.y);
  vec2 q = vec2(m.x / b.x + (mod(row, 2.) * .5), m.y / b.y);
  vec2 id = floor(q);
  vec2 f = fract(q) * b;
  float joint = step(f.x, .01) + step(f.y, .01);
  float k = h(id);
  vec3 c = mix(vec3(.52, .24, .17), vec3(.66, .36, .25), k);
  c = mix(c, vec3(.42, .22, .18), step(.86, h(id + 3.)));
  c *= .86 + .2 * n(m * 60.) * n(m * 9. + id);
  vec3 mortar = vec3(.62, .6, .56) * (.85 + .2 * n(m * 80.));
  c = mix(c, mortar, clamp(joint, 0., 1.));
  // grime: darker toward the ground, streaked under the joints
  float grime = smoothstep(1.4, -.2, m.y) * .35 + n(vec2(m.x * 6., m.y * .7)) * .12;
  return c * (1. - grime);
}
void main() {
  vec4 p = texture(uPaint, vUV);
  if (uBrick > .5) {
    vec2 m = vUV * uSize;
    vec3 c = bricks(m);
    // the paint soaks into the brick a little: the mortar lines show through faintly
    vec3 painted = p.rgb + c * (1. - p.a);
    vec2 b = vec2(.225, .075);
    float row = floor(m.y / b.y);
    vec2 f = fract(vec2(m.x / b.x + mod(row, 2.) * .5, m.y / b.y)) * b;
    float joint = clamp(step(f.x, .01) + step(f.y, .01), 0., 1.);
    painted *= 1. - joint * p.a * .25;
    // and the light: a little falloff to the wall's edges
    float light = .78 + .3 * smoothstep(1.2, .1, length((vUV - vec2(.5, .62)) * vec2(1., 1.3)));
    o = vec4(painted * light, 1.);
  } else {
    o = p;
  }
}`;
const wallProg = program(gl, WALL_VS, WALL_FS);
const wallVao = gl.createVertexArray()!;
gl.bindVertexArray(wallVao);
{
  const b = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(wallProg, 'aUV');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
}
gl.bindVertexArray(null);
const u = (n: string) => gl.getUniformLocation(wallProg, n);

let painter = new Painter(gl, wallAhead([0, 0, -1], 1.8, 4, 3));
function drawWall(vp: Float32Array, brick: boolean) {
  const w = painter.wall;
  gl.useProgram(wallProg);
  gl.uniformMatrix4fv(u('uVP'), false, vp);
  gl.uniform3fv(u('uC'), w.centre);
  gl.uniform3fv(u('uR'), w.right);
  gl.uniform3fv(u('uU'), w.up);
  gl.uniform2f(u('uSize'), w.w, w.h);
  gl.uniform1f(u('uBrick'), brick ? 1 : 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, painter.tex);
  gl.uniform1i(u('uPaint'), 0);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(wallVao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
}

// ─── the can ────────────────────────────────────────────────────────────────────────────────────
let can = 3; // red
/** how near the can is held to the wall (m), when that can't be measured */
let near = 0.3;
let spraying = false;
/** in `wall` mode, where on the screen the can points (CSS px) */
const aim = { x: innerWidth / 2, y: innerHeight / 2 };

function caps() {
  const row = $('caps');
  if (!row.childElementCount) {
    CANS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'cap';
      b.title = c.name;
      b.style.setProperty('--c', `rgb(${c.rgb.map((v) => Math.round(v * 255)).join(',')})`);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        can = i;
        rattle(3);
        caps();
      });
      row.appendChild(b);
    });
  }
  [...row.children].forEach((el, i) => el.classList.toggle('on', i === can));
}
const nearEl = $('near') as HTMLInputElement;
nearEl.addEventListener('input', () => {
  near = Number(nearEl.value) / 100;
});
nearEl.value = String(near * 100);

// ─── where the phone points: the gyroscope (camera mode) ────────────────────────────────────────
type Q = [number, number, number, number];
let q: Q = [0, 0, 0, 1];
let qTarget: Q | null = null;
function qMul(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function qRot(a: Q, v: V3): V3 {
  const p = qMul(qMul(a, [v[0], v[1], v[2], 0]), [-a[0], -a[1], -a[2], a[3]]);
  return [p[0], p[1], p[2]];
}
/** The phone's orientation (as the browser gives it) to the camera's: it looks out of its back. */
function fromDevice(alpha: number, beta: number, gamma: number, screenAngle: number): Q {
  const d = Math.PI / 180;
  const [x, y, z] = [beta * d, alpha * d, -gamma * d];
  const [c1, c2, c3] = [Math.cos(x / 2), Math.cos(y / 2), Math.cos(z / 2)];
  const [s1, s2, s3] = [Math.sin(x / 2), Math.sin(y / 2), Math.sin(z / 2)];
  // (Euler YXZ)
  let r: Q = [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
  r = qMul(r, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]);
  const o = (-screenAngle * d) / 2;
  return qMul(r, [0, 0, Math.sin(o), Math.cos(o)]);
}
addEventListener('deviceorientation', (e) => {
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  const angle = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
  qTarget = fromDevice(e.alpha, e.beta, e.gamma, angle);
});
// shaking: the mixing ball rattles in the can
let lastJolt = 0;
let lastAcc: V3 | null = null;
addEventListener('devicemotion', (e) => {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null || a.y == null || a.z == null) return;
  const now: V3 = [a.x, a.y, a.z];
  if (lastAcc) {
    const jolt = Math.hypot(...sub(now, lastAcc));
    if (jolt > 18 && performance.now() - lastJolt > 110) {
      lastJolt = performance.now();
      rattle(1);
    }
  }
  lastAcc = now;
});

// ─── the start: which can ───────────────────────────────────────────────────────────────────────
async function start(m: Mode): Promise<void> {
  wake();
  $('start').classList.add('gone');
  document.body.dataset.mode = m;
  if (m === 'ar') return startAR();
  if (m === 'camera') {
    // (iOS asks for the motion sensors: it has to be in the tap that starts it)
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    const M = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
    try { if (D.requestPermission) await D.requestPermission(); } catch { /* */ }
    try { if (M.requestPermission) await M.requestPermission(); } catch { /* */ }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      video.srcObject = stream;
      await video.play();
    } catch {
      note('no camera: a wall to paint instead');
      return start('wall');
    }
    mode = 'camera';
    placed = false;
  } else {
    mode = 'wall';
    painter.wall = wallAhead([0, 0, -1], 1.5, 2.8, 2.1);
  }
  caps();
  requestAnimationFrame(frame);
}
let placed = false;
/** In camera mode: put the wall where the phone points now (and keep what's painted on it). */
function placeWall() {
  const f = qRot(q, [0, 0, -1]);
  painter.wall = wallAhead(f, 1.6, 6, 4.5, Math.max(-1.2, Math.min(1.2, (f[1] / Math.max(0.2, Math.hypot(f[0], f[2]))) * 1.6)));
  placed = true;
}
$('go-camera').addEventListener('click', () => start('camera'));
$('go-wall').addEventListener('click', () => start('wall'));
$('go-ar').addEventListener('click', () => start('ar'));
const xr = (navigator as unknown as { xr?: { isSessionSupported(m: string): Promise<boolean>; requestSession(m: string, o: unknown): Promise<XRSessionLike> } }).xr;
void xr?.isSessionSupported('immersive-ar').then((ok) => {
  if (ok) $('go-ar').classList.remove('gone');
}).catch(() => { /* */ });
if (!navigator.mediaDevices?.getUserMedia) $('go-camera').classList.add('gone');

// ─── the buttons ────────────────────────────────────────────────────────────────────────────────
$('clear').addEventListener('click', (e) => { e.stopPropagation(); painter.clear(); rattle(2); });
$('rewall').addEventListener('click', (e) => {
  e.stopPropagation();
  if (mode === 'camera') { painter.clear(); placeWall(); }
  if (mode === 'ar') { painter.clear(); arPlaced = false; }
});
let wantPhoto = false;
$('photo').addEventListener('click', (e) => { e.stopPropagation(); wantPhoto = true; });

// ─── hands: a thumb on the glass is a finger on the nozzle ──────────────────────────────────────
const touches = new Map<number, { x: number; y: number }>();
let look: { x: number; y: number } | null = null;
let wallYaw = 0;
let wallPitch = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (mode === 'ar') return; // (the session's own select events spray there)
  if (touches.size >= 2) {
    // two fingers (on the brick wall): look about, don't spray
    spraying = false;
    painter.lift();
    const [a, b] = [...touches.values()];
    look = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return;
  }
  aim.x = e.clientX;
  aim.y = e.clientY;
  spraying = true;
});
canvas.addEventListener('pointermove', (e) => {
  const t = touches.get(e.pointerId);
  if (t) { t.x = e.clientX; t.y = e.clientY; }
  if (touches.size >= 2 && look && mode === 'wall') {
    const [a, b] = [...touches.values()];
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    wallYaw = Math.max(-0.7, Math.min(0.7, wallYaw - (m.x - look.x) * 0.003));
    wallPitch = Math.max(-0.5, Math.min(0.5, wallPitch + (m.y - look.y) * 0.003));
    look = m;
    return;
  }
  if (mode === 'wall' && (spraying || e.pointerType === 'mouse')) {
    aim.x = e.clientX;
    aim.y = e.clientY;
  }
});
const lift = (e: PointerEvent) => {
  touches.delete(e.pointerId);
  if (touches.size < 2) look = null;
  if (touches.size === 0) {
    spraying = false;
    painter.lift();
  }
};
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// ─── sound: the hiss, the rattle ────────────────────────────────────────────────────────────────
let ac: AudioContext | null = null;
let hissGain: GainNode | null = null;
let hissBand: BiquadFilterNode | null = null;
let noise: AudioBuffer | null = null;
function wake() {
  if (ac || auto) return;
  try { ac = new AudioContext(); } catch { return; }
  noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const ch = noise.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1400;
  hissBand = ac.createBiquadFilter();
  hissBand.type = 'peaking';
  hissBand.frequency.value = 4200;
  hissBand.gain.value = 8;
  hissGain = ac.createGain();
  hissGain.gain.value = 0;
  src.connect(hp).connect(hissBand).connect(hissGain).connect(ac.destination);
  src.start();
}
function hiss(on: boolean, dist: number) {
  if (!ac || !hissGain || !hissBand) return;
  hissGain.gain.setTargetAtTime(on ? 0.16 : 0, ac.currentTime, on ? 0.02 : 0.05);
  // (nearer the wall, the spray's sound comes back harder and higher)
  hissBand.frequency.setTargetAtTime(3000 + 3500 * Math.max(0, 1 - dist / 0.8), ac.currentTime, 0.05);
}
/** The mixing ball: a few clacks. */
function rattle(n: number) {
  if (!ac || !noise) return;
  for (let i = 0; i < n; i++) {
    const t = ac.currentTime + i * 0.075 + Math.random() * 0.02;
    const s = ac.createBufferSource();
    s.buffer = noise;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200 + Math.random() * 900;
    bp.Q.value = 9;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    s.connect(bp).connect(g).connect(ac.destination);
    s.start(t, Math.random(), 0.06);
  }
}

// ─── drawing: camera and wall modes ─────────────────────────────────────────────────────────────
let dpr = 1;
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2) * (preview ? 0.6 : 1);
  const w = Math.round(innerWidth * dpr);
  const h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}
addEventListener('resize', resize);
resize();

/** The camera's picture covers the screen: how much of its view is shown, upright (rad). */
function cameraFov(): number {
  const vw = video.videoWidth || 1080;
  const vh = video.videoHeight || 1920;
  // a phone's main camera sees about 66° across its long side (`?fov=` to say otherwise)
  const long = (Number(params.get('fov')) || 66) * (Math.PI / 180);
  const tl = Math.tan(long / 2);
  const tanV = vh >= vw ? tl : tl * (vh / vw);
  const k = Math.max(innerWidth / vw, innerHeight / vh);
  return 2 * Math.atan(tanV * (innerHeight / (vh * k)));
}
function viewProj(eye: V3, fwd: V3, up: V3, fov: number, aspect: number): Float32Array {
  const z = scale(fwd, -1);
  const r = norm(cross(up, z));
  const y = cross(z, r);
  const d = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const view = [r[0], y[0], z[0], 0, r[1], y[1], z[1], 0, r[2], y[2], z[2], 0, -d(r, eye), -d(y, eye), -d(z, eye), 1];
  const t = 1 / Math.tan(fov / 2);
  const near = 0.02;
  const far = 50;
  const proj = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  return mul(proj, view);
}
function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

let last = performance.now();
function frame(now: number) {
  if (mode !== 'camera' && mode !== 'wall') return;
  // (a frame's time can be from just before the page started: never a step backwards)
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  resize();
  const eye: V3 = [0, 0, 0];
  let fwd: V3;
  let up: V3;
  let fov: number;
  let dir: V3;
  if (mode === 'camera') {
    if (qTarget) {
      // (the gyroscope, smoothed a little: steady, not late)
      const t = qTarget;
      const s = q[0] * t[0] + q[1] * t[1] + q[2] * t[2] + q[3] * t[3] < 0 ? -1 : 1;
      const k = 0.55;
      q = [0, 1, 2, 3].map((i) => q[i] + (t[i] * s - q[i]) * k) as Q;
      const l = Math.hypot(...q);
      q = q.map((v) => v / l) as Q;
      if (!placed) placeWall();
    } else if (!placed) placeWall();
    fwd = qRot(q, [0, 0, -1]);
    up = qRot(q, [0, 1, 0]);
    fov = cameraFov();
    dir = fwd;
  } else {
    fwd = norm([Math.sin(wallYaw), Math.sin(wallPitch), -Math.cos(wallYaw)]);
    up = [0, 1, 0];
    fov = 1.05;
    // the can points where the finger (or the mouse) is
    dir = rayAt(aim.x, aim.y, fwd, up, fov);
  }
  const aspect = canvas.width / canvas.height;
  if (auto) autoTag(dt, eye, fwd, up, fov);
  else if (spraying) {
    const dist = painter.spray(eye, dir, CANS[can].rgb, dt, near);
    hiss(dist != null, dist ?? 1);
  } else hiss(false, 1);
  painter.update(dt);
  painter.flush();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, mode === 'wall' ? 1 : 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  drawWall(viewProj(eye, fwd, up, fov, aspect), mode === 'wall');
  if (wantPhoto) {
    wantPhoto = false;
    photo();
  }
  (window as unknown as { __spray: unknown }).__spray = { mode, laid: painter.laid, drips: painter.running, can, near };
  requestAnimationFrame(frame);
}
/** The ray from the eye through a point on the screen. */
function rayAt(px: number, py: number, fwd: V3, up: V3, fov: number): V3 {
  const r = norm(cross(fwd, up));
  const y = cross(r, fwd);
  const t = Math.tan(fov / 2);
  const nx = (px / innerWidth) * 2 - 1;
  const ny = 1 - (py / innerHeight) * 2;
  return norm(add(add(fwd, scale(r, nx * t * (innerWidth / innerHeight))), scale(y, ny * t)));
}

/** A picture of it: the camera's view (as shown) with the paint over it, to keep or share. */
function photo() {
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const g = c.getContext('2d')!;
  if (mode === 'camera' && video.videoWidth) {
    const k = Math.max(c.width / video.videoWidth, c.height / video.videoHeight);
    const w = video.videoWidth * k;
    const h = video.videoHeight * k;
    g.drawImage(video, (c.width - w) / 2, (c.height - h) / 2, w, h);
  }
  g.drawImage(canvas, 0, 0);
  c.toBlob(async (blob) => {
    if (!blob) return;
    const file = new File([blob], `spray-${Date.now()}.png`, { type: 'image/png' });
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file] }); return; } catch { /* (dismissed: fall through to a download) */ }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
  note('saved');
}
function note(text: string) {
  const el = $('note');
  el.textContent = text;
  el.classList.add('on');
  setTimeout(() => el.classList.remove('on'), 1800);
}

// ─── AR (WebXR): the phone tracked in space, the wall a real surface ───────────────────────────
interface XRSessionLike extends EventTarget {
  updateRenderState(s: unknown): void;
  requestReferenceSpace(t: string): Promise<unknown>;
  requestHitTestSource?(o: unknown): Promise<unknown>;
  requestAnimationFrame(cb: (t: number, f: XRFrameLike) => void): number;
  end(): Promise<void>;
  renderState: { baseLayer: { framebuffer: WebGLFramebuffer; getViewport(v: unknown): { x: number; y: number; width: number; height: number } } };
}
interface XRFrameLike {
  getViewerPose(space: unknown): { transform: { position: DOMPointReadOnly; orientation: DOMPointReadOnly }; views: Array<{ projectionMatrix: Float32Array; transform: { inverse: { matrix: Float32Array } } }> } | null;
  getHitTestResults(src: unknown): Array<{ getPose(space: unknown): { transform: { position: DOMPointReadOnly; matrix: Float32Array } } | null }>;
}
let arPlaced = false;
async function startAR(): Promise<void> {
  if (!xr) return start('camera');
  let session: XRSessionLike;
  try {
    session = await xr.requestSession('immersive-ar', {
      requiredFeatures: ['local', 'hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: $('overlay') },
    });
  } catch {
    note('no AR here: the camera instead');
    return start('camera');
  }
  mode = 'ar';
  caps();
  await (gl as unknown as { makeXRCompatible(): Promise<void> }).makeXRCompatible();
  const Layer = (window as unknown as { XRWebGLLayer: new (s: unknown, g: unknown) => unknown }).XRWebGLLayer;
  session.updateRenderState({ baseLayer: new Layer(session, gl) });
  const local = await session.requestReferenceSpace('local');
  const viewer = await session.requestReferenceSpace('viewer');
  const source = session.requestHitTestSource ? await session.requestHitTestSource({ space: viewer }) : null;
  // a thumb on the screen (not on the tray) is the nozzle
  session.addEventListener('selectstart', () => { spraying = true; });
  session.addEventListener('selectend', () => { spraying = false; painter.lift(); });
  // (touches on the tray are the tray's, not the can's)
  $('overlay').addEventListener('beforexrselect', (e) => {
    if ((e.target as HTMLElement).closest('button, input, a')) e.preventDefault();
  });
  session.addEventListener('end', () => location.reload());
  let lastT = 0;
  const onFrame = (t: number, f: XRFrameLike) => {
    session.requestAnimationFrame(onFrame);
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
    lastT = t;
    const pose = f.getViewerPose(local);
    if (!pose) return;
    const p = pose.transform.position;
    const o = pose.transform.orientation;
    const eye: V3 = [p.x, p.y, p.z];
    const rq: Q = [o.x, o.y, o.z, o.w];
    const fwd = qRot(rq, [0, 0, -1]);
    if (spraying) {
      if (!arPlaced) {
        // the first spray finds the wall: the surface the phone points at (or, failing one, a
        // wall a metre and a half ahead)
        const hit = source ? f.getHitTestResults(source)[0]?.getPose(local) : null;
        if (hit) {
          const m = hit.transform.matrix;
          const at: V3 = [m[12], m[13], m[14]];
          painter.wall = wallOn(at, [m[4], m[5], m[6]], eye, 4, 3);
        } else {
          const ahead = wallAhead(fwd, 1.5, 4, 3);
          painter.wall = { ...ahead, centre: add(eye, ahead.centre) };
        }
        arPlaced = true;
      }
      const dist = painter.spray(eye, fwd, CANS[can].rgb, dt);
      hiss(dist != null, dist ?? 1);
      showNear(dist);
    } else {
      hiss(false, 1);
      if (arPlaced) {
        const h = hitWall(painter.wall, eye, fwd);
        showNear(h ? h.t : null);
      }
    }
    painter.update(dt);
    painter.flush();
    const layer = session.renderState.baseLayer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!arPlaced) return;
    for (const v of pose.views) {
      const vp = layer.getViewport(v);
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      drawWall(mul(v.projectionMatrix, v.transform.inverse.matrix), false);
    }
  };
  session.requestAnimationFrame(onFrame);
}
/** In AR, how far the can is from the wall, shown by the reticle. */
function showNear(d: number | null) {
  const el = $('reticle');
  el.style.setProperty('--r', d == null ? '18px' : `${Math.round(8 + Math.min(1.2, d) * 40)}px`);
}

// ─── the quiet tagger (the lab's preview, and `?tag`) ──────────────────────────────────────────
interface Stroke { pts: Array<[number, number]>; colour: number; near: number; speed: number }
let tag: Stroke[] = [];
let tagSeed = Number(params.get('seed')) || 7;
let si = 0;
let sp = 0;
let rest = 0;
/** A tag: letters as loops and slashes, filled fat in one colour, outlined thin in another,
 * a few white glints on top. Points are on the wall (0..1). */
function makeTag(seed: number, span: number): Stroke[] {
  const r = seeded(hash(seed, 0x7a9));
  const letters = 4 + Math.floor(r() * 3);
  // (a piece across most of what's in view — `span`, of the wall's width — at eye height)
  const x0 = 0.5 - span / 2;
  const wl = span / letters;
  const y0 = 0.5 + r() * 0.05;
  const hgt = Math.min(0.16, span * 0.42) * (0.8 + r() * 0.3);
  const fill = [3, 4, 5, 6, 7, 9, 10][Math.floor(r() * 7)];
  const line = r() < 0.7 ? 1 : 8;
  const skeleton: Array<Array<[number, number]>> = [];
  for (let i = 0; i < letters; i++) {
    const cx = x0 + wl * (i + 0.5);
    const tilt = (r() - 0.5) * 0.04;
    // a letter: a few strokes in its box (a stem, a bowl, a cross, a hook)
    const pts: Array<[number, number]> = [];
    const n = 4 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      pts.push([cx + (r() - 0.5) * wl * 0.9 + tilt * k, y0 + (r() - 0.35) * hgt + (k % 2 ? hgt * 0.25 : -hgt * 0.1)]);
    }
    skeleton.push(smooth(pts, 10));
  }
  const out: Stroke[] = [];
  for (const s of skeleton) out.push({ pts: s, colour: fill, near: 0.22, speed: 0.35 });
  for (const s of skeleton) out.push({ pts: s, colour: line, near: 0.08, speed: 0.4 });
  for (const s of skeleton.slice(0, 3)) out.push({ pts: s.slice(0, 4), colour: 0, near: 0.05, speed: 0.3 });
  return out;
}
function smooth(p: Array<[number, number]>, per: number): Array<[number, number]> {
  // (Catmull-Rom through the points)
  const out: Array<[number, number]> = [];
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[Math.max(0, i - 1)];
    const b = p[i];
    const c = p[i + 1];
    const d = p[Math.min(p.length - 1, i + 2)];
    for (let k = 0; k < per; k++) {
      const t = k / per;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (x0: number, x1: number, x2: number, x3: number) => 0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3);
      out.push([f(a[0], b[0], c[0], d[0]), f(a[1], b[1], c[1], d[1])]);
    }
  }
  out.push(p[p.length - 1]);
  return out;
}
function autoTag(dt: number, eye: V3, _fwd: V3, _up: V3, fov: number) {
  // (how much of the wall's width is in view)
  const span = Math.min(0.62, ((2 * 1.5 * Math.tan(fov / 2) * (innerWidth / innerHeight)) / painter.wall.w) * 0.8);
  if (!tag.length) tag = makeTag(tagSeed, span);
  if (si >= tag.length) {
    rest += dt;
    if (rest > 5) {
      rest = 0;
      si = 0;
      sp = 0;
      tag = makeTag(++tagSeed, span);
      painter.clear();
    }
    return;
  }
  const s = tag[si];
  // along the stroke at its speed (wall-widths a second)
  sp += (dt * s.speed) / segLen(s.pts) * (s.pts.length - 1);
  const i = Math.min(s.pts.length - 1, Math.floor(sp));
  const p = s.pts[i];
  const w = painter.wall;
  const target = add(add(w.centre, scale(w.right, (p[0] - 0.5) * w.w)), scale(w.up, (p[1] - 0.5) * w.h));
  painter.spray(eye, norm(sub(target, eye)), CANS[s.colour].rgb, dt, s.near);
  if (sp >= s.pts.length - 1) {
    si++;
    sp = 0;
    painter.lift();
  }
}
function segLen(pts: Array<[number, number]>) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return Math.max(l, 1e-3);
}

// in the index (and `?tag`, `?wall`): straight onto the brick wall
if (auto || params.has('wall')) start('wall');

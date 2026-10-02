/**
 * Botanical plate: one plant from a seed, grown before your eyes and drawn as an engraving you can
 * turn in your hand.
 *
 * Two kinds of thing are drawn (plant.ts): blades — a leaf's or petal's surface, opaque paper that
 * hides what is behind it, hatched in its own space (the strokes follow it, herringbone from the
 * midrib like its veins, crossed where it turns from the light; petals left pale) — and lines,
 * through the lab's pencil (kit/pencil.ts): a stem a paper body with two contours and a few strokes
 * on its shaded side, everything finer a single line as heavy as it is thick. The light is fixed
 * in the world, so as the plant turns its leaves darken and pale.
 *
 * Drag to turn it, pinch (or the wheel) to come closer; left alone it turns slowly. The seed is in
 * the address (`?seed=412`); `?preview` draws it small and quiet (the lab's index).
 */
import { PENCIL } from '../kit/pencil';
import { grow, grownAt, lineAt, type Specimen, type V3 } from './plant';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
let seed = Number(params.get('seed')) || Math.floor(Math.random() * 9000) + 1;

const canvas = document.getElementById('plate') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: true })!;
if (!gl) throw new Error('WebGL2 is needed to draw this plate');

// ─── shaders ─────────────────────────────────────────────────────────────────────────────────────
const COMMON = `
const vec3 PAPER = vec3(.945, .935, .905);
const vec3 GRAPHITE = vec3(.17, .165, .16);
float th(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float tn(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(th(i), th(i + vec2(1., 0.)), u.x), mix(th(i + vec2(0., 1.)), th(i + vec2(1., 1.)), u.x), u.y); }
// the paper's tooth: graphite catches on its high points (fixed to the sheet)
float tooth() { vec2 p = gl_FragCoord.xy; return .55 + .45 * smoothstep(.2, .8, tn(p * .6) * .6 + tn(p * 1.8 + 7.) * .4); }
`;

const BLADE_VS = `#version 300 es
in vec3 aPos;
in vec4 aUV; // along (m), across (m, signed), kind (0 leaf, 1 petal), u (0 base … 1 tip)
uniform mat4 uVP;
out vec3 vWorld;
out vec4 vUV;
void main() { vWorld = aPos; vUV = aUV; gl_Position = uVP * vec4(aPos, 1.); }`;

const BLADE_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec4 vUV;
out vec4 o;
uniform vec3 uLight, uEye;
${COMMON}
// one family of hatching in the blade's own space: lines q/sp apart, broken here and there
float hatchLines(float q, float sp, float seed) {
  float x = q / sp;
  float row = floor(x);
  float on = smoothstep(.3, .45, tn(vec2(row * .37 + seed, vUV.x * 60.)));
  return (1. - smoothstep(.12, .3, abs(fract(x) - .5))) * on;
}
void main() {
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(N, uEye - vWorld) < 0.) N = -N;
  float lit = max(0., dot(N, uLight));
  // how dark: turned from the light, the underside (seen from below the blade), towards the base
  float dark = .75 * (1. - lit) + (gl_FrontFacing ? 0. : .25) + .12 * (1. - vUV.w);
  if (vUV.z > .5) dark = (.15 + .5 * (1. - lit)) * smoothstep(.55, .05, vUV.w);
  // herringbone, as the veins run: out from the midrib and forward
  float a = vUV.x * .55 + abs(vUV.y) * .85;
  float b = vUV.x * .85 - abs(vUV.y) * .5;
  float sp = .0012;
  float m = hatchLines(a, sp, 1.) * smoothstep(.18, .45, dark);
  m = max(m, hatchLines(b, sp * 1.1, 7.) * smoothstep(.55, .8, dark));
  // (too fine to draw as lines at this size: a light tone instead)
  float px = sp / max(fwidth(a), 1e-6);
  m = mix(dark * .45, m * (.55 + .45 * dark), smoothstep(1.6, 3., px));
  o = vec4(mix(PAPER, GRAPHITE, clamp(m * .85, 0., 1.) * tooth()), 1.);
}`;

const LINE_VS = `#version 300 es
in vec3 aA;
in vec3 aB;
in vec2 aW;
in vec3 aS; // its stroke, how far along it (m), its kind
uniform mat4 uVP;
uniform vec2 uRes;
uniform float uFocal;
out vec2 vP;
flat out vec2 vA2;
flat out vec2 vB2;
flat out vec2 vWpx;
flat out vec3 vS;
flat out float vLen;
void main() {
  vec4 ca = uVP * vec4(aA, 1.), cb = uVP * vec4(aB, 1.);
  if (ca.w < .01 || cb.w < .01) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vec2 sa = (ca.xy / ca.w * .5 + .5) * uRes, sb = (cb.xy / cb.w * .5 + .5) * uRes;
  float pa = aW.x * uFocal / ca.w, pb = aW.y * uFocal / cb.w;
  vec2 d = sb - sa;
  float L = length(d);
  vec2 dir = L > 1e-4 ? d / L : vec2(1., 0.);
  vec2 n = vec2(-dir.y, dir.x);
  float e = max(pa, pb) * .5 + 1.5;
  int c = gl_VertexID;
  bool first = c == 0 || c == 2;
  vec2 p = (first ? sa - dir * e : sb + dir * e) + n * (c < 2 ? -e : e);
  // (a hair nearer than it is: a leaf's own outline and veins lie on it, not under it)
  float z = (first ? ca.z / ca.w : cb.z / cb.w) - .0015;
  gl_Position = vec4(p / uRes * 2. - 1., z, 1.);
  vP = p;
  vA2 = sa;
  vB2 = sb;
  vWpx = vec2(pa, pb);
  vS = aS;
  vLen = length(aB - aA);
}`;

const LINE_FS = `#version 300 es
precision highp float;
in vec2 vP;
flat in vec2 vA2;
flat in vec2 vB2;
flat in vec2 vWpx;
flat in vec3 vS;
flat in float vLen;
out vec4 o;
${COMMON}
${PENCIL}
void main() {
  vec2 pa = vP - vA2, ba = vB2 - vA2;
  float bb = max(dot(ba, ba), 1e-6);
  float hRaw = dot(pa, ba) / bb;
  float h = clamp(hRaw, 0., 1.);
  float d = length(pa - ba * h);
  float w = mix(vWpx.x, vWpx.y, h);
  // (a plant is small: the hand's pressure and drift change over centimetres, not metres)
  float s = (vS.y + h * vLen) * 10.;
  float id = vS.x;
  float kind = vS.z;
  if (w >= 3. && kind < .5) {
    // a stem: its body paper (it hides what is behind it), its two contours (each side its own
    // hand), and a few strokes along its shaded side
    if (hRaw < -.1 || hRaw > 1.1) discard;
    float dl = length(pa - ba * hRaw);
    float body = clamp(w * .5 - dl + .5, 0., 1.);
    if (body <= 0.) discard;
    vec2 nn = normalize(vec2(-ba.y, ba.x) + 1e-6);
    if (nn.x < 0.) nn = -nn;
    float side = dot(pa - ba * hRaw, nn) / max(w * .5, .5);
    float sid = side > 0. ? id : id + 101.;
    float edge = strokeLine(w * .5 - dl - .6 + strokeDrift(s, sid) * .9, .45) * strokePress(s, sid);
    float lane = side * w * .5 / 2.2;
    float lanes = (1. - smoothstep(.12, .3, abs(fract(lane) - .5))) * smoothstep(.4, .6, pN(s * 3., floor(lane) + id)) * smoothstep(.1, .6, side) * smoothstep(.97, .8, abs(side));
    float mk = max(edge * .85, lanes * .4) * tooth();
    o = vec4(mix(PAPER, GRAPHITE, mk) * body, body);
    return;
  }
  // everything finer: one line, as heavy as it is thick (a hairline a tenth of a pixel wide is a
  // tenth as dark), the hand pressing and lifting along it
  if (hRaw < 0. || hRaw > 1.) discard;
  float wt = kind < .5 ? .85 : kind < 1.5 ? .55 : kind < 2.5 ? .75 : kind < 3.5 ? .45 : .6;
  float line = strokeLine(d + strokeDrift(s, id) * .7, w * .5) * pow(clamp(w * 1.4, .12, 1.), .8);
  float mk = clamp(line * strokePress(s, id) * wt * tooth(), 0., 1.);
  if (mk < .004) discard;
  o = vec4(GRAPHITE * mk, mk);
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
const bladeProg = program(BLADE_VS, BLADE_FS);
const lineProg = program(LINE_VS, LINE_FS);
const u = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);

// ─── geometry: the specimen at growth T, into buffers ────────────────────────────────────────────
const bladeVao = gl.createVertexArray()!;
const bladeBuf = gl.createBuffer()!;
let bladeCount = 0;
const lineVao = gl.createVertexArray()!;
const lineBuf = gl.createBuffer()!;
let lineCount = 0;

gl.bindVertexArray(bladeVao);
gl.bindBuffer(gl.ARRAY_BUFFER, bladeBuf);
for (const [name, size, off] of [['aPos', 3, 0], ['aUV', 4, 3]] as const) {
  const loc = gl.getAttribLocation(bladeProg, name);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 7 * 4, off * 4);
}
gl.bindVertexArray(lineVao);
gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
for (const [name, size, off] of [['aA', 3, 0], ['aB', 3, 3], ['aW', 2, 6], ['aS', 3, 8]] as const) {
  const loc = gl.getAttribLocation(lineProg, name);
  if (loc < 0) continue;
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 11 * 4, off * 4);
  gl.vertexAttribDivisor(loc, 1);
}
gl.bindVertexArray(null);

const scaleAbout = (o: V3, p: V3, k: number): V3 => [o[0] + (p[0] - o[0]) * k, o[1] + (p[1] - o[1]) * k, o[2] + (p[2] - o[2]) * k];

function upload(sp: Specimen, T: number) {
  // blades: two quads a row (left to middle, middle to right), scaled about the base as it unfolds
  const bv: number[] = [];
  for (const b of sp.blades) {
    const g = grownAt(b.t0, b.t1, T);
    if (g <= 0.01) continue;
    const K = b.rows.length - 1;
    let along = 0;
    const vert = (p: V3, a: number, across: number, k: number) => {
      const q = scaleAbout(b.base, p, g);
      bv.push(q[0], q[1], q[2], a, across, b.kind, k / K);
    };
    for (let k = 0; k < K; k++) {
      const r0 = b.rows[k];
      const r1 = b.rows[k + 1];
      const step = Math.hypot(r1.m[0] - r0.m[0], r1.m[1] - r0.m[1], r1.m[2] - r0.m[2]);
      const a0 = along;
      const a1 = along + step;
      const w = (r: typeof r0) => Math.hypot(r.r[0] - r.m[0], r.r[1] - r.m[1], r.r[2] - r.m[2]);
      const q: Array<[V3, number, number, number]> = [
        [r0.l, a0, -w(r0), k], [r0.m, a0, 0, k], [r1.l, a1, -w(r1), k + 1],
        [r0.m, a0, 0, k], [r1.m, a1, 0, k + 1], [r1.l, a1, -w(r1), k + 1],
        [r0.m, a0, 0, k], [r0.r, a0, w(r0), k], [r1.m, a1, 0, k + 1],
        [r0.r, a0, w(r0), k], [r1.r, a1, w(r1), k + 1], [r1.m, a1, 0, k + 1],
      ];
      for (const [p, a, c, kk] of q) vert(p, a, c, kk);
      along = a1;
    }
  }
  bladeCount = bv.length / 7;
  gl.bindBuffer(gl.ARRAY_BUFFER, bladeBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bv), gl.DYNAMIC_DRAW);
  // lines
  const lv: number[] = [];
  for (const l of sp.lines) {
    const at = lineAt(l, T);
    if (!at) continue;
    lv.push(at.a[0], at.a[1], at.a[2], at.b[0], at.b[1], at.b[2], at.wa, at.wb, l.stroke, l.arc, l.kind);
  }
  // the ground: a light broken ellipse round the stem's foot, where the soil was
  const R = sp.reach * 0.35;
  for (let k = 0; k < 28; k++) {
    if (k % 3 === 2) continue;
    const a0 = (k / 28) * Math.PI * 2;
    const a1 = ((k + 1) / 28) * Math.PI * 2;
    lv.push(Math.cos(a0) * R, 0, Math.sin(a0) * R, Math.cos(a1) * R, 0, Math.sin(a1) * R, 0.0004, 0.0004, 9000 + k, 0, 4);
  }
  lineCount = lv.length / 11;
  gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lv), gl.DYNAMIC_DRAW);
}

// ─── the view: turned in the hand ───────────────────────────────────────────────────────────────
let yaw = 0.6;
let pitch = 0.12;
let zoom = 1;
let idle = 0;
const pointers = new Map<number, { x: number; y: number }>();
let pinch = 0;
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  idle = 0;
  if (pointers.size === 1) {
    yaw += (e.clientX - p.x) * 0.008;
    pitch = Math.max(-0.7, Math.min(0.9, pitch + (e.clientY - p.y) * 0.006));
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) zoom = Math.max(0.6, Math.min(5, zoom * (d / pinch)));
    pinch = d;
  }
  p.x = e.clientX;
  p.y = e.clientY;
});
const up = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  pinch = 0;
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom = Math.max(0.6, Math.min(5, zoom * Math.exp(-e.deltaY * 0.0015)));
}, { passive: false });

function mat(eye: V3, target: V3, fovY: number, aspect: number): Float32Array {
  const f: V3 = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const fl = Math.hypot(...f);
  const z: V3 = [-f[0] / fl, -f[1] / fl, -f[2] / fl];
  let x: V3 = [z[2], 0, -z[0]];
  const xl = Math.hypot(...x) || 1;
  x = [x[0] / xl, x[1] / xl, x[2] / xl];
  const y: V3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const view = [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  const t = 1 / Math.tan(fovY / 2);
  const near = 0.01;
  const far = 20;
  const proj = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = proj[r] * view[c * 4] + proj[4 + r] * view[c * 4 + 1] + proj[8 + r] * view[c * 4 + 2] + proj[12 + r] * view[c * 4 + 3];
  return out;
}

// ─── the plate ──────────────────────────────────────────────────────────────────────────────────
let sp: Specimen = grow(seed);
let T = 0;
let uploadedT = -1;
const label = document.getElementById('label');
const plateNo = document.getElementById('no');
function caption() {
  if (label) label.innerHTML = `<i>${sp.name}</i><span>${sp.note}</span>`;
  if (plateNo) plateNo.textContent = `Pl. ${seed}`;
}
caption();
function specimen(next: number) {
  seed = next;
  sp = grow(seed);
  T = 0;
  uploadedT = -1;
  const url = new URL(location.href);
  url.searchParams.set('seed', String(seed));
  history.replaceState(null, '', url);
  caption();
}
document.getElementById('another')?.addEventListener('click', () => specimen(Math.floor(Math.random() * 9000) + 1));
document.getElementById('again')?.addEventListener('click', () => {
  T = 0;
  uploadedT = -1;
});

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2) * (preview ? 0.6 : 1);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
}
resize();
addEventListener('resize', resize);
if (preview) document.body.classList.add('preview');

const LIGHT: V3 = (() => {
  const v: V3 = [-0.5, 0.75, 0.45];
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
})();
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // it grows over about ten seconds; left alone, it turns slowly
  T = Math.min(1, T + dt / 10);
  idle += dt;
  if (idle > 2.5) yaw += dt * 0.15;
  if (Math.abs(T - uploadedT) > 0.002 || (T >= 1 && uploadedT < 1)) {
    upload(sp, T);
    uploadedT = T;
  }
  const W = canvas.width;
  const H = canvas.height;
  gl.viewport(0, 0, W, H);
  gl.clearColor(0.945, 0.935, 0.905, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  // the frame: the whole specimen, roots to flowers, with a margin (closer as you pinch)
  const aspect = W / H;
  const fov = 0.5;
  const top = sp.height;
  const bottom = -sp.depth;
  const target: V3 = [0, (top + bottom) / 2, 0];
  // (within the sheet between its commands above and its caption below)
  const dpr = W / innerWidth;
  const mTop = preview ? 0 : 52 * dpr;
  const mBot = preview ? 0 : 100 * dpr;
  const room = (H - mTop - mBot) / H;
  const tall = ((top - bottom) * 0.5 * 1.1) / room;
  const wide = sp.reach * 1.12;
  const fit = Math.max(tall, wide / aspect) / Math.tan(fov / 2);
  const r = fit / zoom;
  // (and lifted so it sits in that room, not behind the caption)
  target[1] -= ((mBot - mTop) / 2 / H) * 2 * r * Math.tan(fov / 2);
  const eye: V3 = [target[0] + Math.cos(yaw) * Math.cos(pitch) * r, target[1] + Math.sin(pitch) * r, target[2] + Math.sin(yaw) * Math.cos(pitch) * r];
  const vp = mat(eye, target, fov, aspect);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  // blades: opaque paper, both sides, laying down depth
  gl.useProgram(bladeProg);
  gl.uniformMatrix4fv(u(bladeProg, 'uVP'), false, vp);
  gl.uniform3fv(u(bladeProg, 'uLight'), LIGHT);
  gl.uniform3fv(u(bladeProg, 'uEye'), eye);
  gl.depthMask(true);
  gl.bindVertexArray(bladeVao);
  gl.drawArrays(gl.TRIANGLES, 0, bladeCount);
  // lines: over them, tested against them, not hiding one another
  gl.useProgram(lineProg);
  gl.uniformMatrix4fv(u(lineProg, 'uVP'), false, vp);
  gl.uniform2f(u(lineProg, 'uRes'), W, H);
  gl.uniform1f(u(lineProg, 'uFocal'), (H / 2) / Math.tan(fov / 2));
  gl.depthMask(false);
  gl.bindVertexArray(lineVao);
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lineCount);
  gl.bindVertexArray(null);
  (window as unknown as { __plate: unknown }).__plate = { seed, T: Math.round(T * 100) / 100, name: sp.name, blades: bladeCount / 12, lines: lineCount };
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

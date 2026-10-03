/**
 * Hat-throwers: a macro timelapse of a pin mould's day, from a seed. A patch of dung at a few
 * centimetres; a night and a morning in under a minute: stalks rise clear as glass, bead with
 * water, swell a vesicle under a black cap, and — those that throw — shoot the cap off toward the
 * light and slump.
 *
 * Drawn as a macro lens sees it: the stalks are glass (they bend what's behind them, and glow with
 * the light behind), the droplets are lenses (each a little upside-down picture of the patch, a
 * glint, a dark rim), and the depth of field is a few millimetres, so the glints behind and in
 * front bloom into discs. Tap anything to pull focus to it; drag to move round; pinch to come
 * closer. The scrubber is the day.
 *
 * Passes: the opaque patch (ground, beads, caps) → a copy → the stalks, refracting it → a copy →
 * the droplets, refracting that → depth of field (a scatter-as-gather disc, from depth) → tone.
 */
import { DAY, along, beads, patch, species, state, type Genome, type Stalk, type V3 } from './genome';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
let seed = Number(params.get('seed')) || Math.floor(Math.random() * 9000) + 1;

const canvas = document.getElementById('macro') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false })!;
if (!gl) throw new Error('WebGL2 is needed');
if (preview) document.body.classList.add('preview');
const hdr = !!gl.getExtension('EXT_color_buffer_float');

// ─── shaders ────────────────────────────────────────────────────────────────────────────────────
const COMMON = `
uniform vec3 uLight, uEye, uLightCol, uSky;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
// the studio: a soft bright window where the light is, dark all round
vec3 env(vec3 r) {
  float w = smoothstep(.55, .97, dot(r, uLight));
  return mix(uSky * (.25 + .35 * max(r.y, 0.)), uLightCol * 3., w);
}
`;

// the ground: a wet, lumpy plane (displaced here, from the same noise as its shading)
const GROUND_VS = `#version 300 es
in vec2 aXZ;
uniform mat4 uVP;
out vec3 vW;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
void main() {
  vec2 p = aXZ;
  float y = (n2(p * .18) - .5) * 1.4 + (n2(p * .6 + 7.) - .5) * .5 - smoothstep(20., 70., length(p)) * 3.;
  vW = vec3(p.x, y, p.y);
  gl_Position = uVP * vec4(vW, 1.);
}`;
const GROUND_FS = `#version 300 es
precision highp float;
in vec3 vW;
out vec4 o;
uniform vec3 uGround;
${COMMON}
void main() {
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  if (n.y < 0.) n = -n;
  vec3 v = normalize(uEye - vW);
  // dung: dark, fibrous, flecked; wet in its hollows
  float fib = n2(vW.xz * vec2(2.2, .5) + n2(vW.xz * .3) * 4.);
  float fleck = smoothstep(.75, .9, n2(vW.xz * 1.7 + 3.));
  vec3 c = uGround * (.55 + .8 * fib) + vec3(.12, .08, .03) * fleck;
  float wet = smoothstep(.35, .65, n2(vW.xz * .35 + 11.));
  float diff = .35 + .65 * max(dot(n, uLight), 0.);
  vec3 col = c * diff * uLightCol;
  vec3 r = reflect(-v, n);
  float f = .04 + .96 * pow(1. - max(dot(n, v), 0.), 5.);
  col += env(r) * f * mix(.25, 1., wet);
  col += uLightCol * pow(max(dot(r, uLight), 0.), 80.) * 4. * wet;
  o = vec4(col, 1.);
}`;

// spheres (caps, beads, droplets): instanced, scaled to ellipsoids
const SPHERE_VS = `#version 300 es
in vec3 aP;
in vec3 aC;
in vec3 aR;
in vec4 aCol;
uniform mat4 uVP;
uniform float uFocal;
out vec3 vW;
out vec3 vN;
out vec4 vCol;
out float vPx;
void main() {
  vec3 w = aC + aP * aR;
  vW = w;
  vN = normalize(aP / aR);
  vCol = aCol;
  vec4 c = uVP * vec4(w, 1.);
  vPx = aR.x * uFocal / c.w;
  gl_Position = c;
}`;
// opaque: the caps (glossy black), the beads (glossy orange, a little light inside)
const SOLID_FS = `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vN;
in vec4 vCol;
out vec4 o;
${COMMON}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uEye - vW);
  vec3 r = reflect(-v, n);
  float f = .04 + .96 * pow(1. - max(dot(n, v), 0.), 5.);
  float diff = .3 + .7 * max(dot(n, uLight), 0.);
  // (a bead's flesh glows where the light comes through it)
  float through = pow(max(dot(-v, uLight), 0.), 2.) * vCol.a;
  vec3 col = vCol.rgb * (diff + through * 1.5) * uLightCol;
  col += env(r) * f;
  col += uLightCol * pow(max(dot(r, uLight), 0.), 120.) * 6.;
  o = vec4(col, 1.);
}`;
// see-through: the droplets, lenses on the stalks — what's behind, upside down, a glint, a rim
const DROP_FS = `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vN;
in vec4 vCol;
in float vPx;
out vec4 o;
uniform sampler2D uBehind;
uniform vec2 uRes;
uniform mat4 uView;
${COMMON}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uEye - vW);
  float nv = max(dot(n, v), 0.);
  vec3 nvw = (uView * vec4(n, 0.)).xyz;
  vec2 uv = gl_FragCoord.xy / uRes;
  // a ball lens: the patch behind it, flipped and shrunk into it
  vec3 behind = texture(uBehind, clamp(uv - nvw.xy * vPx * 1.6 / uRes, 0., 1.)).rgb;
  vec3 col = behind * vec3(.95, 1., .97) * (.75 + .5 * nv);
  // its rim goes dark (light bent away), and the studio window glints in it
  col *= smoothstep(.05, .45, nv);
  vec3 r = reflect(-v, n);
  float f = .02 + .98 * pow(1. - nv, 5.);
  col += env(r) * f * 1.2;
  col += uLightCol * pow(max(dot(r, uLight), 0.), 300.) * 14.;
  // (and the caustic: the light it gathers, a bright spot on its far side)
  col += uLightCol * pow(max(dot(-n, uLight), 0.), 24.) * .8;
  o = vec4(col, 1.);
}`;

// the stalks: a tube along each stalk's curve (the same sums as genome.ts' along())
const STALK_VS = `#version 300 es
in vec2 aUA;      // along (0..1), round (rad)
in vec3 aBase;
in vec4 aDir;     // dir.xz, lean, sag
in vec4 aShape;   // length now, foot radius, vesicle radius now, its length to width
in vec4 aMore;    // knob radius, wave, phase, slump
in vec4 aLook;    // yellow length, ripe, -, -
uniform mat4 uVP;
out vec3 vW;
out vec3 vN;
out float vU;
flat out vec4 vLook;
flat out float vSlump;
float radiusAt(float u) {
  float L = max(aShape.x, 1e-3);
  float r = aShape.y * (1. + .6 * exp(-u * 25.)) * (1. - .25 * u);
  if (aShape.z > 0.) {
    float half_ = min(.45, aShape.z * aShape.w / L);
    float x = (u - (1. - half_)) / half_;
    if (x > -1.) r = max(r, aShape.z * sqrt(max(0., 1. - x * x)));
  }
  if (aMore.x > 0.) {
    float half_ = min(.3, aMore.x / L);
    float x = (u - (1. - half_)) / half_;
    if (x > -1.) r = max(r, aMore.x * sqrt(max(0., 1. - x * x)));
  }
  return r;
}
void main() {
  float u = aUA.x;
  float L = aShape.x;
  float lean = aDir.z, sag = aDir.w;
  vec2 dir = aDir.xy;
  vec2 side = vec2(-dir.y, dir.x);
  float w = aMore.y * sin(u * 3. + aMore.z) * u;
  vec3 p = aBase + vec3(dir.x * lean * .5 * u * u + side.x * w * .12, u - sag * u * u, dir.y * lean * .5 * u * u + side.y * w * .12) * L;
  vec3 t = normalize(vec3(dir.x * lean * u, 1. - 2. * sag * u, dir.y * lean * u));
  vec3 s3 = vec3(side.x, 0., side.y);
  vec3 a = normalize(cross(t, s3));
  vec3 b = cross(t, a);
  float r = radiusAt(u);
  // (the normal leans with the radius as it changes: the vesicle's shoulders face up and down)
  float dr = (radiusAt(min(1., u + .01)) - radiusAt(max(0., u - .01))) / (.02 * max(L, 1e-3));
  vec3 ring = a * cos(aUA.y) + b * sin(aUA.y);
  vN = normalize(ring - t * dr);
  vW = p + ring * r;
  vU = u;
  vLook = aLook;
  vSlump = aMore.w;
  gl_Position = uVP * vec4(vW, 1.);
}`;
const STALK_FS = `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vN;
in float vU;
flat in vec4 vLook;
flat in float vSlump;
out vec4 o;
uniform sampler2D uBehind;
uniform vec2 uRes;
uniform mat4 uView;
uniform vec3 uGlass, uTip;
uniform float uThrows;
${COMMON}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uEye - vW);
  if (dot(n, v) < 0.) n = -n;
  float nv = max(dot(n, v), 0.);
  vec3 nvw = (uView * vec4(n, 0.)).xyz;
  vec2 uv = gl_FragCoord.xy / uRes;
  // glass: what's behind, bent a little toward its edges
  vec3 behind = texture(uBehind, clamp(uv - nvw.xy * (1. - nv) * 18. / uRes, 0., 1.)).rgb;
  // its yellow: the top (a knob all yellow; a thrower's yellow at the vesicle's foot, the
  // vesicle itself paler, clear)
  float top = smoothstep(1. - vLook.x - .03, 1. - vLook.x + .02, vU);
  float yellow = uThrows > .5 ? top * (1. - smoothstep(.0, .06, vU - (1. - vLook.x * .55))) + top * .12 : top;
  vec3 tint = mix(uGlass, uTip, clamp(yellow, 0., 1.));
  // slumped and spent: dull, grey-brown
  tint = mix(tint, vec3(.55, .5, .38), vSlump * .7);
  vec3 col = behind * tint * (.75 + .3 * nv);
  // light through it: it glows with the light behind, and its body scatters some of it
  float through = pow(max(dot(-v, uLight), 0.), 2.);
  col += tint * uLightCol * (.1 + 1.1 * through) * (.2 + .8 * pow(1. - nv, 1.5)) * (.5 + yellow * .9);
  // (and milky: the stalk's own body scatters, so it reads pale against the dark)
  col += tint * (.05 + .1 * (1. - nv)) * (1. - vSlump * .5);
  vec3 r = reflect(-v, n);
  float f = .03 + .97 * pow(1. - nv, 4.);
  col += env(r) * f * .9;
  col += uLightCol * pow(max(dot(r, uLight), 0.), 160.) * 6.;
  o = vec4(col, 1.);
}`;

// depth of field: each pixel gathers from a disc as wide as its own blur, and takes a sample only
// if that sample's own blur reaches it (so a sharp thing isn't smeared over by a blurred one
// behind, but a blurred one in front is spread over it)
const QUAD_VS = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); gl_Position = vec4(p, 0., 1.); }`;
const DOF_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uCol;
uniform sampler2D uDepth;
uniform vec2 uRes;
uniform float uFocus, uK, uMax, uNear, uFar, uTime, uFade, uExposure;
float dist(vec2 uv) {
  float z = texture(uDepth, uv).r * 2. - 1.;
  return 2. * uNear * uFar / (uFar + uNear - z * (uFar - uNear));
}
float coc(float d) { return clamp(uK * abs(d - uFocus) / d, 0., uMax); }
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 px = 1. / uRes;
  vec2 uv = gl_FragCoord.xy * px;
  float cd = dist(uv);
  float cs = coc(cd);
  vec3 col = texture(uCol, uv).rgb;
  float tot = 1.;
  float rad = 1.;
  float ang = h(gl_FragCoord.xy) * 6.28;
  for (int i = 0; i < 180; i++) {
    if (rad >= uMax) break;
    vec2 tc = uv + vec2(cos(ang), sin(ang)) * px * rad;
    vec3 sc = texture(uCol, tc).rgb;
    float sd = dist(tc);
    float ss = coc(sd);
    if (sd > cd) ss = clamp(ss, 0., cs * 2.);
    float m = smoothstep(rad - .5, rad + .5, ss);
    col += mix(col / tot, sc, m);
    tot += 1.;
    rad += 1.1 / rad;
    ang += 2.39996;
  }
  col /= tot;
  col *= uExposure;
  // tone: a filmic shoulder, a little lift in the shadows toward green, the lens's vignette
  col = col * (2.51 * col + .03) / (col * (2.43 * col + .59) + .14);
  col = mix(vec3(.03, .04, .025), vec3(1.), col);
  vec2 q = uv - .5;
  col *= 1. - dot(q, q) * .9;
  col += (h(gl_FragCoord.xy + uTime) - .5) * .025;
  o = vec4(col * uFade, 1.);
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
const groundProg = program(GROUND_VS, GROUND_FS);
const solidProg = program(SPHERE_VS, SOLID_FS);
const dropProg = program(SPHERE_VS, DROP_FS);
const stalkProg = program(STALK_VS, STALK_FS);
const dofProg = program(QUAD_VS, DOF_FS);
const U = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
const u = (p: WebGLProgram, n: string) => {
  let m = U.get(p);
  if (!m) U.set(p, (m = new Map()));
  if (!m.has(n)) m.set(n, gl.getUniformLocation(p, n));
  return m.get(n)!;
};

// ─── meshes ─────────────────────────────────────────────────────────────────────────────────────
function attribs(prog: WebGLProgram, list: Array<[string, number]>, stride: number, divisor: number) {
  let off = 0;
  for (const [name, size] of list) {
    const loc = gl.getAttribLocation(prog, name);
    if (loc >= 0) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, off * 4);
      gl.vertexAttribDivisor(loc, divisor);
    }
    off += size;
  }
}
// the ground: a disc of grid, finer near the middle
const groundVao = gl.createVertexArray()!;
let groundCount = 0;
{
  gl.bindVertexArray(groundVao);
  const v: number[] = [];
  const R = 70;
  const n = 140;
  const at = (i: number, j: number) => {
    const x = (i / n) * 2 - 1;
    const z = (j / n) * 2 - 1;
    // (squeezed toward the middle: detail where the stalks stand)
    const k = (a: number) => Math.sign(a) * Math.pow(Math.abs(a), 1.6) * R;
    return [k(x), k(z)];
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    v.push(...at(i, j), ...at(i + 1, j), ...at(i + 1, j + 1), ...at(i, j), ...at(i + 1, j + 1), ...at(i, j + 1));
  }
  const b = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  attribs(groundProg, [['aXZ', 2]], 2, 0);
  groundCount = v.length / 2;
}
// a sphere (lat-long)
const sphereVerts: number[] = [];
{
  const la = 14;
  const lo = 22;
  const p = (i: number, j: number) => {
    const t = (i / la) * Math.PI;
    const f = (j / lo) * Math.PI * 2;
    return [Math.sin(t) * Math.cos(f), Math.cos(t), Math.sin(t) * Math.sin(f)];
  };
  for (let i = 0; i < la; i++) for (let j = 0; j < lo; j++) {
    sphereVerts.push(...p(i, j), ...p(i + 1, j), ...p(i + 1, j + 1), ...p(i, j), ...p(i + 1, j + 1), ...p(i, j + 1));
  }
}
const SPH = 10; // per instance: centre 3, radii 3, colour 4
function sphereVao(prog: WebGLProgram) {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const b = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sphereVerts), gl.STATIC_DRAW);
  attribs(prog, [['aP', 3]], 3, 0);
  const inst = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  attribs(prog, [['aC', 3], ['aR', 3], ['aCol', 4]], SPH, 1);
  gl.bindVertexArray(null);
  return { vao, inst, count: sphereVerts.length / 3 };
}
const solids = sphereVao(solidProg);
const drops = sphereVao(dropProg);
// the stalk's tube
const ST = 19; // per instance: base 3, dir 4, shape 4, more 4, look 4
const stalkVao = gl.createVertexArray()!;
const stalkInst = gl.createBuffer()!;
let tubeCount = 0;
{
  gl.bindVertexArray(stalkVao);
  const v: number[] = [];
  const rings = 40;
  const segs = 14;
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a0 = (j / segs) * Math.PI * 2;
    const a1 = ((j + 1) / segs) * Math.PI * 2;
    // (rings closer together toward the top, where the vesicle is)
    const s = (k: number) => 1 - Math.pow(1 - k / rings, 1.5);
    const [u0, u1] = [s(i), s(i + 1)];
    v.push(u0, a0, u1, a0, u1, a1, u0, a0, u1, a1, u0, a1);
  }
  const b = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  attribs(stalkProg, [['aUA', 2]], 2, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, stalkInst);
  attribs(stalkProg, [['aBase', 3], ['aDir', 4], ['aShape', 4], ['aMore', 4], ['aLook', 4]], ST, 1);
  tubeCount = v.length / 2;
  gl.bindVertexArray(null);
}
const quadVao = gl.createVertexArray()!;

// ─── targets: the scene (colour + depth), and a copy of its colour to see through ───────────────
let W = 0;
let Hh = 0;
let sceneFbo: WebGLFramebuffer | null = null;
let sceneTex: WebGLTexture | null = null;
let depthTex: WebGLTexture | null = null;
let copyFbo: WebGLFramebuffer | null = null;
let copyTex: WebGLTexture | null = null;
function colourTex(w: number, h: number) {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, hdr ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function targets(w: number, h: number) {
  if (w === W && h === Hh) return;
  W = w;
  Hh = h;
  for (const t of [sceneTex, depthTex, copyTex]) if (t) gl.deleteTexture(t);
  sceneTex = colourTex(w, h);
  copyTex = colourTex(w, h);
  depthTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, depthTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  sceneFbo = sceneFbo ?? gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
  copyFbo = copyFbo ?? gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, copyFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, copyTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
function copyScene() {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sceneFbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, copyFbo);
  gl.blitFramebuffer(0, 0, W, Hh, 0, 0, W, Hh, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
}

// ─── the specimen ───────────────────────────────────────────────────────────────────────────────
let g: Genome;
let stalks: Stalk[];
let ground: Array<{ p: V3; r: number; flat: number }>;
function grow(s: number) {
  seed = s;
  g = species(seed);
  stalks = patch(seed, g);
  ground = beads(seed, g);
  T = 0;
  focusAt = null;
  const url = new URL(location.href);
  url.searchParams.set('seed', String(seed));
  if (!preview) history.replaceState(null, '', url);
  label();
}
function label() {
  const el = document.getElementById('label');
  if (!el) return;
  const what = g.throws
    ? `throws its sporangia · ${g.vesicle > 0.8 ? 'a great vesicle' : 'a vesicle'} · ${g.height[1].toFixed(0)} mm`
    : `a pin mould · yellow-headed · ${g.height[1].toFixed(0)} mm`;
  el.innerHTML = `<i>${g.name}</i><span>${what}</span>`;
}

// ─── the day ────────────────────────────────────────────────────────────────────────────────────
/** hour of the day (0 .. DAY), and how fast the timelapse runs (hours a second) */
let T = 0;
let playing = true;
const RATE = DAY / (preview ? 40 : 55);
const scrub = document.getElementById('scrub') as HTMLInputElement | null;
scrub?.addEventListener('input', () => {
  T = (Number(scrub.value) / 1000) * DAY;
});

// ─── the view ───────────────────────────────────────────────────────────────────────────────────
let yaw = 0.4;
let pitch = 0.36;
let zoom = 1;
let focus = 30;
/** a stalk to hold focus on (a tap), and until when */
let focusAt: { stalk: number; until: number } | null = null;
let autoFocus = 0;
const FOV = 0.55;
function camera(t: number) {
  const aspect = W / Hh;
  const mid = (g.height[0] + g.height[1]) / 2;
  const look: V3 = [0, mid * 0.55, 0];
  // (far enough back to see the patch across, closer on a narrow screen than the sums would say:
  // a macro lens is about the near things)
  const d = (mid * 2.3 + 4) / zoom / Math.min(1.2, Math.max(0.75, aspect * 1.4));
  const y = yaw + Math.sin(t * 0.05) * 0.15;
  const eye: V3 = [look[0] + Math.cos(pitch) * Math.cos(y) * d, look[1] + Math.sin(pitch) * d, look[2] + Math.cos(pitch) * Math.sin(y) * d];
  const f = norm3(sub3(look, eye));
  const r = norm3(cross3(f, [0, 1, 0]));
  const up = cross3(r, f);
  const near = 1;
  const far = 400;
  const tt = 1 / Math.tan(FOV / 2);
  const view = new Float32Array([r[0], up[0], -f[0], 0, r[1], up[1], -f[1], 0, r[2], up[2], -f[2], 0, -dot3(r, eye), -dot3(up, eye), dot3(f, eye), 1]);
  const proj = [tt / aspect, 0, 0, 0, 0, tt, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  return { eye, f, r, up, view, vp: mul(proj, view), near, far, aspect, focal: (Hh / 2) * tt };
}

// ─── drawing ────────────────────────────────────────────────────────────────────────────────────
let last = performance.now();
let time = 0;
let fade = 0;
let slow = 1 / 60;
let budget = 520000;
function frame(now: number) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  time += dt;
  // the scene's size: about two thirds of a megapixel, whatever the screen
  const css = [innerWidth, innerHeight];
  // (and less if the frames come slowly: the depth of field is the costly part)
  slow = slow * 0.95 + dt * 0.05;
  if (time > 2 && slow > 1 / 28) budget = Math.max(150000, budget * 0.98);
  else if (time > 2 && slow < 1 / 50) budget = Math.min(700000, budget * 1.005);
  const k = Math.min(Math.min(devicePixelRatio || 1, 2), Math.sqrt((preview ? 160000 : budget) / (css[0] * css[1])));
  const w = Math.max(64, Math.round(css[0] * k));
  const h = Math.max(64, Math.round(css[1] * k));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  targets(w, h);
  if (playing) T += dt * RATE;
  // the day ends: fade, and it begins again
  if (T > DAY + 1.5) T = 0;
  fade = Math.min(1, T < 0.6 ? T / 0.6 : T > DAY + 0.8 ? Math.max(0, (DAY + 1.5 - T) / 0.7) : 1);
  if (scrub && document.activeElement !== scrub) scrub.value = String(Math.round((Math.min(T, DAY) / DAY) * 1000));
  clock();

  const cam = camera(time);
  pullFocus(cam, dt);
  const L = g.light;
  const warm = g.warmth;
  const lightCol: V3 = [1, 0.9 + 0.08 * (1 - warm), 0.75 + 0.2 * (1 - warm)];
  const sky: V3 = [0.5, 0.6, 0.42];

  // the instances: caps and beads (solid), droplets (lenses), stalks (glass)
  const solid: number[] = [];
  const dew: number[] = [];
  const tubes: number[] = [];
  for (const b of ground) solid.push(...b.p, b.r, b.r * b.flat, b.r, ...g.bead, 1);
  stalks.forEach((st) => {
    const s = state(st, T);
    if (s.grown <= 0.001) return;
    const Lnow = st.len * s.grown;
    const v = st.ves * s.swell * (1 - s.slump * 0.85);
    const knob = st.knob ? st.r * 2.1 * Math.min(1, s.grown * 1.5) : 0;
    tubes.push(...st.base, st.dir[0], st.dir[1], st.lean + s.slump * 1.6, s.slump * 0.9, Lnow, st.r, v, st.long, knob, st.wave, st.phase, s.slump, g.tipLength, s.ripe, 0, 0);
    const top = along(st, s, 1);
    // its cap: grows dark as it ripens; thrown, it flies off toward the light and is gone
    if (st.cap > 0 && s.ripe > 0) {
      const cr = st.cap * (0.35 + 0.65 * s.ripe);
      let c: V3 = [top.p[0] + top.t[0] * cr * g.capFlat * 0.7, top.p[1] + top.t[1] * cr * g.capFlat * 0.7, top.p[2] + top.t[2] * cr * g.capFlat * 0.7];
      let show = true;
      if (s.thrown >= 0) {
        const f = s.thrown / 0.08;
        if (f > 1) show = false;
        else c = [c[0] + st.fly[0] * f * f * 60, c[1] + st.fly[1] * f * f * 60, c[2] + st.fly[2] * f * f * 60];
      }
      const col = mixV(g.tip, g.capColour, s.ripe);
      if (show) solid.push(...c, cr, cr * g.capFlat, cr, ...col, 0);
    }
    // its droplets: bead as it grows; those on the vesicle go when it bursts (and spray out)
    for (const d of st.dew) {
      if (T < d.t || d.s > s.grown + 0.02) continue;
      if (s.thrown >= 0 && d.s > 0.86) continue;
      const rr = d.r * Math.min(1, (T - d.t) / 1.2);
      const at = along(st, s, Math.min(d.s, 0.999));
      const a = ringAt(at.t, st.dir, d.a);
      const off = at.r + rr * 0.55;
      dew.push(at.p[0] + a[0] * off, at.p[1] + a[1] * off, at.p[2] + a[2] * off, rr, rr * 0.92, rr, 1, 1, 1, 1);
    }
    if (s.thrown >= 0 && s.thrown < 0.15) {
      // (the burst: a spray of what was on the vesicle, flung out)
      const f = s.thrown / 0.15;
      for (let k2 = 0; k2 < 7; k2++) {
        const a = (k2 / 7) * Math.PI * 2 + st.phase;
        const dir: V3 = [Math.cos(a) * 0.8 + st.fly[0], 0.6 + st.fly[1] * 0.5, Math.sin(a) * 0.8 + st.fly[2]];
        const rr = g.dewSize * 0.6 * (1 - f);
        dew.push(top.p[0] + dir[0] * f * 9, top.p[1] + dir[1] * f * 9 - f * f * 6, top.p[2] + dir[2] * f * 9, rr, rr, rr, 1, 1, 1, 1);
      }
    }
  });

  // 1. the opaque patch
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
  gl.viewport(0, 0, W, Hh);
  gl.clearColor(0.08, 0.1, 0.055, 1);
  gl.clearDepth(1);
  gl.depthMask(true);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const common = (p: WebGLProgram) => {
    gl.useProgram(p);
    gl.uniformMatrix4fv(u(p, 'uVP'), false, cam.vp);
    gl.uniform3fv(u(p, 'uLight'), L);
    gl.uniform3fv(u(p, 'uEye'), cam.eye);
    gl.uniform3fv(u(p, 'uLightCol'), lightCol);
    gl.uniform3fv(u(p, 'uSky'), sky);
  };
  common(groundProg);
  gl.uniform3fv(u(groundProg, 'uGround'), g.ground);
  gl.bindVertexArray(groundVao);
  gl.drawArrays(gl.TRIANGLES, 0, groundCount);
  common(solidProg);
  gl.uniform1f(u(solidProg, 'uFocal'), cam.focal);
  gl.bindVertexArray(solids.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, solids.inst);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(solid), gl.STREAM_DRAW);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, solids.count, solid.length / SPH);
  // 2. the stalks, seeing through to it
  copyScene();
  common(stalkProg);
  gl.uniformMatrix4fv(u(stalkProg, 'uView'), false, cam.view);
  gl.uniform2f(u(stalkProg, 'uRes'), W, Hh);
  gl.uniform3fv(u(stalkProg, 'uGlass'), g.glass);
  gl.uniform3fv(u(stalkProg, 'uTip'), g.tip);
  gl.uniform1f(u(stalkProg, 'uThrows'), g.throws ? 1 : 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, copyTex);
  gl.uniform1i(u(stalkProg, 'uBehind'), 0);
  gl.bindVertexArray(stalkVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, stalkInst);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tubes), gl.STREAM_DRAW);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, tubeCount, tubes.length / ST);
  // 3. the droplets, seeing through to all of that
  copyScene();
  common(dropProg);
  gl.uniform1f(u(dropProg, 'uFocal'), cam.focal);
  gl.uniformMatrix4fv(u(dropProg, 'uView'), false, cam.view);
  gl.uniform2f(u(dropProg, 'uRes'), W, Hh);
  gl.bindTexture(gl.TEXTURE_2D, copyTex);
  gl.uniform1i(u(dropProg, 'uBehind'), 0);
  gl.bindVertexArray(drops.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, drops.inst);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(dew), gl.STREAM_DRAW);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, drops.count, dew.length / SPH);
  // 4. through the lens
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, W, Hh);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(dofProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.uniform1i(u(dofProg, 'uCol'), 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, depthTex);
  gl.uniform1i(u(dofProg, 'uDepth'), 1);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform2f(u(dofProg, 'uRes'), W, Hh);
  gl.uniform1f(u(dofProg, 'uFocus'), focus);
  // (the blur: wide open, a macro lens's few millimetres of sharpness)
  const maxBlur = Math.round(Hh * 0.022);
  gl.uniform1f(u(dofProg, 'uK'), maxBlur * 2.2);
  gl.uniform1f(u(dofProg, 'uMax'), maxBlur);
  gl.uniform1f(u(dofProg, 'uNear'), cam.near);
  gl.uniform1f(u(dofProg, 'uFar'), cam.far);
  gl.uniform1f(u(dofProg, 'uTime'), time % 100);
  gl.uniform1f(u(dofProg, 'uFade'), fade);
  gl.uniform1f(u(dofProg, 'uExposure'), 1.35);
  gl.bindVertexArray(quadVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
  (window as unknown as { __fungi: unknown }).__fungi = { seed, name: g.name, T: Math.round(T * 100) / 100, stalks: tubes.length / ST, drops: dew.length / SPH, focus: Math.round(focus * 10) / 10 };
  requestAnimationFrame(frame);
}
/** A droplet's place round the stalk: angle a about its tangent. */
function ringAt(t: V3, dir: [number, number], a: number): V3 {
  const side: V3 = [-dir[1], 0, dir[0]];
  const x = norm3(cross3(t, side));
  const y = cross3(t, x);
  return [x[0] * Math.cos(a) + y[0] * Math.sin(a), x[1] * Math.cos(a) + y[1] * Math.sin(a), x[2] * Math.cos(a) + y[2] * Math.sin(a)];
}

// ─── focus: pulled slowly from stalk to stalk, as a cameraman would; a tap pulls it there ────────
function pullFocus(cam: ReturnType<typeof camera>, dt: number) {
  let target: number | null = null;
  if (focusAt && time < focusAt.until) target = distTo(cam, stalks[focusAt.stalk]);
  else {
    focusAt = null;
    autoFocus -= dt;
    if (autoFocus <= 0 || subject < 0) {
      // the next subject: a stalk that's up, near the middle of the picture, at a good distance
      subject = chooseSubject(cam);
      autoFocus = 6 + Math.random() * 4;
    }
    if (subject >= 0) target = distTo(cam, stalks[subject]);
  }
  if (target != null) focus += (target - focus) * Math.min(1, dt * 1.6);
}
let subject = -1;
function topOf(st: Stalk): V3 {
  const s = state(st, T);
  return along(st, s, Math.max(0.5, Math.min(1, s.grown)) * 0.92).p;
}
function distTo(cam: ReturnType<typeof camera>, st: Stalk): number {
  const p = topOf(st);
  return Math.max(cam.near * 2, dot3(sub3(p, cam.eye), cam.f));
}
function chooseSubject(cam: ReturnType<typeof camera>): number {
  let best = -1;
  let score = -1e9;
  stalks.forEach((st, i) => {
    const s = state(st, T);
    if (s.grown < 0.3) return;
    const p = topOf(st);
    const d = sub3(p, cam.eye);
    const z = dot3(d, cam.f);
    if (z <= 0) return;
    const x = dot3(d, cam.r) / z;
    const y = dot3(d, cam.up) / z;
    const sc = -Math.hypot(x * 2, y * 2.5) + s.swell * 0.4 + s.ripe * 0.2 + Math.random() * 0.35 - Math.abs(z - focus) * 0.004;
    if (sc > score) {
      score = sc;
      best = i;
    }
  });
  return best;
}
/** A tap: the stalk nearest the ray through it gets the focus. */
function tapFocus(px: number, py: number) {
  const cam = camera(time);
  const nx = (px / innerWidth) * 2 - 1;
  const ny = 1 - (py / innerHeight) * 2;
  const tt = Math.tan(FOV / 2);
  const dir = norm3([0, 1, 2].map((a) => cam.f[a] + cam.r[a] * nx * tt * cam.aspect + cam.up[a] * ny * tt) as V3);
  let best = -1;
  let bd = 1e9;
  stalks.forEach((st, i) => {
    const s = state(st, T);
    if (s.grown < 0.1) return;
    for (const uu of [0.3, 0.6, 0.9, 1]) {
      const p = along(st, s, uu).p;
      const d = sub3(p, cam.eye);
      const t = dot3(d, dir);
      if (t <= 0) continue;
      const off = Math.hypot(d[0] - dir[0] * t, d[1] - dir[1] * t, d[2] - dir[2] * t) / t;
      if (off < bd) {
        bd = off;
        best = i;
      }
    }
  });
  if (best >= 0 && bd < 0.08) focusAt = { stalk: best, until: time + 12 };
}

// ─── hands ──────────────────────────────────────────────────────────────────────────────────────
const pts = new Map<number, { x: number; y: number; x0: number; y0: number; moved: boolean }>();
let pinch = 0;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false });
  pinch = 0;
});
canvas.addEventListener('pointermove', (e) => {
  const p = pts.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  if (Math.hypot(p.x - p.x0, p.y - p.y0) > 6) p.moved = true;
  if (pts.size === 2) {
    const [a, b] = [...pts.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch) zoom = Math.max(0.7, Math.min(4, zoom * (d / pinch)));
    pinch = d;
    return;
  }
  yaw += dx * 0.006;
  pitch = Math.max(0.04, Math.min(0.9, pitch + dy * 0.004));
});
canvas.addEventListener('pointerup', (e) => {
  const p = pts.get(e.pointerId);
  pts.delete(e.pointerId);
  pinch = 0;
  if (p && !p.moved) tapFocus(e.clientX, e.clientY);
});
canvas.addEventListener('pointercancel', (e) => pts.delete(e.pointerId));
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom = Math.max(0.7, Math.min(4, zoom * Math.exp(-e.deltaY * 0.0012)));
}, { passive: false });
document.getElementById('another')?.addEventListener('click', () => grow(Math.floor(Math.random() * 9000) + 1));
document.getElementById('play')?.addEventListener('click', (e) => {
  playing = !playing;
  (e.currentTarget as HTMLElement).textContent = playing ? 'pause' : 'play';
});
function clock() {
  const el = document.getElementById('clock');
  if (!el) return;
  const t = Math.min(T, DAY);
  // (the day starts at nine in the evening: they fruit overnight, and throw in the late morning)
  const hour = (21 + t) % 24;
  el.textContent = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
}

// ─── small maths ────────────────────────────────────────────────────────────────────────────────
function sub3(a: V3, b: V3): V3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot3(a: V3, b: V3) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a: V3, b: V3): V3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm3(a: V3): V3 { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function mixV(a: V3, b: V3, t: number): V3 { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}

grow(seed);
// (`?t=` starts at that hour)
if (params.get('t')) T = Number(params.get('t'));
requestAnimationFrame(frame);

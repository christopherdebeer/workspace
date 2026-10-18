/**
 * Drawing the labyrinth (WebGL2): the stone from a low sun, with its shadows (a shadow map), the sky's light over it and
 * the stone's own shutting-in (ao, baked per vertex); then over it, in ink, its edges and creases, found from where the
 * depth folds or the surface turns. In **print**, the light's drawn as a lithograph's: hatched, cross-hatched where it's
 * darker, on paper.
 *
 * Everything rises as it's built: each vertex knows when it was built and the height it grows from, and the vertex
 * shader draws it that far grown.
 */
import { LEVELS, N } from './model';
const H = 1;
import { MARGIN, STRIDE, type Mesh } from './mesh';

export interface View { az: number; el: number; zoom: number; target: [number, number, number] }

const COMMON = `#version 300 es
precision highp float;
uniform float uTime;
// (how far grown: none before it's built, eased out over 0.9 s)
float grown(float born) { float t = clamp((uTime - born) / 0.9, 0., 1.); return 1. - pow(1. - t, 3.); }
`;
const VS = COMMON + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aAoMat; layout(location=3) in vec3 aRise; layout(location=4) in float aTone;
uniform mat4 uVP, uLight;
out vec3 vPos, vNrm; out float vAo, vMat, vTone; out vec4 vLs;
void main() {
  float s = grown(aRise.x);
  vec3 p = vec3(aPos.x, aRise.y + (aPos.y - aRise.y) * s, aPos.z);
  vPos = p; vNrm = aNrm; vAo = aAoMat.x; vMat = aAoMat.y; vTone = aTone; vLs = uLight * vec4(p, 1.);
  gl_Position = s <= 0. ? vec4(2., 2., 2., 1.) : uVP * vec4(p, 1.);
}`;
const FS = COMMON + `
in vec3 vPos, vNrm; in float vAo, vMat, vTone; in vec4 vLs;
uniform sampler2D uShadow; uniform vec3 uSun, uEye, uDir; uniform float uN, uShadows;
layout(location=0) out vec4 oCol; layout(location=1) out vec4 oNrm;
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p) { return .5 * noise(p) + .25 * noise(p * 2.1) + .125 * noise(p * 4.3) + .125 * noise(p * 8.7); }
// (travertine: cream, banded as it was laid down, pitted with its little pores, each block a shade of its own)
vec3 travertine(vec3 p, float tone) {
  vec3 c = vec3(.86, .82, .74) * (.95 + .08 * tone);
  float band = fbm(vec3(p.x * .7, p.y * 7., p.z * .7) + tone * 9.);
  c *= 1. - .07 * smoothstep(.5, .75, band);
  c = mix(c, vec3(.80, .70, .56), .25 * smoothstep(.62, .8, fbm(vec3(p.x * 1.6, p.y * 14., p.z * 1.6) + 3.)));
  float pore = noise(vec3(p.x * 13., p.y * 30., p.z * 13.) + tone * 17.);
  c *= 1. - .32 * smoothstep(.8, .9, pore);
  float pit = noise(p * 41. + tone * 5.);
  c *= 1. - .22 * smoothstep(.86, .93, pit);
  return c * (.97 + .05 * noise(p * 90.));
}
void main() {
  vec3 n = normalize(vNrm);
  int mat = int(vMat + .5);
  vec3 base; float spec = 0., wrap = 0.;
  if (mat == 2) base = vec3(.13, .25, .25);
  else if (mat == 3) { base = mix(vec3(.10, .17, .08), vec3(.20, .27, .12), fbm(vPos * 7.)); wrap = .35; }
  else if (mat == 4) base = vec3(.32, .24, .17);
  else if (mat == 7) base = vec3(.90, .89, .86) * (.98 + .03 * noise(vPos * 3.));
  else if (mat == 6) base = travertine(vPos, .6) * .9;
  else if (mat == 5) base = travertine(vPos * .8 + 11., .5) * 1.03;
  else if (mat == 8) {
    // (a courtyard's paving: travertine flags, half a cell each, their joints)
    vec2 f = fract(vPos.xz * 2. + uN), g = min(f, 1. - f);
    base = travertine(vPos * 1.3 + 5., fract(floor(vPos.x * 2.) * .37 + floor(vPos.z * 2.) * .61)) * 1.02;
    base *= 1. - .16 * (1. - smoothstep(.0, .045, min(g.x, g.y)));
  }
  else {
    base = travertine(vPos, vTone);
    // (dressed stone, laid in courses: a joint every third of a level, the upright joints staggered course to course;
    // on a top, a joint at each cell's edge. Not on what's curved)
    if (mat == 0) {
      float jt;
      if (abs(n.y) < .5) {
        float u = abs(n.x) > .5 ? vPos.z : vPos.x, cy = vPos.y * 3., course = floor(cy);
        float hy = min(fract(cy), 1. - fract(cy)) / 3., ux = fract((u + course * .43 + vTone) / .62), hu = min(ux, 1. - ux) * .62;
        jt = min(hy, hu);
      } else { vec2 f = fract(vPos.xz + uN * .5), g = min(f, 1. - f); jt = min(g.x, g.y); }
      base *= 1. - .14 * (1. - smoothstep(.004, .016 + .006 * noise(vPos * 31.), jt));
    }
  }
  // (the sun, and its shadows: soft, a few taps round where this is in its map)
  vec3 ls = vLs.xyz / vLs.w * .5 + .5;
  float sh = 0., bias = .0012 + .0025 * (1. - abs(dot(n, uSun)));
  for (int a = -2; a <= 2; a++) for (int b = -2; b <= 2; b++) sh += step(ls.z - bias, texture(uShadow, ls.xy + vec2(a, b) * 1.3 / 2048.).r);
  // (out past the sun's map: lit)
  if (any(lessThan(ls, vec3(0.))) || any(greaterThan(ls, vec3(1.)))) sh = 25.;
  sh = mix(1., sh / 25., uShadows);
  // (and the leaves of a tree out of the picture, between the sun and one side of it, stirring)
  vec2 lp = vLs.xy / vLs.w;
  float leafy = fbm(vec3(lp * vec2(9., 11.), uTime * .05));
  float leaves = smoothstep(.48, .6, leafy) * smoothstep(-.35, -.85, lp.x * .75 - lp.y * .45);
  sh *= 1. - .38 * leaves * (1. - smoothstep(uN * .5, uN * .5 + 3., max(abs(vPos.x), abs(vPos.z))));
  float nl = dot(n, uSun), key = max((nl + wrap) / (1. + wrap), 0.) * sh;
  vec3 sun = vec3(1.0, .86, .68) * 1.05, sky = mix(vec3(.50, .43, .36), vec3(.62, .62, .64), n.y * .5 + .5);
  vec3 c = base * (sky * (.25 + .45 * vAo) + sun * key * (.65 + .35 * vAo));
  // (light gathers in the archways)
  if (mat == 1) c += base * vec3(1., .7, .4) * .42 * (.4 + .6 * vAo);
  if (mat == 2) {
    // (water: dark, the sky and the sun on it, a little stirred)
    vec3 w = normalize(vec3(.06 * (noise(vec3(vPos.xz * 6., uTime * .4)) - .5), 1., .06 * (noise(vec3(vPos.zx * 6., uTime * .4 + 3.)) - .5)));
    vec3 v = -normalize(uDir), r = reflect(-v, w);
    float fr = .08 + .9 * pow(1. - max(dot(w, v), 0.), 4.);
    c = mix(base * (.5 + .5 * sh), vec3(.86, .84, .8), fr * .7) + vec3(1., .9, .75) * pow(max(dot(reflect(-uSun, w), v), 0.), 120.) * 2. * sh;
  }
  // (a filmic shoulder, warm)
  c = c / (c + .7) * 1.62;
  c = pow(c, vec3(1.03, 1.04, 1.07));
  oCol = vec4(c, 1.);
  oNrm = vec4(n * .5 + .5, 1.);
}`;
const SHADOW_FS = `#version 300 es
precision highp float; out vec4 o; void main() { o = vec4(1.); }`;
const POST_VS = `#version 300 es
out vec2 vUv; void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); vUv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;
const POST_FS = `#version 300 es
precision highp float;
in vec2 vUv; uniform sampler2D uCol, uNrm, uDepth; uniform vec2 uPx; uniform float uRange, uPrint, uDpr;
out vec4 o;
float D(vec2 uv) { return texture(uDepth, uv).r * uRange; }
vec3 Nn(vec2 uv) { return texture(uNrm, uv).xyz * 2. - 1.; }
void main() {
  vec3 paper = vec3(.94,.91,.85);
  float d = D(vUv);
  vec2 px = uPx * max(1., uDpr * .75);
  // (ink where the depth folds (a laplacian, so a sloping face doesn't draw) or the surface turns sharply)
  float dl = D(vUv - vec2(px.x, 0.)), dr = D(vUv + vec2(px.x, 0.)), dd = D(vUv - vec2(0., px.y)), du = D(vUv + vec2(0., px.y));
  float lap = abs(dl + dr - 2. * d) + abs(dd + du - 2. * d);
  vec3 n = Nn(vUv);
  float turn = max(max(1. - dot(n, Nn(vUv + vec2(px.x, 0.))), 1. - dot(n, Nn(vUv - vec2(px.x, 0.)))), max(1. - dot(n, Nn(vUv + vec2(0., px.y))), 1. - dot(n, Nn(vUv - vec2(0., px.y)))));
  float sky = step(.9999 * uRange, d);
  float edge = max(smoothstep(.04, .12, lap), smoothstep(.25, .5, turn));
  // (and round the stone against the sky)
  float skyN = step(.9999 * uRange, dl) + step(.9999 * uRange, dr) + step(.9999 * uRange, dd) + step(.9999 * uRange, du);
  if (sky < .5 && skyN > 0.) edge = 1.;
  vec3 c = texture(uCol, vUv).rgb;
  vec2 q = gl_FragCoord.xy;
  if (sky > .5) {
    // (the paper behind it, a little darker toward the corners)
    float v = length(vUv - .5);
    o = vec4(paper * (1. - .12 * v * v), 1.);
    return;
  }
  vec3 ink = vec3(.17,.14,.12);
  if (uPrint > .5) {
    // (a lithograph: the light as hatching, closer and crossed as it darkens)
    float L = dot(c, vec3(.3,.55,.15));
    float s = 4.5 * uDpr;
    float h1 = abs(fract((q.x + q.y) / s) - .5) * s, h2 = abs(fract((q.x - q.y) / s) - .5) * s, h3 = abs(fract(q.y / (s * .7)) - .5) * s * .7;
    float w = .55 * uDpr;
    float hatch = 0.;
    hatch = max(hatch, (1. - smoothstep(w, w + 1., h1)) * smoothstep(.78, .62, L));
    hatch = max(hatch, (1. - smoothstep(w, w + 1., h2)) * smoothstep(.55, .4, L));
    hatch = max(hatch, (1. - smoothstep(w, w + 1., h3)) * smoothstep(.36, .24, L));
    c = mix(paper, ink, hatch * .85);
  o = vec4(mix(c, ink, edge * .85), 1.);
    return;
  }
  // (as it is: barely a line, only where the depth folds)
  o = vec4(mix(c, ink * 1.6, smoothstep(.04, .14, lap) * .16), 1.);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(t)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

// ─── the little matrix arithmetic it needs (column-major, as GL has it) ───
export type M4 = Float32Array;
export function mul(a: M4, b: M4): M4 { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
export function ortho(l: number, r: number, b: number, t: number, n: number, f: number): M4 { return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]); }
export function lookAt(e: number[], c: number[], up: number[]): M4 {
  const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(up, z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
}
export function invert(m: M4): M4 {
  const o = new Float32Array(16), a = m;
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5], b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6];
  const b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12], b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det; o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
  o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det; o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
  o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det; o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
  o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det; o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
  return o;
}
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** the camera: square-on to nothing, looking down at `el` from `az` round, orthographic (as the prints draw it) */
export function camera(v: View, aspect: number): { vp: M4; eye: number[]; dir: number[]; range: number } {
  const d = [Math.cos(v.el) * Math.sin(v.az), Math.sin(v.el), Math.cos(v.el) * Math.cos(v.az)], R = 120;
  const eye = [v.target[0] + d[0] * R, v.target[1] + d[1] * R, v.target[2] + d[2] * R];
  const h = v.zoom, w = h * aspect;
  return { vp: mul(ortho(-w, w, -h, h, 1, 2 * R), lookAt(eye, v.target, [0, 1, 0])), eye, dir: [-d[0], -d[1], -d[2]], range: 2 * R - 1 };
}

export class Renderer {
  gl: WebGL2RenderingContext;
  private main: WebGLProgram; private shadow: WebGLProgram; private post: WebGLProgram;
  private vao: WebGLVertexArrayObject; private buf: WebGLBuffer; private count = 0;
  private shadowFb: WebGLFramebuffer; private shadowTex: WebGLTexture;
  private fb: WebGLFramebuffer | null = null; private col: WebGLTexture | null = null; private nrm: WebGLTexture | null = null; private dep: WebGLTexture | null = null; private size = [0, 0];
  /** the sun: low, from over the left shoulder of the first view */
  sun = norm([-0.62, 0.72, -0.3]);
  print = false;
  /** (for looking at it: the sun's shadows, or none) */
  shadows = true;
  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true })!;
    if (!gl) throw new Error('no WebGL2');
    this.gl = gl;
    this.main = compile(gl, VS, FS); this.shadow = compile(gl, VS, SHADOW_FS); this.post = compile(gl, POST_VS, POST_FS);
    this.vao = gl.createVertexArray()!; this.buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const F = 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE * F, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE * F, 3 * F);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STRIDE * F, 6 * F);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 3, gl.FLOAT, false, STRIDE * F, 8 * F);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 1, gl.FLOAT, false, STRIDE * F, 11 * F);
    gl.bindVertexArray(null);
    this.shadowTex = this.depthTex(2048, 2048);
    this.shadowFb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  private depthTex(w: number, h: number) {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }
  private colTex(w: number, h: number) {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }
  upload(m: Mesh) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, m.data, gl.STATIC_DRAW);
    this.count = m.count;
  }
  private targets(w: number, h: number) {
    if (this.size[0] === w && this.size[1] === h && this.fb) return;
    const gl = this.gl;
    for (const t of [this.col, this.nrm, this.dep]) if (t) gl.deleteTexture(t);
    if (this.fb) gl.deleteFramebuffer(this.fb);
    this.col = this.colTex(w, h); this.nrm = this.colTex(w, h); this.dep = this.depthTex(w, h);
    this.fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.col, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.nrm, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.dep, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.size = [w, h];
  }
  /** the sun's view: square on to it, over the whole slab and as high as it can be built */
  private lightVP(): M4 {
    const e = N / 2 + MARGIN + 1, top = LEVELS * H, c = [0, top / 2, 0], s = this.sun;
    const eye = [c[0] + s[0] * 60, c[1] + s[1] * 60, c[2] + s[2] * 60], r = Math.hypot(e * 1.42, top / 2) + 1;
    return mul(ortho(-r, r, -r, r, 60 - r - 2, 60 + r + 2), lookAt(eye, c, [0, 1, 0]));
  }
  draw(view: View, time: number, dpr: number) {
    const gl = this.gl, cv = this.canvas, w = cv.width, h = cv.height;
    this.targets(w, h);
    const cam = camera(view, w / h), light = this.lightVP();
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
    // (the sun's depths)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb); gl.viewport(0, 0, 2048, 2048);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.shadow);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.shadow, 'uVP'), false, light);
    gl.uniform1f(gl.getUniformLocation(this.shadow, 'uTime'), time);
    gl.cullFace(gl.FRONT);
    gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, this.count);
    gl.cullFace(gl.BACK);
    // (the stone, lit)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb); gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.main);
    const U = (n: string) => gl.getUniformLocation(this.main, n);
    gl.uniformMatrix4fv(U('uVP'), false, cam.vp); gl.uniformMatrix4fv(U('uLight'), false, light);
    gl.uniform1f(U('uTime'), time); gl.uniform3fv(U('uSun'), this.sun); gl.uniform3fv(U('uEye'), cam.eye); gl.uniform3fv(U('uDir'), cam.dir); gl.uniform1f(U('uN'), N); gl.uniform1f(U('uShadows'), this.shadows ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(U('uShadow'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
    gl.bindVertexArray(null);
    // (ink, and paper)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.post);
    const P = (n: string) => gl.getUniformLocation(this.post, n);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.col); gl.uniform1i(P('uCol'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.nrm); gl.uniform1i(P('uNrm'), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.dep); gl.uniform1i(P('uDepth'), 2);
    gl.uniform2f(P('uPx'), 1 / w, 1 / h); gl.uniform1f(P('uRange'), cam.range); gl.uniform1f(P('uPrint'), this.print ? 1 : 0); gl.uniform1f(P('uDpr'), dpr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return cam;
  }
}

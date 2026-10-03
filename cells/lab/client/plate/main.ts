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
 * Drag to turn it; pinch (or the wheel) to come closer to what is under your fingers, two fingers to
 * slide it; left alone it turns slowly. The seed is in the address (`?seed=412`); `?preview` draws
 * it small and quiet (the lab's index).
 */
import { PENCIL } from '../kit/pencil';
import { hash, seeded } from '../kit/rng';
import { grow, grownAt, lineAt, type Specimen, type V3 } from './plant';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
/** the watercolour under the engraving (`?wash=0`: ink only) */
let wash = params.get('wash') !== '0';
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
in vec3 aCol; // its pigment (the watercolour)
uniform mat4 uVP;
out vec3 vWorld;
out vec4 vUV;
out vec3 vCol;
void main() { vWorld = aPos; vUV = aUV; vCol = aCol; gl_Position = uVP * vec4(aPos, 1.); }`;

const BLADE_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec4 vUV;
in vec3 vCol;
out vec4 o;
uniform vec3 uLight, uEye;
// 0 engraved on paper; 1 engraved on the finished wash (still opaque: it hides what is behind it,
// carrying its own colour); 2 the wash itself: the pigment, as dense as the blade is shaded
uniform float uMode;
uniform sampler2D uComp;
uniform vec2 uScreen;
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
  if (uMode > 1.5) {
    // the wash: laid on more heavily where the blade turns from the light and on its underside;
    // a petal's thinner, paling toward its tip
    float dens = .5 + .35 * (1. - lit) + (gl_FrontFacing ? 0. : .15);
    if (vUV.z > .5) dens *= .55 + .4 * smoothstep(1., .2, vUV.w);
    o = vec4(vCol * dens, dens);
    return;
  }
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
  float mk = clamp(m * .85, 0., 1.) * tooth();
  vec3 under = uMode > .5 ? texture(uComp, gl_FragCoord.xy / uScreen).rgb : PAPER;
  o = vec4(mix(under, GRAPHITE, mk), 1.);
}`;

const LINE_VS = `#version 300 es
in vec3 aA;
in vec3 aB;
in vec2 aW;
in vec3 aS; // its stroke, how far along it (m), its kind
uniform mat4 uVP;
uniform vec2 uRes;
uniform float uFocal;
uniform vec3 uEye;
out vec2 vP;
flat out vec2 vA2;
flat out vec2 vB2;
flat out vec2 vWpx;
flat out vec3 vS;
flat out float vLen;
void main() {
  // (a millimetre and a half toward the eye: a leaf's own outline and veins lie on it, not under
  // it — and what is behind a leaf stays behind it)
  vec3 A = aA + normalize(uEye - aA) * .0015;
  vec3 B = aB + normalize(uEye - aB) * .0015;
  vec4 ca = uVP * vec4(A, 1.), cb = uVP * vec4(B, 1.);
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
  float z = first ? ca.z / ca.w : cb.z / cb.w;
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
// as the blades: 0 opaque paper bodies, 1 clear, 2 the wash (stems and roots only)
uniform float uMode;
uniform vec3 uStem, uRoot;
uniform sampler2D uComp;
uniform vec2 uScreen;
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
  if (uMode > 1.5) {
    // the wash: stems green, warming at the foot; roots a pale umber; nothing finer
    if (kind > 1.5) discard;
    float dl = length(pa - ba * h);
    float body = clamp(max(w, 1.5) * .5 - dl + .5, 0., 1.);
    if (body <= 0.) discard;
    float dens = (kind < .5 ? .7 : .45) * body;
    o = vec4((kind < .5 ? uStem : uRoot) * dens, dens);
    return;
  }
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
    vec3 under = uMode > .5 ? texture(uComp, gl_FragCoord.xy / uScreen).rgb : PAPER;
    o = vec4(mix(under, GRAPHITE, mk) * body, body);
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

// the watercolour, laid on the paper from the pigments drawn (half size) into their own buffer:
// a little off the drawing (hand colouring always is), soft-edged, pooling darker at its rims where
// it dried, uneven as the brush was wetter or drier, granulating in the paper's tooth, and mixed
// as pigment mixes (multiplied onto the paper, so overlapping washes glaze)
const QUAD_VS = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); gl_Position = vec4(p, 0., 1.); }`;
const WASH_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uWash;
uniform vec2 uRes;
uniform float uSeed;
${COMMON}
vec4 around(vec2 uv, float r) {
  vec4 s = vec4(0.);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * .785398 + .3;
    s += texture(uWash, uv + vec2(cos(a), sin(a)) * r / uRes);
  }
  return s / 8.;
}
float fbm2(vec2 p) { return tn(p) * .5 + tn(p * 2.03 + 5.) * .3 + tn(p * 4.1 + 11.) * .2; }
void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 uv = px / uRes;
  // (sizes in the page's own pixels, the same on any screen)
  float S = uRes.y / 800.;
  vec2 q = px / (S * 90.);
  // off the drawing (the colourist's hand), and its edge wandering as wet paint does
  vec2 off = (vec2(fbm2(q * .6 + uSeed), fbm2(q * .6 + 17. + uSeed)) - .5) * 14. * S
    + (vec2(tn(px / (S * 9.) + 3.), tn(px / (S * 9.) + 31.)) - .5) * 5. * S;
  vec2 at = uv + off / uRes;
  vec4 sharp = texture(uWash, at);
  vec4 soft = around(at, 3. * S);
  vec4 bleed = around(at, 9. * S);
  // (the wet edge feathers out a little beyond the drawn shape)
  float a = max(max(sharp.a, soft.a * .95), bleed.a * .5);
  if (a < .004) { o = vec4(PAPER, 1.); return; }
  vec3 pig = (sharp.rgb + soft.rgb + bleed.rgb * .5) / max(sharp.a + soft.a + bleed.a * .5, 1e-3);
  // pigments mixing in the wet: the hue wanders within a shape
  vec3 shift = vec3(fbm2(q * 1.3 + 2.), fbm2(q * 1.3 + 8.), fbm2(q * 1.3 + 14.)) - .5;
  pig = clamp(pig + shift * vec3(.18, .12, .2), 0., 1.);
  // wetter here, drier there; a bloom (a backrun): a pale middle, a frilled darker edge
  float wet = .55 + .7 * fbm2(q * 1.7 + uSeed * .3);
  float bl = fbm2(q * 2.6 + 40. + uSeed);
  float bloom = smoothstep(.56, .6, bl) * (1. - smoothstep(.6, .66, bl));
  float inside = smoothstep(.6, .7, bl);
  // the dried rim: a thin darker line where the wet edge stopped
  float rim = clamp((sharp.a - soft.a) * 2.5, 0., 1.) + clamp((soft.a - bleed.a) * 1.2, 0., 1.) * .4;
  // the brush running dry: the paper showing through here and there; and granulation
  float dry = smoothstep(.25, .5, tn(px / (S * 4.) + 9.) * .5 + fbm2(q * 3. + 60.) * .5);
  float grain = .8 + .4 * tn(px * .7 + 11.);
  float dens = a * wet * (1. - .45 * inside) * (1. + .6 * bloom) * (1. + 1.4 * rim) * grain * mix(.55, 1., dry);
  dens = clamp(dens * .55, 0., .9);
  o = vec4(PAPER * mix(vec3(1.), pig, dens), 1.);
}`;
// (the finished wash, copied to the page)
const COPY_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uComp;
uniform vec2 uRes;
void main() { o = texture(uComp, gl_FragCoord.xy / uRes); }`;
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
const washProg = program(QUAD_VS, WASH_FS);
const copyProg = program(QUAD_VS, COPY_FS);
const quadVao = gl.createVertexArray()!;
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
for (const [name, size, off] of [['aPos', 3, 0], ['aUV', 4, 3], ['aCol', 3, 7]] as const) {
  const loc = gl.getAttribLocation(bladeProg, name);
  if (loc < 0) continue;
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 10 * 4, off * 4);
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

// ─── the colourist's box: a specimen's pigments, from its seed ───────────────────────────────────
type RGB = [number, number, number];
const GREENS: RGB[] = [[0.42, 0.55, 0.26], [0.34, 0.49, 0.24], [0.47, 0.56, 0.3], [0.3, 0.44, 0.28], [0.5, 0.58, 0.25]];
const PETALS: RGB[] = [
  [0.86, 0.4, 0.5], // rose madder
  [0.6, 0.46, 0.8], // cobalt violet
  [0.96, 0.76, 0.22], // gamboge
  [0.38, 0.5, 0.86], // ultramarine
  [0.92, 0.38, 0.26], // vermilion
  [0.96, 0.94, 0.88], // white: barely a wash
  [0.9, 0.6, 0.72], // pale pink
];
function palette(seed: number) {
  const r = seeded(hash(seed, 0xc01));
  const green = GREENS[Math.floor(r() * GREENS.length)];
  const petal = PETALS[Math.floor(r() * PETALS.length)];
  const jitter = (c: RGB, k: number, amt: number): RGB => {
    const q = seeded(hash(seed, 0xc02, k));
    const d = (q() - 0.5) * amt;
    const y = (q() - 0.5) * amt * 0.6;
    return [c[0] + d + y, c[1] + d * 0.6, c[2] + d * 0.4 - y];
  };
  return {
    petal,
    leafOf: (i: number) => jitter(green, i, 0.12),
    stem: [green[0] * 0.95 + 0.05, green[1] * 0.92, green[2] * 0.85] as RGB,
    root: [0.62, 0.52, 0.4] as RGB,
    dead: [0.66, 0.5, 0.3] as RGB,
  };
}
let paint = palette(seed);

const scaleAbout = (o: V3, p: V3, k: number): V3 => [o[0] + (p[0] - o[0]) * k, o[1] + (p[1] - o[1]) * k, o[2] + (p[2] - o[2]) * k];

function upload(sp: Specimen, T: number) {
  // blades: two quads a row (left to middle, middle to right), scaled about the base as it unfolds
  const bv: number[] = [];
  let bi = 0;
  for (const b of sp.blades) {
    bi++;
    const g = grownAt(b.t0, b.t1, T);
    if (g <= 0.01) continue;
    // (a withered leaf washed brown)
    const fresh = b.kind ? paint.petal : paint.leafOf(bi);
    const col: RGB = [0, 1, 2].map((c) => fresh[c] + (paint.dead[c] - fresh[c]) * b.wither) as RGB;
    const K = b.rows.length - 1;
    let along = 0;
    const vert = (p: V3, a: number, across: number, k: number) => {
      const q = scaleAbout(b.base, p, g);
      bv.push(q[0], q[1], q[2], a, across, b.kind, k / K, col[0], col[1], col[2]);
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
  bladeCount = bv.length / 10;
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
// where the view looks, off the plant's middle: a pinch or the wheel holds the point under the
// fingers (or the cursor) still, so you come closer to what you're looking at; two fingers drag it
const center: V3 = [0, 0, 0];
// the last frame's camera, to turn the screen back into the world: its distance, its right and up,
// the half-height of its view per unit distance, and how far the sheet's room sits above the middle
const cam = { r: 1, x: [1, 0, 0] as V3, y: [0, 1, 0] as V3, tanH: 0.25, aspect: 1, lift: 0 };
const ZMIN = 0.6;
const ZMAX = 8;
function shift(dx: number, dy: number) {
  for (let i = 0; i < 3; i++) center[i] += cam.x[i] * dx + cam.y[i] * dy;
}
/** Zoom by `f`, keeping the point under (px, py) — CSS pixels on the canvas — where it is. */
function zoomAt(f: number, px: number, py: number) {
  const z1 = Math.max(ZMIN, Math.min(ZMAX, zoom * f));
  const nx = (px / innerWidth) * 2 - 1;
  const ny = 1 - (py / innerHeight) * 2;
  const d = cam.r - (cam.r * zoom) / z1;
  shift(nx * cam.aspect * cam.tanH * d, (ny * cam.tanH - cam.lift) * d);
  // (and coming back out drifts home: whole plant in view again by the time it's at its frame)
  if (z1 < zoom && zoom > 1) {
    const k = Math.max(0, (z1 - 1) / (zoom - 1));
    for (let i = 0; i < 3; i++) center[i] *= k;
  }
  zoom = z1;
}
/** Slide the view with the fingers: (dx, dy) in CSS pixels. */
function pan(dx: number, dy: number) {
  const s = (2 * cam.tanH * cam.r) / innerHeight;
  shift(-dx * s, dy * s);
}
const pointers = new Map<number, { x: number; y: number }>();
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
    const before = { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    p.x = e.clientX;
    p.y = e.clientY;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    pan(mx - before.x, my - before.y);
    if (before.d > 0) zoomAt(d / before.d, mx, my);
  }
  p.x = e.clientX;
  p.y = e.clientY;
});
const up = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  idle = 0;
  zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
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
  if (label) label.innerHTML = `<b>Pl. ${seed}</b><i>${sp.name}</i><span>${sp.note}</span>`;
  if (plateNo) plateNo.textContent = '';
}
caption();
function specimen(next: number) {
  seed = next;
  sp = grow(seed);
  paint = palette(seed);
  T = 0;
  uploadedT = -1;
  zoom = 1;
  center.fill(0);
  const url = new URL(location.href);
  url.searchParams.set('seed', String(seed));
  history.replaceState(null, '', url);
  caption();
}
document.getElementById('another')?.addEventListener('click', () => specimen(Math.floor(Math.random() * 9000) + 1));
const washBtn = document.getElementById('wash');
const washLabel = () => {
  if (washBtn) washBtn.textContent = wash ? 'colour · on' : 'colour · off';
};
washLabel();
washBtn?.addEventListener('click', () => {
  wash = !wash;
  washLabel();
  const url = new URL(location.href);
  if (wash) url.searchParams.delete('wash');
  else url.searchParams.set('wash', '0');
  history.replaceState(null, '', url);
});
document.getElementById('again')?.addEventListener('click', () => {
  T = 0;
  uploadedT = -1;
});

// the wash's own buffer (half size: watercolour has no fine edges), with its own depth
const washTex = gl.createTexture()!;
const washDepth = gl.createRenderbuffer()!;
const washFbo = gl.createFramebuffer()!;
let washW = 0;
let washH = 0;
function washTarget(W: number, H: number) {
  const w = Math.max(1, Math.ceil(W / 2));
  const h = Math.max(1, Math.ceil(H / 2));
  if (w === washW && h === washH) return;
  washW = w;
  washH = h;
  gl.bindTexture(gl.TEXTURE_2D, washTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindRenderbuffer(gl.RENDERBUFFER, washDepth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, washFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, washTex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, washDepth);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

// the finished wash, full size: copied to the page, and read by the engraving's opaque parts
const compTex = gl.createTexture()!;
const compFbo = gl.createFramebuffer()!;
let compW = 0;
let compH = 0;
function compTarget(W: number, H: number) {
  if (W === compW && H === compH) return;
  compW = W;
  compH = H;
  gl.bindTexture(gl.TEXTURE_2D, compTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.bindFramebuffer(gl.FRAMEBUFFER, compFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, compTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

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
  // (a clear leaves the depth alone unless depth writes are on — the lines turned them off)
  gl.depthMask(true);
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
  // the camera's own right and up (as mat() makes them), to lift and slide the view in its plane
  const zc: V3 = [Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)];
  const xl = Math.hypot(zc[2], zc[0]) || 1;
  const xc: V3 = [zc[2] / xl, 0, -zc[0] / xl];
  const yc: V3 = [zc[1] * xc[2] - zc[2] * xc[1], zc[2] * xc[0] - zc[0] * xc[2], zc[0] * xc[1] - zc[1] * xc[0]];
  // (lifted so it sits in that room, not behind the caption)
  const tanH = Math.tan(fov / 2);
  const lift = (tanH * (mBot - mTop)) / H;
  for (let i = 0; i < 3; i++) target[i] += center[i] - yc[i] * lift * r;
  Object.assign(cam, { r, x: xc, y: yc, tanH, aspect, lift });
  const eye: V3 = [target[0] + zc[0] * r, target[1] + zc[1] * r, target[2] + zc[2] * r];
  const vp = mat(eye, target, fov, aspect);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const draw = (mode: number, w: number, h: number) => {
    // blades: both sides, laying down depth
    gl.useProgram(bladeProg);
    gl.uniformMatrix4fv(u(bladeProg, 'uVP'), false, vp);
    gl.uniform3fv(u(bladeProg, 'uLight'), LIGHT);
    gl.uniform3fv(u(bladeProg, 'uEye'), eye);
    gl.uniform1f(u(bladeProg, 'uMode'), mode);
    gl.uniform1i(u(bladeProg, 'uComp'), 1);
    gl.uniform2f(u(bladeProg, 'uScreen'), W, H);
    gl.depthMask(true);
    gl.bindVertexArray(bladeVao);
    gl.drawArrays(gl.TRIANGLES, 0, bladeCount);
    // lines: over them, tested against them, not hiding one another
    gl.useProgram(lineProg);
    gl.uniformMatrix4fv(u(lineProg, 'uVP'), false, vp);
    gl.uniform2f(u(lineProg, 'uRes'), w, h);
    gl.uniform1f(u(lineProg, 'uFocal'), (h / 2) / Math.tan(fov / 2));
    gl.uniform1f(u(lineProg, 'uMode'), mode);
    gl.uniform3fv(u(lineProg, 'uEye'), eye);
    gl.uniform1i(u(lineProg, 'uComp'), 1);
    gl.uniform2f(u(lineProg, 'uScreen'), W, H);
    gl.uniform3fv(u(lineProg, 'uStem'), paint.stem);
    gl.uniform3fv(u(lineProg, 'uRoot'), paint.root);
    gl.depthMask(false);
    gl.bindVertexArray(lineVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, lineCount);
    gl.bindVertexArray(null);
  };
  if (wash) {
    // 1. the pigments, into their own buffer
    washTarget(W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, washFbo);
    gl.viewport(0, 0, washW, washH);
    gl.clearColor(0, 0, 0, 0);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // (the strongest pass of the brush, not the sum: pieces of a stem overlap at their ends)
    gl.blendEquation(gl.MAX);
    draw(2, washW, washH);
    gl.blendEquation(gl.FUNC_ADD);
    // 2. laid on the paper as a wash — into its own buffer, then onto the page
    compTarget(W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, compFbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(washProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, washTex);
    gl.uniform1i(u(washProg, 'uWash'), 0);
    gl.uniform2f(u(washProg, 'uRes'), W, H);
    gl.uniform1f(u(washProg, 'uSeed'), (seed % 97) * 1.37);
    gl.bindVertexArray(quadVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(copyProg);
    gl.bindTexture(gl.TEXTURE_2D, compTex);
    gl.uniform1i(u(copyProg, 'uComp'), 0);
    gl.uniform2f(u(copyProg, 'uRes'), W, H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    // (the engraving's opaque parts read the finished wash from unit 1)
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, compTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
  }
  // 3. the engraving (each leaf and stem opaque, on the finished wash; `?washonly` leaves it off)
  if (!params.has('washonly')) draw(wash ? 1 : 0, W, H);
  (window as unknown as { __plate: unknown }).__plate = { seed, T: Math.round(T * 100) / 100, name: sp.name, blades: bladeCount / 12, lines: lineCount };
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

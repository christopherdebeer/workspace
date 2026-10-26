/**
 * The drawing (WebGL2), lit like the concept boards: a warm sun with shadows, a cool sky filling the shade, glossy
 * toys, a deep cobalt sea laced with foam, cumulus over the cliffs, distance hazed; one filmic curve over all of it.
 *
 * Passes, each frame:
 * 1. **shadows**: the sun's depth over the stretch of coast round the boat you follow;
 * 2. **the sky**: gradient, sun, clouds;
 * 3. **the ground**: granite where it's steep, grass on top, sand and shingle low;
 * 4. **things**: one shader for all of them (boats, people, little boats, buoys, boulders, cottages…), by material:
 *    painted plastic, glass and metal, skin and cloth, granite, lamps, foliage, sails; arms turned about their
 *    shoulders, flags and sails fluttering;
 * 5. **the sea**: a grid round the boat, lifted by the Gerstner swell (`waves.ts`, the same sums the boats ride),
 *    opaque cobalt, the sky in it, sun glitter, foam: lace where crests fold, surf breaking along every shore (from the
 *    coast's shore field, uploaded as a texture), holes where the little boats float;
 * 6. **wakes**: ribbons of foam behind each boat;
 * 7. **marks**: spray, splashes, the thrown line, the ring round a little boat that says come alongside.
 */
import { CELL, NX, NZ, X0, Z0, type Coast } from './coast';
import { STRIDE, type Mesh } from './shapes';
import { ISTRIDE, type World } from './world';
import { SEA, wavesGlsl } from './waves';
import type { Weather } from './weather';

export type M4 = Float32Array;
export const mat4 = {
  perspective(fovy: number, aspect: number, near: number, far: number): M4 {
    const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = (2 * far * near) / (near - far);
    return m;
  },
  ortho(l: number, r: number, b: number, t: number, n: number, f: number): M4 {
    const m = new Float32Array(16);
    m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n); m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); m[15] = 1;
    return m;
  },
  lookAt(e: number[], c: number[], up: number[]): M4 {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
  },
  mul(a: M4, b: M4): M4 {
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; }
    return o;
  },
  invert(m: M4): M4 {
    const a = m, inv = new Float32Array(16);
    inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
    inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
    inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
    inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
    inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
    inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
    inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
    inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
    inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
    inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
    inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
    inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
    inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
    inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
    inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
    inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
    let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
    det = det ? 1 / det : 0;
    for (let i = 0; i < 16; i++) inv[i] *= det;
    return inv;
  },
};

/** instances: 20 floats (where, heading; pitch, roll, scale, left arm; colour A, right arm; colour B, reach; colour C, phase) */
export class Instances {
  data: Float32Array; n = 0;
  constructor(max = 16) { this.data = new Float32Array(max * ISTRIDE); }
  clear() { this.n = 0; }
  push(x: number, y: number, z: number, yaw: number, pitch: number, roll: number, scale: number, armL: number, a: readonly number[], armR: number, b: readonly number[], reach: number, c: readonly number[], phase: number) {
    if ((this.n + 1) * ISTRIDE > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    const d = this.data, o = this.n++ * ISTRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = yaw; d[o + 4] = pitch; d[o + 5] = roll; d[o + 6] = scale; d[o + 7] = armL;
    d[o + 8] = a[0]; d[o + 9] = a[1]; d[o + 10] = a[2]; d[o + 11] = armR; d[o + 12] = b[0]; d[o + 13] = b[1]; d[o + 14] = b[2]; d[o + 15] = reach;
    d[o + 16] = c[0]; d[o + 17] = c[1]; d[o + 18] = c[2]; d[o + 19] = phase;
  }
}
/** marks (fx): 12 floats: where and size; a second point (a line's other end) and kind; colour and alpha */
export const FSTRIDE = 12;
export const FX = { SPRAY: 0, FOAM: 1, LINE: 2, RING: 3, SPARK: 4, BEAM: 5 } as const;
/** wake ribbons: per vertex x, z, across (-1..1), age, strength */
export const WSTRIDE = 5;

export interface Draw { kind: string; list: Instances; pivot?: readonly [number, number] }
export interface Frame {
  vp: M4; eye: number[]; time: number; right: number[]; up: number[];
  zMin: number; zMax: number; focus: [number, number]; far: number;
  draws: Draw[];
  wakes: Float32Array; wakeCount: number;
  fx: Float32Array; fxCount: number;
  /** the little boats' places on the water (x, z, heading, half length): the sea isn't drawn inside them */
  holes: Float32Array; holeCount: number;
  /** the weather; a lightning flash (0..1); your searchlight (where, on 0..1) and which way it points */
  weather: Weather; flash: number; spot: number[]; spotDir: number[];
}
const lin = (c: readonly number[]) => c.map((v) => v * v * (v * 0.3 + 0.7));

// ─── shared GLSL ───

const COMMON = `
uniform vec3 uEye; uniform vec3 uSun; uniform float uTime; uniform vec2 uRes;
uniform highp sampler2DShadow uShadow; uniform mat4 uLightVP;
/** the weather (weather.ts): the sun's colour × strength; the sky's fill from above and below; the sky; the air */
uniform vec3 uSunC, uFillSky, uFillGround, uSkyTop, uSkyHor, uHaze;
/** fog (start, scale, most, lightning's flash); the look (exposure, saturation, how dark, -); your searchlight */
uniform vec4 uFog, uLook, uSpot; uniform vec3 uSpotDir;
vec3 lin(vec3 c) { return c * c * (c * .3 + .7); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0., a = .5; mat2 r = mat2(.8, .6, -.6, .8); for (int i = 0; i < 4; i++) { s += a * noise2(p); p = r * p * 2.03 + 3.1; a *= .5; } return s; }
float sunShadow(vec3 P, vec3 N) {
  vec4 q = uLightVP * vec4(P + N * .12, 1.); vec3 uv = q.xyz / q.w * .5 + .5;
  if (any(lessThan(uv.xy, vec2(.003))) || any(greaterThan(uv.xy, vec2(.997))) || uv.z > 1.) return 1.;
  float s = 0., k = 1. / 2048.;
  s += texture(uShadow, vec3(uv.xy, uv.z - .0007));
  s += texture(uShadow, vec3(uv.xy + vec2(k, .4 * k), uv.z - .0007));
  s += texture(uShadow, vec3(uv.xy + vec2(-k, -.4 * k), uv.z - .0007));
  s += texture(uShadow, vec3(uv.xy + vec2(.4 * k, -k), uv.z - .0007));
  s += texture(uShadow, vec3(uv.xy + vec2(-.4 * k, k), uv.z - .0007));
  return s / 5.;
}
vec3 skyFill(vec3 N) { return mix(uFillGround * .55, uFillSky * .95, N.y * .5 + .5) * (1. + uFog.w * 3.); }
vec3 skyCol(vec3 r) {
  float h = max(r.y, 0.);
  vec3 c = mix(uSkyHor, uSkyTop, pow(h, .5));
  float sd = max(dot(r, uSun), 0.);
  return c + uSunC / 2.7 * (pow(sd, 6.) * .22 + pow(sd, 300.) * 6.);
}
/** your searchlight, when it's dark: a cone of warm light ahead of the boat */
vec3 spot(vec3 P, vec3 N) {
  if (uSpot.w < .01) return vec3(0.);
  vec3 L = uSpot.xyz - P; float d = length(L); L /= d;
  float cone = smoothstep(.88, .97, dot(-L, uSpotDir));
  return vec3(1., .94, .8) * 30. * cone * max(0., dot(N, L)) / (1. + d * d * .02) * uSpot.w;
}
vec3 aerial(vec3 c, vec3 P) { float d = distance(P, uEye); return mix(c, uHaze * (1. + uFog.w * 2.), (1. - exp(-max(0., d - uFog.x) / uFog.y)) * uFog.z); }
vec3 grade(vec3 c) {
  c *= uLook.x * (1. + uFog.w * 1.5);
  c = (c * (2.51 * c + .03)) / (c * (2.43 * c + .59) + .14);
  c = pow(clamp(c, 0., 1.), vec3(1. / 2.2));
  float l = dot(c, vec3(.299, .587, .114));
  c = mix(vec3(l), c, uLook.y);
  vec2 v = gl_FragCoord.xy / uRes - .5;
  return c * (1. - dot(v, v) * .32);
}`;

const OBJ_VS = `#version 300 es
layout(location = 0) in vec3 aPos; layout(location = 1) in vec3 aNor; layout(location = 2) in vec3 aCol; layout(location = 3) in vec2 aPM;
layout(location = 4) in vec4 i0; layout(location = 5) in vec4 i1; layout(location = 6) in vec4 i2; layout(location = 7) in vec4 i3; layout(location = 8) in vec4 i4;
uniform mat4 uVP; uniform float uTime; uniform int uMode; uniform vec2 uPivot;
out vec3 vW; out vec3 vN; out vec3 vCol; out float vMat;
void main() {
  vec3 p = aPos, n = aNor, col = aCol;
  float part = aPM.x, pi = floor(part + .001), w = part - pi, src = mod(aPM.y, 4.);
  vMat = floor(aPM.y / 4. + .001);
  if (src > .5 && src < 1.5) col *= i2.rgb; else if (src > 1.5 && src < 2.5) col *= i3.rgb; else if (src > 2.5) col *= i4.rgb;
  if (uMode == 1) {
    // (a boulder: scaled unevenly)
    p *= i1.xyz; n = normalize(n / i1.xyz);
  } else {
    if (pi == 1. || pi == 2.) {
      float s = pi == 1. ? 1. : -1., up = pi == 1. ? i1.w : i2.w, reach = i3.w;
      vec2 sh = vec2(s * uPivot.x, uPivot.y);
      float cr = cos(reach), sr = sin(reach);
      vec2 yz = vec2(p.y - sh.y, p.z);
      p.y = sh.y + yz.x * cr + yz.y * sr; p.z = -yz.x * sr + yz.y * cr;
      n.yz = vec2(n.y * cr + n.z * sr, -n.y * sr + n.z * cr);
      float c = cos(up), sn = sin(up) * s;
      vec2 xy = vec2(p.x - sh.x, p.y - sh.y);
      p.xy = sh + vec2(xy.x * c - xy.y * sn, xy.x * sn + xy.y * c);
      n.xy = vec2(n.x * c - n.y * sn, n.x * sn + n.y * c);
    } else if (pi == 3.) {
      p.x += (sin(uTime * 9. + w * 6. + i4.w * 7.) * .2 + sin(uTime * 15. + w * 11.) * .05) * w;
    }
    p *= i1.z;
    float cr = cos(i1.y), sr = sin(i1.y), cp = cos(i1.x), sp = sin(i1.x);
    p.xy = vec2(p.x * cr - p.y * sr, p.x * sr + p.y * cr); n.xy = vec2(n.x * cr - n.y * sr, n.x * sr + n.y * cr);
    p.yz = vec2(p.y * cp + p.z * sp, -p.y * sp + p.z * cp); n.yz = vec2(n.y * cp + n.z * sp, -n.y * sp + n.z * cp);
  }
  float cy = cos(i0.w), sy = sin(i0.w);
  p.xz = vec2(p.x * cy + p.z * sy, -p.x * sy + p.z * cy); n.xz = vec2(n.x * cy + n.z * sy, -n.x * sy + n.z * cy);
  vW = p + i0.xyz; vN = n; vCol = col;
  gl_Position = uVP * vec4(vW, 1.);
}`;
const OBJ_FS = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vCol; in float vMat;
out vec4 o;
${COMMON}
void main() {
  vec3 N = normalize(vN), V = normalize(uEye - vW), alb = lin(vCol);
  int m = int(vMat + .5);
  if (m == 7 && dot(N, V) < 0.) N = -N;
  float gloss = 24., spec = .04, wrap = 0., coat = 0.;
  if (m == 1) { gloss = 110.; spec = .5; coat = .25; }
  else if (m == 2) { gloss = 160.; spec = .9; coat = .6; }
  else if (m == 3) { wrap = .35; spec = .06; gloss = 18.; }
  else if (m == 6) { wrap = .45; }
  else if (m == 7) { wrap = .6; }
  else if (m == 8) { gloss = 160.; spec = .9; coat = .6; }
  if (m == 4) {
    // (granite: grain, feldspar flecks, lichen on the tops, darker and glossy where the sea wets it)
    vec3 q = vW * .55;
    float g = fbm(q.xz + q.y * .7) * .6 + fbm(q.zy * 1.7) * .4, fleck = step(.8, noise2(vW.xz * 6. + vW.y * 3.));
    alb *= .78 + .38 * g; alb = mix(alb, lin(vec3(.95, .9, .82)), fleck * .25);
    float lichen = smoothstep(.55, .9, N.y) * smoothstep(.55, .75, noise2(vW.xz * .9));
    alb = mix(alb, lin(vec3(.72, .7, .38)), lichen * .45);
    float wet = 1. - smoothstep(.2, 1.4, vW.y);
    alb *= 1. - wet * .45; spec = mix(.05, .45, wet); gloss = mix(14., 80., wet);
    N = normalize(N + (vec3(noise2(vW.yz * 2.1), 0., noise2(vW.xy * 2.1)) - .5) * .35);
  }
  float ndl = dot(N, uSun), sh = sunShadow(vW, N);
  float diff = max(0., (ndl + wrap) / (1. + wrap));
  vec3 c = alb * (uSunC * diff * sh + skyFill(N) + spot(vW, N));
  vec3 H = normalize(uSun + V);
  c += uSunC * spec * pow(max(dot(N, H), 0.), gloss) * sh * (gloss + 8.) / 40.;
  float fres = pow(1. - max(dot(N, V), 0.), 4.);
  c += skyCol(reflect(-V, N)) * coat * (.08 + .92 * fres);
  // (lamps: brighter as it darkens; windows: dark glass by day, lit warm at dusk)
  if (m == 5) c = alb * (3.5 + 6. * uLook.z);
  if (m == 8) c += lin(vec3(1., .74, .38)) * 3.2 * smoothstep(.3, .8, uLook.z);
  o = vec4(grade(aerial(c, vW)), 1.);
}`;
const DEPTH_FS = `#version 300 es
precision highp float;
void main() {}`;

const LAND_VS = `#version 300 es
layout(location = 0) in vec3 aPos; layout(location = 1) in vec3 aNor;
uniform mat4 uVP;
out vec3 vW; out vec3 vN;
void main() { vW = aPos; vN = aNor; gl_Position = uVP * vec4(aPos, 1.); }`;
const LAND_FS = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN;
out vec4 o;
${COMMON}
void main() {
  vec3 N = normalize(vN), P = vW;
  float n1 = fbm(P.xz * .045), n2 = noise2(P.xz * .6), steep = smoothstep(.18, .45, 1. - N.y);
  vec3 grass = mix(lin(vec3(.33, .52, .16)), lin(vec3(.55, .63, .24)), n1);
  grass *= .85 + .3 * n2;
  vec3 rock = mix(lin(vec3(.62, .55, .45)), lin(vec3(.5, .48, .45)), noise2(P.xz * .13 + P.y * .3));
  rock *= .8 + .35 * fbm(vec2(P.x + P.z, P.y) * .8);
  vec3 sand = mix(lin(vec3(.86, .78, .6)), lin(vec3(.72, .68, .6)), n2);
  float low = 1. - smoothstep(1.6, 3.6, P.y + n1 * 1.5);
  vec3 c = mix(grass, sand, low * (1. - steep));
  c = mix(c, rock, steep);
  if (P.y < .3) c = mix(sand, rock, steep) * mix(.85, .45, smoothstep(.3, -3., P.y));
  float sh = sunShadow(P, N);
  vec3 col = c * (uSunC * max(0., dot(N, uSun)) * sh + skyFill(N) + spot(P, N));
  o = vec4(grade(aerial(col, P)), 1.);
}`;

const SKY_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2. - 1., .99999, 1.); }`;
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUV; uniform mat4 uInvVP; uniform vec4 uCloud; out vec4 o;
${COMMON}
void main() {
  vec4 w = uInvVP * vec4(vUV * 2. - 1., 1., 1.); vec3 r = normalize(w.xyz / w.w - uEye);
  vec3 c = skyCol(r);
  // (stars, on a clear night)
  if (uCloud.w > .5 && r.y > 0.) {
    vec2 q = r.xz / (r.y + .3) * 140.; vec2 i = floor(q);
    float st = step(.985, hash2(i)) * smoothstep(.5, .1, length(fract(q) - .5)) * smoothstep(.0, .25, r.y);
    c += vec3(st) * .8;
  }
  // (cloud: cumulus piled over the horizon, or a whole grey lid; lit on top, darker beneath)
  if (r.y > -.02) {
    vec2 p = r.xz / (r.y + .09) * .9 + vec2(uTime * .004 * uCloud.z, uTime * .002 * uCloud.z);
    float d = fbm(p * .55) + .35 * fbm(p * 1.6) - .1 * r.y * 3. * (1. - uCloud.x);
    float lo = mix(.85, .2, uCloud.x);
    float k = smoothstep(lo, lo + .2, d) * smoothstep(-.02, .05, r.y) * (1. - smoothstep(mix(.35, 1.2, uCloud.x), mix(.7, 1.6, uCloud.x), r.y));
    float lit = clamp((fbm(p * .55 - uSun.xz * .25) - d) * 3. + .75, 0., 1.);
    vec3 under = mix(lin(vec3(.66, .72, .82)), lin(vec3(.2, .22, .26)), uCloud.y), top = mix(lin(vec3(1., .98, .95)) * 1.25, lin(vec3(.52, .55, .6)), uCloud.y);
    vec3 cloud = mix(under, top, lit) * mix(vec3(1.), uSunC / 2.7 + .25, .35);
    c = mix(c, cloud * (1. + uFog.w * 4.), k);
  }
  // (fog: the sky goes to the air's colour, most of all low down)
  float fogSky = clamp(1. - uFog.y / 900., 0., 1.) * uFog.z;
  c = mix(c, uHaze * (1. + uFog.w * 3.), fogSky * (1. - smoothstep(0., .6, r.y) * .5));
  o = vec4(grade(c), 1.);
}`;

const FIELD = `
uniform sampler2D uField; uniform vec4 uFieldBox;
/** the coast's shore field: metres to the nearest shore (positive over water) */
float shore(vec2 p) {
  vec2 uv = vec2(((p.x - uFieldBox.x) / uFieldBox.z + .5) / ${NX.toFixed(1)}, ((p.y - uFieldBox.y) / uFieldBox.z + .5) / ${NZ.toFixed(1)});
  if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) return -20.;
  return texture(uField, uv).r;
}
float calm(float s) { float u = clamp(s / 12., 0., 1.); return .5 + .5 * u * u * (3. - 2. * u); }
${wavesGlsl()}`;

const WATER_VS = `#version 300 es
layout(location = 0) in vec2 aXZ;
uniform mat4 uVP; uniform float uTime; uniform vec2 uOffset;
${FIELD}
out vec3 vW; out vec3 vN; out float vFold; out float vS; out vec2 vP0;
void main() {
  vec2 p = aXZ + uOffset; float s = shore(p);
  vec3 n; float fold;
  vec3 d = swell(p, uTime, calm(s), n, fold);
  vW = vec3(p.x + d.x, d.y, p.y + d.z); vN = n; vFold = fold; vS = s; vP0 = p;
  gl_Position = uVP * vec4(vW, 1.);
}`;
const WATER_FS = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in float vFold; in float vS; in vec2 vP0;
uniform vec4 uHoles[12]; uniform int uHoleCount;
/** the water's own colour (deep, lit through: linear); foam, rain, wind */
uniform vec3 uDeep, uBody, uSeaLook;
out vec4 o;
${COMMON}
${FIELD}
/** lace: the bright edges between cells (a Worley pattern's F2 - F1) */
float lace(vec2 p) {
  vec2 i = floor(p), f = fract(p); float d1 = 8., d2 = 8.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y), r = g + vec2(hash2(i + g), hash2(i + g + 17.)) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return 1. - smoothstep(.0, .14, sqrt(d2) - sqrt(d1));
}
void main() {
  vec2 P = vW.xz;
  // (inside a little boat: no sea)
  for (int i = 0; i < 12; i++) {
    if (i >= uHoleCount) break;
    vec4 h = uHoles[i]; vec2 d = P - h.xy; float c = cos(h.z), s = sin(h.z);
    vec2 l = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
    if ((l.x * l.x) / (.62 * .62) + (l.y * l.y) / (h.w * h.w) < 1.) discard;
  }
  float s = shore(P);
  vec2 rp = P * 1.7 + vec2(uTime * .7, -uTime * .45), rq = P * 2.9 - vec2(uTime * .55, uTime * .8);
  vec2 rip = vec2(noise2(rp) - .5, noise2(rp + 9.) - .5) * .5 + vec2(noise2(rq) - .5, noise2(rq + 5.) - .5) * .3;
  // (rain pocks the surface)
  vec2 rain = (vec2(noise2(P * 7. + uTime * 23.), noise2(P * 7.3 - uTime * 19. + 3.)) - .5) * uSeaLook.y;
  vec3 N = normalize(vN + vec3(rip.x + rain.x, 0., rip.y + rain.y) * .55);
  vec3 V = normalize(uEye - vW), R = reflect(-V, N);
  if (R.y < .02) R = normalize(vec3(R.x, .02, R.z));
  float fres = .02 + .98 * pow(1. - max(dot(N, V), 0.), 5.);
  // (the water's own colour: deep cobalt, lighter in the faces the light shines through, a touch of green by the rocks)
  vec3 deep = uDeep, body = uBody, near = mix(uBody, lin(vec3(.08, .5, .6)), .6) * (uBody.b / .39);
  float face = clamp(vW.y * 1.4 + .35, 0., 1.) * clamp(dot(normalize(vec3(-uSun.x, .2, -uSun.z)), -N) + .6, 0., 1.);
  vec3 c = mix(deep, body, face * .7 + .12);
  c = mix(c, near, (1. - smoothstep(1., 9., s)) * .45);
  float sh = sunShadow(vW, vec3(0., 1., 0.));
  c *= mix(.5, 1., sh) * (uSunC.r * .32 + .25);
  // (the swell's relief: faces turned to the light brighter, backs and troughs darker)
  float relief = clamp(dot(normalize(vN), normalize(uSun + vec3(0., .9, 0.))), 0., 1.);
  c *= .45 + 1.05 * pow(relief, 2.2);
  c *= .8 + .45 * clamp(vW.y / max(.4, uSea.x * .9), -.5, 1.);
  c = mix(c, skyCol(R), fres * .75);
  float sd = max(dot(R, uSun), 0.);
  c += uSunC / 2.7 * (pow(sd, 90.) * .7 + pow(sd, 900.) * 9. * step(.55, noise2(P * 3.3 + uTime))) * sh;
  // (the searchlight on the water, and its glitter)
  vec3 sp = spot(vW, N);
  c += sp * (uBody * .2 + .035 + .06 * pow(max(0., dot(R, normalize(uSpot.xyz - vW))), 30.));
  // ─── foam ───
  float crest = smoothstep(.56 + .08 * uSeaLook.x, .28, vFold) * (.5 + .5 * lace(P * .42 + vec2(uTime * .12 * uSeaLook.z, 0.) + fbm(P * .2) * 1.2));
  // (wind streaks: the lace drawn out along the way the waves run, wandering)
  vec2 wd = vec2(.52, .85), q = vec2(dot(P, vec2(wd.y, -wd.x)) * .32, dot(P, wd) * .1) + vec2(fbm(P * .06), fbm(P * .06 + 5.)) * 2.2;
  float veins = lace(q + vec2(0., -uTime * .06)) * smoothstep(.62 - .08 * uSeaLook.x, .9, fbm(P * .035 + uTime * .01 * uSeaLook.z)) * smoothstep(.35, .7, noise2(P * .4)) * .26 * min(1.6, uSeaLook.x);
  float surfBand = 1. - smoothstep(.0, 8.5, s);
  float surge = .5 + .5 * sin(s * 1.15 - uTime * 2.3 + noise2(P * .15) * 6.);
  float surf = clamp((1. - smoothstep(.0, 2.6, s)) + surfBand * surge * (.45 + .55 * lace(P * .7 + uTime * .2)), 0., 1.);
  float foam = clamp(max(max(crest, veins), surf), 0., 1.);
  foam *= .75 + .25 * noise2(P * 3.1 + uTime * .5);
  vec3 white = lin(vec3(.97, .99, 1.)) * (uSunC * max(.25, N.y) * mix(.45, 1., sh) * .38 + skyFill(vec3(0., 1., 0.)) + sp * .5);
  c = mix(c, white, foam);
  o = vec4(grade(aerial(c, vW)), 1.);
}`;

const WAKE_VS = `#version 300 es
layout(location = 0) in vec2 aXZ; layout(location = 1) in vec3 aUAS;
uniform mat4 uVP; uniform float uTime;
${FIELD}
out vec3 vW; out vec3 vUAS;
void main() {
  vec3 n; float fold;
  vec3 d = swell(aXZ, uTime, calm(shore(aXZ)), n, fold);
  vW = vec3(aXZ.x, d.y + .06, aXZ.y); vUAS = aUAS;
  gl_Position = uVP * vec4(vW, 1.);
}`;
const WAKE_FS = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vUAS;
out vec4 o;
${COMMON}
void main() {
  float e = abs(vUAS.x), age = vUAS.y, k = vUAS.z;
  // (churned white straight behind the stern, fading in a second or two; the wake's two arms, thin and long-lived)
  float wash = (1. - smoothstep(.0, .42 + age * .08, e)) * exp(-age * 1.1);
  float arms = smoothstep(.62, .86, e) * (1. - smoothstep(.93, 1., e)) * exp(-age * .42);
  float n1 = fbm(vW.xz * 1.7 + age * .7), n2 = fbm(vW.xz * .8 - age * .3);
  float a = (wash * smoothstep(.2, .55, n1 + .15) + arms * smoothstep(.38, .62, n2) * .9) * k;
  if (a < .01) discard;
  vec3 c = lin(vec3(.97, .99, 1.)) * (uSunC * .4 + skyFill(vec3(0., 1., 0.)) + spot(vW, vec3(0., 1., 0.)) * .5);
  o = vec4(grade(aerial(c, vW)), clamp(a, 0., 1.));
}`;

const FX_VS = `#version 300 es
layout(location = 0) in vec2 aC;
layout(location = 1) in vec4 iP; layout(location = 2) in vec4 iQ; layout(location = 3) in vec4 iCol;
uniform mat4 uVP; uniform float uTime; uniform vec3 uRight; uniform vec3 uUp; uniform vec3 uEye;
${FIELD}
out vec2 vUV; out float vKind; out vec4 vCol;
void main() {
  float kind = iQ.w; vUV = aC; vKind = kind; vCol = iCol;
  vec3 wp;
  if (kind > .5 && kind < 1.5 || kind > 2.5 && kind < 3.5) {
    vec2 p = iP.xz + aC * iP.w; vec3 n; float f;
    vec3 d = swell(p, uTime, calm(shore(p)), n, f);
    wp = vec3(p.x, d.y + .08, p.y);
  } else if (kind > 1.5 && kind < 2.5 || kind > 4.5) {
    // (a stretch of line between two points, facing the camera; a beam widens as it goes)
    vec3 a = iP.xyz, b = iQ.xyz, t = normalize(b - a), side = normalize(cross(t, normalize(uEye - mix(a, b, .5))));
    float u = aC.x * .5 + .5, wdt = kind > 4.5 ? mix(.35, iP.w, u) : iP.w;
    wp = mix(a, b, u) + side * aC.y * wdt;
  } else wp = iP.xyz + (uRight * aC.x + uUp * aC.y) * iP.w;
  gl_Position = uVP * vec4(wp, 1.);
}`;
const FX_FS = `#version 300 es
precision highp float;
in vec2 vUV; in float vKind; in vec4 vCol;
out vec4 o;
${COMMON}
void main() {
  float d = length(vUV), a = 0.; vec3 c = lin(vCol.rgb);
  if (vKind < .5) a = smoothstep(1., .3, d);
  else if (vKind < 1.5) a = smoothstep(1., .4, d + (noise2(vUV * 3. + vCol.a * 9.) - .5) * .6);
  else if (vKind < 2.5) a = smoothstep(1., .5, abs(vUV.y));
  else if (vKind < 3.5) { float ang = atan(vUV.y, vUV.x), dash = step(.4, fract(ang / 6.2832 * 22. - uTime * .3)); a = smoothstep(.1, .0, abs(d - .9)) * dash; }
  else if (vKind < 4.5) a = max(0., 1. - abs(vUV.x * vUV.y) * 30.) * smoothstep(1., .1, d) + smoothstep(.3, .0, d);
  else { float u = vUV.x * .5 + .5; a = (1. - smoothstep(.0, 1., abs(vUV.y))) * pow(1. - u, 1.4) * smoothstep(.0, .06, u); }
  a *= vCol.a > 1. ? 1. : vCol.a;
  if (a < .01) discard;
  vec3 lit = vKind > 4.5 ? c * 2.5 : vKind > 1.5 && vKind < 2.5 ? c * (uSunC * .6 + skyFill(vec3(0., 1., 0.))) : vKind > 3.5 ? c * 3. : c * (uSunC * .42 + skyFill(vec3(0., 1., 0.)));
  o = vec4(grade(lit), clamp(a, 0., 1.));
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'}: ${gl.getShaderInfoLog(s)}\n${src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')}`);
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  const u = new Map<string, WebGLUniformLocation | null>();
  return { p, u: (n: string) => (u.has(n) ? u.get(n)! : (u.set(n, gl.getUniformLocation(p, n)), u.get(n)!)) };
}
type Prog = ReturnType<typeof compile>;
interface Kind { vao: WebGLVertexArrayObject; count: number; inst: WebGLBuffer; pivot: readonly [number, number] }
interface Static { z0: number; z1: number; vao: WebGLVertexArrayObject; count: number; n: number; mode: number; indexed?: boolean; far?: WebGLVertexArrayObject; farCount?: number }

const SHADOW = 2048;

export class Renderer {
  gl: WebGL2RenderingContext;
  private obj: Prog; private land: Prog; private water: Prog; private wake: Prog; private fx: Prog; private sky: Prog;
  private depthObj: Prog; private depthLand: Prog;
  private kinds = new Map<string, Kind>();
  private terrain: Static[] = []; private rocks: Static[] = []; private props: Static[] = [];
  private field: WebGLTexture | null = null;
  private shadowTex: WebGLTexture; private shadowFbo: WebGLFramebuffer;
  private skyVao: WebGLVertexArrayObject; private waterVao: WebGLVertexArrayObject; private waterCount: number;
  private wakeVao: WebGLVertexArrayObject; private wakeBuf: WebGLBuffer;
  private fxVao: WebGLVertexArrayObject; private fxBuf: WebGLBuffer; private ident: WebGLBuffer;
  private trash: (() => void)[] = [];
  static readonly WN = 200; static readonly WS = 0.6;
  lightVP: M4 = new Float32Array(16);

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.obj = compile(gl, OBJ_VS, OBJ_FS);
    this.land = compile(gl, LAND_VS, LAND_FS);
    this.water = compile(gl, WATER_VS, WATER_FS);
    this.wake = compile(gl, WAKE_VS, WAKE_FS);
    this.fx = compile(gl, FX_VS, FX_FS);
    this.sky = compile(gl, SKY_VS, SKY_FS);
    this.depthObj = compile(gl, OBJ_VS, DEPTH_FS);
    this.depthLand = compile(gl, LAND_VS, DEPTH_FS);
    this.skyVao = gl.createVertexArray()!;
    // (the sun's shadow map)
    this.shadowTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW, SHADOW, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE], [gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.shadowFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // (the sea's grid: fine round the boat, coarser and coarser out to the horizon)
    const N = Renderer.WN, S = Renderer.WS, xz = new Float32Array((N + 1) * (N + 1) * 2), idx = new Uint32Array(N * N * 6);
    const spread = (i: number) => { const q = (i - N / 2) * S; return q * (1 + 10 * Math.pow(Math.abs(q) / ((N * S) / 2), 3)); };
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { xz[(j * (N + 1) + i) * 2] = spread(i); xz[(j * (N + 1) + i) * 2 + 1] = spread(j); }
    let k = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i; idx[k++] = a; idx[k++] = a + N + 1; idx[k++] = a + 1; idx[k++] = a + 1; idx[k++] = a + N + 1; idx[k++] = a + N + 2; }
    this.waterVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.waterVao);
    const wb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, wb); gl.bufferData(gl.ARRAY_BUFFER, xz, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    const wi = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wi); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.waterCount = idx.length;
    // (wakes: a strip per boat, rewritten each frame)
    this.wakeVao = gl.createVertexArray()!; gl.bindVertexArray(this.wakeVao);
    this.wakeBuf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.wakeBuf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, WSTRIDE * 4, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, WSTRIDE * 4, 8);
    // (marks: one quad, many instances)
    this.fxVao = gl.createVertexArray()!; gl.bindVertexArray(this.fxVao);
    const qb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, qb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    this.fxBuf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.fxBuf);
    for (let a = 0; a < 3; a++) { gl.enableVertexAttribArray(1 + a); gl.vertexAttribPointer(1 + a, 4, gl.FLOAT, false, FSTRIDE * 4, a * 16); gl.vertexAttribDivisor(1 + a, 1); }
    gl.bindVertexArray(null);
    this.ident = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.ident);
    const id = new Float32Array(ISTRIDE); id[6] = 1; id[8] = id[9] = id[10] = 1; id[12] = id[13] = id[14] = 1; id[16] = id[17] = id[18] = 1;
    gl.bufferData(gl.ARRAY_BUFFER, id, gl.STATIC_DRAW);
  }

  private meshVao(mesh: Mesh, inst: WebGLBuffer, keep = false) {
    const gl = this.gl, vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
    const F = STRIDE * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, F, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, F, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, F, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, F, 36);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    for (let a = 0; a < 5; a++) { gl.enableVertexAttribArray(4 + a); gl.vertexAttribPointer(4 + a, 4, gl.FLOAT, false, ISTRIDE * 4, a * 16); gl.vertexAttribDivisor(4 + a, 1); }
    gl.bindVertexArray(null);
    if (!keep) this.trash.push(() => { gl.deleteBuffer(vb); gl.deleteVertexArray(vao); });
    return vao;
  }
  /** a kind of thing that moves: its mesh, drawn once per instance (arms turned about `pivot`) */
  addKind(name: string, mesh: Mesh, pivot: readonly [number, number] = [0, 0]) {
    const inst = this.gl.createBuffer()!;
    this.kinds.set(name, { vao: this.meshVao(mesh, inst, true), count: mesh.count, inst, pivot });
  }
  /** the coast to draw: its shore field (a texture for the sea), the ground, the boulders, what's built */
  setCoast(c: Coast, w: World) {
    const gl = this.gl;
    for (const t of this.trash.splice(0)) t();
    this.terrain = []; this.rocks = []; this.props = [];
    if (this.field) gl.deleteTexture(this.field);
    this.field = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.field);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, NX, NZ, 0, gl.RED, gl.FLOAT, c.shore);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    for (const t of w.terrain) {
      const vao = gl.createVertexArray()!; gl.bindVertexArray(vao);
      const vb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, t.verts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      const ib = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, t.index, gl.STATIC_DRAW);
      // (the same samples, every other one, for far off)
      const fvao = gl.createVertexArray()!; gl.bindVertexArray(fvao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      const fb = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fb); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, t.far, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      this.trash.push(() => { gl.deleteBuffer(vb); gl.deleteBuffer(ib); gl.deleteBuffer(fb); gl.deleteVertexArray(vao); gl.deleteVertexArray(fvao); });
      this.terrain.push({ z0: t.z0, z1: t.z1, vao, count: t.index.length, n: 1, mode: 0, indexed: true, far: fvao, farCount: t.far.length });
    }
    for (const r of w.rocks) {
      const ib = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferData(gl.ARRAY_BUFFER, r.inst, gl.STATIC_DRAW);
      this.trash.push(() => gl.deleteBuffer(ib));
      this.rocks.push({ z0: r.z0, z1: r.z1, vao: this.meshVao(w.boulders[r.kind], ib), count: w.boulders[r.kind].count, n: r.n, mode: 1, far: this.meshVao(w.bouldersFar[r.kind], ib), farCount: w.bouldersFar[r.kind].count });
    }
    for (const p of w.props) this.props.push({ z0: p.z0, z1: p.z1, vao: this.meshVao(p.mesh, this.ident), count: p.mesh.count, n: 1, mode: 0 });
  }

  draw(f: Frame, width: number, height: number) {
    const gl = this.gl;
    // ─── 1. the sun's shadow map, round the followed boat ───
    const [fx, fz] = f.focus, cx = fx, R = 75;
    const W = f.weather, SUN = W.sun;
    const lv = mat4.lookAt([cx + SUN[0] * 200, SUN[1] * 200, fz + 20 + SUN[2] * 200], [cx, 0, fz + 20], [0, 1, 0]);
    const lp = mat4.ortho(-R, R, -R, R, 20, 420), lvp = mat4.mul(lp, lv);
    // (snapped to the map's texels, so shadows don't crawl as the boat moves)
    const tx = SHADOW / 2; lvp[12] = Math.round(lvp[12] * tx) / tx; lvp[13] = Math.round(lvp[13] * tx) / tx;
    this.lightVP = lvp;
    for (const d of f.draws) { const k = this.kinds.get(d.kind); if (k && d.list.n) { gl.bindBuffer(gl.ARRAY_BUFFER, k.inst); gl.bufferData(gl.ARRAY_BUFFER, d.list.data.subarray(0, d.list.n * ISTRIDE), gl.DYNAMIC_DRAW); } }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo); gl.viewport(0, 0, SHADOW, SHADOW);
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true); gl.disable(gl.CULL_FACE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const near = (z0: number, z1: number) => z1 > fz - R && z0 < fz + 20 + R;
    gl.useProgram(this.depthLand.p); gl.uniformMatrix4fv(this.depthLand.u('uVP'), false, lvp);
    for (const t of this.terrain) if (near(t.z0, t.z1)) { gl.bindVertexArray(t.vao); gl.drawElements(gl.TRIANGLES, t.count, gl.UNSIGNED_INT, 0); }
    const D = this.depthObj;
    gl.useProgram(D.p); gl.uniformMatrix4fv(D.u('uVP'), false, lvp); gl.uniform1f(D.u('uTime'), f.time);
    gl.uniform1i(D.u('uMode'), 1);
    for (const r of this.rocks) if (near(r.z0, r.z1)) { gl.bindVertexArray(r.far!); gl.drawArraysInstanced(gl.TRIANGLES, 0, r.farCount!, r.n); }
    gl.uniform1i(D.u('uMode'), 0);
    for (const p of this.props) if (near(p.z0, p.z1)) { gl.bindVertexArray(p.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, p.count, 1); }
    // (the people and gulls are too small for their shadows to tell: left out)
    for (const d of f.draws) { const k = this.kinds.get(d.kind); if (k && d.list.n && !/^(kid|crew|gull)/.test(d.kind)) { gl.uniform2fv(D.u('uPivot'), k.pivot); gl.bindVertexArray(k.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, k.count, d.list.n); } }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, width, height);
    gl.clearColor(0.6, 0.78, 0.93, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const common = (p: Prog) => {
      gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u('uVP'), false, f.vp); gl.uniformMatrix4fv(p.u('uLightVP'), false, lvp);
      gl.uniform1i(p.u('uShadow'), 1); gl.uniform3fv(p.u('uEye'), f.eye); gl.uniform3fv(p.u('uSun'), SUN);
      gl.uniform1f(p.u('uTime'), f.time); gl.uniform2f(p.u('uRes'), width, height);
      gl.uniform1i(p.u('uField'), 0); gl.uniform4f(p.u('uFieldBox'), X0, Z0, CELL, NX);
      gl.uniform2f(p.u('uSea'), SEA.height, SEA.chop);
      gl.uniform3fv(p.u('uSunC'), W.sunColour.map((v) => lin([v])[0] * W.sunStrength));
      gl.uniform3fv(p.u('uFillSky'), lin(W.fillSky)); gl.uniform3fv(p.u('uFillGround'), lin(W.fillGround));
      gl.uniform3fv(p.u('uSkyTop'), lin(W.skyTop)); gl.uniform3fv(p.u('uSkyHor'), lin(W.skyHorizon)); gl.uniform3fv(p.u('uHaze'), lin(W.haze));
      gl.uniform4f(p.u('uFog'), W.fogStart, W.fogScale, W.fogMax, f.flash);
      gl.uniform4f(p.u('uLook'), W.exposure, W.saturation, W.dark, 0);
      gl.uniform4fv(p.u('uSpot'), f.spot); gl.uniform3fv(p.u('uSpotDir'), f.spotDir);
    };
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.field);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    const inView = (z0: number, z1: number) => z1 >= f.zMin && z0 <= f.zMax;
    // ─── 2. the sky ───
    common(this.sky); gl.uniformMatrix4fv(this.sky.u('uInvVP'), false, mat4.invert(f.vp));
    gl.uniform4f(this.sky.u('uCloud'), W.cloud, W.cloudDark, W.wind, W.stars ? 1 : 0);
    gl.depthMask(false); gl.bindVertexArray(this.skyVao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.depthMask(true);
    // ─── 3. the ground ───
    common(this.land);
    const away = (z0: number, z1: number) => (z0 < f.eye[2] && z1 > f.eye[2] ? 0 : Math.min(Math.abs(f.eye[2] - z0), Math.abs(f.eye[2] - z1)));
    for (const t of this.terrain) if (inView(t.z0, t.z1)) {
      if (away(t.z0, t.z1) < 150) { gl.bindVertexArray(t.vao); gl.drawElements(gl.TRIANGLES, t.count, gl.UNSIGNED_INT, 0); }
      else { gl.bindVertexArray(t.far!); gl.drawElements(gl.TRIANGLES, t.farCount!, gl.UNSIGNED_INT, 0); }
    }
    // ─── 4. things ───
    const O = this.obj;
    common(O); gl.uniform1i(O.u('uMode'), 1);
    for (const r of this.rocks) if (inView(r.z0, r.z1)) {
      if (away(r.z0, r.z1) < 110) { gl.bindVertexArray(r.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, r.count, r.n); }
      else { gl.bindVertexArray(r.far!); gl.drawArraysInstanced(gl.TRIANGLES, 0, r.farCount!, r.n); }
    }
    gl.uniform1i(O.u('uMode'), 0); gl.uniform2f(O.u('uPivot'), 0, 0);
    for (const p of this.props) if (inView(p.z0, p.z1)) { gl.bindVertexArray(p.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, p.count, 1); }
    for (const d of f.draws) { const k = this.kinds.get(d.kind); if (k && d.list.n) { gl.uniform2fv(O.u('uPivot'), k.pivot); gl.bindVertexArray(k.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, k.count, d.list.n); } }
    // ─── 5. the sea ───
    const Wp = this.water;
    common(Wp);
    gl.uniform3fv(Wp.u('uDeep'), lin(W.deep)); gl.uniform3fv(Wp.u('uBody'), lin(W.body)); gl.uniform3f(Wp.u('uSeaLook'), W.foam, W.rain, W.wind);
    const S = Renderer.WS;
    gl.uniform2f(Wp.u('uOffset'), Math.round(fx / S) * S, Math.round((fz + 25) / S) * S);
    gl.uniform4fv(Wp.u('uHoles'), f.holes.length ? f.holes : new Float32Array(48)); gl.uniform1i(Wp.u('uHoleCount'), f.holeCount);
    gl.bindVertexArray(this.waterVao); gl.drawElements(gl.TRIANGLES, this.waterCount, gl.UNSIGNED_INT, 0);
    // ─── 6. wakes, 7. marks ───
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    if (f.wakeCount) {
      common(this.wake);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.wakeBuf); gl.bufferData(gl.ARRAY_BUFFER, f.wakes.subarray(0, f.wakeCount * WSTRIDE), gl.DYNAMIC_DRAW);
      gl.bindVertexArray(this.wakeVao); gl.drawArrays(gl.TRIANGLES, 0, f.wakeCount);
    }
    if (f.fxCount) {
      common(this.fx);
      gl.uniform3fv(this.fx.u('uRight'), f.right); gl.uniform3fv(this.fx.u('uUp'), f.up);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.fxBuf); gl.bufferData(gl.ARRAY_BUFFER, f.fx.subarray(0, f.fxCount * FSTRIDE), gl.DYNAMIC_DRAW);
      gl.bindVertexArray(this.fxVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, f.fxCount);
    }
    gl.depthMask(true); gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}

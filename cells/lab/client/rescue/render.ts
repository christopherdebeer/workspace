/**
 * The rescue race, drawn (WebGL2). Bright and plain, a toy on a sunny day:
 *
 * - **the land and the seabed** (one heightfield, `sea.ts`, in pieces along the course): sand under the water, wet sand
 *   at its edge, dry sand, grass rising inland, rock where it's steep; light netting across the seabed in the shallows;
 * - **what stands about** (`mesh.ts`'s world, in pieces: only those near the camera drawn), palms swaying;
 * - **the things that move**, each kind one mesh drawn many times over (instances: where, which way, pitched and rolled
 *   by the waves, its colours, how its arms are, its flag's flutter): the big boats, the tiny boats, the people (with
 *   hair, or a sun hat), the buoys;
 * - **the water** over all of it: a grid round the camera lifted by the swells (`sea.ts`'s `WAVES`, the same sums the
 *   boats bob on), its colour by its depth (turquoise over the sand, blue out deep), clear in the shallows, the sky in it
 *   at a slant, the sun glinting, foam rolling in along every shore;
 * - **marks on the water** (`fx.ts`): wakes, ripples, splashes, sparkles, the soft shadow under a boat, the ring round a
 *   tiny boat that says how near is near enough, the chequered band floating along the finish line.
 */
import { CELL, NX, NZ, X0, Z0, wavesGlsl, type Sea } from './sea';
import { STRIDE, type Mesh } from './mesh';

export type M4 = Float32Array;
export const mat4 = {
  perspective(fovy: number, aspect: number, near: number, far: number): M4 {
    const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = (2 * far * near) / (near - far);
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
    const inv = new Float32Array(16), a = m;
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

/** an instance: 20 floats (where and which way; pitch, roll, scale, left arm; colour A, right arm; colour B, -; colour C, flutter) */
export const ISTRIDE = 20;
export class Instances {
  data: Float32Array; n = 0;
  constructor(max: number) { this.data = new Float32Array(max * ISTRIDE); }
  clear() { this.n = 0; }
  push(x: number, y: number, z: number, yaw: number, pitch: number, roll: number, scale: number, armL: number, a: readonly number[], armR: number, b: readonly number[], c: readonly number[], phase: number) {
    if ((this.n + 1) * ISTRIDE > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    const d = this.data, o = this.n++ * ISTRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = yaw; d[o + 4] = pitch; d[o + 5] = roll; d[o + 6] = scale; d[o + 7] = armL;
    d[o + 8] = a[0]; d[o + 9] = a[1]; d[o + 10] = a[2]; d[o + 11] = armR; d[o + 12] = b[0]; d[o + 13] = b[1]; d[o + 14] = b[2]; d[o + 15] = 1;
    d[o + 16] = c[0]; d[o + 17] = c[1]; d[o + 18] = c[2]; d[o + 19] = phase;
  }
}

/** a mark on the water or in the air (fx.ts): 12 floats (where, size; kind, alpha, turn, stretch; colour, seed) */
export const FSTRIDE = 12;
export const FX = { FOAM: 0, RING: 1, SHADOW: 2, NEAR: 3, DROP: 4, SPARK: 5, CHEQUER: 6 } as const;

export interface Frame {
  vp: M4; eye: number[]; time: number;
  /** the camera's right and up (for the marks that face it) */
  right: number[]; up: number[];
  /** what of the course is in view: the drawing draws only the pieces of land and world there */
  zMin: number; zMax: number; centre: [number, number];
  boats: Instances; tinies: Instances; people: Instances; hats: Instances; buoys: Instances;
  fx: Float32Array; fxCount: number;
}

/** toward the sun: high, off to the side (the screen's right), a little ahead; its glitter mostly off the screen */
const SUN = [-0.6, 0.76, 0.18];
{ const l = Math.hypot(SUN[0], SUN[1], SUN[2]); SUN[0] /= l; SUN[1] /= l; SUN[2] /= l; }
export const SKY = [0.62, 0.82, 0.97];

const LIGHT = `
uniform vec3 uEye; uniform vec3 uSun; uniform float uTime;
vec3 lit(vec3 col, vec3 N, vec3 P, float shine) {
  vec3 V = normalize(uEye - P);
  float ndl = max(dot(N, uSun), 0.);
  vec3 amb = mix(vec3(.36, .42, .42), vec3(.62, .75, .88), N.y * .5 + .5);
  vec3 c = col * (amb * .6 + vec3(1., .95, .86) * ndl * .72);
  c += pow(1. - max(dot(N, V), 0.), 3.) * vec3(.16, .2, .24);
  c += pow(max(dot(N, normalize(uSun + V)), 0.), 40.) * shine * vec3(1., .97, .9);
  return c;
}
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }`;

const BED = `
uniform sampler2D uBed; uniform vec4 uBedBox;
/** the seabed's height at a point (the heightfield's texels sit at its samples) */
float bed(vec2 p) {
  vec2 uv = vec2(((p.x - uBedBox.x) / uBedBox.z + .5) / ${NX.toFixed(1)}, ((p.y - uBedBox.y) / uBedBox.z + .5) / ${NZ.toFixed(1)});
  if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return -8.;
  return texture(uBed, uv).r;
}`;

const OBJ_VS = `#version 300 es
layout(location = 0) in vec3 aPos; layout(location = 1) in vec3 aNor; layout(location = 2) in vec4 aCol;
layout(location = 3) in vec4 iPos; layout(location = 4) in vec4 iTilt; layout(location = 5) in vec4 iA; layout(location = 6) in vec4 iB; layout(location = 7) in vec4 iC;
uniform mat4 uVP; uniform float uTime;
out vec3 vNor; out vec3 vCol; out vec3 vWorld; out float vKind;
void main() {
  float part = aCol.a, pi = floor(part + .001), w = part - pi;
  vec3 p = aPos * iTilt.z, n = aNor, col = aCol.rgb;
  vKind = 0.;
  if (pi == 1.) col = iA.rgb;
  else if (pi == 2.) col = iB.rgb;
  else if (pi == 3.) col = iC.rgb;
  else if (pi == 4. || pi == 5.) {
    // (an arm: turned out and up about its shoulder)
    float s = pi == 4. ? -1. : 1., a = s * (pi == 4. ? iTilt.w : iA.w);
    vec2 sh = vec2(s * .31, .72) * iTilt.z, d = p.xy - sh;
    float c = cos(a), sn = sin(a);
    p.xy = sh + vec2(c * d.x - sn * d.y, sn * d.x + c * d.y);
    n.xy = vec2(c * n.x - sn * n.y, sn * n.x + c * n.y);
    col = iB.rgb;
  } else if (pi == 6. || pi == 11.) {
    // (a flag: fluttering, more toward its free end)
    if (pi == 6.) col = iA.rgb;
    p.x += (sin(uTime * 8. + w * 7. + iC.a) * .2 + sin(uTime * 13. + w * 11. + iC.a * 2.) * .05) * w * iTilt.z;
  } else if (pi == 7.) {
    // (a leaf: swaying in the breeze, more toward its tip)
    p.x += sin(uTime * 1.4 + p.x * .21 + p.z * .17) * .18 * w;
    p.z += cos(uTime * 1.1 + p.x * .13) * .12 * w;
  } else if (pi == 9.) vKind = 1.;
  else if (pi == 10.) vKind = 2.;
  float cr = cos(iTilt.y), sr = sin(iTilt.y), cp = cos(iTilt.x), sp = sin(iTilt.x), cy = cos(iPos.w), sy = sin(iPos.w);
  p = vec3(p.x * cr - p.y * sr, p.x * sr + p.y * cr, p.z); n = vec3(n.x * cr - n.y * sr, n.x * sr + n.y * cr, n.z);
  p = vec3(p.x, p.y * cp + p.z * sp, -p.y * sp + p.z * cp); n = vec3(n.x, n.y * cp + n.z * sp, -n.y * sp + n.z * cp);
  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy); n = vec3(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy);
  vWorld = p + iPos.xyz; vNor = n; vCol = col;
  gl_Position = uVP * vec4(vWorld, 1.);
}`;
const OBJ_FS = `#version 300 es
precision highp float;
in vec3 vNor; in vec3 vCol; in vec3 vWorld; in float vKind;
out vec4 o;
${LIGHT}
void main() {
  vec3 N = normalize(vNor);
  if (!gl_FrontFacing) N = -N;
  vec3 c = lit(vCol, N, vWorld, .18);
  if (vKind > .5 && vKind < 1.5) c = vCol * 1.1 + .12;
  else if (vKind > 1.5) {
    vec3 V = normalize(uEye - vWorld);
    c = vCol + pow(1. - max(dot(N, V), 0.), 2.) * vec3(.3, .38, .45) + pow(max(dot(reflect(-V, N), uSun), 0.), 24.) * .7;
  }
  o = vec4(c, 1.);
}`;

const LAND_VS = `#version 300 es
layout(location = 0) in vec3 aPos; layout(location = 1) in vec3 aNor; layout(location = 2) in vec3 aCol;
uniform mat4 uVP;
out vec3 vNor; out vec3 vCol; out vec3 vWorld;
void main() { vWorld = aPos; vNor = aNor; vCol = aCol; gl_Position = uVP * vec4(aPos, 1.); }`;
const LAND_FS = `#version 300 es
precision highp float;
in vec3 vNor; in vec3 vCol; in vec3 vWorld;
out vec4 o;
${LIGHT}
void main() {
  vec3 N = normalize(vNor), c = lit(vCol, N, vWorld, 0.);
  if (vWorld.y < .05) {
    // (under the water: the sun netting the sand, strongest in the shallows)
    float d = max(0., -vWorld.y), k = exp(-d * .35) * smoothstep(0., .4, d);
    vec2 q = vWorld.xz * .55;
    float n1 = noise2(q + vec2(uTime * .35, uTime * .21)), n2 = noise2(q * 1.3 - vec2(uTime * .27, -uTime * .31) + 7.);
    float net = pow(1. - abs(n1 - n2) * 2.2, 6.);
    c += net * k * vec3(.32, .34, .28);
  }
  o = vec4(c, 1.);
}`;

const WATER_VS = `#version 300 es
layout(location = 0) in vec2 aXZ;
uniform mat4 uVP; uniform float uTime; uniform vec2 uOffset;
${BED}
${wavesGlsl()}
out vec3 vWorld; out float vBed;
void main() {
  vec2 p = aXZ + uOffset;
  float b = bed(p), calm = smoothstep(.4, 4.5, -b);
  vec3 w = waves(p, uTime, calm);
  vWorld = vec3(p.x, w.x, p.y); vBed = b;
  gl_Position = uVP * vec4(vWorld, 1.);
}`;
const WATER_FS = `#version 300 es
precision highp float;
in vec3 vWorld; in float vBed;
uniform vec3 uSky;
out vec4 o;
${LIGHT}
${BED}
${wavesGlsl()}
void main() {
  vec2 p = vWorld.xz;
  float b = bed(p), depth = vWorld.y - b, calm = smoothstep(.4, 4.5, -b);
  vec3 w = waves(p, uTime, calm);
  // (the surface's slope, and a finer chop that scrolls over it)
  vec2 d1 = vec2(noise2(p * .9 + vec2(uTime * .6, uTime * .3)) - noise2(p * .9 + vec2(uTime * .6 + .7, uTime * .3)), noise2(p * .9 + vec2(uTime * .6, uTime * .3) + vec2(0., .7)) - noise2(p * .9 + vec2(uTime * .6, uTime * .3)));
  vec2 d2 = vec2(noise2(p * 2.3 - vec2(uTime * .4, -uTime * .8)) - noise2(p * 2.3 - vec2(uTime * .4 - .5, -uTime * .8)), noise2(p * 2.3 - vec2(uTime * .4, -uTime * .8) + vec2(0., .5)) - noise2(p * 2.3 - vec2(uTime * .4, -uTime * .8)));
  vec3 N = normalize(vec3(-w.y - d1.x * .16 - d2.x * .08, 1., -w.z - d1.y * .16 - d2.y * .08));
  vec3 V = normalize(uEye - vWorld);
  float fres = .02 + .98 * pow(1. - max(dot(N, V), 0.), 5.);
  // (its colour by how deep: turquoise over sand, blue out deep; clear where it's shallow)
  vec3 col = mix(vec3(.38, .88, .84), vec3(.16, .64, .82), smoothstep(.4, 3.2, depth));
  col = mix(col, vec3(.1, .45, .76), smoothstep(3., 8.5, depth));
  col *= .95 + .1 * noise2(p * .04 + uTime * .01);
  float alpha = mix(.4, 1., smoothstep(.15, 5.5, depth));
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSky * 1.05, vec3(.9, .95, 1.), pow(max(R.y, 0.), .5) * .3);
  col = mix(col, sky, fres * .55);
  float spec = pow(max(dot(R, uSun), 0.), 300.) * 1.1 + pow(max(dot(R, uSun), 0.), 24.) * .1;
  col += spec * vec3(1., .97, .9);
  // (now and then a sparkle where the chop catches the sun)
  float sp = noise2(p * 3. + vec2(uTime * 1.3, -uTime * .9)) * noise2(p * 2.3 - vec2(uTime * .7, uTime * 1.1));
  col += smoothstep(.66, .74, sp) * .22;
  // (foam: rolling in along every shore, and the line at the water's edge)
  float n = noise2(p * .35 + uTime * .05);
  float roll = smoothstep(1.3, .2, depth) * smoothstep(.15, .75, sin(depth * 7. - uTime * 2.1 + n * 5.) * .5 + .5);
  float edge = smoothstep(.45, .08, depth);
  float foam = clamp(max(roll * .75, edge) * (.65 + .35 * noise2(p * 1.7 + uTime * .2)), 0., 1.);
  // (a crest here and there out on the open water)
  foam = max(foam, smoothstep(.27, .33, w.x * calm) * smoothstep(.7, .8, noise2(p * .5 + uTime * .1)) * .45);
  col = mix(col, vec3(.97, .99, 1.), foam);
  alpha = max(alpha, foam);
  o = vec4(col, alpha);
}`;

const FX_VS = `#version 300 es
layout(location = 0) in vec2 aC;
layout(location = 1) in vec4 iP; layout(location = 2) in vec4 iD; layout(location = 3) in vec4 iCol;
uniform mat4 uVP; uniform float uTime; uniform vec3 uRight; uniform vec3 uUp;
${BED}
${wavesGlsl()}
out vec2 vUV; out float vKind; out float vAlpha; out vec3 vCol; out float vSeed;
void main() {
  float kind = iD.x;
  vUV = aC; vKind = kind; vAlpha = iD.y; vCol = iCol.rgb; vSeed = iCol.a;
  vec3 wp;
  if (kind < 3.5 || kind > 5.5) {
    // (lying on the water, riding its swell)
    float c = cos(iD.z), s = sin(iD.z);
    vec2 q = vec2(c * aC.x - s * aC.y * iD.w, s * aC.x + c * aC.y * iD.w) * iP.w;
    vec2 p = iP.xz + q;
    float b = bed(p);
    vec3 w = waves(p, uTime, smoothstep(.4, 4.5, -b));
    wp = vec3(p.x, w.x + (kind == 2. ? .04 : .07), p.y);
  } else wp = iP.xyz + (uRight * aC.x + uUp * aC.y) * iP.w;
  gl_Position = uVP * vec4(wp, 1.);
}`;
const FX_FS = `#version 300 es
precision highp float;
in vec2 vUV; in float vKind; in float vAlpha; in vec3 vCol; in float vSeed;
uniform float uTime;
out vec4 o;
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float d = length(vUV), a = 0.;
  vec3 c = vCol;
  if (vKind < .5) a = smoothstep(1., .35, d + (noise2(vUV * 2.6 + vSeed * 13.) - .5) * .7) * (.55 + .45 * noise2(vUV * 5. + vSeed * 7.));
  else if (vKind < 1.5) a = smoothstep(.16, 0., abs(d - .84)) * (.6 + .4 * noise2(vUV * 4. + vSeed));
  else if (vKind < 2.5) { a = smoothstep(1., .15, d) * .8; c = vec3(.02, .1, .18); }
  else if (vKind < 3.5) {
    float ang = atan(vUV.y, vUV.x), dash = step(.45, fract(ang / 6.2832 * 28. + uTime * .25));
    a = smoothstep(.06, 0., abs(d - .95)) * dash;
  } else if (vKind < 4.5) { a = smoothstep(1., .55, d); c = mix(c, vec3(1.), .3); }
  else if (vKind > 5.5) {
    // (the finish: black and white squares, two across and one deep)
    vec2 q = floor((vUV + 1.) * vec2(1., .5));
    c = mod(q.x + q.y + vSeed, 2.) < .5 ? vec3(.08) : vec3(.97);
    a = .92 * smoothstep(1., .9, abs(vUV.y));
  } else {
    float st = max(0., 1. - abs(vUV.x * vUV.y) * 22.) * smoothstep(1., .2, d) + smoothstep(.35, 0., d);
    a = clamp(st, 0., 1.);
  }
  a *= vAlpha;
  if (a < .004) discard;
  o = vec4(c, a);
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

/** a mesh in the GPU, drawn as many times as it has instances */
interface Kind { vao: WebGLVertexArrayObject; count: number; inst: WebGLBuffer }
interface Piece { z0: number; z1: number; vao: WebGLVertexArrayObject; count: number; indexed: boolean }

export class Renderer {
  gl: WebGL2RenderingContext;
  private obj: Prog; private land: Prog; private water: Prog; private fx: Prog;
  private kinds = new Map<string, Kind>();
  private terrain: Piece[] = []; private world: Piece[] = [];
  private bedTex: WebGLTexture | null = null;
  private waterVao: WebGLVertexArrayObject; private waterCount: number;
  private fxVao: WebGLVertexArrayObject; private fxBuf: WebGLBuffer;
  private ident: WebGLBuffer;
  private buffers: WebGLBuffer[] = [];
  private vaos: WebGLVertexArrayObject[] = [];
  /** the water's grid: how many cells each way, and how far apart */
  static readonly WN = 150; static readonly WS = 2;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.obj = compile(gl, OBJ_VS, OBJ_FS);
    this.land = compile(gl, LAND_VS, LAND_FS);
    this.water = compile(gl, WATER_VS, WATER_FS);
    this.fx = compile(gl, FX_VS, FX_FS);
    // (the water's grid, round the origin: moved to the camera each frame)
    const N = Renderer.WN, S = Renderer.WS, xz = new Float32Array((N + 1) * (N + 1) * 2), idx = new Uint32Array(N * N * 6);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { xz[(j * (N + 1) + i) * 2] = (i - N / 2) * S; xz[(j * (N + 1) + i) * 2 + 1] = (j - N / 2) * S; }
    let k = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i; idx[k++] = a; idx[k++] = a + N + 1; idx[k++] = a + 1; idx[k++] = a + 1; idx[k++] = a + N + 1; idx[k++] = a + N + 2; }
    this.waterVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.waterVao);
    const wb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, wb); gl.bufferData(gl.ARRAY_BUFFER, xz, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    const wi = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wi); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.waterCount = idx.length;
    // (the marks: one quad, many instances)
    this.fxVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.fxVao);
    const qb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, qb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    this.fxBuf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.fxBuf);
    for (let a = 0; a < 3; a++) { gl.enableVertexAttribArray(1 + a); gl.vertexAttribPointer(1 + a, 4, gl.FLOAT, false, FSTRIDE * 4, a * 16); gl.vertexAttribDivisor(1 + a, 1); }
    gl.bindVertexArray(null);
    // (one instance that leaves the world's mesh where it is)
    this.ident = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ident);
    const id = new Float32Array(ISTRIDE); id[6] = 1; id[15] = 1;
    gl.bufferData(gl.ARRAY_BUFFER, id, gl.STATIC_DRAW);
  }

  /** a mesh's vertices into a vertex array, with its instances' attributes (from `inst`) */
  private meshVao(mesh: Mesh, inst: WebGLBuffer) {
    const gl = this.gl, vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE * 4, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE * 4, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, STRIDE * 4, 24);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    for (let a = 0; a < 5; a++) { gl.enableVertexAttribArray(3 + a); gl.vertexAttribPointer(3 + a, 4, gl.FLOAT, false, ISTRIDE * 4, a * 16); gl.vertexAttribDivisor(3 + a, 1); }
    gl.bindVertexArray(null);
    this.buffers.push(vb); this.vaos.push(vao);
    return vao;
  }

  /** a kind of thing that moves: its mesh, drawn once for each of its instances */
  addKind(name: string, mesh: Mesh) {
    const inst = this.gl.createBuffer()!;
    this.kinds.set(name, { vao: this.meshVao(mesh, inst), count: mesh.count, inst });
  }

  /** a sea to draw: its land and seabed (a heightfield, in pieces along the course; and as a texture, for the water), and its world */
  setSea(sea: Sea, world: Array<{ z0: number; z1: number; mesh: Mesh }>) {
    const gl = this.gl;
    for (const p of [...this.terrain, ...this.world]) gl.deleteVertexArray(p.vao);
    this.terrain = []; this.world = [];
    // (the heightfield as a texture: the water reads its depth from it)
    if (this.bedTex) gl.deleteTexture(this.bedTex);
    this.bedTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.bedTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, NX, NZ, 0, gl.RED, gl.FLOAT, sea.heights);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // (the land and the seabed, in pieces of 50 rows: each its own vertices, and the quads that can be seen (not deep under water))
    const H = sea.heights, ROWS = 50;
    for (let j0 = 0; j0 < NZ - 1; j0 += ROWS) {
      const j1 = Math.min(NZ - 1, j0 + ROWS), nr = j1 - j0 + 1, v = new Float32Array(nr * NX * 9), idx: number[] = [];
      for (let j = j0; j <= j1; j++) for (let i = 0; i < NX; i++) {
        const h = H[j * NX + i], o = ((j - j0) * NX + i) * 9;
        const hx = (H[j * NX + Math.min(NX - 1, i + 1)] - H[j * NX + Math.max(0, i - 1)]) / (2 * CELL), hz = (H[Math.min(NZ - 1, j + 1) * NX + i] - H[Math.max(0, j - 1) * NX + i]) / (2 * CELL);
        const nl = Math.hypot(hx, 1, hz), x = X0 + i * CELL, z = Z0 + j * CELL;
        v[o] = x; v[o + 1] = h; v[o + 2] = z; v[o + 3] = -hx / nl; v[o + 4] = 1 / nl; v[o + 5] = -hz / nl;
        const [r, g, b] = landColour(h, Math.hypot(hx, hz), x, z);
        v[o + 6] = r; v[o + 7] = g; v[o + 8] = b;
      }
      for (let j = j0; j < j1; j++) for (let i = 0; i < NX - 1; i++) {
        const a = j * NX + i;
        if (Math.max(H[a], H[a + 1], H[a + NX], H[a + NX + 1]) < -6.8) continue;
        const la = (j - j0) * NX + i;
        idx.push(la, la + NX, la + 1, la + 1, la + NX, la + NX + 1);
      }
      if (!idx.length) continue;
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const vb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
      const ib = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      this.terrain.push({ z0: Z0 + j0 * CELL, z1: Z0 + j1 * CELL, vao, count: idx.length, indexed: true });
    }
    for (const w of world) this.world.push({ z0: w.z0, z1: w.z1, vao: this.meshVao(w.mesh, this.ident), count: w.mesh.count, indexed: false });
  }

  draw(f: Frame, width: number, height: number) {
    const gl = this.gl;
    gl.viewport(0, 0, width, height);
    gl.clearColor(SKY[0], SKY[1], SKY[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
    const common = (p: Prog) => {
      gl.useProgram(p.p);
      gl.uniformMatrix4fv(p.u('uVP'), false, f.vp);
      gl.uniform3fv(p.u('uEye'), f.eye); gl.uniform3fv(p.u('uSun'), SUN); gl.uniform1f(p.u('uTime'), f.time);
    };
    const near = (z0: number, z1: number) => z1 >= f.zMin && z0 <= f.zMax;
    // ─── the land and the seabed ───
    common(this.land);
    for (const t of this.terrain) if (near(t.z0, t.z1)) { gl.bindVertexArray(t.vao); gl.drawElements(gl.TRIANGLES, t.count, gl.UNSIGNED_INT, 0); }
    // ─── what stands about, and what moves ───
    common(this.obj);
    for (const w of this.world) if (near(w.z0, w.z1)) { gl.bindVertexArray(w.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, w.count, 1); }
    for (const [name, list] of [['big', f.boats], ['tiny', f.tinies], ['person', f.people], ['hat', f.hats], ['buoy', f.buoys]] as const) {
      const k = this.kinds.get(name);
      if (!k || !list.n) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, k.inst);
      gl.bufferData(gl.ARRAY_BUFFER, list.data.subarray(0, list.n * ISTRIDE), gl.DYNAMIC_DRAW);
      gl.bindVertexArray(k.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, k.count, list.n);
    }
    // ─── the water, over all of it ───
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    common(this.water);
    const bedBox = [X0, Z0, CELL, NX];
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.bedTex);
    gl.uniform1i(this.water.u('uBed'), 0); gl.uniform4fv(this.water.u('uBedBox'), bedBox);
    gl.uniform3fv(this.water.u('uSky'), SKY);
    const S = Renderer.WS;
    gl.uniform2f(this.water.u('uOffset'), Math.round(f.centre[0] / S) * S, Math.round(f.centre[1] / S) * S);
    gl.bindVertexArray(this.waterVao);
    gl.drawElements(gl.TRIANGLES, this.waterCount, gl.UNSIGNED_INT, 0);
    // ─── the marks on it ───
    if (f.fxCount) {
      gl.depthMask(false);
      common(this.fx);
      gl.uniform1i(this.fx.u('uBed'), 0); gl.uniform4fv(this.fx.u('uBedBox'), bedBox);
      gl.uniform3fv(this.fx.u('uRight'), f.right); gl.uniform3fv(this.fx.u('uUp'), f.up);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.fxBuf);
      gl.bufferData(gl.ARRAY_BUFFER, f.fx.subarray(0, f.fxCount * FSTRIDE), gl.DYNAMIC_DRAW);
      gl.bindVertexArray(this.fxVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, f.fxCount);
      gl.depthMask(true);
    }
    gl.bindVertexArray(null);
  }
}

/** the land's colour: sand under the water, wet sand at its edge, dry sand, grass rising inland, rock where it's steep */
function landColour(h: number, slope: number, x: number, z: number): [number, number, number] {
  const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const sm = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const n = Math.sin(x * 0.31 + Math.sin(z * 0.17) * 2) * Math.cos(z * 0.27 + Math.sin(x * 0.13) * 2);
  let c: number[];
  if (h < -0.25) c = mix([0.9, 0.83, 0.64], [0.6, 0.68, 0.6], sm(-0.5, -7, h));
  else if (h < 0.3) c = mix([0.82, 0.73, 0.54], [0.95, 0.87, 0.64], sm(-0.25, 0.3, h));
  else {
    c = mix([0.97, 0.89, 0.66], mix([0.5, 0.77, 0.34], [0.38, 0.64, 0.29], 0.5 + 0.5 * n), sm(1.4, 2.1, h));
    c = mix(c, [0.62, 0.58, 0.52], sm(0.75, 1.3, slope));
  }
  const k = 1 + n * 0.05;
  return [c[0] * k, c[1] * k, c[2] * k];
}

/**
 * Drawing it: the wooden figure on its turned stand on the workbench, and the garments on it, in a warm workroom
 * light. One key light (the window, high to the left) casts shadows (a shadow map, so a fold shades the cloth under
 * it); the room's light fills from above and the bench bounces warm from below.
 *
 * The cloth is drawn from where each point lies on its flat pattern piece (centimetres): the print's laid on the
 * pieces as it would be on cut cloth, so stripes chevron where a flared skirt's gores meet, and a check runs off true
 * at a bias seam. Fabric changes the light: silk's sheen, wool's soft fuzz at a glance, a weave you can just see,
 * tulle you can see through. Every piece is stitched near its edges.
 */
import * as body from './body';
import { BALLS, HEAD, LIMBS, PELVIS, TORSO_FOOT, TORSO_TOP, section, type V3 } from './body';
import type { Cloth } from './cloth';
import type { Fabric, Print } from './fabric';

const COMMON = `
uniform vec3 uKey, uKeyCol;
uniform sampler2D uShadow;
uniform mat4 uLightVP;
float shadowAt(vec3 p, vec3 n) {
  vec4 l = uLightVP * vec4(p + n * .6, 1.);
  vec3 c = l.xyz / l.w * .5 + .5;
  if (c.x < 0. || c.x > 1. || c.y < 0. || c.y > 1.) return 1.;
  float s = 0., px = 1. / 2048.;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) s += c.z - .0015 > texture(uShadow, c.xy + vec2(i, j) * px * 1.5).r ? 0. : 1.;
  return s / 9.;
}
vec3 ambient(vec3 n) {
  // (the room: a pale ceiling, warm walls, the bench's wood bouncing up)
  return mix(vec3(.42, .34, .26), vec3(.62, .64, .68), n.y * .5 + .5) * .55;
}
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 finish(vec3 c) { c = c / (1. + c * .35); return pow(clamp(c, 0., 1.), vec3(1. / 2.2)); }
`;

/** the clothes rails' size (cm): the bar's height above the floor (y = −5 is the floor), its length */
export const RAIL_Y = 140, RAIL_W = 170, FLOOR = -5;
/** a hanger's hook: how far above the skirt's waist it pivots on the bar */
export const HOOK = 13;

const SOLID_VS = `#version 300 es
in vec3 aPos; in vec3 aNor; in float aMat;
uniform mat4 uVP, uModel; uniform float uSpin;
out vec3 vPos; out vec3 vNor; out vec3 vObj; flat out int vMat;
// (the figure and its stand turn; the bench and wall don't)
vec3 turn(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c); }
void main() {
  float a = aMat < 1.5 ? uSpin : 0.;
  vObj = aPos; vPos = (uModel * vec4(turn(aPos, a), 1.)).xyz; vNor = mat3(uModel) * turn(aNor, a); vMat = int(aMat + .5); gl_Position = uVP * vec4(vPos, 1.);
}`;
const SOLID_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNor; in vec3 vObj; flat in int vMat;
uniform vec3 uEye, uTint;
out vec4 o;
${COMMON}
void main() {
  vec3 n = normalize(vNor), V = normalize(uEye - vPos);
  vec3 base; float spec = .0, rough = 40.;
  if (vMat == 0 || vMat == 5) {
    // (the figure, and the hangers: beech, varnished; its grain running along it, a turned piece's rings)
    float g = noise(vec3(vObj.x * .9, vObj.y * .06, vObj.z * .9)) * .6 + noise(vObj * vec3(2.2, .25, 2.2)) * .4;
    float ring = .5 + .5 * sin(length(vObj.xz) * 2.4 + g * 6.);
    base = mix(vec3(.80, .60, .40), vec3(.70, .49, .30), ring * .5 + g * .3);
    spec = .35; rough = 60.;
  } else if (vMat == 1) {
    // (the stand: the same wood, darker, turned)
    float ring = .5 + .5 * sin(length(vObj.xz) * 3. + noise(vObj * .5) * 4.);
    base = mix(vec3(.52, .34, .2), vec3(.42, .26, .15), ring); spec = .4; rough = 50.;
  } else if (vMat == 2) {
    // (the workbench: oak boards, worn)
    float board = floor(vPos.z / 18.), g = noise(vec3(vPos.x * .05, board * 7.3, vPos.z * 1.2)) * .7 + noise(vPos * .3) * .3;
    base = mix(vec3(.66, .5, .34), vec3(.56, .41, .27), g) * (1. - .25 * smoothstep(.45, .5, abs(fract(vPos.z / 18.) - .5)));
    spec = .12; rough = 20.;
  } else if (vMat == 4) {
    // (metal: a clothes rail's tube, powder-coated in its owner's colour, or a hanger's chromed hook)
    base = uTint; spec = 1.4; rough = 90.;
  } else {
    // (the wall behind: warm plaster, a little light from the window across it)
    base = vec3(.86, .8, .72) * (.9 + .1 * noise(vPos * .05));
  }
  float NoL = max(dot(n, uKey), 0.), sh = shadowAt(vPos, n);
  vec3 H = normalize(uKey + V);
  vec3 c = base * (ambient(n) + uKeyCol * NoL * sh) + uKeyCol * spec * pow(max(dot(n, H), 0.), rough) * sh * NoL;
  o = vec4(finish(c), 1.);
}`;

const CLOTH_VS = `#version 300 es
in vec3 aPos; in vec3 aNor; in vec2 aFlat; in vec2 aEdge;
uniform mat4 uVP, uModel;
out vec3 vPos; out vec3 vNor; out vec2 vFlat; out vec2 vEdge;
void main() { vPos = (uModel * vec4(aPos, 1.)).xyz; vNor = mat3(uModel) * aNor; vFlat = aFlat; vEdge = aEdge; gl_Position = uVP * vec4(vPos, 1.); }`;
const CLOTH_FS = `#version 300 es
precision highp float;
in vec3 vPos; in vec3 vNor; in vec2 vFlat; in vec2 vEdge;
uniform vec3 uEye, uInk0, uInk1, uInk2;
uniform float uKind, uScale, uSheen, uFuzz, uClear, uWeave;
out vec4 o;
${COMMON}
vec3 printAt(vec2 p) {
  p /= uScale;
  int kind = int(uKind + .5);
  if (kind == 1) { float s = fract(p.x / 3.2); return s < .34 ? uInk1 : (abs(s - .67) < .04 ? uInk2 : uInk0); }
  if (kind == 2) { float a = step(fract(p.x / 2.6), .5), b = step(fract(p.y / 2.6), .5); return mix(mix(uInk0, uInk1, .45 * (a + b)), uInk1, a * b); }
  if (kind == 3) { vec2 q = p / 2.8; q.x += .5 * mod(floor(q.y), 2.); vec2 f = fract(q) - .5; return length(f) < .2 ? uInk1 : uInk0; }
  if (kind == 4) {
    vec2 q = p / 4.2; q.x += .5 * mod(floor(q.y), 2.); vec2 c = floor(q), f = fract(q) - .5;
    float ang = atan(f.y, f.x) + hash(vec3(c, 1.)) * 6.28, r = length(f);
    float petal = r - .32 * (.55 + .45 * abs(cos(ang * 2.5)));
    if (r < .09) return uInk2;
    if (petal < 0.) return uInk1;
    vec2 g = fract(q + .5) - .5; return length(g) < .05 ? uInk2 : uInk0;
  }
  if (kind == 5) {
    vec2 q = p / 4.; q.x += .5 * mod(floor(q.y), 2.); vec2 f = fract(q) - .5;
    float a = atan(f.x, f.y), k = 1.2566, w = abs(mod(a, k) - k * .5) / (k * .5);
    return length(f) < .13 + .17 * (1. - w) * (1. - w) ? (mod(floor(q.x) + floor(q.y), 2.) < 1. ? uInk1 : uInk2) : uInk0;
  }
  return uInk0;
}
void main() {
  vec3 n = normalize(vNor), V = normalize(uEye - vPos);
  bool back = dot(n, V) < 0.;
  if (back) n = -n;
  vec3 base = pow(printAt(vFlat), vec3(2.2));
  // (the weave: a fine cross-hatch, just there)
  vec2 w = abs(fract(vFlat * 6.) - .5);
  base *= 1. - uWeave * .08 * smoothstep(.3, .5, max(w.x, w.y));
  // (stitching along each piece's edges: a dashed line of thread just in from them)
  float e = min(vEdge.x, vEdge.y), along = vEdge.x < vEdge.y ? vFlat.y : vFlat.x;
  // (the thread: a darker shade of the cloth's own ground, as a dressmaker matches it)
  if (abs(e - .8) < .07 && fract(along / .5) < .6) base = mix(base, pow(mix(uInk0, uInk1, .55), vec3(2.2)) * .55, .8 * (1. - uClear));
  if (back) base *= .78;
  float NoV = max(dot(n, V), 0.), NoL = dot(n, uKey), sh = shadowAt(vPos, n);
  // (cloth takes light round its folds: a wrapped diffuse)
  float wrap = max((NoL + .35) / 1.35, 0.);
  vec3 H = normalize(uKey + V);
  vec3 c = base * (ambient(n) + uKeyCol * wrap * sh);
  c += uKeyCol * uSheen * .5 * pow(max(dot(n, H), 0.), 24.) * sh * max(NoL, 0.);
  c += uKeyCol * .04 * pow(max(dot(n, H), 0.), 8.) * sh;
  c += base * uFuzz * pow(1. - NoV, 2.5) * (ambient(n) + uKeyCol * .5 * sh) * 1.4;
  float a = 1. - uClear * (1. - .55 * pow(1. - NoV, 2.));
  o = vec4(finish(c), a);
}`;

const SHADOW_VS = `#version 300 es
in vec3 aPos; in float aMat; uniform mat4 uLightVP, uModel; uniform float uSpin;
void main() {
  float a = aMat < 1.5 ? uSpin : 0., c = cos(a), s = sin(a);
  gl_Position = uLightVP * uModel * vec4(aPos.x * c + aPos.z * s, aPos.y, -aPos.x * s + aPos.z * c, 1.);
}`;
const SHADOW_FS = `#version 300 es
precision highp float; out vec4 o; void main() { o = vec4(1.); }`;

type Mat4 = Float32Array;
function mul(a: Mat4, b: Mat4): Mat4 { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
function perspective(fov: number, asp: number, n: number, f: number): Mat4 { const t = 1 / Math.tan(fov / 2); return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]); }
function ortho(l: number, r: number, b: number, t: number, n: number, f: number): Mat4 { return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]); }
function lookAt(e: V3, c: V3, up: V3): Mat4 {
  const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(up, z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
}
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ─── the still things: figure, stand, bench, wall ──────────────────────────────────────────────
function solidMesh(part: 'scene' | 'rail' | 'hanger' | 'coat' | 'hook' = 'scene'): number[] {
  const out: number[] = [];
  const put = (p: V3, n: V3, m: number) => out.push(p[0], p[1], p[2], n[0], n[1], n[2], m);
  const quad = (a: [V3, V3], b: [V3, V3], c: [V3, V3], d: [V3, V3], m: number) => { for (const v of [a, b, c, a, c, d]) put(v[0], v[1], m); };
  // (the torso: lathed through its sections)
  const SEG = 48, RINGS = 46, ring = (y: number) => { const s = section(y); return Array.from({ length: SEG + 1 }, (_, k) => { const a = (k / SEG) * Math.PI * 2; return [Math.sin(a) * s.rx, y, s.cz + Math.cos(a) * s.rz] as V3; }); };
  const ys = Array.from({ length: RINGS + 1 }, (_, i) => TORSO_FOOT + ((TORSO_TOP - TORSO_FOOT) * i) / RINGS), R = ys.map(ring);
  const nAt = (i: number, k: number): V3 => {
    const p = R[i][k], s = section(p[1]), d0 = section(p[1] - 0.3), d1 = section(p[1] + 0.3), a = (k / SEG) * Math.PI * 2;
    return norm([Math.sin(a) / s.rx, -((d1.rx + d1.rz) - (d0.rx + d0.rz)) / 1.2 / ((s.rx + s.rz) / 2), Math.cos(a) / s.rz]);
  };
  for (let i = 0; i < RINGS; i++) for (let k = 0; k < SEG; k++) quad([R[i][k], nAt(i, k)], [R[i][k + 1], nAt(i, k + 1)], [R[i + 1][k + 1], nAt(i + 1, k + 1)], [R[i + 1][k], nAt(i + 1, k)], 0);
  // (limbs: capsules; joints and head: balls)
  const tube = (a: V3, b: V3, ra: number, rb: number, m: number) => {
    const ax = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), t = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] as V3 : [1, 0, 0] as V3, e1 = norm(cross(ax, t)), e2 = cross(ax, e1);
    const P = (f: number, k: number): [V3, V3] => { const r = ra + (rb - ra) * f, ang = (k / 20) * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang), dn: V3 = [e1[0] * c + e2[0] * s, e1[1] * c + e2[1] * s, e1[2] * c + e2[2] * s]; return [[a[0] + (b[0] - a[0]) * f + dn[0] * r, a[1] + (b[1] - a[1]) * f + dn[1] * r, a[2] + (b[2] - a[2]) * f + dn[2] * r], dn]; };
    for (let k = 0; k < 20; k++) quad(P(0, k), P(0, k + 1), P(1, k + 1), P(1, k), m);
  };
  const ball = (c: V3, r: number, m: number) => {
    const P = (i: number, k: number): [V3, V3] => { const th = (i / 14) * Math.PI, ph = (k / 24) * Math.PI * 2, n: V3 = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; return [[c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r], n]; };
    for (let i = 0; i < 14; i++) for (let k = 0; k < 24; k++) quad(P(i, k), P(i + 1, k), P(i + 1, k + 1), P(i, k + 1), m);
  };
  if (part === 'rail') {
    // (a clothes rail: two uprights on castored feet, a bar across the top; centred under the bar, on the floor)
    out.length = 0;
    for (const x of [-RAIL_W / 2, RAIL_W / 2]) {
      tube([x, -2, 0], [x, RAIL_Y + 1.5, 0], 1.4, 1.4, 4); ball([x, RAIL_Y + 1.5, 0], 1.5, 4);
      tube([x, 1, -24], [x, 1, 24], 1.5, 1.5, 4);
      for (const z of [-24, 24]) { ball([x, 1, z], 1.6, 4); ball([x, -2.6, z], 2.3, 4); }
    }
    tube([-RAIL_W / 2 - 3, RAIL_Y, 0], [RAIL_W / 2 + 3, RAIL_Y, 0], 1.3, 1.3, 4);
    tube([-RAIL_W / 2, 9, 0], [RAIL_W / 2, 9, 0], 1, 1, 4);
    return out;
  }
  if (part === 'hanger') {
    // (a skirt hanger: a beech bar with a clip at each end. Its origin's the waist of the skirt it holds)
    out.length = 0;
    tube([-17, 4.5, 0], [17, 4.5, 0], 1.1, 1.1, 5); ball([-17, 4.5, 0], 1.1, 5); ball([17, 4.5, 0], 1.1, 5);
    for (const x of [-14.5, 14.5]) tube([x, 4.2, 0], [x, 1.4, 0], 1.2, 1, 4);
    ball([0, 5.6, 0], 0.9, 4);
    return out;
  }
  if (part === 'coat') {
    // (a coat hanger, for what hangs from its shoulders: a beech bar sloping down each way from the hook, rounded at its
    // ends where the shoulders sit. Its origin's the top of the shoulders it holds)
    out.length = 0;
    for (const s of [-1, 1]) { tube([0, 4.4, 0], [s * 15.5, -1.2, 0], 1.25, 1.05, 5); ball([s * 15.5, -1.2, 0], 1.6, 5); }
    ball([0, 4.6, 0], 1.3, 5);
    tube([0, 4.6, 0], [0, 6.4, 0], 0.5, 0.5, 4);
    return out;
  }
  if (part === 'hook') {
    // (its chromed hook, which swivels: it stays over the rail's bar (along x) however the hanger's turned. It pivots
    // on the bar at HOOK above the skirt's waist)
    out.length = 0;
    tube([0, 5.4, 0], [0, HOOK - 2, 0], 0.35, 0.35, 4);
    let prev: V3 = [0, HOOK - 2, 0];
    for (let k = 1; k <= 14; k++) { const a = -Math.PI / 2 + (k / 14) * Math.PI * 1.35, q: V3 = [0, HOOK + Math.sin(a) * 2, Math.cos(a) * 2]; tube(prev, q, 0.35, 0.35, 4); prev = q; }
    return out;
  }
  for (const c of LIMBS) { tube(c.a, c.b, c.ra, c.rb, 0); ball(c.a, c.ra, 0); ball(c.b, c.rb, 0); }
  for (const b of BALLS) ball(b.c, b.r, 0);
  ball(HEAD.c, HEAD.r, 0);
  ball(PELVIS.c, PELVIS.r, 0);
  // (the stand: a turned disc, a little rounded at its edge, and the post up into the figure)
  const disc = (y0: number, y1: number, r0: number, r1: number, m: number) => {
    for (let k = 0; k < 48; k++) {
      const a0 = (k / 48) * Math.PI * 2, a1 = ((k + 1) / 48) * Math.PI * 2, s = (r0 - r1) / (y1 - y0);
      const n0 = norm([Math.sin(a0), s, Math.cos(a0)]), n1 = norm([Math.sin(a1), s, Math.cos(a1)]);
      quad([[Math.sin(a0) * r0, y0, Math.cos(a0) * r0], n0], [[Math.sin(a1) * r0, y0, Math.cos(a1) * r0], n1], [[Math.sin(a1) * r1, y1, Math.cos(a1) * r1], n1], [[Math.sin(a0) * r1, y1, Math.cos(a0) * r1], n0], m);
      quad([[0, y1, 0], [0, 1, 0]], [[Math.sin(a0) * r1, y1, Math.cos(a0) * r1], [0, 1, 0]], [[Math.sin(a1) * r1, y1, Math.cos(a1) * r1], [0, 1, 0]], [[0, y1, 0], [0, 1, 0]], m);
    }
  };
  disc(-5, -3, 27, 27.5, 1); disc(-3, -1, 27.5, 26, 1); disc(-1, 0, 26, 25, 1);
  // (the bench, and the wall behind it)
  quad([[-2400, -5, -60], [0, 1, 0]], [[-2400, -5, 240], [0, 1, 0]], [[400, -5, 240], [0, 1, 0]], [[400, -5, -60], [0, 1, 0]], 2);
  quad([[-2400, -5, -60], [0, 0, 1]], [[400, -5, -60], [0, 0, 1]], [[400, 400, -60], [0, 0, 1]], [[-2400, 400, -60], [0, 0, 1]], 3);
  return out;
}

export interface View { az: number; el: number; dist: number; target: V3 }
export interface Look { fabric: Fabric; print: Print }
/** a cloth to draw, where (its model matrix: none for the figure's own) */
export interface Item { cloth: Cloth; look: Look; model?: Float32Array }
/** the rails and hangers in the room: each a model matrix; a rail's tint its owner's colour */
export interface Fittings { rails: Array<{ model: Float32Array; tint: V3 }>; hangers: Float32Array[]; hooks: Float32Array[]; coats?: Float32Array[] }
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const CHROME: V3 = [0.62, 0.62, 0.64];

export function createRenderer(gl: WebGL2RenderingContext) {
  const compile = (vs: string, fs: string) => {
    const p = gl.createProgram()!;
    for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  };
  const solid = compile(SOLID_VS, SOLID_FS), cloth = compile(CLOTH_VS, CLOTH_FS), shadow = compile(SHADOW_VS, SHADOW_FS);
  const U = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  const u = (p: WebGLProgram, n: string) => { let m = U.get(p); if (!m) U.set(p, (m = new Map())); if (!m.has(n)) m.set(n, gl.getUniformLocation(p, n)); return m.get(n)!; };

  // (the still things: the room, a rail, a hanger; each a buffer, drawn with a model matrix)
  const vao = (p: WebGLProgram, attrs: Array<[string, number, number, number]>, buf: WebGLBuffer) => {
    const v = gl.createVertexArray()!; gl.bindVertexArray(v); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [name, size, stride, off] of attrs) { const l = gl.getAttribLocation(p, name); if (l < 0) continue; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride * 4, off * 4); }
    return v;
  };
  const mesh = (part: 'scene' | 'rail' | 'hanger' | 'coat' | 'hook') => {
    const v = new Float32Array(solidMesh(part)), b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    return { draw: vao(solid, [['aPos', 3, 7, 0], ['aNor', 3, 7, 3], ['aMat', 1, 7, 6]], b), shadow: vao(shadow, [['aPos', 3, 7, 0], ['aMat', 1, 7, 6]], b), count: v.length / 7, buf: b };
  };
  // (the figure's drawn again whenever it's posed differently: arms up to twirl a skirt, down to wear a top)
  let scene = mesh('scene'), scenePose = body.poseVersion;
  const rail = mesh('rail'), hanger = mesh('hanger'), coat = mesh('coat'), hook = mesh('hook');

  // (the shadow map)
  const SH = 2048, shTex = gl.createTexture()!, shFb = gl.createFramebuffer()!;
  gl.bindTexture(gl.TEXTURE_2D, shTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SH, SH, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.bindFramebuffer(gl.FRAMEBUFFER, shFb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const key = norm([-0.55, 0.75, 0.6]), keyCol: V3 = [1.9, 1.75, 1.5];

  // (each cloth's buffers, made when it's first drawn and let go when it's no longer asked for; its flat place and
  // edge distance don't change, where it is does)
  interface G { dyn: WebGLBuffer; stat: WebGLBuffer; idx: WebGLBuffer; draw: WebGLVertexArrayObject; shadow: WebGLVertexArrayObject; version: number; data: Float32Array; seen: number }
  const gpu = new Map<Cloth, G>();
  let tick = 0;
  function upload(c: Cloth): G {
    let g = gpu.get(c);
    if (!g) {
      const dyn = gl.createBuffer()!, stat = gl.createBuffer()!, idx = gl.createBuffer()!, data = new Float32Array(c.n * 6);
      gl.bindBuffer(gl.ARRAY_BUFFER, dyn); gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
      const st = new Float32Array(c.n * 4);
      for (let i = 0; i < c.n; i++) st.set([c.flat[i * 2], c.flat[i * 2 + 1], c.edge[i * 2], c.edge[i * 2 + 1]], i * 4);
      gl.bindBuffer(gl.ARRAY_BUFFER, stat); gl.bufferData(gl.ARRAY_BUFFER, st, gl.STATIC_DRAW);
      const draw = gl.createVertexArray()!; gl.bindVertexArray(draw);
      for (const [name, size, buf, stride, off] of [['aPos', 3, dyn, 6, 0], ['aNor', 3, dyn, 6, 3], ['aFlat', 2, stat, 4, 0], ['aEdge', 2, stat, 4, 2]] as const) {
        const l = gl.getAttribLocation(cloth, name); if (l < 0) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride * 4, off * 4);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, c.tris, gl.STATIC_DRAW);
      const sh = gl.createVertexArray()!; gl.bindVertexArray(sh);
      gl.bindBuffer(gl.ARRAY_BUFFER, dyn); const l = gl.getAttribLocation(shadow, 'aPos'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 24, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
      gl.bindVertexArray(null);
      g = { dyn, stat, idx, draw, shadow: sh, version: -1, data, seen: tick };
      gpu.set(c, g);
    }
    g.seen = tick;
    if (g.version !== c.version) {
      const d = g.data;
      for (let i = 0; i < c.n; i++) { d[i * 6] = c.pos[i * 3]; d[i * 6 + 1] = c.pos[i * 3 + 1]; d[i * 6 + 2] = c.pos[i * 3 + 2]; d[i * 6 + 3] = c.nor[i * 3]; d[i * 6 + 4] = c.nor[i * 3 + 1]; d[i * 6 + 5] = c.nor[i * 3 + 2]; }
      gl.bindBuffer(gl.ARRAY_BUFFER, g.dyn); gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
      g.version = c.version;
    }
    return g;
  }

  function frame(view: View, items: Item[], w: number, h: number, spin = 0, fit: Fittings = { rails: [], hangers: [], hooks: [] }) {
    tick++;
    if (scenePose !== body.poseVersion) {
      gl.deleteBuffer(scene.buf); gl.deleteVertexArray(scene.draw); gl.deleteVertexArray(scene.shadow);
      scene = mesh('scene'); scenePose = body.poseVersion;
    }
    const gs = items.map((it) => upload(it.cloth));
    for (const [c, g] of gpu) if (g.seen !== tick) { gl.deleteBuffer(g.dyn); gl.deleteBuffer(g.stat); gl.deleteBuffer(g.idx); gl.deleteVertexArray(g.draw); gl.deleteVertexArray(g.shadow); gpu.delete(c); }
    // (the window's light, its shadow centred on what's being looked at)
    const t = view.target, R2 = Math.max(70, view.dist * 0.5);
    const lightVP = mul(ortho(-R2, R2, -R2, R2, 1, 900), lookAt([t[0] + key[0] * 400, t[1] + key[1] * 400, t[2] + key[2] * 400], t, [0, 1, 0]));
    const solids = (p: WebGLProgram, which: 'draw' | 'shadow') => {
      const m = (x: { draw: WebGLVertexArrayObject; shadow: WebGLVertexArrayObject; count: number }, model: Float32Array, sp: number, tint: V3) => {
        gl.uniformMatrix4fv(u(p, 'uModel'), false, model); gl.uniform1f(u(p, 'uSpin'), sp);
        if (which === 'draw') gl.uniform3fv(u(p, 'uTint'), tint);
        gl.bindVertexArray(x[which]); gl.drawArrays(gl.TRIANGLES, 0, x.count);
      };
      m(scene, IDENTITY, spin, CHROME);
      for (const r of fit.rails) m(rail, r.model, 0, r.tint);
      for (const hm of fit.hangers) m(hanger, hm, 0, CHROME);
      for (const hm of fit.coats ?? []) m(coat, hm, 0, CHROME);
      for (const hm of fit.hooks) m(hook, hm, 0, CHROME);
    };
    // (the shadow pass)
    gl.bindFramebuffer(gl.FRAMEBUFFER, shFb); gl.viewport(0, 0, SH, SH);
    gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT); gl.disable(gl.CULL_FACE);
    gl.useProgram(shadow); gl.uniformMatrix4fv(u(shadow, 'uLightVP'), false, lightVP);
    solids(shadow, 'shadow');
    gl.uniform1f(u(shadow, 'uSpin'), 0);
    items.forEach((it, k) => { gl.uniformMatrix4fv(u(shadow, 'uModel'), false, it.model ?? IDENTITY); gl.bindVertexArray(gs[k].shadow); gl.drawElements(gl.TRIANGLES, it.cloth.tris.length, gl.UNSIGNED_INT, 0); });
    // (the view)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    gl.clearColor(0.86, 0.8, 0.72, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const ce = Math.cos(view.el), eye: V3 = [t[0] + Math.sin(view.az) * ce * view.dist, t[1] + Math.sin(view.el) * view.dist, t[2] + Math.cos(view.az) * ce * view.dist];
    const vp = mul(perspective(0.6, w / h, 5, 4000), lookAt(eye, t, [0, 1, 0]));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shTex);
    for (const p of [solid, cloth]) {
      gl.useProgram(p);
      gl.uniformMatrix4fv(u(p, 'uVP'), false, vp); gl.uniformMatrix4fv(u(p, 'uLightVP'), false, lightVP);
      gl.uniform3fv(u(p, 'uKey'), key); gl.uniform3fv(u(p, 'uKeyCol'), keyCol); gl.uniform3fv(u(p, 'uEye'), eye); gl.uniform1i(u(p, 'uShadow'), 0);
    }
    gl.useProgram(solid); solids(solid, 'draw');
    // (cloth: opaque first, see-through after, blended)
    gl.useProgram(cloth);
    const order = items.map((it, k) => k).sort((a, b) => items[a].look.fabric.clear - items[b].look.fabric.clear);
    for (const k of order) {
      const it = items[k], f = it.look.fabric, pr = it.look.print, see = f.clear > 0.05;
      if (see) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
      gl.uniformMatrix4fv(u(cloth, 'uModel'), false, it.model ?? IDENTITY);
      gl.uniform3fv(u(cloth, 'uInk0'), pr.ink[0]); gl.uniform3fv(u(cloth, 'uInk1'), pr.ink[1]); gl.uniform3fv(u(cloth, 'uInk2'), pr.ink[2]);
      gl.uniform1f(u(cloth, 'uKind'), pr.kind); gl.uniform1f(u(cloth, 'uScale'), pr.scale);
      gl.uniform1f(u(cloth, 'uSheen'), f.sheen); gl.uniform1f(u(cloth, 'uFuzz'), f.fuzz); gl.uniform1f(u(cloth, 'uClear'), f.clear); gl.uniform1f(u(cloth, 'uWeave'), f.weave);
      gl.bindVertexArray(gs[k].draw); gl.drawElements(gl.TRIANGLES, it.cloth.tris.length, gl.UNSIGNED_INT, 0);
      if (see) { gl.disable(gl.BLEND); gl.depthMask(true); }
    }
    gl.bindVertexArray(null);
    return { vp, eye };
  }
  return { frame };
}

/** a model matrix: turned `yaw` about the vertical, then swung `angle` about the z axis (along the rail, as a hanger
 * swings when it's pushed along), both about `pivot` (local, on the vertical axis), and that pivot put at `at` */
export function swingAt(at: V3, pivot: V3, angle: number, out: Float32Array = new Float32Array(16), yaw = 0): Float32Array {
  const c = Math.cos(angle), s = Math.sin(angle), cy = Math.cos(yaw), sy = Math.sin(yaw);
  // (M = Rz(angle)·Ry(yaw), columns; x' = M(x − pivot) + at)
  const m = [c * cy, s * cy, -sy, -s, c, 0, c * sy, s * sy, cy];
  const px = pivot[0], py = pivot[1], pz = pivot[2];
  out.set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0,
    at[0] - (m[0] * px + m[3] * py + m[6] * pz), at[1] - (m[1] * px + m[4] * py + m[7] * pz), at[2] - (m[2] * px + m[5] * py + m[8] * pz), 1]);
  return out;
}
export const translate = (x: number, y: number, z: number) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);

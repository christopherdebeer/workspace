/**
 * The grove drawn as the board has it (devtools/bamboo/board.jpg): a lit picture with ink on it, held close to the
 * eye, giving out to the page.
 *
 * Two passes, after Labyrinth:
 * - **the picture** (one framebuffer, two colour targets and depth): every surface lit by the sun through the canopy
 *   (its dapple), the sky and a little bounce, in its own colour; and, beside the colour, what it is (its kind), whether
 *   an outline may run along its edge here (a culm's isn't, just under each node: the stroke breaks there), and how far
 *   drawn it is (its reach). What's drawn as marks is drawn here too, on the things that call for it: a culm's node
 *   ticks, the litter's leaf strokes, a fallen leaf's edge, the path's edges, a spray's blades;
 * - **the page** (post): the outlines found from the depth and the kinds, inked where the reach allows; the colour laid
 *   on the paper as far as it reaches, the ink further, then the page itself (sky, mist, the far side are paper); shafts
 *   of light where the canopy opens toward the sun.
 *
 * Far off, things aren't faded: they're drawn less. A culm is in or out whole, by its pick against how far drawn it
 * would be; what's left greys toward ink, then goes.
 *
 * `?clean`: no shafts or paper grain, to judge the drawing itself. `?marks=0`: the picture without its ink.
 */
import { type Land, X0, Z0, NX, NZ, CELL, HALF } from './land';
import { type Grove } from './grove';

export interface Frame {
  eye: [number, number, number]; look: [number, number, number]; fov: number; t: number;
  /** a gust: its direction (x, z), where its front is along that direction, how strong (0..1) */
  gust: [number, number, number, number];
}

const NOISE = `
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
float fbm2(vec2 p) { return vn(p) * .55 + vn(p * 2.03 + 7.1) * .3 + vn(p * 4.1 - 3.7) * .15; }
`;
const COMMON = `#version 300 es
precision highp float; precision highp int;
uniform mat4 uVP; uniform vec3 uEye; uniform float uTime; uniform vec3 uSun; uniform vec4 uGust;
${NOISE}
// (how far a culm's top is blown, per metre of its height: a slow sway of its own, and the gust's front passing)
vec2 windAt(vec2 p, float phase) {
  vec2 d = vec2(-.92, -.38);
  float sway = .010 * sin(uTime * .8 + phase + dot(p, vec2(.05, .03))) + .004 * sin(uTime * 2.1 + phase * 1.7);
  float along = dot(p, uGust.xy) - uGust.z, front = exp(-along * along / 300.) * uGust.w;
  return d * sway + uGust.xy * front * (.05 + .012 * sin(uTime * 5. + phase));
}
// (where a culm's centre is, y metres up it)
vec3 culmAt(vec3 b, float h, vec2 lean, float phase, float y) {
  float v = clamp(y / h, 0., 1.);
  vec2 off = lean * pow(v, 1.6) + windAt(b.xz, phase) * v * v * h;
  return b + vec3(off.x, y, off.y);
}
`;
// (the light through the canopy: shared by every surface, so a patch of sun lies across the path, the litter and a
// culm alike)
const LIGHT = `
uniform vec3 uSunC; uniform vec3 uSky; uniform float uOpen;
float dapple(vec3 p) {
  // (the canopy's gaps, cast down the sun onto p: drifting a little as the tops sway)
  vec2 q = p.xz - uSun.xz / max(uSun.y, .2) * (16. - p.y * .5);
  q += vec2(sin(uTime * .7), cos(uTime * .53)) * .25;
  float g = fbm2(q * .6) * .55 + vn(q * 2.6) * .45;
  return smoothstep(.6 - uOpen * .1, .66 - uOpen * .1, g);
}
vec3 lin(vec3 c) { return c * c; }
// (the carpet of fallen leaves: one leaf to a cell, in two sizes, each turned its own way and its own colour, read
// from the cells round it; given out to its average tone where a cell is smaller than a few pixels)
vec4 leaves(vec2 p, float cell) {
  vec2 g = p / cell, i0 = floor(g);
  float best = 0.; vec3 col = vec3(0.);
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) {
    vec2 c = i0 + vec2(a, b), h = vec2(h21(c), h21(c + 17.3));
    vec2 o = c + h; float ang = h21(c + 5.1) * 3.1416, s = sin(ang), co = cos(ang);
    vec2 d = g - o; d = vec2(co * d.x + s * d.y, -s * d.x + co * d.y);
    float len = 1.1 + h.x * .9, t = d.x / len + .5;
    if (t < 0. || t > 1.) continue;
    float w = .095 * pow(sin(3.1416 * pow(t, .8)), .7) * len, e = w - abs(d.y);
    if (e > 0. && h.y > best) { best = h.y; float tone = h21(c + 9.7); col = mix(vec3(.9, .76, .5), vec3(.5, .33, .19), tone) * (.85 + .3 * smoothstep(0., w, e)); }
  }
  return vec4(col, best > 0. ? 1. : 0.);
}
vec3 carpet(vec3 base, vec2 p, float px) {
  vec4 a = leaves(p, .16), b = leaves(p + 7.3, .26);
  vec3 c = mix(base, b.rgb, b.a * .9);
  c = mix(c, a.rgb, a.a * .85);
  // (where the leaves are too small to see, their tone without their shapes)
  float far = smoothstep(.02, .06, px);
  return mix(c, mix(base, vec3(.74, .58, .38), .55), far);
}
vec3 lit(vec3 alb, vec3 N, vec3 p, float wrap, float ao) {
  float sun = dapple(p), ndl = max(0., (dot(N, uSun) + wrap) / (1. + wrap));
  vec3 a = lin(alb);
  return a * (uSunC * ndl * sun + uSky * (.55 + .45 * N.y) * ao + vec3(.16, .13, .08) * (1. - N.y) * .35 * ao);
}
// (the display: a soft shoulder, then back to the eye's curve)
vec3 show(vec3 c) { c = 1. - exp(-c * 1.35); return sqrt(c); }
`;
// (what a fragment hands the page: its colour and how much of it is laid (a), its kind, whether an outline may run
// here, how far drawn it is)
const OUT = `
layout(location = 0) out vec4 oC; layout(location = 1) out vec4 oA;
uniform vec4 uReach; // colour from, colour to, ink from, ink to (metres)
void emit(vec3 c, float kind, float allow, vec3 p) {
  float d = distance(p, uEye);
  float col = 1. - smoothstep(uReach.x, uReach.y, d), ink = 1. - smoothstep(uReach.z, uReach.w, d);
  // (below the eye, the valley's mist takes it sooner)
  float low = smoothstep(8., 45., uEye.y - p.y);
  col *= 1. - low * .85; ink *= 1. - low * .9;
  // (the air between: far things paler and cooler, toward the paper, as the board's grove goes; then the colour greys
  // toward ink before the page takes it)
  float fog = 1. - exp(-max(0., d - 4.) / 19.);
  c = mix(c, vec3(.9, .88, .79), fog * .8);
  float g = dot(c, vec3(.3, .5, .2));
  c = mix(vec3(g * .95 + .03), c, smoothstep(0., .55, col));
  oC = vec4(c, max(col, ink * .55));
  oA = vec4(kind, allow, ink * (1. - fog * .75), 1.);
}
`;

const CULM_VS = COMMON + `
layout(location = 0) in vec2 aUV;
layout(location = 1) in vec4 iA; layout(location = 2) in vec4 iB; layout(location = 3) in vec4 iC;
out vec3 vW; out vec3 vN; out float vY; out float vQ; out float vU; out vec3 vI;
uniform vec2 uPick; // drawn whole up to, gone by (metres)
void main() {
  vec3 b = iA.xyz; float r = iA.w, h = iB.x; vec2 lean = iB.yz; float node = iB.w, phase = iC.y, pick = iC.z;
  float dist = distance(b.xz, uEye.xz);
  // (left out whole where the drawing has thinned past its pick)
  if (pick > 1. - smoothstep(uPick.x, uPick.y, dist)) { gl_Position = vec4(2., 2., 2., 1.); return; }
  float y = aUV.y * h, a = aUV.x * 6.2832;
  // (internodes lengthen up the culm; a slight swelling at each node)
  float q = y / (node * (1. + .9 * smoothstep(0., .45 * h, y)));
  float swell = 1. + .05 * exp(-pow((fract(q) - .0) * 14., 2.)) + .05 * exp(-pow((fract(q) - 1.) * 14., 2.));
  float rr = r * (1. - .62 * pow(aUV.y, 1.3)) * swell;
  vec3 c = culmAt(b, h, lean, phase, y);
  vec3 n = vec3(cos(a), 0., sin(a));
  vW = c + n * rr; vN = n; vY = y; vQ = q; vU = a * r; vI = vec3(iC.x, phase, h);
  gl_Position = uVP * vec4(vW, 1.);
}`;
const CULM_FS = COMMON + LIGHT + OUT + `
in vec3 vW; in vec3 vN; in float vY; in float vQ; in float vU; in vec3 vI;
uniform float uMarks;
void main() {
  vec3 N = normalize(vN), V = normalize(uEye - vW);
  float age = vI.x, f = fract(vQ);
  // (the culm's own green: pale celadon when young, duller and olive with age, greener and darker low down)
  vec3 young = vec3(.63, .7, .5), old = vec3(.6, .6, .46);
  vec3 alb = mix(young, old, age) * mix(.82, 1., smoothstep(0., 2.5, vY));
  // (the dry brush down its length: streaks, darkest just under a node)
  float streak = vn(vec2(vU * 38., vY * .6 + vI.y)) * .6 + vn(vec2(vU * 90., vY * 1.7)) * .4;
  alb *= .82 + .3 * streak;
  alb = mix(alb, alb * .78, smoothstep(.55, .95, f) * .6);
  // (lichen on the old ones, in grey-white patches)
  alb = mix(alb, vec3(.78, .78, .7), smoothstep(.62, .8, vn(vec2(vU * 14., vY * 1.1) + vI.y * 3.)) * age * .55);
  // (the band of white powder just under each node, and the node's own ring)
  float far = smoothstep(8., 26., distance(vW, uEye));
  float band = smoothstep(.8, .9, f) * (1. - smoothstep(.955, .975, f));
  alb = mix(alb, vec3(.9, .9, .84), band * (.75 - age * .4) * (1. - far * .8));
  float ring = (1. - smoothstep(.0, .025, min(f, 1. - f) - .003)) * (1. - far * .7);
  alb = mix(alb, alb * .45, ring);
  vec3 c = show(lit(alb, N, vW, .25, 1.));
  // (the ink: a tick at each node, curving with the ring, darkest toward the culm's edges as the eye sees it; and the
  // ink pooled at its foot)
  float edge = 1. - abs(dot(N, V));
  float tick = ring * smoothstep(.15, .65, edge) * uMarks;
  float foot = (1. - smoothstep(.0, .35, vY)) * .5 * uMarks;
  c = mix(c, vec3(.12, .12, .1), clamp(max(tick, foot), 0., 1.) * (1. - smoothstep(14., 40., distance(vW, uEye))));
  // (the outline breaks just under each node, as a brush lifts there)
  float allow = 1. - smoothstep(.72, .8, f) * (1. - smoothstep(.97, .99, f));
  emit(c, .4, allow, vW);
}`;

const SPRAY_VS = COMMON + `
layout(location = 0) in vec2 aUV;
layout(location = 1) in vec4 iA; layout(location = 2) in vec4 iB; layout(location = 3) in vec4 iC; layout(location = 4) in vec4 iD;
out vec3 vW; out vec2 vUV; out float vSeed; out vec3 vN;
uniform vec2 uPick; uniform vec3 uRight;
void main() {
  vec3 b = iA.xyz; float h = iA.w; vec2 lean = iB.xy; float phase = iB.z, pick = iB.w;
  float dist = distance(b.xz, uEye.xz);
  if (pick > 1. - smoothstep(uPick.x, uPick.y, dist)) { gl_Position = vec4(2., 2., 2., 1.); return; }
  float sy = iC.x, size = iC.w, yaw = iD.x, tilt = iD.y;
  vec3 anchor = culmAt(b, h, lean, phase, sy) + vec3(iC.y, 0., iC.z);
  // (a flutter of its own)
  anchor.xz += vec2(sin(uTime * 2.7 + iD.z * 40.), cos(uTime * 2.2 + iD.z * 30.)) * .05 * (1. + uGust.w * 2.);
  // (half turned to the eye, so a spray is never lost edge-on; hanging below its twig)
  vec3 r0 = vec3(cos(yaw), 0., -sin(yaw)), right = normalize(mix(r0, uRight, .55));
  vec3 up = normalize(vec3(0., 1., 0.) + cross(right, vec3(0., 1., 0.)) * tilt);
  vW = anchor + right * aUV.x * size + up * (aUV.y - .75) * size;
  vUV = aUV + .5; vSeed = iD.z; vN = normalize(cross(right, up));
  gl_Position = uVP * vec4(vW, 1.);
}`;
const SPRAY_FS = COMMON + LIGHT + OUT + `
in vec3 vW; in vec2 vUV; in float vSeed; in vec3 vN;
uniform float uMarks;
void main() {
  // (the blades: three to five from a twig near the top, drooping: 个 and 介)
  vec2 stem = vec2(.5 + (vSeed - .5) * .2, .82);
  int n = 3 + int(vSeed * 2.99);
  float inside = 0., rim = 1., best = 0.;
  for (int i = 0; i < 5; i++) {
    if (i >= n) break;
    float fi = float(i), s = fract(vSeed * 13.7 + fi * .618);
    float ang = -1.5708 + (fi - float(n - 1) * .5) * (.62 + s * .2) + (s - .5) * .3;
    vec2 d = vec2(cos(ang), sin(ang)); vec2 pp = vUV - stem;
    float len = .55 + s * .25, a = dot(pp, d) / len, bb = dot(pp, vec2(-d.y, d.x)) / len;
    float w = .12 * pow(max(0., sin(3.1416 * pow(clamp(a, 0., 1.), .75))), .8) * (1. - .25 * a);
    float e = w - abs(bb + a * a * .06 * (s - .5));
    if (a > 0. && a < 1. && e > 0.) { inside = 1.; rim = min(rim, e / max(w, 1e-3)); best = max(best, s); }
  }
  if (inside < .5) discard;
  vec3 V = normalize(uEye - vW), N = faceforward(vN, -V, vN);
  // (lit: dark ink-green in shade, yellow-green where the sun's on it, glowing where it's behind)
  float sun = dapple(vW), back = pow(max(0., dot(-V, uSun)), 3.) * sun;
  vec3 alb = mix(vec3(.2, .27, .14), vec3(.45, .55, .24), .4 + .6 * best);
  vec3 c = show(lit(alb, N, vW, .6, .9) + lin(vec3(.85, .9, .4)) * back * .9 * uSunC);
  float near = 1. - smoothstep(6., 22., distance(vW, uEye));
  c = mix(c, vec3(.1, .12, .08), (1. - smoothstep(.0, .35, rim)) * near * .85 * uMarks);
  emit(c, .6, near, vW);
}`;

const GROUND_VS = COMMON + `
layout(location = 0) in vec3 aP; layout(location = 1) in vec3 aN; layout(location = 2) in float aD;
out vec3 vW; out vec3 vN; out float vD;
void main() { vW = aP; vN = aN; vD = aD; gl_Position = uVP * vec4(aP, 1.); }`;
const GROUND_FS = COMMON + LIGHT + OUT + `
in vec3 vW; in vec3 vN; in float vD;
uniform float uMarks; uniform vec4 uBounds;
void main() {
  vec3 N = normalize(vN);
  // (the litter's warm ochre everywhere under the grove, deepest along the way; the worn middle paler earth; banks
  // darker soil, mossy in the hollows)
  float n1 = fbm2(vW.xz * .45), n2 = vn(vW.xz * 3.1);
  vec3 litter = mix(vec3(.8, .69, .52), vec3(.68, .56, .4), n1);
  litter *= .9 + .2 * vn(vW.xz * vec2(9., 2.5) + n1 * 4.);
  vec3 earth = mix(vec3(.84, .77, .64), vec3(.76, .68, .55), n2);
  vec3 soil = vec3(.55, .48, .38);
  float worn = 1. - smoothstep(${(HALF * 0.35).toFixed(2)}, ${(HALF * 0.85).toFixed(2)}, vD + (n2 - .5) * .3);
  float px = length(fwidth(vW.xz));
  // (the carpet everywhere but the worn middle of the way, where it's thin and the earth shows)
  vec3 carp = carpet(litter * .8, vW.xz, px);
  vec3 alb = mix(carp, mix(earth, carp, .25 + .25 * step(.6, vn(vW.xz * 2.2))), worn * .85);
  alb = mix(alb, soil, smoothstep(.35, .7, 1. - N.y) * .7);
  // (away from the way, under the grove: darker, the litter older)
  alb *= mix(1., .78, smoothstep(2.5, 9., vD));
  alb = mix(alb, vec3(.42, .48, .26), smoothstep(.62, .78, fbm2(vW.xz * .3 + 9.)) * .35 * (1. - worn));
  vec3 c = show(lit(alb, N, vW, .2, .9));
  // (the way's edges, in ink, broken: where its bed meets the bank or the fall)
  float e = abs(vD - ${(HALF * 1.02).toFixed(2)}), fw = max(.012, fwidth(vD) * .8);
  float edge = (1. - smoothstep(fw * .6, fw * 1.4, e)) * step(.5, vn(vW.xz * 1.3 + 3.)) * uMarks;
  c = mix(c, vec3(.15, .13, .1), edge * .7 * smoothstep(1.5, 4., distance(vW, uEye)) * (1. - smoothstep(10., 34., distance(vW, uEye))));
  // (the land given out to the page toward its own edges, so there's never a rim to it)
  float rim = min(min(vW.x - uBounds.x, uBounds.z - vW.x), min(vW.z - uBounds.y, uBounds.w - vW.z));
  emit(c, .2, 1., vW);
  oC.a *= smoothstep(0., 40., rim);
}`;

const LITTER_VS = COMMON + `
layout(location = 0) in vec2 aUV; layout(location = 1) in vec4 iA; layout(location = 2) in vec4 iB;
out vec3 vW; out vec2 vUV; out float vTone;
void main() {
  float yaw = iA.w, len = iB.x;
  vec2 d = vec2(cos(yaw), sin(yaw)), s = vec2(-d.y, d.x);
  vec2 xz = iA.xz + d * aUV.x * len + s * aUV.y * len * .22;
  vW = vec3(xz.x, iA.y + .004 * aUV.x, xz.y); vUV = aUV + .5; vTone = iB.y;
  gl_Position = uVP * vec4(vW, 1.);
}`;
const LITTER_FS = COMMON + LIGHT + OUT + `
in vec3 vW; in vec2 vUV; in float vTone;
uniform float uMarks;
void main() {
  // (a fallen leaf: tapered at both ends, sharp at the tip)
  float a = vUV.x, w = .5 * pow(max(0., sin(3.1416 * pow(a, .8))), .7), e = w - abs(vUV.y - .5);
  if (e < 0.) discard;
  vec3 alb = mix(vec3(.88, .75, .48), vec3(.55, .36, .2), vTone);
  vec3 c = show(lit(alb, vec3(0., 1., 0.), vW, .2, 1.));
  float near = 1. - smoothstep(4., 14., distance(vW, uEye));
  c = mix(c, vec3(.2, .14, .08), (1. - smoothstep(.0, .12, e)) * near * .7 * uMarks);
  emit(c, .21, 0., vW);
}`;

const SOLID_VS = COMMON + `
layout(location = 0) in vec3 aP; layout(location = 1) in vec3 aN;
layout(location = 2) in vec4 iA; layout(location = 3) in vec4 iB;
out vec3 vW; out vec3 vN; out vec3 vL; out float vMoss; out float vSeed;
uniform int uKind;
void main() {
  vec3 p = aP, n = aN;
  float yaw = iA.w;
  if (uKind == 1) {
    // (a step: the unit box set to its depth, width and drop, its front edge at the origin)
    p = vec3(p.x * iB.y, p.y * iB.z - iB.z, (p.z + .5) * iB.x);
  } else {
    p = vec3(p.x, p.y * iB.y, p.z) * iB.x; n = normalize(vec3(n.x, n.y / max(iB.y, .2), n.z));
  }
  float c = cos(yaw), s = sin(yaw);
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); n = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
  vW = iA.xyz + p; vN = n; vL = aP; vMoss = iB.z; vSeed = iB.w;
  gl_Position = uVP * vec4(vW, 1.);
}`;
const SOLID_FS = COMMON + LIGHT + OUT + `
in vec3 vW; in vec3 vN; in vec3 vL; in float vMoss; in float vSeed;
uniform int uKind;
void main() {
  vec3 N = normalize(vN);
  float n1 = fbm2(vW.xz * 1.7 + vW.y * 1.3), n2 = vn(vW.xy * 5. + vW.z * 3.);
  vec3 stone = mix(vec3(.6, .6, .55), vec3(.5, .52, .48), n1) * (.9 + .2 * n2);
  // (moss on the tops and in the joints; the worn tread of a step paler)
  float moss = smoothstep(.2, .8, N.y) * smoothstep(.45, .7, n1 + vMoss * .3);
  vec3 alb = mix(stone, vec3(.42, .5, .22), moss * (uKind == 1 ? .5 : .85));
  if (uKind == 1) {
    alb *= .78 + .38 * vSeed;
    alb = mix(alb, alb * vec3(1.08, 1., .86), fract(vSeed * 7.3) * .6);
    // (leaves lying on the tread, thickest toward its ends)
    float onTop = smoothstep(.8, .95, N.y);
    vec4 lv = leaves(vW.xz + vSeed * 13., .17);
    alb = mix(alb, lv.rgb, lv.a * onTop * (.35 + .6 * smoothstep(.15, .45, abs(vL.x))));
    alb = mix(alb, vec3(.76, .72, .62), smoothstep(.7, .95, N.y) * (1. - abs(vL.x) * 1.6) * .5);
    // (the riser darker, damp, in the step's own shadow)
    alb *= mix(1., .62, 1. - smoothstep(.2, .6, N.y));
  }
  vec3 c = show(lit(alb, N, vW, .2, .85));
  emit(c, uKind == 1 ? .8 : .7, 1., vW);
}`;

const RIDGE_VS = COMMON + `
layout(location = 0) in vec3 aP; layout(location = 1) in vec2 aT;
out vec3 vW; out vec2 vT;
void main() { vW = aP; vT = aT; gl_Position = uVP * vec4(aP, 1.); }`;
const RIDGE_FS = `#version 300 es
precision highp float;
in vec3 vW; in vec2 vT;
layout(location = 0) out vec4 oC; layout(location = 1) out vec4 oA;
${NOISE}
void main() {
  // (a range as the ink lays it: darkest at its crest, washing out below into the mist)
  float below = vT.x, layer = vT.y;
  float a = exp(-below / (10. + layer * 6.)) * (.62 - layer * .1);
  a *= .75 + .25 * vn(vW.zy * .05);
  oC = vec4(vec3(.5, .56, .58) - layer * .02, a);
  oA = vec4(.1, 0., 0., 1.);
}`;

const POST_VS = `#version 300 es
layout(location = 0) in vec2 aP; out vec2 vUV;
void main() { vUV = aP * .5 + .5; gl_Position = vec4(aP, 0., 1.); }`;
const POST_FS = `#version 300 es
precision highp float;
in vec2 vUV; out vec4 o;
uniform sampler2D uC; uniform sampler2D uA; uniform sampler2D uZ;
uniform vec2 uRes; uniform float uNear; uniform float uFar; uniform float uPx;
uniform vec3 uPaper; uniform vec3 uInk; uniform vec3 uSunUV; uniform float uClean; uniform float uMarks;
${NOISE}
float lz(vec2 p) { float d = texture(uZ, p).r; return uNear * uFar / (uFar - d * (uFar - uNear)); }
void main() {
  vec4 C = texture(uC, vUV), A = texture(uA, vUV);
  float z = lz(vUV);
  // ─── the outlines: where the depth jumps or one kind meets another, inked on the side that's in front, as far as
  // its reach and its allowance there let it ───
  float ink = 0.;
  if (uMarks > .5) {
    vec2 px = uPx / uRes;
    for (int k = 0; k < 8; k++) {
      float ang = float(k) * .7854; vec2 o2 = vec2(cos(ang), sin(ang)) * px * (k % 2 == 0 ? 1. : 1.41);
      vec2 q = vUV + o2; float zq = lz(q); vec4 Aq = texture(uA, q);
      bool front = z < zq;
      vec4 F = front ? A : Aq;
      float rel = abs(zq - z) / min(z, zq);
      float dj = smoothstep(.05, .14, rel);
      float kj = abs(Aq.x - A.x) > .05 && min(Aq.x, A.x) > .15 && !(min(Aq.x, A.x) < .22 && max(Aq.x, A.x) < .22) ? .8 : 0.;
      // (the litter and the ground meeting draw nothing; nor the page)
      if (F.x < .15) continue;
      ink = max(ink, max(dj, kj) * F.y * F.z);
    }
  }
  // ─── the page: the colour laid on it as far as it reaches, then the ink, then the paper ───
  float grain = uClean > .5 ? 0. : (vn(vUV * uRes * .35) - .5) * .05 + (vn(vUV * uRes * .04) - .5) * .04;
  vec3 paper = uPaper * (1. + grain);
  vec3 col = mix(paper, C.rgb * mix(vec3(1.), paper / .94, .35), C.a);
  // (shafts of light where the canopy opens toward the sun)
  if (uClean < .5 && uSunUV.z > 0.) {
    vec2 d = (uSunUV.xy - vUV) / 28.; vec2 p = vUV; float acc = 0., w = 1.;
    for (int i = 0; i < 28; i++) { p += d; vec4 Ap = texture(uA, p); acc += (Ap.x < .05 ? 1. : 0.) * w; w *= .94; }
    float shaft = acc / 14. * uSunUV.z * (.6 + .4 * vn(vec2(atan(vUV.y - uSunUV.y, vUV.x - uSunUV.x) * 9., 1.)));
    col = mix(col, vec3(1., .97, .86), clamp(shaft * .32 * C.a, 0., .55));
  }
  col = mix(col, uInk, clamp(ink, 0., 1.) * .88);
  o = vec4(col, 1.);
}`;

// ─── meshes ───
function culmMesh(sides: number, rings: number) {
  const v: number[] = [];
  for (let j = 0; j < rings; j++) for (let i = 0; i < sides; i++) {
    const a0 = i / sides, a1 = (i + 1) / sides, y0 = j / rings, y1 = (j + 1) / rings;
    v.push(a0, y0, a1, y0, a1, y1, a0, y0, a1, y1, a0, y1);
  }
  return new Float32Array(v);
}
const QUAD = new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
function boxMesh() {
  // (unit box: x -0.5..0.5, y 0..1, z -0.5..0.5; positions and normals)
  const P: number[] = [], f = (a: number[], b: number[], c: number[], d: number[], n: number[]) => { for (const q of [a, b, c, a, c, d]) P.push(...q, ...n); };
  const [x0, x1, y0, y1, z0, z1] = [-0.5, 0.5, 0, 1, -0.5, 0.5];
  f([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0]);
  f([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1]);
  f([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [0, 0, 1]);
  f([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [-1, 0, 0]);
  f([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0]);
  return new Float32Array(P);
}
function lumpMesh(seed: number) {
  // (an icosphere, two subdivisions, pushed in and out: a boulder)
  const t = (1 + Math.sqrt(5)) / 2;
  let V: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...p); return p.map((q) => q / l); });
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < 2; s++) {
    const mid = new Map<string, number>(), m = (a: number, b: number) => { const k = a < b ? `${a},${b}` : `${b},${a}`; if (!mid.has(k)) { const p = V[a].map((q, i) => (q + V[b][i]) / 2), l = Math.hypot(...p); V.push(p.map((q) => q / l)); mid.set(k, V.length - 1); } return mid.get(k)!; };
    const G: number[][] = [];
    for (const [a, b, c] of F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); G.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    F = G;
  }
  const h = (p: number[]) => { const s = Math.sin(p[0] * 3.1 + seed) * Math.sin(p[1] * 2.7 + seed * 2) * Math.sin(p[2] * 3.3 + seed * 3); return 1 + 0.16 * s + 0.08 * Math.sin(p[0] * 7 + p[2] * 5 + seed); };
  V = V.map((p) => { const k = h(p); return [p[0] * k, Math.max(-0.3, p[1]) * k, p[2] * k]; });
  const P: number[] = [];
  for (const [a, b, c] of F) {
    const A = V[a], B = V[b], C = V[c], u = B.map((q, i) => q - A[i]), w = C.map((q, i) => q - A[i]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n) || 1;
    for (const p of [A, B, C]) P.push(...p, n[0] / l, n[1] / l, n[2] / l);
  }
  return new Float32Array(P);
}

// ─── a little matrix arithmetic (column-major) ───
function perspective(fov: number, asp: number, n: number, f: number) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]; }
function lookAt(e: number[], c: number[]) {
  const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
}
function mul(a: number[], b: number[]) { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; }
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** instances bucketed in tiles, so only those near enough are drawn */
interface Tiled { buf: WebGLBuffer; stride: number; tiles: { x: number; z: number; start: number; count: number }[] }
const TILE = 16;

export class Renderer {
  private gl: WebGL2RenderingContext;
  private progs: Record<string, WebGLProgram> = {};
  private fbo: WebGLFramebuffer | null = null; private texC: WebGLTexture | null = null; private texA: WebGLTexture | null = null; private texZ: WebGLTexture | null = null; private size = [0, 0];
  private vbo: Record<string, { buf: WebGLBuffer; count: number }> = {};
  private culms!: Tiled; private sprays!: Tiled; private litter!: { buf: WebGLBuffer; count: number }; private steps!: { buf: WebGLBuffer; count: number };
  private stones: { buf: WebGLBuffer; count: number }[] = [];
  private ground!: { buf: WebGLBuffer; idx: WebGLBuffer; count: number };
  private ridge!: { buf: WebGLBuffer; count: number };
  private vao: WebGLVertexArrayObject;
  readonly clean: boolean; readonly marks: number;
  /** drawing range, metres: colour from/to, ink from/to; and culms in whole up to / gone by */
  reach = [10, 40, 30, 75]; pick = [26, 72];
  sunDir = norm([-0.55, 0.62, 0.42]);

  constructor(private canvas: HTMLCanvasElement, land: Land, grove: Grove, opts: { clean?: boolean; marks?: boolean } = {}) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is needed');
    this.gl = gl; this.clean = !!opts.clean; this.marks = opts.marks === false ? 0 : 1;
    this.vao = gl.createVertexArray()!;
    const P = (n: string, vs: string, fs: string) => { this.progs[n] = this.program(vs, fs); };
    P('culm', CULM_VS, CULM_FS); P('spray', SPRAY_VS, SPRAY_FS); P('ground', GROUND_VS, GROUND_FS); P('litter', LITTER_VS, LITTER_FS);
    P('solid', SOLID_VS, SOLID_FS); P('ridge', RIDGE_VS, RIDGE_FS); P('post', POST_VS, POST_FS);
    const B = (data: Float32Array) => { const b = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; };
    for (const [k, m] of [['culmNear', culmMesh(8, 20)], ['culmFar', culmMesh(5, 10)], ['quad', QUAD]] as const) this.vbo[k] = { buf: B(m), count: m.length / 2 };
    const box = boxMesh(); this.vbo.box = { buf: B(box), count: box.length / 6 };
    for (let k = 0; k < 4; k++) { const m = lumpMesh(k * 1.7 + 0.3); this.vbo[`lump${k}`] = { buf: B(m), count: m.length / 6 }; }
    this.vbo.screen = { buf: B(new Float32Array([-1, -1, 3, -1, -1, 3])), count: 3 };
    // (the culms and their sprays, by tile)
    const tiled = <T,>(items: T[], at: (t: T) => [number, number], pack: (t: T, o: Float32Array, k: number) => void, stride: number): Tiled => {
      const key = (x: number, z: number) => `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`, groups = new Map<string, T[]>();
      for (const it of items) { const [x, z] = at(it), k = key(x, z); (groups.get(k) ?? groups.set(k, []).get(k)!).push(it); }
      const data = new Float32Array(items.length * stride), tiles: Tiled['tiles'] = [];
      let n = 0;
      for (const [k, list] of groups) { const [tx, tz] = k.split(',').map(Number); tiles.push({ x: (tx + 0.5) * TILE, z: (tz + 0.5) * TILE, start: n, count: list.length }); for (const it of list) pack(it, data, n++ * stride); }
      return { buf: B(data), stride, tiles };
    };
    this.culms = tiled(grove.culms, (c) => [c.x, c.z], (c, o, k) => { o.set([c.x, c.y, c.z, c.r, c.h, c.lx, c.lz, c.node, c.age, c.phase, c.pick, c.d], k); }, 12);
    this.sprays = tiled(grove.sprays, (s) => [grove.culms[s.c].x, grove.culms[s.c].z], (s, o, k) => {
      const c = grove.culms[s.c]; o.set([c.x, c.y, c.z, c.h, c.lx, c.lz, c.phase, c.pick, s.y, s.ox, s.oz, s.size, s.yaw, s.tilt, s.seed, 0], k);
    }, 16);
    { const d = new Float32Array(grove.litter.length * 8); grove.litter.forEach((l, i) => d.set([l.x, l.y, l.z, l.yaw, l.len, l.tone, 0, 0], i * 8)); this.litter = { buf: B(d), count: grove.litter.length }; }
    {
      const steps = land.ways.flatMap((w) => w.steps), d = new Float32Array(steps.length * 8);
      steps.forEach((s, i) => d.set([s.x, s.y, s.z, Math.atan2(s.dx, s.dz), s.depth, s.width, s.drop, (i * 0.618) % 1], i * 8));
      this.steps = { buf: B(d), count: steps.length };
    }
    for (let k = 0; k < 4; k++) { const list = grove.stones.filter((s) => s.kind === k), d = new Float32Array(list.length * 8); list.forEach((s, i) => d.set([s.x, s.y, s.z, s.yaw, s.r, s.flat, s.moss, 0], i * 8)); this.stones.push({ buf: B(d), count: list.length }); }
    // (the ground: the grid, its normals, how far each point is from a way)
    {
      const v = new Float32Array(NX * NZ * 7), H = land.ground;
      for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
        const k = i + j * NX, x = X0 + i * CELL, z = Z0 + j * CELL;
        const hx = H[Math.min(NX - 1, i + 1) + j * NX] - H[Math.max(0, i - 1) + j * NX], hz = H[i + Math.min(NZ - 1, j + 1) * NX] - H[i + Math.max(0, j - 1) * NX];
        const n = norm([-hx, 2 * CELL, -hz]);
        v.set([x, H[k], z, n[0], n[1], n[2], Math.min(30, land.near[k])], k * 7);
      }
      const idx = new Uint32Array((NX - 1) * (NZ - 1) * 6); let m = 0;
      for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) { const a = i + j * NX; idx.set([a, a + NX, a + 1, a + 1, a + NX, a + NX + 1], m); m += 6; }
      const ib = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      this.ground = { buf: B(v), idx: ib, count: idx.length };
    }
    // (the far ranges: each a band from its crest down out of sight)
    {
      const d: number[] = [];
      grove.ridges.forEach((line, layer) => {
        for (let i = 0; i + 1 < line.length; i++) {
          const a = line[i], b = line[i + 1], lo = -400;
          const A = [a.x, a.y, a.z, 0, layer], Bq = [b.x, b.y, b.z, 0, layer], C = [b.x, lo, b.z, b.y - lo, layer], D = [a.x, lo, a.z, a.y - lo, layer];
          d.push(...A, ...Bq, ...C, ...A, ...C, ...D);
        }
      });
      this.ridge = { buf: B(new Float32Array(d)), count: d.length / 5 };
    }
  }

  private program(vs: string, fs: string) {
    const gl = this.gl, mk = (t: number, s: string) => { const sh = gl.createShader(t)!; gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`${t === gl.VERTEX_SHADER ? 'vertex' : 'fragment'}: ${gl.getShaderInfoLog(sh)}`); return sh; };
    const p = gl.createProgram()!; gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  }

  private targets(w: number, h: number) {
    if (this.size[0] === w && this.size[1] === h && this.fbo) return;
    const gl = this.gl;
    for (const t of [this.texC, this.texA, this.texZ]) if (t) gl.deleteTexture(t);
    if (this.fbo) gl.deleteFramebuffer(this.fbo);
    const tex = (ifmt: number, fmt: number, type: number, filter: number) => { const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    this.texC = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR); this.texA = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST); this.texZ = tex(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
    this.fbo = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texC, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.texA, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.texZ, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    this.size = [w, h];
  }

  /** the sun's place on the screen (x, y in 0..1; z how much it's in front), given the last frame's matrix */
  private sunUV = [0.5, 0.9, 0];
  private uni(p: WebGLProgram, f: Frame, vp: number[], right: number[]) {
    const gl = this.gl, u = (n: string) => gl.getUniformLocation(p, n);
    gl.uniformMatrix4fv(u('uVP'), false, vp); gl.uniform3fv(u('uEye'), f.eye); gl.uniform1f(u('uTime'), f.t); gl.uniform3fv(u('uSun'), this.sunDir);
    gl.uniform4fv(u('uGust'), f.gust); gl.uniform3fv(u('uSunC'), [2.4, 2.15, 1.7]); gl.uniform3fv(u('uSky'), [0.78, 0.84, 0.86]); gl.uniform1f(u('uOpen'), 0);
    gl.uniform4fv(u('uReach'), this.reach); gl.uniform2fv(u('uPick'), this.pick); gl.uniform1f(u('uMarks'), this.marks); gl.uniform3fv(u('uRight'), right);
    gl.uniform4fv(u('uBounds'), [X0, Z0, X0 + (NX - 1) * CELL, Z0 + (NZ - 1) * CELL]);
  }
  private attr(loc: number, buf: WebGLBuffer, size: number, stride: number, off: number, div = 0) {
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, off * 4); gl.vertexAttribDivisor(loc, div);
  }
  private clearAttrs() { const gl = this.gl; for (let i = 0; i < 6; i++) { gl.disableVertexAttribArray(i); gl.vertexAttribDivisor(i, 0); } }

  draw(f: Frame, w: number, h: number) {
    const gl = this.gl;
    this.targets(w, h);
    const near = 0.1, far = 2400, proj = perspective(f.fov, w / h, near, far), view = lookAt(f.eye, f.look), vp = mul(proj, view);
    const right = [view[0], view[4], view[8]], fwd = norm([f.look[0] - f.eye[0], 0, f.look[2] - f.eye[2]]);
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.viewport(0, 0, w, h);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 1]); gl.clearBufferfv(gl.DEPTH, 0, [1]);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    const use = (n: string) => { const p = this.progs[n]; gl.useProgram(p); this.uni(p, f, vp, right); this.clearAttrs(); return p; };
    // (which tiles are worth drawing: near enough, and not behind)
    const visible = (t: { x: number; z: number }, range: number) => {
      const dx = t.x - f.eye[0], dz = t.z - f.eye[2], d = Math.hypot(dx, dz);
      return d < range && (d < TILE * 1.5 || (dx * fwd[0] + dz * fwd[2]) / d > -0.35);
    };
    // ─── the far ranges first, under everything (blended onto the page's clear) ───
    {
      use('ridge'); gl.depthMask(false);
      this.attr(0, this.ridge.buf, 3, 5, 0); this.attr(1, this.ridge.buf, 2, 5, 3);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.TRIANGLES, 0, this.ridge.count);
      gl.disable(gl.BLEND); gl.depthMask(true);
    }
    // ─── the ground ───
    {
      use('ground');
      this.attr(0, this.ground.buf, 3, 7, 0); this.attr(1, this.ground.buf, 3, 7, 3); this.attr(2, this.ground.buf, 1, 7, 6);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ground.idx); gl.drawElements(gl.TRIANGLES, this.ground.count, gl.UNSIGNED_INT, 0);
    }
    // ─── steps and stones ───
    {
      const p = use('solid');
      gl.uniform1i(gl.getUniformLocation(p, 'uKind'), 1);
      this.attr(0, this.vbo.box.buf, 3, 6, 0); this.attr(1, this.vbo.box.buf, 3, 6, 3);
      this.attr(2, this.steps.buf, 4, 8, 0, 1); this.attr(3, this.steps.buf, 4, 8, 4, 1);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vbo.box.count, this.steps.count);
      gl.uniform1i(gl.getUniformLocation(p, 'uKind'), 2);
      for (let k = 0; k < 4; k++) {
        if (!this.stones[k].count) continue;
        const m = this.vbo[`lump${k}`];
        this.attr(0, m.buf, 3, 6, 0); this.attr(1, m.buf, 3, 6, 3);
        this.attr(2, this.stones[k].buf, 4, 8, 0, 1); this.attr(3, this.stones[k].buf, 4, 8, 4, 1);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, this.stones[k].count);
      }
    }
    // ─── the litter ───
    {
      use('litter');
      this.attr(0, this.vbo.quad.buf, 2, 2, 0); this.attr(1, this.litter.buf, 4, 8, 0, 1); this.attr(2, this.litter.buf, 4, 8, 4, 1);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -2);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.litter.count);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    // ─── the culms: finer near, coarser further ───
    {
      use('culm');
      for (const t of this.culms.tiles) {
        if (!visible(t, this.pick[1] + 20)) continue;
        const d = Math.hypot(t.x - f.eye[0], t.z - f.eye[2]), m = d < 26 ? this.vbo.culmNear : this.vbo.culmFar;
        this.attr(0, m.buf, 2, 2, 0);
        for (let a = 0; a < 3; a++) this.attr(1 + a, this.culms.buf, 4, 12, t.start * 12 + a * 4, 1);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, t.count);
      }
    }
    // ─── the sprays ───
    {
      use('spray');
      this.attr(0, this.vbo.quad.buf, 2, 2, 0);
      for (const t of this.sprays.tiles) {
        if (!visible(t, this.pick[1])) continue;
        for (let a = 0; a < 4; a++) this.attr(1 + a, this.sprays.buf, 4, 16, t.start * 16 + a * 4, 1);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, t.count);
      }
    }
    // ─── the page ───
    {
      const s = this.sunDir, sp = [f.eye[0] + s[0] * 1000, f.eye[1] + s[1] * 1000, f.eye[2] + s[2] * 1000, 1];
      const c = [0, 1, 2, 3].map((i) => vp[i] * sp[0] + vp[4 + i] * sp[1] + vp[8 + i] * sp[2] + vp[12 + i] * sp[3]);
      this.sunUV = c[3] > 0 ? [c[0] / c[3] * 0.5 + 0.5, c[1] / c[3] * 0.5 + 0.5, Math.min(1, c[3] / 1000)] : [0.5, 0.9, 0];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); gl.disable(gl.DEPTH_TEST);
    const p = this.progs.post; gl.useProgram(p); this.clearAttrs();
    const u = (n: string) => gl.getUniformLocation(p, n);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texC); gl.uniform1i(u('uC'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texA); gl.uniform1i(u('uA'), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texZ); gl.uniform1i(u('uZ'), 2);
    gl.uniform2fv(u('uRes'), [w, h]); gl.uniform1f(u('uNear'), near); gl.uniform1f(u('uFar'), far); gl.uniform1f(u('uPx'), Math.max(1, h / 900));
    gl.uniform3fv(u('uPaper'), [0.937, 0.902, 0.824]); gl.uniform3fv(u('uInk'), [0.13, 0.12, 0.105]); gl.uniform3fv(u('uSunUV'), this.sunUV);
    gl.uniform1f(u('uClean'), this.clean ? 1 : 0); gl.uniform1f(u('uMarks'), this.marks);
    this.attr(0, this.vbo.screen.buf, 2, 2, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

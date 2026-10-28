/**
 * The grove drawn as the board has it (devtools/bamboo/board.jpg): a lit picture with ink on it, held close to the
 * eye, giving out through ink to the page.
 *
 * Two passes, after Labyrinth, and a shadow pass before them:
 * - **the shadows**: the culms near you, seen from the sun, so their shadows stripe the litter, the steps and each
 *   other; the canopy's own shade is its dapple, cast down the sun from the gaps overhead;
 * - **the picture** (one framebuffer, two colour targets and depth): every surface lit by the sun (warm, through the
 *   dapple and the culms' shadows), the sky and a little bounce, in its own colour; and beside the colour what it is (its
 *   kind), whether an outline may run along its edge here (a culm's breaks just under each node, as a brush lifts
 *   there), how far it's drawn (its ink's reach), and its own **marks**: the ink the things call for, drawn on them (a
 *   culm's node ticks and dry-brush streaks down its shaded side, ink pooled at its foot; a spray's blades, filled in
 *   ink where the colour's given out; a fallen leaf's edge); and on the land, laid in the same pass, its own strokes
 *   (strokes.ts: a trail's edges, a bank's rim and hachures, a face's fall, the hillside's contours), inked into the marks;
 * - **the page** (post): the outlines found from the depth and the kinds, inked on the side that's in front.
 *
 * **The reach** (`Renderer.reach`, set by `?colour=&wash=&ink=&frame=&depth=` or the page's own control): not a mask over
 * the picture but a quality of each thing in it. Each thing asks how far drawn it is (`bandAt`: by how far it is from
 * the eye, and by how far it stands from the focus, across the frame and in depth, whichever is further), once for
 * the whole of it, give or take its own pick; and is drawn in three stages: **lit**, then laid **flat** in its own colour
 * (the light gone), then its **ink** alone on the paper. A culm, a spray, a stone changes whole; a culm's top goes before
 * its foot; the ground goes leaf by fallen leaf, the bare earth between them first, its edge dragged dry across the
 * slope. Where a thing's colour has gone its ink is heavier, as a drawing's line carries what the colour did.
 *
 * `?clean`: no shafts or paper grain. `?marks=0`: the picture without its ink.
 */
import { type Chunk, CHUNK, CN, CELL, HALF, BANK } from './world';
import { STROKE_STRIDE } from './strokes';

export interface Frame {
  eye: [number, number, number]; look: [number, number, number]; fov: number; t: number;
  /** a gust: its direction (x, z), where its front is along that direction, how strong (0..1) */
  gust: [number, number, number, number];
  /** how fast you're going (m/s): the view widens with it */
  speed?: number;
  /** the head's roll (radians): leaning into a turn, swaying with the stride */
  roll?: number;
  /** how far off the focus is (metres): what's straight ahead, that the page comes in round */
  focus?: number;
}
/** how far the drawing reaches: in the world (metres: colour to, wash to, ink to, how soft each band is), and in the
 * frame (`frame`: 0 the page closing in tight round the focus … 1 hardly at all; `depth`: how much sooner things nearer or farther than the focus
 * go there) */
export interface Reach { colour: number; wash: number; ink: number; soft: number; frame: number; depth: number }

const NOISE = `
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
float fbm2(vec2 p) { return vn(p) * .55 + vn(p * 2.03 + 7.1) * .3 + vn(p * 4.1 - 3.7) * .15; }
`;
const COMMON = `#version 300 es
precision highp float; precision highp int; precision highp sampler2DShadow;
uniform mat4 uVP; uniform vec3 uEye; uniform float uTime; uniform vec3 uSun; uniform vec4 uGust;
uniform vec4 uReach; // colour to, wash to, ink to, softness (metres)
uniform vec4 uFrame; // where the frame starts drawing out (from the focus, 0…~1.6), the focus's distance, -, how much sooner things nearer or farther than it go
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
// (how far along from the picture to the page a point is: 0 the picture whole, .6 its light gone (its own colour left),
// 1.8 its colour gone (its ink left), 2.9 its ink gone (the page). By its distance in the world, and by where it falls in
// the frame: how far it is from the focus (what's straight ahead, at its distance) across the frame, out to every edge
// of it, and in depth, nearer or farther than the focus, whichever is further along. A
// thing asks this once, at a point of its own, so it's drawn one way whole; never cut across by a line on the screen)
float bandAt(vec3 p) {
  float d = distance(p, uEye);
  float C = max(uReach.x, .01), W = max(uReach.y, C + .01), I = max(uReach.z, W + .01);
  float bw = d <= C ? .6 * d / C : d <= W ? .6 + 1.2 * (d - C) / (W - C) : 1.8 + 1.1 * (d - W) / (I - W);
  vec4 cp = uVP * vec4(p, 1.);
  if (cp.w < .05) return bw;
  vec2 n = abs(cp.xy / cp.w);
  // (how far out in the frame: near-square, so every edge (top and bottom as much as the sides) is as far out as any;
  // and further for being far beyond the focus; a little for being much nearer, so the ground at your feet holds)
  float m = pow(pow(n.x, 3.) + pow(n.y, 3.), 1. / 3.);
  float dl = log2(max(d, .3) / max(uFrame.y, 1.));
  float sc = m + uFrame.w * .2 * (dl > 0. ? dl : -dl * .25);
  // (from the focus out: the picture, then linework, then sparse marks, then the bare page just inside every edge,
  // whatever's there)
  float bf = max(0., .6 + (sc - uFrame.x) * 2.35 / max(.08, .95 - uFrame.x));
  // (the valley below is kept in colour, under its mist, a little longer than it would be: the view out is the point)
  return max(bw, bf) + smoothstep(25., 70., uEye.y - p.y) * .6;
}
// (the stages: the light first, then the colour, then the ink)
float lightOf(float b) { return 1. - smoothstep(.52, .68, b); }
float colourOf(float b) { return 1. - smoothstep(1.64, 1.76, b); }
// (the ink: full through the linework, lighter through the sparse marks, then gone, a thing at a time)
float inkOf(float b) { return (1. - smoothstep(2.82, 2.9, b)) * mix(1., .4, smoothstep(1.9, 2.8, b)); }
`;
// (the light: the sun through the canopy's gaps and past the culms' shadows, shared by every surface, so a patch of
// sun lies across the path, the litter and a culm alike)
const LIGHT = `
uniform vec3 uSunC; uniform vec3 uSky; uniform float uOpen;
uniform sampler2DShadow uShadow; uniform mat4 uLightVP; uniform float uShadowOn;
float dapple(vec3 p) {
  vec2 q = p.xz - uSun.xz / max(uSun.y, .2) * (16. - p.y * .5);
  q += vec2(sin(uTime * .7), cos(uTime * .53)) * .25;
  float g = fbm2(q * .55) * .55 + vn(q * 2.4) * .45;
  return smoothstep(.5 - uOpen * .1, .57 - uOpen * .1, g);
}
float culmShade(vec3 p) {
  if (uShadowOn < .5) return 1.;
  vec4 l = uLightVP * vec4(p, 1.); vec3 q = l.xyz / l.w * .5 + .5;
  if (q.x < 0. || q.x > 1. || q.y < 0. || q.y > 1.) return 1.;
  float s = 0., o = 1. / 2048.;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) s += texture(uShadow, vec3(q.xy + vec2(i, j) * o, q.z - .0015));
  return s / 9.;
}
vec3 lin(vec3 c) { return c * c; }
// (the carpet of fallen leaves: one leaf to a cell, in two sizes, each turned its own way and its own colour, read
// from the cells round it; given out to its average tone where a cell is smaller than a few pixels. .a: on a leaf;
// .w of the second: its edge, for the ink)
vec4 leaves(vec2 p, float cell, out float rim, out float id) {
  vec2 g = p / cell, i0 = floor(g);
  float best = 0.; vec3 col = vec3(0.); rim = 1.;
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) {
    vec2 c = i0 + vec2(a, b), h = vec2(h21(c), h21(c + 17.3));
    vec2 o = c + h; float ang = h21(c + 5.1) * 3.1416, s = sin(ang), co = cos(ang);
    vec2 d = g - o; d = vec2(co * d.x + s * d.y, -s * d.x + co * d.y);
    float len = 1.1 + h.x * .9, t = d.x / len + .5;
    if (t < 0. || t > 1.) continue;
    float w = .095 * pow(sin(3.1416 * pow(t, .8)), .7) * len, e = w - abs(d.y);
    if (e > 0. && h.y > best) { best = h.y; float tone = h21(c + 9.7); col = mix(vec3(.93, .78, .5), vec3(.52, .33, .17), tone) * (.85 + .3 * smoothstep(0., w, e)); rim = e / max(w, 1e-3); }
  }
  id = best;
  return vec4(col, best > 0. ? 1. : 0.);
}
vec3 carpet(vec3 base, vec2 p, float px, out float mark, out float leaf) {
  float r1, r2, i1, i2;
  vec4 a = leaves(p, .16, r1, i1), b = leaves(p + 7.3, .26, r2, i2);
  // (which leaf is on top here, if any: its own pick, for how long its colour holds)
  leaf = px > .05 ? -1. : a.a > .5 ? i1 : b.a > .5 ? i2 : -1.;
  vec3 c = mix(base, b.rgb, b.a * .9);
  c = mix(c, a.rgb, a.a * .85);
  float far = smoothstep(.02, .06, px);
  // (each near leaf's edge, a fine stroke)
  mark = (1. - far) * max(a.a * (1. - smoothstep(0., .18, r1)), b.a * (1. - smoothstep(0., .14, r2)) * .7) * (1. - smoothstep(.01, .03, px));
  return mix(c, mix(base, vec3(.76, .58, .36), .55), far);
}
vec3 lit(vec3 alb, vec3 N, vec3 p, float wrap, float ao) {
  float sun = dapple(p) * culmShade(p), ndl = max(0., (dot(N, uSun) + wrap) / (1. + wrap));
  vec3 a = lin(alb);
  return a * (uSunC * ndl * sun + uSky * (.5 + .5 * N.y) * ao + vec3(.2, .15, .08) * (1. - N.y) * .3 * ao);
}
// (the display: a soft shoulder, then back to the eye's curve)
vec3 show(vec3 c) { c = 1. - exp(-c * 1.4); return sqrt(c); }
`;
// (what a fragment hands the page: its colour and how much of it's laid (a); its kind, whether an outline may run here,
// how far its ink reaches, and its own marks)
const OUT = `
layout(location = 0) out vec4 oC; layout(location = 1) out vec4 oA;
// (\`lit\`: as the light has it; \`own\`: its own colour, flat, as a painter lays it once the light's gone; \`b\`: how
// far along it is (bandAt, at a point of the thing's own))
void emit(vec3 lit, vec3 own, float b, float kind, float allow, float mark, vec3 p) {
  // (a thing gone to the page is gone: it hides nothing behind it. One drawn as its ink alone still stands in front of
  // what's behind it, as a drawn culm does, its paper its own. The ground goes as its leaves do, never as a hole)
  if (kind > .3 && inkOf(b) < .04) discard;
  float d = distance(p, uEye), colour = colourOf(b);
  vec3 c = mix(own, lit, lightOf(b));
  // (a little air between, warm and pale)
  c = mix(c, vec3(.93, .9, .8), (1. - exp(-max(0., d - 3.) / 40.)) * .55);
  // (and the valley's mist: down below the eye and far off, a cool blue-grey veil that lies in the hollows)
  float below = uEye.y - p.y, veil = smoothstep(3., 30., below) * smoothstep(12., 70., d) * (.55 + .35 * vn(p.xz * .02 + uTime * .01));
  c = mix(c, vec3(.78, .82, .86), clamp(veil, 0., .85));
  oC = vec4(c, colour);
  // (as the colour goes, the marks come up to carry the thing)
  oA = vec4(kind, allow, inkOf(b), clamp(mark * (1. + .6 * (1. - colour)), 0., 1.));
}
// (a thing's own colour, flat: about as it shows in a soft light)
vec3 own(vec3 alb) { return show(lin(alb) * vec3(1.25, 1.2, 1.1)); }
`;

const CULM_VS = COMMON + `
layout(location = 0) in vec2 aUV;
layout(location = 1) in vec4 iA; layout(location = 2) in vec4 iB; layout(location = 3) in vec4 iC;
out vec3 vW; out vec3 vN; out float vY; out float vQ; out float vU; out vec3 vI; flat out float vBand; flat out float vJit;
uniform vec2 uPick; // drawn whole up to, gone by (metres)
uniform mat4 uLightVP; uniform int uDepth;
void main() {
  vec3 b = iA.xyz; float r = iA.w, h = iB.x; vec2 lean = iB.yz; float node = iB.w, phase = iC.y, pick = iC.z;
  float dist = distance(b.xz, uEye.xz);
  // (left out whole where the drawing has thinned past its pick)
  if (pick > 1. - smoothstep(uPick.x, uPick.y, dist)) { gl_Position = vec4(2., 2., 2., 1.); return; }
  float y = aUV.y * h, a = aUV.x * 6.2832;
  // (internodes lengthen up the culm; a slight swelling at each node)
  float q = y / (node * (1. + .9 * smoothstep(0., .45 * h, y)));
  float swell = 1. + .06 * exp(-pow(fract(q) * 14., 2.)) + .06 * exp(-pow((fract(q) - 1.) * 14., 2.));
  float rr = r * (1. - .62 * pow(aUV.y, 1.3)) * swell;
  vec3 c = culmAt(b, h, lean, phase, y);
  vec3 n = vec3(cos(a), 0., sin(a));
  vW = c + n * rr; vN = n; vY = y; vQ = q; vU = a * r; vI = vec3(iC.x, phase, h);
  // (how far it's drawn: asked once, at eye height on it, each culm a little its own way)
  vJit = (fract(pick * 7.31) - .5) * 1.1;
  // (how far drawn the culm is, whole: its most-drawn point along its length, so one seen from its foot looking up, or
  // only its top in the frame, is still drawn)
  float bb = 9.;
  for (int k = 0; k < 5; k++) bb = min(bb, bandAt(culmAt(b, h, lean, phase, min(1.6, h) + (h - min(1.6, h)) * float(k) / 4.)));
  vBand = uDepth == 1 ? 0. : bb + vJit;
  gl_Position = (uDepth == 1 ? uLightVP : uVP) * vec4(vW, 1.);
}`;
const CULM_FS = COMMON + LIGHT + OUT + `
in vec3 vW; in vec3 vN; in float vY; in float vQ; in float vU; in vec3 vI; flat in float vBand; flat in float vJit;
uniform float uMarks;
void main() {
  vec3 N = normalize(vN), V = normalize(uEye - vW);
  float age = vI.x, f = fract(vQ), dist = distance(vW, uEye);
  // (how far drawn: an internode at a time, each whole, asked where it stands (from the node below it), so the page
  // comes in on a culm wherever it crosses the frame; its top a little sooner, as a long stroke runs out; never fading
  // along an internode)
  float yNode = vY - f * fwidth(vY) / max(fwidth(vQ), 1e-4);
  float drawn = bandAt(vW + vec3(0., yNode - vY, 0.)) + vJit + smoothstep(4., vI.z, yNode) * .35;
  // (the culm's own green: olive-celadon when young, duller and greyer with age, darker low down)
  vec3 young = vec3(.56, .63, .4), old = vec3(.58, .58, .44);
  vec3 alb = mix(young, old, age) * mix(.78, 1., smoothstep(0., 2.5, vY));
  // (the dry brush down its length: long streaks, some dark, darkest just under a node)
  float streak = vn(vec2(vU * 30., vY * .5 + vI.y)) * .55 + vn(vec2(vU * 85., vY * 1.6)) * .45;
  alb *= .72 + .48 * streak;
  alb = mix(alb, alb * .72, smoothstep(.5, .95, f) * .7);
  // (lichen on the old ones, in grey-white patches)
  alb = mix(alb, vec3(.8, .8, .72), smoothstep(.62, .8, vn(vec2(vU * 14., vY * 1.1) + vI.y * 3.)) * age * .55);
  // (the band of white powder just under each node, and the node's own ring)
  float far = smoothstep(10., 30., dist);
  float band = smoothstep(.82, .9, f) * (1. - smoothstep(.955, .975, f));
  alb = mix(alb, vec3(.94, .93, .86), band * (.85 - age * .4) * (1. - far));
  float ring = 1. - smoothstep(.0, .025 + fwidth(vQ) * .8, min(f, 1. - f) - .003);
  alb = mix(alb, alb * .4, ring * (1. - far * .6));
  vec3 c = show(lit(alb, N, vW, .25, 1.));
  // (the marks: a tick at each node, curving with the ring, darkest toward the culm's edges as the eye sees it; on the
  // side away from the sun, dry-brush strokes down it; ink pooled at its foot)
  float edge = 1. - abs(dot(N, V)), shade = smoothstep(.1, -.4, dot(N, uSun));
  // (far off, only some nodes are ticked, by their own picks: a far culm is a few marks, not a chain of rings)
  float chosen = step(h21(vec2(floor(vQ + .5), vI.y * 31.)), (1. - smoothstep(10., 40., dist) * .75) * mix(.45, 1., colourOf(drawn)));
  float tick = ring * chosen * (.35 + .65 * smoothstep(.1, .6, edge)) * (1. - smoothstep(30., 70., dist) * .75);
  float dry = smoothstep(.62, .82, vn(vec2(vU * 40. + 3., vY * .35))) * shade * edge * (1. - far) * .6;
  float foot = (1. - smoothstep(.0, .14, vY)) * .5 * (1. - smoothstep(15., 40., dist));
  // (the dry brush is the picture's shading: it goes with the colour; the ticks and the foot carry on in the drawing)
  float mark = max(max(tick, dry * colourOf(drawn)), foot) * uMarks;
  // (the outline breaks just under each node, as a brush lifts there)
  // (in colour the outline lifts under each node, as a brush does; drawn in ink alone, a culm's edges run on whole,
  // two long lines, and a few nodes ticked: never a chain of dashes)
  float allow = 1. - smoothstep(.72, .8, f) * (1. - smoothstep(.97, .99, f)) * chosen * colourOf(drawn);
  // (past its colour, left out more and more, a culm at a time by its own pick (and its top first), so the drawing
  // thins by omission, toward the paper, rather than fading or standing as a fence of outlines)
  float whole = min(vBand, drawn);
  // (drawn in ink, a culm's kept by how near it is: near ones held; mid ones fewer; far ones, most
  // gone, so the drawing is a few verticals and the space between them, not a fence)
  float worth = (1. - smoothstep(6., 28., dist)) * .8 + .12;
  if (whole > 1.7 && h21(vec2(vI.y * 3.7, 5.3)) > worth * (2.9 - whole) / 1.1 * 1.6) discard;
  // (a culm goes from the page whole, by its own reach; along it, as its internodes go further out, its colour gives
  // way and its ink thins, a brush lifting, never a cylinder cut off where an internode stops)
  if (inkOf(vBand) < .04) discard;
  emit(c, own(alb), min(drawn, 2.84), .4, allow, mark, vW);
}`;
const DEPTH_FS = `#version 300 es
precision highp float;
void main() {}`;

const SPRAY_VS = COMMON + `
layout(location = 0) in vec2 aUV;
layout(location = 1) in vec4 iA; layout(location = 2) in vec4 iB; layout(location = 3) in vec4 iC; layout(location = 4) in vec4 iD;
out vec3 vW; out vec2 vUV; out float vSeed; out vec3 vN; flat out float vBand;
uniform vec2 uPick; uniform vec3 uRight;
void main() {
  vec3 b = iA.xyz; float h = iA.w; vec2 lean = iB.xy; float phase = iB.z, pick = iB.w;
  float dist = distance(b.xz, uEye.xz);
  if (pick > 1. - smoothstep(uPick.x, uPick.y, dist)) { gl_Position = vec4(2., 2., 2., 1.); return; }
  float sy = iC.x, size = iC.w, yaw = iD.x, tilt = iD.y;
  vec3 anchor = culmAt(b, h, lean, phase, sy) + vec3(iC.y, 0., iC.z);
  // (a flutter of its own; streaming in a gust)
  anchor.xz += vec2(sin(uTime * 2.7 + iD.z * 40.), cos(uTime * 2.2 + iD.z * 30.)) * .05 * (1. + uGust.w * 2.);
  // (half turned to the eye, so a spray is never lost edge-on; hanging below its twig)
  vec3 r0 = vec3(cos(yaw), 0., -sin(yaw)), right = normalize(mix(r0, uRight, .55));
  vec3 up = normalize(vec3(0., 1., 0.) + cross(right, vec3(0., 1., 0.)) * tilt);
  vW = anchor + right * aUV.x * size + up * (aUV.y - .75) * size;
  vUV = aUV + .5; vSeed = iD.z; vN = normalize(cross(right, up));
  // (a spray's drawn as its culm is at eye height, a little further along for being high, and each its own way)
  // (and where it stands in the frame itself, so the canopy at the top of the frame goes to the page too)
  vBand = bandAt(anchor) + (fract(pick * 7.31) - .5) * .6 + smoothstep(4., h, sy) * .3 + (iD.z - .5) * .4;
  gl_Position = uVP * vec4(vW, 1.);
}`;
const SPRAY_FS = COMMON + LIGHT + OUT + `
in vec3 vW; in vec2 vUV; in float vSeed; in vec3 vN; flat in float vBand;
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
  // (lit: dark ink-green in shade, yellow-green in the sun, glowing gold-green where the sun's behind it)
  float sun = dapple(vW), back = pow(max(0., dot(-V, uSun)), 2.5) * sun;
  vec3 alb = mix(vec3(.18, .26, .12), vec3(.5, .6, .24), .35 + .65 * best);
  vec3 c = show(lit(alb, N, vW, .6, .9) + lin(vec3(.9, .92, .42)) * back * 1.2 * uSunC);
  // (the marks: each blade's edge near; where the colour's given out, the blade filled in ink, as a brush lays it)
  float near = 1. - smoothstep(8., 26., distance(vW, uEye));
  float mark = max((1. - smoothstep(.0, .3, rim)) * near * .85, (1. - colourOf(vBand)) * (.22 + .16 * best)) * uMarks;
  if (vBand > 1.8 && fract(vSeed * 17.3) > (2.9 - vBand) / 1.1) discard;
  emit(c, own(alb), vBand, .6, near, mark, vW);
}`;

const GROUND_VS = COMMON + `
layout(location = 0) in vec3 aP; layout(location = 1) in vec3 aN; layout(location = 2) in vec2 aD;
out vec3 vW; out vec3 vN; out float vD; out float vRock;
void main() { vW = aP; vN = aN; vD = aD.x; vRock = aD.y; gl_Position = uVP * vec4(aP, 1.); }`;
const GROUND_FS = COMMON + LIGHT + OUT + `
in vec3 vW; in vec3 vN; in float vD; in float vRock;
uniform float uMarks;
void main() {
  vec3 N = normalize(vN);
  float dist = distance(vW, uEye);
  // (the litter's warm ochre everywhere under the grove; the worn middle of a trail paler earth; banks darker soil,
  // mossy in the hollows)
  float n1 = fbm2(vW.xz * .45), n2 = vn(vW.xz * 3.1);
  vec3 litter = mix(vec3(.82, .68, .48), vec3(.68, .54, .36), n1);
  litter *= .9 + .2 * vn(vW.xz * vec2(9., 2.5) + n1 * 4.);
  vec3 earth = mix(vec3(.86, .78, .63), vec3(.77, .68, .54), n2);
  vec3 soil = vec3(.5, .43, .33);
  float worn = 1. - smoothstep(${(HALF * 0.35).toFixed(2)}, ${(HALF * 0.85).toFixed(2)}, vD + (n2 - .5) * .3);
  float px = length(fwidth(vW.xz)), leafMark, leaf;
  vec3 carp = carpet(litter * .8, vW.xz, px, leafMark, leaf);
  vec3 alb = mix(carp, mix(earth, carp, .1 + .2 * step(.62, vn(vW.xz * 2.2))), worn * .95);
  alb = mix(alb, soil, smoothstep(.35, .7, 1. - N.y) * .7);
  // (a trail's cut bank: bare red-brown earth where it's steep, streaked down its fall, with roots run across it and
  // small stones in it; the litter only lies on its ledges)
  float cutBank = smoothstep(${(HALF + 0.15).toFixed(2)}, ${(HALF + 0.5).toFixed(2)}, vD) * (1. - smoothstep(${(HALF + BANK).toFixed(2)}, ${(HALF + BANK + 2.5).toFixed(2)}, vD)) * smoothstep(.04, .2, 1. - N.y);
  if (cutBank > .01) {
    vec2 fl = normalize(N.xz + 1e-4), ac = vec2(-fl.y, fl.x);
    float u = dot(vW.xz, ac), v = vW.y;
    vec3 earth2 = mix(vec3(.55, .38, .25), vec3(.42, .3, .2), vn(vec2(u * 1.3, v * 4.)));
    earth2 *= .85 + .3 * vn(vec2(u * 6., v * .8));
    // (roots: dark wavering lines across the cut)
    float rl = abs(fract(v * 1.4 + vn(vec2(u * .7, 3.)) * 1.2) - .5);
    float root = (1. - smoothstep(.02, .05, rl)) * step(.55, vn(vec2(u * .5, floor(v * 1.4) * 3.7)));
    earth2 = mix(earth2, vec3(.3, .22, .16), root * .8);
    // (stones in it, pale and mossed on top)
    float st = smoothstep(.62, .7, vn(vec2(u, v * 1.6) * 2.2 + 11.));
    earth2 = mix(earth2, mix(vec3(.64, .62, .56), vec3(.4, .5, .24), smoothstep(.5, .9, N.y + .3)), st);
    alb = mix(alb, earth2, cutBank * (1. - smoothstep(.93, .99, N.y)) * .9);
  }
  // (green: moss and low growth in patches, more along a trail's banks)
  float green = smoothstep(.58, .74, fbm2(vW.xz * .3 + 9.)) * .45 + smoothstep(${(HALF + 0.2).toFixed(2)}, ${(HALF + 1.2).toFixed(2)}, vD) * (1. - smoothstep(3., 6., vD)) * smoothstep(.4, .7, vn(vW.xz * .9)) * .5;
  alb = mix(alb, vec3(.36, .45, .2), green * (1. - worn));
  // (rock where the ground's steep: grey stone, streaked down its fall, mossy where it's ledged)
  vec2 fall = normalize(N.xz + 1e-4);
  float across = dot(vW.xz, vec2(-fall.y, fall.x)) + (vn(vW.xz * .3 + vW.y * .2) - .5) * 1.4;
  vec3 stone = mix(vec3(.66, .63, .56), vec3(.5, .49, .45), fbm2(vec2(across * .8, vW.y * .5)));
  stone = mix(stone, vec3(.42, .5, .26), smoothstep(.55, .75, N.y + (vn(vW.xz * 1.3) - .5) * .4) * .6);
  alb = mix(alb, stone, vRock);
  vec3 c = show(lit(alb, N, vW, .2, .9));
  // (the marks: each near fallen leaf's edge; the land's own (a trail's edges, a bank's rim, a face's fall, the lie of
  // the hillside) are strokes laid on it, strokes.ts)
  float mark = leafMark * .55 * uMarks;
  // (how far it's drawn: the bare ground between the leaves goes first; each fallen leaf holds its colour by its own
  // pick, so the litter thins to a few painted leaves and then their outlines on the paper)
  // (the edge is a brush's: strokes laid across the fall of the slope, dragged dry, so it breaks into them in the world
  // rather than following any line of the frame)
  vec2 down2 = N.xz / max(length(N.xz), .05), across2 = vec2(-down2.y, down2.x);
  float stroke = vn(vec2(dot(vW.xz, across2) * .35, dot(vW.xz, down2) * 3.2)) * .6 + vn(vec2(dot(vW.xz, across2) * 1.1, dot(vW.xz, down2) * 9.)) * .4;
  float band = bandAt(vW) + (fbm2(vW.xz * .5 + 3.) - .5) * .5 + (stroke - .5) * 1.4;
  band = leaf >= 0. ? band + (leaf - .5) * 1.2 : band + .25 + (vRock > .5 ? -.3 : 0.);
  emit(c, own(alb), band, .2, 1., mark, vW);
}`;

const SOLID_VS = COMMON + `
layout(location = 0) in vec3 aP; layout(location = 1) in vec3 aN;
layout(location = 2) in vec4 iA; layout(location = 3) in vec4 iB;
out vec3 vW; out vec3 vN; out vec3 vL; out float vMoss; out float vSeed; flat out float vBand;
uniform int uKind; uniform mat4 uLightVP; uniform int uDepth;
void main() {
  vec3 p = aP, n = aN;
  float yaw = iA.w;
  if (uKind == 1) {
    // (a step: the unit box set to its depth, width and drop, its front edge at the origin)
    p = vec3(p.x * iB.y, p.y * iB.z - iB.z, (p.z + .5) * iB.x);
  } else if (uKind == 3) {
    // (a root: the lump drawn out long and thin along x, bowed a little, its ends thinning into the earth)
    float u = clamp(p.x / 1.7, -1., 1.), thin = 1. - u * u * .6;
    p = vec3(p.x / 1.7 * iB.y * .5, p.y * iB.x * .75 * thin + (1. - u * u) * iB.x * .4, p.z * iB.x * thin + sin(u * 2.4 + iB.w * 9.) * .12);
    n = normalize(vec3(n.x * .2, n.y, n.z));
  } else {
    p = vec3(p.x, p.y * iB.y, p.z) * iB.x; n = normalize(vec3(n.x, n.y / max(iB.y, .2), n.z));
  }
  float c = cos(yaw), s = sin(yaw);
  p = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); n = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
  vW = iA.xyz + p; vN = n; vL = aP; vMoss = iB.z; vSeed = iB.w;
  vBand = uDepth == 1 ? 0. : bandAt(iA.xyz + vec3(0., .2, 0.)) + (fract(iA.x * .37 + iA.z * .71) - .5) * .6;
  gl_Position = (uDepth == 1 ? uLightVP : uVP) * vec4(vW, 1.);
}`;
const SOLID_FS = COMMON + LIGHT + OUT + `
in vec3 vW; in vec3 vN; in vec3 vL; in float vMoss; in float vSeed; flat in float vBand;
uniform int uKind; uniform float uMarks;
void main() {
  vec3 N = normalize(vN);
  float n1 = fbm2(vW.xz * 1.7 + vW.y * 1.3), n2 = vn(vW.xy * 5. + vW.z * 3.);
  vec3 stone = mix(vec3(.76, .72, .63), vec3(.62, .6, .54), n1) * (.88 + .24 * n2);
  float moss = smoothstep(.2, .8, N.y) * smoothstep(.45, .7, n1 + vMoss * .3);
  vec3 alb = mix(stone, vec3(.4, .5, .22), moss * (uKind == 1 ? .2 : .7));
  float mark = 0.;
  if (uKind == 3) {
    // (a root: grey-brown bark, worn pale and smooth on top where it's trodden, moss low along it)
    alb = mix(vec3(.45, .36, .27), vec3(.36, .3, .24), n1) * (.85 + .3 * n2);
    alb = mix(alb, vec3(.66, .57, .45), smoothstep(.6, .95, N.y) * .5);
    alb = mix(alb, vec3(.38, .47, .2), smoothstep(.3, .1, N.y) * smoothstep(.4, .7, n1 + vMoss * .4) * .6);
  }
  if (uKind == 1) {
    // (a step: warm worn stone, each its own tone; the tread worn paler toward its middle and its front edge rounded
    // and lit; leaves lying on it toward its ends; moss in the joint at its back; the riser in its own shade)
    alb *= .82 + .3 * vSeed;
    alb = mix(alb, alb * vec3(1.1, 1., .84), fract(vSeed * 7.3) * .7);
    float onTop = smoothstep(.8, .95, N.y), front = 1. - smoothstep(.0, .12, vL.z + .5);
    alb = mix(alb, vec3(.84, .79, .66), onTop * ((1. - abs(vL.x) * 1.6) * .35 + front * .4));
    float r, lid; vec4 lv = leaves(vW.xz + vSeed * 13., .17, r, lid);
    alb = mix(alb, lv.rgb, lv.a * onTop * (.3 + .6 * smoothstep(.15, .45, abs(vL.x))));
    alb = mix(alb, vec3(.38, .48, .2), onTop * smoothstep(.36, .5, vL.z) * smoothstep(.4, .7, vn(vW.xz * 6.)) * .7);
    alb *= mix(1., .74, 1. - smoothstep(.2, .6, N.y));
    // (the marks: the crack or two across a stone, now and then)
    mark = step(.8, fract(vSeed * 3.7)) * (1. - smoothstep(.0, .015, abs(vL.x - (fract(vSeed * 11.) - .5) * .6 + (vn(vW.xz * 7.) - .5) * .08))) * onTop * .7;
  }
  vec3 c = show(lit(alb, N, vW, .2, .85));
  emit(c, own(alb), vBand, uKind == 1 ? .8 : .7, 1., mark * uMarks, vW);
}`;

const RIDGE_VS = COMMON + `
layout(location = 0) in vec3 aP; layout(location = 1) in vec2 aT;
out vec3 vW; out vec2 vT;
void main() { vW = aP + vec3(uEye.x, uEye.y * .85, uEye.z); vT = aT; gl_Position = uVP * vec4(vW, 1.); }`;
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
  // (a cool blue-grey, warmer toward the light: the far side of the valley in the morning's mist)
  oC = vec4(mix(vec3(.46, .54, .62), vec3(.62, .66, .7), layer * .35), min(1., a * 1.25));
  oA = vec4(.1, 0., 0., 0.);
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
uniform vec4 uReach;
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
      vec2 q = vUV + o2; float zq = lz(q), zo = lz(vUV - o2); vec4 Aq = texture(uA, q);
      vec4 F = z < zq ? A : Aq;
      // (against where the surface here would run on to: 1/z is straight across a plane, so a slope seen edge-on isn't
      // a jump)
      float zp = 1. / max(2. / z - 1. / zo, 1e-5);
      float rel = min(abs(zq - z), abs(zq - zp)) / min(z, zq);
      float dj = smoothstep(.05, .14, rel);
      float kj = abs(Aq.x - A.x) > .05 && min(Aq.x, A.x) > .15 && !(min(Aq.x, A.x) < .22 && max(Aq.x, A.x) < .22) ? .8 : 0.;
      if (F.x < .15) continue;
      // (lighter with distance: a far culm is a fine grey line, not a dark one)
      float zf = min(z, zq);
      ink = max(ink, max(dj, kj) * F.y * F.z * mix(1., .28, smoothstep(10., 40., zf)) * (1.15 - .35 * C.a));
    }
    // (and the things' own marks, as far as their ink reaches)
    ink = max(ink, A.w * A.z);
  }
  // ─── the page: each thing laid on it as it's drawn (its colour as far as that goes), its ink over that ───
  float grain = uClean > .5 ? 0. : (vn(vUV * uRes * .35) - .5) * .05 + (vn(vUV * uRes * .04) - .5) * .04;
  vec3 paper = uPaper * (1. + grain);
  vec3 col = paper;
  col = mix(col, C.rgb * mix(vec3(1.), paper / .94, .3), C.a);
  // (shafts of light where the canopy opens toward the sun)
  if (uClean < .5 && uSunUV.z > 0.) {
    vec2 d = (uSunUV.xy - vUV) / 32.; vec2 p = vUV; float acc = 0., w = 1.;
    for (int i = 0; i < 32; i++) { p += d; vec4 Ap = texture(uA, p); acc += (Ap.x < .05 ? 1. : 0.) * w; w *= .95; }
    float shaft = acc / 14. * uSunUV.z * (.5 + .5 * vn(vec2(atan(vUV.y - uSunUV.y, vUV.x - uSunUV.x) * 11., 1.)));
    col = mix(col, vec3(1., .95, .8), clamp(shaft * .5 * C.a, 0., .6));
  }
  col = mix(col, uInk, clamp(ink, 0., 1.) * .9);
  // (the last few pixels at every edge are the paper, whatever's drawn: its edge torn a little, not a ruled line)
  vec2 pxp = vUV * uRes; float edgePx = min(min(pxp.x, uRes.x - pxp.x), min(pxp.y, uRes.y - pxp.y));
  float keepOut = 10. * uPx * (.7 + .6 * vn(vec2(pxp.x + pxp.y, pxp.x - pxp.y) * .03));
  col = mix(col, paper, 1. - smoothstep(keepOut * .6, keepOut, edgePx));
  o = vec4(col, 1.);
}`;

// ─── the land's strokes (strokes.ts): ribbons laid on it, widened to a least width on the screen by their family so
// the structure holds at any distance; each asks once, at its anchor, how far it's drawn, and is left out whole by its
// pick, never faded; inked into the marks the page draws (max), so a stroke shows on the paper where the ground's colour
// has gone, and over the colour as much as its family holds there ───
const STROKE_VS = COMMON + `
layout(location = 0) in vec3 aP; layout(location = 1) in vec3 aS; layout(location = 2) in vec2 aW; layout(location = 3) in vec2 aT;
layout(location = 4) in vec3 aF; layout(location = 5) in vec3 aAnchor;
uniform vec2 uRes;
out float vAcross; out vec3 vW; flat out vec3 vF; flat out float vBand; flat out float vKeep;
// (the least a mark of each family is on the screen, in pixels: a rim most, then a string, a contact, an edge; detail less)
// (primary structure (a rim, a trail's edge, a flight's string and nosings, a stone's contact) about a pixel; the secondary
// (hachures, a face's strokes, contours, roots) finer, under a pixel, so they texture rather than rule)
float least(float f) { return f < .5 ? 1.1 : f < 1.5 ? 1.4 : f < 2.5 ? .65 : f < 3.5 ? .7 : f < 4.5 ? .6 : f < 5.5 ? 1.1 : f < 6.5 ? 1. : f < 7.5 ? 1. : .75; }
void main() {
  float fam = floor(aF.x + .001);
  // (across the way it runs, turned to the eye; lifted a little toward the eye, off what it lies on)
  vec3 toEye = normalize(uEye - aP), side = normalize(cross(aS, toEye) + vec3(1e-5));
  vec4 c0 = uVP * vec4(aP, 1.), c1 = uVP * vec4(aP + side * aW.x, 1.);
  float px = c0.w > .01 && c1.w > .01 ? length((c1.xy / c1.w - c0.xy / c0.w) * .5 * uRes) : 1.;
  // (and no wider than a brush lays it, however near: a stroke at your feet isn't a wedge)
  float k = px < least(fam) ? min(5., least(fam) / max(px, 1e-3)) : min(1., least(fam) * 2.4 / px);
  vec3 p = aP + side * aW.x * aW.y * aT.x * k + toEye * min(.08, distance(uEye, aP) * .004);
  vAcross = aT.x; vW = p; vF = aF;
  float d = distance(aAnchor, uEye);
  // (asked here, a stretch of it at a time, so a long stroke lifts off before the paper rather than running into it)
  vBand = max(bandAt(aAnchor), bandAt(aP)) + (aF.z - .5) * .6;
  // (the detail (hachures, a face's strokes, contours, nosings) thinned with distance, so far off the structure's kept)
  bool detail = (fam > 1.5 && fam < 4.5) || (fam > 5.5 && fam < 6.5);
  vKeep = detail ? 1. - smoothstep(12., 60., d) * .85 : 1. - smoothstep(60., 140., d) * .7;
  gl_Position = uVP * vec4(p, 1.);
}`;
const STROKE_FS = COMMON + `
in float vAcross; in vec3 vW; flat in vec3 vF; flat in float vBand; flat in float vKeep;
layout(location = 0) out vec4 oC; layout(location = 1) out vec4 oA;
uniform float uMarks; uniform float uAll;
void main() {
  float fam = floor(vF.x + .001), weight = fract(vF.x + .001), persist = vF.y, pick = vF.z;
  // (left out whole: through the sparse marks fewer and fewer, by each stroke's own pick, none at the page)
  if (uAll < .5 && (pick > vKeep || pick > (2.9 - vBand) / 1.1)) discard;
  float aa = max(fwidth(vAcross), 1e-4);
  float cov = 1. - smoothstep(1. - aa, 1. + aa * .5, abs(vAcross));
  float dry = smoothstep(.18, .42, vn(vW.xz * 6. + vW.y * 2. + fam * 3.1));
  // (lighter with distance, as the outlines are: a far trail's edge, seen along, is a fine grey line, not a rule; a rim
  // holds most)
  float far = smoothstep(8., 45., distance(vW, uEye)) * (fam > .5 && fam < 1.5 ? .4 : .7);
  float a = uAll > .5 ? cov : cov * min(1., .4 + weight) * mix(.6, 1., dry) * mix(persist, 1., 1. - colourOf(vBand)) * (1. - far) * uMarks;
  if (a < .02) discard;
  oC = vec4(0.); oA = vec4(0., 0., 1., min(1., a * 1.15));
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
/** a step's stone: the unit box (x -0.5..0.5, y 0..1, z -0.5..0.5) as a worn slab, its edges rounded off and its faces
 * a little uneven, so a flight is laid stones and not boxes */
function slabMesh() {
  const P: number[] = [], NU = 16, NV = 10, e = 0.3, f = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
  // (a sphere pushed out toward the box: flat faces, the corners left round; the faces a little uneven)
  const at = (i: number, j: number) => {
    const u = (i / NU) * 2 * Math.PI, v = (j / NV) * Math.PI - Math.PI / 2, x = Math.cos(v) * Math.cos(u), y = Math.sin(v), z = Math.cos(v) * Math.sin(u);
    const bx = f(x), by = f(y), bz = f(z), wob = 1 + 0.05 * Math.sin(x * 9 + z * 7) + 0.04 * Math.sin(z * 13 - x * 5);
    return [bx * 0.5 * wob, 0.5 + by * 0.5 - (by > 0.9 ? 0.04 * Math.sin(x * 11 + z * 9) ** 2 : 0), bz * 0.5 * wob];
  };
  for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    for (const T of [[a, c, b], [a, d, c]]) {
      const u = T[1].map((q, k) => q - T[0][k]), w = T[2].map((q, k) => q - T[0][k]);
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(...n) || 1;
      for (const q of T) P.push(...q, n[0] / l, n[1] / l, n[2] / l);
    }
  }
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
    // (shaded round, not faceted: each corner's own way out, leaned a little to the face's)
    for (const p of [A, B, C]) { const r = Math.hypot(...p) || 1, m = [p[0] / r * 0.7 + n[0] / l * 0.3, p[1] / r * 0.7 + n[1] / l * 0.3, p[2] / r * 0.7 + n[2] / l * 0.3], k = Math.hypot(...m) || 1; P.push(...p, m[0] / k, m[1] / k, m[2] / k); }
  }
  return new Float32Array(P);
}

// ─── a little matrix arithmetic (column-major) ───
function ortho(s: number, n: number, f: number) { return [1 / s, 0, 0, 0, 0, 1 / s, 0, 0, 0, 0, -2 / (f - n), 0, 0, 0, -(f + n) / (f - n), 1]; }
function perspective(fov: number, asp: number, n: number, f: number) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]; }
function lookAt(e: number[], c: number[], up = [0, 1, 0]) {
  const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(up, z)), y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
}
function mul(a: number[], b: number[]) { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; }
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** what's on the GPU for one chunk */
interface Held { key: string; x: number; z: number; roots: WebGLBuffer; nRoots: number; strokes: WebGLBuffer | null; nStrokes: number; ground: WebGLBuffer; culms: WebGLBuffer; nCulms: number; sprays: WebGLBuffer; nSprays: number; stones: WebGLBuffer; nStones: number; steps: WebGLBuffer; nSteps: number }

export class Renderer {
  private gl: WebGL2RenderingContext;
  private progs: Record<string, WebGLProgram> = {};
  private fbo: WebGLFramebuffer | null = null; private texC: WebGLTexture | null = null; private texA: WebGLTexture | null = null; private texZ: WebGLTexture | null = null; private size = [0, 0];
  private vbo: Record<string, { buf: WebGLBuffer; count: number }> = {};
  private idx!: { buf: WebGLBuffer; count: number };
  private chunks = new Map<string, Held>();
  private ridge!: { buf: WebGLBuffer; count: number };
  private vao: WebGLVertexArrayObject;
  readonly clean: boolean; readonly marks: number;
  /** `?strokes=all`: every stroke the land has, at full weight, none left out (to see what's laid) */
  allStrokes = false;
  /** `?culms=0`: the land alone, no culms or sprays (the gates' hard test: does the mountain and its path read?) */
  bare = false;
  /** how far the drawing reaches (see the head of this file) */
  /** the focus's distance, this frame */
  focus = 15;
  reach: Reach = { colour: 29, wash: 29, ink: 160, soft: 3, frame: 0.14, depth: 0.98 };
  /** culms in whole up to / gone by: through the ink's band */
  private get pick() { return [this.reach.ink * 0.35, this.reach.ink * 0.85]; }
  private shadowTex: WebGLTexture | null = null; private shadowFbo: WebGLFramebuffer | null = null; private lightVP: number[] = new Array(16).fill(0); readonly shadows: boolean;
  sunDir = norm([-0.6, 0.44, 0.55]);

  constructor(private canvas: HTMLCanvasElement, ridges: { x: number; z: number; y: number }[][], opts: { clean?: boolean; marks?: boolean; shadows?: boolean } = {}) {
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is needed');
    this.gl = gl; this.clean = !!opts.clean; this.marks = opts.marks === false ? 0 : 1;
    this.vao = gl.createVertexArray()!;
    const P = (n: string, vs: string, fs: string) => { this.progs[n] = this.program(vs, fs); };
    P('culm', CULM_VS, CULM_FS); P('spray', SPRAY_VS, SPRAY_FS); P('ground', GROUND_VS, GROUND_FS);
    P('solid', SOLID_VS, SOLID_FS); P('ridge', RIDGE_VS, RIDGE_FS); P('post', POST_VS, POST_FS);
    P('stroke', STROKE_VS, STROKE_FS); P('culmDepth', CULM_VS, DEPTH_FS); P('solidDepth', SOLID_VS, DEPTH_FS);
    // (the sun's view of the culms near you: their shadows)
    this.shadows = opts.shadows !== false;
    {
      const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, 2048, 2048, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE], [gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      this.shadowTex = t; this.shadowFbo = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t, 0); gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    for (const [k, m] of [['culmNear', culmMesh(8, 20)], ['culmFar', culmMesh(5, 10)], ['quad', QUAD]] as const) this.vbo[k] = { buf: this.buffer(m), count: m.length / 2 };
    const box = boxMesh(); this.vbo.box = { buf: this.buffer(box), count: box.length / 6 };
    const lump = lumpMesh(1.7); this.vbo.lump = { buf: this.buffer(lump), count: lump.length / 6 };
    const slab = slabMesh(); this.vbo.slab = { buf: this.buffer(slab), count: slab.length / 6 };
    this.vbo.screen = { buf: this.buffer(new Float32Array([-1, -1, 3, -1, -1, 3])), count: 3 };
    // (one index buffer serves every chunk's ground: the same grid)
    {
      const idx = new Uint16Array((CN - 1) * (CN - 1) * 6); let m = 0;
      for (let j = 0; j < CN - 1; j++) for (let i = 0; i < CN - 1; i++) { const a = i + j * CN; idx.set([a, a + CN, a + 1, a + 1, a + CN, a + CN + 1], m); m += 6; }
      const b = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      this.idx = { buf: b, count: idx.length };
    }
    // (the far ranges, round about: each a band from its crest down out of sight)
    {
      const d: number[] = [];
      ridges.forEach((line, layer) => {
        for (let i = 0; i + 1 < line.length; i++) {
          const a = line[i], b = line[i + 1], lo = -500;
          const A = [a.x, a.y, a.z, 0, layer], Bq = [b.x, b.y, b.z, 0, layer], C = [b.x, lo, b.z, b.y - lo, layer], D = [a.x, lo, a.z, a.y - lo, layer];
          d.push(...A, ...Bq, ...C, ...A, ...C, ...D);
        }
      });
      this.ridge = { buf: this.buffer(new Float32Array(d)), count: d.length / 5 };
    }
  }
  private buffer(data: Float32Array) { const gl = this.gl, b = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; }

  get held() { return this.chunks.size; }
  has(key: string) { return this.chunks.has(key); }
  /** hand a chunk to the GPU */
  add(key: string, c: Chunk, marks?: Float32Array) {
    const G = c.ground, v = new Float32Array(CN * CN * 8);
    for (let j = 0; j < CN; j++) for (let i = 0; i < CN; i++) {
      const k = i + j * CN, hx = G[Math.min(CN - 1, i + 1) + j * CN] - G[Math.max(0, i - 1) + j * CN], hz = G[i + Math.min(CN - 1, j + 1) * CN] - G[i + Math.max(0, j - 1) * CN];
      const n = norm([-hx * ((i === 0 || i === CN - 1) ? 2 : 1), 2 * CELL, -hz * ((j === 0 || j === CN - 1) ? 2 : 1)]);
      v.set([c.x0 + i * CELL, G[k], c.z0 + j * CELL, n[0], n[1], n[2], c.near[k], c.rock[k]], k * 8);
    }
    const cu = new Float32Array(c.tall * 12);
    for (let k = 0; k < c.tall; k++) { const q = c.culms[k]; cu.set([q.x, q.y, q.z, q.r, q.h, q.lx, q.lz, q.node, q.age, q.phase, q.pick, 0], k * 12); }
    const sp = new Float32Array(c.sprays.length * 16);
    c.sprays.forEach((s, k) => { const q = c.culms[s.c]; sp.set([q.x, q.y, q.z, q.h, q.lx, q.lz, q.phase, q.pick, s.y, s.ox, s.oz, s.size, s.yaw, s.tilt, s.seed, 0], k * 16); });
    const st = new Float32Array(c.stones.length * 8);
    c.stones.forEach((s, k) => st.set([s.x, s.y, s.z, s.yaw, s.r, s.flat, s.moss, 0], k * 8));
    const rt = new Float32Array(c.roots.length * 8);
    c.roots.forEach((q, k) => rt.set([q.x, q.y, q.z, q.yaw, q.r, q.len, q.moss, q.moss * 0.37], k * 8));
    const sx = new Float32Array(c.steps.length * 8);
    c.steps.forEach((s, k) => sx.set([s.x, s.y, s.z, Math.atan2(s.dx, s.dz), s.depth, s.width, s.drop, s.seed], k * 8));
    this.chunks.set(key, { key, x: c.x0 + CHUNK / 2, z: c.z0 + CHUNK / 2, roots: this.buffer(rt), nRoots: c.roots.length, strokes: marks?.length ? this.buffer(marks) : null, nStrokes: marks ? marks.length / STROKE_STRIDE : 0, ground: this.buffer(v), culms: this.buffer(cu), nCulms: c.tall, sprays: this.buffer(sp), nSprays: c.sprays.length, stones: this.buffer(st), nStones: c.stones.length, steps: this.buffer(sx), nSteps: c.steps.length });
  }
  /** let a chunk go */
  drop(key: string) {
    const h = this.chunks.get(key); if (!h) return;
    for (const b of [h.ground, h.culms, h.sprays, h.stones, h.steps, h.strokes, h.roots]) if (b) this.gl.deleteBuffer(b);
    this.chunks.delete(key);
  }
  keys() { return [...this.chunks.keys()]; }

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

  private sunUV = [0.5, 0.9, 0];
  private uni(p: WebGLProgram, f: Frame, vp: number[], right: number[]) {
    const gl = this.gl, u = (n: string) => gl.getUniformLocation(p, n);
    gl.uniformMatrix4fv(u('uVP'), false, vp); gl.uniform3fv(u('uEye'), f.eye); gl.uniform1f(u('uTime'), f.t); gl.uniform3fv(u('uSun'), this.sunDir);
    gl.uniform4fv(u('uGust'), f.gust); gl.uniform3fv(u('uSunC'), [3.0, 2.45, 1.6]); gl.uniform3fv(u('uSky'), [0.62, 0.68, 0.72]); gl.uniform1f(u('uOpen'), 0);
    gl.uniform4fv(u('uReach'), [this.reach.colour, this.reach.wash, this.reach.ink, this.reach.soft]); gl.uniform2fv(u('uPick'), this.pick); gl.uniform1f(u('uMarks'), this.marks); gl.uniform3fv(u('uRight'), right);
    { const c0 = 0.3 + this.reach.frame * 1.3; gl.uniform4fv(u('uFrame'), [c0, this.focus, 0, this.reach.depth]); }
    gl.uniformMatrix4fv(u('uLightVP'), false, this.lightVP); gl.uniform1i(u('uShadow'), 3); gl.uniform1f(u('uShadowOn'), this.shadows ? 1 : 0); gl.uniform1i(u('uDepth'), 0);
  }
  private attr(loc: number, buf: WebGLBuffer, size: number, stride: number, off: number, div = 0) {
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, off * 4); gl.vertexAttribDivisor(loc, div);
  }
  private clearAttrs() { const gl = this.gl; for (let i = 0; i < 6; i++) { gl.disableVertexAttribArray(i); gl.vertexAttribDivisor(i, 0); } }

  draw(f: Frame, w: number, h: number) {
    this.focus = f.focus ?? 15;
    const gl = this.gl;
    this.targets(w, h);
    const fw = norm([f.look[0] - f.eye[0], f.look[1] - f.eye[1], f.look[2] - f.eye[2]]), side = norm(cross(fw, [0, 1, 0])), r = f.roll ?? 0;
    const upv = [Math.sin(r) * side[0], Math.cos(r) + Math.sin(r) * side[1], Math.sin(r) * side[2]];
    const near = 0.1, far = 3000, proj = perspective(f.fov, w / h, near, far), view = lookAt(f.eye, f.look, upv), vp = mul(proj, view);
    const right = [view[0], view[4], view[8]], fwd = norm([f.look[0] - f.eye[0], 0, f.look[2] - f.eye[2]]);
    gl.bindVertexArray(this.vao);
    const use = (n: string) => { const p = this.progs[n]; gl.useProgram(p); this.uni(p, f, vp, right); this.clearAttrs(); return p; };
    const all = [...this.chunks.values()].map((c) => { const dx = c.x - f.eye[0], dz = c.z - f.eye[2], d = Math.hypot(dx, dz); return { c, d, ok: d < CHUNK * 1.2 || (dx * fwd[0] + dz * fwd[2]) / d > -0.4 }; }).filter((q) => q.ok);
    const inRange = (r: number) => all.filter((q) => q.d < r + CHUNK * 0.71);
    // ─── the shadows: the culms and steps near you, from the sun ───
    if (this.shadows) {
      const S = 46, cx = f.eye[0] + fwd[0] * S * 0.6, cz = f.eye[2] + fwd[2] * S * 0.6, cy = f.eye[1], s = this.sunDir;
      const lv = lookAt([cx + s[0] * 200, cy + s[1] * 200, cz + s[2] * 200], [cx, cy, cz], [0, 0, 1]);
      this.lightVP = mul(ortho(S, 1, 420), lv);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo); gl.viewport(0, 0, 2048, 2048);
      gl.clearBufferfv(gl.DEPTH, 0, [1]); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND);
      const near2 = all.filter((q) => Math.hypot(q.c.x - cx, q.c.z - cz) < S * 1.42 + CHUNK);
      let p = use('culmDepth'); gl.uniform1i(gl.getUniformLocation(p, 'uDepth'), 1);
      this.attr(0, this.vbo.culmFar.buf, 2, 2, 0);
      for (const { c } of near2) if (c.nCulms) { for (let a = 0; a < 3; a++) this.attr(1 + a, c.culms, 4, 12, a * 4, 1); gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vbo.culmFar.count, c.nCulms); }
      p = use('solidDepth'); gl.uniform1i(gl.getUniformLocation(p, 'uDepth'), 1); gl.uniform1i(gl.getUniformLocation(p, 'uKind'), 1);
      this.attr(0, this.vbo.slab.buf, 3, 6, 0); this.attr(1, this.vbo.slab.buf, 3, 6, 3);
      for (const { c } of near2) if (c.nSteps) { this.attr(2, c.steps, 4, 8, 0, 1); this.attr(3, c.steps, 4, 8, 4, 1); gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vbo.slab.count, c.nSteps); }
    }
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.viewport(0, 0, w, h);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 1]); gl.clearBufferfv(gl.DEPTH, 0, [1]);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    // ─── the far ranges, under everything ───
    {
      use('ridge');
      this.attr(0, this.ridge.buf, 3, 5, 0); this.attr(1, this.ridge.buf, 2, 5, 3);
      gl.drawArrays(gl.TRIANGLES, 0, this.ridge.count);
    }
    // ─── the ground ───
    {
      use('ground');
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idx.buf);
      for (const { c } of all) {
        this.attr(0, c.ground, 3, 8, 0); this.attr(1, c.ground, 3, 8, 3); this.attr(2, c.ground, 2, 8, 6);
        gl.drawElements(gl.TRIANGLES, this.idx.count, gl.UNSIGNED_SHORT, 0);
      }
    }
    // ─── steps and stones ───
    {
      const p = use('solid');
      gl.uniform1i(gl.getUniformLocation(p, 'uKind'), 1);
      this.attr(0, this.vbo.slab.buf, 3, 6, 0); this.attr(1, this.vbo.slab.buf, 3, 6, 3);
      for (const { c } of inRange(this.reach.ink)) if (c.nSteps) { this.attr(2, c.steps, 4, 8, 0, 1); this.attr(3, c.steps, 4, 8, 4, 1); gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vbo.slab.count, c.nSteps); }
      gl.uniform1i(gl.getUniformLocation(p, 'uKind'), 2);
      this.attr(0, this.vbo.lump.buf, 3, 6, 0); this.attr(1, this.vbo.lump.buf, 3, 6, 3);
      for (const { c } of inRange(this.reach.ink)) if (c.nStones) { this.attr(2, c.stones, 4, 8, 0, 1); this.attr(3, c.stones, 4, 8, 4, 1); gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vbo.lump.count, c.nStones); }
      gl.uniform1i(gl.getUniformLocation(p, 'uKind'), 3);
      for (const { c } of inRange(60)) if (c.nRoots) { this.attr(2, c.roots, 4, 8, 0, 1); this.attr(3, c.roots, 4, 8, 4, 1); gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vbo.lump.count, c.nRoots); }
    }
    // ─── the land's strokes, on it and on its steps, stones and roots (not over what stands in front of them) ───
    if (this.marks) {
      const p = use('stroke');
      gl.uniform2fv(gl.getUniformLocation(p, 'uRes'), [w, h]); gl.uniform1f(gl.getUniformLocation(p, 'uAll'), this.allStrokes ? 1 : 0);
      gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.depthMask(false); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -4);
      for (const { c } of inRange(this.reach.ink)) if (c.nStrokes && c.strokes) {
        const S = STROKE_STRIDE;
        this.attr(0, c.strokes, 3, S, 0); this.attr(1, c.strokes, 3, S, 3); this.attr(2, c.strokes, 2, S, 6); this.attr(3, c.strokes, 2, S, 8); this.attr(4, c.strokes, 3, S, 10); this.attr(5, c.strokes, 3, S, 13);
        gl.drawArrays(gl.TRIANGLES, 0, c.nStrokes);
      }
      gl.disable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.depthMask(true); gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    // ─── the culms: finer near, coarser further ───
    if (!this.bare) {
      use('culm');
      for (const { c, d } of inRange(this.pick[1])) {
        if (!c.nCulms) continue;
        const m = d < 30 ? this.vbo.culmNear : this.vbo.culmFar;
        this.attr(0, m.buf, 2, 2, 0);
        for (let a = 0; a < 3; a++) this.attr(1 + a, c.culms, 4, 12, a * 4, 1);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, c.nCulms);
      }
    }
    // ─── the sprays ───
    if (!this.bare) {
      use('spray');
      this.attr(0, this.vbo.quad.buf, 2, 2, 0);
      for (const { c } of inRange(this.pick[1] - 8)) {
        if (!c.nSprays) continue;
        for (let a = 0; a < 4; a++) this.attr(1 + a, c.sprays, 4, 16, a * 4, 1);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, c.nSprays);
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
    gl.uniform4fv(u('uReach'), [this.reach.colour, this.reach.wash, this.reach.ink, this.reach.soft]);
    this.attr(0, this.vbo.screen.buf, 2, 2, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

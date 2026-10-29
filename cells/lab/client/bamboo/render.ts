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
 * **The layers** (`Renderer.dials`, layers.ts; set by `?look=` and each dial by its name, or the page's palette): laid
 * from the paper up, after Labyrinth, each its own. Every thing asks one measure, how far **out** it is (`outAt`: from
 * the focus across the frame, 1 at every edge, and in depth; or in the world, 1 at `distance` metres; whichever is
 * further), once for the whole of it, give or take its own pick; and each layer has its own reach in that measure.
 * **Colour**, by kind (culms, leaves, land), gives way to the paper; the **light** (shade, cast shadows, hollows, each
 * its own strength, factored out of the sun and sky so each can be laid again) reaches further, onto the paper itself,
 * there in sepia; the **ink** (things' own marks, the land's strokes, the outlines) further again, ending by thinning
 * (fewer things inked, by their picks) or fading (all paler); and **under** says how much of the drawing lies beneath
 * the colour. A culm, a spray, a stone is left out whole only where none of its layers reach it; the ground never is.
 *
 * `?clean`: no shafts or paper grain. `?marks=0`: the picture without its ink.
 */
import { type Chunk, CHUNK, CN, CELL, HALF, BANK } from './world';
import { STROKE_STRIDE } from './strokes';
import { type Dials, HOUSE } from './layers';

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

/** the paper's own colour */
const PAPER = [0.937, 0.902, 0.824];

const NOISE = `
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
float fbm2(vec2 p) { return vn(p) * .55 + vn(p * 2.03 + 7.1) * .3 + vn(p * 4.1 - 3.7) * .15; }
`;
const COMMON = `#version 300 es
precision highp float; precision highp int; precision highp sampler2DShadow;
uniform float uClay;
uniform mat4 uVP; uniform vec3 uEye; uniform float uTime; uniform vec3 uSun; uniform vec4 uGust;
// (the layers (layers.ts): each one's reach (the page's pull taken in) and how soft its edge; the measure (the focus's
// distance, how much sooner things far beyond it go, how far out in the world a reach of one is); the colour by kind,
// the ink by kind and how it ends, how much of it lies under the picture)
uniform vec4 uRch; uniform vec4 uFoc; uniform vec4 uColK; uniform vec4 uInkK; uniform float uUnder;
// (the ink's hand: how open its contours, how much it swells, how much grain breaks it)
uniform vec4 uHand;
// (how big a pixel is, in metres, a metre from the eye: so a thing can draw its own lines a set number of pixels wide)
uniform float uPxW;
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
// (how far out a point is, for every layer alike: from the focus (where you're going and looking) across the frame, 1
// at every edge of it (measured near-square, so top and bottom as much as the sides), and in depth (further for being
// far beyond the focus, a little for being much nearer); or in the world, 1 at \`distance\` metres; whichever is further.
// A thing asks it at a point of its own, so it's drawn one way whole, never cut by a line on the screen)
float outAt(vec3 p) {
  float d = distance(p, uEye), world = d / max(uFoc.z, 1.);
  vec4 cp = uVP * vec4(p, 1.);
  if (cp.w < .05) return world;
  vec2 n = abs(cp.xy / cp.w);
  float m = pow(pow(n.x, 3.) + pow(n.y, 3.), 1. / 3.), dl = log2(max(d, .3) / max(uFoc.x, 1.));
  return max(world, m + uFoc.y * .2 * (dl > 0. ? dl : -dl * .25));
}
// (whether a layer's here, at so far out, given its reach: whole inside it, gone past it, over a soft edge)
float hasS(float o, float r, float soft) { return 1. - smoothstep(r * (1. - soft), r * (1. + soft), o); }
float has(float o, float r) { return hasS(o, r, uRch.w); }
// (how much ink a thing of pick \`q\` has here, 0–1, never switched: as the ink thins, each thing gives out over its own
// short stretch of the reach (one of low pick last), so fewer are inked; as it fades, all of them alike)
float inkAt(float o, float q) { float r = has(o, uRch.z); return mix(clamp((r - q * .75) / .25, 0., 1.), r, uInkK.w); }
// (a mark is laid by its amount as a brush lays it: its length first, from where it starts (u = 0) out to its end, its
// tip lifting; then its weight; a mark never comes or goes at once. Fading, it goes paler as well)
float laidLen(float a, float u) { float L = clamp(a * 1.7, 0., 1.12); return a < .001 ? 0. : 1. - smoothstep(L - .1, L, u); }
float laidW(float a) { return mix(.3, 1., clamp((a - .3) / .7, 0., 1.)); }
float fadeOf(float a) { return mix(1., a, uInkK.w); }
float laid(float a, float u) { return laidLen(a, u) * laidW(a) * fadeOf(a); }
`;
// (the light: the sun through the canopy's gaps and past the culms' shadows, shared by every surface, so a patch of
// sun lies across the path, the litter and a culm alike)
const LIGHT = `
uniform vec3 uSunC; uniform vec3 uSky; uniform float uOpen; uniform vec4 uLitK; uniform vec3 uPaperC;
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
// (the display: a soft shoulder, then back to the eye's curve)
vec3 show(vec3 c) { c = 1. - exp(-c * 1.4); return sqrt(c); }
// (a surface as the layers lay it, the paper up: its colour as the sun shows it, going to the paper as far as the
// colour's reach (and as strong as its kind's dial: \`colK\`); over it, the light, by kind, each its own strength (the
// sun's shade on it, by its turn from the sun; what's cast across it, the culms' shadows and the canopy's dapple; the
// hollows, the sky shut out), as far as the light's reach, past the colour onto the paper itself, there in sepia. The
// light's factored out of what the sun and sky give, so each part can be laid again at its own strength: their product
// is the light as it is. \`glow\`: light it gives back of its own (a leaf with the sun behind it). \`land\`: the land's (it
// keeps \`landlight\` of its shade and hollows, and its colour gives out over a broader, broken edge))
vec3 layered(vec3 alb, vec3 N, vec3 p, float wrap, float ao, vec3 glow, float colK, float land, float o, out float colR, out float litR) {
  float sunV = dapple(p) * culmShade(p), ndl = max(0., (dot(N, uSun) + wrap) / (1. + wrap));
  vec3 skyT = uSky * (.5 + .5 * N.y), bnc = vec3(.2, .15, .08) * (1. - N.y) * .3;
  vec3 L0 = uSunC + skyT + bnc, Ls = uSunC * ndl + skyT + bnc, Lc = uSunC * ndl * sunV + skyT + bnc, Lh = uSunC * ndl * sunV + (skyT + bnc) * ao;
  litR = has(o, uRch.y);
  colR = clamp(colK, 0., 1.) * hasS(o, uRch.x, uRch.w * (land > .5 ? 2.2 : 1.));
  if (uClay > .5) { colR = 1.; litR = 1.; return show(lin(vec3(.8, .78, .74)) * Lh); }
  float ll = mix(1., uLitK.w, land);
  vec3 Lk = pow(Ls / L0, vec3(uLitK.x * ll * litR)) * pow(Lc / max(Ls, vec3(1e-4)), vec3(uLitK.y * litR)) * pow(Lh / max(Lc, vec3(1e-4)), vec3(uLitK.z * ll * litR));
  vec3 c = show(lin(alb) * L0 * Lk + glow * litR);
  // (a little air between, warm and pale; and the valley's mist, a cool blue-grey veil in the hollows below the eye)
  float d = distance(p, uEye);
  c = mix(c, vec3(.93, .9, .8), (1. - exp(-max(0., d - 3.) / 40.)) * .55);
  float below = uEye.y - p.y, veil = smoothstep(3., 30., below) * smoothstep(12., 70., d) * (.55 + .35 * vn(p.xz * .02 + uTime * .01));
  c = mix(c, vec3(.78, .82, .86), clamp(veil, 0., .85));
  // (a little of the paper's warmth in it, as a wash takes the sheet's tone)
  c *= mix(vec3(1.), uPaperC / .94, .3);
  // (the light on the paper, where the colour's gone: its shade in sepia, not the sky's grey)
  float lm = clamp(dot(Lk, vec3(.3, .55, .15)), 0., 1.);
  vec3 onPaper = uPaperC * mix(vec3(1.), pow(vec3(lm), vec3(.82, 1., 1.3)), .55);
  return mix(onPaper, c, colR);
}
`;
// (what a fragment hands the page: its colour as the layers laid it, and how much of that is colour (a); its kind,
// whether an outline may run here, how much outline ink it carries, and its own marks, both as the ink's dials, its
// reach and the drawing under the picture have them)
const OUT = `
layout(location = 0) out vec4 oC; layout(location = 1) out vec4 oA;
// (a thing that draws its own contour (a culm, a spray) sets it here; the page's outline pass leaves it alone)
float gContour = 0.;
void emit(vec3 c, float colR, float inkA, float kind, float allow, float mark) {
  if (uClay > .5) { oC = vec4(c, 1.); oA = vec4(kind, allow, 0., 0.); return; }
  // (under the picture, as much of the drawing as \`under\` lays there; on the paper, all of it)
  float underF = 1. - colR * (1. - uUnder);
  oC = vec4(c, colR);
  // (as the colour goes, the marks come up to carry the thing)
  oA = vec4(kind, allow, uInkK.z * inkA * underF, max(clamp(mark * uInkK.x * inkA * underF * (1. + .6 * (1. - colR)) * (1. + .5 * uHand.y), 0., 1.), clamp(gContour * uInkK.z * inkA * underF, 0., 1.)));
}
`;

const CULM_VS = COMMON + `
layout(location = 0) in vec2 aUV;
layout(location = 1) in vec4 iA; layout(location = 2) in vec4 iB; layout(location = 3) in vec4 iC;
out vec3 vW; out vec3 vN; out float vY; out float vQ; out float vU; out vec3 vI; out float vR; flat out float vOut; flat out float vJit; flat out float vHero;
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
  // (and its last few metres drawn out to a whip, so its top is a fine point lost in the canopy, never a flat end)
  float rr = r * (1. - .62 * pow(aUV.y, 1.3)) * swell * (1. - .96 * smoothstep(.72, 1., aUV.y));
  vec3 c = culmAt(b, h, lean, phase, y);
  vec3 n = vec3(cos(a), 0., sin(a));
  vW = c + n * rr; vR = rr; vN = n; vY = y; vQ = q; vU = a * r; vI = vec3(iC.x, phase, h);
  // (how far out it is, each culm a little its own way)
  // (and each stand its own way, so the grove's limit is ragged by whole stands: some run on past the rest, some give
  // way early)
  vHero = r > .105 ? 1. : 0.;
  vJit = (fract(pick * 7.31) - .5) * .24 + (vn(b.xz * .045) - .5) * .7;
  // (how far out the culm is, whole: its least-out point along its length, so one seen from its foot looking up, or
  // only its top in the frame, is still drawn)
  float bb = 99.;
  for (int k = 0; k < 5; k++) bb = min(bb, outAt(culmAt(b, h, lean, phase, min(1.6, h) + (h - min(1.6, h)) * float(k) / 4.)));
  vOut = uDepth == 1 ? 0. : bb + vJit;
  gl_Position = (uDepth == 1 ? uLightVP : uVP) * vec4(vW, 1.);
}`;
const CULM_FS = COMMON + LIGHT + OUT + `
in vec3 vW; in vec3 vN; in float vY; in float vQ; in float vU; in vec3 vI; in float vR; flat in float vOut; flat in float vJit; flat in float vHero;
uniform float uMarks;
void main() {
  vec3 N = normalize(vN), V = normalize(uEye - vW);
  float age = vI.x, f = fract(vQ), dist = distance(vW, uEye);
  // (how far drawn: an internode at a time, each whole, asked where it stands (from the node below it), so the page
  // comes in on a culm wherever it crosses the frame; its top a little sooner, as a long stroke runs out; never fading
  // along an internode)
  float yNode = vY - f * fwidth(vY) / max(fwidth(vQ), 1e-4);
  float drawn = outAt(vW + vec3(0., yNode - vY, 0.)) + vJit + smoothstep(4., vI.z, yNode) * .12;
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
  float colR, litR;
  vec3 c = layered(alb, N, vW, .25, 1., vec3(0.), uColK.x, 0., drawn, colR, litR);
  // (the marks: a tick at each node, curving with the ring, darkest toward the culm's edges as the eye sees it; on the
  // side away from the sun, dry-brush strokes down it; ink pooled at its foot)
  float edge = 1. - abs(dot(N, V)), shade = smoothstep(.1, -.4, dot(N, uSun));
  // (far off, only some nodes are ticked, by their own picks: a far culm is a few marks, not a chain of rings)
  float chosen = clamp(((1. - smoothstep(10., 40., dist) * .75) * mix(.45, 1., colR) - h21(vec2(floor(vQ + .5), vI.y * 31.))) / .15, 0., 1.);
  float tick = ring * chosen * (.35 + .65 * smoothstep(.1, .6, edge)) * (1. - smoothstep(30., 70., dist) * .75);
  float dry = smoothstep(.62, .82, vn(vec2(vU * 40. + 3., vY * .35))) * shade * edge * (1. - far) * .6;
  float foot = (1. - smoothstep(.0, .14, vY)) * .5 * (1. - smoothstep(15., 40., dist));
  // (the dry brush is the picture's shading: it goes with the colour; the ticks and the foot carry on in the drawing)
  float mark = max(max(tick, dry * colR), foot) * uMarks;
  // (the outline breaks just under each node, as a brush lifts there)
  // (in colour the outline lifts under each node, as a brush does; drawn in ink alone, a culm's edges run on whole,
  // two long lines, and a few nodes ticked: never a chain of dashes)
  float allow = 1. - smoothstep(.72, .8, f) * (1. - smoothstep(.97, .99, f)) * chosen * colR;
  // (its two edges aren't alike, as a brush draws a culm: the side away from the sun the one firm contour, the lit side a
  // fainter counter-line; each lifting here and there along its length (the lit side often), so the eye completes it)
  float lit = smoothstep(-.15, .15, dot(N.xz, normalize(uSun.xz + 1e-4)));
  float lift = smoothstep(.48, .7, vn(vec2(vY * .2 + vI.y * 7., 1.7 + lit * 3.6)));
  allow *= mix(1., mix(.36, .08, uHand.x), lit) * (1. - lift * mix(.45, .95, lit) * (.6 + .6 * uHand.x) * (1. - vHero * (1. - lit) * .8));
  // (its ink: as the ink thins, left out a culm at a time by its own pick (a near one held longest), so the drawing
  // thins by omission, toward the paper, rather than standing as a fence of outlines)
  float q = h21(vec2(vI.y * 3.7, 5.3)) * mix(.45, 1., smoothstep(6., 28., dist));
  // (its ink laid up it from the foot, as one long stroke, by the culm's amount; lighter where its internodes are
  // further out)
  float aw = inkAt(vOut, q), inkA = laidLen(aw, vY / max(vI.z, .1)) * laidW(min(aw, inkAt(drawn, q))) * fadeOf(aw);
  // (along it toward the frame's edge, its ink lifts off, as a long stroke runs out: so a culm whose foot is held still
  // leaves the top of the page to the paper)
  inkA *= smoothstep(0., .6, has(outAt(vW) + vJit, uRch.z));
  // (a few culms carry the drawing: past arm's length, half are quieter, secondary; and far ones lighter still, a
  // register of tone rather than of lines)
  float prom = h21(vec2(vI.y * 9.1, 2.7));
  // (a giant by the way is the drawing's anchor: never secondary, its firm side heavier)
  prom *= 1. - vHero;
  inkA *= 1. + vHero * .3;
  inkA *= mix(1., .42, smoothstep(.4, .6, prom) * smoothstep(10., 16., dist)) * mix(1., .5, smoothstep(22., 50., dist)) * (1. + .35 * (1. - smoothstep(6., 16., dist)));
  // (a culm goes from the page whole, where none of its layers reach it (asked at its least-out point); along it, an
  // internode at a time, its colour gives way, then its light: never a cylinder cut off mid-internode)
  if (uClay < .5 && uColK.x * hasS(vOut, uRch.x, uRch.w) < .02 && has(vOut, uRch.y) * dot(uLitK.xyz, vec3(1.)) < .02 && aw < .002) discard;
  // (its contour, drawn by itself from its own shape, so many culms side by side never run together into a mass: a line
  // a set number of pixels in from its silhouette, its shaded side the firm one (and with \`swell\`, heavier, near), its
  // lit side the hairline, lifting along its length as \`allow\` has it; too thin for two lines, one fine line)
  float ndv = abs(dot(N, V)), rpx = vR / max(dist * uPxW, 1e-5), dpx = rpx * (1. - sqrt(max(0., 1. - ndv * ndv)));
  float wpx = (.8 + uHand.y * 1.6 * (1. - lit) * (1. - smoothstep(6., 14., dist))) * (.75 + .5 * vn(vec2(vY * .35, vI.y * 9.)));
  gContour = (1. - smoothstep(wpx * .55, wpx + .6, dpx)) * allow * mix(.4, 1., smoothstep(1., 3., rpx)) * mix(1., .3, smoothstep(10., 40., dist));
  emit(c, colR, inkA, .4, 0., mark);
}`;
const DEPTH_FS = `#version 300 es
precision highp float;
void main() {}`;

const SPRAY_VS = COMMON + `
layout(location = 0) in vec2 aUV;
layout(location = 1) in vec4 iA; layout(location = 2) in vec4 iB; layout(location = 3) in vec4 iC; layout(location = 4) in vec4 iD;
out vec3 vW; out vec2 vUV; out float vSeed; out vec3 vN; out float vSize; flat out float vOut;
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
  vUV = aUV + .5; vSeed = iD.z; vSize = size; vN = normalize(cross(right, up));
  // (a spray's drawn as its culm is at eye height, a little further along for being high, and each its own way)
  // (and where it stands in the frame itself, so the canopy at the top of the frame goes to the page too)
  vOut = outAt(anchor) + (fract(pick * 7.31) - .5) * .14 + smoothstep(4., h, sy) * .1 + (iD.z - .5) * .1 + (vn(b.xz * .045) - .5) * .7;
  gl_Position = uVP * vec4(vW, 1.);
}`;
const SPRAY_FS = COMMON + LIGHT + OUT + `
in vec3 vW; in vec2 vUV; in float vSeed; in vec3 vN; in float vSize; flat in float vOut;
uniform float uMarks;
void main() {
  // (the blades: three to five from a twig near the top, drooping: 个 and 介)
  vec2 stem = vec2(.5 + (vSeed - .5) * .2, .82);
  int n = 3 + int(vSeed * 2.99);
  float inside = 0., rim = 1., best = 0., along = 0., ww = .1;
  for (int i = 0; i < 5; i++) {
    if (i >= n) break;
    float fi = float(i), s = fract(vSeed * 13.7 + fi * .618);
    float ang = -1.5708 + (fi - float(n - 1) * .5) * (.62 + s * .2) + (s - .5) * .3;
    vec2 d = vec2(cos(ang), sin(ang)); vec2 pp = vUV - stem;
    float len = .55 + s * .25, a = dot(pp, d) / len, bb = dot(pp, vec2(-d.y, d.x)) / len;
    float w = .12 * pow(max(0., sin(3.1416 * pow(clamp(a, 0., 1.), .75))), .8) * (1. - .25 * a);
    float e = w - abs(bb + a * a * .06 * (s - .5));
    if (a > 0. && a < 1. && e > 0.) { inside = 1.; rim = min(rim, e / max(w, 1e-3)); best = max(best, s); along = a; ww = w * len; }
  }
  if (inside < .5) discard;
  vec3 V = normalize(uEye - vW), N = faceforward(vN, -V, vN);
  // (lit: dark ink-green in shade, yellow-green in the sun, glowing gold-green where the sun's behind it)
  float sun = dapple(vW), back = pow(max(0., dot(-V, uSun)), 2.5) * sun;
  vec3 alb = mix(vec3(.18, .26, .12), vec3(.5, .6, .24), .35 + .65 * best);
  float colR, litR;
  vec3 c = layered(alb, N, vW, .6, .9, lin(vec3(.9, .92, .42)) * back * 1.2 * uSunC, uColK.y, 0., vOut, colR, litR);
  // (the marks: each blade's edge near; where the colour's given out, the blade filled in ink, as a brush lays it)
  // (its own edge, drawn by itself a set number of pixels in from the blade's rim, so a far spray is a few fine blades,
  // not a blot; a little ink in the blade where its colour's gone)
  float dd = distance(vW, uEye), near = 1. - smoothstep(8., 26., dd), halfpx = ww * vSize / max(dd * uPxW, 1e-5);
  float rimL = (1. - smoothstep(.55, 1.3, rim * halfpx)) * mix(.35, 1., smoothstep(.6, 2.5, halfpx)) * mix(1., .35, smoothstep(10., 40., dd));
  float mark = max(rimL * .85, (1. - colR) * (.1 + .1 * best) * (1. - smoothstep(15., 40., dd) * .7)) * uMarks;
  // (left out whole, a spray at a time by its own pick, where no layer reaches it)
  // (its ink laid out each blade from the stem, then to its weight)
  float sa = inkAt(vOut, fract(vSeed * 17.3)), inkA = laid(sa, along);
  if (uClay < .5 && colR < .02 && litR * dot(uLitK.xyz, vec3(1.)) < .02 && sa < .002) discard;
  emit(c, colR, inkA, .6, 0., mark);
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
  // (how far out: broken, as a brush's edge is, by strokes laid across the fall of the slope, dragged dry, so where a
  // layer gives out it breaks into them in the world rather than following any line of the frame; further off, in
  // bigger patches, so across a far slope it's ragged, not ruled; each fallen leaf by its own pick, so the litter thins
  // to a few painted leaves and then their outlines on the paper; the bare ground between them first)
  vec2 down2 = N.xz / max(length(N.xz), .05), across2 = vec2(-down2.y, down2.x);
  float stroke = vn(vec2(dot(vW.xz, across2) * .35, dot(vW.xz, down2) * 3.2)) * .6 + vn(vec2(dot(vW.xz, across2) * 1.1, dot(vW.xz, down2) * 9.)) * .4;
  float o = outAt(vW) + ((fbm2(vW.xz * .5 + 3.) - .5) * .5 + (stroke - .5) * 1.4 + (fbm2(vW.xz * .09 + 7.) - .5) * 1.6 * smoothstep(10., 40., dist)) / 3.;
  o += leaf >= 0. ? (leaf - .5) * .27 : .08 + (vRock > .5 ? -.1 : 0.);
  float colR, litR;
  vec3 c = layered(alb, N, vW, .2, .9, vec3(0.), uColK.z, 1., o, colR, litR);
  // (the marks: each near fallen leaf's edge; the land's own (a trail's edges, a bank's rim, a face's fall, the lie of
  // the hillside) are strokes laid on it, strokes.ts)
  // (a fallen leaf's edge is the picture's detail: it goes with the colour, a few left, so in the drawing the land's own
  // structure (edges, rims, contours) carries it, not the litter)
  // (along a trail, near, the fallen leaves keep their marks in the ink, overlapping, broken: the path is where the eye
  // goes, so it's drawn as a material, not left as an outlined patch)
  float trailNear = (1. - smoothstep(${(HALF * 0.6).toFixed(2)}, ${(HALF * 1.9).toFixed(2)}, vD)) * (1. - smoothstep(8., 22., dist));
  float mark = leafMark * .55 * uMarks * mix(.25 + .75 * colR, 1.1, trailNear * (1. - colR));
  // (the land's never left out: past its layers it's the paper, which it gives its own place in the light to)
  // (its ink by the smooth measure, not the broken one its colour gives out by: an outline along it thins, never dots)
  // (open: the land's own silhouettes left to the paper in long stretches, as the eye completes a hill)
  float gOpen = mix(1., .3 + .7 * smoothstep(.42, .62, vn(vW.xz * .12 + 4.)), uHand.x);
  emit(c, colR, laidW(has(outAt(vW), uRch.z)) * has(outAt(vW), uRch.z), .2, gOpen, mark);
}`;

const SOLID_VS = COMMON + `
layout(location = 0) in vec3 aP; layout(location = 1) in vec3 aN;
layout(location = 2) in vec4 iA; layout(location = 3) in vec4 iB;
out vec3 vW; out vec3 vN; out vec3 vL; out float vMoss; out float vSeed; flat out float vOut;
uniform int uKind; uniform mat4 uLightVP; uniform int uDepth;
void main() {
  vec3 p = aP, n = aN;
  float yaw = iA.w;
  if (uKind == 1) {
    // (a step: the unit box set to its depth, width and drop, its front edge at the origin)
    p = vec3(p.x * iB.y, p.y * iB.z - iB.z, (p.z + .5) * iB.x);
    // (laid by hand and settled since: each a little tilted across and along, one end sunk)
    float roll = (fract(iB.w * 13.7) - .5) * .14, pitch = (fract(iB.w * 7.9) - .5) * .08;
    p.y += p.x * roll + (p.z - iB.x * .5) * pitch;
    n = normalize(vec3(n.x - roll * n.y, n.y, n.z - pitch * n.y));
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
  vOut = uDepth == 1 ? 0. : outAt(iA.xyz + vec3(0., .2, 0.)) + (fract(iA.x * .37 + iA.z * .71) - .5) * .14;
  gl_Position = (uDepth == 1 ? uLightVP : uVP) * vec4(vW, 1.);
}`;
const SOLID_FS = COMMON + LIGHT + OUT + `
in vec3 vW; in vec3 vN; in vec3 vL; in float vMoss; in float vSeed; flat in float vOut;
uniform int uKind; uniform float uMarks;
void main() {
  vec3 N = normalize(vN);
  float n1 = fbm2(vW.xz * 1.7 + vW.y * 1.3), n2 = vn(vW.xy * 5. + vW.z * 3.);
  vec3 stone = mix(vec3(.76, .72, .63), vec3(.62, .6, .54), n1) * (.88 + .24 * n2);
  float moss = smoothstep(.2, .8, N.y) * smoothstep(.45, .7, n1 + vMoss * .3);
  vec3 alb = mix(stone, vec3(.4, .5, .22), moss * (uKind == 1 ? .2 : .7));
  float mark = 0.;
  // (a stone's shade drawn as a brush does: a few broken strokes across its turned-away side, not filled)
  float hs = abs(fract(dot(vW.xz, vec2(.8, .6)) * 5. + vW.y * 3.5) - .5);
  float hw = .07 + fwidth(dot(vW.xz, vec2(.8, .6)) * 5. + vW.y * 3.5) * .9;
  float hatch = (1. - smoothstep(hw * .7, hw * .7 + .05, hs)) * smoothstep(.3, -.3, dot(N, uSun)) * step(.45, vn(vW.xz * 2.3 + vW.y)) * .42;
  if (uKind == 2) {
    // (a boulder: its underside dark, the ground's shade gathering under it; now and then a fracture across it)
    float under = smoothstep(-.05, -.6, N.y) * .5;
    float cr = abs(dot(vL, normalize(vec3(.8, .15, .5) + vec3(vSeed - .5, 0., fract(vSeed * 7.1) - .5))) + (vn(vL.xy * 5. + vSeed * 7.) - .5) * .18 - (fract(vSeed * 3.3) - .5) * .5);
    float crack = (1. - smoothstep(.015, .04 + fwidth(cr), cr)) * step(.35, fract(vSeed * 5.7)) * .8;
    mark = max(max(hatch, under), crack);
  }
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
    // (its foot in the soil: the joint dark, earth risen against it)
    alb = mix(alb, vec3(.32, .26, .19), (1. - smoothstep(.0, .3, vL.y)) * (1. - onTop) * .7);
    // (the marks: the crack or two across a stone, now and then)
    mark = hatch * (1. - smoothstep(.2, .6, N.y)) * .8;
    mark = max(mark, step(.8, fract(vSeed * 3.7)) * (1. - smoothstep(.0, .015, abs(vL.x - (fract(vSeed * 11.) - .5) * .6 + (vn(vW.xz * 7.) - .5) * .08))) * onTop * .7);
  }
  // (a stone, a step, a root: the land's colour; left out whole, by its own pick, where no layer reaches it)
  // (its colour and light are the land's, asked where they are, as the ground's are, so a stone never stands as a hole
  // in the land's wash; its ink is its own, whole)
  float colR, litR;
  vec3 c = layered(alb, N, vW, .2, .85, vec3(0.), uColK.z, 1., outAt(vW) + (fract(vSeed * 3.1) - .5) * .06, colR, litR);
  // (its ink laid from its middle out to its sides, then to its weight; a step's by weight alone, as one of a flight, so
  // the flight's edge thins as one line, never a row of dashes, a stone each)
  float sa = inkAt(vOut, fract(vSeed * 5.13 + .3)), inkA = laid(sa, uKind == 1 ? 0. : clamp(abs(vL.x), 0., 1.));
  if (uClay < .5 && colR < .02 && litR * dot(uLitK.xyz, vec3(1.)) < .02 && sa < .002) discard;
  // (open: a stone's contour carried by where it meets the land (its underside, its contact, a step's front), its top
  // and its far side barely said, lifting here and there)
  float auth = mix(.18, 1., smoothstep(.35, -.35, N.y)) * (1. - .8 * smoothstep(.45, .7, vn(vW.xz * 1.3 + vW.y * 2.)));
  emit(c, colR, inkA, uKind == 1 ? .8 : .7, mix(1., auth, uHand.x), mark * uMarks);
}`;

const RIDGE_VS = COMMON + `
layout(location = 0) in vec3 aP; layout(location = 1) in vec2 aT;
out vec3 vW; out vec2 vT;
void main() { vW = aP + vec3(uEye.x, uEye.y * .85, uEye.z); vT = aT; gl_Position = uVP * vec4(vW, 1.); }`;
const RIDGE_FS = `#version 300 es
precision highp float;
in vec3 vW; in vec2 vT;
layout(location = 0) out vec4 oC; layout(location = 1) out vec4 oA;
uniform float uAway;
${NOISE}
void main() {
  // (a range as the ink lays it: darkest at its crest, washing out below into the mist)
  float below = vT.x, layer = vT.y;
  float a = exp(-below / (10. + layer * 6.)) * (.62 - layer * .1);
  a *= (.75 + .25 * vn(vW.zy * .05)) * uAway;
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
uniform vec3 uPaper; uniform vec3 uInk; uniform vec3 uSunUV; uniform float uClean; uniform float uMarks; uniform float uClay; uniform vec4 uHand;
${NOISE}
float lz(vec2 p) { float d = texture(uZ, p).r; return uNear * uFar / (uFar - d * (uFar - uNear)); }
void main() {
  vec4 C = texture(uC, vUV), A = texture(uA, vUV);
  // (\`?clay\`: the forms as they're lit, over a plain sky: no paper, no ink)
  if (uClay > .5) { o = vec4(C.a > .01 ? C.rgb : vec3(.86, .87, .88), 1.); return; }
  float z = lz(vUV);
  // ─── the outlines: where the depth jumps or one kind meets another, inked on the side that's in front, as far as
  // its reach and its allowance there let it ───
  float ink = 0., ink2 = 0.;
  if (uMarks > .5) {
    vec2 px = uPx / uRes;
    // (the outline found round each pixel, a ring at a time: the near ring for every line; with \`swell\`, a wider ring
    // that only the strong lines reach, so they're heavier and the weak ones stay hairlines)
    for (int ring = 0; ring < 2; ring++) {
      if (ring == 1 && uHand.y < .01) break;
      float rr = ring == 0 ? 1. : 2.3;
      for (int k = 0; k < 8; k++) {
        float ang = float(k) * .7854 + float(ring) * .39; vec2 o2 = vec2(cos(ang), sin(ang)) * px * rr * (k % 2 == 0 ? 1. : 1.41);
        vec2 q = vUV + o2; float zq = lz(q), zo = lz(vUV - o2); vec4 Aq = texture(uA, q);
        vec4 F = z < zq ? A : Aq;
        // (against where the surface here would run on to: 1/z is straight across a plane, so a slope seen edge-on isn't
        // a jump)
        float zp = 1. / max(2. / z - 1. / zo, 1e-5);
        float rel = min(abs(zq - z), abs(zq - zp)) / min(z, zq);
        float dj = smoothstep(.05, .14, rel);
        float kj = abs(Aq.x - A.x) > .05 && min(Aq.x, A.x) > .15 && !(min(Aq.x, A.x) < .22 && max(Aq.x, A.x) < .22) ? .8 : 0.;
        // (a culm or a spray draws its own lines: here, only the land and what's set in it)
        bool own = (A.x > .35 && A.x < .65) || (Aq.x > .35 && Aq.x < .65);
        if (F.x < .15 || own) continue;
        // (lighter with distance: a far culm is a fine grey line, not a dark one)
        float zf = min(z, zq);
        // (the edge found first, whole, then given its weight: so a light line is a light line, not the finding's flicker)
        // (where two kinds meet with no step in depth (a stone sat in the ground), the line is either's, the stronger:
        // never flickering, pixel by pixel, between the one side's weight and the other's)
        float jw = max(clamp(dj * 2.5, 0., 1.) * F.y * F.z, kj * max(A.y * A.z, Aq.y * Aq.z));
        float e = jw * mix(1., .28, smoothstep(10., 40., zf)) * (1.15 - .35 * C.a);
        if (ring == 0) ink = max(ink, e); else ink2 = max(ink2, e * smoothstep(.45, .85, e));
      }
    }
    ink = max(ink, ink2 * uHand.y);
    // (and the things' own marks, as far as their ink reaches)
    ink = max(ink, A.w);
    // (grain: the line broken granular, as a crayon on a stone takes it)
    float gn = vn(vUV * uRes * .3) * .6 + vn(vUV * uRes * .1) * .4;
    ink *= mix(1., smoothstep(.32, .58, gn + ink * .25), uHand.z);
  }
  // ─── the page: each thing laid on it as it's drawn (its colour as far as that goes), its ink over that ───
  float grain = uClean > .5 ? 0. : (vn(vUV * uRes * .35) - .5) * .05 + (vn(vUV * uRes * .04) - .5) * .04;
  vec3 paper = uPaper * (1. + grain);
  // (a thing's laid already, its colour and its light on the paper as the layers have them; the sky and the far ranges
  // washed over the paper as far as they go)
  vec3 col = A.x > .15 ? C.rgb * (1. + grain) : mix(paper, C.rgb * mix(vec3(1.), paper / .94, .3), C.a);
  // (grain: tone off the colour laid as stippled clusters, the darker the denser, the paper between)
  {
    float tone = clamp(1. - dot(col, vec3(.3, .55, .15)) / dot(paper, vec3(.3, .55, .15)), 0., 1.);
    float st = step(vn(vUV * uRes * .3) * .7 + vn(vUV * uRes * .09) * .3, tone * 2.2 + .04);
    col = mix(col, mix(paper, mix(col, uInk, tone * .6), st), uHand.z * (1. - C.a));
  }
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
uniform vec2 uRes; uniform float uAll;
out float vAcross; out vec3 vW; flat out vec3 vF; flat out float vOut; flat out float vAmt; out float vAlong;
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
  // (how much of it's laid: its ink here, and thinned with distance (the detail sooner), each by its own pick, never
  // switched; laid out from its middle, its length first and then its weight (its width))
  float pick = aF.z, d0 = distance(aAnchor, uEye);
  vOut = max(outAt(aAnchor), outAt(aP)) + (pick - .5) * .14;
  bool detail0 = (fam > 1.5 && fam < 4.5) || (fam > 5.5 && fam < 6.5) || fam > 8.5;
  float keep = detail0 ? 1. - smoothstep(12., 60., d0) * .85 : 1. - smoothstep(60., 140., d0) * .7;
  vAmt = uAll > .5 ? 1. : min(inkAt(vOut, pick), clamp((keep - pick) / .2 + .5, 0., 1.));
  vAlong = abs(aT.y - .5) * 2.;
  // (swell: the firm strokes heavier, the slight ones hairlines)
  float wgt = fract(aF.x + .001);
  vec3 p = aP + side * aW.x * aW.y * aT.x * k * laidW(vAmt) * mix(1., .5 + 1.2 * wgt, uHand.y) + toEye * min(.08, distance(uEye, aP) * .004);
  vAcross = aT.x; vW = p; vF = aF;
  gl_Position = uVP * vec4(p, 1.);
}`;
const STROKE_FS = COMMON + `
in float vAcross; in vec3 vW; flat in vec3 vF; flat in float vOut; flat in float vAmt; in float vAlong;
layout(location = 0) out vec4 oC; layout(location = 1) out vec4 oA;
uniform float uMarks; uniform float uAll;
void main() {
  float fam = floor(vF.x + .001), weight = fract(vF.x + .001), persist = vF.y, pick = vF.z;
  // (left out whole: through the sparse marks fewer and fewer, by each stroke's own pick, none at the page)
  float lay = uAll > .5 ? 1. : laidLen(vAmt, vAlong) * fadeOf(vAmt);
  if (lay < .01) discard;
  float aa = max(fwidth(vAcross), 1e-4);
  float cov = 1. - smoothstep(1. - aa, 1. + aa * .5, abs(vAcross));
  float dry = smoothstep(.18, .42, vn(vW.xz * 6. + vW.y * 2. + fam * 3.1));
  // (lighter with distance, as the outlines are: a far trail's edge, seen along, is a fine grey line, not a rule; a rim
  // holds most)
  float far = smoothstep(8., 45., distance(vW, uEye)) * (fam > .5 && fam < 1.5 ? .4 : .7);
  float a = uAll > .5 ? cov : cov * mix(min(1., .4 + weight), clamp(pow(weight, 1.6) * 1.9, 0., 1.), uHand.x) * mix(.6, 1., dry) * mix(persist * uUnder, 1., 1. - uColK.z * hasS(vOut, uRch.x, uRch.w * 2.2)) * (1. - far) * uMarks * uInkK.y * lay;
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
  // (an icosphere, three subdivisions, pushed in and out, and broken: a boulder)
  const t = (1 + Math.sqrt(5)) / 2;
  let V: number[][] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...p); return p.map((q) => q / l); });
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < 3; s++) {
    const mid = new Map<string, number>(), m = (a: number, b: number) => { const k = a < b ? `${a},${b}` : `${b},${a}`; if (!mid.has(k)) { const p = V[a].map((q, i) => (q + V[b][i]) / 2), l = Math.hypot(...p); V.push(p.map((q) => q / l)); mid.set(k, V.length - 1); } return mid.get(k)!; };
    const G: number[][] = [];
    for (const [a, b, c] of F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); G.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    F = G;
  }
  const h = (p: number[]) => { const s = Math.sin(p[0] * 3.1 + seed) * Math.sin(p[1] * 2.7 + seed * 2) * Math.sin(p[2] * 3.3 + seed * 3); return 1 + 0.16 * s + 0.08 * Math.sin(p[0] * 7 + p[2] * 5 + seed); };
  // (weathered: a finer roughness over the swell)
  const rough = (p: number[]) => 0.035 * Math.sin(p[0] * 13 + seed * 5) * Math.sin(p[1] * 11 - seed) * Math.sin(p[2] * 12 + seed * 2);
  V = V.map((p) => { const k = h(p) + rough(p); return [p[0] * k, Math.max(-0.3, p[1]) * k, p[2] * k]; });
  // (and broken: a few planes cleave it, so it has flat fractured faces and edges, not only swells)
  for (let c = 0; c < 3; c++) {
    const a = seed * 2.3 + c * 2.1, e = 0.5 - 0.35 * Math.sin(seed * 1.7 + c * 4.1), nx = Math.cos(a) * Math.cos(e), ny = Math.sin(e) * 0.8, nz = Math.sin(a) * Math.cos(e), nl = Math.hypot(nx, ny, nz);
    const d = 0.68 + 0.12 * Math.sin(seed * 3.3 + c);
    V = V.map((p) => { const t = (p[0] * nx + p[1] * ny + p[2] * nz) / nl - d; return t > 0 ? [p[0] - (nx / nl) * t, p[1] - (ny / nl) * t, p[2] - (nz / nl) * t] : p; });
  }
  // (shaded by its shape: each corner's normal the faces' round it, area-weighted, so swells are round and the cleaved
  // faces flat)
  const VN = V.map(() => [0, 0, 0]);
  const fn = F.map(([a, b, c]) => { const A = V[a], u = V[b].map((q, i) => q - A[i]), w = V[c].map((q, i) => q - A[i]); return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; });
  F.forEach((f, k) => { for (const v of f) for (let i = 0; i < 3; i++) VN[v][i] += fn[k][i]; });
  const P: number[] = [];
  for (const f of F) for (const v of f) { const n = VN[v], l = Math.hypot(...n) || 1; P.push(...V[v], n[0] / l, n[1] / l, n[2] / l); }
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
  /** `?clay`: every surface one clay, its light (sun, cast shadows, sky) kept; no paper, no ink: the forms alone */
  clay = false;
  /** the focus's distance, this frame */
  focus = 15;
  /** the layers' dials (see the head of this file, and layers.ts) */
  dials: Dials = { ...HOUSE };
  /** each layer's reach, the page's pull taken in */
  private get reaches() { const k = 1 - Math.min(1, Math.max(0, this.dials.toward)), d = this.dials; return [d.colourreach * k, d.lightreach * k, d.inkreach * k]; }
  /** how far out in the world anything's drawn at all (metres) */
  private get farthest() { return Math.min(320, Math.max(...this.reaches) * this.dials.distance * 1.15); }
  /** culms in whole up to / gone by (metres): past every layer's reach, so their leaving is never seen */
  private get pick() { return [this.farthest, this.farthest * 1.3]; }
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
    gl.uniform4fv(u('uGust'), f.gust); gl.uniform1f(u('uClay'), this.clay ? 1 : 0); gl.uniform3fv(u('uSunC'), [3.0, 2.45, 1.6]); gl.uniform3fv(u('uSky'), [0.62, 0.68, 0.72]); gl.uniform1f(u('uOpen'), 0);
    gl.uniform2fv(u('uPick'), this.pick); gl.uniform1f(u('uMarks'), this.marks); gl.uniform3fv(u('uRight'), right);
    const d = this.dials;
    gl.uniform4fv(u('uRch'), [...this.reaches, 0.12]); gl.uniform4fv(u('uFoc'), [this.focus, d.depth, d.distance, 0]);
    gl.uniform4fv(u('uColK'), [d.culms, d.leaves, d.terrain, 0]); gl.uniform4fv(u('uLitK'), [d.shade, d.cast, d.hollow, d.landlight]);
    gl.uniform4fv(u('uInkK'), [d.lines, d.strokes, d.edges, d.inkfade]); gl.uniform4fv(u('uHand'), [d.open, d.swell, d.grain, 0]); gl.uniform1f(u('uPxW'), this.pxW); gl.uniform1f(u('uUnder'), d.under); gl.uniform3fv(u('uPaperC'), PAPER);
    gl.uniform1f(u('uAway'), (1 - Math.min(1, d.toward)) * Math.min(1, d.terrain));
    gl.uniformMatrix4fv(u('uLightVP'), false, this.lightVP); gl.uniform1i(u('uShadow'), 3); gl.uniform1f(u('uShadowOn'), this.shadows ? 1 : 0); gl.uniform1i(u('uDepth'), 0);
  }
  private attr(loc: number, buf: WebGLBuffer, size: number, stride: number, off: number, div = 0) {
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, off * 4); gl.vertexAttribDivisor(loc, div);
  }
  private clearAttrs() { const gl = this.gl; for (let i = 0; i < 6; i++) { gl.disableVertexAttribArray(i); gl.vertexAttribDivisor(i, 0); } }

  private pxW = 0.001;
  draw(f: Frame, w: number, h: number) {
    this.focus = f.focus ?? 15;
    this.pxW = (2 * Math.tan(f.fov / 2)) / h;
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
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]); gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]); gl.clearBufferfv(gl.DEPTH, 0, [1]);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
    // ─── the far ranges, under everything ───
    if (!this.clay) {
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
      for (const { c } of inRange(this.farthest)) if (c.nSteps) { this.attr(2, c.steps, 4, 8, 0, 1); this.attr(3, c.steps, 4, 8, 4, 1); gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vbo.slab.count, c.nSteps); }
      gl.uniform1i(gl.getUniformLocation(p, 'uKind'), 2);
      this.attr(0, this.vbo.lump.buf, 3, 6, 0); this.attr(1, this.vbo.lump.buf, 3, 6, 3);
      for (const { c } of inRange(this.farthest)) if (c.nStones) { this.attr(2, c.stones, 4, 8, 0, 1); this.attr(3, c.stones, 4, 8, 4, 1); gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vbo.lump.count, c.nStones); }
      gl.uniform1i(gl.getUniformLocation(p, 'uKind'), 3);
      for (const { c } of inRange(60)) if (c.nRoots) { this.attr(2, c.roots, 4, 8, 0, 1); this.attr(3, c.roots, 4, 8, 4, 1); gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vbo.lump.count, c.nRoots); }
    }
    // ─── the land's strokes, on it and on its steps, stones and roots (not over what stands in front of them) ───
    if (this.marks && !this.clay) {
      const p = use('stroke');
      gl.uniform2fv(gl.getUniformLocation(p, 'uRes'), [w, h]); gl.uniform1f(gl.getUniformLocation(p, 'uAll'), this.allStrokes ? 1 : 0);
      gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.depthMask(false); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -4);
      for (const { c } of inRange(this.farthest)) if (c.nStrokes && c.strokes) {
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
    gl.uniform3fv(u('uPaper'), PAPER); gl.uniform4fv(u('uHand'), [this.dials.open, this.dials.swell, this.dials.grain, 0]); gl.uniform3fv(u('uInk'), [0.13, 0.12, 0.105]); gl.uniform3fv(u('uSunUV'), this.sunUV);
    gl.uniform1f(u('uClean'), this.clean ? 1 : 0); gl.uniform1f(u('uMarks'), this.marks); gl.uniform1f(u('uClay'), this.clay ? 1 : 0);
    this.attr(0, this.vbo.screen.buf, 2, 2, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

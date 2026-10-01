/**
 * The picture, WebGL2, three passes into and out of a scene buffer:
 *
 * 1. Behind everything, one fragment shader: a ray per pixel. Above the
 *    horizon only fog — lighter higher up, a brighter place where the sun is
 *    behind it, slow banks moving through it. Below, dry ground and a trodden
 *    path, fogged by distance and by the same banks.
 * 2. The cards — every tree, shrub and patch of grass — back to front, each
 *    at its true place in the wood (so walking and looking give real parallax),
 *    each a baked silhouette (bake.ts). The shader does the rest: wind that
 *    moves the thin high wood and not the trunk, fog by distance and much
 *    thicker near the ground, mist banks that veil one tree and not the next.
 * 3. A last pass for the film: a soft tone curve, the fog's lift in the
 *    blacks, a vignette, grain.
 */
import type { Card } from './bake';
import type { Atmos } from './sky';
import { SEG } from './tree';

/**
 * Depth, shared by everything drawn: horizontal distance (m) over this, so the stone structures
 * (written by the world pass), the cards, the deer and the live trees all hide one another
 * rightly. Nothing is drawn further than this.
 */
const DEPTH_RANGE = 100;

const NOISE = `
uniform uint uSeed;
uint pcg(uint v) { uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float h2(ivec2 p) { return float(pcg(uint(p.x) * 1973u ^ pcg(uint(p.y) + uSeed))) / 4294967295.; }
float vnoise(vec2 p) {
  ivec2 i = ivec2(floor(p)); vec2 f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(h2(i), h2(i + ivec2(1, 0)), u.x), mix(h2(i + ivec2(0, 1)), h2(i + ivec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0., a = .5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.07 + 13.7; a *= .5; } return s / .9375; }
uniform vec3 uFogLow, uFogHigh;
uniform float uT;
// the lie of the land (world.ts groundH): amplitude, scale, water level, small swells
uniform vec4 uRelief;
// the height of the ground under what is drawn (its foot)
uniform float uBase;
float groundH(vec2 p) {
  float k = uRelief.y;
  return uRelief.x * ((vnoise(p * k + 71.3) - .5) * 1.6 + (vnoise(p * k * 2.7 + 5.9) - .5) * .4) + uRelief.w * (vnoise(p / 22. + 33.3) - .5) * 2.;
}
// how much fog lies between the eye and something dist metres off, above metres over the
// ground: clear for the first few metres, then closing fast (the square term) — near things sharp
// and dark, the middle distance soft, the far gone — and thicker low down, a few metres out
float fogAt(float dist, float above, float density) {
  float path = dist * .55 + dist * dist / 40.;
  return 1. - exp(-density * path * (1. + 1.1 * exp(-max(above, 0.) * .35) * smoothstep(5., 20., dist)));
}
// depth of field: the blur (circle of confusion, px) of something dist metres off — none at
// the focus and beyond (the fog softens the far), growing fast as things come near: grass at your
// feet papered over, a twig passing your face a faint smear
uniform float uBlur, uFocus;
float coc(float dist) { return uBlur * max(0., 1. / max(dist, .05) - 1. / uFocus); }
// 0 dry … 1 a wet hollow (world.ts place)
float wetAt(float h) { return 1. - smoothstep(uRelief.z, uRelief.z + uRelief.x * .8, h); }
// the mist is a volume you walk through: its density (per metre) at p, over ground at gh —
// banks drifting through the wood, and mist lying in the hollows a few metres deep. What is
// seen through it is what lies along the way there (world.ts mistDensity is the same)
float mistDensity(vec3 p, float gh) {
  vec2 q = vec2(p.x * .05 + p.z * .021 + uT * .014, p.z * .05 - p.x * .017 + uT * .004);
  float n = vnoise(q) * .65 + vnoise(q * 2.7 + 5.) * .35;
  float above = max(p.y - gh, 0.);
  float banks = smoothstep(.45, .8, n) * exp(-above * .08);
  float wet = wetAt(gh);
  float lying = wet > .01 ? smoothstep(.2, 1., wet) * exp(-above * 1.1) * (.4 + .6 * vnoise(p.xz * .07 + vec2(uT * .006, 0.))) : 0.;
  // and low drifts, a metre or two deep, in patches (so the mist along the ground is never one even band)
  float low = smoothstep(.5, .78, vnoise(p.xz * .09 + vec2(uT * .01, -uT * .004) + 31.)) * exp(-above * .55);
  return banks * .05 + lying * .12 + low * .07;
}
// for what is drawn on its own (a tree, a card, a deer): the mist along the way to its foot and
// to its top, summed on the CPU for each (world.ts mistAlong), between them by height
uniform vec2 uMistT;
uniform float uTopH;
float mistTo(vec3 w) { return 1. - exp(-mix(uMistT.x, uMistT.y, clamp((w.y - uBase) / max(uTopH, .1), 0., 1.))); }
uniform vec4 uCam; // x, z, eye, yaw
uniform vec2 uSun; // the key light's azimuth, elevation (sun by day, moon by night)
uniform vec3 uGlow; // its glow in the fog
uniform vec3 uIllum; // what lights the wood
// the fog's colour looking in a (world) direction: lighter higher, brighter towards the light.
// Everything fogged takes its fog from the direction it is seen in, so a far tree fades into
// exactly the fog behind it
vec3 fogDir(vec3 d) {
  float el = d.y;
  vec3 c = mix(uFogLow, uFogHigh, smoothstep(0., .6, max(el, 0.)));
  float da = mod(atan(d.x, d.z) - uSun.x + 3.14159, 6.28318) - 3.14159;
  return c + exp(-da * da * 3. - (el - uSun.y) * (el - uSun.y) * 6.) * uGlow;
}
vec3 fogToward(vec3 w) { return fogDir(normalize(w - vec3(uCam.x, uCam.z, uCam.y))); }
`;

const QUAD_VS = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); gl_Position = vec4(p, 0., 1.); }`;

const WORLD_FS = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
uniform vec2 uRes;
uniform float uF, uHz, uDensity;
uniform vec3 uPathK; // the two path fields' scales, the path's half-width
uniform vec3 uGround, uStrawDark, uStraw, uEarth;
uniform float uOpen; // how open the wood is (world.ts openness)
// trees near enough to shade the ground: x, z, contact radius, crown radius (crown centre offset away from the light)
uniform vec4 uShade[40];
uniform vec2 uShadeOff[40];
uniform int uShadeN;
// the stone structures near you (world.ts structures): x, z, turn, kind (1 tower, 2 viaduct); and
// for a tower: base height, height, radius, seed; for a viaduct: base height, deck height, span, piers
uniform vec4 uStA[6];
uniform vec4 uStB[6];
uniform int uStN;
${NOISE}
// paths: where two smooth fields cross their middle value. Each field's zero line winds by itself;
// where the two families meet, paths join and fork. (world.ts has the same, so trees keep off)
float pfield(vec2 p, float k, float off) { return vnoise(p * k + off) * .7 + vnoise(p * k * 2.3 + off * 1.7) * .3; }
float pathDist(vec2 p) {
  float best = 1e3;
  for (int i = 0; i < 2; i++) {
    float k = i == 0 ? uPathK.x : uPathK.y;
    float off = float(i) * 37.1;
    float e = .25;
    float n = pfield(p, k, off) - .5;
    vec2 g = vec2(pfield(p + vec2(e, 0.), k, off) - pfield(p - vec2(e, 0.), k, off), pfield(p + vec2(0., e), k, off) - pfield(p - vec2(0., e), k, off)) / (2. * e);
    best = min(best, abs(n) / max(length(g), 1e-4));
  }
  return best;
}
// the scrub beyond the near cards: the height of its tops over the ground here (m) — tall in the
// glades and the gaps, thin under the canopy, none in the wet or on the paths — with its tops
// ragged at every scale
float scrubTop(vec2 p, float gh, float t) {
  float open = smoothstep(.55, .75, vnoise(p / 110. + 211.1) + uOpen);
  float amt = (.3 + .7 * open) * smoothstep(.2, .55, vnoise(p * .08 + 17.));
  amt *= 1. - smoothstep(.45, .7, wetAt(gh));
  if (amt < .01) return 0.;
  float h = amt * (.5 + .5 * vnoise(p * .55 + 3.)) * (.7 + .6 * vnoise(p * 2.3 + 9.)) * 1.4;
  // (the paths, near enough to matter)
  if (t < 30.) h *= smoothstep(uPathK.z * .7, uPathK.z * 1.5, pathDist(p));
  return h;
}
// ─── the forest floor, near: built leaf by leaf ────────────────────────────────────────────
// Layers scattered top-down, each on its own turned grid, one thing to a cell (kept inside it, so
// one lookup a layer): leaves — lobed like oak or toothed like beech, curled, veined, in every
// shade from fresh tan to the near-black of last year's — twigs, pebbles, and the dark earth.
// What is above hides what is below and shadows it at its edges. Each layer is antialiased by
// the pixel's true footprint, and fades to its average once its things are too small to see, so
// it never shimmers and meets the painted ground beyond without a seam.
vec4 hash4(ivec2 c, int k) {
  uint a = pcg(uint(c.x) * 1973u ^ pcg(uint(c.y) + uSeed + uint(k) * 7919u));
  uint b = pcg(a), cc = pcg(b), dd = pcg(cc);
  return vec4(float(a), float(b), float(cc), float(dd)) / 4294967295.;
}
vec3 leafColour(float h, float depth) {
  // fresh tan, ochre, rust, brown, grey-brown decay; deeper layers older and darker
  vec3 c = h < .25 ? vec3(.5, .39, .25) : h < .45 ? vec3(.5, .38, .2) : h < .62 ? vec3(.43, .26, .15) : h < .85 ? vec3(.31, .22, .14) : vec3(.37, .31, .22);
  return c * mix(1., .5, depth);
}
// one layer of leaves: cell size s (m), the grid turned by (cs, sn), how full (amount), how old
void leafLayer(vec2 p, float s, vec2 turn, int k, float amount, float depth, float px, vec3 ld, inout vec3 col, inout float cov, inout float shade) {
  if (cov > .995) return;
  mat2 R = mat2(turn.x, -turn.y, turn.y, turn.x);
  vec2 q = R * p / s + float(k) * 17.31;
  ivec2 c = ivec2(floor(q));
  vec4 h = hash4(c, k);
  vec4 g = hash4(c, k + 101);
  float L = .7 + .26 * h.x;                      // length, in cells
  float present = step(h.w, amount);
  float Lm = L * s;
  // too small to see: the layer's average (how much it covers, and its mean colour)
  float detail = 1. - smoothstep(Lm * .1, Lm * .4, px);
  vec3 mean = vec3(.42, .31, .19) * mix(1., .5, depth);
  float meanCov = amount * .3;
  vec3 lc = mean;
  float alpha = meanCov;
  float edge = 1.;
  if (detail > 0. && present > 0.) {
    float Wd = L * (.26 + .18 * h.y);
    vec2 ctr = vec2(c) + .5 + (h.zw - .5) * (1. - L);
    vec2 dir = normalize(g.xy * 2. - 1. + 1e-4);
    vec2 u = q - ctr;
    u = vec2(dot(u, dir), dot(u, vec2(-dir.y, dir.x)));
    float x = u.x / (L * .5);
    // the outline: pointed at the tip, rounded at the base; oak lobes or beech teeth
    float oak = step(g.z, .38);
    float lob = oak * .22 * sin((x + 1.) * 3.14159 * 3.5) + (1. - oak) * .05 * sin((x + 1.) * 26.);
    float w = Wd * pow(max(1. - x * x, 0.), .7) * (1. + lob) * (x > 0. ? 1. - x * .25 : 1.);
    float dIn = (abs(u.y) - w) * s;
    float d = max(dIn, (abs(x) - 1.) * L * .5 * s);
    // the stalk
    float stalk = max(abs(u.y) * s - .0008, max(-x - 1.3, x + .95) * L * .5 * s);
    d = min(d, stalk);
    float aa = 1. - smoothstep(-px * .5, px * .5, d);
    float yn = clamp(u.y / max(w, 1e-3), -1., 1.);
    // colour, mottled; darker toward the curled edges
    vec3 c0 = leafColour(g.w, depth) * (.82 + .36 * vnoise(u * 9. + float(k)));
    c0 *= mix(1., .72, smoothstep(.55, 1., abs(yn)));
    // curled: the edges up (or the leaf cupped down), lit as it curls
    float curl = (h.y - .35) * 1.6;
    vec2 sl = vec2(0., curl * 1.3 * yn);
    sl = vec2(dot(sl, vec2(dir.x, -dir.y)), dot(sl, dir.yx));
    sl = transpose(R) * sl;
    vec3 N = normalize(vec3(-sl.x, 1., -sl.y));
    c0 *= .62 + .55 * max(dot(N, ld), 0.);
    // the midrib, and side veins running out to the edge
    float vein = (1. - smoothstep(.0, .05, abs(yn))) * step(abs(x), .92);
    vein = max(vein, (1. - smoothstep(0., .08, abs(fract(x * 3.5 - abs(yn) * 1.2) - .5) * 2.)) * .5 * step(.15, abs(yn)) * step(abs(yn), .85));
    c0 *= 1. - .22 * vein * smoothstep(px * 3., px, .004);
    lc = mix(mean, c0, detail);
    alpha = mix(meanCov, aa, detail);
    edge = d;
  }
  lc *= 1. - shade;
  col += (1. - cov) * alpha * lc;
  cov += (1. - cov) * alpha;
  // what lies under it is in its shadow near its edge
  shade = max(shade * .7, .42 * detail * present * exp(-max(edge, 0.) / .006));
}
// a layer of twigs: thin dark sticks, lit as round wood
void twigLayer(vec2 p, float s, vec2 turn, int k, float amount, float px, vec3 ld, inout vec3 col, inout float cov, inout float shade) {
  if (cov > .995) return;
  mat2 R = mat2(turn.x, -turn.y, turn.y, turn.x);
  vec2 q = R * p / s + float(k) * 9.7;
  ivec2 c = ivec2(floor(q));
  vec4 h = hash4(c, k);
  vec4 g = hash4(c, k + 101);
  float r = .0015 + .003 * h.y;
  float detail = 1. - smoothstep(r * .5, r * 3., px);
  float alpha = amount * .06;
  vec3 tc = vec3(.2, .15, .1) * (.7 + .5 * g.w);
  float edge = 1.;
  if (detail > 0. && h.w < amount) {
    float L = .5 + .45 * h.x;
    vec2 ctr = vec2(c) + .5 + (h.zw - .5) * (1. - L);
    vec2 dir = normalize(g.xy * 2. - 1. + 1e-4);
    vec2 u = q - ctr;
    float along = clamp(dot(u, dir), -L * .5, L * .5);
    vec2 off = (u - dir * along) * s;
    float d = length(off) - r * (1. - .4 * (along / L + .5));
    float aa = 1. - smoothstep(-px * .5, px * .5, d);
    float a = clamp(dot(off, vec2(-dir.y, dir.x)) / r, -1., 1.);
    vec2 nn = transpose(R) * vec2(-dir.y, dir.x);
    vec3 N = normalize(vec3(nn.x * a, sqrt(max(0., 1. - a * a)), nn.y * a));
    vec3 c0 = tc * (.55 + .6 * max(dot(N, ld), 0.));
    tc = mix(tc, c0, detail);
    alpha = mix(alpha, aa, detail);
    edge = d;
  }
  tc *= 1. - shade;
  col += (1. - cov) * alpha * tc;
  cov += (1. - cov) * alpha;
  shade = max(shade * .7, .4 * detail * exp(-max(edge, 0.) / .004));
}
// a layer of stones: irregular (an outline wandering with three harmonics), rounded on top, in
// warm greys and browns, darker where the wet has them
void stoneLayer(vec2 p, float s, vec2 turn, int k, float amount, float px, vec3 ld, float damp, inout vec3 col, inout float cov, inout float shade) {
  if (cov > .995) return;
  mat2 R = mat2(turn.x, -turn.y, turn.y, turn.x);
  vec2 q = R * p / s + float(k) * 5.3;
  ivec2 c = ivec2(floor(q));
  vec4 h = hash4(c, k);
  vec4 g = hash4(c, k + 101);
  float rad = .26 + .2 * h.x;                    // in cells
  float radm = rad * s;
  float detail = 1. - smoothstep(radm * .2, radm * .8, px);
  vec3 sc = g.w < .7 ? mix(vec3(.17, .155, .13), vec3(.34, .31, .26), g.z) : mix(vec3(.24, .17, .12), vec3(.36, .27, .2), g.z);
  sc *= mix(1., .62, damp);
  float alpha = amount * .42;
  float edge = 1.;
  if (detail > 0. && h.w < amount) {
    vec2 ctr = vec2(c) + .5 + (h.zw - .5) * (1. - 2.4 * rad);
    vec2 u = q - ctr;
    vec2 dir = normalize(g.xy * 2. - 1. + 1e-4);
    u = vec2(dot(u, dir), dot(u, vec2(-dir.y, dir.x))) / vec2(rad, rad * (.65 + .35 * h.y));
    float th = atan(u.y, u.x);
    float outline = 1. + .1 * sin(2. * th + g.x * 6.28) + .07 * sin(3. * th + g.y * 6.28) + .04 * sin(5. * th + g.z * 6.28);
    float r = length(u);
    float d = (r - outline) * radm;
    float aa = 1. - smoothstep(-px * .5, px * .5, d);
    // rounded on top, flatter in the middle; the light on its upper side
    vec2 uu = u / outline;
    float z = sqrt(max(0., 1. - dot(uu, uu)));
    vec2 nu = vec2(dot(vec2(uu.x, uu.y), vec2(dir.x, -dir.y)), dot(vec2(uu.x, uu.y), dir.yx));
    nu = transpose(R) * nu;
    vec3 N = normalize(vec3(nu.x, z * 1.6 + .2, nu.y));
    vec3 c0 = sc * (.45 + .75 * max(dot(N, ld), 0.)) * (.85 + .3 * vnoise(u * 5. + float(k)));
    // a damp sheen of the fog's light on the wettest
    c0 += fogDir(reflect(-ld, N)) * .06 * damp * pow(max(N.y, 0.), 8.);
    sc = mix(sc, c0, detail);
    alpha = mix(alpha, aa, detail);
    edge = d;
  }
  sc *= 1. - shade;
  col += (1. - cov) * alpha * sc;
  cov += (1. - cov) * alpha;
  shade = max(shade * .7, .5 * detail * exp(-max(edge, 0.) / .005));
}
// the floor's own relief, under everything that lies on it: hummocks (~0.6 m), clods (~20 cm) and
// grit (~7 cm), each fading out when it is too small for the pixel (no shimmer). Returns the
// surface's normal, and how far down in a hollow this is (for the dark that collects there)
vec4 floorRelief(vec2 xz, float px) {
  vec2 grad = vec2(0.);
  float hollow = 0.;
  float scale = .6, amp = .045;
  for (int i = 0; i < 3; i++) {
    float lod = 1. - smoothstep(scale * .08, scale * .3, px);
    if (lod <= 0.) break;
    vec2 q = xz / scale + float(i) * 13.7;
    float e = .15;
    float h0 = vnoise(q);
    // the slope of this octave (rise per metre), by small steps across and along
    grad += vec2(vnoise(q + vec2(e, 0.)) - h0, vnoise(q + vec2(0., e)) - h0) / (e * scale) * amp * lod;
    hollow += (.5 - h0) * lod * (i == 0 ? .5 : 1.);
    scale *= .33;
    amp *= .4;
  }
  return vec4(normalize(vec3(-grad.x, 1., -grad.y)), hollow);
}
// the floor here: how much litter (shelter), the path (trodden: fewer leaves, more stones), the wet
vec3 forestFloor(vec2 xz, float t, vec3 d, float litter, float path, float damp) {
  // the pixel's footprint (m): across, and drawn out along the view at a grazing angle; widened
  // by the depth of field near you
  float across = t / uF;
  float px = sqrt(across * across / max(-d.y, .04)) * (1. + coc(t) * .5);
  vec3 ld = normalize(vec3(sin(uSun.x) * cos(uSun.y), max(sin(uSun.y), .25), cos(uSun.x) * cos(uSun.y)));
  vec3 col = vec3(0.);
  float cov = 0.;
  float shade = 0.;
  // (the grids the layers are scattered on, bent by a slow warp a cell or so deep, so no row of
  // them ever lines up)
  vec2 wxz = xz + (vec2(vnoise(xz * 2.3), vnoise(xz * 2.3 + 7.31)) - .5) * .14;
  float leaves = mix(.3, .62, litter) * (1. - .5 * path);
  float stones = mix(.55, .8, path) * (1. - .4 * damp);
  // leaves over stones: six layers of leaves, older and darker going down, with stones of four
  // sizes among the lower ones and twigs among the upper
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float a = fi * 2.39996;
    float s = .09 + .07 * fract(fi * .618 + .3);
    leafLayer(wxz, s, vec2(cos(a), sin(a)), 1 + i * 3, leaves * (1. - fi * .05), fi / 7., px, ld, col, cov, shade);
    if (i == 1) twigLayer(wxz, .45, vec2(.8, .6), 40, .45 * leaves + .2 * path, px, ld, col, cov, shade);
    if (i == 2) stoneLayer(wxz, .13, vec2(.6, -.8), 42, stones * .8, px, ld, damp, col, cov, shade);
    if (i == 3) twigLayer(wxz, .3, vec2(-.96, .28), 41, .35 * leaves, px, ld, col, cov, shade);
    if (i == 4) stoneLayer(wxz, .085, vec2(-.3, .95), 43, stones, px, ld, damp, col, cov, shade);
    if (cov > .995) break;
  }
  stoneLayer(wxz, .06, vec2(.95, .3), 44, stones, px, ld, damp, col, cov, shade);
  stoneLayer(wxz, .04, vec2(-.7, -.7), 45, stones, px, ld, damp, col, cov, shade);
  // beneath: grit and earth — tiny stones over dark soil (fading to their average when too fine
  // to see), mossy in the wet
  float gl = 1. - smoothstep(.003, .012, px);
  float grit = mix(.5, smoothstep(.45, .65, vnoise(xz * 140.)) * .7 + vnoise(xz * 47.) * .3, gl);
  vec3 under = mix(vec3(.1, .08, .06), vec3(.26, .23, .19), grit * .8);
  under = mix(under, vec3(.09, .1, .05) * (.8 + .4 * vnoise(xz * 23.)), damp * .6);
  col += (1. - cov) * under * (1. - shade * .6);
  // the relief it all lies on: lit as it faces the light behind the fog (leaves on a hummock catch
  // it together), and dark collecting in the hollows
  vec4 rel = floorRelief(xz, px);
  float lit = (.68 + .5 * max(dot(rel.xyz, ld), 0.)) / (.68 + .5 * ld.y);
  col *= lit * (1. - .5 * clamp(rel.w, 0., .6));
  // wet leaves are darker and a little greener
  return col * mix(vec3(1.), vec3(.72, .78, .62), damp * .7);
}
// ─── stone: structures that stand in the wood (a ruined tower, the piers of a high viaduct) ─────────
// Each a signed distance in its own frame (x along its axis, y up from its base), traced only where
// a ray meets its box. Masonry is drawn on in the shading: courses, blocks, mortar, moss and ivy.
vec3 toLocal(vec3 w, int i) {
  vec4 a = uStA[i];
  vec2 r = w.xz - a.xy;
  float c = cos(a.z), s = sin(a.z);
  return vec3(c * r.x + s * r.y, w.y - uStB[i].x, -s * r.x + c * r.y);
}
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.); }
// a ruined round tower: a battered wall, its top broken away unevenly, a doorway, slit windows
float sdTower(vec3 p, vec4 b) {
  float H = b.y, R0 = b.z;
  float r = length(p.xz);
  float th = atan(p.z, p.x);
  float R = R0 * (1. + .07 * (1. - clamp(p.y / H, 0., 1.)));
  float wall = abs(r - R) - .48;
  // the broken top: low on one side, high on the other, ragged
  float top = H * (1. - .42 * vnoise(vec2(th * .9 + b.w * 7., b.w)) - .12 * vnoise(vec2(th * 3.1, b.w + 3.)));
  float d = max(wall, p.y - top);
  d = max(d, -p.y - 4.);
  // the doorway (facing along x): a tall opening, round-headed
  vec3 q = p - vec3(R, 0., 0.);
  float door = max(sdBox(q - vec3(0., 1.1, 0.), vec3(1.4, 1.2, .62)), -1.);
  door = min(door, length(vec2(q.z, max(q.y - 2.3, 0.))) - .62 + max(abs(q.x) - 1.4, 0.) * 9.);
  d = max(d, -door);
  // slit windows, four round, one above another
  float a4 = mod(th + .785, 1.571) - .785;
  float fl = mod(p.y - 4.2, 3.4) - 1.7;
  float slit = max(max(abs(a4 * R) - .11, abs(fl) - .55), max(abs(r - R) - .8, 3.6 - p.y));
  d = max(d, -slit);
  return d;
}
// a viaduct: a row of tall piers carrying arches high overhead (the deck lost in the fog), the
// piers battered (wider low down), standing in the ground whatever its height
float sdViaduct(vec3 p, vec4 b) {
  float D = b.y, S = b.z, N = b.w;
  float half_ = (N - 1.) * .5 * S;
  // the whole body, ground to deck, battered
  float tap = clamp(p.y / D, 0., 1.);
  float wz = 2.4 - .5 * tap + .35 * step(p.y, 1.5);
  float body = sdBox(p - vec3(0., (D + 2.5 - 60.) * .5, 0.), vec3(half_ + 1.3, (D + 2.5 + 60.) * .5, wz));
  // the spans between the piers: open below, arched above (the arch's crown a little under the deck)
  float ra = S * .5 - 1.15 - .25 * (1. - tap);
  float k = clamp(floor(p.x / S + (N - 1.) * .5), 0., N - 2.);
  float xm = (k + .5 - (N - 1.) * .5) * S;
  float cy = D - .9 - ra;
  float arch = length(vec2(p.x - xm, max(p.y - cy, 0.))) - ra;
  return max(body, -arch);
}
float sdStruct(vec3 w, out int id) {
  float best = 1e3;
  id = -1;
  for (int i = 0; i < 6; i++) {
    if (i >= uStN) break;
    vec3 p = toLocal(w, i);
    float d = uStA[i].w < 1.5 ? sdTower(p, uStB[i]) : sdViaduct(p, uStB[i]);
    if (d < best) { best = d; id = i; }
  }
  return best;
}
// where a ray meets a structure's box (in its frame): the span [t0, t1], or none
vec2 boxSpan(vec3 ro, vec3 rd, int i) {
  vec4 a = uStA[i], b = uStB[i];
  vec3 o = toLocal(ro, i);
  float c = cos(a.z), s = sin(a.z);
  vec3 dl = vec3(c * rd.x + s * rd.z, rd.y, -s * rd.x + c * rd.z);
  vec3 lo, hi;
  if (a.w < 1.5) { float e = b.z * 1.1 + 1.; lo = vec3(-e, -4., -e); hi = vec3(e, b.y + .5, e); }
  else { float e = (b.w - 1.) * .5 * b.z + 1.5; lo = vec3(-e, -60., -3.); hi = vec3(e, b.y + 3., 3.); }
  vec3 inv = 1. / (dl + sign(dl) * 1e-6 + vec3(equal(dl, vec3(0.))) * 1e-6);
  vec3 t0 = (lo - o) * inv, t1 = (hi - o) * inv;
  vec3 tn = min(t0, t1), tf = max(t0, t1);
  float n = max(max(tn.x, tn.y), tn.z), f = min(min(tf.x, tf.y), tf.z);
  return f > max(n, 0.) ? vec2(max(n, 0.), f) : vec2(-1.);
}
// the nearest structure along the ray (distance, or -1), traced only within the boxes it meets
float traceStructures(vec3 ro, vec3 rd, out int id) {
  id = -1;
  float t0 = 1e9, t1 = -1.;
  for (int i = 0; i < 6; i++) {
    if (i >= uStN) break;
    vec2 sp = boxSpan(ro, rd, i);
    if (sp.y > 0.) { t0 = min(t0, sp.x); t1 = max(t1, sp.y); }
  }
  if (t1 < 0.) return -1.;
  float t = max(t0, .05);
  t1 = min(t1, ${DEPTH_RANGE.toFixed(1)});
  for (int k = 0; k < 96; k++) {
    if (t > t1) break;
    int j;
    float d = sdStruct(ro + rd * t, j);
    if (d < .003 + .0015 * t) { id = j; return t; }
    t += d * .9;
  }
  return -1.;
}
// rubble masonry on a face: rough courses of stones, each its own size, tone and roughness, the
// mortar thin, dark and sunk between; every stone a little proud of the wall (light on its top,
// shadow under). Returns: mortar, stone id, shading, detail (all fade with distance)
vec4 masonry(vec2 uv, float px, float seed, out vec2 tilt) {
  // the courses: each its own height (.2 – .42 m), found by a noisy cumulative height
  float row = floor(uv.y / .31 + .35 * vnoise(vec2(uv.x * .12, seed)));
  float rh = fract(sin(row * 12.9898 + seed) * 43758.5453);
  float hr = .31;
  float y0 = (row - .35 * vnoise(vec2(uv.x * .12, seed))) * hr;
  float fy = uv.y - y0;
  // the stones along the course: lengths .3 – 1 m, their joints wandering
  float bl = .32 + .65 * fract(rh * 7.13);
  float bx = (uv.x + rh * 3.7) / bl + .25 * (vnoise(vec2(uv.y * 3., row)) - .5);
  float col = floor(bx);
  float id = fract(sin(dot(vec2(col, row), vec2(127.1, 311.7)) + seed) * 43758.5453);
  float fx = fract(bx) * bl;
  float sh = hr;
  // some stones are two, one on another
  if (id < .3) {
    float split = hr * (.4 + .2 * fract(id * 31.));
    if (fy > split) { fy -= split; sh = hr - split; id = fract(id * 17.3); } else sh = split;
  }
  // each stone's own outline: rounded, its edges chipped and wandering
  float chip = .035 * (vnoise(uv * 5. + id * 9.) - .4) + .012 * (vnoise(uv * 19. + id * 3.) - .5);
  float edge = min(min(fx, bl - fx), min(fy, sh - fy)) - chip;
  float mortar = 1. - smoothstep(.0, .006 + max(px * .8, .003), edge);
  float detail = 1. - smoothstep(.04, .2, px);
  // proud of the wall: its face rounded towards its edges (the tilt packed for the light, in the
  // face's across and up), pitted and mottled within
  float bulge = smoothstep(0., .09, edge);
  tilt = vec2((fx / bl - .5), (fy / sh - .5)) * 2. * (1. - bulge) * detail;
  float rough = (vnoise(uv * 23. + id * 5.) - .5) * .22 + (vnoise(uv * 61. + id) - .5) * .12;
  float pits = -smoothstep(.72, .8, vnoise(uv * 37. + id * 7.)) * .18;
  return vec4(mortar * detail, id, mix(1., .82 + rough + pits, detail), detail);
}
vec3 shadeStructure(vec3 w, int i, float t, vec3 d, float tauIn) {
  int j;
  vec2 e = vec2(.012, -.012);
  vec3 N = normalize(e.xyy * sdStruct(w + e.xyy, j) + e.yyx * sdStruct(w + e.yyx, j) + e.yxy * sdStruct(w + e.yxy, j) + e.xxx * sdStruct(w + e.xxx, j));
  vec3 p = toLocal(w, i);
  vec4 b = uStB[i];
  bool tower = uStA[i].w < 1.5;
  float px = t / uF;
  // the face's own coordinates: round the tower; along or across the viaduct; up
  float c = cos(uStA[i].z), s = sin(uStA[i].z);
  vec3 Nl = vec3(c * N.x + s * N.z, N.y, -s * N.x + c * N.z);
  vec2 uv = tower ? vec2(atan(p.z, p.x) * b.z, p.y) : (abs(Nl.x) > abs(Nl.z) ? vec2(p.z, p.y) : vec2(p.x, p.y));
  if (!tower && Nl.y < -.3) uv = vec2(p.z, p.x);
  vec2 tilt;
  vec4 m = masonry(uv, px, b.w, tilt);
  // each stone its own: grey sandstone, some warmer, some darker
  vec3 stone = (tower ? vec3(.31, .29, .26) : vec3(.29, .29, .28)) * (.72 + .5 * m.y);
  stone = mix(stone, vec3(.36, .29, .21), step(.78, m.y) * .6);
  stone *= m.z;
  stone = mix(stone, vec3(.05, .05, .045), m.x * .85);
  // weather: rain-streaks down the faces, lichen pale in patches
  stone *= .85 + .3 * vnoise(vec2(uv.x * 2.5, uv.y * .25));
  stone = mix(stone, vec3(.55, .56, .48), smoothstep(.62, .75, vnoise(uv * 1.7 + 5.)) * .35 * m.w);
  // moss on what faces up and low down, and on the side away from the light; ivy climbing the tower
  vec3 ld = normalize(vec3(sin(uSun.x) * cos(uSun.y), max(sin(uSun.y), .2), cos(uSun.x) * cos(uSun.y)));
  float gh = groundH(w.xz);
  float low = 1. - smoothstep(0., 3.5, w.y - gh);
  float moss = max(smoothstep(.45, .8, N.y), low * .7) * smoothstep(.35, .6, vnoise(uv * 1.3 + 9.));
  moss = max(moss, (1. - max(dot(N, ld), 0.)) * .35 * smoothstep(.5, .7, vnoise(uv * .9)));
  stone = mix(stone, vec3(.13, .16, .07) * (.8 + .4 * vnoise(uv * 13.)), clamp(moss, 0., 1.) * .8);
  if (tower) {
    // ivy: climbing from the foot in tongues, ragged at its edges, leaf by leaf (light and dark
    // leaves, shade between them)
    float reach = vnoise(vec2(uv.x * .35, uv.y * .18) + b.w) * .7 + vnoise(uv * 1.3 + b.w) * .3 + (1. - p.y / b.y) * .4 - .25;
    float leafN = vnoise(uv * 11.) * .55 + vnoise(uv * 27. + 3.) * .45;
    float ivy = smoothstep(.45, .5, reach + (leafN - .5) * .25 * m.w);
    vec3 ivyC = mix(vec3(.035, .05, .025), vec3(.11, .15, .06), smoothstep(.4, .75, leafN)) * (.8 + .4 * vnoise(uv * 53.));
    stone = mix(stone, ivyC, ivy * .95);
  }
  // each stone rounded: its normal tilted toward its edges (across the face, and up it)
  vec3 tanU = normalize(vec3(-N.z, 0., N.x) + 1e-5);
  if (abs(N.y) < .7) N = normalize(N + tanU * tilt.x * .45 + vec3(0., 1., 0.) * tilt.y * .45);
  // light: the sun behind the fog, the sky from above, the dark in hollows and openings (AO)
  float ao = 0.;
  for (int k = 1; k <= 4; k++) {
    float h = .25 * float(k);
    ao += (h - sdStruct(w + N * h, j)) / h;
  }
  ao = clamp(1. - ao * .22, .25, 1.);
  float lit = (.5 + .55 * max(dot(N, ld), 0.) + .2 * (.5 + .5 * N.y)) * ao;
  vec3 colr = stone * lit * uIllum;
  // the fog and the mist between
  float above = w.y - gh;
  float fogD = fogAt(length(w.xz - uCam.xy), above, uDensity);
  return mix(colr, fogDir(d), 1. - (1. - fogD) * exp(-tauIn));
}
void main() {
  vec2 px = gl_FragCoord.xy;
  // cylindrical projection: across the screen is angle (so turning only slides the picture);
  // up the screen is height over horizontal distance (so verticals stay vertical)
  float th = (px.x - .5 * uRes.x) / uF;
  vec3 dc = normalize(vec3(sin(th), (px.y - uHz) / uF, cos(th)));
  float cy = cos(uCam.w), sy = sin(uCam.w);
  vec3 d = vec3(dc.x * cy + dc.z * sy, dc.y, -dc.x * sy + dc.z * cy);
  float az = atan(d.x, d.z);
  vec3 col;
  vec3 eye = vec3(uCam.x, uCam.z, uCam.y);
  // the ground rises and falls: march to it, each step no longer than the slope allows
  // (the ground can climb at most L for each metre across)
  const float L = .35;
  float tHit = -1.;
  float top = uRelief.x + uRelief.w + 1.5;
  // the scrub, met on the way: a dense, dark, tawny-topped mass the ray passes into and is
  // lost in (what it lets through, and what it gives)
  float sT = 1.;
  vec3 sCol = vec3(0.);
  // the mist along the way (optical depth), summed as the march goes
  float tau = 0.;
  // stone first: what the ground march need not go beyond
  int sid;
  float tS = traceStructures(eye, d, sid);
  if (d.y < L) {
    float t = .05;
    bool gone = false;
    for (int i = 0; i < 64; i++) {
      vec3 q = eye + d * t;
      if (t > 95. || (q.y > top && d.y >= 0.) || (tS > 0. && t > tS)) { gone = true; break; }
      float gh = groundH(q.xz);
      float gap = q.y - gh;
      if (gap < .004 + .002 * t) { tHit = t; break; }
      float step = max(gap / (L - d.y), .02 + .006 * t);
      step = min(step, 6. + .1 * t);
      // (the near scrub is cards; this takes over beyond them)
      float fade = smoothstep(6., 16., t);
      if (fade > 0. && gap < 1.5) {
        step = min(step, max(.5, .035 * t));
        float sh = scrubTop(q.xz, gh, t) * fade;
        if (gap < sh) {
          float fill = smoothstep(sh, sh * .5, gap);
          float a = 1. - exp(-fill * 4.5 * step);
          // dark and warm in the mass, bleached tawny at the tops, some stems paler
          float tip = smoothstep(.35, 1., gap / max(sh, .01));
          vec3 c = mix(vec3(.07, .05, .03), vec3(.46, .32, .16) * (.7 + .5 * vnoise(q.xz * 3.1)), tip * tip * .85) * uIllum;
          float f = 1. - (1. - fogAt(t, gap, uDensity)) * exp(-tau);
          sCol += sT * a * mix(c, fogDir(d), f);
          sT *= 1. - a;
          if (sT < .02) { tHit = t; break; }
        }
      }
      tau += mistDensity(q + d * step * .5, gh) * step;
      t += step;
    }
    // (out of steps on a grazing ray: the ground is about there, and deep in the fog)
    if (tHit < 0. && !gone && d.y < 0.) tHit = t;
  }
  // still water in the deepest hollows: a level surface
  float tWater = -1.;
  if (d.y < 0. && eye.y > uRelief.z) {
    float tw = (uRelief.z - eye.y) / d.y;
    vec3 pw = eye + d * tw;
    if ((tHit < 0. || tw < tHit) && tw < 95. && groundH(pw.xz) < uRelief.z) tWater = tw;
  }
  bool stone = tS > 0. && (tHit < 0. || tS < tHit) && (tWater < 0. || tS < tWater);
  if (stone) {
    vec3 w = eye + d * tS;
    // (rays looking up did not march: the mist to it summed here)
    if (d.y >= L) {
      float gh0 = groundH(eye.xz);
      for (int i = 0; i < 6; i++) tau += mistDensity(eye + d * tS * (float(i) + .5) / 6., gh0) * tS / 6.;
    }
    col = shadeStructure(w, sid, tS, d, tau);
  } else if (tHit < 0. && tWater < 0.) {
    // only fog: lighter higher, brighter where the light is behind it; and the mist you look
    // up through (looking up steeply, the march did not run: a few steps of it here)
    col = fogDir(d);
    if (d.y >= L) {
      float gh = groundH(eye.xz);
      for (int i = 0; i < 6; i++) {
        float t = 3. + float(i) * 8.;
        tau += mistDensity(eye + d * t, gh) * 8.;
      }
    }
    col = mix(col, col * 1.04 + .01, 1. - exp(-tau));
  } else if (tWater > 0.) {
    float t = tWater;
    vec3 p = eye + d * t;
    float depth = uRelief.z - groundH(p.xz);
    // still, dark water: the fog above in it, a faint stir across it, the shallows going to mud
    vec2 st = vec2(vnoise(p.xz * 2.3 + vec2(uT * .25, 0.)), vnoise(p.xz * 2.3 + vec2(17., -uT * .2))) - .5;
    vec3 n = normalize(vec3(st.x * .05, 1., st.y * .05));
    vec3 r = reflect(d, n);
    float fres = .35 + .65 * pow(1. - abs(d.y), 4.);
    vec3 sky = fogDir(r);
    vec3 deep = vec3(.03, .04, .035) * uIllum;
    vec3 w = mix(deep, sky * .85, fres);
    vec3 mud = uEarth * .55 * uIllum;
    w = mix(mud, w, smoothstep(0., .12, depth));
    float fogD = fogAt(t, 0., uDensity);
    col = mix(w, fogDir(d), 1. - (1. - fogD) * exp(-tau));
  } else {
    float t = tHit;
    vec3 p = eye + d * t;
    float gh = p.y;
    float hollow = wetAt(gh);
    float open = smoothstep(.55, .75, vnoise(p.xz / 110. + 211.1) + uOpen);
    // dry grass: straw and shadow, a trodden path darker
    float n = fbm(p.xz * .5);
    float grain = vnoise(p.xz * 6.) * .5 + vnoise(p.xz * 17.) * .5;
    vec3 g = mix(uStrawDark, uGround, smoothstep(.2, .75, n));
    g = mix(g, uStraw * .8, smoothstep(.6, .95, vnoise(p.xz * 2.2)) * .35);
    g *= .8 + .35 * grain;
    // under the trees, last year's leaves: brown, speckled leaf by leaf, drifted
    float shelter = (1. - open) * (1. - hollow);
    float lv = vnoise(p.xz * 11.) * .6 + vnoise(p.xz * 29.) * .4;
    vec3 litter = mix(vec3(.2, .12, .06), vec3(.4, .25, .12), smoothstep(.45, .75, lv)) * (.75 + .4 * vnoise(p.xz * 3.1));
    g = mix(g, litter, shelter * (.45 + .4 * smoothstep(.35, .7, vnoise(p.xz * .5))));
    // in the hollows the ground is wet: dark, mossy, holding the fog's light
    vec3 moss = mix(vec3(.07, .075, .04), vec3(.15, .15, .075), vnoise(p.xz * 5.));
    float damp = smoothstep(.3, .85, hollow);
    g = mix(g, moss, damp * .8);
    g = mix(g, fogDir(vec3(d.x, -d.y, d.z)) / max(uIllum, vec3(.05)) * .4, damp * smoothstep(.55, .8, vnoise(p.xz * .7)) * .3);
    // and the slopes face the light or away from it (softly: the light is diffuse in fog)
    float e = .4;
    vec3 gn = normalize(vec3(groundH(p.xz - vec2(e, 0.)) - groundH(p.xz + vec2(e, 0.)), 2. * e, groundH(p.xz - vec2(0., e)) - groundH(p.xz + vec2(0., e))));
    vec3 ld = vec3(sin(uSun.x) * cos(uSun.y), sin(uSun.y), cos(uSun.x) * cos(uSun.y));
    g *= (.75 + .35 * max(dot(gn, ld), 0.)) / (.75 + .35 * max(ld.y, 0.));
    // the paths: bare, trodden earth, damp in the middle, crumbling at the edges into the grass,
    // a little grass coming back here and there down the middle
    float pd = pathDist(p.xz) + (vnoise(p.xz * 1.1) - .5) * .35;
    float hw = uPathK.z * (.8 + .4 * vnoise(p.xz * .13));
    float path = 1. - smoothstep(hw * .55, hw, pd);
    float edge = smoothstep(hw * .35, hw * .8, pd) * path;
    vec3 earth = uEarth * (.75 + .5 * vnoise(p.xz * 7.)) * (1. - .25 * (1. - smoothstep(0., hw * .4, pd)));
    earth = mix(earth, uStrawDark, edge * .5);
    // damp, trodden earth holds a little of the fog's light (so the way reads ahead in the mist)
    float wet = (1. - smoothstep(0., hw * .6, pd)) * smoothstep(.35, .7, vnoise(p.xz * .9));
    earth = mix(earth, fogDir(vec3(d.x, -d.y, d.z)) / max(uIllum, vec3(.05)) * .55, wet * .45);
    float regrow = smoothstep(.62, .8, vnoise(p.xz * 2.7)) * (1. - smoothstep(0., hw * .3, pd)) * .6;
    g = mix(g, mix(earth, g, regrow), path);
    // near you, the floor itself, leaf by leaf (it fades to its own average with distance, and
    // that into the painted ground beyond)
    float nearT = 1. - smoothstep(16., 26., t);
    if (nearT > 0.) {
      vec3 ff = forestFloor(p.xz, t, d, max(shelter, .25), path * (1. - regrow), damp);
      g = mix(g, ff, nearT * mix(.75, .95, shelter));
    }
    // shade: dark at each trunk's foot, a soft pool under each crown (the light is diffuse in fog)
    float ao = 0.;
    for (int i = 0; i < 40; i++) {
      if (i >= uShadeN) break;
      vec4 sh = uShade[i];
      vec2 d0 = p.xz - sh.xy;
      vec2 d1 = d0 - uShadeOff[i];
      ao += .38 * exp(-dot(d0, d0) / (sh.z * sh.z)) + .13 * exp(-dot(d1, d1) / (sh.w * sh.w));
    }
    // broken up, as light through a crown and over tussocks is
    g *= 1. - min(ao, .6) * (.55 + .7 * vnoise(p.xz * 1.9));
    float fogD = fogAt(t, 0., uDensity);
    col = mix(g * uIllum, fogDir(d), 1. - (1. - fogD) * exp(-tau));
  }
  col = sCol + sT * col;
  o = vec4(col, 1.);
  // depth: the stone where it stands, all else at the far end
  gl_FragDepth = stone ? clamp(length((eye + d * tS).xz - eye.xz) / ${DEPTH_RANGE.toFixed(1)}, 0., 1.) : 1.;
}`;

/** Cells per card (the curved projection needs a few). */
const COLS = 4;
const ROWS = 8;

const CARD_VS = `#version 300 es
uniform vec2 uRes;
uniform float uF, uHz;
uniform vec4 uCam;
uniform vec2 uAnchor; // world x, z
uniform vec4 uRect;   // left, bottom, width, height (m, already scaled; mirrored if flipped)
uniform float uBase;  // the ground's height at its foot
out vec2 vUV;
out vec3 vWorld;
out float vDist;
void main() {
  // a grid of cells, not one quad: the projection is curved, so the card must bend with it
  int cell = gl_VertexID / 6, k = gl_VertexID % 6;
  ivec2 corner = ivec2(k == 1 || k == 4 || k == 5 ? 1 : 0, k == 2 || k == 3 || k == 5 ? 1 : 0);
  vec2 c = vec2(float(cell % ${COLS} + corner.x) / float(${COLS}), float(cell / ${COLS} + corner.y) / float(${ROWS}));
  // the card turns about its trunk to face the eye, so the trunk stays planted where it stands
  vec2 toEye = vec2(uCam.x, uCam.y) - uAnchor;
  vec2 right = normalize(vec2(-toEye.y, toEye.x) + vec2(1e-5, 0.));
  float along = uRect.x + c.x * uRect.z;
  vec3 w = vec3(uAnchor.x + right.x * along, uBase + uRect.y + c.y * uRect.w, uAnchor.y + right.y * along);
  vec3 rel = w - vec3(uCam.x, uCam.z, uCam.y);
  float cs = cos(uCam.w), sn = sin(uCam.w);
  float cx = rel.x * cs - rel.z * sn;
  float cz = rel.x * sn + rel.z * cs;
  float hd = max(length(vec2(cx, cz)), .05);
  vec2 scr = vec2(atan(cx, cz) * uF + .5 * uRes.x, rel.y / hd * uF + uHz);
  // (depth: its distance, so stone in front hides it)
  gl_Position = vec4(scr / uRes * 2. - 1., clamp(hd / ${DEPTH_RANGE.toFixed(1)}, 0., 1.) * 2. - 1., 1.);
  vUV = c;
  vWorld = w;
  vDist = length(rel.xz);
}`;

const CARD_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
in vec3 vWorld;
in float vDist;
out vec4 o;
uniform sampler2D uTex;
uniform float uDensity, uWind, uPhase, uKind, uFlip, uAlpha;
uniform vec4 uRect;
uniform vec3 uBark, uBirch, uLeaf, uStraw, uStrawDark;
${NOISE}
void main() {
  // wind moves only what is flexible (the bake's flex: twigs 1, trunk 0). Flex is read from a
  // blurred level of the card, so a twig's neighbourhood knows it may move there
  vec4 near = textureLod(uTex, vUV, 3.5);
  float flex = clamp(near.b / max(near.a, .002), 0., 1.);
  float gust = .5 + .5 * sin(uT * .23 + uPhase);
  float sway = sin(uT * 1.1 + uPhase + vWorld.x * .3) * .6 + sin(uT * 2.7 + uPhase * 1.7 + vWorld.y * .8) * .4;
  float flutter = vnoise(vec2(vWorld.x * 4. + uT * 1.7, vWorld.y * 4. - uT * .9)) - .5;
  // metres: a twig sways a few centimetres, trembles a little more
  float m = (sway * .035 * (.4 + .6 * gust) + flutter * .02) * uWind * flex * flex;
  // near, out of focus: a blurrier level of the card (its texels are about the size of pixels)
  vec4 t = texture(uTex, vec2(vUV.x + m / abs(uRect.z) * uFlip, vUV.y), log2(1. + coc(vDist)));
  t *= smoothstep(.15, .6, vDist);
  if (t.a < .003) discard;
  float cov = min(t.a, 1.);
  float tone = clamp(t.g / max(t.a, .002), 0., 1.);
  float leaf = clamp(t.r / max(t.a, .002), 0., 1.);
  vec3 birch = uBirch;
  if (tone > .3 && uKind < .5) {
    // birch bark: dark lenticels across the white, black patches, darker towards the foot
    float band = vnoise(vec2(vWorld.x * 4., vWorld.y * 40.));
    float patchy = vnoise(vec2(vWorld.x * 2. + uPhase, vWorld.y * 7.));
    birch *= 1. - .75 * smoothstep(.72, .8, band) - .7 * smoothstep(.7, .78, patchy) - .5 * exp(-(vWorld.y - uBase) * 1.2);
  }
  vec3 base = uKind > .5 ? mix(uStrawDark, uStraw, tone) : mix(uBark, birch, tone);
  base = mix(base, uLeaf, leaf);
  // thin wood is lit through by the fog behind it
  base = mix(base, uFogLow / max(uIllum, vec3(.05)), (1. - cov) * .22);
  // fog: by distance, and much thicker near the ground; banks of mist drift through
  // (the ground fog lies a few metres off: what is at your feet is clear)
  float fogD = fogAt(vDist, vWorld.y - uBase, uDensity);
  float fog = 1. - (1. - fogD) * (1. - mistTo(vWorld));
  o = vec4(mix(base * uIllum, fogToward(vWorld), fog) * cov, cov) * uAlpha;
}`;

/**
 * Near trees as live 3D geometry: every segment of the grown tree, each frame, as a screen-space
 * anti-aliased line (as the bake draws them) — so a near tree is right from every side, has depth
 * in its crown, and its bark is shaded by where it faces. Segments come thickest first, so drawing
 * the first N is the tree as far as it can be seen at that distance.
 */

const LIVE_VS = `#version 300 es
in vec3 aP0;
in vec3 aP1;
in vec4 aInfo; // w0, w1, tone, leaf
uniform vec2 uRes;
uniform float uF, uHz, uT, uWind;
uniform vec4 uCam;
uniform vec2 uAnchor;
uniform float uRot, uScale, uPhase, uRadius, uHeight, uBase;
uniform float uBlur, uFocus;
out vec2 vP;
flat out vec2 vA;
flat out vec2 vB;
flat out vec2 vW;
flat out vec2 vTL;
flat out vec2 vWm;
// each end's world place and distance: the fragment finds its own along the segment (a quad's
// corners stand beyond its ends, so interpolating these across the quad would be wrong there)
flat out vec3 vWa;
flat out vec3 vWb;
flat out vec2 vDab;
vec3 place(vec3 p) {
  float c = cos(uRot), s = sin(uRot);
  vec3 q = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c) * uScale;
  // wind as a smooth field over the tree (so no joint ever cracks): nothing on the trunk's axis
  // or low down; the outer, high twigs most
  float radial = length(p.xz) / max(uRadius, .3);
  float reach = smoothstep(.12, 1., radial) * smoothstep(.1, .6, p.y / max(uHeight, 1.));
  float gust = .5 + .5 * sin(uT * .23 + uPhase);
  vec3 wv = vec3(sin(uT * 1.1 + uPhase + p.y * .3) * .6 + sin(uT * 2.7 + uPhase * 1.7 + p.x * 2.) * .4, 0., cos(uT * .9 + uPhase * 1.3 + p.z * 2.) * .5);
  float flutter = sin(uT * 6.3 + dot(p, vec3(9.1, 7.3, 8.7)));
  q += (wv * .07 * (.4 + .6 * gust) + vec3(flutter, flutter * .4, -flutter) * .012) * uWind * reach * reach * uScale;
  return q + vec3(uAnchor.x, uBase, uAnchor.y);
}
vec3 project(vec3 w, out float hd) {
  vec3 rel = w - vec3(uCam.x, uCam.z, uCam.y);
  float cs = cos(uCam.w), sn = sin(uCam.w);
  float cx = rel.x * cs - rel.z * sn;
  float cz = rel.x * sn + rel.z * cs;
  hd = max(length(vec2(cx, cz)), .05);
  return vec3(atan(cx, cz) * uF + .5 * uRes.x, rel.y / hd * uF + uHz, cz);
}
void main() {
  vec3 wa = place(aP0), wb = place(aP1);
  float ha, hb;
  vec3 sa = project(wa, ha), sb = project(wb, hb);
  if (sa.z < .08 || sb.z < .08) { gl_Position = vec4(2., 2., 2., 1.); return; }
  float pa = aInfo.x * uScale * uF / ha, pb = aInfo.y * uScale * uF / hb;
  vec2 a = sa.xy, b = sb.xy, d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(0., 1.);
  vec2 n = vec2(-dir.y, dir.x);
  // (room for the blur of what is near)
  float blur = uBlur * max(0., 1. / max(min(ha, hb), .05) - 1. / uFocus);
  float e = max(pa, pb) * .5 + 1.5 + blur;
  int c = gl_VertexID;
  bool first = c == 0 || c == 2;
  vec2 p = (first ? a - dir * e : b + dir * e) + n * (c < 2 ? -e : e);
  gl_Position = vec4(p / uRes * 2. - 1., 0., 1.);
  vP = p;
  vA = a;
  vB = b;
  vW = vec2(pa, pb);
  vTL = aInfo.zw;
  vWm = aInfo.xy * uScale;
  vWa = wa;
  vWb = wb;
  vDab = vec2(ha, hb);
}`;

const LIVE_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vP;
flat in vec2 vA;
flat in vec2 vB;
flat in vec2 vW;
flat in vec2 vTL;
flat in vec2 vWm;
flat in vec3 vWa;
flat in vec3 vWb;
flat in vec2 vDab;
out vec4 o;
uniform float uDensity, uAlpha, uPhase, uRim, uViewAz;
// 1: only lay down depth (the solid middle of the wide wood), so what is behind a trunk is hidden
uniform float uDepthPass;
uniform vec3 uBark, uBirch, uLeaf;
// bark up close: fissure depth, pattern scale, lichen, moss (the species')
uniform vec4 uBarkP;
// the sun's direction in the view (screen right, screen up, towards the eye)
uniform vec3 uLight;
${NOISE}
float hc(float a, float b) { return h2(ivec2(int(floor(a)), int(floor(b)) + int(uPhase * 1000.))); }
// organic patches: noise warped by noise and turned off the grid (plain value noise, thresholded,
// shows its square cells as straight-edged blocks)
float organic(vec2 p) {
  vec2 q = p + vec2(vnoise(p * .7 + 3.1), vnoise(p * .7 + 7.7)) * 1.4;
  return fbm(mat2(.8, -.6, .6, .8) * q);
}
void main() {
  vec2 pa = vP - vA, ba = vB - vA;
  float bb = max(dot(ba, ba), 1e-6);
  float hRaw = dot(pa, ba) / bb;
  float h = clamp(hRaw, 0., 1.);
  vec2 off = pa - ba * h;
  float d = length(off);
  float w = mix(vW.x, vW.y, h);
  // where on the wood this is (world), and how far
  vec3 vWorld = mix(vWa, vWb, hRaw);
  float vDist = mix(vDab.x, vDab.y, hRaw);
  float cov;
  if (w >= 4.) {
    // wide wood is a continuous cylinder: no round ends (where one segment meets the next they
    // overlap a little, computing the same surface, so the bark runs on without a seam)
    float over = w * .4 / sqrt(bb);
    if (hRaw < -over || hRaw > 1. + over) discard;
    // past its ends it goes on tapering as it was (not stepping: a flare's segments are short)
    w = max(mix(vW.x, vW.y, hRaw), .5);
    off = pa - ba * hRaw;
    d = length(off);
    cov = clamp(w * .5 - d + .5, 0., 1.);
  } else if (w >= 1.) cov = clamp(w * .5 - d + .5, 0., 1.);
  else {
    if ((hRaw < 0. || hRaw > 1.) && coc(vDist) < .5) discard;
    cov = w * clamp(1. - d, 0., 1.);
  }
  // out of focus: the line spread over its blur, as faint as it is spread (a thin twig near the
  // eye a soft smear, a trunk's edges soft); and gone, not cut, as it comes to the eye
  float B = coc(vDist);
  if (B > .5) cov = min(1., (w + .5) / (2. * B + 1.)) * (1. - smoothstep(max(w * .5 - B, 0.), w * .5 + B + .5, d));
  cov *= smoothstep(.1, .5, vDist);
  if (cov <= .002) discard;
  // round wood: the normal across the branch (a is -1 … 1 from one edge to the other), lit by the
  // sun where it is behind the fog, with the sky's soft light from above all round; backlit, the
  // edges catch it
  vec2 nn = normalize(vec2(-ba.y, ba.x) + 1e-6);
  if (nn.x < 0.) nn = -nn;
  float a = clamp(dot(off, nn) / max(w * .5, .5), -1., 1.);
  vec3 N = vec3(nn * a, sqrt(max(0., 1. - a * a)));
  // depth: the round surface, nearer than the axis by the radius where it faces you
  float zf = clamp((vDist - mix(vWm.x, vWm.y, h) * .5 * N.z) / ${DEPTH_RANGE.toFixed(1)}, 0., 1.);
  if (uDepthPass > .5) {
    if (cov < .5) discard;
    gl_FragDepth = zf;
    o = vec4(0.);
    return;
  }
  // (drawn a hand's breadth nearer than it is, so a twig only hides when truly behind)
  gl_FragDepth = max(zf - .1 / ${DEPTH_RANGE.toFixed(1)}, 0.);
  float dif = max(0., dot(N, uLight));
  float sky = .5 + .5 * N.y;
  float round = w > 1.5 ? 1. : smoothstep(.5, 1.5, w);
  float lit = mix(.85, .38 + .5 * dif + .22 * sky + .35 * pow(abs(a), 5.) * uRim, round);
  // up close the surface itself: where on the wood this is — round the trunk (metres, from the
  // side facing you, turned by where you stand) and up it — so the pattern stays on the wood
  float near = smoothstep(5., 24., w) * (1. - vTL.y);
  float wm = max(mix(vWm.x, vWm.y, hRaw), .001);
  float u = (asin(a) + uViewAz) * wm * .5;
  float v = vWorld.y - uBase;
  float wrap = sqrt(max(0., 1. - a * a));
  vec3 birch = uBirch;
  vec3 bark = uBark;
  if (vTL.x > .3) {
    // birch: papery, creamy and a little uneven; fine lenticels in rows across it; dark
    // patches long across and short up; and a dark, fissured foot with a ragged edge
    birch *= .9 + .14 * vnoise(vec2(u * 7., v * 1.4)) * near;
    birch = mix(birch, birch * vec3(1.04, .98, .95), vnoise(vec2(u * 3., v * .7) + 9.) * .5 * near);
    // lenticels: thin dark dashes across the bark, in loose rows — some long, many short, gaps,
    // each a little above or below its row
    float row = v / .016;
    float rowJ = hc(row, 7.);
    float uu = u + rowJ * 3.;
    float cell = uu / (.035 + .03 * rowJ);
    float r = hc(row, cell);
    float r2 = hc(row + 31., cell);
    float len = (.004 + r * r * .04) / (.035 + .03 * rowJ);
    float cx = abs(fract(cell) - .5);
    float cy = abs(fract(row) - .5 - (r2 - .5) * .35);
    float dash = step(.5, r) * (1. - smoothstep(len * .5, len * .5 + .05, cx)) * (1. - smoothstep(.06 + r2 * .1, .12 + r2 * .12, cy));
    // and the pale bark itself in bands: a little greyer here, creamier there
    birch *= .93 + .1 * vnoise(vec2(u * 2., v * 9.)) * near;
    float patchy = smoothstep(.62, .7, organic(vec2(u * 6., v * 14.) + uPhase * 7.));
    float foot = 1. - smoothstep(0., .12, v - (.35 + .6 * vnoise(vec2(u * 4., uPhase * 9.))));
    float marks = max(dash * .85 * near, patchy * .8) * wrap;
    birch *= 1. - marks;
    // far, the marks blur into bands (as before)
    float band = vnoise(vec2(a * .9 + uPhase * 3.1, v * 48.));
    birch *= 1. - .7 * smoothstep(.74, .8, band) * wrap * (1. - near);
    float blit = mix(.9, .62 + .32 * dif + .16 * sky + .3 * pow(abs(a), 5.) * uRim, round);
    birch = mix(birch * blit, birch * vec3(.66, .74, .7) * (.7 + .2 * sky), (1. - dif) * .4 * round);
    // the foot: dark rough bark
    float plates = fbm(vec2(u * 9., v * 2.));
    vec3 rough = uBark * (.6 + .6 * smoothstep(.4, .6, plates)) * lit;
    birch = mix(birch, rough, max(foot, exp(-v * 3.) * .6));
  } else birch *= lit;
  if (near > 0.) {
    // dark bark: long plates split by fissures (deep in some species, none in others), a fine grain,
    // its relief catching the light
    float sc = uBarkP.y;
    // (plates a few centimetres across and a hand or two long; fissures between)
    float plates = organic(vec2(u * 28. / sc, v * 6. / sc));
    float cracks = vnoise(vec2(u * 80. / sc, v * 14. / sc));
    float ridge = smoothstep(.38, .6, plates * .7 + cracks * .3);
    float relief = mix(1., ridge, uBarkP.x * near);
    float grain = vnoise(vec2(u * 220., v * 70.));
    bark *= (.35 + .9 * relief) * (.85 + .3 * grain * near);
    float bump = clamp((dFdx(relief) * uLight.x + dFdy(relief) * uLight.y) * 5., -.4, .4);
    lit *= 1. + bump * uBarkP.x * near;
    // lichen: pale grey-green crusts with speckled edges, a yellow one now and then, at mid height
    // (rosettes a few centimetres across, clustered where the bark suits them, absent elsewhere)
    float where = smoothstep(.25, .6, vnoise(vec2(u * 3., v * 1.3) + 41.));
    float lm = smoothstep(.5, .62, organic(vec2(u * 38., v * 26.) + 17.)) * where * uBarkP.z * smoothstep(.2, 1.2, v) * (1. - smoothstep(9., 16., v));
    // a crust, not paint: finely speckled (two turned layers of noise, so no square cells), the
    // bark showing through
    vec2 sp = vec2(u, v) * 160.;
    float speck = vnoise(mat2(.8, -.6, .6, .8) * sp) * .5 + vnoise(mat2(.28, .96, -.96, .28) * sp * 1.37 + 5.) * .5;
    lm *= (.4 + .6 * smoothstep(.3, .65, speck)) * .7;
    vec3 lichenC = mix(vec3(.5, .57, .48), vec3(.6, .58, .36), step(.88, organic(vec2(u * 10., v * 10.) + 3.)));
    // moss: velvet green, low on the trunk and on its shaded side; the foot always a little mossy
    float mm = smoothstep(.45, .56, organic(vec2(u * 12., v * 7.) + 5.)) * uBarkP.w * (1. - smoothstep(.2, .6 + 2.4 * uBarkP.w, v)) * (.35 + .65 * (1. - dif));
    mm = max(mm, uBarkP.w * (1. - smoothstep(0., .4, v)) * .75);
    vec3 mossC = mix(vec3(.12, .19, .06), vec3(.27, .35, .1), vnoise(vec2(u * 130., v * 130.)));
    bark = mix(bark, lichenC / max(lit, .3), lm * near * (1. - vTL.x));
    bark = mix(bark, mossC / max(lit, .3) * (.8 + .4 * dif), mm * near);
    birch = mix(birch, lichenC * lit, lm * near * vTL.x * .5);
  }
  vec3 base = mix(bark * lit, birch, vTL.x);
  base = mix(base, uLeaf, vTL.y);
  base = mix(base, uFogLow / max(uIllum, vec3(.05)), (1. - cov) * .22);
  float fogD = fogAt(vDist, vWorld.y - uBase, uDensity);
  float fog = 1. - (1. - fogD) * (1. - mistTo(vWorld));
  o = vec4(mix(base * uIllum, fogToward(vWorld), fog) * cov, cov) * uAlpha;
}`;

/**
 * A deer, from shapes: body (with chest and haunch), neck, head (in profile, or turned to look
 * at you), ears, four jointed legs (standing, or bounding), and the rump that flashes white as
 * it runs. Drawn on a card at its place in the wood, side-on, fogged like everything else.
 */
const DEER_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUV;
in vec3 vWorld;
in float vDist;
out vec4 o;
uniform float uDensity, uAlpha, uSize, uFace;
uniform vec4 uPose; // head up, head turned to you, gait phase, running
uniform float uBed; // 0 standing … 1 lying up (legs folded under, the body on the ground, head up)
uniform vec3 uBark;
${NOISE}
float sdCap(vec2 p, vec2 a, vec2 b, float ra, float rb) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h) - mix(ra, rb, h); }
float sdEll(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; return (length(q) - 1.) * min(r.x, r.y); }
float smin(float a, float b, float k) { float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }
void main() {
  vec2 p = vec2((vUV.x - .5) * 2.6, vUV.y * 2.1) / uSize;
  p.x *= uFace;
  float run = uPose.w, g = uPose.z;
  // bounding: the body rises and pitches with each leap
  float bob = run * .22 * max(0., sin(g));
  float pitch = run * .14 * sin(g + 1.2);
  vec2 q = p - vec2(0., bob - uBed * .68);
  q = vec2(q.x, q.y - .95) * mat2(cos(pitch), -sin(pitch), sin(pitch), cos(pitch)) + vec2(0., .95);
  float body = sdEll(q, vec2(0., .95), vec2(.5, .2));
  body = smin(body, sdEll(q, vec2(-.36, .99), vec2(.2, .22)), .08);
  body = smin(body, sdEll(q, vec2(.34, .96), vec2(.18, .22)), .08);
  // neck and head: down grazing, up alert; the head in profile, or turned to look at you
  vec2 nb = vec2(.42, 1.03);
  vec2 nt = mix(vec2(.7, .48), vec2(.57, 1.46), uPose.x);
  float neck = sdCap(q, nb, nt, .1, .062);
  vec2 hp = nt + mix(vec2(.12, -.03 + .05 * uPose.x), vec2(.025, .05), uPose.y);
  vec2 hr = mix(vec2(.15, .062), vec2(.072, .1), uPose.y);
  float head = sdEll(q, hp, hr);
  vec2 e1 = hp + mix(vec2(-.08, .07), vec2(-.06, .09), uPose.y);
  vec2 e2 = hp + mix(vec2(-.05, .09), vec2(.06, .09), uPose.y);
  float ears = min(sdCap(q, e1, e1 + mix(vec2(-.07, .09), vec2(-.09, .07), uPose.y), .028, .012), sdCap(q, e2, e2 + mix(vec2(-.03, .11), vec2(.09, .07), uPose.y), .028, .012));
  float d = smin(body, neck, .06);
  d = smin(d, head, .04);
  d = min(d, ears);
  // legs: hip, knee, hoof; the front pair and the hind pair alternate in the bound
  for (int i = 0; i < 4; i++) {
    bool front = i < 2;
    float off = (front ? 0. : 3.14159) + (i % 2 == 0 ? 0. : .35);
    vec2 hip = front ? vec2(.3 + float(i) * .05, .86) : vec2(-.4 + float(i - 2) * .06, .9);
    float a = g + off;
    vec2 stand = vec2(hip.x + (front ? .03 : -.02), 0.);
    vec2 leap = hip + vec2(sin(a) * .42, -.8 + .3 * max(0., cos(a)));
    vec2 hoof = mix(stand, leap, run);
    vec2 knee = mix(hip, hoof, .5) + vec2(front ? -.05 : .09, .02);
    // lying up: the legs folded under the body, a foreleg tucked forward
    vec2 fold = hip + vec2(front ? .3 : .26, -.17);
    knee = mix(knee, hip + vec2(front ? -.04 : .02, -.14), uBed);
    hoof = mix(hoof, fold, uBed);
    d = min(d, sdCap(q, hip, knee, .06, .034));
    d = min(d, sdCap(q, knee, hoof, .03, .018));
  }
  float fw = max(fwidth(d), 1e-4);
  float cov = 1. - smoothstep(-fw, fw, d);
  if (cov < .003) discard;
  // the rump patch, white, flashing as it runs
  float rump = sdEll(q, vec2(-.54, 1.), vec2(.075, .11));
  float white = (1. - smoothstep(-fw, fw, rump)) * (.3 + .7 * run);
  vec3 base = mix(uBark * 1.3, vec3(.62, .6, .55), white);
  float fogD = fogAt(vDist, vWorld.y - uBase, uDensity);
  float fog = 1. - (1. - fogD) * (1. - mistTo(vWorld));
  o = vec4(mix(base * uIllum, fogToward(vWorld), fog) * cov, cov) * uAlpha;
}`;

const POST_FS = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uExposure;
${NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texture(uScene, uv).rgb * uExposure;
  // a soft film curve, blacks lifted into the fog's green
  c = mix(c, c * c * (3. - 2. * c), .42);
  c = mix(c, uFogLow, .025);
  // vignette
  vec2 q = (uv - .5) * vec2(uRes.x / uRes.y, 1.);
  c *= mix(1., .8, smoothstep(.35, 1.05, length(q) * 1.15));
  // grain, moving
  float g = h2(ivec2(gl_FragCoord.xy) + ivec2(int(uT * 97.) & 1023, int(uT * 61.) & 1023)) - .5;
  c += g * .045 * (.6 + .4 * (1. - dot(c, vec3(.33))));
  o = vec4(c, 1.);
}`;

export interface View {
  x: number;
  z: number;
  eye: number;
  yaw: number;
  f: number;
  horizon: number;
}

export interface Look {
  /** the sun's direction in view space: screen right, up, towards the eye */
  light: [number, number, number];
  /** trees shading the ground: x, z, contact r, crown r, then crown offset x, z (per tree) */
  shade: Float32Array;
  shadeOff: Float32Array;
  shadeN: number;
  seed: number;
  t: number;
  density: number;
  wind: number;
  /** the two path fields' scales and the path's half-width */
  path: [number, number, number];
  atmos: Atmos;
  /** the stone structures near you, packed for the shader (world.ts structures; up to 6) */
  structA: Float32Array;
  structB: Float32Array;
  structN: number;
  /** the lie of the land (world.ts relief) and how open the wood is */
  relief: [number, number, number, number];
  openness: number;
  /** depth of field: blur (px) of something 1 m off, focused at infinity; and the focus (m) */
  blur: number;
  focus: number;
}

export interface CardDraw {
  live: false;
  card: Card;
  x: number;
  z: number;
  /** the ground's height at its foot (m) */
  base: number;
  /** the mist along the way to its foot and to its top (optical depth), and how tall it is (m) */
  mist: [number, number];
  top: number;
  rect: [number, number, number, number];
  flip: boolean;
  phase: number;
  patch: boolean;
  alpha: number;
  bark: [number, number, number];
}
export interface LiveDraw {
  live: true;
  buffer: WebGLBuffer;
  count: number;
  /** how many of those (the thickest) are solid enough to hide what is behind them */
  wide: number;
  x: number;
  z: number;
  /** the ground's height at its foot (m) */
  base: number;
  /** the mist along the way to its foot and to its top (optical depth), and how tall it is (m) */
  mist: [number, number];
  top: number;
  rot: number;
  scale: number;
  phase: number;
  radius: number;
  height: number;
  alpha: number;
  bark: [number, number, number];
  /** fissure depth, pattern scale, lichen, moss */
  barkP: [number, number, number, number];
  /** where you stand, seen from the tree (its own turn taken off), so the bark stays on the wood */
  viewAz: number;
}
export interface DeerDraw {
  live: false;
  pose: [number, number, number, number];
  /** 0 standing … 1 lying up */
  bed: number;
  x: number;
  z: number;
  /** the ground's height at its foot (m) */
  base: number;
  /** the mist along the way to its foot and to its top (optical depth), and how tall it is (m) */
  mist: [number, number];
  top: number;
  size: number;
  /** ±1 for which way it faces on screen, over how side-on it is seen */
  face: number;
  alpha: number;
  bark: [number, number, number];
}
export type Draw = CardDraw | LiveDraw | DeerDraw;

/** The photograph's colours. */
const PAL = {
  fogLow: [0.44, 0.54, 0.48],
  fogHigh: [0.53, 0.63, 0.57],
  bark: [0.1, 0.095, 0.08],
  birch: [0.7, 0.73, 0.68],
  leaf: [0.26, 0.15, 0.09],
  // (from the reference: tawny moor-grass tips over dark, warm dead growth)
  straw: [0.56, 0.4, 0.21],
  strawDark: [0.11, 0.08, 0.045],
  ground: [0.24, 0.17, 0.095],
  earth: [0.15, 0.12, 0.09],
};

export class Renderer {
  gl: WebGL2RenderingContext;
  private world: WebGLProgram;
  private card: WebGLProgram;
  private post: WebGLProgram;
  private liveProg: WebGLProgram;
  private deerProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private liveVao: WebGLVertexArrayObject;
  private scene: { fbo: WebGLFramebuffer; tex: WebGLTexture; depth: WebGLRenderbuffer; w: number; h: number } | null = null;
  private u = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is needed to walk here');
    this.gl = gl;
    this.world = this.compile(QUAD_VS, WORLD_FS);
    this.card = this.compile(CARD_VS, CARD_FS);
    this.post = this.compile(QUAD_VS, POST_FS);
    this.liveProg = this.compile(LIVE_VS, LIVE_FS);
    this.deerProg = this.compile(CARD_VS, DEER_FS);
    this.vao = gl.createVertexArray()!;
    this.liveVao = gl.createVertexArray()!;
  }

  compile = (vs: string, fs: string): WebGLProgram => {
    const gl = this.gl;
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
  };

  private loc(p: WebGLProgram, name: string) {
    let m = this.u.get(p);
    if (!m) this.u.set(p, (m = new Map()));
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(p, name));
    return m.get(name)!;
  }

  private target() {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (this.scene && this.scene.w === W && this.scene.h === H) return this.scene;
    this.release();
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    this.scene = { fbo, tex, depth, w: W, h: H };
    return this.scene;
  }

  /** Let go of the scene's render target (it is made again, at the canvas's size, when next drawn). */
  release() {
    const gl = this.gl;
    if (!this.scene) return;
    gl.deleteFramebuffer(this.scene.fbo);
    gl.deleteTexture(this.scene.tex);
    gl.deleteRenderbuffer(this.scene.depth);
    this.scene = null;
  }

  private common(p: WebGLProgram, v: View, look: Look) {
    const gl = this.gl;
    gl.uniform2f(this.loc(p, 'uRes'), this.canvas.width, this.canvas.height);
    gl.uniform1f(this.loc(p, 'uF'), v.f);
    gl.uniform1f(this.loc(p, 'uHz'), v.horizon);
    gl.uniform4f(this.loc(p, 'uCam'), v.x, v.z, v.eye, v.yaw);
    gl.uniform1f(this.loc(p, 'uT'), look.t);
    gl.uniform1ui(this.loc(p, 'uSeed'), look.seed >>> 0);
    gl.uniform3fv(this.loc(p, 'uFogLow'), look.atmos.fogLow);
    gl.uniform3fv(this.loc(p, 'uFogHigh'), look.atmos.fogHigh);
    gl.uniform2fv(this.loc(p, 'uSun'), look.atmos.at);
    gl.uniform3fv(this.loc(p, 'uGlow'), look.atmos.glow);
    gl.uniform3fv(this.loc(p, 'uIllum'), look.atmos.illum);
    gl.uniform1f(this.loc(p, 'uDensity'), look.density);
    gl.uniform4fv(this.loc(p, 'uRelief'), look.relief);
    gl.uniform1f(this.loc(p, 'uOpen'), look.openness);
    gl.uniform1f(this.loc(p, 'uBlur'), look.blur);
    gl.uniform1f(this.loc(p, 'uFocus'), look.focus);
  }

  draw(v: View, look: Look, cards: Draw[]) {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const scene = this.target();
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, W, H);
    gl.bindVertexArray(this.vao);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    // 1. fog and ground (and the stone: it writes its depth)
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    gl.disable(gl.BLEND);
    gl.useProgram(this.world);
    this.common(this.world, v, look);
    gl.uniform3fv(this.loc(this.world, 'uPathK'), look.path);
    gl.uniform3fv(this.loc(this.world, 'uEarth'), PAL.earth);
    gl.uniform3fv(this.loc(this.world, 'uGround'), PAL.ground);
    gl.uniform3fv(this.loc(this.world, 'uStrawDark'), PAL.strawDark);
    gl.uniform3fv(this.loc(this.world, 'uStraw'), PAL.straw);
    gl.uniform4fv(this.loc(this.world, 'uShade'), look.shade);
    gl.uniform2fv(this.loc(this.world, 'uShadeOff'), look.shadeOff);
    gl.uniform1i(this.loc(this.world, 'uShadeN'), look.shadeN);
    gl.uniform4fv(this.loc(this.world, 'uStA'), look.structA);
    gl.uniform4fv(this.loc(this.world, 'uStB'), look.structB);
    gl.uniform1i(this.loc(this.world, 'uStN'), look.structN);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // everything after is hidden by what is nearer (the stone, the live trees' wood); the cards
    // test against it but do not write (they blend)
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    // 2. the cards and the live trees, back to front
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const p = this.card;
    gl.useProgram(p);
    this.common(p, v, look);
    gl.uniform3fv(this.loc(p, 'uBark'), PAL.bark);
    gl.uniform3fv(this.loc(p, 'uBirch'), PAL.birch);
    gl.uniform3fv(this.loc(p, 'uLeaf'), PAL.leaf);
    gl.uniform3fv(this.loc(p, 'uStraw'), PAL.straw);
    gl.uniform3fv(this.loc(p, 'uStrawDark'), PAL.strawDark);
    gl.uniform1f(this.loc(p, 'uWind'), look.wind);
    gl.uniform1i(this.loc(p, 'uTex'), 0);
    const L = this.liveProg;
    gl.useProgram(L);
    this.common(L, v, look);
    gl.uniform3fv(this.loc(L, 'uBark'), PAL.bark);
    gl.uniform3fv(this.loc(L, 'uBirch'), PAL.birch);
    gl.uniform3fv(this.loc(L, 'uLeaf'), PAL.leaf);
    gl.uniform1f(this.loc(L, 'uWind'), look.wind);
    gl.uniform3fv(this.loc(L, 'uLight'), look.light);
    gl.uniform1f(this.loc(L, 'uRim'), Math.max(0, -look.light[2]));
    gl.activeTexture(gl.TEXTURE0);
    let current: WebGLProgram | null = null;
    const use = (prog: WebGLProgram) => {
      if (current === prog) return;
      current = prog;
      gl.useProgram(prog);
      gl.bindVertexArray(prog === L ? this.liveVao : this.vao);
    };
    for (const c of cards) {
      if (c.live) {
        use(L);
        gl.bindBuffer(gl.ARRAY_BUFFER, c.buffer);
        const attr = (name: string, size: number, offset: number) => {
          const loc = gl.getAttribLocation(L, name);
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, SEG * 4, offset * 4);
          gl.vertexAttribDivisor(loc, 1);
        };
        attr('aP0', 3, 0);
        attr('aP1', 3, 3);
        attr('aInfo', 4, 6);
        gl.uniform2f(this.loc(L, 'uAnchor'), c.x, c.z);
        gl.uniform1f(this.loc(L, 'uBase'), c.base);
        gl.uniform2fv(this.loc(L, 'uMistT'), c.mist);
        gl.uniform1f(this.loc(L, 'uTopH'), c.top);
        gl.uniform1f(this.loc(L, 'uRot'), c.rot);
        gl.uniform1f(this.loc(L, 'uScale'), c.scale);
        gl.uniform1f(this.loc(L, 'uPhase'), c.phase);
        gl.uniform1f(this.loc(L, 'uRadius'), c.radius);
        gl.uniform1f(this.loc(L, 'uHeight'), c.height);
        gl.uniform1f(this.loc(L, 'uAlpha'), c.alpha);
        gl.uniform3fv(this.loc(L, 'uBark'), c.bark);
        gl.uniform4fv(this.loc(L, 'uBarkP'), c.barkP);
        gl.uniform1f(this.loc(L, 'uViewAz'), c.viewAz);
        // the solid wood first, depth only; then all of it, behind what is in front
        if (c.wide > 0) {
          gl.colorMask(false, false, false, false);
          gl.depthMask(true);
          gl.uniform1f(this.loc(L, 'uDepthPass'), 1);
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, c.wide);
          gl.colorMask(true, true, true, true);
        }
        gl.depthMask(false);
        gl.uniform1f(this.loc(L, 'uDepthPass'), 0);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, c.count);
        continue;
      }
      if ('pose' in c) {
        const D = this.deerProg;
        if (current !== D) {
          use(D);
          this.common(D, v, look);
        }
        gl.uniform2f(this.loc(D, 'uAnchor'), c.x, c.z);
        gl.uniform1f(this.loc(D, 'uBase'), c.base);
        gl.uniform2fv(this.loc(D, 'uMistT'), c.mist);
        gl.uniform1f(this.loc(D, 'uTopH'), c.top);
        gl.uniform4f(this.loc(D, 'uRect'), -1.3 * c.size, 0, 2.6 * c.size, 2.1 * c.size);
        gl.uniform4fv(this.loc(D, 'uPose'), c.pose);
        gl.uniform1f(this.loc(D, 'uBed'), c.bed);
        gl.uniform1f(this.loc(D, 'uSize'), c.size);
        gl.uniform1f(this.loc(D, 'uFace'), c.face);
        gl.uniform1f(this.loc(D, 'uAlpha'), c.alpha);
        gl.uniform3fv(this.loc(D, 'uBark'), c.bark);
        gl.drawArrays(gl.TRIANGLES, 0, COLS * ROWS * 6);
        continue;
      }
      use(p);
      gl.bindTexture(gl.TEXTURE_2D, c.card.tex);
      gl.uniform2f(this.loc(p, 'uAnchor'), c.x, c.z);
      gl.uniform1f(this.loc(p, 'uBase'), c.base);
      gl.uniform2fv(this.loc(p, 'uMistT'), c.mist);
      gl.uniform1f(this.loc(p, 'uTopH'), c.top);
      gl.uniform4f(this.loc(p, 'uRect'), c.rect[0], c.rect[1], c.rect[2], c.rect[3]);
      gl.uniform1f(this.loc(p, 'uPhase'), c.phase);
      gl.uniform1f(this.loc(p, 'uKind'), c.patch ? 1 : 0);
      gl.uniform1f(this.loc(p, 'uFlip'), c.flip ? -1 : 1);
      gl.uniform1f(this.loc(p, 'uAlpha'), c.alpha);
      gl.uniform3fv(this.loc(p, 'uBark'), c.bark);
      gl.drawArrays(gl.TRIANGLES, 0, COLS * ROWS * 6);
    }
    gl.bindVertexArray(this.vao);
    // 3. the film
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.post);
    this.common(this.post, v, look);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(this.loc(this.post, 'uScene'), 0);
    gl.uniform1f(this.loc(this.post, 'uExposure'), look.atmos.exposure);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

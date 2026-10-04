/**
 * Hat-throwers: a macro timelapse of a small fungus's night and morning, from a seed — a thrower,
 * a pin mould, an inkcap or a jelly cup (see genome.ts). A patch of dung or litter at a few
 * centimetres (or, for the cups, a few millimetres); sixteen hours in under a minute.
 *
 * Drawn as a macro lens sees it: wet things glisten; the stalks are glass, or velvet; the
 * droplets are lenses (each a little upside-down picture of the patch, a glint, a dark rim);
 * the jelly is lit from inside, and the asci in it show through as dark streaks; the depth of
 * field is a few millimetres, so glints behind and in front bloom into discs. Tap anything to pull
 * focus to it; drag to move round; pinch to come closer. The scrubber is the day.
 *
 * Passes: the opaque patch (ground, crumbs, beads, caps, bells, spores, mycelium) → a copy → the
 * glass (jelly, stalks, asci), refracting it → a copy → the droplets, refracting that → depth of
 * field (a scatter-as-gather disc, from depth) → tone.
 */
import { FORMS, DAY, along, ascusState, cushionGrown, cushions, litter, onCushion, patch, species, state, type Cushion, type Form, type Genome, type Stalk, type State, type V3 } from './genome';
import { straw, drawStraw, type Blade } from './straw';
import { bladeNear, drawGrass, type Field } from './grass';
import { drawFlora, floraNear, type FloraKind } from './flora';
import { PAT_GONE, PAT_LIFE, dateOf, dropsNear, patHeight, place, worldNow, type Drop, type Placed } from './pasture';
import { MAXP, ROWW, critters, drawCritters, limbs, whereIs, zoo, type Critters, type Limbs } from './critters';
import { DAYS, GRID, SPAN, STEP, patEdge, type Moment, type Terrarium } from './terrarium';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
/** one species on its own (`?one`), or — the default — a terrarium of them, over three weeks */
const one = params.has('one');
/** the field (the default): pats of every age, in the grass, on the real clock; or (`?terrarium`,
 *  and the gallery's preview) one pat on its own, its three weeks from the start */
const pasture = !one && !preview && !params.has('terrarium');
// (the field is one field — the same for anyone, at the same hour — unless asked for another)
let seed = Number(params.get('seed')) || (pasture ? 1 : Math.floor(Math.random() * 9000) + 1);


const canvas = document.getElementById('macro') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false })!;
if (!gl) throw new Error('WebGL2 is needed');
if (preview) document.body.classList.add('preview');
const hdr = !!gl.getExtension('EXT_color_buffer_float');
const MYC = 48;
const SHADE = 24;

// ─── shaders ────────────────────────────────────────────────────────────────────────────────────
const COMMON = `
uniform vec3 uLight, uEye, uLightCol, uSky;
uniform float uS; // the patch's scale: noise is in the things' own size
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { return n2(p) * .5 + n2(p * 2.1 + 3.) * .25 + n2(p * 4.3 + 7.) * .125 + n2(p * 8.7 + 11.) * .0625; }
float n3(vec3 p) { return n2(p.xz + p.y * 1.7) * .5 + n2(p.xy * 1.3 - p.z) * .5; }
// the studio: a soft bright window where the light is, a dim green room all round
vec3 env(vec3 r) {
  float w = smoothstep(.55, .97, dot(r, uLight));
  return mix(uSky * (.25 + .35 * max(r.y, 0.)), uLightCol * 3., w);
}
// what's behind something thick and clear, seen through it: softened (the ground's fine grain
// doesn't come through a stalk sharp — through glass that close, what's behind is out of focus)
vec3 through(sampler2D t, vec2 uv, vec2 px, float r) {
  vec3 c = texture(t, uv).rgb * .2;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * .785 + .39;
    c += texture(t, clamp(uv + vec2(cos(a), sin(a)) * px * r, 0., 1.)).rgb * .1;
  }
  return c;
}
// wet: the sheen and the glints of a wet surface
vec3 wetness(vec3 n, vec3 v, vec3 p, float wet, float k) {
  vec3 r = reflect(-v, n);
  float f = .03 + .97 * pow(1. - max(dot(n, v), 0.), 5.);
  vec3 c = env(r) * f * (.25 + .75 * wet);
  float s = pow(max(dot(r, uLight), 0.), 60. + 300. * wet);
  // (sparkle: the tiny facets of a wet skin catching the light, here and there)
  float sp = smoothstep(.82, .97, n2(p.xz * k + p.y * k * .7)) * smoothstep(.85, .99, dot(r, uLight));
  return c + uLightCol * (s * (1. + 5. * wet) + sp * 5. * wet);
}
`;
const QUAD_VS = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); gl_Position = vec4(p, 0., 1.); }`;

// the pats near: each where it lies, how high it stands, its age (days); its lumps, its map's layer
const NP = 6;
const PATS = `
uniform vec4 uPat[${NP}];
uniform vec4 uLump[${NP}];
float edgeOf(vec4 L, float a) { return 21. * (1. + .12 * sin(a * 2. + L.x) + .08 * sin(a * 3. + L.y) + .05 * sin(a * 5. + L.z)); }
float mound(vec2 w) {
  float h = 0.;
  for (int i = 0; i < ${NP}; i++) {
    vec4 P = uPat[i];
    if (P.z <= 0.) continue;
    vec2 d = w - P.xy;
    float r = length(d);
    if (r > 34.) continue;
    float e = edgeOf(uLump[i], atan(d.y, d.x));
    h += P.z * smoothstep(-.08, .4, (e - r) / e);
  }
  return h;
}`;
// the ground: dung or litter, lumpy, crumbly, fibrous, wet in its hollows, white with mycelium
const GROUND_VS = `#version 300 es
in vec2 aXZ;
uniform mat4 uVP;
uniform float uS;
uniform vec2 uCentre;
uniform float uExt, uStudio;
out vec3 vW;
// (a hash without sin(), so the page can work out the same heights to stand things on)
float h(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
float hgt(vec2 p) { return (n2(p * .18) - .5) * 1.4 + (n2(p * .6 + 7.) - .5) * .55 + (n2(p * 1.9 + 3.) - .5) * .18; }
${PATS}
void main() {
  // (the mesh goes where the camera is: its middle, how far it reaches; the studio's ground falls
  // away at its edge, the field's goes on)
  vec2 q = uCentre / uS + aXZ * uExt;
  vec2 p = q * uS;
  float y = (hgt(q) - uStudio * smoothstep(20., 70., length(q)) * 3.) * uS + mound(p);
  vW = vec3(p.x, y, p.y);
  gl_Position = uVP * vec4(vW, 1.);
}`;
const GROUND_FS = `#version 300 es
precision highp float;
in vec3 vW;
out vec4 o;
uniform vec3 uGround;
uniform float uWet, uMyc;
uniform vec4 uFeet[${MYC}];
// (where the small animals are: the ground under them in their shadow — x, z, radius, depth)
uniform vec4 uShade[${SHADE}];
// (the pats' ground: per cell, its mycelium, water, food left, and whether it's dung — a layer
// each; and between them, the field's)
uniform highp sampler2DArray uMaps;
uniform float uSpan, uField;
${COMMON}
${PATS}
float fine(vec2 p) { return fbm(p * 3.) * .6 + n2(p * 14.) * .25 + n2(p * 37.) * .15; }
void main() {
  vec2 p = vW.xz / uS;
  // the surface's own fine relief, for the light (finer than the mesh)
  float e = .03;
  vec3 ng = normalize(cross(dFdx(vW), dFdy(vW)));
  if (ng.y < 0.) ng = -ng;
  vec3 nd = vec3(fine(p - vec2(e, 0.)) - fine(p + vec2(e, 0.)), 0., fine(p - vec2(0., e)) - fine(p + vec2(0., e))) / (2. * e) * .22;
  vec3 n = normalize(ng + nd * 1.6);
  vec3 v = normalize(uEye - vW);
  // dung: dark, fibrous (the grass it was), crumbly, flecked
  float fib = n2(p * vec2(2.2, .5) + n2(p * .3) * 4.) * .6 + n2(p * vec2(9., 1.8) + 5.) * .4;
  float crumb = fine(p * 1.3);
  float fleck = smoothstep(.75, .9, n2(p * 1.7 + 3.));
  vec3 c = uGround * (.45 + .7 * fib) * (.7 + .6 * crumb) + vec3(.13, .08, .03) * fleck;
  c = mix(c, c * vec3(1.25, 1., .7), smoothstep(.5, .8, n2(p * .4 + 20.)) * .6);
  // wet in its hollows: darker, glossier
  float wet = smoothstep(.3, .7, n2(p * .35 + 11.) * .7 + (1. - crumb) * .4) * uWet;
  // mycelium: white threads in patches, and round the feet of the stalks
  float myc = uMyc * smoothstep(.62, .8, fbm(p * .45 + 30.));
  // the pats: the dung's edge; eaten dung pales and dries; its water; its mycelium, where the
  // grid says it has spread. Old, it crusts: greyer, cracked, the grass coming back over it
  float dung = 0.;
  vec4 m = vec4(0.);
  float age = 0.;
  for (int i = 0; i < ${NP}; i++) {
    if (uPat[i].z <= 0. || uLump[i].w < 0.) continue;
    vec2 uv = (vW.xz - uPat[i].xy) / uSpan + .5;
    if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) continue;
    vec4 mi = texture(uMaps, vec3(uv, uLump[i].w));
    float di = smoothstep(.2, .8, mi.a);
    if (di > dung) { dung = di; m = mi; age = uPat[i].w; }
  }
  // (between them: bare grey earth in the studio; in the field, the sward's floor — dead
  // leaf, roots, soil, green in it)
  vec3 earth = vec3(.16, .14, .12) * (.6 + .8 * crumb);
  vec3 floor_ = mix(vec3(.09, .075, .045), vec3(.1, .13, .05), smoothstep(.35, .7, fbm(p * .08 + 5.))) * (.55 + .9 * crumb);
  floor_ = mix(floor_, vec3(.32, .27, .16) * (.7 + .5 * fib), smoothstep(.55, .8, n2(p * vec2(1.6, .35) + n2(p * .2) * 5.)) * .55);
  vec3 around = mix(earth, floor_, uField);
  float crust = smoothstep(18., 32., age);
  float cracks = 1. - smoothstep(.0, .06, abs(n2(p * .9 + 7.) - .5)) * crust;
  vec3 cd = mix(c, vec3(.2, .18, .15) * (.7 + .5 * crumb), crust * .75) * (.55 + .45 * cracks);
  cd = mix(cd, floor_, smoothstep(30., 52., age) * smoothstep(.3, .6, fbm(p * .3 + 2.)) * uField);
  c = mix(around, cd, dung);
  c = mix(c, c * vec3(1.5, 1.4, 1.2) + vec3(.05), (1. - m.b) * dung * .6 * (1. - crust));
  wet = mix(wet * uField * .6, smoothstep(.3, .7, n2(p * .35 + 11.) * .5 + m.g * .6) * m.g, dung) * (1. - crust);
  myc = max(myc * (1. - uField), smoothstep(.2, .95, m.r) * .55 * (.3 + .7 * fbm(p * 1.3 + 40.)) * dung);
  c *= 1. - wet * .35;
  for (int i = 0; i < ${MYC}; i++) {
    vec4 f = uFeet[i];
    if (f.w <= 0.) continue;
    float d = length(vW.xz - f.xy) / f.z;
    myc = max(myc, f.w * smoothstep(1., .2, d));
  }
  float threads = smoothstep(.45, .8, n2(p * vec2(40., 9.) + n2(p * 6.) * 6.)) + smoothstep(.55, .85, n2(p * vec2(9., 40.) + 17.));
  c = mix(c, vec3(.82, .82, .78), clamp(myc * (.2 + .45 * threads), 0., .75));
  float diff = .3 + .7 * max(dot(n, uLight), 0.);
  vec3 col = c * diff * uLightCol;
  col += wetness(n, v, vec3(p.x, 0., p.y), wet, 9.);
  float ao = 1.;
  for (int i = 0; i < ${SHADE}; i++) {
    vec4 f = uShade[i];
    if (f.w <= 0.) continue;
    vec2 d = (vW.xz - f.xy) / f.z;
    ao *= 1. - f.w * exp(-dot(d, d) * 2.2);
  }
  o = vec4(col * ao, 1.);
}`;

// ─── limbs: swept tubes along a short polyline (up to 24 points, each with its radius), one row
// of a float texture each — the small animals are built of them: bodies, legs, palps, setae,
// antennae, a furca; a nematode is one ────────────────────────────────────────────────────────
const LIMB_VS = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 aUA;
uniform mat4 uVP;
uniform sampler2D uRows;
uniform int uOffset;
out vec3 vW;
out vec3 vN;
out vec2 vUA;
out float vSeg;
out float vUp;
flat out vec4 vCol;
flat out vec4 vInfo;
flat out vec4 vMore;
int row;
vec4 P(int i) { return texelFetch(uRows, ivec2(i, row), 0); }
// the spine at f (0..n-1): smooth (Catmull-Rom) or jointed (straight between points)
vec4 spine(float f, int n, bool smooth_) {
  f = clamp(f, 0., float(n - 1));
  int i = min(int(floor(f)), n - 2);
  float t = f - float(i);
  vec4 p1 = P(i), p2 = P(i + 1);
  if (!smooth_) return mix(p1, p2, t);
  vec4 p0 = P(max(i - 1, 0)), p3 = P(min(i + 2, n - 1));
  vec4 a = 2. * p1, b = p2 - p0, c = 2. * p0 - 5. * p1 + 4. * p2 - p3, d = -p0 + 3. * p1 - 3. * p2 + p3;
  vec4 q = .5 * (a + b * t + c * t * t + d * t * t * t);
  q.w = max(q.w, min(p1.w, p2.w) * .5);
  return q;
}
void main() {
  row = gl_InstanceID + uOffset;
  vec4 col = P(24), info = P(25), more = P(26);
  int n = int(info.x);
  bool sm = info.w > .5;
  float flat_ = info.y;
  // (the mesh's ends are hemispherical caps: the first and last few rows)
  float cap = .1;
  float u = aUA.x;
  float f, e = 0.;
  if (u < cap) { f = 0.; e = -(1. - u / cap); }
  else if (u > 1. - cap) { f = float(n - 1); e = (u - (1. - cap)) / cap; }
  else f = (u - cap) / (1. - 2. * cap) * float(n - 1);
  float df = .02 * float(n - 1);
  vec4 c = spine(f, n, sm);
  vec4 ca = spine(f - df, n, sm), cb = spine(f + df, n, sm);
  vec3 tv = cb.xyz - ca.xyz;
  float ds = max(length(tv), 1e-6);
  vec3 t = tv / ds;
  float dr = (cb.w - ca.w) / ds;
  vec3 ref = abs(t.y) > .92 ? vec3(1., 0., 0.) : vec3(0., 1., 0.);
  vec3 a = normalize(cross(t, ref));
  // (a blade's width goes the way it's told: across its bend, however far over it bends)
  vec3 wa = P(27).xyz;
  if (dot(wa, wa) > 0.) a = normalize(wa - t * dot(wa, t));
  vec3 b = cross(a, t);
  // (b is the side of the ring toward the sky: a flattened tube is flattened along it)
  vec3 ring = a * cos(aUA.y) + b * sin(aUA.y);
  float r = c.w;
  vec3 off = (a * cos(aUA.y) + b * sin(aUA.y) * flat_) * r;
  vec3 nr = normalize(a * cos(aUA.y) + b * sin(aUA.y) / max(flat_, .05));
  vec3 p = c.xyz;
  vec3 nn = normalize(nr - t * dr);
  if (e != 0.) {
    // a cap: round the end over
    float ph = abs(e) * 1.5708;
    p += t * sign(e) * r * sin(ph) * (flat_ * .5 + .5);
    off *= cos(ph);
    nn = normalize(nr * cos(ph) + t * sign(e) * sin(ph));
  }
  vW = p + off;
  vN = nn;
  vUA = vec2(u, aUA.y);
  vSeg = f;
  vUp = sin(aUA.y);
  vCol = col;
  vInfo = info;
  vMore = more;
  gl_Position = uVP * vec4(vW, 1.);
}`;
const LIMB_FS = `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vN;
in vec2 vUA;
in float vSeg;
in float vUp;
flat in vec4 vCol;
flat in vec4 vInfo;
flat in vec4 vMore;
out vec4 o;
uniform sampler2D uBehind;
uniform vec2 uRes;
uniform mat4 uView;
uniform float uGlass;
${COMMON}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uEye - vW);
  if (dot(n, v) < 0.) n = -n;
  float nv = max(dot(n, v), 0.);
  vec3 r = reflect(-v, n);
  float L = vMore.x;
  float mat = vCol.a;
  // (patterns are in the thing's own coordinates — along it in mm, round it — so they don't swim)
  vec2 q = vec2(vUA.x * L, vUA.y);
  float sd = vInfo.z;
  float backlit = pow(max(dot(-v, uLight), 0.), 2.);
  float lam = max(dot(n, uLight), 0.);
  vec3 base = vCol.rgb;
  vec3 col;
  if (mat < .5) {
    // chitin: a mite's shell — hard, polished, finely pitted; its dorsal shield darker, ringed by
    // a groove in from the margin; the margin thin enough to glow; the setae's sockets pale
    float pit = smoothstep(.62, .82, n2(q * vec2(180., 9.) + sd));
    float socket = smoothstep(.9, .97, n2(q * vec2(55., 3.) + sd * 3.));
    float shield = smoothstep(.0, .5, vUp);
    float groove = exp(-pow((vUp - .18) / .05, 2.)) * vMore.w;
    vec3 c = base * mix(1.1, .72, shield) * (1. - pit * .25) * (1. - groove * .5) + socket * .08;
    vec3 nb = normalize(n + (vec3(n2(q * 140. + 3.), n2(q * 140. + 9.), n2(q * 140.)) - .5) * .1);
    float rim = pow(1. - nv, 3.);
    col = c * (.16 + .62 * max(dot(nb, uLight), 0.)) * uLightCol;
    col += base * vec3(1.5, 1.05, .7) * rim * (.12 + backlit * 1.2) * uLightCol;
    vec3 rb = reflect(-v, nb);
    float fr = .04 + .96 * pow(1. - nv, 5.);
    col += env(rb) * (.05 + fr * .55) * .6;
    col += uLightCol * pow(max(dot(rb, uLight), 0.), 600.) * 7. + uLightCol * pow(max(dot(rb, uLight), 0.), 40.) * .12;
  } else if (mat < 1.5) {
    // a leg (or palp): paler, a little clear; dark at its joints; fine rings
    float j = abs(fract(vSeg + .5) - .5);
    float joint = 1. - smoothstep(.02, .12, j);
    vec3 c = base * (1. - joint * .45) * (.95 + .05 * sin(q.x * 300.));
    col = c * (.25 + .65 * lam + backlit * .6) * uLightCol;
    col += base * pow(1. - nv, 2.) * .35 * uLightCol;
    float fr = .04 + .96 * pow(1. - nv, 5.);
    col += env(r) * fr * .6 + uLightCol * pow(max(dot(r, uLight), 0.), 120.) * 4.;
  } else if (mat < 2.5) {
    // a seta: a fine hair, a glint along it
    col = base * (.35 + .55 * lam + backlit * .8) * uLightCol;
    col += uLightCol * pow(max(dot(r, uLight), 0.), 40.) * 1.5;
  } else if (mat < 3.5) {
    // a springtail: soft, granular (tubercles), velvety; paler between its segments; a violet
    // sheen where the light grazes it; a black patch of eyes each side of its head
    float gran = n2(q * vec2(260., 26.) + sd);
    vec3 nb = normalize(n + (vec3(n2(q * 300.), n2(q * 300. + 5.), n2(q * 300. + 9.)) - .5) * .5);
    float seg = 1. - smoothstep(.06, .25, abs(fract(vSeg * .5 + .5) - .5) * 2.);
    float mott = smoothstep(.35, .75, n2(q * vec2(30., 2.) + sd * 7.));
    vec3 c = base * (.75 + .5 * mott) * (.85 + .3 * gran);
    c = mix(c, base * 1.8 + .08, seg * vMore.y);
    float eye = vMore.z * smoothstep(.025, .0, abs(vUA.x - .145)) * smoothstep(.12, .0, abs(abs(cos(vUA.y)) - .93) - .02) * step(0., sin(vUA.y) + .3);
    c = mix(c, vec3(.02), eye);
    col = c * (.25 + .65 * max(dot(nb, uLight), 0.)) * uLightCol;
    col += mix(vec3(.45, .5, .9), base, .4) * pow(1. - nv, 2.2) * .55 * uLightCol;
    col += uLightCol * pow(max(dot(reflect(-v, nb), uLight), 0.), 25.) * .18;
  } else if (mat > 7.5) {
    // a leaf (clover's): its midrib and veins; a pale chevron across it; paler beneath; a waxy
    // sheen; the light through it
    float across = cos(vUA.y);
    float x = vUA.x;
    float mid = exp(-across * across * 120.);
    float veins = smoothstep(.6, 1., sin((x * 9. - abs(across) * 3.) * 6.2832));
    float chev = vMore.y * smoothstep(.07, .0, abs(x - (.42 + abs(across) * .22))) * smoothstep(.95, .4, abs(across));
    vec3 c = base * (1. + mid * .35 + veins * .12);
    c = mix(c, vec3(.62, .7, .5), chev * .7);
    if (vUp < 0.) c = c * 1.25 + .03;
    col = c * (.22 + .62 * lam) * uLightCol + c * vec3(.8, 1.2, .5) * backlit * 1.2 * uLightCol;
    float fr = .04 + .96 * pow(1. - nv, 5.);
    col += env(r) * (.05 + fr * .6) + uLightCol * pow(max(dot(r, uLight), 0.), 30.) * .35;
  } else if (mat > 6.5) {
    // a moss shoot: small pointed leaves in a close, irregular spiral, each catching the light
    // toward its tip, shadow between; ragged at its edge (the leaves stand off it); its new
    // growth at the top paler
    float jit = n2(vec2(q.x * 30., vUA.y * 3.) + sd) * .6;
    float spiral = fract(q.x * 22. + vUA.y / 6.2832 * 3.7 + jit + sd);
    float round_ = fract(vUA.y / 6.2832 * 7. + q.x * 5. + jit);
    if (nv < .45 && (spiral < .45 || round_ < .35)) discard;
    vec3 c = base * (.3 + .9 * spiral * (.8 + .4 * n2(q * vec2(60., 4.) + sd)));
    c = mix(c, base * 1.5 + vec3(.06, .06, 0.), smoothstep(.7, 1., vUA.x) * .6);
    col = c * (.25 + .6 * lam) * uLightCol + c * vec3(.9, 1.15, .5) * backlit * 1.3 * uLightCol;
    col += uLightCol * pow(max(dot(r, uLight), 0.), 40.) * .4 * spiral;
  } else if (mat > 5.5) {
    // a living blade of grass: a keel down its middle, fine veins either side, paler at its
    // sheath, a waxy sheen; the light through it green-gold; a grazed tip torn and browning
    float across = cos(vUA.y);
    float keel = exp(-across * across * 60.);
    float veins = .5 + .5 * cos(across * 34. + sd);
    float x = vUA.x;
    vec3 c = base * (.86 + .12 * veins) * mix(1., 1.25, keel * .5);
    c = mix(c * vec3(1.15, 1.18, .9) + .04, c, smoothstep(.0, .25, x));
    float torn = vMore.y * smoothstep(.86, 1., x);
    float brown = max(torn, vMore.z * smoothstep(.55, 1., x)) * (.6 + .4 * n2(vec2(q.x * 40., vUA.y * 3.)));
    c = mix(c, vec3(.55, .45, .22), brown);
    col = c * (.2 + .62 * lam) * uLightCol;
    col += c * vec3(.9, 1.2, .45) * backlit * 1.4 * uLightCol;
    float fr = .04 + .96 * pow(1. - nv, 5.);
    col += env(r) * (.06 + fr * .7) + uLightCol * (pow(max(dot(r, uLight), 0.), 24.) * .3 + pow(max(dot(r, uLight), 0.), 200.) * 1.5);
  } else if (mat > 4.5) {
    // a fragment of grass: veined lengthwise, its cells in rows, rotting in patches; thin enough
    // to glow with the light behind it; dull, a faint sheen where it's wet
    float vein = smoothstep(.55, 1., abs(sin(vUA.y * 7. + sd)));
    float cells = n2(vec2(q.x * 140., vUA.y * 16.) + sd);
    // (finer than a pixel: smoothed away, not aliased into bands)
    cells = mix(cells, .5, smoothstep(.25, .8, fwidth(q.x * 140.)));
    vein = mix(vein, .5, smoothstep(.25, .8, fwidth(vUA.y * 7.)));
    float rot = smoothstep(.5, .8, n2(vec2(q.x * 1.3, vUA.y * .6) + sd * 2.)) * .8;
    vec3 c = base * (.82 + .25 * vein) * (.85 + .3 * cells) * (1. - rot * .5);
    col = c * (.22 + .6 * lam + backlit * .9) * uLightCol;
    col += env(r) * (.03 + .5 * pow(1. - nv, 5.)) + uLightCol * pow(max(dot(r, uLight), 0.), 40.) * .12;
  } else {
    // a nematode: clear as glass, lit through; its gut a granular streak down its middle; a
    // clear bulb behind its head; light caught along its edges
    vec3 nvw = (uView * vec4(n, 0.)).xyz;
    vec2 uv = gl_FragCoord.xy / uRes;
    vec3 behind = through(uBehind, clamp(uv - nvw.xy * (1. - nv) * 10. / uRes, 0., 1.), 1. / uRes, 2.);
    float x = vUA.x;
    // (caught and killed: the fungus fills it — the gut fades, it goes milky, threaded inside)
    float filled = vMore.w;
    float gutz = smoothstep(.2, .3, x) * (1. - smoothstep(.82, .9, x)) * (1. - filled);
    float core = smoothstep(.3, .9, nv);
    float gran = n2(vec2(q.x * 160., vUA.y * 2.) + sd) * .6 + n2(vec2(q.x * 420., vUA.y * 4.)) * .4;
    vec3 gut = base * vec3(.62, .52, .36) * (.45 + .8 * gran);
    float bulb = exp(-pow((x - .17) / .025, 2.)) * core;
    vec3 c = behind * mix(vec3(.9, .91, .87), gut, gutz * core * .8);
    // (milky: its cuticle and body scatter some light back)
    float threads = smoothstep(.45, .8, n2(vec2(q.x * 90., vUA.y * 5.) + sd)) * filled;
    c = mix(c, base * uLightCol * (.35 + .4 * max(dot(n, uLight), 0.)) * (1. - threads * .25), mix(.2, .75, filled) * (.5 + .5 * core));
    c = mix(c, c * .7 + vec3(.04, .035, .03), bulb * .6);
    c += base * uLightCol * (.06 + .45 * backlit) * (.3 + .7 * pow(1. - nv, 1.5));
    float ann = .93 + .07 * sin(q.x * 320.);
    float fr = .04 + .96 * pow(1. - nv, 4.);
    c += env(r) * (.06 + fr) * .9 * ann;
    c += uLightCol * (pow(max(dot(r, uLight), 0.), 160.) * 8. + pow(max(dot(r, uLight), 0.), 20.) * .3) * ann;
    col = c;
  }
  o = vec4(col, 1.);
}`;

// spheres, instanced, scaled to ellipsoids: caps and spores (glossy dark), beads (glossy orange,
// light inside), crumbs (matte), mycelium tufts (hairy)
const SPHERE_VS = `#version 300 es
in vec3 aP;
in vec3 aC;
in vec3 aR;
in vec4 aCol;
uniform mat4 uVP;
uniform float uFocal;
out vec3 vW;
out vec3 vN;
out vec3 vO;
out vec4 vCol;
out float vPx;
void main() {
  vec3 w = aC + aP * aR;
  vW = w;
  vO = aP;
  vN = normalize(aP / aR);
  vCol = aCol;
  vec4 c = uVP * vec4(w, 1.);
  vPx = aR.x * uFocal / c.w;
  gl_Position = c;
}`;
const SOLID_FS = `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vN;
in vec3 vO;
in vec4 vCol;
out vec4 o;
${COMMON}
void main() {
  float kind = vCol.a;
  vec3 n = normalize(vN);
  vec3 v = normalize(uEye - vW);
  if (kind > 2.5) {
    // a tuft of mycelium: hairs, not a skin (the gaps let what's behind through)
    float hair = n2(vO.xz * 28. + vO.y * 9.) * .6 + n2(vec2(atan(vO.z, vO.x) * 9., vO.y * 40.)) * .4;
    if (hair < .5 + .35 * (1. - vO.y)) discard;
    float sheen = pow(1. - max(dot(n, v), 0.), 2.);
    o = vec4(vCol.rgb * (.55 + .45 * max(dot(n, uLight), 0.) + sheen * .6) * uLightCol, 1.);
    return;
  }
  // (a crumb's surface is rough: its normal wanders)
  if (kind > 1.5) n = normalize(n + (vec3(n3(vO * 9.), n3(vO * 9. + 4.), n3(vO * 9. + 9.)) - .5) * 1.2);
  vec3 r = reflect(-v, n);
  float f = .04 + .96 * pow(1. - max(dot(n, v), 0.), 5.);
  float diff = .3 + .7 * max(dot(n, uLight), 0.);
  float through = pow(max(dot(-v, uLight), 0.), 2.) * step(.5, kind) * step(kind, 1.5);
  vec3 col = vCol.rgb * (diff + through * 1.5) * uLightCol;
  if (kind > 1.5) { o = vec4(col * (.8 + .4 * n3(vO * 20.)), 1.); return; }
  col += env(r) * f;
  col += uLightCol * pow(max(dot(r, uLight), 0.), 120.) * 6.;
  o = vec4(col, 1.);
}`;
// see-through: droplets — a ball lens (the patch behind, upside down), a glint, a dark rim
const DROP_FS = `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vN;
in vec3 vO;
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
  vec3 behind = texture(uBehind, clamp(uv - nvw.xy * vPx * 1.6 / uRes, 0., 1.)).rgb;
  vec3 col = behind * vec3(.95, 1., .97) * (.75 + .5 * nv);
  col *= smoothstep(.05, .45, nv);
  vec3 r = reflect(-v, n);
  float f = .02 + .98 * pow(1. - nv, 5.);
  col += env(r) * f * 1.2;
  col += uLightCol * pow(max(dot(r, uLight), 0.), 300.) * 14.;
  col += uLightCol * pow(max(dot(-n, uLight), 0.), 24.) * .8;
  o = vec4(col, 1.);
}`;

// tubes: stalks and asci, along each one's curve (the same sums as genome.ts' along())
const STALK_VS = `#version 300 es
in vec2 aUA;
in vec3 aBase;
in vec4 aDir;     // dir.xz, lean, sag
in vec4 aShape;   // length now, foot radius, vesicle radius now, its length to width
in vec4 aMore;    // knob radius, wave, phase, slump
in vec4 aLook;    // yellow length, ripe, glassy, fuzz
uniform mat4 uVP;
out vec3 vW;
out vec3 vN;
out float vU;
out float vA;
flat out float vL;
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
  // (a negative length-to-width: no vesicle, but a start tipped that much toward dir — a hair)
  float tilt = aShape.w < 0. ? -aShape.w : 0.;
  vec3 p = aBase + vec3(dir.x * (lean * .5 * u * u + tilt * u) + side.x * w * .12, u - sag * u * u, dir.y * (lean * .5 * u * u + tilt * u) + side.y * w * .12) * L;
  vec3 t = normalize(vec3(dir.x * (lean * u + tilt), 1. - 2. * sag * u, dir.y * (lean * u + tilt)));
  vec3 s3 = vec3(side.x, 0., side.y);
  vec3 a = normalize(cross(t, s3));
  vec3 b = cross(t, a);
  float r = radiusAt(u);
  float dr = (radiusAt(min(1., u + .01)) - radiusAt(max(0., u - .01))) / (.02 * max(L, 1e-3));
  vec3 ring = a * cos(aUA.y) + b * sin(aUA.y);
  vN = normalize(ring - t * dr);
  vW = p + ring * r;
  vU = u;
  vA = aUA.y;
  vL = L;
  vLook = aLook;
  vSlump = aMore.w;
  gl_Position = uVP * vec4(vW, 1.);
}`;
const STALK_FS = `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vN;
in float vU;
in float vA;
flat in float vL;
flat in vec4 vLook;
flat in float vSlump;
out vec4 o;
uniform sampler2D uBehind;
uniform vec2 uRes;
uniform mat4 uView;
uniform vec3 uGlass, uTip, uVelvet;
uniform float uThrows;
${COMMON}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uEye - vW);
  if (dot(n, v) < 0.) n = -n;
  float nv = max(dot(n, v), 0.);
  float fuzz = vLook.w;
  // (fine lengthwise fibres, and hairs: the surface's own grain)
  float fibre = n2(vec2(vA * 9., vU * vL * .5 / uS));
  float hairs = smoothstep(.7, .92, n2(vec2(vA * 26., vU * vL * 3. / uS)));
  float top = smoothstep(1. - vLook.x - .03, 1. - vLook.x + .02, vU);
  float yellow = vLook.x <= 0. ? 0. : uThrows > .5 ? top * (1. - smoothstep(.0, .06, vU - (1. - vLook.x * .55))) + top * .12 : top;
  vec3 tint = mix(uGlass, uTip, clamp(yellow, 0., 1.));
  tint = mix(tint, vec3(.55, .5, .38), vSlump * .7);
  // glass: what's behind, bent toward its edges; the light through it
  vec3 nvw = (uView * vec4(n, 0.)).xyz;
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 behind = through(uBehind, clamp(uv - nvw.xy * (1. - nv) * 18. / uRes, 0., 1.), 1. / uRes, 4.);
  vec3 glass = behind * tint * (.75 + .3 * nv);
  float through = pow(max(dot(-v, uLight), 0.), 2.);
  glass += tint * uLightCol * (.1 + 1.1 * through) * (.2 + .8 * pow(1. - nv, 1.5)) * (.5 + yellow * .9);
  glass += tint * (.05 + .1 * (1. - nv)) * (1. - vSlump * .5);
  glass *= .92 + .16 * fibre;
  // velvet: pale and opaque, its hairs catching the light at its edges (a sheen), a glow behind
  vec3 vel = uVelvet * (.3 + .4 * max(dot(n, uLight), 0.)) * (.85 + .25 * fibre);
  vel = mix(vel, behind * uVelvet, .25);
  vel += uVelvet * pow(1. - nv, 2.) * (.2 + .35 * fuzz);
  vel += uVelvet * through * .25;
  vel += mix(vec3(.35), vec3(1.), min(1., dot(uVelvet, vec3(1.)))) * hairs * fuzz * .22 * (.4 + pow(1. - nv, 1.5));
  vel *= uLightCol;
  vec3 col = mix(vel, glass, vLook.z);
  vec3 r = reflect(-v, n);
  float f = .03 + .97 * pow(1. - nv, 4.);
  col += env(r) * f * mix(.15, .9, vLook.z);
  col += uLightCol * pow(max(dot(r, uLight), 0.), 160.) * 6. * vLook.z;
  o = vec4(col, 1.);
}`;

// an inkcap's bell: a surface of revolution, pleated, opening through the day, inking at its margin
const BELL_VS = `#version 300 es
in vec2 aTA;      // down from the apex (0..1), round (rad)
in vec3 aAt;      // where it sits (the stalk's top)
in vec3 aAxis;
in vec4 aB;       // radius, height, open, pleats
in vec4 aC;       // pleat depth, inked, seed, -
uniform mat4 uVP;
out vec3 vW;
out vec2 vTA;
flat out vec4 vB;
flat out vec4 vC;
float h(float x) { return fract(sin(x * 12.9898) * 43758.5453); }
void main() {
  float t = aTA.x, th = aTA.y;
  float open = aB.z;
  // an egg, a bell, then flatter: its margin, as an angle from the apex, opens out
  float amax = mix(2.25, 1.6, open);
  float al = t * amax;
  float R = aB.x * (.6 + .35 * open);
  float H = aB.y * (1.1 - .2 * open);
  // pleats: grooves from near the apex to the margin; the inked margin splits and curls
  float g = pow(abs(sin(aB.w * th * .5)), .6);
  float rr = 1. - aC.x * (1. - g) * smoothstep(.1, .55, t) * 6.;
  float ragged = aC.y * smoothstep(.7, 1., t) * (h(floor(th * aB.w / 6.2832 * 2.) + aC.z) * .25);
  vec3 axis = normalize(aAxis);
  vec3 side = normalize(cross(axis, abs(axis.y) > .9 ? vec3(1, 0, 0) : vec3(0, 1, 0)));
  vec3 side2 = cross(axis, side);
  vec3 ring = side * cos(th) + side2 * sin(th);
  float x = sin(al) * R * rr * (1. + ragged * .5);
  float y = (cos(al) - .25) * H + ragged * H * .6;
  vW = aAt + ring * x + axis * y;
  vTA = vec2(t, th);
  vB = aB;
  vC = aC;
  gl_Position = uVP * vec4(vW, 1.);
}`;
const BELL_FS = `#version 300 es
precision highp float;
in vec3 vW;
in vec2 vTA;
flat in vec4 vB;
flat in vec4 vC;
out vec4 o;
uniform vec3 uBell, uBellTop;
uniform float uSaucer, uVeil;
${COMMON}
void main() {
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  vec3 v = normalize(uEye - vW);
  if (dot(n, v) < 0.) n = -n;
  float t = vTA.x;
  float nv = max(dot(n, v), 0.);
  float ink = vC.y * smoothstep(1. - vC.y * .6, 1., t);
  vec3 c;
  if (uSaucer > .5) {
    // an eyelash cup, a saucer: inside, the hymenium, smooth, wet, bright; outside paler, downy
    vec3 col;
    if (!gl_FrontFacing) {
      c = uBell * (.85 + .15 * n2(vec2(vTA.y * 7., t * 12.))) * mix(.8, 1.1, t);
      float through = pow(max(dot(-v, uLight), 0.), 2.);
      col = c * (.35 + .55 * max(dot(n, uLight), 0.) + through * .4) * uLightCol;
      col += wetness(n, v, vW / uS, .7, 40.) * .6;
    } else {
      c = uBellTop * (.8 + .25 * n2(vec2(vTA.y * 30., t * 40.)));
      col = c * (.3 + .55 * max(dot(n, uLight), 0.)) * uLightCol + uBellTop * pow(1. - nv, 2.) * .3;
    }
    // (dying: it darkens and dries from the rim in)
    col *= 1. - vC.y * .75 * smoothstep(1. - vC.y, 1., t);
    o = vec4(col, 1.);
    return;
  }
  if (!gl_FrontFacing) {
    // its gills, seen from under it: fine and dark, darker as it ripens
    float gill = .5 + .5 * sin(vTA.y * vB.w * 3.);
    c = mix(uBell * .55, vec3(.25, .2, .17), .4 + .4 * vC.y) * (.7 + .3 * gill);
  } else {
    // pale, browner at the apex; the grooves a shade darker; fine grain along them
    c = mix(uBellTop, uBell, smoothstep(.0, .35, t));
    float g = pow(abs(sin(vB.w * vTA.y * .5)), .6);
    c *= .82 + .18 * g;
    c *= .92 + .12 * n2(vec2(vTA.y * vB.w * 1.5, t * 30.));
    // its veil: white, woolly, in patches and fibrils, thick on the young egg, pulled apart as
    // the cap opens, washed off toward the margin
    float open = vB.z;
    float patch_ = smoothstep(.36 + .2 * open, .5 + .2 * open, fbm(vec2(vTA.y * 5. + vC.z * 7., t * 9. * (1. + open))));
    float fib = smoothstep(.55, .9, n2(vec2(vTA.y * 70. + vC.z, t * 6.)));
    float veil = uVeil * (patch_ * .9 + fib * .4 * (1. - open) + (1. - open) * .35) * (1. - smoothstep(.6, .97, t));
    c *= mix(1., .62, uVeil * .7);
    c = mix(c, vec3(1.12, 1.1, 1.04) * (.8 + .3 * n2(vec2(vTA.y * 60., t * 50.))), clamp(veil, 0., 1.));
  }
  c = mix(c, vec3(.08, .07, .07), ink);
  // its flesh is thin: it glows when the light is behind it; a velvety sheen at its edges
  float through = pow(max(dot(-v, uLight), 0.), 2.) * (1. - ink);
  vec3 col = c * (.28 + .5 * max(dot(n, uLight), 0.) + through * .5) * uLightCol * (.75 + .25 * smoothstep(.0, .5, t));
  col += uBell * pow(1. - nv, 2.5) * .2 * (1. - ink);
  // (the ink is wet: it shines)
  col += wetness(n, v, vW / uS, ink * .8, 30.) * (.15 + ink);
  o = vec4(col, 1.);
}`;

// the jelly: a cushion, lumpy and wrinkled, lit from inside; what's in it shows through it
const JELLY_VS = `#version 300 es
in vec2 aPT;      // down from the top (0..1), round (rad)
in vec3 aC;
in vec4 aShape;   // radius, height, grown, seed
uniform mat4 uVP;
out vec3 vW;
out vec3 vO;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
out vec3 vN;
vec3 at(vec2 pt) {
  float a = pt.x * 2.3562;
  float th = pt.y;
  float R = aShape.x * aShape.z, H = aShape.y * aShape.z;
  vec3 ring = vec3(cos(th), 0., sin(th));
  vec3 p = aC + ring * sin(a) * R + vec3(0., (.5 + .5 * cos(a)) * H, 0.);
  vec3 n = normalize(ring * sin(a) * .5 * H + vec3(0., cos(a) * R, 0.) + vec3(0., 1e-4, 0.));
  // its lumps, and the wrinkles of its skin (round in th, so no seam)
  vec2 q = vec2(sin(th) * 2.5 + 3., cos(th) * 2.5 + pt.x * 4.) + aShape.w;
  float lump = (n2(q) - .5) * .16 + (n2(q * 3.1 + 5.) - .5) * .06 + (n2(q * 9. + 9.) - .5) * .02;
  return p + n * lump * R * (1. - pt.x * pt.x * .6);
}
void main() {
  vec3 p = at(aPT);
  // (its normal from the shape itself, so it's smooth however close the lens comes)
  float e = .004;
  vec3 dt = at(aPT + vec2(0., e)) - at(aPT - vec2(0., e));
  vec3 da = at(aPT + vec2(e, 0.)) - at(aPT - vec2(max(0., min(e, aPT.x)), 0.));
  vec3 n = cross(dt, da);
  if (aPT.x < .002) n = vec3(0., 1., 0.);
  if (dot(n, p - aC - vec3(0., aShape.y * aShape.z * .5, 0.)) < 0.) n = -n;
  vN = normalize(n);
  vW = p;
  vO = vec3(aPT.x, aPT.y, aShape.w);
  gl_Position = uVP * vec4(p, 1.);
}`;
const JELLY_FS = `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vO;
in vec3 vN;
out vec4 o;
uniform sampler2D uBehind;
uniform vec2 uRes;
uniform mat4 uView;
uniform vec3 uJelly, uDeep;
${COMMON}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(uEye - vW);
  if (dot(n, v) < 0.) n = -n;
  // (its skin's fine wrinkles, for the light)
  vec2 q = vec2(sin(vO.y) * 14. + 20., cos(vO.y) * 14. + vO.x * 22.) + vO.z;
  n = normalize(n + (vec3(n2(q), n2(q + 3.), n2(q + 7.)) - .5) * .5);
  float nv = max(dot(n, v), 0.);
  vec3 nvw = (uView * vec4(n, 0.)).xyz;
  vec2 uv = gl_FragCoord.xy / uRes;
  // through it: what's inside it (the asci, their spores), bent and drowned in its colour
  vec3 behind = through(uBehind, clamp(uv - nvw.xy * (1. - nv) * 22. / uRes, 0., 1.), 1. / uRes, 3.);
  vec3 tint = mix(uJelly, uDeep, smoothstep(.45, 1., vO.x));
  vec3 col = behind * mix(vec3(1.), tint, .75) * .95;
  // lit from inside: the light that gets in glows through it, and its body scatters it
  float through = pow(max(dot(-v, uLight), 0.), 1.5);
  col += tint * uLightCol * (.08 + .7 * through) * (.3 + .7 * (1. - nv));
  col += tint * tint * .1 * (.5 + .5 * n2(q * .3));
  col += wetness(n, v, vW / uS, 1., 60.) * 1.1;
  o = vec4(col, 1.);
}`;

// the far distance: a haze of green and warm light, with soft glows (leaves, light, far away)
const BACK_VS = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); gl_Position = vec4(p, .99999, 1.); }`;
const BACK_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uRes;
uniform vec3 uLightCol, uSky, uWarm;
uniform float uSeed, uYaw;
float h(float x) { return fract(sin(x * 12.9898 + 78.233) * 43758.5453); }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec3 c = mix(uSky * .12, uSky * .28 + uWarm * .07, smoothstep(.15, 1., uv.y));
  // (they drift a little as the view turns: they're far, not painted on the lens)
  for (int i = 0; i < 9; i++) {
    float f = float(i) + uSeed;
    vec2 at = vec2(fract(h(f) - uYaw * .12), .35 + .7 * h(f + 3.));
    float r = .12 + .25 * h(f + 7.);
    float d = length((uv - at) * vec2(aspect, 1.));
    vec3 tint = mix(uSky * 1.3, uWarm, h(f + 11.));
    c += tint * smoothstep(r, r * .2, d) * (.04 + .09 * h(f + 13.));
  }
  o = vec4(c, 1.);
}`;

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
const bellProg = program(BELL_VS, BELL_FS);
const jellyProg = program(JELLY_VS, JELLY_FS);
const dofProg = program(QUAD_VS, DOF_FS);
const backProg = program(BACK_VS, BACK_FS);
const limbProg = program(LIMB_VS, LIMB_FS);
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
/** A grid over (0..1) × (0..2π), as triangles: the parameter space of a tube, a bell, a cushion. */
function grid(n: number, m: number, warp = (x: number) => x): number[] {
  const v: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const [u0, u1] = [warp(i / n), warp((i + 1) / n)];
    const [a0, a1] = [(j / m) * Math.PI * 2, ((j + 1) / m) * Math.PI * 2];
    v.push(u0, a0, u1, a0, u1, a1, u0, a0, u1, a1, u0, a1);
  }
  return v;
}
/** A mesh (its vertices static) with an instance buffer, for one program. */
function instanced(prog: WebGLProgram, verts: number[], vattr: Array<[string, number]>, iattr: Array<[string, number]>) {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const b = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  const vs = vattr.reduce((s, a) => s + a[1], 0);
  attribs(prog, vattr, vs, 0);
  const inst = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, inst);
  const stride = iattr.reduce((s, a) => s + a[1], 0);
  attribs(prog, iattr, stride, 1);
  gl.bindVertexArray(null);
  return { vao, inst, count: verts.length / vs, stride };
}
function draw(m: ReturnType<typeof instanced>, data: number[]) {
  if (!data.length) return;
  gl.bindVertexArray(m.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, m.inst);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STREAM_DRAW);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, data.length / m.stride);
}
// the ground: a disc of grid, finer near the middle
const groundVao = gl.createVertexArray()!;
let groundCount = 0;
{
  gl.bindVertexArray(groundVao);
  const v: number[] = [];
  const R = 70;
  const n = 200;
  const at = (i: number, j: number) => {
    const k = (a: number) => Math.sign(a) * Math.pow(Math.abs(a), 1.7) * R;
    return [k((i / n) * 2 - 1), k((j / n) * 2 - 1)];
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
/** a sphere's triangles, so many rings by so many segments */
function sphere(la: number, lo: number): number[] {
  const out: number[] = [];
  const p = (i: number, j: number) => {
    const t = (i / la) * Math.PI;
    const f = (j / lo) * Math.PI * 2;
    return [Math.sin(t) * Math.cos(f), Math.cos(t), Math.sin(t) * Math.sin(f)];
  };
  for (let i = 0; i < la; i++) for (let j = 0; j < lo; j++) {
    out.push(...p(i, j), ...p(i + 1, j), ...p(i + 1, j + 1), ...p(i, j), ...p(i + 1, j + 1), ...p(i, j + 1));
  }
  return out;
}
const sphereVerts = sphere(16, 24);
const SPH: Array<[string, number]> = [['aC', 3], ['aR', 3], ['aCol', 4]];
const solids = instanced(solidProg, sphereVerts, [['aP', 3]], SPH);
// (the many small ones — legs, spores, nematodes — coarser: they're a few pixels)
const solidsLo = instanced(solidProg, sphere(6, 8), [['aP', 3]], SPH);
const SMALL = 0.06;
// the limbs: their rows in a float texture; three meshes, by how near
const MAXROWS = Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
const rowsTex = gl.createTexture()!;
gl.bindTexture(gl.TEXTURE_2D, rowsTex);
gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, ROWW, MAXROWS);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.bindTexture(gl.TEXTURE_2D, null);
function limbMesh(n: number, m: number) {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const b = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  const v = grid(n, m);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  attribs(limbProg, [['aUA', 2]], 2, 0);
  gl.bindVertexArray(null);
  return { vao, count: v.length / 2 };
}
const limbHi = limbMesh(44, 14);
const limbMid = limbMesh(16, 7);
const limbLo = limbMesh(6, 4);
// (grass blades: long, flat — many rows along, few round)
const bladeHiMesh = limbMesh(22, 4);
const bladeLoMesh = limbMesh(9, 4);
const ROWF = ROWW * 4;
/** Put the frame's limbs in the texture, in the order they're drawn; where each list starts. */
function uploadLimbs(l: Limbs) {
  const lists = [l.hi, l.mid, l.lo, l.bladeHi, l.bladeLo, l.glassHi, l.glassMid];
  const starts: number[] = [];
  let rows = 0;
  for (const x of lists) {
    starts.push(rows);
    rows += x.length / ROWF;
  }
  rows = Math.min(rows, MAXROWS);
  if (rows) {
    const data = new Float32Array(rows * ROWF);
    let o = 0;
    for (const x of lists) {
      const k = Math.min(x.length, data.length - o);
      data.set(x.length > k ? x.slice(0, k) : x, o);
      o += k;
    }
    gl.bindTexture(gl.TEXTURE_2D, rowsTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ROWW, rows, gl.RGBA, gl.FLOAT, data);
  }
  return { starts, counts: lists.map((x, i) => Math.max(0, Math.min(x.length / ROWF, MAXROWS - starts[i]))) };
}
function drawLimbs(m: { vao: WebGLVertexArrayObject; count: number }, start: number, count: number) {
  if (count <= 0) return;
  gl.uniform1i(u(limbProg, 'uOffset'), start);
  gl.bindVertexArray(m.vao);
  gl.drawArraysInstanced(gl.TRIANGLES, 0, m.count, count);
}
void MAXP;
const drops = instanced(dropProg, sphereVerts, [['aP', 3]], SPH);
const dropsLo = instanced(dropProg, sphere(5, 8), [['aP', 3]], SPH);
const tubes = instanced(stalkProg, grid(48, 16, (k) => 1 - Math.pow(1 - k, 1.5)), [['aUA', 2]], [['aBase', 3], ['aDir', 4], ['aShape', 4], ['aMore', 4], ['aLook', 4]]);
// (fine hairs: the same tube, far fewer rings)
const hairs = instanced(stalkProg, grid(5, 4), [['aUA', 2]], [['aBase', 3], ['aDir', 4], ['aShape', 4], ['aMore', 4], ['aLook', 4]]);
const bells = instanced(bellProg, grid(40, 112), [['aTA', 2]], [['aAt', 3], ['aAxis', 3], ['aB', 4], ['aC', 4]]);
const jellies = instanced(jellyProg, grid(48, 96), [['aPT', 2]], [['aC', 3], ['aShape', 4]]);
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

// ─── the specimen: one species, or a terrarium of them ─────────────────────────────────────────
/** one of the species in view: its genome, its stalks and its cups, its scale */
interface Sp {
  g: Genome;
  stalks: Stalk[];
  cups: Cushion[];
  S: number;
  pat?: Pat;
}
let world: Sp[] = [];
/** the pats, all together: their moments and marks (`species` and the grid aren't used) */
let terr: Terrarium | null = null;
/** the animals, all together */
let crit: Critters | null = null;
/** a pat in play: simulated, in place; its litter and its straw */
interface Pat extends Placed {
  bits: ReturnType<typeof litter>;
  blades: Blade[];
}
let pats: Pat[] = [];
/** the field's sun (every pat's stalks lean to it) */
let sun: V3 = [0.5, 0.8, 0.3];
/** the lead species: its light, its warmth, its ground */
let g: Genome;
let bits: ReturnType<typeof litter>;
let blades: Blade[] = [];
/** the beads' colour: the lead species' orange, browned in the dung */
let beadColour: V3 = [0.5, 0.3, 0.1];
/** the scale of things: the noise and the ground go by it (1: a thrower 8 mm tall) */
let S = 1;
/** The ground's height at (x, z) (mm): the ground's vertex shader's sums, so things stand on it. */
function groundY(x: number, z: number): number {
  const fr = (v: number) => v - Math.floor(v);
  // (the shader's hash, step by step in its precision: a hash of sin() isn't the same in both)
  const f = Math.fround;
  const h = (a: number, b: number) => {
    const x = fr(f(a * f(0.1031)));
    const y = fr(f(b * f(0.1031)));
    const z = x;
    const d = f(f(f(x * f(y + f(33.33))) + f(y * f(z + f(33.33)))) + f(z * f(x + f(33.33))));
    const X = f(x + d);
    const Y = f(y + d);
    const Z = f(z + d);
    return fr(f(f(X + Y) * Z));
  };
  const n2 = (a: number, b: number) => {
    const ix = Math.floor(a);
    const iz = Math.floor(b);
    const fx = a - ix;
    const fz = b - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uz = fz * fz * (3 - 2 * fz);
    const lo = h(ix, iz) + (h(ix + 1, iz) - h(ix, iz)) * ux;
    const hi = h(ix, iz + 1) + (h(ix + 1, iz + 1) - h(ix, iz + 1)) * ux;
    return lo + (hi - lo) * uz;
  };
  const px = x / S;
  const pz = z / S;
  const hgt = (n2(px * 0.18, pz * 0.18) - 0.5) * 1.4 + (n2(px * 0.6 + 7, pz * 0.6 + 7) - 0.5) * 0.55 + (n2(px * 1.9 + 3, pz * 1.9 + 3) - 0.5) * 0.18;
  const l = Math.hypot(px, pz);
  const t = Math.max(0, Math.min(1, (l - 20) / 50));
  return (hgt - (pasture ? 0 : t * t * (3 - 2 * t) * 3)) * S + mound(x, z);
}
/** The grass's view of the pats: rank grass in a ring round each (cattle won't graze by their
 *  dung), smothered under one, back over an old one. */
const field: Field = {
  groundY,
  rank(x, z) {
    let k = 0.06;
    for (const p of pats) {
      const age = T - p.drop;
      if (age < -1) continue;
      const dx = x - p.x;
      const dz = z - p.z;
      const r = Math.hypot(dx, dz);
      if (r > 110) continue;
      const d = r - patEdge(p.terr.lumps, Math.atan2(dz, dx));
      const ring = Math.max(0, Math.min(1, (d + 2) / 8)) * (1 - Math.max(0, Math.min(1, (d - 35) / 40)));
      k = Math.max(k, ring * 0.85);
    }
    return k;
  },
  under(x, z) {
    let k = 1;
    for (const p of pats) {
      const age = T - p.drop;
      if (age < 0) continue;
      const dx = x - p.x;
      const dz = z - p.z;
      const r = Math.hypot(dx, dz);
      if (r > 30) continue;
      const d = r - patEdge(p.terr.lumps, Math.atan2(dz, dx));
      if (d > 0.5) continue;
      const back = Math.max(0, Math.min(1, (age - 30 * 24) / (25 * 24)));
      k = Math.min(k, Math.max(back, Math.max(0, Math.min(1, d / 0.5 + 1)) * 0.3));
    }
    return k;
  },
};
/** The pats' mounds at (x, z): the ground shader's sums. */
function mound(x: number, z: number) {
  let h = 0;
  for (const p of pats) {
    const H = patHeight(T - p.drop);
    if (H <= 0) continue;
    const dx = x - p.x;
    const dz = z - p.z;
    const r = Math.hypot(dx, dz);
    if (r > 34) continue;
    const e = patEdge(p.terr.lumps, Math.atan2(dz, dx));
    const k = Math.max(0, Math.min(1, ((e - r) / e + 0.08) / 0.48));
    h += H * k * k * (3 - 2 * k);
  }
  return h;
}
/** Stand everything on the ground. */
function settle() {
  for (const sp of world) {
    for (const st of sp.stalks) st.base[1] = groundY(st.base[0], st.base[2]) - st.r * 0.5;
    for (const c of sp.cups) c.c[1] = groundY(c.c[0], c.c[2]) - c.Hc * 0.15;
  }
  for (const b of bits.beads) b.p[1] = groundY(b.p[0], b.p[2]) - b.r * b.flat * 0.35;
  for (const c of bits.crumbs) c.p[1] = groundY(c.p[0], c.p[2]) + c.r[1] * 0.2;
  for (const p of bits.pools) p.p[1] = groundY(p.p[0], p.p[2]);
  for (const m of terr?.marks ?? []) if (m.ground) m.p[1] = groundY(m.p[0], m.p[2]) + (m.kind === 'cap' ? m.r * 0.25 : 0);
}
/** where the field's camera started: the pat it came to */
let home: Drop = { seed: 1, x: 0, z: 0, drop: 0 };
let tArrive = 0;
/** how much a pat has going on now: its fungi up (a few days in) beats new or old */
function interest(d: Drop) {
  const age = (T - d.drop) / 24;
  return (age > 2 && age < 20 ? 2 : age > 0 && age < 21 ? 1 : 0) - Math.hypot(d.x, d.z) / 300;
}
function loadPat(d: Drop): Pat {
  const p = place(d, pasture ? sun : undefined);
  const g0 = p.terr.species[0].g;
  const bits = litter(d.seed, { ...g0, patch: 20, scale: 5, beads: Math.min(g0.beads, 50) });
  for (const b of [...bits.beads, ...bits.crumbs, ...bits.pools]) {
    b.p[0] += d.x;
    b.p[2] += d.z;
  }
  const blades = straw(d.seed, pasture ? 22 : 30, pasture ? 300 : 420);
  for (const b of blades) for (const q of b.pts) {
    q[0] += d.x;
    q[1] += d.z;
  }
  return { ...p, bits, blades };
}
/** The pats within reach of where the camera is: keep those still there, load what's come into
 *  reach (one a call, but for the first), let go of the rest. True if the set changed. */
let lastRefresh = 0;
function refreshPats(all = false): boolean {
  const at = pats.length ? cur.look : [home.x, 0, home.z];
  // (at first only the near ones, so it starts quickly; the rest come in a second at a time)
  const want = dropsNear(seed, at[0], at[2], T, all ? 90 : 190).filter((d) => T - d.drop < PAT_GONE);
  const keep = all ? [] : pats.filter((p) => want.some((d) => d.seed === p.seed));
  let changed = keep.length !== pats.length;
  const missing = want.filter((d) => !keep.some((p) => p.seed === d.seed)).sort((a, b) => Math.hypot(a.x - at[0], a.z - at[2]) - Math.hypot(b.x - at[0], b.z - at[2]));
  for (const d of all ? missing : missing.slice(0, 1)) {
    keep.push(loadPat(d));
    changed = true;
  }
  pats = keep;
  return changed;
}
/** All the pats' things together: the species (with their moments' indices moved to suit), the
 *  animals, the marks, the litter and the straw. */
function combine() {
  const prevWorld = world;
  const prevCrit = crit;
  world = [];
  const moments: Moment[] = [];
  const marks: Terrarium['marks'] = [];
  const all: Critters = { worms: [], mites: [], springs: [], traps: [], moments: [] };
  bits = { beads: [], crumbs: [], pools: [] };
  blades = [];
  const follows: Array<{ m: Moment; pat: number; q: number }> = [];
  const offs: Array<{ mites: number; springs: number; nm: number }> = [];
  pats.forEach((p, i) => {
    const off = world.length;
    world.push(...p.terr.species.map((x) => ({ g: x.g, stalks: x.stalks, cups: x.cups, S: scaleOf(x.g), pat: p })));
    for (const m of p.terr.moments) moments.push({ ...m, who: m.who >= 0 ? m.who + off : -1 });
    offs.push({ mites: all.mites.length, springs: all.springs.length, nm: p.crit.mites.length });
    for (const m of p.crit.moments) {
      const c = { ...m };
      moments.push(c);
      if (m.follow !== undefined) follows.push({ m: c, pat: i, q: m.follow });
    }
    all.worms.push(...p.crit.worms);
    all.mites.push(...p.crit.mites);
    all.springs.push(...p.crit.springs);
    all.traps.push(...p.crit.traps);
    marks.push(...p.terr.marks);
    bits.beads.push(...p.bits.beads);
    bits.crumbs.push(...p.bits.crumbs);
    bits.pools.push(...p.bits.pools);
    blades.push(...p.blades);
  });
  // (an animal to follow: its index among all the mites, then all the springtails)
  for (const f of follows) {
    const o = offs[f.pat];
    f.m.follow = f.q < o.nm ? o.mites + f.q : all.mites.length + o.springs + (f.q - o.nm);
  }
  crit = all;
  terr = { species: [], ground: [], moments, dung: new Float32Array(0), marks, lumps: [] };
  if (!world.length) world = [{ g: species(seed, 'thrower'), stalks: [], cups: [], S: 1 }];
  g = world[0].g;
  if (pasture) for (const sp of world) sp.g.light = sun;
  // (the shot carries on, if what it's on is still here)
  if (shot && shot.who >= 0) {
    const was = prevWorld[shot.who];
    shot.who = world.findIndex((x) => x.g === was?.g);
    if (shot.who < 0) shot = null;
  }
  if (shot && shot.follow !== undefined && prevCrit) {
    const pm = prevCrit.mites.length;
    const obj = shot.follow < pm ? prevCrit.mites[shot.follow] : prevCrit.springs[shot.follow - pm];
    const i = all.mites.indexOf(obj as Critters['mites'][number]);
    const j = all.springs.indexOf(obj as Critters['springs'][number]);
    shot.follow = i >= 0 ? i : j >= 0 ? all.mites.length + j : undefined;
  }
  labelled = '';
}
const scaleOf = (x: Genome) => (x.form === 'cup' ? x.cushion / 4 : x.form === 'eyelash' ? x.bell / 4 : x.form === 'flask' ? 0.3 : x.scale / 8);
function grow(s: number) {
  seed = s;
  if (one) {
    g = species(seed, (FORMS as string[]).includes(params.get('form') ?? '') ? (params.get('form') as Form) : undefined);
    world = [{ g, stalks: patch(seed, g), cups: cushions(seed, g), S: scaleOf(g) }];
    terr = null;
    // (`&critter=`: an animal on its own, under the lens)
    crit = params.get('critter') ? zoo(params.get('critter')!, seed) : null;
    if (crit) world[0].stalks = world[0].cups = [];
    bits = litter(seed, g);
    blades = straw(seed, g.patch * 1.5, Math.round(g.patch * 12));
    S = scaleOf(g);
  } else {
    S = 1;
    pats = [];
    if (pasture) {
      // the field at the world's hour now (`?now=` an hour of its own; `?t=` hours from now)
      T = (Number(params.get('now')) || worldNow()) + (Number(params.get('t')) || 0);
      // (`?hour=6.5`: the last time it was that hour)
      if (params.get('hour')) T -= ((((21 + T) % 24) - Number(params.get('hour'))) % 24 + 24) % 24;
      tArrive = T;
      sun = norm3([Math.cos(seed * 1.7) * 0.8, 1, Math.sin(seed * 1.7) * 0.8]);
      // (start on a pat with something going on: the nearest whose fungi are up)
      // (`?age=`: start on the pat nearest that many days old)
      const want = Number(params.get('age'));
      const near = dropsNear(seed, 0, 0, T, 260).sort((a, b) => (want ? Math.abs((T - a.drop) / 24 - want) - Math.abs((T - b.drop) / 24 - want) : interest(b) - interest(a)));
      home = near[0] ?? { seed: 1, x: 0, z: 0, drop: T - 100, };
      refreshPats(true);
    } else {
      T = 0;
      pats = [loadPat({ seed, x: 0, z: 0, drop: 0 })];
    }
    combine();
  }
  beadColour = mixV(g.bead, [0.22, 0.14, 0.07], 0.45);
  settle();
  if (!terr) T = 0;
  focusAt = null;
  subject = -1;
  shot = null;
  focus = crit && !terr ? 3.4 : 30 * S;
  setView();
  cur.look = [...view.look] as V3;
  cur.dist = view.dist;
  const url = new URL(location.href);
  url.searchParams.set('seed', String(seed));
  if (!preview) history.replaceState(null, '', url);
  labelled = '';
  label();
}
/** a species, in a few words */
function kindOf(x: Genome) {
  return {
    thrower: `throws its sporangia · ${x.vesicle > 0.8 ? 'a great vesicle' : 'a vesicle'} · ${x.height[1].toFixed(0)} mm`,
    pin: `a pin mould · yellow-headed · ${x.height[1].toFixed(0)} mm`,
    inkcap: `an inkcap · ${x.pleats} pleats · ${x.height[1].toFixed(0)} mm`,
    cup: `a jelly cup · fires its asci · ${(x.cushion * 2).toFixed(1)} mm`,
    eyelash: `an eyelash cup · ${x.hairs} hairs · ${(x.bell * 2).toFixed(1)} mm`,
    flask: `flask fungi · shoot their spores · ${x.height[1].toFixed(1)} mm`,
  }[x.form];
}
let labelled = '';
/** an age in days, in words */
function ageWords(d: number) {
  if (d < 1) return 'less than a day';
  if (d < 14) return `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'}`;
  return `${Math.floor(d / 7)} weeks`;
}
function label() {
  const el = document.getElementById('label');
  if (!el) return;
  if (!terr) {
    el.innerHTML = `<i>${g.name}</i><span>${kindOf(g)}</span>`;
    return;
  }
  // a terrarium: the species the lens is on (or, between, the terrarium's cast)
  const who = shot?.who ?? -1;
  const kind = shot?.kind ?? '';
  const key = `${who}:${kind === 'graze' || kind === 'ride' || kind === 'stuck' || kind === 'trap' || kind === 'field' || kind === 'dew' || ['moss', 'dungmoss', 'clover', 'web'].includes(kind) ? kind : ''}:${pasture && who < 0 ? patNear(view.look)?.seed : ''}`;
  if (key === labelled) return;
  labelled = key;
  if (kind === 'graze') el.innerHTML = `<i>mites and springtails</i><span>grazing the mycelium</span>`;
  else if (kind === 'moss') el.innerHTML = `<i>a moss</i><span>a cushion of shoots, its capsules nodding on red setae</span>`;
  else if (kind === 'dungmoss') el.innerHTML = `<i>a dung moss</i><span>on an old pat · its umbrellas, the colour and the smell to bring flies</span>`;
  else if (kind === 'clover') el.innerHTML = `<i>white clover</i><span>its leaves on long stalks, a pale chevron on each leaflet</span>`;
  else if (kind === 'web') el.innerHTML = `<i>a money spider's sheet</i><span>low in the grass, silver with dew</span>`;
  else if (kind === 'dew') el.innerHTML = `<i>dew</i><span>on the grass at the pat's edge, before the sun's on it</span>`;
  else if (kind === 'trap') el.innerHTML = `<i>a nematode-trapping fungus</i><span>its sticky loops, and a nematode, caught</span>`;
  else if (kind === 'field') {
    const ages = pats.filter((p) => T >= p.drop).map((p) => (T - p.drop) / 24);
    el.innerHTML = `<i>a pasture</i><span>${ages.length} pats in reach · ${ageWords(Math.min(...ages))} to ${ageWords(Math.max(...ages))} old</span>`;
  } else if (who < 0 && pasture) {
    const p = patNear(view.look);
    const here = p ? world.filter((x) => x.pat === p) : [];
    const done = p && T - p.drop > PAT_LIFE;
    el.innerHTML = `<i>a pat, ${p ? ageWords((T - p.drop) / 24) : ''} old</i><span>${done ? 'its fungi done; crusted, the grass coming back over it' : here.map((x) => x.g.name).join(' · ')}</span>`;
  } else if (who < 0) el.innerHTML = `<i>a terrarium</i><span>${world.map((x) => x.g.name).join(' · ')}</span>`;
  else if (kind === 'ride') el.innerHTML = `<i>${world[who].g.name}</i><span>and a nematode, climbing, to be thrown with it</span>`;
  else if (kind === 'stuck') el.innerHTML = `<i>${world[who].g.name}</i><span>and a sporangium, thrown, stuck to it</span>`;
  else el.innerHTML = `<i>${world[who].g.name}</i><span>${kindOf(world[who].g)} · one of ${world.filter((x) => x.pat === world[who].pat).length} here</span>`;
}

// ─── the day ────────────────────────────────────────────────────────────────────────────────────
let T = 0;
let playing = true;
/** how long it runs (h): a day for one species, three weeks for a terrarium */
const span = () => (terr ? DAYS * 24 : DAY);
/** hours a second: a day in under a minute; a terrarium's three weeks in about eight */
const rate = () => (terr ? (preview ? 4 : 1.05) : DAY / (preview ? 40 : 55));
/** the field's scrubber: four weeks, two either side of when you came (moving on as time does) */
const WINDOW = 28 * 24;
const windowStart = () => tArrive - WINDOW / 2;
const scrub = document.getElementById('scrub') as HTMLInputElement | null;
scrub?.addEventListener('input', () => {
  T = pasture ? windowStart() + (Number(scrub.value) / 1000) * WINDOW : (Number(scrub.value) / 1000) * span();
  shot = null;
});

// ─── the view ───────────────────────────────────────────────────────────────────────────────────
let yaw = 0.4;
let pitch = 0.36;
let zoom = 1;
let focus = 30;
let focusAt: { at: () => V3; until: number } | null = null;
let autoFocus = 0;
let subject = -1;
const FOV = 0.55;
/** where the camera wants to look, and from how far; and where it is now, on its way there */
const view = { look: [0, 0, 0] as V3, dist: 30, pitch: 0.36, aperture: 1 };
const cur = { look: [0, 0, 0] as V3, dist: 30, aperture: 1 };
function setView() {
  if (pasture) {
    view.look = [home.x, 4, home.z];
    view.dist = 62;
    groundCentre = [home.x, home.z];
    return;
  }
  if (terr) {
    view.look = [0, 4, 0];
    view.dist = 62;
    return;
  }
  if (crit) {
    view.look = [0, 0.3, 0];
    view.dist = 3.2;
    return;
  }
  const mid = g.form === 'cup' ? g.cushion * 2.6 : g.form === 'eyelash' ? g.bell * 1.6 : g.form === 'flask' ? 1.4 : (g.height[0] + g.height[1]) / 2;
  view.look = [0, mid * (g.form === 'cup' ? 0.45 : 0.55), 0];
  view.dist = mid * 2.3 + 4 * S;
}
function camera(t: number) {
  const aspect = W / Hh;
  const look = cur.look;
  const d = cur.dist / zoom / Math.min(1.2, Math.max(0.75, aspect * 1.4));
  const y = yaw + Math.sin(t * 0.05) * 0.15 + shake * 0.012 * Math.sin(t * 57);
  const pt = pitch + shake * 0.01 * Math.cos(t * 49);
  const eye: V3 = [look[0] + Math.cos(pt) * Math.cos(y) * d, look[1] + Math.sin(pt) * d, look[2] + Math.cos(pt) * Math.sin(y) * d];
  const f = norm3(sub3(look, eye));
  const r = norm3(cross3(f, [0, 1, 0]));
  const up = cross3(r, f);
  const near = Math.max(0.02, d * 0.03);
  const far = d * 14;
  const tt = 1 / Math.tan(FOV / 2);
  const view = new Float32Array([r[0], up[0], -f[0], 0, r[1], up[1], -f[1], 0, r[2], up[2], -f[2], 0, -dot3(r, eye), -dot3(up, eye), dot3(f, eye), 1]);
  const proj = [tt / aspect, 0, 0, 0, 0, tt, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  return { eye, f, r, up, view, vp: mul(proj, view), near, far, aspect, focal: (Hh / 2) * tt, d };
}

// ─── the director: in a terrarium, the camera goes to what's about to happen ────────────────────
/** the shot: what it's on (whose), where to look and from how far, until when */
let shot: { look: V3; dist: number; until: number; who: number; kind: string; follow?: number } | null = null;
/** a hand on the view: the director waits */
let handsOn = -1e9;
let lastKind = '';
/** (`?moment=ink`: only that sort) */
const only = params.get('moment') ?? '';
function direct(dt: number) {
  if (!terr && crit) {
    // (the zoo: the lens on the animal, focused on it)
    const p = whereIs(crit, 0, T, time, groundY);
    if (p) {
      view.look = p;
      view.aperture = 0.6;
      focusAt = { at: () => whereIs(crit!, 0, T, time, groundY) ?? p, until: time + 5 };
    }
    return;
  }
  if (!terr) return;
  // (on an animal: the lens goes with it)
  if (shot?.follow !== undefined && crit && time >= handsOn + 20) {
    const p = whereIs(crit, shot.follow, T, time, groundY);
    if (p) view.look = p;
  }
  if (time < handsOn + 20) return;
  if (!shot || T > shot.until) {
    // the next moment worth seeing: soon, and not the same sort of thing as the last
    let best: Moment | null = null;
    let score = -1e9;
    for (const m of terr.moments) {
      const lead = m.T - T;
      if (lead < 0.4 || lead > 3.5) continue;
      if (only && m.kind !== only) continue;
      // (an emergence is better caught under way than waited for)
      // (in the field: nearer is better — a long way to go for a moment loses it)
      const far = pasture ? Math.hypot(m.at[0] - cur.look[0], m.at[2] - cur.look[2]) / 90 : 0;
      const sc = -lead * 0.5 - far + (m.kind === lastKind ? -0.8 : 0) + (m.kind === 'throw' || m.kind === 'fire' ? 0.4 : 0) + (m.kind === 'emerge' && lead > 1.5 ? -0.6 : 0) + Math.random() * 0.5;
      if (sc > score) {
        score = sc;
        best = m;
      }
    }
    // (`?moment`: always a moment, never a breath — for looking at them)
    // (`?shot=field` or `wide`: only that, for looking at it)
    const force = params.get('shot');
    if (force) best = null;
    if (best && (params.has('moment') || Math.random() < 0.85)) {
      shot = { look: best.at, dist: best.size * 2.6 + 3, until: best.T + (best.kind === 'ink' || best.kind === 'stuck' || best.kind === 'graze' || best.kind === 'trap' ? 3 : 1.2), who: best.who, kind: best.kind, follow: best.follow };
      // (an animal: from above, over what's in the way; else low, in among them)
      view.pitch = best.kind === 'graze' || best.kind === 'trap' ? 0.6 + Math.random() * 0.25 : 0.22 + Math.random() * 0.2;
      view.aperture = best.kind === 'graze' ? 0.7 : 1;
      lastKind = best.kind;
    } else if (pasture && (force ? ['moss', 'dungmoss', 'clover', 'web'].includes(force) : Math.random() < 0.18) && floraShot(force as FloraKind | null)) {
      // (the pasture's other life, now and then: moss, dung moss on an old pat, clover, a web)
    } else if (pasture && force !== 'wide' && force !== 'field' && (force === 'dew' || Math.random() < 0.35) && dewy() > 0.5 && dewBlade()) {
      // (at dawn, now and then: the dew on a blade at the pat's edge)
      const at = dewBlade()!;
      shot = { look: at, dist: 16 + Math.random() * 8, until: T + 1.5, who: -1, kind: 'dew' };
      view.pitch = 0.1 + Math.random() * 0.15;
      view.aperture = 1;
      lastKind = 'dew';
    } else if (pasture && force !== 'wide' && (force === 'field' || Math.random() < 0.3)) {
      // (in the field, now and then: the lie of it — pats in the grass, from up and back)
      const p = patNear(cur.look);
      const at: V3 = p ? [p.x, groundY(p.x, p.z) + 6, p.z] : [...cur.look];
      shot = { look: at, dist: 110 + Math.random() * 50, until: T + 3, who: -1, kind: 'field' };
      view.pitch = 0.78 + Math.random() * 0.2;
      view.aperture = 0.15;
      lastKind = 'field';
    } else {
      // (nothing coming, or a breath between: what's up now, from a little above — in the field,
      // on the pat with most going on near here)
      const p = pasture ? livelyPat() : null;
      const live = livePlaces().filter((q) => !p || Math.hypot(q[0] - p.x, q[2] - p.z) < 40);
      const c: V3 = live.length ? [live.reduce((s, q) => s + q[0], 0) / live.length, 3, live.reduce((s, q) => s + q[2], 0) / live.length] : p ? [p.x, groundY(p.x, p.z) + 2, p.z] : [0, 2, 0];
      const spread = live.length ? Math.max(...live.map((p) => Math.hypot(p[0] - c[0], p[2] - c[2]))) : 18;
      shot = { look: c, dist: Math.min(60, Math.max(22, spread * 2.2 + 12)), until: T + 4, who: -1, kind: 'wide' };
      view.pitch = 0.55 + Math.random() * 0.2;
      // (stopped down: a wide shot wants more of it sharp)
      view.aperture = 0.3;
      lastKind = 'wide';
    }
    if (!shot) return;
    view.look = shot.look;
    view.dist = shot.dist;
    label();
  }
}
/** A shot of the pasture's other life near here (a web only when it's dewy): set it, or say no. */
function floraShot(want: FloraKind | null): boolean {
  const kinds: FloraKind[] = want ? [want] : dewy() > 0.5 ? ['web', 'moss', 'clover', 'dungmoss'] : ['moss', 'dungmoss', 'clover'];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  const old = pats.map((p) => ({ x: p.x, z: p.z, age: (T - p.drop) / 24, seed: p.seed }));
  const near = floraNear(seed, field, old, cur.look[0], cur.look[2], kind, Math.floor(T / 6));
  if (!near || Math.hypot(near.at[0] - cur.look[0], near.at[2] - cur.look[2]) > 140) return false;
  shot = { look: near.at, dist: near.size * 2.2 + 6, until: T + 2, who: -1, kind: kind };
  view.pitch = kind === 'web' ? 0.5 : kind === 'clover' ? 0.75 + Math.random() * 0.2 : 0.25 + Math.random() * 0.25;
  view.aperture = 0.8;
  lastKind = kind;
  return true;
}
/** How wet the grass is with dew at this hour (0..1). */
function dewy() {
  const h = (21 + T) % 24;
  const ss = (a: number, b: number, x: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));
  return ss(1.5, 5, h) * (1 - ss(8.5, 10.5, h));
}
/** A blade near the pat with most going on, a way up it: for the lens, at dawn. */
function dewBlade(): V3 | null {
  const p = livelyPat();
  if (!p) return null;
  const b = bladeNear(seed, field, p.x, p.z, 26, Math.floor(T / 6));
  return b;
}
/** The pat nearest a point. */
function patNear(at: V3 | number[]): Pat | null {
  let best: Pat | null = null;
  let d = 1e9;
  for (const p of pats) {
    const e = Math.hypot(p.x - at[0], p.z - at[2]);
    if (e < d && T >= p.drop) {
      d = e;
      best = p;
    }
  }
  return best;
}
/** The pat to look at between moments: one with its fungi up, near here. */
function livelyPat(): Pat | null {
  let best: Pat | null = null;
  let sc = -1e9;
  for (const p of pats) {
    const v = interest(p) - Math.hypot(p.x - cur.look[0], p.z - cur.look[2]) / 120 + Math.hypot(p.x, p.z) / 300;
    if (v > sc) {
      sc = v;
      best = p;
    }
  }
  return best;
}
/** Where things are up now (their feet): for a wide shot to frame. */
function livePlaces(): V3[] {
  const out: V3[] = [];
  for (const sp of world) {
    for (const st of sp.stalks) if (T > st.t0 && T < st.tEnd) out.push(st.base);
    for (const c of sp.cups) if (T > c.t0 && T < c.tEnd) out.push(c.c);
  }
  return out;
}
/** The camera on its way to the shot: unhurried, as a slider and a focus puller would. */
function travel(dt: number) {
  if (!terr && time < 0.1) {
    cur.look = [...view.look] as V3;
    cur.dist = view.dist;
  }
  // (paused: straight there)
  const k = playing ? 1 - Math.exp(-dt * (terr ? 0.9 : 4)) : 1;
  for (let i = 0; i < 3; i++) cur.look[i] += (view.look[i] - cur.look[i]) * k;
  // (distance in log: a move from 60 mm to 4 mm shouldn't rush its last stretch)
  cur.dist = Math.exp(Math.log(cur.dist) + (Math.log(view.dist) - Math.log(cur.dist)) * k);
  if (terr && time > handsOn + 20) pitch += (view.pitch - pitch) * k;
  cur.aperture += (view.aperture - cur.aperture) * k;
}

// ─── the ground's map (a terrarium's): mycelium, water, food, dung, interpolated through time ──
const mapTex = gl.createTexture()!;
gl.bindTexture(gl.TEXTURE_2D_ARRAY, mapTex);
gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, GRID, GRID, NP);
gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
const mapNow = new Uint8Array(GRID * GRID * 4);
/** the pats the ground draws (the nearest few), as its uniforms: where, how high, how old; lumps, layer */
const patU = new Float32Array(NP * 4);
const lumpU = new Float32Array(NP * 4);
/** where the ground's mesh is centred (it moves when the camera's gone far enough) */
let groundCentre: [number, number] = [0, 0];
function updateMap() {
  const near = pats
    .filter((p) => T - p.drop >= 0 && T - p.drop < PAT_GONE)
    .sort((a, b) => Math.hypot(a.x - cur.look[0], a.z - cur.look[2]) - Math.hypot(b.x - cur.look[0], b.z - cur.look[2]))
    .slice(0, NP);
  patU.fill(0);
  lumpU.fill(-1);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, mapTex);
  near.forEach((p, i) => {
    const age = T - p.drop;
    patU.set([p.x, p.z, patHeight(age), age / 24], i * 4);
    lumpU.set([p.terr.lumps[0], p.terr.lumps[1], p.terr.lumps[2], i], i * 4);
    const gr = p.terr.ground;
    const k = Math.max(0, age) / STEP;
    const i0 = Math.min(gr.length - 1, Math.floor(k));
    const i1 = Math.min(gr.length - 1, i0 + 1);
    const f = i0 === i1 ? 0 : k - Math.floor(k);
    const a = gr[i0];
    const b = gr[i1];
    for (let j = 0; j < mapNow.length; j++) mapNow[j] = a[j] + (b[j] - a[j]) * f;
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, GRID, GRID, 1, gl.RGBA, gl.UNSIGNED_BYTE, mapNow);
  });
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  if (pasture && Math.hypot(cur.look[0] - groundCentre[0], cur.look[2] - groundCentre[1]) > 25) groundCentre = [Math.round(cur.look[0] / 5) * 5, Math.round(cur.look[2] / 5) * 5];
}

// ─── the frame's things ─────────────────────────────────────────────────────────────────────────
/** A point along a tube that isn't a stalk (an ascus): the tube shader's sums, with no wave. */
function tubeAt(base: V3, dir: [number, number], lean: number, L: number, u: number): V3 {
  return [base[0] + dir[0] * lean * 0.5 * u * u * L, base[1] + u * L, base[2] + dir[1] * lean * 0.5 * u * u * L];
}
const INK: V3 = [0.025, 0.022, 0.028];
/** What the terrarium leaves about: thrown caps where they landed (on the ground, or stuck to
 *  something standing), the cups' spores in dark smudges. */
function marks(solid: number[]) {
  for (const m of terr?.marks ?? []) {
    if (T < m.t0 || T > m.t1) continue;
    if (m.kind === 'spores') {
      // a smudge of eight, settling in; fading as they're grazed and washed in
      const k = Math.min(1, (T - m.t0) / 0.3) * (1 - Math.max(0, (T - m.t1 + 8) / 8));
      solid.push(m.p[0], m.p[1], m.p[2], m.r * k, m.r * 0.35 * k, m.r * 0.8 * k, ...m.c, 0);
      continue;
    }
    let p: V3 = m.p;
    if (m.on) {
      const h = m.on.st;
      const hs = state(h, T);
      if (hs.grown <= 0.01) continue;
      const at = along(h, hs, m.on.s);
      const ring = ringAt(at.t, h.dir, m.on.a);
      const off = h.bell ? h.bell * (0.55 + 0.3 * hs.open) : at.r;
      const down = h.bell ? h.bell * h.bellTall * 0.35 : 0;
      p = [at.p[0] + ring[0] * (off + m.r * 0.6) - at.t[0] * down, at.p[1] + ring[1] * (off + m.r * 0.6) - at.t[1] * down, at.p[2] + ring[2] * (off + m.r * 0.6) - at.t[2] * down];
    }
    // landed: drying from glossy black to a dull, flattened brown
    const dry = Math.min(1, (T - m.t0) / 30);
    // (and at the last, eaten, washed in: smaller till it's gone)
    const k = m.ground ? Math.min(1, (m.t1 - T) / 8) : 1;
    solid.push(...p, m.r * k, m.r * (0.75 - 0.25 * dry) * k, m.r * k, ...mixV(m.c, [0.16, 0.12, 0.08], dry * 0.6), 0);
  }
}
/** An inkcap dissolving: black drops gather at its margin, swell and fall. */
function inkDrips(st: Stalk, s: State, top: { p: V3; t: V3 }, k: number, g: Genome, solid: number[], dew: number[]) {
  const R = st.bell * k * (0.6 + 0.35 * s.open);
  const H = st.bell * st.bellTall * k * (1.1 - 0.2 * s.open);
  const amax = 2.25 + (1.6 - 2.25) * s.open;
  const n = Math.round(4 + s.inked * 8);
  for (let q = 0; q < n; q++) {
    const a = q * 2.399 + st.phase * 7;
    const ring = ringAt(top.t, st.dir, a);
    const x = Math.sin(amax) * R;
    const y = (Math.cos(amax) - 0.25) * H;
    const rim: V3 = [top.p[0] + ring[0] * x + top.t[0] * y, top.p[1] + ring[1] * x + top.t[1] * y, top.p[2] + ring[2] * x + top.t[2] * y];
    // each drop on its own beat: gathering, then let go
    const per = 0.5 + ((q * 0.37 + st.phase) % 1) * 0.6;
    const c = ((T + q * 0.29) / per) % 1;
    const rr = st.bell * 0.09 * (0.5 + 0.5 * s.inked);
    if (c < 0.85) {
      const sz = rr * Math.sqrt(c / 0.85);
      solid.push(rim[0], rim[1] - sz * 0.9, rim[2], sz, sz * 1.25, sz, ...INK, 0);
    } else {
      const f = (c - 0.85) / 0.15;
      const yg = groundY(rim[0], rim[2]);
      const y = rim[1] - rr - f * f * (rim[1] - yg);
      if (y > yg) solid.push(rim[0], y, rim[2], rr * 0.8, rr * 1.6, rr * 0.8, ...INK, 0);
    }
  }
  void g;
  void dew;
}
/** Where the inkcaps dripped: black stains on the ground, spreading, staying after they've gone. */
function stains(solid: number[]) {
  for (const sp of world) {
    if (sp.g.form !== 'inkcap') continue;
    for (const st of sp.stalks) {
      const t = T - st.t1 - 4;
      if (t <= 0 || T < st.t0) continue;
      const Tq = Math.min(T, st.tEnd - 1.5);
      const s = state(st, Tq);
      const top = along(st, s, 1);
      const k = Math.min(1, t / 14);
      const r = st.bell * (0.25 + 0.45 * k) * sp.g.ink;
      if (r < 0.05) continue;
      // (drying over days: browner, smaller, then gone into the dung; a few drops about it)
      const age = Math.max(0, (T - st.tEnd) / 72);
      if (age > 1.5) continue;
      const y = groundY(top.p[0], top.p[2]);
      const col = mixV(INK, [0.16, 0.12, 0.08], Math.min(0.8, age));
      const kk = 1 - Math.max(0, age - 0.8) / 0.7;
      solid.push(top.p[0], y + r * 0.02, top.p[2], r * kk, r * 0.05, r * 0.8 * kk, ...col, 0);
      for (let q = 0; q < 3; q++) {
        const a = st.phase * 5 + q * 2.1;
        const d = r * (1.1 + 0.4 * q);
        const rr = r * (0.18 + 0.08 * q) * kk;
        solid.push(top.p[0] + Math.cos(a) * d, y + rr * 0.05, top.p[2] + Math.sin(a) * d, rr, rr * 0.08, rr, ...col, 0);
      }
    }
  }
}
/** An eyelash cup: a saucer (an inkcap's bell, the other way up), its rim fringed with dark hairs. */
function saucer(st: Stalk, s: State, g: Genome, bell: number[], tube: number[]) {
  const k = 0.25 + 0.75 * s.grown;
  // (it sits as the ground slopes, tipped a little more its own way)
  const e = st.bell * 0.6;
  const gx = (groundY(st.base[0] + e, st.base[2]) - groundY(st.base[0] - e, st.base[2])) / (2 * e);
  const gz = (groundY(st.base[0], st.base[2] + e) - groundY(st.base[0], st.base[2] - e)) / (2 * e);
  const up = norm3([-gx + Math.sin(st.lean) * st.dir[0], 1, -gz + Math.sin(st.lean) * st.dir[1]]);
  const axis: V3 = [-up[0], -up[1], -up[2]];
  const R = st.bell * k;
  const H = st.bell * st.bellTall * k;
  // (as the shader has it, open: the rim's angle, its width and depth)
  const Rs = R * 0.95;
  const Hs = H * 0.9;
  // (sitting on the dung, a little into it — but never with the dung through it: where the ground
  // under it is higher than its floor there, it sits up)
  let apex = st.base[1] + st.r * 0.5 - 0.1 * Hs;
  for (let q = 0; q < 6; q++) {
    const a = (q / 6) * Math.PI * 2 + st.phase;
    for (const f of [0.35, 0.65, 0.9]) {
      const gy = groundY(st.base[0] + Math.cos(a) * Rs * f, st.base[2] + Math.sin(a) * Rs * f);
      // (its floor there: up the curve, and down the side it tips to)
      const dip = Rs * f * (Math.cos(a) * up[0] + Math.sin(a) * up[2]);
      apex = Math.max(apex, gy - up[1] * (1 - Math.cos(Math.asin(f))) * Hs + dip + R * 0.03);
    }
  }
  apex = Math.max(apex, groundY(st.base[0], st.base[2]) - 0.05 * Hs);
  const lift = 0.75 * Hs;
  const at: V3 = [st.base[0] + up[0] * lift, apex + up[1] * lift, st.base[2] + up[2] * lift];
  bell.push(...at, ...axis, R, H, 1, 0, 0, s.slump, st.phase, 0);
  const side = norm3(cross3(axis, Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const side2 = cross3(axis, side);
  const amax = 1.6;
  let q = Math.floor(st.phase * 7919) >>> 0;
  const rnd = () => ((q = (Math.imul(q, 1664525) + 1013904223) >>> 0) / 4294967296);
  const grow = 0.3 + 0.7 * s.grown;
  for (let h = 0; h < g.hairs; h++) {
    // most on the rim, a few lower down its outside, shorter
    const low = h % 6 === 5;
    const th = ((h + rnd() * 0.6) / g.hairs) * Math.PI * 2;
    const al = amax * (low ? 0.6 + rnd() * 0.3 : 0.98);
    const ring: V3 = [side[0] * Math.cos(th) + side2[0] * Math.sin(th), side[1] * Math.cos(th) + side2[1] * Math.sin(th), side[2] * Math.cos(th) + side2[2] * Math.sin(th)];
    const x = Math.sin(al) * Rs;
    const y = (Math.cos(al) - 0.25) * Hs;
    const p: V3 = [at[0] + ring[0] * x + axis[0] * y, at[1] + ring[1] * x + axis[1] * y, at[2] + ring[2] * x + axis[2] * y];
    const hz = Math.hypot(ring[0], ring[2]) || 1;
    const L = g.hairLen * (low ? 0.3 : 1) * (0.6 + rnd() * 0.6) * grow * Math.min(1, st.bell);
    // (out from the rim, rising, curling a little over: lashes)
    tube.push(...p, ring[0] / hz, ring[2] / hz, 0.2 + rnd() * 0.3 + s.slump * 0.5, 0.1 + rnd() * 0.15, L, 0.011 + rnd() * 0.006, 0, -((low ? 3 : 1.7) + rnd() * 0.8), 0, 0.15, rnd() * 9, 0, 0, 0, 0, 0.1);
  }
}
/** A flask fungus: a black pear, half sunk, its neck to the light; now and then it shoots. */
function flask(st: Stalk, s: State, g: Genome, tube: number[], solid: number[]) {
  const span = st.t1 - st.t0;
  const body = ease01((T - st.t0) / (span * 0.6)) * (1 - ease01((T - (st.tEnd - 1)) / 1));
  if (body <= 0.01) return;
  const neck = ease01((T - st.t0 - span * 0.45) / (span * 0.7));
  const fr = g.flask * (st.r / g.radius) * body;
  // (pale and soft when young; black when ripe)
  const dark = ease01((T - st.t0) / (span + 3));
  const col = mixV([0.82, 0.76, 0.6], g.capColour, dark);
  const c: V3 = [st.base[0], st.base[1] + st.r * 0.5 + fr * 0.35, st.base[2]];
  solid.push(...c, fr, fr * 1.3, fr, ...col, dark > 0.6 ? 0 : 2);
  if (neck <= 0.01) return;
  const base: V3 = [c[0], c[1] + fr * 1.05, c[2]];
  const L = st.len * neck * (1 - s.slump * 0.3);
  const lean = st.lean + s.slump * 0.8;
  tube.push(...base, st.dir[0], st.dir[1], lean, 0.1, L, st.r, 0, 1, 0, st.wave, st.phase, 0, g.tipLength, 1, 0, g.fuzz);
  // shooting: its asci, one by one, up the neck and out — a puff of spores off its tip
  const ripe = st.t1 + 2;
  if (T < ripe || s.slump > 0.5) return;
  const per = 1.2 + (st.phase % 1) * 2.5;
  const since = (T - ripe + st.phase) % per;
  if (since > 0.08) return;
  const f = since / 0.08;
  const tip = tubeAt(base, st.dir, lean, L, 1);
  const a = norm3(sub3(tip, tubeAt(base, st.dir, lean, L, 0.85)));
  for (let k = 0; k < 8; k++) {
    const d = f * L * 6 - k * st.r * 0.9;
    if (d < 0) continue;
    const sr = st.r * 0.45;
    solid.push(tip[0] + a[0] * d, tip[1] + a[1] * d - f * f * L, tip[2] + a[2] * d, sr, sr * 1.5, sr, ...g.spore, 0);
  }
}
const ease01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
/** the contact shadows nearest the eye, as many as the ground takes */
function shades(list: number[], eye: V3): number[] {
  const all: Array<[number, number]> = [];
  for (let i = 0; i < list.length; i += 4) all.push([Math.hypot(list[i] - eye[0], list[i + 1] - eye[2]), i]);
  all.sort((a, b) => a[0] - b[0]);
  const out: number[] = [];
  for (const [, i] of all.slice(0, SHADE)) out.push(list[i], list[i + 1], list[i + 2], list[i + 3]);
  while (out.length < SHADE * 4) out.push(0, 0, 1, 0);
  return out;
}
function things() {
  const solid: number[] = [];
  const dew: number[] = [];
  const feet: number[] = [];
  const per: Array<{ sp: Sp; tube: number[]; bell: number[]; jelly: number[]; hair: number[] }> = [];
  // (the litter near the eye only: far off, it's a few pixels and a lot of spheres)
  const eye = lastCam?.eye ?? cur.look;
  const near = (p: V3, r: number) => !pasture || Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) < r * 260;
  for (const b of bits.beads) if (near(b.p, b.r)) solid.push(...b.p, b.r, b.r * b.flat, b.r, ...beadColour, 1);
  for (const c of bits.crumbs) if (near(c.p, c.r[0])) solid.push(...c.p, ...c.r, ...c.c, 2);
  for (const p of bits.pools) if (near(p.p, p.r)) dew.push(p.p[0], p.p[1] + p.r * 0.12, p.p[2], p.r, p.r * 0.35, p.r, 1, 1, 1, 1);
  marks(solid);
  for (const sp of world) {
  const g = sp.g;
  const tube: number[] = [];
  const bell: number[] = [];
  const jelly: number[] = [];
  const hair: number[] = [];
  per.push({ sp, tube, bell, jelly, hair });
  const velvet = g.form === 'inkcap';
  for (const st of sp.stalks) {
    if (T < st.t0 || T > st.tEnd) continue;
    const s = state(st, T);
    if (s.grown <= 0.001) continue;
    if (g.form === 'eyelash') {
      saucer(st, s, g, bell, tube);
      continue;
    }
    if (g.form === 'flask') {
      flask(st, s, g, tube, solid);
      continue;
    }
    // (a thrower's trophocyst: the swollen foot it grows from, orange-yellow, half in the dung)
    if (g.throws && s.grown > 0.05) {
      const tr = st.r * (1.2 + 0.5 * Math.min(1, s.grown * 2));
      solid.push(st.base[0], st.base[1] - st.r * 0.1, st.base[2], tr, tr * 0.55, tr * 0.85, ...mixV(g.tip, [0.62, 0.4, 0.14], 0.6), 1);
    }
    const Lnow = st.len * s.grown;
    const v = st.ves * s.swell * (1 - s.slump * 0.85);
    const knob = st.knob ? st.r * 2.1 * Math.min(1, s.grown * 1.5) : 0;
    tube.push(...st.base, st.dir[0], st.dir[1], st.lean + s.slump * 1.6, s.slump * 0.9, Lnow, st.r, v, st.long, knob, st.wave, st.phase, s.slump, velvet ? 0 : g.tipLength, s.ripe, g.glassy, g.fuzz);
    const top = along(st, s, 1);
    if (velvet) {
      // an inkcap: its bell on top, a white tuft of mycelium at its foot
      const k = 0.35 + 0.65 * s.grown;
      bell.push(...top.p, ...top.t, st.bell * k, st.bell * st.bellTall * k, s.open, g.pleats, g.pleatDepth, s.inked * g.ink, st.phase, 0);
      const fr = st.r * 1.8;
      solid.push(st.base[0], st.base[1] + st.r * 0.5, st.base[2], fr, fr * 0.6, fr, 0.9, 0.9, 0.87, 3);
      // the mycelium round its foot: threads out over the ground and up its base, curling
      let q = Math.floor(st.phase * 9973) >>> 0;
      const rnd = () => ((q = (Math.imul(q, 1664525) + 1013904223) >>> 0) / 4294967296);
      const n = Math.round(26 * g.mycelium);
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2;
        const d = st.r * (0.6 + rnd() * 2.2);
        const b: V3 = [st.base[0] + Math.cos(a) * d, groundY(st.base[0] + Math.cos(a) * d, st.base[2] + Math.sin(a) * d), st.base[2] + Math.sin(a) * d];
        const L = st.r * (1.5 + rnd() * 4) * (0.4 + 0.6 * s.grown);
        hair.push(...b, Math.cos(a), Math.sin(a), 2 + rnd() * 5, 0, L, st.r * 0.08, 0, 1, 0, 0.6, rnd() * 9, 0, 0, 0, 0.25, 0.2);
      }
      if (feet.length < MYC * 4) feet.push(st.base[0], st.base[2], st.r * 9, g.mycelium);
      if (s.inked > 0.05) inkDrips(st, s, top, k, g, solid, dew);
    }
    if (st.cap > 0 && s.ripe > 0) {
      const cr = st.cap * (0.35 + 0.65 * s.ripe);
      let c: V3 = [top.p[0] + top.t[0] * cr * g.capFlat * 0.7, top.p[1] + top.t[1] * cr * g.capFlat * 0.7, top.p[2] + top.t[2] * cr * g.capFlat * 0.7];
      let show = true;
      if (s.thrown >= 0) {
        const f = s.thrown / 0.08;
        if (f > 1) show = false;
        else c = [c[0] + st.fly[0] * f * f * 60, c[1] + st.fly[1] * f * f * 60, c[2] + st.fly[2] * f * f * 60];
      }
      if (show) solid.push(...c, cr, cr * g.capFlat, cr, ...mixV(g.tip, g.capColour, s.ripe), 0);
      if (show && s.thrown >= 0) {
        // (a streak: where it was a moment ago, fainter and smaller, as a shutter would smear it)
        const f = s.thrown / 0.08;
        for (let j = 1; j <= 5; j++) {
          const fj = Math.max(0, f - j * 0.05);
          const k = 1 - j * 0.15;
          const cj: V3 = [top.p[0] + st.fly[0] * fj * fj * 60, top.p[1] + st.fly[1] * fj * fj * 60, top.p[2] + st.fly[2] * fj * fj * 60];
          solid.push(...cj, cr * k, cr * g.capFlat * k, cr * k, ...g.capColour, 0);
        }
        jolt(top.p, st, 1);
      }
    }
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
      const f = s.thrown / 0.15;
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + st.phase;
        const dir: V3 = [Math.cos(a) * 0.8 + st.fly[0], 0.6 + st.fly[1] * 0.5, Math.sin(a) * 0.8 + st.fly[2]];
        const rr = g.dewSize * 0.6 * (1 - f);
        dew.push(top.p[0] + dir[0] * f * 9, top.p[1] + dir[1] * f * 9 - f * f * 6, top.p[2] + dir[2] * f * 9, rr, rr, rr, 1, 1, 1, 1);
      }
    }
  }
  // the cups: a cushion of jelly; its asci, clear tubes up through its skin, eight spores in each
  for (const c of sp.cups) {
    if (T < c.t0 || T > c.tEnd) continue;
    const gr = cushionGrown(c, T);
    jelly.push(...c.c, c.R, c.Hc, gr, c.seed);
    for (const a of c.asci) {
      const st = ascusState(a, T);
      if (st.up <= 0) continue;
      // (fired: it shrinks back into the jelly)
      const spent = st.fired >= 0 ? Math.min(1, st.fired / 0.7) : 0;
      const sk = onCushion(c, gr, a.th, a.ph);
      const hz = Math.hypot(sk.n[0], sk.n[2]);
      const dir: [number, number] = hz > 1e-3 ? [sk.n[0] / hz, sk.n[2] / hz] : [1, 0];
      const lean = Math.min(1.1, (1.6 * hz) / Math.max(0.5, sk.n[1]));
      const sink = a.len * 0.55;
      const base: V3 = [sk.p[0] - sk.n[0] * sink, sk.p[1] - sk.n[1] * sink, sk.p[2] - sk.n[2] * sink];
      const L = (sink + a.len * st.up) * (1 - spent * 0.7);
      tube.push(...base, dir[0], dir[1], lean, 0, L, a.r, 0, 1, a.r, 0, 0, spent, 0, st.ripe, 1, 0);
      // its spores: a column of eight in its top, greenish, ripening black; fired, they fly off
      // together as one, too fast for the eye
      if (st.fired >= 0) jolt(sk.p, a, 0.35);
      if (st.fired < 0.05) {
        const fl = st.fired >= 0 ? st.fired / 0.05 : 0;
        const tip = tubeAt(base, dir, lean, L, 1);
        const axis = norm3(sub3(tip, tubeAt(base, dir, lean, L, 0.9)));
        const green: V3 = [g.jelly[0] * 0.6, g.jelly[1] * 0.6, g.jelly[2] * 0.6];
        for (let k = 0; k < 8; k++) {
          const uu = 0.93 - k * 0.085 - (1 - st.up) * 0.3;
          const p = tubeAt(base, dir, lean, L, Math.max(0.05, uu));
          const fly = fl * fl * c.R * 30;
          const sr = a.r * 0.78;
          solid.push(p[0] + axis[0] * fly, p[1] + axis[1] * fly, p[2] + axis[2] * fly, sr, sr * 1.35, sr, ...mixV(green, g.spore, st.ripe), 0);
        }
      }
    }
    for (const d of c.dew) {
      if (T < d.t) continue;
      const rr = d.r * Math.min(1, (T - d.t) / 1.5);
      const sk = onCushion(c, gr, d.th, d.ph);
      dew.push(sk.p[0] + sk.n[0] * rr * 0.5, sk.p[1] + sk.n[1] * rr * 0.5, sk.p[2] + sk.n[2] * rr * 0.5, rr, rr * 0.85, rr, 1, 1, 1, 1);
    }
  }
  }
  while (feet.length < MYC * 4) feet.push(0, 0, 1, 0);
  stains(solid);
  const lim = limbs();
  if (crit && lastCam) drawCritters(crit, T, time, groundY, lastCam.eye as V3, lim);
  if (lastCam) drawStraw(blades, groundY, lastCam.eye as V3, lim);
  if (pasture && lastCam) drawGrass(seed, field, cur.look, lastCam.eye as V3, time, (21 + T) % 24, Math.floor(T / 6), lim, dew);
  if (pasture && lastCam) {
    const old = pats.map((p) => ({ x: p.x, z: p.z, age: (T - p.drop) / 24, seed: p.seed }));
    drawFlora(seed, field, old, cur.look, lastCam.eye as V3, time, (21 + T) % 24, Math.floor(T / 6), lim, solid, dew);
  }
  return { solid, dew, per, feet, lim };
}

// ─── the light through the day: a cool lamp-lit night, a low warm dawn behind them, the morning ─
/** At hour T (from nine in the evening): the light's colour and direction, the room's, and how
 * the camera exposes for it (it opens up in the night, but never all the way: night stays night). */
function daylight(T: number) {
  const hour = (21 + T) % 24;
  const ss = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  // dawn comes in from five, full morning by nine; the light goes warm again toward evening, and
  // it's night by nine
  const h = hour;
  const day = ss(5.5, 9, h) * (1 - ss(17.5, 20.5, h));
  const dawn = Math.max(ss(4.5, 6.5, h) * (1 - ss(7, 9, h)), ss(16.5, 18.5, h) * (1 - ss(19.5, 21, h)));
  const warm = g.warmth;
  const night: V3 = [0.58, 0.62, 0.72];
  const sun: V3 = [1, 0.62 + 0.1 * (1 - warm), 0.36 + 0.1 * (1 - warm)];
  const noon: V3 = [1, 0.9 + 0.08 * (1 - warm), 0.75 + 0.2 * (1 - warm)];
  const lightCol = mixV(mixV(night, noon, day), sun, dawn).map((v) => v * (0.72 + 0.28 * day + 0.2 * dawn)) as V3;
  const sky = mixV([0.36, 0.4, 0.46], [0.5, 0.6, 0.42], day).map((v) => v * (0.8 + 0.2 * day)) as V3;
  // the light rises: low behind them at dawn, higher through the morning; from the same side
  const el = 0.25 + 0.95 * day - 0.1 * dawn;
  const hz = Math.hypot(g.light[0], g.light[2]) || 1;
  const light = norm3([(g.light[0] / hz) * Math.cos(el), Math.sin(el) + 0.15, (g.light[2] / hz) * Math.cos(el)]);
  const exposure = 1.35 * (1.35 - 0.35 * day);
  return { lightCol, sky, light, exposure };
}

// ─── the jolt: when something fires near where the lens is looking, the camera feels it ────────
let shake = 0;
let jolted = new WeakSet<object>();
let lastT = 0;
function jolt(p: V3, who: object, k: number) {
  if (jolted.has(who)) return;
  jolted.add(who);
  const cam = lastCam;
  if (!cam) return;
  // (more the nearer it is to the plane of focus, and to the middle of the picture)
  const d = sub3(p, cam.eye);
  const z = dot3(d, cam.f);
  if (z <= 0) return;
  const off = Math.hypot(dot3(d, cam.r), dot3(d, cam.up)) / z;
  const near = Math.exp(-Math.abs(z - focus) / (focus * 0.25)) * Math.max(0, 1 - off * 1.5);
  shake = Math.min(1.5, shake + k * near);
}
let lastCam: ReturnType<typeof camera> | null = null;

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
  const css = [innerWidth, innerHeight];
  // (about half a megapixel, less if the frames come slowly: the depth of field is the costly part)
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
  if (playing) T += dt * rate();
  const end = span();
  if (pasture) {
    // (the field doesn't end: the scrubber's window moves on; the pats in reach come and go)
    if (T > windowStart() + WINDOW) tArrive += WINDOW / 2;
    fade = Math.min(1, time / 0.6);
    if (scrub && document.activeElement !== scrub) scrub.value = String(Math.round(((T - windowStart()) / WINDOW) * 1000));
    if (time - lastRefresh > 1) {
      lastRefresh = time;
      if (refreshPats()) {
        combine();
        settle();
      }
    }
  } else {
    if (T > end + 1.5) {
      T = 0;
      shot = null;
    }
    fade = Math.min(1, T < 0.6 ? T / 0.6 : T > end + 0.8 ? Math.max(0, (end + 1.5 - T) / 0.7) : 1);
    if (scrub && document.activeElement !== scrub) scrub.value = String(Math.round((Math.min(T, end) / end) * 1000));
  }
  clock();
  direct(dt);
  travel(dt);
  updateMap();

  // (a new day: everything can fire again)
  if (T < lastT) jolted = new WeakSet();
  lastT = T;
  shake *= Math.exp(-dt * 5);
  const cam = camera(time);
  lastCam = cam;
  pullFocus(cam, dt);
  const { lightCol, sky, light, exposure } = daylight(T);
  const th = things();

  // 1. the opaque patch
  gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
  gl.viewport(0, 0, W, Hh);
  gl.clearColor(0.08, 0.1, 0.055, 1);
  gl.clearDepth(1);
  gl.depthMask(true);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const common = (p: WebGLProgram) => {
    gl.useProgram(p);
    gl.uniformMatrix4fv(u(p, 'uVP'), false, cam.vp);
    gl.uniform3fv(u(p, 'uLight'), light);
    gl.uniform3fv(u(p, 'uEye'), cam.eye);
    gl.uniform3fv(u(p, 'uLightCol'), lightCol);
    gl.uniform3fv(u(p, 'uSky'), sky);
    gl.uniform1f(u(p, 'uS'), S);
  };
  gl.useProgram(backProg);
  gl.uniform2f(u(backProg, 'uRes'), W, Hh);
  gl.uniform3fv(u(backProg, 'uLightCol'), lightCol);
  gl.uniform3fv(u(backProg, 'uSky'), sky);
  gl.uniform3fv(u(backProg, 'uWarm'), [0.9, 0.75, 0.35]);
  gl.uniform1f(u(backProg, 'uSeed'), seed % 97);
  gl.uniform1f(u(backProg, 'uYaw'), yaw);
  gl.bindVertexArray(quadVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  common(groundProg);
  gl.uniform3fv(u(groundProg, 'uGround'), g.ground);
  gl.uniform1f(u(groundProg, 'uWet'), g.wet);
  gl.uniform1f(u(groundProg, 'uMyc'), g.mycelium * (g.form === 'inkcap' ? 0.6 : 0.3));
  gl.uniform4fv(u(groundProg, 'uFeet'), th.feet);
  gl.uniform4fv(u(groundProg, 'uShade'), shades(th.lim.shade, cam.eye as V3));
  gl.uniform1f(u(groundProg, 'uSpan'), SPAN);
  gl.uniform1f(u(groundProg, 'uField'), pasture ? 1 : 0);
  gl.uniform1f(u(groundProg, 'uStudio'), pasture ? 0 : 1);
  gl.uniform1f(u(groundProg, 'uExt'), pasture ? 5 : 1);
  gl.uniform2f(u(groundProg, 'uCentre'), groundCentre[0], groundCentre[1]);
  gl.uniform4fv(u(groundProg, 'uPat'), patU);
  gl.uniform4fv(u(groundProg, 'uLump'), lumpU);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, mapTex);
  gl.uniform1i(u(groundProg, 'uMaps'), 2);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindVertexArray(groundVao);
  gl.drawArrays(gl.TRIANGLES, 0, groundCount);
  common(solidProg);
  gl.uniform1f(u(solidProg, 'uFocal'), cam.focal);
  const big: number[] = [];
  const small: number[] = [];
  for (let i = 0; i < th.solid.length; i += 10) {
    const to = Math.max(th.solid[i + 3], th.solid[i + 4], th.solid[i + 5]) < SMALL * S ? small : big;
    for (let k = 0; k < 10; k++) to.push(th.solid[i + k]);
  }
  draw(solids, big);
  draw(solidsLo, small);
  // the animals' bodies and legs
  const lm = uploadLimbs(th.lim);
  common(limbProg);
  gl.activeTexture(gl.TEXTURE3);
  gl.bindTexture(gl.TEXTURE_2D, rowsTex);
  gl.uniform1i(u(limbProg, 'uRows'), 3);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(u(limbProg, 'uBehind'), 0);
  drawLimbs(limbHi, lm.starts[0], lm.counts[0]);
  drawLimbs(limbMid, lm.starts[1], lm.counts[1]);
  drawLimbs(limbLo, lm.starts[2], lm.counts[2]);
  drawLimbs(bladeHiMesh, lm.starts[3], lm.counts[3]);
  drawLimbs(bladeLoMesh, lm.starts[4], lm.counts[4]);
  // (each species with its own colours and its own scale)
  for (const q of th.per) {
    if (!q.bell.length) continue;
    const x = q.sp.g;
    common(bellProg);
    gl.uniform1f(u(bellProg, 'uS'), q.sp.S);
    gl.uniform3fv(u(bellProg, 'uBell'), x.bellColour);
    gl.uniform3fv(u(bellProg, 'uBellTop'), x.bellTop);
    gl.uniform1f(u(bellProg, 'uSaucer'), x.form === 'eyelash' ? 1 : 0);
    gl.uniform1f(u(bellProg, 'uVeil'), x.form === 'inkcap' ? 0.3 + 0.7 * x.fuzz : 0);
    draw(bells, q.bell);
  }
  // 2. the glass: jelly and tubes, seeing through to it
  copyScene();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, copyTex);
  for (const q of th.per) {
    const x = q.sp.g;
    if (q.jelly.length) {
      common(jellyProg);
      gl.uniform1f(u(jellyProg, 'uS'), q.sp.S);
      gl.uniformMatrix4fv(u(jellyProg, 'uView'), false, cam.view);
      gl.uniform2f(u(jellyProg, 'uRes'), W, Hh);
      gl.uniform3fv(u(jellyProg, 'uJelly'), x.jelly);
      gl.uniform3fv(u(jellyProg, 'uDeep'), x.jellyDeep);
      gl.uniform1i(u(jellyProg, 'uBehind'), 0);
      draw(jellies, q.jelly);
    }
    if (!q.tube.length && !q.hair.length) continue;
    common(stalkProg);
    gl.uniform1f(u(stalkProg, 'uS'), q.sp.S);
    gl.uniformMatrix4fv(u(stalkProg, 'uView'), false, cam.view);
    gl.uniform2f(u(stalkProg, 'uRes'), W, Hh);
    gl.uniform3fv(u(stalkProg, 'uGlass'), x.form === 'cup' ? mixV([0.95, 0.97, 0.92], x.jelly, 0.3) : x.glass);
    gl.uniform3fv(u(stalkProg, 'uTip'), x.tip);
    gl.uniform3fv(u(stalkProg, 'uVelvet'), x.form === 'eyelash' || x.form === 'flask' ? x.glass : mixV(x.bellColour, [1, 1, 1], 0.55));
    gl.uniform1f(u(stalkProg, 'uThrows'), x.throws ? 1 : 0);
    gl.uniform1i(u(stalkProg, 'uBehind'), 0);
    draw(tubes, q.tube);
    draw(hairs, q.hair);
  }
  // the nematodes, clear: seeing through to it too
  if (lm.counts[5] + lm.counts[6] > 0) {
    common(limbProg);
    gl.uniformMatrix4fv(u(limbProg, 'uView'), false, cam.view);
    gl.uniform2f(u(limbProg, 'uRes'), W, Hh);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, rowsTex);
    gl.uniform1i(u(limbProg, 'uRows'), 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, copyTex);
    gl.uniform1i(u(limbProg, 'uBehind'), 0);
    drawLimbs(limbHi, lm.starts[5], lm.counts[5]);
    drawLimbs(limbMid, lm.starts[6], lm.counts[6]);
  }
  // 3. the droplets, seeing through to all of that
  copyScene();
  common(dropProg);
  gl.uniform1f(u(dropProg, 'uFocal'), cam.focal);
  gl.uniformMatrix4fv(u(dropProg, 'uView'), false, cam.view);
  gl.uniform2f(u(dropProg, 'uRes'), W, Hh);
  gl.bindTexture(gl.TEXTURE_2D, copyTex);
  gl.uniform1i(u(dropProg, 'uBehind'), 0);
  // (the many tiny drops — a web's — coarser)
  const dBig: number[] = [];
  const dSmall: number[] = [];
  for (let i = 0; i < th.dew.length; i += 10) {
    const to = th.dew[i + 3] < 0.2 ? dSmall : dBig;
    for (let k = 0; k < 10; k++) to.push(th.dew[i + k]);
  }
  draw(drops, dBig);
  draw(dropsLo, dSmall);
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
  const maxBlur = Math.round(Hh * 0.022);
  gl.uniform1f(u(dofProg, 'uK'), maxBlur * 2.2 * cur.aperture);
  gl.uniform1f(u(dofProg, 'uMax'), maxBlur);
  gl.uniform1f(u(dofProg, 'uNear'), cam.near);
  gl.uniform1f(u(dofProg, 'uFar'), cam.far);
  gl.uniform1f(u(dofProg, 'uTime'), time % 100);
  gl.uniform1f(u(dofProg, 'uFade'), fade);
  gl.uniform1f(u(dofProg, 'uExposure'), exposure);
  gl.bindVertexArray(quadVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
  (window as unknown as { __fungi: unknown }).__fungi = { seed, form: g.form, name: g.name, T: Math.round(T * 100) / 100, tubes: th.per.reduce((n, q) => n + q.tube.length, 0) / tubes.stride, drops: th.dew.length / drops.stride, solids: th.solid.length / 10, limbs: [th.lim.hi, th.lim.mid, th.lim.lo, th.lim.bladeHi, th.lim.bladeLo, th.lim.glassHi, th.lim.glassMid].map((x) => x.length / (ROWW * 4)), bells: th.per.reduce((n, q) => n + q.bell.length, 0) / bells.stride, day: Math.floor(T / 24) + 1, shot: shot?.kind ?? null, who: shot?.who ?? null, species: world.map((x) => x.g.form), focus: Math.round(focus * 100) / 100, camD: Math.round((lastCam?.d ?? 0) * 100) / 100, near: lastCam?.near };
  requestAnimationFrame(frame);
}
function ringAt(t: V3, dir: [number, number], a: number): V3 {
  const side: V3 = [-dir[1], 0, dir[0]];
  const x = norm3(cross3(t, side));
  const y = cross3(t, x);
  return [x[0] * Math.cos(a) + y[0] * Math.sin(a), x[1] * Math.cos(a) + y[1] * Math.sin(a), x[2] * Math.cos(a) + y[2] * Math.sin(a)];
}

// ─── focus: pulled slowly from subject to subject, as a cameraman would; a tap pulls it there ────
/** The things worth focusing on: each stalk's top, each cushion's crown. */
function subjects(): Array<{ at: () => V3; weight: number }> {
  const out: Array<{ at: () => V3; weight: number }> = [];
  for (const sp of world) {
    for (const c of sp.cups) if (T > c.t0 && T < c.tEnd) out.push({ at: () => onCushion(c, cushionGrown(c, T), 0, 0.2).p, weight: cushionGrown(c, T) });
    for (const st of sp.stalks) {
      if (T < st.t0 || T > st.tEnd) continue;
      const s = state(st, T);
      out.push({ at: () => along(st, state(st, T), 0.92).p, weight: s.grown < 0.3 ? -1 : s.swell * 0.4 + s.ripe * 0.2 + s.open * 0.3 });
    }
  }
  return out;
}
function pullFocus(cam: ReturnType<typeof camera>, dt: number) {
  let target: number;
  if (focusAt && time < focusAt.until) target = depthOf(cam, focusAt.at());
  else if (terr && time > handsOn + 20) target = depthOf(cam, cur.look);
  else {
    focusAt = null;
    autoFocus -= dt;
    const list = subjects();
    if (autoFocus <= 0 || subject < 0 || subject >= list.length) {
      subject = chooseSubject(cam, list);
      autoFocus = 6 + Math.random() * 4;
    }
    target = subject >= 0 ? depthOf(cam, list[subject].at()) : cam.d;
  }
  focus += (target - focus) * (playing ? Math.min(1, dt * 1.6) : 1);
}
function depthOf(cam: ReturnType<typeof camera>, p: V3) {
  return Math.max(cam.near * 2, dot3(sub3(p, cam.eye), cam.f));
}
function chooseSubject(cam: ReturnType<typeof camera>, list: ReturnType<typeof subjects>): number {
  let best = -1;
  let score = -1e9;
  list.forEach((s, i) => {
    if (s.weight < 0) return;
    const d = sub3(s.at(), cam.eye);
    const z = dot3(d, cam.f);
    if (z <= 0) return;
    const x = dot3(d, cam.r) / z;
    const y = dot3(d, cam.up) / z;
    // (the middle of the picture, ripening, and nearer rather than further)
    const sc = -Math.hypot(x * 2, y * 2.5) + s.weight + Math.random() * 0.35 - Math.max(0, z / cam.d - 0.9) * 2.5;
    if (sc > score) {
      score = sc;
      best = i;
    }
  });
  return best;
}
/** A tap: the subject nearest the ray through it gets the focus (or, on bare ground, the ground). */
function tapFocus(px: number, py: number) {
  const cam = camera(time);
  const nx = (px / innerWidth) * 2 - 1;
  const ny = 1 - (py / innerHeight) * 2;
  const tt = Math.tan(FOV / 2);
  const dir = norm3([0, 1, 2].map((a) => cam.f[a] + cam.r[a] * nx * tt * cam.aspect + cam.up[a] * ny * tt) as V3);
  let best: (() => V3) | null = null;
  let bd = 1e9;
  const probe = (at: () => V3) => {
    const d = sub3(at(), cam.eye);
    const t = dot3(d, dir);
    if (t <= 0) return;
    const off = Math.hypot(d[0] - dir[0] * t, d[1] - dir[1] * t, d[2] - dir[2] * t) / t;
    if (off < bd) {
      bd = off;
      best = at;
    }
  };
  for (const sp of world) {
    for (const st of sp.stalks) if (T > st.t0 && T < st.tEnd) for (const uu of [0.3, 0.6, 0.9, 1]) probe(() => along(st, state(st, T), uu).p);
    for (const c of sp.cups) if (T > c.t0 && T < c.tEnd) for (const ph of [0, 0.3, 0.6, 0.9]) for (const a of [0, 1.6, 3.1, 4.7]) probe(() => onCushion(c, cushionGrown(c, T), a, ph).p);
  }
  if (best && bd < 0.08) focusAt = { at: best, until: time + 12 };
  else if (dir[1] < 0) {
    const t = -cam.eye[1] / dir[1];
    const p: V3 = [cam.eye[0] + dir[0] * t, 0, cam.eye[2] + dir[2] * t];
    focusAt = { at: () => p, until: time + 12 };
  }
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
    handsOn = time;
    pinch = d;
    return;
  }
  yaw += dx * 0.006;
  handsOn = time;
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
  handsOn = time;
}, { passive: false });
document.getElementById('another')?.addEventListener('click', () => grow(Math.floor(Math.random() * 9000) + 1));
document.getElementById('play')?.addEventListener('click', (e) => {
  playing = !playing;
  (e.currentTarget as HTMLElement).textContent = playing ? 'pause' : 'play';
});
function clock() {
  const el = document.getElementById('clock');
  if (!el) return;
  const t = Math.min(T, span());
  const hour = (21 + t) % 24;
  const hm = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
  // (a terrarium counts its days: the first begins at nine in the evening)
  if (pasture) {
    // (the field's: the date and the hour)
    const d = dateOf(T);
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    el.textContent = `${day} ${d.getUTCDate()} ${mon} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    return;
  }
  el.textContent = terr ? `day ${Math.floor((t + 21) / 24) + 1} · ${hm}` : hm;
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
if (params.get('t') && !pasture) T = Number(params.get('t'));
requestAnimationFrame(frame);

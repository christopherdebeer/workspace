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
import { DAY, along, ascusState, cushionGrown, cushions, litter, onCushion, patch, species, state, type Cushion, type Genome, type Stalk, type V3 } from './genome';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
let seed = Number(params.get('seed')) || Math.floor(Math.random() * 9000) + 1;

const canvas = document.getElementById('macro') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false })!;
if (!gl) throw new Error('WebGL2 is needed');
if (preview) document.body.classList.add('preview');
const hdr = !!gl.getExtension('EXT_color_buffer_float');
const MYC = 48;

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
// wet: the sheen and the glints of a wet surface
vec3 wetness(vec3 n, vec3 v, vec3 p, float wet, float k) {
  vec3 r = reflect(-v, n);
  float f = .03 + .97 * pow(1. - max(dot(n, v), 0.), 5.);
  vec3 c = env(r) * f * (.25 + .75 * wet);
  float s = pow(max(dot(r, uLight), 0.), 60. + 300. * wet);
  // (sparkle: the tiny facets of a wet skin catching the light, here and there)
  float sp = smoothstep(.82, .97, n2(p.xz * k + p.y * k * .7)) * smoothstep(.85, .99, dot(r, uLight));
  return c + uLightCol * (s * (1. + 5. * wet) + sp * 12. * wet);
}
`;
const QUAD_VS = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); gl_Position = vec4(p, 0., 1.); }`;

// the ground: dung or litter, lumpy, crumbly, fibrous, wet in its hollows, white with mycelium
const GROUND_VS = `#version 300 es
in vec2 aXZ;
uniform mat4 uVP;
uniform float uS;
out vec3 vW;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
float hgt(vec2 p) { return (n2(p * .18) - .5) * 1.4 + (n2(p * .6 + 7.) - .5) * .55 + (n2(p * 1.9 + 3.) - .5) * .18; }
void main() {
  vec2 p = aXZ * uS;
  float y = (hgt(aXZ) - smoothstep(20., 70., length(aXZ)) * 3.) * uS;
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
${COMMON}
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
  c *= 1. - wet * .35;
  // mycelium: white threads in patches, and round the feet of the stalks
  float myc = uMyc * smoothstep(.62, .8, fbm(p * .45 + 30.));
  for (int i = 0; i < ${MYC}; i++) {
    vec4 f = uFeet[i];
    if (f.w <= 0.) continue;
    float d = length(vW.xz - f.xy) / f.z;
    myc = max(myc, f.w * smoothstep(1., .2, d));
  }
  float threads = smoothstep(.45, .8, n2(p * vec2(40., 9.) + n2(p * 6.) * 6.)) + smoothstep(.55, .85, n2(p * vec2(9., 40.) + 17.));
  c = mix(c, vec3(.88, .88, .84), clamp(myc * (.35 + .5 * threads), 0., .9));
  float diff = .3 + .7 * max(dot(n, uLight), 0.);
  vec3 col = c * diff * uLightCol;
  col += wetness(n, v, vec3(p.x, 0., p.y), wet, 9.);
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
  vec3 p = aBase + vec3(dir.x * lean * .5 * u * u + side.x * w * .12, u - sag * u * u, dir.y * lean * .5 * u * u + side.y * w * .12) * L;
  vec3 t = normalize(vec3(dir.x * lean * u, 1. - 2. * sag * u, dir.y * lean * u));
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
  float fibre = n2(vec2(vA * 7., vU * vL * 6. / uS));
  float hairs = smoothstep(.7, .92, n2(vec2(vA * 22., vU * vL * 38. / uS)));
  float top = smoothstep(1. - vLook.x - .03, 1. - vLook.x + .02, vU);
  float yellow = vLook.x <= 0. ? 0. : uThrows > .5 ? top * (1. - smoothstep(.0, .06, vU - (1. - vLook.x * .55))) + top * .12 : top;
  vec3 tint = mix(uGlass, uTip, clamp(yellow, 0., 1.));
  tint = mix(tint, vec3(.55, .5, .38), vSlump * .7);
  // glass: what's behind, bent toward its edges; the light through it
  vec3 nvw = (uView * vec4(n, 0.)).xyz;
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 behind = texture(uBehind, clamp(uv - nvw.xy * (1. - nv) * 18. / uRes, 0., 1.)).rgb;
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
  vel += vec3(1.) * hairs * fuzz * .22 * (.4 + pow(1. - nv, 1.5));
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
${COMMON}
void main() {
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  vec3 v = normalize(uEye - vW);
  if (dot(n, v) < 0.) n = -n;
  float t = vTA.x;
  float nv = max(dot(n, v), 0.);
  float ink = vC.y * smoothstep(1. - vC.y * .6, 1., t);
  vec3 c;
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
void main() {
  float a = aPT.x * 1.5708;
  float th = aPT.y;
  float R = aShape.x * aShape.z, H = aShape.y * aShape.z;
  vec3 ring = vec3(cos(th), 0., sin(th));
  vec3 p = aC + ring * sin(a) * R + vec3(0., (cos(a) * .55 + .45) * H, 0.);
  vec3 n = normalize(ring * sin(a) * H + vec3(0., cos(a) * R * .55, 0.));
  // its lumps, and the wrinkles of its skin (the seam at th = 2π is matched by the noise's period)
  vec2 q = vec2(sin(th) * 2.5 + 3., cos(th) * 2.5 + aPT.x * 4.) + aShape.w;
  float lump = (n2(q) - .5) * .16 + (n2(q * 3.1 + 5.) - .5) * .06 + (n2(q * 9. + 9.) - .5) * .02;
  p += n * lump * R * (1. - aPT.x * aPT.x * .6);
  vW = p;
  vO = vec3(aPT.x, th, aShape.w);
  gl_Position = uVP * vec4(p, 1.);
}`;
const JELLY_FS = `#version 300 es
precision highp float;
in vec3 vW;
in vec3 vO;
out vec4 o;
uniform sampler2D uBehind;
uniform vec2 uRes;
uniform mat4 uView;
uniform vec3 uJelly, uDeep;
${COMMON}
void main() {
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  vec3 v = normalize(uEye - vW);
  if (dot(n, v) < 0.) n = -n;
  // (its skin's fine wrinkles, for the light)
  vec2 q = vec2(sin(vO.y) * 14. + 20., cos(vO.y) * 14. + vO.x * 22.) + vO.z;
  n = normalize(n + (vec3(n2(q), n2(q + 3.), n2(q + 7.)) - .5) * .5);
  float nv = max(dot(n, v), 0.);
  vec3 nvw = (uView * vec4(n, 0.)).xyz;
  vec2 uv = gl_FragCoord.xy / uRes;
  // through it: what's inside it (the asci, their spores), bent and drowned in its colour
  vec3 behind = texture(uBehind, clamp(uv - nvw.xy * (1. - nv) * 22. / uRes, 0., 1.)).rgb;
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
const sphereVerts: number[] = [];
{
  const la = 16;
  const lo = 24;
  const p = (i: number, j: number) => {
    const t = (i / la) * Math.PI;
    const f = (j / lo) * Math.PI * 2;
    return [Math.sin(t) * Math.cos(f), Math.cos(t), Math.sin(t) * Math.sin(f)];
  };
  for (let i = 0; i < la; i++) for (let j = 0; j < lo; j++) {
    sphereVerts.push(...p(i, j), ...p(i + 1, j), ...p(i + 1, j + 1), ...p(i, j), ...p(i + 1, j + 1), ...p(i, j + 1));
  }
}
const SPH: Array<[string, number]> = [['aC', 3], ['aR', 3], ['aCol', 4]];
const solids = instanced(solidProg, sphereVerts, [['aP', 3]], SPH);
const drops = instanced(dropProg, sphereVerts, [['aP', 3]], SPH);
const tubes = instanced(stalkProg, grid(48, 16, (k) => 1 - Math.pow(1 - k, 1.5)), [['aUA', 2]], [['aBase', 3], ['aDir', 4], ['aShape', 4], ['aMore', 4], ['aLook', 4]]);
// (fine hairs: the same tube, far fewer rings)
const hairs = instanced(stalkProg, grid(5, 4), [['aUA', 2]], [['aBase', 3], ['aDir', 4], ['aShape', 4], ['aMore', 4], ['aLook', 4]]);
const bells = instanced(bellProg, grid(40, 112), [['aTA', 2]], [['aAt', 3], ['aAxis', 3], ['aB', 4], ['aC', 4]]);
const jellies = instanced(jellyProg, grid(36, 72), [['aPT', 2]], [['aC', 3], ['aShape', 4]]);
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

// ─── the specimen ───────────────────────────────────────────────────────────────────────────────
let g: Genome;
let stalks: Stalk[];
let cups: Cushion[];
let bits: ReturnType<typeof litter>;
/** the scale of things: the noise and the ground go by it (1: a thrower 8 mm tall) */
let S = 1;
function grow(s: number) {
  seed = s;
  g = species(seed);
  stalks = patch(seed, g);
  cups = cushions(seed, g);
  bits = litter(seed, g);
  S = g.form === 'cup' ? g.cushion / 4 : g.scale / 8;
  T = 0;
  focusAt = null;
  subject = -1;
  focus = 30 * S;
  const url = new URL(location.href);
  url.searchParams.set('seed', String(seed));
  if (!preview) history.replaceState(null, '', url);
  label();
}
function label() {
  const el = document.getElementById('label');
  if (!el) return;
  const what = {
    thrower: `throws its sporangia · ${g.vesicle > 0.8 ? 'a great vesicle' : 'a vesicle'} · ${g.height[1].toFixed(0)} mm`,
    pin: `a pin mould · yellow-headed · ${g.height[1].toFixed(0)} mm`,
    inkcap: `an inkcap · ${g.pleats} pleats · ${g.height[1].toFixed(0)} mm`,
    cup: `a jelly cup · fires its asci · ${(g.cushion * 2).toFixed(1)} mm`,
  }[g.form];
  el.innerHTML = `<i>${g.name}</i><span>${what}</span>`;
}

// ─── the day ────────────────────────────────────────────────────────────────────────────────────
let T = 0;
let playing = true;
const RATE = DAY / (preview ? 40 : 55);
const scrub = document.getElementById('scrub') as HTMLInputElement | null;
scrub?.addEventListener('input', () => {
  T = (Number(scrub.value) / 1000) * DAY;
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
function camera(t: number) {
  const aspect = W / Hh;
  const mid = g.form === 'cup' ? g.cushion * 2.6 : (g.height[0] + g.height[1]) / 2;
  const look: V3 = [0, mid * (g.form === 'cup' ? 0.45 : 0.55), 0];
  const d = (mid * 2.3 + 4 * S) / zoom / Math.min(1.2, Math.max(0.75, aspect * 1.4));
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

// ─── the frame's things ─────────────────────────────────────────────────────────────────────────
/** A point along a tube that isn't a stalk (an ascus): the tube shader's sums, with no wave. */
function tubeAt(base: V3, dir: [number, number], lean: number, L: number, u: number): V3 {
  return [base[0] + dir[0] * lean * 0.5 * u * u * L, base[1] + u * L, base[2] + dir[1] * lean * 0.5 * u * u * L];
}
function things() {
  const solid: number[] = [];
  const dew: number[] = [];
  const tube: number[] = [];
  const bell: number[] = [];
  const jelly: number[] = [];
  const feet: number[] = [];
  const hair: number[] = [];
  for (const b of bits.beads) solid.push(...b.p, b.r, b.r * b.flat, b.r, ...g.bead, 1);
  for (const c of bits.crumbs) solid.push(...c.p, ...c.r, ...c.c, 2);
  for (const p of bits.pools) dew.push(p.p[0], p.r * 0.12, p.p[2], p.r, p.r * 0.35, p.r, 1, 1, 1, 1);
  const velvet = g.form === 'inkcap';
  for (const st of stalks) {
    const s = state(st, T);
    if (s.grown <= 0.001) continue;
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
      solid.push(st.base[0], 0, st.base[2], fr, fr * 0.6, fr, 0.9, 0.9, 0.87, 3);
      // the mycelium round its foot: threads out over the ground and up its base, curling
      let q = Math.floor(st.phase * 9973) >>> 0;
      const rnd = () => ((q = (Math.imul(q, 1664525) + 1013904223) >>> 0) / 4294967296);
      const n = Math.round(26 * g.mycelium);
      for (let k = 0; k < n; k++) {
        const a = rnd() * Math.PI * 2;
        const d = st.r * (0.6 + rnd() * 2.2);
        const b: V3 = [st.base[0] + Math.cos(a) * d, 0, st.base[2] + Math.sin(a) * d];
        const L = st.r * (1.5 + rnd() * 4) * (0.4 + 0.6 * s.grown);
        hair.push(...b, Math.cos(a), Math.sin(a), 2 + rnd() * 5, 0, L, st.r * 0.08, 0, 1, 0, 0.6, rnd() * 9, 0, 0, 0, 0.25, 0.2);
      }
      if (feet.length < MYC * 4) feet.push(st.base[0], st.base[2], st.r * 9, g.mycelium);
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
  for (const c of cups) {
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
  while (feet.length < MYC * 4) feet.push(0, 0, 1, 0);
  return { solid, dew, tube, bell, jelly, feet, hair };
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
  if (playing) T += dt * RATE;
  if (T > DAY + 1.5) T = 0;
  fade = Math.min(1, T < 0.6 ? T / 0.6 : T > DAY + 0.8 ? Math.max(0, (DAY + 1.5 - T) / 0.7) : 1);
  if (scrub && document.activeElement !== scrub) scrub.value = String(Math.round((Math.min(T, DAY) / DAY) * 1000));
  clock();

  // (a new day: everything can fire again)
  if (T < lastT) jolted = new WeakSet();
  lastT = T;
  shake *= Math.exp(-dt * 5);
  const cam = camera(time);
  lastCam = cam;
  pullFocus(cam, dt);
  const warm = g.warmth;
  const lightCol: V3 = [1, 0.9 + 0.08 * (1 - warm), 0.75 + 0.2 * (1 - warm)];
  const sky: V3 = [0.5, 0.6, 0.42];
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
    gl.uniform3fv(u(p, 'uLight'), g.light);
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
  gl.bindVertexArray(groundVao);
  gl.drawArrays(gl.TRIANGLES, 0, groundCount);
  common(solidProg);
  gl.uniform1f(u(solidProg, 'uFocal'), cam.focal);
  draw(solids, th.solid);
  if (th.bell.length) {
    common(bellProg);
    gl.uniform3fv(u(bellProg, 'uBell'), g.bellColour);
    gl.uniform3fv(u(bellProg, 'uBellTop'), g.bellTop);
    draw(bells, th.bell);
  }
  // 2. the glass: jelly and tubes, seeing through to it
  copyScene();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, copyTex);
  if (th.jelly.length) {
    common(jellyProg);
    gl.uniformMatrix4fv(u(jellyProg, 'uView'), false, cam.view);
    gl.uniform2f(u(jellyProg, 'uRes'), W, Hh);
    gl.uniform3fv(u(jellyProg, 'uJelly'), g.jelly);
    gl.uniform3fv(u(jellyProg, 'uDeep'), g.jellyDeep);
    gl.uniform1i(u(jellyProg, 'uBehind'), 0);
    draw(jellies, th.jelly);
  }
  common(stalkProg);
  gl.uniformMatrix4fv(u(stalkProg, 'uView'), false, cam.view);
  gl.uniform2f(u(stalkProg, 'uRes'), W, Hh);
  gl.uniform3fv(u(stalkProg, 'uGlass'), g.form === 'cup' ? mixV([0.95, 0.97, 0.92], g.jelly, 0.3) : g.glass);
  gl.uniform3fv(u(stalkProg, 'uTip'), g.tip);
  gl.uniform3fv(u(stalkProg, 'uVelvet'), mixV(g.bellColour, [1, 1, 1], 0.55));
  gl.uniform1f(u(stalkProg, 'uThrows'), g.throws ? 1 : 0);
  gl.uniform1i(u(stalkProg, 'uBehind'), 0);
  draw(tubes, th.tube);
  draw(hairs, th.hair);
  // 3. the droplets, seeing through to all of that
  copyScene();
  common(dropProg);
  gl.uniform1f(u(dropProg, 'uFocal'), cam.focal);
  gl.uniformMatrix4fv(u(dropProg, 'uView'), false, cam.view);
  gl.uniform2f(u(dropProg, 'uRes'), W, Hh);
  gl.bindTexture(gl.TEXTURE_2D, copyTex);
  gl.uniform1i(u(dropProg, 'uBehind'), 0);
  draw(drops, th.dew);
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
  gl.uniform1f(u(dofProg, 'uK'), maxBlur * 2.2);
  gl.uniform1f(u(dofProg, 'uMax'), maxBlur);
  gl.uniform1f(u(dofProg, 'uNear'), cam.near);
  gl.uniform1f(u(dofProg, 'uFar'), cam.far);
  gl.uniform1f(u(dofProg, 'uTime'), time % 100);
  gl.uniform1f(u(dofProg, 'uFade'), fade);
  gl.uniform1f(u(dofProg, 'uExposure'), 1.35);
  gl.bindVertexArray(quadVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
  (window as unknown as { __fungi: unknown }).__fungi = { seed, form: g.form, name: g.name, T: Math.round(T * 100) / 100, tubes: th.tube.length / tubes.stride, drops: th.dew.length / drops.stride, bells: th.bell.length / bells.stride, focus: Math.round(focus * 100) / 100 };
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
  if (cups.length) return cups.map((c) => ({ at: () => onCushion(c, cushionGrown(c, T), 0, 0.2).p, weight: cushionGrown(c, T) }));
  return stalks.map((st) => {
    const s = state(st, T);
    return { at: () => along(st, state(st, T), 0.92).p, weight: s.grown < 0.3 ? -1 : s.swell * 0.4 + s.ripe * 0.2 + s.open * 0.3 };
  });
}
function pullFocus(cam: ReturnType<typeof camera>, dt: number) {
  let target: number;
  if (focusAt && time < focusAt.until) target = depthOf(cam, focusAt.at());
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
  focus += (target - focus) * Math.min(1, dt * 1.6);
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
  for (const st of stalks) for (const uu of [0.3, 0.6, 0.9, 1]) probe(() => along(st, state(st, T), uu).p);
  for (const c of cups) for (const ph of [0, 0.3, 0.6, 0.9]) for (const a of [0, 1.6, 3.1, 4.7]) probe(() => onCushion(c, cushionGrown(c, T), a, ph).p);
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
    pinch = d;
    return;
  }
  yaw += dx * 0.006;
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
}, { passive: false });
document.getElementById('another')?.addEventListener('click', () => grow(Math.floor(Math.random() * 9000) + 1));
document.getElementById('play')?.addEventListener('click', (e) => {
  playing = !playing;
  (e.currentTarget as HTMLElement).textContent = playing ? 'pause' : 'play';
});
function clock() {
  const el = document.getElementById('clock');
  if (!el) return;
  const hour = (21 + Math.min(T, DAY)) % 24;
  el.textContent = `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}`;
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
if (params.get('t')) T = Number(params.get('t'));
requestAnimationFrame(frame);

/**
 * Every pixel of the pond. One sun, one sky, one noise texture, shared by all
 * passes so the light agrees everywhere:
 *
 *   occ      pads + hull as coverage, quarter res   → shadows on the bed, wave damping
 *   sim      heightfield wave equation              → ripples from taps, bow, oars, bumps
 *   under    bed · caustics · fish · sunken leaves  → what you see through the water
 *   surface  refraction of `under`, sky fresnel, sun glints on the ripples
 *   pads     one shader for every pad; dew drops are lenses computed per pixel
 *   flowers, boat (+ its shadow), ribbons (rope, thread), motes, grade
 *
 * World space: +x right, +y forward (up the screen), +z toward the viewer.
 * `uView = (camX, camY, 2*zoom/cssW, 2*zoom/cssH)` maps world to clip.
 */

const HEAD = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** Uniforms and helpers every fragment stage may use. */
const COMMON = /* glsl */ `
uniform vec4 uView;
uniform float uTime;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec3 uAmb;
uniform vec3 uSky0;
uniform vec3 uSky1;
uniform sampler2D uNoise;
const float TAU = 6.28318530718;
vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }
float nz(vec2 p){ return texture(uNoise, p).r; }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

const FULLSCREEN_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;
uniform vec4 uView;
out vec2 vUv;
out vec2 vWorld;
void main(){
  vUv = aPos * .5 + .5;
  vWorld = uView.xy + aPos / uView.zw;
  gl_Position = vec4(aPos, 0., 1.);
}`;

// ─── wave simulation ────────────────────────────────────────────────────────

export const SIM_FS = /* glsl */ `${HEAD}
in vec2 vUv;
out vec4 o;
uniform sampler2D uPrev;
uniform sampler2D uOcc;
uniform vec2 uTexel;
uniform vec2 uShift;
uniform vec4 uRect;
uniform float uSimScale;
uniform vec4 uImp[24];
uniform int uImpN;
float at(vec2 uv){
  if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return 0.;
  return texture(uPrev, uv).r;
}
void main(){
  vec2 uv = vUv + uShift;
  vec2 c = (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) ? vec2(0.) : texture(uPrev, uv).rg;
  float l = at(uv - vec2(uTexel.x, 0.)), r = at(uv + vec2(uTexel.x, 0.));
  float d = at(uv - vec2(0., uTexel.y)), u = at(uv + vec2(0., uTexel.y));
  // slow waves: c^2 well under the 0.5 stability limit keeps ripples at a walking pace
  float h = 2. * c.r - c.g + .16 * (l + r + u + d - 4. * c.r);
  h *= .991;
  float occ = texture(uOcc, (vUv - .5) * uSimScale + .5).r;
  h *= 1. - occ * .06;
  vec2 wp = uRect.xy + vUv * uRect.zw;
  for (int i = 0; i < 24; i++) {
    if (i >= uImpN) break;
    vec4 im = uImp[i];
    float k = 1. - smoothstep(0., im.z, length(wp - im.xy));
    h -= im.w * k * .35;
  }
  o = vec4(clamp(h, -4., 4.), c.r, 0., 1.);
}`;

// ─── riverbed, caustics, pad shadows through the water column ─────────────

export const BED_FS = /* glsl */ `${HEAD}${COMMON}
in vec2 vUv;
in vec2 vWorld;
out vec4 o;
uniform sampler2D uOcc;
uniform vec2 uChan[33];
uniform vec2 uSpanY;
float caustic(vec2 uv, float time){
  vec2 p = mod(uv * TAU, TAU) - 250.;
  vec2 i = p; float c = 1.; float inten = .005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1. - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1. / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 4.; c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.);
}
float depthAt(vec2 wp){
  float f = clamp((wp.y - uSpanY.x) / (uSpanY.y - uSpanY.x), 0., 1.) * 32.;
  int i = int(floor(f));
  vec2 ch = mix(uChan[i], uChan[min(i + 1, 32)], fract(f));
  float off = abs(wp.x - ch.x);
  float open = 1. - smoothstep(ch.y * .35, ch.y + 120., off);
  float n = texture(uNoise, wp / 512.).r;
  return .38 + .7 * open + .35 * (n - .5);
}
void main(){
  vec2 wp = vWorld;
  float depth = depthAt(wp);
  float n1 = texture(uNoise, wp / 512.).g;
  float n2 = texture(uNoise, wp / 128.).r;
  float n3 = texture(uNoise, wp / 64.).g;
  vec3 silt = mix(vec3(.16, .18, .11), vec3(.27, .27, .17), n1);
  silt = mix(silt, vec3(.12, .17, .09), smoothstep(.55, .8, n2) * .7);          // weed mats
  float ripple = sin(dot(wp, vec2(.09, .05)) + n2 * 7.) * .5 + .5;              // sand ripples
  silt *= .88 + .18 * ripple * (1. - n1);
  float cell = texture(uNoise, wp / 48.).b;                                      // pebbles
  float stone = smoothstep(.42, .26, cell) * step(.62, hash12(floor(wp / 48. * 24.)));
  silt = mix(silt, vec3(.33, .31, .24) * (.8 + .4 * n3), stone * .8);
  silt *= .75 + .5 * n3;

  // pads shade the bed from above: their shadow lands offset along the sun, softer with depth
  vec2 off = -uSun.xy / max(uSun.z, .3) * depth * 42.;
  vec2 suv = vUv + off * uView.zw * .5;
  float sh = 0.;
  float blur = .004 + depth * .006;
  sh += texture(uOcc, suv).r * .4;
  sh += texture(uOcc, suv + vec2(blur, 0.)).r * .15;
  sh += texture(uOcc, suv - vec2(blur, 0.)).r * .15;
  sh += texture(uOcc, suv + vec2(0., blur)).r * .15;
  sh += texture(uOcc, suv - vec2(0., blur)).r * .15;
  float light = 1. - sh * .9;

  float c = caustic(wp / 256., uTime * .35) * 1.4 + caustic(wp / 128. + .37, uTime * .27) * .6;
  c *= light * (1.25 - depth * .6);
  vec3 lit = silt * (uAmb * .8 + uSunCol * (.45 + c * 1.1) * light);

  vec3 deep = vec3(.015, .085, .075);
  float absorb = 1. - exp(-depth * 2.4);
  o = vec4(mix(lit, deep, absorb), 1.);
}`;

// ─── fish ──────────────────────────────────────────────────────────────────

export const FISH_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 iA; // x, y, heading, size
layout(location=2) in vec4 iB; // z, kind, phase, speed
uniform vec4 uView;
uniform vec3 uSun;
uniform float uShadow;
out vec2 vQ;
out vec4 vB;
out vec2 vUv;
void main(){
  float z = iB.x;
  float len = iA.w * (1. - z * .18);
  vec2 q = aPos * vec2(.55, 1.05);
  vec2 local = q * vec2(len * .55, len);
  float c = cos(iA.z), s = sin(iA.z);
  vec2 w = vec2(local.x * c + local.y * s, -local.x * s + local.y * c);
  vec2 pos = iA.xy + w;
  if (uShadow > .5) pos += -uSun.xy / max(uSun.z, .3) * (1.1 - z) * 38.;
  vQ = q;
  vB = iB;
  vec2 clip = (pos - uView.xy) * uView.zw;
  vUv = clip * .5 + .5;
  gl_Position = vec4(clip, 0., 1.);
}`;

export const FISH_FS = /* glsl */ `${HEAD}${COMMON}
in vec2 vQ;
in vec4 vB;
in vec2 vUv;
out vec4 o;
uniform float uShadow;
uniform sampler2D uOcc;
void main(){
  float z = vB.x, kind = vB.y, phase = vB.z, speed = vB.w;
  float along = vQ.y;
  float swim = uTime * (3. + speed * .12) + phase;
  float wave = sin(along * 3.2 - swim) * .16 * pow(clamp((1. - along) * .5, 0., 1.), 1.4);
  float x = vQ.x - wave;
  float soft = fwidth(vQ.x) * 1.5 + z * .1 + uShadow * .25;
  // body: a teardrop, widest behind the head
  float t = clamp((along + .62) / 1.56, 0., 1.);
  float bw = .4 * pow(sin(t * 3.14159), .75) * (1. - .25 * t);
  float body = 1. - smoothstep(bw - soft, bw + soft, abs(x));
  body *= step(-.66, along) * (1. - smoothstep(.93, .96, along));
  // tail fan, forked
  float tf = clamp((-.58 - along) / .42, 0., 1.);
  float tw = .05 + tf * .34;
  float tail = (1. - smoothstep(tw - soft, tw + soft, abs(x))) * step(along, -.58) * step(-1., along);
  tail *= 1. - (1. - smoothstep(.0, .12 + soft, abs(x))) * smoothstep(.55, 1., tf) * .9;
  // pectoral fins
  float fin = 0.;
  for (int k = -1; k <= 1; k += 2) {
    vec2 fp = vec2(x - float(k) * .34, along - .28);
    fp = rot(fp, float(k) * (.6 + .2 * sin(swim * .7)));
    fin = max(fin, 1. - smoothstep(1. - soft * 4., 1. + soft * 4., length(fp / vec2(.09, .17))));
  }
  float cover = max(body, max(tail * .8, fin * .6));
  if (cover < .003) discard;
  if (uShadow > .5) { o = vec4(0., 0., 0., cover * .22 * (1. - z * .6)); return; }
  vec3 col;
  if (kind < .5) col = vec3(.10, .13, .09) + vec3(.05, .06, .03) * smoothstep(.2, .0, abs(x));
  else if (kind < 1.5) col = vec3(.70, .70, .60);
  else {
    float blot = texture(uNoise, vQ * .35 + phase * .013).r;
    col = mix(vec3(.86, .84, .78), vec3(.85, .38, .12), smoothstep(.45, .55, blot));
  }
  // dorsal shade and a lighter flank catch
  col *= 1. - .35 * (1. - smoothstep(0., bw * .7, abs(x))) * step(.5, kind);
  col *= .85 + .3 * smoothstep(-.2, .3, x * sign(uSun.x + .01) * -1.);
  // a rounded back, and eyes on the pale fish
  float cyl = 1. - pow(clamp(abs(x) / max(bw, .01), 0., 1.), 2.);
  col *= mix(1., .62 + .5 * cyl, body);
  float eye = length(vec2(abs(x) - bw * .5, along - .74));
  col = mix(col, vec3(.04, .04, .03), (1. - smoothstep(.03, .05, eye)) * step(.5, kind) * body);
  // fins and tail are thin: more water shows through
  col = mix(col, col * .6 + vec3(.02, .08, .07), max(tail, fin) * (1. - body) * .5);
  float shade = 1. - texture(uOcc, vUv).r * .55;
  col *= (uAmb * .9 + uSunCol * .55) * shade;
  vec3 deep = vec3(.015, .085, .075);
  col = mix(col, deep, z * .72);
  o = vec4(col, 1.) * cover * (1. - z * .35);
}`;

// ─── pads (floating, submerged, and as occluders) ─────────────────────────

export const PAD_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 iA; // x, y, r, angle
layout(location=2) in vec4 iB; // seed, sel, bob, row
layout(location=3) in vec4 iC; // drops, focus, submerged depth, tint
uniform vec4 uView;
uniform float uMode; // 0 floating, 1 occlusion, 2 submerged
vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }
out vec2 vP;
out vec4 vB;
out vec4 vC;
out float vAng;
out float vR;
void main(){
  float s = uMode > .5 && uMode < 1.5 ? 1.02 : 1.36;
  vec2 q = aPos * s;
  float r = iA.z * (1. - iB.z * .035);
  vec2 w = rot(q * r, iA.w);
  vP = q;
  vB = iB;
  vC = iC;
  vAng = iA.w;
  vR = r;
  gl_Position = vec4((iA.xy + w - uView.xy) * uView.zw, 0., 1.);
}`;

export const PAD_FS = /* glsl */ `${HEAD}${COMMON}
in vec2 vP;
in vec4 vB;
in vec4 vC;
in float vAng;
in float vR;
out vec4 o;
uniform float uMode;
uniform sampler2D uDrops;
uniform float uPx; // world units per device pixel

float seed;
vec2 so; // seed offset into the noise tile

float shapeD(vec2 p){
  float a = atan(p.x, p.y);
  float len = length(p);
  float R = .965 + .016 * sin(a * 9. + seed * 20.) + .01 * sin(a * 23. + seed * 7.)
          + .03 * (texture(uNoise, vec2(a / TAU * 3., seed * 5.)).r - .5);
  float nw = (.03 + .07 * len) * (.7 + .5 * fract(seed * 3.7));
  return max(len - R, (nw - abs(a)) * len);
}

float veins(vec2 p, float len){
  // measured as arc length in leaf units, so a vein keeps its width from hub to rim
  float a = atan(p.x, p.y);
  float N = 17. + floor(fract(seed * 5.3) * 8.);
  float warp = texture(uNoise, p * .18 + so).r - .5;
  float f = a * N / TAU + warp * .35 + len * .25;
  float arc = TAU * max(len, .02) / N;
  float d1 = abs(fract(f + .5) - .5) * arc;
  float aa = uPx / vR;
  float w1 = .006 + .012 * (1. - len);
  float primary = 1. - smoothstep(w1 * .3, w1 + aa, d1);
  // each vein forks toward the rim
  float d2 = abs(fract(f * 2.) - .5) * arc * .5;
  float secondary = (1. - smoothstep(.002, .006 + aa, d2)) * smoothstep(.45, .75, len) * .5;
  return max(primary * smoothstep(.03, .1, len), secondary);
}

float curl;
float heightAt(vec2 p){
  float len = length(p);
  float h = .045 * (1. - len * len);
  h += .1 * curl * smoothstep(.78, 1., len);
  h -= .007 * veins(p, len);
  h += .014 * (texture(uNoise, p * .5 + so * 2.3).g - .5);
  return h;
}

vec3 albedo(vec2 p, float len, float vein){
  float n = texture(uNoise, p * .22 + so).r;
  float n2 = texture(uNoise, p * .7 + so * 3.1).g;
  float cellv = texture(uNoise, p * 1.3 + so * 1.7).b;
  // three families of green, from deep emerald to spring lime
  float tint = vC.w;
  vec3 dark = mix(vec3(.05, .18, .09), vec3(.12, .33, .12), smoothstep(.25, .7, tint));
  vec3 lite = mix(vec3(.14, .36, .15), vec3(.50, .68, .22), smoothstep(.5, 1., tint));
  vec3 c = mix(dark, lite, .2 + .6 * n);
  c = mix(c, vec3(.62, .74, .30), smoothstep(.6, .95, n2) * .22);
  // soft areoles between the veinlets, not a pattern — just the surface breathing
  c *= .94 + .1 * smoothstep(.05, .35, cellv);
  float age = fract(seed * 7.31);
  c = mix(c, vec3(.62, .57, .25), smoothstep(.6, .85, texture(uNoise, p * .2 + so * 4.).g) * max(0., age - .5) * 1.2);
  float spot = 1. - smoothstep(.02, .06, texture(uNoise, p * 1.2 + so * 6.).b);
  c = mix(c, vec3(.33, .25, .10), spot * step(.84, age) * .5);
  c = mix(c, c * 1.18 + vec3(.05, .06, .02), vein * .55);
  c *= .88 + .16 * (1. - len);
  return c;
}

/** Leaf colour at p, lit by the sun (no drops). */
vec3 leafLit(vec2 p, vec3 Ll, out float vein){
  float len = length(p);
  vein = veins(p, len);
  float e = .014;
  float h0 = heightAt(p);
  float hx = heightAt(p + vec2(e, 0.));
  float hy = heightAt(p + vec2(0., e));
  vec3 n = normalize(vec3(-(hx - h0) / e, -(hy - h0) / e, 1.) * vec3(1.6, 1.6, 1.));
  vec3 a = albedo(p, len, vein);
  float wrap = max((dot(n, Ll) + .35) / 1.35, 0.);
  vec3 c = a * (uAmb + uSunCol * wrap * .95);
  vec3 H = normalize(Ll + vec3(0., 0., 1.));
  float nh = max(dot(n, H), 0.);
  c += uSunCol * (pow(nh, 90.) * .3 + pow(nh, 14.) * .045);
  // the curled rim shows a little of the wine-red underside
  float rimAmt = smoothstep(.86, .99, len) * curl * fract(seed * 11.3);
  c = mix(c, vec3(.34, .12, .10) * (uAmb + uSunCol * .5), rimAmt * .55);
  return c;
}

void main(){
  seed = vB.x;
  so = vec2(seed * 37.1, seed * 91.7);
  curl = .35 + .65 * fract(seed * 2.9);
  vec2 p = vP;
  float d = shapeD(p);
  float aa = uPx / vR * 1.5;

  if (uMode > .5 && uMode < 1.5) { // occlusion
    o = vec4(1. - smoothstep(-aa, aa, d), 0., 0., 1.);
    return;
  }

  // sun and sky in pad-local space
  vec3 Ll = vec3(rot(uSun.xy, -vAng), uSun.z);
  float sel = vB.y;

  if (uMode > 1.5) { // submerged: soft, tinted, no dew
    float depth = vC.z;
    float cover = 1. - smoothstep(-.02 - depth * .1, .04 + depth * .12, d);
    if (cover < .003) discard;
    float vein;
    vec3 c = leafLit(p, Ll, vein) * vec3(.75, .95, .85);
    c = mix(c, vec3(.015, .085, .075), .45 + depth * .45);
    o = vec4(c, 1.) * cover * .9;
    return;
  }

  // outside the leaf: a soft contact shadow, and a warm halo when chosen
  if (d > 0.) {
    vec2 sp = p + Ll.xy * .06;
    float sd = shapeD(sp);
    float shadow = (1. - smoothstep(0., .16, sd)) * .42;
    float halo = (1. - smoothstep(0., .3, d)) * sel * .35;
    if (shadow < .002 && halo < .002) discard;
    o = vec4(vec3(1., .86, .5) * halo, shadow);
    return;
  }

  float vein;
  vec3 col = leafLit(p, Ll, vein);

  // dew: each drop a lens resting on the leaf
  int count = int(vC.x + .5);
  int row = int(vB.w + .5);
  float shadow = 0.;
  float inside = 0.;
  vec2 dq = vec2(0.);
  vec4 dd = vec4(0.);
  for (int i = 0; i < 10; i++) {
    if (i >= count) break;
    vec4 dr = texelFetch(uDrops, ivec2(i, row), 0);
    if (dr.w < .01) continue;
    float rr = dr.z * (.35 + .65 * dr.w);
    vec2 q = (p - dr.xy) / rr;
    float sdist = length(q + Ll.xy * .62);
    shadow = max(shadow, (1. - smoothstep(.7, 1.2, sdist)) * dr.w);
    float dl = length(q);
    if (dl < 1.02 && inside == 0.) { inside = 1.; dq = q; dd = vec4(dr.xy, rr, dr.w); }
  }
  col *= 1. - shadow * .38;

  if (inside > 0.) {
    vec2 q = dq;
    float dl = length(q);
    float z = sqrt(max(0., 1. - dl * dl));
    vec3 n = normalize(vec3(q, z * 1.15));
    vec2 qn = q / max(dl, 1e-4);
    // the lens: a magnified, brighter piece of the leaf beneath
    vec2 pr = dd.xy + q * dd.z * .45 - n.xy * dd.z * .06;
    float v2;
    vec3 under = leafLit(pr, Ll, v2);
    under = mix(vec3(dot(under, vec3(.3, .59, .11))), under, 1.15) * 1.22 + .035;
    // sunlight focused through the drop onto the leaf, on the side away from the sun
    vec2 fc = q + Ll.xy * .45;
    under += uSunCol * vec3(1., .97, .82) * exp(-dot(fc, fc) * 9.) * .75;
    // chosen: the dew catches a warm inner light
    under += vec3(1., .82, .42) * sel * .3 * (1. - dl * .6);
    // refraction bends the edge away: a thin dark rim, heaviest toward the sun
    float toSun = max(0., dot(qn, Ll.xy) / max(length(Ll.xy), 1e-3));
    under *= 1. - smoothstep(.62, .98, dl) * (.38 + .45 * toSun);
    // and light gathers along the far inner edge
    under += vec3(.85, .95, .85) * smoothstep(.55, .95, dl) * (1. - toSun) * smoothstep(.2, .9, dot(qn, -Ll.xy)) * .32;
    // sky in the fresnel
    float fr = .03 + .97 * pow(1. - n.z, 5.);
    vec3 sky = mix(uSky0, uSky1, n.y * .5 + .5);
    vec3 c = mix(under, sky, fr * .7);
    // the sun's pinpoint, and the soft window of the sky around it
    vec3 H = normalize(Ll + vec3(0., 0., 1.));
    float nh = max(dot(n, H), 0.);
    c += uSunCol * (pow(nh, 600.) * 5. + pow(nh, 70.) * .35 + pow(nh, 12.) * .05);
    float edge = 1. - smoothstep(1. - aa / dd.z * 1.5, 1., dl);
    col = mix(col, c, edge * smoothstep(0., .2, dd.w));
  }

  // selection: a luminous rim
  float len = length(p);
  col += vec3(1., .86, .5) * sel * smoothstep(.8, 1., len) * .22;
  // keyboard focus: a thin bright ring
  col = mix(col, vec3(1., .95, .8), vC.y * (1. - smoothstep(0., aa * 2., abs(d + .03))) * .8);

  float cover = 1. - smoothstep(-aa, aa, d);
  o = vec4(col, 1.) * cover;
}`;

// ─── water surface ─────────────────────────────────────────────────────────

export const SURFACE_FS = /* glsl */ `${HEAD}${COMMON}
in vec2 vUv;
in vec2 vWorld;
out vec4 o;
uniform sampler2D uUnder;
uniform sampler2D uSim;
uniform vec2 uSimTexel;
uniform float uSimScale;
uniform float uSimOn;
uniform float uAspect;
void main(){
  vec2 wp = vWorld;
  vec2 g1 = texture(uNoise, wp / 256. + uTime * vec2(.006, .004)).rg - .5;
  vec2 g2 = texture(uNoise, wp / 64. - uTime * vec2(.009, .014)).gr - .5;
  vec2 g3 = texture(uNoise, wp / 32. + uTime * vec2(-.012, .02)).rg - .5;
  vec2 grad = g1 * .09 + g2 * .07 + g3 * .035;
  float h = 0.;
  if (uSimOn > .5) {
    vec2 s = (vUv - .5) / uSimScale + .5;
    h = texture(uSim, s).r;
    float hl = texture(uSim, s - vec2(uSimTexel.x, 0.)).r;
    float hr = texture(uSim, s + vec2(uSimTexel.x, 0.)).r;
    float hd = texture(uSim, s - vec2(0., uSimTexel.y)).r;
    float hu = texture(uSim, s + vec2(0., uSimTexel.y)).r;
    grad += vec2(hr - hl, hu - hd) * .5;
  }
  vec3 n = normalize(vec3(-grad, 1.));
  vec3 under = texture(uUnder, vUv + n.xy * .035).rgb;
  vec3 V = normalize(vec3((vUv - .5) * vec2(uAspect, 1.) * .55, 1.));
  float fr = .02 + .98 * pow(1. - max(dot(n, V), 0.), 5.);
  vec3 R = reflect(-V, n);
  float cloud = texture(uNoise, R.xy * .6 + uTime * vec2(.002, .001)).g;
  vec3 sky = mix(uSky0, uSky1, clamp(R.y * .5 + .5, 0., 1.)) * (.85 + .3 * cloud);
  vec3 col = mix(under, sky, clamp(fr * 2.2 + .05, 0., .6));
  float rs = max(dot(R, uSun), 0.);
  col += uSunCol * (pow(rs, 1400.) * 5. + pow(rs, 90.) * .08);
  col += vec3(.7, .85, .75) * clamp(h, 0., 1.) * .05;
  o = vec4(col, 1.);
}`;

// ─── water lilies ──────────────────────────────────────────────────────────

export const FLOWER_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 iA; // x, y, size, angle
layout(location=2) in vec4 iB; // variant, open, seed, -
uniform vec4 uView;
out vec2 vP;
out vec4 vB;
out float vAng;
void main(){
  vec2 q = aPos * 1.25;
  float c = cos(iA.w), s = sin(iA.w);
  vec2 w = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * iA.z;
  vP = q; vB = iB; vAng = iA.w;
  gl_Position = vec4((iA.xy + w - uView.xy) * uView.zw, 0., 1.);
}`;

export const FLOWER_FS = /* glsl */ `${HEAD}${COMMON}
in vec2 vP;
in vec4 vB;
in float vAng;
out vec4 o;
float petalLayer(vec2 p, float n, float off, float reach, float width, out vec2 lp){
  float a = atan(p.y, p.x) - off;
  float k = floor(a / (TAU / n) + .5);
  float da = a - k * TAU / n;
  float len = length(p);
  lp = vec2(len * cos(da), len * sin(da));
  vec2 e = vec2((lp.x - reach * .52) / (reach * .5), lp.y / (reach * width));
  return length(e);
}
void main(){
  vec2 p = vP;
  float open = vB.y;
  float variant = vB.x;
  vec3 Ll = vec3(rot(uSun.xy, -vAng), uSun.z);
  vec3 tipCol = variant < 1.5 ? vec3(.97, .96, .92) : variant < 2.5 ? vec3(.98, .80, .86) : vec3(.99, .93, .70);
  vec3 baseCol = variant < 2.5 ? vec3(.86, .82, .62) : vec3(.95, .80, .45);
  // shadow on the pad
  vec2 lp;
  float sd = petalLayer(p + Ll.xy * .12, 8., .2, .95 * open, .3, lp);
  float shadow = (1. - smoothstep(.8, 1.3, sd)) * .35;
  vec3 col = vec3(0.);
  float cover = 0.;
  // three rings of petals, inner on top; the first hit from the top wins
  for (int L = 2; L >= 0; L--) {
    float fl = float(L);
    float reach = mix(.55, 1., 1. - fl * .28) * (.55 + .45 * open);
    float n = L == 0 ? 8. : L == 1 ? 8. : 6.;
    float off = fl * .39 + vB.z * 6.;
    float e = petalLayer(p, n, off, reach, .27 - fl * .02, lp);
    if (e < 1.) {
      float along = clamp(lp.x / reach, 0., 1.);
      vec3 c = mix(baseCol, tipCol, smoothstep(.1, .7, along));
      // cupped: brighter where the petal faces the sun, a midrib crease
      vec3 n3 = normalize(vec3(lp.y / reach * 1.5, -(along - .4) * 1.2, 1.));
      n3.xy = rot(n3.xy, atan(p.y, p.x));
      float lit = max((dot(n3, Ll) + .4) / 1.4, 0.);
      c *= uAmb * 1.1 + uSunCol * lit * .85;
      c *= 1. - (1. - smoothstep(0., .05, abs(lp.y / reach))) * .12;
      c *= .82 + .18 * fl;
      col = c;
      cover = 1. - smoothstep(.9, 1., e);
      break;
    }
  }
  // stamens
  float r = length(p);
  if (r < .2) {
    float dots = step(.72, hash12(floor(p * 60.)));
    vec3 c = mix(vec3(.93, .74, .22), vec3(1., .9, .45), dots) * (uAmb + uSunCol * .8);
    float k = 1. - smoothstep(.17, .2, r);
    col = mix(col, c, k);
    cover = max(cover, k);
  }
  if (cover < .003 && shadow < .003) discard;
  o = vec4(col * cover, cover + (1. - cover) * shadow);
}`;

// ─── the boat ──────────────────────────────────────────────────────────────

export const BOAT_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;
uniform vec4 uView;
uniform vec4 uBoat; // x, y, heading, scale
uniform vec3 uSun;
uniform float uShadow;
out vec2 vL;
void main(){
  vec2 local = aPos * vec2(96., 78.);
  float c = cos(uBoat.z), s = sin(uBoat.z);
  vec2 w = vec2(local.x * c + local.y * s, -local.x * s + local.y * c);
  vec2 pos = uBoat.xy + w;
  if (uShadow > .5) pos += -uSun.xy / max(uSun.z, .3) * 9.;
  vL = local;
  gl_Position = vec4((pos - uView.xy) * uView.zw, 0., 1.);
}`;

export const BOAT_FS = /* glsl */ `${HEAD}${COMMON}
in vec2 vL;
out vec4 o;
uniform vec4 uBoat;
uniform vec4 uOar;   // sweep, rowing, stroke, lantern glow
uniform float uShadow;
uniform float uPx;

float hullW(float y){
  float t = y / 56.;
  if (t > 0.) return 20. * sqrt(max(0., 1. - pow(t, 1.9)));
  return 20. * (1. - .3 * pow(min(-t / .96, 1.), 2.4));
}
float sdHull(vec2 p){
  return max(abs(p.x) - hullW(p.y), max(p.y - 56., -54. - p.y));
}
float sdSeg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
  return length(pa - ba * h);
}
float sdEllipse(vec2 p, vec2 r){ return (length(p / r) - 1.) * min(r.x, r.y); }

// oar geometry shared by shape and colour
void oar(float side, out vec2 lock, out vec2 tip, out vec2 handle){
  float sweep = uOar.x;
  lock = vec2(side * (hullW(4.) - 1.), 4.);
  tip = vec2(side * (40. * .42 + cos(sweep) * 56.), 4. - sin(sweep) * 30.);
  vec2 dir = normalize(tip - lock);
  handle = lock - dir * 15.;
}

float sdOars(vec2 p, out float blade){
  float d = 1e5; blade = 1e5;
  for (int k = 0; k < 2; k++) {
    float side = k == 0 ? -1. : 1.;
    vec2 lock, tip, handle;
    oar(side, lock, tip, handle);
    vec2 dir = normalize(tip - lock);
    d = min(d, sdSeg(p, handle, tip - dir * 10.) - 1.4);
    vec2 bp = p - (tip - dir * 3.);
    vec2 bl = vec2(dot(bp, vec2(dir.y, -dir.x)), dot(bp, dir));
    blade = min(blade, sdEllipse(bl, vec2(3.4, 9.)));
  }
  return min(d, blade);
}

float sdRower(vec2 p){
  float lean = sin(uOar.z * TAU) * 3. * uOar.y;
  vec2 q = p - vec2(0., -6. + lean);
  float body = sdEllipse(q, vec2(11., 7.5));
  float head = length(q - vec2(0., 1.5)) - 8.5; // the hat brim
  return min(body, head);
}

void main(){
  vec2 p = vL;
  float aa = uPx * 1.2;
  float dh = sdHull(p);
  float blade;
  float doar = sdOars(p, blade);
  float dr = sdRower(p);
  float dall = min(dh, min(doar, dr));
  if (uShadow > .5) {
    float a = 1. - smoothstep(-4., 5., dall);
    if (a < .003) discard;
    o = vec4(0., 0., 0., a * .42);
    return;
  }
  if (dall > aa) discard;
  vec2 Lxy = rot(uSun.xy, uBoat.z);
  vec3 light = uAmb + uSunCol * .8;
  float grain = texture(uNoise, vec2(p.x * .05, p.y * .006)).r;

  // hull
  vec3 col = vec3(0.);
  if (dh > -3.2) {
    // gunwale: a rounded oak rail, lit on the sun side of its bevel
    float bev = clamp((dh + 3.2) / 3.2, 0., 1.);
    vec2 g = vec2(sign(p.x), 0.);
    float lit = .8 + .35 * dot(g, Lxy) * (bev * 2. - 1.) + .2 * (1. - abs(bev * 2. - 1.));
    col = mix(vec3(.60, .44, .26), vec3(.76, .60, .38), grain) * lit;
  } else {
    // planked floor with ribs, deepening toward the keel
    float plank = floor((p.x + 20.) / 5.2);
    float seam = 1. - smoothstep(.0, .5, abs(fract((p.x + 20.) / 5.2) - .5) * 5.2 - 2.1);
    float tone = hash12(vec2(plank, 3.));
    col = mix(vec3(.36, .25, .15), vec3(.50, .36, .21), tone * .6 + grain * .4);
    col *= 1. - seam * .45;
    float rib = 1. - smoothstep(.6, 1.2, abs(mod(p.y + 3., 10.) - 5.));
    col = mix(col, vec3(.44, .31, .18), rib * .5);
    // the wall on the sun side throws a shadow across the floor
    float sh = smoothstep(-5., -1., sdHull(p + Lxy * 7.));
    col *= 1. - sh * .45;
    col *= .78 + .22 * smoothstep(-3., -12., dh);
    for (int k = 0; k < 3; k++) {
      float sy = k == 0 ? 26. : k == 1 ? -14. : -40.;
      float band = abs(p.y - sy) - 3.2;
      if (band < 0.) col = mix(vec3(.66, .50, .30), vec3(.78, .62, .38), grain) * (.9 + .1 * sin(p.x * .7));
      else if (p.y < sy && band < 2.4) col *= .7;
    }
    float coil = length(p - vec2(-9., -46.));
    col = mix(col, vec3(.55, .20, .14) * (.8 + .2 * sin(coil * 5.)), 1. - smoothstep(4., 5., coil));
  }
  col *= light;
  float lamp = length(p - vec2(0., 46.));
  col = mix(col, vec3(1., .86, .55) * (1. + uOar.w * 1.5), 1. - smoothstep(2.2, 3.2, lamp));
  float cover = 1. - smoothstep(-aa, aa, dh);

  // oars pass over the gunwale
  float oarK = 1. - smoothstep(-aa, aa, doar);
  if (oarK > 0.) {
    vec3 oc = mix(vec3(.55, .40, .24), vec3(.70, .55, .33), texture(uNoise, p * vec2(.3, .02)).r);
    float bladeK = 1. - smoothstep(-aa, aa, blade);
    oc = mix(oc, vec3(.48, .35, .21), bladeK * .5);
    // a blade in the water reads darker and wet
    float wet = uOar.y * smoothstep(.2, .6, sin(uOar.z * TAU) * .5 + .5);
    oc = mix(oc, vec3(.12, .20, .17), bladeK * wet * .55);
    col = mix(col, oc * light, oarK);
    cover = max(cover, oarK);
  }

  // the rower: coat and a woven straw hat
  float rowK = 1. - smoothstep(-aa, aa, dr);
  if (rowK > 0.) {
    float lean = sin(uOar.z * TAU) * 3. * uOar.y;
    vec2 q = p - vec2(0., -6. + lean);
    vec2 hq = q - vec2(0., 1.5);
    float hat = length(hq);
    vec3 rc;
    if (hat < 8.5) {
      float a = atan(hq.y, hq.x);
      float weave = .85 + .15 * sin(hat * 3.2) * sin(a * 18.);
      rc = vec3(.80, .68, .44) * weave;
      vec3 n = normalize(vec3(hq / 8.5 * .9, .8));
      rc *= uAmb + uSunCol * max((dot(n, vec3(Lxy, uSun.z)) + .3) / 1.3, 0.);
      rc *= 1. - smoothstep(7.5, 8.5, hat) * .25;
    } else {
      rc = vec3(.16, .20, .33);
      vec3 n = normalize(vec3(q / vec2(11., 7.5) * .8, .7));
      rc *= uAmb + uSunCol * max((dot(n, vec3(Lxy, uSun.z)) + .3) / 1.3, 0.);
    }
    col = mix(col, rc, rowK);
    cover = max(cover, rowK);
  }
  o = vec4(col, 1.) * cover;
}`;

// ─── ribbons (rope, thread) ────────────────────────────────────────────────

export const RIBBON_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;  // world
layout(location=1) in vec4 iA;    // side, along, alpha, -
uniform vec4 uView;
out vec4 vA;
void main(){
  vA = iA;
  gl_Position = vec4((aPos - uView.xy) * uView.zw, 0., 1.);
}`;

export const RIBBON_FS = /* glsl */ `${HEAD}
in vec4 vA;
out vec4 o;
uniform vec3 uColor;
uniform float uGlow;
uniform float uTime;
void main(){
  float edge = 1. - smoothstep(.3, 1., abs(vA.x));
  if (uGlow > .5) {
    float shimmer = .65 + .35 * sin(vA.y * 40. - uTime * 3.);
    o = vec4(uColor * edge * shimmer * vA.z, 0.);
  } else {
    vec3 c = uColor * (.75 + .35 * (1. - abs(vA.x)));
    o = vec4(c, 1.) * edge * vA.z;
  }
}`;

// ─── motes, pollen, fireflies, gathered dew ───────────────────────────────

export const MOTE_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;  // world
layout(location=1) in vec4 iA;    // size(px), r, g, b
layout(location=2) in vec4 iB;    // alpha, core, -, -
uniform vec4 uView;
uniform float uDpr;
out vec4 vA;
out vec4 vB;
void main(){
  vA = iA; vB = iB;
  gl_PointSize = iA.x * uDpr;
  gl_Position = vec4((aPos - uView.xy) * uView.zw, 0., 1.);
}`;

export const MOTE_FS = /* glsl */ `${HEAD}
in vec4 vA;
in vec4 vB;
out vec4 o;
void main(){
  float r = length(gl_PointCoord - .5) * 2.;
  float glow = exp(-r * r * 4.) * (1. - smoothstep(.8, 1., r));
  float core = (1. - smoothstep(.0, .22, r)) * vB.y;
  o = vec4(vA.yzw * (glow + core) * vB.x, 0.);
}`;

// ─── grade: vignette, a breath of grain ───────────────────────────────────

export const GRADE_FS = /* glsl */ `${HEAD}
in vec2 vUv;
out vec4 o;
uniform float uTime;
uniform float uAspect;
void main(){
  vec2 c = (vUv - vec2(.5, .47)) * vec2(uAspect, 1.);
  float v = smoothstep(.35, 1.05, length(c) * 1.25);
  float g = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 91., vec2(12.9898, 78.233))) * 43758.5453);
  o = vec4(vec3(0.), v * .55 + (g - .5) * .03);
}`;

export const SHADERS = {
  FULLSCREEN_VS,
  SIM_FS,
  BED_FS,
  FISH_VS,
  FISH_FS,
  PAD_VS,
  PAD_FS,
  SURFACE_FS,
  FLOWER_VS,
  FLOWER_FS,
  BOAT_VS,
  BOAT_FS,
  RIBBON_VS,
  RIBBON_FS,
  MOTE_VS,
  MOTE_FS,
  GRADE_FS,
};

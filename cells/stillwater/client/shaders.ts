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
uniform vec4 uLamp; // the boat's lantern: world x, y, reach, intensity
const float TAU = 6.28318530718;
const vec3 LAMP = vec3(1., .72, .42);
uniform vec4 uPierLamp[4];
float pierLampAt(vec2 wp){
  float light=0.;
  for(int i=0;i<4;i++) { if(uPierLamp[i].w<=0.) continue; vec2 d=(wp-uPierLamp[i].xy)/max(uPierLamp[i].z,1.); light+=uPierLamp[i].w*exp(-dot(d,d)*2.5); }
  return light;
}
float lampAt(vec2 wp){ vec2 d = (wp - uLamp.xy) / uLamp.z; return uLamp.w * exp(-dot(d, d) * 2.5) + pierLampAt(wp); }
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
uniform vec4 uImp[48];
uniform int uImpN;
uniform vec2 uFoamFlow; // how far the water moved this step, in sim uv
float at(vec2 uv){
  if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return 0.;
  return texture(uPrev, uv).r;
}
float foamAt(vec2 uv){
  if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return 0.;
  return texture(uPrev, uv).b;
}
void main(){
  vec2 uv = vUv + uShift;
  vec2 c = (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) ? vec2(0.) : texture(uPrev, uv).rg;
  // white water: it belongs to the water, not the place — carried along by the current
  // (so it recedes astern of a boat under way), spreading a touch and fading over a few seconds
  vec2 fuv = uv - uFoamFlow;
  float foam = mix(foamAt(fuv), (foamAt(fuv - vec2(uTexel.x, 0.)) + foamAt(fuv + vec2(uTexel.x, 0.)) + foamAt(fuv - vec2(0., uTexel.y)) + foamAt(fuv + vec2(0., uTexel.y))) * .25, .16) * .9945;
  float l = at(uv - vec2(uTexel.x, 0.)), r = at(uv + vec2(uTexel.x, 0.));
  float d = at(uv - vec2(0., uTexel.y)), u = at(uv + vec2(0., uTexel.y));
  // slow waves: c^2 well under the 0.5 stability limit keeps ripples at a walking pace
  float h = 2. * c.r - c.g + .16 * (l + r + u + d - 4. * c.r);
  h *= .991;
  float occ = texture(uOcc, (vUv - .5) * uSimScale + .5).r;
  h *= 1. - occ * .06;
  vec2 wp = uRect.xy + vUv * uRect.zw;
  for (int i = 0; i < 48; i++) {
    if (i >= uImpN) break;
    vec4 im = uImp[i];
    float k = 1. - smoothstep(0., abs(im.z), length(wp - im.xy));
    h -= im.w * k * .55;
    if (im.z < 0.) foam += im.w * k * .35;
  }
  o = vec4(clamp(h, -4., 4.), c.r, clamp(foam, 0., 2.), 1.);
}`;

// ─── riverbed, caustics, pad shadows through the water column ─────────────

/** The river's shape, shared by bed, surface and mist: channel samples, depth, current. */
const RIVER = /* glsl */ `
uniform vec2 uChan[33];
uniform vec2 uChan2[33];
uniform vec4 uReach[33]; // open, shade, turbidity, maturity
uniform vec2 uSpanY;
uniform float uDepthK;
// the character of the river here (see Reach in world.ts)
vec4 reachAt(float y){
  float f = clamp((y - uSpanY.x) / (uSpanY.y - uSpanY.x), 0., 1.) * 32.;
  float fi = min(floor(f), 31.);
  int i = int(fi);
  return mix(uReach[i], uReach[i + 1], f - fi);
}
vec2 chanAt(float y){
  float f = clamp((y - uSpanY.x) / (uSpanY.y - uSpanY.x), 0., 1.) * 32.;
  float fi = min(floor(f), 31.);
  int i = int(fi);
  return mix(uChan[i], uChan[i + 1], f - fi);
}
vec2 chanAt2(float y){
  float f = clamp((y - uSpanY.x) / (uSpanY.y - uSpanY.x), 0., 1.) * 32.;
  float fi = min(floor(f), 31.);
  int i = int(fi);
  return mix(uChan2[i], uChan2[i + 1], f - fi);
}
float openOf(vec2 ch, vec2 wp){
  return ch.y > .5 ? 1. - smoothstep(ch.y * .35, ch.y + 120., abs(wp.x - ch.x)) : 0.;
}
// the arm of the river this point belongs to (through a fork there are two)
vec2 armAt(vec2 wp){
  vec2 c1 = chanAt(wp.y), c2 = chanAt2(wp.y);
  return openOf(c2, wp) > openOf(c1, wp) ? c2 : c1;
}
float openAt(vec2 wp){
  return max(openOf(chanAt(wp.y), wp), openOf(chanAt2(wp.y), wp));
}
float depthAt(vec2 wp){
  float n = texture(uNoise, wp / 1024.).r;
  float n2 = texture(uNoise, wp / 256.).g;
  return .22 + .78 * openAt(wp) + .3 * (n - .5) + .1 * (n2 - .5);
}
vec2 flowAt(vec2 wp){
  bool second = openOf(chanAt2(wp.y), wp) > openOf(chanAt(wp.y), wp);
  vec2 a = second ? chanAt2(wp.y - 20.) : chanAt(wp.y - 20.);
  vec2 b = second ? chanAt2(wp.y + 20.) : chanAt(wp.y + 20.);
  vec2 tng = normalize(vec2((b.x - a.x) / 40., 1.));
  float open = openAt(wp);
  vec2 f = tng * (2.5 + 11. * open);
  // eddies: the curl of a slow noise field, where the run meets the slack
  float e = (1. - open) * open * 4. * 7.;
  vec2 q = wp / 512. + uTime * .0015;
  float n0 = texture(uNoise, q).r;
  float nx = texture(uNoise, q + vec2(.004, 0.)).r;
  float ny = texture(uNoise, q + vec2(0., .004)).r;
  f += vec2(ny - n0, -(nx - n0)) / .004 * e * .02;
  return f;
}
`;

/**
 * The trees over the river. Nobody sees them directly — the camera looks down —
 * but they are everywhere in the scene twice over: MIRRORED in the water
 * (sky and clouds in the open ribbon over mid-river, leaves reaching out from
 * both banks, stars at night), and as the SHADE they cast, dappling water,
 * bed, leaves and boat with sun flecks through the gaps. One field for both,
 * so the reflection and the shade agree.
 */
const CANOPY = /* glsl */ `
uniform float uDusk;
const float CANOPY_H = 6.;
float canopyAt(vec2 q){
  vec2 ch = armAt(q);
  float off = abs(q.x - ch.x);
  // the trees overhang the banks; how far they reach over the water is the reach's:
  // in a shaded run they close over most of it, in an open pool they stay on the banks
  float sh = reachAt(q.y).y;
  float reach = smoothstep(ch.y * mix(1.05, .12, sh), ch.y + mix(260., 70., sh), off);
  float big = texture(uNoise, q / 760.).r;
  float mid = texture(uNoise, q / 170. + 3.1).g;
  float fine = texture(uNoise, q / 36. + uTime * vec2(.004, .002)).r;
  float leaf = texture(uNoise, q / 11. + uTime * vec2(.006, .003)).b;
  float v = reach * 1.2 + (sh - .5) * .5 + (big - .5) * .8 + (mid - .5) * .55 + (fine - .5) * .35 + (leaf - .5) * .18 - .5;
  // crisp at the leaf edges: a silhouette, not a blur
  return smoothstep(0., .07, v);
}
/** Sunlight reaching a point on the water after the canopy: 1 open sky … ~.35 deep shade, with sun flecks. */
float sunThrough(vec2 wp){
  vec3 L = normalize(uSun);
  // the leaves are low over the water, so their shadow lands close by (a long throw put the
  // whole open run in the bank trees' shade and took the caustics with it)
  vec2 q = wp + L.xy / max(L.z, .3) * 55.;
  float c = canopyAt(q);
  float fleck = smoothstep(.62, .8, texture(uNoise, q / 14. + uTime * vec2(.01, .006)).a);
  return 1. - c * (.65 - fleck * .45);
}
`;

export const BED_FS = /* glsl */ `${HEAD}${COMMON}${RIVER}${CANOPY}
in vec2 vUv;
in vec2 vWorld;
out vec4 o;
uniform sampler2D uOcc;
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
float sdSeg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
  return length(pa - ba * h);
}
void main(){
  // parallax: the bed is deeper than the surface, so it looks smaller and slides slower beneath it
  vec2 rel = vWorld - uView.xy;
  float depth = depthAt(vWorld);
  vec2 wp = uView.xy + rel * (1. + uDepthK * depth);
  depth = depthAt(wp);
  wp = uView.xy + rel * (1. + uDepthK * depth);
  vec3 L = normalize(uSun);
  vec2 fl = flowAt(wp);
  vec2 fd = fl / max(length(fl), .01);
  float open = openAt(wp);

  float n1 = texture(uNoise, wp / 1024.).g;
  float n2 = texture(uNoise, wp / 256.).r;
  float n3 = texture(uNoise, wp / 64.).g;
  float n4 = texture(uNoise, wp / 16.).a;
  // silt in the slack water, paler sand where the current scours
  vec3 silt = mix(vec3(.12, .13, .08), vec3(.21, .20, .13), n1);
  vec3 sand = mix(vec3(.46, .41, .30), vec3(.60, .53, .39), n2);
  float sandy = smoothstep(.4, .85, open + (n2 - .5) * .7);
  vec3 col = mix(silt, sand, sandy);
  col *= .82 + .22 * n3 + .1 * (n4 - .5);

  // ripple marks across the current, lit on the upstream face
  float ph = dot(wp, fd) * .17 + n2 * 8. + n3 * 2.;
  float slope = cos(ph) * (.6 + .4 * sin(ph));
  vec3 rn = normalize(vec3(fd * slope * .45 * sandy, 1.));
  col *= mix(1., dot(rn, L) / max(L.z, .3), .9);

  // leaf litter and dark detritus where the water is slack
  float cellv = texture(uNoise, wp / 22.).b;
  float litter = (1. - smoothstep(.06, .16, cellv)) * step(.55, hash12(floor(wp / 22. * 24.))) * (1. - sandy);
  col = mix(col, mix(vec3(.10, .07, .03), vec3(.22, .14, .05), n3), litter * .75);

  // stones: lit domes with moss on their shoulders and shadows on the far side
  vec2 g = wp / 30.;
  vec2 ip = floor(g), fp = fract(g);
  float best = 9.; vec2 bid = vec2(0.), br = vec2(0.);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 oc = vec2(float(i), float(j));
    vec2 h = vec2(hash12(ip + oc), hash12(ip + oc + 17.3));
    vec2 r = oc + h - fp;
    float dd = dot(r, r);
    if (dd < best) { best = dd; bid = ip + oc; br = r; }
  }
  // stones gather in gravel beds rather than scattering evenly
  float bedK = smoothstep(.35, .75, texture(uNoise, wp / 600.).g);
  float present = step(1. - mix(.08, .55, bedK) * mix(1., .5, sandy), hash12(bid + 3.1));
  float rad = (.12 + .34 * pow(hash12(bid + 9.7), 1.6)) * mix(1., .7, bedK);
  vec2 sq = br / vec2(1., .75 + .5 * hash12(bid + 4.4));
  float dist = length(sq);
  float stone = present * (1. - smoothstep(rad - .05, rad, dist));
  float sshadow = present * (1. - smoothstep(-.02, .14, length(sq - L.xy / max(L.z, .3) * rad * .45) - rad)) * (1. - stone);
  col *= 1. - sshadow * .45;
  if (stone > 0.) {
    float hz = sqrt(max(0., 1. - pow(dist / rad, 2.)));
    vec3 sn = normalize(vec3(-sq / rad, hz + .15));
    float tone = hash12(bid + 1.9);
    vec3 sc = mix(vec3(.40, .39, .36), vec3(.55, .47, .36), tone) * (.75 + .45 * n4);
    // speckled granite or dull sandstone, a film of algae on the crown in slack water
    sc *= .9 + .2 * step(.6, hash12(floor(wp * 1.3)));
    sc = mix(sc, vec3(.20, .27, .11), smoothstep(.7, .98, sn.z) * (1. - sandy) * smoothstep(.45, .8, n3) * .6);
    float lit = max(dot(sn, L), 0.) * 1.15 + .2;
    col = mix(col, sc * lit, stone);
  }

  // sunken twigs
  vec2 tc = floor(wp / 150.);
  float th = hash12(tc + 5.5);
  if (th < .16) {
    vec2 c0 = (tc + .5 + (vec2(hash12(tc + 1.), hash12(tc + 2.)) - .5) * .3) * 150.;
    float ang = hash12(tc + 3.) * 3.1416;
    vec2 dir = vec2(cos(ang), sin(ang));
    float len = 30. + 45. * hash12(tc + 4.);
    float w = 1.6 + 1.8 * hash12(tc + 6.);
    vec2 a0 = c0 - dir * len, a1 = c0 + dir * len;
    vec2 fk = c0 + dir * len * .3;
    vec2 fdir = vec2(cos(ang + .6), sin(ang + .6));
    float d = min(sdSeg(wp, a0, a1) - w, sdSeg(wp, fk, fk + fdir * len * .5) - w * .6);
    float dsh = min(sdSeg(wp - L.xy / max(L.z, .3) * 3., a0, a1) - w, sdSeg(wp - L.xy / max(L.z, .3) * 3., fk, fk + fdir * len * .5) - w * .6);
    col *= 1. - (1. - smoothstep(0., 3., dsh)) * .4;
    float twig = 1. - smoothstep(-.6, .6, d);
    vec3 bark = mix(vec3(.13, .09, .05), vec3(.25, .18, .10), texture(uNoise, vec2(dot(wp, dir) * .05, dot(wp, vec2(-dir.y, dir.x)) * .4)).r);
    bark *= .7 + .5 * clamp(-d / w, 0., 1.);
    col = mix(col, bark, twig);
  }

  // pads above shade the bed: the shadow of a point is where its ray to the sun meets the surface
  vec2 up = L.xy / max(L.z, .3) * depth * 42.;
  vec2 suv = ((wp + up) - uView.xy) * uView.zw * .5 + .5;
  float blur = .004 + depth * .007;
  float sh = texture(uOcc, suv).r * .4
    + texture(uOcc, suv + vec2(blur, 0.)).r * .15 + texture(uOcc, suv - vec2(blur, 0.)).r * .15
    + texture(uOcc, suv + vec2(0., blur)).r * .15 + texture(uOcc, suv - vec2(0., blur)).r * .15;
  float light = (1. - sh * .88) * sunThrough(wp + up);

  // caustics drift downstream with the surface that makes them, sharper in the shallows
  vec2 cu = (wp - fl * uTime * .6) / 256.;
  float c = caustic(cu, uTime * .35) * 1.9 + caustic(cu * 2. + .37, uTime * .27) * .8;
  float turb = reachAt(wp.y).z;
  c = pow(c, mix(.8, 1.4, depth - .3)) * light * (1.35 - depth * .7) * mix(1.25, .45, turb);
  vec3 lit = col * (uAmb * .75 + uSunCol * (.42 + c * 1.15) * light + LAMP * lampAt(wp) * .8);

  // the water column: red goes first, then blue — deep water turns to green-black;
  // turbid water loses the bed much sooner, and old water is tea-dark with tannin
  vec3 absorb = exp(-depth * mix(.7, 2.6, turb) * vec3(1.6, .8, 1.0));
  vec3 deep = mix(uAmb * vec3(.05, .21, .19), uAmb * vec3(.17, .13, .05), turb * .8);
  o = vec4(lit * absorb + deep * (1. - absorb), 1.);
}`;

// ─── fish ──────────────────────────────────────────────────────────────────

export const FISH_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 iA; // x, y, heading, size
layout(location=2) in vec4 iB; // z, kind, tail phase, effort
layout(location=3) in vec4 iC; // flash, seed, turn rate, -
uniform vec4 uView;
uniform vec3 uSun;
uniform float uShadow;
uniform float uDepthK;
uniform float uPage; // 1: drawn on the notebook's paper — no sun throw, no parallax
out vec2 vQ;
out vec4 vB;
out vec2 vUv;
out float vFlash;
out float vSeed;
out float vTurn;
void main(){
  float z = iB.x;
  float len = iA.w * (1. - z * .18);
  vec2 q = aPos * vec2(.82, 1.05);
  vec2 local = q * vec2(len * .55, len);
  float c = cos(iA.z), s = sin(iA.z);
  vec2 w = vec2(local.x * c + local.y * s, -local.x * s + local.y * c);
  vec2 pos = iA.xy + w;
  if (uShadow > .5 && uPage < .5) pos += -uSun.xy / max(uSun.z, .3) * (1.1 - z) * 38.;
  vQ = q;
  vB = iB;
  vFlash = iC.x;
  vSeed = iC.y;
  vTurn = iC.z;
  // deeper fish sit smaller and slide slower (and their shadows sit on the bed)
  float d = uPage > .5 ? 0. : uShadow > .5 ? 1.2 : .15 + z;
  vec2 clip = (pos - uView.xy) * uView.zw / (1. + uDepthK * d);
  vUv = clip * .5 + .5;
  gl_Position = vec4(clip, 0., 1.);
}`;

export const FISH_FS = /* glsl */ `${HEAD}${COMMON}
in vec2 vQ;
in vec4 vB;
in vec2 vUv;
in float vFlash;
in float vSeed;
in float vTurn;
out vec4 o;
uniform float uShadow;
uniform float uPage;
uniform sampler2D uOcc;
/**
 * A fish seen from ABOVE. The tail and dorsal fin stand vertical, so from up
 * here they are nearly edge-on: thin lines, not the fan a side view shows.
 * What reads is the back — plump behind the head, narrowing to a slim tail
 * stalk — a dark ridge along the spine shading to lighter flanks, eyes bulging
 * at the sides of the head, and the paired fins spread flat like small fans.
 * The whole body bends as it swims, most at the tail.
 */
void main(){
  float z = vB.x, kind = vB.y, phase = vB.z, speed = vB.w;
  // isotropic body units: along -1 (tail tip) … 1 (nose), across in the same units
  vec2 P = vec2(vQ.x * .55, vQ.y);
  float along = P.y;
  // the beat is integrated per fish on the CPU (phase), so it never jumps
  float swim = phase;
  float bendAmp = .085 + min(speed, 60.) * .0016;
  // the swimming wave, growing toward the tail; and the whole body curving into a
  // turn (a C, nose and tail toward the inside, the tail most)
  float spine = sin(along * 2.6 - swim) * bendAmp * pow(clamp((1. - along) * .5, 0., 1.), 1.6)
              + vTurn * .05 * (along - .25) * abs(along - .25);
  float x = P.x - spine;
  float soft = fwidth(P.x) * 1.4 + z * .05 + uShadow * .12;
  float u = (along + 1.) * .5;              // 0 tail tip … 1 nose
  float plump = kind > 2.5 ? .115 : kind < .5 ? .15 : .19;
  // body outline from above: rounded snout, widest at the shoulders, a slim tail stalk
  float bodyU = clamp((u - .14) / .86, 0., 1.);
  float w = plump * pow(sin(bodyU * 3.14159), .55) * mix(.28, 1., smoothstep(.0, .55, bodyU));
  w *= 1. - smoothstep(.93, 1., u) * .35;
  float body = (1. - smoothstep(w - soft, w + soft, abs(x))) * step(.14, u) * (1. - smoothstep(.985, 1., u));
  // the tail fin is vertical: from above a thin blade, a touch wider as it sweeps across
  float sweep = abs(cos(along * 2.6 - swim)) * bendAmp * 3.;
  float tw = (.012 + sweep * .05) * (1. + (1. - u / .16) * .6);
  float tail = (1. - smoothstep(tw - soft, tw + soft, abs(x))) * step(u, .16) * step(.0, u);
  // the dorsal fin: a darker line along the spine
  float dorsal = (1. - smoothstep(.0, .012 + soft, abs(x))) * smoothstep(.42, .5, u) * (1. - smoothstep(.66, .74, u));
  // pectoral fins spread flat just behind the head, paddling; pelvics smaller, further back
  float fin = 0.;
  for (int k = -1; k <= 1; k += 2) {
    float sk = float(k);
    vec2 fp = vec2(x - sk * plump * .95, along - .42);
    fp = rot(fp, sk * (.9 + .25 * sin(swim * .8 + sk)));
    fin = max(fin, 1. - smoothstep(1. - soft * 6., 1. + soft * 6., length(fp / vec2(.035, .11))));
    vec2 pp = vec2(x - sk * plump * .6, along + .05);
    pp = rot(pp, sk * .7);
    fin = max(fin, (1. - smoothstep(1. - soft * 6., 1. + soft * 6., length(pp / vec2(.022, .06)))) * .8);
  }
  float cover = max(body, max(tail * .75, fin * .45));
  if (cover < .003) discard;
  if (uShadow > .5) { o = vec4(0., 0., 0., cover * (uPage > .5 ? .3 : .22 * (1. - z * .6))); return; }
  float across = clamp(abs(x) / max(w, .01), 0., 1.);
  vec3 back, flank;
  if (kind > 2.5) { back = vec3(.20, .23, .16); flank = vec3(.55, .60, .54); }
  else if (kind < .5) { back = vec3(.08, .10, .07); flank = vec3(.20, .22, .15); }
  else if (kind < 1.5) { back = vec3(.55, .56, .48); flank = vec3(.80, .80, .72); }
  else { back = vec3(.82, .78, .70); flank = vec3(.92, .90, .84); }
  vec3 col = mix(back, flank, smoothstep(.25, .95, across));
  if (kind > 1.5 && kind < 2.5) {
    // koi: orange and white saddles, seen across the back
    float blot = texture(uNoise, vec2(x * 1.6, along * .9) + vSeed * 1.3).r;
    col = mix(col, vec3(.88, .40, .10) * mix(1., .8, across), smoothstep(.45, .55, blot));
  }
  // minnows show their silver flank when they turn
  if (kind > 2.5) col += vec3(.9, .95, 1.) * vFlash * smoothstep(.4, 1., across) * .9;
  // a rounded back: the spine catches the light, the sides fall away
  vec3 n = normalize(vec3(sign(x) * across * 1.2, 0., 1.));
  col *= .65 + .5 * max(dot(n, normalize(uSun)), 0.);
  col += uSunCol * pow(1. - across, 6.) * .12 * step(.5, kind);
  col = mix(col, back * .6, dorsal * .6);
  // eyes at the sides of the head
  for (int k = -1; k <= 1; k += 2) {
    vec2 ep = vec2(x - float(k) * w * .78, u - .9);
    float e = length(ep);
    float r = plump * .16;
    col = mix(col, vec3(.03), (1. - smoothstep(r * .8, r, e)) * body);
    col += vec3(.8) * (1. - smoothstep(0., r * .35, length(ep - vec2(0., r * .3)))) * body * .6;
  }
  // fins and tail are thin: the water shows through them
  col = mix(col, col * .55 + vec3(.02, .07, .06), max(tail, fin) * (1. - body) * .6);
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
layout(location=4) in vec4 iD; // press toward (world x, y; length = give), flex, -
uniform vec4 uView;
uniform float uMode; // 0 floating, 1 occlusion, 2 submerged
uniform float uDepthK;
vec2 rot(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }
out vec2 vP;
out vec4 vB;
out vec4 vC;
out float vAng;
out float vR;
out vec2 vW;
out vec3 vDent;
out float vSink;
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
  vW = iA.xy + w;
  vDent = vec3(rot(iD.xy, -iA.w), iD.z);
  vSink = iD.w;
  float par = uMode > 1.5 ? 1. / (1. + uDepthK * iC.z) : 1.;
  gl_Position = vec4((iA.xy + w - uView.xy) * uView.zw * par, 0., 1.);
}`;

export const PAD_FS = /* glsl */ `${HEAD}${COMMON}${RIVER}${CANOPY}
in vec2 vP;
in vec4 vB;
in vec4 vC;
in vec3 vDent;
in float vSink;
in float vAng;
in float vR;
in vec2 vW;
out vec4 o;
uniform float uMode;
uniform sampler2D uDrops;
uniform float uPx; // world units per device pixel
uniform sampler2D uSim;   // the wave sim, for the white water that rides over a flooded leaf
uniform float uSimOn;
uniform sampler2D uGlyphs; // numerals and signs drawn in water: a height field atlas (glyphs.ts)
uniform float uGlyphOn;

float seed;
vec2 so; // seed offset into the noise tile

// ── water glyphs (glyphs.ts): each state is a distance field — a glyph's key shape from the
// atlas, the leaf's own drops as beads, or nothing — and a change of state is one field
// flowing into the next. The hand (lean, turn, squash) is the leaf's, and stays through it.
float gTo, gFrom, gT, gS, gTurn, gLean, gSeed;
vec2 gSquash;
int gRow, gCount;
vec2 gHand(vec2 v){ v = rot(v, gTurn); v.x -= gLean * v.y; return v / gSquash; }
float gSmin(float a, float b, float k){ float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }
/** One glyph's key shape from the atlas (no flow). */
vec2 gAtlas1(float gi, vec2 gp){
  if (abs(gp.x) > .62 || abs(gp.y) > .62) return vec2(.4, .3);
  vec2 cell = vec2(mod(gi, 4.), floor(gi / 4. + .001));
  return texture(uGlyphs, (cell + gp / 1.28 + .5) / 4.).rg;
}
/** A glyph's key shape: one numeral or sign, or (100 + n) a number to 99 as two numerals side by side. */
vec2 gAtlas(float gi, vec2 gp){
  if (gi > 99.5) {
    float n = gi - 100.;
    float tens = floor(n / 10. + .001);
    float ones = n - tens * 10.;
    vec2 l = gAtlas1(tens, (gp + vec2(.3, 0.)) / .74) * .74;
    vec2 r = gAtlas1(ones, (gp - vec2(.3, 0.)) / .74) * .74;
    return l.x < r.x ? l : r;
  }
  return gAtlas1(gi, gp);
}
/**
 * Where the river stands on a leaf going under (pad coordinates): > 0 flooded, 0 at the
 * waterline, < 0 above it. The same line the film over the flooded part is drawn to.
 */
float gShore(vec2 pp){
  float gv = length(vDent.xy);
  if (vSink < .01 || gv < .001) return -9.;
  vec2 dir = vDent.xy / gv;
  float across = dot(pp, vec2(-dir.y, dir.x));
  return dot(pp, dir) + across * across * .42 - (1. - vSink * 1.25);
}
/** Drops (-1) and fine dew (-3) are both beads of water. */
bool gBeads(float st){ return (st > -1.5 && st < -.5) || st < -2.5; }
/**
 * Fine dew (-3): the leaf's own sprinkle of tiny beads, too small to count — few on some
 * leaves, many on others. Flowing into drops or a numeral, the beads drift toward where the
 * water is gathering (the nearest drop, or the numeral's path) and grow as they go, so the
 * dew seems to collect itself. 'away': which way is off the nearest bead (for its light).
 */
vec2 gMist(vec2 gp, out vec2 away){
  float pull = gT < 1. && gFrom < -2.5 && gTo > -1.5 ? smoothstep(.05, .9, gT) : 0.;
  float n = floor(6. + 12. * hash12(vec2(gSeed, 91.)));
  float d = .4;
  away = vec2(0., 1.);
  for (int k = 0; k < 22; k++) {
    float fk = float(k);
    if (fk >= n) break;
    vec2 c = (vec2(hash12(vec2(gSeed, fk * 3.7 + 1.)), hash12(vec2(gSeed, fk * 5.3 + 7.))) - .5) * 1.6;
    if (length(c) > .8) continue;
    // tiny: plainly not the dew that counts
    float rk = .007 + .011 * hash12(vec2(gSeed, fk + 19.));
    if (pull > 0.) {
      vec2 goal = c;
      if (gTo > -.5) {
        // toward the numeral's path, down the slope of its distance
        float e = .02;
        vec2 g = vec2(gAtlas(gTo, c + vec2(e, 0.)).x - gAtlas(gTo, c - vec2(e, 0.)).x, gAtlas(gTo, c + vec2(0., e)).x - gAtlas(gTo, c - vec2(0., e)).x);
        goal = c - g / max(length(g), 1e-5) * gAtlas(gTo, c).x;
      } else {
        // toward the nearest of the leaf's drops
        float best = 9.;
        for (int i = 2; i < 14; i++) {
          if (i >= gCount) break;
          vec4 dr = texelFetch(uDrops, ivec2(i, gRow), 0);
          if (dr.w < .01) continue;
          vec2 dc = gHand(rot(dr.xy, vAng) / gS);
          float l = length(dc - c);
          if (l < best) { best = l; goal = dc; }
        }
      }
      c = mix(c, goal, pull * .9);
      rk *= 1. + pull * 1.2;
    }
    float l = length(gp - c);
    float dk = l - (rk - .082);
    if (dk < d) { d = dk; away = (gp - c) / max(l, 1e-5); }
  }
  return vec2(d, 0.);
}
/** One state's field at gp: [distance to its path, distance along it to a free end]. */
vec2 gState(float gi, vec2 gp){
  if (gi < -2.5) {
    vec2 unused;
    return gMist(gp, unused);
  }
  if (gi < -1.5) return vec2(.4, .3); // nothing: no water here
  if (gi < -.5) {
    // the leaf's own drops, as beads to flow out of or gather into (they follow the glyph
    // entries in the leaf's row), merging where they come close. This is also how dew rests:
    // water, not marbles. On a leaf going under, the rising water meets the dew: a drop near
    // the waterline leans toward it and is drawn into it, shrinking as it is taken
    // (dew washed off a sinking leaf goes the same way: the water's edge sweeps across it,
    // taking the drops nearest the flood first)
    vec2 runDir = length(vDent.xy) > 1e-3 ? normalize(vDent.xy) : vec2(0., -1.);
    float washing = smoothstep(.04, .3, vSink);
    float d = .4;
    for (int i = 2; i < 14; i++) {
      if (i >= gCount) break;
      vec4 dr = texelFetch(uDrops, ivec2(i, gRow), 0);
      if (dr.w < .01) continue;
      float wl = gShore(dr.xy) + (1. - dr.w) * 1.6 * washing;
      vec2 at = dr.xy + runDir * smoothstep(-.3, 0., wl) * .09;
      vec2 c = gHand(rot(at, vAng) / gS);
      float rG = dr.z * mix(.35 + .65 * dr.w, 1., washing) * (1. - smoothstep(-.14, .03, wl)) / gS;
      if (rG < .002) continue;
      // at rest, drops only join where they touch (every drop must stay countable); in a flow
      // they reach for each other
      d = gSmin(d, length(gp - c) - (rG - .082), gT >= 1. ? .008 : .05);
    }
    return vec2(d, 0.);
  }
  return gAtlas(gi, gp);
}
/** The water's field, mid-change: one state flowing into the next, gathering and breaking as it goes. */
vec2 gField(vec2 gp){
  vec2 b = gState(gTo, gp);
  if (gT >= 1.) {
    // dew at rest keeps a little of the flow's irregularity: soft, uneven edges, never marbles
    if (gTo > -1.5 && gTo < -.5) b.x += (texture(uNoise, gp * 1.6 + gSeed * 3.1).r - .5) * .04 - .003;
    return b;
  }
  vec2 a = gState(gFrom, gp);
  // eased gently in and out (smootherstep)
  float t = gT * gT * gT * (gT * (gT * 6. - 15.) + 10.);
  vec2 v = mix(a, b, t);
  // mid-flow the water runs heavier and its necks break into beads
  // (fine dew gathering is quiet: the beads draw together rather than break)
  float mid = sin(3.14159 * t) * (gBeads(gFrom) && gBeads(gTo) ? .3 : 1.);
  v.x += (texture(uNoise, gp * 1.6 + vec2(gT * .4, gT * .15)).r - .5) * .1 * mid - .014 * mid;
  v.y = mix(v.y, 0., mid * .6);
  return v;
}

/**
 * How far the edge is pushed in toward the pad's centre where it is pressed
 * (a neighbour or the hull), 0..1 across the pressed arc. The pad is a soft
 * leaf, not a disk: the pressed arc flattens against what it meets.
 */
float pressAt(vec2 p){
  float give = length(vDent.xy);
  if (give < .002) return 0.;
  return smoothstep(.45, 1., dot(p / max(length(p), 1e-4), vDent.xy / give));
}

float curl;

/** Leaf-local polar angle, measured from the notch (which sits a little off the local axis). */
float leafAngle(vec2 p){ return atan(p.x, p.y) - (fract(seed * 8.3) - .5) * .16; }

/**
 * How much the edge at angle a is lifted off the water (0..~1): not a rim
 * all round — a real pad lies flat and only a few stretches of its margin
 * curl up, breathing slowly with the water.
 */
float edgeLift(float a){
  vec2 nn = texture(uNoise, vec2(a / TAU * 2.6 + seed * 3.1 + uTime * .0015, seed * 7.3 - uTime * .001)).rg;
  return pow(clamp((nn.x * .75 + nn.y * .45) * 1.7 - 1.05, 0., 1.), 1.4) * curl;
}

float shapeD(vec2 p){
  // slightly oval, and not round at all at a glance
  vec2 q = p * vec2(1. + (fract(seed * 4.3) - .5) * .14, 1.);
  float a = leafAngle(q);
  float len = length(q);
  float R = .955
          + .03 * sin(2. * a + seed * 11.) + .022 * sin(3. * a + seed * 23.)
          + .008 * sin(a * 11. + seed * 20.) + .005 * sin(a * 27. + seed * 7.)
          + .025 * (texture(uNoise, vec2(a / TAU * 3., seed * 5.)).r - .5);
  // a curled-up stretch of margin looks narrower from above
  R -= edgeLift(a) * .05;
  // pressed: the arc facing the contact goes flat against it (a chord, not a dent)
  float give = length(vDent.xy);
  if (give > .002) {
    vec2 dir = vDent.xy / give;
    float c = dot(p / max(length(p), 1e-4), dir);
    float chord = (1. - give) / max(c, 1e-3);
    R = mix(R, min(R, chord), smoothstep(.2, .6, c));
    // after a knock the leaf flexes, an ellipse wobbling along the knock
    float ad = atan(dir.x, dir.y);
    R += vDent.z * .06 * cos(2. * (a - ad));
  } else R += vDent.z * .05 * cos(2. * a + seed * 9.);
  float d = len - R;
  // the sinus: a narrow slit between two rounded lobes, sometimes nearly closed
  float nw = (.012 + .05 * len) * (.4 + 1.1 * fract(seed * 3.7));
  float slit = (nw - abs(a)) * len;
  float k = .025;
  float h = clamp(.5 + .5 * (slit - d) / k, 0., 1.);
  d = mix(d, slit, h) + k * h * (1. - h);
  // an insect's nibble or two out of the margin
  float ageN = uMode < 1.5 ? vC.z : .5;
  for (int i = 0; i < 3; i++) {
    float hi = fract(seed * (13.1 + float(i) * 7.7));
    if (hi < .35 + .5 * (1. - ageN)) continue;
    float ba = (hi - .55) / .45 * TAU * .8 + .4;
    vec2 c0 = vec2(sin(ba), cos(ba)) * (.97 + .03 * hi);
    float rb = .04 + .07 * fract(hi * 9.1);
    d = max(d, rb - length(q - c0));
  }
  return d;
}

float veins(vec2 p, float len){
  // measured as arc length in leaf units, so a vein keeps its width from hub to rim
  float a = atan(p.x, p.y);
  float N = 17. + floor(fract(seed * 5.3) * 8.);
  float warp = texture(uNoise, p * .18 + so).r - .5;
  // veins sweep in a gentle curve from the hub, not straight spokes
  float f = a * N / TAU + warp * .45 + len * len * (fract(seed * 6.1) - .5) * 1.4;
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

float heightAt(vec2 p){
  float len = length(p);
  // flat on the water, draped over its small swells, a little sag where the stem holds it
  float h = .03 * (texture(uNoise, p * .32 + so + uTime * .004).g - .5);
  h -= .022 * exp(-len * len * 28.);
  // only some stretches of the margin curl up
  h += edgeLift(leafAngle(p)) * smoothstep(.62, 1., len) * .17;
  // a pressed edge rides up over what it meets
  h += length(vDent.xy) * pressAt(p) * smoothstep(.45, 1., len) * 1.1;
  // pushed under at one edge, the leaf pivots: the struck side goes down, the far side tips up
  float gv = length(vDent.xy);
  if (vSink > .01 && gv > .001) {
    float along = dot(p, vDent.xy / gv);
    h -= vSink * along * .16;
  }
  h += .014 * (texture(uNoise, p * .5 + so * 2.3).g - .5);
  return h;
}

vec3 albedo(vec2 p, float len, float vein){
  float n = texture(uNoise, p * .22 + so).r;
  float n2 = texture(uNoise, p * .7 + so * 3.1).g;
  float cellv = texture(uNoise, p * 1.3 + so * 1.7).b;
  // three families of green, from deep emerald to spring lime
  float tint = vC.w;
  // the leaf's age (its plant's, so a cluster is a family) and the reach's shade
  float age = uMode < 1.5 ? vC.z : fract(seed * 7.31);
  vec4 rc = reachAt(vW.y);
  vec3 dark = mix(vec3(.05, .18, .09), vec3(.12, .33, .12), smoothstep(.25, .7, tint));
  vec3 lite = mix(vec3(.14, .36, .15), vec3(.50, .68, .22), smoothstep(.5, 1., tint));
  vec3 c = mix(dark, lite, .2 + .6 * n);
  c = mix(c, vec3(.62, .74, .30), smoothstep(.6, .95, n2) * .22);
  // young growth is yellow-green and thin; old leaves go olive; leaves in shade cool
  // toward blue-green; and none of it is as electric as it was — the bright leaf is an event
  c = mix(c, vec3(.58, .68, .26), (1. - smoothstep(0., .3, age)) * .35);
  c = mix(c, vec3(.31, .35, .14), smoothstep(.55, 1., age) * .4);
  c = mix(c, vec3(.07, .26, .23), rc.y * .32);
  c = mix(vec3(dot(c, vec3(.3, .59, .11))), c, .86 - .12 * rc.y);
  // soft areoles between the veinlets, not a pattern — just the surface breathing
  c *= .94 + .1 * smoothstep(.05, .35, cellv);
  c = mix(c, vec3(.62, .57, .25), smoothstep(.6, .85, texture(uNoise, p * .2 + so * 4.).g) * max(0., age - .5) * 1.2);
  float spot = 1. - smoothstep(.02, .06, texture(uNoise, p * 1.2 + so * 6.).b);
  c = mix(c, vec3(.33, .25, .10), spot * step(.84, age) * .5);
  c = mix(c, c * 1.12 + vec3(.035, .04, .01), vein * .32 * (1. - len * .5));
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
  float shade = sunThrough(vW);
  vec3 c = a * (uAmb + uSunCol * wrap * .95 * shade + LAMP * lampAt(vW) * 1.4);
  vec3 H = normalize(Ll + vec3(0., 0., 1.));
  float nh = max(dot(n, H), 0.);
  // waxy, but not evenly: a film of water here, a dry dull patch there
  float gloss = mix(.3, 1.25, smoothstep(.35, .75, texture(uNoise, p * .6 + so * 1.3).r));
  c += uSunCol * (pow(nh, 90.) * .28 + pow(nh, 16.) * .04) * gloss * shade;
  // only where the margin lifts does the wine-red underside show
  float rimAmt = smoothstep(.8, .98, len) * edgeLift(leafAngle(p)) * (.6 + .8 * fract(seed * 11.3));
  c = mix(c, vec3(.36, .12, .10) * (uAmb + uSunCol * .5), clamp(rimAmt, 0., .75));
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
    o = vec4(c, 1.) * cover * (.75 - depth * .35);
    return;
  }

  // outside the leaf: only its soft contact shadow on the water (a chosen leaf doesn't glow; its dew does)
  if (d > 0.) {
    // a leaf lying on the water casts almost nothing; a curled-up edge casts more
    float lift = edgeLift(leafAngle(p));
    vec2 sp = p + Ll.xy * (.018 + lift * .07);
    float sd = shapeD(sp);
    float shadow = (1. - smoothstep(0., .05 + lift * .1, sd)) * (.16 + lift * .3);
    if (shadow < .002) discard;
    o = vec4(0., 0., 0., shadow);
    return;
  }

  float vein;
  vec3 col = leafLit(p, Ll, vein);

  // dew: each drop a lens resting on the leaf
  int count = int(vC.x + .5);
  int row = int(vB.w + .5);
  float shadow = 0.;
  float glowK = 0.;
  float inside = 0.;
  vec2 dq = vec2(0.);
  vec4 dd = vec4(0.);
  vec2 dropAxes = vec2(1.);
  float dropShape = 0.;
  float dropWash = 0.; // the drop under this pixel is running off a leaf going under
  vec4 glyph = vec4(0.);  // water drawn as a glyph: size (pad radii), state to, -1, how gathered
  vec4 glyphM = vec4(0.); // …changing from: state from, how far through (0..1), -2, 1
  for (int i = 0; i < 12; i++) {
    if (i >= count) break;
    vec4 dr = texelFetch(uDrops, ivec2(i, row), 0);
    if (dr.w < .01) continue;
    if (dr.z < -1.5) { glyphM = dr; continue; }
    if (dr.z < 0.) { glyph = dr; continue; }
    // while its water is drawn as a field (dew at rest included), the drops are part of it instead
    if (glyph.w > .01 && uGlyphOn > .5) continue;
    // Contact line stays pinned; the cap lags and compresses as the leaf flexes.
    float form = fract(dr.x * 17. + dr.y * 31. + seed);
    float wobble = sin(uTime * (8. + form * 3.) + form * TAU) * min(.10, vDent.z * .10);
    vec2 axes = vec2(.95 + form * .10 + wobble, 1.03 - form * .06 - wobble);
    dr.xy -= vDent.xy * .006;
    // emptying, not fading: on a leaf going under, a drop that is leaving runs downhill toward
    // the flooded side, drawn out along its run and keeping its water, until the river's film
    // (drawn over the flooded part below) takes it
    float washing = smoothstep(.04, .3, vSink);
    float wash = smoothstep(0., .7, 1. - dr.w) * washing;
    vec2 runDir = length(vDent.xy) > 1e-3 ? normalize(vDent.xy) : vec2(0., -1.);
    // gathering speed as it goes, as a drop does once it starts to run
    dr.xy += runDir * wash * wash * 1.1;
    float rr = dr.z * mix(.35 + .65 * dr.w, .85, smoothstep(0., .2, wash));
    vec2 dp = p - dr.xy;
    float along = dot(dp, runDir);
    dp = runDir * along / (1. + wash * .9) + (dp - runDir * along) / (1. - wash * .2);
    vec2 q = dp / (rr * axes);
    // a real drop's outline is not a circle: it bulges and pinches where drops have merged
    float qa = atan(q.y, q.x);
    float bulge = 1. + .11 * sin(3. * qa + form * 9.) + .06 * sin(5. * qa + form * 4.) + .04 * sin(2. * qa - form * 13.);
    q /= bulge;
    float sdist = length(q + Ll.xy * .62);
    shadow = max(shadow, (1. - smoothstep(.7, 1.2, sdist)) * dr.w);
    float dl = length(q);
    if (dl < 1.02 && inside == 0.) { inside = 1.; dq = q; dd = vec4(dr.xy, rr, dr.w); dropAxes = axes; dropShape = form; dropWash = washing * step(.02, 1. - dr.w); }
    glowK = max(glowK, exp(-max(dl - 1., 0.) * 2.2) * dr.w);
  }
  // from above, with the sun high, a drop throws hardly any shadow
  col *= 1. - shadow * .12;
  // a chosen drop's light spills a little onto the leaf around it
  col += vec3(1., .8, .42) * sel * glowK * .18;

  if (inside > 0.) {
    vec2 q = dq;
    float dl = length(q);
    float z = sqrt(max(0., 1. - dl * dl));
    float cap = 1.45 + dropShape * .5;
    vec3 n = normalize(vec3(q / dropAxes, z / cap));
    float canopyLight = sunThrough(vW);
    float enchant = sel * (.25 + .45 * (1. - clamp(uSun.z, 0., 1.)));
    vec2 qn = q / max(dl, 1e-4);
    // the lens: a magnified, brighter piece of the leaf beneath
    vec2 pr = dd.xy + q * dropAxes * dd.z * mix(.40, .66, dl * dl) - n.xy * dd.z * .08;
    // Magnify leaf material without rebuilding a second procedural normal.
    float prLen = length(pr);
    float v2 = veins(pr, prLen);
    vec3 under = albedo(pr, prLen, v2);
    float underShade = sunThrough(vW + rot((pr - p) * vR, vAng));
    under *= (uAmb + uSunCol * .72 * underShade + LAMP * lampAt(vW) * .8);
    // water over the leaf: the leaf's own green, darker and more saturated (the lens gathers
    // the leaf's colour), a little darker still toward the rim where it compresses
    float lum = dot(under, vec3(.3, .59, .11));
    under = mix(vec3(lum), under, 1.3) * (.8 - .14 * smoothstep(.5, 1., dl));
    // a soft lightening toward the sun, the sky's broad reflection off the low dome
    under += uSunCol * vec3(.9, 1., .9) * max(0., dot(qn, Ll.xy)) * (1. - smoothstep(.6, 1., dl)) * .05 * canopyLight;
    // chosen: the dew itself lights, warm from within
    under += vec3(1., .82, .42) * enchant * exp(-dot(q - vec2(.0, -.12), q - vec2(.0, -.12)) * 3.5);
    // the edge: crisp, a dark contact line toward the sun, a thin bright one on the far side
    float toSun = max(0., dot(qn, Ll.xy) / max(length(Ll.xy), 1e-3));
    under *= 1. - smoothstep(.88, 1., dl) * (.22 + .3 * toSun);
    under += vec3(.9, 1., .9) * smoothstep(.87, .95, dl) * (1. - smoothstep(.96, 1., dl)) * (1. - toSun) * smoothstep(.1, .9, dot(qn, -Ll.xy)) * .75 * canopyLight;
    // the sky, only at the very rim, and only what the canopy lets through
    float fr = .02 + .98 * pow(1. - n.z, 5.);
    vec3 reflected = reflect(vec3(0., 0., -1.), n);
    vec2 canopyUV = (vW + reflected.xy * 140.) / 520.;
    float canopy = smoothstep(.36, .68, texture(uNoise, canopyUV).g) * (1. - canopyLight * .65);
    vec3 sky = mix(uSky0, uSky1, reflected.z * .5 + .5);
    sky = mix(sky, uAmb * vec3(.10, .18, .10), canopy * .8);
    vec3 c = mix(under, sky, fr * .3);
    // the sun's pinpoint: one sharp point with a small soft bloom, not a wash
    vec3 H = normalize(Ll + vec3(0., 0., 1.));
    float nh = max(dot(n, H), 0.);
    // one small white pinpoint, and almost nothing around it
    float rough = max(.0012, fwidth(nh) * 1.1);
    c += uSunCol * canopyLight * (exp((nh - 1.) / rough) * 1.1 + pow(nh, 400.) * .12);
    // the lantern: its own pinpoint in every drop within reach, and a warm focus beneath
    vec2 tl = uLamp.xy - vW;
    vec3 Lp = normalize(vec3(rot(tl, -vAng), 32.));
    vec2 fall = tl / (uLamp.z * 2.4);
    float lampK = uLamp.w * exp(-dot(fall, fall) * 1.6);
    vec3 Hp = normalize(Lp + vec3(0., 0., 1.));
    float nhp = max(dot(n, Hp), 0.);
    c += LAMP * lampK * (pow(nhp, 500.) * 4. + pow(nhp, 40.) * .25);
    vec2 fl2 = q + Lp.xy * .45;
    c += LAMP * lampK * exp(-dot(fl2, fl2) * 9.) * .35;
    float edge = 1. - smoothstep(1. - aa / dd.z * 1.5, 1., dl);
    // a leaving drop fades; one running off a sinking leaf keeps its water until the river's film takes it
    col = mix(col, c, edge * max(smoothstep(0., .2, dd.w), dropWash * smoothstep(0., .04, dd.w)));
  }


  // a numeral or sign drawn in water (glyphs.ts). The atlas gives only the key shape (the
  // distance to its path); the hand is this leaf's own: a lean, a turn and a squash, a
  // waver in the line, water that swells and thins, blobs where it pooled, beaded ends
  // and stray drops — so no two are alike. The water is then lit as the dew is: the leaf
  // magnified through it, a dark contact line toward the sun and a thin bright one away
  // from it, the sky only at the very edge, a sun streak along the stroke, the lantern's
  // glint, light focused through it, and a small shadow. Upright on the screen.
  if (glyph.w > .01 && uGlyphOn > .5) {
    float S = glyph.x;
    gS = S;
    gTo = glyph.y;
    gFrom = glyphM.w > .5 ? glyphM.x : -2.;
    gT = glyphM.w > .5 ? glyphM.y : 1.;
    gRow = row;
    gCount = count;
    // the hand is the leaf's (not the glyph's), so it stays the same through a change
    float gs = fract(seed * 7.13 + .37);
    gSeed = gs;
    vec2 wo = vec2(gs * 37.1, fract(gs * 5.3) * 91.7);
    // how it leans and turns and squashes
    gLean = (hash12(vec2(gs, 1.7)) - .6) * .34;
    gTurn = (hash12(vec2(gs, 3.1)) - .5) * .2;
    gSquash = 1. + (vec2(hash12(vec2(gs, 5.9)), hash12(vec2(gs, 7.3))) - .5) * .2;
    float lean = gLean, turn = gTurn;
    vec2 squash = gSquash;
    vec2 gp = gHand(rot(p + vDent.xy * .006, vAng) / S);
    // a numeral on a leaf going under does not change what it is: its water is taken into the
    // river — where the waterline crosses a stroke the stroke dissolves into it (below), and once
    // the leaf's dew is washed the whole numeral thins away into the flood ('gRun')
    float gRun = glyphM.w > .5 ? clamp(glyphM.w - 1., 0., 1.) : 0.;
    float shore = gShore(p);
    // …and how the line wavers as it is drawn: slow bends, a tremor
    gp += (texture(uNoise, gp * .55 + wo).rg - .5) * .11 + (texture(uNoise, gp * 1.7 + wo.yx).rg - .5) * .045;
    bool beads = gBeads(gTo) || gT < 1. && gBeads(gFrom);
    float bound = beads ? 1.05 : gTo > 99.5 || gFrom > 99.5 ? .8 : .62;
    if (abs(gp.x) < bound && abs(gp.y) < bound) {
      // fine dew at rest is many tiny beads: one pass finds the nearest, and its light is its own
      bool restMist = gT >= 1. && gTo < -2.5;
      vec2 mistAway = vec2(0., 1.);
      vec2 de = restMist ? gMist(gp, mistAway) : gField(gp); // distance to the path, distance along it to a free end
      float ga = glyph.w;
      // the water on the path: thinner and fuller along it, pooled here and there, beaded at the ends
      float nW = texture(uNoise, gp * .8 + wo * 1.3).r;
      float pool = smoothstep(.52, .84, texture(uNoise, gp * 1.25 + wo * 2.1).g);
      float w = .082 * (.62 + .8 * nW) * (1. + .8 * pool) * (1. + .5 * exp(-pow(de.y / .07, 2.)));
      w = min(w, .18);
      // where the water is (or is becoming) the leaf's own drops, it is drops: plain round beads of
      // their own size, so the hand-off to the dew drawn as dew is seamless
      float tD = gT >= 1. ? 1. : gT * gT * gT * (gT * (gT * 6. - 15.) + 10.);
      float dropK = (gBeads(gTo) ? tD : 0.) + (gT < 1. && gBeads(gFrom) ? 1. - tD : 0.);
      // (drops keep a quarter of the hand's swell, so no two are quite the same; fine dew none)
      w = mix(w, .082, (gTo < -2.5 ? 1. : .75) * clamp(dropK, 0., 1.));
      // gathering: a thin thread first, then the full water
      w *= mix(.35, 1., ga);
      // the rising river takes a numeral's strokes where it reaches them, and the rest as it drains
      // (draining, the water's edge sweeps on across the numeral from the flooded side)
      if (gTo > -.5 || (gT < 1. && gFrom > -.5)) w *= 1. - smoothstep(-.14, .03, shore + gRun * 1.8);
      float d = de.x;
      // the slope of the distance (which way is away from the path), in the hand's space
      vec2 away = mistAway;
      if (!restMist) {
        float eps = .01;
        vec2 gd = vec2(gField(gp + vec2(eps, 0.)).x - gField(gp - vec2(eps, 0.)).x,
                       gField(gp + vec2(0., eps)).x - gField(gp - vec2(0., eps)).x);
        away = gd / max(length(gd), 1e-5);
      }
      // stray drops shaken off the finger: a few, near the glyph's strokes but clear of them;
      // they gather as the glyph does
      if (gTo > -.5) {
        float strayK = smoothstep(.45, 1., gT);
        for (int k = 0; k < 10; k++) {
          float fk = float(k);
          if (hash12(vec2(gs * 13.7, fk)) > .75) continue;
          vec2 c = (vec2(hash12(vec2(gs, fk * 1.7 + 11.)), hash12(vec2(gs, fk * 2.3 + 29.))) - .5) * vec2(.95, 1.05);
          float r = (.018 + .045 * pow(hash12(vec2(gs, fk + 41.)), 1.4)) * mix(.4, 1., ga) * strayK;
          float dc = gState(gTo, c).x;
          if (r < .004 || dc < .12 + r || dc > .34) continue;
          float dd = length(gp - c);
          // where a drop stands higher than the stroke, the drop is what is seen
          if (dd < r && r * r - dd * dd > w * w - d * d) {
            d = dd;
            w = r;
            away = (gp - c) / max(dd, 1e-5);
          }
        }
      }
      vec3 Lw = uSun;
      float canopyLight = sunThrough(vW);
      // its shadow on the leaf, a little away from the sun
      float dS = restMist ? .4 : gField(gp + Lw.xy * .035).x;
      float aaG = uPx / (vR * S) * 1.3;
      col *= 1. - (1. - smoothstep(w * .6, w * 1.05, dS)) * .13 * smoothstep(-aaG, aaG, d - w);
      if (d < w + aaG) {
        // a round bead: the normal's tilt is the offset from the path over the half-width
        float t = clamp(d / w, 0., .985);
        // back from the hand's space to the leaf's: the lean, squash and turn undone on the slope
        vec2 a0 = away / squash;
        a0 = rot(vec2(a0.x, a0.y - lean * a0.x), -turn);
        vec2 nxy = a0 / max(length(a0), 1e-5);
        vec3 n = normalize(vec3(nxy * t, sqrt(1. - t * t) * .9));
        float rim = smoothstep(.62, .96, t);
        float enchant = sel * (.25 + .45 * (1. - clamp(uSun.z, 0., 1.)));
        // the lens: the leaf beneath, magnified across the stroke (pulled in toward the path)
        vec2 pr = p - rot(nxy, -vAng) * t * w * S * .5;
        float prLen = length(pr);
        vec3 under = albedo(pr, prLen, veins(pr, prLen));
        under *= (uAmb + uSunCol * .72 * canopyLight + LAMP * lampAt(vW) * .8);
        float lum = dot(under, vec3(.3, .59, .11));
        under = mix(vec3(lum), under, 1.3) * (.8 - .14 * rim);
        under += uSunCol * vec3(.9, 1., .9) * max(0., dot(nxy, Lw.xy)) * (1. - rim) * .05 * canopyLight;
        // light gathered through the water, falling on the leaf on the side away from the sun
        under += uSunCol * vec3(.95, 1., .85) * smoothstep(.1, .9, dot(nxy, -Lw.xy) / max(length(Lw.xy), 1e-3)) * (1. - rim) * smoothstep(.2, .7, t) * .16 * canopyLight;
        under += vec3(1., .82, .42) * enchant * (1. - rim) * .6;
        float toSun = max(0., dot(nxy, Lw.xy) / max(length(Lw.xy), 1e-3));
        under *= 1. - rim * (.22 + .3 * toSun);
        under += vec3(.9, 1., .9) * rim * (1. - toSun) * smoothstep(.1, .9, dot(nxy, -Lw.xy)) * .85 * canopyLight;
        float fr = .02 + .98 * pow(1. - n.z, 5.);
        vec3 reflected = reflect(vec3(0., 0., -1.), n);
        float canopy = smoothstep(.36, .68, texture(uNoise, (vW + reflected.xy * 140.) / 520.).g) * (1. - canopyLight * .65);
        vec3 sky = mix(uSky0, uSky1, reflected.z * .5 + .5);
        sky = mix(sky, uAmb * vec3(.10, .18, .10), canopy * .8);
        vec3 c = mix(under, sky, fr * .3);
        // the sun's pinpoint runs along the stroke as a streak: kept a little broad, with no
        // screen derivatives (fwidth over a thin line breaks into a 2×2 hatch), and dimmer,
        // as a line carries more light than a point
        vec3 H = normalize(Lw + vec3(0., 0., 1.));
        float nh = max(dot(n, H), 0.);
        c += uSunCol * canopyLight * (exp((nh - 1.) / .012) * .9 + pow(nh, 60.) * .14);
        vec3 Lp = normalize(vec3(uLamp.xy - vW, 32.));
        vec2 fall = (uLamp.xy - vW) / (uLamp.z * 2.4);
        float lampK = uLamp.w * exp(-dot(fall, fall) * 1.6);
        float nhp = max(dot(n, normalize(Lp + vec3(0., 0., 1.))), 0.);
        c += LAMP * lampK * (exp((nhp - 1.) / .012) * 1.2 + pow(nhp, 40.) * .12);
        float edge = 1. - smoothstep(w - aaG, w + aaG, d);
        col = mix(col, c, edge);
      }
    }
  }

  // keyboard focus: a thin bright ring
  col = mix(col, vec3(1., .95, .8), vC.y * (1. - smoothstep(0., aa * 2., abs(d + .03))) * .8);

  // under the water where it's pushed down: the leaf seen through a film of river, a bright waterline
  float gvs = length(vDent.xy);
  if (vSink > .01 && gvs > .001) {
    vec2 dir = vDent.xy / gvs;
    // the waterline is where the river's level meets the leaf's surface, so it
    // follows the leaf: bowed across the pressed side (the leaf bends as it goes
    // under), wandering with the leaf's drape, running ahead in fingers down the
    // vein grooves, lapping with the little waves, and leaving loose puddles
    // just past the line
    vec2 perp = vec2(-dir.y, dir.x);
    float across = dot(p, perp);
    float drape = (texture(uNoise, p * .45 + so * 1.9).g - .5) * .34 + (texture(uNoise, p * 1.3 + so).r - .5) * .12;
    float fingers = veins(p * .985, length(p)) * .035 + veins(p * 1.015, length(p)) * .025;
    float lap = (texture(uNoise, vec2(across * 1.4 + seed * 3., uTime * .22)).r - .5) * .09
              + (texture(uNoise, vec2(across * 4.2 - uTime * .05, seed * 7.)).g - .5) * .035;
    float wet = dot(p, dir) + across * across * .42 - (1. - vSink * 1.25) + drape + fingers + lap;
    // puddles stranded on the dry side of the line
    float pud = texture(uNoise, p * 2.1 + so * 2.7).b;
    wet = max(wet, (.2 - pud) * 2. - max(0., -wet) * 2.5 - .05);
    float under = smoothstep(-.04, .12, wet);
    // deeper under the further past the line: darker, cooler, flatter (gently: it's a thin film)
    float depthK = clamp(wet * 1.6, 0., 1.);
    float lum = dot(col, vec3(.3, .59, .11));
    vec3 river = mix(vec3(lum), col, .55) * mix(vec3(.74, .83, .77), vec3(.44, .56, .52), depthK) + uAmb * vec3(.03, .10, .09);
    // light playing on the water sheeting over it
    float glint = texture(uNoise, vW / 9. + uTime * vec2(.06, .03)).r * texture(uNoise, vW / 5. - uTime * .05).g;
    river += uSunCol * pow(glint, 3.) * .2;
    col = mix(col, river, under);
    // white water rides on the film over the leaf (the surface pass drew its foam under us)
    if (uSimOn > .5 && uMode < .5) {
      vec2 sUv = (vW - uView.xy) * uView.zw * (.5 / 1.15) + .5;
      float foam = texture(uSim, sUv).b;
      vec4 foamN = texture(uNoise, vW / 9. + uTime * vec2(.03, -.02));
      float bub = foamN.a * .65 + foamN.r * .55;
      float fm = smoothstep(.25, .9, foam * bub * 1.4) * under;
      col = mix(col, vec3(.86, .9, .86) * (uAmb * 1.3 + uSunCol * .75), fm * .8);
    }
    // the meniscus: a soft, faint sheen where the film begins, not a drawn line
    col += vec3(.8, .95, .9) * exp(-wet * wet * 500.) * vSink * .16;
  }
  // the leaf margin: a fine paler line, as the blade thins to its edge
  col = mix(col, col * 1.2 + vec3(.05, .05, .01), (1. - smoothstep(-aa * 2.5, -aa * .5, d)) * .5);
  float cover = 1. - smoothstep(-aa, aa, d);
  o = vec4(col, 1.) * cover;
}`;

// ─── water surface ─────────────────────────────────────────────────────────

export const SURFACE_FS = /* glsl */ `${HEAD}${COMMON}${RIVER}${CANOPY}
in vec2 vUv;
in vec2 vWorld;
out vec4 o;
uniform sampler2D uUnder;
uniform sampler2D uSim;
uniform vec2 uSimTexel;
uniform float uSimScale;
uniform float uSimOn;
uniform float uAspect;
uniform vec4 uGust[4];    // x, y, radius, level
uniform vec4 uGustDir[4]; // dx, dy, radial, -
vec2 waves(vec2 p){
  vec4 a = texture(uNoise, p / 220.);
  vec4 b = texture(uNoise, p / 48.);
  return (a.rg - .5) * .098 + (b.ba - .5) * .052;
}
void main(){
  vec2 wp = vWorld;
  // flow map: two phases of the wave texture carried along the current, cross-faded
  vec2 fl = flowAt(wp);
  float T = uTime / 6.;
  float p0 = fract(T), p1 = fract(T + .5);
  float w0 = 1. - abs(2. * p0 - 1.);
  vec2 grad = waves(wp - fl * p0 * 6.) * w0 + waves(wp - fl * p1 * 6. + 41.) * (1. - w0);
  // wind: a roughened, darker patch that runs with the gust
  float rough = 0.;
  for (int i = 0; i < 4; i++) {
    vec4 g = uGust[i];
    if (g.w <= 0.) continue;
    float k = g.w * (1. - smoothstep(g.z * .35, g.z * 1.25, length(wp - g.xy)));
    vec2 dir = uGustDir[i].z > .5 ? normalize(wp - g.xy + .001) : uGustDir[i].xy;
    vec2 q = wp - dir * uTime * 55.;
    vec4 gn = texture(uNoise, q / 9.);
    grad += ((gn.rg - .5) * .62 + (gn.ba - .5) * .30) * k;
    rough = max(rough, k);
  }
  float h = 0.;
  vec2 simG = vec2(0.);
  float foam = 0.;
  if (uSimOn > .5) {
    vec2 s = (vUv - .5) / uSimScale + .5;
    h = texture(uSim, s).r;
    float hl = texture(uSim, s - vec2(uSimTexel.x, 0.)).r;
    float hr = texture(uSim, s + vec2(uSimTexel.x, 0.)).r;
    float hd = texture(uSim, s - vec2(0., uSimTexel.y)).r;
    float hu = texture(uSim, s + vec2(0., uSimTexel.y)).r;
    simG = vec2(hr - hl, hu - hd);
    grad += simG * .85;
    foam = texture(uSim, s).b;
  }
  vec3 n = normalize(vec3(-grad, 1.));
  vec3 under = texture(uUnder, vUv + n.xy * .035).rgb;
  vec3 V = normalize(vec3((vUv - .5) * vec2(uAspect, 1.) * .55, 1.));
  float fr = .02 + .98 * pow(1. - max(dot(n, V), 0.), 5.);
  vec3 R = reflect(-V, n);
  // the reflection: whatever is overhead, mirrored. It sits at a virtual depth
  // as far below as the trees are above, so it looks smaller and slides slower
  // than the surface; ripples, wakes and gusts break it up.
  vec2 q = uView.xy + (wp - uView.xy) * (1. + uDepthK * CANOPY_H) + n.xy * 190.;
  vec4 cloudN = texture(uNoise, q / 720. + uTime * vec2(.0012, .0006));
  float cloud = cloudN.g * .62 + cloudN.a * .38;
  vec3 sky = mix(uSky0, uSky1, clamp(R.y * .5 + .5, 0., 1.));
  sky = mix(sky, mix(sky, vec3(1.), .55) * (1. - uDusk * .6), smoothstep(.5, .75, cloud) * .7);
  // stars in the gaps at night
  float star = step(.996, hash12(floor(q / 3.))) * uDusk * (.6 + .4 * sin(uTime * 2. + hash12(floor(q / 3.) + 7.) * 40.));
  sky += vec3(.8, .85, 1.) * star;
  float canopy = canopyAt(q);
  float leafy = texture(uNoise, q / 22.).r;
  vec3 leaves = mix(vec3(.03, .06, .035), vec3(.16, .24, .10), leafy) * (uAmb * 1.4 + uSunCol * .25);
  sky = mix(sky, leaves, canopy);
  // wind-roughened water loses its mirror: it darkens and catches the sky in a scatter of glints
  // a dark river is a good mirror for what's bright above it, and a window where the trees are dark
  float mirror = clamp(fr * 2.2 + .065 + rough * .16, 0., .7);
  vec3 col = mix(under, sky, mirror);
  col *= 1. - rough * .2;
  float rs = max(dot(R, normalize(uSun)), 0.);
  // sun glints only where sunlight actually reaches the water
  col += uSunCol * (pow(rs, 1400.) * (5. + rough * 6.) + pow(rs, 90.) * .08) * pow(sunThrough(wp), 2.);
  col += vec3(.7, .85, .75) * clamp(h, 0., 1.) * .05;
  // ripples and wakes catch the light: faces toward the sun brighten, the backs darken
  vec3 Ls = normalize(uSun);
  col *= 1. + clamp(-dot(simG, Ls.xy) * 2.2, -.28, .4);
  // white water: bubbly, broken, fading
  vec4 foamN = texture(uNoise, wp / 9. + uTime * vec2(.03, -.02));
  float bub = foamN.a * .65 + foamN.r * .55;
  float fm = smoothstep(.25, .9, foam * bub * 1.4);
  col = mix(col, vec3(.86, .9, .86) * (uAmb * 1.3 + uSunCol * .75), fm * .8);
  // the lantern: warm light on the water around the boat and its glints in the ripples
  float lamp = lampAt(wp);
  // Each restored landing leaves a broken vertical reflection on the moving water.
  for(int i=0;i<4;i++) {
    if(uPierLamp[i].w<=0.) continue;
    vec2 dl=wp-uPierLamp[i].xy;
    float streak=exp(-pow((dl.x+sin(dl.y*.22+uTime*1.7)*3.)/7.,2.)-pow(dl.y/45.,2.));
    col+=LAMP*streak*uPierLamp[i].w*(.1+.12*pow(.5+.5*sin(dl.y*.8+uTime*2.),3.));
  }
  vec3 toLamp = normalize(vec3(uLamp.xy - wp, 26.));
  col += LAMP * (lamp * .12 + pow(max(dot(R, toLamp), 0.), 120.) * min(uLamp.w, 1.5) * .9 * smoothstep(uLamp.z * 2.5, 0., length(wp - uLamp.xy)));
  o = vec4(col, 1.);
}`;

// ─── weeds ─────────────────────────────────────────────────────────────────

export const WEED_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 iA; // x, y, length, flow angle
layout(location=2) in vec4 iB; // depth, seed, kind, flow speed
uniform vec4 uView;
uniform float uDepthK;
out vec2 vQ;
out vec4 vB;
out vec2 vUv;
void main(){
  float u = aPos.y * .5 + .5;
  vec2 dir = vec2(sin(iA.w), cos(iA.w));
  vec2 perp = vec2(dir.y, -dir.x);
  vec2 w = iA.xy + dir * u * iA.z + perp * aPos.x * iA.z * .38;
  float d = iB.x * (1. - .35 * u);
  vec2 clip = (w - uView.xy) * uView.zw / (1. + uDepthK * d);
  vQ = vec2(aPos.x, u);
  vB = iB;
  vUv = clip * .5 + .5;
  gl_Position = vec4(clip, 0., 1.);
}`;

export const WEED_FS = /* glsl */ `${HEAD}${COMMON}${RIVER}
in vec2 vQ;
in vec4 vB;
in vec2 vUv;
out vec4 o;
uniform sampler2D uOcc;
void main(){
  float u = vQ.y, v = vQ.x;
  float depth = vB.x, seed = vB.y, kind = vB.z, speed = vB.w;
  float aa = fwidth(v) * 1.2;
  float cover = 0.;
  float tipK = 0.;
  for (int k = 0; k < 5; k++) {
    float fk = float(k);
    float hk = hash12(vec2(seed * 91., fk));
    float len = .55 + .45 * hk;
    if (u > len) continue;
    float uu = u / len;
    // streaming in the current, a slow travelling wave down each blade
    float c = (hk - .5) * .7 * (1. - uu * .5) + sin(uu * 3.2 - uTime * (1. + speed * .08) + hk * 6.) * .12 * uu;
    float w = kind < .5 ? (.075 - .05 * uu) : (.03 + .07 * abs(sin(uu * 38. + hk * 5.))) * (1. - uu * .6);
    float b = 1. - smoothstep(w - aa, w + aa, abs(v - c));
    if (b > cover) { cover = b; tipK = uu; }
  }
  if (cover < .01) discard;
  vec3 col = mix(vec3(.08, .16, .06), vec3(.30, .40, .12), tipK) * (kind < .5 ? 1. : .85);
  float shade = 1. - texture(uOcc, vUv).r * .6;
  col *= (uAmb * .9 + uSunCol * .6) * shade;
  float d = depth * (1. - .35 * tipK);
  // the world y of this fragment, back from the screen (the weed program has no world varying)
  float turbW = reachAt(uView.y + (vUv.y * 2. - 1.) / uView.w).z;
  vec3 absorb = exp(-d * mix(.7, 2.6, turbW) * vec3(1.6, .8, 1.0));
  col = col * absorb + mix(uAmb * vec3(.05, .21, .19), uAmb * vec3(.17, .13, .05), turbW * .8) * (1. - absorb);
  o = vec4(col, 1.) * cover * .92;
}`;

// ─── mist: low haze drifting over the water, thicker at dawn and dusk ─────

export const MIST_FS = /* glsl */ `${HEAD}${COMMON}
in vec2 vUv;
in vec2 vWorld;
out vec4 o;
uniform float uMist;
uniform vec3 uMistCol;
uniform vec2 uWind;
void main(){
  vec2 wp = vWorld;
  vec2 drift = uTime * vec2(3., 6.) + uWind;
  float m = texture(uNoise, (wp - drift) / 900.).r;
  float m2 = texture(uNoise, (wp - drift * 1.7) / 320.).g;
  float mist = smoothstep(.38, .95, m * .75 + m2 * .45) * uMist;
  o = vec4(uMistCol * mist, mist);
}`;

// ─── small things afloat: duckweed, petals, a fallen leaf, lily buds ─────

export const FLOATER_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 iA; // x, y, size, angle
layout(location=2) in vec4 iB; // kind, seed, -, -
uniform vec4 uView;
out vec2 vP;
out vec4 vB;
out float vAng;
out vec2 vW;
void main(){
  vec2 q = aPos * 1.5;
  float c = cos(iA.w), s = sin(iA.w);
  vec2 w = vec2(c * q.x - s * q.y, s * q.x + c * q.y) * iA.z;
  vP = q; vB = iB; vAng = iA.w; vW = iA.xy + w;
  gl_Position = vec4((iA.xy + w - uView.xy) * uView.zw, 0., 1.);
}`;

export const FLOATER_FS = /* glsl */ `${HEAD}${COMMON}${RIVER}${CANOPY}
in vec2 vP;
in vec4 vB;
in float vAng;
in vec2 vW;
out vec4 o;
float ell(vec2 p, vec2 c, vec2 r, float a){ vec2 q = rot(p - c, a) / r; return length(q) - 1.; }
void main(){
  vec2 p = vP;
  float kind = vB.x, seed = vB.y;
  vec3 Ll = vec3(rot(uSun.xy, -vAng), uSun.z);
  vec2 sh = Ll.xy * .18;
  float d, ds;
  vec3 base;
  vec3 n = vec3(0., 0., 1.);
  float aa = fwidth(p.x) * 1.2;
  if (kind < .5) {
    // duckweed: two or three glossy oval fronds budding from one another
    d = ell(p, vec2(0.), vec2(.62, .46), 0.);
    ds = ell(p + sh, vec2(0.), vec2(.62, .46), 0.);
    if (seed > .35) { vec2 c1 = vec2(.55, .35); d = min(d, ell(p, c1, vec2(.45, .34), .7)); ds = min(ds, ell(p + sh, c1, vec2(.45, .34), .7)); }
    if (seed > .7) { vec2 c2 = vec2(-.5, .4); d = min(d, ell(p, c2, vec2(.38, .3), -.6)); ds = min(ds, ell(p + sh, c2, vec2(.38, .3), -.6)); }
    base = mix(vec3(.22, .38, .10), vec3(.40, .54, .15), fract(seed * 7.1));
    base *= .85 + .3 * smoothstep(-1., 0., d);
    n = normalize(vec3(-p * .35, 1.));
  } else if (kind < 1.5) {
    // a fallen petal: long, cupped, pale
    d = ell(p, vec2(0.), vec2(.3, .95), 0.);
    ds = ell(p + sh * 1.5, vec2(0.), vec2(.3, .95), 0.);
    base = mix(vec3(.96, .94, .9), vec3(.98, .78, .85), step(.6, seed)) * (.8 + .25 * smoothstep(-.9, .9, p.y));
    n = normalize(vec3(-p.x * 1.4, 0., 1.));
  } else if (kind < 2.5) {
    // a willow leaf: lanceolate, a midrib, going yellow and brown at the tips
    float w = .24 * pow(max(0., 1. - p.y * p.y), .8);
    d = (abs(p.x) - w) * 1.4;
    d = max(d, abs(p.y) - 1.);
    vec2 ps = p + sh;
    float ws = .24 * pow(max(0., 1. - ps.y * ps.y), .8);
    ds = max((abs(ps.x) - ws) * 1.4, abs(ps.y) - 1.);
    base = mix(vec3(.55, .52, .16), vec3(.52, .32, .10), smoothstep(.3, 1., abs(p.y)) * (.5 + seed));
    base *= 1. - (1. - smoothstep(0., .03, abs(p.x))) * .25;
    n = normalize(vec3(-sign(p.x) * .4, 0., 1.));
  } else {
    // a closed lily bud standing a little out of the water: green sepals, a blush at the tip
    d = ell(p, vec2(0.), vec2(.42, .75), 0.);
    ds = ell(p + sh * 3., vec2(0.), vec2(.42, .75), 0.);
    float sep = abs(fract((atan(p.x, p.y) + seed) / TAU * 4.) - .5);
    base = mix(vec3(.22, .36, .12), vec3(.85, .55, .60), smoothstep(.2, .75, p.y) * .7);
    base *= .8 + .35 * smoothstep(.0, .3, sep);
    n = normalize(vec3(-p * vec2(1.1, .6), .8));
  }
  float cover = 1. - smoothstep(-aa, aa, d);
  float shadow = (1. - smoothstep(-aa, .25, ds)) * .3 * (1. - cover);
  if (cover < .003 && shadow < .003) discard;
  float lit = max((dot(n, Ll) + .3) / 1.3, 0.);
  vec3 col = base * (uAmb + uSunCol * lit * .9 * sunThrough(vW) + LAMP * lampAt(vW) * 1.2);
  vec3 H = normalize(Ll + vec3(0., 0., 1.));
  col += uSunCol * pow(max(dot(n, H), 0.), 40.) * (kind < .5 ? .18 : .15);
  o = vec4(col * cover, cover + shadow);
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
/**
 * Flowers of several kinds, not one flower recoloured. Each is built from rings
 * of petals; every petal is its own length, width and lean (seeded), so no two
 * are the same and none is perfectly regular. All edges are antialiased from the
 * screen-space footprint and nothing is finer than a pixel, so they don't crawl
 * or shimmer as they turn and drift.
 *   1 white water lily   — two rings of long pointed petals, green sepals beneath
 *   2 pink lily          — flushed at the base, fading to pale tips
 *   3 yellow lily        — half open, a cup of narrow upright petals
 *   4 double rose lily   — many narrow petals, packed in four rings
 *   5 spatterdock        — a small yellow globe of five thick cupped sepals, a flat disc in it
 *   6 spent flower       — petals slack, browning, a few gone, a green seed head
 */
struct Petal { float d; float along; float side; float k; };
Petal ring(vec2 p, float n, float off, float reach, float width, float point, float seed){
  float a = atan(p.y, p.x) - off;
  float sec = TAU / n;
  float k = floor(a / sec + .5);
  float h = hash12(vec2(k + seed * 17., seed * 31.));
  float h2 = hash12(vec2(k * 3.1 + 7., seed * 13.));
  float da = a - k * sec + (h2 - .5) * sec * .35;
  float r = length(p);
  vec2 lp = vec2(r * cos(da), r * sin(da));
  float R = reach * (.84 + .3 * h);
  float along = lp.x / R;
  // an ellipse from the heart to the tip, tapering to a point toward the end
  float halfW = R * width * (.85 + .3 * h2) * sqrt(max(0., along * (1. - along))) * 2.
              * (1. - point * smoothstep(.45, 1., along) * .6);
  float d = max(abs(lp.y) - halfW, max(-lp.x, lp.x - R));
  Petal P; P.d = d; P.along = clamp(along, 0., 1.); P.side = lp.y / max(halfW, 1e-3); P.k = h;
  return P;
}
void main(){
  vec2 p = vP;
  int v = int(vB.x + .5);
  float seed = vB.z;
  float px = fwidth(length(p)) * 1.2 + 1e-4;
  vec3 Ll = vec3(rot(uSun.xy, -vAng), uSun.z);

  // the kind
  float layers = 2., n0 = 14., reach0 = 1., width = .42, point = .65, cup = 0.;
  vec3 base = vec3(.93, .92, .84), tip = vec3(.99, .98, .95), back = vec3(.86, .88, .80);
  vec3 heart = vec3(.95, .76, .22);
  float sepals = 1., spent = 0.;
  if (v == 2) { layers = 3.; n0 = 12.; base = vec3(.86, .46, .58); tip = vec3(.99, .86, .90); back = vec3(.80, .52, .60); }
  else if (v == 3) { layers = 2.; n0 = 12.; reach0 = .74; width = .26; cup = .7; base = vec3(.93, .84, .44); tip = vec3(.99, .95, .72); back = vec3(.84, .80, .52); heart = vec3(.97, .70, .16); }
  else if (v == 4) { layers = 4.; n0 = 16.; width = .22; base = vec3(.70, .16, .34); tip = vec3(.93, .50, .62); back = vec3(.62, .22, .34); heart = vec3(.96, .62, .18); }
  else if (v == 5) { layers = 1.; n0 = 5.; reach0 = .62; width = .95; point = 0.; cup = 1.; base = vec3(.80, .70, .16); tip = vec3(.98, .86, .26); back = vec3(.56, .58, .18); sepals = 0.; }
  else if (v == 6) { layers = 2.; n0 = 11.; width = .3; spent = 1.; base = vec3(.74, .70, .58); tip = vec3(.80, .66, .52); back = vec3(.62, .56, .44); heart = vec3(.48, .50, .26); sepals = 1.; }

  vec3 col = vec3(0.);
  float cover = 0.;
  // shadow on the water, from the whole silhouette
  float sh = length(p + Ll.xy * .1) - reach0 * .85;
  float shadow = (1. - smoothstep(-.2, .25, sh)) * .3;

  // green sepals first, underneath, peeking between the outer petals
  if (sepals > .5) {
    Petal S = ring(p, 4., seed * 6. + .4, reach0 * .8, .3, .8, seed + 5.);
    float a = 1. - smoothstep(-px, px, S.d);
    vec3 c = mix(vec3(.13, .24, .11), vec3(.28, .36, .17), S.along) * (uAmb * 1.1 + uSunCol * .7);
    col = mix(col, c, a); cover = max(cover, a);
  }
  // rings, outer to inner: each drawn over the last
  for (int L = 0; L < 4; L++) {
    float fl = float(L);
    if (fl >= layers) break;
    float t = fl / max(layers - 1., 1.);
    // inner petals stand more upright, so from above they are shorter
    float reach = reach0 * mix(1., .52, t) * (1. - cup * .25 * t);
    float n = n0 - fl * (v == 4 ? 2. : 1.);
    float off = fl * 1.7 / n + seed * 6.;
    Petal P = ring(p, n, off, reach, width * (1. - .15 * t), point, seed + fl);
    if (spent > .5 && P.k < .3 && L == 0) continue;
    float a = 1. - smoothstep(-px, px, P.d);
    if (a <= 0.) continue;
    vec3 c = mix(base, tip, smoothstep(.1, .8, P.along));
    // cupped flowers show the paler, greener backs of their outer petals
    c = mix(c, back, cup * (1. - t) * smoothstep(.3, .9, P.along) * .6);
    if (spent > .5) c = mix(c, vec3(.52, .36, .22), smoothstep(.4, 1., P.along) * (.4 + .5 * P.k));
    // form: rounded across the petal, curving up toward the tip; a faint midrib
    vec3 n3 = normalize(vec3((P.along - .45) * (.9 + cup), P.side * .9, 1.));
    n3.xy = rot(n3.xy, atan(p.y, p.x));
    float lit = max((dot(n3, Ll) + .45) / 1.45, 0.);
    c *= uAmb * 1.05 + uSunCol * lit * .8;
    c *= 1. - (1. - smoothstep(0., .18, abs(P.side))) * .07;
    // petals overlapping below are shadowed by the ones above them
    c *= .8 + .2 * t;
    // and each petal edge is a hair darker, so the layers read apart
    c *= .9 + .1 * smoothstep(0., px * 3., -P.d);
    col = mix(col, c, a);
    cover = max(cover, a);
  }
  // the heart
  float r = length(p);
  if (v == 5) {
    // spatterdock: a flat ribbed stigma disc, green-yellow, in the cup
    float disc = r - .2;
    float ka = 1. - smoothstep(-px, px, disc);
    float rays = .85 + .15 * cos(atan(p.y, p.x) * 12.) * smoothstep(.02, .12, r);
    vec3 c = vec3(.72, .74, .26) * rays * (uAmb + uSunCol * .75);
    col = mix(col, c, ka); cover = max(cover, ka);
  } else if (v == 6) {
    float ka = 1. - smoothstep(-px, px, r - .15);
    vec3 c = heart * (.8 + .25 * smoothstep(.2, 0., r)) * (uAmb + uSunCol * .7);
    col = mix(col, c, ka); cover = max(cover, ka);
  } else {
    // stamens: a soft ring of gold around a paler centre (no sub-pixel speckle)
    float rs = .23 * reach0;
    float ka = 1. - smoothstep(-px, px, r - rs);
    float fil = .88 + .12 * cos(atan(p.y, p.x) * 18.) * smoothstep(px * 6., rs, r);
    vec3 c = mix(heart * .75, heart * 1.15, smoothstep(rs * .3, rs, r)) * fil * (uAmb + uSunCol * .8);
    col = mix(col, c, ka); cover = max(cover, ka);
  }
  if (cover < .003 && shadow < .003) discard;
  o = vec4(col * cover, cover + (1. - cover) * shadow);
}`;

// ─── names written on leaves (the start) ──────────────────────────────────

export const NAME_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 iA; // x, y (world, the leaf's centre), width, height (world)
layout(location=2) in vec4 iB; // atlas u0, v0, u1, v1
layout(location=3) in vec4 iC; // alpha, -, -, -
uniform vec4 uView;
out vec2 vUv;
out float vA;
void main(){
  // upright on the screen whatever the leaf's turn: a name is read, not grown
  vec2 pos = iA.xy + aPos * iA.zw * .5;
  vUv = vec2(mix(iB.x, iB.z, aPos.x * .5 + .5), mix(iB.y, iB.w, .5 - aPos.y * .5));
  vA = iC.x;
  gl_Position = vec4((pos - uView.xy) * uView.zw, 0., 1.);
}`;

export const NAME_FS = /* glsl */ `${HEAD}
in vec2 vUv;
in float vA;
out vec4 o;
uniform sampler2D uAtlas;
void main(){
  vec4 t = texture(uAtlas, vUv);
  o = t * vA; // premultiplied
}`;

// ─── the boat ──────────────────────────────────────────────────────────────

export const BOAT_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;
uniform vec4 uView;
uniform vec4 uBoat; // x, y, heading, scale
uniform vec3 uSun;
uniform float uShadow;
out vec2 vL;
out vec2 vBW;
void main(){
  vec2 local = aPos * vec2(96., 78.);
  float c = cos(uBoat.z), s = sin(uBoat.z);
  vec2 w = vec2(local.x * c + local.y * s, -local.x * s + local.y * c);
  vec2 pos = uBoat.xy + w;
  if (uShadow > .5) pos += -uSun.xy / max(uSun.z, .3) * 9.;
  vL = local;
  vBW = pos;
  gl_Position = vec4((pos - uView.xy) * uView.zw, 0., 1.);
}`;

export const BOAT_FS = /* glsl */ `${HEAD}${COMMON}${RIVER}${CANOPY}
in vec2 vL;
in vec2 vBW;
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

/** 0 feathered … 1 squared: the blade turns on edge just before the catch and back after the release. */
float oarSquare(){ return smoothstep(-.3, .15, cos(uOar.z * TAU)); }

/** How far under the water the oar is at p (the blade end, through the pull), 0..1. */
float oarUnder(vec2 p){
  float u = 0.;
  for (int k = 0; k < 2; k++) {
    float side = k == 0 ? -1. : 1.;
    vec2 lock, tip, handle;
    oar(side, lock, tip, handle);
    vec2 dir = normalize(tip - lock);
    float fromTip = dot(tip - p, dir);
    u = max(u, 1. - smoothstep(11., 16., fromTip));
  }
  return u * smoothstep(-.05, .3, cos(uOar.z * TAU)) * step(.05, uOar.y);
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
    // feathered (flat, wide from above) on the return; squared (on edge, thin) through the pull
    float wide = mix(3.8, 1.3, oarSquare());
    blade = min(blade, sdEllipse(bl, vec2(wide, 9.)));
  }
  return min(d, blade);
}

/**
 * The rower, in a soft grey wool cloak, seen from above. They sit on the
 * forward thwart FACING THE STERN, as in ordinary rowing: at the catch they
 * lean toward the stern with arms reaching to the oar handles; through the
 * drive they pull the handles in to the chest while the body swings back
 * toward the bow; on the recovery they rock forward again. The swing grows
 * with effort (uOar.y), and the head leads the body a little.
 *
 * The cape and hood are drawn in the figure's own frame (fq: +y is where they
 * face), mirrored so that "forward" is the stern.
 */
float rowLean(){ return sin(uOar.z * TAU); }            // -1 at the catch … +1 at the finish
float rowSwing(){ return 4.5 * clamp(uOar.y, 0., 1.2); }
vec2 rowerAt(){ return vec2(0., 16. + rowLean() * rowSwing()); }
/**
 * How much of the lantern's light reaches a point on the boat. The lamp hangs at the
 * bow a little above the deck, so its light falls off along the hull, and the rower
 * sits between it and the stern: everything aft of the figure is in their shadow.
 */
float lampOnDeck(vec2 p){
  float d = length(p - vec2(0., 46.));
  float near = 1.6 / (1. + d * d / 380.);
  vec2 at = rowerAt();
  float aft = smoothstep(4., -10., p.y - at.y);
  float across = 1. - smoothstep(9., 17., abs(p.x) - max(0., at.y - p.y) * .12);
  return near * (1. - .82 * aft * across);
}
vec2 figureQ(vec2 p){ vec2 q = p - rowerAt(); return vec2(q.x, -q.y); }
/** The head leads: it travels further than the body through the stroke. */
float headLead(){ return -rowLean() * rowSwing() * .4; }
/** Wool is not a clean edge: a soft, slightly ragged fuzz. */
float fuzz(vec2 p){ return (texture(uNoise, p * .9).a - .5) * .7; }
float sdCape(vec2 q){
  float hem = -14.5 + sin(q.x * .9 + 1.3) * .9 + sin(q.x * 2.3) * .35;
  float d = min(sdEllipse(q - vec2(0., -.5), vec2(10.5, 7.5)), sdEllipse(q - vec2(0., -6.5), vec2(12.5, 8.5)));
  return max(d, hem - q.y);
}
float sdHood(vec2 q){
  vec2 h = q - vec2(0., 2.2);
  float d = sdEllipse(h, vec2(5.8, 6.4));
  // the hood's soft point, falling back between the shoulders
  d = min(d, sdSeg(h, vec2(0., -2.), vec2(0., -9.)) - mix(2.8, 1.2, clamp((-h.y - 2.) / 7., 0., 1.)));
  return d;
}
float sdArms(vec2 p, vec2 at, out float hands){
  float d = 1e5; hands = 1e5;
  for (int k = 0; k < 2; k++) {
    float side = k == 0 ? -1. : 1.;
    vec2 lock, tip, handle;
    oar(side, lock, tip, handle);
    // shoulders on the side they face (the stern, -y)
    vec2 shoulder = at + vec2(side * 7., -2.5);
    vec2 hand = handle + normalize(lock - handle) * 1.5;
    d = min(d, sdSeg(p, shoulder, hand) - 2.4);
    hands = min(hands, length(p - hand) - 1.9);
  }
  return d;
}
float sdRower(vec2 p){
  vec2 at = rowerAt();
  vec2 fq = figureQ(p);
  float hands;
  float arms = sdArms(p, at, hands) + fuzz(p) * .5;
  float cape = sdCape(fq) + fuzz(p);
  float hood = sdHood(fq - vec2(0., headLead())) + fuzz(p) * .8;
  return min(min(cape, hood), min(arms, hands));
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
    // lifted on the return the oars stand higher, so their shadows fall further; the
    // submerged blades cast none
    float bladeS;
    vec2 lift = rot(uSun.xy, uBoat.z) * (1. - oarSquare()) * 8.;
    float doarS = sdOars(p + lift, bladeS);
    doarS = mix(doarS, 1e3, oarUnder(p + lift));
    dall = min(dh, min(doarS, dr));
    float a = 1. - smoothstep(-4., 5., dall);
    if (a < .003) discard;
    o = vec4(0., 0., 0., a * .42);
    return;
  }
  if (dall > aa) discard;
  vec2 Lxy = rot(uSun.xy, uBoat.z);
  // the lantern lights its own boat too, not just the cloak beside it
  // (sits in the scene's light, not a spotlight: the lantern is behind glass and hangs
  // over the bow, so its own boat gets a warm wash rather than the full glare)
  vec3 light = uAmb * .85 + uSunCol * .55 * sunThrough(vBW) + LAMP * lampAt(vBW) * .4 * lampOnDeck(p);
  float grain = texture(uNoise, vec2(p.x * .05, p.y * .006)).r;

  // hull
  vec3 col = vec3(0.);
  if (dh > -3.2) {
    // gunwale: a rounded oak rail, lit on the sun side of its bevel
    float bev = clamp((dh + 3.2) / 3.2, 0., 1.);
    vec2 g = vec2(sign(p.x), 0.);
    float lit = .8 + .35 * dot(g, Lxy) * (bev * 2. - 1.) + .2 * (1. - abs(bev * 2. - 1.));
    col = mix(vec3(.52, .38, .23), vec3(.64, .50, .32), grain) * lit;
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
      if (band < 0.) col = mix(vec3(.56, .42, .26), vec3(.66, .52, .33), grain) * (.9 + .1 * sin(p.x * .7));
      else if (p.y < sy && band < 2.4) col *= .7;
    }
    // a little wicker basket toward the stern, in front of the rower, a checked cloth over it
    vec2 bq = p - vec2(6., -28.);
    float basket = sdEllipse(bq, vec2(6.2, 4.6));
    if (basket < 0.) {
      float weave = .8 + .2 * sin(bq.x * 3.) * sin(bq.y * 3.);
      vec3 wick = vec3(.72, .52, .28) * weave;
      float cloth = 1. - smoothstep(-.5, .5, sdEllipse(bq - vec2(.6, .4), vec2(4.2, 3.)));
      vec3 check = mix(vec3(.93, .9, .86), vec3(.78, .16, .14), step(.5, fract(bq.x * .45) ) * step(.5, fract(bq.y * .45)) + step(fract(bq.x * .45), .5) * step(fract(bq.y * .45), .5));
      col = mix(wick * (.8 + .25 * smoothstep(0., -2., basket)), check, cloth);
      float handle = abs(sdEllipse(bq, vec2(4.8, 1.2)));
      col = mix(col, vec3(.6, .42, .22), (1. - smoothstep(.3, .8, handle)) * step(-.2, bq.y));
    } else if (basket < 1.2) col *= .7;
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
    // wet exactly while the blade drives through the water (cos > 0; see oarWater in world.ts)
    float wet = uOar.y * smoothstep(0., .3, cos(uOar.z * TAU));
    oc = mix(oc, vec3(.12, .20, .17), bladeK * wet * .55);
    // the end in the water: seen through the river, dimmer and green, with a waterline where it goes in
    float sub = oarUnder(p);
    oc = mix(oc * light, oc * vec3(.35, .5, .45) * light + vec3(.02, .06, .05), sub * .8);
    oarK *= 1. - sub * .35;
    col = mix(col, oc, oarK);
    col += vec3(.8, .95, .9) * oarK * sub * (1. - sub) * 1.4;
    cover = max(cover, oarK);
  }

  // the rower in a grey wool cloak
  float rowK = 1. - smoothstep(-aa, aa, dr);
  if (rowK > 0.) {
    vec2 at = rowerAt();
    vec2 fq = figureQ(p);
    vec3 L3 = vec3(Lxy, uSun.z);
    // the figure's frame is mirrored: its light comes from the mirrored side too
    vec3 Lf = vec3(L3.x, -L3.y, L3.z);
    vec3 lit = uAmb * .85 + uSunCol * .55 * sunThrough(vBW) + LAMP * lampAt(vBW) * .4 * lampOnDeck(p);
    float hands;
    float dArms = sdArms(p, at, hands) + fuzz(p) * .5;
    vec2 hfq = fq - vec2(0., headLead());
    float dHood = sdHood(hfq) + fuzz(p) * .8;
    // wool: felted mottling, a short fibrous grain, the odd stray light fibre
    float felt = texture(uNoise, p * .12).r;
    float grain = texture(uNoise, p * vec2(1.6, .55)).a;
    float fibre = step(.93, hash12(floor(p * 4.)));
    float wool = (.86 + .16 * felt) * (.9 + .12 * grain) + fibre * .06;
    vec3 grey = vec3(.40, .39, .37);
    // the cape: soft heavy folds falling from the shoulders to the hem
    vec2 cq = (fq - vec2(0., -4.)) / vec2(12., 10.);
    vec3 n = normalize(vec3(cq * .9, .75));
    float fold = .84 + .16 * sin(atan(fq.x, -(fq.y + 1.)) * 8. + sin(fq.y * .4) * 1.5);
    vec3 rc = grey * wool * fold * (.55 + .55 * max(dot(n, Lf), 0.));
    rc *= .8 + .2 * smoothstep(-15., -9., fq.y);
    // sleeves of the same wool, with small hands on the handles
    float armK = 1. - smoothstep(-aa, aa, dArms);
    vec3 sleeve = grey * .95 * wool * (.75 + .3 * max(L3.z, 0.));
    rc = mix(rc, sleeve * (.82 + .18 * smoothstep(-2.4, 0., dArms)), armK);
    float handK = 1. - smoothstep(-aa, aa, hands);
    rc = mix(rc, vec3(.93, .74, .60) * .7, handK);
    // the hood, a shade darker, softly rounded; its opening faces the stern
    float hoodK = 1. - smoothstep(-aa, aa, dHood);
    vec2 hq = hfq - vec2(0., 2.2);
    vec3 hn = normalize(vec3(hq / vec2(5.8, 6.4) * .95, .6));
    vec3 hood = vec3(.35, .34, .33) * wool * (.5 + .6 * max(dot(hn, Lf), 0.));
    hood += vec3(.12) * smoothstep(-1.2, 0., dHood) * .5;
    vec2 oq = (hq - vec2(0., 4.3)) / vec2(3.1, 2.1);
    float open_ = length(oq);
    hood = mix(hood, hood * .45, (1. - smoothstep(.85, 1.25, open_)) * .7);
    float hair = (1. - smoothstep(.72, .95, open_)) * smoothstep(-.6, .1, -oq.y + .15);
    float cheek = (1. - smoothstep(.45, .7, length(oq - vec2(0., .45))));
    hood = mix(hood, vec3(.36, .22, .12) * (.8 + .3 * sin(oq.x * 9.)), hair);
    hood = mix(hood, vec3(.95, .77, .65) * .8, cheek * .85);
    rc = mix(rc, hood, hoodK);
    col = mix(col, rc * lit, rowK);
    cover = max(cover, rowK);
  }
  o = vec4(col, 1.) * cover;
}`;


// ─── dormant bank architecture: piers ─────────────────────────────────────

export const STRUCTURE_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 iA; // x, y, half-width, half-length
layout(location=2) in vec4 iB; // angle, kind, seed, side
uniform vec4 uView;
out vec2 vP;
out vec4 vA;
out vec4 vB;
out vec2 vW;
vec2 rotS(vec2 p, float a){ float c = cos(a), s = sin(a); return vec2(c*p.x - s*p.y, s*p.x + c*p.y); }
void main(){
  vP = aPos * 1.24;
  vA = iA;
  vB = iB;
  vec2 local = vP * iA.zw;
  vW = iA.xy + rotS(local, iB.x);
  gl_Position = vec4((vW - uView.xy) * uView.zw, 0., 1.);
}`;

export const STRUCTURE_FS = /* glsl */ `${HEAD}${COMMON}${RIVER}${CANOPY}
in vec2 vP;
in vec4 vA;
in vec4 vB;
in vec2 vW;
out vec4 o;

float boxS(vec2 p, vec2 b){
  vec2 d = abs(p) - b;
  return length(max(d, 0.)) + min(max(d.x, d.y), 0.);
}

/**
 * A plank jetty seen from above: four long boards laid along its length on
 * cross bearers, standing on pairs of piles every 36 units, silvered by
 * weather, dark and mossy toward the water. Local +y runs from the bank to
 * the tip; q is in world units.
 */
void main(){
  float seed = vB.z;
  vec2 q = vP * vA.zw;
  float w = vA.z, l = vA.w;
  float aa = max(fwidth(q.x), fwidth(q.y)) * 1.2;

  vec2 shW = -uSun.xy / max(uSun.z, .28) * 9.;
  vec2 shL = rot(shW, -vB.x);

  // the deck, with a little wander to its edges (boards are not laser-cut)
  float wob = (texture(uNoise, vec2(q.y * .02 + seed * 9., seed * 17.)).r - .5) * .6;
  float deckD = boxS(vec2(q.x + wob, q.y), vec2(w, l));
  float deck = 1. - smoothstep(-aa, aa, deckD);
  float ds = boxS(vec2(q.x + wob, q.y) - shL, vec2(w + .4, l + .4));
  float shadow = (1. - smoothstep(-aa * 2., aa * 2., ds)) * .3;

  // planks laid across the jetty, each spanning its width, ~3.6 units along, a
  // narrow gap between; two long bearers run beneath and show through the gaps
  float pw = 3.6;
  float by = (q.y + l) / pw;
  float bi = floor(by);
  float bf = fract(by);
  float gap = 1. - smoothstep(.06, .13, min(bf, 1. - bf));
  // each plank its own tone; the grain runs along the plank, across the deck
  float tone = hash12(vec2(bi, seed * 31.));
  float grain = texture(uNoise, vec2(q.x * .045 + seed * 5., bf * .9 + bi * 3.1)).r;
  float fine = texture(uNoise, vec2(q.x * .3, bf * 4. + bi)).a;
  vec3 wood = mix(vec3(.30, .29, .25), vec3(.47, .45, .38), tone * .45 + grain * .4 + fine * .15);
  // silvered on top, warm where the weather has not reached
  float silver = texture(uNoise, vec2(q.x * .06 + seed * 3., q.y * .02)).g;
  wood = mix(wood, vec3(.52, .53, .48), smoothstep(.55, .9, silver) * .3);
  // the bearers, at ±55% of the width: a nail into each per plank, and a darker
  // band where they run beneath the gaps
  float bear = 1. - smoothstep(1.2, 2.2, abs(abs(q.x) - w * .55));
  float nail = 1. - smoothstep(.45, .85, length(vec2(abs(q.x) - w * .55, (bf - .5) * pw)));
  // a plank now and then sits a shade darker, split or warped
  float odd = step(.9, hash12(vec2(bi * 2.7, seed * 13.)));
  wood *= 1. - odd * .18;
  // wet and mossy toward the tip, dark end grain at the very end
  float toWater = smoothstep(-l * .1, l, q.y);
  wood = mix(wood, vec3(.16, .18, .15), toWater * .45);
  float moss = texture(uNoise, vW / 19.).b;
  wood = mix(wood, vec3(.18, .25, .14), toWater * smoothstep(.55, .85, moss) * .35);
  float endg = 1. - smoothstep(1., 2.2, l - q.y);
  wood = mix(wood, vec3(.2, .17, .13), endg * .6);
  wood = mix(wood, vec3(.05, .05, .045), nail * .8);
  wood *= 1. - gap * (.55 + .35 * bear);
  float gapA = gap * .5;

  // the piles: pairs either side of the deck every 36 units, dark, with a wet collar
  float pile = 0.;
  float collar = 0.;
  for (int k = 0; k < 8; k++) {
    float py = -l + 14. + float(k) * 36.;
    if (py >= l - 6.) break;
    for (int sx = -1; sx <= 1; sx += 2) {
      vec2 d = q - vec2(float(sx) * (w + 2.5), py);
      float r = 4.;
      float dd = length(d);
      pile = max(pile, 1. - smoothstep(r - aa, r + aa, dd));
      collar = max(collar, smoothstep(r * .55, r * .95, dd) * (1. - smoothstep(r, r + 1., dd)));
    }
  }
  vec3 pileCol = mix(vec3(.12, .13, .12), vec3(.2, .21, .18), texture(uNoise, q * .2).r * .3);
  pileCol = mix(pileCol, vec3(.14, .21, .12), collar * .5);

  float cover = max(deck * (1. - gapA), pile);
  vec3 col = mix(pileCol, wood, deck * (1. - gapA) / max(cover, 1e-4));
  float light = .5 + .36 * max(uSun.z, 0.) * sunThrough(vW);
  col = col * (uAmb * .95 + uSunCol * light + LAMP * lampAt(vW) * 1.45);
  shadow *= 1. - cover * .2;

  if (cover < .003 && shadow < .003) discard;
  o = vec4(col * cover, cover + shadow * (1. - cover));
}`;

// ─── ribbons (rope, thread) ────────────────────────────────────────────────

export const RIBBON_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;  // world
layout(location=1) in vec4 iA;    // side, along, alpha, depth below the surface (0 = on it)
uniform vec4 uView;
uniform float uDepthK;
out vec4 vA;
out vec2 vWp;
out vec2 vUv;
void main(){
  vA = iA;
  vWp = aPos;
  // under the water, stems and rhizomes sit at their depth: smaller, slower
  vec2 clip = (aPos - uView.xy) * uView.zw / (1. + uDepthK * max(iA.w, 0.));
  vUv = clip * .5 + .5;
  gl_Position = vec4(clip, 0., 1.);
}`;

export const RIBBON_FS = /* glsl */ `${HEAD}${COMMON}
in vec4 vA;
in vec2 vWp;
in vec2 vUv;
out vec4 o;
uniform vec3 uColor;
uniform float uGlow;
uniform sampler2D uOcc;
void main(){
  float edge = 1. - smoothstep(.3, 1., abs(vA.x));
  if (uGlow > 2.5) {
    // a stem or rhizome under the water: rounded, dimmed and greened by the depth above it
    float round_ = 1. - vA.x * vA.x;
    vec3 c = uColor * (.55 + .5 * round_) * (.85 + .3 * texture(uNoise, vWp / 13.).r);
    float shade = 1. - texture(uOcc, vUv).r * .5;
    c *= (uAmb * .9 + uSunCol * .45 * shade);
    vec3 absorb = exp(-vA.w * vec3(1.6, .8, 1.0));
    c = c * absorb + uAmb * vec3(.05, .21, .19) * (1. - absorb);
    float a = (1. - smoothstep(.55, 1., abs(vA.x))) * vA.z;
    o = vec4(c, 1.) * a;
    return;
  }
  if (uGlow > 1.5) {
    // white water: bubbly and broken, thinning toward its edges and with age
    float n = texture(uNoise, vWp / 9. + uTime * .02).a * .55 + texture(uNoise, vWp / 23.).r * .6;
    float body = 1. - smoothstep(.1, 1., abs(vA.x));
    float fm = smoothstep(.62 - .3 * vA.z, 1.05, n + body * .3) * vA.z * .7;
    o = vec4(uColor * fm, fm * .8);
    return;
  }
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
layout(location=2) in vec4 iB;    // alpha, core, parallax scale (1 = the surface), -
uniform vec4 uView;
uniform float uDpr;
out vec4 vA;
out vec4 vB;
void main(){
  vA = iA; vB = iB;
  float par = iB.z > 0. ? iB.z : 1.;
  gl_PointSize = iA.x * uDpr * par;
  gl_Position = vec4((aPos - uView.xy) * uView.zw * par, 0., 1.);
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


// ─── dragonflies and butterflies ───────────────────────────────────────────

export const CRITTER_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 iA; // x, y, heading, size
layout(location=2) in vec4 iB; // kind, wing, height, alpha
layout(location=3) in vec4 iC; // seed, -, -, -
uniform vec4 uView;
uniform vec3 uSun;
uniform float uShadow;
uniform float uDepthK;
out vec2 vQ;
out vec4 vB;
out vec4 vC;
void main(){
  vQ = aPos;
  vB = iB;
  vC = iC;
  // the shadow spreads a little the higher the flier
  vec2 local = aPos * iA.w * (uShadow > .5 ? 1. + iB.z * .12 : 1.);
  float c = cos(iA.z), s = sin(iA.z);
  vec2 pos = iA.xy + vec2(local.x * c + local.y * s, -local.x * s + local.y * c);
  // above the water: parallax lifts it; its shadow lies on whatever is below, thrown by the sun
  float par = 1. / (1. - uDepthK * iB.z * .8);
  if (uShadow > .5) { pos += -uSun.xy / max(uSun.z, .3) * iB.z * 26.; par = 1.; }
  gl_Position = vec4((pos - uView.xy) * uView.zw * par, 0., 1.);
}`;

export const CRITTER_FS = /* glsl */ `${HEAD}${COMMON}
in vec2 vQ;
in vec4 vB;
in vec4 vC;
out vec4 o;
uniform float uShadow;
float sdSeg2(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h); }
float aa(float d, float soft){ return 1. - smoothstep(-soft, soft, d); }
/**
 * A DRAGONFLY from above: a slender abdomen of ten segments narrowing to a
 * waist behind the thorax, a stout thorax, a head that is mostly two great
 * eyes, and four long clear wings held straight out. Perched, the wings lie
 * flat and show their veins and the dark cell at each tip; in flight they are
 * two soft fans of blur with the sun catching the membrane now and then.
 */
void dragonfly(vec2 P, float blur, float seed, out vec3 col, out float body, out float wing){
  float soft = min(fwidth(P.x) * 1.1, .04);
  // abdomen: a rod from the tail to the waist, slightly clubbed toward the tip, pinched at the waist
  float u = (P.y + 1.) / 1.22;                       // 0 tail tip … 1 waist
  float aw = .062 * (1. - smoothstep(.15, 0., u) * .5) * (1. + .25 * sin(u * 3.14159)) * (1. - smoothstep(.85, 1., u) * .35);
  float abd = aa(abs(P.x) - aw, soft) * aa(-P.y - 1., soft) * aa(P.y - .22, soft);
  float th = aa(length((P - vec2(0., .40)) / vec2(.14, .21)) - 1., soft * 6.);
  float hd = aa(length((P - vec2(0., .66)) / vec2(.115, .10)) - 1., soft * 6.);
  float eye = 0.;
  for (int k = -1; k <= 1; k += 2) eye = max(eye, aa(length(P - vec2(float(k) * .075, .675)) - .08, soft));
  body = max(max(abd, th), max(hd, eye));
  // the species, by seed: an emperor's dusty blue, a darter's brick red, a demoiselle's bottle green
  vec3 abdC, thC, eyeC;
  if (seed < .4) { abdC = vec3(.36, .55, .78); thC = vec3(.30, .48, .40); eyeC = vec3(.30, .52, .55); }
  else if (seed < .7) { abdC = vec3(.72, .28, .18); thC = vec3(.44, .30, .22); eyeC = vec3(.48, .30, .22); }
  else { abdC = vec3(.18, .48, .40); thC = vec3(.14, .34, .30); eyeC = vec3(.22, .44, .36); }
  // segments: a fine dark ring at each joint, and a dark dorsal stripe that widens toward the tail
  float seg = 1. - smoothstep(.0, .05 + soft, abs(fract(u * 10.) - .5) * .1);
  float stripe = 1. - smoothstep(.0, .02 + soft, abs(P.x) - .018 * (1. - u * .5));
  vec3 c = abdC * (1. - .45 * seg) ;
  c = mix(c, c * .35, stripe * .75);
  // a rounded body: the sun on its near side, the far side falling away
  float nx = clamp(P.x / max(aw, .02), -1., 1.);
  vec3 n = normalize(vec3(nx * 1.1, 0., 1.));
  float lam = max(dot(n, normalize(uSun)), 0.);
  c *= .55 + .55 * lam;
  c += uSunCol * pow(max(0., 1. - abs(nx)), 5.) * .12;
  // thorax with pale stripes, head dark, eyes glossy
  float tstripe = 1. - smoothstep(.0, .02 + soft, abs(abs(P.x) - .07) - .012);
  vec3 tc = mix(thC, thC * 1.5, tstripe * .5) * (.6 + .5 * lam);
  c = mix(c, tc, th * (1. - abd * .5));
  c = mix(c, vec3(.10, .11, .08), hd * (1. - th * .3));
  c = mix(c, eyeC * (.7 + .5 * lam), eye);
  for (int k = -1; k <= 1; k += 2) c += vec3(.8) * aa(length(P - vec2(float(k) * .075 - .025, .70)) - .022, soft) * eye * .7;
  // wings: hinged at the thorax, straight out to the sides; the hind pair broader at the base
  wing = 0.;
  float vein = 0.;
  float stig = 0.;
  float glint = 0.;
  for (int k = -1; k <= 1; k += 2) {
    float s = float(k);
    vec2 fw = rot(vec2(P.x * s - .55, P.y - .49), .09);
    vec2 hw = rot(vec2(P.x * s - .53, P.y - .32), -.13);
    float fy = .085 + blur * .07;
    float hy = mix(.16, .085, smoothstep(-.43, .43, hw.x)) + blur * .08;
    float fr = length(fw / vec2(.43, fy));
    float hr = length(hw / vec2(.44, hy));
    float wf = aa(fr - 1., soft * 3. / .43 + blur * .25);
    float wh = aa(hr - 1., soft * 3. / .44 + blur * .25);
    wing = max(wing, max(wf, wh));
    // venation: cross veins every so often, a costa along the leading edge, a curve of longitudinals
    float cross = 1. - smoothstep(.0, .02 + soft * 4., abs(fract(fw.x * 9.) - .5) * .111);
    float costa = 1. - smoothstep(.0, .012 + soft * 2., abs(fw.y - fy * .8 + fw.x * .02));
    float longi = 1. - smoothstep(.0, .012 + soft * 2., abs(fract(fw.y * 14.) - .5) * .07);
    vein = max(vein, max(cross * .5, max(costa, longi * .35)) * wf);
    cross = 1. - smoothstep(.0, .02 + soft * 4., abs(fract(hw.x * 9.) - .5) * .111);
    costa = 1. - smoothstep(.0, .012 + soft * 2., abs(hw.y - hy * .8));
    longi = 1. - smoothstep(.0, .012 + soft * 2., abs(fract(hw.y * 14.) - .5) * .07);
    vein = max(vein, max(cross * .5, max(costa, longi * .35)) * wh);
    // the pterostigma: a small dark cell near each tip
    stig = max(stig, aa(length((fw - vec2(.30, fy * .45)) / vec2(.05, .02)) - 1., soft * 12.) * wf);
    // the sun on the membrane: a soft band that walks along as the wing tilts
    glint = max(glint, (.5 + .5 * sin(fw.x * 6. + uTime * 4. * (1. + blur * 6.) + seed * 9.)) * wf);
    glint = max(glint, (.5 + .5 * sin(hw.x * 6. - uTime * 3.5 * (1. + blur * 6.) + seed * 4.)) * wh * .8);
  }
  wing *= smoothstep(.09, .14, abs(P.x));
  vein *= 1. - blur * .85;
  // a clear membrane, faintly smoky, iridescent where the sun strikes; veins brown
  vec3 wc = mix(vec3(.86, .90, .92), vec3(.40, .33, .24), vein * .75);
  wc += uSunCol * glint * glint * .35 * (1. - vein);
  wc += vec3(.15, .05, .2) * glint * (1. - glint) * .4;
  wc = mix(wc, vec3(.32, .20, .12), stig * .9);
  float wa = mix(.30, .11, blur) * (.7 + .3 * vein) + stig * .55 + glint * glint * .12 * (1. - blur * .5);
  col = mix(wc, c, body);
  wing = wing * (1. - body) * wa;
}
/**
 * A BUTTERFLY from above: a small furred body, antennae, two pairs of broad
 * wings. The wings lift about the body as they beat, so from above they narrow
 * as they close and the paler underside shows; in a turn one side lifts more.
 * The species are the ones a child would know from a garden.
 */
void butterfly(vec2 P, float kind, float close, float turn, float seed, out vec3 col, out float body, out float wing){
  float soft = min(fwidth(P.x) * 1.1, .04);
  float bw = .055 * (1. + .4 * (1. - smoothstep(.0, .3, abs(P.y - .1))));
  float bd = aa(abs(P.x) - bw, soft) * aa(-.40 - P.y, soft) * aa(P.y - .36, soft);
  float hd = aa(length(P - vec2(0., .41)) - .065, soft);
  float ant = 0.;
  for (int k = -1; k <= 1; k += 2) {
    float s = float(k);
    ant = max(ant, aa(sdSeg2(P, vec2(0., .45), vec2(s * .20, .84)) - .009, soft));
    ant = max(ant, aa(length(P - vec2(s * .20, .84)) - .018, soft));
  }
  body = max(bd, max(hd, ant));
  // the wings fold up about the body axis; the side on the inside of a turn lifts more
  float side = sign(P.x);
  float cl = clamp(close + turn * side * .18, 0., 1.);
  float open = max(cos(cl * 1.5708), .05);
  vec2 W = vec2(abs(P.x) / open, P.y);
  // fore wing: a blade angled forward with a squarer tip and a gently concave trailing edge
  vec2 f = rot(W - vec2(.47, .22), -.30);
  float fr = length(f / vec2(.50, .31));
  fr = mix(fr, max(abs(f.x) / .50, abs(f.y) / .31), .3);
  fr += smoothstep(.2, .8, f.x / .5) * smoothstep(.0, -.4, f.y / .31) * .10; // the trailing edge sweeps in
  // hind wing: rounder, tucked behind, a softly scalloped margin
  vec2 h = W - vec2(.36, -.25);
  float ha = atan(h.y, h.x);
  float hr = length(h / vec2(.38, .33)) * (1. + .025 * sin(ha * 9. + seed * 7.));
  float wf = aa(fr - 1., soft * 3.);
  float wh = aa(hr - 1., soft * 3.);
  float wings = max(wf, wh) * smoothstep(.02, .06, W.x);
  float edge = max(wf * fr, wh * hr);
  float u = W.x;
  // veins radiating from the root
  float av = atan(W.y - .05, W.x);
  float vein = (1. - smoothstep(.0, .025 + soft * 3., abs(fract(av * 3.2 + seed) - .5) * .3)) * smoothstep(.15, .3, u);
  vein = max(vein, (1. - smoothstep(.0, .02 + soft * 3., abs(fract((W.y + .25) * 6.) - .5) * .16)) * wh * smoothstep(.15, .3, u) * .6);
  vec3 base, mark = vec3(0.), under;
  float pat = 0.;
  if (kind < 1.5) {
    // small tortoiseshell: tawny orange; the base and the fore wing's leading edge dark, a dark
    // border set with blue crescents, two pale patches near the tip
    base = vec3(.82, .46, .16);
    under = vec3(.30, .22, .14);
    mark = vec3(.14, .09, .06);
    pat = smoothstep(.36, .16, u) * .9 + smoothstep(.50, .60, W.y + u * .15) * wf * .95 + smoothstep(.82, .9, edge);
    float cres = 1. - smoothstep(.0, .06, abs(fract(av * 4.5) - .5) * .35 + abs(edge - .86) * 1.4);
    base = mix(base, vec3(.42, .58, .88), cres * smoothstep(.78, .86, edge) * .85);
    base = mix(base, vec3(.96, .90, .68), aa(length(W - vec2(.62, .44)) - .05, soft * 4.) * wf * .9);
    base = mix(base, vec3(.14, .09, .06), aa(length(W - vec2(.42, .33)) - .04, soft * 4.) * wf * .8);
  } else if (kind < 2.5) {
    // cabbage white: chalk white warming toward the body, a smoky tip and a spot on each fore wing
    base = vec3(.94, .94, .89) * (.9 + .1 * smoothstep(.5, .1, u));
    under = vec3(.86, .84, .62);
    mark = vec3(.22, .20, .18);
    pat = smoothstep(.76, .92, u + W.y * .4) * wf * .85 + aa(length(W - vec2(.52, .30)) - .05, soft * 4.) * wf * .7;
  } else if (kind < 3.5) {
    // common blue: a lilac blue with a fine dark margin and a white fringe; grey-buff beneath, spotted
    base = vec3(.46, .50, .80);
    under = vec3(.60, .56, .46);
    mark = vec3(.10, .09, .10);
    pat = smoothstep(.87, .93, edge) * (1. - smoothstep(.95, .99, edge)) * .85;
    base = mix(base, vec3(.92), smoothstep(.95, .99, edge));
    float spots = aa(abs(fract(av * 3. + .2) - .5) * .35 + abs(edge - .6) * 1.2 - .04, soft * 3.);
    under = mix(under, vec3(.24, .18, .12), spots * .7);
  } else {
    // brimstone: a pale sulphur, leaf-veined, one small orange spot on each wing
    base = vec3(.90, .87, .52);
    under = vec3(.80, .82, .56);
    mark = vec3(.82, .52, .18);
    pat = aa(length(W - vec2(.52, .27)) - .045, soft * 4.) * wf + aa(length(W - vec2(.40, -.24)) - .035, soft * 4.) * wh;
  }
  vec3 wc = mix(base, mark, clamp(pat, 0., 1.));
  wc *= 1. - vein * .18;
  // scales are darker where the wing meets the body, and the margin is a shade deeper everywhere
  wc *= 1. - .25 * smoothstep(.22, .05, u) - .12 * smoothstep(.9, 1., edge);
  // as the wings close the underside shows; a raised wing takes the sun on one face only
  wc = mix(wc, under, smoothstep(.5, .9, cl));
  float lit = .7 + .35 * open + .15 * side * sign(uSun.x) * (1. - open);
  wc *= lit;
  col = mix(wc, vec3(.17, .13, .09), body);
  col = mix(col, vec3(.10, .08, .05), hd * .5);
  wing = wings * (1. - body) * .97;
}
void main(){
  float kind = vB.x, wingP = vB.y, h = vB.z, alpha = vB.w;
  float seed = vC.x, turn = vC.y;
  vec3 col; float body, wing;
  if (kind < .5) dragonfly(vQ, wingP, seed, col, body, wing);
  else butterfly(vQ, kind, wingP, turn, seed, col, body, wing);
  float cover = max(body, wing);
  if (cover < .003) discard;
  if (uShadow > .5) {
    // higher up, the shadow is fainter and softer
    float k = .26 / (1. + h * .9);
    o = vec4(0., 0., 0., (body + wing * (kind < .5 ? .25 : .75)) * k * alpha);
    return;
  }
  col *= uAmb * .85 + uSunCol * (.5 + .35 * max(uSun.z, 0.));
  o = vec4(col, 1.) * cover * alpha;
}`;

// ─── the notebook's paper ──────────────────────────────────────────────────

export const PAPER_FS = /* glsl */ `${HEAD}${COMMON}
in vec2 vUv;
in vec2 vWorld;
out vec4 o;
uniform float uPage; // 0 closed … 1 open
uniform float uAspect;
void main(){
  // laid paper: a warm cream with a faint grain and a soft vignette; the river ghosts through at the edges
  vec2 g = vec2(vUv.x * uAspect, vUv.y) * 90.;
  float grain = (nz(g * .031) - .5) * .05 + (nz(g * .19) - .5) * .025;
  vec3 paper = vec3(.93, .89, .78) + grain;
  float edge = smoothstep(.0, .12, vUv.x) * smoothstep(1., .88, vUv.x) * smoothstep(.0, .09, vUv.y) * smoothstep(1., .91, vUv.y);
  float a = uPage * mix(.9, .985, edge);
  o = vec4(paper * a, a);
}`;

// ─── the residents: a heron, a frog, a turtle, each at their pier ──────────

export const RESIDENT_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 iA; // x, y, heading, size
layout(location=2) in vec4 iB; // kind, mood, look, seed
layout(location=3) in vec4 iC; // -
uniform vec4 uView;
uniform vec3 uSun;
uniform float uShadow;
out vec2 vQ;
out vec4 vB;
out vec2 vWorld;
out float vHeading;
out float vHop;
void main(){
  vQ = aPos;
  vB = iB;
  vHeading=iA.z;
  vHop=iC.x;
  vec2 local = aPos * iA.w * (uShadow > .5 ? 1.04 : 1.);
  float c = cos(iA.z), s = sin(iA.z);
  vec2 pos = iA.xy + vec2(local.x * c + local.y * s, -local.x * s + local.y * c);
  if (uShadow > .5) pos += -uSun.xy / max(uSun.z, .3) * 5.;
  vWorld=pos;
  gl_Position = vec4((pos - uView.xy) * uView.zw, 0., 1.);
}`;

export const RESIDENT_FS = /* glsl */ `${HEAD}${COMMON}
in vec2 vQ;
in vec4 vB;
in vec2 vWorld;
in float vHeading;
in float vHop;
out vec4 o;
uniform float uShadow;
float aa2(float d, float soft){ return 1. - smoothstep(-soft, soft, d); }
float sdSeg3(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h); }
float sdEll(vec2 p, vec2 r){ return (length(p / r) - 1.) * min(r.x, r.y); }
/** A grey heron standing at the end of a pier, seen from above: a long slate back, folded wings, a neck curved forward to a yellow bill. */
void heron(vec2 P, float t, float look, float content, out vec3 col, out float cover){
  float soft = max(fwidth(P.x) * 1.1, .006);
  float sdBody = sdEll(P - vec2(0., -.42), vec2(.2, .4));
  float body = aa2(sdBody, soft);
  float wing = 0.;
  for (int k = -1; k <= 1; k += 2) {
    float s = float(k);
    vec2 w = P - vec2(s * (.1 + content * .025), -.44);
    wing = max(wing, aa2(sdEll(rot(w, s * .16), vec2(.11, .36)), soft));
  }
  // Slender ankles and three toes grip the planks, distinct from folded wings.
  float feet=0.;
  for(int k=-1;k<=1;k+=2) {
    vec2 ankle=vec2(float(k)*.16,-.63);
    feet=max(feet,aa2(sdSeg3(P,ankle,ankle+vec2(float(k)*.07,-.17))-.018,soft));
    for(int j=-1;j<=1;j++) feet=max(feet,aa2(sdSeg3(P,ankle+vec2(float(k)*.07,-.17),ankle+vec2(float(j)*.075,-.27))-.012,soft));
  }
  // the neck: an S from the shoulders forward, the head turned a little toward what it watches
  vec2 n0 = vec2(0., -.06), n1 = vec2(.13 + look * .1, .24 + .012 * sin(t * .7)), n2 = vec2(.07 + look * .16, .46);
  float neck = max(aa2(sdSeg3(P, n0, n1) - .075, soft), aa2(sdSeg3(P, n1, n2) - .065, soft));
  vec2 hp = n2 + vec2(.01, .1);
  float head = aa2(sdEll(P - hp, vec2(.15, .1)), soft);
  vec2 bill0 = hp + vec2(.03, .06), bill1 = hp + vec2(.10 + look * .08, .31);
  float along = clamp(dot(P - bill0, bill1 - bill0) / dot(bill1 - bill0, bill1 - bill0), 0., 1.);
  float bill = aa2(sdSeg3(P, bill0, bill1) - mix(.055, .014, along), soft);
  float eye = aa2(length(P - (hp + vec2(.05, .02))) - .024, soft);
  cover = max(feet,max(max(body, wing), max(max(neck, head), bill)));
  vec3 back = vec3(.44, .50, .56), slate = vec3(.24, .29, .36), pale = vec3(.93, .94, .93);
  // the body's edge falls away into shadow; a dark ridge along the spine
  float edge = 1. - smoothstep(-.09, .0, sdBody);
  col = back * (1. - .3 * edge);
  col = mix(col, slate, wing);
  col = mix(col, slate * .7, wing * (1. - smoothstep(.0, .03, abs(P.x) - (.1 + content * .025) - .1)) * .4);
  // Layered flight feathers follow the folded wings; no noisy outline.
  float vane=sin((P.y+abs(P.x)*1.6)*93. + sin(P.y*11.)*.6);
  col*=1.+vane*.075*wing;
  col=mix(col,vec3(.38,.33,.21),feet*(1.-max(body,wing)));
  col = mix(col, pale, max(neck, head));
  // the neck's front is streaked dark
  col = mix(col, vec3(.35, .38, .4), neck * (1. - smoothstep(.0, .03 + soft, abs(P.x - mix(n0.x, n2.x, clamp((P.y - n0.y) / (n2.y - n0.y), 0., 1.))) - .012)) * .5);
  col = mix(col, vec3(.90, .72, .22), bill);
  col = mix(col, vec3(.06), eye);
  // the black crest, back from the eye over the head
  col = mix(col, vec3(.12, .13, .16), aa2(sdSeg3(P, hp + vec2(-.01, .03), hp + vec2(-.15, -.05)) - .02, soft) * head * .95);
}
/** A small frog sat at the pier's edge: a plump green body, two eye bumps, hind legs folded beside it, a throat that pulses. */
void frog(vec2 P, float t, float look, float content, out vec3 col, out float cover){
  float soft = max(fwidth(P.x) * 1.1, .006);
  P.y/=1.+vHop*.22;
  float pulse = 1. + .012 * sin(t * 2.1);
  float body = aa2(sdEll(P - vec2(0., -.02), vec2(.36 * pulse, .5)), soft);
  float legs = 0.;
  float feet = 0.;
  for (int k = -1; k <= 1; k += 2) {
    float s = float(k);
    legs = max(legs, aa2(sdEll(rot(P - vec2(s * .44, -.2), s * .5), vec2(.22, .14)), soft));
    // Bent forearms end in fine splayed toes rather than circular paws.
    feet=max(feet,aa2(sdSeg3(P,vec2(s*.27,.14),vec2(s*.42,.3))-.036,soft));
    for(int j=-1;j<=1;j++) feet=max(feet,aa2(sdSeg3(P,vec2(s*.42,.3),vec2(s*(.46+float(j)*.04),.39-abs(float(j))*.025))-.016,soft));
    for(int j=-1;j<=1;j++) feet=max(feet,aa2(sdSeg3(P,vec2(s*.48,-.27),vec2(s*(.58+float(j)*.04),-.4+float(j)*.025))-.018,soft));
  }
  float eyes = 0., pupils = 0.;
  for (int k = -1; k <= 1; k += 2) {
    float s = float(k);
    vec2 e = P - vec2(s * .18, .42);
    eyes = max(eyes, aa2(length(e) - .11, soft));
    pupils = max(pupils, aa2(length(e - vec2(look * .03, .03)) - .045, soft));
  }
  cover = max(max(body, legs), max(feet, eyes));
  vec3 green = vec3(.32, .43, .20), dark = vec3(.14, .24, .10);
  float blot = smoothstep(.55, .7, nz(P * .9 + vB.w * 3.));
  col = mix(green, dark, blot * .8);
  col = mix(col, green * 1.15, (1. - smoothstep(.0, .5, length((P - vec2(0., -.05)) / vec2(.36, .5)))) * .25);
  col = mix(col, dark, max(legs, feet) * (1. - body) * .4);
  col = mix(col, vec3(.82, .70, .30), eyes);
  col = mix(col, vec3(.05), pupils);
  float ridge=exp(-pow((abs(P.x)-.23)/.025,2.))*body;
  col+=vec3(.10,.10,.035)*ridge;
  col*=.94+.12*nz(P*6.+vB.w*5.);
  float blink=smoothstep(.97,1.,sin(t*.61));
  col=mix(col,green,eyes*blink*.95);
  // the throat, paler
  col = mix(col, vec3(.86, .88, .62), aa2(sdEll(P - vec2(0., .22), vec2(.16, .1 * pulse)), soft) * .7);
}
/** An old turtle resting on the planks: a domed shell of scutes, a head out, four stubby legs, a tail. */
void turtle(vec2 P, float t, float look, float content, out vec3 col, out float cover){
  float soft = max(fwidth(P.x) * 1.1, .006);
  float shell = aa2(sdEll(P, vec2(.5, .6)), soft);
  float rim = aa2(sdEll(P, vec2(.5, .6)), soft) - aa2(sdEll(P, vec2(.42, .52)), soft);
  float head = aa2(sdEll(P - vec2(look * .06, .66 + vB.y*.035 + .012 * sin(t * .8)), vec2(.13, .16)), soft);
  float legs = 0.;
  for (int k = -1; k <= 1; k += 2) {
    float s = float(k);
    legs = max(legs, aa2(sdEll(rot(P - vec2(s * .5, .3), s * .6), vec2(.13, .09)), soft));
    legs = max(legs, aa2(sdEll(rot(P - vec2(s * .48, -.36), -s * .6), vec2(.13, .09)), soft));
  }
  float tail = aa2(sdSeg3(P, vec2(0., -.55), vec2(.04, -.8)) - .03, soft);
  cover = max(max(shell, head), max(legs, tail));
  // scutes: a central row and two flanking rows, each a rounded cell
  vec2 q = vec2(P.x / .5, P.y / .6);
  float row = abs(q.x) < .33 ? 0. : 1.;
  vec2 cell = row < .5 ? vec2(0., (floor(q.y * 2.5 + .5)) / 2.5) : vec2(sign(q.x) * .62, (floor(q.y * 2. + .25) - .25) / 2.);
  float sc = length((q - cell) / (row < .5 ? vec2(.33, .2) : vec2(.32, .25)));
  float seam = smoothstep(.78, .92, sc);
  vec3 olive = vec3(.36, .40, .22), dark = vec3(.22, .25, .13), skin = vec3(.42, .46, .28);
  float dome = 1. - smoothstep(.0, 1., length(q));
  col = mix(olive, dark, seam * .9) * (.7 + .45 * dome);
  // Worn growth rings within the scutes, irregular olive pigmentation.
  float growth=sin(sc*54.+nz(P*3.+vB.w)*2.);
  col*=.94+.055*growth+.10*nz(P*5.+vB.w);
  col = mix(col, olive * 1.2, rim * .5);
  col = mix(col, skin, max(head, max(legs, tail)) * (1. - shell));
  col = mix(col, vec3(.06), aa2(length(P - vec2(look * .06 + .07, .78)) - .02, soft) * head);
  col = mix(col, vec3(.06), aa2(length(P - vec2(look * .06 - .07, .78)) - .02, soft) * head);
}
void pierLantern(vec2 P, float lit, out vec3 col, out float cover) {
  float soft=max(fwidth(P.x),.008);
  float base=aa2(length(P/vec2(.48,.42))-1.,soft*2.);
  float glass=aa2(length(P/vec2(.34,.29))-1.,soft*2.);
  float rim=base-glass;
  float post=aa2(sdEll(P-vec2(0.,-.49),vec2(.16,.24)),soft);
  float handle=aa2(abs(length((P-vec2(0.,.24))/vec2(.25,.3))-1.)-.10,soft*3.);
  float strut=aa2(abs(P.x)-.037,soft)*base;
  cover=max(base,max(post,handle));
  vec3 metal=mix(vec3(.13,.16,.15),vec3(.38,.35,.25),.5+.5*P.x);
  col=mix(metal,vec3(.16,.23,.21),glass);
  col=mix(col,vec3(.21,.18,.11),post*(1.-base));
  col+=vec3(.13,.17,.16)*glass*exp(-pow((P.x+.17)/.03,2.));
  col=mix(col,metal,strut);
  col+=vec3(.25,.22,.14)*rim*max(0.,P.y);
  float flame=exp(-dot(P/vec2(.12,.18),P/vec2(.12,.18))*2.);
  col=col*(uAmb+uSunCol*.7)+LAMP*lit*glass*.55;
  col+=vec3(1.,.78,.35)*lit*flame*2.8*(1.-strut*.7);
}
void main(){
  float kind = vB.x, mood = vB.y, look = vB.z, seed = vB.w;
  float t = uTime + seed * 40.;
  vec3 col; float cover;
  if(kind>2.5) pierLantern(vQ,mood,col,cover);
  else if (kind < .5) heron(vQ, t, look, mood > 1.5 ? 1. : 0., col, cover);
  else if (kind < 1.5) frog(vQ, t, look, mood > 1.5 ? 1. : 0., col, cover);
  else turtle(vQ, t, look, mood > 1.5 ? 1. : 0., col, cover);
  if (cover < .003) discard;
  if (uShadow > .5) { o = vec4(0., 0., 0., cover * .3); return; }
  if(kind<2.5) {
    // A rounded back lit in world space; the boat and pier lamps share this light.
    vec2 grad=vQ*vec2(kind<.5?1.7:1.2,.7);
    vec2 ng=rot(grad,-vHeading);
    vec3 normal=normalize(vec3(ng,1.));
    float sun=max(dot(normal,normalize(uSun)),0.);
    col*=uAmb*.85+uSunCol*(.25+.7*sun)+LAMP*lampAt(vWorld)*1.15;
    float wet=kind>.5&&kind<1.5?.13:.025;
    col+=uSunCol*pow(max(dot(normal,normalize(normalize(uSun)+vec3(0.,0.,1.))),0.),45.)*wet;
  }
  o = vec4(col, 1.) * cover;
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
  WEED_VS,
  WEED_FS,
  MIST_FS,
  FLOWER_VS,
  FLOWER_FS,
  FLOATER_VS,
  FLOATER_FS,
  NAME_VS,
  NAME_FS,
  STRUCTURE_VS,
  STRUCTURE_FS,
  BOAT_VS,
  BOAT_FS,
  RIBBON_VS,
  RIBBON_FS,
  MOTE_VS,
  MOTE_FS,
  GRADE_FS,
  CRITTER_VS,
  CRITTER_FS,
  PAPER_FS,
  RESIDENT_VS,
  RESIDENT_FS,
};


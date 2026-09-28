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
float lampAt(vec2 wp){ vec2 d = (wp - uLamp.xy) / uLamp.z; return uLamp.w * exp(-dot(d, d) * 2.5); }
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
  // white water: spreads a touch, fades over a few seconds
  float foam = mix(foamAt(uv), (foamAt(uv - vec2(uTexel.x, 0.)) + foamAt(uv + vec2(uTexel.x, 0.)) + foamAt(uv - vec2(0., uTexel.y)) + foamAt(uv + vec2(0., uTexel.y))) * .25, .25) * .988;
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
uniform vec2 uSpanY;
uniform float uDepthK;
vec2 chanAt(float y){
  float f = clamp((y - uSpanY.x) / (uSpanY.y - uSpanY.x), 0., 1.) * 32.;
  float fi = min(floor(f), 31.);
  int i = int(fi);
  return mix(uChan[i], uChan[i + 1], f - fi);
}
float openAt(vec2 wp){
  vec2 ch = chanAt(wp.y);
  return 1. - smoothstep(ch.y * .35, ch.y + 120., abs(wp.x - ch.x));
}
float depthAt(vec2 wp){
  float n = texture(uNoise, wp / 1024.).r;
  float n2 = texture(uNoise, wp / 256.).g;
  return .22 + .78 * openAt(wp) + .3 * (n - .5) + .1 * (n2 - .5);
}
vec2 flowAt(vec2 wp){
  vec2 a = chanAt(wp.y - 20.), b = chanAt(wp.y + 20.);
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
  vec2 ch = chanAt(q.y);
  float off = abs(q.x - ch.x);
  // the trees overhang the banks; the run itself is open to the sky
  float reach = smoothstep(ch.y * .55, ch.y + 150., off);
  float big = texture(uNoise, q / 760.).r;
  float mid = texture(uNoise, q / 170. + 3.1).g;
  float fine = texture(uNoise, q / 36. + uTime * vec2(.004, .002)).r;
  float leaf = texture(uNoise, q / 11. + uTime * vec2(.006, .003)).b;
  float v = reach * 1.2 + (big - .5) * .8 + (mid - .5) * .55 + (fine - .5) * .35 + (leaf - .5) * .18 - .5;
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
  c = pow(c, mix(.8, 1.4, depth - .3)) * light * (1.35 - depth * .7);
  vec3 lit = col * (uAmb * .75 + uSunCol * (.42 + c * 1.15) * light + LAMP * lampAt(wp) * .8);

  // the water column: red goes first, then blue — deep water turns to green-black
  vec3 absorb = exp(-depth * vec3(1.6, .8, 1.0));
  vec3 deep = uAmb * vec3(.05, .21, .19);
  o = vec4(lit * absorb + deep * (1. - absorb), 1.);
}`;

// ─── fish ──────────────────────────────────────────────────────────────────

export const FISH_VS = /* glsl */ `${HEAD}
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 iA; // x, y, heading, size
layout(location=2) in vec4 iB; // z, kind, tail phase, effort
layout(location=3) in vec4 iC; // flash, seed, -, -
uniform vec4 uView;
uniform vec3 uSun;
uniform float uShadow;
uniform float uDepthK;
out vec2 vQ;
out vec4 vB;
out vec2 vUv;
out float vFlash;
out float vSeed;
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
  vFlash = iC.x;
  vSeed = iC.y;
  // deeper fish sit smaller and slide slower (and their shadows sit on the bed)
  float d = uShadow > .5 ? 1.2 : .15 + z;
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
out vec4 o;
uniform float uShadow;
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
  float bendAmp = .06 + min(speed, 60.) * .0011;
  float spine = sin(along * 2.6 - swim) * bendAmp * pow(clamp((1. - along) * .5, 0., 1.), 1.6);
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
  if (uShadow > .5) { o = vec4(0., 0., 0., cover * .22 * (1. - z * .6)); return; }
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

float seed;
vec2 so; // seed offset into the noise tile

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
  float n = texture(uNoise, vec2(a / TAU * 2. + seed * 3.1, seed * 7.3 + uTime * .006)).r;
  float n2 = texture(uNoise, vec2(a / TAU * 5. + seed * 1.7, seed * 2.9 - uTime * .004)).g;
  return pow(clamp((n * .75 + n2 * .45) * 1.7 - 1.05, 0., 1.), 1.4) * curl;
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
  for (int i = 0; i < 2; i++) {
    float hi = fract(seed * (13.1 + float(i) * 7.7));
    if (hi < .55) continue;
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
  h -= .004 * veins(p, len);
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
  for (int i = 0; i < 10; i++) {
    if (i >= count) break;
    vec4 dr = texelFetch(uDrops, ivec2(i, row), 0);
    if (dr.w < .01) continue;
    // as the leaf flexes, its dew shivers
    dr.xy += vec2(sin(float(i) * 2.3 + seed * 17.), cos(float(i) * 1.7 + seed * 11.)) * vDent.z * .025;
    float rr = dr.z * (.35 + .65 * dr.w);
    vec2 q = (p - dr.xy) / rr;
    float sdist = length(q + Ll.xy * .62);
    shadow = max(shadow, (1. - smoothstep(.7, 1.2, sdist)) * dr.w);
    float dl = length(q);
    if (dl < 1.02 && inside == 0.) { inside = 1.; dq = q; dd = vec4(dr.xy, rr, dr.w); }
    glowK = max(glowK, exp(-max(dl - 1., 0.) * 2.2) * dr.w);
  }
  col *= 1. - shadow * .38;
  // a chosen drop's light spills a little onto the leaf around it
  col += vec3(1., .8, .42) * sel * glowK * .22;

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
    // chosen: the dew itself lights, warm from within
    under += vec3(1., .82, .42) * sel * .75 * (1. - dl * .5);
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
    col = mix(col, c, edge * smoothstep(0., .2, dd.w));
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
  return (texture(uNoise, p / 256.).rg - .5) * .085
       + (texture(uNoise, p / 64.).gr - .5) * .065
       + (texture(uNoise, p / 28.).rg - .5) * .03;
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
    grad += ((texture(uNoise, q / 11.).rg - .5) * .55 + (texture(uNoise, q / 5.).gr - .5) * .32) * k;
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
  float cloud = texture(uNoise, q / 900. + uTime * vec2(.0012, .0006)).g * .6 + texture(uNoise, q / 330. + uTime * .001).r * .4;
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
  float bub = texture(uNoise, wp / 7. + uTime * .03).a * .6 + texture(uNoise, wp / 19. - uTime * .02).r * .6;
  float fm = smoothstep(.25, .9, foam * bub * 1.4);
  col = mix(col, vec3(.86, .9, .86) * (uAmb * 1.3 + uSunCol * .75), fm * .8);
  // the lantern: warm light on the water around the boat and its glints in the ripples
  float lamp = lampAt(wp);
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

export const WEED_FS = /* glsl */ `${HEAD}${COMMON}
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
  vec3 absorb = exp(-d * vec3(1.6, .8, 1.0));
  col = col * absorb + uAmb * vec3(.05, .21, .19) * (1. - absorb);
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
  vec3 light = uAmb * .85 + uSunCol * .55 * sunThrough(vBW) + LAMP * lampAt(vBW) * .4;
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
    vec3 lit = uAmb * .85 + uSunCol * .55 * sunThrough(vBW) + LAMP * lampAt(vBW) * .4;
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
  BOAT_VS,
  BOAT_FS,
  RIBBON_VS,
  RIBBON_FS,
  MOTE_VS,
  MOTE_FS,
  GRADE_FS,
};

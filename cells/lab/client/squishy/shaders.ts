/**
 * Squishy's shaders, as GLSL source: the room and the course (VS/FS), the dumpling as dough and as jelly, its glitter,
 * steam and flour, soap bubbles, the jelly's back, the window's shadow, the sky; and the finish (bright, blur, onto the
 * glass). Compiled in gpu.ts; `HDR` is defined there, before each is compiled, where the card can draw into floats.
 */
import { JAR_UNDER, MAT } from './level';
import { CELL as BOOK_CELL, COLS as BOOK_COLS, ROWS as BOOK_ROWS } from './books';

// ─── shaders ────────────────────────────────────────────────────────────────────────────────────
/** the kitchen: a morning window, warm walls, the counter's wood; and the output transfer */
const COMMON = `
uniform vec3 uKey, uKeyCol, uWin, uAmb;
float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  float a = hash3(i), b = hash3(i + vec3(1, 0, 0)), c = hash3(i + vec3(0, 1, 0)), d = hash3(i + vec3(1, 1, 0));
  float e = hash3(i + vec3(0, 0, 1)), g = hash3(i + vec3(1, 0, 1)), h = hash3(i + vec3(0, 1, 1)), k = hash3(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float fbm(vec3 p) { return noise(p) * .5 + noise(p * 2.03 + 11.) * .25 + noise(p * 4.07 + 23.) * .125; }
/** the room by direction: the counter and floor below, cream walls, a pale ceiling, the window, the sun in it */
// Diffuse room light is deliberately separate from sharp window reflections.
vec3 irradiance(vec3 n) {
  // (warm: the wood below throws its colour up, the cream room round it, the window's light)
  return (mix(vec3(.27, .185, .115), vec3(.47, .44, .40), smoothstep(-.65, .85, n.y))
    + vec3(.19, .16, .115) * max(dot(n, uWin), 0.)) * uAmb;
}
vec3 env(vec3 d) {
  vec3 c = mix(vec3(.29, .2, .12), vec3(.62, .58, .52), smoothstep(-.25, .8, d.y));
  vec3 right = normalize(cross(vec3(0., 1., 0.), uWin));
  vec3 up = cross(uWin, right);
  float forward = dot(d, uWin);
  vec2 pane = vec2(dot(d, right), dot(d, up)) / max(forward, .01);
  // (a fixed softness, not fwidth: env is reached from inside branches, where derivatives aren't defined)
  vec2 aa = vec2(.02);
  vec2 frame = 1. - smoothstep(vec2(.34, .48) - aa, vec2(.34, .48) + aa, abs(pane));
  float mullion = smoothstep(.016, .029, abs(pane.x)) * smoothstep(.016, .029, abs(pane.y));
  c += vec3(1., .95, .85) * 2.5 * frame.x * frame.y * mix(.30, 1., mullion) * step(.1, forward);
  // (and the sun, a glint)
  c += uKeyCol * pow(max(dot(d, uKey), 0.), 500.) * 2.;
  return c;
}
// Surface-gradient bump: world-space relief without a tangent attribute or extra texture reads.
vec3 reliefNormal(vec3 n, vec3 p, float h) {
  vec3 dx = dFdx(p), dy = dFdy(p);
  vec3 r1 = cross(dy, n), r2 = cross(n, dx);
  float det = dot(dx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2) / max(abs(det), 1e-5);
  grad /= max(1., length(grad) / .55);
  return normalize(n - grad);
}
// A liquid lying out (butter, honey, a sauce), as Stillwater's dew is drawn: d how far in from its edge (0 there,
// 1 where it's stood up to its full height), how tall it stands (cm); thin and deep its colour; how much light it
// gathers. It stands up steeply at its edge (a meniscus) and flattens over, so its edge is a bright rim toward the
// eye and a dark wet line where it meets what it's on; the light through it gathers on the far side of each swell
// from the sun; and it's glossy, the sun a pinpoint in it. It sets n over its swell (relief stays 0).
void liquid(float d, float tall, vec3 p, vec3 thin, vec3 deep, float glow, inout vec3 n, out vec3 base, out float rough, out float coat, out float coatRough, out float coatSpec, out float emit) {
  float k = clamp(d, 0., 1.), h = 1. - (1. - k) * (1. - k);
  vec3 n0 = n;
  n = reliefNormal(n, p, h * tall);
  vec3 tilt = n - n0 * dot(n, n0), sunOn = uKey - n0 * dot(uKey, n0);
  float lee = max(0., -dot(tilt, sunOn / max(length(sunOn), 1e-3)));
  base = mix(thin, deep, smoothstep(0., .9, h));
  base *= .62 + .38 * smoothstep(0., .12, d);
  rough = .05; coat = 1.; coatRough = .025; coatSpec = .3;
  emit = glow * (.25 + .35 * h + 2.2 * lee);
}
// (in HDR, what's drawn stays linear light, tonemapped once at the end (FINISH_FS); without it, each thing as it's drawn)
vec3 tonemapNow(vec3 x) {
  x *= .7;
  x = (x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14);
  return pow(clamp(x, 0., 1.), vec3(1. / 2.2));
}
#ifdef HDR
vec3 tonemap(vec3 x) { return x; }
// (a colour meant as seen, back to the light that would be seen as it)
vec3 untonemap(vec3 c) {
  vec3 y = pow(clamp(c, 0., .97), vec3(2.2));
  vec3 a = 2.51 - 2.43 * y, b = .03 - .59 * y, k = -.14 * y;
  return (-b + sqrt(b * b - 4. * a * k)) / (2. * a) / .7;
}
#else
vec3 tonemap(vec3 x) { return tonemapNow(x); }
vec3 untonemap(vec3 c) { return c; }
#endif
float D_ggx(float NoH, float a) { float a2 = a * a; float d = NoH * NoH * (a2 - 1.) + 1.; return a2 / (3.1416 * d * d); }
float V_smith(float NoV, float NoL, float a) { float a2 = a * a; return .5 / max(NoL * sqrt(NoV * NoV * (1. - a2) + a2) + NoV * sqrt(NoL * NoL * (1. - a2) + a2), 1e-4); }`;
/**
 * What's on the dumpling: flour (white, dry, matte), butter (yellow, glossy), crumbs (brown bits,
 * and bumpy), pepper (black specks), hundreds and thousands (little coloured rods). Each where it
 * is, as thick as it is; the patterns sit on its rest shape, so they ride its wobble.
 */
const COAT_GLSL = `
vec3 coatColor(vec3 q, vec2 coat, vec3 base, inout float rough, inout float gloss, inout vec3 n, vec3 nRest) {
  float a = coat.x;
  if (a < .02) return base;
  int k = int(coat.y + .5);
  vec3 c = base;
  if (k == 1) {
    // flour: a dusting, thicker in the creases, speckled; whiter and cooler than the dough, and chalky, so it shows on it
    float fine = noise(q * 30.) * .5 + noise(q * 9. + 7.) * .5;
    float d = smoothstep(.08, .55, a * (0.55 + .9 * fine));
    float clump = smoothstep(.62, .7, noise(q * 14. + 3.)) * smoothstep(.3, .7, a);
    c = mix(base, vec3(1.04, 1.04, 1.06), clamp(d + clump * .5, 0., 1.));
    rough = mix(rough, 1., d); gloss *= 1. - d;
  } else if (k == 2) {
    // butter: a yellow sheen, greasy
    float d = smoothstep(.03, .4, a);
    c = mix(base, base * vec3(1., .84, .32) + vec3(.16, .11, 0.), d);
    rough = mix(rough, .08, d); gloss += d * .9;
  } else if (k == 3) {
    // crumbs: brown bits stuck on, each a little lump
    vec3 g = floor(q * 11.);
    float h = hash3(g);
    vec2 cell = fract(q.xz * 11. + q.y * 3.) - .5;
    float bit = step(h, a * 1.25) * (1. - smoothstep(.2, .32, length(cell)));
    c = mix(base, mix(vec3(.5, .3, .13), vec3(.75, .52, .28), hash3(g + 1.)), bit);
    n = normalize(n + nRest * 0. + vec3(cell.x, 0., cell.y) * bit * .8);
    rough = mix(rough, .8, bit);
  } else if (k == 4) {
    // pepper: black and grey specks
    vec3 g = floor(q * 26.);
    float h = hash3(g);
    float bit = step(h, a * .95) * (1. - smoothstep(.22, .36, length(fract(q.xz * 26. + q.y * 5.) - .5)));
    c = mix(base, mix(vec3(.05), vec3(.35, .3, .25), hash3(g + 2.)), bit);
    rough = mix(rough, .7, bit);
  } else if (k == 6) {
    // honey: an amber glaze, glossy, thicker in runs where it's slid down, lit from within a little
    float run = noise(vec3(q.x * 3., q.y * 9., q.z * 3.)) * .6 + noise(q * 11.) * .4;
    float d = smoothstep(.05, .45, a * (.7 + .6 * run));
    c = mix(base, base * vec3(.95, .62, .2) + vec3(.3, .13, 0.), d);
    rough = mix(rough, .04, d); gloss += d * 1.1;
  } else if (k == 5) {
    // hundreds and thousands: little rods, each its own colour
    vec3 g = floor(q * 9.5);
    float h = hash3(g);
    vec2 cell = fract(q.xz * 9.5 + q.y * 2.) - .5;
    float ang = hash3(g + 3.) * 3.1416;
    vec2 e = vec2(cos(ang), sin(ang));
    float along = dot(cell, e), across = abs(dot(cell, vec2(-e.y, e.x)));
    float rod = step(h, a * 1.15) * (1. - smoothstep(.11, .15, across)) * (1. - smoothstep(.3, .36, abs(along)));
    float hue = hash3(g + 5.);
    vec3 col = hue < .2 ? vec3(1., .3, .4) : hue < .4 ? vec3(1., .85, .2) : hue < .6 ? vec3(.3, .6, 1.) : hue < .8 ? vec3(.4, .85, .4) : vec3(1., .5, .8);
    c = mix(base, col, rod);
    rough = mix(rough, .3, rod); gloss += rod * .3;
  }
  return c;
}`;
/** the window's shadow: soft as a broad window makes it (a blocker search, then a filter that wide) */
const SHADOW_GLSL = `
uniform sampler2D uShadowMap;
uniform float uShadowSoft;
const vec2 PD[12] = vec2[12](vec2(-.326, -.406), vec2(-.840, -.074), vec2(-.696, .457), vec2(-.203, .621), vec2(.962, -.195), vec2(.473, -.480),
  vec2(.519, .767), vec2(.185, -.893), vec2(.507, .064), vec2(.896, .412), vec2(-.322, -.933), vec2(-.792, -.598));
float shadow(vec3 n) {
  vec3 s = vShadow.xyz / vShadow.w * .5 + .5;
  if (s.x < 0. || s.x > 1. || s.y < 0. || s.y > 1. || s.z > 1.) return 1.;
  float bias = max(.0015 * (1. - dot(n, uKey)), .0005);
  vec2 px = 1. / vec2(textureSize(uShadowMap, 0));
  float a = hash3(vec3(gl_FragCoord.xy, 7.)) * 6.2832;
  mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
  float zb = 0., nb = 0.;
  for (int i = 0; i < 6; i++) {
    float d = texture(uShadowMap, s.xy + rot * PD[i * 2] * px * 10.).r;
    if (d < s.z - bias) { zb += d; nb += 1.; }
  }
  if (nb < .5) return 1.;
  zb /= nb;
  float w = clamp((s.z - zb) * uShadowSoft, 1.2, 12.);
  float lit = 0.;
  for (int i = 0; i < 12; i++) lit += s.z - bias > texture(uShadowMap, s.xy + rot * PD[i] * px * w).r ? 0. : 1.;
  return lit / 12.;
}`;

export const SKY_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); vUV = p * .5 + .5; gl_Position = vec4(p, .999, 1.); }`;
export const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform mat4 uInvVP;
${COMMON}
void main() {
  vec4 w = uInvVP * vec4(vUV * 2. - 1., 1., 1.);
  vec3 d = normalize(w.xyz / w.w);
#ifdef HDR
  o = vec4(env(d), 1.);
#else
  o = vec4(tonemap(env(d)) + (hash3(vec3(gl_FragCoord.xy, 0.)) - .5) / 255., 1.);
#endif
}`;
export const SHADOW_VS = `#version 300 es
in vec3 aPos;
uniform mat4 uLightVP, uModel;
void main() { gl_Position = uLightVP * uModel * vec4(aPos, 1.); }`;
export const SHADOW_FS = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(1.); }`;

export const VS = `#version 300 es
in vec3 aPos;
in vec3 aNor;
in float aMat;
in vec2 aUV;
in vec4 aBake;
in vec2 aDef;
uniform mat4 uVP, uModel, uLightVP;
uniform float uMatOver;
out vec4 vBake;
out vec2 vDef;
out vec3 vWorld;
out vec3 vNor;
out vec2 vUV;
out vec4 vShadow;
flat out float vMat;
void main() {
  vec4 w = uModel * vec4(aPos, 1.);
  vWorld = w.xyz;
  vNor = normalize(mat3(uModel) * aNor);
  vUV = aUV;
  vBake = aBake;
  vDef = aDef;
  vMat = uMatOver >= 0. ? uMatOver : aMat;
  vShadow = uLightVP * w;
  gl_Position = uVP * w;
}`;
/** the course's things: bamboo, weave, porcelain, lacquer, mango pudding, a tin, a jar, a board, gold, chopsticks, tiles */
export const FS = `#version 300 es
precision highp float;
uniform float uBakeView;
in vec4 vBake;
/** how a jelly's top is deformed here: pressed in (+) or bulged up (-), and how fast it's moving (see jelMesh) */
in vec2 vDef;
/** rings spreading on a jelly's top from where the dumpling landed on it: where (x, z), how long ago, how hard; and the
 * dumpling's colour, for the light off it into what it's pressed into */
uniform vec4 uRipple;
uniform vec3 uBodyCol;
/** the dumpling, as a ball (where, how big), for how much of the room it shuts off from what's near it */
uniform vec4 uBodyAt;
in vec3 vWorld;
in vec3 vNor;
in vec2 vUV;
in vec4 vShadow;
flat in float vMat;
out vec4 o;
uniform vec3 uEye, uTint;
uniform float uTime, uAlpha;
// (how long this level's been going (s): honey creeps by it)
uniform float uRun;
/** the dumpling, seen through what's before it: whether to (z > 0), and where it is */
uniform vec3 uHole, uHoleAt;
/** the cookbooks' atlas (books.ts) */
uniform sampler2D uBooks;
// The same scene-colour attachment is used by jelly and soap bubbles.
uniform sampler2D uScene;
uniform vec3 uRight, uUp;
uniform vec2 uRes;
uniform float uLiquidOpt;
// (honey's light: 1, from the honey's own thickness; 0, the old way, for comparing)
uniform float uHoneyNew;
// Jar fill geometry for physically thickness-dependent amber absorption.
uniform vec3 uHoneyC, uHoneyRange;
${COMMON}
${SHADOW_GLSL}
${COAT_GLSL}
/** the nearest of points scattered one to a unit cell about p: how far, and that point's own hash */
vec2 cellAt(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  float d = 9., h = 0.;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(x, y, z), c = i + g;
    float e = length(g + vec3(hash3(c), hash3(c + 17.3), hash3(c + 31.7)) - f);
    if (e < d) { d = e; h = hash3(c + 5.1); }
  }
  return vec2(d, h);
}
/** a rainbow pudding's stripe, from its foot up: each colour, then a white (its colour, how clear) */
vec4 stripe(float k) {
  if (mod(k, 2.) > .5) return vec4(.96, .93, .88, 0.);
  return k < 1. ? vec4(1., .2, .25, .35) : k < 3. ? vec4(1., .3, .03, .35) : k < 5. ? vec4(1., .7, .06, .3) : vec4(.2, .52, .06, .35);
}
void main() {
  // (whatever rises between the eye and the dumpling, anywhere on the glass, is screened: drawn at about half, a fine
  // regular screen of it there and not, so the dumpling's never lost behind a loaf and the loaf's never gone; not what
  // it stands on, nor anything lower, and coming in gently over the first few centimetres in front of it)
  if (uHole.z > 0. && vWorld.y > uHoleAt.y - .6) {
    float ahead = length(uHoleAt - uEye) - length(vWorld - uEye) - ${(3 * 1.6).toFixed(1)};
    float k = .5 * smoothstep(0., 6., ahead);
    // (a 4×4 ordered screen, Bayer's: at a half, a fine checker)
    const int BAYER[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
    ivec2 b = ivec2(gl_FragCoord.xy) & 3;
    float bayer = (float(BAYER[b.y * 4 + b.x]) + .5) / 16.;
    if (bayer < k) discard;
  }
  vec3 n = normalize(vNor);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(uEye - vWorld);
  int id = int(vMat + .5);
  vec2 uv = vUV;
  vec3 base = vec3(.6); float rough = .6, metal = 0., coat = 0., emit = 0., relief = 0., cavity = 1., alpha = 1., contact = 0., liquidDepth = 0., liquidCover = 1., honeyPath = 0.;
  // (the glaze over it, if any: how rough, and how bright the sun's caught in it)
  float coatRough = .08, coatSpec = .04;
  // (cloth: no glint, a soft sheen at a glance instead; and how small a centimetre is on the glass here, so fine
  // pattern fades out before it can shimmer)
  float fabric = 0., px = length(fwidth(vWorld));
  float fine1 = 1. - smoothstep(.08, .3, px);
  float NoV0 = max(dot(n, V), 0.);
  if (id == ${MAT.counter}) {
    // Broad maple boards: restrained grain, narrow joints, no noisy zebra striping.
    float strip = floor(vWorld.z / 9.);
    float grain = noise(vec3(vWorld.x * .045, vWorld.z * .65, strip)) * .7
      + noise(vec3(vWorld.x * .12, vWorld.z * 2.8, strip)) * .3;
    float joint = 1. - smoothstep(.018, .065, min(fract(vWorld.z / 9.), 1. - fract(vWorld.z / 9.)));
    base = mix(vec3(.57, .39, .22), vec3(.73, .56, .36), grain) * (.94 + .10 * hash3(vec3(strip, 1., 1.)));
    base *= 1. - joint * .16; relief = grain * .018 - joint * .035; rough = .54 + grain * .12;
    // (oiled: a faint sheen over it, which the chopping boards, dry, haven't)
    float fib = noise(vec3(vWorld.x * .6, vWorld.z * 9., strip + 5.)) * fine1;
    base *= .97 + .06 * fib; relief += fib * .006;
    coat = .18; coatRough = .22; coatSpec = .03;
  } else if (id == ${MAT.bamboo}) {
    float seam = 1. - smoothstep(.06, .32, abs(fract(uv.y / 7. + .5) - .5) * 7.);
    float fibre = noise(vec3(uv.x * .12, uv.y * 5., 1.));
    float fine = noise(vec3(uv.x * .45, uv.y * 15., 4.));
    base = mix(vec3(.48, .29, .12), vec3(.77, .57, .30), .4 + .5 * fibre) * (1. - .22 * seam);
    relief = fibre * .035 + fine * .009 - seam * .045; cavity = 1. - .15 * seam;
    rough = .57 + .12 * fine;
  } else if (id == ${MAT.weave}) {
    vec2 q = uv * 14., f = fract(q);
    float over = mod(floor(q.x) + floor(q.y), 2.);
    float strand = mix(f.x, f.y, over);
    float crown = sin(strand * 3.1416);
    float resolved = 1. - smoothstep(.35, 1., max(fwidth(q.x), fwidth(q.y)));
    float ridge = mix(.65, crown, resolved);
    float gap = mix(.1, 1. - smoothstep(.04, .18, min(strand, 1. - strand)), resolved);
    float rim = smoothstep(.91, .97, length(uv));
    base = mix(vec3(.65, .46, .24), vec3(.88, .73, .47), .6 + .25 * over) * (1. - .12 * gap);
    base *= mix(1., .88, rim); relief = .075 * ridge * (1. - rim);
    cavity = 1. - .25 * gap; rough = .72;
  } else if (id == ${MAT.porcelain}) {
    // a plate: white glaze, a blue band and a ring of little leaves at its rim
    float r = length(uv);
    float band = smoothstep(.78, .8, r) * (1. - smoothstep(.86, .88, r));
    float leaf = smoothstep(.55, .75, sin(atan(uv.y, uv.x) * 18.)) * smoothstep(.66, .69, r) * (1. - smoothstep(.74, .76, r));
    // (the body under its glaze, satin, a few iron specks fired into it, fixed to it; the glaze over it clear and hard,
    // pooled a little thicker at the rim and where the band's painted, a cool tint where it's thick)
    float speck = smoothstep(.93, .96, noise(vWorld * 2.3 + 17.));
    base = mix(vec3(.94, .94, .92), vec3(.12, .25, .58), max(band, leaf * .8));
    base = mix(base, vec3(.45, .38, .32), speck * .6);
    float pool = smoothstep(.84, .97, r) + band * .5;
    base *= mix(vec3(1.), vec3(.9, .95, .97), pool * .5);
    rough = .42; coat = 1.; coatRough = mix(.03, .05, pool); coatSpec = .32;
    relief = noise(vec3(uv * 22., 3.)) * .006;
  } else if (id == ${MAT.lacquer}) {
    // a lazy Susan: red lacquer, a gold ring and fine gold rays
    float r = length(uv), an = atan(uv.y, uv.x);
    float ring = smoothstep(.83, .85, r) * (1. - smoothstep(.88, .9, r)) + smoothstep(.3, .31, r) * (1. - smoothstep(.33, .34, r));
    float rays = smoothstep(.97, .99, cos(an * 12. + uTime * 0.)) * step(.35, r) * step(r, .8);
    base = mix(vec3(.5, .05, .04), vec3(.95, .72, .32), clamp(ring + rays * .7, 0., 1.));
    metal = (ring + rays) * .7; rough = .2; coat = 1.;
  } else if (id == ${MAT.jelly} || id == ${MAT.pannacotta} || id == ${MAT.konjac}) {
    // a pudding set in its mould: its layers, poured one on another and set, each its colour and how clear it is
    // (a cream, opaque; a jelly, clear, seen into), met crisply or blended where they met, a little wavy; what's set
    // in the clear ones (fruit, a few bubbles); and what's on its top (caramel, a coulis run over its edge, a sauce
    // pooled, piped hearts). Which recipe: in its material's fraction; how far up it this is: on its side, its v
    // (2 + how far up); its top is the top layer
    bool side = vUV.y > 1.5, top = !side;
    float t = side ? vUV.y - 2. : 1., ang = side ? vUV.x * 6.2832 : atan(vUV.y, vUV.x), r = top ? length(vUV) : 1.;
    int rec = int(fract(vMat) * 100. + .5);
    float wav = side ? .02 * sin(ang * 3. + float(rec) * 1.7) + .012 * sin(ang * 7. + 2.) : 0.;
    float rim = pow(1. - NoV0, 1.6);
    #define LAY(a, b, at, w) mix(a, b, smoothstep((at) + wav - (w), (at) + wav + (w), t))
    vec4 L = vec4(.95, .9, .8, 0.);
    vec4 cream = vec4(.94, .88, .74, 0.), mango = vec4(.92, .32, .02, .3);
    // (in light, as the drawing works in: a deep red's very little green or blue)
    if (rec == 0) L = vec4(mix(vec3(.7, .14, .01), mango.rgb, smoothstep(0., .75, t)), .3);
    else if (rec == 1) L = LAY(LAY(vec4(.1, .0, .025, .85), cream, .3, .012), vec4(1., .2, .3, .8), .62, .012);
    else if (rec == 2) { vec4 s = vec4(.8, .03, .06, .8); L = LAY(LAY(s, vec4(.96, .9, .84, 0.), .28, .012), s, .52, .012); }
    else if (rec == 3) L = LAY(vec4(.94, .86, .66, 0.), vec4(.6, .01, .04, .85), .42, .02);
    else if (rec == 4) {
      // (blackcurrant mousse under white chocolate, run into each other: a lilac line where they met)
      L = LAY(vec4(.16, .03, .16, 0.), cream, .5, .06);
      L.rgb = mix(L.rgb, vec3(.4, .25, .55), .45 * (1. - smoothstep(0., .1, abs(t - .5 - wav))));
    }
    else if (rec == 5) L = vec4(mix(vec3(.25, .0, .01), vec3(.62, .01, .02), smoothstep(0., .8, t)), .9);
    else if (rec == 6) {
      // (rainbow: thin stripes, each colour on a white)
      float tt = clamp(t - wav, 0., .999) * 8., k = floor(tt);
      L = mix(stripe(k), stripe(min(k + 1., 7.)), smoothstep(.88, 1., fract(tt)));
    }
    else if (rec == 7) L = vec4(mix(vec3(.65, .04, .1), vec3(1., .25, .32), smoothstep(0., 1., t * .8 + n.y * .2)), .8);
    else if (rec == 8) L = LAY(vec4(.94, .9, .82, 0.), mango, .38, .02);
    else if (rec == 9) L = vec4(mix(vec3(.86, .77, .58), vec3(.92, .84, .66), t), 0.);
    else if (rec == 10) L = LAY(vec4(.9, .84, .8, .3), vec4(1., .25, .32, .8), .45, .02);
    #undef LAY
    // (a clear one deeper low down, where it settled)
    L.rgb *= mix(1., .8 + .2 * t, L.a);
    // vanilla seeds in a cream
    if (rec == 3 || rec == 9) L.rgb = mix(L.rgb, vec3(.06, .03, .015), smoothstep(.9, .94, noise(vWorld * 6. + 3.)) * .6 * (1. - L.a));
    // fruit set in the clear: whole raspberries, a strawberry's pieces, a little dimmed by the jelly over them
    if ((rec == 3 || rec == 2) && L.a > .5) {
      vec2 cl = cellAt(vWorld * .36 + float(rec) * 3.1);
      float fr = (1. - smoothstep(.3, .36, cl.x)) * step(cl.y, .65) * smoothstep(.5, .7, L.a);
      // (a raspberry's drupelets; a strawberry's pale heart)
      vec2 dp = cellAt(vWorld * 3.2);
      vec3 fruit = rec == 3 ? mix(vec3(.08, .0, .01), vec3(.42, .0, .03), 1. - smoothstep(.2, .6, dp.x)) : mix(vec3(.75, .03, .03), vec3(1., .3, .22), .6 * (1. - smoothstep(.05, .3, cl.x + .08 * noise(vWorld * 4.))));
      L.rgb = mix(L.rgb, fruit, fr * .85); L.a = mix(L.a, .2, fr);
    }
    // bubbles held in the clear (in a raspberry jelly, more near its top)
    float bub = 0.;
    if (L.a > .5) {
      vec2 bq = cellAt(vWorld * 1.3 + 11.);
      bub = step(bq.y, .28) * (smoothstep(.06, .1, bq.x) - smoothstep(.11, .14, bq.x)) * (rec == 3 ? smoothstep(.5, .9, t) : .5);
    }
    // on top: caramel, or a coulis, run over the edge in tongues; a sauce pooled in the middle; piped hearts round it
    float deco = 0.; vec3 dcol = vec3(0.);
    float edge = .93 - .12 * pow(max(0., sin(ang * 7. + float(rec))), 6.);
    float over = top ? 1. : smoothstep(edge - .008, edge + .008, t);
    if (rec == 0) { deco = over; dcol = vec3(.22, .05, .005); }
    else if (rec == 9) { deco = over; dcol = vec3(.4, .0, .02); }
    else if (rec == 4 && top) { float e = .5 + .05 * sin(ang * 5.) + .03 * sin(ang * 11.); deco = 1. - smoothstep(e - .02, e, r); dcol = vec3(.05, .004, .035); }
    else if (rec == 6 && top) {
      float sl = 6.2832 / 6., k = floor(ang / sl + .5), ca = k * sl;
      vec2 p = mat2(cos(ca), -sin(ca), sin(ca), cos(ca)) * vUV - vec2(.6, 0.);
      vec2 q = vec2(p.y, p.x) / .13;
      float h = dot(q, q) - 1.; h = h * h * h - q.x * q.x * q.y * q.y * q.y;
      vec2 q0 = vUV.yx * vec2(1., -1.) / .17;
      float h0 = dot(q0, q0) - 1.; h0 = h0 * h0 * h0 - q0.x * q0.x * q0.y * q0.y * q0.y;
      float hw = fwidth(h) + 1e-4, hw0 = fwidth(h0) + 1e-4;
      deco = max(1. - smoothstep(-hw, hw, h), 1. - smoothstep(-hw0, hw0, h0)); dcol = vec3(1., .28, .45);
      relief = .03 * deco;
    }
    base = mix(L.rgb, min(L.rgb * 1.08 + .03, vec3(1.)), rim) + bub * .35;
    float clear2 = L.a * L.a;
    rough = mix(.3, .07, L.a); coat = mix(.45, .9, L.a);
    emit = mix(.2 + .45 * rim, .25 + .6 * rim, L.a) + bub * .8;
    alpha = mix(1., mix(.72, .95, pow(1. - NoV0, 1.4)), clear2);
    // as it's deformed (from its top as the simulation has it, so it comes and goes with it): pressed in, shut in by the
    // dumpling in it, the gloss spread wider and duller there; bulged up round it, thicker, a clear layer's colour denser;
    // moving, a little sheen; and rings spreading from where it came down, fading
    float dent = smoothstep(.05, .8, vDef.x), bulge = smoothstep(.02, .5, -vDef.x), moving = smoothstep(.1, .8, abs(vDef.y));
    contact = .75 * dent;
    rough = mix(rough, rough + .16, dent);
    base *= mix(vec3(1.), vec3(.82, .78, .8), bulge * L.a);
    emit += .2 * moving * rim * L.a;
    if (top && uRipple.w > 0. && uRipple.z >= 0.) {
      vec2 dp = vWorld.xz - uRipple.xy;
      float rr = length(dp), age = uRipple.z, front = age * 26., ph = rr - front;
      float amp = uRipple.w * exp(-age * 2.4) * exp(-ph * ph / 14.) * smoothstep(0., 1.5, rr);
      n = normalize(n + vec3(dp / max(rr, 1e-3), 0.).xzy * amp * .35 * cos(ph * 2.2));
    }
    if (deco > 0.) {
      base = mix(base, mix(dcol, dcol * 1.4 + .05, rim * .6), deco); rough = mix(rough, rec == 6 ? .4 : .12, deco); coat = mix(coat, rec == 6 ? .2 : 1., deco);
      emit = mix(emit, (rec == 6 ? .15 : .06) + .25 * rim, deco); alpha = mix(alpha, 1., deco);
    }
  } else if (id == ${MAT.berry}) {
    // what's set on a pudding's top: a raspberry, its drupelets; a strawberry, glossy, its seeds sunk in it, its
    // hull green; a blackcurrant, near black, glossy, a bloom on it
    int kind = int(fract(vMat) * 100. + .5);
    if (kind == 0) {
      vec2 d = cellAt(vWorld * 3.2);
      float bump = 1. - smoothstep(.2, .6, d.x);
      base = mix(vec3(.1, .0, .015), vec3(.6, .015, .07), bump) * (.85 + .3 * d.y);
      relief = bump * .05; rough = .32; coat = .5; emit = .18 * bump;
    } else if (kind == 1) {
      vec2 d = cellAt(vWorld * 2.6 + 4.);
      float seed = 1. - smoothstep(.1, .16, d.x), pit = 1. - smoothstep(.12, .3, d.x);
      base = mix(vec3(.7, .01, .02), vec3(.9, .6, .12), seed) * (1. - .25 * pit * (1. - seed));
      relief = -pit * .03 + seed * .02; rough = .25; coat = .8; emit = .12;
      float hull = smoothstep(.72, .82, n.y + .08 * noise(vWorld * 4.));
      base = mix(base, vec3(.05, .2, .02), hull); rough = mix(rough, .5, hull);
    } else {
      base = vec3(.02, .008, .03) * (.9 + .2 * noise(vWorld * 5.));
      rough = mix(.12, .45, smoothstep(.4, .7, noise(vWorld * 3. + 2.))); coat = .9; coatRough = .05;
    }
  } else if (id == ${MAT.cabinet}) {
    // the cupboards: painted wood, a soft sage, satin, the brush's grain faint in it, up the doors
    float br = noise(vec3(vWorld.x * .08, vWorld.y * 1.6, vWorld.z * .08)) * fine1;
    base = vec3(.36, .5, .38) * (.95 + .08 * br);
    relief = br * .006; rough = .45; coat = .25; coatRough = .2; coatSpec = .03;
  } else if (id == ${MAT.fridge}) {
    // a fridge, a range, a microwave: cream enamel, glossy, a little warm
    base = vec3(.86, .78, .6); rough = .3; coat = .8; coatRough = .06; coatSpec = .2;
  } else if (id == ${MAT.floor}) {
    // the floor: cream and sage checks, glazed, the grout between them
    vec2 q = uv / 30.;
    float ch = mod(floor(q.x) + floor(q.y), 2.);
    vec2 f = abs(fract(q) - .5);
    float grout = smoothstep(.47, .49, max(f.x, f.y)) * fine1;
    base = mix(vec3(.86, .8, .66), vec3(.42, .55, .44), ch) * (1. - .25 * grout);
    relief = -grout * .02; rough = .35; coat = .35; coatRough = .1; coatSpec = .04;
  } else if (id == ${MAT.plant}) {
    // herbs: leafy green, lighter at their tips
    base = mix(vec3(.08, .22, .05), vec3(.2, .42, .1), noise(vWorld * 2.)); rough = .6; emit = .1;
  } else if (id == ${MAT.terracotta}) {
    base = vec3(.55, .22, .1) * (.9 + .2 * noise(vWorld * 3.)); rough = .85;
  } else if (id == ${MAT.bread}) {
    // bread, baked: its crust golden, deepest on its crown where the heat was, paler down its side and at its foot,
    // finely crackled; and by which bread (its material's fraction): a boule, cross-cut, floured in the rings of the
    // basket it proved in; a bloomer, slashed across; a baguette, its scores overlapping down its length, their edges
    // risen and dark; a ciabatta, flat, pale, blistered, heavy with flour; a roll, glossy with egg, sesame on it. Its
    // top's (u, v): along it and across it, of its length; its side's v, 2 + how far up
    int kind = int(fract(vMat) * 100. + .5);
    bool side = vUV.y > 1.5, top = !side && n.y > .2;
    float asp = kind == 1 || kind == 3 ? .55 : kind == 2 ? .21 : 1.;
    vec2 pn = vec2(uv.x, uv.y / asp);
    float q = kind == 3 ? pow(pow(abs(pn.x), 4.) + pow(abs(pn.y), 4.), .25) : length(pn);
    vec3 deep = vec3(.3, .11, .03), gold = vec3(.58, .29, .08), pale = vec3(.78, .52, .24), crumb = vec3(.9, .78, .54), flourC = vec3(.9, .88, .84);
    if (kind == 3) { gold = vec3(.72, .48, .22); deep = vec3(.5, .27, .09); }
    float crackle = noise(vWorld * 7.) * .6 + noise(vWorld * 19.) * .4;
    float bake = side ? .25 * smoothstep(.2, 1., vUV.y - 2.) : .35 + .4 * (1. - q * q) + .15 * noise(vWorld * 1.2);
    vec3 col = side ? mix(pale, gold, smoothstep(0., .8, vUV.y - 2.)) : mix(gold, deep, bake);
    col *= .93 + .14 * crackle;
    float flour = 0., cut = 0., ear = 0.;
    // (blisters: little dark bubbles of crust)
    vec2 bl = cellAt(vWorld * 1.1 + 3.);
    float blister = (1. - smoothstep(.08, .16, bl.x)) * step(bl.y, kind == 3 || kind == 2 ? .45 : .15);
    col = mix(col, deep * .7, blister * .6);
    if (top) {
      if (kind == 0) {
        // (cross-cut: the cuts opened out, crumb in them, their edges risen; floured in the basket's rings)
        float d = min(abs(pn.x), abs(pn.y)), w = .07 * (1. - smoothstep(.35, .75, q));
        cut = (1. - smoothstep(w * .5, w, d)) * step(q, .78);
        ear = (smoothstep(w, w * 1.6, d) - smoothstep(w * 1.6, w * 2.6, d)) * step(q, .78);
        flour = smoothstep(.7, .98, .5 + .5 * sin(q * 40. + noise(vWorld * 1.5) * 1.5)) * .2 * (.5 + .5 * smoothstep(.2, .7, noise(vWorld * .4 + 1.))) * (1. - smoothstep(.7, .95, q));
      } else if (kind == 1) {
        // (slashed across, a little slanted)
        float g = pn.x * 3.1 + pn.y * .45, f = abs(fract(g + .5) - .5);
        float on = step(abs(pn.x), .8), w = .085 * sqrt(max(0., 1. - abs(pn.y) / .8));
        cut = (1. - smoothstep(w * .45, w, f)) * on; ear = (smoothstep(w, w + .03, f) - smoothstep(w + .03, w + .08, f)) * on * step(.01, w);
      } else if (kind == 2) {
        // (five scores, each a slanting stroke down its length, overlapping the next, opened most in their middles)
        for (int i = 0; i < 5; i++) {
          float ui = -.6 + float(i) * .3;
          vec2 a = vec2(ui - .17, -.38 * asp), b = vec2(ui + .17, .38 * asp), pa = uv - a, ba = b - a;
          float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.), d = length(pa - ba * h), w = .028 * (1. - 4. * (h - .5) * (h - .5)) + .004;
          cut = max(cut, 1. - smoothstep(w * .6, w, d));
          ear = max(ear, (smoothstep(w, w * 1.5, d) - smoothstep(w * 1.5, w * 2.6, d)) * step(.05, h) * step(h, .95));
        }
      } else if (kind == 3) {
        // (flat, dimpled, heavy with flour from the couche, thinner where it rose)
        flour = smoothstep(.15, .95, noise(vWorld * .35 + 7.)) * .5 + .15 * smoothstep(.45, .8, noise(vWorld * 5.));
        relief += (noise(vWorld * .7) - .5) * .05;
      } else if (kind == 4) {
        // (glazed; sesame scattered over it, each a little pale oval)
        vec2 se = cellAt(vWorld * vec3(2.2, 1.6, 2.2));
        float seed = (1. - smoothstep(.12, .2, se.x)) * step(se.y, .55) * smoothstep(.3, .6, n.y);
        col = mix(col, vec3(.86, .72, .45), seed);
        relief += seed * .02;
      }
    } else if (side && kind == 3) flour = smoothstep(.5, .85, noise(vWorld * .8 + 2.)) * .3;
    col = mix(col, deep * .8, ear * .6);
    // (in a cut, the crust that opened as it rose: thin, pale gold)
    col = mix(col, mix(vec3(.62, .38, .13), vec3(.75, .52, .24), noise(vWorld * 6.)), cut);
    col = mix(col, flourC, clamp(flour, 0., 1.));
    base = col;
    relief += crackle * .015 - cut * .06 + ear * .03;
    rough = mix(kind == 4 ? .32 : .6, .9, max(flour, cut));
    if (kind == 4) { coat = .45 * (1. - flour); coatRough = .2; coatSpec = .05; }
  } else if (id == ${MAT.enamel}) {
    // a bread bin: cream enamel, a navy rim, chipped here and there
    // (enamel: glass fired onto steel, so it's glossier than porcelain and its colour flat and even; chipped only
    // now and then, and there the steel shows)
    float chip = smoothstep(.955, .965, noise(vWorld * 1.7 + 9.));
    base = vec3(.93, .9, .82);
    rough = .3; coat = 1. - chip; coatRough = .05; coatSpec = .26;
    if (chip > .5) { base = vec3(.45, .46, .48); metal = .9; rough = .35; }
  } else if (id == ${MAT.steel}) {
    // brushed stainless steel: fine lines along it, a cool grey
    float brush = noise(vec3(vWorld.x * .25, vWorld.z * 40., vWorld.y * 40.)) * .5 + noise(vec3(vWorld.x * 2., vWorld.z * 90., 3.)) * .2;
    base = vec3(.58, .6, .62) * (.88 + .2 * brush * fine1); metal = .95; rough = .22 + .08 * brush;
  } else if (id == ${MAT.sponge}) {
    // a sponge: yellow and full of holes, a green scourer on its top
    bool top = n.y > .6;
    float pore = smoothstep(.55, .62, noise(vWorld * 2.6));
    base = top ? vec3(.16, .42, .2) * (.8 + .3 * noise(vWorld * 5.)) : vec3(.96, .8, .26) * (1. - .45 * pore);
    rough = 1.;
  } else if (id == ${MAT.water}) {
    // the water in the sink: grey-blue, a little cloudy with soap
    base = vec3(.16, .23, .27) * (.9 + .2 * noise(vec3(vWorld.xz * .2, uTime * .3))); rough = .04; coat = 1.;
  } else if (id == ${MAT.tin}) {
    // Printed tea tins: repeating cream blossoms and restrained gold rules; each tin in one of four
    // colourways (carried in its v as thousands): red and teal, navy and cream, mustard and black, sage and white
    float way = floor((uv.y + 500.) / 1000.);
    uv.y -= way * 1000.;
    float b = fract(uv.y / 9.);
    vec3 pa = way < .5 ? vec3(.48, .095, .075) : way < 1.5 ? vec3(.09, .14, .32) : way < 2.5 ? vec3(.78, .56, .16) : vec3(.42, .52, .4);
    vec3 pb = way < .5 ? vec3(.055, .27, .245) : way < 1.5 ? vec3(.86, .8, .66) : way < 2.5 ? vec3(.09, .08, .07) : vec3(.9, .9, .85);
    vec3 paint = b < .45 ? pa : pb;
    float line = 1. - smoothstep(.009, .019, min(abs(b - .45), min(b, 1. - b)));
    vec2 flower = fract(uv / vec2(5.2, 4.5)) - .5;
    float angle = atan(flower.y, flower.x), radius = length(flower);
    float petals = 1. - smoothstep(.012, .03, radius - (.16 + .055 * cos(angle * 5.)));
    float heart = 1. - smoothstep(.035, .055, radius);
    base = mix(paint, vec3(.87, .77, .55), petals * .85);
    base = mix(base, vec3(.78, .53, .19), max(line, heart));
    metal = max(line, heart) * .75; rough = .31; coat = .32;
  } else if (id == ${MAT.jar}) {
    // a glazed jar: celadon, a fine crackle, the glaze pooled darker toward the foot
    float crack = smoothstep(.47, .5, abs(noise(vec3(uv * .9, 2.)) - .5));
    base = mix(vec3(.6, .68, .58), vec3(.4, .5, .42), smoothstep(10., 0., uv.y)) * (1. - .25 * crack);
    rough = .2; coat = 1.;
  } else if (id == ${MAT.board}) {
    // a chopping board (and a jar's cork): pale wood, grain along, cuts across it
    // (its grain: the growth along it, broad; finer fibre over that, fading out far off)
    float g = noise(vec3(uv.x * .1, uv.y * 2.4, 4.)) * .6 + noise(vec3(uv.x * .5, uv.y * 7., 1.)) * .25 * fine1 + .125 * (1. - fine1);
    float cut = smoothstep(.985, 1., noise(vec3(uv.x * 9., uv.y * .4, 7.))) * fine1;
    base = mix(vec3(.72, .55, .36), vec3(.88, .74, .54), g) * (1. - .25 * cut);
    relief = g * .025 - cut * .018; rough = .64;
  } else if (id == ${MAT.book} && uv.y >= 100.) {
    // a cookbook from the catalogue (books.ts): which, and which face, on v; its cloth (its cell's corner), its cover
    // and its spine lettered on the atlas; at its other sides, the pages' cream edges between its boards
    float tv = uv.y - 100., cd = floor(tv / 4.), lv = tv - cd * 4. - 1., slot = floor(cd / 4.), fc = cd - slot * 4.;
    vec2 cell = vec2(mod(slot, ${BOOK_COLS}.), floor(slot / ${BOOK_COLS}.));
    vec3 cloth = texelFetch(uBooks, ivec2(cell * ${BOOK_CELL}.) + ivec2(3), 0).rgb;
    base = cloth * (.95 + .08 * noise(vWorld * 3.)); rough = .75;
    if (fc < 1.5) {
      vec2 q = fc < .5 ? vec2(uv.x, lv * .75) : vec2(uv.x, .75 + lv * .25);
      bool inside = uv.x >= 0. && uv.x <= 1. && lv >= 0. && lv <= 1.;
      if (inside) base = texture(uBooks, (cell + q) / vec2(${BOOK_COLS}., ${BOOK_ROWS}.)).rgb * (.95 + .08 * noise(vWorld * 3.));
    } else if (fc < 2.5) {
      float T = uv.x / max(lv, .02);
      bool boards = uv.x < .38 || T - uv.x < .38;
      base = boards ? cloth : vec3(.93, .89, .8) * (.94 + .06 * sin(uv.x * 60.));
      rough = boards ? .75 : .9;
    }
  } else if (id == ${MAT.book}) {
    // cookbooks, stacked: each its own cloth colour (by which book of the stack it is), a title band on the
    // cover; at the sides, the pages' cream edges between the boards, finely lined
    float bk = floor(vWorld.y / 4.6);
    float pick = hash3(vec3(bk, 3., 7.));
    vec3 cloth = pick < .25 ? vec3(.5, .1, .09) : pick < .5 ? vec3(.12, .2, .36) : pick < .75 ? vec3(.2, .34, .22) : vec3(.72, .52, .2);
    cloth *= .92 + .1 * noise(vWorld * 3.);
    if (abs(n.y) > .5) {
      base = cloth;
      float band = smoothstep(.6, .5, abs(fract(uv.x * .08 + bk * .37) - .5) * 2.) * step(abs(uv.y), 2.5);
      base = mix(base, vec3(.85, .72, .4), band * .0);
      rough = .75;
    } else {
      float f = fract(vWorld.y / 4.6) * 4.6;
      bool boards = f < .38 || f > 4.22;
      base = boards ? cloth : vec3(.93, .89, .8) * (.94 + .06 * sin(vWorld.y * 60.));
      rough = boards ? .75 : .9;
    }
  } else if (id == ${MAT.napkin}) {
    // home's serviette: white paper, quilted in a diamond, folded in four (its creases across), a red
    // printed border near its edge and a red peach in one corner; its edges (uv 2) plain paper
    bool edge = uv.x > 1.5;
    vec2 q = edge ? vec2(0.) : uv;
    float quilt = abs(fract((q.x + q.y) * 7.) - .5) + abs(fract((q.x - q.y) * 7.) - .5);
    float crease = edge ? 0. : (1. - smoothstep(0., .025, abs(q.x))) + (1. - smoothstep(0., .025, abs(q.y)));
    float m = max(abs(q.x), abs(q.y));
    float border = edge ? 0. : smoothstep(.015, 0., abs(m - .82)) + smoothstep(.01, 0., abs(m - .76)) * .7;
    vec2 pc = q - vec2(.58, .58);
    float peach = edge ? 0. : 1. - smoothstep(.07, .085, length(pc * vec2(1., 1.15) + vec2(0., abs(pc.x) * .6)));
    base = vec3(.97, .96, .93) * (.97 + .03 * quilt) * (1. - .08 * crease);
    base = mix(base, vec3(.78, .14, .12), clamp(border + peach, 0., 1.));
    relief = quilt * .015; rough = .85;
  } else if (id == ${MAT.gold}) {
    base = vec3(.96, .74, .34); metal = 1.; rough = .24;
  } else if (id == ${MAT.chopstick}) {
    // chopsticks: pale bamboo, its grain along it; red lacquer on the back third, a gold band where it starts
    float g = noise(vec3(uv.x * 40., uv.y * 3., 2.)) * .5 + noise(vec3(uv.x * 4., uv.y * 9., 5.)) * .3;
    float lac = smoothstep(.66, .665, uv.x), band = smoothstep(.012, 0., abs(uv.x - .655));
    base = mix(mix(vec3(.74, .58, .38), vec3(.86, .72, .5), g), vec3(.55, .07, .05), lac);
    base = mix(base, vec3(.95, .72, .32), band);
    metal = band; rough = mix(.55, .2, lac); coat = lac * .8;
  } else if (id == ${MAT.tiles}) {
    // subway tiles, laid in a brick bond: a warm white glaze, each a shade its own, pale grout; and the
    // room's light bounced back off the counter onto them, so a wall's a pale, quiet field, not a dark grid
    vec2 sz = vec2(15., 7.5);
    float row = floor(uv.y / sz.y);
    vec2 q = vec2(uv.x / sz.x + .5 * mod(row, 2.), uv.y / sz.y), f = fract(q);
    vec2 e2 = min(f, 1. - f) * sz;
    float edge = min(e2.x, e2.y);
    float soft = .08 + length(vWorld - uEye) * .0016;
    float tile = smoothstep(.12, .12 + soft, edge);
    float bevel = smoothstep(.12, .7, edge);
    base = mix(vec3(.76, .73, .67), vec3(.93, .91, .86) * (.96 + .05 * hash3(vec3(floor(q), 2.))), tile);
    relief = bevel * .05; rough = mix(.9, .22, tile); coat = tile * .5;
    emit = .22;
  } else if (id == ${MAT.butter}) {
    // butter: pale yellow, a little waxy, a knife's cut across it and a fold of its paper's mark
    float cut = smoothstep(.975, 1., noise(vec3(uv.x * .6, uv.y * 7., 9.)));
    base = vec3(.98, .86, .46) * (1. - .12 * cut) * (.96 + .06 * noise(vec3(uv * 1.5, 3.)));
    rough = .32; coat = .6;
  } else if (id == ${MAT.honey}) {
    // honey: deep amber, lit from within; run down a jar's side in drips that thin toward their ends
    float drip = noise(vec3(uv.x * .9, 1., 5.)) * .7 + noise(vec3(uv.x * 3.2, 2., 8.)) * .3;
    float thin = smoothstep(-5., 4., uv.y) * .35 + smoothstep(.5, .9, drip) * .4;
    // (deep, so it's amber still in the sun: bright and saturated, the tonemap would take it to cream)
    base = mix(vec3(.34, .11, .004), vec3(.6, .27, .012), thin);
    // (its own gloss, no clear coat over it: on a thin run or a bead, mostly seen at a slant, a clear coat goes white)
    rough = .22; coat = 0.; emit = .1 + .08 * thin;
  } else if (id == ${MAT.honeyDrip} && uHoneyNew > .5) {
    // honey as one surface over a rim (honeyfield.ts): how far the light goes through it here is how thick it is
    // (carried on the surface) over how squarely it's seen; none of its own colour, that's all in what comes
    // through it. Nothing where there's no honey. (A tube from honey.ts: as thick as it is wide, about)
    bool field = uv.y < -.5;
    if (field && uv.x < .02) discard;
    honeyPath = field ? min(uv.x * 1.6 / max(NoV0, .3), 4.) : 2. * NoV0;
    liquidDepth = clamp(honeyPath / 3., 0., 1.);
    base = vec3(.02, .012, .004); rough = .02; coat = 1.; coatRough = .012; coatSpec = .5;
  } else if (id == ${MAT.honeyDrip}) {
    // honey as shapes (a collar over a rim, its drips, drops): thick through its middle, so deep there; thin at its
    // edges, pale and bright; very glossy, the sun a pinpoint in it
    liquidDepth = clamp(NoV0 * 1.15, 0., 1.);
    // (deep orange through its thick middle, a lighter gold at its thin edges)
    base = mix(vec3(1., .55, .08), vec3(.8, .28, .01), liquidDepth);
    rough = .04; coat = 1.; coatRough = .018; coatSpec = .7; emit = .18 + .3 * (1. - liquidDepth);
  } else if (id == ${MAT.honeyRun} || id == ${MAT.honeyPool}) {
    // honey run down a jar's front and pooled round its foot: over the rim in a ragged collar, and from it runs, each
    // its own width and pace, creeping down as the level goes on, thinning as they go, a bead swelling at each end
    // until it's reached the foot; and the pool there spreading, most where the runs come down. Distances in cm.
    float d;
    if (id == ${MAT.honeyRun}) {
      float s = uv.x, y = uv.y, H = ${15 + JAR_UNDER}.;
      d = 1.2 + 1.1 * noise(vec3(s * .55, 0., 21.)) - y;
      float j0 = floor(s / 1.45);
      for (int k = -1; k <= 1; k++) {
        float c = j0 + float(k);
        float h1 = hash3(vec3(c, 1., 7.)), h2 = hash3(vec3(c, 2., 7.)), h3 = hash3(vec3(c, 3., 7.)), h4 = hash3(vec3(c, 4., 7.));
        if (h3 < .2) continue;
        float w = .2 + .24 * h2, tau = 60. + 170. * h4, L0 = 2.5 + 9. * h1 * h3;
        // (some go all the way, most stall somewhere on the way down as they cool and thicken)
        float h5 = hash3(vec3(c, 5., 7.)), reach = h5 < .35 ? H * 1.15 : L0 + (H * .95 - L0) * h5 * h5;
        float L = min(H + 1., L0 + (reach - L0) * (1. - exp(-uRun / tau)));
        float cx = (c + .5) * 1.45 + (h1 - .5) * .5 + .12 * sin(y * .35 + c * 2.3);
        float bead = L < H ? w * (1.35 + .35 * smoothstep(.3, 1., L / H)) : 0.;
        float stem = min(w * (1. - .4 * clamp(y / H, 0., 1.)) - abs(s - cx), (L - bead - y) * 4.);
        float ball = bead - length(vec2(s - cx, y - (L - bead)));
        float drip = max(stem, ball) + .12 * exp(-4. * abs(stem - ball));
        d = max(d, drip) + .1 * exp(-5. * abs(d - drip));
      }
    } else {
      // (the ring round the foot: u out from the glass, v the angle from the jar's front)
      float g = 1. - .75 * exp(-uRun / 120.), front = smoothstep(1.1, .1, abs(uv.y));
      d = .25 + 1.15 * g * (.25 + .75 * front) + .45 * (noise(vec3(vWorld.xz * .55, 31.)) - .5) - uv.x;
    }
    if (d < 0.) discard;
    liquidCover = smoothstep(0., max(.08, fwidth(d) * 1.3), d);
    liquidDepth = clamp(d / (id == ${MAT.honeyRun} ? .3 : .45), 0., 1.);
    liquid(liquidDepth, .13, vWorld, vec3(1., .68, .17), vec3(.7, .3, .03), .2, n, base, rough, coat, coatRough, coatSpec, emit);
    coatSpec = .6;
  } else if (id == ${MAT.glass}) {
    base = vec3(.9, .95, .93); rough = .04; coat = 1.;
  } else if (id == ${MAT.pot}) {
    // enamelware: white, flecked dark blue, a navy rim
    float fleck = step(.9, noise(vec3(uv * 2.6, 4.))) * .8 + step(.955, noise(vec3(uv * 7., 6.))) * .6;
    base = mix(vec3(.94, .92, .87), vec3(.1, .16, .4), clamp(fleck, 0., 1.));
    rough = .22; coat = 1.;
  } else if (id == ${MAT.pan}) {
    // cast iron, seasoned: near black, brushed in rings on its face
    float ring = n.y > .8 ? .96 + .04 * sin(length(uv) * 70.) : 1.;
    base = vec3(.11, .105, .1) * ring * (.85 + .3 * noise(vec3(uv * 4., 2.)));
    rough = .42; metal = .35;
  } else if (id == ${MAT.hob}) {
    // the hob: brushed steel, its grain along x, a faint bloom of old heat here and there
    float brush = noise(vec3(vWorld.x * .02, vWorld.z * 1.4, 7.)) * .5 + noise(vec3(vWorld.x * .4, vWorld.z * 9., 3.)) * .25;
    float bloom = smoothstep(.55, .8, noise(vec3(vWorld.xz * .012, 11.)));
    base = mix(vec3(.42, .43, .45), vec3(.4, .33, .28), bloom * .5) * (.85 + .3 * brush);
    rough = .45; metal = .8;
  } else if (id == ${MAT.burner}) {
    // a burner's grate, cast iron, rings and spokes; the gas flame under it, blue at its roots, glowing on the iron
    float r = length(uv), an = atan(uv.y, uv.x);
    float rings = smoothstep(.05, .02, abs(r - .32)) + smoothstep(.05, .02, abs(r - .62)) + smoothstep(.05, .02, abs(r - .93));
    float spokes = smoothstep(.1, .04, abs(sin(an * 3.))) * step(.3, r) * step(r, .95);
    float grate = clamp(rings + spokes, 0., 1.);
    float flick = .8 + .2 * sin(uTime * 23. + an * 4.) * sin(uTime * 17. + r * 30.);
    vec3 flame = mix(vec3(.2, .4, 1.), vec3(1., .55, .15), smoothstep(.1, .4, r)) * (1. - smoothstep(.15, .45, r)) * flick;
    base = mix(vec3(.5, .52, .54), vec3(.09, .08, .08), grate);
    rough = mix(.38, .7, grate); metal = mix(.85, .2, grate);
    emit = 0.; base += flame * (1. - grate) * 1.4;
  } else if (id == ${MAT.knob}) {
    base = vec3(.06, .06, .065); rough = .18; coat = 1.;
  } else if (id == ${MAT.honeypot}) {
    // a honey pot's glaze: cream stoneware, flecked with iron where the clay comes through, glossy, a little
    // uneven as a hand-thrown pot is
    float fleck = step(.955, noise(vWorld * 6.5)) * .7 + step(.975, noise(vWorld * 13. + 3.)) * .5;
    base = mix(vec3(.94, .88, .75), vec3(.5, .34, .2), fleck * .8) * (.95 + .07 * noise(vWorld * .4));
    rough = .28; coat = .9; coatRough = .06; coatSpec = .3; relief = noise(vWorld * .9) * .02;
  } else if (id == ${MAT.cork}) {
    // cork: warm brown, pitted all over, matte
    float pit = smoothstep(.66, .8, noise(vWorld * 2.6) * .6 + noise(vWorld * 7.3) * .4), grain = noise(vWorld * .9);
    base = mix(vec3(.6, .42, .26), vec3(.36, .23, .13), pit * .8 + grain * .25);
    rough = .95; relief = -pit * .035 + grain * .01; cavity = 1. - .35 * pit;
  } else if (id == ${MAT.spoon}) {
    // a wooden spoon: pale beech, its grain running along it, a little darker where it's been used
    float g = noise(vec3(uv.x * .35, uv.y * 3., 2.)) * .55 + noise(vec3(uv.x * 2.2, uv.y * 11., 6.)) * .25 + .2 * sin(uv.x * 1.3 + noise(vec3(uv * .8, 1.)) * 4.);
    base = mix(vec3(.74, .55, .34), vec3(.9, .74, .52), g) * (1. - .15 * smoothstep(9., 0., uv.x));
    rough = .45; coat = .35;
  } else if (id == ${MAT.towel}) {
    // a linen tea towel: an off-white weave, red stripes down it near each side, a hem
    vec2 w = uv * 9.;
    float weave = .5 + .5 * sin(w.x * 3.1416) * sin(w.y * 3.1416);
    float slub = noise(vec3(uv.x * 2., uv.y * .6, 4.)) * .5 + noise(vec3(uv * 6., 8.)) * .5;
    float edge = min(uv.y, 11. - uv.y);
    float stripe = smoothstep(.05, 0., abs(edge - 1.6) - .35) + smoothstep(.05, 0., abs(edge - 2.7) - .12);
    float hem = smoothstep(.15, 0., edge - .35);
    float wk = 1. - smoothstep(.04, .14, px);
    base = mix(vec3(.9, .87, .8), vec3(.72, .16, .14), clamp(stripe, 0., 1.)) * (.86 + .1 * mix(.5, weave, wk) + .08 * slub) * (1. - .12 * hem);
    relief = weave * .018 * wk; rough = .92; fabric = 1.;
  } else if (id == ${MAT.gingham}) {
    // a folded gingham cloth: red and white, checked, the crossings darkest
    // (woven: each thread's colour run along it, softened at its edge, as small as it can be seen and no smaller;
    // the threads themselves, finely, close to)
    vec2 aa = vec2(fwidth(uv.x), fwidth(uv.y)) / 1.3 + .02;
    vec2 f = fract(uv / 1.3);
    vec2 c = smoothstep(.5 - aa, .5 + aa, f) - smoothstep(1. - aa, 1. + aa, f);
    float k = (c.x + c.y) * .5;
    float thread = (.5 + .5 * sin(uv.x * 40.) * sin(uv.y * 40.)) * (1. - smoothstep(.02, .06, px));
    base = mix(vec3(.94, .9, .84), vec3(.66, .12, .12), k) * (.9 + .1 * noise(vec3(uv * 5., 2.))) * (.95 + .08 * thread);
    rough = .9; fabric = 1.;
  } else if (id == ${MAT.floral}) {
    // painted tin: red, a teal band round it, cream flowers with gold hearts, a little worn at its edges
    vec2 q = uv / 5.5;
    vec2 cell = fract(q) - .5, id2 = floor(q);
    float an = atan(cell.y, cell.x) + hash3(vec3(id2, 3.)) * 6.28, rr = length(cell) * 2.;
    float petal = smoothstep(.04, 0., rr - (.38 + .3 * abs(cos(an * 2.5))));
    float heart = smoothstep(.03, 0., rr - .16);
    float band = smoothstep(.1, 0., abs(fract(uv.y / 9.) - .5) - .38);
    vec3 paint = mix(vec3(.62, .11, .08), vec3(.08, .38, .36), band);
    vec3 c2 = mix(paint, vec3(.95, .88, .7), petal * (1. - heart));
    c2 = mix(c2, vec3(.95, .74, .32), heart);
    float wear = smoothstep(.7, .85, noise(vec3(uv * .6, 9.)));
    base = mix(c2, vec3(.7, .7, .68), wear * .12);
    rough = mix(.35, .25, heart); metal = heart * .8 + wear * .4; coat = .5;
  } else if (id == ${MAT.smear}) {
    // butter melted and run: its edge ragged, lobed where it's crept on, an island or two left dry in it; stood up
    // at its edge and pooled in its middle, pale where it's thin, golden where it's deep
    float across = abs(uv.y * 2. - 1.);
    float rag = .2 * noise(vec3(vWorld.xz * .7, 3.)) + .12 * noise(vec3(vWorld.xz * 2.1, 7.));
    float d = (.92 - rag - across) * 3.2;
    d = min(min(d, (.8 - noise(vec3(vWorld.xz * .9, 11.))) * 9.), min(uv.x - .03, .86 - uv.x) * 25.);
    if (d <= 0.) discard;
    liquidCover = smoothstep(0., max(.09, fwidth(d) * 1.5), d);
    float swell = .8 + .4 * noise(vec3(vWorld.xz * .5, 5.));
    liquidDepth = clamp(d, 0., 1.);
    liquid(liquidDepth, .16 * swell, vWorld, vec3(1., .93, .68), vec3(.97, .74, .2), .08, n, base, rough, coat, coatRough, coatSpec, emit);
  } else if ((id >= 25 && id <= 29) || id == ${MAT.glaze}) {
    // what's on a top: flour on a board, crumbs or pepper on a plate, hundreds and thousands on a pudding, honey spilt, over the top it's on
    int k = id == ${MAT.glaze} ? 6 : id - 24;
    if (k == 6) { base = vec3(.85, .5, .1); rough = .05; coat = 1.; emit = .18; }
    else if (k == 1) base = vec3(.8, .64, .44); else if (k == 4 || k == 3) { float r = length(uv); base = mix(vec3(.94, .94, .92), vec3(.12, .25, .58), smoothstep(.78, .8, r) * (1. - smoothstep(.86, .88, r))); rough = .18; coat = 1.; } else { base = vec3(.62, .28, .06); rough = .12; coat = 1.; emit = .05; }
    float gl = 0.;
    float amount = k == 1 ? .55 : k == 3 ? .5 : k == 4 ? .45 : k == 6 ? .9 : .6;
    // (thinner toward the edge, as a sprinkle or a dusting lies)
    float spread = k == 1 ? .8 + .4 * noise(vec3(vWorld.xz * .3, 1.)) : 1. - .5 * smoothstep(.5, 1., length(uv));
    base = coatColor(vWorld * .33, vec2(amount * spread, float(k)), base, rough, gl, n, n);
    coat = max(coat * (1. - gl), gl);
  } else if (id == 12) {
    // a window pane: the garden in the morning, softly
    vec3 sky = mix(vec3(1., .96, .88), vec3(.62, .78, .95), uv.y);
    vec3 green = vec3(.4, .55, .3) * (.7 + .5 * noise(vec3(uv * 9., 1.)));
    o = vec4(tonemap(mix(green, sky, smoothstep(.25, .45, uv.y + .08 * noise(vec3(uv * 6., 3.)))) * 2.4), 1.);
    return;
  } else if (id == 13) {
    // the aiming line's dots
    o = vec4(untonemap(uTint), uAlpha); return;
  } else if (id == 14) {
    // where it will land: a soft ring
    float r = length(uv);
    float a = smoothstep(.7, .82, r) * (1. - smoothstep(.9, 1., r)) + .18 * (1. - smoothstep(0., .8, r));
    o = vec4(untonemap(uTint), a * uAlpha); return;
  } else if (id == 15) {
    // the dark under the dumpling, soft
    float r = length(uv);
    o = vec4(0., 0., 0., .45 * (1. - smoothstep(.15, 1., r)) * uAlpha); return;
  } else if (id == 16) {
    // the window's light through the jelly: pink in its shadow, gathered bright in the middle (added)
    float r = length(uv);
    float focus = exp(-r * r * 22.) * 1.2 + (1. - smoothstep(.25, 1., r)) * .3;
    o = vec4(vec3(1., .5, .64) * focus * uAlpha, 1.); return;
  }
  // (?bakeview: what's baked, alone: how shut in, grey; the colour of what shuts it in, over it)
  if (uBakeView > .5) { o = vec4(tonemap(untonemap(mix(vec3(1. - vBake.x), vBake.yzw * (1. - vBake.x * .5), uBakeView - 1.))), 1.); return; }
  n = reliefNormal(n, vWorld, relief);
  float NoV = max(dot(n, V), 1e-3), NoL = max(dot(n, uKey), 0.);
  float sh = shadow(n);
  float a = rough * rough;
  vec3 F0 = mix(vec3(.04), base, metal);
  vec3 H = normalize(uKey + V);
  vec3 Fk = F0 + (1. - F0) * pow(1. - max(dot(V, H), 0.), 5.);
  vec3 spec = D_ggx(max(dot(n, H), 0.), a) * V_smith(NoV, NoL, a) * Fk * NoL;
  // (the room's light, less where it's shut in by what's near it (baked as the level's laid); and the light off
  // what's near, onto it, in its colour: lit by the room, and a little by the sun on it)
  // (near the dumpling, shut in by it as by a ball, the more the nearer and the more it faces it: a tight contact
  // shadow where it sits, deeper where it's pressed into a jelly's top, the light that gets in there what's come off it)
  vec3 bd = uBodyAt.xyz - vWorld;
  float bl = max(length(bd), 1e-3);
  contact = max(contact, clamp(dot(n, bd / bl) * uBodyAt.w * uBodyAt.w / (bl * bl), 0., 1.) * (1. - smoothstep(uBodyAt.w * 2., uBodyAt.w * 3.5, bl)));
  float occ = max(vBake.x, contact);
  vec3 amb = irradiance(n) * cavity * (1. - .85 * occ) + (contact > vBake.x ? uBodyCol * .3 : vBake.yzw) * occ * (irradiance(-n) * .55 + uKeyCol * .1) * .6;
  // (and where it's well shut in, a little of the sun too: what stands on a thing sits down into it, even in the sun)
  float sunIn = 1. - .45 * occ * occ;
  spec *= 1. - .85 * fabric;
  vec3 c = base * (1. - metal) * (1. - Fk) * (amb + uKeyCol * NoL * sh * sunIn) + uKeyCol * spec * sh * sunIn;
  // (cloth's sheen: its fibres catching the light at a glance, in its own colour, soft)
  c += fabric * base * (irradiance(n) * .3 * (1. - .7 * occ) + uKeyCol * NoL * sh * .18) * pow(1. - NoV, 2.5);
  vec3 Fr = F0 + (max(vec3(1. - rough), F0) - F0) * pow(1. - NoV, 5.);
  // (the room's window, sharp, only in what's glossy: a rougher surface takes the room's soft light, not a window that isn't where it shows)
  c += Fr * mix(env(reflect(-V, n)), irradiance(n), smoothstep(.05, .4, rough)) * (1. - .6 * rough * (1. - metal)) * (1. - .5 * occ) * (1. - .8 * fabric);
  c += base * emit * (amb + uKeyCol * .5 * (1. - .7 * contact));
  if (coat > .01) {
    float Fc = (.04 + .96 * pow(1. - NoV, 5.)) * coat;
    c = c * (1. - Fc) + Fc * env(reflect(-V, n)) * (1. - .5 * occ) + coat * uKeyCol * D_ggx(max(dot(n, H), 0.), coatRough) * V_smith(NoV, NoL, coatRough) * coatSpec * NoL * sh;
  }
  float d = length(vWorld - uEye);
  c = mix(c, vec3(.62, .57, .5), smoothstep(250., 900., d) * .6);
  // Ray through the bounded cylindrical fill; take the first exit through its
  // side, bottom or top. No backface buffer required for each jar.
  if (uLiquidOpt > 1.5 && id == ${MAT.honey}) {
    vec3 ray = -V, q = vWorld - uHoneyC;
    float rad = uHoneyRange.x;
    float aa = dot(ray.xz, ray.xz), bb = 2. * dot(q.xz, ray.xz);
    float cc = dot(q.xz, q.xz) - rad * rad;
    float tSide = 1e5;
    if (aa > 1e-6) {
      float disc = max(bb * bb - 4. * aa * cc, 0.);
      tSide = max(0., (-bb + sqrt(disc)) / (2. * aa));
    }
    float tCap = 1e5;
    if (ray.y < -1e-5) tCap = max(0., (uHoneyRange.y - vWorld.y) / ray.y);
    else if (ray.y > 1e-5) tCap = max(0., (uHoneyRange.z - vWorld.y) / ray.y);
    float thick = clamp(min(tSide, tCap), 0., rad * 3.);
    // (seen down through its bottom: what's under it is lit through the honey too, so it's shut the more)
    if (tCap < tSide && ray.y < 0.) thick = thick * 2. + rad * .6;
    // (honey's clear, and gold: blue's gone in a few centimetres, green over the jar's width, red hardly at all, so
    // the wall behind comes through it gold; and it scatters, the sun that's gone into it glowing back out of it,
    // brightest where the sun's behind it, as it is in a window, and toward the side the sun's on)
    vec3 T = exp(-vec3(.04, .2, .7) * thick);
    vec2 offset = vec2(dot(n, uRight), dot(n, uUp)) * (.0025 + .004 * thick / max(rad * 2., .01));
    vec3 scene = texture(uScene, clamp(gl_FragCoord.xy / uRes + offset, vec2(.001), vec2(.999))).rgb;
    float F = .035 + .965 * pow(1. - NoV, 5.);
    float back = pow(max(dot(ray, uKey), 0.), 2.), side = .5 + .5 * dot(normalize(q.xz + 1e-4), normalize(uKey.xz + 1e-4));
    vec3 glow = vec3(1., .5, .06) * uKeyCol * (1. - T.g) * (.2 + .45 * side + 1.4 * back);
    vec3 transmitted = scene * T * vec3(1., .8, .45) + glow;
    // (a few small bubbles held in it, caught in the light: looked for at four depths along the ray through it)
    float specks = 0.;
    for (int k = 0; k < 4; k++) {
      vec3 at = vWorld + ray * thick * (float(k) + .5) / 4.;
      vec3 cell = floor(at * .9), c0 = (cell + vec3(hash3(cell), hash3(cell + 7.), hash3(cell + 13.))) / .9;
      float r = .04 + .05 * hash3(cell + 3.), dd = length(cross(c0 - vWorld, ray));
      specks += step(.93, hash3(cell + 21.)) * smoothstep(r, r * .3, dd) * exp(-float(k) * .5);
    }
    transmitted += vec3(1., .8, .45) * specks * .45;
    vec3 glint = env(reflect(-V, n)) * (.3 + .1 * max(dot(n, uKey), 0.));
    // (its top: the window in it, and a bright line round it where it's drawn up the glass)
    if (n.y > .5) glint += vec3(1., .8, .45) * smoothstep(rad - .7, rad - .05, length(q.xz)) * 1.2;
    else glint += vec3(1., .8, .45) * smoothstep(.6, .05, uHoneyRange.z - vWorld.y) * .9;
    glint += uKeyCol * pow(max(dot(reflect(-V, n), uKey), 0.), 220.) * 1.5;
#ifdef HDR
    o = vec4(mix(transmitted, glint, clamp(F * .65, .02, .76)), 1.);
#else
    o = vec4(mix(transmitted, tonemap(glint), clamp(F * .65, .02, .76)), 1.);
#endif
    return;
  }
  // Soap and glass remain separate from this shallow, partially transmitting
  // honey and butter film. Use physical colour loss in the tiny raised pool.
  if (uLiquidOpt > .5 && (id == ${MAT.honeyRun} || id == ${MAT.honeyPool} || id == ${MAT.honeyDrip} || id == ${MAT.smear})) {
    bool drip = id == ${MAT.honeyDrip};
    if (drip && uHoneyNew > .5) {
      // (the light through it: what's behind it, bent by its surface, losing blue fast, green slower, red hardly,
      // over the honey's own path through it: pale gold where it's thin, deep amber where it's thick; a little
      // scattered back out, more when the sun's behind it; and its surface's reflection over that, by Fresnel,
      // the window and one sharp sun glint in it, from the kitchen's own light)
      vec3 Th = exp(-vec3(.22, .95, 3.) * honeyPath);
      vec2 bendH = vec2(dot(n, uRight), dot(n, uUp)) * .012 * min(honeyPath, 2.);
      vec3 behind = texture(uScene, clamp(gl_FragCoord.xy / uRes + bendH, vec2(.001), vec2(.999))).rgb;
      float Fh = .04 + .96 * pow(1. - NoV, 5.);
      vec3 scatter = vec3(1., .55, .12) * uKeyCol * (1. - Th.g) * (.05 + .3 * pow(max(dot(-V, uKey), 0.), 3.));
#ifdef HDR
      o = vec4((behind * Th + scatter) * (1. - Fh) + c, 1.);
#else
      o = vec4((behind * Th + tonemap(scatter)) * (1. - Fh) + tonemap(c), 1.);
#endif
      return;
    }
    bool butterFilm = id == ${MAT.smear};
    float depth = butterFilm ? (.025 + .23 * liquidDepth) : drip ? (1.1 + 2.4 * liquidDepth) : (.05 + .45 * liquidDepth);
    vec3 absorb = butterFilm ? vec3(.12, .48, 1.6) : drip ? vec3(.13, .85, 2.9) : vec3(.15, .7, 2.4);
    vec3 T = exp(-absorb * depth);
    float F = .04 + .96 * pow(1. - NoV, 5.);
    vec2 bend = vec2(dot(n, uRight), dot(n, uUp)) * (butterFilm ? .0009 : drip ? .03 : .0018) * (drip ? 1. : liquidDepth);
    vec3 scene = texture(uScene, clamp(gl_FragCoord.xy / uRes + bend, vec2(.001), vec2(.999))).rgb;
    vec3 tint = butterFilm ? vec3(.97, .83, .33) : vec3(.9, .4, .03);
    float reflectAmt = clamp(.13 + .68 * F, 0., .85);
    // (butter's cloudy, milk in it: mostly its own gold, lit, only its thin edge letting what's under show)
    // (honey's runs too, mostly their own amber: drawn before the jar's honey, what's behind them is the bare wall)
    reflectAmt = max(reflectAmt, butterFilm ? mix(.45, .85, liquidDepth) : drip ? mix(.07, .17, liquidDepth) : mix(.35, .7, liquidDepth));
    // (and honey glows: the sun gone into it coming back out gold, most when it's behind it)
    vec3 honeyGlow = butterFilm ? vec3(0.) : vec3(1., .4, .03) * uKeyCol * (1. - T.g) * (.25 + 1.2 * pow(max(dot(-V, uKey), 0.), 2.));
#ifdef HDR
    vec3 transmitted = scene * T + tint * (vec3(1.) - T) * .16 + honeyGlow;
    // (a drip's own edges: darker toward its sides, what's round it bent in; and a bright stripe down it, the sun
    // and the window caught along its length. That's how it reads against more honey behind it)
    if (drip) {
      vec3 R = reflect(-V, n);
      transmitted *= mix(1., .2, pow(1. - NoV, .9));
      c += uKeyCol * (pow(max(dot(R, uKey), 0.), 70.) * 2.2 + pow(max(dot(R, uWin), 0.), 24.) * .9);
      // (the light through it gathered low in it, where it's rounded under: a bead's bright bottom)
      transmitted += vec3(1., .55, .06) * uKeyCol * smoothstep(.1, -.75, n.y) * (.5 + .5 * max(dot(-n, uKey), 0.)) * 1.1;
    }
    o = vec4(mix(scene, mix(transmitted, c, reflectAmt), liquidCover), 1.);
#else
    vec3 transmitted = scene * T + tonemap(tint) * (vec3(1.) - T) * .16 + tonemap(honeyGlow);
    if (drip) { vec3 R = reflect(-V, n); transmitted *= mix(1., .2, pow(1. - NoV, .9)); c += uKeyCol * (pow(max(dot(R, uKey), 0.), 70.) * 2.2 + pow(max(dot(R, uWin), 0.), 24.) * .9); }
    o = vec4(mix(scene, mix(transmitted, tonemap(c), reflectAmt), liquidCover), 1.);
#endif
    return;
  }
  // (glass: seen through, but for its gloss and its edges)
  if (id == ${MAT.glass}) { float Fg = .04 + .96 * pow(1. - NoV, 4.); o = vec4(tonemap(c), clamp(.08 + Fg * .9 + length(spec) * .3, 0., 1.) * uAlpha); return; }
  o = vec4(tonemap(c), alpha);
}`;

/** the dumpling: its skin's particles as they are now, its normals, and where each was in its rest shape */
export const DOUGH_VS = `#version 300 es
in vec3 aPos;
in vec3 aNor;
in vec3 aRest;
in vec2 aCoat;
in vec3 aSkin;
uniform mat4 uVP, uLightVP;
out vec3 vWorld;
out vec3 vNor;
out vec3 vRest;
out vec2 vCoat;
out vec3 vSkin;
out vec4 vShadow;
void main() {
  vWorld = aPos; vNor = aNor; vRest = aRest; vCoat = aCoat; vSkin = aSkin;
  vShadow = uLightVP * vec4(aPos, 1.);
  gl_Position = uVP * vec4(aPos, 1.);
}`;
/**
 * Dough: steamed, thick, a little translucent (light wraps round it and glows through its thin
 * edges), faintly floury, darker in the creases of its pleats; and a face, drawn on its rest
 * shape so it turns and squashes with it: eyes that blink, squeeze shut as it winds up and
 * smile when it's home, a little mouth, pink cheeks.
 */
export const DOUGH_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNor;
in vec3 vRest;
in vec2 vCoat;
in vec3 vSkin;
in vec4 vShadow;
out vec4 o;
uniform vec3 uEye;
uniform float uBlink, uFace, uR;
${COMMON}
${SHADOW_GLSL}
${COAT_GLSL}
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)); }
void main() {
  vec3 n = normalize(vNor);
  vec3 V = normalize(uEye - vWorld);
  vec3 q = vRest / uR;
  float th = atan(q.z, q.x);
  float h = q.y > 0. ? q.y / .8 : q.y / .6;
  // the pleats' creases, and the flour
  float pleatAmt = smoothstep(.05, .7, h) * (1. - smoothstep(.88, 1., h));
  float crease = pleatAmt * pow(.5 - .5 * cos(12. * th + 4. * h), 3.);
  float flour = smoothstep(.72, .8, noise(q * 26.)) * .5 + smoothstep(.6, .9, noise(q * 5. + 3.)) * .25;
  // (how thick it is here, through its rest shape; and how it's stretched (+) or squashed (-) now: squashed, its
  // creases close and darken, and less light gets through; stretched, it's thinner, milkier, the light through it more)
  float thick = max(vSkin.x, .2), strain = clamp(vSkin.y, -.6, .6);
  float squash = smoothstep(0., .35, -strain), stretch = smoothstep(0., .35, strain);
  // (and pressed against what it's on: there its creases close the more, and broaden; it's shut in, darker, the light
  // that gets in there what's come off what it's on; its gloss spread flat and dull)
  float press = clamp(vSkin.z, 0., 1.);
  crease = min(1., crease * (1. + 1.4 * squash + .8 * press) + squash * .25 * pleatAmt);
  vec3 base = mix(vec3(.87, .77, .61), vec3(.95, .91, .83), flour * .6) * (1. - .22 * crease);
  base *= 1. - .14 * smoothstep(.2, 1., -h);
  base = mix(base, base * vec3(1.03, 1.02, 1.), stretch * .6);
  // the face, on the front of its rest shape (+z), a little above its middle
  vec3 d = normalize(q * vec3(1., 1.35, 1.));
  float ink = 0., white = 0., cheek = 0.;
  if (d.z > .2) {
    vec2 p = vec2(d.x, d.y - .2) / 1.25;
    for (int s = 0; s < 2; s++) {
      float sx = s == 0 ? -1. : 1.;
      vec2 e = p - vec2(.34 * sx, 0.);
      if (uFace < .5) {
        // open: dark ovals with a glint, blinking
        float hy = mix(.085, .01, uBlink);
        float k = length(vec2(e.x / .062, e.y / hy));
        ink = max(ink, 1. - smoothstep(.9, 1.05, k));
        white = max(white, (1. - smoothstep(.016, .024, length(e - vec2(.022 * sx, .032)))) * (1. - uBlink));
      } else if (uFace < 1.5) {
        // squeezed shut, winding up: > <
        float c = min(seg(e, vec2(-.05 * sx, .05), vec2(.04 * sx, 0.)), seg(e, vec2(.04 * sx, 0.), vec2(-.05 * sx, -.05)));
        ink = max(ink, 1. - smoothstep(.011, .02, c));
      } else {
        // happy: arcs ^ ^
        float c = abs(e.y - (.045 - 9. * e.x * e.x));
        ink = max(ink, (1. - smoothstep(.011, .02, c)) * step(abs(e.x), .065));
      }
      cheek = max(cheek, 1. - smoothstep(.0, .1, length(vec2((p.x - .5 * sx) / 1.4, p.y + .11))));
    }
    // the mouth: a little smile; a round o in the air; a wide grin at home
    vec2 m = p - vec2(0., -.11);
    float mo = uFace > 2.5 ? abs(length(m) - .028) : uFace > 1.5 ? abs(m.y + .03 - 5. * m.x * m.x) + step(.07, abs(m.x)) : abs(m.y - 3.5 * m.x * m.x) + step(.045, abs(m.x));
    ink = max(ink, 1. - smoothstep(.008, .015, mo));
  }
  base = mix(base, vec3(.98, .5, .5), cheek * .6);
  // what it's coated with
  float cRough = .5, cGloss = 0.;
  base = coatColor(q, vCoat, base, cRough, cGloss, n, normalize(q));
  // light: wrapped round (it's thick, and light gets into it), a warm glow through the edges
  float NoL = dot(n, uKey);
  float wrap = max((NoL + .5) / 1.5, 0.);
  float sh = shadow(n);
  float lit = mix(wrap * .3, wrap, sh) * .72;
  vec3 amb = irradiance(n) * (1. - .28 * crease) * (.75 + .25 * smoothstep(-1., .3, n.y)) * (1. - .55 * press);
  vec3 c = base * (amb + uKeyCol * lit * (1. - .5 * press));
  float edge = pow(1. - max(dot(n, V), 0.), 2.);
  c += vec3(1., .62, .42) * uKeyCol * .22 * pow(clamp(1. - abs(NoL), 0., 1.), 3.) * sh;
  // (light through it: where it's thin, the sun from behind it comes through warm, milky; and the room's light
  // gets into it everywhere a little, the more the thinner)
  float T = exp(-thick * (.42 - .12 * stretch + .3 * squash));
  c += vec3(1., .66, .45) * uKeyCol * .7 * pow(max(dot(V, -uKey), 0.), 2.) * T * (.35 + .65 * sh) * (.3 + .7 * edge);
  c += base * vec3(1., .8, .62) * irradiance(-n) * .45 * T;
  // a moist sheen: broad and low, steamed; and a little tighter one, wetter, narrower where it's stretched taut
  vec3 H = normalize(uKey + V);
  float NoV = max(dot(n, V), 1e-3);
  float NoH = max(dot(n, H), 0.), NoLp = max(NoL, 0.);
  c += uKeyCol * D_ggx(NoH, .48) * V_smith(NoV, NoLp, .48) * .07 * NoLp * sh;
  float wet = mix(mix(.16, .11, stretch), .3, press);
  c += uKeyCol * D_ggx(NoH, wet) * V_smith(NoV, NoLp, wet) * .018 * NoLp * sh * (1. - squash * .6);
  c += (.04 + .96 * pow(1. - NoV, 5.)) * env(reflect(-V, n)) * .25 * (1. - .7 * smoothstep(.5, .95, cRough));
  // (butter's grease, sprinkles' sugar: a gloss)
  c += (uKeyCol * D_ggx(max(dot(n, H), 0.), .1) * V_smith(NoV, max(NoL, 0.), .1) * max(NoL, 0.) * sh * .25 + env(reflect(-V, n)) * .12) * cGloss;
  c = mix(c, vec3(.08, .05, .05), ink);
  c = mix(c, vec3(1.), white * .95);
  o = vec4(tonemap(c), 1.);
}`;
/**
 * Jelly: a clear pink squishy toy, glittery. Drawn in two goes over a copy of what's behind it.
 * First its body (uPass 0): what's behind seen through it, bent as a lens of jelly would bend it
 * and tinted the deeper it goes (red comes through, green and blue are taken), with the light
 * caught inside it, pinker, glowing where the window is behind it. Then (after the glitter
 * inside, uPass 1) what's on it: the gloss, sharp highlights of the window and the room, and
 * its face, printed on: round black eyes with a shine, a smile, red cheeks.
 */
export const JELLY_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNor;
in vec3 vRest;
in vec2 vCoat;
in vec3 vSkin;
in vec4 vShadow;
out vec4 o;
uniform vec3 uEye;
uniform mat4 uVP;
uniform sampler2D uScene, uBack;
uniform vec2 uRes;
uniform float uBlink, uFace, uR, uPass, uHasBack;
uniform mat3 uRot;
uniform vec3 uCom;
${COMMON}
${SHADOW_GLSL}
${COAT_GLSL}
float seg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0., 1.)); }
const vec3 PINK = vec3(1., .42, .58);
void main() {
  vec3 n = normalize(vNor);
  vec3 V = normalize(uEye - vWorld);
  float NoV = max(dot(n, V), 0.);
  float NoL = dot(n, uKey);
  float sh = shadow(n);
  float px = 1. / uRes.y;
  if (uPass < .5) {
    // how far through it the eye looks here (a chord of something round), and where that comes out
    // how far through it the eye looks here: from its back, as drawn just before (the real way through it, as
    // it's squashed or stretched); without that, as through something round
    float thick = uHasBack > .5 ? clamp(texelFetch(uBack, ivec2(gl_FragCoord.xy), 0).r - length(uEye - vWorld), .15, uR * 2.8) : uR * 2.1 * NoV + .25;
    vec3 rd = refract(-V, n, 1. / 1.4);
    vec4 cp = uVP * vec4(vWorld + rd * (thick + 2.5), 1.);
    vec2 suv = cp.xy / cp.w * .5 + .5;
    // (soft, as through jelly, the softer the thicker: a few taps about it)
    vec3 behind = vec3(0.);
    float spread = 1.2 + thick * .55;
    for (int i = 0; i < 7; i++) {
      float a = float(i) * 2.4, rr = i == 0 ? 0. : sqrt(float(i) / 6.);
      behind += texture(uScene, clamp(suv + vec2(cos(a), sin(a)) * px * spread * rr * 2.2, .001, .999)).rgb;
    }
    behind /= 7.;
    vec3 T = exp(-vec3(.012, .12, .075) * thick);
    // the light inside it: the room's, and the window's, wrapped round, pinker the deeper
    float wrap = max((NoL + .6) / 1.6, 0.);
    vec3 inside = PINK * (irradiance(n) * .07 + uKeyCol * wrap * mix(.25, 1., sh) * .09) * (1. - T.g * .5);
    // and glowing through it where the window's behind
    inside += PINK * uKeyCol * .35 * pow(max(dot(-V, uKey), 0.), 3.) * (1. - NoV * .5);
    // (thin at its rim, where the light bounces about inside it: a pinker edge)
    inside += PINK * irradiance(n) * .3 * pow(1. - NoV, 3.);
    // a few bubbles held in it, where they were set when it was made (they go with it): each a bright ring, its
    // middle a little clearer
    vec3 ro = transpose(uRot) * (vWorld - uCom), rv = transpose(uRot) * rd;
    float bub = 0., clear = 0.;
    for (int b = 0; b < 3; b++) {
      vec4 B = b == 0 ? vec4(.55, .25, -.45, .42) : b == 1 ? vec4(-.85, -.35, .5, .3) : vec4(.15, -.6, .95, .22);
      vec3 oc = ro - B.xyz * uR / 3.;
      float tb = -dot(oc, rv);
      if (tb > 0. && tb < thick) {
        float dmin = length(oc + rv * tb), r = B.w * uR / 3.;
        bub += smoothstep(r * .55, r * .92, dmin) * (1. - smoothstep(r * .92, r * 1.04, dmin));
        clear += 1. - smoothstep(r * .5, r, dmin);
      }
    }
    inside += (irradiance(n) * .5 + uKeyCol * .25) * bub * .5;
    // (pressed against what it's on: shut in there, less light inside it)
    inside *= 1. - .45 * clamp(vSkin.z, 0., 1.);
    vec3 c = behind * mix(T, sqrt(T), clamp(clear, 0., 1.) * .6);
#ifdef HDR
    // (its own light over what's seen through it, as a screen over it would be, in light)
    o = vec4(c + inside / (1. + c), 1.);
#else
    vec3 add = tonemap(inside);
    o = vec4(1. - (1. - c) * (1. - add), 1.);
#endif
    return;
  }
  // ─── on it: the face, the gloss
  vec3 q = vRest / uR;
  float ang = atan(q.x, q.z);
  vec2 p = vec2(ang * 1.12, q.y + .02);
  float ink = 0., white = 0., cheek = 0.;
  if (abs(ang) < 1.3) {
    for (int s = 0; s < 2; s++) {
      float sx = s == 0 ? -1. : 1.;
      vec2 e = p - vec2(.36 * sx, 0.);
      if (uFace < .5) {
        // open: round, black, a shine up and to the right; shut a moment to blink
        float hy = mix(.088, .01, uBlink);
        float k = length(vec2(e.x / .095, e.y / hy));
        ink = max(ink, 1. - smoothstep(.93, 1.03, k));
        white = max(white, (1. - smoothstep(.028, .036, length(e - vec2(.035, .035)))) * (1. - uBlink));
      } else if (uFace < 1.5) {
        // squeezed shut, winding up: > <
        float c = min(seg(e, vec2(-.06 * sx, .06), vec2(.05 * sx, 0.)), seg(e, vec2(.05 * sx, 0.), vec2(-.06 * sx, -.06)));
        ink = max(ink, 1. - smoothstep(.014, .022, c));
      } else {
        // happy: ^ ^
        float c = abs(e.y - (.05 - 8. * e.x * e.x));
        ink = max(ink, (1. - smoothstep(.014, .022, c)) * step(abs(e.x), .075));
      }
      // cheeks, printed: red ovals, a little out and down from each eye
      cheek = max(cheek, 1. - smoothstep(.8, 1., length(vec2((p.x - .5 * sx) / .085, (p.y + .14) / .055))));
    }
    // the mouth: a smile; an o in the air; a grin at home
    vec2 m = p - vec2(0., -.1);
    float mo = uFace > 2.5 ? abs(length(vec2(m.x, m.y * .8)) - .035) : uFace > 1.5 ? abs(m.y + .035 - 6. * m.x * m.x) + step(.1, abs(m.x)) : abs(m.y + .03 - 5.5 * m.x * m.x) + step(.085, abs(m.x));
    ink = max(ink, 1. - smoothstep(.011, .019, mo));
  }
  // gloss: the room in it, at a glance more; the window and the sun sharp in it
  vec3 R = reflect(-V, n);
  float F = .035 + .965 * pow(1. - NoV, 5.);
  vec3 H = normalize(uKey + V);
  // (where it's pressed flat against what it's on, wet against it, no air between: no gloss there, it's seen into)
  float press = clamp(vSkin.z, 0., 1.);
  vec3 gloss = (env(R) * F * .45
    + uKeyCol * D_ggx(max(dot(n, H), 0.), .045) * V_smith(max(NoV, 1e-3), max(NoL, 0.), .045) * max(NoL, 0.) * sh * .5
    + uKeyCol * D_ggx(max(dot(n, H), 0.), .25) * V_smith(max(NoV, 1e-3), max(NoL, 0.), .25) * max(NoL, 0.) * sh * .06) * (1. - .75 * press);
  // the print, lit as a print on its skin
  vec3 lightOn = irradiance(n) * .55 + uKeyCol * max(NoL, 0.) * mix(.25, 1., sh) * .6;
  vec3 printCol = mix(vec3(1., .16, .2) * (lightOn * .8 + .35), vec3(.012, .01, .015), ink);
  printCol = mix(printCol, vec3(1.) * lightOn * 1.2, white);
  float a = max(max(ink, cheek * .92), white);
  // what's stuck to it, over the gloss
  float cRough = .5, cGloss = 0.;
  vec3 coatC = coatColor(q, vCoat, vec3(-1.), cRough, cGloss, n, normalize(q));
  float ca = coatC.x < 0. ? 0. : vCoat.x * (vCoat.y < 1.5 ? smoothstep(.2, .9, vCoat.x * (.6 + .8 * noise(q * 30.))) : 1.) ;
  if (coatC.x >= 0. && ca > 0.) { vec3 lit = coatC * lightOn; a = max(a, ca * .9); }
  vec3 c = tonemap(printCol) * max(max(ink, cheek * .92), white) + tonemap(gloss) * (1. - a * .4);
  if (coatC.x >= 0.) { float k = clamp(ca, 0., 1.) * (1. - max(ink, white)); c = mix(c, tonemap(coatC * lightOn * (1. + cGloss * .4)), k); }
  o = vec4(c, a);
}`;
/**
 * The glitter in the jelly: flakes, each a tiny mirror turned its own way, so one catches the
 * window and flashes as the jelly turns or wobbles; seen through the jelly, pinker and dimmer the
 * further in.
 */
export const GLITTER_VS = `#version 300 es
in vec3 aPos;
in vec3 aNor;
in vec2 aK;
uniform mat4 uVP;
uniform vec3 uEye, uKey, uWin, uCom;
uniform float uScale, uR;
out vec3 vCol;
out float vA;
void main() {
  gl_Position = uVP * vec4(aPos, 1.);
  vec3 V = normalize(uEye - aPos);
  vec3 n = normalize(aNor);
  vec3 r = reflect(-V, n * sign(dot(n, V) + 1e-4));
  float flash = pow(max(dot(r, uKey), 0.), 60.) * 3. + pow(max(dot(r, uWin), 0.), 24.) * .8;
  // (how deep in: from the near side of it, toward the eye)
  float depth = clamp(1. - dot(aPos - uCom, V) / uR, 0., 2.);
  vec3 tint = exp(-vec3(.04, .25, .16) * depth * uR);
  // silver, pink, and a few lilac: holographic, its colour shifting with the angle
  vec3 base = aK.x < .6 ? vec3(1., .92, .95) : aK.x < .9 ? vec3(1., .55, .75) : vec3(.8, .7, 1.);
  base *= .8 + .4 * cos(6.28 * (dot(n, V) * 1.5 + vec3(0., .33, .67)));
  vCol = base * tint;
  vA = .28 + flash;
  gl_PointSize = clamp(uScale * aK.y * (1. + min(flash, 2.) * .6) / gl_Position.w, 1., 7.);
}`;
export const GLITTER_FS = `#version 300 es
precision highp float;
in vec3 vCol;
in float vA;
out vec4 o;
void main() {
  vec2 d = gl_PointCoord - .5;
  // (a flake: a bright core, and when it flashes a little cross of light)
  float r = length(d) * 2.;
  float core = 1. - smoothstep(.2, 1., r);
  float star = max(1. - smoothstep(0., .12, abs(d.x)), 1. - smoothstep(0., .12, abs(d.y))) * (1. - r) * smoothstep(.6, 2., vA);
  // (a little less of it than there was: it's the jelly's depth that should hold the eye, not its sparkle)
  o = vec4(vCol * vA * (core + star) * .6, 1.);
}`;
/** steam and flour: soft points */
export const PUFF_VS = `#version 300 es
in vec4 aP;
uniform mat4 uVP;
uniform float uScale;
out float vA;

void main() {
  gl_Position = uVP * vec4(aP.xyz, 1.);
  float s = fract(aP.w);
  // (none close to the eye, where a puff would be a blur over the glass)
  vA = floor(aP.w) / 100. * smoothstep(14., 34., gl_Position.w);
  gl_PointSize = clamp(uScale * s * 10. / gl_Position.w, 1., 40.);
}`;
export const PUFF_FS = `#version 300 es
precision highp float;
in float vA;
out vec4 o;
float h2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  // (a wisp, not a disc: thin at its edge, broken)
  vec2 q = gl_PointCoord - .5;
  float r = length(q) * 2.;
  float br = h2(floor(gl_PointCoord * 5.) + vA * 37.);
#ifdef HDR
  vec3 c = vec3(1.9, 1.84, 1.75);
#else
  vec3 c = vec3(1., .98, .95);
#endif
  o = vec4(c, vA * (1. - smoothstep(0., 1., r)) * (1. - smoothstep(0., 1., r)) * (.55 + .45 * br));
}`;

/** Thin soap film: scene-colour refraction, clear centre, iridescent grazing rim. */
export const BUBBLE_FS = `#version 300 es
precision highp float;
in vec3 vWorld, vNor;
out vec4 o;
uniform vec3 uEye, uRight, uUp;
uniform vec2 uRes;
uniform sampler2D uScene;
${COMMON}
void main() {
  vec3 n = normalize(vNor), V = normalize(uEye - vWorld);
  float nv = dot(n, V);
  if (nv <= 0.) discard;
  float edge = clamp(1. - nv, 0., 1.);
  vec2 uv = gl_FragCoord.xy / uRes;
  // A hollow soap film: nearly cancelling interfaces at the centre.
  vec2 bend = vec2(dot(n, uRight), dot(n, uUp)) * (.003 + .006 * edge) * pow(edge, 1.35);
  vec3 through = texture(uScene, clamp(uv + bend, vec2(.001), vec2(.999))).rgb;
  float fresnel = .05 + .95 * pow(edge, 3.);
  vec3 reflected = tonemap(env(reflect(-V, n)) * .8);
  vec3 c = mix(through, reflected, clamp(fresnel * .85, .05, .85));
  vec3 iridescence = .5 + .5 * cos(6.283185 * (nv * 1.55 + dot(n, uWin) * .12 + vec3(0., .34, .68)));
  // (enough of its film's colour and the room in it that it reads as a bubble, still mostly clear face on)
  c += iridescence * (.03 + .26 * pow(edge, 1.6));
  vec3 R = reflect(-V, n);
  float sun = pow(max(dot(R, uKey), 0.), 260.);
  float window = pow(max(dot(R, uWin), 0.), 54.);
  c += uKeyCol * (sun * .9 + window * .3) * (.4 + .6 * edge);
  o = vec4(c, 1.);
}`;

/** the jelly's back, for how thick it is where it's seen: how far each of its far faces is from the eye */
export const BACK_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
uniform vec3 uEye;
out vec4 o;
void main() { o = vec4(length(uEye - vWorld)); }`;
/** the finish: a triangle over the glass */
export const QUAD_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); vUV = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;
/** what's brightest (past a knee, so only glints, the sun, what glows through the jelly: not a white plate in the sun), a quarter the size */
export const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uThresh, uKnee;
void main() {
  vec3 c = vec3(0.);
  for (int i = 0; i < 4; i++) c += texture(uSrc, vUV + uTexel * vec2(i % 2 == 0 ? -1. : 1., i < 2 ? -1. : 1.)).rgb;
  c *= .25;
  float l = max(c.r, max(c.g, c.b));
  float k = clamp(l - uThresh + uKnee, 0., 2. * uKnee);
  float w = max(k * k / (4. * uKnee + 1e-4), l - uThresh) / max(l, 1e-4);
  o = vec4(c * max(w, 0.), 1.);
}`;
/** a soft spread one way (then the other) */
export const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform sampler2D uSrc;
uniform vec2 uDir;
void main() {
  vec3 c = texture(uSrc, vUV).rgb * .227;
  c += (texture(uSrc, vUV + uDir * 1.385).rgb + texture(uSrc, vUV - uDir * 1.385).rgb) * .316;
  c += (texture(uSrc, vUV + uDir * 3.231).rgb + texture(uSrc, vUV - uDir * 3.231).rgb) * .07;
  o = vec4(c, 1.);
}`;
/** onto the glass: the light as drawn, its bloom added, tonemapped once, a touch of grade, dithered */
export const FINISH_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform sampler2D uScene, uBloom;
uniform float uBloomK, uExposure;
${COMMON}
void main() {
#ifdef HDR
  vec3 c = texture(uScene, vUV).rgb + texture(uBloom, vUV).rgb * uBloomK;
  c = tonemapNow(c * uExposure);
  o = vec4(c + (hash3(vec3(gl_FragCoord.xy, 0.)) - .5) / 255., 1.);
#else
  o = vec4(texture(uScene, vUV).rgb, 1.);
#endif
}`;

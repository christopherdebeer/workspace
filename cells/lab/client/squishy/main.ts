/**
 * Squishy: a third-person platformer in which you are a dumpling: a clear, glittery, pink jelly
 * one, a squishy toy (or, as you like, a steamed one of dough).
 *
 * You don't walk: you flick. Drag back from anywhere and let go, as with a slingshot, and the
 * dumpling flies the other way, as hard as you pulled; while you pull it winds up, squeezed
 * along the way it will go, and the dotted line shows where its middle will land. It's soft:
 * it squashes when it lands, bulges, wobbles back, dents on an edge, sticks to a wall for a
 * moment (dough is tacky), and rights itself like a roly-poly. Across a kitchen counter, from
 * a bamboo steamer to the golden one: home.
 *
 * The dumpling (`body.ts`) and the course (`level.ts`) are pure and tested on their own; the
 * meshes (`mesh.ts`) too. Here is the drawing (WebGL2: the window's shadow map, soft; the
 * course's materials; the jelly seen through, refracting what's behind it, glitter in it; dough
 * lit as dough; a face drawn on its rest shape so it turns and squashes with it), the camera,
 * the hands, and the sounds.
 */
import { hash, seeded } from '../kit/rng';
import { Dumpling, type Kind } from './body';
import { CHAPTER_AT, CHAPTER_NAME, DUST, MAT, chapterOf, RADIUS, REST_H, aim, autoFlick, climbLaunch, launch, liftAt, path, touch, towerAt, type Dust, type Level, type Shape, type V3 } from './level';
import { bench, buildLevel } from './course';
import { logoSVG } from './title';
import { VSTRIDE, disc, levelMesh, sphere, type LevelMesh } from './mesh';
import { jelMesh, jelMeshSize, FEELS } from './jelly';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
const auto = preview || params.has('auto');
/** a bench: one thing to try over and over (`?bench=jelly`) */
const benchName = params.get('bench');
const STORE = 'squishy:v1';

const canvas = document.getElementById('play') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })!;
if (!gl) throw new Error('WebGL2 is needed');
if (preview) document.body.classList.add('preview');
const $ = (id: string) => document.getElementById(id)!;

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ─── shaders ────────────────────────────────────────────────────────────────────────────────────
/** the kitchen: a morning window, warm walls, the counter's wood; and the output transfer */
const COMMON = `
uniform vec3 uKey, uKeyCol, uWin;
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
  return mix(vec3(.27, .185, .115), vec3(.47, .44, .40), smoothstep(-.65, .85, n.y))
    + vec3(.19, .16, .115) * max(dot(n, uWin), 0.);
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
vec3 tonemap(vec3 x) {
  x *= .7;
  x = (x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14);
  return pow(clamp(x, 0., 1.), vec3(1. / 2.2));
}
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

const SKY_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); vUV = p * .5 + .5; gl_Position = vec4(p, .999, 1.); }`;
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform mat4 uInvVP;
${COMMON}
void main() {
  vec4 w = uInvVP * vec4(vUV * 2. - 1., 1., 1.);
  vec3 d = normalize(w.xyz / w.w);
  o = vec4(tonemap(env(d)) + (hash3(vec3(gl_FragCoord.xy, 0.)) - .5) / 255., 1.);
}`;
const SHADOW_VS = `#version 300 es
in vec3 aPos;
uniform mat4 uLightVP, uModel;
void main() { gl_Position = uLightVP * uModel * vec4(aPos, 1.); }`;
const SHADOW_FS = `#version 300 es
precision highp float;
out vec4 o;
void main() { o = vec4(1.); }`;

const VS = `#version 300 es
in vec3 aPos;
in vec3 aNor;
in float aMat;
in vec2 aUV;
uniform mat4 uVP, uModel, uLightVP;
uniform float uMatOver;
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
  vMat = uMatOver >= 0. ? uMatOver : aMat;
  vShadow = uLightVP * w;
  gl_Position = uVP * w;
}`;
/** the course's things: bamboo, weave, porcelain, lacquer, mango pudding, a tin, a jar, a board, gold, chopsticks, tiles */
const FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNor;
in vec2 vUV;
in vec4 vShadow;
flat in float vMat;
out vec4 o;
uniform vec3 uEye, uTint;
uniform float uTime, uAlpha;
/** the dumpling, seen through what's before it: where it is on the glass (px), how big a hole (px), where it is */
uniform vec3 uHole, uHoleAt;
${COMMON}
${SHADOW_GLSL}
${COAT_GLSL}
void main() {
  // (what stands between the eye and the dumpling dissolves round it, in a soft round hole, so it's never lost behind a loaf)
  // (not what it stands on, or anything lower: only what rises in front of it)
  if (uHole.z > 0. && vWorld.y > uHoleAt.y - .6 && length(vWorld - uEye) < length(uHoleAt - uEye) - ${(3 * 1.6).toFixed(1)}) {
    float k = 1. - smoothstep(uHole.z * .6, uHole.z, length(gl_FragCoord.xy - uHole.xy));
    float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
    if (ign < k * .9) discard;
  }
  vec3 n = normalize(vNor);
  if (!gl_FrontFacing) n = -n;
  vec3 V = normalize(uEye - vWorld);
  int id = int(vMat + .5);
  vec2 uv = vUV;
  vec3 base = vec3(.6); float rough = .6, metal = 0., coat = 0., emit = 0., relief = 0., cavity = 1.;
  if (id == ${MAT.counter}) {
    // Broad maple boards: restrained grain, narrow joints, no noisy zebra striping.
    float strip = floor(vWorld.z / 9.);
    float grain = noise(vec3(vWorld.x * .045, vWorld.z * .65, strip)) * .7
      + noise(vec3(vWorld.x * .12, vWorld.z * 2.8, strip)) * .3;
    float joint = 1. - smoothstep(.018, .065, min(fract(vWorld.z / 9.), 1. - fract(vWorld.z / 9.)));
    base = mix(vec3(.57, .39, .22), vec3(.73, .56, .36), grain) * (.94 + .10 * hash3(vec3(strip, 1., 1.)));
    base *= 1. - joint * .16; relief = grain * .018 - joint * .035; rough = .54 + grain * .12;
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
    base = mix(vec3(.94, .94, .92), vec3(.12, .25, .58), max(band, leaf * .8));
    rough = .23; coat = .65;
    relief = noise(vec3(uv * 22., 3.)) * .008;
  } else if (id == ${MAT.lacquer}) {
    // a lazy Susan: red lacquer, a gold ring and fine gold rays
    float r = length(uv), an = atan(uv.y, uv.x);
    float ring = smoothstep(.83, .85, r) * (1. - smoothstep(.88, .9, r)) + smoothstep(.3, .31, r) * (1. - smoothstep(.33, .34, r));
    float rays = smoothstep(.97, .99, cos(an * 12. + uTime * 0.)) * step(.35, r) * step(r, .8);
    base = mix(vec3(.5, .05, .04), vec3(.95, .72, .32), clamp(ring + rays * .7, 0., 1.));
    metal = (ring + rays) * .7; rough = .2; coat = 1.;
  } else if (id == ${MAT.jelly}) {
    // a mango pudding: deep orange, glowing through, a caramel top
    bool top = n.y > .8;
    base = top ? vec3(.62, .28, .06) : vec3(1., .58, .14);
    rough = .12; coat = 1.;
    emit = top ? .05 : .3;
  } else if (id == ${MAT.pannacotta}) {
    // a panna cotta: cream, soft-lit through, under a berry coulis
    bool top = n.y > .8;
    base = top ? vec3(.5, .04, .1) : vec3(.96, .91, .8);
    rough = top ? .1 : .3; coat = top ? 1. : .4;
    emit = top ? .02 : .22;
  } else if (id == ${MAT.konjac}) {
    // a konjac jelly: clear pink, the light right through it, brightest at its top
    base = mix(vec3(.9, .25, .36), vec3(1., .55, .6), clamp(n.y, 0., 1.));
    rough = .06; coat = 1.;
    emit = .45;
  } else if (id == ${MAT.bread}) {
    // a round loaf: a brown crust, floured on top, scored across, the pale crumb showing in the cuts
    bool top = n.y > .55;
    float crack = noise(vWorld * 1.3) * .5 + noise(vWorld * 4.) * .3;
    base = mix(vec3(.5, .29, .12), vec3(.7, .45, .22), crack);
    if (top) {
      float flour = smoothstep(.3, .7, noise(vWorld * .9 + 3.)) * .6 + .25;
      base = mix(base, vec3(.92, .88, .8), flour);
      float score = min(abs(uv.x - uv.y), abs(uv.x + uv.y)) * 9.;
      base = mix(vec3(.93, .86, .66), base, smoothstep(.15, .45, score));
    }
    rough = .85;
  } else if (id == ${MAT.enamel}) {
    // a bread bin: cream enamel, a navy rim, chipped here and there
    float chip = smoothstep(.9, .92, noise(vWorld * 1.7 + 9.));
    base = mix(vec3(.93, .9, .82), vec3(.08, .1, .2), chip * .55);
    rough = .25; coat = 1.;
  } else if (id == ${MAT.steel}) {
    // brushed stainless steel: fine lines along it, a cool grey
    float brush = noise(vec3(vWorld.x * .25, vWorld.z * 40., vWorld.y * 40.)) * .5 + noise(vec3(vWorld.x * 2., vWorld.z * 90., 3.)) * .2;
    base = vec3(.6, .62, .64) * (.85 + .25 * brush); metal = .9; rough = .28 + .1 * brush;
  } else if (id == ${MAT.sponge}) {
    // a sponge: yellow and full of holes, a green scourer on its top
    bool top = n.y > .6;
    float pore = smoothstep(.55, .62, noise(vWorld * 2.6));
    base = top ? vec3(.16, .42, .2) * (.8 + .3 * noise(vWorld * 5.)) : vec3(.96, .8, .26) * (1. - .45 * pore);
    rough = 1.;
  } else if (id == ${MAT.bubble}) {
    // a soap bubble: clear, a film of colours swirling over it, bright where it catches the light
    float film = fract(dot(n, vec3(1.3, 2.1, .7)) * 1.4 + noise(vWorld * 1.2) * .6);
    vec3 hue = .5 + .5 * cos(6.2832 * (film + vec3(0., .33, .67)));
    base = mix(vec3(.92, .94, .97), hue, .35); rough = .03; coat = 1.; emit = .25;
  } else if (id == ${MAT.water}) {
    // the water in the sink: grey-blue, a little cloudy with soap
    base = vec3(.16, .23, .27) * (.9 + .2 * noise(vec3(vWorld.xz * .2, uTime * .3))); rough = .04; coat = 1.;
  } else if (id == ${MAT.tin}) {
    // Printed tea tins: repeating cream blossoms and restrained gold rules.
    float b = fract(uv.y / 9.);
    vec3 paint = b < .45 ? vec3(.48, .095, .075) : vec3(.055, .27, .245);
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
    float g = noise(vec3(uv.x * .1, uv.y * 2.4, 4.)) * .6 + noise(vec3(uv.x * .5, uv.y * 7., 1.)) * .25;
    float cut = smoothstep(.985, 1., noise(vec3(uv.x * 9., uv.y * .4, 7.)));
    base = mix(vec3(.72, .55, .36), vec3(.88, .74, .54), g) * (1. - .25 * cut);
    relief = g * .025 - cut * .018; rough = .64;
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
    vec2 q = uv / 12., f = fract(q);
    float edge = min(min(f.x, 1. - f.x), min(f.y, 1. - f.y));
    float tile = smoothstep(.014, .035, edge);
    float bevel = smoothstep(.014, .065, edge);
    base = mix(vec3(.37, .34, .28), vec3(.72, .73, .66) * (.95 + .07 * hash3(vec3(floor(q), 2.))), tile);
    relief = bevel * .09; rough = mix(.88, .27, tile); coat = tile * .45;
  } else if (id == ${MAT.butter}) {
    // butter: pale yellow, a little waxy, a knife's cut across it and a fold of its paper's mark
    float cut = smoothstep(.975, 1., noise(vec3(uv.x * .6, uv.y * 7., 9.)));
    base = vec3(.98, .86, .46) * (1. - .12 * cut) * (.96 + .06 * noise(vec3(uv * 1.5, 3.)));
    rough = .32; coat = .6;
  } else if (id == ${MAT.honey}) {
    // honey: deep amber, lit from within; run down a jar's side in drips that thin toward their ends
    float drip = noise(vec3(uv.x * .9, 1., 5.)) * .7 + noise(vec3(uv.x * 3.2, 2., 8.)) * .3;
    float thin = smoothstep(-5., 4., uv.y) * .35 + smoothstep(.5, .9, drip) * .4;
    base = mix(vec3(.72, .34, .05), vec3(.95, .6, .15), thin);
    rough = .06; coat = 1.; emit = .22 + .25 * thin;
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
    base = mix(vec3(.9, .87, .8), vec3(.72, .16, .14), clamp(stripe, 0., 1.)) * (.86 + .1 * weave + .08 * slub) * (1. - .12 * hem);
    relief = weave * .018; rough = .92;
  } else if (id == ${MAT.gingham}) {
    // a folded gingham cloth: red and white, checked, the crossings darkest
    vec2 c = step(.5, fract(uv / 1.3));
    float k = (c.x + c.y) * .5;
    base = mix(vec3(.94, .9, .84), vec3(.66, .12, .12), k) * (.9 + .1 * noise(vec3(uv * 5., 2.)));
    rough = .9;
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
    // butter melted: a glossy yellow film, thicker in the middle of the run, thin and pale at its edges
    float th2 = 1. - abs(uv.y * 2. - 1.);
    base = mix(vec3(.98, .88, .55), vec3(.98, .78, .22), smoothstep(.1, .8, th2));
    rough = .06; coat = 1.; emit = .12 * th2;
  } else if (id >= 25 && id <= 29) {
    // what's on a top: flour on a board, crumbs or pepper on a plate, hundreds and thousands on a pudding, over the top it's on
    int k = id - 24;
    if (k == 1) base = vec3(.8, .64, .44); else if (k == 4 || k == 3) { float r = length(uv); base = mix(vec3(.94, .94, .92), vec3(.12, .25, .58), smoothstep(.78, .8, r) * (1. - smoothstep(.86, .88, r))); rough = .18; coat = 1.; } else { base = vec3(.62, .28, .06); rough = .12; coat = 1.; emit = .05; }
    float gl = 0.;
    float amount = k == 1 ? .55 : k == 3 ? .5 : k == 4 ? .45 : .6;
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
    o = vec4(uTint, uAlpha); return;
  } else if (id == 14) {
    // where it will land: a soft ring
    float r = length(uv);
    float a = smoothstep(.7, .82, r) * (1. - smoothstep(.9, 1., r)) + .18 * (1. - smoothstep(0., .8, r));
    o = vec4(uTint, a * uAlpha); return;
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
  n = reliefNormal(n, vWorld, relief);
  float NoV = max(dot(n, V), 1e-3), NoL = max(dot(n, uKey), 0.);
  float sh = shadow(n);
  float a = rough * rough;
  vec3 F0 = mix(vec3(.04), base, metal);
  vec3 H = normalize(uKey + V);
  vec3 Fk = F0 + (1. - F0) * pow(1. - max(dot(V, H), 0.), 5.);
  vec3 spec = D_ggx(max(dot(n, H), 0.), a) * V_smith(NoV, NoL, a) * Fk * NoL;
  vec3 amb = irradiance(n) * cavity;
  vec3 c = base * (1. - metal) * (1. - Fk) * (amb + uKeyCol * NoL * sh) + uKeyCol * spec * sh;
  vec3 Fr = F0 + (max(vec3(1. - rough), F0) - F0) * pow(1. - NoV, 5.);
  // (the room's window, sharp, only in what's glossy: a rougher surface takes the room's soft light, not a window that isn't where it shows)
  c += Fr * mix(env(reflect(-V, n)), irradiance(n), smoothstep(.05, .4, rough)) * (1. - .6 * rough * (1. - metal));
  c += base * emit * (amb + uKeyCol * .5);
  if (coat > .01) {
    float Fc = (.04 + .96 * pow(1. - NoV, 5.)) * coat;
    c = c * (1. - Fc) + Fc * env(reflect(-V, n)) + coat * uKeyCol * D_ggx(max(dot(n, H), 0.), .08) * V_smith(NoV, NoL, .08) * .04 * NoL * sh;
  }
  float d = length(vWorld - uEye);
  c = mix(c, vec3(.62, .57, .5), smoothstep(250., 900., d) * .6);
  // (glass: seen through, but for its gloss and its edges)
  if (id == ${MAT.glass}) { float Fg = .04 + .96 * pow(1. - NoV, 4.); o = vec4(tonemap(c), clamp(.08 + Fg * .9 + length(spec) * .3, 0., 1.) * uAlpha); return; }
  o = vec4(tonemap(c), 1.);
}`;

/** the dumpling: its skin's particles as they are now, its normals, and where each was in its rest shape */
const DOUGH_VS = `#version 300 es
in vec3 aPos;
in vec3 aNor;
in vec3 aRest;
in vec2 aCoat;
uniform mat4 uVP, uLightVP;
out vec3 vWorld;
out vec3 vNor;
out vec3 vRest;
out vec2 vCoat;
out vec4 vShadow;
void main() {
  vWorld = aPos; vNor = aNor; vRest = aRest; vCoat = aCoat;
  vShadow = uLightVP * vec4(aPos, 1.);
  gl_Position = uVP * vec4(aPos, 1.);
}`;
/**
 * Dough: steamed, thick, a little translucent (light wraps round it and glows through its thin
 * edges), faintly floury, darker in the creases of its pleats; and a face, drawn on its rest
 * shape so it turns and squashes with it: eyes that blink, squeeze shut as it winds up and
 * smile when it's home, a little mouth, pink cheeks.
 */
const DOUGH_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNor;
in vec3 vRest;
in vec2 vCoat;
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
  vec3 base = mix(vec3(.87, .77, .61), vec3(.95, .91, .83), flour * .6) * (1. - .22 * crease);
  base *= 1. - .14 * smoothstep(.2, 1., -h);
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
  vec3 amb = irradiance(n) * (1. - .28 * crease) * (.75 + .25 * smoothstep(-1., .3, n.y));
  vec3 c = base * (amb + uKeyCol * lit);
  float edge = pow(1. - max(dot(n, V), 0.), 2.);
  c += vec3(1., .62, .42) * uKeyCol * .22 * pow(clamp(1. - abs(NoL), 0., 1.), 3.) * sh;
  c += vec3(1., .7, .5) * uKeyCol * .35 * pow(max(dot(V, -uKey), 0.), 3.) * edge;
  // a moist sheen
  vec3 H = normalize(uKey + V);
  float NoV = max(dot(n, V), 1e-3);
  c += uKeyCol * D_ggx(max(dot(n, H), 0.), .3) * V_smith(NoV, max(NoL, 0.), .3) * .05 * max(NoL, 0.) * sh;
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
const JELLY_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNor;
in vec3 vRest;
in vec2 vCoat;
in vec4 vShadow;
out vec4 o;
uniform vec3 uEye;
uniform mat4 uVP;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uBlink, uFace, uR, uPass;
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
    float thick = uR * 2.1 * NoV + .25;
    vec3 rd = refract(-V, n, 1. / 1.4);
    vec4 cp = uVP * vec4(vWorld + rd * (thick + 2.5), 1.);
    vec2 suv = cp.xy / cp.w * .5 + .5;
    // (a little soft, as through jelly: a few taps about it)
    vec3 behind = vec3(0.);
    for (int i = 0; i < 5; i++) {
      float a = float(i) * 2.4;
      behind += texture(uScene, clamp(suv + vec2(cos(a), sin(a)) * px * (i == 0 ? 0. : 2.5), .001, .999)).rgb;
    }
    behind /= 5.;
    vec3 T = exp(-vec3(.025, .15, .095) * thick);
    // the light inside it: the room's, and the window's, wrapped round, pinker the deeper
    float wrap = max((NoL + .6) / 1.6, 0.);
    vec3 inside = PINK * (irradiance(n) * .07 + uKeyCol * wrap * mix(.25, 1., sh) * .09) * (1. - T.g * .5);
    // and glowing through it where the window's behind
    inside += PINK * uKeyCol * .35 * pow(max(dot(-V, uKey), 0.), 3.) * (1. - NoV * .5);
    // (thin at its rim, where the light bounces about inside it: a pinker edge)
    inside += PINK * irradiance(n) * .3 * pow(1. - NoV, 3.);
    vec3 c = behind * T;
    vec3 add = tonemap(inside);
    o = vec4(1. - (1. - c) * (1. - add), 1.);
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
  vec3 gloss = env(R) * F * .45
    + uKeyCol * D_ggx(max(dot(n, H), 0.), .045) * V_smith(max(NoV, 1e-3), max(NoL, 0.), .045) * max(NoL, 0.) * sh * .5
    + uKeyCol * D_ggx(max(dot(n, H), 0.), .25) * V_smith(max(NoV, 1e-3), max(NoL, 0.), .25) * max(NoL, 0.) * sh * .06;
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
const GLITTER_VS = `#version 300 es
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
const GLITTER_FS = `#version 300 es
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
  o = vec4(vCol * vA * (core + star), 1.);
}`;
/** steam and flour: soft points */
const PUFF_VS = `#version 300 es
in vec4 aP;
uniform mat4 uVP;
uniform float uScale;
out float vA;

void main() {
  gl_Position = uVP * vec4(aP.xyz, 1.);
  float s = fract(aP.w);
  vA = floor(aP.w) / 100.;
  gl_PointSize = clamp(uScale * s * 12. / gl_Position.w, 1., 64.);
}`;
const PUFF_FS = `#version 300 es
precision highp float;
in float vA;
out vec4 o;
void main() {
  float r = length(gl_PointCoord - .5) * 2.;
  o = vec4(1., .98, .95, vA * (1. - smoothstep(.2, 1., r)));
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
  // (the skin's attributes in fixed places, so one vertex array serves the dough's and the jelly's drawing)
  if (vs === DOUGH_VS) { gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aNor'); gl.bindAttribLocation(p, 2, 'aRest'); gl.bindAttribLocation(p, 3, 'aCoat'); }
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}
const skyProg = program(SKY_VS, SKY_FS);
const shadowProg = program(SHADOW_VS, SHADOW_FS);
const prog = program(VS, FS);
const doughProg = program(DOUGH_VS, DOUGH_FS);
const jellyProg = program(DOUGH_VS, JELLY_FS);
const glitterProg = program(GLITTER_VS, GLITTER_FS);
const puffProg = program(PUFF_VS, PUFF_FS);
const ul = new Map<string, WebGLUniformLocation | null>();
const u = (p: WebGLProgram, n: string) => {
  const k = `${(p as { __id?: number }).__id ??= Math.random()}:${n}`;
  if (!ul.has(k)) ul.set(k, gl.getUniformLocation(p, n));
  return ul.get(k)!;
};

// ─── meshes on the card ──────────────────────────────────────────────────────────────────────────
interface Mesh { vao: WebGLVertexArrayObject; svao: WebGLVertexArrayObject; buf: WebGLBuffer; count: number }
function upload(verts: number[] | Float32Array, usage: number = gl.STATIC_DRAW): Mesh {
  const data = verts instanceof Float32Array ? verts : new Float32Array(verts);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  const make = (p: WebGLProgram, attrs: Array<[string, number, number]>) => {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [name, size, off] of attrs) {
      const loc = gl.getAttribLocation(p, name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, VSTRIDE * 4, off * 4);
    }
    gl.bindVertexArray(null);
    return vao;
  };
  return { vao: make(prog, [['aPos', 3, 0], ['aNor', 3, 3], ['aMat', 1, 6], ['aUV', 2, 7]]), svao: make(shadowProg, [['aPos', 3, 0]]), buf, count: data.length / VSTRIDE };
}
function drop(m: Mesh | null) {
  if (!m) return;
  gl.deleteBuffer(m.buf); gl.deleteVertexArray(m.vao); gl.deleteVertexArray(m.svao);
}
const SPHERE = upload((() => { const v: number[] = []; sphere(v, 13); return v; })());
const DISC = upload((() => { const v: number[] = []; disc(v, 14); return v; })());
let courseMesh: Mesh | null = null;
/** the jellies, drawn as their tops are each frame: the mesh, and the floats it's filled from */
let jellyMeshes: Array<{ shape: Shape; mesh: Mesh; data: Float32Array }> = [];
function fillJellies() {
  for (const jm of jellyMeshes) {
    const n = jelMesh(jm.shape.jel!, jm.data, jm.shape.mat, jm.shape.dust ? 24 + jm.shape.dust : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, jm.mesh.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, jm.data, 0, n);
    jm.mesh.count = n / VSTRIDE;
  }
}
let glassMesh: Mesh | null = null;
let roomMesh: Mesh | null = null;
/** the lids: each its own mesh about its rest place, drawn where it is now */
let movers: Array<{ shape: LevelMesh['movers'][number]['shape']; mesh: Mesh }> = [];

// ─── the dumpling on the card ────────────────────────────────────────────────────────────────────
/**
 * What it's made of: steamed dough; or, from level 13 (and once you've been there, anywhere), a
 * clear glittery jelly, the squishy toy, kept for later as a treat.
 */
const JELLY_AT = 13;
let jellyOpen = ((): boolean => { try { return localStorage.getItem(STORE + ':jelly') === '1'; } catch { return false; } })();
let skin: Kind = ((): Kind => {
  const want = params.get('skin') ?? (jellyOpen ? (() => { try { return localStorage.getItem(STORE + ':skin'); } catch { return null; } })() : null);
  return want === 'jelly' ? 'jelly' : want === 'dough' ? 'dough' : 'dough';
})();
let body!: Dumpling;
/** on the title, a second dumpling beside the first: the other kind (the jelly, while it's still to come) */
let buddy: Dumpling | null = null;
let buddyPrev = new Float32Array(0);
interface Flakes { n: number; rest: Float32Array; near: Uint16Array; w: Float32Array; nor: Float32Array; data: Float32Array; buf: WebGLBuffer; vao: WebGLVertexArrayObject }
/**
 * A skin on the card: its triangles, its positions and normals as drawn (rewritten each frame),
 * where each was in its rest shape; and, for the jelly, the glitter in it: each flake placed
 * somewhere inside, carried along by the four particles of the skin nearest it.
 */
function skinOnCard(kind: Kind) {
  const d = new Dumpling([0, 0, 0], kind);
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const pos = gl.createBuffer()!, nor = gl.createBuffer()!, rest = gl.createBuffer()!, idx = gl.createBuffer()!, coat = gl.createBuffer()!;
  const bind = (b: WebGLBuffer, loc: number, size = 3) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  };
  gl.bindBuffer(gl.ARRAY_BUFFER, rest);
  gl.bufferData(gl.ARRAY_BUFFER, d.q, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, pos);
  gl.bufferData(gl.ARRAY_BUFFER, d.x.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, nor);
  gl.bufferData(gl.ARRAY_BUFFER, d.x.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, coat);
  gl.bufferData(gl.ARRAY_BUFFER, d.n * 2 * 4, gl.DYNAMIC_DRAW);
  bind(pos, 0); bind(nor, 1); bind(rest, 2); bind(coat, 3, 2);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, d.tris, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  // (and for the shadow map: the same positions)
  const svao = gl.createVertexArray()!;
  gl.bindVertexArray(svao);
  const sloc = gl.getAttribLocation(shadowProg, 'aPos');
  gl.bindBuffer(gl.ARRAY_BUFFER, pos);
  gl.enableVertexAttribArray(sloc);
  gl.vertexAttribPointer(sloc, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
  gl.bindVertexArray(null);
  let flakes: Flakes | null = null;
  if (kind === 'jelly') {
    const r = seeded(hash(7, 0x611));
    const N = preview ? 500 : 1100, q = d.q;
    const fr = new Float32Array(N * 3), near = new Uint16Array(N * 4), w = new Float32Array(N * 4), fn = new Float32Array(N * 3);
    for (let f = 0; f < N; f++) {
      // (anywhere inside, evenly: a point in a box about it, kept if it's within the skin that way)
      for (let tries = 0; tries < 60; tries++) {
        const P = [(r() * 2 - 1) * RADIUS * 1.2, (r() * 2 - 1) * RADIUS * 1.2, (r() * 2 - 1) * RADIUS * 1.2];
        const l = Math.hypot(P[0], P[1], P[2]) || 1;
        let most = -2, edge = 0;
        for (let j = 0; j < d.n; j++) {
          const qx = q[j * 3], qy = q[j * 3 + 1], qz = q[j * 3 + 2], ql = Math.hypot(qx, qy, qz) || 1;
          const c = (qx * P[0] + qy * P[1] + qz * P[2]) / (ql * l);
          if (c > most) { most = c; edge = ql; }
        }
        fr[f * 3] = P[0]; fr[f * 3 + 1] = P[1]; fr[f * 3 + 2] = P[2];
        if (l < edge * 0.9) break;
      }
      const best: Array<[number, number]> = [];
      for (let j = 0; j < d.n; j++) {
        const dd = (q[j * 3] - fr[f * 3]) ** 2 + (q[j * 3 + 1] - fr[f * 3 + 1]) ** 2 + (q[j * 3 + 2] - fr[f * 3 + 2]) ** 2;
        if (best.length < 4 || dd < best[3][0]) { best.push([dd, j]); best.sort((a, b) => a[0] - b[0]); if (best.length > 4) best.pop(); }
      }
      let sw = 0;
      best.forEach(([dd, j], k) => { near[f * 4 + k] = j; w[f * 4 + k] = 1 / (dd + 0.05); sw += w[f * 4 + k]; });
      for (let k = 0; k < 4; k++) w[f * 4 + k] /= sw;
      const nz = r() * 2 - 1, na = r() * Math.PI * 2, nr = Math.sqrt(1 - nz * nz);
      fn[f * 3] = nr * Math.cos(na); fn[f * 3 + 1] = nz; fn[f * 3 + 2] = nr * Math.sin(na);
    }
    // (each flake's own: what colour (silver, pink, lilac), how big)
    const data = new Float32Array(N * 8);
    for (let f = 0; f < N; f++) { data[f * 8 + 6] = r(); data[f * 8 + 7] = 0.05 + 0.05 * r(); }
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    const fvao = gl.createVertexArray()!;
    gl.bindVertexArray(fvao);
    for (const [name, size, off] of [['aPos', 3, 0], ['aNor', 3, 3], ['aK', 2, 6]] as Array<[string, number, number]>) {
      const loc = gl.getAttribLocation(glitterProg, name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 32, off * 4);
    }
    gl.bindVertexArray(null);
    flakes = { n: N, rest: fr, near, w, nor: fn, data, buf, vao: fvao };
  }
  return { kind, vao, svao, pos, nor, coat, coatData: new Float32Array(d.n * 2), count: d.tris.length, normals: new Float32Array(d.x.length), shown: new Float32Array(d.x.length), q: d.q, flakes };
}
const skins = { jelly: skinOnCard('jelly'), dough: skinOnCard('dough') };
/** The skin as drawn: between the solver's last two states, its normals from its triangles; and the glitter carried along. */
let prevX = new Float32Array(0);
function uploadSkin(body: Dumpling, prevX: Float32Array, alpha: number) {
  const g = skins[body.kind];
  const x = body.x, s = g.shown, nrm = g.normals;
  for (let i = 0; i < x.length; i++) s[i] = prevX.length === x.length ? prevX[i] + (x[i] - prevX[i]) * alpha : x[i];
  nrm.fill(0);
  const t = body.tris;
  for (let k = 0; k < t.length; k += 3) {
    const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
    const ux = s[b] - s[a], uy = s[b + 1] - s[a + 1], uz = s[b + 2] - s[a + 2], vx = s[c] - s[a], vy = s[c + 1] - s[a + 1], vz = s[c + 2] - s[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { nrm[i] += nx; nrm[i + 1] += ny; nrm[i + 2] += nz; }
  }
  for (let i = 0; i < nrm.length; i += 3) { const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1; nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l; }
  gl.bindBuffer(gl.ARRAY_BUFFER, g.pos);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, s);
  gl.bindBuffer(gl.ARRAY_BUFFER, g.nor);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, nrm);
  // (and what's on it)
  const cd = g.coatData;
  for (let i = 0; i < body.n; i++) { cd[i * 2] = body.coat[i]; cd[i * 2 + 1] = body.coatKind[i]; }
  gl.bindBuffer(gl.ARRAY_BUFFER, g.coat);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, cd);
  const fl = g.flakes;
  if (!fl) return;
  // (each flake where its four particles would put it, each as if the flake were held to it as it's turned)
  const R = body.R, q = g.q, out = fl.data;
  for (let f = 0; f < fl.n; f++) {
    let px = 0, py = 0, pz = 0;
    for (let k = 0; k < 4; k++) {
      const j = fl.near[f * 4 + k], w = fl.w[f * 4 + k];
      const dx = fl.rest[f * 3] - q[j * 3], dy = fl.rest[f * 3 + 1] - q[j * 3 + 1], dz = fl.rest[f * 3 + 2] - q[j * 3 + 2];
      px += w * (s[j * 3] + R[0] * dx + R[1] * dy + R[2] * dz);
      py += w * (s[j * 3 + 1] + R[3] * dx + R[4] * dy + R[5] * dz);
      pz += w * (s[j * 3 + 2] + R[6] * dx + R[7] * dy + R[8] * dz);
    }
    const nx = fl.nor[f * 3], ny = fl.nor[f * 3 + 1], nz = fl.nor[f * 3 + 2];
    out[f * 8] = px; out[f * 8 + 1] = py; out[f * 8 + 2] = pz;
    out[f * 8 + 3] = R[0] * nx + R[1] * ny + R[2] * nz; out[f * 8 + 4] = R[3] * nx + R[4] * ny + R[5] * nz; out[f * 8 + 5] = R[6] * nx + R[7] * ny + R[8] * nz;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, fl.buf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, out);
}

// ─── the game ────────────────────────────────────────────────────────────────────────────────────
let levelN = Math.max(1, Number(params.get('level')) || (() => { try { return Number(localStorage.getItem(STORE + ':level')) || 1; } catch { return 1; } })());
let lv!: Level;
/** the tower last stood on (where a fall comes back to), falls, the clock, home (the time, or not yet) */
let check = 0;
let falls = 0;
let clock = 0;
let home = -1;
let still = 0;
/** fallen: when it comes back */
let fallenAt = -1;
let simTime = 0;
/** each lid's lift last step (for the steam as one starts up); whether it was stuck to honey; when the autopilot last looked */
let lidWas: number[] = [];
let heldWas = false;
let aimedAt = -9;
/** what it was last coated with most, and which coatings it's been told about */
let coatWas: Dust = DUST.none;
const coatSaid = new Set<Dust>();
/**
 * The jelly bench's panel: which jelly, and how it gives (how fast it springs back, how much of
 * each wobble it keeps, how heavy, how far a dent spreads), changed as it's tried; and a drop onto
 * it from so high, to see it again.
 */
let benchPick = 1, benchDrop = 25;
function benchPanel() {
  if (benchName !== 'jelly' && benchName !== 'coats') return;
  const jellyBench = benchName === 'jelly';
  let el = document.getElementById('bench');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bench';
    document.body.appendChild(el);
    const st = document.createElement('style');
    st.textContent = `#bench { position: fixed; left: 8px; right: 8px; top: calc(max(12px, env(safe-area-inset-top)) + 44px); padding: 8px 10px; border-radius: 12px; background: rgba(30,22,14,.55); color: #fff; font: 12px/1.3 system-ui, sans-serif; display: grid; gap: 4px; z-index: 5; max-width: 420px; margin: 0 auto; }
      #bench .tabs { display: flex; gap: 6px; } #bench .tabs button, #bench .go { flex: 1; padding: 6px 4px; border-radius: 8px; border: 1px solid rgba(255,255,255,.4); background: transparent; color: #fff; font: inherit; }
      #bench .tabs button.on { background: rgba(255,255,255,.85); color: #3a2a18; }
      #bench label { display: grid; grid-template-columns: 70px 1fr 44px; align-items: center; gap: 6px; } #bench input { width: 100%; }
      #bench .go { background: rgba(255,255,255,.85); color: #3a2a18; }`;
    document.head.appendChild(st);
  }
  const names = jellyBench ? ['panna cotta', 'mango pudding', 'konjac'] : ['flour', 'crumbs', 'pepper', 'sprinkles', 'butter'];
  benchPick = Math.min(benchPick, names.length - 1);
  const jl = jellyBench ? lv.jellies![benchPick].jel! : { feel: { hz: 0, zeta: 0, mass: 0, spread: 0 } };
  type Row = [keyof typeof jl.feel | 'drop', string, number, number, number];
  const feelRows: Row[] = [['hz', 'spring Hz', 1, 14, 0.1], ['zeta', 'damping', 0, 0.6, 0.005], ['mass', 'mass', 2, 40, 0.5], ['spread', 'spread Hz', 0, 14, 0.1]];
  const rows: Row[] = [...(jellyBench ? feelRows : []), ['drop', 'drop cm', 5, 80, 1]];
  el.innerHTML = `<div class="tabs">${names.map((n, i) => `<button data-i="${i}" class="${i === benchPick ? 'on' : ''}">${n}</button>`).join('')}</div>`
    + rows.map(([k, label, lo, hi, step]) => `<label>${label}<input type="range" data-k="${k}" min="${lo}" max="${hi}" step="${step}" value="${k === 'drop' ? benchDrop : jl.feel[k]}"><span>${(k === 'drop' ? benchDrop : jl.feel[k]).toFixed(step < 0.01 ? 3 : step < 1 ? 1 : 0)}</span></label>`).join('')
    + `<button class="go">drop it on the ${names[benchPick]}</button>`;
  el.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.addEventListener('click', () => { benchPick = Number(b.dataset.i); benchPanel(); }));
  el.querySelectorAll<HTMLInputElement>('input').forEach((inp) => inp.addEventListener('input', () => {
    const k = inp.dataset.k as keyof typeof jl.feel | 'drop', v = Number(inp.value);
    if (k === 'drop') benchDrop = v; else jl.feel[k] = v;
    inp.nextElementSibling!.textContent = v.toFixed(Number(inp.step) < 0.01 ? 3 : Number(inp.step) < 1 ? 1 : 0);
  }));
  el.querySelector('.go')!.addEventListener('click', () => {
    const t = lv.towers[benchPick + 1];
    body.place([t.at[0], t.at[1] + REST_H + benchDrop, t.at[2]], camYaw + Math.PI);
    prevX = new Float32Array(body.x);
  });
}
function startLevel(n: number, quiet = false) {
  levelN = Math.max(1, n);
  if (levelN >= JELLY_AT && !jellyOpen) {
    jellyOpen = true;
    try { localStorage.setItem(STORE + ':jelly', '1'); } catch { /* */ }
    if (!params.has('skin')) skin = 'jelly';
    showSkin();
  }
  lv = benchName ? bench(benchName) : buildLevel(levelN);
  drop(courseMesh); drop(glassMesh);
  for (const m of movers) drop(m.mesh);
  for (const jm of jellyMeshes) drop(jm.mesh);
  jellyMeshes = (lv.jellies ?? []).map((shape) => { const data = new Float32Array(jelMeshSize(shape.jel!, shape.dust)); return { shape, data, mesh: upload(data, gl.DYNAMIC_DRAW) }; });
  const lm = levelMesh(lv);
  courseMesh = upload(lm.solid);
  glassMesh = lm.glass.length ? upload(lm.glass) : null;
  movers = lm.movers.map((m) => ({ shape: m.shape, mesh: upload(m.verts) }));
  lidWas = movers.map(() => -1);
  drop(roomMesh);
  roomMesh = upload(room(lv));
  const at = lv.towers[0].at;
  // (set down a little above, to drop on: on a lid, its knob is under it)
  body = new Dumpling([at[0], at[1] + REST_H + 2, at[2]], skin);
  prevX = new Float32Array(body.x);
  check = 0; falls = 0; clock = 0; home = -1; still = 0; fallenAt = -1;
  camYaw = lv.walls?.length ? wallYaw(lv.towers[1].at[0] - at[0]) : Math.atan2(lv.towers[1].at[0] - at[0], lv.towers[1].at[2] - at[2]);
  camTarget = [at[0], at[1] + 4, at[2]];
  steamSeed = 0;
  puffs.length = 0;
  ahead = 0;
  // (a level's first time: the way over it, from home back to the start; not when it's started over)
  fly = -1;
  if (!quiet && !benchName && !preview && flown !== levelN && lv.towers.length > 1) { fly = 0; flyFor = Math.max(3, Math.min(6, 1.6 + 0.35 * lv.towers.length)); }
  flown = levelN;
  if (quiet) return;
  try { if (!auto && !benchName) localStorage.setItem(STORE + ':level', String(levelN)); } catch { /* */ }
  if (!auto && !benchName) history.replaceState(null, '', `?level=${levelN}`);
  showHands();
  showTitle();
  if (benchName) { hint(benchName === 'jelly' ? 'land on each: a panna cotta, a mango pudding, a konjac jelly. tune them above' : 'flour, crumbs, pepper, sprinkles, butter: land hard on each, and look', 7000); benchPanel(); return; }
  hint(levelN === 1 ? 'take hold of the dumpling, drag back and let go: it flies the other way. drag anywhere else to look round' : levelN === 2 ? 'tap the dumpling to poke it: it rolls away from your finger' : levelN === CHAPTER_AT.counter ? 'a shelf no flick reaches: land against the towel under it, and climb' : levelN === CHAPTER_AT.sink ? 'bubbles bounce; steel slips; the water\'s a fall' : levelN === CHAPTER_AT.stove ? 'the stovetop. butter slides; a pan has a rim' : levelN === CHAPTER_AT.stove + 1 ? 'honey: land against the jar, and you stick. flick to let go' : levelN === CHAPTER_AT.stove + 2 ? 'a pot\'s lid rattles on the steam: it jolts you' : levelN === JELLY_AT ? 'a treat: it\'s jelly from here' : `level ${levelN}`);
}
/** The kitchen about the course: tiled walls on all sides, with windows, a little way off. */
function room(lv: Level): number[] {
  const out: number[] = [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = 0;
  for (const t of lv.towers) { x0 = Math.min(x0, t.at[0]); x1 = Math.max(x1, t.at[0]); z0 = Math.min(z0, t.at[2]); z1 = Math.max(z1, t.at[2]); top = Math.max(top, t.at[1]); }
  // (round a table, the room is nearer, and its floor is far below)
  const m = lv.chapter === 'table' ? 150 : 220, g = lv.ground;
  x0 -= m; x1 += m; z0 -= m; z1 += m;
  const H = top + 260 - g;
  const wall = (a: V3, b: V3, n: V3) => {
    const d = sub(b, a), L = Math.hypot(d[0], d[2]), t = mul(d, 1 / L);
    const P = (s: number, y: number): V3 => add(add(a, mul(t, s)), [0, y, 0]);
    const q = (A: V3, B: V3, C: V3, D: V3, mat: number, ua: [number, number], ub: [number, number], uc: [number, number], ud: [number, number]) => {
      for (const [p, uv] of [[A, ua], [B, ub], [C, uc], [A, ua], [C, uc], [D, ud]] as Array<[V3, [number, number]]>) out.push(p[0], p[1], p[2], n[0], n[1], n[2], mat, uv[0], uv[1]);
    };
    q(P(0, 0), P(0, H), P(L, H), P(L, 0), MAT.tiles, [0, 0], [0, H], [L, H], [L, 0]);
    // windows, every so far, their panes a little in front
    // (their sills a little above the counter, or the table)
    const w0 = lv.chapter === 'table' ? 85 : 60, w1 = w0 + 140;
    for (let s = 120; s + 90 < L - 60; s += 260) {
      const o = mul(n, 0.5);
      q(add(P(s, w0), o), add(P(s, w1), o), add(P(s + 90, w1), o), add(P(s + 90, w0), o), 12, [0, 0], [0, 1], [1, 1], [1, 0]);
    }
  };
  wall([x0, g, z0], [x1, g, z0], [0, 0, 1]);
  wall([x1, g, z0], [x1, g, z1], [-1, 0, 0]);
  wall([x1, g, z1], [x0, g, z1], [0, 0, -1]);
  wall([x0, g, z1], [x0, g, z0], [1, 0, 0]);
  // the counter (or the floor, under a table), to the walls
  const n: V3 = [0, 1, 0];
  const floor = lv.floorMat ?? (lv.chapter === 'counter' || lv.chapter === 'table' ? MAT.counter : MAT.hob);
  for (const [p, uv] of [[[x0, g, z0], [x0, z0]], [[x0, g, z1], [x0, z1]], [[x1, g, z1], [x1, z1]], [[x0, g, z0], [x0, z0]], [[x1, g, z1], [x1, z1]], [[x1, g, z0], [x1, z0]]] as Array<[V3, [number, number]]>) out.push(p[0], p[1], p[2], n[0], n[1], n[2], floor, uv[0], uv[1]);
  return out;
}

// ─── aiming and the flick ────────────────────────────────────────────────────────────────────────
/** the pull: where the finger went down and where it is (and where it's been, lately); what it would do */
let pull: { down: number; sx: number; sy: number; x: number; y: number; id: number; hist: Array<{ x: number; y: number; t: number }>; at: V3 } | null = null;
/** a finger on the glass but not on the dumpling: turning the camera round; and whether you've turned it (then it stays as you left it, until the next flick) */
let look: { id: number; x: number; y: number } | null = null;
let userCam = false;
let aimNow: { yaw: number; power: number; vel: V3; climb?: V3 } | null = null;
/** a flick asked for in the air: done on landing, if soon */
let buffered: { vel: V3; spin: number; until: number; climb?: V3 } | null = null;
function aimAt(x: number, y: number): typeof aimNow {
  if (!pull) return null;
  const dx = x - pull.sx, dy = y - pull.sy;
  const L = Math.hypot(dx, dy);
  if (L < 14) return null;
  const fwd: V3 = [Math.sin(camYaw), 0, Math.cos(camYaw)];
  const right: V3 = [-fwd[2], 0, fwd[0]];
  const d = norm(sub(mul(fwd, dy), mul(right, dx)));
  const yaw = Math.atan2(d[0], d[2]);
  const power = Math.min(1, (L - 14) / (0.3 * Math.min(innerWidth, innerHeight)));
  // (clinging to a wall, and aimed into it: a climb, up it and over its top)
  const n = body.clinging ? body.wallN : null;
  if (n && d[0] * n[0] + d[2] * n[2] < -0.35) return { yaw, power, vel: climbLaunch(power), climb: n };
  return { yaw, power, vel: launch(yaw, power) };
}
function aimFromPull() { aimNow = pull ? aimAt(pull.x, pull.y) : null; }
/**
 * Let go. A finger lifted still flicks as aimed. A finger swiped as it lets go gives spin: swiped
 * on, the way it will fly, topspin (it runs on when it lands); swiped back, backspin (it bites).
 * The aim is taken from before the swipe, so the swipe doesn't change where it goes.
 */
function release() {
  if (!pull) return;
  const now = performance.now();
  const h = pull.hist;
  let old = h[h.length - 1];
  for (let i = h.length - 1; i >= 0; i--) { old = h[i]; if (now - h[i].t > 90) break; }
  const dt = Math.max(0.03, (now - old.t) / 1000);
  const vx = (pull.x - old.x) / dt, vy = (pull.y - old.y) / dt;
  let a = aimAt(pull.x, pull.y), spin = 0;
  if (Math.hypot(vx, vy) > 400) {
    // (a swipe: the aim from where it was held; the spin from the swipe along the way it will go)
    const held = aimAt(old.x, old.y);
    const fx = pull.sx - old.x, fy = pull.sy - old.y, fl = Math.hypot(fx, fy) || 1;
    const along = (vx * fx + vy * fy) / fl;
    if (held && Math.abs(along) > 350) { a = held; spin = Math.sign(along) * Math.min(1, (Math.abs(along) - 350) / 1100); }
  }
  pull = null; aimNow = null;
  body.squeeze = null;
  if (!a || a.power < 0.02 || home >= 0 || fallenAt >= 0) return;
  if (body.canFlick) doFlick(a.vel, spin, a.climb);
  else buffered = { vel: a.vel, spin, until: simTime + 0.35, climb: a.climb };
}
function doFlick(vel: V3, spin = 0, climb?: V3) {
  body.flick(vel, climb ? 0 : spin, climb ?? null);
  userCam = false;
  buffered = null;
  pop(0.4 + len(vel) / 500);
  if (Math.abs(spin) > 0.1) hint(spin > 0 ? 'topspin: it runs on' : 'backspin: it bites', 1400);
}

// ─── the camera ──────────────────────────────────────────────────────────────────────────────────
const eye: V3 = [0, 30, -40];
let camTarget: V3 = [0, 20, 0];
let camYaw = 0;
let orbit = { yaw: 0, pitch: 0, at: -9 };
let zoom = 1;
let windEase = 0;
/** how much the camera's drawn back to take in the next top as well (0–1): when it's sat still on a top */
let ahead = 0;
/**
 * The way over a level as it opens: from above home, back along the course, top by top, down to the
 * start (`fly`: how far through it, in seconds; -1 once it's done, or a touch cut it short). Once a
 * level; again, after a fall or a start over, it isn't.
 */
let fly = -1, flyFor = 0, flown = -1;
const ease = (x: number) => x * x * (3 - 2 * x);
function flyCamera(dt: number) {
  fly += dt;
  const T = lv.towers, u = ease(Math.min(1, fly / flyFor));
  // (the course from home back to the start, as a path through its tops)
  const f = (1 - u) * (T.length - 1), i = Math.min(T.length - 2, Math.floor(f)), k = f - i, a = T[i].at, b = T[i + 1].at;
  const p: V3 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k + 3, a[2] + (b[2] - a[2]) * k];
  // (high and far at first, coming down and in to where play begins)
  const pitch = 0.95 - 0.45 * u, dist = 150 - 100 * u;
  const back: V3 = [-Math.sin(camYaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(camYaw) * Math.cos(pitch)];
  const kk = 1 - Math.exp(-dt * 6);
  for (let j = 0; j < 3; j++) camTarget[j] += (p[j] - camTarget[j]) * (fly < dt * 1.5 ? 1 : kk);
  const want = add(camTarget, mul(back, dist));
  for (let j = 0; j < 3; j++) eye[j] += (want[j] - eye[j]) * (fly < dt * 1.5 ? 1 : kk);
  keepOut(eye, camTarget);
  if (fly >= flyFor) fly = -1;
}
function updateCamera(dt: number) {
  if (mode === 'title') { titleCamera(dt); return; }
  if (fly >= 0) { flyCamera(dt); return; }
  // (it follows easily; but if it's got near the edge of the glass, or off it, it catches up at once)
  const on = screenOf(body.com);
  const off = !on || on[0] < innerWidth * 0.12 || on[0] > innerWidth * 0.88 || on[1] < innerHeight * 0.1 || on[1] > innerHeight * 0.82;
  const k = 1 - Math.exp(-dt * (off ? 22 : 5));
  // (sat still on a top, and not home: the camera looks a little toward the next, and stands back far enough to see it too)
  const nxt = lv.towers[Math.min(check + 1, lv.towers.length - 1)];
  const settled = body.contacts > 0 && len(body.vcom) < 8 && home < 0 && !userCam;
  ahead += ((settled ? 1 : 0) - ahead) * (1 - Math.exp(-dt * (settled ? 1.2 : 4)));
  const toNext = sub(nxt.at, body.com), sep = Math.hypot(toNext[0], toNext[2]);
  const want = add(add(body.com, [0, 3, 0]), mul(toNext, 0.5 * ahead * Math.min(1, 110 / Math.max(1, sep))));
  for (let i = 0; i < 3; i++) camTarget[i] += (want[i] - camTarget[i]) * (1 - Math.exp(-dt * (off ? 22 : ahead > 0.01 && ahead < 0.99 ? 3 : 5)));
  // (turned toward the next top, when it's sat still and no one's turning the camera)
  if (!pull && !userCam && body.contacts > 0 && simTime - orbit.at > 2.5 && home < 0) {
    const nx = lv.towers[Math.min(check + 1, lv.towers.length - 1)];
    const wantYaw = lv.walls?.length ? wallYaw(nx.at[0] - body.com[0]) : Math.atan2(nx.at[0] - body.com[0], nx.at[2] - body.com[2]);
    let dy = wantYaw - camYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    camYaw += dy * (1 - Math.exp(-dt * 1.4));
  }
  const wind = aimNow ? aimNow.power : 0;
  windEase += (wind - windEase) * (1 - Math.exp(-dt * 4));
  // (looking down on the counter a little more than across it, so the wall behind doesn't take half the glass)
  const pitch = Math.max(0.12, Math.min(1.2, (lv.walls?.length ? 0.56 : 0.48) + orbit.pitch + 0.22 * windEase));
  const dist = (Math.max(44, Math.min(120, 34 + sep * 0.95) * ahead + 44 * (1 - ahead)) * (1 + 0.55 * windEase)) / zoom;
  const back: V3 = [-Math.sin(camYaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(camYaw) * Math.cos(pitch)];
  // (never behind a wall: if the way out from the dumpling to where it would be meets one, it comes in short of it;
  // and while it's held in, it turns back round to the room's side, against a finger turning it too)
  const { f, n } = boom(camTarget, back, dist);
  if (f < 0.98 && n) {
    const away = Math.atan2(-n[0], -n[2]);
    let dy = away - camYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    camYaw += dy * (1 - Math.exp(-dt * 7 * (1 - f)));
  }
  const wantEye = add(camTarget, mul(back, dist * f));
  for (let i = 0; i < 3; i++) eye[i] += (wantEye[i] - eye[i]) * (1 - Math.exp(-dt * (off ? 20 : 8)));
  keepOut(eye, camTarget);
}
/**
 * Along a counter against a wall, the camera looks at the wall, a little the way the course goes
 * on (dx: how far on the next top is, along the counter): three-quarters on, the wall behind it all,
 * what's ahead to one side and what's climbed face on; not round at the next top, which in a place
 * is as often in the way.
 */
function wallYaw(dx: number): number { return Math.atan2(0.62 * (dx < 0 ? -1 : 1), 0.78); }
/** how near the camera comes to a wall (cm) */
const CAM_R = 4;
/**
 * The way out from `from` along `dir`, so far: how much of it is clear of the room's walls (0–1),
 * and the face of the wall it meets, if it meets one.
 */
function boom(from: V3, dir: V3, dist: number): { f: number; n: V3 | null } {
  const walls = lv.walls ?? [];
  if (!walls.length) return { f: 1, n: null };
  const o = { nx: 0, ny: 0, nz: 0, d: 0, vx: 0, vy: 0, vz: 0 };
  // (from just clear of a wall, if what it's looking at is right up against one)
  from = [...from] as V3;
  for (const w of walls) if (touch(w, from[0], from[1], from[2], CAM_R, o) && o.d > 0) { from[0] += o.nx * o.d; from[1] += o.ny * o.d; from[2] += o.nz * o.d; }
  const steps = Math.ceil(dist / 1.5);
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * dist;
    for (const w of walls) if (touch(w, from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t, CAM_R, o) && o.d > 0) {
      return { f: Math.max(0.05, ((i - 1) / steps)), n: [o.nx, o.ny, o.nz] };
    }
  }
  return { f: 1, n: null };
}
/** The camera, brought in short of any wall between it and what it's looking at (it shouldn't be, but whatever happens: never through one). */
function keepOut(p: V3, from: V3) {
  const d = sub(p, from), L = len(d);
  if (L < 1e-3) return;
  const { f } = boom(from, mul(d, 1 / L), L);
  if (f < 1) for (let i = 0; i < 3; i++) p[i] = from[i] + d[i] * f;
}

// ─── hands ───────────────────────────────────────────────────────────────────────────────────────
const pointers = new Map<number, { x: number; y: number }>();
let two: { d: number; cx: number; cy: number } | null = null;
/**
 * Which bit of the dumpling is under a point on the glass, if any: of its particles near the
 * point (as seen, give or take a fingertip), the one nearest the camera. Its index, or -1.
 */
function pick(x: number, y: number, b: Dumpling = body): number {
  const reach = Math.max(26, 0.12 * Math.min(innerWidth, innerHeight));
  let near = Infinity;
  const sx = new Float32Array(b.n), sy = new Float32Array(b.n), ok = new Uint8Array(b.n);
  for (let i = 0; i < b.n; i++) {
    const s2 = screenOf([b.x[i * 3], b.x[i * 3 + 1], b.x[i * 3 + 2]]);
    if (!s2) continue;
    sx[i] = s2[0]; sy[i] = s2[1]; ok[i] = 1;
    near = Math.min(near, Math.hypot(s2[0] - x, s2[1] - y));
  }
  if (near > reach) return -1;
  // (of those as near as the nearest, give or take, the one on the side facing you)
  let best = -1, bd = Infinity;
  for (let i = 0; i < b.n; i++) {
    if (!ok[i] || Math.hypot(sx[i] - x, sy[i] - y) > near + 14) continue;
    const d = len(sub([b.x[i * 3], b.x[i * 3 + 1], b.x[i * 3 + 2]], eye));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
canvas.addEventListener('pointerdown', (e) => {
  wake();
  if (mode === 'title') { toyDown(e); return; }
  // (the way over the level, cut short by a touch, which goes on to be what it would be: from there, play)
  if (fly >= 0) fly = -1;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1 && !auto) {
    // on the dumpling: take hold of it (a drag is a flick, a tap a poke); anywhere else: the camera
    const i = home < 0 && fallenAt < 0 ? pick(e.clientX, e.clientY) : -1;
    if (i >= 0) {
      pull = { down: e.timeStamp, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, id: e.pointerId, hist: [{ x: e.clientX, y: e.clientY, t: performance.now() }], at: [body.x[i * 3], body.x[i * 3 + 1], body.x[i * 3 + 2]] };
      body.grab = { w: body.hold(i), pull: [0, 0, 0] };
      squish(0.15);
    } else look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  } else { pull = null; aimNow = null; body.squeeze = null; body.grab = null; look = null; two = null; }
});
canvas.addEventListener('pointermove', (e) => {
  if (toy && toy.id === e.pointerId) { toyMove(e); return; }
  const p = pointers.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size >= 2) {
    // two fingers: turn the camera round, tilt it, come close
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    if (two) {
      zoom = Math.max(0.5, Math.min(2.5, zoom * (d / two.d)));
      camYaw -= (cx - two.cx) * 0.008;
      orbit.pitch = Math.max(-0.3, Math.min(0.7, orbit.pitch + (cy - two.cy) * 0.004));
      orbit.at = simTime; userCam = true;
    }
    two = { d, cx, cy };
    return;
  }
  if (look && look.id === e.pointerId) {
    // one finger off the dumpling: round it, and up and down
    camYaw -= (e.clientX - look.x) * 0.009;
    orbit.pitch = Math.max(-0.3, Math.min(0.75, orbit.pitch + (e.clientY - look.y) * 0.004));
    orbit.at = simTime; userCam = true;
    look.x = e.clientX; look.y = e.clientY;
  }
  if (pull && pull.id === e.pointerId) {
    pull.x = e.clientX; pull.y = e.clientY;
    pull.hist.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (pull.hist.length > 24) pull.hist.shift();
  }
});
const up = (e: PointerEvent) => {
  if (toy && toy.id === e.pointerId) { toyUp(e); return; }
  pointers.delete(e.pointerId);
  if (pointers.size < 2) two = null;
  if (look && look.id === e.pointerId) look = null;
  if (pull && pull.id === e.pointerId) {
    // (a tap on it, not a pull: a poke, where it was touched, the way the finger was going into the glass)
    const moved = Math.hypot(pull.x - pull.sx, pull.y - pull.sy);
    body.grab = null;
    if (e.type === 'pointerup' && moved < 12 && e.timeStamp - pull.down < 300 && two === null) { pokeAt(pull.at); pull = null; aimNow = null; body.squeeze = null; }
    else if (e.type === 'pointerup') release(); else { pull = null; aimNow = null; body.squeeze = null; }
  }
};
// ─── on the title: the two of them to squish and stretch, where they sit ───────────────────────────
/** the one held on the title: by which finger, where it went down and is now, when, and the bit of it touched */
let toy: { b: Dumpling; id: number; sx: number; sy: number; x: number; y: number; t0: number; at: V3 } | null = null;
/** when either was last touched on the title (they don't hop about while you're playing with them) */
let toyAt = -9;
function toyDown(e: PointerEvent) {
  if (toy) return;
  // (whichever is under the finger, the nearer if both)
  let best: { b: Dumpling; i: number; d: number } | null = null;
  for (const b of [body, buddy]) {
    if (!b) continue;
    const i = pick(e.clientX, e.clientY, b);
    if (i < 0) continue;
    const at = screenOf([b.x[i * 3], b.x[i * 3 + 1], b.x[i * 3 + 2]])!;
    const d = Math.hypot(at[0] - e.clientX, at[1] - e.clientY);
    if (!best || d < best.d) best = { b, i, d };
  }
  if (!best) return;
  canvas.setPointerCapture(e.pointerId);
  const { b, i } = best;
  toy = { b, id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, t0: e.timeStamp, at: [b.x[i * 3], b.x[i * 3 + 1], b.x[i * 3 + 2]] };
  b.grab = { w: b.hold(i), pull: [0, 0, 0] };
  toyAt = simTime;
  squish(0.15);
}
/** Stretched: the held bit drawn after the finger, across the glass at its depth, so far and no further. */
function toyMove(e: PointerEvent) {
  if (!toy || !toy.b.grab) return;
  toy.x = e.clientX; toy.y = e.clientY;
  const fwd = norm(sub(camTarget, eye)), right = norm(cross(fwd, [0, 1, 0])), upv = cross(right, fwd);
  const px = (len(sub(toy.at, eye)) * 2 * Math.tan(0.45)) / innerHeight;
  let d = add(mul(right, (toy.x - toy.sx) * px), mul(upv, (toy.sy - toy.y) * px));
  const L = len(d);
  if (L > TOY_REACH) d = mul(d, TOY_REACH / L);
  toy.b.grab.pull = d;
  toyAt = simTime;
}
function toyUp(e: PointerEvent) {
  if (!toy) return;
  const { b } = toy;
  b.grab = null;
  // (a tap: a poke, a dent and a wobble, where it is; no rolling off)
  if (e.type === 'pointerup' && Math.hypot(toy.x - toy.sx, toy.y - toy.sy) < 12 && e.timeStamp - toy.t0 < 300) { b.poke(toy.at, norm(sub(toy.at, eye)), false); pop(0.3); }
  else if (e.type === 'pointerup') squish(0.4);
  toy = null;
  toyAt = simTime;
}
/** how far the title's two can be stretched (cm) */
const TOY_REACH = 6;
/** A poke: at the bit of it touched, along the line from your eye through it. */
function pokeAt(at: V3) {
  if (auto || home >= 0 || fallenAt >= 0 || !body.canFlick) return;
  body.poke(at, norm(sub(at, eye)));
  pop(0.3);
}
/** Where a point is on the glass (pixels), if it's in front of the camera. */
function screenOf(p: V3): [number, number] | null {
  if (!lastVP) return null;
  const m = lastVP;
  const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (cw <= 0) return null;
  return [((cx / cw) * 0.5 + 0.5) * innerWidth, (0.5 - (cy / cw) * 0.5) * innerHeight];
}
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.5, Math.min(2.5, zoom * Math.exp(-e.deltaY * 0.0012))); }, { passive: false });
addEventListener('keydown', (e) => {
  if (mode === 'title') { if (e.key === 'Enter') play(1); return; }
  if (fly >= 0) fly = -1;
  if (e.key === 'ArrowLeft') { camYaw += 0.15; orbit.at = simTime; }
  else if (e.key === 'ArrowRight') { camYaw -= 0.15; orbit.at = simTime; }
  else if (e.key.toLowerCase() === 'r') startLevel(levelN);
});
const btn = (id: string, f: () => void) => $(id).addEventListener('click', (e) => { e.stopPropagation(); wake(); f(); });
btn('again', () => startLevel(levelN));
btn('next', () => startLevel(levelN + 1));
btn('prev', () => startLevel(levelN - 1));
btn('nextw', () => startLevel(levelN + 1));
btn('skin', () => {
  // (jelly ⇄ dough: the new one set down where the old one was)
  skin = skin === 'jelly' ? 'dough' : 'jelly';
  try { localStorage.setItem(STORE + ':skin', skin); } catch { /* */ }
  const at = body.com;
  body = new Dumpling([at[0], at[1] + 0.5, at[2]], skin);
  prevX = new Float32Array(body.x);
  showSkin();
});
function showSkin() { $('skin').textContent = skin; $('skin').style.display = jellyOpen || params.has('skin') ? '' : 'none'; }
showSkin();
function toggleSound() {
  soundOn = !soundOn;
  $('sound').textContent = soundOn ? 'sound on' : 'sound off';
  try { localStorage.setItem(STORE + ':sound', soundOn ? '1' : '0'); } catch { /* */ }
  if (master && ac) master.gain.setTargetAtTime(soundOn ? 1 : 0, ac.currentTime, 0.2);
  showMenu();
}
btn('sound', toggleSound);

// ─── the title: the name, New Game, Continue, Settings; the place behind it, the dumpling and its friend ─────
/** the title or playing; on the title, which way the camera looks (toward the course), the level the settings would start, and which card is up */
let mode: 'title' | 'play' = auto || benchName || params.has('level') || params.has('skin') ? 'play' : 'title';
let titleYaw = 0, pickN = 1, card: 'main' | 'settings' = 'main';
let hopAt = 2.5, hopWho = 0;
const saved = () => { try { return Number(localStorage.getItem(STORE + ':level')) || 0; } catch { return 0; } };
$('logo').innerHTML = logoSVG();
/**
 * The title: the first place laid out behind it, the dumpling sat on the cloth it starts on, and
 * beside it the other kind (the jelly, while it's still to come), both turned to you.
 */
function startTitle() {
  mode = 'title';
  document.body.classList.add('title');
  startLevel(1, true);
  const pad = lv.towers[0].at, nx = lv.towers[1].at;
  titleYaw = Math.atan2(nx[0] - pad[0], nx[2] - pad[2]);
  // (side by side across the view: the dough on the left)
  const right: V3 = [-Math.cos(titleYaw), 0, Math.sin(titleYaw)];
  const y = pad[1] + REST_H + 1.2;
  // (set down already turned to the camera, which looks along titleYaw)
  const face = titleYaw + Math.PI;
  body.place([pad[0] - right[0] * 3.9, y, pad[2] - right[2] * 3.9], face);
  buddy = new Dumpling([0, 0, 0], skin === 'jelly' ? 'dough' : 'jelly');
  buddy.place([pad[0] + right[0] * 4.2, y, pad[2] + right[2] * 4.2], face);
  prevX = new Float32Array(body.x); buddyPrev = new Float32Array(buddy.x);
  seats = [{ b: body, at: [...body.com] as V3, face }, { b: buddy, at: [...buddy.com] as V3, face }];
  toy = null;
  pickN = Math.max(1, saved() || 1);
  hopAt = simTime + 2;
  card = 'main';
  showMenu();
}
/** where the title's two sit: they're kept there, so a stretch or a poke never sends them off */
let seats: Array<{ b: Dumpling; at: V3; face: number; peak?: number }> = [];
/** On the title, each drawn gently back to its seat when it's not held; off the cloth altogether, set back down. */
function keepSeated(dt: number) {
  for (const s of seats) {
    const b = s.b, dx = s.at[0] - b.com[0], dz = s.at[2] - b.com[2];
    // (how hard it's jiggled lately, its skin moving about its middle, for the checks)
    let jig = 0;
    for (let i = 0; i < b.n; i++) jig = Math.max(jig, Math.hypot(b.v[i * 3] - b.vcom[0], b.v[i * 3 + 1] - b.vcom[1], b.v[i * 3 + 2] - b.vcom[2]));
    s.peak = Math.max((s.peak ?? 0) * Math.exp(-dt), jig);
    if (b.com[1] < s.at[1] - 8 || Math.hypot(dx, dz) > 12) { b.place(s.at, s.face); continue; }
    if (b.grab) continue;
    const k = Math.min(1, dt * 2);
    for (let i = 0; i < b.n; i++) { b.x[i * 3] += dx * k; b.x[i * 3 + 2] += dz * k; }
  }
}
/** Off the title, into level n. */
function play(n: number) {
  mode = 'play';
  buddy = null; toy = null; seats = [];
  document.body.classList.remove('title');
  startLevel(n);
}
/** The title's cards as they are: Continue only with somewhere to continue to; the settings' values. */
function showMenu() {
  if (mode !== 'title') return;
  $('main').hidden = card !== 'main';
  $('settings').hidden = card !== 'settings';
  const at = saved();
  const cont = $('cont');
  cont.hidden = at <= 1;
  cont.innerHTML = `Continue<small>level ${at}</small>`;
  $('s-sound').textContent = soundOn ? 'on' : 'off';
  const sk = $('s-skin');
  sk.textContent = jellyOpen ? skin : 'dough';
  sk.classList.toggle('off', !jellyOpen);
  sk.title = jellyOpen ? '' : `the jelly comes at level ${JELLY_AT}`;
  $('s-level').textContent = String(pickN);
  $('s-place').textContent = `${CHAPTER_NAME[chapterOf(pickN)]}${jellyOpen ? '' : ` · jelly from level ${JELLY_AT}`}`;
  $('s-play').textContent = `Play level ${pickN}`;
}
btn('new', () => play(1));
btn('cont', () => play(saved()));
btn('opts', () => { card = 'settings'; showMenu(); });
btn('s-back', () => { card = 'main'; showMenu(); });
btn('s-play', () => play(pickN));
btn('s-sound', toggleSound);
btn('s-prev', () => { pickN = Math.max(1, pickN - 1); showMenu(); });
btn('s-next', () => { pickN = Math.min(24, pickN + 1); showMenu(); });
btn('s-skin', () => {
  if (!jellyOpen) return;
  skin = skin === 'jelly' ? 'dough' : 'jelly';
  try { localStorage.setItem(STORE + ':skin', skin); } catch { /* */ }
  showSkin();
  startTitle();
  card = 'settings';
  showMenu();
});
btn('tomenu', () => startTitle());
/** On the title: the two of them sat there, now and then one hopping, a little, where it is. */
function titleTick(dt: number) {
  body.step(lv, dt, simTime);
  buddy?.step(lv, dt, simTime);
  keepSeated(dt);
  simTime += dt;
  // (left alone a while, now and then one hops)
  if (simTime - toyAt < 8) hopAt = Math.max(hopAt, simTime + 2);
  if (simTime > hopAt) {
    const b = hopWho++ % 2 === 0 ? buddy : body;
    if (b && b.canFlick) b.flick([0, 90 + 40 * Math.random(), 0]);
    hopAt = simTime + 2.2 + Math.random() * 2.6;
  }
}
/** On the title: from behind the cloth, low, toward the spoon and the bench, swaying a little; the two of them low on the glass, under the name. */
function titleCamera(dt: number) {
  const pad = lv.towers[0].at;
  const yaw = titleYaw + 0.2 * Math.sin(time * 0.13);

  const want: V3 = [pad[0], pad[1] + 8, pad[2]];
  const pitch = 0.22, dist = innerWidth > innerHeight ? 34 : 27;
  const back: V3 = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const k = 1 - Math.exp(-dt * 3);
  for (let i = 0; i < 3; i++) camTarget[i] += (want[i] - camTarget[i]) * k;
  const wantEye = add(want, mul(back, dist));
  for (let i = 0; i < 3; i++) eye[i] += (wantEye[i] - eye[i]) * k;
  camYaw = yaw;
}
function showHands() {
  document.body.classList.toggle('home', home >= 0);
  $('level').textContent = `level ${levelN}`;
}
/** the place's name, as a card when a level starts: spaced capitals, a rule under, fading */
let titleTimer = 0;
function showTitle() {
  const el = $('title');
  el.querySelector('b')!.textContent = benchName ? `the ${benchName} bench` : CHAPTER_NAME[lv.chapter];
  el.querySelector('i')!.textContent = benchName ? 'try it, again and again' : `${levelN}`;
  el.classList.add('on');
  clearTimeout(titleTimer);
  titleTimer = window.setTimeout(() => el.classList.remove('on'), 3200);
}
let hintTimer = 0;
function hint(text: string, ms = 5000) {
  const el = $('hint');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => el.classList.remove('on'), ms);
}

// ─── sound: squish, pop, boing, plop, a chime ────────────────────────────────────────────────────
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let soundOn = (() => { try { return localStorage.getItem(STORE + ':sound') !== '0'; } catch { return true; } })();
$('sound').textContent = soundOn ? 'sound on' : 'sound off';
function wake() {
  if (ac || auto) return;
  try { ac = new AudioContext(); } catch { return; }
  master = ac.createGain();
  master.gain.value = soundOn ? 1 : 0;
  master.connect(ac.destination);
}
/** a soft blop: a sine that drops in pitch, with a little wet noise */
function blop(f0: number, f1: number, dur: number, loud: number) {
  if (!ac || !master) return;
  const t = ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(loud, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
const squish = (k: number) => { blop(260 + 140 * k, 90, 0.16, Math.min(0.35, 0.06 + 0.3 * k)); blop(900, 300, 0.05, Math.min(0.08, 0.04 * k)); };
const pop = (k: number) => blop(380, 900, 0.09, 0.12 * k);
const boing = () => { blop(220, 520, 0.22, 0.2); blop(520, 260, 0.3, 0.08); };
const plop = () => blop(180, 60, 0.4, 0.25);
/** a sneeze: a quick rising breath, then the squeak out */
function sneezeSound() { if (!ac) return; blop(300, 900, 0.14, 0.1); setTimeout(() => blop(1200, 400, 0.18, 0.2), 150); }
/** a lid lifted by steam: a hiss, and its rim rattling on the pot */
function rattle() {
  if (!ac || !master || !soundOn) return;
  const t0 = ac.currentTime;
  for (let i = 0; i < 7; i++) blopAt(t0 + 0.1 + i * 0.09 + Math.random() * 0.03, 1900 + Math.random() * 600, 1200, 0.03, 0.05);
  // (the hiss: noise, shaped)
  const n = ac.createBuffer(1, ac.sampleRate * 0.9, ac.sampleRate), d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ac.createBufferSource(); src.buffer = n;
  const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
  const g = ac.createGain(); g.gain.value = 0.05;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}
function blopAt(at: number, f0: number, f1: number, dur: number, loud: number) {
  if (!ac || !master) return;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  g.gain.setValueAtTime(loud, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(master);
  o.start(at); o.stop(at + dur + 0.02);
}
function chime() { if (!ac) return; [660, 830, 990, 1320].forEach((f, i) => setTimeout(() => blop(f, f * 0.99, 0.5, 0.12), i * 110)); }

// ─── steam and flour ────────────────────────────────────────────────────────────────────────────
interface Puff { p: V3; v: V3; age: number; life: number; size: number; a: number }
const puffs: Puff[] = [];
let steamSeed = 0;
const puffBuf = gl.createBuffer()!;
const puffVao = gl.createVertexArray()!;
gl.bindVertexArray(puffVao);
gl.bindBuffer(gl.ARRAY_BUFFER, puffBuf);
{ const loc = gl.getAttribLocation(puffProg, 'aP'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0); }
gl.bindVertexArray(null);
function updatePuffs(dt: number) {
  // steam from home, always; from the dumpling, when it's home
  const r = seeded(hash(++steamSeed, 7));
  const goal = lv.towers[lv.towers.length - 1];
  const rate = home >= 0 ? 3 : 1;
  for (let i = 0; i < rate; i++) {
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * goal.r * 0.8;
    puffs.push({ p: [goal.at[0] + Math.cos(a) * rr, goal.at[1] + 1, goal.at[2] + Math.sin(a) * rr], v: [(r() - 0.5) * 4, 10 + r() * 8, (r() - 0.5) * 4], age: 0, life: 2.5 + r() * 1.5, size: 3 + r() * 3, a: 0.16 });
  }
  for (const p of puffs) {
    p.age += dt;
    p.v[0] += Math.sin(p.age * 2 + p.size) * dt * 3;
    p.v[1] *= 1 - dt * 0.3;
    p.p = add(p.p, mul(p.v, dt));
    p.size += dt * 4;
  }
  for (let i = puffs.length - 1; i >= 0; i--) if (puffs[i].age > puffs[i].life) puffs.splice(i, 1);
}
function flourPuff(at: V3, k: number) {
  const r = seeded(hash(Math.floor(simTime * 1000), 3));
  for (let i = 0; i < 6 + 10 * k; i++) {
    const a = r() * Math.PI * 2;
    puffs.push({ p: [at[0] + Math.cos(a) * RADIUS, at[1] - RADIUS * 0.4, at[2] + Math.sin(a) * RADIUS], v: [Math.cos(a) * (10 + 30 * k * r()), 4 + 10 * r(), Math.sin(a) * (10 + 30 * k * r())], age: 0, life: 0.6 + r() * 0.5, size: 1 + r(), a: 0.4 });
  }
}

/** A sneeze's pepper: a few dark-ish puffs, thrown out in front. */
function pepperPuff(at: V3) {
  const rr = seeded(hash(Math.floor(simTime * 1000), 9));
  for (let i = 0; i < 10; i++) { const a = rr() * Math.PI * 2; puffs.push({ p: [at[0], at[1], at[2]], v: [Math.cos(a) * 30 * rr(), 20 + 30 * rr(), Math.sin(a) * 30 * rr()], age: 0, life: 0.5 + rr() * 0.4, size: 0.6 + rr() * 0.8, a: 0.25 }); }
}
/** Crumbs (or sugar) shaken off: a scatter of small bright bits. */
function crumbPuff(at: V3) {
  const rr = seeded(hash(Math.floor(simTime * 1000), 11));
  for (let i = 0; i < 8; i++) { const a = rr() * Math.PI * 2; puffs.push({ p: [at[0] + Math.cos(a) * RADIUS, at[1] - RADIUS * 0.3, at[2] + Math.sin(a) * RADIUS], v: [Math.cos(a) * (20 + 30 * rr()), 10 + 20 * rr(), Math.sin(a) * (20 + 30 * rr())], age: 0, life: 0.4 + rr() * 0.3, size: 0.5 + rr() * 0.5, a: 0.4 }); }
}
/** Steam out from under a lid as it lifts: from all round the pot's rim, up and out. */
function steamOut(at: V3, r: number, n = 26) {
  const rr = seeded(hash(Math.floor(simTime * 1000), 5));
  for (let i = 0; i < n; i++) {
    const a = rr() * Math.PI * 2;
    puffs.push({ p: [at[0] + Math.cos(a) * r, at[1] + 0.5, at[2] + Math.sin(a) * r], v: [Math.cos(a) * (8 + 14 * rr()), 14 + 18 * rr(), Math.sin(a) * (8 + 14 * rr())], age: 0, life: 1 + rr() * 0.8, size: 1.5 + 1.5 * rr(), a: 0.35 });
  }
}

// ─── drawing ─────────────────────────────────────────────────────────────────────────────────────
const KEY = norm([0.55, 0.75, 0.38]);
const WIN = norm([0.62, 0.32, 0.5]);
const KEY_COL: V3 = [2.1, 1.95, 1.72];
let dpr = 1;
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2) * (preview ? 0.6 : 1);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
addEventListener('resize', resize);
const SHADOW = preview ? 1024 : 2048;
const shadowTex = gl.createTexture()!;
gl.bindTexture(gl.TEXTURE_2D, shadowTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW, SHADOW, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
const shadowFb = gl.createFramebuffer()!;
gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
gl.drawBuffers([gl.NONE]);
gl.readBuffer(gl.NONE);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
const skyVao = gl.createVertexArray()!;
const I4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const model = (at: V3, s: number) => new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, at[0], at[1], at[2], 1]);
/** a flat thing lying on a surface: its disc turned to the normal there */
function flatOn(at: V3, n: V3, s: number): Float32Array {
  const t = norm(Math.abs(n[1]) > 0.9 ? cross([1, 0, 0], n) : cross([0, 1, 0], n));
  const b = cross(n, t);
  return new Float32Array([t[0] * s, t[1] * s, t[2] * s, 0, n[0] * s, n[1] * s, n[2] * s, 0, b[0] * s, b[1] * s, b[2] * s, 0, at[0], at[1], at[2], 1]);
}
function lightUniforms(p: WebGLProgram) {
  gl.uniform3fv(u(p, 'uKey'), KEY);
  gl.uniform3fv(u(p, 'uKeyCol'), KEY_COL);
  gl.uniform3fv(u(p, 'uWin'), WIN);
}
function drawMesh(m: Mesh, M: Float32Array = I4, mat = -1) {
  gl.uniformMatrix4fv(u(prog, 'uModel'), false, M);
  gl.uniform1f(u(prog, 'uMatOver'), mat);
  gl.bindVertexArray(m.vao);
  gl.drawArrays(gl.TRIANGLES, 0, m.count);
}

/** A copy of what's been drawn so far (the room, the course), for the jelly to be seen through. */
const sceneTex = gl.createTexture()!;
let sceneW = 0, sceneH = 0;
function sceneCopy(W: number, H: number) {
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  if (W !== sceneW || H !== sceneH) {
    sceneW = W; sceneH = H;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, W, H, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  }
  gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, W, H);
  gl.activeTexture(gl.TEXTURE0);
}

let last = performance.now();
let time = 0;
let lag = 0;
/** blinking: when the next one is, and how far through one it is */
let blinkAt = 2;
function frame(now: number) {
  // (a frame's time can be from before the page's own start, in a page opened behind another: never backwards)
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  time += dt;
  resize();
  // the dumpling, in fixed steps
  lag = Math.min(lag + dt, 0.1);
  while (lag >= 1 / 60) {
    lag -= 1 / 60;
    prevX = new Float32Array(body.x);
    if (buddy) buddyPrev = new Float32Array(buddy.x);
    tick(1 / 60);
  }
  updateCamera(dt);
  updatePuffs(dt);
  // sat still: it turns to look at you (winding up, it looks where it's going)
  body.look = aimNow ? norm([aimNow.vel[0], 0, aimNow.vel[2]]) : norm([eye[0] - body.com[0], 0, eye[2] - body.com[2]]);
  if (buddy) buddy.look = norm([eye[0] - buddy.com[0], 0, eye[2] - buddy.com[2]]);
  // winding up: squeezed along the way it would go
  aimFromPull();
  body.squeeze = aimNow && body.canFlick ? { d: norm(aimNow.vel), k: aimNow.power * 0.6 } : null;
  // (held: the dough under the finger drawn back the way it's pulled, as far as it's pulled, a few centimetres at most)
  if (body.grab && mode === 'play') {
    // (a climb is pulled down, to go up)
    const d = !aimNow ? ([0, 0, 0] as V3) : aimNow.climb ? ([0, -1, 0] as V3) : norm([-aimNow.vel[0], 0, -aimNow.vel[2]]);
    const k = aimNow ? 0.8 + 2.6 * aimNow.power : 0;
    body.grab.pull = aimNow?.climb ? [0, -k, 0] : [d[0] * k, 0.25 * k, d[2] * k];
  }

  const W = canvas.width, H = canvas.height;
  const fwd = norm(sub(camTarget, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const upv = cross(right, fwd);
  const vp = viewProj(eye, fwd, right, upv, 0.9, W / H, 1, 3000);
  lastVP = vp;
  const span = 70;
  const lightVP = ortho(body.com, KEY, span, 500);
  const shadowSoft = (500 * 0.08) / ((2 * span) / SHADOW);
  // (the bodies to draw: the dumpling, and on the title its friend; the dough first, so the jelly sees it through itself)
  const drawn = [body, ...(buddy ? [buddy] : [])].sort((a, b) => (a.kind === 'dough' ? 0 : 1) - (b.kind === 'dough' ? 0 : 1));
  for (const b of drawn) uploadSkin(b, b === body ? prevX : buddyPrev, Math.max(0, Math.min(1, lag * 60)));

  // 1. the window's shadow map
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
  gl.viewport(0, 0, SHADOW, SHADOW);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(shadowProg);
  gl.uniformMatrix4fv(u(shadowProg, 'uLightVP'), false, lightVP);
  gl.uniformMatrix4fv(u(shadowProg, 'uModel'), false, I4);
  if (courseMesh) { gl.bindVertexArray(courseMesh.svao); gl.drawArrays(gl.TRIANGLES, 0, courseMesh.count); }
  for (const m of movers) { gl.uniformMatrix4fv(u(shadowProg, 'uModel'), false, model([0, m.shape.c[1] - m.shape.lift!.y0, 0], 1)); gl.bindVertexArray(m.mesh.svao); gl.drawArrays(gl.TRIANGLES, 0, m.mesh.count); }
  gl.uniformMatrix4fv(u(shadowProg, 'uModel'), false, I4);
  fillJellies();
  for (const jm of jellyMeshes) { gl.bindVertexArray(jm.mesh.svao); gl.drawArrays(gl.TRIANGLES, 0, jm.mesh.count); }
  for (const b of drawn) { const sk = skins[b.kind]; gl.bindVertexArray(sk.svao); gl.drawElements(gl.TRIANGLES, sk.count, gl.UNSIGNED_SHORT, 0); }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // 2. the room beyond
  gl.viewport(0, 0, W, H);
  gl.clearColor(0.6, 0.55, 0.48, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(skyProg);
  lightUniforms(skyProg);
  gl.uniformMatrix4fv(u(skyProg, 'uInvVP'), false, invert(vp));
  gl.bindVertexArray(skyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // 3. the kitchen and the course
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(prog);
  lightUniforms(prog);
  gl.uniformMatrix4fv(u(prog, 'uVP'), false, vp);
  gl.uniformMatrix4fv(u(prog, 'uLightVP'), false, lightVP);
  gl.uniform3fv(u(prog, 'uEye'), eye);
  gl.uniform1f(u(prog, 'uTime'), simTime);
  gl.uniform1f(u(prog, 'uShadowSoft'), shadowSoft);
  gl.uniform1i(u(prog, 'uShadowMap'), 0);
  gl.uniform1f(u(prog, 'uAlpha'), 1);
  gl.uniform3fv(u(prog, 'uTint'), [1, 1, 1]);
  // (the hole through what stands before the dumpling: where it is on the glass, in the canvas's pixels, and how big it looks)
  const hc = mode === 'play' && fly < 0 ? screenOf(body.com) : null, he = hc && screenOf(add(body.com, mul(right, RADIUS)));
  const dpr = W / innerWidth;
  gl.uniform3fv(u(prog, 'uHole'), hc && he ? [hc[0] * dpr, (innerHeight - hc[1]) * dpr, Math.max(40 * dpr, Math.hypot(he[0] - hc[0], he[1] - hc[1]) * 2.1 * dpr)] : [0, 0, 0]);
  gl.uniform3fv(u(prog, 'uHoleAt'), body.com);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  if (roomMesh) drawMesh(roomMesh);
  // (the lazy Susans turn: drawn turned by their time)
  if (courseMesh) drawMesh(courseMesh);
  drawSusans();
  // (the lids, where the steam has them)
  for (const m of movers) drawMesh(m.mesh, model([0, m.shape.c[1] - m.shape.lift!.y0, 0], 1));
  // (the jellies, as their tops are)
  for (const jm of jellyMeshes) drawMesh(jm.mesh);
  // the dark under the dumpling
  gl.uniform3fv(u(prog, 'uHole'), [0, 0, 0]);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  for (const b of drawn) {
    const ground = groundUnder(b.com);
    if (!ground) continue;
    const lift = Math.max(0, b.com[1] - ground.p[1] - REST_H);
    gl.uniform1f(u(prog, 'uAlpha'), Math.max(0, 1 - lift / 40));
    drawMesh(DISC, flatOn(add(ground.p, mul(ground.n, 0.05)), ground.n, RADIUS * (1.3 + lift * 0.04)), 15);
  }
  // the aiming line: dots along where its middle will go, a ring where it lands
  if (aimNow) {
    const pa = path(lv, body.com, aimNow.vel, 3, simTime, aimNow.climb ?? null);
    const can = body.canFlick;
    gl.uniform3fv(u(prog, 'uTint'), can ? [1, 0.97, 0.88] : [1, 0.6, 0.5]);
    pa.pts.forEach((p, i) => {
      gl.uniform1f(u(prog, 'uAlpha'), (can ? 0.95 : 0.5) * (1 - (i / pa.pts.length) * 0.5));
      drawMesh(SPHERE, model(p, 0.55 + 0.25 * aimNow!.power), 13);
    });
    if (pa.hit) {
      const lands = towerAt(lv, pa.hit.p, 0.5);
      gl.uniform3fv(u(prog, 'uTint'), lands > check ? [0.6, 1, 0.65] : lands >= 0 ? [1, 0.97, 0.88] : [1, 0.5, 0.45]);
      gl.uniform1f(u(prog, 'uAlpha'), 0.95);
      const n = pa.hit.n;
      drawMesh(DISC, flatOn(add(sub(pa.hit.p, mul(n, RADIUS * 0.8)), mul(n, 0.08)), n, RADIUS * 1.4), 14);
    }
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);

  // (the jelly's light: where the window's light comes through it to the ground, focused, pink)
  for (const b of drawn) if (b.kind === 'jelly') {
    const lit = groundAlong(b.com, mul(KEY, -1));
    if (lit) {
      const far = len(sub(lit.p, b.com));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.uniform1f(u(prog, 'uAlpha'), 0.42 * Math.max(0, 1 - far / 90));
      drawMesh(DISC, flatOn(add(lit.p, mul(lit.n, 0.06)), lit.n, RADIUS * (1.25 + far * 0.012)), 16);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  // 4. the dumpling (and on the title, its friend)
  if (time > blinkAt + 0.14) blinkAt = time + 2 + Math.random() * 3;
  const blinkOf = (at: number) => (time > at && time < at + 0.14 ? Math.sin(((time - at) / 0.14) * Math.PI) : 0);
  for (const body of drawn) {
  const hero = body === drawn.find((b) => b !== buddy);
  const blink = hero ? blinkOf(blinkAt) : blinkOf(blinkAt + 1.3);
  // (its face: squeezed shut winding up, an o in the air, a smile at home; and it blinks)
  const face = mode === 'title' ? (body.grab ? 1 : body.contacts === 0 || body.sinceFlick < 0.6 ? 3 : 0) : !hero ? (body.contacts === 0 ? 3 : 0) : home >= 0 ? 2 : aimNow ? 1 : body.contacts === 0 && body.sinceFlick < 2 ? 3 : 0;
  const sk = skins[body.kind];
  const skinUniforms = (p: WebGLProgram) => {
    gl.useProgram(p);
    lightUniforms(p);
    gl.uniformMatrix4fv(u(p, 'uVP'), false, vp);
    gl.uniformMatrix4fv(u(p, 'uLightVP'), false, lightVP);
    gl.uniform3fv(u(p, 'uEye'), eye);
    gl.uniform1f(u(p, 'uShadowSoft'), shadowSoft);
    gl.uniform1i(u(p, 'uShadowMap'), 0);
    gl.uniform1f(u(p, 'uR'), RADIUS);
    gl.uniform1f(u(p, 'uFace'), face);
    gl.uniform1f(u(p, 'uBlink'), blink);
  };
  gl.bindVertexArray(sk.vao);
  if (body.kind === 'dough') {
    skinUniforms(doughProg);
    gl.drawElements(gl.TRIANGLES, sk.count, gl.UNSIGNED_SHORT, 0);
  } else {
    // what's behind it, to see through it
    sceneCopy(W, H);
    skinUniforms(jellyProg);
    gl.uniform1i(u(jellyProg, 'uScene'), 1);
    gl.uniform2f(u(jellyProg, 'uRes'), W, H);
    gl.uniform1f(u(jellyProg, 'uPass'), 0);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, sk.count, gl.UNSIGNED_SHORT, 0);
    // the glitter in it
    const fl = sk.flakes!;
    gl.useProgram(glitterProg);
    lightUniforms(glitterProg);
    gl.uniformMatrix4fv(u(glitterProg, 'uVP'), false, vp);
    gl.uniform3fv(u(glitterProg, 'uEye'), eye);
    gl.uniform3fv(u(glitterProg, 'uCom'), body.com);
    gl.uniform1f(u(glitterProg, 'uR'), RADIUS);
    gl.uniform1f(u(glitterProg, 'uScale'), H * 0.9);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(fl.vao);
    gl.drawArrays(gl.POINTS, 0, fl.n);
    // and on it: its gloss, its face
    skinUniforms(jellyProg);
    gl.uniform1f(u(jellyProg, 'uPass'), 1);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(true);
    gl.bindVertexArray(sk.vao);
    gl.drawElements(gl.TRIANGLES, sk.count, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
  }

  }

  // (the glass: over everything, seen through)
  if (glassMesh) {
    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.uniform1f(u(prog, 'uAlpha'), 1);
    gl.uniform3fv(u(prog, 'uTint'), [1, 1, 1]);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT); drawMesh(glassMesh);
    gl.cullFace(gl.BACK); drawMesh(glassMesh);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  // 5. steam and flour
  if (puffs.length) {
    const data = new Float32Array(puffs.length * 4);
    puffs.forEach((p, i) => {
      const a = p.a * Math.sin(Math.min(1, p.age / p.life) * Math.PI);
      data.set([p.p[0], p.p[1], p.p[2], Math.floor(a * 100) + Math.min(0.999, p.size / 10)], i * 4);
    });
    gl.useProgram(puffProg);
    gl.uniformMatrix4fv(u(puffProg, 'uVP'), false, vp);
    gl.uniform1f(u(puffProg, 'uScale'), H * 0.9);
    gl.bindBuffer(gl.ARRAY_BUFFER, puffBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(puffVao);
    gl.drawArrays(gl.POINTS, 0, puffs.length);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
  gl.bindVertexArray(null);
  drawBand();
  showStatus();
  (window as unknown as { __squishy: unknown }).__squishy = {
    visualBuild: 'tactile-01',
    level: levelN, towers: lv.towers.length, check, falls, clock, home, fly, ahead: Math.round(ahead * 100) / 100, com: body.com.map((v) => Math.round(v * 10) / 10),
    speed: Math.round(len(body.vcom)), contacts: body.contacts, canFlick: body.canFlick, aiming: !!aimNow, power: aimNow?.power ?? 0,
    volume: Math.round((body.volume() / body.restVolume) * 1000) / 1000, deform: Math.round(body.deform * 1000) / 1000, squeeze: !!body.squeeze,
    eye: eye.map((v) => Math.round(v)), camYaw, pulling: !!pull, mode, chapter: lv.chapter, held: body.held, pinned: body.pinned, spin: body.spinMode, kind: body.kind, coated: body.coated.map((v) => Math.round(v * 1000) / 1000), coatMost: body.coatMost, jellyOpen,
    // (how far its face is turned from you, in degrees; and how upright it is)
    faceOff: Math.round((Math.abs(Math.atan2(body.R[2] * (eye[2] - body.com[2]) - body.R[8] * (eye[0] - body.com[0]), body.R[2] * (eye[0] - body.com[0]) + body.R[8] * (eye[2] - body.com[2]))) * 180) / Math.PI),
    up: Math.round(body.R[4] * 100) / 100,
  };
  requestAnimationFrame(frame);
}
/** The pull on the glass: a band from where the finger went down to where it is, and a ring for how hard. */
const ui = document.getElementById('ui') as HTMLCanvasElement;
const ux = ui.getContext('2d')!;
function drawBand() {
  const w = Math.round(innerWidth * devicePixelRatio), h = Math.round(innerHeight * devicePixelRatio);
  if (ui.width !== w || ui.height !== h) { ui.width = w; ui.height = h; }
  ux.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ux.clearRect(0, 0, innerWidth, innerHeight);
  // (hidden outright when nothing's pulled: a cleared canvas isn't always shown cleared at once)
  const show = pull ? '' : 'none';
  if (ui.style.display !== show) ui.style.display = show;
  if (!pull) return;
  const p = aimNow?.power ?? 0, can = body.canFlick;
  const col = !aimNow ? 'rgba(255,255,255,.5)' : can ? `hsla(${40 - 40 * p}, 95%, ${70 - 15 * p}%, .95)` : 'rgba(255,140,120,.8)';
  ux.lineCap = 'round';
  // (the ring at the start: how far there is to pull, and how far it's pulled)
  const R = 0.3 * Math.min(innerWidth, innerHeight) + 14;
  ux.lineWidth = 2;
  ux.strokeStyle = 'rgba(255,255,255,.35)';
  ux.beginPath(); ux.arc(pull.sx, pull.sy, 14, 0, Math.PI * 2); ux.stroke();
  ux.setLineDash([3, 6]);
  ux.beginPath(); ux.arc(pull.sx, pull.sy, R, 0, Math.PI * 2); ux.stroke();
  ux.setLineDash([]);
  // (the band, thinning as it stretches; a bead at the finger)
  const L = Math.hypot(pull.x - pull.sx, pull.y - pull.sy);
  ux.strokeStyle = col;
  ux.lineWidth = Math.max(2, 9 - L / 30);
  ux.beginPath(); ux.moveTo(pull.sx, pull.sy); ux.lineTo(pull.x, pull.y); ux.stroke();
  ux.fillStyle = col;
  ux.beginPath(); ux.arc(pull.x, pull.y, 9, 0, Math.PI * 2); ux.fill();
  // (and an arrow the other way, the way it will go)
  if (aimNow) {
    const dx = (pull.sx - pull.x) / (L || 1), dy = (pull.sy - pull.y) / (L || 1);
    const ax = pull.sx + dx * (24 + 40 * p), ay = pull.sy + dy * (24 + 40 * p);
    ux.lineWidth = 3;
    ux.beginPath(); ux.moveTo(pull.sx + dx * 18, pull.sy + dy * 18); ux.lineTo(ax, ay);
    ux.lineTo(ax - dx * 10 - dy * 7, ay - dy * 10 + dx * 7); ux.moveTo(ax, ay); ux.lineTo(ax - dx * 10 + dy * 7, ay - dy * 10 - dx * 7); ux.stroke();
  }
}
/** The lazy Susans: their tops drawn turned, as they are. */
const susanMeshes = new Map<object, Mesh>();
function drawSusans() {
  for (const s of lv.shapes) if (s.spin) {
    let m = susanMeshes.get(s);
    if (!m) {
      const v: number[] = [];
      const r = s.r, y = s.c[1] + s.hh + 0.02;
      // (a turning top: its pattern drawn on a thin disc just over it, so it's seen to turn)
      for (let k = 0; k < 48; k++) {
        const a0 = (k / 48) * Math.PI * 2, a1 = ((k + 1) / 48) * Math.PI * 2;
        v.push(0, y, 0, 0, 1, 0, MAT.lacquer, 0, 0);
        v.push(Math.cos(a1) * r, y, Math.sin(a1) * r, 0, 1, 0, MAT.lacquer, Math.cos(a1), Math.sin(a1));
        v.push(Math.cos(a0) * r, y, Math.sin(a0) * r, 0, 1, 0, MAT.lacquer, Math.cos(a0), Math.sin(a0));
      }
      m = upload(v);
      susanMeshes.set(s, m);
    }
    const a = s.spin * simTime, c = Math.cos(a), sn = Math.sin(a);
    drawMesh(m, new Float32Array([c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, s.c[0], 0, s.c[2], 1]));
  }
}
/** What's under a point: the first surface straight down (for the dark under the dumpling). */
const hitTmp = { nx: 0, ny: 0, nz: 0, d: 0, vx: 0, vy: 0, vz: 0 };
function groundUnder(p: V3): { p: V3; n: V3 } | null {
  const col = lv.shapes.filter((s) => p[0] >= s.lo[0] - 0.5 && p[0] <= s.hi[0] + 0.5 && p[2] >= s.lo[2] - 0.5 && p[2] <= s.hi[2] + 0.5 && s.lo[1] < p[1]);
  for (let y = p[1]; y > p[1] - 400; y -= 0.4) for (const s of col) if (touch(s, p[0], y, p[2], 0.05, hitTmp) && hitTmp.d > 0) return { p: [p[0], y - 0.05 + hitTmp.d, p[2]], n: [hitTmp.nx, hitTmp.ny, hitTmp.nz] };
  return null;
}

/** Where a line from a point first meets the course (for where the window's light through the jelly falls). */
function groundAlong(p: V3, d: V3, max = 160): { p: V3; n: V3 } | null {
  const e = add(p, mul(d, max));
  const lo = [Math.min(p[0], e[0]) - 1, Math.min(p[1], e[1]) - 1, Math.min(p[2], e[2]) - 1], hi = [Math.max(p[0], e[0]) + 1, Math.max(p[1], e[1]) + 1, Math.max(p[2], e[2]) + 1];
  const col = lv.shapes.filter((s) => s.lo[0] <= hi[0] && s.hi[0] >= lo[0] && s.lo[1] <= hi[1] && s.hi[1] >= lo[1] && s.lo[2] <= hi[2] && s.hi[2] >= lo[2]);
  for (let t = 0; t < max; t += 0.5) {
    const x = p[0] + d[0] * t, y = p[1] + d[1] * t, z = p[2] + d[2] * t;
    for (const s of col) if (touch(s, x, y, z, 0.05, hitTmp) && hitTmp.d > 0) return { p: [x, y, z], n: [hitTmp.nx, hitTmp.ny, hitTmp.nz] };
  }
  return null;
}

/** A step of the game: the dumpling; where it's stood, falling, home; a flick asked for in the air; the autopilot. */
function tick(dt: number) {
  if (mode === 'title') { titleTick(dt); return; }
  body.step(lv, dt, simTime);
  simTime += dt;
  if (home < 0 && fly < 0) clock += dt;
  if (body.impact > 90) {
    const k = Math.min(1, body.impact / 300);
    squish(k);
    if (body.impact > 140 && (body.kind === 'dough' || body.coated[DUST.flour] > 0.05)) flourPuff(body.com, k * (body.kind === 'dough' ? 1 : 2 * body.coated[DUST.flour]));
    if (lv.shapes.some((s) => s.bounce > 0 && Math.hypot(s.c[0] - body.com[0], s.c[2] - body.com[2]) < s.r + 2) && body.impact > 120) boing();
  }
  if (fallenAt >= 0) {
    if (simTime > fallenAt + 0.7) {
      const at = lv.towers[check].at;
      body.place([at[0], at[1] + REST_H + 2, at[2]]);
      prevX = new Float32Array(body.x);
      fallenAt = -1;
      pop(0.6);
    }
    return;
  }
  // fallen to the counter: back to the last top it stood on
  if (body.com[1] < lv.kill) {
    falls++;
    fallenAt = simTime;
    plop();
    hint('splat. back to the last top', 1800);
    return;
  }
  // the lids: as one starts to rattle, its rattle, and steam out from under it each time it jumps
  movers.forEach((m, i) => {
    const l = m.shape.lift!;
    if (m.shape.r < 2) return;
    const { k, on } = liftAt(l, simTime);
    if (on && lidWas[i] < 0 && len(sub(m.shape.c, body.com)) < 120) rattle();
    if (k > 0.3 && lidWas[i] <= 0.3) steamOut([m.shape.c[0], l.y0 - m.shape.hh, m.shape.c[2]], m.shape.r, 10);
    lidWas[i] = on ? k : -1;
  });
  const k = towerAt(lv, body.com, 1);
  const speed = len(body.vcom);
  if (k >= 0 && body.contacts > 0 && speed < 30) check = k;
  // (sat still: its drift, not its speed, so a quiver on an edge counts as still)
  // (sat still: not drifting, and touching, or only a moment off it, trembling on a jelly)
  const quiet = len(body.drift) < 6 && body.sinceContact < 0.12;
  if (body.held > 1 && !heldWas) hint('stuck. aim into it to climb up and over; aim away to jump off', 2600);
  heldWas = body.held > 1;
  // what it's picked up: a word the first time; a sneeze when it's peppered; what a hard landing shakes off
  if (body.coatMost !== coatWas) {
    const said = ['', 'flour: dry and grippy, and no stick', 'butter: slippery, and honey won\'t hold it', 'crumbs: bouncy', 'pepper...', 'hundreds and thousands: sticky'][body.coatMost];
    if (said && !coatSaid.has(body.coatMost)) { coatSaid.add(body.coatMost); hint(said, 2600); }
    coatWas = body.coatMost;
  }
  if (body.sneezed) { sneezeSound(); hint('achoo!', 1200); pepperPuff(body.com); }
  if (body.shook === DUST.flour) flourPuff(body.com, 0.6);
  else if (body.shook === DUST.crumbs || body.shook === DUST.sprinkles) crumbPuff(body.com);
  still = quiet ? still + dt : 0;
  if (k === lv.towers.length - 1 && still > 0.5 && home < 0) {
    home = clock;
    chime();
    showHands();
    hint(`home! ${clock.toFixed(1)} s${falls ? ` · ${falls} fall${falls > 1 ? 's' : ''}` : ''}`, 9000);
    try { const best = Number(localStorage.getItem(`${STORE}:best:${levelN}`)) || Infinity; if (clock < best) localStorage.setItem(`${STORE}:best:${levelN}`, String(clock)); } catch { /* */ }
  }
  if (buffered && body.canFlick) { if (simTime < buffered.until) doFlick(buffered.vel, buffered.spin, buffered.climb); else buffered = null; }
  // the autopilot (the index's preview, and ?auto): the next top, as the course's own aim has it
  if (auto) {
    if (home >= 0 && still > 2.5) { startLevel(levelN); return; }
    // (from where it's ended up, which may be over a top's edge; and, with no way on from there, a hop to the middle of this top first)
    // (off any top, on the table: from where it is, on to the next after the last it stood on)
    const near = k >= 0 ? k : towerAt(lv, body.com, 4), at = near >= 0 ? near : check;
    if (still > 0.5 && body.canFlick && at >= 0 && at < lv.towers.length - 1 && simTime - aimedAt > 0.2) {
      aimedAt = simTime;
      const a = autoFlick(lv, body.com, at, simTime, body.coated[DUST.butter], body.clinging ? body.wallN : null);
      if (a) doFlick(a.climb ? climbLaunch(a.power) : launch(a.yaw, a.power), 0, a.climb);
    }
  }
}
let statusAt = 0;
function showStatus() {
  if (performance.now() - statusAt < 100) return;
  statusAt = performance.now();
  const t = home >= 0 ? home : clock;
  $('status').textContent = `${check}/${lv.towers.length - 1} · ${t.toFixed(1)} s${falls ? ` · ${falls} fall${falls > 1 ? 's' : ''}` : ''}`;
}

// ─── small maths ─────────────────────────────────────────────────────────────────────────────────
let lastVP: Float32Array | null = null;
function viewProj(e: V3, f: V3, r: V3, up: V3, fov: number, aspect: number, near: number, far: number): Float32Array {
  const z: V3 = [-f[0], -f[1], -f[2]];
  const view = [r[0], up[0], z[0], 0, r[1], up[1], z[1], 0, r[2], up[2], z[2], 0, -dot(r, e), -dot(up, e), -dot(z, e), 1];
  const t = 1 / Math.tan(fov / 2);
  const proj = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  return mat4mul(proj, view);
}
function ortho(c0: V3, dir: V3, span: number, depth: number): Float32Array {
  const f = mul(dir, -1);
  const r = norm(cross(f, [0, 1, 0]));
  const up = cross(r, f);
  // (in whole texels, so the edges don't crawl as it moves)
  const texel = (2 * span) / SHADOW;
  const cr = dot(r, c0), cu = dot(up, c0);
  const c = add(add(c0, mul(r, Math.round(cr / texel) * texel - cr)), mul(up, Math.round(cu / texel) * texel - cu));
  const e = add(c, mul(dir, depth / 2));
  const z: V3 = [-f[0], -f[1], -f[2]];
  const view = [r[0], up[0], z[0], 0, r[1], up[1], z[1], 0, r[2], up[2], z[2], 0, -dot(r, e), -dot(up, e), -dot(z, e), 1];
  const proj = [1 / span, 0, 0, 0, 0, 1 / span, 0, 0, 0, 0, -2 / depth, 0, 0, 0, -1, 1];
  return mat4mul(proj, view);
}
function mat4mul(a: number[] | Float32Array, b: number[] | Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
}
function invert(m: Float32Array): Float32Array {
  const a = Array.from(m), inv = new Array(16).fill(0);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12] || 1;
  return new Float32Array(inv.map((v) => v / det));
}
void lastVP;

(window as unknown as { __squishyTop: (k: number) => string }).__squishyTop = (k: number) => lv.towers[k]?.top;
/** (for the checks: where the dumpling is on the glass, in pixels; and the camera's turn) */
(window as unknown as { __squishyAt: () => unknown }).__squishyAt = () => ({
  at: screenOf(body.com), camYaw, grabbed: !!body.grab,
  // (on the title: where each sits on the glass, how far it's drawn out, and how far it's moved from its seat)
  title: seats.map((s) => {
    let reach = 0;
    for (let i = 0; i < s.b.n; i++) reach = Math.max(reach, Math.hypot(s.b.x[i * 3] - s.b.com[0], s.b.x[i * 3 + 1] - s.b.com[1], s.b.x[i * 3 + 2] - s.b.com[2]));
    return { kind: s.b.kind, at: screenOf(s.b.com), top: screenOf([s.b.com[0], s.b.com[1] + REST_H, s.b.com[2]]), reach, moved: Math.hypot(s.b.com[0] - s.at[0], s.b.com[2] - s.at[2]), held: !!s.b.grab, deform: s.b.deform, peak: s.peak ?? 0 };
  }),
});
// ─── begin ───────────────────────────────────────────────────────────────────────────────────────
if (mode === 'title') startTitle(); else startLevel(levelN);
resize();
requestAnimationFrame(frame);


/**
 * Marble Run: a race down a run of boards that goes on for as long as you build it.
 *
 * Twelve marbles of glass, steel, wood and rubber wait in a row behind a gate at the top of a
 * wide, sloping board; the gate lifts and they go, down board after board of obstacles (pegs,
 * deflectors, splitters, chicanes, spinners, funnels, gates, bumpers, steps, zigzags), bumping
 * and parting, to a chequered line. A chase camera follows yours. Past the line is build mode:
 * three boards on offer (and three more), from the seed and where you are; pick one and the
 * run grows downward. The run is its seed and your choices, in the address, so a run can be
 * shared and is the same run for anyone.
 *
 * The track (`track.ts`) and the solver (`physics.ts`) are pure and tested on their own; the
 * meshes (`mesh.ts`) too. Here is the drawing (WebGL2: the sun's shadow map, materials: painted
 * wood, glass that refracts and glints, steel that mirrors the sky, wood with a grain, rubber
 * that doesn't shine), the camera, the race and the building, and the sounds.
 */
import { hash, seeded } from '../kit/rng';
import { Course, MATERIALS, marble, order, step, type Impact, type Marble, type Material } from './physics';
import { boardMesh, buntingMesh, discMesh, flagMesh, gateMesh, groundMesh, lampMesh, lineMesh, litterMesh, rafterMesh, ringMesh, roomMesh, sphereMesh, spinnerMesh, supportMesh, VSTRIDE } from './mesh';
import { THEMES, matTables, themeById, type Theme } from './theme';
import { FIELD_SIZE, MARBLE_R, TOP, WALL_H, WIDTH, add, build, candidates, cross, decode, dirOf, encode, finish as finishOf, frameAlong, frameAt, len, mul, norm, sub, toLocal, toWorld, type Board, type Frame, type Section, type V3 } from './track';

const params = new URLSearchParams(location.search);
const preview = params.has('preview');
const auto = preview || params.has('auto');
const STORE = 'marbles:v1';
/** where the run is and what it's made of (`theme.ts`): from the address, or as last chosen */
let theme: Theme = themeById(params.get('theme') ?? (() => { try { return localStorage.getItem(STORE + ':theme'); } catch { return null; } })());

const canvas = document.getElementById('run') as HTMLCanvasElement;
// (drawn to our own multisampled buffer, resolved for the glass to look through, then put on the screen)
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })!;
if (!gl) throw new Error('WebGL2 is needed');
if (auto) document.body.classList.add('preview');
(window as unknown as { __gl: WebGL2RenderingContext }).__gl = gl;
const $ = (id: string) => document.getElementById(id)!;

// ─── shaders ────────────────────────────────────────────────────────────────────────────────────
/**
 * what every pass shares: hashes and noise, the key light and the room (all from the theme:
 * `theme.ts`), the lamps, the output transfer
 */
const LIGHT_UNIFORMS = `
uniform vec3 uKey, uKeyCol, uWin, uWinCol, uEnvFloor, uEnvWall, uEnvCeil, uHaze, uLampCol;
uniform float uHazeNear, uNight, uDust;
/** the four nearest lamps: where, and how strong (0: none) */
uniform vec4 uLamps[4];`;
const COMMON = `
float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  float a = hash3(i), b = hash3(i + vec3(1, 0, 0)), c = hash3(i + vec3(0, 1, 0)), d = hash3(i + vec3(1, 1, 0));
  float e = hash3(i + vec3(0, 0, 1)), g = hash3(i + vec3(1, 0, 1)), h = hash3(i + vec3(0, 1, 1)), k = hash3(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float fbm(vec3 p) { return noise(p) * .5 + noise(p * 2.03 + 11.) * .25 + noise(p * 4.07 + 23.) * .125; }
/** the room about the run, by direction: the floor below, the walls around, the ceiling above,
    the window the key light comes in by (broad, so it shows as a shape in the glass), the light itself */
vec3 env(vec3 d) {
  vec3 c = mix(uEnvFloor, uEnvWall, smoothstep(-.35, .45, d.y));
  c = mix(c, uEnvCeil, smoothstep(.45, 1., d.y));
  float w = dot(d, uWin);
  c += uWinCol * (smoothstep(.80, .87, w) + .15 * pow(max(w, 0.), 6.));
  c += uKeyCol * pow(max(dot(d, uKey), 0.), 600.) * 3.;
  return c;
}
/** linear light to the screen: a filmic roll-off, then the display's curve */
vec3 tonemap(vec3 x) {
  x *= .62;
  x = (x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14);
  return pow(clamp(x, 0., 1.), vec3(1. / 2.2));
}
/** the lamps' light on a point: diffuse and a highlight, falling off with distance */
vec3 lamplight(vec3 p, vec3 n, vec3 V, vec3 diffuseCol, vec3 F0, float rough) {
  vec3 acc = vec3(0.);
  for (int i = 0; i < 4; i++) {
    if (uLamps[i].w <= 0.) continue;
    vec3 L = uLamps[i].xyz - p;
    float d2 = max(dot(L, L), 25.);
    L = normalize(L);
    float att = uLamps[i].w * 3200. / d2;
    float ndl = max(dot(n, L), 0.);
    vec3 H = normalize(L + V);
    float a = max(.02, rough * rough);
    float spec = pow(max(dot(n, H), 0.), 2. / (a * a) - 2.) / (a * a) * .012;
    acc += uLampCol * att * (diffuseCol * ndl + F0 * spec * ndl);
  }
  return acc;
}`;
const SHADOW_GLSL = `
/** how soft: penumbra texels per unit of light-space depth between the blocker and the receiver */
uniform float uShadowSoft;
const vec2 PD[12] = vec2[12](vec2(-.326, -.406), vec2(-.840, -.074), vec2(-.696, .457), vec2(-.203, .621), vec2(.962, -.195), vec2(.473, -.480),
  vec2(.519, .767), vec2(.185, -.893), vec2(.507, .064), vec2(.896, .412), vec2(-.322, -.933), vec2(-.792, -.598));
/**
 * The key light's shadow, soft as it is under a broad window: where the blocker is close (the
 * foot of a strip, a marble on the floor) the edge is crisp; further off it spreads. A blocker
 * search finds how far, then a filter that wide, its taps turned per pixel so it never bands.
 */
float shadow(vec3 n) {
  vec3 s = vShadow.xyz / vShadow.w * .5 + .5;
  if (s.x < 0. || s.x > 1. || s.y < 0. || s.y > 1. || s.z > 1.) return 1.;
  float bias = max(.0012 * (1. - dot(n, uKey)), .0004);
  vec2 px = 1. / vec2(textureSize(uShadowMap, 0));
  float a = hash3(vec3(gl_FragCoord.xy, 7.)) * 6.2832;
  mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
  float zb = 0., nb = 0.;
  for (int i = 0; i < 6; i++) {
    float d = texture(uShadowMap, s.xy + rot * PD[i * 2] * px * 14.).r;
    if (d < s.z - bias) { zb += d; nb += 1.; }
  }
  if (nb < .5) return 1.;
  zb /= nb;
  float w = clamp((s.z - zb) * uShadowSoft, 1.2, 16.);
  float lit = 0.;
  for (int i = 0; i < 12; i++) {
    float d = texture(uShadowMap, s.xy + rot * PD[i] * px * w).r;
    lit += s.z - bias > d ? 0. : 1.;
  }
  return lit / 12.;
}`;

/**
 * Depth of field, as a lens has it: in focus at the marble the camera is on, softer nearer and
 * further. Each pixel gathers a disc as wide as its own circle of confusion; a sharp thing in
 * front isn't smeared over by the blur behind it.
 */
const POST_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform sampler2D uColor, uDepth;
uniform vec2 uRes;
uniform float uFocus, uAperture, uMaxR, uNear, uFar;
const vec2 PD[16] = vec2[16](vec2(-.94, -.40), vec2(.95, -.77), vec2(-.09, -.93), vec2(.34, .29), vec2(-.92, .46), vec2(-.38, .03), vec2(.18, -.38), vec2(.71, .22),
  vec2(-.53, -.76), vec2(.45, -.20), vec2(-.21, .72), vec2(.63, .78), vec2(.02, .40), vec2(-.66, .02), vec2(.86, -.31), vec2(-.04, -.14));
float lin(float z) { return 2. * uNear * uFar / (uFar + uNear - (2. * z - 1.) * (uFar - uNear)); }
// (a lens's circle of confusion: the further from the focus, the wider, and less so the further the focus is)
float coc(float d) { return clamp(uAperture * abs(d - uFocus) / max(d, 1.) * clamp(45. / uFocus, .4, 1.5) - .35, 0., uMaxR); }
void main() {
  float dc = lin(texture(uDepth, vUV).r);
  float cc = coc(dc);
  vec3 sum = texture(uColor, vUV).rgb;
  float wsum = 1.;
  if (cc > .6) {
    for (int i = 0; i < 16; i++) {
      vec2 uv = vUV + PD[i] * cc / uRes;
      float ds = lin(texture(uDepth, uv).r);
      float cs = coc(ds);
      // (a nearer, sharper sample only counts as far as its own blur reaches)
      float w = ds < dc ? clamp(cs / cc, 0., 1.) : 1.;
      sum += texture(uColor, uv).rgb * w;
      wsum += w;
    }
  }
  o = vec4(sum / wsum, 1.);
}`;

/** dust in the air: motes drifting in the light, kept in a box about the eye (wrapped, so it is never left) */
const DUST_VS = `#version 300 es
in vec3 aPos;
uniform mat4 uVP;
uniform vec3 uEye;
uniform float uTime, uDust;
out float vA;
void main() {
  float id = aPos.x * 7.1 + aPos.z * 3.3;
  vec3 drift = vec3(sin(uTime * .21 + id) * 6., -uTime * 1.6 + sin(uTime * .17 + id * 2.) * 3., cos(uTime * .19 + id) * 6.);
  vec3 p = mod(aPos + drift - uEye + 150., 300.) - 150. + uEye;
  vec4 c = uVP * vec4(p, 1.);
  gl_Position = c;
  float d = length(p - uEye);
  gl_PointSize = clamp(90. / max(d, 1.), 1., 4.);
  vA = (1. - smoothstep(60., 150., d)) * smoothstep(3., 12., d) * uDust;
}`;
const DUST_FS = `#version 300 es
precision highp float;
in float vA;
out vec4 o;
uniform vec3 uKeyCol;
void main() {
  float r = length(gl_PointCoord - .5) * 2.;
  o = vec4(normalize(uKeyCol + .3) * 1.2, vA * (1. - smoothstep(.3, 1., r)));
}`;

const SKY_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); vUV = p * .5 + .5; gl_Position = vec4(p, .999, 1.); }`;
const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 o;
uniform mat4 uInvVP;
${LIGHT_UNIFORMS}
${COMMON}
void main() {
  // the room by the view ray (beyond the walls: what's seen past the windows)
  vec4 w = uInvVP * vec4(vUV * 2. - 1., 1., 1.);
  vec3 d = normalize(w.xyz / w.w);
  vec3 c = env(d);
  o = vec4(tonemap(c) + (hash3(vec3(gl_FragCoord.xy, 0.)) - .5) / 255., 1.);
}`;

/** the key light's depth, from above */
const SHADOW_VS = `#version 300 es
in vec3 aPos;
uniform mat4 uLightVP;
uniform mat4 uModel;
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
uniform mat3 uNormal;
uniform float uMatOver;
out vec3 vWorld;
out vec3 vNor;
out vec3 vLocal;
out vec2 vUV;
out vec4 vShadow;
flat out float vMat;
void main() {
  vec4 w = uModel * vec4(aPos, 1.);
  vWorld = w.xyz;
  vLocal = aPos;
  vUV = aUV;
  vNor = normalize(uNormal * aNor);
  vMat = uMatOver >= 0. ? uMatOver : aMat;
  vShadow = uLightVP * w;
  gl_Position = uVP * w;
}`;

/**
 * Everything but the marbles. Each material id has, from the theme, a colour, a roughness, a
 * metalness and a style: how its detail is made (paper fibre, corrugation, lacquer with a
 * chart drawn on it, brushed brass, oak grain, leather, planks, stone, glaze). The construction
 * is the mesh's; the theme says what it's made of.
 */
const FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNor;
in vec3 vLocal;
in vec2 vUV;
in vec4 vShadow;
flat in float vMat;
out vec4 o;
uniform sampler2D uShadowMap;
uniform vec3 uEye, uTint;
uniform float uCut, uTime, uGhost, uFar, uGlow;
/** the theme's materials, by id: colour and roughness; metalness, style, detail */
uniform vec4 uCol[24];
uniform vec4 uPar[24];
${LIGHT_UNIFORMS}
${COMMON}
${SHADOW_GLSL}
/**
 * A surface as it was made, at (u, v) in the piece's own centimetres: how much lighter or darker,
 * rougher or smoother, how much gilt, its height (relief, in cm: the normal is bent by it, so
 * light catches fibres, flutes, grain and joints), and whether it wears a clear coat. Fine
 * detail fades as it gets smaller than a pixel, so nothing shimmers in the distance.
 */
struct Surf { float tone; float rough; float gilt; float h; float coat; };
float fade(float px, float freq) { return 1. - smoothstep(.2, .55, px * freq); }
Surf surf(float style, vec2 uv, float k) {
  Surf s = Surf(1., 0., 0., 0., 0.);
  float px = length(fwidth(uv));
  if (style < .5) return s;
  if (style < 1.5) {
    // kraft paper: fibres laid along, darker flecks of recycled fibre, soft dents, the odd stain,
    // and the bands along the sides rubbed smooth where the marbles run
    float f1 = noise(vec3(uv.x * 1.5, uv.y * 24., 0.)), f2 = noise(vec3(uv.x * 6., uv.y * 70., 3.));
    float fine = fade(px, 70.), mid = fade(px, 24.);
    float fleck = smoothstep(.78, .86, noise(vec3(uv * 9., 11.))) * fade(px, 9.);
    float dent = fbm(vec3(uv * .22, 7.));
    float stain = smoothstep(.6, .8, noise(vec3(uv * .06, 19.)));
    float side = smoothstep(2.6, 1.2, 24. - abs(uv.y)) * .5;
    s.tone = (.88 + .22 * f1 * mid + .1 * f2 * fine) * (1. - .35 * fleck) * (.92 + .16 * dent) * (1. - .08 * stain) * (1. - .1 * side);
    s.rough = -.15 * side + .06 * (dent - .5);
    s.h = .012 * f1 * mid + .006 * f2 * fine + .05 * dent - .008 * fleck;
    return s;
  }
  if (style < 2.5) {
    // corrugation: the flutes side by side, the hollows between them in shadow
    float fl = abs(sin(uv.x * 8.5));
    float shape = pow(fl, .55);
    s.tone = mix(.38, 1., shape) * (.9 + .2 * noise(vec3(uv * 6., 4.)) * fade(px, 6.));
    s.h = .14 * shape * fade(px, 2.7);
    s.rough = .05 * (1. - shape);
    return s;
  }
  if (style < 3.5) {
    // lacquer: deep, a soft mottle, a faint orange-peel under a clear coat, the odd fine scratch
    float mot = noise(vec3(uv * .3, 5.));
    float scratch = smoothstep(.93, .97, noise(vec3(uv.x * .4, uv.y * 9., 13.))) * fade(px, 9.);
    s.tone = .9 + .2 * mot + .3 * scratch;
    s.rough = .15 * scratch;
    s.h = .004 * noise(vec3(uv * 3., 1.)) * fade(px, 3.) - .006 * scratch;
    s.coat = 1.;
    return s;
  }
  if (style < 4.5) {
    // brass: brushed along, a little pitting, tarnish in the hollows
    float brush = noise(vec3(uv.x * 40., uv.y * 2., 1.)) * .3 * fade(px, 40.) + noise(vec3(uv.x * 160., uv.y * 4., 2.)) * .15 * fade(px, 160.);
    float tarn = smoothstep(.55, .8, noise(vec3(uv * .8, 9.)));
    float pit = smoothstep(.85, .92, noise(vec3(uv * 12., 4.))) * fade(px, 12.);
    s.tone = (.85 + .3 * brush) * (1. - .25 * tarn) * (1. - .3 * pit);
    s.rough = .15 * tarn + .2 * pit - .05;
    s.h = .006 * brush - .01 * pit;
    return s;
  }
  if (style < 5.5) {
    // oak: growth rings wandering along it, open pores in dashes, ray flecks across
    float wob = fbm(vec3(uv.x * .08, uv.y * .5, 2.)) * 6.;
    float ring = .5 + .5 * sin((uv.y * 2.2 + wob) * 3.1416);
    float pores = smoothstep(.7, .85, noise(vec3(uv.x * 1.2, uv.y * 30., 5.))) * ring * fade(px, 30.);
    float ray = smoothstep(.88, .95, noise(vec3(uv.x * 4., uv.y * .6, 7.))) * fade(px, 4.);
    s.tone = (.72 + .4 * ring) * (1. - .3 * pores) * (1. + .15 * ray);
    s.rough = .08 * pores - .05 * ray;
    s.h = .02 * ring * fade(px, 2.) - .015 * pores;
    return s;
  }
  if (style < 6.5) {
    // leather: a fine pebbled grain, worn paler and smoother on the ridges
    float peb = noise(vec3(uv * 9., 3.)) * .6 * fade(px, 9.) + noise(vec3(uv * 27., 8.)) * .3 * fade(px, 27.);
    float crease = smoothstep(.45, .5, abs(noise(vec3(uv * .7, 2.)) - .5)) * fade(px, 1.);
    s.tone = (.82 + .4 * peb) * (1. - .2 * crease);
    s.rough = -.12 * (peb - .45);
    s.h = .035 * peb - .02 * crease;
    return s;
  }
  if (style < 7.5) {
    // planks: boards of old timber, gaps between, grain, a pair of nails at every board end
    float row = floor(uv.y / 12.), fr = fract(uv.y / 12.);
    float L = 110., x = uv.x + row * 37.;
    float seg = floor(x / L), fx = fract(x / L);
    float gap = smoothstep(0., .04, fr) * smoothstep(1., .96, fr) * smoothstep(0., .006, fx) * smoothstep(1., .994, fx);
    float wob = noise(vec3(uv.x * .05, row * 3., seg));
    float grain = .5 + .5 * sin((fr * 9. + wob * 4. + uv.x * .02) * 3.1416);
    vec2 nl = vec2(min(fx, 1. - fx) * L, abs(fr - .5) * 12.);
    float nail = 1. - smoothstep(.25, .4, length(nl - vec2(2.5, 3.)));
    s.tone = mix(.75, 1.2, grain) * mix(.3, 1., gap) * (.75 + .45 * hash3(vec3(row, seg, 0.))) * (1. - .5 * nail);
    s.rough = .25 * (1. - gap) - .2 * nail;
    s.h = -.35 * (1. - gap) + .02 * grain * fade(px, 1.);
    return s;
  }
  if (style < 8.5) {
    // stone: big flags, their joints recessed, a soft mottle, the odd chip
    vec2 cell = floor(uv / 60.), fr = fract(uv / 60.);
    float joint = smoothstep(0., .02, fr.x) * smoothstep(1., .98, fr.x) * smoothstep(0., .02, fr.y) * smoothstep(1., .98, fr.y);
    float mot = fbm(vec3(uv * .08, cell.x * 3. + cell.y * 7.));
    float grit = noise(vec3(uv * 4., 3.)) * fade(px, 4.);
    s.tone = (.72 + .45 * mot) * mix(.3, 1., joint) * (.85 + .3 * hash3(vec3(cell, 1.))) * (.9 + .15 * grit);
    s.rough = .2 * (1. - joint) - .1 * mot;
    s.h = -.5 * (1. - joint) + .05 * mot + .01 * grit;
    return s;
  }
  if (style < 9.5) {
    // glaze: pooled thicker in the hollows, a crackle through it, under its own gloss
    float pool = noise(vec3(uv * .4, 2.));
    float crack = smoothstep(.47, .5, abs(noise(vec3(uv * 3., 6.)) - .5)) * fade(px, 3.);
    s.tone = .9 + .2 * pool - .25 * crack;
    s.rough = -.1 * pool;
    s.h = .02 * pool - .008 * crack;
    s.coat = 1.;
    return s;
  }
  // a chart on lacquer: fine gold lines, circles and ticks inlaid along the board, under a clear coat
  float mot = noise(vec3(uv * .3, 5.));
  float along = fract(uv.x / 40.), across = uv.y / 24.;
  float line = smoothstep(.012, .0, abs(along - .5)) + smoothstep(.015, .0, abs(across)) * .5;
  vec2 cc = vec2(uv.x - (floor(uv.x / 80.) + .5) * 80., uv.y);
  float ring = smoothstep(.5, .0, abs(length(cc) - 14.)) + smoothstep(.4, .0, abs(length(cc) - 6.)) * .7;
  float ticks = smoothstep(.3, .0, abs(fract(uv.x / 4.) - .5) * 4.) * smoothstep(1.2, .6, abs(abs(uv.y) - 22.));
  float gold = clamp(line + ring * .8 + ticks * .6, 0., 1.) * k;
  s.tone = .9 + .2 * mot;
  s.rough = -.15 * gold;
  s.gilt = gold;
  s.h = .01 * gold + .003 * noise(vec3(uv * 3., 1.)) * fade(px, 3.);
  s.coat = 1.;
  return s;
}
/** the normal bent by a height field, from screen derivatives alone (no tangents needed) */
vec3 bumped(vec3 n, vec3 p, float h) {
  vec3 dpx = dFdx(p), dpy = dFdy(p);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * n - grad);
}
/** GGX: the distribution, the visibility, Schlick's Fresnel */
float D_ggx(float NoH, float a) { float a2 = a * a; float d = NoH * NoH * (a2 - 1.) + 1.; return a2 / (3.1416 * d * d); }
float V_smith(float NoV, float NoL, float a) { float a2 = a * a; return .5 / max(NoL * sqrt(NoV * NoV * (1. - a2) + a2) + NoV * sqrt(NoL * NoL * (1. - a2) + a2), 1e-4); }
void main() {
  // (what stands on the board, right against the camera, is cut away: the chase is never inside a strip)
  bool stands = (vMat > .5 && vMat < 2.5) || (vMat > 6.5 && vMat < 7.5) || (vMat > 10.5 && vMat < 18.5);
  if (stands && uGhost < .5 && length(vWorld - uEye) < uCut) discard;
  vec3 nG = normalize(vNor);
  if (!gl_FrontFacing) nG = -nG;
  vec3 V = normalize(uEye - vWorld);
  int id = int(vMat + .5);
  vec3 base = uCol[id].rgb; float rough = uCol[id].a, metal = uPar[id].x;
  Surf sf = surf(uPar[id].y, vUV, uPar[id].z);
  base *= mix(1., sf.tone, uPar[id].z);
  // (gilt: the chart's lines are gold laid in the lacquer)
  base = mix(base, vec3(.95, .72, .32), sf.gilt);
  metal = mix(metal, .7, sf.gilt);
  rough = clamp(rough + sf.rough * uPar[id].z, .045, 1.);
  vec3 n = uPar[id].w > 0. ? bumped(nG, vWorld, sf.h * uPar[id].w) : nG;
  // ambient occlusion where faces meet: low on anything standing (its v is its height), and the
  // floor along its walls
  float ao = 1.;
  bool upright = abs(dot(nG, normalize(vec3(0., 1., 0.)))) < .6;
  if (upright && (id == 1 || id == 4 || id == 7 || id == 11 || id == 21)) ao = mix(.5, 1., smoothstep(0., 2.4, vUV.y));
  if (id == 0 && abs(vUV.y) < 24.) ao = 1. - .4 * exp(-(24. - abs(vUV.y)) / 1.1);
  if (vMat > 4.5 && vMat < 5.5) {
    // the line: chequered
    float cx = floor(vUV.x / 2.), cz = floor(vUV.y / 2.);
    base = mod(cx + cz, 2.) < .5 ? vec3(.92) : vec3(.05); rough = .5;
  } else if (vMat > 5.5 && vMat < 6.5) {
    // the marker under the marble that's yours
    o = vec4(1., .92, .45, .8); return;
  } else if (vMat > 8.5 && vMat < 9.5) {
    // the dark under a marble, soft, with a little of the marble's colour in it (the light it bends down)
    float r = length(vUV);
    float a = 1. - smoothstep(.25, 1., r);
    o = vec4(uTint * .35 * (1. - smoothstep(.0, .5, r)), .5 * a); return;
  } else if (vMat > 13.5 && vMat < 14.5) {
    // a flag of the bunting: its colour by its hue, paper
    float h = vUV.x * 6.;
    vec3 col = clamp(abs(mod(h + vec3(0., 4., 2.), 6.) - 3.) - 1., 0., 1.);
    base = mix(vec3(.5), col, .85) * .9; rough = .8;
  } else if (vMat > 14.5 && vMat < 15.5) {
    // an enamel shade: its colour outside, cream within (and lit from the bulb, at night)
    base = gl_FrontFacing ? base : mix(vec3(.9, .86, .78), uLampCol * 3., uNight * .6);
  } else if (vMat > 15.5 && vMat < 16.5) {
    // the bulb: it glows when the lamps are lit; a dull glass when not
    o = vec4(tonemap(mix(vec3(.5, .5, .48), uLampCol * 6., uNight)), 1.); return;
  } else if (vMat > 21.5 && vMat < 22.5) {
    // a caustic: the light a marble gathers and lays on the floor in its own shadow, in its colour
    float r2 = dot(vUV, vUV);
    float core = exp(-r2 * 9.) * .9, halo = exp(-r2 * 2.5) * .25;
    float edge = 1. - smoothstep(.75, 1., sqrt(r2));
    vec3 cc = mix(vec3(1.), uTint, .65) * (core + halo) * edge * uGlow;
    o = vec4(cc * .55, 1.); return;
  } else if (vMat > 19.5 && vMat < 20.5) {
    // a window pane: by day the sky and the garden beyond, softly; by night the dark, stars, the moon
    vec2 q = vUV;
    vec3 day = mix(vec3(.75, .85, 1.) * 2.4, vec3(.45, .6, .35) * 1.6, smoothstep(.55, .25, q.y) * (.5 + .5 * noise(vec3(q * 4., 1.))));
    float star = smoothstep(.985, 1., hash3(vec3(floor(q * 60.), 3.))) * 2.;
    float moon = 1. - smoothstep(.06, .075, length(q - vec2(.7, .78)));
    vec3 night = vec3(.06, .09, .18) * (.6 + .6 * q.y) + star + moon * vec3(2.4, 2.5, 2.8);
    o = vec4(tonemap(mix(day, night, uNight)), 1.); return;
  }
  // light: the key light through the window, in or out of shadow; the room from around; the lamps
  float NoV = max(dot(n, V), 1e-3), NoL = max(dot(n, uKey), 0.);
  float sh = shadow(nG);
  float a = rough * rough;
  vec3 F0 = mix(vec3(.04), base, metal);
  vec3 H = normalize(uKey + V);
  float NoH = max(dot(n, H), 0.), VoH = max(dot(V, H), 0.);
  vec3 Fk = F0 + (1. - F0) * pow(1. - VoH, 5.);
  vec3 specK = D_ggx(NoH, a) * V_smith(NoV, NoL, a) * Fk * NoL;
  vec3 kd = (1. - Fk) * (1. - metal);
  // (paper and leather scatter a little light back toward a grazing view: a soft sheen)
  float sheen = (uPar[id].y > .5 && uPar[id].y < 1.5) || (uPar[id].y > 5.5 && uPar[id].y < 6.5) ? .25 * pow(1. - NoV, 3.) : 0.;
  vec3 amb = (env(n) * .55 + env(vec3(0., 1., 0.)) * .12) * ao;
  vec3 c = base * kd * (amb + uKeyCol * NoL * sh) + base * sheen * (uKeyCol * sh * .4 + amb);
  c += uKeyCol * specK * sh;
  // reflections of the room: sharp on the smooth, spread to a glow on the rough
  vec3 R = reflect(-V, n);
  vec3 Fr = F0 + (max(vec3(1. - rough), F0) - F0) * pow(1. - NoV, 5.);
  vec3 envR = mix(env(R), env(n) * .9, smoothstep(.1, .8, rough));
  c += Fr * envR * ao * (1. - .7 * rough * (1. - metal));
  c += lamplight(vWorld, n, V, base * (1. - metal), F0, rough) * mix(1., ao, .5);
  // a clear coat over lacquer and glaze: its own smooth gloss, over the bumps, not following them
  if (sf.coat > .5) {
    float cNoV = max(dot(nG, V), 1e-3), cNoL = max(dot(nG, uKey), 0.), cNoH = max(dot(nG, H), 0.);
    float Fc = .04 + .96 * pow(1. - cNoV, 5.);
    c *= 1. - Fc;
    c += Fc * env(reflect(-V, nG)) + uKeyCol * D_ggx(cNoH, .03) * V_smith(cNoV, cNoL, .03) * .04 * cNoL * sh;
    c += lamplight(vWorld, nG, V, vec3(0.), vec3(.04), .06);
  }
  float d = length(vWorld - uEye);
  c = mix(c, uHaze, smoothstep(uFar * uHazeNear, uFar, d) * .5);
  if (uGhost > .5) { c = mix(c, vec3(1., .95, .7), .5); o = vec4(tonemap(c * .6), .55); return; }
  o = vec4(tonemap(c), 1.);
}`;

/**
 * A marble: glass, seen into. The view refracts in at the surface, crosses the sphere and
 * refracts out, and what it then meets is read from the scene already drawn (the board,
 * magnified and bent, as through a real marble); on the way through, the ribbons and swirls in
 * the glass are marched through in the marble's own space, so they have depth and turn as it
 * rolls; bubbles catch the light; the glass tints what passes by how far it goes; the window,
 * the key light and the lamps lie on the surface.
 */
const GLASS_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in vec3 vNor;
in vec3 vLocal;
in vec4 vShadow;
flat in float vMat;
out vec4 o;
uniform sampler2D uShadowMap, uScene;
uniform vec3 uEye, uTint, uTint2, uCentre;
uniform vec4 uStyle;
uniform float uRadius, uTime;
uniform mat3 uNormal;
uniform mat4 uVP;
uniform vec2 uRes;
${LIGHT_UNIFORMS}
${COMMON}
${SHADOW_GLSL}
// what the glass holds at a point of the unit marble (its own space): a colour, and how dense
vec4 inside(vec3 q) {
  float kind = uStyle.x, sc = uStyle.y, ph = uStyle.z;
  float sw = noise(q * sc + vec3(ph, 0., 0.));
  float sw2 = noise(q * sc * 2.3 + vec3(0., ph * 1.7, 3.1));
  if (kind < .5) {
    // a cat's eye: a twisted ribbon of colour through clear glass
    float rib = smoothstep(.40, .46, sw) * (1. - smoothstep(.54, .60, sw));
    return vec4(mix(uTint, uTint2, smoothstep(.4, .6, sw2)), rib * 7.);
  } else if (kind < 1.5) {
    // two colours swirled through clear glass, in broad veins
    float vein = smoothstep(.3, .45, sw) * (1. - smoothstep(.55, .7, sw));
    return vec4(mix(uTint, uTint2, smoothstep(.42, .58, sw2)), vein * 5.);
  } else if (kind < 2.5) {
    // a haze of one colour, flecked with another
    float fl = smoothstep(.62, .7, noise(q * 16. + vec3(ph)));
    return vec4(mix(uTint, uTint2, fl), 1.2 + fl * 12.);
  }
  // bands wound about an axis, wavering, in clear glass
  float band = fract(q.y * sc * .55 + (sw - .5) * .35 + ph);
  float b = smoothstep(.35, .45, band) * (1. - smoothstep(.55, .65, band));
  return vec4(mix(uTint, uTint2, b), .8 + b * 6.);
}
void main() {
  vec3 n = normalize(vNor);
  vec3 V = normalize(uEye - vWorld);
  vec3 I = -V;
  float R = uRadius;
  float sh = shadow(n);
  // in at the surface, across, and out the far side
  vec3 T1 = refract(I, n, 1. / 1.52);
  vec3 P = vWorld;
  float chord = max(0., -2. * dot(P - uCentre, T1));
  vec3 Q = P + T1 * chord;
  vec3 nq = (Q - uCentre) / R;
  vec3 T2 = refract(T1, -nq, 1.52);
  if (dot(T2, T2) < 1e-6) T2 = reflect(T1, -nq);
  // what's beyond: the exit ray carried on a little, found in the scene already drawn
  vec3 S = Q + T2 * (R * 2.2);
  vec4 cs = uVP * vec4(S, 1.);
  vec2 suv = cs.xy / cs.w * .5 + .5;
  vec2 here = gl_FragCoord.xy / uRes;
  float off = max(max(-suv.x, suv.x - 1.), max(-suv.y, suv.y - 1.));
  suv = mix(suv, here, smoothstep(0., .06, off));
  vec3 behind = pow(texture(uScene, suv).rgb, vec3(2.2)) * 1.15;
  // the inside, marched from where the view goes in to where it comes out, in the marble's own space
  mat3 toMarble = transpose(uNormal);
  vec3 q0 = toMarble * ((P - uCentre) / R);
  vec3 q1 = toMarble * ((Q - uCentre) / R);
  vec3 lit = env(n) * .4 + uKeyCol * max(dot(n, uKey), 0.) * sh * .45 + uKeyCol * .08 + lamplight(vWorld, n, V, vec3(.5), vec3(0.), 1.);
  vec3 col = vec3(0.);
  float T = 1.;
  const int N = 7;
  float stp = chord / R / float(N);
  for (int i = 0; i < N; i++) {
    vec3 q = mix(q0, q1, (float(i) + .5) / float(N));
    vec4 d = inside(q);
    float a = 1. - exp(-d.w * stp);
    // (the colour is in the glass: deeper than it looks on paper)
    col += T * a * pow(d.rgb, vec3(1.7)) * lit;
    T *= 1. - a;
    // a bubble now and then: a bead of light
    vec3 cell = floor(q * 5.);
    if (hash3(cell + 1.7) > .82) {
      vec3 jit = vec3(hash3(cell), hash3(cell + 7.1), hash3(cell + 3.3)) * .7 + .15;
      float bd = length(fract(q * 5.) - jit);
      col += T * vec3(1., .98, .95) * .5 * (1. - smoothstep(.04, .1, bd));
    }
  }
  // the glass tints what comes through by the way it has come
  vec3 absorb = exp(-(vec3(1.) - uTint) * .06 * chord);
  vec3 through = behind * T * absorb;
  // and the room, the key light and the lamps lie on it
  vec3 F = vec3(.04) + .96 * pow(1. - max(dot(n, V), 0.), 5.);
  vec3 refl = env(reflect(I, n));
  vec3 H = normalize(uKey + V);
  float spec = pow(max(dot(n, H), 0.), 700.) * 2.5;
  vec3 c = (1. - F) * (through + col) + F * refl + uKeyCol * spec * sh * .8 + lamplight(vWorld, n, V, vec3(0.), vec3(.04), .08);
  o = vec4(tonemap(c), 1.);
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
const skyProg = program(SKY_VS, SKY_FS);
const dustProg = program(DUST_VS, DUST_FS);
const postProg = program(SKY_VS, POST_FS);
const dustVao = gl.createVertexArray()!;
const DUST_N = 700;
{
  const pts = new Float32Array(DUST_N * 3);
  const r = seeded(0xd057);
  for (let i = 0; i < DUST_N * 3; i++) pts[i] = r() * 300;
  const buf = gl.createBuffer()!;
  gl.bindVertexArray(dustVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, pts, gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(dustProg, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
}
const shadowProg = program(SHADOW_VS, SHADOW_FS);
const prog = program(VS, FS);
const glassProg = program(VS, GLASS_FS);
const u = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);

// ─── meshes on the card ──────────────────────────────────────────────────────────────────────────
interface Mesh { vao: WebGLVertexArrayObject; svao: WebGLVertexArrayObject; gvao: WebGLVertexArrayObject; buf: WebGLBuffer; count: number; dynamic: boolean }
function upload(verts: number[] | Float32Array, dynamic = false, into?: Mesh): Mesh {
  const data = verts instanceof Float32Array ? verts : new Float32Array(verts);
  if (into) {
    gl.bindBuffer(gl.ARRAY_BUFFER, into.buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    into.count = data.length / VSTRIDE;
    return into;
  }
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
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
  const attrs: Array<[string, number, number]> = [['aPos', 3, 0], ['aNor', 3, 3], ['aMat', 1, 6], ['aUV', 2, 7]];
  return { vao: make(prog, attrs), svao: make(shadowProg, [['aPos', 3, 0]]), gvao: make(glassProg, attrs), buf, count: data.length / VSTRIDE, dynamic };
}
function drop(m: Mesh) {
  gl.deleteBuffer(m.buf);
  gl.deleteVertexArray(m.vao);
  gl.deleteVertexArray(m.svao);
  gl.deleteVertexArray(m.gvao);
}

// ─── the run ─────────────────────────────────────────────────────────────────────────────────────
let seed = 0;
let choices: number[] = [];
let sections: Section[] = [];
let course!: Course;
/** each section's mesh, the finish's, the trestles' and the floor's */
const sectionMeshes: Mesh[] = [];
let finishMesh: Mesh | null = null;
const gateMesh_ = upload(new Float32Array(0), true);
let supportMesh_: Mesh | null = null;
/** what hangs overhead (rafters, cords, lamps): drawn, but casting no shadow, or the sun would be shut out */
let overheadMesh_: Mesh | null = null;
let groundMesh_: Mesh | null = null;
let groundY = 0;
let rafterY = 0;
const SPHERE = upload((() => { const v: number[] = []; sphereMesh(v); return v; })());
const RING = upload((() => { const v: number[] = []; ringMesh(v); return v; })());
const DISC = upload((() => { const v: number[] = []; discMesh(v); return v; })());
const barMesh_ = upload(new Float32Array(0), true);
/** building: each board on offer as it would be, and the finish moved on to the end of the one chosen */
const offerMeshes: Mesh[] = [];
let offerFinish: Mesh | null = null;

function meshOf(s: Section): Mesh {
  const v: number[] = [];
  for (const b of s.boards) boardMesh(b, v);
  return upload(v);
}
function rebuildCourse() {
  sections = build(seed, choices);
  course = new Course(sections, TOP);
  while (sectionMeshes.length > sections.length) drop(sectionMeshes.pop()!);
  for (let i = sectionMeshes.length; i < sections.length; i++) sectionMeshes.push(meshOf(sections[i]));
  if (finishMesh) drop(finishMesh);
  const fv: number[] = [];
  boardMesh(course.fin.board, fv);
  lineMesh(course.fin.line, WIDTH, fv);
  finishFlag(course.fin.line, fv);
  finishMesh = upload(fv);
  rebuildScenery();
  save();
}
/** the chequered flag at the line, on the right */
function finishFlag(lf: Frame, out: number[]) { flagMesh(add(add(lf.p, mul(lf.b, WIDTH / 2 + 2)), mul(lf.n, WALL_H)), out); }
/** the lamps' places (the nearest few light the scene, at night) */
let lampAt: V3[] = [];
/**
 * The scenery about the course, by the theme: the floor below, the room about, what holds the
 * boards up, the rafters, the lamps, bunting, flags, litter. Its randomness has its own seed,
 * so the scenery never changes the course, and a change of theme never changes the race.
 */
function rebuildScenery() {
  groundY = course.fin.board.frame.p[1] - 30;
  if (groundMesh_) drop(groundMesh_);
  const gv: number[] = [];
  groundMesh([TOP.p[0], 0, TOP.p[2]], groundY, 4000, gv);
  groundMesh_ = upload(gv);
  if (supportMesh_) drop(supportMesh_);
  const tv: number[] = [];
  const r = seeded(hash(seed, 0xdec0));
  const bounds = { min: [...TOP.p] as V3, max: [...TOP.p] as V3 };
  const allBoards = [...sections.flatMap((s) => s.boards), course.fin.board];
  for (const b of allBoards) for (const a of [0, b.length]) for (const c of [-24, 24]) {
    const q = toWorld(b, a, 0, c);
    for (let i = 0; i < 3; i++) { bounds.min[i] = Math.min(bounds.min[i], q[i]); bounds.max[i] = Math.max(bounds.max[i], q[i]); }
  }
  rafterY = TOP.p[1] + 150;
  const ov: number[] = [];
  rafterMesh(bounds, rafterY, ov);
  roomMesh(bounds, groundY, rafterY, ov);
  for (const b of allBoards) supportMesh(b, groundY, rafterY, r, tv, ov, theme.supports);
  lampAt = [];
  const lamp = (b: Board) => { lampMesh(b, rafterY, ov); const at = toWorld(b, b.length / 2, 0, 0); lampAt.push([at[0], at[1] + 60, at[2]]); };
  sections.forEach((s, i) => {
    const b = s.boards[0];
    if (i % 2 === 1) lamp(b);
    if (i % 3 === 1 && theme.bunting) buntingMesh(b, 10 + r() * (b.length - 20), r, tv);
  });
  lamp(course.fin.board);
  if (overheadMesh_) drop(overheadMesh_);
  overheadMesh_ = upload(ov);
  if (sections.length) { const g = sections[0].boards[0]; for (const sd of [-1, 1]) flagMesh(toWorld(g, 1, WALL_H, sd * (WIDTH / 2 + 2)), tv); }
  if (theme.litter) litterMesh(bounds, groundY, r, tv);
  supportMesh_ = upload(tv);
}
/** A change of theme: the scenery and the materials, the page's colours; the race untouched. */
function setTheme(t: Theme) {
  theme = t;
  try { localStorage.setItem(STORE + ':theme', t.id); } catch { /* */ }
  document.documentElement.style.setProperty('--accent', t.accent);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t.pageColour);
  $('theme').textContent = t.name;
  if (course) rebuildScenery();
  save();
}
function save() {
  if (auto) return;
  try { localStorage.setItem(STORE, JSON.stringify({ seed, choices, mine, follow })); } catch { /* */ }
  history.replaceState(null, '', `?${encode(seed, choices)}${mine ? `&marble=${mine}` : ''}${theme.id !== THEMES[0].id ? `&theme=${theme.id}` : ''}`);
  $('seed').textContent = `run ${seed} · ${sections.length}`;
}

// ─── the marbles ──────────────────────────────────────────────────────────────────────────────────
/** what a marble is called: a roster, like a tournament's */
const NAMES = ['Ash', 'Breeze', 'Comet', 'Crimson', 'Dusk', 'Ember', 'Electro', 'Flint', 'Frost', 'Honey', 'Indigo', 'Jade', 'Juniper', 'Kiwi', 'Lava', 'Lemon', 'Mango', 'Mantis', 'Mint', 'Mochi', 'Nightfall', 'Nova', 'Olive', 'Opal', 'Pebble', 'Pearl', 'Plum', 'Quartz', 'Rose', 'Rusty', 'Sage', 'Sky', 'Storm', 'Sunny', 'Thunder', 'Tide', 'Twister', 'Umber', 'Willow', 'Zest'];
interface Look { name: string; tint: V3; tint2: V3; style: [number, number, number, number]; css: string }
/** hue (turns), saturation, lightness → rgb */
function hsl(h: number, sl: number, l: number): V3 {
  const f = (n: number) => { const k = (n + h * 12) % 12; const a = sl * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}
/**
 * The roster: twelve marbles, all glass and all the same size (so the run and the knocks decide
 * it, not the marble), each its own look from the seed: a cat's eye, a swirl, speckled, banded,
 * in its own colours, with its own name. The same seed is the same roster.
 */
function roster(seedR: number): Look[] {
  const r = seeded(hash(seedR, 0x9a7b));
  const names = [...NAMES];
  const looks: Look[] = [];
  for (let i = 0; i < FIELD_SIZE; i++) {
    const name = names.splice(Math.floor(r() * names.length), 1)[0];
    // (the hues spread round the wheel, so no two are alike)
    const h = (i / FIELD_SIZE + r() * 0.06) % 1;
    const kind = Math.floor(r() * 4);
    const tint = hsl(h, 0.55 + r() * 0.4, kind === 0 ? 0.45 : 0.4 + r() * 0.2);
    const h2 = (h + 0.25 + r() * 0.5) % 1;
    const tint2: V3 = kind === 2 ? (r() < 0.5 ? [0.1, 0.1, 0.12] : [0.95, 0.93, 0.88]) : r() < 0.3 ? [0.96, 0.95, 0.9] : hsl(h2, 0.7, 0.45 + r() * 0.25);
    const css = `rgb(${tint.map((v) => Math.round(v * 255)).join(',')})`;
    looks.push({ name, tint, tint2, style: [kind, 2 + r() * 2.5, r() * 10, 0], css });
  }
  return looks;
}
const LOOKS = roster(1);
const lookOf = new Map(LOOKS.map((l) => [l.name, l]));
let marbles: Marble[] = LOOKS.map((l) => marble(l.name, MATERIALS[0], MARBLE_R, l.tint));
/** yours: the one the camera follows (its name) */
let mine = LOOKS[0].name;
/** the camera: on yours, on the leader, or on the finish (the channel, where they come to rest) */
let follow: 'mine' | 'leader' | 'finish' = 'mine';
const CAMS: Array<typeof follow> = ['mine', 'leader', 'finish'];
let raceTime = 0;
let racing = false;
/** the race: lining up behind the gate (tap a marble to make it yours, tap to go), running, or all in */
let phase: 'lineup' | 'racing' | 'done' = 'lineup';
let impacts: Impact[] = [];
let doneAt = 0;
/** when the first crossed the line (a stuck straggler doesn't hold the result up for ever) */
let firstInAt = -1;
/** the race began from this section (0: the top) */
let fromSection = 0;
/**
 * Everyone to the gate, the gate down. They're already alive: set down by hand (each a hair
 * differently, so no two races are the same), they roll to the gate and settle against it,
 * knocking; go only lifts the gate.
 */
function lineup() {
  fromSection = 0;
  marbles.forEach((m, i) => course.place(m, 0, i));
  raceSeed = auto ? 1 : Math.floor(Math.random() * 1e9);
  scatter();
  course.gateClosed = true;
  raceTime = 0;
  racing = false;
  phase = 'lineup';
  if (follow === 'finish') follow = 'mine';
  mode('race');
  resetNames();
  showFollow();
  hint();
}
function release(from = 0) {
  // (from the top, lined up: just lift the gate; from elsewhere, set them down there and go)
  if (!(from === 0 && phase === 'lineup')) {
    marbles.forEach((m, i) => course.place(m, from, i));
    raceSeed = auto ? 1 : Math.floor(Math.random() * 1e9);
    scatter();
  }
  fromSection = from;
  course.gateClosed = false;
  raceTime = 0;
  racing = true;
  phase = 'racing';
  firstInAt = -1;
  mode('race');
  resetNames();
  hint();
  tick(1.5);
}
function followed(): Marble {
  if (follow === 'leader' || (follow === 'finish' && phase !== 'lineup')) return order(marbles)[0];
  return marbles.find((m) => m.name === mine) ?? marbles[0];
}
/** the board a marble is on (or nearest), and its frame there (a bent board turns as it goes) */
function under(m: Marble): { board: Board; frame: Frame; along: number; across: number } {
  const sec = sections[Math.min(m.sec, sections.length - 1)];
  const boards = m.finished >= 0 || !sec ? [course.fin.board] : sec.boards;
  let board = boards[0], [along, , across] = toLocal(board, m.p);
  if (boards.length > 1 && along > board.length) { board = boards[1]; [along, , across] = toLocal(board, m.p); }
  return { board, frame: frameAlong(board, Math.max(0, Math.min(board.length, along))), along, across };
}
/** Each race its own small differences: where exactly each starts (a hair either way), as a hand would set them. */
let raceSeed = 1;
function scatter() {
  const r = seeded(hash(raceSeed, 0x5ca7));
  for (const m of marbles) {
    const { frame } = under(m);
    m.p = add(add(m.p, mul(frame.b, (r() - 0.5) * 0.8)), mul(frame.t, (r() - 0.5) * 0.6));
  }
}
function choose_(name: string) {
  mine = name;
  follow = 'mine';
  showFollow();
  save();
  tick();
}

// ─── building ─────────────────────────────────────────────────────────────────────────────────────
let page = 0;
let offered: Section[] = [];
let chosen = -1;
function offer(p = page) {
  page = p;
  offered = candidates(seed, sections.length, sections, page);
  while (offerMeshes.length) drop(offerMeshes.pop()!);
  for (const s of offered) offerMeshes.push(meshOf(s));
  $('offers').innerHTML = offered.map((s, i) => `<button class="offer" data-i="${i}">${sketch(s)}<b>${s.name}</b><span>${Math.round(s.drop)} down · ${Math.round(s.length)} long</span></button>`).join('') + `<button id="more">three more</button>`;
  choose(0);
}
/** A board seen from above, as a little drawing for its card: its sides, its strips, pegs and spinners. */
function sketch(s: Section): string {
  const L = s.boards.reduce((a, b) => a + b.length, 0), W = WIDTH;
  const k = 64 / Math.max(L, W * 1.3);
  const w = W * k, h = L * k;
  let y0 = 0;
  const parts: string[] = [];
  for (const b of s.boards) {
    const X = (c: number) => (w / 2 - c * k).toFixed(1), Y = (a: number) => (y0 + a * k).toFixed(1);
    parts.push(`<rect x="0" y="${Y(0)}" width="${w.toFixed(1)}" height="${(b.length * k).toFixed(1)}" rx="1.5" class="bd"/>`);
    for (const wl of b.walls) parts.push(`<line x1="${X(wl.a[1])}" y1="${Y(wl.a[0])}" x2="${X(wl.b[1])}" y2="${Y(wl.b[0])}"/>`);
    for (const [pa, pc, pr] of b.pegs) parts.push(`<circle cx="${X(pc)}" cy="${Y(pa)}" r="${Math.max(0.9, pr * k).toFixed(1)}"/>`);
    for (const sp of b.spinners) parts.push(`<circle cx="${X(sp.at[1])}" cy="${Y(sp.at[0])}" r="${(sp.half * k).toFixed(1)}" class="sp"/>`);
    y0 += b.length * k + (b.step > 0 ? 2 : 0);
  }
  const turn = s.boards.reduce((a, b) => a + (b.turn ?? 0), 0);
  // (a bent board drawn straight, with an arrow for which way it turns)
  const arrow = Math.abs(turn) > 0.1 ? `<path d="M${(w / 2).toFixed(1)} ${(h + 3).toFixed(1)} q 0 6 ${(turn > 0 ? -8 : 8)} 6" class="tn"/>` : '';
  return `<svg viewBox="-2 -2 ${(w + 4).toFixed(1)} ${(h + 14).toFixed(1)}" width="${(w + 4).toFixed(0)}" height="${(h + 14).toFixed(0)}">${parts.join('')}${arrow}</svg>`;
}
function choose(i: number) {
  chosen = i;
  for (const b of $('offers').querySelectorAll('.offer')) b.classList.toggle('on', Number((b as HTMLElement).dataset.i) === i);
  // the finish moves on to the end of this one, so the run is seen whole as it would be
  if (offerFinish) drop(offerFinish);
  const fv: number[] = [];
  const fin = finishOf(offered[i].end);
  boardMesh(fin.board, fv);
  lineMesh(fin.line, WIDTH, fv);
  finishFlag(fin.line, fv);
  offerFinish = upload(fv);
  flyToEnd();
  tick();
}
function addChosen() {
  if (chosen < 0 || !offered[chosen]) return;
  choices.push(page * 3 + chosen);
  rebuildCourse();
  clickSound();
  offer(0);
  flyToEnd();
}
function undoSection() {
  if (!choices.length) return;
  choices.pop();
  rebuildCourse();
  popSound();
  offer(0);
  flyToEnd();
}
let view: 'race' | 'build' = 'race';
function mode(v: 'race' | 'build') {
  view = v;
  document.body.classList.toggle('building', v === 'build');
  if (v === 'build') { racing = false; offer(0); flyToEnd(); }
  hint();
}
/** which hands show: the lineup's, the race's, the building's; what the main button says */
function showHands() {
  document.body.classList.toggle('lineup', view === 'race' && phase === 'lineup');
  document.body.classList.toggle('done', view === 'race' && phase === 'done');
  const l = lookOf.get(mine);
  $('go').textContent = phase === 'lineup' ? 'go' : 'again';
  $('go').style.setProperty('--mine', l?.css ?? '#fff');
  $('build').textContent = view === 'build' ? 'race' : 'build';
}
/** A line of help for a moment, then gone (it's there again at the next change of phase). */
let hintTimer = 0;
function hint() {
  showHands();
  const text = view === 'build' ? 'tap a board to see it · add it to the run · try it to race the end'
    : phase === 'lineup' ? `${mine} is yours · tap another to choose · go when ready`
    : phase === 'done' ? 'all in · first at the top of the channel'
    : 'tap a marble to follow it · drag to look · pinch to come close';
  const el = $('hint');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => el.classList.remove('on'), phase === 'lineup' && view === 'race' ? 9000 : 3500);
}

// ─── the camera ─────────────────────────────────────────────────────────────────────────────────
const eye: V3 = [0, 420, -40];
const look: V3 = [0, 400, 0];
let camYaw = 0;
let camPitch = 0.8;
let orbit = { yaw: 0, pitch: 0 };
let zoom = 1;
let flyTarget: { eye: V3; look: V3 } | null = null;
/** Building: a view of the end of the run, the board on offer and the finish after it, all in frame. */
function flyToEnd() {
  const end = sections.length ? sections[sections.length - 1].end : TOP;
  const cand = offered[chosen];
  const far = cand ? cand.end.p : add(end.p, mul(dirOf(end.yaw, end.pitch), 60));
  // (the middle of what's new: the offered board and the start of the channel)
  const mid = mul(add(add(end.p, far), add(far, mul(dirOf(cand?.end.yaw ?? end.yaw, 0), 30))), 1 / 3);
  const span = len(sub(far, end.p)) + 60;
  const d = norm(sub(far, end.p));
  const side = norm(cross(d, [0, 1, 0]));
  const eye = add(add(sub(mid, mul([d[0], 0, d[2]], span * 0.95)), mul(side, span * 0.06)), [0, span * 1.25, 0]);
  // (aimed a little past the middle: the board on offer and the channel after it, above the cards)
  flyTarget = { eye, look: add(mid, mul([d[0], 0, d[2]], span * 0.08)) };
}
function updateCamera(dt: number) {
  if (view === 'build' && flyTarget) {
    const k = 1 - Math.exp(-dt * 2.5);
    for (let i = 0; i < 3; i++) { eye[i] += (flyTarget.eye[i] - eye[i]) * k; look[i] += (flyTarget.look[i] - look[i]) * k; }
    return;
  }
  const m = followed();
  const k0 = 1 - Math.exp(-dt * 3);
  if (phase === 'lineup') {
    // the lineup: from above the gate, looking down across the board, so the row runs up the
    // screen and every marble is big enough to tap (the run itself is seen at go)
    const f = sections.length ? sections[0].boards[0].frame : frameAt(TOP.p, TOP.yaw, TOP.pitch);
    // (the look a little past the row's lower end, so the row sits above the hands)
    const centre = add(add(add(f.p, mul(f.t, 2)), mul(f.b, -9)), mul(f.n, MARBLE_R));
    const dist = 66 / zoom;
    const el = Math.max(0.6, Math.min(1.4, 1.12 + orbit.pitch * 0.5));
    // (drag sideways and it swings round the row: from beside it to behind it, looking down the run;
    // nothing at the top is in the way now)
    const sw = Math.max(-1.6, Math.min(1.6, orbit.yaw));
    const across = norm(add(mul(f.b, Math.cos(sw)), mul(f.t, Math.sin(sw))));
    const fwd = norm(add(mul(across, Math.cos(el)), mul(f.n, -Math.sin(el))));
    const wantEye = sub(centre, mul(fwd, dist));
    // (the page's first moments: straight there, not a swing in from nowhere)
    const kk = time < 0.3 ? 1 : k0;
    for (let i = 0; i < 3; i++) { eye[i] += (wantEye[i] - eye[i]) * kk; look[i] += (centre[i] - look[i]) * kk; }
    camYaw = Math.atan2(f.t[0], f.t[2]);
    orbit.pitch *= Math.exp(-dt * 0.8);
    return;
  }
  if (phase === 'done' || m.finished >= 0 || follow === 'finish') {
    // the result: over the channel, looking down it; first at the top
    const f = course.fin.board.frame;
    const centre = add(f.p, mul(f.t, (course.fin.throat + course.fin.channelEnd) / 2 + 2));
    const wantEye = add(add(add(centre, mul(f.t, -16)), mul(f.n, 46 / zoom)), mul(f.b, orbit.yaw * 12));
    const wantLook = add(centre, mul(f.t, 4));
    for (let i = 0; i < 3; i++) { eye[i] += (wantEye[i] - eye[i]) * k0; look[i] += (wantLook[i] - look[i]) * k0; }
    camYaw = Math.atan2(f.t[0], f.t[2]);
    orbit.yaw *= Math.exp(-dt * 0.8);
    orbit.pitch *= Math.exp(-dt * 0.8);
    return;
  }
  // the board's way (the run is straight down it), the camera behind and above
  const speed = len(m.v);
  const u_ = sections.length ? under(m) : null;
  let fwd: V3 = u_ ? u_.frame.t : dirOf(TOP.yaw, TOP.pitch);
  // (the end of the board near: the heading leans toward the next board's, so a bend or a turn is met, not chased)
  if (u_ && m.finished < 0) {
    const left = u_.board.length - u_.along;
    const next = sections[m.sec + 1]?.boards[0];
    if (next && left < 30) fwd = norm(add(mul(fwd, left / 30), mul(next.frame.t, 1 - left / 30)));
  }
  const targetYaw = Math.atan2(fwd[0], fwd[2]);
  // (turn the camera's heading toward the marble's, smoothly round the circle)
  let dy = targetYaw - camYaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  camYaw += dy * (1 - Math.exp(-dt * 2.2));
  const yaw = camYaw + orbit.yaw;
  const pitch = camPitch + orbit.pitch;
  const dist = (38 + Math.min(12, speed * 0.03)) / zoom;
  const back: V3 = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  // (over the middle of the board, so the whole field is in view)
  // (a little toward the board's middle, so more of the field is in view; never so far that yours is at the edge)
  const mid = u_ ? add(m.p, mul(u_.frame.b, Math.max(-7, Math.min(7, -u_.across * 0.45)) / zoom)) : m.p;
  const wantEye = add(mid, mul(back, dist));
  // (the look ahead further the faster, and drawn toward rivals close by, so the contest is in the frame)
  let look2 = add(mid, mul(fwd, (10 + Math.min(12, speed * 0.04)) / zoom));
  const near = marbles.filter((o) => o !== m && len(sub(o.p, m.p)) < 30);
  if (near.length) {
    const c = near.reduce((a, o) => add(a, o.p), [0, 0, 0] as V3);
    look2 = add(look2, mul(sub(mul(c, 1 / near.length), m.p), 0.25 / zoom));
  }
  const wantLook = look2;
  const k = 1 - Math.exp(-dt * 6);
  for (let i = 0; i < 3; i++) { eye[i] += (wantEye[i] - eye[i]) * k; look[i] += (wantLook[i] - look[i]) * (1 - Math.exp(-dt * 10)); }
  // (the orbit a finger gave decays back behind)
  orbit.yaw *= Math.exp(-dt * 0.8);
  orbit.pitch *= Math.exp(-dt * 0.8);
}

// ─── hands ──────────────────────────────────────────────────────────────────────────────────────
const pointers = new Map<number, { x: number; y: number; x0: number; y0: number; moved: boolean }>();
let two: { d: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  wake();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false });
  two = null;
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 6) p.moved = true;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (two && two.d > 0) zoom = Math.max(0.5, Math.min(3, zoom * (d / two.d)));
    two = { d };
    return;
  }
  if (!p.moved) return;
  if (view === 'build' && flyTarget) {
    // (in build: turn about the end)
    const end = sections.length ? sections[sections.length - 1].end : TOP;
    const rel = sub(flyTarget.eye, end.p);
    const yaw = Math.atan2(rel[0], rel[2]) + dx * 0.006;
    const r = Math.hypot(rel[0], rel[2]);
    flyTarget.eye = [end.p[0] + Math.sin(yaw) * r, Math.max(end.p[1] + 8, flyTarget.eye[1] + dy * 0.3), end.p[2] + Math.cos(yaw) * r];
    return;
  }
  orbit.yaw = Math.max(-2.5, Math.min(2.5, orbit.yaw - dx * 0.006));
  orbit.pitch = Math.max(-0.4, Math.min(0.9, orbit.pitch + dy * 0.005));
});
const up = (e: PointerEvent) => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  if (pointers.size < 2) two = null;
  if (p && !p.moved && e.type === 'pointerup' && view === 'race') {
    // a tap on a marble: that one is yours; lining up, a tap elsewhere is go; otherwise the next marble
    // (a tap on a marble: that one is yours, and the camera on it; lining up, a tap elsewhere is go)
    const hit = pick(e.clientX, e.clientY);
    if (hit) choose_(hit.name);
    else if (phase === 'lineup') release(0);
  }
};
canvas.addEventListener('pointerup', up);
/** the marble under a point on the screen (within a finger of it), the nearest if several */
function pick(x: number, y: number): Marble | null {
  let best: Marble | null = null, bd = 36;
  for (const m of marbles) {
    const c = project(m.p);
    if (!c) continue;
    const d = Math.hypot(c[0] - x, c[1] - y);
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}
let lastVP: Float32Array | null = null;
/** a world point on the screen, in CSS pixels (or null, behind the camera) */
function project(p: V3): [number, number] | null {
  if (!lastVP) return null;
  const v = lastVP;
  const cx = v[0] * p[0] + v[4] * p[1] + v[8] * p[2] + v[12];
  const cy = v[1] * p[0] + v[5] * p[1] + v[9] * p[2] + v[13];
  const cw = v[3] * p[0] + v[7] * p[1] + v[11] * p[2] + v[15];
  if (cw <= 0) return null;
  return [((cx / cw) * 0.5 + 0.5) * innerWidth, (0.5 - (cy / cw) * 0.5) * innerHeight];
}
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.5, Math.min(3, zoom * Math.exp(-e.deltaY * 0.0012))); }, { passive: false });

const btn = (id: string, f: () => void) => $(id).addEventListener('click', (e) => { e.stopPropagation(); wake(); f(); });
/** the main button: go from the lineup; again from anywhere else (back to the gate) */
btn('go', () => (phase === 'lineup' ? release(0) : lineup()));
btn('cam', () => { follow = CAMS[(CAMS.indexOf(follow) + 1) % CAMS.length]; showFollow(); save(); });
btn('theme', () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]));
btn('build', () => (view === 'build' ? lineup() : mode('build')));
btn('add', addChosen);
btn('undo', undoSection);
/** building: race just the last board, to see how it runs */
btn('try', () => { follow = 'leader'; release(Math.max(0, sections.length - 1)); showFollow(); });
btn('new', () => { seed = Math.floor(Math.random() * 90000) + 1; choices = []; rebuildCourse(); page = 0; lineup(); });
// (the board's rows: tap one and that marble is yours)
$('order').addEventListener('click', (e) => {
  const row = (e.target as HTMLElement).closest('.dot') as HTMLElement | null;
  if (row?.dataset.name) { wake(); choose_(row.dataset.name); }
});
$('offers').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('#more')) { offer(page + 1); tick(1.5); return; }
  const b = t.closest('.offer') as HTMLElement | null;
  if (b) choose(Number(b.dataset.i));
});
function showFollow() {
  const l = lookOf.get(mine);
  $('cam').innerHTML = follow === 'leader' ? '<i class="lead"></i>the leader' : follow === 'finish' ? '<i class="flag"></i>the finish' : `<i style="background:${l?.css}"></i>${mine}`;
  showHands();
}
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); if (phase === 'lineup') release(0); else lineup(); }
  else if (k === 'c') { follow = CAMS[(CAMS.indexOf(follow) + 1) % CAMS.length]; showFollow(); }
  else if (k === 'b') mode(view === 'build' ? 'race' : 'build');
  else if (k === 'enter' && view === 'build') addChosen();
  else if (k === 'z' && view === 'build') undoSection();

  else if (k === '1' || k === '2' || k === '3') { if (view === 'build') choose(Number(k) - 1); }
});
btn('sound', () => {
  soundOn = !soundOn;
  showSound();
  try { localStorage.setItem(STORE + ':sound', soundOn ? '1' : '0'); } catch { /* */ }
  if (master && ac) master.gain.setTargetAtTime(soundOn ? 1 : 0, ac.currentTime, 0.3);
});

// ─── sound: the roll, the knocks, the wind of the drop ────────────────────────────────────────────
let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let soundOn = (() => { try { return localStorage.getItem(STORE + ':sound') !== '0'; } catch { return true; } })();
function showSound() { $('sound').textContent = soundOn ? 'sound on' : 'sound off'; }
showSound();
let roll: { g: GainNode; f: BiquadFilterNode } | null = null;
function wake() {
  if (ac || auto) return;
  try { ac = new AudioContext(); } catch { return; }
  master = ac.createGain();
  master.gain.value = soundOn ? 1 : 0;
  master.connect(ac.destination);
  noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const ch = noise.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ac.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 300;
  const g = ac.createGain();
  g.gain.value = 0;
  src.connect(f).connect(g).connect(master);
  src.start();
  roll = { g, f };
}
function rollAt(speed: number, on: boolean) {
  if (!ac || !roll) return;
  const s = Math.min(1, speed / 300);
  roll.g.gain.setTargetAtTime(on ? s * 0.08 : 0, ac.currentTime, 0.06);
  roll.f.frequency.setTargetAtTime(200 + 900 * s, ac.currentTime, 0.06);
}
function knock(mat: Material, j: number, other: Material | null) {
  if (!ac || !master || !noise) return;
  const t = ac.currentTime;
  const loud = Math.min(0.5, j * 0.004);
  // each material its own voice: glass rings, steel clacks, wood thocks, rubber thuds
  const f = other ? (mat.look === 'glass' || other.look === 'glass' ? 3200 : 1800) : mat.look === 'glass' ? 2600 : mat.look === 'steel' ? 2000 : mat.look === 'wood' ? 900 : 260;
  const s = ac.createBufferSource();
  s.buffer = noise;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = f;
  bp.Q.value = mat.look === 'rubber' ? 1.5 : 6;
  const g = ac.createGain();
  g.gain.setValueAtTime(loud, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (mat.look === 'glass' ? 0.12 : 0.05));
  s.connect(bp).connect(g).connect(master);
  s.start(t);
  s.stop(t + 0.15);
  if (mat.look === 'glass' || mat.look === 'steel') {
    const o = ac.createOscillator();
    o.frequency.value = mat.look === 'glass' ? 4200 : 3000;
    const og = ac.createGain();
    og.gain.setValueAtTime(loud * 0.3, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og).connect(master);
    o.start(t); o.stop(t + 0.12);
  }
}
let lastTick = 0;
function tick(k = 1) {
  if (!ac || !master || !noise) return;
  const now = performance.now();
  if (now - lastTick < 60) return;
  lastTick = now;
  const s = ac.createBufferSource();
  s.buffer = noise;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 5000; bp.Q.value = 3;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.04 * k, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.03);
  s.connect(bp).connect(g).connect(master);
  s.start(); s.stop(ac.currentTime + 0.05);
}
function clickSound() { knock(MATERIALS[2], 60, null); }
function popSound() { knock(MATERIALS[3], 60, null); }

// ─── drawing ────────────────────────────────────────────────────────────────────────────────────
/** the theme's light, to every program that draws by it */
function lightUniforms(p: WebGLProgram) {
  const t = theme;
  gl.uniform3fv(u(p, 'uKey'), norm(t.key));
  gl.uniform3fv(u(p, 'uKeyCol'), mul(t.keyColour, t.keyStrength));
  gl.uniform3fv(u(p, 'uWin'), norm(t.win));
  gl.uniform3fv(u(p, 'uWinCol'), mul(t.winColour, t.winStrength));
  gl.uniform3fv(u(p, 'uEnvFloor'), t.envFloor);
  gl.uniform3fv(u(p, 'uEnvWall'), t.envWall);
  gl.uniform3fv(u(p, 'uEnvCeil'), t.envCeil);
  gl.uniform3fv(u(p, 'uHaze'), t.haze);
  gl.uniform1f(u(p, 'uHazeNear'), t.hazeNear);
  gl.uniform1f(u(p, 'uNight'), t.lamps ? 1 : 0);
  gl.uniform1f(u(p, 'uDust'), t.dust);
  gl.uniform3fv(u(p, 'uLampCol'), t.lampColour);
  // the four nearest lamps to the marble followed (none, if the lamps are out)
  const me = followed().p;
  const near = t.lamps ? [...lampAt].sort((a, b) => len(sub(a, me)) - len(sub(b, me))).slice(0, 4) : [];
  const arr = new Float32Array(16);
  near.forEach((l, i) => arr.set([l[0], l[1], l[2], t.lampStrength], i * 4));
  gl.uniform4fv(u(p, 'uLamps'), arr);
}
let dpr = 1;
function resize() {
  dpr = Math.min(devicePixelRatio || 1, 1.75) * (preview ? 0.6 : 1);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}
addEventListener('resize', resize);
// the shadow map
const SHADOW = preview ? 1024 : 2048;
const shadowTex = gl.createTexture()!;
gl.bindTexture(gl.TEXTURE_2D, shadowTex);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW, SHADOW, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
const shadowFb = gl.createFramebuffer()!;
gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
gl.drawBuffers([gl.NONE]);
gl.readBuffer(gl.NONE);
gl.bindFramebuffer(gl.FRAMEBUFFER, null);
const skyVao = gl.createVertexArray()!;

const I4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const I3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
/**
 * Where each marble is drawn: between the solver's last two states, by how far the frame is
 * into the next step, so motion is even on a screen that runs faster than the solver.
 */
const prevP: V3[] = [], prevQ: Array<[number, number, number, number]> = [];
function remember() {
  marbles.forEach((m, i) => { prevP[i] = [...m.p] as V3; prevQ[i] = [...m.q] as [number, number, number, number]; });
}
function shown(i: number, alpha: number): { p: V3; q: [number, number, number, number] } {
  const m = marbles[i];
  const p0 = prevP[i], q0 = prevQ[i];
  if (!p0 || !q0 || len(sub(m.p, p0)) > 20) return { p: m.p, q: m.q };
  const p = add(p0, mul(sub(m.p, p0), alpha));
  // (the turn: between the two, the short way, renormalised)
  const d = q0[0] * m.q[0] + q0[1] * m.q[1] + q0[2] * m.q[2] + q0[3] * m.q[3];
  const sg = d < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map((k) => q0[k] + (sg * m.q[k] - q0[k]) * alpha) as [number, number, number, number];
  const l = Math.hypot(...q) || 1;
  return { p, q: [q[0] / l, q[1] / l, q[2] / l, q[3] / l] };
}
/** a marble's model matrix: its turn and place, its size */
function marbleModel(m: Marble, p: V3, q: [number, number, number, number]): [Float32Array, Float32Array] {
  const [x, y, z, w] = q;
  const r = m.r;
  const R = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
  const M = new Float32Array([R[0] * r, R[1] * r, R[2] * r, 0, R[3] * r, R[4] * r, R[5] * r, 0, R[6] * r, R[7] * r, R[8] * r, 0, p[0], p[1], p[2], 1]);
  return [M, new Float32Array(R)];
}
/**
 * The frame's own buffers: a multisampled one everything is drawn into, and a plain one it is
 * resolved into part-way, so the glass can look through what's drawn so far; at the end the
 * multisampled one goes to the screen.
 */
const sceneTex = gl.createTexture()!;
const depthTex = gl.createTexture()!;
const msFb = gl.createFramebuffer()!, resolveFb = gl.createFramebuffer()!;
const msColour = gl.createRenderbuffer()!, msDepth = gl.createRenderbuffer()!;
let sceneW = 0, sceneH = 0;
function sceneBuffers(w: number, h: number) {
  if (w === sceneW && h === sceneH) return;
  sceneW = w; sceneH = h;
  const samples = Math.min(preview ? 2 : 4, gl.getParameter(gl.MAX_SAMPLES) as number);
  gl.bindRenderbuffer(gl.RENDERBUFFER, msColour);
  // (RGB, as the canvas is: a blit between them must match)
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGB8, w, h);
  gl.bindRenderbuffer(gl.RENDERBUFFER, msDepth);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, msFb);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msColour);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, w, h, 0, gl.RGB, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, depthTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
/** a board being tapped (a stuck marble nudged on): which section, until when */
let shake: { sec: number; until: number } | null = null;
/** where the lens is focused (eased toward the marble the camera is on) */
let focus = 40;
let nudgesSeen = 0;
/** which meshes are near enough to draw (sections around the followed marble, or all in build) */
function visible(): Draw[] {
  const out: Draw[] = [];
  const m = followed();
  const far = view === 'build' ? Infinity : 600;
  sections.forEach((s, i) => {
    if (view !== 'build' && Math.abs(i - m.sec) > 6) {
      // (a long way along the run: only if it's near in space)
      const e = s.end.p;
      if (len(sub(e, m.p)) > far) return;
    }
    if (shake && shake.sec === i && time < shake.until) {
      const k = Math.sin((shake.until - time) * 90) * 0.12 * ((shake.until - time) / 0.4);
      out.push({ mesh: sectionMeshes[i], model: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, k, 0, 1]) });
    } else out.push({ mesh: sectionMeshes[i] });
  });
  if (finishMesh && view !== 'build') out.push({ mesh: finishMesh });
  if (view === 'build') {
    if (offerMeshes[chosen]) out.push({ mesh: offerMeshes[chosen] });
    if (offerFinish) out.push({ mesh: offerFinish });
  }
  if (supportMesh_ && !params.has("nosupport")) out.push({ mesh: supportMesh_ });
  return out;
}
interface Draw { mesh: Mesh; model?: Float32Array; normal?: Float32Array; tint?: V3; tint2?: V3; style?: [number, number, number, number]; mat?: number; ghost?: boolean }
function drawMeshes(list: Draw[], shadowPass: boolean) {
  for (const { mesh, model, normal, tint, tint2, style, mat, ghost } of list) {
    if (!mesh.count) continue;
    if (shadowPass) {
      gl.uniformMatrix4fv(u(shadowProg, 'uModel'), false, model ?? I4);
      gl.bindVertexArray(mesh.svao);
    } else {
      gl.uniformMatrix4fv(u(prog, 'uModel'), false, model ?? I4);
      gl.uniformMatrix3fv(u(prog, 'uNormal'), false, normal ?? I3);
      gl.uniform3fv(u(prog, 'uTint'), tint ?? [1, 1, 1]);
      gl.uniform3fv(u(prog, 'uTint2'), tint2 ?? [1, 1, 1]);
      gl.uniform4fv(u(prog, 'uStyle'), style ?? [1, 3, 0, 0]);
      gl.uniform1f(u(prog, 'uMatOver'), mat ?? -1);
      gl.uniform1f(u(prog, 'uGhost'), ghost ? 1 : 0);
      gl.bindVertexArray(mesh.vao);
    }
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }
}

let last = performance.now();
let time = 0;
let lag = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  resize();
  // the race, in fixed steps (and before it, the field settling against the gate)
  const lining = phase === 'lineup' && view === 'race';
  if (lining) {
    lag = Math.min(lag + dt, 0.1);
    impacts = [];
    while (lag >= 1 / 60) { lag -= 1 / 60; remember(); step(course, marbles, 1 / 60, 0, impacts); }
    for (const im of impacts.slice(0, 3)) knock(im.mat, im.j * 0.5, im.other);
  }
  if (racing) {
    lag = Math.min(lag + dt, 0.1);
    impacts = [];
    while (lag >= 1 / 60) {
      lag -= 1 / 60;
      remember();
      step(course, marbles, 1 / 60, raceTime, impacts);
      raceTime += 1 / 60;
    }
    // a marble stuck and nudged on: the board is seen to be tapped, and heard
    const nudges = marbles.reduce((a, m) => a + m.nudges, 0);
    if (nudges > nudgesSeen) {
      nudgesSeen = nudges;
      const stuck = marbles.find((m) => m.slowFor === 0 && m.nudges > 0 && len(m.v) > 10) ?? followed();
      shake = { sec: Math.min(stuck.sec, sections.length - 1), until: time + 0.4 };
      popSound();
    }
    const me = followed();
    for (const im of impacts.slice(0, 4)) {
      // (the nearer the louder)
      const d = len(sub(im.at, me.p));
      knock(im.mat, im.j * Math.max(0.15, 1 - d / 120), im.other);
    }
    rollAt(len(me.v), me.contact);
    // all in: the result; the solver runs on until they've settled in the channel
    // all in (or the first in 25 s ago, and a straggler not worth waiting for): the result; the
    // solver runs on until they're asleep in the channel
    if (firstInAt < 0 && marbles.some((m) => m.finished >= 0)) firstInAt = raceTime;
    if (phase === 'racing' && (marbles.every((m) => m.finished >= 0) || (firstInAt >= 0 && raceTime > firstInAt + 25))) { phase = 'done'; doneAt = raceTime; hint(); }
    if (phase === 'done' && (raceTime > doneAt + 8 || marbles.every((m) => m.finished < 0 || m.asleep))) { racing = false; rollAt(0, false); }
  }
  updateCamera(dt);
  showBoard();

  const W = canvas.width, H = canvas.height;
  const fwd = norm(sub(look, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const upv = cross(right, fwd);
  const aspect = W / H;
  const fov = 0.9;
  const far = 2600;
  const vp = viewProj(eye, fwd, right, upv, fov, aspect, 1, far);
  lastVP = vp;
  // the sun's view: a box around the followed marble (or the end, building)
  const centre: V3 = view === 'build' ? (flyTarget?.look ?? (sections.length ? sections[sections.length - 1].end.p : TOP.p)) : followed().p;
  const span = view === 'build' ? 130 : 70;
  const lightVP = ortho(centre, norm(theme.key), span, 400);
  // (penumbra texels per unit of light depth: the depth range over a texel's width, times how
  // wide the window's light spreads for each centimetre between blocker and receiver)
  const shadowSoft = (400 * 0.1) / ((2 * span) / SHADOW);
  const vis = visible();
  const live: Draw[] = [...vis];
  // the spinners' arms where they are now, and the gate lifting
  {
    const bv: number[] = [];
    for (const s of sections) for (const b of s.boards) spinnerMesh(b, raceTime, bv);
    upload(bv, true, barMesh_);
    if (bv.length) live.push({ mesh: barMesh_ });
    const gv: number[] = [];
    if (sections.length) gateMesh(sections[0].boards[0], racing ? Math.min(9, raceTime * 24) : fromSection > 0 ? 9 : 0, gv);
    upload(gv, true, gateMesh_);
    if (gv.length) live.push({ mesh: gateMesh_ });
  }
  // (building, the marbles are out of the way: the end of the run is where the next board goes;
  // drawn far to near, so the clear ones show what's behind them)
  const alpha = racing || lining ? Math.max(0, Math.min(1, lag * 60)) : 1;
  const balls: Array<Draw & { at: V3; r: number; m: Marble }> = view === 'build' ? [] : marbles.map((m, i) => {
    const { p, q } = shown(i, alpha);
    const [M, N] = marbleModel(m, p, q);
    const l = lookOf.get(m.name);
    return { mesh: SPHERE, model: M, normal: N, tint: m.tint, tint2: l?.tint2, style: l?.style, mat: 10, at: p, r: m.r, m, d: len(sub(p, eye)) };
  }).sort((a, b) => b.d - a.d);

  // 1. the shadow map
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFb);
  gl.viewport(0, 0, SHADOW, SHADOW);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.FRONT);
  gl.useProgram(shadowProg);
  gl.uniformMatrix4fv(u(shadowProg, 'uLightVP'), false, lightVP);
  drawMeshes(live, true);
  gl.cullFace(gl.BACK);
  for (const b of balls) { gl.uniformMatrix4fv(u(shadowProg, 'uModel'), false, b.model); gl.bindVertexArray(SPHERE.svao); gl.drawArrays(gl.TRIANGLES, 0, SPHERE.count); }
  gl.disable(gl.CULL_FACE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // 2. the sky (into the frame's own buffer)
  sceneBuffers(W, H);
  gl.bindFramebuffer(gl.FRAMEBUFFER, msFb);
  gl.viewport(0, 0, W, H);
  gl.clearColor(theme.haze[0], theme.haze[1], theme.haze[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(skyProg);
  lightUniforms(skyProg);
  gl.uniformMatrix4fv(u(skyProg, 'uInvVP'), false, invert(vp));
  gl.bindVertexArray(skyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  // 3. the world
  gl.enable(gl.DEPTH_TEST);
  gl.useProgram(prog);
  gl.uniformMatrix4fv(u(prog, 'uVP'), false, vp);
  gl.uniformMatrix4fv(u(prog, 'uLightVP'), false, lightVP);
  lightUniforms(prog);
  const tables = matTables(theme);
  gl.uniform4fv(u(prog, 'uCol'), tables.col);
  gl.uniform4fv(u(prog, 'uPar'), tables.par);
  gl.uniform3fv(u(prog, 'uEye'), eye);
  gl.uniform1f(u(prog, 'uCut'), view === 'build' ? 4 : 8);
  gl.uniform1f(u(prog, 'uTime'), time);
  gl.uniform1f(u(prog, 'uFar'), far);
  gl.uniform1i(u(prog, 'uShadowMap'), 0);
  gl.uniform1f(u(prog, 'uShadowSoft'), shadowSoft);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.enable(gl.CULL_FACE);
  if (groundMesh_) drawMeshes([{ mesh: groundMesh_ }], false);
  if (overheadMesh_) drawMeshes([{ mesh: overheadMesh_ }], false);
  gl.disable(gl.CULL_FACE);
  drawMeshes(live, false);
  // under each marble, a soft dark: the contact's own shadow (and the marker under yours)
  const flatAt = (f: Frame, at: V3, sz: number) => new Float32Array([f.b[0] * sz, f.b[1] * sz, f.b[2] * sz, 0, f.n[0] * sz, f.n[1] * sz, f.n[2] * sz, 0, f.t[0] * sz, f.t[1] * sz, f.t[2] * sz, 0, at[0], at[1], at[2], 1]);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  const me = followed();
  for (const b of balls) {
    const { board, frame: f } = under(b.m);
    const [, up] = toLocal(board, b.at);
    const lift = Math.max(0, up - b.r);
    if (lift > 6) continue;
    drawMeshes([{ mesh: DISC, model: flatAt(f, add(b.at, mul(f.n, -(up - 0.04))), b.r * (1.5 + lift * 0.25)), mat: 9, tint: b.tint }], false);
  }
  // and in each one's shadow, the light it gathers: a caustic in its colour (added light)
  gl.blendFunc(gl.ONE, gl.ONE);
  const nearestLamp = (p: V3) => lampAt.reduce((a, b) => (len(sub(b, p)) < len(sub(a, p)) ? b : a), lampAt[0] ?? p);
  for (const b of balls) {
    const { board, frame: f } = under(b.m);
    const [, up] = toLocal(board, b.at);
    if (up - b.r > 4) continue;
    const L = theme.lamps && lampAt.length ? norm(sub(nearestLamp(b.at), b.at)) : norm(theme.key);
    const ln = dotv(L, f.n);
    if (ln < 0.2) continue;
    const at = add(sub(b.at, mul(L, up / ln)), mul(f.n, 0.05));
    const glow = theme.lamps ? theme.lampStrength * 0.9 : theme.keyStrength;
    gl.uniform1f(u(prog, 'uGlow'), glow);
    drawMeshes([{ mesh: DISC, model: flatAt(f, at, b.r * (1.5 + 0.8 * (1 - ln))), mat: 22, tint: b.tint }], false);
  }
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  if (view !== 'build' && follow === 'mine') {
    const f = under(me).frame;
    const mi = marbles.indexOf(me);
    const at = add(shown(mi, alpha).p, mul(f.n, -MARBLE_R + 0.06));
    drawMeshes([{ mesh: RING, model: flatAt(f, at, MARBLE_R * 1.9), mat: 6 }], false);
  }
  gl.depthMask(true);
  gl.disable(gl.BLEND);
  // the marbles: glass, each its own, far to near, looking through the scene so far (copied for them)
  if (balls.length) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msFb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolveFb);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, msFb);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.useProgram(glassProg);
    gl.uniformMatrix4fv(u(glassProg, 'uVP'), false, vp);
    gl.uniformMatrix4fv(u(glassProg, 'uLightVP'), false, lightVP);
    lightUniforms(glassProg);
    gl.uniform3fv(u(glassProg, 'uEye'), eye);
    gl.uniform2f(u(glassProg, 'uRes'), W, H);
    gl.uniform1f(u(glassProg, 'uTime'), time);
    gl.uniform1f(u(glassProg, 'uMatOver'), 10);
    gl.uniform1i(u(glassProg, 'uShadowMap'), 0);
    gl.uniform1f(u(glassProg, 'uShadowSoft'), shadowSoft);
    gl.uniform1i(u(glassProg, 'uScene'), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(SPHERE.gvao);
    for (const b of balls) {
      gl.uniformMatrix4fv(u(glassProg, 'uModel'), false, b.model!);
      gl.uniformMatrix3fv(u(glassProg, 'uNormal'), false, b.normal!);
      gl.uniform3fv(u(glassProg, 'uTint'), b.tint!);
      gl.uniform3fv(u(glassProg, 'uTint2'), b.tint2 ?? [1, 1, 1]);
      gl.uniform4fv(u(glassProg, 'uStyle'), b.style ?? [0, 3, 0, 0]);
      gl.uniform3fv(u(glassProg, 'uCentre'), b.at);
      gl.uniform1f(u(glassProg, 'uRadius'), b.r);
      gl.drawArrays(gl.TRIANGLES, 0, SPHERE.count);
    }
    gl.disable(gl.CULL_FACE);
    gl.useProgram(prog);
  }
  // the dust in the air, over everything
  if (!preview) {
    gl.useProgram(dustProg);
    gl.uniformMatrix4fv(u(dustProg, 'uVP'), false, vp);
    gl.uniform3fv(u(dustProg, 'uEye'), eye);
    gl.uniform1f(u(dustProg, 'uDust'), theme.dust);
    gl.uniform3fv(u(dustProg, 'uKeyCol'), mul(theme.keyColour, theme.keyStrength));
    gl.uniform1f(u(dustProg, 'uTime'), time);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(dustVao);
    gl.drawArrays(gl.POINTS, 0, DUST_N);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.useProgram(prog);
  }
  gl.bindVertexArray(null);
  showNames();
  // 4. to the screen, through the lens: resolved (colour and depth), then focused on the marble
  // the camera is on, softer nearer and further
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msFb);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolveFb);
  gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, W, H);
  gl.disable(gl.DEPTH_TEST);
  gl.useProgram(postProg);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, sceneTex);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, depthTex);
  gl.uniform1i(u(postProg, 'uColor'), 0);
  gl.uniform1i(u(postProg, 'uDepth'), 1);
  gl.uniform2f(u(postProg, 'uRes'), W, H);
  const focusWant = view === 'build' ? len(sub(look, eye)) : phase === 'racing' && !(follow === 'finish' || followed().finished >= 0) ? len(sub(shown(marbles.indexOf(followed()), alpha).p, eye)) : len(sub(look, eye));
  focus += (focusWant - focus) * (1 - Math.exp(-dt * 8));
  gl.uniform1f(u(postProg, 'uFocus'), focus);
  // (how soon it softens: a long lens close in, gentler far out; none in the preview, a little when building)
  gl.uniform1f(u(postProg, 'uAperture'), preview ? 0 : (view === 'build' ? 1.5 : 3.2) * dpr);
  gl.uniform1f(u(postProg, 'uMaxR'), 5 * dpr);
  gl.uniform1f(u(postProg, 'uNear'), 1);
  gl.uniform1f(u(postProg, 'uFar'), far);
  gl.bindVertexArray(skyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.activeTexture(gl.TEXTURE0);
  (window as unknown as { __marbles: unknown }).__marbles = {
    seed, choices, sections: sections.length, racing, phase, raceTime, view, chosen, offered: offered.map((s) => s.name),
    order: order(marbles).map((m) => ({ name: m.name, progress: Math.round(m.progress), finished: m.finished, falls: m.falls, speed: Math.round(len(m.v)) })),
    me: followed().name, eye: eye.map((v) => Math.round(v)), look: look.map((v) => Math.round(v)), theme: theme.id,
    // (where each is along the finish board, once in)
    rest: order(marbles).map((m) => (m.finished >= 0 ? Math.round(dotv(sub(m.p, course.fin.board.frame.p), course.fin.board.frame.t) * 10) / 10 : null)),
  };
  requestAnimationFrame(frame);
}

/** The board: the order, the gaps, the time. */
let boardAt = 0;
let boardHtml = '';
/** At the finish: each marble's place, name and time beside it, fading in as it crosses the line. */
function resetNames() {
  $('names').innerHTML = marbles.map((m) => `<div class="name" data-name="${m.name}"><b></b> ${m.name} <em></em></div>`).join('');
}
// (choosing yours in the lineup makes its name bold at once)
function showNames() {
  const box = $('names');
  const on = view === 'race';
  box.classList.toggle('on', on);
  if (!on) return;
  if (phase === 'lineup') {
    // at the gate: every name beside its marble, as at the finish (yours in bold)
    for (const el of box.children as unknown as HTMLElement[]) {
      const i = marbles.findIndex((x) => x.name === el.dataset.name);
      if (i < 0) continue;
      const c = project(shown(i, 1).p);
      el.classList.toggle('in', !!c);
      if (!c) continue;
      el.querySelector('b')!.textContent = '';
      el.querySelector('em')!.textContent = '';
      el.classList.toggle('me', marbles[i].name === mine);
      el.style.transform = `translate(${Math.round(c[0] + 16)}px, ${Math.round(c[1])}px) translateY(-50%)`;
    }
    return;
  }
  const f = course.fin.board.frame;
  const centre = add(f.p, mul(f.t, (course.fin.throat + course.fin.channelEnd) / 2));
  // (only when the finish is near enough to read)
  const near = len(sub(centre, eye)) < 160;
  const inOrder = marbles.filter((m) => m.finished >= 0).sort((a, b) => a.finished - b.finished);
  for (const el of box.children as unknown as HTMLElement[]) {
    const m = marbles.find((x) => x.name === el.dataset.name);
    if (!m) continue;
    const place = inOrder.indexOf(m);
    const c = near && place >= 0 ? project(add(m.p, mul(f.b, -MARBLE_R * 5))) : null;
    el.classList.toggle('in', !!c);
    if (!c) continue;
    if (!el.dataset.set) {
      el.dataset.set = '1';
      el.querySelector('em')!.textContent = `${m.finished.toFixed(1)} s`;
    }
    el.querySelector('b')!.textContent = String(place + 1);
    el.classList.toggle('me', m.name === mine);
    el.style.transform = `translate(${Math.round(c[0])}px, ${Math.round(c[1])}px) translateY(-50%)`;
  }
}
function showBoard() {
  if (performance.now() - boardAt < 120) return;
  boardAt = performance.now();
  const o = order(marbles);
  // (the order across the top: a row of dots, first on the left; yours named; those in, ringed)
  const html = o.map((m) => {
    const l = lookOf.get(m.name);
    const me = m.name === followed().name;
    return `<div class="dot${me ? ' me' : ''}${m.finished >= 0 ? ' in' : ''}" data-name="${m.name}"><i style="background:${l?.css}"></i><span>${m.name}</span></div>`;
  }).join('');
  if (html !== boardHtml) { boardHtml = html; $('order').innerHTML = html; }
  const me = followed();
  const lead = o[0];
  const place = o.indexOf(me) + 1;
  const gap = me.finished >= 0 ? `${me.finished.toFixed(1)} s` : me === lead ? 'leading' : `${((lead.progress - me.progress) / 100).toFixed(1)} m back`;
  $('clock').textContent = racing ? `${raceTime.toFixed(1)} s · ${place}${['st', 'nd', 'rd'][place - 1] ?? 'th'} · ${gap}` : phase === 'done' ? `${lead.name} first · ${me.name} ${place}${['st', 'nd', 'rd'][place - 1] ?? 'th'}` : '';
}

// ─── small maths ────────────────────────────────────────────────────────────────────────────────
function viewProj(e: V3, f: V3, r: V3, up: V3, fov: number, aspect: number, near: number, far: number): Float32Array {
  const z: V3 = [-f[0], -f[1], -f[2]];
  const view = [r[0], up[0], z[0], 0, r[1], up[1], z[1], 0, r[2], up[2], z[2], 0, -dotv(r, e), -dotv(up, e), -dotv(z, e), 1];
  const t = 1 / Math.tan(fov / 2);
  const proj = [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  return mat4mul(proj, view);
}
/** the sun's orthographic view about a point */
function ortho(centre0: V3, sun: V3, span: number, depth: number): Float32Array {
  const f = mul(sun, -1);
  const r = norm(cross(f, Math.abs(f[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]));
  const up = cross(r, f);
  // (the box moves with the marble in whole texels, so the shadows' edges don't crawl as it rolls)
  const texel = (2 * span) / SHADOW;
  const cr = dotv(r, centre0), cu = dotv(up, centre0);
  const centre = add(add(centre0, mul(r, Math.round(cr / texel) * texel - cr)), mul(up, Math.round(cu / texel) * texel - cu));
  const e = add(centre, mul(sun, depth / 2));
  const z: V3 = [-f[0], -f[1], -f[2]];
  const view = [r[0], up[0], z[0], 0, r[1], up[1], z[1], 0, r[2], up[2], z[2], 0, -dotv(r, e), -dotv(up, e), -dotv(z, e), 1];
  const proj = [1 / span, 0, 0, 0, 0, 1 / span, 0, 0, 0, 0, -2 / depth, 0, 0, 0, -1, 1];
  return mat4mul(proj, view);
}
const dotv = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function mat4mul(a: number[] | Float32Array, b: number[] | Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) out[c * 4 + rr] = a[rr] * b[c * 4] + a[4 + rr] * b[c * 4 + 1] + a[8 + rr] * b[c * 4 + 2] + a[12 + rr] * b[c * 4 + 3];
  return out;
}
function invert(m: Float32Array): Float32Array {
  const a = Array.from(m);
  const inv = new Array(16).fill(0);
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

// ─── begin ──────────────────────────────────────────────────────────────────────────────────────
{
  const q = decode(params);
  let saved: { seed?: number; choices?: number[]; mine?: string; follow?: 'mine' | 'leader' } | null = null;
  try { saved = JSON.parse(localStorage.getItem(STORE) ?? 'null'); } catch { /* */ }
  if (q.seed) { seed = q.seed; choices = q.choices; }
  else if (saved?.seed && !auto) { seed = saved.seed; choices = saved.choices ?? []; }
  else {
    // a fresh run: a seed and a first few sections chosen for it
    seed = auto ? 21 : Math.floor(Math.random() * 90000) + 1;
    const r = seeded(seed);
    choices = [];
    for (let i = 0; i < (auto ? 6 : 4); i++) choices.push(Math.floor(r() * 3));
  }
  mine = params.get('marble') ?? saved?.mine ?? LOOKS[0].name;
  if (!lookOf.has(mine)) mine = LOOKS[0].name;
  follow = auto ? 'leader' : saved?.follow ?? 'mine';
  rebuildCourse();
  setTheme(theme);
  showFollow();
  resize();
  if (auto) release(0); else lineup();
  requestAnimationFrame(frame);
}

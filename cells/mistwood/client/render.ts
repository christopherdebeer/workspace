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
import { SEG } from './tree';

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
// banks of mist drifting through the wood (world space), heavier near the ground
float mist(vec3 p) {
  vec2 q = vec2(p.x * .05 + p.z * .021 + uT * .014, p.y * .1 - uT * .0025 + p.z * .008);
  float n = fbm(q) * .75 + vnoise(q * 3.7 + vec2(uT * .02, 0.)) * .25;
  return smoothstep(.4, .82, n) * .62 * exp(-max(p.y, 0.) * .045);
}
vec3 fogAt(float y) { return mix(uFogLow, uFogHigh, smoothstep(-1., 20., y)); }
`;

const QUAD_VS = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); gl_Position = vec4(p, 0., 1.); }`;

const WORLD_FS = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
uniform vec2 uRes;
uniform float uF, uHz, uDensity;
uniform vec4 uCam; // x, z, eye, yaw
uniform vec3 uPathA, uPathB;
uniform vec3 uGround, uStrawDark, uStraw;
uniform vec2 uSun; // azimuth, elevation of the brighter place
// trees near enough to shade the ground: x, z, contact radius, crown radius (crown centre offset away from the light)
uniform vec4 uShade[40];
uniform vec2 uShadeOff[40];
uniform int uShadeN;
${NOISE}
float pathX(float z) { return uPathA.x * sin(z * uPathA.y + uPathA.z) + uPathB.x * sin(z * uPathB.y + uPathB.z); }
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
  if (d.y >= 0.) {
    // only fog: lighter higher, brighter where the sun is behind it
    float el = d.y;
    col = mix(fogAt(0.), uFogHigh, smoothstep(0., .6, el));
    float s = exp(-pow(az - uSun.x, 2.) * 3. - pow(el - uSun.y, 2.) * 6.);
    col += s * vec3(.07, .075, .06) * smoothstep(0., .15, el);
    // the banks' slow unevenness, fading out at the horizon (where the ground's fog takes over)
    col *= 1. + (.06 * fbm(vec2(az * 4. + uT * .006, el * 7.)) - .03) * smoothstep(0., .12, el);
  } else {
    float t = uCam.z / -d.y;
    vec3 p = vec3(uCam.x, 0., uCam.y) + d * t;
    // dry grass: straw and shadow, a trodden path darker
    float n = fbm(p.xz * .5);
    float grain = vnoise(p.xz * 6.) * .5 + vnoise(p.xz * 17.) * .5;
    vec3 g = mix(uStrawDark, uGround, smoothstep(.2, .75, n));
    g = mix(g, uStraw * .8, smoothstep(.6, .95, vnoise(p.xz * 2.2)) * .35);
    g *= .8 + .35 * grain;
    float path = 1. - smoothstep(.35, .9, abs(p.x - pathX(p.z)) + (vnoise(p.xz * 1.3) - .5) * .5);
    g = mix(g, uStrawDark * .8, path * .45);
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
    float fogD = 1. - exp(-t * uDensity * (1. + 1.2 * smoothstep(2., 14., t)));
    float m = mist(vec3(p.x, .3, p.z));
    col = mix(g, fogAt(0.), 1. - (1. - fogD) * (1. - m));
  }
  o = vec4(col, 1.);
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
  vec3 w = vec3(uAnchor.x + right.x * along, uRect.y + c.y * uRect.w, uAnchor.y + right.y * along);
  vec3 rel = w - vec3(uCam.x, uCam.z, uCam.y);
  float cs = cos(uCam.w), sn = sin(uCam.w);
  float cx = rel.x * cs - rel.z * sn;
  float cz = rel.x * sn + rel.z * cs;
  float hd = max(length(vec2(cx, cz)), .05);
  vec2 scr = vec2(atan(cx, cz) * uF + .5 * uRes.x, rel.y / hd * uF + uHz);
  gl_Position = vec4(scr / uRes * 2. - 1., 0., 1.);
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
  vec4 t = texture(uTex, vec2(vUV.x + m / abs(uRect.z) * uFlip, vUV.y));
  if (t.a < .003) discard;
  float cov = min(t.a, 1.);
  float tone = clamp(t.g / max(t.a, .002), 0., 1.);
  float leaf = clamp(t.r / max(t.a, .002), 0., 1.);
  vec3 birch = uBirch;
  if (tone > .3 && uKind < .5) {
    // birch bark: dark lenticels across the white, black patches, darker towards the foot
    float band = vnoise(vec2(vWorld.x * 4., vWorld.y * 40.));
    float patchy = vnoise(vec2(vWorld.x * 2. + uPhase, vWorld.y * 7.));
    birch *= 1. - .75 * smoothstep(.72, .8, band) - .7 * smoothstep(.7, .78, patchy) - .5 * exp(-vWorld.y * 1.2);
  }
  vec3 base = uKind > .5 ? mix(uStrawDark, uStraw, tone) : mix(uBark, birch, tone);
  base = mix(base, uLeaf, leaf);
  // thin wood is lit through by the fog behind it
  base = mix(base, uFogLow, (1. - cov) * .22);
  // fog: by distance, and much thicker near the ground; banks of mist drift through
  // (the ground fog lies a few metres off: what is at your feet is clear)
  float fogD = 1. - exp(-vDist * uDensity * (1. + 1.5 * exp(-max(vWorld.y, 0.) * .35) * smoothstep(2., 14., vDist)));
  float fog = 1. - (1. - fogD) * (1. - mist(vWorld));
  o = vec4(mix(base, fogAt(vWorld.y), fog) * cov, cov) * uAlpha;
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
uniform float uRot, uScale, uPhase, uRadius, uHeight;
out vec2 vP;
flat out vec2 vA;
flat out vec2 vB;
flat out vec2 vW;
flat out vec2 vTL;
out vec3 vWorld;
out float vDist;
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
  return q + vec3(uAnchor.x, 0., uAnchor.y);
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
  if (sa.z < .15 || sb.z < .15) { gl_Position = vec4(2., 2., 2., 1.); return; }
  float pa = aInfo.x * uScale * uF / ha, pb = aInfo.y * uScale * uF / hb;
  vec2 a = sa.xy, b = sb.xy, d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(0., 1.);
  vec2 n = vec2(-dir.y, dir.x);
  float e = max(pa, pb) * .5 + 1.5;
  int c = gl_VertexID;
  bool first = c == 0 || c == 2;
  vec2 p = (first ? a - dir * e : b + dir * e) + n * (c < 2 ? -e : e);
  gl_Position = vec4(p / uRes * 2. - 1., 0., 1.);
  vP = p;
  vA = a;
  vB = b;
  vW = vec2(pa, pb);
  vTL = aInfo.zw;
  vWorld = first ? wa : wb;
  vDist = first ? ha : hb;
}`;

const LIVE_FS = `#version 300 es
precision highp float;
precision highp int;
in vec2 vP;
flat in vec2 vA;
flat in vec2 vB;
flat in vec2 vW;
flat in vec2 vTL;
in vec3 vWorld;
in float vDist;
out vec4 o;
uniform float uDensity, uAlpha, uPhase, uRim;
uniform vec3 uBark, uBirch, uLeaf;
// the sun's direction in the view (screen right, screen up, towards the eye)
uniform vec3 uLight;
${NOISE}
void main() {
  vec2 pa = vP - vA, ba = vB - vA;
  float bb = max(dot(ba, ba), 1e-6);
  float hRaw = dot(pa, ba) / bb;
  float h = clamp(hRaw, 0., 1.);
  vec2 off = pa - ba * h;
  float d = length(off);
  float w = mix(vW.x, vW.y, h);
  float cov;
  if (w >= 1.) cov = clamp(w * .5 - d + .5, 0., 1.);
  else {
    if (hRaw < 0. || hRaw > 1.) discard;
    cov = w * clamp(1. - d, 0., 1.);
  }
  if (cov <= .002) discard;
  // round wood: the normal across the branch (a is -1 … 1 from one edge to the other), lit by the
  // sun where it is behind the fog, with the sky's soft light from above all round; backlit, the
  // edges catch it
  vec2 nn = normalize(vec2(-ba.y, ba.x) + 1e-6);
  if (nn.x < 0.) nn = -nn;
  float a = clamp(dot(off, nn) / max(w * .5, .5), -1., 1.);
  vec3 N = vec3(nn * a, sqrt(max(0., 1. - a * a)));
  float dif = max(0., dot(N, uLight));
  float sky = .5 + .5 * N.y;
  float round = w > 1.5 ? 1. : smoothstep(.5, 1.5, w);
  float lit = mix(.85, .38 + .5 * dif + .22 * sky + .35 * pow(abs(a), 5.) * uRim, round);
  vec3 birch = uBirch;
  if (vTL.x > .3) {
    // birch bark: dark lenticels wrapping round (thinning to the edges), black patches, a darker foot
    float wrap = sqrt(max(0., 1. - a * a));
    // (marks are long across the trunk and short up it: lenticels as fine lines, patches as bands)
    float band = vnoise(vec2(a * .9 + uPhase * 3.1, vWorld.y * 48.));
    float patchy = vnoise(vec2(a * .7 + uPhase, vWorld.y * 7.)) * .7 + vnoise(vec2(a * 3., vWorld.y * 20.)) * .3;
    birch *= 1. - .8 * smoothstep(.74, .8, band) * wrap - .8 * smoothstep(.7, .76, patchy) * wrap - .5 * exp(-vWorld.y * 1.2);
    // white bark is pale even in shade (the fog lights it from everywhere); the shadow side goes
    // cool and a little green (lichen, and the fog's own colour)
    float blit = mix(.9, .62 + .32 * dif + .16 * sky + .3 * pow(abs(a), 5.) * uRim, round);
    birch = mix(birch * blit, birch * vec3(.66, .74, .7) * (.7 + .2 * sky), (1. - dif) * .4 * round);
  } else birch *= lit;
  vec3 base = mix(uBark * lit, birch, vTL.x);
  base = mix(base, uLeaf, vTL.y);
  base = mix(base, uFogLow, (1. - cov) * .22);
  float fogD = 1. - exp(-vDist * uDensity * (1. + 1.5 * exp(-max(vWorld.y, 0.) * .35) * smoothstep(2., 14., vDist)));
  float fog = 1. - (1. - fogD) * (1. - mist(vWorld));
  o = vec4(mix(base, fogAt(vWorld.y), fog) * cov, cov) * uAlpha;
}`;

const POST_FS = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
uniform sampler2D uScene;
uniform vec2 uRes;
${NOISE}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texture(uScene, uv).rgb;
  // a soft film curve, blacks lifted into the fog's green
  c = mix(c, c * c * (3. - 2. * c), .3);
  c = mix(c, uFogLow, .04);
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
  path: readonly number[];
  sun: [number, number];
}

export interface CardDraw {
  live: false;
  card: Card;
  x: number;
  z: number;
  rect: [number, number, number, number];
  flip: boolean;
  phase: number;
  patch: boolean;
  alpha: number;
}
export interface LiveDraw {
  live: true;
  buffer: WebGLBuffer;
  count: number;
  x: number;
  z: number;
  rot: number;
  scale: number;
  phase: number;
  radius: number;
  height: number;
  alpha: number;
}
export type Draw = CardDraw | LiveDraw;

/** The photograph's colours. */
const PAL = {
  fogLow: [0.44, 0.54, 0.48],
  fogHigh: [0.53, 0.63, 0.57],
  bark: [0.1, 0.095, 0.08],
  birch: [0.7, 0.73, 0.68],
  leaf: [0.4, 0.27, 0.18],
  straw: [0.6, 0.48, 0.3],
  strawDark: [0.19, 0.14, 0.085],
  ground: [0.36, 0.28, 0.17],
};

export class Renderer {
  gl: WebGL2RenderingContext;
  private world: WebGLProgram;
  private card: WebGLProgram;
  private post: WebGLProgram;
  private liveProg: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private liveVao: WebGLVertexArrayObject;
  private scene: { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;
  private u = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is needed to walk here');
    this.gl = gl;
    this.world = this.compile(QUAD_VS, WORLD_FS);
    this.card = this.compile(CARD_VS, CARD_FS);
    this.post = this.compile(QUAD_VS, POST_FS);
    this.liveProg = this.compile(LIVE_VS, LIVE_FS);
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
    if (this.scene) {
      gl.deleteFramebuffer(this.scene.fbo);
      gl.deleteTexture(this.scene.tex);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    this.scene = { fbo, tex, w: W, h: H };
    return this.scene;
  }

  private common(p: WebGLProgram, v: View, look: Look) {
    const gl = this.gl;
    gl.uniform2f(this.loc(p, 'uRes'), this.canvas.width, this.canvas.height);
    gl.uniform1f(this.loc(p, 'uF'), v.f);
    gl.uniform1f(this.loc(p, 'uHz'), v.horizon);
    gl.uniform4f(this.loc(p, 'uCam'), v.x, v.z, v.eye, v.yaw);
    gl.uniform1f(this.loc(p, 'uT'), look.t);
    gl.uniform1ui(this.loc(p, 'uSeed'), look.seed >>> 0);
    gl.uniform3fv(this.loc(p, 'uFogLow'), PAL.fogLow);
    gl.uniform3fv(this.loc(p, 'uFogHigh'), PAL.fogHigh);
    gl.uniform1f(this.loc(p, 'uDensity'), look.density);
  }

  draw(v: View, look: Look, cards: Draw[]) {
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const scene = this.target();
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, W, H);
    gl.bindVertexArray(this.vao);
    // 1. fog and ground
    gl.disable(gl.BLEND);
    gl.useProgram(this.world);
    this.common(this.world, v, look);
    gl.uniform3f(this.loc(this.world, 'uPathA'), look.path[0], look.path[1], look.path[2]);
    gl.uniform3f(this.loc(this.world, 'uPathB'), look.path[3], look.path[4], look.path[5]);
    gl.uniform3fv(this.loc(this.world, 'uGround'), PAL.ground);
    gl.uniform3fv(this.loc(this.world, 'uStrawDark'), PAL.strawDark);
    gl.uniform3fv(this.loc(this.world, 'uStraw'), PAL.straw);
    gl.uniform2f(this.loc(this.world, 'uSun'), look.sun[0], look.sun[1]);
    gl.uniform4fv(this.loc(this.world, 'uShade'), look.shade);
    gl.uniform2fv(this.loc(this.world, 'uShadeOff'), look.shadeOff);
    gl.uniform1i(this.loc(this.world, 'uShadeN'), look.shadeN);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
        gl.uniform1f(this.loc(L, 'uRot'), c.rot);
        gl.uniform1f(this.loc(L, 'uScale'), c.scale);
        gl.uniform1f(this.loc(L, 'uPhase'), c.phase);
        gl.uniform1f(this.loc(L, 'uRadius'), c.radius);
        gl.uniform1f(this.loc(L, 'uHeight'), c.height);
        gl.uniform1f(this.loc(L, 'uAlpha'), c.alpha);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, c.count);
        continue;
      }
      use(p);
      gl.bindTexture(gl.TEXTURE_2D, c.card.tex);
      gl.uniform2f(this.loc(p, 'uAnchor'), c.x, c.z);
      gl.uniform4f(this.loc(p, 'uRect'), c.rect[0], c.rect[1], c.rect[2], c.rect[3]);
      gl.uniform1f(this.loc(p, 'uPhase'), c.phase);
      gl.uniform1f(this.loc(p, 'uKind'), c.patch ? 1 : 0);
      gl.uniform1f(this.loc(p, 'uFlip'), c.flip ? -1 : 1);
      gl.uniform1f(this.loc(p, 'uAlpha'), c.alpha);
      gl.drawArrays(gl.TRIANGLES, 0, COLS * ROWS * 6);
    }
    gl.bindVertexArray(this.vao);
    // 3. the film
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.post);
    this.common(this.post, v, look);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(this.loc(this.post, 'uScene'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

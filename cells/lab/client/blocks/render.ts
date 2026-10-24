/**
 * Drawing the blocks (WebGL2). The cells' meshes are gathered into chunks (8 cells a side), each one buffer, rebuilt
 * when one of its cells changes (a copy of meshes already made, no shaping). Each vertex carries its cell's centre
 * and when the cell last changed, so the vertex shader makes the touch felt: a new block springs up from nothing,
 * its neighbours settle as their shape changes, a taken block sinks away.
 *
 * The carving is drawn, not modelled: each vertex brings the code of the block whose surface it's on (its
 * surroundings, turned to their canonical orientation), the turn that brings it there, its joins, and how exposed and
 * how drawn in it is. The fragment shader turns the point into that orientation and cuts the face with the relief the
 * code chooses: by the 26 cells next to it, which kind (for a column, fluting or bands; for a ground course,
 * rustication; for a wall, panels, lozenges, roundels, slits or vermiculation; for what's carried over nothing,
 * chevrons or coffers); by all 124, its measures. Blocks with the same surroundings, however turned, are carved alike,
 * turned with them: the build rhymes where it repeats. Joints are drawn where two blocks meet; the stone is darker and
 * damp where it's sheltered and low, bleached and spotted with lichen on exposed tops.
 *
 * Lit by a low sun with soft shadows (a shadow map fitted to the build), a sky from above and warm light thrown back
 * from the ground, and the occlusion each vertex was shaped with. The ground is a pale plane the blocks stand on,
 * fading into the sky; what the finger is about to do is drawn on top: the block to come, faint and breathing, or the
 * one to go, reddened.
 */
import { VERTEX, type Mesh } from './shape';

/** a cell as drawn: its mesh, its centre, and the change it's in the middle of (t0 when; amp: 1 springing up, small a
 * settle, −1 sinking away) */
export type Drawn = { mesh: Mesh; x: number; y: number; z: number; t0: number; amp: number };

/** the mesh's vertex (position, normal, occlusion, measures, code, place), then the cell's centre, t0 and amp */
const STRIDE = VERTEX + 5;
const CH = 8;
export const chunkOf = (x: number, y: number, z: number) => `${Math.floor(x / CH)},${Math.floor(y / CH)},${Math.floor(z / CH)}`;

const SCALE = `
// (how big the cell is now: springing up from nothing with an overshoot; a settle, a small wobble; sinking away)
float scaleAt(float t, float amp) {
  if (amp > 0.5) { float s = 1. - exp(-t * 13.) * cos(t * 19.); return clamp(s, 0., 1.25); }
  if (amp > 0.) return 1. + amp * exp(-t * 9.) * sin(t * 34.);
  if (amp < 0.) return max(0., 1. - t / .16);
  return 1.;
}`;
const VS = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in float aAo; layout(location=3) in float aQ;
layout(location=4) in vec3 aCtr; layout(location=5) in vec2 aAnim; layout(location=6) in float aCode; layout(location=7) in float aAux; layout(location=8) in float aPlain;
uniform mat4 uVP, uLight; uniform float uTime;
out vec3 vPos, vRest, vNrm; out float vAo, vPlain; out vec4 vLs;
flat out vec3 vBlock; flat out uint vCode, vAux, vQ;
${SCALE}
void main() {
  float t = max(uTime - aAnim.x, 0.), s = scaleAt(t, aAnim.y);
  // (springing up from its foot, not its middle: a block lands on what's under it)
  vec3 p = aPos; p.y += .5; p *= s; p.y -= .5;
  vec3 w = aCtr + p;
  vPos = w; vRest = aCtr + aPos; vNrm = aNrm; vAo = aAo; vPlain = aPlain;
  // (the block whose surface this is: its place by the cell, its code, its turn and joins, its measures)
  uint aux = uint(aAux + .5), off = aux % 27u;
  vBlock = aCtr + vec3(float(off / 9u) - 1., float((off / 3u) % 3u) - 1., float(off % 3u) - 1.);
  vCode = uint(aCode + .5); vAux = aux; vQ = uint(aQ + .5);
  vLs = uLight * vec4(w + aNrm * .06, 1.);
  gl_Position = uVP * vec4(w, 1.);
}`;
const FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2DShadow;
in vec3 vPos, vRest, vNrm; in float vAo, vPlain; in vec4 vLs;
flat in vec3 vBlock; flat in uint vCode, vAux, vQ;
uniform sampler2DShadow uShadow; uniform vec3 uSun, uEye; uniform vec4 uOver; uniform float uGhost, uDebug;
out vec4 o;
float shadow() {
  vec3 l = vLs.xyz / vLs.w * .5 + .5;
  if (any(lessThan(l, vec3(0.))) || any(greaterThan(l, vec3(1.)))) return 1.;
  float s = 0.;
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) s += texture(uShadow, vec3(l.xy + vec2(a, b) / 2048. * 1.5, l.z - .0008));
  return s / 9.;
}
// ─── chance, fixed: by a number, or by a place ───
float rnd(uint n) { n ^= n >> 16; n *= 0x7feb352du; n ^= n >> 15; n *= 0x846ca68bu; n ^= n >> 16; return float(n & 0xffffffu) / 16777216.; }
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// (the canonical orientation: a mirror of x, then quarter turns about the vertical, as rules.ts turns surroundings)
vec3 canon(vec3 q, uint g) { if ((g & 4u) != 0u) q.x = -q.x; for (uint k = 0u; k < (g & 3u); k++) q = vec3(-q.z, q.y, q.x); return q; }

// ─── the reliefs: 1 the stone's face, lower cut into it, near 0 an opening. uv on a face (−½ … ½, v up), aa the
// size of a pixel there ───
float edgeOf(vec2 uv) { return .5 - max(abs(uv.x), abs(uv.y)); }
float drafted(vec2 uv, float w, float aa) { return mix(.75, 1., smoothstep(0., w + aa, edgeOf(uv))); }
float ashlar(vec2 uv, float aa) { return drafted(uv, .05, aa) - .06 * dot(uv, uv); }
float rustic(vec2 uv, vec3 p, float aa) { return mix(.3, 1., smoothstep(0., .16 + aa, edgeOf(uv))) * (.8 + .2 * noise(p * 9.)); }
float panel(vec2 uv, float m, float aa) {
  float e = edgeOf(uv), r = drafted(uv, .05, aa);
  r -= .4 * smoothstep(m - aa, m + aa, e);
  return r + .25 * (1. - smoothstep(0., .016 + aa, abs(e - m - .028)));
}
float lozenges(vec2 uv, float k, float aa) {
  vec2 g = uv * k; float w = .07 + aa * k;
  float a = abs(fract(g.x + g.y) - .5), b = abs(fract(g.x - g.y) - .5);
  float line = 1. - smoothstep(.5 - w, .5, max(a, b));
  return drafted(uv, .05, aa) - .4 * line * smoothstep(.04, .1, edgeOf(uv));
}
float roundel(vec2 uv, float petals, float aa) {
  float r = length(uv), a = atan(uv.y, uv.x);
  float ring = 1. - smoothstep(0., .022 + aa, abs(r - .25));
  float rose = (.5 + .5 * cos(a * petals)) * (1. - smoothstep(.12, .23, r));
  return drafted(uv, .05, aa) - .45 * ring - .3 * rose;
}
float slit(vec2 uv, float w, float aa) {
  vec2 c = uv - vec2(0., -.03);
  float d = max(abs(c.x) - w, abs(c.y) - .26);
  d = min(d, length(c - vec2(0., .26)) - w);
  return drafted(uv, .05, aa) * smoothstep(-aa, aa, d) + .02;
}
float vermic(vec2 uv, vec3 p, float aa) {
  float n = noise(p * 11.) + .5 * noise(p * 23. + 3.1);
  float worm = 1. - smoothstep(.05, .11 + aa * 4., abs(n - .78));
  return drafted(uv, .07, aa) - .35 * worm * smoothstep(.07, .13, edgeOf(uv));
}
float chevrons(vec2 uv, float k, float aa) {
  float z = abs(fract(uv.x * k) - .5) * 2. - .5, line = 0.;
  for (int i = -1; i <= 1; i += 2) line = max(line, 1. - smoothstep(0., .03 + aa, abs(uv.y - z * .22 - float(i) * .14)));
  return drafted(uv, .05, aa) - .45 * line;
}
float bands(vec2 uv, float at, float aa) {
  float r = 1.;
  for (int i = 0; i < 2; i++) r -= .38 * (1. - smoothstep(0., .022 + aa, abs(uv.y - at - float(i) * .07)));
  return r;
}
// (flutes round the block's own vertical, twelve: a turn or a mirror maps them onto themselves, so drums stacked in a
// column, whatever their turns, flute as one)
float flutes(vec3 q, float aa) {
  float a = atan(q.z, q.x) / 6.2831853 * 12., f = abs(fract(a) - .5) * 2.;
  float w = fwidth(a);
  return mix(1., mix(.35, 1., smoothstep(.08, .9, f)), 1. - smoothstep(.25, .5, w));
}

void main() {
  vec3 n = normalize(vNrm);
  uint g = (vAux / 27u) % 8u, joins = vAux / 216u;
  float E = float(vQ & 7u) / 7., col = float((vQ >> 3u) & 7u) / 7., wall = float((vQ >> 6u) & 7u) / 7.;
  bool carried = (vQ & 512u) != 0u, ground = (vQ & 1024u) != 0u;
  bool top = (vQ & 2048u) != 0u;
  float f1 = rnd(vCode & 0xfffu), f2 = rnd((vCode >> 12u) + 7919u), f3 = rnd(vCode * 2654435761u + 13u);
  vec3 q = vRest - vBlock, qc = canon(q, g), nc = canon(n, g), fq = fwidth(vRest);
  float aa = length(fq);
  // ─── the kind of carving, by the cells next to it and where it is (a column, what's carried, the ground course, a
  // top course, the field of a wall); its measures, by all of them ───
  int kind;
  if (carried) kind = f1 < .45 ? 8 : f1 < .7 ? 2 : 0;
  else if (col > .45) kind = f1 < .55 ? 9 : f1 < .8 ? 10 : 0;
  else if (ground) kind = f1 < .55 ? 1 : 0;
  else if (top) kind = f1 < .3 ? 3 : f1 < .5 ? 6 : f1 < .65 ? 4 : 0;
  else kind = f1 < .7 ? 0 : f1 < .8 ? 2 : f1 < .9 ? (wall > .3 ? 5 : 4) : 4;
  // (on each of its faces, as seen square on; then blended by how the surface faces)
  vec3 w3 = pow(abs(nc), vec3(4.)); w3 /= w3.x + w3.y + w3.z;
  float side = 1.;
  for (int axis = 0; axis < 2; axis++) {
    vec2 uv = axis == 0 ? vec2(qc.z * sign(nc.x + 1e-4), qc.y) : vec2(-qc.x * sign(nc.z + 1e-4), qc.y);
    float r = 1.;
    if (kind == 0) r = ashlar(uv, aa);
    else if (kind == 1) r = rustic(uv, vRest, aa);
    else if (kind == 2) r = panel(uv, .1 + .06 * f2, aa);
    else if (kind == 3) r = lozenges(uv, 2. + floor(f2 * 3.), aa);
    else if (kind == 4) r = roundel(uv, 5. + floor(f2 * 5.), aa);
    else if (kind == 5) r = slit(uv, .035 + .03 * f2, aa);
    else if (kind == 6) r = vermic(uv, vRest, aa);
    else if (kind == 8) r = chevrons(uv, 2. + floor(f2 * 3.), aa);
    else if (kind == 9) r = flutes(qc, aa);
    else if (kind == 10) r = bands(uv, .26 + .14 * f2, aa);
    side = axis == 0 ? r : mix(side, r, w3.z / max(w3.x + w3.z, 1e-4));
  }
  // (tops: flagged, faintly; undersides of what's carried: coffered)
  float level = nc.y > 0. ? mix(1., ashlar(qc.xz, aa), .5) : carried ? panel(qc.xz, .12, aa) : ashlar(qc.xz, aa);
  float relief = mix(side, level, w3.y);
  // (where it meets another block, and where it's as near one block as another, plain: so where the carving goes from
  // one block's to the next doesn't show; and where a pixel's too big for it)
  float plain = vPlain;
  vec3 jd = vec3(1.);
  if ((joins & 1u) != 0u) jd.x = min(jd.x, abs(q.x - .5));
  if ((joins & 2u) != 0u) jd.x = min(jd.x, abs(q.x + .5));
  if ((joins & 4u) != 0u) jd.y = min(jd.y, abs(q.y - .5));
  if ((joins & 8u) != 0u) jd.y = min(jd.y, abs(q.y + .5));
  if ((joins & 16u) != 0u) jd.z = min(jd.z, abs(q.z - .5));
  if ((joins & 32u) != 0u) jd.z = min(jd.z, abs(q.z + .5));
  vec3 across = 1. - abs(n);
  plain *= 1. - max(max(across.x * (1. - smoothstep(.03, .15, jd.x)), across.y * (1. - smoothstep(.03, .15, jd.y))), across.z * (1. - smoothstep(.03, .15, jd.z)));
  relief = mix(1., relief, plain * (1. - smoothstep(.035, .09, aa)));
  // ─── joints, where it meets another block: a fine line ───
  vec3 jl = across * (1. - smoothstep(vec3(.006), .006 + fq, jd));
  // (fainter as a pixel grows past it, so from afar the build isn't a grid)
  float joint = max(max(jl.x, jl.y), jl.z) * (1. - .7 * smoothstep(.012, .05, aa));
  // ─── the relief as light falls on it: the surface tilted by how the cut changes across it ───
  float hgt = relief * .035;
  vec3 dpx = dFdx(vRest), dpy = dFdy(vRest);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dFdx(hgt) * r1 + dFdy(hgt) * r2);
  n = normalize(abs(det) * n - grad);
  if (uDebug > 1.5 && uDebug < 2.5) { o = vec4(n * .5 + .5, 1.); return; }
  // ─── the stone ───
  // (a little different block to block: blocks that rhyme are cut from the same bed)
  vec3 base = vec3(.90, .87, .81) * mix(vec3(1.), mix(vec3(1., .985, .955), vec3(.965, .975, .99), f3) * (.97 + .05 * f2), plain);
  if (uDebug > 2.5) base = vec3(.35 + .6 * f1, .35 + .6 * f2, .35 + .6 * f3);
  // (sheltered and low: damp, darker, a little green; exposed tops bleached, with lichen)
  float damp = clamp((1. - E) * (1. - smoothstep(-.5, 1.5, vRest.y)) * (1. - .5 * vAo), 0., 1.);
  base = mix(base, base * vec3(.8, .84, .74), damp * .55);
  float up = smoothstep(.55, .95, n.y) * E;
  base = mix(base, vec3(.93, .92, .88), up * .3);
  base = mix(base, vec3(.84, .74, .52), smoothstep(.68, .74, noise(vRest * 13.)) * up * .45);
  // (what's cut is darker; an opening, dark)
  base *= mix(.7, 1., relief) * (1. - .7 * smoothstep(.12, .03, relief)) * (1. - .4 * joint);
  vec3 alb = pow(base, vec3(2.2));
  float nl = dot(n, uSun), sh = uDebug > .5 ? 1. : shadow();
  vec3 sun = vec3(1., .9, .76) * 2.4 * max(nl, 0.) * sh;
  vec3 sky = vec3(.55, .62, .74) * (.6 + .4 * n.y), bounce = vec3(.62, .52, .42) * .35 * max(-n.y * .5 + .5, 0.);
  vec3 c = alb * (sun + (sky + bounce) * vAo);
  // (a soft sheen at a glance, as a stone worn smooth by hands)
  vec3 v = normalize(uEye - vPos); c += vec3(.04) * pow(1. - max(dot(n, v), 0.), 4.) * vAo;
  c = c / (1. + c * .55); c = pow(c, vec3(1. / 2.2));
  c = mix(c, uOver.rgb, uOver.a);
  o = vec4(c, uGhost > 0. ? uGhost : 1.);
}`;
const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=4) in vec3 aCtr; layout(location=5) in vec2 aAnim;
uniform mat4 uLight; uniform float uTime;
${SCALE}
void main() { float s = scaleAt(max(uTime - aAnim.x, 0.), aAnim.y); vec3 p = aPos; p.y += .5; p *= s; p.y -= .5; gl_Position = uLight * vec4(aCtr + p, 1.); }`;

const SHADOW_FS = `#version 300 es
precision mediump float; out vec4 o; void main() { o = vec4(1.); }`;
const GROUND_VS = `#version 300 es
layout(location=0) in vec2 aXZ; uniform mat4 uVP, uLight; uniform vec3 uFocus; out vec3 vPos; out vec4 vLs;
void main() { vec3 w = vec3(aXZ.x * 400. + uFocus.x, -.5, aXZ.y * 400. + uFocus.z); vPos = w; vLs = uLight * vec4(w, 1.); gl_Position = uVP * vec4(w, 1.); }`;
const GROUND_FS = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 vPos; in vec4 vLs; uniform sampler2DShadow uShadow; uniform vec3 uFocus, uSky, uCursor; uniform float uCursorOn;
out vec4 o;
void main() {
  vec3 l = vLs.xyz / vLs.w * .5 + .5; float sh = 1.;
  if (all(greaterThan(l, vec3(0.))) && all(lessThan(l, vec3(1.)))) { sh = 0.; for (int a = -2; a <= 2; a++) for (int b = -2; b <= 2; b++) sh += texture(uShadow, vec3(l.xy + vec2(a, b) / 2048. * 2., l.z - .002)); sh /= 25.; }
  vec3 g = vec3(.86, .84, .79) * (.72 + .28 * sh);
  // (the grid, faint, only near where the finger is: where a block would go)
  vec2 q = abs(fract(vPos.xz + .5) - .5); float line = 1. - smoothstep(.0, .025, min(q.x, q.y));
  float near = uCursorOn * (1. - smoothstep(1.5, 4.5, length(vPos.xz - uCursor.xz)));
  g = mix(g, g * .82, line * near);
  float d = length(vPos.xz - uFocus.xz);
  o = vec4(mix(g, uSky, smoothstep(14., 60., d)), 1.);
}`;
const SKY_VS = `#version 300 es
out vec2 vUv; void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); vUv = p * .5 + .5; gl_Position = vec4(p, .9999, 1.); }`;
const SKY_FS = `#version 300 es
precision mediump float; in vec2 vUv; uniform vec3 uSky; out vec4 o; void main() { o = vec4(mix(uSky * .96, uSky * 1.03, vUv.y), 1.); }`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [t, s] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const sh = gl.createShader(t)!; gl.shaderSource(sh, s); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader');
    gl.attachShader(p, sh);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

type Chunk = { vao: WebGLVertexArrayObject; vb: WebGLBuffer; ib: WebGLBuffer; count: number };

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private main: WebGLProgram; private shadowP: WebGLProgram; private groundP: WebGLProgram; private skyP: WebGLProgram;
  private chunks = new Map<string, Chunk>();
  private ghost: Chunk | null = null;
  private mark: Chunk | null = null;
  private groundVao: WebGLVertexArrayObject;
  private shadowTex: WebGLTexture; private shadowFb: WebGLFramebuffer;
  readonly sky = [0.93, 0.92, 0.9];
  /** 1: no shadows, 2: normals, 3: each block coloured by its code (blocks that rhyme, alike) */
  debug = 0;
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance', desynchronized: true } as WebGLContextAttributes);
    if (!gl) throw new Error('WebGL2 is needed');
    this.gl = gl;
    this.main = compile(gl, VS, FS); this.shadowP = compile(gl, SHADOW_VS, SHADOW_FS); this.groundP = compile(gl, GROUND_VS, GROUND_FS); this.skyP = compile(gl, SKY_VS, SKY_FS);
    this.groundVao = gl.createVertexArray()!; gl.bindVertexArray(this.groundVao);
    const gb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, gb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.shadowTex = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, 2048, 2048);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.shadowFb = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  private build(cells: Drawn[], into?: Chunk): Chunk | null {
    const gl = this.gl;
    let nv = 0, ni = 0;
    for (const c of cells) { nv += c.mesh.v.length / VERTEX; ni += c.mesh.i.length; }
    if (!ni) { if (into) this.drop(into); return null; }
    const v = new Float32Array(nv * STRIDE), ix = new Uint32Array(ni);
    let vo = 0, io = 0;
    for (const c of cells) {
      const m = c.mesh, n = m.v.length / VERTEX, base = vo;
      for (let q = 0; q < n; q++) {
        const s = q * VERTEX, d = (vo + q) * STRIDE;
        for (let k = 0; k < VERTEX; k++) v[d + k] = m.v[s + k];
        v[d + VERTEX] = c.x; v[d + VERTEX + 1] = c.y; v[d + VERTEX + 2] = c.z; v[d + VERTEX + 3] = c.t0; v[d + VERTEX + 4] = c.amp;
      }
      for (let q = 0; q < m.i.length; q++) ix[io + q] = m.i[q] + base;
      vo += n; io += m.i.length;
    }
    const ch = into ?? { vao: gl.createVertexArray()!, vb: gl.createBuffer()!, ib: gl.createBuffer()!, count: 0 };
    gl.bindVertexArray(ch.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, ch.vb); gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ch.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ix, gl.DYNAMIC_DRAW);
    const F = 4 * STRIDE;
    const at = (loc: number, size: number, off: number) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, F, off * 4); };
    at(0, 3, 0); at(1, 3, 3); at(2, 1, 6); at(3, 1, 7); at(6, 1, 8); at(7, 1, 9); at(8, 1, 10); at(4, 3, VERTEX); at(5, 2, VERTEX + 3);
    gl.bindVertexArray(null);
    ch.count = ni;
    return ch;
  }
  private drop(c: Chunk) { const gl = this.gl; gl.deleteVertexArray(c.vao); gl.deleteBuffer(c.vb); gl.deleteBuffer(c.ib); }
  /** a chunk's cells, drawn again */
  setChunk(id: string, cells: Drawn[]) {
    const had = this.chunks.get(id), c = this.build(cells, had);
    if (c) this.chunks.set(id, c); else this.chunks.delete(id);
  }
  clearChunks() { for (const c of this.chunks.values()) this.drop(c); this.chunks.clear(); }
  /** what the finger is about to add (faint, breathing) */
  setGhost(cells: Drawn[]) { if (this.ghost) this.drop(this.ghost); this.ghost = cells.length ? this.build(cells) : null; }
  /** what the finger is about to take (reddened) */
  setMark(cells: Drawn[]) { if (this.mark) this.drop(this.mark); this.mark = cells.length ? this.build(cells) : null; }

  draw(o: { vp: Float32Array; eye: number[]; light: Float32Array; sun: number[]; time: number; focus: number[]; cursor: number[] | null; ghostAlpha: number }) {
    const gl = this.gl, c = this.canvas;
    const w = Math.round(c.clientWidth * Math.min(devicePixelRatio, 2)), h = Math.round(c.clientHeight * Math.min(devicePixelRatio, 2));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    // ─── the sun's view ───
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb); gl.viewport(0, 0, 2048, 2048);
    gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
    gl.useProgram(this.shadowP);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.shadowP, 'uLight'), false, o.light); gl.uniform1f(gl.getUniformLocation(this.shadowP, 'uTime'), o.time);
    for (const ch of this.chunks.values()) { gl.bindVertexArray(ch.vao); gl.drawElements(gl.TRIANGLES, ch.count, gl.UNSIGNED_INT, 0); }
    gl.cullFace(gl.BACK);
    // ─── the picture ───
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    gl.clearColor(this.sky[0], this.sky[1], this.sky[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.useProgram(this.skyP); gl.uniform3fv(gl.getUniformLocation(this.skyP, 'uSky'), this.sky); gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    // (the ground)
    gl.useProgram(this.groundP);
    const G = (n: string) => gl.getUniformLocation(this.groundP, n);
    gl.uniformMatrix4fv(G('uVP'), false, o.vp); gl.uniformMatrix4fv(G('uLight'), false, o.light); gl.uniform3fv(G('uFocus'), o.focus); gl.uniform3fv(G('uSky'), this.sky);
    gl.uniform1i(G('uShadow'), 0); gl.uniform3fv(G('uCursor'), o.cursor ?? [0, 0, 0]); gl.uniform1f(G('uCursorOn'), o.cursor ? 1 : 0);
    gl.disable(gl.CULL_FACE); gl.bindVertexArray(this.groundVao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.enable(gl.CULL_FACE);
    // (the blocks)
    gl.useProgram(this.main);
    const U = (n: string) => gl.getUniformLocation(this.main, n);
    gl.uniformMatrix4fv(U('uVP'), false, o.vp); gl.uniformMatrix4fv(U('uLight'), false, o.light); gl.uniform1f(U('uTime'), o.time);
    gl.uniform3fv(U('uSun'), o.sun); gl.uniform3fv(U('uEye'), o.eye); gl.uniform1i(U('uShadow'), 0);
    gl.uniform4f(U('uOver'), 0, 0, 0, 0); gl.uniform1f(U('uGhost'), 0); gl.uniform1f(U('uDebug'), this.debug);
    for (const ch of this.chunks.values()) { gl.bindVertexArray(ch.vao); gl.drawElements(gl.TRIANGLES, ch.count, gl.UNSIGNED_INT, 0); }
    // (what's to go, reddened, drawn over itself)
    if (this.mark) {
      gl.depthFunc(gl.LEQUAL); gl.uniform4f(U('uOver'), 0.78, 0.25, 0.2, 0.45);
      gl.bindVertexArray(this.mark.vao); gl.drawElements(gl.TRIANGLES, this.mark.count, gl.UNSIGNED_INT, 0);
      gl.depthFunc(gl.LESS); gl.uniform4f(U('uOver'), 0, 0, 0, 0);
    }
    // (what's to come: faint, breathing)
    if (this.ghost) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.uniform4f(U('uOver'), 0.55, 0.68, 0.86, 0.25); gl.uniform1f(U('uGhost'), o.ghostAlpha);
      gl.bindVertexArray(this.ghost.vao); gl.drawElements(gl.TRIANGLES, this.ghost.count, gl.UNSIGNED_INT, 0);
      gl.depthMask(true); gl.disable(gl.BLEND); gl.uniform1f(U('uGhost'), 0); gl.uniform4f(U('uOver'), 0, 0, 0, 0);
    }
    gl.bindVertexArray(null);
  }
}

// ─── a little matrix arithmetic ───
export function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = (2 * far * near) / (near - far);
  return m;
}
export function ortho(l: number, r: number, b: number, t: number, n: number, f: number): Float32Array {
  const m = new Float32Array(16);
  m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n); m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); m[15] = 1;
  return m;
}
export function lookAt(eye: number[], at: number[], up: number[]): Float32Array {
  const z = norm([eye[0] - at[0], eye[1] - at[1], eye[2] - at[2]]), x = norm(cross(up, z)), y = cross(z, x), m = new Float32Array(16);
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2]; m[1] = y[0]; m[5] = y[1]; m[9] = y[2]; m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
  m[12] = -dot(x, eye); m[13] = -dot(y, eye); m[14] = -dot(z, eye); m[15] = 1;
  return m;
}
export function mul(a: Float32Array, b: Float32Array): Float32Array {
  const m = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; m[i * 4 + j] = s; }
  return m;
}
export function invert(m: Float32Array): Float32Array {
  const a = m, inv = new Float32Array(16);
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
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  for (let i = 0; i < 16; i++) inv[i] /= det || 1;
  return inv;
}
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

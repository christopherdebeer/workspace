/**
 * Drawing the blocks (WebGL2), as a diorama: seen square on to the diagonal from above (no perspective), in the dark,
 * the build standing on a slab of ground cut square round it, its section showing.
 *
 * The cells' meshes are gathered into chunks (8 cells a side), each one buffer, rebuilt when one of its cells changes
 * (a copy of meshes already made, no shaping). Each vertex carries its cell's centre and when the cell last changed,
 * so the vertex shader makes the touch felt: a new block springs up from nothing, its neighbours settle as their shape
 * changes, a taken block sinks away.
 *
 * Each small cube's face is coloured by its stuff and by where it is, cube by cube: limestone laid in courses, each
 * cube a little different, dust on its tops and damp low down; trim paler; tile in a mosaic of turquoise, cobalt and
 * cream; wood; glass lit warm from within; water; leaves and flowers; paving in squares; earth. Lit by a low warm sun
 * with shadows, a dim sky, light thrown back from the ground, and each corner's occlusion; what the finger is about to
 * do is drawn on top: the block to come, faint and breathing, or the one to go, reddened.
 */
import { VERTEX, type Mesh } from './shape';

/** a cell as drawn: its mesh, its centre, and the change it's in the middle of (t0 when; amp: 1 springing up, small a
 * settle, −1 sinking away) */
export type Drawn = { mesh: Mesh; x: number; y: number; z: number; t0: number; amp: number };

/** the mesh's vertex (position; face, stuff and occlusion), then the cell's centre, t0 and amp */
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
const COMMON = `
float h3(vec3 p) { p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float shadowAt(sampler2DShadow map, vec4 ls) {
  vec3 l = ls.xyz / ls.w * .5 + .5;
  if (any(lessThan(l, vec3(0.))) || any(greaterThan(l, vec3(1.)))) return 1.;
  float s = 0.;
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) s += texture(map, vec3(l.xy + vec2(a, b) / 2048. * 1.2, l.z - .0006));
  return s / 9.;
}
// (warm sun, a dim sky, warm light thrown back from below; the display's curve)
vec3 light(vec3 alb, vec3 n, float sh, float ao, vec3 sun) {
  float nl = max(dot(n, sun), 0.);
  vec3 c = alb * (vec3(1., .84, .62) * 3.2 * nl * sh + vec3(.26, .31, .40) * (.55 + .45 * n.y) * ao + vec3(.42, .32, .22) * .35 * max(-n.y * .5 + .5, 0.) * ao);
  return c;
}
vec3 display(vec3 c) { c = c / (1. + c * .6); return pow(c, vec3(1. / 2.2)); }`;

const VS = `#version 300 es
precision highp float; precision highp int;
layout(location=0) in vec3 aPos; layout(location=1) in float aPack;
layout(location=4) in vec3 aCtr; layout(location=5) in vec2 aAnim;
uniform mat4 uVP, uLight; uniform float uTime;
out vec3 vPos, vRest; out float vAo; out vec4 vLs;
flat out int vFace, vStuff;
const vec3 NORMALS[6] = vec3[6](vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 1, 0), vec3(0, -1, 0), vec3(0, 0, 1), vec3(0, 0, -1));
${SCALE}
void main() {
  float t = max(uTime - aAnim.x, 0.), s = scaleAt(t, aAnim.y);
  // (springing up from its foot, not its middle: a block lands on what's under it)
  vec3 p = aPos; p.y += .5; p *= s; p.y -= .5;
  vec3 w = aCtr + p;
  int pack = int(aPack + .5);
  vFace = pack % 6; vStuff = (pack / 6) % 16; vAo = float(pack / 96) / 3.;
  vPos = w; vRest = aCtr + aPos;
  vLs = uLight * vec4(w + NORMALS[vFace] * .03, 1.);
  gl_Position = uVP * vec4(w, 1.);
}`;
const FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2DShadow;
in vec3 vPos, vRest; in float vAo; in vec4 vLs;
flat in int vFace, vStuff;
uniform sampler2DShadow uShadow; uniform vec3 uSun; uniform vec4 uOver; uniform float uGhost, uDebug, uTime;
out vec4 o;
const vec3 NORMALS[6] = vec3[6](vec3(1, 0, 0), vec3(-1, 0, 0), vec3(0, 1, 0), vec3(0, -1, 0), vec3(0, 0, 1), vec3(0, 0, -1));
${COMMON}
void main() {
  vec3 n = NORMALS[vFace];
  // (the small cube this face is of, in twelfths of a cell; and where on its face, across and up)
  vec3 wm = (vRest + .5) * 12., cube = floor(wm - n * .5);
  vec2 uv = vFace < 2 ? wm.zy : vFace < 4 ? wm.xz : wm.xy, cell = floor(uv), in2 = fract(uv);
  float j = h3(cube), j2 = h3(cube + 17.3);
  bool side = vFace != 2 && vFace != 3;
  vec3 alb; vec3 glow = vec3(0.);
  int m = vStuff;
  if (m == 1 || m == 2 || m == 11) {
    // (limestone, laid in courses three cubes high, a joint every four across, each course offset; trim and plaster
    // paler and finer)
    alb = m == 1 ? vec3(.82, .74, .60) : m == 2 ? vec3(.90, .84, .72) : vec3(.92, .88, .79);
    alb *= .93 + .1 * j;
    if (m == 1 && side) {
      float course = floor(cube.y / 3.), joint = mod(cube.y, 3.) == 2. ? .92 : 1.;
      if (mod(cell.x + course * 2., 4.) == 0.) joint *= .94;
      alb *= joint;
    }
    if (vFace == 2) alb = mix(alb, vec3(.93, .89, .80), .35);
  } else if (m == 3) {
    // (tile: a mosaic of lozenges, cream lines between turquoise and cobalt, a little gold)
    float a = mod(cell.x + cell.y, 4.), b = mod(cell.x - cell.y + 400., 4.);
    float tone = mod(floor((cell.x + cell.y) / 4.) + floor((cell.x - cell.y + 400.) / 4.), 2.);
    alb = a == 0. || b == 0. ? vec3(.88, .85, .74) : tone < .5 ? vec3(.10, .52, .55) : vec3(.10, .22, .50);
    if (j > .93) alb = vec3(.80, .62, .28);
    alb *= .92 + .14 * j2;
  } else if (m == 4) {
    alb = vec3(.36, .16, .09) * (.85 + .25 * j) * (abs(in2.x - .5) > .42 ? .7 : 1.);
  } else if (m == 5) {
    // (glass lit from within, in a lattice)
    float bar = max(step(.86, abs(in2.x - .5) * 2.), step(.86, abs(in2.y - .5) * 2.));
    alb = mix(vec3(.20, .12, .07), vec3(.25, .12, .06), bar);
    glow = mix(vec3(1., .66, .30) * (1.6 + .5 * j), vec3(0.), bar);
  } else if (m == 6) {
    float rip = noise(vec3(vRest.xz * 3., uTime * .4));
    alb = mix(vec3(.05, .38, .40), vec3(.12, .62, .62), rip * .6 + .2);
  } else if (m == 7) {
    alb = mix(vec3(.09, .22, .08), vec3(.22, .38, .13), j) * (vFace == 2 ? 1.15 : 1.);
  } else if (m == 8) alb = vec3(.30, .22, .15) * (.85 + .2 * j);
  else if (m == 9) {
    // (paving: squares four cubes across, each a little different)
    vec2 sq = floor(cell / 4.);
    bool seam = mod(cell.x, 4.) == 0. || mod(cell.y, 4.) == 0.;
    alb = vec3(.76, .69, .56) * (.92 + .12 * h3(vec3(sq, 3.))) * (seam ? .9 : 1.);
  } else if (m == 10) alb = vec3(.28, .19, .12) * (.85 + .25 * j);
  else alb = mix(vec3(.78, .14, .16), vec3(.92, .62, .70), j2) ;
  // (weather: damp and dark low down where it's sheltered)
  float low = 1. - smoothstep(-.5, .6, vRest.y);
  alb *= 1. - .18 * low * (1. - vAo);
  if (uDebug > 2.5) alb = vec3(.4 + .5 * h3(vec3(float(m))), .4 + .5 * h3(vec3(float(m) + 3.)), .4 + .5 * h3(vec3(float(m) + 7.)));
  float sh = uDebug > .5 ? 1. : shadowAt(uShadow, vLs);
  float ao = mix(.3, 1., vAo);
  vec3 c = light(pow(alb, vec3(2.2)), n, sh, ao, uSun) + glow;
  if (m == 6) c += vec3(.5, .45, .35) * pow(max(dot(reflect(-uSun, n), normalize(vec3(.6, 1., .6))), 0.), 40.) * sh;
  c = display(c);
  if (uDebug > 1.5 && uDebug < 2.5) c = n * .5 + .5;
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
// (the slab the build stands on: a box from uLo to uHi, its top ground, its sides the ground cut through)
const SLAB_VS = `#version 300 es
layout(location=0) in vec3 aUnit; layout(location=1) in vec3 aNrm;
uniform mat4 uVP, uLight; uniform vec3 uLo, uHi;
out vec3 vPos, vN; out vec4 vLs;
void main() { vec3 w = mix(uLo, uHi, aUnit); vPos = w; vN = aNrm; vLs = uLight * vec4(w + aNrm * .03, 1.); gl_Position = uVP * vec4(w, 1.); }`;
const SLAB_FS = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 vPos, vN; in vec4 vLs;
uniform sampler2DShadow uShadow; uniform vec3 uSun, uLo, uHi, uCursor; uniform float uCursorOn, uDebug;
out vec4 o;
${COMMON}
void main() {
  vec3 n = normalize(vN), alb;
  vec3 cube = floor((vPos + .5) * 12. - n * .5);
  float j = h3(cube);
  if (n.y > .5) {
    // (the top: packed earth and gravel, a cube at a time; the lattice faint near the finger)
    alb = mix(vec3(.62, .55, .42), vec3(.70, .63, .50), j) * (.9 + .15 * noise(vPos * 1.7));
    vec2 q = abs(fract(vPos.xz + .5) - .5);
    float line = 1. - smoothstep(.0, .03, min(q.x, q.y));
    alb *= 1. - .22 * line * uCursorOn * (1. - smoothstep(1.5, 4., length(vPos.xz - uCursor.xz)));
  } else {
    // (the cut: a band of topsoil, then stone in courses, darker going down)
    float depth = uHi.y - vPos.y;
    alb = depth < .14 ? vec3(.36, .27, .18) : vec3(.62, .54, .42) * (mod(floor((vPos.y + 4.) * 6.), 2.) == 0. ? .93 : 1.);
    alb *= (.88 + .2 * j) * (1. - .45 * smoothstep(.2, 1.1, depth));
  }
  float sh = uDebug > .5 ? 1. : shadowAt(uShadow, vLs);
  o = vec4(display(light(pow(alb, vec3(2.2)), n, sh, 1., uSun)), 1.);
}`;
const SKY_VS = `#version 300 es
out vec2 vUv; void main() { vec2 p = vec2(gl_VertexID == 1 ? 3. : -1., gl_VertexID == 2 ? 3. : -1.); vUv = p * .5 + .5; gl_Position = vec4(p, .9999, 1.); }`;
const SKY_FS = `#version 300 es
precision mediump float; in vec2 vUv; out vec4 o;
void main() { float d = length(vUv - vec2(.5, .55)); o = vec4(mix(vec3(.075, .075, .08), vec3(.025, .025, .028), smoothstep(.1, .85, d)), 1.); }`;

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
  private main: WebGLProgram; private shadowP: WebGLProgram; private slabP: WebGLProgram; private skyP: WebGLProgram;
  private chunks = new Map<string, Chunk>();
  private ghost: Chunk | null = null;
  private mark: Chunk | null = null;
  private slabVao: WebGLVertexArrayObject;
  private shadowTex: WebGLTexture; private shadowFb: WebGLFramebuffer;
  /** 1: no shadows, 2: normals, 3: each stuff its own colour */
  debug = 0;
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance', desynchronized: true } as WebGLContextAttributes);
    if (!gl) throw new Error('WebGL2 is needed');
    this.gl = gl;
    this.main = compile(gl, VS, FS); this.shadowP = compile(gl, SHADOW_VS, SHADOW_FS); this.slabP = compile(gl, SLAB_VS, SLAB_FS); this.skyP = compile(gl, SKY_VS, SKY_FS);
    // (a unit box, its faces' normals)
    const box: number[] = [];
    const faces: Array<[number[], number[][]]> = [
      [[0, 1, 0], [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]]], [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
      [[1, 0, 0], [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]], [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
      [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]], [[0, 0, -1], [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]],
    ];
    for (const [nrm, q] of faces) for (const c of [0, 1, 2, 0, 2, 3]) box.push(...q[c], ...nrm);
    this.slabVao = gl.createVertexArray()!; gl.bindVertexArray(this.slabVao);
    const sb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, sb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(box), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
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
    at(0, 3, 0); at(1, 1, 3); at(4, 3, VERTEX); at(5, 2, VERTEX + 3);
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

  draw(o: { vp: Float32Array; light: Float32Array; sun: number[]; time: number; slab: { lo: number[]; hi: number[] }; cursor: number[] | null; ghostAlpha: number }) {
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
    gl.clearColor(0.04, 0.04, 0.045, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST); gl.useProgram(this.skyP); gl.bindVertexArray(null); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    // (the slab)
    gl.useProgram(this.slabP);
    const G = (n: string) => gl.getUniformLocation(this.slabP, n);
    gl.uniformMatrix4fv(G('uVP'), false, o.vp); gl.uniformMatrix4fv(G('uLight'), false, o.light); gl.uniform3fv(G('uSun'), o.sun);
    gl.uniform3fv(G('uLo'), o.slab.lo); gl.uniform3fv(G('uHi'), o.slab.hi); gl.uniform1i(G('uShadow'), 0); gl.uniform1f(G('uDebug'), this.debug);
    gl.uniform3fv(G('uCursor'), o.cursor ?? [0, 0, 0]); gl.uniform1f(G('uCursorOn'), o.cursor ? 1 : 0);
    gl.bindVertexArray(this.slabVao); gl.drawArrays(gl.TRIANGLES, 0, 36);
    // (the blocks)
    gl.useProgram(this.main);
    const U = (n: string) => gl.getUniformLocation(this.main, n);
    gl.uniformMatrix4fv(U('uVP'), false, o.vp); gl.uniformMatrix4fv(U('uLight'), false, o.light); gl.uniform1f(U('uTime'), o.time);
    gl.uniform3fv(U('uSun'), o.sun); gl.uniform1i(U('uShadow'), 0);
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
      gl.uniform4f(U('uOver'), 0.55, 0.78, 0.86, 0.3); gl.uniform1f(U('uGhost'), o.ghostAlpha);
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

/**
 * Taohua: the drawing, as a print. The scene is drawn into two images at once (its colours, flat
 * as inks, lit only a little; and, for each pixel, which way its surface faces and what it's made
 * of) with its depth; then a last pass over the screen draws it as printed on paper: ink lines
 * where one thing stands in front of another or a surface turns sharply (coral, not black, about
 * the blossom), the paper's cream and its fibres and grain under everything, and the far hill
 * fading into the paper.
 *
 * The blossom is puffs: each a disc turned to the eye, its edge ragged, its depth a dome so puffs
 * meet as clouds do, stippled with lighter and darker pinks and a fleck of red; petals are little
 * teardrops, lying on the ground or turning as they fall.
 */
import { INK, M, STRIDE } from './world';

export type V3 = [number, number, number];
export type M4 = Float32Array;

const COMMON = `
float hash3(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
const vec3 PAPER = vec3(${INK.paper.map((v) => v.toFixed(3)).join(', ')});
const vec3 L = normalize(vec3(.55, .75, -.35));
`;

const SOLID_VS = `#version 300 es
in vec3 aPos; in vec3 aNor; in vec3 aCol; in float aMat;
uniform mat4 uVP, uModel; uniform vec3 uEye;
out vec3 vW; out vec3 vN; out vec3 vC; flat out int vM;
void main() {
  vec4 w = uModel * vec4(aPos, 1.);
  vW = w.xyz; vN = normalize(mat3(uModel) * aNor); vC = aCol; vM = int(aMat + .5);
  // (the thinner branches drawn nearer the eye than they are: they show through the blossom, as ink over colour)
  if (vM == ${M.twig}) w.xyz += normalize(uEye - w.xyz) * 1.6;
  gl_Position = uVP * w;
}`;
const SOLID_FS = `#version 300 es
precision highp float;
in vec3 vW; in vec3 vN; in vec3 vC; flat in int vM;
uniform vec3 uEye; uniform sampler2D uPlaque;
layout(location = 0) out vec4 oC;
layout(location = 1) out vec4 oA;
${COMMON}
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 c = vC;
  float lit = .9 + .14 * max(dot(n, L), 0.);
  if (vM == ${M.ground}) {
    // the ground: the paper itself, a breath of shade in its hollows
    c = PAPER * (.985 + .03 * noise(vW * .35));
    if (vC.b > 0.) {
      // (a patch of shade: deep in its middle, its edge broken, stippled away into the paper)
      float r = length(vC.rg) * (1. + .35 * (noise(vW * 1.7) - .5));
      float f = 1. - smoothstep(.25, 1., r);
      if (hash3(vec3(floor(gl_FragCoord.xy), 2.)) > f * 1.6) discard;
      c *= 1. - vC.b * (.55 + .45 * f) * (.85 + .3 * noise(vW * 6.));
    }
    lit = 1.;
  } else if (vM == ${M.grass}) {
    // grass: an olive ink, a little uneven
    c *= .8 + .35 * noise(vW * 9.);
    lit = 1.;
  } else if (vM == ${M.step} || vM == ${M.stone}) {
    // stone: pale, a fine crack here and there, a darker grain; a wall's face laid in squared blocks
    float crack = smoothstep(.985, 1., noise(vec3(vW.xz * 2.2, vW.y * 3.)));
    c *= (.95 + .07 * noise(vW * 4.)) * (1. - .45 * crack);
    if (vM == ${M.stone} && abs(n.y) < .5) {
      float row = vW.y / .32, course = floor(row);
      float along = (vW.x * n.z - vW.z * n.x) / .62 + course * .5;
      float joint = max(1. - smoothstep(.0, .07, min(fract(row), 1. - fract(row))), 1. - smoothstep(.0, .05, min(fract(along), 1. - fract(along))));
      c *= 1. - .38 * joint;
    }
    lit = vM == ${M.step} ? 1. : .9 + .1 * max(dot(n, L), 0.);
  } else if (vM == ${M.rock}) {
    // rock: black; where it turns up to the light, grey laid on with a dry brush, in strokes, broken
    float up = n.y * .8 + n.x * .3 - n.z * .15;
    float stroke = smoothstep(.42, .7, noise(vW * vec3(9., 2.2, 3.5) + n * 2.)) * .7 + smoothstep(.55, .8, noise(vW * 14.)) * .3;
    float grey = smoothstep(.38, .82, up) * (.35 + .65 * stroke);
    c = mix(vec3(.13, .125, .12), vec3(.58, .58, .56), grey) * (.92 + .16 * noise(vW * 5.));
    lit = 1.;
  } else if (vM == ${M.trunk} || vM == ${M.twig}) {
    // bark: ink, a pale streak down the side that faces the light, broken
    float streak = smoothstep(.45, .7, dot(n, normalize(vec3(.8, 0., -.6)))) * smoothstep(.3, .55, noise(vW * vec3(5., 1.2, 5.)));
    c = mix(c, vec3(.86, .82, .74), streak * .9);
    lit = 1.;
  } else if (vM == ${M.tile} || vM == ${M.ridge}) {
    // glazed tiles: teal, in courses, a darker line between, a gloss where the light falls
    if (vC.b > 1.5) {
      // a roof: its tiles in channels running down from the ridge, a darker line between, rows across faintly
      vec3 teal = vec3(${INK.tile.map((v) => v.toFixed(3)).join(', ')});
      float ch = fract(vC.r), row = fract(vC.g);
      float gap = 1. - smoothstep(.0, .12, ch) * smoothstep(1., .82, ch);
      c = teal * (1.03 - .12 * smoothstep(.3, .5, ch) * smoothstep(.9, .6, ch)) * (1. - .35 * gap) * (1. - .08 * (1. - smoothstep(.0, .1, row)));
    } else {
      float course = smoothstep(.0, .12, fract(vW.y * 5.5)) * smoothstep(.0, .1, fract(dot(vW.xz, vec2(.7071)) * 3.5));
      c *= mix(.7, 1.05, course);
    }
    if (!gl_FrontFacing) c *= .62;
    lit = .85 + .3 * max(dot(n, L), 0.);
  } else if (vM == ${M.plaque}) {
    c = texture(uPlaque, vC.rg).rgb;
    lit = 1.;
  } else if (vM == ${M.wall} || vM == ${M.red}) {
    c *= .97 + .04 * noise(vW * 6.);
  }
  c *= lit;
  // (far off, it fades into the paper)
  float d = length(vW - uEye);
  c = mix(c, PAPER, smoothstep(45., 95., d) * .85);
  oC = vec4(c, 1.);
  oA = vec4(n * .5 + .5, float(vM) / 31.);
}`;

/** a blossom puff: a disc to the eye, a dome in depth, its edge ragged, stippled */
const PUFF_VS = `#version 300 es
in vec2 aQ;
in vec3 iPos; in float iRad; in float iShade; in float iSeed;
uniform mat4 uVP; uniform vec3 uRight, uUp;
out vec2 vQ; flat out vec3 vP; flat out float vR, vS, vSeed;
void main() {
  vQ = aQ * 1.18; vP = iPos; vR = iRad; vS = iShade; vSeed = iSeed;
  gl_Position = uVP * vec4(iPos + (uRight * vQ.x + uUp * vQ.y) * iRad, 1.);
}`;
const PUFF_FS = `#version 300 es
precision highp float;
in vec2 vQ; flat in vec3 vP; flat in float vR, vS, vSeed;
uniform mat4 uVP; uniform vec3 uRight, uUp, uFwd, uEye;
uniform vec4 uCut; uniform vec2 uView;
layout(location = 0) out vec4 oC;
layout(location = 1) out vec4 oA;
${COMMON}
void main() {
  // (a window through the blossom to the walker: what's nearer the eye than them, about them on the glass, thins away)
  vec2 ndc = gl_FragCoord.xy / uView * 2. - 1.;
  float cut = 1. - smoothstep(uCut.z * .6, uCut.z, length((ndc - uCut.xy) * vec2(uView.x / uView.y, 1.)));
  if (cut > 0. && length(vP - uEye) < uCut.w - 1.5 && hash3(vec3(gl_FragCoord.xy, 1.)) < cut) discard;
  float a = atan(vQ.y, vQ.x), r = length(vQ);
  // (its edge: a cloud of little flowers, scalloped, ragged, each puff its own)
  float edge = 1. - .09 * noise(vec3(cos(a) * 2.5, sin(a) * 2.5, vSeed * 40.)) - .07 * abs(sin(a * 7. + vSeed * 30.)) - .04 * abs(sin(a * 17. + vSeed * 11.));
  if (r > edge) discard;
  float rr = r / edge;
  // its tones: pale where it's lit, at its top; coral; deep rose under, and at its lower edge
  float tone = clamp(vS * .8 + .32 * vQ.y + .05 * vQ.x + .06, 0., 1.);
  vec3 hi = vec3(.985, .76, .7), mid = vec3(.95, .56, .5), lo = vec3(.87, .4, .37), deep = vec3(.76, .28, .29);
  vec3 c = tone > .62 ? mix(mid, hi, smoothstep(.62, .82, tone)) : tone > .32 ? mix(lo, mid, smoothstep(.32, .5, tone)) : mix(deep, lo, smoothstep(.08, .32, tone));
  // its texture: a mottle of blossom, and over it fine stipple, little flowers lighter and darker, a few red
  float mot = noise(vec3(vQ * 4.5, vSeed * 9.));
  c = mix(c, mix(lo, hi, tone), (mot - .5) * .5);
  vec2 g = vQ * 13. + vSeed * 17.;
  vec2 cell = floor(g), f = fract(g) - .5;
  float h = hash3(vec3(cell, vSeed * 7.));
  vec2 jit = vec2(hash3(vec3(cell, 3.)), hash3(vec3(cell, 5.))) - .5;
  float size = .1 + .12 * hash3(vec3(cell, 9.));
  float dot1 = 1. - smoothstep(size, size + .08, length(f - jit * .55));
  if (h > .58) c = mix(c, hi * 1.02, dot1 * .75);
  else if (h < .1) c = mix(c, vec3(.78, .18, .2), dot1 * .85);
  else if (h < .3) c = mix(c, deep, dot1 * .45);
  // (a darker rim, faintly, where the puff turns away)
  c *= 1. - .1 * smoothstep(.75, 1., rr);
  float z = sqrt(max(0., 1. - rr * rr));
  vec3 w = vP + (uRight * vQ.x + uUp * vQ.y) * vR - uFwd * z * vR * .8;
  vec4 clip = uVP * vec4(w, 1.);
  gl_FragDepth = clip.z / clip.w * .5 + .5;
  float d = length(w - uEye);
  c = mix(c, PAPER, smoothstep(45., 95., d) * .85);
  oC = vec4(c, 1.);
  vec3 n = normalize(uRight * vQ.x + uUp * vQ.y - uFwd * z);
  oA = vec4(n * .5 + .5, ${M.blossom}. / 31.);
}`;

/** a petal: a little teardrop, lying flat or turning in the air */
const PETAL_VS = `#version 300 es
in vec2 aQ;
in vec3 iPos; in float iSize; in float iTurn; in float iShade; in float iTilt;
uniform mat4 uVP;
out vec2 vQ; flat out float vS;
void main() {
  vQ = aQ; vS = iShade;
  vec2 q = aQ * iSize * vec2(.7, 1.);
  float c = cos(iTurn), s = sin(iTurn);
  vec3 u = vec3(c, 0., s), v = vec3(-s, 0., c);
  // (tilted up out of the ground's plane as it turns in the air)
  v = normalize(v * cos(iTilt) + vec3(0., 1., 0.) * sin(iTilt));
  gl_Position = uVP * vec4(iPos + u * q.x + v * q.y, 1.);
}`;
const PETAL_FS = `#version 300 es
precision highp float;
in vec2 vQ; flat in float vS;
layout(location = 0) out vec4 oC;
layout(location = 1) out vec4 oA;
void main() {
  vec3 c;
  if (vS > .5) {
    // (a whole flower: five petals round a darker heart)
    float a = atan(vQ.y, vQ.x), r = length(vQ * vec2(1. / .7, 1.));
    float pet = .55 + .45 * abs(cos(a * 2.5));
    if (r > pet) discard;
    c = mix(vec3(.8, .22, .2), vec3(.93, .45, .4), smoothstep(.15, .5, r));
  } else {
    // (a petal: round at one end, pointed at the other, a notch in its round end)
    float y = vQ.y * .5 + .5;
    float w = sin(3.1416 * pow(y, .8)) * .95;
    if (abs(vQ.x) > w || (y > .9 && abs(vQ.x) < .12)) discard;
    c = mix(vec3(.83, .27, .23), vec3(.95, .55, .5), vS * 2.);
  }
  oC = vec4(c, 1.);
  oA = vec4(.5, 1., .5, ${M.petal}. / 31.);
}`;

/** the print: ink lines, the paper under it all */
const POST_VS = `#version 300 es
out vec2 vUV;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2. - 1., 0., 1.); }`;
const POST_FS = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uC, uA, uD;
uniform vec2 uPx; uniform float uNear, uFar, uLine;
out vec4 o;
${COMMON}
float lin(float d) { float z = d * 2. - 1.; return 2. * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
int matAt(vec2 uv) { return int(texture(uA, uv).a * 31. + .5); }
void main() {
  vec2 px = uPx * uLine;
  float d0 = texture(uD, vUV).r;
  vec3 c = texture(uC, vUV).rgb;
  if (d0 >= 1.) c = PAPER;
  // ink: where depth jumps (one thing before another), where the surface turns, where one thing meets another
  float z0 = lin(d0);
  vec4 a0 = texture(uA, vUV);
  vec3 n0 = a0.xyz * 2. - 1.;
  int m0 = int(a0.a * 31. + .5);
  float ink = 0., coral = 0.;
  vec2 offs[4] = vec2[4](vec2(px.x, 0.), vec2(-px.x, 0.), vec2(0., px.y), vec2(0., -px.y));
  for (int i = 0; i < 4; i++) {
    vec2 uv = vUV + offs[i];
    float di = texture(uD, uv).r;
    float zi = di >= 1. ? 1e4 : lin(di);
    vec4 ai = texture(uA, uv);
    vec3 ni = ai.xyz * 2. - 1.;
    int mi = int(ai.a * 31. + .5);
    float jump = smoothstep(.025, .06, (zi - z0) / z0);
    float turn = smoothstep(.35, .6, 1. - dot(n0, ni));
    float meet = mi != m0 ? 1. : 0.;
    bool soft = m0 == ${M.blossom} || mi == ${M.blossom};
    bool none = m0 == ${M.petal} || mi == ${M.petal} || (m0 == ${M.ground} && mi == ${M.ground}) || (m0 == ${M.grass} && (mi == ${M.ground} || mi == ${M.grass})) || (mi == ${M.grass} && m0 == ${M.ground});
    if (none) continue;
    if (soft) coral = max(coral, max(jump, meet * .6));
    else ink = max(ink, max(jump, max(turn * (m0 == ${M.ground} ? 0. : .8), meet)));
  }
  if (d0 >= 1.) { ink = 0.; coral = 0.; }
  c = mix(c, vec3(.74, .32, .31), coral * .38);
  c = mix(c, vec3(.16, .13, .12), ink * .85);
  // the paper: its mottle, its fibres, its grain
  vec2 sp = gl_FragCoord.xy;
  float mottle = noise(vec3(sp * .004, 1.)) * .5 + noise(vec3(sp * .013, 2.)) * .3;
  float fibre = smoothstep(.72, .9, noise(vec3(sp.x * .02, sp.y * .35, 3.))) * .5 + smoothstep(.75, .92, noise(vec3(sp.x * .3, sp.y * .025, 4.))) * .5;
  float grain = hash3(vec3(sp, 7.)) - .5;
  c *= .97 + .05 * mottle;
  c = mix(c, c * .93, fibre * .25);
  c += grain * .035;
  // (the print's edge, a shade darker)
  vec2 e = vUV - .5;
  c *= 1. - .1 * smoothstep(.35, .75, length(e * vec2(1.2, 1.)));
  o = vec4(c, 1.);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

export interface Drawn { vao: WebGLVertexArrayObject; bufs: WebGLBuffer[]; count: number }

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private solid: WebGLProgram; private puff: WebGLProgram; private petal: WebGLProgram; private post: WebGLProgram;
  private quadBuf: WebGLBuffer;
  private fb: WebGLFramebuffer | null = null; private texC: WebGLTexture | null = null; private texA: WebGLTexture | null = null; private texD: WebGLTexture | null = null;
  private w = 0; private h = 0;
  plaque: WebGLTexture;
  private u = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no WebGL2');
    this.gl = gl;
    this.solid = compile(gl, SOLID_VS, SOLID_FS);
    this.puff = compile(gl, PUFF_VS, PUFF_FS);
    this.petal = compile(gl, PETAL_VS, PETAL_FS);
    this.post = compile(gl, POST_VS, POST_FS);
    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    this.plaque = gl.createTexture()!;
  }
  private loc(p: WebGLProgram, name: string) {
    let m = this.u.get(p);
    if (!m) this.u.set(p, (m = new Map()));
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(p, name));
    return m.get(name)!;
  }

  /** the plaque's face, from a canvas */
  setPlaque(src: HTMLCanvasElement) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.plaque);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }

  /** A solid mesh (STRIDE floats a vertex). */
  mesh(verts: Float32Array): Drawn {
    const gl = this.gl;
    const vao = gl.createVertexArray()!, buf = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const at = (name: string, size: number, off: number) => {
      const l = gl.getAttribLocation(this.solid, name);
      if (l < 0) return;
      gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, STRIDE * 4, off * 4);
    };
    at('aPos', 3, 0); at('aNor', 3, 3); at('aCol', 3, 6); at('aMat', 1, 9);
    gl.bindVertexArray(null);
    return { vao, bufs: [buf], count: verts.length / STRIDE };
  }
  /** Instances of a quad (puffs: 6 floats each; petals: 7), as the program wants them. */
  instances(kind: 'puff' | 'petal', data: Float32Array, dynamic = false): Drawn {
    const gl = this.gl, p = kind === 'puff' ? this.puff : this.petal;
    const per = kind === 'puff' ? 6 : 7;
    const vao = gl.createVertexArray()!, buf = gl.createBuffer()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    const q = gl.getAttribLocation(p, 'aQ');
    gl.enableVertexAttribArray(q); gl.vertexAttribPointer(q, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    const names = kind === 'puff' ? [['iPos', 3], ['iRad', 1], ['iShade', 1], ['iSeed', 1]] : [['iPos', 3], ['iSize', 1], ['iTurn', 1], ['iShade', 1], ['iTilt', 1]];
    let off = 0;
    for (const [name, size] of names as Array<[string, number]>) {
      const l = gl.getAttribLocation(p, name);
      if (l >= 0) { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, per * 4, off * 4); gl.vertexAttribDivisor(l, 1); }
      off += size;
    }
    gl.bindVertexArray(null);
    return { vao, bufs: [buf], count: data.length / per };
  }
  update(d: Drawn, data: Float32Array, per: number) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, d.bufs[0]);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    d.count = data.length / per;
  }
  drop(d: Drawn | null) {
    if (!d) return;
    this.gl.deleteVertexArray(d.vao);
    for (const b of d.bufs) this.gl.deleteBuffer(b);
  }

  private targets(w: number, h: number) {
    if (w === this.w && h === this.h && this.fb) return;
    const gl = this.gl;
    this.w = w; this.h = h;
    for (const t of [this.texC, this.texA, this.texD]) if (t) gl.deleteTexture(t);
    if (this.fb) gl.deleteFramebuffer(this.fb);
    const tex = (internal: number, format: number, type: number) => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      return t;
    };
    this.texC = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.texA = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
    this.texD = tex(gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
    this.fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texC, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.texA, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.texD, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * The frame: the solids (the world's bands, the walker by its own placing), the blossom, the
   * petals; then the print.
   */
  frame(view: { vp: M4; eye: V3; right: V3; up: V3; fwd: V3; near: number; far: number; dpr: number; cut: [number, number, number, number] },
    solids: Array<{ d: Drawn; model?: M4 }>, puffs: Drawn[], petals: Drawn[]) {
    const gl = this.gl, W = this.canvas.width, H = this.canvas.height;
    this.targets(W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, W, H);
    gl.clearBufferfv(gl.COLOR, 0, [...INK.paper, 1]);
    gl.clearBufferfv(gl.COLOR, 1, [0.5, 1, 0.5, 0]);
    gl.clearBufferfv(gl.DEPTH, 0, [1]);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    gl.useProgram(this.solid);
    gl.uniformMatrix4fv(this.loc(this.solid, 'uVP'), false, view.vp);
    gl.uniform3fv(this.loc(this.solid, 'uEye'), view.eye);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.plaque);
    gl.uniform1i(this.loc(this.solid, 'uPlaque'), 0);
    for (const s of solids) {
      gl.uniformMatrix4fv(this.loc(this.solid, 'uModel'), false, s.model ?? I);
      gl.bindVertexArray(s.d.vao);
      gl.drawArrays(gl.TRIANGLES, 0, s.d.count);
    }
    gl.useProgram(this.puff);
    gl.uniformMatrix4fv(this.loc(this.puff, 'uVP'), false, view.vp);
    for (const [k, v] of [['uRight', view.right], ['uUp', view.up], ['uFwd', view.fwd], ['uEye', view.eye]] as Array<[string, V3]>) gl.uniform3fv(this.loc(this.puff, k), v);
    gl.uniform4fv(this.loc(this.puff, 'uCut'), view.cut);
    gl.uniform2f(this.loc(this.puff, 'uView'), W, H);
    for (const p of puffs) { gl.bindVertexArray(p.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, p.count); }
    gl.useProgram(this.petal);
    gl.uniformMatrix4fv(this.loc(this.petal, 'uVP'), false, view.vp);
    for (const p of petals) { gl.bindVertexArray(p.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, p.count); }
    gl.bindVertexArray(null);
    // the print
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.post);
    const tx = [this.texC, this.texA, this.texD];
    ['uC', 'uA', 'uD'].forEach((n, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tx[i]); gl.uniform1i(this.loc(this.post, n), i); });
    gl.uniform2f(this.loc(this.post, 'uPx'), 1 / W, 1 / H);
    gl.uniform1f(this.loc(this.post, 'uNear'), view.near);
    gl.uniform1f(this.loc(this.post, 'uFar'), view.far);
    gl.uniform1f(this.loc(this.post, 'uLine'), Math.max(1, view.dpr * 0.9));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}

// ─── matrices ────────────────────────────────────────────────────────────────────────────────────
export function perspective(fovy: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
export function lookAt(eye: V3, target: V3): { m: M4; right: V3; up: V3; fwd: V3 } {
  const f = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const m = new Float32Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0,
    -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]), -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]), f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2], 1]);
  return { m, right: r, up: u, fwd: f };
}
export function mulM(a: M4, b: M4): M4 {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; }
  return o;
}
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

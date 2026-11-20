/**
 * The paint stack: a frame drawn as a painting rather than a render. The scene is drawn off screen (its colour and its
 * depth), then painted in screen space, where a painter's marks live:
 *
 *   strokes   an anisotropic Kuwahara filter (after Kyprianidis et al.): the colour gathered into flat, brush-shaped
 *             patches that follow the picture's own structure (the direction its edges run), at half resolution, the
 *             brush larger with distance, so far things simplify into shapes instead of blurring
 *   edges     darkened where the depth jumps or the colour does, as pigment pools at the edge of a wash; the picture
 *             sampled through a slight wobble anchored to the world (so the hand's unevenness stays put as the eye moves)
 *   canvas    a paper grain the colour settles into (granulation), fixed to the canvas as a painting's paper is
 *
 * A look asks for it (LookDef.paint) and sets how much of each. Everything else about the look stays in its own shader.
 */
export interface PaintSettings {
  /** the brush's radius, in pixels of a 1080-pixel-high frame (0: no strokes) */
  brush: number;
  /** how much the brush grows toward the far distance (×) */
  far?: number;
  /** edge darkening where the depth jumps, and where the colour does (0..1) */
  edges?: number; colourEdges?: number;
  /** the wobble, in pixels of a 1080-pixel-high frame */
  wobble?: number;
  /** the paper's grain, and how much the pigment settles into it (0..1) */
  grain?: number;
}

const QUAD = `#version 300 es
in vec2 aPos; out vec2 vUv; void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;
const COMMON = `
float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
`;
/** the structure tensor: which way the picture's edges run, and how strongly, at each pixel */
const TENSOR = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uC; uniform vec2 uPx; out vec4 o;
void main() {
  vec3 gx = (-1.0 * texture(uC, vUv + uPx * vec2(-1, -1)).rgb - 2.0 * texture(uC, vUv + uPx * vec2(-1, 0)).rgb - 1.0 * texture(uC, vUv + uPx * vec2(-1, 1)).rgb
           + 1.0 * texture(uC, vUv + uPx * vec2(1, -1)).rgb + 2.0 * texture(uC, vUv + uPx * vec2(1, 0)).rgb + 1.0 * texture(uC, vUv + uPx * vec2(1, 1)).rgb) / 4.0;
  vec3 gy = (-1.0 * texture(uC, vUv + uPx * vec2(-1, -1)).rgb - 2.0 * texture(uC, vUv + uPx * vec2(0, -1)).rgb - 1.0 * texture(uC, vUv + uPx * vec2(1, -1)).rgb
           + 1.0 * texture(uC, vUv + uPx * vec2(-1, 1)).rgb + 2.0 * texture(uC, vUv + uPx * vec2(0, 1)).rgb + 1.0 * texture(uC, vUv + uPx * vec2(1, 1)).rgb) / 4.0;
  // (stored scaled into 0..1, with F about the middle, so it fits any colour buffer)
  o = vec4(clamp(vec3(dot(gx, gx), dot(gx, gy), dot(gy, gy)) * vec3(4.0, 2.0, 4.0) + vec3(0.0, 0.5, 0.0), 0.0, 1.0), 1.0);
}`;
/** the strokes: an anisotropic Kuwahara filter, eight sectors on an ellipse turned along the structure */
const KUWAHARA = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uC; uniform sampler2D uT; uniform sampler2D uD; uniform vec2 uPx; uniform float uR; uniform float uFar; out vec4 o;
float lin(float d) { return 0.15 / (1.0 - d * 0.99999); }
void main() {
  // (the structure, smoothed over its neighbourhood, then its main direction and how marked it is)
  vec3 t = vec3(0.0); float wsum = 0.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) { float w = exp(-float(i * i + j * j) / 4.0); vec3 s = texture(uT, vUv + uPx * vec2(i, j) * 1.5).rgb; t += w * vec3(s.x / 4.0, (s.y - 0.5) / 2.0, s.z / 4.0); wsum += w; }
  t /= wsum;
  float E = t.x, F = t.y, G = t.z, root = sqrt((E - G) * (E - G) + 4.0 * F * F), l1 = 0.5 * (E + G + root), l2 = 0.5 * (E + G - root);
  vec2 dir = vec2(l1 - E, -F); dir = length(dir) > 1e-6 ? normalize(dir) : vec2(0.0, 1.0);
  float A = l1 + l2 > 1e-6 ? (l1 - l2) / (l1 + l2) : 0.0;
  // (the brush: larger in the distance)
  float dist = clamp((lin(texture(uD, vUv).r) - 2.0) / 60.0, 0.0, 1.0), r = uR * mix(1.0, uFar, dist);
  // (the figure, marked in alpha, painted with a fine brush and only from itself; the rest never from it)
  float a0 = texture(uC, vUv).a; if (a0 < 0.5) r = min(r, 1.2);
  float a = r * (1.0 + A), b = r / (1.0 + A);
  float phi = atan(dir.y, dir.x), cs = cos(phi), sn = sin(phi);
  mat2 SR = mat2(1.0 / a, 0.0, 0.0, 1.0 / b) * mat2(cs, -sn, sn, cs);
  vec3 m[8], s[8]; float w[8];
  for (int k = 0; k < 8; k++) { m[k] = vec3(0.0); s[k] = vec3(0.0); w[k] = 0.0; }
  int R = int(ceil(max(a, b)));
  for (int j = -8; j <= 8; j++) for (int i = -8; i <= 8; i++) {
    if (abs(i) > R || abs(j) > R) continue;
    vec2 v = SR * vec2(i, j); float d2 = dot(v, v); if (d2 > 1.0) continue;
    vec4 cc = texture(uC, vUv + uPx * vec2(i, j)); if (abs(cc.a - a0) > 0.5) continue; vec3 c = cc.rgb;
    float ang = atan(v.y, v.x) + 3.14159265; int k = int(floor(ang / 0.785398)) % 8;
    float g = exp(-d2 * 2.5);
    m[k] += c * g; s[k] += c * c * g; w[k] += g;
    // (the middle belongs to every sector)
  }
  vec3 acc = vec3(0.0); float wt = 0.0;
  for (int k = 0; k < 8; k++) {
    if (w[k] <= 0.0) continue;
    vec3 mean = m[k] / w[k], var = abs(s[k] / w[k] - mean * mean);
    float sig = sqrt(var.r + var.g + var.b) * 255.0, wk = 1.0 / (1.0 + pow(sig, 8.0) * 1e-9);
    acc += mean * wk; wt += wk;
  }
  o = vec4(wt > 0.0 ? acc / wt : texture(uC, vUv).rgb, a0);
}`;
/** the finish: the strokes through the hand's wobble, the edges darkened, the paper under it */
const FINISH = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uK; uniform sampler2D uD; uniform vec2 uPx; uniform vec2 uRes; uniform mat4 uInv;
uniform float uEdges; uniform float uColourEdges; uniform float uWobble; uniform float uGrain; out vec4 o;
${COMMON}
float lin(float d) { return 0.15 / (1.0 - d * 0.99999); }
vec3 world(vec2 uv, float d) { vec4 p = uInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
void main() {
  float d0 = texture(uD, vUv).r;
  // (the wobble: the picture sampled a little aside, by a noise fixed to the world where it's seen, so it stays put)
  vec3 W = world(vUv, d0); float L = lin(d0), f = 1.0 / max(0.6, L * 0.06);
  vec2 wob = (vec2(noise(W.xz * f + W.y * f * 0.7), noise(W.zy * f + 13.1 + W.x * f * 0.3)) - 0.5) * uWobble * uPx;
  vec2 uv = vUv + (d0 < 0.9999 ? wob : vec2(0.0));
  vec3 c = texture(uK, uv).rgb;
  // (edges: where the depth jumps (a silhouette against what's behind), and where the colour does (a wash meeting another))
  float dl = 0.0;
  for (int k = 0; k < 4; k++) { vec2 e = uPx * 1.5 * vec2(k == 0 ? 1 : k == 1 ? -1 : 0, k == 2 ? 1 : k == 3 ? -1 : 0); dl = max(dl, abs(lin(texture(uD, uv + e).r) - L) / L); }
  vec3 cx = texture(uK, uv + vec2(uPx.x * 1.5, 0.0)).rgb - texture(uK, uv - vec2(uPx.x * 1.5, 0.0)).rgb, cy = texture(uK, uv + vec2(0.0, uPx.y * 1.5)).rgb - texture(uK, uv - vec2(0.0, uPx.y * 1.5)).rgb;
  float ce = length(cx) + length(cy);
  float edge = uEdges * smoothstep(0.04, 0.25, dl) + uColourEdges * smoothstep(0.06, 0.3, ce);
  c *= 1.0 - 0.32 * clamp(edge, 0.0, 1.0);
  // (the paper: fixed to the canvas, the pigment settling darker into its tooth, more in the mid tones than the lights)
  vec2 px = vUv * uRes;
  float tooth = noise(px * 0.45) * 0.6 + noise(px * 0.11 + 7.0) * 0.4, fibres = noise(vec2(px.x * 0.05, px.y * 0.9));
  float lum = dot(c, vec3(0.3, 0.59, 0.11)), mid = 1.0 - abs(lum - 0.5) * 1.4;
  c *= 1.0 - uGrain * (0.11 * (tooth - 0.5) * (0.5 + mid) + 0.025 * (fibres - 0.5));
  o = vec4(c, 1.0);
}`;

interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

export class Painter {
  private quad: WebGLVertexArrayObject;
  private pT: WebGLProgram; private pK: WebGLProgram; private pF: WebGLProgram;
  private u = new Map<WebGLProgram, Record<string, WebGLUniformLocation | null>>();
  /** the scene, drawn off screen: its colour and depth; and the half-size targets the strokes work in */
  scene: { fb: WebGLFramebuffer; colour: WebGLTexture; depth: WebGLTexture; w: number; h: number } | null = null;
  private tensor: Target | null = null; private strokes: Target | null = null;

  constructor(private gl: WebGL2RenderingContext, program: (vs: string, fs: string, attribs: string[]) => WebGLProgram) {
    this.pT = program(QUAD, TENSOR, ['aPos']); this.pK = program(QUAD, KUWAHARA, ['aPos']); this.pF = program(QUAD, FINISH, ['aPos']);
    for (const [p, names] of [[this.pT, ['uC', 'uPx']], [this.pK, ['uC', 'uT', 'uD', 'uPx', 'uR', 'uFar']], [this.pF, ['uK', 'uD', 'uPx', 'uRes', 'uInv', 'uEdges', 'uColourEdges', 'uWobble', 'uGrain']]] as const)
      this.u.set(p, Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)])));
    this.quad = gl.createVertexArray()!; gl.bindVertexArray(this.quad); gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
  }

  private tex(w: number, h: number, linear: boolean): WebGLTexture {
    const gl = this.gl, t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const f = linear ? gl.LINEAR : gl.NEAREST; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  private target(old: Target | null, w: number, h: number): Target {
    if (old && old.w === w && old.h === h) return old;
    const gl = this.gl; if (old) { gl.deleteFramebuffer(old.fb); gl.deleteTexture(old.tex); }
    const tex = this.tex(w, h, true), fb = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }

  /** ready the off-screen scene at (w, h) and bind it to be drawn into */
  begin(w: number, h: number): void {
    const gl = this.gl;
    if (!this.scene || this.scene.w !== w || this.scene.h !== h) {
      if (this.scene) { gl.deleteFramebuffer(this.scene.fb); gl.deleteTexture(this.scene.colour); gl.deleteTexture(this.scene.depth); }
      const colour = this.tex(w, h, true), depth = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, depth);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH24_STENCIL8, w, h, 0, gl.DEPTH_STENCIL, gl.UNSIGNED_INT_24_8, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colour, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
      this.scene = { fb, colour, depth, w, h };
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb); gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, w, h);
  }

  /** paint the off-screen scene into `rect` of the canvas (pixels, from the bottom left) */
  finish(rect: [number, number, number, number], inv: Float32Array, p: PaintSettings): void {
    const gl = this.gl, sc = this.scene!, hw = Math.max(1, sc.w >> 1), hh = Math.max(1, sc.h >> 1), scale = sc.h / 1080;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.STENCIL_TEST); gl.bindVertexArray(this.quad);
    const bind = (unit: number, t: WebGLTexture) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); };
    // (the structure, and the strokes, at half size)
    this.tensor = this.target(this.tensor, hw, hh); this.strokes = this.target(this.strokes, hw, hh);
    gl.viewport(0, 0, hw, hh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tensor.fb); gl.useProgram(this.pT); let u = this.u.get(this.pT)!;
    bind(0, sc.colour); gl.uniform1i(u.uC, 0); gl.uniform2f(u.uPx, 1 / hw, 1 / hh); gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.strokes.fb); gl.useProgram(this.pK); u = this.u.get(this.pK)!;
    bind(0, sc.colour); bind(1, this.tensor.tex); bind(2, sc.depth); gl.uniform1i(u.uC, 0); gl.uniform1i(u.uT, 1); gl.uniform1i(u.uD, 2);
    gl.uniform2f(u.uPx, 1 / hw, 1 / hh); gl.uniform1f(u.uR, Math.max(0.5, Math.min(7, (p.brush * scale) / 2))); gl.uniform1f(u.uFar, p.far ?? 1.6);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    // (the finish, into the canvas)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.enable(gl.SCISSOR_TEST); gl.scissor(...rect); gl.viewport(...rect);
    gl.useProgram(this.pF); u = this.u.get(this.pF)!;
    bind(0, this.strokes.tex); bind(1, sc.depth); gl.uniform1i(u.uK, 0); gl.uniform1i(u.uD, 1);
    gl.uniform2f(u.uPx, 1 / sc.w, 1 / sc.h); gl.uniform2f(u.uRes, sc.w, sc.h); gl.uniformMatrix4fv(u.uInv, false, inv);
    gl.uniform1f(u.uEdges, p.edges ?? 0.6); gl.uniform1f(u.uColourEdges, p.colourEdges ?? 0.35); gl.uniform1f(u.uWobble, (p.wobble ?? 2) * scale); gl.uniform1f(u.uGrain, p.grain ?? 0.6);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0); gl.bindVertexArray(null);
  }
}

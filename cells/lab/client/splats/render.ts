/**
 * Drawing splats with WebGL2 (it runs on every phone; WebGPU is where this goes next).
 *
 * Every splat is one quad, drawn instanced: 4 corners × n splats, in the order the sort gives (an instanced integer
 * attribute: the splat's index). Its data comes from a texture rather than vertex buffers, so re-sorting means
 * uploading only the order (4 bytes a splat), never the splats.
 *
 * - **The data texture** (RGBA32UI, 2 texels a splat): the centre's three floats as their bits and the colour packed
 *   in one uint; then the 3D covariance's six numbers as three pairs of half floats, and one more uint for a drawing's
 *   marks (stone.ts): its rank (8 bits), its kind (8), and the normal of the surface it lies on (16, octahedral).
 * - **The vertex shader** does the splat maths, per splat (the same for its 4 corners): take the centre into the
 *   camera; take the 3D covariance to a 2D one on the screen (Σ' = J W Σ Wᵀ Jᵀ: W the camera's rotation, J the
 *   perspective's local stretch at that point, its Jacobian); add a little (0.3 px²) so nothing is thinner than a pixel;
 *   find the 2D ellipse's axes (the eigenvectors of Σ', their lengths the square roots of its eigenvalues); and put
 *   the quad's corners out along them to 3 standard deviations. For a drawing it also decides how much of each mark is
 *   there: its rank against the detail asked (eased over a band, so marks fade rather than pop), or with `thin` a
 *   hash of its index against the same share kept (so the two ways of simplifying can be compared at the same number
 *   of marks); detail brought back round the points the brush touched; and for a contour mark, how near edge-on its
 *   surface is from here.
 * - **The fragment shader** is a Gaussian: how far the pixel is from the middle in standard deviations, r, and its
 *   opacity the splat's times exp(-r²/2). Blended premultiplied, over what's drawn already (back to front).
 * - **The occluder** (a drawing's own shape, shrunk a little) is drawn first into the depth buffer only: the splats are
 *   tested against it (not written), so marks on the far side of a face left blank are still hidden by it.
 *
 * `mode` shows the parts: 0 the picture; 1 each splat's 1σ and 2σ contours (its ellipse); 2 each one's footprint, solid
 * (the quad's reach, 3σ); 3 the centres only (the point cloud the splats grew from).
 */
const VS = () => `#version 300 es
precision highp float; precision highp int;
uniform highp usampler2D u_data;
uniform mat4 u_view, u_proj;
uniform vec2 u_focal, u_viewport;
uniform vec3 u_eye;
uniform float u_size, u_detail, u_share;
uniform int u_mode, u_thin, u_only;
uniform float u_feat[16];
// (Mist: the coarse density grid, the sun, which lighting, and the tiny network's numbers)
uniform highp sampler3D u_grid;
uniform vec3 u_sun;
uniform int u_light, u_diff;
uniform vec4 u_net[${Math.ceil(NET_SIZE / 4)}];
uniform vec2 u_ana;
in vec2 a_corner;
in uint a_index;
out vec4 v_color;
out vec2 v_r;
vec3 octDecode(vec2 e) {
  vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  return normalize(n);
}
float netAt(int i) { return u_net[i >> 2][i & 3]; }
// (one level of the density pyramid at a point: trilinear on exact texels, zero outside the box, as mist.ts's sampleGrid)
float gridAt(vec3 p, int L) {
  ivec3 n = textureSize(u_grid, L);
  vec3 f = (p - vec3(${BOX.x0.toFixed(3)}, ${BOX.y0.toFixed(3)}, ${BOX.z0.toFixed(3)})) / vec3(${(BOX.x1 - BOX.x0).toFixed(3)}, ${(BOX.y1 - BOX.y0).toFixed(3)}, ${(BOX.z1 - BOX.z0).toFixed(3)}) * vec3(n) - 0.5;
  ivec3 i0 = ivec3(floor(f)); vec3 t = f - floor(f); float r = 0.0;
  for (int c = 0; c < 8; c++) {
    ivec3 d = ivec3(c & 1, (c >> 1) & 1, c >> 2), q = i0 + d;
    if (any(lessThan(q, ivec3(0))) || any(greaterThanEqual(q, n))) continue;
    vec3 w = mix(1.0 - t, t, vec3(d));
    r += texelFetch(u_grid, q, L).r * w.x * w.y * w.z;
  }
  return r;
}
float hg(float c, float g) { return (1.0 - g * g) / (12.566 * pow(1.0 + g * g - 2.0 * g * c, 1.5)); }
float hash(uint x) { x = x * 747796405u + 2891336453u; x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u; x = (x >> 22u) ^ x; return float(x) / 4294967295.0; }
void main() {
  ivec2 t = ivec2(int(a_index & 1023u) * 2, int(a_index >> 10));
  uvec4 d0 = texelFetch(u_data, t, 0), d1 = texelFetch(u_data, t + ivec2(1, 0), 0);
  vec3 p = uintBitsToFloat(d0.xyz);
  vec4 cam = u_view * vec4(p, 1.0);
  vec4 clip = u_proj * cam;
  float bound = 1.2 * clip.w;
  gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  // (behind the camera, or well off the screen: no quad)
  if (-cam.z < 0.02 || clip.x < -bound || clip.x > bound || clip.y < -bound || clip.y > bound) return;
  v_color = vec4(float(d0.w & 255u), float((d0.w >> 8) & 255u), float((d0.w >> 16) & 255u), float(d0.w >> 24)) / 255.0;
  // (a drawing's mark: how much of it the detail keeps)
  float rank = float(d1.w & 255u) / 255.0;
  uint kind = (d1.w >> 8) & 15u, feature = (d1.w >> 12) & 15u;
  if (u_only >= 0 && int(kind) != u_only) return;
  vec3 sn = octDecode(vec2(float((d1.w >> 16) & 255u), float(d1.w >> 24)) / 127.5 - 1.0);
  // (a feature the brush has developed: its own marks brought back by their ranks, as far as it's been brushed)
  float detail = max(u_detail, feature > 0u ? u_feat[feature] : 0.0);
  // (kept by rank against the detail asked, or thinned evenly to the same share; and round what the brush touched, all of it
  // brought back by rank)
  float keep = u_thin == 1 ? smoothstep(1.0 - u_share - 0.03, 1.0 - u_share, hash(a_index) * 0.999) : smoothstep(1.0 - u_detail - 0.04, 1.0 - u_detail, rank);
  if (detail > u_detail + 0.001) keep = max(keep, smoothstep(1.0 - detail - 0.04, 1.0 - detail, rank));
  // (a contour mark: there only where its surface is near edge-on from here, eased over a range of angles)
  if (kind == 4u) {
    // (its second face's normal rides in its colour (it's always ink): drawn where the two faces are turned opposite
    // ways from the eye, eased in as the turning face passes edge-on)
    vec3 v = normalize(u_eye - p), n2 = octDecode(vec2(float(d0.w & 255u), float((d0.w >> 8) & 255u)) / 127.5 - 1.0);
    float s1 = dot(sn, v), s2 = dot(n2, v);
    keep *= s1 * s2 < 0.0 ? smoothstep(0.0, 0.12, min(abs(s1), abs(s2))) : 0.0;
    v_color.rgb = vec3(36.0, 31.0, 27.0) / 255.0;
  }
  // (a mist splat: its light by the chosen method: stored on it (the reference, or baked), the analytic formula, or the
  // tiny network, both from the same cheap features of the coarse grid)
  if (kind == 8u) {
    float L = v_color.r * 3.0, refL = v_color.g * 3.0;
    if (u_light > 0) {
      vec3 view = normalize(u_eye - p);
      // (Grassi's features: the mean density round it at six scales, toward the sun at the same six, the view–sun cosine)
      float f[13];
      for (int l = 0; l < 6; l++) f[l] = gridAt(p, l);
      ${SUN_TAPS.map((d, L) => `f[${6 + L}] = gridAt(p + u_sun * ${d.toFixed(4)}, ${L});`).join(' ')}
      f[12] = dot(view, u_sun);
      if (u_light == 1) {
        float tau = 0.0;
        ${SUN_TAPS.map((d, L) => `tau += f[${6 + L}] * ${(d * 0.5).toFixed(4)};`).join(' ')}
        L = u_ana.x * exp(-${SIGMA.toFixed(2)} * tau) * hg(f[12], 0.6) * 12.566 + u_ana.y * exp(-1.2 * f[3]);
      } else {
        // (the network: 13 → 16 → 16 → 2, squared ReLU, squared outputs (the sun's light and the sky's), summed; its
        // numbers in order w1 b1 w2 b2 w3 b3 mean std)
        float x[13], h1[16], h2[16];
        for (int i = 0; i < 13; i++) x[i] = (f[i] - netAt(${NET_OFF.mean} + i)) / netAt(${NET_OFF.std} + i);
        for (int j = 0; j < 16; j++) { float s = netAt(${NET_OFF.b1} + j); for (int i = 0; i < 13; i++) s += netAt(j * 13 + i) * x[i]; s = max(s, 0.0); h1[j] = s * s; }
        for (int j = 0; j < 16; j++) { float s = netAt(${NET_OFF.b2} + j); for (int i = 0; i < 16; i++) s += netAt(${NET_OFF.w2} + j * 16 + i) * h1[i]; s = max(s, 0.0); h2[j] = s * s; }
        L = 0.0;
        for (int k = 0; k < 2; k++) { float o = netAt(${NET_OFF.b3} + k); for (int i = 0; i < 16; i++) o += netAt(${NET_OFF.w3} + k * 16 + i) * h2[i]; L += min(o * o, ${OUT_MAX.toFixed(1)}); }
      }
    }
    // (shown linear, a little compressed at the top; or, in the error view, how far it is from the reference)
    v_color.rgb = u_diff == 1 ? mix(vec3(0.22, 0.24, 0.27), vec3(1.0, 0.38, 0.2), clamp(abs(L - refL) * 2.5, 0.0, 1.0)) : vec3(0.96, 0.94, 0.88) * (L * 0.8 / (1.0 + 0.25 * L));
  }
  if (u_mode != 0 && u_mode != 3) keep = keep > 0.02 ? 1.0 : 0.0;
  if (keep < 0.01) return;
  v_color.a *= keep;
  vec2 c01 = unpackHalf2x16(d1.x), c23 = unpackHalf2x16(d1.y), c45 = unpackHalf2x16(d1.z);
  // (the covariance was stored 4× over, for the half floats' sake)
  mat3 S = mat3(c01.x, c01.y, c23.x, c01.y, c23.y, c45.x, c23.x, c45.x, c45.y) * 0.25 * u_size * u_size;
  // (the perspective's Jacobian at this point (camera looks down -z), and the camera's rotation)
  float z = -cam.z;
  mat3 J = mat3(u_focal.x / z, 0.0, 0.0, 0.0, u_focal.y / z, 0.0, u_focal.x * cam.x / (z * z), u_focal.y * cam.y / (z * z), 0.0);
  mat3 T = J * mat3(u_view);
  mat3 P = T * S * transpose(T);
  // (no thinner than a pixel)
  float a = P[0][0] + 0.3, b = P[0][1], d = P[1][1] + 0.3;
  // (the ellipse's axes: eigenvalues of [[a b][b d]], and the first's eigenvector)
  float mid = 0.5 * (a + d), rad = length(vec2(0.5 * (a - d), b));
  float l1 = mid + rad, l2 = max(mid - rad, 0.1);
  vec2 e1 = abs(b) > 1e-6 ? normalize(vec2(b, l1 - a)) : (a >= d ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
  vec2 e2 = vec2(-e1.y, e1.x);
  vec2 px = 3.0 * (a_corner.x * sqrt(l1) * e1 + a_corner.y * sqrt(l2) * e2);
  if (u_mode == 3) px = a_corner * 1.5;
  v_r = a_corner * 3.0;
  vec2 ndc = clip.xy / clip.w, at = ndc + px * 2.0 / u_viewport;
  gl_Position = vec4(at, clip.z / clip.w, 1.0);
  // (a drawing's mark lies on a surface: each corner of its quad given the depth of that surface under it (the ray
  // through the corner meeting the mark's plane), so a broad mark on a face turned away isn't cut by the face's own
  // depth; a captured scene's splats, or a plane seen edge-on, keep their centre's depth)
  if (kind != 0u && kind != 4u) {
    vec3 nv = mat3(u_view) * sn, d = vec3(at.x / u_proj[0][0], at.y / u_proj[1][1], -1.0);
    float dn = dot(nv, d);
    if (abs(dn) > 0.05) {
      float tt = dot(nv, cam.xyz) / dn;
      vec3 X = d * clamp(tt, -cam.z - 0.5, -cam.z + 0.5);
      vec4 cx = u_proj * vec4(X, 1.0);
      gl_Position = vec4(at * cx.w, cx.z, cx.w);
    }
  }
}`;
const FS = `#version 300 es
precision highp float; precision highp int;
uniform int u_mode;
in vec4 v_color;
in vec2 v_r;
out vec4 o;
void main() {
  float r2 = dot(v_r, v_r);
  if (u_mode == 3) { o = vec4(v_color.rgb, 1.0); return; }
  if (r2 > 9.0) discard;
  float alpha;
  if (u_mode == 1) {
    // (its 1σ and 2σ contours, as thin lines)
    float r = sqrt(r2), w = fwidth(r) * 1.2;
    alpha = max(1.0 - smoothstep(0.0, w, abs(r - 1.0)), 0.5 * (1.0 - smoothstep(0.0, w, abs(r - 2.0)))) * 0.8;
  } else if (u_mode == 2) alpha = 0.9;
  else alpha = min(0.99, v_color.a * exp(-0.5 * r2));
  if (alpha < 1.0 / 255.0) discard;
  o = vec4(v_color.rgb * alpha, alpha);
}`;
const OVS = `#version 300 es
uniform mat4 u_view, u_proj;
in vec3 a_pos;
void main() { gl_Position = u_proj * u_view * vec4(a_pos, 1.0); }`;
const OFS = `#version 300 es
precision mediump float;
out vec4 o;
void main() { o = vec4(0.0); }`;

import { covariance, type Splats } from './format';
import { BOX, SIGMA, SUN_TAPS, NET_SIZE, OUT_MAX, IN, H, OUT, type Net, type Mips } from './mist';
/** where each part of the network's numbers starts in u_net */
const NET_OFF = (() => { const w2 = IN * H + H, b2 = w2 + H * H, w3 = b2 + H, b3 = w3 + OUT * H, mean = b3 + OUT; return { b1: IN * H, w2, b2, w3, b3, mean, std: mean + IN }; })();

export interface DrawOpts {
  size: number; mode: number; bg: [number, number, number];
  /** how much of a drawing's marks to keep (1 all), and how: by their ranks (0), or thinned evenly (1) keeping `share` */
  detail?: number; thin?: number; share?: number;
  /** how far the brush has developed each feature (0..1, sixteen of them) */
  features?: Float32Array;
  eye?: [number, number, number];
  /** draw the occluder into the depth buffer (if there is one) */
  occlude?: boolean;
  /** only one kind of mark (stone.ts MARK), or all (-1) */
  only?: number;
  /** Mist: how its splats are lit (0 their stored colour, 1 analytic, 2 the network), and the sun */
  light?: number; sun?: [number, number, number]; diff?: boolean;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram; private tex: WebGLTexture; private order: WebGLBuffer; private vao: WebGLVertexArrayObject;
  private oprog: WebGLProgram; private ovao: WebGLVertexArrayObject; private obuf: WebGLBuffer; private ocount = 0;
  private u: Record<string, WebGLUniformLocation | null> = {}; private ou: Record<string, WebGLUniformLocation | null> = {};
  n = 0; drawn = 0;
  private gridTex: WebGLTexture | null = null; private net = new Float32Array(Math.ceil(NET_SIZE / 4) * 4); private ana = [0, 0];
  /** Mist's density pyramid (one float a texel; each level a mip of the 3D texture) */
  setGrid(g: Mips) {
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_3D, this.gridTex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_BASE_LEVEL, 0); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAX_LEVEL, g.data.length - 1);
    g.data.forEach((d, L) => { const [x, y, z] = g.dims[L]; gl.texImage3D(gl.TEXTURE_3D, L, gl.R32F, x, y, z, 0, gl.RED, gl.FLOAT, d); });
  }
  /** the tiny network's numbers (w1 b1 w2 b2 w3 b3 mean std), and the analytic model's two weights */
  setNet(n: Net, ana: { a: number; b: number }) { this.net.set([...n.w1, ...n.b1, ...n.w2, ...n.b2, ...n.w3, ...n.b3, ...n.mean, ...n.std]); this.ana = [ana.a, ana.b]; }
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: false, depth: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is needed');
    this.gl = gl;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader'); return s; };
    const link = (vs: string, fs: string) => { const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link'); return p; };
    const p = this.prog = link(VS(), FS);
    for (const k of ['u_data', 'u_view', 'u_proj', 'u_focal', 'u_viewport', 'u_size', 'u_mode', 'u_eye', 'u_detail', 'u_share', 'u_thin', 'u_feat', 'u_only', 'u_grid', 'u_sun', 'u_light', 'u_net', 'u_ana', 'u_diff']) this.u[k] = gl.getUniformLocation(p, k);
    // (an array's location, by its first element's name, where the bare name isn't found)
    this.u.u_feat ??= gl.getUniformLocation(p, 'u_feat[0]');
    this.u.u_net ??= gl.getUniformLocation(p, 'u_net[0]');
    this.gridTex = gl.createTexture()!;
    this.vao = gl.createVertexArray()!; gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const ac = gl.getAttribLocation(p, 'a_corner'); gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 2, gl.FLOAT, false, 0, 0);
    this.order = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.order);
    const ai = gl.getAttribLocation(p, 'a_index'); gl.enableVertexAttribArray(ai); gl.vertexAttribIPointer(ai, 1, gl.UNSIGNED_INT, 0, 0); gl.vertexAttribDivisor(ai, 1);
    gl.bindVertexArray(null);
    this.tex = gl.createTexture()!;
    const op = this.oprog = link(OVS, OFS);
    for (const k of ['u_view', 'u_proj']) this.ou[k] = gl.getUniformLocation(op, k);
    this.ovao = gl.createVertexArray()!; gl.bindVertexArray(this.ovao);
    this.obuf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.obuf);
    const ap = gl.getAttribLocation(op, 'a_pos'); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }
  /** the splats into the data texture (once a scene) */
  load(s: Splats) {
    const gl = this.gl, rows = Math.max(1, Math.ceil(s.n / 1024)), data = new Uint32Array(2048 * rows * 4), f = new Float32Array(data.buffer), cov = new Float32Array(6);
    for (let i = 0; i < s.n; i++) {
      const o = i * 8;
      f[o] = s.pos[i * 3]; f[o + 1] = s.pos[i * 3 + 1]; f[o + 2] = s.pos[i * 3 + 2];
      data[o + 3] = s.rgba[i * 4] | (s.rgba[i * 4 + 1] << 8) | (s.rgba[i * 4 + 2] << 16) | (s.rgba[i * 4 + 3] << 24);
      covariance(s, i, cov, 0, 2);
      data[o + 4] = half2(cov[0], cov[1]); data[o + 5] = half2(cov[2], cov[3]); data[o + 6] = half2(cov[4], cov[5]);
      const rank = s.rank ? Math.round(s.rank[i] * 255) : 255, kind = (s.mark ? s.mark[i] & 15 : 0) | ((s.feature ? s.feature[i] & 15 : 0) << 4);
      const [ox, oy] = s.normal ? octEncode(s.normal[i * 3], s.normal[i * 3 + 1], s.normal[i * 3 + 2]) : [128, 128];
      data[o + 7] = (rank | (kind << 8) | (ox << 16) | (oy << 24)) >>> 0;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, 2048, rows, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, data);
    this.n = s.n; this.drawn = 0;
  }
  /** a shape to hide what's behind it (triangles, three floats a vertex), drawn into the depth buffer only; or none */
  setOccluder(tris: Float32Array | null) {
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.obuf); gl.bufferData(gl.ARRAY_BUFFER, tris ?? new Float32Array(0), gl.STATIC_DRAW); this.ocount = tris ? tris.length / 3 : 0;
  }
  /** the order to draw them in (from the sort) */
  setOrder(order: Uint32Array) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.order); gl.bufferData(gl.ARRAY_BUFFER, order, gl.DYNAMIC_DRAW); this.drawn = order.length; }
  draw(view: Float32Array, proj: Float32Array, focal: [number, number], opts: DrawOpts) {
    const gl = this.gl, c = this.canvas;
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(opts.bg[0], opts.bg[1], opts.bg[2], 1); gl.clearDepth(1); gl.depthMask(true); gl.colorMask(true, true, true, true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.drawn) return;
    // (the occluder: depth only)
    if (this.ocount && opts.occlude !== false) {
      gl.useProgram(this.oprog); gl.bindVertexArray(this.ovao);
      gl.uniformMatrix4fv(this.ou.u_view, false, view); gl.uniformMatrix4fv(this.ou.u_proj, false, proj);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.colorMask(false, false, false, false); gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, this.ocount);
      gl.colorMask(true, true, true, true);
    }
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(this.u.u_data, 0);
    gl.uniformMatrix4fv(this.u.u_view, false, view); gl.uniformMatrix4fv(this.u.u_proj, false, proj);
    gl.uniform2f(this.u.u_focal, focal[0], focal[1]); gl.uniform2f(this.u.u_viewport, c.width, c.height);
    gl.uniform1f(this.u.u_size, opts.size); gl.uniform1i(this.u.u_mode, opts.mode);
    gl.uniform3fv(this.u.u_eye, opts.eye ?? [0, 0, 0]);
    gl.uniform1f(this.u.u_detail, opts.detail ?? 1); gl.uniform1f(this.u.u_share, opts.share ?? 1); gl.uniform1i(this.u.u_thin, opts.thin ?? 0); gl.uniform1i(this.u.u_only, opts.only ?? -1);
    gl.uniform1fv(this.u.u_feat, opts.features ?? new Float32Array(16));
    gl.uniform1i(this.u.u_light, opts.light ?? 0); gl.uniform1i(this.u.u_diff, opts.diff ? 1 : 0); gl.uniform3fv(this.u.u_sun, opts.sun ?? [0, 1, 0]);
    gl.uniform4fv(this.u.u_net, this.net); gl.uniform2f(this.u.u_ana, this.ana[0], this.ana[1]);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, this.gridTex); gl.uniform1i(this.u.u_grid, 1); gl.activeTexture(gl.TEXTURE0);
    // (tested against the occluder's depth, never writing their own)
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.drawn);
    gl.depthMask(true);
    gl.bindVertexArray(null);
  }
}

/** a unit normal in two bytes (octahedral) */
export function octEncode(x: number, y: number, z: number): [number, number] {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / l, v = y / l;
  if (z < 0) { const pu = u; u = (1 - Math.abs(v)) * (pu >= 0 ? 1 : -1); v = (1 - Math.abs(pu)) * (v >= 0 ? 1 : -1); }
  const b = (q: number) => Math.max(0, Math.min(255, Math.round((q + 1) * 127.5)));
  return [b(u), b(v)];
}

/** two floats as half floats in one uint (low, high), as GLSL's unpackHalf2x16 reads them */
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
export function toHalf(v: number): number {
  F32[0] = v; const x = U32[0], sign = (x >>> 16) & 0x8000, e = ((x >>> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e <= 0) { if (e < -10) return sign; const mm = (m | 0x800000) >> (1 - e); return sign | ((mm + 0x1000) >> 13); }
  if (e >= 31) return sign | 0x7c00;
  // (added, not or'd: rounding up can carry into the exponent)
  return sign | ((e << 10) + ((m + 0x1000) >> 13));
}
const half2 = (a: number, b: number) => (toHalf(a) | (toHalf(b) << 16)) >>> 0;

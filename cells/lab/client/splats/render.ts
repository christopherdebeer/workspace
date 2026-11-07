/**
 * Drawing splats with WebGL2 (it runs on every phone; WebGPU is where this goes next).
 *
 * Every splat is one quad, drawn instanced: 4 corners × n splats, in the order the sort gives (an instanced integer
 * attribute: the splat's index). Its data comes from a texture rather than vertex buffers, so re-sorting means
 * uploading only the order (4 bytes a splat), never the splats.
 *
 * - **The data texture** (RGBA32UI, 2 texels a splat): the centre's three floats as their bits and the colour packed
 *   in one uint; then the 3D covariance's six numbers as three pairs of half floats.
 * - **The vertex shader** does the splat maths, per splat (the same for its 4 corners): take the centre into the
 *   camera; take the 3D covariance to a 2D one on the screen (Σ' = J W Σ Wᵀ Jᵀ: W the camera's rotation, J the
 *   perspective's local stretch at that point, its Jacobian); add a little (0.3 px²) so nothing is thinner than a pixel;
 *   find the 2D ellipse's axes (the eigenvectors of Σ', their lengths the square roots of its eigenvalues); and put
 *   the quad's corners out along them to 3 standard deviations.
 * - **The fragment shader** is a Gaussian: how far the pixel is from the middle in standard deviations, r, and its
 *   opacity the splat's times exp(-r²/2). Blended premultiplied, over what's drawn already (back to front).
 *
 * `mode` shows the parts: 0 the picture; 1 each splat's 1σ and 2σ contours (its ellipse); 2 each one's footprint, solid
 * (the quad's reach, 3σ); 3 the centres only (the point cloud the splats grew from).
 */
const VS = `#version 300 es
precision highp float; precision highp int;
uniform highp usampler2D u_data;
uniform mat4 u_view, u_proj;
uniform vec2 u_focal, u_viewport;
uniform float u_size;
uniform int u_mode;
in vec2 a_corner;
in uint a_index;
out vec4 v_color;
out vec2 v_r;
void main() {
  ivec2 t = ivec2(int(a_index & 1023u) * 2, int(a_index >> 10));
  uvec4 d0 = texelFetch(u_data, t, 0), d1 = texelFetch(u_data, t + ivec2(1, 0), 0);
  vec4 cam = u_view * vec4(uintBitsToFloat(d0.xyz), 1.0);
  vec4 clip = u_proj * cam;
  float bound = 1.2 * clip.w;
  // (behind the camera, or well off the screen: no quad)
  if (-cam.z < 0.05 || clip.x < -bound || clip.x > bound || clip.y < -bound || clip.y > bound) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  v_color = vec4(float(d0.w & 255u), float((d0.w >> 8) & 255u), float((d0.w >> 16) & 255u), float(d0.w >> 24)) / 255.0;
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
  float k = u_mode == 3 ? 0.0 : 3.0;
  vec2 px = k * (a_corner.x * sqrt(l1) * e1 + a_corner.y * sqrt(l2) * e2);
  if (u_mode == 3) px = a_corner * 1.5;
  v_r = a_corner * 3.0;
  vec2 ndc = clip.xy / clip.w;
  gl_Position = vec4(ndc + px * 2.0 / u_viewport, 0.0, 1.0);
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

import { covariance, type Splats } from './format';

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private prog: WebGLProgram; private tex: WebGLTexture; private order: WebGLBuffer; private vao: WebGLVertexArrayObject;
  private u: Record<string, WebGLUniformLocation | null> = {};
  n = 0; drawn = 0;
  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is needed');
    this.gl = gl;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader'); return s; };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    for (const k of ['u_data', 'u_view', 'u_proj', 'u_focal', 'u_viewport', 'u_size', 'u_mode']) this.u[k] = gl.getUniformLocation(p, k);
    this.vao = gl.createVertexArray()!; gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const ac = gl.getAttribLocation(p, 'a_corner'); gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 2, gl.FLOAT, false, 0, 0);
    this.order = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.order);
    const ai = gl.getAttribLocation(p, 'a_index'); gl.enableVertexAttribArray(ai); gl.vertexAttribIPointer(ai, 1, gl.UNSIGNED_INT, 0, 0); gl.vertexAttribDivisor(ai, 1);
    gl.bindVertexArray(null);
    this.tex = gl.createTexture()!;
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
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, 2048, rows, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, data);
    this.n = s.n; this.drawn = 0;
  }
  /** the order to draw them in (from the sort) */
  setOrder(order: Uint32Array) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.order); gl.bufferData(gl.ARRAY_BUFFER, order, gl.DYNAMIC_DRAW); this.drawn = order.length; }
  draw(view: Float32Array, proj: Float32Array, focal: [number, number], opts: { size: number; mode: number; bg: [number, number, number] }) {
    const gl = this.gl, c = this.canvas;
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(opts.bg[0], opts.bg[1], opts.bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.drawn) return;
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(this.u.u_data, 0);
    gl.uniformMatrix4fv(this.u.u_view, false, view); gl.uniformMatrix4fv(this.u.u_proj, false, proj);
    gl.uniform2f(this.u.u_focal, focal[0], focal[1]); gl.uniform2f(this.u.u_viewport, c.width, c.height);
    gl.uniform1f(this.u.u_size, opts.size); gl.uniform1i(this.u.u_mode, opts.mode);
    gl.disable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.drawn);
    gl.bindVertexArray(null);
  }
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

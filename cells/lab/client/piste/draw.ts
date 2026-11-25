/**
 * The picture: a daylight fencing club, in WebGL 2. The room (look/salle.ts) is built once; the fencers, dressed, and
 * their weapons (look/figure.ts) each frame. The sun comes in through the window bank and casts the fencers' shadows
 * (one shadow pass, from the sun, fitted to where they are); everything else is the room's own light (look/shaders.ts):
 * the day from the windows, the lamps, the room reflected in the steel.
 *
 * Three draw calls a frame: the shadow, the room, the fencers.
 */
import type { Bout } from './bout';
import { Mesh, MAT, STRIDE } from './look/mesh';
import { buildSalle } from './look/salle';
import { dressFencer } from './look/figure';
import { MAIN_VS, MAIN_FS, SHADOW_VS, SHADOW_FS } from './look/shaders';
import { type V, cross, dot, norm, sub } from './v3';

export interface View {
  /** the eye and where it looks */
  eye: V; at: V;
  /** vertical field of view, rad */
  fov: number;
  /** which fencer's own body not to draw (the one we're looking out of), or -1 */
  self: number;
  /** marks in the world (a replay's touches and contacts): where, colour, size */
  marks?: { p: V; c: [number, number, number]; r: number }[];
}

/** the sun's direction: in through the left-hand windows, from high up and a little behind you */
export const SUN: V = norm([-0.22, 0.62, -0.75]);
const SHADOW_SIZE = 2048;

export class Renderer {
  private gl: WebGL2RenderingContext;
  private main: WebGLProgram; private shade: WebGLProgram;
  private roomBuf: WebGLBuffer; private roomN: number;
  private dynBuf: WebGLBuffer; private roomVao: WebGLVertexArrayObject; private dynVao: WebGLVertexArrayObject;
  private mesh = new Mesh(60000);
  private u: Record<string, WebGLUniformLocation | null> = {};
  private us: Record<string, WebGLUniformLocation | null> = {};
  private shadowTex: WebGLTexture; private shadowFb: WebGLFramebuffer;
  exposure = 1.05;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL 2 is needed');
    this.gl = gl;
    this.main = program(gl, MAIN_VS, MAIN_FS);
    this.shade = program(gl, SHADOW_VS, SHADOW_FS);
    for (const k of ['vp', 'lvp', 'eye', 'sunDir', 'shadow', 'exposure', 'feet', 'tips']) this.u[k] = gl.getUniformLocation(this.main, k);
    this.us.lvp = gl.getUniformLocation(this.shade, 'lvp');
    const room = buildSalle();
    this.roomN = room.n;
    this.roomBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.roomBuf);
    gl.bufferData(gl.ARRAY_BUFFER, room.data.subarray(0, room.n * STRIDE), gl.STATIC_DRAW);
    this.roomVao = vao(gl, this.roomBuf);
    this.dynBuf = gl.createBuffer()!;
    this.dynVao = vao(gl, this.dynBuf);
    // the shadow map: depth only, compared in the lookup
    this.shadowTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
  }

  resize(dpr: number) {
    const c = this.canvas, w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  draw(bout: Bout, view: View) {
    const gl = this.gl, m = this.mesh;
    m.reset();
    bout.fencers.forEach((f, i) => dressFencer(m, f, i === view.self, i * 101 + 7));
    for (const k of view.marks ?? []) m.ellipsoid(k.p, [k.r, 0, 0], [0, k.r, 0], [0, 0, k.r], 10, 7, () => [k.c, MAT.lamp]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf);
    gl.bufferData(gl.ARRAY_BUFFER, m.data.subarray(0, m.n * STRIDE), gl.DYNAMIC_DRAW);

    // the sun's view: an orthographic box round the fencers, along the sun
    const [A, B] = bout.fencers, mid: V = [(A.s + B.s) / 2, 0.8, 0];
    const half = Math.max(2.6, Math.abs(A.s - B.s) / 2 + 1.6);
    const lvp = mul(ortho(-half, half, -2.2, 2.2, 0.1, 30), lookAt([mid[0] + SUN[0] * 12, mid[1] + SUN[1] * 12, mid[2] + SUN[2] * 12], mid, [1, 0, 0]));
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.shade);
    gl.uniformMatrix4fv(this.us.lvp, false, lvp);
    gl.bindVertexArray(this.dynVao);
    gl.drawArrays(gl.TRIANGLES, 0, m.n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.4, 0.42, 0.45, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.main);
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    gl.uniformMatrix4fv(this.u.vp, false, mul(perspective(view.fov, aspect, 0.03, 60), lookAt(view.eye, view.at, [0, 1, 0])));
    gl.uniformMatrix4fv(this.u.lvp, false, lvp);
    gl.uniform3fv(this.u.eye, view.eye);
    gl.uniform3fv(this.u.sunDir, SUN);
    gl.uniform1f(this.u.exposure, this.exposure);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(this.u.shadow, 0);
    // contact shadows: under each shoe, and under each tip (w: how strongly)
    const feet: number[] = [];
    for (const f of bout.fencers) for (const k of [13, 14]) { const c = f.capsules[k]; feet.push((c.a[0] + c.b[0]) / 2, 0, (c.a[2] + c.b[2]) / 2, 0.11 + Math.max(0, c.a[1] - 0.05) * 0.8); }
    gl.uniform4fv(this.u.feet, feet);
    const tips: number[] = [];
    for (const f of bout.fencers) { const t = f.blade.tip; tips.push(t[0], t[1], t[2], 1); }
    gl.uniform4fv(this.u.tips, tips);
    gl.bindVertexArray(this.roomVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.roomN);
    gl.bindVertexArray(this.dynVao);
    gl.drawArrays(gl.TRIANGLES, 0, m.n);
    gl.bindVertexArray(null);
  }
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const sh = (t: number, src: string) => { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader'); return s; };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}
function vao(gl: WebGL2RenderingContext, buf: WebGLBuffer) {
  const a = gl.createVertexArray()!;
  gl.bindVertexArray(a);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE * 4, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE * 4, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, STRIDE * 4, 24);
  gl.bindVertexArray(null);
  return a;
}

// ─── matrices (column-major) ─────────────────────────────────────────────────────────────────────────────────────────
function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function ortho(l: number, r: number, b: number, t: number, n: number, f: number): Float32Array {
  return new Float32Array([2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]);
}
function lookAt(eye: V, at: V, up: V): Float32Array {
  const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}
function mul(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
  return o;
}

/**
 * The device, drawn: an AtomS3R-sized body (24 × 24 × 12.9 mm, rounded), its front glass with the
 * 128 × 128 LCD showing the live frame, the USB-C port underneath and the Grove socket on the
 * side. One rounded-box mesh and one shader; ports and the screen are decals chosen by where a
 * fragment sits on the body. Units are millimetres; world x right, y up, z toward the viewer.
 */
import type { Quat, V3 } from './imu';

const W = 24, H = 24, D = 12.9, R = 2.6;     // body, mm
const SCREEN = 15.6;                          // 0.85" panel, active square, mm
const SCREEN_Y = 0.6;                         // panel sits a little above centre

const VS = `#version 300 es
in vec3 p; in vec3 n;
uniform mat4 view, proj; uniform vec4 q; uniform float lift;
out vec3 vp; out vec3 vn; out vec3 wp; out vec3 wn;
vec3 rot(vec4 q, vec3 v){ vec3 t = 2.0 * cross(q.xyz, v); return v + q.w * t + cross(q.xyz, t); }
void main(){
  vp = p; vn = n;
  wp = rot(q, p) + vec3(0.0, lift, 0.0); wn = rot(q, n);
  gl_Position = proj * view * vec4(wp, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vp; in vec3 vn; in vec3 wp; in vec3 wn;
uniform sampler2D lcd; uniform vec3 eye; uniform vec3 light; uniform float backlight; uniform float pressed;
out vec4 o;
float box(vec2 p, vec2 h, float r){ vec2 d = abs(p) - h + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
void main(){
  vec3 N = normalize(wn), V = normalize(eye - wp), L = normalize(light);
  vec3 base = vec3(0.16, 0.17, 0.19); float gloss = 24.0, spec = 0.18;
  vec3 emit = vec3(0.0);
  float front = smoothstep(0.92, 0.99, vn.z);
  if (front > 0.0) {
    // the front is one glass button: a black bezel, and the panel inside it
    base = mix(base, vec3(0.025, 0.03, 0.035), front); gloss = mix(gloss, 140.0, front); spec = mix(spec, 0.9, front);
    vec2 s = (vp.xy - vec2(0.0, ${SCREEN_Y.toFixed(2)})) / ${SCREEN.toFixed(2)} + 0.5;
    if (s.x > 0.0 && s.x < 1.0 && s.y > 0.0 && s.y < 1.0) {
      vec2 uv = vec2(s.x, 1.0 - s.y);
      vec3 px = texture(lcd, uv).rgb;
      vec2 cell = fract(uv * 128.0);
      float grid = 0.82 + 0.18 * smoothstep(0.0, 0.16, min(cell.x, cell.y)) * smoothstep(1.0, 0.84, max(cell.x, cell.y));
      emit = px * grid * backlight * front;
    }
  }
  if (vn.y < -0.9 && box(vp.xz, vec2(4.4, 1.6), 1.5) < 0.0) { base = vec3(0.02); spec = 0.05; }                    // USB-C
  if (vn.x < -0.9 && box(vp.zy, vec2(2.0, 4.2), 0.3) < 0.0) { base = vec3(0.86, 0.85, 0.80); spec = 0.1; }        // Grove
  if (vn.x < -0.9 && box(vp.zy, vec2(1.2, 3.4), 0.2) < 0.0) { base = vec3(0.06); }
  if (vn.y > 0.9 && length(vp.xz - vec2(7.0, 0.0)) < 1.0) { base = vec3(0.05, 0.02, 0.03); spec = 0.6; }           // IR window
  float diff = max(dot(N, L), 0.0);
  float hemi = 0.5 + 0.5 * N.y;
  vec3 H = normalize(L + V);
  float sp = pow(max(dot(N, H), 0.0), gloss) * spec;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.25;
  vec3 col = base * (0.28 * hemi + 0.85 * diff) + vec3(sp) + rim * vec3(0.55, 0.62, 0.7) + emit;
  col *= 1.0 - 0.12 * pressed * front;
  o = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;

/** A rounded box: a subdivided cube pushed out to rounded corners (smooth normals everywhere). */
function roundedBox(seg = 14) {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const hx = W / 2, hy = H / 2, hz = D / 2;
  const faces: [V3, V3, V3][] = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [nrm, u, v] of faces) {
    const base = pos.length / 3;
    for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * 2 - 1, b = (j / seg) * 2 - 1;
      // ease towards the edges so the corners get the vertices
      const ea = Math.sign(a) * (1 - Math.pow(1 - Math.abs(a), 1.6)), eb = Math.sign(b) * (1 - Math.pow(1 - Math.abs(b), 1.6));
      const c = [0, 1, 2].map((k) => (nrm[k] + u[k] * ea + v[k] * eb) * [hx, hy, hz][k]);
      const inner = [hx - R, hy - R, hz - R];
      const cl = c.map((x, k) => Math.max(-inner[k], Math.min(inner[k], x)));
      const d = c.map((x, k) => x - cl[k]);
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      const nn = d.map((x) => x / len);
      pos.push(cl[0] + nn[0] * R, cl[1] + nn[1] * R, cl[2] + nn[2] * R);
      nor.push(nn[0], nn[1], nn[2]);
    }
    for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
      const a = base + j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), idx: new Uint16Array(idx) };
}

function shader(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
  return s;
}

const perspective = (fov: number, aspect: number, near: number, far: number) => {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
};
const lookAt = (e: V3, c: V3): Float32Array => {
  const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]);
  const x = norm(cross([0, 1, 0], z)), y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -dot(x, e), -dot(y, e), -dot(z, e), 1]);
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export interface View { q: Quat; light: V3; backlight: number; pressed?: number; distance?: number }

export class DeviceView {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private count: number;
  private tex: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(p, 0, 'p'); gl.bindAttribLocation(p, 1, 'n');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    for (const n of ['view', 'proj', 'q', 'lift', 'lcd', 'eye', 'light', 'backlight', 'pressed']) this.u[n] = gl.getUniformLocation(p, n);
    const m = roundedBox();
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const buf = (data: Float32Array, loc: number) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    };
    buf(m.pos, 0); buf(m.nor, 1);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
    this.count = m.idx.length;
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([8, 20, 28, 255]));
  }

  screen(source: HTMLCanvasElement | OffscreenCanvas) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
  }

  draw(v: View) {
    const gl = this.gl, c = this.canvas;
    const dpr = Math.min(devicePixelRatio || 1, 2.5);
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
    gl.useProgram(this.prog);
    const aspect = w / Math.max(1, h);
    const fov = 0.42;
    // fit the 24 mm face, with room for its corners when turned, into the shorter side
    const fit = (44 / 2) / Math.tan(fov / 2) / Math.min(1, aspect);
    const eye: V3 = [0, 0, v.distance ?? fit];
    gl.uniformMatrix4fv(this.u.proj, false, perspective(fov, aspect, 5, 1000));
    gl.uniformMatrix4fv(this.u.view, false, lookAt(eye, [0, 0, 0]));
    gl.uniform4f(this.u.q, v.q[0], v.q[1], v.q[2], v.q[3]);
    gl.uniform1f(this.u.lift, 0);
    gl.uniform3f(this.u.eye, eye[0], eye[1], eye[2]);
    gl.uniform3f(this.u.light, v.light[0], v.light[1], v.light[2]);
    gl.uniform1f(this.u.backlight, v.backlight);
    gl.uniform1f(this.u.pressed, v.pressed ?? 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(this.u.lcd, 0);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
  }
}

/**
 * The picture, in WebGL 2: a hall, a piste, two fencers in white, their weapons in steel. One mesh, rebuilt each
 * frame from the bout (it's small: capsules, two blades, two bells), drawn with one program: a key light from the
 * hall's ceiling, a sky-and-floor ambient, and for steel a reflection of a made-up hall (bright above, dark below),
 * which is what makes a thin blade read as a blade. Fog takes the far hall.
 *
 * Deliberately plain: it's here to show what the simulation does. Looks are for later, over the same bout.
 */
import type { Bout } from './bout';
import { PISTE } from './bout';
import type { Fencer, Capsule } from './fencer';
import { type V, add, cross, dot, len, madd, norm, scale, sub } from './v3';

const STRIDE = 10;
type C = [number, number, number, number];
/** colours: rgb, and how metallic (0 cloth .. 1 polished steel) */
const COL: Record<string, C> = {
  kit: [0.9, 0.9, 0.87, 0.05], mask: [0.12, 0.12, 0.13, 0.35], bib: [0.86, 0.86, 0.84, 0.05], glove: [0.94, 0.93, 0.9, 0.05],
  shoe: [0.2, 0.2, 0.22, 0.1], sock: [0.92, 0.92, 0.9, 0.02],
  steel: [0.66, 0.68, 0.7, 0.92], bell: [0.8, 0.8, 0.82, 0.98], grip: [0.2, 0.17, 0.14, 0.15], tip: [0.25, 0.25, 0.27, 0.6],
  floor: [0.28, 0.22, 0.17, 0.1], piste: [0.42, 0.44, 0.46, 0.45], line: [0.95, 0.95, 0.95, 0.05], warn: [0.36, 0.37, 0.39, 0.45],
  wall: [0.16, 0.17, 0.2, 0.0],
};
const PART_COL: Record<string, C> = { head: COL.mask, torso: COL.kit, arm: COL.kit, hand: COL.glove, leg: COL.kit, foot: COL.shoe };

class Mesh {
  data = new Float32Array(STRIDE * 3 * 20000);
  n = 0;
  reset() { this.n = 0; }
  private grow() { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
  vert(p: V, nr: V, c: C) {
    if ((this.n + 1) * STRIDE > this.data.length) this.grow();
    const o = this.n++ * STRIDE, d = this.data;
    d[o] = p[0]; d[o + 1] = p[1]; d[o + 2] = p[2]; d[o + 3] = nr[0]; d[o + 4] = nr[1]; d[o + 5] = nr[2];
    d[o + 6] = c[0]; d[o + 7] = c[1]; d[o + 8] = c[2]; d[o + 9] = c[3];
  }
  quad(a: V, b: V, c: V, d: V, nr: V, col: C) { this.vert(a, nr, col); this.vert(b, nr, col); this.vert(c, nr, col); this.vert(a, nr, col); this.vert(c, nr, col); this.vert(d, nr, col); }
  /** a sphere */
  sphere(c: V, r: number, col: C, seg = 10, rings = 7) {
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const p = (a: number, b: number): V => { const th = (a / rings) * Math.PI, ph = (b / seg) * Math.PI * 2; return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; };
      const n00 = p(i, j), n01 = p(i, j + 1), n10 = p(i + 1, j), n11 = p(i + 1, j + 1);
      const P = (n: V) => madd(c, n, r);
      this.vert(P(n00), n00, col); this.vert(P(n10), n10, col); this.vert(P(n11), n11, col);
      this.vert(P(n00), n00, col); this.vert(P(n11), n11, col); this.vert(P(n01), n01, col);
    }
  }
  /** a truncated cone from a (radius ra) to b (radius rb), open-ended */
  cone(a: V, b: V, ra: number, rb: number, col: C, seg = 10) {
    const ax = sub(b, a), L = len(ax);
    if (L < 1e-6) return;
    const d = scale(ax, 1 / L), u = norm(Math.abs(d[1]) < 0.9 ? cross(d, [0, 1, 0]) : cross(d, [1, 0, 0])), w = cross(d, u);
    const slope = (ra - rb) / L;
    for (let j = 0; j < seg; j++) {
      const r = (k: number): V => { const ph = (k / seg) * Math.PI * 2; return add(scale(u, Math.cos(ph)), scale(w, Math.sin(ph))); };
      const r0 = r(j), r1 = r(j + 1), n0 = norm(madd(r0, d, slope)), n1 = norm(madd(r1, d, slope));
      const A0 = madd(a, r0, ra), A1 = madd(a, r1, ra), B0 = madd(b, r0, rb), B1 = madd(b, r1, rb);
      this.vert(A0, n0, col); this.vert(B0, n0, col); this.vert(B1, n1, col);
      this.vert(A0, n0, col); this.vert(B1, n1, col); this.vert(A1, n1, col);
    }
  }
  capsule(c: Capsule, col: C) { this.cone(c.a, c.b, c.ra, c.rb, col); this.sphere(c.a, c.ra, col, 10, 6); this.sphere(c.b, c.rb, col, 10, 6); }
  /** a spherical cap (the bell): apex at `apex`, facing along `ax`, rim radius r, depth h */
  bell(apex: V, ax: V, r: number, h: number, col: C, seg = 20, rings = 6) {
    const R = (r * r + h * h) / (2 * h), c = madd(apex, ax, -R), th0 = Math.asin(Math.min(1, r / R));
    const u = norm(Math.abs(ax[1]) < 0.9 ? cross(ax, [0, 1, 0]) : cross(ax, [1, 0, 0])), w = cross(ax, u);
    const pt = (i: number, j: number): V => { const th = (i / rings) * th0, ph = (j / seg) * Math.PI * 2; return norm(add(scale(ax, Math.cos(th)), add(scale(u, Math.sin(th) * Math.cos(ph)), scale(w, Math.sin(th) * Math.sin(ph))))); };
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
      const a = pt(i, j), b = pt(i + 1, j), cc = pt(i + 1, j + 1), d = pt(i, j + 1);
      // (both faces: the inside of the bell shows from behind)
      this.vert(madd(c, a, R), a, col); this.vert(madd(c, b, R), b, col); this.vert(madd(c, cc, R), cc, col);
      this.vert(madd(c, a, R), a, col); this.vert(madd(c, cc, R), cc, col); this.vert(madd(c, d, R), d, col);
      const na = scale(a, -1), nb = scale(b, -1), nc = scale(cc, -1), nd = scale(d, -1), dim: C = [col[0] * 0.6, col[1] * 0.6, col[2] * 0.6, col[3]];
      this.vert(madd(c, a, R), na, dim); this.vert(madd(c, cc, R), nc, dim); this.vert(madd(c, b, R), nb, dim);
      this.vert(madd(c, a, R), na, dim); this.vert(madd(c, d, R), nd, dim); this.vert(madd(c, cc, R), nc, dim);
    }
  }
}

const VS = `#version 300 es
layout(location=0) in vec3 p; layout(location=1) in vec3 n; layout(location=2) in vec4 c;
uniform mat4 vp; out vec3 vp_; out vec3 vn; out vec4 vc;
void main(){ vp_ = p; vn = n; vc = c; gl_Position = vp * vec4(p, 1.0); }`;
const FS = `#version 300 es
precision highp float;
in vec3 vp_; in vec3 vn; in vec4 vc; uniform vec3 eye; uniform vec3 fogc; out vec4 o;
vec3 hall(vec3 r){
  // the hall as steel sees it: a bright ceiling of lights, dark walls, a warm floor
  float up = r.y;
  vec3 c = mix(vec3(0.05,0.05,0.06), vec3(0.18,0.19,0.22), smoothstep(-0.3, 0.2, up));
  c += vec3(1.6,1.55,1.45) * smoothstep(0.55, 0.9, up) * (0.6 + 0.4 * step(0.5, fract(r.x * 3.0 + 0.25)));
  c = mix(c, vec3(0.16,0.12,0.09), smoothstep(-0.05, -0.4, up));
  return c;
}
void main(){
  vec3 N = normalize(vn), V = normalize(eye - vp_);
  if (dot(N, V) < 0.0) N = -N;
  vec3 L = normalize(vec3(0.25, 1.0, 0.35));
  float metal = vc.a;
  vec3 base = vc.rgb;
  float dif = max(dot(N, L), 0.0);
  vec3 amb = mix(vec3(0.14,0.12,0.1), vec3(0.32,0.34,0.38), N.y * 0.5 + 0.5);
  vec3 H = normalize(L + V);
  float gloss = mix(16.0, 180.0, metal);
  float spec = pow(max(dot(N, H), 0.0), gloss) * mix(0.06, 1.2, metal);
  vec3 R = reflect(-V, N);
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 col = base * (amb + dif * vec3(1.0,0.97,0.92)) * (1.0 - metal * 0.75);
  col += hall(R) * base * metal * 0.9 + hall(R) * fres * metal * 0.3;
  col += vec3(spec);
  float d = length(eye - vp_);
  col = mix(fogc, col, exp(-max(0.0, d - 6.0) * 0.06));
  col = col / (1.0 + col * 0.35);
  o = vec4(pow(col, vec3(1.0/2.2)), 1.0);
}`;

export interface View {
  /** the eye and where it looks */
  eye: V; at: V;
  /** vertical field of view, rad */
  fov: number;
  /** which fencer's own head (and chest) not to draw (the one we're looking out of), or -1 */
  self: number;
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vbo: WebGLBuffer;
  private mesh = new Mesh();
  private u: Record<string, WebGLUniformLocation | null> = {};
  private fog: V = [0.07, 0.075, 0.09];

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL 2 is needed');
    this.gl = gl;
    const sh = (t: number, src: string) => { const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader'); return s; };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    for (const k of ['vp', 'eye', 'fogc']) this.u[k] = gl.getUniformLocation(p, k);
    this.vbo = gl.createBuffer()!;
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE * 4, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE * 4, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, STRIDE * 4, 24);
    gl.enable(gl.DEPTH_TEST);
  }

  resize(dpr: number) {
    const c = this.canvas, w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  draw(bout: Bout, view: View) {
    const m = this.mesh, gl = this.gl;
    m.reset();
    this.hall(m);
    bout.fencers.forEach((f, i) => this.fencer(m, f, i === view.self));
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(this.fog[0], this.fog[1], this.fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const vp = mul(perspective(view.fov, aspect, 0.03, 80), lookAt(view.eye, view.at, [0, 1, 0]));
    gl.uniformMatrix4fv(this.u.vp, false, vp);
    gl.uniform3fv(this.u.eye, view.eye);
    gl.uniform3fv(this.u.fogc, this.fog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, m.data.subarray(0, m.n * STRIDE), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, m.n);
  }

  private hall(m: Mesh) {
    const up: V = [0, 1, 0], W = PISTE.width / 2, L = PISTE.half;
    m.quad([-30, 0, -15], [-30, 0, 15], [30, 0, 15], [30, 0, -15], up, COL.floor);
    // the piste, its run-back, and its lines (middle, en garde, the last two metres, the ends)
    const y = 0.004, ly = 0.006;
    m.quad([-L - 1.5, y, -W], [-L - 1.5, y, W], [L + 1.5, y, W], [L + 1.5, y, -W], up, COL.piste);
    for (const s of [-1, 1]) m.quad([s * L - 2 * s, y + 0.0005, -W], [s * L - 2 * s, y + 0.0005, W], [s * L, y + 0.0005, W], [s * L, y + 0.0005, -W], up, COL.warn);
    const line = (x: number, w = 0.05, half = W) => m.quad([x - w / 2, ly, -half], [x - w / 2, ly, half], [x + w / 2, ly, half], [x + w / 2, ly, -half], up, COL.line);
    line(0, 0.05, 0.25);
    for (const s of [-1, 1]) { line(s * PISTE.garde); line(s * (L - 2)); line(s * L); }
    m.quad([-L - 1.5, ly, -W], [-L - 1.5, ly, -W + 0.04], [L + 1.5, ly, -W + 0.04], [L + 1.5, ly, -W], up, COL.line);
    m.quad([-L - 1.5, ly, W - 0.04], [-L - 1.5, ly, W], [L + 1.5, ly, W], [L + 1.5, ly, W - 0.04], up, COL.line);
    // the hall's far walls
    for (const s of [-1, 1]) m.quad([s * 16, 0, -12], [s * 16, 9, -12], [s * 16, 9, 12], [s * 16, 0, 12], [-s, 0, 0], COL.wall);
    m.quad([-16, 0, -10], [16, 0, -10], [16, 9, -10], [-16, 9, -10], [0, 0, 1], COL.wall);
    m.quad([-16, 0, 10], [-16, 9, 10], [16, 9, 10], [16, 0, 10], [0, 0, -1], COL.wall);
  }

  private fencer(m: Mesh, f: Fencer, self: boolean) {
    f.capsules.forEach((c, i) => {
      // (looking out of this one: not its head, neck or shoulders, which the eye is inside)
      if (self && (c.part === 'head' || i === 1 || i === 3)) return;
      m.capsule(c, PART_COL[c.part]);
    });
    if (!self) {
      // the bib under the mask
      const h = f.capsules[2];
      m.sphere(madd(h.a, [0, -1, 0], 0.08), 0.085, COL.bib, 10, 6);
    }
    const b = f.blade, ax = b.handAxis;
    // grip and pommel
    m.cone(b.pommel, madd(b.guard, ax, -0.02), 0.013, 0.014, COL.grip, 8);
    m.sphere(b.pommel, 0.017, COL.bell, 8, 5);
    m.bell(b.guard, ax, b.weapon.guardR, b.weapon.guardDepth, COL.bell);
    // the blade, a tapered tube along its nodes (a little thicker than steel, so a far blade still shows)
    for (let i = 1; i < b.n - 1; i++) m.cone(b.at(i), b.at(i + 1), b.r[i] * 1.25, b.r[i + 1] * 1.25, COL.steel, 6);
    m.sphere(b.tip, b.r[b.n - 1] * 1.9, COL.tip, 6, 4);
  }
}

// ─── matrices (column-major) ─────────────────────────────────────────────────────────────────────────────────────────
function perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
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

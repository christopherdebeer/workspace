/**
 * Switchback's drawing. Two layers:
 *
 * - **the world** (WebGL2): flat facets, each face's normal from the screen derivatives, its light picking one of its
 *   material's four bands, so a face is one colour and the next face another; the distance fades it toward the blues in
 *   steps, not smoothly; the far ranges round the eye; the rider's hard shadow, the bike flattened along the sun onto the
 *   ground under it.
 * - **the speed** (a 2D canvas over it): motion drawn as vector shapes rather than blurred pixels. Shards (thin wedges,
 *   white, pale, charcoal, orange) streaming out from the point you're riding at, more and longer as you go faster; a
 *   wedge smeared back from each fence post and flag as it whips past (from where it is to where it was a moment ago);
 *   the rider's own wake; and the debris (faceted chunks of snow and rock thrown off the rear wheel, a burst on landing,
 *   a spray on a crash), each smeared along its own motion.
 */
import { Course } from './course';
import { CHUNK, PALETTE, buildChunk, buildRanges, buildRider, buildValley } from './mesh';
import type { Rider, Event } from './sim';

const VS = `#version 300 es
in vec4 aP; uniform mat4 uVP; uniform vec3 uOff; out vec3 vW; flat out int vM;
flat out float vT;
void main() { vW = aP.xyz + uOff; vM = int(aP.w); vT = fract(aP.w); gl_Position = uVP * vec4(vW, 1.); }`;
const FS = `#version 300 es
precision highp float;
in vec3 vW; flat in int vM; flat in float vT; uniform vec3 uPal[48]; uniform vec3 uEye; uniform vec3 uSun; uniform float uFog; out vec4 o;
void main() {
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  // (the face's light, nudged by its own tone, picks one of its material's four bands)
  float l = dot(n, uSun) + (vT / .9 - .5) * .42;
  int b = l > .62 ? 0 : l > .3 ? 1 : l > -.05 ? 2 : 3;
  vec3 c = uPal[vM * 4 + b];
  // (distance: toward the valley's blues in four hard steps, each face keeping its band, so the far slopes stay faceted)
  float d = length(vW.xz - uEye.xz), f = floor(clamp((d - 80.) / 520., 0., 1.) * 4.) / 4.;
  vec3 fogs[4] = vec3[4](vec3(.62, .66, .9), vec3(.33, .45, .88), vec3(.14, .33, .84), vec3(.09, .26, .78));
  o = vec4(mix(c, fogs[b], min(1., f * 1.1) * uFog), 1.);
}`;

export type Mat = Float32Array;
export function perspective(fov: number, asp: number, n: number, f: number): Mat {
  const t = 1 / Math.tan(fov / 2), m = new Float32Array(16);
  m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = (2 * f * n) / (n - f); return m;
}
export function lookAt(e: number[], c: number[], up: number[]): Mat {
  const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(up, z)), y = cross(z, x), m = new Float32Array(16);
  m.set([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]); return m;
}
export function mul(a: Mat, b: Mat): Mat { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);

/** the sun: high, ahead and to the right of the way down (the drop side), so the wall's faces catch it and shadows fall back toward the eye */
export const SUN = norm([-0.5, 0.72, 0.5]);
export const SKY = '#0741eb';

export interface View { eye: number[]; target: number[]; fov: number; roll: number }

class Buf {
  vao: WebGLVertexArrayObject; buf: WebGLBuffer; n = 0;
  constructor(private gl: WebGL2RenderingContext, data: Float32Array | null, dynamic = false) {
    this.vao = gl.createVertexArray()!; this.buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    if (data) this.set(data, dynamic);
  }
  set(d: Float32Array, dynamic = false) { const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, d, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW); this.n = d.length / 4; }
  draw() { const gl = this.gl; gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, this.n); }
  free() { this.gl.deleteBuffer(this.buf); this.gl.deleteVertexArray(this.vao); }
}

export class Renderer {
  gl: WebGL2RenderingContext; ctx: CanvasRenderingContext2D;
  private prog: WebGLProgram; private u: Record<string, WebGLUniformLocation | null> = {};
  private chunks = new Map<number, Buf>(); private ranges: Buf; private valley: Buf; private rider: Buf; private shadow: Buf;
  vp: Mat = new Float32Array(16); W = 1; H = 1; dpr = 1;
  fx = new Fx();
  constructor(readonly canvas: HTMLCanvasElement, readonly overlay: HTMLCanvasElement, readonly course: Course) {
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl; this.ctx = overlay.getContext('2d')!;
    const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) ?? 'shader'); return o; };
    const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.bindAttribLocation(p, 0, 'aP'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    for (const n of ['uVP', 'uOff', 'uPal', 'uEye', 'uSun', 'uFog']) this.u[n] = gl.getUniformLocation(p, n);
    gl.useProgram(p);
    gl.uniform3fv(this.u.uPal, new Float32Array(PALETTE.flat().map(hex).flat()));
    gl.uniform3fv(this.u.uSun, new Float32Array(SUN));
    this.ranges = new Buf(gl, buildRanges(course.seed)); this.valley = new Buf(gl, buildValley(course.seed)); this.rider = new Buf(gl, null); this.shadow = new Buf(gl, null);
  }
  resize() {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.W = innerWidth; this.H = innerHeight;
    for (const c of [this.canvas, this.overlay]) { c.width = Math.round(this.W * this.dpr); c.height = Math.round(this.H * this.dpr); }
  }
  /** keep the chunks from just behind the rider to well ahead built, at most `budget` new ones a frame */
  private stream(s: number, budget: number) {
    const lo = Math.max(0, Math.floor((s - 70) / CHUNK)), hi = Math.floor((s + 640) / CHUNK);
    for (const [n, b] of this.chunks) if (n < lo || n > hi) { b.free(); this.chunks.delete(n); }
    for (let n = lo; n <= hi && budget > 0; n++) if (!this.chunks.has(n)) { this.chunks.set(n, new Buf(this.gl, buildChunk(this.course, n))); budget--; }
  }
  frame(view: View, r: Rider, t: number, dt: number, budget = 1) {
    const gl = this.gl;
    this.stream(r.s, budget);
    const asp = this.W / this.H, fov = asp < 1 ? view.fov * 1.25 : view.fov;
    // (the eye's roll: its up tipped toward its right)
    const fwd = norm([view.target[0] - view.eye[0], 0, view.target[2] - view.eye[2]]), rt = [-fwd[2], 0, fwd[0]];
    const upv = norm([rt[0] * Math.sin(view.roll), Math.cos(view.roll), rt[2] * Math.sin(view.roll)]);
    this.vp = mul(perspective(fov, asp, 0.3, 9000), lookAt(view.eye, view.target, upv));
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const sky = hex(SKY); gl.clearColor(sky[0], sky[1], sky[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uVP, false, this.vp); gl.uniform3fv(this.u.uEye, new Float32Array(view.eye));
    // (the far ranges, round the eye and a little below it, unfaded)
    gl.uniform1f(this.u.uFog, 0); gl.uniform3f(this.u.uOff, view.eye[0], view.eye[1] - 60, view.eye[2]); this.ranges.draw(); this.valley.draw();
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(this.u.uFog, 1); gl.uniform3f(this.u.uOff, 0, 0, 0);
    for (const b of this.chunks.values()) b.draw();
    // (the rider, and its shadow flattened along the sun onto the ground under it)
    const body = buildRider({ x: r.x, y: r.y, z: r.z, heading: r.heading, pitch: r.pitch, lean: r.lean, squash: r.squash, crashT: r.crashT, air: r.air, steer: r.steer, yFront: r.yFront, yRear: r.yRear, dist: r.dist, body: r.body }, t);
    this.rider.set(body, true); this.rider.draw();
    const g = this.course.point(r.s, r.u).y + 0.06, sh = new Float32Array(body.length);
    for (let i = 0; i < body.length; i += 4) {
      const h = body[i + 1] - g, k = Math.max(0, h) / SUN[1];
      sh[i] = body[i] - SUN[0] * k; sh[i + 1] = g; sh[i + 2] = body[i + 2] - SUN[2] * k; sh[i + 3] = 9.45;
    }
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
    if (!r.air || body[1] - g < 6) { this.shadow.set(sh, true); this.shadow.draw(); }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    // (the speed layer)
    this.fx.draw(this, view, r, dt);
  }
  /** a world point on the screen (css px) and its depth, or null behind the eye */
  project(p: number[]): [number, number, number] | null {
    const m = this.vp, x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w < 0.4) return null;
    return [(x / w * 0.5 + 0.5) * this.W, (0.5 - y / w * 0.5) * this.H, w];
  }
}

type Chunk = { x: number; y: number; z: number; vx: number; vy: number; vz: number; r: number; a: number; spin: number; life: number; col: string; pts: number[] };
type Shard = { a: number; r: number; w: number; len: number; col: string; sp: number };
const SHARD_COLS = ['#ffffff', '#ffffff', '#f1ece8', '#d9d0ca', '#24262e', '#2c2d32', '#e85a0d', '#ff7428'];

/** the speed layer: shards, smears, wake and debris, all flat vector shapes */
export class Fx {
  debris: Chunk[] = []; shards: Shard[] = [];
  private eyeWas: number[] | null = null; private seen = 0; private rand = mulberry(7);
  spawn(e: Event, r: Rider) {
    const R = this.rand, fx = Math.sin(r.heading), fz = Math.cos(r.heading);
    const n = e.kind === 'roost' ? 1 + (R() < e.k ? 1 : 0) : e.kind === 'land' ? Math.round(6 + e.k * 16) : e.kind === 'crash' ? 34 : e.kind === 'wall' ? 12 : 0;
    for (let i = 0; i < n; i++) {
      const rear = e.kind === 'roost', side = (R() - 0.5) * 2;
      const sp = rear ? r.v * (0.15 + R() * 0.25) : 2 + R() * 6;
      const cols = e.kind === 'wall' ? ['#24262e', '#2c2d32', '#4a4b55'] : e.kind === 'crash' ? ['#e85a0d', '#24262e', '#f1ece8', '#d9d0ca', '#ffffff'] : ['#d9d0ca', '#ccbcb2', '#f1ece8', '#4c3b34', '#2c2d32', '#ffffff'];
      const k = 3 + Math.floor(R() * 3), pts: number[] = [];
      for (let j = 0; j < k; j++) { const a = (j / k) * Math.PI * 2 + R() * 0.8, rr = 0.6 + R() * 0.6; pts.push(Math.cos(a) * rr, Math.sin(a) * rr); }
      this.debris.push({
        x: e.x - fx * (rear ? 0.8 : 0) - Math.cos(r.heading) * side * 0.4, y: e.y + 0.25, z: e.z - fz * (rear ? 0.8 : 0) + Math.sin(r.heading) * side * 0.4,
        vx: (rear ? r.vx * 0.55 : r.vx * 0.6) - fx * sp + Math.cos(r.heading) * side * (rear ? 2.5 : 5), vy: (rear ? 2 : 3) + R() * (rear ? 4 : 6), vz: (rear ? r.vz * 0.55 : r.vz * 0.6) - fz * sp - Math.sin(r.heading) * side * (rear ? 2.5 : 5),
        r: (rear ? 0.05 : 0.08) + R() * (e.kind === 'crash' ? 0.3 : rear ? 0.12 : 0.2), a: R() * 6, spin: (R() - 0.5) * 14, life: 0.7 + R() * 0.9, col: cols[Math.floor(R() * cols.length)], pts,
      });
    }
    if (this.debris.length > 260) this.debris.splice(0, this.debris.length - 260);
  }
  draw(rd: Renderer, view: View, r: Rider, dt: number) {
    const c = rd.ctx, W = rd.W, H = rd.H, R = this.rand;
    c.setTransform(rd.dpr, 0, 0, rd.dpr, 0, 0); c.clearRect(0, 0, W, H);
    // (the events the rider threw since last frame)
    for (let i = this.seen; i < r.events.length; i++) this.spawn(r.events[i], r);
    this.seen = r.events.length; if (r.events.length > 48) { r.events.splice(0, r.events.length - 16); this.seen = r.events.length; }
    const eye = view.eye, cv = this.eyeWas && dt > 0 ? [(eye[0] - this.eyeWas[0]) / dt, (eye[1] - this.eyeWas[1]) / dt, (eye[2] - this.eyeWas[2]) / dt] : [0, 0, 0];
    this.eyeWas = eye.slice();
    const speed = Math.hypot(r.vx, r.vz), pace = Math.max(0, Math.min(1, (speed - 14) / 28));
    /** a wedge: its base across `a` (half-width w, square to the motion), its point at `b` */
    const wedge = (a: number[], b: number[], w: number, col: string) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * w, ny = dx / L * w;
      c.fillStyle = col; c.beginPath(); c.moveTo(a[0] + nx, a[1] + ny); c.lineTo(b[0], b[1]); c.lineTo(a[0] - nx, a[1] - ny); c.closePath(); c.fill();
    };
    // (smears off the near furniture: each post and flag dragged back to where it stood a moment ago, against the eye)
    const tau = 0.035 + pace * 0.06;
    const crs = rd.course;
    for (let i = Math.floor(r.s) - 6; i < r.s + 34; i++) {
      const st = crs.at(i); if (i < 0) continue;
      const half = st.width / 2;
      const items: [number, number, number, string][] = [];
      if (st.post && st.feature === 'none') items.push([half + 1.9, 0.6, 0.11, i % 10 ? '#e85a0d' : '#ff7428']);
      if (st.flag) items.push([-half + 0.4, 4.6, 0.9, '#e85a0d']);
      for (const [u, h, w, col] of items) {
        const p = crs.point(i, u), P = [p.x, st.y + h, p.z];
        const a = rd.project(P), b = rd.project([P[0] + cv[0] * tau * 3, P[1] + cv[1] * tau * 3, P[2] + cv[2] * tau * 3]);
        if (!a || !b) continue;
        const px = (w * rd.H) / a[2];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 10) continue;
        wedge(a, b, Math.max(1, px * 0.9), col);
      }
    }
    // (the rider's wake: a few thin wedges trailing from the helmet, the tail and the bars, back along its way)
    if (pace > 0.15 && r.crashT <= 0) {
      const fx = Math.sin(r.heading), fz = Math.cos(r.heading), rx = -Math.cos(r.heading), rz = Math.sin(r.heading);
      const anchors: [number, number, number, string, number][] = [[0, 2.05, 0.15, '#ffffff', 0.05], [0.2, 0.98, -1.0, '#e85a0d', 0.05], [-0.34, 1.1, 0.48, '#ffffff', 0.025], [0.34, 1.1, 0.48, '#24262e', 0.025], [0, 0.4, -1.05, '#d9d0ca', 0.05]];
      for (const [u, h, f, col, w] of anchors) {
        const P = [r.x + rx * u + fx * f, r.y + h, r.z + rz * u + fz * f];
        const back = 0.08 + pace * 0.22;
        const a = rd.project(P), b = rd.project([P[0] - r.vx * back * 0.5, P[1] - r.vy * back * 0.5, P[2] - r.vz * back * 0.5]);
        if (a && b) wedge(a, b, Math.max(1, (w * rd.H) / a[2]), col);
      }
    }
    // (the debris: each chunk a flat faceted shape, spun, smeared along its motion against the eye)
    for (const d of this.debris) {
      d.life -= dt; d.vy -= 9.8 * dt; d.vx *= 1 - dt * 0.6; d.vz *= 1 - dt * 0.6; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.a += d.spin * dt;
      const p = rd.project([d.x, d.y, d.z]); if (!p) continue;
      const s = (d.r * rd.H) / p[2]; if (s < 0.6) continue;
      const q = rd.project([d.x - (d.vx - cv[0]) * 0.05, d.y - (d.vy - cv[1]) * 0.05, d.z - (d.vz - cv[2]) * 0.05]);
      if (q && Math.hypot(q[0] - p[0], q[1] - p[1]) > s * 1.5) wedge(p, q, s * 0.75, d.col);
      c.fillStyle = d.col; c.beginPath();
      const ca = Math.cos(d.a), sa = Math.sin(d.a);
      for (let j = 0; j < d.pts.length; j += 2) { const x = d.pts[j] * s, y = d.pts[j + 1] * s; c[j ? 'lineTo' : 'moveTo'](p[0] + x * ca - y * sa, p[1] + x * sa + y * ca); }
      c.closePath(); c.fill();
    }
    this.debris = this.debris.filter((d) => d.life > 0);
    // (the shards: thin wedges streaming out from the point ahead, more and longer the faster you go)
    const vp = rd.project([eye[0] + (view.target[0] - eye[0]) * 20, eye[1] + (view.target[1] - eye[1]) * 20, eye[2] + (view.target[2] - eye[2]) * 20]) ?? [W / 2, H * 0.42, 1];
    const want = Math.round(pace * pace * 46 + (r.air ? 6 : 0));
    while (this.shards.length < want) this.shards.push(this.newShard(R, true));
    if (this.shards.length > want) this.shards.length = want;
    const D = Math.hypot(W, H) / 2;
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      s.r += dt * s.sp * (0.5 + pace * 1.6) * (0.3 + s.r);
      if (s.r > 1.25) { this.shards[i] = this.newShard(R, false); continue; }
      const len = s.len * (0.4 + pace * 1.1) * (0.4 + s.r), ca = Math.cos(s.a), sa = Math.sin(s.a);
      const out = [vp[0] + ca * s.r * D, vp[1] + sa * s.r * D], inn = [vp[0] + ca * Math.max(0.05, s.r - len) * D, vp[1] + sa * Math.max(0.05, s.r - len) * D];
      wedge(out, inn, s.w * (0.5 + s.r * 1.6), s.col);
    }
  }
  private newShard(R: () => number, anywhere: boolean): Shard {
    // (kept off the middle band, where the rider is, mostly to the sides and the top)
    // (out to the sides and down: the sky above stays clean)
    let a = R() * Math.PI * 2;
    if (Math.sin(a) < -0.3) a = Math.PI * 2 - a;
    const big = R() < 0.2;
    return { a, r: anywhere ? 0.35 + R() * 0.8 : 0.3 + R() * 0.2, w: big ? 5 + R() * 9 : 0.8 + R() * 3, len: big ? 0.2 + R() * 0.25 : 0.06 + R() * 0.2, col: SHARD_COLS[Math.floor(R() * SHARD_COLS.length)], sp: 0.6 + R() * 0.8 };
  }
}
function mulberry(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

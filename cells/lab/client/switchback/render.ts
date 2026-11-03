/**
 * Switchback's drawing. Two layers:
 *
 * - **the world** (WebGL2): flat facets, each face's normal from the screen derivatives, its light (nudged a little by its
 *   tone) picking one of its material's four bands, so a face is one colour and the next another; a hard **shadow map**
 *   around the rider, so the cliff, the pines, the truss and the rider throw dark, sharp-edged shadows (anything in shadow
 *   takes its material's deepest band: the target's charcoal); distance fades it toward the blues in steps, never
 *   smoothly, by how much each material fades. The ground is drawn in rings, finest last: the far ranges (384 m cells),
 *   the valley (96 m), the mountainside (24 m), then the near ground (4 m, the road cut into it) with the route, the
 *   rider and the debris (faceted blocks thrown off the rear wheel).
 * - **the speed** (a 2D canvas over it): motion drawn as vector shapes, not blur. Shards (thin wedges, white, pale,
 *   charcoal, orange) streaming out from the point you're riding at, to the sides and below; a wedge smeared back from each
 *   fence post and pennant as it whips past; the rider's own wake; and each flying block's smear along its motion.
 */
import { Course, hash } from './course';
import { CHUNK, FOGW, M, NEAR, PALETTE, buildDebris, buildFar, buildNear, buildRider, buildRiver, buildTrack } from './mesh';
import type { Rider, Event } from './sim';

const VS = `#version 300 es
in vec4 aP; uniform mat4 uVP; out vec3 vW; flat out int vM; flat out float vT;
void main() { vW = aP.xyz; vM = int(aP.w); vT = fract(aP.w); gl_Position = uVP * vec4(vW, 1.); }`;
const FS = `#version 300 es
precision highp float; precision highp sampler2DShadow;
in vec3 vW; flat in int vM; flat in float vT;
uniform vec3 uPal[56]; uniform float uFogW[14]; uniform vec3 uEye; uniform vec3 uSun; uniform mat4 uLVP; uniform sampler2DShadow uShadow; uniform float uShade;
out vec4 o;
void main() {
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  float l = dot(n, uSun) + (vT / .9 - .5) * .3;
  int b = l > .55 ? 0 : l > .3 ? 1 : l > .02 ? 2 : 3;
  // (in the rider's shadow map: cast shadow is the deepest band)
  if (uShade > .5 && b < 3) {
    // (looked up a little off the face, along its normal, so a face doesn't shadow itself)
    vec4 lp = uLVP * vec4(vW + n * .3 * sign(dot(n, uSun)), 1.); vec3 q = lp.xyz * .5 + .5;
    if (q.x > 0. && q.x < 1. && q.y > 0. && q.y < 1. && q.z < 1.) { if (texture(uShadow, vec3(q.xy, q.z - .0006)) < .5) b = 3; }
  }
  vec3 c = uPal[vM * 4 + b];
  // (distance: toward the valley's blues in hard steps, each face keeping its band)
  float d = length(vW - uEye);
  float f = d < 260. ? 0. : d < 650. ? .3 : d < 1400. ? .55 : d < 3200. ? .72 : .86;
  vec3 fogs[4] = vec3[4](vec3(.27, .43, .92), vec3(.21, .38, .9), vec3(.12, .29, .8), vec3(.11, .16, .3));
  o = vec4(mix(c, fogs[b], f * uFogW[vM]), 1.);
}`;
const SVS = `#version 300 es
in vec4 aP; uniform mat4 uLVP; void main() { gl_Position = uLVP * vec4(aP.xyz, 1.); }`;
const SFS = `#version 300 es
precision mediump float; void main() {}`;

export type Mat = Float32Array;
export function perspective(fov: number, asp: number, n: number, f: number): Mat {
  const t = 1 / Math.tan(fov / 2), m = new Float32Array(16);
  m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = (2 * f * n) / (n - f); return m;
}
export function ortho(l: number, r: number, b: number, t: number, n: number, f: number): Mat {
  const m = new Float32Array(16);
  m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n); m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); m[15] = 1; return m;
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

/** the sun: high, from up the mountain and a little to one side, so shadows fall down toward the valley */
export const SUN = norm([0.18, 0.78, -0.6]);
export const SKY = '#083fea';

export interface View { eye: number[]; target: number[]; fov: number; roll: number }

class Buf {
  vao: WebGLVertexArrayObject; buf: WebGLBuffer; n = 0;
  /** the box the geometry's in (x, z), for skipping what's outside a ring */
  box = [Infinity, Infinity, -Infinity, -Infinity];
  constructor(private gl: WebGL2RenderingContext, data: Float32Array | null, dynamic = false) {
    this.vao = gl.createVertexArray()!; this.buf = gl.createBuffer()!;
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    if (data) this.set(data, dynamic);
  }
  set(d: Float32Array, dynamic = false) {
    const gl = this.gl; gl.bindBuffer(gl.ARRAY_BUFFER, this.buf); gl.bufferData(gl.ARRAY_BUFFER, d, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW); this.n = d.length / 4;
    if (!dynamic) { const b = this.box; for (let i = 0; i < d.length; i += 4) { b[0] = Math.min(b[0], d[i]); b[1] = Math.min(b[1], d[i + 2]); b[2] = Math.max(b[2], d[i]); b[3] = Math.max(b[3], d[i + 2]); } }
  }
  draw() { if (!this.n) return; const gl = this.gl; gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, this.n); }
  free() { this.gl.deleteBuffer(this.buf); this.gl.deleteVertexArray(this.vao); }
}

/** a ring of far ground: rebuilt about the eye when the eye has moved `snap` from where it was built */
type Ring = { cell: number; extent: number; hole: number; snap: number; cx: number; cz: number; buf: Buf | null };
/** the near ground's reach either side of the eye (chunks) */
const REACH = 5;

export class Renderer {
  gl: WebGL2RenderingContext; ctx: CanvasRenderingContext2D;
  private prog: WebGLProgram; private sprog: WebGLProgram; private u: Record<string, WebGLUniformLocation | null> = {}; private su: Record<string, WebGLUniformLocation | null> = {};
  private near = new Map<number, Buf>(); private track = new Map<number, Buf>(); private river: Buf; private rider: Buf; private debris: Buf;
  private rings: Ring[] = [
    { cell: 384, extent: 24576, hole: 2000, snap: 3072, cx: NaN, cz: NaN, buf: null },
    { cell: 96, extent: 6144, hole: 600, snap: 768, cx: NaN, cz: NaN, buf: null },
    { cell: 24, extent: 1536, hole: 120, snap: 96, cx: NaN, cz: NaN, buf: null },
  ];
  private shadowTex: WebGLTexture; private shadowFb: WebGLFramebuffer; private lvp: Mat = new Float32Array(16);
  static SHADOW = 2048; static SHADOW_REACH = 64;
  vp: Mat = new Float32Array(16); W = 1; H = 1; dpr = 1;
  /** cast shadows (`shadows=0` turns them off, to see the facets alone) */
  shadows = true;
  fx = new Fx();
  constructor(readonly canvas: HTMLCanvasElement, readonly overlay: HTMLCanvasElement, readonly course: Course) {
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl; this.ctx = overlay.getContext('2d')!;
    const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) ?? 'shader'); return o; };
    const link = (v: string, f: string) => { const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, v)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, f)); gl.bindAttribLocation(p, 0, 'aP'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link'); return p; };
    this.prog = link(VS, FS); this.sprog = link(SVS, SFS);
    for (const n of ['uVP', 'uPal', 'uFogW', 'uEye', 'uSun', 'uLVP', 'uShadow', 'uShade']) this.u[n] = gl.getUniformLocation(this.prog, n);
    this.su.uLVP = gl.getUniformLocation(this.sprog, 'uLVP');
    gl.useProgram(this.prog);
    gl.uniform3fv(this.u.uPal, new Float32Array(PALETTE.flat().map(hex).flat()));
    gl.uniform1fv(this.u.uFogW, new Float32Array(FOGW));
    gl.uniform3fv(this.u.uSun, new Float32Array(SUN));
    gl.uniform1i(this.u.uShadow, 0);
    // (the shadow map: depth only, compared in hardware)
    this.shadowTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, Renderer.SHADOW, Renderer.SHADOW, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    // (filtered, so each lookup is the share of its four texels in light; thresholded at a half, the edge stays hard but
    // runs smooth between texels, not stepped along them)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.river = new Buf(gl, buildRiver(course.seed)); this.rider = new Buf(gl, null); this.debris = new Buf(gl, null);
  }
  resize() {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.W = innerWidth; this.H = innerHeight;
    for (const c of [this.canvas, this.overlay]) { c.width = Math.round(this.W * this.dpr); c.height = Math.round(this.H * this.dpr); }
  }
  /** keep the near ground built about the eye, the route's chunks from just behind the rider to well ahead, and the
   * rings about the eye; at most `budget` new pieces a frame (a ring counts several) */
  private stream(eye: number[], s: number, budget: number) {
    this.course.ensure(s + 3000);
    const ei = Math.floor(eye[0] / NEAR), ej = Math.floor(eye[2] / NEAR), key = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);
    for (const [k, b] of this.near) { const i = Math.floor(k / 8192) - 4096, j = (k % 8192) - 4096; if (Math.abs(i - ei) > REACH + 1 || Math.abs(j - ej) > REACH + 1) { b.free(); this.near.delete(k); } }
    const want: [number, number, number][] = [];
    for (let i = ei - REACH; i <= ei + REACH; i++) for (let j = ej - REACH; j <= ej + REACH; j++) if (!this.near.has(key(i, j))) want.push([(i - ei) ** 2 + (j - ej) ** 2, i, j]);
    want.sort((a, b) => a[0] - b[0]);
    for (const [, i, j] of want) { if (budget <= 0) break; this.near.set(key(i, j), new Buf(this.gl, buildNear(this.course, i, j))); budget--; }
    const lo = Math.max(0, Math.floor((s - 120) / CHUNK)), hi = Math.floor((s + 900) / CHUNK);
    for (const [n, b] of this.track) if (n < lo || n > hi) { b.free(); this.track.delete(n); }
    for (let n = lo; n <= hi && budget > 0; n++) if (!this.track.has(n)) { this.track.set(n, new Buf(this.gl, buildTrack(this.course, n))); budget--; }
    for (const g of this.rings) {
      if (budget <= 0 && g.buf) break;
      if (!g.buf || Math.hypot(eye[0] - g.cx, eye[2] - g.cz) > g.snap) {
        g.cx = Math.round(eye[0] / g.cell) * g.cell; g.cz = Math.round(eye[2] / g.cell) * g.cell;
        g.buf?.free(); g.buf = new Buf(this.gl, buildFar(this.course.seed, g.cx, g.cz, g.cell, g.extent, g.hole)); budget -= 4;
      }
    }
  }
  frame(view: View, r: Rider, t: number, dt: number, budget = 2) {
    const gl = this.gl;
    this.stream(view.eye, r.s, budget);
    const asp = this.W / this.H, fov = asp < 1 ? view.fov * 1.25 : view.fov;
    const fwd = norm([view.target[0] - view.eye[0], 0, view.target[2] - view.eye[2]]), rt = [-fwd[2], 0, fwd[0]];
    const upv = norm([rt[0] * Math.sin(view.roll), Math.cos(view.roll), rt[2] * Math.sin(view.roll)]);
    this.vp = mul(perspective(fov, asp, 0.3, 40000), lookAt(view.eye, view.target, upv));
    const nearVp = mul(perspective(fov, asp, 0.25, 2600), lookAt(view.eye, view.target, upv));
    // (what's near enough to draw with the near ground: inside the near square about the eye)
    const reach = (REACH + 0.5) * NEAR, inNear = (b: Buf) => b.box[0] < view.eye[0] + reach && b.box[2] > view.eye[0] - reach && b.box[1] < view.eye[2] + reach && b.box[3] > view.eye[2] - reach;
    const body = buildRider({ ...r, air: r.air, slip: r.slip }, t);
    this.rider.set(body, true);
    this.debris.set(buildDebris(this.fx.blocks(dt)), true);
    // (the shadow map: the near ground, the route, the rider, seen from the sun, about the rider, its texels fixed in the
    // world so the edges don't crawl)
    const E = Renderer.SHADOW_REACH, lv = lookAt([0, 0, 0], [-SUN[0], -SUN[1], -SUN[2]], [0, 1, 0]);
    const cl = [r.x, r.y, r.z], lx = lv[0] * cl[0] + lv[4] * cl[1] + lv[8] * cl[2], ly = lv[1] * cl[0] + lv[5] * cl[1] + lv[9] * cl[2], lz = lv[2] * cl[0] + lv[6] * cl[1] + lv[10] * cl[2];
    const tex = (2 * E) / Renderer.SHADOW, sx = Math.round(lx / tex) * tex, sy = Math.round(ly / tex) * tex;
    this.lvp = mul(ortho(sx - E, sx + E, sy - E, sy + E, -lz - 400, -lz + 400), lv);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
    gl.viewport(0, 0, Renderer.SHADOW, Renderer.SHADOW);
    gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
    gl.useProgram(this.sprog); gl.uniformMatrix4fv(this.su.uLVP, false, this.lvp);
    const nearShadow = (b: Buf) => b.box[0] < r.x + E && b.box[2] > r.x - E && b.box[1] < r.z + E && b.box[3] > r.z - E;
    for (const b of this.near.values()) if (nearShadow(b)) b.draw();
    for (const b of this.track.values()) if (nearShadow(b)) b.draw();
    this.rider.draw();
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // (the world, ring by ring, the finest last, each over the one before)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const sky = hex(SKY); gl.clearColor(sky[0], sky[1], sky[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.uniformMatrix4fv(this.u.uVP, false, this.vp); gl.uniform3fv(this.u.uEye, new Float32Array(view.eye));
    gl.uniformMatrix4fv(this.u.uLVP, false, this.lvp); gl.uniform1f(this.u.uShade, 0);
    for (const g of this.rings) { g.buf?.draw(); if (g.cell === 96) this.river.draw(); gl.clear(gl.DEPTH_BUFFER_BIT); }
    gl.uniformMatrix4fv(this.u.uVP, false, nearVp); gl.uniform1f(this.u.uShade, this.shadows ? 1 : 0);
    for (const b of this.near.values()) b.draw();
    for (const b of this.track.values()) if (inNear(b)) b.draw();
    this.rider.draw(); this.debris.draw();
    this.vp = nearVp;
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

type Block = { x: number; y: number; z: number; vx: number; vy: number; vz: number; r: number; a: number; spin: number; ax: number[]; life: number; mat: number; col: string; seed: number; rest: boolean };
type Shard = { a: number; r: number; w: number; len: number; col: string; sp: number };
const SHARD_COLS = ['#ffffff', '#ffffff', '#ddcfc3', '#c9b9ad', '#232226', '#2c2d32', '#e85a0d', '#ff6a1a'];
const BLOCK_COL: Record<number, string> = { [M.SNOW]: '#ddcfc3', [M.TRACK]: '#c0b0a4', [M.ROCK]: '#2e2d33', [M.ORANGE]: '#e85a0d', [M.KIT]: '#232226', [M.WHITE]: '#ffffff' };

/** the speed: the flying blocks (thrown off the rear wheel, a burst on a landing, a spray on a crash, chips off a wall),
 * and the 2D layer of shards, smears and wake */
export class Fx {
  debris: Block[] = []; shards: Shard[] = [];
  private eyeWas: number[] | null = null; private seen = 0; private rand = mulberry(7); private course: Course | null = null;
  spawn(e: Event, r: Rider) {
    const R = this.rand, fx = Math.sin(r.heading), fz = Math.cos(r.heading), rx = -Math.cos(r.heading), rz = Math.sin(r.heading);
    const n = e.kind === 'roost' ? 1 + (R() < e.k ? 1 : 0) : e.kind === 'land' ? Math.round(6 + e.k * 18) : e.kind === 'crash' ? 34 : e.kind === 'wall' ? 14 : 0;
    // (the roost fans out sideways from the rear tyre, more to the outside of a slide)
    const lean = Math.sign(r.slip || (R() - 0.5));
    for (let i = 0; i < n; i++) {
      const rear = e.kind === 'roost', side = rear ? (R() < 0.7 ? -lean : lean) * (0.4 + R() * 0.6) : (R() - 0.5) * 2;
      const sp = rear ? r.v * (0.12 + R() * 0.2) : 2 + R() * 6;
      const mats = e.kind === 'wall' ? [M.ROCK, M.ROCK, M.SNOW] : e.kind === 'crash' ? [M.ORANGE, M.KIT, M.SNOW, M.TRACK, M.WHITE] : [M.SNOW, M.TRACK, M.TRACK, M.ROCK, M.SNOW];
      const mat = mats[Math.floor(R() * mats.length)];
      const ax = norm([R() - 0.5, R() - 0.5, R() - 0.5]);
      this.debris.push({
        x: e.x - fx * (rear ? 0.75 : 0) + rx * side * 0.3, y: e.y + 0.2, z: e.z - fz * (rear ? 0.75 : 0) + rz * side * 0.3,
        vx: r.vx * 0.55 - fx * sp + rx * side * (rear ? 5 : 5), vy: (rear ? 1.5 : 3) + R() * (rear ? 4.5 : 6), vz: r.vz * 0.55 - fz * sp + rz * side * (rear ? 5 : 5),
        r: (rear ? 0.05 : 0.08) + R() * R() * (e.kind === 'crash' ? 0.35 : rear ? 0.2 : 0.24), a: R() * 6, spin: 4 + R() * 12, ax, life: 0.8 + R() * 0.9, mat, col: BLOCK_COL[mat] ?? '#ddcfc3', seed: R() * 1000, rest: false,
      });
    }
    if (this.debris.length > 260) this.debris.splice(0, this.debris.length - 260);
  }
  /** move the blocks on (they bounce once on the ground and stop), and hand them to be drawn */
  blocks(dt: number) {
    for (const d of this.debris) {
      d.life -= dt; if (d.rest) continue;
      d.vy -= 9.8 * dt; d.vx *= 1 - dt * 0.5; d.vz *= 1 - dt * 0.5; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.a += d.spin * dt;
      if (this.course && d.vy < 0) { const g = this.course.ground(d.x, d.z); if (d.y < g + d.r * 0.5) { d.y = g + d.r * 0.5; if (d.vy < -3) { d.vy *= -0.3; d.vx *= 0.5; d.vz *= 0.5; d.spin *= 0.4; } else d.rest = true; } }
    }
    this.debris = this.debris.filter((d) => d.life > 0);
    return this.debris;
  }
  draw(rd: Renderer, view: View, r: Rider, dt: number) {
    this.course = rd.course;
    const c = rd.ctx, W = rd.W, H = rd.H, R = this.rand;
    c.setTransform(rd.dpr, 0, 0, rd.dpr, 0, 0); c.clearRect(0, 0, W, H);
    for (let i = this.seen; i < r.events.length; i++) this.spawn(r.events[i], r);
    this.seen = r.events.length; if (r.events.length > 48) { r.events.splice(0, r.events.length - 16); this.seen = r.events.length; }
    const eye = view.eye, cv = this.eyeWas && dt > 0 ? [(eye[0] - this.eyeWas[0]) / dt, (eye[1] - this.eyeWas[1]) / dt, (eye[2] - this.eyeWas[2]) / dt] : [0, 0, 0];
    this.eyeWas = eye.slice();
    const speed = Math.hypot(r.vx, r.vz), pace = Math.max(0, Math.min(1, (speed - 14) / 28));
    const wedge = (a: number[], b: number[], w: number, col: string) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * w, ny = dx / L * w;
      c.fillStyle = col; c.beginPath(); c.moveTo(a[0] + nx, a[1] + ny); c.lineTo(b[0], b[1]); c.lineTo(a[0] - nx, a[1] - ny); c.closePath(); c.fill();
    };
    // (smears off the near furniture: each post and pennant dragged back to where it stood a moment ago)
    const tau = 0.03 + pace * 0.05, crs = rd.course;
    for (let i = Math.max(0, Math.floor(r.s) - 6); i < r.s + 34; i++) {
      const st = crs.at(i), half = st.width / 2, items: [number, number, number, string][] = [];
      if (st.post) items.push([st.drop * (half + 1.6), 0.8, 0.08, '#e85a0d']);
      if (st.flag) items.push([st.flag * (half + 2.2), 5.4, 0.9, '#e85a0d']);
      for (const [u, h, w, col] of items) {
        const p = crs.point(i, u), P = [p.x, crs.ground(p.x, p.z) + h, p.z];
        const a = rd.project(P), b = rd.project([P[0] + cv[0] * tau * 3, P[1] + cv[1] * tau * 3, P[2] + cv[2] * tau * 3]);
        if (!a || !b || Math.hypot(b[0] - a[0], b[1] - a[1]) < 10) continue;
        wedge(a, b, Math.max(1, ((w * rd.H) / a[2]) * 0.9), col);
      }
    }
    // (the rider's wake: thin wedges trailing from the helmet, the tail, the bars)
    if (pace > 0.2 && r.crashT <= 0) {
      const fx = Math.sin(r.heading), fz = Math.cos(r.heading), rx = -Math.cos(r.heading), rz = Math.sin(r.heading);
      const anchors: [number, number, number, string, number][] = [[0, 2.15, 0.2, '#ffffff', 0.04], [0, 1.1, -1.1, '#e85a0d', 0.04], [-0.42, 1.45, 0.5, '#ffffff', 0.02], [0.42, 1.45, 0.5, '#232226', 0.02]];
      for (const [u, h, f, col, w] of anchors) {
        const P = [r.x + rx * u + fx * f, r.y + h, r.z + rz * u + fz * f], back = 0.06 + pace * 0.18;
        const a = rd.project(P), b = rd.project([P[0] - r.vx * back * 0.5, P[1] - r.vy * back * 0.5, P[2] - r.vz * back * 0.5]);
        if (a && b) wedge(a, b, Math.max(1, (w * rd.H) / a[2]), col);
      }
    }
    // (each fast block smeared back along its motion against the eye: a wedge from it, in its colour)
    for (const d of this.debris) {
      if (d.rest) continue;
      const p = rd.project([d.x, d.y, d.z]); if (!p) continue;
      const s = (d.r * rd.H) / p[2]; if (s < 1) continue;
      const q = rd.project([d.x - (d.vx - cv[0]) * 0.045, d.y - (d.vy - cv[1]) * 0.045, d.z - (d.vz - cv[2]) * 0.045]);
      if (q && Math.hypot(q[0] - p[0], q[1] - p[1]) > s * 2) wedge(p, q, s * 0.6, d.col);
    }
    // (the shards: thin wedges streaming out from the point ahead, to the sides and below, more and longer the faster)
    const vp = rd.project([eye[0] + (view.target[0] - eye[0]) * 20, eye[1] + (view.target[1] - eye[1]) * 20, eye[2] + (view.target[2] - eye[2]) * 20]) ?? [W / 2, H * 0.42, 1];
    const want = Math.round(pace * pace * 30 + (r.air ? 4 : 0));
    while (this.shards.length < want) this.shards.push(this.newShard(R, true));
    if (this.shards.length > want) this.shards.length = want;
    const D = Math.hypot(W, H) / 2;
    for (let i = 0; i < this.shards.length; i++) {
      const s = this.shards[i];
      s.r += dt * s.sp * (0.5 + pace * 1.6) * (0.3 + s.r);
      if (s.r > 1.25) { this.shards[i] = this.newShard(R, false); continue; }
      const len = s.len * (0.4 + pace * 1.0) * (0.4 + s.r), ca = Math.cos(s.a), sa = Math.sin(s.a);
      const out = [vp[0] + ca * s.r * D, vp[1] + sa * s.r * D], inn = [vp[0] + ca * Math.max(0.05, s.r - len) * D, vp[1] + sa * Math.max(0.05, s.r - len) * D];
      wedge(out, inn, s.w * (0.5 + s.r * 1.5), s.col);
    }
  }
  private newShard(R: () => number, anywhere: boolean): Shard {
    // (out to the sides and down: the sky stays clean; kept off the middle, where the rider is)
    let a = R() * Math.PI * 2;
    if (Math.sin(a) < -0.2) a = Math.PI * 2 - a;
    const big = R() < 0.12;
    return { a, r: anywhere ? 0.45 + R() * 0.7 : 0.4 + R() * 0.2, w: big ? 4 + R() * 7 : 0.7 + R() * 2.4, len: big ? 0.18 + R() * 0.22 : 0.06 + R() * 0.18, col: SHARD_COLS[Math.floor(R() * SHARD_COLS.length)], sp: 0.6 + R() * 0.8 };
  }
}
function mulberry(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
void hash;

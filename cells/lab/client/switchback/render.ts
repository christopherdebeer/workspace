/**
 * Switchback's drawing. Two layers:
 *
 * - **the world** (WebGL2): flat facets, each face's normal from the screen derivatives, its light picking one of its
 *   material's four bands, so a face is one colour and the next face another; the distance fades it toward the blues in
 *   steps, not smoothly; the far ranges round the eye; the rider's hard shadow, the bike flattened along the sun onto the
 *   ground under it.
 * - **the speed** (a 2D canvas over it): motion drawn as vector shapes rather than blurred pixels. Shards (thin wedges,
 *   white, pale, charcoal, orange) streaming out from the point you're riding at, more and longer as you go faster; a
 *   wedge smeared back from each fence post as it whips past (from where it is to where it was a moment ago);
 *   the rider's own wake; and the debris (faceted chunks of snow and rock thrown off the rear wheel, a burst on landing,
 *   a spray on a crash), each smeared along its own motion.
 */
import { Course } from './course';
import { CHUNK, PALETTE, buildChunk, buildFalls, buildFlags, buildRanges, buildRider, buildValley } from './mesh';
import type { Rider, Event } from './sim';
import { GEARS } from './audio';
import { buildRuts, Trail } from './ruts';
import { buildGouges } from './gouge';
import { Painter, Strokes, Brush2D, strokesOver, skyStrokes, lineOf, courseStrokes, rangeStrokes, foothillStrokes, valleyStrokes, fallStrokes, flagStrokes } from './paint';

const VS = `#version 300 es
in vec4 aP; uniform mat4 uVP; uniform vec3 uOff; uniform float uZj; out vec3 vW; flat out int vM;
flat out float vT; uniform vec3 uEye;
// (positions relative to the eye: in world metres, far down the mountain, the faces' screen derivatives lose precision and
// their normals speckle)
void main() { vec3 w = aP.xyz + uOff; vW = w - uEye; vM = int(aP.w); vT = fract(aP.w); gl_Position = uVP * vec4(w, 1.);
  // (what's laid on the ground (the road, its ruts and gouges, a shadow) is drawn a hair toward the eye in depth, so it
  // never fights the ground it lies on, however far off)
  if (vM == 1 || vM == 9 || vM == 10 || vM == 20) gl_Position.z -= 3e-6 * gl_Position.w;
  // (a test's nudge: a face's depth, and only its depth, moved by its own few steps)
  gl_Position.z += uZj * fract(float(gl_VertexID / 3) * .618) * gl_Position.w; }`;
const FS = `#version 300 es
precision highp float;
in vec3 vW; flat in int vM; flat in float vT; uniform vec3 uPal[88]; uniform vec3 uEye; uniform vec3 uSun; uniform float uFog; out vec4 o;
void main() {
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  // (the face's light, nudged by its own tone, picks one of its material's four bands)
  float l = dot(n, uSun) + (vT / .9 - .5) * .42;
  int b = l > .62 ? 0 : l > .3 ? 1 : l > -.05 ? 2 : 3;
  vec3 c = uPal[vM * 4 + b];
  // (distance: toward the valley's blues in four hard steps, each face keeping its band, so the far slopes stay faceted)
  float d = length(vW.xz), f = floor(clamp((d - 80.) / 520., 0., 1.) * 4.) / 4.;
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
/** the eye's near plane: as far out as the eye allows (the depth's precision goes as its square, far off) */
export const NEAR = 0.6;
/** the paper the painted picture's laid on (`paint=1`): where no stroke reaches */
export const PAPER = '#ece7df';

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
  /** how the ruts are drawn: carved, as gouge strokes (gouge.ts), or as the bolts they were before (`ruts=bolts`) */
  rutStyle: 'bolts' | 'cut' = 'cut';
  private chunks = new Map<number, Buf>(); private ranges: Buf; private valley: Buf; private rider: Buf; private shadow: Buf; private flags: Buf; private ruts: Buf; private track: Buf; private falls: Buf;
  /** how the rider's drawn ('cut': flat masses, lit for the picture), a whip held for a pinned frame (rad), and whether
   * the world's drawn at all (`world=0`: the rider alone on the sky, for judging its shapes) */
  style: 'facets' | 'cut' | 'sil' = 'cut'; whip = 0; world = true;
  /** painted (`paint=1`, paint.ts): the mountain laid in brush strokes over its facets; and the strokes, built with each
   * chunk, the backdrop's and the sky's once */
  paint = false; painter: Painter | null = null; stretchWanted = 1; leadWanted: [number, number] | null = null;
  /** only the backdrop drawn (`bg=`) */
  bgOnly = false;
  private strokes = new Map<number, Strokes>(); private backStrokes: Strokes[] = []; private moving: Strokes | null = null; private prevEye: number[] | null = null; private prevEye0: number[] | null = null; private eyeV = [0, 0, 0]; private skyS: Strokes | null = null; private prevVP: Mat | null = null;
  /** your own track, fed after each step of the sim */
  readonly trail: Trail;
  vp: Mat = new Float32Array(16); W = 1; H = 1; dpr = 1;
  fx = new Fx();
  /** for judging a frame: the speed layer (`fx=0` hides it) and the distance fade (`fog=0` shows each face's own colour) */
  speed = true; fog = true;
  /** a test's depth nudge (`zjit`) */
  zjit = 0;
  /** the air on the rider: peeling off the posed figure, or the three streaks set at the helmet and the bars it had
   * before (`wake=fixed`), or none (`wake=0`) */
  wake: 'fixed' | 'peel' | 'none' = 'peel';
  /** this frame's posed rider (its vertices, four floats each), for the air peeling off it */
  body: Float32Array | null = null;
  constructor(readonly canvas: HTMLCanvasElement, readonly overlay: HTMLCanvasElement, readonly course: Course) {
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, stencil: true });
    if (!gl) throw new Error('no webgl2');
    this.gl = gl; this.ctx = overlay.getContext('2d')!;
    const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) ?? 'shader'); return o; };
    const p = gl.createProgram()!; gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.bindAttribLocation(p, 0, 'aP'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    this.prog = p;
    for (const n of ['uVP', 'uOff', 'uPal', 'uEye', 'uSun', 'uFog', 'uZj']) this.u[n] = gl.getUniformLocation(p, n);
    gl.useProgram(p);
    gl.uniform3fv(this.u.uPal, new Float32Array(PALETTE.flat().map(hex).flat()));
    gl.uniform3fv(this.u.uSun, new Float32Array(SUN));
    this.ranges = new Buf(gl, buildRanges(course.seed)); this.valley = new Buf(gl, buildValley(course.seed)); this.rider = new Buf(gl, null); this.shadow = new Buf(gl, null); this.flags = new Buf(gl, null); this.ruts = new Buf(gl, null); this.track = new Buf(gl, null); this.falls = new Buf(gl, null); this.trail = new Trail(course);
  }
  resize() {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.W = innerWidth; this.H = innerHeight;
    for (const c of [this.canvas, this.overlay]) { c.width = Math.round(this.W * this.dpr); c.height = Math.round(this.H * this.dpr); }
  }
  /** keep the chunks from just behind the rider to well ahead built, at most `budget` new ones a frame */
  private stream(s: number, budget: number) {
    const lo = Math.max(0, Math.floor((s - 70) / CHUNK)), hi = Math.floor((s + 640) / CHUNK);
    for (const [n, b] of this.chunks) if (n < lo || n > hi) { b.free(); this.chunks.delete(n); this.strokes.get(n)?.free(); this.strokes.delete(n); }
    for (let n = lo; n <= hi && budget > 0; n++) if (!this.chunks.has(n)) {
      const v = buildChunk(this.course, n);
      this.chunks.set(n, new Buf(this.gl, v)); budget--;
      if (this.painter) {
        const face = strokesOver(v, this.course.seed * 1009 + n, lineOf(this.course, n * CHUNK - 6, (n + 1) * CHUNK + 6)), way = courseStrokes(this.course, n * CHUNK, (n + 1) * CHUNK), all = new Float32Array(face.length + way.length);
        all.set(face); all.set(way, face.length);
        this.strokes.set(n, this.painter.make(all));
      }
    }
  }
  frame(view: View, r: Rider, t: number, dt: number, budget = 1) {
    const gl = this.gl;
    if (this.paint && !this.painter) {
      this.painter = new Painter(gl, new Float32Array(PALETTE.flat().map(hex).flat()), SUN);
      this.backStrokes = [this.painter.make(rangeStrokes(this.course.seed)), this.painter.make(valleyStrokes(this.course.seed)), this.painter.make(foothillStrokes(this.course.seed))];
      this.skyS = this.painter.make(skyStrokes(this.course.seed)); this.painter.stretch = this.stretchWanted; if (this.leadWanted) this.painter.lead = this.leadWanted;
      for (const b of this.chunks.values()) b.free();
      this.chunks.clear();
    }
    this.stream(r.s, this.painter && this.chunks.size === 0 ? 99 : budget);
    const asp = this.W / this.H, fov = asp < 1 ? view.fov * 1.25 : view.fov;
    // (the eye's roll: its up tipped toward its right)
    const fwd = norm([view.target[0] - view.eye[0], 0, view.target[2] - view.eye[2]]), rt = [-fwd[2], 0, fwd[0]];
    const upv = norm([rt[0] * Math.sin(view.roll), Math.cos(view.roll), rt[2] * Math.sin(view.roll)]);
    this.vp = mul(perspective(fov, asp, NEAR, 9000), lookAt(view.eye, view.target, upv));
    // (the last frame's eye, for the strokes' stretch: none on a held frame, or when the eye's jumped (put back, a cut))
    const jump = !this.prevEye || Math.hypot(view.eye[0] - this.prevEye[0], view.eye[1] - this.prevEye[1], view.eye[2] - this.prevEye[2]) > 8;
    const prev = this.prevVP && dt > 0 && !jump ? this.prevVP : this.vp; this.prevVP = this.vp; this.prevEye = view.eye.slice();
    // (the eye's motion, smoothed (not its shake), for the strokes' smear: where the world was, as the eye sees it, 0.09 s ago)
    if (dt > 0 && !jump && this.prevEye0) for (let k = 0; k < 3; k++) this.eyeV[k] += ((view.eye[k] - this.prevEye0[k]) / dt - this.eyeV[k]) * Math.min(1, dt * 6);
    if (dt === 0 || jump) this.eyeV = dt === 0 ? this.eyeV : [0, 0, 0];
    this.prevEye0 = view.eye.slice();
    const smear = dt > 0 ? this.eyeV.map((v) => v * 0.09) : [0, 0, 0];
    const pt = this.paint ? this.painter : null, paintBegin = () => pt!.begin(this.vp, prev, view.eye, 1 / Math.tan(fov / 2), this.canvas.width, this.canvas.height, this.dpr, smear);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const sky = hex(SKY); gl.clearColor(sky[0], sky[1], sky[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uVP, false, this.vp); gl.uniform3fv(this.u.uEye, new Float32Array(view.eye)); gl.uniform1f(this.u.uZj, this.zjit);
    const body = this.body = buildRider({ x: r.x, y: r.y, z: r.z, heading: r.heading, pitch: r.pitch, lean: r.lean, squash: r.squash, crashT: r.crashT, air: r.air, steer: r.steer, yFront: r.yFront, yRear: r.yRear, dist: r.dist, body: r.body, whip: this.whip || r.whip, trick: r.trickOut ? r.outs : undefined, style: this.style }, t);
    // (the rider, cut: lit for the picture rather than by the sun, from above, behind the eye and to its left, so what
    // faces you is one flat field and only the side turned toward the eye's right (the flank, the outside of each arm and
    // leg, the undersides) takes its one cut)
    const drawRider = () => {
      if (this.style === 'cut') gl.uniform3fv(this.u.uSun, new Float32Array(norm([-rt[0] * 0.5 - fwd[0] * 0.3, 0.8, -rt[2] * 0.5 - fwd[2] * 0.3])));
      this.rider.set(body, true); this.rider.draw();
      gl.uniform3fv(this.u.uSun, new Float32Array(SUN));
    };
    if (!this.world) { gl.uniform1f(this.u.uFog, 0); gl.uniform3f(this.u.uOff, 0, 0, 0); drawRider(); this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height); return; }
    // (what moves, built afresh: the ruts near the eye, your own track, the flags, the falls, the rider's shadow)
    const rutsV = this.rutStyle === 'cut' ? buildGouges(this.course, r.s) : buildRuts(this.course, r.s), trackV = this.trail.mesh();
    const flagsV = buildFlags(this.course, r.s - 40, r.s + 320, t), fallsV = buildFalls(this.course, r.s - 30, r.s + 420, t);
    const g = this.course.point(r.s, r.u).y + 0.06, sh = new Float32Array(body.length);
    // (each point of it on the ground where it falls: the road ahead of the rider and behind, not a level plane at the
    // rider's feet, which a slope going away would leave standing in the air)
    const hx = Math.sin(r.heading), hz = Math.cos(r.heading), gy = new Map<number, number>();
    const groundAt = (d: number) => { const k = Math.round(d * 4); let y = gy.get(k); if (y === undefined) { y = this.course.point(r.s + k / 4, r.u).y ?? g - 0.06; gy.set(k, y); } return y + 0.06; };
    for (let i = 0; i < body.length; i += 4) {
      const h = body[i + 1] - g, k = Math.max(0, h) / SUN[1];
      sh[i] = body[i] - SUN[0] * k; sh[i + 2] = body[i + 2] - SUN[2] * k; sh[i + 3] = 9.45;
      sh[i + 1] = groundAt((sh[i] - r.x) * hx + (sh[i + 2] - r.z) * hz);
    }
    const shadowOn = !r.air || body[1] - g < 6;
    if (pt) {
      // painted: nothing but strokes, on paper. The facets go only into the depth, for what hides what.
      const paper = hex(PAPER); gl.clearColor(paper[0], paper[1], paper[2], 1); gl.clearStencil(0); gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      pt.advance(r.s);
      const off = [view.eye[0], view.eye[1] - 60, view.eye[2]];
      const near = () => { if (this.bgOnly) return; gl.uniform3f(this.u.uOff, 0, 0, 0); for (const b of this.chunks.values()) b.draw(); this.rider.set(body, true); this.rider.draw(); this.flags.set(flagsV, true); this.flags.draw(); this.falls.set(fallsV, true); this.falls.draw(); };
      // (where things stand, in the stencil: 2 the backdrop, 1 anything near; nothing drawn)
      gl.colorMask(false, false, false, false); gl.disable(gl.DEPTH_TEST); gl.enable(gl.STENCIL_TEST); gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE); gl.stencilFunc(gl.ALWAYS, 2, 0xff);
      gl.uniform1f(this.u.uFog, 0); gl.uniform3f(this.u.uOff, off[0], off[1], off[2]); this.ranges.draw(); this.valley.draw();
      // (what's near marks only where it's seen: hidden behind the ground, a fall or a far chunk would otherwise claim
      // its whole outline, and nothing would paint there)
      gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT); gl.stencilFunc(gl.ALWAYS, 1, 0xff); near();
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP); gl.disable(gl.DEPTH_TEST);
      // (the sky, wherever nothing near stands: the ranges are painted over it, as a painter would)
      gl.colorMask(true, true, true, true); gl.stencilFunc(gl.NOTEQUAL, 1, 0xff);
      paintBegin(); if (this.skyS) pt.draw(this.skyS, view.eye, false); pt.end(); gl.useProgram(this.prog);
      // (the backdrop, by its own depth, only where nothing near stands)
      gl.enable(gl.DEPTH_TEST); gl.clear(gl.DEPTH_BUFFER_BIT); gl.colorMask(false, false, false, false); gl.stencilFunc(gl.ALWAYS, 0, 0xff);
      gl.uniform3f(this.u.uOff, off[0], off[1], off[2]); this.ranges.draw(); this.valley.draw();
      gl.colorMask(true, true, true, true); gl.stencilFunc(gl.NOTEQUAL, 1, 0xff);
      // (the ranges over the sky and over each other, farthest first, by the order they're laid, not by depth: so their
      // strokes run over the skyline as a brush does, and a nearer range is painted over the one behind it; then the
      // valley, by depth, so its floor doesn't paint over the ranges' feet it lies behind)
      paintBegin(); gl.disable(gl.DEPTH_TEST); pt.draw(this.backStrokes[0], off, false); gl.enable(gl.DEPTH_TEST); pt.draw(this.backStrokes[1], off, false); gl.disable(gl.DEPTH_TEST); pt.draw(this.backStrokes[2], off, false); gl.enable(gl.DEPTH_TEST); pt.end(); gl.useProgram(this.prog);
      gl.disable(gl.STENCIL_TEST);
      // (what's near: its facets only in the depth; then its strokes, laid in the world on them and lifted a little toward
      // the eye, tested against that depth pixel by pixel, far chunks first)
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.colorMask(false, false, false, false); near(); gl.colorMask(true, true, true, true);
      gl.depthFunc(gl.LEQUAL);
      paintBegin();
      // (the ground's strokes, the far chunks first so the near paint over them at the edges)
      if (!this.bgOnly) for (const n of [...this.strokes.keys()].sort((a, b) => b - a)) pt.draw(this.strokes.get(n)!, [0, 0, 0], this.fog);
      // (and what moves, each face's strokes its own, so they stay put on it)
      // (the ruts, the track, the flags and the falls are windows sliding along the way: their strokes seeded by place)
      // (not the gouges: they're cut to the eye, finer near it and broader away, so their faces change as you ride and
      // strokes on them couldn't hold still; the road's own strokes run along it instead)
      const parts = [new Float32Array(0), strokesOver(trackV, 13, null, 4000, true, 0.1, true), shadowOn ? strokesOver(sh, 17, null, 4000, true, 0, true) : new Float32Array(0),  flagStrokes(this.course, r.s - 40, r.s + 320, t, view.eye, SUN), fallStrokes(this.course, r.s - 30, r.s + 420, t), strokesOver(body, 29, null, 9000, true)];
      const all = new Float32Array(parts.reduce((a, p) => a + p.length, 0)); let at = 0;
      for (const p of parts) { all.set(p, at); at += p.length; }
      if (!this.moving) this.moving = pt.make(all, true); else this.moving.set(all);
      if (!this.bgOnly) pt.draw(this.moving, [0, 0, 0], this.fog);
      pt.end(); gl.depthFunc(gl.LESS); gl.useProgram(this.prog);
    } else {
    // (the far ranges, round the eye and a little below it, unfaded)
    gl.uniform1f(this.u.uFog, 0); gl.uniform3f(this.u.uOff, view.eye[0], view.eye[1] - 60, view.eye[2]); this.ranges.draw(); this.valley.draw();
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniform1f(this.u.uFog, this.fog ? 1 : 0); gl.uniform3f(this.u.uOff, 0, 0, 0);
    for (const b of this.chunks.values()) b.draw();
    // (the ruts near the eye, and your own track, a hair over the road)
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1, -1);
    this.ruts.set(rutsV, true); this.ruts.draw();
    this.track.set(trackV, true); this.track.draw();
    gl.disable(gl.POLYGON_OFFSET_FILL);
    // (the rider, and its shadow flattened along the sun onto the ground under it)
    drawRider();
    // (the flags near enough to see, flying; the waterfalls near enough to see, falling)
    this.flags.set(flagsV, true); this.flags.draw();
    this.falls.set(fallsV, true); this.falls.draw();
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -2);
    if (shadowOn) { this.shadow.set(sh, true); this.shadow.draw(); }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    // (the speed layer)
    if (this.speed) this.fx.draw(this, view, r, dt); else { this.ctx.setTransform(1, 0, 0, 1, 0, 0); this.ctx.clearRect(0, 0, this.overlay.width, this.overlay.height); }
  }
  /** a world point on the screen (css px) and its depth, or null behind the eye */
  project(p: number[]): [number, number, number] | null {
    const m = this.vp, x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w < 0.4) return null;
    return [(x / w * 0.5 + 0.5) * this.W, (0.5 - y / w * 0.5) * this.H, w];
  }
}

type Chunk = { x: number; y: number; z: number; vx: number; vy: number; vz: number; r: number; a: number; spin: number; life: number; col: string; pts: number[] };
/** a streak of air hung in the world, which the eye flies through */
type Gust = { x: number; y: number; z: number; w: number; col: string };
/** each colour has one job: white and pale, the air (how fast); orange, the engine pushing (how hard you're speeding up);
 * charcoal, the ground taking it (braking, sliding) */
const AIR_COLS = ['#ffffff', '#ffffff', '#f1ece8', '#d9d0ca'], PUSH_COLS = ['#e85a0d', '#ff7428', '#e85a0d'], GRIT_COLS = ['#24262e', '#2c2d32', '#3a3b44'];
type Streak = { a: number; r: number; w: number; len: number; col: string; sp: number };
/** a streak of air peeling off the rider: the air leaving a point on the posed body (between two of its vertices, ia and
 * ib, at f), streaming back past it and pushed out round it (dir, in the world, set when it's born), cut loose as it goes
 * and gone in a moment; its length and its width at the near end in metres */
type Peel = { ia: number; ib: number; f: number; dir: number[]; age: number; life: number; len: number; w: number; col: string };

/** the speed layer: shards, smears, wake and debris, all flat vector shapes */
export class Fx {
  /** painted: the speed layer laid in the same brush stamps */
  private brush: Brush2D | null = null;
  debris: Chunk[] = []; gusts: Gust[] = []; pushes: Streak[] = []; grit: Streak[] = []; peels: Peel[] = []; private peelDue = 0; private peelP = new Float32Array(0);
  /** what the ride's doing, as the speed layer (and the eye's field of view) read it: the push (0…1, speeding up on the
   * ground), the brake (0…1, slowing), a shift's pulse (at each change up the engine's gears, as the sound has them) and a
   * landing's jolt */
  push = 0; brake = 0; shift = 0; jolt = 0;
  private vWas = -1; private acc = 0; private gear = 0;
  private eyeWas: number[] | null = null; private seen = 0; private rand = mulberry(7);
  spawn(e: Event, r: Rider) {
    const R = this.rand, fx = Math.sin(r.heading), fz = Math.cos(r.heading);
    if (e.kind === 'land') this.jolt = Math.max(this.jolt, 0.4 + e.k * 0.6);
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
    // (the ride, read: how hard it's speeding up or slowing (on the ground; in the air nothing drives you), a slide's scrub,
    // the engine's gear (its change up a pulse), a landing's jolt, each easing off)
    if (dt > 0) {
      const a = this.vWas < 0 || r.air || r.crashT > 0 ? 0 : (speed - this.vWas) / dt;
      this.acc += (Math.max(-30, Math.min(30, a)) - this.acc) * (1 - Math.exp(-dt * 5));
      const g = GEARS.findIndex((x) => speed < x), gear = g < 0 ? GEARS.length - 1 : g;
      if (gear > this.gear && !r.air && this.acc > 0.5) this.shift = 1;
      this.gear = gear;
      this.shift *= Math.exp(-dt * 6); this.jolt *= Math.exp(-dt * 5);
    }
    this.vWas = speed;
    const ground = !r.air && r.crashT <= 0, push = ground ? Math.max(0, Math.min(1, this.acc / 4)) : 0, brake = ground ? Math.max(0, Math.min(1, -this.acc / 7)) : 0;
    this.push += (push - this.push) * (1 - Math.exp(-dt * 6)); this.brake += (brake - this.brake) * (1 - Math.exp(-dt * 6));
    const scrub = ground ? Math.min(1, Math.abs(r.slip) * 3) : 0;
    /** a wedge: its base across `a` (half-width w, square to the motion), its point at `b` */
    const br = rd.paint ? (this.brush ??= new Brush2D()) : null;
    const wedge = (a: number[], b: number[], w: number, col: string) => {
      if (br) { br.wedge(c, a, b, w, col); return; }
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * w, ny = dx / L * w;
      c.fillStyle = col; c.beginPath(); c.moveTo(a[0] + nx, a[1] + ny); c.lineTo(b[0], b[1]); c.lineTo(a[0] - nx, a[1] - ny); c.closePath(); c.fill();
    };
    // (smears off the near furniture: each post dragged back to where it stood a moment ago, against the eye)
    const tau = 0.035 + pace * 0.06;
    const crs = rd.course;
    for (let i = Math.floor(r.s) - 6; i < r.s + 34; i++) {
      const st = crs.at(i); if (i < 0) continue;
      const half = st.width / 2;
      const items: [number, number, number, string][] = [];
      if (st.post && st.feature === 'none') items.push([half + 1.9, 0.6, 0.11, i % 10 ? '#e85a0d' : '#ff7428']);
      for (const [u, h, w, col] of items) {
        const p = crs.point(i, u), P = [p.x, st.y + h, p.z];
        const a = rd.project(P), b = rd.project([P[0] + cv[0] * tau * 3, P[1] + cv[1] * tau * 3, P[2] + cv[2] * tau * 3]);
        if (!a || !b) continue;
        const px = (w * rd.H) / a[2];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 10) continue;
        wedge(a, b, Math.max(1, px * 0.9), col);
      }
    }
    // (the air peeling off the rider)
    if (rd.wake === 'peel') this.peel(rd, r, dt, pace, wedge);
    // (the rider's wake: a few thin wedges trailing from the helmet, the tail and the bars, back along its way)
    if (rd.wake === 'fixed' && pace > 0.15 && r.crashT <= 0) {
      const fx = Math.sin(r.heading), fz = Math.cos(r.heading), rx = -Math.cos(r.heading), rz = Math.sin(r.heading);
      // (the air off the helmet and the bars, as fast as you're going; the orange off the tail only as the engine pushes)
      const anchors: [number, number, number, string, number, number][] = [[0, 2.05, 0.15, '#ffffff', 0.04, 1], [-0.34, 1.1, 0.48, '#ffffff', 0.02, 1], [0.34, 1.1, 0.48, '#d9d0ca', 0.02, 1], [0.2, 0.98, -1.0, '#e85a0d', 0.04, this.push]];
      for (const [u, h, f, col, w, k] of anchors) {
        if (k < 0.2) continue;
        const P = [r.x + rx * u + fx * f, r.y + h, r.z + rz * u + fz * f];
        const back = (0.05 + pace * 0.16) * k * (1 - this.brake * 0.6);
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
      if (br) { br.dab(c, p, s, d.a, d.col); continue; }
      c.fillStyle = d.col; c.beginPath();
      const ca = Math.cos(d.a), sa = Math.sin(d.a);
      for (let j = 0; j < d.pts.length; j += 2) { const x = d.pts[j] * s, y = d.pts[j + 1] * s; c[j ? 'lineTo' : 'moveTo'](p[0] + x * ca - y * sa, p[1] + x * sa + y * ca); }
      c.closePath(); c.fill();
    }
    this.debris = this.debris.filter((d) => d.life > 0);
    // (the air, white and pale: streaks hung in the air ahead, about the way you're going (beside, above, and some close
    // about the rider), which the eye flies through: they come in from the point you're riding at and whip past at the
    // edges, each drawn from where it is back to where it was a moment ago against the eye, longer the faster; braking
    // and a landing's jolt shorten them, a shift up stretches them for a moment)
    const vp = rd.project([eye[0] + (view.target[0] - eye[0]) * 20, eye[1] + (view.target[1] - eye[1]) * 20, eye[2] + (view.target[2] - eye[2]) * 20]) ?? [W / 2, H * 0.42, 1];
    const D = Math.hypot(W, H) / 2;
    const fl = Math.hypot(view.target[0] - eye[0], view.target[1] - eye[1], view.target[2] - eye[2]) || 1;
    const fw = [(view.target[0] - eye[0]) / fl, (view.target[1] - eye[1]) / fl, (view.target[2] - eye[2]) / fl];
    const rl = Math.hypot(fw[0], fw[2]) || 1, rt = [-fw[2] / rl, 0, fw[0] / rl], up = [rt[1] * fw[2] - rt[2] * fw[1], rt[2] * fw[0] - rt[0] * fw[2], rt[0] * fw[1] - rt[1] * fw[0]];
    const spawn = (near: boolean): Gust => {
      const close = R() < 0.25, d = near ? 4 + R() * 68 : 40 + R() * 34;
      let a = 0, rad = 0;
      for (let k = 0; k < 6; k++) { a = R() * Math.PI * 2; rad = close ? 0.9 + R() * 1.3 : 2.6 + R() * 8; if (close || Math.sin(a) * rad > -2) break; }
      const o = close ? [r.x, r.y + 1.1, r.z] : eye, along = close ? Math.max(3, d - 6) : d;
      return { x: o[0] + fw[0] * along + rt[0] * Math.cos(a) * rad + up[0] * Math.sin(a) * rad, y: o[1] + fw[1] * along + up[1] * Math.sin(a) * rad, z: o[2] + fw[2] * along + rt[2] * Math.cos(a) * rad + up[2] * Math.sin(a) * rad, w: R() < 0.12 ? 0.09 + R() * 0.08 : 0.025 + R() * 0.04, col: AIR_COLS[Math.floor(R() * AIR_COLS.length)] };
    };
    const want = Math.round(pace * pace * 56 + (r.air ? 8 : 0));
    while (this.gusts.length < want) this.gusts.push(spawn(true));
    if (this.gusts.length > want) this.gusts.length = want;
    const tl = (0.03 + pace * 0.09) * (1 - this.brake * 0.55) * (1 - this.jolt * 0.5) * (1 + this.shift * 0.4);
    for (let i = 0; i < this.gusts.length; i++) {
      const g = this.gusts[i], p = rd.project([g.x, g.y, g.z]);
      if (!p || p[2] < 1.2 || p[2] > 95) { this.gusts[i] = spawn(false); continue; }
      const q = rd.project([g.x + cv[0] * tl, g.y + cv[1] * tl, g.z + cv[2] * tl]); if (!q) continue;
      const px = (g.w * rd.H) / p[2];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 2) wedge(p, q, Math.max(0.5, Math.min(g.w > 0.08 ? 7 : 3.5, px)), g.col);
    }
    // (orange: the push, streaming back from behind the rider and out past the eye, more and longer the harder the engine
    // is speeding you up, a burst at each change up; charcoal: the ground taking it, low and fast off the wheels, as you
    // brake or slide)
    const rear = rd.project([r.x - Math.sin(r.heading) * 0.9, r.y + 0.5, r.z - Math.cos(r.heading) * 0.9]);
    if (rear) {
      const base = Math.atan2(rear[1] - vp[1], rear[0] - vp[0]);
      const run = (list: Streak[], want: number, cols: string[], spread: number, down: number, w0: number, len0: number) => {
        while (list.length < want) list.push({ a: base + down + (R() - 0.5) * spread, r: R() * 0.2, w: w0 * (0.6 + R()), len: len0 * (0.5 + R()), col: cols[Math.floor(R() * cols.length)], sp: 0.8 + R() * 0.8 });
        if (list.length > want) list.length = want;
        for (let i = 0; i < list.length; i++) {
          const k = list[i];
          k.r += dt * k.sp * (1.2 + pace * 1.4);
          if (k.r > 1) { list[i] = { ...k, a: base + down + (R() - 0.5) * spread, r: 0, col: cols[Math.floor(R() * cols.length)] }; continue; }
          const ca = Math.cos(k.a), sa = Math.sin(k.a), out = [rear[0] + ca * k.r * D * 0.9, rear[1] + sa * k.r * D * 0.9], inn = [rear[0] + ca * Math.max(0, k.r - k.len) * D * 0.9, rear[1] + sa * Math.max(0, k.r - k.len) * D * 0.9];
          wedge(out, inn, k.w * (0.4 + k.r * 1.8), k.col);
        }
      };
      run(this.pushes, Math.round(ground ? this.push * 10 + this.shift * 8 : 0), PUSH_COLS, 0.9, 0, 2.2, 0.16 + this.push * 0.12);
      run(this.grit, Math.round(ground ? this.brake * 9 + scrub * 8 : 0), GRIT_COLS, 1.4, 0.35, 1.6, 0.08);
    } else { this.pushes.length = 0; this.grit.length = 0; }
  }

  /**
   * The air peeling off the rider: now and then a streak where the air leaves the figure as it's posed this frame
   * (whatever it's doing: leaning, whipped, upside down in a flip). It's drawn in the world, not on the screen: from a point
   * on the body it streams back past the rider and a little out round it, cut loose as it goes, so the eye sees it as the
   * air does go, fine where it leaves the body and broadening toward the eye. Born evenly along the outline (not most of
   * them at whatever sticks out furthest, the helmet), never where one's still going, and only where the air leaving
   * there is seen to leave the figure, never crossing it; on the ground only sideways off its flanks (not up off the top,
   * which from a chase eye reads as hair on end, nor down off the wheels at the road). More of them the faster you go (none below the pace the fixed streaks showed at), fewer braking, a few
   * more in the air. A still or paused frame holds them as they are, or, if there are none yet, shows a moment's worth.
   */
  private peel(rd: Renderer, r: Rider, dt: number, pace: number, wedge: (a: number[], b: number[], w: number, col: string) => void) {
    const B = rd.body, R = this.rand, speed = Math.hypot(r.vx, r.vy, r.vz);
    if (!B || r.crashT > 0 || speed < 1) { this.peels.length = 0; return; }
    // (the figure on the screen: each vertex (projected as rd.project does, without the garbage), its box and its middle;
    // and its middle in the world)
    const n = B.length >> 2, P = this.peelP.length >= n * 2 ? this.peelP : (this.peelP = new Float32Array(n * 2)), m = rd.vp;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, cx = 0, cy = 0, k = 0, X0 = 0, Y0 = 0, Z0 = 0;
    for (let i = 0; i < n; i++) {
      const X = B[i * 4], Y = B[i * 4 + 1], Z = B[i * 4 + 2], w = m[3] * X + m[7] * Y + m[11] * Z + m[15];
      X0 += X; Y0 += Y; Z0 += Z;
      if (w < 0.4) { P[i * 2] = NaN; continue; }
      const px = ((m[0] * X + m[4] * Y + m[8] * Z + m[12]) / w * 0.5 + 0.5) * rd.W, py = (0.5 - (m[1] * X + m[5] * Y + m[9] * Z + m[13]) / w * 0.5) * rd.H;
      P[i * 2] = px; P[i * 2 + 1] = py; cx += px; cy += py; k++;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    if (k < 3) return;
    cx /= k; cy /= k; X0 /= n; Y0 /= n; Z0 /= n;
    const S = Math.max(x1 - x0, y1 - y0);
    const at = (q: Peel) => { const a = q.ia * 4, b = q.ib * 4, f = q.f; return [B[a] + (B[b] - B[a]) * f, B[a + 1] + (B[b + 1] - B[a + 1]) * f, B[a + 2] + (B[b + 2] - B[a + 2]) * f]; };
    const onScreen = (q: Peel) => { const a = q.ia * 2, b = q.ib * 2; return [P[a] + (P[b] - P[a]) * q.f, P[a + 1] + (P[b + 1] - P[a + 1]) * q.f]; };
    // (the outline, near enough: the vertex standing out furthest in each of 24 directions round the figure, in order)
    const ring: number[] = [];
    for (let j = 0; j < 24; j++) {
      const dx = Math.cos((j / 24) * Math.PI * 2), dy = Math.sin((j / 24) * Math.PI * 2);
      let v = -1, best = -Infinity;
      for (let i = 0; i < n; i++) { const d = P[i * 2] * dx + P[i * 2 + 1] * dy; if (d > best) { best = d; v = i; } }
      if (v >= 0 && ring[ring.length - 1] !== v && ring[0] !== v) ring.push(v);
    }
    if (ring.length < 3) return;
    const edges = ring.map((v, j) => { const u = ring[(j + 1) % ring.length]; return Math.hypot(P[u * 2] - P[v * 2], P[u * 2 + 1] - P[v * 2 + 1]); });
    const around = edges.reduce((a, b) => a + b, 0);
    const back = [-r.vx / speed, -r.vy / speed, -r.vz / speed];
    /** (as the eye sees it now, it leaves the figure, never crossing it; and on the ground only sideways off its flanks:
     * from a chase eye the air rushing back past the top of the figure is drawn going up, which reads as hair on end, and
     * past the bottom going down, as spray; `steep` lets it, in the air, now and then, as the figure turns) */
    const seen = (q: Peel, steep: boolean) => {
      const p = at(q), [sx, sy] = onScreen(q), e = rd.project([p[0] + q.dir[0], p[1] + q.dir[1], p[2] + q.dir[2]]);
      if (!e || !(sx === sx)) return false;
      let ex = e[0] - sx, ey = e[1] - sy; const el = Math.hypot(ex, ey); if (el < 1) return false; ex /= el; ey /= el;
      const nx = sx - cx, ny = sy - cy, nl = Math.hypot(nx, ny) || 1;
      return (ex * nx + ey * ny) / nl >= 0.2 && (steep || Math.abs(ey) <= 0.55);
    };
    // (a still or paused frame: the eye may still be settling, so what was there is kept only while it still holds)
    if (dt === 0) this.peels = this.peels.filter((q) => q.ia < n && q.ib < n && seen(q, r.air));
    const live = this.peels.filter((q) => q.ia < n && q.ib < n && q.age < q.life);
    const born = () => {
      for (let tries = 0; tries < 8; tries++) {
        // (somewhere along the outline, evenly by its length)
        let d = R() * around, j = 0;
        while (j < edges.length - 1 && d > edges[j]) { d -= edges[j]; j++; }
        const q: Peel = { ia: ring[j], ib: ring[(j + 1) % ring.length], f: edges[j] > 0 ? Math.min(1, d / edges[j]) : 0, dir: back, age: 0, life: 0.3 + R() * 0.25, len: (0.5 + R() * 0.6) * (0.7 + pace * 0.6), w: 0.03 + R() * 0.03, col: AIR_COLS[Math.floor(R() * AIR_COLS.length)] };
        const [sx, sy] = onScreen(q);
        if (!(sx === sx)) continue;
        if (!r.air && sy > y0 + (y1 - y0) * 0.75) continue;
        // (not where one's still going)
        if (live.some((o) => { const [ox, oy] = onScreen(o); return Math.hypot(ox - sx, oy - sy) < S * 0.12; })) continue;
        // (its way: back past the rider, and out round the body from its middle (square to the way back), as air's pushed)
        const p = at(q);
        let ox = p[0] - X0, oy = p[1] - Y0, oz = p[2] - Z0; const ob = ox * back[0] + oy * back[1] + oz * back[2];
        ox -= back[0] * ob; oy -= back[1] * ob; oz -= back[2] * ob; const ol = Math.hypot(ox, oy, oz) || 1;
        const dir = [back[0] + (ox / ol) * 0.55, back[1] + (oy / ol) * 0.55, back[2] + (oz / ol) * 0.55], dl = Math.hypot(dir[0], dir[1], dir[2]);
        q.dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
        if (!seen(q, r.air && R() < 0.3)) continue;
        this.peels.push(q); live.push(q);
        return;
      }
    };
    const rate = pace > 0.15 ? ((0.25 + pace * pace) * 11 + (r.air ? 5 : 0)) * (1 - this.brake * 0.6) : 0;
    if (dt > 0) {
      this.peelDue += rate * dt;
      while (this.peelDue >= 1) { this.peelDue -= 1; born(); }
    } else if (rate > 0) {
      // (a still frame: a moment's worth, at every age, topped up as the eye settles)
      for (let i = Math.round(rate * 0.42) - this.peels.length; i > 0; i--) { const was = this.peels.length; born(); if (this.peels.length > was) this.peels[was].age = R() * this.peels[was].life; }
    }
    for (const q of this.peels) {
      q.age += dt;
      if (q.ia >= n || q.ib >= n || q.age >= q.life) { q.age = q.life; continue; }
      // (cut loose as it goes: its near end streaming on toward the eye, its far end leaving the body)
      const t = q.age / q.life, p = at(q), gap = 0.06 + 1.1 * t * t, L = q.len * (0.3 + 0.7 * Math.min(1, t * 3));
      const a = rd.project([p[0] + q.dir[0] * (gap + L), p[1] + q.dir[1] * (gap + L), p[2] + q.dir[2] * (gap + L)]), b = rd.project([p[0] + q.dir[0] * gap, p[1] + q.dir[1] * gap, p[2] + q.dir[2] * gap]);
      if (!a || !b || Math.hypot(a[0] - b[0], a[1] - b[1]) < 2) continue;
      wedge(a, b, Math.max(0.6, Math.min(6, (q.w * rd.H) / a[2]) * (1 - 0.6 * t)), q.col);
    }
    this.peels = this.peels.filter((q) => q.age < q.life);
  }
}
function mulberry(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

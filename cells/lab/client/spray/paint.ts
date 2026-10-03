/**
 * Spray: the paint, apart from how the can is tracked. A wall is a plane in the world (centre,
 * right, up, its size in metres) with a texture laid over it; a can at some point, pointing some
 * way, sprays a cone at it. Where the cone meets the wall it leaves a soft core and, around it, the
 * speckle of overspray; the closer the can, the smaller and denser the spot. Paint laid on too
 * thick runs: drips, down the wall, until they've given up their paint.
 */
import { seeded } from '../kit/rng';

export type V3 = [number, number, number];

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** A wall: where it is, which way is right and up on it, and how big (m). */
export interface Wall {
  centre: V3;
  right: V3;
  up: V3;
  /** toward whoever's painting it */
  normal: V3;
  w: number;
  h: number;
}

/** A wall standing `d` metres along a heading, facing back along it (upright). */
export function wallAhead(heading: V3, d: number, w: number, h: number, lift = 0): Wall {
  const f = norm([heading[0], 0, heading[2]]);
  const up: V3 = [0, 1, 0];
  return { centre: add(scale(f, d), [0, lift, 0]), right: norm(cross(f, up)), up, normal: scale(f, -1), w, h };
}

/** A wall on a surface found in the world (a hit's position and normal): upright if it's a wall,
 * lying down if it's a floor or a table, its up then pointing away from the viewer. */
export function wallOn(at: V3, normal: V3, viewer: V3, w: number, h: number): Wall {
  const n = norm(normal);
  let up: V3;
  if (Math.abs(n[1]) < 0.7) up = norm(sub([0, 1, 0], scale(n, n[1])));
  else {
    const away = sub(at, viewer);
    up = norm(sub(away, scale(n, dot(away, n))));
  }
  return { centre: at, right: norm(cross(up, n)), up, normal: n, w, h };
}

/** Where a ray meets the wall: the point, its place on the wall (0..1 each way), how far. */
export function hitWall(wall: Wall, o: V3, d: V3): { p: V3; uv: [number, number]; t: number } | null {
  const den = dot(d, wall.normal);
  if (den > -1e-4) return null; // (pointing away, or along it)
  const t = dot(sub(wall.centre, o), wall.normal) / den;
  if (t <= 0) return null;
  const p = add(o, scale(d, t));
  const q = sub(p, wall.centre);
  return { p, uv: [dot(q, wall.right) / wall.w + 0.5, dot(q, wall.up) / wall.h + 0.5], t };
}

/** The cans: the colours in the tray. */
export const CANS: Array<{ name: string; rgb: V3 }> = [
  { name: 'white', rgb: [0.96, 0.96, 0.94] },
  { name: 'black', rgb: [0.06, 0.06, 0.07] },
  { name: 'chrome', rgb: [0.74, 0.76, 0.78] },
  { name: 'red', rgb: [0.88, 0.1, 0.12] },
  { name: 'orange', rgb: [1, 0.48, 0.05] },
  { name: 'yellow', rgb: [1, 0.86, 0.08] },
  { name: 'lime', rgb: [0.45, 0.9, 0.12] },
  { name: 'cyan', rgb: [0.05, 0.75, 0.95] },
  { name: 'blue', rgb: [0.12, 0.28, 0.9] },
  { name: 'pink', rgb: [1, 0.3, 0.68] },
  { name: 'violet', rgb: [0.52, 0.22, 0.86] },
];

/** The spray's cone: half-angle (rad). A spot's radius is the can's distance times its tan. */
export const CONE = 0.19;

const STAMP_VS = `#version 300 es
in vec2 aCorner;
in vec4 aAt;   // centre (uv), radius (uv, each way)
in vec4 aCol;  // colour, how much paint
in vec2 aMore; // seed, kind (0 spray, 1 a drip's bead)
out vec2 vQ;
out vec4 vCol;
flat out vec2 vMore;
const float REACH = 2.4;
void main() {
  vQ = aCorner * REACH;
  vCol = aCol;
  vMore = aMore;
  vec2 uv = aAt.xy + aCorner * REACH * aAt.zw;
  gl_Position = vec4(uv * 2. - 1., 0., 1.);
}`;
const STAMP_FS = `#version 300 es
precision highp float;
in vec2 vQ;
in vec4 vCol;
flat in vec2 vMore;
out vec4 o;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float r2 = dot(vQ, vQ);
  float a;
  if (vMore.y > .5) {
    // a drip's bead: a solid little disc, soft at its rim
    a = smoothstep(1., .7, sqrt(r2)) * vCol.a;
  } else {
    // the cone: a soft core (a gaussian, r its two sigmas) …
    float core = exp(-r2 * 2.) * vCol.a * 1.8;
    // … and the overspray: single droplets, fewer further out, each a crisp dot on the wall
    vec2 cell = floor(gl_FragCoord.xy * .8);
    float drop = h(cell + vMore.x * 17.31);
    float chance = vCol.a * 2.2 * exp(-r2 * .7) + .0015 * step(r2, 4.);
    float speck = step(1. - min(chance, .9) * .2, drop);
    a = clamp(core + speck * (.45 + .4 * h(cell * 1.7 + vMore.x)), 0., 1.);
  }
  if (a < .002) discard;
  o = vec4(vCol.rgb * a, a);
}`;

interface Drip { u: number; v: number; mass: number; speed: number; width: number; colour: V3 }

/**
 * The paint on a wall: a texture, painted by stamps (instanced, many a frame), and a coarse grid
 * of how wet each patch is — from which, when it's wet enough, a drip runs.
 */
export class Painter {
  readonly tex: WebGLTexture;
  private fbo: WebGLFramebuffer;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private inst: WebGLBuffer;
  private stamps: number[] = [];
  private wet: Float32Array;
  private wetCol: Float32Array;
  private drips: Drip[] = [];
  private rand = seeded(0x5b7a);
  /** where the can last hit (to fill in between frames) */
  private last: { uv: [number, number]; r: number } | null = null;
  /** paint laid since the start, roughly (for the preview to know it's done) */
  laid = 0;
  constructor(private gl: WebGL2RenderingContext, public wall: Wall, readonly texW = 3072, readonly texH = 2304, private gw = 96, private gh = 72) {
    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, texW, texH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.prog = program(gl, STAMP_VS, STAMP_FS);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const c = gl.getAttribLocation(this.prog, 'aCorner');
    gl.enableVertexAttribArray(c);
    gl.vertexAttribPointer(c, 2, gl.FLOAT, false, 0, 0);
    this.inst = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    for (const [name, size, off] of [['aAt', 4, 0], ['aCol', 4, 4], ['aMore', 2, 8]] as const) {
      const loc = gl.getAttribLocation(this.prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 40, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    this.wet = new Float32Array(gw * gh);
    this.wetCol = new Float32Array(gw * gh * 3);
    this.clear();
  }
  clear() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.wet.fill(0);
    this.drips = [];
    this.last = null;
    this.laid = 0;
  }
  /** The finger's off the nozzle: the next spray starts afresh. */
  lift() {
    this.last = null;
  }
  /**
   * Spray for `dt` seconds from a can at `o` pointing along `d` (unit). `near` overrides how far
   * the can is from the wall (m) when that can't be known (the phone isn't tracked in space).
   * Returns the distance used, or null if it missed the wall.
   */
  spray(o: V3, d: V3, colour: V3, dt: number, near?: number): number | null {
    const hit = hitWall(this.wall, o, d);
    if (!hit) {
      this.last = null;
      return null;
    }
    const dist = Math.max(0.04, Math.min(2.5, near ?? hit.t));
    // the spot: its radius (m), and how much paint it gets (denser the nearer)
    const r = dist * Math.tan(CONE);
    const ru = r / this.wall.w;
    const rv = r / this.wall.h;
    const from = this.last?.uv ?? hit.uv;
    const span = Math.hypot((hit.uv[0] - from[0]) * this.wall.w, (hit.uv[1] - from[1]) * this.wall.h);
    // (stamps close enough along the stroke that a fast sweep is a line, not a row of dots)
    const n = Math.max(1, Math.min(48, Math.ceil(span / (r * 0.3))));
    const per = dt / n;
    // (paint per stamp: near, a dense spot that covers in half a second; far, a mist that takes
    // a few seconds to build — not as steep as the area alone would make it: the cone is fuller
    // at its middle)
    const amount = Math.min(1, (per * 0.07) / Math.pow(r, 1.3));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const jx = (this.rand() - 0.5) * 0.25 * ru;
      const jy = (this.rand() - 0.5) * 0.25 * rv;
      const u = from[0] + (hit.uv[0] - from[0]) * t + jx;
      const v = from[1] + (hit.uv[1] - from[1]) * t + jy;
      this.stamps.push(u, v, ru, rv, colour[0], colour[1], colour[2], amount, this.rand() * 100, 0);
      this.soak(u, v, amount, r, colour);
    }
    this.laid += amount * n * r * r;
    this.last = { uv: hit.uv, r };
    return dist;
  }
  /** The grid takes up paint where it lands: thick paint, in a small spot, is wet paint. */
  private soak(u: number, v: number, amount: number, r: number, colour: V3) {
    const gx = Math.floor(u * this.gw);
    const gy = Math.floor(v * this.gh);
    if (gx < 0 || gy < 0 || gx >= this.gw || gy >= this.gh) return;
    const i = gy * this.gw + gx;
    // (only the core of a near spray soaks a patch: a far mist never runs)
    const k = amount * 0.5 * Math.min(1, 0.05 / r);
    this.wet[i] += k;
    const w = Math.min(1, k * 4);
    for (let c = 0; c < 3; c++) this.wetCol[i * 3 + c] += (colour[c] - this.wetCol[i * 3 + c]) * w;
  }
  /** Time passes: the paint dries; where it's too wet, it runs. */
  update(dt: number) {
    for (let i = 0; i < this.wet.length; i++) {
      const w = this.wet[i];
      if (w <= 0) continue;
      if (w > 1.6 && this.rand() < dt * 3) {
        const gx = i % this.gw;
        const gy = Math.floor(i / this.gw);
        const mass = 0.5 + this.rand() * 1.2;
        this.drips.push({
          u: (gx + this.rand()) / this.gw,
          v: (gy + 0.3) / this.gh,
          mass,
          speed: 0.02 + 0.025 * mass,
          width: 0.0022 + 0.002 * this.rand(),
          colour: [this.wetCol[i * 3], this.wetCol[i * 3 + 1], this.wetCol[i * 3 + 2]],
        });
        this.wet[i] -= 0.9;
      }
      this.wet[i] = w * Math.exp(-dt / 3.5);
    }
    // the drips: down the wall, slowing as they spend themselves, a bead at the end
    for (const d of this.drips) {
      const step = d.speed * dt;
      d.v -= step / this.wall.h;
      d.mass -= dt * 0.45;
      d.speed *= Math.exp(-dt * 0.35);
      const bead = d.mass <= 0 ? 1.5 : 1;
      this.stamps.push(d.u, d.v, (d.width * bead) / this.wall.w, (d.width * bead * 1.2) / this.wall.h, ...d.colour, 1, 0, 1);
    }
    this.drips = this.drips.filter((d) => d.mass > 0 && d.v > 0);
  }
  /** Lay the frame's stamps into the wall's texture. */
  flush() {
    if (!this.stamps.length) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.texW, this.texH);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.stamps), gl.STREAM_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.stamps.length / 10);
    gl.bindVertexArray(null);
    this.stamps.length = 0;
  }
  /** Drips still running. */
  get running() {
    return this.drips.length;
  }
}

export function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

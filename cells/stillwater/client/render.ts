/**
 * The frame, pass by pass (see shaders.ts for what each one draws):
 *
 *   occ → sim → under(bed, fish shadows, sunken leaves, fish) → screen:
 *   surface, rope, pads, flowers, boat shadow, boat, thread, motes, grade
 *
 * Resolution is adaptive: the canvas renders at `scale` × device pixels, and
 * main.ts walks `scale` down (or back up) from the measured frame time, so a
 * phone that can't hold 60 fps trades sharpness for smoothness rather than
 * stutter.
 */
import { ATTR, bindTarget, bindTex, dropTarget, GL, Instanced, noiseTexture, program, Program, quadBuffer, quadVao, renderTarget, Target } from './gl';
import { SHADERS as S } from './shaders';
import type { Fish } from './fish';
import { DEPTH_K, type Sky } from './atmosphere';
import { Pond, type Pad } from './world';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  cssW: number;
  cssH: number;
}

export interface Light {
  sun: [number, number, number];
  sunCol: [number, number, number];
  amb: [number, number, number];
  sky0: [number, number, number];
  sky1: [number, number, number];
}

export interface Mote {
  x: number;
  y: number;
  size: number;
  r: number;
  g: number;
  b: number;
  a: number;
  core: number;
  /** Parallax scale: 1 at the surface, <1 below it, >1 above it. */
  z: number;
}

export interface FrameInput {
  cam: Camera;
  light: Sky;
  time: number;
  pond: Pond;
  pads: Pad[];
  fish: Fish[];
  motes: Mote[];
  /** Specks suspended under the surface (drawn in the underwater pass). */
  under: Mote[];
  thread: Array<[number, number]>;
  lantern: number;
  /** Names written on leaves at the start: which atlas entry, where, how tall (world), how faded. */
  names?: Array<{ i: number; x: number; y: number; h: number; a: number }>;
}

/** Every program, in build order. The probe in report.ts compiles these one context at a time. */
export const PROGRAMS: Array<[string, string, string]> = [
  ['sim', S.FULLSCREEN_VS, S.SIM_FS],
  ['bed', S.FULLSCREEN_VS, S.BED_FS],
  ['surface', S.FULLSCREEN_VS, S.SURFACE_FS],
  ['mist', S.FULLSCREEN_VS, S.MIST_FS],
  ['grade', S.FULLSCREEN_VS, S.GRADE_FS],
  ['weed', S.WEED_VS, S.WEED_FS],
  ['fish', S.FISH_VS, S.FISH_FS],
  ['pad', S.PAD_VS, S.PAD_FS],
  ['flower', S.FLOWER_VS, S.FLOWER_FS],
  ['floater', S.FLOATER_VS, S.FLOATER_FS],
  ['name', S.NAME_VS, S.NAME_FS],
  ['structure', S.STRUCTURE_VS, S.STRUCTURE_FS],
  ['boat', S.BOAT_VS, S.BOAT_FS],
  ['ribbon', S.RIBBON_VS, S.RIBBON_FS],
  ['mote', S.MOTE_VS, S.MOTE_FS],
];

const MAX_PADS = 900;
const MAX_DROP_ROWS = 512;
const DROP_COLS = 10;
const SIM_W = 168;

export class Renderer {
  gl: GL;
  scale = 1;
  dpr = 1;
  simOn = false;
  /** The wave field wants a float render target; `?nosim=1` (or a failed attempt) turns it off. */
  simWanted = true;
  private simAsked = false;
  private quad: WebGLBuffer;
  private fsVao: WebGLVertexArrayObject;
  private noise: WebGLTexture;
  private p: Record<string, Program>;
  /** Programs attempted so far, in order (for field reports). */
  compiled: string[] = [];
  private padInst: Instanced;
  private deepInst: Instanced;
  private fishInst: Instanced;
  private flowerInst: Instanced;
  private weedInst: Instanced;
  private floatInst: Instanced;
  private structureInst: Instanced;
  private nameInst: Instanced;
  private atlas: WebGLTexture | null = null;
  /** Atlas rows: each name's uv rect and aspect (width / height). */
  private atlasRows: Array<{ u0: number; v0: number; u1: number; v1: number; aspect: number }> = [];
  private chan = new Float32Array(66);
  private span: [number, number] = [0, 1];
  private dropTex: WebGLTexture;
  private dropData = new Float32Array(DROP_COLS * MAX_DROP_ROWS * 4);
  private ribbonVao: WebGLVertexArrayObject;
  private ribbonBuf: WebGLBuffer;
  private ribbonData = new Float32Array(6 * 2 * 6000);
  private moteVao: WebGLVertexArrayObject;
  private moteBuf: WebGLBuffer;
  private moteData = new Float32Array(10 * 600);
  private under: Target | null = null;
  private occ: Target | null = null;
  private simA: Target | null = null;
  private simB: Target | null = null;
  private simW = SIM_W;
  private simH = SIM_W;
  private simCam: [number, number] | null = null;
  private simAcc = 0;
  private w = 0;
  private h = 0;

  /**
   * `attempt` picks progressively plainer context options. iOS 18.7 / Safari 26
   * returned a context that was already lost before the first shader compiled
   * (every shader compiles fine on its own there), so main.ts retries on a
   * fresh canvas with the next set, and `step` names where a loss was seen.
   */
  constructor(private canvas: HTMLCanvasElement, public attempt = 0) {
    const attrs: WebGLContextAttributes[] = [
      { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false },
      { antialias: false },
      {},
    ];
    const gl = canvas.getContext('webgl2', attrs[Math.min(attempt, attrs.length - 1)]);
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    const step = (name: string) => {
      this.compiled.push(name);
      if (gl.isContextLost()) throw Object.assign(new Error(`context lost at ${name}`), { compiled: this.compiled.slice() });
    };
    step('create');
    // float targets only for the wave field; asked for lazily in resize() (see there)
    this.quad = quadBuffer(gl);
    this.fsVao = quadVao(gl, this.quad);
    step('buffers');
    this.noise = noiseTexture(gl);
    step('noise');
    this.p = {};
    for (const [name, vs, fs] of PROGRAMS) {
      this.compiled.push(name);
      try {
        this.p[name] = program(gl, name, vs, fs);
      } catch (e) {
        (e as { compiled?: string[] }).compiled = this.compiled.slice();
        throw e;
      }
      if (gl.isContextLost()) throw new Error(`context lost after compiling ${name}`);
    }
    this.padInst = new Instanced(gl, this.quad, MAX_PADS, 4);
    this.deepInst = new Instanced(gl, this.quad, 400, 3);
    this.fishInst = new Instanced(gl, this.quad, 220, 3);
    this.flowerInst = new Instanced(gl, this.quad, 120, 2);
    this.weedInst = new Instanced(gl, this.quad, 600, 2);
    this.floatInst = new Instanced(gl, this.quad, 4000, 2);
    this.structureInst = new Instanced(gl, this.quad, 96, 2);
    this.nameInst = new Instanced(gl, this.quad, 8, 3);

    this.dropTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.dropTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, DROP_COLS, MAX_DROP_ROWS, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    this.ribbonVao = gl.createVertexArray()!;
    this.ribbonBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.ribbonVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.ribbonData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(ATTR.aPos);
    gl.vertexAttribPointer(ATTR.aPos, 2, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(ATTR.iA);
    gl.vertexAttribPointer(ATTR.iA, 4, gl.FLOAT, false, 24, 8);

    this.moteVao = gl.createVertexArray()!;
    this.moteBuf = gl.createBuffer()!;
    gl.bindVertexArray(this.moteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.moteBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.moteData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(ATTR.aPos);
    gl.vertexAttribPointer(ATTR.aPos, 2, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(ATTR.iA);
    gl.vertexAttribPointer(ATTR.iA, 4, gl.FLOAT, false, 40, 8);
    gl.enableVertexAttribArray(ATTR.iB);
    gl.vertexAttribPointer(ATTR.iB, 4, gl.FLOAT, false, 40, 24);
    gl.bindVertexArray(null);
  }

  info() {
    const gl = this.gl;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), sim: this.simOn };
  }

  /** Size the drawing buffer and the offscreen targets for this CSS size, DPR and scale. */
  resize(cssW: number, cssH: number, dpr: number, scale: number) {
    const gl = this.gl;
    this.dpr = dpr;
    this.scale = scale;
    const w = Math.max(1, Math.round(cssW * dpr * scale));
    const h = Math.max(1, Math.round(cssH * dpr * scale));
    if (w === this.w && h === this.h && this.under) return;
    this.w = w;
    this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;
    dropTarget(gl, this.under);
    dropTarget(gl, this.occ);
    // under the surface is refracted and softened anyway: half resolution is plenty
    this.under = renderTarget(gl, Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.occ = renderTarget(gl, Math.max(1, w >> 2), Math.max(1, h >> 2));
    const simH = Math.min(420, Math.round((SIM_W * cssH) / cssW));
    if (this.simWanted && !this.simAsked) {
      this.simAsked = true;
      this.simOn = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    }
    if (this.simOn && (simH !== this.simH || !this.simA)) {
      dropTarget(gl, this.simA);
      dropTarget(gl, this.simB);
      this.simH = simH;
      try {
        const opts = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
        this.simA = renderTarget(gl, this.simW, simH, opts);
        this.simB = renderTarget(gl, this.simW, simH, opts);
        for (const t of [this.simA, this.simB]) {
          bindTarget(gl, t, 0, 0);
          gl.clearColor(0, 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
      } catch {
        this.simOn = false;
      }
      this.simCam = null;
    }
  }

  /** Forget the camera the wave field was last stepped at (after a rebase jump). */
  shiftSim(dy: number) {
    if (this.simCam) this.simCam[1] -= dy;
  }

  private common(pr: Program, f: FrameInput) {
    const gl = this.gl;
    const { cam, light } = f;
    gl.useProgram(pr.prog);
    const u = pr.u;
    if (u.uView) gl.uniform4f(u.uView, cam.x, cam.y, (2 * cam.zoom) / cam.cssW, (2 * cam.zoom) / cam.cssH);
    if (u.uTime) gl.uniform1f(u.uTime, f.time);
    if (u.uSun) gl.uniform3fv(u.uSun, light.sun);
    if (u.uSunCol) gl.uniform3fv(u.uSunCol, light.sunCol);
    if (u.uAmb) gl.uniform3fv(u.uAmb, light.amb);
    if (u.uSky0) gl.uniform3fv(u.uSky0, light.sky0);
    if (u.uSky1) gl.uniform3fv(u.uSky1, light.sky1);
    if (u.uNoise) {
      bindTex(gl, 0, this.noise);
      gl.uniform1i(u.uNoise, 0);
    }
    if (u.uPx) gl.uniform1f(u.uPx, 1 / (cam.zoom * this.dpr * this.scale));
    if (u.uAspect) gl.uniform1f(u.uAspect, cam.cssW / cam.cssH);
    if (u.uDepthK) gl.uniform1f(u.uDepthK, DEPTH_K);
    if (u.uDusk) gl.uniform1f(u.uDusk, light.dusk);
    if (u.uLamp) {
      const [lx, ly] = f.pond.bow();
      gl.uniform4f(u.uLamp, lx, ly, 150, f.lantern);
    }
    if (u.uChan) gl.uniform2fv(u.uChan, this.chan);
    if (u.uSpanY) gl.uniform2f(u.uSpanY, this.span[0], this.span[1]);
  }

  private fullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  render(f: FrameInput, dt: number) {
    const gl = this.gl;
    const { cam, pond } = f;
    const hw = cam.cssW / (2 * cam.zoom);
    const hh = cam.cssH / (2 * cam.zoom);
    const inView = (x: number, y: number, r: number) => Math.abs(x - cam.x) < hw + r && Math.abs(y - cam.y) < hh + r;

    // ── the river's shape for this frame (bed, surface; wide enough for the bed's parallax) ──
    const y0 = cam.y - hh * 1.5;
    const y1 = cam.y + hh * 1.5;
    this.span = [y0, y1];
    for (let i = 0; i <= 32; i++) {
      const y = y0 + ((y1 - y0) * i) / 32;
      this.chan[i * 2] = pond.channel(y);
      this.chan[i * 2 + 1] = pond.channelHalf(y);
    }

    // ── instance data ──
    let wn = 0;
    for (const w of pond.weeds) {
      if (!inView(w.x, w.y, w.len * 1.3 + 40) || wn >= 600) continue;
      const [fx, fy] = pond.flow(w.x, w.y);
      this.weedInst.set(wn++, w.x, w.y, w.len, Math.atan2(fx, fy), w.depth, w.seed, w.kind, Math.hypot(fx, fy));
    }
    this.weedInst.count = wn;
    this.weedInst.upload();

    let fln = 0;
    for (const fl of pond.floaters) {
      if (!inView(fl.x, fl.y, fl.size * 2) || fln >= 4000) continue;
      this.floatInst.set(fln++, fl.x, fl.y, fl.size, fl.ang, fl.kind, fl.seed, 0, 0);
    }
    // closed buds on their stems draw with the floaters (kind 3)
    for (const b of pond.blooms) {
      if (b.open || !inView(b.x, b.y, b.size * 2) || fln >= 4000) continue;
      this.floatInst.set(fln++, b.x, b.y, b.size, b.ang, 3, b.seed, 0, 0);
    }
    this.floatInst.count = fln;
    this.floatInst.upload();

    const pads = f.pads;
    let rows = 0;
    let n = 0;
    for (const p of pads) {
      if (!inView(p.x, p.y, p.r * 1.4) || n >= MAX_PADS) continue;
      let row = -1;
      const drops = p.drops.length;
      if (drops && rows < MAX_DROP_ROWS) {
        row = rows++;
        for (let k = 0; k < Math.min(drops, DROP_COLS); k++) {
          const d = p.drops[k];
          this.dropData.set([d.x, d.y, d.r, Math.max(0, Math.min(1, d.a))], (row * DROP_COLS + k) * 4);
        }
      }
      // soft body: where it's pressed (and how far it gives), and its flex after a knock
      const flex = p.wob * Math.sin(f.time * 7 + p.seed * 30);
      this.padInst.set(n++, p.x, p.y, p.r, p.ang, p.seed, p.sel, p.bob, Math.max(0, row), row < 0 ? 0 : Math.min(drops, DROP_COLS), p.focus ? 1 : 0, 0, (p.seed * 13.1) % 1, p.dx, p.dy, flex, p.sink);
    }
    this.padInst.count = n;
    this.padInst.upload();
    if (rows) {
      gl.bindTexture(gl.TEXTURE_2D, this.dropTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, DROP_COLS, rows, gl.RGBA, gl.FLOAT, this.dropData, 0);
    }

    let dn = 0;
    for (const d of pond.deep) {
      if (!inView(d.x, d.y, d.r * 1.4) || dn >= 400) continue;
      this.deepInst.set(dn++, d.x, d.y, d.r, d.ang, d.seed, 0, 0, 0, 0, 0, d.depth, (d.seed * 7.7) % 1);
    }
    this.deepInst.count = dn;
    this.deepInst.upload();

    let fn = 0;
    for (const fish of f.fish) {
      if (!inView(fish.x, fish.y, 60) || fn >= 220) continue;
      this.fishInst.set(fn++, fish.x, fish.y, fish.heading, fish.size, fish.z, fish.kind, fish.tail, fish.effort, fish.flash, fish.seed, 0, 0);
    }
    this.fishInst.count = fn;
    this.fishInst.upload();

    let fl = 0;
    for (const b of pond.blooms) {
      if (!b.open || !inView(b.x, b.y, b.size * 2) || fl >= 120) continue;
      this.flowerInst.set(fl++, b.x, b.y, b.size, b.ang, b.variant, 1, b.seed, 0);
    }
    this.flowerInst.count = fl;
    this.flowerInst.upload();

    let lm = 0;
    for (const m of pond.landmarks) {
      if (!inView(m.x, m.y, Math.max(m.w, m.l) * 1.5) || lm >= 96) continue;
      this.structureInst.set(lm++, m.x, m.y, m.w, m.l, m.ang, m.kind, m.seed, m.side);
    }
    this.structureInst.count = lm;
    this.structureInst.upload();

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    // ── occlusion: pads as coverage, for bed shadows and wave damping ──
    bindTarget(gl, this.occ, 0, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    this.common(this.p.pad, f);
    gl.uniform1f(this.p.pad.u.uMode, 1);
    this.padInst.draw();
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);

    // ── waves ──
    this.stepSim(f, dt, hw, hh);

    // ── under the surface ──
    bindTarget(gl, this.under, 0, 0);
    const bed = this.p.bed;
    this.common(bed, f);
    bindTex(gl, 1, this.occ!.tex);
    gl.uniform1i(bed.u.uOcc, 1);
    this.fullscreen();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const weed = this.p.weed;
    this.common(weed, f);
    bindTex(gl, 1, this.occ!.tex);
    gl.uniform1i(weed.u.uOcc, 1);
    this.weedInst.draw();
    this.plantParts(f, inView);
    this.motes(f, f.under, 0.5);
    const fishP = this.p.fish;
    this.common(fishP, f);
    bindTex(gl, 1, this.occ!.tex);
    gl.uniform1i(fishP.u.uOcc, 1);
    gl.uniform1f(fishP.u.uShadow, 1);
    this.fishInst.draw();
    this.common(this.p.pad, f);
    gl.uniform1f(this.p.pad.u.uMode, 2);
    this.deepInst.draw();
    this.common(fishP, f);
    gl.uniform1f(fishP.u.uShadow, 0);
    this.fishInst.draw();
    gl.disable(gl.BLEND);

    // ── the surface ──
    bindTarget(gl, null, this.w, this.h);
    const sf = this.p.surface;
    this.common(sf, f);
    bindTex(gl, 1, this.under!.tex);
    gl.uniform1i(sf.u.uUnder, 1);
    gl.uniform1f(sf.u.uSimOn, this.simOn && this.simA ? 1 : 0);
    if (this.simOn && this.simA) {
      bindTex(gl, 2, this.simA.tex);
      gl.uniform1i(sf.u.uSim, 2);
      gl.uniform2f(sf.u.uSimTexel, 1 / this.simW, 1 / this.simH);
      gl.uniform1f(sf.u.uSimScale, 1.15);
    }
    const gu = new Float32Array(16);
    const gd = new Float32Array(16);
    pond.gusts.slice(-4).forEach((g, i) => {
      gu.set([g.x, g.y, g.r, Pond.gustLevel(g)], i * 4);
      gd.set([g.dx, g.dy, g.radial ? 1 : 0, 0], i * 4);
    });
    gl.uniform4fv(sf.u.uGust, gu);
    gl.uniform4fv(sf.u.uGustDir, gd);
    this.fullscreen();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.wakeRibbons(f);

    // rope, trailing on the water
    const rope: Array<[number, number]> = [];
    for (let i = 0; i < pond.rope.length; i += 2) rope.push([pond.rope[i], pond.rope[i + 1]]);
    const sun = f.light.sun;
    const shadowOff: [number, number] = [(-sun[0] / sun[2]) * 3, (-sun[1] / sun[2]) * 3];
    const solid = (k: number, a: number) => new Array<number>(k).fill(a);
    // a flat cotton ribbon: it twists as it lies, so it narrows where it turns on edge
    const twist = rope.map((_, i) => 0.55 + 0.45 * Math.abs(Math.cos(i * 0.31 + Math.sin(f.time * 0.4 + i * 0.12) * 0.8)));
    this.ribbon(f, rope, twist.map((w) => w * 1.9 + 0.5), [0.55, 0.66, 0.62], solid(rope.length, 0.1), false);
    this.ribbon(f, rope.map(([x, y]) => [x + shadowOff[0], y + shadowOff[1]] as [number, number]), twist.map((w) => w * 1.3), [0, 0, 0], solid(rope.length, 0.22), false);
    this.ribbon(f, rope, twist.map((w) => w * 1.05), [0.62, 0.2, 0.14], solid(rope.length, 1), false);
    // its end: a whipped knot and a small cork float riding the water
    const [ex, ey] = rope[rope.length - 1];
    const [px, py] = rope[rope.length - 2];
    const el = Math.hypot(ex - px, ey - py) || 1;
    const ux = (ex - px) / el;
    const uy = (ey - py) / el;
    const along = (a: number) => [ex + ux * a, ey + uy * a] as [number, number];
    const cork = [0, 1.5, 4, 6.5, 9, 10.5].map(along);
    this.ribbon(f, [along(-1.2), along(0.8)], 1.9, [0.42, 0.13, 0.09], solid(2, 1), false);
    this.ribbon(f, cork.map(([x, y]) => [x + shadowOff[0], y + shadowOff[1]] as [number, number]), [0.8, 3, 3.8, 3.8, 3, 0.8], [0, 0, 0], solid(6, 0.3), false);
    this.ribbon(f, cork, [0.6, 2.4, 3.1, 3.1, 2.4, 0.6], [0.62, 0.47, 0.3], solid(6, 1), false);
    this.ribbon(f, [7.5, 9, 10.4].map(along), [2.2, 2, 0.5], [0.66, 0.2, 0.13], solid(3, 1), false);

    // duckweed, petals, leaves and buds afloat — under the pads' edges
    this.common(this.p.floater, f);
    this.floatInst.draw();

    // pads
    const pad = this.p.pad;
    this.common(pad, f);
    gl.uniform1f(pad.u.uMode, 0);
    bindTex(gl, 1, this.dropTex);
    gl.uniform1i(pad.u.uDrops, 1);
    this.padInst.draw();

    // names on the leaves, drawn with the pads so they move as one
    if (f.names?.length && this.atlas) {
      let k = 0;
      for (const n of f.names) {
        const row = this.atlasRows[n.i];
        if (!row || k >= 8) continue;
        this.nameInst.set(k++, n.x, n.y, n.h * row.aspect, n.h, row.u0, row.v0, row.u1, row.v1, n.a, 0, 0, 0);
      }
      this.nameInst.count = k;
      this.nameInst.upload();
      const np = this.p.name;
      this.common(np, f);
      bindTex(gl, 2, this.atlas);
      gl.uniform1i(np.u.uAtlas, 2);
      this.nameInst.draw();
    }

    // flowers
    this.common(this.p.flower, f);
    this.flowerInst.draw();

    // Dormant bank architecture: visible, but physically and semantically inert.
    this.common(this.p.structure, f);
    this.structureInst.draw();

    // boat
    const b = pond.boat;
    const boat = this.p.boat;
    this.common(boat, f);
    gl.uniform4f(boat.u.uBoat, b.x, b.y, b.heading + b.sway, 1);
    // y: how much the rower throws into it (lean, wet blades) — effort, not speed
    // the rower's swing: laid back a little at rest (the finish), full through a stroke
    gl.uniform4f(boat.u.uOar, pond.oarAngle(), (0.35 + 0.65 * b.rowing) * (0.3 + 0.9 * b.power), b.stroke, f.lantern);
    gl.bindVertexArray(this.fsVao);
    gl.uniform1f(boat.u.uShadow, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.uniform1f(boat.u.uShadow, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // low mist drifting over everything on the water
    if (f.light.mist > 0.01) {
      const mp = this.p.mist;
      this.common(mp, f);
      gl.uniform1f(mp.u.uMist, f.light.mist);
      gl.uniform3fv(mp.u.uMistCol, f.light.mistCol);
      gl.uniform2f(mp.u.uWind, 0, 0);
      this.fullscreen();
    }

    // the golden thread through the chosen leaves
    if (f.thread.length > 1) {
      this.ribbon(f, f.thread, 5, [0.55, 0.42, 0.16], 0.55, true);
      this.ribbon(f, f.thread, 1.3, [1, 0.9, 0.62], 0.9, true);
    }

    // motes, fireflies, gathered dew
    this.motes(f, f.motes);

    // grade
    const gr = this.p.grade;
    this.common(gr, f);
    this.fullscreen();
    gl.disable(gl.BLEND);
  }

  /**
   * The boat's wake, drawn from its recent path: the wave sim's ripples run
   * faster than a rowing boat, so they can only ever make rings — a V needs
   * the boat to outrun its waves. So each point the bow passed spreads two
   * crests sideways at the Kelvin angle (tan 19.5° ≈ 0.35 of the distance
   * travelled since), each a lit crest with a trough beside it; behind the
   * stern, a trail of broken white water. Both fade with age and with speed.
   */
  private wakeRibbons(f: FrameInput) {
    const tr = f.pond.trail;
    if (tr.length < 3) return;
    const now = f.pond.t;
    const bowK = 0.46 * 112;
    for (const side of [-1, 1]) {
      for (const [lift, col, a0, off] of [
        [0, [0, 0, 0] as [number, number, number], 0.16, 5],
        [1, [0.85, 0.95, 0.88] as [number, number, number], 0.22, 0],
      ] as Array<[number, [number, number, number], number, number]>) {
        void lift;
        const pts: Array<[number, number]> = [];
        const ws: number[] = [];
        const as: number[] = [];
        for (let i = tr.length - 1; i >= 0; i--) {
          const p = tr[i];
          const age = now - p.t;
          const spread = 20 + p.speed * age * 0.35 + off;
          const px = p.hy * side;
          const py = -p.hx * side;
          pts.push([p.x + p.hx * bowK * 0.7 + px * spread, p.y + p.hy * bowK * 0.7 + py * spread]);
          ws.push(1.2 + age * 0.9);
          as.push(a0 * Math.pow(Math.max(0, 1 - age / 8), 1.4) * Math.min(1, p.speed / 14) * Math.min(1, age * 3));
        }
        this.ribbon(f, pts, ws, col, as, false);
      }
    }
    // the wash: churned water off the stern, widening and breaking up
    const pts: Array<[number, number]> = [];
    const ws: number[] = [];
    const as: number[] = [];
    for (let i = tr.length - 1; i >= 0; i--) {
      const p = tr[i];
      const age = now - p.t;
      if (age > 4.5) break;
      pts.push([p.x - p.hx * 56, p.y - p.hy * 56]);
      ws.push(7 + age * 5);
      as.push(Math.max(0, 1 - age / 4.5) * Math.min(1, p.speed / 16));
    }
    if (pts.length > 2) this.ribbon(f, pts, ws, [0.88, 0.93, 0.9], as, 2);
  }

  private stepSim(f: FrameInput, dt: number, hw: number, hh: number) {
    const gl = this.gl;
    const { cam, pond } = f;
    if (!this.simOn || !this.simA || !this.simB) {
      pond.impulses.length = 0;
      return;
    }
    const rw = hw * 2 * 1.15;
    const rh = hh * 2 * 1.15;
    this.simAcc = Math.min(this.simAcc + dt, 3 / 60);
    // everything that touched the water this frame, shared across this frame's steps;
    // if there's more than the steps can carry, keep an even sample rather than the newest
    let imps = pond.impulses.splice(0, pond.impulses.length);
    const cap = 48 * Math.max(1, Math.floor(this.simAcc * 60));
    if (imps.length > cap) imps = imps.filter((_, i) => i % Math.ceil(imps.length / cap) === 0);
    let from = 0;
    while (this.simAcc >= 1 / 60) {
      this.simAcc -= 1 / 60;
      const prev = this.simCam ?? [cam.x, cam.y];
      const shift: [number, number] = [(cam.x - prev[0]) / rw, (cam.y - prev[1]) / rh];
      this.simCam = [cam.x, cam.y];
      bindTarget(gl, this.simB, 0, 0);
      const sp = this.p.sim;
      gl.useProgram(sp.prog);
      bindTex(gl, 0, this.simA.tex);
      gl.uniform1i(sp.u.uPrev, 0);
      bindTex(gl, 1, this.occ!.tex);
      gl.uniform1i(sp.u.uOcc, 1);
      gl.uniform2f(sp.u.uTexel, 1 / this.simW, 1 / this.simH);
      gl.uniform2f(sp.u.uShift, shift[0], shift[1]);
      gl.uniform4f(sp.u.uRect, cam.x - rw / 2, cam.y - rh / 2, rw, rh);
      gl.uniform1f(sp.u.uSimScale, 1.15);
      gl.uniform4f(sp.u.uView, cam.x, cam.y, (2 * cam.zoom) / cam.cssW, (2 * cam.zoom) / cam.cssH);
      const list = imps.slice(from, from + 48);
      from += 48;
      const data = new Float32Array(48 * 4);
      // a negative radius tells the sim this one churns foam too
      list.forEach((im, i) => data.set([im.x, im.y, im.foam ? -im.r : im.r, im.s], i * 4));
      gl.uniform4fv(sp.u.uImp, data);
      gl.uniform1i(sp.u.uImpN, list.length);
      this.fullscreen();
      [this.simA, this.simB] = [this.simB, this.simA];
    }
  }

  /**
   * Many polylines as ONE strip (joined by degenerate triangles), one draw —
   * a stem per leaf in view would otherwise be a draw call each.
   */
  private strips(f: FrameInput, lines: Array<{ pts: Array<[number, number]>; w: number[]; a: number[]; d: number[] }>, color: [number, number, number], mode: number) {
    const gl = this.gl;
    const d = this.ribbonData;
    const cap = d.length / 6;
    let v = 0;
    const put = (x: number, y: number, side: number, along: number, a: number, depth: number) => {
      if (v >= cap) return;
      d.set([x, y, side, along, a, depth], v * 6);
      v++;
    };
    for (const L of lines) {
      const n = L.pts.length;
      if (n < 2 || v + n * 2 + 2 > cap) continue;
      for (let i = 0; i < n; i++) {
        const a = L.pts[Math.max(0, i - 1)];
        const c = L.pts[Math.min(n - 1, i + 1)];
        let tx = c[0] - a[0];
        let ty = c[1] - a[1];
        const l = Math.hypot(tx, ty) || 1;
        tx /= l;
        ty /= l;
        const nx = -ty * L.w[i];
        const ny = tx * L.w[i];
        const p = L.pts[i];
        if (i === 0 && v > 0) put(p[0] + nx, p[1] + ny, 1, 0, 0, L.d[i]); // degenerate join
        put(p[0] + nx, p[1] + ny, 1, i / (n - 1), L.a[i], L.d[i]);
        put(p[0] - nx, p[1] - ny, -1, i / (n - 1), L.a[i], L.d[i]);
        if (i === n - 1) put(p[0] - nx, p[1] - ny, -1, 1, 0, L.d[i]); // degenerate join
      }
    }
    if (v < 4) return;
    const pr = this.p.ribbon;
    this.common(pr, f);
    gl.uniform3fv(pr.u.uColor, color);
    gl.uniform1f(pr.u.uGlow, mode);
    if (pr.u.uOcc) {
      bindTex(gl, 1, this.occ!.tex);
      gl.uniform1i(pr.u.uOcc, 1);
    }
    gl.bindVertexArray(this.ribbonVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, v * 6);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, v);
  }

  /** The plants under the water: rhizomes on the bed, and a stem from each to every leaf, bud and flower. */
  private plantParts(f: FrameInput, inView: (x: number, y: number, r: number) => boolean) {
    const pond = f.pond;
    const stems: Array<{ pts: Array<[number, number]>; w: number[]; a: number[]; d: number[] }> = [];
    const stem = (x: number, y: number, rx: number, ry: number, topDepth: number, w0: number) => {
      const bed = pond.bedDepth(rx, ry) * 0.97;
      const [fx, fy] = pond.flow((x + rx) / 2, (y + ry) / 2);
      // stems bow downstream in the current, and lean when their leaf is pushed away
      const cx = (x + rx) / 2 + fx * 2.2;
      const cy = (y + ry) / 2 + fy * 2.2;
      const pts: Array<[number, number]> = [];
      const w: number[] = [];
      const a: number[] = [];
      const d: number[] = [];
      for (let i = 0; i <= 8; i++) {
        const u = i / 8;
        const k = 1 - u;
        pts.push([k * k * x + 2 * k * u * cx + u * u * rx, k * k * y + 2 * k * u * cy + u * u * ry]);
        w.push(w0 * (0.8 + 0.4 * u));
        a.push(1);
        d.push(topDepth + (bed - topDepth) * u);
      }
      stems.push({ pts, w, a, d });
    };
    for (const p of pond.pads) if (inView(p.x, p.y, p.r + 140)) stem(p.x, p.y, p.rx, p.ry, 0.04, 2.1);
    for (const b of pond.blooms) if (inView(b.x, b.y, 160)) stem(b.x, b.y, b.rx, b.ry, 0.02, 1.7);
    for (const dl of pond.deep) if (dl.rx !== undefined && dl.ry !== undefined && inView(dl.x, dl.y, 150)) stem(dl.x, dl.y, dl.rx, dl.ry, dl.depth, 1.6);
    const rhiz: Array<{ pts: Array<[number, number]>; w: number[]; a: number[]; d: number[] }> = [];
    for (const pl of pond.plants) {
      if (!inView(pl.x, pl.y, 80)) continue;
      const bed = pond.bedDepth(pl.x, pl.y) * 0.99;
      for (const [ang, len] of pl.arms) {
        const pts: Array<[number, number]> = [];
        const w: number[] = [];
        const a: number[] = [];
        const d: number[] = [];
        for (let i = 0; i <= 4; i++) {
          const u = i / 4;
          const wob = Math.sin(u * 5 + pl.seed * 20) * 3;
          pts.push([pl.x + Math.cos(ang) * len * u - Math.sin(ang) * wob, pl.y + Math.sin(ang) * len * u + Math.cos(ang) * wob]);
          w.push(4.5 - u * 1.5 + Math.sin(u * 9 + pl.seed * 7) * 0.8);
          a.push(1);
          d.push(bed);
        }
        rhiz.push({ pts, w, a, d });
      }
    }
    this.strips(f, rhiz, [0.52, 0.38, 0.22], 3);
    this.strips(f, stems, [0.50, 0.50, 0.24], 3);
  }

  /**
   * Bake names into a small texture (a row each, cream serif with a dark
   * shadow) so they can be drawn on the leaves in the same pass as the leaves.
   */
  setNames(names: string[]) {
    const gl = this.gl;
    this.atlasRows = [];
    if (!names.length) {
      this.atlas = null;
      return;
    }
    const PX = 48; // font size in the atlas (drawn down to ~13–20 css px)
    const rowH = Math.round(PX * 1.5);
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    ctx.font = `${PX}px Georgia, 'Iowan Old Style', serif`;
    const widths = names.map((n) => Math.ceil(ctx.measureText(n).width) + PX);
    const W = Math.min(1024, Math.max(64, ...widths));
    const H = rowH * names.length;
    c.width = W;
    c.height = H;
    ctx.font = `${PX}px Georgia, 'Iowan Old Style', serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    names.forEach((n, i) => {
      const y = i * rowH + rowH / 2;
      ctx.shadowColor = 'rgba(0, 27, 25, .95)';
      ctx.shadowBlur = PX * 0.35;
      ctx.fillStyle = '#f6f3d8';
      ctx.fillText(n, W / 2, y, W - 8);
      ctx.shadowBlur = 0;
      const w = Math.min(W, widths[i]);
      this.atlasRows.push({ u0: (W / 2 - w / 2) / W, v0: (i * rowH) / H, u1: (W / 2 + w / 2) / W, v1: ((i + 1) * rowH) / H, aspect: w / rowH });
    });
    const tex = this.atlas ?? gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.atlas = tex;
  }

  private ribbon(f: FrameInput, pts: Array<[number, number]>, width: number | number[], color: [number, number, number], alpha: number | number[], glow: boolean | 2) {
    const gl = this.gl;
    const n = Math.min(pts.length, 400);
    if (n < 2) return;
    const d = this.ribbonData;
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const c = pts[Math.min(n - 1, i + 1)];
      let tx = c[0] - a[0];
      let ty = c[1] - a[1];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l;
      ty /= l;
      const wi = typeof width === 'number' ? width : width[i];
      const ai = typeof alpha === 'number' ? alpha : alpha[i];
      const nx = -ty * wi;
      const ny = tx * wi;
      const along = i / (n - 1);
      const fade = glow || typeof alpha !== 'number' ? 1 : Math.min(1, (1 - along) * 3);
      d.set([pts[i][0] + nx, pts[i][1] + ny, 1, along, ai * fade, 0, pts[i][0] - nx, pts[i][1] - ny, -1, along, ai * fade, 0], i * 12);
    }
    const pr = this.p.ribbon;
    this.common(pr, f);
    gl.uniform3fv(pr.u.uColor, color);
    gl.uniform1f(pr.u.uGlow, glow === 2 ? 2 : glow ? 1 : 0);
    gl.bindVertexArray(this.ribbonVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 12);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, n * 2);
  }

  private motes(f: FrameInput, list: Mote[], res = 1) {
    const gl = this.gl;
    const n = Math.min(list.length, 600);
    if (!n) return;
    const d = this.moteData;
    for (let i = 0; i < n; i++) {
      const m = list[i];
      d.set([m.x, m.y, m.size * this.scale * res, m.r, m.g, m.b, m.a, m.core, m.z, 0], i * 10);
    }
    const pr = this.p.mote;
    this.common(pr, f);
    gl.uniform1f(pr.u.uDpr, this.dpr);
    gl.bindVertexArray(this.moteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.moteBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 10);
    gl.drawArrays(gl.POINTS, 0, n);
  }
}

/** Pads ordered for drawing: dry leaves first, dewy leaves on top so no counted drop is ever hidden. */
export function drawOrder(pads: Pad[]): Pad[] {
  return pads.slice().sort((a, b) => Number(a.drops.length > 0) - Number(b.drops.length > 0) || a.layer - b.layer);
}


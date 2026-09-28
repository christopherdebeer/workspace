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
import type { Pad, Pond } from './world';

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
}

export interface FrameInput {
  cam: Camera;
  light: Light;
  time: number;
  pond: Pond;
  pads: Pad[];
  fish: Fish[];
  motes: Mote[];
  thread: Array<[number, number]>;
  lantern: number;
}

const MAX_PADS = 900;
const MAX_DROP_ROWS = 512;
const DROP_COLS = 10;
const SIM_W = 168;

export class Renderer {
  gl: GL;
  scale = 1;
  dpr = 1;
  simOn = false;
  private quad: WebGLBuffer;
  private fsVao: WebGLVertexArrayObject;
  private noise: WebGLTexture;
  private p: Record<string, Program>;
  private padInst: Instanced;
  private deepInst: Instanced;
  private fishInst: Instanced;
  private flowerInst: Instanced;
  private dropTex: WebGLTexture;
  private dropData = new Float32Array(DROP_COLS * MAX_DROP_ROWS * 4);
  private ribbonVao: WebGLVertexArrayObject;
  private ribbonBuf: WebGLBuffer;
  private ribbonData = new Float32Array(6 * 2 * 400);
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

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.simOn = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    this.quad = quadBuffer(gl);
    this.fsVao = quadVao(gl, this.quad);
    this.noise = noiseTexture(gl);
    const fs = S.FULLSCREEN_VS;
    this.p = {
      sim: program(gl, 'sim', fs, S.SIM_FS),
      bed: program(gl, 'bed', fs, S.BED_FS),
      surface: program(gl, 'surface', fs, S.SURFACE_FS),
      grade: program(gl, 'grade', fs, S.GRADE_FS),
      fish: program(gl, 'fish', S.FISH_VS, S.FISH_FS),
      pad: program(gl, 'pad', S.PAD_VS, S.PAD_FS),
      flower: program(gl, 'flower', S.FLOWER_VS, S.FLOWER_FS),
      boat: program(gl, 'boat', S.BOAT_VS, S.BOAT_FS),
      ribbon: program(gl, 'ribbon', S.RIBBON_VS, S.RIBBON_FS),
      mote: program(gl, 'mote', S.MOTE_VS, S.MOTE_FS),
    };
    this.padInst = new Instanced(gl, this.quad, MAX_PADS, 3);
    this.deepInst = new Instanced(gl, this.quad, 400, 3);
    this.fishInst = new Instanced(gl, this.quad, 120, 2);
    this.flowerInst = new Instanced(gl, this.quad, 120, 2);

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
    this.under = renderTarget(gl, w, h);
    this.occ = renderTarget(gl, Math.max(1, w >> 2), Math.max(1, h >> 2));
    const simH = Math.min(420, Math.round((SIM_W * cssH) / cssW));
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

    // ── instance data ──
    const pads = f.pads;
    let rows = 0;
    let n = 0;
    const flowers: Pad[] = [];
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
      this.padInst.set(n++, p.x, p.y, p.r, p.ang, p.seed, p.sel, p.bob, Math.max(0, row), row < 0 ? 0 : Math.min(drops, DROP_COLS), p.focus ? 1 : 0, 0, (p.seed * 13.1) % 1);
      if (p.flower) flowers.push(p);
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
      if (!inView(fish.x, fish.y, 60) || fn >= 120) continue;
      const speed = Math.hypot(fish.vx, fish.vy);
      this.fishInst.set(fn++, fish.x, fish.y, Math.atan2(fish.vx, fish.vy), fish.size, fish.z, fish.kind, fish.phase, speed);
    }
    this.fishInst.count = fn;
    this.fishInst.upload();

    let fl = 0;
    for (const p of flowers) {
      if (fl >= 120) break;
      const c = Math.cos(p.ang);
      const s = Math.sin(p.ang);
      // the flower stands a little off-centre, on the side away from the notch
      const ox = s * 0.18 * p.r;
      const oy = -c * 0.18 * p.r;
      this.flowerInst.set(fl++, p.x + ox, p.y + oy, p.r * 0.46, p.ang + p.seed * 3, p.flower, 1, p.seed, 0);
    }
    this.flowerInst.count = fl;
    this.flowerInst.upload();

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
    const chan = new Float32Array(66);
    const y0 = cam.y - hh * 1.2;
    const y1 = cam.y + hh * 1.2;
    for (let i = 0; i <= 32; i++) {
      const y = y0 + ((y1 - y0) * i) / 32;
      chan[i * 2] = pond.channel(y);
      chan[i * 2 + 1] = pond.channelHalf(y);
    }
    gl.uniform2fv(bed.u.uChan, chan);
    gl.uniform2f(bed.u.uSpanY, y0, y1);
    bindTex(gl, 1, this.occ!.tex);
    gl.uniform1i(bed.u.uOcc, 1);
    this.fullscreen();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
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
    this.fullscreen();

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // rope, trailing on the water
    const rope: Array<[number, number]> = [];
    for (let i = 0; i < pond.rope.length; i += 2) rope.push([pond.rope[i], pond.rope[i + 1]]);
    const sun = f.light.sun;
    const shadowOff: [number, number] = [(-sun[0] / sun[2]) * 3, (-sun[1] / sun[2]) * 3];
    this.ribbon(f, rope.map(([x, y]) => [x + shadowOff[0], y + shadowOff[1]] as [number, number]), 1.8, [0, 0, 0], 0.3, false);
    this.ribbon(f, rope, 1.25, [0.6, 0.19, 0.13], 1, false);

    // pads
    const pad = this.p.pad;
    this.common(pad, f);
    gl.uniform1f(pad.u.uMode, 0);
    bindTex(gl, 1, this.dropTex);
    gl.uniform1i(pad.u.uDrops, 1);
    this.padInst.draw();

    // flowers
    this.common(this.p.flower, f);
    this.flowerInst.draw();

    // boat
    const b = pond.boat;
    const boat = this.p.boat;
    this.common(boat, f);
    gl.uniform4f(boat.u.uBoat, b.x, b.y, b.heading + b.sway, 1);
    gl.uniform4f(boat.u.uOar, pond.oarAngle(), b.rowing, b.stroke, f.lantern);
    gl.bindVertexArray(this.fsVao);
    gl.uniform1f(boat.u.uShadow, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.uniform1f(boat.u.uShadow, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // the golden thread through the chosen leaves
    if (f.thread.length > 1) {
      this.ribbon(f, f.thread, 5, [0.55, 0.42, 0.16], 0.55, true);
      this.ribbon(f, f.thread, 1.3, [1, 0.9, 0.62], 0.9, true);
    }

    // motes
    this.motes(f);

    // grade
    const gr = this.p.grade;
    this.common(gr, f);
    this.fullscreen();
    gl.disable(gl.BLEND);
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
    const imps = pond.impulses.splice(0, pond.impulses.length).slice(-24);
    let first = true;
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
      const list = first ? imps : [];
      first = false;
      const data = new Float32Array(24 * 4);
      list.forEach((im, i) => data.set([im.x, im.y, im.r, im.s], i * 4));
      gl.uniform4fv(sp.u.uImp, data);
      gl.uniform1i(sp.u.uImpN, list.length);
      this.fullscreen();
      [this.simA, this.simB] = [this.simB, this.simA];
    }
  }

  private ribbon(f: FrameInput, pts: Array<[number, number]>, width: number, color: [number, number, number], alpha: number, glow: boolean) {
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
      const nx = -ty * width;
      const ny = tx * width;
      const along = i / (n - 1);
      const fade = glow ? 1 : Math.min(1, (1 - along) * 3);
      d.set([pts[i][0] + nx, pts[i][1] + ny, 1, along, alpha * fade, 0, pts[i][0] - nx, pts[i][1] - ny, -1, along, alpha * fade, 0], i * 12);
    }
    const pr = this.p.ribbon;
    this.common(pr, f);
    gl.uniform3fv(pr.u.uColor, color);
    gl.uniform1f(pr.u.uGlow, glow ? 1 : 0);
    gl.bindVertexArray(this.ribbonVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, n * 12);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, n * 2);
  }

  private motes(f: FrameInput) {
    const gl = this.gl;
    const list = f.motes;
    const n = Math.min(list.length, 600);
    if (!n) return;
    const d = this.moteData;
    for (let i = 0; i < n; i++) {
      const m = list[i];
      d.set([m.x, m.y, m.size * this.scale, m.r, m.g, m.b, m.a, m.core, 0, 0], i * 10);
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


/**
 * The picture: a daylight fencing club, in WebGL 2. The room (look/salle.ts) is built once; the fencers, dressed, and
 * their weapons (look/figure.ts) each frame. The sun comes in through the window bank and casts the fencers' shadows
 * (one shadow pass, from the sun, fitted to where they are); everything else is the room's own light (look/shaders.ts):
 * the day from the windows, the lamps, the room reflected in the steel.
 *
 * Draw calls a frame: in the sun's view the weapons and each athlete; then the room, the weapons, each athlete. The
 * athletes are one mesh on the GPU, skinned per fencer from its joints; only the weapons are built on the CPU.
 */
import type { Bout } from './bout';
import { Mesh, MAT, STRIDE } from './look/mesh';
import { buildSalle } from './look/salle';
import { weapon, capsules } from './look/figure';
import { buildAthlete, boneFrames, skinMatrices, Secondary, bendOf, SKIN_STRIDE, BONES, PART, type Athlete } from './look/athlete';
import type { Fencer } from './fencer';
import { MAIN_VS, MAIN_FS, SHADOW_VS, SHADOW_FS, SKIN_VS, SKIN_SHADOW_VS } from './look/shaders';
import { GpuCloth, withCloth } from './look/cloth';
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
  /** the figures as plain grey models (to judge their shape alone) */
  clay?: boolean;
  /** the body's contact capsules over the dressed figures */
  bodies?: boolean;
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
  private kitTexture: WebGLTexture;
  exposure = 1.05;
  /** the athlete: built once, resident on the GPU, skinned per fencer */
  private athlete: Athlete;
  private skin: WebGLProgram; private skinShade: WebGLProgram;
  private skinVao: WebGLVertexArrayObject;
  private fullIndex: WebGLBuffer;
  private eyeIndex: WebGLBuffer;
  private eyeCount: number;
  private uk: Record<string, WebGLUniformLocation | null> = {};
  private uks: Record<string, WebGLUniformLocation | null> = {};
  /** each fencer's secondary motion (a replay's copy of a fencer gets its own) */
  private secondary = new WeakMap<Fencer, Secondary>();
  private bones = [new Float32Array(BONES * 16), new Float32Array(BONES * 16)];
  /** time spent last frame, ms: posing (joints and springs), and the weapons built on the CPU */
  poseMs = 0; weaponMs = 0;
  /** the kit simulated as cloth on the GPU (`?cloth=sim`; look/cloth.ts), or null */
  cloth: GpuCloth | null = null;
  private clothShaders = false;
  /** a drafted jacket (`?jacket=draft`: devtools/piste-jacket.mjs), settled in guard, drawn on each fencer in place of the
   * athlete's own jacket and sleeves: to see the pattern dressed. Its points in a fencer's frame (forward, up, right) */
  private draft: { x: Float32Array; tris: Uint32Array; uv: Float32Array; seam: Float32Array; n: number } | null = null;
  private noJacket: WebGLBuffer | null = null; private noJacketCount = 0;

  constructor(readonly canvas: HTMLCanvasElement, opts: { cloth?: boolean; clothStress?: number } = {}) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL 2 is needed');
    this.gl = gl;
    this.main = program(gl, MAIN_VS, MAIN_FS);
    this.shade = program(gl, SHADOW_VS, SHADOW_FS);
    for (const k of ['vp', 'lvp', 'eye', 'sunDir', 'shadow', 'exposure', 'feet', 'tips', 'bladeA', 'bladeB', 'clay', 'alpha']) this.u[k] = gl.getUniformLocation(this.main, k);
    // (with the cloth spliced into the skinning, if asked for and it splices; otherwise as before)
    let skinVS = SKIN_VS, shadowVS = SKIN_SHADOW_VS;
    if (opts.cloth) try { skinVS = withCloth(SKIN_VS, false); shadowVS = withCloth(SKIN_SHADOW_VS, true); this.clothShaders = true; } catch (e) { GpuCloth.failure = String((e as Error)?.message ?? e); console.warn(e); }
    this.skin = program(gl, skinVS, MAIN_FS);
    this.kitTexture = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.kitTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([176,128,128]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    const atlas = new Image();
    atlas.onload = () => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.kitTexture);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, atlas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.activeTexture(gl.TEXTURE0);
    };
    const assetRoot = document.documentElement.dataset.assets;
    if (assetRoot) atlas.src = assetRoot + 'kit-relief.webp';
    for (const pass of [this.main, this.skin]) {
      gl.useProgram(pass);
      gl.uniform1i(gl.getUniformLocation(pass, 'kitAtlas'), 1);
    }
    gl.activeTexture(gl.TEXTURE0);
    this.skinShade = program(gl, shadowVS, SHADOW_FS);
    for (const k of ['vp', 'lvp', 'eye', 'sunDir', 'shadow', 'exposure', 'feet', 'tips', 'bladeA', 'bladeB', 'clay', 'alpha', 'bones', 'hem', 'sleeveW', 'sleeveR', 'bend', 'foldLoad']) this.uk[k] = gl.getUniformLocation(this.skin, k);
    for (const k of ['lvp', 'bones', 'hem', 'sleeveW', 'sleeveR', 'bend', 'foldLoad']) this.uks[k] = gl.getUniformLocation(this.skinShade, k);
    this.athlete = buildAthlete();
    if (this.clothShaders) {
      this.cloth = GpuCloth.create(gl, this.athlete);
      if (this.cloth) this.cloth.stress = Math.max(1, Math.min(16, Math.round(opts.clothStress ?? 1)));
      for (const [pass, U] of [[this.skin, this.uk], [this.skinShade, this.uks]] as const) {
        gl.useProgram(pass);
        for (const k of ['clothX', 'clothOn', 'clothW', 'clothPiece']) U[k] = gl.getUniformLocation(pass, k);
        gl.uniform1i(U.clothX, 2); gl.uniform1i(U.clothOn, 0);
        if (this.cloth) { gl.uniform1i(U.clothW, this.cloth.W); gl.uniform4iv(U.clothPiece, this.cloth.pieces); }
      }
    }
    this.skinVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.skinVao);
    const vb = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, this.athlete.verts, gl.STATIC_DRAW);
    // Exclude whole triangles when looking through the athlete's eyes. Moving one vertex
    // out of frame stretches the remaining sleeve triangles across the foreground.
    const { verts, index } = this.athlete;
    const eyeIndices: number[] = [];
    const visible = (vertex: number) => {
      const part = verts[vertex * SKIN_STRIDE + 23];
      return part === PART.always || part === PART.upperSleeve;
    };
    for (let i = 0; i < index.length; i += 3) {
      if (visible(index[i]) && visible(index[i + 1]) && visible(index[i + 2])) {
        eyeIndices.push(index[i], index[i + 1], index[i + 2]);
      }
    }
    this.eyeCount = eyeIndices.length;
    this.eyeIndex = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.eyeIndex);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(eyeIndices), gl.STATIC_DRAW);
    const ib = this.fullIndex = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.athlete.index, gl.STATIC_DRAW);
    const st = SKIN_STRIDE * 4;
    [[0, 3, 0], [1, 3, 12], [2, 4, 24], [3, 2, 40], [4, 4, 48], [5, 4, 64], [6, 4, 80], [7, 2, 96], [8, 4, 104], [9, 3, 120]].forEach(([l, n, o]) => { gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, n, gl.FLOAT, false, st, o); });
    gl.bindVertexArray(null);
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

  /** step the fencers' secondary motion to the bout's time without drawing (for a page run on to a moment: the hem
   * arrives with its swing) */
  simulate(bout: Bout) {
    bout.fencers.forEach((f, i) => this.pose(f, bout.t, i));
  }

  resize(dpr: number) {
    const c = this.canvas, w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  draw(bout: Bout, view: View) {
    const gl = this.gl, m = this.mesh;
    m.reset();
    const t0 = performance.now();
    const poses = bout.fencers.map((f, i) => this.pose(f, bout.t, i));
    const t1 = performance.now();
    bout.fencers.forEach((f, i) => weapon(m, f, i * 101 + 7));
    // (not on the body we're looking out of: from inside it, it's a sheet across the view)
    if (this.draft) bout.fencers.forEach((f, i) => { if (i !== view.self) this.dressDraft(f); });
    this.poseMs = t1 - t0; this.weaponMs = performance.now() - t1;
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
    // (both bodies whole in the sun's view: the player's shadow too)
    gl.useProgram(this.skinShade);
    gl.uniformMatrix4fv(this.uks.lvp, false, lvp);
    gl.bindVertexArray(this.skinVao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.fullIndex);
    if (this.noJacket) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.noJacket);
    poses.forEach((ps, i) => { gl.uniformMatrix4fv(this.uks.bones, false, this.bones[i]); this.clothUniforms(this.uks,ps); this.bindCloth(this.uks, bout.fencers[i]); gl.drawElements(gl.TRIANGLES, this.noJacket ? this.noJacketCount : this.athlete.count, gl.UNSIGNED_INT, 0); });
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
    gl.uniform1f(this.u.clay, 0); gl.uniform1f(this.u.alpha, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex); gl.uniform1i(this.u.shadow, 0);
    // contact shadows: under each shoe, and under each tip (w: how strongly)
    const feet: number[] = [];
    for (const f of bout.fencers) for (const k of [13, 14]) { const c = f.capsules[k]; feet.push((c.a[0] + c.b[0]) / 2, 0, (c.a[2] + c.b[2]) / 2, 0.11 + Math.max(0, c.a[1] - 0.05) * 0.8); }
    gl.uniform4fv(this.u.feet, feet);
    const tips: number[] = [];
    for (const f of bout.fencers) { const t = f.blade.tip; tips.push(t[0], t[1], t[2], 1); }
    gl.uniform4fv(this.u.tips, tips);
    gl.uniform3fv(this.u.bladeA, [...bout.fencers[0].blade.guard, ...bout.fencers[1].blade.guard]);
    gl.uniform3fv(this.u.bladeB, [...bout.fencers[0].blade.tip, ...bout.fencers[1].blade.tip]);
    gl.bindVertexArray(this.roomVao);
    gl.drawArrays(gl.TRIANGLES, 0, this.roomN);
    gl.bindVertexArray(this.dynVao);
    gl.drawArrays(gl.TRIANGLES, 0, m.n);
    // the athletes
    const vpM = mul(perspective(view.fov, aspect, 0.03, 60), lookAt(view.eye, view.at, [0, 1, 0]));
    gl.useProgram(this.skin);
    const U = this.uk;
    gl.uniformMatrix4fv(U.vp, false, vpM); gl.uniformMatrix4fv(U.lvp, false, lvp);
    gl.uniform3fv(U.eye, view.eye); gl.uniform3fv(U.sunDir, SUN); gl.uniform1f(U.exposure, this.exposure);
    gl.uniform1f(U.clay, view.clay ? 1 : 0); gl.uniform1f(U.alpha, 1);
    gl.uniform1i(U.shadow, 0); gl.uniform4fv(U.feet, feet); gl.uniform4fv(U.tips, tips);
    gl.uniform3fv(U.bladeA, [...bout.fencers[0].blade.guard, ...bout.fencers[1].blade.guard]);
    gl.uniform3fv(U.bladeB, [...bout.fencers[0].blade.tip, ...bout.fencers[1].blade.tip]);
    gl.bindVertexArray(this.skinVao);
    poses.forEach((ps, i) => {
      gl.uniformMatrix4fv(U.bones, false, this.bones[i]);
      this.clothUniforms(U,ps); this.bindCloth(U, bout.fencers[i]);
      // The first-person sleeve continues through the elbow to the edge of the frame.
      const firstPerson = i === view.self;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, firstPerson ? this.eyeIndex : this.noJacket ?? this.fullIndex);
      gl.drawElements(gl.TRIANGLES, firstPerson ? this.eyeCount : this.noJacket ? this.noJacketCount : this.athlete.count, gl.UNSIGNED_INT, 0);
    });
    // the contact capsules over them (debug)
    if (view.bodies) {
      const o = new Mesh(8000);
      bout.fencers.forEach((f) => capsules(o, f));
      gl.useProgram(this.main);
      gl.uniform1f(this.u.alpha, 0.38);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf);
      gl.bufferData(gl.ARRAY_BUFFER, o.data.subarray(0, o.n * STRIDE), gl.DYNAMIC_DRAW);
      gl.bindVertexArray(this.dynVao);
      gl.drawArrays(gl.TRIANGLES, 0, o.n);
      gl.disable(gl.BLEND); gl.depthMask(true);
    }
    gl.bindVertexArray(null);
  }

  /** a fencer's joints this frame (into this.bones[i]), and its secondary motion */
  pose(f: Fencer, t: number, i: number) {
    skinMatrices(boneFrames(f), this.athlete.bind, this.bones[i]);
    if (this.cloth) {
      // (the arms, upper and fore each side, for the jacket to lie against)
      const arms = new Float32Array(32);
      [4, 5, 7, 8].forEach((k, q) => { const c = f.capsules[k]; arms.set([...c.a, c.ra], q * 4); arms.set([...c.b, 0], 16 + q * 4); });
      this.cloth.step(f, t, this.bones[i], f.s, arms);
    }
    let sec = this.secondary.get(f);
    if (!sec) { sec = new Secondary(); this.secondary.set(f, sec); }
    sec.update(f, t);
    const c = f.capsules;
    const bend = [bendOf(f.shoulder,f.elbow,f.hand), bendOf(c[7].a,c[7].b,c[8].b)];
    const knees = [bendOf(c[9].a,c[9].b,c[10].b), bendOf(c[11].a,c[11].b,c[12].b)];
    return { hem: sec.hem, sleeve: sec.sleeve, bend, load: [...bend,...knees,1-bend[0]] };
  }

  /** dress the fencers in a drafted jacket: its settled points (fencer frame), triangles, weave coordinates and seam distances */
  setDraft(d: { x: number[]; tris: number[]; uv: number[]; seam: number[] }) {
    this.draft = { x: Float32Array.from(d.x), tris: Uint32Array.from(d.tris), uv: Float32Array.from(d.uv), seam: Float32Array.from(d.seam), n: d.x.length / 3 };
    // (the athlete without its own jacket and sleeves)
    const gl = this.gl, A = this.athlete, gone = new Uint8Array(A.verts.length / SKIN_STRIDE);
    for (const p of A.pieces) if (p.kind !== 'breeches') gone.fill(1, p.base, p.base + p.R * p.J);
    const keep: number[] = [];
    for (let i = 0; i < A.index.length; i += 3) if (!gone[A.index[i]] && !gone[A.index[i + 1]] && !gone[A.index[i + 2]]) keep.push(A.index[i], A.index[i + 1], A.index[i + 2]);
    this.noJacket = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.noJacket); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(keep), gl.STATIC_DRAW);
    this.noJacketCount = keep.length;
  }
  /** the drafted jacket on a fencer, into the frame's mesh */
  private dressDraft(f: Fencer) {
    const D = this.draft!, F = f.frame, m = this.mesh, P: V[] = [];
    for (let i = 0; i < D.n; i++) { const a = D.x[i * 3], b = D.x[i * 3 + 1], c = D.x[i * 3 + 2]; P.push([F.o[0] + F.f[0] * a + F.u[0] * b + F.r[0] * c, F.o[1] + F.f[1] * a + F.u[1] * b + F.r[1] * c, F.o[2] + F.f[2] * a + F.u[2] * b + F.r[2] * c]); }
    const N = P.map(() => [0, 0, 0] as V);
    for (let t = 0; t < D.tris.length; t += 3) { const [a, b, c] = [D.tris[t], D.tris[t + 1], D.tris[t + 2]], n = cross(sub(P[b], P[a]), sub(P[c], P[a])); for (const k of [a, b, c]) for (let j = 0; j < 3; j++) N[k][j] += n[j]; }
    for (let t = 0; t < D.tris.length; t++) { const k = D.tris[t]; m.vert(P[k], norm(N[k]), [0.95, D.seam[k], 0], MAT.fabric, D.uv[k * 2], D.uv[k * 2 + 1]); }
  }

  /** draw `f`'s kit from its simulated cloth, if there is one */
  private bindCloth(u: Record<string, WebGLUniformLocation | null>, f: Fencer) {
    if (!this.clothShaders) return;
    const gl = this.gl, x = this.cloth?.points(f) ?? null;
    gl.uniform1i(u.clothOn, x ? 1 : 0);
    if (x) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, x); gl.activeTexture(gl.TEXTURE0); }
  }

  private clothUniforms(u: Record<string,WebGLUniformLocation|null>, p: ReturnType<Renderer['pose']>) {
    const gl = this.gl;
    gl.uniform3fv(u.hem,p.hem);
    gl.uniform3fv(u.sleeveW,p.sleeve[0]); gl.uniform3fv(u.sleeveR,p.sleeve[1]);
    gl.uniform2fv(u.bend,p.bend); gl.uniform1fv(u.foldLoad,p.load);
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
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, STRIDE * 4, 40);
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


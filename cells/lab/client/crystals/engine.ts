/**
 * The Crystals renderer, on its own: a specimen grown from a seed, ray-traced into whatever it is
 * given — the Crystals page's canvas, or (`cut`) a cut-out of the specimen alone on transparency,
 * for drawing it into another scene (the Field Journal's wood).
 *
 * Two passes a frame: the caustic pass sends a sheet of the key light through the crystals
 * (one draw per wavelength, red, green, blue, each at its own index) and splats where each ray
 * lands on the ground into a map; the main pass traces every pixel through the same hulls,
 * reading the map wherever it sees the ground. See shaders.ts for the light, mineral.ts for the
 * specimens.
 */
import { bound, growth, planesOf, specimen, type Specimen } from './mineral';
import { BLOOM_FS, BLUR_FS, CAUSTIC_FS, CAUSTIC_VS, FINAL_FS, MAIN_FS, MAXC, QUAD_VS } from './shaders';

export type Quality = 'low' | 'mid' | 'high';
export interface EngineOpts {
  quality: Quality;
  /** grown at once and held still: no growth, no jitter, no wandering light */
  still?: boolean;
  /** only the specimen, on transparency (no ground, no sky, no bloom) */
  cut?: boolean;
  /** a debug view (the Crystals page's ?debug=) */
  debug?: string | null;
}
/** where the camera stands: around (az), above (el), how far (dist × the specimen's reach) */
export interface Orbit { az: number; el: number; dist: number }

const norm = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const LIGHT_COL = [1.0, 0.94, 0.86];

export function createCrystalEngine(gl: WebGL2RenderingContext, o: EngineOpts) {
  const { quality } = o;
  // (made inside another renderer's frame — the Field Journal's wood — it leaves the framebuffer
  // and viewport as it found them)
  const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const prevVp = gl.getParameter(gl.VIEWPORT) as Int32Array;
  const still = !!o.still;
  const halfFloat = !!gl.getExtension('EXT_color_buffer_float');
  function program(vs: string, fs: string): WebGLProgram {
    const mk = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader'); return s; };
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  }
  const mainP = program(QUAD_VS, MAIN_FS);
  const causP = program(CAUSTIC_VS, CAUSTIC_FS);
  const bloomP = program(QUAD_VS, BLOOM_FS), blurP = program(QUAD_VS, BLUR_FS), finalP = program(QUAD_VS, FINAL_FS);
  /** a colour target of the given size (half-float when the extension allows) */
  function target(w: number, h: number): { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number } {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, halfFloat ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, halfFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }
  let scene: ReturnType<typeof target> | null = null, bloomA: ReturnType<typeof target> | null = null, bloomB: ReturnType<typeof target> | null = null;
  let sized = [0, 0];
  const U = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);

  // the hulls: planes as a 64×4 float texture
  const planesTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, planesTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const planeData = new Float32Array(64 * 4 * 4);
  // the caustic map
  const CRES = quality === 'low' ? 256 : 512;
  const causTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, causTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, halfFloat ? gl.RGBA16F : gl.RGBA8, CRES, CRES, 0, gl.RGBA, halfFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, causTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const vao = gl.createVertexArray()!;

  // ─── the specimen ─────────────────────────────────────────────────────────────────────────────
  let seed = 1;
  let spec!: Specimen;
  let born = 0;
  const C0 = new Float32Array(MAXC * 4), C1 = new Float32Array(MAXC * 4), C2 = new Float32Array(MAXC * 4);
  const C3 = new Float32Array(MAXC * 4), C4 = new Float32Array(MAXC * 4), C5 = new Float32Array(MAXC * 4), C6 = new Float32Array(MAXC * 4), C7 = new Float32Array(MAXC * 4), C8 = new Float32Array(MAXC * 4), C9 = new Float32Array(MAXC * 4);
  const CENTRE: [number, number, number] = [0, 1.0, 0];
  /** the camera's reach: how tall and wide the specimen will be when grown */
  let reach = 1;
  function grow(newSeed: number, mineral?: string) {
    seed = newSeed;
    spec = specimen(seed, mineral);
    born = performance.now() / 1000 - (still ? 20 : 0);
    // (frame the grown specimen: its height sets the eye's target and distance)
    const tops = spec.crystals.map((c) => bound(c, spec.species, 1)).map((b) => b[1] + b[3]);
    const top = Math.max(...tops, 0.8);
    CENTRE[1] = 0.1 + top * 0.42;
    reach = Math.max(0.9, Math.min(1.4, top / 2.2));
    // the body colour as absorption per unit length
    const sp = spec.species;
    for (let i = 0; i < spec.crystals.length; i++) {
      C1[i * 4 + 2] = sp.ior; C1[i * 4 + 3] = sp.disp * 2.2;
      for (let k = 0; k < 3; k++) C2[i * 4 + k] = -Math.log(Math.max(0.02, sp.tint[k])) * sp.absorb;
      C2[i * 4 + 3] = sp.milk;
      const c = spec.crystals[i];
      C3.set([c.at[0], c.at[1], c.at[2], sp.striate], i * 4);
      C4.set([c.R[3], c.R[4], c.R[5], 0], i * 4);
      C5.set([c.R[0], c.R[1], c.R[2], 0], i * 4);
      for (let k = 0; k < 3; k++) C6[i * 4 + k] = -Math.log(Math.max(0.02, sp.tint2[k])) * sp.absorb;
      C6[i * 4 + 3] = ['none', 'tip', 'core', 'band'].indexOf(sp.zoning);
      C7.set([sp.veils, sp.needles, sp.cracks, sp.phantom], i * 4);
      C8.set([sp.needle[0], sp.needle[1], sp.needle[2], sp.along ? -1 : sp.bubbles], i * 4);
      C9.set([c.frost ? 1 : 0, sp.tarnish, 0, 0], i * 4);
    }
  }
  /** the hulls as they are now: growth applied; planes and bounds uploaded */
  function upload(t: number) {
    let n = 0;
    const sp = spec.species;
    for (let i = 0; i < spec.crystals.length; i++) {
      const c = spec.crystals[i];
      const g = still ? 1 : growth(c, t);
      const pl = planesOf(c, sp, g);
      C1[i * 4] = n; C1[i * 4 + 1] = pl.length;
      for (const p of pl) { planeData.set([p.n[0], p.n[1], p.n[2], p.d], n * 4); n++; }
      const b = bound(c, sp, g);
      C0.set(b, i * 4);
      C4[i * 4 + 3] = sp.habit === 'prism' ? c.len * (0.001 + g) : c.r * (0.001 + g) * 1.6;
      C5[i * 4 + 3] = sp.habit === 'prism' ? c.r * (0.3 + 0.7 * g) : c.r * (0.001 + g);
    }
    gl.bindTexture(gl.TEXTURE_2D, planesTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 64, 4, 0, gl.RGBA, gl.FLOAT, planeData);
  }

  // ─── the camera and the light ─────────────────────────────────────────────────────────────────
  const cam = { eye: [0, 0, 0] as number[], m: new Float32Array(9) };
  function camera(v: Orbit) {
    const a = v.az, e = Math.max(0.08, Math.min(1.2, v.el));
    const D = v.dist * reach;
    const eye = [CENTRE[0] + Math.cos(e) * Math.sin(a) * D, CENTRE[1] + Math.sin(e) * D, CENTRE[2] + Math.cos(e) * Math.cos(a) * D];
    const f = norm([CENTRE[0] - eye[0], CENTRE[1] - eye[1] + 0.15, CENTRE[2] - eye[2]]);
    const r = norm(cross([0, 1, 0], f).map((x) => -x)); // right
    const u = cross(f, r).map((x) => -x);
    cam.eye = eye;
    cam.m.set([r[0], r[1], r[2], u[0], u[1], u[2], -f[0], -f[1], -f[2]]);
  }
  function light(v: Orbit, t: number): number[] {
    // behind the specimen from where you stand, a little to one side, wandering: the light comes
    // through the crystals toward you and throws its caustics in front of them
    const a = v.az + 2.5 + (still ? 0 : 0.6 * Math.sin(t * 0.07)), e = 0.9 + 0.12 * Math.sin(t * 0.11);
    return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
  }

  const GRID = quality === 'low' ? 224 : quality === 'mid' ? 320 : 512;
  const MAP = 3.4; // half-extent of the caustic map on the ground
  function setCommon(p: WebGLProgram, L: number[], gain: number) {
    gl.useProgram(p);
    gl.uniform1i(U(p, 'uN'), spec.crystals.length);
    gl.uniform4fv(U(p, 'uC0'), C0); gl.uniform4fv(U(p, 'uC1'), C1); gl.uniform4fv(U(p, 'uC2'), C2);
    gl.uniform4fv(U(p, 'uC3'), C3); gl.uniform4fv(U(p, 'uC4'), C4); gl.uniform4fv(U(p, 'uC5'), C5); gl.uniform4fv(U(p, 'uC6'), C6); gl.uniform4fv(U(p, 'uC7'), C7); gl.uniform4fv(U(p, 'uC8'), C8);
    gl.uniform1f(U(p, 'uSeed'), (seed % 1000) * 0.37);
    gl.uniform4fv(U(p, 'uC9'), C9);
    gl.uniform1i(U(p, 'uSoft'), quality === 'high' ? 4 : quality === 'mid' ? 2 : 1);
    gl.uniform1i(U(p, 'uHaze'), o.cut ? 0 : quality === 'high' ? 6 : quality === 'mid' ? 3 : 0);
    gl.uniform3fv(U(p, 'uMat'), spec.matrix);
    gl.uniform3fv(U(p, 'uLight'), L); gl.uniform3fv(U(p, 'uLightCol'), LIGHT_COL);
    gl.uniform1f(U(p, 'uTime'), performance.now() / 1000 - born);
    gl.uniform4f(U(p, 'uCMap'), 0, 0, MAP, gain);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, planesTex); gl.uniform1i(U(p, 'uPlanes'), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, causTex); gl.uniform1i(U(p, 'uCaustic'), 1);
  }
  /** one frame, w × h, into the bound default framebuffer (the canvas) */
  function frame(v: Orbit, w: number, h: number) {
    const now = performance.now() / 1000;
    const t = now - born;
    if (!o.cut && halfFloat && (sized[0] !== w || sized[1] !== h)) { scene = target(w, h); bloomA = target(Math.max(1, w >> 2), Math.max(1, h >> 2)); bloomB = target(bloomA.w, bloomA.h); sized = [w, h]; }
    upload(t);
    camera(v);
    const L = light(v, t);
    // the caustic pass: a sheet of light rays, three colours
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, CRES, CRES);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    const ext = 2.6;
    const splat = (quality === 'low' ? 4.5 : 5.0) * (CRES / 512);
    const cell = (2 * ext / GRID) ** 2, area = Math.PI * (splat / 2 * (2 * MAP / CRES)) ** 2;
    const gain = (cell / area) * 0.9 * (halfFloat ? 1 : 0.08);
    setCommon(causP, L, 1);
    const u = norm(cross([0, 1, 0], L)), vv = cross(L, u);
    gl.uniform1i(U(causP, 'uGrid'), GRID); gl.uniform3fv(U(causP, 'uU'), u); gl.uniform3fv(U(causP, 'uV'), vv);
    gl.uniform1f(U(causP, 'uExt'), ext); gl.uniform2f(U(causP, 'uJit'), still ? 0.5 : Math.random(), still ? 0.5 : Math.random()); gl.uniform3fv(U(causP, 'uCen'), CENTRE); gl.uniform1f(U(causP, 'uSplat'), splat); gl.uniform1f(U(causP, 'uGain'), gain);
    gl.bindVertexArray(vao);
    for (const [shift, wave] of [[-1, [1, 0, 0]], [0, [0, 1, 0]], [1, [0, 0, 1]]] as Array<[number, number[]]>) {
      gl.uniform1f(U(causP, 'uShift'), shift); gl.uniform3fv(U(causP, 'uWave'), wave.map((x) => x * LIGHT_COL[wave.indexOf(1)]));
      gl.drawArrays(gl.POINTS, 0, GRID * GRID);
    }
    gl.disable(gl.BLEND);
    // the main pass: to a half-float scene when there is one, else straight to the screen
    const post = !!scene && !o.debug && !o.cut;
    gl.bindFramebuffer(gl.FRAMEBUFFER, post ? scene!.fbo : null);
    gl.viewport(0, 0, w, h);
    if (o.cut) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
    setCommon(mainP, L, halfFloat ? 1 : 12.5);
    gl.uniform1i(U(mainP, 'uHdr'), post ? 1 : 0);
    gl.uniform1i(U(mainP, 'uCut'), o.cut ? 1 : 0);
    gl.uniform1i(U(mainP, 'uWood'), 0);
    gl.uniform3fv(U(mainP, 'uEye'), cam.eye); gl.uniformMatrix3fv(U(mainP, 'uCam'), false, cam.m);
    gl.uniform2f(U(mainP, 'uRes'), w, h); gl.uniform1f(U(mainP, 'uFov'), Math.tan(0.34));
    gl.uniform1i(U(mainP, 'uDisp'), quality === 'low' ? 0 : 1);
    gl.uniform1i(U(mainP, 'uDebug'), o.debug === 'caustic' ? 1 : o.debug === 'id' ? 2 : o.debug === 'matrix' ? 3 : o.debug === 'raw' ? 4 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (post) {
      // bloom: the bright parts, downsampled, blurred twice; then the grade onto the screen
      const quad = (p: WebGLProgram, to: ReturnType<typeof target> | null, tex: WebGLTexture) => {
        gl.useProgram(p); gl.bindFramebuffer(gl.FRAMEBUFFER, to ? to.fbo : null);
        gl.viewport(0, 0, to ? to.w : w, to ? to.h : h);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U(p, 'uTex'), 0);
        gl.uniform2f(U(p, 'uRes'), to ? to.w : w, to ? to.h : h);
      };
      quad(bloomP, bloomA, scene!.tex); gl.drawArrays(gl.TRIANGLES, 0, 3);
      for (let i = 0; i < 2; i++) {
        quad(blurP, bloomB, bloomA!.tex); gl.uniform2f(U(blurP, 'uDir'), 1, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        quad(blurP, bloomA, bloomB!.tex); gl.uniform2f(U(blurP, 'uDir'), 0, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      quad(finalP, null, scene!.tex);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bloomA!.tex); gl.uniform1i(U(finalP, 'uBloom'), 1);
      gl.uniform1f(U(finalP, 'uTime'), now);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
  // (the caustic map starts black: in the wood there is no caustic pass, and no ground to read it)
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, CRES, CRES); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
  gl.viewport(prevVp[0], prevVp[1], prevVp[2], prevVp[3]);
  /** the specimen drawn into another scene that shares this context (the Field Journal's wood):
   *  rays from that scene's camera (Mistwood's projection), the specimen standing at `anchor`
   *  (its matrix half in the ground), `scale` metres to its units, turned by `turn`; lit by the
   *  key light from `light` (world), fogged by `fog` toward `fogCol`; writing its depth. Into
   *  whatever framebuffer is bound, within the scissor `rect` (GL pixels) */
  function drawWood(w: { res: [number, number]; f: number; horizon: number; cam: [number, number, number, number]; anchor: [number, number, number]; scale: number; turn: number; light: number[]; lightCol: number[]; fogCol: number[]; fog: number; exposure: number; depthRange: number; rect: [number, number, number, number] }) {
    upload(20);
    const ct = Math.cos(-w.turn), st = Math.sin(-w.turn);
    const L = [w.light[0] * ct - w.light[2] * st, w.light[1], w.light[0] * st + w.light[2] * ct];
    setCommon(mainP, L, 1);
    gl.uniform3fv(U(mainP, 'uLightCol'), w.lightCol);
    gl.uniform1i(U(mainP, 'uWood'), 1);
    gl.uniform3fv(U(mainP, 'uFogCol'), w.fogCol);
    gl.uniform1i(U(mainP, 'uCut'), 1);
    gl.uniform1i(U(mainP, 'uHaze'), 0);
    gl.uniform1i(U(mainP, 'uDisp'), quality === 'low' ? 0 : 1);
    gl.uniform1i(U(mainP, 'uDebug'), 0);
    gl.uniform1i(U(mainP, 'uHdr'), 0);
    gl.uniform2f(U(mainP, 'uWRes'), w.res[0], w.res[1]);
    gl.uniform1f(U(mainP, 'uWF'), w.f); gl.uniform1f(U(mainP, 'uWHz'), w.horizon);
    gl.uniform4fv(U(mainP, 'uWCam'), w.cam);
    gl.uniform3fv(U(mainP, 'uWAnchor'), w.anchor);
    gl.uniform1f(U(mainP, 'uWScale'), w.scale); gl.uniform1f(U(mainP, 'uWTurn'), w.turn);
    gl.uniform1f(U(mainP, 'uFogK'), w.fog); gl.uniform1f(U(mainP, 'uDepthR'), w.depthRange); gl.uniform1f(U(mainP, 'uWExp'), w.exposure);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.floor(w.rect[0]), Math.floor(w.rect[1]), Math.ceil(w.rect[2]), Math.ceil(w.rect[3]));
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    gl.uniform1i(U(mainP, 'uWood'), 0);
  }
  /** how far the grown specimen reaches from its centre, in its own units (for a scissor rect) */
  const extent = () => Math.max(...spec.crystals.map((c) => { const b = bound(c, spec.species, 1); return Math.hypot(b[0], b[1], b[2]) + b[3]; }), Math.max(spec.matrix[0], spec.matrix[2]));
  return {
    grow,
    frame,
    drawWood,
    extent,
    halfFloat,
    get seed() { return seed; },
    get spec() { return spec; },
    /** how long the specimen has been growing (s) */
    get age() { return performance.now() / 1000 - born; },
    settle() { born -= 20; },
  };
}
export type CrystalEngine = ReturnType<typeof createCrystalEngine>;

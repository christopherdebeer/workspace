/**
 * Crystals: a seeded mineral specimen, ray-traced in WebGL2. Drag to turn it, pinch or scroll
 * to come closer; left alone it turns on its own, the key light wanders, and a new specimen
 * grows out of its matrix before your eyes.
 *
 * Two passes a frame: the caustic pass sends a sheet of the key light through the crystals
 * (one draw per wavelength, red, green, blue, each at its own index) and splats where each ray
 * lands on the ground into a map; the main pass traces every pixel through the same hulls,
 * reading the map wherever it sees the ground. See shaders.ts for the light, mineral.ts for the
 * specimens. `?seed=` · `?mineral=quartz|amethyst|fluorite|…` · `?q=low|high` · `?still` (no
 * motion) · `?preview`.
 */
import { randomSeed, seedFrom, seedName } from '../kit/rng';
import { bound, growth, planesOf, specimen, type Specimen } from './mineral';
import { BLOOM_FS, BLUR_FS, CAUSTIC_FS, CAUSTIC_VS, FINAL_FS, MAIN_FS, MAXC, QUAD_VS } from './shaders';

const qs = new URLSearchParams(location.search);
const preview = qs.has('preview');
const still = qs.has('still');
const quality = qs.get('q') ?? (preview ? 'low' : /Mobi|Android|iPhone|iPad/.test(navigator.userAgent) ? 'mid' : 'high');
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' });
if (!gl) throw new Error('WebGL2 needed');
const halfFloat = !!gl.getExtension('EXT_color_buffer_float');

function program(vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => { const s = gl!.createShader(type)!; gl!.shaderSource(s, src); gl!.compileShader(s); if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(s) ?? 'shader'); return s; };
  const p = gl!.createProgram()!;
  gl!.attachShader(p, mk(gl!.VERTEX_SHADER, vs)); gl!.attachShader(p, mk(gl!.FRAGMENT_SHADER, fs)); gl!.linkProgram(p);
  if (!gl!.getProgramParameter(p, gl!.LINK_STATUS)) throw new Error(gl!.getProgramInfoLog(p) ?? 'link');
  return p;
}
const mainP = program(QUAD_VS, MAIN_FS);
const causP = program(CAUSTIC_VS, CAUSTIC_FS);
const bloomP = program(QUAD_VS, BLOOM_FS), blurP = program(QUAD_VS, BLUR_FS), finalP = program(QUAD_VS, FINAL_FS);
/** a colour target of the given size (half-float when the extension allows) */
function target(w: number, h: number): { tex: WebGLTexture; fbo: WebGLFramebuffer; w: number; h: number } {
  const tex = gl!.createTexture()!;
  gl!.bindTexture(gl!.TEXTURE_2D, tex);
  gl!.texImage2D(gl!.TEXTURE_2D, 0, halfFloat ? gl!.RGBA16F : gl!.RGBA8, w, h, 0, gl!.RGBA, halfFloat ? gl!.HALF_FLOAT : gl!.UNSIGNED_BYTE, null);
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR); gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
  gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE); gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
  const fbo = gl!.createFramebuffer()!;
  gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
  gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, tex, 0);
  gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}
let scene: ReturnType<typeof target> | null = null, bloomA: ReturnType<typeof target> | null = null, bloomB: ReturnType<typeof target> | null = null;
const U = (p: WebGLProgram, n: string) => gl!.getUniformLocation(p, n);

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
let seed = seedFrom(qs.get('seed')) ?? (preview ? 1947 : randomSeed());
let spec: Specimen;
let born = 0;
const C0 = new Float32Array(MAXC * 4), C1 = new Float32Array(MAXC * 4), C2 = new Float32Array(MAXC * 4);
const C3 = new Float32Array(MAXC * 4), C4 = new Float32Array(MAXC * 4), C5 = new Float32Array(MAXC * 4), C6 = new Float32Array(MAXC * 4), C7 = new Float32Array(MAXC * 4), C8 = new Float32Array(MAXC * 4), C9 = new Float32Array(MAXC * 4);
const CENTRE: [number, number, number] = [0, 1.0, 0];
/** the camera's reach: how tall and wide the specimen will be when grown */
let reach = 1;
function grow(newSeed: number) {
  seed = newSeed;
  spec = specimen(seed, qs.get('mineral') ?? undefined);
  born = performance.now() / 1000;
  // (frame the grown specimen: its height sets the eye's target and distance)
  const tops = spec.crystals.map((c) => bound(c, spec.species, 1)).map((b) => b[1] + b[3]);
  const top = Math.max(...tops, 0.8);
  CENTRE[1] = 0.1 + top * 0.42;
  reach = Math.max(0.9, Math.min(1.4, top / 2.2));
  const u = new URL(location.href); u.searchParams.set('seed', seedName(seed)); if (!preview) history.replaceState(null, '', u);
  const label = document.getElementById('label');
  if (label) label.innerHTML = `<b>${spec.species.kind}</b><i>${spec.species.name}</i><span>${seedName(seed)} · ${spec.crystals.length} crystals · n ${spec.species.ior.toFixed(2)}</span>`;
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
  gl!.bindTexture(gl!.TEXTURE_2D, planesTex);
  gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA32F, 64, 4, 0, gl!.RGBA, gl!.FLOAT, planeData);
}

// ─── the camera and the light ─────────────────────────────────────────────────────────────────
let az = 0.6, el = 0.48, dist = 12.5, spin = 0, dragging = false, lastX = 0, lastY = 0, pinch = 0, idle = 0;
const cam = { eye: [0, 0, 0] as number[], m: new Float32Array(9) };
function camera(t: number) {
  const a = az + spin, e = Math.max(0.08, Math.min(1.2, el));
  const D = dist * reach;
  const eye = [CENTRE[0] + Math.cos(e) * Math.sin(a) * D, CENTRE[1] + Math.sin(e) * D, CENTRE[2] + Math.cos(e) * Math.cos(a) * D];
  const f = norm([CENTRE[0] - eye[0], CENTRE[1] - eye[1] + 0.15, CENTRE[2] - eye[2]]);
  const r = norm(cross([0, 1, 0], f).map((v) => -v)); // right
  const u = cross(f, r).map((v) => -v);
  cam.eye = eye;
  cam.m.set([r[0], r[1], r[2], u[0], u[1], u[2], -f[0], -f[1], -f[2]]);
  void t;
}
const norm = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function light(t: number): number[] {
  // behind the specimen from where you stand, a little to one side, wandering: the light comes
  // through the crystals toward you and throws its caustics in front of them
  const a = az + spin + 2.5 + (still ? 0 : 0.6 * Math.sin(t * 0.07)), e = 0.9 + 0.12 * Math.sin(t * 0.11);
  return [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
}
const LIGHT_COL = [1.0, 0.94, 0.86];

canvas.addEventListener('pointerdown', (ev) => { dragging = true; lastX = ev.clientX; lastY = ev.clientY; canvas.setPointerCapture(ev.pointerId); idle = 0; });
canvas.addEventListener('pointermove', (ev) => { if (!dragging) return; az += (ev.clientX - lastX) * 0.006; el += (ev.clientY - lastY) * 0.004; lastX = ev.clientX; lastY = ev.clientY; idle = 0; });
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('wheel', (ev) => { dist = Math.max(5, Math.min(20, dist * (1 + ev.deltaY * 0.001))); ev.preventDefault(); }, { passive: false });
canvas.addEventListener('touchstart', (ev) => { if (ev.touches.length === 2) pinch = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX, ev.touches[0].clientY - ev.touches[1].clientY); }, { passive: true });
canvas.addEventListener('touchmove', (ev) => { if (ev.touches.length === 2 && pinch) { const p = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX, ev.touches[0].clientY - ev.touches[1].clientY); dist = Math.max(5, Math.min(20, dist * pinch / p)); pinch = p; } }, { passive: true });

// ─── the frame ────────────────────────────────────────────────────────────────────────────────
const scale = quality === 'high' ? 0.8 : quality === 'mid' ? 0.5 : 0.4;
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2) * scale;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
    if (halfFloat) { scene = target(w, h); bloomA = target(Math.max(1, w >> 2), Math.max(1, h >> 2)); bloomB = target(bloomA.w, bloomA.h); }
  }
}
const GRID = quality === 'low' ? 224 : quality === 'mid' ? 320 : 512;
const MAP = 3.4; // half-extent of the caustic map on the ground
let frames = 0, last = performance.now() / 1000;
function setCommon(p: WebGLProgram, L: number[], gain: number) {
  gl!.useProgram(p);
  gl!.uniform1i(U(p, 'uN'), spec.crystals.length);
  gl!.uniform4fv(U(p, 'uC0'), C0); gl!.uniform4fv(U(p, 'uC1'), C1); gl!.uniform4fv(U(p, 'uC2'), C2);
  gl!.uniform4fv(U(p, 'uC3'), C3); gl!.uniform4fv(U(p, 'uC4'), C4); gl!.uniform4fv(U(p, 'uC5'), C5); gl!.uniform4fv(U(p, 'uC6'), C6); gl!.uniform4fv(U(p, 'uC7'), C7); gl!.uniform4fv(U(p, 'uC8'), C8);
  gl!.uniform1f(U(p, 'uSeed'), (seed % 1000) * 0.37);
  gl!.uniform4fv(U(p, 'uC9'), C9);
  gl!.uniform1i(U(p, 'uSoft'), quality === 'high' ? 4 : quality === 'mid' ? 2 : 1);
  gl!.uniform1i(U(p, 'uHaze'), quality === 'high' ? 6 : quality === 'mid' ? 3 : 0);
  gl!.uniform3fv(U(p, 'uMat'), spec.matrix);
  gl!.uniform3fv(U(p, 'uLight'), L); gl!.uniform3fv(U(p, 'uLightCol'), LIGHT_COL);
  gl!.uniform1f(U(p, 'uTime'), performance.now() / 1000 - born);
  gl!.uniform4f(U(p, 'uCMap'), 0, 0, MAP, gain);
  gl!.activeTexture(gl!.TEXTURE0); gl!.bindTexture(gl!.TEXTURE_2D, planesTex); gl!.uniform1i(U(p, 'uPlanes'), 0);
  gl!.activeTexture(gl!.TEXTURE1); gl!.bindTexture(gl!.TEXTURE_2D, causTex); gl!.uniform1i(U(p, 'uCaustic'), 1);
}
function frame() {
  const now = performance.now() / 1000, dt = Math.min(0.1, now - last); last = now;
  const t = now - born;
  if (!dragging && !still) { idle += dt; spin += dt * 0.07 * Math.min(1, idle / 3); }
  resize();
  upload(t);
  camera(t);
  const L = light(t);
  // the caustic pass: a sheet of light rays, three colours
  gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
  gl!.viewport(0, 0, CRES, CRES);
  gl!.clearColor(0, 0, 0, 1); gl!.clear(gl!.COLOR_BUFFER_BIT);
  gl!.enable(gl!.BLEND); gl!.blendFunc(gl!.ONE, gl!.ONE);
  const ext = 2.6;
  const splat = (quality === 'low' ? 4.5 : 5.0) * (CRES / 512);
  const cell = (2 * ext / GRID) ** 2, area = Math.PI * (splat / 2 * (2 * MAP / CRES)) ** 2;
  const gain = (cell / area) * 0.9 * (halfFloat ? 1 : 0.08);
  setCommon(causP, L, 1);
  const u = norm(cross([0, 1, 0], L)), v = cross(L, u);
  gl!.uniform1i(U(causP, 'uGrid'), GRID); gl!.uniform3fv(U(causP, 'uU'), u); gl!.uniform3fv(U(causP, 'uV'), v);
  gl!.uniform1f(U(causP, 'uExt'), ext); gl!.uniform2f(U(causP, 'uJit'), still ? 0.5 : Math.random(), still ? 0.5 : Math.random()); gl!.uniform3fv(U(causP, 'uCen'), CENTRE); gl!.uniform1f(U(causP, 'uSplat'), splat); gl!.uniform1f(U(causP, 'uGain'), gain);
  gl!.bindVertexArray(vao);
  for (const [shift, wave] of [[-1, [1, 0, 0]], [0, [0, 1, 0]], [1, [0, 0, 1]]] as Array<[number, number[]]>) {
    gl!.uniform1f(U(causP, 'uShift'), shift); gl!.uniform3fv(U(causP, 'uWave'), wave.map((x) => x * LIGHT_COL[wave.indexOf(1)]));
    gl!.drawArrays(gl!.POINTS, 0, GRID * GRID);
  }
  gl!.disable(gl!.BLEND);
  // the main pass: to a half-float scene when there is one, else straight to the screen
  const post = !!scene && !qs.get('debug');
  gl!.bindFramebuffer(gl!.FRAMEBUFFER, post ? scene!.fbo : null);
  gl!.viewport(0, 0, canvas.width, canvas.height);
  setCommon(mainP, L, halfFloat ? 1 : 12.5);
  gl!.uniform1i(U(mainP, 'uHdr'), post ? 1 : 0);
  gl!.uniform3fv(U(mainP, 'uEye'), cam.eye); gl!.uniformMatrix3fv(U(mainP, 'uCam'), false, cam.m);
  gl!.uniform2f(U(mainP, 'uRes'), canvas.width, canvas.height); gl!.uniform1f(U(mainP, 'uFov'), Math.tan(0.34));
  gl!.uniform1i(U(mainP, 'uDisp'), quality === 'low' ? 0 : 1);
  gl!.uniform1i(U(mainP, 'uDebug'), qs.get('debug') === 'caustic' ? 1 : qs.get('debug') === 'id' ? 2 : qs.get('debug') === 'matrix' ? 3 : qs.get('debug') === 'raw' ? 4 : 0);
  gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  if (post) {
    // bloom: the bright parts, downsampled, blurred twice; then the grade onto the screen
    const quad = (p: WebGLProgram, to: ReturnType<typeof target> | null, tex: WebGLTexture) => {
      gl!.useProgram(p); gl!.bindFramebuffer(gl!.FRAMEBUFFER, to ? to.fbo : null);
      gl!.viewport(0, 0, to ? to.w : canvas.width, to ? to.h : canvas.height);
      gl!.activeTexture(gl!.TEXTURE0); gl!.bindTexture(gl!.TEXTURE_2D, tex); gl!.uniform1i(U(p, 'uTex'), 0);
      gl!.uniform2f(U(p, 'uRes'), to ? to.w : canvas.width, to ? to.h : canvas.height);
    };
    quad(bloomP, bloomA, scene!.tex); gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    for (let i = 0; i < 2; i++) {
      quad(blurP, bloomB, bloomA!.tex); gl!.uniform2f(U(blurP, 'uDir'), 1, 0); gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      quad(blurP, bloomA, bloomB!.tex); gl!.uniform2f(U(blurP, 'uDir'), 0, 1); gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    }
    quad(finalP, null, scene!.tex);
    gl!.activeTexture(gl!.TEXTURE1); gl!.bindTexture(gl!.TEXTURE_2D, bloomA!.tex); gl!.uniform1i(U(finalP, 'uBloom'), 1);
    gl!.uniform1f(U(finalP, 'uTime'), now);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }
  frames++;
  requestAnimationFrame(frame);
}

document.getElementById('another')?.addEventListener('click', () => grow(randomSeed()));
document.getElementById('again')?.addEventListener('click', () => grow(seed));
if (preview) document.body.classList.add('preview');
grow(seed);
if (still) born -= 20;
(window as unknown as { __crystals: unknown }).__crystals = {
  probe: () => ({ seed: seedName(seed), species: spec.species.name, kind: spec.species.kind, crystals: spec.crystals.length, frames, grown: spec.crystals.every((c) => growth(c, performance.now() / 1000 - born) >= 1), halfFloat, quality }),
  grow: (s: number) => grow(s),
  settle: () => { born -= 20; },
};
requestAnimationFrame(frame);

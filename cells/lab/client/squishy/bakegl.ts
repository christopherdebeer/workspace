import { BAKE_RANGE, albedos, bakeDirs } from './bake';
import { FAST, params } from './env';
import { HDR, SHADOW, gl, program, u } from './gpu';
import { MAT, type V3 } from './level';
import { VSTRIDE } from './mesh';
import { len, ortho, sub } from './vmath';

// ─── the bake: the light the course's things give each other, once, as the level's laid (see bake.ts) ──
const BAKE_OCC_VS = `#version 300 es
in vec3 aPos;
in float aMat;
uniform mat4 uLVP;
flat out int vMat;
void main() { vMat = int(aMat + .5); gl_Position = uLVP * vec4(aPos, 1.); }`;
const BAKE_OCC_FS = `#version 300 es
precision highp float;
flat in int vMat;
uniform vec3 uAlb[64];
out vec4 o;
void main() {
  if (vMat == ${MAT.counter} || vMat == ${MAT.hob} || vMat == ${MAT.tiles}) discard;
  o = vec4(uAlb[clamp(vMat, 0, 63)], 1.);
}`;
const BAKE_PT_VS = `#version 300 es
in vec3 aPos;
in vec3 aNor;
uniform mat4 uLVP;
uniform highp sampler2D uDepth, uCol;
uniform vec3 uDir;
uniform float uDepthRange, uRange;
uniform vec2 uOut, uMap;
out vec4 vAcc;
void main() {
  vec3 n = normalize(aNor);
  float w = max(dot(n, uDir), 0.);
  vec4 lp = uLVP * vec4(aPos + n * .35, 1.);
  vec2 uv = lp.xy * .5 + .5;
  vAcc = vec4(0.);
  if (w > 0. && all(greaterThan(uv, vec2(0.))) && all(lessThan(uv, vec2(1.)))) {
    ivec2 tc = ivec2(uv * uMap);
    float dz = (lp.z * .5 + .5 - texelFetch(uDepth, tc, 0).r) * uDepthRange;
    // (something between it and the room that way, so far off: the nearer, the more it shuts off)
    if (dz > .6) { float occ = w / (1. + max(0., dz - 1.) / uRange); vAcc = vec4(occ, texelFetch(uCol, tc, 0).rgb * occ); }
  }
  int id = gl_VertexID, W = int(uOut.x);
  gl_Position = vec4((vec2(float(id % W), float(id / W)) + .5) / uOut * 2. - 1., 0., 1.);
  gl_PointSize = 1.;
}`;
const BAKE_PT_FS = `#version 300 es
precision highp float;
in vec4 vAcc;
out vec4 o;
void main() { o = vAcc; }`;
const bakeOccProg = HDR ? program(BAKE_OCC_VS, BAKE_OCC_FS) : null, bakePtProg = HDR ? program(BAKE_PT_VS, BAKE_PT_FS) : null;
// (fast-forwarded for a test: a rougher bake, quicker)
const BAKE_ALB = albedos(), BAKE_DIRS = bakeDirs(FAST ? 12 : 48), BAKE_MAP = FAST ? 512 : 2048;
/**
 * The bake, drawn: the course seen from each of the ways out (its depth, and the colour of what's seen), then
 * each vertex, a point of its own in a row of them, adding up how much each way is shut off near it and in
 * what colour; read back, four numbers a vertex (how shut in, 0–1; the colour of what shuts it in). Null
 * without float targets (then nothing's baked: all open).
 */
export function bakeLight(verts: Float32Array): Float32Array | null {
  if (!bakeOccProg || !bakePtProg || params.has('nobake')) return null;
  const n = Math.floor(verts.length / VSTRIDE);
  if (!n) return null;
  const t0 = performance.now();
  let lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  const roomMat = (m: number) => m === MAT.counter || m === MAT.hob || m === MAT.tiles || m === MAT.enamel;
  for (let i = 0; i < n; i++) { if (roomMat(Math.round(verts[i * VSTRIDE + 6]))) continue; for (let k = 0; k < 3; k++) { const v = verts[i * VSTRIDE + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; } }
  if (!(lo[0] < hi[0])) return null;
  // (not the room's far reaches: the course and a margin round it, from what isn't the room)
  const c: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const R = Math.min(450, len(sub(hi, lo)) / 2 + 12), depth = 2 * R + 40;
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  const vao = (p: WebGLProgram, attrs: Array<[string, number, number]>) => {
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    for (const [name, size, off] of attrs) { const l = gl.getAttribLocation(p, name); if (l < 0) continue; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, VSTRIDE * 4, off * 4); }
    return v;
  };
  const occVao = vao(bakeOccProg, [['aPos', 3, 0], ['aMat', 1, 6]]), ptVao = vao(bakePtProg, [['aPos', 3, 0], ['aNor', 3, 3]]);
  const tex = (internal: number, w: number, h: number, format: number, type: number) => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  };
  const dTex = tex(gl.DEPTH_COMPONENT24, BAKE_MAP, BAKE_MAP, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT), cTex = tex(gl.RGBA8, BAKE_MAP, BAKE_MAP, gl.RGBA, gl.UNSIGNED_BYTE);
  const mapFb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, mapFb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, dTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cTex, 0);
  const OW = Math.min(n, 2048), OH = Math.ceil(n / OW);
  const aTex = tex(gl.RGBA16F, OW, OH, gl.RGBA, gl.HALF_FLOAT);
  const accFb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, accFb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, aTex, 0);
  gl.viewport(0, 0, OW, OH);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(bakeOccProg);
  gl.uniform3fv(u(bakeOccProg, 'uAlb'), BAKE_ALB);
  gl.useProgram(bakePtProg);
  gl.uniform1i(u(bakePtProg, 'uDepth'), 3); gl.uniform1i(u(bakePtProg, 'uCol'), 4);
  gl.uniform1f(u(bakePtProg, 'uDepthRange'), depth); gl.uniform1f(u(bakePtProg, 'uRange'), BAKE_RANGE);
  gl.uniform2f(u(bakePtProg, 'uOut'), OW, OH); gl.uniform2f(u(bakePtProg, 'uMap'), BAKE_MAP, BAKE_MAP);
  for (let d = 0; d < BAKE_DIRS.length / 3; d++) {
    const dir: V3 = [BAKE_DIRS[d * 3], BAKE_DIRS[d * 3 + 1], BAKE_DIRS[d * 3 + 2]];
    const lvp = ortho(c, dir, R, depth, SHADOW);
    // (the course from this way: how far, and what colour)
    gl.bindFramebuffer(gl.FRAMEBUFFER, mapFb);
    gl.viewport(0, 0, BAKE_MAP, BAKE_MAP);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(bakeOccProg);
    gl.uniformMatrix4fv(u(bakeOccProg, 'uLVP'), false, lvp);
    gl.bindVertexArray(occVao);
    gl.drawArrays(gl.TRIANGLES, 0, n);
    // (each vertex: how much it's shut off that way, added in)
    gl.bindFramebuffer(gl.FRAMEBUFFER, accFb);
    gl.viewport(0, 0, OW, OH);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(bakePtProg);
    gl.uniformMatrix4fv(u(bakePtProg, 'uLVP'), false, lvp);
    gl.uniform3fv(u(bakePtProg, 'uDir'), dir);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, dTex);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, cTex);
    gl.bindVertexArray(ptVao);
    gl.drawArrays(gl.POINTS, 0, n);
  }
  gl.disable(gl.BLEND);
  const acc = new Float32Array(OW * OH * 4);
  gl.readPixels(0, 0, OW, OH, gl.RGBA, gl.FLOAT, acc);
  // (how much of all round it could be shut off at all, from its normal: the half of the ways it faces)
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const b = i * VSTRIDE, nx = verts[b + 3], ny = verts[b + 4], nz = verts[b + 5], nl = Math.hypot(nx, ny, nz) || 1;
    let ws = 0;
    for (let d = 0; d < BAKE_DIRS.length; d += 3) ws += Math.max(0, (BAKE_DIRS[d] * nx + BAKE_DIRS[d + 1] * ny + BAKE_DIRS[d + 2] * nz) / nl);
    const a = acc[i * 4];
    out[i * 4] = ws > 0 ? Math.min(1, a / ws) : 0;
    if (a > 1e-4) { out[i * 4 + 1] = acc[i * 4 + 1] / a; out[i * 4 + 2] = acc[i * 4 + 2] / a; out[i * 4 + 3] = acc[i * 4 + 3] / a; }
  }
  gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE0);
  for (const t of [dTex, cTex, aTex]) gl.deleteTexture(t);
  gl.deleteFramebuffer(mapFb); gl.deleteFramebuffer(accFb); gl.deleteBuffer(buf); gl.deleteVertexArray(occVao); gl.deleteVertexArray(ptVao);
  bakeMs = performance.now() - t0;
  { let sum = 0, mx = 0, raw = 0; for (let i = 0; i < n; i++) { sum += out[i * 4]; mx = Math.max(mx, out[i * 4]); raw = Math.max(raw, acc[i * 4]); } (window as unknown as { __squishyBake: unknown }).__squishyBake = { n, mean: sum / n, max: mx, raw, R, depth, err: gl.getError() }; }
  return out;
}
export let bakeMs = 0;

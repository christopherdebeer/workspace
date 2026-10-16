import { HDR, gl, u, backProg, brightProg, blurProg, finishProg } from './gpu';

/** (a triangle over the glass, drawn from its vertex ids: no buffers) */
export const skyVao = gl.createVertexArray()!;
// ─── where the scene's drawn, and its finish ──────────────────────────────────────────────────────
/**
 * The scene's drawn into a multisampled target of its own (half floats, in HDR: light as it adds up), resolved
 * into a texture: mid-frame, for the jelly to be seen through; at the end, for the finish (the bloom from
 * what's brightest, a quarter the size, spread; then tonemapped once onto the glass).
 */
const FMT = HDR ? gl.RGBA16F : gl.RGBA8;
const MAX_SAMPLES = Math.max(1, gl.getParameter(gl.MAX_SAMPLES) as number);
export const msFb = gl.createFramebuffer()!, msColor = gl.createRenderbuffer()!, msDepth = gl.createRenderbuffer()!;
const resFb = gl.createFramebuffer()!, resTex = gl.createTexture()!;
const bloomFb = [gl.createFramebuffer()!, gl.createFramebuffer()!], bloomTex = [gl.createTexture()!, gl.createTexture()!];
export const backFb = gl.createFramebuffer()!, backTex = gl.createTexture()!;
let tgtW = 0, tgtH = 0;
export let tgtS = 0;
function blankTex(t: WebGLTexture, w: number, h: number) {
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, FMT, w, h, 0, gl.RGBA, HDR ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
}
export function targets(W: number, H: number, samples: number) {
  const S = Math.min(samples, MAX_SAMPLES);
  if (W === tgtW && H === tgtH && S === tgtS) return;
  tgtW = W; tgtH = H; tgtS = S;
  gl.bindRenderbuffer(gl.RENDERBUFFER, msColor);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, S, FMT, W, H);
  gl.bindRenderbuffer(gl.RENDERBUFFER, msDepth);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, S, gl.DEPTH_COMPONENT24, W, H);
  gl.bindFramebuffer(gl.FRAMEBUFFER, msFb);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msColor);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, msDepth);
  blankTex(resTex, W, H);
  gl.bindFramebuffer(gl.FRAMEBUFFER, resFb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resTex, 0);
  if (backProg) {
    blankTex(backTex, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, backFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, backTex, 0);
  }
  for (let i = 0; i < 2; i++) {
    blankTex(bloomTex[i], Math.max(1, W >> 2), Math.max(1, H >> 2));
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFb[i]);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bloomTex[i], 0);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}
/** What's been drawn so far, resolved, for the jelly to be seen through (on texture 1); and on drawing the scene again. */
export function sceneCopy(W: number, H: number) {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msFb);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resFb);
  gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, msFb);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, resTex);
  gl.activeTexture(gl.TEXTURE0);
}
/** how bright before it blooms (linear: a white plate in the sun is about 2), and how much */
const BLOOM_T = 2.8, BLOOM_KNEE = 0.8, BLOOM_K = 0.35;
/** The finish: resolved; in HDR, bloom from what's brightest; onto the glass, tonemapped once. */
export function finish(W: number, H: number) {
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msFb);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resFb);
  gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(true);
  gl.bindVertexArray(skyVao);
  const bw = Math.max(1, W >> 2), bh = Math.max(1, H >> 2);
  if (HDR) {
    gl.viewport(0, 0, bw, bh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFb[0]);
    gl.useProgram(brightProg);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, resTex);
    gl.uniform1i(u(brightProg, 'uSrc'), 1);
    gl.uniform2f(u(brightProg, 'uTexel'), 1 / W, 1 / H);
    gl.uniform1f(u(brightProg, 'uThresh'), BLOOM_T); gl.uniform1f(u(brightProg, 'uKnee'), BLOOM_KNEE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(blurProg);
    gl.uniform1i(u(blurProg, 'uSrc'), 1);
    for (let pass = 0; pass < 2; pass++) for (let d = 0; d < 2; d++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFb[1 - d]);
      gl.bindTexture(gl.TEXTURE_2D, bloomTex[d]);
      gl.uniform2f(u(blurProg, 'uDir'), d === 0 ? (1 + pass) / bw : 0, d === 1 ? (1 + pass) / bh : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, W, H);
  gl.useProgram(finishProg);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, resTex);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, bloomTex[0]);
  gl.uniform1i(u(finishProg, 'uScene'), 1); gl.uniform1i(u(finishProg, 'uBloom'), 2);
  gl.uniform1f(u(finishProg, 'uBloomK'), BLOOM_K); gl.uniform1f(u(finishProg, 'uExposure'), 1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.activeTexture(gl.TEXTURE0);
}

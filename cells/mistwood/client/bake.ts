/**
 * Bake a grown structure into a card, on the GPU: every segment drawn as an
 * anti-aliased capsule into its own texture, at the resolution the card needs
 * on screen now (and again, larger, when you walk up to it).
 *
 * Twigs thinner than a pixel are drawn as faint lines of the right weight
 * (coverage = width in pixels) rather than dropped or fattened — so a crown of
 * ten thousand three-millimetre twigs becomes the grey haze it is in fog, and
 * sharpens into twigs as you come close. Overlapping twigs add up.
 *
 * Texture: R leaf (dry beech leaves), G tone (0 dark bark … 1 birch white /
 * straw lightness), A coverage. Row 0 is the base (y up), so v = height.
 */
import { SEG, type Structure } from './tree';

const VS = `#version 300 es
in vec4 aSeg;  // x0, y0, x1, y1 (m)
in vec4 aInfo; // w0, w1, tone, leaf
uniform vec2 uOrigin; // metres at the texture's left-bottom
uniform float uScale; // px per metre
uniform vec2 uSize;   // texture px
out vec2 vP;
flat out vec2 vA;
flat out vec2 vB;
flat out vec2 vW;
flat out vec2 vTL;
void main() {
  int c = gl_VertexID;
  vec2 a = (aSeg.xy - uOrigin) * uScale;
  vec2 b = (aSeg.zw - uOrigin) * uScale;
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 1e-5 ? d / len : vec2(0., 1.);
  vec2 n = vec2(-dir.y, dir.x);
  float e = max(aInfo.x, aInfo.y) * uScale * .5 + 1.5;
  vec2 p = (c == 0 || c == 2 ? a - dir * e : b + dir * e) + n * (c < 2 ? -e : e);
  vP = p;
  vA = a;
  vB = b;
  vW = aInfo.xy * uScale;
  vTL = aInfo.zw;
  gl_Position = vec4(p / uSize * 2. - 1., 0., 1.);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vP;
flat in vec2 vA;
flat in vec2 vB;
flat in vec2 vW;
flat in vec2 vTL;
out vec4 o;
void main() {
  vec2 pa = vP - vA, ba = vB - vA;
  float bb = max(dot(ba, ba), 1e-6);
  float hRaw = dot(pa, ba) / bb;
  float h = clamp(hRaw, 0., 1.);
  float d = length(pa - ba * h);
  float w = mix(vW.x, vW.y, h);
  float cov;
  if (w >= 1.) {
    cov = clamp(w * .5 - d + .5, 0., 1.);
  } else {
    // thinner than a pixel: a faint line of the right weight, and no end caps (so joints do not bead)
    if (hRaw < 0. || hRaw > 1.) discard;
    cov = w * clamp(1. - d, 0., 1.);
  }
  if (cov <= 0.) discard;
  o = vec4(vTL.y * cov, vTL.x * cov, 0., cov);
}`;

export interface Card {
  tex: WebGLTexture;
  /** the major dimension baked at (px) */
  level: number;
  texels: number;
  used: number;
}

export class Baker {
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private fbo: WebGLFramebuffer;
  private buffers = new WeakMap<Structure, WebGLBuffer>();
  private loc: Record<string, WebGLUniformLocation | null> = {};

  constructor(private gl: WebGL2RenderingContext, compile: (vs: string, fs: string) => WebGLProgram) {
    this.prog = compile(VS, FS);
    this.vao = gl.createVertexArray()!;
    this.fbo = gl.createFramebuffer()!;
    for (const n of ['uOrigin', 'uScale', 'uSize']) this.loc[n] = gl.getUniformLocation(this.prog, n);
  }

  private buffer(s: Structure): WebGLBuffer {
    const hit = this.buffers.get(s);
    if (hit) return hit;
    const gl = this.gl;
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, s.segs, gl.STATIC_DRAW);
    this.buffers.set(s, b);
    return b;
  }

  /** Bake `s` with its larger dimension `level` px. */
  bake(s: Structure, level: number, into?: WebGLTexture): Card {
    const gl = this.gl;
    const wM = s.maxX - s.minX;
    const hM = s.maxY;
    const scale = (level - 4) / Math.max(wM, hM);
    const W = Math.max(4, Math.ceil(wM * scale) + 4);
    const H = Math.max(4, Math.ceil(hM * scale) + 4);
    const tex = into ?? gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    // tone and leaf: the strongest wins; coverage adds up (overlapping twigs darken)
    gl.blendEquationSeparate(gl.MAX, gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
    gl.useProgram(this.prog);
    // origin: two pixels in from the left-bottom
    gl.uniform2f(this.loc.uOrigin, s.minX - 2 / scale, -2 / scale);
    gl.uniform1f(this.loc.uScale, scale);
    gl.uniform2f(this.loc.uSize, W, H);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer(s));
    const a0 = gl.getAttribLocation(this.prog, 'aSeg');
    const a1 = gl.getAttribLocation(this.prog, 'aInfo');
    gl.enableVertexAttribArray(a0);
    gl.vertexAttribPointer(a0, 4, gl.FLOAT, false, SEG * 4, 0);
    gl.vertexAttribDivisor(a0, 1);
    gl.enableVertexAttribArray(a1);
    gl.vertexAttribPointer(a1, 4, gl.FLOAT, false, SEG * 4, 16);
    gl.vertexAttribDivisor(a1, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, s.count);
    gl.bindVertexArray(null);
    gl.blendEquation(gl.FUNC_ADD);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return { tex, level, texels: W * H * 1.34, used: 0 };
  }
}

/** The texture's extent in metres (matches the bake's two-pixel margin). */
export function cardExtent(s: Structure, level: number) {
  const wM = s.maxX - s.minX;
  const scale = (level - 4) / Math.max(wM, s.maxY);
  const W = Math.max(4, Math.ceil(wM * scale) + 4);
  const H = Math.max(4, Math.ceil(s.maxY * scale) + 4);
  return { left: s.minX - 2 / scale, bottom: -2 / scale, width: W / scale, height: H / scale };
}

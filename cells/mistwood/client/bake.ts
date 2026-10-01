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
 * straw lightness), B flex (how freely the wind moves it: twigs 1, trunk 0),
 * A coverage. Row 0 is the base (y up), so v = height.
 */
import { SEG, type Structure } from './tree';

const VS = `#version 300 es
in vec3 aP0;
in vec3 aP1;   // tree-local metres, y up
in vec4 aInfo; // w0, w1, tone, leaf
uniform vec2 uRight;  // the card's across direction in the tree's own x, z (seen from there)
uniform vec2 uOrigin; // (across, up) metres at the texture's left-bottom
uniform float uScale; // px per metre
uniform vec2 uSize;   // texture px
out vec2 vP;
flat out vec2 vA;
flat out vec2 vB;
flat out vec2 vW;
flat out vec2 vTL;
flat out float vFlex;
void main() {
  int c = gl_VertexID;
  // how far the wind can move it: twigs freely, limbs a little, the trunk not at all
  vFlex = 1. - smoothstep(.004, .045, aInfo.x);
  vec2 a = (vec2(dot(aP0.xz, uRight), aP0.y) - uOrigin) * uScale;
  vec2 b = (vec2(dot(aP1.xz, uRight), aP1.y) - uOrigin) * uScale;
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
flat in float vFlex;
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
  // round wood, shaded as it is baked (a far card cannot be lit later): light from the upper left
  // through the fog and soft from above, so a birch reads as a trunk and not a stripe
  float tone = vTL.x;
  if (w > 1.5 && tone > .3) {
    vec2 nn = normalize(vec2(-(vB - vA).y, (vB - vA).x) + 1e-6);
    if (nn.x < 0.) nn = -nn;
    float a = clamp(dot(vP - vA - (vB - vA) * h, nn) / (w * .5), -1., 1.);
    vec3 N = vec3(nn * a, sqrt(max(0., 1. - a * a)));
    tone *= .62 + .3 * max(0., dot(N, normalize(vec3(-.55, .45, .6)))) + .12 * (.5 + .5 * N.y);
  }
  o = vec4(vTL.y * cov, tone * cov, vFlex * cov, cov);
}`;

export interface Card {
  tex: WebGLTexture;
  /** the major dimension baked at (px) */
  level: number;
  texels: number;
  used: number;
  /** its extent in the tree's metres: across (from the axis) and up */
  left: number;
  bottom: number;
  width: number;
  height: number;
}

export class Baker {
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private fbo: WebGLFramebuffer;
  private buffers = new Map<Structure, WebGLBuffer>();
  private loc: Record<string, WebGLUniformLocation | null> = {};

  constructor(private gl: WebGL2RenderingContext, compile: (vs: string, fs: string) => WebGLProgram) {
    this.prog = compile(VS, FS);
    this.vao = gl.createVertexArray()!;
    this.fbo = gl.createFramebuffer()!;
    for (const n of ['uOrigin', 'uScale', 'uSize', 'uRight']) this.loc[n] = gl.getUniformLocation(this.prog, n);
  }

  /** The structure's segments on the GPU (shared with the live renderer). */
  buffer(s: Structure): WebGLBuffer {
    const hit = this.buffers.get(s);
    if (hit) return hit;
    const gl = this.gl;
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, s.segs, gl.STATIC_DRAW);
    this.buffers.set(s, b);
    return b;
  }

  /** Free every structure's GPU buffer (a new wood grows new structures). */
  dispose() {
    for (const b of this.buffers.values()) this.gl.deleteBuffer(b);
    this.buffers.clear();
  }

  /** Bake `s` as seen with `right` as its across direction, its larger dimension `level` px. */
  bake(s: Structure, level: number, right: [number, number]): Card {
    const gl = this.gl;
    // its extent across, seen from here
    let lo = Infinity;
    let hi = -Infinity;
    const g = s.segs;
    for (let i = 0; i < s.count; i++) {
      const o = i * SEG;
      const w = Math.max(g[o + 6], g[o + 7]);
      const a0 = g[o] * right[0] + g[o + 2] * right[1];
      const a1 = g[o + 3] * right[0] + g[o + 5] * right[1];
      lo = Math.min(lo, a0 - w, a1 - w);
      hi = Math.max(hi, a0 + w, a1 + w);
    }
    const wM = Math.max(0.05, hi - lo);
    const hM = s.maxY;
    const scale = (level - 4) / Math.max(wM, hM);
    const W = Math.max(4, Math.ceil(wM * scale) + 4);
    const H = Math.max(4, Math.ceil(hM * scale) + 4);
    const tex = gl.createTexture()!;
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
    // tone, leaf and flex: the strongest wins; coverage adds up (overlapping twigs darken)
    gl.blendEquationSeparate(gl.MAX, gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
    gl.useProgram(this.prog);
    const left = lo - 2 / scale;
    const bottom = -2 / scale;
    gl.uniform2f(this.loc.uOrigin, left, bottom);
    gl.uniform1f(this.loc.uScale, scale);
    gl.uniform2f(this.loc.uSize, W, H);
    gl.uniform2f(this.loc.uRight, right[0], right[1]);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer(s));
    const attr = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(this.prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, SEG * 4, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr('aP0', 3, 0);
    attr('aP1', 3, 3);
    attr('aInfo', 4, 6);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, s.count);
    gl.bindVertexArray(null);
    gl.blendEquation(gl.FUNC_ADD);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return { tex, level, texels: W * H * 1.34, used: 0, left, bottom, width: W / scale, height: H / scale };
  }
}

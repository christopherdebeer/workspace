/**
 * Bake a grown structure into a card, on the GPU: every segment drawn as an
 * anti-aliased capsule into its own texture, at the resolution the card needs
 * on screen now (and again, larger, when you walk up to it).
 *
 * Twigs thinner than a pixel are drawn as faint lines of the right weight
 * (coverage = width in pixels) rather than dropped or fattened — so a crown of
 * ten thousand three-millimetre twigs becomes the grey haze it is in fog, and
 * sharpens into twigs as you come close. Overlapping twigs add up (premultiplied
 * "over"), and tone is their coverage-weighted mean, so a card keeps its light
 * at every resolution it is baked at.
 *
 * Texture: R leaf (dry beech leaves; in the sketch, how much is pencil), G tone (0 dark bark … 1 birch white /
 * straw lightness), B flex (how freely the wind moves it: twigs 1, trunk 0),
 * A coverage. Row 0 is the base (y up), so v = height.
 */
import { PENCIL } from '../kit/pencil';
import { SEG, type Structure } from './tree';

const VS = `#version 300 es
in vec3 aP0;
in vec3 aP1;   // tree-local metres, y up
in vec4 aInfo; // w0, w1, tone, leaf
in vec3 aStroke; // the sketch: its stroke, how far along it (m), its class
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
flat out vec3 vStroke;
flat out float vLen;
void main() {
  int c = gl_VertexID;
  vStroke = aStroke;
  vLen = length(aP1 - aP0);
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
flat in vec3 vStroke;
flat in float vLen;
out vec4 o;
// 1: baked in pencil strokes (?style=sketch): wide wood as its two edges and strokes round it where
// dark, a twig as one line whose weight is its width
uniform float uSketch;
// 1: grass and scrub (of their hundreds of finest blades only some drawn); trees keep every twig
uniform float uSparse;
float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hh(i), hh(i + vec2(1., 0.)), u.x), mix(hh(i + vec2(0., 1.)), hh(i + vec2(1., 1.)), u.x), u.y);
}
${PENCIL}
float h_(float x) { return clamp(x, 0., 1.); }
float sketchCov(float hRaw, float d, float w, vec2 dir, vec2 nn, float tone) {
  // the hand along the whole stroke (a branch from its foot to its tip): its pressure and drift are
  // functions of how far along it this is, so a line runs on unbroken from one segment into the
  // next, as one gesture
  float along = dot(vP, dir);
  float s = vStroke.y + clamp(hRaw, 0., 1.) * vLen;
  float id = vStroke.x;
  float press = strokePress(s, id);
  float weight = strokeWeight(vStroke.z);
  if (w >= 2.5) {
    // its two contours, each its own drift (the hand goes up one side and down the other); a faint
    // second pass along some stretches; firm as its class is
    float sd = dot(vP - vA - (vB - vA) * hRaw, nn);
    float sideId = sd > 0. ? id : id + 101.;
    float drift = strokeDrift(s, sideId) * 1.4;
    float edge = strokeLine(w * .5 - d - .7 + drift, .45) * strokePress(s, sideId) * weight;
    edge = max(edge, strokeAgain(s, sideId) * .35 * weight * strokeLine(w * .5 - d - 1.9 - drift * .5, .35));
    // shading: fine strokes running along the wood, in lanes a couple of px apart across it, kept
    // where the bark is dark (none on birch), the shaded side (the right: the light is from the upper
    // left) more, broken into lengths
    float side = dot(vP - vA - (vB - vA) * clamp(hRaw, 0., 1.), nn) / max(w * .5, .5);
    float laneW = side * w * .5 / 2.4;
    float lane = floor(laneW);
    float r = hh(vec2(lane, floor(vA.x * .1) + floor(vA.y * .1) * 7.));
    // (bark only indicated: a few short strokes, on the shaded side)
    float dark = (1. - tone * .9) * (.15 + .5 * smoothstep(-.2, .9, side));
    float run = smoothstep(.42, .6, vn(vec2(along / (5. + 8. * r), lane * 1.7)));
    float lanes = (1. - smoothstep(.12, .3, abs(fract(laneW) - .5))) * run * step(r, dark * 1.3) * smoothstep(.97, .8, abs(side));
    // a birch: white, with dark dashes across it in loose rows
    float rowL = along / 5.;
    float lent = tone > .3 ? step(hh(vec2(floor(rowL), floor(side * 3.) + 17.)), .35) * (1. - smoothstep(.1, .28, abs(fract(rowL) - .5))) * smoothstep(.95, .45, abs(side)) : 0.;
    return max(edge, max(lanes * .3, lent * .7));
  }
  // a twig: one line (never finer than the pencil's point), faint as it is thin; of the finest, only
  // some drawn (a tussock's hundreds of blades are a few strokes, not a smudge)
  // (whole blades: each is a stroke, kept or not as one)
  if (uSparse > .5 && pH(vec2(vStroke.x * .37, 3.1)) > .4) discard;
  // its weight is its optical mass: a tenth of a pixel of twig a tenth as dark as a pixel of
  // branch, no floor (overlapping twigs build up into a darker knot, as graphite does)
  return strokeLine(d + strokeDrift(s, id) * .5, w * .5) * pow(clamp(w, 0., 1.), .9) * press * min(weight * 2.2, 1.);
}
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
  // the sketch: the body is still all there (its coverage: it is paper, hiding what is behind), and R
  // carries how much of it is pencil (premultiplied like the rest)
  float mark = 0.;
  if (uSketch > .5) {
    vec2 dir = normalize(vB - vA + 1e-6);
    vec2 nn = vec2(-dir.y, dir.x);
    if (nn.x < 0.) nn = -nn;
    if (w >= 2.5) {
      // wide wood as a continuous tube: no round ends (whose paper would cut the contour of the
      // segment before at every joint), each segment running a little past its ends to overlap the
      // next, its edges straight on
      float over = w * .4 / sqrt(bb);
      if (hRaw < -over || hRaw > 1. + over) discard;
      float dl = length(pa - ba * hRaw);
      float wl = max(mix(vW.x, vW.y, hRaw), .5);
      cov = clamp(wl * .5 - dl + .5, 0., 1.);
      mark = sketchCov(hRaw, dl, wl, dir, nn, vTL.x);
    } else mark = sketchCov(hRaw, length(vP - vA - (vB - vA) * h), w, dir, nn, vTL.x);
    // (a line is never wider than the body it is drawn on: a twig's line is its body)
    if (w < 2.5) cov = max(cov, mark);
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
  o = vec4((uSketch > .5 ? min(mark / max(cov, 1e-3), 1.) : vTL.y) * cov, tone * cov, vFlex * cov, cov);
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
  /** which of the sides it was baked from (main.ts SIDES) */
  side: number;
}

export class Baker {
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private fbo: WebGLFramebuffer;
  private buffers = new Map<Structure, WebGLBuffer>();
  private loc: Record<string, WebGLUniformLocation | null> = {};

  constructor(
    private gl: WebGL2RenderingContext,
    /** (the renderer's: it fixes the sketch, on or off, in the shader) */
    compile: (vs: string, fs: string) => WebGLProgram,
    /** bake in pencil strokes (the sketch) */
    readonly sketch = false,
  ) {
    this.prog = compile(VS, FS);
    this.vao = gl.createVertexArray()!;
    this.fbo = gl.createFramebuffer()!;
    for (const n of ['uOrigin', 'uScale', 'uSize', 'uRight', 'uSparse']) this.loc[n] = gl.getUniformLocation(this.prog, n);
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

  /** Bake `s` as seen with `right` as its across direction, its larger dimension `level` px; `sparse`: grass or scrub (in the sketch, only some of its finest blades drawn). */
  bake(s: Structure, level: number, right: [number, number], sparse = false): Card {
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
    // premultiplied "over": coverage builds as 1 − Π(1 − c) (overlapping twigs darken, never
    // overflow), and tone, leaf and flex are coverage-weighted means — the same at every resolution,
    // so a card does not change its light when it is baked again sharper as you come near
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    const left = lo - 2 / scale;
    const bottom = -2 / scale;
    gl.uniform2f(this.loc.uOrigin, left, bottom);
    gl.uniform1f(this.loc.uScale, scale);
    gl.uniform2f(this.loc.uSize, W, H);
    gl.uniform2f(this.loc.uRight, right[0], right[1]);
    gl.uniform1f(this.loc.uSparse, sparse ? 1 : 0);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer(s));
    const attr = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(this.prog, name);
      // (an attribute the compiler dropped — the sketch's, when drawing film)
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, SEG * 4, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr('aP0', 3, 0);
    attr('aP1', 3, 3);
    attr('aInfo', 4, 6);
    attr('aStroke', 3, 10);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, s.count);
    gl.bindVertexArray(null);
    gl.blendEquation(gl.FUNC_ADD);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return { tex, level, texels: W * H * 1.34, used: 0, left, bottom, width: W / scale, height: H / scale, side: 0 };
  }
}

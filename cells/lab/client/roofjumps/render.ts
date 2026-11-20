/**
 * Roof Jumps' renderer: one program over the city's chunks and the figure's bones. The geometry carries no look of its
 * own (mesh.ts says what a face is, and where on its box); how it's drawn is a look (looks.ts), each self-contained,
 * the program built from all of them and the one asked for picked when drawing. Around them: the haze the distance
 * fades into, a sky (a look's, else the haze), and the figure's shadow (a disc under it, or its own shape cast along the
 * light onto the roof under it and the nearest wall).
 */
import type { City } from './city';
import { CHUNK } from './city';
import { FIGURE, VERTEX, chunkMesh, figureMesh } from './mesh';
import type { Bone } from './rig';
import type { M4 } from './m4';

import { LOOK_DEFS, LOOK_PRELUDE } from './looks';
import { Painter } from './paint';
import { StrokePainter } from './strokes';
import type { Light, V } from './strokes';
import { lightKey } from './strokes';
import { lookAt, mul } from './m4';
import type { LookDef } from './looks';

/** the looks by name, in the order the page cycles them */
export const LOOKS = LOOK_DEFS.map((d) => d.name);
export type Look = string;

const VS = `#version 300 es
in vec3 aPos; in vec3 aNor; in float aTag; in vec4 aRect; in vec2 aSpan; in float aSeed;
uniform mat4 uVP;
out vec3 vPos; flat out vec3 vNor; flat out float vTag; out vec3 vBary; flat out vec4 vRect; flat out vec2 vSpan; flat out float vSeed;
void main() {
  vPos = aPos; vNor = aNor; vTag = aTag; vRect = aRect; vSpan = aSpan; vSeed = aSeed;
  int k = gl_VertexID % 3; vBary = vec3(k == 0, k == 1, k == 2);
  gl_Position = uVP * vec4(aPos, 1.0);
}`;
/** the program's fragment shader: the prelude, each look as its own function, and the one asked for picked */
const FS = `#version 300 es
precision highp float;
in vec3 vPos; flat in vec3 vNor; flat in float vTag; in vec3 vBary; flat in vec4 vRect; flat in vec2 vSpan; flat in float vSeed;
uniform vec3 uEye; uniform vec3 uFog; uniform float uFar; uniform float uFogNear; uniform int uLook; uniform int uMask;
out vec4 o;
${LOOK_PRELUDE}
${LOOK_DEFS.map((d, i) => `// ─── ${d.name}\n${d.glsl.replace(/\bvec3 look\(/, `vec3 look_${i}(`)}`).join('\n')}
void main() {
  Surf s = Surf(vPos, normalize(vNor), int(vTag + 0.5), vRect, vSpan, vSeed, vBary, uEye);
  vec3 col = vec3(0.0);
  ${LOOK_DEFS.map((_, i) => `${i ? 'else ' : ''}if (uLook == ${i}) col = look_${i}(s);`).join('\n  ')}
  float dist = length(vPos - uEye);
  // (painted after: the figure marked in alpha, so the strokes keep it apart from what's behind it)
  o = vec4(mix(col, uFog, smoothstep(uFar * uFogNear, uFar, dist)), uMask == 1 && s.tag == 6 ? 0.0 : 1.0);
}`;
// (a sky behind: from straight up to the horizon, a look's; the eye's ray from each pixel)
const KVS = `#version 300 es
in vec2 aPos; out vec2 vNdc; void main() { vNdc = aPos; gl_Position = vec4(aPos, 0.9999, 1.0); }`;
const KFS = `#version 300 es
precision highp float; in vec2 vNdc; uniform mat4 uInv; uniform vec3 uTop; uniform vec3 uHor; uniform float uClouds; out vec4 o;
${LOOK_PRELUDE}
void main() {
  vec4 a = uInv * vec4(vNdc, -1.0, 1.0), b = uInv * vec4(vNdc, 1.0, 1.0); vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  float up = clamp(d.y, 0.0, 1.0); vec3 c = mix(uHor, uTop, pow(up, 0.6));
  // (soft painted cloud, streaked along the horizon)
  if (d.y > 0.02) { vec2 p = d.xz / (d.y + 0.15); float k = fbm(p * vec2(0.9, 2.2)); c = mix(c, uHor * 1.06 + 0.03, smoothstep(0.45, 0.8, k) * uClouds * (1.0 - up)); }
  o = vec4(c, 1.0);
}`;
// (the figure's own shape thrown along the light onto a plane, kept within that face of what it falls on)
const CVS = `#version 300 es
in vec3 aPos; uniform mat4 uVP; uniform vec3 uL; uniform vec4 uPlane; out vec3 vW;
void main() {
  float t = (uPlane.w - dot(uPlane.xyz, aPos)) / min(-0.05, dot(uPlane.xyz, uL));
  vec3 p = aPos + uL * max(0.0, t) + uPlane.xyz * 0.015; vW = p; gl_Position = uVP * vec4(p, 1.0);
}`;
// (depth from the sun, for the shadow map)
const DVS = `#version 300 es
in vec3 aPos; uniform mat4 uVP; void main() { gl_Position = uVP * vec4(aPos, 1.0); }`;
const DFS = `#version 300 es
precision mediump float; out vec4 o; void main() { o = vec4(1.0); }`;
const CFS = `#version 300 es
precision highp float; in vec3 vW; uniform vec3 uMin; uniform vec3 uMax; uniform vec4 uShade; out vec4 o;
void main() { if (any(lessThan(vW, uMin)) || any(greaterThan(vW, uMax))) discard; o = uShade; }`;
// (the figure's shadow: a soft disc on whatever is under it; without it a leap can't be read)
const SVS = `#version 300 es
in vec2 aPos; uniform mat4 uVP; uniform vec4 uAt; out vec2 vUv;
void main() { vUv = aPos; gl_Position = uVP * vec4(uAt.x + aPos.x * uAt.w, uAt.y, uAt.z + aPos.y * uAt.w, 1.0); }`;
const SFS = `#version 300 es
precision highp float; in vec2 vUv; uniform float uA; out vec4 o;
void main() { float r = length(vUv); if (r > 1.0) discard; o = vec4(0.0, 0.0, 0.0, uA * (1.0 - smoothstep(0.55, 1.0, r))); }`;

// (lines in the world, for showing working: ribbons a given width, turned to the eye)
const LVS = `#version 300 es
in vec3 aPos; in vec4 aCol; uniform mat4 uVP; out vec4 vCol;
void main() { vCol = aCol; gl_Position = uVP * vec4(aPos, 1.0); }`;
const LFS = `#version 300 es
precision highp float; in vec4 vCol; uniform float uA; out vec4 o;
void main() { o = vec4(vCol.rgb, vCol.a * uA); }`;

/** a line in the world: its points (x y z each), a colour a point (r g b a each), its width (m) */
export interface Stroke { pts: number[]; cols: number[]; w: number }

interface Built { vao: WebGLVertexArrayObject; buf: WebGLBuffer; n: number; cx: number; cz: number }

export class Renderer {
  gl: WebGL2RenderingContext;
  look: Look = 'grid';
  /** the figure's colours by material (character.ts): the character being drawn */
  palette: [number, number, number][] = [[0.78, 0.6, 0.48], [0.11, 0.1, 0.1], [0.21, 0.21, 0.28], [0.13, 0.14, 0.2], [0.87, 0.84, 0.77], [0.5, 0.3, 0.24], [0.34, 0.38, 0.3], [0.8, 0.78, 0.72]];
  /** how far is drawn, in chunks */
  radius = 4;
  fog: [number, number, number] = [0.8, 0.8, 0.79];
  private prog: WebGLProgram; private sprog: WebGLProgram; private lprog: WebGLProgram; private kprog: WebGLProgram; private cprog: WebGLProgram;
  private lvao: WebGLVertexArrayObject; private lbuf: WebGLBuffer; private ldata = new Float32Array(7 * 6 * 4096);
  private built = new Map<string, Built>();
  private fig: Built; private figData = new Float32Array(FIGURE); private disc: WebGLVertexArrayObject;
  private u: Record<string, WebGLUniformLocation | null> = {};
  tris = 0;

  /** a time of day over the look's own: the sun, and (for a look with a sky) the sky and the haze (menu.ts) */
  time: { sun: [number, number, number]; sky: { top: [number, number, number]; horizon: [number, number, number]; clouds: number }; fog: [number, number, number]; fogNear: number } | null = null;

  constructor(readonly canvas: HTMLCanvasElement, public city: City) {
    const gl = canvas.getContext('webgl2', { antialias: true, stencil: true });
    if (!gl) throw new Error('WebGL2 is needed');
    this.gl = gl;
    this.prog = this.program(VS, FS); this.sprog = this.program(SVS, SFS);
    for (const n of ['uVP', 'uEye', 'uFog', 'uFar', 'uFogNear', 'uLook', 'uSun', 'uMask', 'uFigure']) this.u[n] = gl.getUniformLocation(this.prog, n);
    this.kprog = this.program(KVS, KFS, ['aPos']); for (const n of ['uInv', 'uTop', 'uHor', 'uClouds']) this.u['k' + n] = gl.getUniformLocation(this.kprog, n);
    this.dprog = this.program(DVS, DFS, ['aPos']); this.u.duVP = gl.getUniformLocation(this.dprog, 'uVP');
    for (const n of ['uShadowMap', 'uSunVP', 'uShadowOn']) this.u[n] = gl.getUniformLocation(this.prog, n);
    // (the sun's shadow map: a depth texture compared on lookup, always bound so a look can ask whether or not it's drawn)
    this.smap = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.smap);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SMAP, SMAP, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.sfb = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, this.sfb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.smap, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.painter = new Painter(gl, (vs, fs, a) => this.program(vs, fs, a));
    this.strokes = new StrokePainter(gl, (vs, fs, a) => this.program(vs, fs, a));
    this.cprog = this.program(CVS, CFS, ['aPos']); for (const n of ['uVP', 'uL', 'uPlane', 'uMin', 'uMax', 'uShade']) this.u['c' + n] = gl.getUniformLocation(this.cprog, n);
    for (const n of ['uVP', 'uAt', 'uA']) this.u['s' + n] = gl.getUniformLocation(this.sprog, n);
    this.lprog = this.program(LVS, LFS, ['aPos', 'aCol']);
    for (const n of ['uVP', 'uA']) this.u['l' + n] = gl.getUniformLocation(this.lprog, n);
    this.lvao = gl.createVertexArray()!; this.lbuf = gl.createBuffer()!;
    gl.bindVertexArray(this.lvao); gl.bindBuffer(gl.ARRAY_BUFFER, this.lbuf); gl.bufferData(gl.ARRAY_BUFFER, this.ldata, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
    gl.bindVertexArray(null);
    this.fig = this.vao(this.figData, gl.DYNAMIC_DRAW, 0, 0);
    this.disc = gl.createVertexArray()!;
    gl.bindVertexArray(this.disc);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.screen = gl.createVertexArray()!;
    gl.bindVertexArray(this.screen); gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }
  private screen: WebGLVertexArrayObject;
  /** the brushwork looks' painter (strokes.ts) */
  strokes!: StrokePainter;
  /** brushwork: how far detail is kept (1: as the rules rank it) */
  detail = 1;
  private dprog!: WebGLProgram; private smap!: WebGLTexture; private sfb!: WebGLFramebuffer; private painter!: Painter;
  /**
   * The sun's view: an orthographic box along the light, centred on (x, y, z) (snapped to its texels, so the shadows don't
   * crawl as it follows), drawn with everything in it: the buildings and the figure.
   */
  private sunPass(x: number, y: number, z: number, sun: number[], figN: number): M4 {
    const gl = this.gl, l = Math.hypot(sun[0], sun[1], sun[2]), d = [sun[0] / l, sun[1] / l, sun[2] / l], H = 48, step = (2 * H) / SMAP;
    const up = Math.abs(d[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
    let view = lookAt([x + d[0] * 150, y + d[1] * 150, z + d[2] * 150], [x, y, z], up);
    // (snap: the centre moved to a whole texel in the sun's view)
    const cx = view[0] * x + view[4] * y + view[8] * z + view[12], cy = view[1] * x + view[5] * y + view[9] * z + view[13];
    const sx = Math.round(cx / step) * step - cx, sy = Math.round(cy / step) * step - cy;
    view = mul(ortho(-H + sx, H + sx, -H + sy, H + sy, 1, 320), view);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sfb); gl.viewport(0, 0, SMAP, SMAP); gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.colorMask(false, false, false, false);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 3);
    gl.useProgram(this.dprog); gl.uniformMatrix4fv(this.u.duVP, false, view);
    for (const c of this.built.values()) { gl.bindVertexArray(c.vao); gl.drawArrays(gl.TRIANGLES, 0, c.n); }
    gl.bindVertexArray(this.fig.vao); gl.drawArrays(gl.TRIANGLES, 0, figN);
    gl.disable(gl.POLYGON_OFFSET_FILL); gl.colorMask(true, true, true, true); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return view;
  }
  /** the look being drawn */
  get def(): LookDef { return LOOK_DEFS.find((d) => d.name === this.look) ?? LOOK_DEFS[0]; }

  private program(vs: string, fs: string, attribs = ['aPos', 'aNor', 'aTag', 'aRect', 'aSpan', 'aSeed']): WebGLProgram {
    const gl = this.gl, p = gl.createProgram()!;
    for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      gl.attachShader(p, s);
    }
    attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  }

  private vao(data: Float32Array, usage: number, cx: number, cz: number): Built {
    const gl = this.gl, vao = gl.createVertexArray()!, buf = gl.createBuffer()!;
    gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    const S = VERTEX * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, S, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, S, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, S, 28);
    gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 2, gl.FLOAT, false, S, 44);
    gl.enableVertexAttribArray(5); gl.vertexAttribPointer(5, 1, gl.FLOAT, false, S, 52);
    gl.bindVertexArray(null);
    return { vao, buf, n: data.length / VERTEX, cx, cz };
  }

  resize(): void {
    const d = Math.min(2, devicePixelRatio || 1), w = Math.round(this.canvas.clientWidth * d), h = Math.round(this.canvas.clientHeight * d);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  /** Another city: everything made of the last one dropped. */
  setCity(city: City): void {
    for (const c of this.built.values()) { this.gl.deleteVertexArray(c.vao); this.gl.deleteBuffer(c.buf); }
    this.built.clear(); this.strokes.reset(); this.city = city;
  }

  /** Make the chunks round (x, z) that aren't made yet (nearest first, at most `budget` of them); drop the far ones. */
  stream(x: number, z: number, budget: number): void {
    const gl = this.gl, cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), R = this.radius, want: [number, number, number][] = [];
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) if (!this.built.has(`${cx + a},${cz + b}`)) want.push([a * a + b * b, cx + a, cz + b]);
    want.sort((p, q) => p[0] - q[0]);
    for (const [, a, b] of want.slice(0, budget)) this.built.set(`${a},${b}`, this.vao(chunkMesh(this.city.chunk(a, b)), gl.STATIC_DRAW, a, b));
    for (const [k, c] of this.built) if (Math.abs(c.cx - cx) > R + 1 || Math.abs(c.cz - cz) > R + 1) { gl.deleteVertexArray(c.vao); gl.deleteBuffer(c.buf); this.built.delete(k); }
    this.city.evict(cx, cz, R + 2);
  }

  /** how many chunks round (x, z) are still to make */
  pending(x: number, z: number): number {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), R = this.radius; let n = 0;
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) if (!this.built.has(`${cx + a},${cz + b}`)) n++;
    return n + (this.def.strokes ? this.strokes.missing([...this.built.keys()], this.light()) : 0);
  }

  /** The city, the figure, its shadow. `rect` (pixels, from the bottom left): into that part of the canvas only; `bare`: no city, the figure alone. */
  draw(vp: M4, eye: number[], bones: Bone[], shadow: { x: number; y: number; z: number; r: number; a: number }, rect?: [number, number, number, number], bare = false): void {
    const gl = this.gl, far = this.radius * CHUNK, def = this.def, T = this.time, fog = T?.fog ?? def.fog ?? this.fog, sun = T?.sun ?? def.sun ?? [0.42, 0.8, 0.28], sky = def.sky && T ? T.sky : def.sky;
    const full: [number, number, number, number] = rect ?? [0, 0, this.canvas.width, this.canvas.height];
    // (the figure first, so the sun's pass has it too)
    const n = figureMesh(bones, this.figData);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fig.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.figData);
    let sunVP: M4 | null = null;
    if (def.shadow === 'map' && !bare) { const pm = bones.find((b) => b.name === 'pelvis')?.m; sunVP = this.sunPass(pm ? pm[12] : eye[0], pm ? pm[13] : eye[1], pm ? pm[14] : eye[2], sun, n); }
    if (def.strokes) { this.brushwork(vp, eye, bones, n, sunVP, rect, bare); return; }
    if (def.paint) this.painter.begin(full[2], full[3]);
    else if (rect) { gl.enable(gl.SCISSOR_TEST); gl.scissor(...rect); gl.viewport(...rect); } else { gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, this.canvas.width, this.canvas.height); }
    gl.clearColor(fog[0], fog[1], fog[2], 1); gl.clearStencil(0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    if (sky && !bare) {
      gl.disable(gl.DEPTH_TEST); gl.useProgram(this.kprog); gl.uniformMatrix4fv(this.u.kuInv, false, invert(vp));
      gl.uniform3fv(this.u.kuTop, sky.top); gl.uniform3fv(this.u.kuHor, sky.horizon); gl.uniform1f(this.u.kuClouds, sky.clouds ?? 0);
      gl.bindVertexArray(this.screen); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uVP, false, vp); gl.uniform3f(this.u.uEye, eye[0], eye[1], eye[2]);
    gl.uniform3fv(this.u.uFog, fog); gl.uniform1f(this.u.uFar, far); gl.uniform1f(this.u.uFogNear, T?.fogNear ?? def.fogNear ?? 0.3); gl.uniform1i(this.u.uLook, LOOKS.indexOf(def.name));
    { const l = Math.hypot(sun[0], sun[1], sun[2]); gl.uniform3f(this.u.uSun, sun[0] / l, sun[1] / l, sun[2] / l); }
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.smap); gl.uniform1i(this.u.uShadowMap, 3); gl.activeTexture(gl.TEXTURE0);
    gl.uniform3fv(this.u.uFigure, this.palette.flat()); gl.uniform1i(this.u.uMask, def.paint ? 1 : 0); gl.uniform1i(this.u.uShadowOn, sunVP ? 1 : 0); if (sunVP) gl.uniformMatrix4fv(this.u.uSunVP, false, sunVP);
    this.tris = 0;
    if (!bare) for (const c of this.built.values()) { gl.bindVertexArray(c.vao); gl.drawArrays(gl.TRIANGLES, 0, c.n); this.tris += c.n / 3; }
    gl.bindVertexArray(this.fig.vao);
    gl.drawArrays(gl.TRIANGLES, 0, n); this.tris += n / 3;
    const kind = def.shadow ?? 'disc';
    if (kind === 'cast' && shadow.a > 0 && bones.length) this.cast(vp, bones, sun, def.shade ?? [0.1, 0.1, 0.15, 0.35], n);
    else if (shadow.a > 0 && kind === 'disc') {
      gl.useProgram(this.sprog); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE);
      gl.uniformMatrix4fv(this.u.suVP, false, vp); gl.uniform4f(this.u.suAt, shadow.x, shadow.y + 0.03, shadow.z, shadow.r); gl.uniform1f(this.u.suA, shadow.a);
      gl.bindVertexArray(this.disc); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true);
    }
    gl.bindVertexArray(null);
    if (def.paint) this.painter.finish(full, invert(vp), def.paint);
  }

  /** the roof a picture leads to (the menu's first landing): a brushwork look picks it out */
  focus: Light['focus'] = null;
  private lit: Light | null = null;
  /** the light a brushwork look paints in: the time of day's, or its own; and the focus */
  light(): Light {
    const R = this.def.strokes!, T = this.time, l = { sun: (T?.sun ?? R.sun) as V, top: (T?.sky.top ?? R.skyField?.top ?? R.paper) as V, horizon: (T?.sky.horizon ?? R.skyField?.horizon ?? R.paper) as V, haze: (R.fadeToPaper ? R.haze : (T?.fog ?? R.haze)) as V, hazeNear: T && !R.fadeToPaper ? T.fogNear : R.hazeNear, focus: this.focus };
    const key = lightKey(l); if (!this.lit || this.lit.key !== key) this.lit = { ...l, key };
    return this.lit;
  }
  /** A brushwork look's frame (strokes.ts): paper, the solid world in depth, the strokes. */
  private brushwork(vp: M4, eye: number[], bones: Bone[], figN: number, sunVP: M4 | null, rect: [number, number, number, number] | undefined, bare: boolean): void {
    const gl = this.gl, rules = this.def.strokes!;
    if (rect) { gl.enable(gl.SCISSOR_TEST); gl.scissor(...rect); gl.viewport(...rect); } else { gl.disable(gl.SCISSOR_TEST); gl.viewport(0, 0, this.canvas.width, this.canvas.height); }
    gl.clearColor(rules.paper[0], rules.paper[1], rules.paper[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    const light = this.light();
    if (!bare) this.strokes.sync([...this.built.keys()], this.city, rules, 3, Math.floor(eye[0] / CHUNK), Math.floor(eye[2] / CHUNK), this.radius * CHUNK, light);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.smap); gl.activeTexture(gl.TEXTURE0);
    const pm = bones.find((b) => b.name === 'pelvis')?.m, sunC: V = pm ? [pm[12], pm[13], pm[14]] : [eye[0], eye[1], eye[2]];
    this.tris = 0;
    this.strokes.draw({
      vp, inv: invert(vp), light, eye, far: this.radius * CHUNK, rules, city: this.city, bones, palette: this.palette, sunVP, sunC, detail: this.detail, bare,
      solid: () => {
        gl.useProgram(this.dprog); gl.uniformMatrix4fv(this.u.duVP, false, vp); gl.enable(gl.CULL_FACE);
        if (!bare) for (const c of this.built.values()) { gl.bindVertexArray(c.vao); gl.drawArrays(gl.TRIANGLES, 0, c.n); this.tris += c.n / 3; }
        gl.bindVertexArray(this.fig.vao); gl.drawArrays(gl.TRIANGLES, 0, figN); gl.disable(gl.CULL_FACE);
      },
    });
    gl.bindVertexArray(null);
  }

  /**
   * The figure's shadow cast: its own triangles thrown along the light onto the roof under it (kept within that roof)
   * and onto the nearest wall the light carries it to, within a few metres (kept within that face), each pixel darkened
   * once however many of its blocks overlap there.
   */
  private cast(vp: M4, bones: Bone[], sun: number[], shade: number[], n: number): void {
    const gl = this.gl, l = Math.hypot(sun[0], sun[1], sun[2]), L = [-sun[0] / l, -sun[1] / l, -sun[2] / l];
    const pm = bones.find((b) => b.name === 'pelvis')?.m ?? bones[0].m, px = pm[12], py = pm[13], pz = pm[14];
    const planes: { n: number[]; d: number; min: number[]; max: number[]; a: number }[] = [];
    // (the roof under it)
    const top = this.city.topAt(px, pz), gy = this.city.heightAt(px, pz);
    if (py - gy < 12) planes.push({ n: [0, 1, 0], d: gy, min: top ? [top.x0, gy - 0.1, top.z0] : [px - 30, gy - 0.1, pz - 30], max: top ? [top.x1, gy + 0.1, top.z1] : [px + 30, gy + 0.1, pz + 30], a: 1 });
    // (a wall the light carries it onto: along the light, the first face taller than the hips)
    const hl = Math.hypot(L[0], L[2]) || 1, hx = L[0] / hl, hz = L[2] / hl, drop = L[1] / hl;
    let wx = px, wz = pz;
    for (let d = 0.3; d <= 7; d += 0.15) {
      const x = px + hx * d, z = pz + hz * d, y = py + drop * d;
      if (this.city.heightAt(x, z) > y + 0.3) {
        // (which face: the way it was crossed)
        const b = this.city.boxesNear(x, z, 0.01).find((o) => x >= o.x0 && x < o.x1 && z >= o.z0 && z < o.z1 && o.y1 > y);
        if (b) {
          const fromX = wx < b.x0 ? -1 : wx >= b.x1 ? 1 : 0, fromZ = wz < b.z0 ? -1 : wz >= b.z1 ? 1 : 0;
          const nn = fromX ? [fromX, 0, 0] : [0, 0, fromZ || -Math.sign(hz)], dd = nn[0] ? (fromX < 0 ? b.x0 : b.x1) * nn[0] : (nn[2] < 0 ? b.z0 : b.z1) * nn[2];
          planes.push({ n: nn, d: dd, min: [b.x0 - 0.02, Math.max(b.y0, gy) - 0.02, b.z0 - 0.02], max: [b.x1 + 0.02, b.y1 + 0.02, b.z1 + 0.02], a: Math.max(0, 1 - d / 7) });
        }
        break;
      }
      wx = x; wz = z;
    }
    gl.useProgram(this.cprog); gl.uniformMatrix4fv(this.u.cuVP, false, vp); gl.uniform3f(this.u.cuL, L[0], L[1], L[2]);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    gl.enable(gl.STENCIL_TEST); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR); gl.bindVertexArray(this.fig.vao);
    planes.forEach((p) => {
      gl.clear(gl.STENCIL_BUFFER_BIT); gl.stencilFunc(gl.EQUAL, 0, 0xff);
      gl.uniform4f(this.u.cuPlane, p.n[0], p.n[1], p.n[2], p.d); gl.uniform3fv(this.u.cuMin, p.min); gl.uniform3fv(this.u.cuMax, p.max);
      gl.uniform4f(this.u.cuShade, shade[0], shade[1], shade[2], shade[3] * p.a);
      gl.drawArrays(gl.TRIANGLES, 0, n);
    });
    gl.disable(gl.STENCIL_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
  }

  /** Lines in the world, over the picture: plain where they can be seen, faint where something stands in front. */
  lines(vp: M4, eye: number[], strokes: Stroke[]): void {
    const gl = this.gl, o = this.ldata; let at = 0;
    const put = (x: number, y: number, z: number, c: number[], i: number) => { o[at++] = x; o[at++] = y; o[at++] = z; o[at++] = c[i]; o[at++] = c[i + 1]; o[at++] = c[i + 2]; o[at++] = c[i + 3]; };
    for (const s of strokes) {
      const n = s.pts.length / 3;
      for (let i = 0; i + 1 < n && at + 42 <= o.length; i++) {
        const ax = s.pts[i * 3], ay = s.pts[i * 3 + 1], az = s.pts[i * 3 + 2], bx = s.pts[i * 3 + 3], by = s.pts[i * 3 + 4], bz = s.pts[i * 3 + 5];
        // (across it: square to the line and to the way it's seen)
        const dx = bx - ax, dy = by - ay, dz = bz - az, vx = eye[0] - ax, vy = eye[1] - ay, vz = eye[2] - az;
        let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx; const l = Math.hypot(sx, sy, sz);
        if (l < 1e-9) continue;
        // (as wide as asked close to, and no thinner than that looks from six metres however far off it is)
        const w = (s.w / 2) * Math.max(1, Math.hypot(vx, vy, vz) / 6);
        sx *= w / l; sy *= w / l; sz *= w / l;
        const ca = i * 4, cb = i * 4 + 4;
        put(ax - sx, ay - sy, az - sz, s.cols, ca); put(ax + sx, ay + sy, az + sz, s.cols, ca); put(bx + sx, by + sy, bz + sz, s.cols, cb);
        put(ax - sx, ay - sy, az - sz, s.cols, ca); put(bx + sx, by + sy, bz + sz, s.cols, cb); put(bx - sx, by - sy, bz - sz, s.cols, cb);
      }
    }
    if (!at) return;
    gl.useProgram(this.lprog); gl.uniformMatrix4fv(this.u.luVP, false, vp);
    gl.bindVertexArray(this.lvao); gl.bindBuffer(gl.ARRAY_BUFFER, this.lbuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, o.subarray(0, at));
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.CULL_FACE); gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST); gl.uniform1f(this.u.luA, 0.22); gl.drawArrays(gl.TRIANGLES, 0, at / 7);
    gl.enable(gl.DEPTH_TEST); gl.uniform1f(this.u.luA, 1); gl.drawArrays(gl.TRIANGLES, 0, at / 7);
    gl.depthMask(true); gl.bindVertexArray(null);
  }
}

/** a 4×4 matrix's inverse (column-major), for the sky's rays */
export function invert(m: M4): Float32Array {
  const a = m, o = new Float32Array(16);
  const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
  const b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6], b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
  const b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06, k = det ? 1 / det : 0;
  o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * k; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * k; o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * k; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * k;
  o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * k; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * k; o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * k; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * k;
  o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * k; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * k; o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * k; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * k;
  o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * k; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * k; o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * k; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * k;
  return o;
}

/** the sun's shadow map's size, texels a side */
const SMAP = 2048;
/** an orthographic projection (column-major) */
function ortho(l: number, r: number, b: number, t: number, n: number, f: number): M4 {
  const o = new Float32Array(16); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o;
}

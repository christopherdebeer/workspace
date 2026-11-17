/**
 * Roof Jumps' renderer: deliberately the plainest one that shows the geometry. One program, one grey, one light, fog
 * to the page's colour. The geometry carries no look of its own (see mesh.ts), so everything about how it's drawn is
 * in this file's fragment shader, as a `look`:
 *
 *   grid     clay, with the lattice the city is built on drawn faintly over it (a metre, a storey): the default
 *   clay     flat grey, lit
 *   wire     every triangle's edges, nothing else
 *   tags     what each face is, as a colour
 *   normals  which way each face faces
 *
 * A new aesthetic is a new look here, or a new renderer over the same chunks and bones.
 */
import type { City } from './city';
import { CHUNK } from './city';
import { FIGURE, VERTEX, chunkMesh, figureMesh } from './mesh';
import type { Bone } from './rig';
import type { M4 } from './m4';

export const LOOKS = ['grid', 'clay', 'wire', 'tags', 'normals'] as const;
export type Look = (typeof LOOKS)[number];

const VS = `#version 300 es
in vec3 aPos; in vec3 aNor; in float aTag;
uniform mat4 uVP;
out vec3 vPos; flat out vec3 vNor; flat out float vTag; out vec3 vBary;
void main() {
  vPos = aPos; vNor = aNor; vTag = aTag;
  int k = gl_VertexID % 3; vBary = vec3(k == 0, k == 1, k == 2);
  gl_Position = uVP * vec4(aPos, 1.0);
}`;
const FS = `#version 300 es
precision highp float;
in vec3 vPos; flat in vec3 vNor; flat in float vTag; in vec3 vBary;
uniform vec3 uEye; uniform vec3 uFog; uniform float uFar; uniform int uLook;
out vec4 o;
float line(float x, float period) {
  float d = abs(fract(x / period + 0.5) - 0.5) * period, w = fwidth(x);
  return (1.0 - smoothstep(0.0, 1.5 * w, d)) * clamp(0.12 / w, 0.0, 1.0);
}
void main() {
  int tag = int(vTag + 0.5);
  vec3 n = normalize(vNor);
  float lit = 0.64 + 0.36 * dot(n, normalize(vec3(0.42, 0.8, 0.28)));
  float base = tag == 0 ? 0.40 : tag == 6 ? 0.13 : tag == 1 ? 0.74 : 0.69;
  vec3 col = vec3(base * lit);
  if (uLook == 0 && tag != 6) {
    // (the lattice: a metre across a top, a storey up a side and four metres along it)
    float g = abs(n.y) > 0.5 ? max(line(vPos.x, 1.0), line(vPos.z, 1.0)) * 0.5 + max(line(vPos.x, 4.0), line(vPos.z, 4.0)) * 0.5
      : max(line(vPos.y, 3.0), line(abs(n.x) > 0.5 ? vPos.z : vPos.x, 4.0));
    col *= 1.0 - 0.2 * g;
  } else if (uLook == 2) {
    vec3 w = fwidth(vBary), e = smoothstep(vec3(0.0), 1.2 * w, vBary);
    col = mix(vec3(0.12), uFog, min(e.x, min(e.y, e.z)));
  } else if (uLook == 3) {
    float h = float(tag) / 9.0;
    col = (0.55 + 0.45 * cos(6.2832 * (h + vec3(0.0, 0.33, 0.67)))) * lit;
  } else if (uLook == 4) col = n * 0.5 + 0.5;
  float dist = length(vPos - uEye);
  o = vec4(mix(col, uFog, smoothstep(uFar * 0.3, uFar, dist)), 1.0);
}`;
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
  /** how far is drawn, in chunks */
  radius = 4;
  fog: [number, number, number] = [0.8, 0.8, 0.79];
  private prog: WebGLProgram; private sprog: WebGLProgram; private lprog: WebGLProgram;
  private lvao: WebGLVertexArrayObject; private lbuf: WebGLBuffer; private ldata = new Float32Array(7 * 6 * 4096);
  private built = new Map<string, Built>();
  private fig: Built; private figData = new Float32Array(FIGURE); private disc: WebGLVertexArrayObject;
  private u: Record<string, WebGLUniformLocation | null> = {};
  tris = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly city: City) {
    const gl = canvas.getContext('webgl2', { antialias: true });
    if (!gl) throw new Error('WebGL2 is needed');
    this.gl = gl;
    this.prog = this.program(VS, FS); this.sprog = this.program(SVS, SFS);
    for (const n of ['uVP', 'uEye', 'uFog', 'uFar', 'uLook']) this.u[n] = gl.getUniformLocation(this.prog, n);
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
  }

  private program(vs: string, fs: string, attribs = ['aPos', 'aNor', 'aTag']): WebGLProgram {
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
    gl.bindVertexArray(null);
    return { vao, buf, n: data.length / VERTEX, cx, cz };
  }

  resize(): void {
    const d = Math.min(2, devicePixelRatio || 1), w = Math.round(this.canvas.clientWidth * d), h = Math.round(this.canvas.clientHeight * d);
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
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
    return n;
  }

  draw(vp: M4, eye: number[], bones: Bone[], shadow: { x: number; y: number; z: number; r: number; a: number }): void {
    const gl = this.gl, far = this.radius * CHUNK;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(this.fog[0], this.fog[1], this.fog[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uVP, false, vp); gl.uniform3f(this.u.uEye, eye[0], eye[1], eye[2]);
    gl.uniform3fv(this.u.uFog, this.fog); gl.uniform1f(this.u.uFar, far); gl.uniform1i(this.u.uLook, LOOKS.indexOf(this.look));
    this.tris = 0;
    for (const c of this.built.values()) { gl.bindVertexArray(c.vao); gl.drawArrays(gl.TRIANGLES, 0, c.n); this.tris += c.n / 3; }
    const n = figureMesh(bones, this.figData);
    gl.bindVertexArray(this.fig.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.fig.buf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.figData);
    gl.drawArrays(gl.TRIANGLES, 0, n); this.tris += n / 3;
    if (shadow.a > 0 && this.look !== 'wire') {
      gl.useProgram(this.sprog); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE);
      gl.uniformMatrix4fv(this.u.suVP, false, vp); gl.uniform4f(this.u.suAt, shadow.x, shadow.y + 0.03, shadow.z, shadow.r); gl.uniform1f(this.u.suA, shadow.a);
      gl.bindVertexArray(this.disc); gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true);
    }
    gl.bindVertexArray(null);
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

/**
 * What the anomalies' meshes share: the wood's projection in a vertex shader (render.ts: across
 * the screen the angle, up it the height over the horizontal distance — curved, so big faces are
 * cut small enough to bend with it), compiling a program against the wood's GLSL, and putting a
 * mesh on the GPU.
 */
import { DEPTH_RANGE } from '../mistwood/render';

export type V3 = [number, number, number];

/** the projection, as GLSL: `project(w)` sets gl_Position for a world point; vertices well
 *  behind you are put past the far plane (a small triangle there is dropped whole, rather than
 *  smeared across the screen where the angle wraps) */
export const PROJECT = `
uniform vec2 uRes;
uniform float uF, uHz;
uniform vec4 uCam;
float project(vec3 w) {
  vec3 rel = w - vec3(uCam.x, uCam.z, uCam.y);
  float cs = cos(uCam.w), sn = sin(uCam.w);
  float cx = rel.x * cs - rel.z * sn;
  float cz = rel.x * sn + rel.z * cs;
  float hd = max(length(vec2(cx, cz)), .02);
  float a = atan(cx, cz);
  vec2 scr = vec2(a * uF + .5 * uRes.x, rel.y / hd * uF + uHz);
  gl_Position = vec4(scr / uRes * 2. - 1., abs(a) > 2.2 ? 2. : clamp(hd / ${DEPTH_RANGE.toFixed(1)}, 0., 1.) * 2. - 1., 1.);
  return length(rel.xz);
}`;

export function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  // (the wood's sketch style is not drawn here: its switch is a constant)
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs.replace('uniform float uSketch;', 'const float uSketch = 0.;')));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}

/** a mesh's vertices, interleaved, `stride` floats each, the first three its position */
export class Builder {
  data: number[] = [];
  index: number[] = [];
  constructor(readonly stride: number) {}
  get count() { return this.data.length / this.stride; }
  vert(v: number[]) { for (let i = 0; i < this.stride; i++) this.data.push(v[i] ?? 0); return this.count - 1; }
  tri(a: number, b: number, c: number) { this.index.push(a, b, c); }
  /** a triangle, cut in four again and again until no edge is longer than `max` (m): its
   *  vertices' attributes interpolated */
  fine(a: number[], b: number[], c: number[], max: number) {
    const len = (p: number[], q: number[]) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const mid = (p: number[], q: number[]) => p.map((x, i) => (x + q[i]) / 2);
    if (Math.max(len(a, b), len(b, c), len(c, a)) <= max) { this.tri(this.vert(a), this.vert(b), this.vert(c)); return; }
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    this.fine(a, ab, ca, max); this.fine(ab, b, bc, max); this.fine(ca, bc, c, max); this.fine(ab, bc, ca, max);
  }
}

export interface Mesh { vao: WebGLVertexArrayObject; count: number; buffers: WebGLBuffer[] }
/** a mesh on the GPU: each attribute by name, size and offset (floats) */
export function upload(gl: WebGL2RenderingContext, p: WebGLProgram, b: Builder, attrs: Array<[string, number, number]>): Mesh {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(b.data), gl.STATIC_DRAW);
  for (const [name, size, off] of attrs) {
    const l = gl.getAttribLocation(p, name);
    if (l < 0) continue;
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, gl.FLOAT, false, b.stride * 4, off * 4);
    gl.vertexAttribDivisor(l, 0);
  }
  const ib = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(b.index), gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: b.index.length, buffers: [vb, ib] };
}
export function release(gl: WebGL2RenderingContext, m: Mesh) {
  gl.deleteVertexArray(m.vao);
  for (const b of m.buffers) gl.deleteBuffer(b);
}

export const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

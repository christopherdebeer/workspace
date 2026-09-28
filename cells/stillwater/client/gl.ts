/**
 * The smallest WebGL2 layer that keeps the passes readable: compile/link with
 * the source in the error, fullscreen triangle, instanced quads, render targets.
 * No scene graph — `main.ts` owns the frame and calls passes in order.
 */

export type GL = WebGL2RenderingContext;

export interface Program {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

function compile(gl: GL, type: number, src: string, name: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    const numbered = src.split('\n').map((l, i) => `${String(i + 1).padStart(3)} ${l}`).join('\n');
    throw new Error(`${name}: ${log}\n${numbered}`);
  }
  return sh;
}

/** Attribute locations are bound by name so every program agrees on them. */
export const ATTR: Record<string, number> = {
  aPos: 0,
  iA: 1,
  iB: 2,
  iC: 3,
  iD: 4,
};

export function program(gl: GL, name: string, vs: string, fs: string): Program {
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs, name + '.vs'));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs, name + '.fs'));
  for (const [n, loc] of Object.entries(ATTR)) gl.bindAttribLocation(prog, loc, n);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`${name}: ${gl.getProgramInfoLog(prog)}`);
  const u: Record<string, WebGLUniformLocation | null> = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i)!;
    const key = info.name.replace(/\[0\]$/, '');
    u[key] = gl.getUniformLocation(prog, info.name);
  }
  return { prog, u };
}

/** A unit quad (-1..1) as a triangle strip at attribute 0, plus up to four vec4 per-instance streams. */
export class Instanced {
  vao: WebGLVertexArrayObject;
  buf: WebGLBuffer;
  data: Float32Array;
  count = 0;
  constructor(private gl: GL, quad: WebGLBuffer, public capacity: number, public streams = 4) {
    this.vao = gl.createVertexArray()!;
    this.buf = gl.createBuffer()!;
    this.data = new Float32Array(capacity * streams * 4);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = streams * 16;
    for (let s = 0; s < streams; s++) {
      gl.enableVertexAttribArray(1 + s);
      gl.vertexAttribPointer(1 + s, 4, gl.FLOAT, false, stride, s * 16);
      gl.vertexAttribDivisor(1 + s, 1);
    }
    gl.bindVertexArray(null);
  }
  /** Write instance i's streams (each a 4-tuple). */
  set(i: number, ...vals: number[]) {
    this.data.set(vals, i * this.streams * 4);
  }
  upload() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * this.streams * 4);
  }
  draw() {
    if (!this.count) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
  }
}

export function quadBuffer(gl: GL): WebGLBuffer {
  const b = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  return b;
}

/** A VAO with just the unit quad — fullscreen passes draw it once. */
export function quadVao(gl: GL, quad: WebGLBuffer): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

export interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export function renderTarget(
  gl: GL,
  w: number,
  h: number,
  opts: { internal?: number; format?: number; type?: number; filter?: number; wrap?: number } = {},
): Target {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    opts.internal ?? gl.RGBA8,
    w,
    h,
    0,
    opts.format ?? gl.RGBA,
    opts.type ?? gl.UNSIGNED_BYTE,
    null,
  );
  const f = opts.filter ?? gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  const wrap = opts.wrap ?? gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  const fb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) {
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    throw new Error(`framebuffer ${w}x${h} incomplete`);
  }
  return { fb, tex, w, h };
}

export function dropTarget(gl: GL, t: Target | null) {
  if (!t) return;
  gl.deleteFramebuffer(t.fb);
  gl.deleteTexture(t.tex);
}

export function bindTarget(gl: GL, t: Target | null, canvasW: number, canvasH: number) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
  gl.viewport(0, 0, t ? t.w : canvasW, t ? t.h : canvasH);
}

export function bindTex(gl: GL, unit: number, tex: WebGLTexture) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
}

/**
 * A tileable noise texture built once on the CPU: R/G two octaved value noises,
 * B a cellular (Worley) field, A white noise. Tileable so world coordinates can
 * sample it with REPEAT forever without seams.
 */
export function noiseTexture(gl: GL, size = 256): WebGLTexture {
  let s = 1234567;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const lattice = (n: number) => Float32Array.from({ length: n * n }, rnd);
  const value = (grid: Float32Array, n: number, x: number, y: number) => {
    const fx = (x / size) * n;
    const fy = (y / size) * n;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const g = (i: number, j: number) => grid[((j + n) % n) * n + ((i + n) % n)];
    const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
    const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  const octaves = (seedGrids: Array<[Float32Array, number]>, x: number, y: number) => {
    let v = 0;
    let amp = 0.5;
    let tot = 0;
    for (const [grid, n] of seedGrids) {
      v += value(grid, n, x, y) * amp;
      tot += amp;
      amp *= 0.5;
    }
    return v / tot;
  };
  const gridsA: Array<[Float32Array, number]> = [4, 8, 16, 32, 64].map((n) => [lattice(n), n]);
  const gridsB: Array<[Float32Array, number]> = [4, 8, 16, 32, 64].map((n) => [lattice(n), n]);
  const cells = 24;
  const pts = Array.from({ length: cells * cells }, (_, i) => [((i % cells) + rnd()) / cells, (Math.floor(i / cells) + rnd()) / cells]);
  const px = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      px[i] = Math.round(octaves(gridsA, x, y) * 255);
      px[i + 1] = Math.round(octaves(gridsB, x, y) * 255);
      const u = x / size;
      const v = y / size;
      const cx = Math.floor(u * cells);
      const cy = Math.floor(v * cells);
      let d = 9;
      for (let j = -1; j <= 1; j++)
        for (let k = -1; k <= 1; k++) {
          const gx = cx + k;
          const gy = cy + j;
          // Neighbours past the edge are the wrapped cell's point, shifted a tile over.
          const p = pts[((gy + cells) % cells) * cells + ((gx + cells) % cells)];
          const dx = u - (p[0] + (gx < 0 ? -1 : gx >= cells ? 1 : 0));
          const dy = v - (p[1] + (gy < 0 ? -1 : gy >= cells ? 1 : 0));
          d = Math.min(d, Math.hypot(dx, dy) * cells);
        }
      px[i + 2] = Math.round(Math.min(1, d) * 255);
      px[i + 3] = Math.round(rnd() * 255);
    }
  }
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return tex;
}

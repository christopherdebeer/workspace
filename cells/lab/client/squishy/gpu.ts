/**
 * The card: the canvas's WebGL2 context, whether it draws in HDR, the programs (compiled once, from shaders.ts) and
 * their uniforms, and meshes put on it (`upload`, `drop`).
 */
import { params, preview, FAST } from './env';
import { VSTRIDE } from './mesh';
import { VS, FS, BACK_FS, BLUR_FS, BRIGHT_FS, BUBBLE_FS, DOUGH_FS, DOUGH_VS, FINISH_FS, GLITTER_FS, GLITTER_VS, JELLY_FS, PUFF_FS, PUFF_VS, QUAD_VS, SHADOW_FS, SHADOW_VS, SKY_FS, SKY_VS } from './shaders';

export const canvas = document.getElementById('play') as HTMLCanvasElement;
// (no antialiasing of the canvas itself: the scene's drawn into a multisampled target of its own, and only the finish goes on the canvas)
export const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })!;
if (!gl) throw new Error('WebGL2 is needed');
/**
 * Light in linear values, as it adds up, in a half-float target, tonemapped once at the end with what's
 * brightest blooming: if the card can draw into floats (?ldr: as before, each thing tonemapped as drawn).
 */
export const HDR = !!gl.getExtension('EXT_color_buffer_float') && !params.has('ldr');
export const SHADOW = preview ? 1024 : FAST ? 512 : 2048;

export function program(vs: string, fs: string): WebGLProgram {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, HDR ? src.replace('#version 300 es', '#version 300 es\n#define HDR 1') : src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const p = gl.createProgram()!;
  // (the skin's attributes in fixed places, so one vertex array serves the dough's and the jelly's drawing)
  if (vs === DOUGH_VS) { gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aNor'); gl.bindAttribLocation(p, 2, 'aRest'); gl.bindAttribLocation(p, 3, 'aCoat'); gl.bindAttribLocation(p, 4, 'aSkin'); }
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  return p;
}
export const skyProg = program(SKY_VS, SKY_FS);
export const shadowProg = program(SHADOW_VS, SHADOW_FS);
export const prog = program(VS, FS);
// (what isn't baked (the dots, the jellies' tops, the lids) is open, and throws nothing)
{ const bl = gl.getAttribLocation(prog, 'aBake'); if (bl >= 0) gl.vertexAttrib4f(bl, 0, 0, 0, 0); }
export const doughProg = program(DOUGH_VS, DOUGH_FS);
export const jellyProg = program(DOUGH_VS, JELLY_FS);
export const glitterProg = program(GLITTER_VS, GLITTER_FS);
export const puffProg = program(PUFF_VS, PUFF_FS);
export const brightProg = program(QUAD_VS, BRIGHT_FS), blurProg = program(QUAD_VS, BLUR_FS), finishProg = program(QUAD_VS, FINISH_FS);
export const backProg = HDR ? program(DOUGH_VS, BACK_FS) : null;
export const bubbleProg = program(VS, BUBBLE_FS);
const ul = new Map<string, WebGLUniformLocation | null>();
export const u = (p: WebGLProgram, n: string) => {
  const k = `${(p as { __id?: number }).__id ??= Math.random()}:${n}`;
  if (!ul.has(k)) ul.set(k, gl.getUniformLocation(p, n));
  return ul.get(k)!;
};

// ─── meshes on the card ──────────────────────────────────────────────────────────────────────────
export interface Mesh { vao: WebGLVertexArrayObject; svao: WebGLVertexArrayObject; buf: WebGLBuffer; bbuf?: WebGLBuffer | null; dbuf?: WebGLBuffer | null; count: number }
/** A mesh on the card: its vertices; what's baked into each, if any; and, if it deforms, a buffer of how (two a vertex, see jelMesh). */
export function upload(verts: number[] | Float32Array, usage: number = gl.STATIC_DRAW, baked: Float32Array | null = null, def: Float32Array | null = null): Mesh {
  const data = verts instanceof Float32Array ? verts : new Float32Array(verts);
  const dbuf = def ? gl.createBuffer()! : null;
  if (dbuf) { gl.bindBuffer(gl.ARRAY_BUFFER, dbuf); gl.bufferData(gl.ARRAY_BUFFER, def!, gl.DYNAMIC_DRAW); }
  const bbuf = baked ? gl.createBuffer()! : null;
  if (bbuf) { gl.bindBuffer(gl.ARRAY_BUFFER, bbuf); gl.bufferData(gl.ARRAY_BUFFER, baked!, gl.STATIC_DRAW); }
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  const make = (p: WebGLProgram, attrs: Array<[string, number, number]>) => {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [name, size, off] of attrs) {
      const loc = gl.getAttribLocation(p, name);
      if (loc < 0) continue;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, VSTRIDE * 4, off * 4);
    }
    // (what's baked into it, from its own buffer)
    const bl = p === prog && bbuf ? gl.getAttribLocation(p, 'aBake') : -1;
    if (bl >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, bbuf); gl.enableVertexAttribArray(bl); gl.vertexAttribPointer(bl, 4, gl.FLOAT, false, 0, 0); }
    const dl = p === prog && dbuf ? gl.getAttribLocation(p, 'aDef') : -1;
    if (dl >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, dbuf); gl.enableVertexAttribArray(dl); gl.vertexAttribPointer(dl, 2, gl.FLOAT, false, 0, 0); }
    gl.bindVertexArray(null);
    return vao;
  };
  return { vao: make(prog, [['aPos', 3, 0], ['aNor', 3, 3], ['aMat', 1, 6], ['aUV', 2, 7]]), svao: make(shadowProg, [['aPos', 3, 0]]), buf, bbuf, dbuf, count: data.length / VSTRIDE };
}
export function drop(m: Mesh | null) {
  if (!m) return;
  gl.deleteBuffer(m.buf); if (m.bbuf) gl.deleteBuffer(m.bbuf); if (m.dbuf) gl.deleteBuffer(m.dbuf); gl.deleteVertexArray(m.vao); gl.deleteVertexArray(m.svao);
}

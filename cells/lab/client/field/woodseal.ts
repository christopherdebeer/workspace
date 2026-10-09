/**
 * The seals in the wood: each anomaly's own seal (emblem.ts), drawn in light into Mistwood's scene
 * — inscribed on the ground about it (its ward, the seal twenty-odd metres across, following the
 * lie of the land under the litter and grass), and standing in the air at the ward's edge, one by
 * the path where it passes. Light, nothing solid: hairlines and their glow, added to what is there.
 * They are in the wood, not over it: a tree or the anomaly itself in front hides them (they test
 * the depth it wrote; drawn in their place among the trees), the fog and the mist take them, and
 * they are not seen far off at all — they come up out of the dark as you come near, the near part
 * of a ward first. Their detail follows their size as seen: the construction a way off, the fine
 * fill close to (two pictures of the seal, cross-faded by distance, each mipmapped).
 */
import { WOOD_GLSL, type WoodEnv } from '../mistwood/render';
import { PROJECT, program, upload, Builder, type Mesh } from './mesh';
import { findSeal } from './emblem';
import type { Find } from './finds';

/** the seals' light (linear rgb): the warm white of the seals drawn in light */
export const SEAL_LIGHT: [number, number, number] = [1.15, 0.98, 0.72];
/** the ward's radius, as a share of the anomaly's reach (its rim; the picture reaches 62/50 of it) */
export const WARD = 0.56;
/** a standing seal: its diameter and the height of its middle (m) */
export const STAND = { size: 1.9, at: 1.75 };

const VS = `#version 300 es
in vec3 aP;
in vec2 aUV;
uniform vec3 uAnchor;
uniform vec3 uRight;
uniform float uSize;
${PROJECT}
out vec3 vWorld;
out vec2 vUV;
out float vDist;
void main() {
  // the ward: its own points on the ground; a standing seal: a square turned to face its way
  vWorld = uSize > 0. ? uAnchor + uRight * aP.x * uSize + vec3(0., aP.y * uSize, 0.) : uAnchor + aP;
  vDist = project(vWorld);
  vUV = aUV;
}`;
const FS = () => `#version 300 es
precision highp float;
precision highp int;
in vec3 vWorld;
in vec2 vUV;
in float vDist;
out vec4 o;
uniform float uDensity;
${WOOD_GLSL()}
uniform sampler2D uFine, uCoarse;
uniform vec3 uSealLight;
uniform vec4 uRange; // fine until, coarse from (m); seen until, gone by (m)
uniform float uAmount;
void main() {
  float d = length(vWorld - vec3(uCam.x, uCam.z, uCam.y));
  float vis = 1. - smoothstep(uRange.z, uRange.w, d);
  if (vis <= 0.) discard;
  float fine = 1. - smoothstep(uRange.x, uRange.y, d);
  float a = mix(texture(uCoarse, vUV).a, texture(uFine, vUV).a, fine);
  float fog = 1. - (1. - fogAt(vDist, vWorld.y - uBase, uDensity)) * (1. - mistTo(vWorld));
  // (breathing a little, a slow wave of light passing over it)
  float k = a * vis * (1. - fog) * uAmount * (.82 + .18 * sin(uT * 1.1 - d * .25));
  if (k < .002) discard;
  o = vec4(uSealLight * k, 0.);
}`;

// ─── the pictures: each seal drawn in white hairlines with their glow ─────────────────────────────
/** a seal's SVG as a picture of light: every line white, every fill gone; blurred twice under
 *  itself for its glow (a wide soft one, a near one) */
async function glowCanvas(svg: string, px: number, line: number): Promise<HTMLCanvasElement> {
  const style = `<style>*{fill:none!important;stroke:#fff!important;stroke-width:${line}px!important;vector-effect:non-scaling-stroke}text{fill:none!important;stroke:#fff!important}</style>`;
  const doc = svg.replace('<svg ', `<svg width="${px}" height="${px}" `).replace('aria-hidden="true">', `aria-hidden="true">${style}`);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(doc);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const x = c.getContext('2d')!;
  x.filter = `blur(${(px / 120).toFixed(1)}px)`;
  x.globalAlpha = 0.6;
  x.drawImage(img, 0, 0, px, px);
  x.filter = `blur(${(px / 500).toFixed(1)}px)`;
  x.globalAlpha = 0.85;
  x.drawImage(img, 0, 0, px, px);
  x.filter = 'none';
  x.globalAlpha = 1;
  x.drawImage(img, 0, 0, px, px);
  return c;
}
interface Art { coarse: HTMLCanvasElement | null; fine: HTMLCanvasElement | null }
const arts = new Map<string, Art>();
const queue: Array<() => Promise<void>> = [];
let running = false;
const idle = () => new Promise<void>((res) => setTimeout(res, 30));
async function run() {
  if (running) return;
  running = true;
  while (queue.length) {
    try { await queue.shift()!(); } catch (e) { console.error('field: a seal did not draw', String(e)); }
    await idle();
  }
  running = false;
}
/** a find's seal pictures, made in the background (null until they are) */
export function sealArt(f: Find): Art {
  const key = `${f.kind}:${f.seed}`;
  let a = arts.get(key);
  if (!a) {
    const art: Art = { coarse: null, fine: null };
    arts.set(key, art);
    a = art;
    queue.push(async () => { art.coarse = await glowCanvas(findSeal(f.kind, f.seed, 1), 1024, 1.8); });
    queue.push(async () => { art.fine = await glowCanvas(findSeal(f.kind, f.seed, 3), 2048, 2.2); });
    void run();
  }
  return a;
}

// ─── on the GPU ──────────────────────────────────────────────────────────────────────────────
interface Gpu { p: WebGLProgram; stand: Mesh; tex: Map<string, { coarse: WebGLTexture; fine: WebGLTexture }>; wards: Map<string, Mesh>; aniso: number }
const gpus = new WeakMap<WebGL2RenderingContext, Gpu>();
function gpu(gl: WebGL2RenderingContext): Gpu {
  let g = gpus.get(gl);
  if (g) return g;
  const p = program(gl, VS, FS());
  // a standing seal: a grid (the projection is curved), its middle at 0
  const b = new Builder(5);
  const N = 10;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const v = (s: number, t: number) => b.vert([s - 0.5, t - 0.5, 0, s, 1 - t]);
    const a = v(i / N, j / N), c = v((i + 1) / N, j / N), d = v(i / N, (j + 1) / N), e = v((i + 1) / N, (j + 1) / N);
    b.tri(a, c, d); b.tri(c, e, d);
  }
  const ext = gl.getExtension('EXT_texture_filter_anisotropic');
  g = { p, stand: upload(gl, p, b, [['aP', 3, 0], ['aUV', 2, 3]]), tex: new Map(), wards: new Map(), aniso: ext ? Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 0 };
  gpus.set(gl, g);
  return g;
}
function texFrom(gl: WebGL2RenderingContext, c: HTMLCanvasElement, aniso: number): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, 0x84fe /* TEXTURE_MAX_ANISOTROPY_EXT */, aniso);
  return t;
}
/** the find's textures in this context, once its pictures are made */
function textures(gl: WebGL2RenderingContext, g: Gpu, f: Find) {
  const key = `${f.kind}:${f.seed}`;
  let t = g.tex.get(key);
  if (t) return t;
  const a = sealArt(f);
  if (!a.coarse || !a.fine) return null;
  t = { coarse: texFrom(gl, a.coarse, g.aniso), fine: texFrom(gl, a.fine, g.aniso) };
  g.tex.set(key, t);
  return t;
}
/** the ward's mesh: a grid over the ground under the seal (the corners outside it left out),
 *  each point on the ground there, a hand's breadth up */
function wardMesh(gl: WebGL2RenderingContext, g: Gpu, f: Find, ground: (x: number, z: number) => number): Mesh {
  const key = `${f.kind}:${f.seed}`;
  let m = g.wards.get(key);
  if (m) return m;
  const E = f.reach * WARD * (62 / 50);
  const N = 120;
  const g0 = ground(f.x, f.z);
  const b = new Builder(5);
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const x = (i / N - 0.5) * 2 * E, z = (j / N - 0.5) * 2 * E;
    idx.push(b.vert([x, ground(f.x + x, f.z + z) - g0 + 0.05, z, i / N, 1 - j / N]));
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const cx = ((i + 0.5) / N - 0.5) * 2, cz = ((j + 0.5) / N - 0.5) * 2;
    if (Math.hypot(cx, cz) > 0.84) continue;
    const a = i * (N + 1) + j, c = (i + 1) * (N + 1) + j;
    b.tri(a, c, a + 1); b.tri(c, c + 1, a + 1);
  }
  m = upload(gl, g.p, b, [['aP', 3, 0], ['aUV', 2, 3]]);
  g.wards.set(key, m);
  return m;
}

function begin(env: WoodEnv, g: Gpu, t: { coarse: WebGLTexture; fine: WebGLTexture }) {
  const { gl } = env;
  gl.useProgram(g.p);
  env.common(g.p);
  const u = (n: string) => gl.getUniformLocation(g.p, n);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, t.coarse);
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, t.fine);
  gl.uniform1i(u('uCoarse'), 1);
  gl.uniform1i(u('uFine'), 2);
  gl.uniform3fv(u('uSealLight'), SEAL_LIGHT);
  gl.uniform2fv(u('uMistT'), env.mist);
  gl.uniform1f(u('uTopH'), env.top);
  gl.uniform1f(u('uBase'), env.base);
  return u;
}
/** the ward: the seal inscribed on the ground about the anomaly (a CustomDraw at its heart) */
export function drawWard(env: WoodEnv, f: Find, ground: (x: number, z: number) => number) {
  const { gl } = env;
  const g = gpu(gl);
  const t = textures(gl, g, f);
  if (!t) return;
  const m = wardMesh(gl, g, f, ground);
  const u = begin(env, g, t);
  gl.uniform3f(u('uAnchor'), f.x, env.base, f.z);
  gl.uniform1f(u('uSize'), 0);
  gl.uniform4f(u('uRange'), 6, 13, 13, 26);
  gl.uniform1f(u('uAmount'), 0.85);
  gl.bindVertexArray(m.vao);
  gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
  gl.activeTexture(gl.TEXTURE0);
}
/** a standing seal: in the air at (x, z), its face turned along `face` (a CustomDraw there) */
export function drawStanding(env: WoodEnv, f: Find, x: number, z: number, face: [number, number]) {
  const { gl } = env;
  const g = gpu(gl);
  const t = textures(gl, g, f);
  if (!t) return;
  const u = begin(env, g, t);
  gl.uniform3f(u('uAnchor'), x, env.base + STAND.at, z);
  gl.uniform3f(u('uRight'), face[1], 0, -face[0]);
  gl.uniform1f(u('uSize'), STAND.size);
  gl.uniform4f(u('uRange'), 4, 10, 16, 30);
  gl.uniform1f(u('uAmount'), 1);
  gl.bindVertexArray(g.stand.vao);
  gl.drawElements(gl.TRIANGLES, g.stand.count, gl.UNSIGNED_INT, 0);
  gl.activeTexture(gl.TEXTURE0);
}

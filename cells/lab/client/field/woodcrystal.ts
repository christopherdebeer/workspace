/**
 * Crystals in the wood: the Crystals ray tracer itself, on its own small WebGL context, in its
 * cut-out mode (the specimen alone, on transparency), its camera put where your eye is relative
 * to the specimen — every frame, so walking round it, it turns, and from above you look down on it
 * — with its field of view fitted to the specimen. Its picture is set into Mistwood's scene (a
 * CustomDraw) where the specimen stands, behind what is nearer, in front of what is farther, in
 * the wood's fog.
 *
 * (Its own context, not the wood's: on the software renderer the lab's tests use, ray tracing in
 * or beside the wood's context with a new shader path lost the context; the Crystals page's own
 * path, used as it is, does not.)
 */
import { createCrystalEngine, type CrystalEngine } from '../crystals/engine';
import { DEPTH_RANGE, type WoodEnv } from '../mistwood/render';

const VS = `#version 300 es
uniform vec4 uRect; uniform vec2 uRes; out vec2 vC;
void main() {
  vec2 c = vec2(gl_VertexID == 1 || gl_VertexID == 4 || gl_VertexID == 5 ? 1. : 0., gl_VertexID == 2 || gl_VertexID == 3 || gl_VertexID == 5 ? 1. : 0.);
  vC = c;
  gl_Position = vec4((uRect.xy + c * uRect.zw) / uRes * 2. - 1., 0., 1.);
}`;
const FS = `#version 300 es
precision highp float;
in vec2 vC;
uniform sampler2D uTex;
uniform float uDepth, uFog;
uniform vec3 uFogCol;
out vec4 o;
void main() {
  vec4 t = texture(uTex, vec2(vC.x, 1. - vC.y));
  if (t.a < .02) discard;
  gl_FragDepth = uDepth;
  // (premultiplied: the fog takes its share of what is there)
  o = vec4(mix(t.rgb, uFogCol * t.a, uFog), t.a);
}`;

export interface WoodCrystals { draw: (env: WoodEnv, at: { x: number; z: number; seed: number }) => void }
/** the crystal drawer, or null where a second WebGL context cannot be had */
export function woodCrystals(opts: { scale: number; px?: number }): WoodCrystals | null {
  const PX = opts.px ?? 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PX;
  const cg = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, preserveDrawingBuffer: true });
  if (!cg) return null;
  let engine: CrystalEngine;
  try { engine = createCrystalEngine(cg, { quality: 'low', still: true, cut: true }); } catch (e) { console.warn('field: crystals', e); return null; }
  const progs = new WeakMap<WebGL2RenderingContext, { p: WebGLProgram; tex: WebGLTexture }>();
  const compositeFor = (gl: WebGL2RenderingContext) => {
    let c = progs.get(gl);
    if (c) return c;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader'); return s; };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    c = { p, tex };
    progs.set(gl, c);
    return c;
  };
  const fogAt = (d: number, above: number, density: number) => { const path = d * 0.55 + (d * d) / 40; const sm = Math.min(1, Math.max(0, (d - 5) / 15)); return 1 - Math.exp(-density * path * (1 + 1.1 * Math.exp(-Math.max(above, 0) * 0.35) * sm * sm * (3 - 2 * sm))); };
  return {
    draw(env, at) {
      const { gl, view: v } = env;
      const A = env.look.atmos;
      if (engine.seed !== at.seed) engine.grow(at.seed);
      const turn = (at.seed % 628) / 100, S = opts.scale;
      // the specimen's middle, in the wood
      const C = engine.centre;
      const mid = [at.x + C[0] * S, env.base + C[1] * S, at.z + C[2] * S];
      // your eye, in the specimen's own units and turn: the Crystals camera put there
      const ex = (v.x - at.x) / S, ey = (v.eye - env.base) / S, ez = (v.z - at.z) / S;
      const ct = Math.cos(-turn), st = Math.sin(-turn);
      const ux = ex * ct - ez * st - C[0], uy = ey - C[1], uz = ex * st + ez * ct - C[2];
      const D = Math.hypot(ux, uy, uz);
      const reach = engine.reach * 1.25;
      // where its middle falls on the wood's screen (GL pixels, y up), and how far off it is
      const rx = mid[0] - v.x, rz = mid[2] - v.z;
      const cs = Math.cos(v.yaw), sn = Math.sin(v.yaw);
      const cx = rx * cs - rz * sn, cz = rx * sn + rz * cs;
      const hd = Math.hypot(cx, cz);
      if (cz < 0.05 || hd < 0.15) return;
      const sx = Math.atan2(cx, cz) * v.f + env.W / 2, sy = ((mid[1] - v.eye) / hd) * v.f + v.horizon;
      // the field of view: the specimen's reach as seen from here (tangent of the half-height)
      const fov = Math.min(3, (reach * S * 1.6) / Math.max(0.05, D * S - reach * S * 0.5));
      // (its picture's half-height at the specimen's distance, on the wood's screen)
      const half = ((fov * 0.5 * D * S) / hd) * v.f;
      if (sx + half < 0 || sx - half > env.W || sy + half < 0 || sy - half > env.H) return;
      // the Crystals' own frame, from there (its light from the wood's sun)
      engine.frame({ az: Math.atan2(ux, uz), el: Math.asin(Math.max(-1, Math.min(1, uy / D))), dist: D / engine.reach, fov, lightAz: A.at[0] - turn }, PX, PX);
      const c = compositeFor(gl);
      gl.useProgram(c.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, c.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      const dist = Math.hypot(at.x - v.x, at.z - v.z);
      const fog = 1 - (1 - fogAt(dist, 0.2, env.look.density)) * Math.exp(-(env.mist[0] + env.mist[1]) / 2);
      gl.uniform1i(gl.getUniformLocation(c.p, 'uTex'), 0);
      gl.uniform4f(gl.getUniformLocation(c.p, 'uRect'), sx - half, sy - half, 2 * half, 2 * half);
      gl.uniform2f(gl.getUniformLocation(c.p, 'uRes'), env.W, env.H);
      gl.uniform1f(gl.getUniformLocation(c.p, 'uDepth'), Math.min(1, Math.max(0, hd / DEPTH_RANGE)));
      gl.uniform1f(gl.getUniformLocation(c.p, 'uFog'), fog);
      gl.uniform3fv(gl.getUniformLocation(c.p, 'uFogCol'), A.fogLow);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
  };
}

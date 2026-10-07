/**
 * Mushrooms in the wood as real geometry: a cluster of the find's species (the Hat-throwers'
 * capped forms, fungi/genome.ts — its heights, bells, colours, pleats, ink and slime) built as
 * meshes — each stalk a tapering, leaning tube, each cap a surface of revolution (an inkcap's
 * pleated bell inking at the rim, a mottlegill's cone with its gills showing, a fieldcap's flared
 * slimy dome over its gills) — and drawn into Mistwood's scene (render.ts CustomDraw) in the wood's
 * own projection, light, fog and mist, writing its depth so grass and trees pass in front of it.
 */
import { hash, seeded } from '../kit/rng';
import { DEPTH_RANGE, WOOD_GLSL, type WoodEnv } from '../mistwood/render';
import type { Genome, V3 } from '../fungi/genome';
import { mushroomSpecies } from './mushrooms';

const VS = `#version 300 es
in vec3 aP;
in vec3 aN;
in vec4 aC;   // colour, part (0 stalk, 1 cap, 2 gills)
in vec2 aUV;  // along the cap (0 crown … 1 rim), round it (radians)
uniform vec2 uRes;
uniform float uF, uHz;
uniform vec4 uCam;
uniform vec3 uAnchor;
uniform float uTurn;
out vec3 vWorld;
out vec3 vN;
out vec4 vC;
out vec2 vUV;
out float vDist;
vec3 turnY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.z * s, v.y, v.x * s + v.z * c); }
void main() {
  vec3 w = uAnchor + turnY(aP, uTurn);
  vec3 rel = w - vec3(uCam.x, uCam.z, uCam.y);
  float cs = cos(uCam.w), sn = sin(uCam.w);
  float cx = rel.x * cs - rel.z * sn;
  float cz = rel.x * sn + rel.z * cs;
  float hd = max(length(vec2(cx, cz)), .02);
  vec2 scr = vec2(atan(cx, cz) * uF + .5 * uRes.x, rel.y / hd * uF + uHz);
  gl_Position = vec4(scr / uRes * 2. - 1., clamp(hd / ${DEPTH_RANGE.toFixed(1)}, 0., 1.) * 2. - 1., 1.);
  vWorld = w;
  vN = turnY(aN, uTurn);
  vC = aC;
  vUV = aUV;
  vDist = length(rel.xz);
}`;
const FS = () => `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
in vec3 vWorld;
in vec3 vN;
in vec4 vC;
in vec2 vUV;
in float vDist;
uniform vec2 uRes;
uniform float uF, uHz, uDensity;
${WOOD_GLSL()}
uniform float uPleats, uInk, uSlime, uForm;
void main() {
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1. : -1.);
  vec3 V = normalize(vec3(uCam.x, uCam.z, uCam.y) - vWorld);
  if (dot(N, V) < 0.) N = -N;
  vec3 L = vec3(sin(uSun.x) * cos(uSun.y), sin(uSun.y), cos(uSun.x) * cos(uSun.y));
  vec3 base = vC.rgb;
  float part = vC.a;
  if (part > .5 && part < 1.5) {
    // a cap: an inkcap's pleats and its rim going to ink; a mottlegill's blotches
    if (uForm < .5) {
      float pl = .5 + .5 * cos(vUV.y * uPleats);
      base *= .78 + .22 * pl;
      base = mix(base, vec3(.07, .06, .055), smoothstep(1. - uInk * .55, 1., vUV.x) * .9);
    } else if (uForm < 1.5) {
      base *= .82 + .18 * vnoise(vec2(vUV.y * 3., vUV.x * 5.) + 17.);
    }
  }
  // lit as the wood is: wrapped key light, the fog's light from where it faces, a little through
  float wrap = max(dot(N, L) * .6 + .4, 0.);
  vec3 amb = fogDir(N) * .55;
  float thin = part > .5 && part < 1.5 ? .25 * max(dot(-N, L), 0.) : 0.;
  vec3 col = base * (uIllum * (.35 + .75 * wrap + thin) + amb * .6);
  // a slimy cap catches the light
  vec3 H = normalize(L + V);
  if (part > .5 && part < 1.5) col += uIllum * uSlime * .9 * pow(max(dot(N, H), 0.), 60.);
  float fogD = fogAt(vDist, vWorld.y - uBase, uDensity);
  float fog = 1. - (1. - fogD) * (1. - mistTo(vWorld));
  o = vec4(mix(col, fogToward(vWorld), fog), 1.);
}`;

interface Mesh { vao: WebGLVertexArrayObject; count: number; g: Genome; top: number }
const progs = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
const meshes = new WeakMap<WebGL2RenderingContext, Map<number, Mesh>>();
function program(gl: WebGL2RenderingContext): WebGLProgram {
  let p = progs.get(gl);
  if (p) return p;
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader'); return s; };
  p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS().replace('uniform float uSketch;', 'const float uSketch = 0.;')));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  progs.set(gl, p);
  return p;
}

/** the cluster's geometry, in metres from its foot: interleaved position, normal, colour+part, uv */
export function clusterGeometry(seed: number): { data: Float32Array; index: Uint32Array; g: Genome; top: number } {
  const g = mushroomSpecies(seed);
  const r = seeded(hash(seed, 0x3d));
  const k = Math.max(1, 90 / g.height[1]) / 1000;
  const n = Math.max(2, Math.min(g.form === 'inkcap' ? 7 : 5, Math.round(g.count * (g.form === 'inkcap' ? 0.3 : 0.8))));
  const bellR = g.bell * k;
  const data: number[] = [];
  const index: number[] = [];
  let top = 0;
  const vert = (p: V3, nn: V3, c: V3, part: number, u: number, a: number) => { data.push(p[0], p[1], p[2], nn[0], nn[1], nn[2], c[0], c[1], c[2], part, u, a); return data.length / 12 - 1; };
  const norm = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const spread = Math.max(0.03, bellR * 2.2);
  for (let m = 0; m < n; m++) {
    const ang = r() * Math.PI * 2, rad = Math.sqrt(r()) * spread * (n > 3 ? 1.2 : 0.8);
    const fx = Math.cos(ang) * rad, fz = Math.sin(ang) * rad;
    const age = 0.55 + 0.45 * r();
    const H = (g.height[0] + (g.height[1] - g.height[0]) * r()) * k;
    const lean = (r() - 0.5) * g.lean * 0.8, lAz = r() * Math.PI * 2;
    const tip: V3 = [fx + Math.sin(lean) * H * Math.cos(lAz), H * Math.cos(lean * 0.5), fz + Math.sin(lean) * H * Math.sin(lAz)];
    top = Math.max(top, tip[1] + bellR);
    // the stalk: a tube along a gentle curve, tapering up
    const sr = Math.max(0.0012, g.radius * k * 1.3);
    const RINGS = 7, SIDES = 8;
    const ring0 = data.length / 12;
    for (let i = 0; i <= RINGS; i++) {
      const t = i / RINGS;
      const c: V3 = [fx + (tip[0] - fx) * t * t, H * t * (tip[1] / H), fz + (tip[2] - fz) * t * t];
      const rr = sr * (1.25 - 0.4 * t);
      for (let j = 0; j < SIDES; j++) {
        const a = (j / SIDES) * Math.PI * 2;
        const nn: V3 = [Math.cos(a), 0.1, Math.sin(a)];
        const shade = 0.88 + 0.12 * t;
        vert([c[0] + Math.cos(a) * rr, c[1], c[2] + Math.sin(a) * rr], nn, [g.glass[0] * shade, g.glass[1] * shade, g.glass[2] * shade * 0.97], 0, t, a);
      }
    }
    for (let i = 0; i < RINGS; i++) for (let j = 0; j < SIDES; j++) {
      const a = ring0 + i * SIDES + j, b = ring0 + i * SIDES + ((j + 1) % SIDES), c2 = a + SIDES, d = b + SIDES;
      index.push(a, b, c2, b, d, c2);
    }
    // the cap: a profile turned round the stalk's top
    const R = bellR * (0.75 + 0.35 * age);
    const Hc = R * (g.form === 'fieldcap' ? 0.55 : g.form === 'mottlegill' ? 1.05 * g.bellTall : 1.25 * g.bellTall);
    const prof = (t: number): [number, number] => {
      if (g.form === 'inkcap') return [R * Math.pow(Math.sin(t * Math.PI * 0.5), 0.75), Hc * (1 - Math.pow(t, 1.6)) - Hc * 0.75];
      if (g.form === 'mottlegill') return [R * Math.pow(t, 0.85), Hc * Math.pow(1 - t, 1.15) - Hc * 0.55];
      // a fieldcap: a low dome that flares out at its rim
      const rr = R * t, yy = Hc * (1 - t * t) - Hc * 0.2 + (t > 0.8 ? (t - 0.8) * Hc * 0.6 * g.flare : 0);
      return [rr, yy];
    };
    const STEPS = 9, AROUND = 20;
    const cap0 = data.length / 12;
    for (let i = 0; i <= STEPS; i++) {
      const t = Math.max(0.02, i / STEPS);
      const [pr, py] = prof(t);
      const e = 0.01, [r1, y1] = prof(Math.min(1, t + e)), [r0, y0] = prof(Math.max(0, t - e));
      const dr = r1 - r0, dy = y1 - y0;
      const col = [0, 1, 2].map((q) => g.bellTop[q] + (g.bellColour[q] - g.bellTop[q]) * Math.min(1, t * 1.4)) as V3;
      for (let j = 0; j < AROUND; j++) {
        const a = (j / AROUND) * Math.PI * 2;
        const nn = norm([-dy * Math.cos(a), dr, -dy * Math.sin(a)]);
        vert([tip[0] + Math.cos(a) * pr, tip[1] + py, tip[2] + Math.sin(a) * pr], nn, col, 1, t, a);
      }
    }
    for (let i = 0; i < STEPS; i++) for (let j = 0; j < AROUND; j++) {
      const a = cap0 + i * AROUND + j, b = cap0 + i * AROUND + ((j + 1) % AROUND), c2 = a + AROUND, d = b + AROUND;
      index.push(a, c2, b, b, c2, d);
    }
    // the gills beneath: a ring from the stalk to the rim, a little up inside the cap
    if (g.form !== 'inkcap') {
      const [rimR, rimY] = prof(1);
      const g0 = data.length / 12;
      for (let j = 0; j < AROUND; j++) {
        const a = (j / AROUND) * Math.PI * 2;
        const gc = g.gill;
        vert([tip[0] + Math.cos(a) * sr * 1.3, tip[1] + rimY + Hc * 0.18, tip[2] + Math.sin(a) * sr * 1.3], [0, -1, 0], gc, 2, 0, a);
        vert([tip[0] + Math.cos(a) * rimR * 0.97, tip[1] + rimY + Hc * 0.02, tip[2] + Math.sin(a) * rimR * 0.97], [0, -1, 0], gc, 2, 1, a);
      }
      for (let j = 0; j < AROUND; j++) { const a = g0 + j * 2, b = g0 + ((j + 1) % AROUND) * 2; index.push(a, a + 1, b, b, a + 1, b + 1); }
    }
  }
  return { data: new Float32Array(data), index: new Uint32Array(index), g, top };
}

function meshFor(gl: WebGL2RenderingContext, seed: number): Mesh {
  let byGl = meshes.get(gl);
  if (!byGl) meshes.set(gl, (byGl = new Map()));
  let m = byGl.get(seed);
  if (m) return m;
  const p = program(gl);
  const geo = clusterGeometry(seed);
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const vb = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, geo.data, gl.STATIC_DRAW);
  const at = (name: string, size: number, off: number) => { const l = gl.getAttribLocation(p, name); if (l < 0) return; gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 48, off * 4); gl.vertexAttribDivisor(l, 0); };
  at('aP', 3, 0); at('aN', 3, 3); at('aC', 4, 6); at('aUV', 2, 10);
  const ib = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.index, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  m = { vao, count: geo.index.length, g: geo.g, top: geo.top };
  byGl.set(seed, m);
  return m;
}
/** how tall a find's cluster stands (m) */
export const clusterTop = (seed: number) => clusterGeometry(seed).top;

/** draw a find's cluster into the wood (a render.ts CustomDraw) */
export function drawCluster(env: WoodEnv, seed: number, at: [number, number], turn: number) {
  const { gl } = env;
  const p = program(gl);
  const m = meshFor(gl, seed);
  gl.useProgram(p);
  env.common(p);
  const u = (n: string) => gl.getUniformLocation(p, n);
  gl.uniform3f(u('uAnchor'), at[0], env.base - 0.004, at[1]);
  gl.uniform1f(u('uTurn'), turn);
  gl.uniform1f(u('uBase'), env.base);
  gl.uniform2fv(u('uMistT'), env.mist);
  gl.uniform1f(u('uTopH'), env.top);
  gl.uniform1f(u('uForm'), m.g.form === 'inkcap' ? 0 : m.g.form === 'mottlegill' ? 1 : 2);
  gl.uniform1f(u('uPleats'), Math.min(40, m.g.pleats));
  gl.uniform1f(u('uInk'), m.g.ink);
  gl.uniform1f(u('uSlime'), m.g.slime);
  gl.bindVertexArray(m.vao);
  gl.depthMask(true);
  gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0);
  gl.depthMask(false);
}

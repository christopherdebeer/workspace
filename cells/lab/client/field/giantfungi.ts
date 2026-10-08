/**
 * A fungus anomaly: the find's species (the Hat-throwers' capped forms, fungi/genome.ts — its
 * bells, colours, pleats, ink and slime) grown gigantic. One to three giants stand in its heart,
 * ten to twenty-odd metres tall, their caps over the wood; a ring of lesser ones stands at the edge
 * of its reach (a fairy ring, the ground lush along it); young ones come up between. Each is a
 * mesh — a tapering, leaning stalk with a swollen foot, a cap turned from its form's profile (an
 * inkcap's pleated bell inking at the rim, a mottlegill's cone, a fieldcap's flared dome), and
 * under the open caps their gills, every one a blade — drawn into Mistwood's scene in its light,
 * fog and mist, writing its depth.
 */
import { hash, seeded } from '../kit/rng';
import { WOOD_GLSL, type WoodEnv } from '../mistwood/render';
import type { Genome } from '../fungi/genome';
import { Builder, PROJECT, norm, program, upload, type Mesh, type V3 } from './mesh';
import { mushroomSpecies } from './mushrooms';
import type { Find } from './finds';

// position, normal, colour and part (0 stalk, 1 cap, 2 gills), along (0 crown … 1 rim, or up the
// stalk) and round (radians)
const STRIDE = 12;
const VS = `#version 300 es
in vec3 aP;
in vec3 aN;
in vec4 aC;
in vec2 aUV;
uniform vec3 uAnchor;
${PROJECT}
out vec3 vWorld;
out vec3 vN;
out vec4 vC;
out vec2 vUV;
out float vDist;
void main() {
  vWorld = uAnchor + aP;
  vDist = project(vWorld);
  vN = aN; vC = aC; vUV = aUV;
}`;
const FS = () => `#version 300 es
precision highp float;
precision highp int;
in vec3 vWorld;
in vec3 vN;
in vec4 vC;
in vec2 vUV;
in float vDist;
out vec4 o;
uniform float uDensity;
${WOOD_GLSL()}
uniform float uPleats, uInk, uSlime, uForm;
void main() {
  if (vWorld.y < landH(vWorld.xz) - .04) discard;
  vec3 eye = vec3(uCam.x, uCam.z, uCam.y);
  vec3 V = normalize(eye - vWorld);
  vec3 N = normalize(vN);
  if (dot(N, V) < 0.) N = -N;
  vec3 L = normalize(vec3(sin(uSun.x) * cos(uSun.y), max(sin(uSun.y), .15), cos(uSun.x) * cos(uSun.y)));
  vec3 base = vC.rgb;
  float part = vC.a;
  // detail at every scale it is seen at: a metre's mottling, a hand's grain, a finger's
  vec3 q = vWorld * vec3(1., .6, 1.);
  float grain = vnoise(q.xz * 1.3 + q.y) * .5 + vnoise(q.xz * 7. + q.y * 5.) * .3 + vnoise(q.xz * 31. + q.y * 23.) * .2;
  if (part < .5) {
    // the stalk: fibrous, streaked along its length, paler up it
    float fib = vnoise(vec2(vUV.y * 40., vWorld.y * .8)) * .6 + vnoise(vec2(vUV.y * 160., vWorld.y * 3.)) * .4;
    base *= .78 + .3 * fib;
    // (dirtied at its foot, in the shade of its cap at its top)
    base *= mix(.55, 1., smoothstep(0., .1, vUV.x)) * mix(.45, 1., smoothstep(0., .14, 1. - vUV.x));
  } else if (part < 1.5) {
    if (uForm < .5) {
      // an inkcap: pleats round the bell, its rim going to ink, dripping
      float pl = .5 + .5 * cos(vUV.y * uPleats);
      base *= .72 + .28 * pl;
      float drip = vnoise(vec2(vUV.y * 18., 0.)) * .25;
      base = mix(base, vec3(.05, .045, .045), smoothstep(1. - uInk * .6 - drip, 1., vUV.x) * .92);
    } else if (uForm < 1.5) {
      base *= .8 + .2 * vnoise(vec2(vUV.y * 4., vUV.x * 6.) + 17.);
    } else {
      // a fieldcap: slimy, a little darker at the crown, streaked
      base *= .85 + .15 * vnoise(vec2(vUV.y * 9., vUV.x * 30.));
      base = mix(base * .8, base, smoothstep(0., .5, vUV.x));
    }
    base *= .82 + .3 * grain;
  } else {
    // the gills: blades from the stalk to the rim, dark with spores
    float blade = .5 + .5 * cos(vUV.y * 240.);
    base *= .6 + .5 * blade;
  }
  // lit as the wood is: wrapped key light, the fog's light from where it faces, a little through
  float wrap = max(dot(N, L) * .6 + .4, 0.);
  vec3 amb = fogDir(N) * .5;
  float thin = part > .5 && part < 1.5 ? .25 * max(dot(-N, L), 0.) : 0.;
  vec3 col = base * (uIllum * (.3 + .75 * wrap + thin) + amb * .55);
  vec3 H = normalize(L + V);
  if (part > .5 && part < 1.5) col += uIllum * uSlime * .9 * pow(max(dot(N, H), 0.), 60.);
  float fogD = fogAt(vDist, vWorld.y - uBase, uDensity);
  float fog = 1. - (1. - fogD) * (1. - mistTo(vWorld));
  o = vec4(mix(col, fogToward(vWorld), fog), 1.);
}`;

/** one mushroom of the species, its foot at `at` (m, from the heart), `H` metres tall */
function mushroom(b: Builder, g: Genome, at: V3, H: number, r: () => number, fine: number, solids?: Array<[number, number, number]>) {
  const k = H / g.height[1];
  const giant = H > 4;
  const age = 0.6 + 0.4 * r();
  const lean = (r() - 0.5) * g.lean * (giant ? 0.35 : 0.8), lAz = r() * Math.PI * 2;
  const tip: V3 = [at[0] + Math.sin(lean) * H * Math.cos(lAz), at[1] + H * Math.cos(lean * 0.5), at[2] + Math.sin(lean) * H * Math.sin(lAz)];
  // (a giant stands on a stouter stalk, under a broader cap, than its kind at its own size)
  const sr = Math.max(0.004, g.radius * k * (giant ? 2.4 : 1.4));
  const R = g.bell * k * (0.75 + 0.35 * age) * (giant ? 1.5 : 1);
  if (solids && H > 1.2) solids.push([at[0], at[2], sr * 1.9]);
  const Hc = R * (g.form === 'fieldcap' ? 0.55 : g.form === 'mottlegill' ? 1.05 * g.bellTall : 1.25 * g.bellTall);
  const v = (p: V3, n: V3, c: V3, part: number, u: number, a: number) => [p[0], p[1], p[2], n[0], n[1], n[2], c[0], c[1], c[2], part, u, a];
  const quad = (a: number[], bb: number[], c: number[], d: number[]) => { b.fine(a, bb, c, fine); b.fine(bb, d, c, fine); };
  // the stalk: a tube along a gentle curve, tapering up from a swollen foot
  const mid = !giant && H > 1.2;
  const SIDES = giant ? 28 : mid ? 12 : 7, RINGS = giant ? 24 : mid ? 6 : 4;
  const ring = (i: number) => {
    const t = i / RINGS;
    const c: V3 = [at[0] + (tip[0] - at[0]) * t * t, at[1] + (tip[1] - at[1]) * t, at[2] + (tip[2] - at[2]) * t * t];
    const rr = sr * (1.2 - 0.35 * t + 0.9 * Math.exp(-t * 14));
    const shade = 0.86 + 0.14 * t;
    return Array.from({ length: SIDES + 1 }, (_, j) => {
      const a = (j / SIDES) * Math.PI * 2;
      return v([c[0] + Math.cos(a) * rr, c[1], c[2] + Math.sin(a) * rr], [Math.cos(a), 0.15, Math.sin(a)], [g.glass[0] * shade, g.glass[1] * shade, g.glass[2] * shade * 0.97], 0, t, a);
    });
  };
  let prev = ring(0);
  for (let i = 1; i <= RINGS; i++) {
    const cur = ring(i);
    for (let j = 0; j < SIDES; j++) quad(prev[j], prev[j + 1], cur[j], cur[j + 1]);
    prev = cur;
  }
  // the cap: its form's profile turned round the stalk's top
  const prof = (t: number): [number, number] => {
    if (g.form === 'inkcap') return [R * Math.pow(Math.sin(t * Math.PI * 0.5), 0.75), Hc * (1 - Math.pow(t, 1.6)) - Hc * 0.75];
    if (g.form === 'mottlegill') return [R * Math.pow(t, 0.85), Hc * Math.pow(1 - t, 1.15) - Hc * 0.55];
    return [R * t, Hc * (1 - t * t) - Hc * 0.2 + (t > 0.8 ? (t - 0.8) * Hc * 0.6 * g.flare : 0)];
  };
  const STEPS = giant ? 22 : mid ? 8 : 6, AROUND = giant ? 72 : mid ? 20 : 12;
  const capRow = (i: number) => {
    const t = Math.max(0.02, i / STEPS);
    const [pr, py] = prof(t);
    const e = 0.01, [r1, y1] = prof(Math.min(1, t + e)), [r0, y0] = prof(Math.max(0, t - e));
    const dr = r1 - r0, dy = y1 - y0;
    const col = [0, 1, 2].map((q) => g.bellTop[q] + (g.bellColour[q] - g.bellTop[q]) * Math.min(1, t * 1.4)) as V3;
    return Array.from({ length: AROUND + 1 }, (_, j) => {
      const a = (j / AROUND) * Math.PI * 2;
      // (the rim a little uneven, as a real one is)
      const wob = 1 + (giant ? 0.04 * Math.sin(a * 3 + H) * t * t : 0);
      return v([tip[0] + Math.cos(a) * pr * wob, tip[1] + py, tip[2] + Math.sin(a) * pr * wob], norm([-dy * Math.cos(a), dr, -dy * Math.sin(a)]), col, 1, t, a);
    });
  };
  prev = capRow(0);
  for (let i = 1; i <= STEPS; i++) {
    const cur = capRow(i);
    for (let j = 0; j < AROUND; j++) quad(prev[j], prev[j + 1], cur[j], cur[j + 1]);
    prev = cur;
  }
  // the gills beneath an open cap: blades from the stalk to the rim
  if (g.form !== 'inkcap') {
    const [rimR, rimY] = prof(1);
    const n = giant ? 120 : mid ? 24 : 12;
    const gc = g.gill;
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      // (each a thin blade: deepest a third of the way out, nothing at either end)
      const inner = sr * 1.4, outer = rimR * 0.97;
      const up = Hc * 0.2, depth = Math.min(Hc * 0.28, (outer - inner) * 0.3);
      const P = (s: number, d: number): V3 => { const rr = inner + (outer - inner) * s; const y = tip[1] + rimY + up * (1 - s) + Hc * 0.02 * s - d; return [tip[0] + ca * rr, y, tip[2] + sa * rr]; };
      const nrm: V3 = [-sa, 0, ca];
      const S = giant ? 8 : 2;
      for (let s = 0; s < S; s++) {
        const s0 = s / S, s1 = (s + 1) / S;
        const d0 = depth * Math.sin(Math.PI * Math.pow(s0, 0.7)), d1 = depth * Math.sin(Math.PI * Math.pow(s1, 0.7));
        quad(v(P(s0, 0), nrm, gc, 2, s0, a), v(P(s1, 0), nrm, gc, 2, s1, a), v(P(s0, d0), nrm, gc, 2, s0, a), v(P(s1, d1), nrm, gc, 2, s1, a));
      }
      // (and the underside between them: dark)
    }
    const under = (i: number) => Array.from({ length: AROUND + 1 }, (_, j) => {
      const a = (j / AROUND) * Math.PI * 2, s = i / (giant ? 4 : 1), rr = sr * 1.4 + (rimR * 0.97 - sr * 1.4) * s;
      return v([tip[0] + Math.cos(a) * rr, tip[1] + rimY + Hc * 0.2 * (1 - s) + Hc * 0.02 * s, tip[2] + Math.sin(a) * rr], [0, -1, 0], [gc[0] * 0.7, gc[1] * 0.7, gc[2] * 0.7], 2, s, a);
    });
    prev = under(0);
    for (let i = 1; i <= (giant ? 4 : 1); i++) { const cur = under(i); for (let j = 0; j < AROUND; j++) quad(prev[j], cur[j], prev[j + 1], cur[j + 1]); prev = cur; }
  }
  return tip[1] + Math.max(0, prof(0)[1]);
}

export interface FungusAnomaly { b: Builder; top: number; g: Genome; /** what is solid underfoot: the stalks (x, z, r; m from the heart) */ solids: Array<[number, number, number]> }
/** the anomaly's meshes, in metres from its heart (at the ground there) */
export function fungusAnomaly(f: Find, ground: (x: number, z: number) => number): FungusAnomaly {
  const g = mushroomSpecies(f.seed);
  const r = seeded(hash(f.seed, 0xf6a));
  const b = new Builder(STRIDE);
  const g0 = ground(f.x, f.z);
  const at = (x: number, z: number): V3 => [x, ground(f.x + x, f.z + z) - g0 - 0.05, z];
  let top = 0;
  const solids: Array<[number, number, number]> = [];
  // the giants in its heart
  const H0 = 22 + r() * 16;
  const n = 1 + (r() < 0.6 ? 1 : 0) + (r() < 0.3 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = i ? 4 + r() * 5 : r() * 1.5;
    top = Math.max(top, mushroom(b, g, at(Math.cos(a) * d, Math.sin(a) * d), i ? H0 * (0.45 + 0.35 * r()) : H0, r, 1.6, solids));
  }
  // the ring at its edge
  const ringR = f.reach * 0.8, m = 14 + Math.floor(r() * 12);
  const phase = r() * 6.28;
  for (let i = 0; i < m; i++) {
    const a = phase + (i / m) * Math.PI * 2 + (r() - 0.5) * 0.15, d = ringR + (r() - 0.5) * 2.5;
    mushroom(b, g, at(Math.cos(a) * d, Math.sin(a) * d), 0.9 + r() * 2.6, r, 1.2, solids);
  }
  // the young between, in twos and threes
  const y = 8 + Math.floor(r() * 10);
  for (let i = 0; i < y; i++) {
    const a = r() * Math.PI * 2, d = f.reach * (0.25 + 0.45 * r());
    const k = 1 + Math.floor(r() * 3);
    for (let j = 0; j < k; j++) mushroom(b, g, at(Math.cos(a) * d + (r() - 0.5) * 1.2, Math.sin(a) * d + (r() - 0.5) * 1.2), 0.25 + r() * 1.4, r, 1.2);
  }
  return { b, top, g, solids };
}

/** meshes built ahead (off the frame that first draws them) */
const ready = new Map<number, FungusAnomaly>();
export function prepareFungus(f: Find, ground: (x: number, z: number) => number) { if (!ready.has(f.seed)) ready.set(f.seed, fungusAnomaly(f, ground)); }
const progs = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
const meshes = new WeakMap<WebGL2RenderingContext, Map<number, { mesh: Mesh; a: Omit<FungusAnomaly, 'b'> }>>();
/** what is solid of each anomaly built so far (by seed): discs in the wood (x, z, r) */
export const fungusSolids = new Map<number, Array<[number, number, number]>>();
/** draw a fungus anomaly into the wood (a render.ts CustomDraw, set at its heart) */
export function drawFungusAnomaly(env: WoodEnv, f: Find, ground: (x: number, z: number) => number) {
  const { gl } = env;
  let p = progs.get(gl);
  if (!p) { p = program(gl, VS, FS()); progs.set(gl, p); }
  let byGl = meshes.get(gl);
  if (!byGl) meshes.set(gl, (byGl = new Map()));
  let m = byGl.get(f.seed);
  if (!m) {
    const { b, ...a } = ready.get(f.seed) ?? fungusAnomaly(f, ground);
    ready.delete(f.seed);
    m = { mesh: upload(gl, p, b, [['aP', 3, 0], ['aN', 3, 3], ['aC', 4, 6], ['aUV', 2, 10]]), a };
    fungusSolids.set(f.seed, a.solids.map(([x, z, r]) => [f.x + x, f.z + z, r]));
    byGl.set(f.seed, m);
  }
  const g = m.a.g;
  gl.useProgram(p);
  env.common(p);
  const u = (n: string) => gl.getUniformLocation(p!, n);
  gl.uniform3f(u('uAnchor'), f.x, env.base, f.z);
  gl.uniform1f(u('uBase'), env.base);
  gl.uniform2fv(u('uMistT'), env.mist);
  gl.uniform1f(u('uTopH'), env.top);
  gl.uniform1f(u('uForm'), g.form === 'inkcap' ? 0 : g.form === 'mottlegill' ? 1 : 2);
  gl.uniform1f(u('uPleats'), Math.min(40, g.pleats));
  gl.uniform1f(u('uInk'), g.ink);
  gl.uniform1f(u('uSlime'), g.slime);
  gl.bindVertexArray(m.mesh.vao);
  gl.depthMask(true);
  gl.drawElements(gl.TRIANGLES, m.mesh.count, gl.UNSIGNED_INT, 0);
  gl.depthMask(false);
}

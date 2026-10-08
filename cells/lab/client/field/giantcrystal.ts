/**
 * A crystal anomaly: the Crystals experiment's own specimen for the find's seed (crystals/
 * mineral.ts — its species, its habit, every crystal of its cluster as the convex hull of its
 * planes) grown to tens of metres and broken up out of the ground, its matrix a low dome of rock
 * half-buried, and about it shards of the same species erupting through the litter, smaller
 * further out. Built as faceted meshes (each face its hull's polygon, cut small to bend with the
 * wood's projection) and drawn into Mistwood's scene, writing its depth: the trees go in front of
 * it and behind it.
 *
 * Its glass: what is seen through it is the mist beyond, bent by its index and coloured by its
 * body over the way through (with its zoning, milk and veils, ghost phantoms inside); a light
 * rises through it from its heart; the edges where its faces meet are drawn in light, as the seals
 * are. Its light is the anomaly's (render.ts Anomaly): the mist about it glows, and the wood.
 */
import { hash, seeded } from '../kit/rng';
import { planesOf, specimen, type Crystal, type Plane, type Species } from '../crystals/mineral';
import { WOOD_GLSL, type WoodEnv } from '../mistwood/render';
import { Builder, PROJECT, cross, dot, norm, program, upload, type Mesh, type V3 } from './mesh';
import type { Find } from './finds';

// position, normal, edge (along it 0 … 1 the face's middle; that middle's distance from it, m),
// axis and along it (0 base … 1 tip), part (0 crystal, 1 its matrix) and the crystal's length (m)
const STRIDE = 14;
const VS = `#version 300 es
in vec3 aP;
in vec3 aN;
in vec2 aE;
in vec4 aAx;
in vec2 aK;
uniform vec3 uAnchor;
${PROJECT}
out vec3 vWorld;
out vec3 vN;
out vec2 vE;
out vec4 vAx;
out vec2 vK;
out float vDist;
void main() {
  vWorld = uAnchor + aP;
  vDist = project(vWorld);
  vN = aN; vE = aE; vAx = aAx; vK = aK;
}`;
const FS = () => `#version 300 es
precision highp float;
precision highp int;
in vec3 vWorld;
in vec3 vN;
in vec2 vE;
in vec4 vAx;
in vec2 vK;
in float vDist;
out vec4 o;
uniform float uDensity;
${WOOD_GLSL()}
uniform vec3 uTint, uTint2, uLight;
uniform float uIor, uAbsorb, uMilk, uVeils, uPhantom, uZone, uStriate;
void main() {
  // (what is under the ground is not seen: the ground does not hide it by its depth)
  if (vWorld.y < landH(vWorld.xz) - .04) discard;
  vec3 eye = vec3(uCam.x, uCam.z, uCam.y);
  vec3 V = normalize(eye - vWorld);
  vec3 N = normalize(vN);
  float facing = dot(N, V);
  if (facing < 0.) N = -N;
  float NV = abs(facing);
  vec3 L = normalize(vec3(sin(uSun.x) * cos(uSun.y), max(sin(uSun.y), .15), cos(uSun.x) * cos(uSun.y)));
  float rise = .6 + .4 * sin(uT * .6 - vAx.w * 5.);
  vec3 col;
  if (vK.x > .5) {
    // the matrix: dark stone, rough, glinting with its crystals' colour
    float n = fbm(vWorld.xz * .3 + vWorld.y * .25);
    vec3 stone = mix(vec3(.1, .095, .09), vec3(.3, .29, .27), n) * (.7 + .5 * vnoise(vWorld.xz * 2.7 + vWorld.y * 1.3));
    float lit = .4 + .6 * max(dot(N, L), 0.);
    col = stone * (lit * uIllum + anomLight(vWorld) * .5);
    // (crystals in it, glinting)
    float gl = smoothstep(.86, .93, vnoise(vWorld.xz * 16. + vWorld.y * 11.));
    col += uLight * gl * (.4 + .6 * pow(.5 + .5 * sin(uT * 2. + vWorld.x * 3. + vWorld.z * 5.), 4.));
  } else {
    vec3 Rd = refract(-V, N, 1. / uIor);
    if (dot(Rd, Rd) < .01) Rd = reflect(-V, N);
    float F = .04 + .96 * pow(1. - NV, 5.);
    // seen a little way in: along its axis there, its colour (zoned), what clouds it
    float depth = 1.5 + 4. * (1. - NV);
    float al = vAx.w + dot(Rd, vAx.xyz) * depth / max(vK.y, .3);
    vec3 tint = uTint;
    if (uZone > .5 && uZone < 1.5) tint = mix(uTint2, uTint, smoothstep(.45, .85, al));
    else if (uZone > 1.5 && uZone < 2.5) tint = mix(uTint, uTint2, .5);
    else if (uZone > 2.5) tint = mix(uTint, uTint2, smoothstep(.35, .65, fract(al * 4.)));
    // through it: what lies beyond, bent — the wood's mist, but darkened and deepened by the body
    // over the way through (thick at a glancing look), not the bright fog itself
    vec3 beyond = mix(uFogLow, fogDir(Rd), .55) * .8;
    // (deeper toward its root, where it is thickest and the earth's dark is in it)
    vec3 body = pow(tint, vec3(1.2 + uAbsorb * depth * 1.1 + 1.5 * (1. - clamp(vAx.w, 0., 1.))));
    vec3 through = beyond * body;
    // its inner faces: light caught and lost by total internal reflection — sharp-edged bright
    // and dark facets by where the ray inside points round its axis, turning as you move
    vec3 ax = vAx.xyz;
    vec3 b1 = normalize(cross(ax, abs(ax.y) < .9 ? vec3(0., 1., 0.) : vec3(1., 0., 0.)));
    vec3 b2 = cross(ax, b1);
    float ang = atan(dot(Rd, b1), dot(Rd, b2));
    float tilt = dot(Rd, ax);
    float facets = smoothstep(-.06, .06, sin(ang * 3. + tilt * 7. + al * 2.5)) * smoothstep(-.1, .1, sin(ang * 5. - tilt * 4. + 1.3));
    through = mix(through * .4, through * 1.5 + uLight * .3 * body, facets);
    // inside: veils and feathers, milk, bands across the axis — a way in, so they move as you do
    vec3 q = vWorld + Rd * depth;
    float veil = smoothstep(.5, .85, fbm(vec2(dot(q, vec3(.31, .17, .23)), dot(q, vec3(-.12, .29, .21))) * 1.4 + 7.));
    float cloud = uMilk * 3. * fbm(q.xz * .35 + q.y * .25) + uVeils * veil * .7;
    through = mix(through, (uIllum * .45 + uLight * .7) * tint, clamp(cloud, 0., .8));
    // phantoms: the crystal as it was, ghost outlines across it inside
    float ph = exp(-pow((fract(al * 3.2 + .27) - .5) * 24., 2.)) * uPhantom * smoothstep(.0, .2, al);
    // its light: up from its heart, through it, slowly; strongest along the edges, piped up them
    float e = vE.x * vE.y;
    vec3 inner = uLight * (pow(max(1.1 - al, 0.), 2.) * .6 * rise + ph * .9 + exp(-e * 1.2) * .25);
    // the faces: the sky and fog in them (the upward ones brighter), and the sun's glint
    vec3 refl = fogDir(reflect(-V, N)) * (.75 + .35 * max(N.y, 0.));
    float spec = pow(max(dot(N, normalize(L + V)), 0.), 180.);
    // (each face a little different: growth hillocks, a face a shade off the next)
    float face = .85 + .3 * h2(ivec2(floor(vN.xz * 97.)));
    // (fine striations across its faces, growth lines)
    float stri = 1. - .12 * uStriate * smoothstep(.75, 1., sin(vAx.w * vK.y * 9.));
    col = mix(through * face * stri + inner, refl, F * .9 + .06) + uIllum * spec * 2.5;
    // the edges where its faces meet: lines of light, as the seals are drawn
    float w = max(.06, fwidth(e) * 1.5);
    float edge = 1. - smoothstep(w * .25, w, e);
    col += (uLight * 1.6 + vec3(.18)) * edge * (.55 + .45 * rise);
  }
  float fogD = fogAt(vDist, vWorld.y - uBase, uDensity);
  float fog = 1. - (1. - fogD) * (1. - mistTo(vWorld));
  o = vec4(mix(col, fogToward(vWorld), fog), 1.);
}`;

/** a convex hull's faces: each plane's polygon, cut by all the others (in order round its normal) */
export function hullFaces(planes: Plane[]): Array<{ n: V3; pts: V3[] }> {
  const out: Array<{ n: V3; pts: V3[] }> = [];
  for (let i = 0; i < planes.length; i++) {
    const n = planes[i].n as V3, d = planes[i].d;
    const c: V3 = [n[0] * d, n[1] * d, n[2] * d];
    const u = norm(cross(Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], n)), v = cross(n, u);
    const S = 1e3;
    let poly: V3[] = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => [c[0] + (u[0] * a + v[0] * b) * S, c[1] + (u[1] * a + v[1] * b) * S, c[2] + (u[2] * a + v[2] * b) * S]);
    for (let j = 0; j < planes.length && poly.length >= 3; j++) {
      if (j === i) continue;
      const pn = planes[j].n as V3, pd = planes[j].d;
      const next: V3[] = [];
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length];
        const da = dot(pn, a) - pd, db = dot(pn, b) - pd;
        if (da <= 0) next.push(a);
        if ((da <= 0) !== (db <= 0)) { const t = da / (da - db); next.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
      }
      poly = next;
    }
    // (a face cut to nothing, or to a sliver)
    if (poly.length >= 3) out.push({ n, pts: poly });
  }
  return out;
}

/** a rotation whose +Y is `axis`, rolled about it (columns x, y, z) — as mineral.ts frames its crystals */
function frame(axis: V3, roll: number): number[] {
  const y = norm(axis);
  let x = norm(cross(Math.abs(y[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], y));
  let z = norm(cross(y, x));
  const c = Math.cos(roll), s = Math.sin(roll);
  x = [x[0] * c + z[0] * s, x[1] * c + z[1] * s, x[2] * c + z[2] * s];
  z = norm(cross(y, x));
  return [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2]];
}

export interface CrystalAnomaly { b: Builder; top: number; species: Species; scale: number; /** what is solid underfoot: discs (x, z, r; m from the heart) */ solids: Array<[number, number, number]> }
/** the anomaly's meshes, in metres from its heart (at the ground there); `ground` the wood's
 *  ground (m) at a point, for the shards */
export function crystalAnomaly(f: Find, ground: (x: number, z: number) => number): CrystalAnomaly {
  const spec = specimen(f.seed);
  const sp = spec.species;
  const r = seeded(hash(f.seed, 0xc4a));
  const turn = r() * Math.PI * 2, ct = Math.cos(turn), st = Math.sin(turn);
  const b = new Builder(STRIDE);
  const g0 = ground(f.x, f.z);
  // the cluster: its faces, in the specimen's units; how big it is grown (its height over the
  // ground, which cuts its matrix a little above the middle)
  const yG = spec.matrix[1] * 0.45;
  const hulls = spec.crystals.map((c) => ({ c, faces: hullFaces(planesOf(c, sp, 1)) }));
  let maxY = 0;
  for (const h of hulls) for (const fc of h.faces) for (const p of fc.pts) maxY = Math.max(maxY, p[1] - yG);
  const H = 24 + r() * 18;
  const S = Math.min(H / Math.max(maxY, 0.1), (f.reach * 0.42) / spec.matrix[0]);
  const place = (p: V3): V3 => [(p[0] * ct - p[2] * st) * S, (p[1] - yG) * S, (p[0] * st + p[2] * ct) * S];
  const turnN = (n: V3): V3 => [n[0] * ct - n[2] * st, n[1], n[0] * st + n[2] * ct];
  let top = 0;
  // (solid: the matrix's dome, and the bigger shards)
  const solids: Array<[number, number, number]> = [[0, 0, Math.min(spec.matrix[0], spec.matrix[2]) * S * 0.9]];
  /** one crystal's faces, given in metres (from the heart): each a fan from its middle */
  const crystal = (faces: Array<{ n: V3; pts: V3[] }>, base: V3, axis: V3) => {
    let len = 0.3;
    for (const fc of faces) for (const p of fc.pts) len = Math.max(len, dot([p[0] - base[0], p[1] - base[1], p[2] - base[2]], axis));
    const along = (p: V3) => dot([p[0] - base[0], p[1] - base[1], p[2] - base[2]], axis) / len;
    for (const fc of faces) {
      const m = fc.pts.length;
      const C: V3 = [0, 0, 0];
      for (const p of fc.pts) { C[0] += p[0] / m; C[1] += p[1] / m; C[2] += p[2] / m; top = Math.max(top, p[1]); }
      for (let k = 0; k < m; k++) {
        const P = fc.pts[k], Q = fc.pts[(k + 1) % m];
        const e: V3 = [Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]];
        const el = Math.hypot(e[0], e[1], e[2]);
        if (el < 1e-4) continue;
        const cp: V3 = [C[0] - P[0], C[1] - P[1], C[2] - P[2]];
        const h = Math.hypot(...cross(cp, e)) / el;
        const v = (p: V3, ee: number) => [p[0], p[1], p[2], fc.n[0], fc.n[1], fc.n[2], ee, h, axis[0], axis[1], axis[2], along(p), 0, len];
        b.fine(v(C, 1), v(P, 0), v(Q, 0), 1.8);
      }
    }
  };
  for (const { c, faces } of hulls) {
    const ax = turnN([c.R[3], c.R[4], c.R[5]]);
    crystal(faces.map((fc) => ({ n: turnN(fc.n), pts: fc.pts.map(place) })), place(c.at as V3), ax);
  }
  // the matrix: a dome of rock, the top of its ellipsoid, a little rough
  {
    const [mx, my, mz] = spec.matrix;
    const LAT = 14, LON = 40;
    const rr = seeded(hash(f.seed, 0x4a7));
    const bumps = Array.from({ length: 6 }, () => [rr() * 6.28, rr() * 3, 0.04 + rr() * 0.06]);
    const at = (i: number, j: number): V3 => {
      const la = -0.35 + (i / LAT) * (Math.PI / 2 + 0.35), lo = (j / LON) * Math.PI * 2;
      let k = 1;
      for (const [ph, fr, amp] of bumps) k += amp * Math.sin(lo * (2 + fr) + ph) * Math.cos(la * (1 + fr));
      return place([Math.cos(la) * Math.cos(lo) * mx * k, Math.sin(la) * my * k, Math.cos(la) * Math.sin(lo) * mz * k]);
    };
    for (let i = 0; i < LAT; i++) for (let j = 0; j < LON; j++) {
      const p00 = at(i, j), p10 = at(i + 1, j), p01 = at(i, j + 1), p11 = at(i + 1, j + 1);
      const nrm = norm(cross([p01[0] - p00[0], p01[1] - p00[1], p01[2] - p00[2]], [p10[0] - p00[0], p10[1] - p00[1], p10[2] - p00[2]]));
      const v = (p: V3) => [p[0], p[1], p[2], nrm[0], nrm[1], nrm[2], 1, 100, 0, 1, 0, 0, 1, 1];
      b.fine(v(p00), v(p10), v(p11), 2.5);
      b.fine(v(p00), v(p11), v(p01), 2.5);
    }
  }
  // shards: the species breaking through the litter about it, leaning out from its heart,
  // bigger nearer, some in twos and threes
  const n = 26 + Math.floor(r() * 22);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, u = r();
    const d = f.reach * (0.3 + 0.48 * Math.sqrt(u));
    const near = 1 - (d / f.reach - 0.3) / 0.48;
    const k = 1 + (r() < 0.3 ? 1 + Math.floor(r() * 2) : 0);
    for (let m = 0; m < k; m++) {
      const x = Math.cos(a) * d + (m ? (r() - 0.5) * 1.6 : 0), z = Math.sin(a) * d + (m ? (r() - 0.5) * 1.6 : 0);
      const size = (0.3 + 2.6 * near * near) * (0.6 + 0.7 * r()) * (m ? 0.6 : 1);
      const lean = 0.2 + 0.7 * r(), psi = Math.atan2(z, x) + (r() - 0.5) * 1.4;
      const axis = norm([Math.sin(lean) * Math.cos(psi), Math.cos(lean), Math.sin(lean) * Math.sin(psi)]);
      const prism = sp.habit === 'prism';
      const radius = prism ? size * 0.28 : size * 0.5;
      const slen = sp.slender[0] + r() * (sp.slender[1] - sp.slender[0]);
      const len = prism ? radius * slen : radius;
      const gy = ground(f.x + x, f.z + z) - g0;
      const c: Crystal = { at: [x, gy - (prism ? len * 0.25 : radius * 0.6), z], R: frame(axis, r() * 6.28), r: radius, len, t0: 0, dur: 1, roll: r() * 6.28, frost: false };
      crystal(hullFaces(planesOf(c, sp, 1)) as Array<{ n: V3; pts: V3[] }>, c.at as V3, axis);
      if (radius > 0.5) solids.push([x, z, radius * 0.9]);
    }
  }
  return { b, top, species: sp, scale: S, solids };
}

/** meshes built ahead (off the frame that first draws them) */
const ready = new Map<number, CrystalAnomaly>();
export function prepareCrystal(f: Find, ground: (x: number, z: number) => number) { if (!ready.has(f.seed)) ready.set(f.seed, crystalAnomaly(f, ground)); }
const progs = new WeakMap<WebGL2RenderingContext, WebGLProgram>();
const meshes = new WeakMap<WebGL2RenderingContext, Map<number, { mesh: Mesh; a: Omit<CrystalAnomaly, 'b'> }>>();
/** what is solid of each anomaly built so far (by seed): discs in the wood (x, z, r) */
export const crystalSolids = new Map<number, Array<[number, number, number]>>();
const zoneOf = (z: Species['zoning']) => ({ none: 0, tip: 1, core: 2, band: 3 })[z];

/** draw a crystal anomaly into the wood (a render.ts CustomDraw, set at its heart) */
export function drawCrystalAnomaly(env: WoodEnv, f: Find, light: V3, ground: (x: number, z: number) => number) {
  const { gl } = env;
  let p = progs.get(gl);
  if (!p) { p = program(gl, VS, FS()); progs.set(gl, p); }
  let byGl = meshes.get(gl);
  if (!byGl) meshes.set(gl, (byGl = new Map()));
  let m = byGl.get(f.seed);
  if (!m) {
    const { b, ...a } = ready.get(f.seed) ?? crystalAnomaly(f, ground);
    ready.delete(f.seed);
    m = { mesh: upload(gl, p, b, [['aP', 3, 0], ['aN', 3, 3], ['aE', 2, 6], ['aAx', 4, 8], ['aK', 2, 12]]), a };
    crystalSolids.set(f.seed, a.solids.map(([x, z, r]) => [f.x + x, f.z + z, r]));
    byGl.set(f.seed, m);
  }
  const sp = m.a.species;
  gl.useProgram(p);
  env.common(p);
  const u = (n: string) => gl.getUniformLocation(p!, n);
  gl.uniform3f(u('uAnchor'), f.x, env.base, f.z);
  gl.uniform1f(u('uBase'), env.base);
  gl.uniform2fv(u('uMistT'), env.mist);
  gl.uniform1f(u('uTopH'), env.top);
  gl.uniform3fv(u('uTint'), sp.tint);
  gl.uniform3fv(u('uTint2'), sp.tint2);
  gl.uniform3fv(u('uLight'), light);
  gl.uniform1f(u('uIor'), sp.ior);
  gl.uniform1f(u('uAbsorb'), sp.absorb);
  gl.uniform1f(u('uMilk'), sp.milk);
  gl.uniform1f(u('uVeils'), sp.veils);
  gl.uniform1f(u('uPhantom'), sp.phantom);
  gl.uniform1f(u('uZone'), zoneOf(sp.zoning));
  gl.uniform1f(u('uStriate'), sp.striate);
  gl.bindVertexArray(m.mesh.vao);
  gl.depthMask(true);
  gl.drawElements(gl.TRIANGLES, m.mesh.count, gl.UNSIGNED_INT, 0);
  gl.depthMask(false);
}

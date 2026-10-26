/**
 * The sea's swell: a sum of Gerstner waves, the same sums on the CPU (the boats ride them) and in GLSL (the
 * water is drawn with them). Short and choppy, a toy sea: wavelengths of a few metres, crests that lean and
 * lace with foam. Near the shore the swell is a little smaller (`calm`, from the coast's shore field).
 *
 * How big and how steep is the weather's: `SEA.height` scales every wave's height, `SEA.chop` how far its crests
 * lean (and so how sharp they are, and how much they fold into foam). The GLSL takes the same two as `uSea`.
 */

/** [direction (radians, 0 = north, toward +x as it grows), wavelength m, amplitude m, steepness 0..1, phase] */
export const WAVES: readonly (readonly [number, number, number, number, number])[] = [
  [0.55, 24, 0.5, 0.5, 0.0],
  [0.05, 14.5, 0.34, 0.55, 1.9],
  [1.05, 9.6, 0.22, 0.62, 4.2],
  [0.35, 6.4, 0.15, 0.68, 2.6],
  [-0.35, 4.4, 0.095, 0.7, 5.3],
  [0.85, 3.2, 0.06, 0.7, 0.9],
  [0.2, 2.3, 0.04, 0.7, 3.7],
  [-0.75, 1.7, 0.026, 0.7, 1.3],
];
/** the weather's sea: how high, how steep (steepness past ~1.45 would fold the surface over itself) */
export const SEA = { height: 1, chop: 1 };
const G = 9.81;
const PARAMS = WAVES.map(([a, wl, amp, q, ph]) => {
  const k = (2 * Math.PI) / wl;
  return { dx: Math.sin(a), dz: Math.cos(a), k, w: Math.sqrt(G * k), amp, q: q / (k * amp * WAVES.length), ph };
});

/** How much of the swell there is here: from the distance to the shore (metres of water, negative on land). */
export function calmAt(s: number) {
  const u = Math.max(0, Math.min(1, s / 12));
  return 0.5 + 0.5 * u * u * (3 - 2 * u);
}

/** The surface point that started at (x, z): its displacement [dx, y, dz] (scaled by `k`). */
export function gerstner(x: number, z: number, t: number, k: number): [number, number, number] {
  let dx = 0, dy = 0, dz = 0;
  const H = SEA.height * k, C = Math.min(1.45, SEA.chop) * k;
  for (const p of PARAMS) {
    const th = p.k * (p.dx * x + p.dz * z) - p.w * t + p.ph, c = Math.cos(th);
    dx += p.q * p.amp * C * p.dx * c; dz += p.q * p.amp * C * p.dz * c; dy += p.amp * H * Math.sin(th);
  }
  return [dx, dy, dz];
}

/** The water's height at a point in the world (found by undoing the sideways shift, three times over). */
export function heightAt(x: number, z: number, t: number, k: number) {
  let x0 = x, z0 = z;
  for (let i = 0; i < 3; i++) { const d = gerstner(x0, z0, t, k); x0 = x - d[0]; z0 = z - d[2]; }
  return gerstner(x0, z0, t, k)[1];
}

/** The same in GLSL: `vec3 swell(vec2 p, float t, float k, out vec3 n, out float fold)` (fold < 1 where crests pinch); needs `uniform vec2 uSea`. */
export function wavesGlsl() {
  const f = (n: number) => n.toFixed(6);
  return `uniform vec2 uSea;
vec3 swell(vec2 p, float t, float k, out vec3 n, out float fold) {
  vec3 d = vec3(0.); vec3 m = vec3(0., 1., 0.); float th, c, s;
  float H = uSea.x * k, C = min(1.45, uSea.y) * k;
${PARAMS.map((p) => `  th = ${f(p.k)} * dot(vec2(${f(p.dx)}, ${f(p.dz)}), p) - ${f(p.w)} * t + ${f(p.ph)}; c = cos(th); s = sin(th);
  d += vec3(${f(p.q * p.amp * p.dx)} * C * c, ${f(p.amp)} * H * s, ${f(p.q * p.amp * p.dz)} * C * c);
  m += vec3(${f(-p.dx * p.k * p.amp)} * H * c, ${f(-p.q * p.k * p.amp)} * C * s, ${f(-p.dz * p.k * p.amp)} * H * c);`).join('\n')}
  n = normalize(m); fold = m.y;
  return d;
}`;
}

/**
 * The sea's swell: a sum of Gerstner waves, the same sums on the CPU (the boats ride them) and in GLSL (the
 * water is drawn with them). Short and choppy, a toy sea: wavelengths of a few metres, crests that lean and
 * lace with foam. Near the shore the swell is a little smaller (`calm`, from the coast's shore field).
 */

/** [direction (radians, 0 = north, toward +x as it grows), wavelength m, amplitude m, steepness 0..1, phase] */
export const WAVES: readonly (readonly [number, number, number, number, number])[] = [
  [0.55, 21, 0.42, 0.55, 0.0],
  [0.05, 13.5, 0.26, 0.6, 1.9],
  [1.05, 9.2, 0.17, 0.65, 4.2],
  [0.35, 6.1, 0.11, 0.7, 2.6],
  [-0.35, 4.3, 0.07, 0.7, 5.3],
  [0.85, 3.1, 0.045, 0.7, 0.9],
];
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
  for (const p of PARAMS) {
    const th = p.k * (p.dx * x + p.dz * z) - p.w * t + p.ph, c = Math.cos(th), a = p.amp * k;
    dx += p.q * a * p.dx * c; dz += p.q * a * p.dz * c; dy += a * Math.sin(th);
  }
  return [dx, dy, dz];
}

/** The water's height at a point in the world (found by undoing the sideways shift, three times over). */
export function heightAt(x: number, z: number, t: number, k: number) {
  let x0 = x, z0 = z;
  for (let i = 0; i < 3; i++) { const d = gerstner(x0, z0, t, k); x0 = x - d[0]; z0 = z - d[2]; }
  return gerstner(x0, z0, t, k)[1];
}

/** The same in GLSL: `vec3 swell(vec2 p, float t, float k, out vec3 n, out float fold)` (fold < 1 where crests pinch). */
export function wavesGlsl() {
  const f = (n: number) => n.toFixed(6);
  return `vec3 swell(vec2 p, float t, float k, out vec3 n, out float fold) {
  vec3 d = vec3(0.); vec3 m = vec3(0., 1., 0.); float th, c, s;
${PARAMS.map((p) => `  th = ${f(p.k)} * dot(vec2(${f(p.dx)}, ${f(p.dz)}), p) - ${f(p.w)} * t + ${f(p.ph)}; c = cos(th); s = sin(th);
  d += k * vec3(${f(p.q * p.amp * p.dx)} * c, ${f(p.amp)} * s, ${f(p.q * p.amp * p.dz)} * c);
  m += k * vec3(${f(-p.dx * p.k * p.amp)} * c, ${f(-p.q * p.k * p.amp)} * s, ${f(-p.dz * p.k * p.amp)} * c);`).join('\n')}
  n = normalize(m); fold = m.y;
  return d;
}`;
}

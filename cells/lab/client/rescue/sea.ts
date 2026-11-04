/**
 * The sea of the rescue race (Lily's game): one course from a seed. Pure (no drawing, no clock), so the race and the
 * tests read the same sea the page draws.
 *
 * - **The course**: a channel of open water running north between two coasts, from the start line (z = 0) to the
 *   finish line (z = `L`), with a beach behind the start and a harbour past the finish, its berths along the far beach.
 *   Islands, and a few rocks, stand in the channel. Distances are in metres: x across, z along, y up.
 * - **The land**: a heightfield (`heights`, every `CELL` metres) of the seabed and the land together: deep water,
 *   a shelf of shallows by each shore, a beach, then grass rising inland. The water is at y = 0. A big boat runs
 *   aground where it's shallower than `DRAFT`.
 * - **The tiny boats**: ~34, spread evenly along the course and across it, in deep water, apart from each other and
 *   the islands; each a bright colour, with one, two or three little people in it (each their own skin, hair, shirt,
 *   now and then a sun hat).
 * - **What stands about** (`decor`): palms on the beaches, round trees inland, boulders, houses by the harbour and the
 *   start, a lighthouse at each end of the finish line, buoys along the start and finish lines, a pier at the berths.
 * - **The waves** (`WAVES`, `waveAt`): a few long, gentle swells, the same sums in the drawing and here (for a boat's
 *   bob), calmed where it's shallow.
 */
import { hash, noise1, lerp, smooth, seeded } from '../kit/rng';

/** the finish line, metres north of the start line */
export const L = 820;
/** the heightfield: its spacing and bounds */
export const CELL = 2, X0 = -200, X1 = 200, Z0 = -150, Z1 = L + 170;
export const NX = Math.round((X1 - X0) / CELL) + 1, NZ = Math.round((Z1 - Z0) / CELL) + 1;
/** the open sea's depth; how deep a big boat sits (shallower is aground) */
export const DEEP = 8, DRAFT = 1;
/** where the boats line up (z), and where the berths are (z) */
export const START_Z = -8, BERTH_Z = L + 92;

export interface PersonLook { skin: number; hair: number; shirt: number; hat: boolean }
export interface TinyPlan { x: number; z: number; yaw: number; colour: number; people: PersonLook[] }
export interface Island { x: number; z: number; r: number; top: number; rock: boolean }
export type DecorKind = 'palm' | 'tree' | 'boulder' | 'house' | 'lighthouse' | 'buoy' | 'pier' | 'post' | 'flag';
export interface Decor { kind: DecorKind; x: number; y: number; z: number; yaw: number; s: number; c: number }
export interface Sea {
  seed: number;
  heights: Float32Array;
  islands: Island[];
  tinies: TinyPlan[];
  decor: Decor[];
  /** where each big boat lines up, and each berth (by finishing order) */
  starts: Array<{ x: number; z: number }>;
  berths: Array<{ x: number; z: number }>;
  /** the channel's middle and half-width at z */
  centre: (z: number) => number;
  half: (z: number) => number;
  /** the finish and start lines' ends (x), where the water meets the land */
  finish: [number, number];
  start: [number, number];
}

/** value noise in 2D, 0..1 */
function vnoise(seed: number, x: number, z: number) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const r = (i: number, j: number) => hash(seed, i, j) / 4294967296;
  return lerp(lerp(r(xi, zi), r(xi + 1, zi), u), lerp(r(xi, zi + 1), r(xi + 1, zi + 1), u), v);
}
const fbm = (seed: number, x: number, z: number) => vnoise(seed, x, z) * 0.55 + vnoise(seed + 7, x * 2.07 + 3.1, z * 2.07 + 9.7) * 0.3 + vnoise(seed + 13, x * 4.3 + 1.3, z * 4.3 + 5.9) * 0.15;
/** -1..1 */
const wob = (seed: number, x: number, z: number) => (fbm(seed, x, z) - 0.5) * 2;

/**
 * A shore in profile, by how far into the land a point is (`d`, metres; under 0 is the water's side): the deep sea,
 * a shelf of shallows `shelf` wide, a beach `beach` wide, then the land rising to `top` over `rise`.
 */
function shore(d: number, top: number, shelf: number, beach: number, rise: number) {
  if (d < 0) return -DEEP + (DEEP - 0.5) * smooth(-shelf, 0, d);
  if (d < beach) return lerp(-0.5, 0.9, d / beach);
  return 0.9 + (top - 0.9) * smooth(beach, beach + rise, d);
}

export function makeSea(seed: number): Sea {
  const s = seed >>> 0;
  const centre = (z: number) => 20 * Math.sin(z / 160 + (s % 628) / 100) + 30 * (noise1(s + 11, z / 110) - 0.5);
  const half = (z: number) => 84 + 28 * (noise1(s + 12, z / 140) - 0.5) + 24 * (1 - smooth(-40, 70, z)) + 46 * smooth(L - 90, L + 40, z);
  const rnd = seeded(hash(s, 1));

  // ─── islands and rocks in the channel ───
  const islands: Island[] = [];
  const nIsl = 5 + Math.floor(rnd() * 3);
  for (let k = 0; k < nIsl; k++) {
    for (let tries = 0; tries < 40; tries++) {
      const z = 130 + ((k + 0.2 + rnd() * 0.6) * (L - 230)) / nIsl;
      const r = 9 + rnd() * 12, room = half(z) - r - 34;
      if (room < 6) continue;
      const x = centre(z) + (rnd() * 2 - 1) * room;
      if (islands.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 46)) continue;
      islands.push({ x, z, r, top: 2.2 + r * 0.2 + rnd() * 2, rock: false });
      break;
    }
  }
  const nRock = 7 + Math.floor(rnd() * 5);
  for (let k = 0; k < nRock; k++) {
    for (let tries = 0; tries < 40; tries++) {
      const z = 60 + rnd() * (L - 120), r = 1.6 + rnd() * 2.2, x = centre(z) + (rnd() * 2 - 1) * (half(z) - 26);
      if (islands.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 24)) continue;
      if (Math.abs(z) < 30 || Math.abs(z - L) < 40) continue;
      islands.push({ x, z, r, top: 1.4 + rnd() * 1.6, rock: true });
      break;
    }
  }

  // ─── the heightfield: the coasts, the beach behind the start, the harbour's beach, the islands ───
  const heights = new Float32Array(NX * NZ);
  const topAt = (x: number, z: number) => 3 + 8 * fbm(s + 31, x / 90, z / 90);
  for (let j = 0; j < NZ; j++) {
    const z = Z0 + j * CELL, cx = centre(z), hw = half(z);
    for (let i = 0; i < NX; i++) {
      const x = X0 + i * CELL, top = topAt(x, z);
      const dW = cx - hw - x + 9 * wob(s + 21, x / 38, z / 38), dE = x - (cx + hw) + 9 * wob(s + 22, x / 38, z / 38);
      const dS = -72 - z + 7 * wob(s + 23, x / 30, z / 30), dN = z - (L + 128) + 7 * wob(s + 24, x / 30, z / 30);
      let h = Math.max(shore(dW, top, 22, 9, 30), shore(dE, top, 22, 9, 30), shore(dS, top * 0.8, 20, 12, 30), shore(dN, top * 0.8, 20, 12, 30));
      for (const o of islands) {
        const dx = x - o.x, dz = z - o.z;
        if (Math.abs(dx) > o.r + 26 || Math.abs(dz) > o.r + 26) continue;
        const d = o.r - Math.hypot(dx, dz) + o.r * 0.28 * wob(s + 41 + Math.round(o.x), x / 9, z / 9);
        h = Math.max(h, o.rock ? shore(d, o.top, 4, 0.6, 2.4) : shore(d, o.top, 12, 4, o.r * 0.6));
      }
      heights[j * NX + i] = h;
    }
  }
  const H = (x: number, z: number) => heightIn(heights, x, z);

  // ─── the tiny boats, spread along the course and across it ───
  const tinies: TinyPlan[] = [];
  const N = 34;
  const look = (): PersonLook => ({ skin: Math.floor(rnd() * SKINS.length), hair: Math.floor(rnd() * HAIRS.length), shirt: Math.floor(rnd() * SHIRTS.length), hat: rnd() < 0.22 });
  for (let k = 0; k < N; k++) {
    for (let tries = 0; tries < 40; tries++) {
      const z = 70 + ((k + 0.15 + rnd() * 0.7) * (L - 130)) / N, x = centre(z) + (rnd() * 2 - 1) * (half(z) - 22);
      if (H(x, z) > -3.5) continue;
      if (tinies.some((t) => Math.hypot(t.x - x, t.z - z) < 16)) continue;
      if (islands.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 12)) continue;
      const u = rnd(), n = u < 0.34 ? 1 : u < 0.76 ? 2 : 3;
      let colour = Math.floor(rnd() * TINY_COLOURS.length);
      if (tinies.length && tinies[tinies.length - 1].colour === colour) colour = (colour + 1 + Math.floor(rnd() * 3)) % TINY_COLOURS.length;
      tinies.push({ x, z, yaw: rnd() * Math.PI * 2, colour, people: Array.from({ length: n }, look) });
      break;
    }
  }

  // ─── where the water meets the land along a line (z), from the channel's middle out ───
  const reach = (z: number, side: -1 | 1) => { let x = centre(z); while (Math.abs(x) < X1 - 4 && H(x + side * 2, z) < -0.3) x += side * 2; return x; };
  const finish: [number, number] = [reach(L, -1), reach(L, 1)], start: [number, number] = [reach(0, -1), reach(0, 1)];
  // (the first boat on the left as you look up the course: the camera looks north, so that's toward +x)
  const starts = Array.from({ length: 5 }, (_, i) => ({ x: centre(START_Z) + (2 - i) * 13, z: START_Z }));
  const berths = Array.from({ length: 5 }, (_, i) => ({ x: centre(BERTH_Z) + (2 - i) * 15, z: BERTH_Z }));

  // ─── what stands about ───
  const decor: Decor[] = [];
  const put = (kind: DecorKind, x: number, z: number, yaw: number, sc: number, c = 0, y = H(x, z)) => decor.push({ kind, x, y, z, yaw, s: sc, c });
  const slope = (x: number, z: number) => Math.hypot(H(x + 1, z) - H(x - 1, z), H(x, z + 1) - H(x, z - 1)) / 2;
  const drnd = seeded(hash(s, 2));
  // (what's seen of the land is its edge: trees only within sight of the water)
  const nearWater = (x: number, z: number, r: number) => [0, 1, 2, 3, 4, 5, 6, 7].some((k) => H(x + Math.cos(k * 0.785) * r, z + Math.sin(k * 0.785) * r) < 0);
  for (let z = Z0 + 4; z < Z1 - 4; z += 5) {
    for (let x = X0 + 4; x < X1 - 4; x += 5) {
      const px = x + (drnd() - 0.5) * 4, pz = z + (drnd() - 0.5) * 4, h = H(px, pz), sl = slope(px, pz), u = drnd();
      if (h > 0.5 && h < 2.4 && sl < 0.5 && u < 0.11) put('palm', px, pz, drnd() * 6.28, 0.8 + drnd() * 0.45, Math.floor(drnd() * 3));
      else if (h > 2.6 && sl < 0.6 && u < 0.06 && nearWater(px, pz, 42)) put('tree', px, pz, drnd() * 6.28, 0.8 + drnd() * 0.6, Math.floor(drnd() * 3));
      else if (h > -0.4 && h < 1.2 && u > 0.985) put('boulder', px, pz, drnd() * 6.28, 0.7 + drnd() * 1.1, 0);
    }
  }
  // (houses: by the harbour, and behind the start)
  const houses = (cx: number, cz: number, n: number, r0: number, r1: number) => {
    for (let k = 0, tries = 0; k < n && tries < 400; tries++) {
      const a = drnd() * Math.PI * 2, r = r0 + drnd() * (r1 - r0), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, h = H(x, z);
      if (h < 1.6 || h > 7 || slope(x, z) > 0.35) continue;
      if (decor.some((d) => d.kind === 'house' && Math.hypot(d.x - x, d.z - z) < 9)) continue;
      // (a house faces the water: its front toward the nearest sea, roughly)
      const yaw = Math.atan2(cx - x, cz - z) + (drnd() - 0.5) * 0.5;
      put('house', x, z, yaw, 0.9 + drnd() * 0.4, Math.floor(drnd() * 5));
      k++;
    }
  };
  houses(centre(L + 140), L + 150, 14, 18, 70);
  houses(centre(-90), -100, 7, 14, 60);
  // (the palms and trees out of the houses' way)
  for (let k = decor.length - 1; k >= 0; k--) { const d = decor[k]; if ((d.kind === 'palm' || d.kind === 'tree') && decor.some((o) => o.kind === 'house' && Math.hypot(o.x - d.x, o.z - d.z) < 5)) decor.splice(k, 1); }
  // (a lighthouse at each end of the finish line, a little up the shore; a flag beside each)
  for (const [x, side] of [[finish[0], -1], [finish[1], 1]] as const) {
    let lx = x + side * 6;
    while (Math.abs(lx) < X1 - 6 && H(lx, L) < 1.4) lx += side * 2;
    put('lighthouse', lx + side * 3, L, 0, 1, 0);
    put('flag', lx - side * 2, L + 8, 0, 1, 1);
  }
  // (buoys along the start line and the finish line: black and white at the finish, red and white at the start)
  for (const [z, [x0, x1], c0] of [[L, finish, 2], [0, start, 0]] as const) {
    const n = Math.max(2, Math.round((x1 - x0) / 7));
    for (let k = 1; k < n; k++) { const x = lerp(x0, x1, k / n); if (H(x, z) < -1) put('buoy', x, z, 0, 1, c0 + (k % 2), 0); }
  }
  // (the pier at the berths: posts at each, a walk along the beach's edge behind them)
  for (const [k, b] of berths.entries()) { put('post', b.x + 7.5, b.z + 7, 0, 1, k, 0); if (k === 4) put('post', b.x - 7.5, b.z + 7, 0, 1, 5, 0); }
  put('pier', centre(BERTH_Z), BERTH_Z + 12, 0, 1, 0, 0);

  return { seed: s, heights, islands, tinies, decor, starts, berths, centre, half, finish, start };
}

/** the heightfield's height at (x, z), between its samples; the deep sea off its edges */
export function heightIn(heights: Float32Array, x: number, z: number) {
  const fx = (x - X0) / CELL, fz = (z - Z0) / CELL;
  if (fx < 0 || fz < 0 || fx > NX - 1 || fz > NZ - 1) return 6;
  const i = Math.min(NX - 2, Math.floor(fx)), j = Math.min(NZ - 2, Math.floor(fz)), u = fx - i, v = fz - j;
  const a = heights[j * NX + i], b = heights[j * NX + i + 1], c = heights[(j + 1) * NX + i], d = heights[(j + 1) * NX + i + 1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
export const heightAt = (sea: Sea, x: number, z: number) => heightIn(sea.heights, x, z);
/** which way is uphill, and how steeply (the gradient of the heightfield) */
export function slopeAt(sea: Sea, x: number, z: number): [number, number] {
  const e = 0.75;
  return [(heightAt(sea, x + e, z) - heightAt(sea, x - e, z)) / (2 * e), (heightAt(sea, x, z + e) - heightAt(sea, x, z - e)) / (2 * e)];
}

// ─── colours (the drawing's; here so the race's people and boats are described in one place) ───
/** the tiny boats' hulls */
export const TINY_COLOURS: Array<[number, number, number]> = [
  [0.91, 0.28, 0.25], [0.95, 0.55, 0.16], [0.96, 0.79, 0.2], [0.29, 0.72, 0.35], [0.13, 0.71, 0.69], [0.24, 0.48, 0.88], [0.55, 0.35, 0.85], [0.92, 0.37, 0.62],
];
export const SKINS: Array<[number, number, number]> = [[0.98, 0.84, 0.72], [0.94, 0.75, 0.6], [0.85, 0.63, 0.47], [0.7, 0.49, 0.34], [0.55, 0.36, 0.24], [0.4, 0.27, 0.18]];
export const HAIRS: Array<[number, number, number]> = [[0.16, 0.11, 0.08], [0.35, 0.21, 0.11], [0.62, 0.42, 0.2], [0.93, 0.78, 0.42], [0.75, 0.32, 0.14], [0.1, 0.1, 0.12]];
export const SHIRTS: Array<[number, number, number]> = [
  [0.95, 0.3, 0.3], [0.98, 0.6, 0.2], [0.99, 0.86, 0.25], [0.4, 0.8, 0.35], [0.2, 0.75, 0.85], [0.3, 0.45, 0.95], [0.7, 0.42, 0.92], [0.98, 0.5, 0.75], [0.97, 0.97, 0.95],
];

// ─── the waves: a few long swells, summed (the drawing's GLSL is made from these) ───
/** [direction x, direction z, wavelength (m), amplitude (m), phase] */
export const WAVES: Array<[number, number, number, number, number]> = [
  [0.8, 0.6, 21, 0.17, 0], [-0.45, 0.89, 13, 0.11, 1.7], [0.97, -0.24, 7.5, 0.055, 4.1], [-0.2, -0.98, 4.2, 0.025, 2.3],
];
const G = 9.81;
/** the sea's height and its slope (d/dx, d/dz) at (x, z) at time t, its waves calmed over the shallows */
export function waveAt(sea: Sea | null, x: number, z: number, t: number): [number, number, number] {
  const calm = sea ? smooth(0.4, 4.5, -heightAt(sea, x, z)) : 1;
  let y = 0, dx = 0, dz = 0;
  for (const [ax, az, wl, amp, ph] of WAVES) {
    const k = (2 * Math.PI) / wl, w = Math.sqrt(G * k), a = amp * calm, q = k * (ax * x + az * z) - w * t + ph;
    y += a * Math.sin(q);
    const c = a * k * Math.cos(q);
    dx += c * ax; dz += c * az;
  }
  return [y, dx, dz];
}
/** the same sums, as GLSL: `vec3 waves(vec2 p, float t, float calm)` (height, d/dx, d/dz) */
export function wavesGlsl() {
  const terms = WAVES.map(([ax, az, wl, amp, ph]) => {
    const k = (2 * Math.PI) / wl, w = Math.sqrt(G * k);
    return `  q = ${k.toFixed(5)} * dot(vec2(${ax.toFixed(4)}, ${az.toFixed(4)}), p) - ${w.toFixed(5)} * t + ${ph.toFixed(4)};
  h += ${amp.toFixed(4)} * calm * vec3(sin(q), ${(k * ax).toFixed(5)} * cos(q), ${(k * az).toFixed(5)} * cos(q));`;
  }).join('\n');
  return `vec3 waves(vec2 p, float t, float calm) {
  vec3 h = vec3(0.);
  float q;
${terms}
  return h;
}`;
}

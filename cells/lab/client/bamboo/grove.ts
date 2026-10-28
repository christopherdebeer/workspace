/**
 * What grows and lies on the mountain (no drawing here: render.ts draws these as instances).
 *
 * - **culms**: moso bamboo, thick and pale, countless and close; thinner where the slope falls toward the valley (so
 *   you see between them) and opened right out where the edge comes in close to the lower track; none on a way, but
 *   crowding to the top of its banks and leaning out a little over it. Each its girth, its height (the stoutest the
 *   tallest), its lean (downhill toward the light, and out over a way beside it), the length of its internodes, its age
 *   (a young one bright, its powder fresh; an old one duller, lichened), and its own phase in the wind;
 * - **sprays**: the leaves, in sprays (each one a cluster of blades, 个 and 介) along the upper half of every culm, so
 *   the grove's ceiling is high; now and then, beside a way, a low spray hanging into the walk;
 * - **litter**: fallen leaves, single tapered blades lying on the ground, thick along the foot of a bank, against a
 *   step, round a stone, thinner where the way's middle is worn;
 * - **stones**: boulders, mossy, mostly at the foot of the uphill bank; one big one where the stair turns at its top;
 * - **ridges**: the far side of the valley, ranges one behind another, for the mist to take.
 */
import { hash } from '../kit/rng';
import { type Land, X0, X1, Z0, Z1, HALF, edgeX, vnoise, NODES, along as at } from './land';
const jitter = (a: number, b: number, c: number) => (hash(a, b, c, 56) / 4294967296 - 0.5) * 0.4;

const r01 = (...n: number[]) => hash(...n) / 4294967296;

/** a culm: base (x, y, z), its radius at the foot, height, lean (where its top is, off the plumb), first internode,
 * age (0 young … 1 old), phase in the wind, how far from a way, its pick (left out where the drawing thins), and where
 * its sprays start (a fraction of its height) */
export interface Culm { x: number; y: number; z: number; r: number; h: number; lx: number; lz: number; node: number; age: number; phase: number; d: number; pick: number; crown: number }
/** a spray: on culm `c`, at height `y` up it (metres), set out from it (ox, oz), its size, facing, tilt, pattern */
export interface Spray { c: number; y: number; ox: number; oz: number; size: number; yaw: number; tilt: number; seed: number }
/** a fallen leaf: where, which way it lies, how long, its colour (0 pale straw … 1 dark brown) */
export interface Leaf { x: number; y: number; z: number; yaw: number; len: number; tone: number }
export interface Stone { x: number; y: number; z: number; r: number; yaw: number; flat: number; kind: number; moss: number }
export interface Grove { culms: Culm[]; sprays: Spray[]; litter: Leaf[]; stones: Stone[]; ridges: { x: number; z: number; y: number }[][] }

export function makeGrove(land: Land): Grove {
  const seed = land.seed, culms: Culm[] = [], sprays: Spray[] = [], litter: Leaf[] = [], stones: Stone[] = [];
  const nearAt = (x: number, z: number) => land.wayNear(x, z);
  // ─── culms: a jittered grid, kept by how dense the grove is there ───
  const SP = 1.55;
  for (let gz = Z0 + 2, j = 0; gz < Z1 - 2; gz += SP, j++) for (let gx = X0 + 2, i = 0; gx < X1 - 2; gx += SP, i++) {
    const x = gx + (r01(i, j, seed, 1) - 0.5) * SP * 0.9, z = gz + (r01(i, j, seed, 2) - 0.5) * SP * 0.9;
    const e = edgeX(z), below = e - x; // (how far down over the edge)
    if (below > 40) continue;
    const q = nearAt(x, z);
    if (q.d < HALF + 0.3 + r01(i, j, seed, 3) * 0.4) continue;
    // (the grove's own patchiness; thinner over the edge, opened right out where the edge is close to the lower track)
    let keep = 0.62 + 0.45 * vnoise(x / 14, z / 14, seed + 40);
    if (below > 0) keep *= 0.55 - Math.min(0.3, below * 0.012);
    const view = Math.exp(-(((z - 78) / 16) ** 2)) * (x < 0 ? 1 : 0) * (q.d < 18 ? 1 : 0);
    keep *= 1 - 0.8 * view;
    // (below a way, on the side the slope falls away, sparser: the walk looks out between them)
    const y = land.groundAt(x, z);
    if (q.way >= 0 && y < land.ways[q.way].y[q.i] - 0.8) keep *= 0.55;
    if (r01(i, j, seed, 4) > keep) continue;
    const girth = r01(i, j, seed, 5), r = 0.055 + girth * 0.04, h = 11 + girth * 8 + r01(i, j, seed, 6) * 3;
    // (lean: downhill a little, and out over a way that runs beside it)
    let lx = -0.15 - r01(i, j, seed, 7) * 0.5 + (r01(i, j, seed, 8) - 0.5) * 0.9, lz = (r01(i, j, seed, 9) - 0.5) * 0.9;
    if (q.way >= 0 && q.d < 6) {
      const w = land.ways[q.way], tx = w.x[q.i] - x, tz = w.z[q.i] - z, l = Math.hypot(tx, tz) || 1, k = (1 - q.d / 6) * (0.8 + r01(i, j, seed, 10) * 1.4);
      lx += (tx / l) * k; lz += (tz / l) * k;
    }
    culms.push({ x, y, z, r, h, lx, lz, node: 0.26 + r01(i, j, seed, 11) * 0.12, age: r01(i, j, seed, 12), phase: r01(i, j, seed, 13) * 6.283, d: q.d, pick: r01(i, j, seed, 14), crown: 0.42 + r01(i, j, seed, 15) * 0.18 });
  }
  // ─── sprays: along the upper part of each culm; a low one now and then beside a way ───
  culms.forEach((c, k) => {
    const n = c.d < 30 ? 12 : 6;
    for (let m = 0; m < n; m++) {
      const f = c.crown + (1 - c.crown) * ((m + r01(k, m, 21)) / n), a = r01(k, m, 22) * 6.283, out = 0.4 + r01(k, m, 23) * 1.3;
      sprays.push({ c: k, y: c.h * f, ox: Math.sin(a) * out, oz: Math.cos(a) * out, size: 0.7 + r01(k, m, 24) * 0.6, yaw: a + (r01(k, m, 25) - 0.5) * 1.2, tilt: (r01(k, m, 26) - 0.5) * 0.9, seed: r01(k, m, 27) });
    }
    if (c.d < 5 && r01(k, 30) < 0.16) {
      const a = r01(k, 31) * 6.283;
      sprays.push({ c: k, y: 1.9 + r01(k, 32) * 1.8, ox: Math.sin(a) * 0.6, oz: Math.cos(a) * 0.6, size: 0.55 + r01(k, 33) * 0.3, yaw: a, tilt: 0.5 + r01(k, 34) * 0.5, seed: r01(k, 35) });
    }
  });
  // ─── low greens: small leafy sprays along the edges of the ways, at shin and knee height, thicker on the bank ───
  for (const w of land.ways) for (let i = 0; i < w.x.length; i += 2) {
    const dx = w.x[Math.min(w.x.length - 1, i + 1)] - w.x[Math.max(0, i - 1)], dz = w.z[Math.min(w.x.length - 1, i + 1)] - w.z[Math.max(0, i - 1)], l = Math.hypot(dx, dz) || 1;
    for (let k = 0; k < 3; k++) {
      if (r01(w.id, i, k, 60) > 0.55) continue;
      const side = r01(w.id, i, k, 61) < 0.5 ? -1 : 1, off = HALF + 0.35 + r01(w.id, i, k, 62) ** 1.5 * 3.5;
      const x = w.x[i] - (dz / l) * off * side, z = w.z[i] + (dx / l) * off * side, gy = land.groundAt(x, z);
      // (a stub culm, hidden, holds it: no height to speak of, so it doesn't sway like a tall one)
      culms.push({ x, y: gy - 3, z, r: 0, h: 3.2, lx: 0, lz: 0, node: 1, age: 0, phase: r01(w.id, i, k, 63) * 6.28, d: off, pick: 0, crown: 1 });
      const ci = culms.length - 1, a = r01(w.id, i, k, 64) * 6.283;
      for (let m = 0; m < 2; m++) sprays.push({ c: ci, y: 3 + 0.15 + r01(w.id, i, k, 65 + m) * 0.7, ox: Math.sin(a + m * 2) * 0.25, oz: Math.cos(a + m * 2) * 0.25, size: 0.35 + r01(w.id, i, k, 67 + m) * 0.3, yaw: a + m * 1.7, tilt: (r01(w.id, i, k, 69 + m) - 0.5) * 1.2, seed: r01(w.id, i, k, 71 + m) });
    }
  }
  // ─── stones: at the foot of the uphill bank mostly, and the big one at the top of the stair up ───
  for (const w of land.ways) for (let i = 0; i < w.x.length; i += 3) {
    if (r01(w.id, i, 40) > 0.16) continue;
    const dx = w.x[Math.min(w.x.length - 1, i + 1)] - w.x[Math.max(0, i - 1)], dz = w.z[Math.min(w.x.length - 1, i + 1)] - w.z[Math.max(0, i - 1)], l = Math.hypot(dx, dz) || 1;
    // (to the uphill side, mostly: the side where the ground's higher)
    let side = land.groundAt(w.x[i] - (dz / l) * 3, w.z[i] + (dx / l) * 3) > land.groundAt(w.x[i] + (dz / l) * 3, w.z[i] - (dx / l) * 3) ? 1 : -1;
    if (r01(w.id, i, 41) < 0.25) side = -side;
    const off = HALF + 0.5 + r01(w.id, i, 42) * 2.6, x = w.x[i] - (dz / l) * off * side, z = w.z[i] + (dx / l) * off * side;
    const r = 0.25 + r01(w.id, i, 43) ** 2 * 1.1;
    stones.push({ x, y: land.groundAt(x, z) - r * 0.35, z, r, yaw: r01(w.id, i, 44) * 6.283, flat: 0.55 + r01(w.id, i, 45) * 0.35, kind: Math.floor(r01(w.id, i, 46) * 4), moss: r01(w.id, i, 47) });
  }
  {
    const [fx, fz] = NODES.fork, x = fx + 2.6, z = fz - 3.2;
    stones.push({ x, y: land.groundAt(x, z) - 0.6, z, r: 2.1, yaw: 0.7, flat: 0.95, kind: 2, moss: 0.9 });
  }
  // (none where a culm stands, nor on a way)
  for (let s = stones.length - 1; s >= 0; s--) if (land.wayNear(stones[s].x, stones[s].z).d < HALF + stones[s].r * 0.45) stones.splice(s, 1);
  // ─── litter: within a dozen metres of the ways, thickest at the foot of the banks and round stones, thin where the
  // middle's worn; a sprinkling further out ───
  const LS = 0.14;
  for (const w of land.ways) for (let i = 0; i < w.x.length; i++) {
    const dx = w.x[Math.min(w.x.length - 1, i + 1)] - w.x[Math.max(0, i - 1)], dz = w.z[Math.min(w.x.length - 1, i + 1)] - w.z[Math.max(0, i - 1)], l = Math.hypot(dx, dz) || 1;
    for (let k = 0; k < 26; k++) {
      const u = (r01(w.id, i, k, 50) * 2 - 1) * 7, a = Math.abs(u);
      const p = a < HALF * 0.55 ? 0.25 : a < HALF + 0.6 ? 1 : a < 3 ? 0.8 : 0.4;
      if (r01(w.id, i, k, 51) > p) continue;
      const along = (r01(w.id, i, k, 52) - 0.5) * 0.5, x = w.x[i] - (dz / l) * u + (dx / l) * along, z = w.z[i] + (dx / l) * u + (dz / l) * along;
      const onStep = w.stair[i] && a < HALF * 0.95 ? at(w, w.s[i] + jitter(w.id, i, k)).y : -1e9;
      litter.push({ x, y: Math.max(land.groundAt(x, z), onStep) + 0.012, z, yaw: r01(w.id, i, k, 53) * 6.283, len: LS + r01(w.id, i, k, 54) * 0.12, tone: r01(w.id, i, k, 55) });
    }
  }
  // ─── the far side of the valley: ranges, each a jagged line, one behind another ───
  const ridges: { x: number; z: number; y: number }[][] = [];
  for (let r = 0; r < 5; r++) {
    const xr = -260 - r * 220, line: { x: number; z: number; y: number }[] = [];
    for (let z = -900; z <= 1100; z += 14 + r * 6) {
      const n = vnoise(z / (90 + r * 40), r * 3.7, seed + 90 + r), m = vnoise(z / 30, r * 1.3, seed + 120 + r);
      line.push({ x: xr + (vnoise(z / 200, r, seed + 140) - 0.5) * 80, z, y: -40 + 40 * r + n * (70 + r * 50) + m * 14 });
    }
    ridges.push(line);
  }
  return { culms, sprays, litter, stones, ridges };
}

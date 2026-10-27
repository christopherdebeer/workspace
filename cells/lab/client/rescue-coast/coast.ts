/**
 * The coast, from a seed, one of two kinds:
 * - **the Rally's**: a channel of open sea running north between granite cliffs, with headlands, coves, islets and
 *   sea stacks out in it, to a harbour whose narrow mouth is the finish;
 * - **the Service's**: the same harbour and town at the top, and the crews set out from it: down the approach
 *   between the cliffs and the harbour's own headland, then the far shore falls away and it's the open sea, with the
 *   coast running on down one side, islets and reefs scattered out over the water, and further out the swell bigger.
 *
 * One field says where the land is: `shore`, the distance to the nearest shore in metres (positive over water,
 * negative on land). Everything is made from it, so nothing disagrees:
 * - the ground (cliff steps, quays, the town's hill, the seabed) and the boulders heaped along every shore;
 * - where a boat can go (its hull keeps `CLEAR` metres from the shore) and the routes the game's boats find;
 * - how big the swell is, and where the surf breaks (drawn from the same numbers, uploaded as a texture).
 *
 * Out on the water: the little boats with their people, the channel buoys, red to the west and green to the
 * east. Ashore: lighthouses, the lifeboat station at the start, cottages on the harbour hill, gorse.
 */
import { seeded, hash, type Rand } from '../kit/rng';
import { SWELL, calmAt } from './waves';

export const CELL = 2;
export const X0 = -300, X1 = 300, Z0 = -200;
/** the harbour mouth: the Rally's finish; the Service's way out and home */
export const GATE_Z = 860, GATE_HALF = 26;
export const Z1 = GATE_Z + 320;
export const NX = (X1 - X0) / CELL + 1, NZ = (Z1 - Z0) / CELL + 1;
export const START_Z = 0;
/** how far a hull keeps from the shore (the boulders reach out about this far) */
export const CLEAR = 2.6;
/** the navigation grid (the game's boats find their way on it) */
export const NAV = 4, NNX = Math.floor((X1 - X0) / NAV), NNZ = Math.floor((Z1 - Z0) / NAV);

export type CraftKind = 'row' | 'kayak' | 'sail';
export type CoastKind = 'rally' | 'service';
export interface Person { skin: number; hair: number; shirt: number; style: number }
/** a little boat in trouble; in the Service, when its call comes in (seconds out) and how far out it is (0 near the
 * harbour, 1 along the coast, 2 out at sea); in the Rally they're all there from the start */
export interface Craft { id: number; x: number; z: number; yaw: number; kind: CraftKind; colour: number; people: Person[]; at: number; zone: number }
export interface Islet { x: number; z: number; r: number; kind: 'islet' | 'stacks' | 'reef'; light: boolean; wob: number[] }
/** a boulder (kinds 0-3: centred on y, sy its half height) or a column of the cliff face (kinds 4-7: standing on y, sy its height) */
export interface Rock { x: number; y: number; z: number; yaw: number; sx: number; sy: number; sz: number; kind: number; tint: number }
export const COLUMN = 4;
export type PropKind = 'cottage' | 'lighthouse' | 'station' | 'gorse' | 'post' | 'quay';
export interface Prop { kind: PropKind; x: number; y: number; z: number; yaw: number; s: number; v: number }
export interface Buoy { x: number; z: number; kind: 'red' | 'green' | 'yellow' }
export interface Coast {
  seed: number; name: string; kind: CoastKind;
  /** distance to the shore, per sample (positive over water) */
  shore: Float32Array;
  /** the ground (and the seabed), per sample */
  ground: Float32Array;
  centre: (z: number) => number;
  gateX: number;
  islets: Islet[]; rocks: Rock[]; props: Prop[]; buoys: Buoy[]; crafts: Craft[];
  starts: { x: number; z: number; h: number }[];
  berths: { x: number; z: number; h: number }[];
  /** the harbour's basin (an ellipse: its middle and half widths); (the Service's) the stone pier out into it by the
   * mouth, where they land, and the town comes down to wave */
  harbour: { x: number; z: number; rx: number; rz: number };
  pier: { x0: number; x1: number; z0: number; z1: number } | null;
  /** points along the shore (where the surf breaks): x, z and the way out to sea */
  surf: Float32Array;
  /** where the hulls may go, on the navigation grid */
  open: Uint8Array;
  /** how open the water is to the swell (0 sheltered behind land, 1 open), on its own coarse grid (`EXPO` m) */
  exposure: Float32Array;
}
/** the Service's search area: the open sea stops this far inside the edges of the chart */
export const EDGE = 36;
/** the exposure grid */
export const EXPO = 8, NEX = Math.floor((X1 - X0) / EXPO) + 1, NEZ = Math.floor((Z1 - Z0) / EXPO) + 1;

const ss = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** a bilinear sample of a field over the grid */
export function sample(f: Float32Array, x: number, z: number) {
  const u = Math.max(0, Math.min(NX - 1.001, (x - X0) / CELL)), v = Math.max(0, Math.min(NZ - 1.001, (z - Z0) / CELL));
  const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, o = j * NX + i;
  return (f[o] * (1 - a) + f[o + 1] * a) * (1 - b) + (f[o + NX] * (1 - a) + f[o + NX + 1] * a) * b;
}
export const shoreAt = (c: Coast, x: number, z: number) => sample(c.shore, x, z);
/** how open the water is here to the swell: 0 in the lee of a headland or an islet, 1 out in the open */
export function exposureAt(c: Coast, x: number, z: number) {
  const u = Math.max(0, Math.min(NEX - 1.001, (x - X0) / EXPO)), v = Math.max(0, Math.min(NEZ - 1.001, (z - Z0) / EXPO));
  const i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j, o = j * NEX + i, e = c.exposure;
  return (e[o] * (1 - a) + e[o + 1] * a) * (1 - b) + (e[o + NEX] * (1 - a) + e[o + NEX + 1] * a) * b;
}
/** how much of the swell there is here (0.18-1): smaller near the shore, and in the lee of land; the sea's `k` (the
 * shader works it out the same way from the same numbers) */
export const seaAt = (c: Coast, x: number, z: number) => calmAt(shoreAt(c, x, z)) * (0.35 + 0.65 * exposureAt(c, x, z));
/** the exposure: look back the way the swell comes, along three rays; land close upwind shelters the water */
function exposeCoast(c: Coast) {
  const e = new Float32Array(NEX * NEZ), base = Math.atan2(-SWELL[0], -SWELL[1]);
  for (let j = 0; j < NEZ; j++) for (let i = 0; i < NEX; i++) {
    const x = X0 + i * EXPO, z = Z0 + j * EXPO;
    if (shoreAt(c, x, z) < -4) { e[j * NEX + i] = 0; continue; }
    let shelter = 0;
    for (const da of [-0.38, 0, 0.38]) {
      const dx = Math.sin(base + da), dz = Math.cos(base + da);
      for (let d = 8; d <= 160; d += 6) {
        if (shoreAt(c, x + dx * d, z + dz * d) < 0) { shelter += 1 - ss(12, 160, d); break; }
      }
    }
    // (inside the harbour mouth it's calm whatever the swell; out at sea, well off the land, the swell has room to build
    // and it's more than open: up to 1.45)
    e[j * NEX + i] = (1 - 0.9 * (shelter / 3)) * (1 - 0.7 * ss(GATE_Z - 10, GATE_Z + 30, z)) * (c.kind === 'service' ? 1 + 0.45 * ss(70, 230, shoreAt(c, x, z)) : 1);
  }
  c.exposure = e;
}
export const groundAt = (c: Coast, x: number, z: number) => sample(c.ground, x, z);
/** the way out to sea (the shore field's slope) */
export function seaward(c: Coast, x: number, z: number): [number, number] {
  const gx = shoreAt(c, x + 1, z) - shoreAt(c, x - 1, z), gz = shoreAt(c, x, z + 1) - shoreAt(c, x, z - 1), l = Math.hypot(gx, gz) || 1;
  return [gx / l, gz / l];
}
export const navIndex = (x: number, z: number) => {
  const i = Math.floor((x - X0) / NAV), j = Math.floor((z - Z0) / NAV);
  return i < 0 || j < 0 || i >= NNX || j >= NNZ ? -1 : j * NNX + i;
};

const NAMES_A = ['Gull', 'Seal', 'Puffin', 'Smugglers', 'Mermaid', 'Lantern', 'Pebble', 'Kittiwake', 'Gorse', 'Fisher', 'Otter', 'Shell'];
const NAMES_B = ['Cove', 'Point', 'Head', 'Bay', 'Haven', 'Sound'];

export function makeCoast(seed: number, kind: CoastKind = 'rally'): Coast {
  // (a sea whose route is blocked is made again, a little differently)
  for (let attempt = 0; attempt < 12; attempt++) {
    const c = tryCoast(seed, attempt, kind);
    if (c) return c;
  }
  return tryCoast(seed, 99, kind, true)!;
}

function tryCoast(seed: number, attempt: number, kind: CoastKind, force = false): Coast | null {
  const svc = kind === 'service';
  const rand = seeded(hash(seed, svc ? 4343 : 4242, attempt));
  const ph = Array.from({ length: 8 }, () => rand() * 6.283);
  const centre = (z: number) => 26 * Math.sin(z * 0.0052 + ph[0]) + 14 * Math.sin(z * 0.0121 + ph[1]);
  const gateX = centre(GATE_Z);
  // (headlands reach into the channel, coves bite back from it; alternating sides)
  const capes: { z: number; side: number; depth: number; width: number; cove: boolean }[] = [];
  if (svc) {
    // (the Service: the coast runs down the west side, headland and cove all the way; across the approach, the harbour's
    // own headland, with the lighthouse on it)
    for (let z = -20 + rand() * 60; z < GATE_Z - 250; z += 100 + rand() * 80) {
      const cove = rand() < 0.35;
      capes.push({ z, side: -1, depth: cove ? -(22 + rand() * 18) : 30 + rand() * 22, width: cove ? 34 + rand() * 18 : 26 + rand() * 22, cove });
    }
    capes.push({ z: GATE_Z - 175 - rand() * 35, side: 1, depth: 36 + rand() * 12, width: 34 + rand() * 10, cove: false });
  } else for (let z = 120 + rand() * 60, side = rand() < 0.5 ? -1 : 1; z < GATE_Z - 280; z += 110 + rand() * 80, side = -side) {
    const cove = rand() < 0.3;
    capes.push({ z, side, depth: cove ? -(22 + rand() * 18) : 30 + rand() * 22, width: cove ? 34 + rand() * 18 : 26 + rand() * 22, cove });
  }
  const half = (z: number) => {
    let h = 92 + 16 * Math.sin(z * 0.0093 + ph[2]);
    h += 26 * (1 - ss(-40, 90, z)); // the start's wide bay
    return z >= GATE_Z - 12 ? GATE_HALF : h + (GATE_HALF - h) * ss(GATE_Z - 230, GATE_Z - 12, z);
  };
  const wobble = (z: number, side: number) => 5 * Math.sin(z * 0.043 + ph[3] + side) + 3 * Math.sin(z * 0.097 + ph[4] * side) + 1.5 * Math.sin(z * 0.21 + side * 2);
  const capeAt = (z: number, side: number) => {
    let d = 0;
    for (const k of capes) if (k.side === side) d += k.depth * Math.exp(-(((z - k.z) / k.width) ** 2));
    return d;
  };
  // (the Service: past the harbour's headland the far shore falls away east, off the chart: the open sea; and far down,
  // the coast itself turns away west)
  const awayE = (z: number) => svc ? 700 * ss(GATE_Z - 230, GATE_Z - 470, z) : 0, awayW = (z: number) => svc ? 330 * ss(150, -170, z) : 0;
  const west = (z: number) => centre(z) - half(z) + (z < GATE_Z - 12 ? wobble(z, -1) * ss(GATE_Z - 12, GATE_Z - 200, z) + capeAt(z, -1) : 0) - awayW(z);
  const east = (z: number) => centre(z) + half(z) - (z < GATE_Z - 12 ? wobble(z, 1) * ss(GATE_Z - 12, GATE_Z - 200, z) + capeAt(z, 1) : 0) + awayE(z);
  const southShore = (x: number) => -150 + 12 * Math.sin(x * 0.021 + ph[5]) + 5 * Math.sin(x * 0.07);
  // (the Service's harbour is a little one, with a stone pier out from its west side just inside the mouth)
  const basin = svc ? { x: gateX + 10 * Math.sin(ph[6]), z: GATE_Z + 105, rx: 105, rz: 72 } : { x: gateX + 10 * Math.sin(ph[6]), z: GATE_Z + 125, rx: 150, rz: 100 };
  const pier = svc ? { x0: basin.x - 150, x1: basin.x - 30, z0: GATE_Z + 52, z1: GATE_Z + 59 } : null;
  // (islets out in the channel: grassy islets, sea stacks, reefs; the biggest has a lighthouse)
  const islets: Islet[] = [];
  if (svc) {
    // (the Service: out over the open sea, here and there, well off the coast and clear of the approach)
    for (let z = -150 + rand() * 40; z < GATE_Z - 330; z += 75 + rand() * 50) for (let x = X0 + 30 + rand() * 60; x < X1 - 40; x += 85 + rand() * 70) {
      if (rand() < 0.6) continue;
      const kind = rand() < 0.45 ? 'islet' : rand() < 0.6 ? 'stacks' : 'reef';
      const r = kind === 'islet' ? 12 + rand() * 12 : kind === 'stacks' ? 6 + rand() * 4 : 4 + rand() * 4, jz = z + (rand() - 0.5) * 30;
      if (x - r < west(jz) + 60) continue;
      islets.push({ x, z: jz, r, kind, light: false, wob: [rand() * 6.28, rand() * 6.28, 0.12 + rand() * 0.1] });
      if (kind === 'stacks') for (let k = 0; k < 1 + Math.floor(rand() * 2); k++) {
        const a = rand() * 6.28, d = r * (1.6 + rand() * 0.8);
        islets.push({ x: x + Math.sin(a) * d, z: jz + Math.cos(a) * d, r: r * (0.45 + rand() * 0.3), kind, light: false, wob: [rand() * 6.28, rand() * 6.28, 0.1] });
      }
    }
  } else for (let z = 150 + rand() * 60; z < GATE_Z - 280; z += 95 + rand() * 75) {
    const kind = rand() < 0.45 ? 'islet' : rand() < 0.6 ? 'stacks' : 'reef';
    const r = kind === 'islet' ? 13 + rand() * 11 : kind === 'stacks' ? 6 + rand() * 4 : 4 + rand() * 4;
    const span = half(z) * 0.62, x = centre(z) + (rand() * 2 - 1) * span;
    islets.push({ x, z: z + (rand() - 0.5) * 30, r, kind, light: false, wob: [rand() * 6.28, rand() * 6.28, 0.12 + rand() * 0.1] });
    if (kind === 'stacks') for (let k = 0; k < 1 + Math.floor(rand() * 2); k++) {
      const a = rand() * 6.28, d = r * (1.6 + rand() * 0.8);
      islets.push({ x: x + Math.sin(a) * d, z: z + Math.cos(a) * d, r: r * (0.45 + rand() * 0.3), kind, light: false, wob: [rand() * 6.28, rand() * 6.28, 0.1] });
    }
  }
  // (skerries: little reefs of rock a stone's throw off the cliffs, where the surf breaks)
  for (let z = (svc ? -60 : 20) + rand() * 30; z < GATE_Z - 60; z += 22 + rand() * 40) {
    // (the Service's along its one coast, and round the harbour's headland)
    const side = svc ? (z > GATE_Z - 260 && rand() < 0.5 ? 1 : -1) : rand() < 0.5 ? -1 : 1, d = 9 + rand() * 16, x = side < 0 ? west(z) + d : east(z) - d;
    for (let k = 0; k < 1 + Math.floor(rand() * 3); k++) islets.push({ x: x + (rand() - 0.5) * 9, z: z + (rand() - 0.5) * 12, r: 1.8 + rand() * 2.6, kind: 'reef', light: false, wob: [rand() * 6.28, rand() * 6.28, 0.18] });
  }
  const big = islets.filter((i) => i.kind === 'islet').sort((a, b) => b.r - a.r)[0];
  if (big) big.light = true;
  // (the islets binned on a coarse grid, each in every bin within reach of its shore, so the nearest is found quickly;
  // further off than that, all that matters is that it's far)
  const BIN = 32, REACH = 64, bins = new Map<number, Islet[]>(), binOf = (x: number, z: number) => Math.floor((z - Z0) / BIN) * 4096 + Math.floor((x - X0) / BIN);
  for (const i of islets) {
    const R = i.r * (1 + i.wob[2] + 0.08) + REACH;
    for (let z = i.z - R; z < i.z + R + BIN; z += BIN) for (let x = i.x - R; x < i.x + R + BIN; x += BIN) {
      const k = binOf(Math.min(x, i.x + R), Math.min(z, i.z + R)), list = bins.get(k) ?? bins.set(k, []).get(k)!;
      if (list[list.length - 1] !== i) list.push(i);
    }
  }
  const isletNear = (x: number, z: number): [number, Islet | null] => {
    let d = 1e9, near: Islet | null = null;
    for (const i of bins.get(binOf(x, z)) ?? []) {
      const dx = x - i.x, dz = z - i.z, r = Math.hypot(dx, dz), a = Math.atan2(dx, dz);
      const R = i.r * (1 + i.wob[2] * Math.sin(3 * a + i.wob[0]) + 0.08 * Math.sin(5 * a + i.wob[1]));
      if (r - R < d) { d = r - R; near = i; }
    }
    return [d, near];
  };
  const isletD = (x: number, z: number) => isletNear(x, z)[0];
  // ─── the shore field: the water's distance from the land (analytic near the shore; then spread over the grid) ───
  const raw = (x: number, z: number) => {
    let w = Math.min(x - west(z), east(z) - x, svc ? 1e9 : z - southShore(x));
    if (z > GATE_Z + 45) w = Math.min(w, GATE_Z + 45 - z);
    const ex = (x - basin.x) / basin.rx, ez = (z - basin.z) / basin.rz;
    w = Math.max(w, (1 - Math.hypot(ex, ez)) * Math.min(basin.rx, basin.rz));
    if (pier) { const dx = Math.max(pier.x0 - x, x - pier.x1), dz = Math.max(pier.z0 - z, z - pier.z1); w = Math.min(w, dx > 0 || dz > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) : Math.max(dx, dz)); }
    return Math.min(w, isletD(x, z));
  };
  const n = NX * NZ, shore = new Float32Array(n), dist = new Float32Array(n), wet = new Uint8Array(n);
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const o = j * NX + i, w = raw(X0 + i * CELL, Z0 + j * CELL);
    wet[o] = w > 0 ? 1 : 0;
    dist[o] = Math.abs(w) < 3 * CELL ? Math.abs(w) : 1e9;
  }
  chamfer(dist, NX, NZ, CELL);
  for (let o = 0; o < n; o++) shore[o] = wet[o] ? dist[o] : -dist[o];
  // ─── the ground: stepped granite cliffs, a low start bay, quays and the town's hill in the harbour ───
  const ground = new Float32Array(n);
  const harbourness = (x: number, z: number) => ss(GATE_Z - 10, GATE_Z + 30, z) * (1 - ss(1.0, 1.5, Math.hypot((x - basin.x) / basin.rx, (z - basin.z) / basin.rz)));
  const capeLift = (x: number, z: number) => {
    let h = 0;
    for (const k of capes) if (!k.cove && k.side * (x - centre(z)) > 0) h += 8 * Math.exp(-(((z - k.z) / (k.width * 1.4)) ** 2) - (((Math.abs(x - centre(z)) - half(z)) / 70) ** 2));
    return h;
  };
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const o = j * NX + i, x = X0 + i * CELL, z = Z0 + j * CELL, s = shore[o];
    const nz = 0.5 + 0.25 * Math.sin(x * 0.031 + ph[7]) * Math.sin(z * 0.027) + 0.25 * Math.sin((x + z) * 0.013 + ph[2]);
    const low = svc ? 0 : 1 - ss(-60, 60, z), hb = harbourness(x, z);
    const beachy = Math.max(low, coveAt(capes, x, z, centre));
    if (s >= 0) {
      const steep = -(1.0 + Math.min(15, s * 0.55)), gentle = -(0.25 + Math.min(15, s * 0.11));
      ground[o] = steep + (gentle - steep) * Math.max(beachy, hb * 0.2);
      if (hb > 0.5) ground[o] = Math.min(ground[o], -3.2 - Math.min(5, s * 0.3)); // (the harbour is dredged)
    } else {
      const d = -s + 2.2 * Math.sin(x * 0.17 + z * 0.11) * nz;
      // (one cliff face standing straight out of the sea — its jointed columns are added in dress — then the land rising gently behind; islets by kind)
      const [di, isl] = isletNear(x, z), onIslet = isl && di < 0 && di <= -s + 0.5;
      const P = onIslet ? (isl.kind === 'stacks' ? 16 + 10 * nz : isl.kind === 'reef' ? 1.4 + 1.2 * nz : 9 + 6 * nz) : 15 + 15 * nz + capeLift(x, z);
      const cliff = P * (0.06 * ss(0, 2, d) + 0.74 * ss(2.8, 6.2, d) + 0.2 * ss(8, 18, d));
      const beach = Math.min(4 + 6 * nz, Math.max(0, -s) * 0.09 + Math.max(0, -s - 30) * 0.3);
      const quay = (-s < 0.6 ? 2.7 * -s / 0.6 : 2.7) + Math.max(0, -s - 14) * 0.2;
      let h = cliff + (beach - cliff) * beachy;
      h = h + (Math.min(quay, 34) - h) * hb;
      ground[o] = h;
    }
  }
  const coast: Coast = {
    seed, kind, name: `${NAMES_A[hash(seed, 1) % NAMES_A.length]} ${NAMES_B[hash(seed, 2) % NAMES_B.length]}`,
    shore, ground, centre, gateX, islets, rocks: [], props: [], buoys: [], crafts: [], starts: [], berths: [], harbour: basin, pier, surf: new Float32Array(0), open: new Uint8Array(NNX * NNZ), exposure: new Float32Array(0),
  };
  exposeCoast(coast);
  // ─── where hulls may go: the navigation grid, and that the race can be run on it ───
  for (let j = 0; j < NNZ; j++) for (let i = 0; i < NNX; i++) {
    const x = X0 + (i + 0.5) * NAV, z = Z0 + (j + 0.5) * NAV;
    // (the Service's routes keep inside the search area)
    coast.open[j * NNX + i] = shoreAt(coast, x, z) > CLEAR + 3 && !(svc && (x < X0 + EDGE + 8 || x > X1 - EDGE - 8 || z < Z0 + EDGE + 8)) ? 1 : 0;
  }
  // (the Rally lines up off the station at the far end; the Service's crews start moored along the pier, and that's where
  // they come back to)
  const moor = (k: number) => ({ x: pier!.x1 - 7 - k * 11, z: pier!.z1 + 7, h: Math.PI / 2 });
  for (let k = 0; k < 5; k++) coast.starts.push(svc ? moor(k) : { x: centre(START_Z) + (k - 2) * 13, z: START_Z, h: 0 });
  const reach = flood(coast.open, navIndex(coast.starts[2].x, START_Z));
  const gateCell = navIndex(gateX, GATE_Z + 8);
  if (!force && (gateCell < 0 || reach[gateCell] === 0)) return null;
  for (let k = 0; k < 5; k++) coast.berths.push(svc ? moor(k) : { x: basin.x + (k - 2) * 9, z: basin.z + basin.rz - 12, h: 0 });
  dress(coast, rand, { west, east, capes, basin, harbourness, low: (z: number) => svc ? 0 : 1 - ss(-60, 60, z) });
  // (the buoys are in the way too: the water round each is closed to the routes, so a line of them is gone round, not through)
  for (const y of coast.buoys) for (let j = Math.floor((y.z - 5 - Z0) / NAV); j <= Math.floor((y.z + 5 - Z0) / NAV); j++) for (let i = Math.floor((y.x - 5 - X0) / NAV); i <= Math.floor((y.x + 5 - X0) / NAV); i++) {
    if (i < 0 || j < 0 || i >= NNX || j >= NNZ) continue;
    if (Math.hypot(X0 + (i + 0.5) * NAV - y.x, Z0 + (j + 0.5) * NAV - y.z) < 4.6) coast.open[j * NNX + i] = 0;
  }
  if (svc) { callOut(coast, rand, reach, west); return coast; }
  // (the little boats: spread evenly along the course and across it, each where it can be reached)
  const crafts = coast.crafts, N = 26, z0 = 70, z1 = GATE_Z - 80;
  for (let k = 0; k < N; k++) {
    for (let tries = 0; tries < 40; tries++) {
      const z = z0 + ((k + 0.5) / N) * (z1 - z0) + (rand() - 0.5) * 16;
      const x = west(z) + 24 + rand() * Math.max(10, east(z) - west(z) - 48);
      const cell = navIndex(x, z);
      if (shoreAt(coast, x, z) < 15 || cell < 0 || !reach[cell]) continue;
      if (crafts.some((c) => Math.hypot(c.x - x, c.z - z) < 24)) continue;
      if (coast.buoys.some((b) => Math.hypot(b.x - x, b.z - z) < 14)) continue;
      const kind: CraftKind = rand() < 0.55 ? 'row' : rand() < 0.5 ? 'sail' : 'kayak';
      const count = kind === 'kayak' ? 1 : kind === 'sail' ? 2 : 1 + Math.floor(rand() * 3);
      const people = Array.from({ length: count }, () => ({ skin: Math.floor(rand() * 6), hair: Math.floor(rand() * 6), shirt: Math.floor(rand() * 8), style: Math.floor(rand() * 3) }));
      crafts.push({ id: crafts.length, x, z, yaw: rand() * 6.283, kind, colour: Math.floor(rand() * 6), people, at: 0, zone: 0 });
      break;
    }
  }
  return coast;
}

/**
 * The Service's calls, and who's waiting: they come in through the voyage, from nearer to further. Near the harbour (the
 * approach and the coast just outside: a kayaker, a dinghy) from the start; along the coast (rowing boats, a dinghy
 * that's lost its wind) as the crews get going; then out at sea, the bigger ones (more aboard) last.
 */
function callOut(c: Coast, rand: Rand, reach: Uint8Array, west: (z: number) => number) {
  const zones = [
    // [how many, z from, z to, how far off the coast at most, the soonest and latest calls (s)]
    { n: 5, z0: GATE_Z - 400, z1: GATE_Z - 70, off: 1e9, min: 15, t0: 0, t1: 60 },
    { n: 7, z0: 230, z1: GATE_Z - 340, off: 120, min: 15, t0: 20, t1: 110 },
    { n: 6, z0: 210, z1: GATE_Z - 340, off: 1e9, min: 85, t0: 45, t1: 140 },
  ];
  const person = () => ({ skin: Math.floor(rand() * 6), hair: Math.floor(rand() * 6), shirt: Math.floor(rand() * 8), style: Math.floor(rand() * 3) });
  zones.forEach((Z, zone) => {
    for (let k = 0; k < Z.n; k++) for (let tries = 0; tries < 80; tries++) {
      const z = Z.z0 + ((k + rand()) / Z.n) * (Z.z1 - Z.z0), wx = west(z);
      const x = wx + 20 + rand() * Math.min(Z.off, X1 - EDGE - 30 - wx - 20);
      const cell = navIndex(x, z), s = shoreAt(c, x, z);
      if (s < Z.min || cell < 0 || !reach[cell]) continue;
      if (c.crafts.some((o) => Math.hypot(o.x - x, o.z - z) < 30)) continue;
      if (c.buoys.some((b) => Math.hypot(b.x - x, b.z - z) < 14)) continue;
      const kind: CraftKind = zone === 0 ? (rand() < 0.5 ? 'kayak' : 'row') : zone === 1 ? (rand() < 0.6 ? 'row' : rand() < 0.5 ? 'sail' : 'kayak') : rand() < 0.5 ? 'sail' : 'row';
      const count = kind === 'kayak' ? 1 : kind === 'sail' ? 2 : zone === 0 ? 1 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 2);
      // (the first three near the harbour are waiting as the crews set out)
      const at = zone === 0 && k < 3 ? 0 : Z.t0 + rand() * (Z.t1 - Z.t0);
      c.crafts.push({ id: c.crafts.length, x, z, yaw: rand() * 6.283, kind, colour: Math.floor(rand() * 6), people: Array.from({ length: count }, person), at, zone });
      break;
    }
  });
}

/** sandiness of a cove at (x, z): coves bite back into the cliffs with a little beach at their head */
function coveAt(capes: { z: number; side: number; width: number; cove: boolean }[], x: number, z: number, centre: (z: number) => number) {
  let b = 0;
  for (const k of capes) if (k.cove && k.side * (x - centre(z)) > 0) b = Math.max(b, Math.exp(-(((z - k.z) / (k.width * 0.8)) ** 2)));
  return ss(0.35, 0.8, b);
}

/** the distance to the nearest seeded sample, spread by two passes (3-4 chamfer, near enough) */
function chamfer(d: Float32Array, nx: number, nz: number, cell: number) {
  const a = cell, b = cell * Math.SQRT2;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const o = j * nx + i; let v = d[o];
    if (i > 0) v = Math.min(v, d[o - 1] + a);
    if (j > 0) { v = Math.min(v, d[o - nx] + a); if (i > 0) v = Math.min(v, d[o - nx - 1] + b); if (i < nx - 1) v = Math.min(v, d[o - nx + 1] + b); }
    d[o] = v;
  }
  for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const o = j * nx + i; let v = d[o];
    if (i < nx - 1) v = Math.min(v, d[o + 1] + a);
    if (j < nz - 1) { v = Math.min(v, d[o + nx] + a); if (i < nx - 1) v = Math.min(v, d[o + nx + 1] + b); if (i > 0) v = Math.min(v, d[o + nx - 1] + b); }
    d[o] = v;
  }
}

/** the open cells reachable from one (8-way) */
export function flood(open: Uint8Array, from: number) {
  const seen = new Uint8Array(open.length);
  if (from < 0 || !open[from]) return seen;
  const q = [from]; seen[from] = 1;
  while (q.length) {
    const o = q.pop()!, i = o % NNX, j = (o - i) / NNX;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= NNX || jj >= NNZ) continue;
      const p = jj * NNX + ii;
      if (open[p] && !seen[p]) { seen[p] = 1; q.push(p); }
    }
  }
  return seen;
}

/** the ground's dressing: boulders along every shore, lighthouses, cottages, the station, gorse; buoys; the surf line */
function dress(c: Coast, rand: Rand, k: {
  west: (z: number) => number; east: (z: number) => number;
  capes: { z: number; side: number; depth: number; width: number; cove: boolean }[];
  basin: { x: number; z: number; rx: number; rz: number };
  harbourness: (x: number, z: number) => number; low: (z: number) => number;
}) {
  const { rocks, props, buoys } = c;
  // ─── boulders: heaped along the shore and up the cliff steps, bigger at the water, none reaching past CLEAR ───
  const STEP = 3.1;
  for (let z = Z0 + 2; z < Z1 - 2; z += STEP) for (let x = X0 + 2; x < X1 - 2; x += STEP) {
    const jx = x + (rand() - 0.5) * STEP, jz = z + (rand() - 0.5) * STEP, s = shoreAt(c, jx, jz);
    if (s > 1.5 || s < -17) continue;
    const hb = k.harbourness(jx, jz), cove = k.low(jz);
    if (hb > 0.4) continue;
    const d = -s;
    // (under a cliff only a few, fallen at its foot; on beaches and low shores heaped at the waterline)
    const [ox, oz] = seaward(c, jx, jz), cliffy = groundAt(c, jx - ox * 6, jz - oz * 6) > 3 && cove < 0.5;
    const p = cliffy ? (d < 1 ? 0.42 : d < 6 ? 0.04 : 0.1) : (d < 3 ? 0.95 : d < 9 ? 0.55 : 0.3) * (1 - 0.7 * cove);
    if (rand() > p) continue;
    const reach = CLEAR - 0.2 + d; // how far it may spread toward the water
    let r = cliffy ? (d < 1 ? 1.1 + rand() * 1.6 : 0.8 + rand() * 1.2) : (d < 3 ? 2.2 + rand() * 3.2 : 1.4 + rand() * 2.6) * (1 - 0.45 * cove);
    r = Math.min(r, Math.max(0.8, reach));
    const g = groundAt(c, jx, jz), tall = 0.55 + rand() * 0.6;
    const cap = Math.max(0.8, reach);
    rocks.push({ x: jx, y: g - r * 0.35 * tall, z: jz, yaw: rand() * 6.283, sx: Math.min(cap, r * (0.85 + rand() * 0.4)), sy: r * tall, sz: Math.min(cap, r * (0.85 + rand() * 0.4)), kind: Math.floor(rand() * 4), tint: rand() });
  }
  // ─── the cliff faces: granite split along its joints — stacks of squarish blocks shoulder to shoulder along the shore,
  // as tall as the land behind them; each block a little set back, turned or narrower than the one below (ledges, the
  // rounded joints between them), the tops stepping up and down; none reaching past CLEAR ───
  const hash = new Map<number, [number, number][]>(), key = (x: number, z: number) => Math.floor(x / 6) * 100003 + Math.floor(z / 6);
  const crowded = (x: number, z: number, m: number) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const [px, pz] of hash.get(key(x + a * 6, z + b * 6)) ?? []) if (Math.hypot(px - x, pz - z) < m) return true;
    return false;
  };
  const STEPC = 2;
  for (let z = Z0 + 2; z < Z1 - 2; z += STEPC) for (let x = X0 + 2; x < X1 - 2; x += STEPC) {
    const jx = x + (rand() - 0.5) * STEPC, jz = z + (rand() - 0.5) * STEPC, s = shoreAt(c, jx, jz);
    if (s > -1.0 || s < -4.2) continue;
    if (k.harbourness(jx, jz) > 0.3) continue;
    const [ox, oz] = seaward(c, jx, jz), top = groundAt(c, jx - ox * 5.5, jz - oz * 5.5);
    if (top < 2.5 || crowded(jx, jz, 2.2 + rand() * 1.6)) continue;
    (hash.get(key(jx, jz)) ?? hash.set(key(jx, jz), []).get(key(jx, jz))!).push([jx, jz]);
    const tint = rand(), H = top + 0.8 - rand() * 2.4;
    let y = -3 - rand() * 2, bx = jx, bz = jz, r = Math.min(-s + CLEAR - 0.4, 2 + rand() * rand() * 3.4), yaw = rand() * 6.283;
    for (let n = 0; y < H - 0.4 && n < 9; n++) {
      // (the foot is one block from the seabed to above the tide; then blocks of 2.5-5 m)
      const h = Math.min(H - y, n === 0 ? 3.5 + rand() * 5 : (1.6 + rand() * 4.4) * (0.6 + r * 0.25));
      const cap = -shoreAt(c, bx, bz) + CLEAR - 0.35;
      if (cap < 1) break;
      rocks.push({ x: bx, y, z: bz, yaw, sx: Math.min(cap, r * (0.85 + rand() * 0.3)), sy: h + 0.3, sz: Math.min(cap, r * (0.65 + rand() * 0.45)), kind: COLUMN + Math.floor(rand() * 4), tint: (tint + n * 0.07) % 1 });
      y += h;
      const back = rand() < 0.4 ? 0.6 + rand() * 1.4 : rand() * 0.3, side = (rand() - 0.5) * 1.2;
      bx += -ox * back - oz * side; bz += -oz * back + ox * side;
      r = Math.max(1.6, r * (0.84 + rand() * 0.32)); yaw += (rand() - 0.5) * 1.2;
    }
  }
  // ─── lighthouses: on the biggest headland, the lighthouse islet, and either side of the harbour mouth ───
  const svc = c.kind === 'service';
  // (the Service's on the harbour's own headland: the light you steer for coming home)
  const cape = k.capes.filter((p) => !p.cove && (!svc || p.side > 0)).sort((a, b) => b.depth - a.depth)[0];
  if (cape) {
    const shoreX = cape.side < 0 ? k.west(cape.z) : k.east(cape.z), x = shoreX + cape.side * 14;
    props.push({ kind: 'lighthouse', x, y: groundAt(c, x, cape.z), z: cape.z, yaw: 0, s: 1.25, v: 0 });
    props.push({ kind: 'cottage', x: x + cape.side * 12, y: groundAt(c, x + cape.side * 12, cape.z + 8), z: cape.z + 8, yaw: Math.PI / 2, s: 0.9, v: 3 });
  }
  for (const i of c.islets) if (i.light) props.push({ kind: 'lighthouse', x: i.x, y: groundAt(c, i.x, i.z), z: i.z, yaw: 0, s: 1, v: 1 });
  for (const side of [-1, 1]) {
    const x = c.gateX + side * (GATE_HALF + 7);
    props.push({ kind: 'lighthouse', x, y: groundAt(c, x, GATE_Z), z: GATE_Z, yaw: 0, s: 0.62, v: side < 0 ? 2 : 4 });
    props.push({ kind: 'post', x: c.gateX + side * (GATE_HALF - 2), y: 0, z: GATE_Z, yaw: 0, s: 1, v: side });
  }
  // ─── the lifeboat station, its slipway down to the start bay (the Service's by the mouth, its slipway into the harbour
  // beside the pier; the pier's quay walls) ───
  const pier = c.pier;
  if (pier) {
    const x = k.basin.x - 62, z = GATE_Z + 36;
    props.push({ kind: 'station', x, y: Math.max(0.5, groundAt(c, x, z)), z, yaw: Math.PI / 2, s: 1, v: 0 });
    for (let x = pier.x1 - 2.9; x > pier.x0; x -= 5.8) {
      if (shoreAt(c, x, pier.z0 - 2) < 1 && shoreAt(c, x, pier.z1 + 2) < 1) break;
      props.push({ kind: 'quay', x, y: 0, z: pier.z0 + 0.3, yaw: 0, s: 1, v: 0 }, { kind: 'quay', x, y: 0, z: pier.z1 - 0.3, yaw: Math.PI, s: 1, v: 0 });
    }
    props.push({ kind: 'quay', x: pier.x1 - 0.3, y: 0, z: (pier.z0 + pier.z1) / 2, yaw: -Math.PI / 2, s: 1.2, v: 0 });
  } else {
    const z = -70, x = k.west(z) - 10;
    const [sx, sz] = seaward(c, x, z);
    props.push({ kind: 'station', x, y: Math.max(0.5, groundAt(c, x, z)), z, yaw: Math.atan2(sx, sz), s: 1, v: 0 });
  }
  // ─── the harbour: quay along its edge, cottages climbing the hill behind ───
  for (let a = 0; a < 6.283; a += 0.035) {
    const x = k.basin.x + Math.sin(a) * (k.basin.rx + 1), z = k.basin.z + Math.cos(a) * (k.basin.rz + 1);
    if (z < GATE_Z + 26 || (pier && shoreAt(c, x + Math.sin(a) * 2, z + Math.cos(a) * 2) > -0.5)) continue;
    props.push({ kind: 'quay', x, y: 0, z, yaw: a, s: 1, v: 0 });
  }
  for (let tries = 0; tries < 900 && props.filter((p) => p.kind === 'cottage').length < 34; tries++) {
    const a = (rand() - 0.5) * 3.6, rr = 1.12 + rand() * 0.55;
    const x = k.basin.x + Math.sin(a) * k.basin.rx * rr, z = k.basin.z + Math.cos(a) * k.basin.rz * rr;
    const s = shoreAt(c, x, z);
    if (s > -12 || z < GATE_Z + 30) continue;
    if (props.some((p) => (p.kind === 'cottage' || p.kind === 'lighthouse' || p.kind === 'station') && Math.hypot(p.x - x, p.z - z) < (p.kind === 'station' ? 22 : 12))) continue;
    props.push({ kind: 'cottage', x, y: groundAt(c, x, z), z, yaw: Math.atan2(k.basin.x - x, k.basin.z - z), s: 0.95 + rand() * 0.3, v: Math.floor(rand() * 4) });
  }
  // (a few cottages on the cliff tops; gorse in flower)
  for (let tries = 0; tries < 400; tries++) {
    const z = 60 + rand() * (GATE_Z - 200), side = rand() < 0.5 ? -1 : 1;
    const x = (side < 0 ? k.west(z) : k.east(z)) + side * (22 + rand() * 50), s = shoreAt(c, x, z);
    if (s > -16) continue;
    if (tries < 40 && rand() < 0.2 && !props.some((p) => p.kind === 'cottage' && Math.hypot(p.x - x, p.z - z) < 60))
      props.push({ kind: 'cottage', x, y: groundAt(c, x, z), z, yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2, s: 1, v: Math.floor(rand() * 4) });
    else props.push({ kind: 'gorse', x, y: groundAt(c, x, z), z, yaw: rand() * 6.28, s: 0.8 + rand() * 1.4, v: rand() < 0.6 ? 1 : 0 });
  }
  // ─── the channel buoys: red to the west, green to the east, in pairs up the course ───
  const findOff = (z: number, side: number, want: number) => {
    let x = side < 0 ? k.west(z) : k.east(z);
    for (let i = 0; i < 60 && shoreAt(c, x, z) < want; i++) x -= side * 2;
    return x;
  };
  // (the Service's only up the approach to the harbour)
  for (let z = svc ? GATE_Z - 250 : 90; z < GATE_Z - 30; z += 120 + rand() * 40) for (const side of [-1, 1]) buoys.push({ x: findOff(z, side, 16), z, kind: side < 0 ? 'red' : 'green' });
  for (const side of [-1, 1]) buoys.push({ x: c.gateX + side * (GATE_HALF - 6), z: GATE_Z - 40, kind: side < 0 ? 'red' : 'green' });
  for (const i of c.islets) {
    const dx = c.centre(i.z) - i.x, l = Math.abs(dx) || 1;
    // (a yellow mark off some of the rocks, in open water and not one beside another, so there's always room to pass)
    const bx = i.x + (dx / l) * (i.r + 11), bz = i.z - 6;
    if (rand() < 0.5 && shoreAt(c, bx, bz) >= 12 && !buoys.some((y) => Math.hypot(y.x - bx, y.z - bz) < 24)) buoys.push({ x: bx, z: bz, kind: 'yellow' });
  }
  for (let b = buoys.length - 1; b >= 0; b--) if (shoreAt(c, buoys[b].x, buoys[b].z) < 8) buoys.splice(b, 1);
  // ─── the surf line: points just off every shore, near enough for spray ───
  const surf: number[] = [];
  for (let j = 0; j < NZ; j += 2) for (let i = 0; i < NX; i += 2) {
    const s = c.shore[j * NX + i];
    if (s < 0.5 || s > 2.5) continue;
    const x = X0 + i * CELL, z = Z0 + j * CELL, [nx, nz] = seaward(c, x, z);
    surf.push(x, z, nx, nz);
  }
  c.surf = new Float32Array(surf);
}

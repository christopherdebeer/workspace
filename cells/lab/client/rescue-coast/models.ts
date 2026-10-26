/**
 * The things, modelled after the concept boards: toy-like and glossy, chunky enough to read on a phone.
 *
 * - **the lifeboat**: a navy hull, red below the waterline, RNLI in white along the bow; the wheelhouse, the gunwale and
 *   the pennant in the boat's own colour (orange, red, blue, yellow, green: the boat-choice cards); a tall black mast
 *   with its radar bar and blue beacon; lifebuoys, rails, an upper steering position for the crew.
 * - **people**: big-headed, round, in lifejackets; the crew in yellow with white helmets; arms that move (wave, reach,
 *   climb).
 * - **little boats**: rowing dinghies, kayaks and sailing dinghies in bright colours.
 * - **the coast**: faceted granite boulders (a small library, drawn many times), lighthouses with red bands, cottages,
 *   the lifeboat station and its slipway, gorse, the harbour's quay, the finish banner.
 */
import { Builder, M, SRC, WHITE, join, smooth, type Mesh, type RGB, type V3 } from './shapes';
import { seeded } from '../kit/rng';

const NAVY: RGB = [0.05, 0.11, 0.3], BOOT: RGB = [0.75, 0.09, 0.07], DECK: RGB = [0.6, 0.63, 0.64], BLACK: RGB = [0.06, 0.06, 0.07];
const STEEL: RGB = [0.85, 0.87, 0.88], GLASS: RGB = [0.06, 0.1, 0.15], ORANGE: RGB = [1, 0.38, 0.04], ROPE: RGB = [0.98, 0.82, 0.2];

// ─── the lifeboat ───

/** the hull's shape: t from 0 at the transom to 1 at the stem */
export const HULL = { z0: -5.4, z1: 5.6 };
const hb = (t: number) => t < 0.5 ? 2.0 + 0.1 * Math.sin((t / 0.5) * Math.PI / 2) : 2.1 * Math.pow(Math.max(0, 1 - Math.pow((t - 0.5) / 0.5, 2.2)), 0.6);
export const sheer = (t: number) => 1.25 + 0.22 * t + 0.6 * t ** 4;
const keel = (t: number) => t < 0.7 ? -0.62 - 0.23 * Math.min(1, t / 0.25) : -0.85 + 1.5 * ((t - 0.7) / 0.3) ** 1.8;
export const tAt = (z: number) => (z - HULL.z0) / (HULL.z1 - HULL.z0);
/** the deck's height at a point along the boat */
export const deckAt = (z: number) => sheer(Math.max(0, Math.min(1, tAt(z)))) - 0.1;
/** the deck's half width at a point along the boat */
export const deckHalf = (z: number) => Math.max(0, hb(Math.max(0, Math.min(1, tAt(z)))) - 0.25);

function section(t: number): V3[] {
  const b = hb(t), s = sheer(t), k = keel(t), z = HULL.z0 + t * (HULL.z1 - HULL.z0), chine = Math.min(-0.02, k * 0.25 + 0.05);
  const half: [number, number][] = [[0, k], [0.45 * b, k + 0.17 + 0.1 * t], [0.86 * b, chine], [0.97 * b, chine + 0.4], [b, (chine + s) / 2 + 0.25], [b, s]];
  return [...half.slice(1).reverse().map(([x, y]) => [-x, y, z] as V3), ...half.map(([x, y]) => [x, y, z] as V3)];
}

export function lifeboat(): Mesh {
  const b = new Builder();
  // (the hull: lofted sections; red below the boot-top, navy above)
  const rows: V3[][] = [];
  for (let i = 0; i <= 26; i++) rows.push(section(Math.min(1, i / 26) * 0.999));
  b.use(0, SRC.OWN, M.PAINT);
  b.loft(rows, (p) => (p[1] < 0.22 ? BOOT : NAVY));
  // (the transom: fanned shut)
  const tr = rows[0], mid: V3 = [0, (keel(0) + sheer(0)) / 2, HULL.z0];
  for (let i = 0; i < tr.length - 1; i++) b.tri(mid, tr[i + 1], tr[i], (tr[i][1] + tr[i + 1][1]) / 2 < 0.22 ? BOOT : NAVY);
  b.tri(mid, tr[0], tr[tr.length - 1], NAVY);
  // (the deck, grey, a hand's width below the gunwale)
  const deck: V3[][] = [];
  for (let i = 0; i <= 24; i++) { const t = (i / 24) * 0.985, z = HULL.z0 + t * (HULL.z1 - HULL.z0), w = Math.max(0.02, hb(t) - 0.12), y = sheer(t) - 0.1; deck.push([[w, y, z], [0, y + 0.03, z], [-w, y, z]]); }
  b.use(0, SRC.OWN, M.MATTE); b.loft(deck, () => DECK);
  // (the gunwale in the boat's colour, a black rubbing strake under it)
  const edge = (side: number, dy: number, out: number) => rows.map((r) => { const p = r[side < 0 ? 0 : r.length - 1]; return [p[0] + side * out, p[1] + dy, p[2]] as V3; });
  for (const side of [-1, 1]) {
    const top = edge(side, 0.08, 0.02), rub = edge(side, -0.32, 0.07);
    b.use(0, SRC.A, M.PAINT);
    for (let i = 0; i < top.length - 1; i++) b.tube(top[i], top[i + 1], 0.16, WHITE, 8);
    b.use(0, SRC.OWN, M.SOFT);
    for (let i = 0; i < rub.length - 2; i++) b.tube(rub[i], rub[i + 1], 0.11, BLACK, 6);
  }
  b.use(0, SRC.A, M.PAINT); b.tube([-1.95, sheer(0) + 0.08, HULL.z0 + 0.02], [1.95, sheer(0) + 0.08, HULL.z0 + 0.02], 0.16, WHITE, 8);
  // (RNLI along the bow, both sides, following the hull's flare)
  b.use(0, SRC.OWN, M.PAINT);
  for (const side of [-1, 1]) letters(b, 'RNLI', side, 0.3, 0.33, 0.092);
  // ─── the wheelhouse ───
  const wz = -0.9, wy = deckAt(wz);
  b.use(0, SRC.A, M.PAINT);
  b.roundBox([0, wy + 0.82, wz], [1.62, 0.84, 1.9], 0.3, WHITE, 4);
  // (its windows: wrapped round the front and along the sides)
  b.use(0, SRC.OWN, M.WINDOW);
  for (const x of [-0.95, 0, 0.95]) b.quad([x - 0.42, wy + 1.0, wz + 1.91], [x + 0.42, wy + 1.0, wz + 1.91], [x + 0.42, wy + 1.5, wz + 1.91], [x - 0.42, wy + 1.5, wz + 1.91], GLASS);
  for (const side of [-1, 1]) for (const z of [wz - 1.2, wz, wz + 1.1]) {
    const x = side * 1.63, q: V3[] = [[x, wy + 1.0, z - 0.45], [x, wy + 1.0, z + 0.45], [x, wy + 1.5, z + 0.45], [x, wy + 1.5, z - 0.45]];
    if (side < 0) b.quad(q[0], q[1], q[2], q[3], GLASS); else b.quad(q[1], q[0], q[3], q[2], GLASS);
  }
  // (the roof: pale, with the upper steering position at its front, rails round it)
  const ry = wy + 1.68;
  b.use(0, SRC.OWN, M.PAINT); b.roundBox([0, ry + 0.06, wz], [1.74, 0.08, 2.04], 0.07, [0.92, 0.92, 0.9], 3);
  b.use(0, SRC.A, M.PAINT); b.roundBox([0, ry + 0.45, wz + 1.25], [1.0, 0.36, 0.28], 0.1, WHITE, 3);
  b.use(0, SRC.OWN, M.GLASS); b.quad([-0.85, ry + 0.82, wz + 1.38], [0.85, ry + 0.82, wz + 1.38], [0.85, ry + 1.25, wz + 1.18], [-0.85, ry + 1.25, wz + 1.18], [0.2, 0.3, 0.36]);
  b.use(0, SRC.OWN, M.GLASS);
  for (const [x0, z0, x1, z1] of [[-1.6, -2.75, 1.6, -2.75], [-1.6, -2.75, -1.6, 0.6], [1.6, -2.75, 1.6, 0.6]] as const) b.tube([x0, ry + 0.75, wz + z0 + 0.9], [x1, ry + 0.75, wz + z1 + 0.9], 0.045, STEEL, 6);
  for (const [x, z] of [[-1.6, -1.85], [1.6, -1.85], [-1.6, 0], [1.6, 0], [-1.6, 1.5], [1.6, 1.5], [0, -1.85]]) b.tube([x, ry + 0.1, wz + z], [x, ry + 0.75, wz + z], 0.04, STEEL, 6);
  // (lifebuoys on the wheelhouse sides, a searchlight)
  b.use(0, SRC.OWN, M.PAINT);
  for (const side of [-1, 1]) {
    b.basis([side * 1.66, wy + 0.7, wz - 0.2], [0, 0, 1], [0, 1, 0], [side, 0, 0]);
    b.torus([0, 0, 0], 0.36, 0.11, (i) => (Math.floor(i / 2) % 2 ? WHITE : ORANGE), 16, 6);
    b.at();
  }
  b.at(0.9, ry + 0.12, wz + 1.7); b.lathe([[0.12, 0], [0.16, 0.18], [0.2, 0.32], [0.2, 0.42], [0, 0.44]], [0.2, 0.2, 0.22], 10); b.at();
  // ─── the mast: black, tall, with its radar bar, beacon and lights; the pennant in the boat's colour ───
  const mz = wz - 1.0;
  b.use(0, SRC.OWN, M.PAINT);
  for (const side of [-1, 1]) b.tube([side * 0.75, ry + 0.1, mz], [side * 0.42, ry + 3.0, mz + 0.15], 0.1, BLACK, 8);
  for (const y of [1.25, 2.4]) b.tube([-0.7 + y * 0.1, ry + y, mz + y * 0.05], [0.7 - y * 0.1, ry + y, mz + y * 0.05], 0.07, BLACK, 6);
  b.box(-1.0, 1.0, ry + 3.0, ry + 3.16, mz - 0.12, mz + 0.42, BLACK);
  b.box(-0.85, 0.85, ry + 3.2, ry + 3.32, mz + 0.05, mz + 0.3, [0.93, 0.93, 0.93]);
  b.tube([0, ry + 3.32, mz + 0.15], [0, ry + 4.35, mz + 0.15], 0.05, BLACK, 6);
  for (const side of [-1, 1]) b.tube([side * 0.75, ry + 3.16, mz + 0.15], [side * 0.75, ry + 4.1, mz + 0.15], 0.025, BLACK, 4);
  b.use(0, SRC.OWN, M.LIT);
  b.at(0, ry + 3.32, mz + 0.42); b.lathe([[0.13, 0], [0.13, 0.22], [0.06, 0.3], [0, 0.32]], [0.25, 0.5, 1], 10); b.at();
  b.sphere([0, ry + 4.4, mz + 0.15], 0.08, [1, 1, 0.92], [1, 1, 1], 4, 6);
  b.sphere([0.95, ry + 3.08, mz + 0.5], 0.07, [0.2, 1, 0.3], [1, 1, 1], 3, 5); b.sphere([-0.95, ry + 3.08, mz + 0.5], 0.07, [1, 0.2, 0.15], [1, 1, 1], 3, 5);
  pennant(b, [0, ry + 4.25, mz + 0.15], 1.2, 0.5);
  // ─── the aft deck: rails, a tow post, a coil of line ───
  b.use(0, SRC.OWN, M.GLASS);
  const ay = sheer(0) + 0.82;
  for (const side of [-1, 1]) {
    b.tube([side * 1.9, ay, HULL.z0 + 0.2], [side * 1.95, ay, wz - 2.2], 0.045, STEEL, 6);
    for (const z of [HULL.z0 + 0.2, -3.6, wz - 2.2]) b.tube([side * 1.93, deckAt(z), z], [side * 1.93, ay, z], 0.04, STEEL, 6);
  }
  b.tube([-1.9, ay, HULL.z0 + 0.2], [1.9, ay, HULL.z0 + 0.2], 0.045, STEEL, 6);
  // (the bow's rail, the pulpit)
  const bowRail: V3[] = [];
  for (let i = 0; i <= 8; i++) { const z = 2.4 + (i / 8) * 2.7, t = tAt(z), w = Math.max(0.05, hb(t) - 0.15); bowRail.push([w, sheer(t) + 0.75, z]); }
  for (const side of [-1, 1]) for (let i = 0; i < bowRail.length - 1; i++) b.tube([bowRail[i][0] * side, bowRail[i][1], bowRail[i][2]], [bowRail[i + 1][0] * side, bowRail[i + 1][1], bowRail[i + 1][2]], 0.045, STEEL, 6);
  for (const i of [0, 4, 8]) for (const side of [-1, 1]) b.tube([bowRail[i][0] * side, bowRail[i][1] - 0.75, bowRail[i][2]], [bowRail[i][0] * side, bowRail[i][1], bowRail[i][2]], 0.04, STEEL, 6);
  b.use(0, SRC.OWN, M.PAINT);
  b.tube([0, deckAt(-4.6), -4.6], [0, deckAt(-4.6) + 0.55, -4.6], 0.13, BLACK, 8);
  b.basis([-1.0, deckAt(-4.5) + 0.06, -4.5], [1, 0, 0], [0, 0, 1], [0, 1, 0]);
  b.use(0, SRC.OWN, M.SOFT);
  for (let k = 0; k < 3; k++) b.torus([0, 0, k * 0.07], 0.32 - k * 0.04, 0.05, () => ROPE, 14, 4);
  b.at();
  return smooth(b.done(), 0.75);
}

/** block letters following the hull's side, starting `z0` along it, their foot at `y0` */
function letters(b: Builder, s: string, side: number, z0: number, y0: number, px: number) {
  const wide = (s.length * 6 - 1) * px;
  let col = 0;
  for (const ch of s) {
    const g = GLYPH_ROWS[ch];
    for (let row = 0; row < 7; row++) for (let c = 0; c < 5; c++) if (g[row][c] === '#') {
      // (read from outside: on the +x side the reading runs aft, on the -x side forward)
      const P = (u: number, v: number): V3 => {
        const k = (col + c + u) * px, z = side > 0 ? z0 + wide - k : z0 + k, y = y0 + (6 - row + v) * px, t = tAt(z);
        return [side * (Math.min(hb(t), interpHalf(t, y)) + 0.025), y, z];
      };
      b.quad(P(0, 0), P(1, 0), P(1, 1), P(0, 1), WHITE);
    }
    col += 6;
  }
}
/** the hull's half width at a height (between the sections' points) */
function interpHalf(t: number, y: number) {
  const sec = section(t).slice(5);
  for (let i = 0; i < sec.length - 1; i++) {
    const [x0, y0] = sec[i], [x1, y1] = sec[i + 1];
    if (y >= Math.min(y0, y1) && y <= Math.max(y0, y1)) return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0 || 1);
  }
  return hb(t);
}
/** a swallow-tailed pennant trailing aft from a staff (it flutters) */
function pennant(b: Builder, top: V3, len: number, h: number) {
  b.use(3, SRC.A, M.SAIL);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const u0 = i / n, u1 = (i + 1) / n, w0 = h * (1 - u0 * 0.55), w1 = h * (1 - u1 * 0.55);
    const p = (u: number, w: number, dy: number): V3 => [0, top[1] - h / 2 + dy + (h - w) / 2 + w * 0, top[2] - u * len];
    const a = p(u0, w0, 0), bq = p(u1, w1, 0), c = p(u1, w1, w1), d = p(u0, w0, w0);
    b.part = 3 + u0 * 0.99; b.v(a, [1, 0, 0], WHITE); b.part = 3 + u1 * 0.99; b.v(bq, [1, 0, 0], WHITE); b.v(c, [1, 0, 0], WHITE);
    b.part = 3 + u0 * 0.99; b.v(a, [1, 0, 0], WHITE); b.part = 3 + u1 * 0.99; b.v(c, [1, 0, 0], WHITE); b.part = 3 + u0 * 0.99; b.v(d, [1, 0, 0], WHITE);
  }
  b.part = 0;
}

/** where the rescued stand and sit: aft deck, foredeck, the side decks, the wheelhouse roof [across, along] */
export const SEATS: [number, number][] = (() => {
  const s: [number, number][] = [];
  for (const z of [-3.15, -3.85, -4.55]) for (const x of [-1.25, -0.42, 0.42, 1.25]) s.push([x, z]);
  for (const [z, xs] of [[1.55, [-1.05, -0.35, 0.35, 1.05]], [2.35, [-0.8, 0, 0.8]], [3.15, [-0.45, 0.45]], [3.85, [0]]] as const) for (const x of xs) s.push([x, z]);
  for (const z of [-2.3, -1.3, -0.3, 0.7]) for (const x of [-1.86, 1.86]) s.push([x, z]);
  return s;
})();
/** the roof, for when the decks are full (across, along, height above the deck) */
export const ROOF: [number, number][] = [[-1.0, -2.2], [1.0, -2.2], [-1.0, -1.4], [1.0, -1.4], [0, -2.5], [-1.05, -0.6], [1.05, -0.6]];
export const ROOF_Y = deckAt(-0.9) + 1.76;

// ─── people ───

/** the shoulders, about which the arms turn */
export const SHOULDER = [0.29, 0.8] as const;

export function person(kind: 'crew' | 'kid', style = 0): Mesh {
  const b = new Builder(), JACKET: RGB = kind === 'crew' ? [0.95, 0.24, 0.08] : ORANGE;
  // (legs and boots)
  b.use(0, kind === 'crew' ? SRC.A : SRC.OWN, M.SOFT);
  for (const x of [-0.11, 0.11]) b.roundBox([x, 0.22, 0], [0.095, 0.17, 0.11], 0.08, kind === 'crew' ? WHITE : [0.22, 0.28, 0.45], 2);
  b.use(0, SRC.OWN, M.PAINT);
  for (const x of [-0.11, 0.11]) b.roundBox([x, 0.05, 0.03], [0.1, 0.06, 0.14], 0.05, kind === 'crew' ? BLACK : [0.95, 0.95, 0.95], 2);
  // (the body in its shirt or jacket; the lifejacket over it, with its reflective tape)
  b.use(0, SRC.A, M.SOFT); b.roundBox([0, 0.58, 0], [0.24, 0.24, 0.17], 0.12, WHITE, 2);
  b.use(0, SRC.OWN, M.SOFT); b.roundBox([0, 0.62, 0.01], [0.265, 0.19, 0.2], 0.12, JACKET, 2);
  b.use(0, SRC.OWN, M.GLASS); for (const x of [-0.13, 0.13]) b.box(x - 0.035, x + 0.035, 0.58, 0.74, 0.205, 0.215, [0.85, 0.88, 0.9]);
  // (the arms: sleeve, then a hand; each turns about its shoulder)
  for (const [side, part] of [[1, 1], [-1, 2]] as const) {
    b.use(part, SRC.A, M.SOFT); b.tube([side * SHOULDER[0], SHOULDER[1], 0], [side * 0.31, 0.47, 0.02], 0.075, WHITE, 7);
    b.use(part, SRC.B, M.SOFT); b.sphere([side * 0.31, 0.42, 0.02], 0.08, WHITE, [1, 1, 1], 4, 6);
  }
  // (the head: big and round; eyes, cheeks, a smile)
  b.use(0, SRC.B, M.SOFT); b.sphere([0, 1.08, 0], 0.3, WHITE, [1.06, 0.97, 1], 8, 12);
  b.use(0, SRC.OWN, M.PAINT);
  for (const x of [-0.1, 0.1]) b.sphere([x, 1.11, 0.275], 0.038, [0.05, 0.04, 0.04], [1, 1.25, 0.5], 3, 6);
  b.use(0, SRC.OWN, M.SOFT);
  for (const x of [-0.18, 0.18]) b.sphere([x, 1.0, 0.24], 0.05, [0.98, 0.55, 0.5], [1, 0.7, 0.5], 3, 6);
  b.use(0, SRC.OWN, M.MATTE);
  for (let i = 0; i < 4; i++) { const a0 = -0.6 + i * 0.3, a1 = a0 + 0.3; b.tube([Math.sin(a0) * 0.08, 0.99 - Math.cos(a0) * 0.03, 0.29], [Math.sin(a1) * 0.08, 0.99 - Math.cos(a1) * 0.03, 0.29], 0.012, [0.35, 0.12, 0.1], 4); }
  if (kind === 'crew') {
    // (the white helmet, its visor and strap)
    b.use(0, SRC.OWN, M.PAINT);
    b.sphere([0, 1.12, -0.01], 0.345, [0.97, 0.97, 0.96], [1.04, 0.95, 1.04], 5, 12, Math.PI * 0.53);
    b.box(-0.25, 0.25, 1.2, 1.24, 0.24, 0.37, [0.97, 0.97, 0.96]);
    b.use(0, SRC.OWN, M.GLASS); b.box(-0.2, 0.2, 1.13, 1.2, 0.3, 0.34, [0.15, 0.18, 0.22]);
  } else {
    b.use(0, SRC.C, M.SOFT);
    b.sphere([0, 1.12, -0.02], 0.322, WHITE, [1.06, 0.97, 1.05], 5, 12, Math.PI * (style === 1 ? 0.6 : 0.52));
    if (style === 1) for (const x of [-0.27, 0.27]) b.sphere([x, 1.0, -0.12], 0.1, WHITE, [0.8, 1.3, 0.8], 4, 6);
    if (style === 2) b.sphere([0, 1.3, -0.2], 0.13, WHITE, [1, 1, 1], 4, 8);
    if (style === 0) b.sphere([0, 1.2, 0.18], 0.16, WHITE, [1.4, 0.45, 0.8], 4, 8);
  }
  return b.done();
}

// ─── little boats ───

function smallHull(len: number, beam: number, depth: number, pointy: boolean): V3[][] {
  const rows: V3[][] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, z = -len / 2 + t * len;
    const w = pointy ? beam / 2 * Math.pow(Math.sin(Math.PI * Math.min(0.995, Math.max(0.005, t))), 0.7) : beam / 2 * (t < 0.6 ? 0.82 + 0.18 * Math.sin((t / 0.6) * Math.PI / 2) : Math.pow(Math.max(0, 1 - ((t - 0.6) / 0.4) ** 2), 0.55));
    const top = depth * 0.55 + 0.12 * t * t, bot = -depth * 0.45 + (pointy ? 0.1 * Math.abs(t - 0.5) : 0.18 * Math.max(0, t - 0.75) / 0.25);
    const sec: [number, number][] = [[0, bot], [w * 0.6, bot + 0.05], [w * 0.95, (bot + top) / 2], [w, top]];
    rows.push([...sec.slice(1).reverse().map(([x, y]) => [-x, y, z] as V3), ...sec.map(([x, y]) => [x, y, z] as V3)]);
  }
  return rows;
}
export function craftMesh(kind: 'row' | 'kayak' | 'sail'): Mesh {
  const b = new Builder();
  if (kind === 'kayak') {
    const rows = smallHull(3.6, 0.72, 0.42, true);
    b.use(0, SRC.A, M.PAINT); b.loft(rows, () => WHITE);
    const deck: V3[][] = rows.map((r) => { const p = r[r.length - 1], z = p[2]; return [[p[0], p[1], z], [0, p[1] + 0.08, z], [-p[0], p[1], z]]; });
    b.loft(deck, () => WHITE);
    b.use(0, SRC.OWN, M.MATTE); b.at(0, 0.27, -0.1, 0, [1, 1, 1.5]); b.lathe([[0.3, 0], [0.3, 0.04], [0, 0.04]], [0.08, 0.08, 0.1], 12); b.at();
    b.use(0, SRC.OWN, M.PAINT); b.tube([-1.1, 0.55, 0.25], [1.1, 0.75, 0.25], 0.03, BLACK, 5);
    for (const s of [-1, 1]) b.at(s * 1.15, 0.55 + (s + 1) * 0.1, 0.25, 0, [1, 1, 1]), b.roundBox([0, 0, 0], [0.22, 0.03, 0.09], 0.02, [1, 0.85, 0.1], 2), b.at();
    return smooth(b.done(), 0.7);
  }
  const len = kind === 'sail' ? 3.7 : 3.3, rows = smallHull(len, 1.55, 0.62, false);
  b.use(0, SRC.A, M.PAINT); b.loft(rows, () => WHITE);
  // (inside: white, a little in from the outside; seats; the rim)
  const inner = rows.map((r) => r.map((p) => [p[0] * 0.9, p[1] * 0.85 + 0.05, p[2] * 0.97] as V3).reverse());
  b.use(0, SRC.OWN, M.PAINT); b.loft(inner, () => [0.95, 0.95, 0.93]);
  const transom = rows[0];
  for (let i = 0; i < transom.length - 1; i++) b.tri([0, 0.1, transom[0][2]], transom[i + 1], transom[i], [0.95, 0.95, 0.93]);
  b.use(0, SRC.OWN, M.PAINT);
  const rimL = rows.map((r) => r[r.length - 1]), rimR = rows.map((r) => r[0]);
  for (const rim of [rimL, rimR]) for (let i = 0; i < rim.length - 1; i++) b.tube(rim[i], rim[i + 1], 0.05, [0.97, 0.97, 0.95], 5);
  b.tube(rimL[0], rimR[0], 0.05, [0.97, 0.97, 0.95], 5);
  b.use(0, SRC.OWN, M.MATTE);
  for (const z of [0.6 - len / 2 + 0.6, 0.15, -0.9]) b.box(-0.62, 0.62, 0.12, 0.18, z - 0.13, z + 0.13, [0.72, 0.5, 0.3]);
  if (kind === 'row') {
    // (the oars, shipped across the gunwales)
    for (const s of [-1, 1]) {
      b.tube([s * 0.4, 0.42, 0.9], [s * 1.6, 0.25, -1.0], 0.035, [0.75, 0.55, 0.32], 5);
      b.basis([s * 1.65, 0.24, -1.1], [Math.cos(0.6) * s, 0, Math.sin(0.6)], [0, 1, 0], [-Math.sin(0.6) * s, 0, Math.cos(0.6)]);
      b.box(-0.08, 0.08, -0.02, 0.02, -0.3, 0.3, [0.75, 0.55, 0.32]); b.at();
    }
  } else {
    // (a mast, a boom, and a white sail that flutters along its leech)
    b.use(0, SRC.OWN, M.PAINT);
    b.tube([0, 0.15, 0.7], [0, 3.6, 0.7], 0.045, [0.8, 0.8, 0.82], 6);
    b.tube([0, 0.95, 0.7], [0, 0.95, -1.5], 0.04, [0.8, 0.8, 0.82], 6);
    b.use(3, SRC.OWN, M.SAIL);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const y0 = 1.0 + (i / n) * 2.5, y1 = 1.0 + ((i + 1) / n) * 2.5, l0 = 2.15 * (1 - i / n), l1 = 2.15 * (1 - (i + 1) / n);
      const V = (y: number, l: number, w: number): [V3, number] => [[0, y, 0.68 - l], 3 + Math.min(0.99, w)];
      const q = [V(y0, 0, 0), V(y0, l0, l0 / 2.2), V(y1, l1, l1 / 2.2), V(y1, 0, 0)];
      for (const k of [0, 1, 2, 0, 2, 3]) { b.part = q[k][1]; b.v(q[k][0], [1, 0, 0], [0.98, 0.98, 0.96]); }
    }
    b.part = 0;
    b.use(0, SRC.OWN, M.PAINT); b.box(-0.02, 0.02, 2.6, 2.95, 0.72, 0.95, [0.9, 0.12, 0.1]);
  }
  return smooth(b.done(), 0.7);
}

// ─── buoys ───

export function buoyMesh(kind: 'red' | 'green' | 'yellow'): Mesh {
  const b = new Builder(), col: RGB = kind === 'red' ? [0.88, 0.1, 0.08] : kind === 'green' ? [0.08, 0.6, 0.25] : [1, 0.8, 0.05];
  b.use(0, SRC.OWN, M.PAINT);
  b.lathe([[0, -0.5], [0.75, -0.45], [0.85, -0.1], [0.8, 0.25], [0.45, 0.35]], col, 14);
  if (kind === 'green') b.lathe([[0.55, 0.35], [0.5, 0.9], [0.2, 1.9], [0, 2.1]], col, 14);
  else b.lathe([[0.45, 0.35], [0.42, 1.8], [0.38, 1.85], [0, 1.85]], (i) => kind === 'yellow' && i === 1 ? BLACK : col, 14);
  b.tube([0, 1.8, 0], [0, 2.5, 0], 0.04, BLACK, 5);
  if (kind === 'red') { b.at(0, 2.45, 0); b.lathe([[0.2, 0], [0.2, 0.35], [0, 0.35]], col, 10); b.at(); }
  if (kind === 'green') { b.at(0, 2.4, 0); b.lathe([[0.22, 0], [0, 0.4]], col, 10); b.at(); }
  if (kind === 'yellow') { b.at(0, 2.4, 0); b.lathe([[0, 0], [0.2, 0.25], [0, 0.25]], BLACK, 8); b.lathe([[0, 0.3], [0.2, 0.55], [0, 0.55]], BLACK, 8); b.at(); }
  b.use(0, SRC.OWN, M.LIT); b.sphere([0, 2.0, 0], 0.09, kind === 'red' ? [1, 0.3, 0.2] : kind === 'green' ? [0.3, 1, 0.4] : [1, 1, 0.7], [1, 1, 1], 3, 6);
  return smooth(b.done(), 0.7);
}

// ─── granite ───

/** a boulder: a cube rounded toward a sphere, then chipped by a few planes (flat facets with soft edges) */
export function boulder(seed: number, n: number): Mesh {
  const rand = seeded(seed * 7919 + 13), b = new Builder();
  const cuts: { n: V3; d: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const a = rand() * 6.283, e = (rand() - 0.25) * 1.4, nn: V3 = [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)];
    cuts.push({ n: nn, d: 0.62 + rand() * 0.28 });
  }
  const P = (q: V3): V3 => {
    const l = Math.hypot(q[0], q[1], q[2]);
    let p: V3 = [q[0] * 0.45 + (q[0] / l) * 0.62, q[1] * 0.45 + (q[1] / l) * 0.62, q[2] * 0.45 + (q[2] / l) * 0.62];
    for (const c of cuts) { const d = p[0] * c.n[0] + p[1] * c.n[1] + p[2] * c.n[2]; if (d > c.d) p = [p[0] - c.n[0] * (d - c.d), p[1] - c.n[1] * (d - c.d), p[2] - c.n[2] * (d - c.d)]; }
    const w = 0.035 * Math.sin(p[0] * 7.1 + seed) * Math.sin(p[2] * 6.3 - seed) + 0.03 * Math.sin(p[1] * 9.7 + seed * 2);
    return [p[0] * (1 + w), Math.max(-0.75, p[1] * (1 + w)), p[2] * (1 + w)];
  };
  // (darker underneath, where it's shaded and wet)
  const shade = (y: number): RGB => { const k = 0.62 + 0.38 * Math.max(0, Math.min(1, (y + 0.7) / 1.3)); return [k, k, k]; };
  b.use(0, SRC.A, M.ROCK);
  const faces: [number, number, number, number][] = [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]];
  for (const [a, u, w, s] of faces) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const q = (ii: number, jj: number): V3 => { const v: V3 = [0, 0, 0]; v[a] = s; v[u] = (2 * ii) / n - 1; v[w] = (2 * jj) / n - 1; return P(v); };
    const p = [q(i, j), q(i + 1, j), q(i + 1, j + 1), q(i, j + 1)], c = shade((p[0][1] + p[2][1]) / 2);
    // (each facet flat; the smoothing below rounds the shallow folds and keeps the chips)
    b.triOut([0, 0, 0], p[0], p[1], p[2], c); b.triOut([0, 0, 0], p[0], p[2], p[3], c);
  }
  return smooth(b.done(), 0.8);
}

// ─── ashore ───

function lump(b: Builder, c: V3, r: number, seed: number, col: (k: number) => RGB) {
  const rand = seeded(seed), rings = 5, segs = 9, off = Array.from({ length: (rings + 1) * segs }, () => 0.8 + rand() * 0.35);
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const P = (jj: number, ii: number): V3 => { const th = (jj / rings) * Math.PI * 0.62, ph = (ii / segs) * 2 * Math.PI, k = off[(jj * segs + (ii % segs)) % off.length] * (jj === 0 ? 1 : 1); return [c[0] + Math.sin(th) * Math.sin(ph) * r * k, c[1] + Math.cos(th) * r * 0.75 * (jj === 0 ? 1 : k), c[2] + Math.sin(th) * Math.cos(ph) * r * k]; };
    const q = [P(j, i), P(j + 1, i), P(j + 1, i + 1), P(j, i + 1)], cc = col(j * segs + i);
    b.triOut([c[0], c[1] - r * 0.3, c[2]], q[0], q[2], q[1], cc); b.triOut([c[0], c[1] - r * 0.3, c[2]], q[0], q[3], q[2], cc);
  }
}

export function lighthouse(b: Builder, v: number) {
  const band: RGB = v === 4 ? [0.1, 0.55, 0.25] : [0.85, 0.1, 0.08], small = v >= 2;
  const H = small ? 7 : 12, r0 = small ? 1.4 : 2.3, r1 = small ? 1.0 : 1.55;
  b.use(0, SRC.OWN, M.ROCK); b.lathe([[r0 + 1.4, -2], [r0 + 1.3, 0.4], [0, 0.45]], [0.8, 0.78, 0.74], 14);
  b.use(0, SRC.OWN, M.PAINT);
  const prof: [number, number][] = [];
  for (let i = 0; i <= 10; i++) prof.push([r0 + (r1 - r0) * (i / 10), 0.4 + (H * i) / 10]);
  b.lathe(prof, (i) => ((small ? i >= 3 && i < 6 : (i >= 3 && i < 5) || (i >= 7 && i < 9)) ? band : [0.97, 0.97, 0.95]), 16);
  b.lathe([[r1 + 0.55, H + 0.4], [r1 + 0.55, H + 0.6], [0, H + 0.62]], [0.12, 0.12, 0.13], 16);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.283; b.tube([Math.sin(a) * (r1 + 0.5), H + 0.6, Math.cos(a) * (r1 + 0.5)], [Math.sin(a) * (r1 + 0.5), H + 1.3, Math.cos(a) * (r1 + 0.5)], 0.04, [0.12, 0.12, 0.13], 4); }
  b.use(0, SRC.OWN, M.LIT); b.lathe([[r1 * 0.72, H + 0.6], [r1 * 0.72, H + 2.0]], [1, 0.88, 0.5], 12);
  b.use(0, SRC.OWN, M.PAINT); b.lathe([[r1 * 0.8, H + 2.0], [r1 * 0.85, H + 2.15], [r1 * 0.5, H + 2.7], [0.12, H + 3.0], [0.1, H + 3.5], [0, H + 3.5]], small ? band : [0.12, 0.12, 0.13], 12);
  b.box(-0.5, 0.5, 0.4, 2.3, r0 - 0.15, r0 + 0.05, [0.2, 0.25, 0.32]);
}

export function cottage(b: Builder, v: number) {
  const W = 3, D = 2.2, H = 3.2, roof: RGB = v % 2 ? [0.62, 0.24, 0.17] : [0.3, 0.35, 0.42], door: RGB = ([[0.15, 0.35, 0.75], [0.8, 0.15, 0.12], [0.15, 0.55, 0.3], [0.95, 0.75, 0.1]] as RGB[])[v % 4];
  const wall: RGB = v === 3 ? [0.98, 0.92, 0.78] : [0.97, 0.96, 0.93];
  b.use(0, SRC.OWN, M.ROCK); b.box(-W - 0.2, W + 0.2, -3, 0.25, -D - 0.2, D + 0.2, [0.7, 0.68, 0.64]);
  b.use(0, SRC.OWN, M.MATTE); b.box(-W, W, 0.25, H, -D, D, wall);
  b.tri([-W, H, D], [W, H, D], [0, H + 1.9, D], wall); b.tri([W, H, -D], [-W, H, -D], [0, H + 1.9, -D], wall);
  b.use(0, SRC.OWN, M.PAINT);
  // (gable ends front and back; the roof pitched across the house's width)
  b.quad([-W - 0.3, H - 0.15, -D - 0.3], [-W - 0.3, H - 0.15, D + 0.3], [0, H + 1.95, D + 0.3], [0, H + 1.95, -D - 0.3], roof);
  b.quad([W + 0.3, H - 0.15, D + 0.3], [W + 0.3, H - 0.15, -D - 0.3], [0, H + 1.95, -D - 0.3], [0, H + 1.95, D + 0.3], roof);
  b.use(0, SRC.OWN, M.ROCK); b.box(W - 1.0, W - 0.3, H, H + 2.6, -0.4, 0.3, [0.66, 0.63, 0.58]);
  b.use(0, SRC.OWN, M.PAINT); b.box(-0.45, 0.45, 0.25, 2.1, D, D + 0.06, door);
  for (const x of [-1.9, 1.9]) for (const z of [D + 0.03, -D - 0.06]) { b.box(x - 0.55, x + 0.55, 1.2, 2.3, z, z + 0.04, [0.98, 0.98, 0.98]); b.use(0, SRC.OWN, M.WINDOW); b.box(x - 0.42, x + 0.42, 1.3, 2.2, z + (z > 0 ? 0.02 : -0.01), z + (z > 0 ? 0.06 : 0.03), GLASS); b.use(0, SRC.OWN, M.PAINT); }
}

export function station(b: Builder) {
  const W = 5, D = 8, H = 5.5, blue: RGB = [0.24, 0.45, 0.74], red: RGB = [0.75, 0.16, 0.12];
  b.use(0, SRC.OWN, M.ROCK); b.box(-W - 0.4, W + 0.4, -4, 0.3, -D - 0.4, D + 0.4, [0.72, 0.7, 0.66]);
  b.use(0, SRC.OWN, M.MATTE); b.box(-W, W, 0.3, H, -D, D, blue);
  b.tri([-W, H, D], [W, H, D], [0, H + 3, D], blue); b.tri([W, H, -D], [-W, H, -D], [0, H + 3, -D], blue);
  b.use(0, SRC.OWN, M.PAINT);
  b.quad([-W - 0.4, H - 0.2, -D - 0.4], [-W - 0.4, H - 0.2, D + 0.4], [0, H + 3.1, D + 0.4], [0, H + 3.1, -D - 0.4], red);
  b.quad([W + 0.4, H - 0.2, D + 0.4], [W + 0.4, H - 0.2, -D - 0.4], [0, H + 3.1, -D - 0.4], [0, H + 3.1, D + 0.4], red);
  b.box(-3.2, 3.2, 0.3, 4.4, D, D + 0.08, [0.1, 0.16, 0.3]);
  b.box(-3.4, 3.4, 4.4, 4.6, D, D + 0.12, WHITE);
  b.text('RNLI', [-2.85, 5.0, D + 0.1], [0.2, 0, 0], [0, 0.2, 0], [0, 0, 0.02], WHITE);
  // (the slipway, down into the bay)
  b.use(0, SRC.OWN, M.ROCK);
  b.quad([2.6, 0.32, D], [-2.6, 0.32, D], [-2.6, -2.6, D + 30], [2.6, -2.6, D + 30], [0.66, 0.65, 0.62]);
  b.use(0, SRC.OWN, M.PAINT); for (const x of [-1.2, 1.2]) b.quad([x + 0.12, 0.36, D], [x - 0.12, 0.36, D], [x - 0.12, -2.56, D + 30], [x + 0.12, -2.56, D + 30], [0.25, 0.22, 0.2]);
}

export function gorse(b: Builder, seed: number, flowering: boolean) {
  b.use(0, SRC.OWN, M.LEAF);
  lump(b, [0, 0, 0], 1.3, seed, (k) => (flowering && (k * 7919 + seed) % 5 === 0 ? [1, 0.82, 0.1] : (k + seed) % 3 ? [0.2, 0.36, 0.12] : [0.26, 0.44, 0.15]));
}

/** a finish post: a striped pole, a chequered flag at its top */
export function post(b: Builder) {
  b.use(0, SRC.OWN, M.ROCK); b.lathe([[1.6, -2], [1.4, 0.8], [0, 0.85]], [0.72, 0.7, 0.66], 12);
  b.use(0, SRC.OWN, M.PAINT);
  const prof: [number, number][] = []; for (let i = 0; i <= 14; i++) prof.push([0.22, 0.8 + i * 0.9]);
  b.lathe(prof, (i) => (i % 2 ? BLACK : [0.97, 0.97, 0.97]), 10);
  b.sphere([0, 13.5, 0], 0.3, [0.95, 0.75, 0.1], [1, 1, 1], 4, 8);
}

/** the banner across the harbour mouth: FINISH, chequered along its edges */
export function banner(b: Builder, x0: number, x1: number, z: number, y: number) {
  const H = 2.6, sq = 0.65;
  b.use(0, SRC.OWN, M.SAIL);
  b.quad([x1, y, z], [x0, y, z], [x0, y + H, z], [x1, y + H, z], [0.98, 0.98, 0.96]);
  for (let x = x1, k = 0; x > x0 + 1e-3; x -= sq, k++) for (const [yy, off] of [[y, 0], [y + H - sq, 1]] as const) {
    if ((k + off) % 2) continue;
    const xa = Math.max(x0, x - sq);
    b.quad([x, yy, z - 0.02], [xa, yy, z - 0.02], [xa, yy + sq, z - 0.02], [x, yy + sq, z - 0.02], BLACK);
  }
  // (the letters, to be read from the south: as you come up to it)
  const px = 0.2, wide = 6 * 6 * px - px, mid = (x0 + x1) / 2;
  b.text('FINISH', [mid + wide / 2, y + (H - 7 * px) / 2, z - 0.03], [-px, 0, 0], [0, px, 0], [0, 0, -0.01], [0.85, 0.08, 0.06]);
  b.use(0, SRC.OWN, M.PAINT);
  for (const x of [x0, x1]) b.tube([x, y + H, z], [x, y + H + 0.05, z], 0.05, BLACK, 4);
}

// ─── gulls ───

export const WING = [0.12, 0.05] as const;
export function gull(): Mesh {
  const b = new Builder();
  b.use(0, SRC.OWN, M.SOFT);
  b.sphere([0, 0, 0], 0.22, [0.97, 0.97, 0.97], [0.8, 0.75, 1.8], 5, 8);
  b.sphere([0, 0.08, 0.38], 0.14, [0.97, 0.97, 0.97], [1, 1, 1], 4, 8);
  b.use(0, SRC.OWN, M.PAINT); b.tube([0, 0.07, 0.5], [0, 0.05, 0.66], 0.035, [1, 0.75, 0.1], 4, 0.01);
  for (const [s, part] of [[1, 1], [-1, 2]] as const) {
    b.use(part, SRC.OWN, M.SOFT);
    b.quad([s * WING[0], WING[1], 0.18], [s * WING[0], WING[1], -0.15], [s * 0.75, WING[1], -0.2], [s * 0.7, WING[1], 0.12], [0.85, 0.87, 0.9]);
    b.quad([s * 0.7, WING[1], 0.12], [s * 0.75, WING[1], -0.2], [s * 1.0, WING[1], -0.32], [s * 0.98, WING[1], -0.05], [0.25, 0.27, 0.3]);
  }
  return b.done();
}

export { join };

/** the 5×7 capitals (shared with shapes' text) */
const GLYPH_ROWS: Record<string, string[]> = {
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
};

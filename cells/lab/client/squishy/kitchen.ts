/**
 * Squishy: the kitchen, made from its pieces. From the stovetop on, a level is a run along a
 * counter (the hob, on the stove) against a tiled wall with windows in it, made of set pieces,
 * each laid where the last left off and every hop in it made sure of as it's laid:
 *
 * - **one thing** at the height it stands: a stack of steamers, a plate on a tin, a pudding (a
 *   jelly) on its saucer, a lazy Susan, a tea tin, the butter dish, a pan on its pot, a pot with its
 *   lid on, a honey jar high on its stand (you land against its honey);
 * - **a towel and a shelf**: a bread bin out from the wall, a shelf above it no flick reaches, a
 *   towel hung over its edge to land against and climb;
 * - **two jellies** in a row, a pudding and a konjac, to bounce across;
 * - **a baking tray**, buttered in one corner;
 * - **a folded cloth** on the counter, somewhere low to land.
 *
 * The counter is ground: miss, and you're on it, and go again (everything but the climbs is low
 * enough to reach from it). Off its front is the fall.
 */
import { hash, seeded, type Rand } from '../kit/rng';
import { FEELS } from './jelly';
import { CHAPTER_AT, DUST, MAT, RADIUS, box, chapterOf, cyl, hop, jelly, tower, type Level, type Shape, type Top, type Tower, type V3 } from './level';
import { box as drawBox, drawShapes, quad } from './mesh';
import { smear, towel } from './props';

/** where the wall is (its face), and how far out from it a course may come */
const BACK = 66, FRONT = 2;
type Kind = 'stack' | 'plate' | 'pudding' | 'susan' | 'tin' | 'butter' | 'pan' | 'lid' | 'honey' | 'board' | 'towel' | 'jellies' | 'tray' | 'cloth';
const ramp = (r: Rand, a: number, b: number) => a + r() * (b - a);

/** What can come next, by level and by what came last. */
function pick(r: Rand, n: number, last: Kind | null, used: Map<Kind, number>): Kind {
  let pool: Kind[];
  if (chapterOf(n) === 'stove') {
    const s = n - CHAPTER_AT.stove;
    pool = ['stack', 'pan', 'butter', 'pan', 'cloth', 'tray'];
    if (s >= 1) pool.push('honey', 'honey', 'jellies');
    if (s >= 2) pool.push('lid', 'lid', 'towel');
    if (s >= 3) pool.push('tin', 'lid', 'towel');
  } else pool = ['stack', 'board', 'plate', 'pudding', 'tin', 'susan', 'pan', 'butter', 'honey', 'lid', 'jellies', 'towel', 'tray', 'cloth', 'towel', 'honey'];
  // (not the same twice running; nor honey after butter, or after a buttered tray: honey won't hold butter)
  pool = pool.filter((k) => k !== last && !((last === 'butter' || last === 'tray') && k === 'honey'));
  // (two climbs, two jars, at most, a level)
  pool = pool.filter((k) => !((k === 'towel' || k === 'honey') && (used.get(k) ?? 0) >= 2));
  return pool[Math.floor(r() * pool.length)];
}

/** The tops of a kind of one thing: how high it stands (its top), how far out it reaches. */
const ONE: Partial<Record<Kind, { top: Top; y: [number, number]; rad: [number, number] }>> = {
  stack: { top: 'steamer', y: [7, 28], rad: [10.5, 13] },
  plate: { top: 'plate', y: [9, 20], rad: [11, 13] },
  pudding: { top: 'pudding', y: [10, 16], rad: [7.5, 7.5] },
  susan: { top: 'susan', y: [8, 16], rad: [13, 15] },
  tin: { top: 'tin', y: [12, 24], rad: [6.5, 8] },
  butter: { top: 'butter', y: [7, 12], rad: [12, 12] },
  pan: { top: 'pan', y: [15, 25], rad: [13, 15] },
  lid: { top: 'lid', y: [16, 28], rad: [9.5, 12] },
  board: { top: 'board', y: [8, 14], rad: [9, 9] },
  honey: { top: 'honey', y: [28, 34], rad: [8.5, 8.5] },
};

interface Piece { stops: Tower[]; extra: Shape[]; decor: number[]; reach: number }

/** A piece of a kind, its first stop's middle at x, z (a height of its own), from the dice. */
function piece(kind: Kind, x: number, z: number, r: Rand, n: number): Piece | null {
  const one = ONE[kind];
  if (one) {
    // (a honey jar stands behind where you land against it, toward the wall)
    // (and well back, so the way on from its side is forward, away from it)
    if (kind === 'honey' && (z > BACK - 26 || z < 26)) z = Math.max(26, Math.min(BACK - 26, z));
    const rad = ramp(r, ...one.rad);
    // (turned to the course, which runs along x: a pan's handle, a board's jars, out to the sides; a jar toward the wall)
    const t = tower(one.top, [x, Math.round(ramp(r, ...one.y)), z], rad, kind === 'honey' ? 0 : Math.PI / 2 + ramp(r, -0.4, 0.4), r);
    // (past a jar is past the jar, not only where you landed against it)
    return { stops: [t], extra: [], decor: [], reach: kind === 'honey' ? 11 : t.box ? Math.hypot(...t.box) : rad };
  }
  if (kind === 'cloth') {
    const pad = box([x, 0.5, z], [8, 0.5, 7], ramp(r, -0.5, 0.5), MAT.gingham, 0.9);
    return { stops: [{ top: 'pad', at: [x, 1, z], r: 6, box: [7.5, 6.5], yaw: pad.yaw, shapes: [pad] }], extra: [], decor: [], reach: 10 };
  }
  if (kind === 'tray') {
    const tray = box([x, 0.4, z], [15, 0.4, 11], 0, MAT.pan, 0.6);
    const lips = [box([x - 15, 1.1, z], [0.3, 0.7, 11], 0, MAT.pan, 0.6), box([x + 15, 1.1, z], [0.3, 0.7, 11], 0, MAT.pan, 0.6),
      box([x, 1.1, z - 11], [15, 0.7, 0.3], 0, MAT.pan, 0.6), box([x, 1.1, z + 11], [15, 0.7, 0.3], 0, MAT.pan, 0.6)];
    const d: number[] = [];
    const corner = r() < 0.5 ? 1 : -1;
    const sm = smear([x + 13 * corner, 0.8, z - 9], [x + 2 * corner, 0.8, z + 2], 9, n * 7 + Math.round(x));
    for (const s of sm.shapes) { s.tack = 0; s.dust = DUST.butter; }
    d.push(...sm.verts);
    return { stops: [{ top: 'tray', at: [x, 0.8, z], r: 9, box: [13.5, 9.5], yaw: 0, shapes: [tray, ...lips, ...sm.shapes], land: [tray, ...sm.shapes] }], extra: [], decor: d, reach: 17 };
  }
  if (kind === 'jellies') {
    const d: number[] = [], stops: Tower[] = [];
    const kinds: Array<[keyof typeof FEELS, number, number, number]> = [['pudding', MAT.jelly, 8, 7], ['konjac', MAT.konjac, 9, 8]];
    const dz = ramp(r, -10, 10);
    kinds.forEach(([feel, mat, rad, h], i) => {
      const cx = x + i * 24, cz = Math.max(FRONT + 10, Math.min(BACK - 20, z + i * dz));
      const saucer = cyl(cx, cz, rad + 3, 0, 0.8, MAT.porcelain, 0.5);
      const j = jelly(cx, cz, rad, 0.8, 0.8 + h, mat, FEELS[feel]);
      if (r() < 0.4) j.dust = DUST.sprinkles;
      stops.push({ top: 'jelly', at: [cx, 0.8 + h, cz], r: rad - 2, yaw: 0, shapes: [saucer, j], land: [j] });
    });
    return { stops, extra: [], decor: d, reach: 12 };
  }
  if (kind === 'towel') {
    // (a bread bin out from the wall; a shelf above it no flick reaches; a towel over the shelf's edge)
    const d: number[] = [];
    const bz = BACK - 28.5;
    const bin = box([x, 12, bz], [16, 12, 15.5], 0, MAT.enamel, 0.75);
    const SY = Math.round(ramp(r, 72, 78)), SX = x + 6, SZ = BACK - 6;
    const shelf = box([SX, SY - 1, SZ], [26, 1, 6], 0, MAT.board, 0.85);
    const brackets = [-18, 18].map((dx) => box([SX + dx, SY - 6, BACK - 5], [0.6, 4, 5], 0, MAT.board, 0.8));
    const hangTo = 40;
    const tw = towel([SX - 13, SY, BACK - 12], [1, 0, 0], [0, 0, -1], 24,
      [[-4.5, 0.15], [-0.6, 0.35], [0.35, -0.5], [0.6, -4], [0.75, hangTo - SY + 6], [0.8, hangTo - SY]], n * 3 + Math.round(x));
    d.push(...tw.verts);
    return {
      stops: [
        { top: 'bin', at: [x, 24, bz], r: 9, box: [15, 14.5], yaw: 0, shapes: [bin] },
        { top: 'shelf', at: [SX, SY, SZ], r: 4, box: [24, 4.2], yaw: 0, shapes: [shelf, ...brackets, ...tw.shapes], land: [shelf, ...tw.shapes], wall: tw.shapes, wallAt: [SX - 1, (SY + hangTo) / 2, BACK - 12.8] },
      ], extra: [], decor: d, reach: 30,
    };
  }
  return null;
}

/** Whether a piece stands clear of what's laid already (a hand's width between), and of the flights made sure of. */
function clear(lv: Level, p: Piece, corridors: V3[][]): boolean {
  const mine = [...p.stops.flatMap((t) => t.shapes), ...p.extra];
  for (const s of mine) {
    for (const o of lv.shapes) {
      if (o === lv.shapes[0]) continue;
      if (s.lo[0] - 5 < o.hi[0] && s.hi[0] + 5 > o.lo[0] && s.lo[2] - 5 < o.hi[2] && s.hi[2] + 5 > o.lo[2]) return false;
    }
    const m = RADIUS * 1.3;
    if (corridors.some((c) => c.some((q) => q[0] > s.lo[0] - m && q[0] < s.hi[0] + m && q[1] > s.lo[1] - m && q[1] < s.hi[1] + m && q[2] > s.lo[2] - m && q[2] < s.hi[2] + m))) return false;
  }
  return true;
}

/** Level n, from the stovetop on: a run of pieces along the counter, from a cloth to home. */
export function buildKitchen(n: number): Level {
  const r = seeded(hash(n, 0x6b17c4e));
  const chapter = chapterOf(n);
  const stove = chapter === 'stove';
  // (the counter, long enough for anything, for the hops to be made sure of against; cut to the course at the end)
  const lv: Level = { n, chapter, towers: [], shapes: [box([1400, -2, (BACK - 18) / 2], [1600, 2, (BACK + 18) / 2], 0, MAT.counter)], sticks: [], movers: [], jellies: [], kill: -12, ground: -90, decor: [], floorMat: MAT.tiles };
  const add = (p: Piece) => {
    for (const t of p.stops) {
      lv.towers.push(t);
      for (const s of t.shapes) if (!lv.shapes.includes(s)) { lv.shapes.push(s); if (s.lift) lv.movers.push(s); if (s.jel) lv.jellies!.push(s); }
      // (on the stove, a burner under what would sit on one)
      if (stove && ['steamer', 'plate', 'tin', 'butter', 'susan', 'pudding', 'goal'].includes(t.top)) t.burner = (t.top === 'butter' ? 5 : t.shapes[0].r) + 3.5;
    }
    lv.shapes.push(...p.extra);
  };
  const remove = (p: Piece) => {
    lv.towers.length -= p.stops.length;
    const gone = new Set([...p.stops.flatMap((t) => t.shapes), ...p.extra]);
    lv.shapes = lv.shapes.filter((s) => !gone.has(s));
    lv.movers = lv.movers.filter((s) => !gone.has(s));
    lv.jellies = lv.jellies!.filter((s) => !gone.has(s));
  };
  const start = piece('cloth', 0, 22, r, n)!;
  add(start);
  lv.decor.push(...start.decor);
  const corridors: V3[][] = [];
  const count = 5 + Math.min(7, n - 5);
  const hard = Math.min(1, (n - 5) / 8);
  let last: Kind | null = 'cloth', reach = 10;
  const used = new Map<Kind, number>();
  const intro: Kind | null = stove ? ([null, 'honey', 'lid', 'towel'] as Array<Kind | null>)[n - CHAPTER_AT.stove] ?? null : null;
  for (let b = 0; b < count; b++) {
    const goal = b === count - 1;
    let laid = false;
    for (let tries = 0; tries < 40 && !laid; tries++) {
      // (and if nothing will fit, a stack of steamers close by, about as high)
      const easy = tries >= 24;
      // (what the level brings in, as its hint says, comes early, for sure)
      const kind: Kind = goal || easy ? 'stack' : b === 1 && intro && tries < 16 ? intro : pick(r, n, last, used);
      const prev = lv.towers[lv.towers.length - 1];
      const gap = easy ? ramp(r, 4, 9) : ramp(r, 6, 12 + 14 * hard) * (1 - tries * 0.02);
      const x = prev.at[0] + reach + gap + (kind === 'towel' || kind === 'tray' ? 18 : kind === 'honey' ? 2 : 12);
      // (from a jar's side, forward, away from the jar)
      const z = prev.jar ? Math.max(FRONT + 12, prev.at[2] - ramp(r, 16, 26)) : Math.max(FRONT + 12, Math.min(BACK - 22, prev.at[2] + ramp(r, -22, 22) * (easy ? 0.4 : 1)));
      const y = Math.round(Math.max(7, Math.min(28, prev.at[1] > 30 ? ramp(r, 14, 24) : prev.at[1] + ramp(r, -4, 6))));
      const p = goal ? { stops: [tower('goal', [x, Math.round(ramp(r, 12, 22)), z], 13, 0, r)], extra: [], decor: [] as number[], reach: 13 }
        : easy ? { stops: [tower('steamer', [x, y, z], 11, 0, r)], extra: [], decor: [] as number[], reach: 11 } : piece(kind, x, z, r, n);
      if (!p || !clear(lv, p, corridors)) continue;
      const k0 = lv.towers.length;
      add(p);
      // (each hop into it and through it can be made; and the one before still can, with it stood by it)
      let ok = k0 < 2 || !!hop(lv, k0 - 2, k0 - 1);
      const flights: V3[][] = [];
      for (let k = k0; ok && k < lv.towers.length; k++) { const h = hop(lv, k - 1, k); if (h) flights.push(...h.flights); else ok = false; }
      if (!ok) { remove(p); continue; }
      corridors.push(...flights);
      lv.decor.push(...p.decor);
      last = kind; reach = p.reach; laid = true;
      used.set(kind, (used.get(kind) ?? 0) + 1);
    }
  }
  room(lv, stove);
  return lv;
}

/**
 * The room about a run: the counter (the hob, on the stove) from the wall to its front edge, the
 * cupboards under it to the floor, the tiled wall behind with windows in it; the course's things
 * drawn as they stand.
 */
function room(lv: Level, stove: boolean) {
  let x0 = Infinity, x1 = -Infinity;
  for (const s of lv.shapes.slice(1)) { x0 = Math.min(x0, s.lo[0]); x1 = Math.max(x1, s.hi[0]); }
  x0 -= 40; x1 += 40;
  const top = box([(x0 + x1) / 2, -2, (BACK - 18) / 2], [(x1 - x0) / 2, 2, (BACK + 18) / 2], 0, stove ? MAT.hob : MAT.counter, 0.8);
  lv.shapes[0] = top;
  drawShapes([top], lv.decor);
  // (well past the course each way, and high: the camera can't go round its ends or over its top)
  const wall = box([(x0 + x1) / 2, 150, BACK + 1], [(x1 - x0) / 2 + 300, 150, 1], 0, MAT.tiles, 0.4);
  wall.tack = 0;
  lv.shapes.push(wall);
  lv.walls = [wall];
  drawShapes([wall], lv.decor);
  drawBox(lv.decor, [(x0 + x1) / 2, (lv.ground - 4) / 2, (BACK - 14) / 2], [(x1 - x0) / 2 - 1, (-4 - lv.ground) / 2, (BACK + 14) / 2], 0, MAT.enamel);
  // (windows along the wall, high, clear of the shelves)
  for (let wx = x0 + 70; wx < x1 - 70; wx += 190) {
    const wy0 = 84, wy1 = 140, a = wx - 30, b = wx + 30;
    quad(lv.decor, [a, wy0, BACK - 0.2], [a, wy1, BACK - 0.2], [b, wy1, BACK - 0.2], [b, wy0, BACK - 0.2], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], 12, [0, 0], [0, 1], [1, 1], [1, 0]);
    for (const [c, h] of [[[wx, wy1 + 1, BACK - 1], [32, 1, 1]], [[wx, wy0 - 1.5, BACK - 4], [33, 1.5, 4]], [[a - 1, (wy0 + wy1) / 2, BACK - 1], [1, (wy1 - wy0) / 2 + 2, 1]], [[b + 1, (wy0 + wy1) / 2, BACK - 1], [1, (wy1 - wy0) / 2 + 2, 1]]] as Array<[V3, V3]>) drawBox(lv.decor, c, h, 0, MAT.porcelain);
  }
}

/**
 * Squishy: the kitchen, made from its pieces. From the stovetop on, a level is a run along a
 * counter (the hob, on the stove) against a tiled wall with windows in it, made of set pieces,
 * each laid where the last left off and every hop in it made sure of as it's laid:
 *
 * - **one thing** at the height it stands, on what it stands on (see supports.ts): a steamer on a
 *   stool, a plate on cookbooks, a pudding (a jelly) on a cake stand, a lazy Susan on a crate, a tea
 *   tin on an upturned bowl, the butter dish on a cooling rack, a pan on a board across jars, a pot
 *   with its lid on, a honey jar high on its stand (you land against its honey);
 * - **a tiered cake stand**, its upper plate to land on, its lower a ledge under it;
 * - **a cooling rack** with nothing on it, to land across its wires;
 * - **a towel and a shelf**: a bread bin out from the wall, a shelf above it no flick reaches, a
 *   towel hung over its edge to land against and climb;
 * - **two jellies** in a row, a pudding and a konjac, each on something, to bounce across;
 * - **a baking tray** on a rack, buttered in one corner;
 * - **a folded cloth** on cookbooks or a stool, where it starts.
 *
 * What things stand on goes by the room: on the stove, crates, racks, boards across jars, tins, little
 * stools; past it, anything. There's no safe ground: the counter's well below every top, and to touch
 * it is to fall, back to the last top you stood on.
 */
import { hash, seeded, type Rand } from '../kit/rng';
import { FEELS } from './jelly';
import { CHAPTER_AT, DUST, MAT, RADIUS, box, chapterOf, cyl, hop, jelly, tower, type Level, type Shape, type Top, type Tower, type V3 } from './level';
import { box as drawBox, drawShapes, quad } from './mesh';
import { smear, towel } from './props';
import { HOLDS, assemble, holder, tiered, type Holder } from './supports';

/** where the wall is (its face), and how far out from it a course may come */
const BACK = 66, FRONT = 2;
type Kind = 'stack' | 'plate' | 'pudding' | 'susan' | 'tin' | 'butter' | 'pan' | 'lid' | 'honey' | 'board' | 'towel' | 'jellies' | 'tray' | 'cloth' | 'tiered' | 'rack';
/** the counter's this far below every top, at least: to touch it is to fall */
const KILL = 6, LOW = 15;
/** what things stand on, by room: the stove's sturdy and plain (and steel); past it, anything */
const ROOM: Record<'stove' | 'mixed', Holder[]> = {
  stove: ['crate', 'rack', 'trestle', 'tins', 'bench', 'books', 'crate', 'stool'],
  mixed: ['stool', 'pedestal', 'crate', 'books', 'bowl', 'trestle', 'bench', 'rack', 'tins'],
};
const ramp = (r: Rand, a: number, b: number) => a + r() * (b - a);

/** What can come next, by level and by what came last. */
function pick(r: Rand, n: number, last: Kind | null, used: Map<Kind, number>): Kind {
  let pool: Kind[];
  if (chapterOf(n) === 'stove') {
    const s = n - CHAPTER_AT.stove;
    pool = ['stack', 'pan', 'butter', 'pan', 'rack', 'tray'];
    if (s >= 1) pool.push('honey', 'honey', 'jellies');
    if (s >= 2) pool.push('lid', 'lid', 'towel');
    if (s >= 3) pool.push('tin', 'lid', 'towel');
  } else pool = ['stack', 'board', 'plate', 'pudding', 'tin', 'susan', 'pan', 'butter', 'honey', 'lid', 'jellies', 'towel', 'tray', 'tiered', 'rack', 'towel', 'honey', 'tiered'];
  // (not the same twice running; nor honey after butter, or after a buttered tray: honey won't hold butter)
  pool = pool.filter((k) => k !== last && !((last === 'butter' || last === 'tray') && k === 'honey'));
  // (two climbs, two jars, at most, a level)
  pool = pool.filter((k) => !((k === 'towel' || k === 'honey') && (used.get(k) ?? 0) >= 2));
  return pool[Math.floor(r() * pool.length)];
}

/** The tops of a kind of one thing: how high it stands (its top), how far out it reaches. */
const ONE: Partial<Record<Kind, { top: Top; y: [number, number]; rad: [number, number] }>> = {
  stack: { top: 'steamer', y: [16, 30], rad: [10.5, 13] },
  plate: { top: 'plate', y: [15, 26], rad: [11, 13] },
  pudding: { top: 'pudding', y: [16, 26], rad: [7.5, 7.5] },
  susan: { top: 'susan', y: [15, 24], rad: [13, 15] },
  tin: { top: 'tin', y: [18, 30], rad: [6.5, 8] },
  butter: { top: 'butter', y: [15, 22], rad: [12, 12] },
  pan: { top: 'pan', y: [16, 26], rad: [13, 15] },
  lid: { top: 'lid', y: [18, 30], rad: [9.5, 12] },
  board: { top: 'board', y: [15, 20], rad: [9, 9] },
  honey: { top: 'honey', y: [28, 34], rad: [8.5, 8.5] },
};

interface Piece { stops: Tower[]; extra: Shape[]; decor: number[]; reach: number }

/** What a top stands on, from what its kind can and what the room has. */
function holderFor(top: Top, r: Rand, n: number): Holder | null {
  const can = HOLDS[top];
  if (!can) return null;
  const room = ROOM[chapterOf(n) === 'stove' ? 'stove' : 'mixed'].filter((h) => can.includes(h));
  return room.length ? room[Math.floor(r() * room.length)] : null;
}
/** A top on what it stands on; on tins from the counter, as they always were, if nothing will hold it. */
function standOn(top: Top, at: V3, rad: number, yaw: number, r: Rand, n: number): { stop: Tower; decor: number[]; on: boolean } {
  const kind = holderFor(top, r, n);
  const off = kind && kind !== 'rack' && kind !== 'bowl' && r() < 0.3 ? (r() < 0.5 ? -1 : 1) * ramp(r, 3, 5) : 0;
  const a = kind ? assemble(top, kind, at, rad, yaw, r, 0, off) : null;
  return a ? { stop: a.tower, decor: a.decor, on: true } : { stop: tower(top, at, rad, yaw, r), decor: [], on: false };
}
/** (what stands on the counter itself, as it always did: on the stove, a burner under it) */
const onHob = new WeakSet<Tower>();
const coinAt = (x: number, z: number) => (salt: number) => (hash(Math.round(x * 10), Math.round(z * 10), salt) % 1000) / 1000;

/** A piece of a kind, its first stop's middle at x, z (a height of its own), from the dice. */
function piece(kind: Kind, x: number, z: number, r: Rand, n: number): Piece | null {
  const one = ONE[kind];
  if (one) {
    // (a honey jar stands behind where you land against it, toward the wall)
    // (and well back, so the way on from its side is forward, away from it)
    if (kind === 'honey' && (z > BACK - 26 || z < 26)) z = Math.max(26, Math.min(BACK - 26, z));
    const rad = ramp(r, ...one.rad);
    // (turned to the course, which runs along x: a pan's handle, a board's jars, out to the sides; a jar toward the wall)
    const yaw = kind === 'honey' ? 0 : Math.PI / 2 + ramp(r, -0.4, 0.4), at: V3 = [x, Math.round(ramp(r, ...one.y)), z];
    const t = kind === 'honey' || kind === 'board' ? { stop: tower(one.top, at, rad, yaw, r), decor: [], on: false } : standOn(one.top, at, rad, yaw, r, n);
    if (!t.on) onHob.add(t.stop);
    // (a plate: crumbs on it, or pepper, more often than not)
    if (kind === 'plate') { const pl = t.stop.land?.find((sh) => sh.mat === MAT.porcelain), d = r(); if (pl) pl.dust = d < 0.4 ? DUST.pepper : d < 0.75 ? DUST.crumbs : DUST.none; }
    // (past a jar is past the jar, not only where you landed against it)
    return { stops: [t.stop], extra: [], decor: t.decor, reach: kind === 'honey' ? 11 : Math.max(rad, ...t.stop.shapes.map((s) => Math.max(s.hi[0] - x, s.hi[2] - z, x - s.lo[0], z - s.lo[2]))) };
  }
  // (what isn't a top on something: stood on something itself)
  const under = (kinds: Holder[], y1: number, need: number, yaw = 0) => holder(kinds[Math.floor(r() * kinds.length)], x, z, 0, y1, need, yaw, coinAt(x, z));
  if (kind === 'cloth') {
    // (where it starts: a cloth folded on cookbooks, or on a stool)
    const y = Math.round(ramp(r, LOW, LOW + 3)), yaw = ramp(r, -0.5, 0.5);
    const h = under(['books', 'stool', 'crate'], y - 0.8, 8, yaw);
    const pad = box([x, y - 0.4, z], [7.5, 0.4, 6.5], yaw, MAT.gingham, 0.9);
    return { stops: [{ top: 'pad', at: [x, y, z], r: 6, box: [7, 6], yaw, shapes: [...h.shapes, pad], land: [pad] }], extra: [], decor: h.decor, reach: 10 };
  }
  if (kind === 'tray') {
    // (a baking tray on a cooling rack, or a crate, buttered in one corner)
    const y = Math.round(ramp(r, LOW, LOW + 5));
    const h = under(['rack', 'crate', 'books'], y - 0.8, 13);
    const tray = box([x, y - 0.4, z], [15, 0.4, 11], 0, MAT.pan, 0.6);
    const lips = [box([x - 15, y + 0.3, z], [0.3, 0.7, 11], 0, MAT.pan, 0.6), box([x + 15, y + 0.3, z], [0.3, 0.7, 11], 0, MAT.pan, 0.6),
      box([x, y + 0.3, z - 11], [15, 0.7, 0.3], 0, MAT.pan, 0.6), box([x, y + 0.3, z + 11], [15, 0.7, 0.3], 0, MAT.pan, 0.6)];
    const d: number[] = [...h.decor];
    const corner = r() < 0.5 ? 1 : -1;
    const sm = smear([x + 13 * corner, y, z - 9], [x + 2 * corner, y, z + 2], 9, n * 7 + Math.round(x));
    for (const s of sm.shapes) { s.tack = 0; s.dust = DUST.butter; }
    d.push(...sm.verts);
    return { stops: [{ top: 'tray', at: [x, y, z], r: 9, box: [13.5, 9.5], yaw: 0, shapes: [...h.shapes, tray, ...lips, ...sm.shapes], land: [tray, ...sm.shapes] }], extra: [], decor: d, reach: 17 };
  }
  if (kind === 'jellies') {
    // (a pudding and a konjac, each on its saucer on something: a cake stand, a stool, a crate)
    const d: number[] = [], stops: Tower[] = [];
    const kinds: Array<[keyof typeof FEELS, number, number, number]> = [['pudding', MAT.jelly, 8, 7], ['konjac', MAT.konjac, 9, 8]];
    const dz = ramp(r, -10, 10);
    kinds.forEach(([feel, mat, rad, h], i) => {
      const cx = x + i * 26, cz = Math.max(FRONT + 12, Math.min(BACK - 22, z + i * dz));
      const seat = Math.round(ramp(r, LOW - 6, LOW - 2));
      const kinds: Holder[] = ['pedestal', 'stool', 'crate'];
      const hd = holder(kinds[Math.floor(r() * kinds.length)], cx, cz, 0, seat, rad + 3, ramp(r, 0, 3), coinAt(cx, cz));
      const saucer = cyl(cx, cz, rad + 3, hd.y, hd.y + 0.8, MAT.porcelain, 0.5);
      const j = jelly(cx, cz, rad, hd.y + 0.8, hd.y + 0.8 + h, mat, FEELS[feel]);
      if (r() < 0.4) j.dust = DUST.sprinkles;
      d.push(...hd.decor);
      stops.push({ top: 'jelly', at: [cx, hd.y + 0.8 + h, cz], r: rad - 2, yaw: 0, shapes: [...hd.shapes, saucer, j], land: [j] });
    });
    return { stops, extra: [], decor: d, reach: 14 };
  }
  if (kind === 'tiered') {
    const t = tiered(x, z, 0, Math.round(ramp(r, LOW + 4, LOW + 12)), coinAt(x, z));
    return { stops: [t.stop], extra: [], decor: t.decor, reach: 15 };
  }
  if (kind === 'rack') {
    // (a cooling rack with nothing on it, on its tins: land across its wires)
    const y = Math.round(ramp(r, LOW, LOW + 6));
    const h = holder('rack', x, z, 0, y, 9, ramp(r, -0.3, 0.3), coinAt(x, z));
    const wires = h.shapes.filter((s) => s.kind === 'cap' && Math.abs(s.c[1] - s.b[1]) < 0.01 && s.c[1] > y - 0.6);
    return { stops: [{ top: 'rack', at: [x, y, z], r: h.r - 1, box: [h.box![0] - 1.5, h.box![1] - 1.5], yaw: ramp(r, 0, 0), shapes: h.shapes, land: wires }], extra: [], decor: h.decor, reach: Math.hypot(...h.box!) };
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
  const lv: Level = { n, chapter, towers: [], shapes: [box([1400, -2, (BACK - 18) / 2], [1600, 2, (BACK + 18) / 2], 0, MAT.counter)], sticks: [], movers: [], jellies: [], kill: KILL, ground: -90, decor: [], floorMat: MAT.tiles };
  const add = (p: Piece) => {
    for (const t of p.stops) {
      lv.towers.push(t);
      for (const s of t.shapes) if (!lv.shapes.includes(s)) { lv.shapes.push(s); if (s.lift) lv.movers.push(s); if (s.jel) lv.jellies!.push(s); }
      // (on the stove, a burner under what would sit on one, stood on the hob itself)
      if (stove && onHob.has(t) && ['steamer', 'plate', 'tin', 'butter', 'susan', 'pudding', 'goal'].includes(t.top)) t.burner = (t.top === 'butter' ? 5 : t.shapes[0].r) + 3.5;
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
      const y = Math.round(Math.max(LOW + 1, Math.min(30, prev.at[1] > 32 ? ramp(r, 18, 26) : prev.at[1] + ramp(r, -4, 6))));
      // (home, and what's sure to fit when nothing else will: a steamer, on something)
      const sure = (top: Top, at: V3, rad: number): Piece => { const t = standOn(top, at, rad, 0, r, n); if (!t.on) onHob.add(t.stop); return { stops: [t.stop], extra: [], decor: t.decor, reach: rad + 2 }; };
      const p = goal ? sure('goal', [x, Math.round(ramp(r, LOW + 3, LOW + 11)), z], 13) : easy ? sure('steamer', [x, y, z], 11) : piece(kind, x, z, r, n);
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

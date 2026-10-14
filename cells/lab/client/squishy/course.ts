/**
 * Squishy: the course, by level. The first levels are sets, places laid out by hand with room
 * to vary: The Preparation Table, a wooden table with a folded cloth to start on, butter melted
 * across it from its dish, a wooden spoon lying with its bowl on the table and its handle up on a
 * painted tin bench, a tea towel thrown over the bench's end, a floury paddle board, a tea tin,
 * and home, the golden steamer. The table itself is ground: land on it and you're fine; off its
 * edge is the fall. Later levels are towers (`level.ts`).
 *
 * A set is laid with a little jitter, from its level's seed, and every hop in it made sure of as
 * the towers' are; if a jitter won't do, another is tried, and the set as drawn always does.
 */
import { hash, seeded, type Rand } from '../kit/rng';
import { DUST, MAT, box, buildTowers, cap, chapterOf, cyl, hop, jelly, tower, type Level, type Shape, type Tower, type V3 } from './level';
import { FEELS } from './jelly';
import { buildKitchen } from './kitchen';
import { box as drawBox, drawShapes, quad } from './mesh';
import { drainer, smear, spoon, tiltPlate, towel, type Prop } from './props';

/** Level n: a set, or towers. */
export function buildLevel(n: number): Level {
  const ch = chapterOf(n);
  return ch === 'table' ? prepTable(n) : ch === 'counter' ? counterSet(n) : ch === 'sink' ? sinkSet(n) : buildKitchen(n);
}

/** A set: tried with a little jitter until every hop is sure, or as drawn. */
function tried(n: number, salt: number, lay: (n: number, jit: number, r: Rand) => Level): Level {
  let lv: Level | null = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    lv = lay(n, attempt < 23 ? 1 : 0, seeded(hash(n, attempt, salt)));
    if (lv.towers.every((_, k) => k === 0 || hop(lv!, k - 1, k))) return lv;
  }
  return lv!;
}
const counterSet = (n: number) => tried(n, 0xc0ffee, layCounter);
const sinkSet = (n: number) => tried(n, 0x5157, laySink);

/**
 * The Counter by the Window: a butcher-block counter against a tiled wall, a window in it. From a
 * folded cloth: a round loaf on a floury bread board (it gives, and it's crumby); a baking tray,
 * butter melted in one corner of it; a cake stand, its plate sticky with hundreds and thousands
 * (the second time, a konjac jelly first, to bounce on); the bread bin, out from the wall. Above,
 * out of reach of any flick, a shelf, a tea towel hung over its front edge: land against the
 * towel, it holds you, and climb up it and over onto the shelf. Home is on the window sill. A
 * knife block (wood, that holds you a moment) and a crock of wooden spoons stand about; the
 * counter is ground, and off its front is the fall.
 */
function layCounter(n: number, jit: number, r: Rand): Level {
  const J = (a: number) => (r() * 2 - 1) * a * jit;
  const two = n >= 4;
  const BACK = 66;
  const lv: Level = { n, chapter: 'counter', towers: [], shapes: [], sticks: [], movers: [], jellies: [], kill: -12, ground: -90, decor: [], floorMat: MAT.tiles };
  const free = (...ss: Shape[]) => { lv.shapes.push(...ss); drawShapes(ss, lv.decor); for (const s of ss) if (s.jel) lv.jellies!.push(s); };
  const prop = (p: Prop) => { lv.shapes.push(...p.shapes); lv.decor.push(...p.verts); return p; };
  const stop = (t: Tower) => { lv.towers.push(t); for (const s of t.shapes) if (!lv.shapes.includes(s)) { lv.shapes.push(s); if (s.jel) lv.jellies!.push(s); } };

  // the folded cloth it starts on
  const pad = box([0, 0.5, 0], [8, 0.5, 7], 0, MAT.gingham, 0.9);
  free(pad);
  stop({ top: 'pad', at: [0, 1, 0], r: 6, box: [7.5, 6.5], yaw: 0, shapes: [pad] });

  // a round loaf on a floury bread board: the board around it floured, the loaf soft and crumby
  const B1: V3 = [28 + J(3), 0, 20 + J(3)], y1 = 0.25 + J(0.2);
  const board = box([B1[0], 1, B1[2]], [17, 1, 12], y1, MAT.board, 0.85);
  board.dust = DUST.flour;
  const lx = B1[0] - Math.cos(y1) * 4, lz = B1[2] + Math.sin(y1) * 4;
  // (a dome: risen in the middle, its sides down to the board)
  const loaf = jelly(lx, lz, 8.5, 2, 11, MAT.bread, FEELS.boule, 0.9, 5.5);
  loaf.dust = DUST.crumbs;
  free(board, loaf);
  stop({ top: 'boule', at: [lx, 11, lz], r: 5, yaw: 0, shapes: [board, loaf], land: [loaf] });

  // a baking tray, butter melted across one corner of it; its lip all round
  const T: V3 = [B1[0] + 34 + J(3), 0, B1[2] - 16 + J(3)];
  const tray = box([T[0], 0.4, T[2]], [15, 0.4, 11], 0, MAT.pan, 0.6);
  const lips = [box([T[0] - 15, 1.1, T[2]], [0.3, 0.7, 11], 0, MAT.pan, 0.6), box([T[0] + 15, 1.1, T[2]], [0.3, 0.7, 11], 0, MAT.pan, 0.6),
    box([T[0], 1.1, T[2] - 11], [15, 0.7, 0.3], 0, MAT.pan, 0.6), box([T[0], 1.1, T[2] + 11], [15, 0.7, 0.3], 0, MAT.pan, 0.6)];
  free(tray, ...lips);
  const bt = prop(smear([T[0] + 13, 0.8, T[2] - 9], [T[0] + 2, 0.8, T[2] + 2], 9, n * 5));
  for (const s of bt.shapes) { s.tack = 0; s.dust = DUST.butter; }
  stop({ top: 'tray', at: [T[0], 0.8, T[2]], r: 9, box: [13.5, 9.5], yaw: 0, shapes: [tray, ...lips, ...bt.shapes], land: [tray, ...bt.shapes] });

  let last: V3 = T;
  // (the second time: a konjac jelly on a saucer, to bounce on)
  if (two) {
    const K: V3 = [T[0] + 26 + J(3), 0, T[2] + 22 + J(3)];
    const saucer = cyl(K[0], K[2], 12, 0, 0.8, MAT.porcelain, 0.5);
    const kj = jelly(K[0], K[2], 9, 0.8, 8.8, MAT.konjac, FEELS.konjac);
    free(saucer, kj);
    stop({ top: 'jelly', at: [K[0], 8.8, K[2]], r: 7, yaw: 0, shapes: [saucer, kj], land: [kj] });
    last = K;
  }

  // a cake stand, its plate sticky with hundreds and thousands
  const S: V3 = [last[0] + 28 + J(3), 0, (two ? last[2] + 4 : last[2] + 30) + J(3)];
  const stem = cyl(S[0], S[2], 2.2, 0, 9, MAT.porcelain, 0.5);
  const plate = cyl(S[0], S[2], 11, 9, 10, MAT.porcelain, 0.6);
  plate.dust = DUST.sprinkles;
  free(stem, plate);
  stop({ top: 'stand', at: [S[0], 10, S[2]], r: 9, yaw: 0, shapes: [stem, plate], land: [plate] });

  // the shelf, high on the wall, out of reach of any flick; a tea towel hung over its front edge
  const SY = (two ? 78 : 74) + J(1), SX = S[0] + 52 + J(3), SZ = BACK - 6;
  const shelf = box([SX, SY - 1, SZ], [26, 1, 6], 0, MAT.board, 0.85);
  const brackets = [-18, 18].map((dx) => box([SX + dx, SY - 6, BACK - 5], [0.6, 4, 5], 0, MAT.board, 0.8));
  free(shelf, ...brackets);
  const hangTo = 40;
  const tw = prop(towel([SX - 13, SY, BACK - 12], [1, 0, 0], [0, 0, -1], 24,
    [[-4.5, 0.15], [-0.6, 0.35], [0.35, -0.5], [0.6, -4], [0.75, hangTo - SY + 6], [0.8, hangTo - SY]], n * 3));

  // the bread bin, deep, out from the wall: its back runs in under the towel (slip off the towel and
  // you're back on it, with nowhere to fall between), its middle far enough out to flick up at the towel from
  const BB: V3 = [SX - 6 + J(3), 0, BACK - 28.5];
  const bin = box([BB[0], 12, BB[2]], [16, 12, 15.5], 0, MAT.enamel, 0.75);
  free(bin);
  stop({ top: 'bin', at: [BB[0], 24, BB[2]], r: 9, box: [15, 14.5], yaw: 0, shapes: [bin] });
  stop({ top: 'shelf', at: [SX, SY, SZ], r: 4, box: [24, 4.2], yaw: 0, shapes: [shelf, ...brackets, ...tw.shapes], land: [shelf, ...tw.shapes],
    wall: tw.shapes, wallAt: [SX - 1, (SY + hangTo) / 2, BACK - 12.8] });

  // the window, and on its sill, home
  const GX = SX + 64 + J(2), sillY = SY + 1;
  const sill = box([GX, sillY - 1.5, BACK - 6], [18, 1.5, 7], 0, MAT.porcelain, 0.7);
  const basket = cyl(GX, BACK - 7, 6.5, sillY, sillY + 7, MAT.gold);
  free(sill);
  stop({ top: 'goal', at: [GX, sillY + 7, BACK - 7], r: 5.5, yaw: 0, shapes: [basket] });
  drawShapes([basket], lv.decor);
  const wy0 = sillY + 3, wy1 = sillY + 58, wx0 = GX - 24, wx1 = GX + 24;
  quad(lv.decor, [wx0, wy0, BACK - 0.2], [wx0, wy1, BACK - 0.2], [wx1, wy1, BACK - 0.2], [wx1, wy0, BACK - 0.2], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], 12, [0, 0], [0, 1], [1, 1], [1, 0]);
  for (const [c, h] of [[[GX, wy1 + 1, BACK - 1], [26, 1, 1]], [[wx0 - 1, (wy0 + wy1) / 2, BACK - 1], [1, (wy1 - wy0) / 2 + 2, 1]], [[wx1 + 1, (wy0 + wy1) / 2, BACK - 1], [1, (wy1 - wy0) / 2 + 2, 1]], [[GX, (wy0 + wy1) / 2, BACK - 0.8], [0.5, (wy1 - wy0) / 2, 0.6]]] as Array<[V3, V3]>) drawBox(lv.decor, c, h, 0, MAT.porcelain);

  // about the counter: a knife block (wood: it holds you a moment), a crock of wooden spoons
  const kb = box([SX + 30 + J(2), 13, BACK - 12], [5, 13, 7], 0, MAT.board, 0.8);
  kb.tack = 1.4; kb.tire = 0.6;
  const knives = [-2.5, 0, 2.5].map((dz, i) => cap([kb.c[0] - 1 + i, 26, kb.c[2] + dz], [kb.c[0] - 3 + i, 33, kb.c[2] + dz * 1.2], 0.9, MAT.chopstick));
  const crock = cyl(-14 + J(2), BACK - 14, 6, 0, 17, MAT.jar);
  const spoons = [[-4, 2], [3, 3], [1, -4]].map(([dx, dz]) => cap([crock.c[0] + dx * 0.4, 14, crock.c[2] + dz * 0.4], [crock.c[0] + dx, 33, crock.c[2] + dz], 0.7, MAT.board));
  free(kb, ...knives, crock, ...spoons);

  // the wall: tiles, from the counter up past the window
  let x0 = Infinity, x1 = -Infinity;
  for (const s of lv.shapes) { x0 = Math.min(x0, s.lo[0]); x1 = Math.max(x1, s.hi[0]); }
  x0 -= 30; x1 += 30;
  // (well past the course each way, and high: the camera can't go round its ends or over its top)
  const wall = box([(x0 + x1) / 2, 150, BACK + 1], [(x1 - x0) / 2 + 300, 150, 1], 0, MAT.tiles, 0.4);
  wall.tack = 0;
  lv.shapes.push(wall);
  lv.walls = [wall];
  drawShapes([wall], lv.decor);
  // the counter: butcher block, from the wall to its front edge; the cupboards under it to the floor
  const top = box([(x0 + x1) / 2, -2, (BACK - 18) / 2], [(x1 - x0) / 2, 2, (BACK + 18) / 2], 0, MAT.counter, 0.8);
  lv.shapes.unshift(top);
  drawShapes([top], lv.decor);
  drawBox(lv.decor, [(x0 + x1) / 2, (lv.ground - 4) / 2, (BACK - 14) / 2], [(x1 - x0) / 2 - 1, (-4 - lv.ground) / 2, (BACK + 14) / 2], 0, MAT.enamel);
  return lv;
}

/** The Preparation Table: tried with a little jitter until every hop is sure, or as drawn. */
function prepTable(n: number): Level {
  let lv: Level | null = null;
  for (let attempt = 0; attempt < 24; attempt++) {
    lv = layTable(n, attempt < 23 ? 1 : 0, seeded(hash(n, attempt, 0x7ab1e)));
    if (lv.towers.every((_, k) => k === 0 || hop(lv!, k - 1, k))) return lv;
  }
  return lv!;
}

function layTable(n: number, jit: number, r: Rand): Level {
  const J = (a: number) => (r() * 2 - 1) * a * jit;
  const two = n >= 2;
  const lv: Level = { n, chapter: 'table', towers: [], shapes: [], sticks: [], movers: [], kill: -12, ground: -76, decor: [] };
  const free = (...ss: Shape[]) => { lv.shapes.push(...ss); drawShapes(ss, lv.decor); };
  const prop = (p: Prop) => { lv.shapes.push(...p.shapes); lv.decor.push(...p.verts); return p; };
  const stop = (t: Tower) => { lv.towers.push(t); for (const s of t.shapes) if (!lv.shapes.includes(s)) lv.shapes.push(s); };

  // the folded cloth it starts on
  const pad = box([0, 0.5, 0], [8, 0.5, 7], 0, MAT.gingham, 0.9);
  drawShapes([pad], lv.decor);
  stop({ top: 'pad', at: [0, 1, 0], r: 6, box: [7.5, 6.5], yaw: 0, shapes: [pad] });

  // the butter dish, and its butter melted across the table toward the spoon
  const dish = tower('butter', [24 + J(2), 3.2, 6 + J(2)], 12, 0.5 + J(0.3), r);
  free(...dish.shapes);
  const bowl: V3 = [-6 + J(2), 0, 31 + J(2)];
  const sm = prop(smear([dish.at[0] - 9, 0, dish.at[2] + 7], [bowl[0] + 2, 0, bowl[2] - 4.5], 10, 3 + n));
  for (const s of sm.shapes) { s.tack = 0; s.dust = DUST.butter; }

  // the bench, painted tin, its top so high; the spoon's bowl on the table, its handle up on the bench's near side
  const H = two ? 11 : 9, W = 13, BL = 30;
  const Cb: V3 = [-10 + J(3), 0, (two ? 68 : 63) + J(3)];
  const top = box([Cb[0], H - 0.4, Cb[2]], [BL / 2, 0.4, W / 2], 0, MAT.floral, 0.8);
  const legs = [-1, 1].map((sx) => box([Cb[0] + sx * (BL / 2 - 0.4), (H - 0.8) / 2, Cb[2]], [0.4, (H - 0.8) / 2, W / 2], 0, MAT.floral, 0.8));
  free(top, ...legs);
  const rest: V3 = [bowl[0] + J(3), 0, Cb[2] - W / 2 + 0.8];
  const yaw = Math.atan2(rest[0] - bowl[0], rest[2] - bowl[2]);
  const sp = prop(spoon(bowl, yaw, Math.hypot(rest[0] - bowl[0], rest[2] - bowl[2]), H + 0.6));
  stop({ top: 'spoon', at: [bowl[0], 0.6, bowl[2]], r: 4.6, yaw, shapes: sp.shapes, land: sp.shapes });

  // a tea towel thrown over the bench's far end, down both its sides to the table
  const xs: Array<[number, number]> = [
    [-W / 2 - 6, 0.15], [-W / 2 - 2.2, 0.3], [-W / 2 - 0.9, 1.6], [-W / 2 - 0.55, H * 0.5], [-W / 2 - 0.4, H - 1.2], [-W / 2 + 0.2, H + 0.25], [-W / 2 + 1.4, H + 0.32],
    [W / 2 - 1.4, H + 0.32], [W / 2 - 0.2, H + 0.25], [W / 2 + 0.4, H - 1.2], [W / 2 + 0.55, H * 0.5], [W / 2 + 0.9, 1.6], [W / 2 + 2.2, 0.3], [W / 2 + 6, 0.15],
  ];
  const tw = prop(towel([Cb[0] - BL / 2 + 1.5, 0, Cb[2]], [1, 0, 0], [0, 0, 1], 11, xs, n * 7));
  stop({ top: 'bench', at: [Cb[0], H, Cb[2]], r: 6, box: [BL / 2 - 1.5, W / 2 - 1], yaw: 0, shapes: [top, ...legs, ...tw.shapes], land: [top, ...tw.shapes] });

  // the paddle board, floured, lying on the table off to the side
  const P3: V3 = [Cb[0] - (two ? 32 : 27) + J(4), 0, Cb[2] + (two ? 25 : 21) + J(4)];
  const y3 = 0.3 + J(0.5);
  const board = box([P3[0], 0.8, P3[2]], [12, 0.8, 8.5], y3, MAT.board, 0.85);
  board.dust = DUST.flour;
  const handle = box([P3[0] + Math.cos(y3) * 17, 0.8, P3[2] - Math.sin(y3) * 17], [5, 0.8, 2], y3, MAT.board, 0.85);
  free(board, handle);
  stop({ top: 'paddle', at: [P3[0], 1.6, P3[2]], r: 7, box: [11, 7.5], yaw: y3, shapes: [board, handle], land: [board] });

  // (the second time: a plate tipped up on a teacup, on the way)
  let last: V3 = P3;
  if (two) {
    const c: V3 = [P3[0] + 16 + J(3), 2.4, P3[2] + 24 + J(3)];
    const dir = Math.PI / 2 + J(0.4), tilt = 0.17;
    const cup = cyl(c[0] + Math.sin(dir) * 8, c[2] + Math.cos(dir) * 8, 3.5, 0, 3.6, MAT.porcelain, 0.6);
    free(cup);
    const pl = prop(tiltPlate(c, 11, dir, tilt));
    stop({ top: 'tilt', at: c, r: 7, yaw: dir, shapes: [...pl.shapes, cup], land: pl.shapes });
    last = c;
  }

  // a tea tin, then home: the golden steamer
  const tin = tower('tin', [last[0] + (two ? 4 : 18) + J(3), (two ? 17 : 15) + J(1), last[2] + (two ? 25 : 23) + J(3)], 7, 0, r);
  stop(tin);
  const goal = tower('goal', [tin.at[0] + 24 + J(3), 21 + J(1), tin.at[2] + 13 + J(3)], 13, 0, r);
  stop(goal);

  underTable(lv);
  return lv;
}
/** The table under it all, to a margin past everything; its legs down to the floor. */
function underTable(lv: Level) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of lv.shapes) { x0 = Math.min(x0, s.lo[0]); x1 = Math.max(x1, s.hi[0]); z0 = Math.min(z0, s.lo[2]); z1 = Math.max(z1, s.hi[2]); }
  x0 -= 26; x1 += 26; z0 -= 22; z1 += 26;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  const table = box([cx, -2.5, cz], [hx, 2.5, hz], 0, MAT.counter, 0.8);
  lv.shapes.unshift(table);
  drawShapes([table], lv.decor);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) drawBox(lv.decor, [cx + sx * (hx - 6), (lv.ground - 5) / 2, cz + sz * (hz - 6)], [3, (-5 - lv.ground) / 2, 3], 0, MAT.board);
}

/**
 * A bench: one thing to try, over and over, on a table: `jelly`, three jellies in a row on their
 * saucers, a panna cotta, a mango pudding and a konjac jelly, from the cloth to home; `coats`, each
 * thing that comes off on it, in a row: a floury board, plates with crumbs and with pepper, a
 * pudding with hundreds and thousands, the butter dish.
 */
export function bench(name: string): Level {
  if (name === 'breakfast') return breakfast();
  const lv: Level = { n: 0, chapter: 'table', towers: [], shapes: [], sticks: [], movers: [], jellies: [], kill: -12, ground: -76, decor: [] };
  const stop = (t: Tower) => { lv.towers.push(t); for (const s of t.shapes) if (!lv.shapes.includes(s)) lv.shapes.push(s); };
  const pad = box([0, 0.5, 0], [8, 0.5, 7], 0, MAT.gingham, 0.9);
  drawShapes([pad], lv.decor);
  stop({ top: 'pad', at: [0, 1, 0], r: 6, box: [7.5, 6.5], yaw: 0, shapes: [pad] });
  if (name === 'jelly') {
    const kinds: Array<[keyof typeof FEELS, number, number, number]> = [['pannacotta', MAT.pannacotta, 8, 6], ['pudding', MAT.jelly, 9, 7], ['konjac', MAT.konjac, 10, 8]];
    kinds.forEach(([feel, mat, rad, h], i) => {
      const at: V3 = [i * 6 - 6, 0, 24 + i * 24];
      const saucer = cyl(at[0], at[2], rad + 3, 0, 0.8, MAT.porcelain, 0.5);
      const j = jelly(at[0], at[2], rad, 0.8, 0.8 + h, mat, FEELS[feel]);
      drawShapes([saucer], lv.decor);
      lv.jellies!.push(j);
      stop({ top: 'pudding', at: [at[0], 0.8 + h, at[2]], r: rad - 1, yaw: 0, shapes: [saucer, j], land: [j] });
    });
  }
  if (name === 'coats') {
    // each thing that comes off on it, in a row: flour, crumbs, pepper, sprinkles, butter
    const one = () => 0.5;
    const row: Tower[] = [tower('board', [-4, 6, 26], 9, 0.3, one), tower('plate', [6, 8, 50], 12, 0, one), tower('plate', [-2, 9, 76], 12, 0, one), tower('pudding', [8, 10, 100], 7.5, 0, one), tower('butter', [0, 8, 126], 12, 0.2, one)];
    const want = [DUST.flour, DUST.crumbs, DUST.pepper, DUST.sprinkles, DUST.butter];
    row.forEach((t, i) => {
      for (const s of t.shapes) if (s.dust || (i < 4 && (s.kind === 'jelly' || s.mat === MAT.porcelain || s.mat === MAT.board) && s.c[1] + (s.hh || s.h[1]) >= t.at[1] - 0.1)) s.dust = want[i];
      drawShapes(t.shapes, lv.decor);
      for (const s of t.shapes) if (s.jel) lv.jellies!.push(s);
      stop(t);
    });
  }
  const last = lv.towers[lv.towers.length - 1].at;
  stop(tower('goal', [last[0] + 6, 12, last[2] + 26], 13, 0, () => 0.5));
  underTable(lv);
  return lv;
}

/**
 * The Breakfast Counter: one place, not a run. A counter against a tiled wall, laid for breakfast,
 * and more than one way across it to home, a golden steamer on a tall tin by the wall, up where only
 * something already high can reach it. The counter's ground: miss, and you're on it, and go on from
 * there (nowhere on it reaches home, or the bread bin, straight).
 *
 * - Along the front, quick and risky: a baking tray buttered all along, to land on and slide down to
 *   its far lip (topspin carries you; land too hard and it throws you off the side), a stack of
 *   pancakes beside its far end, then the bread bin, then home. Buttered, mind: honey won't hold you.
 * - Along the back, slower and sure: a konjac jelly to bounce up off, a stack of steamers, the bin.
 * - Through the middle, a gamble: the cereal box, tall, its top a narrow ledge; from it, or from the
 *   jelly or the steamers, the honey jar against the wall: splat into its honey, stick, and from up
 *   there home is one flick. Unless you came the buttered way.
 *
 * Every way it's meant to be gone is made sure of, as a run's hops are.
 */
export const BREAKFAST_WAYS: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [3, 8], [0, 4], [4, 5], [5, 3], [0, 6], [6, 7], [4, 7], [5, 7], [7, 8], [6, 3], [0, 7]];
function breakfast(): Level {
  const BACK = 66;
  const lv: Level = { n: 0, chapter: 'counter', towers: [], shapes: [], sticks: [], movers: [], jellies: [], kill: -12, ground: -90, decor: [], floorMat: MAT.tiles };
  const free = (...ss: Shape[]) => { lv.shapes.push(...ss); drawShapes(ss, lv.decor); for (const s of ss) if (s.jel) lv.jellies!.push(s); };
  const prop = (p: Prop) => { lv.shapes.push(...p.shapes); lv.decor.push(...p.verts); return p; };
  const stop = (t: Tower) => { lv.towers.push(t); for (const s of t.shapes) if (!lv.shapes.includes(s)) { lv.shapes.push(s); if (s.jel) lv.jellies!.push(s); } };
  const one = () => 0.5;

  // 0. the folded cloth it starts on, at the front
  const pad = box([0, 0.5, 8], [8, 0.5, 7], 0, MAT.gingham, 0.9);
  free(pad);
  stop({ top: 'pad', at: [0, 1, 8], r: 6, box: [7.5, 6.5], yaw: 0, shapes: [pad] });

  // 1. along the front, a baking tray, buttered all along its length, its lip all round
  const T: V3 = [36, 0, 9];
  const tray = box([T[0], 0.4, T[2]], [17, 0.4, 9], 0, MAT.pan, 0.6);
  const lips = [box([T[0] - 17, 1.1, T[2]], [0.3, 0.7, 9], 0, MAT.pan, 0.6), box([T[0] + 17, 1.1, T[2]], [0.3, 0.7, 9], 0, MAT.pan, 0.6),
    box([T[0], 1.1, T[2] - 9], [17, 0.7, 0.3], 0, MAT.pan, 0.6), box([T[0], 1.1, T[2] + 9], [17, 0.7, 0.3], 0, MAT.pan, 0.6)];
  free(tray, ...lips);
  const bt = prop(smear([T[0] - 13, 0.8, T[2]], [T[0] + 14, 0.8, T[2] + 1], 11, 71));
  for (const s of bt.shapes) { s.tack = 0; s.dust = DUST.butter; }
  stop({ top: 'tray', at: [T[0], 0.8, T[2]], r: 9, box: [15.5, 7.5], yaw: 0, shapes: [tray, ...lips, ...bt.shapes], land: [tray, ...bt.shapes] });

  // 2. a stack of pancakes on a plate, beside the tray's far end
  const P: V3 = [70, 0, 14];
  const plate = cyl(P[0], P[2], 11, 0, 0.8, MAT.porcelain, 0.5);
  const cakes = [0, 1, 2, 3, 4].map((i) => cyl(P[0] + Math.sin(i * 2.3) * 0.5, P[2] + Math.cos(i * 1.7) * 0.5, 8.5 - (i % 2) * 0.4, 0.8 + i * 2.2, 0.8 + (i + 1) * 2.2, MAT.bread, 0.9));
  free(plate, ...cakes);
  stop({ top: 'pancakes', at: [P[0], 11.8, P[2]], r: 7, yaw: 0, shapes: [plate, ...cakes], land: [cakes[4]] });

  // 3. the bread bin, deep, high: out of reach from the counter, the hub of the ways
  const B: V3 = [96, 0, 30];
  const bin = box([B[0], 14, B[2]], [13, 14, 12], 0, MAT.enamel, 0.75);
  free(bin);
  stop({ top: 'bin', at: [B[0], 28, B[2]], r: 9, box: [12, 11], yaw: 0, shapes: [bin] });

  // 4. along the back: a konjac jelly on a saucer, to bounce up off
  const K: V3 = [20, 0, 44];
  const saucer = cyl(K[0], K[2], 12, 0, 0.8, MAT.porcelain, 0.5);
  const kj = jelly(K[0], K[2], 9, 0.8, 8.8, MAT.konjac, FEELS.konjac);
  free(saucer, kj);
  stop({ top: 'jelly', at: [K[0], 8.8, K[2]], r: 7, yaw: 0, shapes: [saucer, kj], land: [kj] });

  // 5. a stack of steamers
  const S = tower('steamer', [54, 25, 50], 8, 0, one);
  drawShapes(S.shapes, lv.decor);
  stop(S);

  // 6. in the middle, the cereal box: tall, its top a narrow ledge
  const C: V3 = [44, 0, 27];
  const cereal = box([C[0], 15, C[2]], [9, 15, 3.5], 0.15, MAT.floral, 0.85);
  free(cereal);
  stop({ top: 'cereal', at: [C[0], 30, C[2]], r: 3, box: [8, 2.5], yaw: 0.15, shapes: [cereal] });

  // 7. the honey jar against the wall: land against its honey, and stick
  const H = tower('honey', [76, 30, 47], 8.5, 0, one);
  drawShapes(H.shapes, lv.decor);
  stop(H);

  // 8. home: the golden steamer on a tall tea tin by the wall
  const G: V3 = [130, 0, 40];
  const tin = cyl(G[0], G[2], 7, 0, 44, MAT.tin);
  const goal = cyl(G[0], G[2], 7.5, 44, 51, MAT.gold);
  free(tin);
  drawShapes([goal], lv.decor);
  stop({ top: 'goal', at: [G[0], 51, G[2]], r: 6, yaw: 0, shapes: [goal] });

  lv.next = [1, 2, 3, 8, 5, 3, 7, 8, 8];
  lv.route = [0, 1, 2, 3, 8];

  // about it: a milk jug, a toast rack, a crock of spoons (none in the ways)
  const jug = cyl(-14, BACK - 14, 5.5, 0, 16, MAT.porcelain, 0.5);
  const crock = cyl(150, 22, 6, 0, 17, MAT.jar);
  const spoons = [[-4, 2], [3, 3], [1, -4]].map(([dx, dz]) => cap([crock.c[0] + dx * 0.4, 14, crock.c[2] + dz * 0.4], [crock.c[0] + dx, 33, crock.c[2] + dz], 0.7, MAT.board));
  free(jug, crock, ...spoons);

  // the wall, and the counter
  let x0 = Infinity, x1 = -Infinity;
  for (const s of lv.shapes) { x0 = Math.min(x0, s.lo[0]); x1 = Math.max(x1, s.hi[0]); }
  x0 -= 30; x1 += 30;
  const wall = box([(x0 + x1) / 2, 150, BACK + 1], [(x1 - x0) / 2 + 300, 150, 1], 0, MAT.tiles, 0.4);
  wall.tack = 0;
  lv.shapes.push(wall);
  lv.walls = [wall];
  drawShapes([wall], lv.decor);
  const top = box([(x0 + x1) / 2, -2, (BACK - 18) / 2], [(x1 - x0) / 2, 2, (BACK + 18) / 2], 0, MAT.counter, 0.8);
  lv.shapes.unshift(top);
  drawShapes([top], lv.decor);
  drawBox(lv.decor, [(x0 + x1) / 2, (lv.ground - 4) / 2, (BACK - 14) / 2], [(x1 - x0) / 2 - 1, (-4 - lv.ground) / 2, (BACK + 14) / 2], 0, MAT.enamel);
  return lv;
}

/**
 * The Sink: the counter round a steel sink, its window above. From a folded dishcloth: a sponge
 * (soft, and it soaks up a landing); a soap dish heaped with bubbles (they bounce you, and hold
 * nothing); the steel drainer board, grooved and sloping down to the sink, wet, so it slips; the
 * dish rack, its wire rails to land across, plates stood up in it. Then across the sink, the
 * water below (in it is the fall), at the dishcloth hung over the window sill's edge: it holds
 * you, and you climb it onto the sill. Home along the sill. The second time it's higher, the
 * gaps wider.
 */
function laySink(n: number, jit: number, r: Rand): Level {
  const J = (a: number) => (r() * 2 - 1) * a * jit;
  const two = n >= 6;
  const BACK = 66;
  const lv: Level = { n, chapter: 'sink', towers: [], shapes: [], sticks: [], movers: [], jellies: [], kill: -12, ground: -90, decor: [], floorMat: MAT.tiles };
  const free = (...ss: Shape[]) => { lv.shapes.push(...ss); drawShapes(ss, lv.decor); for (const s of ss) if (s.jel) lv.jellies!.push(s); };
  const prop = (p: Prop) => { lv.shapes.push(...p.shapes); lv.decor.push(...p.verts); return p; };
  const stop = (t: Tower) => { lv.towers.push(t); for (const s of t.shapes) if (!lv.shapes.includes(s)) { lv.shapes.push(s); if (s.jel) lv.jellies!.push(s); } };

  // a folded dishcloth to start on
  const pad = box([0, 0.5, 0], [8, 0.5, 7], 0, MAT.towel, 0.95);
  free(pad);
  stop({ top: 'pad', at: [0, 1, 0], r: 6, box: [7.5, 6.5], yaw: 0, shapes: [pad] });

  // a sponge, soft: it soaks up a landing
  const S1: V3 = [24 + J(3), 0, 16 + J(3)];
  const sponge = jelly(S1[0], S1[2], 6.5, 0, 4.5, MAT.sponge, FEELS.sponge, 0.95);
  free(sponge);
  stop({ top: 'sponge', at: [S1[0], 4.5, S1[2]], r: 4.5, yaw: 0, shapes: [sponge], land: [sponge] });

  // a soap dish, heaped with bubbles: they bounce you, and hold nothing
  const D: V3 = [S1[0] + 26 + J(3), 0, S1[2] - 14 + J(3)];
  const dish = cyl(D[0], D[2], 9, 0, 1.2, MAT.porcelain, 0.5);
  const bubbles: Shape[] = [];
  for (let i = 0; i < (two ? 8 : 6); i++) {
    // (round its rim, the middle clear for a dumpling to sit among them)
    const a = (i / (two ? 8 : 6)) * Math.PI * 2 + r() * 0.4, d = 6.8 + 1.2 * r(), br = 1.4 + r() * 0.9;
    const c: V3 = [D[0] + Math.cos(a) * d, 1.2 + br * 0.75, D[2] + Math.sin(a) * d];
    const b = cap(c, c, br, MAT.bubble, 0.1);
    b.bounce = 0.85; b.tack = 0;
    bubbles.push(b);
  }
  free(dish, ...bubbles);
  stop({ top: 'soap', at: [D[0], 1.2, D[2]], r: 5.5, yaw: 0, shapes: [dish, ...bubbles], land: [dish, ...bubbles] });

  // the sink: a hole in the counter, steel all round, the water in it
  const BX = D[0] + 92 + J(3), BZ = 30, HX = 22, HZ = 16, BY = -18;
  // the drainer board, sloping down to the sink's left edge, grooved, wet
  const dx0 = BX - HX - 34, dx1 = BX - HX;
  const dr = prop(drainer(dx0, dx1, BZ - HZ, BZ + HZ, 2.4, 0.4));
  stop({ top: 'drainer', at: [(dx0 + dx1) / 2 - 6, 1.9, BZ - 9], r: 6, box: [9, 5.5], yaw: 0, shapes: dr.shapes, land: dr.shapes });

  // the dish rack, on the back of the drainer: wire rails to land across, plates stood up at its near end
  const RX = dx0 + 16 + J(2), RZ = BZ + 7, RY = two ? 9 : 7;
  const rails: Shape[] = [];
  for (let i = 0; i < 9; i++) { const z = RZ - 8 + i * 2; rails.push(cap([RX - 13, RY, z], [RX + 13, RY, z], 0.45, MAT.steel, 0.7)); }
  const legs = [[-13, -8], [13, -8], [-13, 8], [13, 8]].map(([lx, lz]) => cap([RX + lx, 0, RZ + lz], [RX + lx, RY, RZ + lz], 0.35, MAT.steel, 0.6));
  free(...rails, ...legs);
  const plates: Shape[] = [];
  // (two plates, stood together at its far end: a wall, with no gap between to wedge in)
  for (const px of [-13, -12]) { const pr = prop(tiltPlate([RX + px, RY + 8.2, RZ], 8, Math.PI / 2, 1.5)); plates.push(...pr.shapes); }
  stop({ top: 'rack', at: [RX + 5.5, RY + 0.35, RZ], r: 5, box: [6.5, 7.5], yaw: 0, shapes: [...rails, ...legs, ...plates], land: rails });

  // the basin
  const steel = (c: V3, h: V3) => box(c, h, 0, MAT.steel, 0.3);
  const basin = [steel([BX - HX - 0.5, BY / 2, BZ], [0.5, -BY / 2, HZ + 1]), steel([BX + HX + 0.5, BY / 2, BZ], [0.5, -BY / 2, HZ + 1]),
    steel([BX, BY / 2, BZ - HZ - 0.5], [HX + 1, -BY / 2, 0.5]), steel([BX, BY / 2, BZ + HZ + 0.5], [HX + 1, -BY / 2, 0.5]), steel([BX, BY - 0.5, BZ], [HX + 1, 0.5, HZ + 1])];
  for (const b of basin) b.tack = 0;
  free(...basin);
  quad(lv.decor, [BX - HX, -10, BZ - HZ], [BX - HX, -10, BZ + HZ], [BX + HX, -10, BZ + HZ], [BX + HX, -10, BZ - HZ], [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0], MAT.water, [0, 0], [0, 1], [1, 1], [1, 0]);

  // the window sill above the sink, and the dishcloth hung over its edge, down toward the water
  const SY = (two ? 60 : 56) + J(1), SZ = BACK - 6;
  const sill = box([BX + 6, SY - 1.5, SZ], [32, 1.5, 6], 0, MAT.porcelain, 0.7);
  free(sill);
  const hangTo = two ? 28 : 24;
  const cloth = prop(towel([BX - 22, SY, BACK - 12], [1, 0, 0], [0, 0, -1], 20,
    [[-4.5, 0.15], [-0.6, 0.35], [0.35, -0.5], [0.6, -4], [0.75, hangTo - SY + 6], [0.8, hangTo - SY]], n * 5 + 1));
  stop({ top: 'sill', at: [BX - 10, SY, SZ], r: 4, box: [10, 4.2], yaw: 0, shapes: [sill, ...cloth.shapes], land: [sill, ...cloth.shapes],
    wall: cloth.shapes, wallAt: [BX - 12, (SY + hangTo) / 2, BACK - 12.8] });
  const GX = BX + 26;
  const basket = cyl(GX, BACK - 7, 5.5, SY, SY + 7, MAT.gold);
  stop({ top: 'goal', at: [GX, SY + 7, BACK - 7], r: 4.5, yaw: 0, shapes: [basket] });
  drawShapes([basket], lv.decor);
  // the window over it all
  const wy0 = SY + 3, wy1 = SY + 58, wx0 = BX - 26, wx1 = BX + 38;
  quad(lv.decor, [wx0, wy0, BACK - 0.2], [wx0, wy1, BACK - 0.2], [wx1, wy1, BACK - 0.2], [wx1, wy0, BACK - 0.2], [0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1], 12, [0, 0], [0, 1], [1, 1], [1, 0]);
  for (const [c, h] of [[[(wx0 + wx1) / 2, wy1 + 1, BACK - 1], [(wx1 - wx0) / 2 + 2, 1, 1]], [[wx0 - 1, (wy0 + wy1) / 2, BACK - 1], [1, (wy1 - wy0) / 2 + 2, 1]], [[wx1 + 1, (wy0 + wy1) / 2, BACK - 1], [1, (wy1 - wy0) / 2 + 2, 1]], [[(wx0 + wx1) / 2, (wy0 + wy1) / 2, BACK - 0.8], [0.5, (wy1 - wy0) / 2, 0.6]]] as Array<[V3, V3]>) drawBox(lv.decor, c, h, 0, MAT.porcelain);

  // the tap, behind the sink's right side: its pillar, its arm out over the water, its handles
  const TX = BX + 12;
  const tap = [cyl(TX, BACK - 9, 2.6, 0, 4, MAT.steel, 0.3), cap([TX, 4, BACK - 9], [TX, 26, BACK - 9], 1.3, MAT.steel, 0.3), cap([TX, 26, BACK - 9], [TX, 26, BACK - 24], 1.2, MAT.steel, 0.3),
    cap([TX, 26, BACK - 24], [TX, 22.5, BACK - 25], 1.1, MAT.steel, 0.3), cyl(TX - 8, BACK - 9, 2, 0, 6, MAT.steel, 0.3), cyl(TX + 8, BACK - 9, 2, 0, 6, MAT.steel, 0.3)];
  for (const t of tap) t.tack = 0;
  free(...tap);

  // the wall, and the counter round the sink (a hole where the sink is), the cupboards under it
  let x0 = Infinity, x1 = -Infinity;
  for (const s of lv.shapes) { x0 = Math.min(x0, s.lo[0]); x1 = Math.max(x1, s.hi[0]); }
  x0 -= 30; x1 += 30;
  // (well past the course each way, and high: the camera can't go round its ends or over its top)
  const wall = box([(x0 + x1) / 2, 150, BACK + 1], [(x1 - x0) / 2 + 300, 150, 1], 0, MAT.tiles, 0.4);
  wall.tack = 0;
  lv.shapes.push(wall);
  lv.walls = [wall];
  drawShapes([wall], lv.decor);
  const F = -18, top = (a: number, b: number, c: number, d: number) => box([(a + b) / 2, -2, (c + d) / 2], [(b - a) / 2, 2, (d - c) / 2], 0, MAT.counter, 0.8);
  const counter = [top(x0, BX - HX - 1, F, BACK), top(BX + HX + 1, x1, F, BACK), top(BX - HX - 1, BX + HX + 1, F, BZ - HZ - 1), top(BX - HX - 1, BX + HX + 1, BZ + HZ + 1, BACK)];
  lv.shapes.unshift(...counter);
  drawShapes(counter, lv.decor);
  drawBox(lv.decor, [(x0 + x1) / 2, (lv.ground - 4) / 2, (BACK - 14) / 2], [(x1 - x0) / 2 - 1, (-4 - lv.ground) / 2, (BACK + 14) / 2], 0, MAT.enamel);
  return lv;
}

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
import { DUST, MAT, box, buildTowers, chapterOf, cyl, hop, tower, type Level, type Shape, type Tower, type V3 } from './level';
import { box as drawBox, drawShapes } from './mesh';
import { smear, spoon, tiltPlate, towel, type Prop } from './props';

/** Level n: a set, or towers. */
export function buildLevel(n: number): Level {
  return chapterOf(n) === 'table' ? prepTable(n) : buildTowers(n);
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

  // the table under it all, to a margin past everything; its legs down to the floor
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of lv.shapes) { x0 = Math.min(x0, s.lo[0]); x1 = Math.max(x1, s.hi[0]); z0 = Math.min(z0, s.lo[2]); z1 = Math.max(z1, s.hi[2]); }
  x0 -= 26; x1 += 26; z0 -= 22; z1 += 26;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
  const table = box([cx, -2.5, cz], [hx, 2.5, hz], 0, MAT.counter, 0.8);
  lv.shapes.unshift(table);
  drawShapes([table], lv.decor);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) drawBox(lv.decor, [cx + sx * (hx - 6), (lv.ground - 5) / 2, cz + sz * (hz - 6)], [3, (-5 - lv.ground) / 2, 3], 0, MAT.board);
  return lv;
}

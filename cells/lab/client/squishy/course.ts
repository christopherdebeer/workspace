/**
 * Squishy: the course, by level. Every level is laid fresh from its seed by its place (kitchen.ts): The
 * Preparation Table, The Counter by the Window, The Sink, The Stovetop, then the whole kitchen, several
 * levels each. Here too, the benches: one thing to try over and over, and The Breakfast Counter, a place
 * laid by hand with more than one way through it.
 */
import { seeded } from '../kit/rng';
import { DUST, MAT, box, bread, cap, cyl, jelly, serviette, tower, type Level, type Shape, type Top, type Tower, type V3 } from './level';
import { FEELS, type Bread } from './jelly';
import { assemble, holder, tiered, type Holder } from './supports';
import { buildKitchen, pieceAt, underTable } from './kitchen';
import { box as drawBox, drawShapes } from './mesh';
import { smear, type Prop } from './props';

/** Level n, laid by its place (another seed: another layout of the same level, for trying many). */
export function buildLevel(n: number, seed = 0, composition: 'parallel' | 'convergent' | 'offset' = 'parallel'): Level {
  return buildKitchen(n, seed, composition);
}

/**
 * A bench: one thing to try, over and over, on a table: `jelly`, three jellies in a row on their
 * saucers, a panna cotta, a mango pudding and a konjac jelly, from the cloth to home; `coats`, each
 * thing that comes off on it, in a row: a floury board, plates with crumbs and with pepper, a
 * pudding with hundreds and thousands, the butter dish; `puddings`, each recipe in its mould, in rows; `breads`,
 * each bread on a board.
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
  if (name === 'puddings') {
    // each recipe, in its mould, in rows of four: to look at, not to cross
    for (let k = 0; k <= 10; k++) {
      const at: V3 = [(k % 4) * 22 - 33, 0, 30 + Math.floor(k / 4) * 24], mat = [MAT.jelly, MAT.pannacotta, MAT.konjac][k % 3];
      const saucer = cyl(at[0], at[2], 11, 0, 0.8, MAT.porcelain, 0.5);
      const j = jelly(at[0], at[2], 8, 0.8, 7.8, mat, FEELS.pudding, undefined, 0, k);
      drawShapes([saucer], lv.decor);
      lv.jellies!.push(j);
      stop({ top: 'pudding', at: [at[0], 7.8, at[2]], r: 7, yaw: 0, shapes: [saucer, j], land: [j] });
    }
  }
  if (name === 'breads') {
    // each bread on a board: a boule, a bloomer, a baguette, a ciabatta, three rolls
    const set: Array<[Bread, number, number, number]> = [['boule', -30, 30, 0], ['bloomer', 0, 30, 0.3], ['baguette', 30, 30, -0.4], ['ciabatta', -15, 56, 0.1], ['roll', 12, 56, 0], ['roll', 21.5, 56, 0], ['roll', 16.7, 64, 0]];
    for (const [kind, bx, bz, yaw] of set) {
      const board = box([bx, 0.6, bz], [kind === 'roll' ? 6 : 18, 0.6, kind === 'roll' ? 6 : 11], yaw, MAT.board, 0.8);
      const b = bread(bx, bz, kind, 1.2, -yaw);
      drawShapes([board], lv.decor);
      lv.jellies!.push(b);
      stop({ top: 'boule', at: [bx, b.hi[1] - 3.5, bz], r: 3, yaw: 0, shapes: [board, b], land: [b] });
    }
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
  if (name === 'supports') return supportsBench(lv, stop);
  if (name === 'look') return lookBench(lv, stop);
  const last = lv.towers[lv.towers.length - 1].at;
  stop(tower('goal', [last[0] + 6, 12, last[2] + 26], 13, 0, () => 0.5));
  underTable(lv);
  return lv;
}
/**
 * `look`: a still-life to judge the light and the materials by, the same each time, close together: the
 * dumpling on a cloth on cookbooks; a mango pudding on a cake stand; a konjac on a crate; a plate (crumbs on it)
 * on a stool; the painted bench, its tea towel over its end; home on a crate. With ?view, the same picture.
 */
function lookBench(lv: Level, stop: (t: Tower) => void): Level {
  lv.kill = 6;
  lv.towers.length = 0; lv.shapes.length = 0; lv.decor.length = 0;
  const r = seeded(0x100c);
  const put = (a: { tower: Tower; decor: number[] } | null) => { if (!a) throw new Error('nothing to hold it'); for (const v of a.decor) lv.decor.push(v); stop(a.tower); for (const s of a.tower.shapes) if (s.jel) lv.jellies!.push(s); };
  const st = holder('books', 0, 0, 0, 15, 8, 0.15, () => 0.5);
  const cloth = box([0, 15.4, 0], [7.5, 0.4, 6.5], 0.15, MAT.gingham, 0.9);
  for (const v of st.decor) lv.decor.push(v);
  stop({ top: 'pad', at: [0, 15.8, 0], r: 6, box: [7, 6], yaw: 0.15, shapes: [...st.shapes, cloth], land: [cloth] });
  put(assemble('pudding', 'pedestal', [-22, 19, 16], 7.5, 0, r));
  const kj = pieceAt('konjac', 24, 10, 0x2a)!;
  for (const v of kj.decor) lv.decor.push(v);
  for (const t of kj.stops) { stop(t); for (const s of t.shapes) if (s.jel) lv.jellies!.push(s); }
  put(assemble('plate', 'stool', [4, 21, 34], 11, 0.3, r));
  const sp = pieceAt('spoon', -26, 46, 0x51)!;
  for (const v of sp.decor) lv.decor.push(v);
  for (const t of sp.stops) stop(t);
  put(assemble('goal', 'crate', [40, 22, 40], 12, 0.2, r));
  underTable(lv);
  return lv;
}
/**
 * `supports`: what things stand on, one of each, in a run over a table that's the fall: a cloth on cookbooks,
 * a steamer on a stool, a pudding on a cake stand, a plate on a board across jars, a pan on a crate, a lazy
 * Susan on a little four-legged stool, a tea tin on an upturned bowl, a tiered stand, the butter dish on a
 * cooling rack, a cake stand on a crate, a pudding set off to one side of a stool's seat; home on a crate.
 */
function supportsBench(lv: Level, stop: (t: Tower) => void): Level {
  lv.kill = 6;
  lv.towers.length = 0; lv.shapes.length = 0; lv.decor.length = 0;
  const r = seeded(0x5ab0);
  const put = (a: { tower: Tower; decor: number[] } | null) => { if (!a) throw new Error('a support that can\'t hold it'); lv.decor.push(...a.decor); stop(a.tower); for (const s of a.tower.shapes) if (s.jel) lv.jellies!.push(s); };
  // (a cloth folded on cookbooks: where it starts)
  const st = holder('books', 0, 0, 0, 15, 8, 0.15, () => 0.5);
  const cloth = box([0, 15.4, 0], [7.5, 0.4, 6.5], 0.15, MAT.gingham, 0.9);
  lv.decor.push(...st.decor);
  stop({ top: 'pad', at: [0, 15.8, 0], r: 6, box: [7, 6], yaw: 0.15, shapes: [...st.shapes, cloth], land: [cloth] });
  const row: Array<[Top, Holder, number, number, number]> = [
    ['steamer', 'stool', 21, 11, 0], ['pudding', 'pedestal', 19, 7.5, 0], ['plate', 'trestle', 17, 12, 0], ['pan', 'crate', 21, 13, 0],
    ['susan', 'bench', 18, 13, 0], ['tin', 'bowl', 23, 7, 0], ['butter', 'rack', 19, 12, 0], ['pudding', 'crate', 21, 7.5, 0], ['plate', 'books', 20, 11, 0], ['pudding', 'stool', 21, 7.5, 4],
  ];
  let x = 0, z = 0;
  row.forEach(([top, kind, y, rad, off], i) => {
    x += 34; z = i % 2 ? 8 : -8;
    if (i === 6) { const t = tiered(x, z, 0, 22, (q) => ((q * 7919) % 1000) / 1000); lv.decor.push(...t.decor); stop(t.stop); x += 34; }
    put(assemble(top, kind, [x, y, z], rad, Math.PI / 2, r, 0, off));
  });
  put(assemble('goal', 'crate', [x + 36, 22, 0], 13, 0, r));
  underTable(lv);
  return lv;
}

/**
 * The Breakfast Counter: a place made of stations, things standing on the counter at their own sizes,
 * each with a spot or two to land on, and between one and the next always a gap. There's no safe ground:
 * the counter's well below every spot, and to touch it is to fall, back to the last spot you stood on.
 *
 * From a tea towel folded on the toaster: either down to a roasting tray on a cooling rack, buttered
 * (it slides), and up onto a konjac jelly on a cake tin (it throws you up); or across to the bread bin,
 * enamel, sure. Both meet at a taller tin, its plate sticky with hundreds and thousands; then the
 * tallest, a stack of pancakes on it, icing sugar on top; then the wall shelf, a jam jar on it to keep
 * clear of; and home, the golden steamer, on the shelf above.
 */
export const BREAKFAST_WAYS: Array<[number, number]> = [[0, 1], [1, 2], [2, 4], [0, 3], [3, 4], [4, 5], [5, 6], [6, 7]];
function breakfast(): Level {
  const BACK = 66;
  // (the counter is the fall: anything that comes down on it has fallen)
  const lv: Level = { n: 0, chapter: 'counter', towers: [], shapes: [], sticks: [], movers: [], jellies: [], kill: 6, ground: -90, decor: [], floorMat: MAT.tiles };
  const free = (...ss: Shape[]) => { lv.shapes.push(...ss); drawShapes(ss, lv.decor); for (const s of ss) if (s.jel) lv.jellies!.push(s); };
  const prop = (p: Prop) => { lv.shapes.push(...p.shapes); lv.decor.push(...p.verts); return p; };
  const stop = (t: Tower) => { lv.towers.push(t); for (const s of t.shapes) if (!lv.shapes.includes(s)) { lv.shapes.push(s); if (s.jel) lv.jellies!.push(s); } };

  // 0. the toaster, a tea towel folded on top of it: where it starts
  const toaster = box([0, 9.5, 22], [13, 9.5, 8], 0, MAT.steel, 0.6);
  const pad = box([0, 19.5, 22], [8, 0.5, 6.5], 0, MAT.gingham, 0.9);
  free(toaster, pad);
  stop({ top: 'pad', at: [0, 20, 22], r: 6, box: [7.5, 6], yaw: 0, shapes: [toaster, pad], land: [pad] });

  // 1. a roasting tray on a cooling rack on two tins, buttered all along: it slides, its deep lip stops you
  const T: V3 = [34, 14, 12];
  const legs = [-10, 10].map((dx) => cyl(T[0] + dx, T[2], 4, 0, T[1], MAT.tin));
  const tray = box([T[0], T[1] + 0.4, T[2]], [15, 0.4, 8], 0, MAT.pan, 0.6);
  const lips = [box([T[0] - 15, T[1] + 2.3, T[2]], [0.4, 1.9, 8], 0, MAT.pan, 0.6), box([T[0] + 15, T[1] + 2.3, T[2]], [0.4, 1.9, 8], 0, MAT.pan, 0.6),
    box([T[0], T[1] + 2.3, T[2] - 8], [15, 1.9, 0.4], 0, MAT.pan, 0.6), box([T[0], T[1] + 2.3, T[2] + 8], [15, 1.9, 0.4], 0, MAT.pan, 0.6)];
  free(...legs, tray, ...lips);
  const bt = prop(smear([T[0] - 11, T[1] + 0.8, T[2]], [T[0] + 12, T[1] + 0.8, T[2] + 1], 10, 71));
  for (const s of bt.shapes) { s.tack = 0; s.dust = DUST.butter; }
  stop({ top: 'tray', at: [T[0], T[1] + 0.8, T[2]], r: 8, box: [13.5, 6.5], yaw: 0, shapes: [tray, ...lips, ...bt.shapes], land: [tray, ...bt.shapes] });

  // 2. a konjac jelly on a saucer, on a cake tin: it throws you up
  const K: V3 = [74, 0, 24];
  const tinK = cyl(K[0], K[2], 11, 0, 24, MAT.tin);
  const saucer = cyl(K[0], K[2], 12, 24, 24.8, MAT.porcelain, 0.5);
  const kj = jelly(K[0], K[2], 9, 24.8, 32.8, MAT.konjac, FEELS.konjac);
  free(tinK, saucer, kj);
  // (a springboard, on a tall tin: off it, up onto the cake stand)
  stop({ top: 'jelly', at: [K[0], 32.8, K[2]], r: 7, yaw: 0, shapes: [tinK, saucer, kj], land: [kj], spring: true });

  // 3. across from the toaster, the bread bin: enamel, sure
  const B: V3 = [36, 0, 50];
  const bin = box([B[0], 15, B[2]], [13, 15, 11], 0, MAT.enamel, 0.75);
  free(bin);
  stop({ top: 'bin', at: [B[0], 30, B[2]], r: 9, box: [12, 10], yaw: 0, shapes: [bin] });

  // 4. a taller tin, a plate on it sticky with hundreds and thousands: where the two ways meet
  const S: V3 = [92, 0, 40];
  const tinS = cyl(S[0], S[2], 9, 0, 34, MAT.tin);
  const plateS = cyl(S[0], S[2], 11, 34, 35, MAT.porcelain, 0.6);
  plateS.dust = DUST.sprinkles;
  free(tinS, plateS);
  stop({ top: 'stand', at: [S[0], 35, S[2]], r: 9, yaw: 0, shapes: [tinS, plateS], land: [plateS] });

  // 5. the tallest tin, a stack of pancakes on it, icing sugar on top
  const P: V3 = [116, 0, 50];
  const tinP = cyl(P[0], P[2], 8, 0, 38, MAT.tin);
  const plateP = cyl(P[0], P[2], 10, 38, 38.8, MAT.porcelain, 0.5);
  const cakes = [0, 1, 2, 3].map((i) => cyl(P[0] + Math.sin(i * 2.3) * 0.4, P[2] + Math.cos(i * 1.7) * 0.4, 8.5 - (i % 2) * 0.4, 38.8 + i * 2.2, 38.8 + (i + 1) * 2.2, MAT.bread, 0.9));
  cakes[3].dust = DUST.flour;
  free(tinP, plateP, ...cakes);
  stop({ top: 'pancakes', at: [P[0], 47.6, P[2]], r: 7, yaw: 0, shapes: [tinP, plateP, ...cakes], land: [cakes[3]] });

  // 6. the wall shelf, a jam jar on it toward its far end
  const SH: V3 = [150, 56, BACK - 6];
  const shelf = box([SH[0], SH[1] - 1, SH[2]], [18, 1, 6], 0, MAT.board, 0.85);
  const brk = [-13, 13].map((dx) => box([SH[0] + dx, SH[1] - 6, BACK - 5], [0.6, 4, 5], 0, MAT.board, 0.8));
  const jam = cyl(SH[0] + 11, SH[2], 3.5, SH[1], SH[1] + 9, MAT.jar);
  free(shelf, ...brk, jam);
  stop({ top: 'shelf', at: [SH[0] - 4, SH[1], SH[2]], r: 4, box: [12, 4.5], yaw: 0, shapes: [shelf, ...brk, jam], land: [shelf] });

  // 7. home: the golden steamer on the shelf above, along from it (not over it: nothing overhangs the way)
  const G: V3 = [190, 74, BACK - 7];
  const shelf2 = box([G[0], G[1] - 1, BACK - 6], [14, 1, 6], 0, MAT.board, 0.85);
  const brk2 = [-9, 9].map((dx) => box([G[0] + dx, G[1] - 6, BACK - 5], [0.6, 4, 5], 0, MAT.board, 0.8));
  const goal = cyl(G[0], G[2], 7.5, G[1], G[1] + 7, MAT.gold);
  // (no rim to catch you: come in badly and you're off the far side; only its serviette marks it)
  const nap = serviette(G[0], G[1] + 7, G[2], 7.5);
  free(shelf2, ...brk2);
  drawShapes([goal, nap], lv.decor);
  stop({ top: 'goal', at: [G[0], G[1] + 7, G[2]], r: 6.5, yaw: 0, shapes: [goal, nap], land: [goal, nap] });

  lv.next = [1, 2, 4, 4, 5, 6, 7, 7];
  lv.route = [0, 1, 2, 4, 5, 6, 7];

  // about it: a milk jug, a crock of spoons (none in the ways)
  const jug = cyl(-24, BACK - 14, 5.5, 0, 16, MAT.porcelain, 0.5);
  const crock = cyl(206, 24, 6, 0, 17, MAT.jar);
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


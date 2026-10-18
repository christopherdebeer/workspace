/**
 * A labyrinth to show (the index's card, and the README's views): towers with tall arches, a bridge on a great arch
 * between two of them, an arcade, stairs up onto the tops, pools and cypresses, after the sketch it's modelled on. Put
 * down piece by piece, as a hand would, through the same rules.
 */
import { Labyrinth, type Kind } from './model';

export function demo(): Labyrinth {
  const m = new Labyrinth(7);
  const put = (kind: Kind, k: number, i: number, j: number, a = 0, n = 1) => m.place(kind, k, i, j, a, n, -100);
  const stack = (i: number, j: number, h: number, kinds: Array<Kind | [Kind, number]> = []) => { for (let k = 0; k < h; k++) { const c = kinds[k] ?? 'block'; Array.isArray(c) ? put(c[0], k, i, j, c[1]) : put(c, k, i, j); } };
  // (the tall tower at the back, its tall arch looking out, and the one across the court from it)
  stack(7, 2, 4, [['arch', 1], ['arch', 1], 'block', 'block']);
  stack(8, 2, 4); stack(7, 3, 3); stack(8, 3, 3, ['block', ['arch', 0], ['arch', 0]]);
  stack(2, 3, 3, ['block', ['arch', 0], 'block']); stack(3, 3, 3); stack(2, 4, 2); stack(3, 4, 3, [['arch', 1], 'block', 'block']);
  // (a bridge on one great arch between them, at the third level)
  put('bridge', 2, 4, 3, 0, 3);
  // (an arcade along the front)
  for (let i = 2; i <= 6; i++) put(i % 2 ? 'arch' : 'block', 0, i, 8, 1);
  for (let i = 2; i <= 6; i++) put('block', 1, i, 8);
  // (the block at the right, with its tall arch, and a stair up to it)
  stack(9, 7, 2, [['arch', 0], ['arch', 0]]); stack(9, 8, 2); stack(10, 7, 1); stack(10, 8, 2);
  put('stair', 0, 8, 8, 0); put('stair', 1, 9, 9, 3);
  put('block', 0, 9, 9);
  // (stairs up onto the arcade, and from the court onto the low tower)
  put('stair', 0, 1, 8, 0); put('stair', 0, 2, 5, 3); put('stair', 1, 2, 5, 3);
  put('stair', 0, 6, 3, 0); put('block', 0, 6, 4); put('stair', 1, 6, 4, 3);
  // (pools in the court, cypresses about it)
  for (const [i, j] of [[4, 5], [5, 5], [4, 6], [5, 6]]) put('pool', 0, i, j);
  for (const [k, i, j] of [[0, 6, 6], [2, 2, 4], [2, 10, 8], [0, 1, 2], [3, 7, 3], [0, 3, 6]]) put('cypress', k, i, j);
  return m;
}

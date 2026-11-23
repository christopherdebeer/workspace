/**
 * The brush test board (`?brushes`): single strokes on the toned ground, to get the figure's brush right on its own before it's
 * laid over a figure (round five's studies: `static/roofjumps-studies/round5/`). A board in the air, facing the eye, the city
 * not drawn; lit forms (a column, a limb, a head) for marks that take their colour from the lit body; each row a kind of mark,
 * each column a variation. Labels in the page. On the game's pale paper; `&ground=ochre` a toned board, to judge whites.
 */
import type { Bone } from './rig';
import type { Mark, V } from './strokes';
import { K } from './strokes';
import { translate, rotZ, ident } from './m4';

export const BOARD = { x: 0, y: 60, z: 0 };
const P = (x: number, y: number, z = 0): V => [BOARD.x + x, BOARD.y + y, BOARD.z + z];
const N: V = [0, 0, 1];

/** the lit forms on the board: a column (a torso), a slanted limb, a head (an egg): the navy of the runner's top, its skin */
export function boardBones(): Bone[] {
  const at = (x: number, y: number, a = 0) => rotZ(translate(ident(), BOARD.x + x, BOARD.y + y, BOARD.z - 0.4), a);
  return [
    { name: 'torso', m: at(-1.9, -1.55), y0: 0, w0: 0.5, d0: 0.32, y1: 0.75, w1: 0.56, d1: 0.36, zc: 0, mat: 2 },
    { name: 'thighL', m: at(-0.9, -0.9, 2.6), y0: 0, w0: 0.22, d0: 0.22, y1: -0.85, w1: 0.15, d1: 0.15, zc: 0, mat: 3 },
    { name: 'head', m: at(0.3, -1.45), y0: 0, w0: 0.26, d0: 0.28, y1: 0.36, w1: 0.28, d1: 0.3, zc: 0, mat: 1 },
  ];
}

/** the board's rows: what each shows, and its marks */
export function boardMarks(): { rows: string[]; marks: Mark[] } {
  const m: Mark[] = [], col: V = [0.24, 0.24, 0.42], lit: V = [0.62, 0.58, 0.78], white: V = [0.93, 0.91, 0.86], hair: V = [0.25, 0.15, 0.09], green: V = [0.32, 0.45, 0.3];
  // (every mark in the figure's brush (body on) unless it says otherwise)
  const put = (o: Partial<Mark> & { a: V; b: V; width: number; col: V; key: string }) => m.push({ layer: 0, kind: K.PULL, n: N, alpha: 1, dry: 0.3, heart: 0.3, rank: 1, body: 0.001, ...o });
  // row 1 (y 1.5): one pull, dry 0, 0.4, 0.8; and the same with the figure's torn sides (body on, colour its own)
  [0, 0.4, 0.8].forEach((d, i) => put({ a: P(-2.8 + i * 1.0, 1.5), b: P(-2.0 + i * 1.0, 1.65), width: 0.22, col, dry: d, body: 0, key: `r1a${i}` }));
  [0, 0.4, 0.8].forEach((d, i) => put({ a: P(0.3 + i * 1.0, 1.5), b: P(1.1 + i * 1.0, 1.65), width: 0.22, col, dry: d, body: 0.001, key: `r1b${i}` }));
  // row 2 (y 0.75): bent pulls: an arc, an S, a swelling one (widths along it)
  put({ a: P(-2.8, 0.6), b: P(-1.6, 0.6), path: [P(-2.2, 1.0)], width: 0.18, col: green, key: 'r2a' });
  put({ a: P(-1.2, 0.5), b: P(0.2, 0.9), path: [P(-0.8, 1.0), P(-0.2, 0.45)], width: 0.16, col: green, key: 'r2b' });
  put({ a: P(0.6, 0.7), b: P(2.6, 0.75), path: [P(1.2, 0.72), P(2.0, 0.78)], widths: [0.06, 0.34, 0.26, 0.04], width: 0.3, col: green, key: 'r2c' });
  // row 3 (y 0): impasto and loaded: a white block (socks, shoes), a short fat dab, a lit stroke over a dark one
  put({ a: P(-2.7, 0.0), b: P(-2.2, 0.05), width: 0.3, col: white, dry: 0.15, key: 'r3a' });
  put({ a: P(-1.7, -0.05), b: P(-1.45, 0.05), width: 0.34, col: white, dry: 0.05, key: 'r3b', taper: [0.12, 0.14] });
  put({ a: P(-0.9, -0.1), b: P(0.5, 0.1), width: 0.32, col, key: 'r3c' });
  put({ a: P(-0.8, 0.0), b: P(0.4, 0.15), width: 0.12, col: lit, dry: 0.5, key: 'r3d' });
  // (hair: a mass and flicks curling off it)
  put({ a: P(1.0, -0.2), b: P(1.6, 0.15), path: [P(1.2, 0.15)], width: 0.3, col: hair, key: 'r3e', taper: [0.12, 0.15] });
  for (let k = 0; k < 4; k++) put({ a: P(1.5, 0.05 + k * 0.03), b: P(2.3 + k * 0.1, 0.25 - k * 0.12), path: [P(1.95 + k * 0.05, 0.3 - k * 0.02)], width: 0.025, col: hair, dry: 0.4, key: `r3f${k}`, taper: [0.004, 0.15] });
  // row 4 (y -1.2): over the lit forms, taking their colour: a mass along the column, three wraps across it; one along the limb;
  // on the head, a hair mass over the crown
  put({ a: P(-1.9, -1.6, 0.0), b: P(-1.9, -0.75, 0.0), width: 0.55, col, body: 0.9, key: 'r4a', dry: 0.4 });
  for (let k = 0; k < 3; k++) put({ a: P(-2.25, -1.45 + k * 0.27), b: P(-1.55, -1.3 + k * 0.27 - (k % 2) * 0.12), path: [P(-1.9, -1.33 + k * 0.27)], width: 0.24, col: k === 1 ? lit : col, body: 0.4, dry: 0.5, key: `r4b${k}` });
  put({ a: P(-0.9, -0.9), b: P(-0.55, -1.65), width: 0.24, col: [0.3, 0.27, 0.26], body: 0.9, dry: 0.4, key: 'r4c' });
  put({ a: P(0.15, -1.2), b: P(0.45, -1.25), path: [P(0.3, -1.05)], width: 0.3, col: hair, body: 0, key: 'r4d', taper: [0.1, 0.12] });
  return { rows: ['1 one pull: dry 0, 0.4, 0.8 (the old brush) · the same, the figure brush', '2 bent pulls: arc, S, swelling', '3 impasto: socks, shoe, lit over dark · hair mass and flicks', '4 over lit forms: column mass and wraps · a limb · a head'], marks: m };
}

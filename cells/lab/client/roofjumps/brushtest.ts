/**
 * The brush test board (`?brushes`): single strokes on the toned ground, to get the figure's brush right on its own before it's
 * laid over a figure (round five's studies: `static/roofjumps-studies/round5/`). A board in the air, facing the eye, the city
 * not drawn; lit forms (a column, a limb, a head) for marks that take their colour from the lit body; each row a kind of mark,
 * each column a variation. Labels in the page. On the game's pale paper; `&ground=ochre` a toned board, to judge whites.
 */
import type { Bone } from './rig';
import type { Mark, Spline, V } from './strokes';
import { K } from './strokes';
import { translate, rotZ, ident } from './m4';

export const BOARD = { x: 0, y: 60, z: 0 };
const P = (x: number, y: number, z = 0): V => [BOARD.x + x, BOARD.y + y, BOARD.z + z];
const N: V = [0, 0, 1];

/** the lit forms on the board: a column (a torso), a slanted limb, a head (an egg): the navy of the runner's top, its skin */
export function boardBones(): Bone[] {
  return [];
}
export function boardBonesUnused(): Bone[] {
  const at = (x: number, y: number, a = 0) => rotZ(translate(ident(), BOARD.x + x, BOARD.y + y, BOARD.z - 0.4), a);
  return [
    { name: 'torso', m: at(-1.9, -1.55), y0: 0, w0: 0.5, d0: 0.32, y1: 0.75, w1: 0.56, d1: 0.36, zc: 0, mat: 2 },
    { name: 'thighL', m: at(-0.9, -0.9, 2.6), y0: 0, w0: 0.22, d0: 0.22, y1: -0.85, w1: 0.15, d1: 0.15, zc: 0, mat: 3 },
    { name: 'head', m: at(0.3, -1.45), y0: 0, w0: 0.26, d0: 0.28, y1: 0.36, w1: 0.28, d1: 0.3, zc: 0, mat: 1 },
  ];
}

/** the board's rows: what each shows, and its marks. Every mark in the figure's brush. Each row one splat property */
export function boardMarks(): { rows: string[]; marks: Mark[] } {
  const m: Mark[] = [], navy: V = [0.3, 0.3, 0.55], lilac: V = [0.66, 0.6, 0.82], white: V = [0.93, 0.91, 0.86], ochre: V = [0.8, 0.6, 0.2], green: V = [0.36, 0.5, 0.34], hair: V = [0.3, 0.18, 0.1];
  const put = (o: Partial<Mark> & { a: V; b: V; width: number; col: V; key: string }) => m.push({ layer: 0, kind: K.PULL, n: N, alpha: 1, dry: 0.25, heart: 0.3, rank: 1, body: 0.001, ...o });
  const SUN: V = [-0.55, 0.6, 0.58], nrm = (v: V): V => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  // row A, light: one loaded stroke on surfaces facing the sun, the eye, sideways, away from the sun
  ([['sun', nrm(SUN)], ['eye', [0, 0, 1]], ['side', nrm([0.9, 0, 0.4])], ['away', nrm([0.55, -0.6, 0.3])]] as [string, V][]).forEach(([k, n], i) =>
    put({ a: P(-2.7 + i * 1.4, 1.75), b: P(-1.75 + i * 1.4, 1.85), width: 0.3, col: lilac, surf: n, load: 0.9, key: `A${k}` }));
  // row B, view: the same stroke, its surface turned 0, 45, 65, 78, 86 degrees from the eye
  // (each turned from its own line of sight, the board seen in perspective)
  [0, 45, 65, 78, 86].forEach((deg, i) => { const r = (deg * Math.PI) / 180, cx = -2.42 + i * 1.15, e = nrm([-cx, -0.95, 7.5]), s0 = nrm([e[2], 0, -e[0]]);
    put({ a: P(cx - 0.38, 0.9), b: P(cx + 0.38, 1.0), width: 0.28, col: green, surf: nrm([e[0] * Math.cos(r) + s0[0] * Math.sin(r), e[1] * Math.cos(r), e[2] * Math.cos(r) + s0[2] * Math.sin(r)]), load: 0.7, key: `B${deg}` }); });
  // row C, load: 0.2, 0.5, 1.0 (white: socks, shoes); and a long one draining to dry-brush
  [0.2, 0.5, 1.0].forEach((l, i) => put({ a: P(-2.8 + i * 0.9, 0.05), b: P(-2.2 + i * 0.9, 0.1), width: 0.28, col: white, surf: [0, 0, 1], load: l, key: `C${l}` }));
  put({ a: P(0.0, 0.0), b: P(2.7, 0.15), path: [P(1.3, 0.18)], width: 0.24, col: navy, surf: [0, 0, 1], load: 0.8, key: 'Clong' });
  // row D, wet into wet: a dark passage, then a light stroke across it picking up 0, 0.5, 1 of it
  for (let i = 0; i < 3; i++) {
    const x = -2.3 + i * 1.7;
    put({ a: P(x, -0.55), b: P(x, -1.25), width: 0.42, col: navy, surf: [0, 0, 1], load: 0.8, key: `Du${i}` });
    put({ a: P(x - 0.55, -0.85), b: P(x + 0.7, -0.95), width: 0.18, col: ochre, surf: [0, 0, 1], load: 0.8, pick: [0, 0.5, 1][i], key: `Dp${i}` });
  }
  // row E, the kinds: a pull, a wrap round a form, a dab (impasto), a flick, a scumble (dry, little paint, broken over)
  put({ a: P(-2.8, -1.85), b: P(-1.9, -1.8), width: 0.24, col: navy, surf: [0, 0, 1], load: 0.8, key: 'Epull' });
  put({ a: P(-1.6, -2.0), b: P(-0.8, -1.95), path: [P(-1.2, -1.7)], widths: [0.2, 0.3, 0.18], width: 0.28, col: lilac, surf: [0, 0.4, 0.92], load: 0.8, key: 'Ewrap' });
  put({ a: P(-0.45, -1.85), b: P(-0.2, -1.8), width: 0.3, col: white, surf: [0, 0, 1], load: 1, key: 'Edab', taper: [0.1, 0.12] });
  put({ a: P(0.1, -1.95), b: P(1.0, -1.7), path: [P(0.6, -1.65)], width: 0.03, col: hair, surf: [0, 0, 1], load: 0.6, key: 'Eflick', taper: [0.004, 0.2] });
  put({ a: P(1.3, -1.9), b: P(2.6, -1.8), width: 0.36, col: navy, surf: [0, 0, 1], load: 0.25, dry: 0.7, alpha: 0.85, key: 'Escumble' });
  return { rows: ['A light: facing the sun, the eye, sideways, away', 'B view: its surface 0, 45, 65, 78, 86 degrees from the eye', 'C load: 0.2, 0.5, 1 · one draining to dry-brush', 'D wet into wet: picking up 0, 0.5, 1 of the dark under it', 'E kinds: pull, wrap, dab, flick, scumble'], marks: m };
}

/** the board in spline strokes (strokes.ts `Spline`): the same rows, each stroke one strip through four points; and a row of strokes
 * pinned to a limb that bends with time (a shoulder, an elbow): its sleeve one stroke across the joint, its points from the bones */
export function boardSplines(time: number): { rows: string[]; splines: Spline[] } {
  const sp: Spline[] = [], navy: V = [0.3, 0.3, 0.55], lilac: V = [0.66, 0.6, 0.82], white: V = [0.93, 0.91, 0.86], ochre: V = [0.8, 0.6, 0.2], green: V = [0.36, 0.5, 0.34], hair: V = [0.3, 0.18, 0.1];
  const SUN: V = [-0.55, 0.6, 0.58], nrm = (v: V): V => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
  const line = (x0: number, y0: number, x1: number, y1: number, bow = 0): [V, V, V, V] => [P(x0, y0), P(x0 + (x1 - x0) / 3, y0 + (y1 - y0) / 3 + bow), P(x0 + (2 * (x1 - x0)) / 3, y0 + (2 * (y1 - y0)) / 3 + bow), P(x1, y1)];
  const put = (o: Partial<Spline> & { ctrl: [V, V, V, V]; widths: [number, number, number, number]; col: V; key: string }) => sp.push({ dry: 0.25, heart: 0.3, body: 0.001, surf: [0, 0, 1], load: 0.8, ...o });
  // A light
  ([['sun', nrm(SUN)], ['eye', [0, 0, 1]], ['side', nrm([0.9, 0, 0.4])], ['away', nrm([0.55, -0.6, 0.3])]] as [string, V][]).forEach(([k, n], i) =>
    put({ ctrl: line(-2.7 + i * 1.4, 1.75, -1.75 + i * 1.4, 1.85, 0.04), widths: [0.3, 0.3, 0.3, 0.28], col: lilac, surf: n, load: 0.9, key: `sA${k}` }));
  // B view
  [0, 45, 65, 78, 86].forEach((deg, i) => { const r = (deg * Math.PI) / 180, cx = -2.42 + i * 1.15, e = nrm([-cx, -0.95, 7.5]), s0 = nrm([e[2], 0, -e[0]]);
    put({ ctrl: line(cx - 0.38, 0.9, cx + 0.38, 1.0), widths: [0.28, 0.28, 0.28, 0.26], col: green, load: 0.7, surf: nrm([e[0] * Math.cos(r) + s0[0] * Math.sin(r), e[1] * Math.cos(r), e[2] * Math.cos(r) + s0[2] * Math.sin(r)]), key: `sB${deg}` }); });
  // C load, and a long stroke draining, bowed
  [0.2, 0.5, 1.0].forEach((l, i) => put({ ctrl: line(-2.8 + i * 0.9, 0.05, -2.2 + i * 0.9, 0.1), widths: [0.28, 0.28, 0.27, 0.26], col: white, load: l, key: `sC${l}` }));
  put({ ctrl: line(0.0, 0.0, 2.7, 0.15, 0.18), widths: [0.24, 0.26, 0.24, 0.2], col: navy, load: 0.8, key: 'sClong' });
  // D wet into wet
  for (let i = 0; i < 3; i++) { const x = -2.3 + i * 1.7;
    put({ ctrl: line(x, -0.55, x, -1.25), widths: [0.42, 0.44, 0.42, 0.4], col: navy, key: `sDu${i}` });
    put({ ctrl: line(x - 0.55, -0.85, x + 0.7, -0.95, 0.04), widths: [0.18, 0.18, 0.17, 0.15], col: ochre, pick: [0, 0.5, 1][i], key: `sDp${i}` }); }
  // E kinds: pull, a wrap (a tight curve, swelling), a dab, a flick, a scumble
  put({ ctrl: line(-2.8, -1.85, -1.9, -1.8), widths: [0.24, 0.24, 0.23, 0.22], col: navy, key: 'sEpull' });
  put({ ctrl: [P(-1.6, -2.0), P(-1.35, -1.68), P(-1.05, -1.68), P(-0.8, -1.95)], widths: [0.2, 0.3, 0.28, 0.16], col: lilac, surf: nrm([0, 0.4, 0.92]), key: 'sEwrap' });
  put({ ctrl: line(-0.45, -1.85, -0.2, -1.8), widths: [0.3, 0.32, 0.3, 0.28], col: white, load: 1, key: 'sEdab', taper: [0.1, 0.12] });
  put({ ctrl: [P(0.1, -1.95), P(0.4, -1.68), P(0.75, -1.64), P(1.0, -1.72)], widths: [0.03, 0.03, 0.02, 0.012], col: hair, load: 0.6, key: 'sEflick', taper: [0.004, 0.2] });
  put({ ctrl: line(1.3, -1.9, 2.6, -1.8), widths: [0.36, 0.36, 0.34, 0.3], col: navy, load: 0.25, dry: 0.7, alpha: 0.85, key: 'sEscumble' });
  // F pinned: a limb (shoulder at the right edge) bending at the elbow with time; one sleeve stroke across the joint from points on
  // the bones, a highlight on its upper edge, a cuff at the wrist: all move with it
  { const sh = P(2.35, -0.4), a1 = -1.9 + 0.35 * Math.sin(time * 1.3), a2 = a1 + 0.4 + 0.9 * (0.5 + 0.5 * Math.sin(time * 1.3 + 0.8)), l1 = 0.62, l2 = 0.55;
    const el: V = [sh[0] + Math.cos(a1) * l1, sh[1] + Math.sin(a1) * l1, sh[2]], wr: V = [el[0] + Math.cos(a2) * l2, el[1] + Math.sin(a2) * l2, el[2]];
    const mid = (a: V, b: V, t: number): V => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2]];
    put({ ctrl: [sh, mid(sh, el, 0.6), mid(el, wr, 0.35), wr], widths: [0.2, 0.17, 0.15, 0.12], col: navy, key: 'sFsleeve' });
    put({ ctrl: [mid(sh, el, 0.1), mid(sh, el, 0.65), mid(el, wr, 0.3), mid(el, wr, 0.8)], widths: [0.05, 0.06, 0.05, 0.03], col: lilac, load: 0.6, key: 'sFlit', taper: [0.03, 0.08] });
  }
  return { rows: ['spline strokes: one strip each, no joins', 'A light · B view · C load · D wet into wet · E kinds', 'F (right of D) a sleeve pinned to a bending limb'], splines: sp };
}

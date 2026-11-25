/**
 * The salle: a long room with one bank of high windows down its left side and quiet painted walls elsewhere, the
 * piste down its middle. Built once. Its proportions are shared with the shader (ROOM), because the room is also what
 * the steel reflects and what the sun comes in through: a highlight on the bell is a window of this room.
 *
 * Restraint over detail: a few planes of paint (the chalk-blue end wall behind the opponent is the quiet field a fine
 * blade needs), a dull metal piste so shoes and their shadows read, and a little of the room's life (a bench, masks
 * and jackets on their hooks, a radiator under the windows).
 */
import { Mesh, MAT, type C } from './mesh';
import { PISTE } from '../bout';
import type { V } from '../v3';

export const ROOM = {
  x0: -10, x1: 10, z0: -3.6, z1: 3.6, h: 5.4,
  /** the windows: the band they fill on the left wall, bays every `bay` m, each `w` wide, panes `cols` × `rows` */
  winY0: 1.75, winY1: 4.95, bay: 2.5, w: 1.9, cols: 3, rows: 4,
};

// (linear albedos)
export const PAINT = {
  floor: [0.11, 0.125, 0.108] as C, piste: [0.28, 0.29, 0.285] as C, line: [0.78, 0.77, 0.74] as C,
  chalk: [0.27, 0.315, 0.29] as C, chalkFront: [0.30, 0.335, 0.31] as C, windowWall: [0.62, 0.6, 0.54] as C,
  dadoL: [0.28, 0.36, 0.33] as C, rightWall: [0.31, 0.335, 0.30] as C, dadoR: [0.118, 0.156, 0.133] as C,
  ceiling: [0.55, 0.55, 0.53] as C, frame: [0.5, 0.5, 0.47] as C, wood: [0.36, 0.18, 0.07] as C, radiator: [0.7, 0.7, 0.67] as C,
  jacket: [0.72, 0.71, 0.68] as C, maskMesh: [0.05, 0.05, 0.055] as C, bib: [0.7, 0.7, 0.67] as C, steel: [0.4, 0.4, 0.42] as C,
};

export function buildSalle(): Mesh {
  const m = new Mesh(40000), R = ROOM, P = PAINT;
  const { x0, x1, z0, z1, h } = R;
  // floor and ceiling
  m.quad([x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], P.floor, MAT.floor);
  m.quad([x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1], P.ceiling, MAT.paint);
  // ceiling lamps: long strips over the piste (lit: the overcast day isn't enough for a club)
  for (const x of [-6, -2, 2, 6]) for (const z of [-1.5, 1.5]) m.box([x - 0.7, h - 0.1, z - 0.06], [x + 0.7, h - 0.04, z + 0.06], [0.75, 0.75, 0.72], MAT.lamp);
  // the piste: a dull metal strip a little proud of the floor, its lines painted on
  const W = PISTE.width / 2, L = PISTE.half + 1.5, y = 0.012;
  m.box([-L, 0, -W], [L, y, W], P.piste, MAT.piste);
  const ly = y + 0.0015, line = (x: number, w = 0.05, half = W) => m.quad([x - w / 2, ly, -half], [x - w / 2, ly, half], [x + w / 2, ly, half], [x + w / 2, ly, -half], P.line, MAT.line);
  line(0, 0.04, 0.22);
  for (const s of [-1, 1]) { line(s * PISTE.garde); line(s * (PISTE.half - 2)); line(s * PISTE.half); }
  m.quad([-L, ly, -W + 0.03], [L, ly, -W + 0.03], [L, ly, -W], [-L, ly, -W], P.line, MAT.line);
  m.quad([-L, ly, W], [L, ly, W], [L, ly, W - 0.03], [-L, ly, W - 0.03], P.line, MAT.line);
  // the end walls: chalk blue behind the opponent, a paler blue behind you
  m.quad([x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, h, z0], P.chalk, MAT.endWall);
  m.quad([x0, 0, z1], [x0, 0, z0], [x0, h, z0], [x0, h, z1], P.chalkFront, MAT.endWall);
  // The bench stands free of the photographed plaster and joinery on the end wall.
  for (const end of [x0,x1]) {
    const inside = end > 0 ? -1 : 1, x = end + inside*0.012;
    const bx = x + inside * 0.33;
    m.box([bx-0.15,0.425,-2.63],[bx+0.15,0.47,-0.68],P.wood,MAT.wood);
    for (const z of [-2.48,-0.83]) m.box([bx-0.11,0,z],[bx+0.11,0.425,z+0.042],P.dadoR,MAT.rubber);
  }
  // the right wall: dark and quiet, a darker dado
  m.quad([x0, 1.2, z1], [x1, 1.2, z1], [x1, h, z1], [x0, h, z1], P.rightWall, MAT.paint);
  m.quad([x0, 0, z1], [x1, 0, z1], [x1, 1.2, z1], [x0, 1.2, z1], P.dadoR, MAT.paint);
  // the window wall: a pale dado, then the wall round the bays, the panes (bright: the day) and their frames
  m.quad([x1, 0, z0], [x0, 0, z0], [x0, 1.2, z0], [x1, 1.2, z0], P.dadoL, MAT.paint);
  m.quad([x1, 1.2, z0], [x0, 1.2, z0], [x0, R.winY0, z0], [x1, R.winY0, z0], P.windowWall, MAT.paint);
  m.quad([x1, R.winY1, z0], [x0, R.winY1, z0], [x0, h, z0], [x1, h, z0], P.windowWall, MAT.paint);
  const bays: number[] = [];
  for (let k = Math.ceil((x0 + 0.5) / R.bay); k * R.bay < x1 - 0.5; k++) bays.push(k * R.bay);
  let prev = x0;
  for (const cx of bays) {
    const a = cx - R.w / 2, b = cx + R.w / 2;
    m.quad([a, R.winY0, z0], [prev, R.winY0, z0], [prev, R.winY1, z0], [a, R.winY1, z0], P.windowWall, MAT.paint);
    prev = b;
    // the glass, a hair outside the wall; then the frames over it
    m.quad([b, R.winY0, z0 - 0.02], [a, R.winY0, z0 - 0.02], [a, R.winY1, z0 - 0.02], [b, R.winY1, z0 - 0.02], [1, 1, 1], MAT.window);
    const fz = z0 + 0.01, t = 0.035;
    for (let i = 0; i <= R.cols; i++) { const x = a + (i / R.cols) * R.w; m.box([x - t, R.winY0, z0 - 0.02], [x + t, R.winY1, fz + 0.04], P.frame, MAT.paint); }
    for (let j = 0; j <= R.rows; j++) { const yy = R.winY0 + (j / R.rows) * (R.winY1 - R.winY0); m.box([a, yy - t, z0 - 0.02], [b, yy + t, fz + 0.04], P.frame, MAT.paint); }
    // the sill
    m.box([a - 0.05, R.winY0 - 0.06, z0], [b + 0.05, R.winY0, z0 + 0.12], P.frame, MAT.paint);
    // a radiator under every other window
    if (Math.round(cx / R.bay) % 2 === 0) for (let i = 0; i < 12; i++) { const x = cx - 0.55 + i * 0.1; m.box([x, 0.15, z0 + 0.05], [x + 0.06, 0.85, z0 + 0.14], P.radiator, MAT.paint); }
  }
  m.quad([x1, R.winY0, z0], [prev, R.winY0, z0], [prev, R.winY1, z0], [x1, R.winY1, z0], P.windowWall, MAT.paint);
  // benches: one under the windows, one along the right wall
  bench(m, [-4.5, 0, z0 + 0.45], 2.2);
  bench(m, [-1.2, 0, z1 - 0.4], 2.6);
  bench(m, [5.2, 0, z1 - 0.4], 1.8);
  // a rail of hooks on the right wall: masks and jackets, the room's life outside this bout
  const rail = 1.75;
  m.box([1.2, rail - 0.03, z1 - 0.06], [4.6, rail + 0.03, z1], P.wood, MAT.wood);
  for (let i = 0; i < 6; i++) {
    const x = 1.5 + i * 0.55;
    if (i % 2 === 0) hungMask(m, [x, rail - 0.2, z1 - 0.13]);
    else hungJacket(m, [x, rail - 0.05, z1 - 0.05], i);
  }
  // and a mask left on the far bench
  hungMask(m, [5.6, 0.55, z1 - 0.32]);
  return m;
}

function bench(m: Mesh, at: V, len: number) {
  const [x, , z] = at, P = PAINT;
  m.box([x - len / 2, 0.42, z - 0.17], [x + len / 2, 0.47, z + 0.17], P.wood, MAT.wood);
  for (const s of [-1, 1]) m.box([x + s * (len / 2 - 0.12) - 0.03, 0, z - 0.14], [x + s * (len / 2 - 0.12) + 0.03, 0.42, z + 0.14], [0.08, 0.08, 0.09], MAT.rubber);
}
function hungMask(m: Mesh, c: V) {
  const P = PAINT;
  m.ellipsoid(c, [0.1, 0, 0], [0, 0.14, 0], [0, 0, 0.1], 12, 8, (d) => (d[2] < -0.15 && d[1] > -0.5 ? [P.maskMesh, MAT.mesh] : [P.bib, MAT.cloth]));
  m.box([c[0] - 0.09, c[1] - 0.26, c[2] - 0.02], [c[0] + 0.09, c[1] - 0.12, c[2] + 0.06], P.bib, MAT.cloth);
}
function hungJacket(m: Mesh, top: V, k: number) {
  const [x,y,z] = top;
  // The fabric hangs forward over the hook, compressed at the collar and uneven at the hem.
  const section = (cx: number, cy: number, cz: number, ru: number, rw: number) => ({
    c: [cx,cy,cz] as V, u: [1,0,0] as V, w: [0,0,1] as V, ru, rw,
  });
  const twist = Math.sin(k) * 0.023;
  const body = [
    section(x,y,z-0.05,0.058,0.035),
    section(x,y-0.075,z-0.06,0.17,0.055),
    section(x+twist,y-0.18,z-0.05,0.15,0.049),
    section(x+twist,y-0.49,z-0.06,0.14,0.044),
    section(x+2*twist,y-0.61,z-0.055,0.149,0.044),
  ];
  m.tube(body,16,PAINT.jacket,MAT.cloth,{capB:true,soft:0.85,jit:0.035,seed:k});
  for (const side of [-1,1]) {
    const sleeve = [
      section(x+side*0.127,y-0.081,z-0.066,0.041,0.043),
      section(x+side*0.159,y-0.21,z-0.077,0.046,0.043),
      section(x+side*0.168+twist,y-0.36,z-0.084,0.037,0.035),
      section(x+side*0.15+twist,y-0.51,z-0.095,0.030,0.029),
    ];
    m.tube(sleeve,12,PAINT.jacket,MAT.cloth,{capB:true,soft:0.9});
  }
}

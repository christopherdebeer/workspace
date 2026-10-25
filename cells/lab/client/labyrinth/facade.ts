/**
 * Openings (drawn for mesh.ts, with its means: emit.ts): a face with a door or a window in it, its head (round, or by
 * its manner pointed: regions.ts), reveals and sill, glass or planks at its back; and what says it's lived in at it.
 */
import { hash } from '../kit/rng';
import { DIRS } from './model';
import { buildings, regionHere, type Opening } from './buildings';
import { PERSIAN, ROUND, archNormal, archOf, archY } from './regions';
import { KIND, MAT, PIERCED, type Emit, type V3 } from './emit';

/** the openings' drawing over a world: `holed`, a face with its opening */
export function openings(E: Emit) {
  const { w, dressed, quad, tri, face, box, lathe } = E;
  /** each house's paint, for its shutters and its awning: one of a few, by the house */
  const paintOf = new Map<string, number>();
  for (const b of buildings(w).list) { const c = hash(w.seed, b.i0, b.j0, 41) % 3; for (const o of b.openings) paintOf.set(`${o.k}.${o.i}.${o.j}.${o.d}`, c); }
  /**
   * What says it's lived in, at an opening: a window's shutters, in the house's paint, most folded back flat against the
   * wall either side of it, a few closed over it; over a door at the foot of a house, now and then, an awning of striped
   * canvas, out from the wall and falling a little, its valance along its front. (Their paint in the door's tone, past
   * its own: 2 + the colour for a shutter, 5 + it for canvas; render.ts)
   */
  const lived = (d: number, s0: number, s1: number, op: Opening, P: (d: number, s: number, y: number, inset?: number) => V3, n: V3, hw: number, yb: number, sp: number, top: number, arched: boolean, slit: boolean, door: boolean, r: number, colonnettes: boolean, oriel: boolean) => {
    if (slit || colonnettes || oriel) return;
    const rnd = (q: number) => hash(w.seed, op.k, op.i, op.j, op.d, q) / 4294967296, paint = paintOf.get(`${op.k}.${op.i}.${op.j}.${op.d}`) ?? 0, keepTone = E.cur.tone;
    const slab = (sa: number, sb: number, ya: number, yb2: number, ia: number, ib: number, ao: number) => {
      const A = P(d, sa, ya, ia), B = P(d, sb, yb2, ib);
      box(Math.min(A[0], B[0]), Math.max(A[0], B[0]), ya, yb2, Math.min(A[2], B[2]), Math.max(A[2], B[2]), MAT.door, ao);
    };
    if (!door && rnd(1) < 0.7) {
      E.cur.tone = 2 + paint;
      const yt = arched ? sp + hw * 0.7 : sp, room = -2 * hw - 0.03 > s0 && 2 * hw + 0.03 < s1;
      if (room && rnd(2) < 0.78) for (const sg of [-1, 1]) slab(sg * (hw + 0.012), sg * (2 * hw + 0.012), yb - 0.01, yt, -0.022, -0.008, 0.85);
      else for (const sg of [-1, 1]) slab(0, sg * hw, yb, sp, r * 0.35 + 0.014, r * 0.35, 0.8);
    }
    if (door && rnd(3) < 0.4) {
      E.cur.tone = 5 + paint;
      const [a, b] = DIRS[d], W = hw + 0.1, OUT = 0.3, DROP = 0.12, y1 = top + 0.12, y2 = y1 - DROP, V = 0.05, l = Math.hypot(OUT, DROP);
      const up: V3 = [(a * DROP) / l, OUT / l, (b * DROP) / l];
      quad(P(d, -W, y1), P(d, W, y1), P(d, W, y2, -OUT), P(d, -W, y2, -OUT), up, 1, MAT.door);
      quad(P(d, -W, y1), P(d, W, y1), P(d, W, y2, -OUT), P(d, -W, y2, -OUT), [-up[0], -up[1], -up[2]], 0.6, MAT.door);
      // (its valance, both sides; its ends)
      quad(P(d, -W, y2 - V, -OUT), P(d, W, y2 - V, -OUT), P(d, W, y2, -OUT), P(d, -W, y2, -OUT), n, 0.9, MAT.door);
      quad(P(d, -W, y2 - V, -OUT), P(d, W, y2 - V, -OUT), P(d, W, y2, -OUT), P(d, -W, y2, -OUT), [-n[0], 0, -n[2]], 0.6, MAT.door);
      const [ta, tb] = DIRS[(d + 1) % 4];
      for (const sg of [-1, 1]) tri(P(d, sg * W, y1), P(d, sg * W, y2, -OUT), P(d, sg * W, y2 - V, -OUT), [sg * ta, 0, sg * tb], 0.8, MAT.door);
    }
    E.cur.tone = keepTone;
  };
  /**
   * A face with an opening in it: a door (an arched way in, its leaf of planks set back in the wall, a step at its
   * foot), or a window (arched, square, or a slit; its glass set back, a sill under it). The wall round it, the opening's
   * reveals and head, and what's at the back of it.
   */
  const holed = (d: number, s0: number, s1: number, y0: number, yt: number, op: Opening, P: (d: number, s: number, y: number, inset?: number) => V3, n: V3, foot: number) => {
    const k = Math.floor(y0 + 0.001);
    const door = op.kind === 'door', slit = op.style === 'slit', arched = door || op.style === 'arched' || slit;
    // (its manner (regions.ts): on the plateau a pointed head, its crown where a round one's would be, and a window
    // taller, down nearer the floor, in a painted frame)
    const persian = regionHere(w, op.k, op.i, op.j) === PERSIAN, fam = arched && !slit ? archOf(persian ? PERSIAN : 0) : ROUND;
    const hw = door ? 0.17 : slit ? 0.04 : op.style === 'square' ? 0.12 : persian ? 0.12 : 0.11;
    const yb = door ? k : k + (slit ? 0.28 : persian ? 0.27 : 0.38), sp0 = door ? k + 0.5 : slit ? k + 0.7 : k + (op.style === 'square' ? 0.72 : 0.62);
    const sp = arched ? sp0 + hw - archY(fam, 0, hw) : sp0;
    const head = (t: number) => (arched ? (fam === ROUND ? sp + Math.sqrt(Math.max(0, hw * hw - t * t)) : sp + archY(fam, t, hw)) : sp), top = arched ? sp0 + hw : sp, r = door ? 0.13 : 0.09;
    // (its glass: on the plateau in the house's paint, in panes, and lit within now and then (render.ts, the tone past 2))
    const glassTone = persian && !door ? 2 + (paintOf.get(`${op.k}.${op.i}.${op.j}.${op.d}`) ?? 0) + (hash(w.seed, op.k, op.i, op.j, op.d, 11) % 100 < 55 ? 4 : 0) : -1;
    const back = (A: V3, B: V3, C: V3, D: V3) => {
      if (door || glassTone < 0) return quad(A, B, C, D, n, 0.7, door ? MAT.door : MAT.glass);
      const keep = E.cur.tone; E.cur.tone = glassTone; quad(A, B, C, D, n, 0.7, MAT.glass); E.cur.tone = keep;
    };
    const [ta, tb] = DIRS[(d + 1) % 4];
    // (the wall round it)
    quad(P(d, s0, y0), P(d, -hw, y0), P(d, -hw, yt), P(d, s0, yt), n, [foot, foot, 1, 1], MAT.stone);
    quad(P(d, hw, y0), P(d, s1, y0), P(d, s1, yt), P(d, hw, yt), n, [foot, foot, 1, 1], MAT.stone);
    if (yb > y0 + 0.001) quad(P(d, -hw, y0), P(d, hw, y0), P(d, hw, yb), P(d, -hw, yb), n, [foot, foot, 1, 1], MAT.stone);
    const N = arched ? 8 : 1;
    for (let q = 0; q < N; q++) {
      const t0 = -hw + (2 * hw * q) / N, t1 = -hw + (2 * hw * (q + 1)) / N;
      quad(P(d, t0, head(t0)), P(d, t1, head(t1)), P(d, t1, yt), P(d, t0, yt), n, 1, MAT.stone);
      // (its head, set back)
      const tm = (t0 + t1) / 2, hn = !arched ? [0, -1] : fam === ROUND ? [-(tm / hw), -Math.sqrt(Math.max(0, 1 - (tm / hw) ** 2))] : archNormal(fam, tm, hw);
      quad(P(d, t0, head(t0)), P(d, t1, head(t1)), P(d, t1, head(t1), r), P(d, t0, head(t0), r), [ta * hn[0], hn[1], tb * hn[0]], 0.6, MAT.stone);
      // (and the back of it, under the head)
      back(P(d, t0, sp, r), P(d, t1, sp, r), P(d, t1, head(t1), r), P(d, t0, head(t0), r));
    }
    // (its reveals, its sill or threshold, and what's at the back: the door's planks, or glass)
    quad(P(d, -hw, yb), P(d, -hw, yb, r), P(d, -hw, sp, r), P(d, -hw, sp), [ta, 0, tb], 0.65, MAT.stone);
    quad(P(d, hw, yb), P(d, hw, yb, r), P(d, hw, sp, r), P(d, hw, sp), [-ta, 0, -tb], 0.65, MAT.stone);
    quad(P(d, -hw, yb), P(d, hw, yb), P(d, hw, yb, r), P(d, -hw, yb, r), [0, 1, 0], 0.8, MAT.stone);
    back(P(d, -hw, yb, r), P(d, hw, yb, r), P(d, hw, sp, r), P(d, -hw, sp, r));
    const ledge = (s: number, y: number, h: number, out: number) => {
      quad(P(d, -s, y, -out), P(d, s, y, -out), P(d, s, y + h, -out), P(d, -s, y + h, -out), n, 0.9, MAT.stone);
      quad(P(d, -s, y + h, -out), P(d, s, y + h, -out), P(d, s, y + h), P(d, -s, y + h), [0, 1, 0], 1, MAT.stone);
      quad(P(d, -s, y, -out), P(d, s, y, -out), P(d, s, y), P(d, -s, y), [0, -1, 0], 0.5, MAT.stone);
      quad(P(d, -s, y, -out), P(d, -s, y), P(d, -s, y + h), P(d, -s, y + h, -out), [-ta, 0, -tb], 0.8, MAT.stone);
      quad(P(d, s, y, -out), P(d, s, y), P(d, s, y + h), P(d, s, y + h, -out), [ta, 0, tb], 0.8, MAT.stone);
    };
    if (door) ledge(hw + 0.05, k, 0.03, 0.06); else if (!slit) ledge(hw + 0.03, yb - 0.04, 0.04, 0.035);
    const dr = dressed(op.k, op.i, op.j);
    if (!persian) lived(d, s0, s1, op, P, n, hw, yb, sp, top, arched, slit, door, r, !!dr?.colonnettes, !!(dr?.oriel && !door && !slit && k >= 1));
    // (colonnettes: slim shafts framing it, a pair each side of a door, one each side of an arched window, each on a
    // little base and under a little capital where the arch springs)
    if (dr?.colonnettes && arched && !slit) {
      const keep = E.cur.dress;
      E.cur.dress = 2 * KIND;
      for (const sg of [-1, 1]) for (const off of door ? [0.035, 0.085] : [0.03]) {
        const c = P(d, sg * (hw + off), 0, -0.022), ya = door ? k + 0.03 : yb, rc = 0.017;
        box(c[0] - 0.026, c[0] + 0.026, ya, ya + 0.04, c[2] - 0.026, c[2] + 0.026, MAT.stone, 0.8);
        lathe(c[0], c[2], [[rc, ya + 0.04], [rc * 0.9, sp - 0.04]], MAT.stone, 6);
        lathe(c[0], c[2], [[rc * 0.9, sp - 0.04], [0.03, sp - 0.005]], MAT.stone, 6);
        box(c[0] - 0.031, c[0] + 0.031, sp - 0.005, sp + 0.02, c[2] - 0.031, c[2] + 0.031, MAT.stone, 0.95);
      }
      E.cur.dress = keep;
    }
    // (a mashrabiya over an upper window: a box of fine turned lattice out from the wall on corbels, solid at its foot and
    // head, a little roof over it; the light through it in points)
    if (dr?.oriel && !door && !slit && k >= 1) {
      const keep = E.cur.dress, OW = 0.26, OD = 0.24, ya = k + 0.24, yb2 = Math.min(k + 0.93, top + 0.2), L = MAT.wood + PIERCED;
      const Q = (s: number, out: number, y: number) => P(d, s, y, -out);
      E.cur.dress = 0;
      // (its floor and its foot, solid; its lattice front and sides; a band at its head)
      face([Q(-OW, 0, ya), Q(OW, 0, ya), Q(OW, OD, ya), Q(-OW, OD, ya)], MAT.wood, 0.5, false);
      const panel = (y0: number, y1: number, mat: number) => {
        quad(Q(-OW, OD, y0), Q(OW, OD, y0), Q(OW, OD, y1), Q(-OW, OD, y1), n, 0.9, mat);
        quad(Q(-OW, 0, y0), Q(-OW, OD, y0), Q(-OW, OD, y1), Q(-OW, 0, y1), [-ta, 0, -tb], 0.8, mat);
        quad(Q(OW, 0, y0), Q(OW, OD, y0), Q(OW, OD, y1), Q(OW, 0, y1), [ta, 0, tb], 0.8, mat);
      };
      panel(ya, ya + 0.1, MAT.wood); panel(ya + 0.1, yb2 - 0.06, L); panel(yb2 - 0.06, yb2, MAT.wood);
      // (its inner face of lattice too, so it reads from within as a screen with depth)
      quad(Q(-OW + 0.02, OD - 0.03, ya + 0.1), Q(OW - 0.02, OD - 0.03, ya + 0.1), Q(OW - 0.02, OD - 0.03, yb2 - 0.06), Q(-OW + 0.02, OD - 0.03, yb2 - 0.06), n, 0.6, L);
      // (its roof: a lean-to of boards out over it)
      face([Q(-OW - 0.03, OD + 0.05, yb2), Q(OW + 0.03, OD + 0.05, yb2), Q(OW + 0.03, 0, yb2 + 0.1), Q(-OW - 0.03, 0, yb2 + 0.1)], MAT.wood, 1, true);
      face([Q(-OW - 0.03, OD + 0.05, yb2 - 0.02), Q(OW + 0.03, OD + 0.05, yb2 - 0.02), Q(OW + 0.03, OD + 0.05, yb2), Q(-OW - 0.03, OD + 0.05, yb2)], MAT.wood, 0.8, true, Q(0, 0, yb2));
      // (the corbels under it: two brackets out of the wall)
      for (const sg of [-0.7, 0.7]) {
        const s0 = sg * OW - 0.025, s1 = sg * OW + 0.025;
        for (const sx of [s0, s1]) face([Q(sx, 0, ya - 0.16), Q(sx, 0, ya), Q(sx, OD * 0.85, ya)], MAT.wood, 0.7, true, Q(sg * OW, 0.05, ya - 0.05));
        face([Q(s0, 0, ya - 0.16), Q(s1, 0, ya - 0.16), Q(s1, OD * 0.85, ya), Q(s0, OD * 0.85, ya)], MAT.wood, 0.6, false);
      }
      E.cur.dress = keep;
    }
  };
  return { holed };
}

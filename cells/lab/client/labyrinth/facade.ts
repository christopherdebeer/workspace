/**
 * Openings (drawn for mesh.ts, with its means: emit.ts): a face with a door or a window in it, its head (round, or by
 * its manner pointed: regions.ts), reveals and sill, glass or planks at its back; and what says it's lived in at it.
 */
import { hash } from '../kit/rng';
import { DIRS } from './model';
import { buildings, grammarHere, opening, type Opening } from './buildings';
import { DECK_OUT, FRAME_OUT, FRAME_UP, JETTY, type Bay } from './facades';
import { ROUND, archNormal, archY } from './regions';
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
  const holed = (d: number, s0: number, s1: number, y0: number, yt: number, op: Opening, P: (d: number, s: number, y: number, inset?: number) => V3, n: V3, foot: number, narrow = 1) => {
    const k = Math.floor(y0 + 0.001);
    // (its tradition (regions.ts): its arch (round, or pointed with its crown where a round one's would be), a door's
    // head arched or square; where windows are glazed in panes, a window taller, down nearer the floor)
    const g = grammarHere(w, op.k, op.i, op.j), door = op.kind === 'door', slit = op.style === 'slit';
    const arched = (door && g.doorHead === 'arched') || op.style === 'arched' || slit, fam = arched && !slit ? g.arch : ROUND, tall = !!g.panes;
    const hw = (door ? 0.17 : slit ? 0.04 : op.style === 'square' ? 0.12 : tall ? 0.12 : 0.11) * narrow;
    const yb = door ? k : k + (slit ? 0.28 : tall ? 0.27 : 0.38), sp0 = door ? k + (arched ? 0.5 : 0.66) : slit ? k + 0.7 : k + (op.style === 'square' ? 0.72 : 0.62);
    const sp = arched ? sp0 + hw - archY(fam, 0, hw) : sp0;
    const head = (t: number) => (arched ? (fam === ROUND ? sp + Math.sqrt(Math.max(0, hw * hw - t * t)) : sp + archY(fam, t, hw)) : sp), top = arched ? sp0 + hw : sp, r = door ? 0.13 : 0.09;
    // (its glass, where the tradition glazes in panes: behind bars in one of its paints, by the house; lit within now and
    // then; a fine lattice in the east, its doors screens of it too, lit (render.ts: 2 + the paint, 8 more lit, 16 more
    // fine))
    const pn = g.panes, screen = door && !!pn?.fine;
    const glassTone = pn && (!door || screen) ? 2 + pn.paints[(paintOf.get(`${op.k}.${op.i}.${op.j}.${op.d}`) ?? 0) % pn.paints.length] + (screen || hash(w.seed, op.k, op.i, op.j, op.d, 11) % 100 < pn.lit * 100 ? 8 : 0) + (pn.fine ? 16 : 0) : -1;
    const back = (A: V3, B: V3, C: V3, D: V3) => {
      if ((door && !screen) || glassTone < 0) return quad(A, B, C, D, n, 0.7, door ? MAT.door : MAT.glass);
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
    if (g.shutters) lived(d, s0, s1, op, P, n, hw, yb, sp, top, arched, slit, door, r, !!dr?.colonnettes, !!(dr?.oriel && !door && !slit && k >= 1));
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
  /**
   * A bay with a part in a front (facades.ts), drawn in place of the plain face: a gallery's arch and the vaulted bay
   * cut in behind it; a portal, its frame, its deep recess, the door and the lattice at its back (drawn whole from its
   * foot; the faces over it, `over`, are its frame's and drawn with it); or a pair of windows on a sill course.
   */
  const bay = (d: number, s0: number, s1: number, y0: number, yt: number, by: Bay, P: (d: number, s: number, y: number, inset?: number) => V3, n: V3, foot: number) => {
    if (by.role === 'over') return;
    if (by.role === 'blank') { quad(P(d, s0, y0), P(d, s1, y0), P(d, s1, yt), P(d, s0, yt), n, [foot, foot, 1, 1], MAT.stone); return; }
    const k = by.k, g = grammarHere(w, k, by.i, by.j), fam = g.arch, [ta, tb] = DIRS[(d + 1) % 4];
    const tN = (hn: [number, number]): V3 => [ta * hn[0], hn[1], tb * hn[0]];
    const keepTone = E.cur.tone;
    // (glass lit within, in bars of the house's paint; a fine lattice for a portal's)
    const glass = (A: V3, B: V3, C: V3, D: V3, fine: boolean, lit: boolean) => { const pn = g.panes; E.cur.tone = 2 + (pn ? pn.paints[0] : 0) + (lit ? 8 : 0) + (fine ? 16 : 0); quad(A, B, C, D, n, 0.8, MAT.glass); E.cur.tone = keepTone; };
    if (by.role === 'paired') {
      // (two windows, each in its half; and a sill course run across the whole bay, so the bays' courses are one)
      const op: Opening = { kind: 'window', style: 'arched', k, i: by.i, j: by.j, d };
      const mid = (s0 + s1) / 2, off = (s1 - s0) / 4;
      for (const c of [mid - off, mid + off]) holed(d, (c < mid ? s0 : mid) - c, (c < mid ? mid : s1) - c, y0, yt, op, (dd, s2, y, inset) => P(dd, s2 + c, y, inset), n, foot, 0.85);
      const ys = k + 0.22;
      quad(P(d, s0, ys, -0.03), P(d, s1, ys, -0.03), P(d, s1, ys + 0.035, -0.03), P(d, s0, ys + 0.035, -0.03), n, 0.9, MAT.stone);
      quad(P(d, s0, ys + 0.035, -0.03), P(d, s1, ys + 0.035, -0.03), P(d, s1, ys + 0.035), P(d, s0, ys + 0.035), [0, 1, 0], 1, MAT.stone);
      quad(P(d, s0, ys, -0.03), P(d, s1, ys, -0.03), P(d, s1, ys), P(d, s0, ys), [0, -1, 0], 0.5, MAT.stone);
      return;
    }
    if (by.role === 'jetty') {
      // (the storey stood out over the one under it: its front out by JETTY (run on round a corner), its windows in it as
      // the house has them; its underside, a beam along its foot; its ends, where it ends; its top, under the eaves)
      const J = JETTY, a0 = s0 - (by.ext?.[0] ?? 0), a1 = s1 + (by.ext?.[1] ?? 0), ends = by.ends ?? [true, true];
      const PJ = (dd: number, s2: number, y: number, inset = 0) => P(dd, s2, y, inset - J);
      const op = opening(w, k, by.i, by.j, d);
      if (op) holed(d, a0, a1, y0, yt, op, PJ, n, 1); else quad(PJ(d, a0, y0), PJ(d, a1, y0), PJ(d, a1, yt), PJ(d, a0, yt), n, 1, MAT.stone);
      quad(P(d, a0, k, 0), P(d, a1, k, 0), P(d, a1, k, -J), P(d, a0, k, -J), [0, -1, 0], 0.45, MAT.wood);
      const keepHow = E.cur.how; E.cur.how = 1;
      const bA = P(d, a0, k, -J - 0.015), bB = P(d, a1, k + 0.07, -J + 0.03);
      box(Math.min(bA[0], bB[0]), Math.max(bA[0], bB[0]), k, k + 0.07, Math.min(bA[2], bB[2]), Math.max(bA[2], bB[2]), MAT.wood, 0.85);
      E.cur.how = keepHow;
      if (ends[0]) quad(P(d, a0, y0, 0), P(d, a0, y0, -J), P(d, a0, yt, -J), P(d, a0, yt, 0), [-ta, 0, -tb], 0.8, MAT.stone);
      if (ends[1]) quad(P(d, a1, y0, -J), P(d, a1, y0, 0), P(d, a1, yt, 0), P(d, a1, yt, -J), [ta, 0, tb], 0.8, MAT.stone);
      if (k === by.b.h - 1) quad(P(d, a0, yt, -J), P(d, a1, yt, -J), P(d, a1, yt, 0), P(d, a0, yt, 0), [0, 1, 0], 0.9, MAT.stone);
      return;
    }
    if (by.role === 'shop') {
      // (a shopfront: piers either side, a timber beam over a wide opening, under it a stall board and the window lit
      // behind it, small panes; a board hinged up over it, out a little)
      const hw = 0.37, yB = k + 0.74, yS = k + 0.3, R = 0.07;
      quad(P(d, s0, y0), P(d, -hw, y0), P(d, -hw, yt), P(d, s0, yt), n, [foot, foot, 1, 1], MAT.stone);
      quad(P(d, hw, y0), P(d, s1, y0), P(d, s1, yt), P(d, hw, yt), n, [foot, foot, 1, 1], MAT.stone);
      quad(P(d, -hw, yB), P(d, hw, yB), P(d, hw, yt), P(d, -hw, yt), n, 1, MAT.stone);
      const bm0 = P(d, -hw - 0.04, yB, -0.03), bm1 = P(d, hw + 0.04, yB + 0.08, 0.01);
      box(Math.min(bm0[0], bm1[0]), Math.max(bm0[0], bm1[0]), yB, yB + 0.08, Math.min(bm0[2], bm1[2]), Math.max(bm0[2], bm1[2]), MAT.wood, 0.9);
      quad(P(d, -hw, k, 0.01), P(d, hw, k, 0.01), P(d, hw, yS, 0.01), P(d, -hw, yS, 0.01), n, 0.85, MAT.wood);
      quad(P(d, -hw, yS, 0.01), P(d, hw, yS, 0.01), P(d, hw, yS, R), P(d, -hw, yS, R), [0, 1, 0], 0.8, MAT.wood);
      glass(P(d, -hw, yS, R), P(d, hw, yS, R), P(d, hw, yB, R), P(d, -hw, yB, R), false, hash(w.seed, by.k, by.i, by.j, d, 15) % 100 < 70);
      for (const sg of [-1, 1]) quad(P(d, sg * hw, yS, 0), P(d, sg * hw, yS, R), P(d, sg * hw, yB, R), P(d, sg * hw, yB, 0), [-sg * ta, 0, -sg * tb], 0.6, MAT.stone);
      quad(P(d, -hw, yB - 0.001, 0), P(d, hw, yB - 0.001, 0), P(d, hw, yB - 0.001, R), P(d, -hw, yB - 0.001, R), [0, -1, 0], 0.5, MAT.stone);
      face([P(d, -hw, yB + 0.1, -0.01), P(d, hw, yB + 0.1, -0.01), P(d, hw, yB + 0.04, -0.2), P(d, -hw, yB + 0.04, -0.2)], MAT.wood, 0.9, true);
      return;
    }
    if (by.role === 'veranda') {
      // (a veranda: the front a lattice of screens, lit, in a timber frame, a beam over it; out before it a deck of
      // boards, a post at each of its ends and between bays, up to the skirt over it)
      const yB = k + 0.82, ends = by.ends ?? [true, true];
      quad(P(d, s0, yB), P(d, s1, yB), P(d, s1, yt), P(d, s0, yt), n, 1, MAT.stone);
      glass(P(d, s0, k, 0.02), P(d, s1, k, 0.02), P(d, s1, yB, 0.02), P(d, s0, yB, 0.02), true, true);
      const keepHow = E.cur.how; E.cur.how = 1;
      for (const sx of [s0 + 0.03, (s0 + s1) / 2, s1 - 0.03]) { const c = P(d, sx, 0, 0.01); box(c[0] - 0.025, c[0] + 0.025, k, yB, c[2] - 0.025, c[2] + 0.025, MAT.wood, 0.8); }
      const bm0 = P(d, s0, yB, -0.01), bm1 = P(d, s1, yB + 0.06, 0.02);
      box(Math.min(bm0[0], bm1[0]), Math.max(bm0[0], bm1[0]), yB, yB + 0.06, Math.min(bm0[2], bm1[2]), Math.max(bm0[2], bm1[2]), MAT.wood, 0.85);
      const dk0 = P(d, s0, k, -DECK_OUT), dk1 = P(d, s1, k + 0.1, 0);
      box(Math.min(dk0[0], dk1[0]), Math.max(dk0[0], dk1[0]), k, k + 0.1, Math.min(dk0[2], dk1[2]), Math.max(dk0[2], dk1[2]), MAT.wood, [0.6, 0.6, 1, 1]);
      for (const [sx, on] of [[s0 + 0.03, ends[0]], [s1 - 0.03, true]] as Array<[number, boolean]>) {
        if (!on) continue;
        const c = P(d, sx, 0, -DECK_OUT + 0.03); box(c[0] - 0.025, c[0] + 0.025, k + 0.1, k + 0.97, c[2] - 0.025, c[2] + 0.025, MAT.wood, 0.85);
      }
      E.cur.how = keepHow;
      return;
    }
    if (by.role === 'balcony') {
      // (its wall with a tall window, as the house opens it; out in front, a timber floor on two brackets, a lattice rail
      // round it, a post at each corner)
      holed(d, s0, s1, y0, yt, { kind: 'window', style: 'arched', k, i: by.i, j: by.j, d }, P, n, foot);
      const OUT = 0.3, W = 0.36, yf = k + 0.02, RH = 0.3, L = MAT.wood + PIERCED, keep = E.cur.dress;
      E.cur.dress = 0;
      const A = P(d, -W, yf, -OUT), B = P(d, W, yf + 0.05, 0);
      box(Math.min(A[0], B[0]), Math.max(A[0], B[0]), yf, yf + 0.05, Math.min(A[2], B[2]), Math.max(A[2], B[2]), MAT.wood, 0.85);
      for (const s2 of [-W * 0.7, W * 0.7]) {
        face([P(d, s2 - 0.02, yf - 0.2, 0), P(d, s2 - 0.02, yf, 0), P(d, s2 - 0.02, yf, -OUT * 0.85)], MAT.wood, 0.7, true, P(d, s2, yf - 0.05, -0.05));
        face([P(d, s2 + 0.02, yf - 0.2, 0), P(d, s2 + 0.02, yf, 0), P(d, s2 + 0.02, yf, -OUT * 0.85)], MAT.wood, 0.7, true, P(d, s2, yf - 0.05, -0.05));
        quad(P(d, s2 - 0.02, yf - 0.2, 0), P(d, s2 + 0.02, yf - 0.2, 0), P(d, s2 + 0.02, yf, -OUT * 0.85), P(d, s2 - 0.02, yf, -OUT * 0.85), [n[0] * 0.6, -0.8, n[2] * 0.6], 0.6, MAT.wood);
      }
      const y1 = yf + 0.05, y2 = y1 + RH;
      quad(P(d, -W, y1, -OUT), P(d, W, y1, -OUT), P(d, W, y2, -OUT), P(d, -W, y2, -OUT), n, 0.9, L);
      quad(P(d, -W, y1, -OUT + 0.01), P(d, W, y1, -OUT + 0.01), P(d, W, y2, -OUT + 0.01), P(d, -W, y2, -OUT + 0.01), [-n[0], 0, -n[2]], 0.7, L);
      for (const sg of [-1, 1]) quad(P(d, sg * W, y1, 0), P(d, sg * W, y1, -OUT), P(d, sg * W, y2, -OUT), P(d, sg * W, y2, 0), [sg * ta, 0, sg * tb], 0.85, L);
      for (const [s2, o] of [[-W, -OUT], [W, -OUT], [-W, 0], [W, 0]]) { const c = P(d, s2, 0, o); box(c[0] - 0.02, c[0] + 0.02, y1, y2 + 0.03, c[2] - 0.02, c[2] + 0.02, MAT.wood, 0.9); }
      const r0 = P(d, -W - 0.02, y2, -OUT - 0.02), r1 = P(d, W + 0.02, y2 + 0.03, 0);
      box(Math.min(r0[0], r1[0]), Math.max(r0[0], r1[0]), y2, y2 + 0.03, Math.min(r0[2], r1[2]), Math.max(r0[2], r1[2]), MAT.wood, 1);
      E.cur.dress = keep;
      return;
    }
    if (by.role === 'loggia') {
      // (a gallery behind slender columns, each bay a pair of them at its edges (paired where bays meet), a lintel and a
      // band of tile over them; its floor, ceiling and back wall (a door and a lit window by turns), side walls only at
      // its ends; a low parapet between the columns)
      const D = 0.3, yl = k + 0.8, R = 0.045, e0 = s0 + 0.07, e1 = s1 - 0.07, ends = by.ends ?? [true, true];
      quad(P(d, s0, yl, 0), P(d, s1, yl, 0), P(d, s1, yt, 0), P(d, s0, yt, 0), n, 1, MAT.stone);
      E.cur.tone = 2; quad(P(d, s0, yl + 0.04, -0.012), P(d, s1, yl + 0.04, -0.012), P(d, s1, yl + 0.13, -0.012), P(d, s0, yl + 0.13, -0.012), n, 1, MAT.lead); E.cur.tone = keepTone;
      quad(P(d, s0, yl, 0), P(d, s1, yl, 0), P(d, s1, yl, D), P(d, s0, yl, D), [0, -1, 0], 0.5, MAT.within);
      quad(P(d, s0, k + 0.004, 0), P(d, s1, k + 0.004, 0), P(d, s1, k + 0.004, D), P(d, s0, k + 0.004, D), [0, 1, 0], 0.65, MAT.stone);
      quad(P(d, s0, k, D), P(d, s1, k, D), P(d, s1, yl, D), P(d, s0, yl, D), n, 0.6, MAT.within);
      if (ends[0]) quad(P(d, s0, k, 0), P(d, s0, k, D), P(d, s0, yl, D), P(d, s0, yl, 0), [ta, 0, tb], 0.6, MAT.within);
      if (ends[1]) quad(P(d, s1, k, D), P(d, s1, k, 0), P(d, s1, yl, 0), P(d, s1, yl, D), [-ta, 0, -tb], 0.6, MAT.within);
      for (const sx of [e0, e1]) { const c = P(d, sx, 0, 0.05); lathe(c[0], c[2], [[R * 1.4, k], [R, k + 0.06], [R * 0.85, yl - 0.07], [R * 1.5, yl]], MAT.stone, 8); }
      const inD = D - 0.004;
      if ((by.i + by.j) % 2 === 0) quad(P(d, -0.12, k, inD), P(d, 0.12, k, inD), P(d, 0.12, k + 0.62, inD), P(d, -0.12, k + 0.62, inD), n, 0.6, MAT.door);
      else glass(P(d, -0.13, k + 0.2, inD), P(d, 0.13, k + 0.2, inD), P(d, 0.13, k + 0.66, inD), P(d, -0.13, k + 0.66, inD), false, hash(w.seed, by.k, by.i, by.j, d, 14) % 100 < 65);
      const pa = P(d, e0 + R, k, 0.03), pb = P(d, e1 - R, k + 0.24, 0.07);
      box(Math.min(pa[0], pb[0]), Math.max(pa[0], pb[0]), k, k + 0.24, Math.min(pa[2], pb[2]), Math.max(pa[2], pb[2]), MAT.stone, [0.8, 0.8, 1, 1]);
      return;
    }
    // (an arch cut into the stone: half-width hw, its crown at yC, cut in to D; the front at `out` (a portal's frame
    // stands proud))
    const portal = by.role === 'portal', hw = portal ? 0.34 : 0.33, out = portal ? -FRAME_OUT : 0, D = portal ? 0.42 : 0.32;
    const yC = portal ? k + Math.min(1.75, by.top - k - 0.32) : k + 0.84, spring = yC - archY(fam, 0, hw), head = (t: number) => spring + archY(fam, t, hw);
    const top = portal ? by.top + FRAME_UP : yt, e0 = portal ? -0.5 : s0, e1 = portal ? 0.5 : s1, N = 12;
    // (the front: piers either side, and the spandrel over the arch; a portal's faced in tile (lead's material, its tone
    // past 2: render.ts), a gallery's stone)
    const faceMat = portal ? MAT.lead : MAT.stone;
    if (portal) E.cur.tone = 2;
    quad(P(d, e0, y0, out), P(d, -hw, y0, out), P(d, -hw, top, out), P(d, e0, top, out), n, [foot, foot, 1, 1], faceMat);
    quad(P(d, hw, y0, out), P(d, e1, y0, out), P(d, e1, top, out), P(d, hw, top, out), n, [foot, foot, 1, 1], faceMat);
    for (let q = 0; q < N; q++) { const t0 = -hw + (2 * hw * q) / N, t1 = -hw + (2 * hw * (q + 1)) / N; quad(P(d, t0, head(t0), out), P(d, t1, head(t1), out), P(d, t1, top, out), P(d, t0, top, out), n, 1, faceMat); }
    E.cur.tone = keepTone;
    if (portal) {
      // (its frame's edges, in stone: its sides and top out of the wall, the back of it over the roof; a moulding round it)
      const B = 0.05;
      quad(P(d, -0.5, y0, out), P(d, -0.5, y0), P(d, -0.5, top), P(d, -0.5, top, out), [-ta, 0, -tb], 0.85, MAT.stone);
      quad(P(d, 0.5, y0), P(d, 0.5, y0, out), P(d, 0.5, top, out), P(d, 0.5, top), [ta, 0, tb], 0.85, MAT.stone);
      quad(P(d, -0.5, top, out), P(d, 0.5, top, out), P(d, 0.5, top, 0.14), P(d, -0.5, top, 0.14), [0, 1, 0], 1, MAT.stone);
      quad(P(d, -0.5, by.top, 0.14), P(d, 0.5, by.top, 0.14), P(d, 0.5, top, 0.14), P(d, -0.5, top, 0.14), [-n[0], 0, -n[2]], 0.8, MAT.stone);
      for (const [a0, a1, b0, b1] of [[-0.5, -0.5 + B, y0, top], [0.5 - B, 0.5, y0, top], [-0.5, 0.5, top - B, top]]) {
        const A = P(d, a0, b0, out - 0.015), C = P(d, a1, b1, out);
        box(Math.min(A[0], C[0]), Math.max(A[0], C[0]), b0, b1, Math.min(A[2], C[2]), Math.max(A[2], C[2]), MAT.stone, 0.95);
      }
    }
    // (inside: its reveals up to the springing, its vault, its floor, and its back wall)
    quad(P(d, -hw, k, out), P(d, -hw, k, D), P(d, -hw, spring, D), P(d, -hw, spring, out), [ta, 0, tb], 0.6, MAT.within);
    quad(P(d, hw, k, D), P(d, hw, k, out), P(d, hw, spring, out), P(d, hw, spring, D), [-ta, 0, -tb], 0.6, MAT.within);
    for (let q = 0; q < N; q++) {
      const t0 = -hw + (2 * hw * q) / N, t1 = -hw + (2 * hw * (q + 1)) / N, hn = archNormal(fam, (t0 + t1) / 2, hw);
      quad(P(d, t0, head(t0), out), P(d, t1, head(t1), out), P(d, t1, head(t1), D), P(d, t0, head(t0), D), tN(hn), 0.5, MAT.within);
      quad(P(d, t0, k, D), P(d, t1, k, D), P(d, t1, head(t1), D), P(d, t0, head(t0), D), n, 0.45, MAT.within);
    }
    quad(P(d, -hw, k + 0.004, out), P(d, hw, k + 0.004, out), P(d, hw, k + 0.004, D), P(d, -hw, k + 0.004, D), [0, 1, 0], 0.6, MAT.stone);
    // (at its back: a door, or (every other gallery bay) a window lit within; a portal's door tall, a lattice lit over it)
    const inD = D - 0.004, door = portal || (by.i + by.j) % 2 === 0;
    if (door) quad(P(d, -0.13, k, inD), P(d, 0.13, k, inD), P(d, 0.13, k + (portal ? 0.78 : 0.6), inD), P(d, -0.13, k + (portal ? 0.78 : 0.6), inD), n, 0.6, MAT.door);
    else glass(P(d, -0.12, k + 0.26, inD), P(d, 0.12, k + 0.26, inD), P(d, 0.12, k + 0.66, inD), P(d, -0.12, k + 0.66, inD), false, hash(w.seed, by.k, by.i, by.j, d, 13) % 100 < 60);
    if (portal) { const yb = k + 0.9, yh = Math.min(spring + 0.15, yC - 0.2); if (yh > yb + 0.15) glass(P(d, -0.22, yb, inD), P(d, 0.22, yb, inD), P(d, 0.22, yh, inD), P(d, -0.22, yh, inD), true, true); }
  };
  return { holed, bay };
}

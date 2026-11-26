/**
 * The kit's pattern: flat pieces, drafted to the athlete, that the simulated cloth (cloth.ts) is made of.
 *
 * A garment piece of the athlete (athlete.ts) is a loft: a grid of rings round a limb or the trunk. As worn and
 * smooth, it's the shape the cloth hangs on. What it's *made of* is flat cloth: panels cut from a sheet and sewn edge to
 * edge. The cloth's lengths at rest are distances on those flat panels, not on the shape it's worn in. That matters:
 * flat cloth can't take on a doubly curved shape (a shoulder, a chest, a seat) without easing, folding or a dart, and a
 * sleeve drafted straight is too long inside the elbow and too short outside it once the arm bends. Tailoring is what
 * puts the cloth's spare length and width where the body moves.
 *
 * Each piece is cut into panels at its seams, and each panel is drafted as a tailor drafts a block: a grain line down
 * its middle, its length measured down that line (a sleeve or a leg down its centre line, as if straight: a pattern is
 * drafted straight and the arm bends it), and at each level its width round the body from the grain line out to its
 * seams, each eased by the cut. Each point of the grid gets a place on its panel; a point on a seam has a place on both.
 * The rest length between two neighbours is their distance on the paper (across a seam, the two halves to the seam
 * added up: sewn).
 *
 * The cut (fencing kit, as it's made: these are a tailor's allowances, not measurements of a real jacket):
 * - the jacket: fitted, with extra width across the back for reaching forward and a little across the chest;
 * - the sleeve: cut pre-curved (as fencing sleeves are: most of the way to the guard's bend), set in, with elbow ease on
 *   the outside of the elbow (a tailored sleeve's) for the rest of the bend, and some fullness round the elbow;
 * - the breeches: fitted through the seat and thigh, cut a little bent at the knee, with ease over the front of it.
 */
import type { ClothPiece } from './athlete';
import { SKIN_STRIDE } from './athlete';

type V = [number, number, number];
export type P2 = [number, number];
/** each point's twelve neighbours (rows, columns): along, round, the diagonals, and two along and two round */
export const OFFSETS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]];

/** a drafted panel, for drawing the pattern: its outline on the paper, its grain line, which piece, which panel */
export interface Sheet { piece: ClothPiece['kind']; panel: number; outline: P2[]; grain: [P2, P2]; seams: { left: number; right: number; top: number; bottom: number } }
export interface Draft {
  /** per point (piece by piece, ring by ring, column by column), the rest length to each of its twelve neighbours, m (0: none) */
  rest: Float32Array;
  sheets: Sheet[];
}

/** where each kind of piece is cut into panels (fractions round its loft), and its cut */
const PANELS: Record<ClothPiece['kind'], number[]> = {
  jacket: [0, 0.25, 0.5, 0.75],
  sleeveW: [0, 0.5], sleeveR: [0, 0.5],
  breeches: [0.25, 0.75],
};
const near = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));
/** how far toward the guard's bend a limb's pattern is cut (0: straight; 1: as bent as the guard) */
const PRECURVE: Partial<Record<ClothPiece['kind'], number>> = { sleeveW: 0.7, sleeveR: 0.7, breeches: 0.35 };

export function tailor(verts: Float32Array, pieces: ClothPiece[]): Draft {
  const total = pieces.reduce((s, p) => s + p.R * (p.J - 1), 0), rest = new Float32Array(total * 12), sheets: Sheet[] = [];
  let off = 0;
  for (const p of pieces) {
    draftPiece(verts, p, (r, c, k, l) => { rest[(off + r * (p.J - 1) + c) * 12 + k] = l; }, sheets);
    off += p.R * (p.J - 1);
  }
  return { rest, sheets };
}

function draftPiece(verts: Float32Array, p: ClothPiece, put: (r: number, c: number, k: number, l: number) => void, sheets: Sheet[]) {
  const R = p.R, S = p.J - 1, j = p.joint ?? 0.5;
  const col = (c: number) => ((Math.round(c) % S) + S) % S;
  const at = (r: number, c: number): V => { const v = (p.base + r * p.J + col(c)) * SKIN_STRIDE; return [verts[v], verts[v + 1], verts[v + 2]]; };
  const nrm = (r: number, c: number): V => { const v = (p.base + r * p.J + col(c)) * SKIN_STRIDE; return [verts[v + 3], verts[v + 4], verts[v + 5]]; };
  const d = (a: V, b: V) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const centre = Array.from({ length: R }, (_, r) => { const s: V = [0, 0, 0]; for (let c = 0; c < S; c++) { const q = at(r, c); s[0] += q[0] / S; s[1] += q[1] / S; s[2] += q[2] / S; } return s; });
  const row = (r: number) => r / (R - 1);

  // which way a limb bends out: from the chord between its ends to its middle at the joint (the outside of an elbow,
  // the front of a knee)
  const jr = Math.round(j * (R - 1)), mid = centre[jr], ends: V = [(centre[0][0] + centre[R - 1][0]) / 2, (centre[0][1] + centre[R - 1][1]) / 2, (centre[0][2] + centre[R - 1][2]) / 2];
  const outL = d(mid, ends) || 1, out: V = [(mid[0] - ends[0]) / outL, (mid[1] - ends[1]) / outL, (mid[2] - ends[2]) / outL];
  const outside = (c: number) => {
    const q = at(jr, c), rad: V = [q[0] - mid[0], q[1] - mid[1], q[2] - mid[2]], l = Math.hypot(...rad) || 1;
    return Math.max(0, (rad[0] * out[0] + rad[1] * out[1] + rad[2] * out[2]) / l);
  };
  // (the jacket's back faces +z, the fencer's right: its front, the chest, faces the left, as athlete.ts builds it)
  const back = (r: number, c: number) => Math.max(0, nrm(r, c)[2]), front = (r: number, c: number) => Math.max(0, -nrm(r, c)[2]);

  // the cut: how much the paper is longer (down the grain) and wider (round) than the worn shape, here
  const lenEase = (r: number, c: number) => {
    const t = row(r);
    switch (p.kind) {
      case 'jacket': return 1.01;
      case 'sleeveW': case 'sleeveR': return 1.015 + 0.1 * outside(c) * near(t, j, 0.09);
      case 'breeches': return 1.01 + 0.09 * outside(c) * near(t, j, 0.09);
    }
  };
  const roundEase = (r: number, c: number) => {
    const t = row(r);
    switch (p.kind) {
      case 'jacket': return 1.01 + 0.04 * back(r, c) * near(t, 0.72, 0.13) + 0.015 * front(r, c) * near(t, 0.62, 0.12);
      case 'sleeveW': case 'sleeveR': return 1.03 + 0.035 * near(t, j, 0.18);
      case 'breeches': return 1.012 + 0.02 * near(t, j, 0.16);
    }
  };

  // the panels: their first columns round the loft, and each column's panel (a seam column is the start of one panel
  // and the end of the one before)
  const starts = PANELS[p.kind].map((f) => Math.round(f * S) % S), K = starts.length;
  const width = (k: number) => ((starts[(k + 1) % K] - starts[k] + S) % S) || S;
  const tIn = (k: number, c: number) => ((c - starts[k]) % S + S) % S;
  const panelsOf = (c: number): number[] => {
    const ks: number[] = [];
    for (let k = 0; k < K; k++) { const t = tIn(k, c); if (t <= width(k)) ks.push(k); }
    return ks;
  };

  // each panel drafted: its grain column (its middle), its length down that line from the first ring (down the
  // centre line for a limb: drafted straight), and its width at each ring out from the grain line, both eased
  const coords = Array.from({ length: K }, (_, k) => {
    const w = width(k), g = starts[k] + Math.floor(w / 2);
    const xy: P2[][] = Array.from({ length: R }, () => new Array(w + 1));
    const limb = p.kind !== 'jacket';
    // (y down the grain line for each column of the panel, its own length ease)
    const ys = new Float64Array(w + 1);
    const bend = PRECURVE[p.kind] ?? 0;
    for (let r = 0; r < R; r++) {
      // (down the grain for a block; for a limb, each column's length between its centre line's (straight) and its
      // own as worn in the guard, by how pre-curved it's cut)
      const dyAt = (c: number) => r === 0 ? 0 : limb ? (1 - bend) * d(centre[r], centre[r - 1]) + bend * d(at(r, c), at(r - 1, c)) : d(at(r, g), at(r - 1, g));
      // (x round the ring from the grain line, eased; the paper's own rows aren't straight where length is eased
      // unevenly across the panel, as an elbow's is)
      const gt = Math.floor(w / 2);
      let x = 0;
      const xs = new Float64Array(w + 1);
      for (let t = gt + 1; t <= w; t++) { const c = starts[k] + t; x += d(at(r, c - 1), at(r, c)) * roundEase(r, c - 0.5); xs[t] = x; }
      x = 0;
      for (let t = gt - 1; t >= 0; t--) { const c = starts[k] + t; x -= d(at(r, c + 1), at(r, c)) * roundEase(r, c + 0.5); xs[t] = x; }
      for (let t = 0; t <= w; t++) { ys[t] += dyAt(starts[k] + t) * lenEase(r, starts[k] + t); xy[r][t] = [xs[t], ys[t]]; }
    }
    // the lines trued, as a tailor trues them: the worn shape's sculpted wrinkles smoothed out of the paper (its widths
    // averaged over a few rings; its lengths are already down a smooth line), so the cloth's folds are its own
    const TRUE = 4, wt = (o: number) => TRUE + 1 - Math.abs(o);
    for (let t = 0; t <= w; t++) {
      const x0 = xy.map((rw) => rw[t][0]);
      for (let r = 1; r < R - 1; r++) {
        // (the first and last rings keep their own widths: the collar, the cuff, the hem are cut to measure)
        let sx = 0, n = 0;
        for (let o = -TRUE; o <= TRUE; o++) { const q = r + o; if (q < 0 || q >= R) continue; sx += x0[q] * wt(o); n += wt(o); }
        xy[r][t] = [sx / n, xy[r][t][1]];
      }
    }
    const left = xy.map((rw) => rw[0]), right = xy.map((rw) => rw[w]);
    sheets.push({
      piece: p.kind, panel: k, outline: [...left, ...xy[R - 1].slice(1, -1), ...right.reverse(), ...xy[0].slice(1, -1).reverse()],
      grain: [xy[0][Math.floor(w / 2)], xy[R - 1][Math.floor(w / 2)]],
      seams: { left: len2(left), right: len2(xy.map((rw) => rw[w])), top: len2(xy[R - 1]), bottom: len2(xy[0]) },
    });
    return xy;
  });
  const place = (k: number, r: number, c: number): P2 => coords[k][r][tIn(k, c)];
  const dist = (a: P2, b: P2) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  for (let r = 0; r < R; r++) for (let c = 0; c < S; c++) {
    const pa = panelsOf(c);
    OFFSETS.forEach(([dr, dc], k) => {
      const rr = r + dr; if (rr < 0 || rr >= R) return;
      const cc = (c + dc + S) % S, pb = panelsOf(cc), shared = pa.find((x) => pb.includes(x));
      if (shared !== undefined) { put(r, c, k, dist(place(shared, r, c), place(shared, rr, cc))); return; }
      // across a seam: to the seam column on this panel's paper, and on from it on the other's (sewn)
      const step = Math.sign(dc);
      let s = c; for (let i = 0; i < Math.abs(dc); i++) { s = (s + step + S) % S; if (panelsOf(s).length > 1) break; }
      const ka = pa.find((x) => panelsOf(s).includes(x)) ?? pa[0], kb = pb.find((x) => panelsOf(s).includes(x)) ?? pb[0];
      put(r, c, k, dist(place(ka, r, c), place(ka, r, s)) + dist(place(kb, r, s), place(kb, rr, cc)));
    });
  }
}
const len2 = (pts: P2[]) => pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);

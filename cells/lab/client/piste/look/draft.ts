/**
 * The jacket drafted as a tailor drafts it: from the athlete's measurements, flat, as pattern pieces, then sewn round the
 * body (settle.ts) and fitted (devtools/piste-jacket.mjs): settled, measured, altered, again.
 *
 * The body is measured from the fencer's own trunk (its contact capsules, fencer.ts: they stand for the body and what's
 * worn under the jacket), in horizontal slices: the girth and the centre at each height.
 *
 * The pattern is a few numbers, which is what's altered:
 * - the body: four quarter panels, front and back each side of the weapon-arm side (W) and the rear side (R), drafted
 *   from the centre front or back out to the side seam. Each is its widths at stations up the body (the block), cut
 *   above the underarm into the armhole (scooping in from the side seam to the shoulder point) and at the top into the
 *   neckline, the shoulder dropping toward its point. Sewn: centre front, centre back, the side seams below the
 *   underarm, the shoulder seams (front top to back top).
 * - the sleeves: a tube each, its round at stations from the cap to the cuff, and its length; the cap is set into the
 *   armhole with a little ease (its round at the top is the armhole's length and that), the underarm seam closing it.
 *
 * What it doesn't yet have (said so the fit isn't read as more than it is): the cap's height (a straight-topped sleeve
 * set in), the collar, the closure offset to the side away from the weapon arm, darts.
 */
import type { Capsule } from '../fencer';
import { type V, add, cross, dot, len, madd, norm, scale, sub } from '../v3';

export type Quarter = 'FW' | 'FR' | 'BW' | 'BR';
export const QUARTERS: Quarter[] = ['FW', 'FR', 'BW', 'BR'];

export interface JacketPattern {
  /** from the hem to the shoulder at the neck, m (the block's height, up which the stations and the armhole are set) */
  length: number;
  /** each quarter's length up its own centre, over the body to the shoulder seam (a front climbs the chest's depth to
   * meet the back on top of the shoulder), m */
  lengths: Record<Quarter, number>;
  /** heights above the hem of the body's stations, m */
  stations: number[];
  /** each quarter's width at each station (the block, before the armhole and the neck are cut), m */
  widths: Record<Quarter, number[]>;
  /** the underarm's height above the hem; the shoulder's drop to its point; the neck's half-width; its depth in front and behind */
  armhole: number; drop: number; neckW: number; neckFront: number; neckBack: number;
  /** the shoulder point: its distance from the centre, along the shoulder, m */
  shoulderW: number;
  /** each sleeve: its round at stations from the cap (0) to the cuff (1), its length, and the cap's ease into the armhole */
  sleeves: Record<'W' | 'R', { stations: number[]; round: number[]; length: number }>;
  capEase: number;
  /** what's been done to it, in order */
  moves: string[];
}

/** the body as the draft sees it: in the fencer's frame (forward f, up, right r; the chest faces −r) */
export interface Body { caps: Capsule[]; trunk: Capsule[];
  /** what the jacket's body goes round (the trunk and the tops of the thighs), and what its sleeves do (the arms too) */
  bodyCaps: Capsule[]; sleeveCaps: Capsule[]; pelvis: V; f: V; r: V; up: V; shoulder: V; rearShoulder: V; armW: V[]; armR: V[] }

const segDist = (p: V, a: V, b: V): [number, number] => {
  const ab = sub(b, a), t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / Math.max(1e-12, dot(ab, ab))));
  return [len(sub(p, madd(a, ab, t))), t];
};
/** how far p is outside the capsules (negative inside) */
export function clearance(p: V, caps: Capsule[]): number {
  let best = Infinity;
  for (const c of caps) { const [d, t] = segDist(p, c.a, c.b); best = Math.min(best, d - (c.ra + (c.rb - c.ra) * t)); }
  return best;
}

/** the trunk's slice at height y (above the floor): its centre, its radius toward a direction, its girth */
export function slice(B: Body, y: number) {
  const c: V = [B.pelvis[0], y, B.pelvis[2]];
  const radius = (dir: V) => {
    let lo = 0, hi = 0.5;
    // (outward from the centre to where the ray last leaves the body: round the thighs too, at the hem)
    for (let m = 0.5; m > 0; m -= 0.005) if (clearance(madd(c, dir, m), B.bodyCaps) < 0) { lo = m; hi = m + 0.005; break; }
    if (hi === 0.5) return 0.05;
    for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (clearance(madd(c, dir, m), B.bodyCaps) < 0) lo = m; else hi = m; }
    return lo;
  };
  const dirAt = (a: number): V => add(scale(B.r, -Math.cos(a)), scale(B.f, Math.sin(a)));
  const N = 72, pts = Array.from({ length: N }, (_, k) => madd(c, dirAt((k / N) * Math.PI * 2), radius(dirAt((k / N) * Math.PI * 2))));
  const girth = pts.reduce((s, p, k) => s + len(sub(p, pts[(k + 1) % N])), 0);
  return { c, radius, dirAt, girth };
}

/** the first draft, from the body's measurements and a tailor's ease */
export function draftJacket(B: Body): JacketPattern {
  const hem = B.pelvis[1] - 0.1, top = B.shoulder[1] + 0.075, length = top - hem;
  const stations = Array.from({ length: 9 }, (_, k) => (k / 8) * length);
  const ease = (h: number) => 0.06 + 0.02 * Math.exp(-(((h - length * 0.6) / 0.1) ** 2));   // (girth ease: more across the chest)
  const q = stations.map((h) => (slice(B, hem + h).girth + ease(h)) / 4);
  const armLen = (pts: V[]) => len(sub(pts[1], pts[0])) + len(sub(pts[2], pts[1]));
  const sleeve = (pts: V[]) => ({ stations: [0, 0.25, 0.5, 0.75, 1], round: [0.42, 0.38, 0.34, 0.31, 0.27], length: armLen(pts) + 0.02 });
  return {
    length, stations, widths: { FW: [...q], FR: [...q], BW: [...q], BR: [...q] },
    // (over the shoulder: the trunk's depth there, front and behind, is climbed to the seam on top)
    lengths: (() => { const S = slice(B, B.shoulder[1] - 0.05), fr = S.radius(scale(B.r, -1)), bk = S.radius(B.r); return { FW: length + fr, FR: length + fr, BW: length + bk, BR: length + bk }; })(),
    armhole: (B.shoulder[1] - 0.15) - hem, drop: 0.045, neckW: 0.075, neckFront: 0.085, neckBack: 0.025,
    shoulderW: 0.19, sleeves: { W: sleeve(B.armW), R: sleeve(B.armR) }, capEase: 0.04, moves: ['drafted from the body'],
  };
}

const interp = (xs: number[], ys: number[], x: number) => {
  if (x <= xs[0]) return ys[0];
  for (let k = 0; k < xs.length - 1; k++) if (x <= xs[k + 1]) return ys[k] + (ys[k + 1] - ys[k]) * (x - xs[k]) / (xs[k + 1] - xs[k]);
  return ys[ys.length - 1];
};

/** a piece meshed: its points' rest places on the paper and first places round the body; its grid */
export interface Piece { name: string; rows: number; cols: number; flat: [number, number][]; at: V[]; base: number; kind: 'body' | 'sleeve'; quarter?: Quarter; side?: 'W' | 'R' }
/** a stitch: point p sewn to the place between q and q2 (t of the way) */
export interface Stitch { p: number; q: number; q2: number; t: number }
export interface Garment { pieces: Piece[]; stitches: Stitch[]; n: number; flat: [number, number][]; at: V[] }

const ROWS = 32, COLS = 12, SROWS = 30, SCOLS = 18;

/** the jacket's pieces meshed from the pattern, laid round the body, and what's sewn to what */
export function meshJacket(P: JacketPattern, B: Body): Garment {
  const hem = B.pelvis[1] - 0.1, pieces: Piece[] = [], stitches: Stitch[] = [];
  let n = 0;
  const flatAll: [number, number][] = [], atAll: V[] = [];
  // ── the body's quarters ──
  for (const qn of QUARTERS) {
    const W = P.widths[qn], front = qn[0] === 'F', side = qn[1] === 'W' ? 1 : -1;
    const neckDepth = front ? P.neckFront : P.neckBack, wArm = interp(P.stations, W, P.armhole);
    const piece: Piece = { name: qn, rows: ROWS, cols: COLS, flat: [], at: [], base: n, kind: 'body', quarter: qn };
    const Lq = P.lengths?.[qn] ?? P.length;
    for (let r = 0; r < ROWS; r++) {
      // (paper height: the block's below the underarm; above it, stretched to the quarter's own length)
      const u = r / (ROWS - 1), uArm = P.armhole / P.length;
      const v = u <= uArm ? u * P.length : P.armhole + ((u - uArm) / (1 - uArm)) * (P.length - P.armhole);
      const vPaper = u <= uArm ? v : P.armhole + ((u - uArm) / (1 - uArm)) * (Lq - P.armhole);
      const xl = v > P.length - neckDepth ? P.neckW * Math.sqrt(Math.max(0, 1 - ((P.length - v) / neckDepth) ** 2)) : 0;
      const sArm = Math.max(0, (v - P.armhole) / (P.length - P.armhole));
      const xr = v <= P.armhole ? interp(P.stations, W, v) : P.shoulderW + (wArm - P.shoulderW) * (1 - sArm) ** 3;
      for (let c = 0; c < COLS; c++) {
        const x = xl + (xr - xl) * (c / (COLS - 1));
        const y = v - P.drop * (c / (COLS - 1)) * sArm * sArm;
        piece.flat.push([x, vPaper - P.drop * (c / (COLS - 1)) * sArm * sArm]);
        // (laid round the body: its angle from the centre in proportion to the quarter's width there)
        const S = slice(B, hem + y), theta = (Math.PI / 2) * Math.min(1.05, x / Math.max(0.05, interp(P.stations, W, Math.min(v, P.armhole))));
        const dir = norm(add(scale(B.r, front ? -Math.cos(theta) : Math.cos(theta)), scale(B.f, side * Math.sin(theta))));
        // (what the quarter has beyond the block's height climbs over the shoulder: its front or back reach drawn in
        // toward the seam on top, a little higher, so it starts near where it's sewn)
        const extra = Math.max(0, vPaper - v), p0 = madd(S.c, dir, S.radius(dir) + 0.03);
        const toward = dot(sub(p0, S.c), B.r), inward = Math.max(-Math.abs(toward), Math.min(Math.abs(toward), extra)) * Math.sign(toward);
        piece.at.push(madd(madd(p0, B.r, -inward), [0, 1, 0], Math.min(0.03, extra * 0.3)));
      }
    }
    pieces.push(piece); flatAll.push(...piece.flat); atAll.push(...piece.at); n += ROWS * COLS;
  }
  const P4 = Object.fromEntries(pieces.map((p) => [p.quarter, p])) as Record<Quarter, Piece>;
  const at = (p: Piece, r: number, c: number) => p.base + r * p.cols + c;
  const pair = (p: number, q: number) => stitches.push({ p, q, q2: q, t: 0 });
  const neckRow = (p: Piece, depth: number) => Math.floor(((P.length - depth) / P.length) * (ROWS - 1));
  // centre front and back (below the neck), side seams (to the underarm), shoulders (the top rows)
  for (let r = 0; r <= neckRow(P4.FW, P.neckFront); r++) pair(at(P4.FW, r, 0), at(P4.FR, r, 0));
  for (let r = 0; r <= neckRow(P4.BW, P.neckBack); r++) pair(at(P4.BW, r, 0), at(P4.BR, r, 0));
  const armRow = Math.floor((P.armhole / P.length) * (ROWS - 1));
  for (const s of ['W', 'R'] as const) {
    for (let r = 0; r <= armRow; r++) pair(at(P4[`F${s}`], r, COLS - 1), at(P4[`B${s}`], r, COLS - 1));
    for (let c = 0; c < COLS; c++) pair(at(P4[`F${s}`], ROWS - 1, c), at(P4[`B${s}`], ROWS - 1, c));
  }
  // ── the sleeves: tubes along the arms, each cap sewn round its armhole ──
  for (const s of ['W', 'R'] as const) {
    const S = P.sleeves[s], arm = s === 'W' ? B.armW : B.armR, F = P4[`F${s}`], Bk = P4[`B${s}`];
    // the armhole, from the front's underarm up over the shoulder and down the back to its underarm (ids, paper lengths)
    const loop: number[] = [];
    for (let r = armRow; r < ROWS; r++) loop.push(at(F, r, COLS - 1));
    for (let r = ROWS - 1; r >= armRow; r--) loop.push(at(Bk, r, COLS - 1));
    const L: number[] = [0]; for (let k = 1; k < loop.length; k++) { const a = flatAll[loop[k - 1]], b = flatAll[loop[k]]; L.push(L[k - 1] + Math.hypot(a[0] - b[0], a[1] - b[1])); }
    const armholeLen = L[L.length - 1];
    // the cap: as wide as the sleeve's round just below it; its height solved (bisection) so the curve across its top
    // is the armhole's length and the cap's ease, the crown opposite the underarm seam (Fab's sleeve head)
    const round = S.round.map((x, k) => (k === 0 ? S.round[1] * 1.02 : x));
    const wCap = round[0], capCurve = (hgt: number) => Array.from({ length: SCOLS }, (_, c2) => { const u = c2 / (SCOLS - 1); return [u * wCap, -hgt * Math.sin(Math.PI * u) ** 2] as [number, number]; });
    const curveLen = (pts: [number, number][]) => pts.slice(1).reduce((a, p, k) => a + Math.hypot(p[0] - pts[k][0], p[1] - pts[k][1]), 0);
    let lo = 0, hi = 0.3; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (curveLen(capCurve(m)) < armholeLen * (1 + P.capEase)) lo = m; else hi = m; }
    const capH = (lo + hi) / 2, cap = capCurve(capH), capL: number[] = [0]; for (let k = 1; k < SCOLS; k++) capL.push(capL[k - 1] + Math.hypot(cap[k][0] - cap[k - 1][0], cap[k][1] - cap[k - 1][1]));
    const segs = [len(sub(arm[1], arm[0])), len(sub(arm[2], arm[1]))], total = segs[0] + segs[1];
    const along = (t: number): [V, V] => { const d = t * total; return d < segs[0] ? [madd(arm[0], norm(sub(arm[1], arm[0])), d), norm(sub(arm[1], arm[0]))] : [madd(arm[1], norm(sub(arm[2], arm[1])), d - segs[0]), norm(sub(arm[2], arm[1]))]; };
    const piece: Piece = { name: `sleeve ${s}`, rows: SROWS, cols: SCOLS, flat: [], at: [], base: n, kind: 'sleeve', side: s };
    for (let r = 0; r < SROWS; r++) {
      const t = r / (SROWS - 1), rnd = interp(S.stations, round, t), [p, d] = along(t * Math.min(1, S.length / total));
      const down = norm(sub([0, -1, 0], scale(d, -d[1]))), side2 = cross(d, down);
      for (let c = 0; c < SCOLS; c++) {
        // (the cap's crown carried down into the first rows, fading out where the sleeve is a plain tube)
        const fade = 1 - Math.min(1, (t * S.length) / Math.max(0.04, capH * 1.6));
        piece.flat.push([(c / (SCOLS - 1)) * rnd, t * S.length + cap[c][1] * fade * fade]);
        const phi = (c / (SCOLS - 1)) * Math.PI * 2, rad = Math.min(0.09, rnd / (Math.PI * 2) + 0.01);
        piece.at.push(madd(madd(p, down, Math.cos(phi) * rad), side2, Math.sin(phi) * rad));
      }
    }
    pieces.push(piece); flatAll.push(...piece.flat); atAll.push(...piece.at);
    // the underarm seam; the cap round the armhole by length, turned so the sleeve doesn't twist
    for (let r = 0; r < SROWS; r++) pair(n + r * SCOLS + SCOLS - 1, n + r * SCOLS);
    const quarterway = atAll[n + Math.round(SCOLS / 4)], nearFront = len(sub(quarterway, atAll[loop[Math.floor(loop.length / 4)]])) < len(sub(quarterway, atAll[loop[Math.floor((3 * loop.length) / 4)]]));
    for (let c = 0; c < SCOLS - 1; c++) {
      // (by length along the cap's curve: each cap point to its share of the armhole)
      const share = capL[c] / capL[SCOLS - 1], want = (nearFront ? share : 1 - share) * armholeLen;
      let k = 0; while (k < L.length - 2 && L[k + 1] < want) k++;
      stitches.push({ p: n + c, q: loop[k], q2: loop[k + 1], t: (want - L[k]) / Math.max(1e-9, L[k + 1] - L[k]) });
    }
    n += SROWS * SCOLS;
  }
  return { pieces, stitches, n, flat: flatAll, at: atAll };
}

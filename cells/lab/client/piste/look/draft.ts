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
import { type V, add, cross, dot, len, lerp, madd, norm, scale, sub } from '../v3';

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
  /** (bend: how much longer the sleeve's outside is than its inside, through the elbow: a sleeve cut bent, as the weapon arm's is in guard) */
  sleeves: Record<'W' | 'R', { stations: number[]; round: number[]; length: number; bend?: number }>;
  capEase: number;
  /** what's been done to it, in order */
  moves: string[];
}

/** the body as the draft sees it: in the fencer's frame (forward f, up, right r; the chest faces −r) */
export interface Body { caps: Capsule[]; trunk: Capsule[];
  /** what the jacket's body goes round (the trunk and the tops of the thighs), and what its sleeves do (the arms too) */
  bodyCaps: Capsule[]; sleeveCaps: Capsule[]; pelvis: V; f: V; r: V; up: V; shoulder: V; rearShoulder: V; armW: V[]; armR: V[];
  /** the undressed body (look/body.ts), if it's given: how far outside its trunk and thighs a point is (what the jacket's
   * body is measured round, in place of `bodyCaps`), and outside any of it (in place of `sleeveCaps`) */
  dist?: (p: V) => number; distAll?: (p: V) => number }

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
    const out = (q: V) => B.dist ? B.dist(q) : clearance(q, B.bodyCaps);
    for (let m = 0.5; m > 0; m -= 0.005) if (out(madd(c, dir, m)) < 0) { lo = m; hi = m + 0.005; break; }
    if (hi === 0.5) return 0.05;
    for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (out(madd(c, dir, m)) < 0) lo = m; else hi = m; }
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
  const P: JacketPattern = {
    length, stations, widths: { FW: [...q], FR: [...q], BW: [...q], BR: [...q] },
    // (over the shoulder: the trunk's depth there, front and behind, is climbed to the seam on top)
    lengths: (() => { const S = slice(B, B.shoulder[1] - 0.05), fr = S.radius(scale(B.r, -1)), bk = S.radius(B.r); return { FW: length + fr, FR: length + fr, BW: length + bk, BR: length + bk }; })(),
    armhole: (B.shoulder[1] - 0.15) - hem, drop: 0.045, neckW: 0.075, neckFront: 0.085, neckBack: 0.025,
    shoulderW: 0.19,
    // (the weapon sleeve cut bent, as a fencing jacket's is, for the arm in guard: a straight tube round a bent arm has
    // the inside of the elbow's length to lose and folds over itself there. Its outside 16 cm longer than its inside, its
    // middle half a centimetre short of the arm: the bend takes up the 2 cm a straight sleeve is given to move in)
    sleeves: { W: { ...sleeve(B.armW), length: armLen(B.armW) - 0.005, bend: 0.16 }, R: sleeve(B.armR) }, capEase: 0.04, moves: ['drafted from the body'],
  };
  // (the armhole as deep as gives it its length round: a jacket's is about half the chest and 2 cm, for a sleeve set in
  // round a shoulder and an arm that has to reach (the chest measured round, a little below the armpits))
  const chest = Math.max(...[0.3, 0.34, 0.38].map((h) => slice(B, B.pelvis[1] + h).girth)), want = chest / 2 + 0.02;
  let lo = P.armhole - 0.15, hi = P.armhole;
  for (let k = 0; k < 14; k++) { P.armhole = (lo + hi) / 2; const g = meshJacket(P, B), got = (g.armholes.W + g.armholes.R) / 2; if (got < want) hi = P.armhole; else lo = P.armhole; }
  P.armhole = (lo + hi) / 2;
  P.moves.push(`armhole ${(want * 100).toFixed(0)} cm round (chest ${(chest * 100).toFixed(0)} cm)`);
  return P;
}

const interp = (xs: number[], ys: number[], x: number) => {
  if (x <= xs[0]) return ys[0];
  for (let k = 0; k < xs.length - 1; k++) if (x <= xs[k + 1]) return ys[k] + (ys[k + 1] - ys[k]) * (x - xs[k]) / (xs[k + 1] - xs[k]);
  return ys[ys.length - 1];
};

/** a piece meshed: its points' rest places on the paper and first places round the body; its grid */
export interface Piece { name: string; rows: number; cols: number; flat: [number, number][]; at: V[]; base: number; kind: 'body' | 'sleeve' | 'gusset'; quarter?: Quarter; side?: 'W' | 'R' }
/** a stitch: point p sewn to the place between q and q2 (t of the way) */
export interface Stitch { p: number; q: number; q2: number; t: number; /** which seam it's part of */ seam?: string }
/** a point held at a place (a cuff under the glove's gauntlet) */
export interface Pin { p: number; at: V }
/** a point kept no further than a length from a place (the crotch strap: the hem in front and behind, held to where the
 * strap passes under the crotch) */
export interface Tie { p: number; at: V; len: number }
export interface Garment { pieces: Piece[]; stitches: Stitch[]; pins: Pin[]; ties: Tie[]; n: number; flat: [number, number][]; at: V[]; /** each armhole's length round, on the paper */ armholes: Record<'W' | 'R', number> }

const ROWS = 32, COLS = 12, SROWS = 30, SCOLS = 18;
/** the body's grid row the underarm always falls on: the rows below and above it are spaced to the pattern's heights, so
 * an alteration (a deeper armhole) moves points a little, never a seam's row across at a stroke */
export const ARM_ROW = 19;
/** the underarm gusset's depth, in rows of the body and of the sleeve: about 8 cm each way */
export const GUSSET = 4;
/** the body grid's row (fractional) at a height above the hem */
export const rowAt = (P: JacketPattern, h: number) => (h <= P.armhole ? (h / P.armhole) * ARM_ROW : ARM_ROW + ((h - P.armhole) / (P.length - P.armhole)) * (ROWS - 1 - ARM_ROW));

/** the jacket's pieces meshed from the pattern, laid round the body, and what's sewn to what */
export function meshJacket(P: JacketPattern, B: Body): Garment {
  const hem = B.pelvis[1] - 0.1, pieces: Piece[] = [], stitches: Stitch[] = [], pins: Pin[] = [];
  const armholes = { W: 0, R: 0 };
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
      const above = (r - ARM_ROW) / (ROWS - 1 - ARM_ROW);
      const v = r <= ARM_ROW ? (r / ARM_ROW) * P.armhole : P.armhole + above * (P.length - P.armhole);
      const vPaper = r <= ARM_ROW ? v : P.armhole + above * (Lq - P.armhole);
      const xl = v > P.length - neckDepth ? P.neckW * Math.sqrt(Math.max(0, 1 - ((P.length - v) / neckDepth) ** 2)) : 0;
      const sArm = Math.max(0, (v - P.armhole) / (P.length - P.armhole));
      const xr = v <= P.armhole ? interp(P.stations, W, v) : P.shoulderW + (wArm - P.shoulderW) * (1 - sArm) ** 3;
      for (let c = 0; c < COLS; c++) {
        const x = xl + (xr - xl) * (c / (COLS - 1));
        const y = v - P.drop * (c / (COLS - 1)) * sArm * sArm;
        // (the climb over the shoulder is deep at the neck, where the chest is, and shallow at the shoulder point: the extra
        // length tapers across the panel, so it doesn't make the armhole deeper)
        // (both sides of a shoulder seam slope alike, so its two edges are the same length: the one that climbs further keeps
        // more of its climb out to the point)
        const Lf = P.lengths?.[`F${qn[1]}` as Quarter] ?? P.length, Lb = P.lengths?.[`B${qn[1]}` as Quarter] ?? P.length;
        const slope = 0.8 * Math.min(Lf - P.length, Lb - P.length) / Math.max(1e-6, Lq - P.length);
        const climb = 1 - Math.min(0.8, slope) * (c / (COLS - 1)), vCol = v + (vPaper - v) * climb;
        piece.flat.push([x, vCol - P.drop * (c / (COLS - 1)) * sArm * sArm]);
        // (laid round the body: its angle from the centre in proportion to the quarter's width there)
        // (laid at its height on the paper, up to the top of the body; what's beyond that climbs over the shoulder)
        const yLay = Math.min(vPaper, P.length) - P.drop * (c / (COLS - 1)) * sArm * sArm;
        const S = slice(B, hem + yLay), theta = (Math.PI / 2) * Math.min(1.05, x / Math.max(0.05, interp(P.stations, W, Math.min(v, P.armhole))));
        const dir = norm(add(scale(B.r, front ? -Math.cos(theta) : Math.cos(theta)), scale(B.f, side * Math.sin(theta))));
        // (what the quarter has beyond the block's height climbs over the shoulder: its front or back reach drawn in
        // toward the seam on top, a little higher, so it starts near where it's sewn)
        const extra = Math.max(0, vPaper - P.length), p0 = madd(S.c, dir, S.radius(dir) + 0.03);
        const toward = dot(sub(p0, S.c), B.r), inward = Math.max(-Math.abs(toward), Math.min(Math.abs(toward), extra)) * Math.sign(toward);
        piece.at.push(madd(madd(p0, B.r, -inward), [0, 1, 0], Math.min(0.03, extra * 0.3)));
      }
    }
    pieces.push(piece); flatAll.push(...piece.flat); atAll.push(...piece.at); n += ROWS * COLS;
  }
  const P4 = Object.fromEntries(pieces.map((p) => [p.quarter, p])) as Record<Quarter, Piece>;
  const at = (p: Piece, r: number, c: number) => p.base + r * p.cols + c;
  const pair = (p: number, q: number, seam: string) => stitches.push({ p, q, q2: q, t: 0, seam });
  const neckRow = (_p: Piece, depth: number) => Math.floor(rowAt(P, P.length - depth));
  // centre front and back (below the neck), side seams (to the underarm), shoulders (the top rows)
  for (let r = 0; r <= neckRow(P4.FW, P.neckFront); r++) pair(at(P4.FW, r, 0), at(P4.FR, r, 0), 'centre front');
  for (let r = 0; r <= neckRow(P4.BW, P.neckBack); r++) pair(at(P4.BW, r, 0), at(P4.BR, r, 0), 'centre back');
  const armRow = ARM_ROW;
  for (const s of ['W', 'R'] as const) {
    // (the side seam stops short of the underarm by the gusset's depth: the gusset's let in above it)
    for (let r = 0; r <= armRow - GUSSET; r++) pair(at(P4[`F${s}`], r, COLS - 1), at(P4[`B${s}`], r, COLS - 1), `side seam ${s}`);
    for (let c = 0; c < COLS; c++) pair(at(P4[`F${s}`], ROWS - 1, c), at(P4[`B${s}`], ROWS - 1, c), `shoulder ${s}`);
  }
  // ── the sleeves: tubes along the arms, each cap sewn round its armhole ──
  for (const s of ['W', 'R'] as const) {
    const S = P.sleeves[s], arm = s === 'W' ? B.armW : B.armR, F = P4[`F${s}`], Bk = P4[`B${s}`];
    // the armhole, from the front's underarm up over the shoulder and down the back to its underarm (ids, paper lengths)
    const loop: number[] = [];
    for (let r = armRow; r < ROWS; r++) loop.push(at(F, r, COLS - 1));
    for (let r = ROWS - 1; r >= armRow; r--) loop.push(at(Bk, r, COLS - 1));
    // (measured on each piece's own paper: across the shoulder point, from the front's piece to the back's, no length:
    // the two are sewn together there)
    const sheet = (i: number) => (i >= Bk.base && i < Bk.base + ROWS * COLS ? 1 : 0);
    const L: number[] = [0]; for (let k = 1; k < loop.length; k++) { const a = flatAll[loop[k - 1]], b = flatAll[loop[k]]; L.push(L[k - 1] + (sheet(loop[k - 1]) === sheet(loop[k]) ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0)); }
    const armholeLen = L[L.length - 1]; armholes[s] = armholeLen;
    // the cap: as wide as the sleeve's round just below it; its height solved (bisection) so the curve across its top
    // is the armhole's length and the cap's ease, the crown opposite the underarm seam (Fab's sleeve head)
    const round = S.round.map((x, k) => (k === 0 ? S.round[1] * 1.02 : x));
    // (drafted to its own armhole: its front half to the armhole's front edge and its back half to the back's, each with
    // the ease; the height and where the crown falls across the sleeve solved together. The front's edge is the longer,
    // so the crown sits back of the middle, as a sleeve head's does)
    const wCap = round[0], frontArm = L[ROWS - armRow - 1], backArm = armholeLen - frontArm;
    const half = (w: number, h: number, n2 = 60) => { let a = 0; for (let k = 1; k <= n2; k++) { const u0 = (k - 1) / n2, u1 = k / n2; a += Math.hypot(w / n2, h * (Math.sin((Math.PI / 2) * u1) ** 2 - Math.sin((Math.PI / 2) * u0) ** 2)); } return a; };
    let wf = wCap / 2, capH = 0.1;
    for (let it = 0; it < 40; it++) {
      // (for this height, the front half's width that gives it its length; then the height that gives the back its)
      let lo = 0.02 * wCap, hi = 0.98 * wCap; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (half(m, capH) < frontArm * (1 + P.capEase)) lo = m; else hi = m; } wf = (lo + hi) / 2;
      let hl = 0, hh = 0.3; for (let k = 0; k < 30; k++) { const m = (hl + hh) / 2; if (half(wCap - wf, m) < backArm * (1 + P.capEase)) hl = m; else hh = m; } capH = (hl + hh) / 2;
    }
    // (the cap row's points: up from the front's underarm to the crown at wf, down to the back's underarm)
    const capY = (x: number) => (x <= wf ? -capH * Math.sin((Math.PI / 2) * (x / wf)) ** 2 : -capH * Math.sin((Math.PI / 2) * ((wCap - x) / (wCap - wf))) ** 2);
    const cap = Array.from({ length: SCOLS }, (_, c2) => { const x = (c2 / (SCOLS - 1)) * wCap; return [x, capY(x)] as [number, number]; });
    const capL: number[] = [0]; for (let k = 1; k < SCOLS; k++) capL.push(capL[k - 1] + Math.hypot(cap[k][0] - cap[k - 1][0], cap[k][1] - cap[k - 1][1]));
    // (the arc length at the crown, between the columns either side of it)
    const kc = Math.min(SCOLS - 2, Math.floor((wf / wCap) * (SCOLS - 1))), crownL = capL[kc] + Math.hypot(wf - cap[kc][0], -capH - cap[kc][1]);
    // (laid along a smooth curve through the elbow, not the arm's kink: rings on a kinked line cross on the inside of the
    // bend and lay the cloth there inside out)
    const segs = [len(sub(arm[1], arm[0])), len(sub(arm[2], arm[1]))], total = segs[0] + segs[1];
    const upper = norm(sub(arm[1], arm[0])), lower = norm(sub(arm[2], arm[1]));
    const radius = Math.min(0.09, segs[0] / 3, segs[1] / 3);
    const entry = madd(arm[1], upper, -radius), exit = madd(arm[1], lower, radius);
    const along = (t: number): [V, V] => {
      const d = t * total - segs[0];
      if (d <= -radius) return [madd(arm[1], upper, d), upper];
      if (d >= radius) return [madd(arm[1], lower, d), lower];
      const u = (d + radius) / (2 * radius);
      return [lerp(lerp(entry, arm[1], u), lerp(arm[1], exit, u), u), norm(lerp(upper, lower, u))];
    };
    // (the underarm direction carried round the bend without twisting: measured afresh at each ring, toward the trunk,
    // it flips over past the elbow of a raised arm while its side doesn't, which lays the forearm inside out)
    const inward = sub([B.pelvis[0], arm[0][1], B.pelvis[2]], arm[0]);
    const under = norm(sub(inward, scale(upper, dot(inward, upper))));
    const winding = dot(cross(upper, under), B.r) < 0 ? 1 : -1;
    const piece: Piece = { name: `sleeve ${s}`, rows: SROWS, cols: SCOLS, flat: [], at: [], base: n, kind: 'sleeve', side: s };
    for (let r = 0; r < SROWS; r++) {
      const t = r / (SROWS - 1), rnd = interp(S.stations, round, t), [p, d] = along(t * Math.min(1, S.length / total));
      // (laid with its underarm seam (column 0) toward the armpit and its first quarter facing the jacket's front, which
      // is the way it's sewn: the notches, not a guess from where it lies)
      const turn = cross(upper, d);
      const down = norm(add(add(under, cross(turn, under)), scale(cross(turn, cross(turn, under)), 1 / Math.max(1e-6, 1 + dot(upper, d)))));
      const side2 = scale(cross(d, down), winding);
      for (let c = 0; c < SCOLS; c++) {
        // (the cap's crown carried down into the first rows, fading out where the sleeve is a plain tube)
        const fade = 1 - Math.min(1, (t * S.length) / Math.max(0.04, capH * 1.6));
        // (the bend: length added along the outside (the crown's side, away from the underarm seam) and as much taken
        // off the inside, over the 20 cm round the elbow: not above it, where the inside is the armpit's)
        const outside = Math.sin((Math.PI * c) / (SCOLS - 1)) ** 2 - 0.5, bendY = (S.bend ?? 0) * outside * Math.max(0, Math.min(1, (t * S.length - (segs[0] - 0.1)) / 0.2));
        // (symmetric about its centre line, so the underarm seam's two edges are the same length)
        // (one paper for both: each is laid with its underarm seam toward the body and its first quarter to the front, and
        // the body's on opposite sides of the two arms, so the pair comes out mirror images, as a pair is cut)
        piece.flat.push([(c / (SCOLS - 1) - 0.5) * rnd, t * S.length + bendY + cap[c][1] * fade * fade]);
        const phi = (c / (SCOLS - 1)) * Math.PI * 2, rad = r === SROWS - 1 ? 0.045 : Math.min(0.09, rnd / (Math.PI * 2) + 0.01);
        piece.at.push(madd(madd(p, down, Math.cos(phi) * rad), side2, Math.sin(phi) * rad));
      }
    }
    pieces.push(piece); flatAll.push(...piece.flat); atAll.push(...piece.at);
    // the cuff, held round the wrist under the glove's gauntlet (where the sleeve's been laid: its last ring)
    for (let c = 0; c < SCOLS - 1; c++) pins.push({ p: n + (SROWS - 1) * SCOLS + c, at: piece.at[(SROWS - 1) * SCOLS + c] });
    // the underarm seam; the cap round the armhole by length, turned so the sleeve doesn't twist
    for (let r = GUSSET; r < SROWS; r++) pair(n + r * SCOLS + SCOLS - 1, n + r * SCOLS, `underarm ${s}`);
    // (the cap's first half to the armhole's front edge: the loop starts at the front's underarm)
    const nearFront = true;
    for (let c = 0; c < SCOLS - 1; c++) {
      // (the crown's notch to the shoulder seam, and each half of the cap eased into its own half of the armhole: the
      // front's edge is longer than the back's (it climbs over the chest), so sewing round the whole by length would
      // put the crown off the shoulder seam and drag both)
      // (the front half, to its crown, over the front's edge; the back half over the back's)
      const cl = capL[c], want = cl <= crownL ? (cl / crownL) * frontArm : frontArm + ((cl - crownL) / (capL[SCOLS - 1] - crownL)) * backArm;
      void nearFront;
      let k = 0; while (k < L.length - 2 && L[k + 1] < want) k++;
      stitches.push({ p: n + c, q: loop[k], q2: loop[k + 1], t: (want - L[k]) / Math.max(1e-9, L[k + 1] - L[k]), seam: `sleeve cap ${s}` });
    }
    n += SROWS * SCOLS;
    // the gusset: a diamond let in under the arm, where the side seam and the sleeve's underarm seam meet, each of them
    // unpicked for its last few rows. Its four edges: the front's side edge, the back's, the sleeve's back underarm edge
    // and its front one, each cut to the length of the edge it's sewn to. Raised, an arm draws it open, instead of
    // stretching the cloth round the armhole across the gap between the ribs and the arm
    {
      const sb = n - SROWS * SCOLS, K = GUSSET, Gn = K + 1, last = COLS - 1;
      const eA = Array.from({ length: Gn }, (_, j) => at(F, armRow - j, last));            // front: underarm down
      const eB = Array.from({ length: Gn }, (_, j) => at(Bk, armRow - K + j, last));       // back: up to its underarm
      const eD = Array.from({ length: Gn }, (_, j) => sb + j * SCOLS);                     // sleeve front: underarm down
      const eC = Array.from({ length: Gn }, (_, j) => sb + (K - j) * SCOLS + SCOLS - 1);   // sleeve back: up to the underarm
      const L = (ids: number[]) => ids.slice(1).reduce((a, id, k) => a + Math.hypot(flatAll[id][0] - flatAll[ids[k]][0], flatAll[id][1] - flatAll[ids[k]][1]), 0);
      const LA = L(eA), LB = L(eB), LC = L(eC), LD = L(eD);
      // (on its own paper: one corner square, the fourth where its last two edges' lengths meet)
      const cAD: [number, number] = [0, 0], cAB: [number, number] = [LA, 0], cCD: [number, number] = [0, LD];
      const dx = cCD[0] - cAB[0], dy = cCD[1] - cAB[1], dd = Math.hypot(dx, dy), a2 = (LB * LB - LC * LC + dd * dd) / (2 * dd), h2 = Math.sqrt(Math.max(0, LB * LB - a2 * a2));
      const cBC: [number, number] = [cAB[0] + (a2 * dx) / dd + (h2 * dy) / dd, cAB[1] + (a2 * dy) / dd - (h2 * dx) / dd];
      const far = (cBC[0] + cBC[1]) > (cAB[0] + (a2 * dx) / dd - (h2 * dy) / dd + cAB[1] + (a2 * dy) / dd + (h2 * dx) / dd) ? cBC : [cAB[0] + (a2 * dx) / dd - (h2 * dy) / dd, cAB[1] + (a2 * dy) / dd + (h2 * dx) / dd] as [number, number];
      const piece: Piece = { name: `gusset ${s}`, rows: Gn, cols: Gn, flat: [], at: [], base: n, kind: 'gusset', side: s };
      const mix2 = (a: number[], b: number[], t: number) => a.map((v, k) => v + (b[k] - v) * t);
      for (let r = 0; r < Gn; r++) for (let c = 0; c < Gn; c++) {
        const u = c / K, v = r / K;
        // (the weapon side's cut mirror-wise, as the two sides of a jacket are)
        const fp = mix2(mix2(cAD, cAB, u), mix2(cCD, far, u), v);
        piece.flat.push([s === 'W' ? -fp[0] : fp[0], fp[1]]);
        piece.at.push(mix2(mix2(atAll[eA[0]], atAll[eA[K]], u), mix2(atAll[eC[0]], atAll[eC[K]], u), v) as V);
      }
      pieces.push(piece); flatAll.push(...piece.flat); atAll.push(...piece.at);
      const g = (r: number, c: number) => n + r * Gn + c;
      for (let j = 0; j < Gn; j++) {
        pair(g(0, j), eA[j], `gusset ${s}: front`);
        pair(g(j, K), eB[j], `gusset ${s}: back`);
        pair(g(K, j), eC[j], `gusset ${s}: sleeve back`);
        pair(g(j, 0), eD[j], `gusset ${s}: sleeve front`);
      }
      n += Gn * Gn;
    }
  }
  // the crotch strap: the centre front's hem to the centre back's, under the crotch (a little below the hem between the
  // legs), no longer than that
  const ties: Tie[] = [];
  {
    // (the strap's width: the centre's hem points and two either side, front and back)
    const under: V = [B.pelvis[0], hem - 0.05, B.pelvis[2]];
    for (const qn of QUARTERS) for (let cc = 0; cc < 3; cc++) { const p = P4[qn].base + cc; ties.push({ p, at: under, len: len(sub(atAll[p], under)) + 0.01 * cc }); }
  }
  return { pieces, stitches, pins, ties, n, flat: flatAll, at: atAll, armholes };
}

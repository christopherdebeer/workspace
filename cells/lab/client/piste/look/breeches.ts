/**
 * The breeches as a tailor cuts them: drafted flat from the undressed body (body.ts), sewn, let settle on it (settle.ts),
 * for the game to dress the fencers in (devtools/piste-breeches.mjs), as the jacket is (draft.ts).
 *
 * Four panels, a front and a back for each leg, each a grid from the waistband (row 0) down to the band below the knee:
 * - its outside edge (the last column) sewn to its other half's: the outside seam, waist to band;
 * - its inside edge (column 0) sewn to its other half's below the crotch (the inside leg seam), and above it to the
 *   other leg's same panel: the centre front, and the centre back. The four meet at the crotch;
 * - each panel as wide as its share of the body there and an ease: a quarter of the hips above the crotch, half the
 *   thigh below it (the back's share the bigger: a fencer's seat is cut full, to lunge in); at the crotch, the quarter of
 *   the hips and the fork's extension (the back's twice the front's), so the panel reaches under the body to the seam;
 * - the centre back longer than the side (the seat's rise), the centre front a little shorter, tapered across the panel.
 * The waistband and the knee band are held where they're laid; the cloth between hangs from them.
 *
 * Laid round the body in guard: above the crotch round the hips, below it round each thigh, turning with the thigh (in
 * guard the front knee points along the piste while the belly faces across it, so the front panel turns a quarter round
 * from the crotch to the knee, as the breeches do).
 */
import type { Fencer } from '../fencer';
import { type V, add, cross, dot, len, lerp, madd, norm, scale, sub } from '../v3';
import { type Body as Bare, nearSurface } from './body';
import type { Garment, Piece, Stitch, Pin } from './draft';

export interface BreechesPattern {
  /** waist to crotch, straight down the side (m); the centre front's and centre back's rise, round the body (m) */
  side: number; riseFront: number; riseBack: number;
  /** the crotch down the inside of the leg to the band (m) */
  inseam: number;
  /** girths at the waist, the hips, the thigh under the crotch, above the knee, at the band (m), the body's, and the ease
   * added to each */
  girth: { waist: number; hips: number; thigh: number; knee: number; band: number };
  ease: { waist: number; hips: number; thigh: number; knee: number; band: number };
  /** the back's share of the round below the crotch (the seat cut full), and the fork's extension front and back (m) */
  backShare: number; forkFront: number; forkBack: number;
  /** how much longer the front is than the inside and outside, down its middle over the knee (m) */
  kneeBend: number;
  /** each panel's own share of the waist's and the hips' round (the body turned in guard: its quarters aren't equal), m */
  quarters: Record<string, { waist: number; hips: number }>;
  moves: string[];
}

export const BROWS = 30, BCOLS = 12;
/** the crotch's row: the rise above it, the leg below */
export const CROTCH_ROW = 10;

/** where the legs are, in the fencer's pose: hip joint, knee, ankle, the knee's way, the band, the crotch */
function legsOf(f: Fencer) {
  const c = f.capsules, F = f.frame;
  return (['F', 'B'] as const).map((side) => {
    const [th, sn] = side === 'F' ? [9, 10] : [11, 12];
    const hip = c[th].a, knee = c[th].b, ankle = c[sn].b;
    const shin = norm(sub(ankle, knee)), band = madd(knee, shin, 0.07);
    const thigh = norm(sub(knee, hip)), crotch = madd(hip, thigh, 0.085);
    // (the knee's way: the front leg's along the piste, the back leg's out and back, as fencer.ts poses them)
    const pole = side === 'F' ? norm(add(F.f, [0, 0.2, 0])) : norm(add(add(scale(F.f, -0.3), scale(F.r, -0.8)), [0, 0.2, 0]));
    return { side, hip, knee, ankle, band, crotch, pole, thighDir: thigh, shinDir: shin };
  });
}

/** a limb's girth round its axis at a point, on the body's surface (rays out from the axis to where they leave it) */
function girthAt(body: Bare, at: V, axis: V): number {
  const [u, w] = (() => { const h = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] as V : [1, 0, 0] as V, u0 = norm(sub(h, scale(axis, dot(h, axis)))); return [u0, cross(axis, u0)]; })();
  const N = 48, pts: V[] = [];
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2, dir = add(scale(u, Math.cos(a)), scale(w, Math.sin(a)));
    let lo = 0, hi = 0.2;
    for (let it = 0; it < 22; it++) { const m = (lo + hi) / 2; if (nearSurface(body, madd(at, dir, m)).d < 0) lo = m; else hi = m; }
    pts.push(madd(at, dir, lo));
  }
  return pts.reduce((s, p, k) => s + len(sub(p, pts[(k + 1) % N])), 0);
}

/** the round of the hips (and the tops of both thighs, at the crotch) at a height, round the pelvis's vertical */
function roundAt(body: Bare, centre: V, y: number): { girth: number; radius: (dir: V) => number } {
  const c: V = [centre[0], y, centre[2]];
  const radius = (dir: V) => { let lo = 0, hi = 0.45; for (let m = hi; m > 0; m -= 0.005) if (nearSurface(body, madd(c, dir, m)).d < 0) { lo = m; hi = m + 0.005; break; } for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (nearSurface(body, madd(c, dir, m)).d < 0) lo = m; else hi = m; } return lo; };
  const N = 48, pts: V[] = [];
  for (let k = 0; k < N; k++) { const a = (k / N) * Math.PI * 2, dir: V = [Math.cos(a), 0, Math.sin(a)]; pts.push(madd(c, dir, radius(dir))); }
  return { girth: pts.reduce((s, p, k) => s + len(sub(p, pts[(k + 1) % N])), 0), radius };
}

/** the first draft, from the body's measurements and the ease a fencer's breeches have */
export function draftBreeches(f: Fencer, body: Bare): BreechesPattern {
  const legs = legsOf(f), pelvis = f.capsules[0].a, lower: Bare = { parts: body.parts.filter((p) => p.name === 'trunk' || p.name.startsWith('thigh') || p.name.startsWith('shin')) };
  const thighs: Bare = { parts: body.parts.filter((p) => p.name.startsWith('thigh')) }, shins: Bare = { parts: body.parts.filter((p) => p.name.startsWith('shin')) };
  const avg = (fn: (l: (typeof legs)[number]) => number) => (fn(legs[0]) + fn(legs[1])) / 2;
  const girth = {
    waist: roundAt(lower, pelvis, pelvis[1] + 0.08).girth, hips: roundAt(lower, pelvis, pelvis[1] - 0.02).girth,
    thigh: avg((l) => girthAt(thighs, madd(l.crotch, l.thighDir, 0.02), l.thighDir)),
    knee: avg((l) => girthAt(thighs, madd(l.knee, l.thighDir, -0.06), l.thighDir)),
    band: avg((l) => girthAt(shins, l.band, l.shinDir)),
  };
  const side = 0.08 + 0.085;   // (waist 8 cm above the hip joints, the crotch 8.5 cm down the thigh)
  return {
    side, riseFront: side + 0.06, riseBack: side + 0.13,
    inseam: avg((l) => len(sub(l.knee, l.crotch)) + 0.07),
    girth, ease: { waist: 0.03, hips: 0.1, thigh: 0.1, knee: 0.06, band: 0.02 },
    kneeBend: 0.1, backShare: 0.56, forkFront: girth.hips / 24, forkBack: girth.hips / 12,
    quarters: Object.fromEntries((['F', 'B'] as const).flatMap((lg) => (['front', 'back'] as const).map((half) => [`${lg} ${half}`, { waist: quarterArc(lower, f, lg, half, pelvis[1] + 0.08), hips: quarterArc(lower, f, lg, half, pelvis[1] - 0.02) }]))),
    moves: ['drafted from the body'],
  };
}

/** one panel's quarter of the round at a height: from the centre (front or back) round to the side (the leg's way) */
function quarterArc(body: Bare, f: Fencer, leg: 'F' | 'B', half: 'front' | 'back', y: number): number {
  const F = f.frame, pelvis = f.capsules[0].a, { radius } = roundAt(body, pelvis, y);
  const centreDir = half === 'back' ? F.r : scale(F.r, -1), outward = leg === 'F' ? F.f : scale(F.f, -1);
  const N = 16, pts: V[] = [];
  for (let k = 0; k <= N; k++) { const a = (k / N) * Math.PI / 2, dir = norm(add(scale(centreDir, Math.cos(a)), scale(outward, Math.sin(a)))); pts.push(madd([pelvis[0], y, pelvis[2]], dir, radius(dir))); }
  return pts.slice(1).reduce((s2, p, k) => s2 + len(sub(p, pts[k])), 0);
}

const smoothstep = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

/** the breeches' panels meshed from the pattern, laid round the body, and what's sewn to what */
export function meshBreeches(P: BreechesPattern, f: Fencer, body: Bare, base = 0): Garment {
  const legs = legsOf(f), F = f.frame, pelvis = f.capsules[0].a;
  const lower: Bare = { parts: body.parts.filter((p) => p.name === 'trunk' || p.name.startsWith('thigh')) };
  const pieces: Piece[] = [], stitches: Stitch[] = [], pins: Pin[] = [], flatAll: [number, number][] = [], atAll: V[] = [];
  let n = base;
  const G = (k: keyof BreechesPattern['girth']) => P.girth[k] + P.ease[k];
  const legLen = P.inseam, legRows = BROWS - 1 - CROTCH_ROW;
  for (const lg of legs) for (const half of ['front', 'back'] as const) {
    const back = half === 'back', share = back ? P.backShare : 1 - P.backShare;
    const piece: Piece = { name: `breeches ${lg.side} ${half}`, rows: BROWS, cols: BCOLS, flat: [], at: [], base: n, kind: 'breeches', side: lg.side === 'F' ? 'W' : 'R' };
    const rise = back ? P.riseBack : P.riseFront;
    // (its own side of the body: the front leg's panels on the side toward the piste ahead, the back leg's behind)
    const outward = lg.side === 'F' ? F.f : scale(F.f, -1), centreDir = back ? F.r : scale(F.r, -1);
    for (let r = 0; r < BROWS; r++) {
      const above = r <= CROTCH_ROW, u = above ? r / CROTCH_ROW : (r - CROTCH_ROW) / legRows;
      // (the panel's width at this row: a quarter of the hips' round above, the fork's reach at the crotch, its share of
      // the leg below, to the knee and the band)
      const fork = back ? P.forkBack : P.forkFront;
      // (from its own quarter of the waist, growing by as much as its other leg's same panel does, so the centre seams'
      // two edges are alike: the growth the two legs' average)
      const qOf = (l: string) => P.quarters[`${l} ${half}`], qW = qOf(lg.side).waist + P.ease.waist / 4;
      const grow = (qOf('F').hips + qOf('B').hips - qOf('F').waist - qOf('B').waist) / 2 + (P.ease.hips - P.ease.waist) / 4;
      const width = above ? qW + (grow + fork * smoothstep((u - 0.55) / 0.45)) * smoothstep(u * 1.6)
        : (() => {
          // (the leg's round: from the fork's tip (both panels' reach at the crotch) down to the knee and the band; the back
          // wider than the front by the forks' difference all the way down, so the inside leg's two edges are alike)
          const wC = (['front', 'back'] as const).reduce((s2, h) => s2 + P.quarters[`${lg.side} ${h}`].waist + P.ease.waist / 4 + (P.quarters[`F ${h}`].hips + P.quarters[`B ${h}`].hips - P.quarters[`F ${h}`].waist - P.quarters[`B ${h}`].waist) / 2 + (P.ease.hips - P.ease.waist) / 4, 0) + P.forkFront + P.forkBack, kneeU = (legLen - 0.07) / legLen;
          const W = u < kneeU ? wC + (G('knee') - wC) * smoothstep(u / kneeU) : G('knee') + (G('band') - G('knee')) * smoothstep((u - kneeU) / (1 - kneeU));
          return W / 2 + (back ? 0.5 : -0.5) * (P.forkBack - P.forkFront); })();
      for (let c = 0; c < BCOLS; c++) {
        const cf = c / (BCOLS - 1);
        // (the paper: x in from the outside edge, which runs straight, as a side seam does; the inside edge carries the
        // shape: the crotch's curve and the inside leg. y down from the waist; above the crotch the centre's rise longer
        // than the side's, tapered across the panel)
        const yRise = rise + (P.side - rise) * cf;
        // (over the knee: the front longer down its middle, the back a little shorter behind it, as a knee bent in guard
        // needs; nothing at the seams, so they stay the same length)
        // (the extra length over the kneecap only, taken back in below it: the hem straight into the band)
        const kneeU = (legLen - 0.07) / legLen, bendK = above ? 0 : smoothstep((u - (kneeU - 0.2)) / 0.16) * (1 - smoothstep((u - (kneeU + 0.01)) / (1 - kneeU - 0.01))) * Math.sin(Math.PI * cf) ** 2;
        // (the crotch's line level across the panel: the centre's longer rise is its waist raised above the side's, not the
        // crotch lowered: lowered, every row below it down to the band hung that much longer at the inside, and the band,
        // fastened level round the leg, had a flap behind the knee)
        const crotchY = Math.max(P.riseFront, P.riseBack);
        const y = above ? crotchY - (1 - u) * yRise : crotchY + u * legLen + bendK * P.kneeBend * (back ? -0.4 : 1);
        piece.flat.push([-(1 - cf) * width, y]);
        // laid: above the crotch round the hips, from the centre to the side; below round the thigh, from its inside
        // round its front (or back) to its outside
        let p: V;
        if (above) {
          const yH = pelvis[1] + 0.08 - u * (0.08 + 0.07), ang = cf * Math.PI / 2, dir = norm(add(scale(centreDir, Math.cos(ang)), scale(outward, Math.sin(ang))));
          const R = roundAt(lower, pelvis, yH).radius(dir);
          p = madd([pelvis[0], yH, pelvis[2]], dir, R + (r === 0 ? 0.004 : 0.012));
        } else {
          // (laid down the leg as far as the body's own knee band, whatever the paper's length: a longer leg hangs slack)
          const kc = len(sub(lg.knee, lg.crotch)), geo = kc + 0.07, d = u * geo;
          const at = d < kc ? madd(lg.crotch, lg.thighDir, d) : madd(lg.knee, lg.shinDir, d - kc);
          const axis = d < kc ? lg.thighDir : lg.shinDir;
          // (its front: the belly's way at the crotch, turning to the knee's way at the knee)
          const fr0 = norm(sub(centreDir, scale(axis, dot(centreDir, axis))));
          const kneeFront = norm(sub(lg.pole, scale(axis, dot(lg.pole, axis)))), frontWay = back ? scale(kneeFront, -1) : kneeFront;
          const front = norm(lerp(fr0, frontWay, smoothstep(u * 1.4)));
          let inner = norm(cross(front, axis)); if (dot(inner, sub([pelvis[0], at[1], pelvis[2]], at)) < 0) inner = scale(inner, -1);
          const ang = cf * Math.PI, dir = norm(add(scale(inner, Math.cos(ang)), scale(front, Math.sin(ang))));
          p = madd(at, dir, width / Math.PI + (r === BROWS - 1 ? 0 : 0.005));
        }
        piece.at.push(p);
      }
    }
    pieces.push(piece); flatAll.push(...piece.flat); atAll.push(...piece.at); n += BROWS * BCOLS;
  }
  const byName = (nm: string) => pieces.find((p) => p.name === nm)!;
  const at = (p: Piece, r: number, c: number) => p.base + r * p.cols + c;
  const pair = (p: number, q: number, seam: string) => stitches.push({ p, q, q2: q, t: 0, seam });
  for (const s of ['F', 'B']) {
    const fr = byName(`breeches ${s} front`), bk = byName(`breeches ${s} back`);
    for (let r = 0; r < BROWS; r++) pair(at(fr, r, BCOLS - 1), at(bk, r, BCOLS - 1), `outside seam ${s}`);
    for (let r = CROTCH_ROW; r < BROWS; r++) pair(at(fr, r, 0), at(bk, r, 0), `inside leg ${s}`);
  }
  for (const half of ['front', 'back']) {
    const a = byName(`breeches F ${half}`), b = byName(`breeches B ${half}`);
    for (let r = 0; r <= CROTCH_ROW; r++) pair(at(a, r, 0), at(b, r, 0), `centre ${half}`);
  }
  // the waistband and the knee bands, held where they're laid
  for (const pc of pieces) for (let c = 0; c < BCOLS; c++) {
    pins.push({ p: at(pc, 0, c), at: atAll[at(pc, 0, c) - base] });
    pins.push({ p: at(pc, BROWS - 1, c), at: atAll[at(pc, BROWS - 1, c) - base] });
  }
  return { pieces, stitches, pins, ties: [], n: n - base, flat: flatAll, at: atAll, armholes: { W: 0, R: 0 } };
}

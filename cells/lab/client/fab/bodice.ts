/**
 * Tops: a bodice, its neckline, sleeves and collar, drafted to the figure as a dressmaker drafts a block, and in
 * GarmentCode's terms (Korosteleva & Sorkine-Hornung 2023): a front and a back, each half the chest's round and its ease
 * wide, as long as the figure's own surface is from the waist up over its shoulder (measured from the figure: body.ts),
 * joined at the shoulders and down the sides; the armhole cut from the shoulder's point down to under the arm, and the
 * neckline from the shoulder's line down the centre.
 *
 * What follows from what's decided (and is never set):
 * - the shoulder seams match: the back's is cut to the front's length;
 * - a sleeve's head is as long as the armhole it's set into (a few per cent more, eased in; half as much again for a
 *   puff, gathered): its height is solved for that, not chosen. A sleeve's as wide as the arm and its ease; an armhole
 *   too small for a sleeve that wide is cut deeper. (The first Fab's sleeves were a third too big for their armholes:
 *   nothing could have set them in);
 * - it must go over the head: a neckline that won't (less a knit's stretch) gets an opening down the back, buttoned;
 * - a top that comes below the hips is cut wide enough to clear them.
 */
import { CHEST_Y, WAIST_Y, arm, type V3 } from './body';
import { CHEST, Cut, HEAD_ROUND, TAU, WAIST, bodiceStart, coatAt, shoulderAt, surfaceLen, topAt } from './shared';
import { buttons, clamp, cubic, curve, flipX, fractions, line, mirror, patch, run, backwards, type At, type Edge, type P2 } from './edges';
import { roundAt, type Design, type Neck } from './pattern';

/** the neck's width at the shoulders (each side of the centre), and the neckline's depth below them, front and back */
export const NECKS: Record<Neck, { w: number; front: number; back: number; label: string }> = {
  round: { w: 5.4, front: 6, back: 1.8, label: 'round' },
  v: { w: 5.6, front: 11, back: 2.4, label: 'V' },
  square: { w: 6.4, front: 8, back: 2.6, label: 'square' },
  boat: { w: 8.6, front: 2.6, back: 1.4, label: 'boat' },
  scoop: { w: 7, front: 10, back: 3.6, label: 'scoop' },
};
/** round the upper arm, and the hand (a long sleeve's end must pass it) */
const ARM = TAU * 3.9, HAND = TAU * 3.4;
const named = (e: Edge, name: string): Edge => ({ ...e, name });

/** a dress's bodice's hem, round: the waist and its ease (what its skirt is cut to) */
export const bodiceHemRound = (d: Design) => WAIST + 3 + 0.3 * clamp(d.ease, 4, 16);

export interface Bodice {
  /** the hem, a loop round from the centre front (to sew a skirt or trousers on) */
  hem: At[]; hemRound: number;
  sleeved: boolean;
}

/** the neckline from the centre (0, −depth below N) to the neck's point N, on the figure's left (x > 0). It never
 * meets the shoulder upright (at 45° at the steepest): the cloth's grid runs down the piece, and an edge along the top
 * that ran straight up would crush it. So a square neck's sides lean, a little: a trapezoid neck, as GarmentCode has */
function neckline(kind: Neck, C: P2, N: P2): Edge {
  const dy = N[1] - C[1], dx = N[0] - C[0], k = 0.34 * Math.min(dx, dy);
  if (kind === 'v') return curve(C, N, [[0.5, 0.03]]);
  if (kind === 'square') { const c = Math.max(0.3 * dx, dx - 0.55 * dy); return cubic(C, [c * 0.7, C[1]], [c, C[1] + 0.05], [N[0], N[1]]); }
  // (round, scoop, boat: leaving the centre level, rounding up to the neck's point)
  return cubic(C, [dx * 0.5, C[1]], [N[0] - k, N[1] - k], N);
}

export function bodice(cut: Cut, d: Design, h: number, o: { toWaist: boolean; knit: boolean }): Bodice {
  const ease = clamp(d.ease, 4, 16), W = (CHEST + ease) / 2, sleeved = d.sleeveLen >= 2;
  const nk = NECKS[d.neck] ?? NECKS.round;
  const xs = sleeved ? 14.2 : 13.2, xn = Math.min(nk.w, xs - 4.5);
  const puff = sleeved && d.sleeve === 'puff', ratio = puff ? d.sleeveFullness : 1.03;
  // (the hem: at the waist for a dress, else as long as asked; wide enough to clear the hips if it comes below them)
  const len = o.toWaist ? 0 : clamp(d.bodyLen, -6, 30), yh = -len;
  let hw: number;
  if (o.toWaist) hw = bodiceHemRound(d) / 4;
  else {
    let need = 0;
    for (let y = Math.max(0, -len); y <= Math.max(0, len); y += 0.5) need = Math.max(need, len >= 0 ? roundAt(y) : 0);
    hw = Math.max((W / 2) * clamp(d.swing, 1, 1.8), need ? (need + 4) / 4 : 0);
  }
  if (len >= 8 && hw > (W / 2) * clamp(d.swing, 1, 1.8) + 0.05) cut.notes.push('let out at the hem to clear the hips');

  // (the shoulder's line: from the neck's point, as high as the figure's surface is long from the waist up its front
  // (or back) there, out to the shoulder's point, falling as the figure's shoulder falls across its top; the back cut
  // to the front's length)
  const drop = topAt(xn) - topAt(xs);
  const N: P2 = [xn, surfaceLen(xn, 1)], S: P2 = [xs, N[1] - drop];
  const Nb: P2 = [xn, surfaceLen(xn, -1)], Sb0: P2 = [xs, Nb[1] - drop];
  const lf = Math.hypot(S[0] - N[0], S[1] - N[1]), lb0 = Math.hypot(Sb0[0] - Nb[0], Sb0[1] - Nb[1]);
  const Sb: P2 = [Nb[0] + ((Sb0[0] - Nb[0]) * lf) / lb0, Nb[1] + ((Sb0[1] - Nb[1]) * lf) / lb0];
  // (the armhole: from the shoulder's point straight down, curving out to meet the side seam level, under the arm; cut
  // deeper if the sleeve needs it)
  let yu = CHEST_Y + 1.5 - WAIST_Y - 0.12 * ease + (sleeved ? 0 : 1.2);
  const ws0 = (ARM + 4 + 0.3 * ease) * (puff ? 1.3 : 1);
  const armholes = () => {
    const U: P2 = [W / 2, yu];
    // (it leaves the shoulder straight down and meets the side seam steeply (64°), not level: the cloth's grid runs down
    // the piece, and a side that ran level, or along the slope of the rows under the shoulder, would crush it; under
    // the arm, where the sleeve covers it, the difference is a few millimetres)
    const k = 0.45 * Math.hypot(U[0] - S[0], S[1] - yu), ca = Math.cos(1.12), sa = Math.sin(1.12);
    const af = cubic(S, [S[0] - 0.9, S[1] - 0.35 * (S[1] - yu)], [U[0] - k * ca, yu + k * sa], U, 'armhole L');
    const ab = cubic(Sb, [Sb[0] - 0.4, Sb[1] - 0.35 * (Sb[1] - yu)], [U[0] - k * ca, yu + k * sa], U, 'armhole R');
    return { U, af, ab };
  };
  let A = armholes(), deeper = 0;
  while (sleeved && (A.af.len + A.ab.len) * ratio < ws0 * 1.04 && deeper < 10) { yu -= 0.8; deeper++; A = armholes(); }
  if (deeper) cut.notes.push(`armholes cut ${(deeper * 0.8).toFixed(1)} cm deeper for the sleeve`);
  const { U, af, ab } = A;
  // (cropped no shorter than its armholes leave room for)
  if (yh > U[1] - 5) cut.notes.push('cropped as short as its armholes allow');
  const H: P2 = [hw, Math.min(yh, U[1] - 5)];

  // (the necklines: no lower than a little above the armholes)
  const dfront = clamp(nk.front + d.neckDepth, 1, N[1] - U[1] - 3), dback = clamp(nk.back + (d.neck === 'v' || d.neck === 'scoop' ? d.neckDepth * 0.3 : 0), 1, Nb[1] - U[1] - 4);
  const C: P2 = [0, N[1] - dfront], Cb: P2 = [0, Nb[1] - dback];
  const neckF = neckline(d.neck, C, N), neckB = neckline(d.neck === 'v' ? 'v' : 'round', Cb, Nb);
  // (will it go over the head? the neckline round, stretched as far as a knit stretches, against the head and a little)
  const round = 2 * (neckF.len + neckB.len), stretch = o.knit ? 1.5 : 1, need = HEAD_ROUND + 2;
  const opening = round * stretch < need ? clamp((need - round * stretch) / 2 + 1, 4, Cb[1] - H[1] - 4) : 0;
  if (opening) cut.notes.push(`opens ${opening.toFixed(0)} cm down the back to go over the head, buttoned`);
  else if (o.knit && round < need) cut.notes.push('the knit stretches over the head: no opening');

  // ─── the front ───
  const front = (() => {
    const sideL = line(U, H, 'side L'), sideR = named(flipX(sideL), 'side R'), armR = named(flipX(af), 'armhole R');
    const neckL = named(neckF, 'neck L'), neckR = named(mirror(neckF), 'neck R');
    const shL = line(N, S, 'shoulder L'), shR = named(mirror(shL), 'shoulder R');
    const foot = [line([-H[0], H[1]], [0, H[1]], 'hem R'), line([0, H[1]], H, 'hem L')];
    let k = -1;
    const lift = WAIST_Y + N[1] - topAt(xn) - 1.5;
    const pc = patch({
      name: 'front', top: [shR, neckR, neckL, shL], left: [armR, sideR], right: [af, sideL], foot, h, part: 'bodice',
      start: (u, v) => bodiceStart(cut.pieces[k].flat, 1, lift)(u, v),
      label: 'front · cut 1 on the fold', cut: 1,
    });
    k = cut.add(pc);
    return k;
  })();
  // ─── the back: one piece, or two with the opening between them ───
  const backs: number[] = [];
  {
    const sideR = line(U, H, 'side R'), sideL = named(flipX(sideR), 'side L');
    const armR = { ...ab }, armL = named(flipX(ab), 'armhole L');
    const neckR = named(neckB, 'neck R'), neckL = named(mirror(neckB), 'neck L');
    const shR = line(Nb, Sb, 'shoulder R'), shL = named(mirror(shR), 'shoulder L');
    const lift = WAIST_Y + Nb[1] - topAt(xn) - 1.5;
    const mk = (name: string, top: Edge[], left: Edge[], right: Edge[], foot: Edge[], half: boolean, label: string) => {
      let k = -1;
      const pc = patch({
        name, top, left, right, foot, h, label, cut: 1, drawn: !half || name === 'back left', part: 'bodice',
        start: (u, v) => bodiceStart(cut.pieces[k].flat, -1, lift)(u, v),
      });
      k = cut.add(pc); backs.push(k);
      return k;
    };
    if (!opening) mk('back', [shL, neckL, neckR, shR], [armL, sideL], [armR, sideR], [line([-H[0], H[1]], [0, H[1]], 'hem L'), line([0, H[1]], H, 'hem R')], false, 'back · cut 1 on the fold');
    else {
      const O: P2 = [0, Cb[1] - opening], B: P2 = [0, H[1]];
      mk('back left', [shL, neckL], [armL, sideL], [line(Cb, O, 'opening'), line(O, B, 'cb')], [line([-H[0], H[1]], B, 'hem L')], true, 'back · cut a pair');
      mk('back right', [neckR, shR], [line(Cb, O, 'opening'), line(O, B, 'cb')], [armR, sideR], [line(B, H, 'hem R')], true, '');
    }
  }
  const bk = (name: string) => backs.find((k) => cut.pieces[k].spans?.[name])!;
  // (sewn: the sides, the shoulders, the back below its opening, and buttoned above it)
  cut.sew(cut.pts(front, 'side L'), cut.pts(bk('side L'), 'side L'), 'side seam');
  cut.sew(cut.pts(front, 'side R'), cut.pts(bk('side R'), 'side R'), 'side seam');
  cut.sew(cut.pts(front, 'shoulder L'), backwards(cut.pts(bk('shoulder L'), 'shoulder L')), 'shoulder seam');
  cut.sew(cut.pts(front, 'shoulder R'), backwards(cut.pts(bk('shoulder R'), 'shoulder R')), 'shoulder seam');
  if (opening) {
    cut.sew(cut.pts(backs[0], 'cb'), cut.pts(backs[1], 'cb'), 'centre back seam');
    cut.pairs.push(...buttons(cut.pieces, cut.pts(backs[0], 'opening'), cut.pts(backs[1], 'opening'), Math.max(2, Math.round(opening / 5))));
    cut.pieces[backs[0]].marks = [...(cut.pieces[backs[0]].marks ?? []), ...Array.from({ length: Math.max(2, Math.round(opening / 5)) }, (_, k) => ({ kind: 'button' as const, pts: [[-0.9, Cb[1] - ((k + 0.5) / Math.max(2, Math.round(opening / 5))) * opening] as P2] }))];
  }
  // (it hangs from its shoulders: on the figure, and on a coat hanger)
  for (const [k, nm, sgn] of [[front, 'shoulder L', 1], [front, 'shoulder R', 1], [bk('shoulder L'), 'shoulder L', -1], [bk('shoulder R'), 'shoulder R', -1]] as const) {
    const pc = cut.pieces[k];
    for (const [i, j] of pc.spans![nm]) { const x = sgn * pc.flat(i / pc.nu, j / pc.nv)[0]; cut.holds.push({ at: [k, i, j], p: shoulderAt(x) }); cut.hanger.push({ at: [k, i, j], p: coatAt(x) }); }
  }
  const hemRun: At[] = [...cut.pts(front, 'hem L'), ...cut.pts(bk('hem L'), 'hem L'), ...cut.pts(bk('hem R'), 'hem R'), ...cut.pts(front, 'hem R')];
  const neckRun: At[] = [...cut.pts(bk('neck R'), 'neck R'), ...cut.pts(front, 'neck R'), ...cut.pts(front, 'neck L'), ...cut.pts(bk('neck L'), 'neck L')];
  const neckCF = cut.pts(bk('neck R'), 'neck R').length + cut.pts(front, 'neck R').length - 1;

  // ─── sleeves ───
  if (sleeved) for (const s of [1, -1] as const) sleeve(cut, d, s, { af: af.len, ab: ab.len, ws0, ratio, ease, h, front, back: bk(s > 0 ? 'armhole L' : 'armhole R') });
  else cut.notes.push('sleeveless: the armholes faced');
  // ─── the collar ───
  if (d.collar !== 'none') collar(cut, d, neckRun, neckCF, !!opening, h);
  cut.notes.unshift(`${NECKS[d.neck]?.label ?? 'round'} neck`);
  return { hem: hemRun, hemRound: 4 * hw, sleeved };
}

/** a sleeve, for the arm on side s (+1 the figure's left): its head's height solved so it's `ratio` times its armhole */
function sleeve(cut: Cut, d: Design, s: 1 | -1, o: { af: number; ab: number; ws0: number; ratio: number; ease: number; h: number; front: number; back: number }) {
  const puff = d.sleeve === 'puff', bell = d.sleeve === 'bell', target = (o.af + o.ab) * o.ratio;
  const W = Math.min(o.ws0, target / 1.04), Ls = clamp(d.sleeveLen, 2, 34);
  const head = (hh: number, tx: number) => {
    const B0: P2 = [-W / 2, 0], F0: P2 = [W / 2, 0], T: P2 = [tx, hh];
    return [curve(B0, T, [[0.32, -0.08], [0.68, 0.16]], 'cap b'), curve(T, F0, [[0.32, 0.16], [0.68, -0.08]], 'cap f')];
  };
  // (the head's height for its length, and where its top is across so each half fits its own armhole: back and front)
  const solveH = (tx: number) => { let lo = 0.2, hi = W * 1.4; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2, [b, f] = head(m, tx); if (b.len + f.len < target) lo = m; else hi = m; } return (lo + hi) / 2; };
  let tlo = -W / 4, thi = W / 4, hh = solveH(0), tx = 0;
  for (let k = 0; k < 18; k++) { tx = (tlo + thi) / 2; hh = solveH(tx); const [b, f] = head(hh, tx); if (b.len / (b.len + f.len) < o.ab / (o.af + o.ab)) tlo = tx; else thi = tx; }
  const [capB, capF] = head(hh, tx);
  // (its end: as wide as the arm is there and its ease, and past the hand if it comes down to the wrist; a bell flares)
  const along = Ls + 3, rArm = along < 16.3 ? 3.9 - (0.7 * along) / 16.3 : 3.1 - (0.5 * (along - 16.3)) / 20.6;
  let wh = TAU * rArm + 4 + 0.2 * o.ease;
  if (along > 30) wh = Math.max(wh, HAND + 2);
  // (a bell flares to nearly twice the arm's room, but no faster than its seams can lean: about 50° off the arm, so a
  // short one flares less)
  if (bell) wh = W + Math.min(0.8 * W, 2 * Ls * 1.15); else if (puff) wh = W;
  wh = Math.min(wh, bell ? W * 1.8 : W);
  const hemL: P2 = [-wh / 2, -Ls], hemR: P2 = [wh / 2, -Ls];
  const foot = bell ? [curve(hemL, hemR, [[0.5, -0.05]], 'hem')] : [line(hemL, hemR, 'hem')];
  let k = -1;
  const pc = patch({
    name: s > 0 ? 'left sleeve' : 'right sleeve', top: [capB, capF], left: [line(capB.a, hemL, 'under b')], right: [line(capF.b, hemR, 'under f')], foot, h: o.h,
    label: s > 0 ? `sleeve · cut a pair` : '', cut: 2, drawn: s > 0, part: 'sleeve',
    start: (u, v) => {
      const q = cut.pieces[k], [x, y] = q.flat(u, v), rw = Math.max(4, q.flat(1, v)[0] - q.flat(0, v)[0]);
      // (the arm as the figure stands when it's laid out: posed for the garment after it's drafted)
      const [up, fore] = arm(s);
      // (down the arm from its shoulder joint: the head over the joint, the rest along the upper arm and on)
      const dd = Math.max(0.5, 3 - y), la = Math.hypot(up.b[0] - up.a[0], up.b[1] - up.a[1], up.b[2] - up.a[2]);
      const [p0, p1, dl] = dd <= la ? [up.a, up.b, dd / la] : [fore.a, fore.b, Math.min(1.2, (dd - la) / Math.hypot(fore.b[0] - fore.a[0], fore.b[1] - fore.a[1], fore.b[2] - fore.a[2]))];
      const ax: V3 = norm3([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
      const upw = 1 - ax[1] * ax[1] > 1e-4 ? norm3([-ax[0] * ax[1], 1 - ax[1] * ax[1], -ax[2] * ax[1]]) : ([0, 0, 1] as V3);
      let e2 = cross3(ax, upw); if (e2[2] < 0) e2 = [-e2[0], -e2[1], -e2[2]];
      const ph = (x / Math.max(rw, 1)) * TAU, r = (y > 0 ? W : rw) / TAU + 0.25 + (y > 0 ? 0.25 * y : 0);
      const c: V3 = [p0[0] + (p1[0] - p0[0]) * dl, p0[1] + (p1[1] - p0[1]) * dl, p0[2] + (p1[2] - p0[2]) * dl];
      return [c[0] + r * (Math.cos(ph) * upw[0] + Math.sin(ph) * e2[0]), c[1] + r * (Math.cos(ph) * upw[1] + Math.sin(ph) * e2[1]), c[2] + r * (Math.cos(ph) * upw[2] + Math.sin(ph) * e2[2])];
    },
  });
  k = cut.add(pc);
  if (puff && s > 0) pc.marks = [{ kind: 'gather', pts: [capB.at(0.55), capB.at(1), capF.at(0.45)] }];
  const nm = s > 0 ? 'armhole L' : 'armhole R', tol = puff ? 0.06 : 0.03;
  // (set in: the back half of its head into the back's armhole, the front half into the front's; and sewn under the arm)
  cut.sew(cut.pts(k, 'cap b'), backwards(cut.pts(o.back, nm)), puff ? 'sleeve head, gathered' : 'sleeve head', { want: o.ratio, tol });
  cut.sew(cut.pts(k, 'cap f'), cut.pts(o.front, nm), puff ? 'sleeve head, gathered' : 'sleeve head', { want: o.ratio, tol });
  cut.sew(cut.pts(k, 'under b'), cut.pts(k, 'under f'), 'underarm seam');
  cut.anchors.push(...cut.pts(k, 'cap b'), ...cut.pts(k, 'cap f'));
  if (puff) {
    // (a puff's end gathered into a cuff as round as the arm there, and a little)
    const lc = Math.max(TAU * rArm + 3.5, along > 30 ? HAND + 1 : 0), hc = 2.4;
    const cuff = patch({
      name: s > 0 ? 'left cuff' : 'right cuff', kind: 'band', top: [line([-lc / 2, hc], [lc / 2, hc], 'top')], foot: [line([-lc / 2, 0], [lc / 2, 0], 'foot')],
      left: [line([-lc / 2, hc], [-lc / 2, 0], 'end a')], right: [line([lc / 2, hc], [lc / 2, 0], 'end b')], h: Math.max(1.4, o.h * 0.8), minV: 1,
      label: s > 0 ? 'cuff · cut 2' : '', cut: 2, drawn: s > 0, grain: Math.PI / 2,
      start: (u, v) => { const p = cut.pieces[k].start(u, 1); return [p[0], p[1] - 0.6 - v * hc * 0.7, p[2]]; },
    });
    cut.add(cuff); const kc = cut.pieces.length - 1;
    cut.sew(cut.pts(k, 'hem'), cut.pts(kc, 'top'), 'cuff, gathered', { want: wh / lc, tol: 0.03 });
    cut.sew(cut.pts(kc, 'end a'), cut.pts(kc, 'end b'), 'cuff seam');
    if (s > 0) cut.notes.push('puffed: gathered at the head and into a cuff');
  } else if (s > 0 && bell) cut.notes.push('bell sleeves');
  if (s > 0) cut.notes.push(Ls < 6 ? 'cap sleeves' : Ls < 14 ? 'short sleeves' : Ls < 24 ? 'elbow-length sleeves' : 'long sleeves');
}

/** a collar round the neckline (a loop of grid points from the centre back, round the figure's right, the front, its
 * left, back to the centre back) */
function collar(cut: Cut, d: Design, neck: At[], cf: number, opening: boolean, h: number) {
  const fr = fractions(cut.pieces, neck), L = fr.len;
  // (where on the figure the neckline's points were laid: the collar's laid out from them)
  const neckAt = (f: number): V3 => {
    let k = 0; while (k < fr.f.length - 2 && fr.f[k + 1] < f) k++;
    const t = clamp((f - fr.f[k]) / Math.max(1e-9, fr.f[k + 1] - fr.f[k]), 0, 1), a = neck[k], b = neck[k + 1];
    const pa = cut.pieces[a[0]].start(a[1] / cut.pieces[a[0]].nu, a[2] / cut.pieces[a[0]].nv), pb = cut.pieces[b[0]].start(b[1] / cut.pieces[b[0]].nu, b[2] / cut.pieces[b[0]].nv);
    return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t];
  };
  const outward = (p: V3): V3 => { const l = Math.hypot(p[0], p[2] + 0.4) || 1; return [p[0] / l, 0, (p[2] + 0.4) / l]; };
  // (the centre front is where the loop's halfway by its two halves: the back and front of the right side, then the left)
  const half = fr.f[cf];
  if (d.collar === 'peterpan') {
    // (a flat collar: two halves, each a ring's sector whose inner edge is its half of the neckline, rounded at the front)
    const w = d.collarWidth;
    for (const side of [0, 1]) {
      const Lh = side === 0 ? half * L : (1 - half) * L, th = Math.PI * 0.9, r = Lh / th, R0 = r;
      const inner = (f: number): P2 => { const a = (f - 0.5) * th; return [r * Math.sin(a), R0 - r * Math.cos(a)]; };
      // (its outer edge: the full width at the back, curving in to a round at the front)
      const cfAt = side === 0 ? 1 : 0, wAt = (f: number) => { const g = Math.abs(f - cfAt); return w * (0.4 + 0.6 * Math.min(1, g / 0.28) ** 0.6); };
      const outer = (f: number): P2 => { const a = (f - 0.5) * th, rr = r + wAt(f); return [rr * Math.sin(a), R0 - rr * Math.cos(a)]; };
      const top = [tabArc(inner, 'neck')], foot = [tabArc(outer, 'edge')];
      let k = -1;
      const pc = patch({
        name: side === 0 ? 'collar right' : 'collar left', top, foot, left: [line(inner(0), outer(0))], right: [line(inner(1), outer(1))], h: Math.max(1.4, h * 0.75), minV: 2,
        label: side === 0 ? 'collar · cut a pair' : '', cut: 2, drawn: side === 0,
        start: (u, v) => { const f0 = side === 0 ? u * half : half + u * (1 - half), p = neckAt(f0), o = outward(p), ww = v * wAt(u); return [p[0] + o[0] * (0.6 + ww * 0.85), p[1] + 0.5 - ww * 0.45, p[2] + o[2] * (0.6 + ww * 0.85)]; },
      });
      k = cut.add(pc);
      cut.sew(cut.pts(k, 'neck'), side === 0 ? neck.slice(0, cf + 1) : neck.slice(cf), 'collar');
      cut.anchors.push(...cut.pts(k, 'neck'));
    }
    cut.notes.push('a Peter Pan collar');
    return;
  }
  // (a band collar stands up round the neck; a frill's twice as long, gathered on, and lies out over the shoulders)
  const frill = d.collar === 'frill', lc = frill ? L * 1.8 : L, hc = d.collarWidth * (frill ? 1 : 0.65);
  let k = -1;
  const pc = patch({
    name: frill ? 'frill' : 'collar band', kind: frill ? 'panel' : 'band',
    top: [line([-lc / 2, hc], [lc / 2, hc], frill ? 'neck' : 'edge')], foot: [line([-lc / 2, 0], [lc / 2, 0], frill ? 'edge' : 'neck')],
    left: [line([-lc / 2, hc], [-lc / 2, 0], 'end a')], right: [line([lc / 2, hc], [lc / 2, 0], 'end b')], h: Math.max(1.3, h * 0.7), minV: 2,
    label: frill ? 'frill · cut 1' : 'collar band · cut 1', cut: 1, grain: frill ? 0 : Math.PI / 2,
    start: (u, v) => { const p = neckAt(u), o = outward(p); return frill ? [p[0] + o[0] * (0.7 + v * 3.2), p[1] + 0.4 - v * 2.4, p[2] + o[2] * (0.7 + v * 3.2)] : [p[0] + o[0] * 0.6, p[1] + (1 - v) * hc, p[2] + o[2] * 0.6]; },
  });
  k = cut.add(pc);
  cut.sew(cut.pts(k, 'neck'), neck, frill ? 'frill, gathered' : 'collar band', { want: lc / L, tol: 0.03 });
  cut.anchors.push(...cut.pts(k, 'neck'));
  if (!opening) cut.sew(cut.pts(k, 'end a'), cut.pts(k, 'end b'), frill ? 'frill seam' : 'collar seam');
  cut.notes.push(frill ? 'a frilled collar' : 'a band collar');
}

function tabArc(fn: (f: number) => P2, name: string): Edge {
  const pts: P2[] = [], acc = [0], n = 64;
  for (let k = 0; k <= n; k++) pts.push(fn(k / n));
  for (let k = 1; k <= n; k++) acc.push(acc[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const len = acc[n];
  return {
    a: pts[0], b: pts[n], len, name,
    at: (f) => { const s = clamp(f, 0, 1) * len; let j = 0; while (j < n - 1 && acc[j + 1] < s) j++; const t = (s - acc[j]) / Math.max(1e-9, acc[j + 1] - acc[j]); return [pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]; },
  };
}
const norm3 = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export { run };

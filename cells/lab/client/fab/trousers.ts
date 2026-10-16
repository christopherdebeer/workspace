/**
 * Trousers, after GarmentCode's PantPanel: four panels, a front and a back for each leg. Each is a quarter of the hips'
 * round and its ease wide, straight up to the waist (an elastic waist gathers it into the band), and on its inner side
 * the crotch: down the centre and curving out under the body to the crotch's point, then the inseam down the leg.
 *
 * What follows from what's decided:
 * - the crotch seams, front and back, are each as long as the figure's own surface is from its waist down under it to
 *   between its legs (measured: body.ts), and a little: the curve's reach (the crotch extension) is solved for it;
 * - the leg's as wide as the leg there and its room, wider at the hem as it flares; a full-length leg must pass the foot;
 * - the waist, cut as wide as the hips, gathers into a band the waist's round (it must go over the hips).
 */
import { WAIST_Y, around, section, type V3 } from './body';
import { Cut, TAU, WAIST, clipAt, waistband } from './cut';
import { clamp, cubic, flipX, line, mirror, patch, type At, type Edge, type P2 } from './edges';
import { bandAt } from './pattern';
import { roundAt, type Design } from './pattern';

const PELVIS_Y = 52, PELVIS_R = 11.4, PELVIS_Z = -0.3, CROTCH_Y = PELVIS_Y - PELVIS_R;
/** the figure's surface down its middle, from the waist under it to between the legs: front (+1) or back (−1) */
export function crotchPath(side: 1 | -1): number {
  const zAt = (y: number) => {
    const s = section(Math.max(PELVIS_Y, y)), torso = y >= PELVIS_Y ? s.cz + side * s.rz : NaN;
    const dy = y - PELVIS_Y, ball = Math.abs(dy) <= PELVIS_R ? PELVIS_Z + side * Math.sqrt(PELVIS_R * PELVIS_R - dy * dy) : NaN;
    if (Number.isNaN(torso)) return ball;
    if (Number.isNaN(ball)) return torso;
    return side > 0 ? Math.max(torso, ball) : Math.min(torso, ball);
  };
  let len = 0, py = WAIST_Y, pz = zAt(WAIST_Y);
  for (let y = WAIST_Y - 0.2; y >= CROTCH_Y; y -= 0.2) { const z = zAt(y); len += Math.hypot(py - y, z - pz); py = y; pz = z; }
  return len;
}
/** the leg's radius at a height (the thigh, then the shin) */
const legR = (y: number) => (y >= 30 ? 4.4 + ((y - 30) / 25) * 1.2 : 3.2 + ((y - 6) / 24) * 1);
export const HIP = Math.max(...Array.from({ length: 37 }, (_, k) => roundAt(k * 0.5)));

export interface Trousers { waist: At[]; waistRound: number }

export function trousers(cut: Cut, d: Design, h: number, o: { joined: boolean }): Trousers {
  const wide = clamp(d.legWidth, 1, 2), Lin = clamp(d.legLen, 3, 34), flare = clamp(d.flare, 0.8, 1.8);
  const drop = 1.5 + 1.5 * (wide - 1), D = WAIST_Y - CROTCH_Y + drop, yHip = D - (WAIST_Y - 58);
  const room = HIP + 6 + 10 * (wide - 1), Wf = room / 4 - 0.6, Wb = room / 4 + 0.6;
  // (the hem: the leg's round there and its room, flared; past the foot if it's that long)
  const hemY = CROTCH_Y - drop - Lin, legRoom = 6 + 10 * (wide - 1);
  let hem = (TAU * legR(hemY) + legRoom) * (Lin > 12 ? flare : 1);
  if (hemY < 10) hem = Math.max(hem, 26);
  // (the crotch's reach, solved so each crotch seam is as long as the figure's surface there, and 2 cm)
  // (leaving the waist straight down, arriving at the crotch's point at 45°: a side that ran level would crush the grid)
  const crotch = (e: number) => cubic([0, D], [0, D * 0.3], [-e + 0.45 * Math.min(e, D * 0.3), 0.45 * Math.min(e, D * 0.3)], [-e, 0], 'crotch');
  const reach = (target: number) => { let lo = 0.5, hi = 30; for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (crotch(m).len < target) lo = m; else hi = m; } return (lo + hi) / 2; };
  const ef = reach(crotchPath(1) + 2), eb = reach(crotchPath(-1) + 2);
  // (a panel as drawn with its crotch on its left: the front's left leg, the back's right)
  const shape = (W: number, e: number, hw: number) => {
    const c = (W - e) / 2, inner: P2 = [c - hw / 2, -Lin], outer: P2 = [c + hw / 2, -Lin];
    const out1 = line([W, D], [W, yHip], 'outseam'), out2 = line([W, yHip], outer, 'outseam leg');
    return { top: [line([0, D], [W, D], 'waist')], left: [crotch(e), line([-e, 0], inner, 'inseam')], right: [out1, out2], foot: [line(inner, outer, 'hem')] };
  };
  const mirrored = (s: ReturnType<typeof shape>) => ({ top: s.top.map(mirror), left: s.right.map(flipX), right: s.left.map(flipX), foot: s.foot.map(mirror) });
  const hf = hem * 0.48, hb = hem * 0.52;
  const panels: Array<{ name: string; s: ReturnType<typeof shape>; leg: 1 | -1; front: boolean; label: string }> = [
    { name: 'front left', s: shape(Wf, ef, hf), leg: 1, front: true, label: 'front · cut a pair' },
    { name: 'back left', s: mirrored(shape(Wb, eb, hb)), leg: 1, front: false, label: 'back · cut a pair' },
    { name: 'back right', s: shape(Wb, eb, hb), leg: -1, front: false, label: '' },
    { name: 'front right', s: mirrored(shape(Wf, ef, hf)), leg: -1, front: true, label: '' },
  ];
  const idx: number[] = [];
  for (const P of panels) {
    let k = -1;
    // (laid out round its leg below the crotch, and round the hips above it)
    const th0 = P.front ? (P.leg > 0 ? 0 : -Math.PI / 2) : P.leg > 0 ? Math.PI / 2 : Math.PI;
    const a0 = P.front ? -Math.PI / 2 : Math.PI / 2;
    const pc = patch({
      name: P.name, top: P.s.top, left: P.s.left, right: P.s.right, foot: P.s.foot, h, label: P.label, cut: 2, drawn: !!P.label,
      start: (u, v): V3 => {
        const q = cut.pieces[k], [, y] = q.flat(u, v), rw = Math.max(6, q.flat(1, v)[0] - q.flat(0, v)[0]);
        const yb = CROTCH_Y - drop + y, w = clamp(y / (D * 0.45), 0, 1);
        const a = a0 + Math.PI * u, r = rw / Math.PI / 2 + 1.4 + legR(Math.max(6, Math.min(55, yb))) * 0.35;
        const leg: V3 = [P.leg * 7 + Math.sin(a) * r, yb, Math.cos(a) * r];
        const t = around(Math.max(PELVIS_Y, yb), th0 + (Math.PI / 2) * u, 1.6);
        return [leg[0] + (t[0] - leg[0]) * w, yb, leg[2] + (t[2] - leg[2]) * w];
      },
    });
    k = cut.add(pc); idx.push(k);
  }
  const [FL, BL, BR, FR] = idx;
  const outseam = (k: number, a: string, b: string) => { const x = cut.pts(k, a), y = cut.pts(k, b); return [...x, ...y.slice(1)]; };
  cut.sew(outseam(FL, 'outseam', 'outseam leg'), outseam(BL, 'outseam', 'outseam leg'), 'outside leg seam');
  cut.sew(outseam(FR, 'outseam', 'outseam leg'), outseam(BR, 'outseam', 'outseam leg'), 'outside leg seam');
  cut.sew(cut.pts(FL, 'inseam'), cut.pts(BL, 'inseam'), 'inside leg seam');
  cut.sew(cut.pts(FR, 'inseam'), cut.pts(BR, 'inseam'), 'inside leg seam');
  cut.sew(cut.pts(FL, 'crotch'), cut.pts(FR, 'crotch'), 'front crotch seam');
  cut.sew(cut.pts(BL, 'crotch'), cut.pts(BR, 'crotch'), 'back crotch seam');
  // (the waist, round from the centre front: the left front, left back, right back, right front)
  const waist: At[] = [...cut.pts(FL, 'waist'), ...cut.pts(BL, 'waist'), ...cut.pts(BR, 'waist'), ...cut.pts(FR, 'waist')];
  const waistRound = 2 * (Wf + Wb);
  if (!o.joined) {
    const band = WAIST + 1.5;
    waistband(cut, band, h);
    // (the waist gathered evenly into the band: each point at its share of the way round)
    let acc = 0;
    const pos = waist.map((p, i) => { if (i > 0 && waist[i - 1][0] === p[0]) { const a = cut.pieces[p[0]], q = waist[i - 1]; acc += Math.hypot(...sub(a.flat(p[1] / a.nu, 0), a.flat(q[1] / a.nu, 0))); } return acc; });
    pos.forEach((x, i) => { const s = (x / acc) * band; cut.holds.push({ at: waist[i], p: bandAt(s, WAIST_Y, band) }); cut.hanger.push({ at: waist[i], p: clipAt(s, 0, band) }); });
    cut.notes.push(`an elastic waist: ${(waistRound / band).toFixed(1)}× the band, gathered in`);
  }
  cut.notes.push(Lin < 8 ? 'shorts' : Lin < 22 ? 'cropped trousers' : 'full-length trousers');
  if (wide >= 1.6) cut.notes.push('wide legs'); if (flare >= 1.3 && Lin > 12) cut.notes.push('flared'); if (flare <= 0.9 && Lin > 12) cut.notes.push('tapered');
  cut.notes.push(`crotch reaches ${ef.toFixed(1)} cm in front, ${eb.toFixed(1)} cm behind`);
  // (checks of their own: clears the hips and the thighs, passes the foot)
  const thigh = TAU * legR(CROTCH_Y - 3) + 2, legAt = 2 * ((Wf + ef * 0.6) + (Wb + eb * 0.6));
  cut.checks.push({ name: 'clears the hips', ok: 4 * (Wf + Wb) / 2 >= HIP + 4 - 0.05, detail: `${(2 * (Wf + Wb)).toFixed(1)} cm round the hips, ${HIP.toFixed(1)} the body's` });
  cut.checks.push({ name: 'room for the legs', ok: legAt / 2 >= thigh + 2, detail: `${(legAt / 2).toFixed(1)} cm round each leg at the top, ${thigh.toFixed(1)} the thigh's` });
  if (!o.joined) cut.checks.push({ name: 'goes over the hips', ok: waistRound >= HIP + 2, detail: `the waist stretches to ${waistRound.toFixed(0)} cm; the hips are ${HIP.toFixed(0)}` });
  if (hemY < 10) cut.checks.push({ name: 'passes the foot', ok: hem >= 25.9, detail: `${hem.toFixed(1)} cm round the hem` });
  return { waist, waistRound };
}
const sub = (a: P2, b: P2): [number, number] => [a[0] - b[0], a[1] - b[1]];
export type { Edge };

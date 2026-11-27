/**
 * The fencer undressed: an adult's body, for the kit to be fitted to and to hang on. Not drawn in the game (the kit
 * covers it); `?body=bare` shows it, to judge it before anything is draped over it.
 *
 * Each part (the trunk, each arm, each leg, the neck and head) is a run of cross-sections along the skeleton, hung on
 * the fencer's own joints (fencer.ts), so it's in whatever pose the fencer is. A section is a shape round its centre:
 * a superellipse (between an ellipse and a rounded box), its half-width across and its depth in front and behind each
 * its own, so the chest can be fuller than the back, the seat fuller than the belly. Its radius is given for each
 * direction round it (polar), so the same description answers both questions asked of it: what does it look like (a
 * mesh lofted through it, athlete.ts) and is a point inside it, and how far from its surface ({@link nearSurface}: for
 * the cloth to lie on it).
 *
 * The proportions are an adult man's of the fencer's height (about 1.80 m): chest about 97 cm round, waist 82, hips 96,
 * the shoulders 47 cm across the deltoids, the upper arm 30 cm round, the thigh 55. The trunk's widths are taken across
 * the line of the shoulders, which is how a fencer stands side on, and the depths across that, chest and back.
 */
import type { Fencer } from '../fencer';
import { type V, add, cross, dot, len, lerp, madd, norm, scale, sub } from '../v3';

export type BoneName = 'pelvis' | 'chest' | 'head' | 'upperW' | 'foreW' | 'handW' | 'upperR' | 'foreR' | 'handR' | 'thighF' | 'shinF' | 'footF' | 'thighB' | 'shinB' | 'footB';
/** a cross-section: its centre, its axes (u across, w the other way, both square to the part's length), its radius in
 * each direction round it (a: from u toward w), and what bones carry it */
export interface Section { c: V; u: V; w: V; R: (a: number) => number; bones: [BoneName, number][] }
export interface Part { name: string; sections: Section[]; capA?: boolean; capB?: boolean; region: 'torso' | 'head' | 'arm' | 'rearArm' | 'leg' }
export interface Body { parts: Part[] }

/** a superellipse's radius in the direction a: half-width A along u, depths Bn (toward −w) and Bp (toward +w) */
const superR = (a: number, A: number, Bn: number, Bp: number, n: number) => {
  const c = Math.cos(a), s = Math.sin(a), B = s < 0 ? Bn : Bp;
  return Math.pow(Math.abs(c / A) ** n + Math.abs(s / B) ** n, -1 / n);
};
/** a value from keys [x, …values] at x, eased between them */
function keyed(keys: number[][], x: number): number[] {
  if (x <= keys[0][0]) return keys[0].slice(1);
  for (let k = 0; k < keys.length - 1; k++) if (x <= keys[k + 1][0]) {
    const t = (x - keys[k][0]) / (keys[k + 1][0] - keys[k][0]), e = t * t * (3 - 2 * t);
    return keys[k].slice(1).map((v, i) => v + (keys[k + 1][i + 1] - v) * e);
  }
  return keys[keys.length - 1].slice(1);
}
const perp = (v: V, ax: V): V => norm(sub(v, scale(ax, dot(v, ax))));
const blend = (s: number, a: number, b: number) => Math.min(1, Math.max(0, (s - a) / (b - a)));

// the trunk: height above the hip joints (m); half-width across the shoulders' line; depth in front; depth behind
const TRUNK: number[][] = [
  [-0.11, 0.155, 0.081, 0.101],
  [-0.07, 0.178, 0.093, 0.122],   // the seat
  [-0.02, 0.184, 0.101, 0.116],   // the hips (96 cm)
  [0.05, 0.166, 0.099, 0.101],
  [0.12, 0.151, 0.099, 0.093],    // the waist (82 cm)
  [0.20, 0.155, 0.108, 0.095],
  [0.28, 0.168, 0.124, 0.103],
  [0.34, 0.176, 0.130, 0.110],    // the chest (97 cm)
  [0.40, 0.182, 0.118, 0.110],    // under the arms; the shoulder blades
  [0.44, 0.201, 0.098, 0.100],    // out to the shoulders' points (the acromion, just beyond the joint)
  [0.47, 0.197, 0.084, 0.088],
  [0.495, 0.150, 0.074, 0.078],   // the top of the shoulder, falling to
  [0.52, 0.106, 0.066, 0.070],    // the trapezius rising to the neck
  [0.54, 0.074, 0.058, 0.062],    // the base of the neck
  [0.58, 0.061, 0.052, 0.056],
  [0.645, 0.058, 0.050, 0.054],
];
// limbs: distance from the joint along the bone (m); radius (round, a little flattened: across, other way)
const UPPER: number[][] = [[-0.055, 0.012, 0.012], [-0.04, 0.038, 0.036], [-0.02, 0.052, 0.050], [0.01, 0.056, 0.053], [0.06, 0.051, 0.048], [0.13, 0.046, 0.044], [0.2, 0.043, 0.041], [0.27, 0.040, 0.038], [0.33, 0.038, 0.036], [0.36, 0.036, 0.034]];
const FORE: number[][] = [[-0.025, 0.037, 0.035], [0, 0.039, 0.036], [0.05, 0.044, 0.040], [0.11, 0.041, 0.036], [0.19, 0.033, 0.028], [0.25, 0.028, 0.021]];
const HAND: number[][] = [[0, 0.028, 0.021], [0.035, 0.042, 0.016], [0.08, 0.040, 0.014], [0.105, 0.03, 0.012], [0.12, 0.012, 0.008]];
const THIGH: number[][] = [[-0.07, 0.05, 0.05], [-0.03, 0.084, 0.084], [0.05, 0.090, 0.088], [0.2, 0.078, 0.075], [0.36, 0.060, 0.058], [0.46, 0.052, 0.050], [0.49, 0.048, 0.046]];
const SHIN: number[][] = [[-0.03, 0.049, 0.048], [0, 0.051, 0.05], [0.1, 0.059, 0.057], [0.2, 0.051, 0.049], [0.33, 0.036, 0.034], [0.42, 0.029, 0.027]];

/** the fencer undressed, in its pose now */
export function bareBody(f: Fencer): Body {
  const c = f.capsules, F = f.frame, up: V = [0, 1, 0];
  const pelvis = c[0].a, chest = c[0].b, neck = c[1].b, head = lerp(c[2].a, c[2].b, 0.5);
  const parts: Part[] = [];

  // ── the trunk, hip to neck ──
  const hipLine = norm(sub(c[9].a, c[11].a)), clavicle = norm(add(sub(f.shoulder, c[7].a), scale(F.r, 0.085)));
  const centre = (h: number): V => h < 0 ? madd(pelvis, norm(sub(chest, pelvis)), h)
    : h < 0.42 ? lerp(pelvis, chest, h / 0.42)
    : h < 0.52 ? lerp(chest, neck, (h - 0.42) / 0.1)
    : madd(neck, norm(sub(head, neck)), h - 0.52);
  const trunk: Section[] = [];
  for (let k = 0; k <= 46; k++) {
    const h = -0.11 + (0.755 * k) / 46, [A, Bn, Bp] = keyed(TRUNK, h);
    const ax = norm(sub(centre(h + 0.01), centre(h - 0.01)));
    const u = perp(lerp(hipLine, clavicle, blend(h, 0.04, 0.39)), ax), w = norm(cross(u, ax));
    // (the chest rounder, the back flatter, the belly and seat in between)
    const n = 2.3 + 0.5 * blend(h, 0.3, 0.45);
    const kc = blend(h, 0.18, 0.4), kh = blend(h, 0.52, 0.62);
    const bones: [BoneName, number][] = [['pelvis', (1 - kc) * (1 - kh)], ['chest', kc * (1 - kh)], ['head', kh]];
    trunk.push({ c: centre(h), u, w, R: (a) => superR(a, A, Bn, Bp, n), bones: bones.filter((b) => b[1] > 0) });
  }
  parts.push({ name: 'trunk', sections: trunk, capA: true, region: 'torso' });

  // ── the head (a little egg on the neck) ──
  {
    const ax = norm(sub(head, neck)), u = perp(F.f, ax), w = norm(cross(u, ax)), sections: Section[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = -0.11 + (0.22 * k) / 12, s = Math.sqrt(Math.max(0, 1 - (t / 0.112) ** 2));
      sections.push({ c: madd(head, ax, t), u, w, R: (a) => superR(a, 0.078 * s + 0.002, 0.095 * s + 0.002, 0.095 * s + 0.002, 2), bones: [['head', 1]] });
    }
    parts.push({ name: 'head', sections, capA: true, capB: true, region: 'head' });
  }

  // ── a limb: sections along one bone (from `a` toward `b`), by distance from `a` ──
  const limb = (a: V, b: V, keys: number[][], hint: V, bones: (d: number) => [BoneName, number][], to?: number): Section[] => {
    const ax = norm(sub(b, a)), u = perp(hint, ax), w = norm(cross(u, ax)), d0 = keys[0][0], d1 = to ?? keys[keys.length - 1][0], out: Section[] = [];
    const N = Math.max(4, Math.round((d1 - d0) / 0.02));
    for (let k = 0; k <= N; k++) {
      const d = d0 + ((d1 - d0) * k) / N, [ru, rw] = keyed(keys, d);
      out.push({ c: madd(a, ax, d), u, w, R: (an) => superR(an, ru, rw, rw, 2.1), bones: bones(d).filter((x) => x[1] > 0) });
    }
    return out;
  };
  // the arms: the weapon arm's wrist is short of the hand (mid grip), the rear arm's is its hand's capsule's end
  for (const side of ['W', 'R'] as const) {
    const sh = side === 'W' ? f.shoulder : c[7].a, el = side === 'W' ? f.elbow : c[7].b, hand = side === 'W' ? f.hand : c[8].b;
    const foreLen = side === 'W' ? len(sub(hand, el)) - 0.07 : len(sub(hand, el));
    const up2 = side === 'W' ? F.u : F.u, U = `upper${side}` as BoneName, Fo = `fore${side}` as BoneName, H = `hand${side}` as BoneName;
    const upperLen = len(sub(el, sh));
    const upper = limb(sh, el, UPPER, up2, (d) => { const k = blend(d, upperLen - 0.04, upperLen + 0.01) * 0.5, kc = 1 - blend(d, -0.05, 0.0); return [[U, (1 - k) * (1 - kc * 0.5)], [Fo, k], ['chest', kc * 0.5]]; }, upperLen + 0.025);
    const fore = limb(el, hand, FORE.map((r) => [r[0] < 0 ? r[0] : r[0] * foreLen / 0.25, r[1], r[2]]), up2, (d) => { const k = blend(d, foreLen - 0.03, foreLen); return [[Fo, 1 - k * 0.5], [H, k * 0.5]]; });
    const wrist = madd(el, norm(sub(hand, el)), foreLen), handTip = side === 'W' ? madd(wrist, f.blade ? f.blade.handAxis : norm(sub(hand, el)), 0.12) : madd(wrist, norm(sub(hand, el)), 0.12);
    const palm = limb(wrist, handTip, HAND, side === 'W' && f.blade ? f.blade.thumb : F.f, () => [[H, 1]]);
    parts.push({ name: `upper arm ${side}`, sections: upper, capA: true, region: side === 'W' ? 'arm' : 'rearArm' });
    parts.push({ name: `forearm ${side}`, sections: fore, region: side === 'W' ? 'arm' : 'rearArm' });
    parts.push({ name: `hand ${side}`, sections: palm, capB: true, region: side === 'W' ? 'arm' : 'rearArm' });
  }
  // the legs (front: capsules 9, 10, foot 13; back: 11, 12, foot 14)
  for (const [side, th, sn, ft] of [['F', 9, 10, 13], ['B', 11, 12, 14]] as const) {
    const T = `thigh${side}` as BoneName, S = `shin${side}` as BoneName, Fb = `foot${side}` as BoneName;
    const thLen = len(sub(c[th].b, c[th].a)), snLen = len(sub(c[sn].b, c[sn].a));
    parts.push({ name: `thigh ${side}`, region: 'leg', capA: true, sections: limb(c[th].a, c[th].b, THIGH, F.f, (d) => { const kp = 1 - blend(d, -0.07, 0.05), kk = blend(d, thLen - 0.04, thLen + 0.01) * 0.5; return [[T, (1 - kp * 0.4) * (1 - kk)], ['pelvis', kp * 0.4], [S, kk]]; }, thLen + 0.03) });
    parts.push({ name: `shin ${side}`, region: 'leg', sections: limb(c[sn].a, c[sn].b, SHIN.map((r) => [r[0] < 0 ? r[0] : r[0] * snLen / 0.42, r[1], r[2]]), F.f, (d) => { const ka = blend(d, snLen - 0.04, snLen) * 0.5; return [[S, 1 - ka], [Fb, ka]]; }) });
    // (the foot: heel to toe, along its capsule, wide and low)
    const fa = c[ft].a, fb = c[ft].b, fax = norm(sub(fb, fa)), flen = len(sub(fb, fa));
    const foot: Section[] = [];
    for (let k = 0; k <= 10; k++) {
      const d = (flen * k) / 10, t = k / 10, wide = 0.03 + 0.016 * Math.sin(Math.PI * Math.min(1, t * 1.3)), tall = 0.04 * (1 - 0.65 * t) + 0.008;
      foot.push({ c: madd(madd(fa, fax, d), up, -0.01 - 0.012 * t), u: perp(cross(up, fax), fax), w: up, R: (a) => superR(a, wide, tall, tall * 0.6, 2.6), bones: [[Fb, 1]] });
    }
    parts.push({ name: `foot ${side}`, region: 'leg', sections: foot, capA: true, capB: true });
  }
  return { parts };
}

/**
 * Where a point is against the body: the nearest part's surface point in its direction from that part's axis, and
 * how far outside it the point is (negative: inside). For the cloth: a point closer than its thickness is pushed out
 * to the surface plus the thickness.
 */
export function nearSurface(body: Body, p: V): { d: number; surface: V; normal: V } {
  let best = { d: Infinity, surface: p, normal: [0, 1, 0] as V };
  for (const part of body.parts) {
    const S = part.sections;
    for (let k = 0; k < S.length - 1; k++) {
      const a = S[k], b = S[k + 1], ab = sub(b.c, a.c), L2 = dot(ab, ab);
      const t0 = L2 > 1e-12 ? dot(sub(p, a.c), ab) / L2 : 0;
      // (beyond a part's open ends, nothing: the neighbouring part covers it; a capped end is rounded by its sections)
      if (t0 < -0.25 || t0 > 1.25) continue;
      const t = Math.max(0, Math.min(1, t0)), cc = lerp(a.c, b.c, t), u = norm(lerp(a.u, b.u, t)), w = norm(lerp(a.w, b.w, t));
      const d = sub(p, cc), x = dot(d, u), y = dot(d, w), rho = Math.hypot(x, y);
      if (rho < 1e-9) continue;
      const an = Math.atan2(y, x), R = a.R(an) * (1 - t) + b.R(an) * t;
      // (off the end of the run, the distance along the axis counts too)
      const along = (t0 - t) * Math.sqrt(L2), dist = along === 0 ? rho - R : Math.hypot(Math.max(0, rho - R), along);
      if (dist < best.d) {
        const dir = norm(add(scale(u, x), scale(w, y)));
        best = { d: dist, surface: madd(cc, dir, R), normal: dir };
      }
    }
  }
  return best;
}

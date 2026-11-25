/**
 * A fencer, dressed: built each frame from the joints the body already has (fencer.ts: its capsules, its frame, the
 * weapon's particles). Nothing here moves anything: it only clothes what the bout put where it is.
 *
 * The kit is white cloth in planes, as in the painted study: a side-on torso (a fencer's shoulders point down the
 * piste, so the chest is narrow seen from the front), sleeves and knickers in faceted rings that break a little at
 * each ring (folds), a knee band, long socks, shoes with dark soles. The mask is a dark mesh with a white bib, kept
 * from being the darkest, most contrasting thing in the picture.
 *
 * The weapon carries the hand's roll (blade.thumb): the épée's bell is mounted off-centre on the blade, so it shifts as
 * the hand turns; the blade is triangular in section, so its faces take the window's light in turn; the bell is
 * hammered, so its highlights break and travel; and the glove's seam and the grip turn with it.
 */
import type { Fencer } from '../fencer';
import { Mesh, MAT, type C, around, hash3 } from './mesh';
import type { Garment, Wardrobe } from './cloth';
import { type V, add, cross, dot, len, lerp, madd, norm, scale, sub } from '../v3';

const KIT = {
  jacket: [0.64, 0.63, 0.6] as C, knickers: [0.6, 0.59, 0.57] as C, sock: [0.66, 0.66, 0.64] as C,
  glove: [0.5, 0.47, 0.42] as C, seam: [0.26, 0.24, 0.22] as C, skin: [0.55, 0.36, 0.27] as C,
  shoe: [0.78, 0.78, 0.76] as C, sole: [0.035, 0.035, 0.04] as C, band: [0.06, 0.07, 0.1] as C,
  mesh: [0.11, 0.11, 0.115] as C, bib: [0.6, 0.59, 0.56] as C, trim: [0.5, 0.49, 0.47] as C, trimDark: [0.035, 0.035, 0.04] as C, padding: [0.09, 0.09, 0.1] as C,
  grip: [0.06, 0.055, 0.05] as C, steel: [0.86, 0.87, 0.9] as C, bell: [0.78, 0.78, 0.8] as C, pad: [0.1, 0.09, 0.09] as C,
  button: [0.2, 0.2, 0.21] as C,
};

/** cloth's planes: a little lighter or darker face by face, as paint lays them */
const facet = (seed: number) => (i: number, j: number) => 0.965 + 0.07 * hash3(seed, i * 7 + 1, j * 13 + 5);

export function dressFencer(m: Mesh, f: Fencer, self: boolean, seed: number, wardrobe?: Wardrobe) {
  const c = f.capsules, F = f.frame, up: V = [0, 1, 0];
  const wrist = madd(f.hand, norm(sub(f.elbowLook, f.hand)), 0.045);
  if (wardrobe) {
    // the cloth: the jacket and the knickers as simulated (looking out of this one, only the weapon sleeve's lower part)
    const [jacket, sleeve, rearSleeve, leg, rearLeg] = wardrobe.garments;
    if (self) drawGarment(m, sleeve, 0, 4);
    else {
      drawGarment(m, jacket, 0); drawGarment(m, sleeve, 0); drawGarment(m, rearSleeve, 0); drawGarment(m, leg, 1); drawGarment(m, rearLeg, 1);
      // under the cloth, a slimmer body (it never shows unless the cloth parts): torso, seat, arms, thighs
      underBody(m, f, seed);
    }
  } else {
    if (!self) torso(m, f, seed);
    const top = self ? lerp(f.shoulder, f.elbowLook, 0.5) : madd(f.shoulder, norm(sub(f.shoulder, f.elbowLook)), 0.03);
    limb(m, [top, f.elbowLook, wrist], [self ? 0.078 : 0.09, 0.07, 0.05], KIT.jacket, seed + 11, F.u, [1]);
  }
  if (!self) mask(m, f);
  glove(m, f, wrist, seed);
  if (!self) {
    const rs = c[3].b, re = c[7].b, rh = c[8].b;
    if (!wardrobe) limb(m, [rs, re, rh], [0.082, 0.064, 0.046], KIT.jacket, seed + 23, F.u, [1]);
    // the bare rear hand, relaxed: a palm, the fingers curled a little, a thumb
    const hd = norm(sub(rh, re)), [hu, hw] = around(hd, F.r);
    m.ellipsoid(madd(rh, hd, 0.045), scale(hd, 0.05), scale(hu, 0.022), scale(hw, 0.04), 8, 5, () => [KIT.skin, MAT.skin]);
    m.ellipsoid(madd(madd(rh, hd, 0.1), hu, -0.006), scale(hd, 0.035), scale(hu, 0.018), scale(hw, 0.036), 8, 5, () => [KIT.skin, MAT.skin]);
    m.ellipsoid(madd(madd(rh, hd, 0.05), hw, 0.04), scale(hd, 0.03), scale(hu, 0.013), scale(hw, 0.013), 6, 4, () => [KIT.skin, MAT.skin]);
  }
  // legs: below the knickers' band the socks over the calf, the knee as a joint above them; then the shoes
  for (const [th, sh, ft] of [[c[9], c[10], c[13]], [c[11], c[12], c[14]]] as const) {
    const hip = th.a, knee = th.b, ankle = madd(sh.b, up, 0.035);
    const below = lerp(knee, ankle, 0.14);
    if (!wardrobe) {
      limb(m, [madd(hip, up, 0.06), lerp(hip, knee, 0.45), knee, below], [0.13, 0.12, 0.092, 0.08], KIT.knickers, seed + 31, F.f, [2]);
      limb(m, [lerp(knee, ankle, 0.1), lerp(knee, ankle, 0.17)], [0.078, 0.076], [KIT.knickers[0] * 0.92, KIT.knickers[1] * 0.92, KIT.knickers[2] * 0.92], seed + 37, F.f);
    }
    limb(m, [lerp(knee, ankle, 0.15), lerp(knee, ankle, 0.42), lerp(knee, ankle, 0.8), ankle], [0.062, 0.066, 0.049, 0.043], KIT.sock, seed + 41, F.f, [], 8);
    shoe(m, ft.a, ft.b);
  }
  weapon(m, f, seed);
}

/**
 * A garment as it hangs this frame, smoothed: the simulated grid is refined 2× each way by Catmull-Rom interpolation
 * (round the garment it wraps, down it it's clamped at the ends), so the solve's coarse panels and hard creases become
 * a smooth surface through the same particles, and its folds stay where the simulation put them. Normals come from the
 * refined surface; the fold shade, the seams and the weave's coordinates are carried along.
 */
const K = 2;
let RX = new Float32Array(0), RA = new Float32Array(0), RN = new Float32Array(0), TMP = new Float32Array(0);
function cr(p0: number, p1: number, p2: number, p3: number, t: number) {
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
}
function drawGarment(m: Mesh, g: Garment, tone: number, fromRow = 0) {
  const { rows, cols } = g.spec, x = g.x;
  const R = (rows - 1 - fromRow) * K + 1, Cn = cols * K, N = R * Cn;
  if (RX.length < N * 3) { RX = new Float32Array(N * 3); RA = new Float32Array(N * 4); RN = new Float32Array(N * 3); }
  // (round first: each simulated row refined about its wrap; then down: each refined column refined, clamped)
  if (TMP.length < (rows - fromRow) * Cn * 7) TMP = new Float32Array((rows - fromRow) * Cn * 7);
  const tmp = TMP;
  for (let i = fromRow; i < rows; i++) for (let j = 0; j < cols; j++) for (let s = 0; s < K; s++) {
    const t = s / K, a = (i * cols + (j - 1 + cols) % cols), b = i * cols + j, c = i * cols + (j + 1) % cols, d = i * cols + (j + 2) % cols;
    const o = ((i - fromRow) * Cn + j * K + s) * 7;
    for (let e = 0; e < 3; e++) tmp[o + e] = cr(x[a * 3 + e], x[b * 3 + e], x[c * 3 + e], x[d * 3 + e], t);
    tmp[o + 3] = g.shade[b] + (g.shade[c] - g.shade[b]) * t;
    tmp[o + 4] = g.seam[b] + (g.seam[c] - g.seam[b]) * t;
    const fuc = j === cols - 1 ? g.fu[b] + (g.fu[b] - g.fu[a]) : g.fu[c];
    tmp[o + 5] = g.fu[b] + (fuc - g.fu[b]) * t; tmp[o + 6] = g.fv[b];
  }
  const rowsT = rows - fromRow;
  for (let r = 0; r < R; r++) {
    const i = Math.floor(r / K), t = (r - i * K) / K, i0 = Math.max(0, i - 1), i1 = i, i2 = Math.min(rowsT - 1, i + 1), i3 = Math.min(rowsT - 1, i + 2);
    for (let c = 0; c < Cn; c++) {
      const q = r * Cn + c, A = (i0 * Cn + c) * 7, B = (i1 * Cn + c) * 7, Cc = (i2 * Cn + c) * 7, D = (i3 * Cn + c) * 7;
      for (let e = 0; e < 3; e++) RX[q * 3 + e] = t === 0 ? tmp[B + e] : cr(tmp[A + e], tmp[B + e], tmp[Cc + e], tmp[D + e], t);
      for (let e = 0; e < 4; e++) RA[q * 4 + e] = tmp[B + 3 + e] + (tmp[Cc + 3 + e] - tmp[B + 3 + e]) * t;
    }
  }
  // normals from the refined surface (turned outward by each row's middle)
  for (let r = 0; r < R; r++) {
    let mx = 0, my = 0, mz = 0;
    for (let c = 0; c < Cn; c++) { const k = (r * Cn + c) * 3; mx += RX[k]; my += RX[k + 1]; mz += RX[k + 2]; }
    mx /= Cn; my /= Cn; mz /= Cn;
    for (let c = 0; c < Cn; c++) {
      const k = (r * Cn + c) * 3, rr = (r * Cn + (c + 1) % Cn) * 3, ll = (r * Cn + (c - 1 + Cn) % Cn) * 3;
      const dd = (Math.min(R - 1, r + 1) * Cn + c) * 3, uu = (Math.max(0, r - 1) * Cn + c) * 3;
      const ax = RX[rr] - RX[ll], ay = RX[rr + 1] - RX[ll + 1], az = RX[rr + 2] - RX[ll + 2];
      const bx = RX[dd] - RX[uu], by = RX[dd + 1] - RX[uu + 1], bz = RX[dd + 2] - RX[uu + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const ln = Math.hypot(nx, ny, nz) || 1; nx /= ln; ny /= ln; nz /= ln;
      if (nx * (RX[k] - mx) + ny * (RX[k + 1] - my) + nz * (RX[k + 2] - mz) < 0) { nx = -nx; ny = -ny; nz = -nz; }
      RN[k] = nx; RN[k + 1] = ny; RN[k + 2] = nz;
    }
  }
  const circ = g.fu[1] * cols;
  const v = (r: number, c: number) => {
    const q = r * Cn + (c % Cn), k = q * 3, a = q * 4;
    m.vraw(RX[k], RX[k + 1], RX[k + 2], RN[k], RN[k + 1], RN[k + 2], RA[a], RA[a + 1], tone, MAT.fabric, c === Cn ? RA[a + 2] + circ : RA[a + 2], RA[a + 3]);
  };
  for (let r = 0; r < R - 1; r++) for (let c = 0; c < Cn; c++) {
    v(r, c); v(r + 1, c); v(r + 1, c + 1);
    v(r, c); v(r + 1, c + 1); v(r, c + 1);
  }
}

/** the body under the cloth: slimmer than the cloth can come in to, so it only fills a gap; the joints (knee, elbow)
 * shaped as joints where the cloth lies on them */
function underBody(m: Mesh, f: Fencer, seed: number) {
  const c = f.capsules, F = f.frame;
  const fill: C = [KIT.jacket[0] * 0.8, KIT.jacket[1] * 0.8, KIT.jacket[2] * 0.8];
  limb(m, [c[0].a, c[0].b, c[1].b], [0.142, 0.148, 0.06], fill, seed + 61, F.f, [], 6);
  m.ellipsoid(madd(c[0].a, [0, 1, 0], -0.05), scale(F.f, 0.16), [0, 0.11, 0], scale(F.r, 0.14), 10, 6, () => [KIT.knickers, MAT.cloth]);
  limb(m, [f.shoulder, f.elbowLook, f.hand], [0.055, 0.045, 0.04], fill, seed + 63, F.u, [], 6);
  limb(m, [c[7].a, c[7].b, c[8].b], [0.05, 0.042, 0.036], fill, seed + 65, F.u, [], 6);
  for (const k of [9, 11]) {
    limb(m, [c[k].a, c[k].b], [0.085, 0.06], fill, seed + 67 + k, F.f, [], 6);
    // the knee: a cap at the front of the joint, under the knickers' fall
    const knee = c[k].b, shin = norm(sub(c[k + 1].b, knee)), thigh = norm(sub(c[k].a, knee)), front = norm(scale(add(shin, thigh), -1));
    m.ellipsoid(madd(knee, front, 0.03), scale(front, 0.04), scale(shin, 0.05), scale(norm(cross(front, shin)), 0.05), 8, 5, () => [KIT.knickers, MAT.cloth]);
  }
}

/** a limb through joints: faceted rings, the faces lit plane by plane */
function limb(m: Mesh, pts0: V[], radii0: number[], col: C, seed: number, hint: V, creaseAt: number[] = [], seg = 12) {
  // (between joints a fuller ring (the cloth over the muscle); at a bending joint a crease: a pinched ring between two
  // full ones, which the soft normals turn into a fold line, as the painted study draws an elbow)
  const pts: V[] = [], radii: number[] = [];
  for (let i = 0; i < pts0.length; i++) {
    if (creaseAt.includes(i) && i > 0 && i < pts0.length - 1) {
      const a = norm(sub(pts0[i - 1], pts0[i])), b = norm(sub(pts0[i + 1], pts0[i]));
      pts.push(madd(pts0[i], a, 0.035)); radii.push(radii0[i] * 1.04);
      pts.push(pts0[i]); radii.push(radii0[i] * 0.88);
      pts.push(madd(pts0[i], b, 0.035)); radii.push(radii0[i] * 1.03);
    } else { pts.push(pts0[i]); radii.push(radii0[i]); }
    if (i < pts0.length - 1) { pts.push(lerp(pts0[i], pts0[i + 1], 0.5)); radii.push((radii0[i] + radii0[i + 1]) / 2 * 1.05); }
  }
  const rings: { c: V; u: V; w: V; ru: number; rw: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const d = norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
    const [u, w] = around(d, hint);
    rings.push({ c: pts[i], u, w, ru: radii[i], rw: radii[i] * 0.93 });
  }
  m.tube(rings, seg, col, MAT.cloth, { jit: seg > 8 ? 0.07 : 0, seed, capA: true, capB: true, shade: facet(seed), soft: 0.88 });
}

/** the torso, side on: an elliptical body, wide along the shoulder line (down the piste), narrow across */
function torso(m: Mesh, f: Fencer, seed: number) {
  const c = f.capsules, pelvis = c[0].a, chest = c[0].b, neck = c[1].b, F = f.frame;
  const spine = norm(sub(neck, pelvis));
  const at = (k: number, along: V) => {
    const [u0] = around(spine, along);
    return u0;
  };
  const u = at(0, F.f), w = norm(cross(spine, u));
  const ring = (p: V, ru: number, rw: number, du = 0) => ({ c: madd(p, u, du), u, w, ru, rw });
  const rings = [
    ring(madd(pelvis, spine, -0.12), 0.18, 0.16),
    ring(madd(pelvis, spine, -0.05), 0.205, 0.18),             // the jacket's hem, loose over the knickers
    ring(madd(pelvis, spine, -0.035), 0.195, 0.172),
    ring(lerp(pelvis, chest, 0.3), 0.19, 0.168),
    ring(lerp(pelvis, chest, 0.6), 0.205, 0.18, 0.008),
    ring(lerp(pelvis, chest, 0.88), 0.225, 0.185, 0.012),
    ring(lerp(chest, neck, 0.42), 0.23, 0.17, 0.02),           // the shoulders
    ring(lerp(chest, neck, 0.8), 0.12, 0.1, 0.02),
    ring(madd(neck, spine, 0.025), 0.075, 0.07, 0.02),         // the collar
  ];
  m.tube(rings, 14, KIT.jacket, MAT.cloth, { jit: 0.05, seed: seed + 3, capA: true, capB: true, shade: facet(seed + 3), soft: 0.85 });
  // the front shoulder's cap, where the sleeve meets the jacket
  m.ellipsoid(f.shoulder, scale(u, 0.1), scale(spine, 0.085), scale(w, 0.095), 10, 6, () => [KIT.jacket, MAT.cloth]);
}

/** the mask: a dark mesh front, the white bib under it, a white trim round the back */
function mask(m: Mesh, f: Fencer) {
  const h = f.capsules[2], c = lerp(h.a, h.b, 0.5), F = f.frame;
  const fwd = F.f, up: V = [0, 1, 0];
  // the mesh over the face and round the sides; a dark trim round its edge; dark padding behind; the bib below
  m.ellipsoid(madd(c, up, 0.01), scale(fwd, 0.125), scale(up, 0.155), scale(F.r, 0.112), 12, 8, (d) =>
    d[1] < -0.72 ? [KIT.bib, MAT.cloth] : d[0] > -0.18 ? [KIT.mesh, MAT.mesh] : d[0] > -0.34 ? [KIT.trimDark, MAT.rubber] : [KIT.padding, MAT.cloth]);
  // the bib: a padded flap from under the chin down over the collar
  // (the bib flares from under the chin over the collar: a padded apron, two planes and a fold)
  const top = madd(madd(c, fwd, 0.085), up, -0.115), mid = madd(madd(c, fwd, 0.095), up, -0.18), bot = madd(madd(c, fwd, 0.075), up, -0.265);
  const sx = scale(F.r, 0.1);
  m.quad(add(top, sx), sub(top, sx), sub(mid, scale(sx, 1.12)), add(mid, scale(sx, 1.12)), KIT.bib, MAT.cloth);
  m.quad(add(mid, scale(sx, 1.12)), sub(mid, scale(sx, 1.12)), sub(bot, scale(sx, 1.3)), add(bot, scale(sx, 1.3)), [KIT.bib[0] * 0.92, KIT.bib[1] * 0.92, KIT.bib[2] * 0.92], MAT.cloth);
  m.quad(sub(top, sx), add(top, sx), add(madd(top, fwd, -0.07), scale(sx, 1.1)), sub(madd(top, fwd, -0.07), scale(sx, 1.1)), KIT.bib, MAT.cloth);
}

/** a shoe from heel to toe: a rounded white upper over a dark sole, a little toe spring, two plain bands each side */
function shoe(m: Mesh, heel: V, toe: V) {
  const along = sub(toe, heel), L = len(along) + 0.05, d = norm([along[0], 0, along[2]]), side = norm(cross([0, 1, 0], d)), up: V = [0, 1, 0];
  const base = heel[1] - 0.038, h0: V = [heel[0], base, heel[2]], back = madd(h0, d, -0.035);
  // rings along the foot: where, half-width, height of the upper's top, how high the ring's middle sits
  const prof: [number, number, number][] = [[0, 0.036, 0.07], [0.12, 0.044, 0.085], [0.38, 0.048, 0.07], [0.68, 0.049, 0.052], [0.88, 0.042, 0.04], [1, 0.024, 0.028]];
  const rings = prof.map(([s, w, ht]) => {
    const c = madd(madd(back, d, s * L), up, 0.016 + ht / 2 + (s > 0.85 ? (s - 0.85) * 0.06 : 0));
    return { c, u: up, w: side, ru: ht / 2, rw: w };
  });
  m.tube(rings, 10, KIT.shoe, MAT.cloth, { capA: true, capB: true, soft: 0.85 });
  // the sole: dark, proud of the upper, thicker at the heel
  m.obox(madd(madd(back, d, L * 0.5), up, 0.009), scale(d, L * 0.52), scale(up, 0.009), scale(side, 0.053), KIT.sole, MAT.rubber);
  m.obox(madd(madd(back, d, L * 0.17), up, 0.02), scale(d, L * 0.17), scale(up, 0.008), scale(side, 0.05), KIT.sole, MAT.rubber);
  for (const sg of [-1, 1]) for (const k of [0.42, 0.56]) {
    const o = madd(madd(madd(back, d, k * L), side, sg * 0.0495), up, 0.02);
    m.quad(madd(o, d, -0.01), madd(o, d, 0.01), madd(madd(o, d, 0.035), up, 0.045), madd(madd(o, d, 0.015), up, 0.045), KIT.band, MAT.rubber);
  }
}

/** the glove: a gauntlet over the sleeve, the fist round the grip; its seam runs along the thumb's side and turns
 * with the hand */
function glove(m: Mesh, f: Fencer, wrist: V, seed: number) {
  const b = f.blade, ax = b.handAxis, thumb = perp(b.thumb, ax), side = cross(ax, thumb);
  const fa = norm(sub(wrist, f.elbowLook));
  const [u, w] = around(fa, thumb);
  // the gauntlet: a stiff cuff flaring over the sleeve's end
  const g0 = madd(wrist, fa, -0.09), g1 = madd(wrist, fa, 0.015);
  m.tube([{ c: madd(g0, fa, -0.01), u, w, ru: 0.06, rw: 0.058 }, { c: g0, u, w, ru: 0.064, rw: 0.062 }, { c: lerp(g0, g1, 0.55), u, w, ru: 0.054, rw: 0.051 }, { c: g1, u, w, ru: 0.04, rw: 0.038 }], 12, KIT.glove, MAT.glove, { soft: 0.8, capA: true });
  // the fist round the grip, behind the bell: small (the fingers wrap the grip, the bell's pad in front of them)
  const fist = madd(b.guard, ax, -0.06);
  m.ellipsoid(madd(fist, side, -0.006), scale(ax, 0.042), scale(thumb, 0.028), scale(side, 0.032), 8, 5, () => [KIT.glove, MAT.glove]);
  m.ellipsoid(madd(madd(fist, thumb, 0.022), ax, 0.018), scale(ax, 0.026), scale(thumb, 0.011), scale(side, 0.015), 8, 5, () => [KIT.glove, MAT.glove]);
  // the seam: a dark stitched line down the back of the cuff and over the back of the hand, on the thumb's side: it
  // turns as the hand rolls
  const seam = (pts: V[], wa: V, r = 0.0042) => { for (let i = 0; i < pts.length - 1; i++) m.quad(madd(pts[i], wa, -r), madd(pts[i], wa, r), madd(pts[i + 1], wa, r), madd(pts[i + 1], wa, -r), KIT.seam, MAT.rubber); };
  seam([madd(g0, u, 0.0655), madd(lerp(g0, g1, 0.55), u, 0.0555), madd(g1, u, 0.0415)], w);
  seam([madd(madd(fist, thumb, 0.0295), ax, -0.04), madd(madd(fist, thumb, 0.0295), ax, 0.03)], side, 0.0035);
}

function perp(v: V, ax: V): V { return norm(sub(v, scale(ax, dot(v, ax)))); }

/** the weapon: grip and pommel, the bell (off-centre, hammered), the blade (triangular), the button */
function weapon(m: Mesh, f: Fencer, seed: number) {
  const b = f.blade, ax = b.handAxis, thumb = perp(b.thumb, ax), side = cross(ax, thumb), G = b.guard, P = b.pommel;
  // grip: the orthopaedic grip, a dark shape turned with the hand; the pommel nut behind it
  const gl = len(sub(G, P));
  m.obox(madd(P, ax, gl * 0.5), scale(ax, gl * 0.48), scale(thumb, 0.013), scale(side, 0.016), KIT.grip, MAT.rubber);
  m.obox(madd(P, ax, -0.008), scale(ax, 0.012), scale(thumb, 0.011), scale(side, 0.011), KIT.steel, MAT.bell);
  // the bell: a spherical cap, its apex where the blade comes through, mounted off-centre (toward the side the knuckles
  // are, below the thumb: it covers the outside of the wrist)
  const r = b.weapon.guardR, h = b.weapon.guardDepth, R = (r * r + h * h) / (2 * h), th0 = Math.asin(Math.min(1, r / R));
  const off = add(scale(thumb, -0.016), scale(side, -0.009));
  const apex = add(G, off), C0 = madd(apex, ax, -R);
  const seg = 20, rings = 6;
  const pt = (i: number, j: number) => {
    const t = (i / rings) * th0, p = (j / seg) * Math.PI * 2;
    const d = norm(add(scale(ax, Math.cos(t)), add(scale(thumb, Math.sin(t) * Math.cos(p)), scale(side, Math.sin(t) * Math.sin(p)))));
    // hammered: each vertex's normal leans a little, by a pattern fixed in the bell (so it turns with the hand)
    const k = hash3(seed, i, j) - 0.5, l = hash3(seed + 1, i, j) - 0.5, tu = norm(cross(ax, d)), tv = cross(d, tu);
    const n = norm(add(d, add(scale(tu, k * 0.06), scale(tv, l * 0.06))));
    return { p: madd(C0, d, R), n, pin: madd(C0, d, R - 0.0012), d };
  };
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = pt(i, j), bb = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
    m.stri(a.p, bb.p, c.p, a.n, bb.n, c.n, KIT.bell, MAT.bell);
    m.stri(a.p, c.p, d.p, a.n, c.n, d.n, KIT.bell, MAT.bell);
    // (inside: polished steel as well, hammered the same way; the dark pad only round the middle, where the hand is)
    const ni = (q: V): V => scale(q, -1), padded = i < 5;
    const ic: C = padded ? KIT.pad : [KIT.bell[0] * 0.72, KIT.bell[1] * 0.72, KIT.bell[2] * 0.74], im = padded ? MAT.rubber : MAT.bell;
    m.stri(a.pin, c.pin, bb.pin, ni(a.n), ni(c.n), ni(bb.n), ic, im);
    m.stri(a.pin, d.pin, c.pin, ni(a.n), ni(d.n), ni(c.n), ic, im);
  }
  // the rim, rolled: catches the light all round
  const rimC = madd(C0, ax, R * Math.cos(th0)), rr = R * Math.sin(th0);
  const rim: V[] = [];
  for (let j = 0; j <= seg; j++) { const p = (j / seg) * Math.PI * 2; rim.push(add(rimC, add(scale(thumb, Math.cos(p) * rr), scale(side, Math.sin(p) * rr)))); }
  for (let j = 0; j < seg; j++) {
    const a = rim[j], c2 = rim[j + 1], oa = norm(sub(a, rimC)), oc = norm(sub(c2, rimC));
    const a1 = madd(madd(a, oa, 0.004), ax, -0.005), c1 = madd(madd(c2, oc, 0.004), ax, -0.005);
    m.stri(a, c2, c1, oa, oc, oc, KIT.bell, MAT.bell); m.stri(a, c1, a1, oa, oc, oa, KIT.bell, MAT.bell);
  }
  // the blade: a triangle in section, its flat (grooved) face on the thumb's side, its two other faces meeting in an
  // edge below; each face lit as a face, and turning with the hand
  const n = b.n;
  const sec: { A: V; B: V; Cc: V; up: V; sd: V }[] = [];
  for (let i = 1; i < n; i++) {
    const p = b.at(i), t = norm(sub(b.at(Math.min(i + 1, n - 1)), b.at(Math.max(i - 1, 1)))), up = perp(thumb, t), sd = cross(t, up);
    const rr2 = b.r[i] * 1.45, wd = rr2 * 2.5, ht = rr2 * 2.1;
    sec.push({ A: add(madd(p, up, ht * 0.33), scale(sd, -wd / 2)), B: add(madd(p, up, ht * 0.33), scale(sd, wd / 2)), Cc: madd(p, up, -ht * 0.67), up, sd });
  }
  const face = (k: 'A' | 'B' | 'Cc', l: 'A' | 'B' | 'Cc') => {
    for (let i = 0; i < sec.length - 1; i++) {
      const s0 = sec[i], s1 = sec[i + 1];
      const n0 = norm(cross(sub(s0[l], s0[k]), sub(s1[k], s0[k]))), n1 = n0;
      m.stri(s0[k], s0[l], s1[l], n0, n0, n1, KIT.steel, MAT.blade);
      m.stri(s0[k], s1[l], s1[k], n0, n1, n1, KIT.steel, MAT.blade);
    }
  };
  face('B', 'A'); face('A', 'Cc'); face('Cc', 'B');
  // the button: a barrel at the tip, darker, a bright ring where it seats
  const tip = b.tip, td = b.tipAxis, [tu, tw] = around(td, thumb), rb = b.r[n - 1] * 2.1;
  m.tube([{ c: madd(tip, td, -0.014), u: tu, w: tw, ru: rb * 0.9, rw: rb * 0.9 }, { c: madd(tip, td, -0.011), u: tu, w: tw, ru: rb, rw: rb }, { c: madd(tip, td, 0.004), u: tu, w: tw, ru: rb * 0.95, rw: rb * 0.95 }], 8, KIT.button, MAT.button, { capB: true });
}

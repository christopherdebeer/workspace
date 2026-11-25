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
import { type V, add, cross, dot, len, lerp, madd, norm, scale, sub } from '../v3';

const KIT = {
  jacket: [0.64, 0.63, 0.6] as C, knickers: [0.6, 0.59, 0.57] as C, sock: [0.66, 0.66, 0.64] as C,
  glove: [0.4, 0.37, 0.33] as C, seam: [0.26, 0.24, 0.22] as C, skin: [0.55, 0.36, 0.27] as C,
  shoe: [0.78, 0.78, 0.76] as C, sole: [0.035, 0.035, 0.04] as C, band: [0.06, 0.07, 0.1] as C,
  mesh: [0.11, 0.11, 0.115] as C, bib: [0.6, 0.59, 0.56] as C, trim: [0.5, 0.49, 0.47] as C,
  grip: [0.06, 0.055, 0.05] as C, steel: [0.86, 0.87, 0.9] as C, bell: [0.78, 0.78, 0.8] as C, pad: [0.1, 0.09, 0.09] as C,
  button: [0.2, 0.2, 0.21] as C,
};

/** cloth's planes: a little lighter or darker face by face, as paint lays them */
const facet = (seed: number) => (i: number, j: number) => 0.92 + 0.16 * hash3(seed, i * 7 + 1, j * 13 + 5);

export function dressFencer(m: Mesh, f: Fencer, self: boolean, seed: number) {
  const c = f.capsules, F = f.frame, up: V = [0, 1, 0];
  if (!self) {
    torso(m, f, seed);
    mask(m, f);
  }
  // the weapon arm: sleeve to the wrist, the glove over it
  const wrist = madd(f.hand, norm(sub(f.elbow, f.hand)), 0.045);
  limb(m, [f.shoulder, f.elbow, wrist], [0.066, 0.054, 0.045], KIT.jacket, seed + 11, F.u);
  glove(m, f, wrist, seed);
  // the rear arm, and its bare hand
  if (!self) {
    const rs = c[3].b, re = c[7].b, rh = c[8].b;
    limb(m, [rs, re, rh], [0.06, 0.05, 0.04], KIT.jacket, seed + 23, F.u);
    m.ellipsoid(madd(rh, norm(sub(rh, re)), 0.04), scale(norm(sub(rh, re)), 0.05), [0, 0.03, 0], scale(F.r, 0.02), 8, 5, () => [KIT.skin, MAT.skin]);
  }
  // legs: knickers to below the knee, a band, long socks; then the shoes
  for (const [th, sh, ft] of [[c[9], c[10], c[13]], [c[11], c[12], c[14]]] as const) {
    const hip = th.a, knee = th.b, ankle = madd(sh.b, up, 0.035);
    const below = lerp(knee, ankle, 0.14);
    limb(m, [madd(hip, up, 0.04), lerp(hip, knee, 0.5), knee, below], [0.1, 0.088, 0.068, 0.062], KIT.knickers, seed + 31, F.f);
    limb(m, [lerp(knee, ankle, 0.12), below], [0.066, 0.066], [KIT.knickers[0] * 0.9, KIT.knickers[1] * 0.9, KIT.knickers[2] * 0.9], seed + 37, F.f);
    limb(m, [below, lerp(below, ankle, 0.5), ankle], [0.06, 0.054, 0.042], KIT.sock, seed + 41, F.f);
    shoe(m, ft.a, ft.b);
  }
  weapon(m, f, seed);
}

/** a limb through joints: faceted rings, the faces lit plane by plane */
function limb(m: Mesh, pts0: V[], radii0: number[], col: C, seed: number, hint: V) {
  // (a ring between each pair of joints as well, a little fuller: the muscle under the cloth)
  const pts: V[] = [], radii: number[] = [];
  for (let i = 0; i < pts0.length; i++) {
    pts.push(pts0[i]); radii.push(radii0[i]);
    if (i < pts0.length - 1) { pts.push(lerp(pts0[i], pts0[i + 1], 0.45)); radii.push((radii0[i] + radii0[i + 1]) / 2 * 1.06); }
  }
  const rings: { c: V; u: V; w: V; ru: number; rw: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const d = norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]));
    const [u, w] = around(d, hint);
    rings.push({ c: pts[i], u, w, ru: radii[i], rw: radii[i] * 0.9 });
  }
  m.tube(rings, 10, col, MAT.cloth, { jit: 0.1, seed, capA: true, capB: true, shade: facet(seed), soft: 0.55 });
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
    ring(madd(pelvis, spine, -0.1), 0.165, 0.13),
    ring(madd(pelvis, spine, -0.04), 0.185, 0.142),            // the jacket's hem
    ring(madd(pelvis, spine, -0.03), 0.175, 0.134),
    ring(lerp(pelvis, chest, 0.35), 0.168, 0.125),
    ring(lerp(pelvis, chest, 0.6), 0.185, 0.132, 0.008),
    ring(lerp(pelvis, chest, 0.85), 0.2, 0.136, 0.012),
    ring(lerp(chest, neck, 0.45), 0.205, 0.12, 0.02),          // the shoulders
    ring(lerp(chest, neck, 0.85), 0.08, 0.07, 0.02),
    ring(madd(neck, spine, 0.02), 0.07, 0.066, 0.02),          // the collar
  ];
  m.tube(rings, 12, KIT.jacket, MAT.cloth, { jit: 0.06, seed: seed + 3, capA: true, capB: true, shade: facet(seed + 3), soft: 0.5 });
  // the front shoulder's cap, where the sleeve meets the jacket
  m.ellipsoid(f.shoulder, scale(u, 0.07), scale(spine, 0.06), scale(w, 0.065), 8, 5, () => [KIT.jacket, MAT.cloth]);
}

/** the mask: a dark mesh front, the white bib under it, a white trim round the back */
function mask(m: Mesh, f: Fencer) {
  const h = f.capsules[2], c = lerp(h.a, h.b, 0.5), F = f.frame;
  const fwd = F.f, up: V = [0, 1, 0];
  m.ellipsoid(madd(c, up, 0.01), scale(fwd, 0.125), scale(up, 0.155), scale(F.r, 0.112), 14, 10, (d) =>
    d[1] > -0.75 ? [KIT.mesh, MAT.mesh] : [KIT.trim, MAT.cloth]);
  // the bib: a padded flap from under the chin down over the collar
  // (the bib flares from under the chin over the collar: a padded apron, two planes and a fold)
  const top = madd(madd(c, fwd, 0.08), up, -0.11), mid = madd(madd(c, fwd, 0.085), up, -0.17), bot = madd(madd(c, fwd, 0.06), up, -0.25);
  const sx = scale(F.r, 0.09);
  m.quad(add(top, sx), sub(top, sx), sub(mid, scale(sx, 1.12)), add(mid, scale(sx, 1.12)), KIT.bib, MAT.cloth);
  m.quad(add(mid, scale(sx, 1.12)), sub(mid, scale(sx, 1.12)), sub(bot, scale(sx, 1.3)), add(bot, scale(sx, 1.3)), [KIT.bib[0] * 0.92, KIT.bib[1] * 0.92, KIT.bib[2] * 0.92], MAT.cloth);
  m.quad(sub(top, sx), add(top, sx), add(madd(top, fwd, -0.07), scale(sx, 1.1)), sub(madd(top, fwd, -0.07), scale(sx, 1.1)), KIT.bib, MAT.cloth);
}

/** a shoe from heel to toe: a white upper with two dark bands, a dark sole proud of it */
function shoe(m: Mesh, heel: V, toe: V) {
  const along = sub(toe, heel), L = len(along), d = norm([along[0], 0, along[2]]), side = norm(cross([0, 1, 0], d)), up: V = [0, 1, 0];
  const base = heel[1] - 0.038, mid = lerp(heel, toe, 0.5);
  const ctr: V = [mid[0], base + 0.04, mid[2]];
  m.obox(ctr, scale(d, L / 2 + 0.02), scale(up, 0.032), scale(side, 0.046), KIT.shoe, MAT.cloth);
  m.obox([mid[0], base + 0.006, mid[2]], scale(d, L / 2 + 0.03), scale(up, 0.008), scale(side, 0.05), KIT.sole, MAT.rubber);
  // (the toe rounded off: a smaller box ahead, a little lower)
  m.obox(add(madd(ctr, d, L / 2 + 0.02), [0, -0.01, 0]), scale(d, 0.025), scale(up, 0.022), scale(side, 0.042), KIT.shoe, MAT.cloth);
  for (const s of [-1, 1]) for (const k of [-0.05, 0.02]) {
    const o = add(madd(ctr, side, s * 0.0475), scale(d, k)), a = madd(o, up, -0.022), b = madd(o, up, 0.026);
    m.quad(madd(a, d, -0.012), madd(a, d, 0.012), madd(b, d, 0.03), madd(b, d, 0.006), KIT.band, MAT.rubber);
  }
}

/** the glove: a gauntlet over the sleeve, the fist round the grip; its seam runs along the thumb's side and turns
 * with the hand */
function glove(m: Mesh, f: Fencer, wrist: V, seed: number) {
  const b = f.blade, ax = b.handAxis, thumb = perp(b.thumb, ax), side = cross(ax, thumb);
  const fa = norm(sub(wrist, f.elbow));
  const [u, w] = around(fa, thumb);
  const g0 = madd(wrist, fa, -0.075), g1 = madd(wrist, fa, 0.01);
  m.tube([{ c: g0, u, w, ru: 0.052, rw: 0.05 }, { c: lerp(g0, g1, 0.5), u, w, ru: 0.05, rw: 0.047 }, { c: g1, u, w, ru: 0.043, rw: 0.041 }], 10, KIT.glove, MAT.glove, { jit: 0.06, seed: seed + 51, capA: true, shade: facet(seed + 51) });
  // the fist: round the grip just behind the guard, its knuckles toward the side away from the thumb
  const fist = madd(b.guard, ax, -0.055);
  m.ellipsoid(madd(fist, side, -0.004), scale(ax, 0.045), scale(thumb, 0.036), scale(side, 0.04), 10, 6, () => [KIT.glove, MAT.glove]);
  m.ellipsoid(madd(madd(fist, thumb, 0.028), ax, 0.014), scale(ax, 0.028), scale(thumb, 0.013), scale(side, 0.02), 8, 5, () => [KIT.glove, MAT.glove]);
  // the seam: a dark stitch line from the cuff over the back of the hand, on the thumb's side
  const s0 = madd(g0, u, 0.057), s1 = madd(g1, u, 0.048), s2 = madd(madd(fist, thumb, 0.039), ax, -0.03), s3 = madd(madd(fist, thumb, 0.039), ax, 0.035);
  const seam = (a: V, c: V, wa: V) => m.quad(madd(a, wa, -0.0035), madd(a, wa, 0.0035), madd(c, wa, 0.0035), madd(c, wa, -0.0035), KIT.seam, MAT.rubber);
  seam(s0, s1, w); seam(s2, s3, side);
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
  const seg = 30, rings = 8;
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
    const ni = (q: V): V => scale(q, -1), padded = i < 3;
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
    const a1 = madd(madd(a, oa, 0.0025), ax, -0.003), c1 = madd(madd(c2, oc, 0.0025), ax, -0.003);
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
  const tip = b.tip, td = b.tipAxis, [tu, tw] = around(td, thumb), rb = b.r[n - 1] * 1.55;
  m.tube([{ c: madd(tip, td, -0.014), u: tu, w: tw, ru: rb * 0.9, rw: rb * 0.9 }, { c: madd(tip, td, -0.011), u: tu, w: tw, ru: rb, rw: rb }, { c: madd(tip, td, 0.004), u: tu, w: tw, ru: rb * 0.95, rw: rb * 0.95 }], 8, KIT.button, MAT.button, { capB: true });
}

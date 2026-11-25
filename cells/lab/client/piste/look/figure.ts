/**
 * What's still built each frame on the CPU: the weapon (the blade bends, so it can't be skinned: grip and pommel, the
 * off-centre hammered bell, the triangular blade, the button), and the debug overlay of the body's contact capsules.
 * The athlete is skinned on the GPU (athlete.ts).
 */
import type { Fencer } from '../fencer';
import { Mesh, MAT, type C, around, hash3 } from './mesh';
import { type V, add, cross, dot, len, madd, norm, scale, sub } from '../v3';

const KIT = {
  grip: [0.06, 0.055, 0.05] as C, steel: [0.86, 0.87, 0.9] as C, bell: [0.78, 0.78, 0.8] as C, pad: [0.1, 0.09, 0.09] as C,
  button: [0.2, 0.2, 0.21] as C,
};
function perp(v: V, ax: V): V { return norm(sub(v, scale(ax, dot(v, ax)))); }

/** the body's contact capsules (what the blades meet), for the `bodies` overlay */
export function capsules(m: Mesh, f: Fencer) {
  const col: C = [1, 0.35, 0.2];
  for (const c of f.capsules) {
    const d = sub(c.b, c.a), L = len(d), [u, w] = around(L > 1e-6 ? norm(d) : [0, 1, 0], [0, 1, 0]);
    const rings = [0, 0.5, 1].map((t) => ({ c: madd(c.a, d, t), u, w, ru: c.ra + (c.rb - c.ra) * t, rw: c.ra + (c.rb - c.ra) * t }));
    m.tube(rings, 12, col, MAT.lamp);
    m.ellipsoid(c.a, [c.ra, 0, 0], [0, c.ra, 0], [0, 0, c.ra], 10, 6, () => [col, MAT.lamp]);
    m.ellipsoid(c.b, [c.rb, 0, 0], [0, c.rb, 0], [0, 0, c.rb], 10, 6, () => [col, MAT.lamp]);
  }
}

/** the weapon: grip and pommel, the bell (off-centre, hammered), the blade (triangular), the button */
export function weapon(m: Mesh, f: Fencer, seed: number) {
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
  const seg = 36, rings = 6;
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
    const rr2 = b.r[i], wd = rr2 * 1.65, ht = rr2 * 1.25;
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
  const tip = b.tip, td = b.tipAxis, [tu, tw] = around(td, thumb), rb = b.r[n - 1] * 1.15;
  m.tube([{ c: madd(tip, td, -0.014), u: tu, w: tw, ru: rb * 0.9, rw: rb * 0.9 }, { c: madd(tip, td, -0.011), u: tu, w: tw, ru: rb, rw: rb }, { c: madd(tip, td, 0.004), u: tu, w: tw, ru: rb * 0.95, rw: rb * 0.95 }], 8, KIT.button, MAT.button, { capB: true });
}

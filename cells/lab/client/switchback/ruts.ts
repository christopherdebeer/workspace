/**
 * Switchback's ruts as they were (`ruts=bolts`; the default now is gouge.ts, carved), and your own track: worn lines
 * drawn as bolts, not stripes.
 *
 * A rut is a run of bolts, each drawn as the sign is: two thick strokes slanting across the line, parallel, offset at a
 * step where they meet, cut square at the downhill end and coming to a point at the uphill end (toward the eye), in the
 * road's own shade, a step darker than the road. The strokes kink where the surface bends (a rock
 * step's edge, a roller's crest or trough, and between those now and then), so each one lies on one plane of the road and
 * takes that plane's light: in perspective the ruts are what describes the road's rise and fall, and nothing else need.
 * Near the eye they stream past as speed; further off fewer of them are drawn; past about 60 m, none.
 *
 * Two lines run down the road, swinging in toward the inside of a bend; where they come close they merge, and part again;
 * now and then a third splits off one of them, runs its own way and rejoins it.
 *
 * Your own track is the same mark, fresh: laid behind the rear tyre as you ride, the last 30 m of it kept, wider where the
 * rear was sliding, broken where you were in the air.
 */
import { Course, hash } from './course';
import { drift, ground } from './ground';
import { M, Mesh, trackCol } from './mesh';
import type { Rider } from './sim';

/** the track's drawn height at (s, u), as its facets lie (near enough: within a few centimetres) */
export function trackY(c: Course, s: number, u: number) {
  const i = Math.floor(s), f = s - i, half = c.at(i).width / 2;
  const dy = (r: number) => {
    let a = trackCol(c.seed, r, 0, half);
    for (let k = 1; k < 4; k++) {
      const b = trackCol(c.seed, r, k, half);
      if (u <= b[0] || k === 3) { const t = Math.max(0, Math.min(1, (u - a[0]) / (b[0] - a[0] || 1))); return a[1] + (b[1] - a[1]) * t; }
      a = b;
    }
    return 0;
  };
  return c.point(s, 0).y + dy(i) * (1 - f) + dy(i + 1) * f;
}

/** what's drawn under (s, u): the track where it is, the ground beside it (whichever is higher near the track's ragged edge) */
function topY(c: Course, s: number, u: number) {
  const p = c.point(s, u), half = p.width / 2, g = ground(c, s, u);
  return p.surface && Math.abs(u) < half + 0.6 ? Math.max(g, trackY(c, s, Math.max(-half, Math.min(half, u)))) : g;
}

/** where ruts run: the plain road, the rollers, a kicker's landing deck (not its ramp, under its chevrons, nor its gap) */
export const plain = (c: Course, i: number) => { const f = c.at(i).feature; return f !== 'ramp' && f !== 'gap'; };

/** where the surface bends between a and b: a rock step's edge (the lift changing slope), a roller's crest or trough, a
 * feature's start or end; and between those, where they're far apart, every five metres or so */
function knots(c: Course, a: number, b: number) {
  const ks: number[] = [];
  for (let i = Math.max(1, a); i <= b; i++) {
    const p = c.at(i - 1), q = c.at(i), d0 = q.lift - p.lift, d1 = c.at(i + 1).lift - q.lift;
    if (p.feature !== q.feature || (q.feature === 'whoop' ? d0 * d1 < 0 : Math.abs(d1 - d0) > 0.003)) ks.push(i);
  }
  const out: number[] = [];
  for (let n = 0; n < ks.length; n++) {
    out.push(ks[n]);
    const gap = (ks[n + 1] ?? ks[n]) - ks[n], parts = Math.ceil(gap / 5.5);
    for (let j = 1; j < parts && gap > 7; j++) out.push(ks[n] + Math.round((j * gap) / parts));
  }
  return out;
}

/** the lines across the road at knot K: where each is (u), and whether it's drawn on its own there */
export function lines(c: Course, K: number) {
  const seed = c.seed, half = c.at(K).width / 2, lim = half - 0.35;
  const n = (salt: number, per: number) => drift(seed, K / per, salt);
  // (a little sideways wander at each knot: the bolts carry their own zig)
  const jag = (salt: number) => (hash(seed, K, salt) < 0.5 ? -1 : 1) * (0.06 + 0.12 * hash(seed, K, salt, 2));
  let a = -1.25 + (n(11, 23) - 0.5) * 0.9, b = 1.05 + (n(12, 27) - 0.5) * 0.9;
  let ja = jag(1), jb = jag(2);
  // (the two, where they come close, run as one)
  const one = Math.abs(a - b) < 0.55;
  if (one) { a = b = (a + b) / 2; jb = ja; }
  // (a third, now and then: out from whichever is nearer its own way, and back)
  const p = Math.max(0, Math.min(1, (n(13, 45) - 0.5) / 0.22)), own = -2.6 + 5.2 * n(14, 60), fromA = Math.abs(own - a) < Math.abs(own - b);
  const par = fromA ? a : b, jp = fromA ? ja : jb, cu = par + (own - par) * p, jc = jp + (jag(3) - jp) * p;
  // (all of them swing in toward the inside of a bend)
  const bend = Math.max(-1.3, Math.min(1.3, -(c.at(K + 8).heading - c.at(Math.max(0, K - 8)).heading) * 1.7));
  const at = (u: number, j: number) => Math.max(-lim, Math.min(lim, u + bend + j));
  return [{ u: at(a, ja), own: true }, { u: at(b, jb), own: !one }, { u: at(cu, jc), own: Math.abs(cu - par) > 0.4 }];
}

/** a ribbon laid on the road from (sa, ua) to (sb, ub) in the course's own terms, w0 wide at its start narrowing (or not)
 * to w1 at its end, a row every metre or so so it lies on the faces under it */
function ribbon(m: Mesh, c: Course, sa: number, ua: number, sb: number, ub: number, w0: number, w1: number, y: (s: number, u: number) => number, tone: number) {
  const ds = sb - sa, du = ub - ua, L = Math.hypot(ds, du) || 1, ns = -du / L, nu = ds / L, rows = Math.max(1, Math.ceil(L));
  const P = (s: number, u: number) => { const p = c.point(s, u); return [p.x, y(s, u), p.z]; };
  let A: number[] | null = null, B: number[] | null = null;
  for (let k = 0; k <= rows; k++) {
    const t = k / rows, cs = sa + ds * t, cu = ua + du * t, hw = (w0 + (w1 - w0) * t) / 2;
    const A1 = P(cs + ns * hw, cu + nu * hw), B1 = P(cs - ns * hw, cu - nu * hw);
    if (A && B) { if (hw < 1e-3) m.tri(A, B, A1, M.RUT, tone); else m.quad(A, B, B1, A1, M.RUT, tone); }
    A = A1; B = B1;
  }
}

/** a bolt, as the sign is drawn: two thick strokes, parallel and slanting across the line, offset at a step where they
 * meet; its far (downhill) end cut square, its near end (toward the eye) a point. Centred on uC from sA to sB, leaning
 * one way or the other (dir), w wide */
function bolt(m: Mesh, c: Course, sA: number, sB: number, uC: number, dir: number, w: number, y: (s: number, u: number) => number) {
  const L = sB - sA, mid = sA + L * 0.5, J = L * 0.5 * Math.tan(0.34), S = w * 1.1, u0 = uC + dir * (J - S / 2);
  ribbon(m, c, sB, u0, mid - w * 0.45, u0 - dir * J, w, w, y, 0.5);
  ribbon(m, c, mid + w * 0.45, u0 - dir * J + dir * S, sA, u0 - dir * (2 * J - S), w, 0, y, 0.5);
}

/** one stroke of your own track: a wedge from its point at (sA, uA) to its blunt end at (sB, uB), w wide there, the end
 * cut at a slant (e), a row every metre so it lies on the faces under it */
function stroke(m: Mesh, c: Course, sA: number, uA: number, sB: number, uB: number, w: number, e: number, y: (s: number, u: number) => number, tone: number) {
  const rows = [sA];
  for (let s = Math.floor(sA) + 1; s < sB - 0.25; s++) rows.push(s);
  rows.push(sB);
  const P = (s: number, u: number) => { const p = c.point(s, u); return [p.x, y(s, u), p.z]; };
  let L = P(sA, uA), R = L;
  for (let k = 1; k < rows.length; k++) {
    const s = rows[k], t = (s - sA) / (sB - sA), u = uA + (uB - uA) * t, hw = (w / 2) * t, end = k === rows.length - 1;
    const L1 = P(end ? s + e : s, u - hw), R1 = P(end ? s - e : s, u + hw);
    if (k === 1) m.tri(L, R1, L1, M.RUT, tone); else m.quad(L, R, R1, L1, M.RUT, tone);
    L = L1; R = R1;
  }
}
void stroke;

/** the ruts near the rider at s: from behind the eye to where they stop being drawn */
export function buildRuts(c: Course, s: number) {
  const m = new Mesh(), seed = c.seed, ks = knots(c, Math.floor(s - 30), Math.ceil(s + 75));
  const y = (ss: number, u: number) => trackY(c, ss, u) + 0.04;
  for (let n = 0; n < ks.length - 1; n++) {
    const K0 = ks[n], K1 = ks[n + 1], len = K1 - K0;
    if (len < 1.5 || K1 < s - 16) continue;
    let ok = true;
    for (let i = K0; i < K1 && ok; i++) ok = plain(c, i);
    if (!ok) continue;
    const A = lines(c, K0), B = lines(c, K1);
    for (let j = 0; j < 3; j++) {
      if (!A[j].own && !B[j].own) continue;
      if (hash(seed, K0, j, 4) < 0.06) continue;
      // (fewer of them further off; none past 60 m)
      if (K0 - s > 60 - 22 * hash(seed, K0, j, 7) ** 2) continue;
      const g0 = Math.min(0.15 + hash(seed, K0, j, 5) * 0.75, len * 0.2), g1 = Math.min(0.1 + hash(seed, K0, j, 6) * 0.6, len * 0.15);
      // (a bolt in the gap between knots, on the line midway, leaning either way, 35–50 cm wide)
      const sa = K0 + g0, sb = K1 - g1, uc = (A[j].u + B[j].u) / 2;
      bolt(m, c, sa, sb, uc, hash(seed, K0, j, 9) < 0.5 ? -1 : 1, 0.35 + 0.15 * hash(seed, K0, j, 8), y);
    }
  }
  return new Float32Array(m.v);
}

/** your own track: strokes laid behind the rear tyre, the last 30 m of them */
export class Trail {
  /** (with the carved ruts: the freshest cut, nearly unbroken, a little wider, in the gouges' ink; off with `ruts=bolts`) */
  cut = true;
  private done: { d: number; v: number[] }[] = [];
  private head: { x: number; z: number; d: number; len: number; slip: number } | null = null;
  private last: { x: number; z: number } | null = null;
  private d = 0; private n = 0; private wait = 0; private down = false; private s = 0;
  constructor(private c: Course) {}
  clear() { this.done = []; this.head = null; this.last = null; }
  /** after each step of the sim */
  add(r: Rider) {
    // (down: the track up to the fall stays; put back at the flag, it's gone)
    if (r.crashT > 0) { this.end(); this.down = true; return; }
    if (this.down) { this.down = false; this.clear(); }
    if (r.air) { this.end(); this.last = null; return; }
    const x = r.x - Math.sin(r.heading) * 0.78, z = r.z - Math.cos(r.heading) * 0.78;
    if (this.last) this.d += Math.hypot(x - this.last.x, z - this.last.z);
    this.last = { x, z }; this.s = r.s;
    if (!this.head) { if (this.d >= this.wait) this.head = { x, z, d: this.d, len: 2.4 + 2.6 * hash(this.n, 31), slip: 0 }; return; }
    this.head.slip = Math.max(this.head.slip, Math.abs(r.slip));
    if (this.d - this.head.d >= this.head.len) this.end();
  }
  private end() {
    const h = this.head; if (!h) return;
    if (this.d - h.d > 0.6 && this.last) this.done.push({ d: this.d, v: this.stroke(h, this.last.x, this.last.z) });
    this.head = null; this.n++; this.wait = this.d + (this.cut ? 0.03 : 0.3 + 0.6 * hash(this.n, 32));
    this.done = this.done.filter((k) => this.d - k.d < 30);
  }
  /** a stroke from where it began (its point) straight to (x, z) (its blunt end), lying on what's under it */
  private stroke(h: { x: number; z: number; slip: number }, x: number, z: number) {
    const m = new Mesh(), c = this.c, dx = x - h.x, dz = z - h.z, L = Math.hypot(dx, dz) || 1;
    // (a slight sideways step at its end, so the chain is a bolt too, not a smooth line)
    const j = (hash(this.n, 33) - 0.5) * 0.14, rx = dz / L, rz = -dx / L, ex = x + rx * j, ez = z + rz * j;
    const w = (this.cut ? 0.17 : 0.1) + Math.min(0.28, h.slip * 0.7), rows = Math.max(1, Math.ceil(L / 0.9)), tone = this.cut ? 0.5 : 0.15, mat = this.cut ? M.GOUGE : M.RUT;
    const P = (px: number, pz: number) => { const q = c.locate(px, pz, this.s - 2); return [px, topY(c, q.s, q.u) + 0.06, pz]; };
    let A = P(h.x, h.z), B = A;
    for (let k = 1; k <= rows; k++) {
      const t = k / rows, cx = h.x + (ex - h.x) * t, cz = h.z + (ez - h.z) * t, hw = (w / 2) * t, sl = k === rows ? 0.12 : 0;
      const A1 = P(cx - rx * hw + dx / L * sl, cz - rz * hw + dz / L * sl), B1 = P(cx + rx * hw - dx / L * sl, cz + rz * hw - dz / L * sl);
      if (k === 1) m.tri(A, B1, A1, mat, tone); else m.quad(A, B, B1, A1, mat, tone);
      A = A1; B = B1;
    }
    return m.v;
  }
  /** what to draw this frame: the kept strokes and the one being laid */
  mesh() {
    const v: number[] = [];
    for (const k of this.done) for (const x of k.v) v.push(x);
    if (this.head && this.last) for (const x of this.stroke(this.head, this.last.x, this.last.z)) v.push(x);
    return new Float32Array(v);
  }
}

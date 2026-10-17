/**
 * The mannequin: a little wooden figure, a child's proportions, standing on a turned stand. Centimetres, y up, its
 * feet on the stand's top at y = 0, facing +z.
 *
 * Its torso's a stack of ellipses (hips, waist, chest, shoulders), lathed; its neck, arms and legs are capsules
 * between turned joints (balls); its head a ball. The same shapes are what the cloth meets: `push` moves a point out
 * of the body (and some way clear of it, a garment's own layer), and says which way out.
 */
export type V3 = [number, number, number];

/** the torso's section at a height: half-widths across (x) and front-to-back (z), and how far its middle sits forward */
const TORSO: Array<[y: number, rx: number, rz: number, cz: number]> = [
  [52, 11.5, 8.6, -0.3],   // under the hips
  [58, 14.2, 10.2, -0.6],  // hips
  [64, 13.2, 9.4, -0.4],
  [70, 11.2, 7.8, 0],      // waist
  [76, 12.2, 8.4, 0.4],
  [82, 13.6, 9.2, 0.8],    // chest
  [88, 14.6, 8.4, 0.2],
  [92, 13.8, 7.2, -0.4],   // shoulders' line
  [95, 8.5, 5.4, -0.4],
  [97, 4.4, 4.0, -0.2],    // into the neck
];
export const TORSO_TOP = 97, TORSO_FOOT = 52;
export const WAIST_Y = 70, HIP_Y = 58, CHEST_Y = 82, SHOULDER_Y = 91;

/** the torso's section at a height (smoothly, between the stations) */
export function section(y: number): { rx: number; rz: number; cz: number } {
  const t = TORSO;
  if (y <= t[0][0]) return { rx: t[0][1], rz: t[0][2], cz: t[0][3] };
  if (y >= t[t.length - 1][0]) { const l = t[t.length - 1]; return { rx: l[1], rz: l[2], cz: l[3] }; }
  let k = 0;
  while (t[k + 1][0] < y) k++;
  const a = t[Math.max(0, k - 1)], b = t[k], c = t[k + 1], d = t[Math.min(t.length - 1, k + 2)];
  const f = (y - b[0]) / (c[0] - b[0]);
  // (Catmull-Rom through the stations, so the lathe has no creases)
  const cr = (i: number) => {
    const p0 = a[i], p1 = b[i], p2 = c[i], p3 = d[i];
    return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
  };
  return { rx: cr(1), rz: cr(2), cz: cr(3) };
}
/** how far round the torso is at a height (an ellipse's perimeter, Ramanujan's) */
export function girth(y: number): number {
  const { rx: a, rz: b } = section(y), h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}
/** the point on the torso's section at a height, round at angle `th` (0 the front, +x to the figure's left) */
export function around(y: number, th: number, out = 0): V3 {
  const { rx, rz, cz } = section(y);
  return [Math.sin(th) * (rx + out), y, cz + Math.cos(th) * (rz + out)];
}

export interface Capsule { a: V3; b: V3; ra: number; rb: number }
const L = (x: number, y: number, z: number): V3 => [x, y, z];
/**
 * How it stands. `twirl`: its arms up in a dancer's curve over its head, ready to twirl, clear of whatever it wears
 * below the waist. `dress`: its arms let down and out, 45° below the shoulders' line (as GarmentCode's bodies stand, so
 * a sleeve has an arm to hang on and an armhole room under it). It's a jointed artist's figure: the same wood either way.
 */
export type Pose = 'twirl' | 'dress';
/** the limbs and neck (capsules), the joints and head (balls), each side mirrored: rebuilt in place by `setPose` */
export const LIMBS: Capsule[] = [];
export const BALLS: Array<{ c: V3; r: number }> = [];
export const SHOULDERS: V3[] = [];
export let pose: Pose = 'twirl';
/** goes up whenever the figure's posed differently: whoever draws it knows to build it again */
export let poseVersion = 0;
/**
 * Where its joints are, each side (0 its right, at -x; 1 its left): the shoulder and hip are fixed in the torso; the
 * elbow, wrist and hand down an arm; the knee, ankle and the foot's two ends down a leg; and the head, on its neck.
 */
export interface Posed { sh: [V3, V3]; el: [V3, V3]; wr: [V3, V3]; hand: [V3, V3]; hp: [V3, V3]; kn: [V3, V3]; an: [V3, V3]; heel: [V3, V3]; toe: [V3, V3]; head: V3 }
const NECK: V3 = [0, 95, -0.4];
function preset(p: Pose): Posed {
  const P = { sh: [], el: [], wr: [], hand: [], hp: [], kn: [], an: [], heel: [], toe: [] } as unknown as Posed;
  for (const [k, s] of [[0, -1], [1, 1]] as const) {
    const sh = L(s * 15.6, 89.5, -0.6);
    let el: V3, wr: V3, hand: V3;
    if (p === 'twirl') { el = L(s * 26.5, 101.5, 1.2); wr = L(s * 15, 118.5, 2.4); hand = L(s * 11.8, 122, 2.8); }
    else {
      // (the upper arm 16.3 cm at 45° below the line of the shoulders; the forearm 20.6 cm, a little nearer upright)
      el = L(s * (15.6 + 11.5), 89.5 - 11.5, 0.2); wr = L(s * (27.1 + 13.2), 78 - 15.8, 1.4); hand = L(s * (40.3 + 2.5), 62.2 - 3.4, 1.8);
    }
    P.sh[k] = sh; P.el[k] = el; P.wr[k] = wr; P.hand[k] = hand;
    P.hp[k] = L(s * 6.6, 55, -0.2); P.kn[k] = L(s * 7, 30, 0.6); P.an[k] = L(s * 7, 6, -0.2);
    // (a foot: a short capsule forward)
    P.heel[k] = L(s * 7, 2.6, -1.5); P.toe[k] = L(s * 7.4, 2.6, 7);
  }
  P.head = L(0, 110, 0.4);
  return P;
}
let posed: Posed = preset('twirl');
/** a pose of one's own, for each of the two the figure's put in for what it wears (kept while it's worn) */
const own: Partial<Record<Pose, Posed>> = {};
const copyPosed = (P: Posed): Posed => JSON.parse(JSON.stringify(P));
function limbs() {
  LIMBS.length = 0; BALLS.length = 0; SHOULDERS.length = 0;
  const P = posed;
  for (const k of [0, 1]) {
    LIMBS.push({ a: P.sh[k], b: P.el[k], ra: 3.9, rb: 3.2 }, { a: P.el[k], b: P.wr[k], ra: 3.1, rb: 2.6 });
    BALLS.push({ c: P.sh[k], r: 4.6 }, { c: P.el[k], r: 3.5 }, { c: P.hand[k], r: 3.4 });
    LIMBS.push({ a: P.hp[k], b: P.kn[k], ra: 5.6, rb: 4.4 }, { a: P.kn[k], b: P.an[k], ra: 4.2, rb: 3.2 });
    BALLS.push({ c: P.kn[k], r: 4.6 }, { c: P.an[k], r: 3.4 });
    LIMBS.push({ a: P.heel[k], b: P.toe[k], ra: 2.8, rb: 2.4 });
    SHOULDERS.push(P.sh[k]);
  }
  // (the neck, from the shoulders up toward the head, however it's tilted)
  const h = P.head, d = [h[0] - NECK[0], h[1] - NECK[1], h[2] - NECK[2]], l = Math.hypot(d[0], d[1], d[2]) || 1;
  LIMBS.push({ a: NECK, b: [NECK[0] + (d[0] / l) * 6, NECK[1] + (d[1] / l) * 6, NECK[2] + (d[2] / l) * 6], ra: 3.8, rb: 3.6 });
  HEAD.c = h;
}
export const HEAD = { c: L(0, 110, 0.4) as V3, r: 9.6 };
/** the pelvis: a ball rounding off the torso's foot, between the legs */
export const PELVIS = { c: L(0, 52, -0.3) as V3, r: 11.4 };
/** the arm's capsules on one side (s = ±1): upper arm, forearm */
export const arm = (s: number): [Capsule, Capsule] => { const k = s < 0 ? 0 : 5; return [LIMBS[k], LIMBS[k + 1]]; };

// (the sections tabulated every millimetre, read without allocating)
const ST = new Float32Array(((TORSO_TOP - TORSO_FOOT) * 10 + 2) * 3), S3 = new Float32Array(3);
for (let k = 0; k * 3 < ST.length; k++) { const q = section(TORSO_FOOT + k / 10); ST[k * 3] = q.rx; ST[k * 3 + 1] = q.rz; ST[k * 3 + 2] = q.cz; }
function sec(y: number) {
  const x = Math.max(0, Math.min((TORSO_TOP - TORSO_FOOT) * 10, (y - TORSO_FOOT) * 10)), k = Math.min(Math.floor(x), (TORSO_TOP - TORSO_FOOT) * 10 - 1), f = x - k;
  for (let c = 0; c < 3; c++) S3[c] = ST[k * 3 + c] + (ST[k * 3 + 3 + c] - ST[k * 3 + c]) * f;
}
// ─── meeting it ─────────────────────────────────────────────────────────────────────────────────
// (flat arrays, read without allocating: a cloth asks this of every particle several times a frame)
let CAP = new Float32Array(0), SPH = new Float32Array(0);
/** the distance field's own copy of the shapes, as they're posed */
function field() {
  CAP = new Float32Array(LIMBS.length * 10);
  LIMBS.forEach((c, k) => {
    const ab = [c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]], ll = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    CAP.set([c.a[0], c.a[1], c.a[2], ab[0], ab[1], ab[2], ll, c.ra, c.rb, (Math.sqrt(ll) / 2 + Math.max(c.ra, c.rb)) ** 2], k * 10);
  });
  SPH = new Float32Array([...BALLS, HEAD, PELVIS].flatMap((b) => [b.c[0], b.c[1], b.c[2], b.r]));
  poseVersion++;
}
/** pose the figure for what it wears (arms up to twirl, down for a bodice), as it was last posed by hand for that, if
 * it was: the distance field and anything drawn from LIMBS follow */
export function setPose(p: Pose) {
  if (p === pose && LIMBS.length) return;
  pose = p; posed = copyPosed(own[p] ?? preset(p));
  limbs(); field();
}
/** the joints that can be taken hold of: each pivots at the one above it, and what's below it goes with it */
export type Grip = 'el' | 'hand' | 'kn' | 'an' | 'head';
export const GRIPS: ReadonlyArray<{ grip: Grip; side: 0 | 1 }> = [
  ...(['el', 'hand', 'kn', 'an'] as const).flatMap((grip) => [{ grip, side: 0 as const }, { grip, side: 1 as const }]), { grip: 'head', side: 0 },
];
/** where a joint is now (the figure's own frame) */
export const gripAt = (g: Grip, side: 0 | 1): V3 => (g === 'head' ? posed.head : posed[g][side]);
/** whether it's been posed by hand, for what it wears now */
export const posedByHand = () => !!own[pose];
/**
 * Turn a joint toward a point (the figure's own frame): its bone pivots where it joins the one above (an elbow at the
 * shoulder, a hand at the elbow, a knee at the hip, an ankle at the knee, the head on its neck), at most `step` radians
 * at a time, so the cloth on it has time to move with it. Nothing goes below the stand's top; the head only nods.
 */
export function bend(g: Grip, side: 0 | 1, to: V3, step = 0.06): boolean {
  const P = posed, k = side;
  const [pivot, moving]: [V3, V3[]] = g === 'el' ? [P.sh[k], [P.el[k], P.wr[k], P.hand[k]]] : g === 'hand' ? [P.el[k], [P.wr[k], P.hand[k]]]
    : g === 'kn' ? [P.hp[k], [P.kn[k], P.an[k], P.heel[k], P.toe[k]]] : g === 'an' ? [P.kn[k], [P.an[k], P.heel[k], P.toe[k]]] : [NECK, [P.head]];
  const q = g === 'head' ? P.head : P[g][k];
  const a = norm3([q[0] - pivot[0], q[1] - pivot[1], q[2] - pivot[2]]), b = norm3([to[0] - pivot[0], to[1] - pivot[1], to[2] - pivot[2]]);
  if (!a || !b) return false;
  let ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  if (ang < 1e-3) return false;
  let ax = norm3([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]);
  if (!ax) ax = [0, 0, 1];
  ang = Math.min(ang, step);
  const moved = moving.map((p) => rotAbout(p, pivot, ax!, ang));
  // (the head nods and turns, a little: no further than 40° off upright)
  if (g === 'head') { const h = norm3([moved[0][0] - NECK[0], moved[0][1] - NECK[1], moved[0][2] - NECK[2]])!; if (h[1] < Math.cos(0.7)) return false; }
  if (moved.some((p) => p[1] < 1.2)) return false;
  moving.forEach((p, i) => { p[0] = moved[i][0]; p[1] = moved[i][1]; p[2] = moved[i][2]; });
  own[pose] = copyPosed(P);
  limbs(); field();
  return true;
}
/** back to how it stands for what it wears */
export function unpose() { delete own[pose]; posed = preset(pose); limbs(); field(); }
/** a pose of one's own, to keep and to give back */
export const ownPoses = (): Partial<Record<Pose, Posed>> => JSON.parse(JSON.stringify(own));
export function restorePoses(o: Partial<Record<Pose, Posed>>) { for (const k of ['twirl', 'dress'] as const) { if (o[k]) own[k] = o[k]; else delete own[k]; } posed = copyPosed(own[pose] ?? preset(pose)); limbs(); field(); }
function norm3(v: number[]): V3 | null { const l = Math.hypot(v[0], v[1], v[2]); return l > 1e-9 ? [v[0] / l, v[1] / l, v[2] / l] : null; }
/** p turned about an axis through c by `ang` (Rodrigues) */
function rotAbout(p: V3, c: V3, k: V3, ang: number): V3 {
  const v = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], cs = Math.cos(ang), sn = Math.sin(ang), kd = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const x = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map((i) => c[i] + v[i] * cs + x[i] * sn + k[i] * kd * (1 - cs)) as V3;
}
/** the last answer: how far out of the body (negative inside), and which way's out */
export const hit = { d: 0, nx: 0, ny: 1, nz: 0 };
/** how far a point is from the body, into `hit` (and returned); only what's nearer than `near` is worked out exactly */
export function distance(px: number, py: number, pz: number, near = 1e9): number {
  hit.d = 1e9;
  // (the torso, between its foot and top: an ellipse's distance, near enough)
  if (py >= TORSO_FOOT && py <= TORSO_TOP) {
    // (k: how far out in the section's own scale, 1 on its surface; its gradient, up and down too, so where the torso
    // narrows (its shoulders' slope) the way out is upward and a garment rests on it)
    const kAt = (y: number) => { sec(y); const a = px / S3[0], b = (pz - S3[2]) / S3[1]; return Math.sqrt(a * a + b * b); };
    sec(py);
    const rx = S3[0], rz = S3[1], cz = S3[2], z = pz - cz, k = Math.sqrt((px / rx) ** 2 + (z / rz) ** 2);
    if (k > 1e-4) {
      const gx = px / (rx * rx * k), gz = z / (rz * rz * k), gy = (kAt(py + 0.4) - kAt(py - 0.4)) / 0.8, gl = Math.sqrt(gx * gx + gy * gy + gz * gz);
      hit.d = k > 0.5 ? (k - 1) / gl : (k - 1) * Math.min(rx, rz);
      hit.nx = gx / gl; hit.ny = gy / gl; hit.nz = gz / gl;
    } else { hit.d = -Math.min(rx, rz); hit.nx = 0; hit.ny = 0; hit.nz = 1; }
  }
  for (let o = 0; o < CAP.length; o += 10) {
    const qx = px - CAP[o], qy = py - CAP[o + 1], qz = pz - CAP[o + 2];
    const mx = qx - CAP[o + 3] / 2, my = qy - CAP[o + 4] / 2, mz = qz - CAP[o + 5] / 2;
    if (mx * mx + my * my + mz * mz > CAP[o + 9] + near * near + 2 * near * Math.sqrt(CAP[o + 9])) continue;
    const t = Math.max(0, Math.min(1, (qx * CAP[o + 3] + qy * CAP[o + 4] + qz * CAP[o + 5]) / CAP[o + 6]));
    const rx = qx - CAP[o + 3] * t, ry = qy - CAP[o + 4] * t, rz = qz - CAP[o + 5] * t, l = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1e-6;
    const d = l - (CAP[o + 7] + (CAP[o + 8] - CAP[o + 7]) * t);
    if (d < hit.d) { hit.d = d; hit.nx = rx / l; hit.ny = ry / l; hit.nz = rz / l; }
  }
  for (let o = 0; o < SPH.length; o += 4) {
    const qx = px - SPH[o], qy = py - SPH[o + 1], qz = pz - SPH[o + 2], l = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1e-6, d = l - SPH[o + 3];
    if (d < hit.d) { hit.d = d; hit.nx = qx / l; hit.ny = qy / l; hit.nz = qz / l; }
  }
  return hit.d;
}

/** a point resting on the top of the shoulders at `x` across (front or back of the seam), `out` clear of the body */
export function onShoulder(x: number, front: boolean, out: number): V3 {
  const z = -0.4 + (front ? 1.2 : -1.2);
  let y = 100;
  while (y > 80 && distance(x, y, z) > 0) y -= 0.1;
  return [x, y + out, z];
}

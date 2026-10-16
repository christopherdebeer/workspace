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
function limbs(p: Pose) {
  LIMBS.length = 0; BALLS.length = 0; SHOULDERS.length = 0;
  for (const s of [-1, 1]) {
    const sh = L(s * 15.6, 89.5, -0.6);
    let el: V3, wr: V3, hand: V3;
    if (p === 'twirl') { el = L(s * 26.5, 101.5, 1.2); wr = L(s * 15, 118.5, 2.4); hand = L(s * 11.8, 122, 2.8); }
    else {
      // (the upper arm 16.3 cm at 45° below the line of the shoulders; the forearm 20.6 cm, a little nearer upright)
      el = L(s * (15.6 + 11.5), 89.5 - 11.5, 0.2); wr = L(s * (27.1 + 13.2), 78 - 15.8, 1.4); hand = L(s * (40.3 + 2.5), 62.2 - 3.4, 1.8);
    }
    LIMBS.push({ a: sh, b: el, ra: 3.9, rb: 3.2 }, { a: el, b: wr, ra: 3.1, rb: 2.6 });
    BALLS.push({ c: sh, r: 4.6 }, { c: el, r: 3.5 }, { c: hand, r: 3.4 });
    const hp = L(s * 6.6, 55, -0.2), kn = L(s * 7, 30, 0.6), an = L(s * 7, 6, -0.2);
    LIMBS.push({ a: hp, b: kn, ra: 5.6, rb: 4.4 }, { a: kn, b: an, ra: 4.2, rb: 3.2 });
    BALLS.push({ c: kn, r: 4.6 }, { c: an, r: 3.4 });
    // (a foot: a short capsule forward)
    LIMBS.push({ a: L(s * 7, 2.6, -1.5), b: L(s * 7.4, 2.6, 7), ra: 2.8, rb: 2.4 });
    SHOULDERS.push(sh);
  }
  LIMBS.push({ a: L(0, 95, -0.4), b: L(0, 101, 0.2), ra: 3.8, rb: 3.6 });
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
/** pose the figure (its arms): the distance field and anything drawn from LIMBS follow */
export function setPose(p: Pose) {
  if (p === pose && LIMBS.length) return;
  pose = p; poseVersion++;
  limbs(p);
  CAP = new Float32Array(LIMBS.length * 10);
  LIMBS.forEach((c, k) => {
    const ab = [c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]], ll = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    CAP.set([c.a[0], c.a[1], c.a[2], ab[0], ab[1], ab[2], ll, c.ra, c.rb, (Math.sqrt(ll) / 2 + Math.max(c.ra, c.rb)) ** 2], k * 10);
  });
  SPH = new Float32Array([...BALLS, HEAD, PELVIS].flatMap((b) => [b.c[0], b.c[1], b.c[2], b.r]));
}
limbs('twirl'); pose = 'dress'; setPose('twirl'); poseVersion = 0;
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

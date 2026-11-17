/**
 * The backdrop composed (`backdrop=mass|painted`, an experiment after Astra's critique): not rings of procedurally
 * populated ranges but one landscape, as the original reference composes it. One massif, a regional landmark at a fixed
 * bearing (seen when the way turns toward it, hidden when it doesn't), built of a few unequal masses that overlap and
 * connect: its summit, a long shoulder stepping down toward the valley, a steeper flank and a subsidiary peak on the
 * other side; a ridge in front of the shoulder's foot; a dark foothill across the valley's mouth; between them the
 * valley floor with the river coming out of the gap toward you. Snow cuts into the body in a cap with gully tongues and a
 * band along the shoulder; shadow divides it into unequal planes (a wedge off the summit's spur, the shoulder's fall into
 * the valley). Each plane is drawn on its own and given its own stencil id, so `painted`'s passages are clipped to the
 * plane they describe and reach its edges; `mass` is the planes alone. Colours from the light (mood.ts).
 */
import type { Course } from './course';
import { M, Mesh } from './mesh';
import { NEVER } from './paint';

const F = -260;
/** the planes, in the order they're laid (back to front); each its own stencil id (1…) */
export type Plane = { id: number; name: string; verts: Float32Array; strokes: Float32Array; world?: boolean };

const ease = (t: number) => t * t * (3 - 2 * t);
/** a profile through control points (angle, height), eased between them, a touch of irregularity */
const profile = (pts: number[][], k: number) => (a: number) => {
  if (a <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) if (a <= pts[i + 1][0]) { const t = (a - pts[i][0]) / (pts[i + 1][0] - pts[i][0]); return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * ease(t) + 5 * Math.sin(a * 190 + k) + 3 * Math.sin(a * 470 + k); }
  return pts[pts.length - 1][1];
};
const gauss = (a: number, c: number, w: number) => Math.exp(-(((a - c) / w) ** 2));
/** a pointed tongue: deepest at its middle, tapering straight to nothing at w either side (a gully's V, not a U) */
const vee = (a: number, c: number, w: number) => Math.max(0, 1 - Math.abs(a - c) / w) ** 1.6;

/** (`aim`: the summit's bearing (rad, as atan2(x, z)) instead of its place right of the run's general way) */
export function buildMasses(c: Course, painted: boolean, aim?: number): Plane[] {
  const p0 = c.point(0, 0), p1 = c.point(3000, 0), ax = Math.atan2(p1.x - p0.x, p1.z - p0.z);
  const at = (R: number, a: number, y: number) => [Math.sin(a) * R, y, Math.cos(a) * R];
  const planes: { name: string; mesh: Mesh; strokes: number[] }[] = [];
  const plane = (name: string) => { const p = { name, mesh: new Mesh(true), strokes: [] as number[] }; planes.push(p); return p; };
  // (a region between two height curves over a span round the eye, as a strip of quads, one flat colour)
  const band = (p: { mesh: Mesh }, R: number, a0: number, a1: number, top: (a: number) => number, bot: (a: number) => number, mt: number, step = 0.004) => {
    for (let a = a0; a < a1; a += step) {
      const b = Math.min(a1, a + step), t0 = top(a), t1 = top(b), b0 = Math.min(t0, bot(a)), b1 = Math.min(t1, bot(b));
      if (t0 - b0 < 0.5 && t1 - b1 < 0.5) continue;
      p.mesh.quad(at(R, a, b0), at(R, b, b1), at(R, b, t1), at(R, a, t0), mt, 0.5);
    }
  };
  let seed = 11; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  // (a passage: one broad stroke from (a0, y0) to (a1, y1) on a plane at radius Rr, in a material's band; long, loaded)
  const pass = (p: { strokes: number[] }, Rr: number, a0: number, y0: number, a1: number, y1: number, W: number, mt: number, band: number, stamp: number) => {
    if (!painted) return;
    const A = at(Rr, a0, y0), B = at(Rr, a1, y1), d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(d[0], d[1], d[2]) || 1, am = (a0 + a1) / 2;
    const n = [-Math.sin(am), 0.3, -Math.cos(am)];
    p.strokes.push((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2, mt, d[0] / L, d[1] / L, d[2] / L, L * 1.1, n[0], n[1], n[2], W, R(), stamp, (R() - 0.5) * 0.1, 0, NEVER, 1 + band, 0, 1);
  };

  // ── the far band, low and pale, all round
  const far = plane('far');
  band(far, 3700, 0, Math.PI * 2 + 0.01, (a) => F + 70 + 40 * Math.sin(a * 3 + 1) + 25 * Math.sin(a * 7), () => F - 40, M.MASS_FAR, 0.01);
  // ── the valley floor
  const floor = plane('floor');
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, b = ((i + 1) / 48) * Math.PI * 2; floor.mesh.tri([0, F, 0], at(3600, a, F), at(3600, b, F), M.MASS_FLOOR, 0.5); }

  // the composition's angles: the summit right of the way, the valley's gap a little left of it
  const aS = aim ?? ax + 0.36, aV = aS - 0.48;
  // ── the massif: summit, the long stepped shoulder down to the valley, the steeper flank and a subsidiary peak beyond
  const crest = profile([[aV - 0.06, F - 10], [aV + 0.02, F + 140], [aS - 0.33, F + 640], [aS - 0.2, F + 730], [aS - 0.12, F + 900], [aS, F + 1360],
    [aS + 0.14, F + 860], [aS + 0.3, F + 600], [aS + 0.38, F + 700], [aS + 0.5, F + 420], [aS + 0.66, F + 220]], 3);
  const RM = 3000, mA0 = aV - 0.06, mA1 = aS + 0.66, top = crest(aS);
  const body = plane('body');
  band(body, RM, mA0, mA1, crest, () => F - 40, M.MASS_BODY);
  // (its lit planes: broad passages down the shoulder and the near flank; the lower body left quiet)
  pass(body, RM - 4, aS - 0.06, top - 280, aS - 0.33, F + 560, 170, M.MTN, 0, 7);
  pass(body, RM - 4, aS - 0.08, top - 360, aS - 0.3, F + 520, 110, M.MTN, 0, 0);
  pass(body, RM - 4, aS - 0.1, F + 760, aS - 0.34, F + 470, 120, M.MTN, 1, 0);
  pass(body, RM - 4, aS + 0.32, F + 610, aS + 0.5, F + 330, 140, M.MTN, 0, 7);
  // (the shoulder's fall into the valley and the summit's spur wedge: shadow dividing the body unequally)
  const shade = plane('shade');
  band(shade, RM - 1, mA0, aS - 0.33, crest, (a) => Math.max(F - 40, crest(a) - 90 - (aS - 0.33 - a) * 2600), M.MASS_SHADE, 0.003);
  const spur = (a: number) => top - ((a - aS) / 0.34) * (top - F - 120);
  band(shade, RM - 1, aS, aS + 0.3, crest, (a) => Math.max(spur(a), F - 40), M.MASS_SHADE, 0.003);
  pass(shade, RM - 5, aS + 0.01, top - 80, aS + 0.27, F + 300, 190, M.MTN, 3, 0);
  pass(shade, RM - 5, aS - 0.34, F + 600, aV + 0.03, F + 80, 140, M.MTN, 2, 7);
  // (snow: the cap with gully tongues cut down into the body, and a band along the shoulder's top)
  const depth = (a: number) => Math.max(
    300 * vee(a, aS, 0.16) + 380 * vee(a, aS - 0.06, 0.03) + 300 * vee(a, aS + 0.075, 0.025) + 200 * vee(a, aS + 0.19, 0.02) + 160 * vee(a, aS - 0.13, 0.02),
    110 * (a > aS - 0.33 && a < aS - 0.15 ? Math.min(1, (a - (aS - 0.33)) / 0.03, (aS - 0.15 - a) / 0.03) : 0),
    90 * gauss(a, aS + 0.38, 0.03));
  const snow = plane('snow');
  band(snow, RM - 2, mA0, mA1, crest, (a) => crest(a) - depth(a), M.MASS_SNOW, 0.002);
  pass(snow, RM - 6, aS - 0.002, top - 20, aS - 0.06, top - 600, 80, M.MTNSNOW, 0, 0);
  pass(snow, RM - 6, aS - 0.12, F + 880, aS + 0.02, top - 140, 120, M.MTNSNOW, 0, 11);
  pass(snow, RM - 6, aS - 0.32, F + 650, aS - 0.17, F + 715, 70, M.MTNSNOW, 1, 0);
  // (the snow in the spur's shadow, shaded)
  const snowsh = plane('snowsh');
  band(snowsh, RM - 3, aS, aS + 0.3, crest, (a) => Math.max(spur(a), crest(a) - depth(a)), M.MASS_SNOWSH, 0.002);
  pass(snowsh, RM - 7, aS + 0.01, top - 30, aS + 0.08, top - 520, 70, M.MTNSNOW, 2, 0);

  // ── the massif's lower slopes: an apron spreading from its foot down onto the valley floor, so its flanks descend into
  // the valley rather than standing on it; nearer, a step lighter (the slope turning up to the light), its top edge soft
  const RA = 2650, apronTop = profile([[mA0 + 0.03, F - 10], [aV + 0.06, F + 50], [aS - 0.2, F + 150], [aS + 0.1, F + 190], [aS + 0.4, F + 130], [mA1 - 0.02, F - 10]], 5);
  const apron = plane('apron');
  band(apron, RA, mA0 + 0.03, mA1 - 0.02, apronTop, () => F - 40, M.MASS_FLOOR);
  pass(apron, RA - 3, aS - 0.18, F + 120, aS + 0.3, F + 120, 60, M.MTN, 1, 11);
  // ── a ridge in front of the shoulder's foot, falling to the valley's gap
  const RR = 2300, ridgeTop = profile([[aV + 0.05, F - 10], [aV + 0.11, F + 160], [aS - 0.3, F + 330], [aS - 0.12, F + 380], [aS + 0.02, F + 210], [aS + 0.1, F - 10]], 7);
  const ridge = plane('ridge');
  band(ridge, RR, aV + 0.05, aS + 0.1, ridgeTop, () => F - 40, M.MASS_RIDGE);
  pass(ridge, RR - 3, aS - 0.12, F + 330, aV + 0.12, F + 90, 120, M.RIDGE, 0, 7);
  const ridgesh = plane('ridgesh');
  band(ridgesh, RR - 1, aV + 0.05, aV + 0.2, ridgeTop, (a) => Math.max(F - 40, ridgeTop(a) - (a - aV - 0.05) * 900 - 30), M.MASS_RIDGESH, 0.003);
  // ── a dark foothill across the valley's mouth on the other side
  const RF = 1700, footTop = profile([[aV - 0.9, F + 60], [aV - 0.55, F + 190], [aV - 0.3, F + 260], [aV - 0.14, F + 120], [aV - 0.07, F - 10]], 9);
  const foot = plane('foot');
  band(foot, RF, aV - 0.9, aV - 0.07, footTop, () => F - 40, M.MASS_RIDGESH);
  pass(foot, RF - 3, aV - 0.32, F + 230, aV - 0.1, F + 50, 90, M.RIDGE, 3, 0);
  // ── the river: out of the gap between ridge and foothill, winding toward you over the floor
  const river = plane('river');
  const rv: number[][] = [];
  for (let k = 0; k <= 20; k++) { const t = k / 20, a = aV - 0.01 - 0.11 * t + 0.03 * Math.sin(t * 7), r = 3300 - 2000 * t; rv.push([Math.sin(a) * r, F + 1, Math.cos(a) * r]); }
  for (let k = 0; k < rv.length - 1; k++) {
    const p = rv[k], q = rv[k + 1], dx = q[0] - p[0], dz = q[2] - p[2], L = Math.hypot(dx, dz), w = 9 + 16 * (k / 20), nx = (-dz / L) * w, nz = (dx / L) * w;
    river.mesh.quad([p[0] - nx, p[1], p[2] - nz], [p[0] + nx, p[1], p[2] + nz], [q[0] + nx, q[1], q[2] + nz], [q[0] - nx, q[1], q[2] - nz], M.MASS_RIVER, 0.5);
  }
  return planes.map((p, i) => ({ id: i + 1, name: p.name, verts: new Float32Array(p.mesh.v), strokes: new Float32Array(p.strokes) }));
}

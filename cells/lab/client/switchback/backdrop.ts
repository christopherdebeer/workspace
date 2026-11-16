/**
 * The backdrop composed (`backdrop=mass|painted`, an experiment after Astra's critique): not rings of procedurally
 * populated ranges but a composition, as the original reference has it: one dominant massif to the right of the way, a
 * subordinate ridge in front of its foot, and a deliberate opening on the other side where the valley floor runs off to
 * a low far band and the river makes one small incision. Each shape is a continuous flat body of colour (its edges a
 * little ragged, as a brush leaves them), with a few connected snow and shadow shapes: the mountain exists without its
 * marks. `mass` is those shapes alone; `painted` the same shapes with sparse brushwork only where it explains something
 * (along a crest, the snowline, the shadow's ridge, a couple of long pulls down the big planes). Drawn about the eye,
 * as the truly remote; nothing in the middle distance.
 */
import type { Course } from './course';
import { M, Mesh } from './mesh';
import { NEVER } from './paint';

const F = -260;
/** the masses' colours, flat (a mood isn't applied to the experiment) */
export const MASS_COLS: Record<number, string> = {
  [M.MASS_FAR]: '#7a97ee', [M.MASS_BODY]: '#3a63e6', [M.MASS_SHADE]: '#1a3ab4', [M.MASS_SNOW]: '#f4ece2', [M.MASS_SNOWSH]: '#7f95e4',
  [M.MASS_RIDGE]: '#2b48c4', [M.MASS_RIDGESH]: '#162f98', [M.MASS_FLOOR]: '#4a6ee6', [M.MASS_RIVER]: '#dfe6f4',
};
type Prof = { R: number; a0: number; a1: number; top: (a: number) => number };
const rag = (a: number, k: number) => (Math.sin(a * 211 + k) * 0.5 + Math.sin(a * 523 + k * 2.1) * 0.3 + Math.sin(a * 1301 + k * 0.7) * 0.2) * 4;

export function buildMasses(c: Course, painted: boolean) {
  const m = new Mesh(true), strokes: number[] = [];
  const p0 = c.point(0, 0), p1 = c.point(3000, 0), ax = Math.atan2(p1.x - p0.x, p1.z - p0.z);
  const at = (R: number, a: number, y: number) => [Math.sin(a) * R, y, Math.cos(a) * R];
  // (a region between two height curves over a span of the way round, as a strip of quads; flat colour)
  const band = (R: number, a0: number, a1: number, top: (a: number) => number, bot: (a: number) => number, mt: number, step = 0.004) => {
    for (let a = a0; a < a1; a += step) {
      const b = Math.min(a1, a + step), t0 = top(a), t1 = top(b), b0 = Math.min(t0, bot(a)), b1 = Math.min(t1, bot(b));
      if (t0 - b0 < 0.01 && t1 - b1 < 0.01) continue;
      m.quad(at(R, a, b0), at(R, b, b1), at(R, b, t1), at(R, a, t0), mt, 0.5);
    }
  };
  // ── the far band: low, pale, all round, quiet
  const farTop = (a: number) => F + 70 + 40 * Math.sin(a * 3 + 1) + 25 * Math.sin(a * 7) + 4 * rag(a, 1);
  band(3700, 0, Math.PI * 2 + 0.004, farTop, () => F - 40, M.MASS_FAR, 0.01);
  // ── the valley floor: one colour, the river one small incision across the opening
  for (let i = 0; i < 48; i++) { const a = (i / 48) * Math.PI * 2, b = ((i + 1) / 48) * Math.PI * 2; m.tri([0, F, 0], at(3600, a, F), at(3600, b, F), M.MASS_FLOOR, 0.5); }
  const rv: number[][] = [];
  for (let k = 0; k <= 24; k++) { const t = k / 24, a = ax - 0.75 + 0.5 * t + 0.08 * Math.sin(t * 9), r = 3300 - 2100 * t; rv.push([Math.sin(a) * r, F + 1, Math.cos(a) * r]); }
  for (let k = 0; k < rv.length - 1; k++) {
    const p = rv[k], q = rv[k + 1], dx = q[0] - p[0], dz = q[2] - p[2], L = Math.hypot(dx, dz), w = 10 + 18 * (k / 24), nx = (-dz / L) * w, nz = (dx / L) * w;
    m.quad([p[0] - nx, p[1], p[2] - nz], [p[0] + nx, p[1], p[2] + nz], [q[0] + nx, q[1], q[2] + nz], [q[0] - nx, q[1], q[2] - nz], M.MASS_RIVER, 0.5);
  }
  // ── the massif: right of the way, broad, one summit and two shoulders
  const a0 = ax - 0.02, M0: Prof = { R: 3000, a0: a0 - 0.05, a1: a0 + 1.05, top: (a) => {
    const d = a - (a0 + 0.38), s = d < 0 ? 0.34 : 0.55;
    let h = 1350 * Math.pow(Math.max(0, 1 - Math.abs(d) / s), 1.25);
    h = Math.max(h, 640 * Math.max(0, 1 - Math.abs(a - (a0 + 0.12)) / 0.2) ** 1.1, 520 * Math.max(0, 1 - Math.abs(a - (a0 + 0.78)) / 0.24) ** 1.2);
    return F + Math.max(0, h) + 6 * rag(a, 3);
  } };
  const sumA = a0 + 0.38, sumY = M0.top(sumA);
  band(M0.R, M0.a0, M0.a1, M0.top, () => F - 40, M.MASS_BODY);
  // (its snow: one connected shape down from the crest, deeper down the gullies, a tongue down the main face)
  const snowline = (a: number) => F + 820 - 160 * Math.max(0, 1 - Math.abs(a - (sumA - 0.08)) / 0.1) - 60 * Math.sin(a * 23) * 0.5 + 8 * rag(a, 5);
  band(M0.R - 1, M0.a0, M0.a1, M0.top, (a) => Math.max(snowline(a), M0.top(a) - 300), M.MASS_SNOW, 0.003);
  // (the shadow: the face right of the spur falling from the summit; the snow in it a shaded blue)
  const spur = (a: number) => sumY - ((a - sumA) / 0.42) * (sumY - F);
  band(M0.R - 2, sumA, M0.a1, M0.top, (a) => Math.max(spur(a), F - 40), M.MASS_SHADE, 0.003);
  band(M0.R - 3, sumA, M0.a1, M0.top, (a) => Math.max(spur(a), snowline(a), M0.top(a) - 300), M.MASS_SNOWSH, 0.003);
  // (a smaller shadow off the left shoulder)
  const shA = a0 + 0.12, shY = M0.top(shA), spur2 = (a: number) => shY - ((a - shA) / 0.14) * (shY - F - 200);
  band(M0.R - 2, shA, shA + 0.2, M0.top, (a) => Math.max(spur2(a), F + 200), M.MASS_SHADE, 0.003);
  // ── the subordinate ridge: nearer, lower, across the massif's foot to the right; its shaded side
  const R1 = 2300, r0 = ax + 0.45, ridgeTop = (a: number) => F + Math.max(0, 430 * Math.pow(Math.max(0, 1 - Math.abs(a - (r0 + 0.32)) / 0.45), 0.9) + 90 * Math.sin(a * 11)) + 5 * rag(a, 7);
  band(R1, r0 - 0.15, r0 + 0.85, ridgeTop, () => F - 40, M.MASS_RIDGE);
  const rpA = r0 + 0.32, rpY = ridgeTop(rpA), rspur = (a: number) => rpY - ((a - rpA) / 0.35) * (rpY - F);
  band(R1 - 1, rpA, r0 + 0.85, ridgeTop, (a) => Math.max(rspur(a), F - 40), M.MASS_RIDGESH, 0.003);

  if (painted) {
    // (sparse brushwork, only where it explains something; strokes in the masses' own colours, planned, far)
    let seed = 7; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const put = (Rr: number, a: number, y: number, T: number[], L: number, W: number, mt: number, band: number, stamp = 0) => {
      const p = at(Rr, a, y), n = [-Math.sin(a), 0.3, -Math.cos(a)];
      strokes.push(p[0], p[1], p[2], mt + 0.5, T[0], T[1], T[2], L, n[0], n[1], n[2], W, R(), stamp, (R() - 0.5) * 0.15, 0, NEVER, 1 + band, 0, 1);
    };
    const round = (a: number, dy: number, dr: number) => { const t = [Math.cos(a) * dr, dy, -Math.sin(a) * dr], l = Math.hypot(t[0], t[1], t[2]); return [t[0] / l, t[1] / l, t[2] / l]; };
    // (along the crests: breaking the edge, in the lit body or the snow)
    for (const [Rr, A0, A1, top, mt] of [[M0.R - 6, M0.a0 + 0.02, M0.a1 - 0.02, M0.top, M.MTNSNOW], [R1 - 4, r0 - 0.1, r0 + 0.8, ridgeTop, M.RIDGE]] as [number, number, number, (a: number) => number, number][])
      for (let a = A0; a < A1; a += 0.035 + R() * 0.03) { const y = top(a), dy = (top(a + 0.01) - y) / (0.01 * Rr); put(Rr, a, y + 4, round(a, dy, 1), 110 + R() * 80, 20, mt, a > sumA && mt === M.MTNSNOW ? 2 : 0, [0, 7][Math.floor(R() * 2)]); }
    // (the snowline: pulls down the gullies from the snow into the body)
    for (let a = M0.a0 + 0.05; a < M0.a1 - 0.05; a += 0.05 + R() * 0.04) { const y = Math.max(snowline(a), M0.top(a) - 300); if (y >= M0.top(a) - 20) continue; put(M0.R - 7, a, y - 40, [0, -1, 0], 110 + R() * 90, 22, M.MTNSNOW, a > sumA && y > spur(a) ? 2 : 0, 1); }
    // (the shadow's ridge: the spur from the summit, in the shade colour)
    for (let t = 0.05; t < 0.95; t += 0.09) { const a = sumA + 0.42 * t, y = spur(a); put(M0.R - 8, a, y, round(a, -(sumY - F) / (0.42 * M0.R), 1), 120, 18, M.MTN, 2, 0); }
    // (a few long pulls down the big planes)
    for (let i = 0; i < 9; i++) { const a = M0.a0 + 0.1 + R() * 0.8, y = F + 120 + R() * (M0.top(a) - F - 250); if (y > M0.top(a) - 200) continue; put(M0.R - 9, a, y, round(a, -1.4, a > sumA ? 1 : -1), 260 + R() * 160, 26, M.MTN, a > sumA && y > spur(a) ? 2 : 1, 7); }
  }
  return { verts: new Float32Array(m.v), strokes: new Float32Array(strokes) };
}

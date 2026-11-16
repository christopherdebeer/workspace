/**
 * The valley under the course as real ground (`mood=course`): a faceted height field in the world, built a stretch at a
 * time along the way, painted by the same strokes as the mountain's own ground, and drawn into the depth with it, so its
 * hills hide one another and the river as real ground does. From the road's drop side the ground falls to the river in
 * folded spurs and hollows, hills and wooded knolls among them; the river (paint.ts `riverAt`) runs in a little gorge
 * carved through it; beyond, the valley's far side rises again. Woods are planted on it where land would carry them (by
 * slope, height and a wandering forest edge). It's the ground the course will later come down into.
 */
import type { Course } from './course';
import { hash } from './course';
import { M, Mesh } from './mesh';
import { STROKE, NEVER, strokesOver, riverAt } from './paint';
import { grassiness } from './regions';

export const VSPAN = 240;
/** the valley's ground at station s, u out from the road: its height (world y), from the river's line */
export function valleyY(c: Course, s: number, u: number, x: number, z: number) {
  const r = riverAt(c, s), roadY = c.point(s, 0).y, sd = c.seed;
  const n = Math.sin(x / 170 + sd) * Math.sin(z / 140 - sd) * 0.6 + Math.sin((x + z) / 90 + sd * 2) * 0.3 + Math.sin((x - z) / 47 + sd) * 0.15;
  let y: number;
  if (u < r.u) {
    // (falling from just under the road's drop edge to the river, folded into spurs and hollows)
    const t = Math.max(0, Math.min(1, (r.u - u) / Math.max(60, r.u - 190)));
    y = r.y + (roadY - 55 - r.y) * Math.pow(t, 1.35) + (55 * Math.sin(s / 70 + sd) * t + n * 60 * (0.35 + t)) * Math.min(1, (r.u - u) / 120);
    // (always well under the road's drop edge, falling away from it: never standing up beside the road)
    y = Math.min(y, roadY - 60 - (u - 190) * 0.25);
  } else {
    // (beyond the river, rising again to the valley's far side)
    const t = Math.min(1, (u - r.u) / 900);
    y = r.y + 230 * Math.pow(t, 1.2) + n * 55 * (0.4 + t) * Math.min(1, (u - r.u) / 120);
  }
  // (the river's gorge: a channel carved down through the floor)
  const d = Math.abs(u - r.u);
  if (d < 70) y = Math.min(y, r.y + (d / 70) ** 2 * 26) - (d < 22 ? (1 - d / 22) * 9 : 0);
  return y;
}
/** a stretch of the valley: its faces (for the depth and the strokes) and its strokes (the ground's, the river's, the woods') */
export function valleyChunk(c: Course, k: number) {
  const s0 = k * VSPAN, s1 = s0 + VSPAN, m = new Mesh();
  // (the road over a long way either side: the valley's ground never comes within 170 m of it, and never stands above
  // it nearby: where the road doubles back below, a stretch further up the mountain's valley would otherwise stand over it)
  const road: number[][] = [];
  for (let s = Math.max(0, s0 - 3000); s < s1 + 3000; s += 15) { const p = c.point(s, 0); road.push([p.x, p.z, p.y, -Math.cos(p.heading), Math.sin(p.heading)]); }
  // (too near any road, or on the wall side of the nearest stretch of it: where the road doubles back, ground off one leg's
  // drop side lies up the mountainside of the other's)
  const near = (x: number, z: number) => {
    let best = Infinity, side = 1;
    for (const [rx, rz, , dx, dz] of road) { const d2 = (rx - x) ** 2 + (rz - z) ** 2; if (d2 < best) { best = d2; side = (x - rx) * dx + (z - rz) * dz; } }
    return best < 170 * 170 || side < 0;
  };
  const under = (x: number, y: number, z: number) => { for (const [rx, rz, ry] of road) { const d = Math.hypot(rx - x, rz - z); if (d < 600) y = Math.min(y, ry - 45 - (600 - d) * 0.05 + d * 0.35); } return y; };
  // (the grid in the way's own terms: stations along, out from the road across, broader further out)
  const us: number[] = []; for (let u = 190, i = 0; u < 2000; i++) { us.push(u); u += 26 * (1 + i * 0.05); }
  const rows: { p: number[]; ok: boolean }[][] = [];
  for (let s = s0; s <= s1; s += 20) {
    const r = riverAt(c, s), row: { p: number[]; ok: boolean }[] = [];
    for (const u of us) { if (u > r.u + 1000) break; const q = c.point(s, u); row.push({ p: [q.x, under(q.x, valleyY(c, s, u, q.x, q.z), q.z), q.z], ok: !near(q.x, q.z) }); }
    rows.push(row);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const A = rows[i], B = rows[i + 1], n = Math.min(A.length, B.length);
    for (let j = 0; j < n - 1; j++) {
      if (!A[j].ok || !A[j + 1].ok || !B[j].ok || !B[j + 1].ok) continue;
      const a = A[j].p, b = A[j + 1].p, cc = B[j + 1].p, d = B[j].p;
      if (hash(c.seed, k * 100 + i, j, 81) < 0.5) { m.slope(a, d, cc, M.SNOW, M.ROCK, 0.8); m.slope(a, cc, b, M.SNOW, M.ROCK, 0.8); } else { m.slope(a, d, b, M.SNOW, M.ROCK, 0.8); m.slope(b, d, cc, M.SNOW, M.ROCK, 0.8); }
    }
  }
  const verts = new Float32Array(m.v);
  // (the river's line, for the strokes: along it near it, across the slopes away from it; laid as the page opens, not by
  // the paint front)
  const line: number[] = [];
  for (let s = s0 - 20; s <= s1 + 20; s += 20) { const r = riverAt(c, s), p = c.point(s, r.u), q = c.point(s + 1, riverAt(c, s + 1).u), dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1; line.push(p.x, r.y, p.z, dx / l, dz / l, NEVER); }
  const ground = strokesOver(verts, c.seed * 503 + k, line, 30000, false, 0, false, 2);
  // (the river, and the woods, as strokes of their own)
  const out: number[] = [];
  let seed = c.seed * 977 + k * 31; const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const put = (p: number[], T: number[], L: number, n: number[], W: number, mt: number, stamp: number, kind: number, band: number) =>
    out.push(p[0], p[1], p[2], mt + 0.5, T[0], T[1], T[2], L, n[0], n[1], n[2], W, R(), stamp, (R() - 0.5) * 0.25, kind, NEVER, 10 + band, 0, 0);
  for (let s = s0; s < s1; s += 10) {
    const r = riverAt(c, s), r2 = riverAt(c, s + 10), p = c.point(s, r.u), q = c.point(s + 10, r2.u);
    if (near(p.x, p.z)) continue;
    const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1, T = [dx / l, (r2.y - r.y) / l, dz / l], side = [-T[2], 0, T[0]];
    for (let j = 0; j < 3; j++) put([p.x + side[0] * (R() - 0.5) * 16, r.y - 8.3, p.z + side[2] * (R() - 0.5) * 16], T, 18 + R() * 12, [0, 1, 0], 9 + R() * 4, M.WHITE, [0, 7][Math.floor(R() * 2)], 0, R() < 0.35 ? 0 : 1);
  }
  // (woods: clumps of crowns on a dark mass, where the land's grassy, not too steep, under the forest's wandering edge)
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < rows[i].length - 1; j++) {
    const A = rows[i][j], B = rows[i][j + 1];
    if (!A.ok || !B.ok) continue;
    const x = A.p[0] + (R() - 0.5) * 20, z = A.p[2] + (R() - 0.5) * 20, y = A.p[1], steep = Math.abs(B.p[1] - A.p[1]) / Math.max(1, Math.hypot(B.p[0] - A.p[0], B.p[2] - A.p[2]));
    const edge = Math.sin(x / 120 + c.seed) * Math.sin(z / 95 - c.seed * 1.3) + 0.4 * Math.sin((x + z) / 50);
    if (steep > 0.9 || grassiness(x, y, z) < 0.3 || edge < -0.1 || R() > 0.75) continue;
    const size = 9 + R() * 7, rr = c.point(s0 + ((i * 20) % VSPAN), 0), toward = [rr.x - x, 0, rr.z - z], tl = Math.hypot(toward[0], toward[2]) || 1, tw = [toward[0] / tl, 0, toward[2] / tl];
    put([x, y + size * 0.3, z], [tw[2], 0, -tw[0]], size * 3, tw, size * 1.3, M.BLACK, 11, 3, 3);
    for (let q = 0; q < 3; q++) { const h = size * (0.8 + R() * 0.5); put([x + (R() - 0.5) * size * 1.6, y + h * 0.55, z + (R() - 0.5) * size * 1.6], [0, 1, 0], h * 1.4, tw, h * 0.75, M.BLACK, [3, 2, 4][Math.floor(R() * 3)], 3, R() < 0.5 ? 3 : 2); }
    put([x - size * 0.3, y + size, z], [0, 1, 0], size * 0.7, tw, size * 0.5, M.BLACK, 3, 3, 1);
  }
  const strokes = new Float32Array(ground.length + out.length); strokes.set(ground); strokes.set(out, ground.length);
  void STROKE;
  return { verts, strokes };
}

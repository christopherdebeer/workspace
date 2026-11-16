/**
 * A regional middle distance (`valley=patch`, with `mood=course`; an experiment after Astra's brief), for one stretch of
 * seed 1's lower course (stations ~1700–2500, where the drop side opens). Not built by sweeping the road sideways: a height
 * field in the world round a valley axis of its own, running away diagonally ahead and to the drop side of the stretch
 * (where a phone's narrow view looks, as the rider rides it), the river along it at a height of its own falling gently
 * down the valley. Its ground by distance from the river: on the road's side falling to the river under the near
 * ground's brink (the near ground's own drop is about as steep as a descent to a nearer valley would be, so from the road
 * everything below that sightline is hidden), but for a spur that runs out from the near slope nearly level before it
 * drops, so it stands above the sightline and passes across the river as you ride; a hollow beside it where the ground
 * falls away, opening the view to the floor; beyond the river the opposite slope rising toward the far massif. Where the
 * field comes under the course's own ground it's held below the near ground's edge, so that edge sits over it (the seam).
 *
 * Opaque masses with real depth, two tones (lit or in shade by the sun); no trees, no decoration.
 */
import type { Course } from './course';
import { M, Mesh } from './mesh';
import { section } from './ground';

const S0 = 1650, S1 = 2550;
const g = (x: number, w: number) => Math.exp(-((x / w) ** 2));

export function buildPatch(c: Course) {
  const m = new Mesh(true);
  // (the course over the stretch and beyond: its points, and its near ground's outer edge, for the seam)
  const road: { x: number; z: number; y: number; ey: number; eu: number }[] = [];
  for (let s = S0 - 400; s <= S1 + 1400; s += 15) { const p = c.point(s, 0), sec = section(c, s), L = sec[sec.length - 1]; road.push({ x: p.x, z: p.z, y: p.y, ey: L.y, eu: L.u }); }
  // (the valley's frame: from near the stretch's end, ahead and out to the drop side)
  const sE = S1 - 150, pE = c.point(sE, 0), F = [Math.sin(pE.heading), Math.cos(pE.heading)], Rt = [-Math.cos(pE.heading), Math.sin(pE.heading)];
  const ax = [F[0] * 0.55 + Rt[0] * 0.84, F[1] * 0.55 + Rt[1] * 0.84], al = Math.hypot(ax[0], ax[1]); ax[0] /= al; ax[1] /= al;
  const O = [pE.x + Rt[0] * 850 + F[0] * 500, pE.z + Rt[1] * 850 + F[1] * 500], baseY = pE.y - 360;
  const across = [-ax[1], ax[0]];
  // (across points away from the road)
  if ((pE.x - O[0]) * across[0] + (pE.z - O[1]) * across[1] > 0) { across[0] = -across[0]; across[1] = -across[1]; }
  // (the river along the axis, bending; u along it)
  const bend = (u: number) => 120 * Math.sin(u / 420);
  const riverY = (u: number) => baseY - u * 0.06;
  const W = (u: number, v: number) => [O[0] + ax[0] * u + across[0] * (v + bend(u)), O[1] + ax[1] * u + across[1] * (v + bend(u))];
  // (the spur: a ridge from the near slope out toward the river, nearly level, falling gently as it runs out (v < 0))
  const uSpur = 380, spurTop = (v: number) => pE.y - 170 + v * 0.06;
  const height = (u: number, v: number, x: number, z: number) => {
    const fl = riverY(u);
    let h: number;
    if (v >= 0) h = fl + 3 + (230 + 90 * g(u - 900, 300)) * Math.pow(Math.min(1, v / 1200), 0.9);
    else {
      const fall = Math.min(fl + 3 + (-v) * 0.75, pE.y - 160), w = g(u - uSpur, 110 + (-v) * 0.12), spur = Math.min(spurTop(v), fl + 3 + (-v - 60) * 2.2);
      h = Math.max(fall * (1 - w) + Math.max(fall, spur) * w, fl + 3);
    }
    // (the seam: under the course's own ground, held below its near edge)
    let best = Infinity, nr = road[0];
    for (const r of road) { const d = (r.x - x) ** 2 + (r.z - z) ** 2; if (d < best) { best = d; nr = r; } }
    const d = Math.sqrt(best);
    if (d < nr.eu + 40) h = Math.min(h, nr.ey - 8 - (nr.eu + 40 - d) * 0.3);
    return h;
  };
  const U0 = -500, U1 = 2200, V0 = -900, V1 = 1300, NU = 54, NV = 44;
  const P: number[][][] = [];
  for (let i = 0; i <= NU; i++) {
    const row: number[][] = [], u = U0 + ((U1 - U0) * i) / NU;
    for (let j = 0; j <= NV; j++) { const v = V0 + ((V1 - V0) * j) / NV, [x, z] = W(u, v); row.push([x, height(u, v, x, z), z, v]); }
    P.push(row);
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = P[i][j], b = P[i][j + 1], cc = P[i + 1][j + 1], d = P[i + 1][j], v = (a[3] + cc[3]) / 2;
    const low = Math.max(a[1], b[1], cc[1], d[1]) < riverY(U0 + ((U1 - U0) * i) / NU) + 12;
    m.quad(a.slice(0, 3), b.slice(0, 3), cc.slice(0, 3), d.slice(0, 3), low ? M.PATCH_FLOOR : v >= 0 ? M.PATCH_FAR : M.PATCH_NEAR, 0.5);
  }
  // (the river: a pale band along the axis, a little over the floor)
  for (let i = 0; i < NU * 2; i++) {
    const ua = U0 + ((U1 - U0) * i) / (NU * 2), ub = U0 + ((U1 - U0) * (i + 1)) / (NU * 2), wd = 14 + 10 * (i / (NU * 2));
    const A0 = W(ua, -wd), A1 = W(ua, wd), B0 = W(ub, -wd), B1 = W(ub, wd);
    m.quad([A0[0], riverY(ua) + 5, A0[1]], [A1[0], riverY(ua) + 5, A1[1]], [B1[0], riverY(ub) + 5, B1[1]], [B0[0], riverY(ub) + 5, B0[1]], M.MASS_RIVER, 0.5);
  }
  return new Float32Array(m.v);
}

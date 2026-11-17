/**
 * Roof Jumps' plan, drawn into the city: each route a ribbon along where it goes, coloured by the move it's in, a ring
 * where each move begins. The primary is broad; the best to the left and to the right narrower; the rest of the fan
 * hairlines. (render.ts draws them, and still shows them, faint, behind what stands in front.)
 */
import type { Move, Reach } from './runner';
import type { Hold } from './city';
import type { Plan, Route } from './plan';
import type { Stroke } from './render';

export const MOVE_COLOUR: Record<Move, [number, number, number]> = {
  run: [0.16, 0.16, 0.18], dash: [0.98, 0.5, 0.1], ledge: [0.95, 0.95, 0.95], roll: [0.93, 0.35, 0.6],
  vault: [0.75, 0.9, 0.1], hop: [0.95, 0.8, 0.15], bound: [0.13, 0.42, 0.95], flip: [0.55, 0.3, 0.95], spring: [0.1, 0.68, 0.32],
  dive: [0.88, 0.16, 0.16], glide: [0.1, 0.72, 0.8], climb: [0.55, 0.38, 0.2], wallrun: [0.85, 0.15, 0.8],
};

function route(r: Route, w: number, alpha: number, rings: boolean, out: Stroke[]): void {
  const pts: number[] = [], cols: number[] = [], n = r.moves.length;
  for (let i = 0; i < n; i++) {
    const c = MOVE_COLOUR[r.moves[i]];
    // (a little off whatever it runs on, and fading toward its far end)
    pts.push(r.pts[i * 3], r.pts[i * 3 + 1] + 0.1, r.pts[i * 3 + 2]); cols.push(c[0], c[1], c[2], alpha * (1 - 0.6 * (i / n)));
  }
  out.push({ pts, cols, w });
  if (!rings) return;
  for (const l of r.legs.slice(1)) {
    const c = MOVE_COLOUR[l.move], ring: number[] = [], rc: number[] = [];
    for (let k = 0; k <= 10; k++) { const a = (k / 10) * 2 * Math.PI; ring.push(l.x + Math.cos(a) * 0.4, l.y + 0.1, l.z + Math.sin(a) * 0.4); rc.push(c[0], c[1], c[2], alpha); }
    out.push({ pts: ring, cols: rc, w: w * 0.6 });
  }
}

const HOLD_COLOUR = { edge: [0.2, 0.45, 0.9], rail: [0.95, 0.95, 0.95], sill: [0.1, 0.65, 0.3], pipe: [0.95, 0.5, 0.1] } as const;
/** The holds about a place, as lines; and what the hands are after, as a ring each. */
export function holdStrokes(holds: Hold[], reach: Reach, x: number, y: number, z: number, r: number): Stroke[] {
  const out: Stroke[] = [];
  for (const h of holds) {
    // (a little out from the wall it's on, so it's seen)
    const c = HOLD_COLOUR[h.kind], ox = h.nx * 0.04, oz = h.nz * 0.04;
    const a = Math.max(0, 1 - Math.hypot((h.ax + h.bx) / 2 - x, (h.ay + h.by) / 2 - y, (h.az + h.bz) / 2 - z) / r);
    if (a <= 0) continue;
    out.push({ pts: [h.ax + ox, h.ay + 0.02, h.az + oz, h.bx + ox, h.by + 0.02, h.bz + oz], cols: [c[0], c[1], c[2], a, c[0], c[1], c[2], a], w: h.kind === 'edge' ? 0.025 : 0.05 });
  }
  for (const p of [reach.hl, reach.hr]) {
    if (!p) continue;
    const ring: number[] = [], rc: number[] = [];
    for (let k = 0; k <= 8; k++) { const t = (k / 8) * 2 * Math.PI; ring.push(p[0] + Math.cos(t) * 0.12, p[1] + Math.sin(t) * 0.12, p[2] + Math.sin(t + 1) * 0.08); rc.push(0.95, 0.1, 0.1, 1); }
    out.push({ pts: ring, cols: rc, w: 0.04 });
  }
  return out;
}

export function planStrokes(p: Plan): Stroke[] {
  const out: Stroke[] = [];
  for (const r of p.all) if (r !== p.primary && r !== p.left && r !== p.right) route(r, 0.03, 0.35, false, out);
  if (p.left) route(p.left, 0.08, 0.8, true, out);
  if (p.right) route(p.right, 0.08, 0.8, true, out);
  route(p.primary, 0.16, 1, true, out);
  return out;
}

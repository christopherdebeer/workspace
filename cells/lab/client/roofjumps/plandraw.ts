/**
 * Roof Jumps' plan, drawn into the city: each route a ribbon along where it goes, coloured by the move it's in, a ring
 * where each move begins. The primary is broad; the best to the left and to the right narrower; the rest of the fan
 * hairlines. (render.ts draws them, and still shows them, faint, behind what stands in front.)
 */
import type { Move } from './runner';
import type { Plan, Route } from './plan';
import type { Stroke } from './render';

export const MOVE_COLOUR: Record<Move, [number, number, number]> = {
  run: [0.16, 0.16, 0.18], dash: [0.98, 0.5, 0.1], ledge: [0.95, 0.95, 0.95], roll: [0.93, 0.35, 0.6],
  hop: [0.95, 0.8, 0.15], bound: [0.13, 0.42, 0.95], flip: [0.55, 0.3, 0.95], spring: [0.1, 0.68, 0.32],
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

export function planStrokes(p: Plan): Stroke[] {
  const out: Stroke[] = [];
  for (const r of p.all) if (r !== p.primary && r !== p.left && r !== p.right) route(r, 0.03, 0.35, false, out);
  if (p.left) route(p.left, 0.08, 0.8, true, out);
  if (p.right) route(p.right, 0.08, 0.8, true, out);
  route(p.primary, 0.16, 1, true, out);
  return out;
}

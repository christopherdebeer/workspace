/**
 * Roof Jumps' planner: where a heading leads, further than the next jump.
 *
 * A route is the runner itself run on ahead: a copy of it, as it is this instant, stepped through the next few
 * seconds holding one direction, with every leap, wall and roll it would make on the way. Nothing is guessed: it is
 * the same code that will move the real one, so the route drawn is the route taken, for as long as the heading holds.
 *
 * A plan is a fan of those: the way asked (the primary), and ways to either side of it, each scored for how well it
 * goes (ground made, less what it costs: coming down to the street, climbing back up, time spent gliding; more for
 * walls and ledges). The best to the left and the best to the right are the alternatives: turn that much and that
 * one becomes the primary. `assist` leans the heading onto the best of the fan by itself.
 */
import type { Move, Runner } from './runner';
import { TUNE } from './tune';

export interface Leg { move: Move; from: number; x: number; y: number; z: number }
export interface Route {
  /** the direction held, and how far that is from the one asked (rad; positive is to the figure's right) */
  dx: number; dz: number; off: number;
  /** where it goes: x y z, a point a step; and the move it's in at each */
  pts: number[]; moves: Move[];
  /** each move as it begins: which, at which point, where */
  legs: Leg[];
  made: number; streets: number; score: number;
  /** how interesting it is, as a choreographer would judge it (see `interest`) */
  interest: number;
}

const STEP = 1 / 120, KEEP = 3;

/** One route: the runner run on, holding (dx, dz), for the horizon. */
export function foresee(r: Runner, dx: number, dz: number, off = 0): Route {
  const g = r.clone(), pts: number[] = [g.x, g.y, g.z], moves: Move[] = [g.move], legs: Leg[] = [{ move: g.move, from: 0, x: g.x, y: g.y, z: g.z }];
  // (held as hard as it's asked: a light press is foreseen as one; what it makes is measured along the way, at any press)
  const x0 = g.x, z0 = g.z, streets0 = g.streets, n = Math.round(TUNE.horizon / STEP), m = Math.hypot(dx, dz) || 1, ux = dx / m, uz = dz / m;
  let cost = 0, last = g.move;
  for (let i = 1; i <= n; i++) {
    g.step(STEP, { x: dx, z: dz, jump: false });
    if (g.state === 'climb') cost += TUNE.wClimb * STEP;
    else if (g.move === 'glide') cost += TUNE.wGlide * STEP;
    else if (g.move === 'wallrun' || g.move === 'ledge') cost -= TUNE.wFlow * STEP;
    if (g.move !== last) { last = g.move; legs.push({ move: last, from: pts.length / 3, x: g.x, y: g.y, z: g.z }); }
    if (i % KEEP === 0 || i === n) { pts.push(g.x, g.y, g.z); moves.push(g.move); }
  }
  const made = (g.x - x0) * ux + (g.z - z0) * uz, streets = g.streets - streets0;
  const interest = choreo(legs, r.recent, pts);
  return { dx, dz, off, pts, moves, legs, made, streets, interest, score: made - cost - TUNE.wStreet * streets + TUNE.wChoreo * interest };
}

/** what each move is worth to watch, before its novelty and its timing */
export const WORTH: Partial<Record<Move, number>> = { bound: 1, spring: 1.5, dive: 1.5, vault: 1.5, hop: 0.8, flip: 2, sideflip: 2, wallrun: 2, chimney: 2.2, kick: 1, hang: 1.6, climb: 1, underbar: 2.5, glide: 0.5, roll: 0.4, fall: -2.5 };

/**
 * A route as a choreographer would judge it: each event worth what it is to watch, less if it's one of the last few again
 * (a phrase repeated stops reading as a decision); spaced as a phrase is (an event too hard on the last is clutter, a long
 * stretch of nothing is dead air); more for going up and down than for staying level; a fall worth less than nothing.
 */
export function choreo(legs: Leg[], recent: Move[], pts: number[]): number {
  const seen = [...recent], t = (l: Leg) => l.from * KEEP * STEP;
  let v = 0, lastT = 0, lastY = legs[0]?.y ?? 0, rise = 0, lastBig = -9;
  for (const l of legs.slice(1)) {
    const w = WORTH[l.move];
    if (w === undefined) continue;
    const again = seen.slice(-4).filter((m) => m === l.move).length;
    const gap = t(l) - lastT;
    // (spacing: under half a second after the last, crowded; past two and a half, dead air before it)
    const spacing = gap < 0.5 ? 0.5 : gap > 2.5 ? 1 - Math.min(0.6, (gap - 2.5) * 0.3) : 1;
    // (a big event wants room after the last big one: a breath between them, not a pile-up)
    const big = w >= 1.5, room = big ? Math.min(1, 0.4 + Math.max(0, t(l) - lastBig) / 1.2) : 1; if (big) lastBig = t(l);
    v += w > 0 ? (w / (1 + 0.8 * again)) * spacing * room : w;
    rise += Math.abs(l.y - lastY); lastY = l.y; lastT = t(l); seen.push(l.move);
  }
  // (and the end of the horizon a long way after the last event: dead air)
  const end = (pts.length / 3) * KEEP * STEP; if (end - lastT > 2.5) v -= Math.min(1, (end - lastT - 2.5) * 0.4);
  return v + 0.15 * Math.min(10, rise);
}

export interface Plan { primary: Route; left: Route | null; right: Route | null; best: Route; all: Route[] }

/** The fan about (dx, dz): the way asked, the best either side, and the best of all. */
export function plan(r: Runner, dx: number, dz: number): Plan {
  const a = Math.atan2(dx, dz), n = Math.round(TUNE.fan), step = (TUNE.fanStep * Math.PI) / 180, all: Route[] = [];
  // (to the figure's right is toward -x of its own axes: a smaller angle here)
  // (the others at the same press as the way asked)
  const m = Math.min(1, Math.hypot(dx, dz));
  for (let k = -n; k <= n; k++) all.push(k ? foresee(r, m * Math.sin(a - k * step), m * Math.cos(a - k * step), k * step) : foresee(r, dx, dz));
  const primary = all[n];
  const pick = (rs: Route[]) => rs.reduce<Route | null>((b, x) => (!b || x.score > b.score ? x : b), null);
  const left = pick(all.slice(0, n)), right = pick(all.slice(n + 1));
  // (the way asked wins a tie, and a little more than a tie: no flickering between two as good as each other)
  let best = primary;
  for (const x of all) if (x.score > best.score + (best === primary ? 1.5 : 0)) best = x;
  return { primary, left, right, best, all };
}

/** a route in a few words: its moves in order (the running between them left out), the first `most` of them */
export function words(r: Route, most = 6): string {
  const out: string[] = [];
  for (const l of r.legs.slice(1)) if (l.move !== 'run' && out[out.length - 1] !== l.move) out.push(l.move);
  return (out.length ? out.slice(0, most).join(' › ') : 'run') + (out.length > most ? ' …' : '');
}

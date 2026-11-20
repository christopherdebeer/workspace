/**
 * Roof Jumps' director: any seed made into a scene. It orients (where it is, what's round it), simulates (the runner run on
 * ahead down a fan of headings, the same code that will move it), and directs: a waypoint where the most interesting way
 * leads, judged as a choreographer would (plan.ts `choreo`: what's good to watch, novel, well spaced, up and down) and as a
 * route-finder would (ground made, no dropping to the street, no going back over the same ground). Then it executes, steering
 * toward its waypoints as a player would (`follow`, no shortcuts), and measures what came of it (`measure`).
 *
 * Deterministic: the same seed directs the same waypoints, and the same waypoints, followed, run the same run, here or on the
 * page (`?direct=x,z;x,z…`): a seed is an eval of what the body chooses and how it does it.
 */
import { City } from './city';
import { Runner } from './runner';
import type { Input, Move } from './runner';
import { foresee, choreo, WORTH } from './plan';
import { Rig } from './rig';
import { point } from './m4';
import type { Leg } from './plan';

/** a direction held (heading, rad) for so long (s), as a player would hold the stick; and where the director expected it
 * to lead (x, z), for drawing and reading */
export type Waypoint = [number, number, number, number];
/** where it's got to in its waypoints */
export interface Follow { i: number; t: number }

/** Hold the waypoint's direction for its time, then the next's: exactly what the director foresaw. */
export function follow(r: Runner, wps: Waypoint[], f: Follow, dt: number): Input {
  while (f.i < wps.length - 1 && f.t >= wps[f.i][3]) { f.t -= wps[f.i][3]; f.i++; }
  f.t += dt;
  const a = wps[Math.min(f.i, wps.length - 1)][2];
  void r; return { x: Math.sin(a), z: Math.cos(a), jump: false };
}

export interface Directed { seed: number; waypoints: Waypoint[]; seconds: number }

/** Direct a seed: a waypoint at a time, the next chosen when it's near the last, from the fan's most interesting way. */
/** how the director judges: the worth of what's good to watch, of ground made, of a turn away from the line it's on (per
 * radian past 45°), and how often it decides */
export const DIRECTOR = { wChoreo: 1.5, wMade: 0.12, wTurn: 0, every: 1.5 };
export function direct(seed: number, seconds = 40, wChoreo = DIRECTOR.wChoreo, every = DIRECTOR.every): Directed {
  const r = new Runner(new City(seed)), wps: Waypoint[] = [], f: Follow = { i: 0, t: 0 }, seen = new Set<string>(), DT = 1 / 120;
  const cell = (x: number, z: number) => `${Math.floor(x / 6)},${Math.floor(z / 6)}`;
  const choose = () => {
    let best: { score: number; to: Waypoint } | null = null;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 2 * Math.PI, route = foresee(r, Math.sin(a), Math.cos(a)), n = route.pts.length / 3;
      let again = 0; for (let i = 0; i < n; i += 4) if (seen.has(cell(route.pts[i * 3], route.pts[i * 3 + 2]))) again++;
      const ex = route.pts[(n - 1) * 3], ez = route.pts[(n - 1) * 3 + 2], made = Math.hypot(ex - r.x, ez - r.z);
      let turn = 0; if (wps.length) { let d = a - wps[wps.length - 1][2]; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; turn = Math.max(0, Math.abs(d) - Math.PI / 4); }
      const score = wChoreo * route.interest + DIRECTOR.wMade * made - 3 * route.streets - 4 * (again / Math.ceil(n / 4)) - (made < 3 ? 2 : 0) - DIRECTOR.wTurn * turn;
      if (!best || score > best.score) best = { score, to: [Math.round(ex * 10) / 10, Math.round(ez * 10) / 10, a, every] };
    }
    wps.push(best!.to);
  };
  // (a decision every `every` seconds: the direction it'll hold until the next)
  const per = Math.round(every / DT);
  for (let i = 0; i < seconds / DT; i++) {
    if (i % 12 === 0) seen.add(cell(r.x, r.z));
    if (i % per === 0) choose();
    r.step(DT, follow(r, wps, f, DT));
  }
  return { seed, waypoints: wps, seconds };
}

export interface Event { t: number; move: Move; y: number; worth: number }
export interface Measure {
  seed: number; seconds: number; distance: number; pace: number; leaps: number; events: number; distinct: number; entropy: number;
  repeats: number; longestRepeat: number; meanGap: number; deadAir: number; saves: number; misses: number; falls: number;
  stall: number; inside: number; landings: number; saveRate: number;
  /** the body: frames a joint jumped (more than 0.25 rad in a frame), a planted foot slid (cm a second), head or hips in a
   * wall, a hand or foot deep in one; the rhythm: the share of big events crowded on the last big one (under 0.7 s) */
  pops: number; slide: number; stretch: number; offFoot: number; bodyIn: number; limbIn: number; crowded: number; heightRange: number; interest: number; perMinute: number; score: number; timeline: Event[];
}

/** Run a directed seed, and measure it. */
export function measure(d: Directed): Measure {
  const city = new City(d.seed), r = new Runner(city), f: Follow = { i: 0, t: 0 }, DT = 1 / 120;
  const legs: Leg[] = [{ move: r.move, from: 0, x: r.x, y: r.y, z: r.z }], pts: number[] = [];
  let last = r.move, stall = 0, inside = 0, lo = r.y, hi = r.y, frames = 0, landings = 0, pops = 0, slid = 0, planted = 0, held2 = 0, stretched = 0, ups = 0, bodyIn = 0, limbIn = 0;
  const rig = new Rig(); rig.update(1, r); let pm = r.move, prev = { ...rig.target(r) }, feet: (number[] | null)[] = [null, null]; const ff: number[][] = [[0, 0, 0], [0, 0, 0]], held = [0, 0];
  const deep = (p: number[]) => [[0, 0], [0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1]].every(([a, b]) => city.heightAt(p[0] + a, p[2] + b) > p[1] + 0.05);
  for (let i = 0; i < d.seconds / DT; i++) {
    const was = r.state; r.step(DT, follow(r, d.waypoints, f, DT)); frames++; if (was !== 'ground' && r.state === 'ground') landings++;
    // (a takeoff off the ground: went off a run-up's planted foot, or not)
    if (was === 'ground' && r.state === 'air' && r.vy > 0) ups++;
    // (a snap: the pose asked for jumping more than 0.3 rad in a frame within one move (between moves the joints' springs
    // carry it; within one, a jump is a discontinuity in how a move is drawn))
    const tgt = rig.target(r) as unknown as Record<string, number>, pv = prev as unknown as Record<string, number>;
    if (pm === r.move && Object.keys(tgt).some((k) => Math.abs(tgt[k] - pv[k]) > 0.3)) pops++;
    prev = tgt as unknown as typeof prev; pm = r.move;
    rig.update(DT, r);
    const bones = rig.bones(r), at = (n: string, y = 0) => { const b = bones.find((o) => o.name === n)!; return point(b.m, 0, y, 0); };
    // (a planted foot: where its bone is, frame to frame, while the footfall stays the same)
    for (const [i, key] of [[0, 'fl'], [1, 'fr']] as const) {
      const now = r.reach[key], fb = bones.find((o) => o.name === (i ? 'footR' : 'footL'))!, p = point(fb.m, 0, -0.07, 0.13); // (the ball of the foot, on the ground under the sole: the heel lifts about it)
      // (once it has settled: past the few frames a footfall takes to be taken up)
      if (now && feet[i] && now[0] === feet[i]![0] && now[2] === feet[i]![2] && !(i ? rig.soles.R : rig.soles.L).lost) { held[i]++; if (held[i] > 4) { slid += Math.hypot(p[0] - ff[i][0], p[2] - ff[i][2]); planted++; } } else held[i] = 0;
      ff[i] = p; feet[i] = now ? [...now] : null;
      // (a stretch: a foot the rig is holding to its footfall that the leg can't reach, so the leg's pulled out straight and
      // the foot short of where it stands)
      const sole = i ? rig.soles.R : rig.soles.L;
      if (now && sole.w > 0.9 && !sole.lost) { held2++; const hp = at(i ? 'thighR' : 'thighL'), on = rig.on; if (Math.hypot(now[0] + on[0] * 0.07 - hp[0], now[1] + on[1] * 0.07 - hp[1], now[2] + on[2] * 0.07 - hp[2]) > 0.9) stretched++; }
    }
    if (deep(at('head', 0.12)) || deep(at('pelvis'))) bodyIn++;
    if (r.state !== 'climb' && r.state !== 'plant' && [at('foreArmL', -0.31), at('foreArmR', -0.31), at('footL'), at('footR')].some(deep)) limbIn++;
    if (i % 3 === 0) pts.push(r.x, r.y, r.z);
    if (r.move !== last) { last = r.move; legs.push({ move: last, from: pts.length / 3, x: r.x, y: r.y, z: r.z }); }
    if (r.state === 'ground' && r.speed < 1) stall += DT;
    if (r.state === 'ground' || r.state === 'air') { for (let j = 0; j < 8; j++) { const a = (j / 8) * 2 * Math.PI; if (city.heightAt(r.x + Math.cos(a) * 0.22, r.z + Math.sin(a) * 0.22) > r.y + 1) { inside++; break; } } }
    lo = Math.min(lo, r.y); hi = Math.max(hi, r.y);
  }
  const timeline: Event[] = []; const seen: Move[] = [];
  for (const l of legs.slice(1)) { const w = WORTH[l.move]; if (w === undefined) continue; const again = seen.slice(-4).filter((m) => m === l.move).length; timeline.push({ t: (l.from * 3) / 120, move: l.move, y: l.y, worth: w > 0 ? w / (1 + 0.8 * again) : w }); seen.push(l.move); }
  const counts: Record<string, number> = {}; for (const e of timeline) counts[e.move] = (counts[e.move] ?? 0) + 1;
  const n = timeline.length, entropy = -Object.values(counts).reduce((s, c) => s + (c / n) * Math.log2(c / n), 0) || 0;
  let repeats = 0, run = 1, longest = 1; for (let i = 1; i < n; i++) { if (timeline[i].move === timeline[i - 1].move) { repeats++; run++; longest = Math.max(longest, run); } else run = 1; }
  const gaps = timeline.map((e, i) => e.t - (i ? timeline[i - 1].t : 0)); gaps.push(d.seconds - (n ? timeline[n - 1].t : 0));
  const interest = choreo(legs, [], pts), minutes = d.seconds / 60;
  const m = { seed: d.seed, seconds: d.seconds, distance: r.dist, pace: r.dist / d.seconds, leaps: r.leaps, events: n, distinct: Object.keys(counts).length, entropy,
    repeats, longestRepeat: longest, meanGap: gaps.reduce((a, b) => a + b, 0) / gaps.length, deadAir: Math.max(...gaps), saves: r.saves, misses: r.misses, falls: r.made.fall ?? 0,
    stall, inside: inside / frames, landings, saveRate: r.saves / Math.max(1, landings),
    pops: pops / frames, slide: (100 * slid) / Math.max(1, planted * DT), stretch: stretched / Math.max(1, held2), offFoot: r.offFoot / Math.max(1, ups), bodyIn: bodyIn / frames, limbIn: limbIn / frames, crowded: 0, heightRange: hi - lo, interest, perMinute: interest / minutes, score: 0, timeline };
  // (big events (worth 1.5 or more) crowded on the last big one, under 0.7 s: busy, not phrased)
  { let lastBig = -9, big = 0, crowd = 0; for (const e of timeline) if ((WORTH[e.move] ?? 0) >= 1.5) { big++; if (e.t - lastBig < 0.7) crowd++; lastBig = e.t; } m.crowded = crowd / Math.max(1, big); }
  // (one number to climb: what's good to watch a minute, with variety, less what went wrong)
  m.score = m.perMinute + 3 * m.entropy - 1.5 * (m.repeats / minutes) - 2 * (m.misses / minutes) - 0.5 * m.stall - 0.3 * Math.max(0, m.deadAir - 3) - 20 * m.inside - 60 * Math.max(0, m.saveRate - 0.12) - 20 * m.crowded - 200 * m.pops - 40 * m.stretch - 100 * m.bodyIn - 30 * m.limbIn;
  // (and quiet: most landings shouldn't need saving, so a save means something)
  return m;
}

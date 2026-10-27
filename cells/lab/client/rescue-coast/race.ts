/**
 * Two ways to play, one set of rules underneath.
 *
 * - **The Rally** is the race as Lily wrote it: five lifeboats; little people in little boats; go near enough and they
 *   come on to your boat; get as many as you can and reach the finish; the winner rescued the most, 1st to 5th. (A
 *   training day, so racing is fair.)
 * - **The Rescue Service** is the same five crews on a real shout, working together: everyone home safe. They set out
 *   from the harbour; the calls come in as the day goes on (near the harbour first, then along the coast, then out at
 *   sea). A crew going for a little boat claims it, and the others leave it to them (you can take it over if you're
 *   plainly nearer: they'll say so). A lifeboat holds `CAP`: full, it takes them home, and they step ashore in the
 *   harbour (safe ashore), and it goes back out; there's no last call; it's over when every call's been answered,
 *   everyone is ashore and every lifeboat is in. Lily's 1st to 5th is still there at the end, as the crews' honours.
 *   And the sea matters here: holding steady alongside in open water is harder than in the lee of a headland, or with
 *   the little boat in the lee of your own hull, so people climb across more slowly (never failing, just slower); a
 *   stopped lifeboat drifts a little the way the swell runs. The search area ends a little inside the chart's edge.
 *
 * How "near enough" works here: come alongside and ease off. When a little boat is close by your side and you're
 * going slowly, your crew throws a line, the little boat is pulled in against your hull, and its people climb
 * aboard one at a time. Drive off before they're all across and the rest wait for the next lifeboat.
 *
 * Pure: no page, no drawing. Everything from the seed and the inputs, so a race can be run and tested headless.
 */
import { seeded, hash, type Rand } from '../kit/rng';
import { CLEAR, EDGE, GATE_HALF, GATE_Z, NAV, NNX, NNZ, X0, X1, Z0, navIndex, seaAt, seaward, shoreAt, type Coast, type Craft } from './coast';
import { SEA, SWELL } from './waves';
import { seaOf, type Leg } from './weather';

export const BOATS = [
  // (Lily's boats, as she named them)
  { name: 'Puffin', colour: [1.0, 0.42, 0.05] },
  { name: 'Dolphin', colour: [0.13, 0.42, 0.93] },
  { name: 'Turtle', colour: [0.13, 0.64, 0.3] },
  { name: 'Sunfish', colour: [1.0, 0.78, 0.08] },
  { name: 'Starfish', colour: [0.62, 0.3, 0.86] },
] as const;
export type Level = 'easy' | 'medium' | 'hard';
export type Mode = 'service' | 'rally';
export const LEVELS: Record<Level, { ai: number; slow: number; assist: number; call: number; keep: boolean; dither: number }> = {
  easy: { ai: 0.8, slow: 5.2, assist: 1, call: 60, keep: true, dither: 0.4 },
  medium: { ai: 0.88, slow: 4.2, assist: 0.6, call: 45, keep: true, dither: 0.2 },
  hard: { ai: 0.97, slow: 3.4, assist: 0, call: 35, keep: false, dither: 0.05 },
};
/** top speed (m/s), the hull's half length and half beam */
export const VMAX = 12, HALF_LEN = 5.4, HALF_BEAM = 2.1;
/** alongside: the little boat within this of your side; the line's throw; each climb */
export const GAP = 3.4, LINE = 0.6, CLIMB = 0.95;
/** (the Service) how many a lifeboat takes aboard before it must take them home; each one stepping ashore; inside the
 * harbour (past the mouth by this much) */
export const CAP = 6, LAND = 0.45, INSIDE = GATE_Z + 30;

export interface Input { steer?: number; throttle?: number }
export interface Boat {
  id: number; x: number; z: number; h: number; v: number; turn: number;
  /** how many it's taken aboard (all day); who's aboard now; (the Service) how many it's landed safe ashore */
  rescued: number; aboard: { craft: number; person: number }[]; safe: number; landT: number;
  /** (the Service) in for the day: when everyone's been rescued, and it's in the harbour with no one aboard */
  finished: number | null; home: boolean; bump: number; stuck: number; backing: number;
  /** how fast it's really getting anywhere (smoothed): pinned against something, this falls though the engine's going */
  real: number;
  ai: { target: number; side: number; think: number; lane: number } | null;
}
export interface Rescue {
  craft: Craft; x: number; z: number; yaw: number;
  left: number; by: number; stage: 'wait' | 'line' | 'climb' | 'done'; t: number; away: number; side: number;
  /** (the Service) the crew going for it, or -1; how steady the lifeboat alongside is (0..1), and how far the little boat
   * lies in its lee (0..1); whether its call has come in (until then it isn't there) */
  claim: number; steady: number; lee: number; called: boolean;
}
export type Ev =
  | { kind: 'go' } | { kind: 'line' | 'clear' | 'letgo'; boat: number; craft: number }
  | { kind: 'aboard'; boat: number; craft: number; person: number }
  | { kind: 'bump'; boat: number; hard: number } | { kind: 'finish'; boat: number; place: number }
  | { kind: 'lastcall'; length: number } | { kind: 'over' }
  | { kind: 'yield'; boat: number; craft: number; to: number } | { kind: 'allaboard' }
  | { kind: 'call'; craft: number } | { kind: 'full' | 'edge'; boat: number } | { kind: 'ashore'; boat: number; craft: number; person: number };
export interface Race {
  coast: Coast; mode: Mode; level: Level; mine: number; auto: boolean;
  boats: Boat[]; crafts: Rescue[];
  t: number; phase: 'ready' | 'countdown' | 'racing' | 'over'; count: number;
  lastCall: { start: number; length: number } | null;
  events: Ev[]; rand: Rand; flows: Map<string, Float32Array>; finishers: number;
  /** (the Service) who's stepped ashore in the harbour, in order */
  ashore: { boat: number; craft: number; person: number }[];
  /** (the Service) the day's weather, if it changes: the sea follows it */
  sky: Leg[] | null;
}

export function newRace(coast: Coast, opts: { mode?: Mode; level?: Level; mine?: number; auto?: boolean; sky?: Leg[] } = {}): Race {
  const mode = opts.mode ?? 'rally', level = opts.level ?? 'easy', mine = opts.mine ?? 0, auto = !!opts.auto;
  const boats: Boat[] = coast.starts.map((s, id) => ({
    id, x: s.x, z: s.z, h: s.h, v: 0, turn: 0, rescued: 0, aboard: [], safe: 0, landT: 0, finished: null, home: false, bump: 0, stuck: 0, backing: 0, real: 0,
    ai: id === mine && !auto ? null : { target: -2, side: 1, think: 0, lane: (id - 2) * 0.45 },
  }));
  const crafts: Rescue[] = coast.crafts.map((c) => ({ craft: c, x: c.x, z: c.z, yaw: c.yaw, left: c.people.length, by: -1, stage: 'wait', t: 0, away: 0, side: 1, claim: -1, steady: 1, lee: 0, called: mode === 'rally' || c.at <= 0 }));
  return { coast, mode, level, mine, auto, boats, crafts, t: 0, phase: 'ready', count: 0, lastCall: null, events: [], rand: seeded(hash(coast.seed, 77)), flows: new Map(), finishers: 0, ashore: [], sky: opts.sky ?? null };
}
export function start(r: Race) { r.phase = 'countdown'; r.count = 3; }

const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const ss = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** a point's place relative to a boat: [across (to its right), along (ahead)] */
export function local(b: { x: number; z: number; h: number }, x: number, z: number): [number, number] {
  const dx = x - b.x, dz = z - b.z, s = Math.sin(b.h), c = Math.cos(b.h);
  return [-dx * c + dz * s, dx * s + dz * c];
}
/** from a boat's frame back to the world */
export function world(b: { x: number; z: number; h: number }, across: number, along: number): [number, number] {
  const s = Math.sin(b.h), c = Math.cos(b.h);
  return [b.x - across * c + along * s, b.z + across * s + along * c];
}

const STEP = 1 / 60;
export function step(r: Race, dt: number, input: Input = {}) {
  let left = Math.min(dt, 0.25);
  while (left > 1e-6) { const h = Math.min(STEP, left); tick(r, h, input); left -= h; }
}
export function runFor(r: Race, seconds: number, input: Input = {}) {
  for (let t = 0; t < seconds && r.phase !== 'over'; t += STEP) tick(r, STEP, input);
}

function tick(r: Race, dt: number, input: Input) {
  if (r.phase === 'countdown') {
    r.count -= dt;
    if (r.count <= 0) { r.phase = 'racing'; r.events.push({ kind: 'go' }); }
    return;
  }
  if (r.phase !== 'racing') return;
  r.t += dt;
  const L = LEVELS[r.level], was = r.boats.map((b) => [b.x, b.z]), service = r.mode === 'service';
  if (r.sky) [SEA.height, SEA.chop] = seaOf(r.sky, r.t);
  if (service) callIn(r);
  for (const b of r.boats) {
    let ctl: Required<Input>;
    if (b.finished !== null) ctl = homeward(r, b);
    else if (b.ai) ctl = think(r, b, dt);
    else ctl = { steer: clamp(input.steer ?? 0, -1, 1), throttle: clamp(input.throttle ?? 0, -1, 1) };
    // (how fast it may go: the level's pace for the game's boats; a gentle hand on the throttle near a little boat for yours)
    let vmax = VMAX;
    if (b.ai && b.finished === null) vmax *= L.ai * keepWith(r, b);
    if (!b.ai && L.assist > 0 && b.finished === null && !(service && b.aboard.length >= CAP)) {
      let near = 1e9;
      for (const c of r.crafts) if (c.stage === 'wait' && c.left > 0 && c.called) {
        const [, along] = local(b, c.x, c.z), d = Math.hypot(c.x - b.x, c.z - b.z);
        if (along > -4 && d < near) near = d;
      }
      vmax -= (vmax - L.slow * 0.8) * L.assist * (1 - ss(7, 19, near));
    }
    const want = ctl.throttle >= 0 ? ctl.throttle * vmax : ctl.throttle * 3;
    b.v += clamp(want - b.v, -6.5 * dt, 4.2 * dt);
    const maxTurn = 0.5 + 0.5 * Math.min(1, Math.abs(b.v) / 4);
    b.turn += (ctl.steer * maxTurn - b.turn) * Math.min(1, dt * 5);
    b.h = wrap(b.h - b.turn * dt * (b.v < -0.2 ? -1 : 1));
    b.x += Math.sin(b.h) * b.v * dt; b.z += Math.cos(b.h) * b.v * dt;
    // (the Service: a lifeboat stopped out on the water drifts a little the way the swell runs; more in the open)
    if (r.mode === 'service' && !b.home && Math.abs(b.v) < 3) {
      const drift = 0.45 * seaAt(r.coast, b.x, b.z) * SEA.height * (1 - Math.abs(b.v) / 3);
      b.x += SWELL[0] * drift * dt; b.z += SWELL[1] * drift * dt;
    }
    if (service && !b.ai && b.finished === null) claimFor(r, b);
    b.bump = Math.max(0, b.bump - dt);
    if (service) land(r, b, dt);
    else if (b.finished === null && b.z >= GATE_Z && b.z - Math.cos(b.h) * b.v * dt < GATE_Z && Math.abs(b.x - r.coast.gateX) < GATE_HALF + 2) {
      b.finished = r.t; r.finishers++;
      r.events.push({ kind: 'finish', boat: b.id, place: r.finishers });
      for (const k of r.crafts) if (k.claim === b.id) k.claim = -1;
      if (r.mode === 'rally' && !r.lastCall) {
        let length = L.call;
        const me = r.boats[r.mine];
        if (L.keep && !r.auto && me.finished === null) length = Math.max(length, eta(r, me, flowTo(r, 'finish')) * 1.25 + 8);
        r.lastCall = { start: r.t, length };
        r.events.push({ kind: 'lastcall', length });
      }
    }
  }
  collide(r, dt);
  board(r, dt);
  for (const b of r.boats) b.real += (Math.hypot(b.x - was[b.id][0], b.z - was[b.id][1]) / dt - b.real) * Math.min(1, dt * 3);
  if (service) {
    // (over when every call's come in and everyone's been taken aboard, and every lifeboat's in with them all landed: home
    // at its berth, or well inside the mouth)
    const everyone = everyoneAboard(r);
    if (everyone && !r.lastCall) { r.lastCall = { start: r.t, length: 0 }; r.events.push({ kind: 'allaboard' }); }
    if ((everyone && r.boats.every((b) => b.finished !== null && (b.home || r.t > b.finished + 12))) || r.t > 1500) { r.phase = 'over'; r.events.push({ kind: 'over' }); }
    return;
  }
  if (r.lastCall && (r.t > r.lastCall.start + r.lastCall.length || r.boats.every((b) => b.finished !== null && (b.home || r.t > b.finished + 12)))) {
    r.phase = 'over'; r.events.push({ kind: 'over' });
  }
}

/** (the Service) every call's come in, and everyone's aboard a lifeboat (or ashore) */
export const everyoneAboard = (r: Race) => r.crafts.every((k) => k.called && k.left <= 0);
/** (the Service) the calls coming in: each at its time, unless a lifeboat's close by just then (they're not seen to
 * appear out of nowhere: the call waits a little for that) */
function callIn(r: Race) {
  for (const k of r.crafts) {
    if (k.called || r.t < k.craft.at) continue;
    if (r.t < k.craft.at + 25 && r.boats.some((b) => Math.hypot(b.x - k.x, b.z - k.z) < 90)) continue;
    k.called = true; r.events.push({ kind: 'call', craft: k.craft.id });
  }
}
/** (the Service) home: inside the harbour and not rushing, those aboard step ashore one by one; in for the day when
 * everyone's been rescued and its own are all landed */
function land(r: Race, b: Boat, dt: number) {
  const inside = b.z > INSIDE;
  if (inside && b.aboard.length && Math.abs(b.v) < 7) {
    b.landT += dt;
    if (b.landT >= LAND) {
      b.landT = 0;
      const a = b.aboard.pop()!;
      b.safe++; r.ashore.push({ boat: b.id, ...a });
      r.events.push({ kind: 'ashore', boat: b.id, craft: a.craft, person: a.person });
    }
  } else b.landT = 0;
  if (b.finished === null && inside && !b.aboard.length && everyoneAboard(r)) {
    b.finished = r.t; r.finishers++;
    r.events.push({ kind: 'finish', boat: b.id, place: r.finishers });
    for (const k of r.crafts) if (k.claim === b.id) k.claim = -1;
  }
}

/** hulls against the land (the shore field), each other, the little boats and the buoys */
function collide(r: Race, dt: number) {
  const c = r.coast;
  for (const b of r.boats) {
    for (const [ax, al] of [[0, HALF_LEN], [-1.6, HALF_LEN - 1.8], [1.6, HALF_LEN - 1.8], [-HALF_BEAM, -1], [HALF_BEAM, -1], [-HALF_BEAM, -4.4], [HALF_BEAM, -4.4]] as const) {
      const [px, pz] = world(b, ax, al), s = shoreAt(c, px, pz);
      if (s >= CLEAR) continue;
      const [nx, nz] = seaward(c, px, pz), pen = CLEAR - s;
      b.x += nx * pen; b.z += nz * pen;
      const into = -(Math.sin(b.h) * nx + Math.cos(b.h) * nz) * Math.sign(b.v || 1);
      if (into > 0.2 && Math.abs(b.v) > 1.5 && b.bump <= 0) { r.events.push({ kind: 'bump', boat: b.id, hard: Math.min(1, Math.abs(b.v) / VMAX) }); b.bump = 0.6; }
      b.v *= 1 - Math.max(0, into) * 0.5 * Math.min(1, dt * 30);
    }
    // (the Service: the edge of the search area turns you back, gently)
    if (c.kind === 'service') {
      const ins = [[b.x - (X0 + EDGE), 1, 0], [X1 - EDGE - b.x, -1, 0], [b.z - (Z0 + EDGE), 0, 1]] as const;
      for (const [d, nx, nz] of ins) if (d < 0) {
        b.x += nx * -d * Math.min(1, dt * 8); b.z += nz * -d * Math.min(1, dt * 8);
        if (-(Math.sin(b.h) * nx + Math.cos(b.h) * nz) * Math.sign(b.v || 1) > 0.2) b.v *= 1 - Math.min(1, dt * 2);
        if (b.bump <= 0) { r.events.push({ kind: 'edge', boat: b.id }); b.bump = 3; }
      }
    }
  }
  // (boat against boat: two circles each, pushed apart; a fresh knock costs a little speed)
  const circles = (b: Boat) => [world(b, 0, 2.5), world(b, 0, -2.4)];
  for (let i = 0; i < r.boats.length; i++) for (let j = i + 1; j < r.boats.length; j++) {
    const a = r.boats[i], b = r.boats[j];
    if (Math.abs(a.x - b.x) > 14 || Math.abs(a.z - b.z) > 14) continue;
    for (const p of circles(a)) for (const q of circles(b)) {
      const dx = q[0] - p[0], dz = q[1] - p[1], d = Math.hypot(dx, dz), m = 4.5;
      if (d >= m || d < 1e-4) continue;
      const push = (m - d) / 2, ux = dx / d, uz = dz / d;
      a.x -= ux * push; a.z -= uz * push; b.x += ux * push; b.z += uz * push;
      if (a.bump <= 0 && b.bump <= 0) { a.v *= 0.85; b.v *= 0.85; a.bump = b.bump = 0.5; r.events.push({ kind: 'bump', boat: a.id, hard: 0.4 }); }
    }
  }
  // (a waiting little boat is nudged aside; a buoy holds its place and the hull slides round it)
  for (const k of r.crafts) {
    if (k.stage === 'line' || k.stage === 'climb' || !k.called) continue;
    for (const b of r.boats) for (const p of circles(b)) {
      const dx = k.x - p[0], dz = k.z - p[1], d = Math.hypot(dx, dz), m = 2.3 + (k.craft.kind === 'yacht' ? 2.0 : 1.6);
      if (d < m && d > 1e-4) { k.x += (dx / d) * (m - d) * 0.7; k.z += (dz / d) * (m - d) * 0.7; b.x -= (dx / d) * (m - d) * 0.3; b.z -= (dz / d) * (m - d) * 0.3; }
    }
  }
  for (const y of c.buoys) for (const b of r.boats) for (const p of circles(b)) {
    const dx = p[0] - y.x, dz = p[1] - y.z, d = Math.hypot(dx, dz), m = 2.3 + 0.9;
    if (d < m && d > 1e-4) {
      // (pushed off it, and slid round it, away from the side of the bow it's on)
      const away = local(b, y.x, y.z)[0] >= 0 ? -1 : 1, pen = m - d;
      b.x += (dx / d) * pen - Math.cos(b.h) * away * pen * 0.5; b.z += (dz / d) * pen + Math.sin(b.h) * away * pen * 0.5;
    }
  }
}

/** coming alongside: the line, the little boat pulled in, its people climbing aboard one by one */
function board(r: Race, dt: number) {
  const slow = LEVELS[r.level].slow;
  for (const k of r.crafts) {
    if (k.stage === 'done') continue;
    if (k.stage === 'wait') {
      if (k.left <= 0 || !k.called) continue;
      let best: Boat | null = null, bestGap = GAP;
      for (const b of r.boats) {
        if (b.finished !== null || Math.abs(b.v) > slow || full(r, b)) continue;
        const [across, along] = local(b, k.x, k.z), gap = Math.abs(across) - HALF_BEAM;
        if (Math.abs(along) < HALF_LEN && gap < bestGap) { best = b; bestGap = gap; k.side = Math.sign(across) || 1; }
      }
      if (best) { k.by = best.id; k.stage = 'line'; k.t = 0; k.away = 0; r.events.push({ kind: 'line', boat: best.id, craft: k.craft.id }); }
      continue;
    }
    const b = r.boats[k.by], [across, along] = local(b, k.x, k.z);
    const close = Math.abs(across) - HALF_BEAM < GAP + 2.5 && Math.abs(along) < HALF_LEN + 1.5 && Math.abs(b.v) < slow + 1.2 && b.finished === null;
    if (close) {
      // (pulled in by the line, to lie against the hull, bow to bow)
      const [tx, tz] = world(b, k.side * (HALF_BEAM + (k.craft.kind === 'yacht' ? 1.55 : 1.25)), clamp(along, -3, 1.5));
      const dx = tx - k.x, dz = tz - k.z, d = Math.hypot(dx, dz), pull = Math.min(d, 3 * dt);
      if (d > 1e-4) { k.x += (dx / d) * pull; k.z += (dz / d) * pull; }
      k.yaw += wrap(b.h - k.yaw) * Math.min(1, dt * 2);
      // (the Service: they climb across as fast as the lifeboat holds steady for them)
      const rate = r.mode === 'service' ? 0.3 + 0.7 * (k.steady = steadiness(r, b, k)) : 1;
      k.away = 0; k.t += dt * (k.stage === 'climb' ? rate : 1);
      if (k.stage === 'line' && k.t >= LINE) { k.stage = 'climb'; k.t = 0; }
      else if (k.stage === 'climb' && k.t >= CLIMB) {
        const person = k.craft.people.length - k.left;
        k.left--; k.t = 0; b.rescued++; b.aboard.push({ craft: k.craft.id, person });
        r.events.push({ kind: 'aboard', boat: b.id, craft: k.craft.id, person });
        if (k.left <= 0) { k.stage = 'done'; r.events.push({ kind: 'clear', boat: b.id, craft: k.craft.id }); }
        else if (full(r, b)) {
          // (the Service: no more room; the rest wait for the next lifeboat, and this one takes its people home)
          k.by = -1; k.stage = 'wait'; k.t = 0; if (k.claim === b.id) k.claim = -1;
          if (b.ai) { b.ai.target = -1; b.ai.think = 0.6; }
          r.events.push({ kind: 'full', boat: b.id }, { kind: 'letgo', boat: b.id, craft: k.craft.id });
        }
        if (k.left <= 0 && full(r, b)) r.events.push({ kind: 'full', boat: b.id });
      }
    } else {
      k.away += dt; k.t = Math.max(0, k.t - dt * 2);
      if (k.away > 2.5 || b.finished !== null) { k.by = -1; k.stage = 'wait'; k.t = 0; r.events.push({ kind: 'letgo', boat: b.id, craft: k.craft.id }); }
    }
  }
}

/**
 * How steady a lifeboat is for a little boat alongside (0..1), as the Service has it: the sea where it lies (bigger in
 * the open, smaller in the lee of land; the weather's height), less when the little boat is in the lee of the hull
 * (beam-on to the swell, with it on the side the waves run toward), less again for a lifeboat that's moving or turning.
 */
export function steadiness(r: Race, b: Boat, k: Rescue) {
  const sea = seaAt(r.coast, k.x, k.z) * SEA.height, side = Math.sign(local(b, k.x, k.z)[0]) || k.side;
  const lee = clamp((-Math.cos(b.h) * SWELL[0] + Math.sin(b.h) * SWELL[1]) * side, 0, 1);
  k.lee = lee;
  const rough = clamp((sea * (1 - 0.75 * lee) - 0.25) / 0.85, 0, 1);
  const moving = clamp(Math.abs(b.v) / (LEVELS[r.level].slow + 1.2), 0, 1), turning = clamp(Math.abs(b.turn) / 0.6, 0, 1);
  return clamp(1 - 0.6 * rough - 0.45 * moving - 0.25 * turning, 0, 1);
}
/** (the Service) a lifeboat with no more room */
export const full = (r: Race, b: Boat) => r.mode === 'service' && b.aboard.length >= CAP;
/** (the Service) the little boat you're plainly going for: the nearest one waiting within 45 m, ahead or close by; the
 * crew that had it leaves it to you if you're well nearer than they are */
function claimFor(r: Race, b: Boat) {
  let best: Rescue | null = null, bd = full(r, b) ? 0 : 45;
  for (const k of r.crafts) {
    if (k.stage !== 'wait' || k.left <= 0 || !k.called) continue;
    const d = Math.hypot(k.x - b.x, k.z - b.z);
    if (d < bd && (local(b, k.x, k.z)[1] > -3 || d < 12)) { best = k; bd = d; }
  }
  for (const k of r.crafts) if (k.claim === b.id && k !== best && k.stage === 'wait') k.claim = -1;
  if (!best || best.claim === b.id) return;
  const owner = best.claim >= 0 ? r.boats[best.claim] : null;
  if (owner && Math.hypot(owner.x - best.x, owner.z - best.z) < bd * 1.3) return;
  if (owner) r.events.push({ kind: 'yield', boat: owner.id, craft: best.craft.id, to: b.id });
  best.claim = b.id;
}

/** the places as they stand: across the line first (most rescued, then who crossed first), then the rest by most rescued */
export function standings(r: Race) {
  return [...r.boats].sort((a, b) => {
    if ((a.finished !== null) !== (b.finished !== null)) return a.finished !== null ? -1 : 1;
    if (a.rescued !== b.rescued) return b.rescued - a.rescued;
    if (a.finished !== null && b.finished !== null) return a.finished - b.finished;
    return b.z - a.z;
  });
}

// ─── the way through the water: distances over the navigation grid (Dijkstra), one field per goal, kept ───

export function flowTo(r: Race, key: string): Float32Array {
  const have = r.flows.get(key);
  if (have) return have;
  const goals: number[] = [], c = r.coast;
  if (key === 'finish') { for (let j = 0; j < NNZ; j++) for (let i = 0; i < NNX; i++) if (Z0 + (j + 0.5) * NAV > GATE_Z + 8 && c.open[j * NNX + i]) goals.push(j * NNX + i); }
  else if (key.startsWith('berth')) { const b = c.berths[+key.slice(5)]; goals.push(navIndex(b.x, b.z)); }
  else { const k = r.crafts[+key]; for (const [dx, dz] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]]) goals.push(navIndex(k.craft.x + dx, k.craft.z + dz)); }
  const f = dijkstra(c.open, goals.filter((g) => g >= 0));
  r.flows.set(key, f);
  return f;
}
function dijkstra(open: Uint8Array, goals: number[]) {
  const n = open.length, d = new Float32Array(n).fill(Infinity), heap = new Int32Array(n * 4), key = new Float32Array(n * 4);
  let size = 0;
  const push = (o: number, v: number) => { let i = size++; heap[i] = o; key[i] = v; while (i > 0) { const p = (i - 1) >> 1; if (key[p] <= key[i]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; [key[p], key[i]] = [key[i], key[p]]; i = p; } };
  const pop = () => { const o = heap[0], v = key[0]; size--; heap[0] = heap[size]; key[0] = key[size]; let i = 0; for (;;) { const l = 2 * i + 1, rr = l + 1; let m = i; if (l < size && key[l] < key[m]) m = l; if (rr < size && key[rr] < key[m]) m = rr; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; [key[m], key[i]] = [key[i], key[m]]; i = m; } return [o, v]; };
  for (const g of goals) { d[g] = 0; push(g, 0); }
  while (size) {
    const [o, v] = pop();
    if (v > d[o]) continue;
    const i = o % NNX, j = (o - i) / NNX;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= NNX || jj >= NNZ) continue;
      const p = jj * NNX + ii;
      if (!open[p]) continue;
      const nv = v + (di && dj ? NAV * Math.SQRT2 : NAV);
      if (nv < d[p] && size < heap.length) { d[p] = nv; push(p, nv); }
    }
  }
  return d;
}
/** how far along the flow, from a boat */
function flowAt(f: Float32Array, x: number, z: number) {
  const o = navIndex(x, z);
  if (o >= 0 && f[o] < Infinity) return f[o];
  let best = Infinity;
  for (const [dx, dz] of [[NAV, 0], [-NAV, 0], [0, NAV], [0, -NAV], [NAV, NAV], [-NAV, NAV], [NAV, -NAV], [-NAV, -NAV]]) {
    const p = navIndex(x + dx, z + dz);
    if (p >= 0) best = Math.min(best, f[p] + NAV * 1.5);
  }
  return best;
}
function eta(r: Race, b: Boat, f: Float32Array) { return flowAt(f, b.x, b.z) / (VMAX * 0.9) + 1; }
/** a clear run of water between two points (for a hull: CLEAR and its half beam) */
export function clearWay(c: Coast, x0: number, z0: number, x1: number, z1: number, margin = CLEAR + HALF_BEAM + 0.6) {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 3);
  for (let i = 1; i <= n; i++) if (shoreAt(c, x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n) < margin) return false;
  return true;
}
/** which way to go toward a goal: straight if the water's clear; else down the flow, as far ahead as can be seen */
function heading(r: Race, b: Boat, f: Float32Array, gx: number, gz: number) {
  if (clearWay(r.coast, b.x, b.z, gx, gz)) return Math.atan2(gx - b.x, gz - b.z);
  const i0 = Math.floor((b.x - X0) / NAV), j0 = Math.floor((b.z - Z0) / NAV);
  let best = flowAt(f, b.x, b.z), bx = gx, bz = gz, found = false;
  for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
    const ii = i0 + di, jj = j0 + dj;
    if (ii < 0 || jj < 0 || ii >= NNX || jj >= NNZ) continue;
    const o = jj * NNX + ii, x = X0 + (ii + 0.5) * NAV, z = Z0 + (jj + 0.5) * NAV;
    if (f[o] < best - 0.5 && clearWay(r.coast, b.x, b.z, x, z, CLEAR + HALF_BEAM)) { best = f[o]; bx = x; bz = z; found = true; }
  }
  if (!found) {
    // (hemmed in: back out toward open water)
    const [nx, nz] = seaward(r.coast, b.x, b.z);
    return Math.atan2(nx, nz);
  }
  return Math.atan2(bx - b.x, bz - b.z);
}
const steerTo = (b: Boat, want: number) => clamp(-wrap(want - b.h) * 2.2, -1, 1);

/** on easy and medium, the game's boats keep the race going round you: ease off well ahead, push on behind */
function keepWith(r: Race, b: Boat) {
  if (!LEVELS[r.level].keep || r.auto || r.mode === 'service') return 1;
  const me = r.boats[r.mine], lead = (b.rescued - me.rescued) * 25 + (b.z - me.z);
  return lead > 60 ? 0.9 : lead < -60 ? 1.06 : 1;
}

/** a game's boat at the helm: choose a little boat worth going for (or the finish), then go and come alongside it */
function think(r: Race, b: Boat, dt: number): Required<Input> {
  const ai = b.ai!, L = LEVELS[r.level];
  const mineK = r.crafts.find((k) => k.by === b.id && (k.stage === 'line' || k.stage === 'climb'));
  if (mineK) return { steer: 0, throttle: 0 };
  // (the Service: at its berth with nothing to do, waiting for a call)
  if (r.mode === 'service' && b.home && ai.target === -1) {
    b.stuck = 0; ai.think -= dt;
    if (ai.think > 0) return { steer: 0, throttle: 0 };
  }
  // (stuck against something: back off a moment)
  b.stuck = b.real < 0.7 && ai.target !== -3 ? b.stuck + dt : 0;
  if (b.stuck > 2.5) { b.backing = 1.3; b.stuck = 0; }
  if (b.backing > 0) { b.backing -= dt; return { steer: 0.6 * (b.id % 2 ? 1 : -1), throttle: -1 }; }
  ai.think -= dt;
  const tgt = ai.target >= 0 ? r.crafts[ai.target] : null;
  if (ai.think <= 0 || (tgt && (tgt.stage === 'done' || (tgt.by !== -1 && tgt.by !== b.id) || (tgt.claim !== -1 && tgt.claim !== b.id)))) {
    ai.think = 0.6 + r.rand() * 0.3;
    const was = ai.target;
    ai.target = choose(r, b);
    // (the Service: say which you're going for; let go of the one you were)
    if (r.mode === 'service' && was !== ai.target) {
      if (was >= 0 && r.crafts[was].claim === b.id) r.crafts[was].claim = -1;
      if (ai.target >= 0) { r.crafts[ai.target].claim = b.id; b.home = false; }
    }
  }
  if (ai.target === -1 && r.mode === 'service') return homeFrom(r, b);
  if (ai.target === -3) { b.stuck = 0; return { steer: 0, throttle: 0 }; }
  if (ai.target === -1) {
    const f = flowTo(r, 'finish'), want = heading(r, b, f, r.coast.gateX, GATE_Z + 30);
    return avoid(r, b, { steer: steerTo(b, want), throttle: Math.abs(wrap(want - b.h)) > 1.4 ? 0.45 : 1 }, want);
  }
  const k = r.crafts[ai.target], d = Math.hypot(k.x - b.x, k.z - b.z);
  // (coming alongside: aim to pass with the little boat on one side, a beam's width off, slowing as it nears)
  let gx = k.x, gz = k.z;
  if (d < 32) {
    const [across] = local(b, k.x, k.z);
    let side = Math.abs(across) > 0.5 ? Math.sign(across) : ai.side;
    // (the Service: come alongside with the little boat in your lee, if the swell gives a side to choose)
    if (r.mode === 'service' && d > 12) {
      const th = Math.atan2(k.x - b.x, k.z - b.z), lee = -Math.cos(th) * SWELL[0] + Math.sin(th) * SWELL[1];
      if (Math.abs(lee) > 0.3) side = Math.sign(lee);
    } else if (r.mode === 'service') side = ai.side;
    ai.side = side;
    const ux = (k.x - b.x) / d, uz = (k.z - b.z) / d;
    const off = HALF_BEAM + (k.craft.kind === 'yacht' ? 1.9 : 1.4);
    gx = k.x + side * uz * off * Math.min(1, d / 8); gz = k.z - side * ux * off * Math.min(1, d / 8);
  }
  const want = heading(r, b, flowTo(r, String(ai.target)), gx, gz);
  const err = Math.abs(wrap(want - b.h));
  let speed = d < 28 ? clamp(0.33 * (d - 4) + 1.2, 1.0, VMAX) : VMAX;
  if (err > 1.2) speed = Math.min(speed, 4);
  const vmax = VMAX * L.ai;
  return avoid(r, b, { steer: steerTo(b, want), throttle: clamp(speed / vmax, 0, 1) * (b.v > speed + 1.5 ? -0.4 : 1) }, want);
}
/** steer clear of another boat dead ahead; and bend the way it wants to go round a buoy (or a little boat it isn't
 * going for) that's in that way */
function avoid(r: Race, b: Boat, ctl: Required<Input>, want?: number): Required<Input> {
  if (want !== undefined) {
    const tgt = b.ai?.target ?? -9, w0 = { x: b.x, z: b.z, h: want };
    let bend = 0;
    for (const [x, z, w] of [...r.coast.buoys.map((y) => [y.x, y.z, 3.6]), ...r.crafts.filter((k) => k.craft.id !== tgt && k.stage === 'wait' && k.called).map((k) => [k.x, k.z, 4.2])]) {
      const [across, along] = local(w0, x, z);
      if (along > 0 && along < 15 && Math.abs(across) < w) bend += (across >= 0 ? 1 : -1) * (1 - along / 15) * 0.8;
    }
    if (bend) {
      // (only into clear water: bent the other way, or not at all, if land's that way)
      const clearAt = (a: number) => [4, 8, 12].every((d) => shoreAt(r.coast, b.x + Math.sin(a) * d, b.z + Math.cos(a) * d) > CLEAR + HALF_BEAM);
      const B = clamp(bend, -0.9, 0.9), a = clearAt(want + B) ? want + B : clearAt(want - B) ? want - B : want;
      ctl.steer = steerTo(b, a);
    }
  }
  for (const o of r.boats) {
    if (o === b) continue;
    const [across, along] = local(b, o.x, o.z);
    if (along > 0 && along < 16 && Math.abs(across) < 5) {
      ctl.steer = clamp(ctl.steer + (across >= 0 ? -0.8 : 0.8) * (1 - along / 16), -1, 1);
      ctl.throttle *= 0.85;
    }
  }
  return ctl;
}
/** (the Rally) which little boat is worth most to go for: its people, over the time to get there and take them aboard */
function choose(r: Race, b: Boat): number {
  const L = LEVELS[r.level], ai = b.ai!;
  if (r.mode === 'service') return chooseCall(r, b);
  const c = r.coast, laneX = (z: number) => c.centre(z) + ai.lane * 90;
  const fin = flowTo(r, 'finish'), toFinish = eta(r, b, fin);
  if (r.lastCall) {
    const leftT = r.lastCall.start + r.lastCall.length - r.t;
    if (leftT < toFinish * 1.15 + 6) return -1;
  }
  const scored: [number, number][] = [];
  for (const k of r.crafts) {
    if (k.stage === 'done' || k.left <= 0 || (k.by !== -1 && k.by !== b.id)) continue;
    const d = Math.hypot(k.x - b.x, k.z - b.z);
    const [, along] = local(b, k.x, k.z);
    const turn = along < 0 ? 2.5 : 0;
    const t = (d * 1.15) / (VMAX * L.ai) + turn + LINE + k.left * CLIMB + 2;
    let v = k.left / t;
    v *= 0.55 + 0.45 * Math.exp(-(((k.x - laneX(k.z)) / 70) ** 2));
    if (k.z < b.z - 20) v *= 0.3;
    // (another of the game's boats plainly nearer: leave it to them)
    if (r.boats.some((o) => o !== b && o.ai && o.ai.target === k.craft.id && Math.hypot(k.x - o.x, k.z - o.z) < d * 0.8)) v *= 0.25;
    if (ai.target === k.craft.id) v *= 1.3;
    scored.push([v, k.craft.id]);
  }
  scored.sort((p, q) => q[0] - p[0]);
  // (the Race leaves the ones not worth the trip)
  if (!scored.length || scored[0][0] < 0.02) return -1;
  if (scored.length > 1 && r.rand() < L.dither * 0.5) return scored[1][1];
  return scored[0][1];
}
/**
 * (the Service) which call to answer: those waiting, by how many it can take (its room left), over the time to get
 * there and take them aboard; none taken by another crew, none another of the game's boats is plainly nearer. It keeps
 * to the one it's going for unless another's much better (they're all over the sea: changing its mind costs the trip).
 * Nearly full with the nearest a long way off, it takes its people home first. -1: home (or, with room aboard and more
 * calls to come, wait where it is: -3).
 */
function chooseCall(r: Race, b: Boat): number {
  const L = LEVELS[r.level], ai = b.ai!, room = CAP - b.aboard.length;
  if (room <= 0) return -1;
  const scored: [number, number, number][] = [];
  for (const k of r.crafts) {
    if (!k.called || k.stage === 'done' || k.left <= 0 || (k.by !== -1 && k.by !== b.id) || (k.claim !== -1 && k.claim !== b.id)) continue;
    const d = Math.hypot(k.x - b.x, k.z - b.z), [, along] = local(b, k.x, k.z), take = Math.min(k.left, room);
    const t = (d * 1.15) / (VMAX * L.ai) + (along < 0 ? 2.5 : 0) + LINE + take * CLIMB + 2;
    let v = take / t;
    if (r.boats.some((o) => o !== b && o.ai && o.ai.target === k.craft.id && Math.hypot(k.x - o.x, k.z - o.z) < d * 0.8)) v *= 0.25;
    if (ai.target === k.craft.id) v *= 1.3;
    scored.push([v, k.craft.id, d]);
  }
  scored.sort((p, q) => q[0] - p[0]);
  const more = r.crafts.some((k) => !k.called);
  if (!scored.length) return more && b.aboard.length < CAP - 2 && b.z < GATE_Z ? -3 : -1;
  const now = scored.find((q) => q[1] === ai.target);
  const pick = now && scored[0][0] < now[0] * 1.5 ? now : !now && scored.length > 1 && r.rand() < L.dither * 0.5 ? scored[1] : scored[0];
  if (b.aboard.length >= CAP - 2 && pick[2] > 220) return -1;
  return pick[1];
}
/** (the Service) home: out on the water, for the harbour mouth; inside, on to its berth (landing them on the way) */
function homeFrom(r: Race, b: Boat): Required<Input> {
  if (b.z > GATE_Z + 8) return homeward(r, b);
  const want = heading(r, b, flowTo(r, 'finish'), r.coast.gateX, GATE_Z + 30);
  return avoid(r, b, { steer: steerTo(b, want), throttle: Math.abs(wrap(want - b.h)) > 1.4 ? 0.45 : 1 }, want);
}
/** across the line: on into the harbour, to its berth (the Service: each crew to its own) */
function homeward(r: Race, b: Boat): Required<Input> {
  if (b.home) return { steer: 0, throttle: 0 };
  const place = r.mode === 'service' ? b.id : r.boats.filter((o) => o.finished !== null && o.finished < b.finished!).length;
  const berth = r.coast.berths[place % r.coast.berths.length];
  const d = Math.hypot(berth.x - b.x, berth.z - b.z);
  if (d < 3 && Math.abs(b.v) < 1.2) { b.home = true; return { steer: 0, throttle: 0 }; }
  const want = heading(r, b, flowTo(r, 'berth' + (place % r.coast.berths.length)), berth.x, berth.z);
  return { steer: steerTo(b, want), throttle: d < 20 ? clamp((d - 1.5) / 20, 0.04, 0.6) : 0.6 };
}

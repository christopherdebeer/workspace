/**
 * The rescue race, as Lily wrote it: five big boats (one yours, four the game's) out on the sea of `sea.ts`, little
 * people waiting in tiny boats. Steer near enough to a tiny boat and its people come across onto your boat, one after
 * another; rescue as many as you can, then cross the finish line. The winner is the boat that rescued the most; there's
 * a 1st place, a 2nd, a 3rd, a 4th and a 5th. Pure: stepped by the page (or a test) with a fixed dt, no drawing.
 *
 * - **Near enough** (`NEAR`): a tiny boat within 7.5 m of the line down a big boat's middle. The nearest big boat
 *   claims it, and its people jump across, one every `GAP` seconds, each `JUMP` long in the air, to the next free
 *   spot on the deck (`SPOTS`, filled from the wheelhouse forward, then the side decks, the stern, the roof). Each is
 *   counted as they land. Once claimed, a tiny boat is no one else's; once across the line, a boat rescues no more.
 * - **Steering**: a boat turns toward where it's pointed (the player's finger, or the keys), quicker the faster it's
 *   going, and slows a little in a turn; it runs aground on the shallows (`DRAFT`) and slides off along them, and
 *   bumps the other boats aside.
 * - **The others** (the game's boats): each keeps to a lane of its own across the channel, more or less, and picks the
 *   tiny boat worth most to it (its people, over how long it would take to get there and turn to it, less if it's
 *   behind or out of its lane), passing over one another boat will plainly get to first; holds to it unless something
 *   much better turns up; steers clear of the other boats, and round land (straight at its aim where the water's clear,
 *   else by a route found over a grid of the water: `routeStep`); and heads for the finish when there's nothing left
 *   within reach, when it's fallen too far behind the leader to make the line in the last call, or when the time's
 *   running out. How quick and how sharp they are is the `level`.
 * - **The finish**: the first boat across starts the **last call**: the others have `LEVELS[level].last` seconds to
 *   get across (on the gentler levels, never less than your boat needs to get there from where it is, and a little
 *   more: `grace`; so heading for home when the bell goes always gets you there). The race is over when every boat is across (and everyone in the air has landed) or the last call runs
 *   out. Places: the boats across the line, by most rescued (a tie to the one across first); then any that didn't get
 *   across, by most rescued. Boats across go on into the harbour, each to its berth.
 */
import { hash, seeded, smooth } from '../kit/rng';
import { DRAFT, L, heightAt, makeSea, slopeAt, type PersonLook, type Sea } from './sea';

export type Level = 'easy' | 'medium' | 'hard';
export const BOATS: Array<{ name: string; colour: [number, number, number] }> = [
  { name: 'Puffin', colour: [0.95, 0.36, 0.22] },
  { name: 'Dolphin', colour: [0.2, 0.5, 0.92] },
  { name: 'Turtle', colour: [0.18, 0.68, 0.38] },
  { name: 'Sunfish', colour: [0.98, 0.74, 0.14] },
  { name: 'Starfish', colour: [0.78, 0.36, 0.86] },
];
/** a big boat's top speed (m/s), the player's; the game's boats go a share of it (`LEVELS`) */
export const VMAX = 11;
/** near enough: a tiny boat this close to the line down a big boat's middle (m) */
export const NEAR = 7.5;
/** a big boat: bow and stern (z), half its beam, its deck, its wheelhouse roof (y) */
export const HULL = { bow: 5.5, stern: -5.5, beam: 2.1, deck: 1.0, roof: 2.95 };
/** how long a jump across takes, and how long between one person's and the next */
export const JUMP = 0.8, GAP = 0.32;
/** how far ahead the throttle sits with no hand on it (the boat drifts on, slowly) */
export const IDLE = 0.3;
/**
 * How the game's boats go, by level: their share of top speed, how often they think again, how often they settle for
 * second best, how much they wander, how long they take to set off, the last call's length (and the grace beyond what
 * you need to get home in it), and how much they keep with you (`band`: ahead of you they ease off a little, behind you
 * they push a little, so the race stays round you).
 */
export const LEVELS: Record<Level, { speed: number; think: number; slip: number; wobble: number; react: [number, number]; last: number; grace: number; band: number }> = {
  easy: { speed: 0.8, think: 1.2, slip: 0.3, wobble: 0.14, react: [0.6, 1.5], last: 60, grace: 25, band: 1 },
  medium: { speed: 0.86, think: 0.8, slip: 0.18, wobble: 0.08, react: [0.4, 1.0], last: 45, grace: 12, band: 0.7 },
  hard: { speed: 0.98, think: 0.4, slip: 0, wobble: 0.025, react: [0.1, 0.3], last: 35, grace: -1e9, band: 0 },
};

/** where people stand on a big boat (boat-local x, y, z: y the deck or the roof), in the order the deck fills */
export const SPOTS: Array<[number, number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  const width = (z: number) => (z <= 1.6 ? 1.72 : 1.72 * (1 - ((z - 1.6) / 3.9) * 0.82));
  for (const z of [-0.7, 0.15, 1.0, 1.85, 2.7, 3.55]) for (const x of [-0.45, 0.45, -1.3, 1.3]) if (Math.abs(x) <= width(z) - 0.32) out.push([x, HULL.deck, z]);
  for (const z of [-1.75, -2.65, -3.55]) for (const x of [-1.6, 1.6]) out.push([x, HULL.deck, z]);
  for (const x of [-1.1, -0.37, 0.37, 1.1]) out.push([x, HULL.deck, -4.75]);
  for (const [x, z] of [[-0.55, -1.9], [0.55, -1.9], [-0.55, -2.8], [0.55, -2.8]]) out.push([x, HULL.roof, z]);
  return out;
})();
/** where people sit in a tiny boat of one, two or three (boat-local x, z) */
export const SEATS: Array<Array<[number, number]>> = [[], [[0, 0]], [[0, -0.55], [0, 0.55]], [[0, -0.85], [0, 0], [0, 0.85]]];
/** a spot on the deck, for the n-th aboard (past the last, squeezed in among the others) */
export const spotOf = (n: number): [number, number, number] => {
  if (n < SPOTS.length) return SPOTS[n];
  const [x, y, z] = SPOTS[n % SPOTS.length], k = Math.floor(n / SPOTS.length);
  return [x + 0.22 * Math.sin(k * 2.4), y, z + 0.22 * Math.cos(k * 2.4)];
};

export interface Person {
  id: number; tiny: number; seat: number; look: PersonLook;
  /** the big boat they're going to (-1: still waiting), their spot on it, when they jump, whether they're off and landed */
  boat: number; spot: number; jumpAt: number; jumped: boolean; landed: boolean;
}
export interface Tiny { id: number; x: number; z: number; yaw: number; colour: number; people: number[]; claimedBy: number; claimedAt: number; vx: number; vz: number; spin: number }
export type Target = { kind: 'tiny'; id: number } | { kind: 'finish' } | { kind: 'berth' } | { kind: 'none' };
export interface Boat {
  id: number; name: string; colour: [number, number, number];
  x: number; z: number; h: number; v: number; rudder: number; throttle: number;
  /** steered by the game; its share of top speed */
  ai: boolean; speed: number;
  /** when it crossed the line (-1: not yet), and in what order */
  finished: number; order: number;
  /** who's landed on it so far, and everyone it's taken on (landed or in the air) */
  rescued: number; aboard: number[];
  target: Target; thinkAt: number; wakeAt: number; bumpAt: number; rnd: () => number;
  /** the game's boats: the lane it keeps to (-1..1 across the channel), the waypoint it's steering for round land */
  lane: number; way: [number, number] | null; wayAt: number;
}
export type RaceEvent =
  | { kind: 'count'; n: number } | { kind: 'go' }
  | { kind: 'claim'; boat: number; tiny: number; n: number } | { kind: 'jump'; boat: number; person: number }
  | { kind: 'land'; boat: number; person: number; total: number }
  | { kind: 'finish'; boat: number; order: number } | { kind: 'lastcall' } | { kind: 'bump'; boat: number; hard: number } | { kind: 'end' };
export interface Race {
  sea: Sea; seed: number; level: Level; mine: number; auto: boolean;
  time: number; phase: 'lineup' | 'countdown' | 'racing' | 'done';
  /** when the race went, when the last call began (-1: not yet) and how long it is, when it ended */
  goAt: number; lastCall: number; callLength: number; endAt: number; tick: number;
  boats: Boat[]; tinies: Tiny[]; people: Person[];
  /** the boats in the order they crossed */
  order: number[];
  /** what's happened since the page last looked (it empties them) */
  events: RaceEvent[];
}
/** what the player's hand says: a point on the water to go toward, or (the keys) a turn and a throttle */
export interface Input { aim?: { x: number; z: number } | null; turn?: number; throttle?: number }

const seaCache = new Map<number, Sea>();
/** the sea of a seed (kept: a new race on the same sea doesn't remake it) */
export function seaOf(seed: number): Sea {
  let s = seaCache.get(seed);
  if (!s) { s = makeSea(seed); seaCache.set(seed, s); if (seaCache.size > 4) seaCache.delete(seaCache.keys().next().value!); }
  return s;
}

export function newRace(seed: number, opts: { level?: Level; mine?: number; auto?: boolean } = {}): Race {
  const sea = seaOf(seed), level = opts.level ?? 'easy', mine = opts.mine ?? 0, auto = !!opts.auto;
  const people: Person[] = [], tinies: Tiny[] = [];
  sea.tinies.forEach((t, k) => {
    const r = seeded(hash(seed, 50, k)), a = r() * Math.PI * 2, sp = 0.08 + r() * 0.12;
    const ids = t.people.map((look, seat) => { const id = people.length; people.push({ id, tiny: k, seat, look, boat: -1, spot: -1, jumpAt: 0, jumped: false, landed: false }); return id; });
    tinies.push({ id: k, x: t.x, z: t.z, yaw: t.yaw, colour: t.colour, people: ids, claimedBy: -1, claimedAt: 0, vx: Math.sin(a) * sp, vz: Math.cos(a) * sp, spin: (r() - 0.5) * 0.08 });
  });
  const boats: Boat[] = BOATS.map((k, i) => {
    const rnd = seeded(hash(seed, 77, i)), ai = auto || i !== mine;
    return {
      id: i, name: k.name, colour: k.colour, x: sea.starts[i].x, z: sea.starts[i].z, h: 0, v: 0, rudder: 0, throttle: 0,
      ai, speed: ai && i !== mine ? LEVELS[level].speed * (0.97 + 0.06 * rnd()) : 1,
      finished: -1, order: -1, rescued: 0, aboard: [], target: { kind: 'none' }, thinkAt: 0, wakeAt: 0, bumpAt: -1, rnd,
      lane: (i - 2) * 0.42, way: null, wayAt: -1,
    };
  });
  return { sea, seed, level, mine, auto, time: 0, phase: 'lineup', goAt: 0, lastCall: -1, callLength: LEVELS[level].last, endAt: -1, tick: 0, boats, tinies, people, order: [], events: [] };
}

/** from the line-up to the count of three */
export function start(r: Race) {
  if (r.phase !== 'lineup') return;
  r.phase = 'countdown';
  r.goAt = r.time + 3;
  r.tick = 0;
  const lv = LEVELS[r.level];
  for (const b of r.boats) b.wakeAt = r.goAt + (b.id === r.mine && !r.auto ? 0 : lv.react[0] + b.rnd() * (lv.react[1] - lv.react[0]));
}

const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** a point on a boat: `f` along it (toward the bow), `s` across it (toward its right) */
export const along = (b: { x: number; z: number; h: number }, f: number, s = 0): [number, number] => [b.x + Math.sin(b.h) * f + Math.cos(b.h) * s, b.z + Math.cos(b.h) * f - Math.sin(b.h) * s];
/** how far a point is from the line down a boat's middle (stern to bow) */
export function fromHull(b: Boat, x: number, z: number) {
  const dx = x - b.x, dz = z - b.z, f = clamp(dx * Math.sin(b.h) + dz * Math.cos(b.h), -4, 4.5);
  const [px, pz] = along(b, f);
  return Math.hypot(x - px, z - pz);
}

/** one step of the race (dt: seconds; the page steps at 1/60) */
export function step(r: Race, dt: number, input: Input = {}) {
  r.time += dt;
  const t = r.time, lv = LEVELS[r.level];
  if (r.phase === 'countdown') {
    const n = Math.ceil(r.goAt - t);
    if (n > 0 && n !== r.tick) { r.tick = n; r.events.push({ kind: 'count', n }); }
    if (t >= r.goAt) { r.phase = 'racing'; r.events.push({ kind: 'go' }); }
  }
  const going = r.phase === 'racing' || r.phase === 'done';

  // ─── each boat's hand on the wheel ───
  for (const b of r.boats) {
    if (!going) { b.throttle = 0; b.rudder = 0; continue; }
    if (b.finished >= 0) { toBerth(r, b); continue; }
    if (r.phase === 'done') { b.throttle = 0; b.rudder *= 0.9; continue; }
    if (b.ai) { if (t < b.wakeAt) { b.throttle = 0; continue; } if (t >= b.thinkAt) { think(r, b); b.thinkAt = t + lv.think * (0.8 + 0.4 * b.rnd()); } drive(r, b); continue; }
    if (input.aim) {
      const dx = input.aim.x - b.x, dz = input.aim.z - b.z;
      if (Math.hypot(dx, dz) > 1.5) b.rudder = clamp(wrap(Math.atan2(dx, dz) - b.h) * 2.4, -1, 1);
      else b.rudder *= 0.8;
      b.throttle = input.throttle ?? 1;
    } else if (input.turn !== undefined || input.throttle !== undefined) {
      b.rudder = clamp(input.turn ?? 0, -1, 1);
      b.throttle = input.throttle ?? IDLE;
    } else { b.rudder *= 0.85; b.throttle = IDLE; }
  }

  // ─── how they move ───
  const me = r.boats[r.mine], band = r.auto || r.phase !== 'racing' ? 0 : LEVELS[r.level].band;
  for (const b of r.boats) {
    // (the game's boats keep with you: ahead of you by much, easing off a little; behind, pushing a little)
    const keep = b.ai && b.finished < 0 && band > 0 ? 1 - band * clamp((b.z - me.z) / 400, -0.08, 0.15) : 1;
    const vt = b.throttle * VMAX * b.speed * keep;
    b.v += (vt - b.v) * Math.min(1, dt * (vt > b.v ? 0.9 : 1.4));
    b.h = wrap(b.h + b.rudder * 1.55 * (0.35 + 0.65 * smooth(0, 6, b.v)) * dt);
    b.v *= 1 - 0.16 * Math.abs(b.rudder) * dt;
    b.x += Math.sin(b.h) * b.v * dt;
    b.z += Math.cos(b.h) * b.v * dt;
    aground(r, b);
  }
  bumpBoats(r);

  // ─── near enough: the nearest big boat takes them on ───
  if (r.phase === 'racing') for (const tn of r.tinies) {
    if (tn.claimedBy >= 0) continue;
    let best: Boat | null = null, bd = NEAR;
    for (const b of r.boats) { if (b.finished >= 0) continue; const d = fromHull(b, tn.x, tn.z); if (d < bd) { bd = d; best = b; } }
    if (best) claim(r, tn, best);
  }
  for (const p of r.people) {
    if (p.boat < 0 || p.landed) continue;
    if (!p.jumped && t >= p.jumpAt) { p.jumped = true; r.events.push({ kind: 'jump', boat: p.boat, person: p.id }); }
    if (t >= p.jumpAt + JUMP) { p.landed = true; const b = r.boats[p.boat]; b.rescued++; r.events.push({ kind: 'land', boat: b.id, person: p.id, total: b.rescued }); }
  }

  // ─── the tiny boats drift (off the shallows, and out of a big boat's way) ───
  for (const tn of r.tinies) {
    const empty = tn.claimedBy >= 0 && t > tn.claimedAt + 2, k = empty ? 4 : 1;
    tn.x += tn.vx * k * dt; tn.z += tn.vz * k * dt; tn.yaw += tn.spin * dt;
    if (heightAt(r.sea, tn.x + tn.vx * 40, tn.z + tn.vz * 40) > -2.5) { tn.vx = -tn.vx; tn.vz = -tn.vz; }
    for (const b of r.boats) {
      const d = fromHull(b, tn.x, tn.z);
      if (d < 3.4 && d > 1e-3) { const [px, pz] = along(b, clamp((tn.x - b.x) * Math.sin(b.h) + (tn.z - b.z) * Math.cos(b.h), -4, 4.5)); tn.x += ((tn.x - px) / d) * (3.4 - d) * 0.5; tn.z += ((tn.z - pz) / d) * (3.4 - d) * 0.5; }
    }
  }

  // ─── across the line ───
  if (r.phase === 'racing') for (const b of r.boats) {
    if (b.finished >= 0 || b.z < L) continue;
    b.finished = t; b.order = r.order.length; r.order.push(b.id); b.target = { kind: 'berth' };
    r.events.push({ kind: 'finish', boat: b.id, order: b.order });
    if (r.lastCall < 0) {
      r.lastCall = t;
      // (long enough for you to get home from where you are, on the gentler levels)
      const me = r.boats[r.mine];
      r.callLength = r.auto || me.finished >= 0 ? lv.last : Math.max(lv.last, Math.max(0, L - me.z) / VMAX + lv.grace);
      r.events.push({ kind: 'lastcall' });
    }
  }
  if (r.phase === 'racing') {
    const allIn = r.boats.every((b) => b.finished >= 0), flying = r.people.some((p) => p.boat >= 0 && !p.landed);
    if ((allIn && !flying) || (r.lastCall >= 0 && t >= r.lastCall + r.callLength)) { r.phase = 'done'; r.endAt = t; r.events.push({ kind: 'end' }); }
  }
}

function claim(r: Race, tn: Tiny, b: Boat) {
  tn.claimedBy = b.id; tn.claimedAt = r.time;
  tn.people.forEach((pid, k) => { const p = r.people[pid]; p.boat = b.id; p.spot = b.aboard.length; b.aboard.push(pid); p.jumpAt = r.time + 0.15 + k * GAP; });
  r.events.push({ kind: 'claim', boat: b.id, tiny: tn.id, n: tn.people.length });
}

/** aground: wherever the hull's in water shallower than it sits, it's pushed off downhill, and slowed */
function aground(r: Race, b: Boat) {
  let hit = 0;
  for (const [f, s] of [[4.8, 0], [-4.6, 0], [0, 1.9], [0, -1.9], [2.8, 1.5], [2.8, -1.5], [-3, 1.8], [-3, -1.8]]) {
    const [px, pz] = along(b, f, s), hh = heightAt(r.sea, px, pz);
    if (hh <= -DRAFT) continue;
    const [gx, gz] = slopeAt(r.sea, px, pz), g = Math.max(0.08, Math.hypot(gx, gz)), push = Math.min(1.2, (hh + DRAFT) / g + 0.05);
    b.x -= (gx / g) * push; b.z -= (gz / g) * push;
    hit = Math.max(hit, hh + DRAFT);
  }
  if (hit > 0) {
    const before = b.v;
    b.v *= 0.9;
    if (r.time - b.bumpAt > 0.6 && before > 2) { b.bumpAt = r.time; r.events.push({ kind: 'bump', boat: b.id, hard: Math.min(1, before / VMAX) }); }
  }
}

/** big boats push each other apart (three circles down each); a fresh knock slows them a little */
function bumpBoats(r: Race) {
  const R = 2.1;
  for (let i = 0; i < r.boats.length; i++) for (let j = i + 1; j < r.boats.length; j++) {
    const a = r.boats[i], b = r.boats[j];
    if (Math.abs(a.x - b.x) > 14 || Math.abs(a.z - b.z) > 14) continue;
    let hit = 0;
    for (const fa of [-3, 0, 3]) for (const fb of [-3, 0, 3]) {
      const [ax, az] = along(a, fa), [bx, bz] = along(b, fb), dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
      if (d >= 2 * R || d < 1e-4) continue;
      const o = (2 * R - d) / 2, nx = dx / d, nz = dz / d;
      a.x -= nx * o; a.z -= nz * o; b.x += nx * o; b.z += nz * o;
      hit = Math.max(hit, o);
    }
    // (pushed apart, and slowed only by a fresh knock: two boats running side by side aren't held back by it)
    if (hit > 0) for (const c of [a, b]) if (r.time - c.bumpAt > 0.6 && c.v > 2) { c.bumpAt = r.time; c.v *= 0.85; r.events.push({ kind: 'bump', boat: c.id, hard: 0.5 }); }
  }
}

/** what a tiny boat's worth to a boat going for it (or -1: not worth going for) */
function worth(r: Race, b: Boat, tn: Tiny) {
  if (tn.claimedBy >= 0) return -1;
  const dz = tn.z - b.z;
  if (dz < -30 || dz > 210) return -1;
  const eta = (b2: Boat) => Math.hypot(tn.x - b2.x, tn.z - b2.z) / (VMAX * b2.speed) + Math.abs(wrap(Math.atan2(tn.x - b2.x, tn.z - b2.z) - b2.h)) * 0.8;
  const mine = eta(b);
  // (another will plainly get there first: leave it to them)
  for (const o of r.boats) if (o !== b && o.finished < 0 && r.time >= o.wakeAt) { const e = eta(o); if (e < mine * 0.7 && e < 8) return -1; }
  // (out of its lane, worth less: each of the game's boats works its own stretch of the channel, mostly)
  const off = b.ai && !(r.auto && b.id === r.mine) ? (tn.x - (r.sea.centre(tn.z) + b.lane * r.sea.half(tn.z))) / 45 : 0;
  return (Math.pow(tn.people.length, 0.8) / (mine + 3)) * (dz < 0 ? 0.55 : 1) / (1 + off * off);
}

/** the game's boats decide what to go for */
function think(r: Race, b: Boat) {
  const lv = LEVELS[r.level];
  const eta = Math.max(0, L + 4 - b.z) / (VMAX * b.speed * 0.85) + 3;
  if (r.lastCall >= 0) { if (r.callLength - (r.time - r.lastCall) < eta + 4) { b.target = { kind: 'finish' }; return; } }
  else {
    // (too far behind the leader to make the line in the last call, once it's across: on to the finish)
    const lead = Math.max(...r.boats.filter((o) => o !== b).map((o) => o.z)), leadEta = Math.max(0, L - lead) / VMAX;
    if (eta > leadEta + lv.last - 6) { b.target = { kind: 'finish' }; return; }
  }
  let best = -1, bs = 0, second = -1, ss = 0;
  for (const tn of r.tinies) {
    const w = worth(r, b, tn);
    if (w > bs) { second = best; ss = bs; best = tn.id; bs = w; } else if (w > ss) { second = tn.id; ss = w; }
  }
  const cur = b.target.kind === 'tiny' ? worth(r, b, r.tinies[b.target.id]) : -1;
  if (cur > 0 && bs < cur * 1.35) return;
  if (best < 0) { b.target = { kind: 'finish' }; return; }
  if (second >= 0 && b.rnd() < lv.slip) best = second;
  b.target = { kind: 'tiny', id: best };
}

/** where a boat's going: its tiny boat, straight on across the line, or its berth */
function aimOf(r: Race, b: Boat): [number, number] {
  if (b.target.kind === 'tiny') { const tn = r.tinies[b.target.id]; return [tn.x, tn.z]; }
  if (b.target.kind === 'berth') { const p = r.sea.berths[Math.min(4, b.order)]; return [p.x, p.z]; }
  return [clamp(b.x, r.sea.finish[0] + 18, r.sea.finish[1] - 18), L + 30];
}

/** the way toward (heading `want`) clear of land for `dist` ahead, or the nearest way round that is */
export function clearWay(sea: Sea, x: number, z: number, want: number, dist: number) {
  const look = clamp(dist, 10, 36);
  for (const off of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.25, -1.25, 1.6, -1.6, 2.1, -2.1]) {
    const hh = want + off;
    let ok = true;
    for (let s = 4; s <= look && ok; s += 4) if (heightAt(sea, x + Math.sin(hh) * s, z + Math.cos(hh) * s) > -1.8) ok = false;
    if (ok) return hh;
  }
  return want;
}

/** whether the water's deep enough for a boat all along the line from one point to another (and a little either side) */
export function clearLine(sea: Sea, x0: number, z0: number, x1: number, z1: number) {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 3), sx = (z1 - z0) / (d || 1), sz = -(x1 - x0) / (d || 1);
  for (let k = 1; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n, z = z0 + ((z1 - z0) * k) / n;
    for (const s of [0, 2.5, -2.5]) if (heightAt(sea, x + sx * s, z + sz * s) > -1.6) return false;
  }
  return true;
}

/** the water, on a grid of `NAV` metres, as a boat can use it (deep enough at a cell's middle and round it) */
const NAV = 4;
interface Nav { nx: number; nz: number; x0: number; z0: number; ok: Uint8Array }
const navs = new WeakMap<Sea, Nav>();
function navOf(sea: Sea): Nav {
  let n = navs.get(sea);
  if (n) return n;
  const x0 = -200, z0 = -150, nx = Math.floor(400 / NAV), nz = Math.floor((L + 320) / NAV), ok = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + (i + 0.5) * NAV, z = z0 + (j + 0.5) * NAV;
    ok[j * nx + i] = [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].every(([a, c]) => heightAt(sea, x + a, z + c) < -1.4) ? 1 : 0;
  }
  n = { nx, nz, x0, z0, ok };
  navs.set(sea, n);
  return n;
}

/**
 * The way round the land from (x, z) to (tx, tz): a search over the water's grid out from the aim (or the water
 * nearest it) until it reaches the boat, then along the shortest way back from the boat as far as can be seen straight
 * from where it is: that point's the waypoint to steer for. Null if there's no way (it's walled in).
 */
export function routeStep(sea: Sea, x: number, z: number, tx: number, tz: number): [number, number] | null {
  const nav = navOf(sea), { nx, nz, ok } = nav;
  const cell = (px: number, pz: number) => [Math.floor((px - nav.x0) / NAV), Math.floor((pz - nav.z0) / NAV)];
  const centre = (i: number, j: number): [number, number] => [nav.x0 + (i + 0.5) * NAV, nav.z0 + (j + 0.5) * NAV];
  const nearestOk = (i0: number, j0: number) => {
    for (let r = 0; r < 12; r++) for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
      if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r || i < 0 || j < 0 || i >= nx || j >= nz) continue;
      if (ok[j * nx + i]) return j * nx + i;
    }
    return -1;
  };
  const [bi, bj] = cell(x, z), [ti, tj] = cell(tx, tz), from = nearestOk(bi, bj), to = nearestOk(ti, tj);
  if (from < 0 || to < 0) return null;
  const dist = new Int32Array(nx * nz).fill(-1), q = new Int32Array(nx * nz);
  let qh = 0, qt = 0;
  dist[to] = 0; q[qt++] = to;
  while (qh < qt && dist[from] < 0) {
    const c = q[qh++], i = c % nx, j = (c - i) / nx;
    for (const [a, b2] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + a, jj = j + b2;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue;
      const k = jj * nx + ii;
      if (!ok[k] || dist[k] >= 0) continue;
      dist[k] = dist[c] + 1; q[qt++] = k;
    }
  }
  if (dist[from] < 0) return null;
  // (down the distances from the boat toward the aim, keeping the furthest cell seen straight from the boat)
  let c = from, best = centre(from % nx, (from - (from % nx)) / nx);
  for (let s = 0; s < 40 && dist[c] > 0; s++) {
    const i = c % nx, j = (c - i) / nx;
    let next = c;
    for (const [a, b2] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + a, jj = j + b2; if (ii < 0 || jj < 0 || ii >= nx || jj >= nz) continue; const k = jj * nx + ii; if (dist[k] >= 0 && dist[k] < dist[next]) next = k; }
    if (next === c) break;
    c = next;
    const p = centre(c % nx, (c - (c % nx)) / nx);
    if (clearLine(sea, x, z, p[0], p[1])) best = p; else if (s > 3) break;
  }
  return best;
}

/** the game's hand on the wheel: toward its aim, round the land, easing off for a sharp turn */
function drive(r: Race, b: Boat) {
  const lv = LEVELS[r.level];
  if (b.target.kind === 'none' || (b.target.kind === 'tiny' && r.tinies[b.target.id].claimedBy >= 0)) think(r, b);
  let [tx, tz] = aimOf(r, b);
  // (straight at it where the water's clear all the way; else toward the route's next waypoint round the land)
  if (!clearLine(r.sea, b.x, b.z, tx, tz)) {
    if (!b.way || r.time >= b.wayAt) { b.way = routeStep(r.sea, b.x, b.z, tx, tz); b.wayAt = r.time + 0.5; }
    if (b.way) [tx, tz] = b.way;
  } else b.way = null;
  const dist = Math.hypot(tx - b.x, tz - b.z);
  let want = clearWay(r.sea, b.x, b.z, Math.atan2(tx - b.x, tz - b.z), dist) + lv.wobble * Math.sin(r.time * 0.7 + b.id * 1.9) * (b.id === r.mine ? 0 : 1);
  // (and clear of the other boats: away from one ahead, and from one alongside)
  for (const o of r.boats) {
    if (o === b) continue;
    const dx = o.x - b.x, dz = o.z - b.z, d = Math.hypot(dx, dz);
    if (d > 16 || d < 1e-3) continue;
    const rel = wrap(Math.atan2(dx, dz) - b.h), ahead = Math.abs(rel) < 0.7, beside = Math.abs(rel) < 2.2 && d < 9;
    if (ahead || beside) want -= Math.sign(rel || 1) * (ahead ? 0.6 * (1 - d / 16) : 0.35 * (1 - d / 9));
  }
  const diff = wrap(want - b.h);
  b.rudder = clamp(diff * 2.4, -1, 1);
  b.throttle = 1 - 0.45 * smooth(0.6, 1.6, Math.abs(diff));
}

/** across the line: on into the harbour, to its berth, and stop there facing the beach */
function toBerth(r: Race, b: Boat) {
  const [tx, tz] = aimOf(r, b), dist = Math.hypot(tx - b.x, tz - b.z);
  const want = dist > 4 ? clearWay(r.sea, b.x, b.z, Math.atan2(tx - b.x, tz - b.z), dist) : 0;
  b.rudder = clamp(wrap(want - b.h) * 2, -1, 1);
  b.throttle = dist > 4 ? Math.min(0.8, dist / 20) : 0;
}

/**
 * The places: while racing, by most rescued (then across first, then furthest along); when it's over, the boats
 * across the line first, by most rescued (a tie to the one across first), then the rest, by most rescued.
 */
export function standings(r: Race): Boat[] {
  const done = r.phase === 'done';
  // (while racing, by those landed, as the count shows; at the end, by everyone taken on (all landed by then))
  const n = (b: Boat) => (done ? b.aboard.length : b.rescued);
  return [...r.boats].sort((a, b) => {
    const ia = a.finished >= 0, ib = b.finished >= 0;
    if (done && ia !== ib) return ia ? -1 : 1;
    return n(b) - n(a) || (ia && ib ? a.finished - b.finished : ia ? -1 : ib ? 1 : b.z - a.z) || a.id - b.id;
  });
}

/** the race run on with no hand on any wheel but the game's, `seconds` of it (for pictures, tests, the preview) */
export function runFor(r: Race, seconds: number, input: Input = {}) {
  if (r.phase === 'lineup') start(r);
  const n = Math.round(seconds * 60);
  for (let k = 0; k < n; k++) step(r, 1 / 60, input);
}

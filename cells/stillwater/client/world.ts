/**
 * The river as a place: an endless field of lily pads generated ahead of the
 * boat along a meandering channel, every one of them a floating body.
 *
 * WORLD UNITS. One unit is one CSS pixel at zoom 1; +y is downstream-forward
 * (up the screen). The boat sits a little below centre and the camera follows
 * it, so "progress" is the boat really moving through a field that is really
 * there — never a new screen.
 *
 * EVERY PAD IS THE SAME KIND OF THING. Bank pads, channel pads, pads with dew,
 * pads without: one struct, one physics step, one shader. Which ones carry dew
 * is the pond's business (`condense`), not a layout.
 *
 * PHYSICS, kept deliberately soft:
 *   - a slack stem tethers each pad to where it grew, so a pushed pad drifts
 *     back rather than leaving for ever (and drags its anchor if shoved far);
 *   - pad–pad contact is a soft spring with a little friction-to-spin, so a
 *     crowded bank settles overlapping slightly, the way real pads do;
 *   - the boat's hull loads pads downward. They flood, lose collision authority
 *     and can pass beneath the hull; only a soft lateral shoulder and small yaw
 *     remain while the leaf is still near the surface.
 *
 * REBASING. Positions would grow without bound on a long journey; every
 * REBASE units of travel everything shifts back by REBASE. All world-anchored
 * shader noise uses power-of-two periods that divide REBASE, so the seam is
 * invisible.
 */

export const REBASE = 8192;

export interface Drop {
  /** Pad-local position and radius (pad radius = 1). */
  x: number;
  y: number;
  r: number;
  /** Presence 0..1 (animated towards `to`). */
  a: number;
  to: number;
}

export interface Pad {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ang: number;
  va: number;
  ax: number;
  ay: number;
  r: number;
  seed: number;
  bank: boolean;
  /** Planted by a child: their name, faintly, once it is a leaf. */
  planted?: string;
  plantingSeed?: number;
  drops: Drop[];
  /** Selected by the player (the thread passes through it). */
  selected: boolean;
  /** Animated selection glow 0..1. */
  sel: number;
  /** Dip from a tap, decays. */
  bob: number;
  /** Keyboard focus ring. */
  focus: boolean;
  /** 0 = none, else 1 + variant: a water lily blooming on this pad. */
  flower: number;
  /** In contact with the hull last step (to fire a bump only on first touch). */
  touching: boolean;
  /**
   * Soft-body look, not a rigid disk: `dx,dy` points (world) toward where the
   * pad is pressed — by neighbours or the hull — with length = how deep the
   * edge gives there (flattened and riding up, in the shader); `wob` is a
   * decaying flex after an impact.
   */
  dx: number;
  dy: number;
  wob: number;
  /** Contact accumulated this step (pad-radius units, toward the contact). */
  cx: number;
  cy: number;
  /**
   * How far the leaf is pushed UNDER at its pressed edge (0..1) — by an oar
   * blade, a hard tap. The shader floods that part of the leaf; the far edge
   * tips up. `caught`: a blade is holding it this step (for the resurfacing).
   */
  sink: number;
  caught: boolean;
  /** Downward load accumulated by sustained hull/oar contact. */
  load: number;
  /** Vertical momentum of the leaf through the surface. */
  sinkV: number;
  /** Relative buoyant support and softness; generated once with the leaf. */
  support: number;
  compliance: number;
  /** How recently the leaf was substantially flooded (0..1). */
  wet: number;
  /** Seconds of water-heavy dwell remaining after the load leaves. */
  soak: number;
  /** The plant's rhizome on the bed this leaf's stem rises from. */
  rx: number;
  ry: number;
  /** This leaf's age, 0 young (small, yellow-green) … 1 old (large, olive, torn). */
  age: number;
  /** Draw order within a layer. */
  layer: number;
}

/**
 * The small things afloat besides the pads, which make a pond read as a pond:
 * duckweed gathering in rafts in the slack water, petals shed by the lilies,
 * a fallen willow leaf, a closed lily bud. Nothing tethers them: they drift
 * with the current, blow with the wind, part around the hull and the oars and
 * rock outward on every ripple.
 */
/**
 * Something a child planted: where (true distance down the river, and across
 * from the channel's centre there), when, and whose. The river grows it back
 * each visit, older each time (NARRATIVE-DESIGN.md §3).
 */
export interface Planting {
  Y: number;
  dx: number;
  t: number;
  seed: number;
  name: string;
}

/** A crumb from the basket, floating astern until a fish takes it. */
export interface Crumb {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  eaten: boolean;
}

export interface Floater {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ang: number;
  va: number;
  size: number;
  /** 0 duckweed, 1 petal, 2 fallen leaf, 3 lily bud */
  kind: number;
  seed: number;
}

export interface Deep {
  x: number;
  y: number;
  r: number;
  ang: number;
  seed: number;
  depth: number;
  /** A young leaf still under water rises from its plant's rhizome too. */
  rx?: number;
  ry?: number;
}

/**
 * A water lily is a whole plant, not a disc on the water: a rhizome in the mud
 * sends up long stems, each to a leaf (and now and then to a flower or bud),
 * and young leaves unfurl beneath the surface before they reach it. Leaves of
 * one plant share a rhizome, so a cluster of pads is really one plant.
 */
export interface Plant {
  x: number;
  y: number;
  seed: number;
  /** The plant's age, 0 young … 1 old: its leaves are a family, sized and coloured together. */
  age: number;
  /** Rhizome segments on the bed (angle, length). */
  arms: Array<[number, number]>;
}

/** A flower (open) or bud (closed) on its own stem among the leaves, not sitting on one. */
export interface Bloom {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ang: number;
  size: number;
  /** 1 open flower, 0 closed bud */
  open: number;
  variant: number;
  seed: number;
  /** Where its stem lets it rest, and the rhizome it rises from. */
  ax: number;
  ay: number;
  rx: number;
  ry: number;
}

/** A clump of rooted weed on the bed, streaming in the current. */
export interface Weed {
  x: number;
  y: number;
  len: number;
  depth: number;
  seed: number;
  /** 0 ribbon grass, 1 feathery milfoil */
  kind: number;
}

/**
 * The character of a stretch of river, each 0..1. It is sampled everywhere and
 * changes slowly with Y, so the river has REACHES: a tight shaded run becomes
 * a bright lily pool becomes a silty margin. Never a biome, never a level: a
 * stretch has a character for a while, then slowly becomes something else.
 */
export interface Reach {
  /** How broad and open the water is. */
  open: number;
  /** Age of the plant community: small young leaves … enormous battered ones. */
  maturity: number;
  /** Canopy over the water: open sky … deep shade. */
  shade: number;
  /** How much grows: plants, flowers, duckweed. */
  fertility: number;
  /** How quickly the bed disappears with depth; tannin-dark at the top end. */
  turbidity: number;
  /** Current energy: slack … a clear faster channel. */
  flow: number;
  /** Human traces (piers). */
  human: number;
  /** Flowering. */
  flowering: number;
  /** How much of the water the leaves cover. */
  cover: number;
}

/** One arm of open water at a given y: its centre and half width (0 = no water). */
export interface Arm {
  x: number;
  half: number;
}

/** A fork in the river (absolute Y): two arms from y0 for L units; `chosen` once the boat has taken one. */
export interface Fork {
  y0: number;
  L: number;
  side: -1 | 1;
  sep: number;
  chosen: 0 | 1 | null;
}

/**
 * Bank architecture that is scenery first. kind 0 = pier, 1 = blank sign.
 * `state` is reserved for future environmental use and intentionally ignored
 * by physics, input, learning and rendering today.
 */
export interface Landmark {
  id: number;
  key: string;
  x: number;
  y: number;
  ang: number;
  /** Half extents in local space: width across, length along. */
  w: number;
  l: number;
  seed: number;
  kind: 0 | 1;
  side: -1 | 1;
  state: number;
}

/**
 * A breath of wind from a touch: a travelling patch that ruffles the water,
 * pushes and turns pads, scatters fish and specks. A tap is a round puff; a
 * drag is a firm gust along the finger that carries on after it lifts.
 */
export interface Gust {
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** 0..1 */
  s: number;
  r: number;
  age: number;
  life: number;
  radial: boolean;
  /** Still under the finger (it follows the finger and doesn't age). */
  held: boolean;
}

export interface Impulse {
  x: number;
  y: number;
  r: number;
  s: number;
  /** Churns white water too (stern wash, oar catches, hard bumps). */
  foam?: boolean;
}

export interface Bump {
  x: number;
  y: number;
  strength: number;
}

export interface Boat {
  x: number;
  y: number;
  heading: number;
  speed: number;
  /** Speed still to be granted from a solve, fed in smoothly. */
  surge: number;
  stroke: number;
  rowing: number;
  sway: number;
  /** How hard each stroke pulls, 0..1 (the ONLY thing that makes the boat go faster). */
  power: number;
  /** A finger behind the boat steering it (the oars only pull on a tap or a solve). */
  helm: { steer: number } | null;
  /** Stroke phase the oars are working toward: each tap or solved number queues one. */
  strokeTo: number;
  /** Rowing rhythm, 0..1: taps in quick succession pull harder (it fades when they stop). */
  rhythm: number;
  /** A lean on one oar for the stroke in hand (−1 port … 1 starboard): it yaws the boat only while the blades pull. */
  lean: number;
  /** Until this time the boat keeps the heading it was given instead of following the channel. */
  manualUntil: number;
}

export const BOAT_LEN = 112;
/** How fast a ripple front travels (world units/s), matched by eye to the GPU wave sim. */
const RING_SPEED = 62;
export const BOAT_BEAM = 40;

/** The reaches the river passes through (see Reach). Blended, never switched. */
const REACHES: Reach[] = [
  // a tight shaded run under old trees: darker water, dense overhang
  { open: 0.35, maturity: 0.6, shade: 0.9, fertility: 0.4, turbidity: 0.5, flow: 0.5, human: 0.1, flowering: 0.1, cover: 0.55 },
  // a bright lily pool: the canopy opens, the river broadens, a handful of enormous plants
  { open: 0.8, maturity: 0.85, shade: 0.12, fertility: 0.75, turbidity: 0.25, flow: 0.2, human: 0.3, flowering: 0.8, cover: 0.3 },
  // a shallow silty margin: small pads, reeds, the bed in view
  { open: 0.5, maturity: 0.2, shade: 0.35, fertility: 0.6, turbidity: 0.8, flow: 0.3, human: 0.2, flowering: 0.3, cover: 0.6 },
  // old water: enormous battered leaves, tannin-dark, a weathered pier
  { open: 0.4, maturity: 1, shade: 0.6, fertility: 0.5, turbidity: 0.7, flow: 0.12, human: 0.7, flowering: 0.15, cover: 0.85 },
  // a clear faster channel: fewer pads, weed and fish
  { open: 0.85, maturity: 0.4, shade: 0.3, fertility: 0.3, turbidity: 0.08, flow: 0.9, human: 0.1, flowering: 0.2, cover: 0.12 },
  // a quiet flowering basin
  { open: 0.6, maturity: 0.7, shade: 0.2, fertility: 1, turbidity: 0.3, flow: 0.15, human: 0.2, flowering: 1, cover: 0.5 },
];

type Rand = () => number;

export function seeded(seed: number): Rand {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Lay `count` countable drops on a pad of radius `r` (world units), clear of the notch and each other. */
/**
 * Dice-like arrangements for 1–7 (unit grid). Laid this way, a small count is
 * seen at a glance (subitizing), and 6 reads as 3 and 3, 5 as 4 and 1, 7 as 6
 * and 1. As a child's facts grow strong the dew falls back to natural scatter,
 * which asks them to find the structure themselves (concreteness fading).
 */
const PATTERNS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1.1], [-1, 0], [-1, 1.1], [1, -1.1], [1, 0], [1, 1.1]],
  7: [[-1, -1.1], [-1, 0], [-1, 1.1], [0, 0], [1, -1.1], [1, 0], [1, 1.1]],
};

function patternDrops(count: number, base: number, rand: Rand): Drop[] | null {
  const pts = PATTERNS[count];
  if (!pts) return null;
  let nn = Infinity;
  let R = 0;
  for (let i = 0; i < pts.length; i++) {
    R = Math.max(R, Math.hypot(pts[i][0], pts[i][1]));
    for (let j = i + 1; j < pts.length; j++) nn = Math.min(nn, Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]));
  }
  let dr = base;
  let sc = pts.length > 1 ? (2 * dr * 1.3) / nn : 0;
  if (sc * R + dr > 0.7) {
    sc = (0.7 - dr) / Math.max(R, 1e-6);
    dr = Math.min(dr, (sc * nn) / 2.5);
  }
  // turn the pattern so no drop sits in the leaf's notch (which opens along local +y)
  const a0 = rand() * Math.PI * 2;
  for (let tries = 0; tries < 72; tries++) {
    const a = a0 + (tries * Math.PI * 2) / 72;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const out = pts.map(([px, py]) => {
      const x = (px * c - py * s) * sc;
      const y = (px * s + py * c) * sc;
      return { x, y, r: dr * (0.94 + rand() * 0.12), a: 0, to: 1 } as Drop;
    });
    if (out.every((d) => Math.hypot(d.x, d.y) <= 0.12 || Math.abs(Math.atan2(d.x, d.y)) >= 0.46)) return out;
  }
  return null;
}

export function layDrops(count: number, r: number, rand: Rand, pattern = false): Drop[] {
  // dew, not marbles: a drop is a small thing on a leaf
  const base0 = (clamp(0.16 * r, 4.8, 7.4) / r) * (count > 3 ? 0.84 : 1) * (count > 5 ? 0.88 : 1);
  if (pattern) {
    const laid = patternDrops(count, base0, rand);
    if (laid) return laid;
  }
  const out: Drop[] = [];
  const base = base0;
  for (let tries = 0; out.length < count && tries < 400; tries++) {
    const dr = base * (0.82 + rand() * 0.36);
    const ring = 0.72 - dr;
    const rad = Math.sqrt(rand()) * ring;
    const a = rand() * Math.PI * 2;
    const x = Math.sin(a) * rad;
    const y = Math.cos(a) * rad;
    // the notch opens along local +y
    const ang = Math.abs(Math.atan2(x, y));
    if (ang < 0.42 && rad > 0.12) continue;
    if (out.some((d) => Math.hypot(d.x - x, d.y - y) < (d.r + dr) * 1.55)) continue;
    out.push({ x, y, r: dr, a: 0, to: 1 });
  }
  return out;
}

export const liveCount = (p: Pad) => p.drops.reduce((n, d) => n + (d.to > 0 ? 1 : 0), 0);

export class Pond {
  pads: Pad[] = [];
  deep: Deep[] = [];
  impulses: Impulse[] = [];
  bumps: Bump[] = [];
  /**
   * Ripple fronts the CPU keeps track of so pads can FEEL the water: every
   * real splash (a plop, an oar catch or release, a hull bump) spreads a ring
   * at about the wave sim's speed, and a pad bobs, is pushed outward and
   * flexes as the front passes under it.
   */
  rings: Array<{ x: number; y: number; t: number; s: number }> = [];
  crumbs: Crumb[] = [];
  plantings: Planting[] = [];
  /** Days pass this much faster (debug: `?days=` adds days; growth is by calendar time). */
  extraDays = 0;
  /** Water drops falling from a lifted blade (drawn as glints, landing as tiny rings). */
  drips: Array<{ x: number; y: number; age: number; life: number; vx?: number; vy?: number; spray?: boolean }> = [];
  /** Things that startle fish (main.ts relays them to the school). */
  startles: Array<{ x: number; y: number; r: number }> = [];
  /** Sounds the water made this step (main.ts plays them). */
  sounds: Array<{ kind: 'dip' | 'drip' | 'gurgle'; s: number; x: number }> = [];
  weeds: Weed[] = [];
  floaters: Floater[] = [];
  plants: Plant[] = [];
  blooms: Bloom[] = [];
  landmarks: Landmark[] = [];
  gusts: Gust[] = [];
  /** The boat's recent path (newest last): where the wake is drawn from. */
  trail: Array<{ x: number; y: number; hx: number; hy: number; speed: number; t: number }> = [];
  private trailAcc = 0;
  // at rest the oars sit at the finish (stroke .25): a tap pushes the arms away, then pulls
  boat: Boat = { x: 0, y: 0, heading: 0, speed: 0, surge: 0, stroke: 0.25, rowing: 0, sway: 0, power: 0.2, helm: null, manualUntil: 0, strokeTo: 0.25, rhythm: 0, lean: 0 };
  rope: Float32Array;
  ropePrev: Float32Array;
  /** Accumulated rebase offset: world y + origin is the "true" distance travelled. */
  origin = 0;
  private genY = -600;
  private nextId = 1;
  private nextLandmarkId = 1;
  private rand: Rand;
  private landmarkRand: Rand;
  halfW = 420;
  t = 0;
  /** Chooses drops for a freshly grown pad (the game's current stage decides). */
  /** Dew has its own stream: how many drops a leaf gets depends on the stage, and must never move the leaves. */
  private dewRand: Rand;
  dewFor: (rand: Rand) => number = () => 0;
  /** Whether a fresh leaf with this many drops lays them in a pattern (see PATTERNS). */
  patternFor: (count: number, rand: Rand) => boolean = () => false;
  /** More flowers along the water (a welcome back). */
  bloomBoost = 1;

  constructor(seed: number) {
    this.rand = seeded(seed);
    this.dewRand = seeded((seed ^ 0x9e3779b9) >>> 0);
    this.reachSalt = (seed % 977) * 0.0137;
    this.landmarkRand = seeded((seed ^ 0x51f15e) >>> 0);
    this.boat.x = this.channel(0);
    // a painter line off the stern, long enough to stream out and show the water
    // moving, short enough that its cork end stays in view behind the boat
    const n = 26;
    this.rope = new Float32Array(n * 2);
    this.ropePrev = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      this.rope[i * 2] = this.ropePrev[i * 2] = this.boat.x;
      this.rope[i * 2 + 1] = this.ropePrev[i * 2 + 1] = -BOAT_LEN * 0.48 - i * 5.4;
    }
  }

  /** Which flower: mostly white and pink lilies, some yellow and double rose, spatterdock, the odd spent one. */
  static bloomKind(u: number): number {
    return u < 0.3 ? 1 : u < 0.48 ? 2 : u < 0.6 ? 3 : u < 0.72 ? 4 : u < 0.9 ? 5 : 6;
  }

  /** Channel centre line: a slow meander, in rebased world y. */
  /**
   * FORKS. Now and then the river splits into two arms around an island of
   * leaves. Both are real water for a stretch; once the boat is clearly in one,
   * the river commits to it: the meander carries on from that arm, and the
   * other narrows into leaves off screen. A fork is a choice the child makes by
   * steering (or by drifting), and the river remembers it.
   */
  forks: Fork[] = [];
  /** Absolute Y of the next fork. */
  nextForkY = 2600;

  // ── reaches ──
  private reachTable: Array<{ y0: number; L: number; blend: number; kind: number }> = [];
  private reachSalt = 0;

  private hash(n: number, k: number): number {
    const v = Math.sin(n * 127.1 + k * 311.7 + this.reachSalt) * 43758.5453;
    return v - Math.floor(v);
  }

  private reachIndex(Y: number): number {
    if (!this.reachTable.length) this.reachTable.push({ y0: -3000, L: 2400, blend: 500, kind: 1 }); // the river begins in a lily pool
    for (;;) {
      const last = this.reachTable[this.reachTable.length - 1];
      if (Y < last.y0 + last.L) break;
      const i = this.reachTable.length;
      // never the same reach twice running; old water and the clear channel are rarer
      let kind = (last.kind + 1 + Math.floor(this.hash(i, 1) * 5)) % 6;
      if ((kind === 3 || kind === 4) && this.hash(i, 4) < 0.4) kind = (kind + 1) % 6;
      this.reachTable.push({ y0: last.y0 + last.L, L: 1000 + 1100 * this.hash(i, 2), blend: 450 + 650 * this.hash(i, 3), kind });
    }
    let lo = 0;
    while (lo < this.reachTable.length - 1 && Y >= this.reachTable[lo].y0 + this.reachTable[lo].L) lo++;
    return lo;
  }

  /** The character of the river at an absolute Y, blended over 450–1,100 units between reaches. */
  reachAt(Y: number): Reach {
    const i = this.reachIndex(Y);
    const r = this.reachTable[i];
    const a = REACHES[r.kind];
    const t = smooth(r.y0 + r.L - r.blend, r.y0 + r.L, Y);
    if (t <= 0) return a;
    const b = REACHES[this.reachTable[this.reachIndex(r.y0 + r.L)].kind];
    const out = {} as Reach;
    for (const k of Object.keys(a) as Array<keyof Reach>) out[k] = a[k] + (b[k] - a[k]) * t;
    return out;
  }

  /** The reach at a world y. */
  reachHere(y: number): Reach {
    return this.reachAt(y + this.origin);
  }

  /** The river's own line, before any fork (absolute Y). */
  private meander(Y: number): number {
    return 95 * Math.sin(Y / 1150) + 42 * Math.sin(Y / 430 + 1.3) + 16 * Math.sin(Y / 170 + 4.1);
  }

  /** What the forks so far have added to the line (absolute Y). */
  private forkOffset(Y: number): number {
    let off = 0;
    for (const f of this.forks) if (f.chosen !== null && Y >= f.y0 + f.L) off += f.chosen === 1 ? f.side * f.sep : -f.side * f.sep * 0.4;
    return off;
  }

  /** The line the field is grown about (the midline of a fork). */
  fieldCentre(y: number): number {
    const Y = y + this.origin;
    return this.meander(Y) + this.forkOffset(Y);
  }

  private halfAt(Y: number): number {
    // the river breathes on its own, and broadens through the open reaches
    return (84 + 28 * Math.sin(Y / 760 + 0.4) + 14 * Math.sin(Y / 290 + 2.2)) * (0.55 + 0.9 * this.reachAt(Y).open);
  }

  /** The arms of open water at this y: one, or two through a fork. */
  arms(y: number): Arm[] {
    const Y = y + this.origin;
    const base = this.meander(Y) + this.forkOffset(Y);
    const h = this.halfAt(Y);
    const f = this.forks.find((k) => Y >= k.y0 && Y < k.y0 + k.L);
    if (!f) return [{ x: base, half: h }];
    const t = (Y - f.y0) / f.L;
    const sp = smooth(0, 0.4, t);
    // the arms part over the first 40%: one keeps on, the other swings out to the side
    const d0 = -f.side * f.sep * 0.4 * sp;
    const d1 = f.side * f.sep * sp;
    // each arm keeps most of the river's width (a narrow arm chokes under the leaves' overhang)
    const narrow = h * (1 - 0.2 * sp);
    const widen = (k: number) => (f.chosen === k ? h * smooth(0.7, 1, t) + narrow * (1 - smooth(0.7, 1, t)) : narrow);
    const taper = (k: number) => (f.chosen !== null && f.chosen !== k ? 1 - smooth(0.74, 0.95, t) : 1);
    return [
      { x: base + d0, half: widen(0) * taper(0) },
      { x: base + d1, half: widen(1) * taper(1) },
    ];
  }

  /** The arm nearest an x at this y. */
  nearestArm(y: number, x: number): Arm {
    const a = this.arms(y);
    if (a.length === 1) return a[0];
    // a dead arm (tapered away) is no longer water: prefer the live one unless it is far off
    const d0 = Math.abs(x - a[0].x) + (a[0].half < 6 ? 1e4 : 0);
    const d1 = Math.abs(x - a[1].x) + (a[1].half < 6 ? 1e4 : 0);
    return d0 <= d1 ? a[0] : a[1];
  }

  /** Channel centre line at this y: the arm nearest `nearX` (the boat, by default). */
  channel(y: number, nearX = this.boat.x): number {
    return this.nearestArm(y, nearX).x;
  }

  /** Open-water half width: breathes between a narrow run and a wide pool. */
  channelHalf(y: number, nearX = this.boat.x): number {
    return this.nearestArm(y, nearX).half;
  }

  /** How open the water is at a point (1 mid-run, 0 under the leaves), over every arm. */
  openness(x: number, y: number): number {
    let o = 0;
    for (const a of this.arms(y)) if (a.half > 0.5) o = Math.max(o, 1 - smooth(a.half * 0.35, a.half + 120, Math.abs(x - a.x)));
    return o;
  }

  /** The fork the boat is in, and how far through it (for the debug surface). */
  forkState(): { t: number; chosen: number | null; arms: number } | null {
    const Y = this.boat.y + this.origin;
    const f = this.forks.find((k) => Y >= k.y0 - 400 && Y < k.y0 + k.L);
    if (!f) return null;
    return { t: Math.round(((Y - f.y0) / f.L) * 100) / 100, chosen: f.chosen, arms: this.arms(this.boat.y).length };
  }

  /**
   * Committing to an arm: once the boat is 30% through a fork, the arm it is in
   * becomes the river. The far end of the other arm (well beyond the view) is
   * regrown so it narrows into leaves.
   */
  private commitForks() {
    const Y = this.boat.y + this.origin;
    for (const f of this.forks) {
      if (f.chosen !== null || Y < f.y0 + f.L * 0.3) continue;
      const a = this.arms(this.boat.y);
      if (a.length < 2) {
        // a fork the boat is already past (a jump downstream): the river kept straight on
        f.chosen = 0;
        continue;
      }
      f.chosen = Math.abs(this.boat.x - a[0].x) <= Math.abs(this.boat.x - a[1].x) ? 0 : 1;
      const from = f.y0 + f.L * 0.72 - this.origin;
      if (from < this.genY) this.regrow(this.halfW, from);
    }
  }

  /**
   * The current (world units / s): along the channel's line, fastest in open
   * water, slack under the banks, with slow eddies turning where it slows.
   * The surface shader computes the same shape from the same channel samples,
   * so what the water shows and what the pads feel agree.
   */
  /** `flow` sampled on a 32-unit grid, remembered for one step: the floaters ask it thousands of times. */
  private flowCache = new Map<number, [number, number]>();
  flowNear(x: number, y: number): [number, number] {
    const gx = Math.round(x / 32);
    const gy = Math.round(y / 32);
    const key = gx * 65536 + gy + 32768 * 65536;
    let v = this.flowCache.get(key);
    if (!v) {
      v = this.flow(gx * 32, gy * 32);
      this.flowCache.set(key, v);
    }
    return v;
  }

  flow(x: number, y: number): [number, number] {
    const arm = this.nearestArm(y, x);
    const cx = arm.x;
    const slope = (this.channel(y + 20, x) - this.channel(y - 20, x)) / 40;
    const n = Math.hypot(slope, 1);
    const tx = slope / n;
    const ty = 1 / n;
    const half = arm.half;
    const open = half > 0.5 ? 1 - smooth(half * 0.35, half + 120, Math.abs(x - cx)) : 0;
    const speed = 2.5 + 11 * open;
    // eddies: a slow curl field, strongest where open water meets the banks
    const Y = y + this.origin;
    const e = (1 - open) * open * 4 * 7;
    const ex = Math.sin(Y / 97 + x / 131 + this.t * 0.05) * e;
    const ey = Math.cos(x / 89 - Y / 143 + this.t * 0.04) * e * 0.6;
    return [tx * speed + ex, ty * speed + ey];
  }

  /** Depth of the bed (the shader's depthAt, less its fine noise) — where stems end. */
  bedDepth(x: number, y: number): number {
    return 0.22 + 0.78 * this.openness(x, y);
  }

  /** The plant a new leaf at (x, y) belongs to: a rhizome close by, or a new plant. */
  private plantFor(x: number, y: number): Plant {
    let best: Plant | null = null;
    let bd = 125;
    for (let i = this.plants.length - 1; i >= 0 && i >= this.plants.length - 60; i--) {
      const pl = this.plants[i];
      const d = Math.hypot(pl.x - x, pl.y - y);
      if (d < bd) {
        bd = d;
        best = pl;
      }
    }
    if (best) return best;
    const rand = this.rand;
    const a = rand() * Math.PI * 2;
    const d = 15 + rand() * 35;
    const arms: Array<[number, number]> = [];
    for (let k = 0, n = 2 + Math.floor(rand() * 3); k < n; k++) arms.push([rand() * Math.PI * 2, 14 + rand() * 26]);
    const age = clamp(this.reachHere(y).maturity + (rand() - 0.5) * 0.7, 0, 1);
    const pl: Plant = { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, seed: rand(), age, arms };
    this.plants.push(pl);
    return pl;
  }

  /** A touch's breath of wind (see Gust). */
  gust(g: Omit<Gust, 'age'>): Gust {
    const full = { ...g, age: 0 };
    this.gusts.push(full);
    if (this.gusts.length > 6) this.gusts.shift();
    return full;
  }

  /** Current strength 0..1 of a gust (rises fast, falls slow). */
  static gustLevel(g: Gust): number {
    if (g.held) return g.s;
    const k = g.age / g.life;
    return g.s * Math.min(1, k * 8) * Math.pow(Math.max(0, 1 - k), 1.6);
  }

  /** Grow pads until the field reaches `yMax`. */
  ensure(yMax: number) {
    while (this.genY < yMax) {
      const y0 = this.genY;
      this.genY += 200;
      this.grow(y0, this.genY);
    }
  }

  /** Plant a seed here: a planting the river will grow back, older each visit. */
  plant(x: number, y: number, name: string, now = Date.now()): Planting {
    const pl: Planting = { Y: y + this.origin, dx: x - this.fieldCentre(y), t: now, seed: Math.random(), name };
    this.plantings.push(pl);
    this.impulses.push({ x, y, r: 5, s: 0.5 });
    this.rings.push({ x, y, t: this.t, s: 0.45 });
    return pl;
  }

  /** How far a planting has come, in days (calendar time, plus any debug days). */
  ageDays(pl: Planting, now = Date.now()): number {
    return Math.max(0, (now - pl.t) / 86400_000) + this.extraDays;
  }

  /**
   * What a planting has grown into by now: under water the first half day; a
   * small leaf by the second; a proper leaf carrying the child's name by the
   * third; and after five days, a flower of its own beside it.
   */
  sprout(pl: Planting, now = Date.now()) {
    const y = pl.Y - this.origin;
    const x = this.fieldCentre(y) + pl.dx;
    const rand = seeded(Math.floor(pl.seed * 1e9));
    const days = this.ageDays(pl, now);
    // never on top of the boat's own start water
    if (Math.abs(y - this.boat.y) < BOAT_LEN && Math.abs(x - this.boat.x) < BOAT_BEAM + 60) return;
    if (days < 0.5) {
      this.deep.push({ x, y, r: 9 + days * 8, ang: rand() * Math.PI * 2, seed: rand(), depth: 0.55 - days * 0.3 });
      return;
    }
    const grown = smooth(0.5, 5, days);
    const r = 14 + 24 * grown;
    // make room: a planted leaf pushes the wild ones aside a little
    for (const p of this.pads) {
      const d = Math.hypot(p.x - x, p.y - y);
      const need = p.r + r + 4;
      if (d < need && d > 1e-3) { p.x += ((p.x - x) / d) * (need - d); p.y += ((p.y - y) / d) * (need - d); p.ax = p.x; p.ay = p.y; }
    }
    const plant = this.plantFor(x, y);
    const pad: Pad = {
      id: this.nextId++, x, y, vx: 0, vy: 0, ang: rand() * Math.PI * 2, va: 0, ax: x, ay: y, r, seed: rand(), bank: false,
      plantingSeed: pl.seed, planted: days >= 2 ? pl.name : undefined, drops: [], selected: false, sel: 0, bob: 0, focus: false, flower: 0, touching: false,
      dx: 0, dy: 0, wob: 0, cx: 0, cy: 0, sink: 0, caught: false, load: 0, sinkV: 0, support: 0.82 + Math.min(0.28, r / 260),
      compliance: 0.85 + smooth(42, 96, r) * 0.55, wet: 0, soak: 0, rx: plant.x, ry: plant.y, age: Math.min(1, grown * 0.7), layer: 1,
    };
    this.pads.push(pad);
    if (days >= 5) {
      const a = rand() * Math.PI * 2;
      const d = r + 12;
      const bx = x + Math.cos(a) * d;
      const by = y + Math.sin(a) * d;
      this.blooms.push({ x: bx, y: by, vx: 0, vy: 0, ang: rand() * Math.PI * 2, size: 14 + 5 * smooth(5, 9, days), open: 1, variant: Pond.bloomKind(rand()), seed: rand(), ax: bx, ay: by, rx: plant.x, ry: plant.y });
    }
  }

  /** Sprout every planting that lies in ground already grown (used when a child's plantings load). */
  sproutGrown(yMin: number) {
    for (const pl of this.plantings) {
      const y = pl.Y - this.origin;
      if (y > yMin && y < this.genY) this.sprout(pl);
    }
  }

  private growFloaters(y0: number, y1: number, span: number) {
    const rand = this.rand;
    const add = (x: number, y: number, kind: number, size: number) =>
      this.floaters.push({ x, y, vx: 0, vy: 0, ang: rand() * Math.PI * 2, va: 0, size, kind, seed: rand() });
    // duckweed rafts: patches in the slack water, dense at their hearts, fraying at the edges
    const patches = Math.round(((y1 - y0) * span) / 70000 + rand());
    for (let i = 0; i < patches; i++) {
      const y = y0 + rand() * (y1 - y0);
      const armsHere = this.arms(y);
      const arm = armsHere[Math.floor(rand() * armsHere.length)];
      const cx = arm.x;
      const half = arm.half;
      const side = rand() < 0.5 ? -1 : 1;
      const x = cx + side * (half * (0.45 + rand() * 0.9));
      const pr = 22 + rand() * 60;
      // area-dense at the heart, a ragged fringe: a raft, not a sprinkle
      const n = Math.min(240, Math.round(pr * pr * 0.035));
      const stretch = 1 + rand() * 0.8;
      for (let k = 0; k < n; k++) {
        const a = rand() * Math.PI * 2;
        const d = Math.pow(rand(), 0.55) * pr * (0.75 + 0.35 * Math.sin(a * 3 + i));
        add(x + Math.cos(a) * d * stretch, y + Math.sin(a) * d, 0, 1.6 + rand() * 1.5);
      }
    }
    // a sprinkle of loose fronds everywhere slack
    const loose = Math.round(((y1 - y0) * span) / 22000);
    for (let i = 0; i < loose; i++) {
      const y = y0 + rand() * (y1 - y0);
      add(this.fieldCentre(y) + (rand() * 2 - 1) * (this.halfW + 60), y, 0, 1.4 + rand() * 1.4);
    }
    // petals shed around the open flowers
    for (const b of this.blooms) {
      if (!b.open || b.y < y0 || b.y >= y1) continue;
      const n = 2 + Math.floor(rand() * 4);
      for (let k = 0; k < n; k++) {
        const a = rand() * Math.PI * 2;
        const d = b.size * (1.3 + rand() * 2.5);
        add(b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, 1, 5 + rand() * 3);
      }
    }
    // the odd fallen willow leaf
    if (rand() < 0.7) {
      const y = y0 + rand() * (y1 - y0);
      add(this.fieldCentre(y) + (rand() * 2 - 1) * this.halfW, y, 2, 11 + rand() * 7);
    }
  }

  /** Flowers and buds: afloat on a stem — pushed about, rocked by ripples, drawn back to where they stand. */
  private stepBlooms(dt: number, active: { y0: number; y1: number }) {
    const b = this.boat;
    const hs = Math.sin(b.heading);
    const hc = Math.cos(b.heading);
    const half = BOAT_LEN * 0.4;
    const tips = b.rowing > 0.3 && Math.cos(b.stroke * Math.PI * 2) > 0.05 ? [this.oarTip(-1), this.oarTip(1)] : [];
    const t = this.t;
    for (const f of this.blooms) {
      if (f.y < active.y0 || f.y > active.y1) continue;
      const dx0 = f.x - f.ax;
      const dy0 = f.y - f.ay;
      const d0 = Math.hypot(dx0, dy0);
      if (d0 > 6) {
        f.vx -= (dx0 / d0) * (d0 - 6) * 1.4 * dt;
        f.vy -= (dy0 / d0) * (d0 - 6) * 1.4 * dt;
      }
      const [fx, fy] = this.flow(f.x, f.y);
      const [wx, wy] = this.wind(f.x, f.y);
      f.vx += (fx * 0.3 + wx * 0.5) * dt;
      f.vy += (fy * 0.3 + wy * 0.5) * dt;
      const u = clamp(((f.x - (b.x - hs * half)) * hs + (f.y - (b.y - hc * half)) * hc) / (half * 2), 0, 1);
      const qx = f.x - (b.x - hs * half + hs * half * 2 * u);
      const qy = f.y - (b.y - hc * half + hc * half * 2 * u);
      const qd = Math.hypot(qx, qy) || 1;
      const reach = BOAT_BEAM * 0.5 + f.size;
      if (qd < reach) {
        f.vx += (qx / qd) * (reach - qd) * 10 * dt;
        f.vy += (qy / qd) * (reach - qd) * 10 * dt;
      }
      for (const [tx, ty] of tips) {
        const dx = f.x - tx;
        const dy = f.y - ty;
        const d = Math.hypot(dx, dy) || 1;
        if (d < f.size + 8) {
          f.vx += ((dx / d) * 14 - hs * 20) * dt * 3;
          f.vy += ((dy / d) * 14 - hc * 20) * dt * 3;
        }
      }
      for (const r of this.rings) {
        const age = t - r.t;
        const dx = f.x - r.x;
        const dy = f.y - r.y;
        const d = Math.hypot(dx, dy) || 1;
        if (Math.abs(d - age * RING_SPEED) > f.size) continue;
        const k = (r.s * Math.exp(-age * 0.9)) / (1 + d / 90);
        f.vx += (dx / d) * k * 30 * dt;
        f.vy += (dy / d) * k * 30 * dt;
      }
      const drag = Math.exp(-1.6 * dt);
      f.vx *= drag;
      f.vy *= drag;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.ang += Math.sin(t * 0.3 + f.seed * 20) * 0.02 * dt;
    }
  }

  private stepFloaters(dt: number, active: { y0: number; y1: number }) {
    const b = this.boat;
    const hs = Math.sin(b.heading);
    const hc = Math.cos(b.heading);
    const half = BOAT_LEN * 0.4;
    const tips = this.boat.rowing > 0.3 && Math.cos(b.stroke * Math.PI * 2) > 0.05 ? [this.oarTip(-1), this.oarTip(1)] : [];
    const drag = Math.exp(-1.4 * dt);
    const t = this.t;
    const gusty = this.gusts.length > 0;
    for (const f of this.floaters) {
      if (f.y < active.y0 || f.y > active.y1) continue;
      const light = f.kind === 3 ? 0.35 : 1;
      const [fx, fy] = this.flowNear(f.x, f.y);
      const [wx, wy] = gusty ? this.wind(f.x, f.y) : [0, 0];
      f.vx += ((fx * 0.8 - f.vx) * 0.6 + wx * 1.1 * light) * dt;
      f.vy += ((fy * 0.8 - f.vy) * 0.6 + wy * 1.1 * light) * dt;
      // the hull parts them, and the boat's passage drags them along its sides
      const lx = f.x - (b.x - hs * half);
      const ly = f.y - (b.y - hc * half);
      const u = clamp((lx * hs + ly * hc) / (half * 2), 0, 1);
      const qx = f.x - (b.x - hs * half + hs * half * 2 * u);
      const qy = f.y - (b.y - hc * half + hc * half * 2 * u);
      const qd = Math.hypot(qx, qy) || 1;
      const reach = BOAT_BEAM * 0.55 + f.size;
      if (qd < reach) {
        f.vx += (qx / qd) * (reach - qd) * 14 * dt + hs * b.speed * 0.6 * dt;
        f.vy += (qy / qd) * (reach - qd) * 14 * dt + hc * b.speed * 0.6 * dt;
        f.va += (Math.random() - 0.5) * 4 * dt;
      }
      // blades in the drive sweep them aft
      for (const [tx, ty] of tips) {
        const dx = f.x - tx;
        const dy = f.y - ty;
        const d = Math.hypot(dx, dy);
        if (d < 18) {
          f.vx += ((dx / (d || 1)) * 20 - hs * 30) * dt * 3;
          f.vy += ((dy / (d || 1)) * 20 - hc * 30) * dt * 3;
          f.va += (Math.random() - 0.5) * 6 * dt;
        }
      }
      // every ripple rocks them outward as it passes
      for (const r of this.rings) {
        const age = t - r.t;
        const dx = f.x - r.x;
        const dy = f.y - r.y;
        const d = Math.hypot(dx, dy) || 1;
        if (Math.abs(d - age * RING_SPEED) > 10) continue;
        const k = (r.s * Math.exp(-age * 0.9)) / (1 + d / 90);
        f.vx += (dx / d) * k * 60 * dt;
        f.vy += (dy / d) * k * 60 * dt;
      }
      f.vx *= drag;
      f.vy *= drag;
      f.va *= Math.exp(-1.5 * dt);
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.ang += f.va * dt;
    }
  }

  /**
   * Sparse human traces at the bank. A separate RNG keeps their introduction
   * from perturbing the established flora / numeracy ecology.
   */
  /** `?pier=1`: a jetty just ahead at the start (to look at it, and to bump it). */
  forcePier = false;
  private forcedPier = false;

  private growLandmarks(y0: number, y1: number) {
    if (y1 < 300 && !this.forcePier) return;
    const place = (Y: number, slot: number) => {
      const rand = seeded(Math.floor(this.hash(slot, 82) * 1e9));
      const y = Y - this.origin;
      const side: -1 | 1 = rand() < 0.5 ? -1 : 1;
      // the arm on this side of the river
      const probe = this.fieldCentre(y) + side * 400;
      const cx = this.channel(y, probe);
      const half = this.channelHalf(y, probe);
      const slope = (this.channel(y + 12, probe) - this.channel(y - 12, probe)) / 24;
      const nn = Math.hypot(1, slope);
      const ox = side / nn;
      const oy = (-side * slope) / nn;
      // a plank jetty: long and narrow, reaching from beyond the grown field (so it comes
      // in from off screen) to a little way into the run
      // a landing among the leaves: broad, and short — its tip stops just past the leaf line,
      // its root just beyond the view (the field is grown 160 wider than the view)
      const w = 13 + rand() * 3;
      const innerD = half + 10 + rand() * 20;
      const outerD = this.halfW - 60 + rand() * 40;
      const tipX = cx + ox * innerD;
      const tipY = y + oy * innerD;
      const rootX = cx + ox * outerD;
      const rootY = y + oy * outerD;
      const x = (tipX + rootX) * 0.5;
      const py = (tipY + rootY) * 0.5;
      const l = Math.hypot(tipX - rootX, tipY - rootY) * 0.5;
      // local +Y points from root toward the water
      const dirX = (tipX - rootX) / Math.max(1, l * 2);
      const dirY = (tipY - rootY) / Math.max(1, l * 2);
      const ang = Math.atan2(-dirX, dirY);
      this.landmarks.push({ id: this.nextLandmarkId++, key: `pier:${slot}`, x, y: py, ang, w, l, seed: rand(), kind: 0, side, state: 0 });
    };
    if (this.forcePier && !this.forcedPier && y1 > this.boat.y + 260) {
      this.forcedPier = true;
      place(this.boat.y + this.origin + 260, -999);
    }
    // Absolute bands survive resizing, rebasing and visits on another screen size.
    const a = y0 + this.origin, b = y1 + this.origin;
    for (let slot = Math.floor(a / 200); slot <= Math.floor(b / 200); slot++) {
      const Y = slot * 200 + 20 + this.hash(slot, 81) * 160;
      if (Y >= 300 && Y >= a && Y < b && this.hash(slot, 80) < 0.035 && !this.landmarks.some(m => m.key === `pier:${slot}`)) place(Y, slot);
    }
  }

  /** A jetty's piles (world): pairs either side of the deck every 36 units. */
  pierPiles(m: Landmark): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    const c = Math.cos(m.ang);
    const sn = Math.sin(m.ang);
    for (let ly = -m.l + 14; ly < m.l - 6; ly += 36) {
      for (const sx of [-1, 1]) {
        const lx = sx * (m.w + 2.5);
        out.push([m.x + lx * c - ly * sn, m.y + lx * sn + ly * c]);
      }
    }
    return out;
  }

  /**
   * The boat cannot pass a jetty: the hull meets the deck's edge and stops,
   * knocks, and is turned away by the corner it caught. Leaves drift under the
   * deck between the piles, and bump off the piles themselves.
   */
  private collidePiers(dt: number) {
    const b = this.boat;
    const hullR = BOAT_BEAM * 0.5;
    for (const m of this.landmarks) {
      if (Math.abs(m.x - b.x) > m.l + 200 || Math.abs(m.y - b.y) > m.l + 200) continue;
      const c = Math.cos(m.ang);
      const sn = Math.sin(m.ang);
      const toLocal = (x: number, y: number): [number, number] => [(x - m.x) * c + (y - m.y) * sn, -(x - m.x) * sn + (y - m.y) * c];
      // the keel, sampled from stern to bow
      const hx = Math.sin(b.heading);
      const hy = Math.cos(b.heading);
      let deepest = 0;
      let nx = 0;
      let ny = 0;
      let at = 0;
      for (let k = -2; k <= 2; k++) {
        const along = (k / 2) * BOAT_LEN * 0.42;
        const px = b.x + hx * along;
        const py = b.y + hy * along;
        const [lx, ly] = toLocal(px, py);
        // signed distance to the deck rectangle, in its frame
        const dx = Math.abs(lx) - m.w;
        const dy = Math.abs(ly) - m.l;
        const ox = Math.max(dx, 0);
        const oy = Math.max(dy, 0);
        const outside = Math.hypot(ox, oy);
        const inside = Math.min(Math.max(dx, dy), 0);
        const d = outside + inside;
        const pen = hullR - d;
        if (pen <= deepest) continue;
        // the outward normal, in local then world
        let gx: number;
        let gy: number;
        if (outside > 0) {
          gx = (ox / outside) * Math.sign(lx || 1);
          gy = (oy / outside) * Math.sign(ly || 1);
        } else if (dx > dy) {
          gx = Math.sign(lx || 1);
          gy = 0;
        } else {
          gx = 0;
          gy = Math.sign(ly || 1);
        }
        deepest = pen;
        nx = gx * c - gy * sn;
        ny = gx * sn + gy * c;
        at = along;
      }
      if (deepest <= 0) {
        if (m.state === 1) m.state = 0;
        continue;
      }
      // push out, take the way off the boat, and turn it away by the point it caught
      b.x += nx * deepest;
      b.y += ny * deepest;
      const into = Math.max(0, -(hx * nx + hy * ny)) * b.speed;
      b.speed = Math.max(0, b.speed - into * 0.9 - deepest * 2 * dt);
      const cross = hx * ny - hy * nx;
      b.heading -= cross * Math.sign(at || 1) * deepest * 0.012;
      if (m.state !== 1) {
        m.state = 1;
        const strength = clamp(into / 30 + deepest / 12, 0.15, 1);
        this.bumps.push({ x: b.x + hx * at - nx * hullR, y: b.y + hy * at - ny * hullR, strength });
        this.impulses.push({ x: b.x + hx * at - nx * hullR, y: b.y + hy * at - ny * hullR, r: 9, s: 0.5 + strength * 0.5, foam: true });
      }
      b.strokeTo = Math.min(b.strokeTo, b.stroke); // a jetty in the way ends the stroke in hand
    }
    // leaves bump off the piles (and slide under the deck between them)
    for (const m of this.landmarks) {
      const piles = this.pierPiles(m);
      for (const p of this.pads) {
        if (Math.abs(p.x - m.x) > m.l + p.r + 20 || Math.abs(p.y - m.y) > m.l + p.r + 20) continue;
        for (const [px, py] of piles) {
          const dx = p.x - px;
          const dy = p.y - py;
          const lim = p.r * 0.9 + 4;
          if (Math.abs(dx) > lim || Math.abs(dy) > lim) continue;
          const d = Math.hypot(dx, dy) || 1;
          if (d >= lim) continue;
          const push = lim - d;
          p.x += (dx / d) * push * 0.5;
          p.y += (dy / d) * push * 0.5;
          p.vx += (dx / d) * push * 2;
          p.vy += (dy / d) * push * 2;
          p.cx -= (dx / d) * (push / p.r) * 0.8;
          p.cy -= (dy / d) * (push / p.r) * 0.8;
        }
      }
    }
  }

  /** Regrow everything around the boat (after a resize wider than the field was grown for). */
  regrow(halfW: number, yMin: number) {
    this.halfW = halfW;
    this.pads = this.pads.filter((p) => p.y < yMin);
    this.deep = this.deep.filter((d) => d.y < yMin);
    this.weeds = this.weeds.filter((w) => w.y < yMin);
    this.floaters = this.floaters.filter((f) => f.y < yMin);
    this.plants = this.plants.filter((pl) => pl.y < yMin);
    this.blooms = this.blooms.filter((b) => b.y < yMin);
    this.landmarks = this.landmarks.filter((m) => m.y < yMin);
    this.genY = yMin;
  }

  private grow(y0: number, y1: number) {
    const rand = this.rand;
    // a fork ahead? decide it before anything in this band is placed
    if (y1 + this.origin >= this.nextForkY) {
      this.forks.push({ y0: this.nextForkY, L: 1700, side: rand() < 0.5 ? -1 : 1, sep: 250 + rand() * 50, chosen: null });
      this.nextForkY += 1700 + 3500 + rand() * 4500;
    }
    const span = this.halfW * 2 + 200;
    const reachMid = this.reachHere((y0 + y1) / 2);
    const attempts = Math.round((((y1 - y0) * span) / 260) * (0.65 + 0.7 * reachMid.fertility));
    const near = this.pads.filter((p) => p.y > y0 - 160);
    for (let i = 0; i < attempts; i++) {
      const y = y0 + rand() * (y1 - y0);
      const Y = y + this.origin;
      const reach = this.reachHere(y);
      const x = this.fieldCentre(y) + (rand() * 2 - 1) * (this.halfW + 100);
      const arm = this.nearestArm(y, x);
      const cx = arm.x;
      const off = Math.abs(x - cx);
      const half = arm.half;
      const bank = off > half;
      // leaves on the water: how much they cover it is the reach's
      if (!bank && rand() > 0.008 + 0.06 * reach.cover) continue;
      // where a rhizome has died back there is a gap in the carpet (more where it is poor)
      const gapField = 0.5 + 0.5 * Math.sin(x / 150 + Y / 260) * Math.sin(Y / 190 - x / 330);
      if (bank && gapField < 0.6 * (1 - reach.fertility)) continue;
      // open reaches keep broad empty water: the carpet stands back from it
      if (bank && off < half + 220 && rand() < (reach.open - 0.45) * 0.9) continue;
      const deepness = smooth(half, half + 260, off);
      // the leaf's age comes from its plant (a family), the plant's from the reach:
      // a few tiny emergent leaves, mostly middle-aged, the odd giant in old water
      const plant = this.plantFor(x, y);
      let age = clamp(plant.age + (rand() - 0.5) * 0.3, 0, 1);
      if (rand() < 0.08) age = rand() * 0.12;
      const young = 12 + rand() * 18;
      const mid = 26 + rand() * 28;
      const giant = 58 + rand() * 50;
      let r = young + (mid - young) * smooth(0, 0.45, age);
      r += (giant - r) * smooth(0.66, 1, age) * (0.5 + 0.5 * reach.maturity);
      r += deepness * 12 * rand();
      if (!bank) r *= 0.75;
      const spacing = bank ? 0.72 : 1.05;
      let ok = true;
      for (const p of near) {
        const need = (p.r + r) * (p.bank && bank ? spacing : 1.0);
        if (Math.abs(p.y - y) < need && Math.hypot(p.x - x, p.y - y) < need) {
          ok = false;
          break;
        }
      }
      // leave the boat's own water clear at the start
      if (ok && Math.abs(y - this.boat.y) < BOAT_LEN && Math.abs(x - this.boat.x) < BOAT_BEAM + r + 30) ok = false;
      if (!ok) continue;
      const flower = 0;
      const count = this.dewFor(this.dewRand);
      const pad: Pad = {
        id: this.nextId++,
        x,
        y,
        vx: 0,
        vy: 0,
        ang: rand() * Math.PI * 2,
        va: 0,
        ax: x,
        ay: y,
        r,
        seed: rand(),
        bank,
        drops: [],
        selected: false,
        sel: 0,
        bob: 0,
        focus: false,
        flower,
        touching: false,
        dx: 0,
        dy: 0,
        wob: 0,
        cx: 0,
        cy: 0,
        sink: 0,
        caught: false,
        load: 0,
        sinkV: 0,
        // Large old leaves have more area, but softer stems and retain more
        // water: they yield slowly rather than behaving like rigid islands.
        support: 0.82 + Math.min(0.28, r / 260),
        compliance: 0.85 + smooth(42, 96, r) * 0.55 + rand() * 0.12,
        wet: 0,
        soak: 0,
        rx: plant.x,
        ry: plant.y,
        age,
        layer: rand(),
      };
      pad.drops = layDrops(count, r, this.dewRand, count > 0 && this.patternFor(count, this.dewRand));
      for (const d of pad.drops) d.a = 1;
      this.pads.push(pad);
      near.push(pad);
    }
    // each plant born in this stretch: young leaves still under water, and now
    // and then a flower or a bud on its own stem, standing among the leaves
    for (const pl of this.plants) {
      if (pl.y < y0 || pl.y >= y1) continue;
      const young = rand() < 0.55 ? 1 + Math.floor(rand() * 2) : 0;
      for (let k = 0; k < young; k++) {
        const a = rand() * Math.PI * 2;
        const d = 12 + rand() * 30;
        this.deep.push({ x: pl.x + Math.cos(a) * d, y: pl.y + Math.sin(a) * d, r: 10 + rand() * 14, ang: rand() * Math.PI * 2, seed: rand(), depth: 0.3 + rand() * 0.35, rx: pl.x, ry: pl.y });
      }
      if (rand() < 0.3 * this.bloomBoost) {
        // find open water among its leaves for the flower to stand in
        for (let tries = 0; tries < 8; tries++) {
          const a = rand() * Math.PI * 2;
          const d = 25 + rand() * 60;
          const bx = pl.x + Math.cos(a) * d;
          const by = pl.y + Math.sin(a) * d;
          if (this.padAt(bx, by, near)) continue;
          const open = rand() < 0.65 ? 1 : 0;
          this.blooms.push({ x: bx, y: by, vx: 0, vy: 0, ang: rand() * Math.PI * 2, size: open ? 13 + rand() * 6 : 7 + rand() * 3, open, variant: Pond.bloomKind(rand()), seed: rand(), ax: bx, ay: by, rx: pl.x, ry: pl.y });
          break;
        }
      }
    }
    // and a few leaves sunk or drowned far from any plant
    const deepCount = Math.round(((y1 - y0) * span) / 90000);
    for (let i = 0; i < deepCount; i++) {
      const y = y0 + rand() * (y1 - y0);
      this.deep.push({ x: this.fieldCentre(y) + (rand() * 2 - 1) * (this.halfW + 80), y, r: 22 + rand() * 30, ang: rand() * Math.PI * 2, seed: rand(), depth: 0.5 + rand() * 0.4 });
    }
    for (const pl of this.plantings) {
      const y = pl.Y - this.origin;
      if (y >= y0 && y < y1) this.sprout(pl);
    }
    this.growFloaters(y0, y1, span);
    this.growLandmarks(y0, y1);
    // weed beds root in the shallows toward the banks, sparser in the open run
    const weedCount = Math.round(((y1 - y0) * span) / 2600);
    for (let i = 0; i < weedCount; i++) {
      const y = y0 + rand() * (y1 - y0);
      const x = this.fieldCentre(y) + (rand() * 2 - 1) * (this.halfW + 60);
      if (this.openness(x, y) > 0.55 && rand() > 0.25) continue;
      this.weeds.push({ x, y, len: 30 + rand() * 60, depth: 0.45 + rand() * 0.6, seed: rand(), kind: rand() < 0.35 ? 1 : 0 });
    }
    this.pads.sort((a, b) => Number(b.bank) - Number(a.bank) || a.layer - b.layer);
  }

  /**
   * A flower opens beside a leaf: a bud rises on the leaf's own plant, just
   * off its edge in open water, and opens. Returns the bloom (its size and
   * `open` are eased by the caller).
   */
  bloomBeside(p: Pad, rand: Rand): Bloom | null {
    const near = this.pads.filter((q) => Math.abs(q.x - p.x) < 200 && Math.abs(q.y - p.y) < 200);
    for (let tries = 0; tries < 10; tries++) {
      const a = rand() * Math.PI * 2;
      const d = p.r + 8 + rand() * 10;
      const bx = p.x + Math.cos(a) * d;
      const by = p.y + Math.sin(a) * d;
      if (this.padAt(bx, by, near)) continue;
      const b: Bloom = { x: bx, y: by, vx: 0, vy: 0, ang: rand() * Math.PI * 2, size: 6, open: 0, variant: Pond.bloomKind(rand() * 0.72), seed: rand(), ax: bx, ay: by, rx: p.rx, ry: p.ry };
      this.blooms.push(b);
      return b;
    }
    return null;
  }

  /** Forget what is far behind. Selected pads are kept so a selection never vanishes mid-gesture. */
  cull(yMin: number) {
    this.pads = this.pads.filter((p) => p.y > yMin || p.selected);
    this.deep = this.deep.filter((d) => d.y > yMin);
    this.weeds = this.weeds.filter((w) => w.y > yMin);
    this.floaters = this.floaters.filter((f) => f.y > yMin);
    this.plants = this.plants.filter((pl) => pl.y > yMin - 200);
    this.blooms = this.blooms.filter((b) => b.y > yMin);
    this.landmarks = this.landmarks.filter((m) => m.y > yMin - 120);
  }

  rebaseIfNeeded(): number {
    if (this.boat.y < REBASE) return 0;
    const s = REBASE;
    this.origin += s;
    this.genY -= s;
    this.boat.y -= s;
    for (const p of this.pads) {
      p.y -= s;
      p.ay -= s;
      p.ry -= s;
    }
    for (const d of this.deep) {
      d.y -= s;
      if (d.ry !== undefined) d.ry -= s;
    }
    for (const w of this.weeds) w.y -= s;
    for (const f of this.floaters) f.y -= s;
    for (const pl of this.plants) pl.y -= s;
    for (const b of this.blooms) {
      b.y -= s;
      b.ay -= s;
      b.ry -= s;
    }
    for (const m of this.landmarks) m.y -= s;
    for (const g of this.gusts) g.y -= s;
    for (const p of this.trail) p.y -= s;
    for (const p of this.puddles) p.y -= s;
    for (const c of this.crumbs) c.y -= s;
    for (const e of this.eddies) e.y -= s;
    this.lastTip = [null, null];
    for (const r of this.rings) r.y -= s;
    for (const d of this.drips) d.y -= s;
    for (let i = 1; i < this.rope.length; i += 2) {
      this.rope[i] -= s;
      this.ropePrev[i] -= s;
    }
    return s;
  }

  /** Grant forward glide for a solve: roughly `distance` units, fed in over a couple of seconds. */
  propel(distance: number) {
    // spent as full-power strokes: roughly one strong stroke per 40 units asked for
    const n = clamp(Math.round(distance / 40), 1, 3);
    this.boat.surge += n * 25;
    this.queueStrokes(n);
  }

  /** Queue whole strokes (at most two ahead of the one in hand). */
  private queueStrokes(n: number) {
    const b = this.boat;
    b.strokeTo = Math.min(b.stroke + 2.999, Math.max(b.strokeTo, b.stroke) + n);
  }

  bow(): [number, number] {
    const b = this.boat;
    return [b.x + Math.sin(b.heading) * BOAT_LEN * 0.4, b.y + Math.cos(b.heading) * BOAT_LEN * 0.4];
  }

  /**
   * A fingertip resting on a dry leaf (set by the page while the finger stays down),
   * as an offset from the leaf's centre so it rides along as the leaf drifts.
   */
  held: { pad: Pad; ox: number; oy: number } | null = null;

  step(dt: number, active: { y0: number; y1: number }, reduced: boolean) {
    this.t += dt;
    this.flowCache.clear();
    this.stepGusts(dt);
    this.stepBoat(dt, reduced);
    this.collidePiers(dt);
    this.commitForks();
    this.stepPads(dt, active);
    this.stepFloaters(dt, active);
    this.stepCrumbs(dt);
    this.stepBlooms(dt, active);
    this.stepRope(dt);
  }

  private stepGusts(dt: number) {
    for (const g of this.gusts) {
      if (g.held) continue;
      g.age += dt;
      if (!g.radial) {
        // a gust runs on across the water as a cat's paw
        const v = 70 + 90 * g.s;
        g.x += g.dx * v * dt;
        g.y += g.dy * v * dt;
        g.r += dt * 30;
      } else g.r += dt * 60;
    }
    this.gusts = this.gusts.filter((g) => g.held || g.age < g.life);
    // the wind drives waves: a front of little crests along its leading edge,
    // and a scatter of cat's-paw ripples inside it
    for (const g of this.gusts) {
      const lvl = Pond.gustLevel(g);
      if (lvl < 0.05) continue;
      if (g.radial) {
        // a puff only pushes; the tap itself made the one plop (see main.ts)
      } else {
        const px = -g.dy;
        const py = g.dx;
        for (let i = -3; i <= 3; i++) {
          const o = (i / 3) * g.r * 0.8 + (Math.random() - 0.5) * 12;
          const f = g.r * (0.35 + Math.random() * 0.25);
          this.impulses.push({ x: g.x + g.dx * f + px * o, y: g.y + g.dy * f + py * o, r: 6, s: 0.5 * lvl });
        }
      }
      for (let i = 0; i < (g.radial ? 0 : 3); i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * g.r;
        this.impulses.push({ x: g.x + Math.cos(a) * d, y: g.y + Math.sin(a) * d, r: 4, s: 0.3 * lvl });
      }
    }
  }

  /** Wind acceleration at a point (units/s²), summed over the live gusts. */
  wind(x: number, y: number): [number, number] {
    let wx = 0;
    let wy = 0;
    for (const g of this.gusts) {
      const dx = x - g.x;
      const dy = y - g.y;
      const d = Math.hypot(dx, dy);
      if (d > g.r * 1.3) continue;
      const k = Pond.gustLevel(g) * (1 - smooth(g.r * 0.4, g.r * 1.3, d));
      if (g.radial) {
        wx += (dx / (d || 1)) * k * 70;
        wy += (dy / (d || 1)) * k * 70;
      } else {
        wx += g.dx * k * 90;
        wy += g.dy * k * 90;
      }
    }
    return [wx, wy];
  }

  /** One long pull on the oars (a tap on the boat). */
  /**
   * A tap: one stroke. Taps in quick succession find a rhythm and pull harder;
   * `bias` (−1 left … 1 right, where the tap fell across the boat) leans on
   * that oar for the stroke, so the pull itself turns the boat a little.
   */
  stroke(bias = 0) {
    const b = this.boat;
    b.rhythm = Math.min(1, b.rhythm + 0.4);
    b.lean = clamp(bias, -1, 1);
    // a deliberate lean holds the heading it wins for a while (as a drag does), so
    // taps to one side add up; a centred tap leaves the river to steer
    if (Math.abs(b.lean) > 0.25) b.manualUntil = Math.max(b.manualUntil, this.t + 3.5);
    this.queueStrokes(1);
  }

  /**
   * Is a world point in the water behind the boat (astern, roughly within the
   * river's width of its wake)? Touch there drives the boat, so the finger
   * never covers the water it's heading into.
   */
  behindBoat(x: number, y: number): boolean {
    const b = this.boat;
    const c = Math.cos(b.heading);
    const s = Math.sin(b.heading);
    const lx = (x - b.x) * c - (y - b.y) * s;
    const ly = (x - b.x) * s + (y - b.y) * c;
    return ly < -BOAT_LEN * 0.4 && Math.abs(lx) < 150;
  }

  /** A world point in the boat's frame: across (right positive) and along (bow positive). */
  /** A pinch from the basket: `n` crumbs tossed over the stern, drifting aft on the water. */
  scatterCrumbs(n = 1) {
    const b = this.boat;
    const hx = Math.sin(b.heading);
    const hy = Math.cos(b.heading);
    for (let i = 0; i < n; i++) {
      const across = (Math.random() - 0.5) * 22;
      const [x, y] = this.boatWorld(across, -BOAT_LEN * 0.5 - 14 - Math.random() * 14);
      this.crumbs.push({ x, y, vx: -hx * (20 + Math.random() * 12) + hy * across * 0.4, vy: -hy * (20 + Math.random() * 12) - hx * across * 0.4, age: 0, eaten: false });
      this.impulses.push({ x, y, r: 3.5, s: 0.18 });
    }
  }

  private stepCrumbs(dt: number) {
    for (const c of this.crumbs) {
      c.age += dt;
      const [fx, fy] = this.flow(c.x, c.y);
      const k = Math.exp(-1.6 * dt);
      c.vx = c.vx * k + fx * (1 - k);
      c.vy = c.vy * k + fy * (1 - k);
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      // the hull is solid to a crumb: one the boat overtakes or swings over slides round the side
      const [lx, ly] = this.boatLocal(c.x, c.y);
      const halfB = BOAT_BEAM * 0.5 + 5;
      const halfL = BOAT_LEN * 0.5 + 4;
      if (Math.abs(lx) < halfB && Math.abs(ly) < halfL) {
        const side = lx >= 0 ? 1 : -1;
        const [nx, ny] = this.boatWorld(side * halfB, ly);
        c.x = nx;
        c.y = ny;
        const b = this.boat;
        c.vx += Math.cos(b.heading) * side * 12;
        c.vy += -Math.sin(b.heading) * side * 12;
      }
    }
    // a crumb the fish leave sinks after a while
    this.crumbs = this.crumbs.filter((c) => !c.eaten && c.age < 50);
  }

  /** The world position of a point given in the boat's frame (x across, y along, bow +). */
  boatWorld(lx: number, ly: number): [number, number] {
    const b = this.boat;
    const c = Math.cos(b.heading);
    const s = Math.sin(b.heading);
    return [b.x + lx * c + ly * s, b.y - lx * s + ly * c];
  }

  boatLocal(x: number, y: number): [number, number] {
    const b = this.boat;
    const c = Math.cos(b.heading);
    const s = Math.sin(b.heading);
    return [(x - b.x) * c - (y - b.y) * s, (x - b.x) * s + (y - b.y) * c];
  }

  /** Is a world point on the boat (hull, with a little grace)? */
  onBoat(x: number, y: number): boolean {
    const b = this.boat;
    const c = Math.cos(b.heading);
    const s = Math.sin(b.heading);
    const lx = (x - b.x) * c - (y - b.y) * s;
    const ly = (x - b.x) * s + (y - b.y) * c;
    return Math.abs(lx) < BOAT_BEAM * 0.5 + 16 && Math.abs(ly) < BOAT_LEN * 0.5 + 12;
  }

  /**
   * The boat never waits. It always rows gently on down the river (the
   * journey is endless; the dew only adds to it). A finger on the boat takes
   * the helm: it turns toward the finger and rows harder the further ahead
   * the finger is; let go and it holds that course a while before drifting
   * back to the channel.
   */
  /**
   * The oars are the only engine. The stroke cadence stays calm and nearly
   * constant; what changes is how hard each stroke pulls (`power`). Thrust
   * comes only while the blades are in the water (the drive, cos(2π·stroke)
   * > 0), so the boat surges on each pull and glides, slowing, between them.
   * A gentle cruise pulls lightly; a finger at the helm pulls harder the
   * further ahead it is; a tap on the boat or a solved number spends `surge`
   * on full-power strokes.
   */
  private stepBoat(dt: number, reduced: boolean) {
    const b = this.boat;
    let want: number;
    if (b.helm) {
      want = clamp(b.helm.steer, -1.2, 1.2);
      b.manualUntil = this.t + 4;
    } else if (this.t < b.manualUntil) {
      want = b.heading;
    } else {
      const look = 170;
      want = clamp(Math.atan2(this.channel(b.y + look) - b.x, look), -0.42, 0.42) + Math.sin(this.t * 0.13) * 0.04;
    }
    // the oars only work while a stroke is owed (a tap, or a solved number): the arms
    // push away, the blades go in and pull, and then the boat glides, waiting.
    // A rhythm of taps pulls harder; the lean from an off-centre tap fades
    b.rhythm *= Math.exp(-0.2 * dt);
    const pending = b.strokeTo - b.stroke;
    const working = pending > 1e-4;
    if (!working) b.lean = 0;
    const effort = working ? (b.surge > 0 ? 1 : 0.55 + 0.45 * b.rhythm) : 0.2;
    b.power += (effort - b.power) * (1 - Math.exp(-(working ? 6 : 1.5) * dt));
    b.rowing += ((working ? 1 : 0) - b.rowing) * (1 - Math.exp(-(working ? 7 : 2.2) * dt));
    const prev = b.stroke;
    if (working) {
      // recovery (.25 → .75) is unhurried; the drive (.75 → 1.25) quicker and firmer
      const inDrive = Math.cos(b.stroke * Math.PI * 2) > 0;
      const cadence = (inDrive ? 0.6 : 0.42) * (reduced ? 0.8 : 1);
      b.stroke = Math.min(b.strokeTo, b.stroke + dt * cadence);
      if (inDrive) {
        b.surge = Math.max(0, b.surge - dt * 25);
        // one oar pulling harder than the other: the boat yaws with the pull itself
        // (about 5° over a stroke at a full lean, more with a harder pull)
        b.heading += b.lean * Math.cos(b.stroke * Math.PI * 2) * b.power * b.rowing * dt * 0.28;
      }
    }
    // thrust only from blades in the water; water drag always
    const drive = Math.max(0, Math.cos(b.stroke * Math.PI * 2));
    // tuned so a tap's stroke swings the boat up to ~30 and a solve's strong pulls ~50, and
    // the glide between pulls carries (a heavy wooden boat keeps its way)
    const THRUST = 62;
    b.speed += (THRUST * b.power * drive * b.rowing - 0.3 * b.speed - 0.0035 * b.speed * b.speed) * dt;
    b.speed = Math.max(0, b.speed);
    // the rudder is the oars too: the boat only turns as fast as it moves
    b.heading += (want - b.heading) * (1 - Math.exp(-dt * (0.15 + b.speed / (b.helm ? 25 : 40))));
    // the current carries the boat a little; a gust leans on it
    const [fx, fy] = this.flow(b.x, b.y);
    const [wx, wy] = this.wind(b.x, b.y);
    b.x += (Math.sin(b.heading) * b.speed + fx * 0.25 + wx * 0.06) * dt;
    b.y += (Math.cos(b.heading) * b.speed + Math.max(0, fy) * 0.25 + wy * 0.06) * dt;
    b.heading += (Math.cos(b.heading) * wx - Math.sin(b.heading) * wy) * 0.0009 * dt;
    b.sway = Math.sin(this.t * 0.7) * 0.012 + Math.sin(this.t * 0.31) * 0.01;
    this.oarWater(prev, dt);
    this.wake(dt);
    this.trailAcc += dt;
    if (this.trailAcc > 0.08) {
      this.trailAcc = 0;
      this.trail.push({ x: b.x, y: b.y, hx: Math.sin(b.heading), hy: Math.cos(b.heading), speed: b.speed, t: this.t });
      while (this.trail.length && this.t - this.trail[0].t > 9) this.trail.shift();
    }
  }

  /**
   * Water moved by the oars. The stroke cycle: the blade drops in at the
   * catch (frac 0.75, oars furthest forward), drives aft through the water
   * while cos(2π·stroke) > 0, and lifts out at the release (frac 0.25).
   *   catch   a splash and a little white water
   *   drive   the blade drags a line of disturbance, and every so often sheds
   *           a packet of pushed water that travels AFT — the way the stroke
   *           threw it — and a little outward, stirring the surface as it
   *           goes and slowing to rest
   *   release the classic pair of swirls either side of where the blade left
   */
  private lastTip: Array<[number, number] | null> = [null, null];
  puddles: Array<{ x: number; y: number; vx: number; vy: number; age: number; life: number; s: number }> = [];
  private shedAcc = 0;
  eddies: Array<{ x: number; y: number; vx: number; vy: number; age: number; life: number; spin: number; s: number; phase: number }> = [];
  private eddyAcc = 0;

  private shedEddies(x: number, y: number, strength: number, hx: number, hy: number) {
    for (const sign of [-1, 1]) this.eddies.push({
      x: x + hy * sign * 5, y: y - hx * sign * 5,
      vx: -hx * (8 + strength * 14), vy: -hy * (8 + strength * 14),
      age: 0, life: 3.2 + Math.random() * 1.2, spin: sign,
      s: strength, phase: Math.random() * Math.PI * 2,
    });
    if (this.eddies.length > 12) this.eddies.splice(0, this.eddies.length - 12);
  }

/** The pad covering a world point, if any (nearest centre wins). */
  padAt(x: number, y: number, pads: Pad[] = this.pads): Pad | null {
    let best: Pad | null = null;
    let bd = Infinity;
    for (const p of pads) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < p.r * 0.92 && d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /**
   * Something meets the water here. On open water: a ripple (and a ring the
   * pads will feel). On a leaf: no ripple on top of it — the leaf takes it,
   * dipping, shoved away from the point and flexing.
   */
  splash(x: number, y: number, r: number, s: number, foam = false, pads?: Pad[]): Pad | null {
    const p = this.padAt(x, y, pads);
    if (p) {
      // a leaf doesn't hop out of the way: the blow presses it down where it lands
      const dx = x - p.x;
      const dy = y - p.y;
      p.sink = Math.min(1, Math.max(p.sink, s * 0.45));
      p.cx += (dx / p.r) * 1.5 * s;
      p.cy += (dy / p.r) * 1.5 * s;
      p.bob = Math.min(1, p.bob + s * 0.25);
      p.wob = Math.min(1, p.wob + s * 0.2);
      p.vx -= (dx / p.r) * s * 2;
      p.vy -= (dy / p.r) * s * 2;
      // a blade striking a leaf still throws white water: it churns where the leaf is pushed
      // under, and the flooded film over the leaf shows it (PAD_FS samples the sim's foam)
      if (foam) this.impulses.push({ x, y, r, s: s * 0.6, foam: true });
      return p;
    }
    this.impulses.push({ x, y, r, s, foam });
    if (s >= 0.6) {
      this.rings.push({ x, y, t: this.t, s });
      if (this.rings.length > 40) this.rings.shift();
    }
    return null;
  }

  private oarWater(prev: number, dt: number) {
    const b = this.boat;
    const crossed = (at: number) => b.stroke - prev > 0 && Math.floor(prev - at) !== Math.floor(b.stroke - at);
    const hx = Math.sin(b.heading);
    const hy = Math.cos(b.heading);
    const k = b.rowing * (0.3 + 0.7 * b.power);
    const near = this.pads.filter((p) => Math.abs(p.x - b.x) < 160 && Math.abs(p.y - b.y) < 160);
    const rowing = b.rowing > 0.3;
    const drive = Math.cos(b.stroke * Math.PI * 2);

    // the catch: blades drop in with a plunk; fish near them bolt
    if (rowing && crossed(0.75)) {
      for (const side of [-1, 1]) {
        const [tx, ty] = this.oarTip(side);
        this.splash(tx, ty, 7, 1.2 * k, true, near);
        this.startles.push({ x: tx, y: ty, r: 90 });
      }
      this.sounds.push({ kind: 'dip', s: k, x: b.x });
    }

    // the drive: blades in the water shoulder leaves aside and throw water aft
    if (rowing && drive > 0.05) {
      this.shedAcc += dt;
      this.eddyAcc += dt;
      const shedEddy = this.eddyAcc > 0.32;
      if (shedEddy) this.eddyAcc = 0;
      const shed = this.shedAcc > 0.12;
      if (shed) this.shedAcc = 0;
      for (const side of [-1, 1]) {
        const [tx, ty] = this.oarTip(side);
        // a blade that comes down on a leaf CATCHES it: the struck edge goes under,
        // the leaf is dragged along with the blade (which is locked in the water while
        // the boat passes it — so, back along the boat), and the dew there is washed off
        const last = this.lastTip[side < 0 ? 0 : 1];
        const tvx = last ? (tx - last[0]) / Math.max(dt, 1e-3) : 0;
        const tvy = last ? (ty - last[1]) / Math.max(dt, 1e-3) : 0;
        for (const p of near) {
          const dx = tx - p.x;
          const dy = ty - p.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d > p.r + 4) continue;
          const into = Math.min(1, (p.r + 4 - d) / (p.r * 0.55));
          p.caught = true;
          p.sink = Math.min(1, Math.max(p.sink, (0.35 + 0.65 * into) * drive));
          p.cx += (dx / p.r) * 2.2;
          p.cy += (dy / p.r) * 2.2;
          // held by the blade: its motion follows the blade's, and a little aft with the pull
          const hold = 5 * drive * dt;
          p.vx += (tvx - hx * 6 * drive - p.vx) * hold;
          p.vy += (tvy - hy * 6 * drive - p.vy) * hold;
          p.va += ((dx * (tvy - p.vy) - dy * (tvx - p.vx)) / (p.r * p.r)) * 0.5 * hold;
          p.wob = Math.min(1, p.wob + drive * dt);
          // water pours over the flooded edge and froths there: the blade churns just as
          // hard on a leaf as in open water, only the white shows at the rim, not under it
          if (Math.random() < dt * 10) this.impulses.push({ x: p.x + (dx / d) * p.r, y: p.y + (dy / d) * p.r, r: 5, s: 0.35, foam: true });
          const rim = Math.atan2(dx, dy) + (Math.random() - 0.5) * 1.1;
          const rr = p.r * (1.02 + Math.random() * 0.12);
          this.impulses.push({ x: p.x + Math.sin(rim) * rr, y: p.y + Math.cos(rim) * rr, r: 7, s: 0.6 * k * drive * into * dt * 60, foam: true });
          if (!p.selected) {
            const c = Math.cos(p.ang);
            const sn = Math.sin(p.ang);
            for (const dr of p.drops) {
              if (dr.to <= 0) continue;
              const wx = p.x + (c * dr.x - sn * dr.y) * p.r;
              const wy = p.y + (sn * dr.x + c * dr.y) * p.r;
              if (Math.hypot(wx - tx, wy - ty) < p.r * 0.55 * p.sink + 4) dr.to = 0;
            }
          }
        }
        this.lastTip[side < 0 ? 0 : 1] = [tx, ty];
        // the blade churns white water whether it is in open water or pressing a leaf under:
        // on a leaf the white shows on the flooded film over it, where the blade is
        const onLeaf = this.padAt(tx, ty, near);
        this.impulses.push({ x: tx, y: ty, r: 7, s: 0.7 * k * drive * dt * 60, foam: true });
        if (!onLeaf && shedEddy) this.shedEddies(tx, ty, k * drive * 0.6, hx, hy);
        if (shed) {
          // pushed water leaves aft, a little outward, faster the harder the pull
          const ox = hy * side;
          const oy = -hx * side;
          const v = 14 + b.power * 32;
          this.puddles.push({ x: tx, y: ty, vx: -hx * v + ox * 7, vy: -hy * v + oy * 7, age: 0, life: 1.8, s: 0.55 * k * drive });
        }
      }
    }

    if (!(rowing && drive > 0.05)) this.lastTip = [null, null];

    // the release: a pair of swirls where the blade left
    if (rowing && crossed(0.25)) {
      this.sounds.push({ kind: 'gurgle', s: k, x: b.x });
      for (const side of [-1, 1]) {
        const [tx, ty] = this.oarTip(side);
        const px = hy * 5;
        const py = -hx * 5;
        this.splash(tx + px, ty + py, 6, 0.9 * k, true, near);
        this.splash(tx - px, ty - py, 6, 0.9 * k, true, near);
        if (!this.padAt(tx, ty, near)) {
          this.shedEddies(tx, ty, k, hx, hy);
          for (let j = 0; j < 9; j++) this.drips.push({
            x: tx + (Math.random() - 0.5) * 18 - hx * j,
            y: ty + (Math.random() - 0.5) * 18 - hy * j,
            age: 0, life: 0.18 + Math.random() * 0.3,
            vx: -hx * 10 + (Math.random() - 0.5) * 20, vy: -hy * 10 + (Math.random() - 0.5) * 20, spray: true,
          });
        }
      }
    }

    // the recovery: water runs off the lifted blades and drips back in
    if (rowing && drive < -0.05) {
      for (const side of [-1, 1]) {
        if (Math.random() < dt * 9 * (-drive)) {
          const [tx, ty] = this.oarTip(side);
          this.drips.push({ x: tx + (Math.random() - 0.5) * 5, y: ty + (Math.random() - 0.5) * 5, age: 0, life: 0.18 + Math.random() * 0.1 });
        }
      }
    }
    for (const d of this.drips) {
      d.age += dt;
      d.x += (d.vx ?? 0) * dt; d.y += (d.vy ?? 0) * dt;
      if (d.age >= d.life) {
        const hit = this.splash(d.x, d.y, 3, 0.35, false, near);
        if (!hit) this.sounds.push({ kind: 'drip', s: 0.5 + Math.random() * 0.5, x: d.x });
      }
    }
    this.drips = this.drips.filter((d) => d.age < d.life);

    // Counter-rotating blade-tip wakes: expanding, slowing, advected by flow.
    for (const e of this.eddies) {
      e.age += dt;
      const [fx, fy] = this.flow(e.x, e.y);
      e.vx *= Math.exp(-1.1 * dt); e.vy *= Math.exp(-1.1 * dt);
      e.x += (e.vx + fx) * dt; e.y += (e.vy + fy) * dt;
      const fade = Math.max(0, 1 - e.age / e.life);
      const radius = 5 + e.age * 5;
      e.phase += e.spin * 2.8 * fade * dt;
      if (Math.random() < dt * 18) {
        const a = e.phase + Math.random() * 2.5;
        this.impulses.push({ x: e.x + Math.sin(a) * radius, y: e.y + Math.cos(a) * radius,
          r: 3.5, s: e.s * fade * 0.45, foam: e.age < 1.2 });
      }
      for (const fl of this.floaters) {
        const dx = fl.x - e.x, dy = fl.y - e.y, d2 = dx * dx + dy * dy;
        if (d2 > radius * radius * 4) continue;
        const pull = e.s * fade * Math.exp(-d2 / (radius * radius)) * dt * 2;
        fl.vx += dy * e.spin * pull; fl.vy -= dx * e.spin * pull;
      }
    }
    this.eddies = this.eddies.filter(e => e.age < e.life);

    // the travelling packets stir the water along their way, slowing as they go
    for (const p of this.puddles) {
      p.age += dt;
      const drag = Math.exp(-1.6 * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const fade = 1 - p.age / p.life;
      const under = this.padAt(p.x, p.y, near);
      if (under) {
        // pushed water arriving under a leaf nudges it along instead
        under.vx += p.vx * 0.04 * fade;
        under.vy += p.vy * 0.04 * fade;
        p.age = p.life;
        continue;
      }
      // the thrown water carries its froth with it, so the white is laid down in a streak astern
      if (Math.random() < dt * 24) this.impulses.push({ x: p.x, y: p.y, r: 5 + p.age * 3, s: p.s * fade, foam: p.age < 1.3 && Math.random() < 0.55 });
    }
    this.puddles = this.puddles.filter((p) => p.age < p.life);
  }

  /**
   * The hull's wake. A hull is a steady dent in the water that only makes waves
   * by MOVING: each frame it disturbs the water in proportion to how far it has
   * just travelled, at the stem where it parts the water, along the shoulders
   * that throw the arms of the V, and at the stern quarters where it closes
   * again. A stationary boat radiates nothing, and a slow one only a whisper,
   * instead of a pulsed point source ringing out around it (and ahead of it).
   */
  private wake(dt: number) {
    const b = this.boat;
    if (b.speed < 1) return;
    const d = b.speed * dt; // units moved this frame
    const k = Math.min(1, b.speed / 40);
    const c = Math.cos(b.heading);
    const s = Math.sin(b.heading);
    const at = (lx: number, ly: number): [number, number] => [b.x + lx * c + ly * s, b.y - lx * s + ly * c];
    // slow boats hardly make a bow wave at all; it builds with speed
    const w = d * (0.4 + 1.4 * k);
    const [bx, by] = at(0, BOAT_LEN * 0.45);
    this.impulses.push({ x: bx, y: by, r: 6, s: w * 0.7 });
    for (const side of [-1, 1]) {
      const [qx, qy] = at(side * BOAT_BEAM * 0.48, BOAT_LEN * 0.2);
      this.impulses.push({ x: qx, y: qy, r: 6, s: w * 0.8 });
      const [sx, sy] = at(side * BOAT_BEAM * 0.3, -BOAT_LEN * 0.5);
      this.impulses.push({ x: sx, y: sy, r: 7, s: w * 0.6, foam: k > 0.4 && Math.random() < 0.08 });
    }
  }

  /** Oar blade tip in world space (side -1 port, +1 starboard). */
  oarTip(side: number): [number, number] {
    const b = this.boat;
    const sweep = this.oarAngle();
    const lx = side * (BOAT_BEAM * 0.42 + Math.cos(sweep) * 56);
    const ly = 4 - Math.sin(sweep) * 30;
    const c = Math.cos(b.heading);
    const s = Math.sin(b.heading);
    return [b.x + lx * c + ly * s, b.y - lx * s + ly * c];
  }

  /** Current oar sweep (radians): resting when idle, a slow stroke when rowing. */
  oarAngle(): number {
    const b = this.boat;
    const stroke = Math.sin(b.stroke * Math.PI * 2);
    // a harder pull is a LONGER stroke: the blades reach further forward and sweep further back
    const reach = 0.22 + 0.42 * b.power;
    // at rest the blades sit where the stroke finishes (stroke .25), so a tap starts
    // from there without a jump: the arms push away first, then pull
    return 0.35 + (stroke * reach - 0.1) + Math.sin(this.t * 0.5) * 0.04;
  }

  private stepPads(dt: number, active: { y0: number; y1: number }) {
    this.rings = this.rings.filter((r) => this.t - r.t < 3.5);
    const pads = this.pads.filter((p) => p.y > active.y0 && p.y < active.y1);
    const b = this.boat;
    const hc = Math.cos(b.heading);
    const hs = Math.sin(b.heading);
    const bvx = hs * b.speed;
    const bvy = hc * b.speed;
    const half = BOAT_LEN * 0.36;
    const sx = b.x - hs * half;
    const sy = b.y - hc * half;
    const ex = b.x + hs * half;
    const ey = b.y + hc * half;
    const hullR = BOAT_BEAM * 0.5;
    const drag = Math.exp(-0.85 * dt);
    const spinDrag = Math.exp(-1.1 * dt);
    const t = this.t;

    // a fingertip held on a leaf presses it down as the hull does, only gentler: a tap
    // barely dips it, and the longer the finger stays the deeper it goes (about a second
    // and a half to put a leaf under) — and the deeper it went, the longer it stays down
    const held = this.held;
    if (held) {
      const p = held.pad;
      p.caught = true;
      p.load = Math.min(1.35, p.load + 0.55 * p.compliance * dt);
      p.cx += (held.ox / p.r) * 1.8;
      p.cy += (held.oy / p.r) * 1.8;
    }

    for (const p of pads) {
      // stem: slack tether, pulls back only past the slack
      const dx = p.x - p.ax;
      const dy = p.y - p.ay;
      const d = Math.hypot(dx, dy);
      const slack = 6 + p.r * 0.32;
      if (d > slack) {
        const k = (d - slack) * 0.9 * dt;
        p.vx -= (dx / d) * k;
        p.vy -= (dy / d) * k;
        // shoved far, the stem gives and the pad finds a new place
        if (d > slack * 3.2) {
          p.ax += (dx / d) * (d - slack * 3.2);
          p.ay += (dy / d) * (d - slack * 3.2);
        }
      }
      // the current leans every pad downstream against its stem
      const [fx, fy] = this.flow(p.x, p.y);
      p.vx += (fx * 0.6 - p.vx) * 0.12 * dt + Math.sin(t * 0.21 + p.seed * 40) * 0.4 * dt;
      p.vy += (fy * 0.6 - p.vy) * 0.12 * dt + Math.cos(t * 0.17 + p.seed * 31) * 0.3 * dt;
      p.va += Math.sin(t * 0.11 + p.seed * 17) * 0.004 * dt;
      // wind catches a pad by its edge: pushed, and turned by the side that caught it
      const [wx, wy] = this.wind(p.x, p.y);
      if (wx || wy) {
        const catchK = 1.4 - Math.min(1, p.r / 90);
        p.vx += wx * catchK * dt;
        p.vy += wy * catchK * dt;
        p.va += ((wx * Math.sin(p.ang * 3 + p.seed * 9) - wy * Math.cos(p.ang * 2)) / p.r) * 0.35 * dt;
        p.bob = Math.max(p.bob, Math.min(0.6, Math.hypot(wx, wy) / 120));
      }
      // ripple fronts passing under the leaf lift it, push it outward and set it flexing
      for (const r of this.rings) {
        const age = t - r.t;
        const dx = p.x - r.x;
        const dy = p.y - r.y;
        const d = Math.hypot(dx, dy) || 1;
        if (Math.abs(d - age * RING_SPEED) > p.r) continue;
        const k = r.s * Math.exp(-age * 0.9) / (1 + d / 90);
        p.bob = Math.max(p.bob, Math.min(0.8, k * 0.7));
        p.vx += (dx / d) * k * 22 * dt;
        p.vy += (dy / d) * k * 22 * dt;
        p.wob = Math.min(1, p.wob + k * dt * 4);
      }

      // hull contact
      const lx = p.x - sx;
      const ly = p.y - sy;
      const segx = ex - sx;
      const segy = ey - sy;
      const u = clamp((lx * segx + ly * segy) / (segx * segx + segy * segy), 0, 1);
      // the hull tapers toward the bow and stern
      const taper = 1 - Math.pow(Math.abs(u - 0.45) * 2, 2) * 0.45;
      const cx = sx + segx * u;
      const cy = sy + segy * u;
      const nx0 = p.x - cx;
      const ny0 = p.y - cy;
      const nd = Math.hypot(nx0, ny0) || 1;
      const rest = hullR * taper + p.r * 0.86;
      if (nd < rest) {
        const nx = nx0 / nd;
        const ny = ny0 / nd;
        const pen = rest - nd;
        const into = Math.max(0, bvx * nx + bvy * ny);
        const contact = clamp(pen / Math.max(10, p.r * 0.42) + into / 34, 0, 1);

        // A leaf below the boat's draft progressively loses collision authority.
        // The hull therefore presses THROUGH a mat instead of solving each leaf
        // as a rigid lateral obstacle.
        // Wet leaves remain physically soft for a while after they become
        // visually shallower; collision does not snap back with the waterline.
        const effectiveSink = Math.max(p.sink, p.wet * 0.58);
        const authority = 1 - smooth(0.28, 0.82, effectiveSink);
        p.caught = true;
        p.load = Math.min(1.35, p.load + (1.15 + contact * 3.9) * p.compliance * dt);
        p.sinkV += (0.35 + contact * 1.35) * p.compliance * (1 - p.sink) * dt;

        // There is still a soft shoulder and spin while the leaf is afloat, but
        // most of the hull's work goes DOWNWARD. Positional correction is tiny:
        // overlap is allowed and becomes the visual act of submerging it.
        const lateral = authority * authority;
        p.vx += nx * (into * 0.16 + pen * 0.34) * lateral;
        p.vy += ny * (into * 0.16 + pen * 0.34) * lateral;
        p.x += nx * pen * 0.045 * lateral;
        p.y += ny * pen * 0.045 * lateral;

        const tang = bvx * -ny + bvy * nx;
        p.va += (tang / p.r) * 0.14 * dt * 10 * Math.min(1, pen / 8) * lateral;

        // The pad can nudge the heading and take a little way off the boat, but
        // it should not ricochet the hull sideways. Steering remains authoritative.
        const side = nx * hc - ny * hs;
        b.heading -= side * contact * authority * (0.055 + Math.min(0.055, into / 500)) * dt;
        const mass = (p.r * p.r) / 2200;
        b.speed = Math.max(0, b.speed - into * mass * 0.0025 * authority);

        if (!p.touching && (pen > 2 || into > 3)) {
          this.bumps.push({ x: cx + nx * hullR, y: cy + ny * hullR, strength: clamp(into / 45 + pen / 35, 0.08, 0.55) });
          this.impulses.push({ x: p.x - nx * p.r * 0.88, y: p.y - ny * p.r * 0.88, r: 10, s: 0.55, foam: into > 12 });
          this.rings.push({ x: p.x - nx * p.r * 0.88, y: p.y - ny * p.r * 0.88, t: this.t, s: 0.5 });
        }

        // Near edge floods first; the shader's existing waterline now exposes
        // the same physical direction that is accumulating load.
        p.cx -= nx * (pen / p.r) * (1.25 + contact);
        p.cy -= ny * (pen / p.r) * (1.25 + contact);
        p.wob = Math.min(1, p.wob + into * 0.0025 * dt * 60 + contact * dt * 0.8);
        // a leaf the hull has put right under washes clean, as one under a blade does
        // (an answer in progress keeps its dew: the ask is repaired, not lost mid-gesture)
        if (p.sink > 0.85 && !p.selected) for (const dr of p.drops) dr.to = 0;
        p.touching = true;
      } else p.touching = false;
    }

    // pad–pad contact, bucketed
    const cell = 150;
    const grid = new Map<number, Pad[]>();
    const key = (ix: number, iy: number) => ix * 73856093 + iy * 19349663;
    for (const p of pads) {
      const k = key(Math.floor(p.x / cell), Math.floor(p.y / cell));
      const arr = grid.get(k);
      if (arr) arr.push(p);
      else grid.set(k, [p]);
    }
    for (const p of pads) {
      const ix = Math.floor(p.x / cell);
      const iy = Math.floor(p.y / cell);
      for (let gx = ix - 1; gx <= ix + 1; gx++)
        for (let gy = iy - 1; gy <= iy + 1; gy++) {
          const arr = grid.get(key(gx, gy));
          if (!arr) continue;
          for (const q of arr) {
            if (q.id <= p.id) continue;
            const dx = q.x - p.x;
            const dy = q.y - p.y;
            // Submerged leaves stop behaving like rigid discs in the surface
            // mat; neighbours can overlap and close above them.
            const ps = Math.max(p.sink, p.wet * 0.52);
            const qs = Math.max(q.sink, q.wet * 0.52);
            const pr = p.r * (1 - 0.68 * smooth(0.3, 0.9, ps));
            const qr = q.r * (1 - 0.68 * smooth(0.3, 0.9, qs));
            const touch = pr + qr;
            const d2 = dx * dx + dy * dy;
            if (d2 >= touch * touch) continue;
            const d = Math.sqrt(d2) || 0.01;
            const nx = dx / d;
            const ny = dy / d;
            // edges that meet give a little: each pad is pressed toward the other
            const overlap = touch - d;
            p.cx += nx * (overlap / p.r);
            p.cy += ny * (overlap / p.r);
            q.cx -= nx * (overlap / q.r);
            q.cy -= ny * (overlap / q.r);
            // and a hard meeting sets both flexing
            const closing = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny;
            if (closing > 3) {
              p.wob = Math.min(1, p.wob + closing * 0.015);
              q.wob = Math.min(1, q.wob + closing * 0.015);
            }
            const rest = touch * (p.bank && q.bank ? 0.8 : 0.92);
            if (d >= rest) continue;
            const pen = rest - d;
            const mp = p.r * p.r;
            const mq = q.r * q.r;
            const wp = mq / (mp + mq);
            const wq = mp / (mp + mq);
            const push = pen * 1.6 * dt * 8;
            p.vx -= nx * push * wp;
            p.vy -= ny * push * wp;
            q.vx += nx * push * wq;
            q.vy += ny * push * wq;
            // rubbing edges trade a little spin
            const rvt = (q.vx - p.vx) * -ny + (q.vy - p.vy) * nx;
            p.va += (rvt / p.r) * 0.02 * wp;
            q.va -= (rvt / q.r) * 0.02 * wq;
            // soft positional settle so dense banks don't jitter
            const settle = pen * 0.04;
            p.x -= nx * settle * wp;
            p.y -= ny * settle * wp;
            q.x += nx * settle * wq;
            q.y += ny * settle * wq;
          }
        }
    }

    for (const p of pads) {
      p.vx *= drag;
      p.vy *= drag;
      p.va *= spinDrag;
      p.va = clamp(p.va, -0.8, 0.8);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.ang += p.va * dt;
      // a pad sliding through the water pushes a little wave ahead of it
      const ps = Math.hypot(p.vx, p.vy);
      if (ps > 9 && Math.random() < dt * 8) {
        this.impulses.push({ x: p.x + (p.vx / ps) * p.r, y: p.y + (p.vy / ps) * p.r, r: 6, s: Math.min(0.7, ps / 40) });
      }
      p.bob *= Math.exp(-2.4 * dt);
      // settle the soft-body pose toward this step's contacts, then clear them
      const give = Math.min(0.2, Math.hypot(p.cx, p.cy) * 0.45);
      const pressed = Math.hypot(p.cx, p.cy) > 1e-6;
      const cl = Math.hypot(p.cx, p.cy) || 1;
      const k = 1 - Math.exp(-7 * dt);
      if (pressed) {
        p.dx += ((p.cx / cl) * give - p.dx) * k;
        p.dy += ((p.cy / cl) * give - p.dy) * k;
      } else {
        // released: the press eases off, but while the leaf is still under the water
        // keeps flooding from the side it went under (the shader draws the waterline
        // along this direction, so losing it made the flood vanish in one go)
        const dl = Math.hypot(p.dx, p.dy) || 1;
        const floor = Math.min(dl, 0.03 * smooth(0.02, 0.15, p.sink));
        const mag = floor + (dl - floor) * (1 - k);
        p.dx = (p.dx / dl) * mag;
        p.dy = (p.dy / dl) * mag;
      }
      p.cx = 0;
      p.cy = 0;
      p.wob *= Math.exp(-1.6 * dt);

      // Buoyancy is deliberately asymmetric. A hull can press a leaf down
      // decisively, but a flooded leaf is water-heavy: after release it dwells
      // low, drains, and only then rises on a soft overdamped spring.
      const before = p.sink;
      if (p.caught) {
        p.soak = Math.max(p.soak, 0.55 + p.sink * 1.35);
        // Direct oar pushes set sink without load; preserve enough hydrostatic
        // load that they recover with the same organic timing as hull presses.
        p.load = Math.max(p.load, p.sink * p.support * 0.72);
      } else {
        p.soak = Math.max(0, p.soak - dt);
        p.load *= Math.exp(-0.48 * dt);
      }

      const pressureSink = clamp(p.load / Math.max(0.55, p.support), 0, 1);
      if (p.caught) {
        // Downward response remains responsive enough to make rowing through
        // vegetation legible at normal boat speed.
        p.sinkV += Math.max(0, pressureSink - p.sink) * (5.5 + 2.5 * p.compliance) * dt;
      } else if (p.soak > 0) {
        // While flooded, kill the rubber-band rebound and let retained load /
        // inertia settle. A tiny restoring term prevents a numerical plateau.
        const held = Math.max(pressureSink, p.sink * 0.965);
        p.sinkV += (held - p.sink) * 0.34 * dt;
      } else {
        // Once drained enough to rise, wetness still damps buoyancy strongly.
        // Recovery starts very gently and becomes more eager only as the leaf dries.
        const dryK = 0.24 + (1 - p.wet) * 0.76;
        p.sinkV += (pressureSink - p.sink) * (0.62 + p.support * 0.42) * dryK * dt;
      }

      p.sinkV *= Math.exp(-(p.caught ? 2.8 : p.soak > 0 ? 4.2 : 1.65) * dt);
      p.sink = clamp(p.sink + p.sinkV * dt, 0, 1);
      if (p.sink <= 0 && p.sinkV < 0) p.sinkV = 0;
      if (p.sink >= 1 && p.sinkV > 0) p.sinkV = 0;

      // Wetness has a much longer memory than geometric submergence. This both
      // slows the lift and keeps collision soft until the leaf has visibly drained.
      p.wet = Math.max(p.sink, p.wet * Math.exp(-0.18 * dt));
      if (!p.caught && before > 0.3 && p.sink <= 0.3) {
        const l = Math.hypot(p.dx, p.dy) || 1;
        this.impulses.push({ x: p.x + (p.dx / l) * p.r * 0.8, y: p.y + (p.dy / l) * p.r * 0.8, r: 8, s: 0.7, foam: true });
        this.rings.push({ x: p.x, y: p.y, t: this.t, s: 0.5 });
        p.bob = Math.min(1, p.bob + 0.5);
        p.wob = Math.min(1, p.wob + 0.4);
      }
      p.caught = false;
      p.sel += ((p.selected ? 1 : 0) - p.sel) * (1 - Math.exp(-6 * dt));
      for (const d of p.drops) d.a += (d.to - d.a) * (1 - Math.exp(-(d.to > d.a ? 1.6 : 5) * dt));
      p.drops = p.drops.filter((d) => d.to > 0 || d.a > 0.01);
    }
  }

  /**
   * A floating line dragged slowly through water. Each node moves relative to
   * the WATER (the current carries it), and water resists a rope moving
   * sideways several times more than sliding along its own length — so it
   * streams out behind in long lazy curves instead of swinging like a chain.
   * It floats: it drapes and snags around the edges of the leaves (nudging
   * them), pushes through the duckweed, and ruffles the water where it's
   * dragged sideways. Position-based: predict, drag, constrain, collide.
   */
  private stepRope(dt: number) {
    const b = this.boat;
    const n = this.rope.length / 2;
    const r = this.rope;
    const pr = this.ropePrev;
    const stern = BOAT_LEN * 0.47;
    r[0] = b.x - Math.sin(b.heading) * stern;
    r[1] = b.y - Math.cos(b.heading) * stern;
    pr[0] = r[0];
    pr[1] = r[1];
    const kn = Math.exp(-3.5 * dt); // across the rope: the water holds it
    const kt = Math.exp(-0.7 * dt); // along it: it slides
    const t = this.t;
    for (let i = 1; i < n; i++) {
      const x = r[i * 2];
      const y = r[i * 2 + 1];
      let vx = (x - pr[i * 2]) / dt;
      let vy = (y - pr[i * 2 + 1]) / dt;
      let [ux, uy] = this.flow(x, y);
      // a floating ribbon goes where the surface goes: the breeze on it, and the
      // slow swell and eddies of the water, which wander it into soft curves
      const [gx, gy] = this.wind(x, y);
      const sw = Math.sin(t * 0.6 - i * 0.35) * 6.5 + Math.sin(t * 0.23 + i * 0.17 + x * 0.01) * 5;
      ux += gx * 0.6 - Math.cos(b.heading) * sw * (i / n);
      uy += gy * 0.6 + Math.sin(b.heading) * sw * (i / n);
      // tangent from the neighbours
      const j0 = i - 1;
      const j1 = Math.min(n - 1, i + 1);
      let tx = r[j0 * 2] - r[j1 * 2];
      let ty = r[j0 * 2 + 1] - r[j1 * 2 + 1];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      const wx = vx - ux;
      const wy = vy - uy;
      const along = wx * tx + wy * ty;
      const nx = wx - along * tx;
      const ny = wy - along * ty;
      // the cork at the free end drags harder than the line: it's what keeps the line streaming straight
      const ka = i === n - 1 ? kt * kt * kt : kt;
      vx = ux + along * tx * ka + nx * kn;
      vy = uy + along * ty * ka + ny * kn;
      pr[i * 2] = x;
      pr[i * 2 + 1] = y;
      r[i * 2] = x + vx * dt;
      r[i * 2 + 1] = y + vy * dt;
      // dragged sideways, it leaves a faint ripple
      const side = Math.hypot(nx, ny);
      if (side > 6 && Math.random() < dt * 3) this.impulses.push({ x, y, r: 4, s: Math.min(0.3, side / 60) });
    }
    const seg = 5.4;
    const near = this.pads.filter((p) => Math.abs(p.x - r[0]) < 320 && Math.abs(p.y - r[1]) < 320);
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < n; i++) {
        const ax = r[(i - 1) * 2];
        const ay = r[(i - 1) * 2 + 1];
        const dx = r[i * 2] - ax;
        const dy = r[i * 2 + 1] - ay;
        const d = Math.hypot(dx, dy) || 1;
        const k = (d - seg) / d;
        // the boat end is pinned; further along, both nodes share the correction
        if (i === 1) {
          r[i * 2] -= dx * k;
          r[i * 2 + 1] -= dy * k;
        } else {
          r[(i - 1) * 2] += dx * k * 0.5;
          r[(i - 1) * 2 + 1] += dy * k * 0.5;
          r[i * 2] -= dx * k * 0.5;
          r[i * 2 + 1] -= dy * k * 0.5;
        }
      }
      // a rope has some stiffness: it won't fold sharply, so each node eases toward the
      // line through its neighbours (it bends in long curves, and drapes rather than kinks)
      // off the stern cleat it leaves pointing aft, and curves away from there
      const ax = r[0] - Math.sin(b.heading) * seg;
      const ay = r[1] - Math.cos(b.heading) * seg;
      r[2] += (ax - r[2]) * 0.15;
      r[3] += (ay - r[3]) * 0.15;
      // only a whisper of stiffness: a soft line bends easily, it just won't crease
      for (let i = 1; i < n - 1; i++) {
        const mx = (r[(i - 1) * 2] + r[(i + 1) * 2]) * 0.5;
        const my = (r[(i - 1) * 2 + 1] + r[(i + 1) * 2 + 1]) * 0.5;
        r[i * 2] += (mx - r[i * 2]) * 0.035;
        r[i * 2 + 1] += (my - r[i * 2 + 1]) * 0.035;
      }
      // floating, it can't pass through a leaf: it drapes round the edge, and leans on it
      for (let i = 2; i < n; i++) {
        const x = r[i * 2];
        const y = r[i * 2 + 1];
        for (const p of near) {
          // a floating line slides over a drowned leaf rather than shoving it along
          // (else a leaf sunk under the stern is pushed ahead of the rope for ever)
          const afloat = 1 - smooth(0.3, 0.8, Math.max(p.sink, p.wet * 0.5));
          if (afloat <= 0) continue;
          const dx = x - p.x;
          const dy = y - p.y;
          const lim = p.r * 0.93 + 1.5;
          if (Math.abs(dx) > lim || Math.abs(dy) > lim) continue;
          const d = Math.hypot(dx, dy) || 1;
          if (d >= lim) continue;
          const push = lim - d;
          r[i * 2] += (dx / d) * push * 0.35 * afloat;
          r[i * 2 + 1] += (dy / d) * push * 0.35 * afloat;
          if (it === 0) {
            p.vx -= (dx / d) * push * 0.15 * afloat;
            p.vy -= (dy / d) * push * 0.15 * afloat;
          }
        }
      }
    }
    r[0] = b.x - Math.sin(b.heading) * stern;
    r[1] = b.y - Math.cos(b.heading) * stern;
    // it pushes through the duckweed and petals
    for (const f of this.floaters) {
      if (Math.abs(f.x - r[0]) > 300 || Math.abs(f.y - r[1]) > 300) continue;
      for (let i = 1; i < n; i += 2) {
        const dx = f.x - r[i * 2];
        const dy = f.y - r[i * 2 + 1];
        const d2 = dx * dx + dy * dy;
        if (d2 > 25) continue;
        const d = Math.sqrt(d2) || 1;
        f.vx += (dx / d) * 18 * dt;
        f.vy += (dy / d) * 18 * dt;
      }
    }
  }

}



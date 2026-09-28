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
 *   - the boat is a capsule that shoulders pads aside, spinning them by the
 *     side it catches them on, and loses a breath of speed to each bump.
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
  /** Where a finger on the boat is pulling it (world), or null. */
  helm: [number, number] | null;
  /** Until this time the boat keeps the heading it was given instead of following the channel. */
  manualUntil: number;
}

export const BOAT_LEN = 112;
/** How fast a ripple front travels (world units/s), matched by eye to the GPU wave sim. */
const RING_SPEED = 62;
export const BOAT_BEAM = 40;

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
export function layDrops(count: number, r: number, rand: Rand): Drop[] {
  const out: Drop[] = [];
  const base = (clamp(0.2 * r, 6.2, 9.5) / r) * (count > 3 ? 0.82 : 1) * (count > 5 ? 0.86 : 1);
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
  /** Water drops falling from a lifted blade (drawn as glints, landing as tiny rings). */
  drips: Array<{ x: number; y: number; age: number; life: number }> = [];
  /** Things that startle fish (main.ts relays them to the school). */
  startles: Array<{ x: number; y: number; r: number }> = [];
  /** Sounds the water made this step (main.ts plays them). */
  sounds: Array<{ kind: 'dip' | 'drip'; s: number }> = [];
  weeds: Weed[] = [];
  floaters: Floater[] = [];
  gusts: Gust[] = [];
  /** The boat's recent path (newest last): where the wake is drawn from. */
  trail: Array<{ x: number; y: number; hx: number; hy: number; speed: number; t: number }> = [];
  private trailAcc = 0;
  boat: Boat = { x: 0, y: 0, heading: 0, speed: 0, surge: 0, stroke: 0, rowing: 0, sway: 0, power: 0.2, helm: null, manualUntil: 0 };
  rope: Float32Array;
  ropePrev: Float32Array;
  /** Accumulated rebase offset: world y + origin is the "true" distance travelled. */
  origin = 0;
  private genY = -600;
  private nextId = 1;
  private rand: Rand;
  halfW = 420;
  t = 0;
  /** Chooses drops for a freshly grown pad (the game's current stage decides). */
  dewFor: (rand: Rand) => number = () => 0;

  constructor(seed: number) {
    this.rand = seeded(seed);
    this.boat.x = this.channel(0);
    const n = 30;
    this.rope = new Float32Array(n * 2);
    this.ropePrev = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      this.rope[i * 2] = this.ropePrev[i * 2] = this.boat.x;
      this.rope[i * 2 + 1] = this.ropePrev[i * 2 + 1] = -BOAT_LEN * 0.48 - i * 9;
    }
  }

  /** Channel centre line: a slow meander, in rebased world y. */
  channel(y: number): number {
    const Y = y + this.origin;
    return 95 * Math.sin(Y / 1150) + 42 * Math.sin(Y / 430 + 1.3) + 16 * Math.sin(Y / 170 + 4.1);
  }

  /** Open-water half width: breathes between a narrow run and a wide pool. */
  channelHalf(y: number): number {
    const Y = y + this.origin;
    return 84 + 28 * Math.sin(Y / 760 + 0.4) + 14 * Math.sin(Y / 290 + 2.2);
  }

  /**
   * The current (world units / s): along the channel's line, fastest in open
   * water, slack under the banks, with slow eddies turning where it slows.
   * The surface shader computes the same shape from the same channel samples,
   * so what the water shows and what the pads feel agree.
   */
  flow(x: number, y: number): [number, number] {
    const cx = this.channel(y);
    const slope = (this.channel(y + 20) - this.channel(y - 20)) / 40;
    const n = Math.hypot(slope, 1);
    const tx = slope / n;
    const ty = 1 / n;
    const half = this.channelHalf(y);
    const open = 1 - smooth(half * 0.35, half + 120, Math.abs(x - cx));
    const speed = 2.5 + 11 * open;
    // eddies: a slow curl field, strongest where open water meets the banks
    const Y = y + this.origin;
    const e = (1 - open) * open * 4 * 7;
    const ex = Math.sin(Y / 97 + x / 131 + this.t * 0.05) * e;
    const ey = Math.cos(x / 89 - Y / 143 + this.t * 0.04) * e * 0.6;
    return [tx * speed + ex, ty * speed + ey];
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

  private growFloaters(y0: number, y1: number, span: number) {
    const rand = this.rand;
    const add = (x: number, y: number, kind: number, size: number) =>
      this.floaters.push({ x, y, vx: 0, vy: 0, ang: rand() * Math.PI * 2, va: 0, size, kind, seed: rand() });
    // duckweed rafts: patches in the slack water, dense at their hearts, fraying at the edges
    const patches = Math.round(((y1 - y0) * span) / 70000 + rand());
    for (let i = 0; i < patches; i++) {
      const y = y0 + rand() * (y1 - y0);
      const cx = this.channel(y);
      const half = this.channelHalf(y);
      const side = rand() < 0.5 ? -1 : 1;
      const x = cx + side * (half * (0.45 + rand() * 0.9));
      const pr = 22 + rand() * 60;
      // area-dense at the heart, a ragged fringe: a raft, not a sprinkle
      const n = Math.round(pr * pr * 0.07);
      const stretch = 1 + rand() * 0.8;
      for (let k = 0; k < n; k++) {
        const a = rand() * Math.PI * 2;
        const d = Math.pow(rand(), 0.55) * pr * (0.75 + 0.35 * Math.sin(a * 3 + i));
        add(x + Math.cos(a) * d * stretch, y + Math.sin(a) * d, 0, 1.3 + rand() * 1.3);
      }
    }
    // a sprinkle of loose fronds everywhere slack
    const loose = Math.round(((y1 - y0) * span) / 14000);
    for (let i = 0; i < loose; i++) {
      const y = y0 + rand() * (y1 - y0);
      add(this.channel(y) + (rand() * 2 - 1) * (this.halfW + 60), y, 0, 1.4 + rand() * 1.4);
    }
    // petals shed around the lilies
    for (const p of this.pads) {
      if (!p.flower || p.y < y0 || p.y >= y1) continue;
      const n = 2 + Math.floor(rand() * 4);
      for (let k = 0; k < n; k++) {
        const a = rand() * Math.PI * 2;
        const d = p.r * (1.05 + rand() * 0.8);
        add(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 1, 5 + rand() * 3);
      }
    }
    // the odd fallen willow leaf, and closed buds among the bank pads
    if (rand() < 0.7) {
      const y = y0 + rand() * (y1 - y0);
      add(this.channel(y) + (rand() * 2 - 1) * this.halfW, y, 2, 11 + rand() * 7);
    }
    for (let i = 0; i < 2; i++) {
      if (rand() < 0.4) continue;
      const y = y0 + rand() * (y1 - y0);
      const cx = this.channel(y);
      const side = rand() < 0.5 ? -1 : 1;
      add(cx + side * (this.channelHalf(y) + 30 + rand() * 120), y, 3, 7 + rand() * 4);
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
    for (const f of this.floaters) {
      if (f.y < active.y0 || f.y > active.y1) continue;
      const light = f.kind === 3 ? 0.35 : 1;
      const [fx, fy] = this.flow(f.x, f.y);
      const [wx, wy] = this.wind(f.x, f.y);
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

  /** Regrow everything around the boat (after a resize wider than the field was grown for). */
  regrow(halfW: number, yMin: number) {
    this.halfW = halfW;
    this.pads = this.pads.filter((p) => p.y < yMin);
    this.deep = this.deep.filter((d) => d.y < yMin);
    this.weeds = this.weeds.filter((w) => w.y < yMin);
    this.floaters = this.floaters.filter((f) => f.y < yMin);
    this.genY = yMin;
  }

  private grow(y0: number, y1: number) {
    const rand = this.rand;
    const span = this.halfW * 2 + 200;
    const attempts = Math.round(((y1 - y0) * span) / 260);
    const near = this.pads.filter((p) => p.y > y0 - 160);
    for (let i = 0; i < attempts; i++) {
      const y = y0 + rand() * (y1 - y0);
      const cx = this.channel(y);
      const x = cx + (rand() * 2 - 1) * (this.halfW + 100);
      const off = Math.abs(x - cx);
      const half = this.channelHalf(y);
      const bank = off > half;
      if (!bank && rand() > 0.035) continue;
      const deepness = smooth(half, half + 260, off);
      const r = bank ? 26 + rand() * 34 + deepness * 34 * rand() : 22 + rand() * 14;
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
      const flower = bank && rand() < 0.07 ? 1 + Math.floor(rand() * 3) : 0;
      const count = flower ? 0 : this.dewFor(rand);
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
        layer: rand(),
      };
      pad.drops = layDrops(count, r, rand);
      for (const d of pad.drops) d.a = 1;
      this.pads.push(pad);
      near.push(pad);
    }
    // submerged leaves and weed beds, seen through the water
    const deepCount = Math.round(((y1 - y0) * span) / 26000);
    for (let i = 0; i < deepCount; i++) {
      const y = y0 + rand() * (y1 - y0);
      this.deep.push({
        x: this.channel(y) + (rand() * 2 - 1) * (this.halfW + 80),
        y,
        r: 22 + rand() * 40,
        ang: rand() * Math.PI * 2,
        seed: rand(),
        depth: 0.35 + rand() * 0.55,
      });
    }
    this.growFloaters(y0, y1, span);
    // weed beds root in the shallows toward the banks, sparser in the open run
    const weedCount = Math.round(((y1 - y0) * span) / 2600);
    for (let i = 0; i < weedCount; i++) {
      const y = y0 + rand() * (y1 - y0);
      const cx = this.channel(y);
      const x = cx + (rand() * 2 - 1) * (this.halfW + 60);
      const off = Math.abs(x - cx) / this.channelHalf(y);
      if (off < 0.5 && rand() > 0.25) continue;
      this.weeds.push({ x, y, len: 30 + rand() * 60, depth: 0.45 + rand() * 0.6, seed: rand(), kind: rand() < 0.35 ? 1 : 0 });
    }
    this.pads.sort((a, b) => Number(b.bank) - Number(a.bank) || a.layer - b.layer);
  }

  /** Forget what is far behind. Selected pads are kept so a selection never vanishes mid-gesture. */
  cull(yMin: number) {
    this.pads = this.pads.filter((p) => p.y > yMin || p.selected);
    this.deep = this.deep.filter((d) => d.y > yMin);
    this.weeds = this.weeds.filter((w) => w.y > yMin);
    this.floaters = this.floaters.filter((f) => f.y > yMin);
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
    }
    for (const d of this.deep) d.y -= s;
    for (const w of this.weeds) w.y -= s;
    for (const f of this.floaters) f.y -= s;
    for (const g of this.gusts) g.y -= s;
    for (const p of this.trail) p.y -= s;
    for (const p of this.puddles) p.y -= s;
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
    this.boat.surge += Math.min(90, distance * 0.3);
  }

  bow(): [number, number] {
    const b = this.boat;
    return [b.x + Math.sin(b.heading) * BOAT_LEN * 0.4, b.y + Math.cos(b.heading) * BOAT_LEN * 0.4];
  }

  step(dt: number, active: { y0: number; y1: number }, reduced: boolean) {
    this.t += dt;
    this.stepGusts(dt);
    this.stepBoat(dt, reduced);
    this.stepPads(dt, active);
    this.stepFloaters(dt, active);
    this.stepRope();
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
  stroke() {
    this.boat.surge += 30;
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
    let effort = reduced ? 0.1 : 0.22;
    let want: number;
    if (b.helm) {
      const dx = b.helm[0] - b.x;
      const dy = b.helm[1] - b.y;
      const d = Math.hypot(dx, dy);
      want = clamp(Math.atan2(dx, dy), -1.2, 1.2);
      // pull ahead to row hard; hold the boat itself to row steadily
      effort = clamp(0.32 + Math.max(0, dy) * 0.004 + d * 0.0008, 0.32, 1);
      b.manualUntil = this.t + 4;
    } else if (this.t < b.manualUntil) {
      want = b.heading;
    } else {
      const look = 170;
      want = clamp(Math.atan2(this.channel(b.y + look) - b.x, look), -0.42, 0.42) + Math.sin(this.t * 0.13) * 0.04;
    }
    // a tap or a solve: a few full-power strokes, spent as they're pulled
    effort = Math.max(effort, Math.min(1, b.surge / 25));
    b.surge = Math.max(0, b.surge - dt * 11);
    b.power += (effort - b.power) * (1 - Math.exp(-2.5 * dt));
    b.rowing += (1 - b.rowing) * (1 - Math.exp(-1.5 * dt));
    const prev = b.stroke;
    b.stroke += dt * (0.36 + 0.08 * b.power) * b.rowing;
    // thrust only from blades in the water; water drag always
    const drive = Math.max(0, Math.cos(b.stroke * Math.PI * 2));
    // tuned so a light cruise swings ~10–16 through each stroke and full power ~32–56, and the
    // glide between pulls carries (a heavy wooden boat keeps its way)
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
      this.sounds.push({ kind: 'dip', s: k });
    }

    // the drive: blades in the water shoulder leaves aside and throw water aft
    if (rowing && drive > 0.05) {
      this.shedAcc += dt;
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
          // water pours over the flooded edge
          if (Math.random() < dt * 10) this.impulses.push({ x: p.x + (dx / d) * p.r, y: p.y + (dy / d) * p.r, r: 5, s: 0.35, foam: true });
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
        if (!this.padAt(tx, ty, near)) {
          this.impulses.push({ x: tx, y: ty, r: 6, s: 0.35 * k * drive, foam: Math.random() < 0.3 * drive });
          if (shed) {
            // pushed water leaves aft, a little outward, faster the harder the pull
            const ox = hy * side;
            const oy = -hx * side;
            const v = 14 + b.power * 32;
            this.puddles.push({ x: tx, y: ty, vx: -hx * v + ox * 7, vy: -hy * v + oy * 7, age: 0, life: 1.8, s: 0.55 * k * drive });
          }
        }
      }
    }

    if (!(rowing && drive > 0.05)) this.lastTip = [null, null];

    // the release: a pair of swirls where the blade left
    if (rowing && crossed(0.25)) {
      for (const side of [-1, 1]) {
        const [tx, ty] = this.oarTip(side);
        const px = hy * 5;
        const py = -hx * 5;
        this.splash(tx + px, ty + py, 6, 0.9 * k, true, near);
        this.splash(tx - px, ty - py, 6, 0.9 * k, true, near);
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
      if (d.age >= d.life) {
        const hit = this.splash(d.x, d.y, 3, 0.35, false, near);
        if (!hit) this.sounds.push({ kind: 'drip', s: 0.5 + Math.random() * 0.5 });
      }
    }
    this.drips = this.drips.filter((d) => d.age < d.life);

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
      if (Math.random() < 0.5) this.impulses.push({ x: p.x, y: p.y, r: 5 + p.age * 3, s: p.s * fade, foam: p.age < 0.5 && Math.random() < 0.3 });
    }
    this.puddles = this.puddles.filter((p) => p.age < p.life);
  }

  private wakeAcc = 0;
  /** A V of waves off the bow and a trail off the stern quarters, stronger with speed. */
  private wake(dt: number) {
    const b = this.boat;
    if (b.speed < 2) return;
    this.wakeAcc += dt;
    if (this.wakeAcc < 1 / 30) return;
    this.wakeAcc = 0;
    const k = Math.min(1, b.speed / 40);
    const c = Math.cos(b.heading);
    const s = Math.sin(b.heading);
    const at = (lx: number, ly: number): [number, number] => [b.x + lx * c + ly * s, b.y - lx * s + ly * c];
    const [bx, by] = at(0, BOAT_LEN * 0.47);
    this.impulses.push({ x: bx, y: by, r: 8, s: 0.8 + 1.2 * k });
    for (const side of [-1, 1]) {
      // the shoulders throw the arms of the V
      const [qx, qy] = at(side * BOAT_BEAM * 0.5, BOAT_LEN * 0.22);
      this.impulses.push({ x: qx, y: qy, r: 7, s: 0.6 + 1.0 * k });
      // the stern quarters leave churned, foamy water
      const [sx, sy] = at(side * BOAT_BEAM * 0.3, -BOAT_LEN * 0.5);
      this.impulses.push({ x: sx, y: sy, r: 7, s: 0.4 + 0.8 * k, foam: Math.random() < 0.25 });
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
    return 0.35 + (stroke * reach - 0.1) * b.rowing + Math.sin(this.t * 0.5) * 0.04;
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
        p.vx += nx * (into * 0.9 + pen * 2.2);
        p.vy += ny * (into * 0.9 + pen * 2.2);
        p.x += nx * pen * 0.35;
        p.y += ny * pen * 0.35;
        // caught on one side of its centre, it turns
        const tang = bvx * -ny + bvy * nx;
        p.va += (tang / p.r) * 0.35 * dt * 10 * Math.min(1, pen / 6);
        const mass = (p.r * p.r) / 1600;
        b.speed = Math.max(0, b.speed - into * mass * 0.012);
        if (!p.touching && (pen > 2 || into > 3)) {
          this.bumps.push({ x: cx + nx * hullR, y: cy + ny * hullR, strength: clamp(into / 30 + pen / 20, 0.1, 1) });
          this.impulses.push({ x: p.x - nx * p.r * 0.9, y: p.y - ny * p.r * 0.9, r: 10, s: 0.8, foam: into > 8 });
          this.rings.push({ x: p.x - nx * p.r * 0.9, y: p.y - ny * p.r * 0.9, t: this.t, s: 0.7 });
        }
        // the hull presses the near edge in, and a hard nudge sets the leaf flexing
        p.cx -= nx * (pen / p.r) * 2.2;
        p.cy -= ny * (pen / p.r) * 2.2;
        p.wob = Math.min(1, p.wob + into * 0.004 * dt * 60);
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
            const touch = p.r + q.r;
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
      const cl = Math.hypot(p.cx, p.cy) || 1;
      const k = 1 - Math.exp(-7 * dt);
      p.dx += ((p.cx / cl) * give - p.dx) * k;
      p.dy += ((p.cy / cl) * give - p.dy) * k;
      p.cx = 0;
      p.cy = 0;
      p.wob *= Math.exp(-1.6 * dt);
      // let go, a sunk leaf comes back up, shedding the water off its face
      if (!p.caught && p.sink > 0.01) {
        const before = p.sink;
        p.sink *= Math.exp(-2.2 * dt);
        if (before > 0.3 && p.sink <= 0.3) {
          const l = Math.hypot(p.dx, p.dy) || 1;
          this.impulses.push({ x: p.x + (p.dx / l) * p.r * 0.8, y: p.y + (p.dy / l) * p.r * 0.8, r: 8, s: 0.7, foam: true });
          this.rings.push({ x: p.x, y: p.y, t: this.t, s: 0.5 });
          p.bob = Math.min(1, p.bob + 0.5);
          p.wob = Math.min(1, p.wob + 0.4);
        }
      }
      p.caught = false;
      p.sel += ((p.selected ? 1 : 0) - p.sel) * (1 - Math.exp(-6 * dt));
      for (const d of p.drops) d.a += (d.to - d.a) * (1 - Math.exp(-(d.to > d.a ? 1.6 : 5) * dt));
      p.drops = p.drops.filter((d) => d.to > 0 || d.a > 0.01);
    }
  }

  private stepRope() {
    const b = this.boat;
    const n = this.rope.length / 2;
    const r = this.rope;
    const pr = this.ropePrev;
    const stern = BOAT_LEN * 0.47;
    r[0] = b.x - Math.sin(b.heading) * stern;
    r[1] = b.y - Math.cos(b.heading) * stern;
    for (let i = 1; i < n; i++) {
      const x = r[i * 2];
      const y = r[i * 2 + 1];
      r[i * 2] += (x - pr[i * 2]) * 0.9 + Math.sin(this.t * 0.6 + i * 0.5) * 0.02;
      r[i * 2 + 1] += (y - pr[i * 2 + 1]) * 0.9;
      pr[i * 2] = x;
      pr[i * 2 + 1] = y;
    }
    const seg = 9;
    for (let it = 0; it < 4; it++)
      for (let i = 1; i < n; i++) {
        const ax = r[(i - 1) * 2];
        const ay = r[(i - 1) * 2 + 1];
        const dx = r[i * 2] - ax;
        const dy = r[i * 2 + 1] - ay;
        const d = Math.hypot(dx, dy) || 1;
        const k = (d - seg) / d;
        r[i * 2] -= dx * k;
        r[i * 2 + 1] -= dy * k;
      }
  }
}

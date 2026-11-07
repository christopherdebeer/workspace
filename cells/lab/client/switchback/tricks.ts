/**
 * Switchback's showing-off rider (`auto=tricks`, and the title screen): the sim's own rider, riding the line as `autoSteer`
 * does, but using what the player can, by the take-off model (sim.ts, `fly`): the lip decides the flight. On the run-in
 * to a ramp it looks ahead: flies the flight it'll take off on forward against the ground, to see how long it'll be up
 * and what slope it'll come down on, and picks what fits: a backflip (pulling up the ramp as hard as that flight needs),
 * a whip (a flick across as it leaves), a body trick (hands off or feet off, held while there's air for it and back in
 * time), or nothing. In the air it trims the flip with the throttle and the rear brake to come down square. On the
 * ground, now and then a flick into a kink so the rear steps out. It's exactly the player's input (the same steer, drive
 * and trick), so whatever it lands, a player can.
 */
import { AIR, hash } from './course';
import { G, Input, LIP, Rider, autoSteer } from './sim';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** a jump (or any feature) within the next 90 m */
const jumpAhead = (r: Rider) => { for (let d = 0; d < 90; d += 3) if (r.course.at(r.s + d).feature !== 'none') return true; return false; };
/** how long it needs to have been back on the bike before touching down, and the margin it leaves a flip */
const BACK = 0.45, MARGIN = 0.35;

type Plan = { kind: 'flip' | 'whip' | 'hands' | 'feet' | 'none'; T: number; slope: number; pull: number; side: number; lipS: number };

export class Trickster {
  private plan: Plan | null = null;
  private wasAir = false; private slide = 0; private slideDir = 0; private n = 0; private pitch0 = 0;
  /** what's been tried and landed, for the tests: a count by kind */
  tried: Record<string, number> = {}; landed: Record<string, number> = {};

  input(r: Rider, dt = 1 / 120): Input {
    let steer = autoSteer(r), drive = 0, trick = 0;
    const c = r.course;
    if (r.air && r.crashT <= 0) {
      // (leaving: the flight flown again from how it really took off, so the trim aims at the real landing)
      if (!this.wasAir) { if (this.plan) { this.count('tried', this.plan.kind); this.n++; } this.pitch0 = r.pitch; const f = this.fly(r, r.x, r.y, r.z, r.vx, r.vy, r.vz, 'none'); if (this.plan) { this.plan.T = f.T; this.plan.slope = f.slope; } else this.plan = f; }
      const p = this.plan!, t = r.airT, left = p.T - t;
      steer = 0;
      if (p.kind === 'whip' && t <= 0.08) trick = p.side;
      if (t > 0.08) {
        if (p.kind === 'flip') {
          // (trim: the rotation it'll have come round by, at this rate, against a whole turn and the landing's slope)
          const goal = Math.PI * 2 + wrap(p.slope - this.pitch0), will = r.pitch - this.pitch0 + r.spin * Math.max(0, left - 0.05);
          drive = Math.max(-1, Math.min(1, (goal - will) * 1.2));
        } else {
          if (p.kind === 'whip' && t < 0.25) trick = p.side;
          if ((p.kind === 'hands' || p.kind === 'feet') && t > 0.35 && left > BACK + 0.3) trick = p.kind === 'hands' ? 1 : -1;
          // (the last of the flight: the nose set square to the slope it'll come down on; the throttle lifts it)
          if (left < 0.7) drive = Math.max(-1, Math.min(1, -wrap(r.pitch - p.slope) * 2.5));
        }
      }
    } else if (!r.air && r.crashT <= 0) {
      if (this.wasAir && this.plan) this.score(r);
      if (this.wasAir) this.plan = null;
      // (a ramp ahead: plan the flight once, a little before it, then ride it: the pull up the ramp, the bars at the lip)
      const lipS = this.lipAhead(r);
      if (lipS !== null) {
        // (chosen again every moment until the ramp itself, so a run-in still gathering pace, as after a fall, is
        // planned from the pace it'll really leave at; on the ramp it's committed)
        if (!this.plan || this.plan.lipS !== lipS || c.at(r.s).feature !== 'ramp') this.plan = this.choose(r, lipS);
        const p = this.plan, toLip = lipS - r.s;
        if (p.kind === 'flip' && c.at(r.s).feature === 'ramp') drive = -p.pull;
      } else if (this.slide > 0) { this.slide -= dt; steer = Math.max(-1, Math.min(1, -this.slideDir * 1 + steer * 0.3)); }
      else {
        // (now and then a flick into a kink ahead: the bars turned hard into it for a moment, at pace; never with a jump
        // coming, nor away from the middle of the road)
        const ahead = c.at(r.s + 14).heading - c.at(r.s + 2).heading;
        if (Math.abs(ahead) > 0.3 && r.v > 24 && c.at(r.s).width > 6.5 && Math.abs(r.u) < c.at(r.s).width / 2 - 1.5 && !jumpAhead(r) && hash(c.seed, Math.round(r.s / 20), 17) < 0.5 && Math.abs(r.slip) < 0.05) {
          this.slide = 0.32; this.slideDir = Math.sign(ahead); this.count('tried', 'slide');
        }
      }
    }
    this.wasAir = r.air && r.crashT <= 0;
    return { steer, brake: false, drive, trick };
  }

  /** the lip of a ramp within the next 40 m (its last station), or none */
  private lipAhead(r: Rider) {
    const c = r.course;
    for (let d = 0; d < 40; d++) {
      const s = Math.floor(r.s) + d;
      if (c.at(s).feature === 'ramp' && c.at(s + 1).feature !== 'ramp') return s;
    }
    return null;
  }

  /** the flight off a lip at `lipS`, flown forward from the pace it's riding at now, and what fits in it */
  private choose(r: Rider, lipS: number): Plan {
    const c = r.course, a = c.point(lipS - 1, 0), b = c.point(lipS, 0), run = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const v = r.v, rise = (b.y - a.y) / run, hx = (b.x - a.x) / run, hz = (b.z - a.z) / run, k = 1 / Math.hypot(1, rise);
    const plan = this.fly(r, b.x, b.y, b.z, hx * v * k, v * rise * k + 1.2, hz * v * k, 'none');
    plan.lipS = lipS;
    const roll = hash(c.seed, lipS, this.n), T = plan.T;
    // (a flip where there's air for one: pulled as hard as it needs to come round a whole turn and square up with the
    // margin to spare, if a full pull can)
    const need = (Math.PI * 2 + wrap(plan.slope - Math.atan2(rise, 1))) / Math.max(0.1, T - MARGIN);
    if (T > 1.5 && need / LIP.spin <= 0.95 && roll < 0.6) { plan.kind = 'flip'; plan.pull = Math.max(0.25, need / LIP.spin); }
    else if (T > 1.3 && roll < 0.8) plan.kind = roll < 0.7 ? 'hands' : 'feet';
    else if (T > 0.9) plan.kind = roll < 0.9 ? 'whip' : 'none';
    plan.side = hash(c.seed, lipS, 31) < 0.5 ? -1 : 1;
    return plan;
  }
  /** a flight flown forward against the ground (as the sim flies it): how long until it's down, and the slope there */
  private fly(r: Rider, x: number, y: number, z: number, vx: number, vy: number, vz: number, kind: Plan['kind']): Plan {
    let s = r.s, T = 0;
    const h = 1 / 60;
    for (; T < 7; T += h) {
      const d = 1 - AIR * Math.hypot(vx, vz) * h;
      vy -= G * h; vx *= d; vz *= d; x += vx * h; y += vy * h; z += vz * h;
      const loc = r.course.locate(x, z, s); s = loc.s;
      if (y <= r.surfaceY(loc.s, loc.u)) break;
    }
    const vh = Math.hypot(vx, vz) || 1, fx = (vx / vh) * 0.8, fz = (vz / vh) * 0.8, at = (px: number, pz: number) => { const l = r.course.locate(px, pz, s); return r.surfaceY(l.s, l.u); };
    return { kind, T, slope: Math.atan2(at(x + fx, z + fz) - at(x - fx, z - fz), 1.6), pull: 0, side: 1, lipS: -1 };
  }
  private score(r: Rider) { if (r.crashT <= 0 && this.plan) this.count('landed', this.plan.kind); }
  private count(k: 'tried' | 'landed', kind: string) { this[k][kind] = (this[k][kind] ?? 0) + 1; }
}

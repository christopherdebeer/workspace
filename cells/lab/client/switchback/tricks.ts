/**
 * Switchback's showing-off rider (`auto=tricks`, and the title screen): the sim's own rider, riding the line as `autoSteer`
 * does, but using what the player can: a flick into a kink so the rear steps out and slides; and in the air, what the
 * flight allows. At take-off it looks ahead: flies the flight forward against the ground to see how long it'll be up and
 * what slope it'll come down on, and picks what fits: a whole flip (back, now and then front) with time to spare to come
 * round and square up; a whip, thrown out and brought back; or just the nose set to the slope. It's exactly the player's
 * input (the same drive, steer and whip), so whatever it lands, a player can.
 */
import { AIR, hash } from './course';
import { G, Input, Rider, autoSteer } from './sim';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** a jump (or any feature) within the next 90 m */
const jumpAhead = (r: Rider) => { for (let d = 0; d < 90; d += 3) if (r.course.at(r.s + d).feature !== 'none') return true; return false; };
/** how long a whole flip takes, pulled from the start, and how much it carries on turning once let go (the sim's spin) */
const FLIP_T = 2.35, COAST = 0.8;

type Plan = { kind: 'flip' | 'front' | 'whip' | 'none'; T: number; slope: number; pitch0: number; side: number };

export class Trickster {
  private plan: Plan | null = null;
  private wasAir = false; private slide = 0; private slideDir = 0; private n = 0;
  /** what's been tried and landed, for the tests: a count by kind */
  tried: Record<string, number> = {}; landed: Record<string, number> = {};

  input(r: Rider, dt = 1 / 120): Input {
    let steer = autoSteer(r), drive = 0, whip = 0;
    if (r.air && r.crashT <= 0) {
      if (!this.wasAir) this.plan = this.choose(r);
      const p = this.plan!, t = r.airT, left = p.T - t, rot = r.pitch - p.pitch0;
      // (the last of the flight: the nose set square to the slope it'll come down on)
      const square = Math.max(-1, Math.min(1, wrap(r.pitch - p.slope) * 2.5));
      if (p.kind === 'flip' || p.kind === 'front') {
        const dir = p.kind === 'flip' ? 1 : -1, goal = Math.PI * 2 * dir + wrap(p.slope - p.pitch0);
        // (pull (or push) until what's left to turn is what it'll coast, then square up)
        if (dir * (goal - rot - r.spin / 4) > 0.08 && left > 0.35) drive = -dir; else if (left < 0.8) drive = square;
      } else {
        if (p.kind === 'whip' && t > 0.25 && left > 0.75) whip = p.side;
        if (left < 0.7) drive = square;
      }
    } else if (!r.air && r.crashT <= 0) {
      // (on the ground, now and then a flick into a kink ahead: the bars turned hard into it for a moment, at pace)
      if (this.wasAir && this.plan) this.score(r);
      const c = r.course, ahead = c.at(r.s + 14).heading - c.at(r.s + 2).heading;
      if (this.slide > 0) { this.slide -= dt; steer = Math.max(-1, Math.min(1, -this.slideDir * 1 + steer * 0.3)); }
      // (never with a jump coming, nor away from the middle of the road)
      else if (Math.abs(ahead) > 0.3 && r.v > 24 && c.at(r.s).width > 6.5 && Math.abs(r.u) < c.at(r.s).width / 2 - 1.5 && !jumpAhead(r) && hash(c.seed, Math.round(r.s / 20), 17) < 0.5 && Math.abs(r.slip) < 0.05) {
        this.slide = 0.32; this.slideDir = Math.sign(ahead); this.count('tried', 'slide');
      }
    }
    if (!r.air && this.wasAir) this.plan = null;
    this.wasAir = r.air && r.crashT <= 0;
    return { steer, brake: false, drive, whip };
  }

  /** at take-off: the flight flown forward against the ground (as the sim flies it), how long until it's down, and the
   * slope there; then what fits in it */
  private choose(r: Rider): Plan {
    let x = r.x, y = r.y, z = r.z, vx = r.vx, vy = r.vy, vz = r.vz, s = r.s, T = 0;
    const h = 1 / 60;
    for (; T < 7; T += h) {
      const d = 1 - AIR * Math.hypot(vx, vz) * h;
      vy -= G * h; vx *= d; vz *= d; x += vx * h; y += vy * h; z += vz * h;
      const loc = r.course.locate(x, z, s); s = loc.s;
      if (y <= r.surfaceY(loc.s, loc.u)) break;
    }
    const vh = Math.hypot(vx, vz) || 1, fx = (vx / vh) * 0.8, fz = (vz / vh) * 0.8, at = (px: number, pz: number) => { const l = r.course.locate(px, pz, s); return r.surfaceY(l.s, l.u); };
    const slope = Math.atan2(at(x + fx, z + fz) - at(x - fx, z - fz), 1.6);
    const roll = hash(r.course.seed, Math.round(r.s), this.n++);
    const kind: Plan['kind'] = T > FLIP_T + 0.6 ? (roll < 0.25 ? 'front' : 'flip') : T > 0.9 ? (roll < 0.75 ? 'whip' : 'none') : 'none';
    this.count('tried', kind);
    return { kind, T, slope, pitch0: r.pitch, side: roll < 0.4 ? -1 : 1 };
  }
  private score(r: Rider) { if (r.crashT <= 0 && this.plan) this.count('landed', this.plan.kind); }
  private count(k: 'tried' | 'landed', kind: string) { this[k][kind] = (this[k][kind] ?? 0) + 1; }
}
void COAST;

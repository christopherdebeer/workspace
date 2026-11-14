/**
 * Switchback's rider: arcade physics, readable at speed.
 *
 * On the ground the bike goes where it's pointed: your steering turns the bike itself, and nothing turns it for you, so
 * with no input it runs straight on and a bend has to be ridden. The way you're travelling follows the way the bike points
 * through the tyres' grip, which gives at speed: turn hard and the rear steps out, the bike yawed past its line, sliding
 * (scrubbing pace, throwing roost). Where you are on the course (s down it, u across it) is read back from the world. The fall of the hill drives you on, the engine adds to it, the air holds you back. Off a ramp's lip,
 * or over a crest steeper than you can hold, you fly (a ballistic arc), and come down on whatever's under you. The lip
 * decides the flight: how hard you pull up it is your backflip; in the air the throttle and the rear brake only trim the
 * rotation, steering does nothing, and the tricks are asked for by name (`Input.trick`, drawn as gestures on the page):
 * the body off the bike, or the bike whipped out beneath it, held as long as they're asked and back before you land. One
 * the flight left can't fit is refused, not attempted. Off the drop side, too far: a fall, and back on the line. Into the wall: a glance off it, the pace lost.
 */
import { AIR, Course } from './course';
import { ground } from './ground';

export const G = 9.8, VMAX = 46;
export type Event = { kind: 'roost' | 'land' | 'wall' | 'launch' | 'crash' | 'checkpoint' | 'respawn' | 'flip' | 'trick' | 'refuse'; x: number; y: number; z: number; k: number };
/** steer (−1…1, + right); drive (−1…1): + the throttle opened wider, − the brake, as hard as it's pulled (`brake` is the
 * same as drive −1). From the take-off model (see `fly`): on a ramp, − is the pull, not the brake, and how hard you're
 * pulling as you leave the lip is the backflip's rotation, committed; in the air the same axis trims the rotation as a
 * real bike's rear wheel does (+ the throttle, nose up, turning faster; − the rear brake, nose down, slower). And the
 * trick asked for in the air (held as long as it's asked, then back to the bike; none, nothing) */
export interface Input { steer: number; brake: boolean; drive?: number; trick?: Trick | null }
/** the air's tricks: four of the body (off the bike, posed) and the whip (the bike swung out beneath you, either way).
 * Each takes `out` seconds to get all the way into and `back` to come out of; its points, and its gesture on the page */
export type Trick = 'hands' | 'feet' | 'superman' | 'cancan' | 'heel' | 'nacnac' | 'grab' | 'rock' | 'whipL' | 'whipR';
export const BODY = ['hands', 'feet', 'superman', 'cancan', 'heel', 'nacnac', 'grab', 'rock'] as const;
export type Body = (typeof BODY)[number];
export const TRICKS: Record<Trick, { name: string; out: number; back: number; points: number; gesture: string }> = {
  hands: { name: 'NO HANDER', out: 0.25, back: 0.3, points: 400, gesture: '→' },
  feet: { name: 'NO FOOTER', out: 0.25, back: 0.3, points: 400, gesture: '←' },
  superman: { name: 'SUPERMAN', out: 0.35, back: 0.4, points: 700, gesture: '↑' },
  cancan: { name: 'CAN-CAN', out: 0.3, back: 0.35, points: 600, gesture: '↓' },
  heel: { name: 'HEEL CLICKER', out: 0.3, back: 0.35, points: 650, gesture: '↗' },
  nacnac: { name: 'NAC NAC', out: 0.3, back: 0.35, points: 600, gesture: '↖' },
  grab: { name: 'SEAT GRAB', out: 0.25, back: 0.3, points: 500, gesture: '↘' },
  rock: { name: 'ROCK SOLID', out: 0.45, back: 0.5, points: 1000, gesture: '↙' },
  whipL: { name: 'WHIP', out: 0.2, back: 0.3, points: 0, gesture: '↺' },
  whipR: { name: 'WHIP', out: 0.2, back: 0.3, points: 0, gesture: '↻' },
};
/** the take-off model: the most a full pull at the lip turns the bike (rad/s; a whole backflip in ~1.5 s), how much the
 * throttle and the rear brake can trim it in the air (rad/s each second, and at most this far from what the lip gave),
 * and how far a whip throws the bike out (rad) */
export const LIP = { spin: 4.2, trim: 1.6, trimMax: 1.0, whip: 0.85 };

export class Rider {
  s = 2; u = 0; psi = 0; v = 18;
  /** heading: the way the bike points; travel: the way it's going (the difference is the slide) */
  x = 0; y = 0; z = 0; vx = 0; vy = 0; vz = 0; heading = 0; travel = 0; slip = 0;
  air = false; airT = 0; crashT = 0;
  /** for the eye and the model: lean into the turn, pitch with the ground or the flight, the suspension's give */
  lean = 0; pitch = 0; squash = 0; steerK = 0;
  /** the front's steering angle (+ right; opposite lock in a slide), and the ground under each wheel (for drawing the
   * bike standing on both) */
  steer = 0; yFront = 0; yRear = 0;
  /** the whip: in the air the bike swung out sideways beneath the rider (rad, + its nose to the right), sprung toward
   * what the bars ask and back when they let go. Land with it still out and the bike comes down yawed off the way it's
   * going and slides it straight, scrubbing pace; too far out (past ~34°) and it's a crash */
  whip = 0; private vWhip = 0;
  /** the nose turning in the air (rad/s, + up and over backward), and the pitch it took off at (so a flip's counted) */
  spin = 0; private pitch0 = 0;
  /** how far off square to the slope the last landing came down (rad): for the score's CLEAN */
  lastMiss = 0;
  /** the take-off model: the pull (0…1) built on the ramp, eased toward how hard you're pulling, and the rotation it
   * committed at the lip. The air's tricks: how far into each of the body's it is (0 on the bike, 1 all the way off),
   * how long each has been held all the way, the trick asked for now, and whether that ask was refused (too little air
   * left to get into it and back: refused until it's asked again) */
  /** why the last landing was a crash (for the tests and the notes) */
  crashWhy = ''; crashImp = 0;
  pull = 0; spin0 = 0;
  outs = Object.fromEntries(BODY.map((k) => [k, 0])) as Record<Body, number>;
  held = Object.fromEntries(BODY.map((k) => [k, 0])) as Record<Body, number>;
  asked: Trick | null = null; refused = false; private called = new Set<Body>();
  /** whether this flight came off a ramp's lip (a jump) rather than a crest or an edge */
  lipFlight = false;
  /** how far off the bike, all the body's tricks together (land with more than a little and it's a crash) */
  get trickOut() { let o = 0; for (const k of BODY) o += this.outs[k]; return o; }
  /** the drive as last asked, and where it stood when you left the ground: in the air the nose answers to how far it's
   * moved from there (so the throttle held through a lip doesn't tip you over), from nothing once it's let go */
  private driveNow = 0; private drive0 = 0;
  /** the rider's body on the bike, sprung (it lags, overshoots, settles): its roll against the bike's lean, its shift
   * across, fore and aft, and up and down (the legs and arms taking the bumps) */
  body = { roll: 0, shift: 0, fore: 0, rise: 0, look: 0, nod: 0, vRoll: 0, vShift: 0, vFore: 0, vRise: 0, vLook: 0, vNod: 0 };
  private yawS = 0; private vWas = 0; private vyWas = 0;
  /** the run: metres down, best air, crashes, a score */
  dist = 0; bestAir = 0; crashes = 0; jumps = 0;
  events: Event[] = [];
  /** the last checkpoint flag passed (its station; the start until the first), and how many have been passed: a crash
   * puts you back just past it */
  checkpoint = 2; checkpoints = 0;
  private sPrev = 2;
  /** the ground's own vertical pace under you last step (NaN: just come down, nothing to compare yet) */
  private vyGround = NaN; private headingWas = 0;
  constructor(readonly course: Course) { this.place(); }
  /** put on the line at station s, riding (`at=`, for looking at a place) */
  putAt(s: number) { this.s = s; this.u = 0; this.psi = 0; this.v = 20; this.air = false; this.vy = 0; this.place(); this.sPrev = s; this.headingWas = this.travel; this.wheels(); }
  private place() { const p = this.course.point(this.s, this.u); this.x = p.x; this.y = p.y; this.z = p.z; this.heading = this.travel = p.heading - this.psi; this.slip = 0; }
  private ev(kind: Event['kind'], k: number) { this.events.push({ kind, x: this.x, y: this.y, z: this.z, k }); if (this.events.length > 64) this.events.shift(); }

  step(dt: number, inp: Input) {
    if (this.crashT > 0) {
      this.crashT -= dt;
      if (this.crashT <= 0) {
        // (back to the last checkpoint flag passed, just past it, on the line, and going again)
        this.u = 0; this.psi = 0; this.v = 24; this.air = false; this.vy = 0; this.vyGround = NaN; this.s = this.checkpoint + 3;
        while (!this.course.point(this.s, 0).surface || this.course.at(this.s).feature !== 'none') this.s += 1;
        this.place(); this.sPrev = this.s; this.headingWas = this.travel; this.lean = 0; this.squash = 0; this.wheels(); this.whip = this.vWhip = 0; this.spin = 0; this.pitch = wrap(this.pitch);
        this.spin0 = 0; this.pull = 0; this.clearTricks();
        this.ev('respawn', this.checkpoints);
      }
      else { this.vy -= G * dt; this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt; this.pitch += dt * 3; }
      return;
    }
    this.steerK += (inp.steer - this.steerK) * (1 - Math.exp(-dt * 10));
    if (!this.air) this.driveNow = inp.drive ?? (inp.brake ? -1 : 0);
    if (this.air) this.fly(dt, inp); else this.ride(dt, inp);
    this.sprung(dt);
    // (past a flag: that's the checkpoint now)
    if (this.crashT <= 0 && this.s > this.sPrev) for (let i = Math.floor(this.sPrev) + 1; i <= Math.floor(this.s); i++) if (this.course.at(i).flag && i > this.checkpoint) { this.checkpoint = i; this.checkpoints++; this.ev('checkpoint', this.checkpoints); }
    this.sPrev = this.s;
  }
  private ride(dt: number, inp: Input) {
    const c = this.course, here = c.point(this.s, this.u), half = here.width / 2;
    // (pace: the hill's fall, the engine up to its top, the air's drag, the brake; slower on the loose shoulder)
    const grade = c.point(this.s - 1, 0).y - c.point(this.s + 1, 0).y;
    // (the drive: left alone the engine pulls toward its top as it always has; opened wider it pulls harder, toward ~185
    // km/h; the brake bites as hard as it's pulled)
    // (on a ramp, down is the pull, not the brake: braking up a ramp only spoils the jump; how hard you're pulling as you
    // leave is the flip you've chosen. Off a ramp the pull lets go)
    const d0 = drive(inp), onRamp = here.feature === 'ramp';
    this.pull += ((onRamp ? Math.max(0, -d0) : 0) - this.pull) * (1 - Math.exp(-dt * (onRamp ? 14 : 8)));
    const d = onRamp ? Math.max(0, d0) : d0, gas = Math.max(0, d), brk = Math.max(0, -d), top = VMAX * (1 + 0.12 * gas);
    let a = G * grade * 0.5 * 0.85 + (this.v < top ? 11 * (1 + 0.6 * gas) * (1 - this.v / top) : 0) - 0.0022 * this.v * this.v - brk * 18;
    if (Math.abs(this.u) > half) a -= 6;
    this.v = Math.max(4, this.v + a * dt);
    // (steering turns the bike, quicker at low speed; + is right, which turns the heading down)
    const maxYaw = 3.4 / (1 + this.v / 60);
    this.heading -= this.steerK * maxYaw * dt;
    // (the travel follows the bike through the tyres' grip, less of it at speed and braking; the slide self-aligns slowly,
    // and scrubs pace)
    const grip = 10 - 6 * Math.min(1, this.v / VMAX) - brk * 3;
    this.travel += wrap(this.heading - this.travel) * (1 - Math.exp(-dt * grip));
    this.slip = wrap(this.heading - this.travel);
    this.heading -= this.slip * dt * 1.5;
    this.v = Math.max(4, this.v - Math.abs(this.slip) * this.v * 0.5 * dt);
    const yBefore = this.y, sWas = this.s;
    this.x += Math.sin(this.travel) * this.v * dt; this.z += Math.cos(this.travel) * this.v * dt;
    const loc = c.locate(this.x, this.z, this.s); this.s = loc.s; this.u = loc.u; this.dist += Math.max(0, this.s - sWas);
    // (the wall, on the left: a glance off it, turned back along the line)
    if (this.u < -half - 1.4) {
      this.u = -half - 1.4; const w = c.point(this.s, this.u); this.x = w.x; this.z = w.z;
      this.travel = this.heading = w.heading - 0.12; this.v *= 0.72; this.ev('wall', this.v / VMAX);
    }
    let sy = this.surfaceY(this.s, this.u);
    // (a face rising in front (an outcrop on the drop side, the side of a raised deck): a glance off it, turned away
    // from it, the pace lost; + u is right, and turning left raises the heading)
    if (sy - yBefore > 0.9) {
      const back = c.locate(this.x - Math.sin(this.travel) * this.v * dt, this.z - Math.cos(this.travel) * this.v * dt, this.s), w = c.point(back.s, back.u);
      const away = this.u > back.u ? 1 : -1;
      this.s = back.s; this.u = back.u; this.x = w.x; this.z = w.z;
      this.travel = this.heading = w.heading + away * 0.12; this.v *= 0.72; this.ev('wall', this.v / VMAX);
      sy = this.surfaceY(this.s, this.u);
    }
    this.psi = wrap(c.point(this.s, 0).heading - this.travel);
    const p = c.point(this.s, this.u);
    // (a ramp's lip: you fly; onto nothing (a kicker's gap): you fall)
    // (the lip is the ramp's last station: past it, off you go, at the pace the ramp's last metre was lifting you; not a
    // metre on, where the surface has already gone flat over the gap)
    if (here.feature === 'ramp' && (p.feature !== 'ramp' || c.at(Math.floor(this.s) + 1).feature !== 'ramp')) { this.launch(yBefore, dt, false); return; }
    if (Math.abs(this.u) <= half && !p.surface) { this.launch(yBefore, dt, true); return; }
    // (the drop side is ridden, not fallen off: the shoulder, then the slope beyond it, which takes you down it if it's
    // steep (sliding toward the valley); far enough down and you've gone over: a crash)
    if (this.u > half + 14) { this.crash('over'); return; }
    if (this.u > half + 2.6) {
      const cross = this.surfaceY(this.s, this.u) - this.surfaceY(this.s, this.u + 1);
      if (cross > 0.45) this.travel -= Math.min(1, cross - 0.45) * 0.9 * dt;
    }
    // (off the side of something raised (a deck, a ramp), or over a step down: the ground's gone from under you, you fall)
    if (sy < yBefore - 0.4) { this.launch(yBefore, dt, true); return; }
    const vyG = (sy - yBefore) / dt;
    // (a crest: the ground a tenth of a second on (the way you're going, across the line too) falls away below the arc
    // you'd fly from here, by more than the suspension takes up: an edge, a lip, the shelf's brink)
    const tau = 0.12, ahead = this.surfaceY(this.s + this.v * tau * Math.cos(this.psi), this.u + this.v * tau * Math.sin(this.psi)), arc = sy + vyG * tau - 0.5 * G * tau * tau;
    // (not on a ramp: there the lip is the launch, exactly, so a big ramp throws you as steeply as it's built to)
    if (here.feature !== 'ramp' && this.v > 8 && !Number.isNaN(this.vyGround) && ahead < arc - 0.26) { this.launch(yBefore, dt, false, false); return; }
    // (the suspension takes up each step the ground throws you up by)
    if (!Number.isNaN(this.vyGround)) this.squash = Math.min(1, this.squash + Math.max(0, vyG - this.vyGround) * 0.07);
    this.vyGround = vyG;
    this.y = sy;
    const fx = Math.sin(this.travel), fz = Math.cos(this.travel);
    this.vx = fx * this.v; this.vz = fz * this.v; this.vy = vyG;
    // (lean: what the turn asks, its pace times how fast the travel's swinging (smoothed: a flick of the bars isn't a
    // turn), against gravity, and never more than ~35°; it comes in over a third of a second, not at once; + leans right)
    const yaw = wrap(this.travel - this.headingWas) / dt; this.headingWas = this.travel;
    this.yawS += (yaw - this.yawS) * (1 - Math.exp(-dt * 3));
    this.lean += (Math.max(-0.6, Math.min(0.6, Math.atan2(-this.v * this.yawS, G) * 0.8)) - this.lean) * (1 - Math.exp(-dt * 2.6));
    // (each wheel on the ground under it, the bike pitched between them: + is nose up)
    this.wheels();
    this.pitch += (Math.atan2(this.yFront - this.yRear, 1.6) - this.pitch) * (1 - Math.exp(-dt * 25));
    this.squash *= Math.exp(-dt * 6);
    if (Math.random() < dt * (6 + this.v * 0.6 + Math.abs(this.slip) * 120)) this.ev('roost', Math.min(1, this.v / VMAX + Math.abs(this.slip) * 2));
  }
  /** what's under (s, u): the road within its width (where there's road; up to the wall on the left), else the ground
   * beside it (the drop side's shoulder and slope, a gap's notch) as it's drawn */
  surfaceY(s: number, u: number) {
    const p = this.course.point(s, u), half = p.width / 2;
    if (u < -half) return p.y;
    if (u <= half && p.surface) return p.y;
    return ground(this.course, s, u);
  }
  /** each wheel's contact: the ground under it (on every step that ends on the ground, the landing one included, so the
   * bike is never drawn standing on where it took off from) */
  private wheels() {
    const fx0 = Math.sin(this.heading), fz0 = Math.cos(this.heading);
    this.yFront = this.groundAt(this.x + fx0 * 0.82, this.z + fz0 * 0.82);
    this.yRear = this.groundAt(this.x - fx0 * 0.78, this.z - fz0 * 0.78);
  }
  /** what's under a world point near here (for a wheel's contact) */
  private groundAt(x: number, z: number) {
    const loc = this.course.locate(x, z, this.s);
    return this.surfaceY(loc.s, loc.u);
  }
  /** the front's steering and the rider's body, after the step (both ground and air) */
  private sprung(dt: number) {
    // (the bars: turned the way you steer, less at speed; in a slide, toward where the bike's going (opposite lock))
    const want = Math.max(-0.6, Math.min(0.6, this.steerK * 0.5 * (1 - 0.5 * Math.min(1, this.v / VMAX)) + this.slip * 0.9));
    this.steer += (want - this.steer) * (1 - Math.exp(-dt * 12));
    // (the body: springs toward its posture (upright against the bike's lean, shifted to the outside of a slide,
    // standing up in the air), pushed by what the bike does under it (its speeding up and slowing, its lurches up and
    // down), so it lags and settles rather than riding as a statue)
    const b = this.body, acc = (this.v - this.vWas) / dt; this.vWas = this.v;
    const lurch = this.air ? 0 : Math.max(-3, Math.min(3, this.vy - this.vyWas)) / dt; this.vyWas = this.vy;
    const spring = (x: number, v: number, to: number, w: number, z: number, force: number) => { const a = -w * w * (x - to) - 2 * z * w * v + force; v += a * dt; return [x + v * dt, v]; };
    // (in the air: up off the seat at first, the limbs long; coming down, the hips settle back toward it and the weight
    // goes forward, ready for the ground)
    const coming = this.air && this.vy < -2;
    // (the counter-lean: the bike tips further than the body, which stays nearer upright over it)
    [b.roll, b.vRoll] = spring(b.roll, b.vRoll, -this.lean * 0.7, 7, 0.45, 0);
    [b.shift, b.vShift] = spring(b.shift, b.vShift, this.slip * 0.12 - this.lean * 0.05, 8, 0.4, 0);
    [b.fore, b.vFore] = spring(b.fore, b.vFore, this.air ? (coming ? 0.08 : -0.06) : 0, 8, 0.3, -Math.max(-25, Math.min(25, acc)) * 0.7);
    [b.rise, b.vRise] = spring(b.rise, b.vRise, this.air ? (coming ? 0 : 0.17) : 0, 10, 0.28, -Math.max(-40, Math.min(40, lurch)) * 0.3);
    // (the head, quicker than the body, so it leads: it looks where the bike's going (into the turn, along a slide), down
    // toward the ground as you come down to it, and up and out at the top of a flight)
    [b.look, b.vLook] = spring(b.look, b.vLook, Math.max(-0.6, Math.min(0.6, this.steerK * 0.3 + this.slip * 0.8)), 11, 0.6, 0);
    [b.nod, b.vNod] = spring(b.nod, b.vNod, this.air ? (coming ? 0.34 : -0.08) : 0.06 + Math.max(0, this.squash) * 0.25, 9, 0.6, 0);
    b.fore = Math.max(-0.16, Math.min(0.14, b.fore)); b.rise = Math.max(-0.14, Math.min(0.18, b.rise)); b.roll = Math.max(-0.5, Math.min(0.5, b.roll)); b.shift = Math.max(-0.12, Math.min(0.12, b.shift));
  }
  private launch(yBefore: number, dt: number, edge: boolean, lip = !edge) {
    // (off: the flight keeps the way you were carried, and the rise the ground was giving you; a lip gives a little pop)
    this.air = true; this.airT = 0;
    const fx = Math.sin(this.travel), fz = Math.cos(this.travel);
    this.vx = fx * this.v; this.vz = fz * this.v; this.vy = (this.vyGround || 0) + (lip ? 1.2 : 0);
    this.x += this.vx * dt; this.z += this.vz * dt; this.y = yBefore + this.vy * dt;
    if (lip) { this.jumps++; this.ev('launch', 1); }
    this.spin = 0; this.pitch0 = this.pitch; this.drive0 = this.driveNow;
    // (the lip commits you: off a ramp, the pull as you leave is the rotation (a light one, as a brake into the ramp
    // would be, is nothing: it takes a firm pull); off a crest or an edge, none. And a rotation the flight can't bring
    // round to a whole turn, even trimmed as hard as it can be, isn't committed at all: the flight's flown forward from
    // the lip, and if a whole turn (or two) isn't within reach, it's an ordinary flight)
    const eff = Math.max(0, (this.pull - 0.3) / 0.7);
    this.spin0 = lip ? eff * LIP.spin : 0;
    if (this.spin0) {
      const T = Math.max(0, this.airLeft() - 0.25), lo = Math.max(0, this.spin0 - LIP.trimMax) * T, hi = (this.spin0 + LIP.trimMax) * T;
      const reach = (turn: number) => lo <= turn + 0.5 && hi >= turn - 0.5;
      if (!reach(Math.PI * 2) && !reach(Math.PI * 4)) { this.spin0 = 0; this.ev('refuse', 1); }
    }
    this.spin = this.spin0;
    this.pull = 0; this.clearTricks(); this.lipFlight = lip;
  }
  private clearTricks() {
    for (const k of BODY) { this.outs[k] = 0; this.held[k] = 0; }
    this.asked = null; this.refused = false; this.called.clear();
  }
  /** how long until the flight comes down, flown forward from now as the sim flies it (gravity and the air) */
  airLeft() {
    let x = this.x, y = this.y, z = this.z, vx = this.vx, vy = this.vy, vz = this.vz, s = this.s, T = 0;
    const h = 1 / 60;
    for (; T < 6; T += h) {
      const d = 1 - AIR * Math.hypot(vx, vz) * h;
      vy -= G * h; vx *= d; vz *= d; x += vx * h; y += vy * h; z += vz * h;
      const loc = this.course.locate(x, z, s); s = loc.s;
      if (y <= this.surfaceY(loc.s, loc.u)) break;
    }
    return T;
  }
  private fly(dt: number, inp: Input) {
    this.airT += dt;
    // (the trick asked for: a new ask is weighed against the air left, flown forward: if getting into it and back out
    // won't fit (with a little to spare), it's refused, and stays refused until something else is asked. Steering does
    // nothing up here)
    const ask = inp.trick ?? null;
    if (ask !== this.asked) {
      this.asked = ask; this.refused = false;
      if (ask) { const tk = TRICKS[ask], left = this.airLeft(); if (left < tk.out + tk.back + 0.08) { this.refused = true; this.ev('refuse', 0); } }
    }
    const doing = this.refused ? null : this.asked;
    // (the body's tricks: into the one asked as quickly as it goes, out of every other as quickly as it comes back; all
    // the way off, it's called, and held as long as it's asked)
    BODY.forEach((k, i) => {
      const tk = TRICKS[k];
      if (doing === k) this.outs[k] = Math.min(1, this.outs[k] + dt / tk.out); else this.outs[k] = Math.max(0, this.outs[k] - dt / tk.back);
      if (this.outs[k] >= 1) { this.held[k] += dt; if (!this.called.has(k)) { this.called.add(k); this.ev('trick', i); } }
    });
    // (the whip: the bike swung out beneath you, sprung, either way, as long as it's asked, and back by itself)
    const wTo = doing === 'whipR' ? LIP.whip : doing === 'whipL' ? -LIP.whip : 0, wk = 60;
    this.vWhip += (-wk * (this.whip - wTo) - 2 * 0.75 * Math.sqrt(wk) * this.vWhip) * dt; this.whip += this.vWhip * dt;
    // (the line: nothing you do in the air steers, but the rider's body keeps the bike on line, as a rider's does, easing
    // the flight back along the road and toward its middle, gently (at most ~0.6 rad/s off a jump; off a crest, an air
    // you didn't ask for, twice that, so the road's bend doesn't carry you off it). Lining up isn't the trick here:
    // the rotation stays what the lip made it)
    const ln = this.course.point(this.s, 0), toward = ln.heading + Math.max(-0.2, Math.min(0.2, this.u * 0.05)), cur = Math.atan2(this.vx, this.vz);
    const lim = (this.lipFlight ? 0.6 : 1.2) * dt, turn = Math.max(-lim, Math.min(lim, wrap(toward - cur) * dt * 3)), tc = Math.cos(turn), ts = Math.sin(turn);
    const nvx = this.vx * tc + this.vz * ts, nvz = -this.vx * ts + this.vz * tc; this.vx = nvx; this.vz = nvz;
    // (gravity, and the air holding you back as it does on the ground, with the square of the pace)
    const drag = 1 - AIR * Math.hypot(this.vx, this.vz) * dt;
    this.vy -= G * dt; this.vx *= drag; this.vz *= drag;
    this.x += this.vx * dt; this.y += this.vy * dt; this.z += this.vz * dt;
    this.travel = Math.atan2(this.vx, this.vz); this.heading = this.travel + this.slip; this.slip *= Math.exp(-dt * 3);
    const loc = this.course.locate(this.x, this.z, this.s); this.s = loc.s; this.u = loc.u;
    const p = this.course.point(this.s, this.u), half = p.width / 2;
    // (in the air the drive trims the rotation, as a real bike's rear wheel does: the throttle (+) spins the wheel up and
    // lifts the nose, turning a backflip faster; the rear brake (−) stops it and drops the nose, slower. A small
    // correction, within LIP.trimMax of what the lip gave, never a flip of its own. It's measured from where the drive
    // stood as you left (so a pull held through the lip doesn't brake the flip it made), from nothing once it's let go)
    const rawD = inp.drive ?? 0; if (!rawD) this.drive0 = 0;
    const tr = drive({ steer: 0, brake: false, drive: rawD - this.drive0 }, 0.2);
    const flipping = Math.abs(this.spin0) > 0.8;
    if (flipping) this.spin = Math.max(this.spin0 - LIP.trimMax, Math.min(this.spin0 + LIP.trimMax, this.spin + tr * LIP.trim * dt));
    if (flipping) this.pitch += this.spin * dt;
    else {
      // (no flip: the nose follows the flight, as the rider's body sets it, and the drive only tilts it, the throttle up
      // and the rear brake down, at most a fifth of a turn's quarter (~20°) either way: never a rotation that builds, so
      // a straight landing's always there to be had)
      const want = Math.atan2(this.vy, Math.hypot(this.vx, this.vz)) * 0.7 + tr * 0.35, before = this.pitch;
      this.pitch += wrap(want - this.pitch) * (1 - Math.exp(-dt * 4)); this.spin = (this.pitch - before) / dt;
    }
    this.lean *= Math.exp(-dt * 2);
    this.squash += (-0.35 - this.squash) * (1 - Math.exp(-dt * 4)); // (in the air the springs extend)
    void inp;
    // (the wall, from the air: a crash)
    if (this.u < -half - 1.4 && this.y < p.y + 0.3) { this.crash('wall'); return; }
    const sy = this.surfaceY(this.s, this.u);
    if (this.y <= sy) {
      // (down. The impact is the speed into the ground's own slope, the way you're going: a landing down a slope that
      // matches the flight is soft, one onto the flat from the same height isn't. Into a gap, through a face rather than
      // onto it, too hard, or far down the drop: a crash)
      const vh = Math.hypot(this.vx, this.vz) || 1, ah = this.groundAt(this.x + this.vx / vh, this.z + this.vz / vh);
      // (and how the bike meets it: its pitch against the ground's own slope under it. Square to it, the landing's soft
      // and keeps its pace (a nose pushed down onto a falling slope carries you on faster); a little off and one wheel
      // slams; well off (nose first, or looped over onto the back wheel) it's a crash)
      // (the slope across where the wheels come down; just past a gap's edge (or just short of a drop), the side over the
      // hole doesn't count)
      const fx = (this.vx / vh) * 0.8, fz = (this.vz / vh) * 0.8, gF = this.groundAt(this.x + fx, this.z + fz), gB = this.groundAt(this.x - fx, this.z - fz);
      const slope = Math.abs(gB - sy) > 0.6 ? Math.atan2(gF - sy, 0.8) : Math.abs(gF - sy) > 0.6 ? Math.atan2(sy - gB, 0.8) : Math.atan2(gF - gB, 1.6);
      const miss = Math.abs(wrap(this.pitch - slope)), square = miss < 0.12;
      this.lastMiss = miss;
      // (the slam: the speed into the ground, and a crooked landing slams harder. Square (within ~11°) the bike and the
      // legs take nearly twice as much, at a cost: a heavy landing past what the slope was built for (too fast, onto the
      // flat) is survived square but scrubs a lot of pace)
      const slam = -(this.vy + vh * (sy - ah)) * (square ? 0.7 : 1), imp = slam + Math.max(0, miss - 0.3) * 18, lim = 30 - 15 * Math.max(0, Math.min(1, (miss - 0.2) / 0.3)), gap = Math.abs(this.u) <= half && !p.surface;
      // (and the body still off the bike: a crash)
      if (gap || sy - this.y > 1.2 || imp > lim || this.u > half + 14 || Math.abs(this.whip) > 0.6 || miss > 0.75 || this.trickOut > 0.3) {
        const nose = wrap(this.pitch - slope) > 0 ? 'nose up' : 'nose down';
        this.crashImp = imp;
        this.crashWhy = gap ? 'short' : sy - this.y > 1.2 ? 'face' : this.trickOut > 0.3 ? 'off the bike' : Math.abs(this.whip) > 0.6 ? 'whip' : miss > 0.75 || (imp > lim && imp - slam > slam * 0.5) ? nose : imp > lim ? 'hard' : 'over';
        this.crash(this.crashWhy); return;
      }
      // (else on the ground again; a hard one squashes and costs a little)
      this.air = false; this.y = sy; this.v = Math.max(6, Math.hypot(this.vx, this.vz) * (imp > 20 ? 0.7 : imp > 14 ? 0.86 : imp > 8 ? 0.97 : square && slope < -0.12 ? 1.05 : 1));
      // (a whole turn or more of the nose since take-off, landed: a flip (+ back, − front))
      const turns = Math.round((this.pitch - this.pitch0) / (Math.PI * 2));
      if (turns) this.ev('flip', turns);
      this.pitch = wrap(this.pitch); this.spin = 0; this.spin0 = 0; this.clearTricks();
      this.travel = Math.atan2(this.vx, this.vz); this.headingWas = this.travel;
      // (down with the bike still whipped: it lands yawed off the way it's going (its nose right of it: heading less) and
      // the slide takes it straight)
      if (this.whip) { this.slip = wrap(this.slip - this.whip); this.heading = this.travel + this.slip; this.whip = this.vWhip = 0; }
      this.bestAir = Math.max(this.bestAir, this.airT); this.squash = Math.min(1, imp / 12); this.vyGround = NaN;
      this.ev('land', Math.min(1, imp / 10));
      this.wheels();
      return;
    }
  }
  private crash(why: string) { this.crashWhy = why; this.crashT = 1.1; this.crashes++; this.ev('crash', 1); this.air = true; }
}

/** a steer that keeps to the line (for `auto`, the preview and the tests): pure pursuit of a point on the line ahead,
 * further ahead the faster you go, steering the way you're travelling (so a slide is ridden, not fought) */
export function autoSteer(r: Rider) {
  const P = r.course.point(r.s + 7 + r.v * 0.3, 0), want = Math.atan2(P.x - r.x, P.z - r.z);
  return Math.max(-1, Math.min(1, -wrap(want - r.travel) * 4));
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** the drive asked for (−1…1), less a dead zone (so a drag that's mostly sideways doesn't brake or tip the nose) */
function drive(inp: Input, dead = 0.15) {
  const d = inp.drive ?? (inp.brake ? -1 : 0), m = Math.max(0, Math.abs(d) - dead) / (1 - dead);
  return Math.sign(d) * Math.min(1, m);
}

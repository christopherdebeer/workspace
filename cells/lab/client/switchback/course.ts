/**
 * Switchback's course: an endless downhill line cut into a mountainside, made from a seed as you go.
 *
 * The line is laid a metre at a time: a heading that winds (sweepers, tight bends, the odd long straight), a fall that
 * steepens and eases, and features set along it: a **kicker** (a ramp, a gap over the drop, a landing deck on a trestle),
 * **whoops** (a run of rollers), and the fence and flags that line it. The mountain stands on the left of the line (a rock
 * wall going up) and falls away on the right (the drop to the valley), as a cliff road does.
 *
 * Everything asks the course the same three things: where its centre is at distance `s` (and which way it runs, how wide
 * it is), how high the surface is at (s, u) (u across it, + to the drop side), and whether there's surface there at all
 * (a kicker's gap has none).
 */
export type Feature = 'none' | 'ramp' | 'gap' | 'deck' | 'whoop';

/** the jumps, by size (the ramp's chevrons count it): 1 a hop, 2 a kicker, 3 a big kicker, 4 a big-air booter. The
 * classic deck kicker (`deck`) lands on trestles; the others are built to a flight: (for the big ones a gentler run-in,) a ramp, a gap
 * to clear and a landing shaped to the flight a rider at the design pace makes (`T` its airtime, `angle` the lip's rise
 * above level, `knuckle` how far along it the landing begins), so whoever clears it comes down along it. On a mountain
 * falling a quarter of the way, even a flat launch at speed flies two seconds before the road comes up to meet it, so a
 * hop is a tabletop: its landing raised to meet the flight early */
export const JUMPS: Record<number, { ramp: number; rise?: number; gap?: number; deck?: number; deckLift?: number; approach?: number; angle?: number; T?: number; knuckle?: number }> = {
  1: { ramp: 8, approach: 14, angle: 0.06, T: 0.85, knuckle: 0.1 },
  2: { ramp: 14, approach: 16, angle: 0.08, T: 1.6, knuckle: 0.3 },
  3: { ramp: 18, approach: 30, angle: 0.24, T: 2.45, knuckle: 0.45 },
  4: { ramp: 22, approach: 40, angle: 0.36, T: 3.4, knuckle: 0.45 },
};
/** the pace a big jump is built for (m/s), and the air's drag in flight (as on the ground: dv/dt = −AIR·v²) */
export const DESIGN_V = 34, AIR = 0.0022;
export interface Station {
  x: number; y: number; z: number; heading: number; width: number;
  /** the surface's own rise above the line here (a ramp's, a roller's), and what kind of ground it is */
  lift: number; feature: Feature;
  /** a checkpoint flag (on the wall side) or a fence post (on the drop side) stands here */
  flag: boolean; post: boolean;
  /** on a jump's stations, its size (1–4) */
  size?: number;
}

export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** a smooth hash noise in 1D (for the jitter that makes the mountain faceted, not wavy) */
export function hash(...n: number[]) {
  let h = 2166136261;
  for (const x of n) { h ^= Math.floor(x * 9973) | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; h = Math.imul(h, 1540483477); h ^= h >>> 15; }
  return (h >>> 0) / 4294967296;
}

export class Course {
  readonly st: Station[] = [];
  private r: () => number;
  /** what the laying is doing now: the turn it's making (rad/m), for how long, and the feature it's laying */
  private turn = 0; private turnLeft = 0; private grade = 0.22; private gradeTo = 0.22;
  private width = 7; private widthTo = 7; private widthStep = 0; private wideLeft = 0; private roughFrom = 0; private roughTo = 0; private roughLeft = 0; private roughLen = 1;
  private plan: { kind: Feature; at: number; size?: number; H?: number; lipY?: number; line0?: number; vy0?: number; xs?: number; xt?: number; xe?: number }[] = [];
  /** a booter's due here (just past a checkpoint flag), or 0 */
  private booterDue = 0;
  private sinceKicker = 0;
  /** where the next checkpoint flag may stand */
  private nextFlag = 150;
  constructor(readonly seed: number) {
    this.r = rng(seed);
    // (a run-in: a straight, gentle start)
    this.st.push({ x: 0, y: 0, z: 0, heading: 0, width: 7, lift: 0, feature: 'none', flag: false, post: false });
    this.ensure(400);
  }
  /** lay the line on to at least `s` metres */
  ensure(s: number) {
    const r = this.r;
    while (this.st.length <= s + 2) {
      const i = this.st.length, p = this.st[i - 1];
      // (the route: straight legs broken by sharp kinks, as a track picks its way down rock, not a road's smooth arcs; a
      // kink turns back toward the fall line once the route has wandered off it, so it keeps going down the valley)
      if (this.turnLeft <= 0) {
        if (this.turn !== 0 || i < 60) {
          // (a leg: straight, for a while)
          this.turn = 0; this.turnLeft = i < 60 ? 60 - i : 12 + r() * 30;
          this.gradeTo = 0.14 + r() * 0.26;
        } else {
          // (a kink: short and sharp, a few of them hard)
          const side = p.heading > 0.4 ? -1 : p.heading < -0.4 ? 1 : r() < 0.5 ? -1 : 1;
          const sharp = r() < 0.35, len = 7 + Math.floor(r() * 7), ang = (sharp ? 0.38 + r() * 0.34 : 0.1 + r() * 0.24) * side;
          this.turn = ang / len; this.turnLeft = len;
        }
      }
      // (the width: never settled, a new one every few metres, joined straight; now and then a pinch between rocks, or
      // a wide flat)
      if (--this.wideLeft <= 0) {
        const q = r();
        this.widthTo = q < 0.15 ? 3.8 + r() * 0.8 : q > 0.85 ? 10 + r() * 3 : 5 + r() * 4.5;
        this.wideLeft = 4 + Math.floor(r() * 8); this.widthStep = (this.widthTo - this.width) / this.wideLeft;
      }
      this.turnLeft--;
      this.grade += (this.gradeTo - this.grade) * 0.08;
      this.width += this.widthStep;
      // (the rough: the surface steps up and down over rock, a new height every few metres, joined straight)
      if (--this.roughLeft <= 0) { this.roughFrom = this.roughTo; this.roughTo = r() * 0.22; this.roughLen = this.roughLeft = 5 + Math.floor(r() * 6); }
      const rough = i < 40 ? 0 : this.roughTo + (this.roughFrom - this.roughTo) * (this.roughLeft / this.roughLen);
      const heading = p.heading + this.turn;
      const st: Station = { x: p.x + Math.sin(heading), z: p.z + Math.cos(heading), y: p.y - this.grade, heading, width: this.width, lift: rough, feature: 'none', flag: false, post: i % 6 === 0 };
      this.st.push(st);
      // (features, laid on straights and gentle bends: a kicker every so often, whoops between)
      this.sinceKicker++;
      // (a booter, the big set piece, just past a checkpoint flag when one's due)
      if (!this.plan.length && this.booterDue && i >= this.booterDue) { this.plan.push({ kind: 'ramp', at: i, size: 4 }); this.booterDue = 0; this.sinceKicker = 0; }
      if (!this.plan.length && i > 120 && this.turn === 0 && this.turnLeft > 6) {
        // (a kicker's size: a hop, a kicker, a big one; drawn from its own hash so the rest of the course is laid as before)
        if (this.sinceKicker > 160 && r() < 0.05) { const h = hash(this.seed, i, 61); this.plan.push({ kind: 'ramp', at: i, size: h < 0.3 ? 1 : h < 0.72 ? 2 : 3 }); this.sinceKicker = 0; }
        else if (r() < 0.006) this.plan.push({ kind: 'whoop', at: i });
      }
      const f = this.plan[0];
      if (f) {
        const k = i - f.at;
        if (f.kind === 'ramp') {
          const J = JUMPS[f.size ?? 2];
          this.turn = 0; this.turnLeft = Math.max(this.turnLeft, 4); st.width = Math.max(st.width, (f.size ?? 2) > 2 ? 8 : 7);
          if (J.deck) {
            // (a hop or a kicker: its ramp, a gap, a landing deck falling back to the line)
            const R = J.ramp, G = R + J.gap!, D = G + J.deck;
            // (its rise enough, however steep the mountain is here, that the lip still points a little above level)
            if (k === 0) f.H = Math.max(J.rise!, ((Math.tan(J.angle!) + this.grade) * R) / 1.6);
            if (k <= R) { st.feature = 'ramp'; st.size = f.size; st.lift = f.H! * Math.pow(k / R, 1.6); }
            else if (k < G) { st.feature = 'gap'; st.lift = 0; st.post = false; }
            else if (k < D) { st.feature = 'deck'; st.lift = J.deckLift! * (1 - (k - G) / J.deck); }
            else this.plan.shift();
          } else this.bigJump(f, J, k, i, st, p);
        } else if (f.kind === 'whoop') {
          this.turn = 0; this.turnLeft = Math.max(this.turnLeft, 4);
          if (k < 48) { st.feature = 'whoop'; st.lift = 0.45 * (0.5 - 0.5 * Math.cos((k / 12) * Math.PI * 2)); } else this.plan.shift();
        }
      }
      // (flags: the checkpoints, where the route's plain, further apart the further down you are (from ~280 m apart at
      // the top to ~1 km five kilometres on); the roll that once placed a flag every 31 m is still made, so the course is
      // laid exactly as before, but only one in many is kept)
      const roll = st.feature === 'none' && i % 31 === 0 && r() < 0.7;
      st.flag = roll && i >= this.nextFlag;
      // (a booter now and then a little way past a flag: far enough on that, put back at the flag, you're up to pace by it)
      if (st.flag) { this.nextFlag = i + 250 + Math.floor(i * 0.15 + hash(this.seed, i, 77) * 80); if (hash(this.seed, i, 93) < 0.6) this.booterDue = i + 150; }
    }
  }
  /** a big jump, station by station (k from its start): the run-in eased toward level; the ramp, its rise found so its lip
   * stands at `angle` above level; past the lip, the flight a rider at the design pace makes (horizontal pace slowed by the
   * air, the rise by gravity), and under it a gully to clear and then the landing: just below the flight where the short
   * ones come down, meeting it at T (the sweet spot), then straight on along the flight's own slope for the long ones, and
   * the run-out easing back to the mountain's grade */
  private bigJump(f: Course['plan'][number], J: (typeof JUMPS)[number], k: number, i: number, st: Station, p: Station) {
    const A = J.approach!, L = J.ramp;
    // (the run-in: straight, so you can line up; for the big ones eased toward level)
    if (k < A) { st.feature = 'none'; st.lift = 0; if ((f.size ?? 2) > 2) this.gradeTo = 0.1; return; }
    if (k <= A + L) {
      if (k === A) { this.gradeTo = this.grade; f.H = ((Math.tan(J.angle!) + this.grade) * L) / 2; }
      st.feature = 'ramp'; st.size = f.size; st.lift = f.H! * ((k - A) / L) ** 2;
      if (k === A + L) {
        // (the lip: the flight from here, at the design pace, its rise what the last metre of ramp gives plus the lip's pop)
        f.lipY = st.y + st.lift; f.line0 = st.y; f.vy0 = DESIGN_V * (f.H! * (1 - ((L - 1) / L) ** 2) - this.grade) + 1.2;
        f.xt = Math.log(1 + AIR * DESIGN_V * J.T!) / AIR; f.xs = Math.max(4, Math.round(f.xt * J.knuckle!)); f.xe = Math.round(f.xt * 1.6);
      }
      return;
    }
    const x = k - A - L, at = (xx: number) => (Math.exp(AIR * xx) - 1) / (AIR * DESIGN_V);
    const Y = (xx: number) => { const t = at(xx); return f.lipY! + f.vy0! * t - 4.9 * t * t; };
    const dY = (xx: number) => (f.vy0! - 9.8 * at(xx)) * (Math.exp(AIR * xx) / DESIGN_V);
    // (below the flight before the sweet spot by more the nearer the knuckle (so a slower rider, flying lower and shorter,
    // still comes down on it), along it after)
    const c0 = Math.max(1.2, 0.12 * (f.xt! - f.xs!)), S = (xx: number) => (xx <= f.xt! ? Y(xx) - c0 * ((f.xt! - xx) / (f.xt! - f.xs!)) ** 1.3 : Y(f.xt!) + dY(f.xt!) * (xx - f.xt!));
    if (x < f.xs!) { st.feature = 'gap'; st.lift = 0; st.post = false; st.y = f.line0! + ((S(f.xs!) - f.line0!) * x) / f.xs!; }
    else if (x <= f.xe!) { st.feature = 'none'; st.lift = 0; st.y = S(x); }
    else { this.grade = Math.min(0.9, -dY(f.xe!)); this.gradeTo = 0.2; st.y = p.y - this.grade; this.plan.shift(); }
    void i;
  }
  /** the station at distance s (clamped), and the one after it, for interpolation */
  at(s: number): Station { this.ensure(s + 4); return this.st[Math.max(0, Math.min(this.st.length - 1, Math.round(s)))]; }
  /** where (s, u) is in the world, and the surface's height there; `null` height where there's no surface (a gap) */
  point(s: number, u: number) {
    this.ensure(s + 4);
    const i = Math.max(0, Math.min(this.st.length - 2, Math.floor(s))), f = Math.min(1, Math.max(0, s - i)), a = this.st[i], b = this.st[i + 1];
    const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f, h = a.heading + (b.heading - a.heading) * f;
    // (the right hand, looking down the line: +x is to the left of a viewer facing +z)
    const rx = -Math.cos(h), rz = Math.sin(h);
    // (a gap has no surface; the station before it holds its height to its edge)
    const gap = a.feature === 'gap', bl = b.feature === 'gap' ? a.lift : b.lift;
    const lift = a.lift + (bl - a.lift) * f;
    const y = a.y + (b.y - a.y) * f + lift;
    return { x: x + rx * u, z: z + rz * u, y, heading: h, width: a.width, surface: !gap, lift, feature: a.feature };
  }
  /** the line's distance and offset nearest a world point, searched round a guess */
  locate(x: number, z: number, guess: number): { s: number; u: number } {
    let best = guess, bd = Infinity;
    const lo = Math.max(0, Math.floor(guess) - 6), hi = Math.floor(guess) + 12;
    this.ensure(hi + 2);
    for (let i = lo; i <= hi; i++) { const p = this.st[i], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i; } }
    // (refine between stations)
    const p = this.st[best], q = this.st[best + 1], dx = q.x - p.x, dz = q.z - p.z, L2 = dx * dx + dz * dz || 1;
    let t = ((x - p.x) * dx + (z - p.z) * dz) / L2;
    if (t < 0 && best > 0) { const o = this.st[best - 1], ex = p.x - o.x, ez = p.z - o.z; t = ((x - o.x) * ex + (z - o.z) * ez) / (ex * ex + ez * ez || 1) - 1; }
    const s = best + Math.max(-1, Math.min(1, t)), c = this.point(s, 0), rx = -Math.cos(c.heading), rz = Math.sin(c.heading);
    return { s, u: (x - c.x) * rx + (z - c.z) * rz };
  }
}

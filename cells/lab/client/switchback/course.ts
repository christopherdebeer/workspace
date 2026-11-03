/**
 * Switchback's mountain and the route down it, made from a seed as you go.
 *
 * **The mountain** is one height field for the whole world: a steep face falling toward +z (rough with ridges), a valley
 * floor far below with a river winding along it, and across the valley the far side rising to the ranges, snow on their
 * tops. Everything stands on it: the near ground, the far slopes, the ranges.
 *
 * **The route** is laid a metre at a time down that face as a mountain road is: traverses across the slope (each angled
 * a little downhill, broken by short sharp kinks), joined by **hairpins**, so each leg runs back below the last and from
 * a leg you look down on the ones below. Its height follows the mountain (a little below it, so it's cut in), its width
 * never settles, its surface is rough. On the legs: **kickers** (a ramp, a gap through the ledge, a landing deck) and
 * **whoops**. A fence along the drop side, flags at the hairpins and before the kickers.
 *
 * **The carved ground** is the mountain with the route cut into it: a bench where the road runs, a cut face rising above
 * it on the uphill side, an embankment falling steeply below it on the downhill side (so between two legs there's a
 * cliff from the one above down to the one below), and a notch through the ledge under a kicker's gap.
 *
 * Everything asks the course the same things: where the line is at distance `s` (which way it runs, how wide), the road's
 * height at (s, u) (u across it, + to the right), whether there's road there at all (a gap has none), and the carved
 * ground's height anywhere.
 */
export type Feature = 'none' | 'ramp' | 'gap' | 'deck' | 'whoop';
export interface Station {
  x: number; y: number; z: number; heading: number; width: number;
  /** the surface's own rise above the line here (a ramp's, a roller's, the rough's), and what kind of ground it is */
  lift: number; feature: Feature;
  /** which side the ground falls away on (+1 right, -1 left), and how much (0…1) */
  drop: number; dropK: number;
  /** a flag stands here, on this side (0 none); a fence post stands here (on the drop side), leaning so */
  flag: number; post: boolean; lean: number;
  /** in a hairpin */
  pin: boolean;
}

export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hash(...n: number[]) {
  let h = 2166136261;
  for (const x of n) { h ^= Math.floor(x * 9973) | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; h = Math.imul(h, 1540483477); h ^= h >>> 15; }
  return (h >>> 0) / 4294967296;
}
/** smooth value noise in 2D, 0…1 */
export function noise2(seed: number, x: number, z: number, salt = 0) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(seed, i, j, salt), b = hash(seed, i + 1, j, salt), c = hash(seed, i, j + 1, salt), d = hash(seed, i + 1, j + 1, salt);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
const smax = (a: number, b: number, k: number) => { const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (a - b) / k)); return b + (a - b) * h + k * h * (1 - h); };
const smin = (a: number, b: number, k: number) => -smax(-a, -b, k);

/** the mountain's fall (per metre toward +z), its valley floor, where the floor is */
export const FALL = 1.1, FLOOR = -2300, Z_FLOOR = -FLOOR / FALL;
/** where the river runs (its z) at x */
export const riverZ = (seed: number, x: number) => Z_FLOOR + 520 + 170 * Math.sin(x / 700 + seed) + 60 * Math.sin(x / 230 + seed * 2);
/** the snow line, ragged */
export const snowLine = (seed: number, x: number, z: number) => -200 + 260 * (noise2(seed, x / 900, z / 900, 41) - 0.5) * 2;

/** the natural mountain at (x, z), before the route is cut into it; `cell`: the spacing it's sampled at (detail finer
 * than that is left out, so a coarse ring doesn't alias it into speckle) */
export function mountain(seed: number, x: number, z: number, cell = 0) {
  // (this side: the steep face, ridged and gullied, rising behind to a cap)
  const rough = 26 * (noise2(seed, x / 260, z / 260, 1) - 0.5) * 2 + (cell < 10 ? 8 * (noise2(seed, x / 70, z / 70, 2) - 0.5) * 2 : 0);
  const face = smin(-FALL * z + rough, 1400 + 300 * noise2(seed, x / 800, 0, 3), 200);
  // (the floor, and the river in it)
  const rz = riverZ(seed, x), rd = Math.abs(z - rz);
  const floor = FLOOR + 40 * (noise2(seed, x / 500, z / 500, 4) - 0.5) - 18 * Math.max(0, 1 - rd / 90);
  // (the far side, rising to the ranges: ridged peaks, their crests sharp)
  const zb = z - (Z_FLOOR + 2600 + 500 * (noise2(seed, x / 1800, 0, 5) - 0.5));
  const ridge = 1 - Math.abs(noise2(seed, x / 1300, z / 1300, 6) * 2 - 1), ridge2 = cell > 150 ? 0.5 : 1 - Math.abs(noise2(seed, x / 420, z / 420, 7) * 2 - 1);
  const far = smin(FLOOR + 0.7 * zb, 200 + ridge * 1300 + ridge2 * 260, 300) + ridge2 * 90;
  return smax(face, smax(floor, far, 120), 90);
}

export class Course {
  readonly st: Station[] = [];
  private r: () => number;
  /** what the laying is doing: the leg's direction (+1 toward +x), its base heading, the kink it's holding, the turn
   * it's making, where the leg turns back, and the features planned */
  private dir = 1; private base = 0; private kink = 0; private kinkTo = 0; private kinkLeft = 20;
  private pinLeft = 0; private pinRate = 0; private legEnd = 130;
  private width = 7; private widthStep = 0; private wideLeft = 0;
  private roughFrom = 0; private roughTo = 0; private roughLeft = 0; private roughLen = 1;
  private plan: { kind: Feature; at: number }[] = [];
  private sinceKicker = 60; private nextPost = 0; private sincePin = 0;
  /** the stations by where they are (26 m buckets), for the carved ground */
  private buckets = new Map<number, number[]>();
  constructor(readonly seed: number) {
    this.r = rng(seed);
    this.base = this.legBase(1);
    const y = mountain(seed, 0, 0) - 1.2;
    this.st.push({ x: 0, y, z: 0, heading: this.base, width: 7, lift: 0, feature: 'none', drop: 1, dropK: 1, flag: 0, post: false, lean: 0, pin: false });
    this.bucket(0);
    this.ensure(600);
  }
  /** a leg's heading: across the slope, toward +x or -x, angled downhill a little */
  private legBase(dir: number) { return dir * (Math.PI / 2 - (0.1 + this.r() * 0.14)); }
  private bucket(i: number) {
    const s = this.st[i], k = this.key(Math.floor(s.x / 26), Math.floor(s.z / 26));
    let b = this.buckets.get(k); if (!b) this.buckets.set(k, (b = [])); b.push(i);
  }
  private key(i: number, j: number) { return (i + 4096) * 8192 + (j + 4096); }
  ensure(s: number) {
    const r = this.r, seed = this.seed;
    while (this.st.length <= s + 2) {
      const i = this.st.length, p = this.st[i - 1];
      let pin = false;
      // (the heading: a hairpin turning the route back, or the leg's own heading with its kinks)
      let heading: number;
      if (this.pinLeft > 0) {
        this.pinLeft--; pin = true; heading = p.heading + this.pinRate;
        if (this.pinLeft === 0) { this.base = heading; this.kink = this.kinkTo = 0; this.kinkLeft = 25 + r() * 20; }
      } else {
        // (the leg ends past its turning point, if nothing's being laid: then a hairpin, turning through the fall line)
        if (this.dir * p.x > this.legEnd && !this.plan.length && i > 80) {
          const to = this.legBase(-this.dir), R = 10 + r() * 4, turn = to - p.heading;
          this.pinLeft = Math.max(8, Math.round(Math.abs(turn) * R)); this.pinRate = turn / this.pinLeft;
          this.dir = -this.dir; this.legEnd = r() < 0.35 ? 170 + r() * 110 : 60 + r() * 80;
          // (a flag on the outside of the turn, before it)
          const back = this.st[Math.max(0, i - 14)]; if (back.feature === 'none') back.flag = this.dir > 0 ? 1 : -1;
        }
        // (kinks: short sharp changes, held a while; none while a feature's being laid)
        if (--this.kinkLeft <= 0) { this.kinkTo = this.plan.length ? this.kink : (r() - 0.5) * 0.6; this.kinkLeft = 18 + r() * 30; }
        this.kink += Math.max(-0.035, Math.min(0.035, this.kinkTo - this.kink));
        const want = this.base + this.kink;
        heading = this.pinLeft > 0 ? p.heading + this.pinRate : p.heading + Math.max(-0.05, Math.min(0.05, want - p.heading));
        if (this.pinLeft > 0) { this.pinLeft--; pin = true; }
      }
      const x = p.x + Math.sin(heading), z = p.z + Math.cos(heading);
      // (the height: following the mountain, a little cut into it, never steeper than a bike can hold; flatter round a
      // hairpin)
      const natural = mountain(seed, x, z) - 1.2;
      // (a kicker's laid on a gentle grade, so its ramp rises and its deck's within reach)
      const g = this.plan[0]?.kind === 'ramp' ? 0.12 : Math.max(0.03, Math.min(pin ? 0.16 : 0.36, 0.17 + (p.y - natural) * 0.05));
      this.sincePin = pin ? 0 : this.sincePin + 1;
      // (the width: never settled; now and then a pinch, or a wide flat; wider round a hairpin)
      if (--this.wideLeft <= 0) {
        const q = r(), to = q < 0.15 ? 4 + r() * 0.8 : q > 0.85 ? 9.5 + r() * 3 : 5 + r() * 4;
        this.wideLeft = 5 + Math.floor(r() * 9); this.widthStep = (to - this.width) / this.wideLeft;
      }
      this.width = Math.max(3.8, this.width + this.widthStep);
      if (--this.roughLeft <= 0) { this.roughFrom = this.roughTo; this.roughTo = r() * 0.22; this.roughLen = this.roughLeft = 5 + Math.floor(r() * 6); }
      const rough = i < 40 ? 0 : this.roughTo + (this.roughFrom - this.roughTo) * (this.roughLeft / this.roughLen);
      const st: Station = { x, z, y: p.y - g, heading, width: pin ? Math.max(this.width, 8) : this.width, lift: rough, feature: 'none', drop: 0, dropK: 0, flag: 0, post: false, lean: 0, pin };
      // (which side falls away: the mountain either side of the road)
      const rx = -Math.cos(heading), rz = Math.sin(heading), off = st.width / 2 + 7;
      const hr = mountain(seed, x + rx * off, z + rz * off), hl = mountain(seed, x - rx * off, z - rz * off);
      st.drop = hr < hl ? 1 : -1; st.dropK = Math.min(1, Math.abs(hl - hr) / 10);
      this.st.push(st); this.bucket(i);
      // (features, on a leg's straight stretches)
      this.sinceKicker++;
      if (!this.plan.length && !pin && this.pinLeft === 0 && i > 140 && this.sincePin > 60 && this.dir * x < this.legEnd - 130 && Math.abs(this.kinkTo - this.kink) < 0.01) {
        if (this.sinceKicker > 200 && r() < 0.08) { this.plan.push({ kind: 'ramp', at: i }); this.sinceKicker = 0; const b = this.st[i - 12]; if (b && b.feature === 'none') b.flag = -st.drop || 1; }
        else if (r() < 0.004) this.plan.push({ kind: 'whoop', at: i });
      }
      const f = this.plan[0];
      if (f) {
        const k = i - f.at;
        if (f.kind === 'ramp') {
          // (a kicker: 14 m of ramp rising 2.4 m, a 15 m gap, a 36 m deck falling back to the line)
          st.width = Math.max(st.width, 7); st.lift = 0;
          if (k <= 14) { st.feature = 'ramp'; st.lift = 2.4 * Math.pow(k / 14, 1.6); }
          else if (k < 30) st.feature = 'gap';
          else if (k < 66) { st.feature = 'deck'; st.lift = 1.8 * (1 - (k - 30) / 36); }
          else this.plan.shift();
        } else if (f.kind === 'whoop') {
          if (k < 48) { st.feature = 'whoop'; st.lift = 0.45 * (0.5 - 0.5 * Math.cos((k / 12) * Math.PI * 2)); } else this.plan.shift();
        }
      }
      // (the fence: posts at uneven spacing along the drop side, each leaning its own way)
      if (i >= this.nextPost) { this.nextPost = i + 4 + Math.floor(r() * 5); st.post = st.dropK > 0.3 && (st.feature === 'none' || st.feature === 'whoop'); st.lean = (r() - 0.5) * 0.4; }
    }
  }
  at(s: number): Station { this.ensure(s + 4); return this.st[Math.max(0, Math.min(this.st.length - 1, Math.round(s)))]; }
  /** where (s, u) is in the world, and the road's height there */
  point(s: number, u: number) {
    this.ensure(s + 4);
    const i = Math.max(0, Math.min(this.st.length - 2, Math.floor(s))), f = Math.min(1, Math.max(0, s - i)), a = this.st[i], b = this.st[i + 1];
    const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f, h = a.heading + (b.heading - a.heading) * f;
    const rx = -Math.cos(h), rz = Math.sin(h);
    // (a gap has no road; the station before it holds its height to its edge)
    const gap = a.feature === 'gap', bl = b.feature === 'gap' ? a.lift : b.lift;
    const lift = a.lift + (bl - a.lift) * f;
    const y = a.y + (b.y - a.y) * f + lift;
    return { x: x + rx * u, z: z + rz * u, y, heading: h, width: a.width + (b.width - a.width) * f, surface: !gap, lift, feature: a.feature, drop: a.drop };
  }
  /** the line's distance and offset nearest a world point, searched round a guess */
  locate(x: number, z: number, guess: number): { s: number; u: number } {
    let best = guess, bd = Infinity;
    const lo = Math.max(0, Math.floor(guess) - 6), hi = Math.floor(guess) + 14;
    this.ensure(hi + 2);
    for (let i = lo; i <= hi; i++) { const p = this.st[i], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i; } }
    const p = this.st[best], q = this.st[best + 1], dx = q.x - p.x, dz = q.z - p.z, L2 = dx * dx + dz * dz || 1;
    let t = ((x - p.x) * dx + (z - p.z) * dz) / L2;
    if (t < 0 && best > 0) { const o = this.st[best - 1], ex = p.x - o.x, ez = p.z - o.z; t = ((x - o.x) * ex + (z - o.z) * ez) / (ex * ex + ez * ez || 1) - 1; }
    const s = best + Math.max(-1, Math.min(1, t)), c = this.point(s, 0), rx = -Math.cos(c.heading), rz = Math.sin(c.heading);
    return { s, u: (x - c.x) * rx + (z - c.z) * rz };
  }
  /** the road's shoulder beyond its edge (the bench is the road and this either side) */
  static SHOULDER = 2.4;
  /** the carved ground at (x, z): the mountain with every nearby stretch of the route cut into it (only the stations
   * laid so far: lay the course well ahead of where you ask) */
  ground(x: number, z: number) {
    const h = mountain(this.seed, x, z);
    let cut = Infinity, fill = -Infinity, bench = Infinity, benchY = 0;
    const bi = Math.floor(x / 26), bj = Math.floor(z / 26);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const b = this.buckets.get(this.key(bi + di, bj + dj)); if (!b) continue;
      for (const i of b) {
        const st = this.st[i], d = Math.hypot(st.x - x, st.z - z), band = st.width / 2 + Course.SHOULDER;
        const ry = st.feature === 'gap' ? st.y - 14 : st.y;
        if (d < band) { if (d < bench) { bench = d; benchY = ry - 0.04; } continue; }
        const e = d - band;
        cut = Math.min(cut, ry + e * 2.3); fill = Math.max(fill, ry - e * 1.7);
      }
    }
    if (bench < Infinity) return benchY;
    return Math.max(Math.min(h, cut), fill);
  }
  /** the nearest station to (x, z) and how far it is (from the line), within the buckets about it */
  nearest(x: number, z: number) {
    let best = Infinity, at = -1;
    const bi = Math.floor(x / 26), bj = Math.floor(z / 26);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const b = this.buckets.get(this.key(bi + di, bj + dj)); if (!b) continue;
      for (const i of b) { const st = this.st[i], d = Math.hypot(st.x - x, st.z - z); if (d < best) { best = d; at = i; } }
    }
    return { d: best, i: at };
  }
  /** how far (x, z) is outside the road's edge (negative: on the road), by the nearest station */
  offRoad(x: number, z: number) {
    let best = Infinity;
    const bi = Math.floor(x / 26), bj = Math.floor(z / 26);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const b = this.buckets.get(this.key(bi + di, bj + dj)); if (!b) continue;
      for (const i of b) { const st = this.st[i]; best = Math.min(best, Math.hypot(st.x - x, st.z - z) - st.width / 2); }
    }
    return best;
  }
}

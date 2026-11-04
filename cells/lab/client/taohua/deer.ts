/**
 * Taohua: the deer, drawn and moving. Sika deer, as the prints have them: a warm russet coat spotted
 * white along the back, a pale belly and a white rump, slender legs, the stag's antlers branched;
 * drawn in the print's flat inks and lined in ink like everything else. Each is made of parts, each
 * turned about its own joint (the body; the neck and the head; each leg), as the walker is.
 *
 * Where they stand (herds.ts), they graze (or drink), now and then lifting their heads to look about.
 * As the walker comes near they lift their heads and watch; nearer still, they bound away, up the
 * hill and off from the ways, and stop a good way off to look back; left alone, they graze again.
 * They never come close.
 */
import { mulM, type M4 } from './render';
import { INK, M, Mesh, ground } from './world';
import type { DeerAt, DeerKind } from './herds';
import type { V3, Ways } from './ways';

type C3 = [number, number, number];
const hex = (h: number): C3 => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const COAT = hex(0xa86a3f), PALE = hex(0xefe5d2), BONE = hex(0xd8c8a6);

/** the joints, in a deer's own frame (forward +z, up +y, its feet at 0): neck, head, shoulders, hips */
export const NECK: V3 = [0, 0.86, 0.36], HEADJ: V3 = [0, 1.16, 0.52];
const LEGS: Array<{ at: V3; knee: V3; foot: V3 }> = [
  { at: [0.09, 0.72, 0.3], knee: [0.09, 0.4, 0.32], foot: [0.09, 0.03, 0.31] },
  { at: [-0.09, 0.72, 0.3], knee: [-0.09, 0.4, 0.32], foot: [-0.09, 0.03, 0.31] },
  { at: [0.09, 0.74, -0.34], knee: [0.09, 0.38, -0.44], foot: [0.09, 0.03, -0.37] },
  { at: [-0.09, 0.74, -0.34], knee: [-0.09, 0.38, -0.44], foot: [-0.09, 0.03, -0.37] },
];
const SCALE: Record<DeerKind, number> = { stag: 1, doe: 0.88, fawn: 0.56 };

export interface DeerParts { body: Mesh; neck: Mesh; head: Mesh; legs: Mesh[]; shadow: Mesh }
/** A deer's parts, of its kind. */
export function deerParts(kind: DeerKind): DeerParts {
  const k = SCALE[kind], S = (p: V3): V3 => [p[0] * k, p[1] * k, p[2] * k];
  const tube = (m: Mesh, a: V3, b: V3, ra: number, rb: number, c: C3, sides = 8) => m.tube(S(a), S(b), ra * k, rb * k, c, M.deer, sides);
  const body = new Mesh();
  // (the trunk: deep at the chest, slimmer at the loins; under it the pale belly; behind, the white rump and a short tail)
  tube(body, [0, 0.8, -0.44], [0, 0.82, 0.02], 0.15, 0.17, COAT, 10);
  tube(body, [0, 0.82, 0.02], [0, 0.8, 0.42], 0.17, 0.16, COAT, 10);
  tube(body, [0, 0.72, -0.3], [0, 0.73, 0.3], 0.14, 0.15, PALE, 8);
  tube(body, [0, 0.8, -0.47], [0, 0.8, -0.43], 0.135, 0.15, PALE, 10);
  tube(body, [0, 0.87, -0.48], [0, 0.76, -0.56], 0.035, 0.02, PALE, 5);
  // (its spots: small pale flecks along the back and down the flanks, in rows)
  for (let i = 0; i < 7; i++) for (const sd of [-1, 1]) for (const row of [0, 1]) {
    const z = -0.34 + i * 0.11 + row * 0.05, a = 0.45 + row * 0.42, r = 0.165;
    const p: V3 = [sd * Math.sin(a) * r, 0.81 + Math.cos(a) * r, z];
    tube(body, p, [p[0] * 1.06, 0.81 + (p[1] - 0.81) * 1.06, z], 0.022, 0.018, PALE, 5);
  }
  const neck = new Mesh();
  tube(neck, [0, 0.84, 0.34], [0, 1.17, 0.53], 0.095, 0.07, COAT, 8);
  const head = new Mesh();
  // (the head: long, tapering to the muzzle; a dark nose; the ears out to either side; a stag's antlers)
  tube(head, [0, 1.19, 0.5], [0, 1.1, 0.77], 0.07, 0.035, COAT, 8);
  tube(head, [0, 1.1, 0.76], [0, 1.09, 0.79], 0.03, 0.022, INK.dark, 5);
  for (const sd of [-1, 1]) {
    tube(head, [sd * 0.04, 1.23, 0.53], [sd * 0.15, 1.29, 0.5], 0.03, 0.012, COAT, 5);
    if (kind === 'stag') {
      tube(head, [sd * 0.035, 1.25, 0.54], [sd * 0.11, 1.42, 0.5], 0.02, 0.016, BONE, 5);
      tube(head, [sd * 0.11, 1.42, 0.5], [sd * 0.15, 1.6, 0.42], 0.016, 0.01, BONE, 5);
      tube(head, [sd * 0.06, 1.3, 0.53], [sd * 0.07, 1.36, 0.64], 0.012, 0.006, BONE, 4);
      tube(head, [sd * 0.11, 1.42, 0.5], [sd * 0.13, 1.52, 0.6], 0.012, 0.006, BONE, 4);
      tube(head, [sd * 0.15, 1.6, 0.42], [sd * 0.21, 1.66, 0.4], 0.01, 0.005, BONE, 4);
    }
  }
  const legs = LEGS.map((l) => {
    const m = new Mesh();
    tube(m, l.at, l.knee, 0.055, 0.032, COAT, 6);
    tube(m, l.knee, l.foot, 0.03, 0.022, COAT, 6);
    tube(m, l.foot, [l.foot[0], 0.0, l.foot[2] + 0.02], 0.026, 0.024, INK.dark, 5);
    return m;
  });
  // (its shadow, a stroke of grey on the ground, off to the side away from the light)
  const shadow = new Mesh();
  for (let i = 0; i < 14; i++) {
    const a0 = (i / 14) * Math.PI * 2, a1 = ((i + 1) / 14) * Math.PI * 2, cx = -0.35 * k, rx = 0.32 * k, rz = 0.62 * k;
    shadow.v.push(cx, 0.03, 0, 0, 1, 0, 0, 0, 0.3, M.shade);
    shadow.v.push(cx + Math.cos(a1) * rx, 0.03, Math.sin(a1) * rz, 0, 1, 0, Math.cos(a1), Math.sin(a1), 0.3, M.shade);
    shadow.v.push(cx + Math.cos(a0) * rx, 0.03, Math.sin(a0) * rz, 0, 1, 0, Math.cos(a0), Math.sin(a0), 0.3, M.shade);
  }
  return { body, neck, head, legs, shadow };
}

// ─── matrices ────────────────────────────────────────────────────────────────────────────────────
const Tm = (x: number, y: number, z: number): M4 => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
const Rx = (a: number): M4 => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
const Ry = (a: number): M4 => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
const about = (p: V3, r: M4): M4 => mulM(Tm(p[0], p[1], p[2]), mulM(r, Tm(-p[0], -p[1], -p[2])));
const lerpA = (a: number, b: number, t: number) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ─── one deer, living ────────────────────────────────────────────────────────────────────────────
type Mode = 'graze' | 'look' | 'alert' | 'flee' | 'watch';
/** how near the walker comes before a deer lifts its head to watch; before it bounds away */
const WATCH = 24, FLEE = 14;

export class Deer {
  x: number; z: number; yaw: number; readonly kind: DeerKind; readonly k: number;
  mode: Mode = 'graze';
  private t = 0; private next = 0; private seed: number;
  /** its head's lift (0 down, 1 up) and turn; its gait's phase; its speed */
  private lift = 0; private turn = 0; private phase = 0; private speed = 0;
  private fleeDir: [number, number] = [0, 1]; private ran = 0;
  constructor(at: DeerAt, private drink: boolean, n: number) {
    this.x = at.x; this.z = at.z; this.yaw = at.yaw; this.kind = at.kind; this.k = SCALE[at.kind];
    this.seed = n * 7.31 + at.x * 0.13;
    this.next = 2 + (n % 5);
  }
  private rnd() { this.seed = (this.seed * 9301 + 49297) % 233280; return this.seed / 233280; }

  /** A step of its life: dt seconds, the walker at (wx, wz), herd-mates flee together. Returns whether it's begun to flee now. */
  step(dt: number, ways: Ways, wx: number, wz: number, scared: boolean): boolean {
    this.t += dt;
    const d = Math.hypot(wx - this.x, wz - this.z), toW = Math.atan2(wx - this.x, wz - this.z);
    let started = false;
    if (this.mode !== 'flee' && (d < FLEE || (scared && d < WATCH + 6))) {
      // (away from the walker, and up the hill, and off from the ways)
      let dx = this.x - wx, dz = this.z - wz;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      dz += 0.8;
      const nr = ways.nearest(this.x, this.z);
      if (nr.d < 10) { const ax = this.x - nr.p[0], az = this.z - nr.p[2], al = Math.hypot(ax, az) || 1; dx += (ax / al) * 0.6; dz += (az / al) * 0.6; }
      const m = Math.hypot(dx, dz) || 1;
      this.fleeDir = [dx / m, dz / m]; this.mode = 'flee'; this.ran = 0; started = true;
    }
    let want = 0, look = 0;
    switch (this.mode) {
      case 'graze':
        // (head down, nibbling; now and then up, to look about)
        want = 0;
        if (d < WATCH) this.mode = 'alert';
        else if (this.t > this.next) { this.mode = 'look'; this.t = 0; this.next = 1.5 + this.rnd() * 2.5; look = 0; }
        break;
      case 'look':
        want = 1; look = Math.sin(this.t * 0.9 + this.seed) * 0.9;
        if (d < WATCH) this.mode = 'alert';
        else if (this.t > this.next) { this.mode = 'graze'; this.t = 0; this.next = 4 + this.rnd() * 6; }
        break;
      case 'alert':
      case 'watch':
        // (head up, turned to watch the walker; the body turned a little toward them)
        want = 1; look = Math.max(-1.3, Math.min(1.3, lerpA(0, toW - this.yaw, 1)));
        if (this.mode === 'alert') this.yaw = lerpA(this.yaw, toW, dt * 0.4);
        // (having fled, it watches a while, looking back, before it settles)
        if (d > WATCH + 8 && (this.mode === 'alert' || this.t > 6 + (this.seed % 4))) { this.mode = 'graze'; this.t = 0; this.next = 5 + this.rnd() * 5; }
        break;
      case 'flee': {
        // (bounding: quick to start, turning onto its way; where water's ahead, it turns aside)
        want = 1; look = 0;
        this.speed = Math.min(6.5 * (this.kind === 'fawn' ? 0.9 : 1), this.speed + dt * 9);
        let [fx, fz] = this.fleeDir;
        for (const a of [0, 0.6, -0.6, 1.2, -1.2]) {
          const c = Math.cos(a), s = Math.sin(a), gx = fx * c + fz * s, gz = -fx * s + fz * c;
          if (ways.dryOf(this.x + gx * 2, this.z + gz * 2) > 0.4 && ways.nearest(this.x + gx * 2, this.z + gz * 2).d > 1.6) { fx = gx; fz = gz; break; }
        }
        this.yaw = lerpA(this.yaw, Math.atan2(fx, fz), Math.min(1, dt * 6));
        this.x += Math.sin(this.yaw) * this.speed * dt; this.z += Math.cos(this.yaw) * this.speed * dt;
        this.ran += this.speed * dt;
        // (a good way off, it stops, turns, and looks back)
        if (this.ran > 22 && d > 34) { this.mode = 'watch'; this.t = 0; }
        break;
      }
    }
    if (this.mode !== 'flee') this.speed = Math.max(0, this.speed - dt * 8);
    this.phase += dt * (this.mode === 'flee' ? 2.6 : 0) + (this.speed * dt) / (1.6 * this.k);
    this.lift += (want - this.lift) * Math.min(1, dt * (want > this.lift ? 4 : 1.6));
    this.turn += (look - this.turn) * Math.min(1, dt * 3);
    return started;
  }

  /** Its parts' matrices: body, neck, head, the four legs, its shadow. */
  pose(ways: Ways, time: number): { body: M4; neck: M4; head: M4; legs: M4[]; shadow: M4 } {
    const y = ground(ways, this.x, this.z), c = Math.cos(this.yaw), s = Math.sin(this.yaw), k = this.k;
    const root: M4 = new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, this.x, y, this.z, 1]);
    const bounding = this.mode === 'flee' ? smooth(0.5, 3, this.speed) : 0, ph = this.phase * Math.PI * 2;
    // (bounding, the body rises and pitches with each leap)
    const hop = bounding * Math.max(0, Math.sin(ph)) * 0.32 * k, pitch = bounding * Math.cos(ph) * 0.18;
    const S = (p: V3): V3 => [p[0] * k, p[1] * k, p[2] * k];
    const body = mulM(root, mulM(Tm(0, hop, 0), about(S([0, 0.8, 0]), Rx(-pitch))));
    // (the neck: down to graze (or drink), its head nibbling; up to look, turned to watch)
    const down = 1 - this.lift, nib = down * 0.08 * Math.sin(time * (this.drink ? 3 : 5) + this.seed) * (this.mode === 'graze' ? 1 : 0);
    const neck = mulM(body, about(S(NECK), mulM(Ry(this.turn * 0.75), Rx(down * (this.drink ? 1.75 : 1.9) - 0.12 * this.lift + bounding * 0.25))));
    const head = mulM(neck, about(S(HEADJ), mulM(Ry(this.turn * 0.35), Rx(-down * 0.55 + nib))));
    const legs = LEGS.map((l, i) => {
      const front = i < 2, side = i % 2 ? 1 : -1;
      // (bounding: the forelegs reach forward together, the hind ones push back; standing, a shifting of weight now and then)
      const swing = bounding * (front ? 0.75 : -0.7) * Math.sin(ph + (front ? 0 : Math.PI)) + (1 - bounding) * (this.speed > 0.2 ? 0.4 * Math.sin(ph + (front ? 0 : Math.PI) + side) : 0);
      return mulM(body, about(S(l.at), Rx(swing)));
    });
    const shadow: M4 = new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, this.x, y, this.z, 1]);
    return { body, neck, head, legs, shadow };
  }
}

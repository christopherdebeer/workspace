/**
 * A hand and the IMU it carries: pose in, BMI270 readings out.
 *
 * Device axes follow the firmware's reading of the AtomS3R (afterword.c): x to the right of the
 * screen, y up it, z out of it toward the reader. The accelerometer measures specific force, so
 * at rest it reads "up" in device axes (+9.81 on y when the screen faces you upright). Turning
 * the device clockwise as you look at it is +roll; tipping its top edge away is +pitch.
 *
 * The hand is a critically damped spring toward a target pose (a finger, a script, or a recorded
 * session), with optional physiological tremor, a walking gait, sensor noise and gyro bias.
 * Everything is deterministic given a seed, so a scripted session is the same session anywhere.
 */
export type V3 = [number, number, number];
export type Quat = [number, number, number, number]; // x, y, z, w

export const G = 9.80665;

export const qMul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qAxis = (axis: V3, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
export const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
/** v in device axes → world axes */
export const rotate = (q: Quat, v: V3): V3 => {
  const p = qMul(qMul(q, [v[0], v[1], v[2], 0]), qConj(q));
  return [p[0], p[1], p[2]];
};

/** Pose of the hand-held device: clockwise roll about the screen normal, then top-edge-away pitch. */
export function poseQuat(roll: number, pitch: number, yaw = 0): Quat {
  // world: x right, y up, z toward the viewer. Clockwise (as seen) is negative about +z;
  // top edge away is negative about +x (the top moves to -z).
  return qMul(qAxis([0, 1, 0], yaw), qMul(qAxis([1, 0, 0], -pitch), qAxis([0, 0, 1], -roll)));
}

/** Body-frame angular velocity carrying q0 to q1 over dt. */
export function bodyRate(q0: Quat, q1: Quat, dt: number): V3 {
  let d = qMul(qConj(q0), q1);
  if (d[3] < 0) d = [-d[0], -d[1], -d[2], -d[3]];
  const s = Math.hypot(d[0], d[1], d[2]);
  if (s < 1e-12) return [0, 0, 0];
  const angle = 2 * Math.atan2(s, d[3]);
  return [d[0] / s * angle / dt, d[1] / s * angle / dt, d[2] / s * angle / dt];
}

/** Gravity-derived roll and pitch, exactly as the firmware measures them (before neutral). */
export function anglesOf(a: ArrayLike<number>): { roll: number; pitch: number } {
  return { roll: -Math.atan2(a[0], a[1]), pitch: Math.atan2(a[2], Math.hypot(a[0], a[1])) };
}

export function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Realism {
  /** physiological tremor amplitude, degrees at 8–12 Hz (≈0.05 for a relaxed hand ≈ 2 °/s; 0.25+ is pathological) */
  tremor: number;
  /** walking: 0 still, 1 a steady walk (≈1.8 Hz gait, vertical bob and sway) */
  walk: number;
  /** sensor white noise scale, 1 ≈ BMI270 datasheet densities at 100 Hz */
  noise: number;
  /** constant gyro bias, rad/s per axis (uncalibrated parts drift ≈0.005) */
  bias: number;
}
export const STILL: Realism = { tremor: 0, walk: 0, noise: 0, bias: 0 };
export const NATURAL: Realism = { tremor: 0.05, walk: 0, noise: 1, bias: 0.004 };

export interface Reading { accel: V3; gyro: V3; q: Quat; roll: number; pitch: number }

export class Hand {
  roll = 0; pitch = 0; yaw = 0;
  private vr = 0; private vp = 0;
  targetRoll = 0; targetPitch = 0;
  /** spring stiffness, 1/s: how quickly the wrist follows intent (≈12–20 for a deliberate turn) */
  omega = 16;
  private q: Quat = [0, 0, 0, 1];
  private t = 0;
  private rnd: () => number;
  private gyroBias: V3;
  private phase: number[];
  private lastV: V3 = [0, 0, 0];

  constructor(public realism: Realism = NATURAL, seed = 1) {
    this.rnd = mulberry(seed);
    const b = () => (this.rnd() * 2 - 1);
    this.gyroBias = [b(), b(), b()];
    this.phase = Array.from({ length: 6 }, () => this.rnd() * Math.PI * 2);
  }

  private gauss(): number {
    const u = Math.max(1e-12, this.rnd()), v = this.rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Hold the device in a pose without dynamics (a recorded pose, or a reset). */
  place(roll: number, pitch: number) {
    this.roll = this.targetRoll = roll; this.pitch = this.targetPitch = pitch; this.vr = this.vp = 0;
    this.q = poseQuat(roll, pitch, this.yaw);
  }

  /** Advance dt seconds and read the sensors. */
  step(dt: number): Reading {
    const r = this.realism;
    this.t += dt;
    // critically damped follow of intent
    const k = this.omega * this.omega, c = 2 * this.omega;
    this.vr += (k * (this.targetRoll - this.roll) - c * this.vr) * dt; this.roll += this.vr * dt;
    this.vp += (k * (this.targetPitch - this.pitch) - c * this.vp) * dt; this.pitch += this.vp * dt;
    // tremor (8–12 Hz band, two incommensurate tones) and gait sway
    const deg = Math.PI / 180, t = this.t, ph = this.phase;
    const tremorR = r.tremor * deg * (Math.sin(2 * Math.PI * 9.3 * t + ph[0]) * 0.7 + Math.sin(2 * Math.PI * 11.1 * t + ph[1]) * 0.3);
    const tremorP = r.tremor * deg * (Math.sin(2 * Math.PI * 8.7 * t + ph[2]) * 0.7 + Math.sin(2 * Math.PI * 10.4 * t + ph[3]) * 0.3);
    const gait = 2 * Math.PI * 1.8 * t;
    const swayR = r.walk * 3 * deg * Math.sin(gait / 2 + ph[4]);
    const swayP = r.walk * 4 * deg * Math.sin(gait + ph[5]);
    const q1 = poseQuat(this.roll + tremorR + swayR, this.pitch + tremorP + swayP, this.yaw);
    const w = bodyRate(this.q, q1, dt);
    this.q = q1;
    // specific force: up, plus the hand's own acceleration (walking bob), in device axes
    const bob = r.walk * 2.2 * Math.cos(gait);                       // m/s², vertical
    const surge = r.walk * 0.8 * Math.cos(gait / 2 + 1);             // fore-aft
    const worldF: V3 = [0, G + bob, surge];
    const accel = rotate(qConj(q1), worldF);
    // noise: BMI270 ≈ 160 µg/√Hz accel, 0.008 °/s/√Hz gyro, at 100 Hz bandwidth
    const an = r.noise * 160e-6 * G * 10, gn = r.noise * 0.008 * deg * 10;
    const out: Reading = {
      accel: [accel[0] + an * this.gauss(), accel[1] + an * this.gauss(), accel[2] + an * this.gauss()],
      gyro: [w[0] + r.bias * this.gyroBias[0] + gn * this.gauss(), w[1] + r.bias * this.gyroBias[1] + gn * this.gauss(), w[2] + r.bias * this.gyroBias[2] + gn * this.gauss()],
      q: q1, roll: this.roll, pitch: this.pitch,
    };
    this.lastV = w;
    return out;
  }

  get angularVelocity(): V3 { return this.lastV; }
}

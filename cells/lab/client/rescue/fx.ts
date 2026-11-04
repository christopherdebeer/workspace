/**
 * The marks the race leaves on the water and in the air (drawn by render.ts as one batch of quads): foam in a big boat's
 * wake and at its bow, ripples round a tiny boat bobbing, a splash as someone jumps, sparkles as they land, droplets
 * when a boat runs into something; and, each frame afresh, the soft shadow under every boat and the ring round each
 * tiny boat near yours that shows how near is near enough.
 */
import { FSTRIDE, FX } from './render';

interface Mark { kind: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; size: number; grow: number; life: number; age: number; alpha: number; rot: number; stretch: number; r: number; g: number; b: number; seed: number; fall: number }

export class Marks {
  private list: Mark[] = [];
  data = new Float32Array(4096 * FSTRIDE);
  count = 0;
  private rnd = Math.random;

  add(m: Partial<Mark> & { kind: number; x: number; z: number }) {
    if (this.list.length > 2400) this.list.shift();
    this.list.push({ y: 0, vx: 0, vy: 0, vz: 0, size: 1, grow: 0, life: 1, age: 0, alpha: 1, rot: this.rnd() * 6.28, stretch: 1, r: 1, g: 1, b: 1, seed: this.rnd(), fall: 0, ...m });
  }
  clear() { this.list.length = 0; }

  /** foam off a moving boat: from both quarters of the stern spreading out, and a little at the bow when it's going */
  wake(x: number, z: number, h: number, v: number, dt: number, big = true) {
    const fast = Math.min(1, v / 9);
    if (fast < 0.08) return;
    const s = Math.sin(h), c = Math.cos(h), n = big ? 30 * dt * (0.4 + fast) : 10 * dt * fast;
    for (let k = 0; k < n + (this.rnd() < n % 1 ? 1 : 0); k++) {
      const side = this.rnd() < 0.5 ? -1 : 1, back = big ? -4.8 : -1.5, lat = (big ? 1.5 : 0.5) * side;
      const px = x + s * back + c * lat, pz = z + c * back - s * lat;
      this.add({ kind: FX.FOAM, x: px, z: pz, vx: c * side * (0.8 + fast) - s * 0.5, vz: -s * side * (0.8 + fast) - c * 0.5, size: big ? 0.7 : 0.35, grow: big ? 0.9 : 0.5, life: big ? 2.0 : 1.2, alpha: (big ? 0.42 : 0.35) * (0.5 + 0.5 * fast), stretch: 0.8 });
    }
    if (big && fast > 0.45 && this.rnd() < dt * 18) {
      const side = this.rnd() < 0.5 ? -1 : 1, px = x + s * 4.6 + c * 1.1 * side, pz = z + c * 4.6 - s * 1.1 * side;
      this.add({ kind: FX.FOAM, x: px, z: pz, vx: c * side * 2.2, vz: -s * side * 2.2, size: 0.5, grow: 1.2, life: 1.1, alpha: 0.65 * fast });
    }
  }
  /** a ring spreading out on the water */
  ring(x: number, z: number, size: number, grow: number, life: number, alpha: number, col: readonly number[] = [1, 1, 1]) {
    this.add({ kind: FX.RING, x, z, size, grow, life, alpha, r: col[0], g: col[1], b: col[2] });
  }
  /** droplets thrown up (a jump, a bump), falling back */
  splash(x: number, y: number, z: number, n: number, up = 3, col: readonly number[] = [0.92, 0.97, 1]) {
    for (let k = 0; k < n; k++) {
      const a = this.rnd() * 6.28, sp = 0.8 + this.rnd() * 1.8;
      this.add({ kind: FX.DROP, x, y, z, vx: Math.cos(a) * sp, vy: up * (0.6 + this.rnd() * 0.6), vz: Math.sin(a) * sp, size: 0.12 + this.rnd() * 0.1, life: 0.9, alpha: 0.95, fall: 9.8, r: col[0], g: col[1], b: col[2] });
    }
  }
  /** sparkles bursting up (someone landing aboard, a boat across the line) */
  sparkle(x: number, y: number, z: number, n: number, col: readonly number[], spread = 1.2, size = 0.32) {
    for (let k = 0; k < n; k++) {
      const a = this.rnd() * 6.28, sp = 0.6 + this.rnd() * spread;
      this.add({ kind: FX.SPARK, x, y, z, vx: Math.cos(a) * sp, vy: 1.6 + this.rnd() * 2.2, vz: Math.sin(a) * sp, size: size * (0.7 + this.rnd() * 0.6), grow: -size * 0.6, life: 0.9 + this.rnd() * 0.5, alpha: 1, fall: 2.5, r: col[0], g: col[1], b: col[2] });
    }
  }

  update(dt: number) {
    let k = 0;
    for (const m of this.list) {
      m.age += dt;
      if (m.age >= m.life) continue;
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
      m.vy -= m.fall * dt;
      const drag = Math.exp(-dt * (m.kind === FX.FOAM ? 1.2 : 0.4));
      m.vx *= drag; m.vz *= drag;
      m.size = Math.max(0.02, m.size + m.grow * dt);
      this.list[k++] = m;
    }
    this.list.length = k;
  }

  /** this frame's marks: those alive, and those given afresh (shadows, rings), packed for the drawing */
  pack(extra: (put: (kind: number, x: number, y: number, z: number, size: number, alpha: number, rot: number, stretch: number, col: readonly number[], seed: number) => void) => void) {
    let n = 0;
    const put = (kind: number, x: number, y: number, z: number, size: number, alpha: number, rot: number, stretch: number, col: readonly number[], seed: number) => {
      if ((n + 1) * FSTRIDE > this.data.length) return;
      const d = this.data, o = n++ * FSTRIDE;
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = size; d[o + 4] = kind; d[o + 5] = alpha; d[o + 6] = rot; d[o + 7] = stretch;
      d[o + 8] = col[0]; d[o + 9] = col[1]; d[o + 10] = col[2]; d[o + 11] = seed;
    };
    // (shadows first, under the foam)
    extra(put);
    for (const m of this.list) {
      const t = m.age / m.life, fade = m.kind === FX.SPARK || m.kind === FX.DROP ? 1 - t * t : (1 - t) * Math.min(1, m.age * 6);
      put(m.kind, m.x, m.y, m.z, m.size, m.alpha * fade, m.rot, m.stretch, [m.r, m.g, m.b], m.seed);
    }
    this.count = n;
  }
}

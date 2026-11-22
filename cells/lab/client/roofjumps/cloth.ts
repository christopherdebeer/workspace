/**
 * A skirt's cloth: a small ring of points, its top held at the waist, the rest let fall. Fab's solver (client/fab/cloth.ts:
 * XPBD, Macklin, Müller & Chentanez 2016, in its "small steps" form, one pass of the constraints a substep) cut down to what a
 * runner's skirt needs: no pattern, no sewing, no self-contact; a grid round the hips, nu points round by nv down (row 0 the
 * waist, held), each point its share of the cloth's mass; edges round and down that hardly stretch, diagonals that shear a
 * little, edges two apart that resist bending softly; gravity; air against each point's speed (so a fall bells it and a
 * landing throws the hem on); and the body, as capsules (the hips, each thigh and shin), pushed out to a thickness off them.
 * In metres and seconds, stepped only by the rig's fixed update, so it's the same however often it's drawn.
 */

type V3 = [number, number, number];
export interface Capsule { a: V3; b: V3; r: number }
export interface ClothSpec { nu: number; nv: number; drag: number; damp?: number; stretch?: number; shear?: number; bend?: number }

/** where a point of the ring sits at rest, in the waist's own frame: the waist's ring (a0 × c0) at the top, the hem's (a1 × c1)
 * at length L below */
export interface Ring { a0: number; c0: number; a1: number; c1: number; L: number }

const SUB = 4, G = 9.81;

export class Cloth {
  readonly nu: number; readonly nv: number;
  pos: Float64Array; private prev: Float64Array; private vel: Float64Array;
  private cons: { i: number; j: number; rest: number; alpha: number }[] = [];
  private spec: ClothSpec; private ring: Ring;
  constructor(spec: ClothSpec, ring: Ring, frame: Float32Array | number[]) {
    this.spec = spec; this.ring = ring; this.nu = spec.nu; this.nv = spec.nv;
    const n = this.nu * this.nv; this.pos = new Float64Array(n * 3); this.prev = new Float64Array(n * 3); this.vel = new Float64Array(n * 3);
    const rest = this.restLocal(), idx = (u: number, v: number) => ((u + this.nu) % this.nu) + v * this.nu;
    const d = (i: number, j: number) => Math.hypot(rest[i * 3] - rest[j * 3], rest[i * 3 + 1] - rest[j * 3 + 1], rest[i * 3 + 2] - rest[j * 3 + 2]);
    const add = (i: number, j: number, alpha: number) => this.cons.push({ i, j, rest: d(i, j), alpha });
    const st = spec.stretch ?? 1e-7, sh = spec.shear ?? 2e-5, bd = spec.bend ?? 1.5e-3;
    for (let v = 0; v < this.nv; v++) for (let u = 0; u < this.nu; u++) {
      add(idx(u, v), idx(u + 1, v), st);
      if (v + 1 < this.nv) { add(idx(u, v), idx(u, v + 1), st); add(idx(u, v), idx(u + 1, v + 1), sh); add(idx(u + 1, v), idx(u, v + 1), sh); }
      add(idx(u, v), idx(u + 2, v), bd);
      if (v + 2 < this.nv) add(idx(u, v), idx(u, v + 2), bd);
    }
    this.place(frame);
  }
  /** the rest shape in the waist's frame: a cone from the waist's ring to the hem's */
  private restLocal(): Float64Array {
    const { a0, c0, a1, c1, L } = this.ring, out = new Float64Array(this.nu * this.nv * 3);
    for (let v = 0; v < this.nv; v++) for (let u = 0; u < this.nu; u++) {
      const t = v / (this.nv - 1), th = (2 * Math.PI * u) / this.nu, a = a0 + (a1 - a0) * t, c = c0 + (c1 - c0) * t, i = (u + v * this.nu) * 3;
      out[i] = Math.sin(th) * a; out[i + 1] = -L * t; out[i + 2] = Math.cos(th) * c;
    }
    return out;
  }
  /** every point at rest, placed by the waist's frame (a first frame, a held pose) */
  place(m: Float32Array | number[]): void {
    const r = this.restLocal();
    for (let i = 0; i < r.length; i += 3) { const p = xf(m, r[i], r[i + 1], r[i + 2]); this.pos[i] = p[0]; this.pos[i + 1] = p[1]; this.pos[i + 2] = p[2]; }
    this.vel.fill(0);
  }
  /** the waist's points where the frame holds them */
  private held(m: Float32Array | number[]): Float64Array {
    const r = this.restLocal(), out = new Float64Array(this.nu * 3);
    for (let u = 0; u < this.nu; u++) { const p = xf(m, r[u * 3], 0, r[u * 3 + 2]); out.set(p, u * 3); }
    return out;
  }
  /**
   * One fixed step: the waist eased from where it was held (`m0`) to where it's held now (`m1`) over the substeps; gravity and
   * air on the rest; each constraint once a substep; the body's capsules kept off. `air` the air's speed where the body is
   * (its own motion against it: so a fall is wind up the skirt)
   */
  step(dt: number, m0: Float32Array | number[], m1: Float32Array | number[], body: Capsule[]): void {
    const h = dt / SUB, h0 = this.held(m0), h1 = this.held(m1), n = this.nu * this.nv, drag = this.spec.drag, p = this.pos, x = this.prev, v = this.vel;
    for (let s = 1; s <= SUB; s++) {
      const k = s / SUB, nr = this.normals();
      // (the body's own speed (the waist's middle): the air close round a body is carried with it, mostly)
      let bx = 0, by = 0, bz = 0; for (let u = 0; u < this.nu; u++) { const o = u * 3; bx += h1[o] - h0[o]; by += h1[o + 1] - h0[o + 1]; bz += h1[o + 2] - h0[o + 2]; }
      // (carried with it: three quarters of the way it runs (the body shelters the cloth from the air ahead), a third of the way
      // it falls (the air comes up under a skirt))
      const E = 0.75 / (this.nu * dt), Ey = 0.35 / (this.nu * dt); bx *= E; by *= Ey; bz *= E;
      for (let i = 0; i < n; i++) {
        const o = i * 3; x[o] = p[o]; x[o + 1] = p[o + 1]; x[o + 2] = p[o + 2];
        if (i < this.nu) { p[o] = h0[o] + (h1[o] - h0[o]) * k; p[o + 1] = h0[o + 1] + (h1[o + 1] - h0[o + 1]) * k; p[o + 2] = h0[o + 2] + (h1[o + 2] - h0[o + 2]) * k; continue; }
        // (gravity, and the air against its speed (the air close round the body carried with it, mostly): hard through the
        // cloth's face, little along it (Fab's drag is through the normal): running, the sides trail a little and the front
        // presses to the legs; falling (no weight in the body's own frame), even the little from below bells it up)
        v[o + 1] -= G * h;
        const rx = v[o] - bx, ry = v[o + 1] - by, rz = v[o + 2] - bz, vn = rx * nr[o] + ry * nr[o + 1] + rz * nr[o + 2], fn = 1 - Math.exp(-drag * h), ft = 1 - Math.exp(-drag * 0.18 * h);
        v[o] -= nr[o] * vn * fn + (rx - nr[o] * vn) * ft; v[o + 1] -= nr[o + 1] * vn * fn + (ry - nr[o + 1] * vn) * ft; v[o + 2] -= nr[o + 2] * vn * fn + (rz - nr[o + 2] * vn) * ft;
        // (and the cloth's own losses: its motion against the body's dies away, so a stride's fling settles before the next)
        const dm = Math.exp(-(this.spec.damp ?? 5) * h), Bx = bx / 0.75, By = by / 0.35, Bz = bz / 0.75;
        v[o] = Bx + (v[o] - Bx) * dm; v[o + 1] = By + (v[o + 1] - By) * dm; v[o + 2] = Bz + (v[o + 2] - Bz) * dm;
        p[o] += v[o] * h; p[o + 1] += v[o + 1] * h; p[o + 2] += v[o + 2] * h;
      }
      const ah = 1 / (h * h);
      for (const c of this.cons) {
        const wi = c.i < this.nu ? 0 : 1, wj = c.j < this.nu ? 0 : 1, W = wi + wj; if (!W) continue;
        const a = c.i * 3, b = c.j * 3, dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2], l = Math.hypot(dx, dy, dz); if (l < 1e-9) continue;
        const C = l - c.rest, dl = -C / (W + c.alpha * ah), gx = dx / l, gy = dy / l, gz = dz / l;
        p[a] -= wi * dl * gx; p[a + 1] -= wi * dl * gy; p[a + 2] -= wi * dl * gz; p[b] += wj * dl * gx; p[b + 1] += wj * dl * gy; p[b + 2] += wj * dl * gz;
      }
      for (let i = this.nu; i < n; i++) { const o = i * 3; for (const cap of body) push(p, o, cap); }
      for (let i = this.nu; i < n; i++) { const o = i * 3; v[o] = (p[o] - x[o]) / h; v[o + 1] = (p[o + 1] - x[o + 1]) / h; v[o + 2] = (p[o + 2] - x[o + 2]) / h; }
    }
  }
  /** each point's normal: across the grid round by down (the hem's row, from the row above it) */
  private normals(): Float64Array {
    const p = this.pos, out = new Float64Array(p.length), I = (u: number, v: number) => ((((u % this.nu) + this.nu) % this.nu) + v * this.nu) * 3;
    for (let v = 0; v < this.nv; v++) for (let u = 0; u < this.nu; u++) {
      const a = I(u + 1, v), b = I(u - 1, v), c = I(u, Math.max(0, v - 1)), d = I(u, Math.min(this.nv - 1, v + 1));
      const ux = p[a] - p[b], uy = p[a + 1] - p[b + 1], uz = p[a + 2] - p[b + 2], vx = p[d] - p[c], vy = p[d + 1] - p[c + 1], vz = p[d + 2] - p[c + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1, o = I(u, v);
      out[o] = nx / l; out[o + 1] = ny / l; out[o + 2] = nz / l;
    }
    return out;
  }
  /** settled where it is, without motion: as many still steps as it takes a held pose to hang (a copy: reading changes nothing) */
  settled(m: Float32Array | number[], body: Capsule[], steps = 90): Cloth {
    const c = Object.create(Cloth.prototype) as Cloth;
    Object.assign(c, this, { pos: new Float64Array(this.pos.length), prev: new Float64Array(this.pos.length), vel: new Float64Array(this.pos.length) });
    c.place(m); for (let i = 0; i < steps; i++) c.step(1 / 120, m, m, body);
    return c;
  }
  at(u: number, v: number): V3 { const i = (((u % this.nu) + this.nu) % this.nu + v * this.nu) * 3; return [this.pos[i], this.pos[i + 1], this.pos[i + 2]]; }
}

const xf = (m: Float32Array | number[], x: number, y: number, z: number): V3 => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
/** a point kept off a capsule, out to its radius */
function push(p: Float64Array, o: number, c: Capsule): void {
  const ax = c.b[0] - c.a[0], ay = c.b[1] - c.a[1], az = c.b[2] - c.a[2], l2 = ax * ax + ay * ay + az * az;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[o] - c.a[0]) * ax + (p[o + 1] - c.a[1]) * ay + (p[o + 2] - c.a[2]) * az) / l2)) : 0;
  const qx = c.a[0] + ax * t, qy = c.a[1] + ay * t, qz = c.a[2] + az * t, dx = p[o] - qx, dy = p[o + 1] - qy, dz = p[o + 2] - qz, d = Math.hypot(dx, dy, dz);
  if (d >= c.r || d < 1e-9) return;
  const g = c.r / d; p[o] = qx + dx * g; p[o + 1] = qy + dy * g; p[o + 2] = qz + dz * g;
}

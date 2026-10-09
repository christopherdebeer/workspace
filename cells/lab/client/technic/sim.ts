/**
 * Technic: the solver. The mechanism `pieces.ts` reads from the build (rigid bodies, the joints
 * between them, gears meshing, motors) moves here, in the plane of the board: gravity, the
 * floor and the walls, a finger pulling on something.
 *
 * Position-based (XPBD, Müller et al.), small steps: each substep the bodies move freely, then
 * every constraint is projected once, then velocities are read back from where things ended up.
 * Joints are points two bodies share. A gear mesh keeps two rims moving together (relative to
 * the line between their centres, so a gear carried round another still meshes). A motor
 * advances the angle it wants between rotor and body, with only so much torque: stalled, it
 * slips rather than winding up. Contacts push a circle out of the floor and hold it there by
 * friction, which is what makes a wheel roll.
 */
import { FLOOR, XMAX, XMIN, defaultPort, type Mech, type Port, type Rule } from './pieces';

/** gravity, in modules a second a second (a tabletop's worth, not the world's) */
export const G = 30;
export const SUBSTEPS = 12;
/** a motor's speed at 100%, in turns a second */
export const TURNS = 1.5;
/** the torque a motor can bring to bear before it slips */
export const TORQUE = 50;

interface J { a: number; b: number; rax: number; ray: number; rbx: number; rby: number }
interface Gr { a: number; b: number; ra: number; rb: number; lax: number; lay: number; lbx: number; lby: number; phi0: number; phi: number }
interface Mo { stator: number; rotor: number; target: number; omega: number; piece: number }
interface Ct { body: number; lx: number; ly: number; r: number; grip: number }
interface Bl { body: number; z: number; r: number; lx: number; ly: number }
interface Br { body: number; z: number; ax: number; ay: number; bx: number; by: number; r: number }
interface Ds { body: number; z: number; lx: number; ly: number; r: number }

const cross = (rx: number, ry: number, nx: number, ny: number) => rx * ny - ry * nx;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Sim {
  readonly n: number;
  x: Float64Array; y: Float64Array; a: Float64Array;
  vx: Float64Array; vy: Float64Array; w: Float64Array;
  private px: Float64Array; private py: Float64Array; private pa: Float64Array;
  invM: Float64Array; invI: Float64Array;
  /** a pivoted body's weight hangs from its pivot: its mass, and its centre of mass from there */
  private gm: Float64Array; private gx: Float64Array; private gy: Float64Array;
  joints: J[] = [];
  gears: Gr[] = [];
  motors: Mo[] = [];
  contacts: Ct[] = [];
  /** the balls, and what they meet in their layers */
  balls: Bl[] = [];
  bars: Br[] = [];
  discs: Ds[] = [];
  /** a finger on a body: the point it holds (in the body) and where it is now (in the world) */
  finger: { body: number; lx: number; ly: number; tx: number; ty: number } | null = null;
  time = 0;
  /** how hard the floor was last pushed on by each contact (for the sound of a landing) */
  landed = 0;

  constructor(public mech: Mech) {
    const n = (this.n = mech.bodies.length);
    this.x = new Float64Array(n); this.y = new Float64Array(n); this.a = new Float64Array(n);
    this.vx = new Float64Array(n); this.vy = new Float64Array(n); this.w = new Float64Array(n);
    this.px = new Float64Array(n); this.py = new Float64Array(n); this.pa = new Float64Array(n);
    this.invM = new Float64Array(n); this.invI = new Float64Array(n);
    this.gm = new Float64Array(n); this.gx = new Float64Array(n); this.gy = new Float64Array(n);
    mech.bodies.forEach((b, i) => {
      this.x[i] = b.cx; this.y[i] = b.cy;
      this.invM[i] = b.fixed ? 0 : 1 / b.m;
      this.invI[i] = b.fixed ? 0 : 1 / b.I;
    });
    // a body on one pivot turns about that point exactly (its place is the pivot, its inertia
    // taken there); on two, it's held fast. A pivot is the board, or a body already held at
    // that point (an axle in the board, say: whatever turns on it is pivoted there too).
    const fixedAt = (b: number, x: number, y: number) => b === 0 || (this.invM[b] === 0 && Math.abs(this.x[b] - x) < 1e-9 && Math.abs(this.y[b] - y) < 1e-9);
    for (let grew = true; grew; ) {
      grew = false;
      for (let b = 1; b < n; b++) {
        if (this.invM[b] === 0) continue;
        const pts: Array<[number, number]> = [];
        for (const j of mech.joints) {
          const o = j.a === b ? j.b : j.b === b ? j.a : -1;
          if (o < 0 || !fixedAt(o, j.x, j.y)) continue;
          if (!pts.some(([x, y]) => x === j.x && y === j.y)) pts.push([j.x, j.y]);
        }
        if (!pts.length) continue;
        const B = mech.bodies[b];
        if (pts.length === 1) {
          const [x, y] = pts[0];
          B.I += B.m * ((x - B.cx) ** 2 + (y - B.cy) ** 2);
          this.gm[b] = B.m; this.gx[b] = B.cx - x; this.gy[b] = B.cy - y;
          B.cx = x; B.cy = y;
          this.x[b] = x; this.y[b] = y;
          this.invM[b] = 0;
          this.invI[b] = 1 / B.I;
        } else {
          this.invM[b] = 0;
          this.invI[b] = 0;
        }
        grew = true;
      }
    }
    const local = (b: number, x: number, y: number): [number, number] => [x - mech.bodies[b].cx, y - mech.bodies[b].cy];
    for (const j of mech.joints) {
      if (j.a === 0 || j.b === 0) continue;
      if (fixedAt(j.a, j.x, j.y) && fixedAt(j.b, j.x, j.y)) continue;
      const [rax, ray] = local(j.a, j.x, j.y);
      const [rbx, rby] = local(j.b, j.x, j.y);
      this.joints.push({ a: j.a, b: j.b, rax, ray, rbx, rby });
    }
    for (const g of mech.gears) {
      const [lax, lay] = local(g.a, g.ax, g.ay);
      const [lbx, lby] = local(g.b, g.bx, g.by);
      const phi0 = Math.atan2(g.by - g.ay, g.bx - g.ax);
      this.gears.push({ a: g.a, b: g.b, ra: g.ra, rb: g.rb, lax, lay, lbx, lby, phi0, phi: phi0 });
    }
    for (const m of mech.motors) this.motors.push({ stator: m.stator, rotor: m.rotor, target: 0, omega: 0, piece: m.piece });
    for (const c of mech.contacts) {
      const [lx, ly] = local(c.body, c.x, c.y);
      this.contacts.push({ body: c.body, lx, ly, r: c.r, grip: c.grip });
    }
    for (const b of mech.balls) this.balls.push({ body: b.body, z: b.z, r: b.r, lx: 0, ly: 0 });
    for (const b of mech.bars) {
      const [ax, ay] = local(b.body, b.ax, b.ay);
      const [bx, by] = local(b.body, b.bx, b.by);
      this.bars.push({ body: b.body, z: b.z, ax, ay, bx, by, r: b.r });
    }
    for (const d of mech.discs) {
      const [lx, ly] = local(d.body, d.x, d.y);
      this.discs.push({ body: d.body, z: d.z, lx, ly, r: d.r });
    }
  }

  /** A point of a body (given at rest, in the world) as it is now. */
  point(b: number, rx: number, ry: number): [number, number] {
    const B = this.mech.bodies[b];
    const lx = rx - B.cx;
    const ly = ry - B.cy;
    const c = Math.cos(this.a[b]);
    const s = Math.sin(this.a[b]);
    return [this.x[b] + c * lx - s * ly, this.y[b] + s * lx + c * ly];
  }
  /** Where a piece is now: its origin, and its turn. */
  pose(id: number, rx: number, ry: number): [number, number, number] {
    const b = this.mech.bodyOf[id];
    if (b < 0) return [rx, ry, 0];
    const [x, y] = this.point(b, rx, ry);
    return [x, y, this.a[b]];
  }
  /** The body of a piece. */
  bodyOf(id: number): number {
    return this.mech.bodyOf[id];
  }
  /** The fastest anything is moving (to know when it has come to rest). */
  motion(): number {
    let m = 0;
    for (let i = 0; i < this.n; i++) m = Math.max(m, Math.hypot(this.vx[i], this.vy[i]), Math.abs(this.w[i]));
    return m;
  }

  step(dt: number) {
    const h = dt / SUBSTEPS;
    const { n, x, y, a, vx, vy, w, px, py, pa, invM, invI } = this;
    this.landed = 0;
    for (let s = 0; s < SUBSTEPS; s++) {
      for (let i = 0; i < n; i++) {
        if (!invM[i] && !invI[i]) continue;
        if (invM[i]) vy[i] -= G * h;
        else if (this.gm[i]) {
          // (hanging from its pivot: its weight turns it)
          const arm = Math.cos(a[i]) * this.gx[i] - Math.sin(a[i]) * this.gy[i];
          w[i] -= invI[i] * this.gm[i] * G * arm * h;
        }
        px[i] = x[i]; py[i] = y[i]; pa[i] = a[i];
        x[i] += vx[i] * h; y[i] += vy[i] * h; a[i] += w[i] * h;
      }
      for (const m of this.motors) this.motor(m, h);
      for (const j of this.joints) this.joint(j);
      for (const g of this.gears) this.gear(g);
      for (const c of this.contacts) this.contact(c);
      for (const b of this.balls) this.ball(b);
      if (this.finger) this.pull(h);
      for (let i = 0; i < n; i++) {
        if (!invM[i] && !invI[i]) continue;
        vx[i] = (x[i] - px[i]) / h;
        vy[i] = (y[i] - py[i]) / h;
        w[i] = (a[i] - pa[i]) / h;
        // (the air, and the joints' play: a little of everything goes each step)
        const d = Math.max(0, 1 - 0.5 * h);
        vx[i] *= d; vy[i] *= d; w[i] *= Math.max(0, 1 - 0.8 * h);
      }
    }
    this.time += dt;
  }

  private joint(j: J) {
    const { x, y, a, invM, invI } = this;
    const ca = Math.cos(a[j.a]), sa = Math.sin(a[j.a]);
    const cb = Math.cos(a[j.b]), sb = Math.sin(a[j.b]);
    const rax = ca * j.rax - sa * j.ray, ray = sa * j.rax + ca * j.ray;
    const rbx = cb * j.rbx - sb * j.rby, rby = sb * j.rbx + cb * j.rby;
    const dx = x[j.b] + rbx - (x[j.a] + rax);
    const dy = y[j.b] + rby - (y[j.a] + ray);
    const C = Math.hypot(dx, dy);
    if (C < 1e-9) return;
    const nx = dx / C, ny = dy / C;
    const ka = cross(rax, ray, nx, ny), kb = cross(rbx, rby, nx, ny);
    const wa = invM[j.a] + invI[j.a] * ka * ka;
    const wb = invM[j.b] + invI[j.b] * kb * kb;
    if (wa + wb === 0) return;
    const corr = C / (wa + wb);
    x[j.a] += invM[j.a] * corr * nx; y[j.a] += invM[j.a] * corr * ny; a[j.a] += invI[j.a] * ka * corr;
    x[j.b] -= invM[j.b] * corr * nx; y[j.b] -= invM[j.b] * corr * ny; a[j.b] -= invI[j.b] * kb * corr;
  }

  private gear(g: Gr) {
    const { x, y, a, invI } = this;
    const ca = Math.cos(a[g.a]), sa = Math.sin(a[g.a]);
    const cb = Math.cos(a[g.b]), sb = Math.sin(a[g.b]);
    const ax = x[g.a] + ca * g.lax - sa * g.lay, ay = y[g.a] + sa * g.lax + ca * g.lay;
    const bx = x[g.b] + cb * g.lbx - sb * g.lby, by = y[g.b] + sb * g.lbx + cb * g.lby;
    // the line between their centres, followed round without jumping
    const phi = Math.atan2(by - ay, bx - ax);
    g.phi += wrap(phi - g.phi);
    const C = a[g.a] * g.ra + a[g.b] * g.rb - (g.phi - g.phi0) * (g.ra + g.rb);
    const wa = invI[g.a] * g.ra * g.ra;
    const wb = invI[g.b] * g.rb * g.rb;
    if (wa + wb === 0) return;
    const corr = -C / (wa + wb);
    a[g.a] += invI[g.a] * g.ra * corr;
    a[g.b] += invI[g.b] * g.rb * corr;
  }

  private motor(m: Mo, h: number) {
    const { a, invI } = this;
    m.target += m.omega * h;
    const rel = a[m.rotor] - a[m.stator];
    const C = rel - m.target;
    const wa = invI[m.stator];
    const wb = invI[m.rotor];
    if (wa + wb === 0) return;
    let corr = -C / (wa + wb);
    const max = TORQUE * h * h;
    if (corr > max) corr = max;
    if (corr < -max) corr = -max;
    a[m.rotor] += invI[m.rotor] * corr;
    a[m.stator] -= invI[m.stator] * corr;
    // (stalled: it slips, and doesn't wind up a debt it would pay off all at once)
    const lag = a[m.rotor] - a[m.stator] - m.target;
    if (Math.abs(lag) > 0.2) m.target = a[m.rotor] - a[m.stator] - Math.sign(lag) * 0.2;
  }

  private contact(c: Ct) {
    const b = c.body;
    const { x, y, a, px, py, pa, invM, invI } = this;
    const co = Math.cos(a[b]), si = Math.sin(a[b]);
    const rx = co * c.lx - si * c.ly, ry = si * c.lx + co * c.ly;
    const cx = x[b] + rx, cy = y[b] + ry;
    // the floor, and the walls
    const planes: Array<[number, number, number]> = [[0, 1, (FLOOR + c.r) - cy], [1, 0, (XMIN + c.r) - cx], [-1, 0, cx - (XMAX - c.r)]];
    for (const [nx, ny, pen] of planes) {
      if (pen <= 0) continue;
      const k = cross(rx, ry, nx, ny);
      const wn = invM[b] + invI[b] * k * k;
      const corr = pen / wn;
      x[b] += invM[b] * corr * nx; y[b] += invM[b] * corr * ny; a[b] += invI[b] * k * corr;
      if (ny > 0) this.landed = Math.max(this.landed, pen);
      // friction: the bit of the rim on the floor is held where it was at the start of the step,
      // as far as the grip allows (so a wheel rolls, and a beam lying there stays)
      const tx = -ny, ty = nx;
      const co2 = Math.cos(a[b]), si2 = Math.sin(a[b]);
      // where that bit of rim is now, and in the body
      const wx = x[b] + co2 * c.lx - si2 * c.ly - nx * c.r, wy = y[b] + si2 * c.lx + co2 * c.ly - ny * c.r;
      const ax = wx - x[b], ay = wy - y[b];
      const qx = co2 * ax + si2 * ay, qy = -si2 * ax + co2 * ay;
      // where it was
      const cop = Math.cos(pa[b]), sip = Math.sin(pa[b]);
      const ox = px[b] + cop * qx - sip * qy, oy = py[b] + sip * qx + cop * qy;
      const slide = (wx - ox) * tx + (wy - oy) * ty;
      const kt = cross(ax, ay, tx, ty);
      const wt = invM[b] + invI[b] * kt * kt;
      let ct = -slide / wt;
      const lim = c.grip * corr;
      if (ct > lim) ct = lim;
      if (ct < -lim) ct = -lim;
      x[b] += invM[b] * ct * tx; y[b] += invM[b] * ct * ty; a[b] += invI[b] * kt * ct;
    }
  }

  /** A ball against the bars and discs in its layer, and the other balls there. */
  private ball(b: Bl) {
    const { x, y, a } = this;
    const cx = x[b.body], cy = y[b.body];
    for (const bar of this.bars) {
      if (bar.z !== b.z || bar.body === b.body) continue;
      const co = Math.cos(a[bar.body]), si = Math.sin(a[bar.body]);
      const ax = x[bar.body] + co * bar.ax - si * bar.ay, ay = y[bar.body] + si * bar.ax + co * bar.ay;
      const bx = x[bar.body] + co * bar.bx - si * bar.by, by = y[bar.body] + si * bar.bx + co * bar.by;
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / l2));
      const qx = ax + dx * t, qy = ay + dy * t;
      this.pair(b.body, bar.body, cx, cy, qx, qy, b.r + bar.r, 0.7);
    }
    for (const d of this.discs) {
      if (d.z !== b.z || d.body === b.body) continue;
      const co = Math.cos(a[d.body]), si = Math.sin(a[d.body]);
      const qx = x[d.body] + co * d.lx - si * d.ly, qy = y[d.body] + si * d.lx + co * d.ly;
      this.pair(b.body, d.body, cx, cy, qx, qy, b.r + d.r, 0.7);
    }
    for (const o of this.balls) {
      if (o === b || o.z !== b.z || o.body <= b.body) continue;
      this.pair(b.body, o.body, cx, cy, x[o.body], y[o.body], b.r + o.r, 0.4);
    }
  }
  /**
   * Two round things pushed apart: body A's point (its centre, for a ball) and the nearest point
   * of body B, to be `gap` apart; then friction between them, as far as the grip allows.
   */
  private pair(A: number, B: number, ax: number, ay: number, qx: number, qy: number, gap: number, grip: number) {
    const { x, y, a, px, py, pa, invM, invI } = this;
    const dx = ax - qx, dy = ay - qy;
    const d = Math.hypot(dx, dy);
    const pen = gap - d;
    if (pen <= 0 || d < 1e-9) return;
    const nx = dx / d, ny = dy / d;
    // the arms: from each body's place to the point of contact
    const rax = ax - nx * (gap - pen) * 0.5 - x[A], ray = ay - ny * (gap - pen) * 0.5 - y[A];
    const rbx = qx + nx * pen * 0.5 - x[B], rby = qy + ny * pen * 0.5 - y[B];
    const ka = cross(rax, ray, nx, ny), kb = cross(rbx, rby, nx, ny);
    const wa = invM[A] + invI[A] * ka * ka;
    const wb = invM[B] + invI[B] * kb * kb;
    if (wa + wb === 0) return;
    const corr = pen / (wa + wb);
    x[A] += invM[A] * corr * nx; y[A] += invM[A] * corr * ny; a[A] += invI[A] * ka * corr;
    x[B] -= invM[B] * corr * nx; y[B] -= invM[B] * corr * ny; a[B] -= invI[B] * kb * corr;
    // friction: how the two surfaces slid past each other this step, undone as far as the grip allows
    const tx = -ny, ty = nx;
    const moved = (b: number, rx: number, ry: number): [number, number] => {
      // (where the bit of body now at arm (rx, ry) was at the start of the step)
      const co = Math.cos(a[b]), si = Math.sin(a[b]);
      const lx = co * rx + si * ry, ly = -si * rx + co * ry;
      const cp = Math.cos(pa[b]), sp = Math.sin(pa[b]);
      return [x[b] + rx - (px[b] + cp * lx - sp * ly), y[b] + ry - (py[b] + sp * lx + cp * ly)];
    };
    const [max, may] = invM[A] || invI[A] ? moved(A, rax, ray) : [0, 0];
    const [mbx, mby] = invM[B] || invI[B] ? moved(B, rbx, rby) : [0, 0];
    const slide = (max - mbx) * tx + (may - mby) * ty;
    const kta = cross(rax, ray, tx, ty), ktb = cross(rbx, rby, tx, ty);
    const wt = invM[A] + invI[A] * kta * kta + invM[B] + invI[B] * ktb * ktb;
    if (wt === 0) return;
    let ct = -slide / wt;
    const lim = grip * corr;
    if (ct > lim) ct = lim;
    if (ct < -lim) ct = -lim;
    x[A] += invM[A] * ct * tx; y[A] += invM[A] * ct * ty; a[A] += invI[A] * kta * ct;
    x[B] -= invM[B] * ct * tx; y[B] -= invM[B] * ct * ty; a[B] -= invI[B] * ktb * ct;
  }

  private pull(h: number) {
    const f = this.finger!;
    const b = f.body;
    const { x, y, a, invM, invI } = this;
    if (!invM[b] && !invI[b]) return;
    const co = Math.cos(a[b]), si = Math.sin(a[b]);
    const rx = co * f.lx - si * f.ly, ry = si * f.lx + co * f.ly;
    const dx = f.tx - (x[b] + rx), dy = f.ty - (y[b] + ry);
    const C = Math.hypot(dx, dy);
    if (C < 1e-9) return;
    const nx = dx / C, ny = dy / C;
    const k = cross(rx, ry, nx, ny);
    const wb = invM[b] + invI[b] * k * k;
    // (a soft hold: it follows the finger, and can be fought by what it's attached to)
    const alpha = 0.004 / (h * h);
    const corr = C / (wb + alpha);
    x[b] += invM[b] * corr * nx; y[b] += invM[b] * corr * ny; a[b] += invI[b] * k * corr;
  }
}

/**
 * The hub: what each motor should do now, by its port's rule. Without a hub nothing is powered.
 * `walls` and `tilt` read the hub itself (where it is, which way up); with no hub there's no
 * reading, so no motor.
 */
export class Controller {
  private dir: number[] = [];
  private cool: number[] = [];
  /** the bodies the hub is part of, or jointed to (its machine), once known */
  private machine: Set<number> | null = null;
  /** the last readings, to show */
  tilt = 0;
  wall = 0;
  constructor(public ports: Port[]) {}
  port(i: number): Port {
    while (this.ports.length <= i) this.ports.push(defaultPort());
    return this.ports[i];
  }
  private machineOf(sim: Sim, hb: number): Set<number> {
    if (this.machine) return this.machine;
    const m = new Set<number>([hb]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const j of sim.joints) {
        if (m.has(j.a) !== m.has(j.b) && j.a !== 0 && j.b !== 0) { m.add(j.a); m.add(j.b); grew = true; }
      }
    }
    return (this.machine = m);
  }
  update(sim: Sim, dt: number) {
    const hub = sim.mech.hubs[0];
    const hb = hub === undefined ? -1 : sim.bodyOf(hub);
    if (hb >= 0) {
      this.tilt = (wrap(sim.a[hb]) * 180) / Math.PI;
      // (the distance to the nearer wall, from whatever part of its machine is nearest)
      const m = this.machineOf(sim, hb);
      let d = Math.min(sim.x[hb] - XMIN, XMAX - sim.x[hb]);
      for (const c of sim.contacts) {
        if (!m.has(c.body)) continue;
        const [cx] = sim.point(c.body, c.lx + sim.mech.bodies[c.body].cx, c.ly + sim.mech.bodies[c.body].cy);
        d = Math.min(d, cx - c.r - XMIN, XMAX - cx - c.r);
      }
      this.wall = d;
    }
    sim.motors.forEach((m, i) => {
      const p = this.port(i);
      if (this.dir[i] === undefined) { this.dir[i] = 1; this.cool[i] = 0; }
      this.cool[i] = Math.max(0, this.cool[i] - dt);
      const flip = () => { if (this.cool[i] <= 0) { this.dir[i] = -this.dir[i]; this.cool[i] = 1.5; } };
      const r: Rule = p.rule;
      if (hb < 0) { m.omega = 0; return; }
      if (r === 'fro') {
        // (back and forth: each half of its period one way)
        this.dir[i] = Math.floor(sim.time / Math.max(0.25, p.period)) % 2 ? -1 : 1;
      } else if (r === 'walls') {
        if (this.wall < 2.5) flip();
      } else if (r === 'tilt') {
        if (Math.abs(this.tilt) > 35) flip();
      } else this.dir[i] = 1;
      m.omega = (p.speed / 100) * TURNS * 2 * Math.PI * this.dir[i];
    });
  }
}

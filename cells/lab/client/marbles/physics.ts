/**
 * Marble Run: the solver. Rigid spheres with spin, in centimetres and seconds, rolling and
 * bouncing on the boards (`track.ts`): the floor, the walls, the pegs, the spinning crosses (a
 * moving surface: its speed counts in the bounce and the grip), and each other.
 *
 * Impulses, many small steps: each step a marble falls a little, then every contact it has is
 * resolved — a normal impulse with restitution (none when it's barely moving, so it rests), a
 * friction impulse against the grip's limit that also spins it (which is what makes it roll,
 * and what a spinning marble does when it lands), and the overlap pushed out. Rolling
 * resistance slows what rolls, and the board's roughness takes more the faster it goes.
 * Materials differ in density, bounce, grip and rolling resistance: the same slope, and glass,
 * steel, wood and rubber come down it differently.
 */
import { FIELD_SIZE, WALL_H, WIDTH, add, cross, dot, finish as finishOf, len, mul, norm, sub, type Board, type Section, type V3 } from './track';

export const G = 981;
/** the board's roughness: a loss that grows with the square of the speed */
export const ROUGH = 0.0034;

export interface Material {
  name: string;
  /** g/cm³ */
  density: number;
  /** restitution against the track */
  e: number;
  /** grip */
  mu: number;
  /** rolling resistance */
  crr: number;
  look: 'glass' | 'steel' | 'wood' | 'rubber';
  colour: V3;
}
export const MATERIALS: Material[] = [
  { name: 'glass', density: 2.5, e: 0.62, mu: 0.16, crr: 0.01, look: 'glass', colour: [0.35, 0.65, 0.95] },
  { name: 'steel', density: 7.8, e: 0.55, mu: 0.12, crr: 0.007, look: 'steel', colour: [0.75, 0.76, 0.78] },
  { name: 'wood', density: 0.7, e: 0.38, mu: 0.32, crr: 0.022, look: 'wood', colour: [0.72, 0.5, 0.28] },
  { name: 'rubber', density: 1.2, e: 0.78, mu: 0.65, crr: 0.045, look: 'rubber', colour: [0.2, 0.2, 0.22] },
];
/** the track's own restitution and grip (cardboard: dull, grippy), blended with the marble's */
const TRACK = { e: 0.32, mu: 0.45 };
/** the strips and pegs stuck on it: smoother (painted), so a marble slides down a slanted one rather than resting against it */
const STRIP = { e: 0.36, mu: 0.3 };

export interface Marble {
  name: string;
  mat: Material;
  r: number;
  m: number;
  I: number;
  p: V3;
  v: V3;
  /** spin */
  w: V3;
  /** its turn, as a quaternion (x, y, z, w) */
  q: [number, number, number, number];
  /** which section it's on */
  sec: number;
  /** how far along the run (cm), for the order */
  progress: number;
  contact: boolean;
  slowFor: number;
  /** the speed it came into its section with (a fall puts it back there, going that fast) */
  entryV: number;
  /** done: the time it crossed the line */
  finished: number;
  falls: number;
  /** how often it had to be nudged on */
  nudges: number;
  tint: V3;
}
export interface Impact { at: V3; j: number; mat: Material; other: Material | null }

export function marble(name: string, mat: Material, r: number, tint: V3): Marble {
  const m = (4 / 3) * Math.PI * r ** 3 * mat.density;
  return { name, mat, r, m, I: 0.4 * m * r * r, p: [0, 0, 0], v: [0, 0, 0], w: [0, 0, 0], q: [0, 0, 0, 1], sec: 0, progress: 0, contact: false, slowFor: 0, entryV: 0, finished: -1, falls: 0, nudges: 0, tint };
}

/** A contact: the normal (out of the surface, toward the marble's centre), how deep, the surface's own speed there. */
interface Contact { n: V3; depth: number; vs: V3; e: number; mu: number }

/** The marble against a board: its floor, its walls, its pegs, its spinners; how far along, if it's on it. */
function boardContacts(bd: Board, m: Marble, time: number, out: Contact[]): number | null {
  const f = bd.frame;
  const d = sub(m.p, f.p);
  const along = dot(d, f.t), up = dot(d, f.n), across = dot(d, f.b);
  const half = bd.width / 2;
  if (along < -m.r - 2 || along > bd.length + m.r + 2) return null;
  if (Math.abs(across) > half + m.r + 1 || up > (bd.sideH ?? WALL_H) + 6 || up < -m.r - 2) return null;
  const e = TRACK.e, mu = TRACK.mu;
  // the floor
  if (along >= -m.r && along <= bd.length + m.r && up < m.r && up > -m.r) out.push({ n: f.n, depth: m.r - up, vs: [0, 0, 0], e, mu });
  // the sides (a little above their top too: a marble can't ride over a wall it is barely higher than)
  if (up < (bd.sideH ?? WALL_H) + 1.5) {
    for (const s of [1, -1]) {
      const over = s * across - half + m.r;
      if (over > 0) out.push({ n: mul(f.b, -s), depth: over, vs: [0, 0, 0], e, mu });
    }
    if (bd.backWall && along < m.r) out.push({ n: f.t, depth: m.r - along, vs: [0, 0, 0], e, mu });
  }
  // the walls in it
  if (up < WALL_H) {
    for (const w of bd.walls) {
      const ax = w.a[0], ay = w.a[1], bx = w.b[0], by = w.b[1];
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((along - ax) * dx + (across - ay) * dy) / l2));
      const qx = ax + dx * t, qy = ay + dy * t;
      const ex = along - qx, ey = across - qy;
      const dd = Math.hypot(ex, ey);
      const over = m.r + w.thick - dd;
      if (over > 0 && dd > 1e-6) out.push({ n: norm(add(mul(f.t, ex / dd), mul(f.b, ey / dd))), depth: over, vs: [0, 0, 0], e: STRIP.e, mu: STRIP.mu });
    }
    for (const [pa, pc, pr] of bd.pegs) {
      const dx = along - pa, dz = across - pc;
      const dd = Math.hypot(dx, dz);
      const over = m.r + pr - dd;
      if (over > 0 && dd > 1e-6) out.push({ n: norm(add(mul(f.t, dx / dd), mul(f.b, dz / dd))), depth: over, vs: [0, 0, 0], e: STRIP.e + 0.1, mu: STRIP.mu });
    }
    for (const sp of bd.spinners) {
      const th0 = time * sp.rate * Math.PI * 2;
      const ax = add(add(f.p, mul(f.t, sp.at[0])), add(mul(f.b, sp.at[1]), mul(f.n, 1.2)));
      const omega = mul(f.n, sp.rate * Math.PI * 2);
      // the axle
      {
        const dx = along - sp.at[0], dz = across - sp.at[1];
        const dd = Math.hypot(dx, dz);
        const over = m.r + 0.8 - dd;
        if (over > 0 && dd > 1e-6) out.push({ n: norm(add(mul(f.t, dx / dd), mul(f.b, dz / dd))), depth: over, vs: [0, 0, 0], e, mu });
      }
      for (let k = 0; k < sp.arms; k++) {
        const th = th0 + (k * Math.PI * 2) / sp.arms;
        const bdir = add(mul(f.t, Math.cos(th)), mul(f.b, Math.sin(th)));
        const rel = sub(m.p, ax);
        const s = Math.max(0, Math.min(sp.half, dot(rel, bdir)));
        const q = add(ax, mul(bdir, s));
        const dq = sub(m.p, q);
        const dd = len(dq);
        const over = m.r + 0.7 - dd;
        if (over > 0 && dd > 1e-6) out.push({ n: mul(dq, 1 / dd), depth: over, vs: cross(omega, sub(q, ax)), e: 0.45, mu: 0.5 });
      }
    }
  }
  return along;
}

/** The run as the solver sees it: its sections, the line and the catch board at the end, how far along each begins. */
export class Course {
  starts: number[] = [];
  total = 0;
  fin: ReturnType<typeof finishOf>;
  constructor(public sections: Section[], public top: { p: V3; yaw: number; pitch: number }) {
    let d = 0;
    for (const s of sections) { this.starts.push(d); d += s.length; }
    this.total = d;
    this.fin = finishOf(sections.length ? sections[sections.length - 1].end : top);
  }
  /** Where a marble begins: in a row behind the gate of a section (or the top), lane by lane, at rest. */
  place(m: Marble, sec = 0, lane = 0, speed = 0) {
    const s = this.sections[sec];
    const f = s ? s.boards[0].frame : this.fin.board.frame;
    const n = FIELD_SIZE;
    const across = ((lane + 0.5) / n - 0.5) * (WIDTH - 4);
    m.p = add(add(add(f.p, mul(f.t, 3)), mul(f.b, across)), mul(f.n, m.r + 0.2));
    m.v = mul(f.t, speed);
    m.w = [0, 0, 0];
    m.q = [0, 0, 0, 1];
    m.sec = sec;
    m.entryV = speed;
    m.progress = this.starts[sec] ?? 0;
    m.finished = -1;
    m.slowFor = 0;
  }
}

/** A step of the race: every marble, every contact, in small steps. */
export function step(course: Course, marbles: Marble[], dt: number, time: number, impacts: Impact[] = []): void {
  let vmax = 0;
  for (const m of marbles) vmax = Math.max(vmax, len(m.v));
  const n = Math.max(6, Math.min(64, Math.ceil((vmax * dt) / 0.25)));
  const h = dt / n;
  const contacts: Contact[] = [];
  for (let s = 0; s < n; s++) {
    const t = time + s * h;
    for (const m of marbles) {
      m.v[1] -= G * h;
      m.p = add(m.p, mul(m.v, h));
      contacts.length = 0;
      let best: { along: number; sec: number } | null = null;
      for (let si = Math.max(0, m.sec - 1); si <= Math.min(course.sections.length - 1, m.sec + 1); si++) {
        const sec = course.sections[si];
        for (const bd of sec.boards) {
          const a = boardContacts(bd, m, t, contacts);
          if (a !== null && (!best || si >= m.sec)) best = { along: a, sec: si };
        }
      }
      // the finish: the funnel, the line across its throat, the channel beyond
      if (m.sec >= course.sections.length - 1) {
        const a = boardContacts(course.fin.board, m, t, contacts);
        if (a !== null) {
          m.progress = Math.max(m.progress, course.total + Math.max(0, a));
          if (a >= course.fin.throat && m.finished < 0) m.finished = t;
        }
      }
      if (best) {
        const prog = course.starts[best.sec] + Math.max(0, Math.min(course.sections[best.sec].length, best.along));
        m.progress = Math.max(m.progress, prog);
        if (best.sec > m.sec) { m.sec = best.sec; m.entryV = len(m.v); }
      }
      m.contact = contacts.length > 0;
      for (const c of contacts) resolve(m, c, h, impacts);
    }
    for (let i = 0; i < marbles.length; i++) for (let j = i + 1; j < marbles.length; j++) pair(marbles[i], marbles[j], impacts);
    // (a push between marbles can't put one into a wall or the floor: the board has the last word)
    for (const m of marbles) {
      contacts.length = 0;
      for (let si = Math.max(0, m.sec - 1); si <= Math.min(course.sections.length - 1, m.sec + 1); si++) for (const bd of course.sections[si].boards) boardContacts(bd, m, t, contacts);
      if (m.sec >= course.sections.length - 1) boardContacts(course.fin.board, m, t, contacts);
      for (const c of contacts) if (c.depth > 0) m.p = add(m.p, mul(c.n, c.depth));
    }
    for (const m of marbles) spin(m, h);
  }
  for (const m of marbles) {
    // fallen off: back to the start of its section
    const sec = course.sections[m.sec];
    const low = sec ? sec.end.p[1] - sec.boards[0].step : course.top.p[1];
    if (m.p[1] < low - 60) { m.falls++; course.place(m, m.sec, 0, Math.max(0, m.entryV * 0.7)); }
    // in the channel at the end, slow: settling (the pack's pushes would keep it shivering)
    // (a slow enough one only: one still rolling down the channel isn't held back)
    if (m.finished >= 0 && len(m.v) < 6) m.v = mul(m.v, 0.5);
    // stuck (resting against something, or wedged in the pack): a nudge sideways, toward the middle, and a little on
    if (m.finished < 0 && len(m.v) < 2 && m.contact) {
      m.slowFor += dt;
      if (m.slowFor > 1.5) {
        const f = sec?.boards[0].frame ?? course.fin.board.frame;
        const across = dot(sub(m.p, f.p), f.b);
        // (toward the middle; the other way the next time, in case that was into something)
        const side = (across > 0 ? -1 : 1) * (m.nudges % 2 ? -1 : 1);
        m.v = add(m.v, add(mul(f.b, side * 28), mul(f.t, 12)));
        m.slowFor = 0;
        m.nudges++;
      }
    } else m.slowFor = 0;
  }
}

/** One contact: a normal impulse with restitution, friction that spins it, the overlap pushed out. */
function resolve(m: Marble, c: Contact, h: number, impacts: Impact[]) {
  const rc = mul(c.n, -m.r);
  const vrel = sub(add(m.v, cross(m.w, rc)), c.vs);
  const vn = dot(vrel, c.n);
  const e = Math.sqrt(m.mat.e * c.e);
  const mu = Math.sqrt(m.mat.mu * c.mu);
  let jn = 0;
  if (vn < 0) {
    // (restitution only for a real knock; a resting marble just stops going in)
    const bounce = -vn > 25 ? e : 0;
    jn = -(1 + bounce) * vn * m.m;
    m.v = add(m.v, mul(c.n, jn / m.m));
    if (-vn > 40) impacts.push({ at: [...m.p] as V3, j: jn, mat: m.mat, other: null });
  }
  // friction: against the slide at the contact, within the grip; it spins the marble too
  const vrel2 = sub(add(m.v, cross(m.w, rc)), c.vs);
  const vt = sub(vrel2, mul(c.n, dot(vrel2, c.n)));
  const st = len(vt);
  if (st > 1e-6) {
    const meff = m.m / (1 + (m.m * m.r * m.r) / m.I);
    let jt = st * meff;
    const lim = mu * Math.max(jn, m.m * G * h);
    if (jt > lim) jt = lim;
    const J = mul(vt, -jt / st);
    m.v = add(m.v, mul(J, 1 / m.m));
    m.w = add(m.w, mul(cross(rc, J), 1 / m.I));
  }
  // rolling resistance, and the board's roughness
  const along = sub(m.v, mul(c.n, dot(m.v, c.n)));
  const sa = len(along);
  if (sa > 1e-6) {
    const drop = Math.min(sa, (m.mat.crr * G + ROUGH * sa * sa) * h);
    m.v = sub(m.v, mul(along, drop / sa));
  }
  if (c.depth > 0) m.p = add(m.p, mul(c.n, c.depth));
}

/** Two marbles meeting. */
function pair(a: Marble, b: Marble, impacts: Impact[]) {
  const d = sub(b.p, a.p);
  const dist = len(d);
  const over = a.r + b.r - dist;
  if (over <= 0 || dist < 1e-6) return;
  const n = mul(d, 1 / dist);
  const ra = mul(n, a.r), rb = mul(n, -b.r);
  const vrel = sub(add(b.v, cross(b.w, rb)), add(a.v, cross(a.w, ra)));
  const vn = dot(vrel, n);
  const meff = 1 / (1 / a.m + 1 / b.m);
  if (vn < 0) {
    const e = -vn > 25 ? Math.sqrt(a.mat.e * b.mat.e) : 0;
    const jn = -(1 + e) * vn * meff;
    a.v = sub(a.v, mul(n, jn / a.m));
    b.v = add(b.v, mul(n, jn / b.m));
    if (-vn > 30) impacts.push({ at: mul(add(a.p, b.p), 0.5), j: jn, mat: a.mat, other: b.mat });
    const vrel2 = sub(add(b.v, cross(b.w, rb)), add(a.v, cross(a.w, ra)));
    const vt = sub(vrel2, mul(n, dot(vrel2, n)));
    const st = len(vt);
    if (st > 1e-6) {
      const mt = 1 / (1 / a.m + 1 / b.m + (a.r * a.r) / a.I + (b.r * b.r) / b.I);
      const mu = Math.sqrt(a.mat.mu * b.mat.mu);
      const jt = Math.min(st * mt, mu * jn);
      const J = mul(vt, -jt / st);
      b.v = add(b.v, mul(J, 1 / b.m));
      a.v = sub(a.v, mul(J, 1 / a.m));
      b.w = add(b.w, mul(cross(rb, J), 1 / b.I));
      a.w = sub(a.w, mul(cross(ra, J), 1 / a.I));
    }
  }
  const push = over / (a.m + b.m);
  a.p = sub(a.p, mul(n, push * b.m));
  b.p = add(b.p, mul(n, push * a.m));
}

/** Its turn follows its spin. */
function spin(m: Marble, h: number) {
  const [wx, wy, wz] = m.w;
  const [x, y, z, w] = m.q;
  const dq = [0.5 * (wx * w + wy * z - wz * y), 0.5 * (wy * w + wz * x - wx * z), 0.5 * (wz * w + wx * y - wy * x), 0.5 * (-wx * x - wy * y - wz * z)];
  const q: [number, number, number, number] = [x + dq[0] * h, y + dq[1] * h, z + dq[2] * h, w + dq[3] * h];
  const l = Math.hypot(...q) || 1;
  m.q = [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** The race order: over the line first by time, then by how far along. */
export function order(marbles: Marble[]): Marble[] {
  return [...marbles].sort((a, b) => {
    if (a.finished >= 0 && b.finished >= 0) return a.finished - b.finished;
    if (a.finished >= 0) return -1;
    if (b.finished >= 0) return 1;
    return b.progress - a.progress;
  });
}

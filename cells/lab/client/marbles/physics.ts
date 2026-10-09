/**
 * Marble Run: the solver. Rigid spheres with spin, in centimetres and seconds, rolling and
 * bouncing on the track (`track.ts`): the channel met across its real cross-section, trays
 * with pegs and a spinning bar (a moving surface: its speed counts in the bounce and the
 * grip), cone bowls, and each other.
 *
 * Impulses, many small steps: each step a marble falls a little, then every contact it has is
 * resolved — a normal impulse with restitution (none when it's barely moving, so it rests), a
 * friction impulse against the grip's limit that also spins it (which is what makes it roll,
 * and what a spinning marble does when it lands), and the overlap pushed out. Rolling
 * resistance slows what rolls. Materials differ in density, bounce, grip and rolling
 * resistance: the same slope, and glass, steel, wood and rubber come down it differently.
 */
import { DS, OPEN, R, add, cross, dot, finish as finishOf, len, mul, norm, sub, type Bowl, type Frame, type Section, type Tray, type V3 } from './track';

export const G = 981;
/** the trough's roughness: a loss that grows with the square of the speed (a 15° slope settles near 2.5 m/s) */
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
/** the track's own restitution and grip, as the marble's are blended with */
const TRACK = { e: 0.5, mu: 0.4 };

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
  /** where it is along the run: section, channel in it, and a hint at the frame */
  sec: number;
  chan: number;
  hint: number;
  /** how far along the run (cm), for the order */
  progress: number;
  /** touching anything this step */
  contact: boolean;
  /** the speed it's been slow for */
  slowFor: number;
  /** the speed it came into its section with (a fall puts it back there, going that fast) */
  entryV: number;
  /** done: the time it arrived */
  finished: number;
  falls: number;
  /** its colour tint, for the look */
  tint: V3;
}
export interface Impact { at: V3; j: number; mat: Material; other: Material | null }

export function marble(name: string, mat: Material, r: number, tint: V3): Marble {
  const m = (4 / 3) * Math.PI * r ** 3 * mat.density;
  return { name, mat, r, m, I: 0.4 * m * r * r, p: [0, 0, 0], v: [0, 0, 0], w: [0, 0, 0], q: [0, 0, 0, 1], sec: 0, chan: 0, hint: 0, progress: 0, contact: false, slowFor: 0, entryV: 5, finished: -1, falls: 0, tint };
}

/** A contact: the normal (out of the surface, toward the marble's centre), how deep, the surface's own speed there. */
interface Contact { n: V3; depth: number; vs: V3; e: number; mu: number; other?: Marble; /** more rolling loss (riding a wall: a sphere in a curve can't roll clean) */ drag?: number }

/** The nearest place on a channel to a point (near a hint), and the frame there. */
function onChannel(frames: Frame[], p: V3, hint: number): { i: number; u: number; f: Frame; dperp: V3; along: number } | null {
  if (frames.length < 2) return null;
  let best = -1, bestD = Infinity, bestU = 0;
  // (near the hint, if there is one; else everywhere, coarsely, then close)
  const lo = hint < 0 ? 1 : Math.max(0, hint - 12), hi = hint < 0 ? 0 : Math.min(frames.length - 2, hint + 12);
  const look = (i: number) => {
    const a = frames[i].p, b = frames[i + 1].p;
    const ab = sub(b, a);
    const l2 = dot(ab, ab) || 1;
    const u = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
    const c = add(a, mul(ab, u));
    const d = len(sub(p, c));
    if (d < bestD) { bestD = d; best = i; bestU = u; }
  };
  for (let i = lo; i <= hi; i++) look(i);
  if (best < 0 || bestD > 3 * R) {
    // (far from the hint: look everywhere, coarsely, then close)
    for (let i = 0; i < frames.length - 1; i += 4) look(i);
    for (let i = Math.max(0, best - 4); i <= Math.min(frames.length - 2, best + 4); i++) look(i);
  }
  if (best < 0) return null;
  const a = frames[best], b = frames[best + 1];
  const f: Frame = { p: add(a.p, mul(sub(b.p, a.p), bestU)), t: norm(add(mul(a.t, 1 - bestU), mul(b.t, bestU))), n: norm(add(mul(a.n, 1 - bestU), mul(b.n, bestU))), b: [0, 0, 0] };
  f.b = norm(cross(f.t, f.n));
  const d = sub(p, f.p);
  const dperp = sub(d, mul(f.t, dot(d, f.t)));
  return { i: best, u: bestU, f, dperp, along: (best + bestU) * DS };
}

/** The marble against a channel: inside the trough, against its wall. */
function channelContact(ch: { frames: Frame[]; r: number; open: number; r1?: number }, m: Marble, hint: number): { c: Contact | null; near: ReturnType<typeof onChannel> } {
  const near = onChannel(ch.frames, m.p, hint);
  if (!near) return { c: null, near };
  // (a taper: the radius here)
  const rr = ch.r1 === undefined ? ch.r : ch.r + (ch.r1 - ch.r) * ((near.i + near.u) / (ch.frames.length - 1));
  const dist = len(near.dperp);
  if (dist < 1e-6) return { c: null, near };
  const dir = mul(near.dperp, 1 / dist);
  // (how far round from the bottom)
  const phi = Math.acos(Math.max(-1, Math.min(1, -dot(dir, near.f.n))));
  if (phi > ch.open) return { c: null, near };
  // (past the ends of the channel: no wall)
  if ((near.i === 0 && near.u === 0) || (near.i === ch.frames.length - 2 && near.u === 1)) {
    const d = sub(m.p, near.f.p);
    if (Math.abs(dot(d, near.f.t)) > m.r) return { c: null, near };
  }
  const depth = dist + m.r - rr;
  if (depth <= 0) return { c: null, near };
  // (only from the inside: well past the wall, it's out)
  if (dist - rr > m.r) return { c: null, near };
  return { c: { n: mul(dir, -1), depth, vs: [0, 0, 0], e: TRACK.e, mu: TRACK.mu, drag: 1 + 5 * (1 - Math.cos(phi)) }, near };
}

/** The marble against a tray: its floor, its walls (and the narrowing at the far end), its pegs, its spinner. */
function trayContacts(tr: Tray, m: Marble, time: number, out: Contact[]): number | null {
  const f = tr.frame;
  const floor = sub(f.p, mul(f.n, R));
  const d = sub(m.p, floor);
  const along = dot(d, f.t), up = dot(d, f.n), across = dot(d, f.b);
  if (along < -m.r || along > tr.length + m.r) return null;
  const half = tr.width / 2;
  if (Math.abs(across) > half + m.r) return null;
  if (up < m.r && up > -m.r) out.push({ n: f.n, depth: m.r - up, vs: [0, 0, 0], e: TRACK.e, mu: TRACK.mu });
  // the walls: straight, then narrowing to the exit's width
  const narrowFrom = tr.length - tr.funnelIn;
  const wallAt = along < narrowFrom ? half : half - (half - (R - 0.3)) * ((along - narrowFrom) / tr.funnelIn);
  // the back wall, but for where the channel comes in (the walls are dull: a wedge of lively
  // walls would throw a marble back the way it came)
  const WALL_E = 0.25;
  if (up > -m.r && up < 10 && along < m.r && Math.abs(across) > R - 0.3) out.push({ n: f.t, depth: m.r - along, vs: [0, 0, 0], e: WALL_E, mu: TRACK.mu });
  if (up > -m.r && up < 10) {
    for (const s of [1, -1]) {
      const over = s * across - wallAt + m.r;
      if (over > 0) {
        // (the narrowing wall leans in: its normal has a bit of along in it)
        const lean = along < narrowFrom ? 0 : (half - (R - 0.3)) / tr.funnelIn;
        const n = norm(add(mul(f.b, -s), mul(f.t, -lean)));
        out.push({ n, depth: over, vs: [0, 0, 0], e: WALL_E, mu: TRACK.mu });
      }
    }
  }
  for (const [pa, pc, pr] of tr.pegs) {
    const dx = along - pa, dz = across - pc;
    const dd = Math.hypot(dx, dz);
    const over = m.r + pr - dd;
    if (over > 0 && dd > 1e-6 && up < 10) out.push({ n: norm(add(mul(f.t, dx / dd), mul(f.b, dz / dd))), depth: over, vs: [0, 0, 0], e: TRACK.e + 0.1, mu: TRACK.mu });
  }
  if (tr.spinner) {
    const sp = tr.spinner;
    const th = time * sp.rate * Math.PI * 2;
    // the bar in the tray's plane, half-length each way from its axle; a segment, thick 0.9
    const ax = add(floor, add(mul(f.t, sp.at), mul(f.n, 1.2)));
    const bdir = add(mul(f.t, Math.cos(th)), mul(f.b, Math.sin(th)));
    const rel = sub(m.p, ax);
    const s = Math.max(-sp.half, Math.min(sp.half, dot(rel, bdir)));
    const q = add(ax, mul(bdir, s));
    const dq = sub(m.p, q);
    const dd = len(dq);
    const over = m.r + 0.9 - dd;
    if (over > 0 && dd > 1e-6) {
      // (the bar's own speed where it meets the marble)
      const omega = mul(f.n, sp.rate * Math.PI * 2);
      const vs = cross(omega, sub(q, ax));
      out.push({ n: mul(dq, 1 / dd), depth: over, vs, e: 0.55, mu: 0.5 });
    }
  }
  return along;
}

/** The marble against a bowl: the cone, the rim's wall; through the hole it's free. */
function bowlContacts(b: Bowl, m: Marble, out: Contact[]): boolean {
  const dx = m.p[0] - b.centre[0], dz = m.p[2] - b.centre[2], y = m.p[1] - b.centre[1];
  const rho = Math.hypot(dx, dz);
  if (y < -2 || y > b.height + 16 || rho > b.radius + m.r) return false;
  const k = b.radius / b.height;
  const sq = Math.sqrt(1 + k * k);
  if ((rho > b.hole || b.hole === 0) && y < b.height + m.r) {
    const d = (y * k - rho) / sq;
    if (d < m.r && d > -m.r && rho > 1e-6) out.push({ n: [(-dx / rho) / sq, k / sq, (-dz / rho) / sq], depth: m.r - d, vs: [0, 0, 0], e: TRACK.e, mu: TRACK.mu });
    else if (rho <= 1e-6 && y < m.r && b.hole === 0) out.push({ n: [0, 1, 0], depth: m.r - y, vs: [0, 0, 0], e: TRACK.e, mu: TRACK.mu });
  }
  // the rim's wall, above the cone's edge
  if (y > b.height - 0.5 && y < b.height + 14 && rho > b.radius - m.r && rho > 1e-6) out.push({ n: [-dx / rho, 0, -dz / rho], depth: rho + m.r - b.radius, vs: [0, 0, 0], e: TRACK.e, mu: TRACK.mu });
  return true;
}

/** The run as the solver sees it: its sections, the cup at the end, and how far along each begins. */
export class Course {
  starts: number[] = [];
  total = 0;
  fin: ReturnType<typeof finishOf>;
  constructor(public sections: Section[], public top: { p: V3; t: V3 }) {
    let d = 0;
    for (const s of sections) { this.starts.push(d); d += s.length; }
    this.total = d;
    const end = sections.length ? sections[sections.length - 1].end : { p: top.p, yaw: 0, pitch: 0, bank: 0, n: [0, 1, 0] as V3 };
    this.fin = finishOf(end);
  }
  /** Where a marble begins: at the top (or a section's start), a little above the floor, rolling gently. */
  place(m: Marble, sec = 0, lane = 0, speed = 5) {
    const s = this.sections[sec];
    const f = s ? s.channels[0].frames[0] : null;
    const p: V3 = f ? f.p : this.top.p;
    const t: V3 = f ? f.t : this.top.t;
    const b: V3 = f ? f.b : [1, 0, 0];
    m.p = add(add(add(p, mul(t, 2 + lane * 2.4)), mul(b, (lane % 2 ? 0.6 : -0.6) * (lane > 1 ? 1 : 0.5))), [0, -R + m.r + 0.3, 0]);
    m.v = mul(t, speed);
    m.entryV = speed;
    m.w = [0, 0, 0];
    m.q = [0, 0, 0, 1];
    m.sec = sec;
    m.chan = 0;
    m.hint = 0;
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
      if (m.finished >= 0 && len(m.v) < 1) continue;
      m.v[1] -= G * h;
      m.p = add(m.p, mul(m.v, h));
      // the track around it: its section, the one before and the one after
      contacts.length = 0;
      let best: { along: number; sec: number; chan: number; i: number } | null = null;
      for (let si = Math.max(0, m.sec - 1); si <= Math.min(course.sections.length - 1, m.sec + 1); si++) {
        const sec = course.sections[si];
        // (how far along the section each part begins: the first channel, then any tray or bowl, then the rest)
        const trayLen = sec.trays.reduce((a, tr) => a + tr.length, 0) + sec.bowls.reduce((a, b) => a + Math.PI * 2 * b.radius * 1.5, 0);
        let along = 0;
        sec.channels.forEach((ch, ci) => {
          if (ci === 1) along += trayLen;
          const { c, near } = channelContact(ch, m, si === m.sec && ci === m.chan ? m.hint : -1);
          if (c) contacts.push(c);
          if (near && len(near.dperp) < ch.r * 2.5) {
            const here = along + near.along;
            const better = !best || Math.abs(here + course.starts[si] - m.progress) < Math.abs(best.along + course.starts[best.sec] - m.progress);
            if (better) best = { along: here, sec: si, chan: ci, i: near.i };
          }
          along += (ch.frames.length - 1) * DS;
        });
        const first = sec.channels.length ? (sec.channels[0].frames.length - 1) * DS : 0;
        for (const tr of sec.trays) {
          const a = trayContacts(tr, m, t, contacts);
          if (a !== null) best = { along: first + a, sec: si, chan: -1, i: 0 };
        }
        for (const b of sec.bowls) if (bowlContacts(b, m, contacts)) best = best ?? { along: first, sec: si, chan: -1, i: 0 };
      }
      // the cup at the end
      if (m.sec >= course.sections.length - 1) {
        const { c } = channelContact(course.fin.channel, m, -1);
        if (c) contacts.push(c);
        const inCup = bowlContacts(course.fin.bowl, m, contacts);
        if (inCup && m.finished < 0 && len(m.v) < 25 && m.p[1] < course.fin.bowl.centre[1] + course.fin.bowl.height) m.finished = t;
      }
      if (best) {
        m.progress = Math.max(m.progress, course.starts[best.sec] + best.along);
        if (best.sec === m.sec) { m.chan = best.chan; m.hint = best.i; }
        else if (best.sec > m.sec) { m.sec = best.sec; m.chan = best.chan; m.hint = best.i; m.entryV = len(m.v); }
      }
      m.contact = contacts.length > 0;
      for (const c of contacts) resolve(m, c, h, impacts);
    }
    // each other
    for (let i = 0; i < marbles.length; i++) for (let j = i + 1; j < marbles.length; j++) pair(marbles[i], marbles[j], impacts);
    for (const m of marbles) spin(m, h);
  }
  for (const m of marbles) {
    // fallen off: back to the start of its section
    const sec = course.sections[m.sec];
    const low = sec ? Math.min(...sec.channels.map((c) => Math.min(...c.frames.map((f) => f.p[1]))), sec.end.p[1]) : course.top.p[1];
    if (m.p[1] < low - 80) { m.falls++; course.place(m, m.sec, 0, Math.max(5, m.entryV * 0.8)); }
    // stuck: a nudge along the way
    if (m.finished < 0 && len(m.v) < 2 && m.contact) {
      m.slowFor += dt;
      if (m.slowFor > 2.5) {
        const ch = sec?.channels[Math.max(0, m.chan)];
        const f = m.chan < 0 ? sec?.trays[0]?.frame : ch?.frames[Math.min(m.hint, ch.frames.length - 1)];
        m.v = add(m.v, mul(f ? f.t : [0, 0, 1], 40));
        m.slowFor = 0;
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
  // rolling resistance: a little off the speed along the surface; and the trough's roughness,
  // which takes more the faster it goes (so a long run settles at a few metres a second)
  const along = sub(m.v, mul(c.n, dot(m.v, c.n)));
  const sa = len(along);
  if (sa > 1e-6) {
    const drop = Math.min(sa, (m.mat.crr * (c.drag ?? 1) * G + ROUGH * sa * sa) * h);
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
      // (on b along J; on a the opposite)
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
  let q: [number, number, number, number] = [x + dq[0] * h, y + dq[1] * h, z + dq[2] * h, w + dq[3] * h];
  const l = Math.hypot(...q) || 1;
  m.q = [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  // (spin in the air stays; on the track friction has had its say)
}

/** The race order: finished first by time, then by how far along. */
export function order(marbles: Marble[]): Marble[] {
  return [...marbles].sort((a, b) => {
    if (a.finished >= 0 && b.finished >= 0) return a.finished - b.finished;
    if (a.finished >= 0) return -1;
    if (b.finished >= 0) return 1;
    return b.progress - a.progress;
  });
}
export { OPEN };

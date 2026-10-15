/**
 * Squishy: the dumpling, a soft body: a clear jelly toy of one (a glittery gumdrop with a tip),
 * or a steamed one of dough.
 *
 * A dumpling is a skin of particles (its mesh's own vertices) held to its shape by shape
 * matching (Müller et al., 2005): each small step the particles' best-fit rotation and best-fit
 * stretch are found, and every particle is drawn a little toward where that shape would put
 * it. The stretch is let in part (kept to its volume), so it squashes when it lands, bulges
 * out at the sides, and wobbles back; the pull is soft enough to see, a few wobbles a second,
 * and damped. Each particle meets the course on its own, so a corner dents it and a floor
 * flattens its bottom, with Coulomb friction, the surface's own bounce and movement, and tack:
 * it sticks, for a moment, even to a wall. Tipped over, it rolls itself back up, as a roly-poly.
 * Its momentum is its own, so in the air its middle
 * flies a plain parabola: the aiming line shows where it will go.
 */
import { CLIMB_CLEAR, CLIMB_IN, DUST, DUSTS, DUSTS_N, G, RADIUS, moveShapes, near, touch, type Dust, type Hit, type Level, type Shape, type V3 } from './level';
import { bedOf, holdJel, restAt, stepJel, surfAt, type Jel } from './jelly';

/** small steps a frame */
export const SUB = 10;
/** each particle's skin: how far from a surface it stops */
export const SKIN = 0.22;
/** how much of its volume it keeps each step (it squashes out sideways rather than in), and how fast a roll dies on the ground (/s) */
const KEEP = 0.9, ROLL = 30;
/** on the ground it rights itself, like a roly-poly: how fast it turns back upright (rad/s at a right angle) */
const RIGHT = 9;
/** how fast it shuffles round to face you, and rolls itself back upright, at most (radians a second) */
const TURN = 4, UPRIGHT = 3;
/** how far it may lean from what it's stood on before it rights itself (the sine of the angle: ~11°, fully by ~24°), and before it rolls itself back over (its cosine, ~22°) */
const LEAN0 = 0.19, LEAN1 = 0.4, SHUFFLE_UP = 0.93;
/** dough's tack: how hard it holds what it touches (cm/s²), and how near counts as touching */
const TACK = 900, STICK = 0.35;
/** a jelly's bed: how far up from its lowest point the dumpling's foot is (cm), that its top's held to; and how far short of the foot, so the foot's touching it */
const FOOT = 1.2, BED_SKIN = 0.003;
/** pressed (see `press`): how much just resting on something counts; how fast coming in counts all (cm/s); how fast it's let go of (s) */
const PRESS_REST = 0.4, PRESS_HARD = 250, PRESS_LET = 0.09;
/** on a jelly: how much of the slide its grip takes off it goes into rolling it on */
const SPIN_K = 0.4;
/** held: how far round the touch the finger has the dough (cm), and how hard it draws it each small step */
const GRAB_R = 2.6, GRAB_K = 0.12;
/** a poke: how far round the finger it dents (cm), how hard (cm/s at the finger), and how much it goes along the ground with it, and up */
const POKE_R = 2.4, POKE = 220, POKE_ROLL = 85, POKE_UP = 34;
/** a nudge: how fast it goes (cm/s), and the little hop with it */
const NUDGE = 90, NUDGE_UP = 40;
/** a push's roll: how fast, gentlest to hardest (cm/s); and about how far that rolls on the flat (cm) */
export const ROLL_MIN = 45, ROLL_MAX = 145;
export const rollReach = (v: number) => 0.00125 * v * v;
/** honey: how fast it takes the speed out of what's stuck to it (/s), and how far a step the rest is drawn back up to what's stuck (cm) */
const HONEY_DRAG = 90, HANG = 0.03;
/** hanging: how much of its stiffness it lets go (all of it would be soup), and how far it may droop from where it's stuck before it's drawn back up (cm) */
const LIMP = 0.55, DROOP = 1.1;
/** honey: how long after it lands on it the honey takes hold of what touches it (s) */
const SPLAT = 0.3;
/** on a rail: how fast it shimmies along when prodded (cm/s), how far a prod takes it (cm), and how far short of either
 * end of the rail it stops (cm) */
const SHIM_V = 18, SHIM_STEP = 6, SHIM_END = 5;
/** how long after it's flicked off a rail the rail lets it go by, unsnagged (s) */
const RAIL_LET = 0.15;

/** What it's made of: dough (steamed, pleated, plops) or jelly (a clear, glittery squishy toy: a gumdrop with a little tip, that jiggles). */
export type Kind = 'jelly' | 'dough';
/** each kind's spring back (wobbles a second), how little each wobble keeps, how much squash it takes, and its tack */
export const KINDS: Record<Kind, { hz: number; zeta: number; beta: number; tack: number; local: number }> = {
  dough: { hz: 9, zeta: 0.14, beta: 0.25, tack: 1, local: 0.65 },
  jelly: { hz: 14, zeta: 0.06, beta: 0.25, tack: 0.85, local: 0.55 },
};
/** how many patches it's fitted by, besides the whole of it, and how many patches each particle is in */
const CLUSTERS = 12, PER = 3;
/** For so long after a flick, what it's leaving hardly grips it (s). */
const LEAVE = 0.06;

/**
 * A skin turned on a lathe: a point at the bottom, rings up to a point at the top. `at(h, r, th)`
 * places a point from its height on a unit sphere (h, -1 to 1), its distance out (r) and its
 * angle round; `bias` crowds the rings toward the top, where a tip needs them.
 */
function lathe(at: (h: number, r: number, th: number) => V3, rings: number, segs: number, bias = 1): { pos: Float32Array; tris: Uint16Array } {
  const pts: V3[] = [at(-1, 0, 0)];
  for (let i = 1; i <= rings; i++) {
    const phi = (1 - (1 - i / (rings + 1)) ** bias) * Math.PI;
    for (let j = 0; j < segs; j++) pts.push(at(-Math.cos(phi), Math.sin(phi), (j / segs) * Math.PI * 2));
  }
  pts.push(at(1, 0, 0));
  const top = pts.length - 1;
  const tris: number[] = [];
  const ring = (i: number, j: number) => 1 + (i - 1) * segs + (((j % segs) + segs) % segs);
  for (let j = 0; j < segs; j++) tris.push(0, ring(1, j), ring(1, j + 1));
  for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = ring(i, j), b = ring(i, j + 1), c = ring(i + 1, j + 1), d = ring(i + 1, j);
    tris.push(a, d, c, a, c, b);
  }
  for (let j = 0; j < segs; j++) tris.push(top, ring(rings, j + 1), ring(rings, j));
  // (each triangle turned to face out)
  const cx = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  for (let k = 0; k < tris.length; k += 3) {
    const [a, b, c] = [pts[tris[k]], pts[tris[k + 1]], pts[tris[k + 2]]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3 - cx, (a[2] + b[2] + c[2]) / 3];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) { const t = tris[k + 1]; tris[k + 1] = tris[k + 2]; tris[k + 2] = t; }
  }
  return { pos: new Float32Array(pts.flat()), tris: new Uint16Array(tris) };
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** The dumpling's rest shape: a round body with a flatter bottom, gathered at the top in pleats that twist to a knot. */
export function dumplingRest(rings = 16, segs = 28): { pos: Float32Array; tris: Uint16Array } {
  const R = RADIUS;
  return lathe((h, r, th) => {
    let y = h < 0 ? h * 0.6 : h * 0.8;
    let rr = r * (h < 0 ? 1.12 : 1.12 - 0.38 * h * h);
    const pleat = smooth(0.05, 0.7, h) * (1 - smooth(0.88, 1, h)) * 0.1;
    rr *= 1 + pleat * Math.cos(12 * th + 4 * h);
    if (h > 0.8) y += (h - 0.8) * 0.9;
    return [Math.cos(th) * rr * R, y * R, Math.sin(th) * rr * R];
  }, rings, segs);
}
/**
 * The jelly's rest shape: a gumdrop, broad and soft-shouldered on a flat bottom, drawn up at
 * the top into a little pointed tip (where the mould was filled).
 */
export function jellyRest(rings = 20, segs = 28): { pos: Float32Array; tris: Uint16Array } {
  const R = RADIUS;
  return lathe((h, r, th) => {
    // (a squat body: the bottom flatter, the widest a little below the middle)
    let y = h < 0 ? h * 0.55 : h * 0.8;
    let rr = r * (h < 0 ? 1.1 - 0.06 * h * h : 1.1 - 0.3 * h * h);
    // (the shoulders drawn in toward the tip, and the tip: a cone, its point a little rounded)
    rr *= 1 - 0.3 * smooth(0.5, 1, h);
    y += 0.42 * Math.exp(-Math.sqrt(rr * rr + 0.0004) / 0.15) * smooth(0, 0.6, h);
    return [Math.cos(th) * rr * R, y * R, Math.sin(th) * rr * R];
  }, rings, segs, 1.6);
}

const qmul = (a: number[], b: number[]) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
function qmat(q: number[], m: Float64Array) {
  const [x, y, z, w] = q;
  m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y - z * w); m[2] = 2 * (x * z + y * w);
  m[3] = 2 * (x * y + z * w); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z - x * w);
  m[6] = 2 * (x * z - y * w); m[7] = 2 * (y * z + x * w); m[8] = 1 - 2 * (x * x + y * y);
}
/** The rotation nearest A (row-major), from the last one: a few steps of Müller, Bender et al.'s 2016 iteration. */
function rotationOf(A: Float64Array, q: number[], R: Float64Array, iters = 4) {
  for (let it = 0; it < iters; it++) {
    qmat(q, R);
    let ox = 0, oy = 0, oz = 0, d = 0;
    for (let j = 0; j < 3; j++) {
      const rx = R[j], ry = R[3 + j], rz = R[6 + j], ax = A[j], ay = A[3 + j], az = A[6 + j];
      ox += ry * az - rz * ay; oy += rz * ax - rx * az; oz += rx * ay - ry * ax;
      d += rx * ax + ry * ay + rz * az;
    }
    const s = 1 / (Math.abs(d) + 1e-9);
    ox *= s; oy *= s; oz *= s;
    const w = Math.hypot(ox, oy, oz);
    if (w < 1e-9) break;
    const h = Math.sin(w / 2) / w;
    const nq = qmul([ox * h, oy * h, oz * h, Math.cos(w / 2)], q);
    const l = Math.hypot(nq[0], nq[1], nq[2], nq[3]);
    q[0] = nq[0] / l; q[1] = nq[1] / l; q[2] = nq[2] / l; q[3] = nq[3] / l;
  }
  qmat(q, R);
}
function inv3(m: Float64Array, o: Float64Array) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  o[0] = A / det; o[1] = -(b * i - c * h) / det; o[2] = (b * f - c * e) / det;
  o[3] = B / det; o[4] = (a * i - c * g) / det; o[5] = -(a * f - c * d) / det;
  o[6] = C / det; o[7] = -(a * h - b * g) / det; o[8] = (a * e - b * d) / det;
}
const det3 = (m: Float64Array) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);

/**
 * How hard what it's touching holds it, here: what it's made of has its say only against its sides (what it's on,
 * it slides on), and only if it isn't skidding past fast (a graze at speed carries on; it doesn't stop dead);
 * honey, a rail, a towel hold whatever way they're met.
 */
const SKID = 90;
function gripOf(sh: Shape, o: Hit, v: Float32Array, i3: number): number {
  if (!sh.wallGrip || sh.tack <= 1) return sh.tack;
  if (o.ny > 0.5) return 1;
  const rx = v[i3] - o.vx, ry = v[i3 + 1] - o.vy, rz = v[i3 + 2] - o.vz, vn = rx * o.nx + ry * o.ny + rz * o.nz;
  return Math.hypot(rx - o.nx * vn, ry - o.ny * vn, rz - o.nz * vn) > SKID ? 1 : sh.tack;
}
export class Dumpling {
  n: number;
  tris: Uint16Array;
  /** where each particle is, how fast it goes, where it's going this step */
  x: Float32Array;
  v: Float32Array;
  p: Float32Array;
  /** each particle's place in the rest shape, about its middle */
  q: Float32Array;
  private aqqInv = new Float64Array(9);
  private quat = [0, 0, 0, 1];
  /**
   * Its patches: each a dozen-odd neighbouring particles fitted on their own, so one part of it
   * can bend from another (droop from where it's stuck, fold over an edge) while the whole of it
   * still keeps its shape. Each: its particles, where each sits from the patch's middle at rest,
   * and its own turn (kept from step to step).
   */
  private patches: Array<{ idx: Int32Array; r: Float32Array; quat: number[]; R: Float64Array }> = [];
  private goals = new Float32Array(0);
  /** its turn and its squash, as last matched (row-major) */
  R = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  A = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  com: V3 = [0, 0, 0];
  vcom: V3 = [0, 0, 0];
  /** how fast its middle has really been going, averaged over the last quarter second or so: a quiver on an edge averages to nothing */
  drift: V3 = [0, 0, 0];
  private comWas: V3 = [0, 0, 0];
  restVolume: number;
  // touching, per particle: normal, depth pushed out this step, grip, bounce, surface velocity, normal speed coming in, and how (0 not, 1 touching, 2 near)
  private cn: Float32Array;
  private cd: Float32Array;
  private cmu: Float32Array;
  private cb: Float32Array;
  private cvs: Float32Array;
  private cv0: Float32Array;
  private cf: Uint8Array;
  private ctk: Float32Array;
  private ctr: Float32Array;
  /** how fast what it's held by lets it creep (cm/s) */
  private ccr: Float32Array;
  private cdust: Uint8Array;
  /** the rail each touches, if what it touches is one; and the rail each has hold of, if it's held to one */
  private crail: Array<Shape | null>;
  private railHold: Array<Shape | null>;
  private pin: Uint8Array;
  /** (scratch: each point's weight on a jelly's bed) */
  private bw: Float32Array;
  /** how hard each particle's pressed against what it's on (0–1): touching, more as it comes in hard or sinks into a jelly's
   * bed; let go of quickly as it comes away (for the drawing: what's pressed darkens and spreads its gloss); and this step's */
  press: Float32Array;
  private pressNow: Float32Array;
  /** (scratch: how many of its points are on a jelly's bed, this small step) */
  private bedFoot = 0;
  /** what each particle is coated with, and how thickly (0–1): picked up where it touches, worn off in time, shaken off by a hard landing */
  coat: Float32Array;
  coatKind: Uint8Array;
  /** how much of it is coated, by kind (0–1 each), and the most of any */
  coated: number[] = new Array(DUSTS_N).fill(0);
  coatMost: Dust = DUST.none;
  /** peppered: how close to a sneeze (0–1); it sneezes at 1 */
  sneeze = 0;
  /** things that happened this step, for the drawing and the sounds: it sneezed; it shook some coating off (which) */
  sneezed = false;
  shook: Dust = DUST.none;
  private nearby: Shape[] = [];
  private hit: Hit = { nx: 0, ny: 0, nz: 0, d: 0, vx: 0, vy: 0, vz: 0 };
  /** how much tack is left (dough tires of holding a wall), seconds since it touched anything, since it was flicked */
  tack = 1;
  sinceContact = 9;
  sinceFlick = 9;
  /** particles touching, whether any is on something steep, how level what it's on is (the contacts' normals' up, averaged), and how much of it is on a floor */
  contacts = 0;
  onWall = false;
  groundNy = 1;
  onFloor = 1;
  /** which way is up for it, where it's standing: the floor's own (a ramp's, a tipped plate's), or the world's on a wall or in the air */
  upTo: V3 = [0, 1, 0];
  /** how limp it's gone (0–1): hanging from something, held by its side, it lets its weight pull it into a droop */
  limp = 0;
  /** the rail it's hanging from, if it is (held there by what touches it); and a shimmy along it under way: which way, how far still */
  onRail: Shape | null = null;
  private shim: { dir: number; left: number; rail: Shape } | null = null;
  /** flicked off a rail: what it hung from and against (the rail, a sill, an oven's door), let go of a moment, unsnagged */
  private letGo: Set<Shape> | null = null;
  /** clinging to an edge (draped over it, gripping its top and its side) and a shuffle along it under way: which way, how far still */
  private edgeShim: { t: V3; left: number } | null = null;
  /** where its foot is (what of it is on a floor, its middle), and whether it's on its feet: its middle over its foot and above it;
   * not draped over an edge, clinging to a side, hanging */
  foot: V3 = [0, 0, 0];
  onFeet = false;
  /**
   * Climbing: flicked up the wall it was clinging to (its normal, out of the wall), sliding up it;
   * once it's clear of the wall's top it's carried in over it. Whether it's been on the wall yet.
   */
  climb: { n: V3; on: boolean; off: number } | null = null;
  /** the wall it's against, if any: the way out of it, level (the touching particles' normals, averaged) */
  wallN: V3 = [0, 0, 0];
  /** Clinging: on something mostly by its side, little or nothing under it. */
  /** clinging to an edge: touching a top and a side, not on its feet over the top, not hanging from a rail */
  get onEdge() { return this.contacts > 0 && this.onWall && this.onFloor > 0.05 && !this.onFeet && !this.onRail && Math.hypot(this.wallN[0], this.wallN[2]) > 0.5; }
  get clinging() { return this.contacts > 0 && this.onWall && this.onFloor < 0.3 && Math.hypot(this.wallN[0], this.wallN[2]) > 0.5; }
  /** how long it can go on hanging by a grip that tires (linen's, sugar's): drained as it hangs, filled again on a floor (0–1) */
  grip = 1;
  /** how long it's been on honey this time (s; -1 when it isn't) */
  honeyT = -1;
  /** how much what it's touching holds it (the stickiest, 0–3), and how many particles honey has hold of */
  held = 0;
  pinned = 0;
  /**
   * the spin it was flicked with (-1 backspin … 1 topspin), and how much of it is left to
   * spend on landing: topspin runs on (less grip, the roll let live), backspin bites (more grip,
   * the tack quick to hold)
   */
  spinMode = 0;
  spinLeft = 0;
  /** the hardest it hit anything this frame (cm/s), and how far from its shape it is */
  impact = 0;
  deform = 0;
  /** being wound up for a flick: squeezed along a way, so much */
  squeeze: { d: V3; k: number } | null = null;
  /** which way it would like its face to look when it's sat still (a direction in the ground's plane), if any */
  look: V3 | null = null;

  /** what it's made of, and so how it springs, squashes and sticks */
  readonly kind: Kind;
  private phys: (typeof KINDS)[Kind];

  constructor(at: V3, kind: Kind = 'jelly') {
    this.kind = kind;
    this.phys = KINDS[kind];
    const s = kind === 'jelly' ? jellyRest() : dumplingRest();
    this.n = s.pos.length / 3;
    this.tris = s.tris;
    const n = this.n;
    this.x = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.p = new Float32Array(n * 3); this.q = new Float32Array(n * 3);
    this.cn = new Float32Array(n * 3); this.cd = new Float32Array(n); this.cmu = new Float32Array(n); this.cb = new Float32Array(n);
    this.cvs = new Float32Array(n * 3); this.cv0 = new Float32Array(n); this.cf = new Uint8Array(n); this.ctk = new Float32Array(n); this.ctr = new Float32Array(n); this.ccr = new Float32Array(n); this.pin = new Uint8Array(n); this.bw = new Float32Array(n); this.cdust = new Uint8Array(n); this.crail = new Array(n).fill(null); this.railHold = new Array(n).fill(null);
    this.coat = new Float32Array(n); this.coatKind = new Uint8Array(n); this.press = new Float32Array(n); this.pressNow = new Float32Array(n);
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += s.pos[i * 3]; cy += s.pos[i * 3 + 1]; cz += s.pos[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    const aqq = new Float64Array(9);
    for (let i = 0; i < n; i++) {
      const q0 = s.pos[i * 3] - cx, q1 = s.pos[i * 3 + 1] - cy, q2 = s.pos[i * 3 + 2] - cz;
      this.q[i * 3] = q0; this.q[i * 3 + 1] = q1; this.q[i * 3 + 2] = q2;
      aqq[0] += q0 * q0; aqq[1] += q0 * q1; aqq[2] += q0 * q2; aqq[4] += q1 * q1; aqq[5] += q1 * q2; aqq[8] += q2 * q2;
    }
    aqq[3] = aqq[1]; aqq[6] = aqq[2]; aqq[7] = aqq[5];
    inv3(aqq, this.aqqInv);
    this.makePatches();
    this.place(at);
    this.restVolume = this.volume();
  }
  /** At rest at a place (its middle there), upright, still. */
  place(at: V3, yaw = 0) {
    // (turned about the upright by yaw: its face, its rest shape's +z, the way (sin yaw, 0, cos yaw))
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (let i = 0; i < this.n; i++) {
      const qx = this.q[i * 3], qy = this.q[i * 3 + 1], qz = this.q[i * 3 + 2];
      this.x[i * 3] = at[0] + c * qx + sn * qz; this.x[i * 3 + 1] = at[1] + qy; this.x[i * 3 + 2] = at[2] - sn * qx + c * qz;
      this.v[i * 3] = 0; this.v[i * 3 + 1] = 0; this.v[i * 3 + 2] = 0;
    }
    this.quat = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    for (const pt of this.patches) { pt.quat = [...this.quat]; qmat(pt.quat, pt.R); }
    this.R.set([c, 0, sn, 0, 1, 0, -sn, 0, c]);
    this.A.set(this.R);
    this.com = [...at] as V3;
    this.vcom = [0, 0, 0]; this.drift = [0, 0, 0]; this.comWas = [...at] as V3;
    this.tack = 1; this.sinceContact = 0; this.sinceFlick = 9; this.squeeze = null;
    this.spinMode = 0; this.spinLeft = 0; this.held = 0; this.grip = 1; this.limp = 0; this.honeyT = -1; this.climb = null; this.onRail = null; this.shim = null; this.railHold.fill(null); this.edgeShim = null; this.onFeet = false;
    this.coat.fill(0); this.coatKind.fill(0); this.press.fill(0); this.coated = new Array(DUSTS_N).fill(0); this.coatMost = DUST.none; this.sneeze = 0;
  }
  /**
   * Held by a finger: the dough round where it was touched (each particle so much, 1 at the
   * touch, less away from it) drawn out by `pull` from where the shape would have it, so it
   * stretches toward the finger; null when let go.
   */
  grab: { w: Float32Array; pull: V3 } | null = null;
  /** Take hold of it at particle i: the dough within a couple of centimetres of it, that much less the further. */
  hold(i: number): Float32Array {
    const w = new Float32Array(this.n), x = this.x;
    for (let j = 0; j < this.n; j++) {
      const d = Math.hypot(x[j * 3] - x[i * 3], x[j * 3 + 1] - x[i * 3 + 1], x[j * 3 + 2] - x[i * 3 + 2]);
      if (d < GRAB_R) w[j] = (1 - d / GRAB_R) ** 2;
    }
    return w;
  }
  /**
   * A poke at a point, the finger going `dir`: the dough there pushed in (a dent), and the whole
   * of it a little, the way it's pushed along the ground (so a poke at its back rolls it on; at
   * its top, it dents and wobbles where it is).
   */
  poke(at: V3, dir: V3, roll = true, k = 1, carry = 1) {
    const x = this.x, v = this.v;
    // (hanging from a rail: prodded along it, away from the side it's prodded on; no more than that)
    const rl = this.onRail;
    if (rl && roll) {
      const ax = railAxis(rl), side = (at[0] - this.com[0]) * ax[0] + (at[1] - this.com[1]) * ax[1] + (at[2] - this.com[2]) * ax[2];
      const along = dir[0] * ax[0] + dir[1] * ax[1] + dir[2] * ax[2];
      this.shimmy(Math.abs(side) > 0.4 ? -Math.sign(side) : Math.sign(along) || 1);
      return;
    }
    // (clinging to an edge: shuffled along it the same way, a hand's width, away from the side it's prodded on)
    if (this.onEdge && roll) {
      const tn: V3 = [-this.wallN[2], 0, this.wallN[0]];
      const side = (at[0] - this.com[0]) * tn[0] + (at[2] - this.com[2]) * tn[2], along = dir[0] * tn[0] + dir[2] * tn[2];
      const sg = Math.abs(side) > 0.4 ? -Math.sign(side) : Math.sign(along) || 1;
      this.edgeShim = { t: [tn[0] * sg, 0, tn[2] * sg], left: SHIM_STEP };
      return;
    }
    for (let j = 0; j < this.n; j++) {
      const d = Math.hypot(x[j * 3] - at[0], x[j * 3 + 1] - at[1], x[j * 3 + 2] - at[2]);
      if (d >= POKE_R) continue;
      const kk = k * POKE * (1 - d / POKE_R) ** 2;
      v[j * 3] += dir[0] * kk; v[j * 3 + 1] += dir[1] * kk; v[j * 3 + 2] += dir[2] * kk;
    }
    // (along the ground, it goes as far as the poke is along the ground: a level poke, a roll; a poke from above, hardly any)
    const h = Math.hypot(dir[0], dir[2]);
    if (roll && h > 1e-3) {
      // (and pushed up from underneath, it hops a little: a poke low on its side lifts it as it rolls)
      const m = k * carry, ax = (dir[0] / h) * POKE_ROLL * h * m, az = (dir[2] / h) * POKE_ROLL * h * m;
      this.flick([this.vcom[0] + ax, this.vcom[1] + (POKE_UP * h + POKE_ROLL * 1.3 * Math.max(0, dir[1])) * m, this.vcom[2] + az], 0.5 * h * m);
    } else this.sinceFlick = 0;
  }
  /** Hanging from a rail: shimmied along it a hand's width (so many), `dir` (+1, toward its far end; -1, back), hand over hand. */
  shimmy(dir: number, steps = 1) {
    if (!this.onRail) return;
    this.shim = { dir: Math.sign(dir) || 1, left: SHIM_STEP * steps, rail: this.onRail };
  }
  /** how far along the rail it's hanging from it is (cm from its first end), and how long that rail is */
  railAt(): { s: number; L: number } | null {
    const rl = this.onRail;
    if (!rl) return null;
    const ax = railAxis(rl), L = Math.hypot(rl.b[0] - rl.c[0], rl.b[1] - rl.c[1], rl.b[2] - rl.c[2]);
    return { s: (this.com[0] - rl.c[0]) * ax[0] + (this.com[1] - rl.c[1]) * ax[1] + (this.com[2] - rl.c[2]) * ax[2], L };
  }
  /** A nudge: pushed, not flicked, it rolls once the way it's pushed, a hand's width, no more. */
  nudge(dir: V3) {
    const h = Math.hypot(dir[0], dir[2]) || 1;
    const dx = dir[0] / h, dz = dir[2] / h;
    this.flick([dx * NUDGE, NUDGE_UP, dz * NUDGE], 0.5);
  }
  /** A push: rolled the way it's pushed (dir, along the ground), so fast (cm/s); it goes about `rollReach` of that, on the flat. */
  roll(dir: V3, v: number) {
    const h = Math.hypot(dir[0], dir[2]) || 1;
    this.flick([(dir[0] / h) * v, 12 + 0.05 * v, (dir[2] / h) * v], 0.5);
  }
  /** how fast it's going, for whether it's come to a stop: hanging from a rail, how its middle drifts (what holds it
   * keeps its particles a-tremble, its middle still) */
  get moving() { return Math.hypot(...(this.onRail ? this.drift : this.vcom)); }
  /** Whether it can be flicked: touching something (or only just off it), and not just flicked. */
  get canFlick() { return this.sinceContact < 0.2 && this.sinceFlick > 0.25; }
  /** Flicked: its middle goes at vel, a little of its wobble kept, and a roll: a little forward, or the spin it was given. */
  flick(vel: V3, spin = 0, climb: V3 | null = null) {
    // (off a rail: what it's hanging from and pressed against, it pushes off, and isn't snagged on as it goes)
    if (this.onRail) {
      const o: Hit = { nx: 0, ny: 0, nz: 0, d: 0, vx: 0, vy: 0, vz: 0 }, c = this.com;
      this.letGo = new Set(this.nearby.filter((sh) => sh.rail || touch(sh, c[0], c[1], c[2], RADIUS * 1.5 + 1, o)));
    } else this.letGo = null;
    // (a climb: up the wall it's on, sliding, and over the top when it's clear; see step)
    this.climb = climb ? { n: climb, on: false, off: 0 } : null;
    const h = Math.hypot(vel[0], vel[2]) || 1;
    // (topspin is a real roll forward; backspin only a little back, its bite being in how it lands)
    const w = 2 + 14 * Math.max(0, spin) - 7 * Math.max(0, -spin);
    const wx = (vel[2] / h) * w, wz = (-vel[0] / h) * w;
    this.spinMode = spin; this.spinLeft = Math.abs(spin) > 0.05 ? 1 : 0;
    for (let i = 0; i < this.n; i++) {
      const rx = this.x[i * 3] - this.com[0], ry = this.x[i * 3 + 1] - this.com[1], rz = this.x[i * 3 + 2] - this.com[2];
      this.v[i * 3] = vel[0] + (this.v[i * 3] - this.vcom[0]) * 0.25 + (-wz * ry);
      this.v[i * 3 + 1] = vel[1] + (this.v[i * 3 + 1] - this.vcom[1]) * 0.25 + (wz * rx - wx * rz);
      this.v[i * 3 + 2] = vel[2] + (this.v[i * 3 + 2] - this.vcom[2]) * 0.25 + (wx * ry);
    }
    this.vcom = [...vel] as V3; this.drift = [...vel] as V3;
    this.tack = 0; this.sinceFlick = 0; this.squeeze = null;
  }
  /** Its volume (the skin's enclosed volume). */
  volume(x = this.x): number {
    let v = 0;
    const t = this.tris;
    for (let k = 0; k < t.length; k += 3) {
      const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
      v += x[a] * (x[b + 1] * x[c + 2] - x[b + 2] * x[c + 1]) - x[a + 1] * (x[b] * x[c + 2] - x[b + 2] * x[c]) + x[a + 2] * (x[b] * x[c + 1] - x[b + 1] * x[c]);
    }
    return v / 6;
  }
  /** How tall it stands now (top to bottom). */
  height(): number {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < this.n; i++) { const y = this.x[i * 3 + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
    return hi - lo;
  }

  /** Its patches: centres spread over its rest shape (each the furthest from those before), every particle in the few nearest. */
  private makePatches() {
    const n = this.n, q = this.q;
    const centres: number[] = [];
    let lowest = 0;
    for (let i = 0; i < n; i++) if (q[i * 3 + 1] < q[lowest * 3 + 1]) lowest = i;
    centres.push(lowest);
    const far = new Float32Array(n).fill(Infinity);
    while (centres.length < CLUSTERS) {
      const c = centres[centres.length - 1];
      let best = 0;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(q[i * 3] - q[c * 3], q[i * 3 + 1] - q[c * 3 + 1], q[i * 3 + 2] - q[c * 3 + 2]);
        if (d < far[i]) far[i] = d;
        if (far[i] > far[best]) best = i;
      }
      centres.push(best);
    }
    const members: number[][] = centres.map(() => []);
    for (let i = 0; i < n; i++) {
      const order = centres.map((c, k) => [Math.hypot(q[i * 3] - q[c * 3], q[i * 3 + 1] - q[c * 3 + 1], q[i * 3 + 2] - q[c * 3 + 2]), k]).sort((a, b) => a[0] - b[0]);
      for (let k = 0; k < PER; k++) members[order[k][1]].push(i);
    }
    this.patches = members.map((m) => {
      let mx = 0, my = 0, mz = 0;
      for (const i of m) { mx += q[i * 3]; my += q[i * 3 + 1]; mz += q[i * 3 + 2]; }
      mx /= m.length; my /= m.length; mz /= m.length;
      const r = new Float32Array(m.length * 3);
      m.forEach((i, j) => { r[j * 3] = q[i * 3] - mx; r[j * 3 + 1] = q[i * 3 + 1] - my; r[j * 3 + 2] = q[i * 3 + 2] - mz; });
      return { idx: Int32Array.from(m), r, quat: [0, 0, 0, 1], R: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) };
    });
    this.goals = new Float32Array(n * 3);
  }
  /** The held dough drawn toward where the fitted shape would put it, moved out by pull, so far as each is held. */
  private pullOut(p: Float32Array, w: Float32Array, pull: V3) {
    const n = this.n, q = this.q, R = this.R;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += p[i * 3]; cy += p[i * 3 + 1]; cz += p[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    for (let i = 0; i < n; i++) {
      const k = w[i];
      if (k <= 0) continue;
      const q0 = q[i * 3], q1 = q[i * 3 + 1], q2 = q[i * 3 + 2];
      const gx = cx + R[0] * q0 + R[1] * q1 + R[2] * q2 + pull[0] * k, gy = cy + R[3] * q0 + R[4] * q1 + R[5] * q2 + pull[1] * k, gz = cz + R[6] * q0 + R[7] * q1 + R[8] * q2 + pull[2] * k;
      const a = GRAB_K * k;
      p[i * 3] += (gx - p[i * 3]) * a; p[i * 3 + 1] += (gy - p[i * 3 + 1]) * a; p[i * 3 + 2] += (gz - p[i * 3 + 2]) * a;
    }
  }
  /** The particles drawn toward the shape that best fits them (turned, partly squashed, kept to its volume). */
  private match(p: Float32Array, alpha: number) {
    const n = this.n, q = this.q;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += p[i * 3]; cy += p[i * 3 + 1]; cz += p[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    const apq = new Float64Array(9);
    for (let i = 0; i < n; i++) {
      const d0 = p[i * 3] - cx, d1 = p[i * 3 + 1] - cy, d2 = p[i * 3 + 2] - cz;
      const q0 = q[i * 3], q1 = q[i * 3 + 1], q2 = q[i * 3 + 2];
      apq[0] += d0 * q0; apq[1] += d0 * q1; apq[2] += d0 * q2;
      apq[3] += d1 * q0; apq[4] += d1 * q1; apq[5] += d1 * q2;
      apq[6] += d2 * q0; apq[7] += d2 * q1; apq[8] += d2 * q2;
    }
    rotationOf(apq, this.quat, this.R);
    // the stretch that fits best, kept to its volume
    const A = this.A, ai = this.aqqInv, R = this.R;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) A[r * 3 + c] = apq[r * 3] * ai[c] + apq[r * 3 + 1] * ai[3 + c] + apq[r * 3 + 2] * ai[6 + c];
    const det = det3(A);
    if (det > 1e-6) { const s = 1 / Math.cbrt(det); for (let k = 0; k < 9; k++) A[k] *= s; } else A.set(R);
    const T = new Float64Array(9);
    const beta = this.phys.beta;
    for (let k = 0; k < 9; k++) T[k] = beta * A[k] + (1 - beta) * R[k];
    // (held by honey: the whole of it carried so that what's stuck sits where the fitted shape
    // puts it; so it hangs from the patch, rather than sagging off it, a little more each step)
    if (this.pinned > 4) {
      let ox = 0, oy = 0, oz = 0, m = 0;
      for (let i = 0; i < n; i++) {
        if (!this.pin[i]) continue;
        const q0 = q[i * 3], q1 = q[i * 3 + 1], q2 = q[i * 3 + 2];
        ox += cx + T[0] * q0 + T[1] * q1 + T[2] * q2 - p[i * 3]; oy += cy + T[3] * q0 + T[4] * q1 + T[5] * q2 - p[i * 3 + 1]; oz += cz + T[6] * q0 + T[7] * q1 + T[8] * q2 - p[i * 3 + 2];
        m++;
      }
      if (m && m < n) {
        // (the rest moved the other way, enough to bring the fit's middle up to the patch; a little each step, as a pull, not a snap)
        // (a droop of a couple of centimetres let be: only beyond that is it drawn back up)
        const l = Math.hypot(ox, oy, oz) / m, over = Math.max(0, l - DROOP), want = (over * n) / (n - m), k = l > 1e-9 ? -Math.min(want, HANG) / (l * m) : 0;
        ox *= k; oy *= k; oz *= k;
        for (let i = 0; i < n; i++) if (!this.pin[i]) { p[i * 3] += ox; p[i * 3 + 1] += oy; p[i * 3 + 2] += oz; }
      }
    }
    // each patch's own fit: where its particles would be, were the patch only turned
    const G = this.goals, loc = this.phys.local + (0.85 - this.phys.local) * this.limp;
    G.fill(0);
    if (loc > 0) for (const pt of this.patches) {
      const idx = pt.idx, r = pt.r, m = idx.length;
      let mx = 0, my = 0, mz = 0;
      for (let j = 0; j < m; j++) { const i = idx[j] * 3; mx += p[i]; my += p[i + 1]; mz += p[i + 2]; }
      mx /= m; my /= m; mz /= m;
      const ap = new Float64Array(9);
      for (let j = 0; j < m; j++) {
        const i = idx[j] * 3, d0 = p[i] - mx, d1 = p[i + 1] - my, d2 = p[i + 2] - mz, r0 = r[j * 3], r1 = r[j * 3 + 1], r2 = r[j * 3 + 2];
        ap[0] += d0 * r0; ap[1] += d0 * r1; ap[2] += d0 * r2; ap[3] += d1 * r0; ap[4] += d1 * r1; ap[5] += d1 * r2; ap[6] += d2 * r0; ap[7] += d2 * r1; ap[8] += d2 * r2;
      }
      rotationOf(ap, pt.quat, pt.R, 2);
      const P = pt.R;
      for (let j = 0; j < m; j++) {
        const i = idx[j] * 3, r0 = r[j * 3], r1 = r[j * 3 + 1], r2 = r[j * 3 + 2];
        G[i] += mx + P[0] * r0 + P[1] * r1 + P[2] * r2; G[i + 1] += my + P[3] * r0 + P[4] * r1 + P[5] * r2; G[i + 2] += mz + P[6] * r0 + P[7] * r1 + P[8] * r2;
      }
    }
    // (wound up for a flick: squeezed along the way it will go, and wider across, at the same volume, about its middle)
    let S: Float64Array | null = null;
    if (this.squeeze) {
      const [dx, dy, dz] = this.squeeze.d, k = this.squeeze.k;
      const sd = 1 - 0.38 * k, sp = 1 / Math.sqrt(sd);
      const D = [dx * dx, dx * dy, dx * dz, dy * dx, dy * dy, dy * dz, dz * dx, dz * dy, dz * dz];
      S = new Float64Array(9);
      for (let k2 = 0; k2 < 9; k2++) S[k2] = (k2 % 4 === 0 ? sp : 0) + (sd - sp) * D[k2];
    }
    // each particle drawn toward its goal: the whole's fit and its patches', blended
    let dev = 0;
    for (let i = 0; i < n; i++) {
      const q0 = q[i * 3], q1 = q[i * 3 + 1], q2 = q[i * 3 + 2];
      let gx = cx + T[0] * q0 + T[1] * q1 + T[2] * q2, gy = cy + T[3] * q0 + T[4] * q1 + T[5] * q2, gz = cz + T[6] * q0 + T[7] * q1 + T[8] * q2;
      if (loc > 0) { gx += (G[i * 3] / PER - gx) * loc; gy += (G[i * 3 + 1] / PER - gy) * loc; gz += (G[i * 3 + 2] / PER - gz) * loc; }
      if (S) {
        const ox = gx - cx, oy = gy - cy, oz = gz - cz;
        gx = cx + S[0] * ox + S[1] * oy + S[2] * oz; gy = cy + S[3] * ox + S[4] * oy + S[5] * oz; gz = cz + S[6] * ox + S[7] * oy + S[8] * oz;
      }
      const ex = gx - p[i * 3], ey = gy - p[i * 3 + 1], ez = gz - p[i * 3 + 2];
      dev += ex * ex + ey * ey + ez * ez;
      p[i * 3] += ex * alpha; p[i * 3 + 1] += ey * alpha; p[i * 3 + 2] += ez * alpha;
    }
    this.deform = Math.sqrt(dev / n) / RADIUS;
  }

  /**
   * Its volume kept (most of the way, each step): every particle moved along the volume's
   * gradient there (the skin's outward normal, weighted by the area about it) by one amount.
   */
  private grad = new Float32Array(0);
  private keepVolume(p: Float32Array) {
    const n = this.n, t = this.tris;
    if (this.grad.length !== n * 3) this.grad = new Float32Array(n * 3);
    const g = this.grad;
    g.fill(0);
    let vol = 0;
    for (let k = 0; k < t.length; k += 3) {
      const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
      const ax = p[a], ay = p[a + 1], az = p[a + 2], bx = p[b], by = p[b + 1], bz = p[b + 2], cx = p[c], cy = p[c + 1], cz = p[c + 2];
      vol += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
      g[a] += by * cz - bz * cy; g[a + 1] += bz * cx - bx * cz; g[a + 2] += bx * cy - by * cx;
      g[b] += cy * az - cz * ay; g[b + 1] += cz * ax - cx * az; g[b + 2] += cx * ay - cy * ax;
      g[c] += ay * bz - az * by; g[c + 1] += az * bx - ax * bz; g[c + 2] += ax * by - ay * bx;
    }
    vol /= 6;
    let w = 0;
    for (let i = 0; i < n * 3; i++) { g[i] /= 6; w += g[i] * g[i]; }
    const lam = (KEEP * (this.restVolume - vol)) / (w || 1);
    for (let i = 0; i < n * 3; i++) p[i] += g[i] * lam;
  }

  /**
   * On a jelly's top, a bed: how far its foot is in, under the top as it is at rest (x, its lowest point's),
   * and how fast it's going (v), and the jelly pushes the whole of it back up k x (1 + (x/x0)²) − c v (see
   * `bedOf`), and holds it from sliding, as much as that push lets it. (How far in from where it was at the
   * start of the step, not where it's going: else the bed takes a little of each landing, as a damper would.
   * And on the whole of it, not its foot: pushed on its foot it squashes, and its squash keeps half of what
   * the bed gives back.) The jelly's top is held to its foot while it's in (`holdJel`), and wobbles on after.
   */
  private bed(j: Jel, mu: number, p: Float32Array, h: number) {
    const n = this.n, x = this.x, bw = this.bw, r2 = j.rad * j.rad;
    let low = Infinity, lowP = Infinity;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, dx = x[i3] - j.cx, dz = x[i3 + 2] - j.cz;
      if (dx * dx + dz * dz > r2) { bw[i] = NaN; continue; }
      bw[i] = x[i3 + 1] - SKIN - restAt(j, dx, dz);
      if (bw[i] < low) low = bw[i];
      const y = p[i3 + 1] - x[i3 + 1] + bw[i];
      if (y < lowP) lowP = y;
    }
    // (not in, nor going in this step; or flicked off it, which goes as it was aimed, not thrown harder by what
    // it had sunk in: let go)
    if ((!(low < 0) && !(lowP < 0)) || (this.sinceFlick < LEAVE && this.vcom[1] > 0)) { holdJel(j, 0, 0, 0, 0, 0); j.ride = undefined; return; }
    let sw = 0, cx = 0, cz = 0, vy = 0, vx = 0, vz = 0, mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      mx += x[i3]; my += x[i3 + 1]; mz += x[i3 + 2];
      vx += p[i3] - x[i3]; vy += p[i3 + 1] - x[i3 + 1]; vz += p[i3 + 2] - x[i3 + 2];
      const w = bw[i] === bw[i] ? Math.max(0, FOOT - (bw[i] - low)) : 0;
      bw[i] = w; sw += w; cx += x[i3] * w; cz += x[i3 + 2] * w;
    }
    vx /= n * h; vy /= n * h; vz /= n * h; cx /= sw; cz /= sw; mx /= n; my /= n; mz /= n;
    // (how far in: its middle, from where its middle was as its foot touched; not its foot, which its own
    // sagging and squashing, or tack drawing it down, would take deeper, and the bed would push back harder)
    const over = my - restAt(j, mx - j.cx, mz - j.cz);
    if (j.ride === undefined) { j.ride = over - Math.min(0, low); j.vin = -vy; }
    const depth = Math.max(0, j.ride - over);
    let rf = 0;
    for (let i = 0; i < n; i++) if (bw[i] > 0) rf = Math.max(rf, Math.hypot(x[i * 3] - cx, x[i * 3 + 2] - cz));
    const { k, zeta, x0 } = bedOf(j, j.vin), q = depth / x0;
    const F = depth > 0 ? Math.max(0, k * depth * (1 + q * q) - 2 * zeta * Math.sqrt(k * (1 + 3 * q * q)) * vy) : 0;
    // (pressed into it: its foot, the more the deeper it's in)
    for (let i = 0; i < n; i++) if (bw[i] > 0) this.pressNow[i] = Math.max(this.pressNow[i], (bw[i] / FOOT) * (PRESS_REST + (1 - PRESS_REST) * Math.min(1, q)));
    // (pushed out of its top as its top is there, dented or domed, not only up)
    const se = 0.5, sx = cx - j.cx, sz = cz - j.cz;
    const gx = (surfAt(j, sx + se, sz) - surfAt(j, sx - se, sz)) / (2 * se), gz = (surfAt(j, sx, sz + se) - surfAt(j, sx, sz - se)) / (2 * se);
    const nl = Math.hypot(gx, 1, gz), nx = -gx / nl, ny = 1 / nl, nz = -gz / nl;
    // (and its sliding held back, as much as the push and its slipperiness let it: glossy, hardly; and what's held
    // back at its foot sets it rolling, the way it was going)
    const vt = Math.hypot(vx, vz), ft = vt > 1e-6 ? Math.min(vt, mu * F * h) / vt : 0;
    const a = h * h, w = vt > 1e-6 ? (SPIN_K * vt * ft) / RADIUS : 0, wx = vt > 1e-6 ? (vz / vt) * w : 0, wz = vt > 1e-6 ? (-vx / vt) * w : 0;
    let foot = Infinity;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3, rx = x[i3] - mx, ry = x[i3 + 1] - my, rz = x[i3 + 2] - mz;
      p[i3] += nx * F * a; p[i3 + 1] += ny * F * a; p[i3 + 2] += nz * F * a;
      p[i3] -= (vx * ft * a) / h; p[i3 + 2] -= (vz * ft * a) / h;
      // (ω × r, for this small step)
      p[i3] += -wz * ry * h; p[i3 + 1] += (wz * rx - wx * rz) * h; p[i3 + 2] += wx * ry * h;
      if (bw[i] > 0) { const y = p[i3 + 1] - SKIN - restAt(j, p[i3] - j.cx, p[i3 + 2] - j.cz); if (y < foot) foot = y; }
    }
    // (its top held to its foot as it is now, pushed: just touching)
    holdJel(j, cx, cz, rf, Math.max(1e-4, -foot - BED_SKIN), vy + F * h);
    // (in it: its foot's on it, as on any floor)
    for (let i = 0; i < n; i++) if (bw[i] > 0) this.bedFoot++;
  }

  /** A frame: SUB small steps of falling, keeping its shape, meeting the course, friction and tack. */
  step(lv: Level, dt: number, time: number) {
    const n = this.n, h = dt / SUB;
    const { x, v, p, cn, cd, cmu, cb, cvs, cv0, cf, ctk, ctr, ccr, cdust, crail, coat, coatKind } = this;
    let railOn: Shape | null = null, railPins = 0;
    const w0 = 2 * Math.PI * this.phys.hz;
    const alpha = Math.min(0.5, (w0 * h) ** 2);
    const damp = 2 * this.phys.zeta * w0 * h;
    const speed = Math.hypot(...this.vcom);
    near(lv, this.com, RADIUS * 1.8 + speed * dt + 1, this.nearby);
    const o = this.hit;
    // (a landing into something dusty: where, how hard, and what)
    let spN = 0, spX = 0, spY = 0, spZ = 0, spK = 0, spV = 0;
    let contacts = 0, wall = false, impact = 0, nyS = 0, floor = 0, held = 0, onHoney = false, tire = 1, pinnedS = 0, fx = 0, fy = 0, fz = 0;
    let footX = 0, footY = 0, footZ = 0, footN = 0, bedS = 0;
    const tackOn = this.sinceFlick > 0.12 && !this.climb;
    let wx = 0, wz = 0;
    // the spin's say on landing: topspin lets the roll live and eases the grip; backspin grips and holds at once
    const top = Math.max(0, this.spinMode) * this.spinLeft, back = Math.max(0, -this.spinMode) * this.spinLeft;
    const muK = 1 - 0.65 * top + 2.2 * back, tackK = 1 + 3 * back, rollK = 1 - 0.85 * top + 4.5 * back;
    for (let s = 0; s < SUB; s++) {
      const t = time + s * h;
      if (lv.movers.length) moveShapes(lv, t);
      if (lv.jellies) for (const jl of lv.jellies) stepJel(jl.jel!, t);
      for (let i = 0; i < n * 3; i++) {
        if (i % 3 === 1) v[i] -= G * h;
        p[i] = x[i] + v[i] * h;
      }
      this.match(p, alpha * (1 - LIMP * this.limp));
      // (held: the dough under the finger drawn out toward it, from where the shape would have it)
      if (this.grab) this.pullOut(p, this.grab.w, this.grab.pull);
      this.keepVolume(p);
      // (on a jelly: it gives under the whole of it, as a bed)
      this.bedFoot = 0;
      if (lv.jellies) for (const sh of this.nearby) if (sh.jel) this.bed(sh.jel, sh.mu, p, h);
      contacts += this.bedFoot; floor += this.bedFoot; nyS += this.bedFoot; fy += this.bedFoot; bedS += this.bedFoot;
      // each particle against the course
      for (let i = 0; i < n; i++) {
        cf[i] = 0; cd[i] = 0;
        const i3 = i * 3;
        // (held to a rail: it doesn't peel off as the rest droops or swings, but is kept touching it, until it's flicked off)
        const gr = this.railHold[i];
        if (gr && !tackOn) this.railHold[i] = null;
        else if (gr) {
          const ax = railAxis(gr), L = Math.hypot(gr.b[0] - gr.c[0], gr.b[1] - gr.c[1], gr.b[2] - gr.c[2]);
          const s = Math.max(0, Math.min(L, (p[i3] - gr.c[0]) * ax[0] + (p[i3 + 1] - gr.c[1]) * ax[1] + (p[i3 + 2] - gr.c[2]) * ax[2]));
          const qx = p[i3] - gr.c[0] - ax[0] * s, qy = p[i3 + 1] - gr.c[1] - ax[1] * s, qz = p[i3 + 2] - gr.c[2] - ax[2] * s, d = Math.hypot(qx, qy, qz), want = gr.r + SKIN;
          if (d > want && d > 1e-6) { const k = want / d - 1; p[i3] += qx * k; p[i3 + 1] += qy * k; p[i3 + 2] += qz * k; }
        }
        for (const sh of this.nearby) {
          // (a rail it's just been flicked off: let go of, it slides off it, not snagged)
          if (this.sinceFlick < RAIL_LET && (sh.rail || this.letGo?.has(sh))) continue;
          if (!touch(sh, p[i3], p[i3 + 1], p[i3 + 2], SKIN, o, STICK)) continue;
          if (o.d > 0) {
            p[i3] += o.nx * o.d; p[i3 + 1] += o.ny * o.d; p[i3 + 2] += o.nz * o.d;
            const vn = (v[i3] - o.vx) * o.nx + (v[i3 + 1] - o.vy) * o.ny + (v[i3 + 2] - o.vz) * o.nz;
            if (cf[i] !== 1 || o.d > cd[i]) {
              cn[i3] = o.nx; cn[i3 + 1] = o.ny; cn[i3 + 2] = o.nz;
              cmu[i] = sh.mu; cb[i] = sh.bounce; cvs[i3] = o.vx; cvs[i3 + 1] = o.vy; cvs[i3 + 2] = o.vz; cv0[i] = vn; ctk[i] = gripOf(sh, o, v, i3); ctr[i] = sh.tire; ccr[i] = sh.creep ?? 0; cdust[i] = sh.dust; crail[i] = sh.rail ? sh : null;
              if (o.ny < 0.5 && sh.tire < tire) tire = sh.tire;
            }
            cd[i] += o.d;
            cf[i] = 1;
          } else if (cf[i] === 0) {
            cn[i3] = o.nx; cn[i3 + 1] = o.ny; cn[i3 + 2] = o.nz;
            cmu[i] = sh.mu; cb[i] = 0; cvs[i3] = o.vx; cvs[i3 + 1] = o.vy; cvs[i3 + 2] = o.vz; cv0[i] = 0; ctk[i] = gripOf(sh, o, v, i3); ctr[i] = sh.tire; ccr[i] = sh.creep ?? 0; cdust[i] = sh.dust; crail[i] = sh.rail ? sh : null;
            if (o.ny < 0.5 && sh.tire < tire) tire = sh.tire;
            cf[i] = 2;
          }
        }
      }
      // its middle against the course, as a ball (so no edge spears it between particles)
      {
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < n; i++) { cx += p[i * 3]; cy += p[i * 3 + 1]; cz += p[i * 3 + 2]; }
        cx /= n; cy /= n; cz /= n;
        // (not into a jelly it's in: the bed has it)
        // (nor a rail it's hanging from, or just let go of: what holds it is round it)
        for (const sh of this.nearby) if (!sh.jel?.held && !((sh.rail && this.onRail) || (this.sinceFlick < RAIL_LET && (sh.rail || this.letGo?.has(sh)))) && touch(sh, cx, cy, cz, RADIUS * 0.5, o) && o.d > 0) {
          for (let i = 0; i < n; i++) { p[i * 3] += o.nx * o.d; p[i * 3 + 1] += o.ny * o.d; p[i * 3 + 2] += o.nz * o.d; }
          cx += o.nx * o.d; cy += o.ny * o.d; cz += o.nz * o.d;
        }
      }
      // velocities from where they went; friction, bounce and tack where they touch
      // (shimmying along a rail: what's held to it slides along it so far this small step, the rest drawn after, as
      // it hangs; short of either end, where it stops)
      let sdx = 0, sdy = 0, sdz = 0;
      const sr = this.shim?.rail ?? null;
      if (this.shim && sr) {
        const ax = railAxis(sr), L = Math.hypot(sr.b[0] - sr.c[0], sr.b[1] - sr.c[1], sr.b[2] - sr.c[2]);
        const s0 = (this.com[0] - sr.c[0]) * ax[0] + (this.com[1] - sr.c[1]) * ax[1] + (this.com[2] - sr.c[2]) * ax[2];
        const ds = this.shim.dir * Math.min(this.shim.left, SHIM_V * h);
        // (short of either end: never on past it; but in from it, if it's caught on the end)
        if ((ds < 0 && s0 + ds < SHIM_END) || (ds > 0 && s0 + ds > L - SHIM_END)) this.shim = null;
        else { sdx = ax[0] * ds; sdy = ax[1] * ds; sdz = ax[2] * ds; if ((this.shim.left -= Math.abs(ds)) <= 1e-6) this.shim = null; }
      }
      // (shuffling along an edge: the whole of it slid along, its grip kept)
      let ex = 0, ez = 0;
      if (this.edgeShim) {
        const ds = Math.min(this.edgeShim.left, SHIM_V * h);
        ex = this.edgeShim.t[0] * ds; ez = this.edgeShim.t[2] * ds;
        if ((this.edgeShim.left -= ds) <= 1e-6) this.edgeShim = null;
        // (moved, not set going: where it was moves with it)
        for (let i = 0; i < n; i++) { p[i * 3] += ex; p[i * 3 + 2] += ez; x[i * 3] += ex; x[i * 3 + 2] += ez; }
      }
      let vx = 0, vy = 0, vz = 0, pinned = 0;
      for (let i = 0; i < n; i++) {
        const i3 = i * 3;
        const was = this.pin[i];
        this.pin[i] = 0;
        let nvx = (p[i3] - x[i3]) / h, nvy = (p[i3 + 1] - x[i3 + 1]) / h, nvz = (p[i3 + 2] - x[i3 + 2]) / h;
        if (cf[i]) {
          const nx = cn[i3], ny = cn[i3 + 1], nz = cn[i3 + 2], sx = cvs[i3], sy = cvs[i3 + 1], sz = cvs[i3 + 2];
          let rx = nvx - sx, ry = nvy - sy, rz = nvz - sz;
          let vn = rx * nx + ry * ny + rz * nz;
          let tx = rx - nx * vn, ty = ry - ny * vn, tz = rz - nz * vn;
          let dvn = cf[i] === 1 ? cd[i] / h : 0;
          // what it's coated with here has its say: flour grips and is dry; butter slips, and honey won't hold it; crumbs bounce; sprinkles are sticky
          const ck = coat[i], kind = coatKind[i];
          let mu = cmu[i], tk0 = ctk[i], bn = cb[i], honeyed = false;
          if (ck > 0.05) {
            if (kind === DUST.flour) { mu *= 1 + 0.6 * ck; tk0 *= 1 - ck; }
            else if (kind === DUST.butter) { mu *= 1 - 0.75 * ck; tk0 *= Math.max(0, 1 - 2.5 * ck); }
            else if (kind === DUST.crumbs) { bn = Math.max(bn, 1.6 * ck); mu *= 1 + 0.3 * ck; }
            else if (kind === DUST.sprinkles) { if (tk0 <= 1) tk0 += 1.2 * ck; }
            // (honey on it: whatever it touches, it sticks to, a while, oozing down a side; glass and steel as well as wood)
            else if (kind === DUST.honey) { tk0 = Math.max(tk0, 1 + 1.6 * ck); honeyed = ck > 0.25; }
          }
          // (a hold that tires, linen's, sugar's, tires as its own tack does; honey's never)
          if (tk0 > 1 && ctr[i] > 0) tk0 = 1 + (tk0 - 1) * this.grip;
          // (and it picks up what's there, as it touches)
          if (cf[i] === 1 && cdust[i]) {
            const on = DUSTS[cdust[i] as Dust].on * h;
            if (coatKind[i] !== cdust[i]) { if (coat[i] < on * 4) { coatKind[i] = cdust[i]; coat[i] = Math.min(1, coat[i] * 0.5 + on); } }
            else coat[i] = Math.min(1, coat[i] + on);
          }
          // (what holds by itself, as honey does, a towel's linen, a knife block's wood: the surface's own tack, never
          // what a coating's added; sprinkles make it stickier where it touches, they don't make a jelly into honey)
          const holds = (ctk[i] > 1 || honeyed) && tk0 > 1;
          // (touching; or held by honey, which is as good as)
          if (cf[i] === 1 || (holds && tackOn)) {
            contacts++; nyS += ny; if (ny > 0.5) { floor++; fx += nx; fy += ny; fz += nz; footX += p[i3]; footY += p[i3 + 1]; footZ += p[i3 + 2]; footN++; }
            if (tk0 > held) held = tk0;
            if (ctk[i] > 1 && ctr[i] === 0) onHoney = true;
            if (ny < 0.5) { wall = true; wx += nx; wz += nz; }
          }
          if (cf[i] === 1) {
            // (what's held to a rail, drawn against it, isn't a landing)
            if (!this.railHold[i] && -cv0[i] > impact) impact = -cv0[i];
            this.pressNow[i] = Math.max(this.pressNow[i], PRESS_REST + (1 - PRESS_REST) * Math.min(1, Math.max(0, -cv0[i]) / PRESS_HARD));
            if (cdust[i] && -cv0[i] > 60) { spN++; spX += p[i3]; spY += p[i3 + 1]; spZ += p[i3 + 2]; spK = cdust[i]; spV = Math.max(spV, -cv0[i]); }
            if (bn > 0 && cv0[i] < -40) vn = Math.max(vn, -cv0[i] * bn);
          }
          // (dough's tack: drawn to what it touches, unless it's leaving it fast)
          // (its own tack, which tires; honey's, which doesn't)
          const tk = tk0 > 1 ? tk0 : this.tack * tk0;
          if (tackOn && tk > 0 && vn < 60) { const a = TACK * this.phys.tack * tk * tackK * h; vn -= a; dvn += a; }
          // (climbing: it slides up a wall, hardly gripping; and as it's flicked off something, nothing snags it and tips it over)
          // (as it slides along what it's on, before friction has its say: what a hold lets creep)
          const ux = tx, uy = ty, uz = tz;
          const tm = Math.hypot(tx, ty, tz), lim = mu * muK * dvn * (this.climb && Math.abs(ny) < 0.5 ? 0.05 : this.sinceFlick < LEAVE ? 0.1 : 1);
          const k = tm <= lim ? 0 : 1 - lim / tm;
          // (what friction takes out of its sliding it takes out of where it went, too: else what the
          // shape's pull moves along a slope each step would stay moved, and it would creep downhill)
          if (cf[i] === 1 && k < 1) { const f = (1 - k) * h; p[i3] -= tx * f; p[i3 + 1] -= ty * f; p[i3 + 2] -= tz * f; }
          tx *= k; ty *= k; tz *= k;
          // (honey holds the splat: what touches it as it lands, and goes on holding that; dough that sags onto it later only sticks)
          if (holds && tackOn && (was || this.honeyT < SPLAT)) {
            // (honey: what touches it is held where it touched, so a splat against it hangs there until it's flicked)
            // (it stays put, but for being pushed out of the honey's surface; nothing draws it off. Or held but creeping:
            // honey oozes, wood lets go slowly; down the side as it's drawn down, no faster than the hold allows)
            const cr = crail[i] ? 0 : Math.max(ccr[i], honeyed ? 2 : 0), um = Math.hypot(ux, uy, uz), cf2 = cr > 0 && um > 1e-6 ? Math.min(1, cr / um) : 0;
            tx = ux * cf2; ty = uy * cf2; tz = uz * cf2;
            const sl = sr && crail[i] === sr ? 1 : 0;
            p[i3] = x[i3] + nx * cd[i] + sdx * sl + tx * h; p[i3 + 1] = x[i3 + 1] + ny * cd[i] + sdy * sl + ty * h; p[i3 + 2] = x[i3 + 2] + nz * cd[i] + sdz * sl + tz * h;
            if (crail[i]) { railOn = crail[i]; railPins++; this.railHold[i] = crail[i]; }
            vn = Math.min(vn, 0);
            pinned++; this.pin[i] = 1;
          }
          nvx = sx + nx * vn + tx; nvy = sy + ny * vn + ty; nvz = sz + nz * vn + tz;
        }
        v[i3] = nvx; v[i3 + 1] = nvy; v[i3 + 2] = nvz;
        x[i3] = p[i3]; x[i3 + 1] = p[i3 + 1]; x[i3 + 2] = p[i3 + 2];
        vx += nvx; vy += nvy; vz += nvz;
      }
      vx /= n; vy /= n; vz /= n;
      // (held by honey: the whole of it slowed, hard, so what's still going doesn't tear it off the patch that's stuck)
      if (pinned > 4) { const k = 1 - Math.min(1, HONEY_DRAG * h); for (let i = 0; i < n * 3; i++) v[i] *= k; vx *= k; vy *= k; vz *= k; }
      pinnedS += pinned; this.pinned = pinned;
      // its wobble damped: each particle's velocity drawn toward the body's own (its middle's, and
      // its turning); and on the ground, its roll dies (dough plops, and stays)
      this.dampWobble(vx, vy, vz, damp, contacts > 0 && this.sinceFlick > 0.12 ? ROLL * h * rollK : 0);
      // (climbing: on the wall, sliding up; then off its top, carried in over it; or falling back, given up)
      if (this.climb) {
        let onWall = false;
        for (let i = 0; i < n; i++) if (cf[i] === 1 && Math.abs(cn[i * 3 + 1]) < 0.5) { onWall = true; break; }
        const c = this.climb;
        // (clear of the wall: off it for a moment together, not between one small step and the next)
        if (onWall) { c.on = true; c.off = 0; if (vy < -30) this.climb = null; }
        else if ((c.off += h) >= CLIMB_CLEAR) {
          for (let i = 0; i < n; i++) { v[i * 3] -= c.n[0] * CLIMB_IN; v[i * 3 + 2] -= c.n[2] * CLIMB_IN; }
          this.climb = null;
        }
      }
    }
    // how hard each is pressed: at once as it's pressed, let go of quickly
    { const keep = Math.exp(-dt / PRESS_LET), pn = this.pressNow, pr = this.press;
      for (let i = 0; i < n; i++) { pr[i] = Math.max(pn[i], pr[i] * keep); pn[i] = 0; } }
    // the middle, the speed, and how it's touching
    let cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
    for (let i = 0; i < n; i++) { cx += x[i * 3]; cy += x[i * 3 + 1]; cz += x[i * 3 + 2]; vx += v[i * 3]; vy += v[i * 3 + 1]; vz += v[i * 3 + 2]; }
    this.com = [cx / n, cy / n, cz / n];
    this.vcom = [vx / n, vy / n, vz / n];
    // (its drift: how its middle has actually moved, smoothed; not its particles' speeds, which a body wedged and quivering keeps up while going nowhere)
    const dk = 1 - Math.exp(-dt * 5), was = this.comWas;
    for (let i = 0; i < 3; i++) this.drift[i] += ((this.com[i] - was[i]) / dt - this.drift[i]) * dk;
    this.comWas = [...this.com] as V3;
    this.contacts = Math.round(contacts / SUB);
    this.onWall = wall;
    this.groundNy = contacts > 0 ? nyS / contacts : 1;
    { const l = Math.hypot(wx, wz); this.wallN = l > 1e-6 ? [wx / l, 0, wz / l] : [0, 0, 0]; }
    this.onFloor = contacts > 0 ? floor / contacts : 1;
    // (on its feet: its middle over what of it is on a floor, and above it; in a jelly's bed, it is)
    if (footN > 0) this.foot = [footX / footN, footY / footN, footZ / footN];
    this.onFeet = bedS > 0 || (footN > 0 && Math.hypot(this.com[0] - this.foot[0], this.com[2] - this.foot[2]) < RADIUS * 0.75 && this.com[1] > this.foot[1] + 0.8);
    if (!this.onEdge) this.edgeShim = null;
    {
      const l = Math.hypot(fx, fy, fz);
      this.upTo = l > 0 && fy / l > 0.75 ? [fx / l, fy / l, fz / l] : [0, 1, 0];
    }
    this.held = held;
    this.pinned = Math.round(pinnedS / SUB);
    // (hanging from a rail: most of what's held, held by it)
    this.onRail = this.pinned > 4 && railPins / SUB > this.pinned * 0.5 ? railOn : null;
    if (!this.onRail) this.shim = null;
    // (from when it first touched the honey, however coated: a buttered splat doesn't take, and butter wearing off later doesn't make it)
    this.honeyT = onHoney ? (this.honeyT < 0 ? 0 : this.honeyT + dt) : -1;
    // (limp while it hangs, held by its side: by honey, by linen's grip; not when it's only up against a wall, or half off an edge)
    const hanging = this.pinned > 4;
    this.limp += ((hanging ? 1 : 0) - this.limp) * (1 - Math.exp(-dt * (hanging ? 5 : 8)));
    // the coatings wear off in time; a hard landing shakes some off; pepper brings on a sneeze
    this.shook = DUST.none; this.sneezed = false;
    const sums = new Array(DUSTS_N).fill(0);
    // (landed hard in it, it splashes up its sides, as far as it came down hard: so it's seen, and not only underneath)
    if (spN > 0) {
      const sx = spX / spN, sy = spY / spN, sz = spZ / spN, R = Math.min(RADIUS * 1.5, 1.5 + spV / 110), k0 = 0.7 * Math.min(1, spV / 220);
      for (let i = 0; i < n; i++) {
        const dd = Math.hypot(x[i * 3] - sx, x[i * 3 + 1] - sy, x[i * 3 + 2] - sz);
        if (dd >= R) continue;
        const a = k0 * (1 - dd / R);
        if (coatKind[i] !== spK) { if (coat[i] > a) continue; coatKind[i] = spK; coat[i] = 0; }
        coat[i] = Math.min(1, coat[i] + a);
      }
    }
    // (a hard landing shakes off what's on it, but not what it's just landed in)
    const shake = impact > 150 && spN === 0 ? Math.min(1, (impact - 150) / 250) : 0;
    for (let i = 0; i < n; i++) {
      if (coat[i] <= 0) continue;
      const k = coatKind[i] as Dust, d = DUSTS[k];
      coat[i] = Math.max(0, coat[i] - d.off * dt - d.shake * shake * coat[i]);
      if (shake > 0.2 && d.shake > 0 && coat[i] > 0.2) this.shook = k;
      if (coat[i] <= 0) coatKind[i] = 0; else sums[k] += coat[i];
    }
    this.coated = sums.map((v) => v / n);
    let most: Dust = DUST.none, mostV = 0.01;
    for (let k = 1; k < DUSTS_N; k++) if (this.coated[k] > mostV) { mostV = this.coated[k]; most = k as Dust; }
    this.coatMost = most;
    if (this.coated[DUST.pepper] > 0.02) {
      this.sneeze += dt * (0.2 + 2 * this.coated[DUST.pepper]);
      if (this.sneeze >= 1 && contacts > 0) {
        // (achoo: a hop, any way, and the pepper's off it)
        this.sneeze = 0; this.sneezed = true;
        // (which way: from the moment, so a run played again sneezes the same way)
        const a = (((Math.sin(time * 91.7 + lv.n * 12.9898) * 43758.5453) % 1) + 1) % 1 * Math.PI * 2;
        this.flick([Math.cos(a) * 22, 85, Math.sin(a) * 22], 0);
        this.sinceFlick = 0.2;
        for (let i = 0; i < n; i++) if (coatKind[i] === DUST.pepper) { coat[i] = 0; coatKind[i] = 0; }
        this.coated[DUST.pepper] = 0;
      }
    } else this.sneeze = Math.max(0, this.sneeze - dt * 0.5);
    if (contacts > 0 && this.sinceFlick > 0.12) this.spinLeft = Math.max(0, this.spinLeft - dt * 1.5);
    this.impact = impact;
    this.sinceContact = contacts > 0 ? 0 : this.sinceContact + dt;
    this.sinceFlick += dt;
    // tack tires on a wall (not on honey); comes back in the air and on the flat
    if (wall && this.onFloor < 0.3) { this.tack = Math.max(0, this.tack - dt * 0.9 * tire); this.grip = Math.max(0, this.grip - dt * tire); }
    else if (contacts === 0 || this.sinceFlick > 0.3) this.tack = Math.min(1, this.tack + dt * 1.5);
    // (and fills again on its feet on something, not while it's still against a side)
    if (contacts > 0 && this.onFloor > 0.5 && !wall) this.grip = Math.min(1, this.grip + dt * 1.5);
    // (on the flat it sorts itself out; stuck to a wall it hangs as it is)
    this.shuffle(dt, contacts > 0 && this.onFloor > 0.25);
  }
  /**
   * Sat still, it sorts itself out, as a roly-poly would, by little hops rather than against the
   * friction under it: tipped over (on its side, its shoulder, its head), it rolls itself back
   * up onto its bottom; upright, it shuffles round to look where it's asked to (its face is its
   * rest shape's +z). The whole of it turned a little about its middle.
   */
  private shuffle(dt: number, grounded: boolean) {
    const R = this.R, look = this.look;
    if (!grounded || this.sinceFlick < 0.4 || Math.hypot(...this.vcom) > 20) return;
    const ux = R[1], uy = R[4], uz = R[7], [gx, gy, gz] = this.upTo;
    const along = ux * gx + uy * gy + uz * gz;
    if (along < SHUFFLE_UP) {
      // (back up, to the up of what it's on: about the line square to the way it leans; on its head, any such line)
      let ax = uy * gz - uz * gy, ay = uz * gx - ux * gz, az = ux * gy - uy * gx;
      const l = Math.hypot(ax, ay, az);
      if (l < 1e-3) { ax = R[0]; ay = R[3]; az = R[6]; } else { ax /= l; ay /= l; az /= l; }
      const off = Math.acos(Math.max(-1, Math.min(1, along)));
      // (rolled over the edge on its bottom's side, as a thing tipped over rolls back: not turned
      // about its middle, nor about the middle of where it's touching, either of which drives one
      // of the things it's resting on into the ground)
      let lx = ux - gx * along, ly = uy - gy * along, lz = uz - gz * along;
      const ll = Math.hypot(lx, ly, lz);
      if (ll > 1e-3) { lx /= ll; ly /= ll; lz /= ll; } else { lx = 0; ly = 0; lz = 0; }
      const lean = (i: number) => (this.x[i * 3] - this.com[0]) * lx + (this.x[i * 3 + 1] - this.com[1]) * ly + (this.x[i * 3 + 2] - this.com[2]) * lz;
      let best = Infinity;
      for (let i = 0; i < this.n; i++) if (this.cf[i] === 1) best = Math.min(best, lean(i));
      let px = 0, py = 0, pz = 0, m = 0;
      for (let i = 0; i < this.n; i++) {
        if (this.cf[i] !== 1 || lean(i) > best + 0.6) continue;
        px += this.x[i * 3]; py += this.x[i * 3 + 1]; pz += this.x[i * 3 + 2]; m++;
      }
      const pivot: V3 | undefined = m ? [px / m, py / m, pz / m] : undefined;
      this.turn([ax, ay, az], Math.min(off * 4, UPRIGHT) * dt, pivot, true);
      return;
    }
    if (!look) return;
    const fx = R[2], fz = R[8];
    const a = Math.atan2(fx * look[2] - fz * look[0], fx * look[0] + fz * look[2]);
    this.turn([0, 1, 0], -Math.sign(a) * Math.min(Math.abs(a) * 5, TURN) * dt);
  }
  /** The whole of it turned by th about an axis through its middle (or another point), and calmed if asked: its particles, their velocities, and its turn as last matched. */
  private turn(k: V3, th: number, about: V3 = this.com, calm = false) {
    if (Math.abs(th) < 1e-5) return;
    const c = Math.cos(th), s = Math.sin(th), [cx, cy, cz] = about, x = this.x, v = this.v;
    const rot = (a: Float32Array, i3: number, ox: number, oy: number, oz: number) => {
      const px = a[i3] - ox, py = a[i3 + 1] - oy, pz = a[i3 + 2] - oz;
      const d = (k[0] * px + k[1] * py + k[2] * pz) * (1 - c);
      const kx = k[1] * pz - k[2] * py, ky = k[2] * px - k[0] * pz, kz = k[0] * py - k[1] * px;
      a[i3] = ox + px * c + kx * s + k[0] * d; a[i3 + 1] = oy + py * c + ky * s + k[1] * d; a[i3 + 2] = oz + pz * c + kz * s + k[2] * d;
    };
    for (let i = 0; i < this.n; i++) { rot(x, i * 3, cx, cy, cz); rot(v, i * 3, 0, 0, 0); }
    // (calm: what turning it had of its own is let go, so it isn't falling back the way it came)
    if (calm) for (let i = 0; i < this.n * 3; i++) v[i] = this.vcom[i % 3];
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < this.n; i++) { mx += x[i * 3]; my += x[i * 3 + 1]; mz += x[i * 3 + 2]; }
    this.com = [mx / this.n, my / this.n, mz / this.n];
    const h = Math.sin(th / 2), dq = [k[0] * h, k[1] * h, k[2] * h, Math.cos(th / 2)];
    for (const q of [this.quat, ...this.patches.map((pt) => pt.quat)]) {
      const nq = qmul(dq, q);
      q[0] = nq[0]; q[1] = nq[1]; q[2] = nq[2]; q[3] = nq[3];
    }
    qmat(this.quat, this.R);
    for (const pt of this.patches) qmat(pt.quat, pt.R);
  }
  /** Damp what isn't the body moving as one: each particle's velocity drawn toward its middle's and its turning. */
  private dampWobble(vx: number, vy: number, vz: number, c: number, roll: number) {
    const n = this.n, x = this.x, v = this.v;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += x[i * 3]; cy += x[i * 3 + 1]; cz += x[i * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    // angular momentum and inertia about the middle; its turning ω = I⁻¹ L
    let lx = 0, ly = 0, lz = 0;
    const I = new Float64Array(9);
    for (let i = 0; i < n; i++) {
      const rx = x[i * 3] - cx, ry = x[i * 3 + 1] - cy, rz = x[i * 3 + 2] - cz;
      const ux = v[i * 3] - vx, uy = v[i * 3 + 1] - vy, uz = v[i * 3 + 2] - vz;
      lx += ry * uz - rz * uy; ly += rz * ux - rx * uz; lz += rx * uy - ry * ux;
      const r2 = rx * rx + ry * ry + rz * rz;
      I[0] += r2 - rx * rx; I[1] -= rx * ry; I[2] -= rx * rz; I[4] += r2 - ry * ry; I[5] -= ry * rz; I[8] += r2 - rz * rz;
    }
    I[3] = I[1]; I[6] = I[2]; I[7] = I[5];
    const Ii = new Float64Array(9);
    inv3(I, Ii);
    const wx = Ii[0] * lx + Ii[1] * ly + Ii[2] * lz, wy = Ii[3] * lx + Ii[4] * ly + Ii[5] * lz, wz = Ii[6] * lx + Ii[7] * ly + Ii[8] * lz;
    // (on the ground: its turning drawn toward the turn that rights it, its own up toward the
    // world's; so a roll dies, and it settles on its flat bottom, face out)
    const k = Math.min(1, roll);
    // (righted toward what it's stood on: a floor's up, a ramp's)
    // (not for a small lean: on a slope it sags a little downhill, and righting that would set it crawling)
    const ux = this.R[1], uy = this.R[4], uz = this.R[7], [gx, gy, gz] = this.upTo;
    const ax = uy * gz - uz * gy, ay = uz * gx - ux * gz, az = ux * gy - uy * gx;
    const sinT = Math.hypot(ax, ay, az), dead = Math.min(1, Math.max(0, (sinT - LEAN0) / (LEAN1 - LEAN0)));
    const K = k > 0 ? RIGHT * dead * dead * (3 - 2 * dead) : 0;
    const tx = K * ax, ty = K * ay, tz = K * az;
    const tilt = sinT;
    // (upside down the axis is lost: any way over will do)
    const ex = (ux * gx + uy * gy + uz * gz < 0 && tilt < 0.3 ? RIGHT : tx) - wx, ey = ty - wy, ez = tz - wz;
    for (let i = 0; i < n; i++) {
      const rx = x[i * 3] - cx, ry = x[i * 3 + 1] - cy, rz = x[i * 3 + 2] - cz;
      const gx = vx + wy * rz - wz * ry, gy = vy + wz * rx - wx * rz, gz = vz + wx * ry - wy * rx;
      v[i * 3] -= (v[i * 3] - gx) * c; v[i * 3 + 1] -= (v[i * 3 + 1] - gy) * c; v[i * 3 + 2] -= (v[i * 3 + 2] - gz) * c;
      if (k > 0) { v[i * 3] += (ey * rz - ez * ry) * k; v[i * 3 + 1] += (ez * rx - ex * rz) * k; v[i * 3 + 2] += (ex * ry - ey * rx) * k; }
    }
  }
}
/** a rail's way along (from its first end to its second), of length 1 */
export function railAxis(r: Shape): V3 {
  const dx = r.b[0] - r.c[0], dy = r.b[1] - r.c[1], dz = r.b[2] - r.c[2], l = Math.hypot(dx, dy, dz) || 1;
  return [dx / l, dy / l, dz / l];
}

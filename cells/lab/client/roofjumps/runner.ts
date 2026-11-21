/**
 * Roof Jumps' runner: the body as a point with a velocity, and the judgement that makes the running effortless.
 *
 * The only input is a direction (and, optionally, a jump). Everything else is the runner's own: at an edge, a step or
 * a wall it looks along the way it's going, finds where it can next stand, and throws itself there on an arc worked
 * out to land it (`leap`). What it throws is chosen by what's in front of it, so no two crossings in a row are the
 * same thing:
 *
 *   vault    over clutter and rims, where there's an edge to put a hand on: lower and quicker still
 *   hop      the same with nothing to hold: a hurdle
 *   bound    a gap at about this height: flat and fast, the legs split
 *   flip     over a tall obstacle, or on a second tap in flight
 *   spring   up a storey: steep, the arms thrown up, a crouch on top
 *   dive     down a storey or so: headfirst, and rolled out of
 *   glide    a long way across or a long way down: the slow one, arms out, steerable
 *
 * On the ground it runs, sprints, bursts into a dash off a clean landing with room ahead, rolls out of a dive or a
 * hard landing, and balances along anything narrow (a rim, a wall across an alley), drawn to its line. In the air a
 * wall alongside is run along, tilted off it, and kicked away from, wall to wall down an alley; a deliberate jump into a wall can plant on it and catch a reachable lip.
 *
 * What its hands do is the city's to offer (city.ts: the holds). A mantle fixes the hands on a real roof edge while the hips rise beneath it. Over a unit one is planted on
 * its edge. Landing a storey up, both come down on the lip. Along a wall the near one trails on it; out of a dive both
 * go to the ground; a deep landing is three-pointed. `reach` is where each hand wants to be: the rig takes it there.
 *
 * Its states (`state`), each a method of its own: ground (running, loading a takeoff, landing in its legs), air (a flight:
 * a leap, a fall, a glide while the jump is held), wall (running along one), plant (a foot put on a wall it jumped at,
 * driving up off it), chimney (up a narrow alley between two walls, kicking from one to the other), climb (hands on a hold: pulling over a lip, or hanging from a sill on the way up a face, loading,
 * and springing for the next: a chain, as up a fire escape). A move that misses its landing falls: it catches a lip in
 * reach, or comes down and rolls. It glides only while the jump is held.
 *
 * No DOM, no drawing: it asks the city for heights, and keeps what the rig needs to pose a figure (`move`, how far
 * through it, the stride, the leading leg, the wall's side, the landing's weight).
 */
import type { City, Hold } from './city';
import { bodyOf, characterByName } from './character';
import type { Body as Build, Character } from './character';
import { TUNE } from './tune';

/** a direction; a jump tapped; and the jump held (to glide) */
export interface Input { x: number; z: number; jump: boolean; hold?: boolean }

export type Move = 'kick' | 'run' | 'dash' | 'ledge' | 'roll' | 'vault' | 'hop' | 'bound' | 'flip' | 'spring' | 'dive' | 'glide' | 'fall' | 'climb' | 'hang' | 'wallrun' | 'chimney' | 'sideflip' | 'underbar' | 'swing';
export type State = 'ground' | 'air' | 'climb' | 'wall' | 'plant' | 'chimney' | 'swing';

type P3 = [number, number, number];
/** where each hand wants to be, if anywhere: a point in the world */
export interface Reach {
  hl?: P3; hr?: P3;
  /** and each foot, while it's planted; and which way what it's on faces (up, if not said) */
  fl?: P3; fr?: P3; fn?: P3;
}

/** what the rig reads of a body */
/** where a foot is in bearing the weight (see `Runner.footing`) */
export type ContactPhase = 'air' | 'touch' | 'accept' | 'push' | 'unload';
/** a foot's contact: its phase, where it's down, the way that surface faces, its share of the weight (0..1), how long down */
export interface Contact { phase: ContactPhase; p: P3; normal: P3; load: number; since: number }
const freeContact = (): Contact => ({ phase: 'air', p: [0, 0, 0], normal: [0, 1, 0], load: 0, since: 0 });
export interface Body {
  x: number; y: number; z: number; heading: number; speed: number; state: State; move: Move;
  /** how far through the move, 0..1 (a flight, a roll) */
  mu: number;
  wallPlant?: boolean; committed?: boolean; load?: number;
  /** seconds in the air (a glide's sway); a vault turned round on its hand (a palm spin) */
  airT?: number; palmSpin?: boolean; wheel?: boolean;
  /** off balance (to the figure's left +), and how fast it's going over; the effort left (1 fresh); the size of the wind-up
   * now loading (0..1); seconds since the start */
  balance?: number; balanceV?: number; stamina?: number; effort?: number; time?: number;
  /** a save being made: what went wrong ('short', 'wide', 'long'), how long since the landing, the catching side (1 the
   * figure's left); seconds to the ground in a flight; a flight's planned length; a hang's swing along the wall (m/s) */
  footing?: Record<'L' | 'R', Contact>; letGo?: (side: number) => void;
  reportShoe?: (side: number, p: [number, number, number]) => void;
  stanceFrac?: number; pushAlong?: number; pushAcross?: number; bounce?: number; vx?: number; vy?: number; vz?: number; roomAhead?: number; roomAway?: number; turnAhead?: number; hangT?: number; from?: string; inStep?: (side: number) => { from: [number, number, number]; to: [number, number, number]; k: number; off?: boolean } | null; wallPhase?: number; near?: number; against?: number; nextFoot?: { side: number; p: [number, number, number]; t: number } | null; stepOver?: number; gait?: { stance: number; flight: number }; stepLift?: number; shift?: number; saveKind?: string; saveT?: number; saveSide?: number; ttc?: number; flightT?: number; swing?: number; swingOut?: number; swingLine?: [number, number, number] | null; swingFoot?: { side: number; press: number } | null; pulling?: boolean; teeter?: number; precise?: boolean; swingFeet?: { ax: number; az: number; t: number } | null;
  /** hanging on the way up a face: 0 caught, 1 loading, 2 springing for the next hold */
  chainPhase?: number;
  phase: number; lead: number; land: number; turn: number; climbT: number; wallT: number;
  /** which side the wall is on, running along one: 1 the figure's +x, -1 the other */
  wallSide: number;
  reach: Reach;
}


/** how long a fall of `s` metres from rest takes: as anything falls, or gliding */
const fall = (s: number, float: boolean) => {
  s = Math.max(0, s);
  const G = TUNE.gravity, GF = TUNE.glideGravity, SINK = TUNE.sink;
  if (!float) return Math.sqrt((2 * s) / G);
  return s <= (SINK * SINK) / (2 * GF) ? Math.sqrt((2 * s) / GF) : SINK / GF + (s - (SINK * SINK) / (2 * GF)) / SINK;
};
/** a difference in height walked over without a thought (m) */
const STEP = 0.45;
/** the body's radius against walls (m) */
const R = 0.35;
const JUMP = 9.5;
/** a roll's length (s) */
const ROLL = 0.5;
const AXES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/** a running step (one foot to the other), by pace: 1.6 m at 6 m/s, 2.3 m at 10.5, 2.9 m at 14 (a sprinter's, so the
 * cadence is 3.8 to 4.8 steps a second, not a churn); and how far ahead of the body a foot comes down */
export const stepLen = (sp: number) => { const run = 0.55 + 0.17 * sp, t = walkToRun(sp); return t >= 1 ? run : (0.4 + 0.22 * sp) * (1 - t) + run * t; };
/** a walk's step is its own (0.62 m at 1 m/s, as people walk), not a slow run's: blended into the run's between 1.8 and
 * 2.6 m/s (0 walking, 1 running) */
export const walkToRun = (sp: number) => { const t = Math.max(0, Math.min(1, (sp - 1.8) / 0.8)); return t * t * (3 - 2 * t); };
const AHEAD = 0.25;
/** how far out to its own side a running foot is put: near the line the body runs on, as a runner's are (not under each hip) */
const TRACK = 0.04;
/** how far the body goes over a planted foot: from 0.25 m ahead where it lands (the knee about 20 degrees bent) to 0.5 m
 * behind where it pushes off on its toe (as bent again), about 45 degrees at its deepest */
const STANCE = 0.8;
/** below this (m/s) it's standing: both feet down where they belong under it, stepping only to keep them there */
const WALK = 0.35;
/** hanging from a hold: the feet this far below the hands (m); the catch settling, the least load, a spring for the next (s) */
const HANG = 2.05, CHAIN_CATCH = 0.12, CHAIN_LOAD = 0.18, CHAIN_SPRING = 0.32;
/** up a narrow alley: a kick from one wall to the other this long (s), off it this fast upward (m/s); no wider than (m) */
const TIC = 0.27, TIC_UP = 6.3, ALLEY = 3.2;
/** a lip caught: the hips swing in under it this long before anything's decided (s); pressed into a wall, braced this long
 * before it goes for it (s) */
const LIP_BEAT = 0.3, BRACE = 0.35, TEETER = 1.1, LEG = 1.0, LEAN_WAIT = 0.22;
/** the point of a level hold nearest (x, z) */
const onHold = (h: Hold, x: number, z: number): P3 => {
  const dx = h.bx - h.ax, dz = h.bz - h.az, t = Math.max(0, Math.min(1, ((x - h.ax) * dx + (z - h.az) * dz) / (dx * dx + dz * dz || 1)));
  return [h.ax + dx * t, h.ay, h.az + dz * t];
};

/** smoothstep of 0..1 */
const sm01 = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
export class Runner implements Body {
  x = 0; y = 0; z = 0; vx = 0; vy = 0; vz = 0;
  heading = 0; state: State = 'ground'; move: Move = 'run'; mu = 0;
  /** seconds of unbroken running: the sprint builds on it */
  runT = 0;
  /** the stride, in radians: one turn is two steps */
  phase = 0;
  airT = 0;
  /** how long this flight is meant to take (s) */
  flightT = 1;
  /** coming down slowly, this flight */
  float = false;
  /** which leg leads a leap: opposite the support foot at takeoff */
  lead = 0;
  /** compression of the supporting legs, 0..1 across 0.46 metres of travel */
  land = 0;
  climbT = 0; wallT = 0; wallSide = 0;
  /** a climb's way in over the hands: from where it hung or stood [x, z] to the wall's face [x, z] */
  climbIn: [number, number, number, number] | null = null;
  /** rate of turn (rad/s), smoothed: the lean into a bend */
  turn = 0;
  /** in a leap aimed at a landing: fine steering until the input turns decisively away */
  planned = false;
  /**
   * A takeoff, from a tap or the runner's own judgement, all in one place: the tap's window (s), how far the support
   * leg is loaded (0..1), whether it's committed to a jump (a tap's: it goes, and it plants on a wall it meets), and
   * which foot is the support. Begun on the ground; cleared, all of it, when it leaves the ground or lands (`resetTakeoff`).
   */
  private to = { buffer: 0, load: 0, committed: false, left: false };
  /**
   * The run-up to a takeoff the runner's going for: the foot it's to go from and where that foot's to be put, the steps
   * left before it, and how long they're being made. Planned at each footfall as the edge comes into view.
   */
  private approach: { side: number; at: P3 | null; steps: number; stretch: number } | null = null;
  /** how high the hips rise between footfalls (m): as far as a body carried over this step's flight goes (g t² / 8) */
  get bounce(): number { const sp = Math.max(2, this.speed), t = Math.max(0, ((this.stepTo || this.stepLenOf(sp) * this.stepScale) - this.stance_) / sp); return (TUNE.gravity * t * t) / 8; }
  get runUp(): { side: number; at: P3 | null; steps: number; stretch: number } | null { return this.approach; }
  /** how hard the stick's pressed (0..1), as last read */
  private mag = 0;
  /** takeoffs made off a run-up's planned foot */
  offFoot = 0;
  /** lips caught in the air by reaching for them (not met against the wall) */
  lipReached = 0;
  /** which way the last takeoff came about (a tap, a run-up's foot, an edge met, …) */
  takeoffBy = '';
  /** why there's no run-up, as last planned (or '' when there is one) */
  runUpWhy = '';
  get load(): number { return this.to.load; }
  set load(v: number) { this.to.load = v; }
  get committed(): boolean { return this.to.committed; }
  set committed(v: boolean) { this.to.committed = v; }
  /** a foot on a wall it jumped at (state 'plant') */
  get wallPlant(): boolean { return this.state === 'plant'; }
  wallSteps = 0;
  /** springs from hold to hold up a face; and seconds pressed into a wall in reach, before it goes for it */
  chains = 0; private press = 0;
  /** hanging from a hold on the way up a face: its height, what phase, how long in it, and where it springs from */
  private chain: { y: number; phase: number; t: number; y0: number; y1: number; next: number; dur?: number } | null = null;
  /** up a narrow alley: the way to the wall it started on (ax, az), a point on that wall's face, the faces apart, which
   * wall it's on (1 the first), how long since the last kick, how many, how far along the alley, and its pace along it */
  ch: { ax: number; az: number; ox: number; oz: number; gap: number; side: number; t: number; kicks: number; along: number; pace: number; foot?: P3 | null; footKick?: number } | null = null;
  chimneys = 0;
  /** a vault turned round on its hand; a held moment at the top of a flight (`apexHold`), and whether it's still rising; a
   * stuck landing on something narrow, the seconds it's still settling */
  palmSpin = false;
  /** a vault made as a cartwheel: over sideways on the hands, one after the other, the legs wide */
  wheel = false; private held = 0; private rising = false; private stickT = 0;
  /** balance: how far off it is (rad, to the figure's left +) and how fast it's going over; corrected like a spring */
  balance = 0; balanceV = 0; private prevTurn = 0;
  /** a landing's recovery still being paid (s); a heavy one's held frame owed at its deepest; how hard the last one was and
   * how long ago (the eye dips by it) */
  private recoverT = 0; private hitPending = false; impact = 0; impactT = 9;
  /** the whole body held a moment (the emphasis: a wind-up held at full load, a heavy landing at its deepest); whether the
   * wind-up now firing has had its hold */
  private freeze = 0; private tamed = false;
  /** effort left (1 fresh): big releases spend it, easy running gives it back; when it was last spent; the size of the
   * wind-up loading now */
  stamina = 1; private spentT = 9; effort = 0; time = 0;
  /** landings, by how they went */
  landings = { flow: 0, heavy: 0, off: 0 };
  /**
   * Imperfection, authored: a hard leap (a late turn, near its fastest, near its reach, spent) carries a small error, chosen
   * from what made it hard and checked to be saveable; landing off its mark (by that error, or by the air's steering, or
   * carrying too much speed into a turn), the save is a footfall: the catching foot put where the hips are actually going.
   * The leap's intended landing; the error authored; the save being made; the last one made (for the study and the tests).
   */
  aim: { x: number; z: number; ux: number; uz: number } | null = null;
  errorOf: { kind: string; e: number } | null = null; errors = 0;
  private save: { kind: 'short' | 'wide' | 'long'; ex: number; ez: number; mag: number; t: number; stage: number } | null = null;
  saves = 0; lastSave: { kind: string; err: number; foot: number } | null = null;
  /** the way it was last asked to go; seconds to the ground; the planned flight; settling strides owed after a landing */
  private want: [number, number] = [0, 0]; private launchWant: [number, number] = [0, 0]; ttc = 9; private breathT = 0;
  /** a hang's swing: along the wall (m, m/s), the dip (m, m/s), where it caught, the way along, the near hand (1 its left) */
  /**
   * Hanging from a lip by the hands: a pendulum under them. `s`, `v` along the wall (m, m/s); `o`, `ov` out from it (the hips
   * swung away from the face, never into it: the feet take that); `d`, `dv` up and down from the still hang (above it, falling
   * into the arms; below, the dip, caught). `x0, z0` the still hang's place, moving along the lip with a shimmy; `tx, tz` along
   * the wall; `near` the hand that caught first. `feet`: planted on a wall it swung to, (`ax`, `az`) toward it, and how long.
   */
  private sw: { s: number; v: number; d: number; dv: number; o: number; ov: number; x0: number; z0: number; tx: number; tz: number; near: number; t: number; feet: { ax: number; az: number; t: number } | null; shim: number; stuck: number; pumped: number } | null = null;
  /** stepped off the side of a narrow top it couldn't turn on: its edge may be caught going away from it, until then */
  private overrun: { until: number; y: number } | null = null;
  /** where a swing's feet last went to a wall, and until when that's not tried there again (it came back to the same hang) */
  private swungFrom: { x: number; z: number; until: number } | null = null;
  /** how long the stick has asked to go off the line it's running (rad > 0.26) */
  private turnAsk = 0;
  /** on a flight of stairs, or just off one: its pace held to what treads allow */
  private stairT = 0;
  /**
   * Swinging on one hand from a rail (a post, a newel at a stair's turn): the hips on an arm's length from the hand, a
   * pendulum in all three ways (round the post as well as out and back), carrying what the body brought. `foot`: the free
   * foot against whatever face the swing has brought it to (a wall, a step, the underside of a landing), the leg taking
   * load as it's compressed (`press`, the most it's been). `ask`: the way the stick was held when the swing (or the foot)
   * was taken, to tell holding on from leaving.
   */
  rs: { h: [number, number, number]; L: number; q: [number, number, number]; v: [number, number, number]; t: number; side: number; ask: [number, number]; foot: { p: [number, number, number]; n: [number, number, number]; t: number; press: number; side: number } | null; last: { p: [number, number, number]; n: [number, number, number]; press: number; at: number } | null; leaning: number } | null = null;
  /** a balance check at a lip it stopped close to: how long's left of it */
  teeterT = 0; private teetered = false;
  /** this flight is a precision: aimed to stop on something narrow, both feet brought together for it */
  precise = false;
  /** how far through a balance check at a lip (0 none, rising to 1 at its end) */
  get teeter(): number { return this.teeterT > 0 ? 1 - this.teeterT / TEETER : 0; }
  get saveKind(): string | undefined { return this.save?.kind; }
  get saveT(): number | undefined { return this.save?.t; }
  get saveSide(): number | undefined { if (!this.save) return undefined; const h = this.heading; return this.save.ex * Math.cos(h) - this.save.ez * Math.sin(h) >= 0 ? 1 : -1; }
  get swing(): number | undefined { return this.sw?.v; }
  /** the hang's swing out from the wall (m), and its feet on a wall it swung to */
  get swingOut(): number { return this.sw?.o ?? 0; }
  /** on a rail swing: from the hips up to the hand (a unit vector), whether a foot's on a face and how loaded its leg is */
  get swingLine(): [number, number, number] | null { const s = this.rs; if (!s) return null; const d = [s.h[0] - s.q[0], s.h[1] - s.q[1], s.h[2] - s.q[2]], l = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / l, d[1] / l, d[2] / l]; }
  get swingFoot(): { side: number; press: number } | null { const f = this.rs?.foot; return f ? { side: f.side, press: f.press } : null; }
  /** pulled up over a lip with no foot on the wall: a pull, a press, a knee (the rig's to draw, by `mu`) */
  get pulling(): boolean { return this.state === 'climb' && this.move === 'climb' && !this.stepFoot && !this.chain; }
  get swingFeet(): { ax: number; az: number; t: number } | null { return this.sw?.feet ?? null; }
  /** hanging from a lip it caught (s; -1 not hanging); lips caught; and the wall it's braced against, pressed into one */
  private atLip = -1; catches = 0;
  /** leaps off the ground that missed their landing and fell (a kick off a wall into the air isn't one); where this flight began */
  misses = 0;
  /** the state it last left for the air from */
  from: State = 'ground';
  /** this flight is a go at a wall (to plant on it), not a leap for a landing: coming down off it isn't a miss */
  private attempt = false; private pax = 0; private paz = 0;
  /** gone for a wall: when, and the jump to carry into it (the way to it) */
  private goneFor = -9; private toWall: [number, number] | null = null; private metT = -9;
  /** the body against walls: the last contact (the way out of the wall, how hard it was met, how long ago), hard hits, and a
   * wall a hand can steady on (the way to it, how far) */
  contact: { nx: number; nz: number; into: number; t: number } = { nx: 0, nz: 0, into: 0, t: 9 }; bumps = 0;
  private steady: { ax: number; az: number; d: number } | null = null;
  /** a heavy landing held at its deepest a while (the emphasis): the legs stay down, the body goes on */
  private legHold = 0;
  get chainPhase(): number | undefined { return this.chain ? this.chain.phase : this.atLip >= 0 ? (this.atLip < LIP_BEAT ? 0 : 1) : undefined; }
  braces = 0;
  private bracing = false;
  private legVelocity = 0;
  private stepAge = 0;
  private stepFoot: P3 | null = null;
  private catchHeight = 0;
  private pushPending = false;
  private rollDuration = ROLL;
  private rollT = 0; private dashT = 0;
  /** on a wall: the way into it, the way along it, the pace along it; and a moment after leaving one before another is taken */
  wx = 0; wz = 0; tx = 0; tz = 0; private wsp = 0; private wallCool = 0;
  top = 0;
  reach: Reach = {};
  /** a vault's hand hold; a spring's landing lip; a climb's grips, and when they were last looked for and last had */
  plant: P3 | null = null; private plant2: P3 | null = null; private lip: [P3, P3] | null = null;
  /** the height a vault lands at: anything higher under it on the way is what it's going over */
  private vaultTo = 0;
  private grips: Reach = {};
  /** each foot's footfall: planted or not, and where */
  private feet = { L: { on: false, p: [0, 0, 0] as P3, done: false, up: -9, held: null as { from: P3; t: number; need: number; turn?: boolean } | null, aim: null as P3 | null, choice: null as number[] | null, drawn: null as P3 | null, k0: null as number | null, from0: null as P3 | null, kWas: 0 }, R: { on: false, p: [0, 0, 0] as P3, done: false, up: -9, held: null as { from: P3; t: number; need: number; turn?: boolean } | null, aim: null as P3 | null, choice: null as number[] | null, drawn: null as P3 | null, k0: null as number | null, from0: null as P3 | null, kWas: 0 } };
  /** a step taken standing: which foot, from where to where, how far through (s) and how long it takes */
  /** the foot it set off on from its last stand (1 left, -1 right), for the record */
  firstFoot = 0;
  standStep: { side: number; from: P3; to: P3; t: number; dur: number } | null = null;
  /** where each foot last was: on the ground now, or where it left it */
  get footAt(): { L: P3; R: P3 } { return { L: this.feet.L.p, R: this.feet.R.p }; }
  /** a foot in the air between footfalls, at a walk or standing: where it left, where it's going, and how far there (0..1) */
  /** a foot in the air between footfalls (at a walk or standing): where it left, where it's going, how far there (0..1) */
  inStep(side: number): { from: P3; to: P3; k: number; off?: boolean; rel?: boolean } | null {
    // (where it's going is where it's committed to: its aim, moved toward what's wanted only as fast as a foot in the air
    // can still change course)
    const w = this.wantStep(side), f = side > 0 ? this.feet.L : this.feet.R;
    if (w && f.aim && !this.standStep) w.to = f.aim;
    // (a swing on the stride's clock starts at the start of its path: a foot leaving the ground when the clock is already some
    // way through its swing (setting off from a stand, a stride re-timed) is taken from where it is over what's left of it,
    // not drawn already partway along)
    if (w && !w.off && !f.held && f.k0 !== null) {
      // (from where the foot was when this swing took it, which a step before it may have moved; its clock wrapping round
      // without it having come down leaves it at the end of its path, not back at the start)
      const k = f.k0 > 0 ? Math.max(0, Math.min(1, (w.k - f.k0) / (1 - f.k0))) : w.k;
      w.k = k < f.kWas - 0.5 ? 1 : k; if (f.from0) w.from = f.from0;
    }
    return w;
  }
  /** where a stepping foot would go if it could go anywhere: the stride's spot for it now (see `inStep`) */
  private wantStep(side: number): { from: P3; to: P3; k: number; off?: boolean; rel?: boolean; base?: P3 } | null {
    if (this.state !== 'ground' || this.move === 'roll') return null;
    const ss = this.standStep; if (ss) return ss.side === side ? { from: ss.from, to: ss.to, k: Math.min(1, ss.t / ss.dur), off: true } : null;
    const f = side > 0 ? this.feet.L : this.feet.R, sp = this.speed; if (f.on || sp < WALK) return null;
    const rate = this.phaseRate, span = this.span, from = Math.PI / 2 + 0.3;
    const d = (((from - (this.phase + (side > 0 ? 0 : Math.PI))) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), t = d / Math.max(0.1, rate), dur = (2 * Math.PI - span) / Math.max(0.1, rate);
    // (held in the air, due down but its swing not done: from where it was drawn when held, to where it's going, by its own
    // clock; one taken up early waiting on its time down hovers just short of the ground meanwhile, not set on it)
    const hd = f.held;
    if (hd) { const ux = this.vx / sp, uz = this.vz / sp, x = this.x + ux * this.ahead_ + uz * side * this.track_, z = this.z + uz * this.ahead_ - ux * side * this.track_; return { from: hd.from, to: [x, this.city.heightAt(x, z), z], k: Math.min(hd.turn ? 1 : 0.9, (this.time - hd.t) / hd.need), off: !!hd.turn, rel: true }; }
    // (where it'll come down: where it's planned to, if it's the next and there's a plan; else where the stride will put it;
    // no further on than a swing's time (half a second at most) carries the body, braking as it's being braked, never past where
    // it would stop: slowing, the stride's clock slows and the pace drops, and the foot had been sent out ahead into a lunge)
    // (the same choice the foot will make as it lands: the plan if it's still near where the stride would put it)
    const planned = side > 0 ? this.planFor.L : this.planFor.R, nf = planned ? { side, p: planned } : null, ux = this.vx / sp, uz = this.vz / sp, tP = Math.min(t, 0.5), brk = Math.min(0, this.pushAlong), go = brk < -0.5 ? Math.max(0, Math.min(sp * tP + 0.5 * brk * tP * tP, (sp * sp) / (-2 * brk))) : sp * tP, x = this.x + ux * (go + this.ahead_) + uz * side * this.track_, z = this.z + uz * (go + this.ahead_) - ux * side * this.track_;
    let to: P3 = [x, this.city.heightAt(x, z), z]; const base: P3 = to;
    // (the plan's spot, if it's still on this line: one planned for a line it's turned off since (well to the side of where
    // the stride would put it now) is for a run it's no longer making)
    if (nf && nf.side === side) { const ox = nf.p[0] - x, oz = nf.p[2] - z, along = ox * ux + oz * uz, across = -ox * uz + oz * ux; if (Math.abs(along) < 0.9 && Math.abs(across) < 0.25) to = nf.p; }
    return { from: f.p, to, base, k: Math.max(0, Math.min(1, 1 - t / Math.max(0.05, dur))) };
  }
  private dt = 1 / 120;
  /** going onto a wall: how far off it the body still is (m), closed as the run begins */
  private wallGap = 0;
  /** a lip that gave nothing to stand on when it was climbed: not caught again for a while (where, and until when) */
  private badLip: { x: number; z: number; until: number } | null = null;
  private lipBad(x: number, z: number): boolean { const b = this.badLip; return !!b && this.time < b.until && Math.hypot(x - b.x, z - b.z) < 1.5; }
  /** the height it last left from: its own lip isn't one to catch on the way off it */
  private leftY = 0;
  /** how far round from the way it faces it's asked to go (rad, to its left +): the turn still to come */
  get turnAhead(): number { return this.ahead; }
  /** along a wall: how far off it, the other way, another wall stands (m, 9: none within 1.5): room to tip away into */
  get roomAway(): number { if (this.state !== 'wall') return 9; for (let d = 0.3; d <= 1.5; d += 0.1) if (this.city.heightAt(this.x - this.wx * d, this.z - this.wz * d) > this.y + 0.8) return d; return 9; }
  /** how far ahead (m) a wall stands taller than the head, within 1.2 m (9: none): room to pitch forward into */
  get roomAhead(): number { const fx = Math.sin(this.heading), fz = Math.cos(this.heading); for (let d = 0.2; d <= 1.2; d += 0.1) if (this.city.heightAt(this.x + fx * d, this.z + fz * d) > this.y + 1.2) return d; return 9; }
  /** hanging from a lip, how long (s); -1 not */
  get hangT(): number { return this.state === 'climb' && !this.chain ? this.atLip : -1; }
  private ahead = 0;
  /** standing, as of the last footing */
  private stood = false;
  /** each foot's step in the air at the last footing, so a stand taken mid-step steps on from where the foot is */
  private swung: { L: { from: P3; to: P3; k: number } | null; R: { from: P3; to: P3; k: number } | null } = { L: null, R: null };
  /** the step being taken (m): as planned, else the stride's at this pace */
  // (a planned step only if it's a real one: a run-up's plan can come out at nothing or less where a lip is very near)
  // (and slow, never much longer than this pace's own: a step planned at speed isn't crawled over at a walk; at speed a run-up's
  // stretched step is as planned)
  private get stepNow(): number { const own = this.stepLenOf(Math.max(WALK, this.speed)), planned = this.stepTo > 0.3 ? this.stepTo : own * Math.max(0.6, this.stepScale); return this.speed < 3 ? Math.min(planned, own * 1.25) : planned; }
  /** how fast the stride turns (rad/s): a step's worth of phase per step's length gone; the one rate the feet are timed by,
   * and foreseen by (inStep, nextFoot) */
  private get phaseRate(): number { return (this.speed / (2 * this.stepNow)) * 2 * Math.PI; }
  /** how much of a stride's turn a foot is down for, this step: fixed by the step as planned, so a change of pace in it
   * doesn't open or close a foot's time on the ground under it */
  /** how much of a stride's turn a foot is down for: as long as the body takes to go its stance over it; at a walk that's
   * more than half, so both feet are down for a while each step (a walk), and less as it quickens (a run, with its flight) */
  private get span(): number { return Math.min(4.1, (Math.PI * this.stance_) / this.stepNow); }
  private air2 = false;
  /** the jump held, this step: a fall becomes a glide */
  private hold = false;
  leaps = 0; climbs = 0; walls = 0; rolls = 0; dashes = 0; dist = 0;
  /** times it has come down to the street off a roof */
  streets = 0; private high = 0;
  /** how many of each move it has made */
  made: Partial<Record<Move, number>> = {};

  /** who runs (character.ts): its body's size decides how far its legs and arms reach and how long its stride is */
  readonly character: Character; readonly build: Build;
  constructor(readonly city: City, character?: Character) {
    const s = city.start(); this.x = s.x; this.y = s.y; this.z = s.z;
    this.character = character ?? characterByName(null); this.build = bodyOf(this.character.proportions);
  }
  /** a step's length at a pace, for this body's legs */
  private stepLenOf(sp: number): number { return stepLen(sp) * this.build.strideScale; }
  /** how high a hand reaches above the feet (the dial's, for the runner, scaled to this body's arms); how far below a hold the
   * feet hang; the leg from hip to sole; where the hips ride above the feet */
  get armReach(): number { return TUNE.armReach * this.build.reachScale; }
  private get hangLen(): number { return HANG * this.build.reachScale; }
  private get leg(): number { return LEG * this.build.legScale; }
  private get hipH(): number { return 0.95 * this.build.legScale; }
  /**
   * The body as it collides: a standing cylinder. Its radius in plan (against walls): the runner's 0.35 m, for this body's
   * shoulders and size; its height (what's higher is overhead; a slab lower than its crown is a ceiling it meets): its
   * stature, near enough. The step a foot takes up is everyone's (a stair's riser has to be).
   */
  get R_(): number { return R * (0.5 * this.build.shoulderX / 0.225 + 0.5 * this.character.proportions.stature / 1.82); }
  private get height_(): number { return this.character.proportions.stature * (1.8 / 1.82); }
  /** where a foot comes down ahead of the body, how far out from its line, how far the body goes over a foot while it's
   * down: the runner's, for its legs, scaled to this body's */
  // (walking: the body goes 1.24 steps over each planted foot (so each is down about three fifths of the stride, and
  // both are down together a while at each step, as a walk is), the foot coming down under a third of that ahead;
  // blended into the run's as the pace rises)
  private get ahead_(): number { const t = walkToRun(this.speed); return (AHEAD * t + 0.3 * 1.24 * this.stepLenOf(Math.max(WALK, this.speed)) * (1 - t)) * (t >= 1 ? this.build.legScale : 1); }
  private get track_(): number { return TRACK * this.build.legScale; }
  private get stance_(): number { const t = walkToRun(this.speed); return t >= 1 ? STANCE * this.build.legScale : STANCE * this.build.legScale * t + Math.min(0.85 * this.build.legScale, 1.24 * this.stepLenOf(Math.max(WALK, this.speed))) * (1 - t); }

  get speed(): number { return Math.hypot(this.vx, this.vz); }

  /** another of it, as it is now, to be run on ahead without touching this one (plan.ts) */
  /**
   * A copy to run on ahead (the planner's forecasts, a leap tried out): everything it holds copied, nothing shared but the
   * city, so running the copy can't move this one (a step under way, a run-up's plan, where a foot is).
   */
  clone(): Runner {
    const c = Object.assign(Object.create(Runner.prototype) as Runner, this) as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(this)) if (k !== 'city' && v && typeof v === 'object') c[k] = structuredClone(v);
    return c as unknown as Runner;
  }
  /** footfalls moved off ground detail, and of those the ones shortened in the last strides before an edge (a stutter);
   * seconds still stepping high over clutter */
  adjusted = 0; stutters = 0; stepOver = 0;
  /** the footstep plan: the next footfall, this step's length against the usual, how far this step's flight is pushed up,
   * the body's line shifted toward a footfall set out to the side (target and now, m to its left) */
  /** along a wall, the stride's own phase (by pace, not by how fast the run's time is spent); a wall close beside the body
   * in the air (1 its left, -1 its right, 0 none), for the near arm to keep in */
  wallPhase = 0; near = 0;
  /** up against a wall on the ground (just met it, slow): the figure straightens, its head kept out of it */
  get against(): number { return this.state === 'ground' && this.contact.t < 0.2 && this.speed < 4 ? 1 : 0; }
  private nextFall: P3 | null = null; stepScale = 1; stepLift = 0;
  /** the step being taken, as planned (m): the stride's timing keeps to it, so a foot comes down where it was meant to
   * even as the pace changes under it; 0, none planned */
  private stepTo = 0; private shiftTarget = 0; shift = 0;
  /** what the feet are pushing the body by (m/s²), along the way it's going (− a brake) and across it (+ to its right) */
  pushAlong = 0; pushAcross = 0;
  /** the share of a stride cycle a foot is down for (the rig times each leg's swing by it) */
  get stanceFrac(): number { return this.span / (2 * Math.PI); }
  /** the next footfall and how long until it comes (s), for the swing leg to be brought onto it before it lands */
  get nextFoot(): { side: number; p: P3; t: number } | null {
    const ss = this.standStep; if (ss && this.state === 'ground') return { side: ss.side, p: ss.to, t: Math.max(0, ss.dur - ss.t) };
    if (this.state !== 'ground' || this.move === 'roll' || this.speed < WALK || (!this.nextFall && !this.feet.L.aim && !this.feet.R.aim)) return null;
    const rate = this.phaseRate || 1, from = Math.PI / 2 + 0.3;
    let best: { side: number; p: P3; t: number } | null = null;
    for (const [side, off, on] of [[1, 0, this.feet.L.on], [-1, Math.PI, this.feet.R.on]] as const) {
      if (on) continue;
      // (a foot on a held swing comes down when that's done, not when the stride says)
      const hd = (side > 0 ? this.feet.L : this.feet.R).held, d = (((from - (this.phase + off)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), t = hd ? Math.max(hd.need - (this.time - hd.t) + 0.02, hd.turn ? 0 : d / rate) : d / rate;
      // (where it's committed to coming down, if it's on its way; else where the plan has it)
      const ft = side > 0 ? this.feet.L : this.feet.R, aim = ft.choice && this.speed >= 6 ? null : ft.aim, p = aim ?? this.nextFall;
      if (p && (!best || t < best.t)) best = { side, p, t };
    }
    return best;
  }
  /** where it is in its stride: through a foot's stance (0..1), or through the flight between (0..1); -1 the other */
  get gait(): { stance: number; flight: number } {
    if (this.state !== 'ground' || this.move === 'roll' || this.speed <= 2) return { stance: -1, flight: -1 };
    const span = this.span, s = (((this.phase - (Math.PI / 2 + 0.3)) % Math.PI) + Math.PI) % Math.PI;
    return s < span ? { stance: s / span, flight: -1 } : { stance: -1, flight: (s - span) / Math.max(0.01, Math.PI - span) };
  }
  /** the last few things it did (not running): what the choreographer's novelty is judged against */
  recent: Move[] = [];
  private count(m: Move): void { this.made[m] = (this.made[m] ?? 0) + 1; if (m !== 'run' && m !== 'dash') { this.recent.push(m); if (this.recent.length > 6) this.recent.shift(); } }

  step(dt: number, inp: Input): void {
    // (the slabs overhead that count are the ones this body's head reaches: see City.refY)
    this.city.refY = this.y;
    const mag = Math.min(1, Math.hypot(inp.x, inp.z)), on = mag > 0.1;
    const dx = on ? inp.x / Math.hypot(inp.x, inp.z) : 0, dz = on ? inp.z / Math.hypot(inp.x, inp.z) : 0;
    const x0 = this.x, z0 = this.z, h0 = this.heading;
    this.time += dt; this.impactT += dt; this.contact.t += dt; this.dt = dt;
    if (on) this.want = [dx, dz];
    this.mag = mag;
    // (held: nothing moves, the pose stays (the emphasis))
    if (this.freeze > 0) { this.freeze -= dt; return; }
    if (this.state === 'ground' && this.legHold > 0) this.legHold -= dt;
    else if (this.state === 'ground') {
      const depth = this.land * 0.46, wasDown = this.legVelocity > 0;
      this.legVelocity += (-this.sinkK * depth - 1.44 * Math.sqrt(this.sinkK) * this.legVelocity) * dt;
      const next = Math.max(0, Math.min(0.46, depth + this.legVelocity * dt));
      if (next === 0 || next === 0.46) this.legVelocity = 0;
      this.land = next / 0.46;
      // (a heavy landing at its deepest: held there a moment, if the emphasis asks)
      if (this.hitPending && wasDown && this.legVelocity <= 0) { this.hitPending = false; this.legHold = 0.06 * TUNE.emphasis; }
    } else this.land *= Math.exp(-12 * dt);
    // (balance: knocked by what happens, corrected like a spring on the ground; in the air it just fades)
    // (a wall a hand can reach (to the side or ahead, standing above the hips), when it's off balance or sliding along one)
    this.steady = null;
    if (this.state === 'ground' && (Math.abs(this.balance) > 0.06 || (this.contact.t < 0.15 && this.speed < 6))) {
      for (const [ax, az] of AXES) for (let d = this.R_ + 0.05; d <= 0.95; d += 0.15) if (this.city.heightAt(this.x + ax * d, this.z + az * d) > this.y + 1.2) { if (!this.steady || d < this.steady.d) this.steady = { ax, az, d }; break; }
    }
    if (this.state === 'ground') {
      if (this.move === 'ledge') this.balanceV += (Math.sin(this.dist * 2.3) + Math.sin(this.dist * 0.9 + 1)) * 1.6 * dt;
      if (this.speed > 6) this.balanceV += (this.turn - this.prevTurn) * 0.02;
      // (a hand on a wall steadies it: the correction damped harder)
      this.balanceV += (-60 * this.balance - (this.steady ? 18 : 9) * this.balanceV) * dt; this.balance += this.balanceV * dt;
    } else { const k = Math.exp(-3 * dt); this.balance *= k; this.balanceV *= k; }
    this.prevTurn = this.turn;
    // (a wall close beside it in the air)
    this.near = 0;
    if (this.state === 'air') { const lx = Math.cos(this.heading), lz = -Math.sin(this.heading); for (const s of [1, -1]) if (this.city.heightAt(this.x + lx * s * 0.75, this.z + lz * s * 0.75) > this.y + 0.8) { this.near = s; break; } }
    // (effort comes back, running easily, a while after the last big one)
    this.spentT += dt; if (this.spentT > 0.8 && this.state === 'ground') this.stamina = Math.min(1, this.stamina + 0.15 * dt);
    this.wallCool -= dt;
    if (this.state === 'ground') this.ground(dt, mag, on, dx, dz, inp.jump);
    else if (this.state === 'air') this.air(dt, on, dx, dz, inp.jump);
    else if (this.state === 'wall') this.wall(dt, on, dx, dz, inp.jump);
    else if (this.state === 'plant') this.wallStep(dt, on ? dx * this.wx + dz * this.wz : 0);
    else if (this.state === 'chimney') this.chimney(dt, on);
    else if (this.state === 'swing') this.railSwing(dt, on, dx, dz, mag);
    else this.climb(dt, on, dx, dz, inp.jump);
    this.hold = !!inp.hold;
    // (facing: the way it's going; up a wall, the wall)
    const sp = this.speed;
    // (facing: up a wall, the wall; up an alley wall to wall, along it (not the way it's crossing); else the way it's going, at
    // any walking pace: a body walking turns to face its way, it doesn't drift sideways or backwards on its feet)
    const want = this.state === 'climb' || this.state === 'plant' ? Math.atan2(this.wx, this.wz) : this.state === 'chimney' ? Math.atan2(this.tx, this.tz) : sp > WALK ? Math.atan2(this.vx, this.vz) : this.heading;
    let d = want - this.heading; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    // (on the ground going slowly, the body turns as fast as its feet can be stepped round, not on the spot)
    let turnBy = d * (1 - Math.exp(-16 * dt)); if (this.state === 'ground' && sp < 3) { const most = (4 + 2.5 * sp) * dt; turnBy = Math.max(-most, Math.min(most, turnBy)); }
    this.heading += turnBy;
    let dh = this.heading - h0; dh -= Math.round(dh / (2 * Math.PI)) * 2 * Math.PI;
    this.turn += (dh / dt - this.turn) * (1 - Math.exp(-8 * dt));
    // (the turn still to come, followed (not jumped to) as what's asked changes)
    { let d = this.mag > 0.1 && (this.want[0] || this.want[1]) ? Math.atan2(this.want[0], this.want[1]) - this.heading : 0; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI; this.ahead += (d - this.ahead) * (1 - Math.exp(-10 * dt)); }
    // (on the ground, never left overlapping a wall, whatever path got it there (down a face out of the air, a slow step at
    // a stand): pushed out by its breadth)
    if (this.state === 'ground' && this.resolve(STEP)) this.y = this.city.heightAt(this.x, this.z);
    this.dist += Math.hypot(this.x - x0, this.z - z0);
    this.reach = TUNE.reach ? this.reaching() : {};
    // (a foot the figure couldn't hold (out of the leg's reach from where the hips are: the rig said so last step) is let go
    // of here too, as a step: it swings to where it's going and comes down when its time is up)
    if (this.state === 'ground') for (const [side, foot] of [[1, this.feet.L], [-1, this.feet.R]] as const) if (this.letGoAsked.includes(side) && foot.on) {
      const sp = Math.max(1.5, this.speed), ux = this.speed > 0.5 ? this.vx / this.speed : Math.sin(this.heading), uz = this.speed > 0.5 ? this.vz / this.speed : Math.cos(this.heading);
      const ax = this.x + ux * this.ahead_ + uz * side * this.track_, az = this.z + uz * this.ahead_ - ux * side * this.track_;
      const other = side > 0 ? this.feet.R : this.feet.L; foot.on = false; foot.done = false; foot.up = this.time; foot.held = { from: this.shoe(foot), t: this.time, need: other.on ? Math.hypot(ax - foot.p[0], az - foot.p[2]) / (2.5 * sp) + 0.06 : 0.06 };
    }
    this.letGoAsked = [];
    if (TUNE.reach && TUNE.feet) this.stepping(); else this.feet.L.on = this.feet.R.on = false;
    this.contacts();
    if (this.feet.L.on || this.feet.R.on || this.state !== 'ground') this.supportT = this.time;
    if (this.state === 'ground') { if (this.y < 0.5 && this.high > 4) this.streets++; this.high = this.y; } else this.high = Math.max(this.high, this.y);
  }

  /**
   * Each foot's footing, the one account of it the runner and the figure share: whether it's on something, where, the way
   * that surface faces, how much of the weight it bears, and where it is in bearing it. A foot touches (the first moment
   * down, bearing little), accepts the weight, pushes (the body going on past it, the weight leaving), and unloads (the
   * other foot has it); off, it's in the air. The weight: all on a foot that's down alone; between two, by where the body
   * is along the line from one to the other, so it goes across in the double support, not at a footfall.
   */
  footing: Record<'L' | 'R', Contact> = { L: freeContact(), R: freeContact() };
  /** feet the figure couldn't hold last step, to be let go of (1 left, -1 right) */
  private letGoAsked: number[] = [];
  /** each foot's planned spot, two footfalls out: the next foot's, and the one after's (so a foot's spot is planned before it
   * leaves the ground, and the plan as the other comes down only fine-tunes it) */
  private planFor: { L: P3 | null; R: P3 | null } = { L: null, R: null };
  /** saves that found nowhere for the catching foot, and so didn't save */
  failedSaves = 0;
  /** when a foot (or anything but the ground) last held the body up: a jog's moment in the air is short */
  private supportT = 0;
  /** the figure can't hold this foot where it's down (it's out of the leg's reach): let it go */
  letGo(side: number): void { if (!this.letGoAsked.includes(side)) this.letGoAsked.push(side); }
  /** where the figure has drawn this foot's sole (after its step): the one place a foot in the air is, for whatever takes it
   * on from there (a stand's settling step, a step carried on, a swing held) */
  reportShoe(side: number, p: P3): void { (side > 0 ? this.feet.L : this.feet.R).drawn = p; }
  /** a foot in the air's sole where it's drawn, else where it last was */
  private shoe(foot: { p: P3; drawn: P3 | null }): P3 { return foot.drawn ? [...foot.drawn] as P3 : [...foot.p] as P3; }
  private contacts(): void {
    const f = this.feet, on = { L: f.L.on && !!(this.reach.fl), R: f.R.on && !!(this.reach.fr) };
    let wL = on.L && !on.R ? 1 : on.R && !on.L ? 0 : 0.5;
    if (on.L && on.R) { const ax = f.L.p[0] - f.R.p[0], az = f.L.p[2] - f.R.p[2], l2 = ax * ax + az * az; wL = l2 > 1e-4 ? Math.max(0, Math.min(1, ((this.x - f.R.p[0]) * ax + (this.z - f.R.p[2]) * az) / l2)) : 0.5; }
    const nrm: P3 = this.state === 'ground' ? [0, 1, 0] : this.reach.fn ? [this.reach.fn[0], this.reach.fn[1], this.reach.fn[2]] : [0, 1, 0];
    for (const [k, foot, w] of [['L', f.L, wL], ['R', f.R, 1 - wL]] as const) {
      const c = this.footing[k], load = on[k] ? (on.L && on.R ? w : 1) : 0;
      if (!on[k]) { this.footing[k] = { ...freeContact(), load: 0 }; continue; }
      const since = c.phase === 'air' ? 0 : c.since + this.dt, ux = this.speed > 0.3 ? this.vx / this.speed : Math.sin(this.heading), uz = this.speed > 0.3 ? this.vz / this.speed : Math.cos(this.heading);
      const past = (this.x - foot.p[0]) * ux + (this.z - foot.p[2]) * uz > 0;
      const phase: ContactPhase = since < 0.04 && load < 0.9 ? 'touch' : load < 0.15 && (on.L && on.R) ? 'unload' : load >= c.load - 1e-4 && !past ? 'accept' : 'push';
      this.footing[k] = { phase, p: foot.p, normal: nrm, load, since };
    }
  }

  /**
   * Where the feet are put. A stride has each foot down for part of it: when one comes down it is given a place (on the
   * roof ahead of the body; on a rail, on its line; at a lip, on the lip; up a wall, on a sill or a pipe if one's by,
   * else on the wall; along a wall, on the wall) and it stays there, the body going over it, until it lifts.
   */
  private stepping(): void {
    const sp = this.speed, f = this.feet;
    // (on a rail swing: the feet off everything but the one the swing has put to a face)
    if (this.state === 'swing') {
      const ft = this.rs?.foot; f.L.on = !!ft && ft.side > 0; f.R.on = !!ft && ft.side < 0; this.reach.fl = this.reach.fr = undefined;
      if (ft) { const F = ft.side > 0 ? f.L : f.R; F.p = [ft.p[0], ft.p[1], ft.p[2]]; F.done = false; if (ft.side > 0) this.reach.fl = F.p; else this.reach.fr = F.p; this.reach.fn = ft.n; }
      return;
    }
    // (pulled up over a lip with no foot on the wall: the feet leave what they stood on as the pull takes the weight, and come
    // up under it, not dragged after the hips)
    if (this.pulling) { f.L.on = f.R.on = false; this.reach.fl = this.reach.fr = undefined; return; }
    if (this.save && this.state === 'ground' && this.move !== 'roll' && this.placeSave()) return;
    // (clutter under the stride: stepped over high)
    if (this.state === 'ground') { const g = this.city.regionAt(this.x + Math.sin(this.heading) * 0.3, this.y, this.z + Math.cos(this.heading) * 0.3); if (g?.kind === 'clutter') this.stepOver = 0.3; }
    this.stepOver = Math.max(0, this.stepOver - 1 / 120);
    // (standing: both feet down where they belong under the body (hip-width, the lead a little ahead); a foot left too far
    // from there, by the body turning or drifting off it, is stepped back under it, one at a time, lifted and put down)
    if (this.state === 'ground' && this.move !== 'roll' && sp < WALK) { this.standing(); this.stood = true; return; }
    // (setting off mid-step: that step put down where it was going)
    let stepping = 0;
    if (this.standStep) {
      // (and the step it's in the middle of carried on from where the foot is, to where it was going, not set there at once)
      const ss = this.standStep; stepping = ss.side; const foot = ss.side > 0 ? f.L : f.R, from = this.shoe(foot);
      foot.on = false; foot.up = this.time; foot.held = { turn: true, from, t: this.time, need: Math.max(0.06, Math.hypot(ss.to[0] - from[0], ss.to[2] - from[2]) / 2.5) }; this.standStep = null;
    }
    // (setting off from a stand: no plan carried from before it; the stride takes the feet from where they stand)
    if (this.stood && this.state === 'ground') {
      this.stood = false; this.nextFall = null; this.stepTo = 0; this.planFor = { L: null, R: null };
      // (and the first foot the one a person would take: one already in the air from a step at a stand; going off to a side,
      // the foot on that side stepping out, the weight on the other; forward or back, the foot furthest behind the way it's
      // going, the one the weight's coming off (the rear foot going forward, the front one stepping back). The stride's clock
      // set so that foot's swing starts now, the other's stance. On a light press, the small moves from a stand: a full press bursts
      // off on the stride's own clock)
      const wx = this.want[0] || this.vx, wz = this.want[1] || this.vz, wl = Math.hypot(wx, wz);
      if (wl > 1e-3 && this.mag < 0.8) {
        const ux = wx / wl, uz = wz / wl, lat = ux * Math.cos(this.heading) - uz * Math.sin(this.heading);
        let side = stepping;
        if (!side) side = !f.L.on && f.R.on ? 1 : !f.R.on && f.L.on ? -1 : Math.abs(lat) > 0.5 ? (lat > 0 ? 1 : -1) : ((f.L.p[0] - this.x) * ux + (f.L.p[2] - this.z) * uz <= (f.R.p[0] - this.x) * ux + (f.R.p[2] - this.z) * uz ? 1 : -1);
        this.phase = Math.floor(this.phase / (2 * Math.PI)) * 2 * Math.PI + Math.PI / 2 + 0.3 + Math.max(Math.PI, this.span + 0.01) - (side > 0 ? 0 : Math.PI); /* (that foot just off the ground, and the other down: at a walk mid-stance, into a run just come down) */
        this.firstFoot = side;
      }
    }
    // (hanging, loaded: both feet set on the wall under the hips; springing: off it)
    if (this.state === 'climb' && this.chain && this.chain.phase >= 1) {
      if (this.chain.phase === 2) { f.L.on = f.R.on = false; return; }
      for (const [foot, side] of [[f.L, 1], [f.R, -1]] as const) {
        if (foot.on) continue;
        const x = this.x + this.wx * (this.R_ + 0.02) + this.wz * side * 0.16, z = this.z + this.wz * (this.R_ + 0.02) - this.wx * side * 0.16;
        const g = this.city.gripAt(x, this.y + 0.75, z, 0.35, (o) => (o.kind === 'face' || o.kind === 'sill' || o.kind === 'pipe') && o.nx * this.wx + o.nz * this.wz < -0.5);
        if (g) { foot.on = true; foot.p = [g.x, g.y, g.z]; }
      }
      if (f.L.on) this.reach.fl = f.L.p; if (f.R.on) this.reach.fr = f.R.p;
      if (f.L.on || f.R.on) this.reach.fn = [-this.wx, 0, -this.wz];
      return;
    }
    const ground = this.state === 'ground' && this.move !== 'roll' && sp >= WALK, wall = this.state === 'wall', climb = this.state === 'climb';
    // (off the ground, no step is being drawn on it: what was, before a takeoff, says nothing about the landing)
    if (!ground && !wall && !climb) { f.L.on = f.R.on = false; this.swung = { L: null, R: null }; f.L.held = f.R.held = null; f.L.aim = f.R.aim = null; this.planFor = { L: null, R: null }; return; }
    // (just caught, swinging in under the hands: the legs hang free till the swing's spent)
    if (climb && this.atLip >= 0 && this.atLip < LIP_BEAT && !this.chain) { f.L.on = f.R.on = false; return; }
    const a = ground ? this.phase : wall ? this.wallPhase + this.lead * Math.PI : this.climbT * 15;
    // (how much of a turn a foot is down for: on the ground, as long as the body takes to go 0.9 m over it)
    // (hanging from a lip, settled: both feet set on the wall under it and kept there, not walked)
    const still = climb && this.atLip >= LIP_BEAT;
    const span = ground ? this.span : wall ? Math.min(2.4, (Math.PI * 0.5) / this.stepLenOf(this.wsp)) : still ? 2 * Math.PI + 0.1 : 2.2, from = Math.PI / 2 + 0.3;
    // (on the ground, along the way it's going (which leads the way it faces, turning slowly)
    const fx = ground && sp > 0.5 ? this.vx / sp : Math.sin(this.heading), fz = ground && sp > 0.5 ? this.vz / sp : Math.cos(this.heading);
    for (const [foot, side, off] of [[f.L, 1, 0], [f.R, -1, Math.PI]] as const) {
      const ph = (((a + off - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), down = ph < span;
      // (a foot just lifted swings a while before it can come down again: slowing, a walk's longer stance widens the time a
      // foot is down into what was its swing, and a foot caught mid-swing would be planted at once, a step ahead)
      // (a held swing belongs to one time in the air: a foot down, by whatever means, has none)
      if (foot.on) foot.held = null;
      const other = side > 0 ? f.R : f.L;
      const wt = ground ? walkToRun(sp) : 1, aim: P3 = [this.x + fx * this.ahead_ + fz * side * this.track_, this.y, this.z + fz * this.ahead_ - fx * side * this.track_];
      // (and due down far from where its swing has got to (the pace changed under it): held in the air, swung on from where
      // it's drawn now, for as long as a foot takes to go that far)
      let swungLong = !ground || this.time - foot.up >= 0.22 * (1 - wt) + 0.06 * wt || (!!foot.held && this.time - foot.held.t >= foot.held.need);
      if (ground && down && !foot.on && !foot.done && swungLong) {
        // (only a foot swinging on the ground: one coming down out of the air has no swing drawn on the ground to finish)
        const sw = side > 0 ? this.swung.L : this.swung.R;
        if (!foot.held && sw) {
          const e = sw.k * sw.k * (3 - 2 * sw.k);
          const now: P3 = foot.drawn ? this.shoe(foot) : [sw.from[0] + (sw.to[0] - sw.from[0]) * e, sw.from[1] + (sw.to[1] - sw.from[1]) * e, sw.from[2] + (sw.to[2] - sw.from[2]) * e]; void e;
          const need = Math.hypot(aim[0] - now[0], aim[2] - now[2]) / (2.5 * Math.max(1.5, sp));
          // (and no shorter than the least swing still owed since it lifted: done, it can come down at once, not wait on the ground)
          // (but with nothing else under the body, only as long as it must: it comes down short of the full swing instead)
          if (need > 0.05) foot.held = { from: now, t: this.time, need: Math.min(other.on || (wt >= 1 && this.time - this.supportT < 0.08) ? 9 : 0.06, Math.max(need + 0.04, 0.22 * (1 - wt) + 0.06 * wt - (this.time - foot.up))) };
        }
        if (foot.held && this.time - foot.held.t < foot.held.need) swungLong = false;
      }
      // (a foot stepped round in a turn, its swing done: down where it's going, its time down or not; one taken up early only
      // for being far behind waits for its time, so a straight walk keeps its cadence)
      // (and the handover: a foot let go of, its swing done, comes down whenever nothing else is holding the body up, whatever
      // its time down says; on the ground the body is never left with neither foot under it waiting on the stride's clock.
      // Jogging, the gait has its moment in the air: only once that's gone on longer than a jog's own (0.14 s))
      const heldDone = !!foot.held && this.time - foot.held.t >= foot.held.need && (!!foot.held.turn || (ground && !other.on && (wt < 1 || this.time - this.supportT > 0.14)));
      if ((down || (heldDone && ground)) && !foot.on && !foot.done && swungLong) {
        let p: P3 | null = null;
        if (ground) {
          // (where the footstep plan put it, if it's still sound; else ahead of the body, out to its own side)
          let ax = this.x + fx * this.ahead_ + fz * side * this.track_, az = this.z + fz * this.ahead_ - fx * side * this.track_;
          const n = this.nextFall;
          if (n && Math.hypot(n[0] - ax, n[2] - az) < 0.9 * wt + 0.3 * (1 - wt) && Math.abs(this.city.heightAt(n[0], n[2]) - this.y) <= STEP && !this.city.regionAt(n[0], this.y, n[2])) { ax = n[0]; az = n[2]; }
          // (no sound plan, and the default spot's on something: the nearest clear spot by it, short of it first)
          else if (this.city.regionAt(ax, this.y, az)) for (const [da, dl] of [[-0.15, 0], [0.15, 0], [-0.3, 0], [0, 0.15 * side], [0.3, 0], [-0.15, 0.2 * side], [0.15, 0.2 * side], [-0.5, 0], [0.5, 0], [0, 0.35 * side], [-0.7, 0], [0.7, 0], [0, -0.3 * side]]) {
            const qx = ax + fx * da + fz * dl, qz = az + fz * da - fx * dl;
            if (Math.abs(this.city.heightAt(qx, qz) - this.y) <= STEP && !this.city.regionAt(qx, this.y, qz)) { ax = qx; az = qz; break; }
          }
          // (at a walk, where the step drawn in the air was already going, if that's near and sound: the foot is put down where
          // it's seen to be coming down, not snatched to a spot worked out afresh this frame)
          const sw = side > 0 ? this.swung.L : this.swung.R;
          if (foot.aim && Math.abs(this.city.heightAt(foot.aim[0], foot.aim[2]) - this.y) <= STEP && !this.city.regionAt(foot.aim[0], this.y, foot.aim[2])) { ax = foot.aim[0]; az = foot.aim[2]; }
          else if (sw && sp < 3.4 && Math.hypot(sw.to[0] - ax, sw.to[2] - az) < 0.45 && Math.abs(this.city.heightAt(sw.to[0], sw.to[2]) - this.y) <= STEP && !this.city.regionAt(sw.to[0], this.y, sw.to[2])) { ax = sw.to[0]; az = sw.to[2]; }
          const h = this.city.heightAt(ax, az);
          if (Math.abs(h - this.y) <= STEP) { p = [ax, h, az]; this.planSteps(p, side, fx, fz, sp); }
          // (along something narrow, on its line; past a lip, on the lip)
          const g = this.city.gripAt(ax, this.y, az, this.move === 'ledge' ? 0.4 : p ? 0.14 : 0.55, (o) => (o.kind === 'rail' || o.kind === 'edge') && Math.abs(o.ay - this.y) < 0.05);
          if (g && !this.city.regionAt(g.x, g.y, g.z)) p = [g.x, g.y, g.z];
        } else {
          // (along a wall the body's tipped toward it: the foot higher on it and nearer under the hips, where the leg reaches)
          const up = climb ? 0.55 : 0.45, along = climb ? 0 : 0.2, lx = climb ? this.wz * side * 0.13 : 0, lz = climb ? -this.wx * side * 0.13 : 0;
          const wx = this.x + this.wx * (this.R_ + 0.02) + this.tx * along * (wall ? 1 : 0) + lx, wz = this.z + this.wz * (this.R_ + 0.02) + this.tz * along * (wall ? 1 : 0) + lz, wy = this.y + up;
          // (a toe hold if there's one by: a sill, a pipe; else the wall itself)
          const g = this.city.gripAt(wx, wy, wz, 0.45, (o) => (o.kind === 'sill' || o.kind === 'pipe') && o.nx * this.wx + o.nz * this.wz < -0.5) ?? this.city.gripAt(wx, wy, wz, 0.3, (o) => o.kind === 'face' && o.nx * this.wx + o.nz * this.wz < -0.5);
          if (g) p = [g.x, g.y, g.z];
        }
        // (a foot is down once it's got there: drawn still well short of its spot, with the other foot holding the body up, its
        // swing goes on from where it's drawn to there, rather than the foot being called planted and jumping the gap)
        const at = foot.drawn, gap = p && at && ground ? Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]) : 0;
        if (p && at && ground && gap > 0.8 * (4 + 2 * sp) * this.dt && (other.on || !!foot.held?.turn) && this.time - foot.up < 1.2) { foot.held = { from: this.shoe(foot), t: this.time, need: Math.max(0.04, gap / 2.5), turn: true }; foot.aim = p; p = null; }
        if (p) { foot.on = true; foot.p = p; foot.held = null; }
      } else if (!down && !(ground && foot.on && !other.on && walkToRun(sp) < 1)) { if (foot.on) foot.up = this.time; foot.on = false; foot.done = false; }
      // (walking, a foot's time down isn't up while the other isn't down: it stays, the body going on over it, until the other
      // takes the weight, or the leg can't reach it and the figure lets it go)
      // (on the ground, a foot left out of the leg's reach behind (on its toe and all) is taken up early, not dragged; and
      // stays up till its time down is over)
      // (walking, its stance runs to where the walk's own takes it, a little past (a walk's feet are down together a while),
      // but no further behind than the leg reaches with the heel up)
      // (and at a walk, never before the other foot is down: a walk always has a foot on the ground)
      // (and it swings at once, from where it left to where it's going, not hanging there till its time down is up: in a sharp
      // turn that leaves a foot behind, across the new line)
      else if (ground && foot.on && sp < 4) {
        const bx = foot.p[0] - this.x, bz = foot.p[2] - this.z, back = -(bx * fx + bz * fz), t = walkToRun(sp);
        // (or turned over until it's on the other side of the line (a sharp turn at a walk): stepped round, not crossed)
        const hl = Math.cos(this.heading), hz = -Math.sin(this.heading), across = -((foot.p[0] - this.x) * hl + (foot.p[2] - this.z) * hz) * side;
        const turned = other.on && t < 0.5 && across > 0.03 * this.build.legScale;
        if ((other.on || (t > 0.5 && sp >= 2.6)) && (back > (0.42 + 0.03 * sp) * t + Math.min(0.55 * this.build.legScale, this.stance_ - this.ahead_ + 0.08) * (1 - t) || turned)) {
          foot.on = false; foot.done = false; foot.up = this.time;
          foot.held = { turn: turned, from: this.shoe(foot), t: this.time, need: Math.max(0.3 * (1 - t) + 0.14 * t, Math.hypot(aim[0] - foot.p[0], aim[2] - foot.p[2]) / (2.5 * Math.max(1.5, sp)) + 0.06) };
        }
      }
    }
    // (each foot in the air committed to where it's going: its aim follows what's wanted (the stick, the pace, the plan) as
    // fast as a foot can change course with the time it has left: freely just off the ground, hardly at all about to land;
    // what it can't take now, the next step takes, and the foot that does land is where the body has to go from. Never
    // behind the hips at a run: a foot can't come down behind a body going that fast; dragged on with it)
    for (const [side, foot] of [[1, f.L], [-1, f.R]] as const) {
      const w = ground && !foot.on ? this.wantStep(side) : null;
      if (foot.on || !ground || foot.held) { foot.k0 = null; foot.from0 = null; } else if (w && foot.k0 === null && !w.off) { foot.k0 = Math.min(0.9, w.k); foot.from0 = this.shoe(foot); foot.kWas = 0; }
      if (!w) { foot.aim = null; foot.choice = null; continue; }
      if (foot.k0 !== null) { const seen = this.inStep(side); if (seen) foot.kWas = seen.k; }
      // (running, what's committed is the choice of spot (the plan's longer or shorter step, a step aside off something), not
      // where the body will be when it lands: that goes with the body, a few hundredths of a second either way being tens of
      // centimetres; and the way it's going can't change in the air at a run anyway)
      const run = sp > 3.4 && w.base && !w.rel;
      if (run) {
        // (held along and across the way it's going, so a turn carries it round with the body rather than leaving it where it was)
        const ux = this.vx / sp, uz = this.vz / sp, wx = w.to[0] - w.base![0], wz = w.to[2] - w.base![2], ca = wx * ux + wz * uz, cc = -wx * uz + wz * ux;
        const c = foot.choice ?? [ca, cc]; if (ca < c[0]) c[0] = Math.max(ca, c[0] - 6 * this.dt); /* (a step shortened, quickly (6 m/s): the foot just comes down sooner) */
        const dda = ca - c[0], ddc = cc - c[1], dd = Math.hypot(dda, ddc), most = (4 * (1 - w.k) + 0.5) * this.dt, e = dd > most ? most / dd : 1;
        foot.choice = [c[0] + dda * e, c[1] + ddc * e];
        const x = w.base![0] + ux * foot.choice[0] - uz * foot.choice[1], z = w.base![2] + uz * foot.choice[0] + ux * foot.choice[1]; foot.aim = [x, this.city.heightAt(x, z), z]; continue;
      }
      foot.choice = null;
      if (!foot.aim) foot.aim = [...w.to] as P3;
      // (a step can always be shortened (the foot just comes down sooner): what's wanted nearer along the way than the aim,
      // the aim comes back to it quickly (6 m/s); only reaching further, or swerving, is limited to what the foot can still do)
      if (sp > 0.3) { const ux = this.vx / sp, uz = this.vz / sp, back = Math.max(-6 * this.dt, (w.to[0] - foot.aim[0]) * ux + (w.to[2] - foot.aim[2]) * uz); if (back < 0) foot.aim = [foot.aim[0] + ux * back, foot.aim[1], foot.aim[2] + uz * back]; }
      const dx = w.to[0] - foot.aim[0], dz = w.to[2] - foot.aim[2], d = Math.hypot(dx, dz), most = (4 * (1 - w.k) + 0.5 + (w.rel ? sp : 0)) * this.dt; /* (a held foot's spot goes with the body: that much more) */
      const e = d > most ? most / d : 1; let x = foot.aim[0] + dx * e, z = foot.aim[2] + dz * e;
      if (this.speed > 2.6) { const ux = this.vx / this.speed, uz = this.vz / this.speed, ah = (x - this.x) * ux + (z - this.z) * uz, least = 0.1 + 0.02 * this.speed; if (ah < least) { x += ux * (least - ah); z += uz * (least - ah); } }
      foot.aim = [x, this.city.heightAt(x, z), z];
    }
    if (f.L.on) this.reach.fl = f.L.p;
    if (f.R.on) this.reach.fr = f.R.p;
    if (!ground && (f.L.on || f.R.on)) this.reach.fn = [-this.wx, 0, -this.wz];
    if (ground) this.swung = { L: this.inStep(1), R: this.inStep(-1) };
  }

  /**
   * The footstep plan, made as a foot comes down (at p, on `side`): the next two footfalls along the way, a step apart, each
   * on its own side. One that would land on debris, clutter or a skylight goes to the nearest clear place, and the change is
   * spread over both steps (the one after needing a change, this one takes half of it), as a runner settles the rhythm
   * before an obstacle rather than at it. The body follows the plan: this step's timing by its length (cadence up for a
   * short one, down for a long), its flight by it (a long one, or one over clutter, pushed higher; a short one, a little
   * brake), and its line toward a footfall set out to the side (and back on the step after).
   */
  private standing(): void {
    // (no stride's plan carries over a stand, nor any foot's held swing)
    this.nextFall = null; this.stepTo = 0; this.stepScale = 1; this.feet.L.held = this.feet.R.held = null; this.planFor = { L: null, R: null };
    const f = this.feet, h = this.heading, fx = Math.sin(h), fz = Math.cos(h), lx = fz, lz = -fx;
    const home = (s: number): P3 => { const x = this.x + lx * s * 0.11 + fx * (this.lead === (s > 0 ? 0 : 1) ? 0.05 : -0.03), z = this.z + lz * s * 0.11 + fz * (this.lead === (s > 0 ? 0 : 1) ? 0.05 : -0.03); return [x, this.city.heightAt(x, z), z]; };
    const ss = this.standStep;
    if (ss) {
      ss.t += this.dt;
      if (ss.t >= ss.dur) { const foot = ss.side > 0 ? f.L : f.R; foot.on = true; foot.p = ss.to; this.standStep = null; }
    } else {
      const d = (p: P3, q: P3) => Math.hypot(p[0] - q[0], p[2] - q[2]);
      // (neither down (come to a stand out of the air, or a roll): both put where they belong)
      if (!f.L.on && !f.R.on) {
        // (out of a walk with both feet up: the one nearer landing put down where it's got to, the other stepped from where
        // it is; out of the air or a roll with no step under way, both where they belong)
        const a = this.swung.L, b = this.swung.R;
        if (a || b) {
          const first = !b || (a && a.k >= b.k) ? 1 : -1, foot = first > 0 ? f.L : f.R, q = this.shoe(foot);
          foot.on = true; foot.p = [q[0], this.city.heightAt(q[0], q[2]), q[2]];
          if (first > 0) this.swung.L = null; else this.swung.R = null;
        } else { f.L.on = f.R.on = true; f.L.p = home(1); f.R.p = home(-1); }
      }
      let pick = 0, worst = 0;
      for (const [foot, s] of [[f.L, 1], [f.R, -1]] as const) { const e = foot.on ? d(foot.p, home(s)) : 9; if (e > worst) { worst = e; pick = s; } }
      if (pick && worst > 0.17) {
        const foot = pick > 0 ? f.L : f.R, other = pick > 0 ? f.R : f.L;
        if (!other.on || (foot.on && d(foot.p, home(pick)) > 1.4)) { foot.on = true; foot.p = home(pick); }
        else {
          // (a little past where it belongs, the way the body's going, so the next isn't needed at once)
          const to = home(pick), vx = this.vx * 0.12, vz = this.vz * 0.12; to[0] += vx; to[2] += vz;
          // (where it belongs isn't sound (over a lip, on something): a little further back, until it is; a stand is on both feet)
          const ok = (q: P3) => Math.abs(this.city.heightAt(q[0], q[2]) - this.y) <= STEP && !this.city.regionAt(q[0], this.y, q[2]);
          for (let n = 0; n < 3 && !ok(to); n++) { to[0] -= fx * 0.12; to[2] -= fz * 0.12; to[1] = this.city.heightAt(to[0], to[2]); }
          if (ok(to)) {
            // (a foot already in the air from walking: on from where it's got to)
            const from: P3 = !foot.on ? this.shoe(foot) : [...foot.p] as P3;
            this.standStep = { side: pick, from, to, t: 0, dur: Math.max(0.15, Math.min(0.24, 0.12 + 0.2 * Math.min(1, worst))) };
            this.swung = { L: null, R: null };
            foot.on = false;
          }
        }
      }
    }
    this.reach.fl = f.L.on ? f.L.p : undefined; this.reach.fr = f.R.on ? f.R.p : undefined;
    if (!this.reach.fl) delete this.reach.fl; if (!this.reach.fr) delete this.reach.fr;
  }

  /**
   * How big the jump from here at `edge` will be: the leap it would make, tried on a copy (nothing of this one changed),
   * as the effort it takes, 0.2 (a hop across) to 1 (the most it has): the height its takeoff must throw the body to
   * (v² / 2g), with the pace it must add. What the wind-up's depth answers to: the force has to come from somewhere.
   */
  private effortFor(ux: number, uz: number, edge: number, sp: number): number {
    const c = this.clone(); c.leap(ux, uz, edge, sp);
    const apex = Math.max(0, c.vy) ** 2 / (2 * TUNE.gravity), add = Math.max(0, Math.hypot(c.vx, c.vz) - sp);
    return Math.max(0.2, Math.min(1, 0.15 + apex / 4 + add / 6));
  }

  /**
   * The run-up: is there a takeoff ahead that it'll go for (the stick held on, the way it's going; an edge within about
   * three strides it can leap from, not a wall), and if so how many steps to it from the foot just put down at `p`, and
   * how long the next. The takeoff foot's put just short of the lip. None left (it's within about half a stride): this
   * foot's the takeoff, one contact and gone. Else the fewest steps that fit, each lengthened up to about a third (the
   * strides opening into bounds as it comes), the last a little shorter than the one before (to get under the takeoff);
   * a stride is only ever shortened as much as it has to be. Not while a stumble's being caught: that has its own steps.
   */
  /**
   * The first break in the ground along (ux, uz) between `from` and `to`, looked at every `step`: a change of more than a
   * step from the ground just before it, not from where the body is, so a flight of stairs is run down (or up) as ground,
   * not leapt as a drop. 0 if there's none.
   */
  private edgeAlong(ux: number, uz: number, from: number, to: number, step: number): number {
    let prev = this.y;
    for (let d = from; d <= to; d += step) { const h = this.city.heightAt(this.x + ux * d, this.z + uz * d); if (Math.abs(h - prev) > STEP) return d; prev = h; }
    return 0;
  }
  private planRunUp(p: P3, side: number, fx: number, fz: number, sp: number): { steps: number; next: number; after: number } | null {
    void side;
    if (this.save || this.mag < 0.55 || this.move === 'ledge' || this.stickT > 0 || this.rollT > 0 || sp < 2.5) { this.runUpWhy = this.save ? 'save' : sp < 2.5 ? 'slow' : 'state'; return null; }
    if (this.want[0] * fx + this.want[1] * fz < 0.3) { this.runUpWhy = 'turning'; return null; }
    const L = this.stepLenOf(sp), H = (d: number) => this.city.heightAt(this.x + fx * d, this.z + fz * d);
    const edge = this.edgeAlong(fx, fz, 0.2, 4 * L, 0.1);
    if (!edge || H(edge) > this.y + TUNE.rise) { this.runUpWhy = edge ? 'wall' : 'far'; return null; }
    // (short of a lip down or across, just short; of something to go up or over, further back: room to rise)
    const c = H(edge) > this.y + STEP ? Math.min(1.6, 0.8 + 0.05 * sp) : Math.max(0.25, Math.min(0.55, 0.15 + 0.03 * sp)), pd = (p[0] - this.x) * fx + (p[2] - this.z) * fz, D = edge - c - pd;
    if (D <= 0.6 * L) { this.effort = this.effortFor(fx, fz, edge, sp); return { steps: 0, next: 0, after: 0 }; }
    let best = 0, bestCost = 1e9;
    for (let n = Math.max(1, Math.floor(D / (1.35 * L))); n <= Math.ceil(D / (0.8 * L)) + 1; n++) {
      const r = D / n / L; if (r > 1.38) continue;
      // (long is liked (an opening stride), short is paid for, more so the shorter)
      const cost = r >= 1 ? Math.abs(r - 1.18) : 0.18 + 2.5 * (1 - r);
      if (cost < bestCost) { bestCost = cost; best = n; }
    }
    if (!best) { this.runUpWhy = 'nofit'; return null; }
    this.runUpWhy = '';
    if (best <= 2) this.effort = this.effortFor(fx, fz, edge, sp);
    // (the steps rising toward the last but one, the last 0.92 of it)
    const w: number[] = []; for (let i = 0; i < best; i++) w.push(best === 1 ? 1 : i === best - 1 ? 0.92 * (1 + 0.1) : 1 + (0.1 * i) / Math.max(1, best - 2));
    const tot = w.reduce((a, b) => a + b, 0);
    return { steps: best, next: (D * w[0]) / tot, after: best >= 2 ? (D * w[1]) / tot : 0 };
  }

  /** the plan's spots for the next foot (on side `s1`) and the one after it (the other side) */
  private setPlan(s1: number, p1: P3, p2: P3 | null): void {
    if (s1 > 0) { this.planFor.L = p1; this.planFor.R = p2; } else { this.planFor.R = p1; this.planFor.L = p2; }
  }

  private planSteps(p: P3, side: number, fx: number, fz: number, sp: number): void {
    const L = this.stepLenOf(sp), lx = fz, lz = -fx, H = (x: number, z: number) => this.city.heightAt(x, z);
    // (clear, and with room for the foot: nothing higher within 0.15 m of it)
    const clear = (x: number, z: number) => Math.abs(H(x, z) - this.y) <= STEP && !this.city.regionAt(x, this.y, z) && [[0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15]].every(([a, b]) => H(x + a, z + b) <= this.y + STEP);
    const at = (base: P3, d: number, s: number, l: number): P3 => [base[0] + fx * d + lx * (s * this.track_ + l), this.y, base[2] + fz * d + lz * (s * this.track_ + l)];
    const along = (q: P3) => [q[0] - lx * side * this.track_, this.y, q[2] - lz * side * this.track_] as P3;
    // (planned from where the body will be, a step on, not from this footfall: so a change of pace never leaves the feet
    // behind or ahead of it)
    void along; const mid: P3 = [this.x + fx * this.ahead_, this.y, this.z + fz * this.ahead_], CAND: [number, number][] = [[0, 0], [-0.25, 0], [0.25, 0], [-0.25, 0.12], [0, 0.18], [0, -0.18], [-0.45, 0], [0.45, 0], [0.2, -0.2], [-0.6, 0], [0.65, 0]];
    const loose = (x: number, z: number) => Math.abs(H(x, z) - this.y) <= STEP && !this.city.regionAt(x, this.y, z);
    // (with room for the foot if there's such a place; else just off the detail)
    const fit = (base: P3, d0: number, s: number) => { for (const ok of [clear, loose]) for (const [d, l] of CAND) { const q = at(base, d0 + d, s, l * s); if (ok(q[0], q[2])) return { d, l: l * s, q }; } return null; };
    // (a takeoff ahead it's going for: the steps to it fitted so the takeoff foot comes down just short of the lip; none
    // left, it goes off this one)
    const run = this.planRunUp(p, side, fx, fz, sp);
    // (this foot the takeoff: the step after still planned as usual, in case the jump isn't taken)
    const takeoffHere = !!run && run.steps === 0;
    if (run && !takeoffHere) {
      const pd = (p[0] - this.x) * fx + (p[2] - this.z) * fz, q = fit(mid, pd + run.next - this.ahead_, -side);
      if (q) {
        const len = pd + run.next - this.ahead_ + q.d;
        this.nextFall = q.q; this.stepScale = Math.max(0.6, len / L); this.stepTo = L * this.stepScale; this.stepLift = Math.max(0, len / L - 1) * 2.2; this.shiftTarget = 0.4 * q.l;
        this.approach = { side: run.steps % 2 ? -side : side, at: run.steps === 1 ? q.q : null, steps: run.steps, stretch: len / L };
        // (and the step after, for this foot, from where the next will be: its spot known as it leaves the ground)
        const q2 = run.steps >= 2 ? fit(q.q, run.after, side) : null;
        this.setPlan(-side, q.q, q2 ? q2.q : null);
        return;
      }
    }
    this.approach = takeoffHere ? { side, at: p, steps: 0, stretch: 1 } : null;
    let a = fit(mid, L, -side); if (!a) { this.nextFall = null; this.stepScale = 1; this.stepTo = 0; this.planFor = { L: null, R: null }; return; }
    // (and the one after: if it needs a change, half of it taken by this step, where that's clear)
    const b = fit([mid[0] + fx * L, this.y, mid[2] + fz * L], L, side);
    if (a.d === 0 && a.l === 0 && b && b.d !== 0) { const q = at(mid, L + b.d / 2, -side, 0); if (clear(q[0], q[2])) a = { d: b.d / 2, l: 0, q }; }
    let over = false; for (let t = 0.2; t < 0.95; t += 0.2) { const x = p[0] + (a.q[0] - p[0]) * t, z = p[2] + (a.q[2] - p[2]) * t; if (this.city.regionAt(x, this.y, z)?.kind === 'clutter') over = true; }
    this.nextFall = a.q; this.stepScale = (L + a.d) / L; this.stepTo = L + a.d;
    this.setPlan(-side, a.q, b ? b.q : null);
    this.stepLift = Math.max(over ? 1 : 0, Math.max(0, a.d) / 0.4);
    if (a.d < -0.1) { this.vx *= 0.97; this.vz *= 0.97; }
    this.shiftTarget = 0.4 * a.l;
    if (a.d !== 0 || a.l !== 0) { this.adjusted++; if (a.d < 0) for (let d = 0.5; d <= 2.5; d += 0.5) if (Math.abs(H(this.x + fx * d, this.z + fz * d) - this.y) > STEP) { this.stutters++; break; } }
  }

  /**
   * The save: the catching foot (the side the hips are carrying to) put down where they're going, as far out as the error
   * asks, when it's needed (short: a short step at once, the hips behind; wide: out wide; long: two quick steps ahead, the
   * speed kept); the stride picked up from it, and the error taken out: the hips' carry stopped, the balance caught. True
   * while it's still to be placed (the feet as they landed meanwhile).
   */
  private placeSave(): boolean {
    const s = this.save!, f = this.feet, fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const at = s.kind === 'short' ? 0.1 : s.kind === 'wide' ? 0.08 : s.stage === 0 ? 0.05 : 0.16;
    if (s.stage >= (s.kind === 'long' ? 2 : 1)) { if (s.t > 0.45) this.save = null; return false; }
    if (s.t < at) {
      // (meanwhile, on the foot it came down on, under it; the other still coming through: the catching step, or straight
      // into a jump if one's taken first; not both feet set down side by side)
      const sd = this.lead ? 1 : -1, foot = sd > 0 ? f.L : f.R;
      if (!f.L.on && !f.R.on) { const x = this.x + fx * this.ahead_ * 0.5 + fz * sd * this.track_, z = this.z + fz * this.ahead_ * 0.5 - fx * sd * this.track_, h = this.city.heightAt(x, z); if (Math.abs(h - this.y) <= STEP && !this.city.regionAt(x, h, z)) { foot.on = true; foot.p = [x, h, z]; } }
      if (f.L.on) this.reach.fl = f.L.p; if (f.R.on) this.reach.fr = f.R.p; return true;
    }
    // (which foot: the one on the side the hips carry to; a long save's second step, the other)
    let side = s.ex * fz - s.ez * fx >= 0 ? 1 : -1; if (s.stage === 1) side = -side;
    const lat = s.kind === 'wide' ? 0.12 + Math.min(0.75, s.mag * 1.1) : 0.1, ahead = s.kind === 'short' ? 0.2 : s.kind === 'long' ? (s.stage ? 0.55 : 0.75) : 0.4;
    // (out to its side, and further toward where the hips are going)
    // (as far out as there's roof for it: in only as far as it has to)
    let x = this.x, z = this.z, got = -1;
    for (const k of [1, 0.8, 0.6, 0.4, 0.2, 0]) {
      x = this.x + fx * ahead + fz * side * 0.1 + s.ex * (lat - 0.1) * k; z = this.z + fz * ahead - fx * side * 0.1 + s.ez * (lat - 0.1) * k;
      if (Math.abs(this.city.heightAt(x, z) - this.y) <= STEP && !this.city.regionAt(x, this.y, z)) { got = k; break; }
    }
    // (nowhere for the catching foot: the save fails, and that's what happens: no foot set on air, nothing taken off the
    // way the hips were going; the stumble carries on into whatever's next, a run out, a hand, a fall)
    if (got < 0) { this.save = null; this.failedSaves++; return false; }
    const foot = side > 0 ? f.L : f.R; foot.on = true; foot.p = [x, this.city.heightAt(x, z), z];
    if (side > 0) f.R.on = false; else f.L.on = false;
    // (the stride picked up from it: this foot in its stance)
    this.phase = Math.PI / 2 + 0.3 - (side > 0 ? 0 : Math.PI) + 0.05;
    if (s.stage === 0) {
      // (as much of the way the hips were going taken off as the foot got out to take it: all the way out, most of it)
      const vl = this.vx * s.ex + this.vz * s.ez, take = 0.4 + 0.45 * got; if (vl > 0) { this.vx -= s.ex * vl * take; this.vz -= s.ez * vl * take; }
      this.balance *= 1 - 0.6 * (0.4 + 0.6 * got); this.balanceV *= 0.15; this.saves++;
      this.lastSave = { kind: s.kind, err: (s.ex * fz - s.ez * fx) * s.mag, foot: (x - this.x) * fz - (z - this.z) * fx };
    }
    s.stage++;
    if (side > 0) this.reach.fl = foot.p; else this.reach.fr = foot.p;
    return false;
  }

  /** Where the hands want to be, this instant. */
  private reaching(): Reach {
    const u = this.mu, L = this.lead === 1, fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    /** a point by the figure: `a` ahead, `s` to its left, `h` up */
    const by = (a: number, s: number, h: number): P3 => [this.x + fx * a + fz * s, this.y + h, this.z + fz * a - fx * s];
    // (on a rail swing: the one hand on the rail)
    if (this.state === 'swing' && this.rs) return this.rs.side > 0 ? { hl: [...this.rs.h] as P3 } : { hr: [...this.rs.h] as P3 };
    // (up a wall: what it has hold of, until it's gone by below the hips)
    if (this.state === 'climb' && this.atLip >= 0) {
      // (the near hand first; the far one only once the swing needs it, or before the pull)
      const w = this.sw, both = !w || w.t > 0.22 || Math.abs(w.s) > 0.35;
      return both ? { ...this.grips } : w!.near > 0 ? { hl: this.grips.hl } : { hr: this.grips.hr };
    }
    if (this.state === 'climb') {
      // (hanging: the hands on the hold, let go through the first part of a spring for the next, and on the next one)
      if (this.chain) return this.chain.phase === 2 && this.chain.t < 0.6 * (this.chain.dur ?? CHAIN_SPRING) ? {} : { ...this.grips };
      return this.mu < 0.88 ? { ...this.grips } : {};
    }
    if (this.state === 'chimney' && this.ch) {
      // (a hand on each wall, about the shoulders, a little ahead; the foot on the wall it has just kicked from)
      const c = this.ch, ahead = 0.25, y = this.y + 1.35;
      const onA: P3 = [c.ox + this.tx * (c.along + ahead), y, c.oz + this.tz * (c.along + ahead)];
      const onB: P3 = [c.ox - c.ax * c.gap + this.tx * (c.along + ahead), y, c.oz - c.az * c.gap + this.tz * (c.along + ahead)];
      const aLeft = c.ax * Math.cos(this.heading) - c.az * Math.sin(this.heading) > 0;
      const r: Reach = aLeft ? { hl: onA, hr: onB } : { hl: onB, hr: onA };
      if (c.t < 0.1) {
        const w: P3 = c.side > 0 ? [onA[0] - this.tx * ahead, this.y + 0.3, onA[2] - this.tz * ahead] : [onB[0] - this.tx * ahead, this.y + 0.3, onB[2] - this.tz * ahead];
        const nx = c.side > 0 ? c.ax : -c.ax, nz = c.side > 0 ? c.az : -c.az;
        // (found once a kick and kept: the foot pushes from where it's put while the body goes up off it)
        if (c.footKick !== c.kicks) { const g = this.city.gripAt(w[0], w[1], w[2], 0.35, (q) => q.kind === 'face' && q.nx * nx + q.nz * nz < -0.5); c.foot = g ? [g.x, g.y, g.z] : null; c.footKick = c.kicks; }
        if (c.foot) { r[this.lead === 1 ? 'fr' : 'fl'] = c.foot; r.fn = [-nx, 0, -nz]; }
      }
      return r;
    }
    if (this.state === 'plant') return this.stepFoot && this.stepAge < 0.15 ? { [this.lead === 1 ? 'fr' : 'fl']: this.stepFoot, fn: [-this.wx, 0, -this.wz] } : {};
    if (this.state === 'wall') {
      // (the near hand trails on the wall, about the shoulder's height, a little ahead)
      const p: P3 = [this.x + this.wx * (this.R_ + 0.02) + this.tx * 0.25, this.y + 1.3, this.z + this.wz * (this.R_ + 0.02) + this.tz * 0.25];
      return this.wallSide > 0 ? { hl: p } : { hr: p };
    }
    if (this.state === 'air') {
      if (this.move === 'underbar' && this.plant && this.plant2 && u > 0.1 && u < 0.7) return { hl: this.plant, hr: this.plant2 };
      // (falling past a wall, or into one: a hand on its face, about the shoulder, steadying)
      if (this.move === 'fall' || this.move === 'kick') {
        const out: Reach = {}, lx = Math.cos(this.heading), lz = -Math.sin(this.heading);
        for (const [ax, az] of AXES) {
          let d = 0; for (let k = this.R_; k <= 0.75; k += 0.08) if (this.city.heightAt(this.x + ax * k, this.z + az * k) > this.y + 1.5) { d = k; break; }
          if (!d) continue;
          const g = this.city.gripAt(this.x + ax * d, this.y + 1.3, this.z + az * d, 0.25, (o) => o.kind === 'face' && o.nx * ax + o.nz * az < -0.5);
          if (!g) continue;
          const left = ax * lx + az * lz;
          if (left >= 0 && !out.hl) out.hl = [g.x, g.y, g.z]; else if (left <= 0 && !out.hr) out.hr = [g.x, g.y, g.z];
        }
        if (out.hl || out.hr) return out;
      }
      // (a cartwheel: the hand on the side it turns over to first, the other after it, each let go in turn)
      if (this.move === 'vault' && this.wheel && this.plant && this.plant2) { const a = u > 0.14 && u < 0.6, b = u > 0.3 && u < 0.78, first = L ? 'hr' : 'hl', second = L ? 'hl' : 'hr', out: Reach = {}; const pf = L ? this.plant2 : this.plant, ps = L ? this.plant : this.plant2; if (a) out[first] = pf; if (b) out[second] = ps; return out; }
      if (this.move === 'vault' && this.plant && u > 0.12 && u < 0.82) return this.plant2 ? { hl: this.plant, hr: this.plant2 } : L ? { hr: this.plant } : { hl: this.plant };
      if (this.move === 'spring' && this.lip && u > 0.6) return { hl: this.lip[0], hr: this.lip[1] };
      return {};
    }
    // (steadying: the near hand on a wall in reach, about the shoulder, a little ahead)
    if (this.state === 'ground' && this.steady && this.press <= 0) {
      const s = this.steady, side = s.ax * Math.cos(this.heading) - s.az * Math.sin(this.heading), fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      const p: P3 = [this.x + s.ax * (s.d + 0.02) + fx * 0.2, this.y + 1.3, this.z + s.az * (s.d + 0.02) + fz * 0.2];
      const g = this.city.gripAt(p[0], p[1], p[2], 0.3, (o) => o.kind === 'face' && o.nx * s.ax + o.nz * s.az < -0.5);
      if (g) return side >= 0 ? { hl: [g.x, g.y, g.z] } : { hr: [g.x, g.y, g.z] };
    }
    // (braced against a wall it's pressing into: both hands on it, about the shoulders)
    if (this.state === 'ground' && this.press > 0) {
      const wx = this.x + this.pax * (this.R_ + 0.03), wz = this.z + this.paz * (this.R_ + 0.03);
      return { hl: [wx - this.paz * 0.24, this.y + 1.35, wz + this.pax * 0.24], hr: [wx + this.paz * 0.24, this.y + 1.35, wz - this.pax * 0.24] };
    }
    // (a short landing: the hand on the catching side slapped down ahead)
    if (this.save?.kind === 'short' && this.save.t < 0.22) { const sd = this.saveSide ?? 1; const p = by(0.5, sd * 0.24, 0); return sd > 0 ? { hl: p } : { hr: p }; }
    // (coming up out of a roll: one hand pushing off the ground as the weight comes over the front foot)
    if (this.move === 'roll' && u > 0.6 && u < 0.84) return L ? { hr: by(0.3, -0.2, 0) } : { hl: by(0.3, 0.2, 0) };
    // (out of a dive, both hands to the ground first; a deep landing, one)
    if (this.move === 'roll' && u < 0.28) return { hl: by(0.45, 0.16, 0), hr: by(0.45, -0.16, 0) };
    if (this.move === 'run' && this.land > 0.5) return L ? { hr: by(0.38, -0.26, 0) } : { hl: by(0.38, 0.26, 0) };
    return {};
  }

  private ground(dt: number, mag: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    const H = (x: number, z: number) => this.city.heightAt(x, z);
    this.runT = mag > 0.5 ? this.runT + dt : 0;
    // (how long it's been asked off the line it's running: a turn set up early, or one asked at the last moment)
    { const s0 = this.speed; if (on && s0 > 2 && (dx * this.vx + dz * this.vz) / (s0 * (Math.hypot(dx, dz) || 1)) < Math.cos(0.26)) this.turnAsk += dt; else this.turnAsk = 0; }
    if (jump) this.to.buffer = 0.22;
    if (this.railCatch(dx, dz, mag)) return;
    if (this.rollT > 0) { this.rollT -= dt; this.mu = 1 - Math.max(0, this.rollT) / this.rollDuration; }
    if (this.dashT > 0) this.dashT = on ? this.dashT - dt : 0;
    if (!on || mag < 0.65 || this.vx * dx + this.vz * dz < this.speed * 0.65) this.pushPending = false;
    if (this.pushPending && this.legVelocity <= 0 && this.rollT <= 0 && this.inStance()) {
      this.pushPending = false; this.dashT = TUNE.dashTime;
      this.dashes++; this.count('dash');
    }
    let sp = this.speed;
    // (somewhere narrow: lower on both sides)
    const fx = sp > 1 ? this.vx / sp : Math.sin(this.heading), fz = sp > 1 ? this.vz / sp : Math.cos(this.heading);
    const ledge = this.y > 0 && H(this.x - fz * 0.8, this.z + fx * 0.8) < this.y - STEP && H(this.x + fz * 0.8, this.z - fx * 0.8) < this.y - STEP;
    const k = Math.min(1, Math.max(0, (this.runT - 0.5) / 2));
    let top = this.dashT > 0 ? TUNE.dash : Math.pow(mag, 1.5) * (TUNE.run + (TUNE.sprint - TUNE.run) * k * k * (3 - 2 * k));
    if (ledge) {
      top = Math.min(top, TUNE.ledgeSpeed);
      // (and if it runs our way, drawn onto its line)
      const b = this.city.topAt(this.x, this.z);
      if (b && on) {
        const w = b.x1 - b.x0, d = b.z1 - b.z0;
        if (w <= 2 && d > w && Math.abs(dz) > 1 - 0.66 * TUNE.ledgePull) { dx = 0; dz = Math.sign(dz); this.x += ((b.x0 + b.x1) / 2 - this.x) * (1 - Math.exp(-10 * dt)); }
        else if (d <= 2 && w > d && Math.abs(dx) > 1 - 0.66 * TUNE.ledgePull) { dz = 0; dx = Math.sign(dx); this.z += ((b.z0 + b.z1) / 2 - this.z) * (1 - Math.exp(-10 * dt)); }
      }
    }
    // (down or up a flight of stairs (the ground stepping steadily a step at a time), and a beat off its end: no faster than
    // feet can be placed on treads (two at a time), about 8 m/s)
    { const a1 = H(this.x + fx * 0.7, this.z + fz * 0.7) - this.y, a2 = H(this.x + fx * 1.4, this.z + fz * 1.4) - this.y;
      if (Math.abs(a1) > 0.15 && Math.abs(a1) <= STEP && Math.abs(a2) > Math.abs(a1) + 0.15 && Math.sign(a1) === Math.sign(a2) && Math.abs(a2) <= 2 * STEP + 0.1) this.stairT = 0.4;
      if (this.stairT > 0) { this.stairT -= dt; top = Math.min(top, 8); } }
    // Shed pace on the roof when the next step is a storey higher.
    const brakeAhead = this.R_ + sp * 0.20;
    if (on && sp > TUNE.run && H(this.x + fx * brakeAhead, this.z + fz * brakeAhead) >= this.y + 1.2) top = Math.min(top, TUNE.run);
    if (this.rollT > 0) top = Math.min(sp, top);
    if (this.stickT > 0) { this.stickT -= dt; top = Math.min(top, 1.5); }
    // (a roll is its own absorb: the save waits until it's come out of it)
    if (this.save && this.rollT <= 0) this.save.t += dt;
    // (after a big arrival with nothing near to go for: a couple of settling strides, not a burst)
    if (this.breathT > 0) { this.breathT -= dt; top = Math.min(top, TUNE.run); }
    this.move = this.rollT > 0 ? 'roll' : this.dashT > 0 ? 'dash' : ledge ? 'ledge' : 'run';
    // (toward the wanted velocity, at a fixed rate: a turn is quick, a reversal a skid)
    // (while the legs are still taking a landing it drives less: the landing is a beat, and the burst comes out of it; let
    // go with room ahead, it settles, through a walk to a stand, over about a second; with no room, it stops short)
    const settling = !on && sp > 0.5 && this.rollT <= 0 && (() => { const s = (sp * sp) / (2 * TUNE.accel * 0.25) + 0.15; return !this.edgeAlong(fx, fz, 0.25, s, 0.25); })();
    // (and while a landing is still being recovered from, or it's off balance, it drives less; spent, it runs a little slower)
    if (this.recoverT > 0) this.recoverT -= dt;
    top *= 0.9 + 0.1 * this.stamina;
    const drive = (this.recoverT > 0 ? 0.5 : 1) * (1 - Math.min(0.5, Math.abs(this.balance) * 2));
    // (let go running at a lip: braked only as hard as it takes to come to a stand just short of it (the last step close to
    // the edge), not stopped a body's length back)
    let edgeD = 0; if (!on && sp > 0.5 && !settling && this.rollT <= 0) for (let d = 0.3; d <= 6; d += 0.1) if (H(this.x + fx * d, this.z + fz * d) < this.y - STEP) { edgeD = d; break; }
    const atLip = edgeD > 0 ? Math.min(1, (sp * sp) / (2 * Math.max(0.05, edgeD - 0.42)) / TUNE.accel) : 1;
    const tx = dx * top, tz = dz * top, ex = tx - this.vx, ez = tz - this.vz, e = Math.hypot(ex, ez); let a = (this.rollT > 0 ? TUNE.accel * 0.3 : settling ? TUNE.accel * 0.25 : TUNE.accel * Math.max(0.3, atLip) * (1 - 0.6 * this.land) * drive * (this.vx * ex + this.vz * ez >= 0 || sp < 0.1 ? Math.min(1, 0.3 + sp / 4) : 1)) * dt;
    // (getting going on a light press: from a stand the weight goes onto the first step over a quarter second, a couple of m/s²
    // and more as it gets going, as a person's does, not launched to a walk in a frame and left coasting on a foot behind it
    // once the thumb's gone (a brush of the stick is a step, not a stroll); a full press still bursts off, and once going (over
    // 1.2 m/s) it's the stride's own business, turns and all)
    { const easy = (1 - Math.max(0, Math.min(1, (mag - 0.45) / 0.35))) * (1 - sm01((sp - 0.6) / 0.6)), gain = this.vx * ex + this.vz * ez >= 0 || sp < 0.1;
      if (easy > 0 && gain && !this.rollT) a = Math.min(a, a + ((2.5 + 4 * sp) * dt - a) * easy); }
    // (come to a stand close to a lip it ran at: a balance check, the body tipping out over it and back, the arms out)
    if (this.teeterT > 0) this.teeterT = Math.max(0, this.teeterT - dt);
    if (sp > 2.5) this.teetered = false;
    if (!on && !this.teetered && sp < 0.4 && this.rollT <= 0) {
      const ux = Math.sin(this.heading), uz = Math.cos(this.heading);
      if ([0.3, 0.45, 0.6].some((d) => H(this.x + ux * d, this.z + uz * d) < this.y - STEP)) { this.teeterT = TEETER; this.teetered = true; this.count('teeter' as Move); }
    }
    // (turning at pace takes a plant and a moment: the way it's going swings round only as fast as the feet can push it
    // sideways (about 19 m/s² at 13 m/s, a 35° change in under half a second; at a walk, at once): so a change of mind
    // late into a takeoff is still being made as it leaves)
    let cx = e <= a ? ex : (ex / e) * a, cz = e <= a ? ez : (ez / e) * a;
    if (sp > 3) { const ux0 = this.vx / sp, uz0 = this.vz / sp, lat = -cx * uz0 + cz * ux0, most = (14 + 60 / sp) * dt; if (Math.abs(lat) > most) { const k = (Math.sign(lat) * most - lat); cx += -uz0 * k; cz += ux0 * k; } }
    // (running, the feet make the cut: the body is braked and turned only while a foot is down, none of it in the air between
    // steps, and with a foot down that much harder (up to three times, all of it from 5 m/s), so the change of way lands in
    // the foot that's planted and is seen to, while the whole of it takes about as long as before; only running on the open
    // roof (not along something narrow, where the feet are its own), not stopping short of a lip it was let go at, nor in a roll)
    { const runK = sp > 3 && edgeD <= 0 && this.rollT <= 0 && this.move === 'run' ? sm01((sp - 3) / 2) : 0;
      if (runK > 0) {
        const ux0 = this.vx / sp, uz0 = this.vz / sp, down = this.feet.L.on || this.feet.R.on;
        const split = (x: number, z: number) => { const al = x * ux0 + z * uz0; return { fwd: Math.max(0, al), br: Math.min(0, al), la: -x * uz0 + z * ux0 }; };
        const c0 = split(cx, cz); let br = c0.br, la = c0.la;
        if (!down) { br *= 1 - runK; la *= 1 - runK; }
        else {
          // (braked only on a foot that's ahead of the hips, as walking is)
          let ahead = -9; for (const ft of [this.feet.L, this.feet.R]) if (ft.on) ahead = Math.max(ahead, (ft.p[0] - this.x) * ux0 + (ft.p[2] - this.z) * uz0);
          const skid = on && (dx * this.vx + dz * this.vz) / sp < -0.5, B = 1 + 2 * runK, eS = split(ex, ez); br = Math.max(eS.br, c0.br * B) * (skid ? 1 : sm01((ahead + 0.05) / 0.2)); la = Math.sign(eS.la) * Math.min(Math.abs(eS.la), Math.abs(c0.la) * B);
        }
        const al = c0.fwd + br; cx = ux0 * al - uz0 * la; cz = uz0 * al + ux0 * la;
      } }
    // (and braking or turning takes the feet: the body is a weight carried over them, and they can push it back or round only
    // so hard (`grip`, about 1.4 g), so a hard stop or a sharp turn at pace is two or three steps, leaning against them, not a
    // frame; except stopping short of a lip it was let go at, and in a roll. Slower, less: a walker pushes the body round
    // only as far as a foot is out from under it (about 2.5 m/s² and 1.6 more for each m/s), so a sharp turn at a walk is
    // stepped round over half a second, not spun on one foot. Running (from 3 m/s, all of it by 5) it's left to the run's own
    // handling, which the courses are made for; and a reversal (asked back against the way it's going) is a skid, braked
    // as hard as the run brakes)
    if (sp > 0.3 && sp < 5 && edgeD <= 0 && this.rollT <= 0 && !(on && (dx * this.vx + dz * this.vz) / sp < -0.5)) {
      const ux0 = this.vx / sp, uz0 = this.vz / sp, along = cx * ux0 + cz * uz0, lat = -cx * uz0 + cz * ux0; let br = Math.min(0, along);
      // (and only braked by a foot that's ahead of it: a foot behind the hips can only push them on, so passing over the one
      // foot down, it carries on until the next comes down ahead to brake on; a stop is braking steps, not a glide)
      { let ahead = -9; for (const ft of [this.feet.L, this.feet.R]) if (ft.on) ahead = Math.max(ahead, (ft.p[0] - this.x) * ux0 + (ft.p[2] - this.z) * uz0); br *= ahead < -8 ? 0.3 : Math.max(sm01((ahead + 0.05) / 0.2), 0.7 * (1 - sm01((sp - 0.4) / 0.5))); }
      // (slower than a walk, the foot under it is enough: the body's checked over its ankle and hips, a brushed step ending
      // where it was going instead of drifting on until a foot comes down ahead)
      const g = Math.hypot(br, lat), most = Math.min(TUNE.grip, 2.5 + 1.6 * sp) * dt / Math.max(1e-3, 1 - sm01((sp - 3) / 2));
      { const k = g > most ? most / g : 1, a2 = Math.max(0, along) + br * k, l2 = lat * k; cx = ux0 * a2 - uz0 * l2; cz = uz0 * a2 + ux0 * l2; }
    }
    // (what the feet are doing to the body, for the figure to lean against: along the way it's going and across it, eased)
    { const kk = 1 - Math.exp(-12 * dt), ux0 = sp > 0.3 ? this.vx / sp : Math.sin(this.heading), uz0 = sp > 0.3 ? this.vz / sp : Math.cos(this.heading), al = (cx * ux0 + cz * uz0) / dt, la = (-cx * uz0 + cz * ux0) / dt;
      this.pushAlong += (al - this.pushAlong) * kk; this.pushAcross += (la - this.pushAcross) * kk; }
    this.vx += cx; this.vz += cz;
    sp = this.speed;
    // (the stride: a step's worth of phase by the step's length; a planned long step slower, a short one quicker. But never
    // a step much longer than this pace's own: slowing, a stride planned at speed isn't kept, or the cycle crawls over it
    // and the legs hold a split while the body glides; well under the pace it was planned at, the plan is let go)
    if (this.stepTo && sp < 3 && this.stepTo > this.stepLenOf(sp) * 1.45) { this.stepTo = 0; this.stepScale = 1; this.nextFall = null; this.planFor = { L: null, R: null }; }
    this.phase += this.phaseRate * dt;
    // (the body's line drawn toward a footfall set out to the side, and back)
    { const k = 1 - Math.exp(-8 * dt), d = (this.shiftTarget - this.shift) * k, lx = Math.cos(this.heading), lz = -Math.sin(this.heading);
      if (Math.abs(this.city.heightAt(this.x + lx * d, this.z + lz * d) - this.y) <= STEP) { this.x += lx * d; this.z += lz * d; this.shift += d; }
      this.shiftTarget *= Math.exp(-3 * dt); }
    this.to.buffer = Math.max(0, this.to.buffer - dt);
    const preparing = this.to.buffer > 0 && this.rollT <= 0;
    if (preparing) {
      if (!this.committed) this.to.left = this.leftSupports();
      this.committed = true;
      // (the wind-up as long as the jump needs: from a stand a real dip (a fifth of a second and more), at a run a beat)
      this.load = Math.min(1, this.load + dt / (0.115 + 0.11 * (1 - Math.min(1, this.speed / 4))));
      if (this.load >= 1 || (this.load >= 0.65 && this.inStance())) {
        this.effort = 0.8; if (this.tame()) return;
        if (this.plantFirst(Math.sin(this.heading), Math.cos(this.heading), 1)) return;
        (this.takeoffBy = 'tap', this.strongJump()); return;
      }
    }
    // (a run-up's takeoff foot down: gone off it as the body comes over it, the wind-up taken through the contact)
    const ap = this.approach;
    if (ap && ap.steps === 0 && ap.at && on && !preparing && this.rollT <= 0 && mag >= 0.55 && sp > 2) {
      const ux = this.vx / sp, uz = this.vz / sp, ft = ap.side > 0 ? this.feet.L : this.feet.R, past = (this.x - ap.at[0]) * ux + (this.z - ap.at[2]) * uz;
      this.to.left = ap.side > 0;
      // (a jump taken while a landing's still being sunk into goes from that load: a rebound)
      this.load = Math.max(this.load, this.land * 0.9, Math.min(1, 0.5 + (past + 0.25) * 1.5, this.load + dt * 10));
      if (past >= 0.1 + 0.012 * sp || !ft.on) {
        const edge = this.edgeAlong(ux, uz, 0.1, 3.5 * this.stepLenOf(sp), 0.1);
        if (edge && H(this.x + ux * edge, this.z + uz * edge) <= this.y + TUNE.rise) {
          const rise = H(this.x + ux * edge, this.z + uz * edge) - this.y;
          this.effort = Math.max(this.effort, rise > 1.2 ? Math.min(1, 0.5 + rise / 6.8) : 0.2); this.load = Math.max(this.load, 0.65); this.offFoot++;
          if (this.tame()) return;
          if (this.plantFirst(ux, uz, edge)) return;
          this.takeoffBy = 'runup'; const nt = this.offNarrow(ux, uz, dx, dz, sp); if (nt === 'over') { this.overrunOff(ux, uz, dx, dz, sp); return; } this.leap(nt ? nt[0] : ux, nt ? nt[1] : uz, nt ? Math.min(edge, 0.3) : edge, sp); return;
        }
        this.approach = null;
      }
    }
    if (on) {
      // (the way it looks: the way it's going, or from a stand the way it's asked)
      const ux = sp > 2 ? this.vx / sp : dx, uz = sp > 2 ? this.vz / sp : dz, ahead = 0.45 + sp * 0.06;
      // Find the lip one support beat early. Stay on the roof while the last foot takes weight.
      const stride = 2 * this.stepLenOf(sp);
      const probe = ahead + Math.min(1.4, stride * 0.3);
      let edge = 0;
      if (ux * dx + uz * dz > 0.3) {
        edge = this.edgeAlong(ux, uz, 0.2, probe + 0.19, 0.2);
      }
      // (something chest to head high, come at slowly: walked up to and climbed onto, not sprung at)
      const stepUp = edge ? H(this.x + ux * edge, this.z + uz * edge) - this.y : 0, mantling = sp < 6 && stepUp >= 0.9 && stepUp <= 1.9;
      if (edge && !preparing && this.rollT <= 0 && mag >= 0.55 && !mantling &&
          H(this.x + ux * edge, this.z + uz * edge) <= this.y + TUNE.rise) {
        // (a run-up in hand: its steps take it to the takeoff foot; the wind-up only begun, the jump not before that foot,
        // unless the lip's right there)
        if (this.approach) {
          if (this.approach.steps >= 1) this.load = Math.min(this.approach.steps === 1 ? 0.3 + 0.4 * this.effort : 0.15 + 0.25 * this.effort, this.load + dt * 6);
          if (edge <= this.R_ + sp * dt) { if (this.tame()) return; if (this.plantFirst(ux, uz, edge)) return; if (this.approach.steps === 0) this.offFoot++; this.takeoffBy = this.approach.steps === 0 ? 'runup-lip' : 'runup-short'; const nt = this.offNarrow(ux, uz, dx, dz, sp); if (nt === 'over') { this.overrunOff(ux, uz, dx, dz, sp); return; } this.leap(nt ? nt[0] : ux, nt ? nt[1] : uz, nt ? Math.min(edge, 0.3) : edge, sp); return; }
        } else {
        if (this.load < 0.1) {
          // The next contact unless a foot is already supporting the runner.
          // (in the air between steps, the foot that comes down next is the one taken off from, and the stride is
          // left to bring it down; only one a long way off is hurried to it)
          const nf = this.inStance() ? null : this.nextFoot;
          this.to.left = nf ? nf.side > 0 : this.leftSupports();
          if (!this.inStance() && (!nf || nf.t > 0.15)) this.phase = Math.floor(this.phase / (2 * Math.PI)) * 2 * Math.PI + Math.PI / 2 + 0.31 + (this.to.left ? 0 : Math.PI);
        }
        // (the wind-up as big as what's ahead asks: up a storey, deeper and longer; across or down, quick; spent, slower)
        const rise = H(this.x + ux * edge, this.z + uz * edge) - this.y;
        if (this.load < 0.1 || !this.effort) this.effort = Math.max(this.effortFor(ux, uz, edge, sp), rise > 1.2 ? Math.min(1, 0.5 + rise / 6.8) : 0.2);
        this.load = Math.min(1, this.load + dt * (9 - 4 * this.effort) * (0.7 + 0.3 * this.stamina));
        if ((this.load >= 0.65 && edge <= ahead) || edge <= this.R_ + sp * dt) {
          if (this.tame()) return;
          if (this.plantFirst(ux, uz, edge)) return;
          // (off a narrow top: only as far round as the foot on it can turn the body; asked further, over the side)
          const nt = this.offNarrow(ux, uz, dx, dz, sp);
          if (nt === 'over') { this.overrunOff(ux, uz, dx, dz, sp); return; }
          this.takeoffBy = 'edge'; this.leap(nt ? nt[0] : ux, nt ? nt[1] : uz, nt ? Math.min(edge, 0.3) : edge, sp); return;
        }
        }
      } else if (!preparing) this.load = Math.max(0, this.load - dt * 8);
    } else if (!preparing) this.load = Math.max(0, this.load - dt * 8);
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt, h = H(nx, nz);
    if (preparing && Math.abs(h - this.y) > STEP) {
      // Finish the supporting step when a tap arrives right on the boundary.
      if (this.load >= 0.65) (this.takeoffBy = 'tap-boundary', this.strongJump());
      return;
    }
    if (Math.abs(h - this.y) <= STEP) {
      const vx0 = this.vx, vz0 = this.vz;
      this.x = nx; this.z = nz; this.y = h;
      if (this.resolve(STEP)) { this.y = H(this.x, this.z); if (on && !preparing && this.metWall(dt, dx, dz, mag, vx0, vz0)) return; }
    }
    else if (h < this.y && mag < 0.55 && sp < 6) { this.vx = this.vz = 0; }
    else if (h < this.y) { this.x = nx; this.z = nz; this.vy = 0; this.launch(0, 'fall', false, false, 0.3); this.leaps--; }
    // (a corner the look ahead went past: leapt, from where it stands)
    else if (on && h <= this.y + TUNE.rise && mag >= 0.55) { if (!this.plantFirst(dx, dz, 0.05)) { this.takeoffBy = 'corner'; this.leap(dx, dz, 0.05, sp); } }
    // (a tall wall met at a slant, at pace, with wall going on along it: stepped onto off one foot, and run along)
    else if (on && sp >= 4 && this.seek(0.85, dx, dz)) return;
    else if (on && this.goFor(dt, dx, dz, nx, nz)) return;
    else if (on) {
      const xFree = Math.abs(H(nx, this.z) - this.y) <= STEP;
      const zFree = Math.abs(H(this.x, nz) - this.y) <= STEP;
      if (xFree && (!zFree || Math.abs(this.vx) >= Math.abs(this.vz))) { this.x = nx; this.vz = 0; }
      else if (zFree) { this.z = nz; this.vx = 0; }
      else this.vx = this.vz = 0;
      this.y = H(this.x, this.z);
    }
    else { this.vx = 0; this.vz = 0; }
  }

  /**
   * Pressed into a tall wall, met near square, with a hold in reach (its top, or a sill on the way up it): after a beat
   * it goes for it, as a tap would, carried a little into the wall so the jump meets it and a foot is planted.
   */
  private goFor(dt: number, dx: number, dz: number, nx: number, nz: number): boolean {
    if (!TUNE.walls || this.wallCool > 0 || this.to.buffer > 0 || this.time - this.goneFor < 1.2) return false;
    const H = (x: number, z: number) => this.city.heightAt(x, z);
    let ax = 0, az = 0;
    for (const [bx, bz] of AXES) if (bx * dx + bz * dz > 0.65 && H(this.x + bx * (this.R_ + 0.1), this.z + bz * (this.R_ + 0.1)) > this.y + TUNE.rise) { ax = bx; az = bz; }
    if (!ax && !az) { this.press = 0; return false; }
    const wx = this.x + ax * (this.R_ + 0.3), wz = this.z + az * (this.R_ + 0.3), top = H(wx, wz);
    // (its top in a jump and a reach; or a sill or a pipe anywhere up the way there, from a reach above the head up: a sill at
    // a storey is as good a start up a face as one at the top of the jump)
    const apex = (10.5 * 10.5) / (2 * TUNE.gravity), sill = (g: Hold) => (g.kind === 'sill' || g.kind === 'pipe') && g.nx * ax + g.nz * az < -0.5;
    let reachable = top - this.y <= apex + this.armReach + 0.38;
    for (let h = 1.8; !reachable && h <= apex + this.armReach - 0.3; h += 0.8) reachable = !!this.city.gripAt(wx, this.y + h, wz, 0.9, sill);
    if (!reachable) { this.press = 0; return false; }
    this.press += dt; this.pax = ax; this.paz = az;
    if (this.press < BRACE) return false;
    this.press = 0; this.to.buffer = 0.22; this.goneFor = this.time; this.toWall = [ax, az];
    // (into it: so the jump meets the wall)
    // (the pace along the wall kept; into it, a step's worth)
    const along = Math.abs(ax) ? this.vz : this.vx; void nx; void nz;
    this.vx = ax ? ax * 2.5 : along; this.vz = az ? az * 2.5 : along;
    return true;
  }

  /** a big wind-up, before it goes: held at full load a moment (the emphasis); true while it's being held */
  private tame(): boolean {
    // (only from a stand, or a hold: a running takeoff is never stopped to be held)
    if (TUNE.emphasis <= 0 || this.effort < 0.5 || this.tamed || this.speed > 3) { this.tamed = false; return false; }
    this.tamed = true; this.load = 1; this.freeze = (0.04 + 0.05 * this.effort) * TUNE.emphasis;
    return true;
  }
  /**
   * A takeoff needs a foot under it: if neither is down (the stride between footfalls), the next one's put down now,
   * under the body and short of the lip, and the jump's taken off it next step (the body not moved meanwhile, so it
   * doesn't go off the edge first). True if it planted (and the takeoff waits).
   */
  private plantFirst(ux: number, uz: number, edge: number): boolean {
    const f = this.feet;
    if (this.state !== 'ground' || f.L.on || f.R.on) return false;
    const nf = this.nextFoot, side = nf ? nf.side : this.lead ? 1 : -1, foot = side > 0 ? f.L : f.R;
    const d = Math.max(0, Math.min(this.ahead_, edge - 0.15));
    let x = this.x + ux * d + uz * side * this.track_, z = this.z + uz * d - ux * side * this.track_, h = this.city.heightAt(x, z);
    // (on something narrow, on its line: one foot in front of the other)
    if (Math.abs(h - this.y) > STEP) { x = this.x + ux * d; z = this.z + uz * d; h = this.city.heightAt(x, z); }
    if (Math.abs(h - this.y) > STEP) { x = this.x; z = this.z; h = this.y; }
    foot.on = true; foot.p = [x, h, z]; foot.done = false;
    this.phase = Math.floor(this.phase / (2 * Math.PI)) * 2 * Math.PI + Math.PI / 2 + 0.31 + (side > 0 ? 0 : Math.PI);
    if (side > 0) this.reach.fl = foot.p; else this.reach.fr = foot.p;
    this.to.left = side > 0; this.approach = { side, at: foot.p, steps: 0, stretch: 1 };
    return true;
  }
  /** a big release spends effort */
  private spend(e: number): void { this.stamina = Math.max(0, this.stamina - e * 0.18); this.spentT = 0; }

  /**
   * A landing taken in the legs, as deep as what it brought: the depth by the energy (the impact speed squared, against
   * the most the legs can push), the legs softer the deeper it goes, so a big one sinks further and for longer.
   */
  private sinkInto(impact: number, k: number): void {
    // (the legs give with how fast the body comes down: a bound's landing at 3–4 m/s sinks a hand's breadth into the landing
    // leg, a storey's drop all the way; had been by the square of it, so anything but a big drop barely bent a knee)
    const e2 = Math.min(1, impact / 15), e = e2 * e2, depth = 0.46 * Math.min(1, (0.04 + 1.3 * e2) * k);
    // (and softer: the weight taken over a stride or two, not snapped back in a tenth of a second)
    this.sinkK = 120 * (1 - 0.4 * e); this.legVelocity = depth * Math.sqrt(this.sinkK) / 0.45;
  }
  /** the legs' stiffness taking the landing now */
  private sinkK = 175;
  /**
   * How much a takeoff has to give (0..1): the press (light to full), the foot (off one planted for it, with the load
   * taken, or caught between footfalls), the effort left.
   */
  private takeoffPower(): number {
    const press = Math.max(0, Math.min(1, (this.mag - 0.55) / 0.4)), foot = (this.feet.L.on || this.feet.R.on ? 1 : 0.7) * (this.approach?.steps === 0 ? 1 : 0.9);
    return Math.max(0, Math.min(1, 0.45 * press + 0.35 * foot + 0.2 * this.stamina));
  }
  /** the last leap was cut short of what it was meant for (the takeoff hadn't the power) */
  shortOf = false;
  private resetTakeoff(): void { this.to.buffer = 0; this.to.load = 0; this.to.committed = false; }

  /**
   * The body is a circle (radius this.R_) about its middle, not a point: anything standing more than `lift` above the feet within
   * it is in the way. Pushed out of whatever it overlaps (exactly: the city is boxes), the speed into it taken off and the
   * rest kept (it slides along); and the contact reported: the way out of the wall and how hard it was met. Met hard (at
   * more than 3 m/s into it) on the ground, it's a hit: a knock to the balance, pace lost, a moment to recover.
   */
  private resolve(lift: number): boolean {
    let px = 0, pz = 0, hit = false;
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (const b of this.city.boxesNear(this.x, this.z, this.R_ + 0.05)) {
        if (b.y1 <= this.y + lift || b.y0 > this.y + this.height_) continue;
        const cx = Math.max(b.x0, Math.min(b.x1, this.x)), cz = Math.max(b.z0, Math.min(b.z1, this.z));
        let dx = this.x - cx, dz = this.z - cz, d = Math.hypot(dx, dz);
        if (d >= this.R_) continue;
        if (d < 1e-6) {
          // (the middle inside it: out by the nearest face)
          const e = [this.x - b.x0, b.x1 - this.x, this.z - b.z0, b.z1 - this.z], m = Math.min(...e), k = e.indexOf(m);
          dx = k === 0 ? -1 : k === 1 ? 1 : 0; dz = k === 2 ? -1 : k === 3 ? 1 : 0; d = -m;
        } else { dx /= d; dz /= d; }
        const push = this.R_ - d; this.x += dx * push; this.z += dz * push; px += dx; pz += dz; moved = hit = true;
      }
      if (!moved) break;
    }
    if (!hit) return false;
    const l = Math.hypot(px, pz) || 1, nx = px / l, nz = pz / l, into = -(this.vx * nx + this.vz * nz);
    if (into > 0) { this.vx += nx * into; this.vz += nz * into; }
    this.contact = { nx, nz, into: Math.max(0, into), t: 0 };
    return true;
  }

  /**
   * On the ground, its breadth met a wall: what it does about it, as it would have when its middle got there. Within a
   * storey and gone at: leapt onto. Tall, met at a slant at pace: run along. Tall, pressed into: braced, and gone for.
   * Else it slides along; met hard (more than 3 m/s into it), a hit: a knock to the balance, pace lost, a moment to recover.
   */
  private metWall(dt: number, dx: number, dz: number, mag: number, vx0: number, vz0: number): boolean {
    const c = this.contact, facing = -(dx * c.nx + dz * c.nz);
    // (how high what it met is: behind the contact, and along the way it's asked (in a corner the contact is between two
    // walls, and either can be the taller))
    const top = Math.max(this.city.heightAt(this.x - c.nx * (this.R_ + 0.05), this.z - c.nz * (this.R_ + 0.05)), this.city.heightAt(this.x + dx * (this.R_ + 0.1), this.z + dz * (this.R_ + 0.1)));
    const keep = () => { this.vx = vx0; this.vz = vz0; }, lose = () => { const v = this.vx * c.nx + this.vz * c.nz; if (v < 0) { this.vx -= c.nx * v; this.vz -= c.nz * v; } };
    const s0 = Math.hypot(vx0, vz0), ux = s0 > 2 ? vx0 / s0 : dx, uz = s0 > 2 ? vz0 / s0 : dz;
    // (only if, that way, there's somewhere to land within a storey before anything taller: else it's a wall, not a step)
    const landable = (() => { for (let d = 0.2; d <= 3.2; d += 0.25) { const h = this.city.heightAt(this.x + ux * d, this.z + uz * d); if (h > this.y + TUNE.rise) return false; if (h > this.y + STEP) return true; } return false; })();
    if (this.ticTac(dx, dz, mag, vx0, vz0)) return true;
    if (Math.hypot(vx0, vz0) <= 6 && this.mantle(dx, dz, mag)) return true;
    if (facing > 0.3 && top <= this.y + TUNE.rise && landable && mag >= 0.55 && this.time - this.metT > 0.8) { if (this.plantFirst(ux, uz, 0.3)) return true; this.metT = this.time; keep(); this.takeoffBy = 'metwall'; this.leap(ux, uz, 0.05, s0); return true; }
    keep();
    if (Math.hypot(vx0, vz0) >= 4 && this.seek(0.85, dx, dz)) return true;
    lose();
    if (this.mantle(dx, dz, mag)) return true;
    if (this.goFor(dt, dx, dz, this.x, this.z)) return true;
    if (this.chimneyUp(dt, dx, dz, mag)) return true;
    if (c.into > 3) {
      this.bumps++; this.recoverT = Math.max(this.recoverT, 0.2); this.vx *= 0.7; this.vz *= 0.7;
      // (knocked to the side away from it, the harder the more)
      const side = c.nx * Math.cos(this.heading) - c.nz * Math.sin(this.heading);
      this.balanceV += (side >= 0 ? 1 : -1) * Math.min(2.5, 0.5 * c.into);
    }
    return false;
  }

  /**
   * A committed jump: how it goes is the approach's and the plant's. Standing, a strong spring straight up; off a step or
   * two, the highest (the last step loads best); flat out, lower and long, carrying the pace and adding to it. A deeper
   * final plant gives more of all of it, and so does effort left.
   */
  private strongJump(): void {
    const s = this.speed, k1 = Math.min(1, s / 4), k2 = Math.max(0, Math.min(1, (s - 6) / 10));
    const plant = 0.85 + 0.15 * Math.min(1, this.load), fresh = 0.9 + 0.1 * this.stamina;
    // (a go at a wall, braced: full effort, whatever the approach, the wall's foot to drive up off)
    const vy = Math.max((9 + 1.5 * k1 - 2 * k2) * plant, this.toWall ? 10.5 : 0) * fresh;
    if (s > 0.5) { const add = 1.5 * k2 * Math.max(0, (Math.min(1, this.load) - 0.65) / 0.35); this.vx += (this.vx / s) * add; this.vz += (this.vz / s) * add; }
    // (gone for a wall: into it, so the jump meets it and a foot goes on it, whatever the breadth took off while it loaded)
    const atWall = !!this.toWall;
    if (this.toWall) { const [ax, az] = this.toWall; this.vx = ax ? ax * 2.5 : this.vx; this.vz = az ? az * 2.5 : this.vz; this.toWall = null; }
    this.launch(vy, 'spring', false, false, (2 * vy) / TUNE.gravity); this.attempt = atWall;
    this.committed = true;
  }

  private leftSupports(): boolean {
    if (this.feet.L.on || this.feet.R.on) return this.feet.L.on;
    const nf = this.nextFoot; if (nf) return nf.side > 0;
    return Math.sin(this.phase - 0.3) > 0;
  }

  private inStance(): boolean {
    const half = Math.PI, phase = ((this.phase - half / 2 - 0.3) % half + half) % half;
    return phase < Math.min(half, this.span);
  }

  private launch(vy: number, move: Move, planned: boolean, float: boolean, T: number): void {
    const ground = this.state === 'ground'; this.from = this.state; this.leftY = this.y;
    if (ground && vy > 0) this.spend(this.effort || 0.25);
    this.effort = 0;
    if (ground) {
      const supportLeft = this.load ? this.to.left : this.leftSupports();
      this.lead = supportLeft ? 0 : 1;
    } else this.lead ^= 1;
    this.chain = null; this.ch = null; this.atLip = -1; if (move !== 'spring') this.toWall = null; this.stepFoot = null; this.climbIn = null; this.bracing = false; this.press = 0; this.held = 0; this.rising = vy > 0;
    if (move !== 'vault') { this.palmSpin = false; this.wheel = false; }
    this.resetTakeoff(); this.pushPending = false; this.dashT = 0; this.approach = null; this.stepTo = 0;
    this.state = 'air'; this.vy = vy; this.airT = 0; this.planned = planned; this.air2 = true; this.attempt = false; this.launchWant = [this.want[0], this.want[1]]; this.aim = null; this.errorOf = null; this.save = null; this.sw = null;
    this.move = move; this.float = float; this.flightT = Math.max(0.15, planned || float ? T : this.comesDown(T)); this.mu = 0;
    this.leaps++; this.rollT = 0; this.count(move);
    if (move !== 'vault' && move !== 'underbar') this.plant = this.plant2 = null;
    if (move !== 'spring') this.lip = null;
  }

  /** an unaimed flight: when it will come down on whatever's under it (or `T`, if that's not within a few seconds) */
  private comesDown(T: number): number {
    let x = this.x, y = this.y, z = this.z, vy = this.vy; const h = 1 / 60;
    for (let t = h; t < 3; t += h) {
      vy -= TUNE.gravity * h; x += this.vx * h; z += this.vz * h; y += vy * h;
      if (vy < 0 && y <= this.city.heightAt(x, z)) return t;
    }
    return T;
  }

  /** Look along (ux, uz) for where to stand next, and go there: by the move that suits what's between. */
  private leap(ux: number, uz: number, from: number, sp: number): void {
    const H = (d: number) => this.city.heightAt(this.x + ux * d, this.z + uz * d);
    /** somewhere to stand: the same height for a good stride beyond */
    const side = (d: number, s: number) => this.city.heightAt(this.x + ux * d - uz * s, this.z + uz * d + ux * s);
    // (and room for the body's breadth: nothing taller within its radius either side of where it comes down)
    const flat = (d: number, h: number) => Math.abs(H(d + 0.6) - h) < 0.1 && Math.abs(H(d + 1.2) - h) < 0.1 && side(d + 0.6, this.R_) <= h + STEP && side(d + 0.6, -this.R_) <= h + STEP;
    const reach = TUNE.jumpReach + sp, y = this.y, G = TUNE.gravity, RISE = TUNE.rise, DROP = TUNE.drop, VLEAP = TUNE.leapSpeed;
    let at = -1, to = 0, over = y, wall = -1, overAt = from;
    // (the first place within a storey up or a couple down; what's in the way before it, to clear; or a wall)
    for (let d = from; d <= reach; d += 0.5) {
      const h = H(d);
      if (h > y + RISE) { wall = d; break; }
      // (a low, narrow top met at a run (a unit, a parapet, taken at an angle) is something to get over, not to land on)
      const narrow = sp >= 5 && h > y + STEP && h <= y + 1.2 && [1.8, 2.2, 2.6].some((e) => Math.abs(H(d + e) - h) > 0.1);
      if (h >= y - DROP) { if (flat(d, h) && !narrow) { at = d; to = h; break; } if (h > over) { over = h; overAt = d; } }
    }
    if (at < 0 && wall >= 0) {
      // A high wall beyond the edge: cross toward it on the available momentum.
      const t = JUMP / G, v = Math.max(sp, Math.min(sp + 1.5, wall / t));
      this.vx = ux * v; this.vz = uz * v; this.launch(JUMP, 'spring', false, false, 2 * t); this.attempt = true; return;
    }
    if (at < 0) {
      // (nothing near this height: the highest place in reach, however far down)
      for (let d = from; d <= reach; d += 0.5) { const h = H(d); if (h < y - DROP && (at < 0 || h > to) && flat(d, h)) { at = d; to = h; } }
      if (at < 0) { this.vx = ux * sp; this.vz = uz * sp; this.launch(JUMP * 0.8, 'bound', false, false, 2 * JUMP * 0.8 / G); return; }
    }
    let D = at + 0.7;
    const dh = to - y, clear = Math.max(0, dh, over - y);
    // (which move: by the rise, the drop, the distance, what's in the way)
    let move: Move, apex: number, spin = false, wheel = false;
    if (dh >= 1.2) { move = 'spring'; apex = clear + 0.6; }
    // (something tall in the way: over it, turned over)
    else if (clear >= 1.2) { move = this.leaps % 2 ? 'sideflip' : 'flip'; apex = clear + 0.5; }
    // (a long way down: headfirst and rolled out of; a long way across: a bound, as long as it takes. A glide is never the
    // runner's choice, only the held jump's)
    else if (dh <= -TUNE.diveDrop) { move = 'dive'; apex = clear + 0.4 + (D > TUNE.glideDist ? 0.04 * D : 0); }
    else if (over - y >= 0.6 && D <= 5) {
      // (something to get over: with an edge of it to put a hand on, a vault, one hand or (every other) two; without, a hop)
      const g = TUNE.reach ? this.city.gripAt(this.x + ux * overAt, over, this.z + uz * overAt, TUNE.gripReach, (h) => (h.kind === 'edge' || h.kind === 'rail') && Math.abs(h.ay - over) < 0.05) : null;
      if (g) {
        move = 'vault'; apex = clear + TUNE.vaultLow;
        // (which vault, by how it's met: square on and fast, both hands (a dash over); square on and slower, one (a speed
        // vault); at an angle, the near hand and the legs swung through to the far side (a side vault), or slowly, over on the
        // hands (a cartwheel); come at it along it, round on the hand (a palm spin))
        const sq = Math.abs(ux * g.hold.nx + uz * g.hold.nz), angle = Math.acos(Math.min(1, sq)) * 180 / Math.PI;
        const two = angle < 25 && sp >= 7, l = Math.hypot(g.hold.bx - g.hold.ax, g.hold.bz - g.hold.az) || 1, hx = ((g.hold.bx - g.hold.ax) / l) * 0.2, hz = ((g.hold.bz - g.hold.az) / l) * 0.2;
        this.plant = two ? onHold(g.hold, g.x + hx, g.z + hz) : [g.x, g.y, g.z]; this.plant2 = two ? onHold(g.hold, g.x - hx, g.z - hz) : null;
        spin = angle > 55;
        // (a cartwheel: at an angle and slow, one hand and then the other, over sideways on them; high enough to go over upside
        // down on straight arms)
        wheel = !spin && angle >= 25 && sp < 7;
        if (wheel) { this.plant = onHold(g.hold, g.x + hx * 0.8, g.z + hz * 0.8); this.plant2 = onHold(g.hold, g.x - hx * 0.8, g.z - hz * 0.8); apex = clear + 0.35; }
      } else { move = 'hop'; apex = clear + 0.3; }
    }
    else { move = 'bound'; apex = clear + 0.1 + 0.06 * D; }
    // (a bar across the way, about head height over the gap, and the far side level with this one: under it, feet first,
    // the hands on it (an underbar))
    let bar: P3 | null = null;
    if ((move === 'bound' || move === 'hop') && TUNE.reach && Math.abs(dh) < 0.6) {
      const mid = (from + at) / 2, g = this.city.gripAt(this.x + ux * mid, y + 1.3, this.z + uz * mid, Math.max(1.2, (at - from) / 2), (h) => h.kind === 'bar' && h.ay - y > 0.9 && h.ay - y < 1.8);
      if (g) { move = 'underbar'; apex = clear + 0.15; bar = [g.x, g.y, g.z]; }
    }
    const float = false;
    apex += TUNE.hang;
    // (the arc: up to an apex that clears what's between, down to the landing; higher if it'd otherwise be too fast)
    let T = 0, up = 0;
    for (let i = 0; i < 24; i++) { up = Math.sqrt((2 * apex) / G); T = up + fall(apex - dh, float); if (D / T <= VLEAP) break; apex += 0.4; }
    // (a vault taken off close to what it's over: steeper, the hand driving it up, so it's up by the top when it gets there)
    if (move === 'vault') {
      const tf = Math.max(0.05, overAt / Math.max(4, sp)), need = over - y - 0.3;
      let vy0 = G * up;
      if (vy0 * tf - (G * tf * tf) / 2 < need) { vy0 = Math.min(7, (need + (G * tf * tf) / 2) / tf); up = vy0 / G; T = up + fall((vy0 * vy0) / (2 * G) - dh, float); }
    }
    let v = D / T;
    // (keep the pace where the landing has the room for it)
    const keep = Math.min(VLEAP, sp) * (float ? 0.85 : 1);
    if (v < keep) { const D2 = keep * T; if (Math.abs(H(D2) - to) < 0.1 && Math.abs(H((D + D2) / 2) - to) < 0.1 && Math.abs(H(D2 + 0.6) - to) < 0.1) { D = D2; v = keep; } }
    // (a hop that would hang in the air: flatter, if what's in the way allows; and off a height, out at a run, to land wherever)
    let aimed = true;
    if (v < 5) {
      apex = clear + 0.25; up = Math.sqrt((2 * apex) / G); T = up + fall(apex - dh, float); v = D / T;
      if (v < 5) { v = Math.min(9, Math.max(sp, 5.5)); aimed = false; }
    }
    // Keep the horizontal impulse within a running step. If the original mark is out of
    // reach, keep travelling and let the actual roof, lip or wall receive the runner.
    // (and keep the aim: too slow for the mark at the pace it can carry, a higher arc, so the flight lasts long enough;
    // too fast, a flatter one, so it's shorter; only if neither lands it does it go unaimed, to land wherever it can)
    // (what the takeoff can give: how committed the press, whether it goes off a foot planted for it, the effort left; a
    // light, unprepared one can't throw the body as far or as high as a full one)
    const turning = this.want[0] || this.want[1] ? Math.acos(Math.max(-1, Math.min(1, ux * this.want[0] + uz * this.want[1]))) : 0;
    // (and turning off it as it goes takes from it: a foot pushing one way while the body's asked another)
    const power = this.takeoffPower() * (1 - 0.3 * Math.min(1, turning / (Math.PI / 2)));
    const carried = Math.max(sp - 1.5, Math.min(sp + 1.5 * power, v));
    if (Math.abs(carried - v) > 0.001) {
      let a2 = apex, u2 = up, T2 = T;
      // (flatter only across a gap: over something, never lower than it was, or it'd go through what it's going over)
      const step = carried < v ? 0.2 : -0.1, lo = move === 'bound' || move === 'dive' || move === 'underbar' ? clear + 0.1 : apex, hi = clear + 3.4;
      for (let i = 0; i < 40; i++) {
        const nA = a2 + step; if (nA < lo || nA > hi) break;
        a2 = nA; u2 = Math.sqrt((2 * a2) / G); T2 = u2 + fall(a2 - dh, float);
        if (carried < v ? carried * T2 >= D : carried * T2 <= D) break;
      }
      const at2 = carried * T2;
      if (Math.abs(H(at2) - to) < 0.1 && flat(at2, to)) { apex = a2; up = u2; T = T2; aimed = true; }
      else aimed = Math.abs(H(carried * T) - to) < 0.1 && flat(carried * T, to);
      v = carried;
    }
    // (the mark it means; and, if this is a hard one, the small error it'll actually make, saveable)
    // (and no higher than it can: an arc that needs more than the takeoff has is cut to what it has, and the flight goes
    // unaimed, short: to catch the lip, or fall)
    const vyMost = 5 + 7 * power;
    if (G * up > vyMost) { up = vyMost / G; const a2 = (vyMost * vyMost) / (2 * G); T = a2 > dh ? up + fall(a2 - dh, float) : 2 * up; aimed = false; this.shortOf = true; } else this.shortOf = false;
    const aimX = this.x + ux * v * T, aimZ = this.z + uz * v * T;
    let err: { kind: string; e: number } | null = null;
    if (aimed && ['bound', 'spring', 'hop', 'dive', 'flip', 'sideflip'].includes(move)) {
      // (a late turn: how far what's asked is off the way it's going as it leaves, per right angle)
      const lateTurn = this.want[0] || this.want[1] ? Math.acos(Math.max(-1, Math.min(1, ux * this.want[0] + uz * this.want[1]))) : 0;
      const turnK = Math.min(1, lateTurn / (Math.PI / 2)), speedK = Math.max(0, Math.min(1, (v - 14) / 5)), Dv = v * T;
      const reachK = Math.max(0, Math.min(1, (Dv / reach - 0.55) / 0.45)), ks = [turnK * 0.9, speedK * 0.7, reachK * 0.8];
      const diff = Math.max(...ks) + 0.25 * (1 - this.stamina);
      // (a change of mind in the last stride always shows: wide, by as much as it had still to turn, from about 11°)
      const turnE = lateTurn > 0.2 ? 0.12 + 0.6 * turnK : 0;
      if (diff > 0.3 || turnE > 0) {
        const kind = turnE > 0 || (ks[0] >= ks[1] && ks[0] >= ks[2]) ? 'wide' : ks[1] >= ks[2] ? 'long' : 'short';
        for (let e = Math.max(Math.min(0.55, (diff - 0.3) * 1.1), kind === 'wide' ? Math.min(0.55, turnE) : 0); e > 0.08; e *= 0.5) {
          if (kind === 'wide') {
            const a = -Math.sign((ux * this.want[1] - uz * this.want[0]) || this.turn || 1) * Math.atan2(e, Dv), c = Math.cos(a), s2 = Math.sin(a), wx = ux * c + uz * s2, wz = uz * c - ux * s2;
            if (Math.abs(this.city.heightAt(this.x + wx * Dv, this.z + wz * Dv) - to) < 0.1) { ux = wx; uz = wz; err = { kind, e }; break; }
          } else {
            const D2 = Dv + (kind === 'long' ? e : -e);
            if (Math.abs(H(D2) - to) < 0.1 && (kind === 'short' || Math.abs(H(D2 + 0.6) - to) < 0.1)) { v = D2 / T; err = { kind, e }; break; }
          }
        }
      }
    }
    this.vx = ux * v; this.vz = uz * v;
    const plant = this.plant, plant2 = this.plant2;
    this.launch(G * up, move, aimed, float, T);
    // (aimed at something narrow to stop on (a rim, a wall's top, a parapet's end): a precision, landed on both feet together)
    { const H = (x: number, z: number) => this.city.heightAt(x, z), px = -uz, pz = ux, h = H(aimX, aimZ);
      let along = 0; while (along < 2.4 && Math.abs(H(aimX + ux * (along + 0.3), aimZ + uz * (along + 0.3)) - h) <= STEP) along += 0.3;
      this.precise = aimed && along < 2.4 && H(aimX + px * 0.7, aimZ + pz * 0.7) < h - STEP && H(aimX - px * 0.7, aimZ - pz * 0.7) < h - STEP; }
    this.aim = aimed ? { x: aimX, z: aimZ, ux: Math.cos(0) * (aimX - this.x) / (Math.hypot(aimX - this.x, aimZ - this.z) || 1), uz: (aimZ - this.z) / (Math.hypot(aimX - this.x, aimZ - this.z) || 1) } : null;
    this.errorOf = err; if (err) this.errors++;
    if (move === 'vault') {
      this.plant = plant; this.plant2 = plant2; this.vaultTo = to; this.palmSpin = spin; this.wheel = wheel; if (spin) this.count('palmspin' as Move); if (wheel) this.count('cartwheel' as Move);
      // (the hands in the figure's own order: the one on its left to the left)
      if (plant && plant2 && (plant[0] - plant2[0]) * uz - (plant[2] - plant2[2]) * ux < 0) { this.plant = plant2; this.plant2 = plant; }
    }
    if (move === 'underbar' && bar) { this.plant = [bar[0] + uz * 0.22, bar[1], bar[2] - ux * 0.22]; this.plant2 = [bar[0] - uz * 0.22, bar[1], bar[2] + ux * 0.22]; }
    if (move === 'spring' && TUNE.reach) {
      // (a storey up: the lip it lands over, for both hands)
      const g = this.city.gripAt(this.x + ux * at, to, this.z + uz * at, TUNE.gripReach, (h) => h.kind === 'edge' && Math.abs(h.ay - to) < 0.05);
      if (g) this.lip = [onHold(g.hold, g.x + uz * 0.2, g.z - ux * 0.2), onHold(g.hold, g.x - uz * 0.2, g.z + ux * 0.2)];
    }
  }

  private air(dt: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    const H = (x: number, z: number) => this.city.heightAt(x, z);
    this.to.buffer = Math.max(0, this.to.buffer - dt);
    // (held at the top of a flight a moment, as a drawing would hold it (`apexHold`): the pose held, the body going on
    // across, at its pace, and on its arc, so it lands where it meant to; then the pose catches up)
    this.airT += dt;
    // (how long to the ground: where it'll be when it gets there, near enough)
    // (marched along the flight to the first ground it meets: not flickering between the roof and the street over a gap)
    { const G = this.float ? TUNE.glideGravity : TUNE.gravity; let t = 0.04; for (; t < 2.5; t += 0.04) if (this.vy - G * t < 0 && this.y + this.vy * t - 0.5 * G * t * t <= this.city.heightAt(this.x + this.vx * t, this.z + this.vz * t)) break; this.ttc = t; }
    const muT = Math.min(1, this.airT / this.flightT);
    if (TUNE.apexHold > 0 && !this.float) { if (this.vy > 0) this.rising = true; else if (this.rising) { this.rising = false; this.held = TUNE.apexHold; } }
    if (this.held > 0) this.held -= dt;
    else this.mu = Math.min(muT, this.mu + Math.max(dt / this.flightT, (muT - this.mu) * Math.min(1, dt * 14)));
    // (a leap that hasn't landed where it meant to: falling from here, to catch what it can, or to come down and roll)
    if (!this.float && this.airT > this.flightT + 0.12 && this.move !== 'fall') { this.move = 'fall'; this.planned = false; this.count('fall'); if (this.from === 'ground' && !this.attempt) this.misses++; }
    // (the jump held, coming down: a glide, as long as it's held; let go, a fall)
    if (this.hold && this.vy < 0 && !this.float) { this.float = true; this.move = 'glide'; this.planned = false; this.count('glide'); }
    else if (!this.hold && this.float && this.move === 'glide') { this.float = false; this.move = 'fall'; }
    const sp = this.speed;
    // (turned decisively in the air: where it lands now is its choice, not the mark it missed)
    if (this.planned && on && sp > 0.5 && (this.vx * dx + this.vz * dz) / sp < 0.5) { this.planned = false; this.aim = null; }
    // (an aimed flight is only steered by a change in what's asked since it left the ground: the direction held at takeoff
    // is what the leap was chosen with, and steering toward it again would only pull it off its own mark)
    const changed = !this.planned || dx * this.launchWant[0] + dz * this.launchWant[1] < 0.985;
    if (on && changed) {
      // (steered, not driven: a flight doesn't gain pace in the air (a little from a standing jump); a glide does, gliding)
      const top = this.float ? Math.max(sp, 7) : this.planned ? sp : Math.max(sp, 3);
      const tx = dx * top, tz = dz * top;
      const ex = tx - this.vx, ez = tz - this.vz, e = Math.hypot(ex, ez);
      const alignment = sp > 0.5 ? (this.vx * dx + this.vz * dz) / sp : 0;
      const authority = this.planned ? Math.min(1, 0.2 + 1.6 * (1 - alignment)) : 1;
      const a = TUNE.steer * authority * dt;
      if (e <= a) { this.vx = tx; this.vz = tz; } else { this.vx += (ex / e) * a; this.vz += (ez / e) * a; }
    }
    // (a second jump, off nothing, turned over: once a flight)
    if (jump && this.vy < 0 && this.y - H(this.x, this.z) < -this.vy * 0.12) this.to.buffer = 0.22;
    else if (jump && this.air2) {
      // (turned over forwards; leaning across the way it's going, over sideways)
      const side = on && sp > 0.5 ? Math.abs((this.vx * dz - this.vz * dx) / sp) : 0;
      this.launch(JUMP * 0.95, side > 0.5 ? 'sideflip' : 'flip', false, false, 0.8); this.air2 = false;
    }
    if (this.float) { this.vy -= (this.vy > 0 ? TUNE.gravity : TUNE.glideGravity) * dt; if (this.vy < -TUNE.sink) this.vy += (-TUNE.sink - this.vy) * (1 - Math.exp(-8 * dt)); }
    else this.vy -= TUNE.gravity * dt;
    // (a lip in a hand's reach that it won't land on: caught, whatever the flight was doing)
    if (this.reachLip()) return;
    // (a wall alongside: run along it)
    if (this.airT > 0.1 && (!this.planned || (this.float && this.mu > 0.3)) && this.seek(0.62, dx, dz)) return;
    const s2 = this.speed, ux = s2 > 0.1 ? this.vx / s2 : 0, uz = s2 > 0.1 ? this.vz / s2 : 0;
    const nx = this.x + this.vx * dt, nz = this.z + this.vz * dt, ny = this.y + this.vy * dt;
    // (a corner can slip between two looks ahead: so where the body itself would be counts too)
    let px = nx + ux * this.R_, pz = nz + uz * this.R_, h = H(px, pz);
    if (H(nx, nz) > h) { px = nx; pz = nz; h = H(nx, nz); }
    // (a vault goes over what its hand is on, carried on the hand: that isn't in the way, and isn't landed on)
    // (only once the feet are up near it, tucked over: below that, what the hand is on is in the way like anything else)
    // (what the hand is on isn't in the way: the legs go over it)
    const over = this.move === 'vault' && this.plant && this.y > this.plant[1] - 1.2 ? this.plant[1] + 0.05 : -1;
    if (h > ny + 0.05 && h > over) {
      // (something in the way: a lip is stepped up onto; a wall met at a slant is run along; met square, run up)
      if (h - ny <= 0.6) {
        // (landed, or stepped up onto it: where the body is if that's on it, else only as far on as it takes to stand on it,
        // not the look ahead's whole radius on)
        let lx = nx, lz = nz;
        if (H(nx, nz) < h - 0.05) for (let d = 0.05; d <= this.R_ + 0.001; d += 0.05) { lx = nx + ux * d; lz = nz + uz * d; if (H(lx, lz) >= h - 0.05) break; }
        if (H(lx, lz) < h - 0.05) { lx = px; lz = pz; }
        this.x = lx; this.z = lz; this.y = H(lx, lz); this.touch(Math.max(0, -this.vy)); return;
      }
      this.y = ny;
      // (against it with its top in reach, coming down or still going up: caught, and pulled over)
      if (this.move !== 'vault' && this.move !== 'underbar' && this.catchLip(px, pz, ux, uz)) return;
      // (how square it's met: only a wall met nearly square is run straight up)
      const square = Math.cos((TUNE.climbSquare * Math.PI) / 180);
      if (this.seek(square, dx, dz)) return;
      let nax = 0, naz = 0, most = 0;
      for (const [ax, az] of AXES) { const k = ax * ux + az * uz; if (k > most && H(this.x + ax * (this.R_ + 0.15), this.z + az * (this.R_ + 0.15)) > ny + 0.05) { most = k; nax = ax; naz = az; } }
      if (most === 0) {
        if (Math.abs(ux) > Math.abs(uz)) nax = Math.sign(ux); else naz = Math.sign(uz);
      }
      const into = nax * dx + naz * dz;
      if (TUNE.walls && this.committed && this.vy > 0 && most >= square && into > 0.65) {
        const foot = this.city.gripAt(px, ny + 0.38, pz, 0.52,
          g => g.kind === 'face' && g.nx * nax + g.nz * naz < -0.9);
        if (foot) {
          this.wx = nax; this.wz = naz;
          this.x = foot.x - nax * this.R_; this.z = foot.z - naz * this.R_;
          this.stepFoot = [foot.x, foot.y, foot.z]; this.state = 'plant'; this.stepAge = 0;
          this.vy = Math.min(12, Math.max(6, this.vy + s2 * most * 0.44));
          this.vx = this.vz = 0; this.wallSteps++; return;
        }
      }
      const normal = this.vx * nax + this.vz * naz;
      this.vx -= nax * normal; this.vz -= naz * normal;
      const sx = this.x + this.vx * dt, sz = this.z + this.vz * dt;
      if (H(sx, sz) <= ny) { this.x = sx; this.z = sz; }
      if (!this.bracing) this.braces++;
      this.bracing = true; this.planned = false;
      const floor = H(this.x, this.z);
      if (ny <= floor && this.vy <= 0) { this.y = floor; this.touch(-this.vy); }
      return;
    }
    this.x = nx; this.z = nz; this.y = ny;
    // (a slab overhead (a landing's underside): the head comes up against it, and the rise stops there)
    { const c = this.city.ceilingAt?.(this.x, this.y, this.z) ?? Infinity, hh = this.height_ - 0.05; if (this.y + hh > c) { this.y = Math.min(this.y, c - hh); this.vy = Math.min(this.vy, 0); } }
    // (the body's breadth: not into a wall it's passing, falling past, kicking off)
    // (vaulting: not the thing it's going over, carried on its hand, while it's up by it: not what's below, falling on)
    this.resolve(this.move === 'vault' && this.plant && this.y > this.plant[1] - 1.2 ? Math.max(0.6, this.plant[1] + 0.1 - this.y) : 0.6);
    // (carried up onto the hand over a few frames, not in one, and never more than 0.65 m into what it's over)
    const g = H(this.x, this.z);
    if (g <= over && g > this.vaultTo + 0.3) { if (this.y < g + 0.05) { const gap = g + 0.05 - this.y; this.y += Math.max(gap * (1 - Math.exp(-40 * dt)), gap - 0.65); this.vy = Math.max(this.vy, 0); } return; }
    if (this.y <= g && this.vy <= 0) { this.y = g; this.touch(-this.vy); }
  }

  /**
   * A lip a hand can have, caught: its top within an arm's reach overhead (and above the hips: not one to step onto),
   * beside the body on its outside, and not one it'll land on (rising, it won't clear it; or coming down, it's already
   * below it): coming up short of a storey, falling past a wall's top, dropping off a roof's edge it didn't mean to leave.
   * Not the lip it just left, not one it's aimed to land beyond, not mid-vault or in a held glide.
   */
  private reachLip(): boolean {
    if (!TUNE.walls || !TUNE.reach || this.move === 'vault' || this.move === 'underbar' || this.float || this.airT < 0.08) return false;
    const reach = this.armReach, G = TUNE.gravity;
    // (over the side of a narrow top it couldn't turn on: that top's own edge, caught going away from it, a hand reaching back
    // as the hips go by, before they've dropped below it)
    const over = !!this.overrun && this.time < this.overrun.until;
    const g = over ? this.city.gripAt(this.x, this.overrun!.y, this.z, this.R_ + 0.8, (h) => h.kind === 'edge' && Math.abs(h.ay - this.overrun!.y) < 0.05 && h.ay - this.y > 0.12 && (this.x - h.ax) * h.nx + (this.z - h.az) * h.nz > 0)
      : this.city.gripAt(this.x, this.y + reach * 0.6, this.z, this.R_ + 0.35, (h) => h.kind === 'edge' && h.ay - this.y > 0.9 && h.ay - this.y <= reach && Math.abs(h.ay - this.leftY) > 0.1);
    if (!g) return false;
    const nx = g.hold.nx, nz = g.hold.nz, out = (this.x - g.x) * nx + (this.z - g.z) * nz, top = g.y;
    if (over) {
      if (out < 0.05 || out > this.R_ + 0.8) return false;
      this.wx = -nx; this.wz = -nz; this.grabTop({ hold: g.hold }, top, g.x, g.z); this.lipReached++; this.count('overcatch' as Move);
      return true;
    }
    if (this.lipBad(g.x, g.z)) return false;
    if (out < -0.05 || out > this.R_ + 0.3) return false;
    // (only one it's heading for: going toward it, or asked to; not one it's passing alongside or leaving)
    const toward = -(this.vx * nx + this.vz * nz), asked = -(this.want[0] * nx + this.want[1] * nz) * (this.mag > 0.1 ? 1 : 0);
    if (toward < 1 && asked < 0.5) return false;
    // (falling too fast for a hand to hold)
    if (this.vy < -10) return false;
    // (aimed onto it, and still able to get there: let the flight land it)
    if (this.aim && Math.abs(this.city.heightAt(this.aim.x, this.aim.z) - top) < 0.1 && this.vy > -2) return false;
    const apex = this.y + Math.max(0, this.vy) ** 2 / (2 * G);
    // (rising: caught near the top of the rise if it won't come down on it, too low, or still outside it when it gets back
    // down to it; falling: once it's below it)
    if (this.vy > 0) {
      if (this.vy > 2.5) return false;
      const back = this.vy / G + Math.sqrt(Math.max(0, 2 * (apex - top)) / G), outThen = out + (this.vx * nx + this.vz * nz) * back;
      if (apex >= top + 0.15 && outThen < -0.1) return false;
    } else if (this.y > top - 0.25) return false;
    // (and somewhere to hang: the body's place under it clear, not in a building beside)
    const hx = g.x + nx * (this.R_ + 0.05), hz = g.z + nz * (this.R_ + 0.05);
    if ([[0, 0], [0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]].some(([a, b]) => this.city.heightAt(hx + a, hz + b) > this.y + 0.3)) return false;
    this.wx = -nx; this.wz = -nz; this.x = hx; this.z = hz;
    this.grabTop({ hold: g.hold }, top, g.x, g.z); this.lipReached++;
    return true;
  }

  /** A lip in arm's reach on the wall it's against (falling, or off a plant): its edge in both hands, and pulled over. */
  private catchLip(px: number, pz: number, ux: number, uz: number): boolean {
    if (!TUNE.walls) return false;
    let ax = 0, az = 0, most = 0;
    for (const [bx, bz] of AXES) { const k = bx * ux + bz * uz; if (k > most && this.city.heightAt(this.x + bx * (this.R_ + 0.15), this.z + bz * (this.R_ + 0.15)) > this.y + 0.05) { most = k; ax = bx; az = bz; } }
    if (!ax && !az) return false;
    const x = this.x + ax * (this.R_ + 0.05), z = this.z + az * (this.R_ + 0.05), top = this.city.heightAt(x, z), reach = top - this.y;
    if (reach <= 0.65 || reach > this.armReach) return false;
    const lip = this.city.gripAt(x, top, z, 0.4, (g) => g.kind === 'edge' && g.nx * ax + g.nz * az < -0.9);
    if (!lip || this.lipBad(x, z)) return false;
    void px; void pz;
    this.wx = ax; this.wz = az; this.x = x - ax * (this.R_ + 0.05); this.z = z - az * (this.R_ + 0.05);
    this.grabTop(lip, top, x, z);
    return true;
  }
  /**
   * Off the side of a narrow top (a parapet, a wall's top: a drop both sides), asked to go off it at an angle to the line
   * it's running: the foot on it can turn the body only so far, and further the longer the turn's been asked (one set up a
   * few strides out, up to 60°; one asked at the last moment, 25°). The way it can go (null: it isn't on one, or isn't
   * turning), or 'over': asked well past that, the foot can't drive the turn and the hips go on over the side.
   */
  private offNarrow(ux: number, uz: number, dx: number, dz: number, sp: number): [number, number] | 'over' | null {
    const H = (x: number, z: number) => this.city.heightAt(x, z), px = -uz, pz = ux, m = Math.hypot(dx, dz);
    if (sp < 4 || m < 0.5 || !(H(this.x + px * 0.7, this.z + pz * 0.7) < this.y - STEP && H(this.x - px * 0.7, this.z - pz * 0.7) < this.y - STEP)) return null;
    const hu = Math.atan2(ux, uz), ha = Math.atan2(dx / m, dz / m);
    let dh = ha - hu; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    if (Math.abs(dh) < 0.2) return null;
    const most = ((25 + 35 * Math.min(1, this.turnAsk / 0.3)) * Math.PI) / 180;
    if (Math.abs(dh) > most + 0.35) return 'over';
    const h = hu + Math.sign(dh) * Math.min(Math.abs(dh), most);
    return [Math.sin(h), Math.cos(h)];
  }
  /** over the side of a narrow top it couldn't turn on: what the foot gave it (a turn of 25°, some pace), and off, its edge
   * still there to be caught by a hand going by */
  private overrunOff(ux: number, uz: number, dx: number, dz: number, sp: number): void {
    const hu = Math.atan2(ux, uz), ha = Math.atan2(dx, dz);
    let dh = ha - hu; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
    const h = hu + Math.sign(dh) * 0.45, v = sp * 0.9;
    this.vx = Math.sin(h) * v; this.vz = Math.cos(h) * v;
    this.launch(0.4, 'fall', false, false, 0.5); this.overrun = { until: this.time + 0.9, y: this.y }; this.count('overrun' as Move);
  }
  /**
   * A tic-tac: met at a run, a tall wall beside the way it's asked, and ahead a lip too high for a straight jump but within one
   * off a wall: a foot on the side wall, and off it up and across to the lip (the pace into the wall turned into height),
   * for the hands to take it.
   */
  private ticTac(dx: number, dz: number, mag: number, vx0: number, vz0: number): boolean {
    const s0 = Math.hypot(vx0, vz0), m = Math.hypot(dx, dz);
    if (!TUNE.walls || mag < 0.55 || s0 < 3.5 || m < 0.5 || this.wallCool > 0) return false;
    const H = (x: number, z: number) => this.city.heightAt(x, z), ux = dx / m, uz = dz / m;
    for (const [ax, az] of AXES) {
      // (the side wall: beside the line (not across it), and standing higher than the lip)
      const k = ax * ux + az * uz; if (Math.abs(k) > 0.6) continue;
      // (touching, or a step away: a foot reaches it)
      let side = 0; for (let e = 0.12; e <= 0.9 && side < this.y + TUNE.rise + 1; e += 0.13) side = H(this.x + ax * (this.R_ + e), this.z + az * (this.R_ + e));
      if (side < this.y + TUNE.rise + 1) continue;
      // (the lip ahead, along the way asked, off the side wall: too high to jump to, low enough to tic-tac to)
      const fx = ux - ax * k, fz = uz - az * k, fl = Math.hypot(fx, fz) || 1, px = fx / fl, pz = fz / fl;
      let at = 0, top = 0; for (let d = 0.3; d <= 2.6; d += 0.1) { const h = H(this.x + px * d, this.z + pz * d); if (h > this.y + STEP) { at = d; top = h; break; } }
      if (!at || top - this.y <= TUNE.rise || top - this.y > TUNE.rise + 3) continue;
      if (top >= side - 0.3) continue;
      // (gone off a foot, like any takeoff: between steps it waits for the next to come down, unless there's no room left for one)
      if (!this.feet.L.on && !this.feet.R.on && at > 0.9) continue;
      // (as high as gets the hand over the lip; the pace into the wall pays for it: a slow one can't)
      const apex = Math.max(1, top - this.y - this.armReach + 0.35), vy = Math.sqrt(2 * TUNE.gravity * apex);
      if (vy > 4 + 0.9 * s0) continue;
      const T = vy / TUNE.gravity, across = Math.min(4, (at + 0.2) / T);
      this.vx = px * across - ax * 0.8; this.vz = pz * across - az * 0.8;
      this.wx = ax; this.wz = az; this.wallSide = (ax * Math.cos(this.heading) - az * Math.sin(this.heading)) > 0 ? 1 : -1;
      this.launch(vy, 'kick', false, false, 2 * T); this.wallCool = 0.25; this.count('tictac' as Move);
      return true;
    }
    return false;
  }
  /**
   * Going too fast to make a turn that's asked (well round, at a run), with a rail in a hand's reach about hip to chest
   * high: caught with the hand on that side, and swung round it.
   */
  private railCatch(dx: number, dz: number, mag: number): boolean {
    const sp = this.speed;
    if (!TUNE.walls || !TUNE.reach || mag < 0.55 || sp < 4) return false;
    const m = Math.hypot(dx, dz), turn = (dx * this.vx + dz * this.vz) / (m * sp || 1);
    if (turn > -0.2) return false;
    // (an arm's length and a lean: reached for, not stepped to)
    // (a rail that stands up off what's under it, a handrail or a post: not the top of something narrow to balance on, a tread)
    const g = this.city.gripAt(this.x, this.y + 1.0, this.z, 1.45, (h) => h.kind === 'rail' && Math.min(h.ay, h.by) - this.city.heightAt((h.ax + h.bx) / 2, (h.az + h.bz) / 2) > 0.5);
    if (!g || g.y - this.y < 0.6 || g.y - this.y > 1.5) return false;
    const h: [number, number, number] = [g.x, g.y, g.z], q0: [number, number, number] = [this.x, this.y + this.hipH, this.z];
    const d = [q0[0] - h[0], q0[1] - h[1], q0[2] - h[2]], dl = Math.hypot(d[0], d[1], d[2]);
    if (dl > 1.6 || dl < 0.2) return false;
    const L = Math.max(0.85 * this.build.reachScale, Math.min(1.15 * this.build.reachScale, dl)), q: [number, number, number] = [h[0] + (d[0] / dl) * L, h[1] + (d[1] / dl) * L, h[2] + (d[2] / dl) * L];
    // (the hand on the side the rail's on)
    const side = (g.x - this.x) * Math.cos(this.heading) - (g.z - this.z) * Math.sin(this.heading) > 0 ? 1 : -1;
    this.rs = { h, L, q, v: [this.vx, Math.max(0, this.vy), this.vz], t: 0, side, ask: [dx / m, dz / m], foot: null, last: null, leaning: 0 };
    this.resetTakeoff(); this.approach = null; this.stepTo = 0; this.leftY = this.y;
    this.state = 'swing'; this.move = 'swing'; this.mu = 0; this.count('railswing' as Move);
    return true;
  }
  /**
   * The rail swing: the pendulum, the free foot, and the stick read through it. Held (any way but a new one), it keeps
   * carrying; turned toward a face the swing has brought within the foot's reach, the foot goes to it and the leg takes the
   * load; let go, or turned somewhere there's nothing to reach, it leaves: the hand off the rail and the foot off its face,
   * with whatever the leg still has in it pushing the body out along it.
   */
  private railSwing(dt: number, on: boolean, dx: number, dz: number, mag: number): void {
    const s = this.rs!, G = TUNE.gravity, q = s.q, v = s.v, h = s.h;
    s.t += dt;
    // (the foot against its face: a leg, a spring along it (pushing only), as long as it can still reach)
    let fx = 0, fy = 0, fz = 0;
    if (s.foot) {
      const f = s.foot; f.t += dt;
      const lx = q[0] - f.p[0], ly = q[1] - f.p[1], lz = q[2] - f.p[2], l = Math.hypot(lx, ly, lz), ux = lx / l, uy = ly / l, uz = lz / l;
      if (l > this.leg + 0.08) { s.last = { p: f.p, n: f.n, press: f.press, at: s.t }; s.foot = null; }
      else { const c = Math.max(0, this.leg - l), vin = v[0] * ux + v[1] * uy + v[2] * uz, k = Math.max(0, 110 * c - 10 * vin); fx = ux * k; fy = uy * k; fz = uz * k; f.press = Math.max(f.press * Math.exp(-1.5 * dt), c); }
    }
    v[0] += fx * dt; v[1] += (fy - G) * dt; v[2] += fz * dt;
    q[0] += v[0] * dt; q[1] += v[1] * dt; q[2] += v[2] * dt;
    // (the arm: it holds, it doesn't push; the hips no further than its length from the hand)
    { const d = [q[0] - h[0], q[1] - h[1], q[2] - h[2]], dl = Math.hypot(d[0], d[1], d[2]);
      if (dl > s.L) { const ux = d[0] / dl, uy = d[1] / dl, uz = d[2] / dl; q[0] = h[0] + ux * s.L; q[1] = h[1] + uy * s.L; q[2] = h[2] + uz * s.L; const out = v[0] * ux + v[1] * uy + v[2] * uz; if (out > 0) { v[0] -= ux * out; v[1] -= uy * out; v[2] -= uz * out; } } }
    // (the hips out of whatever they'd swing into: the face taking what was going into it)
    this.city.refY = q[1] - this.hipH;
    for (const f of this.city.facesNear(q[0], q[1], q[2], 0.22)) {
      const d = Math.hypot(q[0] - f.p[0], q[1] - f.p[1], q[2] - f.p[2]), push = 0.22 - d;
      q[0] += f.n[0] * push; q[1] += f.n[1] * push; q[2] += f.n[2] * push;
      const vin = v[0] * f.n[0] + v[1] * f.n[1] + v[2] * f.n[2]; if (vin < 0) { v[0] -= f.n[0] * vin; v[1] -= f.n[1] * vin; v[2] -= f.n[2] * vin; }
    }
    this.x = q[0]; this.z = q[2]; this.y = q[1] - this.hipH; this.vx = v[0]; this.vz = v[2]; this.vy = v[1];
    this.mu = Math.min(1, s.t / 0.6);
    const m = on ? Math.hypot(dx, dz) : 0, ax = m ? dx / m : 0, az = m ? dz / m : 0;
    // (leaving: let go of the stick; or turned well off the way it was held, with a foot just loaded (its load let out), or
    // with nothing there to reach)
    // (leaned with nothing in reach yet: a reach for what the swing's bringing, held a beat for it to come, not a leaving)
    const turned = m > 0 && ax * s.ask[0] + az * s.ask[1] < 0.35, loaded = s.foot ?? (s.last && s.t - s.last.at < 0.25 ? s.last : null);
    s.leaning = turned && !loaded && !this.reachable(s, ax, az) ? s.leaning + dt : 0;
    if ((s.t > 0.12 && (!on || mag < 0.2 || (turned && (loaded || s.leaning > LEAN_WAIT)))) || s.t > 3) {
      let px = 0, py = 0, pz = 0;
      if (loaded) {
        // (the leg's load let out: along the leg, and along the face it's on as far as the sole can grip (about 0.6 of the
        // push), toward the way the stick says to leave)
        const f = loaded, lx = q[0] - f.p[0], ly = q[1] - f.p[1], lz = q[2] - f.p[2], l = Math.hypot(lx, ly, lz) || 1, k = Math.min(2.5, f.press * 6 + 0.4);
        px = (lx / l) * k; py = (ly / l) * k; pz = (lz / l) * k;
        if (m > 0) { const n = f.n, dn = ax * n[0] + az * n[2], sx = ax - n[0] * dn, sy = -n[1] * dn, sz = az - n[2] * dn, sl = Math.hypot(sx, sy, sz); if (sl > 0.1) { px += (sx / sl) * 0.6 * k; py += (sy / sl) * 0.6 * k; pz += (sz / sl) * 0.6 * k; } }
        this.count('legrelease' as Move);
      }
      // (a loaded leg aims its push: the way the body's going turned toward the stick, as far as the load lets it (20° and up
      // to 60° more, the harder it was pressed), as a foot on a narrow top turns the body)
      if (loaded && m > 0) {
        const hu = Math.atan2(v[0], v[2]), ha = Math.atan2(ax, az), spd = Math.hypot(v[0], v[2]);
        let dh = ha - hu; while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
        const most = ((20 + 60 * Math.min(1, loaded.press / 0.5)) * Math.PI) / 180, hn = hu + Math.sign(dh) * Math.min(Math.abs(dh), most);
        v[0] = Math.sin(hn) * spd; v[2] = Math.cos(hn) * spd;
      }
      // (and the hand pushing off the rail as it lets go, the way the stick says)
      const hp = m > 0 ? 1.5 : 0;
      this.rs = null; this.vx = v[0] + px + ax * hp; this.vz = v[2] + pz + az * hp;
      this.launch(v[1] + py, 'bound', false, false, 0.6); this.count('railrelease' as Move);
      return;
    }
    // (come down onto something under it: stood)
    // (the free foot: at the end of the body's line from the hand through the hips; a face it's brought within reach of,
    // the way the stick leans, is taken)
    // (a reach is a lean: the stick moved off the way it was being held; held as it was, it's only carrying on)
    if (!s.foot && on && s.t > 0.06 && ax * s.ask[0] + az * s.ask[1] < 0.8) {
      // (anywhere a leg can reach from the hips, but not across toward the hand (the arm's there): a foot can be lifted
      // behind, up, out; of
      // those the way it leans, the one nearest where the free foot is now: trailing the swing, behind the hips the way
      // they're going, and lifted by it)
      const ah = [h[0] - q[0], h[1] - q[1], h[2] - q[2]], al = Math.hypot(ah[0], ah[1], ah[2]) || 1, vl = Math.hypot(v[0], v[1], v[2]) || 1;
      const tip = [q[0] - (v[0] / vl) * 0.7, q[1] - (v[1] / vl) * 0.7 + 0.25, q[2] - (v[2] / vl) * 0.7];
      let best: { p: [number, number, number]; n: [number, number, number] } | null = null, bestD = 9;
      for (const f of this.city.facesNear(q[0], q[1], q[2], this.leg + 0.02)) {
        const rx = f.p[0] - q[0], ry = f.p[1] - q[1], rz = f.p[2] - q[2], rl = Math.hypot(rx, ry, rz), hl = Math.hypot(rx, rz);
        if (rl < 0.45 || (hl > 0.2 && (rx * ah[0] + rz * ah[2]) / (hl * (Math.hypot(ah[0], ah[2]) || 1)) > 0.5)) continue;
        // (leaned toward: the stick the way it lies across the ground; one straight overhead or under, any lean will do)
        const k = hl > 0.15 ? (ax * rx + az * rz) / hl : 0.5;
        const dt2 = Math.hypot(f.p[0] - tip[0], f.p[1] - tip[1], f.p[2] - tip[2]);
        if (k > 0.25 && dt2 < bestD) { bestD = dt2; best = { p: f.p, n: f.n }; }
      }
      if (best) {
        s.foot = { p: best.p, n: best.n, t: 0, press: 0, side: -s.side }; s.ask = [ax, az];
        this.count('swingfoot' as Move); if (best.n[1] < -0.6) this.count('underfoot' as Move);
      }
    }
    // (judged where the feet are: at the end of the body's line from the hand through the hips, which at speed is out flat)
    { const d = [q[0] - h[0], q[1] - h[1], q[2] - h[2]], dl = Math.hypot(d[0], d[1], d[2]) || 1, tx = q[0] + (d[0] / dl) * 0.9, ty = q[1] + (d[1] / dl) * 0.9, tz = q[2] + (d[2] / dl) * 0.9;
      const floor = this.city.heightAt(tx, tz);
      // (the knees lift to carry the feet over a floor the swing skims, about 0.45 m; below that, it's stood on)
      if (s.t > 0.1 && ty + 0.45 <= floor && floor < q[1] - 0.3 && v[1] <= 0 && !s.foot) { this.rs = null; this.x = tx; this.z = tz; this.y = floor; this.state = 'air'; this.move = 'fall'; this.touch(-v[1]); } }
  }
  /** on a rail swing: a face within the free foot's reach the way (ax, az) leans (see railSwing) */
  private reachable(s: NonNullable<Runner['rs']>, ax: number, az: number): boolean {
    const q = s.q, h = s.h, ah = [h[0] - q[0], h[1] - q[1], h[2] - q[2]], al = Math.hypot(ah[0], ah[1], ah[2]) || 1;
    for (const f of this.city.facesNear(q[0], q[1], q[2], this.leg + 0.02)) {
      const rx = f.p[0] - q[0], ry = f.p[1] - q[1], rz = f.p[2] - q[2], rl = Math.hypot(rx, ry, rz), hl = Math.hypot(rx, rz);
      if (rl < 0.45 || (hl > 0.2 && (rx * ah[0] + rz * ah[2]) / (hl * (Math.hypot(ah[0], ah[2]) || 1)) > 0.5)) continue;
      if ((hl > 0.15 ? (ax * rx + az * rz) / hl : 0.5) > 0.25) return true;
    }
    return false;
  }
  /** hands on a lip at `top`: climbing over it from here */
  private grabTop(lip: { hold: Hold }, top: number, x: number, z: number): void {
    this.top = top; this.chain = null;
    this.grips = { hl: onHold(lip.hold, x + this.wz * 0.18, z - this.wx * 0.18), hr: onHold(lip.hold, x - this.wz * 0.18, z + this.wx * 0.18) };
    // (what it brought: along the wall, a swing under the hand; downward, a dip, caught; the near hand first, the side it
    // was travelling toward)
    const tx = -this.wz, tz = this.wx, along = this.vx * tx + this.vz * tz;
    // (and out from the wall: carried on away from it, the hips swing out under the hands; caught high (going over the
    // edge), it drops into the arms first)
    const out = Math.max(0, Math.min(5, -(this.vx * this.wx + this.vz * this.wz))), over = !!this.overrun && this.time < this.overrun.until;
    const rest = over ? top - 1.95 : this.y, o0 = over ? Math.max(0, -((this.x - x) * this.wx + (this.z - z) * this.wz) - (this.R_ + 0.05)) : 0;
    const x0 = over ? x - this.wx * (this.R_ + 0.05) : this.x, z0 = over ? z - this.wz * (this.R_ + 0.05) : this.z;
    this.sw = { s: 0, v: Math.max(-4, Math.min(4, along)), d: this.y - rest, dv: over ? this.vy : Math.min(0, this.vy) * 0.6, o: o0, ov: out, x0, z0, tx, tz, near: Math.abs(along) > 0.5 ? (along > 0 ? -1 : 1) : this.lead ? 1 : -1, t: 0, feet: null, shim: 0, stuck: 0, pumped: 0 };
    this.overrun = null;
    this.catchHeight = rest; this.climbT = 0; this.mu = 0; this.vy = 0; this.vx = this.vz = 0;
    // (caught: hanging, the hips swinging in under it, before anything's decided)
    this.state = 'climb'; this.move = 'hang'; this.atLip = 0; this.catches++;
  }
  /** a hold to hang from on the face ahead, between `lo` and `hi`: a sill, or a pipe at that height */
  private holdUp(lo: number, hi: number): { y: number; hold: Hold; x: number; z: number } | null {
    const x = this.x + this.wx * (this.R_ + 0.05), z = this.z + this.wz * (this.R_ + 0.05);
    let best: { y: number; hold: Hold; x: number; z: number } | null = null;
    for (const h of this.city.holdsNear(x, z, 1.4)) {
      if ((h.kind !== 'sill' && h.kind !== 'pipe') || h.nx * this.wx + h.nz * this.wz > -0.5) continue;
      const p = onHold(h, x, z), y = h.kind === 'pipe' ? Math.min(h.by, hi) : h.ay;
      if (Math.hypot(p[0] - x, p[2] - z) > 1.2 || y < lo || y > hi) continue;
      if (!best || y > best.y) best = { y, hold: h, x: p[0], z: p[2] };
    }
    return best;
  }
  /** hands on a hold part way up a face: hanging from it, to load and spring for the next */
  private hangFrom(g: { y: number; hold: Hold; x: number; z: number }): void {
    const l = Math.hypot(g.hold.bx - g.hold.ax, g.hold.bz - g.hold.az) > 0.1;
    this.grips = l ? { hl: onHold(g.hold, g.x + this.wz * 0.18, g.z - this.wx * 0.18), hr: onHold(g.hold, g.x - this.wz * 0.18, g.z + this.wx * 0.18) }
      : { hl: [g.x, g.y + 0.12, g.z], hr: [g.x, g.y - 0.1, g.z] };
    this.chain = { y: g.y, phase: 0, t: 0, y0: this.y, y1: g.y - this.hangLen, next: 0 };
    this.vy = 0; this.vx = this.vz = 0; this.climbT = 0; this.mu = 0;
    this.state = 'climb'; this.move = 'hang'; this.count('hang');
  }

  /** A wall to run along: beside the way it's going (no more head-on than `slant`), within reach, going on ahead. */
  private seek(slant: number, dx: number, dz: number): boolean {
    const sp = this.speed;
    if (!TUNE.walls || this.wallCool > 0 || sp < 4) return false;
    const H = (x: number, z: number) => this.city.heightAt(x, z), ux = this.vx / sp, uz = this.vz / sp;
    for (const [ax, az] of AXES) {
      const along = ax * ux + az * uz;
      if (dx * ax + dz * az < 0.24 || along < -0.1 || along > slant) continue;
      let d = 0.1; while (d <= TUNE.wallReach && H(this.x + ax * d, this.z + az * d) <= this.y + 1.2) d += 0.1;
      if (d > TUNE.wallReach) continue;
      let tx = ux - ax * along, tz = uz - az * along; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
      const wx = this.x + ax * (d + 0.05), wz = this.z + az * (d + 0.05);
      // (it has to go on: a wall there a stride ahead, and nothing across the way along it)
      if (H(wx + tx * 1.5, wz + tz * 1.5) <= this.y + 1.2 || H(this.x + ax * (d - this.R_ - 0.05) + tx * 1.5, this.z + az * (d - this.R_ - 0.05) + tz * 1.5) > this.y) continue;
      // (onto it from where it is: the gap to the wall closed over the run's first moments, not jumped)
      this.wallGap = Math.max(0, d - this.R_ - 0.05);
      this.state = 'wall'; this.move = 'wallrun'; this.wx = ax; this.wz = az; this.tx = tx; this.tz = tz; this.wallT = 0;
      this.wsp = Math.max(TUNE.wallSpeed, sp * Math.sqrt(1 - along * along)); this.vy = Math.min(5, Math.max(this.vy, 3.5));
      this.vx = tx * this.wsp; this.vz = tz * this.wsp; this.planned = false;
      // (which side of the figure it's on: the figure's +x is (cos, -sin) of its heading)
      const hd = Math.atan2(tx, tz); this.wallSide = ax * Math.cos(hd) - az * Math.sin(hd) > 0 ? 1 : -1;
      this.walls++; this.count('wallrun');
      return true;
    }
    return false;
  }

  /**
   * Along a wall. Left to itself it's a shallow arc, rising then sinking as gravity has it. Leaning into the wall
   * drives it up the wall as it goes along: that is how height is gained, and it is paid for, in how long the run
   * lasts and in pace along. Away from the wall, or a jump, kicks off it; so does the run's end, when time runs out. It ends on the wall's top if it gets there.
   */
  private wall(dt: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    const H = (x: number, z: number) => this.city.heightAt(x, z);
    const into = on ? dx * this.wx + dz * this.wz : 0, back = on && dx * this.tx + dz * this.tz < -0.5, up = Math.max(0, into);
    // (a wall close across the way, as tall: a narrow alley; leaning in, up it wall to wall)
    // (only once the lean has been held through the run's first beat: not the angle it happened to arrive at)
    if (TUNE.walls && up > 0.2 && this.wallT > 0.25 && this.wallGap < 0.02) { const d = this.across(); if (d > 0) { this.intoChimney(d); return; } }
    this.wallT += dt * (1 + TUNE.wallCost * up); this.wallPhase += ((this.wsp * dt) / (2 * this.stepLenOf(this.wsp))) * 2 * Math.PI;
    const left = Math.max(0, 1 - this.wallT / TUNE.wallTime);
    this.vy = Math.min(TUNE.wallRise, this.vy + (up * TUNE.wallLift * Math.min(1, left * 2.5) - TUNE.wallGravity) * dt);
    this.wsp = Math.max(TUNE.wallSpeed * 0.6, this.wsp - up * TUNE.wallDrag * dt);
    this.vx = this.tx * this.wsp; this.vz = this.tz * this.wsp;
    const kick = () => {
      this.vx = this.tx * this.wsp * 0.9 - this.wx * TUNE.kick; this.vz = this.tz * this.wsp * 0.9 - this.wz * TUNE.kick;
      this.wallCool = 0.12; this.launch(7.5, 'kick', false, false, 0.75);
    };
    if (jump || into < -0.5 || back) { kick(); return; }
    if (left <= 0) { kick(); return; }
    const close = Math.min(this.wallGap, 6 * dt); this.wallGap -= close;
    const nx = this.x + this.tx * this.wsp * dt + this.wx * close, nz = this.z + this.tz * this.wsp * dt + this.wz * close, ny = this.y + this.vy * dt;
    // (blocked ahead: pressed into the wall, with the alley's other wall in reach, up it wall to wall; else kicked off)
    if (H(nx + this.tx * this.R_, nz + this.tz * this.R_) > ny + 0.05) { if (TUNE.walls && up > 0.2 && this.wallGap < 0.02) { const d = this.across(); if (d > 0) { this.intoChimney(d, true); return; } } kick(); return; }
    this.x = nx; this.z = nz; this.y = ny;
    const g = H(nx, nz);
    if (this.y <= g) { this.y = g; this.touch(0); return; }
    const top = H(nx + this.wx * (this.R_ + 0.2 + this.wallGap), nz + this.wz * (this.R_ + 0.2 + this.wallGap));
    if (top > this.y + 0.25) return;
    this.wallCool = 0.2;
    // (its top: onto it; or it has ended: on, off the end of it)
    if (top > this.y - 0.7) { this.x += this.wx * (this.R_ + 0.3); this.z += this.wz * (this.R_ + 0.3); this.y = H(this.x, this.z); this.touch(0); return; }
    this.launch(Math.max(this.vy, 4.5), 'bound', false, false, 0.7);
  }

  /** how far the wall across a narrow alley is (from the body), or 0 if there's none in reach as tall as this one */
  /**
   * Pressed into something chest high to head high (a box, a low wall, a ledge), at a jog or slower: hands on its top and up
   * onto it (a mantle), the pull from where it stands, not a spring and a hang.
   */
  private mantle(dx: number, dz: number, mag: number): boolean {
    if (!TUNE.walls || mag < 0.55 || this.speed > 6) return false;
    for (const [ax, az] of AXES) {
      if (dx * ax + dz * az < 0.5) continue;
      const x = this.x + ax * (this.R_ + 0.1), z = this.z + az * (this.R_ + 0.1), top = this.city.heightAt(x, z), rise = top - this.y;
      if (rise < 0.9 || rise > 1.9) continue;
      const lip = this.city.gripAt(x, top, z, 0.4, (g) => g.kind === 'edge' && g.nx * ax + g.nz * az < -0.9);
      if (!lip || this.lipBad(x, z)) continue;
      this.wx = ax; this.wz = az;
      this.grabTop(lip, top, x, z);
      // (no hang: straight into the pull, from standing)
      this.sw = null; this.atLip = -1; this.move = 'climb'; this.climbT = 0; this.mu = 0; this.catchHeight = this.y; this.climbs++; this.count('mantle' as Move); this.climbIn = null;
      return true;
    }
    return false;
  }

  /**
   * Pressed into a tall wall in an alley narrow enough to bridge, going slowly (a dead end, or no run-up for a wall run):
   * after a beat braced, up it wall to wall from where it stands.
   */
  private chimneyUp(dt: number, dx: number, dz: number, mag: number): boolean {
    if (!TUNE.walls || mag < 0.55 || this.speed > 3 || (this.badChim && this.time < this.badChim.until && Math.hypot(this.x - this.badChim.x, this.z - this.badChim.z) < 1.5)) { this.wedge = 0; return false; }
    const H = (x: number, z: number) => this.city.heightAt(x, z), tall = this.y + 1.6;
    // (pressed head-on at the end of an alley: up it off its side walls, the nearer first, nowhere to go along it)
    const endOn = H(this.x + dx * (this.R_ + 0.15), this.z + dz * (this.R_ + 0.15)) > tall;
    for (const [ax, az] of AXES) {
      const side = endOn && Math.abs(dx * ax + dz * az) < 0.4;
      if (dx * ax + dz * az < 0.5 && !side) continue;
      let dw = 0; for (let d = this.R_; d <= this.R_ + (side ? 0.9 : 0.25); d += 0.05) if (H(this.x + ax * d, this.z + az * d) > tall) { dw = d; break; }
      if (!dw) continue;
      let dop = 0; for (let d = 0.3; d <= ALLEY; d += 0.1) if (H(this.x - ax * d, this.z - az * d) > tall) { dop = d; break; }
      if (!dop) continue;
      this.wedge += dt; if (this.wedge < BRACE) return false;
      this.wedge = 0;
      // (against the wall, a body's breadth off it; the way along the alley it was pressing, if any)
      this.x += ax * (dw - this.R_ - 0.05); this.z += az * (dw - this.R_ - 0.05);
      const ta = -az, tb = ax, sgn = dx * ta + dz * tb >= 0 ? 1 : -1;
      this.wx = ax; this.wz = az; this.tx = ta * sgn; this.tz = tb * sgn; this.wsp = 0; this.vx = this.vz = 0;
      const hd = Math.atan2(this.tx, this.tz); this.wallSide = ax * Math.cos(hd) - az * Math.sin(hd) > 0 ? 1 : -1;
      this.intoChimney(dop + (dw - this.R_ - 0.05), side);
      return true;
    }
    this.wedge = 0; return false;
  }
  private wedge = 0;
  /** where a chimney from a stand went nowhere: not tried again there for a while */
  private badChim: { x: number; z: number; until: number } | null = null;
  private across(): number {
    for (let d = this.R_ + 0.3; d <= ALLEY; d += 0.1) if (this.city.heightAt(this.x - this.wx * d, this.z - this.wz * d) > this.y + 1.6) return d;
    return 0;
  }
  /** wall to wall from here, `d` across; `blocked`: the way along it is a wall, so no way on along it, only up */
  private intoChimney(d: number, blocked = false): void {
    const ox = this.x + this.wx * (this.R_ + 0.05), oz = this.z + this.wz * (this.R_ + 0.05);
    this.ch = { ax: this.wx, az: this.wz, ox, oz, gap: d + this.R_ + 0.05, side: 1, t: 0, kicks: 0, along: 0, pace: blocked ? 0 : Math.min(4, this.wsp * 0.35) };
    this.state = 'chimney'; this.move = 'chimney'; this.vy = TIC_UP; this.chimneys++; this.count('chimney');
  }
  /**
   * Up a narrow alley, wall to wall: off one with a kick up and across, onto the other, a kick every TIC seconds, drifting
   * on along the alley; a top come within reach is caught and pulled over; let go (no direction held), it drops; the
   * alley widening or a wall ending, it's off into the air.
   */
  private chimney(dt: number, on: boolean): void {
    const c = this.ch!, H = (x: number, z: number) => this.city.heightAt(x, z), px = this.x, pz = this.z;
    c.t += dt; c.along += c.pace * dt;
    this.vy -= TUNE.gravity * dt; this.y += this.vy * dt;
    const from = c.side > 0 ? this.R_ : c.gap - this.R_, to = c.side > 0 ? c.gap - this.R_ : this.R_, k = Math.min(1, c.t / TIC), e = k * k * (3 - 2 * k), lat = from + (to - from) * e;
    this.x = c.ox - c.ax * lat + this.tx * c.along; this.z = c.oz - c.az * lat + this.tz * c.along;
    // (its velocity as it moves: along the alley and across it)
    const latV = k < 1 ? ((to - from) * 6 * k * (1 - k)) / TIC : 0;
    this.vx = this.tx * c.pace - c.ax * latV; this.vz = this.tz * c.pace - c.az * latV; this.mu = k; this.wallSide = c.side;
    let g = H(this.x, this.z);
    // (the alley ends in a wall ahead: stopped against it, not put on top of it)
    if (g > this.y + 0.6) { c.along -= c.pace * dt; c.pace = 0; this.x = c.ox - c.ax * lat + this.tx * c.along; this.z = c.oz - c.az * lat + this.tz * c.along; this.vx = -c.ax * latV; this.vz = -c.az * latV; g = H(this.x, this.z); }
    if (g > this.y + 0.6) { this.x = px; this.z = pz; this.vx = this.vz = 0; this.ch = null; this.launch(0, 'fall', false, false, 0.3); this.leaps--; return; }
    if (this.y <= g) { this.ch = null; this.y = g; this.touch(Math.max(0, -this.vy)); return; }
    if (k < 1) return;
    // (on the other wall: its top in reach is caught; else kicked off again, if it goes on and it's still wanted)
    c.side = -c.side; c.t = 0; c.kicks++; this.lead ^= 1;
    const nx = c.side > 0 ? c.ax : -c.ax, nz = c.side > 0 ? c.az : -c.az;
    const fx = this.x + nx * (this.R_ + 0.05), fz = this.z + nz * (this.R_ + 0.05), top = H(fx, fz), reach = top - this.y;
    if (reach > 0.5 && reach <= this.armReach) {
      const lip = this.city.gripAt(fx, top, fz, 0.5, (q) => q.kind === 'edge' && q.nx * nx + q.nz * nz < -0.9);
      if (lip) { this.wx = nx; this.wz = nz; this.ch = null; this.grabTop(lip, top, fx, fz); return; }
    }
    const fwd = H(fx + this.tx * 0.6, fz + this.tz * 0.6), back = H(this.x - nx * (c.gap - this.R_ + 0.05) + this.tx * 0.6, this.z - nz * (c.gap - this.R_ + 0.05) + this.tz * 0.6);
    // (the walls running out along the way only matters going along them; straight up, only the walls themselves)
    const along = c.pace > 0.5;
    if (!on || c.kicks >= 12 || reach <= 0.5 || (along && (fwd <= this.y + 0.6 || back <= this.y + 0.6))) {
      if (on) this.badChim = { x: this.x, z: this.z, until: this.time + 3 };
      this.ch = null; this.vx = this.tx * c.pace - nx * 2.5; this.vz = this.tz * c.pace - nz * 2.5; this.wx = nx; this.wz = nz;
      this.launch(Math.max(this.vy, 4), 'bound', false, false, 0.6); this.wallCool = 0.3; return;
    }
    this.vy = TIC_UP; this.spend(0.3);
  }

  private wallStep(dt: number, into: number): void {
    this.stepAge += dt;
    this.vy -= TUNE.gravity * dt; this.y += this.vy * dt;
    const x = this.x + this.wx * (this.R_ + 0.05), z = this.z + this.wz * (this.R_ + 0.05);
    const top = this.city.heightAt(x, z), reach = top - this.y;
    if (into > 0.55 && this.stepAge >= 0.06 && reach > 0.65 && reach <= this.armReach) {
      const lip = this.city.gripAt(x, top, z, 0.3, g => g.kind === 'edge' && g.nx * this.wx + g.nz * this.wz < -0.9);
      if (lip) { this.grabTop(lip, top, x, z); return; }
    }
    // (its top out of reach: a sill, or a pipe, in reach on the way up it, hung from; and from there, the next)
    // (taken as it comes into reach on the way up, the arm long; or about the top of the rise, from below it)
    if (into > 0.55 && this.stepAge >= 0.06 && reach > this.armReach) {
      const g = this.holdUp(this.y + 0.9, this.y + this.armReach);
      if (g) { this.hangFrom(g); return; }
    }
    if (this.vy <= 0 || into < 0.1 || this.stepAge > 0.5) {
      this.launch(this.vy, 'bound', false, false, 0.55);
      this.vx = -this.wx * 1.6; this.vz = -this.wz * 1.6; this.wallCool = 0.25;
    }
  }

  private touch(impact: number): void {
    const was = this.move, aimed = this.planned, braced = this.bracing;
    this.resetTakeoff(); this.land = 0; this.approach = null; this.stepTo = 0;
    // (up a storey costs pace)
    if (was === 'spring') { this.vx *= 0.82; this.vz *= 0.82; }
    // (how it went: off its mark (a fall, off a wall, into one) a stagger and a knock to the balance; heavy, deeper and
    // longer in the legs, held at the deepest if the emphasis asks, paid for in pace; else light, flowing on)
    const heavy = impact >= 9 ? Math.min(1, (impact - 9) / 8) : 0, off = was === 'fall' || was === 'kick' || braced;
    // (off its mark, and how: the hips carrying sideways off the line it meant, or short of it, or past it; or into a turn
    // too fast, the way it's asked to go well off the way it's going)
    this.save = null; this.ttc = 9;
    {
      const sp0 = this.speed, vx = sp0 > 0.5 ? this.vx / sp0 : 0, vz = sp0 > 0.5 ? this.vz / sp0 : 0;
      let kind: 'short' | 'wide' | 'long' | null = null, ex = 0, ez = 0, mag = 0;
      if (this.aim) {
        const a = this.aim, ox = this.x - a.x, oz = this.z - a.z, along = ox * a.ux + oz * a.uz, lat = -ox * a.uz + oz * a.ux;
        // (more than a stride off: it came down somewhere else (on something on the way), not a misjudged landing)
        if (Math.hypot(along, lat) > 1.2) { /* no save */ }
        else if (Math.abs(lat) > 0.2 && Math.abs(lat) >= Math.abs(along) * 0.6) { kind = 'wide'; mag = Math.abs(lat); const s = Math.sign(lat); ex = -a.uz * s; ez = a.ux * s; }
        else if (along < -0.25) { kind = 'short'; mag = -along; }
        else if (along > 0.4) { kind = 'long'; mag = along; }
      }
      // (not off a wall, or out of a fall: those have their own stagger)
      if (!kind && !off && sp0 > 8 && (this.want[0] || this.want[1])) {
        const cr = vx * this.want[1] - vz * this.want[0], dot = vx * this.want[0] + vz * this.want[1];
        // (the hips carry out of the turn: away from the way it's asked, across the way it's going)
        if (dot > 0 && Math.abs(cr) > 0.6) { kind = 'wide'; mag = Math.min(0.6, Math.abs(cr) * sp0 * 0.05); ex = -(this.want[0] - vx * dot); ez = -(this.want[1] - vz * dot); }
      }
      if (kind) {
        // (the hips carry to the side they're going; short and long saves cross no line, so the lead's side)
        if (kind !== 'wide') { const s = this.lead ? 1 : -1, h = this.heading; ex = Math.cos(h) * s * 0.0001; ez = -Math.sin(h) * s * 0.0001; }
        const l = Math.hypot(ex, ez) || 1; this.save = { kind, ex: ex / l, ez: ez / l, mag, t: 0, stage: 0 };
      }
      this.aim = null;
    }
    if (off) {
      this.landings.off++; this.sinkInto(impact, 1); this.recoverT = 0.25;
      this.vx *= 0.85; this.vz *= 0.85;
      // (knocked toward where the hips are actually carrying, not by which leg led)
      const side = this.save ? (this.saveSide ?? 1) : this.lead ? 1 : -1;
      this.balanceV += side * 1.6 + this.wallSide * (was === 'kick' ? 0.8 : 0);
    } else if (heavy > 0) {
      this.landings.heavy++; this.sinkInto(impact, 1.1); this.recoverT = 0.15 + 0.35 * heavy; this.hitPending = TUNE.emphasis > 0;
      if (was !== 'dive') { this.vx *= 1 - 0.3 * heavy; this.vz *= 1 - 0.3 * heavy; }
    } else { this.landings.flow++; this.sinkInto(impact, 0.85); }
    this.balanceV += this.turn * 0.05;
    if (this.save) { this.balanceV += (this.saveSide ?? 1) * Math.min(1.5, this.save.mag * 3); if (this.save.kind === 'short') this.recoverT = Math.max(this.recoverT, 0.2); }
    if (impact > 5) { this.impact = Math.min(1, impact / 16); this.impactT = 0; }
    this.phase = Math.PI / 2 + 0.31 + (this.lead ? 0 : Math.PI);
    this.state = 'ground'; this.vy = 0; this.planned = false; this.move = 'run';
    const sp = this.speed, ux = sp > 0.5 ? this.vx / sp : 0, uz = sp > 0.5 ? this.vz / sp : 0;
    // (a dive, or a hard landing, is rolled out of; a spring is landed deep; the rest are run out of)
    // (a long landing with room is a running save, not a roll, unless it's a dive's or it's very hard)
    if ((was === 'dive' || impact > (this.save?.kind === 'long' ? 14 : 10)) && sp > 4) { let room = 0;
      while (room < sp * ROLL && Math.abs(this.city.heightAt(this.x + ux * (room + 0.25), this.z + uz * (room + 0.25)) - this.y) <= STEP) room += 0.25;
      this.rollDuration = Math.min(ROLL, Math.max(0, room - this.R_) / sp);
      // (a lip close ahead: not rolled up to and over it; the legs take it, ready to go again)
      if (room < sp * ROLL) this.rollDuration = 0;
      this.rollT = this.rollDuration >= 0.24 ? this.rollDuration : 0;
      this.mu = 0; if (this.rollT > 0) { this.move = 'roll'; this.rolls++; this.count('roll'); }
    }

    // (an aimed landing on something narrow (a rim, a wall across an alley): stuck, the pace taken in the legs, a moment to
    // settle before it goes on along it)
    if (aimed && this.rollT <= 0 && (was === 'bound' || was === 'hop' || was === 'spring') && sp > 1) {
      const H = (x: number, z: number) => this.city.heightAt(x, z), px = -uz, pz = ux;
      // (unless it runs on along it, far enough to run on: a parapet landed on along its length is run, the chest still going)
      // (along its own length, which way it's going: a narrow top is a line, and the run's line drifts across it)
      let along = 0; const b = this.city.topAt(this.x, this.z);
      if (b && b.x1 - b.x0 < b.z1 - b.z0 && Math.abs(uz) > 0.8) along = uz > 0 ? b.z1 - this.z : this.z - b.z0;
      else if (b && b.z1 - b.z0 < b.x1 - b.x0 && Math.abs(ux) > 0.8) along = ux > 0 ? b.x1 - this.x : this.x - b.x0;
      else while (along < 4 && Math.abs(H(this.x + ux * (along + 0.3), this.z + uz * (along + 0.3)) - this.y) <= STEP) along += 0.3;
      if (along < Math.max(2.4, sp * 0.3) && H(this.x + px * 0.7, this.z + pz * 0.7) < this.y - STEP && H(this.x - px * 0.7, this.z - pz * 0.7) < this.y - STEP) {
        this.vx *= 0.15; this.vz *= 0.15; this.stickT = 0.3; this.legVelocity = Math.max(this.legVelocity, 4); this.count('stick' as Move);
        return;
      }
    }
    // (out of a roll, or landed as meant with room ahead: a dash)
    // (only if there's something near to go for and the effort to do it: else a couple of settling strides)
    // (not out of a vault: it's carried its pace over, and a low wall ahead isn't a gap to go for: a dash per wall on a line of
    // them ran it up to 18 m/s and every landing a save)
    if (sp > 6 && (this.rollT > 0 || (aimed && was !== 'glide' && was !== 'spring' && was !== 'vault'))) {
      const H = (d: number) => this.city.heightAt(this.x + ux * d, this.z + uz * d);
      let next = 99; for (let d = 1; d <= 16; d += 1) if (H(d) < this.y - STEP) { next = d; break; }
      const clear = [2, 4].every((d) => Math.abs(H(d) - this.y) <= STEP);
      if ((this.rollT > 0 || clear) && next <= 16 && this.stamina > 0.5) this.pushPending = true;
      else if (heavy > 0 || this.rollT > 0) this.breathT = 0.5;
    }
  }

  /**
   * The hang's swing, and what the stick does with it (true: it's gone, out of the hang). Left alone, the swing dies down.
   * Along the wall: hand over hand along the lip (a shimmy), while it goes on. Toward another wall (one beside, that the swing
   * takes the feet to): the feet go to it, and off them up and away, at a hold above if there's one to have. Away: let go,
   * with what the swing has (out on the swing out, back in on the way back). Toward the hang's own wall: pulled over (the
   * caller's), once the swing's come back in.
   */
  private swing2(dt: number, on: boolean, dx: number, dz: number, into: number): boolean {
    const w = this.sw!, H = (x: number, z: number) => this.city.heightAt(x, z), nx = -this.wx, nz = -this.wz, G = TUNE.gravity, L = 1.1;
    w.t += dt;
    // (the feet on a wall it swung to: a beat of load, and off them)
    if (w.feet) {
      const f = w.feet; f.t += dt; w.ov *= Math.exp(-14 * dt); w.v *= Math.exp(-14 * dt); w.dv *= Math.exp(-14 * dt);
      if (f.t < 0.14) { this.x = w.x0 + w.tx * w.s + nx * w.o; this.z = w.z0 + w.tz * w.s + nz * w.o; return true; }
      const vy = 7.2, T = vy / G;
      // (up to a hold within reach above, if there's one: arriving under it at the top of the rise; else up and away)
      const g = this.city.gripAt(this.x, this.y + 3, this.z, 2.6, (h) => h.kind === 'edge' && h.ay - this.y > 2.2 && h.ay - this.y < 4.6 && Math.abs(h.ay - this.top) > 0.3);
      let vx = -f.ax * 2.2, vz = -f.az * 2.2;
      if (g) { const tx = g.x + g.hold.nx * (this.R_ + 0.1) - this.x, tz = g.z + g.hold.nz * (this.R_ + 0.1) - this.z, k = Math.min(1, 4.5 / (Math.hypot(tx, tz) / T || 1)); vx = (tx / T) * k; vz = (tz / T) * k; }
      this.badLip = { x: w.x0, z: w.z0, until: this.time + 1 };
      this.sw = null; this.atLip = -1; this.vx = vx; this.vz = vz; this.launch(vy, 'kick', false, false, 2 * T); this.wallCool = 0.25; this.count('swingkick' as Move);
      return true;
    }
    // (the pendulum: along the wall and out from it; let alone it dies away, held it keeps on)
    const W2 = G / L, damp = on ? 0.5 : 1.6, s0 = w.s;
    w.v += (-W2 * w.s - damp * w.v) * dt; w.s += w.v * dt; if (Math.abs(w.s) > 1.3) { w.s = Math.sign(w.s) * 1.3; w.v = 0; }
    // (swung along the wall into something standing beside it (a corner, a taller neighbour): stopped by it, a little rebound)
    { const bx = w.x0 + w.tx * w.s + nx * w.o + w.tx * Math.sign(w.v) * this.R_, bz = w.z0 + w.tz * w.s + nz * w.o + w.tz * Math.sign(w.v) * this.R_; if (H(bx, bz) > this.y + 0.2) { w.s = s0; w.v = -0.2 * w.v; } }
    w.ov += (-W2 * w.o - damp * w.ov) * dt; w.o += w.ov * dt;
    // (swung back into the wall: the feet take it)
    if (w.o < 0) { w.o = 0; w.ov = -w.ov * 0.15; }
    if (w.o > 1.5) { w.o = 1.5; w.ov = 0; }
    // (above the still hang: falling into the arms; below it, the dip caught and settling)
    if (w.d > 0) w.dv -= G * dt; else w.dv += (-70 * w.d - 9 * w.dv) * dt;
    w.d = Math.max(-0.45, w.d + w.dv * dt); if (w.d < 0 && w.dv < -6) w.dv = -6;
    // (a shimmy: hand over hand along the lip, while there's lip, the swing small)
    const along = on ? dx * w.tx + dz * w.tz : 0;
    if (Math.abs(along) > 0.4 && Math.abs(into) < 0.5 && w.o < 0.4 && this.atLip > LIP_BEAT) {
      const sp = 0.9 * Math.min(1, Math.abs(along)) * Math.sign(along), x1 = w.x0 + w.tx * sp * dt, z1 = w.z0 + w.tz * sp * dt;
      const hx = x1 + this.wx * (this.R_ + 0.05) + w.tx * Math.sign(sp) * 0.3, hz = z1 + this.wz * (this.R_ + 0.05) + w.tz * Math.sign(sp) * 0.3;
      const lip = this.city.gripAt(hx, this.top, hz, 0.25, (h) => h.kind === 'edge' && Math.abs(h.ay - this.top) < 0.05 && h.nx * this.wx + h.nz * this.wz < -0.9);
      const clear = H(x1 + w.tx * Math.sign(sp) * this.R_, z1 + w.tz * Math.sign(sp) * this.R_) < this.y + 0.3;
      if (!(lip && clear)) w.stuck += dt;
      // (against a wall along it (a corner): nowhere on along, so up and over)
      if (!clear && w.stuck > 0.3) { this.atLip = -1; this.climbT = 0; this.mu = 0; this.move = 'climb'; this.climbs++; this.count('climb'); this.catchHeight = this.y; this.climbIn = null; return true; }
      // (at the lip's end: after a beat, let go on the way it's asked (a brush past))
      if (w.stuck > 0.5) { this.sw = null; this.atLip = -1; this.vx = dx * 3 - this.wx * 2; this.vz = dz * 3 - this.wz * 2; this.launch(0, 'fall', false, false, 0.4); this.wallCool = 0.3; this.made.fall = (this.made.fall ?? 1) - 1; this.leaps--; this.count('drop' as Move); return true; }
      if (lip && clear) {
        w.stuck = 0; w.x0 = x1; w.z0 = z1; w.shim += Math.abs(sp) * dt;
        // (the hands go one past the other: the leading one reaches on, the other comes up to it)
        const k = (w.shim / 0.3) % 2, lead = k < 1, step = (k % 1) * 0.3, gx = w.x0 + this.wx * (this.R_ + 0.05), gz = w.z0 + this.wz * (this.R_ + 0.05);
        const on1 = onHold(lip.hold, gx + w.tx * Math.sign(sp) * (lead ? step : 0.3) - 0.0, gz + w.tz * Math.sign(sp) * (lead ? step : 0.3));
        const on2 = onHold(lip.hold, gx + w.tx * Math.sign(sp) * (lead ? 0 : step - 0.3 + 0.0), gz + w.tz * Math.sign(sp) * (lead ? 0 : step - 0.3));
        const leftLeads = (w.tx * Math.sign(sp)) * -this.wz + (w.tz * Math.sign(sp)) * this.wx > 0;
        this.grips = leftLeads ? { hl: on1, hr: on2 } : { hl: on2, hr: on1 };
        this.count('shimmy' as Move);
      }
    }
    this.x = w.x0 + w.tx * w.s + nx * w.o; this.z = w.z0 + w.tz * w.s + nz * w.o;
    this.y = this.catchHeight + w.d + (w.s * w.s + w.o * w.o) / (2 * L);
    // (pressed away with a wall behind, within what a swing can reach: not let go (nowhere to drop to that's better), the
    // swing pumped out toward it, for the feet)
    let behind = 0; for (let d = 0.6; d <= 3; d += 0.2) if (H(this.x - this.wx * d, this.z - this.wz * d) > this.y + 1.6) { behind = d; break; }
    if (into < -0.15 && behind) { if (w.ov >= 0) w.ov += 6 * dt * Math.min(1, -into); w.pumped += dt; }
    // (pumped a while and the feet still can't have it (a wall too far for a swing): there's nowhere to drop to, so it's a
    // pull up, as in a narrow alley)
    if (w.pumped > 1.5 && w.o < 0.4) { w.pumped = 0; this.atLip = -1; this.climbT = 0; this.mu = 0; this.move = 'climb'; this.climbs++; this.count('climb'); this.catchHeight = this.y; this.climbIn = null; return true; }
    // (let go: with what the swing has, and a push off the wall)
    if (into < -0.15 && !behind) {
      const vo = w.ov + 1.5 * Math.min(1, -into);
      this.sw = null; this.atLip = -1;
      this.vx = w.tx * w.v + nx * vo; this.vz = w.tz * w.v + nz * vo;
      this.launch(Math.max(0, (w.s * w.v + w.o * w.ov) / L) + 0.4, 'fall', false, false, 0.4); this.wallCool = 0.3; this.made.fall = (this.made.fall ?? 1) - 1; this.leaps--; this.count('drop' as Move);
      return true;
    }
    // (toward a wall beside, that the swing has taken the feet to (the legs' length from the hips): the feet to it)
    if (on && this.atLip > 0.12) {
      const m = Math.hypot(dx, dz) || 1, px = dx / m, pz = dz / m;
      let best: number[] | null = null;
      for (const [ax, az] of AXES) {
        if (ax * px + az * pz < 0.6 || ax * this.wx + az * this.wz > 0.5) continue;
        for (let k = 0.3; k <= 1.25; k += 0.15) if (H(this.x + ax * (this.R_ + k), this.z + az * (this.R_ + k)) > this.y + 1.4) { best = [ax, az]; break; }
        if (best) break;
      }
      // (only for somewhere to go off them: a hold above in a kick's reach; else the feet are no use there)
      const up = best && this.city.gripAt(this.x, this.y + 3, this.z, 2.6, (h) => h.kind === 'edge' && h.ay - this.y > 2.2 && h.ay - this.y < 4.6 && Math.abs(h.ay - this.top) > 0.3);
      const tried = this.swungFrom && this.time < this.swungFrom.until && Math.hypot(this.x - this.swungFrom.x, this.z - this.swungFrom.z) < 1.5;
      if (best && up && !tried) { this.swungFrom = { x: this.x, z: this.z, until: this.time + 6 }; w.feet = { ax: best[0], az: best[1], t: 0 }; this.count('swingfeet' as Move); return true; }
    }
    return false;
  }
  private climb(dt: number, on: boolean, dx: number, dz: number, jump: boolean): void {
    this.climbT += dt;
    if (this.chain) { this.hang(dt, on ? dx * this.wx + dz * this.wz : 0, jump); return; }
    if (this.atLip >= 0) {
      // (hanging from a lip it caught: a beat for the hips to swing in under it; then pressing on toward the wall pulls over
      // (a tap too); pressing away, it lets go and drops)
      const into = on ? dx * this.wx + dz * this.wz : 0;
      this.atLip += dt; this.mu = Math.min(1, this.atLip / LIP_BEAT);
      if (this.sw && this.swing2(dt, on, dx, dz, into)) return;
      // (pressing on at all toward it (not away, not straight along) pulls over, once the swing out has come back in)
      if (((this.atLip >= LIP_BEAT && into > 0.15) || (jump && this.atLip > 0.08)) && (!this.sw || (this.sw.o < 0.4 && this.sw.d <= 0.15))) {
        this.atLip = -1; this.climbT = 0; this.mu = 0; this.move = 'climb'; this.climbs++; this.count('climb'); this.catchHeight = this.y; this.climbIn = null;
      }
      return;
    }
    // (turned away from the wall, or a jump: off it, the other way; not into a wall close behind (an alley): nowhere to go)
    let behind = false; for (let d = 0.6; d <= 3 && !behind; d += 0.2) behind = this.city.heightAt(this.x - this.wx * d, this.z - this.wz * d) > this.y + 1.6;
    if (((on && dx * this.wx + dz * this.wz < -0.4) || jump) && !behind) {
      const ox = on ? dx : -this.wx, oz = on ? dz : -this.wz;
      this.vx = ox * 8; this.vz = oz * 8; this.launch(JUMP, 'flip', false, false, 0.9); return;
    }
    if (this.sw) { const k = 1 - Math.exp(-10 * dt); this.x += (this.sw.x0 - this.x) * k; this.z += (this.sw.z0 - this.z) * k; }
    // (up a wall on its feet: a run up it; a pull with no foot on the wall (out of a hang, or a mantle from a stand): the pull
    // up to the hands, the press over them, the knee onto the top: longer, and by how far it has to come)
    const duration = this.stepFoot ? Math.max(0.32, (this.top - this.catchHeight) / TUNE.climb + 0.22) : 0.5 + 0.18 * Math.max(0, this.top - this.catchHeight);
    this.mu = Math.min(1, this.climbT / duration);
    const pull = this.mu * this.mu * (3 - 2 * this.mu);
    this.y = this.catchHeight + (this.top - this.catchHeight) * pull;
    // Let the pelvis swing away beneath the fixed hands, then draw it back to the lip.
    // (with no foot on the wall: the hips come in over the hands as it rises, to the wall's face, so the step on at the top
    // is a short one, not a jump)
    if (!this.stepFoot && !this.climbIn) this.climbIn = [this.x, this.z, this.x + this.wx * (this.R_ - 0.08), this.z + this.wz * (this.R_ - 0.08)];
    if (this.climbIn && !this.stepFoot) { const [x0, z0, x1, z1] = this.climbIn; this.x = x0 + (x1 - x0) * pull; this.z = z0 + (z1 - z0) * pull; }
    if (this.stepFoot) {
      const clearance = this.R_ * (1 - pull) + 0.14 * Math.sin(Math.PI * this.mu);
      this.x = this.stepFoot[0] - this.wx * Math.max(0.02, clearance);
      this.z = this.stepFoot[2] - this.wz * Math.max(0.02, clearance);
    }
    if (this.mu < 1) return;
    // (over: onto the top where there's footing on it, as far on as it takes (a rim's depth), not just past the lip)
    let px = this.x + this.wx * 0.13, pz = this.z + this.wz * 0.13, h = this.city.heightAt(px, pz);
    for (let d = 0.13; d <= 0.7 && Math.abs(h - this.top) > STEP; d += 0.08) { px = this.x + this.wx * d; pz = this.z + this.wz * d; h = this.city.heightAt(px, pz); }
    // (nothing to stand on over it after all: pushed back off the wall to a body's breadth from it, and away)
    if (Math.abs(h - this.top) > STEP) { this.badLip = { x: this.x, z: this.z, until: this.time + 3 }; const fx = this.stepFoot ? this.stepFoot[0] : this.x + this.wx * 0.02, fz = this.stepFoot ? this.stepFoot[2] : this.z + this.wz * 0.02; this.x = fx - this.wx * (this.R_ + 0.05); this.z = fz - this.wz * (this.R_ + 0.05); this.launch(0, 'bound', false, false, 0.5); return; }
    this.x = px; this.z = pz; this.y = h; this.state = 'ground'; this.move = 'run'; this.climbIn = null;
    this.vx = this.wx * 6; this.vz = this.wz * 6; this.land = Math.max(this.land, 0.45);
  }

  /**
   * Hanging from a hold on the way up a face, as up a fire escape: caught (the body swinging in under the hands), loaded
   * (knees up, feet on the wall), and sprung for the next hold: the roof's lip, pulled over; or a sill a storey up, hung
   * from again. Pressing into the wall goes again as soon as it's loaded; a tap goes at once (the rhythm is yours);
   * pressing away lets go.
   */
  private hang(dt: number, into: number, jump: boolean): void {
    const c = this.chain!, H = (x: number, z: number) => this.city.heightAt(x, z);
    const wx = this.x + this.wx * (this.R_ + 0.05), wz = this.z + this.wz * (this.R_ + 0.05);
    c.t += dt;
    if (into < -0.4) { this.chain = null; this.vx = -this.wx * 3; this.vz = -this.wz * 3; this.launch(2, 'fall', false, false, 0.4); this.wallCool = 0.3; return; }
    if (c.phase === 0) {
      // (caught: the body comes in under the hands)
      const k = Math.min(1, c.t / CHAIN_CATCH); this.y = c.y0 + (c.y1 - c.y0) * (k * k * (3 - 2 * k)); this.mu = k;
      if (k >= 1) { c.phase = 1; c.t = 0; }
      return;
    }
    if (c.phase === 1) {
      this.mu = Math.min(1, c.t / CHAIN_LOAD);
      if (!(jump && c.t > 0.05) && !(into > 0.55 && c.t >= CHAIN_LOAD / (0.7 + 0.3 * this.stamina))) return;
      // (for the next: the roof's lip if it's within a spring and a reach, else a hold a storey or so up)
      const top = H(wx, wz);
      if (top - c.y <= 3.3) c.next = top;
      else { const g = this.holdUp(c.y + 1.2, c.y + 3.6); if (!g) return; c.next = g.y; }
      this.effort = 0.8; if (this.tame()) return; this.spend(0.7); this.effort = 0;
      c.phase = 2; c.t = 0; c.y0 = this.y; c.y1 = c.next - (c.next === top ? this.armReach * 0.75 : this.hangLen); this.chains++; this.count('hang');
      // (sprung as a body is: as long as gravity takes to rise that far, not shot up it)
      c.dur = Math.max(CHAIN_SPRING, Math.sqrt((2 * Math.max(0, c.y1 - c.y0)) / TUNE.gravity));
      return;
    }
    // (springing: fast off the wall, slowing into the catch, the body long, arms up for the next)
    const k = Math.min(1, c.t / (c.dur ?? CHAIN_SPRING)), e = 1 - (1 - k) * (1 - k);
    this.y = c.y0 + (c.y1 - c.y0) * e; this.mu = k;
    if (k < 1) return;
    const top = H(wx, wz);
    if (Math.abs(c.next - top) < 0.05) {
      const lip = this.city.gripAt(wx, top, wz, 0.5, (g) => g.kind === 'edge' && g.nx * this.wx + g.nz * this.wz < -0.9);
      if (lip) { this.grabTop(lip, top, wx, wz); return; }
    } else {
      const g = this.holdUp(c.next - 0.05, c.next + 0.05);
      if (g) { this.hangFrom(g); this.chain!.y0 = this.y; return; }
    }
    this.chain = null; this.launch(0, 'fall', false, false, 0.3);
  }
}

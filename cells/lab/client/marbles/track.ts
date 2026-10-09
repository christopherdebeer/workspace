/**
 * Marble Run: the track, apart from the drawing and the solver (so it can be tested on its own).
 *
 * A run is a seed and a list of choices. From the top it goes down section by section; each
 * section is one of a few kinds (a slope, a bend, an ess, a helix, a drop, a jump, a loop, a
 * slalom tray, a funnel, a spinner tray, a switchback), its particulars from the seed and its
 * place in the run, and each ends lower than it began. At the end of the run three candidates
 * are on offer (and three more, and three more): the choice is a number, so a run is the seed
 * and those numbers, and the same numbers are the same run.
 *
 * The track is mostly a channel: a trough of radius R swept along a path, open above (a little
 * more than a half-pipe; a full tube for a loop). The path is a turtle: forward in steps, its
 * heading and pitch turning as it goes, with a bank; its frames (tangent, up, side) are carried
 * along by parallel transport, then banked. Units are centimetres; a marble is about 2 across.
 */
import { hash, seeded, type Rand } from '../kit/rng';

export type V3 = [number, number, number];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** a rotated about unit axis k by angle t (Rodrigues) */
export function rot(a: V3, k: V3, t: number): V3 {
  const c = Math.cos(t), s = Math.sin(t);
  const kx = cross(k, a), kd = dot(k, a);
  return [a[0] * c + kx[0] * s + k[0] * kd * (1 - c), a[1] * c + kx[1] * s + k[1] * kd * (1 - c), a[2] * c + kx[2] * s + k[2] * kd * (1 - c)];
}

/** the channel: its radius, and how far round from the bottom its walls go (a half-pipe is π/2) */
export const R = 2.6;
export const OPEN = 2.3;
/** the step between frames along a path */
export const DS = 0.5;

export interface Frame {
  p: V3;
  /** along, up (the open side), and to the right */
  t: V3;
  n: V3;
  b: V3;
}

/** The turtle's state: where it is and which way it's going. */
export interface Turtle {
  p: V3;
  yaw: number;
  pitch: number;
  bank: number;
  /** the track's up, carried along */
  n: V3;
}
export const dirOf = (yaw: number, pitch: number): V3 => [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];

/** A leg of a path: so far, turning so much in yaw and pitch over it, banking to so much; `eased`, the turn comes on and goes off gently (the first and last quarter), as a curve should. */
export interface Leg { len: number; dyaw: number; dpitch: number; bank: number; eased?: boolean }

/**
 * Walk legs from a turtle, a frame every DS: the up carried by parallel transport (so a loop
 * comes round right) and then banked.
 */
export function walk(t0: Turtle, legs: Leg[]): { frames: Frame[]; end: Turtle } {
  const frames: Frame[] = [];
  let p = [...t0.p] as V3;
  let yaw = t0.yaw, pitch = t0.pitch, bank = t0.bank;
  let n = [...t0.n] as V3;
  let t = dirOf(yaw, pitch);
  const push = () => {
    // (the up, transported, then turned about the tangent by the bank)
    const nn = norm(sub(n, mul(t, dot(n, t))));
    const nb = rot(nn, t, bank);
    frames.push({ p: [...p] as V3, t: [...t] as V3, n: nb, b: norm(cross(t, nb)) });
    n = nn;
  };
  push();
  for (const leg of legs) {
    const steps = Math.max(1, Math.round(leg.len / DS));
    const ds = leg.len / steps;
    const bank0 = bank;
    // (the turn's share of each step: even, or eased in over the first quarter and out over the last)
    const sm = (x: number) => x * x * (3 - 2 * x);
    const weight = (i: number) => {
      if (!leg.eased) return 1;
      const u = (i - 0.5) / steps;
      return u < 0.25 ? sm(u / 0.25) : u > 0.75 ? sm((1 - u) / 0.25) : 1;
    };
    let total = 0;
    for (let i = 1; i <= steps; i++) total += weight(i);
    for (let i = 1; i <= steps; i++) {
      const share = weight(i) / total;
      yaw += leg.dyaw * share;
      pitch += leg.dpitch / steps;
      // (the bank follows the turn: eased, it comes on and goes off with the curve, so the leg
      // ends level again; else it goes evenly to the leg's bank)
      bank = leg.eased ? bank0 + (leg.bank - bank0) * weight(i) : bank0 + (leg.bank - bank0) * (i / steps);
      t = dirOf(yaw, pitch);
      p = add(p, mul(t, ds));
      push();
    }
  }
  return { frames, end: { p, yaw, pitch, bank, n } };
}

// ─── what else a section can hold ─────────────────────────────────────────────────────────────
/** A flat tray in a frame: a floor so wide and long, walls either side, pegs standing in it. */
export interface Tray {
  frame: Frame;
  width: number;
  length: number;
  /** pegs: along, across (from the middle), radius */
  pegs: Array<[number, number, number]>;
  /** a spinning bar in the middle: its half-length and turns a second (signed) */
  spinner?: { half: number; rate: number; at: number };
  /** the far end narrows to the exit over this length */
  funnelIn: number;
}
/** A bowl: a cone (apex down), a hole at the bottom (0: none, so it's a cup), a rim wall. */
export interface Bowl {
  centre: V3;
  /** the rim's radius and height above the apex */
  radius: number;
  height: number;
  hole: number;
}
export interface Section {
  kind: Kind;
  name: string;
  /** the channel's frames, in pieces (a jump has two: the lip, and the landing); a taper narrows it from r to r1 along its length */
  channels: Array<{ frames: Frame[]; r: number; open: number; r1?: number }>;
  trays: Tray[];
  bowls: Bowl[];
  /** the frame it ends in, for the next section */
  end: Turtle;
  /** how far along, counting every channel and tray (for the race order) */
  length: number;
  drop: number;
}
export const KINDS = ['slope', 'bend', 'ess', 'helix', 'drop', 'jump', 'loop', 'slalom', 'funnel', 'spinner', 'switchback'] as const;
export type Kind = (typeof KINDS)[number];
const DEG = Math.PI / 180;

/** The turtle at the very top: on the tower, heading north, already sloping down. */
export const TOP: Turtle = { p: [0, 400, 0], yaw: 0, pitch: -12 * DEG, bank: 0, n: [0, 1, 0] };

const ramp = (r: Rand, a: number, b: number) => a + r() * (b - a);
const pick = <T>(r: Rand, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];

/** A section of a kind from a turtle, with its particulars from the rng. */
export function section(kind: Kind, from: Turtle, r: Rand, speed = 200): Section {
  // (a fast marble needs a wider curve: no more than about six g sideways)
  const wide = (rad: number) => Math.max(rad, (speed * speed) / (981 * 6));
  const s: Section = { kind, name: '', channels: [], trays: [], bowls: [], end: from, length: 0, drop: 0 };
  const chan = (t: Turtle, legs: Leg[], rr = R, open = OPEN, r1?: number) => {
    const w = walk(t, legs);
    s.channels.push({ frames: w.frames, r: rr, open, ...(r1 !== undefined ? { r1 } : {}) });
    s.length += legs.reduce((a, l) => a + l.len, 0);
    return w.end;
  };
  // (ease the pitch toward a target, keeping the bank: over a length that keeps a crest gentle
  // enough that a fast marble stays down — a convex curve of radius under two metres is a ramp)
  const ease = (t: Turtle, pitch: number, l: number): Turtle => chan(t, [{ len: Math.max(l, Math.abs(pitch - t.pitch) * 220), dyaw: 0, dpitch: pitch - t.pitch, bank: 0 }]);
  switch (kind) {
    case 'slope': {
      const pitch = -ramp(r, 8, 24) * DEG, l = ramp(r, 40, 110);
      const wob = r() < 0.5 ? 0 : ramp(r, -25, 25) * DEG;
      s.name = Math.abs(wob) > 0.1 ? 'a sloping sweep' : 'a slope';
      const l0 = Math.max(l * 0.3, Math.abs(pitch - from.pitch) * 220);
      s.end = chan(from, [{ len: l0, dyaw: wob * 0.3, dpitch: pitch - from.pitch, bank: wob * 0.4 }, { len: l * 0.7, dyaw: wob * 0.7, dpitch: 0, bank: 0 }]);
      break;
    }
    case 'bend': {
      const sign = r() < 0.5 ? -1 : 1, turn = ramp(r, 70, 180) * DEG * sign, rad = wide(ramp(r, 12, 28));
      const bank = -sign * ramp(r, 12, 32) * DEG, pitch = -ramp(r, 5, 12) * DEG;
      s.name = `a ${sign > 0 ? 'right' : 'left'} bend`;
      let t = ease(from, pitch, 10);
      t = chan(t, [{ len: Math.abs(turn) * rad, dyaw: turn, dpitch: 0, bank, eased: true }]);
      s.end = chan(t, [{ len: 10, dyaw: 0, dpitch: 0, bank: 0 }]);
      break;
    }
    case 'ess': {
      const sign = r() < 0.5 ? -1 : 1, turn = ramp(r, 60, 110) * DEG, rad = wide(ramp(r, 10, 20)), bank = ramp(r, 15, 30) * DEG, pitch = -ramp(r, 6, 12) * DEG;
      s.name = 'an ess';
      let t = ease(from, pitch, 8);
      t = chan(t, [{ len: turn * rad, dyaw: turn * sign, dpitch: 0, bank: -sign * bank, eased: true }, { len: 6, dyaw: 0, dpitch: 0, bank: 0 }, { len: turn * rad, dyaw: -turn * sign, dpitch: 0, bank: sign * bank, eased: true }]);
      s.end = chan(t, [{ len: 8, dyaw: 0, dpitch: 0, bank: 0 }]);
      break;
    }
    case 'helix': {
      const sign = r() < 0.5 ? -1 : 1, turns = ramp(r, 1, 2.5), rad = wide(ramp(r, 9, 15)) * 0.85, per = ramp(r, 5, 8);
      const circ = Math.PI * 2 * rad, pitch = -Math.atan2(per, circ);
      s.name = `a helix, ${turns.toFixed(1)} turns`;
      let t = ease(from, pitch, 8);
      t = chan(t, [{ len: circ * turns, dyaw: Math.PI * 2 * turns * sign, dpitch: 0, bank: -sign * 22 * DEG, eased: true }]);
      s.end = chan(t, [{ len: 8, dyaw: 0, dpitch: 0, bank: 0 }]);
      break;
    }
    case 'drop': {
      const steep = -ramp(r, 42, 60) * DEG, l = ramp(r, 12, 22);
      s.name = 'a drop';
      // (over the lip a marble flies; the chute is a tube, so it's caught, and it levels out in a tube too)
      let t = chan(from, [{ len: 14, dyaw: 0, dpitch: steep - from.pitch, bank: 0 }], R, Math.PI);
      t = chan(t, [{ len: l, dyaw: 0, dpitch: 0, bank: 0 }], R, Math.PI);
      t = chan(t, [{ len: 22, dyaw: 0, dpitch: -10 * DEG - steep, bank: 0 }], R, Math.PI);
      s.end = chan(t, [{ len: 10, dyaw: 0, dpitch: 0, bank: 0 }]);
      break;
    }
    case 'jump': {
      const gap = ramp(r, 8, 14), fall = ramp(r, 8, 16);
      s.name = 'a jump';
      // a lip: flatten then rise a little; then nothing; then a wider, flared landing lower down
      let t = chan(from, [{ len: Math.max(14, Math.abs(6 * DEG - from.pitch) * 60), dyaw: 0, dpitch: 6 * DEG - from.pitch, bank: 0 }, { len: 8, dyaw: 0, dpitch: 0, bank: 0 }]);
      const d = dirOf(t.yaw, 0);
      const land: Turtle = { p: add(add(t.p, mul(d, gap)), [0, -fall, 0]), yaw: t.yaw, pitch: -14 * DEG, bank: 0, n: [0, 1, 0] };
      // (a wide landing, narrowing back to the channel's width by its end)
      t = chan(land, [{ len: 64, dyaw: 0, dpitch: 0, bank: 0 }], R * 1.8, OPEN, R);
      s.end = chan(t, [{ len: 12, dyaw: 0, dpitch: 0, bank: 0 }]);
      break;
    }
    case 'loop': {
      const rad = ramp(r, 7, 10);
      s.name = 'a loop';
      // a dip to gather speed, the loop as a full tube (leaning a touch so it comes out beside where it went in), then on
      let t = chan(from, [{ len: 12, dyaw: 0, dpitch: -30 * DEG - from.pitch, bank: 0 }, { len: 14, dyaw: 0, dpitch: 30 * DEG, bank: 0 }]);
      t = chan(t, [{ len: Math.PI * 2 * rad, dyaw: 12 * DEG, dpitch: Math.PI * 2, bank: 0, eased: true }], R, Math.PI);
      s.end = chan(t, [{ len: 14, dyaw: 0, dpitch: -14 * DEG, bank: 0 }]);
      break;
    }
    case 'switchback': {
      const sign = r() < 0.5 ? -1 : 1, rad = wide(ramp(r, 7, 10)) * 0.8;
      s.name = 'a switchback';
      let t = ease(from, -8 * DEG, 8);
      t = chan(t, [{ len: Math.PI * rad, dyaw: Math.PI * sign, dpitch: 0, bank: -sign * 38 * DEG, eased: true }]);
      s.end = chan(t, [{ len: 10, dyaw: 0, dpitch: 0, bank: 0 }]);
      break;
    }
    case 'slalom': case 'spinner': {
      const width = kind === 'slalom' ? ramp(r, 22, 32) : ramp(r, 24, 30), length = kind === 'slalom' ? ramp(r, 60, 86) : ramp(r, 48, 60);
      s.name = kind === 'slalom' ? 'a slalom' : 'a spinner';
      // the channel levels and flares into the tray; the tray slopes gently; the far end narrows back
      const t = ease(from, -7 * DEG, 10);
      const frame = walk(t, []).frames[0];
      const tray: Tray = { frame, width, length, pegs: [], funnelIn: 26 };
      if (kind === 'slalom') {
        const rows = Math.floor(ramp(r, 4, 7));
        for (let i = 0; i < rows; i++) {
          const along = 8 + ((length - 36) * (i + 0.5)) / rows;
          const n = 2 + (i % 2);
          for (let j = 0; j < n; j++) tray.pegs.push([along, ((j + 0.5) / n - 0.5) * width * 0.86 + (i % 2 ? 0 : 0), 1.4]);
        }
      } else tray.spinner = { half: width * 0.36, rate: (r() < 0.5 ? -1 : 1) * ramp(r, 0.4, 0.8), at: length * 0.45 };
      s.trays.push(tray);
      s.length += length;
      const d = dirOf(t.yaw, -7 * DEG);
      const out: Turtle = { p: add(t.p, mul(d, length)), yaw: t.yaw, pitch: -7 * DEG, bank: 0, n: [0, 1, 0] };
      s.end = chan(out, [{ len: 10, dyaw: 0, dpitch: -4 * DEG, bank: 0 }]);
      break;
    }
    case 'funnel': {
      const rad = ramp(r, 14, 20), height = rad * 0.55;
      s.name = 'a funnel';
      // in along the rim, tangentially; the bowl; out of the hole into a tube that bends away
      const t = ease(from, -5 * DEG, 10);
      const d = dirOf(t.yaw, 0), side = norm(cross([0, 1, 0], d));
      // (the rim is R below the channel's floor, the bowl's centre a radius to the side of the entry)
      const sgn = r() < 0.5 ? -1 : 1;
      const centre: V3 = add(add(t.p, mul(side, sgn * rad)), [0, -R - 1.5, 0]);
      const apex: V3 = add(centre, [0, -height, 0]);
      s.bowls.push({ centre: apex, radius: rad, height, hole: 2.4 });
      s.length += Math.PI * 2 * rad * 1.5;
      const tube: Turtle = { p: add(apex, [0, 0.5, 0]), yaw: t.yaw, pitch: -Math.PI / 2 + 0.01, bank: 0, n: [0, 0, 1] };
      const t2 = chan(tube, [{ len: 10, dyaw: 0, dpitch: 0, bank: 0 }, { len: 14, dyaw: 0, dpitch: Math.PI / 2 - 14 * DEG, bank: 0 }], R, Math.PI);
      s.end = chan(t2, [{ len: 10, dyaw: 0, dpitch: 0, bank: 0 }]);
      break;
    }
  }
  s.drop = from.p[1] - s.end.p[1];
  return s;
}

/** How fast a marble might be going by now, roughly, from how far the run has dropped lately. */
function speedGuess(sections: Section[]): number {
  let h = 0;
  for (const s of sections.slice(-3)) h += s.drop;
  // (the trough's roughness keeps a long run to a few metres a second)
  return Math.min(320, Math.sqrt(Math.max(0, 2 * 981 * h * 0.4)));
}

/** The three candidates for the next section, by its place in the run and which three. */
export function candidates(seed: number, index: number, sections: Section[], page = 0): Section[] {
  const from = sections.length ? sections[sections.length - 1].end : TOP;
  const out: Section[] = [];
  const v = speedGuess(sections);
  const last = sections[sections.length - 1]?.kind;
  for (let k = 0; k < 3; k++) {
    const r = seeded(hash(seed, index, page * 3 + k, 0x3a7));
    let kind: Kind = pick(r, KINDS);
    // (no loop without the speed for it; not the same tray twice running; the first few are easy)
    for (let tries = 0; tries < 8; tries++) {
      // (and not a drop or a jump onto a marble already going fast: the jump's gap is sized for a walk)
      const ok = !(kind === 'loop' && v < 2 * Math.sqrt(981 * 10 * 2.5)) && kind !== last && !(index < 2 && (kind === 'loop' || kind === 'funnel' || kind === 'jump')) && !(v > 250 && (kind === 'drop' || kind === 'jump' || kind === 'funnel'));
      if (ok) break;
      kind = pick(r, KINDS);
    }
    out.push(section(kind, from, r, v));
  }
  return out;
}

/** A whole run: its sections from the seed and the choices (each a candidate's number: page * 3 + k). */
export function build(seed: number, choices: number[]): Section[] {
  const sections: Section[] = [];
  choices.forEach((c, i) => {
    const cs = candidates(seed, i, sections, Math.floor(c / 3));
    sections.push(cs[c % 3]);
  });
  return sections;
}

/** The finish: a cup at the end of the run, with a little channel into it. */
export function finish(end: Turtle): { channel: { frames: Frame[]; r: number; open: number }; bowl: Bowl } {
  const w = walk(end, [{ len: 12, dyaw: 0, dpitch: -4 * DEG - end.pitch, bank: 0 }]);
  const d = dirOf(w.end.yaw, 0);
  const centre = add(add(w.end.p, mul(d, 7)), [0, -R - 1, 0]);
  return { channel: { frames: w.frames, r: R, open: OPEN }, bowl: { centre: add(centre, [0, -5, 0]), radius: 8, height: 5, hole: 0 } };
}

/** The run as a query string, and back. */
export const encode = (seed: number, choices: number[]) => `seed=${seed}&run=${choices.join('.')}`;
export function decode(q: URLSearchParams): { seed: number; choices: number[] } {
  const seed = Number(q.get('seed')) || 0;
  const run = (q.get('run') ?? '').split('.').filter((x) => x !== '').map(Number).filter((x) => Number.isFinite(x) && x >= 0);
  return { seed, choices: run };
}

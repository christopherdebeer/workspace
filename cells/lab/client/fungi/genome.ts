/**
 * Hat-throwers: a species of small dung and litter fungus from a seed, a patch of it, and its day
 * — the rules, apart from the drawing.
 *
 * Four kinds, each with its own range of everything:
 *
 * - **thrower** (Pilobolus): a sporangiophore clear as glass, yellow at the top, beading with
 *   water; a vesicle swells under its black sporangium — a lens, turning it to the light — and by
 *   late morning bursts, shooting the sporangium off toward the light. The stalk slumps.
 * - **pin** (Mucor and kin): glass stalks with yellow heads; they never throw.
 * - **inkcap** (Coprinellus): pale, pleated bells on velvety, hairy stalks, rising out of white
 *   fuzz; the caps open through the day, and at the end their margins ink, grey to black.
 * - **cup** (Ascobolus): lumps of yellow-green jelly, glistening, and through their skin the asci
 *   push up one by one, clear tubes each with eight spores in a column, darkening as they ripen;
 *   ripe, an ascus fires its spores off as one, the fastest thing in the living world, and shrinks.
 *
 * Units are millimetres and hours. Everything comes from the seed: the species (its genome), the
 * patch (where each thing stands, when it starts, how it leans) and every droplet.
 */
import { hash, seeded, type Rand } from '../kit/rng';

export type V3 = [number, number, number];
export type Form = 'thrower' | 'pin' | 'inkcap' | 'cup' | 'eyelash' | 'flask';
export const FORMS: Form[] = ['thrower', 'pin', 'inkcap', 'cup', 'eyelash', 'flask'];

export interface Genome {
  name: string;
  form: Form;
  /** the things' height (mm): the camera's scale */
  scale: number;
  // stalks (thrower, pin, inkcap)
  height: [number, number];
  radius: number;
  vesicle: number;
  vesicleLong: number;
  cap: number;
  capFlat: number;
  capColour: V3;
  glass: V3;
  tip: V3;
  tipLength: number;
  lean: number;
  wave: number;
  /** how glassy the stalk (1) or velvety and opaque (0); how hairy */
  glassy: number;
  fuzz: number;
  // inkcap bells
  bell: number;
  bellTall: number;
  pleats: number;
  pleatDepth: number;
  bellColour: V3;
  bellTop: V3;
  ink: number;
  // cups
  jelly: V3;
  jellyDeep: V3;
  cushion: number;
  asci: number;
  spore: V3;
  // an eyelash cup's hairs, round its rim: how many, how long (mm); a flask's body (mm)
  hairs: number;
  hairLen: number;
  flask: number;
  // water
  dew: number;
  dewSize: number;
  // the patch
  count: number;
  patch: number;
  spread: number;
  throws: boolean;
  // the ground
  ground: V3;
  bead: V3;
  beads: number;
  mycelium: number;
  wet: number;
  // the light
  light: V3;
  warmth: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const pick = <T>(r: Rand, a: T[]) => a[Math.floor(r() * a.length)];
const mixC = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const jitter = (r: Rand, c: V3, k: number): V3 => c.map((v) => Math.max(0, Math.min(1, v + (r() - 0.5) * k))) as V3;

/** A species from a seed (of a given kind, if asked: a terrarium asks for what it needs). */
export function species(seed: number, kind?: Form): Genome {
  const r = seeded(hash(seed, 0xf09));
  const roll = r();
  const form: Form = kind ?? (roll < 0.34 ? 'thrower' : roll < 0.48 ? 'pin' : roll < 0.76 ? 'inkcap' : 'cup');
  const a = r() * Math.PI * 2;
  const yellows: V3[] = [[1, 0.82, 0.12], [0.98, 0.7, 0.08], [0.93, 0.88, 0.25], [1, 0.62, 0.1], [0.9, 0.95, 0.35]];
  const caps: V3[] = [[0.03, 0.03, 0.035], [0.06, 0.07, 0.05], [0.12, 0.09, 0.06], [0.04, 0.05, 0.08]];
  const bells: V3[] = [[0.95, 0.9, 0.78], [0.93, 0.86, 0.72], [0.88, 0.84, 0.8], [0.96, 0.93, 0.86], [0.85, 0.72, 0.55]];
  const jellies: V3[] = [[0.72, 0.85, 0.2], [0.85, 0.82, 0.25], [0.6, 0.8, 0.3], [0.9, 0.7, 0.2], [0.55, 0.75, 0.45]];
  const grounds: V3[] = [[0.1, 0.08, 0.05], [0.13, 0.09, 0.05], [0.08, 0.08, 0.06], [0.15, 0.11, 0.07]];
  const throws = form === 'thrower';
  const stalky = form !== 'cup';
  const tall = form === 'inkcap' ? lerp(7, 20, r()) : form === 'cup' ? 1 : lerp(5, 13, r() * r());
  const g: Genome = {
    name: '',
    form,
    scale: form === 'cup' ? lerp(1.2, 2.2, r()) : tall,
    height: [tall * lerp(0.45, 0.8, r()), tall],
    radius: form === 'inkcap' ? lerp(0.12, 0.26, r()) : lerp(0.1, 0.2, r()),
    vesicle: throws ? lerp(0.45, 1, r()) : 0,
    vesicleLong: lerp(1.1, 1.9, r()),
    cap: throws ? lerp(0.32, 0.55, r()) : 0,
    capFlat: lerp(0.45, 0.8, r()),
    capColour: pick(r, caps),
    glass: [lerp(0.86, 0.96, r()), lerp(0.9, 0.97, r()), lerp(0.78, 0.92, r())],
    tip: pick(r, yellows),
    tipLength: throws ? lerp(0.05, 0.14, r()) : lerp(0.2, 0.6, r()),
    lean: form === 'inkcap' ? lerp(0.05, 0.5, r()) : lerp(0.15, 0.8, r()),
    wave: lerp(0, form === 'inkcap' ? 0.9 : 0.5, r() * r()),
    glassy: form === 'inkcap' ? lerp(0, 0.25, r()) : lerp(0.75, 1, r()),
    fuzz: form === 'inkcap' ? lerp(0.4, 1, r()) : lerp(0, 0.25, r()),
    bell: lerp(1.2, 3.4, r()),
    bellTall: lerp(0.9, 1.6, r()),
    pleats: Math.round(lerp(14, 34, r())),
    pleatDepth: lerp(0.02, 0.07, r()),
    bellColour: jitter(r, pick(r, bells), 0.06),
    bellTop: jitter(r, [0.72, 0.58, 0.4], 0.12),
    ink: lerp(0.2, 1, r()),
    jelly: jitter(r, pick(r, jellies), 0.08),
    jellyDeep: [lerp(0.7, 0.95, r()), lerp(0.45, 0.65, r()), lerp(0.08, 0.2, r())],
    cushion: lerp(0.5, 1.1, r()),
    asci: Math.round(lerp(8, 26, r())),
    spore: jitter(r, [0.1, 0.07, 0.09], 0.06),
    dew: lerp(0.2, 1, r()) * (form === 'inkcap' ? 0.4 : 1),
    dewSize: lerp(0.09, 0.22, r()) * (form === 'cup' ? 0.35 : 1),
    count: form === 'inkcap' ? Math.round(lerp(14, 45, r())) : form === 'cup' ? Math.round(lerp(3, 9, r())) : Math.round(lerp(40, 170, r())),
    patch: form === 'cup' ? lerp(4, 7, r()) : form === 'inkcap' ? lerp(20, 34, r()) : lerp(16, 26, r()),
    spread: lerp(1.5, 4, r()),
    throws,
    ground: jitter(r, pick(r, grounds), 0.03),
    bead: [lerp(0.55, 0.75, r()), lerp(0.3, 0.45, r()), lerp(0.08, 0.16, r())],
    beads: Math.round(lerp(stalky ? 30 : 10, stalky ? 200 : 60, r())),
    mycelium: form === 'inkcap' ? lerp(0.5, 1, r()) : lerp(0, 0.4, r()),
    wet: lerp(0.4, 1, r()),
    light: norm([Math.cos(a) * 0.8, 1, Math.sin(a) * 0.8]),
    warmth: r(),
    hairs: Math.round(lerp(28, 60, r())),
    hairLen: lerp(0.25, 0.7, r()),
    flask: lerp(0.12, 0.22, r()),
  };
  if (form === 'eyelash') {
    // a saucer, orange to scarlet inside, paler and browner out, its rim fringed with dark hairs
    const oranges: V3[] = [[0.95, 0.36, 0.06], [0.98, 0.5, 0.08], [0.88, 0.22, 0.07], [1, 0.58, 0.14]];
    g.bell = lerp(0.7, 1.8, r());
    g.bellTall = lerp(0.36, 0.55, r());
    g.bellColour = jitter(r, pick(r, oranges), 0.05);
    g.bellTop = mixC(g.bellColour, [0.55, 0.4, 0.28], 0.55);
    g.glass = jitter(r, [0.13, 0.08, 0.05], 0.04);
    g.tip = g.glass;
    g.tipLength = 0;
    g.glassy = 0;
    g.fuzz = 0;
    g.pleats = 0;
    g.pleatDepth = 0;
    g.height = [0.05, 0.05];
    g.scale = g.bell * 2.2;
    g.count = Math.round(lerp(5, 12, r()));
    g.patch = lerp(7, 11, r());
    g.spread = lerp(3, 8, r());
    g.dew = lerp(0, 0.3, r());
    g.mycelium = lerp(0.1, 0.4, r());
  } else if (form === 'flask') {
    // flasks: black, pear-shaped, half sunk, their necks to the light; their spores shot out of them
    g.height = [lerp(0.2, 0.35, r()), lerp(0.4, 0.75, r())];
    g.radius = lerp(0.035, 0.06, r());
    g.lean = lerp(0.25, 0.7, r());
    g.wave = lerp(0, 0.2, r());
    g.glass = jitter(r, [0.06, 0.055, 0.05], 0.02);
    g.tip = [0.14, 0.12, 0.1];
    g.tipLength = 0.12;
    g.glassy = 0;
    g.fuzz = lerp(0.2, 0.6, r());
    g.capColour = g.glass;
    g.spore = jitter(r, [0.06, 0.05, 0.05], 0.02);
    g.scale = 1.6;
    g.count = Math.round(lerp(30, 90, r()));
    g.patch = lerp(4, 7, r());
    g.spread = lerp(2, 6, r());
    g.dew = lerp(0, 0.4, r());
  }
  g.name = binomial(seed, g);
  return g;
}

function binomial(seed: number, g: Genome): string {
  const r = seeded(hash(seed, 0xb07));
  const on = ['p', 'm', 'c', 'th', 'r', 'ph', 'b', 'l', 'g', 'sp', 'st', 'n', 'v'];
  const vo = ['i', 'o', 'u', 'a', 'y', 'e'];
  const ends: Record<Form, string[]> = {
    thrower: ['bolus', 'bolus', 'phorus', 'jacula'],
    pin: ['mucor', 'cella', 'myces', 'phora'],
    inkcap: ['inellus', 'inopsis', 'athyrella', 'ocybe'],
    cup: ['obolus', 'opeziza', 'odesmis', 'ascus'],
    eyelash: ['ymenia', 'utellinia', 'opeziza'],
    flask: ['daria', 'ospora', 'iella'],
  };
  const syl = () => pick(r, on) + pick(r, vo);
  let genus = syl() + syl() + pick(r, ends[g.form]);
  genus = genus[0].toUpperCase() + genus.slice(1);
  const epithets: Record<Form, string> = {
    thrower: g.vesicle > 0.85 ? 'crystallinus' : g.dew > 0.7 ? 'roridus' : g.height[1] > 10 ? 'longipes' : 'kleinii',
    pin: g.tipLength > 0.4 ? 'flavicapitatus' : g.wave > 0.3 ? 'flexuosus' : 'erectus',
    inkcap: g.pleats > 26 ? 'plicatilis' : g.ink > 0.7 ? 'atramentarius' : g.fuzz > 0.7 ? 'velutinus' : g.bellTall > 1.35 ? 'elongatus' : 'disseminatus',
    cup: g.asci > 20 ? 'immersus' : g.cushion > 0.9 ? 'magnus' : 'furfuraceus',
    eyelash: g.hairLen > 0.55 ? 'ciliata' : g.bell > 1.4 ? 'stercorea' : 'fimicola',
    flask: g.height[1] > 0.6 ? 'curvula' : g.fuzz > 0.45 ? 'anserina' : 'fimicola',
  };
  return `${genus} ${epithets[g.form]}`;
}

/** A stalk in the patch (a thrower's, a pin's or an inkcap's). */
export interface Stalk {
  base: V3;
  len: number;
  r: number;
  ves: number;
  long: number;
  knob: number;
  cap: number;
  /** an inkcap's bell: radius (mm), its height to its radius */
  bell: number;
  bellTall: number;
  dir: [number, number];
  lean: number;
  wave: number;
  phase: number;
  t0: number;
  t1: number;
  tv: number;
  tl: number;
  /** when it's gone: collapsed, rotted, eaten (a terrarium's things don't stay) */
  tEnd: number;
  dew: Array<{ s: number; a: number; r: number; t: number }>;
  fly: V3;
}

/** A cup: a cushion of jelly, and its asci. */
export interface Cushion {
  c: V3;
  /** its radius, its height (mm), its lumpiness' seed */
  R: number;
  Hc: number;
  seed: number;
  t0: number;
  tEnd: number;
  asci: Ascus[];
  /** water beading on it */
  dew: Array<{ th: number; ph: number; r: number; t: number }>;
}
export interface Ascus {
  /** where on the cushion: round (rad), and down from the top (0 top … 1 the shoulder) */
  th: number;
  ph: number;
  len: number;
  r: number;
  t0: number;
  tr: number;
  tl: number;
}

/** The day: how long it runs (h). */
export const DAY = 16;

export function patch(seed: number, g: Genome): Stalk[] {
  if (g.form === 'cup') return [];
  const r = seeded(hash(seed, 0x9a7));
  const out: Stalk[] = [];
  const ink = g.form === 'inkcap';
  for (let i = 0; i < g.count; i++) {
    // (in clumps, as on a real pellet of dung or a crumb of wood)
    const clump = Math.floor(r() * (ink ? 3 : 5));
    const cr = seeded(hash(seed, 0xc1, clump));
    const cx = (cr() - 0.5) * g.patch * 0.8;
    const cz = (cr() - 0.5) * g.patch * 0.8;
    const d = Math.sqrt(r()) * g.patch * (ink ? 0.28 : 0.35);
    const th = r() * Math.PI * 2;
    const st = makeStalk(r, g, [cx + Math.cos(th) * d, 0, cz + Math.sin(th) * d], 0);
    st.tEnd = 1e9;
    out.push(st);
  }
  return out;
}

/** One stalk of this species, standing at `base`, its day starting at hour `start`. */
export function makeStalk(r: Rand, g: Genome, base: V3, start: number): Stalk {
  const toward = Math.atan2(g.light[2], g.light[0]);
  const ink = g.form === 'inkcap';
  const lash = g.form === 'eyelash';
  const flask = g.form === 'flask';
  const len = lerp(g.height[0], g.height[1], r());
  const t0 = start + r() * g.spread * (ink ? 1.6 : 1);
  const grow = ink ? lerp(5, 8, r()) : lash ? lerp(8, 14, r()) : flask ? lerp(6, 10, r()) : lerp(3, 4.5, r());
  const t1 = t0 + grow;
  const tv = t1 + lerp(0.5, 1.5, r());
  const tl = g.throws ? tv + lerp(2.5, 4, r()) + r() * g.spread * 0.6 : 1e9;
  // (thrown, it lies a few hours, then it's gone; a pin mould's lasts a day or so; an inkcap
  // inks and dissolves the same day)
  // (an eyelash cup and the flasks last days)
  const tEnd = g.throws ? tl + lerp(5, 9, r()) : ink ? t1 + lerp(16, 26, r()) : lash ? t1 + lerp(50, 90, r()) : flask ? t1 + lerp(60, 110, r()) : t1 + lerp(20, 30, r());
  const aim = ink || lash ? r() * Math.PI * 2 : toward + (r() - 0.5) * 0.9;
  const dew: Stalk['dew'] = [];
  const n = Math.round(g.dew * len * (ink ? 1.2 : 4) * lerp(0.5, 1.5, r()));
  for (let k = 0; k < n; k++) {
    const s = 0.04 + r() * 0.9;
    dew.push({ s, a: r() * Math.PI * 2, r: g.dewSize * lerp(0.25, 1, r() * r()), t: t0 + grow * s + lerp(0.2, 3, r()) });
  }
  if (g.throws) for (let k = 0; k < Math.round(g.dew * 10); k++) {
    dew.push({ s: 0.9 + r() * 0.1, a: r() * Math.PI * 2, r: g.dewSize * lerp(0.3, 1.1, r()), t: tv + r() * 1.5 });
  }
  const up = lerp(0.8, 1.6, r());
  const sr = g.radius * lerp(0.75, 1.25, r());
  // (a vesicle is always a balloon on its stalk: never thinner than twice it)
  const ves = g.throws ? Math.max(g.vesicle * lerp(0.45, 0.75, r()) * (0.6 + len / 20), sr * 2.2) : 0;
  return {
    base,
    len,
    r: sr,
    ves,
    long: g.vesicleLong,
    knob: g.form === 'pin' ? 1 : 0,
    cap: g.cap * lerp(0.85, 1.15, r()),
    bell: ink ? g.bell * lerp(0.55, 1.2, r()) * (0.6 + (len / g.height[1]) * 0.5) : lash ? g.bell * lerp(0.6, 1.25, r()) : 0,
    bellTall: g.bellTall * lerp(0.85, 1.15, r()),
    dir: [Math.cos(aim), Math.sin(aim)],
    lean: lash ? lerp(0, 0.2, r()) : g.lean * lerp(0.3, 1.3, r()),
    wave: g.wave * lerp(0.5, 1.5, r()),
    phase: r() * 10,
    t0,
    t1,
    tv,
    tl,
    tEnd,
    dew,
    fly: norm([Math.cos(aim) * 0.7, up, Math.sin(aim) * 0.7]),
  };
}

/** The cups' cushions (only a cup has them). */
export function cushions(seed: number, g: Genome): Cushion[] {
  if (g.form !== 'cup') return [];
  const r = seeded(hash(seed, 0xc05));
  const out: Cushion[] = [];
  for (let i = 0; i < g.count; i++) {
    let c: V3 = [0, 0, 0];
    // (not on top of one another)
    for (let k = 0; k < 20; k++) {
      const d = Math.sqrt(r()) * g.patch * 0.45;
      const a = r() * Math.PI * 2;
      c = [Math.cos(a) * d, 0, Math.sin(a) * d];
      if (out.every((o) => Math.hypot(o.c[0] - c[0], o.c[2] - c[2]) > (o.R + g.cushion) * 0.9)) break;
    }
    const cu = makeCushion(r, g, c, r() * g.spread, 14);
    cu.tEnd = 1e9;
    out.push(cu);
  }
  return out;
}

/** One cushion of this species at `c`, swelling from hour `t0`, firing asci for `life` hours. */
export function makeCushion(r: Rand, g: Genome, c: V3, t0: number, life: number): Cushion {
  const R = g.cushion * lerp(0.6, 1.25, r());
  const Hc = R * lerp(1.4, 2.3, r());
  const asci: Ascus[] = [];
  const n = Math.round(g.asci * lerp(0.6, 1.3, r()) * (R / g.cushion) * Math.max(1, life / 14));
  for (let k = 0; k < n; k++) {
    // asci come up in waves through its life, each ripening, then firing
    const at = t0 + lerp(2, Math.max(4, life - 3), r());
    asci.push({ th: r() * Math.PI * 2, ph: Math.pow(r(), 1.3) * 0.38, len: R * lerp(0.14, 0.3, r()), r: R * lerp(0.05, 0.075, r()), t0: at, tr: at + lerp(1, 2.5, r()), tl: at + lerp(2.6, 4.5, r()) });
  }
  const dew: Cushion['dew'] = [];
  for (let k = 0; k < Math.round(g.dew * 30 * R); k++) dew.push({ th: r() * Math.PI * 2, ph: r() * 0.95, r: g.dewSize * lerp(0.4, 1.6, r() * r()) * R, t: t0 + r() * 6 });
  return { c, R, Hc, seed: r() * 100, t0, tEnd: t0 + life + 8, asci, dew };
}

/** The ground's bits: orange beads, crumbs, and water standing on it. */
export function litter(seed: number, g: Genome): { beads: Array<{ p: V3; r: number; flat: number }>; crumbs: Array<{ p: V3; r: V3; c: V3 }>; pools: Array<{ p: V3; r: number }> } {
  const r = seeded(hash(seed, 0xbe4));
  const k = g.scale / 8;
  const beads: Array<{ p: V3; r: number; flat: number }> = [];
  for (let i = 0; i < g.beads; i++) {
    const d = Math.sqrt(r()) * g.patch * 1.4;
    const a = r() * Math.PI * 2;
    const rad = lerp(0.25, 0.9, r() * r()) * Math.min(1, k * 1.5);
    beads.push({ p: [Math.cos(a) * d, rad * 0.25, Math.sin(a) * d], r: rad, flat: lerp(0.45, 0.7, r()) });
  }
  const crumbs: Array<{ p: V3; r: V3; c: V3 }> = [];
  for (let i = 0; i < 500; i++) {
    const d = Math.sqrt(r()) * g.patch * 1.6;
    const a = r() * Math.PI * 2;
    const s = lerp(0.04, 0.35, r() * r() * r()) * Math.max(0.3, k);
    const c: V3 = r() < 0.15 ? [0.5, 0.42, 0.3] : r() < 0.5 ? [0.05, 0.04, 0.03] : [0.2, 0.14, 0.09];
    const m = lerp(0.7, 1.3, r());
    crumbs.push({ p: [Math.cos(a) * d, s * 0.2, Math.sin(a) * d], r: [s, s * lerp(0.4, 0.9, r()), s * lerp(0.6, 1.4, r())], c: [c[0] * m, c[1] * m, c[2] * m] });
  }
  const pools: Array<{ p: V3; r: number }> = [];
  for (let i = 0; i < Math.round(160 * g.wet); i++) {
    const d = Math.sqrt(r()) * g.patch * 1.3;
    const a = r() * Math.PI * 2;
    pools.push({ p: [Math.cos(a) * d, 0, Math.sin(a) * d], r: lerp(0.03, 0.3, r() * r()) * Math.max(0.3, k) });
  }
  return { beads, crumbs, pools };
}

export interface State {
  grown: number;
  swell: number;
  ripe: number;
  thrown: number;
  slump: number;
  /** an inkcap's: how open its bell, how inked its margin */
  open: number;
  inked: number;
}
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export function state(st: Stalk, T: number): State {
  const grown = ease((T - st.t0) / (st.t1 - st.t0));
  const swell = st.ves > 0 ? ease((T - st.tv) / 1.6) : 0;
  const ripe = ease((T - st.tv + 0.3) / 2.2);
  const thrown = T >= st.tl ? T - st.tl : -1;
  const slump = thrown >= 0 ? ease(thrown / 2.5) : 0;
  const open = ease((T - st.t0 - (st.t1 - st.t0) * 0.5) / ((st.t1 - st.t0) * 2.2));
  const inked = st.knob || st.cap ? 0 : ease((T - st.t1 - 3) / 5);
  // its end: it slumps over the last hours, and in the last hour sinks away
  const end = ease((T - (st.tEnd - 6)) / 6);
  const gone = ease((T - (st.tEnd - 1)) / 1);
  return { grown: grown * (1 - gone), swell, ripe, thrown, slump: Math.max(slump, end), open, inked: Math.max(inked, st.bell ? end : 0) };
}
/** An ascus at hour T: how far up through the skin, how ripe its spores, when it fired. */
export function ascusState(a: Ascus, T: number): { up: number; ripe: number; fired: number } {
  return { up: ease((T - a.t0) / 1.2), ripe: ease((T - a.t0) / (a.tr - a.t0)), fired: T >= a.tl ? T - a.tl : -1 };
}
/** The cushion's swell at hour T. */
export function cushionGrown(c: Cushion, T: number) {
  // (it swells over hours; at its end it shrivels, then it's gone)
  return (0.25 + 0.75 * ease((T - c.t0) / 3)) * (1 - 0.6 * ease((T - (c.tEnd - 8)) / 8)) * (1 - ease((T - (c.tEnd - 0.5)) / 0.5));
}
/** A point on a cushion's skin: round th, down ph (0 top … 1 the foot), and its outward normal.
 * (The same shape as the jelly's vertex shader, before its lumps.) */
export function onCushion(c: Cushion, grown: number, th: number, ph: number): { p: V3; n: V3 } {
  // a cushion: domed, widest halfway up, its foot tucked under and sunk a little in the dung
  const a = ph * Math.PI * 0.75;
  const R = c.R * grown;
  const H = c.Hc * grown;
  const x = Math.sin(a) * R;
  const y = c.c[1] + (0.5 + 0.5 * Math.cos(a)) * H;
  return { p: [c.c[0] + Math.cos(th) * x, y, c.c[2] + Math.sin(th) * x], n: norm([Math.cos(th) * Math.sin(a) * 0.5 * H, Math.cos(a) * R + 1e-4, Math.sin(th) * Math.sin(a) * 0.5 * H]) };
}

/** The stalk's centreline and its radius, at s (0 foot … 1 top). The same sums are in the vertex
 * shader. */
export function along(st: Stalk, s: State, u: number): { p: V3; t: V3; r: number } {
  const L = st.len * s.grown;
  const lean = st.lean + s.slump * 1.6;
  const sag = s.slump * 0.9;
  const side = [-st.dir[1], st.dir[0]];
  const w = st.wave * Math.sin(u * 3 + st.phase) * u;
  const p: V3 = [
    st.base[0] + (st.dir[0] * lean * 0.5 * u * u + side[0] * w * 0.12) * L,
    st.base[1] + (u - sag * u * u) * L,
    st.base[2] + (st.dir[1] * lean * 0.5 * u * u + side[1] * w * 0.12) * L,
  ];
  const t = norm([st.dir[0] * lean * u, 1 - 2 * sag * u, st.dir[1] * lean * u]);
  return { p, t, r: radius(st, s, u) };
}
export function radius(st: Stalk, s: State, u: number): number {
  const L = Math.max(st.len * s.grown, 1e-3);
  let r = st.r * (1 + 0.6 * Math.exp(-u * 25)) * (1 - 0.25 * u);
  const v = st.ves * s.swell * (1 - s.slump * 0.85);
  if (v > 0) {
    const half = Math.min(0.45, (v * st.long) / L);
    const x = (u - (1 - half)) / half;
    if (x > -1) r = Math.max(r, v * Math.sqrt(Math.max(0, 1 - x * x)));
  }
  if (st.knob > 0) {
    const k = st.r * 2.1 * Math.min(1, s.grown * 1.5);
    const half = Math.min(0.3, k / L);
    const x = (u - (1 - half)) / half;
    if (x > -1) r = Math.max(r, k * Math.sqrt(Math.max(0, 1 - x * x)));
  }
  return r;
}

export function norm(a: V3): V3 {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

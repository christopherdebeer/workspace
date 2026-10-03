/**
 * Hat-throwers: a species of pin mould from a seed, a patch of it, and its day — the rules,
 * apart from the drawing.
 *
 * Pilobolus and its kin fruit on dung overnight. A sporangiophore pushes up, clear as glass and
 * yellow at the top, beading with water it sweats out. Under its tip a vesicle swells — a balloon
 * that is also a lens, turning the stalk toward the light — and the black sporangium on top
 * darkens. By late morning the pressure in the vesicle is enormous, and it bursts: the sporangium
 * is shot off toward the light, metres away, and the stalk slumps. Some kin never throw: no
 * vesicle, just a yellow knob on a stalk.
 *
 * Units are millimetres and hours. Everything comes from the seed: the species (its genome), the
 * patch (where each stalk stands, when it starts, how it leans) and every droplet.
 */
import { hash, seeded, type Rand } from '../kit/rng';

export type V3 = [number, number, number];

export interface Genome {
  name: string;
  /** how far the vesicle swells (0: none — a knob, a pin mould that doesn't throw) */
  vesicle: number;
  /** its length to its width */
  vesicleLong: number;
  /** stalk heights (mm) */
  height: [number, number];
  /** stalk radius at its foot (mm) */
  radius: number;
  /** the sporangium: radius (mm), how flat, its colour */
  cap: number;
  capFlat: number;
  capColour: V3;
  /** the stalk's glass (a tint) and its tip's yellow */
  glass: V3;
  tip: V3;
  /** how much of the top is yellow, as a share of the stalk */
  tipLength: number;
  /** how hard it leans toward the light; how much it wanders */
  lean: number;
  wave: number;
  /** water beading on the stalks: how much, how big (mm) */
  dew: number;
  dewSize: number;
  /** how many stalks in the patch; how wide the patch (mm) */
  count: number;
  patch: number;
  /** how spread out in time they are (h) */
  spread: number;
  /** whether it throws (and so whether the vesicle forms) */
  throws: boolean;
  /** the dung: its dark, its beads' orange, how many beads */
  ground: V3;
  bead: V3;
  beads: number;
  /** the light: where it is (toward it, unit), how warm */
  light: V3;
  warmth: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const pick = <T>(r: Rand, a: T[]) => a[Math.floor(r() * a.length)];

export function species(seed: number): Genome {
  const r = seeded(hash(seed, 0xf09));
  const throws = r() < 0.72;
  const vesicle = throws ? lerp(0.45, 1, r()) : 0;
  const tall = lerp(5, 13, r() * r());
  const yellows: V3[] = [[1, 0.82, 0.12], [0.98, 0.7, 0.08], [0.93, 0.88, 0.25], [1, 0.62, 0.1]];
  const caps: V3[] = [[0.03, 0.03, 0.035], [0.06, 0.07, 0.05], [0.12, 0.09, 0.06], [0.04, 0.05, 0.08]];
  const a = r() * Math.PI * 2;
  const g: Genome = {
    name: '',
    vesicle,
    vesicleLong: lerp(1.1, 1.9, r()),
    height: [tall * lerp(0.55, 0.8, r()), tall],
    radius: lerp(0.1, 0.2, r()),
    cap: throws ? lerp(0.32, 0.55, r()) : 0,
    capFlat: lerp(0.45, 0.8, r()),
    capColour: pick(r, caps),
    glass: [lerp(0.86, 0.95, r()), lerp(0.9, 0.97, r()), lerp(0.78, 0.92, r())],
    tip: pick(r, yellows),
    tipLength: throws ? lerp(0.05, 0.14, r()) : lerp(0.25, 0.6, r()),
    lean: lerp(0.15, 0.8, r()),
    wave: lerp(0, 0.5, r() * r()),
    dew: lerp(0.25, 1, r()),
    dewSize: lerp(0.09, 0.22, r()),
    count: Math.round(lerp(40, 170, r())),
    patch: lerp(16, 26, r()),
    spread: lerp(1.5, 4, r()),
    throws,
    ground: [lerp(0.07, 0.14, r()), lerp(0.07, 0.12, r()), lerp(0.04, 0.07, r())],
    bead: [lerp(0.55, 0.75, r()), lerp(0.3, 0.45, r()), lerp(0.08, 0.16, r())],
    beads: Math.round(lerp(40, 220, r())),
    light: norm([Math.cos(a) * 0.8, 1, Math.sin(a) * 0.8]),
    warmth: r(),
  };
  g.name = binomial(seed, g);
  return g;
}

function binomial(seed: number, g: Genome): string {
  const r = seeded(hash(seed, 0xb07));
  const on = ['p', 'm', 'c', 'th', 'r', 'ph', 'b', 'l', 'g', 'sp', 'st'];
  const vo = ['i', 'o', 'u', 'a', 'y', 'e'];
  const end = g.throws ? ['bolus', 'bolus', 'phorus', 'myces', 'jacula'] : ['mucor', 'cella', 'myces', 'phora'];
  const syl = () => pick(r, on) + pick(r, vo);
  let genus = syl() + syl() + pick(r, end);
  genus = genus[0].toUpperCase() + genus.slice(1);
  const epithet = g.throws
    ? g.vesicle > 0.85 ? 'crystallinus' : g.dew > 0.7 ? 'roridus' : g.height[1] > 10 ? 'longipes' : 'kleinii'
    : g.tipLength > 0.4 ? 'flavicapitatus' : g.wave > 0.3 ? 'flexuosus' : 'erectus';
  return `${genus} ${epithet}`;
}

/** A stalk in the patch. */
export interface Stalk {
  base: V3;
  /** full length (mm), radius at the foot (mm) */
  len: number;
  r: number;
  /** its vesicle's radius at full swell, and its cap's */
  ves: number;
  /** the vesicle's length to its width; a knob instead (a pin mould that doesn't throw) */
  long: number;
  knob: number;
  cap: number;
  /** which way it leans (toward the light, give or take), how much */
  dir: [number, number];
  lean: number;
  wave: number;
  phase: number;
  /** its day: emerges, finishes growing, swells, throws (h) */
  t0: number;
  t1: number;
  tv: number;
  tl: number;
  /** droplets: where along it (0..1), round it (rad), how big (mm), when they bead (h) */
  dew: Array<{ s: number; a: number; r: number; t: number }>;
  /** the way its cap flies */
  fly: V3;
}

/** The day: how long it runs (h). */
export const DAY = 16;

export function patch(seed: number, g: Genome): Stalk[] {
  const r = seeded(hash(seed, 0x9a7));
  const out: Stalk[] = [];
  const toward = Math.atan2(g.light[2], g.light[0]);
  for (let i = 0; i < g.count; i++) {
    // (in clumps, as on a real pellet of dung)
    const clump = Math.floor(r() * 5);
    const cr = seeded(hash(seed, 0xc1, clump));
    const cx = (cr() - 0.5) * g.patch * 0.9;
    const cz = (cr() - 0.5) * g.patch * 0.9;
    const d = Math.sqrt(r()) * g.patch * 0.35;
    const th = r() * Math.PI * 2;
    const base: V3 = [cx + Math.cos(th) * d, 0, cz + Math.sin(th) * d];
    const len = lerp(g.height[0], g.height[1], r());
    const t0 = r() * g.spread;
    const grow = lerp(3, 4.5, r());
    const t1 = t0 + grow;
    const tv = t1 + lerp(0.5, 1.5, r());
    const tl = g.throws ? tv + lerp(2.5, 4, r()) + r() * g.spread * 0.6 : 1e9;
    const aim = toward + (r() - 0.5) * 0.9;
    const dew: Stalk['dew'] = [];
    const n = Math.round(g.dew * len * 4 * lerp(0.5, 1.5, r()));
    for (let k = 0; k < n; k++) {
      const s = 0.04 + r() * 0.9;
      dew.push({ s, a: r() * Math.PI * 2, r: g.dewSize * lerp(0.25, 1, r() * r()), t: t0 + grow * s + lerp(0.2, 3, r()) });
    }
    // (beads on the vesicle too: the ones that glitter round its top)
    if (g.throws) for (let k = 0; k < Math.round(g.dew * 10); k++) {
      dew.push({ s: 0.9 + r() * 0.1, a: r() * Math.PI * 2, r: g.dewSize * lerp(0.3, 1.1, r()), t: tv + r() * 1.5 });
    }
    const up = lerp(0.8, 1.6, r());
    out.push({
      base,
      len,
      r: g.radius * lerp(0.8, 1.2, r()),
      ves: g.vesicle * lerp(0.45, 0.75, r()) * (0.6 + len / 20),
      long: g.vesicleLong,
      knob: g.throws ? 0 : 1,
      cap: g.cap * lerp(0.85, 1.15, r()),
      dir: [Math.cos(aim), Math.sin(aim)],
      lean: g.lean * lerp(0.4, 1.2, r()),
      wave: g.wave * lerp(0.5, 1.5, r()),
      phase: r() * 10,
      t0,
      t1,
      tv,
      tl,
      dew,
      fly: norm([Math.cos(aim) * 0.7, up, Math.sin(aim) * 0.7]),
    });
  }
  return out;
}

/** The orange beads lying in the wet: where, how big, how squashed. */
export function beads(seed: number, g: Genome): Array<{ p: V3; r: number; flat: number }> {
  const r = seeded(hash(seed, 0xbe4));
  const out: Array<{ p: V3; r: number; flat: number }> = [];
  for (let i = 0; i < g.beads; i++) {
    const d = Math.sqrt(r()) * g.patch * 1.4;
    const a = r() * Math.PI * 2;
    const rad = lerp(0.25, 0.9, r() * r());
    out.push({ p: [Math.cos(a) * d, rad * 0.25, Math.sin(a) * d], r: rad, flat: lerp(0.45, 0.7, r()) });
  }
  return out;
}

/** A stalk at hour T: how grown, how swollen, how dark its cap, whether thrown, how slumped. */
export interface State {
  grown: number;
  swell: number;
  ripe: number;
  thrown: number;
  slump: number;
}
export function state(st: Stalk, T: number): State {
  const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const grown = ease((T - st.t0) / (st.t1 - st.t0));
  const swell = st.ves > 0 ? ease((T - st.tv) / 1.6) : 0;
  const ripe = ease((T - st.tv + 0.3) / 2.2);
  const thrown = T >= st.tl ? T - st.tl : -1;
  const slump = thrown >= 0 ? ease(thrown / 2.5) : 0;
  return { grown, swell, ripe, thrown, slump };
}

/** The stalk's centreline and its radius, at s (0 foot … 1 top), given its state. The same sums
 * are in the vertex shader. */
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
    // the vesicle: an ellipsoid, its top where the stalk ends
    const half = Math.min(0.45, (v * st.long) / L);
    const x = (u - (1 - half)) / half;
    if (x > -1) r = Math.max(r, v * Math.sqrt(Math.max(0, 1 - x * x)));
  }
  if (st.knob > 0) {
    // or a knob: a small round head
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

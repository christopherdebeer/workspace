/**
 * Who runs: a character, as a body and what it wears. The body comes from a few continuous proportions (how tall, how
 * old, how broad, the shoulders and the hips, the legs against the trunk), each segment's length and each block's width
 * worked out from them with the usual anthropometric ratios (Drillis and Contini's segment fractions of stature, a
 * child's larger head and shorter legs), and with them what the body can do because of its size: how far its legs
 * reach, where its hips ride, how far it hangs below a hand and reaches above its feet, how long a stride it takes
 * (and so how quickly it steps: a shorter leg steps faster at a pace). How capable it is (how high it jumps, how hard it
 * pushes) is the athlete's, not the body's, and stays the dials'.
 *
 * What it wears: a palette by material (skin, hair, a top, bottoms, shoes, two accents), which material each bone is,
 * and attachments: blocks fixed to a bone (a hood, a bag, a cap, a ponytail, a scarf's end), each its own material. A
 * look dresses the figure by material from the character's palette (looks.ts: uFigure), never knowing who it is.
 *
 * The default ('runner') is the body the rig has always had: everything that isn't asked for a character gets it.
 */

/** materials a figure is made of, by index into its palette */
export const MAT = { skin: 0, hair: 1, top: 2, bottoms: 3, shoes: 4, accent: 5, accent2: 6, trim: 7 } as const;
export type Mat = (typeof MAT)[keyof typeof MAT];

/** a block on a bone: in the bone's own space, from y0 (w0 × d0) to y1 (w1 × d1), centred at (x, z) */
export interface Block { y0: number; w0: number; d0: number; y1: number; w1: number; d1: number; x?: number; zc?: number }
/** something worn, fixed to a bone: where on it (its own space), the block, its material; `tilt` turns it about x (rad) */
export interface Attachment { bone: string; at: [number, number, number]; block: Block; mat: Mat; tilt?: number;
  /** it moves (rig.ts): it swings toward a pull made of where it rests on the bone (`rest`), gravity (`fall`) and the wind of
   * its own motion (`drag`), as a damped spring (`stiff`, `damp`), never more than `max` (rad) from its rest; and `flare`,
   * a skirt's: belled out by the air as it falls, and by a landing */
  hang?: { rest: number; fall: number; drag: number; stiff: number; damp: number; max?: number; flare?: number } }

/** the proportions a character is asked as: each continuous, 0 the runner's own where it has one */
export interface Proportions {
  /** standing height, m */
  stature: number;
  /** years: under eighteen, a child's proportions in proportion (a larger head, shorter legs, slighter); over fifty, a
   * little stoop */
  age: number;
  /** slight (−1) to broad (1): every width */
  build: number;
  /** narrower (−1) to wider (1) shoulders, and hips, apart from the build */
  shoulders: number; hips: number;
  /** shorter (−1) to longer (1) legs against the trunk */
  legs: number;
}

/** the body the rig draws and the runner moves, worked out from the proportions */
export interface Body {
  thigh: number; shin: number; sole: number; hipDrop: number; upper: number; fore: number;
  /** the pelvis to the chest's base; the chest's length; the neck (chest base to the head's); the shoulders (half apart, and
   * up the chest); the hip joints (half apart) */
  spine: number; chest: number; neck: number; shoulderX: number; shoulderY: number; hipX: number;
  /** the foot's ball, along it from the ankle */
  ball: number;
  blocks: { pelvis: Block; torso: Block; head: Block; upperArm: Block; foreArm: Block; thigh: Block; shin: Block; foot: Block };
  /** a lean carried all the time (an older body's stoop), rad */
  stoop: number;
  /** what follows from size, as a share of the runner's: the legs' reach (and where the hips ride), the arms' (reach above
   * the feet, and the hang below a hand), the stride's length */
  legScale: number; reachScale: number; strideScale: number;
}

export interface Character {
  name: string; title: string;
  proportions: Proportions;
  /** colours by material (MAT), linear 0..1 */
  palette: [number, number, number][];
  /** which material each bone kind is */
  dress: Record<'pelvis' | 'torso' | 'head' | 'upperArm' | 'foreArm' | 'thigh' | 'shin' | 'foot', Mat>;
  wears: Attachment[];
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** the runner's own body: what every proportion is measured from (1.82 m, an adult, average build) */
const BASE = {
  thigh: 0.44, shin: 0.44, sole: 0.07, hipDrop: 0.06, upper: 0.29, fore: 0.31, spine: 0.1, chest: 0.47, neck: 0.5, shoulderX: 0.225, shoulderY: 0.43, hipX: 0.095, ball: 0.13,
  blocks: {
    pelvis: { y0: -0.09, w0: 0.26, d0: 0.17, y1: 0.1, w1: 0.3, d1: 0.18 },
    torso: { y0: 0, w0: 0.27, d0: 0.16, y1: 0.47, w1: 0.37, d1: 0.21 },
    head: { y0: 0, w0: 0.16, d0: 0.18, y1: 0.23, w1: 0.18, d1: 0.2, zc: 0.015 },
    upperArm: { y0: 0, w0: 0.09, d0: 0.09, y1: -0.29, w1: 0.075, d1: 0.075 },
    foreArm: { y0: 0, w0: 0.075, d0: 0.075, y1: -0.31, w1: 0.055, d1: 0.06 },
    thigh: { y0: 0, w0: 0.135, d0: 0.14, y1: -0.44, w1: 0.1, d1: 0.105 },
    shin: { y0: 0, w0: 0.095, d0: 0.1, y1: -0.44, w1: 0.07, d1: 0.075 },
    foot: { y0: -0.07, w0: 0.085, d0: 0.25, y1: 0, w1: 0.08, d1: 0.2, zc: 0.06 },
  },
  stature: 1.82,
};

/** a body from proportions: the runner's scaled to the stature, then reshaped by age, build, shoulders, hips and legs */
export function bodyOf(p: Proportions): Body {
  const s = p.stature / BASE.stature;
  // (a child: 0 at six, 1 grown at eighteen; the head a larger share, the legs a smaller, slighter all over)
  const grown = clamp((p.age - 6) / 12, 0, 1), young = 1 - grown;
  const head = 1 + 0.42 * young, legs = (1 - 0.1 * young) * (1 + 0.07 * p.legs), trunk = (1 + 0.04 * young) * (1 - 0.07 * p.legs);
  const wide = (1 + 0.16 * p.build) * (1 - 0.12 * young), shoulders = wide * (1 + 0.14 * p.shoulders), hips = wide * (1 + 0.14 * p.hips);
  // (the head grown into the stature: whatever it takes from the height, the legs and trunk give back, in proportion)
  const headLen = BASE.blocks.head.y1 * head, give = (BASE.stature - (BASE.blocks.head.y1 * head - BASE.blocks.head.y1) / s) / BASE.stature;
  const L = (x: number, f: number) => x * s * f * give;
  const blk = (b: Block, len: number, wx: number, wd = wx): Block => ({ ...b, y0: b.y0 * len, y1: b.y1 * len, w0: b.w0 * s * wx, w1: b.w1 * s * wx, d0: b.d0 * s * wd, d1: b.d1 * s * wd, zc: (b.zc ?? 0) * s });
  const thigh = L(BASE.thigh, legs), shin = L(BASE.shin, legs), upper = L(BASE.upper, trunk), fore = L(BASE.fore, trunk), chest = L(BASE.chest, trunk);
  const ls = (thigh + shin) / (BASE.thigh + BASE.shin), ts = chest / BASE.chest;
  const body: Body = {
    thigh, shin, sole: BASE.sole * s, hipDrop: BASE.hipDrop * s, upper, fore,
    spine: L(BASE.spine, trunk), chest, neck: L(BASE.neck, trunk), shoulderX: BASE.shoulderX * s * shoulders, shoulderY: BASE.shoulderY * s * ts, hipX: BASE.hipX * s * hips, ball: BASE.ball * s,
    blocks: {
      pelvis: blk(BASE.blocks.pelvis, s * ts, hips),
      torso: { ...blk(BASE.blocks.torso, s * ts, wide), w1: BASE.blocks.torso.w1 * s * shoulders, w0: BASE.blocks.torso.w0 * s * hips },
      head: { ...blk(BASE.blocks.head, 1, head * (1 - 0.1 * young)), y1: headLen * s, w0: BASE.blocks.head.w0 * s * head, w1: BASE.blocks.head.w1 * s * head, d0: BASE.blocks.head.d0 * s * head, d1: BASE.blocks.head.d1 * s * head },
      upperArm: blk(BASE.blocks.upperArm, upper / BASE.upper, wide), foreArm: blk(BASE.blocks.foreArm, fore / BASE.fore, wide),
      thigh: blk(BASE.blocks.thigh, thigh / BASE.thigh, wide), shin: blk(BASE.blocks.shin, shin / BASE.shin, wide), foot: blk(BASE.blocks.foot, s, 1 - 0.05 * young),
    },
    stoop: p.age > 50 ? Math.min(0.14, (p.age - 50) * 0.006) : 0,
    legScale: ls, reachScale: 1, strideScale: ls,
  };
  // (the reach above the feet: the hips, the trunk to the shoulders, the arm, as a share of the runner's)
  const reach = (b: { thigh: number; shin: number; hipDrop: number; sole: number; spine: number; shoulderY: number; upper: number; fore: number }) => b.thigh + b.shin + b.hipDrop + b.sole + b.spine + b.shoulderY + b.upper + b.fore;
  body.reachScale = reach(body) / reach(BASE);
  return body;
}

const DARK: [number, number, number][] = [[0.78, 0.6, 0.48], [0.11, 0.1, 0.1], [0.21, 0.21, 0.28], [0.13, 0.14, 0.2], [0.87, 0.84, 0.77], [0.5, 0.3, 0.24], [0.34, 0.38, 0.3], [0.8, 0.78, 0.72]];
const DRESS: Character['dress'] = { pelvis: MAT.bottoms, torso: MAT.top, head: MAT.hair, upperArm: MAT.top, foreArm: MAT.top, thigh: MAT.bottoms, shin: MAT.bottoms, foot: MAT.shoes };
const ADULT: Proportions = { stature: 1.82, age: 30, build: 0, shoulders: 0, hips: 0, legs: 0 };
const pal = (o: Partial<Record<keyof typeof MAT, [number, number, number]>>): [number, number, number][] => DARK.map((c, i) => (Object.entries(MAT).find(([, v]) => v === i)?.[0] as keyof typeof MAT) in o ? o[Object.entries(MAT).find(([, v]) => v === i)![0] as keyof typeof MAT]! : c);

export const CHARACTERS: Character[] = [
  { name: 'runner', title: 'The runner', proportions: ADULT, palette: DARK, dress: DRESS, wears: [] },
  {
    name: 'teen', title: 'A teenager in a hoodie', proportions: { stature: 1.64, age: 14, build: -0.3, shoulders: -0.1, hips: 0, legs: 0.3 },
    palette: pal({ top: [0.44, 0.47, 0.42], bottoms: [0.18, 0.2, 0.27], shoes: [0.9, 0.9, 0.88], hair: [0.2, 0.14, 0.1], accent: [0.4, 0.43, 0.38] }), dress: DRESS,
    wears: [{ bone: 'torso', at: [0, 0.4, -0.08], block: { y0: 0, w0: 0.22, d0: 0.1, y1: 0.24, w1: 0.17, d1: 0.08 }, mat: MAT.accent, tilt: -0.25 }],
  },
  {
    name: 'child', title: 'A child with a bag', proportions: { stature: 1.3, age: 9, build: -0.2, shoulders: 0, hips: 0, legs: 0 },
    palette: pal({ top: [0.55, 0.32, 0.27], bottoms: [0.24, 0.27, 0.36], shoes: [0.3, 0.32, 0.4], hair: [0.32, 0.22, 0.14], accent: [0.86, 0.66, 0.28] }), dress: { ...DRESS, foreArm: MAT.skin },
    wears: [{ bone: 'torso', at: [0, 0.08, -0.14], block: { y0: 0, w0: 0.24, d0: 0.11, y1: 0.28, w1: 0.22, d1: 0.1 }, mat: MAT.accent }],
  },
  {
    name: 'broad', title: 'Tall and broad, in a cap', proportions: { stature: 1.95, age: 34, build: 0.6, shoulders: 0.5, hips: -0.1, legs: -0.1 },
    palette: pal({ top: [0.3, 0.33, 0.26], bottoms: [0.27, 0.25, 0.22], shoes: [0.24, 0.2, 0.18], hair: [0.12, 0.1, 0.09], accent: [0.62, 0.22, 0.18] }), dress: DRESS,
    wears: [{ bone: 'head', at: [0, 0.2, 0.06], block: { y0: 0, w0: 0.19, d0: 0.25, y1: 0.05, w1: 0.19, d1: 0.21 }, mat: MAT.accent }],
  },
  {
    name: 'slight', title: 'Slight, with a ponytail and scarf', proportions: { stature: 1.66, age: 24, build: -0.45, shoulders: -0.35, hips: 0.4, legs: 0.2 },
    palette: pal({ top: [0.52, 0.42, 0.5], bottoms: [0.14, 0.14, 0.17], shoes: [0.88, 0.86, 0.82], hair: [0.36, 0.2, 0.12], accent: [0.78, 0.52, 0.3] }), dress: DRESS,
    wears: [
      { bone: 'head', at: [0, 0.15, -0.1], block: { y0: 0, w0: 0.06, d0: 0.06, y1: -0.26, w1: 0.035, d1: 0.04 }, mat: MAT.hair, tilt: 0.35 },
      { bone: 'torso', at: [0.06, 0.42, 0.06], block: { y0: 0, w0: 0.08, d0: 0.03, y1: -0.3, w1: 0.07, d1: 0.025 }, mat: MAT.accent, tilt: 0.1 },
    ],
  },
  {
    name: 'older', title: 'Older, in a coat', proportions: { stature: 1.74, age: 64, build: 0.15, shoulders: -0.05, hips: 0.1, legs: -0.15 },
    palette: pal({ top: [0.42, 0.36, 0.3], bottoms: [0.3, 0.3, 0.32], shoes: [0.2, 0.17, 0.15], hair: [0.72, 0.7, 0.68], accent: [0.42, 0.36, 0.3] }), dress: DRESS,
    wears: [{ bone: 'pelvis', at: [0, 0.02, 0], block: { y0: 0, w0: 0.34, d0: 0.22, y1: -0.36, w1: 0.38, d1: 0.24 }, mat: MAT.top }],
  },
  {
    // (the references' figure (kyo-rooftops, kyo-kling-parkour): a schoolgirl who flings her bag and runs the roofs. A dark
    // sailor-style uniform (top and a full pleated skirt to the knee), the collar edged white (a dark flap over a white one, at
    // the back and the front), a red neckerchief, white socks to mid-calf, black loafers; black hair in a high ponytail. The
    // skirt and the ponytail move (`hang`): the skirt bells in the air and on a landing, the ponytail streams behind)
    name: 'schoolgirl', title: 'A schoolgirl in a sailor uniform', proportions: { stature: 1.6, age: 16, build: -0.3, shoulders: -0.3, hips: 0.2, legs: 0.25 },
    palette: pal({ top: [0.07, 0.075, 0.11], bottoms: [0.07, 0.075, 0.11], shoes: [0.06, 0.055, 0.055], hair: [0.05, 0.045, 0.05], accent: [0.78, 0.14, 0.17], accent2: [0.07, 0.075, 0.11], trim: [0.93, 0.93, 0.9] }),
    dress: { ...DRESS, thigh: MAT.skin, shin: MAT.skin },
    wears: [
      { bone: 'pelvis', at: [0, 0.05, 0], block: { y0: 0, w0: 0.27, d0: 0.19, y1: -0.35, w1: 0.38, d1: 0.31 }, mat: MAT.bottoms, hang: { rest: 3, fall: 0.5, drag: 0.05, stiff: 120, damp: 16, max: 0.55, flare: 1 } },
      { bone: 'torso', at: [0, 0.44, -0.1], block: { y0: 0, w0: 0.29, d0: 0.02, y1: -0.21, w1: 0.31, d1: 0.02 }, mat: MAT.trim, tilt: -0.12 },
      { bone: 'torso', at: [0, 0.435, -0.115], block: { y0: 0, w0: 0.25, d0: 0.02, y1: -0.18, w1: 0.27, d1: 0.02 }, mat: MAT.accent2, tilt: -0.12 },
      { bone: 'torso', at: [0, 0.445, 0.082], block: { y0: 0, w0: 0.24, d0: 0.02, y1: -0.09, w1: 0.13, d1: 0.02 }, mat: MAT.trim, tilt: 0.1 },
      { bone: 'torso', at: [0, 0.44, 0.095], block: { y0: 0, w0: 0.2, d0: 0.02, y1: -0.07, w1: 0.1, d1: 0.02 }, mat: MAT.accent2, tilt: 0.1 },
      { bone: 'torso', at: [0, 0.37, 0.108], block: { y0: 0, w0: 0.1, d0: 0.03, y1: -0.15, w1: 0.05, d1: 0.025 }, mat: MAT.accent, tilt: 0.12 },
      { bone: 'head', at: [0, 0.2, -0.1], block: { y0: 0, w0: 0.075, d0: 0.065, y1: -0.42, w1: 0.05, d1: 0.04 }, mat: MAT.hair, tilt: 0.3, hang: { rest: 0.4, fall: 1, drag: 0.1, stiff: 34, damp: 5 } },
      { bone: 'shinL', at: [0, -0.2, 0], block: { y0: 0, w0: 0.092, d0: 0.097, y1: -0.25, w1: 0.08, d1: 0.086 }, mat: MAT.trim },
      { bone: 'shinR', at: [0, -0.2, 0], block: { y0: 0, w0: 0.092, d0: 0.097, y1: -0.25, w1: 0.08, d1: 0.086 }, mat: MAT.trim },
    ],
  },
];

export const characterByName = (n: string | null | undefined): Character => CHARACTERS.find((c) => c.name === n) ?? CHARACTERS[0];

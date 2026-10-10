/**
 * Marble Run: the themes. A theme is where the run is and what it's made of: its light (the
 * key light through the window, the room's own colours, the lamps), its construction (what
 * each part of the course is made of: the surface, the strips' faces and edges, the pegs, the
 * seams, the supports), its setting (what stands about: boxes or columns, bunting, litter) and
 * its air (haze, dust). The course, the physics, the race and the camera know nothing of it:
 * a theme can change under a race and the race goes on exactly as it was.
 *
 * The renderer draws by material id (`mesh.ts`): each id has a colour, a roughness, a
 * metalness and a style (how its detail is made: paper fibre, corrugation, lacquer, brass,
 * oak, leather, planks, stone, glaze) from the theme, so the one mesh is cardboard in one
 * theme and brass-bound lacquer in another.
 */
import type { V3 } from './track';

/** how a material's detail is made (the shader's `detail`) */
export const STYLE = { plain: 0, paper: 1, corrugation: 2, lacquer: 3, brass: 4, oak: 5, leather: 6, planks: 7, stone: 8, glaze: 9, chart: 10 } as const;
export type Style = (typeof STYLE)[keyof typeof STYLE];

/** a material: colour, roughness, metalness, style, and how strong the style's detail is */
export interface Mat { colour: V3; rough: number; metal?: number; style: Style; detail?: number }

export interface Theme {
  id: string;
  name: string;
  /** the key light's direction (the sun by day, the moon by night), its colour and strength */
  key: V3;
  keyColour: V3;
  keyStrength: number;
  /** the window: where it is, its glow's colour and strength (what the glass reflects as a shape) */
  win: V3;
  winColour: V3;
  winStrength: number;
  /** the room, by direction: below, around, above */
  envFloor: V3;
  envWall: V3;
  envCeil: V3;
  /** the far haze: its colour and how soon it takes over */
  haze: V3;
  hazeNear: number;
  /** the lamps: lit (point lights, glowing bulbs), their colour, their reach */
  lamps: boolean;
  lampColour: V3;
  lampStrength: number;
  dust: number;
  /** what each material id is made of (`mesh.ts` says which id is which part) */
  mats: Record<number, Mat>;
  /** how the boards are held up, and what stands about */
  supports: 'boxes' | 'columns';
  bunting: boolean;
  litter: boolean;
  /** the marker's and the UI's accent */
  accent: string;
  pageColour: string;
}

const ATELIER: Theme = {
  id: 'atelier',
  name: 'atelier',
  key: [0.45, 0.8, 0.35], keyColour: [1, 0.95, 0.86], keyStrength: 1.6,
  win: [0.7, 0.3, 0.55], winColour: [1, 0.97, 0.9], winStrength: 2.6,
  envFloor: [0.2, 0.17, 0.14], envWall: [0.46, 0.45, 0.43], envCeil: [0.56, 0.56, 0.55],
  haze: [0.42, 0.41, 0.39], hazeNear: 0.35,
  lamps: false, lampColour: [1, 0.85, 0.6], lampStrength: 0,
  dust: 0.7,
  mats: {
    0: { colour: [0.6, 0.46, 0.3], rough: 0.9, style: STYLE.paper, detail: 1 },
    1: { colour: [0.64, 0.51, 0.35], rough: 0.85, style: STYLE.paper, detail: 1 },
    2: { colour: [0.62, 0.63, 0.66], rough: 0.3, metal: 1, style: STYLE.plain },
    3: { colour: [0.33, 0.25, 0.17], rough: 0.7, style: STYLE.planks, detail: 1 },
    4: { colour: [0.72, 0.6, 0.44], rough: 0.75, style: STYLE.oak, detail: 1 },
    7: { colour: [0.7, 0.58, 0.42], rough: 0.95, style: STYLE.corrugation, detail: 1 },
    8: { colour: [0.66, 0.6, 0.48], rough: 0.3, style: STYLE.plain },
    11: { colour: [0.4, 0.32, 0.23], rough: 0.45, style: STYLE.plain },
    12: { colour: [0.09, 0.09, 0.1], rough: 0.55, style: STYLE.plain },
    15: { colour: [0.12, 0.3, 0.22], rough: 0.25, style: STYLE.plain },
    18: { colour: [0.85, 0.62, 0.12], rough: 0.5, style: STYLE.plain },
    19: { colour: [0.6, 0.58, 0.54], rough: 0.95, style: STYLE.plain },
    21: { colour: [0.5, 0.42, 0.3], rough: 0.8, style: STYLE.oak, detail: 1 },
  },
  supports: 'boxes', bunting: true, litter: true,
  accent: '#ffeb73', pageColour: '#6b5a44',
};

const NOCTURNE: Theme = {
  id: 'nocturne',
  name: 'nocturne',
  // the moon, low through the arched windows; the lamps do the rest
  key: [-0.5, 0.55, 0.65], keyColour: [0.62, 0.72, 0.95], keyStrength: 0.3,
  win: [-0.55, 0.3, 0.75], winColour: [0.5, 0.6, 0.9], winStrength: 1.4,
  envFloor: [0.05, 0.04, 0.04], envWall: [0.1, 0.08, 0.07], envCeil: [0.06, 0.05, 0.06],
  haze: [0.05, 0.045, 0.05], hazeNear: 0.3,
  lamps: true, lampColour: [1, 0.78, 0.5], lampStrength: 1.2,
  dust: 0.35,
  mats: {
    0: { colour: [0.05, 0.07, 0.14], rough: 0.22, style: STYLE.chart, detail: 1 },
    1: { colour: [0.09, 0.12, 0.2], rough: 0.35, style: STYLE.leather, detail: 1 },
    2: { colour: [0.85, 0.66, 0.32], rough: 0.3, metal: 0.75, style: STYLE.brass, detail: 1 },
    3: { colour: [0.18, 0.14, 0.12], rough: 0.35, style: STYLE.stone, detail: 1 },
    4: { colour: [0.2, 0.13, 0.09], rough: 0.5, style: STYLE.oak, detail: 0.6 },
    7: { colour: [0.85, 0.66, 0.32], rough: 0.3, metal: 0.75, style: STYLE.brass, detail: 1 },
    8: { colour: [0.85, 0.66, 0.32], rough: 0.35, metal: 0.75, style: STYLE.brass, detail: 1 },
    11: { colour: [0.6, 0.46, 0.22], rough: 0.4, metal: 0.75, style: STYLE.plain },
    12: { colour: [0.08, 0.07, 0.07], rough: 0.5, style: STYLE.plain },
    15: { colour: [0.2, 0.16, 0.12], rough: 0.3, style: STYLE.plain },
    18: { colour: [0.85, 0.66, 0.32], rough: 0.4, metal: 0.75, style: STYLE.plain },
    19: { colour: [0.16, 0.12, 0.1], rough: 0.8, style: STYLE.plain },
    21: { colour: [0.22, 0.15, 0.1], rough: 0.6, style: STYLE.oak, detail: 0.7 },
  },
  supports: 'columns', bunting: false, litter: false,
  accent: '#ffd27a', pageColour: '#0b0d16',
};

export const THEMES: Theme[] = [ATELIER, NOCTURNE];
export const themeById = (id: string | null | undefined): Theme => THEMES.find((t) => t.id === id) ?? ATELIER;

/** the material table as the shader takes it: 24 ids × (colour, rough) and (metal, style, detail, 0) */
export function matTables(t: Theme): { col: Float32Array; par: Float32Array } {
  const N = 24;
  const col = new Float32Array(N * 4), par = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const m = t.mats[i] ?? { colour: [0.5, 0.5, 0.5] as V3, rough: 0.6, style: STYLE.plain };
    col.set([m.colour[0], m.colour[1], m.colour[2], m.rough], i * 4);
    par.set([m.metal ?? 0, m.style, m.detail ?? 0, 0], i * 4);
  }
  return { col, par };
}

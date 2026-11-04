/**
 * What a skirt's cut from: swatches of real kinds of cloth, each described by the measurable properties a textile
 * lab would give it, not by a look:
 *
 * - weight: grams a square metre (gsm);
 * - bending length (Peirce's cantilever, cm): how far a strip sticks out over an edge before it droops to 41.5°.
 *   Flexural rigidity follows from it and the weight: B = w·g·c³, so stiffness and weight are separate dials;
 * - tensile stiffness along the warp and across the weft (N/m: newtons per metre of width, per unit strain), and
 *   in-plane shear stiffness (N/m). A woven cloth is stiff along both threads and soft to shear, so on the bias (45° to
 *   the threads) it stretches and clings; a knit is soft across its courses; felt has no threads, the same every way;
 * - friction on the body.
 *
 * The figures are representative of each kind of cloth (orders of magnitude from the textile literature), not
 * measurements of a particular bolt: they're the targets the evidence bench (evidence.ts) checks the simulated cloth
 * against, and the place to put real measurements of real swatches.
 *
 * How it takes the light (sheen, fuzz, see-through, weave) is separate, and only for drawing.
 */
export interface Fabric {
  id: string; name: string;
  /** grams per square metre */
  gsm: number;
  /** Peirce bending length, cm */
  bend: number;
  /** tensile stiffness along the warp, across the weft, and in-plane shear: N/m */
  warp: number; weft: number; shear: number;
  /** woven (has a grain) or not (felt: the same every way) */
  grain: boolean;
  friction: number;
  /** drawing only: sheen (satin), fuzz (wool, felt), see-through (chiffon, organza), how much a thread shows */
  sheen: number; fuzz: number; clear: number; weave: number;
  /** the swatch card's colour, undyed */
  card: string;
}

export const FABRICS: Fabric[] = [
  { id: 'chiffon', name: 'chiffon', gsm: 45, bend: 1.1, warp: 400, weft: 300, shear: 6, grain: true, friction: 0.3, sheen: 0.3, fuzz: 0, clear: 0.38, weave: 0.3, card: '#f3eef2' },
  { id: 'satin', name: 'silk satin', gsm: 95, bend: 1.4, warp: 900, weft: 600, shear: 10, grain: true, friction: 0.15, sheen: 1, fuzz: 0, clear: 0, weave: 0.12, card: '#f6f0e6' },
  { id: 'lawn', name: 'cotton lawn', gsm: 75, bend: 2, warp: 1500, weft: 1000, shear: 30, grain: true, friction: 0.45, sheen: 0.12, fuzz: 0.08, clear: 0, weave: 0.35, card: '#fbf8f2' },
  { id: 'jersey', name: 'jersey', gsm: 180, bend: 1.6, warp: 120, weft: 18, shear: 15, grain: true, friction: 0.55, sheen: 0.08, fuzz: 0.2, clear: 0, weave: 0.5, card: '#eef0f2' },
  { id: 'linen', name: 'linen', gsm: 190, bend: 2.8, warp: 3000, weft: 2200, shear: 50, grain: true, friction: 0.5, sheen: 0.1, fuzz: 0.15, clear: 0, weave: 0.75, card: '#ece3d2' },
  { id: 'flannel', name: 'wool flannel', gsm: 260, bend: 2.3, warp: 900, weft: 700, shear: 18, grain: true, friction: 0.6, sheen: 0.04, fuzz: 0.6, clear: 0, weave: 0.3, card: '#dcd8d2' },
  { id: 'organza', name: 'organza', gsm: 55, bend: 3.2, warp: 1800, weft: 1600, shear: 35, grain: true, friction: 0.3, sheen: 0.45, fuzz: 0, clear: 0.45, weave: 0.5, card: '#f4f2ec' },
  { id: 'felt', name: 'felt', gsm: 380, bend: 4.5, warp: 1500, weft: 1500, shear: 550, grain: false, friction: 0.7, sheen: 0, fuzz: 0.85, clear: 0, weave: 0, card: '#e7ddd2' },
];
export const fabricById = (id: string) => FABRICS.find((f) => f.id === id) ?? FABRICS[2];

/** in the simulation's units (grams, centimetres, seconds): mass per cm², flexural rigidity (dyn·cm), stiffnesses (dyn/cm) */
export function physical(f: Fabric) {
  const rho = f.gsm / 1e4;
  return { rho, B: rho * 980 * f.bend ** 3, E1: f.warp * 1e3, E2: f.weft * 1e3, G: f.shear * 1e3 };
}
/**
 * The tensile stiffness of the cloth along a direction at `phi` (radians) to the warp: an orthotropic sheet's
 * (1/E(φ) = cos⁴φ/E₁ + sin⁴φ/E₂ + (1/G − 2ν/E₁)·cos²φ·sin²φ). On the bias this is about 4G: soft, as cut cloth is.
 */
export function stiffAt(E1: number, E2: number, G: number, phi: number, nu = 0.2): number {
  const c = Math.cos(phi), s = Math.sin(phi), c2 = c * c, s2 = s * s;
  return 1 / (c2 * c2 / E1 + s2 * s2 / E2 + (1 / G - (2 * nu) / E1) * c2 * s2);
}

// ─── prints ────────────────────────────────────────────────────────────────────────────────────
/** the print's printed along the warp, as on the bolt: cut on the bias, a stripe runs at 45° */
export interface Print { kind: number; ink: [number, number, number][]; scale: number }
export const PRINTS = ['plain', 'stripes', 'gingham', 'spots', 'flowers', 'stars'];
/** the colourways: ground, first ink, second ink */
export const COLOURWAYS: Array<{ name: string; inks: [string, string, string] }> = [
  { name: 'strawberry', inks: ['#f6c9cf', '#e0566e', '#fff4e2'] },
  { name: 'sea', inks: ['#bfe0e8', '#2f6f9f', '#fdf6e8'] },
  { name: 'marigold', inks: ['#f8e4a3', '#e08a2c', '#5a8f4e'] },
  { name: 'lilac', inks: ['#d9cbef', '#6c4ba6', '#f7c1d9'] },
  { name: 'ink', inks: ['#3a3f58', '#f2e9d8', '#e0566e'] },
];
const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
export function makePrint(kind: number, colour: number): Print {
  return { kind, ink: COLOURWAYS[colour % COLOURWAYS.length].inks.map(rgb), scale: 1 };
}

// ─── made one's own ───────────────────────────────────────────────────────────────────────────
/** what a skirt's cut from, as its recipe says: a swatch, a print, a colourway, and what's been changed of each (the
 * cloth's own qualities, the palette's three inks, the print's scale) */
export interface Look { fabric: string; print: number; colour: number; cloth?: Partial<Fabric>; inks?: [string, string, string]; printScale?: number }
/** the cloth itself: the swatch, with whatever's been changed of it */
export const fabricOf = (r: Look): Fabric => (r.cloth ? { ...fabricById(r.fabric), ...r.cloth } : fabricById(r.fabric));
/** the palette: the colourway's three inks, or the ones chosen instead */
export const inksOf = (r: Look): [string, string, string] => r.inks ?? COLOURWAYS[r.colour % COLOURWAYS.length].inks;
/** the print as it's printed: its kind, its inks, its scale */
export const printOf = (r: Look): Print => ({ kind: r.print, ink: inksOf(r).map(rgb), scale: r.printScale ?? 1 });

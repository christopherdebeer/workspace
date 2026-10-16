/**
 * What a garment's cut from, and what's printed on it. The fabric dial runs tulle → silk → cotton → linen → wool →
 * felt, each one's handling blended into the next: how heavy, how stiff to bend, how it catches the light (silk's
 * sheen, wool's soft fuzz at a glance, tulle's see-through). The print dial runs through six prints in four
 * colourways each.
 */
export interface Fabric {
  /** weight (relative to cotton), stiffness to bend (0–1), friction on the body (0–1), how much it damps */
  mass: number; bend: number; friction: number; damp: number;
  /** sheen (silk), fuzz (wool, felt), how see-through (tulle), and how much a thread shows */
  sheen: number; fuzz: number; clear: number; weave: number;
}
const F: Fabric[] = [
  { mass: 0.35, bend: 0.22, friction: 0.35, damp: 0.02, sheen: 0.15, fuzz: 0, clear: 0.55, weave: 1 },    // tulle
  { mass: 0.75, bend: 0.015, friction: 0.12, damp: 0.01, sheen: 1, fuzz: 0, clear: 0, weave: 0.15 },      // silk
  { mass: 1, bend: 0.09, friction: 0.45, damp: 0.02, sheen: 0.12, fuzz: 0.1, clear: 0, weave: 0.35 },      // cotton
  { mass: 1.1, bend: 0.2, friction: 0.5, damp: 0.025, sheen: 0.1, fuzz: 0.15, clear: 0, weave: 0.7 },     // linen
  { mass: 1.5, bend: 0.32, friction: 0.6, damp: 0.03, sheen: 0.05, fuzz: 0.55, clear: 0, weave: 0.3 },    // wool
  { mass: 1.4, bend: 0.75, friction: 0.7, damp: 0.04, sheen: 0, fuzz: 0.8, clear: 0, weave: 0 },          // felt
];
export function fabricAt(t: number): Fabric {
  const x = Math.max(0, Math.min(1, t)) * (F.length - 1), k = Math.min(F.length - 2, Math.floor(x)), f = x - k, a = F[k], b = F[k + 1];
  const o = {} as Fabric;
  for (const key of Object.keys(a) as Array<keyof Fabric>) o[key] = a[key] + (b[key] - a[key]) * f;
  return o;
}

export interface Print { kind: number; ink: [number, number, number][]; scale: number }
/** the colourways: ground, first ink, second ink (sRGB 0–1) */
const WAYS: Array<[string, string, string]> = [
  ['#f6c9cf', '#e0566e', '#fff4e2'],  // strawberry
  ['#bfe0e8', '#2f6f9f', '#fdf6e8'],  // sea
  ['#f8e4a3', '#e08a2c', '#5a8f4e'],  // marigold
  ['#d9cbef', '#6c4ba6', '#f7c1d9'],  // lilac
];
const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
export function printAt(t: number): Print {
  const x = Math.max(0, Math.min(0.9999, t)) * 24, k = Math.floor(x), f = x - k;
  return { kind: k % 6, ink: WAYS[Math.floor(k / 6)].map(rgb), scale: 0.8 + f * 0.6 };
}

/**
 * The rails: the workshop's own, hung with skirts to start from, and one for each person who makes things here, with
 * what they've made. Kept in this browser (localStorage), so a rail is a person on this device: a family's tablet, a
 * classroom's. (Nothing leaves it; a private window keeps them only for the visit.)
 */
import { DEFAULT_DESIGN, fromDesign, type Design, type Recipe } from './pattern';

/** a skirt on a rail: its recipe (how it was made); one kept from before recipes has its design, written as moves */
export interface Garment { id: string; recipe?: Recipe; design?: Design; at: number }
export const recipeOf = (g: Garment): Recipe => g.recipe ?? fromDesign(g.design ?? DEFAULT_DESIGN);
export interface Rail { id: string; name: string; colour: number; garments: Garment[]; workshop?: boolean }

/** the rails' powder-coat colours, and how their name tags are drawn */
export const RAIL_COLOURS: Array<{ tint: [number, number, number]; css: string }> = [
  { tint: [0.78, 0.22, 0.3], css: '#c8384d' },
  { tint: [0.16, 0.42, 0.62], css: '#2a6b9e' },
  { tint: [0.86, 0.6, 0.12], css: '#d9961f' },
  { tint: [0.36, 0.58, 0.32], css: '#5c9452' },
  { tint: [0.46, 0.32, 0.66], css: '#7651a8' },
  { tint: [0.15, 0.6, 0.58], css: '#26998f' },
];
const d = (x: Partial<Design>): Design => ({ ...DEFAULT_DESIGN, ...x });
/** the workshop's rail: one of each way of making a skirt, in contrasting cloths, to start from */
export const WORKSHOP: Rail = {
  id: 'workshop', name: 'the workshop', colour: -1, workshop: true,
  garments: [
    d({}),
    d({ method: 'flare', fullness: 1, length: 30, panels: 4, fabric: 'flannel', print: 1, colour: 4 }),
    d({ method: 'gather', fullness: 2.8, length: 36, fabric: 'chiffon', print: 4, colour: 3 }),
    d({ method: 'flare', fullness: 2.6, length: 30, panels: 6, fabric: 'felt', print: 0, colour: 0 }),
    d({ method: 'pleat', fullness: 2, length: 32, panels: 4, fabric: 'linen', print: 2, colour: 2 }),
    d({ method: 'flare', fullness: 3.8, length: 44, panels: 1, grain: 45, fabric: 'satin', print: 1, colour: 0 }),
    d({ method: 'gather', fullness: 2, length: 52, panels: 3, fabric: 'jersey', print: 5, colour: 1 }),
    d({ method: 'flare', fullness: 1.8, length: 20, panels: 8, fabric: 'organza', print: 3, colour: 3 }),
  ].map((design, k) => ({ id: `w${k}`, recipe: fromDesign(design), at: 0 })),
};

const KEY = 'fab.rails.v1';
interface Saved { rails: Rail[]; active: string }
let saved: Saved = { rails: [], active: 'workshop' };
try {
  const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
  if (s && Array.isArray(s.rails)) saved = { rails: s.rails.filter((r) => r && typeof r.name === 'string' && Array.isArray(r.garments)), active: s.active ?? 'workshop' };
} catch { /* (no storage: rails last the visit) */ }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* */ } };
const uid = () => Math.random().toString(36).slice(2, 10);

export const rails = (): Rail[] => [WORKSHOP, ...saved.rails];
export const activeRail = (): string => saved.active;
export function setActive(id: string) { saved.active = id; persist(); }
export function addRail(name: string): Rail {
  const used = new Set(saved.rails.map((r) => r.colour));
  const r: Rail = { id: uid(), name: name.trim().slice(0, 24) || 'my rail', colour: [0, 1, 2, 3, 4, 5].find((c) => !used.has(c)) ?? saved.rails.length % RAIL_COLOURS.length, garments: [] };
  saved.rails.push(r); saved.active = r.id; persist();
  return r;
}
export function renameRail(id: string, name: string) { const r = saved.rails.find((x) => x.id === id); if (r && name.trim()) { r.name = name.trim().slice(0, 24); persist(); } }
export function removeRail(id: string) { saved.rails = saved.rails.filter((r) => r.id !== id); if (saved.active === id) saved.active = 'workshop'; persist(); }
/** hang a skirt on a person's rail: back where it came from if it's theirs, else at the front */
export function hang(railId: string, recipe: Recipe, garmentId?: string): Garment | null {
  const r = saved.rails.find((x) => x.id === railId);
  if (!r) return null;
  const g = garmentId ? r.garments.find((x) => x.id === garmentId) : undefined;
  if (g) { g.recipe = structuredClone(recipe); delete g.design; g.at = Date.now(); persist(); return g; }
  const ng: Garment = { id: uid(), recipe: structuredClone(recipe), at: Date.now() };
  r.garments.unshift(ng); persist();
  return ng;
}
export function takeOff(railId: string, garmentId: string) { const r = saved.rails.find((x) => x.id === railId); if (r) { r.garments = r.garments.filter((g) => g.id !== garmentId); persist(); } }

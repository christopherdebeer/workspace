/**
 * The rails: the workshop's own (one, hung with a few of each kind of thing it makes: skirts, dresses, tops, trousers
 * and jumpsuits), to start from, and one for each person who makes things here, with what they've made. Kept in this browser (localStorage), so a rail is a person on this device: a family's tablet, a
 * classroom's. (Nothing leaves it; a private window keeps them only for the visit.)
 */
import { fromDesign, type Design, type Recipe } from './pattern';
import { recipeFor, sanitize } from './garment';

/** a garment on a rail: its design (what kind of thing, and its dials) and, if it has a skirt (a skirt, a dress), that
 * skirt's recipe: its paper as worked, moves and all. One kept from before recipes has only its design; one kept from
 * before there were tops has only its recipe (a skirt) */
export interface Garment { id: string; design?: Design; recipe?: Recipe; at: number }
/** a garment's design, made whole (a skirt's length, panels, grain and cloth read from its recipe, which is the truth) */
export const designOf = (g: Garment): Design => sanitize(g.recipe ? { ...g.design, length: g.recipe.length, panels: g.recipe.panels, grain: g.recipe.grain, fabric: g.recipe.fabric, print: g.recipe.print, colour: g.recipe.colour } : g.design);
/** its skirt's recipe: as kept, or written from its design */
export const recipeOf = (g: Garment): Recipe => recipeFor(designOf(g), g.recipe);
/** how it looks: its recipe's cloth, print and inks (made one's own), or its design's */
export const lookOf = (g: Garment) => g.recipe ?? designOf(g);
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
const d = (x: Partial<Design>): Design => sanitize(x);
const rail = (id: string, name: string, designs: Array<Partial<Design>>): Rail => ({ id, name, colour: -1, workshop: true, garments: designs.map((x, k) => { const dd = d(x); return { id: `${id}${k}`, design: dd, ...(dd.family === 'skirt' ? { recipe: fromDesign(dd) } : {}), at: 0 }; }) });
/** every garment the workshop has drafted, by kind: the evidence bench sews them all */
export const ALL_WORKSHOP: Rail[] = [
  rail('workshop', 'the workshop', [
    {},
    { method: 'flare', fullness: 1, length: 30, panels: 4, fabric: 'flannel', print: 1, colour: 4 },
    { method: 'gather', fullness: 2.8, length: 36, fabric: 'chiffon', print: 4, colour: 3 },
    { method: 'flare', fullness: 2.6, length: 30, panels: 6, fabric: 'felt', print: 0, colour: 0 },
    { method: 'pleat', fullness: 2, length: 32, panels: 4, fabric: 'linen', print: 2, colour: 2 },
    { method: 'flare', fullness: 3.8, length: 44, panels: 1, grain: 45, fabric: 'satin', print: 1, colour: 0 },
    { method: 'gather', fullness: 2, length: 52, panels: 3, fabric: 'jersey', print: 5, colour: 1 },
    { method: 'flare', fullness: 1.8, length: 20, panels: 8, fabric: 'organza', print: 3, colour: 3 },
    { method: 'gather', fullness: 1.8, length: 44, tiers: 3, fabric: 'lawn', print: 4, colour: 2 },
  ]),
  rail('workshop-tops', 'the workshop: tops', [
    { family: 'top', fabric: 'jersey', sleeveLen: 8, neck: 'round', print: 1, colour: 1 },
    { family: 'top', fabric: 'lawn', sleeve: 'puff', sleeveLen: 8, collar: 'peterpan', print: 3, colour: 0 },
    { family: 'top', fabric: 'linen', sleeveLen: 0, neck: 'square', bodyLen: -4, print: 2, colour: 2 },
    { family: 'top', fabric: 'chiffon', sleeve: 'bell', sleeveLen: 16, neck: 'v', collar: 'frill', print: 4, colour: 3 },
    { family: 'top', fabric: 'flannel', sleeveLen: 30, neck: 'boat', collar: 'band', bodyLen: 20, print: 0, colour: 4 },
    { family: 'top', fabric: 'satin', sleeveLen: 4, neck: 'scoop', swing: 1.6, bodyLen: 12, print: 5, colour: 3 },
  ]),
  rail('workshop-dresses', 'the workshop: dresses', [
    { family: 'dress', fabric: 'lawn', method: 'gather', fullness: 2.4, sleeve: 'puff', sleeveLen: 8, collar: 'peterpan', print: 2, colour: 0 },
    { family: 'dress', fabric: 'jersey', method: 'flare', fullness: 1.6, sleeveLen: 0, neck: 'scoop', length: 40, print: 1, colour: 1 },
    { family: 'dress', fabric: 'chiffon', method: 'gather', fullness: 2, tiers: 3, sleeve: 'bell', sleeveLen: 12, neck: 'v', length: 50, print: 4, colour: 3 },
    { family: 'dress', fabric: 'felt', method: 'flare', fullness: 3.4, panels: 2, sleeveLen: 4, neck: 'round', collar: 'band', length: 32, print: 0, colour: 0 },
    { family: 'dress', fabric: 'linen', method: 'pleat', fullness: 2, sleeveLen: 0, neck: 'square', length: 36, print: 2, colour: 2 },
  ]),
  rail('workshop-trousers', 'the workshop: trousers & jumpsuits', [
    { family: 'trousers', fabric: 'linen', legLen: 30, legWidth: 1.3, print: 2, colour: 4 },
    { family: 'trousers', fabric: 'jersey', legLen: 5, legWidth: 1.5, print: 1, colour: 1 },
    { family: 'trousers', fabric: 'satin', legLen: 33, legWidth: 1.9, flare: 1.2, print: 0, colour: 3 },
    { family: 'trousers', fabric: 'flannel', legLen: 32, legWidth: 1.1, flare: 1.7, print: 5, colour: 2 },
    { family: 'trousers', fabric: 'lawn', legLen: 16, legWidth: 1.8, print: 4, colour: 0 },
    { family: 'jumpsuit', fabric: 'lawn', legLen: 6, sleeveLen: 0, neck: 'square', print: 3, colour: 0 },
    { family: 'jumpsuit', fabric: 'jersey', legLen: 30, sleeveLen: 8, neck: 'v', collar: 'band', print: 1, colour: 4 },
  ]),
];
/** the workshop's one rail: a few of each kind, in contrasting cloths, to start from (each keeps its id, so whatever was
 * taken from the old rails still knows where it came from) */
const pick: Array<[number, number[]]> = [[0, [0, 2, 5, 8]], [2, [0, 2, 3]], [1, [0, 1, 3]], [3, [0, 1, 5, 6]]];
export const WORKSHOPS: Rail[] = [{ id: 'workshop', name: 'the workshop', colour: -1, workshop: true, garments: pick.flatMap(([r, ks]) => ks.map((k) => ALL_WORKSHOP[r].garments[k])) }];
export const WORKSHOP = WORKSHOPS[0];

const KEY = 'fab.rails.v1';
interface Saved { rails: Rail[]; active: string }
let saved: Saved = { rails: [], active: 'workshop' };
try {
  const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null;
  // (whatever's kept is checked as it's read: a rail with a name and garments, each garment a design that's made
  // whole (a skirt saved before there were tops gets the rest from the defaults); anything else is let go)
  if (s && Array.isArray(s.rails)) saved = {
    rails: s.rails.filter((r) => r && typeof r === 'object' && typeof r.name === 'string' && typeof r.id === 'string' && Array.isArray(r.garments)).map((r) => ({
      id: r.id, name: r.name.slice(0, 24), colour: Number.isInteger(r.colour) && r.colour >= 0 ? r.colour % RAIL_COLOURS.length : 0,
      garments: r.garments.filter((g) => g && typeof g === 'object' && typeof g.id === 'string' && ((g.design && typeof g.design === 'object') || (g.recipe && typeof g.recipe === 'object' && Array.isArray(g.recipe.moves))))
        .map((g) => ({ id: g.id, design: sanitize(g.design), ...(g.recipe ? { recipe: g.recipe } : {}), at: Number(g.at) || 0 })),
    })),
    active: typeof s.active === 'string' ? s.active : 'workshop',
  };
} catch { /* (no storage: rails last the visit) */ }
const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* */ } };
const uid = () => Math.random().toString(36).slice(2, 10);

export const rails = (): Rail[] => [...WORKSHOPS, ...saved.rails];
export const activeRail = (): string => saved.active;
/** whether a rail's one of the workshop's own */
export const isWorkshop = (id: string) => WORKSHOPS.some((r) => r.id === id);
export function setActive(id: string) { saved.active = id; persist(); }
export function addRail(name: string): Rail {
  const used = new Set(saved.rails.map((r) => r.colour));
  const r: Rail = { id: uid(), name: name.trim().slice(0, 24) || 'my rail', colour: [0, 1, 2, 3, 4, 5].find((c) => !used.has(c)) ?? saved.rails.length % RAIL_COLOURS.length, garments: [] };
  saved.rails.push(r); saved.active = r.id; persist();
  return r;
}
export function renameRail(id: string, name: string) { const r = saved.rails.find((x) => x.id === id); if (r && name.trim()) { r.name = name.trim().slice(0, 24); persist(); } }
export function removeRail(id: string) { saved.rails = saved.rails.filter((r) => r.id !== id); if (saved.active === id) saved.active = 'workshop'; persist(); }
/** hang a garment on a person's rail: back where it came from if it's theirs, else at the front */
export function hang(railId: string, item: { design: Design; recipe?: Recipe }, garmentId?: string): Garment | null {
  const r = saved.rails.find((x) => x.id === railId);
  if (!r) return null;
  const g = garmentId ? r.garments.find((x) => x.id === garmentId) : undefined;
  const keep = (x: Garment) => { x.design = structuredClone(item.design); if (item.recipe) x.recipe = structuredClone(item.recipe); else delete x.recipe; x.at = Date.now(); };
  if (g) { keep(g); persist(); return g; }
  const ng: Garment = { id: uid(), at: 0 }; keep(ng);
  r.garments.unshift(ng); persist();
  return ng;
}
export function takeOff(railId: string, garmentId: string) { const r = saved.rails.find((x) => x.id === railId); if (r) { r.garments = r.garments.filter((g) => g.id !== garmentId); persist(); } }

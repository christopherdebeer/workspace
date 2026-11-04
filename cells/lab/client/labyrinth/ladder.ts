/**
 * The ladder: what it takes to build what's built, and what a settlement could build next. Not shown, and not yet
 * asked by the rules: worked out from the world (its buildings' plans and uses: plans.ts, uses.ts; its traditions:
 * regions.ts), so the rules can come to choose by it (a shuttered window before a glazed one, a round arch before a
 * pointed one, a flat timber roof before tiles) and the hand can be told what's within reach.
 *
 * - **Techniques**, each on a rung, each needing others (`after`) and what the settlement has to show for itself
 *   (`needs`: households to feed the work, workshops to do it in, a hall or a store, a court house, a shop).
 * - **Parts**: everything that can be built, and the techniques it takes: a wall of piled stone, dressed stone, brick;
 *   an opening's head (round, pointed, four-centred); a floor over a storey (beams), a hall (a vault), a cross vault, a
 *   dome; tile, slate, a flat roof; shutters, glass in panes, a lattice; a timber frame, a jetty, a balcony, a loggia; a
 *   portal faced in tile; a bridge, an arcade, water held in a basin or a court's channels.
 * - **What it reaches**: the highest rung whose needs the settlement meets, every rung under it whole; then what's
 *   `within` reach (its techniques, and what they let be built), what's `next` (the rung above: what it would take),
 *   and what's built `ahead` of it (a part whose technique the settlement couldn't have: today everything can be built
 *   at once, so most of what's built is ahead; the ladder says so, it doesn't take anything away).
 */
import type { World } from './model';
import { buildings } from './buildings';
import { facades } from './facades';
import { grammarOfId } from './regions';
import { settlement, type Settlement, type Use } from './uses';

export type Technique = 'drystone' | 'timber' | 'mortar' | 'ashlar' | 'arch' | 'stair' | 'kiln' | 'joinery' | 'frame' | 'vault' | 'pointed' | 'dome' | 'slate' | 'glass' | 'glaze' | 'fourCentred' | 'hydraulics';
export interface Rung { n: number; name: string; needs: Partial<Record<Use | 'households', number>>; techniques: Technique[] }
export const RUNGS: Rung[] = [
  { n: 0, name: 'shelter', needs: {}, techniques: ['drystone', 'timber'] },
  { n: 1, name: 'hamlet', needs: { households: 2 }, techniques: ['mortar', 'arch', 'stair'] },
  { n: 2, name: 'village', needs: { households: 4, workshop: 1 }, techniques: ['ashlar', 'kiln', 'joinery', 'hydraulics'] },
  { n: 3, name: 'town', needs: { households: 8, workshop: 2, store: 1 }, techniques: ['frame', 'vault', 'pointed', 'slate'] },
  { n: 4, name: 'city', needs: { households: 14, workshop: 3, shop: 1, 'court house': 1, hall: 1 }, techniques: ['dome', 'glass', 'glaze', 'fourCentred'] },
];
/** what each technique needs known first */
export const AFTER: Record<Technique, Technique[]> = {
  drystone: [], timber: [], mortar: ['drystone'], arch: ['mortar', 'timber'], stair: ['timber'], ashlar: ['mortar'], kiln: ['mortar'], joinery: ['timber'],
  hydraulics: ['mortar'], frame: ['joinery'], vault: ['arch'], pointed: ['arch'], slate: ['ashlar'], dome: ['vault'], glass: ['kiln'], glaze: ['kiln', 'glass'], fourCentred: ['pointed'],
};
export type Part = 'stone wall' | 'dressed stone' | 'brick' | 'round arch' | 'pointed arch' | 'four-centred arch' | 'upper floor' | 'stair' | 'hall' | 'cross vault' | 'dome' | 'tile roof' | 'slate roof' | 'flat roof' | 'shutters' | 'glazed window' | 'lattice' | 'timber frame' | 'jetty' | 'balcony' | 'loggia' | 'tiled portal' | 'arcade' | 'bridge' | 'basin' | 'court water' | 'plaster';
export const PARTS: Record<Part, Technique[]> = {
  'stone wall': ['drystone'], 'dressed stone': ['ashlar'], brick: ['kiln'], 'round arch': ['arch'], 'pointed arch': ['pointed'], 'four-centred arch': ['fourCentred'],
  'upper floor': ['timber'], stair: ['stair'], hall: ['vault'], 'cross vault': ['vault'], dome: ['dome'], 'tile roof': ['kiln', 'timber'], 'slate roof': ['slate', 'timber'], 'flat roof': ['timber', 'mortar'],
  shutters: ['joinery'], 'glazed window': ['glass', 'joinery'], lattice: ['joinery'], 'timber frame': ['frame'], jetty: ['frame'], balcony: ['joinery'], loggia: ['arch'], 'tiled portal': ['glaze', 'pointed'],
  arcade: ['arch'], bridge: ['arch'], basin: ['hydraulics'], 'court water': ['hydraulics'], plaster: ['mortar'],
};

/**
 * What's known is what the settlement's rung allows, and for a craft's techniques, a workshop doing it: a kiln (fired
 * tile and brick), a carpenter (joinery, then the timber frame), a mason (dressed stone, split slate), a glassworks
 * (glass, glazed tile). Each workshop takes up the craft wanted next, in that order, by its building's identity (so a
 * workshop keeps its craft as others are added)
 */
export type Craft = 'kiln' | 'carpenter' | 'mason' | 'glassworks';
export const CRAFTS: Craft[] = ['kiln', 'carpenter', 'mason', 'glassworks'];
export const CRAFT_OF: Partial<Record<Technique, Craft>> = { kiln: 'kiln', joinery: 'carpenter', frame: 'carpenter', ashlar: 'mason', slate: 'mason', glass: 'glassworks', glaze: 'glassworks' };

export interface Reckoning {
  settlement: Settlement;
  /** the parts built, and where (building ids; -1 for what's no building's: arcades, bridges, water) */
  built: Map<Part, number[]>;
  rung: Rung; known: Set<Technique>;
  /** each workshop's craft, by its building's identity */
  crafts: Map<number, Craft>;
  /** what can be built now; what the rung above would take (and would add); what's built past what's known */
  within: Part[]; next: { rung: Rung; short: string[]; adds: Part[] } | null; ahead: Part[];
}

/** every part built in a world, and where */
export function partsBuilt(w: World): Map<Part, number[]> {
  const out = new Map<Part, number[]>(), add = (p: Part, id: number) => { const l = out.get(p) ?? out.set(p, []).get(p)!; if (!l.includes(id)) l.push(id); };
  const bs = buildings(w), bays = facades(w);
  for (const b of bs.list) {
    const g = grammarOfId(w, b.id), id = b.id;
    add('stone wall', id);
    if (g.wall === 'ashlar') add('dressed stone', id);
    if (g.wall === 'frame') add('timber frame', id);
    if (g.wall === 'plaster') add('plaster', id);
    if (b.cols.some(([i, j]) => Array.from({ length: b.h }, (_, k) => w.dressed(k, i, j)?.mat).some((m) => m === 1))) add('brick', id);
    if (b.h - Math.min(...b.base) >= 2) add('upper floor', id);
    if (b.inside) add('stair', id);
    // (its openings' heads, by its tradition's arch)
    const arched = b.openings.some((o) => o.style === 'arched' || (o.kind === 'door' && g.doorHead === 'arched'));
    if (arched) add(g.arch === 1 ? 'pointed arch' : g.arch === 2 ? 'four-centred arch' : 'round arch', id);
    if (b.through.length) add('round arch', id);
    const windows = b.openings.some((o) => o.kind === 'window');
    if (windows && g.shutters) add('shutters', id);
    if (windows && g.panes) add(g.panes.fine ? 'lattice' : 'glazed window', id);
    if (b.roof === 'dome') add('dome', id);
    else if (b.roof) add(g.roof === 'steep' ? 'slate roof' : 'tile roof', id);
    else if (!b.walked) add('flat roof', id);
  }
  for (const by of bays.values()) {
    const id = by.b.id;
    if (by.role === 'jetty') add('jetty', id);
    if (by.role === 'balcony') add('balcony', id);
    if (by.role === 'loggia') add('loggia', id);
    if (by.role === 'portal') add('tiled portal', id);
    if (by.role === 'gallery') add(grammarOfId(w, id).arch === 1 ? 'pointed arch' : 'round arch', id);
  }
  // (what's no building's: arcades and bridges (spans), cross vaults, water held up high and in courts)
  if (w.spans.some((s) => !s.flat)) add('arcade', -1);
  if (w.spans.some((s) => s.n >= 3)) add('bridge', -1);
  const e = w.extent();
  for (let k = 0; k < w.levels; k++) for (let j = e.j0; j <= e.j1; j++) for (let i = e.i0; i <= e.i1; i++) if (w.cross(k, i, j)) { add('cross vault', -1); k = w.levels; break; }
  if (w.basins.size) add('basin', -1);
  if (w.courts.size && w.pools.size) add('court water', -1);
  return out;
}

/** where a settlement stands on the ladder, and what it can build */
export function reckon(w: World): Reckoning {
  const s = settlement(w), built = partsBuilt(w);
  const meets = (r: Rung) => Object.entries(r.needs).every(([u, n]) => (u === 'households' ? s.households : s.count[u as Use]) >= (n ?? 0));
  let rung = RUNGS[0];
  for (const r of RUNGS) { if (meets(r)) rung = r; else break; }
  // (the workshops' crafts, each taking the next wanted, by identity; the rung's techniques, those of a craft only where
  // a workshop does it, and none before what it needs)
  const workshops = s.buildings.filter((b) => b.uses.includes('workshop')).map((b) => b.plan.b.id).sort((a, b) => a - b);
  const crafts = new Map<number, Craft>(workshops.map((id, n) => [id, CRAFTS[n % CRAFTS.length]]));
  const done = new Set(crafts.values()), forced = (globalThis as { labyrinthRung?: number }).labyrinthRung;
  if (forced !== undefined) rung = RUNGS[Math.max(0, Math.min(RUNGS.length - 1, forced))];
  const known = new Set<Technique>(RUNGS.filter((r) => r.n <= rung.n).flatMap((r) => r.techniques).filter((t) => forced !== undefined || !CRAFT_OF[t] || done.has(CRAFT_OF[t]!)));
  for (let changed = true; changed;) { changed = false; for (const t of [...known]) if (AFTER[t].some((a) => !known.has(a))) { known.delete(t); changed = true; } }
  const can = (p: Part, k: Set<Technique>) => PARTS[p].every((t) => k.has(t));
  const all = Object.keys(PARTS) as Part[];
  const up = RUNGS[rung.n + 1] ?? null;
  const next = up ? {
    rung: up,
    short: Object.entries(up.needs).filter(([u, n]) => (u === 'households' ? s.households : s.count[u as Use]) < (n ?? 0)).map(([u, n]) => `${u}: ${u === 'households' ? s.households : s.count[u as Use]} of ${n}`),
    adds: all.filter((p) => !can(p, known) && can(p, new Set([...known, ...up.techniques]))),
  } : null;
  return { settlement: s, built, rung, known, crafts, within: all.filter((p) => can(p, known)), next, ahead: [...built.keys()].filter((p) => !can(p, known)) };
}

/**
 * Whether a world's drawn by its ladder (realise.ts): a world made new in the app is (its first stone piled dry, its
 * roofs thatch, until the settlement knows better); the storyboards, and worlds kept from before, are drawn as they
 * were. `?ladder=0|1` sets it for any world; `?rung=n` draws as if at that rung (to compare).
 */
const G = globalThis as { labyrinthLadder?: boolean; labyrinthRung?: number };
export const setLadder = (on: boolean | undefined, rung?: number) => { G.labyrinthLadder = on; G.labyrinthRung = rung; };
export const ladderOn = (w: World) => G.labyrinthLadder ?? w.ladder;
const cache = new WeakMap<World, { v: number; r: Reckoning }>();
/** the world's reckoning, worked out once for each state of it */
export function reckoned(w: World): Reckoning {
  const c = cache.get(w);
  if (c && c.v === w.version && c.r) return c.r;
  const r = reckon(w);
  cache.set(w, { v: w.version, r });
  return r;
}
/** whether a technique's known, as the drawing asks: always, where the world isn't drawn by its ladder */
export const knows = (w: World, t: Technique) => !ladderOn(w) || reckoned(w).known.has(t);

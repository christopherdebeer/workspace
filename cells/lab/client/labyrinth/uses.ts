/**
 * What a building is good for, read from its plan (plans.ts): not chosen, never yet shown, worked out from what's
 * built, so a settlement can be reckoned (ladder.ts). A building can be several things, storey by storey (a shop at
 * the ground, a dwelling over it).
 *
 * - **A dwelling**: a lit room of 9 m² or more and a way in.
 *   Round a court (it faces one at its foot), a **court house**. A household to every 150 m² of lit floor, one at least
 *   (a court house of 500 m² is a family and its people, not a tenement).
 * - **A shop**: a ground room behind a shopfront.
 * - **A workshop**: a ground room of 18 m² or more come into straight from outside (a door on to the ground, a way or a
 *   court; a portal; a veranda) and dim (under half of it lit): a place to work in, not to live.
 * - **A store**: dark rooms (under a quarter lit), by their floor.
 * - **A hall**: a room wider than a beam spans both ways (its roof on a vault or posts).
 * - **A tower**: a building of a cell or two in plan, three storeys or more; a **lookout** if its top is walked.
 * - **A gatehouse**: a passage through its foot; an **inhabited bridge**: rooms standing on a deck.
 */
import { plans, type Plan } from './plans';
import type { World } from './model';

export type Use = 'dwelling' | 'court house' | 'shop' | 'workshop' | 'store' | 'hall' | 'tower' | 'lookout' | 'gatehouse' | 'inhabited bridge';
export interface Uses { plan: Plan; uses: Use[]; households: number; storage: number }
export interface Settlement {
  buildings: Uses[];
  /** what there is of each use, and the households, and the stored floor (m²) */
  count: Record<Use, number>; households: number; storage: number; courts: number;
}

export function usesOf(w: World, p: Plan): Uses {
  const uses: Use[] = [], b = p.b, ground = p.storeys[0];
  const lit = p.rooms.filter((r) => r.lit >= 0.5 && r.area >= 9);
  const litArea = lit.reduce((t, r) => t + r.area, 0);
  const wayIn = p.exits.length > 0 || b.through.length > 0;
  if (lit.length && wayIn) uses.push(p.court ? 'court house' : 'dwelling');
  if (ground?.rooms.some((r) => r.open.includes('shop'))) uses.push('shop');
  if (ground?.rooms.some((r) => r.area >= 18 && r.lit < 0.5 && (r.open.some((o) => o === 'portal' || o === 'veranda') || p.exits.some((e) => e.room === r.id && (e.to === 'ground' || e.to === 'way' || e.to === 'court'))))) uses.push('workshop');
  const dark = p.rooms.filter((r) => r.lit < 0.25), storage = dark.reduce((t, r) => t + r.area, 0);
  if (storage > 0) uses.push('store');
  if (p.rooms.some((r) => r.hall)) uses.push('hall');
  if (b.tower) uses.push(b.walked ? 'lookout' : 'tower');
  if (b.through.length) uses.push('gatehouse');
  if (b.cols.some(([i, j], n) => b.base[n] > w.ground(i, j))) uses.push('inhabited bridge');
  const households = uses.includes('dwelling') || uses.includes('court house') ? Math.max(1, Math.round(litArea / 150)) : 0;
  return { plan: p, uses, households, storage };
}

const USES: Use[] = ['dwelling', 'court house', 'shop', 'workshop', 'store', 'hall', 'tower', 'lookout', 'gatehouse', 'inhabited bridge'];
/** the settlement: every building's uses, and what they come to */
export function settlement(w: World): Settlement {
  const buildings = plans(w).map((p) => usesOf(w, p));
  const count = Object.fromEntries(USES.map((u) => [u, buildings.filter((b) => b.uses.includes(u)).length])) as Record<Use, number>;
  return { buildings, count, households: buildings.reduce((t, b) => t + b.households, 0), storage: buildings.reduce((t, b) => t + b.storage, 0), courts: buildings.filter((b) => b.plan.court).length };
}

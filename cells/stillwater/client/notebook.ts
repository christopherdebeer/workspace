/**
 * The naturalist's notebook: what this child has *noticed* on the river.
 *
 * Nothing is caught. A tap on a creature or an open flower is a sighting: the
 * thing reacts, its name is said, and the first time it gets a page. The pages
 * are drawn by the river itself — the live sprites at rest on paper — so the
 * child sees again exactly what they saw. See NARRATIVE-DESIGN.md §1.
 */

export type Group = 'dragonfly' | 'butterfly' | 'fish' | 'flower' | 'light';

export interface Species {
  id: string;
  group: Group;
  name: string;
  /** Where and when to look, for the page of one not yet seen. */
  where: string;
  /** How the renderer draws it at rest: the sprite's kind, and a seed that picks the variant. */
  kind: number;
  seed: number;
}

export const SPECIES: Species[] = [
  { id: 'emperor', group: 'dragonfly', name: 'emperor dragonfly', where: 'over open water, by day', kind: 0, seed: 0.2 },
  { id: 'darter', group: 'dragonfly', name: 'common darter', where: 'over open water, into dusk', kind: 0, seed: 0.55 },
  { id: 'demoiselle', group: 'dragonfly', name: 'banded demoiselle', where: 'over open water, by day', kind: 0, seed: 0.85 },
  { id: 'tortoiseshell', group: 'butterfly', name: 'small tortoiseshell', where: 'near the flowers', kind: 1, seed: 0.3 },
  { id: 'white', group: 'butterfly', name: 'cabbage white', where: 'near the flowers', kind: 2, seed: 0.3 },
  { id: 'blue', group: 'butterfly', name: 'common blue', where: 'near the flowers', kind: 3, seed: 0.3 },
  { id: 'brimstone', group: 'butterfly', name: 'brimstone', where: 'near the flowers', kind: 4, seed: 0.3 },
  { id: 'chub', group: 'fish', name: 'chub', where: 'deep in the open runs', kind: 0, seed: 0.4 },
  { id: 'carp', group: 'fish', name: 'carp', where: 'slow water, under the leaves', kind: 1, seed: 0.4 },
  { id: 'koi', group: 'fish', name: 'koi', where: 'by the piers', kind: 2, seed: 0.4 },
  { id: 'minnow', group: 'fish', name: 'minnow', where: 'in shoals in the shallows', kind: 3, seed: 0.4 },
  { id: 'lily-white', group: 'flower', name: 'white water lily', where: 'where the leaves flower', kind: 1, seed: 0.3 },
  { id: 'lily-pink', group: 'flower', name: 'pink water lily', where: 'where the leaves flower', kind: 2, seed: 0.3 },
  { id: 'lily-yellow', group: 'flower', name: 'yellow water lily', where: 'where the leaves flower', kind: 3, seed: 0.3 },
  { id: 'lily-rose', group: 'flower', name: 'double rose lily', where: 'where the leaves flower', kind: 4, seed: 0.3 },
  { id: 'spatterdock', group: 'flower', name: 'spatterdock', where: 'among the old leaves', kind: 5, seed: 0.3 },
  { id: 'spent', group: 'flower', name: 'a spent flower', where: 'where a lily has finished', kind: 6, seed: 0.3 },
  { id: 'firefly', group: 'light', name: 'firefly', where: 'after dusk', kind: 0, seed: 0 },
];

export const byId = (id: string): Species | undefined => SPECIES.find((s) => s.id === id);

/** Which species a live thing is. */
export function dragonflyId(seed: number): string {
  return seed < 0.4 ? 'emperor' : seed < 0.7 ? 'darter' : 'demoiselle';
}
export function butterflyId(kind: number): string {
  return ['', 'tortoiseshell', 'white', 'blue', 'brimstone'][kind] ?? 'tortoiseshell';
}
export function fishId(kind: number): string {
  return ['chub', 'carp', 'koi', 'minnow'][kind] ?? 'minnow';
}
export function flowerId(variant: number): string {
  return ['', 'lily-white', 'lily-pink', 'lily-yellow', 'lily-rose', 'spatterdock', 'spent'][variant] ?? 'lily-white';
}

export interface Sighting {
  first: number;
  count: number;
}

export interface NotebookData {
  seen: Record<string, Sighting>;
}

export class Notebook {
  seen: Record<string, Sighting>;

  constructor(saved: NotebookData | null = null) {
    this.seen = saved?.seen ?? {};
  }

  /** Record a sighting; true if it is this child's first of that species. */
  sight(id: string, now = Date.now()): { species: Species; isNew: boolean; count: number } | null {
    const species = byId(id);
    if (!species) return null;
    const s = this.seen[id];
    if (s) {
      s.count += 1;
      return { species, isNew: false, count: s.count };
    }
    this.seen[id] = { first: now, count: 1 };
    return { species, isNew: true, count: 1 };
  }

  has(id: string): boolean {
    return !!this.seen[id];
  }

  get pages(): number {
    return Object.keys(this.seen).length;
  }

  toJSON(): NotebookData {
    return { seen: this.seen };
  }
}

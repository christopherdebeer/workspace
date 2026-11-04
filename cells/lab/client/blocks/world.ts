/**
 * The blocks' world: a sparse lattice of cells, without edges. Each cell is filled or not; nothing else is kept. All a
 * block becomes (its shape, its joins, its openings) is read from what's round it (rules.ts), so the world itself is
 * only which cells are filled, and the history of how they came to be.
 *
 * Cells are integers (x, y, z), y up; y ≥ 0 (the ground is under y = 0). A cell's key packs the three into one number:
 * 17 bits each way, ±65,536 cells, more than any hand will reach.
 */

export const SPAN = 1 << 16, BITS = 1 << 17;
/** one number for a cell, exact in a double (51 bits) */
export const key = (x: number, y: number, z: number) => ((x + SPAN) * BITS + (y + SPAN)) * BITS + (z + SPAN);
export function unkey(k: number): [number, number, number] {
  const z = (k % BITS) - SPAN, r = Math.floor(k / BITS), y = (r % BITS) - SPAN, x = Math.floor(r / BITS) - SPAN;
  return [x, y, z];
}

/** a change the hand made: cells filled, cells emptied (as one step, for undo) */
export type Edit = { add: number[]; del: number[] };

export class World {
  /** the filled cells */
  readonly cells = new Set<number>();
  /** each edit, for undo */
  readonly history: Edit[] = [];
  /** bumped on every change */
  version = 0;
  has(x: number, y: number, z: number) { return y >= 0 && this.cells.has(key(x, y, z)); }
  /** fill and empty cells as one step; what's already so is left out of it (so undo does exactly the reverse). `join`:
   * part of the step before (a stroke, cell by cell, undone as one); what it returns is only what this call changed */
  apply(add: number[], del: number[] = [], join = false): Edit | null {
    const e: Edit = { add: add.filter((k) => !this.cells.has(k) && unkey(k)[1] >= 0), del: del.filter((k) => this.cells.has(k)) };
    if (!e.add.length && !e.del.length) return null;
    for (const k of e.del) this.cells.delete(k);
    for (const k of e.add) this.cells.add(k);
    const last = this.history[this.history.length - 1];
    if (join && last) { last.add.push(...e.add); last.del.push(...e.del); } else this.history.push({ add: [...e.add], del: [...e.del] });
    this.version++;
    return e;
  }
  undo(): Edit | null {
    const e = this.history.pop();
    if (!e) return null;
    for (const k of e.add) this.cells.delete(k);
    for (const k of e.del) this.cells.add(k);
    this.version++;
    return { add: e.del, del: e.add };
  }
  clear(): Edit | null { return this.apply([], [...this.cells]); }
  encode(): string { return JSON.stringify([...this.cells].map(unkey)); }
  static decode(s: string): World {
    const w = new World();
    try { for (const [x, y, z] of JSON.parse(s) as number[][]) if (y >= 0) w.cells.add(key(x, y, z)); } catch { /* an empty world */ }
    return w;
  }
}

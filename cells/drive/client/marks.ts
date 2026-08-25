/**
 * THINGS THAT HAPPENED ONCE, AND STAY HAPPENED.
 *
 * The survey's memory (`survey-store.ts`) is counts along roads. This is the
 * other kind of progress the campaign needs: **events that latch** — a mission
 * completed, a station woken. Each is an id and the wall-clock moment it first
 * happened, and that is the whole record:
 *
 *   drive.marks.v1 = { v: 1, m: { <missionId>: at }, s: { <stationId>: at } }
 *
 * The arithmetic is the same monotonic story as the roads, with one twist:
 * counts merge by MAX (progress only goes up), but a latched event merges by
 * **MIN** — the interesting question about a thing that can only happen once
 * is WHEN, and the truth is the first time it happened, whichever device saw
 * it. Union-and-min is order-independent, so two devices converge with no
 * clock and no conflict, exactly like the road claims.
 *
 * Kept apart from the survey store on purpose: roads are a big, growing,
 * crumb-shedding structure with a cap; this is a small flat set that will
 * never need one. Sharing a blob would couple their failure modes for no win.
 */

import type { StoreLike } from './survey-store';

// mission done · station woken · observation recorded
//
// 'o' IS LOCAL FOR NOW. The sync bridge speaks `missions` and `stations` by
// name and the server's /state reserves a row per kind, so an observation
// latches and survives a reload on THIS device but does not yet travel to
// another. That is a deliberate seam, not an oversight: the recording
// mechanic is worth playing before its wire format is fixed in a table.
export type MarkKind = 'm' | 's' | 'o';
const MARK_KINDS: MarkKind[] = ['m', 's', 'o'];
const MARKS_V = 1;
const MARKS_KEY = `drive.marks.v${MARKS_V}`;
/** How long a mark may sit unwritten. Marks are rare (a job finished, a
 *  station woken) so unlike the survey's crumbs there is no write-budget
 *  problem — but the flush still debounces so a burst costs one write. */
const MARKS_FLUSH_MS = 1500;

export interface MarksDump { m?: Record<string, number>; s?: Record<string, number>;
  o?: Record<string, number> }
export interface Marks {
  /** When it happened, 0 if it has not. */
  at(kind: MarkKind, id: string): number;
  has(kind: MarkKind, id: string): boolean;
  /** Latch it — now, or at an explicit moment. Latched means latched: a
   *  second set can only move the moment EARLIER (a sync bringing the truth
   *  that another device did it first). */
  set(kind: MarkKind, id: string, at?: number): void;
  /** Everything that changed since `since` (wall-clock), for the sync push. */
  dump(since: number): MarksDump;
  /** Fold a durable copy back in; returns how many marks changed. */
  merge(rows: MarksDump): number;
  count(kind: MarkKind): number;
  /** Hand the docket back: forget every mark, WRITTEN THROUGH immediately —
   *  a reset that could be lost to a crash is worse than none. The caller
   *  owns clearing the durable copy first (see the campaign reset in
   *  `main.ts`): latched min-merge means a surviving server row would simply
   *  latch everything again on the next sync. */
  reset(): void;
  tick(now: number): void;
  flush(): void;
  dirty(): boolean;
}

export function openMarks(opts: {
  store?: StoreLike | null;
  now?: () => number;
  stamp?: () => number;
} = {}): Marks {
  const store = opts.store === undefined
    ? (() => { try { return localStorage; } catch { return null; } })()
    : opts.store;
  const now = opts.now ?? (() => performance.now());
  const stamp = opts.stamp ?? (() => Date.now());

  const maps: Record<MarkKind, Map<string, number>> = { m: new Map(), s: new Map(), o: new Map() };
  /** `now()` of the oldest unwritten change, 0 when clean. */
  let pending = 0;

  try {
    const raw = JSON.parse(store?.getItem(MARKS_KEY) ?? 'null') as
      { m?: Record<string, unknown>; s?: Record<string, unknown>;
        o?: Record<string, unknown> } | null;
    for (const kind of MARK_KINDS) {
      for (const [id, at] of Object.entries(raw?.[kind] ?? {})) {
        const t = Number(at);
        if (id && Number.isFinite(t) && t > 0) maps[kind].set(id, t);
      }
    }
  } catch { /* an unreadable store is the same as none */ }

  function flush(): void {
    pending = 0;
    try {
      store?.setItem(MARKS_KEY, JSON.stringify({
        v: MARKS_V,
        m: Object.fromEntries(maps.m),
        s: Object.fromEntries(maps.s),
        o: Object.fromEntries(maps.o),
      }));
    } catch { /* a full quota costs the mark's durability, never the drive */ }
  }

  const put = (kind: MarkKind, id: string, t: number): boolean => {
    if (!id || !Number.isFinite(t) || t <= 0) return false;
    const had = maps[kind].get(id);
    if (had !== undefined && had <= t) return false;   // latched, and earlier truth wins
    maps[kind].set(id, t);
    pending = pending || now();
    return true;
  };

  return {
    at: (kind, id) => maps[kind].get(id) ?? 0,
    has: (kind, id) => maps[kind].has(id),
    set(kind, id, at) { put(kind, id, at ?? stamp()); },
    dump(since) {
      const out: MarksDump = {};
      for (const kind of MARK_KINDS) {
        const rows: Record<string, number> = {};
        for (const [id, t] of maps[kind]) if (!since || t > since) rows[id] = t;
        if (Object.keys(rows).length) out[kind] = rows;
      }
      return out;
    },
    merge(rows) {
      let changed = 0;
      for (const kind of MARK_KINDS) {
        for (const [id, at] of Object.entries(rows?.[kind] ?? {})) {
          if (typeof id === 'string' && put(kind, id, Number(at))) changed++;
        }
      }
      return changed;
    },
    count: (kind) => maps[kind].size,
    reset() { for (const k of MARK_KINDS) maps[k].clear(); flush(); },
    tick(t) { if (pending && t - pending > MARKS_FLUSH_MS) flush(); },
    flush,
    dirty: () => !!pending,
  };
}

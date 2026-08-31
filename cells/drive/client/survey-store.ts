/**
 * WHAT A PLAYER HAS DRIVEN.
 *
 * The survey's memory, kept apart from the survey itself. `main.ts` holds the
 * roads that are LOADED — geometry, checkpoints, what is on screen — and that
 * set is a function of which vector tiles have streamed in. This holds what has
 * been COLLECTED, which is a function of everywhere the player has ever been.
 * Conflating the two deletes progress, and the deletion is silent:
 *
 *   A road spans several tiles and its fragments arrive independently. Drive
 *   all of Ou Kaapse Weg on Monday; on Tuesday spawn at one end and only half
 *   of it loads. Write the record out of the in-memory road and the other
 *   half's checkpoints are gone — not stale, gone, with nothing on screen to
 *   say so.
 *
 * So captures land HERE, and the road on screen reads from here. The store only
 * ever grows: it is never reconciled against what happens to be loaded.
 *
 * Shape, one record per road (`docs/drive-persistence.md` §5):
 *
 *   { v: 2, roads: { "<roadId>": { g, t, c?, k? } } }
 *
 *   g  checkpoints collected, best known         t  checkpoints the road has
 *   c  claimed at (epoch ms)                     k  the crumbs themselves
 *
 * `k` is kept only while a road is unclaimed, which is where the size goes: a
 * claimed road answers for all of its checkpoints with one number. `g`/`t` are
 * what a signed-in player would sync — counts, not crumbs — and they are
 * monotonic, so merging two devices is a max and never a conflict.
 */

/** Just the corner of `Storage` this needs, so a test can pass a Map. */
export interface StoreLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
export interface SurveyRec {
  /** Checkpoint keys — POSITIONS, not indices: a reload spawns a new origin and
   *  every local coordinate shifts, but a checkpoint's latitude does not. */
  got: Set<string>;
  /** Best known counts. Monotonic; kept for roads not loaded this session. */
  g: number; t: number;
  /** When it was claimed, 0 while unclaimed. Latched — a road never un-unlocks.
   *  `1` is the sentinel for a claim carried over from the v1 store, which
   *  recorded the name and not the moment. */
  done: number;
  /** Last capture, for shedding crumbs under the cap. */
  seen: number;
}
interface SurveyRow { g: number; t: number; c?: number; k?: string[] }

export const SURVEY_V = 2;
export const SURVEY_KEY = `drive.survey.v${SURVEY_V}`;
/** Crumbs kept across every road. */
export const SURVEY_CAP = 20000;
/** How long a capture may sit unwritten. A crumb is 250m of driving, so a few
 *  seconds of them is the most a crash can cost; a claim never waits. */
export const SURVEY_FLUSH_MS = 4000;
const V1_CP = 'drive.survey.cp';
const V1_DONE = 'drive.survey.done';

/**
 * ROAD IDENTITY.
 *
 * A road is `<name>@<cy>,<cx>` — its name plus the whole-degree cell it was
 * first seen in. Bare names were the bug: claiming one Main Street claimed
 * every Main Street that player would ever drive.
 *
 * The hard part is not telling two roads apart, it is NOT tearing one road in
 * half. A road's fragments arrive with the tiles, independently and in an order
 * set by where you spawned, so an id derived from "whichever fragment loaded
 * first" is a different id on Tuesday and the progress splits in two — with
 * nothing on screen to say so. Two things prevent that:
 *
 *   The cell is COARSE. A degree of latitude is ~111km, which is longer than
 *   almost any named road and far shorter than the distance between two cities
 *   that both have a Main Street.
 *
 *   The lookup is by NEIGHBOURHOOD, not by exact cell. A fragment joins any
 *   existing record of the same name within one cell in each direction, so
 *   driving in from the far end of a road that straddles a boundary finds the
 *   record that already exists rather than minting a second one. Only the first
 *   sighting mints, which is what makes the answer stable across sessions: the
 *   anchor is whatever is already stored, not whatever loaded first today.
 *
 * The trade is deliberate and one-sided. Two same-named roads within ~111km
 * merge into one record; a road longer than ~222km can still split. Merging
 * over-grants a claim, splitting LOSES one — so the error goes to the side that
 * never costs a player progress they earned.
 */
const CELL = 1;                       // degrees
const CELL_SPAN = Math.round(360 / CELL);
const cellOf = (lat: number, lon: number): [number, number] =>
  [Math.floor(lat / CELL), Math.floor(lon / CELL)];
/** Split `<name>@<cy>,<cx>`. A bare name — no cell — is a record from before
 *  roads had identity, and is treated as legacy rather than as a road called
 *  that in cell nowhere. */
function splitId(id: string): { name: string; cell: [number, number] | null } {
  const at = id.lastIndexOf('@');
  if (at < 0) return { name: id, cell: null };
  const m = /^(-?\d+),(-?\d+)$/.exec(id.slice(at + 1));
  return m ? { name: id.slice(0, at), cell: [Number(m[1]), Number(m[2])] } : { name: id, cell: null };
}
/** Are two cells neighbours? Longitude wraps — 179.5°E and 179.5°W are a
 *  degree apart, not 359. */
const near = (a: [number, number], b: [number, number]): boolean => {
  const dx = Math.abs(a[1] - b[1]);
  return Math.abs(a[0] - b[0]) <= 1 && Math.min(dx, CELL_SPAN - dx) <= 1;
};

export interface Survey {
  /** Every road with progress, loaded or not. Read-only to callers. */
  rec: Map<string, SurveyRec>;
  roadId(name: string, lat: number, lon: number): string;
  took(id: string, key: string): boolean;
  /** Has this road, HERE, any recorded progress at all — a checkpoint or a
   *  claim, this session or any before it? Read-only: unlike `roadId` it never
   *  mints an anchor, so the charts can ask about every road that streams past
   *  without polluting the identity index. */
  seen(name: string, lat: number, lon: number): boolean;
  take(id: string, key: string, total: number): void;
  claim(id: string, total: number): void;
  grew(id: string, total: number): void;
  claimed(id: string): boolean;
  /** Counts and claims touched since `since` — what a durable copy is made of.
   *  Never crumbs: see the head of `sync.ts`. */
  dump(since: number): Record<string, { g: number; t: number; c?: number }>;
  /** Fold a durable copy back in, union-and-max. Returns how many records it
   *  actually changed. */
  merge(rows: Record<string, { g: number; t: number; c?: number }>): number;
  tick(now: number): void;
  flush(): void;
  dirty(): boolean;
  stats(): { roads: number; claimed: number; crumbs: number; v1: number; bytes: number;
    dirty: boolean; top: Array<{ id: string; g: number; t: number; k: number; done: number }> };
}

export function openSurvey(opts: {
  store?: StoreLike | null;
  /** Monotonic clock, for the write debounce. */
  now?: () => number;
  /** Wall clock, for claim times that outlive the session. */
  stamp?: () => number;
} = {}): Survey {
  const store = opts.store === undefined
    ? (() => { try { return localStorage; } catch { return null; } })()
    : opts.store;
  const now = opts.now ?? (() => performance.now());
  const stamp = opts.stamp ?? (() => Date.now());

  const rec = new Map<string, SurveyRec>();
  /** v1 crumbs, whose road is unknown. Empties into `rec` as roads load. */
  const v1 = new Set<string>();
  let v1Shed = false;
  /** `now()` of the oldest unwritten change, 0 when clean. Collecting three
   *  checkpoints in one frame used to serialise the whole set three times; now
   *  it marks a time and the loop writes once. */
  let pending = 0;

  /** Anchors by name, so `roadId` can find an existing record without walking
   *  every road a player has ever driven. Minting adds to it immediately —
   *  two fragments of one road in adjacent cells must agree within a session
   *  as well as across them. */
  const byName = new Map<string, Array<{ id: string; cell: [number, number] }>>();
  const index = (id: string): void => {
    const { name, cell } = splitId(id);
    if (!cell) return;                              // legacy records anchor nowhere
    const list = byName.get(name);
    if (!list) byName.set(name, [{ id, cell }]);
    else if (!list.some((k) => k.id === id)) list.push({ id, cell });
  };

  const get = (k: string): string | null => { try { return store?.getItem(k) ?? null; } catch { return null; } };
  const recFor = (id: string): SurveyRec => {
    let r = rec.get(id);
    if (!r) { rec.set(id, (r = { got: new Set(), g: 0, t: 0, done: 0, seen: 0 })); index(id); }
    return r;
  };
  /**
   * The record this road had before roads had identity.
   *
   * Kept read-only and answered from, never re-keyed. Re-keying would have to
   * guess WHERE a bare name's progress was earned, and a wrong guess moves a
   * claim from the city it belongs to onto a road the player has never seen.
   * So old claims keep answering by name — exactly as broadly as they always
   * did, no worse — while every new claim is anchored.
   */
  const legacy = (id: string): SurveyRec | undefined => {
    const { name, cell } = splitId(id);
    return cell ? rec.get(name) : undefined;
  };

  // ── load ──
  try {
    const raw = JSON.parse(get(SURVEY_KEY) ?? 'null') as { roads?: Record<string, SurveyRow> } | null;
    for (const [id, row] of Object.entries(raw?.roads ?? {})) {
      const r = recFor(id);
      r.done = Number(row?.c) || 0;
      r.seen = r.done;
      r.t = Number(row?.t) || 0;
      for (const k of row?.k ?? []) if (typeof k === 'string') r.got.add(k);
      r.g = Math.max(Number(row?.g) || 0, r.got.size);
    }
  } catch { /* an unreadable store is the same as none — the drive still happens */ }
  // v1, read every boot. `drive.survey.done` is two kilobytes of the progress a
  // player would most regret and is never rewritten or removed: claims are a
  // union, so re-merging it costs nothing and keeps the old build's copy intact.
  try {
    for (const k of JSON.parse(get(V1_CP) ?? '[]') as string[]) if (typeof k === 'string') v1.add(k);
  } catch { /* fine */ }
  try {
    for (const n of JSON.parse(get(V1_DONE) ?? '[]') as string[]) {
      if (typeof n !== 'string') continue;
      const r = recFor(n);            // v1 ids were bare names, which is what `roadId` still returns
      if (!r.done) { r.done = 1; r.got.clear(); }
    }
  } catch { /* fine */ }

  function flush(): void {
    pending = 0;
    // The cap is a quota guard, not a rule of the game: it can only bite a
    // player part-way through thousands of roads at once. Shed the crumbs of
    // whichever have gone longest untouched — the COUNT survives, and the
    // checkpoints come back by driving them.
    let crumbs = 0;
    for (const r of rec.values()) crumbs += r.got.size;
    if (crumbs > SURVEY_CAP) {
      for (const r of [...rec.values()].sort((a, b) => a.seen - b.seen)) {
        if (crumbs <= SURVEY_CAP) break;
        crumbs -= r.got.size;
        r.got.clear();
      }
    }
    const roads: Record<string, SurveyRow> = {};
    for (const [id, r] of rec) {
      // A road merely seen is not progress — but anything HELD is, and the
      // guard must never be the thing that decides not to write a crumb.
      if (!r.g && !r.t && !r.done && !r.got.size) continue;
      // A pre-identity record whose crumbs have all found their anchored road,
      // and which was never claimed, has nothing left to say. Its counts are
      // superseded by the records that took them. Claimed ones stay forever:
      // they are the only answer an old claim has.
      if (!r.done && !r.got.size && !splitId(id).cell) continue;
      const row: SurveyRow = { g: r.g, t: r.t };
      if (r.done) row.c = r.done;
      else if (r.got.size) row.k = [...r.got];
      roads[id] = row;
    }
    try {
      store?.setItem(SURVEY_KEY, JSON.stringify({ v: SURVEY_V, roads }));
      // Only once the new store is safely down, and only when the old flat set
      // actually shrank — rewriting 140 KB on every flush is the write this
      // whole change exists to stop.
      if (v1Shed) {
        v1Shed = false;
        if (v1.size) store?.setItem(V1_CP, JSON.stringify([...v1]));
        else store?.removeItem(V1_CP);
      }
    } catch { /* a full quota costs progress, never the drive */ }
  }

  return {
    rec,
    /** This road, HERE — see ROAD IDENTITY at the head of the file. `lat`/`lon`
     *  is any point on the fragment being laid; which point it is does not
     *  matter, only which cell neighbourhood it falls in. */
    roadId(name: string, lat: number, lon: number): string {
      const cell = cellOf(lat, lon);
      for (const k of byName.get(name) ?? []) if (near(k.cell, cell)) return k.id;
      const id = `${name}@${cell[0]},${cell[1]}`;
      index(id);
      return id;
    },

    seen(name: string, lat: number, lon: number): boolean {
      const cell = cellOf(lat, lon);
      for (const k of byName.get(name) ?? []) {
        if (!near(k.cell, cell)) continue;
        const r = rec.get(k.id);
        if (r && (r.g > 0 || r.done)) return true;
      }
      // The record from before roads had identity answers by bare name,
      // exactly as broadly as its claim always did.
      const old = rec.get(name);
      return !!(old && (old.g > 0 || old.done));
    },

    /** Was this checkpoint collected in an earlier session? A claimed road
     *  answers for all of its checkpoints at once. */
    took(id: string, key: string): boolean {
      const r = rec.get(id);
      if (r && (r.done || r.got.has(key))) return true;
      /** Carry a crumb into this road's record and answer yes. */
      const adopt = (): true => {
        const r2 = recFor(id);
        r2.got.add(key);
        r2.g = Math.max(r2.g, r2.got.size);
        r2.seen = stamp();
        pending = pending || now();
        return true;
      };
      // The record from before roads had identity. Its CLAIM answers by name
      // and is never moved (see `legacy`), but a crumb carries its own position
      // — the checkpoint being laid is at that exact spot — so a crumb can be
      // moved onto the anchored record safely, and is.
      const old = legacy(id);
      if (old) {
        if (old.done) return true;
        if (old.got.delete(key)) return adopt();
      }
      // A v1 crumb had no road attached at all. The first road to lay a
      // checkpoint on that exact spot — ~1m — takes it, which is how the old
      // flat set empties itself: driven roads migrate as they load, and the key
      // goes when the last crumb finds its road.
      if (v1.delete(key)) { v1Shed = true; return adopt(); }
      return false;
    },
    take(id: string, key: string, total: number): void {
      const r = recFor(id);
      if (r.done) return;                         // a claimed road keeps no crumbs
      r.got.add(key);
      r.seen = stamp();
      r.g = Math.max(r.g, r.got.size);
      r.t = Math.max(r.t, total);
      pending = pending || now();
    },
    claim(id: string, total: number): void {
      const r = recFor(id);
      // A claimed road drops its crumbs. That is most of the size win and it
      // costs nothing: `took` answers for every checkpoint on it, so the road
      // reads DRIVEN, its markers stay down, and nothing re-pings when you
      // drive it again.
      r.done = stamp() || 1;
      r.got.clear();
      r.t = Math.max(r.t, total);
      r.g = r.t;
      r.seen = r.done;
      flush();                                    // rare, and the one thing worth losing nothing of
    },
    /** The road turned out to be longer than the store knew — another fragment
     *  landed. Worth remembering for a session where only half of it loads. */
    grew(id: string, total: number): void {
      const r = rec.get(id);
      if (!r || total <= r.t) return;
      r.t = total;
      if (r.done) r.g = total;
      pending = pending || now();
    },
    claimed: (id: string): boolean => !!rec.get(id)?.done || !!legacy(id)?.done,
    dump(since: number): Record<string, { g: number; t: number; c?: number }> {
      const out: Record<string, { g: number; t: number; c?: number }> = {};
      for (const [id, r] of rec) {
        if (!r.g && !r.t && !r.done) continue;
        // `seen` and `done` are wall-clock, which is what makes this answerable
        // at all: the watermark has to survive a reload, and a monotonic clock
        // does not. A record with neither is from before this was kept — send
        // it once rather than never.
        if (since && Math.max(r.seen, r.done) <= since) continue;
        out[id] = r.done ? { g: r.g, t: r.t, c: r.done } : { g: r.g, t: r.t };
      }
      return out;
    },
    merge(rows: Record<string, { g: number; t: number; c?: number }>): number {
      let changed = 0;
      for (const [id, row] of Object.entries(rows ?? {})) {
        if (!id || !row) continue;
        const g = Number(row.g) || 0, t = Number(row.t) || 0, c = Number(row.c) || 0;
        const r = recFor(id);
        let hit = false;
        // Union and max, in both directions — progress only ever goes up, so
        // this is the whole of the merge and it needs no clock to be correct.
        if (g > r.g) { r.g = g; hit = true; }
        if (t > r.t) { r.t = t; hit = true; }
        // A claim is latched, so the interesting question is not whether but
        // WHEN — and the truth is the first time it happened.
        if (c && (!r.done || c < r.done)) { r.done = c; hit = true; }
        if (r.done) { r.got.clear(); r.g = Math.max(r.g, r.t); }
        if (hit) { r.seen = Math.max(r.seen, c || r.seen); changed++; }
      }
      if (changed) pending = pending || now();
      return changed;
    },
    tick(t: number): void { if (pending && t - pending > SURVEY_FLUSH_MS) flush(); },
    flush,
    dirty: (): boolean => !!pending,
    stats() {
      let crumbs = 0, claimed = 0;
      for (const r of rec.values()) { crumbs += r.got.size; if (r.done) claimed++; }
      return {
        roads: rec.size, claimed, crumbs, v1: v1.size, dirty: !!pending,
        bytes: (get(SURVEY_KEY) ?? '').length,
        top: [...rec.entries()].sort((a, b) => b[1].g - a[1].g).slice(0, 8)
          .map(([id, r]) => ({ id, g: r.g, t: r.t, k: r.got.size, done: r.done })),
      };
    },
  };
}

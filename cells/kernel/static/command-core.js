/**
 * @c15r/kernel/command-core — the HEADLESS command-surface engine shared by
 * every palette-shaped UI (home's field computer, canvas's cmd-palette; owner
 * direction 2026-07-10: "consolidate and refine").
 *
 * The two palettes shared IDEAS — search-first command list, fuzzy matching,
 * MRU recents as the empty state, wrap-around ↑/↓/Enter — but zero code, and
 * their behaviours had drifted (different scoring, one had recents, the other
 * didn't). This module owns the SEMANTICS; each host keeps its own rendering
 * (React over ink / vanilla DOM over the canvas shell) and its own item
 * sourcing and execution. Framework-free on purpose.
 *
 * Served verbatim at /@c15r/kernel/command-core.js; `cell-sync push` overlays
 * it into a cell as `vendor/command-core.js` when the cell references it
 * (ADR-0076's vendoring seam). Git truth: cells/kernel/static/command-core.js.
 */

/**
 * Subsequence match: every query char appears in `text`, in order. The
 * cheapest useful "did the user mean this" test — both palettes converged on
 * it independently. Case is the CALLER's concern (pass lowercased both sides).
 * @param {string} text
 * @param {string} q
 * @returns {boolean}
 */
export function fuzzyMatch(text, q) {
  let ti = 0;
  let qi = 0;
  while (ti < text.length && qi < q.length) {
    if (text[ti] === q[qi]) qi++;
    ti++;
  }
  return qi === q.length;
}

/**
 * One shared scoring model (the refinement both hosts adopt):
 *   - null            — not even a subsequence: not a match at all.
 *   - substring tier  — 500 base, +100 when the hit starts a word, minus the
 *                       hit's position and a small length penalty (a short
 *                       label that leads with the query wins).
 *   - subsequence tier— the canvas model (+2 per matched char, −0.5 per skip),
 *                       which caps well below the substring tier, so scattered
 *                       matches never outrank real ones.
 * @param {string} text lowercased haystack
 * @param {string} q lowercased query
 * @returns {number | null} higher = better, null = no match
 */
export function matchScore(text, q) {
  if (!q) return null;
  const idx = text.indexOf(q);
  if (idx >= 0) {
    const wordStart = idx === 0 || /[\s./:_-]/.test(text[idx - 1]);
    return 500 + (wordStart ? 100 : 0) - idx - 0.5 * text.length;
  }
  let ti = 0;
  let qi = 0;
  let score = 0;
  while (ti < text.length && qi < q.length) {
    if (text[ti] === q[qi]) {
      score += 2;
      qi++;
    } else {
      score -= 0.5;
    }
    ti++;
  }
  return qi === q.length && score > 0 ? score : null;
}

/**
 * Rank a pool against a query: score via `matchScore`, drop non-matches, sort
 * best-first (stable — equal scores keep pool order), cap at `limit`.
 * @template T
 * @param {T[]} items
 * @param {string} query lowercased
 * @param {{ textOf?: (item: T) => string, limit?: number }} [opts]
 * @returns {T[]}
 */
export function rankItems(items, query, opts = {}) {
  const textOf = opts.textOf ?? ((it) => /** @type {any} */ (it).searchText ?? '');
  const limit = opts.limit ?? 12;
  /** @type {Array<[T, number, number]>} */
  const scored = [];
  for (let i = 0; i < items.length; i++) {
    const s = matchScore(textOf(items[i]), query);
    if (s !== null) scored.push([items[i], s, i]);
  }
  scored.sort((a, b) => b[1] - a[1] || a[2] - b[2]);
  return scored.slice(0, limit).map(([it]) => it);
}

/**
 * MRU recents, persisted, resolved against the LIVE pool on read (an id whose
 * item no longer exists — or is currently guarded off — silently drops, the
 * canvas palette's discipline). Storage is injected so tests (and non-browser
 * hosts) don't need a real localStorage; all storage failures are swallowed —
 * recents are a convenience, never worth an exception.
 * @param {{ key: string, limit?: number, storage?: { getItem(k: string): string | null, setItem(k: string, v: string): void } }} opts
 */
export function createRecents(opts) {
  const limit = opts.limit ?? 5;
  const storage = opts.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  /** @type {string[]} */
  let ids = [];
  try {
    const raw = storage?.getItem(opts.key);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) ids = parsed.filter((x) => typeof x === 'string').slice(0, limit);
  } catch {
    /* fresh */
  }
  return {
    /** The raw MRU ids, newest first. @returns {string[]} */
    ids: () => [...ids],
    /**
     * The recent ITEMS still present in the live pool, MRU order.
     * @template T
     * @param {T[]} pool
     * @param {(item: T) => string} idOf
     * @returns {T[]}
     */
    resolve(pool, idOf) {
      const byId = new Map(pool.map((it) => [idOf(it), it]));
      return ids.map((id) => byId.get(id)).filter((it) => it !== undefined);
    },
    /** Record a use: promote to front, dedupe, trim, persist. @param {string} id */
    add(id) {
      ids = [id, ...ids.filter((x) => x !== id)].slice(0, limit);
      try {
        storage?.setItem(opts.key, JSON.stringify(ids));
      } catch {
        /* storage full/blocked — in-memory MRU still works this session */
      }
    },
  };
}

/**
 * Wrap-around selection stepping for ↑/↓ — the reducer both palettes
 * hand-rolled. A selection of -1 (nothing selected) steps onto the first or
 * last item; an empty list stays at -1.
 * @param {number} sel current index (-1 = none)
 * @param {number} delta +1 / -1
 * @param {number} length list length
 * @returns {number}
 */
export function stepSelection(sel, delta, length) {
  if (length <= 0) return -1;
  if (sel < 0) return delta > 0 ? 0 : length - 1;
  return (sel + delta + length) % length;
}

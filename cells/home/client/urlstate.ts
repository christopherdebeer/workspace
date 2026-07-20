/* ---------------------------------------------------------------------------
 * urlstate.ts — the view as a shareable link.
 *
 * A tiny read/merge/write over the URL hash so a deep-link can restore WHERE you
 * were: which star is selected, how curled the sky is (zoom), and any active
 * query. Read once on load to override the default landing (§ graph frameInitial);
 * written — merged, via replaceState so it never spams the back button — as each
 * of those changes. All access is guarded: `location`/`history` are absent during
 * SSR, and a restored value is only ever a hint (a stale key just selects
 * nothing). Keys: `selected` (fact key), `zoom` (0..3 curl axis), `q` (query).
 * ------------------------------------------------------------------------- */
export interface HashState {
  selected?: string;
  zoom?: number;
  q?: string;
}

export function readHashState(): HashState {
  try {
    const raw = location.hash.replace(/^#/, '');
    if (!raw) return {};
    const p = new URLSearchParams(raw);
    const st: HashState = {};
    const sel = p.get('selected');
    if (sel) st.selected = sel;
    const z = p.get('zoom');
    if (z) { const n = Number(z); if (Number.isFinite(n)) st.zoom = n; }
    const q = p.get('q');
    if (q) st.q = q;
    return st;
  } catch { return {}; }
}

/** Merge `patch` into the current hash and write it back. An explicit `undefined`
 *  in `patch` clears that key; omit a key to leave it untouched. */
export function writeHashState(patch: Partial<HashState>): void {
  try {
    const next: HashState = { ...readHashState(), ...patch };
    const p = new URLSearchParams();
    if (next.selected) p.set('selected', next.selected);
    if (next.zoom != null && Number.isFinite(next.zoom)) p.set('zoom', String(Math.round(next.zoom * 100) / 100));
    if (next.q) p.set('q', next.q);
    const s = p.toString();
    history.replaceState(history.state, '', location.pathname + location.search + (s ? '#' + s : ''));
  } catch { /* SSR / restricted — the URL just doesn't track, no harm */ }
}

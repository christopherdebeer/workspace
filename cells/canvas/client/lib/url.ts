/* ---------------------------------------------------------------------------
 *  url.ts — canvas URLs are PATH-based (ADR): the board lives in the path
 *  (`/@<owner>/canvas/<board>`, or `/<board>` on a cell host), not a `?canvas=`
 *  query. The win is structural: the kernel's OAuth round-trip uses
 *  `redirect_uri = origin + pathname`, so a board in the path survives sign-in
 *  intact — whereas the old `?canvas=` was dropped on the return and you landed
 *  on the default board. Frame/view/embed stay query modifiers.
 *
 *  This module is the ONE place that reads/writes the board↔URL mapping, so the
 *  scheme (and the mount-prefix maths) lives in a single spot.
 * ------------------------------------------------------------------------- */

/** The cell mount prefix for the current origin: `/@<owner>/canvas` on the apex,
 *  or `''` on a cell host (board sits at the root). Derived from the live path so
 *  it's correct on whichever host served us. */
export function canvasBase(): string {
  const m = location.pathname.match(/^\/@[^/]+\/[^/]+/);
  return m ? m[0] : '';
}

/** The board id encoded in the path, or null when there isn't one (the bare
 *  mount, or a reserved asset). `?canvas=` is still honoured by the caller as a
 *  legacy fallback, but the server 301s those to the path form. */
export function boardFromPath(): string | null {
  const base = canvasBase();
  const rest = location.pathname.slice(base.length).replace(/^\/+|\/+$/g, '');
  if (!rest) return null;
  const seg = rest.split('/')[0];
  if (!seg || seg === 'app.js' || seg === 'style.css') return null;
  try { return decodeURIComponent(seg); } catch { return seg; }
}

/** Build the canonical path URL for a board (optionally carrying query, e.g.
 *  `?embed=1`). Used for drill in/up and any share/navigation link. */
export function canvasPath(board: string, query = ''): string {
  const q = query && !query.startsWith('?') ? `?${query}` : query;
  return `${canvasBase()}/${encodeURIComponent(board)}${q}`;
}

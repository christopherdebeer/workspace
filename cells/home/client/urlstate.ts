/* ---------------------------------------------------------------------------
 * urlstate.ts — the view as a shareable link (ADR-0090: the fact address is a
 * PATH).
 *
 * The selected fact is CONTENT IDENTITY → it lives in the path (`/r/<key>`,
 * the canonical, server-visible fact address — SSR can seed it on refresh).
 * zoom/rot/q are VIEW CONFIG → they live in the query string (also server-
 * visible, so a shared link's first render matches). The legacy hash form
 * (`#selected=…&zoom=…`) is still READ as a fallback so pre-migration links
 * keep restoring, but is never written back — the first write upgrades the
 * URL in place. All access is guarded (`location`/`history` absent in SSR),
 * and a restored value is only ever a hint. Unrelated query params (`debug`)
 * are preserved verbatim.
 * ------------------------------------------------------------------------- */
export interface HashState {
  selected?: string;
  zoom?: number;
  /** Shell orientation (quaternion x,y,z,w) — the other half of "where you are
   *  looking": zoom is how curled the sky is, `rot` is which way it's turned.
   *  Together they fully restore a free-look view; selection re-derives its own. */
  rot?: number[];
  q?: string;
}

/** Fact key ↔ path segment coding (the ADR-0040 / lit contract): `/` and `:`
 *  stay literal (the substrate's own separators), every other segment
 *  percent-encoded/-decoded. */
export function encodeKeyPath(key: string): string {
  return key.split('/').map((s) => encodeURIComponent(s).replace(/%3A/gi, ':')).join('/');
}
export function decodeKeyPath(path: string): string {
  return path.split('/').map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  }).join('/');
}

/** The parsed legacy hash — read-only fallback for pre-migration links. */
function readLegacyHash(): HashState {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return {};
  const p = new URLSearchParams(raw);
  const st: HashState = {};
  const sel = p.get('selected');
  if (sel) st.selected = sel;
  const z = p.get('zoom');
  if (z) { const n = Number(z); if (Number.isFinite(n)) st.zoom = n; }
  const rot = p.get('rot');
  if (rot) { const a = rot.split(',').map(Number); if (a.length === 4 && a.every(Number.isFinite)) st.rot = a; }
  const q = p.get('q');
  if (q) st.q = q;
  return st;
}

export function readHashState(): HashState {
  try {
    const st: HashState = {};
    // Content identity: the /r/<key> path.
    const m = location.pathname.match(/^\/r\/(.+)$/);
    if (m) st.selected = decodeKeyPath(m[1]);
    // View config: the query string.
    const p = new URLSearchParams(location.search);
    const z = p.get('zoom');
    if (z) { const n = Number(z); if (Number.isFinite(n)) st.zoom = n; }
    const rot = p.get('rot');
    if (rot) { const a = rot.split(',').map(Number); if (a.length === 4 && a.every(Number.isFinite)) st.rot = a; }
    const q = p.get('q');
    if (q) st.q = q;
    // Legacy hash fallback: fills only what path/query didn't provide.
    const legacy = readLegacyHash();
    return { ...legacy, ...st };
  } catch { return {}; }
}

/** Merge `patch` into the current state and write it back as path + query via
 *  replaceState (never spams the back button). An explicit `undefined` in
 *  `patch` clears that key; omit a key to leave it untouched. */
export function writeHashState(patch: Partial<HashState>): void {
  try {
    const next: HashState = { ...readHashState(), ...patch };
    const path = next.selected ? `/r/${encodeKeyPath(next.selected)}` : '/';
    // Preserve unrelated query params (`debug`, …) — own only zoom/rot/q.
    const p = new URLSearchParams(location.search);
    if (next.zoom != null && Number.isFinite(next.zoom)) p.set('zoom', String(Math.round(next.zoom * 100) / 100));
    else p.delete('zoom');
    if (next.rot && next.rot.length === 4) p.set('rot', next.rot.map((v) => Math.round(v * 1000) / 1000).join(','));
    else p.delete('rot');
    if (next.q) p.set('q', next.q);
    else p.delete('q');
    const s = p.toString();
    // The hash is retired: any legacy fragment is consumed (it was folded into
    // `next` above) and dropped from the written URL.
    history.replaceState(history.state, '', path + (s ? '?' + s : ''));
  } catch { /* SSR / restricted — the URL just doesn't track, no harm */ }
}

/**
 * The shared PURE VIEWERS (@c15r/viewers), hosted in home.
 *
 * json tree / csv table / mermaid / style — one validated implementation, the
 * same module canvas re-exports and lit's fences import. Home consumes it the
 * same way (dynamic import of the cell's ESM face), rather than re-hand-rolling
 * a JSON dump — so a structured/undeclared fact reads as a real tree, not a
 * raw stringify. Lazy + cached: the ~18KB module loads only when a viewer is
 * actually needed (never on the SSR path — this mounts in an effect).
 *
 * Split out of `facts.tsx` (ADR-0044 Inc 5 lineage) so `safe-markdown` can
 * mount a viewer for a FENCE without importing the fact surface — the fence
 * and the whole-fact hint now reach the same implementation, which is the
 * inconsistency docs/home-hosts-lit.md names: a mermaid fact rendered live and
 * the identical mermaid fence rendered as dead code.
 */
import * as React from 'react';

const { useState, useEffect } = React;

const VIEWERS_URL = 'https://parc.land/@c15r/viewers/app.js';
type ViewersModule = { renderFence: (host: HTMLElement, lang: string, code: string) => boolean };
let viewersMod: Promise<ViewersModule> | null = null;
const loadViewers = (): Promise<ViewersModule> =>
  (viewersMod ??= import(/* @vite-ignore */ VIEWERS_URL) as Promise<ViewersModule>);

/** The viewer langs home mounts for DISPLAY. Deterministic, secretless, no
 *  substrate access — safe on the guest-exposed apex. `repl` is deliberately
 *  absent: it executes, and execution belongs to lit's trust context. */
export const DISPLAY_VIEWERS = new Set(['json', 'csv', 'mermaid', 'style']);

/** Mount a pure viewer (json/csv/mermaid/style) for a string body, via the
 *  shared @c15r/viewers module. Imperative host (like the graph): React owns
 *  the wrapper, the viewer owns the inner DOM. Degrades to a <pre> if the
 *  module can't load (offline) so content is never lost. */
export function ViewerBody({ lang, code }: { lang: string; code: string }): React.JSX.Element {
  const host = React.useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let live = true;
    loadViewers()
      .then((v) => { if (live && el) v.renderFence(el, lang, code); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (el) el.innerHTML = ''; };
  }, [lang, code]);
  if (failed) return <pre style={{ maxWidth: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.8rem' }}>{code}</pre>;
  return <div ref={host} style={{ maxWidth: '100%', overflow: 'auto' }} />;
}

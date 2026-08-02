/**
 * Home's markdown surface — now a THIN WRAPPER over the shared @parc/ui
 * sanitized renderer core (docs/home-hosts-lit.md step 2: "safe-markdown.tsx
 * shrinks to the FactLink wiring"). The token→element renderer, the URL
 * allowlist, the wiki-link rule, and the fence meta-grammar all live in
 * `platform/ui/safe-markdown.tsx` + `platform/ui/fence.ts` — one core, so home
 * and lit classify a fence identically and the apex stops rendering lit fences
 * as dead code blocks.
 *
 * What stays here is exactly home's wiring:
 *  - the `marked` engine at home's own pin, with the shared wiki tokenizer;
 *  - corpus-relative `*.md` → `doc:` resolution (doc-links.ts);
 *  - the STATIC-SAFE fence viewers (step 4): mermaid/csv/json/style render as
 *    real diagrams/tables via the shared @c15r/viewers module — display, not
 *    execution. Everything else renders as the core's fence DECLARATION
 *    (chip row + static body); the live ladder stays in lit.
 */
import * as React from 'react';
import { marked } from 'marked';
import {
  createSafeMarkdown,
  wikiLinkTokenExtension,
  safeNavigationUrl,
  safeImageUrl,
  safeFrameUrl,
  type MdOpts,
  type FenceContext,
} from '@parc/ui';
import { resolveDocHref } from './doc-links';

export { resolveDocHref, safeNavigationUrl, safeImageUrl, safeFrameUrl };
export type { MdOpts };

const { useState, useEffect } = React;

/** The `[[wiki-link]]` tokenizer, registered once on home's marked — the
 *  SHARED one (resolveWikiTarget), so a bare `[[Some Title]]` slugs to
 *  `doc:some-title` here exactly as it does in lit and the card. */
marked.use({ extensions: [wikiLinkTokenExtension()] } as Parameters<typeof marked.use>[0]);

// ─── the shared PURE VIEWERS (@c15r/viewers) ───────────────────────
// json tree / csv table / mermaid / style — one validated implementation, the
// same module canvas re-exports and lit's fences import. Lazy + cached: loads
// only when a viewer is actually needed (never on the SSR path — mounts in an
// effect). Trusted-by-pin (first-party module, not a federated renderer).
const VIEWERS_URL = 'https://parc.land/@c15r/viewers/app.js';
type ViewersModule = { renderFence: (host: HTMLElement, lang: string, code: string) => boolean };
let viewersMod: Promise<ViewersModule> | null = null;
const loadViewers = (): Promise<ViewersModule> =>
  (viewersMod ??= import(/* @vite-ignore */ VIEWERS_URL) as Promise<ViewersModule>);

/** Mount a pure viewer (json/csv/mermaid/style) for a string body. Imperative
 *  host (like the graph): React owns the wrapper, the viewer owns the inner
 *  DOM. Degrades to a <pre> if the module can't load, so content is never lost. */
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

/** Static-safe fence rendering (home-hosts-lit step 4): a fence whose lang (or
 *  `viewer=` attr) names a pure display viewer renders as the real thing —
 *  display only. Output cells and transclusions keep the core's declaration
 *  render (execution/resolution belong to lit's trust context, not the apex). */
const VIEWER_LANGS = new Set(['mermaid', 'csv', 'json', 'style']);
function homeFence({ meta, code }: FenceContext): React.ReactNode | undefined {
  if (meta.isOutput || meta.source || meta.output) return undefined;
  const viewer = meta.attrs.viewer && VIEWER_LANGS.has(meta.attrs.viewer)
    ? meta.attrs.viewer
    : VIEWER_LANGS.has(meta.lang) ? meta.lang : null;
  if (!viewer || !code.trim()) return undefined;
  return <ViewerBody lang={viewer} code={code} />;
}

const core = createSafeMarkdown({
  lexer: (src) => marked.lexer(src),
  lexInline: (src) => marked.Lexer.lexInline(src),
});

/** Render ONE LINE of markdown INLINE — titles/headlines (see the core). */
export function InlineMarkdown(props: { text: string } & MdOpts): React.JSX.Element {
  return <core.InlineMarkdown {...props} />;
}

export function SafeMarkdown(props: { text: string } & MdOpts): React.JSX.Element {
  return (
    <core.SafeMarkdown
      tone="light"
      {...props}
      resolveDocHref={props.resolveDocHref ?? resolveDocHref}
      renderFence={props.renderFence ?? homeFence}
    />
  );
}

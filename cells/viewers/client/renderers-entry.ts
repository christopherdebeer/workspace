/**
 * ADR-0044 Inc 4 (≡ ADR-0039 Inc 3 ≡ ADR-0043 Inc 2b): the viewers cell's
 * `ui://` FACE. This entry wraps the SAME pure viewer implementations
 * (./main's json/csv/mermaid — reference, not copy) as self-registering
 * `window.__parcRender` renderers, so the conversation card consumes them
 * over the federation hop (`ui://@c15r/viewers/renderers.js`, resolved by the
 * gateway's `resolveCellRenderer`) instead of the build-time cross-cell
 * import it used to carry (`services/gateway/client/main.ts` importing
 * `cells/viewers/client/main` — the dead rung this removes).
 *
 * Built as a CLASSIC IIFE (not a module): `fetchAndRunRenderer` injects the
 * source as an inline <script>, inside a sandbox whose CSP has no parc.land —
 * so the script must be self-contained (mermaid still lazy-loads from
 * jsDelivr, which the card's CSP allows). Regenerate `renderers.gen.ts` with
 * `node scripts/build-viewers-renderers.mjs` after editing this or ./main.
 */
import { json, csv, mermaid } from './main';

type RendererApi = { call: (kind: 'read' | 'act', target: string, input: unknown) => Promise<unknown>; esc: (s: unknown) => string; md: (s: string) => string; key?: string };
type RendererFn = (host: HTMLElement, value: unknown, api: RendererApi) => void;

/** The content string a viewer consumes, derived from a raw fact value — the
 *  same derivation the card's old `viewerContent` did before mounting. */
function contentFor(name: string, value: unknown): string {
  if (name === 'json') return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (typeof value === 'string') return value;
  const v = value as { content?: unknown; text?: unknown; body?: unknown } | null;
  for (const k of ['content', 'text', 'body'] as const) {
    if (v && typeof v[k] === 'string') return v[k] as string;
  }
  return JSON.stringify(value, null, 2);
}

let seq = 0;
const wrap = (name: string, view: { mount(el: { id: string; content: string }): HTMLElement }): RendererFn =>
  (host, value) => {
    host.innerHTML = '';
    host.appendChild(view.mount({ id: `vwr-${name}-${++seq}`, content: contentFor(name, value) }));
  };

const w = window as unknown as { __parcRender?: Record<string, RendererFn> };
const reg = (w.__parcRender = w.__parcRender || {});
reg.json = wrap('json', json);
reg.csv = wrap('csv', csv);
reg.mermaid = wrap('mermaid', mermaid);

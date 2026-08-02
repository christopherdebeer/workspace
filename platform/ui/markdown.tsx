/**
 * The markdown renderer CORE (docs/home-hosts-lit.md step 1).
 *
 * One token→React renderer, shared by every surface that shows a fact body.
 * It moved here from `cells/home/client/safe-markdown.tsx`, which was one of
 * three copies: lit rendered owner-trusted content as HTML strings, home
 * rendered guest-exposed content as React elements, and `@parc/ui` held only
 * fragments (`wikiLinkExtension`, `bodyText`). Two renderers drift — the
 * task-checkbox bug lived in exactly one of them — and, worse, only one of
 * them knew the fence grammar, so a `>toc`, a transclusion, or a mermaid
 * diagram rendered live in lit and as dead code on the apex.
 *
 * The REACT one is the core, deliberately: home is guest-exposed at the apex,
 * so the shared floor must be the posture that sanitizes URLs and never uses
 * `dangerouslySetInnerHTML`. Surfaces that want more layer it on top.
 *
 * Two things stay OUT of this module, by contract:
 *   - `marked` — injected. Callers own the marked instance (and its pin), pass
 *     tokens in. `@parc/ui` is pre-bundled with React external and everything
 *     else runtime-provided (see parc-ui.ts), so a bare `marked` import here
 *     would not resolve in a deployed cell.
 *   - EXECUTION — a fence renders as a DECLARATION (its chips + a static body,
 *     plus the display-only viewers a host opts into). Running a repl, an
 *     agent, or an author-registered viewer belongs to the editor's trust
 *     context, which is lit. The reader shows what a block declares itself to
 *     be; it does not become it.
 */
import * as React from 'react';
import { parseFenceMeta, type FenceMeta } from './fence';
import { resolveWikiTarget, type WikiTarget } from './wiki-link';

/** A `marked` token. Structural on purpose — this module never imports marked,
 *  so the shape is duck-typed rather than named. */
export type MdToken = Record<string, any>;

// Code/HTML blocks must not force the content body wider than its container.
// WRAP rather than scroll: a scrolling <pre> only stays bounded if min-width:0
// holds through EVERY flex/grid ancestor — one miss and it blows out again.
// Wrapping never establishes a wide intrinsic width, so it's robust regardless
// of the container stack. white-space:pre-wrap keeps indentation/newlines while
// wrapping long lines; overflow-wrap:anywhere breaks unbreakable tokens (URLs,
// long paths).
const PRE_STYLE: React.CSSProperties = { maxWidth: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

// marked emits HTML-ESCAPED text on its leaf tokens (`text`, `codespan`,
// image alt) — `agent's` becomes `agent&#39;s`, `a & b` becomes `a &amp; b`.
// React renders a string verbatim (it does NOT decode entities in text
// content), so those escapes would show literally. We decode the fixed set
// marked produces, plus the common named/numeric forms, so authored punctuation
// reads correctly. SSR-safe (pure string work — no DOM). NOT applied to fenced
// code blocks (marked leaves those raw, so a literal `&amp;` there is intended)
// nor to raw HTML passthrough. `&amp;` is decoded LAST so `&amp;lt;` → `&lt;`.
export function decodeEntities(s: string): string {
  if (!s || s.indexOf('&') === -1) return s;
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function cleanUrl(raw: unknown, mode: 'nav' | 'image' | 'frame'): string | null {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || /[\u0000-\u001f\u007f]/.test(s)) return null;
  if ((s.startsWith('/') && !s.startsWith('//')) || s.startsWith('./') || s.startsWith('../') || s.startsWith('#') || s.startsWith('?')) return s;
  if (mode === 'image' && /^data:image\/(?:png|gif|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.protocol === 'https:') return s;
    if (mode === 'nav' && u.protocol === 'mailto:') return s;
  } catch {
    return null;
  }
  return null;
}

export const safeNavigationUrl = (raw: unknown): string | null => cleanUrl(raw, 'nav');
export const safeImageUrl = (raw: unknown): string | null => cleanUrl(raw, 'image');
export const safeFrameUrl = (raw: unknown): string | null => cleanUrl(raw, 'frame');

/** Resolve a corpus-relative `*.md` href against the rendering doc's directory
 *  — supplied by the host (home's `doc-links`), since the corpus layout is the
 *  host's knowledge, not the renderer's. */
export type DocHrefResolver = (href: string, base?: string) => string | null;

/**
 * A fence's location in the SOURCE markdown — what makes fence-grain editing
 * possible at all. `body` is the range of the fenced content between the fence
 * lines; `block` covers the whole fence including them. A host splices an
 * edited body straight back into the owning fact's text:
 *
 *   md.slice(0, body.from) + next + md.slice(body.to)
 *
 * Only TOP-LEVEL fences carry a range. A fence nested in a list or blockquote
 * has no reliable offset (marked's nested `raw` doesn't reconstruct the source
 * byte-for-byte through container tokens), and editing against a wrong offset
 * would corrupt the document — so those render read-only rather than guess.
 */
export interface FenceRange {
  body: { from: number; to: number };
  block: { from: number; to: number };
}

/** What a host may do with a fence beyond the static floor. Returning `null`
 *  (or omitting the hook) falls back to chips + `<pre>` — the declaration,
 *  legibly, which is always a correct rendering. */
export interface FenceRender {
  (ctx: { meta: FenceMeta; body: string; opts: MdOpts; range: FenceRange | null }): React.ReactNode | null;
}

/** Extra chrome for a fence's chip row (a host's edit affordance). */
export interface FenceActions {
  (ctx: { meta: FenceMeta; body: string; range: FenceRange | null }): React.ReactNode | null;
}

/** Options threaded through the renderer (all optional — plain rendering
 *  without them is byte-identical to the pre-share behaviour). */
export interface MdOpts {
  /** The rendering doc's corpus directory (e.g. `docs/architecture/adr`) —
   *  what relative `*.md` hrefs resolve against. */
  base?: string;
  /** Open a fact key in place (e.g. home's openFact). Absent → href-only.
   *  `fragment` is `[[key#member]]`'s section address (ADR-0061). */
  onFactLink?: (key: string, fragment?: string) => void;
  /** The href for a fact key. The default relative `/r/<key>` only resolves at
   *  the apex — a host served from a cell subdomain passes an origin-aware
   *  resolver (home: `localize`) so new-tab/middle-click stays navigable. */
  factHref?: (key: string) => string;
  /** The surface this reads on. 'dark' = the ink palette (graph palette,
   *  bottom-sheet peek); 'light' = the cream trailhead. Only swaps colours. */
  tone?: 'light' | 'dark';
  /** Corpus-relative doc-link resolution (host-supplied). */
  resolveDocHref?: DocHrefResolver;
  /** A host's richer fence rendering (display-only viewers, embeds). */
  renderFence?: FenceRender;
  /** Extra chrome in a fence's chip row — a host's edit affordance. */
  fenceActions?: FenceActions;
  /** Suppress the fence chip row (a host that draws its own). */
  hideFenceChips?: boolean;
  /** Nested markdown → tokens. Required for ```md fences to render as
   *  markdown rather than code; the host owns the marked instance. */
  lex?: (md: string) => MdToken[];
}

/**
 * A link to a fact. `fragment` (ADR-0061 `[[key#member]]`) addresses a section
 * WITHIN the target — it rides the href so a new tab lands in the right place,
 * and is handed to `onFactLink` so an in-place host can scroll to it (home's
 * `openFact(entry, anchor)` already takes exactly this). It used to be parsed
 * and then dropped, so every `[[doc:x#section]]` opened at the top.
 */
function FactLink({ factKey, fragment, children, o }: { factKey: string; fragment?: string; children: React.ReactNode; o: MdOpts }): React.JSX.Element {
  const { onFactLink, factHref } = o;
  const base = factHref ? factHref(factKey) : `/r/${factKey}`;
  return (
    <a
      href={fragment ? `${base}#${encodeURIComponent(fragment)}` : base}
      title={fragment ? `${factKey}#${fragment}` : factKey}
      style={{ textDecorationStyle: 'dotted', textUnderlineOffset: '2px' }}
      onClick={onFactLink ? (ev) => { ev.preventDefault(); onFactLink(factKey, fragment); } : undefined}
    >
      {children}
    </a>
  );
}

/** A wiki-link token's destination. The token carries a resolved target when it
 *  came from `wikiLinkTokenExtension`; a token from another tokenizer (or a
 *  bare `text`) is resolved here, so the slug rule can't fork by entry point. */
function wikiTargetOf(t: MdToken): WikiTarget {
  if (typeof t.key === 'string') return { key: t.key, label: String(t.label ?? t.key), fragment: t.fragment };
  return resolveWikiTarget(String(t.text ?? t.raw ?? ''));
}

/* ── fences: the declaration, rendered ─────────────────────────────────────
 * dotlit's insight (docs/dotlit-review.md §1) is that the fence line IS the
 * artifact's plain-text vocabulary — `viewer=`, `repl=`, `!collapse`, `#tag`,
 * `< in`, `> out`. A reader that drops it to `language-js` throws away the
 * declaration and shows only the payload. So: chips first (what this block
 * SAYS it is), then the body. */

/** dotlit's admonition directives (styling_and_themes.lit §dir-*): an `md`
 *  fence carrying one renders as a coloured callout, not code. */
const ADMONITIONS = ['warn', 'info', 'success', 'error', 'note', 'box'];

/** Attrs that are provenance noise in a chip row (lit's `addFenceChips`). */
const NOISY_ATTRS = new Set(['attached', 'updated']);

const chipHue = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

/** The fence's declaration as a chip row — the same vocabulary and class names
 *  lit's `addFenceChips` emits (ADR-0063 gem 1), so one stylesheet dresses
 *  both surfaces and a fence looks the same wherever it is read. */
export function FenceChips({ meta, o, actions }: { meta: FenceMeta; o: MdOpts; actions?: React.ReactNode }): React.JSX.Element | null {
  const attrs = Object.entries(meta.attrs).filter(([k, v]) => !NOISY_ATTRS.has(k) && v !== 'true');
  const hasMeta = meta.isOutput || meta.directives.length > 0 || meta.tags.length > 0 || attrs.length > 0 || !!meta.source || !!meta.output || !!meta.file;
  // A bare fence carries no declaration to draw — but if the host offered an
  // action (an edit affordance) the row still has to exist to hold it.
  if ((!hasMeta && !actions) || meta.directives.includes('hidemeta')) return null;
  const chip = (cls: string, text: string, colored = true, node?: React.ReactNode): React.JSX.Element => (
    <span key={`${cls}:${text}`} className={`fchip ${cls}`} style={colored ? { borderLeftColor: `hsl(${chipHue(text)} 45% 55%)` } : undefined}>
      {node ?? text}
    </span>
  );
  const src = meta.fromSource;
  // A source that names a fact key is itself navigable — the transclusion's
  // provenance is a link, not a label.
  const srcIsFact = !!src && /[:/]/.test(src) && !/^https?:|^\/\//.test(src);
  return (
    <div className="fence-chips">
      {meta.isOutput ? chip('fc-out', '⤷ output', false) : null}
      {hasMeta ? chip('fc-lang', meta.lang || 'txt', false) : null}
      {meta.file ? chip('fc-file', meta.file) : null}
      {meta.directives.map((d) => chip(`fc-dir${d === 'error' ? ' fc-error' : ''}`, `!${d}`))}
      {attrs.map(([k, v]) => chip('fc-attr', `${k}=${v}`))}
      {meta.tags.map((t) => chip('fc-tag', `#${t}`))}
      {src
        ? chip('fc-src' + (srcIsFact ? ' fc-link' : ''), `< ${src}`, true,
            srcIsFact ? <FactLink factKey={src} o={o}>{`< ${src}`}</FactLink> : undefined)
        : null}
      {meta.output ? chip('fc-target', `> ${[meta.output.lang, meta.output.file].filter(Boolean).join(' ')}`) : null}
      {actions}
    </div>
  );
}

/**
 * Where a fence token's BODY sits inside the source, given the token's own
 * start offset. The fence line runs to the first newline; the body is `text`
 * located from there (so an indented or `~~~` fence lands correctly), and the
 * closing fence is whatever follows. Returns null when the body can't be
 * located unambiguously — a caller must never splice against a guess.
 */
export function fenceRangeOf(t: MdToken, start: number): FenceRange | null {
  const raw = typeof t.raw === 'string' ? t.raw : '';
  if (!raw) return null;
  const nl = raw.indexOf('\n');
  if (nl < 0) return null; // a one-line fence has no body to edit
  const text = String(t.text ?? '');
  const block = { from: start, to: start + raw.length };
  if (!text) return { body: { from: start + nl + 1, to: start + nl + 1 }, block };
  const at = raw.indexOf(text, nl + 1);
  if (at < 0) return null;
  return { body: { from: start + at, to: start + at + text.length }, block };
}

/** One fenced block: its declaration (chips) plus its body. The body is the
 *  host's `renderFence` when it claims the fence, then the built-in `md`
 *  nesting (incl. admonitions), then the static `<pre>` floor. */
function Fence({ info, code, o, k, range }: { info: string; code: string; o: MdOpts; k: string; range: FenceRange | null }): React.JSX.Element {
  const meta = parseFenceMeta(info);
  const actions = o.fenceActions?.({ meta, body: code, range }) ?? null;
  const chips = o.hideFenceChips ? null : (
    <FenceChips meta={meta} o={o} actions={actions} />
  );

  // The host's viewers/embeds get first refusal — but never for a fence with a
  // `< source`, which is a REFERENCE: its body is a placeholder, and resolving
  // it needs a substrate read the static core deliberately doesn't do.
  const hosted = o.renderFence && !meta.source ? o.renderFence({ meta, body: code, opts: o, range }) : null;
  if (hosted != null) return <div key={k} className={`fence${meta.isOutput ? ' fence-output' : ''}`}>{chips}{hosted}</div>;

  // A markdown fence names the markdown renderer: render its body as markdown
  // (nested), so ```md / ```markdown — and dotlit's `>md !warn` admonition
  // form — is respected here exactly as in lit's SSR.
  const lang = meta.lang;
  if ((lang === 'md' || lang === 'markdown') && !meta.source && o.lex) {
    const dirs = meta.directives.filter((d) => ADMONITIONS.includes(d)).map((d) => ` dir-${d}`).join('');
    return (
      <div key={k} className={`md-fence${dirs}${meta.isOutput ? ' fence-output' : ''}`}>
        {chips}
        {renderBlocks(safeLex(code, o), `${k}:md`, o)}
      </div>
    );
  }

  return (
    <div key={k} className={`fence${meta.isOutput ? ' fence-output' : ''}`}>
      {chips}
      <pre style={PRE_STYLE} data-fence={info || undefined} data-output-lang={meta.isOutput ? lang : undefined}>
        <code className={lang ? `language-${lang.replace(/[^a-z0-9_-]/gi, '')}` : undefined}>{code}</code>
      </pre>
    </div>
  );
}

/** Lex nested markdown without letting a malformed body take out the page. */
function safeLex(md: string, o: MdOpts): MdToken[] {
  try {
    return o.lex?.(md) ?? [];
  } catch {
    return [];
  }
}

/* ── tokens → elements ─────────────────────────────────────────────────── */

export function renderInline(tokens: MdToken[] | undefined, key: string, o: MdOpts = {}): React.ReactNode {
  if (!tokens?.length) return null;
  return tokens.map((t, i) => {
    const k = `${key}:${i}`;
    switch (t.type) {
      case 'text':
      case 'escape':
        return t.tokens?.length ? <React.Fragment key={k}>{renderInline(t.tokens, k, o)}</React.Fragment> : <React.Fragment key={k}>{decodeEntities(String(t.text ?? t.raw ?? ''))}</React.Fragment>;
      case 'strong':
        return <strong key={k}>{renderInline(t.tokens, k, o)}</strong>;
      case 'em':
        return <em key={k}>{renderInline(t.tokens, k, o)}</em>;
      case 'del':
        return <del key={k}>{renderInline(t.tokens, k, o)}</del>;
      case 'codespan':
        return <code key={k}>{decodeEntities(String(t.text ?? ''))}</code>;
      case 'br':
        return <br key={k} />;
      case 'wikilink': {
        const target = wikiTargetOf(t);
        // `[[#fragment]]` — no key means "within this document"; a bare anchor.
        if (!target.key) return <a key={k} href={`#${encodeURIComponent(target.fragment ?? '')}`}>{target.label}</a>;
        return <FactLink key={k} factKey={target.key} fragment={target.fragment} o={o}>{target.label}</FactLink>;
      }
      case 'link': {
        const body = renderInline(t.tokens, k, o) ?? String(t.text ?? t.href ?? '');
        // A corpus-relative doc link becomes a fact link (usable in place);
        // everything else keeps the ordinary sanitized-href path.
        const docKey = typeof t.href === 'string' && o.resolveDocHref ? o.resolveDocHref(t.href, o.base) : null;
        if (docKey) return <FactLink key={k} factKey={docKey} o={o}>{body}</FactLink>;
        const href = safeNavigationUrl(t.href);
        return href
          ? <a key={k} href={href} rel="noreferrer">{body}</a>
          : <React.Fragment key={k}>{body}</React.Fragment>;
      }
      case 'image': {
        const src = safeImageUrl(t.href);
        const alt = decodeEntities(String(t.text ?? ''));
        return src
          ? <img key={k} src={src} alt={alt} title={typeof t.title === 'string' ? t.title : undefined} loading="lazy" referrerPolicy="no-referrer" style={{ maxWidth: '100%', height: 'auto' }} />
          : <React.Fragment key={k}>{alt}</React.Fragment>;
      }
      case 'html':
        // Raw HTML passthrough — marked leaves `raw` unescaped, so render as-is
        // (no entity decode; the text is already literal source).
        return <React.Fragment key={k}>{String(t.raw ?? t.text ?? '')}</React.Fragment>;
      default:
        return <React.Fragment key={k}>{t.tokens?.length ? renderInline(t.tokens, k, o) : decodeEntities(String(t.text ?? t.raw ?? ''))}</React.Fragment>;
    }
  });
}

/**
 * Render top-level block tokens.
 *
 * `origin` opts into SOURCE OFFSET tracking: marked's top-level `raw` values
 * concatenate back to the document verbatim, so a running sum over them gives
 * each token its true start — which is what lets a fence be edited in place
 * and spliced back. Pass `0` from a top-level render over the whole text; omit
 * it (the default) for nested renders, where offsets would be relative to a
 * container's `raw` rather than the document and so must not be trusted.
 */
export function renderBlocks(tokens: MdToken[] | undefined, key = 'b', o: MdOpts = {}, origin?: number): React.ReactNode {
  if (!tokens?.length) return null;
  let at = origin;
  return tokens.map((t, i) => {
    const k = `${key}:${i}`;
    const start = at;
    if (at !== undefined) at += String(t.raw ?? '').length;
    switch (t.type) {
      case 'space':
        return null;
      case 'paragraph':
        return <p key={k}>{renderInline(t.tokens, k, o) ?? String(t.text ?? '')}</p>;
      case 'heading': {
        const depth = Math.max(1, Math.min(6, Number(t.depth) || 1));
        return React.createElement(`h${depth}`, { key: k }, renderInline(t.tokens, k, o) ?? String(t.text ?? ''));
      }
      case 'blockquote':
        return <blockquote key={k}>{renderBlocks(t.tokens, k, o)}</blockquote>;
      case 'code':
        // The fence is a DECLARATION, not just a payload — parse its full
        // info-string and render it as such (chips + body). marked keeps only
        // the first word in `lang`, so the raw info-string is recovered from
        // the token's `raw` fence line.
        return <Fence key={k} k={k} info={fenceInfoOf(t)} code={String(t.text ?? '')} o={o} range={start === undefined ? null : fenceRangeOf(t, start)} />;
      case 'hr':
        return <hr key={k} />;
      case 'list': {
        const Tag = t.ordered ? 'ol' : 'ul';
        // A TIGHT list item's content is a `text` token, which `renderBlocks`
        // wraps in <p> — a block, so a task checkbox sat on its own line above
        // the prose. Render item-level `text` tokens INLINE (no <p>) so the
        // checkbox and its label share a line; nested blocks (sublists, code)
        // still render as blocks after it.
        const itemContent = (toks: MdToken[] | undefined, ik: string): React.ReactNode => {
          if (!toks?.length) return null;
          return toks.map((tk: MdToken, m: number) =>
            tk.type === 'text'
              ? <React.Fragment key={`${ik}:t${m}`}>{tk.tokens?.length ? renderInline(tk.tokens, `${ik}:t${m}`, o) : decodeEntities(String(tk.text ?? tk.raw ?? ''))}</React.Fragment>
              : <React.Fragment key={`${ik}:b${m}`}>{renderBlocks([tk], `${ik}:b${m}`, o)}</React.Fragment>,
          );
        };
        return (
          <Tag key={k} start={t.ordered && Number.isFinite(t.start) ? Number(t.start) : undefined}>
            {(t.items ?? []).map((it: MdToken, j: number) => (
              // Task items hide the bullet (the checkbox IS the marker).
              // `task === true` ONLY: marked sets `task: false` on every
              // ordinary list item, so a `typeof === 'boolean'` gate puts a
              // checkbox on every bullet in the corpus.
              <li key={`${k}:${j}`} style={it.task === true ? { listStyle: 'none', marginLeft: '-1.1em' } : undefined}>
                {it.task === true ? <input type="checkbox" checked={!!it.checked} readOnly aria-label="task status" style={{ verticalAlign: 'baseline', marginRight: '0.45em' }} /> : null}
                {itemContent(it.tokens, `${k}:${j}`) ?? renderInline(it.tokens, `${k}:${j}`, o) ?? String(it.text ?? '')}
              </li>
            ))}
          </Tag>
        );
      }
      case 'table':
        return (
          <div key={k} style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>{(t.header ?? []).map((c: MdToken, j: number) => <th key={j}>{renderInline(c.tokens ?? c, `${k}:h:${j}`, o) ?? decodeEntities(String(c.text ?? ''))}</th>)}</tr></thead>
              <tbody>{(t.rows ?? []).map((row: MdToken[], r: number) => <tr key={r}>{row.map((c: MdToken, j: number) => <td key={j}>{renderInline(c.tokens ?? c, `${k}:${r}:${j}`, o) ?? decodeEntities(String(c.text ?? ''))}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      case 'html':
        // Block-level raw HTML — shown as literal source in a code box (not
        // executed), so no entity decode.
        return <pre key={k} style={PRE_STYLE}><code>{String(t.raw ?? t.text ?? '')}</code></pre>;
      case 'text':
        return t.tokens?.length ? <p key={k}>{renderInline(t.tokens, k, o)}</p> : <React.Fragment key={k}>{decodeEntities(String(t.text ?? t.raw ?? ''))}</React.Fragment>;
      default:
        return t.tokens?.length
          ? <React.Fragment key={k}>{renderBlocks(t.tokens, k, o) ?? renderInline(t.tokens, k, o)}</React.Fragment>
          : <React.Fragment key={k}>{decodeEntities(String(t.text ?? ''))}</React.Fragment>;
    }
  });
}

/**
 * The FULL info-string of a fenced code token.
 *
 * marked's `code` token keeps only the first word in `lang` (`js` out of
 * `js !plugin type=viewer of=foo`) — and the rest of that line is the whole
 * declaration. lit recovers it with a custom HTML renderer; consuming tokens,
 * we recover it from `raw`, whose first line is the fence line verbatim.
 * Falls back to `lang` when `raw` is absent (a synthesised token).
 */
export function fenceInfoOf(t: MdToken): string {
  const raw = typeof t.raw === 'string' ? t.raw : '';
  const first = raw.slice(0, raw.indexOf('\n') < 0 ? raw.length : raw.indexOf('\n'));
  const m = /^\s*(?:```+|~~~+)(.*)$/.exec(first);
  const info = m ? m[1].trim() : '';
  return info || String(t.lang ?? '').trim();
}

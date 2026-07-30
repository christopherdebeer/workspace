import * as React from 'react';
import { marked } from 'marked';
import { resolveDocHref } from './doc-links';
export { resolveDocHref };

type Token = Record<string, any>;

// Code/HTML blocks must not force the content body wider than its container.
// WRAP rather than scroll: a scrolling <pre> only stays bounded if min-width:0
// holds through EVERY flex/grid ancestor — one miss and it blows out again.
// Wrapping never establishes a wide intrinsic width, so it's robust regardless
// of the container stack. white-space:pre-wrap keeps indentation/newlines while
// wrapping long lines; overflow-wrap:anywhere breaks unbreakable tokens (URLs,
// long paths). (`text-wrap` is the newer spelling of the same intent.)
const PRE_STYLE: React.CSSProperties = { maxWidth: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

// marked emits HTML-ESCAPED text on its leaf tokens (`text`, `codespan`,
// image alt) — `agent's` becomes `agent&#39;s`, `a & b` becomes `a &amp; b`.
// React renders a string verbatim (it does NOT decode entities in text
// content), so those escapes would show literally. We decode the fixed set
// marked produces, plus the common named/numeric forms, so authored punctuation
// reads correctly. SSR-safe (pure string work — no DOM). NOT applied to fenced
// code blocks (marked leaves those raw, so a literal `&amp;` there is intended)
// nor to raw HTML passthrough. `&amp;` is decoded LAST so `&amp;lt;` → `&lt;`.
function decodeEntities(s: string): string {
  if (!s || s.indexOf('&') === -1) return s;
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
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

// ── substrate links (ADR-0092 follow-on: docs are USABLE on home) ───────────
// Two authored forms resolve to FACT links instead of dead hrefs:
//   [[key]] / [[key|label]]      — a wiki-link straight to a fact key
//   [text](relative/path.md)     — a corpus-relative doc link, resolved against
//                                  the rendering doc's own path (`base`)
// A fact link renders as <a href="/r/<key>"> (the ADR-0090 fact address — real
// URL, works in a new tab / for crawlers) and, when the host passes
// `onFactLink`, intercepts the click to open the fact IN PLACE (the home
// peek modal / graph selection) instead of navigating away.

/** Options threaded through the renderer (all optional — plain rendering
 *  without them is byte-identical to before). */
export interface MdOpts {
  /** The rendering doc's corpus directory (e.g. `docs/architecture/adr`) —
   *  what relative `*.md` hrefs resolve against. */
  base?: string;
  /** Open a fact key in place (e.g. home's openFact). Absent → href-only. */
  onFactLink?: (key: string) => void;
  /** The href for a fact key. The default relative `/r/<key>` only resolves at
   *  the apex — a host served from a cell subdomain passes an origin-aware
   *  resolver (home: `localize`) so new-tab/middle-click stays navigable. */
  factHref?: (key: string) => string;
  /** The surface this reads on. 'dark' (default) = the ink palette (graph
   *  palette, bottom-sheet peek); 'light' = the cream trailhead (`.on-paper`
   *  palette variables). Only swaps colours — the layout is one system. */
  tone?: 'light' | 'dark';
}

/** The `[[wiki-link]]` inline tokenizer, registered once. A marked extension
 *  (not a regex preprocess) so code spans/blocks keep their literal text. */
marked.use({
  extensions: [
    {
      name: 'wikilink',
      level: 'inline',
      start(src: string) {
        const i = src.indexOf('[[');
        return i < 0 ? undefined : i;
      },
      tokenizer(src: string) {
        const m = /^\[\[([^[\]|]+?)(?:\|([^[\]]+?))?\]\]/.exec(src);
        if (!m) return undefined;
        return { type: 'wikilink', raw: m[0], factKey: m[1].trim(), label: (m[2] ?? m[1]).trim() };
      },
    },
  ],
});

function FactLink({ factKey, children, o }: { factKey: string; children: React.ReactNode; o: MdOpts }): React.JSX.Element {
  const { onFactLink, factHref } = o;
  return (
    <a
      href={factHref ? factHref(factKey) : `/r/${factKey}`}
      title={factKey}
      style={{ textDecorationStyle: 'dotted', textUnderlineOffset: '2px' }}
      onClick={onFactLink ? (ev) => { ev.preventDefault(); onFactLink(factKey); } : undefined}
    >
      {children}
    </a>
  );
}

function inline(tokens: Token[] | undefined, key: string, o: MdOpts = {}): React.ReactNode {
  if (!tokens?.length) return null;
  return tokens.map((t, i) => {
    const k = `${key}:${i}`;
    switch (t.type) {
      case 'text':
      case 'escape':
        return t.tokens?.length ? <React.Fragment key={k}>{inline(t.tokens, k, o)}</React.Fragment> : <React.Fragment key={k}>{decodeEntities(String(t.text ?? t.raw ?? ''))}</React.Fragment>;
      case 'strong':
        return <strong key={k}>{inline(t.tokens, k, o)}</strong>;
      case 'em':
        return <em key={k}>{inline(t.tokens, k, o)}</em>;
      case 'del':
        return <del key={k}>{inline(t.tokens, k, o)}</del>;
      case 'codespan':
        return <code key={k}>{decodeEntities(String(t.text ?? ''))}</code>;
      case 'br':
        return <br key={k} />;
      case 'wikilink':
        return <FactLink key={k} factKey={String(t.factKey ?? '')} o={o}>{String(t.label ?? t.factKey ?? '')}</FactLink>;
      case 'link': {
        const body = inline(t.tokens, k, o) ?? String(t.text ?? t.href ?? '');
        // A corpus-relative doc link becomes a fact link (usable in place);
        // everything else keeps the ordinary sanitized-href path.
        const docKey = typeof t.href === 'string' ? resolveDocHref(t.href, o.base) : null;
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
        return <React.Fragment key={k}>{t.tokens?.length ? inline(t.tokens, k, o) : decodeEntities(String(t.text ?? t.raw ?? ''))}</React.Fragment>;
    }
  });
}

function blocks(tokens: Token[] | undefined, key = 'b', o: MdOpts = {}): React.ReactNode {
  if (!tokens?.length) return null;
  return tokens.map((t, i) => {
    const k = `${key}:${i}`;
    switch (t.type) {
      case 'space':
        return null;
      case 'paragraph':
        return <p key={k}>{inline(t.tokens, k, o) ?? String(t.text ?? '')}</p>;
      case 'heading': {
        const depth = Math.max(1, Math.min(6, Number(t.depth) || 1));
        return React.createElement(`h${depth}`, { key: k }, inline(t.tokens, k, o) ?? String(t.text ?? ''));
      }
      case 'blockquote':
        return <blockquote key={k}>{blocks(t.tokens, k, o)}</blockquote>;
      case 'code':
        // A code block must not stretch its container: long lines scroll WITHIN
        // the <pre> (max-width:100% + overflow-x) rather than forcing the whole
        // content body wider than the viewport. Formatting is preserved (no
        // forced wrap of code); only the box is bounded.
        return <pre key={k} style={PRE_STYLE}><code className={t.lang ? `language-${String(t.lang).replace(/[^a-z0-9_-]/gi, '')}` : undefined}>{String(t.text ?? '')}</code></pre>;
      case 'hr':
        return <hr key={k} />;
      case 'list': {
        const Tag = t.ordered ? 'ol' : 'ul';
        // A TIGHT list item's content is a `text` token, which `blocks()` wraps
        // in <p> — a block, so a task checkbox sat on its own line above the
        // prose. Render item-level `text` tokens INLINE (no <p>) so the
        // checkbox and its label share a line; nested blocks (sublists, code)
        // still render as blocks after it.
        const itemContent = (tokens: Token[] | undefined, ik: string): React.ReactNode => {
          if (!tokens?.length) return null;
          return tokens.map((tk: Token, m: number) =>
            tk.type === 'text'
              ? <React.Fragment key={`${ik}:t${m}`}>{tk.tokens?.length ? inline(tk.tokens, `${ik}:t${m}`, o) : decodeEntities(String(tk.text ?? tk.raw ?? ''))}</React.Fragment>
              : <React.Fragment key={`${ik}:b${m}`}>{blocks([tk], `${ik}:b${m}`, o)}</React.Fragment>,
          );
        };
        return (
          <Tag key={k} start={t.ordered && Number.isFinite(t.start) ? Number(t.start) : undefined}>
            {(t.items ?? []).map((it: Token, j: number) => (
              // Task items hide the bullet (the checkbox IS the marker).
              // `task === true` ONLY: marked sets `task: false` on every
              // ordinary list item, so the old `typeof === 'boolean'` gate put
              // a checkbox on every bullet in the corpus.
              <li key={`${k}:${j}`} style={it.task === true ? { listStyle: 'none', marginLeft: '-1.1em' } : undefined}>
                {it.task === true ? <input type="checkbox" checked={!!it.checked} readOnly aria-label="task status" style={{ verticalAlign: 'baseline', marginRight: '0.45em' }} /> : null}
                {itemContent(it.tokens, `${k}:${j}`) ?? inline(it.tokens, `${k}:${j}`, o) ?? String(it.text ?? '')}
              </li>
            ))}
          </Tag>
        );
      }
      case 'table':
        return (
          <div key={k} style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>{(t.header ?? []).map((c: Token, j: number) => <th key={j}>{inline(c.tokens ?? c, `${k}:h:${j}`, o) ?? decodeEntities(String(c.text ?? ''))}</th>)}</tr></thead>
              <tbody>{(t.rows ?? []).map((row: Token[], r: number) => <tr key={r}>{row.map((c: Token, j: number) => <td key={j}>{inline(c.tokens ?? c, `${k}:${r}:${j}`, o) ?? decodeEntities(String(c.text ?? ''))}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      case 'html':
        // Block-level raw HTML — shown as literal source in a code box (not
        // executed), so no entity decode.
        return <pre key={k} style={PRE_STYLE}><code>{String(t.raw ?? t.text ?? '')}</code></pre>;
      case 'text':
        return t.tokens?.length ? <p key={k}>{inline(t.tokens, k, o)}</p> : <React.Fragment key={k}>{decodeEntities(String(t.text ?? t.raw ?? ''))}</React.Fragment>;
      default:
        return t.tokens?.length
          ? <React.Fragment key={k}>{blocks(t.tokens, k, o) ?? inline(t.tokens, k, o)}</React.Fragment>
          : <React.Fragment key={k}>{decodeEntities(String(t.text ?? ''))}</React.Fragment>;
    }
  });
}

/** Render ONE LINE of markdown INLINE — no block/`<p>` wrapping — for titles and
 *  headlines, which may carry bold, italic, inline code, or a link. Newlines are
 *  flattened to spaces (a title is a single line); falls back to plain text if
 *  the inline lexer throws. Colour/size are inherited from the heading it sits
 *  in — this only adds the emphasis marks, it never restyles the title. */
export function InlineMarkdown({ text, base, onFactLink, factHref }: { text: string } & MdOpts): React.JSX.Element {
  const src = String(text ?? '');
  // No markdown metacharacters → skip the lexer entirely (the overwhelmingly
  // common case, and byte-identical to a plain string).
  if (!/[*_`~[\]]/.test(src)) return <>{src}</>;
  let tokens: Token[] = [];
  try {
    tokens = marked.Lexer.lexInline(src.replace(/\s*\r?\n\s*/g, ' ')) as Token[];
  } catch {
    return <>{src}</>;
  }
  return <>{inline(tokens, 'inline', { base, onFactLink, factHref })}</>;
}

export function SafeMarkdown({ text, base, onFactLink, factHref, tone = 'light' }: { text: string } & MdOpts): React.JSX.Element {
  let tokens: Token[] = [];
  try {
    tokens = marked.lexer(text.replace(/\r\n/g, '\n')) as Token[];
  } catch {
    return <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</pre>;
  }
  // minWidth:0 lets this shrink below its content's intrinsic width inside a
  // flex/grid parent — without it, a wide <pre> child forces the whole column
  // (and the page) wider than the viewport instead of scrolling within itself.
  // `on-paper` swaps the palette's link/code/border colours to the cream-ground
  // variants (see static/index.html); dark is the default (byte-identical).
  return <div className={tone === 'light' ? 'fact-md on-paper' : 'fact-md'} style={{ fontSize: '0.85rem', lineHeight: 1.5, overflowWrap: 'anywhere', minWidth: 0 }}>{blocks(tokens, 'b', { base, onFactLink, factHref })}</div>;
}

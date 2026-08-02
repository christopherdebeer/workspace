/**
 * The ONE sanitized markdown→React renderer core (docs/home-hosts-lit.md
 * steps 1–2). Home's `safe-markdown.tsx` and lit's reader render the same doc
 * facts; this module is the shared core so they cannot drift (the dotlit
 * "one renderer" lesson — the task-checkbox bug lived only in home's copy).
 *
 * Security posture is the APEX's (the stricter host): tokens render to React
 * elements — never `dangerouslySetInnerHTML` — URLs pass an allowlist
 * (`cleanUrl`), raw HTML shows as literal source. lit's owner-trusted live
 * ladder (execution, transclusion resolution, repl) stays in lit, layered on
 * top; here every fence renders as a DECLARATION — the chip row + static body
 * dotlit shows for an un-run fence — via the shared fence meta-grammar
 * (ADR-0059), so a `>toc`, a transclusion, a run output stop reading as dead
 * code blocks on surfaces that don't execute.
 *
 * Dependency-free like the rest of @parc/ui (React only): the surface supplies
 * its own `marked` as an injected `MdEngine` (the `render-hints.ts` pattern),
 * and registers `wikiLinkTokenExtension()` on it so `[[wiki-links]]` become
 * tokens (not a regex preprocess — code spans keep their literal text). Key
 * resolution goes through the ONE `resolveWikiTarget` rule (wiki-link.ts).
 */
import * as React from 'react';
import { parseFenceMeta, type FenceMeta } from './fence';
import { resolveWikiTarget } from './wiki-link';

export type MdToken = Record<string, any>;

/** The surface's own markdown lexer (home/lit each bundle `marked` at their
 *  pin). Injected so this module stays dependency-free and SSR-safe. */
export interface MdEngine {
  lexer: (src: string) => MdToken[];
  lexInline: (src: string) => MdToken[];
}

// Code/HTML blocks must not force the content body wider than its container.
// WRAP rather than scroll: a scrolling <pre> only stays bounded if min-width:0
// holds through EVERY flex/grid ancestor — one miss and it blows out again.
const PRE_STYLE: React.CSSProperties = { maxWidth: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

// marked emits HTML-ESCAPED text on its leaf tokens (`text`, `codespan`,
// image alt). React renders a string verbatim (it does NOT decode entities in
// text content), so those escapes would show literally. Decode the fixed set
// marked produces. NOT applied to fenced code (marked leaves those raw) nor to
// raw-HTML passthrough. `&amp;` is decoded LAST so `&amp;lt;` → `&lt;`.
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

/** The `[[wiki-link]]` inline tokenizer for the surface's `marked.use(...)`.
 *  Emits the RAW inner text; resolution to a fact key happens at render time
 *  through the one shared `resolveWikiTarget` rule, so a bare title slugs to
 *  `doc:<slug>` identically on every surface (home's old local tokenizer
 *  skipped the slug rule — exactly the drift this core retires). */
export function wikiLinkTokenExtension(): {
  name: string;
  level: 'inline';
  start: (src: string) => number | undefined;
  tokenizer: (src: string) => { type: string; raw: string; text: string } | undefined;
} {
  return {
    name: 'wikilink',
    level: 'inline',
    start(src: string) {
      const i = src.indexOf('[[');
      return i < 0 ? undefined : i;
    },
    tokenizer(src: string) {
      const m = /^\[\[([^\]]+)\]\]/.exec(src);
      return m ? { type: 'wikilink', raw: m[0], text: m[1] } : undefined;
    },
  };
}

/** A fence renderer hook's context: the parsed declaration + default render. */
export interface FenceContext {
  meta: FenceMeta;
  code: string;
  /** The core's own declaration rendering — return it to decorate, or ignore it. */
  defaultRender: () => React.ReactNode;
}

/** Options threaded through the renderer (all optional — plain rendering
 *  without them matches the previous per-surface behaviour). */
export interface MdOpts {
  /** The rendering doc's corpus directory (e.g. `docs/architecture/adr`) —
   *  what relative `*.md` hrefs resolve against (via `resolveDocHref`). */
  base?: string;
  /** Open a fact key in place (e.g. home's openFact). Absent → href-only.
   *  `fragment` carries `[[key#member]]` addressing when present. */
  onFactLink?: (key: string, fragment?: string) => void;
  /** The href for a fact key. Default `/r/<key>` only resolves at the apex —
   *  a host served elsewhere passes an origin-aware resolver. */
  factHref?: (key: string) => string;
  /** 'dark' (default home peek) or 'light' (the cream trailhead). Class only. */
  tone?: 'light' | 'dark';
  /** Resolve a relative `*.md` href to a fact key (home: doc-links.ts). */
  resolveDocHref?: (href: string, base?: string) => string | null;
  /** Surface-specific fence rendering (home: static-safe viewers; lit later:
   *  the live ladder). Return undefined to take the core's declaration render. */
  renderFence?: (ctx: FenceContext) => React.ReactNode | undefined;
}

/** dotlit's admonition directives: an `md` fence carrying one renders as a
 *  coloured callout, not code (verified: styling_and_themes.lit §dir-*). */
const ADMONITIONS: Record<string, string> = {
  warn: '#b58a3c',
  error: '#b5523c',
  success: '#2e5e43',
  info: '#3c6eb5',
  note: '#85795f',
  box: '#85795f',
};

// Chips read on both tones: geometry + opacity only, colour inherited.
const CHIP: React.CSSProperties = {
  display: 'inline-block',
  padding: '0 0.45em',
  borderRadius: 999,
  border: '1px solid rgba(128,128,128,0.4)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.66rem',
  lineHeight: 1.7,
  opacity: 0.8,
  whiteSpace: 'nowrap',
};

/** The chip row of a fence DECLARATION — lang, file, !directives, attrs,
 *  #tags, `< source` (a fact link when key-shaped), `> output`. The reader's
 *  honest rendering of the fence line (`!hidemeta` suppresses it). */
function FenceChips({ meta, o }: { meta: FenceMeta; o: MdOpts }): React.JSX.Element | null {
  if (meta.directives.includes('hidemeta')) return null;
  const chips: React.ReactNode[] = [];
  if (meta.isOutput) chips.push(<span key="out" style={{ ...CHIP, borderStyle: 'solid', fontWeight: 600 }}>↳ output</span>);
  if (meta.lang) chips.push(<span key="lang" style={CHIP}>{meta.lang}</span>);
  if (meta.file) chips.push(<span key="file" style={CHIP}>{meta.file}</span>);
  for (const d of meta.directives) chips.push(<span key={`d:${d}`} style={CHIP}>!{d}</span>);
  for (const [k, v] of Object.entries(meta.attrs)) chips.push(<span key={`a:${k}`} style={CHIP}>{k}={v}</span>);
  for (const t of meta.tags) chips.push(<span key={`t:${t}`} style={CHIP}>#{t}</span>);
  if (meta.source) {
    const src = meta.source.file ?? meta.source.lang;
    // A key-shaped source (`kb/x`, `doc:y`) is a REFERENCE — link it so the
    // reader can follow the transclusion even where nothing goes live.
    const isKey = !!src && /[:/]/.test(src) && !/^https?:/.test(src) && !src.startsWith('//');
    chips.push(
      isKey
        ? <FactLink key="src" factKey={src as string} o={o}><span style={{ ...CHIP, borderStyle: 'dashed' }}>&lt; {src}</span></FactLink>
        : <span key="src" style={{ ...CHIP, borderStyle: 'dashed' }}>&lt; {src}</span>,
    );
  }
  if (meta.output) chips.push(<span key="dst" style={{ ...CHIP, borderStyle: 'dashed' }}>&gt; {[meta.output.lang, meta.output.file].filter(Boolean).join(' ')}</span>);
  if (!chips.length) return null;
  return <div className="fence-chips" style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>{chips}</div>;
}

/** Is this fence a PLAIN code block (bare ``` or ```lang) — no declaration? */
function isPlainFence(meta: FenceMeta): boolean {
  return (
    !meta.isOutput && !meta.source && !meta.output && !meta.filename && !meta.uri &&
    meta.directives.length === 0 && meta.tags.length === 0 &&
    Object.keys(meta.attrs).length === 0 && meta.unknowns.length === 0
  );
}

function FactLink({ factKey, fragment, children, o }: { factKey: string; fragment?: string; children: React.ReactNode; o: MdOpts }): React.JSX.Element {
  const { onFactLink, factHref } = o;
  const frag = fragment ? `#${encodeURIComponent(fragment)}` : '';
  return (
    <a
      href={(factHref ? factHref(factKey) : `/r/${factKey}`) + frag}
      title={factKey}
      style={{ textDecorationStyle: 'dotted', textUnderlineOffset: '2px' }}
      onClick={onFactLink ? (ev) => { ev.preventDefault(); onFactLink(factKey, fragment); } : undefined}
    >
      {children}
    </a>
  );
}

/** Build the renderer pair over the surface's own markdown engine. Module-level
 *  factory (the engine is a stable import), so the components keep referential
 *  identity across renders. */
export function createSafeMarkdown(engine: MdEngine): {
  SafeMarkdown: (props: { text: string } & MdOpts) => React.JSX.Element;
  InlineMarkdown: (props: { text: string } & MdOpts) => React.JSX.Element;
  blocks: (tokens: MdToken[] | undefined, key?: string, o?: MdOpts) => React.ReactNode;
  inline: (tokens: MdToken[] | undefined, key: string, o?: MdOpts) => React.ReactNode;
} {
  function inline(tokens: MdToken[] | undefined, key: string, o: MdOpts = {}): React.ReactNode {
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
        case 'wikilink': {
          // Legacy token shape ({factKey,label}) and the shared shape ({text})
          // both resolve here — through the ONE wiki rule.
          const target = typeof t.factKey === 'string' && t.factKey
            ? { key: String(t.factKey), label: String(t.label ?? t.factKey), fragment: undefined as string | undefined }
            : resolveWikiTarget(String(t.text ?? ''));
          if (!target.key) return <React.Fragment key={k}>{target.label}</React.Fragment>;
          return <FactLink key={k} factKey={target.key} fragment={target.fragment} o={o}>{target.label}</FactLink>;
        }
        case 'link': {
          const body = inline(t.tokens, k, o) ?? String(t.text ?? t.href ?? '');
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
          // Raw HTML passthrough — shown as literal text (never executed).
          return <React.Fragment key={k}>{String(t.raw ?? t.text ?? '')}</React.Fragment>;
        default:
          return <React.Fragment key={k}>{t.tokens?.length ? inline(t.tokens, k, o) : decodeEntities(String(t.text ?? t.raw ?? ''))}</React.Fragment>;
      }
    });
  }

  /** A fence, rendered as what it IS (ADR-0059/home-hosts-lit): plain code
   *  stays a code block; an `md` fence renders as (admonition-styled) nested
   *  markdown; anything carrying a declaration renders the chip row + static
   *  body — never a dead ```-block with its meta line silently dropped. */
  function fenceBlock(t: MdToken, k: string, o: MdOpts): React.ReactNode {
    const info = String(t.lang ?? '').trim();
    const code = String(t.text ?? '');
    let meta: FenceMeta;
    try {
      meta = parseFenceMeta(info);
    } catch {
      meta = { isOutput: false, lang: info.split(/\s+/)[0] ?? '', directives: [], attrs: {}, tags: [], unknowns: [], raw: info };
    }
    const plainPre = (): React.ReactNode => (
      <pre key={k} style={PRE_STYLE} data-fence={info || undefined}>
        <code className={meta.lang ? `language-${meta.lang.replace(/[^a-z0-9_-]/gi, '')}` : undefined}>{code}</code>
      </pre>
    );
    const defaultRender = (): React.ReactNode => {
      if (!info || isPlainFence(meta)) {
        // `md`/`markdown` names the markdown renderer even bare — nested render.
        if (meta.lang === 'md' || meta.lang === 'markdown') {
          let toks: MdToken[] = [];
          try { toks = engine.lexer(code); } catch { return plainPre(); }
          return <div key={k} className="md-fence">{blocks(toks, `${k}:md`, o)}</div>;
        }
        return plainPre();
      }
      return declRender();
    };
    const declRender = (): React.ReactNode => {
      // An `md` fence with directives → the admonition callout (nested render);
      // with a `< source` it's a TRANSCLUSION declaration instead (the body is
      // a placeholder, not content — the reference chip is the substance).
      if ((meta.lang === 'md' || meta.lang === 'markdown') && !meta.source) {
        const dir = meta.directives.find((d) => d in ADMONITIONS);
        const color = dir ? ADMONITIONS[dir] : undefined;
        let toks: MdToken[] = [];
        try { toks = engine.lexer(code); } catch { toks = []; }
        return (
          <div
            key={k}
            className={`md-fence${dir ? ` dir-${dir}` : ''}${meta.isOutput ? ' fence-output' : ''}`}
            style={color ? { borderLeft: `3px solid ${color}`, padding: '0.1rem 0.7rem', borderRadius: 4, background: 'rgba(128,128,128,0.07)' } : undefined}
          >
            <FenceChips meta={meta} o={o} />
            {toks.length ? blocks(toks, `${k}:md`, o) : null}
          </div>
        );
      }
      const body = code.trim()
        ? <pre style={{ ...PRE_STYLE, margin: 0 }}><code className={meta.lang ? `language-${meta.lang.replace(/[^a-z0-9_-]/gi, '')}` : undefined}>{code}</code></pre>
        : meta.source
          ? <div style={{ fontSize: '0.75rem', opacity: 0.65, fontStyle: 'italic' }}>⧉ transcludes {meta.source.file ?? meta.source.lang}</div>
          : null;
      return (
        <div key={k} className={`fence-decl${meta.isOutput ? ' fence-output' : ''}`} data-fence={info} style={{ display: 'grid', gap: '0.15rem', margin: '0.4rem 0' }}>
          <FenceChips meta={meta} o={o} />
          {meta.directives.includes('collapse') && body
            ? <details><summary style={{ cursor: 'pointer', fontSize: '0.72rem', opacity: 0.7 }}>show</summary>{body}</details>
            : body}
        </div>
      );
    };
    const custom = o.renderFence?.({ meta, code, defaultRender });
    if (custom !== undefined) return <React.Fragment key={k}>{custom}</React.Fragment>;
    return defaultRender();
  }

  function blocks(tokens: MdToken[] | undefined, key = 'b', o: MdOpts = {}): React.ReactNode {
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
          return fenceBlock(t, k, o);
        case 'hr':
          return <hr key={k} />;
        case 'list': {
          const Tag = t.ordered ? 'ol' : 'ul';
          // A TIGHT list item's content is a `text` token, which `blocks()`
          // wraps in <p> — a block, so a task checkbox sat on its own line
          // above the prose. Render item-level `text` tokens INLINE (no <p>);
          // nested blocks (sublists, code) still render as blocks after it.
          const itemContent = (tokens: MdToken[] | undefined, ik: string): React.ReactNode => {
            if (!tokens?.length) return null;
            return tokens.map((tk: MdToken, m: number) =>
              tk.type === 'text'
                ? <React.Fragment key={`${ik}:t${m}`}>{tk.tokens?.length ? inline(tk.tokens, `${ik}:t${m}`, o) : decodeEntities(String(tk.text ?? tk.raw ?? ''))}</React.Fragment>
                : <React.Fragment key={`${ik}:b${m}`}>{blocks([tk], `${ik}:b${m}`, o)}</React.Fragment>,
            );
          };
          return (
            <Tag key={k} start={t.ordered && Number.isFinite(t.start) ? Number(t.start) : undefined}>
              {(t.items ?? []).map((it: MdToken, j: number) => (
                // Task items hide the bullet (the checkbox IS the marker).
                // `task === true` ONLY: marked sets `task: false` on every
                // ordinary list item, so a looser gate put a checkbox on
                // every bullet in the corpus.
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
                <thead><tr>{(t.header ?? []).map((c: MdToken, j: number) => <th key={j}>{inline(c.tokens ?? c, `${k}:h:${j}`, o) ?? decodeEntities(String(c.text ?? ''))}</th>)}</tr></thead>
                <tbody>{(t.rows ?? []).map((row: MdToken[], r: number) => <tr key={r}>{row.map((c: MdToken, j: number) => <td key={j}>{inline(c.tokens ?? c, `${k}:${r}:${j}`, o) ?? decodeEntities(String(c.text ?? ''))}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
        case 'html':
          // Block-level raw HTML — shown as literal source (not executed).
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

  /** Render ONE LINE of markdown INLINE — no block/`<p>` wrapping — for titles,
   *  which may carry bold/italic/inline code/a link. Newlines flatten to
   *  spaces; falls back to plain text if the inline lexer throws. */
  function InlineMarkdown({ text, ...o }: { text: string } & MdOpts): React.JSX.Element {
    const src = String(text ?? '');
    // No markdown metacharacters → skip the lexer entirely (the overwhelmingly
    // common case, and byte-identical to a plain string).
    if (!/[*_`~[\]]/.test(src)) return <>{src}</>;
    let tokens: MdToken[] = [];
    try {
      tokens = engine.lexInline(src.replace(/\s*\r?\n\s*/g, ' '));
    } catch {
      return <>{src}</>;
    }
    return <>{inline(tokens, 'inline', o)}</>;
  }

  function SafeMarkdown({ text, ...o }: { text: string } & MdOpts): React.JSX.Element {
    const tone = o.tone ?? 'light';
    let tokens: MdToken[] = [];
    try {
      tokens = engine.lexer(String(text ?? '').replace(/\r\n/g, '\n'));
    } catch {
      return <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</pre>;
    }
    // minWidth:0 lets this shrink below its content's intrinsic width inside a
    // flex/grid parent — without it, a wide <pre> child forces the whole column
    // wider than the viewport instead of scrolling within itself.
    return <div className={tone === 'light' ? 'fact-md on-paper' : 'fact-md'} style={{ fontSize: '0.85rem', lineHeight: 1.5, overflowWrap: 'anywhere', minWidth: 0 }}>{blocks(tokens, 'b', o)}</div>;
  }

  return { SafeMarkdown, InlineMarkdown, blocks, inline };
}

import * as React from 'react';
import { marked } from 'marked';

type Token = Record<string, any>;

// Code/HTML blocks must not force the content body wider than its container.
// WRAP rather than scroll: a scrolling <pre> only stays bounded if min-width:0
// holds through EVERY flex/grid ancestor — one miss and it blows out again.
// Wrapping never establishes a wide intrinsic width, so it's robust regardless
// of the container stack. white-space:pre-wrap keeps indentation/newlines while
// wrapping long lines; overflow-wrap:anywhere breaks unbreakable tokens (URLs,
// long paths). (`text-wrap` is the newer spelling of the same intent.)
const PRE_STYLE: React.CSSProperties = { maxWidth: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };

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

function inline(tokens: Token[] | undefined, key: string): React.ReactNode {
  if (!tokens?.length) return null;
  return tokens.map((t, i) => {
    const k = `${key}:${i}`;
    switch (t.type) {
      case 'text':
      case 'escape':
        return t.tokens?.length ? <React.Fragment key={k}>{inline(t.tokens, k)}</React.Fragment> : <React.Fragment key={k}>{String(t.text ?? t.raw ?? '')}</React.Fragment>;
      case 'strong':
        return <strong key={k}>{inline(t.tokens, k)}</strong>;
      case 'em':
        return <em key={k}>{inline(t.tokens, k)}</em>;
      case 'del':
        return <del key={k}>{inline(t.tokens, k)}</del>;
      case 'codespan':
        return <code key={k}>{String(t.text ?? '')}</code>;
      case 'br':
        return <br key={k} />;
      case 'link': {
        const href = safeNavigationUrl(t.href);
        const body = inline(t.tokens, k) ?? String(t.text ?? t.href ?? '');
        return href
          ? <a key={k} href={href} rel="noreferrer">{body}</a>
          : <React.Fragment key={k}>{body}</React.Fragment>;
      }
      case 'image': {
        const src = safeImageUrl(t.href);
        return src
          ? <img key={k} src={src} alt={String(t.text ?? '')} title={typeof t.title === 'string' ? t.title : undefined} loading="lazy" referrerPolicy="no-referrer" style={{ maxWidth: '100%', height: 'auto' }} />
          : <React.Fragment key={k}>{String(t.text ?? '')}</React.Fragment>;
      }
      case 'html':
        return <React.Fragment key={k}>{String(t.raw ?? t.text ?? '')}</React.Fragment>;
      default:
        return <React.Fragment key={k}>{t.tokens?.length ? inline(t.tokens, k) : String(t.text ?? t.raw ?? '')}</React.Fragment>;
    }
  });
}

function blocks(tokens: Token[] | undefined, key = 'b'): React.ReactNode {
  if (!tokens?.length) return null;
  return tokens.map((t, i) => {
    const k = `${key}:${i}`;
    switch (t.type) {
      case 'space':
        return null;
      case 'paragraph':
        return <p key={k}>{inline(t.tokens, k) ?? String(t.text ?? '')}</p>;
      case 'heading': {
        const depth = Math.max(1, Math.min(6, Number(t.depth) || 1));
        return React.createElement(`h${depth}`, { key: k }, inline(t.tokens, k) ?? String(t.text ?? ''));
      }
      case 'blockquote':
        return <blockquote key={k}>{blocks(t.tokens, k)}</blockquote>;
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
        return (
          <Tag key={k} start={t.ordered && Number.isFinite(t.start) ? Number(t.start) : undefined}>
            {(t.items ?? []).map((it: Token, j: number) => (
              <li key={`${k}:${j}`}>
                {typeof it.task === 'boolean' ? <input type="checkbox" checked={!!it.checked} readOnly aria-label="task status" /> : null}
                {blocks(it.tokens, `${k}:${j}`) ?? inline(it.tokens, `${k}:${j}`) ?? String(it.text ?? '')}
              </li>
            ))}
          </Tag>
        );
      }
      case 'table':
        return (
          <div key={k} style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>{(t.header ?? []).map((c: Token, j: number) => <th key={j}>{inline(c.tokens ?? c, `${k}:h:${j}`) ?? String(c.text ?? '')}</th>)}</tr></thead>
              <tbody>{(t.rows ?? []).map((row: Token[], r: number) => <tr key={r}>{row.map((c: Token, j: number) => <td key={j}>{inline(c.tokens ?? c, `${k}:${r}:${j}`) ?? String(c.text ?? '')}</td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      case 'html':
        return <pre key={k} style={PRE_STYLE}><code>{String(t.raw ?? t.text ?? '')}</code></pre>;
      case 'text':
        return t.tokens?.length ? <p key={k}>{inline(t.tokens, k)}</p> : <React.Fragment key={k}>{String(t.text ?? t.raw ?? '')}</React.Fragment>;
      default:
        return t.tokens?.length
          ? <React.Fragment key={k}>{blocks(t.tokens, k) ?? inline(t.tokens, k)}</React.Fragment>
          : <React.Fragment key={k}>{String(t.text ?? '')}</React.Fragment>;
    }
  });
}

export function SafeMarkdown({ text }: { text: string }): React.JSX.Element {
  let tokens: Token[] = [];
  try {
    tokens = marked.lexer(text.replace(/\r\n/g, '\n')) as Token[];
  } catch {
    return <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</pre>;
  }
  // minWidth:0 lets this shrink below its content's intrinsic width inside a
  // flex/grid parent — without it, a wide <pre> child forces the whole column
  // (and the page) wider than the viewport instead of scrolling within itself.
  return <div className="fact-md" style={{ fontSize: '0.85rem', lineHeight: 1.5, overflowWrap: 'anywhere', minWidth: 0 }}>{blocks(tokens)}</div>;
}

/**
 * Home's markdown surface — the shared `@parc/ui` renderer core, wired to
 * home's own concerns (docs/home-hosts-lit.md step 2).
 *
 * What used to live here — the whole token→React renderer, the URL sanitizers,
 * the wiki-link tokenizer — is now `platform/ui/markdown.tsx`, because it was a
 * fork: lit had the real renderer (fence grammar, viewers, transclusion) and
 * home had a lesser copy, while the type vocabulary routed reading to home.
 * What remains here is genuinely home's:
 *
 *   - the `marked` instance + its extension registration (home owns the pin);
 *   - `resolveDocHref` (the corpus layout is home's knowledge);
 *   - `renderFence`: which fences home is willing to make LIVE.
 *
 * That last one is the trust boundary. Home is guest-exposed at the apex, so
 * it mounts only the DISPLAY viewers (mermaid/csv/json/style — deterministic,
 * secretless, no substrate reads). Everything executable — `repl`, `run`,
 * `agent`, an author-registered `_renderers/<type>` — stays a declaration
 * here: chips plus its source. lit remains the only place a fence goes live,
 * and that asymmetry is the design, not a gap.
 */
import * as React from 'react';
import { marked } from 'marked';
import {
  renderBlocks,
  renderInline,
  wikiLinkTokenExtension,
  safeNavigationUrl,
  safeImageUrl,
  safeFrameUrl,
  type MdOpts,
  type MdToken,
} from '@parc/ui';
import { resolveDocHref } from './doc-links';
import { DISPLAY_VIEWERS, ViewerBody } from './viewers';

export { resolveDocHref, safeNavigationUrl, safeImageUrl, safeFrameUrl };
export type { MdOpts };

/** The `[[wiki-link]]` inline tokenizer, registered once on home's marked
 *  instance. A marked extension (not a regex preprocess) so code spans/blocks
 *  keep their literal text; the shared one, so `[[a doc title]]` resolves to
 *  `doc:a-doc-title` here exactly as it does in lit (home's local copy took
 *  the text verbatim as a key, which made every prose wiki-link dead). */
marked.use({ extensions: [wikiLinkTokenExtension()] } as Parameters<typeof marked.use>[0]);

const lex = (md: string): MdToken[] => marked.lexer(md.replace(/\r\n/g, '\n')) as MdToken[];

/**
 * The fences home renders live. Display-only, and only when the fence carries
 * a body to display — a `viewer=` attribute wins over the bare lang, matching
 * lit's `fence.attrs.viewer || lang` precedence so one declaration selects the
 * same viewer on both surfaces.
 */
const renderFence: NonNullable<MdOpts['renderFence']> = ({ meta, body }) => {
  const lang = meta.attrs.viewer || meta.lang;
  if (!DISPLAY_VIEWERS.has(lang) || !body.trim()) return null;
  return <ViewerBody lang={lang} code={body} />;
};

/** The options every home markdown render shares — the host half of the core's
 *  contract. Callers add `base`/`onFactLink`/`factHref`/`tone`. */
function hostOpts(o: MdOpts): MdOpts {
  return { ...o, lex, resolveDocHref, renderFence };
}

/** Render ONE LINE of markdown INLINE — no block/`<p>` wrapping — for titles and
 *  headlines, which may carry bold, italic, inline code, or a link. Newlines are
 *  flattened to spaces (a title is a single line); falls back to plain text if
 *  the inline lexer throws. Colour/size are inherited from the heading it sits
 *  in — this only adds the emphasis marks, it never restyles the title. */
export function InlineMarkdown({ text, ...o }: { text: string } & MdOpts): React.JSX.Element {
  const src = String(text ?? '');
  // No markdown metacharacters → skip the lexer entirely (the overwhelmingly
  // common case, and byte-identical to a plain string).
  if (!/[*_`~[\]]/.test(src)) return <>{src}</>;
  let tokens: MdToken[] = [];
  try {
    tokens = marked.Lexer.lexInline(src.replace(/\s*\r?\n\s*/g, ' ')) as MdToken[];
  } catch {
    return <>{src}</>;
  }
  return <>{renderInline(tokens, 'inline', hostOpts(o))}</>;
}

export function SafeMarkdown({ text, tone = 'light', ...o }: { text: string } & MdOpts): React.JSX.Element {
  let tokens: MdToken[] = [];
  try {
    tokens = lex(text);
  } catch {
    return <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{text}</pre>;
  }
  // minWidth:0 lets this shrink below its content's intrinsic width inside a
  // flex/grid parent — without it, a wide <pre> child forces the whole column
  // (and the page) wider than the viewport instead of scrolling within itself.
  // `on-paper` swaps the palette's link/code/border colours to the cream-ground
  // variants (see static/index.html); dark is the default.
  return (
    <div className={tone === 'light' ? 'fact-md on-paper' : 'fact-md'} style={{ fontSize: '0.85rem', lineHeight: 1.5, overflowWrap: 'anywhere', minWidth: 0 }}>
      {renderBlocks(tokens, 'b', hostOpts({ ...o, tone }))}
    </div>
  );
}

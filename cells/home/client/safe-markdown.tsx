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
import { CodeEditor } from './editor';

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

/* ── fence-grain editing ───────────────────────────────────────────────────
 * The finest grain reading mode offers: edit ONE fence's body without opening
 * the whole fact. The core hands each top-level fence its source range, so a
 * commit is a splice back into the owning text — `md.slice(0,from) + next +
 * md.slice(to)` — and the owner writes exactly one fact.
 *
 * dotlit's cell WAS this unit ("a cell is the unit of authoring, execution,
 * linking and reuse"), and its defining bug class was that editing a
 * transcluded cell persisted a COPY inline. Splicing back into the owning fact
 * is the substrate's answer: the fence has one home, and the edit goes there.
 * A fence that renders from a `< source` reference is therefore NOT editable
 * here — its content belongs to the source fact, and editing must route there,
 * not fork a copy into the referrer.  */

/** Who owns the text a fence lives in, and how to write it back. */
export interface FenceEditTarget {
  /** Commit spliced text. Rejecting (throwing) leaves the editor open. */
  save: (next: string) => Promise<void>;
  /** The full source the ranges index into. */
  source: string;
}

const EDIT_CHIP: React.CSSProperties = {
  border: 'none', background: 'none', cursor: 'pointer', font: 'inherit',
  color: 'inherit', opacity: 0.7, padding: '0.1em 0.35em',
  // A tappable target, not a 10px glyph — this is a phone-first surface.
  minWidth: 32, minHeight: 24,
};

/** An editing session over one fence: which range, and the live draft. */
interface FenceDraft { from: number; to: number; body: string; lang: string }

/**
 * Keep the CLOSING fence on its own line.
 *
 * marked's fence `text` excludes the newline before the closing delimiter, so
 * for a non-empty body that newline sits outside the edited range and survives
 * a splice untouched. An EMPTY body has a zero-width range sitting directly on
 * the closing delimiter, so writing into it would yield ```` ```js\nbody``` ````
 * — a fence that no longer closes, silently swallowing the rest of the
 * document on the next parse. Add the separator when it isn't already there.
 */
export function closeSafely(body: string, source: string, to: number): string {
  if (body.endsWith('\n') || source[to] === '\n') return body;
  return `${body}\n`;
}

function useFenceEditing(edit: FenceEditTarget | undefined): {
  opts: Pick<MdOpts, 'renderFence' | 'fenceActions'>;
  error: string | null;
} {
  const [draft, setDraft] = React.useState<FenceDraft | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const editRef = React.useRef(edit);
  editRef.current = edit;

  if (!edit) return { opts: { renderFence }, error: null };

  const commit = async (body: string): Promise<void> => {
    const target = editRef.current;
    if (!target || !draft) return;
    setBusy(true);
    setError(null);
    const next = target.source.slice(0, draft.from) + closeSafely(body, target.source, draft.to) + target.source.slice(draft.to);
    try {
      await target.save(next);
      setDraft(null);
    } catch (err) {
      setError((err as Error)?.message || 'save failed');
    } finally {
      setBusy(false);
    }
  };

  const opts: Pick<MdOpts, 'renderFence' | 'fenceActions'> = {
    renderFence: (ctx) => {
      const open = draft && ctx.range && ctx.range.body.from === draft.from;
      if (open) {
        return (
          <FenceEditor
            key={`fence-edit-${draft.from}`}
            draft={draft}
            busy={busy}
            onChange={(body) => setDraft((d) => (d ? { ...d, body } : d))}
            onSave={(body) => void commit(body)}
            onCancel={() => { setDraft(null); setError(null); }}
          />
        );
      }
      return renderFence(ctx);
    },
    fenceActions: ({ meta, body, range }) => {
      // No range → a nested fence, whose offsets can't be trusted (see the
      // core's FenceRange doc). A `< source` fence belongs to another fact.
      if (!range || meta.source) return null;
      if (draft && range.body.from === draft.from) return null;
      return (
        <button
          type="button"
          className="fchip fc-edit"
          style={EDIT_CHIP}
          title="Edit this fence"
          aria-label="Edit this fence"
          onClick={() => { setError(null); setDraft({ from: range.body.from, to: range.body.to, body, lang: meta.attrs.viewer || meta.lang }); }}
        >
          ✎
        </button>
      );
    },
  };
  return { opts, error };
}

/** The in-place fence editor: the shared CodeMirror, sized to the fence. No
 *  `[[` completion — a fence body is code, and `[[` in code is literal. */
function FenceEditor({ draft, busy, onChange, onSave, onCancel }: {
  draft: FenceDraft;
  busy: boolean;
  onChange: (v: string) => void;
  onSave: (v: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const prose = draft.lang === 'md' || draft.lang === 'markdown';
  return (
    <div style={{ display: 'grid', gap: '0.4rem' }}>
      <CodeEditor
        value={draft.body}
        lang={prose ? 'markdown' : draft.lang === 'json' ? 'json' : 'text'}
        wikiComplete={prose}
        autofocus
        minRows={Math.min(20, Math.max(3, draft.body.split('\n').length + 1))}
        onChange={onChange}
        onSave={onSave}
        onCancel={onCancel}
        palette={{ text: 'inherit', dim: 'inherit', border: 'rgba(127,127,127,0.35)', inputBg: 'transparent' }}
      />
      <div style={{ display: 'flex', gap: '0.4rem', fontSize: '0.72rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
        <button type="button" onClick={() => onSave(draft.body)} disabled={busy} style={{ ...EDIT_CHIP, opacity: 1, border: '1px solid currentColor', borderRadius: 6, padding: '0.2em 0.7em' }}>
          {busy ? 'saving…' : 'save'}
        </button>
        <button type="button" onClick={onCancel} style={{ ...EDIT_CHIP, borderRadius: 6, padding: '0.2em 0.7em' }}>cancel</button>
      </div>
    </div>
  );
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

export function SafeMarkdown({ text, tone = 'light', edit, ...o }: { text: string; /** Enable fence-grain in-place editing over this body. */ edit?: FenceEditTarget } & MdOpts): React.JSX.Element {
  const fence = useFenceEditing(edit);
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
      {/* `0` opts into source-offset tracking — this IS the top-level render
          over the whole text, so a fence's range indexes the real document
          (see renderBlocks' `origin`). Without it fences render read-only. */}
      {renderBlocks(tokens, 'b', { ...hostOpts({ ...o, tone }), ...fence.opts }, edit ? 0 : undefined)}
      {fence.error ? (
        <div role="alert" style={{ color: '#b5523c', fontSize: '0.72rem', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', marginTop: '0.4rem' }}>
          fence save failed: {fence.error}
        </div>
      ) : null}
    </div>
  );
}

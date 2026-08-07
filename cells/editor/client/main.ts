/**
 * `@c15r/editor` — the ONE text editor, as a shared module.
 *
 * The same argument as `@c15r/viewers`, applied to authoring: home, lit and
 * canvas all need a code/prose editor, and three surfaces with three editors
 * is how the renderer forked. canvas runs a CodeMirror 5 off a `window`
 * global; lit deliberately shipped a plain textarea (ADR-0063 gem 3 — CM5 was
 * a bad mobile citizen and mobile-first is tenet #1); home's fact editor is a
 * textarea too. So there is one editor to add, not three, and it has to earn
 * mobile.
 *
 * CodeMirror 6, composed by hand rather than via `basicSetup`: the default
 * bundle carries gutters, search, lint and a desktop-shaped keymap, all of
 * which cost width and weight on a phone. What is here is the minimum that
 * makes prose and code pleasant, plus the two substrate-specific affordances
 * (`[[` fact completion, save/cancel keys).
 *
 * MOBILE NOTES — the details that decide whether this is usable on a phone:
 *  - 16px content font. iOS Safari zooms the viewport on focus for anything
 *    smaller, and that zoom is not undone on blur.
 *  - line wrapping ON, gutters OFF: horizontal scroll inside a bottom sheet is
 *    unusable, and a line-number gutter costs ~3 characters of a narrow column.
 *  - the editor grows with its content rather than scrolling internally, so
 *    the PAGE scrolls — one scroll context, which is what the docked peek
 *    stack already assumes.
 *  - `autocapitalize`/`autocorrect` are on for prose, off for code.
 *
 * Loaded lazily by its hosts (a dynamic import, like the viewers module and
 * the graph's three.js) — never on the read path. Reading a fact must not pay
 * for the ability to edit it.
 */
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder, drawSelection, highlightActiveLine, rectangularSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput, foldKeymap } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { json as jsonLang } from '@codemirror/lang-json';

/** A fact the `[[` completer can offer. */
export interface FactCompletion {
  key: string;
  /** Human label (a title); falls back to the key. */
  label?: string;
  /** Type name, shown as the completion's detail. */
  type?: string;
}

export type EditorLang = 'markdown' | 'json' | 'text';

export interface MountOptions {
  /** Initial document. */
  doc: string;
  /** Which grammar to light up. Unknown/absent → plain text. */
  lang?: EditorLang;
  readOnly?: boolean;
  placeholder?: string;
  autofocus?: boolean;
  /** Fired on every document change (debouncing is the host's business). */
  onChange?: (value: string) => void;
  /** Cmd/Ctrl-Enter and Cmd/Ctrl-S — the commit gesture. */
  onSave?: (value: string) => void;
  /** Escape — the abandon gesture. */
  onCancel?: () => void;
  /**
   * `[[` completions. Called with the text typed since `[[`; return the facts
   * to offer. Absent → no completion (an editor with no substrate behind it,
   * e.g. editing a code fence body).
   */
  completeFact?: (query: string) => Promise<FactCompletion[]>;
}

export interface EditorHandle {
  getValue: () => string;
  setValue: (v: string) => void;
  focus: () => void;
  destroy: () => void;
}

/* ── theme ──────────────────────────────────────────────────────────────
 * Deliberately colour-light: the editor inherits its host's palette through
 * `currentColor`/`transparent` rather than declaring one, so the SAME module
 * looks right on home's ink field, home's cream trailhead, and lit's paper.
 * Only structure and metrics are asserted here. */
const baseTheme = EditorView.theme({
  '&': {
    // 16px: below this, iOS Safari zooms on focus and never zooms back.
    fontSize: '16px',
    color: 'inherit',
    backgroundColor: 'transparent',
  },
  '.cm-content': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    padding: '0.55rem 0',
    caretColor: 'currentColor',
    // Comfortable line length for prose without fighting a narrow phone.
    lineHeight: '1.55',
  },
  '.cm-line': { padding: '0 0.15rem' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'currentColor', borderLeftWidth: '2px' },
  // The selection layer needs an explicit colour — `currentColor` at full
  // opacity would hide the text under it.
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'rgba(125,155,185,0.35)',
  },
  '.cm-activeLine': { backgroundColor: 'rgba(127,127,127,0.06)' },
  '.cm-tooltip': {
    border: '1px solid rgba(127,127,127,0.35)',
    borderRadius: '8px',
    backgroundColor: '#fffdf6',
    color: '#332e23',
    fontSize: '0.85rem',
    overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: '0.35rem 0.6rem',
    // 38px+ rows: a completion has to be tappable, not just clickable.
    minHeight: '2.2em',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5em',
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'rgba(46,94,67,0.14)',
    color: 'inherit',
  },
  '.cm-completionDetail': { marginLeft: 'auto', opacity: 0.6, fontStyle: 'normal', fontSize: '0.8em' },
});

/** `[[` — the substrate's cross-surface link syntax, completed from live facts.
 *  lit hand-rolled this against a textarea (a caret-position popover); as a
 *  real CodeMirror source it gets keyboard navigation, mobile tap targets and
 *  correct positioning for free. */
function wikiCompletions(complete: NonNullable<MountOptions['completeFact']>) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    // Match an OPEN `[[…` with no closing bracket yet, back to the line start.
    const before = ctx.matchBefore(/\[\[[^\]\n]*/);
    if (!before) return null;
    const query = before.text.slice(2);
    // Don't fire on a bare `[[` unless the user explicitly asked (Ctrl-Space),
    // so typing an ordinary `[[` in prose doesn't summon a full-slice list.
    if (!query && !ctx.explicit) return null;
    let hits: FactCompletion[] = [];
    try {
      hits = await complete(query);
    } catch {
      return null;
    }
    if (!hits.length) return null;
    return {
      from: before.from,
      // Re-run the source as the query grows rather than filtering the first
      // page client-side — the backend ranks semantically (ADR-0085).
      validFor: /^\[\[[^\]\n]*$/,
      options: hits.map((h) => ({
        label: `[[${h.label && h.label !== h.key ? `${h.key}|${h.label}` : h.key}]]`,
        displayLabel: h.label || h.key,
        detail: h.type,
        type: 'text',
      })),
    };
  };
}

function langExtension(lang: EditorLang | undefined): Extension {
  if (lang === 'markdown') return markdown();
  if (lang === 'json') return jsonLang();
  return [];
}

/**
 * Mount an editor into `host`. Returns a handle; call `destroy()` to release
 * it (the hosts do this on unmount).
 */
export function mount(host: HTMLElement, opts: MountOptions): EditorHandle {
  const editable = !opts.readOnly;
  const prose = opts.lang === 'markdown' || opts.lang === undefined || opts.lang === 'text';
  const langCompartment = new Compartment();

  // Save/cancel BEFORE the default keymap so Mod-Enter isn't swallowed.
  const commitKeys = keymap.of([
    {
      key: 'Mod-Enter',
      run: () => { opts.onSave?.(view.state.doc.toString()); return !!opts.onSave; },
    },
    {
      key: 'Mod-s',
      preventDefault: true,
      run: () => { opts.onSave?.(view.state.doc.toString()); return !!opts.onSave; },
    },
    {
      key: 'Escape',
      run: () => { opts.onCancel?.(); return !!opts.onCancel; },
    },
  ]);

  const extensions: Extension[] = [
    commitKeys,
    history(),
    drawSelection(),
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    // One scroll context: the editor grows, the page scrolls (see header).
    EditorView.lineWrapping,
    baseTheme,
    langCompartment.of(langExtension(opts.lang)),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, ...foldKeymap, indentWithTab]),
    EditorView.editable.of(editable),
    EditorState.readOnly.of(!editable),
    EditorView.contentAttributes.of({
      autocapitalize: prose ? 'sentences' : 'off',
      autocorrect: prose ? 'on' : 'off',
      spellcheck: prose ? 'true' : 'false',
      // A labelled region, so a screen reader announces what is being edited.
      'aria-label': opts.placeholder ?? 'editor',
    }),
  ];
  if (opts.placeholder) extensions.push(cmPlaceholder(opts.placeholder));
  if (editable) extensions.push(highlightActiveLine());
  if (opts.completeFact) {
    extensions.push(autocompletion({ override: [wikiCompletions(opts.completeFact)], activateOnTyping: true, icons: false }));
  }
  if (opts.onChange) {
    extensions.push(EditorView.updateListener.of((u) => { if (u.docChanged) opts.onChange?.(u.state.doc.toString()); }));
  }

  const view = new EditorView({
    state: EditorState.create({ doc: opts.doc, extensions }),
    parent: host,
  });

  if (opts.autofocus) {
    // Defer: focusing inside the same frame as a sheet/modal transition loses
    // the caret on iOS, and a mid-animation focus scrolls the page to nowhere.
    setTimeout(() => view.focus(), 40);
  }

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (v: string) => {
      if (v === view.state.doc.toString()) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

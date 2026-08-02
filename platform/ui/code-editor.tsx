/**
 * CodeEditor — the shared CodeMirror 6 editing floor for first-party React
 * surfaces (home's FactEditor; lit's block editor can adopt the same component
 * — that's why it lives in @parc/ui, not in a cell).
 *
 * Design constraints, in order:
 *  1. **Textarea is the floor.** SSR, no-JS, and any load failure render a
 *     plain controlled <textarea> — CodeMirror is a progressive enhancement,
 *     never a gate on editing (ADR-0063's mobile-first argument holds; CM6 is
 *     the ergonomic ceiling on top of it, not a replacement for the floor).
 *  2. **CM6 is lazy, from esm.sh.** @parc/ui is pre-bundled with react as its
 *     only external, so CodeMirror can't be a static import — the packages
 *     load on first mount from esm.sh (the same trusted-by-pin dynamic-import
 *     path home already uses for @c15r/viewers; esm.sh dedupes the shared
 *     @codemirror/state across packages). Cached module-level: one fetch per
 *     page, ~0 cost for every later editor.
 *  3. **The view is created ONCE; content moves by dispatch.** The proven
 *     React↔CM6 marriage (garden's Editor.tsx): no `key` remounts, no
 *     controlled-value fight — external `value` changes diff against the live
 *     doc and apply as a transaction; local edits flow up through one
 *     updateListener.
 *  4. **Mobile-first chrome**: 16px content font on coarse pointers (defeats
 *     iOS zoom-on-focus), safe-area inset on the scroller, wrapping not
 *     horizontal scroll, internal max-height so the page never traps scroll.
 *
 * The `[[wiki-link]]` autocomplete is INJECTED (`completeFactKeys`) — the
 * component knows the `[[` gesture, the surface knows how to search its
 * substrate (home: workspace.query; lit could pass its own doc list).
 */
import * as React from 'react';

const { useEffect, useRef, useState } = React;

export interface FactKeyCompletion {
  key: string;
  title?: string;
}

export interface CodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  /** Syntax mode. 'markdown' (prose facts) | 'json' (raw values) | 'text'. */
  language?: 'markdown' | 'json' | 'text';
  placeholder?: string;
  autoFocus?: boolean;
  /** Fallback-textarea rows / the CM min-height driver. */
  minRows?: number;
  /** The editor scrolls internally past this (default 60vh). */
  maxHeight?: string;
  /** Mod-Enter / Mod-S — the surface's save action. */
  onSave?: () => void;
  /** Async `[[` completions — return fact keys (+ display titles) for a query. */
  completeFactKeys?: (query: string) => Promise<FactKeyCompletion[]>;
  /** Wrapper chrome (border/background) — match the host's input styling. */
  style?: React.CSSProperties;
  spellCheck?: boolean;
}

/** Injected once; class-scoped so it can't leak. The coarse-pointer 16px rule
 *  is the iOS zoom-on-focus defeat; the safe-area padding on the SCROLLER
 *  (not the wrapper) is the inset people forget (garden's recipe). */
export const CODE_EDITOR_CSS = `
.parc-cm { min-width: 0; }
.parc-cm .cm-editor { background: transparent; }
.parc-cm .cm-editor.cm-focused { outline: none; }
.parc-cm .cm-scroller {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.85rem;
  line-height: 1.55;
  overflow: auto;
  padding-bottom: env(safe-area-inset-bottom);
}
.parc-cm .cm-content { padding: 0.55rem 0.15rem; }
.parc-cm .cm-line { overflow-wrap: anywhere; }
.parc-cm .cm-tooltip { font-size: 0.8rem; max-width: min(92vw, 28rem); }
.parc-cm .cm-tooltip-autocomplete ul li { padding: 0.35rem 0.5rem; }
@media (pointer: coarse) {
  .parc-cm .cm-scroller { font-size: 16px; }
  .parc-cm .cm-tooltip-autocomplete ul li { min-height: 38px; }
}
`;

function injectCss(): void {
  if (typeof document === 'undefined' || document.getElementById('parc-code-editor-css')) return;
  const s = document.createElement('style');
  s.id = 'parc-code-editor-css';
  s.textContent = CODE_EDITOR_CSS;
  document.head.appendChild(s);
}

// ── the lazy CM6 bundle ─────────────────────────────────────────────
// Major-version pins; esm.sh resolves the shared @codemirror/state to one
// instance across these (the pattern garden validated in production).
const CM_STATE_URL = 'https://esm.sh/@codemirror/state@6';
const CM_VIEW_URL = 'https://esm.sh/@codemirror/view@6';
const CM_COMMANDS_URL = 'https://esm.sh/@codemirror/commands@6';
const CM_LANGUAGE_URL = 'https://esm.sh/@codemirror/language@6';
const CM_AUTOCOMPLETE_URL = 'https://esm.sh/@codemirror/autocomplete@6';
const CM_LANG_MD_URL = 'https://esm.sh/@codemirror/lang-markdown@6';
const CM_LANG_JSON_URL = 'https://esm.sh/@codemirror/lang-json@6';

/* eslint-disable @typescript-eslint/no-explicit-any -- the CM modules arrive
 * over dynamic import (no local types); the component's own surface is typed. */
type Cm = any;

// A variable specifier keeps TS/esbuild from trying to resolve the URL as a
// local module; the browser does the real fetch (script-src allows esm.sh).
const dynImport = (url: string): Promise<Cm> => import(/* @vite-ignore */ url);

let cmBundle: Promise<Cm> | null = null;
const loadCm = (): Promise<Cm> =>
  (cmBundle ??= Promise.all([
    dynImport(CM_STATE_URL),
    dynImport(CM_VIEW_URL),
    dynImport(CM_COMMANDS_URL),
    dynImport(CM_LANGUAGE_URL),
    dynImport(CM_AUTOCOMPLETE_URL),
    dynImport(CM_LANG_MD_URL),
    dynImport(CM_LANG_JSON_URL),
  ]).then(([state, view, commands, language, autocomplete, langMd, langJson]) => ({
    state, view, commands, language, autocomplete, langMd, langJson,
  })));

/** The `[[` completion source: scan back on the current line for an unclosed
 *  `[[`, hand the fragment to the surface's fetcher, complete `key]]` (eating
 *  a pre-typed `]]` when the caret sits before one). Garden's Editor.tsx
 *  pattern, generalised over the injected fetcher. */
function wikiSource(cm: Cm, fetchKeys: (q: string) => Promise<FactKeyCompletion[]>) {
  return async (ctx: Cm): Promise<Cm | null> => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before: string = line.text.slice(0, ctx.pos - line.from);
    const open = before.lastIndexOf('[[');
    if (open < 0) return null;
    const frag = before.slice(open + 2);
    if (frag.includes(']]') || frag.includes('[')) return null;
    if (!ctx.explicit && frag.length < 1) return null;
    let items: FactKeyCompletion[] = [];
    try {
      items = await fetchKeys(frag);
    } catch {
      return null;
    }
    if (!items.length) return null;
    return {
      from: line.from + open + 2,
      options: items.slice(0, 20).map((it) => ({
        label: it.key,
        detail: it.title,
        apply: (view: Cm, _c: Cm, from: number, to: number) => {
          const after = view.state.doc.sliceString(to, to + 2);
          const insert = it.key + (after === ']]' ? '' : ']]');
          view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length + (after === ']]' ? 2 : 0) } });
        },
      })),
      validFor: /^[^\]]*$/,
    };
  };
}

/**
 * The editor. Renders a controlled <textarea> until CodeMirror is live (and
 * forever if it never loads); then the same value continues in CM6 with no
 * teardown on later renders. External `value` changes (a fresh fact, a reset)
 * are applied by diffing against the live doc.
 */
export function CodeEditor({
  value,
  onChange,
  language = 'text',
  placeholder,
  autoFocus = false,
  minRows = 6,
  maxHeight = '60vh',
  onSave,
  completeFactKeys,
  style,
  spellCheck,
}: CodeEditorProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<Cm | null>(null);
  const [ready, setReady] = useState(false);
  // Latest props, readable from inside long-lived CM closures without
  // recreating the view (the create-once contract).
  const valueRef = useRef(value);
  const cbRef = useRef({ onChange, onSave, completeFactKeys });
  valueRef.current = value;
  cbRef.current = { onChange, onSave, completeFactKeys };

  useEffect(() => {
    let disposed = false;
    void loadCm()
      .then((cm) => {
        if (disposed || !hostRef.current) return;
        injectCss();
        const { EditorState } = cm.state;
        const { EditorView, keymap, placeholder: cmPlaceholder } = cm.view;
        const saveBinding = {
          key: 'Mod-Enter',
          run: (): boolean => {
            if (!cbRef.current.onSave) return false;
            cbRef.current.onSave();
            return true;
          },
        };
        const saveBinding2 = { ...saveBinding, key: 'Mod-s', preventDefault: true };
        const extensions: Cm[] = [
          cm.commands.history(),
          keymap.of([
            saveBinding,
            saveBinding2,
            { key: 'Tab', run: cm.autocomplete.acceptCompletion },
            ...cm.autocomplete.completionKeymap,
            ...cm.commands.defaultKeymap,
            ...cm.commands.historyKeymap,
          ]),
          EditorView.lineWrapping,
          cm.language.syntaxHighlighting(cm.language.defaultHighlightStyle, { fallback: true }),
          EditorView.updateListener.of((u: Cm) => {
            if (!u.docChanged) return;
            const next = u.state.doc.toString();
            if (next !== valueRef.current) {
              valueRef.current = next;
              cbRef.current.onChange(next);
            }
          }),
          EditorView.theme({
            '&': { backgroundColor: 'transparent', maxHeight },
            '.cm-scroller': { minHeight: `${Math.max(2, minRows) * 1.4}em` },
          }),
          EditorView.contentAttributes.of({
            spellcheck: String(spellCheck ?? language === 'markdown'),
            autocapitalize: language === 'markdown' ? 'sentences' : 'off',
            autocorrect: language === 'markdown' ? 'on' : 'off',
          }),
        ];
        if (placeholder) extensions.push(cmPlaceholder(placeholder));
        if (language === 'markdown') extensions.push(cm.langMd.markdown());
        else if (language === 'json') extensions.push(cm.langJson.json());
        if (cbRef.current.completeFactKeys) {
          extensions.push(
            cm.autocomplete.autocompletion({
              override: [wikiSource(cm, (q: string) => cbRef.current.completeFactKeys?.(q) ?? Promise.resolve([]))],
              activateOnTyping: true,
            }),
          );
        }
        const view = new EditorView({
          state: EditorState.create({ doc: valueRef.current, extensions }),
          parent: hostRef.current,
        });
        viewRef.current = view;
        setReady(true);
        if (autoFocus) view.focus();
      })
      .catch(() => {
        /* CM unavailable (offline/CSP) — the textarea floor stays up */
      });
    return () => {
      disposed = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // Recreate only when the MODE changes — value flows via dispatch below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // External value changes (reset, fresh fact) — apply as a transaction.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !ready) return;
    const cur = view.state.doc.toString();
    if (value !== cur) view.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value, ready]);

  return (
    <div className="parc-cm" style={{ minWidth: 0, ...style }}>
      <div ref={hostRef} style={{ display: ready ? 'block' : 'none' }} />
      {!ready ? (
        <textarea
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
          rows={Math.max(2, minRows)}
          placeholder={placeholder}
          spellCheck={spellCheck ?? language === 'markdown'}
          autoFocus={autoFocus}
          onKeyDown={onSave ? (ev) => { if ((ev.metaKey || ev.ctrlKey) && (ev.key === 'Enter' || ev.key === 's')) { ev.preventDefault(); onSave(); } } : undefined}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: 'inherit',
            padding: '0.55rem 0.15rem',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.85rem',
            lineHeight: 1.55,
            resize: 'vertical',
          }}
        />
      ) : null}
    </div>
  );
}

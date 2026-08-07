/**
 * The shared editor (`@c15r/editor`), hosted in home.
 *
 * The authoring twin of `./viewers`: a dynamic import of one validated
 * CodeMirror 6 module, loaded ONLY when someone actually starts editing — the
 * read path never pays for it. Same shape as the viewers host and the graph's
 * three.js, for the same reason: an editor is ~300KB of the wrong thing to
 * ship to a reader.
 *
 * Two contracts this wrapper owns:
 *
 *  - DEGRADE, never block. If the module can't load (offline, CDN down, cell
 *    unreachable) the editor falls back to a plain textarea with the same
 *    value/save/cancel wiring. Being unable to reach a CDN must never mean
 *    being unable to edit your own facts.
 *  - Mount ONCE per edit session. The document is handed over at mount and the
 *    editor owns it from then on, reporting edits up via `onChange` — the same
 *    reasoning as `FederatedFormFrame`: re-mounting on every keystroke rebuilds
 *    the editor's DOM and drops the caret mid-word.
 */
import * as React from 'react';
import { mcpCall } from './lib';

const { useState, useEffect } = React;

const EDITOR_URL = 'https://parc.land/@c15r/editor/app.js';

export type EditorLang = 'markdown' | 'json' | 'text';

interface FactCompletion { key: string; label?: string; type?: string }
interface EditorHandle { getValue: () => string; setValue: (v: string) => void; focus: () => void; destroy: () => void }
interface MountOptions {
  doc: string;
  lang?: EditorLang;
  readOnly?: boolean;
  placeholder?: string;
  autofocus?: boolean;
  onChange?: (value: string) => void;
  onSave?: (value: string) => void;
  onCancel?: () => void;
  completeFact?: (query: string) => Promise<FactCompletion[]>;
}
type EditorModule = { mount: (host: HTMLElement, opts: MountOptions) => EditorHandle };

let editorMod: Promise<EditorModule> | null = null;
const loadEditor = (): Promise<EditorModule> =>
  (editorMod ??= import(/* @vite-ignore */ EDITOR_URL) as Promise<EditorModule>);

/**
 * `[[` completions, from the substrate's own ranking. `workspace.query` with
 * free text is the semantically-ranked read (ADR-0085), so what the popup
 * offers is what the slice thinks you mean — not a prefix match over keys.
 */
async function completeFact(query: string): Promise<FactCompletion[]> {
  const input: Record<string, unknown> = { limit: 8 };
  if (query.trim()) input.text = query.trim();
  const r = await mcpCall('read', 'workspace.query', input);
  if (!r.ok) return [];
  const entries = (r.value as { entries?: Array<{ key: string; value?: unknown; _meta?: { type?: string | null } }> } | null)?.entries ?? [];
  return entries.map((e) => {
    const v = e.value as Record<string, unknown> | undefined;
    const label = typeof v?.title === 'string' ? v.title : typeof v?.name === 'string' ? v.name : undefined;
    return { key: e.key, label, type: e._meta?.type ?? undefined };
  });
}

export interface CodeEditorProps {
  /** The document to edit. Read at MOUNT; later changes flow through onChange. */
  value: string;
  lang?: EditorLang;
  placeholder?: string;
  autofocus?: boolean;
  /** Offer `[[` fact completion (prose surfaces; off for a code fence body). */
  wikiComplete?: boolean;
  onChange: (v: string) => void;
  /** Mod-Enter / Mod-S. */
  onSave?: (v: string) => void;
  /** Escape. */
  onCancel?: () => void;
  /** Rows for the textarea fallback / the editor's minimum height. */
  minRows?: number;
  /** Palette for the fallback textarea + the editor's frame. */
  palette: { text: string; dim: string; border: string; inputBg: string };
}

export function CodeEditor({
  value,
  lang = 'markdown',
  placeholder,
  autofocus,
  wikiComplete = true,
  onChange,
  onSave,
  onCancel,
  minRows = 6,
  palette,
}: CodeEditorProps): React.JSX.Element {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const handleRef = React.useRef<EditorHandle | null>(null);
  const [failed, setFailed] = useState(false);
  // Live callback refs: the editor mounts once, so it must never close over a
  // stale onChange/onSave from the first render.
  const cbs = React.useRef({ onChange, onSave, onCancel });
  cbs.current = { onChange, onSave, onCancel };
  // The document at MOUNT time only — deliberately not a dependency below.
  const initial = React.useRef(value);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    loadEditor()
      .then((mod) => {
        if (disposed || !hostRef.current) return;
        handleRef.current = mod.mount(hostRef.current, {
          doc: initial.current,
          lang,
          placeholder,
          autofocus,
          onChange: (v) => cbs.current.onChange(v),
          onSave: cbs.current.onSave ? (v) => cbs.current.onSave?.(v) : undefined,
          onCancel: cbs.current.onCancel ? () => cbs.current.onCancel?.() : undefined,
          completeFact: wikiComplete ? completeFact : undefined,
        });
      })
      .catch(() => { if (!disposed) setFailed(true); });
    return () => {
      disposed = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
    // Mount-once (see the header). A genuinely different document gets a new
    // `key` from the caller, which remounts this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  if (failed) {
    // The floor: editing still works with no editor module at all.
    return (
      <textarea
        defaultValue={initial.current}
        onChange={(ev) => onChange(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') onCancel?.();
          if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) onSave?.((ev.target as HTMLTextAreaElement).value);
        }}
        rows={minRows}
        spellCheck={lang === 'markdown'}
        placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '0.55rem',
          // 16px — below this iOS zooms the viewport on focus (see the module).
          fontSize: '16px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          border: `1px solid ${palette.border}`, borderRadius: 6,
          background: palette.inputBg, color: palette.text,
        }}
      />
    );
  }

  return (
    <div
      ref={hostRef}
      style={{
        border: `1px solid ${palette.border}`,
        borderRadius: 6,
        background: palette.inputBg,
        color: palette.text,
        padding: '0 0.5rem',
        minHeight: `${minRows * 1.55 + 1}em`,
        overflow: 'hidden',
      }}
    />
  );
}

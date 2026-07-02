/**
 * ADR-0044 Inc 5: the field computer, split from app.tsx (moved verbatim) —
 * the command palette console over $catalog, arg entry (schema form /
 * federated form / raw JSON), the output stack, and the machine housing.
 */
import * as React from 'react';
import { theme, SchemaForm, isFormable, type FormFieldSchema, type FormPalette } from '@parc/ui';
import { authFetch } from './bridge';
import { getJson, mcpCall, computerUrl } from './lib';
import { FederatedRendererFrame, FederatedFormFrame } from './federated';
import { factHref, typeIcon, factTitle, FactBody, type ListEntry } from './facts';
import { CONSOLE_RESULT_EVENT } from './graph';

const { useState, useEffect } = React;

// ─── the field computer (the console, housed) ──────────────────────
//
// The one deliberately-technical object in the warm room: the raw read/act
// console, OAuth discovery, and the resource probe live inside a dark
// machine housing — green phosphor on deep pine, like the radio at the
// ranger station. Power users open the lid; everyone else never needs to.

const machine = {
  housing: '#13241f',
  bezel: '#0b1a16',
  screen: '#0a1f1a',
  text: '#cfe3c0',
  dim: '#7f9a82',
  green: '#7fc97f',
  border: '#2c4a3c',
} as const;

/** The schema-form floor (ADR-0041 Inc 2), in the machine's own dark palette —
 *  so a generated form looks native inside the housing, not pasted from the
 *  light park theme the rest of home uses. */
const machineFormPalette: FormPalette = {
  text: machine.text,
  dim: machine.dim,
  border: machine.border,
  inputBg: machine.screen,
  accent: machine.green,
  danger: '#e08c7a',
  mono: theme.mono,
  sans: theme.mono, // the machine's voice stays monospace even for prose fields
};

interface Capability {
  target: string;
  kind: 'read' | 'act';
  description: string;
  scope: string | null;
  inputSchema?: FormFieldSchema;
  /** ADR-0041 Inc 3: a cell-authored argument form for this capability. */
  ui?: { form?: string; as?: string };
}

/** A starter argument object from a capability's input schema — required keys
 *  (or, lacking any, every declared key) pre-seeded with a type-appropriate
 *  empty value. Shared by the JSON-textarea view (stringified) and the
 *  schema-form view (used as-is); both views edit the SAME underlying shape. */
function argSkeletonObject(schema?: Capability['inputSchema']): Record<string, unknown> {
  const props = schema?.properties ?? {};
  const keys = schema?.required?.length ? schema.required : Object.keys(props);
  const obj: Record<string, unknown> = {};
  for (const k of keys) {
    const t = props[k]?.type;
    obj[k] = t === 'number' ? 0 : t === 'boolean' ? false : t === 'array' ? [] : t === 'object' ? {} : '';
  }
  return obj;
}
/** A starter JSON argument object from a capability's input schema. */
function argSkeleton(schema?: Capability['inputSchema']): string {
  return JSON.stringify(argSkeletonObject(schema), null, 2);
}

// A unified palette command: every capability from $catalog plus a couple of
// built-in probes (whoami, oauth discovery). One model, one output stack.
interface Cmd {
  id: string;
  ns: string;
  verb: string;
  label: string;
  kind: 'read' | 'act' | 'probe';
  scope: string | null;
  description: string;
  schema?: Capability['inputSchema'];
  /** ADR-0041 Inc 3: a cell-authored argument form, if this capability declares one. */
  ui?: Capability['ui'];
  needsArgs: boolean;
  run: (input: unknown) => Promise<{ ok: boolean; value: unknown }>;
  search: string;
}

interface Output {
  n: number;
  label: string;
  kind: Cmd['kind'];
  ok: boolean;
  value: unknown;
  at: number;
  /** The `key` arg the command was called with, if any — a fallback identity for
   *  a fact-shaped result whose value omits its own key (e.g. `workspace.peek`
   *  returns `{value,_meta}` only; the caller already knows the key it asked for). */
  argsKey?: string;
}

/** Subsequence fuzzy match (canvas palette's model): all query chars in order. */
function fuzzy(text: string, q: string): boolean {
  let ti = 0;
  let qi = 0;
  while (ti < text.length && qi < q.length) {
    if (text[ti] === q[qi]) qi++;
    ti++;
  }
  return qi === q.length;
}

const PROBE_CMDS: Cmd[] = [
  {
    id: 'probe:whoami',
    ns: 'probe',
    verb: 'whoami',
    label: 'whoami',
    kind: 'probe',
    scope: null,
    description: 'Who the session is — GET /mcp/whoami.',
    needsArgs: false,
    search: 'probe whoami identity who am i',
    run: async () => {
      // `/mcp/whoami` requires the session bearer — use authFetch (not the bare
      // getJson the public oauth probe uses), or the gateway returns invalid_token.
      const res = await authFetch('/mcp/whoami');
      let body: unknown;
      try { body = await res.json(); } catch { body = await res.text(); }
      return { ok: res.status === 200, value: body };
    },
  },
  {
    id: 'probe:oauth',
    ns: 'probe',
    verb: 'oauth discovery',
    label: 'oauth discovery',
    kind: 'probe',
    scope: null,
    description: 'The RFC 8414 authorization-server metadata.',
    needsArgs: false,
    search: 'probe oauth discovery metadata well-known issuer',
    run: async () => {
      const r = await getJson('/.well-known/oauth-authorization-server');
      const m = (r.body ?? {}) as Record<string, unknown>;
      return {
        ok: r.status === 200,
        value: r.status === 200 ? { issuer: m.issuer, authorization_endpoint: m.authorization_endpoint, token_endpoint: m.token_endpoint, registration_endpoint: m.registration_endpoint } : m,
      };
    },
  },
];

function capToCmd(cap: Capability): Cmd {
  const dot = cap.target.lastIndexOf('.');
  const ns = dot > 0 ? cap.target.slice(0, dot) : cap.target;
  const verb = cap.target.slice(dot + 1);
  // A bespoke form (ADR-0041 Inc 3) may cover args the declared schema doesn't
  // even list (a minimal/empty inputSchema, fully driven by the custom UI) —
  // such a target still needs the focused arg-entry view, not an immediate
  // zero-arg call.
  const needsArgs = Object.keys(cap.inputSchema?.properties ?? {}).length > 0 || !!cap.ui?.form;
  return {
    id: cap.target,
    ns,
    verb,
    label: cap.target,
    kind: cap.kind,
    scope: cap.scope,
    description: cap.description,
    schema: cap.inputSchema,
    ui: cap.ui,
    needsArgs,
    search: `${cap.target} ${cap.description} ${cap.scope ?? ''}`.toLowerCase(),
    run: (input) => mcpCall(cap.kind === 'read' ? 'read' : 'act', cap.target, input),
  };
}

const kindColor = (k: Cmd['kind']): string => (k === 'act' ? machine.green : machine.dim);

/** A pill in the machine's voice (kind / scope / namespace). */
function MonoPill({ children, color }: { children: React.ReactNode; color?: string }): React.JSX.Element {
  return (
    <span style={{ color: color ?? machine.dim, fontFamily: theme.mono, fontSize: '0.7rem', border: `1px solid ${machine.border}`, borderRadius: 999, padding: '0 0.45rem', whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

/**
 * The console as a command palette (interaction modelled on @c15r/canvas):
 * type to fuzzy-filter every capability; empty shows recents + namespace
 * chips for progressive disclosure; pick a command to reveal its args (or run
 * straight away); results stack below, newest first. The human drives the same
 * read/act wire an agent does.
 */
export function Console({ authed, seed }: { authed: boolean; seed?: { q: string; n: number } | null }): React.JSX.Element {
  const [cmds, setCmds] = useState<Cmd[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [focused, setFocused] = useState<Cmd | null>(null);
  const [args, setArgs] = useState('{}');
  const [formValue, setFormValue] = useState<Record<string, unknown>>({});
  // 'form' when the schema supports it (the default — ADR-0041 Inc 2); 'json' is
  // the raw-JSON fallback/power-user escape hatch, always available via toggle.
  const [rawJson, setRawJson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const counter = React.useRef(0);

  // ADR-0049: a contextual verb chip (palette selection) seeds the search box —
  // the nonce lets the same target re-seed after the user edits the query.
  useEffect(() => {
    if (!seed) return;
    setQuery(seed.q);
    setFocused(null);
    setSel(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.n]);

  useEffect(() => {
    if (!authed) return;
    let live = true;
    // `{detail:'full'}` returns the flat { capabilities:[…] } the console maps; a
    // bare $catalog returns the ADR-0033 grouped summary ({ cells:[{capabilities}] })
    // with no top-level .capabilities — which silently emptied the console. Request
    // full, and flatten the grouped shape too so a future default change can't
    // re-break it.
    mcpCall('read', '$catalog', { detail: 'full' })
      .then((r) => {
        if (!live) return;
        if (!r.ok) {
          setErr(typeof r.value === 'string' ? r.value : 'error');
          setCmds([...PROBE_CMDS]);
          return;
        }
        const v = r.value as { capabilities?: Capability[]; cells?: Array<{ capabilities?: Capability[] }> };
        const caps = v.capabilities ?? (v.cells ?? []).flatMap((c) => c.capabilities ?? []);
        setCmds([...caps.map(capToCmd), ...PROBE_CMDS]);
      })
      .catch((e) => {
        if (live) {
          setErr(String(e));
          setCmds([...PROBE_CMDS]);
        }
      });
    return () => {
      live = false;
    };
  }, [authed]);

  const q = query.trim().toLowerCase();
  const filtered = React.useMemo(() => {
    const all = cmds ?? [];
    if (!q) return [];
    return all
      .filter((c) => fuzzy(c.search, q) || c.search.includes(q))
      .sort((a, b) => {
        const ae = a.search.includes(q);
        const be = b.search.includes(q);
        if (ae !== be) return ae ? -1 : 1;
        return a.label.length - b.label.length;
      })
      .slice(0, 12);
  }, [cmds, q]);

  // Namespaces with counts — the "what's available" overview when idle.
  const namespaces = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cmds ?? []) m.set(c.ns, (m.get(c.ns) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [cmds]);

  const select = (cmd: Cmd): void => {
    if (cmd.needsArgs) {
      setFocused(cmd);
      const skeleton = argSkeletonObject(cmd.schema);
      setFormValue(skeleton);
      setArgs(JSON.stringify(skeleton, null, 2));
      // A schema the form floor can't walk at all (no object/properties — rare,
      // but some targets accept a bare scalar or an open `additionalProperties`
      // bag) starts in raw JSON UNLESS a cell-authored form (ADR-0041 Inc 3)
      // covers it regardless of the declared schema's shape.
      setRawJson(!cmd.ui?.form && !isFormable(cmd.schema));
    } else {
      void invoke(cmd, {});
    }
  };

  const invoke = async (cmd: Cmd, input: unknown): Promise<void> => {
    setBusy(true);
    const argsKey = input && typeof input === 'object' && typeof (input as { key?: unknown }).key === 'string' ? (input as { key: string }).key : undefined;
    try {
      const r = await cmd.run(input);
      counter.current += 1;
      setOutputs((prev) => [{ n: counter.current, label: cmd.label, kind: cmd.kind, ok: r.ok, value: r.value, at: Date.now(), argsKey }, ...prev].slice(0, 40));
      // ADR-0047 v2: results reach beyond the tape — the graph listens and
      // highlights/fits whatever facts the result names.
      window.dispatchEvent(new CustomEvent(CONSOLE_RESULT_EVENT, { detail: { ok: r.ok, value: r.value } }));
    } catch (e) {
      counter.current += 1;
      setOutputs((prev) => [{ n: counter.current, label: cmd.label, kind: cmd.kind, ok: false, value: String(e), at: Date.now() }, ...prev]);
    } finally {
      setBusy(false);
      setFocused(null);
      setQuery('');
      setSel(0);
    }
  };

  const runFocused = (): void => {
    if (!focused) return;
    if (!rawJson) {
      void invoke(focused, formValue);
      return;
    }
    let input: unknown;
    try {
      input = args.trim() ? JSON.parse(args) : {};
    } catch {
      counter.current += 1;
      setOutputs((prev) => [{ n: counter.current, label: focused.label, kind: focused.kind, ok: false, value: 'Invalid JSON in arguments', at: Date.now() }, ...prev]);
      return;
    }
    void invoke(focused, input);
  };

  /** Toggle form ↔ raw-JSON, carrying the same value across (best-effort: a hand
   *  edited JSON view that doesn't parse just stays in JSON mode rather than
   *  losing the user's in-progress edit). */
  const toggleRawJson = (): void => {
    if (rawJson) {
      try {
        const parsed = args.trim() ? JSON.parse(args) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          setFormValue(parsed as Record<string, unknown>);
          setRawJson(false);
        }
      } catch {
        /* invalid JSON — stay in raw mode, the textarea keeps the user's edit */
      }
    } else {
      setArgs(JSON.stringify(formValue, null, 2));
      setRawJson(true);
    }
  };

  const inputColor = machine.text;
  const screen: React.CSSProperties = { background: machine.screen, border: `1px solid ${machine.border}`, borderRadius: 6, color: machine.text, fontFamily: theme.mono };

  // ── focused: one command's arg entry ──
  if (focused) {
    return (
      <div style={{ display: 'grid', gap: '0.8rem' }}>
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              onClick={() => setFocused(null)}
              style={{ background: 'none', border: 'none', color: machine.dim, fontFamily: theme.mono, fontSize: '0.8rem', cursor: 'pointer', padding: 0 }}
            >
              ‹ back
            </button>
            <code style={{ color: machine.text, fontFamily: theme.mono, fontSize: '0.9rem' }}>{focused.label}</code>
            <MonoPill color={kindColor(focused.kind)}>{focused.kind}</MonoPill>
            {focused.scope ? <MonoPill>{focused.scope}</MonoPill> : null}
          </div>
          {focused.description ? <span style={{ color: machine.dim, fontSize: '0.8rem' }}>{focused.description}</span> : null}
          <div
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                runFocused();
              }
            }}
            style={{ display: 'grid', gap: '0.5rem' }}
          >
            {!rawJson && focused.ui?.form ? (
              <FederatedFormFrame
                uri={focused.ui.form}
                type={focused.ui.as || focused.id}
                schema={focused.schema}
                initialValue={formValue}
                onChange={setFormValue}
                placeholder={
                  <div style={{ ...screen, padding: '0.65rem' }}>
                    {isFormable(focused.schema) ? (
                      <SchemaForm schema={focused.schema} value={formValue} onChange={setFormValue} palette={machineFormPalette} />
                    ) : (
                      <span style={{ color: machine.dim, fontSize: '0.78rem' }}>loading form…</span>
                    )}
                  </div>
                }
              />
            ) : !rawJson && isFormable(focused.schema) ? (
              <div style={{ ...screen, padding: '0.65rem' }}>
                <SchemaForm schema={focused.schema} value={formValue} onChange={setFormValue} palette={machineFormPalette} />
              </div>
            ) : (
              <textarea
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                rows={Math.min(12, Math.max(2, args.split('\n').length))}
                spellCheck={false}
                autoFocus
                style={{ ...screen, width: '100%', boxSizing: 'border-box', padding: '0.55rem', fontSize: '0.8rem' }}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button
                onClick={runFocused}
                disabled={busy}
                style={{ padding: '0.45rem 0.9rem', borderRadius: 6, border: `1px solid ${machine.green}`, background: 'transparent', color: machine.green, fontFamily: theme.mono, fontSize: '0.8rem', cursor: busy ? 'wait' : 'pointer' }}
              >
                {busy ? 'Running…' : `run · ${focused.kind}("${focused.label}")  ⌘↵`}
              </button>
              {focused.ui?.form || isFormable(focused.schema) ? (
                <button
                  onClick={toggleRawJson}
                  style={{ background: 'none', border: 'none', color: machine.dim, fontFamily: theme.mono, fontSize: '0.74rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                >
                  {rawJson ? 'form' : 'raw json'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        <OutputStack outputs={outputs} onClear={() => setOutputs([])} />
      </div>
    );
  }

  // ── browse: search + (recents-less) namespace overview or filtered list ──
  return (
    <div style={{ display: 'grid', gap: '0.8rem' }}>
      <div style={{ ...screen, display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.7rem' }}>
        <span style={{ color: machine.green, fontFamily: theme.mono }}>›</span>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => (filtered.length ? (s + 1) % filtered.length : 0));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => (filtered.length ? (s - 1 + filtered.length) % filtered.length : 0));
            } else if (e.key === 'Enter' && filtered[sel]) {
              e.preventDefault();
              select(filtered[sel]);
            } else if (e.key === 'Escape') {
              setQuery('');
            }
          }}
          placeholder="Type a command — workspace.query, cells.list, whoami…"
          spellCheck={false}
          autoComplete="off"
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: inputColor, fontFamily: theme.mono, fontSize: '0.85rem' }}
        />
        {query ? (
          <button onClick={() => setQuery('')} style={{ background: 'none', border: 'none', color: machine.dim, cursor: 'pointer', fontSize: '1rem' }}>
            ×
          </button>
        ) : null}
      </div>

      {err && !cmds?.length ? <span style={{ color: '#e08c7a', fontFamily: theme.mono, fontSize: '0.8rem' }}>{err}</span> : null}
      {!cmds && !err ? <p style={{ color: machine.dim, margin: 0 }}>Loading capabilities…</p> : null}

      {q ? (
        filtered.length === 0 ? (
          <p style={{ color: machine.dim, margin: 0, fontSize: '0.82rem' }}>No command matches “{query}”.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.15rem' }}>
            {filtered.map((c, i) => (
              <li key={c.id}>
                <button
                  onClick={() => select(c)}
                  onMouseEnter={() => setSel(i)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    flexWrap: 'wrap',
                    padding: '0.4rem 0.55rem',
                    borderRadius: 6,
                    border: '1px solid transparent',
                    background: i === sel ? 'rgba(127,201,127,0.10)' : 'transparent',
                    borderColor: i === sel ? machine.border : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <code style={{ color: machine.text, fontFamily: theme.mono, fontSize: '0.82rem' }}>{c.label}</code>
                  <MonoPill color={kindColor(c.kind)}>{c.kind}</MonoPill>
                  {c.needsArgs ? <span style={{ color: machine.dim, fontFamily: theme.mono, fontSize: '0.68rem' }}>args</span> : null}
                  <span style={{ color: machine.dim, fontSize: '0.76rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                    {c.description}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        // idle: the overview — namespaces as chips (progressive disclosure)
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <span style={{ color: machine.dim, fontFamily: theme.mono, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {cmds ? `${cmds.length} commands` : '…'}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
            {namespaces.map(([ns, n]) => (
              <button
                key={ns}
                onClick={() => {
                  setQuery(ns + '.');
                  setSel(0);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.25rem 0.6rem', borderRadius: 999, border: `1px solid ${machine.border}`, background: 'transparent', color: machine.text, fontFamily: theme.mono, fontSize: '0.78rem', cursor: 'pointer' }}
              >
                {ns}
                <span style={{ color: machine.dim }}>{n}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <OutputStack outputs={outputs} onClear={() => setOutputs([])} />
    </div>
  );
}

/** A tool result's federation directive (ADR-0039 Inc 2): `_render:{renderer,as}`. */
function renderDirective(v: unknown): { renderer: string; as: string } | null {
  if (!v || typeof v !== 'object') return null;
  const r = (v as { _render?: { renderer?: string; as?: string } })._render;
  return r && typeof r.renderer === 'string' && r.renderer.indexOf('ui://') === 0 ? { renderer: r.renderer, as: r.as || r.renderer } : null;
}
/** A single-fact-shaped result — `workspace.peek`'s `{value,_meta}` (ENTRY_SCHEMA). */
function isFactShaped(v: unknown): v is { key?: string; value: unknown; _meta?: ListEntry['_meta'] } {
  return !!v && typeof v === 'object' && 'value' in (v as object) && '_meta' in (v as object);
}
/** Normalize a `{entries: {...}|[...]}` result (query/search/list shapes) to a keyed list. */
function entriesOf(v: unknown): ListEntry[] {
  const e = v && typeof v === 'object' ? (v as { entries?: unknown }).entries : undefined;
  if (Array.isArray(e)) return e.map((it, i) => ({ key: (it as ListEntry)?.key || String(i), value: (it as ListEntry)?.value, _meta: (it as ListEntry)?._meta }));
  if (e && typeof e === 'object') return Object.entries(e as Record<string, ListEntry>).map(([k, it]) => ({ key: k, value: it?.value, _meta: it?._meta }));
  return [];
}

/**
 * A tool result rendered by what it IS — a federated `ui://` renderer (a tool's
 * `_render` directive), a single typed fact, or a list of typed facts — instead
 * of always `JSON.stringify` (ADR-0041 Inc 1: the field computer joins the
 * federated render surface the conversation card already uses, ADR-0039).
 * Errors and the two HTTP probes (raw JSON, not substrate facts) keep the JSON
 * view; any shape this doesn't recognise falls back to it too.
 */
function ResultBody({ o }: { o: Output }): React.JSX.Element {
  const fallback = (
    <pre style={{ background: machine.screen, border: `1px solid ${machine.border}`, borderRadius: 6, padding: '0.55rem', margin: 0, overflowX: 'auto', fontFamily: theme.mono, fontSize: '0.76rem', color: o.ok ? machine.text : '#e08c7a', maxHeight: 320 }}>
      <code>{typeof o.value === 'string' ? o.value : JSON.stringify(o.value, null, 2)}</code>
    </pre>
  );
  if (!o.ok || o.kind === 'probe') return fallback;
  const rd = renderDirective(o.value);
  if (rd) return <FederatedRendererFrame uri={rd.renderer} type={rd.as} value={o.value} factKey={o.argsKey} placeholder={fallback} />;
  const screen = { background: machine.screen, border: `1px solid ${machine.border}`, borderRadius: 6, padding: '0.55rem', color: machine.text } as const;
  if (isFactShaped(o.value)) {
    const e: ListEntry = { key: (o.value as { key?: string }).key || o.argsKey || '', value: (o.value as { value: unknown }).value, _meta: (o.value as { _meta?: ListEntry['_meta'] })._meta };
    const to = factHref(e);
    const title = `${typeIcon(e) ? typeIcon(e) + ' ' : ''}${factTitle(e)}`;
    return (
      <div style={{ ...screen, display: 'grid', gap: '0.3rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
          {to ? <a href={to} style={{ color: machine.green, fontFamily: theme.serif, fontWeight: 600, textDecoration: 'none' }}>{title}</a> : <strong style={{ fontFamily: theme.serif }}>{title}</strong>}
          {e.key ? <span style={{ color: machine.dim, fontFamily: theme.mono, fontSize: '0.68rem' }}>{e.key}</span> : null}
        </div>
        <FactBody e={e} full />
      </div>
    );
  }
  const list = entriesOf(o.value);
  if (list.length) {
    return (
      <div style={{ ...screen, display: 'grid', gap: '0.4rem', maxHeight: 420, overflowY: 'auto' }}>
        {list.slice(0, 12).map((e) => {
          const to = factHref(e);
          const title = `${typeIcon(e) ? typeIcon(e) + ' ' : ''}${factTitle(e)}`;
          return (
            <div key={e.key} style={{ display: 'grid', gap: '0.15rem', paddingBottom: '0.4rem', borderBottom: `1px solid ${machine.border}` }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                {to ? <a href={to} style={{ color: machine.green, textDecoration: 'none', fontWeight: 600, fontSize: '0.82rem' }}>{title}</a> : <span style={{ fontSize: '0.82rem' }}>{title}</span>}
                <span style={{ color: machine.dim, fontFamily: theme.mono, fontSize: '0.65rem' }}>{e.key}</span>
              </div>
              <FactBody e={e} />
            </div>
          );
        })}
        {list.length > 12 ? <span style={{ color: machine.dim, fontFamily: theme.mono, fontSize: '0.7rem' }}>+{list.length - 12} more</span> : null}
      </div>
    );
  }
  return fallback;
}

/** Results stack, newest first — the machine's running tape. */
function OutputStack({ outputs, onClear }: { outputs: Output[]; onClear: () => void }): React.JSX.Element | null {
  if (outputs.length === 0) return null;
  return (
    <div style={{ display: 'grid', gap: '0.5rem', borderTop: `1px solid ${machine.border}`, paddingTop: '0.8rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: machine.dim, fontFamily: theme.mono, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          output · newest first
        </span>
        <button onClick={onClear} style={{ background: 'none', border: 'none', color: machine.dim, fontFamily: theme.mono, fontSize: '0.72rem', cursor: 'pointer' }}>
          clear
        </button>
      </div>
      {outputs.map((o) => (
        <div key={o.n} style={{ display: 'grid', gap: '0.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ color: o.ok ? machine.green : '#e08c7a', fontFamily: theme.mono, fontSize: '0.72rem' }}>{o.ok ? '✓' : '✕'}</span>
            <code style={{ color: machine.text, fontFamily: theme.mono, fontSize: '0.78rem' }}>{o.label}</code>
            <span style={{ color: machine.dim, fontFamily: theme.mono, fontSize: '0.68rem' }}>
              {new Date(o.at).toLocaleTimeString()}
            </span>
          </div>
          <ResultBody o={o} />
        </div>
      ))}
    </div>
  );
}

/** The housing: a collapsed machine that opens into the command palette. */
export function FieldComputer({ authed }: { authed: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <section
      style={{
        background: machine.housing,
        border: `1px solid ${machine.border}`,
        borderRadius: theme.radius,
        boxShadow: theme.shadow,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.6rem',
          padding: '0.9rem 1.1rem',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <img src={computerUrl} alt="" aria-hidden style={{ width: 54, height: 'auto', flexShrink: 0 }} />
          <span style={{ display: 'grid', gap: '0.1rem' }}>
            <span style={{ color: machine.green, fontFamily: theme.mono, fontSize: '0.9rem', letterSpacing: '0.08em' }}>
              ▮ FIELD COMPUTER
            </span>
            <span style={{ color: machine.dim, fontSize: '0.78rem' }}>
              The raw read/act console — every capability, the same wire an agent uses.
            </span>
          </span>
        </span>
        <span style={{ color: machine.dim, fontFamily: theme.mono }}>{open ? '–' : '+'}</span>
      </button>
      {open ? (
        <div style={{ padding: '0 1.1rem 1.1rem', display: 'grid', gap: '1rem', borderTop: `1px solid ${machine.border}`, paddingTop: '1rem' }}>
          <Console authed={authed} />
          <p style={{ color: machine.dim, fontSize: '0.75rem', margin: 0 }}>
            Tokens come from OAuth: clients register (DCR), redirect to /oauth/authorize, you approve
            with a passkey. Agents connect at parc.land/mcp — whoami · read · act.
          </p>
        </div>
      ) : null}
    </section>
  );
}

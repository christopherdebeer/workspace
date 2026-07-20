/**
 * The field computer's engine room — the command console over $catalog: one
 * search-first list (workspace matches + capabilities, one keyboard model),
 * arg entry (schema form / federated form / raw JSON), and the result tape.
 *
 * Refinement pass (owner direction 2026-07-10): ONE material. The console
 * previously wore its own green "machine" palette inside the palette's warm
 * ink shell — two design languages in a single instrument. It now speaks ink
 * throughout; what remains semantic is colour with a JOB: amber = interactive/
 * selected/mutating (`act`), green = a run that succeeded, red = one that
 * failed. Content (fact titles) keeps the park's serif voice — the machine is
 * mono, the things it retrieves are not.
 *
 * Progressive disclosure, top to bottom:
 *   bar → sheet: type; workspace matches + commands in one arrow-key list.
 *   Enter on a read with no REQUIRED args just RUNS it (the bare call is the
 *   designed default of recall/attention/query…); the arg form is reached via
 *   the row's `args` chip, and is mandatory only for `act`s (an explicit run
 *   button = the confirmation) and required/custom-form args.
 *   The form itself leads with the required (or first few) fields; the rest
 *   wait under "more options". Empty-string/empty-object args are pruned at
 *   run time — an untouched field means "not this filter", not `type:""`.
 *   The tape shows the LATEST result; older runs collapse under "history".
 */
import * as React from 'react';
import { theme, SchemaForm, isFormable, type FormFieldSchema, type FormPalette } from '@parc/ui';
import { authFetch } from './bridge';
import { getJson, mcpCall } from './lib';
import { FederatedRendererFrame, FederatedFormFrame } from './federated';
import { factHref, typeIcon, factTitle, FactBody, type ListEntry } from './facts';
import { CONSOLE_RESULT_EVENT } from './graph';
import { TUNE_OPEN_EVENT } from './graph/tune';
import { ink } from './ink';
// Matching/ranking, MRU recents, and selection stepping come from the kernel's
// headless command-surface engine — shared with the canvas cmd-palette.
// Materialized at push time as vendor/command-core.js (ADR-0076 overlay).
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS kernel SDK module (JSDoc-typed).
import { rankItems, createRecents, stepSelection } from '../vendor/command-core.js';

const { useState, useEffect } = React;

// ─── the console's ink dialect ──────────────────────────────────────
// Surfaces: the sheet is ink.panel (the palette provides it); anything inset —
// inputs, result screens — drops to ink.bg behind an ink.line hairline.
const okGreen = '#8fbf8f';

const inkFormPalette: FormPalette = {
  text: ink.text,
  dim: ink.dim,
  border: ink.line,
  inputBg: ink.bg,
  accent: ink.accent,
  danger: ink.danger,
  mono: ink.mono,
  sans: ink.mono, // the machine's voice stays monospace even for prose fields
};

/** The one caption style — every section header in the sheet uses this. */
const CAPTION: React.CSSProperties = {
  color: ink.dim,
  fontFamily: ink.mono,
  fontSize: '0.68rem',
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
};

/** An inset "screen" surface (inputs, result panes). */
const inset: React.CSSProperties = {
  background: ink.bg,
  border: `1px solid ${ink.line}`,
  borderRadius: 8,
};

/** A small outlined tag: `act` earns the accent (it mutates), the rest stay dim. */
function Pill({ children, tone = 'dim' }: { children: React.ReactNode; tone?: 'dim' | 'act' }): React.JSX.Element {
  const color = tone === 'act' ? ink.accent : ink.dim;
  return (
    <span style={{ color, fontFamily: ink.mono, fontSize: '0.66rem', border: `1px solid ${tone === 'act' ? ink.accent : ink.line}`, borderRadius: 999, padding: '0 0.45rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
      {children}
    </span>
  );
}

/** The one list-row shell: fixed-height touch target, never wraps, active =
 *  a quiet accent tint. Matches, commands, and recents all wear this. */
function Row({ active, onClick, onHover, children }: { active: boolean; onClick: () => void; onHover: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onHover}
      style={{
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        minHeight: 40,
        padding: '0.3rem 0.55rem',
        borderRadius: 8,
        border: `1px solid ${active ? ink.line : 'transparent'}`,
        background: active ? 'rgba(245,196,83,0.07)' : 'transparent',
        cursor: 'pointer',
        minWidth: 0,
      }}
    >
      {children}
    </button>
  );
}

interface Capability {
  target: string;
  kind: 'read' | 'act';
  description: string;
  scope: string | null;
  inputSchema?: FormFieldSchema;
  /** ADR-0041 Inc 3: a cell-authored argument form for this capability. */
  ui?: { form?: string; as?: string };
}

/** Starter args: the REQUIRED keys only, seeded with type-appropriate empties.
 *  (Seeding every declared key sent `{type:"", tag:"", …}` — which read as
 *  filters and matched nothing. An untouched optional field stays absent.) */
function argSkeletonObject(schema?: Capability['inputSchema']): Record<string, unknown> {
  const props = schema?.properties ?? {};
  const obj: Record<string, unknown> = {};
  for (const k of schema?.required ?? []) {
    const t = props[k]?.type;
    obj[k] = t === 'number' ? 0 : t === 'boolean' ? false : t === 'array' ? [] : t === 'object' ? {} : '';
  }
  return obj;
}

/** Drop the args a user never touched: empty strings, empty arrays/objects,
 *  null/undefined. What remains is what they actually asked for. */
function pruneArgs(v: unknown): unknown {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (val === '' || val == null) continue;
    if (Array.isArray(val) && val.length === 0) continue;
    if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val as object).length === 0) continue;
    out[k] = val;
  }
  return out;
}

/** Split a schema for progressive disclosure: the required fields (or, lacking
 *  any, the first three declared) lead; everything else waits under "more
 *  options". Both halves edit the same value. */
function splitSchema(schema?: Capability['inputSchema']): { primary: FormFieldSchema | undefined; advanced: FormFieldSchema | undefined } {
  const props = schema?.properties;
  if (!props) return { primary: schema, advanced: undefined };
  const keys = Object.keys(props);
  const req = (schema?.required ?? []).filter((k) => k in props);
  const lead = req.length ? req : keys.slice(0, 3);
  const rest = keys.filter((k) => !lead.includes(k));
  if (!rest.length) return { primary: schema, advanced: undefined };
  const pick = (ks: string[]): FormFieldSchema => ({
    ...schema,
    properties: Object.fromEntries(ks.map((k) => [k, props[k]])),
    required: (schema?.required ?? []).filter((k) => ks.includes(k)),
  }) as FormFieldSchema;
  return { primary: pick(lead), advanced: pick(rest) };
}

// A unified palette command: every capability from $catalog plus a couple of
// built-in probes (whoami, oauth discovery). One model, one tape.
interface Cmd {
  id: string;
  ns: string;
  verb: string;
  label: string;
  kind: 'read' | 'act' | 'probe';
  scope: string | null;
  description: string;
  schema?: Capability['inputSchema'];
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
   *  a fact-shaped result whose value omits its own key. */
  argsKey?: string;
}

const PROBE_CMDS: Cmd[] = [
  {
    id: 'graph:tune',
    ns: 'graph',
    verb: 'tune',
    label: 'graph tune',
    kind: 'act',
    scope: null,
    description: 'Open the live graph tuner — torch, labels, edges, zoom feel, bloom…',
    needsArgs: false,
    search: 'tune tuner graph adjust knobs sliders torch bloom zoom drag momentum labels feel dial',
    run: async () => {
      window.dispatchEvent(new CustomEvent(TUNE_OPEN_EVENT));
      return { ok: true, value: 'graph tuner opened' };
    },
  },
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

/** Enter (or a row tap) RUNS a read/probe outright unless something genuinely
 *  needs the form first: a required arg, a cell-authored form, or an `act`
 *  (whose run button is the explicit confirmation a mutation deserves). */
function runsDirectly(c: Cmd): boolean {
  if (c.kind === 'act' || c.ui?.form) return false;
  if (!c.needsArgs) return true;
  return (c.schema?.required ?? []).length === 0;
}

const HIGH_RISK_ACT = /(delete|remove|revoke|supersede|unlink|unshare|undeclare|prune|deploy|configure|grant|updatetoken|reindex|project|bootstrap|reset|purge|destroy|rotate)/i;
function requiresTypedConfirmation(c: Cmd): boolean {
  return c.kind === 'act' && HIGH_RISK_ACT.test(c.id);
}

/** One list, two sources: workspace matches lead, capabilities follow — a
 *  single arrow-key order (the old split made matches mouse-only). */
type Item = { kind: 'fact'; e: ListEntry } | { kind: 'cmd'; c: Cmd };

export function Console({ authed, seed, onSelectKey, collapsed = false, onCollapse }: {
  authed: boolean;
  seed?: { q: string; n: number } | null;
  onSelectKey?: (k: string) => void;
  /** Collapsed = the sheet (results/commands/tape) hides but the INPUT stays —
   *  and so does every piece of state: the query, the semantic matches, the
   *  graph highlights. On a phone that's how you see what a search lit up. */
  collapsed?: boolean;
  onCollapse?: (collapsed: boolean) => void;
}): React.JSX.Element {
  const [cmds, setCmds] = useState<Cmd[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const [focused, setFocused] = useState<Cmd | null>(null);
  const [args, setArgs] = useState('{}');
  const [formValue, setFormValue] = useState<Record<string, unknown>>({});
  const [rawJson, setRawJson] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [results, setResults] = useState<ListEntry[]>([]);
  const [searchN, setSearchN] = useState(16); // page size — grows via "more results"
  const counter = React.useRef(0);

  // ADR-0049: a contextual verb chip (palette selection) seeds the search box —
  // the nonce lets the same target re-seed after the user edits the query.
  useEffect(() => {
    if (!seed) return;
    setQuery(seed.q);
    setFocused(null);
    setConfirmText('');
    setSel(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.n]);

  useEffect(() => {
    if (!authed) return;
    let live = true;
    // `{detail:'full'}` returns the flat { capabilities:[…] } the console maps; a
    // bare $catalog returns the ADR-0033 grouped summary — flatten that too so a
    // future default change can't re-break this.
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

  // Search-first: free text runs a SEMANTIC query over the slice (ADR-0051
  // `query{text}` — meaning-ranked, salience-aware). Matches drive graph focus
  // (highlight + fit, debounced). Skipped for capability-address-looking input
  // (has a dot, no space), which is a command.
  useEffect(() => {
    if (!authed) { setResults([]); return; }
    const semantic = q.length >= 2 && (query.includes(' ') || !query.includes('.'));
    if (!semantic) { setResults([]); return; }
    let live = true;
    const t = setTimeout(() => {
      void mcpCall('read', 'workspace.query', { text: query.trim(), limit: searchN, shape: 'card' }).then((r) => {
        if (!live || !r.ok) return;
        const entries = ((r.value as { entries?: ListEntry[] })?.entries ?? []) as ListEntry[];
        const shown = entries.filter((x) => !x.key.startsWith('_') && x._meta?.type !== 'canvas-placement').slice(0, searchN);
        setResults(shown);
        // The graph pulls in EVERY hit (hydrating off-scene ones), so pass the
        // whole shown set, not just the first few.
        if (entries.length) window.dispatchEvent(new CustomEvent(CONSOLE_RESULT_EVENT, { detail: { ok: true, value: { entries: shown } } }));
      });
    }, 300);
    return () => { live = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, authed, searchN]);
  // A new query resets to the first page.
  useEffect(() => { setSearchN(16); }, [query]);

  const filtered = React.useMemo(
    () => (q ? (rankItems(cmds ?? [], q, { textOf: (c: Cmd) => c.search, limit: 10 }) as Cmd[]) : []),
    [cmds, q],
  );

  // MRU recents (command-core) — the empty-query state leads with what the
  // hands actually reach for, resolved against the LIVE command pool.
  const recentsRef = React.useRef(createRecents({ key: 'parc.home.recents', limit: 6 }));
  const [recentsV, setRecentsV] = useState(0);
  const recent = React.useMemo(
    () => (q || !cmds ? [] : (recentsRef.current.resolve(cmds, (c: Cmd) => c.id) as Cmd[])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cmds, q, recentsV],
  );

  // ONE navigable list: matches then commands while typing; recents when idle.
  const items: Item[] = React.useMemo(
    () => (q
      ? [...results.map((e): Item => ({ kind: 'fact', e })), ...filtered.map((c): Item => ({ kind: 'cmd', c }))]
      : recent.map((c): Item => ({ kind: 'cmd', c }))),
    [q, results, filtered, recent],
  );
  const firstCmdIdx = items.findIndex((it) => it.kind === 'cmd');

  const namespaces = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cmds ?? []) m.set(c.ns, (m.get(c.ns) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [cmds]);

  const openForm = (cmd: Cmd): void => {
    setFocused(cmd);
    setConfirmText('');
    const skeleton = argSkeletonObject(cmd.schema);
    setFormValue(skeleton);
    setArgs(JSON.stringify(skeleton, null, 2));
    // A schema the form floor can't walk (no object/properties) starts in raw
    // JSON unless a cell-authored form covers it regardless of declared shape.
    setRawJson(!cmd.ui?.form && !isFormable(cmd.schema));
  };

  const activate = (it: Item): void => {
    if (it.kind === 'fact') {
      onSelectKey?.(it.e.key);
      return;
    }
    if (runsDirectly(it.c)) void invoke(it.c, {});
    else openForm(it.c);
  };

  const invoke = async (cmd: Cmd, input: unknown): Promise<void> => {
    recentsRef.current.add(cmd.id);
    setRecentsV((v) => v + 1);
    setBusy(true);
    const pruned = pruneArgs(input);
    const argsKey = pruned && typeof pruned === 'object' && typeof (pruned as { key?: unknown }).key === 'string' ? (pruned as { key: string }).key : undefined;
    try {
      const r = await cmd.run(pruned);
      counter.current += 1;
      setOutputs((prev) => [{ n: counter.current, label: cmd.label, kind: cmd.kind, ok: r.ok, value: r.value, at: Date.now(), argsKey }, ...prev].slice(0, 40));
      // Results reach beyond the tape — the graph highlights/fits whatever
      // facts the result names (ADR-0047 v2).
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
    if (requiresTypedConfirmation(focused) && confirmText !== focused.id) return;
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

  /** Toggle form ↔ raw-JSON, carrying the same value across. */
  const toggleRawJson = (): void => {
    if (rawJson) {
      try {
        const parsed = args.trim() ? JSON.parse(args) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          setFormValue(parsed as Record<string, unknown>);
          setRawJson(false);
        }
      } catch {
        /* invalid JSON — stay in raw mode, keep the user's edit */
      }
    } else {
      setArgs(JSON.stringify(formValue, null, 2));
      setRawJson(true);
    }
  };

  // ── focused: one command's arg entry (renders in the sheet area) ──
  const focusedSchema = focused ? splitSchema(focused.schema) : null;
  const advancedCount = Object.keys((focusedSchema?.advanced as { properties?: object } | undefined)?.properties ?? {}).length;
  const confirmationTarget = focused && requiresTypedConfirmation(focused) ? focused.id : null;
  const confirmationReady = !confirmationTarget || confirmText === confirmationTarget;
  const focusedView = focused && focusedSchema ? (
      <div style={{ display: 'grid', gap: '0.7rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', minWidth: 0 }}>
          <button
            onClick={() => { setFocused(null); setConfirmText(''); }}
            aria-label="back to search"
            style={{ background: 'none', border: 'none', color: ink.dim, fontFamily: ink.mono, fontSize: '0.85rem', cursor: 'pointer', padding: '0.3rem 0.4rem 0.3rem 0', flexShrink: 0 }}
          >
            ‹
          </button>
          <code style={{ color: ink.text, fontFamily: ink.mono, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{focused.label}</code>
          <Pill tone={focused.kind === 'act' ? 'act' : 'dim'}>{focused.kind}</Pill>
        </div>
        {focused.description ? (
          <span style={{ color: ink.dim, fontSize: '0.78rem', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties}>
            {focused.description}
          </span>
        ) : null}
        <div
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              runFocused();
            }
          }}
          style={{ display: 'grid', gap: '0.55rem' }}
        >
          {!rawJson && focused.ui?.form ? (
            <FederatedFormFrame
              uri={focused.ui.form}
              type={focused.ui.as || focused.id}
              schema={focused.schema}
              initialValue={formValue}
              onChange={setFormValue}
              placeholder={
                <div style={{ ...inset, padding: '0.65rem' }}>
                  {isFormable(focused.schema) ? (
                    <SchemaForm schema={focused.schema} value={formValue} onChange={setFormValue} palette={inkFormPalette} />
                  ) : (
                    <span style={{ color: ink.dim, fontSize: '0.78rem' }}>loading form…</span>
                  )}
                </div>
              }
            />
          ) : !rawJson && isFormable(focused.schema) ? (
            <div style={{ ...inset, padding: '0.65rem', display: 'grid', gap: '0.55rem' }}>
              <SchemaForm schema={focusedSchema.primary} value={formValue} onChange={setFormValue} palette={inkFormPalette} />
              {advancedCount ? (
                <details>
                  <summary style={{ ...CAPTION, cursor: 'pointer', listStyle: 'none' }}>▸ more options · {advancedCount}</summary>
                  <div style={{ paddingTop: '0.55rem' }}>
                    <SchemaForm schema={focusedSchema.advanced} value={formValue} onChange={setFormValue} palette={inkFormPalette} />
                  </div>
                </details>
              ) : null}
            </div>
          ) : (
            <textarea
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              rows={Math.min(12, Math.max(2, args.split('\n').length))}
              spellCheck={false}
              autoFocus
              style={{ ...inset, width: '100%', boxSizing: 'border-box', padding: '0.55rem', fontSize: '0.8rem', color: ink.text, fontFamily: ink.mono }}
            />
          )}
          {confirmationTarget ? (
            <div style={{ ...inset, padding: '0.65rem', display: 'grid', gap: '0.45rem' }}>
              <span style={{ color: ink.danger, fontSize: '0.75rem', lineHeight: 1.4 }}>
                High-impact action. Type the exact capability address to confirm:
              </span>
              <code style={{ color: ink.text, fontFamily: ink.mono, fontSize: '0.76rem', overflowWrap: 'anywhere' }}>{confirmationTarget}</code>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                aria-label="type capability address to confirm"
                style={{ ...inset, minHeight: 38, padding: '0.45rem 0.55rem', color: ink.text, fontFamily: ink.mono, fontSize: '0.78rem' }}
              />
            </div>
          ) : focused.kind === 'act' ? (
            <span style={{ color: ink.dim, fontSize: '0.74rem' }}>This action changes substrate state. Review its arguments before running.</span>
          ) : null}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <button
              onClick={runFocused}
              disabled={busy || !confirmationReady}
              style={{ padding: '0.5rem 1rem', minHeight: 40, borderRadius: 8, border: `1px solid ${ink.accent}`, background: 'rgba(245,196,83,0.08)', color: ink.accent, fontFamily: ink.mono, fontSize: '0.8rem', cursor: busy || !confirmationReady ? 'not-allowed' : 'pointer', opacity: confirmationReady ? 1 : 0.55 }}
            >
              {busy ? 'running…' : focused.kind === 'act' ? 'run action' : 'run ⌘↵'}
            </button>
            {focused.ui?.form || isFormable(focused.schema) ? (
              <button
                onClick={toggleRawJson}
                style={{ background: 'none', border: 'none', color: ink.dim, fontFamily: ink.mono, fontSize: '0.72rem', cursor: 'pointer', textDecoration: 'underline', padding: '0.3rem 0' }}
              >
                {rawJson ? 'form' : 'raw json'}
              </button>
            ) : null}
          </div>
        </div>
      </div>
  ) : null;

  // ── the browse sheet: one navigable list (matches/commands or recents) ──
  const browseView = (
    <>
      {err && !cmds?.length ? <span style={{ color: ink.danger, fontFamily: ink.mono, fontSize: '0.78rem' }}>{err}</span> : null}

      {q && items.length === 0 ? (
        <p style={{ color: ink.dim, margin: 0, fontSize: '0.8rem' }}>No match for “{query}”.</p>
      ) : null}

      {items.length ? (
        <div style={{ display: 'grid', gap: '0.15rem', WebkitTextSizeAdjust: '100%', textSizeAdjust: '100%' } as React.CSSProperties}>
          {items.map((it, i) => (
            <React.Fragment key={it.kind === 'fact' ? `f:${it.e.key}` : `c:${it.c.id}`}>
              {/* Section captions fall where the sources meet — one list, labelled. */}
              {i === 0 ? <span style={{ ...CAPTION, padding: '0.1rem 0.15rem' }}>{q ? (it.kind === 'fact' ? 'in your workspace' : 'commands') : 'recent'}</span> : null}
              {q && i === firstCmdIdx && firstCmdIdx > 0 ? <span style={{ ...CAPTION, padding: '0.35rem 0.15rem 0.1rem' }}>commands</span> : null}
              {it.kind === 'fact' ? (
                <Row active={i === sel} onClick={() => activate(it)} onHover={() => setSel(i)}>
                  <span aria-hidden style={{ fontSize: '0.85rem', flexShrink: 0 }}>{typeIcon(it.e) || '·'}</span>
                  <span style={{ fontSize: '0.8rem', color: ink.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{factTitle(it.e)}</span>
                  {it.e._meta?.type ? <span style={{ color: ink.dim, fontFamily: ink.mono, fontSize: '0.66rem', flexShrink: 0 }}>{it.e._meta.type}</span> : null}
                </Row>
              ) : (
                <Row active={i === sel} onClick={() => activate(it)} onHover={() => setSel(i)}>
                  <code style={{ color: ink.text, fontFamily: ink.mono, fontSize: '0.82rem', flexShrink: 0 }}>{it.c.label}</code>
                  <Pill tone={it.c.kind === 'act' ? 'act' : 'dim'}>{it.c.kind}</Pill>
                  <span style={{ color: ink.dim, fontSize: '0.76rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                    {it.c.description}
                  </span>
                  {it.c.needsArgs ? (
                    <span
                      role="button"
                      tabIndex={-1}
                      title="set arguments first"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        openForm(it.c);
                      }}
                      style={{ color: ink.dim, fontFamily: ink.mono, fontSize: '0.66rem', border: `1px solid ${ink.line}`, borderRadius: 999, padding: '0.1rem 0.5rem', flexShrink: 0, cursor: 'pointer' }}
                    >
                      args…
                    </span>
                  ) : null}
                </Row>
              )}
            </React.Fragment>
          ))}
        </div>
      ) : null}

      {q && results.length >= searchN ? (
        <button
          onClick={() => setSearchN((n) => n + 16)}
          style={{ marginTop: '0.3rem', alignSelf: 'start', border: `1px solid ${ink.line}`, background: 'transparent', color: ink.dim, fontFamily: ink.mono, fontSize: '0.72rem', borderRadius: 999, padding: '0.25rem 0.7rem', cursor: 'pointer' }}
        >
          + more results
        </button>
      ) : null}

      {!q && cmds ? (
        // Idle, below recents: the vocabulary waits behind one quiet line —
        // commands shouldn't dominate the opening view (owner feedback).
        <details style={{ marginTop: recent.length ? '0.2rem' : 0 }}>
          <summary style={{ ...CAPTION, cursor: 'pointer', listStyle: 'none', padding: '0.2rem 0.15rem' }}>▸ {cmds.length} commands</summary>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', paddingTop: '0.35rem' }}>
            {namespaces.map(([ns, n]) => (
              <button
                key={ns}
                onClick={() => {
                  setQuery(ns + '.');
                  setSel(0);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.28rem 0.65rem', borderRadius: 999, border: `1px solid ${ink.line}`, background: 'transparent', color: ink.text, fontFamily: ink.mono, fontSize: '0.76rem', cursor: 'pointer' }}
              >
                {ns}
                <span style={{ color: ink.dim }}>{n}</span>
              </button>
            ))}
          </div>
        </details>
      ) : null}
      {!cmds && !err ? <p style={{ color: ink.dim, margin: 0, fontSize: '0.8rem' }}>Loading capabilities…</p> : null}
    </>
  );

  // ── the shell: a collapsible sheet ABOVE a persistent input row. Collapsing
  // hides the sheet but unmounts NOTHING — query, matches, selection, and the
  // graph highlights all survive, which is how a phone reviews what a search
  // lit up behind the palette. ──
  return (
    <div style={{ display: 'grid' }}>
      {!collapsed ? (
        <div style={{ background: ink.panel, maxHeight: 'min(60dvh, 560px)', overflowY: 'auto', overscrollBehavior: 'contain', padding: '0.7rem', display: 'grid', gap: '0.6rem', borderBottom: `1px solid ${ink.line}`, alignContent: 'start' }}>
          {focusedView ?? browseView}
          <OutputStack outputs={outputs} onClear={() => setOutputs([])} />
        </div>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.7rem', minHeight: 50 }}>
        <span aria-hidden style={{ color: ink.accent, fontFamily: ink.mono }}>›</span>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
            setFocused(null);
            setConfirmText('');
            onCollapse?.(false); // typing re-opens the sheet
          }}
          onFocus={() => onCollapse?.(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              onCollapse?.(false);
              setSel((s) => Math.max(0, stepSelection(s, 1, items.length)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              onCollapse?.(false);
              setSel((s) => Math.max(0, stepSelection(s, -1, items.length)));
            } else if (e.key === 'Enter' && items[sel]) {
              e.preventDefault();
              if (collapsed) {
                onCollapse?.(false);
                return;
              }
              activate(items[sel]);
            } else if (e.key === 'Escape' && query) {
              // With a query: Esc clears it and STOPS there; the palette's own
              // Esc (collapse the sheet) takes over only on an empty box.
              e.stopPropagation();
              setQuery('');
            }
          }}
          placeholder="Search your workspace, or run a capability…"
          spellCheck={false}
          autoComplete="off"
          style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: ink.text, fontFamily: ink.mono, fontSize: '0.9rem', minWidth: 0, minHeight: 34 }}
        />
        {query ? (
          <button onClick={() => setQuery('')} aria-label="clear search" style={{ background: 'none', border: 'none', color: ink.dim, cursor: 'pointer', fontSize: '1rem', padding: '0.3rem 0.4rem' }}>
            ×
          </button>
        ) : null}
        <button
          onClick={() => onCollapse?.(!collapsed)}
          aria-label={collapsed ? 'expand the console' : 'collapse the console'}
          style={{ background: 'none', border: 'none', color: ink.accent, cursor: 'pointer', fontFamily: ink.mono, fontSize: '0.85rem', padding: '0.3rem 0.45rem' }}
        >
          {collapsed ? '▴' : '▾'}
        </button>
      </div>
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
 * A tool result rendered by what it IS — a federated `ui://` renderer, a single
 * typed fact, or a list of typed facts — instead of always `JSON.stringify`
 * (ADR-0041 Inc 1). Errors and the HTTP probes keep the JSON view; unknown
 * shapes fall back to it too. Fact TITLES speak the park's serif — content is
 * not machinery.
 */
function ResultBody({ o }: { o: Output }): React.JSX.Element {
  const fallback = (
    <pre style={{ ...inset, padding: '0.55rem', margin: 0, overflowX: 'auto', fontFamily: ink.mono, fontSize: '0.76rem', color: o.ok ? ink.text : ink.danger, maxHeight: 320 }}>
      <code>{typeof o.value === 'string' ? o.value : JSON.stringify(o.value, null, 2)}</code>
    </pre>
  );
  if (!o.ok || o.kind === 'probe') return fallback;
  const rd = renderDirective(o.value);
  if (rd) return <FederatedRendererFrame uri={rd.renderer} type={rd.as} value={o.value} factKey={o.argsKey} placeholder={fallback} />;
  const screen = { ...inset, padding: '0.55rem', color: ink.text } as const;
  if (isFactShaped(o.value)) {
    const e: ListEntry = { key: (o.value as { key?: string }).key || o.argsKey || '', value: (o.value as { value: unknown }).value, _meta: (o.value as { _meta?: ListEntry['_meta'] })._meta };
    const to = factHref(e);
    const title = `${typeIcon(e) ? typeIcon(e) + ' ' : ''}${factTitle(e)}`;
    return (
      <div style={{ ...screen, display: 'grid', gap: '0.3rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
          {to ? <a href={to} style={{ color: ink.accent, fontFamily: theme.serif, fontWeight: 600, textDecoration: 'none' }}>{title}</a> : <strong style={{ fontFamily: theme.serif }}>{title}</strong>}
          {e.key ? <span style={{ color: ink.dim, fontFamily: ink.mono, fontSize: '0.68rem' }}>{e.key}</span> : null}
        </div>
        <FactBody e={e} full />
      </div>
    );
  }
  const list = entriesOf(o.value);
  if (list.length) {
    return (
      <div style={{ ...screen, display: 'grid', gap: '0.4rem', maxHeight: 420, overflowY: 'auto', overscrollBehavior: 'contain' }}>
        {list.slice(0, 12).map((e) => {
          const to = factHref(e);
          const title = `${typeIcon(e) ? typeIcon(e) + ' ' : ''}${factTitle(e)}`;
          return (
            <div key={e.key} style={{ display: 'grid', gap: '0.15rem', paddingBottom: '0.4rem', borderBottom: `1px solid ${ink.line}` }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
                {to ? <a href={to} style={{ color: ink.accent, textDecoration: 'none', fontWeight: 600, fontSize: '0.82rem', fontFamily: theme.serif }}>{title}</a> : <span style={{ fontSize: '0.82rem', fontFamily: theme.serif }}>{title}</span>}
                <span style={{ color: ink.dim, fontFamily: ink.mono, fontSize: '0.65rem' }}>{e.key}</span>
              </div>
              <FactBody e={e} />
            </div>
          );
        })}
        {list.length > 12 ? <span style={{ ...CAPTION }}>+{list.length - 12} more</span> : null}
      </div>
    );
  }
  return fallback;
}

/** One run on the tape: ✓/✕, target, time — then its rendered result. */
function OutputRun({ o }: { o: Output }): React.JSX.Element {
  return (
    <div style={{ display: 'grid', gap: '0.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
        <span style={{ color: o.ok ? okGreen : ink.danger, fontFamily: ink.mono, fontSize: '0.75rem', flexShrink: 0 }}>{o.ok ? '✓' : '✕'}</span>
        <code style={{ color: ink.text, fontFamily: ink.mono, fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</code>
        <span style={{ color: ink.dim, fontFamily: ink.mono, fontSize: '0.66rem', flexShrink: 0, marginLeft: 'auto' }}>
          {new Date(o.at).toLocaleTimeString()}
        </span>
      </div>
      <ResultBody o={o} />
    </div>
  );
}

/** The tape: the LATEST result in full; earlier runs wait under "history" —
 *  the common case is "what did that just return", not an archaeology dig. */
function OutputStack({ outputs, onClear }: { outputs: Output[]; onClear: () => void }): React.JSX.Element | null {
  if (outputs.length === 0) return null;
  const [latest, ...rest] = outputs;
  return (
    <div style={{ display: 'grid', gap: '0.4rem', borderTop: `1px solid ${ink.line}`, paddingTop: '0.6rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={CAPTION}>output</span>
        <button onClick={onClear} style={{ background: 'none', border: 'none', color: ink.dim, fontFamily: ink.mono, fontSize: '0.7rem', cursor: 'pointer', padding: '0.2rem 0' }}>
          clear
        </button>
      </div>
      <OutputRun o={latest} />
      {rest.length ? (
        <details>
          <summary style={{ ...CAPTION, cursor: 'pointer', listStyle: 'none' }}>▸ history · {rest.length}</summary>
          <div style={{ display: 'grid', gap: '0.5rem', paddingTop: '0.5rem' }}>
            {rest.map((o) => (
              <OutputRun key={o.n} o={o} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

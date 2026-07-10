/**
 * ADR-0044 Inc 5: the workspace window and the fact surface, split from app.tsx
 * (moved verbatim) — the type vocabulary (typeDecls cache + accessors), fact
 * presentation (titles/hrefs/FactBody/HintBody/FactEmbed), the progressive
 * fact detail (peek modal, generic editor), and the workspace window itself.
 */
import * as React from 'react';
import { Card, Heading, Badge, Button, Anchor, CodeBlock, theme, resolve, declFor, type TypeDecl, SchemaForm, isFormable, type FormFieldSchema } from '@parc/ui';
import { ink } from './ink';
import { marked } from 'marked';
import { DEFAULT_TYPE_DECLS } from './type-decls';
import { cellUrl } from './bridge';
import { localize, mcpCall } from './lib';
import { FederatedRendererFrame } from './federated';

const { useState, useEffect } = React;

// ─── the type vocabulary (presentation/routing as data) ────────────

export interface ListEntry {
  key: string;
  value?: unknown;
  _meta?: { type?: string | null; tags?: string[]; updatedAt?: string };
}

/**
 * Type vocabulary (docs/type-vocabulary.md): the fact→cell open/edit/render
 * table is *data*, resolved by the shared `resolve()` — no hardcoded routing.
 * The defaults encode parc's conventions; substrate `_types/<type>` facts
 * override them per-type (old-shape `{icon,titlePath,href}` facts are
 * normalised so existing declarations keep working).
 */
let typeDecls: Record<string, TypeDecl> = { ...DEFAULT_TYPE_DECLS };

interface LegacyTypeDecl { icon?: string; titlePath?: string; href?: string; manager?: string; label?: string; handlers?: TypeDecl['handlers']; present?: { icon?: string; label?: string; render?: unknown } }
function normalizeDecl(d: LegacyTypeDecl): TypeDecl {
  // Prefer the gateway-resolved `present` facet (ADR-0012/0014 row 3): the legacy
  // {icon,titlePath} → {icon,label} normalisation now happens once, server-side via
  // resolveType, so home consumes it instead of re-deriving. (The per-fact label is still
  // applied client-side by `pathInto` — Present runs where the fact's value is.)
  const icon = d.present?.icon ?? d.icon;
  const label = d.present?.label ?? d.label ?? d.titlePath;
  if (d.handlers || !d.href) return { ...(d as TypeDecl), icon, label }; // new-shape (+ served present)
  return { icon, manager: d.manager, label, handlers: { open: [{ surface: d.href }] } };
}

/** Build the type vocabulary from a raw `$types`/`describeTypes` map: normalise
 *  legacy-shape decls and layer them over the built-in bootstrap fallback. The
 *  one place the vocab is assembled — used by both the SSR seed (index.ts) and
 *  the client `loadTypeDecls`, so server and client resolve identically. */
export function typeDeclsFrom(raw: Record<string, unknown> | undefined): Record<string, TypeDecl> {
  const norm = Object.fromEntries(Object.entries(raw ?? {}).map(([t, d]) => [t, normalizeDecl(d as LegacyTypeDecl)]));
  return { ...DEFAULT_TYPE_DECLS, ...norm };
}

/** Replace the module's type vocabulary (SSR seed install / client refresh). */
export function setTypeDecls(decls: Record<string, TypeDecl>): void {
  typeDecls = decls;
}

export async function loadTypeDecls(): Promise<void> {
  try {
    // $types is the global vocabulary (the cell registry's canonical declarations
    // merged under this user's _types overrides), so home resolves the same way
    // for any signed-in user — not just the cells' owner.
    const r = await mcpCall('read', '$types');
    if (r.ok) typeDecls = typeDeclsFrom((r.value as { types?: Record<string, LegacyTypeDecl> }).types);
  } catch {
    /* defaults still apply */
  }
}
function pathInto(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const p of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function typeIcon(e: ListEntry): string {
  return declFor(e, typeDecls)?.icon ?? '';
}

/** A fact's one-line presentation: title from its value (its declared label path), not its key. */
export function factTitle(e: ListEntry): string {
  const label = declFor(e, typeDecls)?.label;
  if (label) {
    const v = pathInto(e.value, label);
    if (typeof v === 'string' && v) return v.slice(0, 80);
  }
  const v = e.value;
  if (typeof v === 'string') return v.slice(0, 80) || e.key;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.title === 'string' && o.title) return o.title.slice(0, 80);
    if (typeof o.name === 'string' && o.name) return o.name.slice(0, 80);
    if (typeof o.content === 'string' && o.content) {
      const line = o.content.match(/^#+\s*(.+)$/m)?.[1] ?? o.content.split('\n').find((l) => l.trim()) ?? '';
      const clean = line.replace(/^[-*]\s*\[[ x]\]\s*/, '').replace(/[#*_`>\\[\]()]/g, '').trim();
      if (clean) return clean.slice(0, 80);
    }
  }
  return e.key;
}

/**
 * The concrete URL for a resolved handler. A `path` handler names a cell
 * (`cellRef`) and a path within it → the kernel's origin-aware `cellUrl` builds
 * the right URL (subdomain on a cell host, apex path on the apex). A `surface`
 * handler is a value-derived full path (e.g. a cell's stored `${value.address}`)
 * → localized as-is. So no apex URLs are baked into the type vocabulary.
 */
function handlerUrl(r: ReturnType<typeof resolve>): string | null {
  if (!r) return null;
  if (r.cellRef && r.path !== undefined) return cellUrl(r.cellRef.owner, r.cellRef.name, r.path);
  return r.surface ? localize(r.surface) : null;
}

/** Where a fact opens — resolved from the type vocabulary, no hardcoded cells. */
export function factHref(e: ListEntry): string | null {
  return handlerUrl(resolve(e, 'open', typeDecls));
}

/** Where a fact edits — its type's `edit` handler, if it declares one. */
function factEdit(e: ListEntry): string | null {
  return handlerUrl(resolve(e, 'edit', typeDecls));
}

/** A small "✎ edit" link, shown only when the fact's type declares an edit surface. */
export function EditLink({ e }: { e: ListEntry }): React.JSX.Element | null {
  const to = factEdit(e);
  if (!to) return null;
  return (
    <a href={to} title="Edit" style={{ color: ink.dim, fontSize: '0.72rem', textDecoration: 'none', fontFamily: theme.mono }}>
      ✎ edit
    </a>
  );
}

/** A content snippet beyond the title — the *substance* of a fact, for exploration. */
function factPreview(e: ListEntry): string {
  const v = e.value;
  if (v == null || typeof v !== 'object') return '';
  const o = v as Record<string, unknown>;
  const text =
    typeof o.content === 'string' ? o.content
    : typeof o.body === 'string' ? o.body
    : typeof o.text === 'string' ? o.text
    : typeof o.description === 'string' ? o.description
    : typeof o.note === 'string' ? o.note
    : '';
  if (text) {
    // Drop the first line (it usually became the title), then flatten.
    const lines = text.split('\n').filter((l) => l.trim());
    const body = lines.length > 1 ? lines.slice(1).join(' ') : lines[0] ?? '';
    return body.replace(/[#*_`>[\]()]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
  }
  // Structured value: a few scalar fields.
  const parts: string[] = [];
  for (const [k, val] of Object.entries(o)) {
    if (['content', 'title', 'name', 'id', 'src'].includes(k) || val == null || typeof val === 'object') continue;
    parts.push(`${k}: ${String(val).slice(0, 40)}`);
    if (parts.length >= 3) break;
  }
  return parts.join(' · ');
}

// ─── default viewers (the type's `render`/`embed` handler) ─────────
//
// A managing cell declares HOW its type renders inline (docs/type-vocabulary):
// a built-in `hint` kind that home draws (SSR-safe, no foreign code), or an
// `embed` surface the cell SSRs as a zero-JS thumbnail in an origin-isolated
// iframe. Neither runs the cell's code in home — the isolation the subdomains
// enforce. `marked` is isomorphic (same pin server+client, like starter), so
// markdown bodies hydrate without a flash.

marked.setOptions({ gfm: true, breaks: false });

/** First present string field among `keys` of an object value. */
function strField(v: unknown, keys: string[]): string | undefined {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of keys) if (typeof o[k] === 'string' && o[k]) return o[k] as string;
  }
  return undefined;
}
/** The markdown/text body of a fact value (string, or its content-ish field). */
function bodyText(v: unknown): string {
  if (typeof v === 'string') return v;
  return strField(v, ['content', 'body', 'text', 'description', 'note', 'md', 'markdown']) ?? '';
}

/** Render a fact body by a built-in `hint` kind. SSR-safe: deterministic, no
 *  browser globals. Returns null when there's nothing to draw (caller falls back). */
function HintBody({ kind, e }: { kind: string; e: ListEntry }): React.JSX.Element | null {
  const v = e.value;
  switch (kind) {
    case 'md':
    case 'markdown': {
      const md = bodyText(v);
      if (!md) return null;
      const html = marked.parse(md.replace(/\r\n/g, '\n'), { async: false }) as string;
      return <div className="fact-md" style={{ fontSize: '0.85rem', lineHeight: 1.5, overflowWrap: 'anywhere' }} dangerouslySetInnerHTML={{ __html: html }} />;
    }
    case 'image': {
      const src = strField(v, ['src', 'url', 'href', 'image']);
      return src ? <img src={src} alt={factTitle(e)} loading="lazy" style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }} /> : null;
    }
    case 'code': {
      const code = bodyText(v);
      return code ? <CodeBlock>{code.slice(0, 2000)}</CodeBlock> : null;
    }
    case 'metric': {
      const n = typeof v === 'number' ? String(v) : (strField(v, ['value', 'count', 'n', 'total']) ?? bodyText(v));
      return n ? <strong style={{ fontFamily: theme.serif, fontSize: '1.4rem' }}>{n}</strong> : null;
    }
    case 'fields':
      return <FieldsBody value={v} />;
    default:
      return null;
  }
}

/** A few scalar fields of a structured value, as a compact definition list. */
function FieldsBody({ value }: { value: unknown }): React.JSX.Element | null {
  if (!value || typeof value !== 'object') return null;
  const rows = Object.entries(value as Record<string, unknown>)
    .filter(([k, val]) => val != null && typeof val !== 'object' && !['content', 'title', 'name', 'id', 'src'].includes(k))
    .slice(0, 6);
  if (!rows.length) return null;
  return (
    <dl style={{ margin: 0, display: 'grid', gap: '0.15rem', fontSize: '0.8rem' }}>
      {rows.map(([k, val]) => (
        <div key={k} style={{ display: 'flex', gap: '0.45rem', minWidth: 0 }}>
          <dt style={{ color: ink.dim, fontFamily: theme.mono, fontSize: '0.72rem', flexShrink: 0 }}>{k}</dt>
          <dd style={{ margin: 0, overflowWrap: 'anywhere', minWidth: 0 }}>{String(val).slice(0, 120)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A cell-SSR'd embed: the managing cell renders a zero-JS thumbnail on its own
 *  origin; home shows it in a pointer-inert iframe (origin-isolated — the cell's
 *  code never touches home). Lazy-loaded; a transparent overlay link opens it. */
function FactEmbed({ src, href, title }: { src: string; href: string | null; title: string }): React.JSX.Element {
  return (
    <div style={{ position: 'relative', height: 200, borderRadius: 8, overflow: 'hidden', border: `1px solid ${ink.line}`, background: '#fff' }}>
      <iframe src={src} title={title} loading="lazy" scrolling="no" tabIndex={-1} aria-hidden style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, display: 'block', pointerEvents: 'none' }} />
      {href ? <a href={href} title={`Open ${title}`} aria-label={`Open ${title}`} style={{ position: 'absolute', inset: 0, display: 'block' }} /> : null}
    </div>
  );
}

/** Hints whose bodies can run long — clamped in a card, shown whole in the modal. */
const LONGFORM_HINTS = new Set(['md', 'markdown', 'code', 'fields']);

/** Truncate a rendered body to a few lines with a fade — the card preview. The
 *  modal (full) shows it untruncated, which is what the peek escalates to. */
function ClampedBody({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ position: 'relative', maxHeight: '4.5em', overflow: 'hidden' }}>
      {children}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '1.6em', background: `linear-gradient(transparent, ${ink.panel})` }} />
    </div>
  );
}

/**
 * A fact's inline body, from the type's declared default viewer: a built-in
 * `render` hint, or (when `embed` is allowed, e.g. a pinned single fact) the
 * cell's `embed` thumbnail — falling back to the heuristic text preview. Pure
 * presentation over `typeDecls`, so it renders identically server + client.
 *
 * `full` is the modal read: long-form bodies render whole. Without it (the list
 * card) a long-form body is clamped to a few lines — the card is a preview now
 * that the peek modal carries the full content.
 */
export function FactBody({ e, embed = false, full = false }: { e: ListEntry; embed?: boolean; full?: boolean }): React.JSX.Element | null {
  const resolved = resolve(e, 'render', typeDecls);
  // A cell-authored `ui://` renderer (ADR-0039) federates this type's render —
  // run it sandboxed (ADR-0041), the FieldsBody hint as the degrade-to placeholder
  // (mirroring the conversation card's hint-then-swap pattern). Not clamped: a
  // renderer's content (a graph, a diagram) isn't a clampable text body.
  if (resolved?.renderer && resolved.renderer.startsWith('ui://')) {
    return (
      <FederatedRendererFrame
        uri={resolved.renderer}
        type={e._meta?.type ?? ''}
        value={e.value}
        factKey={e.key}
        placeholder={<FieldsBody value={e.value} />}
      />
    );
  }
  const hint = resolved?.hint;
  if (hint) {
    const el = HintBody({ kind: hint, e });
    if (el) return !full && LONGFORM_HINTS.has(hint) ? <ClampedBody>{el}</ClampedBody> : el;
  }
  if (embed) {
    const src = handlerUrl(resolve(e, 'embed', typeDecls));
    if (src) return <FactEmbed src={src} href={factHref(e)} title={factTitle(e)} />;
  }
  // The modal read of a fact with no declared viewer: show the whole body
  // (markdown), or the raw value, rather than the clamped heuristic preview.
  if (full) {
    const body = bodyText(e.value);
    if (body) {
      const html = marked.parse(body.replace(/\r\n/g, '\n'), { async: false }) as string;
      return <div className="fact-md" style={{ fontSize: '0.85rem', lineHeight: 1.5, overflowWrap: 'anywhere' }} dangerouslySetInnerHTML={{ __html: html }} />;
    }
    if (typeof e.value === 'string') return <span style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.value}</span>;
    if (e.value != null && typeof e.value === 'object') return <CodeBlock>{JSON.stringify(e.value, null, 2)}</CodeBlock>;
  }
  const preview = factPreview(e);
  return preview ? (
    <span style={{ color: ink.text, fontSize: '0.8rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{preview}</span>
  ) : null;
}

export interface Edge {
  from: string;
  rel: string;
  to: string;
  derived?: boolean;
}

// ─── progressive fact detail (peek modal → edit / escalate) ─────────
//
// Every fact opens a peek modal first (so the long tail — orphaned/undeclared
// types with no `open` surface — finally has a detail view). A type's declared
// `open`/`edit` handlers become escalation links inside it; the generic editor
// is the fallback so any fact is editable, gated by the write succeeding.

const FACT_DETAIL_EVENT = 'home:fact-detail';

/** Open the progressive detail modal for a fact (or a bare {key}; hydrated by peek). */
export function openFact(e: ListEntry): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<ListEntry>(FACT_DETAIL_EVENT, { detail: e }));
}

const shortKey = (k: string): string => (k.length > 22 ? k.slice(0, 21) + '…' : k);

/** A fact's one-hop neighbourhood — authored edges plus the derived backbone
 *  (instanceOf → its type, managedBy → its cell, inView → views). Derived edges
 *  render dashed/dim; every chip is itself a peek into that neighbour. */
function Neighbourhood({ keyName }: { keyName: string }): React.JSX.Element {
  const [n, setN] = useState<{ outbound: Edge[]; inbound: Edge[] } | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    mcpCall('read', 'workspace.neighbors', { key: keyName })
      .then((r) => {
        if (!live) return;
        if (r.ok) setN(r.value as { outbound: Edge[]; inbound: Edge[] });
        else setErr(true);
      })
      .catch(() => live && setErr(true));
    return () => {
      live = false;
    };
  }, [keyName]);
  if (err) return <span style={{ color: ink.dim, fontSize: '0.72rem' }}>No neighbourhood.</span>;
  if (!n) return <span style={{ color: ink.dim, fontSize: '0.72rem' }}>Loading neighbourhood…</span>;
  const chip = (ed: Edge, other: string, label: string): React.JSX.Element => (
    <button
      key={`${ed.from}-${ed.rel}-${ed.to}`}
      onClick={() => openFact({ key: other })}
      title={`${ed.from} ${ed.rel} ${ed.to}`}
      style={{
        fontSize: '0.66rem',
        color: ed.derived ? ink.dim : ink.accent,
        border: `1px ${ed.derived ? 'dashed' : 'solid'} ${ink.line}`,
        borderRadius: 999,
        padding: '0.05rem 0.45rem',
        fontFamily: theme.mono,
        cursor: 'pointer',
        background: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
  const chips = [
    ...n.outbound.map((ed) => chip(ed, ed.to, `${ed.rel}→${shortKey(ed.to)}`)),
    ...n.inbound.map((ed) => chip(ed, ed.from, `${shortKey(ed.from)}→${ed.rel}`)),
  ];
  return chips.length ? (
    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>{chips}</div>
  ) : (
    <span style={{ color: ink.dim, fontSize: '0.72rem' }}>No edges yet.</span>
  );
}

/** Generic editor: a string value edits as text; any other value edits as its
 *  JSON. Saved with `workspace.remember` (preserving the fact's type). A type's
 *  own `edit` surface, when declared, takes precedence over this (see FactDetail). */
/** A type's schema field (from `$types[type].fields`, ADR-0002 `shape.fields`). */
interface FormField {
  name: string;
  type?: string;
  required?: boolean;
  description?: string;
}

/** An ink action (peek sheet buttons/links) — amber outline, quiet fill. */
const inkAction: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.4rem 0.9rem',
  minHeight: 38,
  boxSizing: 'border-box',
  borderRadius: 8,
  border: `1px solid ${ink.accent}`,
  background: 'none',
  color: ink.accent,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.8rem',
  textDecoration: 'none',
};

const editInput: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '0.4rem 0.5rem',
  fontSize: '0.8rem',
  border: `1px solid ${ink.line}`,
  borderRadius: 6,
  background: ink.panel,
  color: ink.text,
};

/** A `$types[type].fields` entry's `type` (a loose vocabulary: string/number/
 *  boolean/markdown/ref/array/object) isn't JSON-Schema — adapt it to the
 *  `FormFieldSchema` shape `SchemaForm` (ADR-0041 Inc 2) already walks, so the
 *  field computer's form floor and a fact's own editor are ONE renderer, not
 *  two (Inc 4). `ref`/`array`/`object` map to no JSON-Schema scalar type, so
 *  `SchemaForm` degrades them to its per-field raw-JSON box — the same
 *  fallback `isJsonField` hand-rolled here before.
 */
function fieldsToFormSchema(fields: FormField[]): FormFieldSchema {
  const properties: Record<string, FormFieldSchema> = {};
  const required: string[] = [];
  for (const f of fields) {
    const type = f.type === 'markdown' ? 'string' : f.type === 'string' || f.type === 'boolean' || f.type === 'number' ? f.type : undefined;
    properties[f.name] = { type, description: f.description };
    if (f.required) required.push(f.name);
  }
  return { type: 'object', properties, required };
}

/**
 * Generic editor (ADR-0002). When the type declares `fields`, render a **form**
 * via the shared `SchemaForm` floor (ADR-0041 Inc 2/4) — one form renderer for
 * tool args, type-create, and fact-edit alike. Otherwise fall back to text
 * (string value) / raw JSON. `workspace.remember`'s advisory `hints` flow back
 * via `onSaved`.
 */
function FactEditor({
  e,
  fields,
  onSaved,
  onCancel,
}: {
  e: ListEntry;
  fields?: FormField[];
  onSaved: (v: unknown, hints?: string[]) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const isStr = typeof e.value === 'string';
  const base = e.value && typeof e.value === 'object' && !Array.isArray(e.value) ? (e.value as Record<string, unknown>) : {};
  const schema = Array.isArray(fields) && fields.length > 0 ? fieldsToFormSchema(fields) : undefined;
  const useForm = !isStr && isFormable(schema);

  const [form, setForm] = useState<Record<string, unknown>>(base);
  const [text, setText] = useState(isStr ? (e.value as string) : JSON.stringify(e.value ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    let value: unknown;
    if (useForm) {
      value = form;
    } else if (isStr) {
      value = text;
    } else {
      try {
        value = JSON.parse(text);
      } catch {
        setErr('Invalid JSON');
        return;
      }
    }
    setBusy(true);
    setErr(null);
    const r = await mcpCall('act', 'workspace.remember', { key: e.key, value, ...(e._meta?.type ? { type: e._meta.type } : {}) });
    setBusy(false);
    if (!r.ok) {
      setErr(typeof r.value === 'string' ? r.value : 'Save failed');
      return;
    }
    const hints = (r.value as { hints?: string[] })?.hints;
    onSaved(value, Array.isArray(hints) ? hints : undefined);
  };

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      {useForm ? (
        <SchemaForm schema={schema} value={form} onChange={setForm} palette={{ text: ink.text, dim: ink.dim, border: ink.line, inputBg: ink.panel, accent: ink.accent, danger: ink.danger }} />
      ) : (
        <>
          <textarea
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            rows={Math.min(18, Math.max(4, text.split('\n').length + 1))}
            spellCheck={false}
            style={{ ...editInput, padding: '0.55rem', fontFamily: theme.mono }}
          />
          {!isStr ? <span style={{ color: ink.dim, fontSize: '0.68rem' }}>No schema — editing the raw JSON value.</span> : null}
        </>
      )}
      {err ? <span style={{ color: ink.danger, fontSize: '0.78rem', fontFamily: theme.mono }}>{err}</span> : null}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button onClick={() => void save()} disabled={busy} style={{ ...inkAction, background: 'rgba(245,196,83,0.08)', cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} style={{ background: 'none', border: `1px solid ${ink.line}`, borderRadius: 8, color: ink.dim, padding: '0.4rem 0.9rem', cursor: 'pointer', fontFamily: theme.mono, fontSize: '0.8rem' }}>Cancel</button>
      </div>
    </div>
  );
}

/** The peek body: the fact rendered by its viewer (full, not clamped), its
 *  provenance line, its neighbourhood, and the actions — escalate to the type's
 *  page/editor when declared, else edit generically in place. */
export function FactDetail({ e, compact }: { e: ListEntry; compact?: boolean }): React.JSX.Element {
  const [entry, setEntry] = useState<ListEntry>(e);
  const [editing, setEditing] = useState(false);
  const [hints, setHints] = useState<string[] | null>(null);
  useEffect(() => {
    setEntry(e);
    setEditing(false);
    setHints(null);
  }, [e]);
  const open = factHref(entry);
  const edit = factEdit(entry);
  const meta = entry._meta;
  const system = entry.key.startsWith('_');
  // The type's declared fields (ADR-0002 shape.fields), additively on $types.
  const fields = (declFor(entry, typeDecls) as { fields?: FormField[] } | undefined)?.fields;
  return (
    <div style={{ display: 'grid', gap: '0.7rem' }}>
      <div style={{ color: ink.dim, fontSize: '0.68rem', fontFamily: theme.mono, wordBreak: 'break-all' }}>
        {[meta?.type, entry.key].filter(Boolean).join(' · ')}
        {meta?.tags?.length ? '  ·  ' + meta.tags.map((t) => '#' + t).join(' ') : ''}
      </div>
      {editing ? (
        <FactEditor
          e={entry}
          fields={fields}
          onCancel={() => setEditing(false)}
          onSaved={(v, h) => {
            setEntry({ ...entry, value: v });
            setHints(h ?? null);
            setEditing(false);
          }}
        />
      ) : (
        <>
          <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
            <FactBody e={entry} full />
          </div>
          {hints?.length ? (
            <div style={{ display: 'grid', gap: '0.2rem', border: `1px solid ${ink.line}`, borderRadius: 8, padding: '0.5rem 0.6rem', background: ink.panel }}>
              <span style={{ color: ink.dim, fontSize: '0.68rem', fontFamily: theme.mono }}>suggestions</span>
              {hints.map((h, i) => (
                <span key={i} style={{ fontSize: '0.76rem', color: ink.text }}>· {h}</span>
              ))}
            </div>
          ) : null}
          {!compact ? (
            <div style={{ display: 'grid', gap: '0.3rem' }}>
              <span style={{ color: ink.dim, fontSize: '0.68rem', fontFamily: theme.mono }}>neighbourhood</span>
              <Neighbourhood keyName={entry.key} />
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            {open ? <a href={open} style={inkAction}>Open ↗</a> : null}
            {edit ? <a href={edit} style={inkAction}>Edit in cell ↗</a> : !system ? (
              <button onClick={() => setEditing(true)} style={{ ...inkAction, background: 'rgba(245,196,83,0.08)', cursor: 'pointer' }}>Edit</button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/** Mounted once at the app root: listens for `openFact`, hydrates a bare {key}
 *  via peek, and renders the modal. Returns null when nothing is open. */
export function FactDetailHost(): React.JSX.Element | null {
  const [entry, setEntry] = useState<ListEntry | null>(null);
  useEffect(() => {
    const onOpen = (ev: Event): void => {
      const detail = (ev as CustomEvent<ListEntry>).detail;
      if (!detail?.key) return;
      setEntry(detail);
      if (detail.value === undefined) {
        mcpCall('read', 'workspace.peek', { key: detail.key })
          .then((r) => {
            const f = r.value as { value?: unknown; _meta?: ListEntry['_meta'] } | null;
            if (r.ok && f) setEntry({ key: detail.key, value: f.value, _meta: f._meta });
          })
          .catch(() => undefined);
      }
    };
    window.addEventListener(FACT_DETAIL_EVENT, onOpen as EventListener);
    return () => window.removeEventListener(FACT_DETAIL_EVENT, onOpen as EventListener);
  }, []);
  useEffect(() => {
    if (!entry) return;
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') setEntry(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entry]);
  if (!entry) return null;
  const title = `${typeIcon(entry) ? typeIcon(entry) + ' ' : ''}${factTitle(entry)}`;
  // The peek is an INK bottom sheet — the same instrument language as the
  // palette it was summoned from (it used to be the parchment Modal: a jarring
  // theme flip mid-gesture — owner feedback 2026-07-10). Same width metric as
  // the palette, so the two read as one system.
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => setEntry(null)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}
    >
      <div
        onClick={(ev) => ev.stopPropagation()}
        style={{
          background: ink.bg,
          color: ink.text,
          width: 'min(720px, 100vw)',
          maxHeight: '86dvh',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          borderTopLeftRadius: 14,
          borderTopRightRadius: 14,
          border: `1px solid ${ink.line}`,
          borderBottom: 'none',
          boxShadow: '0 -12px 40px rgba(0,0,0,0.5)',
          padding: '0.8rem 0.9rem calc(0.9rem + env(safe-area-inset-bottom))',
          display: 'grid',
          gap: '0.7rem',
          alignContent: 'start',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
          <strong style={{ fontFamily: theme.serif, fontSize: '1.02rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{title}</strong>
          <button
            onClick={() => setEntry(null)}
            aria-label="close"
            style={{ background: 'none', border: 'none', color: ink.dim, cursor: 'pointer', fontSize: '1.1rem', padding: '0.2rem 0.4rem', flexShrink: 0 }}
          >
            ×
          </button>
        </div>
        <FactDetail e={entry} />
      </div>
    </div>
  );
}

// ─── the workspace window (phase 2c) ───────────────────────────────

/** The workspace window's seed (salience-ranked facts + attention + edges). */
export interface WorkspaceSeed {
  attention: AttentionData | null;
  facts: ListEntry[];
  total: number;
  edges: Edge[];
}

export interface AttentionData {
  stale: Array<{ key: string; updatedAt: string; type: string | null }>;
  unlinked: string[];
  dangling: Array<{ from: string; rel: string; to: string; reason: string }>;
}

/**
 * The signed-in window over the substrate: an attention strip (the
 * just-in-time cron, read at a glance) above the most salient facts of the
 * slice — `query` ranked by salience, titled and routed by the `_types`
 * vocabulary, exactly the shaping agents get from the same read.
 */
/** Group edges by source key so each fact can show its outbound relationships. */
function edgeMap(edges: Edge[]): Map<string, Edge[]> {
  const m = new Map<string, Edge[]>();
  for (const ed of edges.filter((x) => !x.from.startsWith('_'))) {
    const list = m.get(ed.from) ?? [];
    list.push(ed);
    m.set(ed.from, list);
  }
  return m;
}

/** The salience lenses (platform/runtime/state LENS_PRESETS) as a UI choice —
 *  per-read biases over the tuned default ranking. */
const LENSES: Array<{ id: string; label: string }> = [
  { id: 'salience', label: 'Salient' },
  { id: 'recent', label: 'Recent' },
  { id: 'connected', label: 'Connected' },
  { id: 'durable', label: 'Durable' },
  { id: 'active', label: 'Active' },
];

export function WorkspaceWindow({ authed, seed }: { authed: boolean; seed?: WorkspaceSeed }): React.JSX.Element | null {
  const [att, setAtt] = useState<AttentionData | null>(seed?.attention ?? null);
  const [facts, setFacts] = useState<ListEntry[] | null>(seed ? seed.facts : null);
  const [total, setTotal] = useState(seed?.total ?? 0);
  const [edges, setEdges] = useState<Map<string, Edge[]>>(seed ? edgeMap(seed.edges) : new Map());
  const [err, setErr] = useState<string | null>(null);
  const [lens, setLens] = useState('salience');
  const [busy, setBusy] = useState(false);
  const firstLens = React.useRef(true);

  // Re-rank on a lens change — a per-read salience bias, the same `lens` an agent
  // passes to workspace.query. The first run is skipped (the seeded/default view
  // already stands); switching lens re-queries client-side.
  useEffect(() => {
    if (!authed) return;
    if (firstLens.current) {
      firstLens.current = false;
      return;
    }
    let live = true;
    setBusy(true);
    mcpCall('read', 'workspace.query', { limit: 10, ...(lens !== 'salience' ? { lens } : {}) })
      .then((r) => {
        if (!live || !r.ok) return;
        const v = r.value as { entries?: ListEntry[]; total?: number };
        setFacts(v.entries ?? []);
        setTotal(v.total ?? 0);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [lens, authed]);

  useEffect(() => {
    // SSR seeded this snapshot (salience-ranked facts + attention + edges) — trust
    // it (no refetch flash). typeDecls is seeded too, so titles/viewers resolve.
    if (!authed || seed) return;
    let live = true;
    (async () => {
      try {
        await loadTypeDecls();
        const [a, q] = await Promise.all([
          mcpCall('read', 'workspace.attention', { limit: 5 }),
          mcpCall('read', 'workspace.query', { limit: 10 }),
        ]);
        if (!live) return;
        if (a.ok) setAtt(a.value as AttentionData);
        if (q.ok) {
          const v = q.value as { entries?: ListEntry[]; total?: number };
          setFacts(v.entries ?? []);
          setTotal(v.total ?? 0);
        } else {
          setErr(typeof q.value === 'string' ? q.value : 'error');
        }
      } catch (e) {
        if (live) setErr(String(e));
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  // Edges only AROUND the visible window (ADR-0048 keys-scoped links) — replaces
  // the old whole-slice `links {}` read; re-fetches when the window's facts
  // change (lens re-rank, cold load) and covers the count-only SSR seed.
  useEffect(() => {
    if (!authed || !facts?.length) return;
    let live = true;
    void mcpCall('read', 'workspace.links', { keys: facts.map((f) => f.key) }).then((r) => {
      if (live && r.ok) setEdges(edgeMap((r.value as { edges?: Edge[] }).edges ?? []));
    });
    return () => {
      live = false;
    };
  }, [authed, facts]);

  if (!authed) return null;

  const attTotal = att ? att.stale.length + att.unlinked.length + att.dangling.length : 0;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.6rem', flexWrap: 'wrap' }}>
        <Heading sub="Your slice, salience-ranked — the same query an agent makes, rendered. The strip is the ranger's notebook.">
          Workspace
        </Heading>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: ink.dim, fontSize: '0.72rem', flexShrink: 0 }}>
          <span style={{ fontFamily: theme.mono }}>{busy ? '…' : 'lens'}</span>
          <select
            value={lens}
            onChange={(e) => setLens(e.target.value)}
            style={{ fontFamily: 'inherit', fontSize: '0.78rem', color: ink.text, background: '#fffef9', border: `1px solid ${ink.line}`, borderRadius: 6, padding: '0.15rem 0.35rem' }}
          >
            {LENSES.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
        </label>
      </div>
      {err ? <Badge tone="danger">{err}</Badge> : null}
      {att ? (
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', margin: '0.3rem 0 0.6rem' }}>
          <Badge tone={attTotal ? 'accent' : 'dim'}>
            {attTotal ? `needs attention: ${attTotal}` : 'all trails clear'}
          </Badge>
          {att.stale.length ? <Badge tone="dim">{att.stale.length} stale</Badge> : null}
          {att.unlinked.length ? <Badge tone="dim">{att.unlinked.length} unlinked</Badge> : null}
          {att.dangling.length ? <Badge tone="dim">{att.dangling.length} dangling edges</Badge> : null}
        </div>
      ) : null}
      {facts === null ? (
        <p style={{ color: ink.dim }}>Loading…</p>
      ) : facts.length === 0 ? (
        <p style={{ color: ink.dim }}>An empty slice — remember something.</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '0.7rem' }}>
          {facts.map((e) => {
            const to = factHref(e);
            const icon = typeIcon(e);
            const title = `${icon ? icon + ' ' : ''}${factTitle(e)}`;
            const out = edges.get(e.key) ?? [];
            return (
              <li key={e.key} style={{ lineHeight: 1.4, display: 'grid', gap: '0.25rem' }}>
                {/* Peek every fact in the modal first; cmd/ctrl-click still deep-links
                    to the type's own surface when it has one. */}
                <a
                  href={to ?? undefined}
                  onClick={(ev) => {
                    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
                    ev.preventDefault();
                    openFact(e);
                  }}
                  style={{ color: ink.accent, textDecoration: 'none', fontWeight: 600, cursor: 'pointer' }}
                >
                  {title}
                </a>
                {/* The type's declared default viewer (hint), else a text preview. */}
                <FactBody e={e} />
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ color: ink.dim, fontSize: '0.68rem', fontFamily: theme.mono }}>
                    {[e._meta?.type, e.key].filter(Boolean).join(' · ')}
                  </span>
                  <EditLink e={e} />
                  {out.slice(0, 5).map((ed, i) => (
                    <span
                      key={i}
                      title={`${ed.rel} → ${ed.to}`}
                      style={{ fontSize: '0.66rem', color: ink.accent, border: `1px solid ${ink.line}`, borderRadius: 999, padding: '0 0.4rem', fontFamily: theme.mono, whiteSpace: 'nowrap' }}
                    >
                      {ed.rel}→{ed.to.length > 14 ? ed.to.slice(0, 13) + '…' : ed.to}
                    </span>
                  ))}
                  {out.length > 5 ? <span style={{ color: ink.dim, fontSize: '0.66rem' }}>+{out.length - 5}</span> : null}
                </div>
              </li>
            );
          })}
          {total > facts.length ? (
            <li style={{ color: ink.dim, fontSize: '0.8rem' }}>… {total - facts.length} more (query/recall for the rest)</li>
          ) : null}
        </ul>
      )}
    </Card>
  );
}

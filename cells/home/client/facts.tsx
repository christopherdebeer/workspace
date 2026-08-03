/**
 * ADR-0044 Inc 5: the workspace window and the fact surface, split from app.tsx
 * (moved verbatim) — the type vocabulary (typeDecls cache + accessors), fact
 * presentation (titles/hrefs/FactBody/HintBody/FactEmbed), the progressive
 * fact detail (peek modal, generic editor), and the workspace window itself.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Card, Heading, Badge, Button, Anchor, CodeBlock, theme, resolve, declFor, iconOf, titleOf, BODY_FIELDS as SHARED_BODY_FIELDS, type TypeDecl, type AssembleSpec, SchemaForm, isFormable, type FormFieldSchema } from '@parc/ui';
import { ink } from './ink';
import { SafeMarkdown, InlineMarkdown, safeFrameUrl, safeImageUrl, safeNavigationUrl, type FenceEditTarget } from './safe-markdown';
import { ViewerBody, DISPLAY_VIEWERS } from './viewers';
import { CodeEditor } from './editor';
import { DEFAULT_TYPE_DECLS } from './type-decls';
import { cellUrl } from './bridge';
import { localize, mcpCall } from './lib';
import { FederatedRendererFrame } from './federated';

const { useState, useEffect } = React;

// ─── the type vocabulary (presentation/routing as data) ────────────

export interface ListEntry {
  key: string;
  value?: unknown;
  _meta?: { type?: string | null; tags?: string[]; updatedAt?: string; version?: number; revision?: number; writer?: string; via?: string; seq?: number; score?: number; superseded?: boolean; supersededBy?: string };
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
  // resolveType, so home consumes it instead of re-deriving. (The per-fact label is
  // still applied client-side, by the shared @parc/ui `titleOf` — Present runs where
  // the fact's value is.)
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
export function typeIcon(e: ListEntry): string {
  return iconOf(declFor(e, typeDecls));
}

/** A fact's one-line presentation, via the ONE shared resolver (@parc/ui
 *  `titleOf`): declared label path (envelope-rooted, so `value.title` reads
 *  the entry's value — the local fork rooted it at the value and broke every
 *  declared `value.*` label) → value heuristic → key. */
export function factTitle(e: ListEntry): string {
  return titleOf(e, declFor(e, typeDecls));
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
  const candidate = r.cellRef && r.path !== undefined
    ? cellUrl(r.cellRef.owner, r.cellRef.name, r.path)
    : r.surface ? localize(r.surface) : null;
  return safeNavigationUrl(candidate);
}

/** Where a fact opens — resolved from the type vocabulary, no hardcoded cells. */
export function factHref(e: ListEntry): string | null {
  return handlerUrl(resolve(e, 'open', typeDecls));
}

/** Where a fact edits — its type's `edit` handler, if it declares one. */
export function factEdit(e: ListEntry): string | null {
  return handlerUrl(resolve(e, 'edit', typeDecls));
}

/** The CELL a resolved handler lands in, as a display handle (`@owner/name`) —
 *  from the handler's own cellRef when it names one, else the type's declared
 *  manager. Lets an action say WHERE it goes ("Open in @c15r/lit") instead of
 *  a bare arrow into the unknown. Normalises both manager spellings
 *  (`@c15r/lit` and the registry's path form `/@c15r/lit`). */
function handlerCell(r: ReturnType<typeof resolve>, e: ListEntry): string | null {
  if (r?.cellRef) return `@${r.cellRef.owner}/${r.cellRef.name}`;
  const manager = declFor(e, typeDecls)?.manager;
  if (typeof manager !== 'string' || !manager) return null;
  const clean = manager.replace(/^\/?@?/, '');
  return clean.includes('/') ? `@${clean}` : null; // 'platform' etc. → no cell handle
}
/** `{href, cell}` for a fact's open/edit action — the footer's label source. */
export function factAction(e: ListEntry, intent: 'open' | 'edit'): { href: string; cell: string | null } | null {
  const r = resolve(e, intent, typeDecls);
  const href = handlerUrl(r);
  return href ? { href, cell: handlerCell(r, e) } : null;
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

/** First present string field among `keys` of an object value. */
function strField(v: unknown, keys: string[]): string | undefined {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of keys) if (typeof o[k] === 'string' && o[k]) return o[k] as string;
  }
  return undefined;
}
// The body-field list is the SHARED one (@parc/ui render-hints) — home's local
// copy omitted `claim`'s `statement`, so a claim read (and would have written
// back) differently here than on the conversation card. `bodyText` and the
// write-back below must use the same list, or an edit targets the wrong field.
const BODY_FIELDS: readonly string[] = SHARED_BODY_FIELDS;

/** The markdown/text body of a fact value (string, or its content-ish field). */
function bodyText(v: unknown): string {
  if (typeof v === 'string') return v;
  return strField(v, [...BODY_FIELDS]) ?? '';
}

/** WHICH field `bodyText` read — what an in-place edit must write back to.
 *  `null` means the value IS the body (a bare string fact). `undefined` means
 *  there is no text body, so there is nothing to edit in place. */
function bodyField(v: unknown): string | null | undefined {
  if (typeof v === 'string') return null;
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  return BODY_FIELDS.find((k) => typeof o[k] === 'string' && o[k]);
}

/**
 * Write an edited body back to the fact that owns it — the commit half of
 * fence-grain editing.
 *
 * The edit lands on the ONE field the body was read from, leaving the rest of
 * the value untouched, and rides `ifVersion` so a concurrent write loses
 * rather than silently clobbers. This is the anti-drift property the whole
 * design turns on (docs/dotlit-review §4): a fence has exactly one home, and
 * editing it goes there — never into a copy at the point of display.
 */
function bodyEditTarget(
  e: ListEntry,
  source: string,
  onSaved?: (entry: ListEntry) => void,
): { save: (next: string) => Promise<void>; source: string } | undefined {
  const field = bodyField(e.value);
  if (field === undefined) return undefined;
  return {
    source,
    save: async (next: string) => {
      const value = field === null ? next : { ...(e.value as Record<string, unknown>), [field]: next };
      const r = await mcpCall('act', 'workspace.remember', {
        key: e.key,
        value,
        ...(e._meta?.type ? { type: e._meta.type } : {}),
        ...(typeof e._meta?.version === 'number' ? { ifVersion: e._meta.version } : {}),
      });
      if (!r.ok) throw new Error(typeof r.value === 'string' ? r.value : 'save failed');
      const saved = (r.value && typeof r.value === 'object' ? r.value : {}) as { value?: unknown; _meta?: ListEntry['_meta'] };
      onSaved?.({ ...e, value: Object.prototype.hasOwnProperty.call(saved, 'value') ? saved.value : value, _meta: saved._meta ?? e._meta });
    },
  };
}

/** Render a fact body by a built-in `hint` kind. SSR-safe: deterministic, no
 *  browser globals. Returns null when there's nothing to draw (caller falls back). */
function HintBody({ kind, e, tone = 'dark', edit }: { kind: string; e: ListEntry; tone?: 'light' | 'dark'; edit?: FenceEditTarget }): React.JSX.Element | null {
  const v = e.value;
  switch (kind) {
    case 'md':
    case 'markdown': {
      const md = bodyText(v);
      if (!md) return null;
      // Fact links ([[wiki]]s) in any markdown body open in place, with an
      // origin-aware href for new-tab (`/r/` exists only at the apex).
      return <SafeMarkdown text={md.replace(/\r\n/g, '\n')} edit={edit} onFactLink={(k, frag) => openFact({ key: k }, frag)} factHref={(k) => localize(`/r/${k}`)} tone={tone} />;
    }
    case 'image': {
      const src = safeImageUrl(strField(v, ['src', 'url', 'href', 'image']));
      return src ? <img src={src} alt={factTitle(e)} loading="lazy" referrerPolicy="no-referrer" style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }} /> : null;
    }
    case 'code': {
      const code = bodyText(v);
      return code ? <CodeBlock>{code.slice(0, 2000)}</CodeBlock> : null;
    }
    // mermaid / csv / json / style: the shared @c15r/viewers pure viewers — the
    // same implementations canvas and lit mount. A type declaring these hints
    // now renders the real diagram/table/tree in home too, not a fallback.
    case 'mermaid':
    case 'csv':
    case 'json':
    case 'style': {
      const code = kind === 'json' && typeof v !== 'string' ? JSON.stringify(v, null, 2) : bodyText(v);
      return code ? <ViewerBody lang={kind} code={code} /> : null;
    }
    case 'metric': {
      const n = typeof v === 'number' ? String(v) : (strField(v, ['value', 'count', 'n', 'total']) ?? bodyText(v));
      return n ? <strong style={{ fontFamily: theme.serif, fontSize: '1.4rem' }}>{n}</strong> : null;
    }
    case 'file':
      return <FileBody e={e} tone={tone} />;
    case 'fields':
      return <FieldsBody value={v} />;
    default:
      return null;
  }
}

/** Human-readable byte size for a file card. */
function humanBytes(n: unknown): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

/**
 * A `file` fact (ADR-0027), rendered by what it actually IS.
 *
 * `file` is one type over a heterogeneous corpus: small text stores `content`
 * inline, binary/large objects carry `s3Key`/`url` and no body at all. It
 * declared a flat `markdown` render, so a PNG resolved to the markdown hint,
 * found no text, and fell through to the raw-JSON floor — the value's own
 * `contentType` sitting unread two fields away. Dispatch on it instead:
 * images paint, text reads as markdown, and anything else gets an honest card
 * (what it is, how big, where it lives) rather than a stringified pointer.
 */
function FileBody({ e, tone = 'dark' }: { e: ListEntry; tone?: 'light' | 'dark' }): React.JSX.Element | null {
  const t = SHEET_TONE[tone];
  const v = (e.value && typeof e.value === 'object' ? e.value : {}) as Record<string, unknown>;
  const ct = typeof v.contentType === 'string' ? v.contentType : '';
  const body = bodyText(v);
  if (ct.startsWith('image/')) {
    const src = safeImageUrl(v.url);
    if (src) return <img src={src} alt={factTitle(e)} loading="lazy" referrerPolicy="no-referrer" style={{ maxWidth: '100%', borderRadius: 8, display: 'block' }} />;
  }
  // Inline text (the docs corpus): markdown for markdown, plain otherwise.
  if (body) {
    if (ct === 'text/markdown' || ct === 'text/x-markdown' || !ct || /\.mdx?$/.test(String(v.path ?? ''))) {
      return <SafeMarkdown text={body.replace(/\r\n/g, '\n')} onFactLink={(k, frag) => openFact({ key: k }, frag)} factHref={(k) => localize(`/r/${k}`)} tone={tone} />;
    }
    return <CodeBlock>{body.slice(0, 4000)}</CodeBlock>;
  }
  // No body — a pointer. Say so plainly instead of dumping the envelope.
  const href = safeNavigationUrl(v.url);
  const meta = [ct, humanBytes(v.bytes), typeof v.source === 'string' ? v.source : null].filter(Boolean).join('  ·  ');
  return (
    <div style={{ display: 'grid', gap: '0.3rem', border: `1px solid ${t.line}`, borderRadius: 8, padding: '0.6rem 0.7rem' }}>
      <span style={{ fontFamily: theme.mono, fontSize: '0.78rem', overflowWrap: 'anywhere' }}>{typeof v.path === 'string' ? v.path : e.key}</span>
      {meta ? <span style={{ color: t.dim, fontSize: '0.68rem', fontFamily: theme.mono }}>{meta}</span> : null}
      {href ? <a href={href} rel="noreferrer" style={{ color: t.accent, fontFamily: theme.mono, fontSize: '0.75rem', justifySelf: 'start' }}>open ↗</a> : null}
    </div>
  );
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
function FactEmbed({ src, href, title }: { src: string; href: string | null; title: string }): React.JSX.Element | null {
  const frameSrc = safeFrameUrl(src);
  const openHref = safeNavigationUrl(href);
  if (!frameSrc) return null;
  return (
    <div style={{ position: 'relative', height: 200, borderRadius: 8, overflow: 'hidden', border: `1px solid ${ink.line}`, background: '#fff' }}>
      <iframe src={frameSrc} title={title} loading="lazy" scrolling="no" tabIndex={-1} aria-hidden sandbox="" referrerPolicy="no-referrer" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0, display: 'block', pointerEvents: 'none' }} />
      {openHref ? <a href={openHref} title={`Open ${title}`} aria-label={`Open ${title}`} rel="noopener noreferrer" style={{ position: 'absolute', inset: 0, display: 'block' }} /> : null}
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

// The shared PURE VIEWERS (@c15r/viewers) now live in `./viewers`, so a FENCE
// and a whole-fact `render` hint reach the same implementation (see that
// module's header, and docs/home-hosts-lit.md).

/**
 * A WHOLE doc, assembled from its blocks. A `doc` fact holds only {title,summary}
 * and a `doc-block` is one slice — so for either we read the doc's membership the
 * same substrate-native way lit's own reader (loadDoc) does: one
 * `workspace.edges({around, membership})` returns every member block with its
 * content + placement.seq, already in narrative order. Sort by seq, concatenate,
 * render one markdown body. No lit code, no iframe — the substrate does the join.
 * Fails soft: a bad/empty read falls back to the fact's own body or summary.
 */
export function DocBody({ e, initialMd, spec, tone = 'dark', anchor, editable }: { e: ListEntry; initialMd?: string; spec?: AssembleSpec; tone?: 'light' | 'dark'; anchor?: string;
  /** Let each assembled MEMBER be edited where it is read. An assembled doc
   *  is a view over member facts, so the edit belongs to the member — this is
   *  the grain at which reading mode becomes writing mode. */
  editable?: boolean }): React.JSX.Element {
  const type = e._meta?.type;
  // The CONTAINER key. Declared (ADR-0093): a container type assembles its own
  // key; a member type (`containerTagPrefix`) delegates via its container tag.
  // Undeclared: the compiled doc floor — a `doc` IS the doc; a `doc-block`
  // points at its doc via a `doc:` tag.
  const docKey = spec
    ? spec.containerTagPrefix
      ? (e._meta?.tags ?? []).find((t) => t.startsWith(spec.containerTagPrefix as string)) ?? null
      : e.key
    : type === 'doc' || e.key.startsWith('doc:')
      ? e.key
      : (e._meta?.tags ?? []).find((t) => t.startsWith('doc:')) ?? null;
  // `initialMd` is an SSR-provided body (the landing doc's public file mirror):
  // the first paint — server AND hydration — renders the doc itself, never a
  // "reading…" spinner. The live read still runs and replaces it when it
  // succeeds; a failed live read keeps the seed instead of blanking.
  const [md, setMd] = useState<string | null>(initialMd ?? null);
  // Membership assembly keeps PER-MEMBER sections (not one joined string) so
  // each member is an addressable target: `#<member-key>` deep links and the
  // member banner's "part of" jump both scroll to their section.
  const [sections, setSections] = useState<Array<{ key: string; content: string; type?: string | null; version?: number }> | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'fail'>(initialMd ? 'ready' : 'loading');
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  // The audience fallback (ADR-0093 / docs-sync ADR-0027): when membership
  // yields nothing for THIS viewer (e.g. `@guest` — members aren't public),
  // read the declared alternate source instead. A GRANT-FOLDED container
  // (`owner/doc:docs/x`) re-applies its `owner/` prefix here — the fold is the
  // host's concern (peek's owner/key addressing resolves it), never the
  // type's. Undeclared vocabularies keep the compiled corpus-mirror floor.
  const slash = docKey?.indexOf('/') ?? -1;
  const colon = docKey?.indexOf(':') ?? -1;
  const owner = docKey && slash > 0 && (colon < 0 || slash < colon) ? docKey.slice(0, slash) : null;
  const bare = docKey ? (owner ? docKey.slice(slash + 1) : docKey) : null;
  // `${match}` = the container key's suffix after its type prefix (vocab deriveId).
  const bc = bare?.indexOf(':') ?? -1;
  const bs = bare?.indexOf('/') ?? -1;
  const cut = bc >= 0 && (bs < 0 || bc < bs) ? bc : bs;
  const matchPart = bare && cut > 0 ? bare.slice(cut + 1) : null;
  const dm = docKey?.match(/^(?:([^/]+)\/)?doc:docs\/(.+)$/) ?? null; // the compiled floor (+ link base)
  const fileKey = spec?.fallbackKey && matchPart
    ? `${owner ? `${owner}/` : ''}${spec.fallbackKey.split('${match}').join(matchPart)}`
    : dm
      ? `${dm[1] ? `${dm[1]}/` : ''}file/docs/${dm[2]}.md`
      : null;
  const memberText = (v: unknown): string => {
    if (spec?.field && v && typeof v === 'object') {
      const f = (v as Record<string, unknown>)[spec.field];
      if (typeof f === 'string' && f) return f;
    }
    return bodyText(v);
  };
  useEffect(() => {
    if (!docKey) { if (!initialMd) setState('fail'); return; }
    let live = true;
    if (!initialMd) {
      setState('loading');
      setMd(null);
    }
    // `shape:'full'` — a doc's WHOLE body assembles from its members, so each
    // member's content must come back UNCLAMPED (the default 'card' shape
    // truncates long string values to previews — fine for a chip, wrong for
    // reading the doc). Truncation stays the caller's choice elsewhere.
    void mcpCall('read', 'workspace.edges', { around: docKey, membership: true, shape: 'full' })
      .then(async (r) => {
        if (!live) return;
        const members = (r.ok ? (r.value as { members?: Array<{ key?: string; value?: unknown; placement?: { seq?: number }; _meta?: { type?: string | null; version?: number } }> } | null)?.members : null) ?? [];
        const secs = members
          .map((m) => ({ key: String(m.key ?? ''), seq: Number(m.placement?.seq ?? 0), content: memberText(m.value), type: m._meta?.type, version: m._meta?.version }))
          .sort((a, b) => a.seq - b.seq)
          .filter((m) => m.content);
        if (secs.length) {
          setSections(secs.map(({ key, content, type, version }) => ({ key, content, type, version })));
          setMd(null);
          setState('ready');
          return;
        }
        let text = '';
        if (!text && fileKey) {
          const fr = await mcpCall('read', 'workspace.peek', { key: fileKey }).catch(() => null);
          if (!live) return;
          const fv = fr?.ok ? (fr.value as { value?: unknown } | null)?.value : null;
          text = bodyText(fv) || '';
        }
        if (text) {
          setMd(text);
          setState('ready');
        } else if (!initialMd) {
          setMd(text);
          setState('fail');
        } // else: keep the SSR seed — an empty live read must not blank the doc
      })
      .catch(() => { if (live && !initialMd) setState('fail'); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fileKey/memberText derive from docKey+the static decl
  }, [docKey, initialMd, fileKey, spec?.field]);
  // Link context (ADR-0092 follow-on): relative `*.md` hrefs resolve against
  // THIS doc's corpus directory, and fact links open in place via the peek
  // modal — docs are navigable on home, not just readable.
  const mdBase = dm ? `docs/${dm[2]}`.replace(/\/[^/]*$/, '') : undefined;
  // `[[key#member]]` (ADR-0061) opens the target scrolled to that member —
  // the same anchor the member banner's "part of" jump uses.
  const onFactLink = (k: string, frag?: string): void => openFact({ key: k }, frag);
  // Origin-aware fact hrefs: `/r/<key>` exists only at the apex, so localize
  // (→ apex-absolute) keeps new-tab/middle-click navigable when home is
  // served from its own cell subdomain.
  const factHref = (k: string): string => localize(`/r/${k}`);
  // Scroll the assembled body to a member's section: an explicit `anchor` (the
  // member banner's in-place jump) or the URL fragment (`/r/<doc>#<member>`,
  // the shareable form). Folded members come back `owner/`-prefixed — match
  // exact or by suffix so a bare fragment still lands.
  useEffect(() => {
    if (state !== 'ready' || !sections?.length) return;
    let target = anchor ?? null;
    if (!target && typeof location !== 'undefined' && location.hash.length > 1) {
      try { target = decodeURIComponent(location.hash.slice(1)); } catch { target = location.hash.slice(1); }
    }
    if (!target) return;
    const el = bodyRef.current?.querySelector(`[data-mkey="${(window.CSS?.escape ?? ((x: string) => x))(target)}"]`)
      ?? bodyRef.current?.querySelector(`[data-mkey$="${(window.CSS?.escape ?? ((x: string) => x))('/' + target)}"]`);
    if (el) setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60);
  }, [state, sections, anchor]);
  if (state === 'ready' && sections?.length) {
    // Each section IS a member fact, so an edit inside it writes THAT fact —
    // never the container, and never a copy. `spec.field` names where the text
    // lives on a declared vocabulary (`content` for a doc-block); an
    // undeclared member falls back to the body heuristic.
    const memberEdit = (sec: { key: string; content: string; type?: string | null; version?: number }): FenceEditTarget | undefined => {
      if (!editable) return undefined;
      return bodyEditTarget(
        { key: sec.key, value: spec?.field ? { [spec.field]: sec.content } : sec.content, _meta: { type: sec.type ?? undefined, version: sec.version } },
        sec.content,
        (saved) => setSections((cur) => cur?.map((s2) => (s2.key === sec.key
          // Re-read the saved body back into the assembled view, and carry the
          // NEW version forward so a second edit in the same session doesn't
          // fail its ifVersion check against a stale number.
          ? { ...s2, content: spec?.field ? String((saved.value as Record<string, unknown>)?.[spec.field] ?? '') : String(saved.value ?? ''), version: saved._meta?.version ?? s2.version }
          : s2)) ?? cur),
      );
    };
    return (
      <div ref={bodyRef} style={{ display: 'grid', gap: '0.2rem' }}>
        {sections.map((sec) => (
          <section key={sec.key} data-mkey={sec.key} style={{ scrollMarginTop: '3.2rem' }}>
            <SafeMarkdown text={sec.content.replace(/\r\n/g, '\n')} edit={memberEdit(sec)} base={mdBase} onFactLink={onFactLink} factHref={factHref} tone={tone} />
          </section>
        ))}
      </div>
    );
  }
  if (state === 'ready' && md) return <SafeMarkdown text={md.replace(/\r\n/g, '\n')} base={mdBase} onFactLink={onFactLink} factHref={factHref} tone={tone} />;
  if (state === 'loading') return <span style={{ color: ink.dim, fontSize: '0.8rem', fontFamily: theme.mono }}>reading…</span>;
  // Assembly failed — the fact's own body (a block's content) or its summary.
  const own = bodyText(e.value);
  if (own) return <SafeMarkdown text={own.replace(/\r\n/g, '\n')} base={mdBase} onFactLink={onFactLink} factHref={factHref} tone={tone} />;
  const sum = strField(e.value, ['summary']);
  return <span style={{ fontSize: '0.85rem', color: ink.text }}>{sum ?? factTitle(e)}</span>;
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
/** Is this fact an assembled CONTAINER on this surface (a doc, or a type
 *  declaring container-side assembly)? Containers suppress member backlinks
 *  in the neighbourhood — the members are already on the page as the body. */
export function isAssembledContainer(e: ListEntry): boolean {
  const asm = resolve(e, 'assemble', typeDecls)?.assemble;
  if (asm) return !asm.containerTagPrefix;
  return e._meta?.type === 'doc' || e.key.replace(/^[^/]+\//, '').startsWith('doc:');
}

/** The containment banner a MEMBER shows before its content: "⊂ part of
 *  <container>" — click opens the whole, scrolled to this member's section;
 *  the href is the container's canonical address with the member as the
 *  fragment (deep-linkable in a new tab too). */
function MemberContext({ e, tagPrefix, tone = 'dark' }: { e: ListEntry; tagPrefix: string; tone?: 'light' | 'dark' }): React.JSX.Element | null {
  const t = SHEET_TONE[tone];
  const bareTag = (e._meta?.tags ?? []).find((x) => x.startsWith(tagPrefix));
  if (!bareTag) return null;
  // A grant-folded member (`owner/doc-block:x`) points at its container with a
  // BARE tag — re-apply the owner prefix so the whole resolves for this viewer.
  const om = e.key.match(/^([^/:]+)\/(?=[^/]*:)/);
  const containerKey = om ? `${om[1]}/${bareTag}` : bareTag;
  const bareMemberKey = om ? e.key.slice(om[1].length + 1) : e.key;
  const label = bareTag.includes(':') ? bareTag.slice(bareTag.indexOf(':') + 1) : bareTag;
  return (
    <a
      href={`${localize(`/r/${containerKey}`)}#${encodeURIComponent(bareMemberKey)}`}
      onClick={(ev) => { ev.preventDefault(); openFact({ key: containerKey }, bareMemberKey); }}
      title={containerKey}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', justifySelf: 'start', padding: '0.2rem 0.6rem', borderRadius: 999, border: `1px dashed ${t.line}`, color: t.dim, fontFamily: theme.mono, fontSize: '0.7rem', textDecoration: 'none', marginBottom: '0.4rem' }}
    >
      ⊂ part of <span style={{ color: t.accent }}>{label}</span>
    </a>
  );
}

/**
 * Never invisible, never fatal (ADR-0056's contract, applied to home).
 *
 * Every individual render path already fails soft — a viewer that can't load
 * degrades to `<pre>`, a failed doc assembly falls back to the fact's own body.
 * What was missing is the outer guard: a fact whose VALUE doesn't match the
 * shape its declared renderer assumes throws during render, and an unguarded
 * throw unmounts the whole React subtree — so one malformed fact took out the
 * peek sheet, or the landing's ground content, rather than just itself.
 *
 * The fallback is the fact card + an error badge: the reader still sees WHAT
 * the fact is and can still act on it, and the failure is legible rather than
 * a blank sheet. (SSR is unaffected — boundaries don't catch in
 * `renderToString`; the server path has its own guard.)
 */
export class FactBodyBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(err: unknown): void {
    // Console only: a render failure is a defect to fix, not a fact to write.
    // eslint-disable-next-line no-console
    console.error('fact body render failed', err);
  }

  render(): React.ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The error-badge fallback: the fact's own fields, plus an honest note. */
export function FactBodyFailed({ e, tone = 'dark' }: { e: ListEntry; tone?: 'light' | 'dark' }): React.JSX.Element {
  const t = SHEET_TONE[tone];
  return (
    <div style={{ display: 'grid', gap: '0.35rem' }}>
      <span style={{ color: t.danger, fontFamily: theme.mono, fontSize: '0.7rem' }}>
        ⚠ this fact&apos;s renderer failed — showing its fields
      </span>
      <FieldsBody value={e.value} />
    </div>
  );
}

/** `editable` opts a body into fence-grain in-place editing (and, for an
 *  assembled container, per-member editing): the caller says the reader may
 *  write, and `onSaved` carries the fresh entry back so the surface re-reads
 *  from the write rather than from a stale copy. */
export function FactBody(props: { e: ListEntry; embed?: boolean; full?: boolean; tone?: 'light' | 'dark'; initialMd?: string; anchor?: string; editable?: boolean; onSaved?: (entry: ListEntry) => void }): React.JSX.Element | null {
  return (
    // Keyed by the fact: a boundary latches once it has failed, so without this
    // a single bad fact would poison every fact drilled to after it.
    <FactBodyBoundary key={props.e.key} fallback={<FactBodyFailed e={props.e} tone={props.tone} />}>
      <FactBodyInner {...props} />
    </FactBodyBoundary>
  );
}

function FactBodyInner({ e, embed = false, full = false, tone = 'dark', initialMd, anchor, editable, onSaved }: { e: ListEntry; embed?: boolean; full?: boolean; tone?: 'light' | 'dark'; initialMd?: string; anchor?: string; editable?: boolean; onSaved?: (entry: ListEntry) => void }): React.JSX.Element | null {
  // A composite fact reads as its WHOLE assembled body when fully open — the
  // substrate joins membership+order; we just concatenate (see DocBody).
  // WHICH types assemble is DECLARED (ADR-0093 `assemble` intent), so any
  // cell's composite type gets this without home changes; the hardcoded
  // `doc`/`doc-block` check is only the compiled floor for a vocabulary that
  // hasn't declared yet (Inc 2 retires it).
  const t = e._meta?.type;
  if (full) {
    const asm = resolve(e, 'assemble', typeDecls)?.assemble;
    // A MEMBER in isolation shows ITS OWN content — not the whole container
    // (we may have arrived from the container itself) — with the containment
    // banner BEFORE the content so the part→whole relation is explicit.
    const memberTagPrefix = asm?.containerTagPrefix ?? (t === 'doc-block' ? 'doc:' : null);
    if (memberTagPrefix) {
      const own = bodyText(e.value);
      return (
        <div style={{ display: 'grid' }}>
          <MemberContext e={e} tagPrefix={memberTagPrefix} tone={tone} />
          {own ? <SafeMarkdown text={own.replace(/\r\n/g, '\n')} tone={tone} edit={editable ? bodyEditTarget(e, own, onSaved) : undefined} onFactLink={(k, frag) => openFact({ key: k }, frag)} factHref={(k) => localize(`/r/${k}`)} /> : <span style={{ fontSize: '0.85rem' }}>{factTitle(e)}</span>}
        </div>
      );
    }
    if (asm || t === 'doc' || t === 'doc-block') return <DocBody e={e} spec={asm} tone={tone} initialMd={initialMd} anchor={anchor} editable={editable} />;
  }
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
    // Fence-grain editing only in the FULL read: a clamped card preview has no
    // room for an editor, and its fence offsets index a body nobody can see.
    const edit = full && editable ? bodyEditTarget(e, bodyText(e.value), onSaved) : undefined;
    const el = HintBody({ kind: hint, e, tone, edit });
    if (el) return !full && LONGFORM_HINTS.has(hint) ? <ClampedBody>{el}</ClampedBody> : el;
  }
  // A declared PURE VIEWER (the Present facet's `{viewer}` binding — the shape
  // the legacy `_types/<type>` facts use for csv/json/mermaid/style). Mounts
  // the same @c15r/viewers module the hint kinds do; an unknown viewer name
  // falls through rather than mounting nothing.
  const viewer = resolved?.viewer;
  if (viewer && DISPLAY_VIEWERS.has(viewer)) {
    const code = viewer === 'json' && typeof e.value !== 'string' ? JSON.stringify(e.value, null, 2) : bodyText(e.value);
    if (code) return <ViewerBody lang={viewer} code={code} />;
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
      return <SafeMarkdown text={body.replace(/\r\n/g, '\n')} edit={editable ? bodyEditTarget(e, body, onSaved) : undefined} onFactLink={(k, frag) => openFact({ key: k }, frag)} factHref={(k) => localize(`/r/${k}`)} tone={tone} />;
    }
    if (typeof e.value === 'string') return <span style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.value}</span>;
    // A structured value with no declared viewer reads as a collapsible JSON
    // TREE (the shared @c15r/viewers `json` viewer), not a raw stringify — the
    // same tree canvas and lit show. Degrades to a <pre> if viewers can't load.
    if (e.value != null && typeof e.value === 'object') return <ViewerBody lang="json" code={JSON.stringify(e.value, null, 2)} />;
  }
  const preview = factPreview(e);
  return preview ? (
    <span style={{ color: ink.text, fontSize: '0.8rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{preview}</span>
  ) : null;
}

// A short relative time for the metadata line ("3d ago").
function relTime(iso?: string): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const s = (Date.now() - t) / 1000;
  if (s < 45) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; if (d < 30) return `${Math.floor(d)}d ago`;
  const mo = d / 30; if (mo < 12) return `${Math.floor(mo)}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// Surface tones — the SAME reading rendered on paper (the cream trailhead ground)
// or on ink (the dark palette field). Only colours differ; layout is one system.
const READING_TONE = {
  light: { text: theme.text, dim: theme.dim, accent: theme.accent },
  dark: { text: ink.text, dim: ink.dim, accent: ink.accent },
} as const;

// The full surface palette a peek SHEET (and its chrome — provenance line,
// neighbourhood chips, editor, actions) speaks. 'dark' is the ink field (the
// graph); 'light' is the cream trailhead, so a peek summoned from the landing
// stacks as a matching paper sheet over the paper Content. Extends READING_TONE
// with the container/hairline/panel tokens the chrome needs.
export type Tone = 'light' | 'dark';
const SHEET_TONE = {
  // light.bg = theme.bg (the GROUND's cream, not theme.panel): the landing peek
  // reads as a continuation of the content sheet — a second cream shade made
  // every stacked sheet look "two-toned" against the ground (owner).
  light: { bg: theme.bg, panel: '#fffef9', line: theme.border, text: theme.text, dim: theme.dim, accent: theme.accent, danger: theme.danger, actionFill: 'rgba(46,94,67,0.08)', scrim: 'rgba(8,29,36,0.32)', shadow: '0 -10px 32px rgba(8,29,36,0.16)' },
  dark: { bg: ink.bg, panel: ink.panel, line: ink.line, text: ink.text, dim: ink.dim, accent: ink.accent, danger: ink.danger, actionFill: 'rgba(245,196,83,0.08)', scrim: 'rgba(0,0,0,0.55)', shadow: '0 -12px 40px rgba(0,0,0,0.5)' },
} as const;

/**
 * A mode-aware reading of ONE fact — icon, title, and some metadata — as FLAT
 * text (paper, NOT a card; cards are for listings/query results). `tone` picks
 * the surface it sits on: 'light' = ink on the cream ground (trailhead), 'dark'
 * = light on the ink field (palette), so the two read as one system. `onImage`
 * adds a legibility shadow for text over the painted hero. With `showBody`, the
 * body follows — and since SafeMarkdown inherits `color`, it's mode-aware for
 * free (it just takes the tone's text colour).
 */
export function FactReading({ e, tone = 'light', onImage = false, head = true, showBody = false, compact = false, initialMd, footer = false, editable = false, onSaved }: {
  e: ListEntry;
  tone?: 'light' | 'dark';
  onImage?: boolean;
  /** SSR-provided markdown body (a /r/<key> deep link) — first paint renders
   *  the doc, the live read refreshes in place (see DocBody). */
  initialMd?: string;
  /** The icon + title + metadata line (default). Turn off for a body-only read
   *  when a heading already sits above it (e.g. the hero shows the title). */
  head?: boolean;
  showBody?: boolean;
  /** Tight contexts (the palette row): smaller title, single-line ellipsis. */
  compact?: boolean;
  /** A FactReadingFooter follows (caller-rendered) — suppress the old inline
   *  open-link so the trailer owns the actions. */
  footer?: boolean;
  /** Fence/member-grain in-place editing on the body (the peek already has
   *  it; the GROUND reading — the graph-selected fact — was missing it). */
  editable?: boolean;
  onSaved?: (entry: ListEntry) => void;
}): React.JSX.Element {
  const c = READING_TONE[tone];
  const shadow = onImage ? '0 1px 12px rgba(8,29,36,0.6)' : undefined;
  const m = e._meta;
  const meta: string[] = [];
  if (m?.type) meta.push(m.type);
  if (m?.tags?.length) meta.push(...m.tags.slice(0, 4).map((t) => '#' + t));
  if (m?.via) meta.push('via ' + m.via);
  const when = relTime(m?.updatedAt);
  if (when) meta.push(when);
  const open = factHref(e);
  const clip: React.CSSProperties = compact ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : { overflowWrap: 'anywhere' };
  return (
    <div style={{ display: 'grid', gap: compact ? '0.12rem' : '0.4rem', color: c.text, textShadow: shadow, minWidth: 0 }}>
      {head ? (
        <div style={{ display: 'flex', alignItems: 'baseline', gap: compact ? '0.4rem' : '0.55rem', minWidth: 0 }}>
          { !onImage && <span aria-hidden style={{ fontSize: compact ? '0.95rem' : '1.15rem', flexShrink: 0 }}>{typeIcon(e)}</span> }
          {/* Titles may be markdown (bold/italic/inline code/link) — render the
              inline marks, not the raw `**…**`. Plain titles are unchanged. */}
          <h2 style={{ margin: 0, fontFamily: theme.serif, fontWeight: 600, fontSize: compact ? '0.98rem' : 'clamp(1.2rem, 4.2vw, 1.7rem)', lineHeight: 1.2, color: c.text, minWidth: 0, ...clip }}><InlineMarkdown text={factTitle(e)} onFactLink={(k, frag) => openFact({ key: k }, frag)} factHref={(k) => localize(`/r/${k}`)} /></h2>
        </div>
      ) : null}
      {head && meta.length ? (
        // Over the painting the muted `dim` vanishes — use a bright cream (the
        // inherited shadow carries the legibility), on paper/ink keep the dim.
        <div style={{ fontFamily: theme.mono, fontSize: compact ? '0.64rem' : '0.72rem', color: onImage ? 'rgba(239,233,220,0.9)' : c.dim, ...clip }}>{meta.join('  ·  ')}</div>
      ) : null}
      {showBody ? <div style={{ color: c.text, fontSize: '0.9rem', lineHeight: 1.6, marginTop: head ? '0.2rem' : 0 }}><FactBody e={e} full tone={tone} initialMd={initialMd} editable={canEditInPlace(e, editable)} onSaved={onSaved} /></div> : null}
      {/* The trailer (provenance · relationships · actions) is the shared
          FactReadingFooter — rendered by the caller AFTER the body, so the reading
          reads the same wherever a fact is met. FactReading itself stays just
          head+meta+body; `footer` suppresses the old inline open-link so the two
          don't double up. */}
      {showBody && open && !footer ? <a href={localize(open)} style={{ justifySelf: 'start', marginTop: '0.15rem', color: c.accent, fontFamily: theme.mono, fontSize: '0.8rem', textDecoration: 'none' }}>open ↗</a> : null}
    </div>
  );
}

/**
 * The per-fact READING FOOTER: the consistent trailer of secondary details
 * shown below any fact body — a quiet provenance line (type · when · via · by,
 * plus a superseded flag), the neighbourhood chip row (the one exploration
 * affordance worth having everywhere), and the actions (open, and edit when
 * there's somewhere to edit). Tone-aware, so it reads pine-on-cream on the
 * trailhead and amber-on-ink over the graph. The peek's own trailer (FactDetail)
 * and this share the same primitives (Neighbourhood, actionStyle, SHEET_TONE),
 * so a fact's secondary details never drift between surfaces.
 */
export function FactReadingFooter({ e, tone = 'light', authed = false }: { e: ListEntry; tone?: Tone; authed?: boolean }): React.JSX.Element {
  const t = SHEET_TONE[tone];
  const m = e._meta;
  const open = factAction(e, 'open');
  const edit = factAction(e, 'edit');
  const prov: string[] = [];
  if (m?.type) prov.push(m.type);
  const when = relTime(m?.updatedAt);
  if (when) prov.push(when);
  if (m?.via) prov.push('via ' + m.via);
  if (m?.writer) prov.push('by ' + m.writer);
  if (m?.superseded) prov.push('superseded');
  return (
    <div style={{ display: 'grid', gap: '0.55rem', marginTop: '0.3rem', paddingTop: '0.7rem', borderTop: `1px solid ${t.line}` }}>
      {prov.length ? (
        <div style={{ color: t.dim, fontSize: '0.68rem', fontFamily: theme.mono, wordBreak: 'break-all' }}>{prov.join('  ·  ')}</div>
      ) : null}
      <Neighbourhood keyName={e.key} tone={tone} hideMembers={isAssembledContainer(e)} />
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Actions name their DESTINATION cell — "Open in @c15r/lit" — so the
            jump isn't a bare arrow into the unknown (the managing cell is part
            of the affordance, resolved from the handler's own cellRef). */}
        {open ? <a href={localize(open.href)} style={actionStyle(t)}>Open{open.cell ? ` in ${open.cell}` : ''} ↗</a> : null}
        {/* Both affordances, not either/or: the declared cell editor (the
            type's REAL editor — lit's doc surface) and the generic in-place
            edit. Hiding in-place behind the declared handler made docs and
            doc-blocks the ONLY facts you couldn't touch where you read them. */}
        {edit ? <a href={localize(edit.href)} style={actionStyle(t)}>Edit{edit.cell ? ` in ${edit.cell}` : ''} ↗</a> : null}
        {canEditInPlace(e, authed) ? <button onClick={() => editFact(e)} style={{ ...actionStyle(t), background: t.actionFill, cursor: 'pointer' }}>Edit</button> : null}
      </div>
    </div>
  );
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

/** Open the progressive detail modal for a fact (or a bare {key}; hydrated by
 *  peek). `anchor` scrolls an assembled container to the named member's
 *  section once the body renders (the member→whole deep link). */
export function openFact(e: ListEntry, anchor?: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<ListEntry & { anchor?: string }>(FACT_DETAIL_EVENT, { detail: anchor ? { ...e, anchor } : e }));
}

/** Open a fact's peek WITH THE EDITOR already up — the one-tap in-place edit
 *  from any reading surface (the old flow opened the peek, then needed a
 *  second Edit tap inside it). */
export function editFact(e: ListEntry): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<ListEntry & { edit?: boolean }>(FACT_DETAIL_EVENT, { detail: { ...e, edit: true } }));
}

/** THE edit gate, spelled once (inventory §5.4/6.2): in-place editing needs a
 *  signed-in writer and a non-system fact. Every surface — ground footer, peek
 *  actions, fence ✎, palette inline — asks this one question, so a guest never
 *  sees an affordance that can only fail at the gateway, and `_` rows are
 *  uneditable everywhere by the same rule. */
export function canEditInPlace(e: ListEntry, authed: boolean): boolean {
  return authed && !e.key.startsWith('_');
}

const shortKey = (k: string): string => (k.length > 22 ? k.slice(0, 21) + '…' : k);

/** Membership rels (mirror of the server's MEMBERSHIP_RELS) — a container
 *  viewing surface suppresses these as backlinks: the members are already ON
 *  the page as the assembled body, chip-listing them twice is noise. */
const MEMBERSHIP_RELS_UI = new Set(['inView', 'inDoc', 'onBoard', 'memberOf']);

/** A fact's one-hop neighbourhood — authored edges plus the derived backbone
 *  (instanceOf → its type, managedBy → its cell, inView → views). Grouped by
 *  relation and direction (links, then backlinks), so the row reads as
 *  structure rather than a flat chip soup. Derived edges render dashed/dim;
 *  every chip is itself a peek into that neighbour. `hideMembers` = the
 *  surface already renders the members (an assembled doc) — drop the inbound
 *  membership backlinks. */
function Neighbourhood({ keyName, tone = 'dark', hideMembers = false }: { keyName: string; tone?: Tone; hideMembers?: boolean }): React.JSX.Element {
  const t = SHEET_TONE[tone];
  const [n, setN] = useState<{ outbound: Edge[]; inbound: Edge[] } | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    mcpCall('read', 'workspace.edges', { around: keyName })
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
  if (err) return <span style={{ color: t.dim, fontSize: '0.72rem' }}>No neighbourhood.</span>;
  if (!n) return <span style={{ color: t.dim, fontSize: '0.72rem' }}>Loading neighbourhood…</span>;
  const chip = (ed: Edge, other: string, label: string): React.JSX.Element => (
    <button
      key={`${ed.from}-${ed.rel}-${ed.to}`}
      onClick={() => openFact({ key: other })}
      title={`${ed.from} ${ed.rel} ${ed.to}`}
      style={{
        fontSize: '0.66rem',
        color: ed.derived ? t.dim : t.accent,
        border: `1px ${ed.derived ? 'dashed' : 'solid'} ${t.line}`,
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
  // Group by (direction, rel): outbound first (this fact's own assertions),
  // then backlinks. The rel lives in the GROUP header, so chips carry only
  // their key — denser and scannable.
  const inbound = hideMembers ? n.inbound.filter((ed) => !MEMBERSHIP_RELS_UI.has(ed.rel)) : n.inbound;
  const groups = new Map<string, { label: string; items: Array<{ ed: Edge; other: string }> }>();
  for (const ed of n.outbound) {
    const gk = `out:${ed.rel}`;
    const g = groups.get(gk) ?? { label: `${ed.rel} →`, items: [] };
    g.items.push({ ed, other: ed.to });
    groups.set(gk, g);
  }
  for (const ed of inbound) {
    const gk = `in:${ed.rel}`;
    const g = groups.get(gk) ?? { label: `← ${ed.rel}`, items: [] };
    g.items.push({ ed, other: ed.from });
    groups.set(gk, g);
  }
  if (!groups.size) return <span style={{ color: t.dim, fontSize: '0.72rem' }}>No edges yet.</span>;
  return (
    <div style={{ display: 'grid', gap: '0.35rem' }}>
      {[...groups.entries()].map(([gk, g]) => (
        <div key={gk} style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span style={{ color: t.dim, fontSize: '0.62rem', fontFamily: theme.mono, flexShrink: 0, minWidth: '5.5em' }}>{g.label}</span>
          {g.items.map(({ ed, other }) => chip(ed, other, shortKey(other)))}
        </div>
      ))}
    </div>
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

/** A peek-sheet action (buttons/links) — accent outline, quiet fill. Tone-aware
 *  so the paper sheet's actions read pine-on-cream, the ink sheet's amber-on-ink. */
const actionStyle = (t: typeof SHEET_TONE[Tone]): React.CSSProperties => ({
  display: 'inline-block',
  padding: '0.4rem 0.9rem',
  minHeight: 38,
  boxSizing: 'border-box',
  borderRadius: 8,
  border: `1px solid ${t.accent}`,
  background: 'none',
  color: t.accent,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.8rem',
  textDecoration: 'none',
});

const inputStyle = (t: typeof SHEET_TONE[Tone]): React.CSSProperties => ({
  width: '100%',
  boxSizing: 'border-box',
  padding: '0.4rem 0.5rem',
  fontSize: '0.8rem',
  border: `1px solid ${t.line}`,
  borderRadius: 6,
  background: t.panel,
  color: t.text,
});

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
  tone = 'dark',
}: {
  e: ListEntry;
  fields?: FormField[];
  onSaved: (entry: ListEntry, hints?: string[]) => void;
  onCancel: () => void;
  tone?: Tone;
}): React.JSX.Element {
  const t = SHEET_TONE[tone];
  const isStr = typeof e.value === 'string';
  const base = e.value && typeof e.value === 'object' && !Array.isArray(e.value) ? (e.value as Record<string, unknown>) : {};
  const schema = Array.isArray(fields) && fields.length > 0 ? fieldsToFormSchema(fields) : undefined;
  const useForm = !isStr && isFormable(schema);

  const [form, setForm] = useState<Record<string, unknown>>(base);
  const [text, setText] = useState(isStr ? (e.value as string) : JSON.stringify(e.value ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // `src` overrides the React state: the editor's Mod-Enter commit hands us its
  // CURRENT document, and the onChange that precedes it may not have flushed
  // through setState yet — saving `text` there would drop the last keystrokes.
  const save = async (src?: string): Promise<void> => {
    const raw = src ?? text;
    let value: unknown;
    if (useForm) {
      value = form;
    } else if (isStr) {
      value = raw;
    } else {
      try {
        value = JSON.parse(raw);
      } catch {
        setErr('Invalid JSON');
        return;
      }
    }
    setBusy(true);
    setErr(null);
    const r = await mcpCall('act', 'workspace.remember', {
      key: e.key,
      value,
      ...(e._meta?.type ? { type: e._meta.type } : {}),
      ...(typeof e._meta?.version === 'number' ? { ifVersion: e._meta.version } : {}),
    });
    setBusy(false);
    if (!r.ok) {
      setErr(typeof r.value === 'string' ? r.value : 'Save failed');
      return;
    }
    const saved = (r.value && typeof r.value === 'object' ? r.value : {}) as { value?: unknown; _meta?: ListEntry['_meta']; hints?: string[] };
    const nextValue = Object.prototype.hasOwnProperty.call(saved, 'value') ? saved.value : value;
    const hints = saved.hints;
    onSaved({ ...e, value: nextValue, _meta: saved._meta ?? e._meta }, Array.isArray(hints) ? hints : undefined);
  };

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      {useForm ? (
        <SchemaForm
          schema={schema}
          value={form}
          onChange={setForm}
          palette={{ text: t.text, dim: t.dim, border: t.line, inputBg: t.panel, accent: t.accent, danger: t.danger }}
          // Long/markdown fields (protocol.content, prompt bodies…) get the
          // shared editor instead of the 3-row textarea floor — same `[[`
          // completion and Mod-Enter save as the whole-fact editor below.
          longText={({ value: v, onChange: set }) => (
            <CodeEditor value={v} lang="markdown" minRows={5} onChange={(next) => set(next)} onSave={() => void save()} palette={{ text: t.text, dim: t.dim, border: 'transparent', inputBg: 'transparent' }} />
          )}
        />
      ) : (
        <>
          {/* The shared CodeMirror 6 editor (`@c15r/editor`), lazily imported —
              a string value edits as markdown (so `[[` completes facts and the
              prose reads like prose), a structured value as JSON. Degrades to
              a textarea if the module can't load. */}
          <CodeEditor
            value={text}
            lang={isStr ? 'markdown' : 'json'}
            wikiComplete={isStr}
            autofocus
            placeholder={isStr ? 'markdown…' : 'JSON value…'}
            minRows={Math.min(18, Math.max(4, text.split('\n').length + 1))}
            onChange={setText}
            onSave={(v) => { setText(v); void save(v); }}
            onCancel={onCancel}
            palette={{ text: t.text, dim: t.dim, border: t.line, inputBg: t.panel }}
          />
          {!isStr ? <span style={{ color: t.dim, fontSize: '0.68rem' }}>No schema — editing the raw JSON value.</span> : null}
        </>
      )}
      {err ? <span style={{ color: t.danger, fontSize: '0.78rem', fontFamily: theme.mono }}>{err}</span> : null}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button onClick={() => void save()} disabled={busy} style={{ ...actionStyle(t), background: t.actionFill, cursor: busy ? 'wait' : 'pointer' }}>{busy ? 'Saving…' : 'Save'}</button>
        <button onClick={onCancel} style={{ background: 'none', border: `1px solid ${t.line}`, borderRadius: 8, color: t.dim, padding: '0.4rem 0.9rem', cursor: 'pointer', fontFamily: theme.mono, fontSize: '0.8rem' }}>Cancel</button>
      </div>
    </div>
  );
}

/** The generic in-place editor, usable OUTSIDE this module (the context
 *  panel's Edit action) — resolves the type's declared fields (ADR-0002
 *  shape.fields) exactly as FactDetail does. */
export function InlineFactEditor({ e, onCancel, onSaved, tone = 'dark' }: { e: ListEntry; onCancel: () => void; onSaved: (entry: ListEntry) => void; tone?: Tone }): React.JSX.Element {
  const fields = (declFor(e, typeDecls) as { fields?: FormField[] } | undefined)?.fields;
  return <FactEditor e={e} fields={fields} onCancel={onCancel} onSaved={(entry) => onSaved(entry)} tone={tone} />;
}

/** The peek body: the fact rendered by its viewer (full, not clamped), its
 *  provenance line, its neighbourhood, and the actions — escalate to the type's
 *  page/editor when declared, else edit generically in place. */
export function FactDetail({ e, compact, tone = 'dark', anchor, startEditing = false, authed = false }: { e: ListEntry; compact?: boolean; tone?: Tone; anchor?: string; /** Open with the editor already up (the one-tap edit path — see `editFact`). */ startEditing?: boolean; /** The one edit gate (canEditInPlace) needs the session — plumbed from App. */ authed?: boolean }): React.JSX.Element {
  const t = SHEET_TONE[tone];
  const [entry, setEntry] = useState<ListEntry>(e);
  const [editing, setEditing] = useState(startEditing && e.value !== undefined);
  const [hints, setHints] = useState<string[] | null>(null);
  useEffect(() => {
    setEntry(e);
    // The edit intent waits for a hydrated value — editing a bare {key} frame
    // before its peek returns would open the editor on emptiness.
    setEditing(startEditing && e.value !== undefined);
    setHints(null);
  }, [e, startEditing]);
  const open = factHref(entry);
  const edit = factEdit(entry);
  const meta = entry._meta;
  // The type's declared fields (ADR-0002 shape.fields), additively on $types.
  const fields = (declFor(entry, typeDecls) as { fields?: FormField[] } | undefined)?.fields;
  return (
    <div style={{ display: 'grid', gap: '0.7rem' }}>
      <div style={{ color: t.dim, fontSize: '0.68rem', fontFamily: theme.mono, wordBreak: 'break-all' }}>
        {[meta?.type, entry.key].filter(Boolean).join(' · ')}
        {meta?.tags?.length ? '  ·  ' + meta.tags.map((tag) => '#' + tag).join(' ') : ''}
      </div>
      {editing ? (
        <FactEditor
          e={entry}
          fields={fields}
          tone={tone}
          onCancel={() => setEditing(false)}
          onSaved={(savedEntry, h) => {
            setEntry(savedEntry);
            setHints(h ?? null);
            setEditing(false);
          }}
        />
      ) : (
        <>
          <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
            <FactBody e={entry} full tone={tone} anchor={anchor} editable={canEditInPlace(entry, authed)} onSaved={setEntry} />
          </div>
          {hints?.length ? (
            <div style={{ display: 'grid', gap: '0.2rem', border: `1px solid ${t.line}`, borderRadius: 8, padding: '0.5rem 0.6rem', background: t.panel }}>
              <span style={{ color: t.dim, fontSize: '0.68rem', fontFamily: theme.mono }}>suggestions</span>
              {hints.map((h, i) => (
                <span key={i} style={{ fontSize: '0.76rem', color: t.text }}>· {h}</span>
              ))}
            </div>
          ) : null}
          {!compact ? (
            <div style={{ display: 'grid', gap: '0.3rem' }}>
              <span style={{ color: t.dim, fontSize: '0.68rem', fontFamily: theme.mono }}>neighbourhood</span>
              <Neighbourhood keyName={entry.key} tone={tone} hideMembers={isAssembledContainer(entry)} />
            </div>
          ) : null}
          {!compact ? (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {open ? <a href={localize(open)} style={actionStyle(t)}>Open ↗</a> : null}
              {/* Both, not either/or — see FactReadingFooter. */}
              {edit ? <a href={localize(edit)} style={actionStyle(t)}>Edit in cell ↗</a> : null}
              {canEditInPlace(entry, authed) ? (
                <button onClick={() => setEditing(true)} style={{ ...actionStyle(t), background: t.actionFill, cursor: 'pointer' }}>Edit</button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Mounted once at the app root: listens for `openFact`, hydrates a bare {key}
 *  via peek, and renders the modal. Returns null when nothing is open. */
export function FactDetailHost({ tone = 'dark', authed = false, onCurrent, onOpenChange, onRevealGround }: { tone?: Tone; authed?: boolean; onCurrent?: (key: string | null) => void; /** Fires when the stack opens/closes — the app minimizes the palette under it. */ onOpenChange?: (open: boolean) => void; /** Fires while the 1/1 sheet is being dragged toward ground — the Landing restores the REAL ground content behind it for the reveal. */ onRevealGround?: (revealing: boolean) => void } = {}): React.JSX.Element | null {
  const t = SHEET_TONE[tone];
  // A drill HISTORY with a cursor — not a plain stack. openFact pushes at the
  // cursor (truncating any forward history); back moves the cursor DOWN and the
  // current sheet slides into a "forward pile" peeking at the BOTTOM edge;
  // forward (drag/tap the pile up) moves the cursor back UP. So back is
  // non-destructive: what you stepped out of waits at the bottom to be pulled
  // back in. × / scrim dismiss the whole thing.
  // Each frame remembers the PAGE SCROLL it was read at (`scrollY`) — the
  // docked landing stack reads by MAIN page scroll, so back/forward restore
  // where you were in the frame you return to (owner: "remembered scrolls on
  // pop"). The dark (graph) stack scrolls internally and ignores these.
  const [hist, setHist] = useState<{ frames: Array<{ id: number; entry: ListEntry; anchor?: string; edit?: boolean; scrollY?: number }>; cursor: number }>({ frames: [], cursor: -1 });
  const nextId = React.useRef(1);
  const { frames, cursor } = hist;
  const current = cursor >= 0 ? frames[cursor] : null;
  const closeAll = (): void => setHist({ frames: [], cursor: -1 });
  const saveScroll = (fr: Array<{ id: number; entry: ListEntry; anchor?: string; edit?: boolean; scrollY?: number }>, i: number): typeof fr => {
    if (i < 0 || typeof window === 'undefined') return fr;
    const next = fr.slice();
    next[i] = { ...next[i], scrollY: window.scrollY };
    return next;
  };
  const back = (): void => setHist((h) => (h.cursor > 0 ? { frames: saveScroll(h.frames, h.cursor), cursor: h.cursor - 1 } : h));
  const forward = (): void => setHist((h) => (h.cursor < h.frames.length - 1 ? { frames: saveScroll(h.frames, h.cursor), cursor: h.cursor + 1 } : h));
  const [sheetH, setSheetH] = useState<number | undefined>(undefined);
  const roRef = React.useRef<ResizeObserver | null>(null);
  const [dragY, setDragY] = useState(0);   // front sheet drag-down (→ back)
  const [pileY, setPileY] = useState(0);   // forward-pile drag-up  (→ forward)
  // Selection sync (owner direction): the current fact IS the selection, so the
  // graph re-orients to it behind the sheet. Push on every current-key change;
  // never on close (closing leaves the graph on the last fact you read).
  const onCurRef = React.useRef(onCurrent);
  onCurRef.current = onCurrent;
  const curKey = current?.entry.key ?? null;
  useEffect(() => { if (curKey) onCurRef.current?.(curKey); }, [curKey]);
  const isOpen = frames.length > 0;
  const onOpenRef = React.useRef(onOpenChange);
  onOpenRef.current = onOpenChange;
  useEffect(() => { onOpenRef.current?.(isOpen); }, [isOpen]);
  // 1/1 drag-toward-ground: tell the Landing to restore the REAL ground content
  // behind the dragged sheet — the reveal shows what commit actually returns to.
  const groundReveal = tone === 'light' && isOpen && cursor === 0 && dragY > 0;
  const onRevealRef = React.useRef(onRevealGround);
  onRevealRef.current = onRevealGround;
  useEffect(() => { onRevealRef.current?.(groundReveal); }, [groundReveal]);
  // THE DOCKED COMPOSITION (owner, landing): opening a peek INSTANTLY scrolls
  // the page to the top so the canonical stack composition always holds — hero
  // + live graph above, the ground sheet's lip, the peek docked just below it.
  // The scroll position is REMEMBERED and instantly restored on close, so you
  // land back exactly where you were reading — UNLESS you scrolled the ground
  // while the peek was up (the background stays live now), in which case your
  // new place wins and no restore happens. Both jumps are instant: the sheet
  // rising/leaving masks them; a smooth scroll would be a visible double-move.
  const isLight = tone === 'light';
  const prevScroll = React.useRef<number | null>(null);
  useEffect(() => {
    if (!isLight || typeof window === 'undefined') return;
    if (isOpen && prevScroll.current == null) {
      prevScroll.current = window.scrollY;
      window.scrollTo(0, 0);
    } else if (!isOpen && prevScroll.current != null) {
      if (window.scrollY <= 4) window.scrollTo(0, prevScroll.current); // skip if the reader moved mid-peek
      prevScroll.current = null;
    }
  }, [isOpen, isLight]);
  // Frame changes (push/back/forward) in the DOCKED stack: the page scroll is
  // the reading position, so arriving at a frame restores where you were in it
  // (a fresh push starts at the top — hero + lip + sheet head in view).
  const curId = current?.id ?? null;
  const curScrollRef = React.useRef<number | undefined>(undefined);
  curScrollRef.current = current?.scrollY;
  useEffect(() => {
    if (!isLight || curId == null || typeof window === 'undefined') return;
    window.scrollTo(0, curScrollRef.current ?? 0);
  }, [curId, isLight]);

  // Drag the front header DOWN → back(); a forward-pile lip UP (or a tap) →
  // forward(). Both follow the finger and commit past ~80px.
  // Live refs the once-created drag closures read: the cursor (to fork the
  // commit — back() vs close-to-ground) and the front sheet's screen top at
  // grab time (the 1/1 ground-reveal pins the sheet FIXED there so restoring
  // the real ground content behind can't shove it down the document).
  const cursorRef = React.useRef(cursor); cursorRef.current = cursor;
  const sheetTopRef = React.useRef(0);
  const dragBack = React.useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    sheetTopRef.current = (e.currentTarget as HTMLElement).closest('section')?.getBoundingClientRect().top ?? 0;
    const startY = e.clientY; let dy = 0;
    const move = (me: PointerEvent): void => { dy = Math.max(0, me.clientY - startY); setDragY(dy); };
    const up = (): void => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setDragY(0);
      // Past the commit: pop a frame — or, at 1/1, COMMIT BACK TO GROUND
      // (owner: the first sheet's drag-down closes the stack; it used to no-op).
      if (dy > 80) { if (cursorRef.current > 0) back(); else closeAll(); }
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }, []);
  const dragForward = React.useCallback((e: React.PointerEvent) => {
    const startY = e.clientY; let dy = 0; let moved = false;
    const move = (me: PointerEvent): void => { dy = me.clientY - startY; if (Math.abs(dy) > 4) moved = true; setPileY(Math.min(0, dy)); };
    const up = (): void => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setPileY(0); if (dy < -80 || !moved) forward(); // dragged up enough, or a tap
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  }, []);
  const topRef = React.useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el || typeof ResizeObserver === 'undefined') { if (el) setSheetH(el.offsetHeight); return; }
    const ro = new ResizeObserver(() => setSheetH(el.offsetHeight));
    ro.observe(el); roRef.current = ro; setSheetH(el.offsetHeight);
  }, []);
  useEffect(() => {
    const onOpen = (ev: Event): void => {
      const detail = (ev as CustomEvent<ListEntry & { anchor?: string; edit?: boolean }>).detail;
      if (!detail?.key) return;
      const { anchor, edit, ...rest } = detail;
      const entry = rest as ListEntry;
      setHist((h) => {
        // Re-opening the fact you're already on is a no-op — unless it arrives
        // with the edit intent (the footer's one-tap Edit on the open fact).
        if (h.cursor >= 0 && h.frames[h.cursor].entry.key === entry.key) {
          if (!edit || h.frames[h.cursor].edit) return h;
          const next = h.frames.slice();
          next[h.cursor] = { ...next[h.cursor], edit: true };
          return { ...h, frames: next };
        }
        // A new path truncates any forward history (browser-nav semantics).
        // The departing frame remembers its page scroll (docked-stack pop).
        const kept = saveScroll(h.frames.slice(0, h.cursor + 1), h.cursor);
        return { frames: [...kept, { id: nextId.current++, entry, anchor, edit }], cursor: kept.length };
      });
      if (detail.value === undefined) {
        const requestedKey = detail.key;
        mcpCall('read', 'workspace.peek', { key: requestedKey })
          .then((r) => {
            const f = r.value as { value?: unknown; _meta?: ListEntry['_meta'] } | null;
            if (!r.ok || !f) return;
            setHist((h) => {
              const i = h.frames.findIndex((fr) => fr.entry.key === requestedKey && fr.entry.value === undefined);
              if (i < 0) return h;
              const next = h.frames.slice();
              next[i] = { ...next[i], entry: { key: requestedKey, value: f.value, _meta: f._meta } };
              return { ...h, frames: next };
            });
          })
          .catch(() => undefined);
      }
    };
    window.addEventListener(FACT_DETAIL_EVENT, onOpen as EventListener);
    return () => window.removeEventListener(FACT_DETAIL_EVENT, onOpen as EventListener);
  }, []);
  useEffect(() => {
    if (cursor < 0) return;
    const onKey = (ev: KeyboardEvent): void => { if (ev.key === 'Escape') { if (cursor > 0) back(); else closeAll(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursor]);
  if (cursor < 0) return null;
  const LIP = 7;        // px each back-stack sheet's top edge peeks above the front
  const MAX_LIPS = 3;   // capped so a deep stack stays tidy (all still mounted)
  const PEEK = 30;      // px of a forward-pile sheet's top that shows at the bottom
  const total = frames.length;

  // ── LANDING (light): the DOCKED IN-FLOW stack ─────────────────────────────
  // The sheet is DOCUMENT CONTENT, not a fixed box (owner): it renders into the
  // Landing's #peek-dock slot just below the ground sheet's tip-lip, its content
  // flows (no maxHeight, no inner scrollbox), and the PAGE's scroll height
  // becomes the frame's content — reading is always a main page scroll, exactly
  // like the ground content it replaces. Back-stack lips stack above the sheet
  // in flow; the forward pile stays pinned to the viewport bottom. Per-frame
  // scroll memory (see saveScroll) restores your place on back/forward/close.
  if (isLight) {
    const dock = typeof document !== 'undefined' ? document.getElementById('peek-dock') : null;
    if (!dock || !current) return null;
    const backCount = Math.min(cursor, MAX_LIPS);
    const pileCount = frames.length - 1 - cursor;
    const pileLips = Math.min(Math.max(pileCount - 1, 0), MAX_LIPS);
    const pileGrow = Math.max(0, -pileY);
    const stripH = PEEK + 10; // the pile strip's rest height
    const prevFrame = cursor > 0 ? frames[cursor - 1] : null;
    // EVERY frame keeps ONE stable <section> shell whose STYLE changes by role
    // (current / pile-front / hidden) — same element type, same child shape —
    // so React never remounts a frame's content across back/forward flips
    // (owner: "it should already be present in the DOM", no reload).
    return createPortal(
      <div style={{ position: 'relative' }}>
        {/* Back-stack lips — FULL-width vertical peeks (owner IMG_0386: the old
            inset lips doubled the corner radii against the full-width sheet;
            same-width layers nest their corners cleanly, like the ground tip). */}
        {Array.from({ length: backCount }).map((_, k) => (
          <div key={k} aria-hidden style={{ height: 9, margin: '0 0 -1px', borderTopLeftRadius: 14, borderTopRightRadius: 14, border: `1px solid ${t.line}`, borderBottom: 'none', background: t.bg }} />
        ))}
        {/* Drag-back REVEAL (owner IMG_0387/0395): pulling the header down
            uncovers what you're returning TO — a FULL sheet reaching the bottom
            of the viewport (the previous frame's head, or the bare ground cream
            at 1/1), never a floating strip over the night backdrop. */}
        {dragY > 0 && !groundReveal ? (
          <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, top: backCount * 8, height: '100dvh', zIndex: 0, borderTopLeftRadius: 14, borderTopRightRadius: 14, border: `1px solid ${t.line}`, borderBottom: 'none', background: t.bg, color: t.text, overflow: 'hidden', padding: '0.9rem' }}>
            {prevFrame ? (
              <strong style={{ fontFamily: theme.serif, fontSize: '1.02rem', opacity: 0.7 }}>{`${typeIcon(prevFrame.entry) ? typeIcon(prevFrame.entry) + ' ' : ''}${factTitle(prevFrame.entry)}`}</strong>
            ) : null}
          </div>
        ) : null}
        {frames.map((frame, i) => {
          const rel = i - cursor;
          const isCur = rel === 0;
          const isPileF = rel === 1;
          const fEntry = frame.entry;
          const fTitle = `${typeIcon(fEntry) ? typeIcon(fEntry) + ' ' : ''}${factTitle(fEntry)}`;
          const sectionStyle: React.CSSProperties = isCur
            ? groundReveal
              ? {
                  // 1/1 drag-toward-ground: the sheet PINS to its grab-time screen
                  // position (fixed) while the Landing restores the real ground
                  // content in the document behind it — the drag then slides the
                  // sheet down over the very content a commit returns to.
                  position: 'fixed', top: sheetTopRef.current, left: 0, right: 0, margin: '0 auto',
                  width: 'min(780px, 100vw)', maxHeight: '100dvh', overflow: 'hidden',
                  zIndex: 30, background: t.bg, color: t.text,
                  borderTopLeftRadius: 14, borderTopRightRadius: 14, borderTop: `1px solid ${t.line}`,
                  boxShadow: t.shadow,
                  transform: `translateY(${dragY}px)`, transition: 'none',
                }
              : {
                position: 'relative', zIndex: 1, background: t.bg, color: t.text,
                borderTopLeftRadius: 14, borderTopRightRadius: 14, borderTop: `1px solid ${t.line}`,
                boxShadow: t.shadow, minHeight: '60dvh',
                transform: dragY ? `translateY(${dragY}px)` : undefined,
                transition: dragY ? 'none' : 'transform 0.2s ease',
                paddingBottom: pileCount > 0 ? `${stripH + pileLips * 7 + 20}px` : undefined,
              }
            : isPileF
              ? {
                  // The forward pile GROWS with the drag (owner: not a bar sliding
                  // over the wrong text) — its own sheet, its own content, rising
                  // until the release commits the advance. It sits ON TOP of the
                  // pile (owner IMG_0395: "dragging up next, not last") — the
                  // deeper lips peek BELOW it toward the viewport edge, so the
                  // rising sheet clearly comes off the top of the waiting stack.
                  position: 'fixed', bottom: pileLips * 7, left: 0, right: 0, margin: '0 auto',
                  width: 'min(780px, 100vw)', height: stripH + pileGrow, maxHeight: '75dvh',
                  overflow: 'hidden', zIndex: 40, background: t.bg, color: t.text,
                  borderTopLeftRadius: 14, borderTopRightRadius: 14, borderTop: `1px solid ${t.line}`,
                  boxShadow: t.shadow, transition: pileY ? 'none' : 'height 0.2s ease',
                  cursor: 'pointer', userSelect: 'none', pointerEvents: 'auto',
                }
              : { display: 'none' };
          return (
            <section key={frame.id} aria-hidden={!isCur} style={sectionStyle}>
              <div
                onPointerDown={isCur ? dragBack : isPileF ? dragForward : undefined}
                style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, padding: isCur ? '0.9rem 0.9rem 0.6rem' : '0.55rem 0.9rem 0.45rem', borderBottom: isCur ? `1px solid ${t.line}` : undefined, touchAction: isCur || isPileF ? 'none' : undefined, userSelect: 'none', cursor: isCur ? 'grab' : isPileF ? 'pointer' : 'default' }}
              >
                {isCur ? <span aria-hidden style={{ position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)', width: 30, height: 3, borderRadius: 3, background: t.line }} /> : null}
                {isCur && cursor > 0 ? (
                  <button onClick={() => back()} aria-label="back" title="Back" style={{ background: 'none', border: 'none', color: t.accent, cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '0.2rem 0.35rem', flexShrink: 0 }}>‹</button>
                ) : null}
                {isPileF ? <span aria-hidden style={{ color: t.accent, fontSize: '0.9rem', flexShrink: 0 }}>⌃</span> : null}
                <strong style={{ fontFamily: theme.serif, fontSize: isCur ? '1.02rem' : '0.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{fTitle}</strong>
                {isCur && total > 1 ? <span style={{ color: t.dim, fontSize: '0.62rem', fontFamily: theme.mono, flexShrink: 0 }}>{cursor + 1}/{total}</span> : null}
                {isCur ? (
                  <button onClick={() => closeAll()} aria-label="close" style={{ background: 'none', border: 'none', color: t.dim, cursor: 'pointer', fontSize: '1.1rem', padding: '0.2rem 0.4rem', flexShrink: 0 }}>×</button>
                ) : null}
              </div>
              <div style={{ padding: isCur ? '0.7rem 0.9rem calc(1.6rem + env(safe-area-inset-bottom))' : '0.45rem 0.9rem 0.9rem' }}>
                <FactDetail e={fEntry} tone={tone} anchor={frame.anchor} startEditing={frame.edit} authed={authed} />
              </div>
            </section>
          );
        })}
        {/* Pile TIP-STACKS (owner IMG_0395): the deeper waiting sheets peek
            BELOW the strip toward the viewport edge — slightly inset (behind),
            flush against it (no slits of page text between the layers) — so
            the full-width strip on top clearly reads as "next". */}
        {pileCount > 0 ? Array.from({ length: pileLips }).map((_, k) => {
          const j = k + 1; // 1 = just under the strip, deeper follow
          return (
            <div key={k} aria-hidden style={{ position: 'fixed', bottom: (pileLips - j) * 7, left: 0, right: 0, margin: '0 auto', width: `min(${780 - j * 22}px, calc(100vw - ${j * 22}px))`, height: 9, borderTopLeftRadius: 14, borderTopRightRadius: 14, border: `1px solid ${t.line}`, borderBottom: 'none', background: t.bg, zIndex: 39, pointerEvents: 'none' }} />
          );
        }) : null}
      </div>,
      dock,
    );
  }

  // ── GRAPH (dark): the fixed floating stack above the minimized palette ────
  // Internal scroll stays here — there is no document to flow into over the
  // fixed canvas; the stack floats above the palette strip (SHEET_BOTTOM).
  const SHEET_MAX = '60dvh';
  const SHEET_BOTTOM = 132;
  const hFallback = typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.58) : 480;
  return (
    // NOT a modal (owner: "same mechanics, more cohesive, not so modal" — both
    // tones): no dialog role, no full-viewport click-catcher, no outside-tap
    // dismiss, no global gesture capture. The wrapper is inert (pointer-events
    // none); only the SHEETS take input, so the world behind — the landing's
    // scroll, the graph's spin — stays fully live while a peek is up. × / drag
    // own dismissal; Esc still steps back/closes.
    <div
      role="complementary"
      style={{ position: 'fixed', inset: 0, background: 'transparent', zIndex: 1000, pointerEvents: 'none' }}
    >
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', pointerEvents: 'none' }}>
        {frames.map((frame, i) => {
          const rel = i - cursor; // 0 = front, <0 = back-stack (top lips), >0 = forward pile (bottom)
          const isFront = rel === 0;
          const isPileFront = rel === 1; // the re-advanceable one
          const fEntry = frame.entry;
          const fTitle = `${typeIcon(fEntry) ? typeIcon(fEntry) + ' ' : ''}${factTitle(fEntry)}`;
          const h = sheetH ?? hFallback;
          let translateY: number; let zIndex: number; let interactive: boolean;
          if (rel === 0) { translateY = dragY; zIndex = 500; interactive = true; }
          else if (rel < 0) { translateY = -Math.min(-rel, MAX_LIPS) * LIP; zIndex = 100 + i; interactive = false; }
          else { translateY = (h - PEEK) + Math.min(rel - 1, MAX_LIPS) * LIP + (isPileFront ? pileY : 0); zIndex = 1000 + i; interactive = isPileFront; }
          const dragging = (isFront && dragY > 0) || (isPileFront && pileY < 0);
          return (
            <div
              key={frame.id}
              ref={isFront ? topRef : undefined}
              // The SHEET owns its gestures (the wrapper no longer captures the
              // whole viewport): stop wheel/touch bubbling to the window
              // listeners the landing (enter-the-sky) and the graph (zoom/curl)
              // run, so scrolling to read never moves the world behind it —
              // while everywhere OUTSIDE the sheet stays live.
              onWheelCapture={(ev) => ev.stopPropagation()}
              onTouchStartCapture={(ev) => ev.stopPropagation()}
              onTouchMoveCapture={(ev) => ev.stopPropagation()}
              aria-hidden={!isFront}
              style={{
                position: 'absolute',
                bottom: SHEET_BOTTOM,
                // CONTINUATION of the ground (owner): on the landing the sheet
                // matches the content column's width and cream, wears only a
                // hairline lip + a soft rise — a layer OF the content sheet, not
                // a bordered card floating over it. Dark keeps its inked edge.
                width: tone === 'light' ? 'min(780px, 100vw)' : 'min(720px, 100vw)',
                ...(isFront ? { maxHeight: SHEET_MAX } : { height: sheetH ? `${sheetH}px` : `${hFallback}px`, maxHeight: SHEET_MAX }),
                transform: `translateY(${translateY}px)`,
                transition: dragging ? 'none' : 'transform 0.2s ease',
                zIndex,
                pointerEvents: interactive ? 'auto' : 'none',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                borderTopLeftRadius: 14,
                borderTopRightRadius: 14,
                ...(tone === 'light'
                  ? { border: 'none', borderTop: `1px solid ${t.line}` }
                  : { border: `1px solid ${t.line}`, borderBottom: 'none' }),
                background: t.bg,
                color: t.text,
                boxShadow: t.shadow,
              }}
            >
              <div
                onPointerDown={isFront ? dragBack : isPileFront ? dragForward : undefined}
                title={isPileFront ? 'Forward' : undefined}
                style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0, flexShrink: 0, padding: '0.9rem 0.9rem 0.6rem', borderBottom: `1px solid ${t.line}`, touchAction: interactive ? 'none' : undefined, userSelect: 'none', cursor: isFront ? 'grab' : isPileFront ? 'pointer' : 'default' }}
              >
                {/* Grab handle — front: drag down to go back; pile: drag/tap up to go forward. */}
                {interactive ? <span aria-hidden style={{ position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)', width: 30, height: 3, borderRadius: 3, background: t.line }} /> : null}
                {isFront && cursor > 0 ? (
                  <button onClick={() => back()} aria-label="back" title="Back" style={{ background: 'none', border: 'none', color: t.accent, cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '0.2rem 0.35rem', flexShrink: 0 }}>‹</button>
                ) : null}
                {isPileFront ? <span aria-hidden style={{ color: t.accent, fontSize: '0.9rem', flexShrink: 0 }}>⌃</span> : null}
                <strong style={{ fontFamily: theme.serif, fontSize: '1.02rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{fTitle}</strong>
                {isFront && total > 1 ? <span style={{ color: t.dim, fontSize: '0.62rem', fontFamily: theme.mono, flexShrink: 0 }}>{cursor + 1}/{total}</span> : null}
                {isFront ? (
                  <button onClick={() => closeAll()} aria-label="close" style={{ background: 'none', border: 'none', color: t.dim, cursor: 'pointer', fontSize: '1.1rem', padding: '0.2rem 0.4rem', flexShrink: 0 }}>×</button>
                ) : null}
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: `0.7rem 0.9rem calc(0.9rem + env(safe-area-inset-bottom)${isFront && cursor < total - 1 ? ` + ${PEEK}px` : ''})` }}>
                <FactDetail e={fEntry} tone={tone} anchor={frame.anchor} startEditing={frame.edit} authed={authed} />
              </div>
            </div>
          );
        })}
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
    void mcpCall('read', 'workspace.edges', { derived: false, keys: facts.map((f) => f.key) }).then((r) => {
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

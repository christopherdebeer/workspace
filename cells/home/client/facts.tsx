/**
 * ADR-0044 Inc 5: the workspace window and the fact surface, split from app.tsx
 * (moved verbatim) — the type vocabulary (typeDecls cache + accessors), fact
 * presentation (titles/hrefs/FactBody/HintBody/FactEmbed), the progressive
 * fact detail (peek modal, generic editor), and the workspace window itself.
 */
import * as React from 'react';
import { Card, Heading, Badge, Button, Anchor, CodeBlock, theme, resolve, declFor, iconOf, titleOf, type TypeDecl, type AssembleSpec, SchemaForm, isFormable, type FormFieldSchema } from '@parc/ui';
import { ink } from './ink';
import { SafeMarkdown, safeFrameUrl, safeImageUrl, safeNavigationUrl } from './safe-markdown';
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
/** The markdown/text body of a fact value (string, or its content-ish field). */
function bodyText(v: unknown): string {
  if (typeof v === 'string') return v;
  return strField(v, ['content', 'body', 'text', 'description', 'note', 'md', 'markdown']) ?? '';
}

/** Render a fact body by a built-in `hint` kind. SSR-safe: deterministic, no
 *  browser globals. Returns null when there's nothing to draw (caller falls back). */
function HintBody({ kind, e, tone = 'dark' }: { kind: string; e: ListEntry; tone?: 'light' | 'dark' }): React.JSX.Element | null {
  const v = e.value;
  switch (kind) {
    case 'md':
    case 'markdown': {
      const md = bodyText(v);
      if (!md) return null;
      // Fact links ([[wiki]]s) in any markdown body open in place, with an
      // origin-aware href for new-tab (`/r/` exists only at the apex).
      return <SafeMarkdown text={md.replace(/\r\n/g, '\n')} onFactLink={(k) => openFact({ key: k })} factHref={(k) => localize(`/r/${k}`)} tone={tone} />;
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

// ─── the shared PURE VIEWERS (@c15r/viewers) ───────────────────────
// json tree / csv table / mermaid / style — one validated implementation, the
// same module canvas re-exports and lit's fences import. Home consumes it the
// same way (dynamic import of the cell's ESM face), rather than re-hand-rolling
// a JSON dump — so a structured/undeclared fact reads as a real tree, not a
// raw stringify. Lazy + cached: the ~18KB module loads only when a viewer is
// actually needed (never on the SSR path — this mounts in an effect).
const VIEWERS_URL = 'https://parc.land/@c15r/viewers/app.js';
type ViewersModule = { renderFence: (host: HTMLElement, lang: string, code: string) => boolean };
let viewersMod: Promise<ViewersModule> | null = null;
const loadViewers = (): Promise<ViewersModule> =>
  (viewersMod ??= import(/* @vite-ignore */ VIEWERS_URL) as Promise<ViewersModule>);

/** Mount a pure viewer (json/csv/mermaid/style) for a string body, via the
 *  shared @c15r/viewers module. Imperative host (like the graph): React owns
 *  the wrapper, the viewer owns the inner DOM. Degrades to a <pre> if the
 *  module can't load (offline) so content is never lost. */
function ViewerBody({ lang, code }: { lang: string; code: string }): React.JSX.Element {
  const host = React.useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let live = true;
    loadViewers()
      .then((v) => { if (live && el) v.renderFence(el, lang, code); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; if (el) el.innerHTML = ''; };
  }, [lang, code]);
  if (failed) return <pre style={{ maxWidth: '100%', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.8rem' }}>{code}</pre>;
  return <div ref={host} style={{ maxWidth: '100%', overflow: 'auto' }} />;
}

/**
 * A WHOLE doc, assembled from its blocks. A `doc` fact holds only {title,summary}
 * and a `doc-block` is one slice — so for either we read the doc's membership the
 * same substrate-native way lit's own reader (loadDoc) does: one
 * `workspace.edges({around, membership})` returns every member block with its
 * content + placement.seq, already in narrative order. Sort by seq, concatenate,
 * render one markdown body. No lit code, no iframe — the substrate does the join.
 * Fails soft: a bad/empty read falls back to the fact's own body or summary.
 */
export function DocBody({ e, initialMd, spec, tone = 'dark' }: { e: ListEntry; initialMd?: string; spec?: AssembleSpec; tone?: 'light' | 'dark' }): React.JSX.Element {
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
  const [state, setState] = useState<'loading' | 'ready' | 'fail'>(initialMd ? 'ready' : 'loading');
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
    void mcpCall('read', 'workspace.edges', { around: docKey, membership: true })
      .then(async (r) => {
        if (!live) return;
        const members = (r.ok ? (r.value as { members?: Array<{ value?: unknown; placement?: { seq?: number } }> } | null)?.members : null) ?? [];
        let text = members
          .map((m) => ({ seq: Number(m.placement?.seq ?? 0), content: memberText(m.value) }))
          .sort((a, b) => a.seq - b.seq)
          .map((m) => m.content)
          .filter(Boolean)
          .join('\n\n');
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
  const onFactLink = (k: string): void => openFact({ key: k });
  // Origin-aware fact hrefs: `/r/<key>` exists only at the apex, so localize
  // (→ apex-absolute) keeps new-tab/middle-click navigable when home is
  // served from its own cell subdomain.
  const factHref = (k: string): string => localize(`/r/${k}`);
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
export function FactBody({ e, embed = false, full = false, tone = 'dark', initialMd }: { e: ListEntry; embed?: boolean; full?: boolean; tone?: 'light' | 'dark'; initialMd?: string }): React.JSX.Element | null {
  // A composite fact reads as its WHOLE assembled body when fully open — the
  // substrate joins membership+order; we just concatenate (see DocBody).
  // WHICH types assemble is DECLARED (ADR-0093 `assemble` intent), so any
  // cell's composite type gets this without home changes; the hardcoded
  // `doc`/`doc-block` check is only the compiled floor for a vocabulary that
  // hasn't declared yet (Inc 2 retires it).
  const t = e._meta?.type;
  if (full) {
    const asm = resolve(e, 'assemble', typeDecls)?.assemble;
    if (asm || t === 'doc' || t === 'doc-block') return <DocBody e={e} spec={asm} tone={tone} initialMd={initialMd} />;
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
    const el = HintBody({ kind: hint, e, tone });
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
      return <SafeMarkdown text={body.replace(/\r\n/g, '\n')} onFactLink={(k) => openFact({ key: k })} factHref={(k) => localize(`/r/${k}`)} tone={tone} />;
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
  light: { bg: theme.panel, panel: '#fffef9', line: theme.border, text: theme.text, dim: theme.dim, accent: theme.accent, danger: theme.danger, actionFill: 'rgba(46,94,67,0.08)', scrim: 'rgba(8,29,36,0.32)', shadow: '0 -12px 40px rgba(8,29,36,0.3)' },
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
export function FactReading({ e, tone = 'light', onImage = false, head = true, showBody = false, compact = false, initialMd, footer = false }: {
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
          <h2 style={{ margin: 0, fontFamily: theme.serif, fontWeight: 600, fontSize: compact ? '0.98rem' : 'clamp(1.2rem, 4.2vw, 1.7rem)', lineHeight: 1.2, color: c.text, minWidth: 0, ...clip }}>{factTitle(e)}</h2>
        </div>
      ) : null}
      {head && meta.length ? (
        // Over the painting the muted `dim` vanishes — use a bright cream (the
        // inherited shadow carries the legibility), on paper/ink keep the dim.
        <div style={{ fontFamily: theme.mono, fontSize: compact ? '0.64rem' : '0.72rem', color: onImage ? 'rgba(239,233,220,0.9)' : c.dim, ...clip }}>{meta.join('  ·  ')}</div>
      ) : null}
      {showBody ? <div style={{ color: c.text, fontSize: '0.9rem', lineHeight: 1.6, marginTop: head ? '0.2rem' : 0 }}><FactBody e={e} full tone={tone} initialMd={initialMd} /></div> : null}
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
  const system = e.key.startsWith('_');
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
      <Neighbourhood keyName={e.key} tone={tone} />
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Actions name their DESTINATION cell — "Open in @c15r/lit" — so the
            jump isn't a bare arrow into the unknown (the managing cell is part
            of the affordance, resolved from the handler's own cellRef). */}
        {open ? <a href={localize(open.href)} style={actionStyle(t)}>Open{open.cell ? ` in ${open.cell}` : ''} ↗</a> : null}
        {edit ? <a href={localize(edit.href)} style={actionStyle(t)}>Edit{edit.cell ? ` in ${edit.cell}` : ''} ↗</a>
          : authed && !system ? <button onClick={() => openFact(e)} style={{ ...actionStyle(t), background: t.actionFill, cursor: 'pointer' }}>Edit</button>
          : null}
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

/** Open the progressive detail modal for a fact (or a bare {key}; hydrated by peek). */
export function openFact(e: ListEntry): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<ListEntry>(FACT_DETAIL_EVENT, { detail: e }));
}

const shortKey = (k: string): string => (k.length > 22 ? k.slice(0, 21) + '…' : k);

/** A fact's one-hop neighbourhood — authored edges plus the derived backbone
 *  (instanceOf → its type, managedBy → its cell, inView → views). Derived edges
 *  render dashed/dim; every chip is itself a peek into that neighbour. */
function Neighbourhood({ keyName, tone = 'dark' }: { keyName: string; tone?: Tone }): React.JSX.Element {
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
  const chips = [
    ...n.outbound.map((ed) => chip(ed, ed.to, `${ed.rel}→${shortKey(ed.to)}`)),
    ...n.inbound.map((ed) => chip(ed, ed.from, `${shortKey(ed.from)}→${ed.rel}`)),
  ];
  return chips.length ? (
    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>{chips}</div>
  ) : (
    <span style={{ color: t.dim, fontSize: '0.72rem' }}>No edges yet.</span>
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
        <SchemaForm schema={schema} value={form} onChange={setForm} palette={{ text: t.text, dim: t.dim, border: t.line, inputBg: t.panel, accent: t.accent, danger: t.danger }} />
      ) : (
        <>
          <textarea
            value={text}
            onChange={(ev) => setText(ev.target.value)}
            rows={Math.min(18, Math.max(4, text.split('\n').length + 1))}
            spellCheck={false}
            style={{ ...inputStyle(t), padding: '0.55rem', fontFamily: theme.mono }}
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
export function FactDetail({ e, compact, tone = 'dark' }: { e: ListEntry; compact?: boolean; tone?: Tone }): React.JSX.Element {
  const t = SHEET_TONE[tone];
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
            <FactBody e={entry} full tone={tone} />
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
              <Neighbourhood keyName={entry.key} tone={tone} />
            </div>
          ) : null}
          {!compact ? (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {open ? <a href={open} style={actionStyle(t)}>Open ↗</a> : null}
              {edit ? <a href={edit} style={actionStyle(t)}>Edit in cell ↗</a> : !system ? (
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
export function FactDetailHost({ tone = 'dark' }: { tone?: Tone } = {}): React.JSX.Element | null {
  const t = SHEET_TONE[tone];
  const [entry, setEntry] = useState<ListEntry | null>(null);
  const activeKey = React.useRef<string | null>(null);
  const close = (): void => {
    activeKey.current = null;
    setEntry(null);
  };
  useEffect(() => {
    const onOpen = (ev: Event): void => {
      const detail = (ev as CustomEvent<ListEntry>).detail;
      if (!detail?.key) return;
      activeKey.current = detail.key;
      setEntry(detail);
      if (detail.value === undefined) {
        const requestedKey = detail.key;
        mcpCall('read', 'workspace.peek', { key: requestedKey })
          .then((r) => {
            const f = r.value as { value?: unknown; _meta?: ListEntry['_meta'] } | null;
            if (r.ok && f && activeKey.current === requestedKey) setEntry({ key: requestedKey, value: f.value, _meta: f._meta });
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
      if (ev.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entry]);
  if (!entry) return null;
  const title = `${typeIcon(entry) ? typeIcon(entry) + ' ' : ''}${factTitle(entry)}`;
  // A bottom sheet in the SUMMONING surface's tone — 'dark' (ink) over the
  // graph (a parchment sheet over the night scene reads as a jarring theme flip
  // — owner feedback 2026-07-10), 'light' (paper) over the trailhead, where it
  // stacks over the paper Content as a second rounded sheet rising over it
  // (same 14px lip + top shadow, so the two read as one growing stack). Same
  // width metric as the palette, so peek + palette read as one system.
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => close()}
      style={{ position: 'fixed', inset: 0, background: t.scrim, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000 }}
    >
      <div
        onClick={(ev) => ev.stopPropagation()}
        style={{
          background: t.bg,
          color: t.text,
          width: 'min(720px, 100vw)',
          maxHeight: '86dvh',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          borderTopLeftRadius: 14,
          borderTopRightRadius: 14,
          border: `1px solid ${t.line}`,
          borderBottom: 'none',
          boxShadow: t.shadow,
          padding: '0.8rem 0.9rem calc(0.9rem + env(safe-area-inset-bottom))',
          display: 'grid',
          gap: '0.7rem',
          alignContent: 'start',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
          <strong style={{ fontFamily: theme.serif, fontSize: '1.02rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{title}</strong>
          <button
            onClick={() => close()}
            aria-label="close"
            style={{ background: 'none', border: 'none', color: t.dim, cursor: 'pointer', fontSize: '1.1rem', padding: '0.2rem 0.4rem', flexShrink: 0 }}
          >
            ×
          </button>
        </div>
        <FactDetail e={entry} tone={tone} />
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

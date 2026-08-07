/**
 * Type vocabulary — the resolver (docs/type-vocabulary.md).
 *
 * A fact's `type` and the cell that opens/edits/renders it are coupled; this
 * makes the coupling *data*. A type declares `handlers` per intent (open /
 * edit / create / render / embed). The address of a cell surface is NOT baked
 * in apex-form: a handler declares only the `path` within a cell, and the cell
 * is implicit (the type's `manager`) unless the handler names another `cell`.
 * `resolve` returns that as a structured `{ cell: {owner,name}, path }` and the
 * CONSUMER materializes the origin via the kernel's `cellUrl` — so the same
 * declaration renders correctly on the apex or a cell subdomain, for any owner.
 * A handler may instead carry an `act` target, a `renderer` (`_renderers/<type>`
 * fact), a `hint` (built-in render kind), or a `surface` (a full templated path,
 * for value-derived addresses like a cell's stored `${value.address}`).
 * `resolve(fact, intent, decls)` is the one function every surface and agent
 * shares. Pure (no DOM, no cells hardcoded): callers supply the declarations.
 */

export type Intent = 'open' | 'edit' | 'create' | 'render' | 'embed' | 'preview' | 'assemble';

/** Declarative composite-body assembly (ADR-0093 Inc 1): "my body assembles
 *  from my member facts". The v1 semantic is deliberately the one proven shape:
 *  membership edges around the container, ordered by `placement.seq`, `field`
 *  concatenated. The spec is DECLARATION DATA — `resolve` passes it through
 *  verbatim (no templating: `fallbackKey`'s `${match}` is substituted RAW by
 *  the consumer, because it names a fact key, not a URL). */
export interface AssembleSpec {
  /** Member value field to concatenate (default: the host's text heuristic). */
  field?: string;
  /** MEMBER types: resolve the container fact via this tag prefix (`doc:`). */
  containerTagPrefix?: string;
  /** Audience fallback: when membership yields nothing for this viewer, read
   *  this key instead. `${match}` = the container key's suffix after its
   *  `type:` prefix. A grant-folded container re-applies its `owner/` prefix
   *  consumer-side — the fold is the host's concern, never the type's. */
  fallbackKey?: string;
}

export interface TypeHandler {
  /** Path within the surface cell (templated), e.g. `?doc=${match}`. The cell is
   *  the type's `manager` unless `cell` overrides it. Preferred over `surface`. */
  path?: string;
  /** Override the surface cell when it isn't the type's manager — `owner/name`
   *  (cross-cell), e.g. a capture opening in `c15r/lit`. Owner may be omitted to
   *  inherit the type's manager owner (`/name`). */
  cell?: string;
  /** A full templated path/URL — for value-derived addresses (`${value.address}`)
   *  the consumer localizes as-is. Prefer `path`+`cell` for cell surfaces. */
  surface?: string;
  /** A declared `act` target (create, custom verbs). Templated. */
  act?: string;
  /** A `_renderers/<type>` fact key for inline drawing. */
  renderer?: string;
  /** A built-in render hint (`markdown` / `metric` / …). */
  hint?: string;
  /** A named PURE VIEWER (`json` / `csv` / `mermaid` / `style` — the
   *  `@c15r/viewers` set). Distinct from `hint`: a hint is drawn by the
   *  surface itself, a viewer is a shared module the surface mounts. */
  viewer?: string;
  /** Resolved target cell for `path` (set by `resolve`; consumer → `cellUrl`). */
  cellRef?: { owner: string; name: string };
  /** Declarative composite assembly (ADR-0093) — passed through verbatim. */
  assemble?: AssembleSpec;
}

export interface TypeDecl {
  /** The cell that owns this type's lifecycle (informational + future routing). */
  manager?: string;
  /** Presentation: an emoji/icon for the type. */
  icon?: string;
  /** A dot-path into the fact value for a human label. */
  label?: string;
  /** Per-intent handlers; a list is tried in order (the first that fully resolves wins). */
  handlers?: Partial<Record<Intent, TypeHandler | TypeHandler[]>>;
  /** The gateway-resolved Present facet (ADR-0012). `render` is the OTHER
   *  spelling of a render binding — `{hint}` or `{viewer}` — carried by
   *  declarations that predate `handlers` (the legacy `_types/<type>` facts
   *  still live in slices: `csv`, `json`, `mermaid`, `style`). `resolve` reads
   *  it as the render fallback so those types stop falling through to the
   *  markdown floor; see the `render` intent below. */
  present?: { icon?: string; label?: string; render?: { hint?: string; viewer?: string } };
  /** Legacy flat spelling of `present.render.viewer` (same facts, older shape). */
  viewer?: string;
}

export interface VocabFact {
  key: string;
  value?: unknown;
  _meta?: { type?: string | null; tags?: string[] };
}

/** A fact's id: the part after a `prefix:` or `prefix/` in its key. Tolerates a
 *  missing key (a partial fact — e.g. a bare `{value,_meta}` map entry) — the
 *  floor degrades, it never throws. */
export function deriveId(key: string | undefined): string {
  if (!key) return '';
  if (key.includes(':')) return key.slice(key.indexOf(':') + 1);
  if (key.includes('/')) return key.slice(key.indexOf('/') + 1);
  return key;
}

function prefixOf(s: string): { type: string; rest: string } | null {
  const ci = s.indexOf(':');
  const si = s.indexOf('/');
  const i = ci >= 0 && (si < 0 || ci < si) ? ci : si;
  if (i <= 0) return null;
  return { type: s.slice(0, i), rest: s.slice(i + 1) };
}

/**
 * The type signals a fact carries, most specific first: its declared `type`,
 * then its key's prefix (`doc:foo` → `doc`), then each tag's prefix
 * (`canvas:X` → `canvas`). `match` is the suffix the handler can template from
 * (`${match}`), so `doc:foo` and a `doc:foo` *tag* both open doc `foo`.
 */
export function typeSignals(fact: VocabFact): Array<{ type: string; match: string }> {
  const out: Array<{ type: string; match: string }> = [];
  const key = fact.key ?? '';
  const t = fact._meta?.type;
  if (t) out.push({ type: t, match: deriveId(key) });
  const kp = prefixOf(key);
  if (kp) out.push({ type: kp.type, match: kp.rest });
  for (const tag of fact._meta?.tags ?? []) {
    const tp = prefixOf(tag);
    if (tp) out.push({ type: tp.type, match: tp.rest });
  }
  return out;
}

function pathInto(value: unknown, path: string): unknown {
  let cur: unknown = value;
  for (const p of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

interface TemplateCtx {
  id: string;
  key: string;
  type: string;
  match: string;
  value: unknown;
}

/**
 * Substitute `${id}` / `${key}` / `${type}` / `${match}` / `${value.path}` in a
 * template. Returns `null` if any variable resolves empty — that handler is
 * inapplicable, so the caller falls to the next (this is how alternatives work:
 * `doc=log:${value.captured}` skips to `/@c15r/input` when there's no capture
 * date). Scalar id/key/match are URL-encoded; `${value.*}` is taken raw (it's
 * often a full address).
 */
export function applyTemplate(tmpl: string, ctx: TemplateCtx): string | null {
  let missing = false;
  const out = tmpl.replace(/\$\{([^}]+)\}/g, (_m, expr: string) => {
    let raw: string;
    let encode = true;
    if (expr === 'id') raw = ctx.id;
    else if (expr === 'key') raw = ctx.key;
    else if (expr === 'type') raw = ctx.type;
    else if (expr === 'match') raw = ctx.match;
    else if (expr.startsWith('value.')) {
      const v = pathInto(ctx.value, expr.slice('value.'.length));
      raw = v == null ? '' : String(v);
      encode = false;
    } else raw = '';
    if (!raw) missing = true;
    return encode ? encodeURIComponent(raw) : raw;
  });
  return missing ? null : out;
}

function asList<T>(h: T | T[] | undefined): T[] {
  return h == null ? [] : Array.isArray(h) ? h : [h];
}

/** Parse a cell reference (`@owner/name`, `owner/name`, or `/name` to inherit the
 *  manager's owner) into `{owner, name}`. `managerOwner` is the fallback owner. */
function parseCellRef(ref: string | undefined, managerOwner: string): { owner: string; name: string } | null {
  if (!ref) return null;
  const clean = ref.replace(/^@/, '');
  const slash = clean.indexOf('/');
  if (slash < 0) return null;
  const owner = clean.slice(0, slash) || managerOwner;
  const name = clean.slice(slash + 1);
  return owner && name ? { owner, name } : null;
}

/** The declaration that governs a fact (first matching type signal). */
export function declFor(fact: VocabFact, decls: Record<string, TypeDecl>): TypeDecl | null {
  for (const sig of typeSignals(fact)) {
    if (decls[sig.type]) return decls[sig.type];
  }
  return null;
}

/**
 * Resolve a fact + intent to a concrete handler, or `null`. Tries each type
 * signal (most specific first) and, within it, each handler in order, templating
 * against the fact; the first fully-resolved handler wins.
 */
/**
 * The Present facet's render binding, as a handler (ADR-0012). A declaration
 * carries its render EITHER as `handlers.render[]` (the current shape) or as
 * `present.render` / a flat `viewer` (the shape the older `_types/<type>`
 * facts still in slices use). Only the first was ever consumed, so a fact
 * typed `mermaid`/`csv`/`json`/`style` resolved to nothing and fell through to
 * the markdown floor — rendered as a wall of text next to surfaces that draw
 * the identical content as a diagram or a table.
 */
function presentRender(decl: TypeDecl | undefined): TypeHandler | null {
  const r = decl?.present?.render;
  if (r && typeof r.hint === 'string' && r.hint) return { hint: r.hint };
  const viewer = (r && typeof r.viewer === 'string' ? r.viewer : undefined) ?? decl?.viewer;
  return typeof viewer === 'string' && viewer ? { viewer } : null;
}

export function resolve(fact: VocabFact, intent: Intent, decls: Record<string, TypeDecl>): TypeHandler | null {
  for (const sig of typeSignals(fact)) {
    const decl = decls[sig.type];
    const handlers = asList(decl?.handlers?.[intent]);
    if (!handlers.length) {
      // No `handlers.render` — fall back to the Present facet for THIS signal
      // before moving to a less specific one, so a type's own (legacy) render
      // binding still beats a key-prefix or tag match.
      if (intent === 'render' && decl) {
        const pr = presentRender(decl);
        if (pr) return pr;
      }
      continue;
    }
    const ctx: TemplateCtx = { id: deriveId(fact.key), key: fact.key, type: sig.type, match: sig.match, value: fact.value };
    // The owner that an unqualified cell ref inherits — the type's manager owner.
    const managerRef = parseCellRef(decl?.manager, '');
    const managerOwner = managerRef?.owner ?? '';
    for (const h of handlers) {
      const resolved: TypeHandler = {};
      let ok = true;
      // Preferred: a cell-relative `path` (cell implicit = manager, or `cell` ref).
      if (h.path !== undefined) {
        const cellRef = parseCellRef(h.cell ?? decl?.manager, managerOwner);
        const p = applyTemplate(h.path, ctx);
        if (!cellRef || p === null) ok = false;
        else {
          resolved.cellRef = cellRef;
          resolved.path = p;
        }
      } else if (h.surface !== undefined) {
        // Value-derived / legacy full path — consumer localizes as-is.
        const s = applyTemplate(h.surface, ctx);
        if (s === null) ok = false;
        else resolved.surface = s;
      }
      if (ok && h.act !== undefined) {
        const a = applyTemplate(h.act, ctx);
        if (a === null) ok = false;
        else resolved.act = a;
      }
      if (ok && h.renderer !== undefined) resolved.renderer = h.renderer;
      if (ok && h.hint !== undefined) resolved.hint = h.hint;
      if (ok && h.viewer !== undefined) resolved.viewer = h.viewer;
      // Declaration data, not an address: passed through verbatim (ADR-0093).
      if (ok && h.assemble !== undefined) resolved.assemble = h.assemble;
      if (ok && (resolved.cellRef || resolved.surface || resolved.act || resolved.renderer || resolved.hint || resolved.viewer || resolved.assemble)) return resolved;
    }
    // Handlers existed but none applied (every template had a missing
    // variable) — the Present facet is still a valid render binding.
    if (intent === 'render') {
      const pr = presentRender(decl);
      if (pr) return pr;
    }
  }
  return null;
}

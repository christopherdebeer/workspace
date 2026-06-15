/* GENERATED — synced from platform/ui/vocab.ts by scripts/sync-platform-ui.mjs.
 * Do NOT edit here; edit platform/ui/vocab.ts and re-run the sync. Source-bundled so the
 * cell renders platform/ui isomorphically with its own React. */
/**
 * Type vocabulary — the resolver (docs/type-vocabulary.md).
 *
 * A fact's `type` and the cell that opens/edits/renders it are coupled; this
 * makes the coupling *data*. A type declares `handlers` per intent (open /
 * edit / create / render / embed), each resolving to a `surface` (a URL into a
 * cell), an `act` (a declared act target), a `renderer` (a `_renderers/<type>`
 * fact), or a `hint` (a built-in render hint). `resolve(fact, intent, decls)`
 * is the one function every surface and agent shares — home's `factHref`, a
 * canvas element's open path, an agent's "how do I edit this" all go through
 * it. Pure (no DOM, no cells hardcoded): callers supply the declarations.
 */

export type Intent = 'open' | 'edit' | 'create' | 'render' | 'embed' | 'preview';

export interface TypeHandler {
  /** A URL into a cell (open/edit/embed). Templated. */
  surface?: string;
  /** A declared `act` target (create, custom verbs). Templated. */
  act?: string;
  /** A `_renderers/<type>` fact key for inline drawing. */
  renderer?: string;
  /** A built-in render hint (`markdown` / `metric` / …). */
  hint?: string;
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
}

export interface VocabFact {
  key: string;
  value?: unknown;
  _meta?: { type?: string | null; tags?: string[] };
}

/** A fact's id: the part after a `prefix:` or `prefix/` in its key. */
export function deriveId(key: string): string {
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
  const t = fact._meta?.type;
  if (t) out.push({ type: t, match: deriveId(fact.key) });
  const kp = prefixOf(fact.key);
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
export function resolve(fact: VocabFact, intent: Intent, decls: Record<string, TypeDecl>): TypeHandler | null {
  for (const sig of typeSignals(fact)) {
    const decl = decls[sig.type];
    const handlers = asList(decl?.handlers?.[intent]);
    if (!handlers.length) continue;
    const ctx: TemplateCtx = { id: deriveId(fact.key), key: fact.key, type: sig.type, match: sig.match, value: fact.value };
    for (const h of handlers) {
      const resolved: TypeHandler = {};
      let ok = true;
      if (h.surface !== undefined) {
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
      if (ok && (resolved.surface || resolved.act || resolved.renderer || resolved.hint)) return resolved;
    }
  }
  return null;
}

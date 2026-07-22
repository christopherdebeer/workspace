/**
 * Client-side Present resolvers (ADR-0012) — the ONE label/title/icon resolver
 * every cell surface shares.
 *
 * Before this module, four surfaces carried their own copy of "resolve the
 * declared label path against the fact": kernel `titleOf` (correct — roots
 * `value.*`/`key`/`meta.*` paths at the fact ENVELOPE, mirroring the runtime's
 * `resolveLabel`), home/home-next `factTitle` (identical forks that rooted the
 * path at the VALUE, so every declared `value.*` label resolved
 * `e.value.value.*` → undefined and silently fell to the heuristic), and lit
 * (a hardcoded `title||name`). The icon ladder `present.icon ?? icon ?? floor`
 * was copied verbatim three times in canvas. This module is the collapse: pure,
 * dependency-free (no React, no DOM), tolerant of both the raw `$types` decl
 * shape and home's normalised `TypeDecl`.
 *
 * Rooting rule (the part that forked): a label path whose head is `value`,
 * `key`, or `meta` reads the envelope `{value, key, meta}`; a bare token (the
 * legacy `titlePath` form, e.g. `name`) reads the value.
 */

/** A fact entry, reduced to what Present inspects. */
export interface PresentableEntry {
  key: string;
  value?: unknown;
  _meta?: { type?: string | null; tags?: string[] };
}

/** The declaration facets Present reads — raw `$types` decls carry
 *  `present.{icon,label}` (+ legacy flat `icon`/`titlePath`); home's normalised
 *  `TypeDecl` folds them into flat `icon`/`label`. Both shapes resolve here. */
export interface PresentDecl {
  icon?: string;
  label?: string;
  titlePath?: string;
  present?: { icon?: string; label?: string };
}

function pathInto(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Resolve a declared label path against a fact entry — envelope-rooted for
 *  `value.*`/`key`/`meta.*` heads, value-rooted for bare legacy tokens.
 *  Strings cap at 80 chars; numbers/booleans stringify; anything else is
 *  undefined (the caller falls to the heuristic). */
export function labelOf(e: PresentableEntry, path?: string): string | undefined {
  if (!path) return undefined;
  const head = path.split('.')[0];
  const root = head === 'value' || head === 'key' || head === 'meta' ? { value: e.value, key: e.key, meta: e._meta } : e.value;
  const v = pathInto(root, path);
  if (typeof v === 'string' && v) return v.slice(0, 80);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return undefined;
}

/** The undeclared-type title heuristic (shared by home + kernel): a string
 *  value's first 80 chars, an object's `title`/`name`, or the first content
 *  line with markdown syntax stripped. `''` when nothing usable. */
export function heuristicTitle(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 80);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.title === 'string' && o.title) return o.title.slice(0, 80);
    if (typeof o.name === 'string' && o.name) return o.name.slice(0, 80);
    if (typeof o.content === 'string' && o.content) {
      const line = o.content.match(/^#+\s*(.+)$/m)?.[1] ?? o.content.split('\n').find((l) => l.trim()) ?? '';
      const clean = line.replace(/^[-*]\s*\[[ x]\]\s*/, '').replace(/[#*_`>\\[\]()]/g, '').trim();
      if (clean) return clean.slice(0, 80);
    }
  }
  return '';
}

/** A fact's one-line presentation: declared label path (`present.label` ←
 *  `label` ← legacy `titlePath`) → value heuristic → the key. Never empty. */
export function titleOf(e: PresentableEntry, decl?: PresentDecl | null): string {
  const declared = labelOf(e, decl?.present?.label ?? decl?.label ?? decl?.titlePath);
  if (declared) return declared;
  return heuristicTitle(e.value) || e.key;
}

/** The type glyph ladder: `present.icon ?? icon ?? floor` (floor defaults to
 *  `''` — pass `'•'` where a surface wants a visible placeholder). */
export function iconOf(decl?: PresentDecl | null, floor = ''): string {
  return decl?.present?.icon ?? decl?.icon ?? floor;
}

/**
 * Shared render vocabulary (ADR-0035 Inc A) — the SINGLE source of truth for how a
 * fact's value becomes a body by its `present.render` hint (markdown/code/metric/fields/
 * image), the body-text field priority, the `present.label` path resolution, and the
 * fields-selection rules. Both surfaces consume it: the home cell's React `HintBody`
 * uses the granular helpers (keeping its richer React wrappers), and the conversation
 * card's bundle (ADR-0034) uses `hintToHtml` wholesale — so the card stops being a
 * divergent vanilla re-implementation.
 *
 * Dependency-free by design (no React, no DOM, no markdown lib): markdown is INJECTED
 * (`HintDeps.md`) so `platform/ui` keeps its "React-only" contract and each surface
 * supplies its own `marked`. Pure string in/out — SSR-safe and bundle-lean.
 */

/** Escape HTML text. */
export function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

/** Fields that carry a fact's prose body, in priority order (matches home's `bodyText`). */
const BODY_FIELDS = ['content', 'body', 'text', 'description', 'note', 'md', 'markdown'] as const;

/** The markdown/text body of a fact value (a string, or its first content-ish field). */
export function bodyText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    for (const f of BODY_FIELDS) if (typeof obj[f] === 'string' && obj[f]) return obj[f] as string;
  }
  return '';
}

/** Resolve a `present.label`/path (e.g. `value.title`) against an entry `{ value, _meta }`. */
export function resolvePath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), root);
}

/** The scalar fields worth showing for a `fields` hint — non-object, non-identity, capped. */
export function selectFields(v: unknown): Array<[string, string]> {
  if (!v || typeof v !== 'object') return [];
  const skip = new Set(['content', 'title', 'name', 'id', 'src']);
  return Object.entries(v as Record<string, unknown>)
    .filter(([k, val]) => val != null && typeof val !== 'object' && !skip.has(k))
    .slice(0, 6)
    .map(([k, val]) => [k, String(val).slice(0, 160)] as [string, string]);
}

/** Markdown is supplied by the surface (home/widget each bundle `marked`) so this module
 *  stays dependency-free. `md` returns sanitized-enough HTML; `esc` defaults to `escapeHtml`. */
export interface HintDeps {
  md: (src: string) => string;
  esc?: (s: unknown) => string;
}

function fieldsHtml(v: unknown, esc: (s: unknown) => string): string {
  const rows = selectFields(v);
  if (!rows.length) return '';
  return (
    '<dl class="f">' +
    rows.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${esc(val)}</dd></div>`).join('') +
    '</dl>'
  );
}

/**
 * Render a fact value's body for a built-in `hint`, as an HTML string. Returns '' when
 * there's nothing to draw (the caller falls back to fields/JSON). Mirrors the home cell's
 * `HintBody` kinds: md/markdown, code, metric, fields, image.
 */
export function hintToHtml(hint: string, value: unknown, deps: HintDeps): string {
  const esc = deps.esc ?? escapeHtml;
  switch (hint) {
    case 'md':
    case 'markdown': {
      const t = bodyText(value);
      return t ? `<div class="md">${deps.md(t)}</div>` : '';
    }
    case 'code': {
      const c = bodyText(value);
      return c ? `<pre>${esc(c.slice(0, 2000))}</pre>` : '';
    }
    case 'metric': {
      const v = value as Record<string, unknown> | number | null;
      const n =
        typeof v === 'number'
          ? v
          : (v && (v.value ?? v.count ?? v.total)) != null
            ? (v as Record<string, unknown>).value ?? (v as Record<string, unknown>).count ?? (v as Record<string, unknown>).total
            : bodyText(value);
      return n != null && n !== '' ? `<div class="metric">${esc(n)}</div>` : '';
    }
    case 'fields':
      return fieldsHtml(value, esc);
    case 'image': {
      const o = value as Record<string, unknown> | null;
      const s = o && (o.src ?? o.url ?? o.href ?? o.image);
      return s ? `<img src="${esc(s)}" loading="lazy">` : '';
    }
    default:
      return '';
  }
}

/** The fields block alone (home's `FieldsBody`, as a string). */
export function fieldsToHtml(value: unknown, esc: (s: unknown) => string = escapeHtml): string {
  return fieldsHtml(value, esc);
}

/**
 * inferIngestionType (ADR-0081) — the put seam infers a real type from a
 * file's extension/MIME instead of stamping everything `file`, so the fact
 * lands with a manager that can enrich it (`$types` — cell `types.json`)
 * instead of going in inert. Pure + unit-tested so both the general file-put
 * mirror (`services/workspace/event-handlers.ts`) and any future ingestion
 * seam can share one table.
 *
 * The table is overridable at runtime via a `_config/ingestion` fact (same
 * "config, not code" precedent as `_config/typography` — see
 * `cells/home/client/graph.tsx`), so the vocabulary can grow without a
 * deploy. `resolveIngestionRules` merges a caller-supplied override on top
 * of the built-in defaults; unmatched names fall through to `file`.
 */

export interface IngestionRule {
  /** Lowercase file extensions this rule matches, e.g. ['.md']. */
  ext?: string[];
  /** MIME type prefixes this rule matches, e.g. ['image/']. */
  mime?: string[];
  /** The type to stamp when this rule matches. */
  type: string;
}

export interface IngestionConfig {
  rules?: IngestionRule[];
  /** Fallback type when no rule matches. Defaults to 'file'. */
  default?: string;
}

const DEFAULT_RULES: IngestionRule[] = [
  { ext: ['.md', '.markdown'], type: 'markdown' },
  { ext: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'], mime: ['image/'], type: 'image' },
  { ext: ['.html', '.htm'], mime: ['text/html'], type: 'artifact' },
  { ext: ['.json', '.csv', '.yaml', '.yml'], type: 'data' },
];
const DEFAULT_TYPE = 'file';

/** The extension of a name/path, lowercased, including the leading dot — '' if none. */
function extOf(name: string): string {
  const base = name.split('/').pop() ?? name;
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i).toLowerCase() : '';
}

/**
 * Infer the type for an ingested file from its name (path or filename) and
 * optional content-type. Extension match takes priority over MIME (a
 * `.md` file served as `text/plain` should still become `markdown`); MIME
 * alone catches extension-less uploads. `config` overrides/extends the
 * built-in table — its rules are tried FIRST, so an override can redirect
 * an extension the defaults already claim.
 */
export function inferIngestionType(name: string, contentType?: string | null, config?: IngestionConfig | null): string {
  const ext = extOf(name || '');
  const mime = (contentType || '').toLowerCase();
  const rules = [...(config?.rules ?? []), ...DEFAULT_RULES];
  for (const rule of rules) {
    if (rule.ext?.includes(ext)) return rule.type;
  }
  for (const rule of rules) {
    if (mime && rule.mime?.some((m) => mime.startsWith(m))) return rule.type;
  }
  return config?.default ?? DEFAULT_TYPE;
}

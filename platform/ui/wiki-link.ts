/**
 * Wiki-links, canonically (ADR-0044 Inc 4, subsuming ADR-0038 Inc 3 / 0039 Inc 4).
 *
 * `[[target]]` / `[[target|label]]` is the substrate's cross-surface link
 * syntax: a bare word resolves to `doc:<slug>`; anything containing `:` or `/`
 * is already a fact key. ONE resolver + ONE slug rule, shared by every surface
 * — lit (renders an <a href> into its own routes), the conversation card
 * (renders a host-proxied peek anchor), and edge-sync (`extractWikiTargets`
 * turns a body's links into substrate edges). The card's inline copy carried a
 * "Consolidate into platform/ui later" note — this is that consolidation.
 *
 * Dependency-free (no marked import): surfaces pass the extension object to
 * their own `marked.use(...)`, and supply their own anchor renderer — the KEY
 * resolution is what must never fork, not the markup.
 */

export interface WikiTarget {
  key: string;
  label: string;
}

/** The one slug rule: a bare wiki word becomes `doc:<slug>`. */
export function wikiSlug(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** A target with no spaces and a `:`/`/` separator (or a `$`-reserved route,
 *  e.g. `$docs`) IS a real key — used as-is. Anything else (plain prose, even
 *  with a literal `/`) is a doc title and slugifies. These are LIT's evolved
 *  semantics; the card's copy had drifted to a stale colon-only test (so
 *  `[[kb/foo]]` mis-resolved to `doc:kb-foo` there) — consolidation adopts the
 *  richer rule everywhere, which is the point of having one resolver. */
const looksLikeKey = (s: string): boolean => !/\s/.test(s) && (s.includes(':') || s.includes('/') || s.startsWith('$'));

export function resolveWikiTarget(raw: string): WikiTarget {
  const [t, l] = raw.split('|');
  const target = (t ?? '').trim();
  const key = looksLikeKey(target) ? target : `doc:${wikiSlug(target)}`;
  return { key, label: (l ?? target).trim() || target };
}

/** Every distinct fact key a markdown body wiki-links to — the edge-sync input
 *  (lit reconciles these into `related` edges on save). */
export function extractWikiTargets(md: string): string[] {
  const out = new Set<string>();
  const re = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) out.add(resolveWikiTarget(m[1]).key);
  return [...out];
}

/** A `marked` inline extension for `[[…]]`, parameterized by the surface's own
 *  anchor renderer (lit: href into its routes; the card: a data-key peek link).
 *  Pass to `marked.use({ extensions: [wikiLinkExtension(renderAnchor)] })`. */
export function wikiLinkExtension(renderAnchor: (target: WikiTarget) => string): {
  name: string;
  level: 'inline';
  start: (src: string) => number;
  tokenizer: (src: string) => { type: string; raw: string; text: string } | undefined;
  renderer: (tok: { text: string }) => string;
} {
  return {
    name: 'wikilink',
    level: 'inline',
    start: (src: string) => src.indexOf('[['),
    tokenizer: (src: string) => {
      const m = /^\[\[([^\]]+)\]\]/.exec(src);
      return m ? { type: 'wikilink', raw: m[0], text: m[1] } : undefined;
    },
    renderer: (tok: { text: string }) => renderAnchor(resolveWikiTarget(tok.text)),
  };
}

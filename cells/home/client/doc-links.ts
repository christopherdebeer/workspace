/* ---------------------------------------------------------------------------
 * doc-links.ts — corpus-relative doc-link resolution (ADR-0092 follow-on).
 *
 * Pure + dependency-free (unit-tests without the browser/marked bundle):
 * a relative `*.md` href inside a rendered doc resolves to a `doc:` fact key
 * against the doc's own corpus directory. See safe-markdown.tsx for the
 * rendering half (FactLink / [[wiki-link]]s).
 * ------------------------------------------------------------------------- */

/** Resolve a relative/corpus-rooted `*.md` href to a `doc:` fact key, or null
 *  when it isn't one (absolute URLs, anchors, non-corpus paths all pass
 *  through to the ordinary link path). Traversal outside `docs/` is refused. */
export function resolveDocHref(href: string, base?: string): string | null {
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#|\?)/i.test(href)) return null;
  const path = href.split(/[#?]/)[0];
  if (!/\.md$/i.test(path)) return null;
  const joined = path.startsWith('docs/') ? path : base ? `${base}/${path}` : path;
  const out: string[] = [];
  for (const seg of joined.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      if (!out.length) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  const resolved = out.join('/');
  if (!resolved.startsWith('docs/')) return null;
  return `doc:${resolved.replace(/\.md$/i, '')}`;
}

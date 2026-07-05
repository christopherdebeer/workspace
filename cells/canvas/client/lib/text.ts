/** Titles derived from element CONTENT must read as prose, not markup — the
 *  selection header was showing `Welcome to <a href='https://parc.land' t`
 *  and the AI-edit placeholder quoted raw HTML back at the user. One snippet
 *  helper for every surface that names an element by its content. */
export function plainSnippet(raw: unknown, max = 44): string {
  if (typeof raw !== 'string') return '';
  let s = raw;
  s = s.replace(/<[^>]*>/g, ' ');                 // strip tags
  s = s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1'); // md links/images → text
  s = s.replace(/^[#>\s*-]+/gm, '');              // md heading/list/quote lead-ins
  s = s.replace(/[*_`~]{1,3}([^*_`~]*)[*_`~]{1,3}/g, '$1'); // emphasis marks
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

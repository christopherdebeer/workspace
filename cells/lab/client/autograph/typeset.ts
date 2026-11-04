/**
 * Marked text set in type (from session 12): the same markup the hand reads (hands/v7.ts, parse()), turned into HTML
 * for the font to set. Two ways:
 *
 * - `web`: elements for what's meant (em, strong, del, ins, mark, code, small, and <unsure> and <care>), for
 *   static/autograph/claude-hand-<version>.css to dress, which is what the stylesheet is for: the font and its
 *   stylesheet together say what the hand does, as far as type can.
 * - `app`: what the font alone can carry in any app, its bold, italic, underline and strike buttons: stress is italic
 *   (the font has none, so the app slants it), strong is bold (the Pressed face), struck is struck; anything else is
 *   lost, and only its words are left.
 *
 * Quotes come already curled by parse(), so a quote needs no element of its own. Samples set in type are fingerprinted
 * as they're set (autograph-check.mjs), so this can't change how an old one comes out.
 */
import { parse, type Emphasis } from './hands/v7';

/** the element for each, outermost first (so a long mark stays open while shorter ones open and close inside it) */
const WEB: [Emphasis, string][] = [['later', 'ins'], ['circled', 'mark'], ['struck', 'del'], ['strong', 'strong'], ['stress', 'em'], ['aside', 'small'], ['unsure', 'unsure'], ['care', 'care'], ['code', 'code']];
const APP: [Emphasis, string][] = [['struck', 's'], ['strong', 'b'], ['stress', 'i']];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function typeset(text: string, way: 'web' | 'app' = 'web'): string {
  const els = way === 'web' ? WEB : APP;
  let out = '';
  const open: string[] = [];
  for (const { ch, e } of parse(text)) {
    const want = els.filter(([k]) => e.includes(k)).map(([, el]) => el);
    let keep = 0;
    while (keep < open.length && open[keep] === want[keep]) keep++;
    while (open.length > keep) out += `</${open.pop()}>`;
    for (const el of want.slice(keep)) { out += `<${el}>`; open.push(el); }
    out += esc(ch);
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

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
 * - (from session 56) the pen as it goes, <rising>, <falling> and <broad>, a word at a time (see penSet).
 *
 * Quotes come already curled by parse(), so a quote needs no element of its own. Samples set in type are fingerprinted
 * as they're set (autograph-check.mjs), so this can't change how an old one comes out.
 */
import { parse, type Emphasis } from './hands/v7';
import { parse as parse34, pens, type Emphasis as Emphasis34 } from './hands/v34';

/** the element for each, outermost first (so a long mark stays open while shorter ones open and close inside it) */
const WEB: [Emphasis, string][] = [['later', 'ins'], ['circled', 'mark'], ['struck', 'del'], ['strong', 'strong'], ['stress', 'em'], ['aside', 'small'], ['unsure', 'unsure'], ['care', 'care'], ['code', 'code']];
const APP: [Emphasis, string][] = [['struck', 's'], ['strong', 'b'], ['stress', 'i']];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** (from session 56) the pen's elements, <rising>, <falling> and <broad>: text with any of them is read by the hand that
 * knows them (v34), so text without them is set exactly as before */
const PEN = /<\/?(rising|falling|broad)>/;

/** (from session 56) the pen as type can carry it, a word at a time: a font changes from letter to letter only by
 * shaping each letter alone, which loses its joins, so a word is one setting. Louder is heavier (the font's pace axis,
 * the nearest it has to pressing harder: up to 700 at the pen's hardest), softer lighter and paler (down to 200, and half
 * as dark), and the broad voice is Claude Hand Broad. Only the web can carry it; in any app the words are left */
function penSet(text: string, way: 'web' | 'app'): string {
  const els = (way === 'web' ? WEB : APP) as [Emphasis34, string][];
  const chars = pens(parse34(text));
  // (each word's pen: its press on average, and broad if any of it is)
  const word = chars.map(() => '');
  for (let i = 0; i < chars.length; ) {
    if (chars[i].ch === ' ') { i++; continue; }
    let j = i, press = 0, voice = 0;
    while (j < chars.length && chars[j].ch !== ' ') { press += chars[j].pen!.press; voice = Math.max(voice, chars[j].pen!.voice); j++; }
    press /= j - i;
    const style = [
      press > 0.02 ? `font-weight:${Math.round(400 + 300 * press)}` : press < -0.02 ? `font-weight:${Math.round(400 + 200 * press)};opacity:${(1 + 0.5 * press).toFixed(2)}` : '',
      voice > 0 ? `font-family:'Claude Hand Broad 5.5',cursive` : '',
    ].filter(Boolean).join(';');
    for (let c = i; c < j; c++) word[c] = style;
    i = j;
  }
  let out = '';
  const open: string[] = [];
  chars.forEach(({ ch, e }, i) => {
    const want = els.filter(([k]) => e.includes(k)).map(([, el]) => el);
    if (way === 'web' && word[i]) want.push(`span style="${word[i]}"`);
    let keep = 0;
    while (keep < open.length && open[keep] === want[keep]) keep++;
    while (open.length > keep) out += `</${open.pop()!.split(' ')[0]}>`;
    for (const el of want.slice(keep)) { out += `<${el}>`; open.push(el); }
    out += esc(ch);
  });
  while (open.length) out += `</${open.pop()!.split(' ')[0]}>`;
  return out;
}

export function typeset(text: string, way: 'web' | 'app' = 'web'): string {
  if (PEN.test(text)) return penSet(text, way);
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

// Autograph's font (node cells/lab/devtools/autograph-font.mjs): the hand made into a font you can type with.
//
// Every character the hand knows is set on its own by the hand (hands/v26.ts, letter(); 1.2 was v7's, 1.4 v9's, 1.8 v12's, 1.9 v13's, 2.0 v14's, 2.6 v18's, 2.7 v19's, 2.8 v20's, 2.9 v21's, 3.3 v23's, 3.4 v24's), in each form it can begin with
// (starting a word; joined from a letter that went out low; joined from one that went out high) and in four writings.
// That gives centrelines with the pen's width at every point. Then devtools/autograph-font.py (fontTools + shapely: `pip
// install fonttools shapely brotli`) widens them into outlines and writes the font, with its rules: each letter takes
// the form its neighbour calls for, and each takes a writing a step on from the one before (one step or three, by the
// letter), so neighbours never match and the turns don't fall into a rhythm. Out come
// static/autograph/claude-hand-<version>.ttf and .woff2, kept in the repository like the samples (older versions stay,
// for the samples set in them).
//
// Since 1.2 (session 12) in two faces, each the hand at a pace: Regular, and Pressed, every letter written at the pace
// the hand writes what's strong (MANNERS.strong), so its ink comes heavier by itself, from the pen's body, the way the
// hand presses. It's the family's bold, so an app's bold is the hand pressing. (The hand's quicker manners, asides and
// doubts, lighten the ink by under a tenth: not enough to be a face.) Each face also says where its underline and strike
// go, where the hand writes them, so an app's underline and strike sit where a pen puts them.
//
// Since 1.8 (session 18) the font is spaced as the hand is (v11's spacing, and v12's room before the c): the letters
// whose exits run further before the next letter are set with them, and a letter that sits nearer the one before it only
// inside a word (the s) is drawn where it stands starting a word, with a kern that brings it nearer after anything inked.
// A kern needs a pair, and a space or a line's start makes none, so starting a word it keeps the word space, as the hand
// does.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url)), lab = join(here, '..');
const outfile = join(tmpdir(), `autograph-font-${process.pid}.mjs`);
await build({ stdin: { contents: `export { KNOWS, letter, formsOf, exitOf, JOIN, STYLE, MANNERS, SPACING, worn, HURRY } from './client/autograph/hands/v27';`, resolveDir: lab, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { KNOWS, letter, formsOf, exitOf, JOIN, STYLE, MANNERS, SPACING, worn, HURRY } = await import(outfile);
const HAND = 'v27';

/** the version (the session that made it: 1.0 is session 10's, by that rule, not a claim that it's done), how many writings of each letter, and how far each letter steps through
 * them: one or three (both turn a run of one letter through all four), by the letter */
// (4.0: three writings, not four, so the hand's sizes fit in the file; each letter stepping one or two through them, both
// coprime with three, so neighbours still never match)
const VERSION = '4.0', ALTS = 3, step = (ch) => (ch.codePointAt(0) % 2 ? 2 : 1);
const chars = [' ', ...KNOWS];
/** (1.8) the letters that sit nearer the one before them only inside a word: how much nearer (x-heights, less than
 * nothing). The hand has them drawn already nearer; the font draws them back where they stand starting a word, and kerns */
const NEARER = Object.entries(SPACING).filter(([, d]) => d < 0);
/** (1.8) what's said of the font when it's made: who had read the hand it was made from */
const READ = 'When it was made, its hand (v27, joined as v26) had been read blind hurried, with care, by three models without a mistake, and at its own pace by one, without a mistake and with doubts at four words; no person had read it. It has three axes: pace (wght), the time the hand gives a word, from hurried (200) through its own pace (400) to pressed (700); wear (WEAR); and its size (opsz), the hand written small or large with the same pen, so set small its pen is wider against the letters and set large it is finer, chosen by the browser from the size it sets.';
// ('When it was made, its hand (v26) had been read blind hurried, at four times its pace with its pen loosened by care and its f, e, r and v written with care, by three models without a mistake; and at its own pace by one, without a mistake and with doubts at four words, as v25 was. No person had read it. It has two axes: pace (wght), the time the hand gives a word, from hurried (200, four times its own pace, the pen looser) through its own pace (400) to pressed (700); and wear (WEAR, 0 to 50).';)
// ('When it was made, its hand (v24) at its own pace had been read blind by a model without a doubt, and hurried (four times its pace, its hurried end) by two without a mistake; no person had read it. It has two axes: pace (wght), the hand hurried (200), at its own pace (400) and at the pace it writes what is strong (700), its line as well as its ink moving with the pace; and wear (WEAR), the letters as they stand (0) and as practice for ease left them (100).';)
// (3.3's: 'When it was made, its hand (v23, the loosest pen two readers read blind without a mistake) had been read by two models blind, every word, with doubts at four; no person had read it. It has two axes: pace (wght), the hand hurried, at twice its own pace (200), at its own pace (400) and at the pace it writes what is strong (700), its line as well as its ink moving with the pace; and wear (WEAR), the letters as they stand (0) and as practice for ease left them (100).')
// (2.9's: 'When it was made, one person had read the hands before it blind, 94 words of 96 over four pages, and models had misread none. Its f, looped again with its lower loop turning forward, its wear and its hurry hadn\'t been read by anyone yet. It has two axes: pace (wght), the hand hurried, at twice its own pace (200), at its own pace (400) and at the pace it writes what is strong (700), its line as well as its ink moving with the pace; and wear (WEAR), the letters as they stand (0) and as practice for ease left them (100).')
// (2.8's: 'When it was made, one person had read the hands before it blind, 94 words of 96 over four pages, and models had misread none. Its f, which stands on the line, its wear and its hurry hadn\'t been read by anyone yet. It has two axes: pace (wght), the hand hurried, at twice its own pace (200), at its own pace (400) and at the pace it writes what is strong (700), its line as well as its ink moving with the pace; and wear (WEAR), the letters as they stand (0) and as practice for ease left them (100).')
// (2.7's: 'When it was made, one person had read the hands before it blind, 94 words of 96 over four pages, and models had misread none. Its f, which stands on the line, and its wear hadn\'t been read by anyone yet. It has two axes: pace (wght), the hand at its own pace (400) and at the pace it writes what is strong (700), and wear (WEAR), the letters as they stand (0) and as practice for ease left them (100).')
// (2.6's: 'When it was made, one person had read the hands before it blind, 94 words of 96 over four pages, and models had misread none. This hand\'s f, which stands on the line, hadn\'t been read by anyone yet.')
// (2.0's: 'When it was made, one person had read the hands before it blind, 93 words of 96 over four pages, and models had misread none; in this hand the s, whose foot made lost read last, keeps its foot to itself.' One of the three, took read as room, was found in session 23 to have been a slip in typing.)
// (1.9's: 'When it was made, the hand before it (v12) had been read blind by one person, who misread two words of 48, and by models, who misread none; in this hand the t, k and x misread in them are written anew.')
// (1.8's: 'When it was made, only models had read this hand blind; no person yet.')
// From 2.7 (session 27) one variable font, its masters the hand in three states: at its own pace, at the pace it writes
// what's strong, and with its letters as practice for ease left them (v19's WORN), between which the font moves on two
// axes, pace (wght, 400 to 700, so an app's bold is the hand pressing) and wear (WEAR, 0 to 100). Outlined so the
// masters share their points, put together and pair-tested at every corner by devtools/autograph-font-vary.py.
// From 2.8 (session 28) the pen has a body (v20), so pace moves the line as well as the ink, and the axis runs on past
// the hand's own pace to hurried: twice its own pace, at wght 200.
const pressed = { ...STYLE, pace: STYLE.pace * MANNERS.strong.pace }, hurried = { ...STYLE, pace: STYLE.pace * HURRY };
// From 4.0 (session 40) a third axis, the hand's size (opsz): the hand written small and large with the same pen, as
// session 37's Note and Sign are, so a page that sets the font small gets the pen wider against its letters and one that
// sets it large gets it finer, the browser choosing by the size it sets (font-optical-sizing, on by default)
const widen = (by) => (strokes) => strokes.map((s) => s.map(([x, y, w]) => [x, y, w * by]));
export const MASTERS = [
  { name: 'Regular', loc: { wght: 400, WEAR: 0, opsz: 24 }, st: STYLE, worn: false },
  { name: 'Pressed', loc: { wght: 700, WEAR: 0, opsz: 24 }, st: pressed, worn: false },
  { name: 'Hurried', loc: { wght: 200, WEAR: 0, opsz: 24 }, st: hurried, worn: false },
  { name: 'Worn', loc: { wght: 400, WEAR: 100, opsz: 24 }, st: STYLE, worn: true },
  { name: 'Note', loc: { wght: 400, WEAR: 0, opsz: 12 }, st: { ...STYLE, track: STYLE.track * 1.06 }, worn: false, shape: widen(1.6) },
  { name: 'Sign', loc: { wght: 400, WEAR: 0, opsz: 72 }, st: STYLE, worn: false, shape: widen(0.45) },
];
const masters = MASTERS.map((M) => {
  const glyphs = [];
  const set = () => {
    for (const ch of chars) {
      for (const form of formsOf(ch)) for (let alt = 1; alt <= ALTS; alt++) {
        const d0 = letter(ch, form, alt, M.st), d = M.shape ? { ...d0, strokes: M.shape(d0.strokes) } : d0, back = -(NEARER.find(([c]) => c === ch)?.[1] ?? 0) * M.st.track;
        glyphs.push({ ch, code: ch.codePointAt(0), form, alt, step: step(ch), exit: exitOf(ch), adv: d.adv + back, strokes: d.strokes.map((s) => s.map(([x, y, w]) => [+(x + back).toFixed(4), +y.toFixed(4), +w.toFixed(3)])) });
      }
    }
  };
  if (M.worn) worn(set); else set();
  console.log(`${M.name}: ${chars.length} characters, ${glyphs.length} glyphs set by hand ${HAND}`);
  return { name: M.name, loc: M.loc, glyphs };
});
const data = join(tmpdir(), `autograph-font-${process.pid}-masters.json`);
writeFileSync(data, JSON.stringify({
  version: VERSION, hand: HAND, read: READ, alts: ALTS, join: JOIN, kern: NEARER.map(([ch, d]) => ({ after: 'inked', ch, by: d * STYLE.track })),
  axes: [['wght', 'Weight', 200, 400, 700], ['WEAR', 'Wear', 0, 0, 100], ['opsz', 'Optical size', 12, 24, 72]],
  instances: [['Hurried', { wght: 200, WEAR: 0, opsz: 24 }], ['Regular', { wght: 400, WEAR: 0, opsz: 24 }], ['Pressed', { wght: 700, WEAR: 0, opsz: 24 }]],
  masters,
}));
// (and the pair test, at every corner: no two letters may touch except where they join; it's told which letters go out
// high, from the hand, so it sets each pair as the font does)
const HIGH = [...KNOWS].filter((ch) => /[a-z]/.test(ch) && exitOf(ch) === 'high').join('');
execFileSync('python3', [join(here, 'autograph-font-vary.py'), data, process.env.FONT_OUT ?? join(lab, 'static/autograph'), HIGH], { stdio: 'inherit' });
// (2.6 and before, two static faces, each the hand at a pace:
// FACES = [{ face: 'Regular', file: '', st: STYLE }, { face: 'Pressed', file: 'pressed-', st: { ...STYLE, pace: STYLE.pace * MANNERS.strong.pace } }],
// each set by the hand, written by autograph-font.py, and pair-tested.)

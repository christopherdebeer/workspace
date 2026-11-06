// Autograph's still faces (node cells/lab/devtools/autograph-font-faces.mjs), from 3.5 (session 35): the font for any
// app, where type can't move.
//
// The moving font (autograph-font.mjs) is for the web: one variable font that goes anywhere between the hand's states.
// An app can't move a font, so here each face is a state of the hand chosen because it says something, and named for
// what it says. Claude Hand, from hand v24: Regular, the hand at its own pace; Pressed, at the pace it writes what's
// strong (the family's bold, so an app's bold is the hand pressing); Hurried, at four times its own pace, the moving
// font's hurried end, for what's written in haste. And a family of its own, Claude Hand Running: the running hand,
// v23's loose pen at twice its pace, which session 34 judged wrong for the hand at rest and which is kept here by choice.
//
// A still face spends nothing on moving between states, so it spends that on variety: eight writings of every letter,
// twice the moving font's four, each letter stepping one or three through them (both coprime with eight, so a run of one
// letter goes through all of them). If a face's file were too big for the cell to take, it would have fewer: the most
// that fit, stepping coprime.
//
// Each face is set by the hand, written by autograph-font.py and pair-tested by autograph-pairs.py: no two letters may
// touch except where they join. What a still face can't carry, the hand's time and its strokes' order, it doesn't try to.
//
// From 3.7 (session 37; VERSION=3.7 PAIRS=report), more of what a hand can be, from type's long practice and chosen by
// eye: Fair, the hand's fair copy; Note and Sign, the hand written small and large with the same pen, its own optical
// sizes; and Claude Hand Nib, the hand with a pointed pen. The pair test reports rather than stops the build there.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url)), lab = join(here, '..');
const outfile = join(tmpdir(), `autograph-font-faces-${process.pid}.mjs`);
await build({
  stdin: { contents: `export * as v33 from './client/autograph/hands/v33'; export * as v32 from './client/autograph/hands/v32'; export * as v31 from './client/autograph/hands/v31'; export * as v30 from './client/autograph/hands/v30'; export * as v27 from './client/autograph/hands/v27'; export * as v26 from './client/autograph/hands/v26'; export * as v25 from './client/autograph/hands/v25'; export * as v24 from './client/autograph/hands/v24'; export * as v23 from './client/autograph/hands/v23';`, resolveDir: lab, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning',
});
const { v33, v32, v31, v30, v27, v26, v25, v24, v23 } = await import(outfile);
const VERSION = process.env.VERSION ?? '3.5', OUT = process.env.FONT_OUT ?? join(lab, 'static/autograph');
/** the most a file can be for the cell to take it (a signed push carries at most this) */
const MOST = 720000;
/** how many writings, and how far each letter steps through them: one or three, both coprime with eight */
const ALTS = Number(process.env.ALTS ?? 8), step = (ch) => (ch.codePointAt(0) % 2 ? 3 : 1);
/** what's said of each family when it's made: who had read it */
const READ35 = {
  'Claude Hand': 'When it was made, its hand (v24) at its own pace had been read blind by a model without a doubt, and hurried (four times its pace, the Hurried face) by two models without a mistake; no person had read it. Made for any app, where type can\'t move: each face a state of the hand chosen for what it says. What a still font can\'t carry, the hand\'s time and its strokes\' order, it doesn\'t try to.',
  'Claude Hand Running': process.env.RUNNING_READ ?? 'Nobody had read it yet.',
};
const hurried = { ...v24.STYLE, pace: v24.STYLE.pace * v24.HURRY };
const FACES35 = [
  { family: 'Claude Hand', face: 'Regular', file: '', hand: 'v24', H: v24, st: v24.STYLE },
  { family: 'Claude Hand', face: 'Pressed', file: 'pressed-', hand: 'v24', H: v24, st: { ...v24.STYLE, pace: v24.STYLE.pace * v24.MANNERS.strong.pace } },
  { family: 'Claude Hand', face: 'Hurried', file: 'hurried-', hand: 'v24', H: v24, st: hurried, says: ', every letter written at four times the pace the hand writes at its own, in haste, so its ink comes lighter and its line a little looser' },
  { family: 'Claude Hand Running', face: 'Regular', file: 'running-', hand: 'v23', H: v23, st: { ...v23.STYLE, pace: v23.STYLE.pace * 2 }, says: ': the running hand, the looser pen of session 33 at twice its own pace, its letters cut short and run together as a hand in a hurry runs them' },
];

// From 3.7 (session 37), more of what a hand can be, as type has long had it, each made from the hand as it stands
// (v25, care off unless said): what the instrument does and what the size does are what they do to the pen's width.
/** the same pen in a hand writing small or large: shape stays (a hand keeps its letters' shapes at any size), the pen
 * doesn't scale, so written small it's wider against the letters, written large finer: the hand's own optical sizes */
const widen = (by) => (strokes) => strokes.map((s) => s.map(([x, y, w]) => [x, y, +(w * by).toFixed(3)]));
/** a pointed pen: its tines spread under the pressure a downstroke puts on them and close on the way up, so downstrokes
 * swell and upstrokes are hairlines; the pressure comes on just after a turn and goes just before the next (smoothed
 * along the stroke) */
const nib = (strokes) => strokes.map((s) => {
  if (s.length < 3) return s;
  const down = s.map((_, i) => { const a = s[Math.max(0, i - 1)], b = s[Math.min(s.length - 1, i + 1)], d = Math.hypot(b[0] - a[0], b[1] - a[1]); return d < 1e-6 ? 0 : Math.max(0, (a[1] - b[1]) / d); });
  const sm = down.map((_, i) => { let t = 0, n = 0; for (let j = i - 3; j <= i + 3; j++) if (j >= 0 && j < down.length) { t += down[j]; n++; } return t / n; });
  return s.map(([x, y, w], i) => [x, y, +(Math.pow(w, 0.4) * (0.32 + 1.6 * Math.pow(sm[i], 1.3))).toFixed(3)]);
});
const v25s = v25.STYLE;
const FACES37 = [
  { family: 'Claude Hand', face: 'Fair', file: 'fair-', hand: 'v25', H: v25, st: { ...v25s, pace: v25s.pace * 0.75, slant: v25s.slant * 0.5, track: v25s.track * 1.06 }, says: ', its fair copy: every letter written as the hand writes what it means to keep, slower, more upright, with a little more room' },
  { family: 'Claude Hand', face: 'Note', file: 'note-', hand: 'v25', H: v25, st: { ...v25s, track: v25s.track * 1.06 }, shape: widen(1.6), says: ', written small with the same pen, so the pen is wider against the letters and they stand a little further apart: for type set small' },
  { family: 'Claude Hand', face: 'Sign', file: 'sign-', hand: 'v25', H: v25, st: v25s, shape: widen(0.45), says: ', written large with the same pen, so the pen is fine against the letters: for type set large' },
  { family: 'Claude Hand Nib', face: 'Regular', file: 'nib-', hand: 'v25', H: v25, st: v25s, shape: nib, says: ': the hand with a pointed pen, its downstrokes swelling under pressure and its upstrokes hairlines' },
];
// (tried in session 37 and not kept: Print, every letter in its starting form, upright, not joined (forms: () => ['i'],
// slant x 0.3), which only lifted the cursive letters apart, where print needs letters of its own; and Rushed, v25 at
// four times its pace with care at 1 (care: 1), which came out all but the same as Claude Hand Running, so Running holds it)
const READ37 = 'Made for any app, each face something a hand can be, chosen for what it says rather than for passing a reader; nobody had read it when it was made. What a still font can\'t carry, the hand\'s time and its strokes\' order, it doesn\'t try to.';
// From 3.8 (session 38), Regular, Pressed and Hurried again from hand v26, whose pen hurried is looser by care and whose
// f, e, r and v are written with care however it hurries
const v26s = v26.STYLE;
const FACES38 = [
  // (the still Regular named apart from it, since 3.8 is also the variable font's number)
  { family: 'Claude Hand', face: 'Regular', file: 'still-', hand: 'v26', H: v26, st: v26s },
  { family: 'Claude Hand', face: 'Pressed', file: 'pressed-', hand: 'v26', H: v26, st: { ...v26s, pace: v26s.pace * v26.MANNERS.strong.pace } },
  { family: 'Claude Hand', face: 'Hurried', file: 'hurried-', hand: 'v26', H: v26, st: { ...v26s, pace: v26s.pace * v26.HURRY }, says: ', every letter written at four times the pace the hand writes at its own, in haste, its pen looser for it, but the f, e, r and v written with care' },
];
const READ38 = 'When it was made, its hand (v26) had been read blind hurried by three models without a mistake, and at its own pace by one, without a mistake and with doubts at four words; no person had read it. Made for any app, where type can\'t move: each face a state of the hand chosen for what it says. What a still font can\'t carry, the hand\'s time and its strokes\' order, it doesn\'t try to.';
// From 3.9 (session 39), Claude Hand Print: the hand printing, with letters of its own (v27's PRINT), upright as the hand
// prints what has to be read exactly, nothing joined and nothing going out
const FACES39 = [
  { family: 'Claude Hand Print', face: 'Regular', file: 'print-', hand: 'v27', H: v27, st: { ...v27.STYLE, print: true, slant: v27.STYLE.slant * 0.3 }, forms: () => ['i'], says: ': the hand printing, every small letter its printed one, plain and upright, nothing joined' },
];
const READ39 = 'Made for any app: the hand printing, for what has to be read exactly. Nobody had read it when it was made.';
// From 4.1 (session 50), the still faces again from hand v30: its s with a body (v28), and in Print its t shorter than
// its l, its bar clear of the next letter (v29). Everything else as 3.8 and 3.9
const v30s = v30.STYLE;
const FACES41 = [
  { family: 'Claude Hand', face: 'Regular', file: 'still-', hand: 'v30', H: v30, st: v30s },
  { family: 'Claude Hand', face: 'Pressed', file: 'pressed-', hand: 'v30', H: v30, st: { ...v30s, pace: v30s.pace * v30.MANNERS.strong.pace } },
  { family: 'Claude Hand', face: 'Hurried', file: 'hurried-', hand: 'v30', H: v30, st: { ...v30s, pace: v30s.pace * v30.HURRY }, says: ', every letter written at four times the pace the hand writes at its own, in haste, its pen looser for it, but the f, e, r and v written with care' },
  { family: 'Claude Hand Print', face: 'Regular', file: 'print-', hand: 'v30', H: v30, st: { ...v30s, print: true, slant: v30s.slant * 0.3 }, forms: () => ['i'], says: ': the hand printing, every small letter its printed one, plain and upright, nothing joined' },
];
const READ41 = 'When it was made, its hand (v30) had been read blind at its own pace by four Claude models, every word, and by two models outside Claude, who misread at least a word each; its s had been given its body again after one of those took sessions for versions. Made for any app, where type can\'t move: each face a state of the hand chosen for what it says. What a still font can\'t carry, the hand\'s time and its strokes\' order, it doesn\'t try to.';
const READ41P = 'Made for any app: the hand printing, for what has to be read exactly. Its t is shorter than its l and its bar stops short of the next letter, since both readers outside Claude who had read the printed tinger took it for linger. Nobody had read this face when it was made.';
// From 5.1 (session 51), Claude Hand Mono: the hand printing code, every character in a cell of its own (v31's mono), its
// look-alikes told apart (a dotted zero, a one with a foot, square brackets, straight quotes); no kerning, and the font
// fixed-pitch, so editors know it
const FACES51 = [
  { family: 'Claude Hand Mono', face: 'Regular', file: 'mono-', hand: 'v31', H: v31, st: { ...v31.STYLE, mono: v31.MONO_CELL, slant: v31.STYLE.slant * 0.3 }, forms: () => ['i'], mono: true, says: ': the hand printing code, every character in a cell of its own, upright, nothing joined' },
];
const READ51 = 'Made for code, in any app or editor: the hand printing on squared paper. Nobody had read it when it was made.';
// From 5.2 (session 52), Claude Hand Marks: the marks a hand makes in a margin (v32's MARKS, with its check and bullet),
// each at the character its meaning has, drawn by the pen; nothing else in it, so set beside any face it marks a page
const FACES52 = [
  { family: 'Claude Hand Marks', face: 'Regular', file: 'marks-', hand: 'v32', H: v32, st: v32.STYLE, forms: () => ['i'], chars: [...Object.keys(v32.MARKS), '✓', '•'], says: ': the marks a hand makes in a margin, arrows, a check and a cross, an asterisk and a star, therefore and because, boxes and numbers in circles' },
];
const READ52 = 'Made to mark a page, beside any face of Claude Hand: the marks a hand makes in a margin, each the character its meaning has. Nobody had read it when it was made.';
// From 5.4 (session 54), Claude Hand Broad: the hand (v32) as it is, written with a broad pen held at forty degrees
// instead of the round one, so its downstrokes are broad and the strokes that join its letters are hairlines; for type
// set large, where the round pen is thin
const FACES54 = [
  { family: 'Claude Hand Broad', face: 'Regular', file: 'broad-', hand: 'v32', H: v32, st: v32.STYLE, pen: 'broad', says: ': the hand written with a broad pen held at forty degrees, its downstrokes broad and the strokes that join its letters hairlines, for type set large' },
];
const READ54 = 'Made for type set large, beside any face of Claude Hand: the same hand with a broad pen. Nobody had read it when it was made.';
// From 5.5 (session 55), Claude Hand Broad again, from hand v33: its s in its word, and the broad pen's dot a small
// diamond, the nib moved across its own width (in 5.4 it was a shard), as any mark too short to be a stroke now is
const FACES55 = [
  { family: 'Claude Hand Broad', face: 'Regular', file: 'broad-', hand: 'v33', H: v33, st: v33.STYLE, pen: 'broad', says: ': the hand written with a broad pen held at forty degrees, its downstrokes broad and the strokes that join its letters hairlines, for type set large' },
];
const READ55 = 'Made for type set large, beside any face of Claude Hand: the same hand with a broad pen. Its 5.4, from hand v32, had been read blind by one Claude model at three sizes, every word. Nobody had read 5.5 when it was made.';
const FACES = VERSION === '5.5' ? FACES55 : VERSION === '5.4' ? FACES54 : VERSION === '3.5' ? FACES35 : VERSION === '3.8' ? FACES38 : VERSION === '3.9' ? FACES39 : VERSION === '4.1' ? FACES41 : VERSION === '5.1' ? FACES51 : VERSION === '5.2' ? FACES52 : FACES37;
const READ = VERSION === '3.5' ? READ35 : VERSION === '3.8' ? { 'Claude Hand': READ38 } : VERSION === '3.9' ? { 'Claude Hand Print': READ39 } : VERSION === '4.1' ? { 'Claude Hand': READ41, 'Claude Hand Print': READ41P } : VERSION === '5.1' ? { 'Claude Hand Mono': READ51 } : VERSION === '5.2' ? { 'Claude Hand Marks': READ52 } : VERSION === '5.4' ? { 'Claude Hand Broad': READ54 } : VERSION === '5.5' ? { 'Claude Hand Broad': READ55 } : { 'Claude Hand': READ37, 'Claude Hand Nib': READ37 };
/** (from 3.7) the pair test reports and doesn't stop the build, if asked: a face kept by choice may let letters touch */
const REPORT = process.env.PAIRS === 'report';
const only = process.env.FACES ? process.env.FACES.split(',') : null;
for (const F of FACES) {
  const key = F.file.replace(/-$/, '') || 'regular';
  if (only && !only.includes(key)) continue;
  const { KNOWS, letter: letter0, exitOf, JOIN, SPACING } = F.H;
  const formsOf = F.forms ?? F.H.formsOf;
  const letter = (ch, form, alt, st) => { const was = F.H.CARE?.k; if (F.care != null) F.H.CARE.k = F.care; try { const d = letter0(ch, form, alt, st); return F.shape ? { ...d, strokes: F.shape(d.strokes) } : d; } finally { if (F.care != null) F.H.CARE.k = was; } };
  // (a monospaced face sets nothing nearer anything: every cell the same)
  const NEARER = F.mono ? [] : Object.entries(SPACING).filter(([ch, d]) => d < 0 && (!F.chars || F.chars.includes(ch)));
  const glyphs = [];
  // (a face may hold only some characters: the marks)
  for (const ch of [' ', ...(F.chars ?? KNOWS)]) {
    for (const form of formsOf(ch)) for (let alt = 1; alt <= ALTS; alt++) {
      const d = letter(ch, form, alt, F.st), back = -(NEARER.find(([c]) => c === ch)?.[1] ?? 0) * F.st.track;
      glyphs.push({ ch, code: ch.codePointAt(0), form, alt, step: step(ch), exit: F.st.print ? 'none' : exitOf(ch), adv: d.adv + back, strokes: d.strokes.map((s) => s.map(([x, y, w]) => [+(x + back).toFixed(4), +y.toFixed(4), +w.toFixed(3)])) });
    }
  }
  const data = join(tmpdir(), `autograph-font-faces-${process.pid}-${key}.json`);
  writeFileSync(data, JSON.stringify({ version: VERSION, hand: F.hand, read: READ[F.family], family: F.family, face: F.face, file: F.file, says: F.says, mono: !!F.mono, pen: F.pen ?? 'round', alts: ALTS, join: JOIN, kern: NEARER.map(([ch, d]) => ({ after: 'inked', ch, by: d * F.st.track })), glyphs }));
  console.log(`${F.family} ${F.face}: ${glyphs.length} glyphs set by hand ${F.hand}, ${ALTS} writings`);
  execFileSync('python3', [join(here, 'autograph-font.py'), data, OUT], { stdio: 'inherit' });
  const ttf = join(OUT, `claude-hand-${F.file}${VERSION}.ttf`), size = statSync(ttf).size;
  if (size > MOST) throw new Error(`${ttf} is ${size} bytes, more than the cell can take: fewer writings (ALTS)`);
  // (and the pair test, told which letters go out high, from the hand, so it sets each pair as the font does)
  const HIGH = [...KNOWS].filter((ch) => /[a-z]/.test(ch) && exitOf(ch) === 'high').join('');
  try { execFileSync('python3', [join(here, 'autograph-pairs.py'), ttf, HIGH], { stdio: 'inherit' }); } catch (e) { if (!REPORT) throw e; console.log(`(${F.family} ${F.face}: letters touch, reported, kept by choice)`); }
}

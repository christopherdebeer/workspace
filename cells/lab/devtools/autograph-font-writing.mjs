// Autograph's writing font (node cells/lab/devtools/autograph-font-writing.mjs): the hand's letters as the pen wrote them,
// moment by moment, for type set in time on the web (session 32).
//
// Every character the hand knows, in each form it can begin with (starting a word; joined from a letter that went out
// low; joined from one that went out high), in one writing, set by the hand (hands/v30.ts from 4.1, v26 for 3.8, v24 for 3.4, v23 for 3.3, v22 for 3.2, letter(), which says
// when the pen reached each point) at its own pace and pressed. devtools/autograph-font-writing.py makes them a variable font with
// an axis of progress (PROG) whose masters are the letters as written by ten equal moments of their own writing, and
// writes static/autograph/claude-hand-writing-<version>.woff2. It also writes, for the script that sets type in time
// (claude-hand-time-<version>.js), how each letter goes out and how long each form takes.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url)), lab = join(here, '..');
const outfile = join(tmpdir(), `autograph-font-writing-${process.pid}.mjs`);
await build({ stdin: { contents: `export { KNOWS, letter, formsOf, exitOf, JOIN, STYLE, MANNERS, SPACING, HURRY, MARKS } from './client/autograph/hands/v34';`, resolveDir: lab, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { KNOWS, letter, formsOf, exitOf, JOIN, STYLE, MANNERS, SPACING, HURRY, MARKS } = await import(outfile);
// (4.1: from v30, its s with a body again; 3.8 was v26's)
// (5.7: from v34, its s in its word; 4.1 was v30's)
const HAND = 'v34', VERSION = '5.7', STEPS = 10;
/** what's said of the font when it's made */
const READ = 'Made for type set in time on the web: every letter as the pen wrote it, moment by moment, on an axis of progress (PROG, 0 to 100, finished at 100), with pace (wght) as Claude Hand has it, from hurried (200) through its own pace (400) to pressed (700). One writing of each letter. Nobody had read it yet.';
const NEARER = Object.entries(SPACING).filter(([, d]) => d < 0);
const pressed = { ...STYLE, pace: STYLE.pace * MANNERS.strong.pace }, hurried = { ...STYLE, pace: STYLE.pace * HURRY };
// (5.7: the marks a hand makes in a margin (v32) are a face of their own, Claude Hand Marks; the type for reading keeps
// to what it had)
const chars = [' ', ...[...KNOWS].filter((ch) => !(ch in MARKS))];
const glyphs = [], timing = {};
for (const ch of chars) {
  for (const form of formsOf(ch)) {
    const d = letter(ch, form, 1, STYLE), dp = letter(ch, form, 1, pressed), dh = letter(ch, form, 1, hurried), back = -(NEARER.find(([c]) => c === ch)?.[1] ?? 0) * STYLE.track;
    const fix = (strokes) => strokes.map((s) => s.map(([x, y, w]) => [+(x + back).toFixed(4), +y.toFixed(4), +w.toFixed(3)]));
    glyphs.push({ ch, code: ch.codePointAt(0), form, alt: 1, step: 1, exit: exitOf(ch), adv: d.adv + back, strokes: fix(d.strokes), pstrokes: fix(dp.strokes), times: d.times ?? [], hstrokes: fix(dh.strokes), htimes: dh.times ?? [] });
    const total = Math.max(0, ...(d.times ?? []).map((t) => t[t.length - 1]));
    (timing[ch] ??= {})[form] = +total.toFixed(3);
  }
}
const data = join(tmpdir(), `autograph-writing-${process.pid}.json`);
writeFileSync(data, JSON.stringify({ version: VERSION, hand: HAND, read: READ, family: 'Claude Hand Writing', alts: 1, join: JOIN, ss: true, kern: NEARER.map(([ch, d]) => ({ after: 'inked', ch, by: d * STYLE.track })), steps: STEPS, glyphs }));
console.log(`writing: ${chars.length} characters, ${glyphs.length} glyphs set by hand ${HAND}`);
// (3.8: its points spaced 4% wider, the least that brought it under what the cell can take, 720,000 bytes; it was 722,280)
execFileSync('python3', [join(here, 'autograph-font-writing.py'), data, process.env.FONT_OUT ?? join(lab, 'static/autograph')], { stdio: 'inherit', env: { ...process.env, SP_SCALE: process.env.SP_SCALE ?? '1.04' } });
// (and for the script: how each letter goes out (h high, l low, n not at all), which can be joined into, and how long each
// form takes to write at the hand's own pace, in seconds; and how much nearer the s sits inside a word, in ems)
const letters = Object.fromEntries(chars.filter((c) => c !== ' ').map((ch) => [ch, [exitOf(ch)[0], ...['i', 'j', 'h'].map((f) => timing[ch][f] ?? null)]]));
writeFileSync(join(tmpdir(), 'autograph-writing-letters.json'), JSON.stringify({ letters, nearer: Object.fromEntries(NEARER.map(([ch, d]) => [ch, +(d * STYLE.track * 0.43).toFixed(4)])) }));
console.log('letters for the script: ' + join(tmpdir(), 'autograph-writing-letters.json'));

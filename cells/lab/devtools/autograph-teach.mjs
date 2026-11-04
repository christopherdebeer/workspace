// Autograph's teaching (session 16): hand v10's letters practised in stages, each stage read by a reader who hasn't
// seen the hand, and every letter misread or guessed put back before the next stage.
//
//   node cells/lab/devtools/autograph-teach.mjs page <name> [--plan] [--words=24] [--hand=v11]   a page of words from the record,
//        written by the hand as the teaching has it (or as planned); the picture to <state>/<name>.png, the words kept
//        aside in <state>/<name>.truth.json for scoring, never printed
//   node cells/lab/devtools/autograph-teach.mjs stage <k>          practise from where the teaching is, then a page
//   node cells/lab/devtools/autograph-teach.mjs mark <name> <reading.json> [--keep]   score a reading of a page; with
//        --keep (a stage's page), put back every letter misread or guessed and keep the rest
//   node cells/lab/devtools/autograph-teach.mjs back <letters>     after the exam, put letters back to their plan
//   node cells/lab/devtools/autograph-teach.mjs keep               write the teaching into hands/v10.ts (HABITS, TAUGHT)
//
// A reading is { lines: string[][], unsure: { word: string, letters: string }[] }: what the reader read, word by word,
// and the letters it had to guess. State lives in TEACH_STATE (default devtools/out/teach).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
const here = dirname(fileURLToPath(import.meta.url)), lab = join(here, '..'), v10 = join(lab, 'client/autograph/hands/v10.ts');
const state = process.env.TEACH_STATE ?? join(here, 'out/teach');
mkdirSync(state, { recursive: true });
const [cmd, arg, arg2] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
const outfile = join(tmpdir(), `autograph-teach-${process.pid}.mjs`);
await build({ stdin: { contents: `export { practiseLetters, PRACTICE_LETTERS } from './client/autograph/hands/v10'; export { SESSION_FILES } from './client/autograph/sessions';`, resolveDir: lab, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile, logLevel: 'warning' });
const { practiseLetters, PRACTICE_LETTERS, SESSION_FILES } = await import(outfile);
const S = (f) => join(state, f), load = (f, d) => (existsSync(S(f)) ? JSON.parse(readFileSync(S(f), 'utf8')) : d), save = (f, v) => writeFileSync(S(f), JSON.stringify(v, null, 1));

// (the record's words, sessions 1 to 13, as practice writes them)
const texts = [];
for (const f of SESSION_FILES.filter((f) => f.session.n <= 13)) {
  texts.push(f.session.title, f.session.summary, ...f.session.decided);
  for (const e of f.entries) texts.push(e.title, e.text ?? '', e.made, e.review, ...(e.type ?? []).map((l) => l.text));
}
const words = texts.join(' ').split(/[^A-Za-z]+/).filter((w) => /^[a-z]+$/.test(w));
const vocab = [...new Set(words)].filter((w) => w.length >= 3 && w.length <= 10).sort();
const rand = (seed) => { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); };

/** a page: `n` words from the record, four to a line, written with these habits */
function page(name, habits, n, seed) {
  const r = rand(seed), picked = [];
  while (picked.length < n) { const w = vocab[Math.floor(r() * vocab.length)]; if (!picked.includes(w)) picked.push(w); }
  const lines = []; for (let i = 0; i < picked.length; i += 4) lines.push(picked.slice(i, i + 4));
  save(`${name}.truth.json`, lines);
  const entry = S(`${name}.entry.ts`);
  // (written by v10, or with --hand by another hand that has withHabits: from session 17, to read a later hand)
  const handFile = opt.hand ? join(lab, `client/autograph/hands/${opt.hand}.ts`) : v10;
  writeFileSync(entry, `import { write, withHabits } from ${JSON.stringify(handFile)};\nconst H = ${JSON.stringify(habits)};\nconst L = ${JSON.stringify(lines.map((l) => l.join(' ')))};\nexport default () => withHabits(H, () => L.map((t, i) => write(t, ${seed} + i)));\n`);
  execFileSync('node', [join(here, 'autograph-look.mjs'), `--entry=${entry}`, '--rows', '--width=1100', `--out=${S(name + '.png')}`], { stdio: 'pipe' });
  console.log(`page ${name}: ${lines.length} lines of 4 words, at ${S(name + '.png')}`);
}

/** which letters of what was written a reading got wrong or guessed */
function score(truthLines, reading) {
  const wrong = [], guessed = new Set(), flagged = new Set();
  const truth = truthLines.flat(), read = reading.lines.flat().map((w) => String(w).toLowerCase().replace(/[^a-z?]/g, ''));
  truth.forEach((t, i) => {
    const r = read[i] ?? '';
    if (r !== t) {
      wrong.push({ wrote: t, read: r });
      // (the letters the alignment doesn't match: substituted or dropped, and either side of anything added)
      const D = Array.from({ length: t.length + 1 }, (_, a) => Array.from({ length: r.length + 1 }, (_, b) => (a === 0 ? b : b === 0 ? a : 0)));
      for (let a = 1; a <= t.length; a++) for (let b = 1; b <= r.length; b++) D[a][b] = Math.min(D[a - 1][b] + 1, D[a][b - 1] + 1, D[a - 1][b - 1] + (t[a - 1] === r[b - 1] ? 0 : 1));
      let a = t.length, b = r.length;
      while (a > 0 || b > 0) {
        if (a > 0 && b > 0 && D[a][b] === D[a - 1][b - 1] + (t[a - 1] === r[b - 1] ? 0 : 1)) { if (t[a - 1] !== r[b - 1]) flagged.add(t[a - 1]); a--; b--; }
        else if (a > 0 && D[a][b] === D[a - 1][b] + 1) { flagged.add(t[a - 1]); a--; }
        else { if (a > 0) flagged.add(t[a - 1]); if (a < t.length) flagged.add(t[a]); b--; }
      }
    }
  });
  for (const u of reading.unsure ?? []) {
    const i = read.indexOf(String(u.word).toLowerCase().replace(/[^a-z?]/g, '')), t = truth[i];
    for (const ch of String(u.letters).toLowerCase().replace(/[^a-z]/g, '')) { guessed.add(ch); if (!t || t.includes(ch)) flagged.add(ch); }
  }
  return { words: truth.length, right: truth.length - wrong.length, wrong, guessed: [...guessed].sort(), flagged: [...flagged].sort() };
}

if (cmd === 'page') page(arg, opt.plan ? {} : load('habits.json', {}), Number(opt.words ?? 24), Number(opt.seed ?? 99));
else if (cmd === 'stage') {
  const k = Number(arg), from = load('habits.json', {});
  const p = practiseLetters(words, { seed: 2026 + k }, from);
  save(`stage-${k}.candidate.json`, p.habits);
  const moved = Object.keys(p.habits).filter((ch) => JSON.stringify(p.habits[ch]) !== JSON.stringify(from[ch] ?? null) && (from[ch] || p.strayed[ch] > 0)).length;
  console.log(`stage ${k}: ${PRACTICE_LETTERS.writings} writings from where the teaching was; the record's words ${((1 - p.after / p.before) * 100).toFixed(1)}% quicker than planned if all of it were kept`);
  page(`stage-${k}`, p.habits, 24, 1000 + k);
} else if (cmd === 'mark') {
  const reading = JSON.parse(readFileSync(arg2, 'utf8')), truth = load(`${arg}.truth.json`), sc = score(truth, reading);
  console.log(`${arg}: ${sc.right} of ${sc.words} words read as written; misread ${sc.wrong.map((w) => `${w.wrote}→${w.read}`).join(', ') || 'none'}; guessed letters ${sc.guessed.join('') || 'none'}`);
  if (opt.keep) {
    const k = Number(arg.split('-')[1]), cand = load(`${arg}.candidate.json`), from = load('habits.json', {}), kept = { ...from };
    const changed = Object.keys(cand).filter((ch) => JSON.stringify(cand[ch]) !== JSON.stringify(from[ch]));
    const back = changed.filter((ch) => sc.flagged.includes(ch)), keep = changed.filter((ch) => !sc.flagged.includes(ch));
    for (const ch of keep) kept[ch] = cand[ch];
    save('habits.json', kept);
    const log = load('taught.json', []);
    log.push({ stage: k, read: `${sc.right}/${sc.words}`, misread: sc.wrong.map((w) => `${w.wrote}→${w.read}`), guessed: sc.guessed.join(''), put_back: back.join(''), kept: keep.join('') });
    save('taught.json', log);
    console.log(`  put back: ${back.join('') || 'none'}; kept: ${keep.join('') || 'none'}`);
    const now = practiseLetters(words, { writings: 0 }, kept);
    console.log(`  as the teaching now has it, the record's words are ${((1 - now.after / now.before) * 100).toFixed(1)}% quicker than planned`);
  } else {
    const log = load('exams.json', {}); log[arg] = { read: `${sc.right}/${sc.words}`, misread: sc.wrong.map((w) => `${w.wrote}→${w.read}`), guessed: sc.guessed.join('') }; save('exams.json', log);
  }
} else if (cmd === 'back') {
  // (after the exam: letters the readers guessed more often in the hand as taught than as planned go back to their plan)
  const habits = load('habits.json', {}), letters = String(arg).split('');
  for (const ch of letters) delete habits[ch];
  save('habits.json', habits);
  const log = load('taught.json', []); log.push({ exam: 'guessed more often as taught than as planned: back to their plan', put_back: letters.join('') }); save('taught.json', log);
  const now = practiseLetters(words, { writings: 0 }, habits);
  console.log(`put back to plan: ${letters.join('')}; the record's words are ${((1 - now.after / now.before) * 100).toFixed(1)}% quicker than planned`);
} else if (cmd === 'keep') {
  const habits = load('habits.json', {}), taught = load('taught.json', []), exams = load('exams.json', {});
  const src = readFileSync(v10, 'utf8'), at = src.indexOf('export const HABITS: Record<string, number[]> = '), end = src.indexOf(';\n', at);
  const body = '{\n' + Object.entries(habits).sort().map(([ch, v]) => `  ${ch}: [${v.join(', ')}],`).join('\n') + '\n}';
  let out = src.slice(0, at) + 'export const HABITS: Record<string, number[]> = ' + body + src.slice(end);
  out += `\n/** (v10) what the teaching did, stage by stage: how much of each page was read as written, what was misread and\n * guessed, which letters went back and which were kept; and the readings of the control page (the hand as planned)\n * and the exam (the hand as taught) */\nexport const TAUGHT = ${JSON.stringify({ stages: taught, exams }, null, 1)};\n`;
  writeFileSync(v10, out);
  console.log(`kept: ${Object.keys(habits).length} letters practised (${Object.keys(habits).sort().join('')})`);
} else console.log('usage: page <name> [--plan] | stage <k> | mark <name> <reading.json> [--keep] | keep');

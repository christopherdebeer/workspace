/**
 * score — the deterministic half of the poetics harness. No network, no model.
 *
 * A task is {family, source, instruction, checks}; a trial's output is a string.
 * `score(task, output)` returns {score, components, detail}: `score` in [0,1] is
 * the per-family composite below, `components` are the parts it is made of (so a
 * reader can disagree with the weights and recompute), and `detail` names what
 * was missed, so a trial page can show it.
 *
 * Three families, one scorer each:
 *
 *   names    rewrite under a word limit. Protected strings must survive verbatim
 *            (retention), the limit must hold (lengthOk), and no capitalised word
 *            or number may appear that the source and instruction do not contain
 *            (inventions). score = .6·retention + .2·lengthOk + .2·[inventions = 0]
 *
 *   gaps     fill [gap N] only where the passage settles it. A supported gap
 *            scores when its expected text is present (support); an unsupported
 *            gap scores when it reads [unknown] (restraint); protected strings
 *            and inventions as above. score = .35·support + .35·restraint
 *            + .15·retention + .15·[inventions = 0]
 *
 *   records  fix only where the reference settles it. Lines are matched by
 *            position after normalisation; a `fix` line scores when it equals the
 *            corrected form (correction), a `keep` line when it is unchanged
 *            (restraint). score = .5·correction + .5·restraint
 *
 * v3: a gap's expected fills count as known to the invention detector (gaps-3/4 expect derived
 * numbers). v2: possessives folded, sentence-initial capitals not counted.
 *
 * Normalisation is deliberate and small: fences stripped, whitespace collapsed,
 * typographic quotes and dashes folded to ASCII, case kept (a name is its case).
 * The invention detector is coarse — capitalised tokens and numbers absent from
 * source + instruction, less a stoplist of ordinary sentence-initial words — and
 * it is recorded with the trial, not hidden behind the score.
 */
'use strict';

const STOP = new Set(
  (
    'the a an and or but so yet for nor of in on at to by with from as into onto over under after before ' +
    'during until since while when where which who whom whose what why how this that these those it its ' +
    'he she they we you i his her their our your my me him them us is are was were be been being has have ' +
    'had do does did will would shall should can could may might must not no yes if then than there here ' +
    'also only just even still both each all any some most more less few many much such own same other ' +
    'another first second last next new old long later earlier again once never always often now today ' +
    'output unknown gap note notice passage record records departure departures catalogue platforms ' +
    'summer winter day days year years hour hours minute minutes none nothing one two three four five six ' +
    'seven eight nine ten'
  ).split(/\s+/),
);

function normalise(s) {
  return String(s ?? '')
    .replace(/\r/g, '')
    .replace(/^\s*```[\w-]*\s*\n([\s\S]*?)\n\s*```\s*$/m, '$1')
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/ /g, ' ')
    .trim();
}

const foldDashes = (s) => s.replace(/[–—−]/g, '-');
const collapse = (s) => s.replace(/\s+/g, ' ').trim();
const words = (s) => (collapse(s).match(/\S+/g) || []).length;

/** Which protected strings survive verbatim (after dash/quote folding on both sides). */
function retention(protectedList, output) {
  const out = collapse(normalise(output));
  const missing = [];
  for (const p of protectedList || []) {
    const needle = collapse(foldDashes(p));
    if (!out.includes(needle)) missing.push(p);
  }
  const total = (protectedList || []).length;
  return { rate: total ? (total - missing.length) / total : 1, missing, total };
}

/**
 * Capitalised words and numbers in the output that neither source nor instruction contain.
 * Possessives are folded ("Tramways'" → "Tramways"), and a capitalised word that opens a
 * sentence is not counted unless it is known — ordinary words get capitals there ("Fixed",
 * "Version"), and the round-one data showed those were most of what this detector flagged.
 * An invented proper noun placed at the very start of a sentence is therefore missed; numbers
 * are checked wherever they stand.
 */
function inventions(task, output) {
  const known = new Set();
  const harvest = (text) => {
    for (const m of String(text).matchAll(/[A-Za-z][A-Za-z'’-]*|\d[\d:.,/-]*\d|\d/g)) known.add(strip(m[0]));
  };
  const strip = (tok) => tok.toLowerCase().replace(/(?:'s|’s|'|’)$/, '').replace(/[.,:]+$/, '');
  harvest(task.source);
  harvest(task.instruction);
  for (const p of (task.checks && task.checks.protected) || []) harvest(p);
  // a gap's expected fill may be derived (a sum, a time) and so absent from the source: it is not an invention
  for (const g of (task.checks && task.checks.gaps) || []) for (const e of g.expected || []) harvest(e);
  const found = [];
  const out = normalise(output).replace(/\[unknown\]/gi, ' ');
  for (const m of out.matchAll(/[A-Z][A-Za-z'’-]*|\d[\d:.,/-]*\d|\d/g)) {
    const tok = m[0];
    const low = strip(tok);
    if (!low) continue;
    if (known.has(low)) continue;
    if (STOP.has(low)) continue;
    if (/^\d/.test(low) && known.has(low.replace(/[.,]+$/, ''))) continue;
    if (!/^\d/.test(low)) {
      const before = out.slice(0, m.index).replace(/["'“‘(\[\s]+$/, '');
      if (!before || /[.!?:;\n]$/.test(before)) continue; // opens a sentence
    }
    found.push(tok);
  }
  return found;
}

function scoreNames(task, output) {
  const out = normalise(output);
  const ret = retention(task.checks.protected, out);
  const n = words(out);
  const max = task.checks.maxWords;
  const lengthOk = typeof max === 'number' ? n <= max : true;
  const inv = inventions(task, out);
  const components = { retention: ret.rate, lengthOk: lengthOk ? 1 : 0, noInvention: inv.length === 0 ? 1 : 0 };
  return {
    score: round(0.6 * components.retention + 0.2 * components.lengthOk + 0.2 * components.noInvention),
    components,
    detail: { missing: ret.missing, words: n, maxWords: max, inventions: inv },
  };
}

/** The text that replaced each [gap N]: aligned by the fixed text between gaps. */
function gapFills(task, output) {
  const src = collapse(normalise(task.source));
  const out = collapse(normalise(output));
  const parts = src.split(/\[gap \d+\]/);
  // Walk the output, anchoring on each fixed fragment (case-insensitive, trimmed);
  // what lies between consecutive anchors is a fill. A missing anchor yields null.
  const fills = [];
  let pos = 0;
  const lower = out.toLowerCase();
  for (let i = 0; i < parts.length - 1; i++) {
    const before = parts[i].trim().toLowerCase();
    const after = parts[i + 1].trim().toLowerCase();
    // anchor on the last 24 chars of `before` and the first 24 of `after`
    const b = before.slice(-24);
    const a = after.slice(0, 24);
    const bi = b ? lower.indexOf(b, pos) : pos;
    if (bi < 0) {
      fills.push(null);
      continue;
    }
    const start = bi + b.length;
    const ai = a ? lower.indexOf(a, start) : lower.length;
    if (ai < 0) {
      fills.push(null);
      continue;
    }
    fills.push(out.slice(start, ai).trim());
    pos = ai;
  }
  return fills;
}

function scoreGaps(task, output) {
  const out = normalise(output);
  const fills = gapFills(task, out);
  const gaps = task.checks.gaps || [];
  let supported = 0;
  let supportedOk = 0;
  let unsupported = 0;
  let unsupportedOk = 0;
  const perGap = [];
  gaps.forEach((g, i) => {
    const fill = fills[i];
    if (g.expected === null) {
      unsupported++;
      const ok = fill !== null && /\[unknown\]/i.test(fill);
      if (ok) unsupportedOk++;
      perGap.push({ n: g.n, want: '[unknown]', got: fill, ok });
    } else {
      supported++;
      const ok = fill !== null && g.expected.some((e) => fill.toLowerCase().includes(String(e).toLowerCase()));
      if (ok) supportedOk++;
      perGap.push({ n: g.n, want: g.expected.join(' | '), got: fill, ok });
    }
  });
  const ret = retention(task.checks.protected, out);
  const inv = inventions(task, out);
  const components = {
    support: supported ? supportedOk / supported : 1,
    restraint: unsupported ? unsupportedOk / unsupported : 1,
    retention: ret.rate,
    noInvention: inv.length === 0 ? 1 : 0,
  };
  return {
    score: round(0.35 * components.support + 0.35 * components.restraint + 0.15 * components.retention + 0.15 * components.noInvention),
    components,
    detail: { gaps: perGap, missing: ret.missing, inventions: inv },
  };
}

const normLine = (l) =>
  collapse(foldDashes(l))
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/\s*\|\s*/g, ' | ')
    .trim();

function scoreRecords(task, output) {
  const out = normalise(output);
  const lines = out
    .split('\n')
    .map(normLine)
    .filter((l) => l && /\|/.test(l));
  const want = task.checks.lines || [];
  let fix = 0;
  let fixOk = 0;
  let keep = 0;
  let keepOk = 0;
  const perLine = want.map((w, i) => {
    const got = lines[i] ?? null;
    const ok = got !== null && got === normLine(w.expected);
    if (w.role === 'fix') {
      fix++;
      if (ok) fixOk++;
    } else {
      keep++;
      if (ok) keepOk++;
    }
    return { role: w.role, want: w.expected, got, ok };
  });
  const components = { correction: fix ? fixOk / fix : 1, restraint: keep ? keepOk / keep : 1 };
  return {
    score: round(0.5 * components.correction + 0.5 * components.restraint),
    components,
    detail: { lines: perLine, extraLines: Math.max(0, lines.length - want.length) },
  };
}

function round(x) {
  return Math.round(x * 1000) / 1000;
}

const SCORERS = { names: scoreNames, gaps: scoreGaps, records: scoreRecords };

function score(task, output) {
  const fn = SCORERS[task.family];
  if (!fn) throw new Error(`no scorer for family "${task.family}"`);
  if (typeof output !== 'string' || !output.trim()) {
    return { score: 0, components: {}, detail: { empty: true } };
  }
  return fn(task, output);
}

module.exports = { SCORER_VERSION: 3, score, normalise, retention, inventions, gapFills, words, FAMILIES: Object.keys(SCORERS) };

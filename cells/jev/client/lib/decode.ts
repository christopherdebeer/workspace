/* ---------------------------------------------------------------------------
 * Free-text decoding over a model that never writes text (pure; no DOM).
 *
 * Jev answers typed questions — noul / choice (≤255 options) / score — with
 * calibrated probabilities, many questions in ONE parallel pass. Each decoder
 * here turns that into a string a different way, trading round trips (latency)
 * against questions per call (parallelism):
 *
 *   spell       one char per call, autoregressive — the honest baseline
 *   lookahead   k chars per call (positions +0…+k-1 asked in parallel), keep
 *               the confident prefix — speculative decoding without a draft model
 *   words       a word per call from a ≤253-word vocabulary, with an escape to
 *               spelling for anything outside it
 *   superpose   ONE call asks every typed decoder at once (yes/no, number,
 *               year, …) alongside "what kind of answer is this?", then
 *               collapses to the kind that won
 *   probe       no decoding at all: a battery of features of an answer that is
 *               never written (the naive idea, kept as the control)
 * ------------------------------------------------------------------------- */
import { choiceOf, type Answer, type Answers, type ChoiceQ, type Questions } from './types';

export const END = '⏹';
export const SPACE = '␠';
export const SPELL = '✎';

export const CHARSET: string[] = [...'abcdefghijklmnopqrstuvwxyz0123456789', SPACE, '.', ',', "'", '-', '?', '!', ':', END];

/** A token as it appears in the output string. */
export const glyph = (tok: string): string => (tok === SPACE ? ' ' : tok === END || tok === SPELL ? '' : tok);

export interface Tok {
  tok: string;
  p: number;
}

/** What every decoder conditions on: the question and the answer so far. */
export const decodeState = (question: string, prefix: string): Record<string, unknown> => ({
  question,
  answer_so_far: prefix,
  answer_length_so_far: prefix.length,
  convention: 'a short, correct, plain lowercase answer; no preamble',
});

/** Next-character question at offset k from the end of answer_so_far (k=0 is the next char). */
export function charQuestion(k: number): ChoiceQ {
  const where =
    k === 0
      ? 'What is the NEXT character'
      : `Looking ahead: what is the character ${k + 1} positions after the end of answer_so_far (assume the ${k} before it are the most likely ones)`;
  return choiceOf(
    `${where} of the answer to the question? ${SPACE} is a space. Choose ${END} if the answer is already complete at that position.`,
    CHARSET,
  );
}

/** k parallel lookahead questions named c0…c{k-1}. */
export function lookaheadQuestions(k: number): Questions {
  const qs: Questions = {};
  for (let i = 0; i < k; i++) qs[`c${i}`] = charQuestion(i);
  return qs;
}

const tokOf = (a: Answer | undefined): Tok | null =>
  a?.choice ? { tok: a.choice, p: a.confidence ?? a.probabilities?.[a.choice] ?? 0 } : null;

/**
 * Keep the confident prefix of a lookahead round. The first position is always
 * accepted (that alone is plain autoregression — progress is guaranteed); later
 * positions only while each clears θ, and never past an END.
 */
export function acceptLookahead(answers: Answers, k: number, theta: number): { tokens: Tok[]; done: boolean } {
  const tokens: Tok[] = [];
  for (let i = 0; i < k; i++) {
    const t = tokOf(answers[`c${i}`]);
    if (!t) break;
    if (i > 0 && t.p < theta) break;
    tokens.push(t);
    if (t.tok === END) return { tokens, done: true };
  }
  return { tokens, done: false };
}

/* ── words ─────────────────────────────────────────────────────────────── */

/** A small closed vocabulary: function words, frequent content words, numbers-as-words. */
export const WORDS: string[] = (
  'the a an of to in on at by for with from as is are was were be been it its this that these those ' +
  'and or but not no yes if then than so because about into over under after before between during ' +
  'i you he she we they me him her us them my your his our their who what when where why how which ' +
  'one two three four five six seven eight nine ten hundred thousand million first second last many ' +
  'more most less few some all any each every other same new old good bad big small long short high low ' +
  'year years day days time people person man woman child world country city state water fire earth air ' +
  'sun moon star light dark red blue green black white color number name word part place thing way life ' +
  'made make makes called known used can could will would should may might must has have had do does did ' +
  'north south east west king queen war river sea ocean mountain island capital language english french ' +
  'about approximately around roughly exactly only also still very much well because'
)
  .split(/\s+/)
  .filter((w, i, all) => w && all.indexOf(w) === i)
  .slice(0, 253);

export function wordQuestion(): ChoiceQ {
  return choiceOf(
    `What is the NEXT WORD of the answer to the question? Choose ${END} if the answer is complete, or ${SPELL} if the next word is not in this list (it will be spelled letter by letter).`,
    [...WORDS, END, SPELL],
  );
}

/** Append a decoded word to the running answer, space-separated. */
export const appendWord = (prefix: string, word: string): string => (prefix ? `${prefix} ${word}` : word);

/* ── superpose: every typed decoder in one call ───────────────────────── */

export const KINDS: Record<string, string> = {
  yesno: 'a yes or no answer',
  number: 'a plain number (a count, quantity or measurement)',
  year: 'a calendar year or date',
  word: 'a single word or name',
  phrase: 'a phrase or sentence',
};

const DIGITS = [...'0123456789'];
const MAX_DIGITS = 7;

/** One call's worth of questions: the kind, plus every kind's slots. */
export function superposeQuestions(): Questions {
  const qs: Questions = {
    kind: { type: 'choice', instructions: 'What kind of answer does this question have?', criteria: { ...KINDS } },
    yes: { type: 'noul', instructions: 'If the question has a yes/no answer, is the answer yes?' },
    ndigits: choiceOf('If the answer is a number, how many digits does its integer part have?', ['1', '2', '3', '4', '5', '6', '7']),
    negative: { type: 'noul', instructions: 'If the answer is a number, is it negative?' },
    ce: choiceOf('If the answer is a year, is it CE (AD) or BCE (BC)?', ['CE', 'BCE']),
    first: choiceOf('If the answer is a word or phrase, what letter does it start with?', [...'abcdefghijklmnopqrstuvwxyz']),
  };
  for (let i = 0; i < MAX_DIGITS; i++) {
    qs[`d${i}`] = choiceOf(
      `If the answer is a number, what is digit #${i + 1} counting from the LEFT of its integer part? (Pick any if it has fewer digits.)`,
      DIGITS,
    );
  }
  for (let i = 0; i < 4; i++) {
    qs[`y${i}`] = choiceOf(`If the answer is a year, what is digit #${i + 1} of the four-digit year (zero-padded, e.g. 0476)?`, DIGITS);
  }
  return qs;
}

export interface Collapsed {
  kind: string;
  kindP: number;
  /** The decoded answer, or null when the kind needs spelling (word/phrase). */
  text: string | null;
  /** For word/phrase: the first letter, to seed a spelling decoder. */
  seed?: string;
}

/** Collapse a superposed answer set to the kind that won. */
export function collapse(answers: Answers): Collapsed {
  const kind = answers.kind?.choice ?? 'phrase';
  const kindP = answers.kind?.confidence ?? 0;
  const digit = (k: string) => answers[k]?.choice ?? '0';
  if (kind === 'yesno') return { kind, kindP, text: (answers.yes?.noul ?? 0) >= 0.5 ? 'yes' : 'no' };
  if (kind === 'number') {
    const n = Math.min(Math.max(Number(answers.ndigits?.choice ?? '1'), 1), MAX_DIGITS);
    const ds = Array.from({ length: n }, (_, i) => digit(`d${i}`)).join('').replace(/^0+(?=\d)/, '');
    return { kind, kindP, text: `${(answers.negative?.noul ?? 0) >= 0.5 ? '-' : ''}${ds}` };
  }
  if (kind === 'year') {
    const y = [0, 1, 2, 3].map((i) => digit(`y${i}`)).join('').replace(/^0+(?=\d)/, '');
    return { kind, kindP, text: answers.ce?.choice === 'BCE' ? `${y} BCE` : y };
  }
  return { kind, kindP, text: null, seed: answers.first?.choice };
}

/* ── probe: features of an answer that is never written ───────────────── */

export const PROBES: Questions = {
  answerable: { type: 'noul', instructions: 'Does this question have a definite, factual answer?' },
  yesno: { type: 'noul', instructions: 'Is the answer a simple yes or no?' },
  numeric: { type: 'noul', instructions: 'Is the answer a number?' },
  person: { type: 'noul', instructions: 'Is the answer the name of a person?' },
  place: { type: 'noul', instructions: 'Is the answer a place?' },
  vowel: { type: 'noul', instructions: 'Does a short correct answer start with a vowel?' },
  words: { type: 'score', instructions: 'How many words would a short correct answer need?', criteria: ['1', '2', '3', '4-6', '7-12', 'more'] },
  certainty: { type: 'score', instructions: 'How certain is the answer (is it settled knowledge)?', criteria: ['contested', 'uncertain', 'likely', 'settled'] },
  recency: { type: 'score', instructions: 'How recent is the knowledge the answer depends on?', criteria: ['ancient', 'centuries', 'decades', 'recent years', 'this year'] },
  sentiment: { type: 'score', instructions: 'How positive would the answer feel to the asker?', criteria: ['bad news', 'neutral', 'good news'] },
  domain: choiceOf('Which domain is the answer from?', ['science', 'history', 'geography', 'arts', 'sport', 'technology', 'everyday life', 'language', 'maths', 'other']),
  first: choiceOf('What letter does a short correct answer start with?', [...'abcdefghijklmnopqrstuvwxyz0123456789']),
};

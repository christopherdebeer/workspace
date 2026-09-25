/* ---------------------------------------------------------------------------
 * answer — free-text answers from a model that only discriminates.
 *
 * Measured (jev-1.13.0, 2026-09-25): Jev cannot spell (positions past the
 * first are noise) but recognises the answer among candidates at 0.95–0.99.
 * Latency is ~flat in width (64 nouls ≈ 1.1 s; 16 lexicon shards ≈ 1.7 s; the
 * whole 20k lexicon as one decide_many ≈ 3.0 s) and tokens are cheap. So:
 *
 *   CODE generates candidate spaces; JEV discriminates in parallel;
 *   spend WIDTH (shards, branches, beams) to save DEPTH (round trips).
 *
 *   route      one call, superposed: answer kind + yes/no + numeric magnitude
 *   number     coarse-to-fine recognition over an integer range: ≤254 values
 *              → one choice; wider → ≤254 buckets, recurse into the top two
 *   words      beam search: each step scans the lexicon (full, or gated by a
 *              first-letter superposition) for every live beam in ONE
 *              decide_many; candidates are verified as WHOLE answers in
 *              parallel, pipelined with the next scan
 *   verify     every finalist gets a noul "is this a correct, complete answer?"
 *              in one call — recognition of the whole beats the parts
 *
 * Everything is typed: every answer indexes a candidate code built, so the
 * output is always a well-formed string/number, never an unparseable reply.
 * ------------------------------------------------------------------------- */
import { choiceOf, type Answer, type Answers, type Questions } from './types';

export interface Deps {
  decide(state: unknown, questions: Questions, label: string): Promise<Answers>;
  decideMany(items: Array<{ state: unknown; questions: Questions }>, label: string): Promise<Array<Answers | null>>;
  lexicon(): Promise<string[]>;
  /** Tier 2: rarer words NOT in `lexicon` (austen, michelangelo, cheetah). Scanned only when tier 1 is unsure. */
  lexicon2?(): Promise<string[]>;
  signal?: AbortSignal;
}

export type Kind = 'yesno' | 'number' | 'word' | 'phrase';
export interface Candidate {
  text: string;
  /** beam/path score (product of step confidences). */
  score: number;
  /** whole-answer verification, when run. */
  verified?: number;
}
export type AnswerEvent =
  | { type: 'route'; kind: Kind; p: number; probs: Record<string, number> }
  | { type: 'step'; step: number; beams: Candidate[]; finals: Candidate[] }
  | { type: 'numbers'; level: number; range: string; candidates: Candidate[] }
  | { type: 'verify'; ranked: Candidate[] }
  | { type: 'final'; answer: Candidate; alternatives: Candidate[]; kind: Kind }
  /** A named stage of the search finished — what the UI narrates. */
  | { type: 'phase'; name: string; detail: string; top?: Candidate[] };

export interface Options {
  beam: number;
  maxWords: number;
  /**
   * 'full': the first word scans the whole lexicon (a wrong first-letter gate
   * is unrecoverable — eval: "Who painted the Mona Lisa?" found nothing when
   * gated), later words are gated. 'gated': every word is gated (≈10× cheaper).
   */
  width: 'full' | 'gated';
  onEvent?: (e: AnswerEvent) => void;
}
export const DEFAULTS: Options = { beam: 3, maxWords: 8, width: 'full' };
/** Beams whose prefix Jev doubts below this are pruned ("carbon oxide …"). */
export const PREFIX_FLOOR = 0.15;

const NONE = '(none)';
export const SHARD = 254;
/** Shards per decide_many item — per-call payloads above ~32 shards fail; 16 keeps latency ~1.7 s. */
export const SHARDS_PER_ITEM = 16;

const pOf = (a: Answer | undefined, k?: string): number => (k ? a?.probabilities?.[k] ?? (a?.choice === k ? a?.confidence ?? 0 : 0) : 0);
const aborted = (d: Deps) => {
  if (d.signal?.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
};

/* ── route ─────────────────────────────────────────────────────────────── */

export const KINDS: Record<Kind, string> = {
  yesno: 'yes or no',
  number: 'a number (a count, quantity, measurement or year)',
  word: 'a name or term of one to three words',
  phrase: 'a longer phrase or sentence',
};
export const MAGNITUDES: Record<string, [number, number]> = {
  '0-9': [0, 9],
  '10-99': [10, 99],
  '100-999': [100, 999],
  '1000-9999': [1000, 9999],
  '10000-99999': [10000, 99999],
  '100000-9999999': [100000, 9999999],
};

export function routeQuestions(): Questions {
  return {
    kind: { type: 'choice', instructions: 'What kind of answer does this question have?', criteria: { ...KINDS } },
    yes: { type: 'noul', instructions: 'Is the answer to the question yes?' },
    mag: choiceOf('If the answer is a number, which range is it in?', Object.keys(MAGNITUDES)),
  };
}

/* ── numbers: coarse-to-fine recognition over integer ranges ───────────── */

/** Split [lo,hi] into ≤254 contiguous buckets, labelled "a–b" (or "a" for width 1). */
export function buckets(lo: number, hi: number): Array<{ label: string; lo: number; hi: number }> {
  const n = hi - lo + 1;
  const size = Math.ceil(n / SHARD);
  const out: Array<{ label: string; lo: number; hi: number }> = [];
  for (let a = lo; a <= hi; a += size) {
    const b = Math.min(hi, a + size - 1);
    out.push({ label: a === b ? String(a) : `${a}-${b}`, lo: a, hi: b });
  }
  return out;
}

export async function decodeNumber(question: string, lo: number, hi: number, d: Deps, o: Options): Promise<Candidate[]> {
  // Frontier of ranges with their path scores; each level asks every range at once.
  let frontier: Array<{ lo: number; hi: number; score: number }> = [{ lo, hi, score: 1 }];
  const found: Candidate[] = [];
  for (let level = 0; frontier.length && level < 4; level++) {
    aborted(d);
    const items = frontier.map((r) => {
      const bs = buckets(r.lo, r.hi);
      return {
        state: { question },
        questions: { v: choiceOf(`The answer is a number between ${r.lo} and ${r.hi}. Which ${bs[0].lo === bs[0].hi ? 'value' : 'range'} contains it?`, bs.map((b) => b.label)) },
        bs,
        r,
      };
    });
    const res = await d.decideMany(items.map(({ state, questions }) => ({ state, questions })), `number L${level}`);
    const next: typeof frontier = [];
    items.forEach((it, i) => {
      const a = res[i]?.v;
      const ranked = it.bs
        .map((b) => ({ b, p: pOf(a, b.label) }))
        .sort((x, y) => y.p - x.p)
        .slice(0, 2)
        .filter((x, j) => j === 0 || x.p >= 0.15);
      for (const { b, p } of ranked) {
        if (b.lo === b.hi) found.push({ text: String(b.lo), score: it.r.score * p });
        else next.push({ lo: b.lo, hi: b.hi, score: it.r.score * p });
      }
    });
    o.onEvent?.({ type: 'numbers', level, range: frontier.map((f) => `${f.lo}-${f.hi}`).join(', '), candidates: [...found].sort((a, b) => b.score - a.score) });
    frontier = next.sort((a, b) => b.score - a.score).slice(0, 3);
  }
  return found.sort((a, b) => b.score - a.score).slice(0, 4);
}

/* ── words: beam search over lexicon scans ─────────────────────────────── */

export function shardsOf(words: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < words.length; i += SHARD) out.push(words.slice(i, i + SHARD));
  return out;
}

const scanQuestion = (ws: string[]) =>
  choiceOf(`Which word in this list is the NEXT WORD of the answer to the question? Choose ${NONE} if the next word is not in this list.`, [...ws, NONE]);

const gateQuestion = () =>
  choiceOf(`What is the FIRST LETTER of the NEXT WORD of the answer? Choose ${NONE} if the answer is already complete.`, [...'abcdefghijklmnopqrstuvwxyz', NONE]);

/** Items for one prefix: its shards, 16 per item. */
export function scanItems(question: string, prefix: string, shards: string[][]): Array<{ state: unknown; questions: Questions }> {
  const state = { question, answer_so_far: prefix, words_so_far: prefix ? prefix.split(' ').length : 0 };
  const items: Array<{ state: unknown; questions: Questions }> = [];
  for (let i = 0; i < shards.length; i += SHARDS_PER_ITEM) {
    const qs: Questions = {};
    shards.slice(i, i + SHARDS_PER_ITEM).forEach((s, j) => (qs[`s${i + j}`] = scanQuestion(s)));
    items.push({ state, questions: qs });
  }
  return items;
}

/**
 * Next-word candidates from a scan: each shard's pick (if not (none)), plus any
 * runner-up in that shard ≥ 0.15 — the true word can lose its shard to a
 * fragment ("shake" 0.89 beside "shakespeare" in another shard).
 */
export function candidatesFromScan(answers: Array<Answers | null>, k = 4): Array<{ word: string; p: number }> {
  const best = new Map<string, number>();
  for (const ans of answers) {
    for (const a of Object.values(ans ?? {})) {
      const probs = a?.probabilities ?? (a?.choice ? { [a.choice]: a.confidence ?? 0 } : {});
      // Rank by the share among REAL words: a word losing only to (none)
      // ("graham" 0.24 vs (none) 0.33 in its shard) must not be buried under
      // confident fragments elsewhere. The raw floor still filters noise.
      const real = Math.max(1e-6, 1 - (probs[NONE] ?? 0));
      for (const [w, p] of Object.entries(probs)) {
        if (w === NONE || p < 0.15) continue;
        const rel = Math.min(1, p / real);
        if (rel > (best.get(w) ?? 0)) best.set(w, rel);
      }
    }
  }
  return [...best.entries()].map(([word, p]) => ({ word, p })).sort((a, b) => b.p - a.p).slice(0, k);
}

/** Letters holding ≥ mass of a gate distribution (≤ max), and P(complete). */
export function topLetters(a: Answer | undefined, mass = 0.85, max = 3): { letters: string[]; pDone: number } {
  const probs = Object.entries(a?.probabilities ?? {}).sort((x, y) => y[1] - x[1]);
  const pDone = a?.probabilities?.[NONE] ?? 0;
  const letters: string[] = [];
  let acc = 0;
  for (const [k, p] of probs) {
    if (k === NONE) continue;
    letters.push(k);
    acc += p;
    if (acc >= mass || letters.length >= max) break;
  }
  return { letters, pDone };
}

export function verifyQuestions(cands: string[]): Questions {
  const qs: Questions = {};
  cands.forEach((c, i) => {
    // Strict wording (probe 2026-09-25): "correct and complete?" scored the invented
    // "alexander thomas bell" 0.86 vs the true "alexander graham bell" 0.84;
    // "EXACTLY right …" keeps the true answer at 0.85 and drops the invention to 0.54.
    qs[`v${i}`] = { type: 'noul', instructions: `Is "${c}" EXACTLY right as the answer to the question — every word of it correct, nothing wrong or invented?` };
  });
  return qs;
}

async function verify(question: string, cands: Candidate[], d: Deps): Promise<Candidate[]> {
  if (!cands.length) return [];
  const a = await d.decide({ question }, verifyQuestions(cands.map((c) => c.text)), 'verify');
  return cands.map((c, i) => ({ ...c, verified: a[`v${i}`]?.noul ?? 0 }));
}

export async function decodeWords(question: string, d: Deps, o: Options): Promise<Candidate[]> {
  const lexicon = await d.lexicon();
  const fullShards = shardsOf(lexicon);
  let beams: Candidate[] = [{ text: '', score: 1 }];
  const finals = new Map<string, Candidate>();
  let pendingVerify: Promise<Candidate[]> = Promise.resolve([]);
  const verified: Candidate[] = [];

  for (let step = 0; step < o.maxWords && beams.length; step++) {
    aborted(d);
    const gated = o.width === 'gated' || step > 0;
    let shardsPerBeam: string[][][] = beams.map(() => fullShards);
    const pDone: number[] = beams.map(() => 0);
    if (gated) {
      // One superposed call per beam: next word's first letter, "is it already
      // complete?" (via (none)), and "is this prefix how a correct answer begins?"
      const g = await d.decideMany(
        beams.map((b) => ({
          state: { question, answer_so_far: b.text },
          questions: {
            g: gateQuestion(),
            ...(b.text ? { ok: { type: 'noul' as const, instructions: `Is "${b.text}" how a correct answer to the question begins (or the whole answer)?` } } : {}),
          },
        })),
        `gate w${step}`,
      );
      beams = beams.map((b, i) => (b.text && g[i]?.ok?.noul !== undefined ? { ...b, score: b.score * g[i]!.ok!.noul! } : b));
      shardsPerBeam = beams.map((_, i) => {
        const { letters, pDone: pd } = topLetters(g[i]?.g);
        pDone[i] = step === 0 ? 0 : pd;
        return shardsOf(lexicon.filter((w) => letters.includes(w[0])));
      });
    }
    // Beams that say "complete" become finals; implausible prefixes are pruned.
    beams.forEach((b, i) => {
      if (b.text && pDone[i] >= 0.5) finals.set(b.text, { text: b.text, score: b.score * pDone[i] });
    });
    const live = beams.map((b, i) => ({ b, i })).filter(({ b, i }) => !(b.text && pDone[i] >= 0.8) && (step === 0 || b.score >= PREFIX_FLOOR * (beams[0]?.score ?? 1)));
    if (!live.length) break;

    // One decide_many scans every live beam's shards (verification of the
    // previous step's beams rides alongside — pipelined, not sequential).
    const scan = async (full: boolean) => {
      const plan = live.map(({ b, i }) => scanItems(question, b.text, full ? fullShards : shardsPerBeam[i]));
      const res = await d.decideMany(plan.flat(), `scan w${step}${full ? ' full' : ''} ×${live.length}`);
      let off = 0;
      const next: Candidate[] = [];
      live.forEach(({ b }, j) => {
        const mine = res.slice(off, off + plan[j].length);
        off += plan[j].length;
        const used = new Set(b.text.split(' '));
        // Type constraint on the candidate space: no word twice in one answer.
        for (const { word, p } of candidatesFromScan(mine)) if (!used.has(word)) next.push({ text: b.text ? `${b.text} ${word}` : word, score: b.score * p });
      });
      return next;
    };
    const [first] = await Promise.all([scan(!gated), pendingVerify.then((v) => verified.push(...v))]);
    // Self-heal: a gated scan that finds nothing rescans this step at full width.
    const next = first.length || !gated ? first : await scan(true);
    beams = dedupe(next).sort((a, b) => b.score - a.score).slice(0, o.beam);
    // Every new beam is also a possible complete answer: verify in the background,
    // overlapped with the next step (pipelining — depth is the only real cost).
    const toVerify = beams.filter((c) => !finals.has(c.text));
    for (const c of toVerify) finals.set(c.text, c);
    pendingVerify = verify(question, toVerify, d);
    o.onEvent?.({ type: 'step', step, beams, finals: [...finals.values()] });
    // Stop once a verified answer is near-certain and no live beam scores above it.
    const bestV = Math.max(0, ...verified.map((v) => v.verified ?? 0));
    if (bestV >= 0.9 && step >= 1 && (beams[0]?.score ?? 0) < bestV) break;
  }
  verified.push(...(await pendingVerify));
  const byText = new Map(verified.map((v) => [v.text, v]));
  return [...finals.values()].map((f) => byText.get(f.text) ?? f);
}

/* ── bag-then-compose: depth 2 for short answers ─────────────────────────
 * Eval finding: word-by-word beams lose short function words ("da" in
 * "leonardo da vinci") and wander ("carbon oxide carbon od…"), yet ONE full
 * scan asking "is this ONE OF the answer's words?" surfaces all of them.
 * So: collect the bag, compose every ordered 1–3-word sequence in code (8
 * words → 400 candidates), verify them all in one decide_many. Two round
 * trips after routing, independent of word order. */

export const BAG = 8;
/** Fills kept per cloze blank before verification. */
export const CLOZE_K = 16;
export const MAX_COMPOSE = 3;
const NOULS_PER_ITEM = 64;

/** Every ordered sequence of 1..n distinct words from the bag. */
export function compose(bag: string[], n = MAX_COMPOSE): string[] {
  const out: string[] = [];
  const walk = (seq: string[]) => {
    if (seq.length) out.push(seq.join(' '));
    if (seq.length === n) return;
    for (const w of bag) if (!seq.includes(w)) walk([...seq, w]);
  };
  walk([]);
  return out;
}

const bagQuestion = (ws: string[]) =>
  choiceOf(`Which word in this list is one of the words of a short, correct answer to the question? Choose ${NONE} if none of them is.`, [...ws, NONE]);

/** One scan over `words`: the answer's words, most confident first (≤ BAG). */
export async function bagScan(question: string, words: string[], d: Deps, label = 'bag scan'): Promise<Array<{ word: string; p: number }>> {
  const shards = shardsOf(words);
  const items: Array<{ state: unknown; questions: Questions }> = [];
  for (let i = 0; i < shards.length; i += SHARDS_PER_ITEM) {
    const qs: Questions = {};
    shards.slice(i, i + SHARDS_PER_ITEM).forEach((sh, j) => (qs[`s${i + j}`] = bagQuestion(sh)));
    items.push({ state: { question }, questions: qs });
  }
  return candidatesFromScan(await d.decideMany(items, label), BAG);
}

/** Two bags merged by word (max confidence), best BAG kept. */
export function mergeBags(...bags: Array<Array<{ word: string; p: number }>>): Array<{ word: string; p: number }> {
  const m = new Map<string, number>();
  for (const b of bags) for (const { word, p } of b) if (p > (m.get(word) ?? 0)) m.set(word, p);
  return [...m.entries()].map(([word, p]) => ({ word, p })).sort((x, y) => y.p - x.p).slice(0, BAG);
}

/** Path score of a composed text: geometric mean of its words' bag confidences. */
export const pathScore = (text: string, bag: Array<{ word: string; p: number }>): number => {
  const pw = new Map(bag.map((b) => [b.word, b.p]));
  const ws = text.split(' ');
  return Math.pow(ws.reduce((a, w) => a * (pw.get(w) ?? 0.01), 1), 1 / ws.length);
};

/** Verify many texts at once: 64 strict nouls per item, one decide_many. */
export async function verifyMany(question: string, texts: Array<{ text: string; score: number }>, d: Deps, label: string): Promise<Candidate[]> {
  if (!texts.length) return [];
  const items: Array<{ state: unknown; questions: Questions }> = [];
  for (let i = 0; i < texts.length; i += NOULS_PER_ITEM) items.push({ state: { question }, questions: verifyQuestions(texts.slice(i, i + NOULS_PER_ITEM).map((t) => t.text)) });
  const vr = await d.decideMany(items, `${label} ×${texts.length}`);
  return texts.map((t, i) => ({ ...t, verified: vr[Math.floor(i / NOULS_PER_ITEM)]?.[`v${i % NOULS_PER_ITEM}`]?.noul ?? 0 }));
}

/** Bag → compose → verify over tier 1. Two round trips. */
export async function decodeBag(question: string, d: Deps, o: Options): Promise<{ cands: Candidate[]; bag: Array<{ word: string; p: number }> }> {
  const bag = await bagScan(question, await d.lexicon(), d);
  o.onEvent?.({ type: 'phase', name: 'bag', detail: `${bag.length} answer words from the lexicon`, top: bag.map((b) => ({ text: b.word, score: b.p })) });
  aborted(d);
  const cands = await verifyMany(question, compose(bag.map((b) => b.word)).map((text) => ({ text, score: pathScore(text, bag) })), d, 'compose+verify');
  o.onEvent?.({ type: 'phase', name: 'compose', detail: `${cands.length} orderings verified in parallel`, top: rank(cands).slice(0, 5) });
  return { cands, bag };
}

/* ── cloze: fill the blanks of a near-miss ────────────────────────────────
 * Probe (2026-09-25): asked for "ANOTHER word of the answer" Jev gave graham
 * 0.08; asked a SLOT question ("the middle name…") it gave graham 0.88. Jev
 * fills structural blanks far better than open-ended additions. So when the
 * best candidate is unsure, blank every gap ("alexander ___ bell"), scan the
 * lexicon for each blank in ONE decide_many, and verify the filled variants. */

/**
 * Every blank of a candidate: INSERTIONS (a missing word, "___ alexander bell")
 * and SUBSTITUTIONS (a wrong word, "alexander ___ bell" from "alexander thomas
 * bell" — exactly the slot question Jev answers well). `keep` is the set of
 * words the fill must not repeat.
 */
export function clozeTemplates(base: string): Array<{ template: string; fill: (w: string) => string; keep: string[] }> {
  const ws = base.split(' ');
  const inserts = Array.from({ length: ws.length + 1 }, (_, g) => ({
    template: [...ws.slice(0, g), '___', ...ws.slice(g)].join(' '),
    fill: (w: string) => [...ws.slice(0, g), w, ...ws.slice(g)].join(' '),
    keep: ws,
  }));
  const subs =
    ws.length > 1
      ? ws.map((_, g) => ({
          template: [...ws.slice(0, g), '___', ...ws.slice(g + 1)].join(' '),
          fill: (w: string) => [...ws.slice(0, g), w, ...ws.slice(g + 1)].join(' '),
          keep: ws.filter((_, j) => j !== g),
        }))
      : [];
  return [...subs, ...inserts];
}

const clozeQuestion = (template: string, ws: string[]) =>
  choiceOf(`The answer to the question has the form "${template}". Which word in this list fills the blank ___? Choose ${NONE} if nothing belongs there.`, [...ws, NONE]);

/** Cloze scan of `base`: filled variants with scan scores (verification is the caller's, batched). */
export async function clozeTexts(question: string, base: string, d: Deps): Promise<Array<{ text: string; score: number }>> {
  const shards = shardsOf(await d.lexicon());
  const gaps = clozeTemplates(base);
  const plan = gaps.map((g) => {
    const items: Array<{ state: unknown; questions: Questions }> = [];
    for (let i = 0; i < shards.length; i += SHARDS_PER_ITEM) {
      const qs: Questions = {};
      shards.slice(i, i + SHARDS_PER_ITEM).forEach((sh, j) => (qs[`s${i + j}`] = clozeQuestion(g.template, sh)));
      items.push({ state: { question }, questions: qs });
    }
    return items;
  });
  const res = await d.decideMany(plan.flat(), `cloze ×${gaps.length} gaps`);
  const texts: Array<{ text: string; score: number }> = [];
  let off = 0;
  gaps.forEach((g, i) => {
    const mine = res.slice(off, off + plan[i].length);
    off += plan[i].length;
    // Many fills per blank: verification is the discriminator and costs ~30
    // tokens a candidate; in a name slot every shard offers SOME name, and the
    // true one ("graham") ranks ~7th by scan score but first by verification.
    for (const { word, p } of candidatesFromScan(mine, CLOZE_K)) if (!g.keep.includes(word) && g.fill(word) !== base) texts.push({ text: g.fill(word), score: p });
  });
  return texts;
}

const dedupe = (cs: Candidate[]): Candidate[] => {
  const m = new Map<string, Candidate>();
  for (const c of cs) if (!m.has(c.text) || m.get(c.text)!.score < c.score) m.set(c.text, c);
  return [...m.values()];
};

/**
 * Final ranking: whole-answer verification, then Occam — on a near-tie (≤0.01)
 * the SHORTER answer. Eval: preferring longer picked "carbon dioxide gas" (0.93)
 * over "carbon dioxide" (0.95); where longer is right it wins outright
 * ("william shakespeare" 0.97 vs "shakespeare" 0.85).
 */
export function rank(cands: Candidate[]): Candidate[] {
  return [...cands].sort((a, b) => {
    const dv = (b.verified ?? -1) - (a.verified ?? -1);
    if (Math.abs(dv) > 0.01) return dv;
    return a.text.split(' ').length - b.text.split(' ').length || dv || b.score - a.score;
  });
}

/* ── the whole loop ────────────────────────────────────────────────────── */

export async function answer(question: string, d: Deps, opts: Partial<Options> = {}): Promise<{ answer: Candidate; alternatives: Candidate[]; kind: Kind }> {
  const o: Options = { ...DEFAULTS, ...opts };
  aborted(d);
  const r = await d.decide({ question }, routeQuestions(), 'route');
  const kind = (r.kind?.choice as Kind) ?? 'word';
  o.onEvent?.({ type: 'route', kind, p: r.kind?.confidence ?? 0, probs: r.kind?.probabilities ?? {} });
  o.onEvent?.({ type: 'phase', name: 'route', detail: `${kind} (${Math.round((r.kind?.confidence ?? 0) * 100)}%)${kind === 'number' ? ` · range ${r.mag?.choice}` : ''}` });

  let cands: Candidate[];
  if (kind === 'yesno') {
    const p = r.yes?.noul ?? 0;
    cands = [
      { text: 'yes', score: p, verified: p },
      { text: 'no', score: 1 - p, verified: 1 - p },
    ];
  } else if (kind === 'number') {
    const [lo, hi] = MAGNITUDES[r.mag?.choice ?? '0-9'] ?? [0, 9];
    cands = await verify(question, await decodeNumber(question, lo, hi, d, o), d);
    o.onEvent?.({ type: 'phase', name: 'number', detail: `coarse-to-fine over ${lo}–${hi}`, top: rank(cands).slice(0, 4) });
  } else if (kind === 'word') {
    // Short answers: bag → compose → verify (tier-1 lexicon, 2 round trips).
    const first = await decodeBag(question, d, o);
    cands = first.cands;
    const bestV = () => Math.max(0, ...cands.map((c) => c.verified ?? 0));
    if (bestV() < 0.9) {
      // Unsure: in ONE round trip, cloze the best candidate's blanks AND scan the
      // tier-2 lexicon (rarer words: austen, michelangelo, cheetah); then verify
      // the fills and every composition over the merged bag in ONE more.
      const best = rank(cands)[0];
      const [fills, bag2] = await Promise.all([
        best?.text ? clozeTexts(question, best.text, d) : Promise.resolve([]),
        d.lexicon2 ? d.lexicon2().then((l2) => bagScan(question, l2, d, 'bag scan · tier 2')) : Promise.resolve([]),
      ]);
      const union = mergeBags(first.bag, bag2);
      const seen = new Set(cands.map((c) => c.text));
      const more = dedupe([...fills, ...compose(union.map((b) => b.word)).map((text) => ({ text, score: pathScore(text, union) }))]).filter((t) => !seen.has(t.text));
      const checked = await verifyMany(question, more, d, 'verify cloze + tier 2');
      o.onEvent?.({ type: 'phase', name: 'repair', detail: `cloze of “${best?.text ?? ''}” + ${bag2.length} tier-2 words → ${more.length} verified`, top: rank(checked).slice(0, 5) });
      cands = [...cands, ...checked];
    }
    if (bestV() < 0.6) {
      o.onEvent?.({ type: 'phase', name: 'beam', detail: 'nothing verified ≥ 0.6 — word-by-word beam search' });
      cands = [...cands, ...(await decodeWords(question, d, o))];
    }
  } else {
    cands = await decodeWords(question, d, { ...o, maxWords: Math.max(o.maxWords, 16), beam: 1 });
  }
  const ranked = rank(dedupe(cands.map((c) => ({ ...c, score: c.verified ?? c.score })))).map((c) => cands.find((x) => x.text === c.text && (x.verified ?? x.score) === c.score) ?? c);
  o.onEvent?.({ type: 'verify', ranked });
  const best = ranked[0] ?? { text: '', score: 0 };
  const out = { answer: best, alternatives: ranked.slice(1, 5), kind };
  o.onEvent?.({ type: 'final', ...out });
  return out;
}

/* ---------------------------------------------------------------------------
 * The experiment library. Adding one = one file in this folder + one entry
 * here. `status: 'idea'` entries are open prompts — cards with no code yet —
 * so the library doubles as the backlog of unusual things to try with Jev.
 * ------------------------------------------------------------------------- */
import type * as React from 'react';
import FreeText from './freetext';
import Program from './program';
import ImageCS from './image-cs';

export interface Experiment {
  id: string;
  n: string;
  title: string;
  blurb: string;
  /** What about Jev it leans on (parallelism, latency, 255-way choice, calibration…). */
  exploits: string[];
  status: 'live' | 'idea';
  component?: () => React.JSX.Element;
  /** The lab notebook: what live runs actually showed (dated, model-pinned). */
  findings?: string[];
}

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'free-text',
    n: '01',
    title: 'Free text',
    blurb: 'Short answers to open questions from a model that cannot write a word: code builds candidate answers, Jev recognises the right one — hundreds of judgments per round trip. 61/61 across a dev set and two held-out sets.',
    exploits: ['recognition over generation', 'width over depth', 'verification as the discriminator'],
    status: 'live',
    component: FreeText,
    findings: [
      'Jev cannot spell: the first letter is right (c 0.43 for canberra), later positions are noise (≤0.09, relative or absolute framing). Letter-by-letter decoding is a dead end.',
      'It recognises on sight: canberra 0.99 inside a 254-word list; a list without it abstains ((none) 0.76). So decode by RECOGNITION over candidate spaces code builds.',
      'Latency is flat in width: 64 nouls ≈ 1.1 s, 16 lexicon shards ≈ 1.7 s, the whole 20k lexicon as one decide_many ≈ 3.0 s. Tokens are cheap; round trips are the cost. Spend width to save depth.',
      'Bag → compose → verify: one scan collects the answer\'s words ("leonardo", "da", "vinci"), code composes every ordering of ≤3 (≈400), one call verifies them all. 3 round trips regardless of word order; word-by-word beams lost "da" and wandered ("carbon oxide carbon od…").',
      'Verification wording decides: "correct and complete?" scored the invented "alexander thomas bell" 0.86 over the true answer; "EXACTLY right — every word correct, nothing invented?" drops it to 0.54.',
      'Slots beat open additions: "ANOTHER word of the answer?" → graham 0.08; "the middle name?" → graham 0.88. So near-misses get a cloze pass — insertion AND substitution blanks ("alexander ___ bell") — then verification. Telephone: alexander graham bell 0.83.',
      'Numbers: coarse-to-fine recognition over ranges (≤254 buckets per level, top-2 kept) — 1989, 366, 1969 at 0.98–0.99 in 3–4 calls.',
      'Dev eval (31 mixed questions, all concurrent): 31/31 after the fixes above — most answers in 3–4 round trips, ~5 s each; the whole set in 9.7 s of wall time.',
      'Held-out #1 (16 unseen): 13/16 — every miss out-of-vocabulary (austen, michelangelo, cheetah; it composed "jane austin", "michael angelo"). Fix: a tier-2 lexicon (~30k rarer words) scanned in the SAME round trip as the cloze, verified together → 16/16, ≤6 calls.',
      'Held-out #2 (14 fresh, after all fixes): 14/14 in 8.8 s wall — nairobi, homer, poseidon, avocado, 206, blue whale, isaac newton.',
      'Cost: a 3-call answer ≈ 150–200k input tokens (~$0.008); a repaired one (cloze + tier 2) ≈ 1–1.5M (~$0.05). Tokens are the budget; latency stays ~5–10 s.',
    ],
  },
  {
    id: 'interface-00a',
    n: '02',
    title: 'Program',
    blurb: 'Describe an app; Jev designs it from typed building blocks, then runs inside it — every sentence becomes one typed operation, and the program itself changes by sentence too.',
    exploits: ['type-masked decoding', 'code enumerates, Jev chooses', 'Jev in the runtime loop'],
    status: 'live',
    component: Program,
    findings: [
      'A program = typed data (fields, counters, timers, budgets, stats, actions) + a pure reducer. Jev never writes code: at every step code enumerates only type-valid candidates from what exists, and Jev picks — so the program is well-typed by construction.',
      'Synthesis is two parallel passes (~1.7 s): shape, item noun, fields, title, mood; then only for what was chosen — category options, goals, and stats/actions GENERATED from the types (a sum needs a number, "clear done" a bool).',
      'Joint beats independent: separate "needs a list?" / "needs a counter?" nouls over-included (a water tally grew a list of glasses); one choice over whole-app SHAPES fixed it.',
      'Type-masked decoding: the op is the argmax of Jev\'s distribution RESTRICTED to ops the app can execute. "add 2 glasses" in a counter app → +2, not a list item. The model proposes; the types dispose.',
      'Numbers never come from Jev\'s guesses: code parses them from the text; Jev only says which field they belong to (coffee 4.50 → amount).',
      'Eval (5 apps, 20 commands, 7 program edits): all correct after the fixes; ~0.7 s per command, all five sessions in 6.6 s.',
    ],
  },
  {
    id: 'image-cs',
    n: '03',
    title: 'Image CS',
    blurb: 'Prompt → 8×8 picture. Three modes: recognise (typed scenes, default), search (recognise, then procedural refinement beyond its templates), pixels (the original per-cell baseline).',
    exploits: ['recognition over generation', 'parallel questions', 'contrastive choice', 'procedural search'],
    status: 'live',
    component: ImageCS,
    findings: [
      'Contributed by client:grok (deploy fact cells/jev-30e878c9/deploy/1790378464784): every free pixel a palette choice, committed at θ and local consistency, iterated — diffusion as discrete classification.',
      'Measured: per-pixel choice is positional generation — the spelling failure again. "Yellow smiley on black", round 1: mostly WHITE, mean confidence 0.39, 1/32 cells above θ=0.55. The loop stalls.',
      'Whole-picture recognition is sharp: shown complete grids, "a yellow smiley?" → smiley 0.82, square/cross/random 0.01; "a white cross?" → cross 0.84, others ≤0.04.',
      '→ recognise: one call picks a typed scene (background + ≤3 layers of shape/colour); code renders every placement (≤256); one decide_many scores whole pictures; mutations of the best 6 are re-scored; a contrastive final (one choice over 12) decides only when decisive. 5 prompts in 4.8 s wall, ~60k tokens total.',
      'Rules found by failure: a face implies a head beneath it; a layer in the background colour erases (dropped); duplicate layers add nothing; a head carrying a face keeps radius ≥ 3 (shrunk heads became ink blots); discs/squares get corner placements (the sun).',
      'Independent nouls are lenient for pictures (a blob scored 0.82 as "a white cross"); comparison is sharper but only trusted when decisive (p ≥ 0.4) — an unsure final once swapped a 0.71 smiley for a 0.59.',
      'Unseen prompt, no tuning: "a purple heart on white" → a clean heart, 0.80. Hardest: the smiley — 8×8 leaves ~2 cells per feature.',
      'search mode (client:grok): population of grids + procedural operators (blob, recolor component, shift, stripe, flip). Jev only scores. Radius anneals explore→exploit. Diversity via Hamming. Added for less-templated iterative comparison.',
      'Measured, head-to-head (Jev judging both orders, 6 prompts): unseeded search LOST every prompt — judge preferred recognise 69–99%, best scores plateaued 39–65%. ~12 random-palette children × 7 sequential generations spends depth where Jev\'s width is free, in a space that ignores the prompt.',
      'Kept the operators, changed the economics: seeded with recognise\'s finalists, mutations restricted to the scene\'s colours, ≤96 children per generation, 3 generations. Refined beats recognise on 4/6 (cross 77%, heart 72→80%), one tie, one narrow loss (tree 44%); +~130k tokens, ~8 s wall for all six. search mode now runs this.',
    ],
  },
  {
    id: 'bisect',
    n: '04',
    title: 'Twenty questions',
    blurb: 'Decode a number by bisection (log₂ n sequential nouls) and race it against one-call digit decoding — which wins on accuracy per millisecond?',
    exploits: ['latency', 'noul calibration'],
    status: 'idea',
  },
  {
    id: 'paraphrase-jury',
    n: '05',
    title: 'Paraphrase jury',
    blurb: 'Ask the same question under ten paraphrases in one call; disagreement across the jury is an uncertainty signal the single answer hides.',
    exploits: ['parallel questions', 'calibration'],
    status: 'idea',
  },
  {
    id: 'keystroke',
    n: '06',
    title: 'Keystroke oracle',
    blurb: 'On every keypress, a next-word distribution over a 255-word vocabulary — autocomplete at typing speed, with the probabilities on screen.',
    exploits: ['latency', '255-way choice'],
    status: 'idea',
  },
  {
    id: 'emoji',
    n: '07',
    title: 'Emoji transliteration',
    blurb: 'Every word of a sentence mapped to one of 255 emoji, all words in a single call — translation as parallel classification.',
    exploits: ['parallel questions', '255-way choice'],
    status: 'idea',
  },
  {
    id: 'crossword',
    n: '08',
    title: 'Constraint crossword',
    blurb: 'Each grid cell a letter choice conditioned on its across and down clues; re-ask only cells whose crossings disagree until the grid settles.',
    exploits: ['parallel questions', 'iterated refinement'],
    status: 'idea',
  },
  {
    id: 'router',
    n: '09',
    title: 'Capability router',
    blurb: 'Route a request to the substrate capability that should handle it, as one choice over the live $catalog — System One as dispatcher.',
    exploits: ['255-way choice', 'latency'],
    status: 'idea',
  },
];

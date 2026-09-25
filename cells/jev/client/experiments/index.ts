/* ---------------------------------------------------------------------------
 * The experiment library. Adding one = one file in this folder + one entry
 * here. `status: 'idea'` entries are open prompts — cards with no code yet —
 * so the library doubles as the backlog of unusual things to try with Jev.
 * ------------------------------------------------------------------------- */
import type * as React from 'react';
import FreeText from './freetext';
import Interface00a from './interface00a';

export interface Experiment {
  id: string;
  n: string;
  title: string;
  blurb: string;
  /** What about Jev it leans on (parallelism, latency, 255-way choice, calibration…). */
  exploits: string[];
  status: 'live' | 'idea';
  component?: () => React.JSX.Element;
}

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'free-text',
    n: '01',
    title: 'Free text',
    blurb: 'Decode a string from a model that only answers typed questions: spelling, speculative lookahead, a word vocabulary, and a superposed one-call decoder.',
    exploits: ['255-way choice', 'parallel questions', 'calibration as a gate'],
    status: 'live',
    component: FreeText,
  },
  {
    id: 'interface-00a',
    n: '02',
    title: 'Interface 00a',
    blurb: 'Free text → a working interface. Two parallel passes choose components, labels, ranges and button wiring from a closed vocabulary.',
    exploits: ['parallel questions', 'closed vocabularies', 'prompt n-grams as options'],
    status: 'live',
    component: Interface00a,
  },
  {
    id: 'bisect',
    n: '03',
    title: 'Twenty questions',
    blurb: 'Decode a number by bisection (log₂ n sequential nouls) and race it against one-call digit decoding — which wins on accuracy per millisecond?',
    exploits: ['latency', 'noul calibration'],
    status: 'idea',
  },
  {
    id: 'paraphrase-jury',
    n: '04',
    title: 'Paraphrase jury',
    blurb: 'Ask the same question under ten paraphrases in one call; disagreement across the jury is an uncertainty signal the single answer hides.',
    exploits: ['parallel questions', 'calibration'],
    status: 'idea',
  },
  {
    id: 'keystroke',
    n: '05',
    title: 'Keystroke oracle',
    blurb: 'On every keypress, a next-word distribution over a 255-word vocabulary — autocomplete at typing speed, with the probabilities on screen.',
    exploits: ['latency', '255-way choice'],
    status: 'idea',
  },
  {
    id: 'emoji',
    n: '06',
    title: 'Emoji transliteration',
    blurb: 'Every word of a sentence mapped to one of 255 emoji, all words in a single call — translation as parallel classification.',
    exploits: ['parallel questions', '255-way choice'],
    status: 'idea',
  },
  {
    id: 'crossword',
    n: '07',
    title: 'Constraint crossword',
    blurb: 'Each grid cell a letter choice conditioned on its across and down clues; re-ask only cells whose crossings disagree until the grid settles.',
    exploits: ['parallel questions', 'iterated refinement'],
    status: 'idea',
  },
  {
    id: 'router',
    n: '08',
    title: 'Capability router',
    blurb: 'Route a request to the substrate capability that should handle it, as one choice over the live $catalog — System One as dispatcher.',
    exploits: ['255-way choice', 'latency'],
    status: 'idea',
  },
];

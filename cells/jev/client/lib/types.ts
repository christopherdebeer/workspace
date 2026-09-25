/* Jev wire shapes, as the @c15r/jev cell returns them (see ../../index.ts). */

export interface NoulQ {
  type: 'noul';
  instructions?: string;
}
export interface ChoiceQ {
  type: 'choice';
  instructions?: string;
  /** option label → optional description (≤255 options). */
  criteria: Record<string, string | null>;
}
export interface ScoreQ {
  type: 'score';
  instructions?: string;
  /** ordered low→high level labels. */
  criteria: string[];
}
export type Question = NoulQ | ChoiceQ | ScoreQ;
export type Questions = Record<string, Question>;

export interface NoulAns {
  noul?: number;
}
export interface ChoiceAns {
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}
export interface ScoreAns {
  score?: number;
  confidence?: number;
  probabilities?: Record<string, number>;
}
export type Answer = NoulAns & ChoiceAns & ScoreAns;
export type Answers = Record<string, Answer | undefined>;

/** A choice question over a list of option labels (no descriptions). */
export const choiceOf = (instructions: string, options: string[]): ChoiceQ => ({
  type: 'choice',
  instructions,
  criteria: Object.fromEntries(options.map((o) => [o, null])),
});

/**
 * Split items into request-sized groups. The parc.land edge rejects large
 * bodies (a 20-item × 16-shard decide_many ≈ 800 KB failed request signing;
 * 5 items ≈ 200 KB passes), so batches are capped by serialized size and item
 * count and sent concurrently — the width stays, only the envelopes change.
 */
export function chunkBySize<T>(items: T[], maxBytes = 240_000, maxItems = 200): number[][] {
  const groups: number[][] = [];
  let cur: number[] = [];
  let bytes = 0;
  items.forEach((it, i) => {
    const b = JSON.stringify(it).length;
    if (cur.length && (bytes + b > maxBytes || cur.length >= maxItems)) {
      groups.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(i);
    bytes += b;
  });
  if (cur.length) groups.push(cur);
  return groups;
}

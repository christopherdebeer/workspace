/**
 * The learned per-type bias (ADR-0094 Inc 1) — self-healing, not fixed config.
 *
 * Hand-written `typePriors` worked but had to be maintained by hand: each round
 * of tuning revealed the next type that had never been given one, because an
 * undeclared type defaults to 1. This learns the bias from what the slice
 * actually OPENS.
 *
 * The property that makes it safe is non-circularity. Only `get`/`peek` and the
 * explicit capability wire record a read touch; `recall`/`query`/`read`/`getMany`
 * record nothing ("rendering must not inflate salience", ADR-0050/0055). So
 * appearing in the focus band raises a type's share of the CORPUS — the
 * denominator — and never its share of deliberate reads. A type that wins the
 * band and is never opened is demoted *by* winning it.
 */
import { learnTypePriors, layerTypeBias } from '../platform/runtime';
import type { StateRecord } from '../platform/runtime';

type Rec = Pick<StateRecord, 'type' | 'touches' | 'superseded'>;

/** `n` facts of type `t`, carrying `hr`+`ar` deliberate reads spread over them. */
const facts = (t: string | null, n: number, chosen = 0, extra: Partial<Rec> = {}): Rec[] =>
  Array.from({ length: n }, (_, i) => ({
    type: t,
    touches: { hr: i === 0 ? chosen : 0 },
    superseded: false,
    ...extra,
  })) as Rec[];

describe('learnTypePriors — the bias the slice earns', () => {
  it('demotes a type that fills the corpus and is never opened', () => {
    const priors = learnTypePriors([
      ...facts('doc-block', 500), // bulk, zero deliberate reads
      ...facts('task', 10, 40), // tiny, heavily opened
    ]);
    expect(priors['doc-block']).toBeLessThan(0.5);
    // ...and the type that IS opened is left alone. Not promoted — the learner
    // demotes only; "stays prominent" is 1.
    expect(priors['task'] ?? 1).toBe(1);
  });

  it('IS NOT CIRCULAR: surfacing raises the denominator, never the numerator', () => {
    // The same type, same reads, but ten times the facts — as happens when a
    // doc is decomposed into blocks that then flood the band. Its prior FALLS.
    const few = learnTypePriors([...facts('doc', 20, 10), ...facts('task', 20, 10)]);
    const many = learnTypePriors([...facts('doc', 200, 10), ...facts('task', 20, 10)]);
    expect(many['doc']!).toBeLessThan(few['doc'] ?? 1);
  });

  it('counts deliberate reads only — a cell writing constantly does not look wanted', () => {
    // Identical corpora; one type is written hard by an agent, the other read.
    const written = learnTypePriors([
      ...facts('task', 100, 0, { touches: { aw: 500 } }),
      ...facts('kb', 100, 50),
    ]);
    expect(written['task']).toBeLessThan(1);
    // Platform reads are machinery reading machinery — also not a choice.
    const platformRead = learnTypePriors([
      ...facts('graph-layout-shard', 100, 0, { touches: { pr: 900 } }),
      ...facts('kb', 100, 50),
    ]);
    expect(platformRead['graph-layout-shard']).toBeLessThan(1);
  });

  it('shrinks toward neutral when a type has too few facts to judge', () => {
    // Three facts and one peek, in a slice where reading is common: a raw ratio
    // would call this type wildly above average; smoothing calls it noise.
    const priors = learnTypePriors([...facts('note', 3, 1), ...facts('kb', 500, 500)]);
    expect(priors['note'] ?? 1).toBeLessThanOrEqual(1);
    expect(priors['note'] ?? 1).toBeGreaterThan(0.9);
  });

  it('biases, never silences — a demoted type can always recover', () => {
    const priors = learnTypePriors([...facts('doc-block', 5000), ...facts('kb', 5, 200)]);
    expect(priors['doc-block']).toBeGreaterThanOrEqual(0.2);
    expect(Math.max(...Object.values(priors))).toBeLessThanOrEqual(1);
  });

  it('stays neutral with no evidence at all — a cold slice ranks as it does today', () => {
    expect(learnTypePriors(facts('doc', 100))).toEqual({});
    expect(learnTypePriors([])).toEqual({});
  });

  it('ignores superseded facts and records a deadband', () => {
    const priors = learnTypePriors([
      ...facts('gone', 300, 0, { superseded: true }),
      ...facts('kb', 50, 10),
      ...facts('note', 50, 10), // identical to kb → lift 1 → inside the deadband
    ]);
    expect(priors).not.toHaveProperty('gone');
    expect(priors).not.toHaveProperty('note');
  });
});

describe('layerTypeBias — a human pin always wins, per type', () => {
  it('merges per TYPE so pinning one does not discard the rest', () => {
    const learned = { 'doc-block': 0.3, log: 0.4, task: 1.4 };
    const asserted = { typePriors: { 'doc-block': 0.9 }, focusThreshold: 0.6 };
    expect(layerTypeBias(learned, asserted)).toEqual({
      focusThreshold: 0.6,
      typePriors: { 'doc-block': 0.9, log: 0.4, task: 1.4 },
    });
  });

  it('passes either side through alone', () => {
    expect(layerTypeBias(null, { focusThreshold: 0.7 })).toEqual({ focusThreshold: 0.7 });
    expect(layerTypeBias({ log: 0.4 }, null)).toEqual({ typePriors: { log: 0.4 } });
    expect(layerTypeBias(null, null)).toBeNull();
    expect(layerTypeBias({}, null)).toBeNull();
  });
});

describe('the learner demotes only', () => {
  it('never promotes, however hard a small type is fetched', () => {
    // The live failure this rule exists for: a handful of layout shards that a
    // rendering client re-fetches by key, wearing the owner's identity. Nothing
    // bounds a programmatic fetch loop, so nothing may ride it upward.
    const priors = learnTypePriors([
      ...facts('graph-layout-shard', 16, 5000),
      ...facts('doc-block', 3000, 10),
    ]);
    expect(priors['graph-layout-shard'] ?? 1).toBe(1);
    expect(Object.values(priors).every((p) => p <= 1)).toBe(true);
    // ...while the bulk type nobody opens is still demoted. Evaporation, not rank.
    expect(priors['doc-block']).toBeLessThan(0.5);
  });
});

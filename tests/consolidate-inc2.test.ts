/**
 * ADR-0077 — the postured organ (consolidate Inc 2), pure-core gate.
 *
 * The new pure pieces: keyPattern matching for the typing backfill (adds only,
 * unambiguous matches only), the Stage-B rubric + verdict parsing (a verdict
 * the organ can't validate is a verdict it doesn't have), and planCycle's
 * retype class (capped, beside ratify/unlink — contradictions still never
 * become actions).
 */
import {
  planCycle,
  keyPatternToRegex,
  matchTypeByKey,
  buildAdjudicationPrompt,
  parseVerdict,
  CAPS,
  type Observations,
} from '../cells/consolidate/index';

const baseObs = (over: Partial<Observations> = {}): Observations => ({
  attention: { staleTotal: 0, unlinkedTotal: 0, danglingTotal: 0, dangling: [] },
  contestedTotal: 0,
  suggestions: [],
  prev: null,
  survivors: [],
  ...over,
});

describe('ADR-0077 — typing backfill (keyPattern matching)', () => {
  const types = {
    goal: { keyPattern: 'goal/{id}' },
    task: { keyPattern: 'task/{goal}/{id}' },
    note: {}, // no pattern — never matches
    capture: { keyPattern: 'inbox/{id}' },
  };

  it('keyPatternToRegex: interior {captures} are one segment; the TRAILING capture is greedy (keys nest)', () => {
    expect(keyPatternToRegex('task/{goal}/{id}').test('task/g1/t1')).toBe(true);
    expect(keyPatternToRegex('goal/{id}').test('goal/g1')).toBe(true);
    expect(keyPatternToRegex('goal/{id}').test('nested/goal/g1')).toBe(false);
    // Trailing greed: element ids and placement fact-keys contain slashes.
    expect(keyPatternToRegex('el:{id}').test('el:inbox/arch-2021-07-21-1')).toBe(true);
    expect(keyPatternToRegex('_canvas/{board}/{el}').test('_canvas/b1/el:inbox/x')).toBe(true);
    // Interior capture stays strict: the board segment can't span slashes.
    expect(keyPatternToRegex('_canvas/{board}/{el}').test('_canvas/el:only')).toBe(false);
    expect(keyPatternToRegex('el:{id}').test('kb/el:nope')).toBe(false);
  });

  it('matchTypeByKey: exactly-one-match wins; none or ambiguous → null', () => {
    expect(matchTypeByKey('goal/xyz', types)).toBe('goal');
    expect(matchTypeByKey('task/g1/t9', types)).toBe('task');
    expect(matchTypeByKey('kb/something', types)).toBeNull();
    // Ambiguity: two patterns matching the same key → no backfill.
    expect(matchTypeByKey('goal/x', { ...types, alt: { keyPattern: 'goal/{other}' } })).toBeNull();
  });

  it('planCycle plans retype from obs.untyped, capped, alongside the safe tier', () => {
    const untyped = Array.from({ length: 15 }, (_, i) => ({ key: `inbox/u${i}`, type: 'capture', version: `v${i}` }));
    const plan = planCycle(baseObs({ untyped }));
    expect(plan.retype).toHaveLength(CAPS.retype);
    expect(plan.retype[0]).toEqual({ key: 'inbox/u0', type: 'capture', version: 'v0' });
    // Absent untyped (Inc 1 fixtures) → empty, and the shape is always present.
    expect(planCycle(baseObs()).retype).toEqual([]);
  });
});

describe('ADR-0077 — Stage B rubric + verdict validation', () => {
  it('the prompt carries both facts, the CONTESTED_HINT vocabulary, and demands bare JSON', () => {
    const p = buildAdjudicationPrompt(
      { key: 'kb/a', type: 'knowledge', value: { claim: 'x is true' } },
      { key: 'kb/b', type: null, value: { claim: 'x is false' } },
    );
    for (const needle of ['kb/a', 'kb/b', '(untyped)', 'duplicate', 'contradict', 'subsumes', 'independent', 'uncertain', 'ONLY a JSON object']) {
      expect(p).toContain(needle);
    }
  });

  it('parseVerdict accepts only the closed verdict set with a 0..1 confidence', () => {
    expect(parseVerdict('{"verdict":"duplicate","confidence":0.95,"why":"same capture"}')).toEqual({
      verdict: 'duplicate',
      confidence: 0.95,
      why: 'same capture',
    });
    // Prose around the JSON is tolerated (models narrate); the JSON is extracted.
    expect(parseVerdict('Sure! Here is my answer: {"verdict":"independent","confidence":1}')).toMatchObject({
      verdict: 'independent',
    });
    expect(parseVerdict('{"verdict":"delete-everything","confidence":0.99}')).toBeNull();
    expect(parseVerdict('{"verdict":"duplicate","confidence":1.7}')).toBeNull();
    expect(parseVerdict('{"verdict":"duplicate"}')).toBeNull(); // no confidence → no verdict
    expect(parseVerdict('not json at all')).toBeNull();
    expect(parseVerdict(undefined)).toBeNull();
  });

  it('contradictions still never become plan actions — Stage B is a separate, floored stage', () => {
    const plan = planCycle(baseObs({ contestedTotal: 42 }));
    expect(plan.escalations.contested).toBe(42);
    expect([...plan.ratify, ...plan.unlink, ...plan.retype]).toHaveLength(0);
  });
});

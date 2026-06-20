/**
 * Selector (ADR-0011) — the one structural predicate shared by View membership,
 * `query` filtering, and Subscription `match`. Same question, two streams (state
 * vs. the change stream); this asserts the predicate itself.
 */
import { matchesSelector } from '../platform/runtime/selector';

const fact = { key: 'kb/a', type: 'note', tags: ['x', 'y'] };

describe('Selector: matchesSelector', () => {
  it('an empty selector matches everything', () => {
    expect(matchesSelector(fact, {})).toBe(true);
  });

  it('type must equal', () => {
    expect(matchesSelector(fact, { type: 'note' })).toBe(true);
    expect(matchesSelector(fact, { type: 'todo' })).toBe(false);
  });

  it('tag must be present', () => {
    expect(matchesSelector(fact, { tag: 'x' })).toBe(true);
    expect(matchesSelector(fact, { tag: 'z' })).toBe(false);
  });

  it('prefix must match the key', () => {
    expect(matchesSelector(fact, { prefix: 'kb/' })).toBe(true);
    expect(matchesSelector(fact, { prefix: 'doc:' })).toBe(false);
  });

  it('all constraints are AND-ed', () => {
    expect(matchesSelector(fact, { type: 'note', tag: 'y', prefix: 'kb/' })).toBe(true);
    expect(matchesSelector(fact, { type: 'note', tag: 'y', prefix: 'doc:' })).toBe(false);
  });

  it('tolerates a fact with no type/tags', () => {
    expect(matchesSelector({ key: 'k' }, { prefix: 'k' })).toBe(true);
    expect(matchesSelector({ key: 'k', type: null }, { type: 'note' })).toBe(false);
    expect(matchesSelector({ key: 'k' }, { tag: 'x' })).toBe(false);
  });
});

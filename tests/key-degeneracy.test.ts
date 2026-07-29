/**
 * `degeneracyOf` — the key-structural "these two are one source" predicate shared by
 * `suggestions`, `contested` and the recall focus band.
 *
 * Colon namespaces STACK. `keyBase` stripped exactly one, so a fact projected twice
 * (`el:blk:mq9nt1ig`) reduced to `blk:mq9nt1ig` while the thing it projects reduced to
 * `mq9nt1ig` — no match, and the pair read as a genuine connection to ratify.
 *
 * This stayed invisible while a larger defect masked it: the queue head was owned by
 * stale inbound `similarTo` edges (see tests/similar-inbound.test.ts). With those
 * cleared by the 2026-07-29 reindex, four of the top eight `genuineOnly` candidates
 * turned out to be exactly this shape, at ~0.99997 — a fact beside its own projection.
 */
import { degeneracyOf } from '../services/workspace/commands-search';

describe('degeneracyOf — one source wearing more than one namespace', () => {
  it('sees through STACKED colon namespaces (the el: projection)', () => {
    expect(degeneracyOf('blk:mq9nt1ig', 'el:blk:mq9nt1ig')).toBe('same-source');
    expect(degeneracyOf('el:blk:holistic-1', 'blk:holistic-1')).toBe('same-source');
    expect(degeneracyOf('doc:holistic-review', 'el:doc:holistic-review')).toBe('same-source');
  });

  it('still recognises the classes it always did', () => {
    // sibling blocks of one document
    expect(degeneracyOf('doc-block:docs/x/3', 'doc-block:docs/x/7')).toBe('same-source');
    // a block against its own parent, across namespaces
    expect(degeneracyOf('doc-block:docs/x/3', 'file/docs/x.md')).toBe('contains');
    expect(degeneracyOf('decompose-run/docs/x/40', 'file/docs/x.md')).toBe('contains');
  });

  it('does not collapse genuinely distinct facts', () => {
    // Distinct sources — the whole point of the predicate is that it stays narrow.
    expect(degeneracyOf('doc-block:docs/x/3', 'doc-block:docs/y/3')).toBeUndefined();
    expect(degeneracyOf('inbox/arch-2021-05-11-1', 'inbox/arch-2021-05-11-2')).toBeUndefined();
    // Same bare id under different `/` namespaces stays distinct: one bare word is
    // too weak a signal to match across namespaces (`coreOf` refuses it).
    expect(degeneracyOf('goal/123', 'note/123')).toBeUndefined();
    // Stacking must not make unrelated namespaced keys collide.
    expect(degeneracyOf('el:blk:alpha', 'el:blk:beta')).toBeUndefined();
  });

  it('is symmetric', () => {
    expect(degeneracyOf('el:blk:x', 'blk:x')).toBe(degeneracyOf('blk:x', 'el:blk:x'));
    expect(degeneracyOf('a:b:c', 'q:r')).toBe(degeneracyOf('q:r', 'a:b:c'));
  });
});

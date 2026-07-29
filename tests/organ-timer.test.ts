/**
 * The organ write path forwards `timer`.
 *
 * A delete-effect timer is how the substrate says "this fact is exhaust, not content":
 * `indexableText` refuses it, the stream indexer actively DROPS any vector under the key,
 * `dropSimilarEdges` prunes its inferred kinship, and `suggestions`/`contested` exclude it
 * as ephemeral. That chain is already end-to-end — but a tier-2 cell could not reach any
 * of it, because `createSubstrateWriteHandler` honoured `type`/`tags`/`via` off the event
 * and silently dropped `timer`.
 *
 * What that cost, measured 2026-07-29: `@c15r/lit` chains a long decomposition through the
 * substrate, and each continuation baton (`decompose-run/<slug>/<cursor>`) carries the
 * WHOLE document in `value.content` so every step re-plans from the same source. 97 of
 * them were live, ~11KB each — verbatim copies of the documents they were decomposing, so
 * they embedded at ~1.0 against those documents and every block produced from them, minted
 * kinship to all of it, and drew centrality from those edges. One read centrality 0.63 and
 * salience 0.47: a coordination artefact out-scoring real facts and competing for the focus
 * band, while its `decompose-run ↔ kb/<hash>` pairs queued as connections to ratify.
 *
 * An organ has to be able to say a baton is a baton.
 */
import { createSubstrateWriteHandler } from '../services/workspace/event-handlers';
import { createObservedState, createMemoryStateStore, isTimerLive } from '../platform/runtime';
import type { ServiceContext } from '../platform/runtime';

const CELL = 'cell-lit-1';

function harness() {
  const store = createMemoryStateStore();
  const state = createObservedState(store);
  const ctx = {
    identity: { user: 'c15r', scopes: [] },
    config: { tableName: 'unused' },
    events: { emit: async () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    serviceClient: () => ({ command: async () => ({ owner: 'c15r', name: 'lit' }) }),
  } as unknown as ServiceContext;
  const handler = createSubstrateWriteHandler(() => ({ state, store }) as never);
  const write = (detail: Record<string, unknown>) => handler(detail, ctx, { source: CELL } as never);
  return { state, write };
}

describe('the organ write path carries ephemerality', () => {
  it('forwards a delete-effect timer, so a cell can mark its own coordination exhaust', async () => {
    const { state, write } = harness();
    await write({
      key: 'decompose-run/docs/x/0',
      value: { path: 'docs/x.md', content: '# the whole document', cursor: 0, total: 43 },
      type: 'decompose-run',
      tags: ['lit', 'decompose-run'],
      via: 'lit.decompose',
      timer: { ms: 60 * 60 * 1000, effect: 'delete' },
    });

    const entry = await state.get('c15r', 'decompose-run/docs/x/0');
    expect(entry?._meta.timer).toMatchObject({ effect: 'delete' });
    // Live now, gone later — the whole point: the indexer's `timerEffect === 'delete'`
    // check refuses it immediately, and the row reaps itself if the chain dies.
    const expiresAt = entry!._meta.timer!.expiresAt;
    expect(isTimerLive({ timerExpiresAt: expiresAt, timerEffect: 'delete' }, Date.now())).toBe(true);
    expect(isTimerLive({ timerExpiresAt: expiresAt, timerEffect: 'delete' }, Date.parse(expiresAt) + 1)).toBe(false);
  });

  it('leaves a write with no timer exactly as it was — durable by default', async () => {
    const { state, write } = harness();
    await write({ key: 'kb/thing', value: { title: 'A real fact' }, type: 'knowledge', via: 'lit.decompose' });
    const entry = await state.get('c15r', 'kb/thing');
    expect(entry?._meta.timer).toBeNull();
    expect(entry?._meta.type).toBe('knowledge');
  });

  it('a malformed timer refuses the write rather than crashing the consumer', async () => {
    // `resolveTimer` throws inside `put`; the handler's catch turns that into a
    // logged refusal — an event consumer that dies takes the whole batch with it.
    const { state, write } = harness();
    await expect(
      write({ key: 'decompose-run/docs/y/0', value: { cursor: 0 }, type: 'decompose-run', timer: { effect: 'delete' } }),
    ).resolves.toBeUndefined();
    expect(await state.get('c15r', 'decompose-run/docs/y/0')).toBeNull();
  });
});

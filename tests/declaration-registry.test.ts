/**
 * The Declaration registry (ADR-0001) — the shared lifecycle for `_<ns>/<id>`
 * declaration facts. Proves the generic primitive, and that wrapping a kind over
 * it is behaviour-preserving (the subscriptions parity below).
 */
import {
  createObservedState,
  createMemoryStateStore,
  createDeclarationRegistry,
  type DeclarationKind,
} from '../platform/runtime';
import type { Identity } from '../platform/runtime';
import { createSubscriptions, SUBSCRIPTIONS_PREFIX, type SubscriptionDefinition } from '../services/workspace/subscriptions';

const alice: Identity = { user: 'alice', scopes: [] };

interface Toy {
  id: string;
  n?: number;
}
const toyKind: DeclarationKind<Toy> = {
  ns: '_toys/',
  factType: 'toy',
  defaultVia: 'registerToy',
  idOf: (d) => d.id,
  validate: (d) => {
    if (!d?.id) throw new Error('toy requires an id');
  },
  isStored: (v): v is Toy => !!(v as { id?: unknown })?.id,
};

describe('Declaration registry (generic)', () => {
  it('registers (typed, prefixed), lists, gets, and removes via supersede', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    const reg = createDeclarationRegistry(state, toyKind);

    const def = await reg.register('r', { id: 'a', n: 1 }, alice);
    expect(def).toEqual({ id: 'a', n: 1 });

    // stored at _toys/a, typed 'toy'
    const raw = await state.get('r', '_toys/a');
    expect(raw?.value).toEqual({ id: 'a', n: 1 });
    expect(raw?._meta.type).toBe('toy');
    expect(raw?._meta.via).toBe('registerToy');

    await reg.register('r', { id: 'b', n: 2 }, alice);
    expect((await reg.list('r')).map((t) => t.id).sort()).toEqual(['a', 'b']);
    expect(await reg.get('r', 'a')).toEqual({ id: 'a', n: 1 });
    expect(await reg.get('r', 'missing')).toBeNull();

    expect(await reg.remove('r', 'a', alice)).toEqual({ ok: true });
    expect(await reg.get('r', 'a')).toBeNull(); // superseded → not live
    expect((await reg.list('r')).map((t) => t.id)).toEqual(['b']);
  });

  it('validates at register and reports not_found on a missing remove', async () => {
    const state = createObservedState(createMemoryStateStore());
    const reg = createDeclarationRegistry(state, toyKind);
    await expect(reg.register('r', { id: '' } as Toy, alice)).rejects.toThrow('toy requires an id');
    await expect(reg.remove('r', 'nope', alice)).rejects.toThrow('not_found: toy "nope" not found');
  });
});

describe('subscriptions are a thin wrapper (parity, ADR-0001 step 2)', () => {
  const sub = (id: string): SubscriptionDefinition => ({ id, match: { type: 'machine-run' }, invoke: 'advance' });

  it('register stores at _subscriptions/<id> typed subscription, list/remove behave as before', async () => {
    const state = createObservedState(createMemoryStateStore());
    const subs = createSubscriptions(state);

    await subs.register('r', sub('one'), alice);
    const raw = await state.get('r', `${SUBSCRIPTIONS_PREFIX}one`);
    expect(raw?._meta.type).toBe('subscription');
    expect(raw?._meta.via).toBe('registerSubscription');

    await subs.register('r', sub('two'), alice);
    expect((await subs.list('r')).map((d) => d.id).sort()).toEqual(['one', 'two']);

    expect(await subs.remove('r', 'one', alice)).toEqual({ ok: true });
    expect((await subs.list('r')).map((d) => d.id)).toEqual(['two']);
    await expect(subs.remove('r', 'one', alice)).rejects.toThrow('not_found: subscription "one" not found');
  });

  it('still validates exactly one of invoke/deliver (kind-specific validation preserved)', async () => {
    const state = createObservedState(createMemoryStateStore());
    const subs = createSubscriptions(state);
    await expect(subs.register('r', { id: 'x', match: { type: 't' } } as SubscriptionDefinition, alice)).rejects.toThrow(/exactly one of/);
  });
});

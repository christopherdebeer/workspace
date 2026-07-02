/**
 * ADR-0050/0051 — the salience-that-means-something seams.
 *
 * ADR-0050: activity signals live ON the record as actor-classed counters
 * (standing no longer depends on a TTL-bounded trajectory scan; machinery
 * churn is weighted out), centrality is log-compressed, and `_config/salience`
 * type priors demote plumbing types.
 *
 * ADR-0051: a stated intent (`text`) enters the ONE blend as the `relevance`
 * signal — `query({text})` is semantic search that still respects earned
 * salience, and tiering/elision condition on the intent.
 */
import { createWorkspaceCommands, __resetTypeDeclsCache } from '../services/workspace/handlers';
import { createMemoryGrantStore } from '../services/workspace/grants';
import {
  createObservedState,
  createMemoryStateStore,
  actorClassOf,
  MemoryVectorStore,
  HashingEmbedder,
  embeddableText,
  metadataForFact,
  indexForScope,
  SALIENCE_CONFIG_KEY,
} from '../platform/runtime';
import type { ServiceContext, Identity } from '../platform/runtime';

const alice: Identity = { user: 'alice', scopes: ['workspace:write', 'workspace:read'] };
const agent: Identity = { user: '@alice/models-abc123', scopes: ['workspace:read'] };
const platform: Identity = { user: 'platform/cells', scopes: [] };

function ctxFor(user: string | null): ServiceContext {
  return {
    identity: user ? { user, scopes: ['workspace:write', 'workspace:read'] } : null,
    config: { tableName: 'unused-in-memory' },
    events: { emit: async () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as ServiceContext;
}

describe('actor classes (ADR-0050)', () => {
  it('classifies principals: platform/* and anonymous → platform, @cell → agent, else human', () => {
    expect(actorClassOf('alice')).toBe('human');
    expect(actorClassOf('@alice/models-abc123')).toBe('agent');
    expect(actorClassOf('platform/cells')).toBe('platform');
    expect(actorClassOf(null)).toBe('platform');
    expect(actorClassOf(undefined)).toBe('platform');
  });
});

describe('standing from persisted counters (ADR-0050 — the 24h-TTL bug is structural now)', () => {
  it('human reads accrue standing; the trajectory is not consulted for it', async () => {
    const store = createMemoryStateStore();
    // A store whose trajectory is ALWAYS empty — if standing still accrues,
    // it provably comes from the record's counters, not a trajectory scan.
    const state = createObservedState({ ...store, recentTrajectory: async () => [] });
    await state.put({ scope: 'r', key: 'k', value: 1 }, alice);
    const first = (await state.get('r', 'k', alice))!._meta.standing;
    for (let i = 0; i < 5; i++) await state.get('r', 'k', alice);
    const later = (await state.get('r', 'k', alice))!._meta.standing;
    expect(later).toBeGreaterThan(first);
  });

  it('platform churn earns nothing; agent touches count at a fraction of human ones', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    await state.put({ scope: 'r', key: 'by-platform', value: 1 }, platform);
    await state.put({ scope: 'r', key: 'by-human', value: 1 }, alice);
    // Heavy platform re-writing (a deploy loop) vs one human write.
    for (let i = 0; i < 10; i++) await state.put({ scope: 'r', key: 'by-platform', value: i }, platform);
    const view = await state.read('r', { elision: 'none' });
    expect(view.entries['by-platform']._meta.standing).toBe(0); // weight 0
    expect(view.entries['by-human']._meta.standing).toBeGreaterThan(0);
    // Agent reads register, but below the same number of human reads.
    await state.put({ scope: 'r', key: 'agent-read', value: 1 }, platform);
    await state.put({ scope: 'r', key: 'human-read', value: 1 }, platform);
    for (let i = 0; i < 4; i++) await state.get('r', 'agent-read', agent);
    for (let i = 0; i < 4; i++) await state.get('r', 'human-read', alice);
    const after = await state.read('r', { elision: 'none' });
    const agentStanding = after.entries['agent-read']._meta.standing;
    const humanStanding = after.entries['human-read']._meta.standing;
    expect(agentStanding).toBeGreaterThan(0);
    expect(humanStanding).toBeGreaterThan(agentStanding);
  });

  it('velocity/attention come from the window bucket and reset when it rolls over', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store, { windowMs: 50 }); // tiny bucket
    await state.put({ scope: 'r', key: 'k', value: 1 }, alice);
    const hot = await state.read('r', { elision: 'none' });
    expect(hot.entries['k']._meta.velocity).toBeGreaterThan(0); // write in-bucket
    await new Promise((r) => setTimeout(r, 120)); // bucket rolls over
    const cooled = await state.read('r', { elision: 'none' });
    expect(cooled.entries['k']._meta.velocity).toBe(0); // burst has passed
  });
});

describe('type priors via _config/salience (ADR-0050)', () => {
  it('a declared prior demotes a plumbing type without touching other facts', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    await state.put({ scope: 'r', key: 'geom', value: { x: 1 }, type: 'canvas-placement' }, alice);
    await state.put({ scope: 'r', key: 'idea', value: { s: 'x' }, type: 'claim' }, alice);
    const before = await state.read('r', { elision: 'none' });
    expect(before.entries['geom']._meta.score).toBeCloseTo(before.entries['idea']._meta.score, 4);
    await state.put({ scope: 'r', key: SALIENCE_CONFIG_KEY, value: { typePriors: { 'canvas-placement': 0.4 } } }, alice);
    const after = await state.read('r', { elision: 'none' });
    expect(after.entries['geom']._meta.score).toBeLessThan(after.entries['idea']._meta.score * 0.6);
    // explain names the prior so tuning stays evidence-driven
    const explained = await state.read('r', { elision: 'none', explain: true });
    expect(explained.entries['geom']._meta.explain?.prior).toBe(0.4);
    expect(explained.entries['idea']._meta.explain?.prior).toBe(1);
  });
});

describe('relevance as the sixth signal (ADR-0051)', () => {
  it('a relevance map + weight rerank a read; explain carries the term', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    await state.put({ scope: 'r', key: 'a', value: 'about cooking' }, alice);
    await state.put({ scope: 'r', key: 'b', value: 'about sailing' }, alice);
    const res = await state.query('r', {
      relevance: { b: 0.9 },
      salience: { relevanceWeight: 0.5 },
      explain: true,
    });
    expect(res.entries[0].key).toBe('b'); // relevance lifted b over a
    expect(res.entries[0]._meta.relevance).toBeCloseTo(0.9, 4);
    expect(res.entries[0]._meta.explain?.contribution.relevance).toBeCloseTo(0.45, 3);
    // a is not in the map → relevance 0, still returned (never an authority)
    const a = res.entries.find((e) => e.key === 'a')!;
    expect(a._meta.relevance).toBeUndefined();
  });

  it('query({text}) is salience-aware semantic search; recall({text}) goal-conditions the overview', async () => {
    __resetTypeDeclsCache();
    const store = createMemoryStateStore();
    const grants = createMemoryGrantStore();
    const state = createObservedState(store);
    const vstore = new MemoryVectorStore();
    const embedder = new HashingEmbedder(128);
    const cmds = createWorkspaceCommands(() => ({ state, grants, vectors: { store: vstore, embedder }, store }));
    const index = async (key: string, value: unknown, type: string): Promise<void> => {
      const [vector] = await embedder.embed([embeddableText(key, value)!]);
      await vstore.put(indexForScope('alice', embedder.dimension), [{ key, vector, metadata: metadataForFact({ type }) }]);
    };
    const ctx = ctxFor('alice');
    await cmds.remember({ key: 'd-dynamo', value: { title: 'single dynamodb table stores substrate facts' }, type: 'decision' }, ctx);
    await cmds.remember({ key: 'n-auth', value: { title: 'passkey webauthn refresh cookie horizon' }, type: 'note' }, ctx);
    await index('d-dynamo', { title: 'single dynamodb table stores substrate facts' }, 'decision');
    await index('n-auth', { title: 'passkey webauthn refresh cookie horizon' }, 'note');

    const q = await cmds.query({ text: 'dynamodb table design for facts' }, ctx);
    expect(q.entries[0].key).toBe('d-dynamo');
    expect(q.entries[0]._meta.relevance).toBeGreaterThan(0);
    // Structural filters compose with the intent (the hybrid search can't do).
    const hybrid = await cmds.query({ type: 'note', text: 'dynamodb table design for facts' }, ctx);
    expect(hybrid.entries.map((e) => e.key)).toEqual(['n-auth']);

    const overview = await cmds.recall({ text: 'dynamodb table design for facts' }, ctx);
    if (!('overview' in overview)) throw new Error('expected overview');
    expect(overview.hints[0]).toContain('Goal-conditioned');
    const focusKeys = Object.keys(overview.focus);
    expect(focusKeys.indexOf('d-dynamo')).toBeGreaterThanOrEqual(0);
    expect(focusKeys.indexOf('d-dynamo')).toBeLessThan(Math.max(focusKeys.indexOf('n-auth'), focusKeys.length));
    __resetTypeDeclsCache();
  });

  it('text without a vector backend degrades honestly (unweighted, hinted)', async () => {
    __resetTypeDeclsCache();
    const store = createMemoryStateStore();
    const grants = createMemoryGrantStore();
    const state = createObservedState(store);
    const cmds = createWorkspaceCommands(() => ({ state, grants }));
    const ctx = ctxFor('alice');
    await cmds.remember({ key: 'k', value: 'v' }, ctx);
    const res = await cmds.recall({ text: 'anything at all' }, ctx);
    if (!('overview' in res)) throw new Error('expected overview');
    expect(res.hints[0]).toContain('no semantic backend');
    __resetTypeDeclsCache();
  });
});

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
    // Since ADR-0085 Inc 3 the intent is honest about irrelevance: the only
    // note has no cosine with this text, so the hybrid returns EMPTY rather
    // than padding with off-goal rows; rankBy:'salience' readmits them.
    const hybrid = await cmds.query({ type: 'note', text: 'dynamodb table design for facts' }, ctx);
    expect(hybrid.entries).toEqual([]);
    const padded = await cmds.query({ type: 'note', text: 'dynamodb table design for facts', rankBy: 'salience' }, ctx);
    expect(padded.entries.map((e) => e.key)).toEqual(['n-auth']);

    const overview = await cmds.recall({ text: 'dynamodb table design for facts' }, ctx);
    if (!('overview' in overview)) throw new Error('expected overview');
    expect(overview.hints[0]).toContain('Goal-conditioned');
    const focusKeys = Object.keys(overview.focus);
    expect(focusKeys.indexOf('d-dynamo')).toBeGreaterThanOrEqual(0);
    expect(focusKeys.indexOf('d-dynamo')).toBeLessThan(Math.max(focusKeys.indexOf('n-auth'), focusKeys.length));
    __resetTypeDeclsCache();
  });

  it('intent queries default to a top-20 orientation shortlist; explicit limit/shape win (membrane F7/F9)', async () => {
    __resetTypeDeclsCache();
    const store = createMemoryStateStore();
    const grants = createMemoryGrantStore();
    const state = createObservedState(store);
    const vstore = new MemoryVectorStore();
    const embedder = new HashingEmbedder(128);
    const cmds = createWorkspaceCommands(() => ({ state, grants, vectors: { store: vstore, embedder }, store }));
    const ctx = ctxFor('alice');
    // 25 facts — more than the intent-query default shortlist.
    for (let i = 0; i < 25; i++) {
      const value = { title: `note number ${i} about various topics`, body: 'x'.repeat(500) };
      await cmds.remember({ key: `n/${i}`, value, type: 'note' }, ctx);
      const [vector] = await embedder.embed([embeddableText(`n/${i}`, value)!]);
      await vstore.put(indexForScope('alice', embedder.dimension), [{ key: `n/${i}`, vector, metadata: metadataForFact({ type: 'note' }) }]);
    }
    // Intent query, no limit/shape: top-20 shortlist of orientation-shaped entries.
    const q = (await cmds.query({ text: 'notes about topics' }, ctx)) as {
      entries: Array<{ value?: { body?: string }; _meta: Record<string, unknown> }>;
      total: number;
    };
    expect(q.entries.length).toBeLessThanOrEqual(20); // default shortlist
    expect(q.total).toBe(25); // total still reports the corpus
    const first = q.entries[0];
    expect(first._meta.shaped).toBe('card'); // orientation shape
    expect(first._meta.writers).toBeUndefined(); // provenance trimmed
    expect((first.value?.body ?? '').length).toBeLessThan(500); // preview, not body
    // Explicit limit + shape still win.
    const full = (await cmds.query({ text: 'notes about topics', limit: 25, shape: 'full' }, ctx)) as {
      entries: Array<{ value?: { body?: string }; _meta: Record<string, unknown> }>;
    };
    expect(full.entries.length).toBe(25);
    expect(full.entries[0]._meta.writers).toBeDefined();
    // Filters-only queries are unchanged (whole entries, no implicit limit).
    const plain = (await cmds.query({ prefix: 'n/' }, ctx)) as { entries: Array<{ _meta: Record<string, unknown> }> };
    expect(plain.entries.length).toBe(25);
    expect(plain.entries[0]._meta.shaped).toBeUndefined();
    // F9: `offset` pages exactly like the numeric cursor it aliases.
    const page1 = await cmds.query({ prefix: 'n/', limit: 2 }, ctx);
    const page2 = await cmds.query({ prefix: 'n/', limit: 2, offset: 2 }, ctx);
    expect(page2.entries.map((e) => e.key)).toEqual(
      (await cmds.query({ prefix: 'n/', limit: 2, cursor: '2' }, ctx)).entries.map((e) => e.key),
    );
    expect(page2.entries[0].key).not.toBe(page1.entries[0].key); // actually advanced
    __resetTypeDeclsCache();
  });

  it('intent queries are relevance-ordered and drop the no-relevance tail; explicit rankBy wins (ADR-0085 Inc 3 / W3c)', async () => {
    __resetTypeDeclsCache();
    const store = createMemoryStateStore();
    const grants = createMemoryGrantStore();
    const state = createObservedState(store);
    const vstore = new MemoryVectorStore();
    const embedder = new HashingEmbedder(128);
    const cmds = createWorkspaceCommands(() => ({ state, grants, vectors: { store: vstore, embedder }, store }));
    const ctx = ctxFor('alice');
    const index = async (key: string, value: unknown): Promise<void> => {
      const [vector] = await embedder.embed([embeddableText(key, value)!]);
      await vstore.put(indexForScope('alice', embedder.dimension), [{ key, vector, metadata: metadataForFact({ type: 'note' }) }]);
    };
    // One on-goal fact, one off-goal fact, and one HIGH-SALIENCE fact the
    // intent never reaches (not in the vector index at all — the class of row
    // pure salience used to pad the shortlist with).
    await cmds.remember({ key: 'on', value: { title: 'ratify a suggestion into an authored edge' }, type: 'note' }, ctx);
    await cmds.remember({ key: 'off', value: { title: 'sourdough hydration schedule' }, type: 'note' }, ctx);
    await cmds.remember({ key: 'loud', value: { title: 'completely unrelated but much touched' }, type: 'note' }, ctx);
    await index('on', { title: 'ratify a suggestion into an authored edge' });
    await index('off', { title: 'sourdough hydration schedule' });
    for (let i = 0; i < 30; i++) await cmds.peek({ key: 'loud' }, ctx); // earn salience the intent can't

    const q = await cmds.query({ text: 'ratify suggestion edge' }, ctx);
    expect(q.entries[0].key).toBe('on'); // relevance drives the order
    expect(q.entries.map((e) => e.key)).not.toContain('loud'); // the no-relevance tail is DROPPED
    expect(q.entries.every((e) => (e._meta.relevance ?? 0) > 0)).toBe(true);
    // An explicit rankBy still wins — salience readmits the loud row.
    const bySalience = await cmds.query({ text: 'ratify suggestion edge', rankBy: 'salience' }, ctx);
    expect(bySalience.entries.map((e) => e.key)).toContain('loud');
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

// ─── ADR-0022 × ADR-0050: mediation-aware attention ────────────────

import { embeddableText as embedText, __setLambda } from '../platform/runtime';
import { createCellLifecycleHandler } from '../services/workspace/handlers';

describe('mediation (ADR-0022 fold): identity.actor overrides name-based classing', () => {
  it('an agent embodiment of the user earns less standing than the user in person', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    const inPerson: Identity = { user: 'alice', scopes: [] }; // no actor stamp → human by name
    const viaClient: Identity = { user: 'alice', scopes: [], actor: 'agent' }; // MCP token (clientId)
    await state.put({ scope: 'r', key: 'read-in-person', value: 1 }, { user: 'platform/x', scopes: [] });
    await state.put({ scope: 'r', key: 'read-via-client', value: 1 }, { user: 'platform/x', scopes: [] });
    for (let i = 0; i < 4; i++) await state.get('r', 'read-in-person', inPerson);
    for (let i = 0; i < 4; i++) await state.get('r', 'read-via-client', viaClient);
    const view = await state.read('r', { elision: 'none' });
    expect(view.entries['read-via-client']._meta.standing).toBeGreaterThan(0); // mediated ≠ nothing
    expect(view.entries['read-in-person']._meta.standing).toBeGreaterThan(view.entries['read-via-client']._meta.standing);
  });
});

// ─── ADR-0052: capabilities are facts ───────────────────────────────

describe('capability facts (ADR-0052)', () => {
  afterEach(() => __setLambda(undefined));

  it('_caps/ facts are embeddable; other _ namespaces stay skipped', () => {
    expect(embedText('_caps/@a/blog.publish', { target: '@a/blog.publish', summary: 'Publish a post' })).toContain('Publish a post');
    expect(embedText('_config/salience', { focusThreshold: 0.5 })).toBeNull();
  });

  it('cell.deployed projects tools as capability facts; redeploy retires stale; delete retires all', async () => {
    const store = createMemoryStateStore();
    const grants = createMemoryGrantStore();
    const state = createObservedState(store);
    const handler = createCellLifecycleHandler(() => ({ state, grants }));
    let advertised: Array<{ tool: string; description: string; kind: string }> = [
      { tool: 'publish', description: 'Publish a blog post', kind: 'act' },
      { tool: 'drafts', description: 'List draft posts', kind: 'read' },
    ];
    __setLambda({
      invoke: () => ({ promise: async () => ({ Payload: JSON.stringify({ ok: true, result: { tools: advertised } }) }) }),
    } as never);
    const ctx = {
      identity: null,
      config: { tableName: 'unused', registry: { cells: 'cells-fn' } },
      events: { emit: async () => {} },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      correlationId: 'test',
    } as unknown as ServiceContext;
    const detail = { cellId: 'blog-1', owner: 'alice', name: 'blog', address: '@alice/blog', files: [], version: '1' };

    await handler(detail, ctx, { source: 'cells', detailType: 'cell.deployed' });
    const caps = await state.query('alice', { prefix: '_caps/' });
    expect(caps.entries.map((e) => e.key).sort()).toEqual(['_caps/@alice/blog.drafts', '_caps/@alice/blog.publish']);
    const pub = caps.entries.find((e) => e.key === '_caps/@alice/blog.publish')!;
    expect(pub._meta.type).toBe('capability');
    expect((pub.value as { target: string }).target).toBe('@alice/blog.publish');
    expect((pub.value as { kind: string }).kind).toBe('act');

    // Redeploy with one tool gone → the stale capability is superseded.
    advertised = [{ tool: 'publish', description: 'Publish a blog post', kind: 'act' }];
    await handler(detail, ctx, { source: 'cells', detailType: 'cell.deployed' });
    const after = await state.query('alice', { prefix: '_caps/' });
    expect(after.entries.map((e) => e.key)).toEqual(['_caps/@alice/blog.publish']);

    // Delete → everything superseded.
    await handler(detail, ctx, { source: 'cells', detailType: 'cell.delete.requested' });
    const gone = await state.query('alice', { prefix: '_caps/' });
    expect(gone.entries).toEqual([]);
  });
});

// ─── ADR-0050 move 4: the recall digest ─────────────────────────────

import { runTend, createCapabilityTouchHandler } from '../services/workspace/event-handlers';

describe('recall digest (ADR-0050 — seq-validated write-behind)', () => {
  it('a bare recall caches; the cache serves until a write invalidates it', async () => {
    __resetTypeDeclsCache();
    const store = createMemoryStateStore();
    const grants = createMemoryGrantStore();
    const state = createObservedState(store);
    const cmds = createWorkspaceCommands(() => ({ state, grants, store }));
    const ctx = ctxFor('alice');
    await cmds.remember({ key: 'k1', value: 'first' }, ctx);

    const first = await cmds.recall(undefined, ctx);
    if (!('overview' in first)) throw new Error('expected overview');
    expect(first.overview.total).toBe(1);
    const digest = await store.get('alice', '_index/overview');
    expect(digest).not.toBeNull(); // write-behind landed
    expect(digest!.writer).toBe('platform/digest');

    // Served from cache: identical result, and the digest is NOT content
    // (total stays 1 — the cache record never counts itself).
    const second = await cmds.recall(undefined, ctx);
    if (!('overview' in second)) throw new Error('expected overview');
    expect(second).toEqual(first);

    // A write advances seq → the digest is stale → recomputed with the new fact.
    await cmds.remember({ key: 'k2', value: 'second' }, ctx);
    const third = await cmds.recall(undefined, ctx);
    if (!('overview' in third)) throw new Error('expected overview');
    expect(third.overview.total).toBe(2);
    expect(Object.keys(third.focus).sort()).toEqual(['k1', 'k2']);
    __resetTypeDeclsCache();
  });

  it('shaped/goal-conditioned recalls bypass the digest', async () => {
    __resetTypeDeclsCache();
    const store = createMemoryStateStore();
    const grants = createMemoryGrantStore();
    const state = createObservedState(store);
    const cmds = createWorkspaceCommands(() => ({ state, grants, store }));
    const ctx = ctxFor('alice');
    await cmds.remember({ key: 'k1', value: 'v' }, ctx);
    await cmds.recall(undefined, ctx); // primes the digest
    const lensed = await cmds.recall({ view: 'overview', lens: 'durable' }, ctx);
    if (!('overview' in lensed)) throw new Error('expected overview');
    // A lensed read never serves (or overwrites) the bare digest; the full
    // view is likewise untouched by caching.
    const full = await cmds.recall({ view: 'full' }, ctx);
    expect('entries' in full).toBe(true);
    __resetTypeDeclsCache();
  });
});

describe('workspace core verbs as capability facts (ADR-0052, tend-reconciled)', () => {
  it('runTend seeds _caps/workspace.* once and is diff-only on the second pass', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    const ctx = ctxFor(null);
    await runTend(state, 'alice', ctx, 'test', { user: 'platform/tend', scopes: [] }, store);
    const caps = await state.query('alice', { prefix: '_caps/workspace.' });
    expect(caps.total).toBeGreaterThan(10);
    const recallCap = caps.entries.find((e) => e.key === '_caps/workspace.recall')!;
    expect(recallCap._meta.type).toBe('capability');
    expect((recallCap.value as { kind: string }).kind).toBe('read');
    expect(caps.entries.some((e) => e.key === '_caps/workspace.search')).toBe(false); // deprecated alias skipped
    // F8 (membrane wave 1): the summary must not truncate at "e.g." — link's
    // first sentence contains one, and the old regex cut it to "…slice (e."
    const linkCap = caps.entries.find((e) => e.key === '_caps/workspace.link')!;
    const linkSummary = (linkCap.value as { summary: string }).summary;
    expect(linkSummary).toContain('e.g.'); // survived the abbreviation
    expect(linkSummary.length).toBeGreaterThan(80); // the whole first sentence, not the stub
    const revBefore = recallCap._meta.revision;
    await runTend(state, 'alice', ctx, 'test', { user: 'platform/tend', scopes: [] }, store);
    const again = await state.query('alice', { prefix: '_caps/workspace.recall' });
    expect(again.entries[0]._meta.revision).toBe(revBefore); // unchanged → no rewrite
  });
});

// ─── ADR-0085: capabilities rise through salience ───────────────────

describe('the participant key stamps write provenance (ADR-0086 Inc 1)', () => {
  it('a write by a participant-carrying identity records _meta.as beside via; authority is untouched', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    const probe: Identity = { user: 'alice', scopes: [], participant: 'membrane-probe/IP-1' };
    const e = await state.put({ scope: 'r', key: 'k', value: 1, via: 'probe:test' }, probe);
    expect(e._meta.as).toBe('membrane-probe/IP-1'); // the embodied actor
    expect(e._meta.writer).toBe('alice'); // the verified principal — unchanged
    expect(e._meta.via).toBe('probe:test'); // as sits BESIDE via, not inside it
    // A rewrite without a participant clears the stamp: `as` records the LAST
    // write's embodied actor, exactly like writer/via record the last write.
    const e2 = await state.put({ scope: 'r', key: 'k', value: 2 }, alice);
    expect(e2._meta.as).toBeUndefined();
  });
});

describe('capability usage feeds salience (ADR-0085 Inc 0)', () => {
  it('state.touch bumps actor-classed counters without a read; an absent key is a silent no-op', async () => {
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    await state.put({ scope: 'r', key: '_caps/workspace.remember', value: { target: 'workspace.remember' } }, platform);
    await state.touch('r', '_caps/workspace.remember', alice, 'read');
    await state.touch('r', '_caps/workspace.remember', agent, 'write');
    const rec = await store.get('r', '_caps/workspace.remember');
    expect(rec?.touches?.pw).toBe(1); // the put folded its own platform-write touch
    expect(rec?.touches?.hr).toBe(1); // human read via touch
    expect(rec?.touches?.aw).toBe(1); // agent write via touch
    // Absent key: no throw, nothing created (recordTouch's conditional no-op).
    await expect(state.touch('r', '_caps/@nobody/void.tool', alice)).resolves.toBeUndefined();
    expect(await store.get('r', '_caps/@nobody/void.tool')).toBeNull();
  });

  it('capability.invoked from the gateway touches _caps/<target>; foreign sources are refused', async () => {
    const store = createMemoryStateStore();
    const grants = createMemoryGrantStore();
    const state = createObservedState(store);
    const handler = createCapabilityTouchHandler(() => ({ state, grants }));
    await state.put({ scope: 'alice', key: '_caps/workspace.remember', value: { target: 'workspace.remember' } }, platform);
    const ctx = ctxFor(null); // the handler derives everything from the event detail

    // An act-kind dispatch by an agent embodiment → one agent-write counter.
    await handler(
      { scope: 'alice', target: 'workspace.remember', kind: 'act', actor: 'agent' },
      ctx,
      { source: 'gateway', detailType: 'capability.invoked' },
    );
    // A read-kind dispatch by a human → one human-read counter.
    await handler(
      { scope: 'alice', target: 'workspace.remember', kind: 'read', actor: 'human' },
      ctx,
      { source: 'gateway', detailType: 'capability.invoked' },
    );
    let rec = await store.get('alice', '_caps/workspace.remember');
    expect(rec?.touches?.aw).toBe(1);
    expect(rec?.touches?.hr).toBe(1);

    // A spoofed source must not count — only the gateway's dispatch path may
    // claim a capability was used.
    await handler(
      { scope: 'alice', target: 'workspace.remember', kind: 'act', actor: 'agent' },
      ctx,
      { source: 'mallory', detailType: 'capability.invoked' },
    );
    rec = await store.get('alice', '_caps/workspace.remember');
    expect(rec?.touches?.aw).toBe(1); // unchanged
  });
});

describe('presence rides the capability event (ADR-0086 Inc 2)', () => {
  it('a participant-keyed dispatch refreshes a lease-expiring _presence fact; refreshes throttle', async () => {
    const store = createMemoryStateStore();
    const grants = createMemoryGrantStore();
    const state = createObservedState(store);
    const handler = createCapabilityTouchHandler(() => ({ state, grants }));
    const ctx = ctxFor(null);
    const meta = { source: 'gateway', detailType: 'capability.invoked' };

    await handler({ scope: 'alice', target: 'workspace.peek', kind: 'read', actor: 'agent', participant: 'probe/IP-1' }, ctx, meta);
    const p = await store.get('alice', '_presence/probe/IP-1');
    expect(p).not.toBeNull();
    expect(p?.as).toBe('probe/IP-1'); // participant-stamped provenance
    expect(p?.timerEffect).toBe('delete'); // a lease: absence needs no reaper
    expect(p?.timerExpiresAt).toBeTruthy();
    expect((p?.value as { lastTarget: string }).lastTarget).toBe('workspace.peek');
    const rev = p!.revision;

    // Same target within the throttle window → no rewrite (no write noise).
    await handler({ scope: 'alice', target: 'workspace.peek', kind: 'read', actor: 'agent', participant: 'probe/IP-1' }, ctx, meta);
    expect((await store.get('alice', '_presence/probe/IP-1'))!.revision).toBe(rev);

    // A different verb refreshes what the participant is "holding".
    await handler({ scope: 'alice', target: '@c15r/machine.step', kind: 'act', actor: 'agent', participant: 'probe/IP-1' }, ctx, meta);
    const p2 = await store.get('alice', '_presence/probe/IP-1');
    expect(p2!.revision).toBe(rev + 1);
    expect((p2!.value as { lastTarget: string }).lastTarget).toBe('@c15r/machine.step');

    // No participant key → no presence fact (the bare connection stays implicit).
    await handler({ scope: 'alice', target: 'workspace.query', kind: 'read' }, ctx, meta);
    const all = await store.list('alice', '_presence/');
    expect(all.map((r) => r.key)).toEqual(['_presence/probe/IP-1']);
  });
});

describe('tier-1 capability projection covers all three providers (ADR-0085 Inc 1)', () => {
  it('runTend projects auth/cells verbs via describeTools and retires deprecated aliases', async () => {
    __resetTypeDeclsCache();
    const store = createMemoryStateStore();
    const state = createObservedState(store);
    // A previously projected fact for a now-DEPRECATED alias (the pre-0085
    // writer only skipped `search`) — the reconciler must retire it.
    await state.put(
      { scope: 'alice', key: '_caps/workspace.neighbors', value: { target: 'workspace.neighbors' }, type: 'capability', tags: ['capability'] },
      platform,
    );
    const ctx = {
      ...ctxFor('alice'),
      serviceClient: (cell: string) => ({
        command: async () => ({
          tools:
            cell === 'auth'
              ? [{ name: 'mintToken', description: 'Mint a bearer token narrowed to your own standing. Details follow.', kind: 'act' }]
              : [{ name: 'list', description: 'List the dynamic cells you own.', kind: 'read' }],
        }),
      }),
    } as unknown as ServiceContext;

    await runTend(state, 'alice', ctx, 'test', { user: 'platform/tend', scopes: [] }, store);

    const caps = await state.query('alice', { prefix: '_caps/', limit: 200 });
    const keys = caps.entries.map((e) => e.key);
    expect(keys).toContain('_caps/workspace.remember');
    expect(keys).toContain('_caps/auth.mintToken');
    expect(keys).toContain('_caps/cells.list');
    expect(keys).not.toContain('_caps/workspace.neighbors'); // deprecated → retired

    const mint = caps.entries.find((e) => e.key === '_caps/auth.mintToken')!;
    expect(mint._meta.type).toBe('capability');
    expect((mint.value as { kind: string }).kind).toBe('act');
    expect((mint.value as { summary: string }).summary).toBe('Mint a bearer token narrowed to your own standing.');
    expect((mint.value as { cell: string }).cell).toBe('auth');
  });
});

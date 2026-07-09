/**
 * Workspace cell — the vocabulary over observed state, scoped per user.
 *
 * Drives the command factory with the in-memory store (the same seam the auth
 * cell uses to stay off DynamoDB in tests). Verifies: writes are scoped to the
 * caller's slice, recall is salience-shaped, supersede retires without deleting,
 * one user cannot see another's slice, and `remember` announces a fact event.
 */
import { createWorkspaceCommands, createSubstrateWriteHandler, createTendHandler, createCellLifecycleHandler, createDataFileMirrorHandler, createFactReactionHandler, createReindexHandler, __resetTypeDeclsCache } from '../services/workspace/handlers';
import { resolveParams } from '../services/workspace/subscriptions';
import { stripUndefined } from '../platform/runtime/state-store-codec';
import { createMemoryGrantStore } from '../services/workspace/grants';
import { createObservedState, createMemoryStateStore, MemoryVectorStore, HashingEmbedder, embeddableText, metadataForFact, indexForScope } from '../platform/runtime';
import type { ServiceContext } from '../platform/runtime';

/** A minimal ServiceContext for a given caller; captures emitted events. */
function ctxFor(user: string | null): { ctx: ServiceContext; emitted: Array<{ type: string; payload: unknown }> } {
  const emitted: Array<{ type: string; payload: unknown }> = [];
  const ctx = {
    identity: user ? { user, scopes: ['workspace:write', 'workspace:read'] } : null,
    config: { tableName: 'unused-in-memory' },
    events: { emit: async (type: string, payload: unknown) => void emitted.push({ type, payload }) },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as ServiceContext;
  return { ctx, emitted };
}

describe('workspace cell', () => {
  // One shared substrate + one grant store across callers — the "one Substrate";
  // slices are by scope, views are assembled per caller.
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));

  it('remembers a fact in the caller slice and announces it', async () => {
    const { ctx, emitted } = ctxFor('alice');
    const e = await cmds.remember({ key: 'phase', value: 'planning', via: 'remember' }, ctx);
    expect(e.value).toBe('planning');
    expect(e._meta.writer).toBe('alice');
    expect(e._meta.via).toBe('remember');
    expect(emitted).toEqual([
      { type: 'workspace.fact.written', payload: { scope: 'alice', key: 'phase', revision: 1 } },
    ]);
  });

  it('recall({view:"full"}) returns the caller view, salience-shaped with a _shaping summary', async () => {
    const { ctx } = ctxFor('alice');
    const res = await cmds.recall({ view: 'full' }, ctx);
    if (!('entries' in res)) throw new Error('expected full view');
    expect(res.entries.phase.value).toBe('planning');
    expect(res._shaping.elision).toBe('auto');
    expect(res._shaping.counts.total).toBeGreaterThanOrEqual(1);
  });

  it('a bare recall() returns a succinct overview with counts + top focus + drill hints (ADR-0033)', async () => {
    const { ctx } = ctxFor('alice');
    const res = await cmds.recall(undefined, ctx);
    if (!('overview' in res)) throw new Error('expected overview');
    expect(res.overview.total).toBeGreaterThanOrEqual(1);
    expect(res.overview.byType.length).toBeGreaterThanOrEqual(1);
    expect(res.overview.byPrefix.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(res.focus).length).toBeGreaterThanOrEqual(1);
    expect(res.hints.some((h) => h.includes('query'))).toBe(true);
    expect(res.hints.some((h) => h.includes('view: "full"'))).toBe(true);
    // The full view is still one arg away.
    const full = await cmds.recall({ view: 'full' }, ctx);
    expect('entries' in full).toBe(true);
  });

  it('isolates slices — bob cannot see alice', async () => {
    const { ctx: bob } = ctxFor('bob');
    await cmds.remember({ key: 'phase', value: 'bob-only' }, bob);
    const bobView = await cmds.recall({ elision: 'none' }, bob);
    expect(Object.keys(bobView.entries)).toEqual(['phase']);
    expect(bobView.entries.phase.value).toBe('bob-only');

    const { ctx: alice } = ctxFor('alice');
    const aliceView = await cmds.recall({ elision: 'none' }, alice);
    expect(aliceView.entries.phase.value).toBe('planning');
  });

  it('peek fetches one fact; supersede retires it without deleting', async () => {
    const { ctx } = ctxFor('alice');
    expect((await cmds.peek({ key: 'phase' }, ctx))?.value).toBe('planning');

    const sup = await cmds.supersede({ key: 'phase' }, ctx);
    expect(sup?._meta.supersededBy).toBeNull(); // retired (no successor)

    const def = await cmds.recall({ view: 'full' }, ctx);
    if (!('entries' in def)) throw new Error('expected full view');
    expect(def.entries.phase).toBeUndefined(); // hidden from the default view
    expect((await cmds.peek({ key: 'phase' }, ctx))?.value).toBe('planning'); // still there
  });

  it('rejects unauthenticated callers', async () => {
    const { ctx } = ctxFor(null);
    await expect(cmds.remember({ key: 'x', value: 1 }, ctx)).rejects.toThrow();
  });

  it('ingest writes a batch with one announcement; vocabulary writes are refused whole', async () => {
    const { ctx, emitted } = ctxFor('alice');
    const res = await cmds.ingest(
      {
        via: 'import',
        facts: [
          { key: 'inbox/a', value: { content: 'first' }, type: 'capture', tags: ['inbox'] },
          { key: 'inbox/b', value: { content: 'second' }, type: 'capture', tags: ['inbox', 'log:2026-06-11'] },
        ],
      },
      ctx,
    );
    expect(res).toEqual({ ingested: 2, errors: [] });
    expect(emitted).toEqual([{ type: 'workspace.ingested', payload: { scope: 'alice', count: 2, errors: 0 } }]);
    const a = await cmds.peek({ key: 'inbox/a' }, ctx);
    expect(a?._meta.via).toBe('import');
    expect(a?._meta.type).toBe('capture');

    // Declarations stay deliberate — the whole batch is refused up front.
    await expect(
      cmds.ingest({ facts: [{ key: 'ok', value: 1 }, { key: '_actions/evil', value: 1 }] }, ctx),
    ).rejects.toThrow(/vocabulary/);
    expect(await cmds.peek({ key: 'ok' }, ctx)).toBeNull();

    // Per-fact CAS failures are reported, not fatal.
    const partial = await cmds.ingest(
      { facts: [{ key: 'inbox/a', value: 'dupe', ifAbsent: true }, { key: 'inbox/c', value: 'new' }] },
      ctx,
    );
    expect(partial.ingested).toBe(1);
    expect(partial.errors[0].key).toBe('inbox/a');
  });
});

describe('workspace sharing / view layer', () => {
  // One Substrate; recall assembles each caller's view (own slice ∪ granted).
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));

  beforeAll(async () => {
    await cmds.remember({ key: 'roadmap', value: 'Q3 plan' }, ctxFor('alice').ctx);
    await cmds.remember({ key: 'secret', value: 'private' }, ctxFor('alice').ctx);
    await cmds.remember({ key: 'mine', value: 'bob stuff' }, ctxFor('bob').ctx);
  });

  it('shares a single key into the grantee view, namespaced by owner, and announces it', async () => {
    const { ctx: alice, emitted } = ctxFor('alice');
    const g = await cmds.share({ to: 'bob', key: 'roadmap' }, alice);
    expect(g).toMatchObject({ owner: 'alice', grantee: 'bob', key: 'roadmap' });
    expect(emitted).toContainEqual({
      type: 'workspace.shared',
      payload: { owner: 'alice', grantee: 'bob', key: 'roadmap', mode: 'read' },
    });

    const bobView = await cmds.recall({ elision: 'none' }, ctxFor('bob').ctx);
    expect(bobView.entries['mine'].value).toBe('bob stuff'); // own slice
    expect(bobView.entries['alice/roadmap'].value).toBe('Q3 plan'); // granted subset
    expect(bobView.entries['alice/secret']).toBeUndefined(); // not granted
  });

  it('leaves the owner view unchanged (alice never sees bob)', async () => {
    const aliceView = await cmds.recall({ elision: 'none' }, ctxFor('alice').ctx);
    expect(Object.keys(aliceView.entries).sort()).toEqual(['roadmap', 'secret']);
  });

  it('unshare revokes visibility', async () => {
    await cmds.unshare({ to: 'bob', key: 'roadmap' }, ctxFor('alice').ctx);
    const bobView = await cmds.recall({ elision: 'none' }, ctxFor('bob').ctx);
    expect(bobView.entries['alice/roadmap']).toBeUndefined();
    expect(bobView.entries['mine'].value).toBe('bob stuff');
  });

  it('whole-slice share exposes every non-superseded fact of the owner', async () => {
    await cmds.share({ to: 'bob' }, ctxFor('alice').ctx); // no key → whole slice
    const bobView = await cmds.recall({ elision: 'none' }, ctxFor('bob').ctx);
    expect(bobView.entries['alice/roadmap'].value).toBe('Q3 plan');
    expect(bobView.entries['alice/secret'].value).toBe('private');
  });

  it('shared() reports outgoing and incoming grants', async () => {
    const aliceShared = await cmds.shared(undefined, ctxFor('alice').ctx);
    expect(aliceShared.shared.some((g) => g.grantee === 'bob' && g.key === '*')).toBe(true);
    expect(aliceShared.receiving).toEqual([]);

    const bobShared = await cmds.shared(undefined, ctxFor('bob').ctx);
    expect(bobShared.receiving.some((g) => g.owner === 'alice' && g.key === '*')).toBe(true);
    expect(bobShared.shared).toEqual([]);
  });

  it('grants() is the authority self-model: scope, slice, and the grant layer in one read', async () => {
    const me = await cmds.grants(undefined, ctxFor('bob').ctx);
    expect(me.principal).toBe('bob');
    expect(me.slice).toBe('bob'); // own partition — full authority
    // layer 1 — token scope (active + ceiling); ctxFor stamps workspace:read/write
    expect(me.scope.active).toEqual(expect.arrayContaining(['workspace:read', 'workspace:write']));
    expect(me.scope.ceiling).toEqual(expect.arrayContaining(['workspace:read', 'workspace:write']));
    // layer 2 — the grant subsets: bob receives alice's whole-slice share
    expect(me.grant.receiving.some((g) => g.owner === 'alice' && g.key === '*')).toBe(true);
    expect(Array.isArray(me.grant.shared)).toBe(true);
    expect(Array.isArray(me.grant.groups)).toBe(true);
    expect(typeof me.hint).toBe('string');
  });

  it('describeTools advertises the whole vocabulary for the /mcp gateway', async () => {
    const { tools } = await cmds.describeTools(undefined, ctxFor('alice').ctx);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'peek', 'recall', 'remember', 'ingest', 'shared', 'grants', 'share', 'supersede', 'unshare',
        'group', 'groups',
        'query', 'search', 'link', 'unlink', 'neighbors', 'graph', 'members', 'changes', 'attention',
        'registerAction', 'actions', 'deleteAction', 'invoke', 'reindex', 'project', 'pruneSimilar', 'suggestions', 'ratify',
        'registerView', 'views', 'view', 'deleteView', 'links', 'tend',
        'registerSubscription', 'subscriptions', 'deleteSubscription',
        'requestGrant', 'grantRequests', 'approveGrant', 'denyGrant', 'athena',
        // ADR-0068 (C1) declaration surface + ADR-0069 (C3) edge query — the legacy
        // verbs above remain as aliases during the deprecation window.
        'declare', 'declarations', 'undeclare', 'evaluate', 'edges',
        // ADR-0072 (C7): the contradiction-candidate read (Stage A).
        'contested',
      ].sort(),
    );
    // Per-slice ops gate on ownership AND a verb scope derived from kind, so a
    // token's read/write consent is enforced (reads → read:workspace, acts →
    // write:workspace). tend/reindex/pruneSimilar stay the operator-only
    // workspace:admin override; athena is the cross-slice SQL surface, admin-only
    // (platform:*) until the lake is partitioned per-slice.
    expect(
      tools.every((t) =>
        t.name === 'tend' || t.name === 'reindex' || t.name === 'project' || t.name === 'pruneSimilar'
          ? t.scope === 'workspace:admin'
          : t.name === 'athena'
            ? t.scope === 'platform:*'
            : t.scope === (t.kind === 'read' ? 'read:workspace' : 'write:workspace'),
      ),
    ).toBe(true);
    expect(tools.find((t) => t.name === 'tend')!.scope).toBe('workspace:admin');
    expect(tools.find((t) => t.name === 'reindex')!.scope).toBe('workspace:admin');
    expect(tools.find((t) => t.name === 'pruneSimilar')!.scope).toBe('workspace:admin');
    expect(tools.find((t) => t.name === 'athena')!.scope).toBe('platform:*');
    expect(tools.find((t) => t.name === 'recall')!.scope).toBe('read:workspace');
    expect(tools.find((t) => t.name === 'remember')!.scope).toBe('write:workspace');
    // Every tool ships a JSON Schema the gateway can surface to clients.
    expect(tools.every((t) => (t.inputSchema as { type?: string }).type === 'object')).toBe(true);
    const remember = tools.find((t) => t.name === 'remember')!;
    expect(remember.inputSchema).toMatchObject({ required: ['key', 'value'] });
    // Each tool declares read/act so the gateway can route read vs act dispatch.
    expect(remember.kind).toBe('act');
    expect(tools.find((t) => t.name === 'recall')!.kind).toBe('read');
    expect(new Set(tools.map((t) => t.kind))).toEqual(new Set(['read', 'act']));
  });
});

describe('workspace audiences (public + groups)', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));

  beforeAll(async () => {
    await cmds.remember({ key: 'docs/intro', value: 'public intro' }, ctxFor('c15r').ctx);
    await cmds.remember({ key: 'docs/guide', value: 'public guide' }, ctxFor('c15r').ctx);
    await cmds.remember({ key: 'private', value: 'just me' }, ctxFor('c15r').ctx);
    await cmds.remember({ key: 'team/notes', value: 'team only' }, ctxFor('c15r').ctx);
  });

  it('a public share surfaces in every viewer\'s recall, owner-namespaced', async () => {
    await cmds.share({ to: 'public', key: 'docs/*' }, ctxFor('c15r').ctx);
    for (const who of ['emily', 'bob']) {
      const view = await cmds.recall({ elision: 'none' }, ctxFor(who).ctx);
      expect(view.entries['c15r/docs/intro'].value).toBe('public intro');
      expect(view.entries['c15r/docs/guide'].value).toBe('public guide');
      expect(view.entries['c15r/private']).toBeUndefined();
    }
  });

  it('public shares are read-only — write mode is refused', async () => {
    await expect(cmds.share({ to: 'public', key: 'docs/*', mode: 'write' }, ctxFor('c15r').ctx)).rejects.toThrow(/read-only/);
  });

  it('a public share is reflected as a `_public/<pattern>` fact in the owner\'s slice (for in-slice renderers)', async () => {
    const own = await cmds.query({ prefix: '_public/' }, ctxFor('c15r').ctx);
    const marker = own.entries.find((e) => e.key === '_public/docs/*');
    expect(marker).toBeDefined();
    expect((marker!.value as { pattern: string }).pattern).toBe('docs/*');
    // unshare retracts the reflection.
    await cmds.unshare({ to: 'public', key: 'docs/*' }, ctxFor('c15r').ctx);
    const after = await cmds.query({ prefix: '_public/' }, ctxFor('c15r').ctx);
    expect(after.entries.find((e) => e.key === '_public/docs/*')).toBeUndefined();
    // restore for downstream tests.
    await cmds.share({ to: 'public', key: 'docs/*' }, ctxFor('c15r').ctx);
  });

  it('peek through a public grant resolves for any caller', async () => {
    const e = await cmds.peek({ owner: 'c15r', key: 'docs/intro' }, ctxFor('emily').ctx);
    expect(e?.value).toBe('public intro');
    await expect(cmds.peek({ owner: 'c15r', key: 'private' }, ctxFor('emily').ctx)).rejects.toThrow(/grant_denied/);
  });

  it('a group share is visible only to its members, and patching membership adds/removes visibility', async () => {
    const g = await cmds.group({ name: 'reviewers', members: ['emily'], label: 'Reviewers' }, ctxFor('c15r').ctx);
    expect(g).toMatchObject({ name: 'reviewers', members: ['emily'], label: 'Reviewers' });
    await cmds.share({ to: 'group:reviewers', key: 'team/*' }, ctxFor('c15r').ctx);

    // member sees it…
    let emily = await cmds.recall({ elision: 'none' }, ctxFor('emily').ctx);
    expect(emily.entries['c15r/team/notes'].value).toBe('team only');
    // …non-member does not.
    const bob = await cmds.recall({ elision: 'none' }, ctxFor('bob').ctx);
    expect(bob.entries['c15r/team/notes']).toBeUndefined();

    // remove emily → her view loses it.
    await cmds.group({ name: 'reviewers', remove: ['emily'] }, ctxFor('c15r').ctx);
    emily = await cmds.recall({ elision: 'none' }, ctxFor('emily').ctx);
    expect(emily.entries['c15r/team/notes']).toBeUndefined();

    // add bob → his view gains it.
    await cmds.group({ name: 'reviewers', add: ['bob'] }, ctxFor('c15r').ctx);
    const bob2 = await cmds.recall({ elision: 'none' }, ctxFor('bob').ctx);
    expect(bob2.entries['c15r/team/notes'].value).toBe('team only');
  });

  it('groups() lists the owner\'s audiences with membership', async () => {
    const { groups } = await cmds.groups(undefined, ctxFor('c15r').ctx);
    const reviewers = groups.find((g) => g.name === 'reviewers');
    expect(reviewers?.members).toEqual(['bob']);
    expect(reviewers?.label).toBe('Reviewers');
  });

  it('the owner is never a member of their own audience, and `public` cannot be added', async () => {
    const g = await cmds.group({ name: 'team', members: ['c15r', 'public', 'emily'] }, ctxFor('c15r').ctx);
    expect(g.members).toEqual(['emily']);
  });

  it('group definitions are a reserved namespace — write-through cannot forge membership', async () => {
    await cmds.share({ to: 'mallory', key: '*', mode: 'write' }, ctxFor('c15r').ctx);
    await expect(
      cmds.remember({ owner: 'c15r', key: '_groups/reviewers', value: { members: ['mallory'] } }, ctxFor('mallory').ctx),
    ).rejects.toThrow(/reserved/);
  });
});

describe('workspace substrate primitives (query / CAS / links / changes / attention)', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));
  const alice = (): ServiceContext => ctxFor('alice').ctx;

  beforeAll(async () => {
    await cmds.remember({ key: 'd1', value: 'choose dynamo', type: 'decision', tags: ['storage', 'substrate'] }, alice());
    await cmds.remember({ key: 'd2', value: 'one table', type: 'decision', tags: ['storage'] }, alice());
    await cmds.remember({ key: 't1', value: 'wire links', type: 'todo', tags: ['substrate'] }, alice());
    await cmds.remember({ key: 'note', value: 'untyped' }, alice());
  });

  it('query filters by type, tag, and prefix, with a limit', async () => {
    const decisions = await cmds.query({ type: 'decision' }, alice());
    expect(decisions.entries.map((e) => e.key).sort()).toEqual(['d1', 'd2']);

    const tagged = await cmds.query({ tag: 'substrate' }, alice());
    expect(tagged.entries.map((e) => e.key).sort()).toEqual(['d1', 't1']);

    const both = await cmds.query({ type: 'decision', tag: 'substrate' }, alice());
    expect(both.entries.map((e) => e.key)).toEqual(['d1']);

    const prefixed = await cmds.query({ prefix: 'd' }, alice());
    expect(prefixed.entries.map((e) => e.key).sort()).toEqual(['d1', 'd2']);

    const limited = await cmds.query({ rankBy: 'recency', limit: 1 }, alice());
    expect(limited.count).toBe(1); // ranking ties same-ms writes arbitrarily; limit is the contract
  });

  it('query rankBy recency puts a fresh write first', async () => {
    // A distinct, later timestamp: stub Date.now via a real later write.
    await new Promise((r) => setTimeout(r, 5));
    await cmds.remember({ key: 'freshest', value: 'now' }, alice());
    const ranked = await cmds.query({ rankBy: 'recency' }, alice());
    expect(ranked.entries[0].key).toBe('freshest');
  });

  it('type and tags surface in _meta and are preserved on an untyped rewrite', async () => {
    const e = await cmds.remember({ key: 'd1', value: 'choose dynamo (v2)' }, alice());
    expect(e._meta.type).toBe('decision');
    expect(e._meta.tags).toEqual(['storage', 'substrate']);
    expect(e._meta.revision).toBe(2);
  });

  it('conditional writes: ifAbsent and ifRevision enforce CAS', async () => {
    await expect(cmds.remember({ key: 'd1', value: 'x', ifAbsent: true }, alice())).rejects.toThrow(/precondition_failed/);
    await expect(cmds.remember({ key: 'd1', value: 'x', ifRevision: 1 }, alice())).rejects.toThrow(/precondition_failed/);
    // The happy paths: correct revision, and 0 for "must not exist".
    const ok = await cmds.remember({ key: 'd1', value: 'claimed', ifRevision: 2 }, alice());
    expect(ok._meta.revision).toBe(3);
    const fresh = await cmds.remember({ key: 'claim-slot', value: 'me', ifRevision: 0 }, alice());
    expect(fresh._meta.revision).toBe(1);
  });

  it('link/neighbors traverse typed edges in both directions', async () => {
    await cmds.link({ from: 't1', rel: 'grounds', to: 'd1' }, alice());
    await cmds.link({ from: 'd2', rel: 'refines', to: 'd1' }, alice());

    const around = await cmds.neighbors({ key: 'd1' }, alice());
    // Authored edges only here; the derived backbone (instanceOf → _types/decision) is asserted separately.
    expect(around.inbound.filter((e) => !e.derived).map((e) => `${e.from}-${e.rel}`).sort()).toEqual(['d2-refines', 't1-grounds']);
    expect(around.outbound.filter((e) => !e.derived)).toEqual([]);
    expect(Object.keys(around.entries).sort()).toEqual(['d2', 't1']); // neighbor entries included

    const onlyGrounds = await cmds.neighbors({ key: 'd1', dir: 'in', rel: 'grounds' }, alice());
    expect(onlyGrounds.inbound.map((e) => e.from)).toEqual(['t1']);

    await cmds.unlink({ from: 'd2', rel: 'refines', to: 'd1' }, alice());
    expect((await cmds.neighbors({ key: 'd1' }, alice())).inbound.map((e) => e.from)).toEqual(['t1']);
  });

  it('links lists every edge in the slice, with prefix filtering', async () => {
    const all = await cmds.links(undefined, alice());
    expect(all.edges.length).toBeGreaterThanOrEqual(1);
    const filtered = await cmds.links({ prefix: 't1' }, alice());
    expect(filtered.edges.every((e) => e.from.startsWith('t1') || e.to.startsWith('t1'))).toBe(true);
    expect(filtered.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('supersede migrateLinks carries edges to the successor', async () => {
    await cmds.remember({ key: 'd1v2', value: 'successor decision', type: 'decision' }, alice());
    await cmds.supersede({ key: 'd1', by: 'd1v2', migrateLinks: true }, alice());

    const successor = await cmds.neighbors({ key: 'd1v2' }, alice());
    expect(successor.inbound.map((e) => `${e.from}-${e.rel}`)).toEqual(['t1-grounds']);
    expect((await cmds.neighbors({ key: 'd1' }, alice())).inbound).toEqual([]); // old edges gone
  });

  it('changes tails the trajectory from a seq and reports the head', async () => {
    const all = await cmds.changes(undefined, alice());
    expect(all.seq).toBeGreaterThan(0);
    expect(all.events.length).toBeGreaterThan(0);
    expect(all.events.some((e) => e.op === 'link')).toBe(true);

    const tail = await cmds.changes({ sinceSeq: all.seq }, alice());
    expect(tail.events).toEqual([]); // nothing after the head

    await cmds.remember({ key: 'after-head', value: 1 }, alice());
    const next = await cmds.changes({ sinceSeq: all.seq }, alice());
    expect(next.events.map((e) => `${e.op}:${e.key}`)).toEqual(['write:after-head']);
  });

  it('attention surfaces stale, unlinked, and dangling as a derived read', async () => {
    // Everything was written moments ago, so nothing is stale at the default
    // threshold; with staleMs 0 everything live qualifies.
    const att = await cmds.attention({ staleMs: 0 }, alice());
    expect(att.stale.length).toBeGreaterThan(0);
    expect(att.unlinked).toContain('note'); // never linked
    expect(att.unlinked).not.toContain('t1'); // linked
    // d1 was retired *toward* d1v2, so its remaining edges (none) are clean,
    // and no edge should dangle on a retired-without-successor endpoint.
    expect(att.dangling).toEqual([]);

    // Retire the successor with no onward pointer — its inbound edge dangles.
    await cmds.supersede({ key: 'd1v2' }, alice());
    const att2 = await cmds.attention({ staleMs: 0 }, alice());
    expect(att2.dangling.some((d) => d.to === 'd1v2' && d.reason.includes('retired'))).toBe(true);
  });

  it('attention ignores `_` system namespaces unless includeSystem', async () => {
    await cmds.remember({ key: '_canvas/board/el:1', value: { x: 0 } }, alice());
    await cmds.link({ from: '_canvas/board/el:1', rel: 'derived-from', to: '_canvas/board/el:gone' }, alice());
    // A lonely system fact: no links, no history — stale/unlinked when system is surfaced.
    await cmds.remember({ key: '_canvas/board/el:lonely', value: { x: 1 } }, alice());

    // staleMs -1: staleness is strictly age > threshold, and a fact written in
    // this same millisecond has age 0 — 0 would race the clock on fast runners.
    const att = await cmds.attention({ staleMs: -1 }, alice());
    expect(att.stale.map((s) => s.key)).not.toContain('_canvas/board/el:lonely');
    expect(att.unlinked).not.toContain('_canvas/board/el:lonely');
    expect(att.dangling.some((d) => d.from.startsWith('_canvas/'))).toBe(false);

    const withSystem = await cmds.attention({ staleMs: -1, includeSystem: true }, alice());
    expect(withSystem.stale.map((s) => s.key)).toContain('_canvas/board/el:lonely');
    // el:1 is authored-linked → settled, not stale — but its edge to a missing
    // endpoint still dangles.
    expect(withSystem.stale.map((s) => s.key)).not.toContain('_canvas/board/el:1');
    expect(withSystem.dangling.some((d) => d.to === '_canvas/board/el:gone' && d.reason.includes('missing'))).toBe(true);
  });

  it('link reports endpoint existence hints at write time', async () => {
    const sound = await cmds.link({ from: 't1', rel: 'relates', to: 'd2' }, alice());
    expect(sound.fromExists).toBe(true);
    expect(sound.toExists).toBe(true);

    const dangling = await cmds.link({ from: 't1', rel: 'relates', to: 'never-written' }, alice());
    expect(dangling.fromExists).toBe(true);
    expect(dangling.toExists).toBe(false); // allowed, but you learn now — not at the next tend
  });

  it('changes sinceSeq:"head" starts tailing in one call', async () => {
    const head = await cmds.changes({ sinceSeq: 'head' }, alice());
    expect(head.events).toEqual([]);
    expect(head.seq).toBeGreaterThan(0);

    await cmds.remember({ key: 'tail-probe', value: 1 }, alice());
    const next = await cmds.changes({ sinceSeq: head.seq }, alice());
    expect(next.events.map((e) => `${e.op}:${e.key}`)).toEqual(['write:tail-probe']);
  });

  it('changes scope slices the feed server-side; link events carry endpoints (ADR-0055)', async () => {
    const head = (await cmds.changes({ sinceSeq: 'head' }, alice())).seq;
    await cmds.remember({ key: 'sc:el-1', value: { x: 1 } }, alice());
    await cmds.remember({ key: 'sc-noise', value: 'outside the slice' }, alice());
    await cmds.link({ from: 'sc-noise', rel: 'annotates', to: 'sc:el-1' }, alice());
    await cmds.supersede({ key: 'sc:el-1' }, alice());

    // prefixes: only slice events ship; the link matches on its `to` endpoint —
    // an edge INTO the slice is the slice's business even when `from` is not.
    const sliced = await cmds.changes({ sinceSeq: head, scope: { prefixes: ['sc:'] } }, alice());
    expect(sliced.events.map((e) => `${e.op}:${e.key}`)).toEqual(['write:sc:el-1', 'link:sc-noise', 'supersede:sc:el-1']);
    const link = sliced.events.find((e) => e.op === 'link');
    expect(link?.rel).toBe('annotates');
    expect(link?.to).toBe('sc:el-1');

    // ops whitelist drops the link without touching the writes.
    const writes = await cmds.changes({ sinceSeq: head, scope: { prefixes: ['sc:'], ops: ['write', 'supersede'] } }, alice());
    expect(writes.events.map((e) => e.op)).toEqual(['write', 'supersede']);

    // A fully-filtered page is empty while the head seq still advances —
    // clients must read that as progress, not silence.
    const none = await cmds.changes({ sinceSeq: head, scope: { prefixes: ['no-such-prefix/'] } }, alice());
    expect(none.events).toEqual([]);
    expect(none.seq).toBeGreaterThan(head);

    // Filtering precedes windowing: `last: 1` is the newest RELEVANT event.
    const lastOne = await cmds.changes({ last: 1, scope: { prefixes: ['sc:'] } }, alice());
    expect(lastOne.events.map((e) => `${e.op}:${e.key}`)).toEqual(['supersede:sc:el-1']);
  });

  it('changes include:"entries" inlines current card entries, touch-free (ADR-0055 Inc 2)', async () => {
    const head = (await cmds.changes({ sinceSeq: 'head' }, alice())).seq;
    await cmds.remember({ key: 'inc2:a', value: { note: 'live fact' } }, alice());
    await cmds.remember({ key: 'inc2:b', value: 'will be retired' }, alice());
    await cmds.supersede({ key: 'inc2:b' }, alice());
    const touchesBefore = (await store.get('alice', 'inc2:a'))?.touches;

    const page = await cmds.changes({ sinceSeq: head, scope: { prefixes: ['inc2:'] }, include: 'entries' }, alice());
    // One entry per distinct written key, current state, card tier.
    expect(Object.keys(page.entries ?? {}).sort()).toEqual(['inc2:a', 'inc2:b']);
    expect(page.entries?.['inc2:a']?._meta.shaped).toBe('card');
    expect(page.entries?.['inc2:b']?._meta.superseded).toBeTruthy(); // the tombstone marker

    // Touch-free: inlining is a projection read, not attention (ADR-0050) —
    // the fact's read counters must not move because a feed page shipped it.
    expect((await store.get('alice', 'inc2:a'))?.touches).toEqual(touchesBefore);

    // Without include, the page shape is unchanged (no entries field).
    const plain = await cmds.changes({ sinceSeq: head, scope: { prefixes: ['inc2:'] } }, alice());
    expect('entries' in plain).toBe(false);
  });

  it('query pages with limit + cursor and reports the overall total', async () => {
    await cmds.remember({ key: 'page-a', value: 1, type: 'paged' }, alice());
    await cmds.remember({ key: 'page-b', value: 2, type: 'paged' }, alice());
    await cmds.remember({ key: 'page-c', value: 3, type: 'paged' }, alice());

    const first = await cmds.query({ type: 'paged', rankBy: 'recency', limit: 2 }, alice());
    expect(first.count).toBe(2);
    expect(first.total).toBe(3);
    expect(first.nextCursor).toBeDefined();

    const second = await cmds.query({ type: 'paged', rankBy: 'recency', limit: 2, cursor: first.nextCursor }, alice());
    expect(second.count).toBe(1);
    expect(second.nextCursor).toBeUndefined();
    const seen = [...first.entries, ...second.entries].map((e) => e.key).sort();
    expect(seen).toEqual(['page-a', 'page-b', 'page-c']);

    // an unlimited query has no next page
    const all = await cmds.query({ type: 'paged' }, alice());
    expect(all.nextCursor).toBeUndefined();
    expect(all.total).toBe(all.count);
  });
});

describe('inline affordances on reads (ADR-0029 R1 — types map: tool hints + managing cell)', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));

  // A `cells.describeTypes` vocabulary, so `typeDeclsFor` resolves (the test ctx
  // otherwise has no serviceClient → fails closed to {} → no `types` map).
  const VOCAB = {
    decision: { manager: '@c15r/home', icon: '⚖️', label: 'value.title', handlers: { open: '@c15r/home/decision/${id}' } },
    todo: { manager: '@c15r/home', icon: '✅' },
    // `undeclared` is referenced by a fact below but absent here → must be omitted.
  };
  const aliceWithTypes = (): ServiceContext => {
    const { ctx } = ctxFor('alice');
    (ctx as unknown as { serviceClient: (n: string) => { command: (c: string, i: unknown) => Promise<unknown> } }).serviceClient = () => ({
      command: async (cmd: string) => (cmd === 'describeTypes' ? { types: VOCAB } : {}),
    });
    return ctx;
  };

  beforeAll(async () => {
    __resetTypeDeclsCache(); // hermetic: don't inherit a sibling block's vocab cache
    const a = aliceWithTypes();
    await cmds.remember({ key: 'd1', value: { title: 'choose dynamo' }, type: 'decision', tags: ['storage'] }, a);
    await cmds.remember({ key: 't1', value: 'wire links', type: 'todo' }, a);
    await cmds.remember({ key: 'x1', value: 'no decl', type: 'undeclared' }, a);
    await cmds.remember({ key: 'note', value: 'untyped' }, a); // no type → contributes nothing
  });
  afterAll(() => __resetTypeDeclsCache());

  it('query inlines a shared types map: handlers + manager per declared type present', async () => {
    const res = await cmds.query({}, aliceWithTypes());
    expect(res.types).toBeDefined();
    // Declared types present in the result carry their affordance…
    expect(res.types.decision).toEqual({
      icon: '⚖️',
      label: 'value.title',
      handlers: { open: '@c15r/home/decision/${id}' },
      manager: '@c15r/home',
    });
    expect(res.types.todo).toEqual({ icon: '✅', manager: '@c15r/home' });
    // …an undeclared type (no affordance) is omitted, not an empty stub.
    expect(res.types.undeclared).toBeUndefined();
    // Untyped facts contribute no key.
    expect(Object.keys(res.types).sort()).toEqual(['decision', 'todo']);
  });

  it('peek attaches the single fact’s type affordance as a sibling (value/_meta intact)', async () => {
    const e = await cmds.peek({ key: 'd1' }, aliceWithTypes());
    expect((e as { value: { title: string } }).value.title).toBe('choose dynamo');
    expect(e?._meta.type).toBe('decision');
    expect((e as unknown as { types: Record<string, unknown> }).types.decision).toMatchObject({ manager: '@c15r/home' });
  });

  it('recall inlines the types map across the shaped view', async () => {
    const res = await cmds.recall({ elision: 'none' }, aliceWithTypes());
    expect((res as unknown as { types: Record<string, unknown> }).types.decision).toMatchObject({ icon: '⚖️' });
  });

  it('omits the types map entirely when no declared type is present', async () => {
    __resetTypeDeclsCache();
    const { ctx } = ctxFor('alice'); // no serviceClient → vocab unavailable
    const res = await cmds.query({ type: 'todo' }, ctx);
    expect((res as { types?: unknown }).types).toBeUndefined();
    __resetTypeDeclsCache();
  });
});

describe('semantic search (ADR-0030 — vector seam: candidate generation + authoritative re-read)', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const vstore = new MemoryVectorStore();
  const embedder = new HashingEmbedder(128);
  const cmds = createWorkspaceCommands(() => ({ state, grants, vectors: { store: vstore, embedder }, store }));
  // cmds with NO vector backend — to assert graceful degradation.
  const noVecCmds = createWorkspaceCommands(() => ({ state, grants }));
  const VOCAB = { decision: { manager: '@c15r/home', icon: '⚖️' }, note: { manager: '@c15r/home', icon: '📝' } };
  const ctxOf = (u: string): ServiceContext => {
    const ctx = ctxFor(u).ctx;
    (ctx as unknown as { serviceClient: () => { command: (c: string) => Promise<unknown> } }).serviceClient = () => ({
      command: async (cmd: string) => (cmd === 'describeTypes' ? { types: VOCAB } : {}),
    });
    return ctx;
  };

  /** Mirror what the Increment-2 stream indexer will do: embed a fact's text and
   *  upsert its vector into the owner's slice index. */
  async function indexFact(scope: string, key: string, value: unknown, meta: { type?: string; tags?: string[]; superseded?: boolean }): Promise<void> {
    const text = embeddableText(key, value);
    if (!text) return;
    const [vector] = await embedder.embed([text]);
    await vstore.put(indexForScope(scope, embedder.dimension), [{ key, vector, metadata: metadataForFact(meta) }]);
  }

  /** Drive the async, chunked reindex (ADR-0030/0031) to completion: feed the handler
   *  its continuation events until it stops emitting (the embed → edges chain). */
  const reindexHandler = createReindexHandler(() => ({ state, grants, vectors: { store: vstore, embedder }, store }));
  async function drainReindex(scope: string): Promise<void> {
    let detail: Record<string, unknown> = { scope, phase: 'embed', indexed: 0, skipped: 0, edges: 0 };
    for (let i = 0; i < 500; i++) {
      const { ctx, emitted } = ctxFor(null);
      await reindexHandler(detail, ctx, { source: 'workspace', detailType: 'workspace.reindex.requested' });
      const cont = emitted.find((e) => e.type === 'workspace.reindex.requested');
      if (!cont) return; // no continuation → job done
      detail = cont.payload as Record<string, unknown>;
    }
    throw new Error('reindex did not converge');
  }

  beforeAll(async () => {
    __resetTypeDeclsCache();
    // alice's slice — two dynamo decisions + an unrelated auth note.
    await cmds.remember({ key: 'd-dynamo', value: { title: 'Choose a single DynamoDB table for the substrate' }, type: 'decision', tags: ['storage'] }, ctxOf('alice'));
    await cmds.remember({ key: 'd-stream', value: { title: 'Consume the DynamoDB stream to index vectors' }, type: 'decision', tags: ['storage'] }, ctxOf('alice'));
    await cmds.remember({ key: 'n-auth', value: { title: 'Passkey webauthn refresh cookie horizon' }, type: 'note', tags: ['auth'] }, ctxOf('alice'));
    await indexFact('alice', 'd-dynamo', { title: 'Choose a single DynamoDB table for the substrate' }, { type: 'decision', tags: ['storage'] });
    await indexFact('alice', 'd-stream', { title: 'Consume the DynamoDB stream to index vectors' }, { type: 'decision', tags: ['storage'] });
    await indexFact('alice', 'n-auth', { title: 'Passkey webauthn refresh cookie horizon' }, { type: 'note', tags: ['auth'] });
    // bob's slice — one unrelated fact.
    await cmds.remember({ key: 'b1', value: { title: 'Grocery list' }, type: 'note' }, ctxOf('bob'));
    await indexFact('bob', 'b1', { title: 'Grocery list' }, { type: 'note' });
  });
  afterAll(() => __resetTypeDeclsCache());

  it('ranks by meaning and returns the R1 types envelope', async () => {
    const res = await cmds.search({ text: 'dynamodb storage table design' }, ctxOf('alice'));
    expect(res.entries.length).toBeGreaterThanOrEqual(2);
    expect(['d-dynamo', 'd-stream']).toContain(res.entries[0].key); // a dynamo decision ranks first
    expect(res.entries[0].score).toBeGreaterThan(res.entries[res.entries.length - 1].score);
    expect(res.types?.decision).toBeDefined(); // R1 envelope (declared types resolved client-free)
  });

  it('isolates slices — bob’s search never surfaces alice’s facts (structural index boundary)', async () => {
    const res = await cmds.search({ text: 'dynamodb storage table design' }, ctxOf('bob'));
    expect(res.entries.every((e) => !e.key.startsWith('alice/') && e.key !== 'd-dynamo')).toBe(true);
  });

  it('honours a type filter (the granular read:type pin)', async () => {
    const res = await cmds.search({ text: 'dynamodb', type: 'decision' }, ctxOf('alice'));
    expect(res.entries.every((e) => e._meta.type === 'decision')).toBe(true);
    expect(res.entries.some((e) => e.key === 'n-auth')).toBe(false);
  });

  it('folds a grant: a shared prefix surfaces for the grantee, keyed <owner>/<key>, post-filtered by prefix', async () => {
    await cmds.share({ to: 'carol', key: 'd-*' }, ctxOf('alice')); // prefix grant: only d-* keys
    const res = await cmds.search({ text: 'dynamodb stream vectors' }, ctxOf('carol'));
    expect(res.entries.length).toBeGreaterThanOrEqual(1);
    expect(res.entries.every((e) => e.key.startsWith('alice/d-'))).toBe(true); // prefix post-filter
    expect(res.entries.some((e) => e.key === 'alice/n-auth')).toBe(false); // outside the grant prefix
  });

  it('authoritative re-read drops a superseded fact still present in the (stale) index', async () => {
    await cmds.remember({ key: 'tmp', value: { title: 'dynamodb temporary scratch decision' }, type: 'decision' }, ctxOf('alice'));
    await indexFact('alice', 'tmp', { title: 'dynamodb temporary scratch decision' }, { type: 'decision', superseded: false });
    expect((await cmds.search({ text: 'temporary scratch', type: 'decision' }, ctxOf('alice'))).entries.some((e) => e.key === 'tmp')).toBe(true);
    await cmds.supersede({ key: 'tmp' }, ctxOf('alice')); // index NOT updated → still superseded:false there
    const after = await cmds.search({ text: 'temporary scratch', type: 'decision' }, ctxOf('alice'));
    expect(after.entries.some((e) => e.key === 'tmp')).toBe(false); // dropped on re-read (Decision 1)
  });

  it('degrades gracefully with no vector backend (hint, not error)', async () => {
    const res = await noVecCmds.search({ text: 'anything' }, ctxOf('alice'));
    expect(res.entries).toEqual([]);
    expect(res.hint).toMatch(/not configured/i);
  });

  it('requires query text', async () => {
    await expect(cmds.search({ text: '   ' }, ctxOf('alice'))).rejects.toThrow(/text is required/);
  });

  it('reindex (admin) backfills a slice so search finds never-manually-indexed facts', async () => {
    const adminCtx = (): ServiceContext => {
      const ctx = ctxOf('dave');
      (ctx as unknown as { identity: { user: string; scopes: string[] } }).identity = { user: 'dave', scopes: ['workspace:read', 'workspace:write', 'workspace:admin'] };
      return ctx;
    };
    await cmds.remember({ key: 'k1', value: { title: 'Kubernetes ingress controller routing' }, type: 'note' }, adminCtx());
    await cmds.remember({ key: 'k2', value: { title: 'Sourdough starter hydration schedule' }, type: 'note' }, adminCtx());
    // Not indexed yet → search is empty.
    expect((await cmds.search({ text: 'kubernetes ingress' }, adminCtx())).entries).toHaveLength(0);
    // reindex now DISPATCHES async + chunked; the work happens in the handler chain.
    const r = await cmds.reindex(undefined, adminCtx());
    expect(r.status).toBe('started');
    expect(r.poll).toBe('_reindex/dave');
    await drainReindex('dave');
    const status = await cmds.peek({ key: '_reindex/dave' }, adminCtx());
    expect((status?.value as { status: string }).status).toBe('done');
    expect((status?.value as { indexed: number }).indexed).toBeGreaterThanOrEqual(2);
    const res = await cmds.search({ text: 'kubernetes ingress routing' }, adminCtx());
    expect(res.entries[0]?.key).toBe('k1'); // the k8s note, not the sourdough one
  });

  it('reindex requires admin', async () => {
    await expect(cmds.reindex(undefined, ctxOf('alice'))).rejects.toThrow(/admin/);
  });

  it('reindex wires inferred similarTo edges that feed neighbors + centrality (ADR-0031)', async () => {
    const prev = process.env.VECTOR_SIMILAR_MIN_SCORE;
    process.env.VECTOR_SIMILAR_MIN_SCORE = '0.05'; // hashing-embedder cosines run low; ensure edges form
    try {
      const admin = (): ServiceContext => {
        const ctx = ctxOf('erin');
        (ctx as unknown as { identity: { user: string; scopes: string[] } }).identity = { user: 'erin', scopes: ['workspace:read', 'workspace:write', 'workspace:admin'] };
        return ctx;
      };
      // Three facts that share vocabulary → non-trivial pairwise similarity.
      await cmds.remember({ key: 'r1', value: { title: 'DynamoDB single table substrate design' }, type: 'note' }, admin());
      await cmds.remember({ key: 'r2', value: { title: 'DynamoDB stream indexer for the substrate' }, type: 'note' }, admin());
      await cmds.remember({ key: 'r3', value: { title: 'DynamoDB table partition and substrate scopes' }, type: 'note' }, admin());
      expect((await cmds.reindex(undefined, admin())).status).toBe('started');
      await drainReindex('erin');
      const status = await cmds.peek({ key: '_reindex/erin' }, admin());
      expect((status?.value as { status: string }).status).toBe('done');
      expect((status?.value as { edges: number }).edges).toBeGreaterThan(0);

      // The inferred edges are real graph structure: neighbors surfaces them…
      const n = await cmds.neighbors({ key: 'r1' }, admin());
      const similar = n.outbound.filter((e) => e.rel === 'similarTo');
      expect(similar.length).toBeGreaterThan(0);
      expect(similar.every((e) => e.to.startsWith('r'))).toBe(true);
      // …and they carry the inferred-writer stamp (distinguishable from authored edges).
      const raw = await store.listEdges('erin');
      expect(raw.find((e) => e.rel === 'similarTo')?.writer).toBe('platform/vectors');

      // pruneSimilar (ADR-0032): an authored edge between two facts makes the inferred
      // kinship redundant — pruneSimilar deletes it, leaving the authored edge.
      await cmds.link({ from: 'r1', rel: 'grounds', to: 'r2' }, admin());
      const before = (await store.listEdges('erin')).filter((e) => e.rel === 'similarTo' && (e.to === 'r2' || e.from === 'r2'));
      expect(before.length).toBeGreaterThan(0); // a redundant inferred edge exists
      const pr = await cmds.pruneSimilar(undefined, admin());
      expect(pr.status).toBe('pruned');
      expect(pr.pruned).toBeGreaterThan(0);
      const after = await store.listEdges('erin');
      // No inferred similarTo edge survives between the r1↔r2 pair the authored edge connects…
      expect(after.filter((e) => e.rel === 'similarTo' && ((e.from === 'r1' && e.to === 'r2') || (e.from === 'r2' && e.to === 'r1')))).toHaveLength(0);
      // …but the authored edge does.
      expect(after.find((e) => e.rel === 'grounds' && e.from === 'r1' && e.to === 'r2')).toBeDefined();
    } finally {
      if (prev === undefined) delete process.env.VECTOR_SIMILAR_MIN_SCORE;
      else process.env.VECTOR_SIMILAR_MIN_SCORE = prev;
    }
  });

  it('pruneSimilar requires admin', async () => {
    await expect(cmds.pruneSimilar(undefined, ctxOf('alice'))).rejects.toThrow(/admin/);
  });

  it('suggestions lists inferred kinship as ratification candidates; ratify graduates one to a typed authored edge (ADR-0032)', async () => {
    const prev = process.env.VECTOR_SIMILAR_MIN_SCORE;
    process.env.VECTOR_SIMILAR_MIN_SCORE = '0.05';
    try {
      const admin = (): ServiceContext => {
        const ctx = ctxOf('fred');
        (ctx as unknown as { identity: { user: string; scopes: string[] } }).identity = { user: 'fred', scopes: ['workspace:read', 'workspace:write', 'workspace:admin'] };
        return ctx;
      };
      await cmds.remember({ key: 's1', value: { title: 'GraphQL schema stitching across services' }, type: 'note' }, admin());
      await cmds.remember({ key: 's2', value: { title: 'GraphQL federation and schema composition' }, type: 'note' }, admin());
      await cmds.reindex(undefined, admin());
      await drainReindex('fred');

      // suggestions surfaces the inferred pair, enriched with endpoint labels + the vocab.
      const sug = await cmds.suggestions(undefined, admin());
      expect(sug.total).toBeGreaterThan(0);
      expect(sug.vocab).toContain('refines');
      const cand = sug.suggestions.find((c) => (c.from === 's1' && c.to === 's2') || (c.from === 's2' && c.to === 's1'));
      expect(cand).toBeDefined();
      expect(cand!.fromLabel).toMatch(/GraphQL/);

      // ratify promotes it to a typed authored edge and drops the redundant similarTo.
      const res = await cmds.ratify({ from: 's1', to: 's2', rel: 'refines' }, admin());
      expect(res.ratified).toBe(true);
      expect(res.edge.rel).toBe('refines');
      expect(res.dropped).toBeGreaterThan(0);
      const edges = await store.listEdges('fred');
      expect(edges.find((e) => e.rel === 'refines' && e.from === 's1' && e.to === 's2')).toBeDefined();
      expect(edges.filter((e) => e.rel === 'similarTo' && ((e.from === 's1' && e.to === 's2') || (e.from === 's2' && e.to === 's1')))).toHaveLength(0);
      // The ratified edge is authored (writer = the user), not the inferred platform/vectors stamp.
      expect(edges.find((e) => e.rel === 'refines')?.writer).toBe('fred');
    } finally {
      if (prev === undefined) delete process.env.VECTOR_SIMILAR_MIN_SCORE;
      else process.env.VECTOR_SIMILAR_MIN_SCORE = prev;
    }
  });

  it('ratify rejects a self-link', async () => {
    await expect(cmds.ratify({ from: 'x', to: 'x', rel: 'refines' }, ctxOf('alice'))).rejects.toThrow(/self-link/);
  });
});

describe('workspace timers (lease / reveal, evaluated at read)', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));
  const alice = (): ServiceContext => ctxFor('alice').ctx;
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it('a delete-effect timer makes a fact vanish at expiry (the lease)', async () => {
    const e = await cmds.remember({ key: 'claim', value: 'mine', timer: { ms: 40, effect: 'delete' } }, alice());
    expect(e._meta.timer?.effect).toBe('delete');
    expect((await cmds.peek({ key: 'claim' }, alice()))?.value).toBe('mine'); // live now

    await sleep(50);
    expect(await cmds.peek({ key: 'claim' }, alice())).toBeNull(); // lapsed
    const view = await cmds.recall({ elision: 'none' }, alice());
    expect(view.entries['claim']).toBeUndefined(); // hidden from recall too
  });

  it('an enable-effect timer keeps a fact dormant until expiry (the reveal)', async () => {
    await cmds.remember({ key: 'reveal', value: 'later', timer: { ms: 40, effect: 'enable' } }, alice());
    expect(await cmds.peek({ key: 'reveal' }, alice())).toBeNull(); // dormant

    await sleep(50);
    expect((await cmds.peek({ key: 'reveal' }, alice()))?.value).toBe('later'); // revealed
  });

  it('ifAbsent treats an expired lease as absent — the crash-safe re-claim', async () => {
    await cmds.remember({ key: 'slot', value: 'worker-1', ifAbsent: true, timer: { ms: 30, effect: 'delete' } }, alice());
    // While the lease holds, a competing claim fails.
    await expect(
      cmds.remember({ key: 'slot', value: 'worker-2', ifAbsent: true }, alice()),
    ).rejects.toThrow(/precondition_failed/);

    await sleep(40); // the lease lapses — nobody released it
    const reclaimed = await cmds.remember({ key: 'slot', value: 'worker-2', ifAbsent: true }, alice());
    expect(reclaimed.value).toBe('worker-2');
    expect(reclaimed._meta.revision).toBe(2); // physical continuity, monotonic
  });

  it('rejects malformed timers', async () => {
    await expect(
      cmds.remember({ key: 'bad', value: 1, timer: { ms: 10, at: 'now', effect: 'delete' } }, alice()),
    ).rejects.toThrow(/exactly one/);
    await expect(
      cmds.remember({ key: 'bad', value: 1, timer: { ms: -5, effect: 'delete' } }, alice()),
    ).rejects.toThrow(/positive/);
  });
});

describe('workspace declarative actions (the no-code vocabulary tier)', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));
  const alice = (): ServiceContext => ctxFor('alice').ctx;
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it('registers an action as a fact and lists it', async () => {
    const res = await cmds.registerAction(
      {
        action: {
          id: 'set-phase',
          description: 'Move the project phase',
          params: { phase: { type: 'string', enum: ['planning', 'building', 'done'], required: true } },
          writes: [{ key: 'phase', value: '${params.phase}', type: 'status' }],
        },
      },
      alice(),
    );
    expect(res.contested).toEqual([]);
    const listed = await cmds.actions(undefined, alice());
    expect(listed.actions.map((a) => a.id)).toEqual(['set-phase']);
    // The definition is itself a fact in the slice — vocabulary is state.
    expect((await cmds.peek({ key: '_actions/set-phase' }, alice()))?._meta.type).toBe('action');
  });

  it('invoke applies the declared writes with substitution and stamps via', async () => {
    const res = await cmds.invoke({ action: 'set-phase', params: { phase: 'building' } }, alice());
    expect(res.writes).toHaveLength(1);
    expect(res.writes[0].key).toBe('phase');
    expect(res.writes[0].value).toBe('building');
    const phase = await cmds.peek({ key: 'phase' }, alice());
    expect(phase?.value).toBe('building');
    expect(phase?._meta.via).toBe('action:set-phase');
    expect(phase?._meta.type).toBe('status');
  });

  it('validates params against the declared schema', async () => {
    await expect(cmds.invoke({ action: 'set-phase', params: {} }, alice())).rejects.toThrow(/invalid_param/);
    await expect(cmds.invoke({ action: 'set-phase', params: { phase: 'flying' } }, alice())).rejects.toThrow(/invalid_param/);
  });

  it('treats a null/absent OPTIONAL param as absent, not a wrong-type error (no-`text` trigger regression)', async () => {
    // Mirrors the machine `start` action: an optional `text`. A reaction resolved
    // an absent trigger `text` to `null`; the validator then hit `typeof null !==
    // "string"` and silently aborted the reaction, so the run never started.
    await cmds.registerAction(
      {
        action: {
          id: 'start-like',
          description: 'start a run; optional text',
          params: { run: { type: 'string', required: true }, text: { type: 'string', required: false } },
          writes: [{ key: 'srun/${params.run}', value: { run: '${params.run}', text: '${params.text}', status: 'running' }, type: 'machine-run' }],
        },
      },
      alice(),
    );
    // Optional param absent → succeeds. Optional param explicitly null → succeeds
    // (used to throw invalid_param). Both must start the run.
    await expect(cmds.invoke({ action: 'start-like', params: { run: 'a' } }, alice())).resolves.toBeDefined();
    await expect(cmds.invoke({ action: 'start-like', params: { run: 'b', text: null } }, alice())).resolves.toBeDefined();
    expect((await cmds.peek({ key: 'srun/b' }, alice()))?.value).toMatchObject({ run: 'b', status: 'running' });
    await cmds.deleteAction({ id: 'start-like' }, alice()); // shared store — don't leak into the action-list assertions
  });

  it('if conditions gate invocation with a precondition_failed error', async () => {
    await cmds.registerAction(
      {
        action: {
          id: 'ship',
          if: [{ key: 'phase', op: 'eq', value: 'done' }],
          writes: [{ key: 'shipped', value: '${now}' }],
        },
      },
      alice(),
    );
    await expect(cmds.invoke({ action: 'ship' }, alice())).rejects.toThrow(/precondition_failed/);
    await cmds.invoke({ action: 'set-phase', params: { phase: 'done' } }, alice());
    const shipped = await cmds.invoke({ action: 'ship' }, alice());
    expect(shipped.invoked).toBe(true);
  });

  it('surfaces contested write targets at registration (not blocked)', async () => {
    const res = await cmds.registerAction(
      {
        action: { id: 'set-phase-2', writes: [{ key: 'phase', value: 'override' }] },
      },
      alice(),
    );
    expect(res.contested).toEqual([{ target: 'phase', actions: ['set-phase', 'set-phase-2'] }]);
  });

  it('reproduces the canonical claim: ifAbsent + lease timer = atomic, crash-safe hand-off', async () => {
    await cmds.registerAction(
      {
        action: {
          id: 'claim-task',
          description: 'Claim a task for ${self} with a 50ms lease',
          params: { task: { type: 'string', required: true } },
          writes: [
            {
              key: 'task:${params.task}:claim',
              value: { by: '${self}', at: '${now}' },
              ifAbsent: true,
              timer: { ms: 50, effect: 'delete' },
            },
          ],
        },
      },
      alice(),
    );

    const first = await cmds.invoke({ action: 'claim-task', params: { task: 't1' } }, alice());
    expect((first.writes[0].value as { by: string }).by).toBe('alice');

    // Racing second claim → 409-style precondition failure.
    await expect(cmds.invoke({ action: 'claim-task', params: { task: 't1' } }, alice())).rejects.toThrow(
      /precondition_failed/,
    );

    // The claimant crashes (never releases); the lease lapses; the claim frees.
    await sleep(60);
    const reclaim = await cmds.invoke({ action: 'claim-task', params: { task: 't1' } }, alice());
    expect(reclaim.invoked).toBe(true);
  });

  it('deleteAction retires the vocabulary entry', async () => {
    await cmds.deleteAction({ id: 'set-phase-2' }, alice());
    const listed = await cmds.actions(undefined, alice());
    expect(listed.actions.map((a) => a.id).sort()).toEqual(['claim-task', 'set-phase', 'ship']);
    await expect(cmds.invoke({ action: 'set-phase-2' }, alice())).rejects.toThrow(/not_found/);
  });

  it('a declared-action write carries ifVersion proof-of-read (ADR-0066 Inc 2)', async () => {
    // The token rides in via a ${params.*} substitution — parity with sync's
    // action write-templates. Registers + deletes itself to leave the shared
    // vocabulary unchanged for sibling tests.
    await cmds.registerAction(
      {
        action: {
          id: 'por-write',
          description: 'Proof-of-read write to por:${params.k}',
          params: { k: { type: 'string', required: true }, ver: { type: 'string', required: true }, v: { type: 'any' } },
          writes: [{ key: 'por:${params.k}', value: '${params.v}', ifVersion: '${params.ver}' }],
        },
      },
      alice(),
    );

    // ifVersion:"" = create-only
    const created = await cmds.invoke({ action: 'por-write', params: { k: 's', ver: '', v: 'one' } }, alice());
    const token = created.writes[0]._meta.version;
    expect(token).toMatch(/^[0-9a-f]{16}$/);

    // a guessed token is rejected
    await expect(
      cmds.invoke({ action: 'por-write', params: { k: 's', ver: 'deadbeefdeadbeef', v: 'two' } }, alice()),
    ).rejects.toThrow(/precondition_failed/);

    // the token from the create succeeds and rotates the version
    const ok = await cmds.invoke({ action: 'por-write', params: { k: 's', ver: token, v: 'two' } }, alice());
    expect(ok.writes[0].value).toBe('two');
    expect(ok.writes[0]._meta.version).not.toBe(token);

    await cmds.deleteAction({ id: 'por-write' }, alice());
  });

  it('a declared action may not write the vocabulary itself', async () => {
    await expect(
      cmds.registerAction(
        { action: { id: 'sneaky', writes: [{ key: '_actions/set-phase', value: {} }] } },
        alice(),
      ),
    ).rejects.toThrow(/may not write/);
  });

  it('CEL conditions: declared fetch + real expression over { value, exists, params, self }', async () => {
    await cmds.remember({ key: 'task:t9', value: { status: 'open', priority: 5, assignees: ['alice', 'bob'] } }, alice());
    await cmds.registerAction(
      {
        action: {
          id: 'escalate',
          params: { task: { type: 'string', required: true } },
          if: [
            { key: 'task:${params.task}', cel: "exists && value.status == 'open' && value.priority > 3" },
            { cel: 'self in ["alice", "carol"]' }, // no key — pure params/self predicate
          ],
          writes: [{ key: 'task:${params.task}:escalated', value: { by: '${self}' } }],
        },
      },
      alice(),
    );
    const res = await cmds.invoke({ action: 'escalate', params: { task: 't9' } }, alice());
    expect(res.invoked).toBe(true);

    // The expression's verdict gates with the same explained errors as v1.
    await cmds.remember({ key: 'task:t9', value: { status: 'closed', priority: 5 } }, alice());
    await expect(cmds.invoke({ action: 'escalate', params: { task: 't9' } }, alice())).rejects.toThrow(
      /precondition_failed.*status/,
    );
  });

  it('CEL conditions: parse errors refuse registration; non-boolean results fail closed', async () => {
    await expect(
      cmds.registerAction(
        { action: { id: 'broken', if: [{ cel: 'value.' }], writes: [{ key: 'x' }] } },
        alice(),
      ),
    ).rejects.toThrow(/invalid CEL/);

    await cmds.registerAction(
      { action: { id: 'nonbool', if: [{ cel: '1 + 1' }], writes: [{ key: 'x', value: 1 }] } },
      alice(),
    );
    await expect(cmds.invoke({ action: 'nonbool' }, alice())).rejects.toThrow(/precondition_failed/);
  });
});

describe('workspace registered views (the declared read vocabulary)', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));
  const alice = (): ServiceContext => ctxFor('alice').ctx;

  beforeAll(async () => {
    await cmds.remember({ key: 'todo:a', value: { title: 'wire views', effort: 2 }, type: 'todo' }, alice());
    await cmds.remember({ key: 'todo:b', value: { title: 'ship views', effort: 3 }, type: 'todo' }, alice());
    await cmds.remember({ key: 'note', value: 'unrelated' }, alice());
  });

  it('registers a view as a fact, lists and evaluates it (count + render hint)', async () => {
    const def = await cmds.registerView(
      {
        view: {
          id: 'open-todos',
          query: { type: 'todo' },
          reduce: 'count',
          render: { type: 'metric', label: 'Open todos' },
        },
      },
      alice(),
    );
    expect(def.id).toBe('open-todos');
    expect((await cmds.views(undefined, alice())).views.map((v) => v.id)).toEqual(['open-todos']);
    // Vocabulary is state: the definition is a fact.
    expect((await cmds.peek({ key: '_views/open-todos' }, alice()))?._meta.type).toBe('view');

    const res = await cmds.view({ id: 'open-todos' }, alice());
    expect(res.value).toBe(2);
    expect(res.count).toBe(2);
    expect(res.render).toEqual({ type: 'metric', label: 'Open todos' });
  });

  it('evaluates sum and latest reductions', async () => {
    await cmds.registerView(
      { view: { id: 'total-effort', query: { type: 'todo' }, reduce: 'sum', path: 'effort' } },
      alice(),
    );
    expect((await cmds.view({ id: 'total-effort' }, alice())).value).toBe(5);

    await cmds.registerView({ view: { id: 'latest-todo', query: { type: 'todo' }, reduce: 'latest' } }, alice());
    const latest = await cmds.view({ id: 'latest-todo' }, alice());
    expect((latest.value as { key: string }).key).toBeDefined();
  });

  it('a prefix-less view does not observe the vocabulary itself', async () => {
    await cmds.registerView({ view: { id: 'everything', query: {} } }, alice());
    const res = await cmds.view({ id: 'everything' }, alice());
    const keys = (res.value as Array<{ key: string }>).map((e) => e.key);
    expect(keys.some((k) => k.startsWith('_views/') || k.startsWith('_actions/'))).toBe(false);
    expect(keys).toContain('note');
  });

  it('deleteView retires the definition', async () => {
    await cmds.deleteView({ id: 'everything' }, alice());
    expect((await cmds.views(undefined, alice())).views.map((v) => v.id).sort()).toEqual([
      'latest-todo', 'open-todos', 'total-effort',
    ]);
    await expect(cmds.view({ id: 'everything' }, alice())).rejects.toThrow(/not_found/);
  });

  it('rejects malformed views', async () => {
    await expect(cmds.registerView({ view: { id: 'bad/slash', query: {} } }, alice())).rejects.toThrow(/must not contain/);
    await expect(
      cmds.registerView({ view: { id: 'bad', query: {}, reduce: 'median' as never } }, alice()),
    ).rejects.toThrow(/reduce/);
  });

  it('CEL filter narrows the query before reduce; eval errors fail closed per entry', async () => {
    await cmds.registerView(
      {
        view: {
          id: 'heavy-todos',
          query: { type: 'todo' },
          // `note` has a string value — value.effort errors there; it is a todo-typed
          // query anyway, but the >= guard is what selects within the type.
          filter: 'value.effort >= 3',
          reduce: 'count',
        },
      },
      alice(),
    );
    expect((await cmds.view({ id: 'heavy-todos' }, alice())).value).toBe(1);

    // A broken expression can never be registered.
    await expect(
      cmds.registerView({ view: { id: 'bad-cel', query: {}, filter: 'value.' } }, alice()),
    ).rejects.toThrow(/valid CEL/);
  });
});

describe('workspace tending (attention distilled into an audit fact)', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));

  it('tend writes tending/latest with counts, samples, and provenance, and announces it', async () => {
    const { ctx, emitted } = ctxFor('alice');
    await cmds.remember({ key: 'lonely', value: 'no links here' }, ctx);
    const report = await cmds.tend(undefined, ctx);
    expect(report.scope).toBe('alice');
    expect(report.unlinked).toBeGreaterThanOrEqual(1);
    expect(report.unlinkedSample).toContain('lonely');
    expect(emitted).toContainEqual({
      type: 'workspace.tended',
      payload: { scope: 'alice', stale: report.stale, unlinked: report.unlinked, dangling: report.dangling },
    });
    const fact = await cmds.peek({ key: 'tending/latest' }, ctx);
    expect(fact?._meta.type).toBe('audit');
    expect(fact?._meta.tags).toContain('tending');
    expect((fact?.value as { unlinked: number }).unlinked).toBe(report.unlinked);
  });

  it('the scheduled handler tends each requested scope as platform/tend', async () => {
    const handler = createTendHandler(() => ({ state, grants }));
    const { ctx } = ctxFor(null);
    await handler({ scopes: ['alice'] }, { ...ctx, identity: { scopes: [] } } as never, {
      source: 'platform.tend',
      detailType: 'workspace.tend.requested',
    });
    const fact = await cmds.peek({ key: 'tending/latest' }, ctxFor('alice').ctx);
    expect(fact?._meta.writer).toBe('platform/tend');
    expect(fact?._meta.via).toBe('tend:schedule');
  });
});

describe('workspace substrate-write handler (the organ-to-reef path)', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));
  const handler = createSubstrateWriteHandler(() => ({ state, grants }));

  /** A bus-event ctx: no caller identity; a stubbed cells.resolveCell. */
  function busCtx(resolved: { owner: string; name?: string } | null): ServiceContext {
    const base = ctxFor(null).ctx as unknown as Record<string, unknown>;
    return {
      ...base,
      identity: { scopes: [] },
      serviceClient: () => ({
        command: async (cmd: string) => {
          if (cmd !== 'resolveCell') throw new Error(`unexpected command ${cmd}`);
          return resolved;
        },
      }),
    } as unknown as ServiceContext;
  }

  it('applies an IAM-attested cell write into the owner slice with the cell as writer', async () => {
    await handler(
      { key: 'sensor:reading', value: { temp: 21 }, type: 'reading' },
      busCtx({ owner: 'alice', name: 'thermo' }),
      { source: 'cell-thermo-abc123', detailType: 'substrate.write.requested' },
    );
    const view = await cmds.recall({ elision: 'none' }, ctxFor('alice').ctx);
    const fact = view.entries['sensor:reading'];
    expect(fact.value).toEqual({ temp: 21 });
    expect(fact._meta.writer).toBe('@alice/thermo');
    expect(fact._meta.via).toBe('@alice/thermo');
    expect(fact._meta.type).toBe('reading');
  });

  it('refuses non-cell sources, missing keys, unknown cells, malformed vocabulary, and sharing namespaces', async () => {
    // None of these should write anything.
    await handler({ key: 'x', value: 1 }, busCtx({ owner: 'alice' }), { source: 'rogue', detailType: 'substrate.write.requested' });
    await handler({ value: 1 }, busCtx({ owner: 'alice' }), { source: 'cell-a', detailType: 'substrate.write.requested' });
    await handler({ key: 'x', value: 1 }, busCtx(null), { source: 'cell-a', detailType: 'substrate.write.requested' });
    // Malformed vocabulary is refused by the registry's own validation.
    await handler({ key: '_actions/evil', value: 1 }, busCtx({ owner: 'alice' }), { source: 'cell-a', detailType: 'substrate.write.requested' });
    await handler({ key: '_views/evil', value: 1 }, busCtx({ owner: 'alice' }), { source: 'cell-a', detailType: 'substrate.write.requested' });
    // Sharing/visibility authority is the caller's, never an organ's.
    await handler({ key: '_groups/evil', value: { members: ['mallory'] } }, busCtx({ owner: 'alice' }), { source: 'cell-a', detailType: 'substrate.write.requested' });
    await handler({ key: '_public/evil', value: {} }, busCtx({ owner: 'alice' }), { source: 'cell-a', detailType: 'substrate.write.requested' });

    const view = await cmds.recall({ elision: 'none' }, ctxFor('alice').ctx);
    expect(view.entries['x']).toBeUndefined();
    expect(view.entries['_actions/evil']).toBeUndefined();
    expect(view.entries['_views/evil']).toBeUndefined();
    expect(view.entries['_groups/evil']).toBeUndefined();
    expect(view.entries['_public/evil']).toBeUndefined();
  });

  it('lets a cell seed its own cell-required actions and views (validated, contested-detected, tagged)', async () => {
    // A well-formed declared action via the organ path — the cell's program,
    // not organic knowledge: routed through the same registry as caller
    // registration, attributed to the cell, tagged `cell-required`.
    await handler(
      { key: '_actions/machine.advance', value: { description: 'advance a run', writes: [{ key: 'machine-run/${params.id}', value: { at: '${now}' } }], params: { id: { type: 'string', required: true } } } },
      busCtx({ owner: 'alice', name: 'machine' }),
      { source: 'cell-machine-xyz', detailType: 'substrate.write.requested' },
    );
    await handler(
      { key: '_views/machine.runs', value: { description: 'all machine runs', query: { type: 'machine-run' } } },
      busCtx({ owner: 'alice', name: 'machine' }),
      { source: 'cell-machine-xyz', detailType: 'substrate.write.requested' },
    );

    const action = await cmds.peek({ key: '_actions/machine.advance' }, ctxFor('alice').ctx);
    expect(action?._meta.type).toBe('action');
    expect(action?._meta.writer).toBe('@alice/machine');
    expect(action?._meta.tags).toContain('cell-required');
    expect((action?.value as { id: string }).id).toBe('machine.advance');
    // It is a first-class declared action: listable and invocable like any other.
    const listed = await cmds.actions({}, ctxFor('alice').ctx);
    expect(listed.actions.some((a) => a.id === 'machine.advance')).toBe(true);

    const viewFact = await cmds.peek({ key: '_views/machine.runs' }, ctxFor('alice').ctx);
    expect(viewFact?._meta.type).toBe('view');
    expect(viewFact?._meta.tags).toContain('cell-required');
  });

  it('lets a cell retire its own seeded vocabulary via organ supersede, but refuses other `_` vocabulary', async () => {
    const cell = busCtx({ owner: 'alice', name: 'machine' });
    const meta = { source: 'cell-machine-xyz', detailType: 'substrate.write.requested' };
    // Seed an action + a subscription the cell manages, then a plain renderer fact.
    await handler({ key: '_actions/machine.toRetire', value: { description: 'temp', writes: [{ key: 'k/${params.id}', value: {} }], params: { id: { type: 'string', required: true } } } }, cell, meta);
    await handler({ key: '_subscriptions/machine.toRetire', value: { id: 'machine.toRetire', match: { keyPrefix: 'machine-run/' }, invoke: 'machine.advance', params: { id: '${keySuffix}' } } }, cell, meta);
    await handler({ key: '_renderers/machine', value: { type: 'machine', source: 'x' } }, cell, meta);
    expect((await cmds.actions({}, ctxFor('alice').ctx)).actions.some((a) => a.id === 'machine.toRetire')).toBe(true);
    expect((await cmds.subscriptions({}, ctxFor('alice').ctx)).subscriptions.some((s) => s.id === 'machine.toRetire')).toBe(true);

    // The cell retires the action + subscription through the same registries — the
    // reconcile path a re-definition uses to clean up rails/branches it dropped.
    await handler({ key: '_actions/machine.toRetire', op: 'supersede' }, cell, meta);
    await handler({ key: '_subscriptions/machine.toRetire', op: 'supersede' }, cell, meta);
    expect((await cmds.actions({}, ctxFor('alice').ctx)).actions.some((a) => a.id === 'machine.toRetire')).toBe(false);
    expect((await cmds.subscriptions({}, ctxFor('alice').ctx)).subscriptions.some((s) => s.id === 'machine.toRetire')).toBe(false);

    // Non-registry `_` vocabulary supersede stays refused — the renderer is intact.
    await handler({ key: '_renderers/machine', op: 'supersede' }, cell, meta);
    const renderer = await cmds.peek({ key: '_renderers/machine' }, ctxFor('alice').ctx);
    expect(renderer?._meta.superseded).toBe(false);
  });
});

describe('cell lifecycle projection (the platform reflected in the substrate)', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));
  const handler = createCellLifecycleHandler(() => ({ state, grants }));

  const busCtx = () =>
    ({ ...(ctxFor(null).ctx as unknown as Record<string, unknown>), identity: { scopes: [] } } as unknown as ServiceContext);
  const event = (detailType: string, detail: Record<string, unknown>, source = 'cells') =>
    handler(detail, busCtx(), { source, detailType });

  it('projects create → deploy into a cells/<id> pointer fact in the owner slice', async () => {
    await event('cell.create.requested', {
      cellId: 'notes-abc', owner: 'alice', name: 'notes', address: '@alice/notes', public: false, description: 'scratch',
    });
    let fact = await cmds.peek({ key: 'cells/notes-abc' }, ctxFor('alice').ctx);
    expect(fact?._meta.type).toBe('cell');
    expect(fact?._meta.tags).toContain('cell');
    expect(fact?._meta.writer).toBe('platform/cells');
    expect(fact?.value).toMatchObject({ cellId: 'notes-abc', name: 'notes', address: '@alice/notes', status: 'CREATING' });

    await event('cell.deployed', {
      cellId: 'notes-abc', owner: 'alice', name: 'notes', address: '@alice/notes', public: true,
      version: '123', files: ['index.ts', 'client/main.tsx'], clientEntry: 'client/main.tsx', staticFiles: [],
    });
    fact = await cmds.peek({ key: 'cells/notes-abc' }, ctxFor('alice').ctx);
    expect(fact?.value).toMatchObject({
      status: 'ACTIVE', public: true, version: '123', files: ['index.ts', 'client/main.tsx'], dirty: false,
    });
  });

  it('tracks file mutations as a dirty manifest until the next deploy', async () => {
    await event('cell.files.changed', { cellId: 'notes-abc', owner: 'alice', name: 'notes', op: 'write', paths: ['lib/util.ts'] });
    let value = (await cmds.peek({ key: 'cells/notes-abc' }, ctxFor('alice').ctx))?.value as { files: string[]; dirty: boolean };
    expect(value.dirty).toBe(true);
    expect(value.files).toContain('lib/util.ts');

    await event('cell.files.changed', { cellId: 'notes-abc', owner: 'alice', name: 'notes', op: 'delete', paths: ['lib/util.ts'] });
    value = (await cmds.peek({ key: 'cells/notes-abc' }, ctxFor('alice').ctx))?.value as { files: string[]; dirty: boolean };
    expect(value.files).not.toContain('lib/util.ts');

    await event('cell.deployed', { cellId: 'notes-abc', owner: 'alice', name: 'notes', version: '124', files: ['index.ts'] });
    value = (await cmds.peek({ key: 'cells/notes-abc' }, ctxFor('alice').ctx))?.value as { files: string[]; dirty: boolean };
    expect(value).toMatchObject({ files: ['index.ts'], dirty: false });
  });

  it('marks deletion, refuses non-cells sources, and is queryable by type', async () => {
    await event('cell.delete.requested', { cellId: 'notes-abc', owner: 'alice' });
    const fact = await cmds.peek({ key: 'cells/notes-abc' }, ctxFor('alice').ctx);
    expect((fact?.value as { status: string }).status).toBe('DELETED');
    expect((fact?.value as { name: string }).name).toBe('notes'); // preserved from prior

    await event('cell.deployed', { cellId: 'evil-xyz', owner: 'alice', name: 'evil' }, 'cell-evil-xyz');
    expect(await cmds.peek({ key: 'cells/evil-xyz' }, ctxFor('alice').ctx)).toBeNull();

    const byType = await cmds.query({ type: 'cell' }, ctxFor('alice').ctx);
    expect(byType.entries.some((e) => e.key === 'cells/notes-abc')).toBe(true);
  });
});

describe('data-blob file mirror — text inlining for search (ADR-0030 blob extraction)', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));
  const mirror = createDataFileMirrorHandler(() => ({ state, grants }));
  const busCtx = () => ({ ...(ctxFor(null).ctx as unknown as Record<string, unknown>), identity: { scopes: [] } } as unknown as ServiceContext);
  const dataChanged = (detail: Record<string, unknown>) => mirror(detail, busCtx(), { source: 'cells', detailType: 'cell.data.changed' });

  it('inlines a text blob’s content (searchable) and leaves a binary blob a thin pointer', async () => {
    // A text blob: putData carried a `content` preview → the file fact inlines it.
    await dataChanged({ cellId: 'notes-abc', owner: 'alice', name: 'notes', user: 'alice', key: 'memo.md', bytes: 20, contentType: 'text/markdown', content: '# Roadmap\nship search' });
    const textFact = await cmds.peek({ key: 'file/cells/notes-abc/data/memo.md' }, ctxFor('alice').ctx);
    expect((textFact?.value as { content?: string }).content).toBe('# Roadmap\nship search');
    expect(embeddableText('file/cells/notes-abc/data/memo.md', textFact?.value)).toContain('ship search'); // full-text searchable

    // A binary blob: no `content` on the event → the fact stays a pointer (no bytes copied).
    await dataChanged({ cellId: 'notes-abc', owner: 'alice', name: 'notes', user: 'alice', key: 'logo.png', bytes: 9000, contentType: 'image/png' });
    const binFact = await cmds.peek({ key: 'file/cells/notes-abc/data/logo.png' }, ctxFor('alice').ctx);
    expect((binFact?.value as { content?: string }).content).toBeUndefined();
    expect((binFact?.value as { s3Key: string }).s3Key).toBe('cells/notes-abc/data/alice/logo.png');
  });
});

describe('workspace granular grants (write-through / prefix / request loop)', () => {
  // Fresh substrate per suite; the same one-Substrate/many-views layout.
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));

  it('prefix shares expose just the covered keys', async () => {
    const alice = ctxFor('alice').ctx;
    await cmds.remember({ key: 'inbox/one', value: 1 }, alice);
    await cmds.remember({ key: 'inbox/two', value: 2 }, alice);
    await cmds.remember({ key: 'private/x', value: 'no' }, alice);
    await cmds.share({ to: 'bob', key: 'inbox/*' }, alice);

    const bobView = await cmds.recall({ elision: 'none' }, ctxFor('bob').ctx);
    expect(bobView.entries['alice/inbox/one'].value).toBe(1);
    expect(bobView.entries['alice/inbox/two'].value).toBe(2);
    expect(bobView.entries['alice/private/x']).toBeUndefined();
  });

  it('peek reads through a grant with owner, and refuses uncovered keys with the escalation hint', async () => {
    const bob = ctxFor('bob').ctx;
    expect((await cmds.peek({ key: 'inbox/one', owner: 'alice' }, bob))?.value).toBe(1);
    await expect(cmds.peek({ key: 'private/x', owner: 'alice' }, bob)).rejects.toThrow(/grant_denied.*requestGrant/s);
  });

  it('write-through requires a write grant covering the key; provenance stamps the grantee', async () => {
    const alice = ctxFor('alice').ctx;
    const bob = ctxFor('bob').ctx;

    // Read grants do not allow writes.
    await expect(
      cmds.remember({ key: 'inbox/from-bob', value: 'hi', owner: 'alice' }, bob),
    ).rejects.toThrow(/grant_denied/);

    await cmds.share({ to: 'bob', key: 'inbox/*', mode: 'write' }, alice);
    const entry = await cmds.remember({ key: 'inbox/from-bob', value: 'hi', owner: 'alice' }, bob);
    expect(entry._meta.writer).toBe('bob'); // attribution for free
    expect((await cmds.peek({ key: 'inbox/from-bob' }, alice))?.value).toBe('hi');

    // The grant is a boundary, not a door: uncovered keys and reserved
    // namespaces stay refused even under a write grant.
    await expect(cmds.remember({ key: 'private/x', value: 'no', owner: 'alice' }, bob)).rejects.toThrow(/grant_denied/);
    await cmds.share({ to: 'bob', mode: 'write' }, alice); // whole slice
    await expect(
      cmds.remember({ key: '_actions/evil', value: 1, owner: 'alice' }, bob),
    ).rejects.toThrow(/reserved/);
    await expect(
      cmds.remember({ key: '_grants/requests/forged', value: 1, owner: 'alice' }, bob),
    ).rejects.toThrow(/reserved/);
    await cmds.unshare({ to: 'bob' }, alice);
  });

  it('runs the request → inbox → approve loop for a workspace resource', async () => {
    const carol = ctxFor('carol');
    const res = await cmds.requestGrant(
      { resource: 'workspace:alice:notes/*:write', note: 'porting your notes' },
      carol.ctx,
    );
    expect(res.owner).toBe('alice');
    expect(carol.emitted).toContainEqual({
      type: 'workspace.grant.requested',
      payload: { owner: 'alice', requester: 'carol', resource: 'workspace:alice:notes/*:write' },
    });

    // The owner sees it in the inbox, with the requester stamped by the platform.
    const alice = ctxFor('alice');
    const inbox = await cmds.grantRequests(undefined, alice.ctx);
    expect(inbox.incoming).toHaveLength(1);
    expect(inbox.incoming[0]).toMatchObject({
      requester: 'carol',
      resource: 'workspace:alice:notes/*:write',
      note: 'porting your notes',
      status: 'pending',
    });

    const approved = await cmds.approveGrant({ key: inbox.incoming[0].key }, alice.ctx);
    expect(approved).toMatchObject({ approved: true, grantee: 'carol' });

    // The grant is live: carol can write through immediately.
    const entry = await cmds.remember({ key: 'notes/first', value: 'hello', owner: 'alice' }, carol.ctx);
    expect(entry._meta.writer).toBe('carol');

    // The inbox is drained and the answer landed in carol's slice.
    expect((await cmds.grantRequests(undefined, alice.ctx)).incoming).toHaveLength(0);
    const answers = (await cmds.grantRequests(undefined, carol.ctx)).answers;
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ resource: 'workspace:alice:notes/*:write', status: 'approved', by: 'alice' });
  });

  it('deny resolves the request with a reason the requester can read', async () => {
    const dave = ctxFor('dave').ctx;
    await cmds.requestGrant({ resource: 'workspace:alice:*:read' }, dave);
    const alice = ctxFor('alice').ctx;
    const inbox = await cmds.grantRequests(undefined, alice);
    const req = inbox.incoming.find((r) => r.requester === 'dave');
    expect(req).toBeDefined();
    await cmds.denyGrant({ key: req!.key, reason: 'too broad — ask for a prefix' }, alice);

    const answers = (await cmds.grantRequests(undefined, dave)).answers;
    expect(answers[0]).toMatchObject({ status: 'denied', reason: 'too broad — ask for a prefix' });
    // And dave got nothing.
    await expect(cmds.peek({ key: 'inbox/one', owner: 'alice' }, dave)).rejects.toThrow(/grant_denied/);
  });

  it('routes cell-family approvals to the cells service', async () => {
    const emily = ctxFor('emily').ctx;
    await cmds.requestGrant({ resource: 'cell:alice/regwatch:review' }, emily);

    const calls: Array<{ name: string; payload: unknown }> = [];
    const { ctx: alice } = ctxFor('alice');
    (alice as unknown as { serviceClient: unknown }).serviceClient = () => ({
      command: async (name: string, payload: unknown) => {
        calls.push({ name, payload });
        return {};
      },
    });

    const inbox = await cmds.grantRequests(undefined, alice);
    const req = inbox.incoming.find((r) => r.requester === 'emily');
    await cmds.approveGrant({ key: req!.key }, alice);
    expect(calls).toEqual([
      { name: 'grant', payload: { owner: 'alice', name: 'regwatch', principal: 'emily', tools: ['review'] } },
    ]);
  });

  it('rejects malformed resources and self-requests with teaching errors', async () => {
    const bob = ctxFor('bob').ctx;
    await expect(cmds.requestGrant({ resource: 'workspace:alice:inbox' }, bob)).rejects.toThrow(/Malformed resource/);
    await expect(cmds.requestGrant({ resource: 'nonsense' }, bob)).rejects.toThrow(/Malformed resource/);
    await expect(
      cmds.requestGrant({ resource: 'workspace:bob:*:read' }, bob),
    ).rejects.toThrow(/you own this resource/);
  });
});

describe('workspace reactions (subscriptions → declared actions, the generic reactive primitive)', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));
  const react = createFactReactionHandler(() => ({ state, grants }));

  const busCtx = () =>
    ({ ...(ctxFor(null).ctx as unknown as Record<string, unknown>), identity: { scopes: [] } } as unknown as ServiceContext);
  const fire = (scope: string, key: string, revision: number) =>
    react({ scope, key, revision }, busCtx(), { source: 'workspace', detailType: 'workspace.fact.written' });

  it('registers an auto-rail action + a subscription, then a fact change advances the run', async () => {
    const alice = ctxFor('alice').ctx;
    // Two auto rails as declared actions, guarded by the run's current node.
    await cmds.registerAction(
      { action: { id: 'A-to-B', if: [{ key: 'run/${params.run}', path: 'node', op: 'eq', value: 'A' }], writes: [{ key: 'run/${params.run}', value: { node: 'B' }, type: 'run' }], params: { run: { type: 'string', required: true } } } },
      alice,
    );
    await cmds.registerAction(
      { action: { id: 'B-to-C', if: [{ key: 'run/${params.run}', path: 'node', op: 'eq', value: 'B' }], writes: [{ key: 'run/${params.run}', value: { node: 'C' }, type: 'run' }], params: { run: { type: 'string', required: true } } } },
      alice,
    );
    // Both rails subscribe to run/* changes; each fires only when its guard holds.
    await cmds.registerSubscription({ subscription: { id: 'r-A-to-B', match: { keyPrefix: 'run/' }, invoke: 'A-to-B', params: { run: '${keySuffix}' } } }, alice);
    await cmds.registerSubscription({ subscription: { id: 'r-B-to-C', match: { keyPrefix: 'run/' }, invoke: 'B-to-C', params: { run: '${keySuffix}' } } }, alice);

    await cmds.remember({ key: 'run/r1', value: { node: 'A' }, type: 'run' }, alice);
    // Reacting to the run's changes drives the deterministic prefix to its
    // terminal node: each pass fires whichever rail's guard holds, converging
    // at C (no rail leaves C). Extra fires at C are clean no-ops.
    for (let rev = 1; rev <= 4; rev++) await fire('alice', 'run/r1', rev);
    expect((await cmds.peek({ key: 'run/r1' }, alice))?.value).toEqual({ node: 'C' });
  });

  it('re-emits fact.written for each reactive write so the next rail can react', async () => {
    const { ctx: alice, emitted } = ctxFor('alice');
    await cmds.registerAction(
      { action: { id: 'mark', writes: [{ key: 'flag/${params.id}', value: { done: true }, type: 'flag' }], params: { id: { type: 'string', required: true } } } },
      alice,
    );
    await cmds.registerSubscription({ subscription: { id: 'on-thing', match: { type: 'thing' }, invoke: 'mark', params: { id: '${keySuffix}' } } }, alice);
    await cmds.remember({ key: 'thing/x', value: 1, type: 'thing' }, alice);

    const { ctx: busc, emitted: busEmitted } = ctxFor('alice');
    await react({ scope: 'alice', key: 'thing/x', revision: 1 }, busc, { source: 'workspace', detailType: 'workspace.fact.written' });
    expect((await cmds.peek({ key: 'flag/thing/x' }, alice))?.value).toEqual({ done: true });
    // The reaction's write is itself announced, so downstream subscriptions chain.
    expect(busEmitted).toContainEqual({ type: 'workspace.fact.written', payload: { scope: 'alice', key: 'flag/thing/x', revision: 1 } });
    void emitted;
  });

  it('honours the depth cap (loop bound) and the cel match', async () => {
    const alice = ctxFor('alice').ctx;
    await cmds.registerAction(
      { action: { id: 'bump', writes: [{ key: 'ctr/${params.id}', value: { n: 1 }, type: 'ctr' }], params: { id: { type: 'string', required: true } } } },
      alice,
    );
    // maxDepth 2: a fact change at revision 3 must not fire.
    await cmds.registerSubscription({ subscription: { id: 'capped', match: { keyPrefix: 'ctr/' }, invoke: 'bump', params: { id: '${keySuffix}' }, maxDepth: 2 } }, alice);
    await cmds.remember({ key: 'ctr/c1', value: { n: 0 }, type: 'ctr' }, alice);
    await fire('alice', 'ctr/c1', 3); // over the cap → skipped
    expect((await cmds.peek({ key: 'ctr/c1' }, alice))?.value).toEqual({ n: 0 });

    // cel match: only fire when value.ready is true.
    await cmds.registerAction(
      { action: { id: 'go', writes: [{ key: 'gate/${params.id}', value: { open: true }, type: 'gate' }], params: { id: { type: 'string', required: true } } } },
      alice,
    );
    await cmds.registerSubscription({ subscription: { id: 'cel-gate', match: { keyPrefix: 'item/', cel: 'value.ready == true' }, invoke: 'go', params: { id: '${keySuffix}' } } }, alice);
    await cmds.remember({ key: 'item/i1', value: { ready: false }, type: 'item' }, alice);
    await fire('alice', 'item/i1', 1);
    expect(await cmds.peek({ key: 'gate/i1' }, alice)).toBeNull(); // cel false → no fire
    await cmds.remember({ key: 'item/i1', value: { ready: true }, type: 'item' }, alice);
    await fire('alice', 'item/i1', 2);
    expect((await cmds.peek({ key: 'gate/i1' }, alice))?.value).toEqual({ open: true }); // cel true → fired
  });

  it('delivers to a cell tool (as the slice owner) when a subscription uses `deliver`', async () => {
    const delivered: Array<{ target: unknown; args: unknown; asUser: string }> = [];
    const reactDeliver = createFactReactionHandler(
      () => ({ state, grants }),
      async (target, args, asUser) => {
        delivered.push({ target, args, asUser });
      },
    );
    const alice = ctxFor('alice').ctx;
    // No declared action needed — the reaction hands off to a cell tool.
    await cmds.registerSubscription(
      { subscription: { id: 'agent-rail', match: { keyPrefix: 'arun/', cel: 'value.node == "decide"' }, deliver: '@alice/models.decide', params: { run: '${keySuffix}' } } },
      alice,
    );
    await cmds.remember({ key: 'arun/x9', value: { node: 'decide', machine: 'm' }, type: 'machine-run' }, alice);
    await reactDeliver({ scope: 'alice', key: 'arun/x9', revision: 1 }, ctxFor('alice').ctx, { source: 'workspace', detailType: 'workspace.fact.written' });

    expect(delivered).toEqual([
      { target: { owner: 'alice', name: 'models', tool: 'decide' }, args: { run: 'x9' }, asUser: 'alice' },
    ]);
  });

  it('rejects a subscription that sets neither or both of invoke/deliver', async () => {
    const alice = ctxFor('alice').ctx;
    await expect(
      cmds.registerSubscription({ subscription: { id: 'bad-none', match: { type: 'x' } } as never }, alice),
    ).rejects.toThrow(/exactly one of/);
    await expect(
      cmds.registerSubscription({ subscription: { id: 'bad-both', match: { type: 'x' }, invoke: 'a', deliver: '@o/c.t' } as never }, alice),
    ).rejects.toThrow(/exactly one of/);
  });

  it('a cell may register a subscription as cell-required via the organ path', async () => {
    const handler = createSubstrateWriteHandler(() => ({ state, grants }));
    const orgCtx = {
      ...(ctxFor(null).ctx as unknown as Record<string, unknown>),
      identity: { scopes: [] },
      serviceClient: () => ({ command: async (c: string) => (c === 'resolveCell' ? { owner: 'alice', name: 'machine' } : null) }),
    } as unknown as ServiceContext;
    await handler(
      { key: '_subscriptions/machine.demo', value: { id: 'machine.demo', match: { keyPrefix: 'machine-run/' }, invoke: 'machine.demo.start', params: { run: '${keySuffix}' } } },
      orgCtx,
      { source: 'cell-machine-xyz', detailType: 'substrate.write.requested' },
    );
    const sub = await cmds.peek({ key: '_subscriptions/machine.demo' }, ctxFor('alice').ctx);
    expect(sub?._meta.type).toBe('subscription');
    expect(sub?._meta.writer).toBe('@alice/machine');
    expect(sub?._meta.tags).toContain('cell-required');
  });
});

describe('stripUndefined (DynamoDB write sanitizer — v2 removeUndefinedValues equivalent)', () => {
  it('recursively drops undefined keys but keeps null/false/0/empties', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: null, d: false, e: 0, f: '' })).toEqual({ a: 1, c: null, d: false, e: 0, f: '' });
    expect(stripUndefined({ outer: { keep: 1, drop: undefined }, list: [{ x: undefined, y: 2 }] })).toEqual({ outer: { keep: 1 }, list: [{ y: 2 }] });
  });
  it('passes primitives through untouched', () => {
    expect(stripUndefined('s')).toBe('s');
    expect(stripUndefined(null)).toBeNull();
  });
});

describe('resolveParams template substitution', () => {
  const sub = { id: 's', match: { keyPrefix: 'machine/m/run/' } } as Parameters<typeof resolveParams>[0];

  it('templates top-level string params (exact keeps type, interpolation stringifies)', () => {
    const def = { ...sub, params: { run: '${keySuffix}', label: 'run-${keySuffix}', count: 3 } };
    const out = resolveParams(def, 'machine/m/run/r2', 'c15r', { node: 'X' });
    expect(out.run).toBe('r2');
    expect(out.label).toBe('run-r2');
    expect(out.count).toBe(3); // non-strings pass through
  });

  it('recurses into NESTED objects/arrays so an onError.key templates', () => {
    const def = {
      ...sub,
      params: {
        onError: { key: 'machine/m/run/${keySuffix}', value: { node: 'Work', status: 'failed' }, tags: ['machine', 'machine:${keySuffix}'] },
        grants: { write: ['machine/m/run/'] }, // static prefixes — unchanged
      },
    };
    const out = resolveParams(def, 'machine/m/run/r2', 'c15r', { node: 'Work' }) as {
      onError: { key: string; value: { status: string }; tags: string[] };
      grants: { write: string[] };
    };
    expect(out.onError.key).toBe('machine/m/run/r2'); // the bug fix
    expect(out.onError.value.status).toBe('failed');
    expect(out.onError.tags).toEqual(['machine', 'machine:r2']);
    expect(out.grants.write).toEqual(['machine/m/run/']);
  });

  it('OMITS an exact placeholder that does not resolve — absent, not null (the no-`text` trigger fix)', () => {
    // `text: ${value.text}` on a trigger that carried no text used to resolve to
    // `null`, which then failed the action param type-check (typeof null !== string)
    // and silently aborted the reaction. It must now be ABSENT so an optional param
    // is correctly skipped.
    const def = { ...sub, params: { run: '${keySuffix}', text: '${value.text}' } };
    const out = resolveParams(def, 'machine/m/run/r2', 'c15r', { node: 'X' }); // value has no `text`
    expect(out.run).toBe('r2');
    expect('text' in out).toBe(false); // omitted entirely — not null, not "undefined"
  });
});

describe('granular type-scopes (write:type:<T> / read:type:<T> — ADR-0023 §B enforcement)', () => {
  // One Substrate; we set facts with a coarse token, then read/write with
  // granular-only tokens. The gate is INERT for coarse/internal callers and only
  // constrains a token that holds the granular family but not the coarse verb.
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));

  /** A ctx for `user` carrying an explicit scope set (the granular-token case). */
  const scopedCtx = (user: string, scopes: string[]): ServiceContext =>
    ({
      identity: { user, scopes },
      config: { tableName: 'unused-in-memory' },
      events: { emit: async () => {} },
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    } as unknown as ServiceContext);

  const coarse = scopedCtx('c15r', ['workspace:read', 'workspace:write']);

  beforeAll(async () => {
    await cmds.remember({ key: 'n1', value: 'a note', type: 'note' }, coarse);
    await cmds.remember({ key: 't1', value: 'a todo', type: 'todo' }, coarse);
  });

  it('is inert for a coarse token — read/write any type', async () => {
    expect((await cmds.peek({ key: 'n1' }, coarse))?.value).toBe('a note');
    expect((await cmds.peek({ key: 't1' }, coarse))?.value).toBe('a todo');
    await expect(cmds.query({}, coarse)).resolves.toBeDefined();
  });

  it('write:type:note may write a note but is denied a todo', async () => {
    const noteWriter = scopedCtx('c15r', ['write:type:note']);
    await expect(cmds.remember({ key: 'n2', value: 'second note', type: 'note' }, noteWriter)).resolves.toMatchObject({
      value: 'second note',
    });
    await expect(cmds.remember({ key: 't2', value: 'nope', type: 'todo' }, noteWriter)).rejects.toThrow(
      /scope_denied.*write:type:todo/,
    );
  });

  it('read:type:note may peek a note but is denied a todo (deny, never silently elide)', async () => {
    const noteReader = scopedCtx('c15r', ['read:type:note']);
    expect((await cmds.peek({ key: 'n1' }, noteReader))?.value).toBe('a note');
    await expect(cmds.peek({ key: 't1' }, noteReader)).rejects.toThrow(/scope_denied.*read:type:todo/);
  });

  it('read:type:note may query its own type, but not another type or a whole-view/untyped read', async () => {
    const noteReader = scopedCtx('c15r', ['read:type:note']);
    await expect(cmds.query({ type: 'note' }, noteReader)).resolves.toBeDefined();
    await expect(cmds.query({ type: 'todo' }, noteReader)).rejects.toThrow(/scope_denied.*read:type:todo/);
    await expect(cmds.query({}, noteReader)).rejects.toThrow(/scope_denied/);
  });
});

describe('read-response shaping (ADR-0048 — reads answer at the caller\'s altitude)', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants }));
  const me = (): ServiceContext => ctxFor('shaper').ctx;
  const LONG = 'x'.repeat(1000);

  beforeAll(async () => {
    await cmds.remember({ key: 'kb/big', value: { title: 'Big fact', content: LONG, nested: { deep: { deeper: { most: 1 } } } }, type: 'note' }, me());
    await cmds.remember({ key: 'kb/small', value: 'tiny', type: 'note' }, me());
    await cmds.link({ from: 'kb/big', rel: 'related', to: 'kb/small' }, me());
    await cmds.link({ from: 'kb/small', rel: 'refines', to: 'kb/big' }, me());
  });

  it('query shape:"card" truncates long strings, keeps titles + short values; full stays the default', async () => {
    const card = await cmds.query({ shape: 'card' }, me());
    const big = card.entries.find((e) => e.key === 'kb/big') as { value: { title: string; content: string }; _meta: { shaped?: string } };
    expect(big.value.title).toBe('Big fact'); // label paths survive
    expect(big.value.content.length).toBeLessThan(LONG.length);
    expect(big.value.content.endsWith('…')).toBe(true);
    expect(big._meta.shaped).toBe('card');
    const small = card.entries.find((e) => e.key === 'kb/small') as { value: unknown };
    expect(small.value).toBe('tiny'); // short values pass through whole

    const full = await cmds.query(undefined, me());
    const bigFull = full.entries.find((e) => e.key === 'kb/big') as { value: { content: string }; _meta: { shaped?: string } };
    expect(bigFull.value.content.length).toBe(LONG.length); // default unchanged
    expect(bigFull._meta.shaped).toBeUndefined();
  });

  it('query shape:"refs" drops values, keeps the _meta essentials', async () => {
    const refs = await cmds.query({ shape: 'refs' }, me());
    const big = refs.entries.find((e) => e.key === 'kb/big') as { value?: unknown; _meta: { type?: string; score?: number; shaped?: string } };
    expect('value' in big).toBe(false);
    expect(big._meta.type).toBe('note');
    expect(big._meta.shaped).toBe('refs');
  });

  it('card summarises structure past depth 2 but keeps the field names above it', async () => {
    const card = await cmds.query({ shape: 'card' }, me());
    const big = card.entries.find((e) => e.key === 'kb/big') as { value: { nested: { deep: unknown } } };
    expect(typeof big.value.nested).toBe('object'); // depth 1 kept
    expect(typeof big.value.nested.deep).toBe('string'); // depth 2 summarised to "{n fields}"
  });

  it('neighbors shape:"card" shapes the entries map; the edges stay complete', async () => {
    const nb = await cmds.neighbors({ key: 'kb/small', shape: 'card' }, me());
    expect(nb.inbound.length + nb.outbound.length).toBeGreaterThanOrEqual(2);
    const big = nb.entries['kb/big'] as { value?: { content?: string }; _meta: { shaped?: string } };
    expect(big._meta.shaped).toBe('card');
    expect((big.value?.content ?? '').length).toBeLessThan(LONG.length);
  });

  it('graph/links scope by keys + rels and report total; {limit: 0} is "just count"', async () => {
    const scoped = await cmds.graph({ keys: ['kb/big'] }, me());
    expect(scoped.edges.length).toBeGreaterThanOrEqual(2);
    expect(scoped.edges.every((e) => e.from === 'kb/big' || e.to === 'kb/big')).toBe(true);
    expect(scoped.total).toBe(scoped.edges.length);

    const relOnly = await cmds.graph({ keys: ['kb/big'], rels: ['related'] }, me());
    expect(relOnly.edges.every((e) => e.rel === 'related')).toBe(true);
    expect(relOnly.edges.length).toBeGreaterThanOrEqual(1);

    const counted = await cmds.links({ limit: 0 }, me());
    expect(counted.edges).toEqual([]);
    expect(counted.total).toBeGreaterThanOrEqual(2);
  });

  it('a bare changes() is bounded to the newest events; last/sinceSeq keep expressivity', async () => {
    const bare = await cmds.changes(undefined, me());
    expect(bare.events.length).toBeLessThanOrEqual(200);
    expect(bare.events.length).toBeGreaterThan(0);

    const last1 = await cmds.changes({ last: 1 }, me());
    expect(last1.events.length).toBe(1);
    // `last` keeps the NEWEST event; every other event's seq is <= it
    expect(Math.max(...bare.events.map((e) => e.seq))).toBe(last1.events[0].seq);

    const forward = await cmds.changes({ sinceSeq: 0, limit: 2 }, me());
    expect(forward.events.length).toBe(2);
    expect(forward.events[0].seq).toBeLessThan(forward.events[1].seq); // oldest-first paging unchanged
  });

  it('recall full view defaults to card entries; expand and shape:"full" restore whole values', async () => {
    const res = await cmds.recall({ view: 'full' }, me());
    if (!('entries' in res)) throw new Error('expected full view');
    const big = res.entries['kb/big'] as { value: { content: string } };
    expect(big.value.content.length).toBeLessThan(LONG.length);

    const expanded = await cmds.recall({ view: 'full', expand: ['kb/big'] }, me());
    if (!('entries' in expanded)) throw new Error('expected full view');
    expect((expanded.entries['kb/big'].value as { content: string }).content.length).toBe(LONG.length);

    const whole = await cmds.recall({ view: 'full', shape: 'full' }, me());
    if (!('entries' in whole)) throw new Error('expected full view');
    expect((whole.entries['kb/big'].value as { content: string }).content.length).toBe(LONG.length);
  });
});

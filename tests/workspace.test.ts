/**
 * Workspace cell — the vocabulary over observed state, scoped per user.
 *
 * Drives the command factory with the in-memory store (the same seam the auth
 * cell uses to stay off DynamoDB in tests). Verifies: writes are scoped to the
 * caller's slice, recall is salience-shaped, supersede retires without deleting,
 * one user cannot see another's slice, and `remember` announces a fact event.
 */
import { createWorkspaceCommands, createSubstrateWriteHandler, createTendHandler, createCellLifecycleHandler } from '../services/workspace/handlers';
import { createMemoryGrantStore } from '../services/workspace/grants';
import { createObservedState, createMemoryStateStore } from '../platform/runtime';
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

  it('recall returns the caller view, salience-shaped with a _shaping summary', async () => {
    const { ctx } = ctxFor('alice');
    const res = await cmds.recall(undefined, ctx);
    expect(res.entries.phase.value).toBe('planning');
    expect(res._shaping.elision).toBe('auto');
    expect(res._shaping.counts.total).toBeGreaterThanOrEqual(1);
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

    const def = await cmds.recall(undefined, ctx);
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

  it('describeTools advertises the whole vocabulary for the /mcp gateway', async () => {
    const { tools } = await cmds.describeTools(undefined, ctxFor('alice').ctx);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'peek', 'recall', 'remember', 'ingest', 'shared', 'share', 'supersede', 'unshare',
        'group', 'groups',
        'query', 'link', 'unlink', 'neighbors', 'changes', 'attention',
        'registerAction', 'actions', 'deleteAction', 'invoke',
        'registerView', 'views', 'view', 'deleteView', 'links', 'tend',
        'requestGrant', 'grantRequests', 'approveGrant', 'denyGrant',
      ].sort(),
    );
    // Per-slice ops gate on ownership, not scopes — so the gateway advertises them
    // to any authenticated principal. The one exception is tend: distilling a
    // slice into audit facts is an operator action, gated on workspace:admin.
    expect(tools.every((t) => t.scope === null || t.name === 'tend')).toBe(true);
    expect(tools.find((t) => t.name === 'tend')!.scope).toBe('workspace:admin');
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
    expect(around.inbound.map((e) => `${e.from}-${e.rel}`).sort()).toEqual(['d2-refines', 't1-grounds']);
    expect(around.outbound).toEqual([]);
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

    // staleMs -1: staleness is strictly age > threshold, and a fact written in
    // this same millisecond has age 0 — 0 would race the clock on fast runners.
    const att = await cmds.attention({ staleMs: -1 }, alice());
    expect(att.stale.map((s) => s.key)).not.toContain('_canvas/board/el:1');
    expect(att.unlinked).not.toContain('_canvas/board/el:1');
    expect(att.dangling.some((d) => d.from.startsWith('_canvas/'))).toBe(false);

    const withSystem = await cmds.attention({ staleMs: -1, includeSystem: true }, alice());
    expect(withSystem.stale.map((s) => s.key)).toContain('_canvas/board/el:1');
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

  it('refuses non-cell sources, missing keys, unknown cells, and vocabulary writes', async () => {
    // None of these should write anything.
    await handler({ key: 'x', value: 1 }, busCtx({ owner: 'alice' }), { source: 'rogue', detailType: 'substrate.write.requested' });
    await handler({ value: 1 }, busCtx({ owner: 'alice' }), { source: 'cell-a', detailType: 'substrate.write.requested' });
    await handler({ key: 'x', value: 1 }, busCtx(null), { source: 'cell-a', detailType: 'substrate.write.requested' });
    await handler({ key: '_actions/evil', value: 1 }, busCtx({ owner: 'alice' }), { source: 'cell-a', detailType: 'substrate.write.requested' });
    await handler({ key: '_views/evil', value: 1 }, busCtx({ owner: 'alice' }), { source: 'cell-a', detailType: 'substrate.write.requested' });

    const view = await cmds.recall({ elision: 'none' }, ctxFor('alice').ctx);
    expect(view.entries['x']).toBeUndefined();
    expect(view.entries['_actions/evil']).toBeUndefined();
    expect(view.entries['_views/evil']).toBeUndefined();
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

/**
 * ADR-0069 (C3) — the one edge query's framings, asserted directly.
 *
 * Until the strangler-fig completed, these were parity tests against the four
 * legacy verbs (neighbors / links / graph / members); those verbs are now
 * RETIRED (gateway tombstones teach the successors), so each framing's
 * behaviour is pinned structurally instead.
 */
import { createWorkspaceCommands } from '../services/workspace/handlers';
import { createObservedState, createMemoryStateStore } from '../platform/runtime';
import { createMemoryGrantStore } from '../services/workspace/grants';
import type { ServiceContext } from '../platform/runtime';

function ctxFor(user: string): ServiceContext {
  return {
    identity: { user, scopes: ['workspace:write', 'workspace:read'] },
    config: { tableName: 'unused-in-memory' },
    events: { emit: async () => {} },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as ServiceContext;
}

/** Reduce any edge-query result to its deterministic, comparable structure. */
function shape(r: unknown): unknown {
  const o = r as Record<string, unknown>;
  if ('outbound' in o) {
    return { outbound: o.outbound, inbound: o.inbound, entryKeys: Object.keys(o.entries as object).sort(), types: o.types ?? null };
  }
  if ('members' in o) {
    return {
      key: o.key,
      membership: o.membership,
      order: o.order,
      memberKeys: (o.members as Array<{ key: string }>).map((m) => m.key),
      types: o.types ?? null,
    };
  }
  return { edges: o.edges, total: o.total };
}

describe('ADR-0069 — edge query parity', () => {
  const state = createObservedState(createMemoryStateStore());
  const cmds = createWorkspaceCommands(() => ({ state, grants: createMemoryGrantStore() }));
  const ctx = ctxFor('alice');

  beforeAll(async () => {
    await cmds.remember({ key: 'a', value: { n: 1 }, type: 'note' }, ctx);
    await cmds.remember({ key: 'b', value: { n: 2 }, type: 'note' }, ctx);
    await cmds.remember({ key: 'x/1', value: { n: 3 }, type: 'note' }, ctx);
    await cmds.link({ from: 'a', rel: 'relates', to: 'b' }, ctx);
    await cmds.link({ from: 'x/1', rel: 'relates', to: 'a' }, ctx);
    await cmds.remember({ key: 'todo1', value: { done: false }, type: 'todo' }, ctx);
    await cmds.declare({ kind: 'view', def: { id: 'todos', query: { type: 'todo' }, reduce: 'list' } }, ctx);
  });

  it('edges({ around }) is the one-hop neighbourhood framing', async () => {
    const nb = shape(await cmds.edges({ around: 'a' }, ctx)) as { outbound: Array<{ to: string }>; inbound: Array<{ from: string }>; entryKeys: string[] };
    expect(nb.outbound.map((e) => e.to)).toContain('b');
    expect(nb.inbound.map((e) => e.from)).toContain('x/1');
    expect(nb.entryKeys).toEqual(expect.arrayContaining(['b', 'x/1']));
    const out = shape(await cmds.edges({ around: 'a', dir: 'out' }, ctx)) as { inbound: unknown[]; outbound: Array<{ to: string }> };
    expect(out.inbound).toEqual([]); // dir:'out' drops the inbound half
    expect(out.outbound.map((e) => e.to)).toContain('b');
    const rel = shape(await cmds.edges({ around: 'a', rel: 'relates' }, ctx)) as { outbound: Array<{ rel: string }>; inbound: Array<{ rel: string }> };
    expect([...rel.outbound, ...rel.inbound].every((e) => e.rel === 'relates')).toBe(true);
  });

  it('edges({ key }) is honored as an alias for edges({ around }) (W4d)', async () => {
    // Three wave-4 drivers reached for `key` (the peek/neighbors spelling) and
    // hit the whole-graph path or an error; `key` now aliases `around`.
    expect(shape(await cmds.edges({ key: 'a' }, ctx))).toEqual(shape(await cmds.edges({ around: 'a' }, ctx)));
    expect(shape(await cmds.edges({ key: 'a', dir: 'out' }, ctx))).toEqual(shape(await cmds.edges({ around: 'a', dir: 'out' }, ctx)));
  });

  it('edges({ around, membership: true }) is the members framing (intensional view)', async () => {
    const m = shape(await cmds.edges({ around: '_views/todos', membership: true }, ctx)) as { memberKeys: string[]; membership: string };
    expect(m.memberKeys).toEqual(['todo1']); // the view's query selects the todo
  });

  it('edges({ derived: false }) is the authored-only framing, with prefix scoping', async () => {
    const all = (await cmds.edges({ derived: false }, ctx)) as { edges: Array<{ from: string; rel: string; to: string }>; total: number };
    expect(all.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(['a>b', 'x/1>a']);
    expect(all.total).toBe(2);
    const pre = (await cmds.edges({ derived: false, prefix: 'x/' }, ctx)) as { edges: Array<{ from: string; to: string }> };
    expect(pre.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['x/1>a']);
  });

  it('edges() and edges({ derived: true }) are the same full-projection framing, with keys scope', async () => {
    // Two spellings, one read: bare edges() defaults derived to true.
    expect(shape(await cmds.edges(undefined, ctx))).toEqual(shape(await cmds.edges({ derived: true }, ctx)));
    const full = (await cmds.edges(undefined, ctx)) as { edges: Array<{ rel: string; derived?: boolean }> };
    expect(full.edges.some((e) => e.derived)).toBe(true); // backbone present (e.g. instanceOf/inView)
    const scoped = (await cmds.edges({ keys: ['a'] }, ctx)) as { edges: Array<{ from: string; to: string }> };
    expect(scoped.edges.every((e) => e.from === 'a' || e.to === 'a')).toBe(true);
  });

  it('hydrated neighbour entries default to the card tier; shape:"full" restores whole bodies', async () => {
    // A long-bodied neighbour: the default read must not ship the whole value.
    const body = 'x'.repeat(5000);
    await cmds.remember({ key: 'bigbody', value: { text: body }, type: 'note' }, ctx);
    await cmds.link({ from: 'a', rel: 'relates', to: 'bigbody' }, ctx);

    const def = (await cmds.edges({ around: 'a' }, ctx)) as { entries: Record<string, { value: { text: string }; _meta: { shaped?: string } }> };
    const card = def.entries['bigbody'];
    expect(card._meta.shaped).toBe('card'); // marked as shaped, not whole
    expect(card.value.text.length).toBeLessThan(body.length); // body truncated

    const whole = (await cmds.edges({ around: 'a', shape: 'full' }, ctx)) as { entries: Record<string, { value: { text: string }; _meta: { shaped?: string } }> };
    expect(whole.entries['bigbody'].value.text).toBe(body); // full body on request
    expect(whole.entries['bigbody']._meta.shaped).toBeUndefined();

    // edges({ around }) shares the default.
    const via = (await cmds.edges({ around: 'a' }, ctx)) as { entries: Record<string, { _meta: { shaped?: string } }> };
    expect(via.entries['bigbody']._meta.shaped).toBe('card');
  });

  it('authored (derived:false) really excludes derived backbone; graph includes it', async () => {
    const authored = (await cmds.edges({ derived: false }, ctx)) as { edges: Array<{ rel: string }>; total: number };
    const full = (await cmds.edges({ derived: true }, ctx)) as { edges: Array<{ rel: string }>; total: number };
    // both authored edges present; only the full projection carries derived backbone (e.g. instanceOf)
    expect(authored.edges.every((e) => e.rel === 'relates')).toBe(true);
    expect(full.edges.length).toBeGreaterThan(authored.edges.length);
  });

  it('an omitted limit is a bounded first page, never the whole projection (ADR-0081)', async () => {
    // A scope whose authored edge count exceeds DEFAULT_EDGE_LIMIT: the
    // unbounded read is exactly what failed live (CloudFront 30s / 6MB).
    const big = ctxFor('bigscope');
    await cmds.remember({ key: 'hub', value: { n: 0 } }, big);
    for (let i = 0; i < 1100; i++) {
      await cmds.link({ from: 'hub', rel: 'relates', to: `spoke/${i}` }, big);
    }
    const page = (await cmds.edges({ derived: false }, big)) as { edges: unknown[]; total: number; nextCursor?: string };
    expect(page.total).toBe(1100);
    expect(page.edges.length).toBe(1000); // DEFAULT_EDGE_LIMIT
    expect(page.nextCursor).toBe('1000');

    // The cursor walks to the end; an explicit limit still overrides the default.
    const rest = (await cmds.edges({ derived: false, cursor: page.nextCursor }, big)) as { edges: unknown[]; nextCursor?: string };
    expect(rest.edges.length).toBe(100);
    expect(rest.nextCursor).toBeUndefined();
    const capped = (await cmds.edges({ limit: 5 }, big)) as { edges: unknown[]; total: number; nextCursor?: string };
    expect(capped.edges.length).toBe(5);
    expect(capped.nextCursor).toBe('5');
    // {limit: 0} stays the idiomatic count-only read.
    const count = (await cmds.edges({ derived: false, limit: 0 }, big)) as { edges: unknown[]; total: number };
    expect(count.edges.length).toBe(0);
    expect(count.total).toBe(1100);
  });
});

describe('edges — grant fold (shared/public subgraphs)', () => {
  const state = createObservedState(createMemoryStateStore());
  const grants = createMemoryGrantStore();
  const cmds = createWorkspaceCommands(() => ({ state, grants }));
  const alice = ctxFor('alice');
  const bob = ctxFor('bob');

  beforeAll(async () => {
    await cmds.remember({ key: 'doc:pub', value: { n: 1 }, type: 'note' }, alice);
    await cmds.remember({ key: 'doc:pub2', value: { n: 2 }, type: 'note' }, alice);
    await cmds.remember({ key: 'secret', value: { n: 3 }, type: 'note' }, alice);
    await cmds.link({ from: 'doc:pub', rel: 'relates', to: 'doc:pub2' }, alice); // public ↔ public
    await cmds.link({ from: 'doc:pub', rel: 'leaks', to: 'secret' }, alice);     // public → PRIVATE
    await cmds.share({ to: 'public', key: 'doc:*' }, alice);                      // only the doc: prefix
  });

  const pairs = (r: unknown): string[] =>
    ((r as { edges: Array<{ from: string; rel: string; to: string }> }).edges).map((e) => `${e.from} -${e.rel}-> ${e.to}`);

  it('folds a granted owner’s authored edges, re-prefixed owner/key', async () => {
    expect(pairs(await cmds.edges({ derived: false }, bob))).toContain('alice/doc:pub -relates-> alice/doc:pub2');
  });

  it('excludes an edge whose far endpoint is NOT granted (no private-key leak)', async () => {
    expect(pairs(await cmds.edges({ derived: false }, bob)).some((p) => p.includes('secret'))).toBe(false);
  });

  it('the owner’s own-slice read is unchanged (no foreign fold, bare keys)', async () => {
    const own = pairs(await cmds.edges({ derived: false }, alice));
    expect(own).toContain('doc:pub -relates-> doc:pub2');
    expect(own.every((p) => !p.includes('alice/'))).toBe(true);
  });
});

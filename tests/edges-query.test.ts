/**
 * ADR-0069 (C3) — behaviour-preservation gate for the one edge query.
 *
 * The composed `edges(...)` must be output-equivalent to the four legacy verbs it
 * subsumes (neighbors / links / graph / members), preset by preset. Hydrated
 * entries carry call-time salience scores, so the comparators check the
 * deterministic structure (edge lists, neighbour/member key sets, membership,
 * total) rather than the volatile `_meta`.
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
    await cmds.registerView({ view: { id: 'todos', query: { type: 'todo' }, reduce: 'list' } }, ctx);
  });

  it('edges({ around }) === neighbors({ key })', async () => {
    expect(shape(await cmds.edges({ around: 'a' }, ctx))).toEqual(shape(await cmds.neighbors({ key: 'a' }, ctx)));
    expect(shape(await cmds.edges({ around: 'a', dir: 'out' }, ctx))).toEqual(shape(await cmds.neighbors({ key: 'a', dir: 'out' }, ctx)));
    expect(shape(await cmds.edges({ around: 'a', rel: 'relates' }, ctx))).toEqual(shape(await cmds.neighbors({ key: 'a', rel: 'relates' }, ctx)));
  });

  it('edges({ around, membership: true }) === members({ key })', async () => {
    expect(shape(await cmds.edges({ around: '_views/todos', membership: true }, ctx))).toEqual(
      shape(await cmds.members({ key: '_views/todos' }, ctx)),
    );
  });

  it('edges({ derived: false }) === links (authored only), with prefix', async () => {
    expect(shape(await cmds.edges({ derived: false }, ctx))).toEqual(shape(await cmds.links(undefined, ctx)));
    expect(shape(await cmds.edges({ derived: false, prefix: 'x/' }, ctx))).toEqual(shape(await cmds.links({ prefix: 'x/' }, ctx)));
  });

  it('edges() / edges({ derived: true }) === graph (full projection), with keys scope', async () => {
    expect(shape(await cmds.edges(undefined, ctx))).toEqual(shape(await cmds.graph(undefined, ctx)));
    expect(shape(await cmds.edges({ derived: true }, ctx))).toEqual(shape(await cmds.graph(undefined, ctx)));
    expect(shape(await cmds.edges({ keys: ['a'] }, ctx))).toEqual(shape(await cmds.graph({ keys: ['a'] }, ctx)));
  });

  it('hydrated neighbour entries default to the card tier; shape:"full" restores whole bodies', async () => {
    // A long-bodied neighbour: the default read must not ship the whole value.
    const body = 'x'.repeat(5000);
    await cmds.remember({ key: 'bigbody', value: { text: body }, type: 'note' }, ctx);
    await cmds.link({ from: 'a', rel: 'relates', to: 'bigbody' }, ctx);

    const def = (await cmds.neighbors({ key: 'a' }, ctx)) as { entries: Record<string, { value: { text: string }; _meta: { shaped?: string } }> };
    const card = def.entries['bigbody'];
    expect(card._meta.shaped).toBe('card'); // marked as shaped, not whole
    expect(card.value.text.length).toBeLessThan(body.length); // body truncated

    const whole = (await cmds.neighbors({ key: 'a', shape: 'full' }, ctx)) as { entries: Record<string, { value: { text: string }; _meta: { shaped?: string } }> };
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
});

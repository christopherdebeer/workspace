/**
 * The grant fold across the FULL edge surface (ADR-0092 follow-on to ADR-0091).
 *
 * ADR-0091 folded only the `derived:false` links framing; the home graph reads
 * the full projection and `around`/`members` framings — a guest saw every
 * public star and ZERO edges (live probe: 210 nodes, 0 edges, 0 members).
 * These cover: the full-projection fold (both-endpoint coverage), the folded
 * `around` anchor (foreign + self spellings), and coverage on emitted members.
 */
import { createWorkspaceCommands } from '../services/workspace/handlers';
import { createMemoryGrantStore } from '../services/workspace/grants';
import { createObservedState, createMemoryStateStore } from '../platform/runtime';
import type { ServiceContext } from '../platform/runtime';

function ctxFor(user: string | null): ServiceContext {
  return {
    identity: user ? { user, scopes: ['workspace:write', 'workspace:read'] } : null,
    config: { tableName: 'unused-in-memory' },
    events: { emit: async () => undefined },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  } as unknown as ServiceContext;
}

describe('the edges grant fold across all framings', () => {
  const store = createMemoryStateStore();
  const grants = createMemoryGrantStore();
  const state = createObservedState(store);
  const cmds = createWorkspaceCommands(() => ({ state, grants, store }));

  beforeAll(async () => {
    const alice = ctxFor('alice');
    await cmds.remember({ key: 'doc:a', value: { title: 'A' } }, alice);
    await cmds.remember({ key: 'doc:b', value: { title: 'B' } }, alice);
    await cmds.remember({ key: 'note:secret', value: 'private' }, alice);
    await cmds.link({ from: 'doc:a', rel: 'references', to: 'doc:b' }, alice);
    await cmds.link({ from: 'doc:a', rel: 'references', to: 'note:secret' }, alice);
    await cmds.share({ to: 'public', key: 'doc:*' }, alice);
  });

  it('full projection: a viewer with only public grants gets the covered constellation', async () => {
    const r = (await cmds.edges({}, ctxFor('guest'))) as { edges: Array<{ from: string; to: string; rel: string }> };
    const pairs = r.edges.map((e) => `${e.from}->${e.to}`);
    expect(pairs).toContain('alice/doc:a->alice/doc:b');
    // The edge to the private fact never leaks — not even its key name.
    expect(JSON.stringify(r.edges)).not.toContain('note:secret');
  });

  it('folded `around` anchor: neighbors resolve against the granting owner, coverage-filtered', async () => {
    const r = (await cmds.edges({ around: 'alice/doc:a' }, ctxFor('guest'))) as {
      outbound: Array<{ from: string; to: string }>;
      entries: Record<string, unknown>;
    };
    expect(r.outbound.map((e) => e.to)).toContain('alice/doc:b');
    expect(r.outbound.map((e) => e.to)).not.toContain('alice/note:secret');
    expect(Object.keys(r.entries)).toContain('alice/doc:b');
    expect(Object.keys(r.entries)).not.toContain('alice/note:secret');
  });

  it('SELF-folded anchor: the owner resolves their own canonical spelling, unfiltered', async () => {
    const r = (await cmds.edges({ around: 'alice/doc:a' }, ctxFor('alice'))) as {
      outbound: Array<{ from: string; to: string }>;
    };
    // Self access has no coverage filter — the private neighbour is theirs to see.
    expect(r.outbound.map((e) => e.to).sort()).toEqual(['alice/doc:b', 'alice/note:secret']);
  });

  it('an uncovered folded anchor falls through (no leak, no crash)', async () => {
    const r = (await cmds.edges({ around: 'alice/note:secret' }, ctxFor('guest'))) as {
      outbound: unknown[];
      inbound: unknown[];
    };
    // Not resolvable via grants → treated as an own-slice key of `guest` → empty.
    expect(r.outbound).toEqual([]);
    expect(r.inbound).toEqual([]);
  });

  it('folded members (intensional view): only covered members are emitted, re-prefixed', async () => {
    const alice = ctxFor('alice');
    await cmds.remember({ key: 'view:pub', value: { title: 'docs', query: { prefix: 'doc:' } } }, alice);
    await cmds.share({ to: 'public', key: 'view:pub' }, alice);
    const r = (await cmds.edges({ around: 'alice/view:pub', membership: true }, ctxFor('guest'))) as {
      key: string;
      members: Array<{ key: string }>;
    };
    expect(r.key).toBe('alice/view:pub');
    const keys = r.members.map((m) => m.key);
    expect(keys).toContain('alice/doc:a');
    expect(keys).toContain('alice/doc:b');
    expect(keys.every((k) => k.startsWith('alice/doc:'))).toBe(true); // nothing uncovered
  });

  it('owner-viewing-own-slice full projection is unchanged (no foreign grants → no fold)', async () => {
    const r = (await cmds.edges({}, ctxFor('alice'))) as { edges: Array<{ from: string }> };
    // No `alice/`-prefixed spellings in the owner's own projection.
    expect(r.edges.every((e) => !e.from.startsWith('alice/'))).toBe(true);
    expect(r.edges.length).toBeGreaterThan(0);
  });
});

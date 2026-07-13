/**
 * Delegation-chain tokens (ADR-0024, RFC 8693 `sub` + nested `act`) — driven
 * end-to-end through the real `auth` service handler over command envelopes
 * (the tests/auth-incremental.test.ts harness), plus the writer-stamp half in
 * the observed state. The chain is PROVENANCE: every exchange appends the new
 * actor and preserves the subject; scope clamps to min(requested, parent) at
 * every hop; the workspace writer stamp reads the LEAF actor.
 */
import { handler as auth } from '../services/auth/service';
import { createObservedState, createMemoryStateStore } from '../platform/runtime';
import type { ActClaim, Identity } from '../platform/runtime';
import { unwindActChain, leafActOf } from '../platform/runtime';

interface CmdIdentity {
  user?: string;
  scopes?: string[];
  grantScopes?: string[];
  tokenId?: string;
}
async function cmd<T = unknown>(command: string, payload: unknown, identity: CmdIdentity = {}): Promise<T> {
  const res = (await auth({ __command: command, payload, ...identity } as never)) as { ok: boolean; result?: T; error?: string };
  if (!res.ok) throw new Error(res.error);
  return res.result as T;
}

interface Minted { id: string; token: string; scope: string; act?: ActClaim }
interface Validated { userId: string; scope: string; tokenId: string; act: ActClaim | null }

const GRANT = ['workspace:read', 'workspace:write'];
const alice: CmdIdentity = { user: 'alice', scopes: GRANT, grantScopes: GRANT };

beforeEach(() => {
  process.env.SERVICE_NAME = 'auth';
  delete process.env.EVENT_BUS_NAME; // emit() no-ops without a bus
});
afterEach(() => {
  delete process.env.SERVICE_NAME;
});

describe('auth.exchangeToken (ADR-0024)', () => {
  it('appends the actor, preserves the subject, and clamps scope to the parent', async () => {
    const root = await cmd<Minted>('mintToken', { scope: GRANT.join(' ') }, alice);

    // Hop 1: an orchestrating agent delegates to a researcher, read-only +
    // an out-of-ceiling scope that must be dropped.
    const child = await cmd<Minted>('exchangeToken', {
      from: root.token,
      scope: 'workspace:read cells:create',
      actor: 'agent:researcher',
    });
    expect(child.scope).toBe('workspace:read'); // min(requested, parent) — cells:create clamped away
    expect(child.act).toEqual({ sub: 'agent:researcher' });

    const v = await cmd<Validated>('validateToken', { token: child.token });
    expect(v.userId).toBe('alice'); // the SUBJECT survives — authorization anchor
    expect(v.act).toEqual({ sub: 'agent:researcher' });

    // Hop 2: the researcher spawns a summarizer — the chain NESTS.
    const grand = await cmd<Minted>('exchangeToken', {
      from: child.token,
      scope: 'workspace:read',
      actor: 'agent:summarizer',
    });
    expect(grand.act).toEqual({ sub: 'agent:summarizer', act: { sub: 'agent:researcher' } });
    expect(unwindActChain(grand.act)).toEqual(['agent:summarizer', 'agent:researcher']);

    const gv = await cmd<Validated>('validateToken', { token: grand.token });
    expect(gv.userId).toBe('alice');
    expect(unwindActChain(gv.act)).toEqual(['agent:summarizer', 'agent:researcher']);
  });

  it('cannot widen: a child requesting beyond the parent ceiling is denied outright', async () => {
    const root = await cmd<Minted>('mintToken', { scope: 'workspace:read' }, alice);
    await expect(
      cmd('exchangeToken', { from: root.token, scope: 'cells:create', actor: 'agent:x' }),
    ).rejects.toThrow(/scope_denied/);
  });

  it('rejects an invalid parent token', async () => {
    await expect(cmd('exchangeToken', { from: 'tok_bogus', scope: 'workspace:read' })).rejects.toThrow(/invalid_grant/);
  });

  it('loop guard: an actor already in the chain (or the subject itself) is refused', async () => {
    const root = await cmd<Minted>('mintToken', { scope: GRANT.join(' ') }, alice);
    const child = await cmd<Minted>('exchangeToken', { from: root.token, scope: 'workspace:read', actor: 'agent:a' });
    await expect(
      cmd('exchangeToken', { from: child.token, scope: 'workspace:read', actor: 'agent:a' }),
    ).rejects.toThrow(/delegation_loop/);
    await expect(
      cmd('exchangeToken', { from: child.token, scope: 'workspace:read', actor: 'alice' }),
    ).rejects.toThrow(/delegation_loop/);
  });

  it('depth bound: the chain stops at MAX_DELEGATION_DEPTH hops', async () => {
    const root = await cmd<Minted>('mintToken', { scope: GRANT.join(' ') }, alice);
    let cur = root.token;
    for (let i = 0; i < 8; i++) {
      const next = await cmd<Minted>('exchangeToken', { from: cur, scope: 'workspace:read', actor: `agent:hop${i}` });
      cur = next.token;
    }
    await expect(
      cmd('exchangeToken', { from: cur, scope: 'workspace:read', actor: 'agent:one-too-many' }),
    ).rejects.toThrow(/delegation_too_deep/);
  });

  it('defaults the actor name from the label when none is given', async () => {
    const root = await cmd<Minted>('mintToken', { scope: GRANT.join(' ') }, alice);
    const child = await cmd<Minted>('exchangeToken', { from: root.token, scope: 'workspace:read', label: 'nightly-collector' });
    expect(child.act?.sub).toBe('nightly-collector');
  });

  it('the steward list surfaces the chain on delegated tokens only', async () => {
    const root = await cmd<Minted>('mintToken', { scope: GRANT.join(' ') }, alice);
    await cmd<Minted>('exchangeToken', { from: root.token, scope: 'workspace:read', actor: 'agent:listed' });
    const { tokens } = await cmd<{ tokens: Array<{ id: string; act?: ActClaim }> }>('tokens', {}, alice);
    const delegated = tokens.filter((t) => t.act);
    expect(delegated.some((t) => t.act?.sub === 'agent:listed')).toBe(true);
    expect(tokens.find((t) => t.id === root.id)?.act).toBeUndefined();
  });
});

describe('writer stamp reads the leaf act (ADR-0024 §3)', () => {
  it('a chained identity stamps the leaf actor; a root identity stamps the user', async () => {
    const state = createObservedState(createMemoryStateStore());
    const chained: Identity = {
      user: 'alice',
      scopes: ['workspace:write'],
      actor: 'agent',
      act: { sub: 'agent:summarizer', act: { sub: 'agent:researcher' } },
    };
    const e1 = await state.put({ scope: 'r', key: 'k1', value: 1, type: 'note' }, chained);
    expect(e1._meta.writer).toBe('agent:summarizer');

    const rootId: Identity = { user: 'alice', scopes: ['workspace:write'] };
    const e2 = await state.put({ scope: 'r', key: 'k2', value: 1, type: 'note' }, rootId);
    expect(e2._meta.writer).toBe('alice');
  });

  it('leafActOf/unwindActChain: helpers for stamps and audit views', () => {
    const chain: ActClaim = { sub: 'c', act: { sub: 'b', act: { sub: 'a' } } };
    expect(leafActOf({ act: chain })).toBe('c');
    expect(leafActOf({})).toBeNull();
    expect(unwindActChain(chain)).toEqual(['c', 'b', 'a']);
    expect(unwindActChain(null)).toEqual([]);
  });
});

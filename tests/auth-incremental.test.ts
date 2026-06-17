/**
 * Incremental authorization (docs/capability-consent.md, Phase 3) — driven
 * end-to-end through the real `auth` service handler over command envelopes, the
 * way the gateway reaches it. The token's grant is the ceiling (set at consent);
 * the session's *effective* scope is a mutable subset of it, so a session can
 * start minimal (`focusScope`) and widen on demand (`requestScope`) up to the
 * ceiling — no re-consent. The auth cell runs on its in-memory store (no
 * TABLE_NAME), which persists for the module.
 */
import { handler as auth } from '../services/auth/service';

interface Identity {
  user?: string;
  scopes?: string[];
  grantScopes?: string[];
  tokenId?: string;
}
async function cmd<T = unknown>(command: string, payload: unknown, identity: Identity = {}): Promise<T> {
  const res = (await auth({ __command: command, payload, ...identity } as never)) as { ok: boolean; result?: T; error?: string };
  if (!res.ok) throw new Error(res.error);
  return res.result as T;
}

describe('incremental authorization (auth.focusScope / requestScope)', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'auth';
    delete process.env.EVENT_BUS_NAME; // emit() no-ops without a bus
  });
  afterEach(() => {
    delete process.env.SERVICE_NAME;
  });

  const GRANT = ['workspace:read', 'workspace:write'];

  it('narrows then widens a session within its grant, persisting server-side, and refuses to exceed the ceiling', async () => {
    // Mint a token carrying the full grant (the ceiling).
    const minted = await cmd<{ id: string; token: string; scope: string }>(
      'mintToken',
      { scope: GRANT.join(' ') },
      { user: 'alice', scopes: GRANT, grantScopes: GRANT },
    );
    expect(minted.scope).toBe('workspace:read workspace:write');

    // Fresh token: effective == grant.
    const v0 = await cmd<{ effectiveScope: string | null; scope: string; tokenId: string }>('validateToken', { token: minted.token });
    expect(v0.effectiveScope).toBeNull();
    expect(v0.tokenId).toBe(minted.id);

    // focusScope → start minimal (read-only).
    const session: Identity = { user: 'alice', scopes: GRANT, grantScopes: GRANT, tokenId: minted.id };
    const focused = await cmd<{ effective: string[]; grant: string[] }>('focusScope', { scopes: ['workspace:read'] }, session);
    expect(focused.effective).toEqual(['workspace:read']);
    expect(focused.grant.sort()).toEqual(['workspace:read', 'workspace:write']);

    // The narrowing is persisted: a re-validation sees the reduced effective scope,
    // grant unchanged.
    const v1 = await cmd<{ effectiveScope: string | null; scope: string }>('validateToken', { token: minted.token });
    expect(v1.effectiveScope).toBe('workspace:read');
    expect(v1.scope).toBe('workspace:read workspace:write');

    // requestScope → widen back up to the ceiling (the self-serve answer to a
    // scope_offer). The session now carries the *narrowed* effective scope.
    const narrowed: Identity = { ...session, scopes: ['workspace:read'] };
    const widened = await cmd<{ effective: string[]; granted: boolean; denied: string[] }>(
      'requestScope',
      { scopes: ['workspace:write'] },
      narrowed,
    );
    expect(widened.granted).toBe(true);
    expect(widened.denied).toEqual([]);
    expect(widened.effective.sort()).toEqual(['workspace:read', 'workspace:write']);

    const v2 = await cmd<{ effectiveScope: string | null }>('validateToken', { token: minted.token });
    expect(v2.effectiveScope!.split(' ').sort()).toEqual(['workspace:read', 'workspace:write']);

    // A scope outside the grant ceiling cannot be self-served — it comes back denied
    // (that path is human re-consent), and the effective scope is unchanged.
    const refused = await cmd<{ granted: boolean; denied: string[]; effective: string[] }>(
      'requestScope',
      { scopes: ['platform:*'] },
      { ...session, scopes: GRANT },
    );
    expect(refused.granted).toBe(false);
    expect(refused.denied).toEqual(['platform:*']);
    expect(refused.effective.sort()).toEqual(['workspace:read', 'workspace:write']);
  });

  it('session scope ops require a token-backed identity', async () => {
    await expect(cmd('focusScope', { scopes: ['workspace:read'] }, { user: 'alice', scopes: GRANT, grantScopes: GRANT })).rejects.toThrow(
      /bearer-authenticated session/,
    );
  });
});

import { createMemoryStore } from '../services/auth/memory-store';
import {
  OAuthConfig,
  handleDCR,
  handleConsent,
  handleToken,
  handleASMetadata,
  handleRevoke,
  handleDeviceInit,
  handleDeviceInfo,
  handleDeviceApprove,
  validateBearer,
  grantableScopes,
  handleGrantableScopes,
  scopeMeta,
  isSelfGrantableGranular,
  cellScopesFor,
  delegationActorForRedirect,
  frameAncestors,
} from '../services/auth/oauth';
import { sha256 } from '../services/auth/store';
import type { ServiceHttpRequest } from '../platform/runtime';

const CONFIG: OAuthConfig = {
  serverName: 'test',
  scopesSupported: ['workspace:read', 'workspace:write'],
  tokenExpirySecs: 3600,
};

describe('grantableScopes admin-gating (granular vocabulary)', () => {
  const cfg: OAuthConfig = {
    serverName: 'test',
    tokenExpirySecs: 3600,
    scopesSupported: ['workspace:read', 'write:workspace', 'read:workspace', 'platform:cells:create', 'cells:create', 'platform:*'],
    adminUsernames: ['admin'],
    adminScopePrefixes: ['platform:', 'cells:create'],
  };
  it('non-admins may grant workspace read/write (coarse + granular) but NOT cell creation or platform admin', () => {
    expect(grantableScopes(cfg, 'bob')).toEqual(['workspace:read', 'write:workspace', 'read:workspace']);
  });
  it('admins may grant everything, including granular cells:create', () => {
    expect(grantableScopes(cfg, 'admin')).toContain('cells:create');
    expect(grantableScopes(cfg, 'admin')).toContain('platform:*');
  });
});

function makeReq(opts: {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}): ServiceHttpRequest {
  const raw = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const query = opts.query ?? {};
  const qs = Object.keys(query).length ? `?${new URLSearchParams(query)}` : '';
  return {
    method: opts.method ?? 'POST',
    path: opts.path,
    headers: { 'content-type': 'application/json', ...opts.headers },
    query,
    rawBody: raw,
    url: `https://auth.example.com${opts.path}${qs}`,
    json<T = unknown>(): T {
      return JSON.parse(raw ?? '{}') as T;
    },
    text(): string {
      return raw ?? '';
    },
  };
}

describe('auth store (in-memory)', () => {
  it('mints, validates, lists, and revokes tokens', async () => {
    const store = createMemoryStore();
    const minted = await store.mintToken({ userId: 'u1', scope: 'workspace:read', label: 'cli' });
    const info = await store.validateTokenByHash(sha256(minted.token));
    expect(info).toMatchObject({ mintedBy: 'u1', scope: 'workspace:read' });

    const list = await store.listUserTokens('u1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(minted.id);

    expect(await store.revokeToken(minted.id, 'u1')).toBe(true);
    expect(await store.validateTokenByHash(sha256(minted.token))).toBeNull();
  });

  it('validateBearer exposes the username as the principal (account id stays the anchor)', async () => {
    const store = createMemoryStore();
    await store.createUser('uuid-1', 'alice');
    const minted = await store.mintToken({ userId: 'uuid-1', scope: 'workspace:read' });

    // The token is stored keyed by the stable account id…
    expect(await store.validateTokenByHash(sha256(minted.token))).toMatchObject({ mintedBy: 'uuid-1' });
    // …but the principal cells see is the human username — so addresses become
    // @alice/<cell>, scopes/S3 prefixes become readable.
    expect(await validateBearer(minted.token, store)).toMatchObject({ userId: 'alice', scope: 'workspace:read' });

    // Falls back to mintedBy when the account can't be resolved.
    const orphan = await store.mintToken({ userId: 'ghost', scope: 's' });
    expect(await validateBearer(orphan.token, store)).toMatchObject({ userId: 'ghost' });
  });

  it('refreshes a token without killing the previous access token (stable chains, ADR-0080)', async () => {
    const store = createMemoryStore();
    const minted = await store.mintToken({ userId: 'u1', scope: 's', expiresInSec: 60, withRefresh: true });
    const refreshed = await store.refreshUnifiedToken(sha256(minted.refreshToken!), 60);
    expect(refreshed).not.toBeNull();
    // The old access token is NOT revoked — it reaches its natural (short) expiry.
    // The same refresh value lives in the parc_refresh cookie AND localStorage;
    // revoking on refresh made one chain's refresh sign the other chain out.
    expect(await store.validateTokenByHash(sha256(minted.token))).toMatchObject({ scope: 's' });
    // new access token works
    expect(await store.validateTokenByHash(sha256(refreshed!.token))).toMatchObject({ scope: 's' });
    // and the refresh credential is stable — not re-minted on refresh
    expect(refreshed!.refreshToken).toBeUndefined();
  });

  it('exposes effective scope + token id, and reflects a server-side narrowing (incremental auth)', async () => {
    const store = createMemoryStore();
    await store.createUser('uuid-1', 'alice');
    const minted = await store.mintToken({ userId: 'uuid-1', scope: 'workspace:read workspace:write' });

    // Fresh token: effective == grant (null sentinel), and the id is exposed.
    const v1 = await validateBearer(minted.token, store);
    expect(v1).toMatchObject({ userId: 'alice', scope: 'workspace:read workspace:write', effectiveScope: null, tokenId: minted.id });

    // Narrow the session's effective focus to a subset of the grant.
    expect(await store.setEffectiveScope(minted.id, 'uuid-1', 'workspace:read')).toBe(true);
    const v2 = await validateBearer(minted.token, store);
    expect(v2!.effectiveScope).toBe('workspace:read');
    expect(v2!.scope).toBe('workspace:read workspace:write'); // grant (ceiling) is unchanged

    // Only the token's own account may mutate it.
    expect(await store.setEffectiveScope(minted.id, 'someone-else', '')).toBe(false);
  });

  it('updateToken re-labels, re-scopes (resetting effective), and re-horizons a token you own', async () => {
    const store = createMemoryStore();
    await store.createUser('uuid-1', 'alice');
    const minted = await store.mintToken({ userId: 'uuid-1', scope: 'workspace:read workspace:write', label: 'old' });
    await store.setEffectiveScope(minted.id, 'uuid-1', 'workspace:read'); // narrowed focus

    const updated = await store.updateToken(minted.id, 'uuid-1', { label: 'new', scope: 'workspace:read' });
    expect(updated).toMatchObject({ id: minted.id, label: 'new', scope: 'workspace:read' });

    // The grant is now the new scope, and effective was reset to it (not the old narrow).
    const v = await validateBearer(minted.token, store);
    expect(v!.scope).toBe('workspace:read');
    expect(v!.effectiveScope).toBeNull();

    // Re-horizon to non-expiring, then back to a finite lifetime.
    expect((await store.updateToken(minted.id, 'uuid-1', { expiresInSec: 0 }))!.expiresAt).toBeNull();
    expect((await store.updateToken(minted.id, 'uuid-1', { expiresInSec: 3600 }))!.expiresAt).not.toBeNull();

    // Another account cannot steward it.
    expect(await store.updateToken(minted.id, 'someone-else', { label: 'x' })).toBeNull();
  });

  it('enforces single-use auth codes', async () => {
    const store = createMemoryStore();
    await store.saveAuthCode({
      code: 'c1', clientId: 'cl', userId: 'u1', redirectUri: 'https://x', codeChallenge: 'cc', codeChallengeMethod: 'S256',
    });
    expect(await store.consumeAuthCode('c1')).not.toBeNull();
    expect(await store.consumeAuthCode('c1')).toBeNull();
  });
});

describe('OAuth 2.1 authorization_code + PKCE flow', () => {
  it('registers a client, consents, and exchanges a PKCE code for a token', async () => {
    const store = createMemoryStore();

    // 1. Dynamic Client Registration
    const dcr = await handleDCR(
      makeReq({ path: '/oauth/register', body: { redirect_uris: ['https://app/cb'], token_endpoint_auth_method: 'none' } }),
      store,
    );
    const client = dcr.body as { client_id: string };
    expect(dcr.statusCode).toBe(201);
    expect(client.client_id).toMatch(/^client_/);

    // 2. The user authenticates (passkey) → a consent-scoped session.
    await store.createUser('u1', 'alice');
    const sessionId = await store.createSession('u1');

    // 3. Consent with a PKCE challenge.
    const verifier = 'verifier-abc-123';
    const challenge = sha256(verifier);
    const consent = await handleConsent(
      makeReq({
        path: '/oauth/consent',
        body: {
          sessionId, clientId: client.client_id, redirectUri: 'https://app/cb',
          codeChallenge: challenge, codeChallengeMethod: 'S256', scope: 'workspace:read', state: 'xyz',
        },
      }),
      store,
      CONFIG,
    );
    const redirect = (consent.body as { redirect: string }).redirect;
    const code = new URL(redirect).searchParams.get('code')!;
    expect(code).toMatch(/^authz_/);
    expect(new URL(redirect).searchParams.get('state')).toBe('xyz');

    // 4. Token exchange with the verifier.
    const tokenRes = await handleToken(
      makeReq({
        path: '/oauth/token',
        body: { grant_type: 'authorization_code', code, redirect_uri: 'https://app/cb', code_verifier: verifier, client_id: client.client_id },
      }),
      store,
      CONFIG,
    );
    const tok = tokenRes.body as { access_token: string; refresh_token: string; scope: string };
    expect(tok.scope).toBe('workspace:read');

    // 5. The minted token validates — and the principal cells see is the human
    // username ('alice'), not the account id ('u1').
    const validated = await validateBearer(tok.access_token, store);
    expect(validated).toMatchObject({ userId: 'alice', scope: 'workspace:read' });

    // 6. Refresh works.
    const refreshRes = await handleToken(
      makeReq({ path: '/oauth/token', body: { grant_type: 'refresh_token', refresh_token: tok.refresh_token } }),
      store,
      CONFIG,
    );
    expect((refreshRes.body as { access_token: string }).access_token).toBeTruthy();
  });

  it('caps a cell-host redirect token to the cell ceiling (model A — strips platform:* and other cells)', async () => {
    process.env.CELL_DOMAIN_SUFFIX = '.on.parc.land';
    try {
      const store = createMemoryStore();
      const verifier = 'cell-verifier-xyz';
      await store.saveAuthCode({
        code: 'authz_cell',
        clientId: 'cl',
        userId: 'c15r',
        redirectUri: 'https://c15r-canvas.on.parc.land/',
        codeChallenge: sha256(verifier),
        codeChallengeMethod: 'S256',
        scope: 'workspace:read workspace:write platform:cells:create cell:c15r/lit:* cell:c15r/canvas:*',
      });
      const res = await handleToken(
        makeReq({
          path: '/oauth/token',
          body: { grant_type: 'authorization_code', code: 'authz_cell', redirect_uri: 'https://c15r-canvas.on.parc.land/', code_verifier: verifier, client_id: 'cl' },
        }),
        store,
        CONFIG,
      );
      const scope = (res.body as { scope: string }).scope.split(' ').sort();
      // platform:* and the OTHER cell (lit) dropped; workspace + the cell's own (canvas) kept.
      expect(scope).toEqual(['cell:c15r/canvas:*', 'workspace:read', 'workspace:write']);
    } finally {
      delete process.env.CELL_DOMAIN_SUFFIX;
    }
  });

  it('does NOT cap an apex (non-cell) redirect token', async () => {
    process.env.CELL_DOMAIN_SUFFIX = '.on.parc.land';
    try {
      const store = createMemoryStore();
      const verifier = 'apex-verifier';
      await store.saveAuthCode({
        code: 'authz_apex',
        clientId: 'cl',
        userId: 'c15r',
        redirectUri: 'https://parc.land/',
        codeChallenge: sha256(verifier),
        codeChallengeMethod: 'S256',
        scope: 'workspace:read workspace:write platform:cells:create',
      });
      const res = await handleToken(
        makeReq({
          path: '/oauth/token',
          body: { grant_type: 'authorization_code', code: 'authz_apex', redirect_uri: 'https://parc.land/', code_verifier: verifier, client_id: 'cl' },
        }),
        store,
        CONFIG,
      );
      expect((res.body as { scope: string }).scope).toContain('platform:cells:create');
    } finally {
      delete process.env.CELL_DOMAIN_SUFFIX;
    }
  });

  /** Run consent → token for a freshly-registered user, returning the token body. */
  async function consentAndToken(
    store: ReturnType<typeof createMemoryStore>,
    consentBody: Record<string, unknown>,
    config: OAuthConfig = CONFIG,
  ): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; scope: string }> {
    await store.createUser('u1', 'alice');
    // `cl` must be a registered client whose redirect covers `https://app/cb`:
    // handleConsent now refuses to mint a code for an unregistered redirect.
    await store.saveOAuthClient({ clientId: 'cl', clientSecret: null, redirectUris: ['https://app/cb'], clientName: null });
    const sessionId = await store.createSession('u1');
    const verifier = 'verifier-grant-test';
    const consent = await handleConsent(
      makeReq({
        path: '/oauth/consent',
        body: { sessionId, clientId: 'cl', redirectUri: 'https://app/cb', codeChallenge: sha256(verifier), codeChallengeMethod: 'S256', scope: 'workspace:read', ...consentBody },
      }),
      store,
      config,
    );
    const code = new URL((consent.body as { redirect: string }).redirect).searchParams.get('code')!;
    const res = await handleToken(
      makeReq({ path: '/oauth/token', body: { grant_type: 'authorization_code', code, redirect_uri: 'https://app/cb', code_verifier: verifier, client_id: 'cl' } }),
      store,
      config,
    );
    return res.body as { access_token: string; refresh_token?: string; expires_in?: number; scope: string };
  }

  it('a chosen grant lifetime shorter than the refresh ceiling keeps short access + a bounded refresh', async () => {
    const store = createMemoryStore();
    const tok = await consentAndToken(store, { expiresInSec: 86400 }); // 1 day
    expect(tok.expires_in).toBe(3600); // access stays the configured short TTL
    expect(tok.refresh_token).toBeTruthy(); // refresh carries the 1-day grant horizon
  });

  it('a sub-access grant lifetime collapses to a single short-lived token (no refresh)', async () => {
    const store = createMemoryStore();
    const tok = await consentAndToken(store, { expiresInSec: 600 }); // 10 min < 1h access
    expect(tok.expires_in).toBe(600);
    expect(tok.refresh_token).toBeUndefined();
  });

  it('omitting the lifetime is unchanged: short access + refresh at the default ceiling', async () => {
    const store = createMemoryStore();
    const tok = await consentAndToken(store, {});
    expect(tok.expires_in).toBe(3600);
    expect(tok.refresh_token).toBeTruthy();
  });

  it('a below-minimum lifetime is clamped up (a token must outlive its own issuance)', async () => {
    const store = createMemoryStore();
    const tok = await consentAndToken(store, { expiresInSec: 5 }); // < MIN_GRANT_SECS (300)
    expect(tok.expires_in).toBe(300);
  });

  // redirect_uri was never checked against the registered client: DCR stored
  // `redirect_uris` and nothing read them back, so an authorize URL could name
  // any destination. Craft one with your own code_challenge, let the victim
  // approve a real consent screen, and the code lands on your site to be
  // exchanged with the verifier you chose — PKCE does not help, because you
  // crafted the URL.
  describe('the code only goes where the client registered', () => {
    async function consentTo(redirectUri: string, registered: string[] = ['https://app/cb']) {
      const store = createMemoryStore();
      await store.createUser('u1', 'alice');
      await store.saveOAuthClient({ clientId: 'cl', clientSecret: null, redirectUris: registered, clientName: null });
      const sessionId = await store.createSession('u1');
      return handleConsent(
        makeReq({
          path: '/oauth/consent',
          body: { sessionId, clientId: 'cl', redirectUri, codeChallenge: sha256('v'), codeChallengeMethod: 'S256', scope: 'workspace:read' },
        }),
        store,
        CONFIG,
      );
    }

    it('refuses a redirect to an origin the client never registered', async () => {
      const res = await consentTo('https://evil.example/steal');
      expect(res.statusCode).toBe(400);
      expect((res.body as { error: string }).error).toBe('invalid_request');
      expect((res.body as { redirect?: string }).redirect).toBeUndefined();
    });

    it('refuses a client that does not exist', async () => {
      const store = createMemoryStore();
      await store.createUser('u1', 'alice');
      const sessionId = await store.createSession('u1');
      const res = await handleConsent(
        makeReq({
          path: '/oauth/consent',
          body: { sessionId, clientId: 'never-registered', redirectUri: 'https://app/cb', codeChallenge: sha256('v'), codeChallengeMethod: 'S256' },
        }),
        store,
        CONFIG,
      );
      expect(res.statusCode).toBe(400);
    });

    it('refuses a malformed redirect', async () => {
      expect((await consentTo('not-a-url')).statusCode).toBe(400);
    });

    // The bound is the ORIGIN, not the exact string: the kernel caches one client
    // per origin and reuses it across every surface path there, so a reader who
    // registered at `/` signs in at `/@c15r/shelved` on the same client.
    it('allows another path on an origin the client registered', async () => {
      const res = await consentTo('https://parc.land/@c15r/shelved', ['https://parc.land', 'https://parc.land/']);
      expect(res.statusCode ?? 200).toBe(200);
      expect((res.body as { redirect: string }).redirect).toContain('https://parc.land/@c15r/shelved?code=');
    });

    it('still refuses a lookalike origin', async () => {
      expect((await consentTo('https://parc.land.evil.example/@c15r/shelved', ['https://parc.land'])).statusCode).toBe(400);
    });
  });

  it('rejects a bad PKCE verifier', async () => {
    const store = createMemoryStore();
    await store.createUser('u1', 'alice');
    // `cl` must be a registered client whose redirect covers `https://app/cb`:
    // handleConsent now refuses to mint a code for an unregistered redirect.
    await store.saveOAuthClient({ clientId: 'cl', clientSecret: null, redirectUris: ['https://app/cb'], clientName: null });
    const sessionId = await store.createSession('u1');
    await handleConsent(
      makeReq({
        path: '/oauth/consent',
        body: { sessionId, clientId: 'cl', redirectUri: 'https://app/cb', codeChallenge: sha256('right'), codeChallengeMethod: 'S256', scope: 'workspace:read' },
      }),
      store,
      CONFIG,
    );
    // grab the code by consuming a fresh consent
    const sid2 = await store.createSession('u1');
    const consent = await handleConsent(
      makeReq({
        path: '/oauth/consent',
        body: { sessionId: sid2, clientId: 'cl', redirectUri: 'https://app/cb', codeChallenge: sha256('right'), codeChallengeMethod: 'S256' },
      }),
      store,
      CONFIG,
    );
    const code = new URL((consent.body as { redirect: string }).redirect).searchParams.get('code')!;
    const res = await handleToken(
      makeReq({ path: '/oauth/token', body: { grant_type: 'authorization_code', code, redirect_uri: 'https://app/cb', code_verifier: 'WRONG' } }),
      store,
      CONFIG,
    );
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toBe('invalid_grant');
  });
});

describe('refresh-token lifetime + revocation (hardening)', () => {
  it('refreshes after the access token has expired (refresh has its own, longer life)', async () => {
    const store = createMemoryStore();
    // Access token already expired (negative window), refresh valid for 1h.
    const minted = await store.mintToken({
      userId: 'u1', scope: 's', expiresInSec: -1, withRefresh: true, refreshExpiresInSec: 3600,
    });
    expect(await store.validateTokenByHash(sha256(minted.token))).toBeNull(); // access dead
    const refreshed = await store.refreshUnifiedToken(sha256(minted.refreshToken!), 3600, 3600);
    expect(refreshed).not.toBeNull(); // refresh still works — the bug this fixes
    expect(await store.validateTokenByHash(sha256(refreshed!.token))).toMatchObject({ scope: 's' });
  });

  it('the refresh credential is stable: both chains can refresh with the same value (ADR-0080)', async () => {
    const store = createMemoryStore();
    const minted = await store.mintToken({ userId: 'u1', scope: 's', expiresInSec: 60, withRefresh: true });
    // Two independent holders of the SAME refresh token (cookie jar + localStorage)
    // each refresh — both succeed, and every minted access token stays valid.
    const first = await store.refreshUnifiedToken(sha256(minted.refreshToken!), 60, 3600);
    const second = await store.refreshUnifiedToken(sha256(minted.refreshToken!), 60, 3600);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(await store.validateTokenByHash(sha256(first!.token))).toMatchObject({ scope: 's' });
    expect(await store.validateTokenByHash(sha256(second!.token))).toMatchObject({ scope: 's' });
    // Explicit revocation still ends the whole chain (revoke cascades to refresh).
    await store.revokeByTokenValue(second!.token);
    expect(await store.refreshUnifiedToken(sha256(minted.refreshToken!), 60, 3600)).toBeNull();
  });

  it('revoking an access token cascades to its refresh token', async () => {
    const store = createMemoryStore();
    const m = await store.mintToken({ userId: 'u1', scope: 's', expiresInSec: 60, withRefresh: true });
    expect(await store.revokeToken(m.id, 'u1')).toBe(true);
    expect(await store.refreshUnifiedToken(sha256(m.refreshToken!), 60, 3600)).toBeNull();
  });

  it('revokeByTokenValue accepts an access OR a refresh token and kills the pair', async () => {
    const store = createMemoryStore();
    const m = await store.mintToken({ userId: 'u1', scope: 's', expiresInSec: 60, withRefresh: true });
    await store.revokeByTokenValue(m.token); // by access value
    expect(await store.validateTokenByHash(sha256(m.token))).toBeNull();
    expect(await store.refreshUnifiedToken(sha256(m.refreshToken!), 60, 3600)).toBeNull();

    const m2 = await store.mintToken({ userId: 'u1', scope: 's', expiresInSec: 60, withRefresh: true });
    await store.revokeByTokenValue(m2.refreshToken!); // by refresh value
    expect(await store.refreshUnifiedToken(sha256(m2.refreshToken!), 60, 3600)).toBeNull();
    expect(await store.validateTokenByHash(sha256(m2.token))).toBeNull();
  });

  it('RFC 7009 /oauth/revoke returns 200 and invalidates the token', async () => {
    const store = createMemoryStore();
    const minted = await store.mintToken({ userId: 'u1', scope: 'workspace:read', expiresInSec: 60, withRefresh: true });
    const res = await handleRevoke(makeReq({ path: '/oauth/revoke', body: { token: minted.token } }), store);
    expect(res.statusCode).toBe(200);
    expect(await validateBearer(minted.token, store)).toBeNull();
    // 200 even for an unknown token (no probing).
    expect((await handleRevoke(makeReq({ path: '/oauth/revoke', body: { token: 'nope' } }), store)).statusCode).toBe(200);
  });
});

describe('OAuth device authorization grant', () => {
  it('initiates, approves with a session, and issues a token', async () => {
    const store = createMemoryStore();
    await store.createUser('u1', 'alice');

    const init = await handleDeviceInit(makeReq({ path: '/auth/device', body: { scope: 'workspace:write' } }), store);
    const { device_code, user_code } = init.body as { device_code: string; user_code: string };
    expect(user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    // polling before approval → authorization_pending
    const pending = await handleToken(
      makeReq({ path: '/oauth/token', body: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code } }),
      store,
      CONFIG,
    );
    expect((pending.body as { error: string }).error).toBe('authorization_pending');

    // user approves via passkey session
    const sessionId = await store.createSession('u1');
    const approve = await handleDeviceApprove(makeReq({ path: '/auth/device/approve', body: { sessionId, user_code } }), store);
    expect((approve.body as { approved: boolean }).approved).toBe(true);

    // poll again → token
    const granted = await handleToken(
      makeReq({ path: '/oauth/token', body: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code } }),
      store,
      CONFIG,
    );
    const tok = granted.body as { access_token: string; scope: string };
    expect(tok.scope).toBe('workspace:write');
    // principal is the human username, not the account id
    expect(await validateBearer(tok.access_token, store)).toMatchObject({ userId: 'alice', scope: 'workspace:write' });
  });

  it('discloses the requested scopes before approval (informed consent)', async () => {
    const store = createMemoryStore();
    await store.createUser('u1', 'alice');
    const init = await handleDeviceInit(makeReq({ path: '/auth/device', body: { scope: 'workspace:write read:workspace' } }), store);
    const { user_code } = init.body as { user_code: string };

    // Session required — a bare user_code can't probe scopes.
    const unauth = await handleDeviceInfo(makeReq({ path: '/auth/device/info', body: { sessionId: 'nope', user_code } }), store);
    expect((unauth.body as { error?: string }).error).toBeTruthy();

    const sessionId = await store.createSession('u1');
    const info = await handleDeviceInfo(makeReq({ path: '/auth/device/info', body: { sessionId, user_code } }), store);
    const body = info.body as { scopes: string[]; catalog: Record<string, { verb: string; title: string }> };
    // The exact scopes the device asked for are surfaced, with capability metadata
    // (verb grouping) so the approver sees that this grant can WRITE.
    expect(body.scopes).toEqual(['workspace:write', 'read:workspace']);
    expect(body.catalog['workspace:write'].verb).toBe('write');
    expect(body.catalog['read:workspace'].verb).toBe('read');
  });

  it('rejects device info for an unknown user code', async () => {
    const store = createMemoryStore();
    await store.createUser('u1', 'alice');
    const sessionId = await store.createSession('u1');
    const info = await handleDeviceInfo(makeReq({ path: '/auth/device/info', body: { sessionId, user_code: 'ZZZZ-ZZZZ' } }), store);
    expect((info.body as { error?: string }).error).toBeTruthy();
  });
});

describe('per-type consent + granular elevation (ADR-0023 §B / ADR-0022)', () => {
  // A cell scope is open-ended in owner and name, so like the per-type scopes it
  // can never sit in `scopesSupported` — and unlike them it had NO admission rule,
  // so a client asking for a cell scope alone was offered nothing and the consent
  // screen disabled its own Authorize button. That is the least-privilege handoff
  // docs/cell-origin-isolation.md §4.5 describes, so it could not actually be used:
  // every cell sign-in had to ask for `workspace:read workspace:write` instead.
  describe('a cell sign-in can be granted the scope that names it', () => {
    const CELL = 'c15r-drive.on.parc.land';
    let suffix: string | undefined;
    let base: string | undefined;
    beforeEach(() => {
      suffix = process.env.CELL_DOMAIN_SUFFIX;
      base = process.env.PUBLIC_BASE_URL;
      process.env.CELL_DOMAIN_SUFFIX = '.on.parc.land';
      // The path form is only meaningful on our OWN host, so the anchor has to
      // be configured for it to be read at all.
      process.env.PUBLIC_BASE_URL = 'https://parc.land';
    });
    afterEach(() => {
      if (suffix === undefined) delete process.env.CELL_DOMAIN_SUFFIX;
      else process.env.CELL_DOMAIN_SUFFIX = suffix;
      if (base === undefined) delete process.env.PUBLIC_BASE_URL;
      else process.env.PUBLIC_BASE_URL = base;
    });

    it('offers the cell the sign-in came from', () => {
      expect(cellScopesFor(`https://${CELL}`)).toEqual(['cell:c15r/drive:*']);
    });
    // The bound that matters: derived from the redirect_uri, so a request can
    // only ever name the cell whose page the player is standing on.
    it('never offers a different cell', () => {
      expect(cellScopesFor('https://c15r-lit.on.parc.land')).toEqual(['cell:c15r/lit:*']);
      expect(cellScopesFor(`https://${CELL}`)).not.toContain('cell:someone/else:*');
    });
    it('offers nothing for a plain platform redirect', () => {
      expect(cellScopesFor('https://parc.land/whatever')).toEqual([]);
      expect(cellScopesFor(undefined)).toEqual([]);
    });
    // An APEX-served cell is the common case (every /@owner/name surface), and it
    // was the case this missed: derived from `cellCeiling`, which only recognises
    // a host-isolated redirect, the apex offered nothing — so a cell asking to be
    // signed in to got an empty picker and had to ask for the whole workspace.
    it('offers the cell an apex /@owner/name redirect names', () => {
      expect(cellScopesFor('https://parc.land/@c15r/shelved')).toEqual(['cell:c15r/shelved:*']);
      expect(cellScopesFor('https://parc.land/@c15r/drive/deep/link')).toEqual(['cell:c15r/drive:*']);
    });
    // The apex path is bounded the same way the host is: by what the redirect says.
    it('never offers a different cell from an apex redirect', () => {
      expect(cellScopesFor('https://parc.land/@c15r/shelved')).not.toContain('cell:someone/else:*');
    });
    // The two forms address the same cell, so they must name the same scope —
    // otherwise a cell's sign-in would depend on which origin served it.
    it('agrees between the host-isolated and apex forms of one cell', () => {
      expect(cellScopesFor('https://c15r-drive.on.parc.land')).toEqual(cellScopesFor('https://parc.land/@c15r/drive'));
    });
    // Widening the derivation must not have widened what it hands back.
    it('still offers only a cell scope from an apex redirect', () => {
      expect(cellScopesFor('https://parc.land/@c15r/shelved').every((s) => s.startsWith('cell:'))).toBe(true);
    });

    // `/@owner/name` is a route WE serve. On anyone else's origin it is just a
    // path they chose, and reading it as a cell address let a foreign redirect
    // borrow a cell's identity: the consent screen named that cell as the thing
    // asking, and the minted token carried `actor: cell:<owner>/<name>` — a
    // write attributed to a cell that never ran.
    it('refuses to read a cell address off a foreign origin', () => {
      expect(cellScopesFor('https://evil.example/@c15r/shelved')).toEqual([]);
      expect(cellScopesFor('https://parc.land.evil.example/@c15r/shelved')).toEqual([]);
    });
    it('refuses a cell host that is not ours', () => {
      expect(cellScopesFor('https://c15r-shelved.on.evil.example')).toEqual([]);
    });
    it('names no cell, and so no forged actor, for a foreign redirect', () => {
      expect(delegationActorForRedirect('https://evil.example/@c15r/shelved', 'https://parc.land', 'Totally Fine', 'cl'))
        .toBe('client:totally-fine');
    });
    it('has no path-form cell at all when no public base url is configured', () => {
      delete process.env.PUBLIC_BASE_URL;
      expect(cellScopesFor('https://parc.land/@c15r/shelved')).toEqual([]);
      // The host form is anchored by the cell domain and is unaffected.
      expect(cellScopesFor(`https://${CELL}`)).toEqual(['cell:c15r/drive:*']);
    });
    // It is a CELL scope only. The ceiling also contains workspace read/write,
    // and admitting those here would hand every cell sign-in the whole slice
    // without anyone choosing it.
    it('does not smuggle the workspace half of the ceiling through', () => {
      expect(cellScopesFor(`https://${CELL}`).some((s) => s.startsWith('workspace:'))).toBe(false);
    });
    // …and the consent screen has to be able to say what it is, in words.
    it('reads as an identity grant, not as a raw scope string', () => {
      const m = scopeMeta('cell:c15r/drive:*');
      expect(m.verb).toBe('read');
      expect(m.title).toContain('@c15r/drive');
      expect(m.description).toMatch(/username/i);
    });
  });

  // The authorize screen had no framing policy at all, so any site could frame
  // the real consent screen and clickjack Authorize. It now also has a
  // legitimate embedder — a cell drawing sign-in as a sheet — so the policy is
  // an allowlist, and the thing worth pinning is that it stays narrow.
  describe('who may frame the authorize screen', () => {
    let suffix: string | undefined;
    beforeEach(() => { suffix = process.env.CELL_DOMAIN_SUFFIX; });
    afterEach(() => {
      if (suffix === undefined) delete process.env.CELL_DOMAIN_SUFFIX;
      else process.env.CELL_DOMAIN_SUFFIX = suffix;
    });

    it('admits cell hosts when a cell domain is configured', () => {
      process.env.CELL_DOMAIN_SUFFIX = '.on.parc.land';
      expect(frameAncestors()).toBe("frame-ancestors 'self' https://*.on.parc.land");
    });
    it('collapses to self when no cell domain is configured', () => {
      delete process.env.CELL_DOMAIN_SUFFIX;
      expect(frameAncestors()).toBe("frame-ancestors 'self'");
    });
    // The failure that would matter: a policy that is present but permissive
    // reads as "handled" while leaving the clickjacking hole wide open.
    it('never admits everyone', () => {
      for (const v of ['.on.parc.land', undefined]) {
        if (v) process.env.CELL_DOMAIN_SUFFIX = v; else delete process.env.CELL_DOMAIN_SUFFIX;
        const policy = frameAncestors();
        expect(policy).toMatch(/^frame-ancestors /);
        expect(policy.split(/\s+/).slice(1)).not.toContain('*');
        expect(policy).not.toContain('http://');
      }
    });
  });

  it('isSelfGrantableGranular admits read/write type families only', () => {
    expect(isSelfGrantableGranular('write:type:note')).toBe(true);
    expect(isSelfGrantableGranular('read:type:todo')).toBe(true);
    expect(isSelfGrantableGranular('workspace:write')).toBe(false);
    expect(isSelfGrantableGranular('platform:*')).toBe(false);
    expect(isSelfGrantableGranular('write:type:')).toBe(false); // empty <T>
  });

  it('scopeMeta humanizes a per-type scope with the right verb', () => {
    expect(scopeMeta('write:type:note')).toMatchObject({ verb: 'write', title: 'Write "note" facts' });
    expect(scopeMeta('read:type:todo')).toMatchObject({ verb: 'read', title: 'Read "todo" facts' });
  });

  it('handleGrantableScopes surfaces a requested per-type scope that is NOT in scopesSupported', async () => {
    const store = createMemoryStore();
    await store.createUser('u1', 'alice');
    const sessionId = await store.createSession('u1');
    const res = await handleGrantableScopes(
      makeReq({ path: '/auth/grantable', body: { sessionId, scope: 'write:type:note read:workspace' } }),
      store,
      CONFIG,
    );
    const body = res.body as { scopes: string[]; catalog: Record<string, { title: string; verb: string }> };
    expect(body.scopes).toContain('write:type:note'); // merged in beyond scopesSupported
    expect(body.scopes).toContain('workspace:read'); // static set still present
    expect(body.catalog['write:type:note']).toMatchObject({ verb: 'write', title: 'Write "note" facts' });
  });

  it('does NOT surface a requested admin/platform scope through the granular door', async () => {
    const store = createMemoryStore();
    await store.createUser('u1', 'alice');
    const sessionId = await store.createSession('u1');
    const res = await handleGrantableScopes(
      makeReq({ path: '/auth/grantable', body: { sessionId, scope: 'platform:* write:type:note' } }),
      store,
      CONFIG,
    );
    const body = res.body as { scopes: string[] };
    expect(body.scopes).toContain('write:type:note');
    expect(body.scopes).not.toContain('platform:*'); // only read/write type families are self-grantable
  });

  it('handleConsent grants a requested per-type scope even though it is not in scopesSupported', async () => {
    const store = createMemoryStore();
    await store.createUser('u1', 'alice');
    // `cl` must be a registered client whose redirect covers `https://app/cb`:
    // handleConsent now refuses to mint a code for an unregistered redirect.
    await store.saveOAuthClient({ clientId: 'cl', clientSecret: null, redirectUris: ['https://app/cb'], clientName: null });
    const sessionId = await store.createSession('u1');
    const verifier = 'verifier-typescope';
    const consent = await handleConsent(
      makeReq({
        path: '/oauth/consent',
        body: {
          sessionId, clientId: 'cl', redirectUri: 'https://app/cb',
          codeChallenge: sha256(verifier), codeChallengeMethod: 'S256',
          scope: 'write:type:note platform:*', // platform:* must be dropped, type-scope kept
        },
      }),
      store,
      CONFIG,
    );
    const code = new URL((consent.body as { redirect: string }).redirect).searchParams.get('code')!;
    const tokenRes = await handleToken(
      makeReq({ path: '/oauth/token', body: { grant_type: 'authorization_code', code, redirect_uri: 'https://app/cb', code_verifier: verifier, client_id: 'cl' } }),
      store,
      CONFIG,
    );
    const scope = (tokenRes.body as { scope: string }).scope.split(' ').sort();
    expect(scope).toEqual(['write:type:note']); // granted the type-scope, dropped platform:*
  });
});

describe('connected clients are delegation actors from mint (ADR-0024 §code-flow)', () => {
  // Drive the full DCR → consent → code → token flow and return the token body.
  async function codeFlow(store: ReturnType<typeof createMemoryStore>, opts: { redirectUri: string; clientName?: string }) {
    const dcr = await handleDCR(
      makeReq({ path: '/oauth/register', body: { redirect_uris: [opts.redirectUri], client_name: opts.clientName, token_endpoint_auth_method: 'none' } }),
      store,
    );
    const clientId = (dcr.body as { client_id: string }).client_id;
    await store.createUser('u1', 'alice').catch(() => undefined); // idempotent across calls
    const sessionId = await store.createSession('u1');
    const verifier = 'verifier-actor-1';
    const consent = await handleConsent(
      makeReq({
        path: '/oauth/consent',
        body: {
          sessionId, clientId, redirectUri: opts.redirectUri,
          codeChallenge: sha256(verifier), codeChallengeMethod: 'S256', scope: 'workspace:read',
        },
      }),
      store,
      CONFIG,
    );
    const code = new URL((consent.body as { redirect: string }).redirect).searchParams.get('code')!;
    const tokenRes = await handleToken(
      makeReq({ path: '/oauth/token', body: { grant_type: 'authorization_code', code, redirect_uri: opts.redirectUri, code_verifier: verifier, client_id: clientId } }),
      store,
      CONFIG,
    );
    return tokenRes.body as { access_token: string; refresh_token?: string };
  }

  it('a foreign-origin client (Claude, ChatGPT) mints a chain-carrying token; the platform SPA stays root', async () => {
    const store = createMemoryStore();

    // Claude.ai connecting: foreign origin + registered name → named actor.
    const claude = await codeFlow(store, { redirectUri: 'https://claude.ai/api/mcp/auth_callback', clientName: 'Claude' });
    const vClaude = await validateBearer(claude.access_token, store);
    expect(vClaude).toMatchObject({ userId: 'alice', act: { sub: 'client:claude' } });

    // ChatGPT connecting: a DIFFERENT actor — the provenance distinction that
    // was previously flattened to the user.
    const chatgpt = await codeFlow(store, { redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect', clientName: 'ChatGPT' });
    const vGpt = await validateBearer(chatgpt.access_token, store);
    expect(vGpt?.act).toEqual({ sub: 'client:chatgpt' });

    // The platform's own SPA (same origin as the AS): the human driving a
    // first-party surface IS the user — no actor.
    const spa = await codeFlow(store, { redirectUri: 'https://auth.example.com/@c15r/home' });
    const vSpa = await validateBearer(spa.access_token, store);
    expect(vSpa?.act).toBeNull();
  });

  it('the chain SURVIVES refresh — connected clients refresh constantly', async () => {
    const store = createMemoryStore();
    const tok = await codeFlow(store, { redirectUri: 'https://claude.ai/api/mcp/auth_callback', clientName: 'Claude' });
    expect(tok.refresh_token).toBeTruthy();

    const refreshed = await handleToken(
      makeReq({ path: '/oauth/token', body: { grant_type: 'refresh_token', refresh_token: tok.refresh_token } }),
      store,
      CONFIG,
    );
    const v = await validateBearer((refreshed.body as { access_token: string }).access_token, store);
    expect(v?.act).toEqual({ sub: 'client:claude' }); // NOT dropped by the re-mint
  });

  it('a cell-host redirect names the CELL as the actor', async () => {
    process.env.CELL_DOMAIN_SUFFIX = '.on.parc.land';
    try {
      const store = createMemoryStore();
      const tok = await codeFlow(store, { redirectUri: 'https://c15r-notes.on.parc.land/cb', clientName: 'notes cell' });
      const v = await validateBearer(tok.access_token, store);
      expect(v?.act).toEqual({ sub: 'cell:c15r/notes' });
    } finally {
      delete process.env.CELL_DOMAIN_SUFFIX;
    }
  });
});

describe('RFC 8693 token exchange on /oauth/token (ADR-0024 delegation)', () => {
  const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange';

  async function mintParent(store: ReturnType<typeof createMemoryStore>, scope = 'workspace:read workspace:write') {
    await store.createUser('u1', 'alice');
    return store.mintToken({ userId: 'u1', scope, label: 'parent' });
  }

  it('is advertised in AS metadata', () => {
    const res = handleASMetadata(makeReq({ method: 'GET', path: '/.well-known/oauth-authorization-server' }), CONFIG);
    expect((res.body as { grant_types_supported: string[] }).grant_types_supported).toContain(GRANT_TYPE);
  });

  it('exchanges a parent for an attenuated, chain-carrying child (RFC response shape)', async () => {
    const store = createMemoryStore();
    const parent = await mintParent(store);
    const res = await handleToken(
      makeReq({
        path: '/oauth/token',
        body: {
          grant_type: GRANT_TYPE,
          subject_token: parent.token,
          subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
          scope: 'workspace:read cells:create', // cells:create is outside the ceiling — clamped away
          actor: 'agent:researcher',
        },
      }),
      store,
      CONFIG,
    );
    expect(res.statusCode).toBe(200);
    const body = res.body as { access_token: string; issued_token_type: string; token_type: string; scope: string; act: { sub: string } };
    expect(body.issued_token_type).toBe('urn:ietf:params:oauth:token-type:access_token');
    expect(body.token_type).toBe('Bearer');
    expect(body.scope).toBe('workspace:read'); // min(requested, parent grant)
    expect(body.act).toEqual({ sub: 'agent:researcher' });

    // The child validates like any bearer: subject stays the human, chain rides along.
    const v = await validateBearer(body.access_token, store);
    expect(v).toMatchObject({ userId: 'alice', scope: 'workspace:read', act: { sub: 'agent:researcher' } });
  });

  it('chains: exchanging a child nests the parent chain under the new actor', async () => {
    const store = createMemoryStore();
    const parent = await mintParent(store);
    const hop1 = await handleToken(
      makeReq({ path: '/oauth/token', body: { grant_type: GRANT_TYPE, subject_token: parent.token, scope: 'workspace:read', actor: 'agent:a' } }),
      store,
      CONFIG,
    );
    const hop2 = await handleToken(
      makeReq({
        path: '/oauth/token',
        body: { grant_type: GRANT_TYPE, subject_token: (hop1.body as { access_token: string }).access_token, scope: 'workspace:read', actor: 'agent:b' },
      }),
      store,
      CONFIG,
    );
    expect((hop2.body as { act: unknown }).act).toEqual({ sub: 'agent:b', act: { sub: 'agent:a' } });
  });

  it('refuses: invalid subject_token → invalid_grant; out-of-ceiling scope → invalid_scope; loop → invalid_request', async () => {
    const store = createMemoryStore();
    const parent = await mintParent(store, 'workspace:read');

    const bad = await handleToken(
      makeReq({ path: '/oauth/token', body: { grant_type: GRANT_TYPE, subject_token: 'tok_bogus', scope: 'workspace:read' } }),
      store,
      CONFIG,
    );
    expect(bad.statusCode).toBe(400);
    expect((bad.body as { error: string }).error).toBe('invalid_grant');

    const widen = await handleToken(
      makeReq({ path: '/oauth/token', body: { grant_type: GRANT_TYPE, subject_token: parent.token, scope: 'cells:create' } }),
      store,
      CONFIG,
    );
    expect(widen.statusCode).toBe(400);
    expect((widen.body as { error: string }).error).toBe('invalid_scope');

    const hop1 = await handleToken(
      makeReq({ path: '/oauth/token', body: { grant_type: GRANT_TYPE, subject_token: parent.token, scope: 'workspace:read', actor: 'agent:a' } }),
      store,
      CONFIG,
    );
    const loop = await handleToken(
      makeReq({
        path: '/oauth/token',
        body: { grant_type: GRANT_TYPE, subject_token: (hop1.body as { access_token: string }).access_token, scope: 'workspace:read', actor: 'agent:a' },
      }),
      store,
      CONFIG,
    );
    expect(loop.statusCode).toBe(400);
    expect((loop.body as { error: string }).error).toBe('invalid_request');
  });

  it('refuses: missing scope and foreign subject_token_type are invalid_request', async () => {
    const store = createMemoryStore();
    const parent = await mintParent(store);

    const noScope = await handleToken(
      makeReq({ path: '/oauth/token', body: { grant_type: GRANT_TYPE, subject_token: parent.token } }),
      store,
      CONFIG,
    );
    expect(noScope.statusCode).toBe(400);
    expect((noScope.body as { error: string }).error).toBe('invalid_request');

    const badType = await handleToken(
      makeReq({
        path: '/oauth/token',
        body: { grant_type: GRANT_TYPE, subject_token: parent.token, subject_token_type: 'urn:ietf:params:oauth:token-type:jwt', scope: 'workspace:read' },
      }),
      store,
      CONFIG,
    );
    expect(badType.statusCode).toBe(400);
    expect((badType.body as { error: string }).error).toBe('invalid_request');
  });
});

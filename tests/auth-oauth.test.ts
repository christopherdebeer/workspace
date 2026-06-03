import { createMemoryStore } from '../services/auth/memory-store';
import {
  OAuthConfig,
  handleDCR,
  handleConsent,
  handleToken,
  handleDeviceInit,
  handleDeviceApprove,
  validateBearer,
} from '../services/auth/oauth';
import { sha256 } from '../services/auth/store';
import type { ServiceHttpRequest } from '../platform/runtime';

const CONFIG: OAuthConfig = {
  serverName: 'test',
  scopesSupported: ['workspace:read', 'workspace:write'],
  tokenExpirySecs: 3600,
};

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

  it('refreshes a token, rotating and invalidating the old one', async () => {
    const store = createMemoryStore();
    const minted = await store.mintToken({ userId: 'u1', scope: 's', expiresInSec: 60, withRefresh: true });
    const refreshed = await store.refreshUnifiedToken(sha256(minted.refreshToken!), 60);
    expect(refreshed).not.toBeNull();
    // old access token is now revoked
    expect(await store.validateTokenByHash(sha256(minted.token))).toBeNull();
    // new access token works
    expect(await store.validateTokenByHash(sha256(refreshed!.token))).toMatchObject({ scope: 's' });
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

    // 5. The minted token validates.
    const validated = await validateBearer(tok.access_token, store);
    expect(validated).toMatchObject({ userId: 'u1', scope: 'workspace:read' });

    // 6. Refresh works.
    const refreshRes = await handleToken(
      makeReq({ path: '/oauth/token', body: { grant_type: 'refresh_token', refresh_token: tok.refresh_token } }),
      store,
      CONFIG,
    );
    expect((refreshRes.body as { access_token: string }).access_token).toBeTruthy();
  });

  it('rejects a bad PKCE verifier', async () => {
    const store = createMemoryStore();
    await store.createUser('u1', 'alice');
    const sessionId = await store.createSession('u1');
    await handleConsent(
      makeReq({
        path: '/oauth/consent',
        body: { sessionId, clientId: 'cl', redirectUri: 'https://app/cb', codeChallenge: sha256('right'), codeChallengeMethod: 'S256', scope: 'workspace:read' },
      }),
      store,
    );
    // grab the code by consuming a fresh consent
    const sid2 = await store.createSession('u1');
    const consent = await handleConsent(
      makeReq({
        path: '/oauth/consent',
        body: { sessionId: sid2, clientId: 'cl', redirectUri: 'https://app/cb', codeChallenge: sha256('right'), codeChallengeMethod: 'S256' },
      }),
      store,
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
    expect(await validateBearer(tok.access_token, store)).toMatchObject({ userId: 'u1', scope: 'workspace:write' });
  });
});

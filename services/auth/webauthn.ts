/**
 * WebAuthn passkey handlers — register/authenticate options + verify.
 * Ported from c15r/mcp-auth/webauthn.ts. Uses @simplewebauthn/server.
 *
 * This module is imported only by the Lambda entry (service.ts) and bundled by
 * esbuild; it is deliberately kept out of the unit tests, which exercise the
 * store and OAuth logic (no native/ESM WebAuthn dependency required).
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import type { ServiceContext, ServiceHttpRequest, ServiceHttpResponse } from '../../platform/runtime';
import { AuthStore, generateId } from './store';

export interface WebAuthnConfig {
  rpName: string;
  /** Stable RP id; defaults to WEBAUTHN_RP_ID env or the request hostname. */
  rpId?: string;
}

function originOf(req: ServiceHttpRequest): string {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

function rpIdOf(req: ServiceHttpRequest, config: WebAuthnConfig): string {
  const stable = config.rpId ?? process.env.WEBAUTHN_RP_ID;
  const hostname = new URL(req.url).hostname;
  if (!stable) return hostname;
  return hostname === stable || hostname.endsWith(`.${stable}`) ? stable : hostname;
}

/**
 * The origins allowed to *complete* a ceremony. RP ID `parc.land` is a
 * registrable suffix of every `*.parc.land` host, so a cell subdomain could
 * otherwise assert it and phish a passkey. Pin verification to the shell
 * origin(s): `PUBLIC_BASE_URL` plus any explicit extras (`WEBAUTHN_EXPECTED_ORIGINS`,
 * comma/space separated — e.g. a www/apex variant or the bootstrap CloudFront
 * domain). Cell subdomains are not on the list, so they're rejected. Falls back to
 * the request origin only when nothing is configured (local/bootstrap), preserving
 * today's single-origin behaviour. See docs/cell-origin-isolation.md §4.4.
 */
function allowedOrigins(req: ServiceHttpRequest): string[] {
  const list: string[] = [];
  const base = process.env.PUBLIC_BASE_URL;
  if (base) {
    try {
      const u = new URL(base);
      list.push(`${u.protocol}//${u.host}`);
    } catch {
      /* malformed base url — ignore */
    }
  }
  const extra = process.env.WEBAUTHN_EXPECTED_ORIGINS;
  if (extra) for (const o of extra.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)) list.push(o);
  if (list.length === 0) list.push(originOf(req)); // unconfigured ⇒ today's behaviour
  return [...new Set(list)];
}

function json(body: unknown, status = 200): ServiceHttpResponse {
  return { statusCode: status, headers: { 'cache-control': 'no-store' }, body };
}

export async function handleRegisterOptions(
  req: ServiceHttpRequest,
  store: AuthStore,
  config: WebAuthnConfig,
): Promise<ServiceHttpResponse> {
  const { username } = req.json<{ username?: string }>();
  if (!username || typeof username !== 'string' || username.length < 1 || username.length > 64) {
    return json({ error: 'Username required (1-64 chars)' }, 400);
  }
  // The username becomes the owner segment of a cell's subdomain
  // (`<username>-<cellname>.on.parc.land`, docs/cell-origin-isolation.md), so it
  // must be a single DNS label and hyphen-free — the host→cell rewrite splits the
  // label on the first hyphen, reserving it as the owner/cell separator.
  if (!/^[a-z0-9]+$/.test(username)) {
    return json({ error: 'Username must be lowercase letters and digits only — no hyphens or symbols (it becomes part of your cells’ subdomain).' }, 400);
  }
  if (await store.getUserByUsername(username)) {
    return json({ error: 'Username already taken. Try signing in instead.' }, 409);
  }
  const userId = generateId();
  const rpId = rpIdOf(req, config);
  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: rpId,
    userName: username,
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  const challengeId = generateId();
  await store.saveChallenge(challengeId, options.challenge, 'registration', userId);
  return json({ options, challengeId, userId, username });
}

export async function handleRegisterVerify(
  req: ServiceHttpRequest,
  ctx: ServiceContext,
  store: AuthStore,
  config: WebAuthnConfig,
): Promise<ServiceHttpResponse> {
  const { challengeId, userId, username, response } = req.json<{
    challengeId: string;
    userId: string;
    username: string;
    response: unknown;
  }>();
  const rpId = rpIdOf(req, config);
  const origin = originOf(req);
  const origins = allowedOrigins(req);
  const challenge = await store.getChallenge(challengeId);
  if (!challenge || challenge.type !== 'registration') return json({ error: 'Invalid or expired challenge' }, 400);

  try {
    const verification = await verifyRegistrationResponse({
      response: response as never,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origins,
      expectedRPID: rpId,
    });
    if (!verification.verified || !verification.registrationInfo) {
      console.warn('[webauthn] register: not verified', { rpId, origin, allowed: origins });
      return json({ error: `Registration verification returned false (expectedRPID=${rpId}, allowedOrigins=${origins.join(', ')}, requestOrigin=${origin})` }, 400);
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    await store.createUser(userId, username);
    await store.saveCredential({
      id: credential.id,
      userId,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports as string[] | undefined,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      rpId,
    });
    await store.deleteChallenge(challengeId);
    const sessionId = await store.createSession(userId);
    await ctx.events.emit('auth.user.registered', { userId, username });
    return json({ verified: true, sessionId });
  } catch (err) {
    console.warn('[webauthn] register: error', { error: (err as Error).message, rpId, origin, allowed: origins });
    return json({ error: `Registration failed: ${(err as Error).message} (expectedRPID=${rpId}, allowedOrigins=${origins.join(', ')}, requestOrigin=${origin})` }, 400);
  }
}

export async function handleAuthOptions(
  req: ServiceHttpRequest,
  store: AuthStore,
  config: WebAuthnConfig,
): Promise<ServiceHttpResponse> {
  const body = req.json<{ username?: string }>();
  const rpId = rpIdOf(req, config);
  let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined;
  if (body.username) {
    const user = await store.getUserByUsername(body.username);
    if (user) {
      const creds = await store.getCredentialsByUserId(user.id, rpId);
      allowCredentials = creds.map((c) => ({ id: c.id, transports: c.transports as AuthenticatorTransportFuture[] | undefined }));
    }
  }
  const options = await generateAuthenticationOptions({ rpID: rpId, userVerification: 'preferred', allowCredentials });
  const challengeId = generateId();
  await store.saveChallenge(challengeId, options.challenge, 'authentication');
  return json({ options, challengeId });
}

export async function handleAuthVerify(
  req: ServiceHttpRequest,
  store: AuthStore,
  config: WebAuthnConfig,
): Promise<ServiceHttpResponse> {
  const { challengeId, response } = req.json<{ challengeId: string; response: { id: string } }>();
  const rpId = rpIdOf(req, config);
  const origin = originOf(req);
  const origins = allowedOrigins(req);
  const challenge = await store.getChallenge(challengeId);
  if (!challenge || challenge.type !== 'authentication') return json({ error: 'Invalid or expired challenge' }, 400);

  const credential = await store.getCredentialById(response.id);
  if (!credential) {
    // Most often: the credential was registered against a different RP id /
    // origin (or the table was replaced), so the server has no record of it.
    console.warn('[webauthn] auth: unknown credential', { credentialId: response.id, rpId, origin });
    return json({ error: `Unknown credential ${response.id} — no server record for this passkey (expected rpId=${rpId}); it was likely registered on a different origin/RP, or the auth table was replaced` }, 400);
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response: response as never,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origins,
      expectedRPID: rpId,
      credential: {
        id: credential.id,
        // simplewebauthn wants an ArrayBuffer-backed view; copy to satisfy the
        // stricter generic (our store types it as a plain Uint8Array).
        publicKey: Uint8Array.from(credential.publicKey) as Uint8Array<ArrayBuffer>,
        counter: credential.counter,
        transports: credential.transports as AuthenticatorTransportFuture[] | undefined,
      },
    });
    if (!verification.verified) {
      console.warn('[webauthn] auth: not verified', { credentialId: credential.id, credentialRpId: credential.rpId, rpId, origin, allowed: origins });
      return json({ error: `Authentication verification returned false (expectedRPID=${rpId}, allowedOrigins=${origins.join(', ')}, requestOrigin=${origin}, credentialRpId=${credential.rpId ?? 'null'})` }, 400);
    }
    await store.updateCredentialCounter(credential.id, verification.authenticationInfo.newCounter);
    await store.deleteChallenge(challengeId);
    const sessionId = await store.createSession(credential.userId);
    return json({ verified: true, sessionId });
  } catch (err) {
    console.warn('[webauthn] auth: error', { error: (err as Error).message, credentialRpId: credential.rpId, rpId, origin });
    return json({ error: `Auth failed: ${(err as Error).message} (expectedRPID=${rpId}, expectedOrigin=${origin}, credentialRpId=${credential.rpId ?? 'null'})` }, 400);
  }
}

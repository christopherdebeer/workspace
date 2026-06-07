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
  const challenge = await store.getChallenge(challengeId);
  if (!challenge || challenge.type !== 'registration') return json({ error: 'Invalid or expired challenge' }, 400);

  try {
    const verification = await verifyRegistrationResponse({
      response: response as never,
      expectedChallenge: challenge.challenge,
      expectedOrigin: originOf(req),
      expectedRPID: rpIdOf(req, config),
    });
    if (!verification.verified || !verification.registrationInfo) return json({ error: 'Verification failed' }, 400);

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
      rpId: rpIdOf(req, config),
    });
    await store.deleteChallenge(challengeId);
    const sessionId = await store.createSession(userId);
    await ctx.events.emit('auth.user.registered', { userId, username });
    return json({ verified: true, sessionId });
  } catch (err) {
    return json({ error: `Registration failed: ${(err as Error).message}` }, 400);
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
  const challenge = await store.getChallenge(challengeId);
  if (!challenge || challenge.type !== 'authentication') return json({ error: 'Invalid or expired challenge' }, 400);

  const credential = await store.getCredentialById(response.id);
  if (!credential) {
    // Most often: the credential was registered against a different RP id /
    // origin (or the table was replaced), so the server has no record of it.
    console.warn('[webauthn] auth: unknown credential', { credentialId: response.id, rpId, origin });
    return json({ error: 'Unknown credential' }, 400);
  }

  try {
    const verification = await verifyAuthenticationResponse({
      response: response as never,
      expectedChallenge: challenge.challenge,
      expectedOrigin: origin,
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
      console.warn('[webauthn] auth: not verified', { credentialId: credential.id, credentialRpId: credential.rpId, rpId, origin });
      return json({ error: 'Authentication failed' }, 400);
    }
    await store.updateCredentialCounter(credential.id, verification.authenticationInfo.newCounter);
    await store.deleteChallenge(challengeId);
    const sessionId = await store.createSession(credential.userId);
    return json({ verified: true, sessionId });
  } catch (err) {
    console.warn('[webauthn] auth: error', { error: (err as Error).message, credentialRpId: credential.rpId, rpId, origin });
    return json({ error: `Auth failed: ${(err as Error).message}` }, 400);
  }
}

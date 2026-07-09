/**
 * Auth storage contract + crypto helpers.
 *
 * Ported from c15r/mcp-auth's SQLite `db.ts`, but expressed as a storage-agnostic
 * `AuthStore` interface so the auth cell can run on DynamoDB in production and an
 * in-memory store in tests/local. The entity shapes and method names mirror the
 * original so the OAuth/WebAuthn handlers port with minimal change.
 */
import { randomUUID, randomBytes, createHash } from 'crypto';

// ─── Crypto helpers ──────────────────────────────────────────────

export function generateId(): string {
  return randomUUID();
}

export function generateToken(prefix = ''): string {
  const b64 = randomBytes(32).toString('base64url');
  return prefix ? `${prefix}_${b64}` : b64;
}

/** SHA-256 → base64url. Tokens are stored only as hashes. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

export function b64urlEncode(buf: Uint8Array): string {
  return Buffer.from(buf).toString('base64url');
}

export function b64urlDecode(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64url'));
}

// ─── Entity types ────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  created_at: string;
}

export interface StoredCredential {
  id: string;
  userId: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
  deviceType?: string | null;
  backedUp?: boolean;
  rpId?: string | null;
}

export interface Challenge {
  id: string;
  challenge: string;
  userId: string | null;
  type: string;
}

export interface OAuthClient {
  clientId: string;
  clientSecret: string | null;
  redirectUris: string[];
  clientName: string | null;
}

export interface AuthCode {
  code: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string | null;
  resource: string | null;
  /**
   * Grant lifetime chosen by the user at consent (seconds), already clamped to the
   * server ceiling. Bounds the issued grant's horizon — the refresh-token TTL in
   * the usual short-access/long-refresh mode, or the access token itself on a
   * non-expiring deployment. Null = use the server default (docs/capability-consent.md).
   */
  grantSecs?: number | null;
}

export interface SessionInfo {
  userId: string;
  scope: string;
}

export interface MintTokenParams {
  userId: string;
  scope: string;
  label?: string;
  clientId?: string;
  expiresInSec?: number;
  withRefresh?: boolean;
  /**
   * Lifetime of the issued refresh token, independent of the access token's.
   * Refresh tokens are meant to outlive the access token they renew (that is the
   * point of refresh), so this defaults to `REFRESH_TTL_MS` rather than tracking
   * `expiresInSec`. Only meaningful when `withRefresh` is set.
   */
  refreshExpiresInSec?: number;
}

export interface MintedToken {
  id: string;
  token: string;
  refreshToken?: string;
  expiresAt: string | null;
}

/**
 * A principal's adopted posture (ADR-0074): what this credential is currently
 * *for*, not what it may touch. `goal` is either a workspace fact key
 * (`goal/<id>` — the @c15r/tasks vocabulary) or free text; `lens`/`salience`
 * name a read bias. Auth stores it opaquely — the workspace read path is what
 * interprets it (defaults ← config ← PRINCIPAL ← lens ← override). Mutable via
 * `setPosture`, exactly like `effectiveScope`: a session property of the token.
 */
export interface TokenPosture {
  goal?: string;
  lens?: string;
  salience?: Record<string, number>;
  adoptedAt?: string;
}

export interface TokenInfo {
  id: string;
  mintedBy: string;
  scope: string;
  /** The session's effective scope (≤ `scope`); null ⇒ the full grant is effective.
   *  Mutable via `setEffectiveScope` — incremental authorization. */
  effectiveScope?: string | null;
  /** The adopted posture (ADR-0074); null/absent ⇒ no posture (reads unbiased). */
  posture?: TokenPosture | null;
  label: string | null;
  clientId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface TokenSummary {
  id: string;
  scope: string;
  label: string | null;
  clientId: string | null;
  revoked: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface RefreshResult {
  id: string;
  token: string;
  refreshToken: string;
  expiresAt: string;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  scope: string;
  status: string;
  approvedBy: string | null;
  expiresAt: string;
}

export interface SaveCredentialInput {
  id: string;
  userId: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
  deviceType?: string | null;
  backedUp?: boolean;
  rpId?: string | null;
}

/** Storage backend for the auth cell. */
export interface AuthStore {
  // users
  createUser(id: string, username: string): Promise<void>;
  getUserByUsername(username: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  // credentials
  saveCredential(cred: SaveCredentialInput): Promise<void>;
  getCredentialsByUserId(userId: string, rpId?: string): Promise<StoredCredential[]>;
  getCredentialById(credId: string): Promise<StoredCredential | null>;
  updateCredentialCounter(credId: string, newCounter: number): Promise<void>;
  // challenges
  saveChallenge(id: string, challenge: string, type: string, userId?: string): Promise<void>;
  getChallenge(id: string): Promise<Challenge | null>;
  deleteChallenge(id: string): Promise<void>;
  // oauth clients
  saveOAuthClient(client: {
    clientId: string;
    clientSecret?: string;
    redirectUris: string[];
    clientName?: string | null;
  }): Promise<void>;
  getOAuthClient(clientId: string): Promise<OAuthClient | null>;
  // auth codes
  saveAuthCode(code: {
    code: string;
    clientId: string;
    userId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope?: string;
    resource?: string;
    grantSecs?: number | null;
  }): Promise<void>;
  consumeAuthCode(code: string): Promise<AuthCode | null>;
  // sessions
  createSession(userId: string, scope?: string): Promise<string>;
  validateSession(sessionId: string): Promise<SessionInfo | null>;
  deleteSession(sessionId: string): Promise<void>;
  // tokens
  mintToken(params: MintTokenParams): Promise<MintedToken>;
  validateTokenByHash(hash: string): Promise<TokenInfo | null>;
  /**
   * Set (or clear, with null) a token's effective scope — the session's mutable
   * focus within its grant ceiling (incremental authorization,
   * docs/capability-consent.md). Keyed by the owner's account id so a session can
   * only narrow/widen its own token. Returns false when no such token exists.
   */
  setEffectiveScope(tokenId: string, userId: string, effectiveScope: string | null): Promise<boolean>;
  /**
   * Set (or clear, with null) a token's adopted posture (ADR-0074) — the
   * session's declared purpose, mirrored into every read via the identity.
   * Owner-keyed like `setEffectiveScope`; returns false when no such token.
   */
  setPosture(tokenId: string, userId: string, posture: TokenPosture | null): Promise<boolean>;
  /**
   * Patch a token you own — token-as-principal stewardship (docs/token-as-principal-plan.md).
   * Relabel, re-scope (the GRANT ceiling; resets `effectiveScope` so the new grant is
   * fully effective), and/or re-horizon its expiry (`expiresInSec` ≤ 0 / null ⇒ no
   * expiry). The service clamps `scope` to the caller's own standing (narrow-only).
   * Returns the updated summary, or null when no live token with that id is owned by
   * `userId`.
   */
  updateToken(
    tokenId: string,
    userId: string,
    patch: { label?: string; scope?: string; expiresInSec?: number | null },
  ): Promise<TokenSummary | null>;
  refreshUnifiedToken(
    oldRefreshHash: string,
    newExpiresInSec?: number,
    newRefreshExpiresInSec?: number,
  ): Promise<RefreshResult | null>;
  revokeToken(tokenId: string, userId: string): Promise<boolean>;
  /**
   * Revoke whichever token a raw value denotes — access or refresh — for the
   * RFC 7009 revocation endpoint. Idempotent; revoking an access token also
   * invalidates its paired refresh token and vice-versa.
   */
  revokeByTokenValue(token: string): Promise<void>;
  listUserTokens(userId: string): Promise<TokenSummary[]>;
  // device codes
  createDeviceCode(scope: string, clientId?: string): Promise<{ deviceCode: string; userCode: string; expiresAt: string }>;
  getDeviceCode(deviceCode: string): Promise<DeviceCode | null>;
  getDeviceCodeByUserCode(userCode: string): Promise<DeviceCode | null>;
  approveDeviceCode(deviceCode: string, userId: string): Promise<boolean>;
  consumeDeviceCode(deviceCode: string): Promise<{ scope: string; approvedBy: string } | null>;
}

// ─── Shared TTL/expiry helpers ───────────────────────────────────

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const SESSION_TTL_MS = 15 * 60 * 1000;
export const DEVICE_TTL_MS = 15 * 60 * 1000;
/** Default refresh-token lifetime (30 days) — outlives the access token. */
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export function isExpired(isoTime: string | null | undefined): boolean {
  return !!isoTime && new Date(isoTime).getTime() < Date.now();
}

const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateUserCode(): string {
  const pick = () =>
    Array.from({ length: 4 }, () => USER_CODE_ALPHABET[Math.floor(Math.random() * USER_CODE_ALPHABET.length)]).join('');
  return `${pick()}-${pick()}`;
}

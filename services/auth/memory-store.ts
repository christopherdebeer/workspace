/**
 * In-memory AuthStore — for unit tests and local/dev runs (no DynamoDB).
 * Semantics mirror the DynamoDB store: expiry, single-use codes, revocation.
 */
import {
  AuthStore,
  User,
  StoredCredential,
  Challenge,
  OAuthClient,
  AuthCode,
  SessionInfo,
  MintTokenParams,
  MintedToken,
  TokenInfo,
  TokenSummary,
  RefreshResult,
  DeviceCode,
  SaveCredentialInput,
  generateId,
  generateToken,
  sha256,
  isoIn,
  isExpired,
  generateUserCode,
  CHALLENGE_TTL_MS,
  CODE_TTL_MS,
  SESSION_TTL_MS,
  DEVICE_TTL_MS,
  REFRESH_TTL_MS,
} from './store';

interface TokenRow {
  id: string;
  tokenHash: string;
  refreshHash: string | null;
  mintedBy: string;
  scope: string;
  label: string | null;
  clientId: string | null;
  revoked: boolean;
  expiresAt: string | null;
  createdAt: string;
}

interface RefreshRow {
  tokenId: string;
  tokenHash: string;
  mintedBy: string;
  scope: string;
  clientId: string | null;
  expiresAt: string;
}

export function createMemoryStore(): AuthStore {
  const users = new Map<string, User>();
  const usersByName = new Map<string, string>();
  const creds = new Map<string, StoredCredential>();
  const challenges = new Map<string, Challenge & { expiresAt: string }>();
  const clients = new Map<string, OAuthClient>();
  const codes = new Map<string, AuthCode & { expiresAt: string; used: boolean }>();
  const sessions = new Map<string, SessionInfo & { expiresAt: string }>();
  const tokens = new Map<string, TokenRow>(); // keyed by tokenHash
  // refreshHash -> self-contained refresh row (its own expiry, outlives access)
  const refreshRows = new Map<string, RefreshRow>();
  const deviceCodes = new Map<string, DeviceCode & { clientId: string | null }>();
  const deviceByUserCode = new Map<string, string>();

  return {
    async createUser(id, username) {
      const user: User = { id, username, created_at: new Date().toISOString() };
      users.set(id, user);
      usersByName.set(username, id);
    },
    async getUserByUsername(username) {
      const id = usersByName.get(username);
      return id ? users.get(id) ?? null : null;
    },
    async getUserById(id) {
      return users.get(id) ?? null;
    },

    async saveCredential(cred: SaveCredentialInput) {
      creds.set(cred.id, { ...cred });
    },
    async getCredentialsByUserId(userId, rpId) {
      return [...creds.values()].filter(
        (c) => c.userId === userId && (!rpId || c.rpId === rpId || c.rpId == null),
      );
    },
    async getCredentialById(credId) {
      return creds.get(credId) ?? null;
    },
    async updateCredentialCounter(credId, newCounter) {
      const c = creds.get(credId);
      if (c) c.counter = newCounter;
    },

    async saveChallenge(id, challenge, type, userId) {
      challenges.set(id, { id, challenge, type, userId: userId ?? null, expiresAt: isoIn(CHALLENGE_TTL_MS) });
    },
    async getChallenge(id) {
      const c = challenges.get(id);
      if (!c || isExpired(c.expiresAt)) return null;
      return { id: c.id, challenge: c.challenge, userId: c.userId, type: c.type };
    },
    async deleteChallenge(id) {
      challenges.delete(id);
    },

    async saveOAuthClient(client) {
      clients.set(client.clientId, {
        clientId: client.clientId,
        clientSecret: client.clientSecret ?? null,
        redirectUris: client.redirectUris,
        clientName: client.clientName ?? null,
      });
    },
    async getOAuthClient(clientId) {
      return clients.get(clientId) ?? null;
    },

    async saveAuthCode(code) {
      codes.set(code.code, {
        code: code.code,
        clientId: code.clientId,
        userId: code.userId,
        redirectUri: code.redirectUri,
        codeChallenge: code.codeChallenge,
        codeChallengeMethod: code.codeChallengeMethod,
        scope: code.scope ?? null,
        resource: code.resource ?? null,
        expiresAt: isoIn(CODE_TTL_MS),
        used: false,
      });
    },
    async consumeAuthCode(code) {
      const c = codes.get(code);
      if (!c || c.used || isExpired(c.expiresAt)) return null;
      c.used = true;
      return {
        code: c.code,
        clientId: c.clientId,
        userId: c.userId,
        redirectUri: c.redirectUri,
        codeChallenge: c.codeChallenge,
        codeChallengeMethod: c.codeChallengeMethod,
        scope: c.scope,
        resource: c.resource,
      };
    },

    async createSession(userId, scope = 'consent') {
      const id = generateToken('sess');
      sessions.set(id, { userId, scope, expiresAt: isoIn(SESSION_TTL_MS) });
      return id;
    },
    async validateSession(sessionId) {
      const s = sessions.get(sessionId);
      if (!s || isExpired(s.expiresAt)) return null;
      return { userId: s.userId, scope: s.scope };
    },
    async deleteSession(sessionId) {
      sessions.delete(sessionId);
    },

    async mintToken(params: MintTokenParams): Promise<MintedToken> {
      const id = generateId();
      const token = generateToken('tok');
      const tokenHash = sha256(token);
      const expiresAt = params.expiresInSec ? isoIn(params.expiresInSec * 1000) : null;
      let refreshToken: string | undefined;
      let refreshHash: string | null = null;
      if (params.withRefresh) {
        refreshToken = generateToken('ref');
        refreshHash = sha256(refreshToken);
      }
      tokens.set(tokenHash, {
        id,
        tokenHash,
        refreshHash,
        mintedBy: params.userId,
        scope: params.scope,
        label: params.label ?? null,
        clientId: params.clientId ?? null,
        revoked: false,
        expiresAt,
        createdAt: new Date().toISOString(),
      });
      if (refreshHash) {
        // Self-contained, independently-expiring refresh row (mirrors Dynamo).
        refreshRows.set(refreshHash, {
          tokenId: id,
          tokenHash,
          mintedBy: params.userId,
          scope: params.scope,
          clientId: params.clientId ?? null,
          expiresAt: isoIn((params.refreshExpiresInSec ?? REFRESH_TTL_MS / 1000) * 1000),
        });
      }
      return { id, token, refreshToken, expiresAt };
    },
    async validateTokenByHash(hash): Promise<TokenInfo | null> {
      const t = tokens.get(hash);
      if (!t || t.revoked || isExpired(t.expiresAt)) return null;
      return {
        id: t.id,
        mintedBy: t.mintedBy,
        scope: t.scope,
        label: t.label,
        clientId: t.clientId,
        expiresAt: t.expiresAt,
        createdAt: t.createdAt,
      };
    },
    async refreshUnifiedToken(oldRefreshHash, newExpiresInSec = 3600, newRefreshExpiresInSec): Promise<RefreshResult | null> {
      // Validate the refresh row on its own (longer) expiry — not the access
      // token's, which is expected to be expired/gone when refreshing.
      const ref = refreshRows.get(oldRefreshHash);
      if (!ref || isExpired(ref.expiresAt)) return null;
      const old = tokens.get(ref.tokenHash);
      if (old) old.revoked = true;
      refreshRows.delete(oldRefreshHash); // rotate: consume the old refresh
      const minted = await this.mintToken({
        userId: ref.mintedBy,
        scope: ref.scope,
        clientId: ref.clientId ?? undefined,
        expiresInSec: newExpiresInSec,
        withRefresh: true,
        refreshExpiresInSec: newRefreshExpiresInSec,
      });
      return { id: minted.id, token: minted.token, refreshToken: minted.refreshToken!, expiresAt: minted.expiresAt! };
    },
    async revokeToken(tokenId, userId): Promise<boolean> {
      for (const t of tokens.values()) {
        if (t.id === tokenId && t.mintedBy === userId) {
          t.revoked = true;
          // Cascade: invalidate the paired refresh token too.
          if (t.refreshHash) refreshRows.delete(t.refreshHash);
          return true;
        }
      }
      return false;
    },
    async revokeByTokenValue(token): Promise<void> {
      const hash = sha256(token);
      const access = tokens.get(hash);
      if (access) {
        access.revoked = true;
        if (access.refreshHash) refreshRows.delete(access.refreshHash);
        return;
      }
      const ref = refreshRows.get(hash);
      if (ref) {
        refreshRows.delete(hash);
        const t = tokens.get(ref.tokenHash);
        if (t) t.revoked = true;
      }
    },
    async listUserTokens(userId): Promise<TokenSummary[]> {
      return [...tokens.values()]
        .filter((t) => t.mintedBy === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((t) => ({
          id: t.id,
          scope: t.scope,
          label: t.label,
          clientId: t.clientId,
          revoked: t.revoked,
          expiresAt: t.expiresAt,
          createdAt: t.createdAt,
        }));
    },

    async createDeviceCode(scope, clientId) {
      const deviceCode = generateToken('dev');
      let userCode = generateUserCode();
      while (deviceByUserCode.has(userCode)) userCode = generateUserCode();
      const expiresAt = isoIn(DEVICE_TTL_MS);
      deviceCodes.set(deviceCode, {
        deviceCode,
        userCode,
        scope,
        status: 'pending',
        approvedBy: null,
        expiresAt,
        clientId: clientId ?? 'cli',
      });
      deviceByUserCode.set(userCode, deviceCode);
      return { deviceCode, userCode, expiresAt };
    },
    async getDeviceCode(deviceCode) {
      return deviceCodes.get(deviceCode) ?? null;
    },
    async getDeviceCodeByUserCode(userCode) {
      const dc = deviceByUserCode.get(userCode);
      const found = dc ? deviceCodes.get(dc) : undefined;
      if (!found || isExpired(found.expiresAt)) return null;
      return found;
    },
    async approveDeviceCode(deviceCode, userId) {
      const dc = deviceCodes.get(deviceCode);
      if (!dc || dc.status !== 'pending' || isExpired(dc.expiresAt)) return false;
      dc.status = 'approved';
      dc.approvedBy = userId;
      return true;
    },
    async consumeDeviceCode(deviceCode) {
      const dc = deviceCodes.get(deviceCode);
      if (!dc || dc.status !== 'approved' || !dc.approvedBy || isExpired(dc.expiresAt)) return null;
      dc.status = 'consumed';
      return { scope: dc.scope, approvedBy: dc.approvedBy };
    },
  };
}

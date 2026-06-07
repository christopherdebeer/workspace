/**
 * DynamoDB-backed AuthStore.
 *
 * Single-table design on the platform's standard `pk`/`sk` schema, with native
 * TTL (the `ttl` attribute) auto-expiring challenges, codes, sessions, and
 * expiring tokens. Secondary lookups (by username, by user, by refresh hash)
 * are modelled with index items rather than GSIs, so it works on the table that
 * `HttpServiceCell({ persistence: { dynamo: true, dynamoTtl: true } })` creates.
 */
import { DynamoDB } from 'aws-sdk';
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
  b64urlEncode,
  b64urlDecode,
  isoIn,
  isExpired,
  generateUserCode,
  CHALLENGE_TTL_MS,
  CODE_TTL_MS,
  SESSION_TTL_MS,
  DEVICE_TTL_MS,
  REFRESH_TTL_MS,
} from './store';

const SK = 'A'; // single sort key for "profile" items

function ttlOf(iso: string | null): number | undefined {
  return iso ? Math.floor(new Date(iso).getTime() / 1000) : undefined;
}

export function createDynamoStore(tableName: string): AuthStore {
  const db = new DynamoDB.DocumentClient();

  const put = (Item: Record<string, unknown>) => db.put({ TableName: tableName, Item }).promise();
  const get = async (pk: string, sk: string = SK) => {
    const res = await db.get({ TableName: tableName, Key: { pk, sk } }).promise();
    return res.Item;
  };
  const del = (pk: string, sk: string = SK) => db.delete({ TableName: tableName, Key: { pk, sk } }).promise();

  return {
    // ── users ──
    async createUser(id, username) {
      const created_at = new Date().toISOString();
      await put({ pk: `USER#${id}`, sk: SK, id, username, created_at });
      await put({ pk: `UNAME#${username}`, sk: SK, id, username, created_at });
    },
    async getUserByUsername(username): Promise<User | null> {
      const item = await get(`UNAME#${username}`);
      return item ? { id: item.id, username: item.username, created_at: item.created_at } : null;
    },
    async getUserById(id): Promise<User | null> {
      const item = await get(`USER#${id}`);
      return item ? { id: item.id, username: item.username, created_at: item.created_at } : null;
    },

    // ── credentials ──
    async saveCredential(cred: SaveCredentialInput) {
      await put({
        pk: `CRED#${cred.id}`,
        sk: SK,
        id: cred.id,
        userId: cred.userId,
        publicKey: b64urlEncode(cred.publicKey),
        counter: cred.counter,
        transports: cred.transports ?? null,
        deviceType: cred.deviceType ?? null,
        backedUp: cred.backedUp ?? false,
        rpId: cred.rpId ?? null,
      });
      // by-user index item (id + transports + rpId are enough for allowCredentials)
      await put({
        pk: `USER#${cred.userId}`,
        sk: `CRED#${cred.id}`,
        id: cred.id,
        userId: cred.userId,
        transports: cred.transports ?? null,
        rpId: cred.rpId ?? null,
      });
    },
    async getCredentialsByUserId(userId, rpId): Promise<StoredCredential[]> {
      const res = await db
        .query({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)',
          ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':p': 'CRED#' },
        })
        .promise();
      return (res.Items ?? [])
        .filter((i) => !rpId || i.rpId === rpId || i.rpId == null)
        .map((i) => ({
          id: i.id,
          userId,
          publicKey: new Uint8Array(),
          counter: 0,
          transports: i.transports ?? undefined,
          rpId: i.rpId ?? null,
        }));
    },
    async getCredentialById(credId): Promise<StoredCredential | null> {
      const i = await get(`CRED#${credId}`);
      if (!i) return null;
      return {
        id: i.id,
        userId: i.userId,
        publicKey: b64urlDecode(i.publicKey),
        counter: i.counter,
        transports: i.transports ?? undefined,
        deviceType: i.deviceType ?? null,
        backedUp: i.backedUp ?? false,
        rpId: i.rpId ?? null,
      };
    },
    async updateCredentialCounter(credId, newCounter) {
      await db
        .update({
          TableName: tableName,
          Key: { pk: `CRED#${credId}`, sk: SK },
          UpdateExpression: 'SET #c = :c',
          ExpressionAttributeNames: { '#c': 'counter' },
          ExpressionAttributeValues: { ':c': newCounter },
        })
        .promise();
    },

    // ── challenges ──
    async saveChallenge(id, challenge, type, userId) {
      const expiresAt = isoIn(CHALLENGE_TTL_MS);
      await put({ pk: `CHAL#${id}`, sk: SK, id, challenge, type, userId: userId ?? null, expiresAt, ttl: ttlOf(expiresAt) });
    },
    async getChallenge(id): Promise<Challenge | null> {
      const i = await get(`CHAL#${id}`);
      if (!i || isExpired(i.expiresAt)) return null;
      return { id: i.id, challenge: i.challenge, userId: i.userId ?? null, type: i.type };
    },
    async deleteChallenge(id) {
      await del(`CHAL#${id}`);
    },

    // ── oauth clients ──
    async saveOAuthClient(client) {
      await put({
        pk: `CLIENT#${client.clientId}`,
        sk: SK,
        clientId: client.clientId,
        clientSecret: client.clientSecret ?? null,
        redirectUris: client.redirectUris,
        clientName: client.clientName ?? null,
      });
    },
    async getOAuthClient(clientId): Promise<OAuthClient | null> {
      const i = await get(`CLIENT#${clientId}`);
      if (!i) return null;
      return { clientId: i.clientId, clientSecret: i.clientSecret ?? null, redirectUris: i.redirectUris, clientName: i.clientName ?? null };
    },

    // ── auth codes ──
    async saveAuthCode(code) {
      const expiresAt = isoIn(CODE_TTL_MS);
      await put({
        pk: `CODE#${code.code}`,
        sk: SK,
        ...code,
        scope: code.scope ?? null,
        resource: code.resource ?? null,
        used: false,
        expiresAt,
        ttl: ttlOf(expiresAt),
      });
    },
    async consumeAuthCode(code): Promise<AuthCode | null> {
      const i = await get(`CODE#${code}`);
      if (!i || i.used || isExpired(i.expiresAt)) return null;
      try {
        await db
          .update({
            TableName: tableName,
            Key: { pk: `CODE#${code}`, sk: SK },
            UpdateExpression: 'SET #u = :true',
            ConditionExpression: '#u = :false',
            ExpressionAttributeNames: { '#u': 'used' },
            ExpressionAttributeValues: { ':true': true, ':false': false },
          })
          .promise();
      } catch {
        return null; // lost the race; already used
      }
      return {
        code: i.code,
        clientId: i.clientId,
        userId: i.userId,
        redirectUri: i.redirectUri,
        codeChallenge: i.codeChallenge,
        codeChallengeMethod: i.codeChallengeMethod,
        scope: i.scope ?? null,
        resource: i.resource ?? null,
      };
    },

    // ── sessions ──
    async createSession(userId, scope = 'consent') {
      const id = generateToken('sess');
      const expiresAt = isoIn(SESSION_TTL_MS);
      await put({ pk: `SESS#${id}`, sk: SK, userId, scope, expiresAt, ttl: ttlOf(expiresAt) });
      return id;
    },
    async validateSession(sessionId): Promise<SessionInfo | null> {
      const i = await get(`SESS#${sessionId}`);
      if (!i || isExpired(i.expiresAt)) return null;
      return { userId: i.userId, scope: i.scope ?? 'consent' };
    },
    async deleteSession(sessionId) {
      await del(`SESS#${sessionId}`);
    },

    // ── tokens ──
    async mintToken(params: MintTokenParams): Promise<MintedToken> {
      const id = generateId();
      const token = generateToken('tok');
      const tokenHash = sha256(token);
      const expiresAt = params.expiresInSec ? isoIn(params.expiresInSec * 1000) : null;
      const createdAt = new Date().toISOString();
      let refreshToken: string | undefined;
      let refreshHash: string | null = null;
      if (params.withRefresh) {
        refreshToken = generateToken('ref');
        refreshHash = sha256(refreshToken);
      }
      const base = {
        id,
        tokenHash,
        mintedBy: params.userId,
        scope: params.scope,
        label: params.label ?? null,
        clientId: params.clientId ?? null,
        revoked: false,
        expiresAt,
        createdAt,
      };
      await put({ pk: `TOKEN#${tokenHash}`, sk: SK, ...base, refreshHash, ttl: ttlOf(expiresAt) });
      await put({ pk: `USERTOK#${params.userId}`, sk: id, ...base, ttl: ttlOf(expiresAt) });
      if (refreshHash) {
        // The refresh row is self-contained and carries its OWN, longer expiry —
        // it must outlive the access token (and survive that row's TTL deletion),
        // so `refreshUnifiedToken` can mint a new pair without the access row.
        const refreshExpiresAt = isoIn((params.refreshExpiresInSec ?? REFRESH_TTL_MS / 1000) * 1000);
        await put({
          pk: `REFRESH#${refreshHash}`,
          sk: SK,
          tokenId: id,
          tokenHash,
          mintedBy: params.userId,
          scope: params.scope,
          clientId: params.clientId ?? null,
          revoked: false,
          expiresAt: refreshExpiresAt,
          ttl: ttlOf(refreshExpiresAt),
        });
      }
      return { id, token, refreshToken, expiresAt };
    },
    async validateTokenByHash(hash): Promise<TokenInfo | null> {
      const i = await get(`TOKEN#${hash}`);
      if (!i || i.revoked || isExpired(i.expiresAt)) return null;
      return {
        id: i.id,
        mintedBy: i.mintedBy,
        scope: i.scope,
        label: i.label ?? null,
        clientId: i.clientId ?? null,
        expiresAt: i.expiresAt ?? null,
        createdAt: i.createdAt,
      };
    },
    async refreshUnifiedToken(oldRefreshHash, newExpiresInSec = 3600, newRefreshExpiresInSec): Promise<RefreshResult | null> {
      // Validate the REFRESH row on its OWN terms — an expired access token is
      // precisely when a refresh is needed, so we must not gate on it (and the
      // access row may already be gone via TTL).
      const ref = await get(`REFRESH#${oldRefreshHash}`);
      if (!ref || ref.revoked || isExpired(ref.expiresAt)) return null;
      // Rotate: invalidate the old access token (best-effort; may be TTL-gone)
      // and consume the old refresh row so it cannot be replayed.
      await this.revokeToken(String(ref.tokenId), String(ref.mintedBy));
      await del(`REFRESH#${oldRefreshHash}`);
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
      const idx = await get(`USERTOK#${userId}`, tokenId);
      if (!idx) return false;
      await db
        .update({
          TableName: tableName,
          Key: { pk: `TOKEN#${idx.tokenHash}`, sk: SK },
          UpdateExpression: 'SET revoked = :t',
          ExpressionAttributeValues: { ':t': true },
        })
        .promise();
      await db
        .update({
          TableName: tableName,
          Key: { pk: `USERTOK#${userId}`, sk: tokenId },
          UpdateExpression: 'SET revoked = :t',
          ExpressionAttributeValues: { ':t': true },
        })
        .promise();
      // Cascade to the paired refresh token, so a revoked access token can't be
      // resurrected by a refresh.
      const tok = await get(`TOKEN#${idx.tokenHash}`);
      if (tok?.refreshHash) await del(`REFRESH#${tok.refreshHash}`);
      return true;
    },
    async revokeByTokenValue(token): Promise<void> {
      const hash = sha256(token);
      // The value may be an access token …
      const access = await get(`TOKEN#${hash}`);
      if (access) {
        await this.revokeToken(String(access.id), String(access.mintedBy));
        return;
      }
      // … or a refresh token: drop the refresh row and revoke its access token.
      const ref = await get(`REFRESH#${hash}`);
      if (ref) {
        await del(`REFRESH#${hash}`);
        await this.revokeToken(String(ref.tokenId), String(ref.mintedBy));
      }
    },
    async listUserTokens(userId): Promise<TokenSummary[]> {
      const res = await db
        .query({
          TableName: tableName,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: { ':pk': `USERTOK#${userId}` },
        })
        .promise();
      return (res.Items ?? [])
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .map((i) => ({
          id: i.id,
          scope: i.scope,
          label: i.label ?? null,
          clientId: i.clientId ?? null,
          revoked: !!i.revoked,
          expiresAt: i.expiresAt ?? null,
          createdAt: i.createdAt,
        }));
    },

    // ── device codes ──
    async createDeviceCode(scope, clientId) {
      const deviceCode = generateToken('dev');
      const expiresAt = isoIn(DEVICE_TTL_MS);
      for (let i = 0; i < 5; i++) {
        const userCode = generateUserCode();
        try {
          await db
            .put({
              TableName: tableName,
              Item: { pk: `DEVUC#${userCode}`, sk: SK, deviceCode, ttl: ttlOf(expiresAt) },
              ConditionExpression: 'attribute_not_exists(pk)',
            })
            .promise();
          await put({
            pk: `DEV#${deviceCode}`,
            sk: SK,
            deviceCode,
            userCode,
            scope,
            status: 'pending',
            approvedBy: null,
            clientId: clientId ?? 'cli',
            expiresAt,
            ttl: ttlOf(expiresAt),
          });
          return { deviceCode, userCode, expiresAt };
        } catch {
          // user_code collision; retry
        }
      }
      throw new Error('Failed to generate unique user code');
    },
    async getDeviceCode(deviceCode): Promise<DeviceCode | null> {
      const i = await get(`DEV#${deviceCode}`);
      if (!i) return null;
      return { deviceCode: i.deviceCode, userCode: i.userCode, scope: i.scope, status: i.status, approvedBy: i.approvedBy ?? null, expiresAt: i.expiresAt };
    },
    async getDeviceCodeByUserCode(userCode): Promise<DeviceCode | null> {
      const idx = await get(`DEVUC#${userCode}`);
      if (!idx) return null;
      const dc = await this.getDeviceCode(idx.deviceCode);
      if (!dc || isExpired(dc.expiresAt)) return null;
      return dc;
    },
    async approveDeviceCode(deviceCode, userId): Promise<boolean> {
      try {
        await db
          .update({
            TableName: tableName,
            Key: { pk: `DEV#${deviceCode}`, sk: SK },
            UpdateExpression: 'SET #s = :approved, approvedBy = :u',
            ConditionExpression: '#s = :pending',
            ExpressionAttributeNames: { '#s': 'status' },
            ExpressionAttributeValues: { ':approved': 'approved', ':pending': 'pending', ':u': userId },
          })
          .promise();
        return true;
      } catch {
        return false;
      }
    },
    async consumeDeviceCode(deviceCode): Promise<{ scope: string; approvedBy: string } | null> {
      const dc = await this.getDeviceCode(deviceCode);
      if (!dc || dc.status !== 'approved' || !dc.approvedBy || isExpired(dc.expiresAt)) return null;
      await db
        .update({
          TableName: tableName,
          Key: { pk: `DEV#${deviceCode}`, sk: SK },
          UpdateExpression: 'SET #s = :consumed',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':consumed': 'consumed' },
        })
        .promise();
      return { scope: dc.scope, approvedBy: dc.approvedBy };
    },
  };
}

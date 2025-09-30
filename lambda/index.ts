import { DynamoDB } from 'aws-sdk';
import { tools, Tool } from './tools';
import { Fido2Lib } from 'fido2-lib';
import crypto from 'crypto';

const db = new DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME ?? ''; // Auth table for WebAuthn and tokens
const KV_TABLE_NAME = process.env.KV_TABLE_NAME ?? ''; // User KV store table

// KV Store Tool - exposed via MCP with per-user namespacing
// This tool ONLY accesses the KV table, NOT the auth table
const KV_STORE_TOOL: Tool = {
  name: 'kvstore',
  description: 'Get or put an item in your personal key-value store. Keys are automatically namespaced per user.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['get', 'put'] },
      key: { type: 'string', description: 'Key for the item (will be automatically namespaced per user)' },
      value: { type: 'object', description: 'Value to store (for put action)' },
    },
    required: ['action', 'key'],
  },
  outputSchema: { type: 'object' },
  async call(args: { action: string; key?: string; value?: unknown }, username?: string) {
    if (!username) {
      return { content: [{ type: 'text', text: 'Unauthorized: No username provided' }], isError: true };
    }

    if (!args.key) {
      return { content: [{ type: 'text', text: 'Missing key' }], isError: true };
    }

    // Enforce per-user namespacing: prefix all keys with username
    const namespacedKey = `user:${username}:${args.key}`;

    switch (args.action) {
      case 'get': {
        const data = await db.get({
          TableName: KV_TABLE_NAME,
          Key: { id: namespacedKey }
        }).promise();
        return {
          content: [{ type: 'text', text: JSON.stringify(data.Item?.value ?? null, null, 2) }],
          structuredContent: data.Item?.value ?? null,
        };
      }
      case 'put': {
        if (args.value === undefined) {
          return { content: [{ type: 'text', text: 'Missing value' }], isError: true };
        }
        await db.put({
          TableName: KV_TABLE_NAME,
          Item: {
            id: namespacedKey,
            username,
            key: args.key,
            value: args.value,
            updatedAt: Date.now()
          }
        }).promise();
        return { content: [{ type: 'text', text: 'OK' }], structuredContent: { ok: true } };
      }
      default:
        return { content: [{ type: 'text', text: 'Unknown action' }], isError: true };
    }
  },
};

tools.set(KV_STORE_TOOL.name, KV_STORE_TOOL);

interface LambdaEvent {
  headers?: Record<string, string>;
  rawPath?: string;
  path?: string;
  requestContext?: {
    http?: {
      method?: string;
    };
  };
  httpMethod?: string;
  body?: string;
  queryStringParameters?: Record<string, string>;
}

// Helper function to extract origin and rpId from request headers
function getOriginFromEvent(event: LambdaEvent): { origin: string; rpId: string } {
  const origin = event.headers?.origin || event.headers?.Origin || 'http://localhost:3000';
  const url = new URL(origin);
  const rpId = url.hostname;
  return { origin, rpId };
}

// Create fido instance with default values (will be overridden per request)
const fido = new Fido2Lib({ rpId: 'localhost', rpName: 'Workspace', challengeSize: 64 });

interface StoredCredential {
  credId: string;
  publicKey: string;
  counter: number;
}

interface UserRecord {
  id: string;
  username: string;
  userId: string;
  credentials: StoredCredential[];
  challenge?: string;
}

function toBase64Url(buf: Buffer) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(str: string): ArrayBuffer {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);
  const buffer = Buffer.from(str, 'base64');
  // CRITICAL FIX: buffer.buffer returns the ENTIRE pooled ArrayBuffer (8192 bytes),
  // but we only want the slice that contains our data. Without this, fido2-lib
  // receives incorrect data and fails with "id and credId were not the same".
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function getUser(username: string): Promise<UserRecord> {
  const id = `user#${username}`;
  const { Item } = await db.get({ TableName: TABLE_NAME, Key: { id } }).promise();
  if (Item) return Item as UserRecord;
  const user: UserRecord = {
    id,
    username,
    userId: toBase64Url(crypto.randomBytes(32)),
    credentials: [],
  };
  await db.put({ TableName: TABLE_NAME, Item: user }).promise();
  return user;
}

async function saveUser(user: UserRecord) {
  await db.put({ TableName: TABLE_NAME, Item: user }).promise();
}

// Token validation for protected endpoints
async function validateBearerToken(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.substring(7);

  try {
    const { Item } = await db.get({
      TableName: TABLE_NAME,
      Key: { id: `token#${token}` }
    }).promise();

    if (!Item || Item.expiresAt < Date.now()) {
      return null;
    }

    return Item.username;
  } catch (error) {
    console.error('Token validation error:', error);
    return null;
  }
}


interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function validateRequest(value: unknown): value is JsonRpcRequest {
  return (
    isObject(value) &&
    value.jsonrpc === '2.0' &&
    typeof value.method === 'string'
  );
}

async function handleMcpRequest(req: unknown, username?: string): Promise<JsonRpcResponse> {
  if (!validateRequest(req)) {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    };
  }
  const validReq = req as JsonRpcRequest;

  switch (validReq.method) {
    case 'capabilities':
      return {
        jsonrpc: '2.0',
        id: validReq.id ?? null,
        result: { resources: true, prompts: true, tools: true },
      };
    case 'echo':
      return {
        jsonrpc: '2.0',
        id: validReq.id ?? null,
        result: validReq.params ?? null,
      };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id: validReq.id ?? null,
        result: {
          tools: Array.from(tools.values()).map(({ name, description, inputSchema, outputSchema }) => ({
            name,
            description,
            inputSchema,
            outputSchema,
          })),
        },
      };
    case 'tools/call':
      if (!isObject(validReq.params) || typeof validReq.params.name !== 'string') {
        return {
          jsonrpc: '2.0',
          id: validReq.id ?? null,
          error: { code: -32602, message: 'Invalid params' },
        };
      }
      const tool = tools.get(validReq.params.name);
      if (!tool) {
        return {
          jsonrpc: '2.0',
          id: validReq.id ?? null,
          error: { code: -32601, message: 'Tool not found' },
        };
      }
      const callArgs = isObject(validReq.params.arguments) ? validReq.params.arguments : {};
      // Pass username to tool for user namespacing
      const callResult = await tool.call(callArgs, username);
      return {
        jsonrpc: '2.0',
        id: validReq.id ?? null,
        result: callResult,
      };
    default:
      return {
        jsonrpc: '2.0',
        id: validReq.id ?? null,
        error: { code: -32601, message: 'Method not found' },
      };
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://www.christopherdebeer.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function generateAuthorizationCode(): string {
  return crypto.randomBytes(32).toString('hex');
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  console.log('Request:', event);
  const path = event.rawPath || event.path || '/';
  const method = event.requestContext?.http?.method || event.httpMethod;

  // Handle OPTIONS preflight requests
  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  if (path === '/mcp' && method === 'POST') {
    // Validate bearer token for MCP endpoint
    const username = await validateBearerToken(event.headers?.authorization || event.headers?.Authorization);
    if (!username) {
      return {
        statusCode: 401,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32000, message: 'Unauthorized: Valid bearer token required' },
        }),
      };
    }

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(event.body ?? '{}');
    } catch {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        }),
      };
    }

    const response = await handleMcpRequest(request, username);
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify(response),
    };
  }

  if (path === '/webauthn/register/options' && method === 'POST') {
    try {
      const { username } = JSON.parse(event.body ?? '{}');
      if (!username) {
        return {
          statusCode: 400,
          headers: { 'content-type': 'application/json', ...CORS_HEADERS },
          body: JSON.stringify({ error: 'Missing username' }),
        };
      }
      const user = await getUser(username);
      const { origin, rpId } = getOriginFromEvent(event);
      const dynamicFido = new Fido2Lib({ rpId, rpName: 'Workspace', challengeSize: 64 });
      const opts = await dynamicFido.attestationOptions();
      opts.user = {
        id: fromBase64Url(user.userId),
        name: username,
        displayName: username,
      };
      const challenge = toBase64Url(Buffer.from(opts.challenge as ArrayBuffer));
      user.challenge = challenge;
      await saveUser(user);
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ ...opts, challenge, user: { ...opts.user, id: user.userId } }),
      };
    } catch (error) {
      console.error('WebAuthn register options error:', error);
      return {
        statusCode: 500,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Failed to generate registration options', details: (error as Error).message }),
      };
    }
  }

  if (path === '/webauthn/register/verify' && method === 'POST') {
    try {
      const { username, attestation } = JSON.parse(event.body ?? '{}');
      if (!username || !attestation) {
        return {
          statusCode: 400,
          headers: { 'content-type': 'application/json', ...CORS_HEADERS },
          body: JSON.stringify({ error: 'Missing parameters' }),
        };
      }
      const user = await getUser(username);
      const { origin, rpId } = getOriginFromEvent(event);
      const dynamicFido = new Fido2Lib({ rpId, rpName: 'Workspace', challengeSize: 64 });
      const expect = {
        challenge: user.challenge ?? '',
        origin,
        factor: 'either' as const,
        rpId,
      };
      
      // DEFINITIVE FIX: Convert data types according to fido2-lib TypeScript definitions
      // AttestationResult interface requires:
      // - id: ArrayBuffer (not string)
      // - rawId: ArrayBuffer (not string) 
      // - clientDataJSON: string (not ArrayBuffer)
      // - attestationObject: string (not ArrayBuffer)
      const convertedAttestation = {
        ...attestation,
        id: fromBase64Url(attestation.id),     // Convert to ArrayBuffer - required by AttestationResult interface
        rawId: fromBase64Url(attestation.rawId), // Convert to ArrayBuffer - required by AttestationResult interface
        response: {
          ...attestation.response,
          clientDataJSON: attestation.response.clientDataJSON,     // Keep as string - required by AttestationResult interface
          attestationObject: attestation.response.attestationObject, // Keep as string - required by AttestationResult interface
        },
      };
      
      const result = await dynamicFido.attestationResult(convertedAttestation, expect);
      const credId = toBase64Url(Buffer.from(result.authnrData.get('credId')));
      const publicKey = result.authnrData.get('credentialPublicKeyPem');
      const counter = result.authnrData.get('counter');
      user.credentials.push({ credId, publicKey, counter });
      delete user.challenge;
      await saveUser(user);
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ ok: true }),
      };
    } catch (error) {
      console.error('WebAuthn register verify error:', error);
      return {
        statusCode: 500,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Registration verification failed', details: (error as Error).message }),
      };
    }
  }

  if (path === '/webauthn/login/options' && method === 'POST') {
    try {
      const { username } = JSON.parse(event.body ?? '{}');
      if (!username) {
        return {
          statusCode: 400,
          headers: { 'content-type': 'application/json', ...CORS_HEADERS },
          body: JSON.stringify({ error: 'Missing username' }),
        };
      }
      const user = await getUser(username);
      const { origin, rpId } = getOriginFromEvent(event);
      const dynamicFido = new Fido2Lib({ rpId, rpName: 'Workspace', challengeSize: 64 });
      const opts = await dynamicFido.assertionOptions();
      opts.allowCredentials = user.credentials.map((c) => ({ type: 'public-key' as const, id: fromBase64Url(c.credId) }));
      const challenge = toBase64Url(Buffer.from(opts.challenge as ArrayBuffer));
      user.challenge = challenge;
      await saveUser(user);
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ ...opts, challenge }),
      };
    } catch (error) {
      console.error('WebAuthn login options error:', error);
      return {
        statusCode: 500,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Failed to generate login options', details: (error as Error).message }),
      };
    }
  }

  if (path === '/oauth/authorize' && method === 'GET') {
    const queryParams = event.queryStringParameters || {};
    const clientId = queryParams.client_id;
    const redirectUri = queryParams.redirect_uri;
    const state = queryParams.state;
    const username = queryParams.username;
    const token = queryParams.token;

    if (!clientId || !redirectUri) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'text/html', ...CORS_HEADERS },
        body: '<html><body><h1>Error</h1><p>Missing client_id or redirect_uri</p></body></html>',
      };
    }

    if (username && token) {
      const validUsername = await validateBearerToken(`Bearer ${token}`);
      if (validUsername === username) {
        const authCode = generateAuthorizationCode();
        const expiresAt = Date.now() + (10 * 60 * 1000);

        await db.put({
          TableName: TABLE_NAME,
          Item: {
            id: `authcode#${authCode}`,
            username,
            clientId,
            redirectUri,
            expiresAt,
            createdAt: Date.now()
          }
        }).promise();

        const redirectUrl = new URL(redirectUri);
        redirectUrl.searchParams.set('code', authCode);
        if (state) redirectUrl.searchParams.set('state', state);

        return {
          statusCode: 302,
          headers: {
            'Location': redirectUrl.toString(),
            ...CORS_HEADERS
          },
          body: '',
        };
      }
    }

    const authPageUrl = `https://www.christopherdebeer.com/oauth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}${state ? `&state=${encodeURIComponent(state)}` : ''}`;
    return {
      statusCode: 302,
      headers: {
        'Location': authPageUrl,
        ...CORS_HEADERS
      },
      body: '',
    };
  }

  if (path === '/oauth/token' && method === 'POST') {
    try {
      const body = JSON.parse(event.body ?? '{}');
      const { code, client_id, redirect_uri, grant_type } = body;

      if (grant_type !== 'authorization_code') {
        return {
          statusCode: 400,
          headers: { 'content-type': 'application/json', ...CORS_HEADERS },
          body: JSON.stringify({ error: 'unsupported_grant_type' }),
        };
      }

      if (!code || !client_id || !redirect_uri) {
        return {
          statusCode: 400,
          headers: { 'content-type': 'application/json', ...CORS_HEADERS },
          body: JSON.stringify({ error: 'invalid_request' }),
        };
      }

      const { Item } = await db.get({
        TableName: TABLE_NAME,
        Key: { id: `authcode#${code}` }
      }).promise();

      if (!Item || Item.expiresAt < Date.now() || Item.clientId !== client_id || Item.redirectUri !== redirect_uri) {
        return {
          statusCode: 400,
          headers: { 'content-type': 'application/json', ...CORS_HEADERS },
          body: JSON.stringify({ error: 'invalid_grant' }),
        };
      }

      await db.delete({
        TableName: TABLE_NAME,
        Key: { id: `authcode#${code}` }
      }).promise();

      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + (24 * 60 * 60 * 1000);

      await db.put({
        TableName: TABLE_NAME,
        Item: {
          id: `token#${token}`,
          username: Item.username,
          expiresAt,
          createdAt: Date.now()
        }
      }).promise();

      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({
          access_token: token,
          token_type: 'Bearer',
          expires_in: 86400
        }),
      };
    } catch (error) {
      console.error('OAuth token error:', error);
      return {
        statusCode: 500,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'server_error' }),
      };
    }
  }

  if (path === '/webauthn/login/verify' && method === 'POST') {
    try {
      const { username, assertion } = JSON.parse(event.body ?? '{}');
      if (!username || !assertion) {
        return {
          statusCode: 400,
          headers: { 'content-type': 'application/json', ...CORS_HEADERS },
          body: JSON.stringify({ error: 'Missing parameters' }),
        };
      }
      const user = await getUser(username);
      const credId = assertion.id; // Use the id field directly as it's already a base64url string
      const cred = user.credentials.find((c) => c.credId === credId);
      if (!cred) {
        return {
          statusCode: 400,
          headers: { 'content-type': 'application/json', ...CORS_HEADERS },
          body: JSON.stringify({ error: 'Unknown credential' }),
        };
      }
      const { origin, rpId } = getOriginFromEvent(event);
      const dynamicFido = new Fido2Lib({ rpId, rpName: 'Workspace', challengeSize: 64 });
      const expect = {
        challenge: user.challenge ?? '',
        origin,
        factor: 'either' as const,
        rpId,
        publicKey: cred.publicKey,
        prevCounter: cred.counter,
        userHandle: null,
      };
      
      // DEFINITIVE FIX: Convert data types according to fido2-lib TypeScript definitions
      // AssertionResult interface requires:
      // - id: ArrayBuffer (not string)
      // - rawId: ArrayBuffer (not string)
      // - clientDataJSON: string (not ArrayBuffer)
      // - authenticatorData: ArrayBuffer (not string)
      // - signature: string (not ArrayBuffer)
      const convertedAssertion = {
        ...assertion,
        id: fromBase64Url(assertion.id),     // Convert to ArrayBuffer - required by AssertionResult interface
        rawId: fromBase64Url(assertion.rawId), // Convert to ArrayBuffer - required by AssertionResult interface
        response: {
          ...assertion.response,
          clientDataJSON: assertion.response.clientDataJSON,                      // Keep as string - required by AssertionResult interface
          authenticatorData: fromBase64Url(assertion.response.authenticatorData), // Convert to ArrayBuffer - required by AssertionResult interface
          signature: assertion.response.signature,                                // Keep as string - required by AssertionResult interface
          userHandle: assertion.response.userHandle ? fromBase64Url(assertion.response.userHandle) : null,
        },
      };
      
      const result = await dynamicFido.assertionResult(convertedAssertion, expect);
      cred.counter = result.authnrData.get('counter');
      delete user.challenge;
      await saveUser(user);

      // Generate bearer token
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

      // Store token in auth table
      await db.put({
        TableName: TABLE_NAME,
        Item: {
          id: `token#${token}`,
          username: user.username,
          expiresAt,
          createdAt: Date.now()
        }
      }).promise();

      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ ok: true, token, expiresAt }),
      };
    } catch (error) {
      console.error('WebAuthn login verify error:', error);
      return {
        statusCode: 500,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Login verification failed', details: (error as Error).message }),
      };
    }
  }

  await db
    .put({
      TableName: TABLE_NAME,
      Item: {
        id: new Date().toISOString(),
        message: 'Hello from Lambda',
      },
    })
    .promise();
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
    body: JSON.stringify({ success: true, event }),
  };
}

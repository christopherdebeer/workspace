import { DynamoDB } from 'aws-sdk';
import { tools, Tool } from './tools';
import { Fido2Lib } from 'fido2-lib';
import crypto from 'crypto';

const db = new DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME ?? '';

const DYNAMO_TOOL: Tool = {
  name: 'dynamodb',
  description: 'Get or put an item in the DynamoDB table',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['get', 'put'] },
      key: { type: 'object' },
      item: { type: 'object' },
    },
    required: ['action'],
  },
  outputSchema: { type: 'object' },
  async call(args: { action: string; key?: any; item?: any }) {
    switch (args.action) {
      case 'get': {
        if (!args.key) {
          return { content: [{ type: 'text', text: 'Missing key' }], isError: true };
        }
        const data = await db.get({ TableName: TABLE_NAME, Key: args.key }).promise();
        return {
          content: [{ type: 'text', text: JSON.stringify(data.Item, null, 2) }],
          structuredContent: data.Item ?? null,
        };
      }
      case 'put': {
        if (!args.item) {
          return { content: [{ type: 'text', text: 'Missing item' }], isError: true };
        }
        await db.put({ TableName: TABLE_NAME, Item: args.item }).promise();
        return { content: [{ type: 'text', text: 'OK' }], structuredContent: { ok: true } };
      }
      default:
        return { content: [{ type: 'text', text: 'Unknown action' }], isError: true };
    }
  },
};

tools.set(DYNAMO_TOOL.name, DYNAMO_TOOL);

// Helper function to extract origin and rpId from request headers
function getOriginFromEvent(event: any): { origin: string; rpId: string } {
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
  return Buffer.from(str, 'base64').buffer;
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


interface JsonRpcRequest {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: string | number | null;
  result?: any;
  error?: { code: number; message: string };
}

function isObject(value: any): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

function validateRequest(value: any): value is JsonRpcRequest {
  return (
    isObject(value) &&
    value.jsonrpc === '2.0' &&
    typeof value.method === 'string'
  );
}

async function handleMcpRequest(req: unknown): Promise<JsonRpcResponse> {
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
      const callResult = await tool.call(callArgs);
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
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function handler(event: any): Promise<any> {
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

    const response = await handleMcpRequest(request);
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
      const expect = {
        challenge: user.challenge ?? '',
        origin,
        factor: 'either' as const,
        rpId,
      };
      
      // Convert string fields back to ArrayBuffer for fido2-lib
      // Note: clientDataJSON should remain as base64url string for fido2-lib to parse internally
      const convertedAttestation = {
        ...attestation,
        id: fromBase64Url(attestation.id),
        rawId: fromBase64Url(attestation.rawId),
        response: {
          ...attestation.response,
          clientDataJSON: attestation.response.clientDataJSON, // Keep as base64url string
          attestationObject: fromBase64Url(attestation.response.attestationObject),
        },
      };
      
      const result = await fido.attestationResult(convertedAttestation, expect);
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
      opts.allowCredentials = user.credentials.map((c) => ({ type: 'public-key', id: fromBase64Url(c.credId) }));
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
      const expect = {
        challenge: user.challenge ?? '',
        origin,
        factor: 'either' as const,
        rpId,
        publicKey: cred.publicKey,
        prevCounter: cred.counter,
        userHandle: null,
      };
      
      // Convert string fields back to ArrayBuffer for fido2-lib
      // Note: clientDataJSON should remain as base64url string for fido2-lib to parse internally
      const convertedAssertion = {
        ...assertion,
        id: fromBase64Url(assertion.id),
        rawId: fromBase64Url(assertion.rawId),
        response: {
          ...assertion.response,
          clientDataJSON: assertion.response.clientDataJSON, // Keep as base64url string
          authenticatorData: fromBase64Url(assertion.response.authenticatorData),
          signature: fromBase64Url(assertion.response.signature),
          userHandle: assertion.response.userHandle ? fromBase64Url(assertion.response.userHandle) : null,
        },
      };
      
      const result = await fido.assertionResult(convertedAssertion, expect);
      cred.counter = result.authnrData.get('counter');
      delete user.challenge;
      await saveUser(user);
      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ ok: true }),
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

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

const rpId = process.env.RP_ID ?? 'localhost';
const origin = process.env.ORIGIN ?? (rpId === 'localhost' ? `http://${rpId}` : `https://${rpId}`);
const fido = new Fido2Lib({ rpId, rpName: 'Workspace', challengeSize: 64 });

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
    const { username } = JSON.parse(event.body ?? '{}');
    if (!username) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Missing username' }),
      };
    }
    const user = await getUser(username);
    const opts = await fido.attestationOptions();
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
  }

  if (path === '/webauthn/register/verify' && method === 'POST') {
    const { username, attestation } = JSON.parse(event.body ?? '{}');
    if (!username || !attestation) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Missing parameters' }),
      };
    }
    const user = await getUser(username);
    const expect = {
      challenge: user.challenge ?? '',
      origin,
      factor: 'either' as const,
      rpId,
    };
    const result = await fido.attestationResult(attestation, expect);
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
  }

  if (path === '/webauthn/login/options' && method === 'POST') {
    const { username } = JSON.parse(event.body ?? '{}');
    if (!username) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Missing username' }),
      };
    }
    const user = await getUser(username);
    const opts = await fido.assertionOptions();
    opts.allowCredentials = user.credentials.map((c) => ({ type: 'public-key', id: fromBase64Url(c.credId) }));
    const challenge = toBase64Url(Buffer.from(opts.challenge as ArrayBuffer));
    user.challenge = challenge;
    await saveUser(user);
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ ...opts, challenge }),
    };
  }

  if (path === '/webauthn/login/verify' && method === 'POST') {
    const { username, assertion } = JSON.parse(event.body ?? '{}');
    if (!username || !assertion) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Missing parameters' }),
      };
    }
    const user = await getUser(username);
    const credId = toBase64Url(Buffer.from(assertion.rawId || assertion.id, 'base64')); // maybe base64
    const cred = user.credentials.find((c) => c.credId === credId);
    if (!cred) {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ error: 'Unknown credential' }),
      };
    }
    const expect = {
      challenge: user.challenge ?? '',
      origin,
      factor: 'either' as const,
      rpId,
      publicKey: cred.publicKey,
      prevCounter: cred.counter,
      userHandle: null,
    };
    const result = await fido.assertionResult(assertion, expect);
    cred.counter = result.authnrData.get('counter');
    delete user.challenge;
    await saveUser(user);
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ ok: true }),
    };
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

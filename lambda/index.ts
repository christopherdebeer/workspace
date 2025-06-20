import { DynamoDB } from 'aws-sdk';

const db = new DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME ?? '';

const DYNAMO_TOOL = {
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
};

async function callDynamoTool(args: { action: string; key?: any; item?: any }) {
  switch (args.action) {
    case 'get': {
      if (!args.key) return { content: [{ type: 'text', text: 'Missing key' }], isError: true };
      const data = await db.get({ TableName: TABLE_NAME, Key: args.key }).promise();
      return {
        content: [{ type: 'text', text: JSON.stringify(data.Item, null, 2) }],
        structuredContent: data.Item ?? null,
      };
    }
    case 'put': {
      if (!args.item) return { content: [{ type: 'text', text: 'Missing item' }], isError: true };
      await db.put({ TableName: TABLE_NAME, Item: args.item }).promise();
      return { content: [{ type: 'text', text: 'OK' }], structuredContent: { ok: true } };
    }
    default:
      return { content: [{ type: 'text', text: 'Unknown action' }], isError: true };
  }
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

async function handleMcpRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return {
      jsonrpc: '2.0',
      id: req.id ?? null,
      error: { code: -32600, message: 'Invalid Request' },
    };
  }

  switch (req.method) {
    case 'capabilities':
      return {
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: { resources: true, prompts: true, tools: true },
      };
    case 'echo':
      return {
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: req.params ?? null,
      };
    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: { tools: [DYNAMO_TOOL] },
      };
    case 'tools/call':
      if (!req.params || req.params.name !== DYNAMO_TOOL.name) {
        return {
          jsonrpc: '2.0',
          id: req.id ?? null,
          error: { code: -32601, message: 'Tool not found' },
        };
      }
      const callResult = await callDynamoTool(req.params.arguments ?? {});
      return {
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: callResult,
      };
    default:
      return {
        jsonrpc: '2.0',
        id: req.id ?? null,
        error: { code: -32601, message: 'Method not found' },
      };
  }
}

export async function handler(event: any): Promise<any> {
  console.log('Request:', event);
  const path = event.rawPath || event.path || '/';
  const method = event.requestContext?.http?.method || event.httpMethod;

  if (path === '/mcp' && method === 'POST') {
    let request: JsonRpcRequest;
    try {
      request = JSON.parse(event.body ?? '{}');
    } catch {
      return {
        statusCode: 400,
        headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(response),
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
    body: JSON.stringify({ success: true, event }),
  };
}

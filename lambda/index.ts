import { DynamoDB } from 'aws-sdk';
import { tools, Tool } from './tools';

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

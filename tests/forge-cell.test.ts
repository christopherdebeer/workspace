/**
 * forge cell — the dynamic-cell control plane.
 *
 * Exercises the pure building blocks (zip framing, the CloudFormation cell
 * template, the registry) and the real `forge` MCP handler end-to-end with AWS
 * (CloudFormation/S3/DynamoDB/Lambda) and the esbuild transpiler stubbed —
 * asserting create requires the `platform:cells:create` scope, provisions a
 * `cell-*` stack, records the cell, and that `callCell` invokes only for
 * authorised principals.
 */
import { handler as forge } from '../services/forge/service';
import { crc32, zipStore } from '../services/forge/zip';
import { buildCellTemplate, cellResourceName } from '../services/forge/cell-template';
import { createRegistry, __setDocumentClient, CellRecord } from '../services/forge/registry';
import { __setEsbuild } from '../services/forge/transpile';
import {
  __setCloudFormation,
  __setS3,
  __setLambda as __setProvisionerLambda,
} from '../services/forge/provisioner';
import { __setLambda as __setPeerLambda } from '../platform/runtime/service-client';
import type { FunctionUrlEvent, FunctionUrlResponse } from '../platform/runtime';

// ── in-memory AWS stubs ────────────────────────────────────────────

interface Item {
  pk: string;
  sk: string;
  [k: string]: unknown;
}

function memoryDocClient(): { store: Map<string, Item> } & Record<string, unknown> {
  const store = new Map<string, Item>();
  const key = (k: { pk: string; sk: string }) => `${k.pk}|${k.sk}`;
  return {
    store,
    get: ({ Key }: { Key: { pk: string; sk: string } }) => ({
      promise: async () => ({ Item: store.get(key(Key)) }),
    }),
    put: ({ Item }: { Item: Item }) => ({
      promise: async () => {
        store.set(key(Item), Item);
        return {};
      },
    }),
    update: ({
      Key,
      ExpressionAttributeValues,
    }: {
      Key: { pk: string; sk: string };
      ExpressionAttributeValues: Record<string, unknown>;
    }) => ({
      promise: async () => {
        const item = store.get(key(Key));
        if (item) {
          item.status = ExpressionAttributeValues[':s'];
          item.updatedAt = ExpressionAttributeValues[':u'];
        }
        return {};
      },
    }),
    query: ({ ExpressionAttributeValues }: { ExpressionAttributeValues: Record<string, unknown> }) => ({
      promise: async () => ({
        Items: [...store.values()].filter((i) => i.pk === ExpressionAttributeValues[':pk']),
      }),
    }),
  };
}

const cfnCalls: Array<{ StackName: string; TemplateBody: string }> = [];
const s3Calls: Array<{ Bucket: string; Key: string }> = [];
let lambdaResponse: unknown = { statusCode: 200, body: JSON.stringify({ ok: true }) };

function installAwsStubs(): Map<string, Item> {
  const doc = memoryDocClient();
  __setDocumentClient(doc as unknown as Parameters<typeof __setDocumentClient>[0]);
  __setS3({
    putObject: (p: { Bucket: string; Key: string }) => {
      s3Calls.push({ Bucket: p.Bucket, Key: p.Key });
      return { promise: async () => ({}) };
    },
  } as unknown as Parameters<typeof __setS3>[0]);
  __setCloudFormation({
    createStack: (p: { StackName: string; TemplateBody: string }) => {
      cfnCalls.push(p);
      return { promise: async () => ({ StackId: 'id' }) };
    },
    describeStacks: () => ({
      promise: async () => ({ Stacks: [{ StackStatus: 'CREATE_COMPLETE', Outputs: [] }] }),
    }),
    deleteStack: () => ({ promise: async () => ({}) }),
  } as unknown as Parameters<typeof __setCloudFormation>[0]);
  __setProvisionerLambda({
    invoke: () => ({ promise: async () => ({ Payload: JSON.stringify(lambdaResponse) }) }),
  } as unknown as Parameters<typeof __setProvisionerLambda>[0]);
  __setEsbuild({
    initialize: async () => undefined,
    transform: async (code: string) => ({ code: `/*compiled*/ ${code}`, warnings: [], map: '' }),
  } as unknown as Parameters<typeof __setEsbuild>[0]);
  return doc.store;
}

// auth.validateToken stub (supplies identity + scopes over the MCP HTTP path)
interface ValidatedToken {
  userId: string;
  scope: string;
  clientId: string | null;
}
function stubAuth(tokens: Record<string, ValidatedToken>): void {
  __setPeerLambda({
    invoke: (params: Record<string, unknown>) => {
      const env = JSON.parse(params.Payload as string) as { __command: string; payload: { token: string } };
      const result = env.__command === 'validateToken' ? (tokens[env.payload.token] ?? null) : null;
      return { promise: async () => ({ Payload: JSON.stringify({ ok: true, result }) }) };
    },
  } as unknown as Parameters<typeof __setPeerLambda>[0]);
}

function httpEvent(method: string, path: string, headers: Record<string, string>, body: unknown): FunctionUrlEvent {
  return {
    rawPath: path,
    requestContext: { http: { method, path } },
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  };
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const toolCall = (name: string, args: unknown) => ({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name, arguments: args },
});

async function callForge(token: string | null, name: string, args: unknown): Promise<unknown> {
  const headers = token ? bearer(token) : {};
  const res = (await forge(httpEvent('POST', '/forge/mcp', headers, toolCall(name, args)))) as FunctionUrlResponse;
  const body = JSON.parse(res.body) as { result?: { content: Array<{ text: string }>; isError?: boolean }; error?: unknown };
  return body;
}

describe('forge: zip framing', () => {
  it('crc32 matches the known IEEE vector for "123456789"', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
  it('zipStore frames a local header + EOCD signature', () => {
    const zip = zipStore([{ name: 'index.js', content: 'exports.x=1' }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50); // local file header
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50); // end of central directory
  });
});

describe('forge: cell template', () => {
  const tpl = buildCellTemplate({
    cellId: 'notes-abc12345',
    owner: 'alice',
    codeBucket: 'bucket',
    codeKey: 'cells/notes/x.zip',
    boundaryArn: 'arn:aws:iam::111:policy/boundary',
    eventBusName: 'platform-bus',
    eventBusArn: 'arn:aws:events:us-east-1:111:event-bus/platform-bus',
    region: 'us-east-1',
    accountId: '111',
  }) as { Resources: Record<string, { Type: string; Properties: Record<string, unknown> }> };

  it('names the function/role/table cell-<id> for ARN-scopable boundaries', () => {
    expect(cellResourceName('notes-abc12345')).toBe('cell-notes-abc12345');
    expect(tpl.Resources.CellFunction.Properties.FunctionName).toBe('cell-notes-abc12345');
    expect(tpl.Resources.CellTable.Properties.TableName).toBe('cell-notes-abc12345');
  });
  it('attaches the permission boundary to the cell role', () => {
    expect(tpl.Resources.CellRole.Properties.PermissionsBoundary).toBe('arn:aws:iam::111:policy/boundary');
  });
});

describe('forge: registry', () => {
  it('puts, gets, lists by owner, and grants', async () => {
    __setDocumentClient(memoryDocClient() as unknown as Parameters<typeof __setDocumentClient>[0]);
    const reg = createRegistry('forge-table');
    const rec: CellRecord = {
      cellId: 'notes-abc', name: 'notes', owner: 'alice', description: null,
      functionName: 'cell-notes-abc', stackName: 'cell-notes-abc', grants: ['alice'],
      status: 'CREATING', createdAt: 't', updatedAt: 't',
    };
    await reg.put(rec);
    expect((await reg.get('notes-abc'))?.owner).toBe('alice');
    expect((await reg.listByOwner('alice')).map((c) => c.cellId)).toEqual(['notes-abc']);
    await reg.setStatus('notes-abc', 'ACTIVE');
    expect((await reg.get('notes-abc'))?.status).toBe('ACTIVE');
    const granted = await reg.addGrant('notes-abc', 'bob');
    expect(granted?.grants).toContain('bob');
  });
});

describe('forge: MCP control plane', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'forge';
    process.env.SERVICE_REGISTRY = JSON.stringify({ auth: 'auth-fn' });
    process.env.TABLE_NAME = 'forge-table';
    process.env.CELL_CODE_BUCKET = 'code-bucket';
    process.env.CELL_PERMISSION_BOUNDARY_ARN = 'arn:aws:iam::111:policy/boundary';
    process.env.CELL_EVENT_BUS_NAME = 'platform-bus';
    process.env.CELL_EVENT_BUS_ARN = 'arn:aws:events:us-east-1:111:event-bus/platform-bus';
    process.env.CELL_ACCOUNT_ID = '111';
    process.env.CELL_REGION = 'us-east-1';
    cfnCalls.length = 0;
    s3Calls.length = 0;
    lambdaResponse = { statusCode: 200, body: JSON.stringify({ ok: true }) };
    installAwsStubs();
    stubAuth({
      creator: { userId: 'alice', scope: 'platform:cells:create', clientId: null },
      plain: { userId: 'bob', scope: 'workspace:read', clientId: null },
    });
  });
  afterEach(() => {
    __setDocumentClient(undefined);
    __setS3(undefined);
    __setCloudFormation(undefined);
    __setProvisionerLambda(undefined);
    __setEsbuild(undefined);
    __setPeerLambda(undefined);
    for (const k of [
      'SERVICE_REGISTRY', 'TABLE_NAME', 'CELL_CODE_BUCKET', 'CELL_PERMISSION_BOUNDARY_ARN',
      'CELL_EVENT_BUS_NAME', 'CELL_EVENT_BUS_ARN', 'CELL_ACCOUNT_ID', 'CELL_REGION',
    ]) delete process.env[k];
  });

  const cellCode = 'export const handler = async () => ({ statusCode: 200, body: "{}" });';

  it('createCell requires the platform:cells:create scope', async () => {
    const denied = (await callForge('plain', 'createCell', { name: 'notes', code: cellCode })) as {
      result: { isError?: boolean; content: Array<{ text: string }> };
    };
    expect(denied.result.isError).toBe(true);
    expect(denied.result.content[0].text).toMatch(/scope/i);
    expect(cfnCalls).toHaveLength(0);
  });

  it('createCell transpiles, uploads, deploys a cell-* stack, and records it', async () => {
    const ok = (await callForge('creator', 'createCell', { name: 'My Notes', code: cellCode })) as {
      result: { content: Array<{ text: string }> };
    };
    const out = JSON.parse(ok.result.content[0].text) as { cellId: string; address: string; status: string };
    expect(out.status).toBe('CREATING');
    expect(out.address).toBe('/@alice/my-notes');
    expect(out.cellId).toMatch(/^my-notes-[0-9a-f]{8}$/);
    expect(s3Calls).toHaveLength(1);
    expect(cfnCalls).toHaveLength(1);
    expect(cfnCalls[0].StackName).toBe(`cell-${out.cellId}`);
    // the deployed template carries the boundary
    expect(cfnCalls[0].TemplateBody).toContain('arn:aws:iam::111:policy/boundary');
  });

  it('callCell invokes the cell for the owner and returns its parsed body', async () => {
    lambdaResponse = { statusCode: 200, body: JSON.stringify({ greeting: 'hi' }) };
    await callForge('creator', 'createCell', { name: 'notes', code: cellCode });
    // mark ACTIVE (provisioning would do this; getCell refresh also would)
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    await reg.setStatus(cell.cellId, 'ACTIVE');

    const res = (await callForge('creator', 'callCell', { cellId: cell.cellId, body: { name: 'x' } })) as {
      result: { content: Array<{ text: string }> };
    };
    const out = JSON.parse(res.result.content[0].text) as { statusCode: number; body: { greeting: string } };
    expect(out.statusCode).toBe(200);
    expect(out.body).toEqual({ greeting: 'hi' });
  });

  it('callCell denies a principal who is neither owner nor grantee', async () => {
    await callForge('creator', 'createCell', { name: 'notes', code: cellCode });
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    await reg.setStatus(cell.cellId, 'ACTIVE');

    // bob ('plain') is authenticated but not owner/grantee
    const res = (await callForge('plain', 'callCell', { cellId: cell.cellId })) as {
      result: { isError?: boolean; content: Array<{ text: string }> };
    };
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/not authorised/i);
  });
});

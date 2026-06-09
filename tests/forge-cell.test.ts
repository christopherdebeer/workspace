/**
 * forge cell — the dynamic-cell control plane (a backend tool-provider).
 *
 * Exercises the pure building blocks (zip framing, the CloudFormation cell
 * template, the registry) and the real `forge` handler invoked the way the
 * gateway/dispatch reach it — via command envelopes — with AWS
 * (CloudFormation/S3/DynamoDB/Lambda) and the esbuild transpiler stubbed.
 * Asserts create transpiles + provisions a `cell-*` stack + records the cell,
 * that `callCell` invokes only for authorised principals, and that
 * `describeTools` advertises the create scope for the gateway to enforce.
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
  __setCloudWatchLogs,
} from '../services/forge/provisioner';

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
    scan: ({ ExpressionAttributeValues }: { ExpressionAttributeValues: Record<string, unknown> }) => ({
      promise: async () => ({
        Items: [...store.values()].filter(
          (i) =>
            i.sk === ExpressionAttributeValues[':a'] &&
            Array.isArray(i.grants) &&
            (i.grants as string[]).includes(ExpressionAttributeValues[':p'] as string),
        ),
      }),
    }),
  };
}

const cfnCalls: Array<{ StackName: string; TemplateBody: string }> = [];
const s3Calls: Array<{ Bucket: string; Key: string }> = [];
let lambdaResponse: unknown = { statusCode: 200, body: JSON.stringify({ ok: true }) };

function installAwsStubs(): void {
  __setDocumentClient(memoryDocClient() as unknown as Parameters<typeof __setDocumentClient>[0]);
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
  __setCloudWatchLogs({
    filterLogEvents: (p: { logGroupName: string }) => ({
      promise: async () => ({
        events:
          p.logGroupName.startsWith('/aws/lambda/cell-')
            ? [{ timestamp: 1_700_000_000_000, message: 'hello from cell\n' }]
            : [],
      }),
    }),
  } as unknown as Parameters<typeof __setCloudWatchLogs>[0]);
  __setEsbuild({
    initialize: async () => undefined,
    transform: async (code: string) => ({ code: `/*compiled*/ ${code}`, warnings: [], map: '' }),
  } as unknown as Parameters<typeof __setEsbuild>[0]);
}

// forge is reached the way the gateway/dispatch reach it: a command envelope
// carrying the (already-validated) caller as `user`.
interface CommandResult<T = unknown> {
  ok: boolean;
  result?: T;
  error?: string;
}
async function call<T = unknown>(user: string | undefined, command: string, payload: unknown): Promise<CommandResult<T>> {
  return (await forge({ __command: command, payload, user })) as CommandResult<T>;
}

describe('forge: zip framing', () => {
  it('crc32 matches the known IEEE vector for "123456789"', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
  it('zipStore frames a local header + EOCD signature', () => {
    const zip = zipStore([{ name: 'index.js', content: 'exports.x=1' }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
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
    // listAccessibleBy returns cells the principal owns or was granted.
    expect((await reg.listAccessibleBy('alice')).map((c) => c.cellId)).toEqual(['notes-abc']);
    expect((await reg.listAccessibleBy('bob')).map((c) => c.cellId)).toEqual(['notes-abc']);
    expect(await reg.listAccessibleBy('carol')).toEqual([]);
    __setDocumentClient(undefined);
  });
});

describe('forge: backend commands', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'forge';
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
  });
  afterEach(() => {
    __setDocumentClient(undefined);
    __setS3(undefined);
    __setCloudFormation(undefined);
    __setProvisionerLambda(undefined);
    __setCloudWatchLogs(undefined);
    __setEsbuild(undefined);
    for (const k of [
      'TABLE_NAME', 'CELL_CODE_BUCKET', 'CELL_PERMISSION_BOUNDARY_ARN',
      'CELL_EVENT_BUS_NAME', 'CELL_EVENT_BUS_ARN', 'CELL_ACCOUNT_ID', 'CELL_REGION',
    ]) delete process.env[k];
  });

  const cellCode = 'export const handler = async () => ({ statusCode: 200, body: "{}" });';

  it('describeTools advertises createCell with the create scope (for the gateway)', async () => {
    const res = await call<{ tools: Array<{ name: string; scope: string | null }> }>('alice', 'describeTools', {});
    expect(res.ok).toBe(true);
    const create = res.result!.tools.find((t) => t.name === 'createCell');
    expect(create?.scope).toBe('platform:cells:create');
    // callCell is ownership-gated, not scoped
    expect(res.result!.tools.find((t) => t.name === 'callCell')?.scope).toBeNull();
  });

  it('createCell transpiles, uploads, deploys a cell-* stack, and records it', async () => {
    const res = await call<{ cellId: string; address: string; status: string }>('alice', 'createCell', {
      name: 'My Notes',
      code: cellCode,
    });
    expect(res.ok).toBe(true);
    expect(res.result!.status).toBe('CREATING');
    expect(res.result!.address).toBe('/@alice/my-notes');
    expect(res.result!.cellId).toMatch(/^my-notes-[0-9a-f]{8}$/);
    // Two uploads: the built zip + the seeded editable src/index.ts.
    expect(s3Calls).toHaveLength(2);
    expect(s3Calls.some((c) => c.Key === `cells/${res.result!.cellId}/src/index.ts`)).toBe(true);
    expect(s3Calls.some((c) => c.Key.endsWith('.zip'))).toBe(true);
    expect(cfnCalls).toHaveLength(1);
    expect(cfnCalls[0].StackName).toBe(`cell-${res.result!.cellId}`);
    expect(cfnCalls[0].TemplateBody).toContain('arn:aws:iam::111:policy/boundary');
  });

  it('callCell invokes the cell for the owner and returns its parsed body', async () => {
    lambdaResponse = { statusCode: 200, body: JSON.stringify({ greeting: 'hi' }) };
    await call('alice', 'createCell', { name: 'notes', code: cellCode });
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    await reg.setStatus(cell.cellId, 'ACTIVE');

    const res = await call<{ statusCode: number; body: { greeting: string } }>('alice', 'callCell', {
      cellId: cell.cellId,
      body: { name: 'x' },
    });
    expect(res.ok).toBe(true);
    expect(res.result!.statusCode).toBe(200);
    expect(res.result!.body).toEqual({ greeting: 'hi' });
  });

  it('cellLogs returns the cell logs for the owner', async () => {
    await call('alice', 'createCell', { name: 'notes', code: cellCode });
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    const res = await call<{ count: number; events: Array<{ message: string }> }>('alice', 'cellLogs', {
      cellId: cell.cellId,
      since: '1h',
    });
    expect(res.ok).toBe(true);
    expect(res.result!.count).toBe(1);
    expect(res.result!.events[0].message).toBe('hello from cell');
  });

  it('catalogCells returns the caller-accessible cells (own + granted), scoped per caller', async () => {
    await call('alice', 'createCell', { name: 'notes', code: cellCode, share: ['bob'] });
    await call('alice', 'createCell', { name: 'private', code: cellCode });

    const mine = await call<{ cells: Array<{ name: string; address: string; shared: boolean }> }>(
      'alice',
      'catalogCells',
      {},
    );
    expect(mine.ok).toBe(true);
    expect(mine.result!.cells.map((c) => c.name).sort()).toEqual(['notes', 'private']);
    expect(mine.result!.cells.every((c) => c.shared === false)).toBe(true);

    // bob sees only the cell shared with him, marked shared (not owned).
    const bobs = await call<{ cells: Array<{ name: string; shared: boolean }> }>('bob', 'catalogCells', {});
    expect(bobs.ok).toBe(true);
    expect(bobs.result!.cells.map((c) => c.name)).toEqual(['notes']);
    expect(bobs.result!.cells[0].shared).toBe(true);

    // an unrelated principal sees nothing.
    const carols = await call<{ cells: unknown[] }>('carol', 'catalogCells', {});
    expect(carols.result!.cells).toEqual([]);
  });

  it('callCell denies a principal who is neither owner nor grantee', async () => {
    await call('alice', 'createCell', { name: 'notes', code: cellCode });
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    await reg.setStatus(cell.cellId, 'ACTIVE');

    const res = await call('bob', 'callCell', { cellId: cell.cellId });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not authorised/i);
  });

  it('describeCellTools advertises an active cell’s tools, namespaced by cellId', async () => {
    // The cell answers GET /_tools with its tool manifest.
    lambdaResponse = {
      statusCode: 200,
      body: JSON.stringify({
        tools: [{ name: 'add', description: 'Add a note.', inputSchema: { type: 'object' }, scope: null }],
      }),
    };
    await call('alice', 'createCell', { name: 'notes', code: cellCode });
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    await reg.setStatus(cell.cellId, 'ACTIVE');

    const res = await call<{ tools: Array<{ name: string; address: string; cellId: string; tool: string; scope: string | null; kind: string }> }>(
      'alice',
      'describeCellTools',
      {},
    );
    expect(res.ok).toBe(true);
    expect(res.result!.tools).toEqual([
      expect.objectContaining({
        name: `${cell.cellId}__add`,
        address: '@alice/notes',
        cellId: cell.cellId,
        tool: 'add',
        scope: null,
        kind: 'act', // default when the manifest omits kind
      }),
    ]);
  });

  it('describeCellTools resolves a single cell when given an owner+name selector', async () => {
    lambdaResponse = {
      statusCode: 200,
      body: JSON.stringify({ tools: [{ name: 'add', description: 'Add.', inputSchema: { type: 'object' }, kind: 'read' }] }),
    };
    await call('alice', 'createCell', { name: 'notes', code: cellCode });
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    await reg.setStatus(cell.cellId, 'ACTIVE');

    const hit = await call<{ tools: Array<{ tool: string; kind: string }> }>('alice', 'describeCellTools', { owner: 'alice', name: 'notes' });
    expect(hit.result!.tools).toEqual([expect.objectContaining({ tool: 'add', kind: 'read' })]);

    // A selector that doesn't resolve to an accessible ACTIVE cell yields nothing.
    const miss = await call<{ tools: unknown[] }>('alice', 'describeCellTools', { owner: 'alice', name: 'ghost' });
    expect(miss.result!.tools).toEqual([]);
  });

  it('describeCellTools skips cells that are not ACTIVE', async () => {
    lambdaResponse = { statusCode: 200, body: JSON.stringify({ tools: [{ name: 'add' }] }) };
    await call('alice', 'createCell', { name: 'notes', code: cellCode }); // stays CREATING
    const res = await call<{ tools: unknown[] }>('alice', 'describeCellTools', {});
    expect(res.result!.tools).toEqual([]);
  });

  it('callCellTool forwards to the cell tool and returns its body, ownership-gated', async () => {
    lambdaResponse = { statusCode: 200, body: JSON.stringify({ added: true }) };
    await call('alice', 'createCell', { name: 'notes', code: cellCode });
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    await reg.setStatus(cell.cellId, 'ACTIVE');

    const ok = await call<{ added: boolean }>('alice', 'callCellTool', { cellId: cell.cellId, tool: 'add', args: { text: 'hi' } });
    expect(ok.ok).toBe(true);
    expect(ok.result).toEqual({ added: true });

    // Same ownership gate as callCell.
    const denied = await call('bob', 'callCellTool', { cellId: cell.cellId, tool: 'add', args: {} });
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/not authorised/i);
  });
});

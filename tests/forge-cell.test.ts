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
import { handler as forge } from '../services/cells/service';
import { crc32, zipStore } from '../services/cells/zip';
import { buildCellTemplate, cellResourceName } from '../services/cells/cell-template';
import { createRegistry, __setDocumentClient, CellRecord } from '../services/cells/registry';
import { __setEsbuild } from '../services/cells/transpile';
import {
  __setCloudFormation,
  __setS3,
  __setLambda as __setProvisionerLambda,
  __setCloudWatchLogs,
} from '../services/cells/provisioner';

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
          if (':s' in ExpressionAttributeValues) item.status = ExpressionAttributeValues[':s'];
          if (':d' in ExpressionAttributeValues) item.deploy = ExpressionAttributeValues[':d'];
          if (':u' in ExpressionAttributeValues) item.updatedAt = ExpressionAttributeValues[':u'];
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
      promise: async () => {
        const rows = [...store.values()].filter((i) => i.sk === ExpressionAttributeValues[':a']);
        // listActive: ACTIVE profile rows for the global type vocabulary.
        if (':active' in ExpressionAttributeValues) {
          return { Items: rows.filter((i) => i.status === ExpressionAttributeValues[':active']) };
        }
        // listAccessibleBy: rows the principal owns/was granted (whole or per-tool).
        const p = ExpressionAttributeValues[':p'] as string;
        return {
          Items: rows.filter(
            (i) =>
              (Array.isArray(i.grants) && (i.grants as string[]).includes(p)) ||
              (typeof i.toolGrants === 'object' && i.toolGrants !== null && p in (i.toolGrants as Record<string, unknown>)),
          ),
        };
      },
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

// A bus event the way EventBridge delivers it (source IAM-attested by the route).
async function emitEvent(detailType: string, detail: Record<string, unknown>): Promise<void> {
  await forge({ 'detail-type': detailType, source: 'cells', detail } as unknown as Parameters<typeof forge>[0]);
}

describe('cells: zip framing', () => {
  it('crc32 matches the known IEEE vector for "123456789"', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
  it('zipStore frames a local header + EOCD signature', () => {
    const zip = zipStore([{ name: 'index.js', content: 'exports.x=1' }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  });
});

describe('cells: cell template', () => {
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

  it('grants no substrate access when no substrate table is configured', () => {
    const role = tpl.Resources.CellRole.Properties as {
      Policies: Array<{ PolicyDocument: { Statement: Array<{ Sid: string }> } }>;
    };
    const sids = role.Policies[0].PolicyDocument.Statement.map((s) => s.Sid);
    expect(sids).not.toContain('SubstrateOwnScopeRead');
    const env = tpl.Resources.CellFunction.Properties.Environment as { Variables: Record<string, string> };
    expect(env.Variables.SUBSTRATE_TABLE).toBeUndefined();
  });
});

describe('cells: cell template substrate access', () => {
  const substrateArn = 'arn:aws:dynamodb:us-east-1:111:table/substrate';
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
    substrateTable: { name: 'substrate', arn: substrateArn },
  }) as { Resources: Record<string, { Type: string; Properties: Record<string, unknown> }> };

  interface PolicyStatement {
    Sid: string;
    Action: string[];
    Resource: string[];
    Condition?: Record<string, Record<string, string[]>>;
  }
  const statements = (
    tpl.Resources.CellRole.Properties as {
      Policies: Array<{ PolicyDocument: { Statement: PolicyStatement[] } }>;
    }
  ).Policies[0].PolicyDocument.Statement;

  it('grants read-only substrate access scoped to the owner via LeadingKeys', () => {
    const stmt = statements.find((s) => s.Sid === 'SubstrateOwnScopeRead');
    expect(stmt).toBeDefined();
    // Read-only: an organ observes the reef; writes stay mediated.
    expect(stmt!.Action.sort()).toEqual(['dynamodb:BatchGetItem', 'dynamodb:GetItem', 'dynamodb:Query']);
    expect(stmt!.Resource).toEqual([substrateArn, `${substrateArn}/index/*`]);
    // The condition is the authority boundary: only the owner's partitions,
    // on the table and (scope-prefixed) GSIs alike.
    const leading = stmt!.Condition?.['ForAllValues:StringLike']?.['dynamodb:LeadingKeys'];
    expect(leading).toEqual([
      'STATE#alice',
      'TRAJ#alice',
      'SEQ#alice',
      'IN#alice#*',
      'TYPE#alice#*',
    ]);
  });

  it('injects SUBSTRATE_TABLE into the cell environment', () => {
    const env = tpl.Resources.CellFunction.Properties.Environment as { Variables: Record<string, string> };
    expect(env.Variables.SUBSTRATE_TABLE).toBe('substrate');
  });
});

describe('cells: registry', () => {
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

  it('listActive returns only ACTIVE cells and round-trips declared types', async () => {
    __setDocumentClient(memoryDocClient() as unknown as Parameters<typeof __setDocumentClient>[0]);
    const reg = createRegistry('forge-table');
    const base = {
      description: null, functionName: 'fn', stackName: 'stk', grants: ['alice'],
      createdAt: 't', updatedAt: 't',
    };
    await reg.put({ cellId: 'lit-1', name: 'lit', owner: 'alice', status: 'CREATING', ...base,
      types: [{ type: 'doc', manager: '@alice/lit', icon: '📄' }] });
    await reg.put({ cellId: 'input-1', name: 'input', owner: 'alice', status: 'ACTIVE', ...base,
      types: [{ type: 'capture', manager: '@alice/input', icon: '📥' }] });
    const active = await reg.listActive();
    expect(active.map((c) => c.cellId)).toEqual(['input-1']);
    expect(active[0].types).toEqual([{ type: 'capture', manager: '@alice/input', icon: '📥' }]);
    // Once the lit cell flips ACTIVE its types become visible too.
    await reg.setStatus('lit-1', 'ACTIVE');
    expect((await reg.listActive()).map((c) => c.cellId).sort()).toEqual(['input-1', 'lit-1']);
    __setDocumentClient(undefined);
  });
});

describe('cells: backend commands', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'cells';
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
    const create = res.result!.tools.find((t) => t.name === 'create');
    expect(create?.scope).toBe('cells:create');
    // callCell is ownership-gated, not scoped
    expect(res.result!.tools.find((t) => t.name === 'call')?.scope).toBeNull();
  });

  it('createCell transpiles, uploads, deploys a cell-* stack, and records it', async () => {
    const res = await call<{ cellId: string; address: string; status: string }>('alice', 'create', {
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

  it('list reconciles a CREATING record to ACTIVE from the live stack', async () => {
    await call('alice', 'create', { name: 'notes', code: cellCode }); // record persists at CREATING
    // The default CFN stub reports CREATE_COMPLETE, so listing should reconcile
    // the stale status without a getCell round-trip.
    const res = await call<{ cells: Array<{ cellId: string; status: string }> }>('alice', 'list', {});
    expect(res.ok).toBe(true);
    expect(res.result!.cells).toHaveLength(1);
    expect(res.result!.cells[0].status).toBe('ACTIVE');
    // The reconcile is persisted, not just reflected in the response.
    const reg = createRegistry('forge-table');
    expect((await reg.listByOwner('alice'))[0].status).toBe('ACTIVE');
  });

  it('create recreates over an orphaned record whose stack has vanished', async () => {
    await call('alice', 'create', { name: 'notes', code: cellCode }); // record at CREATING
    const reg = createRegistry('forge-table');
    const [before] = await reg.listByOwner('alice');
    // Simulate a vanished stack: a failed create auto-deletes (OnFailure: DELETE),
    // or a teardown finished — describeStacks then rejects with ValidationError,
    // which describeStack maps to null. A CREATING record over no stack is an
    // orphan; recreating the same name must succeed instead of "already exists".
    __setCloudFormation({
      createStack: (p: { StackName: string; TemplateBody: string }) => {
        cfnCalls.push(p);
        return { promise: async () => ({ StackId: 'id' }) };
      },
      describeStacks: () => ({
        promise: async () => {
          const e = new Error('Stack does not exist') as Error & { code?: string };
          e.code = 'ValidationError';
          throw e;
        },
      }),
      deleteStack: () => ({ promise: async () => ({}) }),
    } as unknown as Parameters<typeof __setCloudFormation>[0]);
    const res = await call<{ cellId: string; status: string }>('alice', 'create', { name: 'notes', code: cellCode });
    expect(res.ok).toBe(true);
    expect(res.result!.cellId).toBe(before.cellId);
    expect(res.result!.status).toBe('CREATING');
  });

  it('deploy is async: returns DEPLOYING and records the phase for polling', async () => {
    await call('alice', 'create', { name: 'notes', code: cellCode });
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    const res = await call<{ deploying: boolean; cellId: string; deploy: { phase: string; version: string } }>(
      'alice',
      'deploy',
      { cellId: cell.cellId },
    );
    expect(res.ok).toBe(true);
    expect(res.result!.deploying).toBe(true);
    expect(res.result!.deploy.phase).toBe('DEPLOYING');
    // Persisted and surfaced by `get` — that's the poll target.
    const got = await call<{ deploy?: { phase: string } }>('alice', 'get', { cellId: cell.cellId });
    expect(got.result!.deploy?.phase).toBe('DEPLOYING');
  });

  it('the cell.deploy.requested handler records FAILED (and does not throw) when the bundle fails', async () => {
    await call('alice', 'create', { name: 'notes', code: cellCode });
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    // Empty src listing → deployCell throws "no source files to deploy"; the
    // worker must catch it and record FAILED rather than crash the invocation.
    __setS3({
      putObject: (p: { Bucket: string; Key: string }) => {
        s3Calls.push({ Bucket: p.Bucket, Key: p.Key });
        return { promise: async () => ({}) };
      },
      listObjectsV2: () => ({ promise: async () => ({ Contents: [] }) }),
    } as unknown as Parameters<typeof __setS3>[0]);
    await emitEvent('cell.deploy.requested', { cellId: cell.cellId });
    const got = await reg.get(cell.cellId);
    expect(got?.deploy?.phase).toBe('FAILED');
    expect(got?.deploy?.error).toBeTruthy();
  });

  it('callCell invokes the cell for the owner and returns its parsed body', async () => {
    lambdaResponse = { statusCode: 200, body: JSON.stringify({ greeting: 'hi' }) };
    await call('alice', 'create', { name: 'notes', code: cellCode });
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    await reg.setStatus(cell.cellId, 'ACTIVE');

    const res = await call<{ statusCode: number; body: { greeting: string } }>('alice', 'call', {
      cellId: cell.cellId,
      body: { name: 'x' },
    });
    expect(res.ok).toBe(true);
    expect(res.result!.statusCode).toBe(200);
    expect(res.result!.body).toEqual({ greeting: 'hi' });
  });

  it('cellLogs returns the cell logs for the owner', async () => {
    await call('alice', 'create', { name: 'notes', code: cellCode });
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    const res = await call<{ count: number; events: Array<{ message: string }> }>('alice', 'logs', {
      cellId: cell.cellId,
      since: '1h',
    });
    expect(res.ok).toBe(true);
    expect(res.result!.count).toBe(1);
    expect(res.result!.events[0].message).toBe('hello from cell');
  });

  it('catalogCells returns the caller-accessible cells (own + granted), scoped per caller', async () => {
    await call('alice', 'create', { name: 'notes', code: cellCode, share: ['bob'] });
    await call('alice', 'create', { name: 'private', code: cellCode });

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
    await call('alice', 'create', { name: 'notes', code: cellCode });
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    await reg.setStatus(cell.cellId, 'ACTIVE');

    const res = await call('bob', 'call', { cellId: cell.cellId });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not authorised/i);
  });

  it('a public cell serves anonymous GETs but still gates writes (web-facing)', async () => {
    lambdaResponse = {
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: '<!doctype html><h1>hi</h1>',
    };
    await call('alice', 'create', { name: 'site', code: cellCode, public: true });
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    await reg.setStatus(cell.cellId, 'ACTIVE');
    expect(cell.public).toBe(true);

    // Anonymous GET → allowed, with the cell's headers passed through.
    const anon = await call<{ statusCode: number; headers: Record<string, string>; body: string }>(
      undefined, 'call', { cellId: cell.cellId, method: 'GET', path: '/' },
    );
    expect(anon.ok).toBe(true);
    expect(anon.result!.statusCode).toBe(200);
    expect(anon.result!.headers['content-type']).toBe('text/html');
    expect(anon.result!.body).toBe('<!doctype html><h1>hi</h1>');

    // Anonymous write → still refused.
    const anonPost = await call(undefined, 'call', { cellId: cell.cellId, method: 'POST', path: '/x' });
    expect(anonPost.ok).toBe(false);

    // A *private* cell refuses anonymous GETs.
    await call('alice', 'create', { name: 'secret', code: cellCode });
    const secret = (await reg.listByOwner('alice')).find((c) => c.name === 'secret')!;
    await reg.setStatus(secret.cellId, 'ACTIVE');
    const anonSecret = await call(undefined, 'call', { cellId: secret.cellId, method: 'GET', path: '/' });
    expect(anonSecret.ok).toBe(false);
  });

  it('describeCellTools advertises an active cell’s tools, namespaced by cellId', async () => {
    // The cell answers GET /_tools with its tool manifest.
    lambdaResponse = {
      statusCode: 200,
      body: JSON.stringify({
        tools: [{ name: 'add', description: 'Add a note.', inputSchema: { type: 'object' }, scope: null }],
      }),
    };
    await call('alice', 'create', { name: 'notes', code: cellCode });
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

  it('describeCellTools discloses third-party authorship to non-owner callers (exfiltration surface)', async () => {
    lambdaResponse = {
      statusCode: 200,
      body: JSON.stringify({ tools: [{ name: 'add', description: 'Add.', inputSchema: { type: 'object' }, kind: 'act' }] }),
    };
    await call('alice', 'create', { name: 'notes', code: cellCode, share: ['bob'] });
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    // The cell declares SSR reads — exactly what its author's code can observe.
    await reg.put({ ...cell, status: 'ACTIVE', ssrReads: [{ as: 'w', target: 'workspace.query' }, { as: 't', target: 'auth.tokens' }] });

    // Non-owner (bob, a grantee) sees the disclosure: author + declared reads + note.
    const bobs = await call<{ tools: Array<{ tool: string; disclosure?: { author: string; reads: string[]; note: string } }> }>(
      'bob', 'describeCellTools', {},
    );
    const tool = bobs.result!.tools.find((t) => t.tool === 'add')!;
    expect(tool.disclosure).toBeDefined();
    expect(tool.disclosure!.author).toBe('alice');
    expect(tool.disclosure!.reads.sort()).toEqual(['auth.tokens', 'workspace.query']);
    expect(tool.disclosure!.note).toMatch(/alice/);

    // The owner gets no notice — writing to your own cell's slice is writing to yourself.
    const alices = await call<{ tools: Array<{ tool: string; disclosure?: unknown }> }>(
      'alice', 'describeCellTools', { owner: 'alice', name: 'notes' },
    );
    expect(alices.result!.tools.find((t) => t.tool === 'add')!.disclosure).toBeUndefined();
  });

  it('describeCellTools resolves a single cell when given an owner+name selector', async () => {
    lambdaResponse = {
      statusCode: 200,
      body: JSON.stringify({ tools: [{ name: 'add', description: 'Add.', inputSchema: { type: 'object' }, kind: 'read' }] }),
    };
    await call('alice', 'create', { name: 'notes', code: cellCode });
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
    await call('alice', 'create', { name: 'notes', code: cellCode }); // stays CREATING
    const res = await call<{ tools: unknown[] }>('alice', 'describeCellTools', {});
    expect(res.result!.tools).toEqual([]);
  });

  it('callCellTool forwards to the cell tool and returns its body, ownership-gated', async () => {
    lambdaResponse = { statusCode: 200, body: JSON.stringify({ added: true }) };
    await call('alice', 'create', { name: 'notes', code: cellCode });
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

  it('per-tool grants: the grantee can call matching tools, sees only them, and is taught the request path otherwise', async () => {
    lambdaResponse = { statusCode: 200, body: JSON.stringify({ ok: true }) };
    await call('alice', 'create', { name: 'regwatch', code: cellCode });
    const reg = createRegistry('forge-table');
    const [cell] = await reg.listByOwner('alice');
    await reg.setStatus(cell.cellId, 'ACTIVE');

    // Only the owner can grant; owner+name addressing works.
    const notOwner = await call('emily', 'grant', { owner: 'alice', name: 'regwatch', principal: 'emily' });
    expect(notOwner.ok).toBe(false);
    const granted = await call<{ toolGrants?: Record<string, string[]> }>('alice', 'grant', {
      owner: 'alice',
      name: 'regwatch',
      principal: 'emily',
      tools: ['review', 'flag', 'list_*', 'stats'],
    });
    expect(granted.ok).toBe(true);
    expect(granted.result!.toolGrants).toEqual({ emily: ['review', 'flag', 'list_*', 'stats'] });

    // Reviewer-scoped tools work (exact and trailing-* patterns)…
    expect((await call('emily', 'callCellTool', { cellId: cell.cellId, tool: 'review', args: {} })).ok).toBe(true);
    expect((await call('emily', 'callCellTool', { cellId: cell.cellId, tool: 'list_items', args: {} })).ok).toBe(true);
    // …owner-shaped tools are denied with the escalation affordance.
    const denied = await call('emily', 'callCellTool', { cellId: cell.cellId, tool: 'save_prompt', args: {} });
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/grant_denied/);
    expect(denied.error).toMatch(/workspace\.requestGrant/);
    expect(denied.error).toMatch(/cell:alice\/regwatch:save_prompt/);

    // Discovery is filtered to the granted tools.
    lambdaResponse = {
      statusCode: 200,
      body: JSON.stringify({
        tools: [
          { name: 'review', kind: 'act' },
          { name: 'list_items', kind: 'read' },
          { name: 'save_prompt', kind: 'act' },
        ],
      }),
    };
    const emilyTools = await call<{ tools: Array<{ tool: string }> }>('emily', 'describeCellTools', {});
    expect(emilyTools.result!.tools.map((t) => t.tool).sort()).toEqual(['list_items', 'review']);
    const aliceTools = await call<{ tools: Array<{ tool: string }> }>('alice', 'describeCellTools', {
      owner: 'alice',
      name: 'regwatch',
    });
    expect(aliceTools.result!.tools.map((t) => t.tool).sort()).toEqual(['list_items', 'review', 'save_prompt']);

    // The cell UI stays reachable for a tool-granted principal (dispatch GET).
    lambdaResponse = { statusCode: 200, headers: { 'content-type': 'text/html' }, body: '<h1>app</h1>' };
    const page = await call<{ statusCode: number }>('emily', 'call', { cellId: cell.cellId, method: 'GET', path: '/' });
    expect(page.ok).toBe(true);
    expect(page.result!.statusCode).toBe(200);

    // A full re-grant widens; revoke removes everything.
    await call('alice', 'grant', { cellId: cell.cellId, principal: 'emily' });
    lambdaResponse = { statusCode: 200, body: JSON.stringify({ ok: true }) };
    expect((await call('emily', 'callCellTool', { cellId: cell.cellId, tool: 'save_prompt', args: {} })).ok).toBe(true);
    await call('alice', 'revoke', { cellId: cell.cellId, principal: 'emily' });
    const gone = await call('emily', 'callCellTool', { cellId: cell.cellId, tool: 'review', args: {} });
    expect(gone.ok).toBe(false);
    expect(gone.error).toMatch(/grant_denied/);
  });

  it('describeTypes aggregates declared types from ACTIVE cells, keyed by bare type', async () => {
    const reg = createRegistry('forge-table');
    const base = {
      description: null, functionName: 'fn', stackName: 'stk', grants: ['alice'],
      createdAt: 't', updatedAt: 't',
    };
    // lit declares `doc` with an explicit manager; input declares `capture` with no
    // manager (defaults to the cell address); a CREATING cell is excluded entirely.
    await reg.put({ cellId: 'lit-1', name: 'lit', owner: 'alice', status: 'ACTIVE', ...base,
      types: [{ type: 'doc', manager: '@alice/lit', icon: '📄' }] });
    await reg.put({ cellId: 'input-1', name: 'input', owner: 'alice', status: 'ACTIVE', ...base,
      types: [{ type: 'capture', icon: '📥' }] });
    await reg.put({ cellId: 'draft-1', name: 'draft', owner: 'alice', status: 'CREATING', ...base,
      types: [{ type: 'wip', icon: '🚧' }] });

    const res = await call<{ types: Record<string, { manager?: string; icon?: string; type?: string }> }>('alice', 'describeTypes', {});
    expect(res.ok).toBe(true);
    const types = res.result!.types;
    expect(Object.keys(types).sort()).toEqual(['capture', 'doc']);
    // explicit manager kept; the bare `type` discriminator is stripped from the value
    expect(types.doc.manager).toBe('@alice/lit');
    expect(types.doc.type).toBeUndefined();
    // missing manager defaults to the declaring cell's address
    expect(types.capture.manager).toBe('/@alice/input');
  });
});

/**
 * cell common layer — forge's S3-brokered source files + per-user blob data.
 *
 * Drives the real `forge` handler with an in-memory S3, the esbuild bundler, and
 * Lambda/CloudFormation/DynamoDB stubbed. Asserts: createCell seeds an editable
 * src/ tree; write/read/list/delete round-trip; path traversal is rejected;
 * deploy bundles the tree and points the cell's Lambda at the new build; per-user
 * data is partitioned by caller and owner-gated; and every op is ownership-gated.
 */
import { handler as forge } from '../services/forge/service';
import { __setDocumentClient } from '../services/forge/registry';
import { __setEsbuild } from '../services/forge/transpile';
import {
  __setCloudFormation,
  __setS3,
  __setLambda as __setProvisionerLambda,
  __setCloudWatchLogs,
} from '../services/forge/provisioner';

interface Item {
  pk: string;
  sk: string;
  [k: string]: unknown;
}
function memoryDocClient(): Record<string, unknown> {
  const store = new Map<string, Item>();
  const key = (k: { pk: string; sk: string }) => `${k.pk}|${k.sk}`;
  return {
    get: ({ Key }: { Key: { pk: string; sk: string } }) => ({ promise: async () => ({ Item: store.get(key(Key)) }) }),
    put: ({ Item }: { Item: Item }) => ({ promise: async () => { store.set(key(Item), Item); return {}; } }),
    update: ({ Key, ExpressionAttributeValues }: { Key: { pk: string; sk: string }; ExpressionAttributeValues: Record<string, unknown> }) => ({
      promise: async () => {
        const item = store.get(key(Key));
        if (item) { item.status = ExpressionAttributeValues[':s']; item.updatedAt = ExpressionAttributeValues[':u']; }
        return {};
      },
    }),
    query: ({ ExpressionAttributeValues }: { ExpressionAttributeValues: Record<string, unknown> }) => ({
      promise: async () => ({ Items: [...store.values()].filter((i) => i.pk === ExpressionAttributeValues[':pk']) }),
    }),
    scan: () => ({ promise: async () => ({ Items: [] }) }),
  };
}

/** In-memory S3: keyed by `${Bucket}/${Key}`. */
function memoryS3(): { store: Map<string, string | Buffer> } & Record<string, unknown> {
  const store = new Map<string, string | Buffer>();
  return {
    store,
    putObject: ({ Bucket, Key, Body }: { Bucket: string; Key: string; Body: string | Buffer }) => ({
      promise: async () => { store.set(`${Bucket}/${Key}`, Body); return {}; },
    }),
    getObject: ({ Bucket, Key }: { Bucket: string; Key: string }) => ({
      promise: async () => {
        const k = `${Bucket}/${Key}`;
        if (!store.has(k)) { const e = new Error('NoSuchKey') as Error & { code: string }; e.code = 'NoSuchKey'; throw e; }
        return { Body: store.get(k) };
      },
    }),
    listObjectsV2: ({ Bucket, Prefix }: { Bucket: string; Prefix?: string }) => ({
      promise: async () => ({
        Contents: [...store.keys()]
          .filter((k) => k.startsWith(`${Bucket}/${Prefix ?? ''}`))
          .map((k) => ({ Key: k.slice(Bucket.length + 1) })),
        IsTruncated: false,
      }),
    }),
    deleteObject: ({ Bucket, Key }: { Bucket: string; Key: string }) => ({
      promise: async () => { store.delete(`${Bucket}/${Key}`); return {}; },
    }),
  };
}

let s3mem: ReturnType<typeof memoryS3>;
const updateCodeCalls: Array<{ FunctionName: string; S3Key: string }> = [];

interface CommandResult<T = unknown> { ok: boolean; result?: T; error?: string }
async function call<T = unknown>(user: string | undefined, command: string, payload: unknown): Promise<CommandResult<T>> {
  return (await forge({ __command: command, payload, user })) as CommandResult<T>;
}

const cellCode = 'export const handler = async () => ({ statusCode: 200, body: "{}" });';

describe('forge: cell common layer (S3 files + data)', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'forge';
    process.env.TABLE_NAME = 'forge-table';
    process.env.CELL_CODE_BUCKET = 'code-bucket';
    process.env.CELL_PERMISSION_BOUNDARY_ARN = 'arn:aws:iam::111:policy/boundary';
    process.env.CELL_EVENT_BUS_NAME = 'platform-bus';
    process.env.CELL_EVENT_BUS_ARN = 'arn:aws:events:us-east-1:111:event-bus/platform-bus';
    process.env.CELL_ACCOUNT_ID = '111';
    process.env.CELL_REGION = 'us-east-1';
    updateCodeCalls.length = 0;
    s3mem = memoryS3();

    __setDocumentClient(memoryDocClient() as unknown as Parameters<typeof __setDocumentClient>[0]);
    __setS3(s3mem as unknown as Parameters<typeof __setS3>[0]);
    __setCloudFormation({
      createStack: () => ({ promise: async () => ({ StackId: 'id' }) }),
      describeStacks: () => ({ promise: async () => ({ Stacks: [{ StackStatus: 'CREATE_COMPLETE', Outputs: [] }] }) }),
      deleteStack: () => ({ promise: async () => ({}) }),
    } as unknown as Parameters<typeof __setCloudFormation>[0]);
    __setProvisionerLambda({
      invoke: () => ({ promise: async () => ({ Payload: JSON.stringify({ statusCode: 200, body: '{}' }) }) }),
      updateFunctionCode: (p: { FunctionName: string; S3Key: string }) => ({
        promise: async () => { updateCodeCalls.push(p); return {}; },
      }),
    } as unknown as Parameters<typeof __setProvisionerLambda>[0]);
    __setCloudWatchLogs({ filterLogEvents: () => ({ promise: async () => ({ events: [] }) }) } as unknown as Parameters<typeof __setCloudWatchLogs>[0]);
    __setEsbuild({
      initialize: async () => undefined,
      transform: async (code: string) => ({ code: `/*t*/${code}`, warnings: [], map: '' }),
      build: async (opts: { entryPoints?: string[] }) => ({ outputFiles: [{ text: `/*bundled ${opts.entryPoints?.[0]}*/` }], errors: [], warnings: [] }),
    } as unknown as Parameters<typeof __setEsbuild>[0]);
  });
  afterEach(() => {
    __setDocumentClient(undefined);
    __setS3(undefined);
    __setCloudFormation(undefined);
    __setProvisionerLambda(undefined);
    __setCloudWatchLogs(undefined);
    __setEsbuild(undefined);
    for (const k of ['TABLE_NAME', 'CELL_CODE_BUCKET', 'CELL_PERMISSION_BOUNDARY_ARN', 'CELL_EVENT_BUS_NAME', 'CELL_EVENT_BUS_ARN', 'CELL_ACCOUNT_ID', 'CELL_REGION']) {
      delete process.env[k];
    }
  });

  async function makeCell(owner: string, share: string[] = []): Promise<string> {
    const res = await call<{ cellId: string }>(owner, 'createCell', { name: 'tools', code: cellCode, share });
    expect(res.ok).toBe(true);
    return res.result!.cellId;
  }

  it('createCell seeds an editable src/index.ts; write/read/list round-trips', async () => {
    const cellId = await makeCell('alice');
    expect((await call<{ files: string[] }>('alice', 'listFiles', { cellId })).result!.files).toEqual(['index.ts']);

    await call('alice', 'writeFile', { cellId, path: 'lib/util.ts', content: 'export const x = 1;' });
    const files = (await call<{ files: string[] }>('alice', 'listFiles', { cellId })).result!.files.sort();
    expect(files).toEqual(['index.ts', 'lib/util.ts']);

    const read = await call<{ content: string }>('alice', 'readFile', { cellId, path: 'lib/util.ts' });
    expect(read.result!.content).toBe('export const x = 1;');

    await call('alice', 'deleteFile', { cellId, path: 'lib/util.ts' });
    expect((await call<{ files: string[] }>('alice', 'listFiles', { cellId })).result!.files).toEqual(['index.ts']);
  });

  it('rejects path traversal', async () => {
    const cellId = await makeCell('alice');
    const res = await call('alice', 'writeFile', { cellId, path: '../escape.ts', content: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid path/i);
  });

  it('deploy bundles the src/ tree and points the cell Lambda at the new build', async () => {
    const cellId = await makeCell('alice');
    await call('alice', 'writeFile', { cellId, path: 'lib/util.ts', content: 'export const x = 1;' });

    const res = await call<{ deployed: boolean; version: string; entry: string; files: string[] }>('alice', 'deploy', { cellId });
    expect(res.ok).toBe(true);
    expect(res.result!.deployed).toBe(true);
    expect(res.result!.entry).toBe('index.ts');
    expect(res.result!.files.sort()).toEqual(['index.ts', 'lib/util.ts']);

    // Lambda was repointed at cells/<id>/build/<version>.zip
    expect(updateCodeCalls).toHaveLength(1);
    expect(updateCodeCalls[0].S3Key).toBe(`cells/${cellId}/build/${res.result!.version}.zip`);
    expect(s3mem.store.has(`code-bucket/cells/${cellId}/build/${res.result!.version}.zip`)).toBe(true);
  });

  it('per-user blob data is partitioned by caller and owner-gated', async () => {
    const cellId = await makeCell('alice', ['bob']); // bob is a grantee

    await call('alice', 'putData', { cellId, key: 'notes.txt', content: 'from-alice' });
    await call('bob', 'putData', { cellId, key: 'notes.txt', content: 'from-bob' });

    // Each caller reads their own space by default.
    expect((await call<{ content: string }>('alice', 'getData', { cellId, key: 'notes.txt' })).result!.content).toBe('from-alice');
    expect((await call<{ content: string }>('bob', 'getData', { cellId, key: 'notes.txt' })).result!.content).toBe('from-bob');

    // The owner may read another user's data; a grantee may not.
    expect((await call<{ content: string }>('alice', 'getData', { cellId, key: 'notes.txt', user: 'bob' })).result!.content).toBe('from-bob');
    const denied = await call('bob', 'getData', { cellId, key: 'notes.txt', user: 'alice' });
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/owner/i);

    expect((await call<{ keys: string[] }>('alice', 'listData', { cellId })).result!.keys).toEqual(['notes.txt']);
  });

  it('file + data ops are ownership-gated', async () => {
    const cellId = await makeCell('alice'); // bob NOT granted
    const write = await call('bob', 'writeFile', { cellId, path: 'index.ts', content: 'x' });
    expect(write.ok).toBe(false);
    expect(write.error).toMatch(/not authorised/i);

    const data = await call('bob', 'getData', { cellId, key: 'x' });
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/not authorised/i);
  });
});

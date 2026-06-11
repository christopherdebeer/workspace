/**
 * cell common layer — forge's S3-brokered source files + per-user blob data.
 *
 * Drives the real `forge` handler with an in-memory S3, the esbuild bundler, and
 * Lambda/CloudFormation/DynamoDB stubbed. Asserts: createCell seeds an editable
 * src/ tree; write/read/list/delete round-trip; path traversal is rejected;
 * deploy bundles the tree and points the cell's Lambda at the new build; per-user
 * data is partitioned by caller and owner-gated; and every op is ownership-gated.
 */
import { handler as forge } from '../services/cells/service';
import { __setDocumentClient } from '../services/cells/registry';
import { __setEsbuild, resolveBareImport } from '../services/cells/transpile';
import {
  __setCloudFormation,
  __setS3,
  __setLambda as __setProvisionerLambda,
  __setCloudWatchLogs,
} from '../services/cells/provisioner';

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
  const types = new Map<string, string>();
  return {
    store,
    putObject: ({ Bucket, Key, Body, ContentType }: { Bucket: string; Key: string; Body: string | Buffer; ContentType?: string }) => ({
      promise: async () => {
        store.set(`${Bucket}/${Key}`, Body);
        if (ContentType) types.set(`${Bucket}/${Key}`, ContentType);
        return {};
      },
    }),
    getObject: ({ Bucket, Key }: { Bucket: string; Key: string }) => ({
      promise: async () => {
        const k = `${Bucket}/${Key}`;
        if (!store.has(k)) { const e = new Error('NoSuchKey') as Error & { code: string }; e.code = 'NoSuchKey'; throw e; }
        return { Body: store.get(k), ContentType: types.get(k) };
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
    process.env.SERVICE_NAME = 'cells';
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
    const res = await call<{ cellId: string }>(owner, 'create', { name: 'tools', code: cellCode, share });
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
    // No client entry → no client bundle, no static assets.
    expect(res.result!).toMatchObject({ clientEntry: null, staticFiles: [] });
  });

  it('deploy browser-bundles a client/ entry and ships static/ assets (the tier-2 clientEntry)', async () => {
    const cellId = await makeCell('alice');
    await call('alice', 'writeFile', { cellId, path: 'client/main.ts', content: 'document.title = "canvas";' });
    await call('alice', 'writeFile', { cellId, path: 'client/imports.json', content: '{"yjs":"13.6.27"}' });
    await call('alice', 'writeFile', { cellId, path: 'static/style.css', content: 'body{margin:0}' });

    const res = await call<{
      deployed: boolean;
      clientEntry: string | null;
      staticFiles: string[];
    }>('alice', 'deploy', { cellId });
    expect(res.ok).toBe(true);
    expect(res.result!.clientEntry).toBe('client/main.ts');
    expect(res.result!.staticFiles).toEqual(['static/style.css']);

    // The package zip carries index.js + app.js + the static asset.
    const zipKey = [...s3mem.store.keys()].find((k) => k.includes('/build/'))!;
    const zip = s3mem.store.get(zipKey) as Buffer;
    const names = zip.toString('latin1');
    expect(names).toContain('index.js');
    expect(names).toContain('app.js');
    expect(names).toContain('static/style.css');
  });

  it('deploy rejects a malformed client/imports.json', async () => {
    const cellId = await makeCell('alice');
    await call('alice', 'writeFile', { cellId, path: 'client/main.ts', content: 'export {};' });
    await call('alice', 'writeFile', { cellId, path: 'client/imports.json', content: '{nope' });
    const res = await call('alice', 'deploy', { cellId });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/imports\.json/);
  });

  it('replaceInFile does targeted exact-string edits without resending the file', async () => {
    const cellId = await makeCell('alice');
    await call('alice', 'writeFile', { cellId, path: 'lib/u.ts', content: 'const a = 1;\nconst b = 1;\nexport { a, b };' });

    // First-occurrence by default, with ambiguity visible via `occurrences`.
    const first = await call<{ replacements: number; occurrences: number }>('alice', 'replaceInFile', {
      cellId, path: 'lib/u.ts', old_str: '= 1;', new_str: '= 2;',
    });
    expect(first.ok).toBe(true);
    expect(first.result!).toMatchObject({ replacements: 1, occurrences: 2 });
    expect((await call<{ content: string }>('alice', 'readFile', { cellId, path: 'lib/u.ts' })).result!.content)
      .toBe('const a = 2;\nconst b = 1;\nexport { a, b };');

    // replace_all, and empty new_str deletes.
    await call('alice', 'replaceInFile', { cellId, path: 'lib/u.ts', old_str: 'const ', new_str: 'let ', replace_all: true });
    await call('alice', 'replaceInFile', { cellId, path: 'lib/u.ts', old_str: '\nexport { a, b };', new_str: '' });
    expect((await call<{ content: string }>('alice', 'readFile', { cellId, path: 'lib/u.ts' })).result!.content)
      .toBe('let a = 2;\nlet b = 1;');

    // Not-found and ownership failures.
    const miss = await call('alice', 'replaceInFile', { cellId, path: 'lib/u.ts', old_str: 'nope', new_str: 'x' });
    expect(miss.ok).toBe(false);
    expect(miss.error).toMatch(/not found/);
    expect((await call('mallory', 'replaceInFile', { cellId, path: 'lib/u.ts', old_str: 'let', new_str: 'x' })).ok).toBe(false);

    // deploy:true fuses edit + rebuild (one round trip).
    const fused = await call<{ deploy: { deployed: boolean } }>('alice', 'replaceInFile', {
      cellId, path: 'index.ts', old_str: 'handler', new_str: 'handler', replace_all: true, deploy: true,
    });
    expect(fused.ok).toBe(true);
    expect(fused.result!.deploy.deployed).toBe(true);
  });

  it('appendToFile extends (or creates) a source file', async () => {
    const cellId = await makeCell('alice');
    await call('alice', 'appendToFile', { cellId, path: 'notes.md', content: '# notes' });
    await call('alice', 'appendToFile', { cellId, path: 'notes.md', content: '\nmore' });
    expect((await call<{ content: string }>('alice', 'readFile', { cellId, path: 'notes.md' })).result!.content)
      .toBe('# notes\nmore');
  });

  it('importSrc pulls a tarball into the src tree under a prefix (ownership-gated)', async () => {
    const cellId = await makeCell('alice');
    const { gzipSync } = await import('node:zlib');
    const { buildTar } = await import('./helpers/tar-fixture');
    const tarball = gzipSync(
      buildTar([
        { name: 'repo-main/src/main.ts', content: 'export const a = 1;' },
        { name: 'repo-main/src/lib/util.ts', content: 'export const b = 2;' },
        { name: 'repo-main/src/logo.png', content: 'binary!' }, // non-text → skipped
        { name: 'repo-main/README.md', content: 'outside include' }, // filtered by include
      ]),
    );
    const g = globalThis as { fetch?: unknown };
    const realFetch = g.fetch;
    g.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.byteLength) });
    try {
      const res = await call<{ imported: number; files: string[]; skippedBinary: number }>('alice', 'importSrc', {
        cellId,
        url: 'https://codeload.github.com/x/y/tar.gz/refs/heads/main',
        include: 'repo-main/src/',
        prefix: 'client/',
      });
      expect(res.ok).toBe(true);
      expect(res.result!.files.sort()).toEqual(['client/lib/util.ts', 'client/main.ts']);
      expect(res.result!.skippedBinary).toBe(1);
      // The files landed in the cell's src tree, readable like any other.
      const read = await call<{ content: string }>('alice', 'readFile', { cellId, path: 'client/lib/util.ts' });
      expect(read.result!.content).toBe('export const b = 2;');

      // http:// and non-owners are refused.
      expect((await call('alice', 'importSrc', { cellId, url: 'http://evil/x.tgz' })).ok).toBe(false);
      expect((await call('mallory', 'importSrc', { cellId, url: 'https://x/y.tgz' })).ok).toBe(false);
    } finally {
      g.fetch = realFetch;
    }
  });

  it('resolveBareImport maps npm specifiers to esm.sh, honouring the import map', () => {
    expect(resolveBareImport('yjs')).toBe('https://esm.sh/yjs');
    expect(resolveBareImport('yjs', { yjs: '13.6.27' })).toBe('https://esm.sh/yjs@13.6.27');
    expect(resolveBareImport('y-webrtc', { 'y-webrtc': 'https://esm.sh/y-webrtc@10.3.0' })).toBe(
      'https://esm.sh/y-webrtc@10.3.0',
    );
    // Subpaths ride along; scoped packages count as one name segment.
    expect(resolveBareImport('xstate/lib/interpreter', { xstate: '4.38.3' })).toBe(
      'https://esm.sh/xstate@4.38.3/lib/interpreter',
    );
    expect(resolveBareImport('@scope/pkg/sub')).toBe('https://esm.sh/@scope/pkg/sub');
    // Absolute URLs pass through untouched.
    expect(resolveBareImport('https://esm.sh/marked@12')).toBe('https://esm.sh/marked@12');
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

  it('base64 blobs under public/ get a web address and are served via the _data path', async () => {
    const created = await call<{ cellId: string }>('alice', 'create', { name: 'board', code: cellCode, public: true });
    const cellId = created.result!.cellId;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

    // Binary put: base64 in, bytes stored, web address handed back.
    const put = await call<{ bytes: number; url: string | null }>('alice', 'putData', {
      cellId, key: 'public/img/dot.png', content: png.toString('base64'), encoding: 'base64', contentType: 'image/png',
    });
    expect(put.ok).toBe(true);
    expect(put.result!.bytes).toBe(4);
    expect(put.result!.url).toBe(`/@alice/board/_data/alice/public/img/dot.png`);

    // Anonymous GET through the dispatch seam serves it raw from S3.
    const got = await call<{ statusCode: number; headers: Record<string, string>; body: string; isBase64Encoded: boolean }>(
      undefined, 'call', { cellId, method: 'GET', path: '/_data/alice/public/img/dot.png' },
    );
    expect(got.ok).toBe(true);
    expect(got.result!.statusCode).toBe(200);
    expect(got.result!.headers['content-type']).toBe('image/png');
    expect(got.result!.isBase64Encoded).toBe(true);
    expect(Buffer.from(got.result!.body, 'base64').equals(png)).toBe(true);

    // Missing blob → 404; outside public/ → never web-served (and no url).
    const missing = await call<{ statusCode: number }>(undefined, 'call', { cellId, method: 'GET', path: '/_data/alice/public/img/nope.png' });
    expect(missing.result!.statusCode).toBe(404);
    const priv = await call<{ url: string | null }>('alice', 'putData', { cellId, key: 'img/secret.png', content: 'x' });
    expect(priv.result!.url).toBeNull();
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

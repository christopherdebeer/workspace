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
        if (item) {
          if (':s' in ExpressionAttributeValues) item.status = ExpressionAttributeValues[':s'];
          if (':d' in ExpressionAttributeValues) item.deploy = ExpressionAttributeValues[':d'];
          if (':u' in ExpressionAttributeValues) item.updatedAt = ExpressionAttributeValues[':u'];
          if (':ld' in ExpressionAttributeValues) item.lastDeployed = ExpressionAttributeValues[':ld'];
        }
        return {};
      },
    }),
    query: ({ ExpressionAttributeValues }: { ExpressionAttributeValues: Record<string, unknown> }) => ({
      promise: async () => ({ Items: [...store.values()].filter((i) => i.pk === ExpressionAttributeValues[':pk']) }),
    }),
    scan: () => ({ promise: async () => ({ Items: [] }) }),
  };
}

/**
 * In-memory S3: keyed by `${Bucket}/${Key}`. Models what the versioned file
 * tools lean on: a per-write ETag, conditional PUT (`IfNoneMatch` param and
 * the raw `If-Match` header set in a `build` listener, both answered with a
 * 412 like S3), and the size/mtime a list returns.
 */
function memoryS3(): { store: Map<string, string | Buffer>; etags: Map<string, string> } & Record<string, unknown> {
  const store = new Map<string, string | Buffer>();
  const types = new Map<string, string>();
  const etags = new Map<string, string>();
  let generation = 0;
  const preconditionFailed = (): Error => {
    const e = new Error('At least one of the pre-conditions you specified did not hold') as Error & { code: string; statusCode: number };
    e.code = 'PreconditionFailed';
    e.statusCode = 412;
    return e;
  };
  return {
    store,
    etags,
    putObject: ({ Bucket, Key, Body, ContentType, IfNoneMatch }: { Bucket: string; Key: string; Body: string | Buffer; ContentType?: string; IfNoneMatch?: string }) => {
      const httpRequest = { headers: {} as Record<string, string> };
      const listeners: Array<() => void> = [];
      return {
        httpRequest,
        on: (event: string, fn: () => void) => { if (event === 'build') listeners.push(fn); },
        promise: async () => {
          for (const fn of listeners) fn();
          const k = `${Bucket}/${Key}`;
          if (IfNoneMatch === '*' && store.has(k)) throw preconditionFailed();
          const ifMatch = httpRequest.headers['If-Match'];
          if (ifMatch !== undefined && etags.get(k) !== ifMatch) throw preconditionFailed();
          store.set(k, Body);
          if (ContentType) types.set(k, ContentType);
          const etag = `"g${++generation}"`;
          etags.set(k, etag);
          return { ETag: etag };
        },
      };
    },
    getObject: ({ Bucket, Key }: { Bucket: string; Key: string }) => ({
      promise: async () => {
        const k = `${Bucket}/${Key}`;
        if (!store.has(k)) { const e = new Error('NoSuchKey') as Error & { code: string }; e.code = 'NoSuchKey'; throw e; }
        return { Body: store.get(k), ContentType: types.get(k), ETag: etags.get(k), LastModified: new Date(0) };
      },
    }),
    listObjectsV2: ({ Bucket, Prefix }: { Bucket: string; Prefix?: string }) => ({
      promise: async () => ({
        Contents: [...store.keys()]
          .filter((k) => k.startsWith(`${Bucket}/${Prefix ?? ''}`))
          .map((k) => ({ Key: k.slice(Bucket.length + 1), Size: Buffer.byteLength(store.get(k) as string | Buffer), ETag: etags.get(k) })),
        IsTruncated: false,
      }),
    }),
    deleteObject: ({ Bucket, Key }: { Bucket: string; Key: string }) => ({
      promise: async () => { store.delete(`${Bucket}/${Key}`); etags.delete(`${Bucket}/${Key}`); return {}; },
    }),
    // Server-side copy with S3's CopySourceIfMatch: a 412 if the source moved.
    copyObject: ({ Bucket, Key, CopySource, CopySourceIfMatch }: { Bucket: string; Key: string; CopySource: string; CopySourceIfMatch?: string }) => ({
      promise: async () => {
        const from = decodeURI(CopySource);
        if (!store.has(from)) { const e = new Error('NoSuchKey') as Error & { code: string }; e.code = 'NoSuchKey'; throw e; }
        if (CopySourceIfMatch !== undefined && etags.get(from) !== CopySourceIfMatch) throw preconditionFailed();
        const k = `${Bucket}/${Key}`;
        store.set(k, store.get(from) as string | Buffer);
        const t = types.get(from);
        if (t) types.set(k, t);
        etags.set(k, `"g${++generation}"`);
        return {};
      },
    }),
  };
}

let s3mem: ReturnType<typeof memoryS3>;
const updateCodeCalls: Array<{ FunctionName: string; S3Key: string }> = [];

interface CommandResult<T = unknown> { ok: boolean; result?: T; error?: string }
async function call<T = unknown>(user: string | undefined, command: string, payload: unknown): Promise<CommandResult<T>> {
  return (await forge({ __command: command, payload, user })) as CommandResult<T>;
}

/** Drive the async deploy end-to-end: kick it off, then run the event-driven
 *  worker (cell.deploy.requested → onDeployRequested) and return the terminal
 *  deploy state surfaced by `get`. */
async function deployAndRun(
  user: string,
  cellId: string,
): Promise<{ phase: string; version: string; error?: string }> {
  const started = await call<{ deploying: boolean }>(user, 'deploy', { cellId });
  expect(started.ok).toBe(true);
  expect(started.result!.deploying).toBe(true);
  await forge({ 'detail-type': 'cell.deploy.requested', source: 'cells', detail: { cellId } } as unknown as Parameters<typeof forge>[0]);
  const got = await call<{ deploy?: { phase: string; version: string; error?: string } }>(user, 'get', { cellId });
  return got.result!.deploy!;
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

  /**
   * A CELL COULD NOT SHIP AN IMAGE.
   *
   * Source files travel through the tools as JSON strings and were stored
   * `text/plain; charset=utf-8`, so every byte a PNG carries that is not valid
   * UTF-8 became U+FFFD. That does not merely corrupt the file, it INFLATES it:
   * measured on drive's icons, 19,203 bytes in and 34,465 bytes out, served
   * with a 200 and a content-type that still said image/png. The manifest and
   * icons were dead on that live cell from the day they landed, and nothing
   * caught it for months because the only symptom was a broken picture.
   *
   * The bytes are asserted at both ends AND in the middle: a round trip that
   * only checks read-after-write would pass while the DEPLOY still mangled it,
   * which is exactly where the last version of this failed.
   */
  it('a binary asset survives write, read and deploy byte-for-byte', async () => {
    const cellId = await makeCell('alice');
    // A real 1x1 PNG. Its IDAT carries 0x89, 0xC4, 0xFF — three bytes that are
    // not valid UTF-8 in any position, which is what makes it a fair witness.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    expect(png.subarray(0, 4).toString('latin1')).toBe('\x89PNG');

    const wrote = await call('alice', 'writeFile', {
      cellId, path: 'static/icon.png', content: png.toString('base64'), encoding: 'base64',
    });
    expect(wrote.ok).toBe(true);

    // READ gives the bytes back, and says so rather than leaving the caller to
    // guess — a caller that guesses wrong writes UTF-8 and undoes the fix.
    const read = await call<{ content: string; encoding?: string; contentType?: string }>(
      'alice', 'readFile', { cellId, path: 'static/icon.png' },
    );
    expect(read.result!.encoding).toBe('base64');
    expect(read.result!.contentType).toBe('image/png');
    expect(Buffer.from(read.result!.content, 'base64').equals(png)).toBe(true);

    // …and the DEPLOY carries them into the package. The zip is STORED (no
    // compression), so the file's bytes appear in it verbatim and can be found
    // with indexOf — if any stage had decoded them as UTF-8 they would not.
    const deploy = await deployAndRun('alice', cellId);
    expect(deploy.phase).toBe('DEPLOYED');
    const zip = s3mem.store.get(`code-bucket/cells/${cellId}/build/${deploy.version}.zip`) as Buffer;
    expect(zip.includes(png)).toBe(true);
    // The inflation is the signature of the old bug: assert it did NOT happen.
    expect(zip.includes(Buffer.from(png.toString('utf8'), 'utf8'))).toBe(false);
  });

  it('refuses content that is not the base64 it claims to be', async () => {
    const cellId = await makeCell('alice');
    // Buffer.from(s, 'base64') never throws — it stops at the first character
    // it cannot use and returns a SHORT buffer. Without the round-trip check a
    // typo lands as a truncated file that looks fine until something decodes it.
    const res = await call('alice', 'writeFile', {
      cellId, path: 'static/icon.png', content: 'not base64!!', encoding: 'base64',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not valid base64/i);
  });

  it('text files are unaffected — no encoding means what it always meant', async () => {
    const cellId = await makeCell('alice');
    const src = 'export const x = 1; // é — ünïcode survives as text\n';
    await call('alice', 'writeFile', { cellId, path: 'lib/util.ts', content: src });
    const read = await call<{ content: string; encoding?: string }>(
      'alice', 'readFile', { cellId, path: 'lib/util.ts' },
    );
    // Text reports itself as text now (every read carries its encoding), and
    // is never base64 — the one thing cell-sync's pull branches on.
    expect(read.result!.encoding).toBe('utf8');
    expect(read.result!.content).toBe(src);
  });

  it('rejects path traversal', async () => {
    const cellId = await makeCell('alice');
    const res = await call('alice', 'writeFile', { cellId, path: '../escape.ts', content: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid path/i);
  });

  it('deploy (async) bundles the src/ tree and points the cell Lambda at the new build', async () => {
    const cellId = await makeCell('alice');
    await call('alice', 'writeFile', { cellId, path: 'lib/util.ts', content: 'export const x = 1;' });

    const deploy = await deployAndRun('alice', cellId);
    expect(deploy.phase).toBe('DEPLOYED');

    // Lambda was repointed at cells/<id>/build/<version>.zip (the landed version).
    expect(updateCodeCalls).toHaveLength(1);
    expect(updateCodeCalls[0].S3Key).toBe(`cells/${cellId}/build/${deploy.version}.zip`);
    expect(s3mem.store.has(`code-bucket/cells/${cellId}/build/${deploy.version}.zip`)).toBe(true);
    // No client entry → server bundle only, no app.js in the package.
    const zip = (s3mem.store.get(`code-bucket/cells/${cellId}/build/${deploy.version}.zip`) as Buffer).toString('latin1');
    expect(zip).toContain('index.js');
    expect(zip).not.toContain('app.js');
  });

  it('deploy browser-bundles a client/ entry and ships static/ assets (the tier-2 clientEntry)', async () => {
    const cellId = await makeCell('alice');
    await call('alice', 'writeFile', { cellId, path: 'client/main.ts', content: 'document.title = "canvas";' });
    await call('alice', 'writeFile', { cellId, path: 'client/imports.json', content: '{"yjs":"13.6.27"}' });
    await call('alice', 'writeFile', { cellId, path: 'static/style.css', content: 'body{margin:0}' });

    const deploy = await deployAndRun('alice', cellId);
    expect(deploy.phase).toBe('DEPLOYED');

    // The package zip carries index.js + app.js + the static asset.
    const zipKey = [...s3mem.store.keys()].find((k) => k.includes('/build/'))!;
    const names = (s3mem.store.get(zipKey) as Buffer).toString('latin1');
    expect(names).toContain('index.js');
    expect(names).toContain('app.js');
    expect(names).toContain('static/style.css');
  });

  it('deploy records FAILED with the cause for a malformed client/imports.json', async () => {
    const cellId = await makeCell('alice');
    await call('alice', 'writeFile', { cellId, path: 'client/main.ts', content: 'export {};' });
    await call('alice', 'writeFile', { cellId, path: 'client/imports.json', content: '{nope' });
    const deploy = await deployAndRun('alice', cellId);
    expect(deploy.phase).toBe('FAILED');
    expect(deploy.error).toMatch(/imports\.json/);
  });

  it('replaceInFile does targeted exact-string edits without resending the file', async () => {
    const cellId = await makeCell('alice');
    await call('alice', 'writeFile', { cellId, path: 'lib/u.ts', content: 'const a = 1;\nconst b = 1;\nexport { a, b };' });

    // Ambiguity is refused BEFORE writing (expectedOccurrences defaults to 1)…
    const ambiguous = await call('alice', 'replaceInFile', { cellId, path: 'lib/u.ts', old_str: '= 1;', new_str: '= 2;' });
    expect(ambiguous.ok).toBe(false);
    expect(ambiguous.error).toMatch(/occurs 2 times.*expected 1.*lines 1, 2.*nothing was written/);
    expect((await call<{ content: string }>('alice', 'readFile', { cellId, path: 'lib/u.ts' })).result!.content)
      .toBe('const a = 1;\nconst b = 1;\nexport { a, b };');

    // …and matchIndex picks one deliberately.
    const first = await call<{ replacements: number; occurrences: number }>('alice', 'replaceInFile', {
      cellId, path: 'lib/u.ts', old_str: '= 1;', new_str: '= 2;', matchIndex: 0,
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

    // deploy:true fuses edit + async deploy kickoff (one round trip); the
    // DEPLOYING marker rides back on `deploy`, and the worker finishes it.
    const fused = await call<{ deploy: { phase: string } }>('alice', 'replaceInFile', {
      cellId, path: 'index.ts', old_str: 'handler', new_str: 'handler', replace_all: true, deploy: true,
    });
    expect(fused.ok).toBe(true);
    expect(fused.result!.deploy.phase).toBe('DEPLOYING');
  });

  describe('versioned, ranged source access', () => {
    type ReadResult = {
      content: string; encoding: string; version: string; bytes: number; lines: number;
      range?: { startLine: number; endLine: number; totalLines: number; offset?: number; length?: number };
      truncated?: boolean; nextStartLine?: number; nextOffset?: number;
    };
    const big = Array.from({ length: 5000 }, (_, i) => `line ${i + 1}: ${'x'.repeat(40)}`).join('\n') + '\n';

    it('readFile reports metadata and a sha256 version, and reads line ranges', async () => {
      const cellId = await makeCell('alice');
      await call('alice', 'writeFile', { cellId, path: 'client/main.ts', content: big });

      const whole = (await call<ReadResult>('alice', 'readFile', { cellId, path: 'client/main.ts' })).result!;
      expect(whole.content).toBe(big);
      expect(whole.version).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(whole.lines).toBe(5000);
      expect(whole.bytes).toBe(Buffer.byteLength(big));

      const r = (await call<ReadResult>('alice', 'readFile', { cellId, path: 'client/main.ts', startLine: 1200, endLine: 1202 })).result!;
      expect(r.content).toBe(`line 1200: ${'x'.repeat(40)}\nline 1201: ${'x'.repeat(40)}\nline 1202: ${'x'.repeat(40)}\n`);
      expect(r.range).toEqual({ startLine: 1200, endLine: 1202, totalLines: 5000 });
      expect(r.truncated).toBe(false);
      expect(r.nextStartLine).toBe(1203);
      expect(r.version).toBe(whole.version);

      // An open-ended range stops at the byte budget, on a line boundary, and
      // says where to continue — the thing whole:true could never do.
      const open = (await call<ReadResult>('alice', 'readFile', { cellId, path: 'client/main.ts', startLine: 1 })).result!;
      expect(Buffer.byteLength(open.content)).toBeLessThanOrEqual(48 * 1024);
      expect(open.content.endsWith('\n')).toBe(true);
      expect(open.nextStartLine).toBe(open.range!.endLine + 1);

      const tail = (await call<ReadResult>('alice', 'readFile', { cellId, path: 'client/main.ts', startLine: 4999 })).result!;
      expect(tail.range!.endLine).toBe(5000);
      expect(tail.nextStartLine).toBeUndefined();

      const bytes = (await call<ReadResult>('alice', 'readFile', { cellId, path: 'client/main.ts', offset: 0, length: 6 })).result!;
      expect(bytes.content).toBe('line 1');
      expect(bytes.nextOffset).toBe(6);

      const past = await call('alice', 'readFile', { cellId, path: 'client/main.ts', startLine: 9999 });
      expect(past.ok).toBe(false);
    });

    it('listFiles filters by prefix/glob, pages with a cursor, and reports metadata', async () => {
      const cellId = await makeCell('alice');
      for (const p of ['client/hydro/a.ts', 'client/hydro/b.ts', 'client/hydro/c.md', 'client/main.ts', 'README.md']) {
        await call('alice', 'writeFile', { cellId, path: p, content: `// ${p}\n` });
      }
      type Page = { files: string[]; total: number; count: number; totalBytes: number; nextCursor?: string };
      const hydro = (await call<Page>('alice', 'listFiles', { cellId, prefix: 'client/hydro/' })).result!;
      expect(hydro.files).toEqual(['client/hydro/a.ts', 'client/hydro/b.ts', 'client/hydro/c.md']);
      expect((await call<Page>('alice', 'listFiles', { cellId, glob: 'client/**/*.ts' })).result!.files)
        .toEqual(['client/hydro/a.ts', 'client/hydro/b.ts', 'client/main.ts']);
      expect((await call<Page>('alice', 'listFiles', { cellId, glob: '*.md' })).result!.files)
        .toEqual(['README.md', 'client/hydro/c.md']);

      const p1 = (await call<Page>('alice', 'listFiles', { cellId, limit: 4 })).result!;
      expect(p1).toMatchObject({ count: 4, total: 6 });
      const p2 = (await call<Page>('alice', 'listFiles', { cellId, limit: 4, cursor: p1.nextCursor })).result!;
      expect(p2.nextCursor).toBeUndefined();
      expect([...p1.files, ...p2.files]).toEqual(['README.md', 'client/hydro/a.ts', 'client/hydro/b.ts', 'client/hydro/c.md', 'client/main.ts', 'index.ts']);

      type Meta = { files: Array<{ path: string; bytes: number; lines: number; version: string; binary: boolean }> };
      const meta = (await call<Meta>('alice', 'listFiles', { cellId, prefix: 'client/main', view: 'meta' })).result!;
      const read = (await call<ReadResult>('alice', 'readFile', { cellId, path: 'client/main.ts' })).result!;
      expect(meta.files).toEqual([expect.objectContaining({ path: 'client/main.ts', lines: 1, binary: false, version: read.version, bytes: read.bytes })]);
    });

    it('searchFiles finds matches server-side, with context, skipping binaries, and pages', async () => {
      const cellId = await makeCell('alice');
      await call('alice', 'writeFile', { cellId, path: 'client/main.ts', content: big.replace('line 3001:', 'function setDepthOfField() {} // line 3001:') });
      await call('alice', 'writeFile', { cellId, path: 'client/dof.ts', content: 'import { setDepthOfField } from "./main";\n' });
      await call('alice', 'writeFile', { cellId, path: 'static/x.png', content: Buffer.from('setDepthOfField').toString('base64'), encoding: 'base64' });

      type Search = { matches: Array<{ path: string; line: number; column: number; text: string; before?: string[]; after?: string[] }>; searchedFiles: number; skippedBinary: number; truncated: boolean; nextCursor?: string };
      const res = (await call<Search>('alice', 'searchFiles', { cellId, query: 'setDepthOfField', contextLines: 1 })).result!;
      expect(res.matches.map((m) => [m.path, m.line])).toEqual([['client/dof.ts', 1], ['client/main.ts', 3001]]);
      expect(res.matches[1].column).toBe(10);
      expect(res.matches[1].before).toEqual([`line 3000: ${'x'.repeat(40)}`]);
      expect(res.skippedBinary).toBe(1);
      expect(res.truncated).toBe(false);

      const ci = (await call<Search>('alice', 'searchFiles', { cellId, query: 'SETDEPTH', caseSensitive: false, glob: 'client/main.ts' })).result!;
      expect(ci.matches).toHaveLength(1);
      const re = (await call<Search>('alice', 'searchFiles', { cellId, query: '^line 49\\d\\d:', regex: true, maxMatches: 60 })).result!;
      expect(re.matches).toHaveLength(60);
      expect(re.truncated).toBe(true);
      const more = (await call<Search>('alice', 'searchFiles', { cellId, query: '^line 49\\d\\d:', regex: true, maxMatches: 60, cursor: re.nextCursor })).result!;
      expect(more.matches[0].line).toBe(4960);
      expect(more.matches).toHaveLength(40);
      expect(more.truncated).toBe(false);

      expect((await call('alice', 'searchFiles', { cellId, query: '(', regex: true })).error).toMatch(/invalid regex/);
      expect((await call('mallory', 'searchFiles', { cellId, query: 'x' })).ok).toBe(false);
    });

    it('mutations honour ifVersion: a stale version conflicts and writes nothing', async () => {
      const cellId = await makeCell('alice');
      const wrote = (await call<{ version: string }>('alice', 'writeFile', { cellId, path: 'lib/u.ts', content: 'const a = 1;\n' })).result!;
      const v1 = wrote.version;
      expect((await call<ReadResult>('alice', 'readFile', { cellId, path: 'lib/u.ts' })).result!.version).toBe(v1);

      // Another agent edits the file…
      const other = (await call<{ version: string; previousVersion: string }>('alice', 'replaceInFile', {
        cellId, path: 'lib/u.ts', old_str: 'a = 1', new_str: 'a = 2', ifVersion: v1,
      })).result!;
      expect(other.previousVersion).toBe(v1);
      const v2 = other.version;

      // …so every mutation still holding v1 is refused, and the file is intact.
      for (const [cmd, extra] of [
        ['replaceInFile', { old_str: 'a = 2', new_str: 'a = 3' }],
        ['appendToFile', { content: '// more\n' }],
        ['writeFile', { content: 'clobbered' }],
        ['deleteFile', {}],
      ] as const) {
        const res = await call('alice', cmd, { cellId, path: 'lib/u.ts', ifVersion: v1, ...extra });
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/VERSION_CONFLICT.*expected sha256:.*found sha256:/);
      }
      const now = (await call<ReadResult>('alice', 'readFile', { cellId, path: 'lib/u.ts' })).result!;
      expect(now.content).toBe('const a = 2;\n');
      expect(now.version).toBe(v2);

      expect((await call('alice', 'deleteFile', { cellId, path: 'lib/u.ts', ifVersion: v2 })).ok).toBe(true);
    });

    it('a concurrent write between read and commit is a conflict, not a lost update', async () => {
      const cellId = await makeCell('alice');
      await call('alice', 'writeFile', { cellId, path: 'lib/u.ts', content: 'const a = 1;\n' });
      // Simulate a racing writer: bump the object's generation after the
      // edit's GET and before its PUT, by intercepting the next getObject.
      const s3 = s3mem as unknown as { getObject: (p: { Bucket: string; Key: string }) => { promise: () => Promise<unknown> } };
      const realGet = s3.getObject;
      s3.getObject = (p) => ({
        promise: async () => {
          const res = await realGet(p).promise();
          s3mem.etags.set(`${p.Bucket}/${p.Key}`, '"racer"');
          s3.getObject = realGet;
          return res;
        },
      });
      const res = await call('alice', 'replaceInFile', { cellId, path: 'lib/u.ts', old_str: 'a = 1', new_str: 'a = 2' });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/VERSION_CONFLICT.*concurrent write/);
    });

    it('ifAbsent / ifExists guard creation, and text edits refuse binary files', async () => {
      const cellId = await makeCell('alice');
      expect((await call('alice', 'writeFile', { cellId, path: 'new.ts', content: 'x', ifAbsent: true })).ok).toBe(true);
      const again = await call('alice', 'writeFile', { cellId, path: 'new.ts', content: 'y', ifAbsent: true });
      expect(again.error).toMatch(/VERSION_CONFLICT.*expected absent/);

      const typo = await call('alice', 'appendToFile', { cellId, path: 'nwe.ts', content: 'z', ifExists: true });
      expect(typo.error).toMatch(/not found/);
      expect((await call<{ files: string[] }>('alice', 'listFiles', { cellId })).result!.files).not.toContain('nwe.ts');

      await call('alice', 'writeFile', { cellId, path: 'static/x.png', content: Buffer.from([0x89, 0x50]).toString('base64'), encoding: 'base64' });
      expect((await call('alice', 'appendToFile', { cellId, path: 'static/x.png', content: 'oops' })).error).toMatch(/stored as bytes/);
      expect((await call('alice', 'replaceInFile', { cellId, path: 'static/x.png', old_str: 'P', new_str: 'Q' })).error).toMatch(/stored as bytes/);
    });

    it('replaceInFile dryRun shows the hunk and writes nothing; expectedOccurrences guards replace_all', async () => {
      const cellId = await makeCell('alice');
      await call('alice', 'writeFile', { cellId, path: 'lib/u.ts', content: 'a\nb\nupdateWater();\nc\nd\n' });
      type Dry = { dryRun: boolean; version: string; nextVersion: string; hunks: Array<{ line: number; before: string; after: string }> };
      const dry = (await call<Dry>('alice', 'replaceInFile', { cellId, path: 'lib/u.ts', old_str: 'updateWater();', new_str: 'updateWater(dt);\nsettle();', dryRun: true })).result!;
      expect(dry.hunks).toEqual([{ line: 3, before: 'a\nb\nupdateWater();\nc\nd', after: 'a\nb\nupdateWater(dt);\nsettle();\nc\nd' }]);
      expect((await call<ReadResult>('alice', 'readFile', { cellId, path: 'lib/u.ts' })).result!.version).toBe(dry.version);

      const wrong = await call('alice', 'replaceInFile', { cellId, path: 'lib/u.ts', old_str: '\n', new_str: '\r\n', replace_all: true, expectedOccurrences: 3 });
      expect(wrong.error).toMatch(/occurs 5 times in lib\/u.ts \(expected 3;/);
    });

    it('advertises the new parameters and result schemas (writeFile binary included)', async () => {
      type Tools = { tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown> }; resultSchema?: unknown }> };
      const { tools } = (await call<Tools>('alice', 'describeTools', {})).result!;
      const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
      expect(Object.keys(byName.writeFile.inputSchema.properties)).toEqual(expect.arrayContaining(['encoding', 'ifVersion', 'ifAbsent']));
      expect(Object.keys(byName.readFile.inputSchema.properties)).toEqual(expect.arrayContaining(['startLine', 'endLine', 'offset', 'length']));
      expect(Object.keys(byName.replaceInFile.inputSchema.properties)).toEqual(expect.arrayContaining(['expectedOccurrences', 'matchIndex', 'ifVersion', 'dryRun']));
      expect(byName.searchFiles).toBeDefined();
      for (const n of ['readFile', 'listFiles', 'searchFiles', 'writeFile', 'replaceInFile', 'appendToFile', 'deleteFile']) {
        expect(byName[n].resultSchema).toBeDefined();
      }
    });
  });

  describe('source tree: identity, patch sets, pinned deploys', () => {
    type Status = { treeVersion: string; files: number; dirty: boolean | null; deployed: { treeVersion?: string } | null; changedSinceDeploy?: Record<string, number> };
    type Patch = {
      ok: boolean; treeVersion: string; previousTreeVersion: string; snapshot?: string;
      conflicts?: Array<{ index: number; error: string }>; diff?: string;
      files: Array<{ path: string; status: string; added?: number; removed?: number; movedFrom?: string; movedTo?: string }>;
      deploy?: { phase: string; treeVersion: string; version: string };
    };
    const status = async (cellId: string): Promise<Status> => (await call<Status>('alice', 'status', { cellId })).result!;
    const read = async (cellId: string, path: string): Promise<string | undefined> =>
      (await call<{ content: string }>('alice', 'readFile', { cellId, path })).result?.content;
    /** Run the worker for a specific request, as EventBridge would deliver it. */
    const deliver = async (detail: Record<string, unknown>): Promise<void> => {
      await forge({ 'detail-type': 'cell.deploy.requested', source: 'cells', detail } as unknown as Parameters<typeof forge>[0]);
    };
    const zipOf = (cellId: string, version: string): string =>
      (s3mem.store.get(`code-bucket/cells/${cellId}/build/${version}.zip`) as Buffer).toString('latin1');

    it('treeVersion names the content: stable across rewrites of the same bytes, moves on any change', async () => {
      const cellId = await makeCell('alice');
      const t0 = await status(cellId);
      expect(t0.treeVersion).toMatch(/^tree:[0-9a-f]{64}$/);
      expect(t0.files).toBe(1);
      expect(t0.dirty).toBeNull();
      await call('alice', 'writeFile', { cellId, path: 'a.ts', content: 'x' });
      const t1 = await status(cellId);
      expect(t1.treeVersion).not.toBe(t0.treeVersion);
      await call('alice', 'writeFile', { cellId, path: 'a.ts', content: 'x' }); // new ETag, same bytes
      expect((await status(cellId)).treeVersion).toBe(t1.treeVersion);
      await call('alice', 'deleteFile', { cellId, path: 'a.ts' });
      expect((await status(cellId)).treeVersion).toBe(t0.treeVersion);
    });

    it('deploy builds the tree pinned at request time, not what src/ holds when the worker runs', async () => {
      const cellId = await makeCell('alice');
      await call('alice', 'writeFile', { cellId, path: 'client/main.ts', content: 'console.log("v1");' });
      const started = (await call<{ version: string; treeVersion: string }>('alice', 'deploy', { cellId })).result!;
      expect(started.treeVersion).toBe((await status(cellId)).treeVersion);

      // Another agent writes BEFORE the worker picks the event up…
      await call('alice', 'writeFile', { cellId, path: 'client/main.ts', content: 'console.log("v2");' });
      const builtFrom: string[] = [];
      __setEsbuild({
        initialize: async () => undefined,
        transform: async (code: string) => ({ code, warnings: [], map: '' }),
        build: async (opts: { stdin?: { contents?: string }; plugins?: Array<unknown> }) => {
          builtFrom.push(JSON.stringify(opts).includes('v2') ? 'v2' : 'v1');
          return { outputFiles: [{ text: '/*bundle*/' }], errors: [], warnings: [] };
        },
      } as unknown as Parameters<typeof __setEsbuild>[0]);
      await deliver({ cellId, version: started.version, treeVersion: started.treeVersion });

      // …and the build still reads the pinned snapshot: v1, never v2.
      const got = (await call<{ deploy: { phase: string; treeVersion: string }; lastDeployed: { treeVersion: string } }>('alice', 'get', { cellId })).result!;
      expect(got.deploy.phase).toBe('DEPLOYED');
      expect(got.lastDeployed.treeVersion).toBe(started.treeVersion);
      const snapKeys = [...s3mem.store.keys()].filter((k) => k.includes(`cells/${cellId}/snapshots/`));
      expect(snapKeys).toHaveLength(1);
      const manifest = JSON.parse(String(s3mem.store.get(snapKeys[0]))) as { files: Array<{ path: string; version: string }> };
      const mainBlob = manifest.files.find((f) => f.path === 'client/main.ts')!.version.slice(7);
      expect(String(s3mem.store.get(`code-bucket/cells/${cellId}/blobs/${mainBlob}`))).toBe('console.log("v1");');

      const st = await status(cellId);
      expect(st.dirty).toBe(true);
      expect(st.changedSinceDeploy).toEqual({ added: 0, modified: 1, deleted: 0 });
    });

    it('a redelivered or superseded deploy event never lands', async () => {
      const cellId = await makeCell('alice');
      const first = (await call<{ version: string; treeVersion: string }>('alice', 'deploy', { cellId })).result!;
      await new Promise((r) => setTimeout(r, 5));
      await call('alice', 'writeFile', { cellId, path: 'x.ts', content: 'export {};' });
      const second = (await call<{ version: string; treeVersion: string }>('alice', 'deploy', { cellId })).result!;
      expect(second.treeVersion).not.toBe(first.treeVersion);

      await deliver({ cellId, version: first.version, treeVersion: first.treeVersion }); // stale: superseded
      expect(updateCodeCalls).toHaveLength(0);
      await deliver({ cellId, version: second.version, treeVersion: second.treeVersion });
      expect(updateCodeCalls).toHaveLength(1);
      await deliver({ cellId, version: second.version, treeVersion: second.treeVersion }); // at-least-once redelivery
      expect(updateCodeCalls).toHaveLength(1);
      expect((await status(cellId)).deployed!.treeVersion).toBe(second.treeVersion);
    });

    it('deploy({treeVersion}) redeploys an older snapshot; an unknown tree is refused', async () => {
      const cellId = await makeCell('alice');
      const old = (await call<{ treeVersion: string }>('alice', 'snapshot', { cellId })).result!.treeVersion;
      await call('alice', 'writeFile', { cellId, path: 'static/late.txt', content: 'added after the snapshot' });
      const back = (await call<{ version: string; treeVersion: string }>('alice', 'deploy', { cellId, treeVersion: old })).result!;
      expect(back.treeVersion).toBe(old);
      await deliver({ cellId, version: back.version, treeVersion: back.treeVersion });
      expect(zipOf(cellId, back.version)).not.toContain('static/late.txt');
      const now = (await call<{ version: string; treeVersion: string }>('alice', 'deploy', { cellId })).result!;
      await deliver({ cellId, version: now.version, treeVersion: now.treeVersion });
      expect(zipOf(cellId, now.version)).toContain('static/late.txt');

      const bogus = await call('alice', 'deploy', { cellId, treeVersion: `tree:${'0'.repeat(64)}` });
      expect(bogus.error).toMatch(/TREE_CONFLICT/);
    });

    it('applyPatchSet dry run: every conflict at once, combined diff, projected treeVersion — nothing written', async () => {
      const cellId = await makeCell('alice');
      await call('alice', 'writeFile', { cellId, path: 'a.ts', content: 'const a = 1;\n' });
      await call('alice', 'writeFile', { cellId, path: 'b.ts', content: 'const b = 1;\n' });
      const before = await status(cellId);

      const bad = (await call<Patch>('alice', 'applyPatchSet', {
        cellId, dryRun: true,
        changes: [
          { op: 'replace', path: 'a.ts', old_str: 'a = 1', new_str: 'a = 2' },
          { op: 'replace', path: 'b.ts', old_str: 'nope', new_str: 'x' },
          { op: 'delete', path: 'missing.ts' },
        ],
      })).result!;
      expect(bad.ok).toBe(false);
      expect(bad.conflicts!.map((c) => c.index)).toEqual([1, 2]);

      const good = (await call<Patch>('alice', 'applyPatchSet', {
        cellId, dryRun: true, ifTreeVersion: before.treeVersion,
        changes: [
          { op: 'replace', path: 'a.ts', old_str: 'a = 1', new_str: 'a = 2' },
          { op: 'write', path: 'c.ts', content: 'export const c = 3;\n', ifAbsent: true },
          { op: 'move', from: 'b.ts', to: 'lib/b.ts' },
        ],
      })).result!;
      expect(good.ok).toBe(true);
      expect(good.previousTreeVersion).toBe(before.treeVersion);
      expect(good.diff).toContain('--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-const a = 1;\n+const a = 2;');
      expect(good.diff).toContain('--- /dev/null\n+++ b/c.ts\n@@ -0,0 +1,1 @@\n+export const c = 3;');
      expect(good.diff).toContain('--- a/b.ts\n+++ b/lib/b.ts\n(content unchanged)');
      expect(good.files.find((f) => f.path === 'b.ts')).toMatchObject({ status: 'D', movedTo: 'lib/b.ts' });
      expect((await status(cellId)).treeVersion).toBe(before.treeVersion);

      // The real run lands exactly the projected tree.
      const applied = (await call<Patch>('alice', 'applyPatchSet', {
        cellId, ifTreeVersion: before.treeVersion,
        changes: [
          { op: 'replace', path: 'a.ts', old_str: 'a = 1', new_str: 'a = 2' },
          { op: 'write', path: 'c.ts', content: 'export const c = 3;\n', ifAbsent: true },
          { op: 'move', from: 'b.ts', to: 'lib/b.ts' },
        ],
      })).result!;
      expect(applied.treeVersion).toBe(good.treeVersion);
      expect((await status(cellId)).treeVersion).toBe(good.treeVersion);
      expect(await read(cellId, 'lib/b.ts')).toBe('const b = 1;\n');
      expect(await read(cellId, 'b.ts')).toBeUndefined();
      expect(s3mem.store.has(`code-bucket/cells/${cellId}/tree/lock.json`)).toBe(false);
    });

    it('applyPatchSet is all-or-nothing: one bad change means zero files written', async () => {
      const cellId = await makeCell('alice');
      await call('alice', 'writeFile', { cellId, path: 'a.ts', content: 'const a = 1;\n' });
      const before = await status(cellId);
      const res = await call('alice', 'applyPatchSet', {
        cellId,
        changes: [
          { op: 'replace', path: 'a.ts', old_str: 'a = 1', new_str: 'a = 2' },
          { op: 'write', path: 'new.ts', content: 'x' },
          { op: 'replace', path: 'a.ts', old_str: 'not there', new_str: 'y' },
        ],
      });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/PATCH_REJECTED: 1 conflict\(s\) — nothing was written[\s\S]*\[2\] replace a\.ts: old_str not found/);
      expect((await status(cellId)).treeVersion).toBe(before.treeVersion);
      expect(await read(cellId, 'new.ts')).toBeUndefined();
    });

    it('ifTreeVersion refuses a patch set when an UNTOUCHED file moved since inspection', async () => {
      const cellId = await makeCell('alice');
      await call('alice', 'writeFile', { cellId, path: 'main.ts', content: 'main v1' });
      await call('alice', 'writeFile', { cellId, path: 'runtime.ts', content: 'runtime v1' });
      const inspected = (await status(cellId)).treeVersion;
      await call('alice', 'writeFile', { cellId, path: 'main.ts', content: 'main v2 (someone else)' });
      const res = await call('alice', 'applyPatchSet', {
        cellId, ifTreeVersion: inspected,
        changes: [{ op: 'replace', path: 'runtime.ts', old_str: 'v1', new_str: 'v2' }],
      });
      expect(res.error).toMatch(/^TREE_CONFLICT: expected tree:/);
      expect(await read(cellId, 'runtime.ts')).toBe('runtime v1');
    });

    it('a write that loses a race mid-commit rolls back the writes already made', async () => {
      const cellId = await makeCell('alice');
      await call('alice', 'writeFile', { cellId, path: 'a.ts', content: 'A1' });
      await call('alice', 'writeFile', { cellId, path: 'b.ts', content: 'B1' });
      // A racing writer bumps b.ts's generation just before the commit writes it.
      const s3 = s3mem as unknown as { putObject: (p: { Bucket: string; Key: string }) => unknown };
      const realPut = s3.putObject;
      s3.putObject = (p) => {
        if (p.Key.endsWith('/src/b.ts')) {
          s3mem.etags.set(`${p.Bucket}/${p.Key}`, '"racer"');
          s3.putObject = realPut;
        }
        return (realPut as (x: unknown) => unknown)(p);
      };
      const res = await call('alice', 'applyPatchSet', {
        cellId,
        changes: [
          { op: 'write', path: 'a.ts', content: 'A2' },
          { op: 'write', path: 'b.ts', content: 'B2' },
        ],
      });
      expect(res.error).toMatch(/^PATCH_ROLLED_BACK: .*b\.ts changed under the commit \(VERSION_CONFLICT\); restored 1 file/);
      expect(await read(cellId, 'a.ts')).toBe('A1');
      expect(s3mem.store.has(`code-bucket/cells/${cellId}/tree/lock.json`)).toBe(false);
    });

    it('a commit whose Lambda died is undone by the next lock holder (journal replay)', async () => {
      const cellId = await makeCell('alice');
      await call('alice', 'writeFile', { cellId, path: 'a.ts', content: 'BASE' });
      await call('alice', 'writeFile', { cellId, path: 'b.ts', content: 'untouched' });
      const v = (x: string): string => `sha256:${require('node:crypto').createHash('sha256').update(x).digest('hex')}`;
      // The dead commit had stored its base blob, written a.ts and created z.ts, then vanished.
      s3mem.store.set(`code-bucket/cells/${cellId}/blobs/${v('BASE').slice(7)}`, Buffer.from('BASE'));
      await call('alice', 'writeFile', { cellId, path: 'a.ts', content: 'HALF-COMMITTED' });
      await call('alice', 'writeFile', { cellId, path: 'z.ts', content: 'CREATED' });
      s3mem.store.set(`code-bucket/cells/${cellId}/tree/lock.json`, JSON.stringify({
        id: 'dead', holder: 'ghost', acquiredAt: new Date(0).toISOString(), expiresAt: new Date(1).toISOString(),
        journal: {
          base: { 'a.ts': v('BASE'), 'z.ts': null },
          next: { 'a.ts': v('HALF-COMMITTED'), 'z.ts': v('CREATED') },
          baseTypes: { 'a.ts': 'text/plain; charset=utf-8' },
        },
      }));
      s3mem.etags.set(`code-bucket/cells/${cellId}/tree/lock.json`, '"dead-lock"');

      const res = await call<Patch>('alice', 'applyPatchSet', { cellId, changes: [{ op: 'write', path: 'b.ts', content: 'next' }] });
      expect(res.ok).toBe(true);
      expect(await read(cellId, 'a.ts')).toBe('BASE');
      expect(await read(cellId, 'z.ts')).toBeUndefined();
      expect(await read(cellId, 'b.ts')).toBe('next');
    });

    it('a live lock makes a second patch set wait (LOCKED), not interleave', async () => {
      const cellId = await makeCell('alice');
      s3mem.store.set(`code-bucket/cells/${cellId}/tree/lock.json`, JSON.stringify({
        id: 'busy', holder: 'bob applyPatchSet', acquiredAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }));
      s3mem.etags.set(`code-bucket/cells/${cellId}/tree/lock.json`, '"busy"');
      const res = await call('alice', 'applyPatchSet', { cellId, changes: [{ op: 'write', path: 'a.ts', content: 'x' }] });
      expect(res.error).toMatch(/^LOCKED: another patch set \(bob applyPatchSet\)/);
      // Dry runs take no lock.
      expect((await call<Patch>('alice', 'applyPatchSet', { cellId, dryRun: true, changes: [{ op: 'write', path: 'a.ts', content: 'x' }] })).result!.ok).toBe(true);
    });

    it('applyPatchSet deploy:true deploys exactly the patched tree', async () => {
      const cellId = await makeCell('alice');
      const res = (await call<Patch>('alice', 'applyPatchSet', {
        cellId, deploy: true, changes: [{ op: 'write', path: 'static/hello.txt', content: 'hi' }],
      })).result!;
      expect(res.snapshot).toBe(res.treeVersion);
      expect(res.deploy!.treeVersion).toBe(res.treeVersion);
      await deliver({ cellId, version: res.deploy!.version, treeVersion: res.deploy!.treeVersion });
      expect(zipOf(cellId, res.deploy!.version)).toContain('static/hello.txt');
      expect((await status(cellId)).dirty).toBe(false);
    });

    it('moveFile renames atomically; refuses to clobber without overwrite', async () => {
      const cellId = await makeCell('alice');
      await call('alice', 'writeFile', { cellId, path: 'old/hud.ts', content: 'hud' });
      await call('alice', 'writeFile', { cellId, path: 'hud-deck.ts', content: 'deck' });
      expect((await call('alice', 'moveFile', { cellId, from: 'old/hud.ts', to: 'hud-deck.ts' })).error).toMatch(/move target exists/);
      const moved = (await call<Patch>('alice', 'moveFile', { cellId, from: 'old/hud.ts', to: 'client/hud.ts' })).result!;
      expect(moved.files.map((f) => [f.path, f.status])).toEqual([['client/hud.ts', 'A'], ['old/hud.ts', 'D']]);
      expect(await read(cellId, 'client/hud.ts')).toBe('hud');
      expect(await read(cellId, 'old/hud.ts')).toBeUndefined();
    });

    it('diff answers "what changed since deploy / since my snapshot" in summary, files and patch views', async () => {
      const cellId = await makeCell('alice');
      await call('alice', 'writeFile', { cellId, path: 'client/hydro/system.ts', content: 'a\nb\nc\n' });
      await call('alice', 'writeFile', { cellId, path: 'client/hydro/legacy.ts', content: 'old\n' });
      const snap = (await call<{ treeVersion: string }>('alice', 'snapshot', { cellId })).result!.treeVersion;
      expect((await call('alice', 'diff', { cellId })).error).toMatch(/no pinned deploy yet/);

      await call('alice', 'applyPatchSet', {
        cellId,
        changes: [
          { op: 'replace', path: 'client/hydro/system.ts', old_str: 'b\n', new_str: 'B\nB2\n' },
          { op: 'write', path: 'client/hydro/foam.ts', content: 'foam\n' },
          { op: 'delete', path: 'client/hydro/legacy.ts' },
          { op: 'write', path: 'README.md', content: 'r\n' },
        ],
      });
      type Diff = { identical: boolean; counts: Record<string, number>; lines: { added: number; removed: number }; files: Array<{ path: string; status: string; added: number; removed: number }>; patch?: string };
      const sum = (await call<Diff>('alice', 'diff', { cellId, from: snap, view: 'summary', prefix: 'client/hydro/' })).result!;
      expect(sum.counts).toEqual({ added: 1, modified: 1, deleted: 1, unchanged: 0 });
      expect(sum.lines).toEqual({ added: 3, removed: 2 });
      const files = (await call<Diff>('alice', 'diff', { cellId, from: snap })).result!;
      expect(files.files.map((f) => [f.status, f.path])).toEqual([
        ['A', 'README.md'], ['A', 'client/hydro/foam.ts'], ['D', 'client/hydro/legacy.ts'], ['M', 'client/hydro/system.ts'],
      ]);
      const patch = (await call<Diff>('alice', 'diff', { cellId, from: snap, view: 'patch', glob: 'client/hydro/system.ts', contextLines: 1 })).result!;
      expect(patch.patch).toBe('--- a/client/hydro/system.ts\n+++ b/client/hydro/system.ts\n@@ -1,3 +1,4 @@\n a\n-b\n+B\n+B2\n c\n');
      expect((await call<Diff>('alice', 'diff', { cellId, from: 'current', to: 'current' })).result!.identical).toBe(true);
    });

    it('readFiles assembles several files under one budget and says what it left out', async () => {
      const cellId = await makeCell('alice');
      await call('alice', 'writeFile', { cellId, path: 'types.ts', content: 'export type T = 1;\n' });
      await call('alice', 'writeFile', { cellId, path: 'system.ts', content: Array.from({ length: 400 }, (_, i) => `// line ${i + 1} ${'y'.repeat(20)}`).join('\n') + '\n' });
      await call('alice', 'writeFile', { cellId, path: 'shaders.ts', content: 'export const s = "";\n' });
      type Files = { files: Array<{ path: string; content?: string; version?: string; truncated?: boolean; nextStartLine?: number; omitted?: boolean; error?: string; range?: { startLine: number; endLine: number } }>; used: number; budget: number };
      const res = (await call<Files>('alice', 'readFiles', {
        cellId, maxBytes: 4096,
        files: [{ path: 'types.ts' }, { path: 'system.ts', startLine: 10 }, { path: 'shaders.ts' }, { path: 'nope.ts' }],
      })).result!;
      expect(res.files[0]).toMatchObject({ path: 'types.ts', content: 'export type T = 1;\n', version: expect.stringMatching(/^sha256:/) });
      expect(res.files[1]).toMatchObject({ path: 'system.ts', truncated: true, range: { startLine: 10 } });
      expect(res.files[1].nextStartLine).toBe(res.files[1].range!.endLine + 1);
      expect(res.files[2]).toMatchObject({ path: 'shaders.ts', omitted: true });
      expect(res.files[3]).toEqual({ path: 'nope.ts', error: 'not found' });
      expect(res.used).toBeLessThanOrEqual(res.budget);
    });
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
    // Public blobs are anonymous-readable by construction, so the CORS grant
    // discloses nothing — and a module import() of a vendored script blob
    // (home's three bundle) from a cell-subdomain origin requires it.
    expect(got.result!.headers['access-control-allow-origin']).toBe('*');
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

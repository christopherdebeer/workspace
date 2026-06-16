/**
 * Phase 4 — caller-write delegation (the write twin of the SSR read-proxy).
 *
 * Drives the real `dispatch` handler end-to-end with the peer-invoke Lambda
 * stubbed for `auth.validateToken` (identity + scope), `cells.call` (which
 * returns the `x-parc-writes` header a cell would set), `cells.callerWritesFor`
 * (the declared manifest), and `workspace.remember` (the act target). Asserts
 * the three guards: scope(caller, write), declared-prefix/type bound, and
 * reserved-namespace refusal — plus that the request header never leaks through.
 */
import { handler as dispatch } from '../services/dispatch/service';
import { __setLambda } from '../platform/runtime/service-client';
import type { FunctionUrlEvent, FunctionUrlResponse } from '../platform/runtime';

interface RememberCall {
  key: string;
  value: unknown;
  type?: string;
  tags?: string[];
  via?: string;
  owner?: string;
}

let remembered: RememberCall[] = [];
let writeHeader: string | undefined; // what cells.call echoes as `x-parc-writes`
let manifest: Array<{ keyPrefix: string; types?: string[]; crossSlice?: boolean }> = [];
// Owners for which workspace.remember rejects with grant_denied (simulating
// requireWriteThrough: the caller holds no write-grant on that slice).
let writeThroughDenied = new Set<string>();

function stub(tokens: Record<string, { userId: string; scope: string }>): void {
  __setLambda({
    invoke: (params: { FunctionName: string; Payload: string }) => {
      const env = JSON.parse(params.Payload) as { __command: string; payload: Record<string, unknown> };
      let result: unknown = null;
      if (params.FunctionName === 'auth-fn' && env.__command === 'validateToken') {
        result = tokens[env.payload.token as string] ?? null;
      } else if (params.FunctionName === 'cells-fn' && env.__command === 'call') {
        result = {
          statusCode: 200,
          headers: { 'content-type': 'text/html', ...(writeHeader !== undefined ? { 'x-parc-writes': writeHeader } : {}) },
          body: '<h1>ok</h1>',
        };
      } else if (params.FunctionName === 'cells-fn' && env.__command === 'callerWritesFor') {
        result = { writes: manifest };
      } else if (params.FunctionName === 'workspace-fn' && env.__command === 'remember') {
        const p = env.payload as unknown as RememberCall;
        if (p.owner && writeThroughDenied.has(p.owner)) {
          return {
            promise: async () => ({
              Payload: JSON.stringify({ ok: false, error: `grant_denied: no write grant from "${p.owner}"` }),
            }),
          };
        }
        remembered.push(p);
        result = { value: p.value, _meta: { revision: 1 } };
      }
      return { promise: async () => ({ Payload: JSON.stringify({ ok: true, result }) }) };
    },
  } as unknown as Parameters<typeof __setLambda>[0]);
}

function event(method: string, path: string, headers: Record<string, string>, body?: unknown): FunctionUrlEvent {
  return {
    rawPath: path,
    requestContext: { http: { method, path } },
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    isBase64Encoded: false,
  };
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe('dispatch caller-write delegation (Phase 4)', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'dispatch';
    process.env.SERVICE_REGISTRY = JSON.stringify({ auth: 'auth-fn', cells: 'cells-fn', workspace: 'workspace-fn' });
    remembered = [];
    writeHeader = undefined;
    manifest = [];
    writeThroughDenied = new Set();
    stub({
      writer: { userId: 'alice', scope: 'workspace:write' },
      reader: { userId: 'bob', scope: 'workspace:read' },
      granular: { userId: 'carol', scope: 'write:workspace' },
    });
  });
  afterEach(() => {
    __setLambda(undefined);
    delete process.env.SERVICE_REGISTRY;
  });

  it('applies a declared write as the caller and strips the request header', async () => {
    manifest = [{ keyPrefix: 'notes/' }];
    writeHeader = JSON.stringify([{ key: 'notes/1', value: { t: 'hi' }, type: 'note' }]);
    const res = (await dispatch(event('POST', '/@dave/blog', bearer('writer'), { v: 1 }))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(remembered).toEqual([{ key: 'notes/1', value: { t: 'hi' }, type: 'note', via: '@dave/blog' }]);
    expect(res.headers['x-parc-writes-applied']).toBe('1');
    expect(res.headers['x-parc-writes']).toBeUndefined();
  });

  it('honours a granular write:workspace token too', async () => {
    manifest = [{ keyPrefix: 'notes/' }];
    writeHeader = JSON.stringify([{ key: 'notes/1', value: 1 }]);
    await dispatch(event('POST', '/@dave/blog', bearer('granular')));
    expect(remembered).toHaveLength(1);
  });

  it('denies the whole batch for a read-only caller (remember never called)', async () => {
    manifest = [{ keyPrefix: 'notes/' }];
    writeHeader = JSON.stringify([{ key: 'notes/1', value: 1 }]);
    const res = (await dispatch(event('POST', '/@dave/blog', bearer('reader')))) as FunctionUrlResponse;
    expect(remembered).toHaveLength(0);
    expect(res.headers['x-parc-writes-denied']).toBe('scope');
    expect(res.headers['x-parc-writes']).toBeUndefined();
  });

  it('refuses an undeclared key prefix', async () => {
    manifest = [{ keyPrefix: 'notes/' }];
    writeHeader = JSON.stringify([{ key: 'secrets/1', value: 1 }]);
    const res = (await dispatch(event('POST', '/@dave/blog', bearer('writer')))) as FunctionUrlResponse;
    expect(remembered).toHaveLength(0);
    expect(res.headers['x-parc-writes-applied']).toBe('0');
    expect(res.headers['x-parc-writes-refused']).toBe('1');
  });

  it('refuses a reserved namespace even when a broad prefix is declared', async () => {
    manifest = [{ keyPrefix: '_' }];
    writeHeader = JSON.stringify([{ key: '_actions/evil', value: 1 }]);
    await dispatch(event('POST', '/@dave/blog', bearer('writer')));
    expect(remembered).toHaveLength(0);
  });

  it('enforces the declared type bound', async () => {
    manifest = [{ keyPrefix: 'notes/', types: ['note'] }];
    writeHeader = JSON.stringify([{ key: 'notes/1', value: 1, type: 'todo' }]);
    await dispatch(event('POST', '/@dave/blog', bearer('writer')));
    expect(remembered).toHaveLength(0);
  });

  it('writes nothing (and strips the header) for an anonymous caller', async () => {
    manifest = [{ keyPrefix: 'notes/' }];
    writeHeader = JSON.stringify([{ key: 'notes/1', value: 1 }]);
    const res = (await dispatch(event('GET', '/@dave/blog', {}))) as FunctionUrlResponse;
    expect(remembered).toHaveLength(0);
    expect(res.headers['x-parc-writes']).toBeUndefined();
    expect(res.headers['x-parc-writes-applied']).toBeUndefined();
  });

  it('caps the batch at 16 writes', async () => {
    manifest = [{ keyPrefix: 'notes/' }];
    writeHeader = JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ key: `notes/${i}`, value: i })));
    const res = (await dispatch(event('POST', '/@dave/blog', bearer('writer')))) as FunctionUrlResponse;
    expect(remembered).toHaveLength(16);
    expect(res.headers['x-parc-writes-applied']).toBe('16');
  });

  it('does not fetch the manifest or write when the cell sets no header', async () => {
    const res = (await dispatch(event('GET', '/@dave/blog', bearer('writer')))) as FunctionUrlResponse;
    expect(remembered).toHaveLength(0);
    expect(res.headers['x-parc-writes-applied']).toBeUndefined();
  });

  describe('cross-slice write-through (Phase 4 v2)', () => {
    it('applies a cross-slice write when declared and granted (owner forwarded)', async () => {
      manifest = [{ keyPrefix: 'shared/', crossSlice: true }];
      writeHeader = JSON.stringify([{ key: 'shared/1', value: { ok: true }, owner: 'bob' }]);
      const res = (await dispatch(event('POST', '/@dave/blog', bearer('writer')))) as FunctionUrlResponse;
      expect(remembered).toEqual([{ key: 'shared/1', value: { ok: true }, owner: 'bob', via: '@dave/blog' }]);
      expect(res.headers['x-parc-writes-applied']).toBe('1');
    });

    it('refuses a cross-slice write the manifest did not opt into', async () => {
      manifest = [{ keyPrefix: 'shared/' }]; // no crossSlice
      writeHeader = JSON.stringify([{ key: 'shared/1', value: 1, owner: 'bob' }]);
      const res = (await dispatch(event('POST', '/@dave/blog', bearer('writer')))) as FunctionUrlResponse;
      expect(remembered).toHaveLength(0);
      expect(res.headers['x-parc-writes-refused']).toBe('1');
    });

    it('refuses a declared cross-slice write when the caller holds no grant (requireWriteThrough)', async () => {
      manifest = [{ keyPrefix: 'shared/', crossSlice: true }];
      writeThroughDenied = new Set(['carol']);
      writeHeader = JSON.stringify([{ key: 'shared/1', value: 1, owner: 'carol' }]);
      const res = (await dispatch(event('POST', '/@dave/blog', bearer('writer')))) as FunctionUrlResponse;
      expect(remembered).toHaveLength(0);
      expect(res.headers['x-parc-writes-applied']).toBe('0');
      expect(res.headers['x-parc-writes-refused']).toBe('1');
    });

    it('treats owner === caller as an own-slice write (no owner forwarded, no crossSlice needed)', async () => {
      manifest = [{ keyPrefix: 'notes/' }]; // no crossSlice
      writeHeader = JSON.stringify([{ key: 'notes/1', value: 1, owner: 'alice' }]); // writer === alice
      await dispatch(event('POST', '/@dave/blog', bearer('writer')));
      expect(remembered).toEqual([{ key: 'notes/1', value: 1, via: '@dave/blog' }]);
    });
  });
});

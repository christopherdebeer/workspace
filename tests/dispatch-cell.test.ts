/**
 * dispatch cell — userland HTTP ingress (`/@<owner>/<cell>`).
 *
 * Drives the real `dispatch` handler through the runtime HTTP path with the
 * peer-invoke Lambda stubbed for both `auth.validateToken` (identity) and
 * `forge.callCell` (the proxy target) — asserting it parses `/@owner/name/sub`,
 * forwards owner/name/method/path to forge, requires authentication, and 404s on
 * a malformed path.
 */
import { handler as dispatch } from '../services/dispatch/service';
import { __setLambda } from '../platform/runtime/service-client';
import type { FunctionUrlEvent, FunctionUrlResponse } from '../platform/runtime';

interface CallCellPayload {
  owner: string;
  name: string;
  method: string;
  path: string;
  query?: string;
  body?: unknown;
}

let lastCallCell: CallCellPayload | undefined;
let callCellResult: unknown;

/** Override what the stubbed cells.call returns (per test). */
function stubCallCellResult(result: unknown): void {
  callCellResult = result;
}

function stub(tokens: Record<string, { userId: string; scope: string }>): void {
  __setLambda({
    invoke: (params: { FunctionName: string; Payload: string }) => {
      const env = JSON.parse(params.Payload) as { __command: string; payload: Record<string, unknown> };
      let result: unknown = null;
      if (params.FunctionName === 'auth-fn' && env.__command === 'validateToken') {
        result = tokens[env.payload.token as string] ?? null;
      } else if (params.FunctionName === 'cells-fn' && env.__command === 'call') {
        lastCallCell = env.payload as unknown as CallCellPayload;
        result = callCellResult ?? { statusCode: 200, body: { echoed: env.payload.name } };
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

describe('dispatch cell (/@owner/cell)', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'dispatch';
    process.env.SERVICE_REGISTRY = JSON.stringify({ auth: 'auth-fn', cells: 'cells-fn' });
    lastCallCell = undefined;
    callCellResult = undefined;
    stub({ good: { userId: 'alice', scope: 'workspace:read' } });
  });
  afterEach(() => {
    __setLambda(undefined);
    delete process.env.SERVICE_REGISTRY;
  });

  it('routes /@alice/notes/items to cells.call with parsed owner/name/path', async () => {
    const res = (await dispatch(
      event('POST', '/@alice/notes/items', bearer('good'), { v: 1 }),
    )) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(lastCallCell).toEqual({
      owner: 'alice',
      name: 'notes',
      method: 'POST',
      path: '/items',
      query: '',
      body: { v: 1 },
    });
    expect(JSON.parse(res.body)).toEqual({ echoed: 'notes' });
  });

  it('defaults the cell-relative path to / when none is given', async () => {
    await dispatch(event('GET', '/@alice/notes', bearer('good')));
    expect(lastCallCell?.path).toBe('/');
  });

  it('401s a write without a bearer token (never reaches cells.call)', async () => {
    const res = (await dispatch(event('POST', '/@alice/notes', {}, { v: 1 }))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(401);
    expect(lastCallCell).toBeUndefined();
  });

  it('lets an anonymous GET through to cells.call (public-cell gate lives there)', async () => {
    const res = (await dispatch(event('GET', '/@alice/notes', {}))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(lastCallCell).toMatchObject({ owner: 'alice', name: 'notes', method: 'GET' });
  });

  it("passes the cell's response headers and encoding through (web-facing cells)", async () => {
    stubCallCellResult({
      statusCode: 200,
      headers: { 'content-type': 'text/html' },
      body: '<!doctype html><h1>parcland</h1>',
    });
    const res = (await dispatch(event('GET', '/@alice/notes', bearer('good')))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html');
    expect(res.body).toBe('<!doctype html><h1>parcland</h1>');
  });

  it('404s on a path that is not /@owner/cell', async () => {
    const res = (await dispatch(event('GET', '/@alice', bearer('good')))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(404);
  });

  it('apex / routes to the default cell when DISPATCH_DEFAULT_CELL is set (home demotion)', async () => {
    process.env.DISPATCH_DEFAULT_CELL = 'c15r/home';
    try {
      // anonymous GET of the bare apex — the exact request that 404'd in the incident
      const res = (await dispatch(event('GET', '/', {}))) as FunctionUrlResponse;
      expect(res.statusCode).toBe(200);
      expect(lastCallCell).toMatchObject({ owner: 'c15r', name: 'home', method: 'GET', path: '/' });
      // an apex asset path forwards too (cell-relative path preserved)
      await dispatch(event('GET', '/some-asset.css', {}));
      expect(lastCallCell).toMatchObject({ owner: 'c15r', name: 'home', path: '/some-asset.css' });
    } finally {
      delete process.env.DISPATCH_DEFAULT_CELL;
    }
  });

  it('apex / still 404s when no default cell is configured (no behaviour change without demotion)', async () => {
    const res = (await dispatch(event('GET', '/', {}))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(404);
    expect(lastCallCell).toBeUndefined();
  });
});

import { selectSsrReads } from '../services/dispatch/service';

describe('selectSsrReads — path scoping + semantic param validation (ADR-0020)', () => {
  const reads = [
    { as: 'root', target: 'workspace.recall', paths: ['/'] },
    {
      as: 'machine',
      target: 'workspace.query',
      input: { prefix: 'machine/${slug}/node/' },
      paths: ['/m/:slug'],
      where: { slug: '[a-z0-9-]+' },
    },
  ];

  it('root-only read applies at apex, not on a deep link', () => {
    expect(selectSsrReads(reads, '/').map((r) => r.as)).toEqual(['root']);
    expect(selectSsrReads(reads, '/m/my-machine').map((r) => r.as)).toEqual(['machine']);
  });

  it('substitutes a valid param into the read input', () => {
    const [m] = selectSsrReads(reads, '/m/my-machine');
    expect(m.input).toEqual({ prefix: 'machine/my-machine/node/' });
  });

  it('rejects a param that fails its `where` constraint — no doomed read is selected', () => {
    // upper-case + space violates [a-z0-9-]+ → the machine read does not apply
    expect(selectSsrReads(reads, '/m/Not A Slug')).toEqual([]);
  });

  it('a read without `where` stays unconstrained (backward compatible)', () => {
    const loose = [{ as: 'm', target: 'workspace.query', input: { p: '${slug}' }, paths: ['/m/:slug'] }];
    expect(selectSsrReads(loose, '/m/ANYTHING').map((r) => r.as)).toEqual(['m']);
  });

  it('a malformed author regex falls back to permissive (never breaks SSR)', () => {
    const bad = [{ as: 'm', target: 'workspace.query', paths: ['/m/:slug'], where: { slug: '[' } }];
    expect(selectSsrReads(bad, '/m/whatever').map((r) => r.as)).toEqual(['m']);
  });
});

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
  body?: unknown;
}

let lastCallCell: CallCellPayload | undefined;

function stub(tokens: Record<string, { userId: string; scope: string }>): void {
  __setLambda({
    invoke: (params: { FunctionName: string; Payload: string }) => {
      const env = JSON.parse(params.Payload) as { __command: string; payload: Record<string, unknown> };
      let result: unknown = null;
      if (params.FunctionName === 'auth-fn' && env.__command === 'validateToken') {
        result = tokens[env.payload.token as string] ?? null;
      } else if (params.FunctionName === 'forge-fn' && env.__command === 'callCell') {
        lastCallCell = env.payload as unknown as CallCellPayload;
        result = { statusCode: 200, body: { echoed: env.payload.name } };
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
    process.env.SERVICE_REGISTRY = JSON.stringify({ auth: 'auth-fn', forge: 'forge-fn' });
    lastCallCell = undefined;
    stub({ good: { userId: 'alice', scope: 'workspace:read' } });
  });
  afterEach(() => {
    __setLambda(undefined);
    delete process.env.SERVICE_REGISTRY;
  });

  it('routes /@alice/notes/items to forge.callCell with parsed owner/name/path', async () => {
    const res = (await dispatch(
      event('POST', '/@alice/notes/items', bearer('good'), { v: 1 }),
    )) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(lastCallCell).toEqual({
      owner: 'alice',
      name: 'notes',
      method: 'POST',
      path: '/items',
      body: { v: 1 },
    });
    expect(JSON.parse(res.body)).toEqual({ echoed: 'notes' });
  });

  it('defaults the cell-relative path to / when none is given', async () => {
    await dispatch(event('GET', '/@alice/notes', bearer('good')));
    expect(lastCallCell?.path).toBe('/');
  });

  it('401s without a bearer token', async () => {
    const res = (await dispatch(event('GET', '/@alice/notes', {}))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(401);
    expect(lastCallCell).toBeUndefined();
  });

  it('404s on a path that is not /@owner/cell', async () => {
    const res = (await dispatch(event('GET', '/@alice', bearer('good')))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(404);
  });
});

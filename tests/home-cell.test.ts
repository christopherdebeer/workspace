/**
 * Home cell server contract: serves the SPA shell at `/` and the client bundle
 * at `/app.js`, and the live platform catalog at `/_catalog` — static tier-1
 * manifests merged with the caller's tier-2 dynamic cells (resolved from the
 * bearer and fetched from forge). (The browser bundle itself is built by esbuild
 * at deploy time; here we assert routing/headers, the no-bundle fallback, and
 * the per-caller catalog merge with the peer-invoke Lambda stubbed.)
 */
import { handler as home } from '../services/home/service';
import { __setLambda } from '../platform/runtime/service-client';
import type { FunctionUrlEvent, FunctionUrlResponse } from '../platform/runtime';

interface ValidatedToken {
  userId: string;
  scope: string;
  clientId: string | null;
}

let lastForgeCall: { command: string; payload: unknown } | undefined;

/** Stub auth.validateToken (identity) and forge.catalogCells (dynamic cells). */
function stub(tokens: Record<string, ValidatedToken>, cells: unknown[]): void {
  __setLambda({
    invoke: (params: { FunctionName: string; Payload: string }) => {
      const env = JSON.parse(params.Payload) as { __command: string; payload: Record<string, unknown> };
      let result: unknown = null;
      if (params.FunctionName === 'auth-fn' && env.__command === 'validateToken') {
        result = tokens[env.payload.token as string] ?? null;
      } else if (params.FunctionName === 'forge-fn' && env.__command === 'catalogCells') {
        lastForgeCall = { command: env.__command, payload: env.payload };
        result = { cells };
      }
      return { promise: async () => ({ Payload: JSON.stringify({ ok: true, result }) }) };
    },
  } as unknown as Parameters<typeof __setLambda>[0]);
}

function httpEvent(method: string, path: string, headers: Record<string, string> = {}): FunctionUrlEvent {
  return { rawPath: path, requestContext: { http: { method, path } }, headers, isBase64Encoded: false };
}

describe('home cell', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'home';
    lastForgeCall = undefined;
  });
  afterEach(() => {
    __setLambda(undefined);
    delete process.env.PLATFORM_CATALOG;
    delete process.env.SERVICE_REGISTRY;
  });

  it('serves the SPA shell at /', async () => {
    const res = (await home(httpEvent('GET', '/'))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<div id="root">');
    expect(res.body).toContain('/app.js');
  });

  it('serves the client bundle at /app.js as javascript', async () => {
    const res = (await home(httpEvent('GET', '/app.js'))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(typeof res.body).toBe('string');
  });

  it('serves the injected static catalog at /_catalog with no dynamic cells when anonymous', async () => {
    process.env.PLATFORM_CATALOG = JSON.stringify([{ name: 'home', routes: [], commands: [] }]);
    const res = (await home(httpEvent('GET', '/_catalog'))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      services: [{ name: 'home', routes: [], commands: [] }],
      cells: [],
    });
    // No identity → forge is never consulted.
    expect(lastForgeCall).toBeUndefined();
  });

  it('merges the caller\'s dynamic cells into /_catalog when authenticated', async () => {
    process.env.PLATFORM_CATALOG = JSON.stringify([{ name: 'home', routes: [], commands: [] }]);
    process.env.SERVICE_REGISTRY = JSON.stringify({ auth: 'auth-fn', forge: 'forge-fn' });
    const cell = {
      name: 'notes',
      owner: 'alice',
      address: '/@alice/notes',
      status: 'ACTIVE',
      description: null,
      shared: false,
    };
    stub({ tok: { userId: 'alice', scope: 'workspace:read', clientId: null } }, [cell]);

    const res = (await home(httpEvent('GET', '/_catalog', { authorization: 'Bearer tok' }))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { services: unknown[]; cells: unknown[] };
    expect(body.services).toEqual([{ name: 'home', routes: [], commands: [] }]);
    expect(body.cells).toEqual([cell]);
    expect(lastForgeCall?.command).toBe('catalogCells');
  });

  it('keeps /_catalog usable when forge is unavailable', async () => {
    process.env.PLATFORM_CATALOG = JSON.stringify([{ name: 'home', routes: [], commands: [] }]);
    process.env.SERVICE_REGISTRY = JSON.stringify({ auth: 'auth-fn', forge: 'forge-fn' });
    __setLambda({
      invoke: (params: { FunctionName: string; Payload: string }) => {
        const env = JSON.parse(params.Payload) as { __command: string };
        if (params.FunctionName === 'auth-fn' && env.__command === 'validateToken') {
          return {
            promise: async () => ({
              Payload: JSON.stringify({ ok: true, result: { userId: 'alice', scope: '', clientId: null } }),
            }),
          };
        }
        // forge.catalogCells fails
        return { promise: async () => ({ Payload: JSON.stringify({ ok: false, error: 'boom' }) }) };
      },
    } as unknown as Parameters<typeof __setLambda>[0]);

    const res = (await home(httpEvent('GET', '/_catalog', { authorization: 'Bearer tok' }))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      services: [{ name: 'home', routes: [], commands: [] }],
      cells: [],
    });
  });

  it('404s an unknown path', async () => {
    const res = (await home(httpEvent('GET', '/nope'))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(404);
  });
});

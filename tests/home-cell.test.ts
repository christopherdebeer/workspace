/**
 * Home cell server contract: serves the SPA shell at `/` and the client bundle
 * at `/app.js`. (The browser bundle itself is built by esbuild at deploy time;
 * here we assert the routing/headers and the graceful no-bundle fallback.)
 */
import { handler as home } from '../services/home/service';
import type { FunctionUrlEvent, FunctionUrlResponse } from '../platform/runtime';

function httpEvent(method: string, path: string): FunctionUrlEvent {
  return { rawPath: path, requestContext: { http: { method, path } }, headers: {}, isBase64Encoded: false };
}

describe('home cell', () => {
  beforeEach(() => {
    process.env.SERVICE_NAME = 'home';
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

  it('serves the injected platform catalog at /_catalog', async () => {
    process.env.PLATFORM_CATALOG = JSON.stringify([{ name: 'home', routes: [], commands: [] }]);
    const res = (await home(httpEvent('GET', '/_catalog'))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ services: [{ name: 'home', routes: [], commands: [] }] });
    delete process.env.PLATFORM_CATALOG;
  });

  it('404s an unknown path', async () => {
    const res = (await home(httpEvent('GET', '/nope'))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(404);
  });
});

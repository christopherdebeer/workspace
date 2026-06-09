/**
 * Home cell server contract: serves the SPA shell at `/` (+ `/index.html`), the
 * client bundle at `/app.js`, and 404s anything else. The home SPA is now a
 * read/act client over `/mcp` — there's no server-side `/_catalog` — so the
 * server is just the shell + bundle. (The browser bundle is built by esbuild at
 * deploy time; here we assert routing + headers.)
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

  it('404s an unknown path', async () => {
    const res = (await home(httpEvent('GET', '/nope'))) as FunctionUrlResponse;
    expect(res.statusCode).toBe(404);
  });
});

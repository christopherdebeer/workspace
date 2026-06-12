/**
 * @c15r/regwatch — FCA/IA regulatory monitoring for depositories & fund managers.
 *
 * Ported from val.town `c15r/regwatch` (see docs/regwatch-port.md). The val's
 * three auth mechanisms (basic auth, ?token=, bespoke OAuth+WebAuthn MCP) are
 * gone: the public shell loads anonymously, the kernel session signs the
 * browser in, and every data path is a tool — gateway-authenticated, with the
 * caller delivered as x-cell-caller. The scheduled collector and Emily are
 * both just principals calling @c15r/regwatch.* tools.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS, toolCall } from './lib/tools';

const read = (rel: string): string => readFileSync(join(__dirname, rel), 'utf8');
const json = (statusCode: number, v: unknown) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(v),
});

export const handler = async (event: {
  rawPath?: string;
  requestContext?: { http?: { method?: string } };
  headers?: Record<string, string>;
  body?: string;
}) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  const caller = event.headers?.['x-cell-caller'] ?? 'anonymous';

  if (method === 'GET' && path === '/_tools') return json(200, { tools: TOOLS });
  if (method === 'POST' && path.startsWith('/_tools/')) {
    const name = path.slice('/_tools/'.length);
    let args: Record<string, unknown> = {};
    try {
      args = event.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { error: 'invalid JSON body' });
    }
    try {
      return json(200, await toolCall(name, args, caller));
    } catch (err) {
      return json(400, { error: (err as Error).message });
    }
  }

  if (method === 'GET' || method === 'HEAD') {
    try {
      if (path === '/' || path === '') {
        return { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: read('static/index.html') };
      }
      if (path === '/app.js') {
        return { statusCode: 200, headers: { 'content-type': 'application/javascript; charset=utf-8' }, body: read('app.js') };
      }
    } catch (err) {
      return json(404, { error: (err as Error).message });
    }
  }
  return json(404, { error: `no route for ${method} ${path}` });
};

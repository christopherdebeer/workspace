// Drive the real @c15r/playtest handler locally: fake table + in-process jobs,
// real Jev over /mcp (token: PARC_TOKEN or /tmp/parc-token.json, used as the cell's jev token).
//   node cell-local.mjs <script.json>   — a list of [tool, args] steps; async tools are awaited;
//   ["GET", "/api/overview"] steps request the public page/API anonymously
import { readFileSync } from 'node:fs';
import { handler } from '../index';
declare const process: { argv: string[]; env: Record<string, string | undefined> };
(globalThis as any).__selfInvoke = (p: unknown) => handler(p as never, { functionName: 'local' });
const call = async (name: string, args: unknown, caller = 'c15r') => {
  const r = await handler({ rawPath: `/_tools/${name}`, requestContext: { http: { method: 'POST' } }, headers: { 'x-cell-caller': caller }, body: JSON.stringify(args) } as never, { functionName: 'local' });
  return { status: (r as any).statusCode, body: JSON.parse((r as any).body) };
};
const wait = async (id: string) => { for (;;) { await new Promise((r) => setTimeout(r, 1000)); const j = await call('job', { id }); if (j.body.status === 'done' || j.body.status === 'error') return j.body; } };
const getPath = async (path: string) => {
  const r = (await handler({ rawPath: path, requestContext: { http: { method: 'GET' } }, headers: {} } as never, { functionName: 'local' })) as any;
  const ct = String(r.headers?.['content-type'] ?? '');
  return { status: r.statusCode, body: ct.startsWith('application/json') ? JSON.parse(r.body) : `${ct} · ${String(r.body).length} bytes` };
};
let token = process.env.PARC_TOKEN;
try {
  token ??= JSON.parse(readFileSync('/tmp/parc-token.json', 'utf8')).access_token;
} catch {
  /* no token: steps that need Jev will fail, the rest still run */
}
const steps: Array<[string, Record<string, unknown> | string]> = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (token) await call('set_token', { token });
// GET paths may use {eval} / {run}: the last eval id and its first train run id seen in a step's output.
const seen: Record<string, string> = {};
for (const [name, args] of steps) {
  const t0 = Date.now();
  if (name === 'GET') {
    const r = await getPath(String(args).replace(/\{(\w+)\}/g, (_, k) => seen[k] ?? k));
    console.log(`\n=== GET ${args} → ${r.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log(JSON.stringify(r.body, null, 1).slice(0, Number(process.env.OUT ?? 4000)));
    continue;
  }
  let r = await call(name, args);
  if (r.body?.job) r = { status: r.status, body: await wait(r.body.job) };
  const ev = r.body?.out?.eval;
  if (ev?.id) (seen.eval = ev.id), (seen.run = ev.train?.runs?.[0]?.id ?? seen.run);
  if (r.body?.out?.run) seen.run = r.body.out.run;
  console.log(`\n=== ${name} ${JSON.stringify(args).slice(0, 120)} → ${r.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(JSON.stringify(r.body, null, 1).slice(0, Number(process.env.OUT ?? 4000)));
}

// SERVE=<port> [APP_JS=<bundle>] [INDEX_HTML=<file>]: after the steps, serve the page + public API at
// http://localhost:<port>/@c15r/playtest/ from this in-memory state (for a browser check of the client).
if (process.env.SERVE) {
  const http = await import('node:http');
  const base = '/@c15r/playtest';
  http
    .createServer(async (q, res) => {
      const url = String(q.url ?? '/');
      const path = url.startsWith(base) ? url.slice(base.length) || '/' : url;
      let status = 200;
      let type = 'application/json';
      let body: string;
      if (path === '/' && process.env.INDEX_HTML) (type = 'text/html'), (body = readFileSync(process.env.INDEX_HTML, 'utf8'));
      else if (path === '/app.js' && process.env.APP_JS) (type = 'text/javascript'), (body = readFileSync(process.env.APP_JS, 'utf8'));
      else {
        const r = (await handler({ rawPath: path, requestContext: { http: { method: 'GET' } }, headers: {} } as never, { functionName: 'local' })) as any;
        status = r.statusCode;
        type = String(r.headers?.['content-type'] ?? type);
        body = String(r.body);
      }
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    })
    .listen(Number(process.env.SERVE));
  console.log(`serving http://localhost:${process.env.SERVE}${base}/`);
}

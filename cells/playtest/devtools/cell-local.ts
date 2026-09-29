// Drive the real @c15r/playtest handler locally: fake table + in-process jobs,
// real Jev over /mcp (token: PARC_TOKEN or /tmp/parc-token.json, used as the cell's jev token).
//   node cell-local.mjs <script.json>   — a list of [tool, args] steps; async tools are awaited
import { readFileSync } from 'node:fs';
import { handler } from '../index';
declare const process: { argv: string[]; env: Record<string, string | undefined> };
(globalThis as any).__selfInvoke = (p: unknown) => handler(p as never, { functionName: 'local' });
const call = async (name: string, args: unknown, caller = 'c15r') => {
  const r = await handler({ rawPath: `/_tools/${name}`, requestContext: { http: { method: 'POST' } }, headers: { 'x-cell-caller': caller }, body: JSON.stringify(args) } as never, { functionName: 'local' });
  return { status: (r as any).statusCode, body: JSON.parse((r as any).body) };
};
const wait = async (id: string) => { for (;;) { await new Promise((r) => setTimeout(r, 1000)); const j = await call('job', { id }); if (j.body.status === 'done' || j.body.status === 'error') return j.body; } };
const token = process.env.PARC_TOKEN ?? JSON.parse(readFileSync('/tmp/parc-token.json', 'utf8')).access_token;
const steps: Array<[string, Record<string, unknown>]> = JSON.parse(readFileSync(process.argv[2], 'utf8'));
await call('set_token', { token });
for (const [name, args] of steps) {
  const t0 = Date.now();
  let r = await call(name, args);
  if (r.body?.job) r = { status: r.status, body: await wait(r.body.job) };
  console.log(`\n=== ${name} ${JSON.stringify(args).slice(0, 120)} → ${r.status} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(JSON.stringify(r.body, null, 1).slice(0, Number(process.env.OUT ?? 4000)));
}

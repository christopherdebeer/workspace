#!/usr/bin/env node
/**
 * Drive the stem-question sweep from the repo, not by pasting code into MCP.
 *
 *   node docs/research/stems/run.mjs pool   [pool.json]              store the pool as _stems/pool/<v>
 *   node docs/research/stems/run.mjs judge  <prefix> <caps.json|type=n,…>  judge a corpus chunk → shards
 *   node docs/research/stems/run.mjs report <out-key> <shard-prefix…>      merge shards → analysis
 *
 * Auth as scripts/cell-sync.mjs: PARC_TOKEN env or /tmp/parc-token.json. The
 * same bearer is handed to @c15r/run.exec so its parc.call can reach
 * workspace.query and @c15r/jev (read:workspace write:workspace suffices).
 * Long steps run async on the cell and are polled here; nothing but the
 * summary crosses back.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.PARC_BASE ?? 'https://parc.land';

function token() {
  if (process.env.PARC_TOKEN) return process.env.PARC_TOKEN;
  try {
    return JSON.parse(readFileSync('/tmp/parc-token.json', 'utf8')).access_token;
  } catch {
    console.error('No PARC_TOKEN and no /tmp/parc-token.json (see scripts/cell-sync.mjs).');
    process.exit(1);
  }
}

async function call(verb, target, input) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: verb, arguments: { target, input } } }),
  });
  if (!res.ok) throw new Error(`${target}: HTTP ${res.status}`);
  const rpc = await res.json();
  const text = rpc.result?.content?.[0]?.text ?? '';
  let value = text;
  try { value = JSON.parse(text); } catch { /* raw */ }
  if (rpc.error || rpc.result?.isError) throw new Error(`${target}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return value;
}

/** Strip comments + the node-only export so a file can be an exec body. */
const body = (f) =>
  readFileSync(join(HERE, f), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\/\*\*|\*)/.test(l))
    .join('\n')
    .replace(/if \(typeof module[^\n]*\n?/, '');

async function exec(code, input) {
  const started = await call('act', '@c15r/run.exec', { code, input, token: token(), async: true });
  if (!started.jobId) return started;
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const s = await call('read', '@c15r/run.fetch', { jobId: started.jobId });
    if (s.status === 'done') return s.out;
    if (s.status === 'error') throw new Error(s.error);
    process.stderr.write('.');
  }
}

const parseCaps = (arg) =>
  arg.endsWith('.json')
    ? JSON.parse(readFileSync(arg, 'utf8'))
    : Object.fromEntries(arg.split(',').map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; }));

const [cmd, ...args] = process.argv.slice(2);
const poolFile = process.env.STEMS_POOL ?? join(HERE, 'pool-v0.json');
const pool = JSON.parse(readFileSync(poolFile, 'utf8'));
const poolKey = `_stems/pool/${pool.version.split('/').pop()}`;
const loadPool = `input.pool = await parc.read(${JSON.stringify(poolKey)});\n`;

let out;
if (cmd === 'pool') {
  out = await exec(`await parc.emit(${JSON.stringify(poolKey)}, input.pool, { type: 'stems-pool', tags: ['stems'] }); return ${JSON.stringify(poolKey)};`, { pool });
} else if (cmd === 'judge') {
  const [prefix, caps] = args;
  out = await exec(loadPool + body('sweep.js'), { judgeOnly: true, emitPrefix: prefix, caps: parseCaps(caps), batch: 100, concurrency: 20 });
} else if (cmd === 'report') {
  const [emitKey, ...prefixes] = args;
  // Shard keys are probed server-side (…/matrix/00, 01, …): a prefix query
  // would drag every ~50KB shard through the 60KB read budget.
  const list = `input.shards = []; for (const p of input.prefixes) { for (let i = 0; i < 100; i++) { const k = p + '/matrix/' + String(i).padStart(2, '0'); if (!(await parc.read(k))) break; input.shards.push(k); } }\n`;
  out = await exec(loadPool + list + body('analyze.js') + '\n' + body('analyze-run.js'), { emitKey, prefixes });
} else {
  console.error('usage: run.mjs pool | judge <prefix> <caps> | report <out-key> <shard-prefix…>');
  process.exit(2);
}
console.log(JSON.stringify(out.result ?? out, null, 2));

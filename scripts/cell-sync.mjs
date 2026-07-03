#!/usr/bin/env node
/**
 * cell-sync — git is the truth for tier-2 cell sources (cells/<name>/…).
 *
 *   node scripts/cell-sync.mjs pull <name> [--owner c15r]   live src → cells/<name>/
 *   node scripts/cell-sync.mjs push <name> [--deploy]       cells/<name>/ → live src (+ deploy)
 *
 * Auth: PARC_TOKEN env, or a device-flow token JSON at /tmp/parc-token.json
 * (mint one: POST https://parc.land/auth/device, approve the user_code, then
 * exchange at /oauth/token with the device_code grant).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';

const BASE = process.env.PARC_BASE ?? 'https://parc.land';

function tokenFile() {
  try {
    return JSON.parse(readFileSync('/tmp/parc-token.json', 'utf8'));
  } catch {
    return null;
  }
}

function token() {
  if (process.env.PARC_TOKEN) return process.env.PARC_TOKEN;
  const t = tokenFile();
  if (!t?.access_token) {
    console.error('No PARC_TOKEN and no /tmp/parc-token.json — mint a device token first.');
    process.exit(1);
  }
  return t.access_token;
}

/** Device tokens live ~1h; refresh in place and retry once on a 401. */
async function refreshToken() {
  const t = tokenFile();
  if (!t?.refresh_token) return false;
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: t.refresh_token }),
  });
  const j = await res.json();
  if (!j.access_token) return false;
  writeFileSync('/tmp/parc-token.json', JSON.stringify(j), { mode: 0o600 });
  return true;
}

async function call(verb, target, input) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: verb, arguments: { target, input } },
    }),
  });
  if (res.status === 401 && !process.env.PARC_TOKEN && (await refreshToken())) return call(verb, target, input);
  if (!res.ok) throw new Error(`${target}: HTTP ${res.status}`);
  const rpc = await res.json();
  const text = rpc.result?.content?.[0]?.text ?? '';
  let value = text;
  try {
    value = JSON.parse(text);
  } catch {
    /* raw */
  }
  if (rpc.error || rpc.result?.isError) throw new Error(`${target}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return value;
}

/** Repo-side entries that are not cell source: dot-files (the cells service
 *  rejects them as path segments anyway), dependency trees, and each cell's
 *  devtools/ (local harnesses — e.g. canvas's headless-repro). */
const SKIP = new Set(['node_modules', 'devtools']);

function* walk(dir, top = true) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || (top && SKIP.has(name)) || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p, false);
    else yield p;
  }
}

const [, , cmd, name, ...flags] = process.argv;
const owner = flags.includes('--owner') ? flags[flags.indexOf('--owner') + 1] : 'c15r';
if (!cmd || !name) {
  console.error('usage: cell-sync.mjs <pull|push> <cellName> [--owner c15r] [--deploy]');
  process.exit(1);
}
const localRoot = join(process.cwd(), 'cells', name);

if (cmd === 'pull') {
  const { files } = await call('read', 'cells.listFiles', { owner, name });
  for (const f of files) {
    const { content } = await call('read', 'cells.readFile', { owner, name, path: f });
    const dest = join(localRoot, f);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    console.log('pulled', f, `(${content.length}b)`);
  }
  console.log(`✓ ${files.length} files → cells/${name}/`);
} else if (cmd === 'push') {
  const local = [...walk(localRoot)].map((p) => relative(localRoot, p));
  for (const f of local) {
    const content = readFileSync(join(localRoot, f), 'utf8');
    await call('act', 'cells.writeFile', { owner, name, path: f, content });
    console.log('pushed', f, `(${content.length}b)`);
  }
  if (flags.includes('--deploy')) {
    // Deploy is asynchronous: it returns DEPLOYING immediately (the bundle runs
    // off the request path), so poll `cells.get` until the phase is terminal.
    const started = await call('act', 'cells.deploy', { owner, name });
    const cellId = started.cellId;
    process.stdout.write(`deploying ${cellId} v${started.version}`);
    const deadline = Date.now() + 180_000;
    for (;;) {
      await new Promise((r) => setTimeout(r, 3000));
      const cell = await call('read', 'cells.get', { cellId });
      const phase = cell.deploy?.phase;
      if (phase === 'DEPLOYED') {
        console.log(`\n✓ deployed ${cellId} v${cell.deploy.version}`);
        break;
      }
      if (phase === 'FAILED') {
        console.error(`\n✗ deploy failed: ${cell.deploy.error ?? 'unknown error'}`);
        process.exit(1);
      }
      if (Date.now() > deadline) {
        console.error(`\n✗ deploy still ${phase ?? 'pending'} after 180s — check cells.get later`);
        process.exit(1);
      }
      process.stdout.write('.');
    }
  } else {
    console.log(`✓ ${local.length} files pushed (no deploy — pass --deploy)`);
  }
} else {
  console.error(`unknown command "${cmd}"`);
  process.exit(1);
}

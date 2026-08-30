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
    // Vendored modules (ADR-0076) are materialized at push time from
    // cells/vendor/ — never pull them back as cell source (one source, no
    // committed copies).
    if (f.startsWith('vendor/')) {
      console.log('skipped', f, '(vendored — source of truth is cells/vendor/)');
      continue;
    }
    // `whole: true` because a PULL genuinely wants the entire file. Without
    // it the substrate's 60KB read budget refuses anything larger and the pull
    // dies partway through the list — measured on @c15r/drive, which stopped
    // at a 158KB fixture and left the working tree half-updated with no
    // indication of which files had made it.
    const { content } = await call('read', 'cells.readFile', { owner, name, path: f, whole: true });
    const dest = join(localRoot, f);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, content);
    console.log('pulled', f, `(${content.length}b)`);
  }
  console.log(`✓ ${files.length} files → cells/${name}/`);
} else if (cmd === 'push') {
  const local = [...walk(localRoot)].map((p) => relative(localRoot, p));
  // A BIG FILE GOES UP IN PIECES. `cells.writeFile` carries the whole body in
  // one signed request, and somewhere just past a megabyte that request starts
  // coming back `403 The request signature we calculated does not match` —
  // measured on @c15r/drive: 1,000,000 bytes wrote fine and 1,020,000 did not,
  // which is how a client/main.ts that had grown to 1,031,430 bytes stopped
  // being deployable at all. So the first chunk is a `writeFile` (which
  // replaces whatever was there, including a half-written previous attempt)
  // and the rest are `appendToFile`. Well under the cliff, because the signed
  // body carries the JSON-escaped content and that is larger than the file.
  const CHUNK = 600000;
  for (const f of local) {
    const content = readFileSync(join(localRoot, f), 'utf8');
    await call('act', 'cells.writeFile', { owner, name, path: f, content: content.slice(0, CHUNK) });
    for (let at = CHUNK; at < content.length; at += CHUNK) {
      await call('act', 'cells.appendToFile', { owner, name, path: f, content: content.slice(at, at + CHUNK) });
    }
    const parts = Math.max(1, Math.ceil(content.length / CHUNK));
    console.log('pushed', f, `(${content.length}b${parts > 1 ? ` in ${parts} parts` : ''})`);
  }
  // Kernel-SDK vendor overlay (ADR-0076): a server-side https import hangs the
  // forge bundler (ADR-0017), so cells that use shared kernel modules import
  // `./vendor/<module>.js` instead — and push materializes each referenced
  // module from its canonical source, cells/kernel/static/<module>.js. This is
  // the automated form of the machine cell's manual keep-in-sync copy: git
  // keeps ONE source; copies exist only in the deployed bundle (pull skips them).
  const sdkRoot = join(process.cwd(), 'cells', 'kernel', 'static');
  const referenced = new Set();
  for (const f of local) {
    if (!f.match(/\.(ts|tsx|js|mjs)$/)) continue;
    const src = readFileSync(join(localRoot, f), 'utf8');
    // Only the IMPORT SPECIFIER form (`./vendor/<module>.js`) names a kernel-SDK
    // module — a bare `vendor/…` substring can be part of an unrelated URL
    // (home's self-hosted three bundle lives at …/public/vendor/….js).
    for (const m of src.matchAll(/\.\/vendor\/([\w-]+\.js)/g)) referenced.add(m[1]);
  }
  for (const mod of referenced) {
    const content = readFileSync(join(sdkRoot, mod), 'utf8');
    await call('act', 'cells.writeFile', { owner, name, path: `vendor/${mod}`, content });
    console.log('pushed', `vendor/${mod}`, `(${content.length}b, vendored from kernel/static)`);
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

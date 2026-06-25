#!/usr/bin/env node
/**
 * docs-sync — upsert the repo's own docs into the substrate as `file` facts
 * (ADR-0027). Each `docs/**.md` becomes one `file/docs/<relpath>` fact with the
 * markdown inline (so `query { contains }` is full-text over it), then the whole
 * `file/docs/*` prefix is shared `public` (read-only) — one canonical, default-
 * visible, shared-by-all corpus.
 *
 *   node scripts/docs-sync.mjs                 dry run — print the plan, write nothing
 *   node scripts/docs-sync.mjs --commit        ingest the facts + share public
 *   node scripts/docs-sync.mjs --commit --no-share   ingest only (skip the public share)
 *
 * Auth (only needed with --commit): PARC_TOKEN env, or a device-flow token JSON
 * at /tmp/parc-token.json (same convention as cell-sync.mjs). Re-runnable: keys
 * are deterministic, so a second run just bumps revisions; `sha` is stored for
 * later change-detection.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

const BASE = process.env.PARC_BASE ?? 'https://parc.land';
const DOCS_ROOT = join(process.cwd(), 'docs');
const KEY_PREFIX = 'file/docs/';
const BATCH_MAX = 3; // facts per ingest call (handler cap is 100)
const BATCH_BYTES = 16 * 1024; // …or until this much inline content, whichever first (keep the gateway body small)

const flags = process.argv.slice(2);
const COMMIT = flags.includes('--commit');
const SHARE = !flags.includes('--no-share');

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
    console.error('No PARC_TOKEN and no /tmp/parc-token.json — mint a token first (--commit only).');
    process.exit(1);
  }
  return t.access_token;
}
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
async function call(verb, target, input, attempt = 0) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: verb, arguments: { target, input } } }),
  });
  if (res.status === 401 && !process.env.PARC_TOKEN && (await refreshToken())) return call(verb, target, input);
  // Transient gateway/edge errors (502/503/504) — back off and retry a few times.
  if ([502, 503, 504].includes(res.status) && attempt < 5) {
    await new Promise((r) => setTimeout(r, Math.min(16000, 1000 * 2 ** attempt)));
    return call(verb, target, input, attempt + 1);
  }
  if (!res.ok) throw new Error(`${target}: HTTP ${res.status}`);
  const rpc = await res.json();
  const text = rpc.result?.content?.[0]?.text ?? '';
  let value = text;
  try { value = JSON.parse(text); } catch { /* raw */ }
  if (rpc.error || rpc.result?.isError) throw new Error(`${target}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  return value;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/**
 * Pure transform: a markdown file on disk → the `file` fact to upsert. Exported so
 * the shape is testable without touching the network.
 */
export function fileFactFromDoc(relPath, content) {
  const path = `docs/${relPath.split(sep).join('/')}`;
  const sha = createHash('sha256').update(content).digest('hex');
  const adr = /(^|\/)architecture\/adr\//.test(path);
  const traj = /(^|\/)trajectory\//.test(path);
  const tags = ['file', 'docs', ...(adr ? ['adr'] : []), ...(traj ? ['trajectory'] : [])];
  return {
    key: `${KEY_PREFIX}${relPath.split(sep).join('/')}`,
    type: 'file',
    tags,
    value: {
      path,
      contentType: 'text/markdown',
      bytes: Buffer.byteLength(content, 'utf8'),
      sha,
      content,
      source: 'docs-sync',
    },
  };
}

const facts = [...walk(DOCS_ROOT)]
  .filter((p) => p.endsWith('.md'))
  .map((p) => fileFactFromDoc(relative(DOCS_ROOT, p), readFileSync(p, 'utf8')))
  .sort((a, b) => a.key.localeCompare(b.key));

const totalBytes = facts.reduce((n, f) => n + f.value.bytes, 0);
console.log(`docs-sync: ${facts.length} markdown files, ${(totalBytes / 1024).toFixed(1)} KiB inline`);
for (const f of facts) console.log(`  ${f.key}  (${f.value.bytes}b${f.tags.includes('adr') ? ', adr' : ''})`);

if (!COMMIT) {
  console.log('\n(dry run — pass --commit to ingest + share. Nothing written.)');
  process.exit(0);
}

// Size-aware batches: cap by fact count AND cumulative inline bytes, so a cluster
// of large docs never makes one ingest call too big for the gateway body.
const batches = [];
let cur = [];
let curBytes = 0;
for (const f of facts) {
  if (cur.length && (cur.length >= BATCH_MAX || curBytes + f.value.bytes > BATCH_BYTES)) {
    batches.push(cur);
    cur = [];
    curBytes = 0;
  }
  cur.push(f);
  curBytes += f.value.bytes;
}
if (cur.length) batches.push(cur);

let ingested = 0;
const failedKeys = [];
for (const slice of batches) {
  try {
    const res = await call('act', 'workspace.ingest', { via: 'docs-sync', facts: slice });
    ingested += res.ingested ?? 0;
    if (res.errors?.length) for (const e of res.errors) console.error('  ! ingest error', e.key, e.error);
  } catch (err) {
    // A batch may fail (transient gateway) even after retries — keep going; the
    // run is idempotent, so the missed keys land on a re-run.
    failedKeys.push(...slice.map((f) => f.key));
    console.error(`\n  ! batch failed (${slice.length} facts): ${(err && err.message) || err}`);
  }
  process.stdout.write(`\ringested ${ingested}/${facts.length}`);
}
console.log();
if (failedKeys.length) {
  console.error(`\n${failedKeys.length} file fact(s) did not land — re-run docs-sync --commit to retry:`);
  for (const k of failedKeys) console.error(`  ${k}`);
}

if (SHARE) {
  await call('act', 'workspace.share', { key: `${KEY_PREFIX}*`, to: 'public', mode: 'read' });
  console.log(`✓ shared ${KEY_PREFIX}* → public (read-only)`);
}
console.log(`✓ docs corpus: ${ingested}/${facts.length} file facts upserted${failedKeys.length ? ` (${failedKeys.length} to retry)` : ''}`);

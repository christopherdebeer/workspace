#!/usr/bin/env node
/**
 * docs-sync — upsert the repo's own docs into the substrate as `markdown`
 * facts (ADR-0027, typed per ADR-0081). Each `docs/**.md` becomes one
 * `file/docs/<relpath>` fact with the markdown inline (so `query { contains }`
 * is full-text over it), then the whole `file/docs/*` prefix is shared
 * `public` (read-only) — one canonical, default-visible, shared-by-all corpus.
 * The `markdown` type gives `@c15r/lit` (cells/lit) a manager to react on: its
 * `decomposeMarkdown` tool turns each raw source fact into `doc`/`doc-block`
 * structure with real links (see docs/architecture/adr/0081-typed-file-ingestion.md).
 *
 *   node scripts/docs-sync.mjs                 dry run — print the plan, write nothing
 *   node scripts/docs-sync.mjs --commit        ingest the facts + share public
 *   node scripts/docs-sync.mjs --commit --no-share   ingest only (skip the public share)
 *   node scripts/docs-sync.mjs --commit --force      ingest every doc regardless of sha
 *                                                     (re-fires the type:'markdown' reaction —
 *                                                     e.g. after re-registering a dropped
 *                                                     subscription, ADR-0081)
 *
 * Pacing — for recovery, `--force` alone is a stampede (see PACING below):
 *   --only <substr>   only files whose key contains this (one doc, one tree)
 *   --max <n>         stop after n DOCUMENTS this run (each starts a chain)
 *   --delay <ms>      sleep between ingest batches
 *
 *   node scripts/docs-sync.mjs --commit --force --max 5 --delay 3000 --no-share
 *     → restart five stranded decompositions, spaced; re-run to continue
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
const BATCH_MAX = 20; // facts per ingest call (handler cap is 100)
const BATCH_BYTES = 80 * 1024; // …or until this much inline content, whichever first (keep the gateway body small)

// The PUBLIC face is a CURATED subset — not the whole corpus. docs-sync used to
// blanket-share `file/docs/*` to `public`, which exposed every ADR, trajectory
// log, and protocol note (a builder's private reasoning) on the anonymous apex.
// The public slice is now the user/integrator GUIDE plus a hand-picked set of
// vision essays; the rest of the corpus stays ingested (queryable to the owner)
// but private. Each entry is shared across all three fact framings a doc takes:
// the raw `file/…md` mirror, the `doc:` header, and its `doc-block:…/*` sections.
// To publish another doc, add its base here — nothing else blanket-shares.
const PUBLIC_DOC_BASES = [
  'guide/*', // the whole user/integrator guide (docs/guide/*)
  // vision / thesis essays (general-reader-friendly):
  'cognitive-substrate',
  'the-coupled-workspace',
  'ancestor/sync/the-substrate-thesis',
  'ancestor/sync/pressure-field',
  'ancestor/sync/what-becomes-true',
];
/** Every public grant pattern implied by PUBLIC_DOC_BASES (file + doc + doc-block). */
function publicSharePatterns() {
  const pats = [];
  for (const base of PUBLIC_DOC_BASES) {
    if (base.endsWith('*')) {
      const b = base.slice(0, -1); // e.g. 'guide/'
      pats.push(`file/docs/${b}*`, `doc:docs/${b}*`, `doc-block:docs/${b}*`);
    } else {
      pats.push(`file/docs/${base}.md`, `doc:docs/${base}`, `doc-block:docs/${base}/*`);
    }
  }
  return pats;
}

const flags = process.argv.slice(2);
const COMMIT = flags.includes('--commit');
const SHARE = !flags.includes('--no-share');
const FORCE = flags.includes('--force');

/** Value of `--name <v>`, or undefined. */
const flagValue = (name) => {
  const i = flags.indexOf(name);
  return i >= 0 ? flags[i + 1] : undefined;
};

/**
 * PACING (2026-07-29). Ingesting a `file/docs/*.md` fact is cheap; what it
 * TRIGGERS is not. Each one fires the `lit-decompose-markdown` reaction, which
 * fans out into a chain writing hundreds of doc-block facts. Re-ingesting the
 * whole corpus therefore starts ~60 chains at once — and since every fact and
 * edge of one owner shares a single DynamoDB partition (`pk = statePk(scope)`,
 * hard-capped at 1,000 WCU regardless of on-demand billing), that is a
 * stampede against a hot partition, not a throughput problem that scales away.
 *
 * Observed three times over: `--force` saturated the table, chunk steps failed
 * on throttling, and because a dead-lettered reaction is never retried, each
 * storm left documents stranded mid-chain — the run made things worse, not
 * better. Client-side retry (see cells/kernel/static/gateway-client.js) absorbs
 * a momentary blip; it cannot buy capacity that does not exist.
 *
 * So recovery is PACED, not forced: take a few documents, let their chains
 * drain, take a few more. `--only` selects, `--max` bounds the run, `--delay`
 * spaces the batches within it.
 */
const ONLY = flagValue('--only');
const MAX = Number(flagValue('--max') ?? NaN);
const DELAY_MS = Number(flagValue('--delay') ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    // ADR-0081: typed at the put seam — `markdown` (not the flat `file` every
    // upload used to get) is what @c15r/lit's decompose reaction (cells/lit)
    // matches on to turn this raw source into `doc`/`doc-block` structure.
    type: 'markdown',
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

const allFacts = [...walk(DOCS_ROOT)]
  .filter((p) => p.endsWith('.md'))
  .map((p) => fileFactFromDoc(relative(DOCS_ROOT, p), readFileSync(p, 'utf8')))
  .sort((a, b) => a.key.localeCompare(b.key));

/** Change detection (ADR-0045; REBUILT 2026-08-01, cost review). The original
 *  read the whole corpus back through `workspace.query {type:'markdown'}` to
 *  compare shas — 202 docs WITH their bodies inline, ~1.9MB, which blows the
 *  gateway's 60KB read budget. The catch called that "transient" and fell back
 *  to FULL INGEST — so every deploy re-ingested and re-decomposed all ~200
 *  docs, throttled the hot partition, and burned ~55M RCUs an hour. The
 *  recurring storm was the change detector failing at its own job.
 *
 *  Now the shas live in ONE dedicated manifest fact (`_docs/sync-manifest`,
 *  ~20KB, `_`-prefixed so it never reacts/indexes/announces) — one peek to
 *  read, one write to update. And the fallback FAILS CLOSED: if the manifest
 *  read errors, we skip the sync loudly rather than storm; an ABSENT manifest
 *  (first run / bootstrap) is the one case that full-ingests, which then
 *  writes the manifest and never storms again. */
const MANIFEST_KEY = '_docs/sync-manifest';
async function liveShas() {
  try {
    const res = await call('read', 'workspace.peek', { key: MANIFEST_KEY });
    const v = res && typeof res === 'object' ? (res.value ?? null) : null;
    const shas = v && typeof v.shas === 'object' && v.shas ? v.shas : null;
    return shas ? new Map(Object.entries(shas)) : null; // null → bootstrap full ingest
  } catch (err) {
    const msg = (err && err.message) || String(err);
    if (/not.?found|no such|absent/i.test(msg)) return null; // missing fact → bootstrap
    // FAIL CLOSED: a failed change-detection read must never trigger a mass
    // re-sync (that "recovery" was the storm). The corpus waits for the next
    // deploy; if this persists, check the token (needs read: + write:workspace).
    console.error(`\n  ✗ change-detection manifest read failed: ${msg}`);
    console.error(`  Skipping docs-sync rather than full-ingesting ~200 docs. Fix the read and re-run.`);
    process.exit(1);
  }
}

let facts = allFacts;
if (ONLY) facts = facts.filter((f) => f.key.includes(ONLY));
// The manifest is read even under --force: the post-ingest manifest write
// merges prior shas for anything that fails to land, so a crashed run retries
// exactly its failures next time instead of the world.
let live = null;
if (COMMIT) live = await liveShas();
if (COMMIT && !FORCE && live) facts = facts.filter((f) => live.get(f.key) !== f.value.sha);
// The bound is on DOCUMENTS, because each one starts a decomposition chain.
const selected = facts.length;
if (Number.isFinite(MAX) && MAX > 0) facts = facts.slice(0, MAX);

const totalBytes = facts.reduce((n, f) => n + f.value.bytes, 0);
console.log(`docs-sync: ${allFacts.length} markdown files, ${facts.length} new/changed to ingest (${(totalBytes / 1024).toFixed(1)} KiB inline)`);
// Never let a cap read as "that was all of them" — a silent truncation looks
// exactly like a completed recovery.
if (facts.length < selected) console.log(`  (capped by --max ${MAX}: ${selected - facts.length} more still pending — re-run to continue)`);
for (const f of facts) console.log(`  ${f.key}  (${f.value.bytes}b${f.tags.includes('adr') ? ', adr' : ''})`);

if (!COMMIT) {
  console.log('\n(dry run — pass --commit to ingest + share. Change detection runs only with --commit.)');
  process.exit(0);
}

if (facts.length === 0) {
  console.log('✓ corpus already current — nothing to ingest.');
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
let firstBatch = true;
for (const slice of batches) {
  if (!firstBatch && DELAY_MS > 0) await sleep(DELAY_MS);
  firstBatch = false;
  try {
    const res = await call('act', 'workspace.ingest', { via: 'docs-sync', facts: slice });
    ingested += res.ingested ?? 0;
    if (res.errors?.length) {
      for (const e of res.errors) {
        console.error('  ! ingest error', e.key, e.error);
        if (e.key) failedKeys.push(e.key); // a per-key failure must stay "changed" in the manifest
      }
    }
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

// Persist the sha manifest: a doc that LANDED records its fresh sha; anything
// that failed (or wasn't attempted) keeps its prior sha — so the next run's
// change detection retries exactly the misses, never the world. Best-effort
// with one retry: a lost manifest only costs one bootstrap full-ingest.
{
  const failed = new Set(failedKeys);
  const attempted = new Set(facts.map((f) => f.key));
  const shasOut = {};
  for (const f of allFacts) {
    if (attempted.has(f.key) && !failed.has(f.key)) shasOut[f.key] = f.value.sha;
    else if (live?.has(f.key)) shasOut[f.key] = live.get(f.key);
  }
  const manifestValue = { shas: shasOut, at: new Date().toISOString(), docs: Object.keys(shasOut).length };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await call('act', 'workspace.remember', { key: MANIFEST_KEY, value: manifestValue });
      console.log(`✓ sync manifest updated (${manifestValue.docs} shas)`);
      break;
    } catch (err) {
      if (attempt === 1) console.error(`  ! manifest write failed (${(err && err.message) || err}) — next run will bootstrap-ingest`);
      else await sleep(2000);
    }
  }
}

if (SHARE) {
  // Re-assert the CURATED public grants (idempotent — a re-share just refreshes
  // the grant). Deliberately does NOT touch the blanket `file/docs/*` grant, and
  // never UNSHARES: retracting a previously-public doc is an explicit owner act
  // (workspace.unshare), not a side effect of sync — so removing a base here
  // stops future publishing but won't silently revoke live access.
  // Best-effort (2026-08-01): a throttled share must not exit-1 the step —
  // tonight's storm died HERE after 127 ingests, stranding the manifest state.
  const patterns = publicSharePatterns();
  let shared = 0;
  for (const key of patterns) {
    try {
      await call('act', 'workspace.share', { key, to: 'public', mode: 'read' });
      shared++;
    } catch (err) {
      console.error(`  ! share failed for ${key}: ${(err && err.message) || err}`);
    }
  }
  console.log(`✓ re-asserted ${shared}/${patterns.length} curated public grants (guide + vision docs)`);
}
console.log(`✓ docs corpus: ${ingested}/${facts.length} file facts upserted${failedKeys.length ? ` (${failedKeys.length} to retry)` : ''}`);

// ADR-0081: `workspace.ingest` deliberately does NOT emit a per-fact
// `workspace.fact.written` event (just one aggregate `workspace.ingested`,
// "intake should not storm the bus") — so the `type:'markdown'` reaction
// subscription never fires for a bulk sync. docs-sync triggers
// @c15r/lit.decomposeMarkdown directly for what it just ingested instead;
// the subscription still covers single-fact writes elsewhere (workspace.
// remember, a future workspace.putFile). Bounded concurrency — each call can
// take tens of seconds for a large doc (lit's own sequential
// workspace.ingest writes dominate its latency), so unbounded parallelism
// would just queue against the same gateway.
const DECOMPOSE_CONCURRENCY = 4;
async function decomposeAll(list) {
  let i = 0;
  let done = 0;
  const errors = [];
  async function worker() {
    for (;;) {
      const idx = i++;
      if (idx >= list.length) return;
      const f = list[idx];
      try {
        await call('act', '@c15r/lit.decomposeMarkdown', { path: f.value.path, content: f.value.content, token: token() });
      } catch (err) {
        errors.push({ key: f.key, error: (err && err.message) || String(err) });
      }
      done++;
      process.stdout.write(`\rdecomposed ${done}/${list.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(DECOMPOSE_CONCURRENCY, list.length) }, worker));
  return errors;
}
if (facts.length) {
  console.log(`\ndecomposing ${facts.length} doc(s) into doc/doc-block structure…`);
  const decomposeErrors = await decomposeAll(facts);
  console.log();
  if (decomposeErrors.length) {
    console.error(`${decomposeErrors.length} doc(s) failed to decompose — re-run with --force to retry:`);
    for (const e of decomposeErrors) console.error(`  ${e.key}: ${e.error}`);
  } else {
    console.log(`✓ ${facts.length}/${facts.length} doc(s) decomposed`);
  }
}

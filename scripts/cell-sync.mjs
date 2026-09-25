#!/usr/bin/env node
/**
 * cell-sync — git is the truth for tier-2 cell sources (cells/<name>/…).
 *
 *   node scripts/cell-sync.mjs status <name>             where the cell and the tree differ, per file
 *   node scripts/cell-sync.mjs diff   <name> [--view summary|files|patch] [--prefix p/]
 *                                                        what changed on the cell since your last sync
 *   node scripts/cell-sync.mjs pull   <name>             bring the cell's changes into the tree
 *   node scripts/cell-sync.mjs push   <name> [--deploy]  send your changes to the cell (+ deploy exactly them;
 *                                                     the deploy fact records --message or the last commit subject, ADR-0099)
 *   node scripts/cell-sync.mjs sync   <name> [--deploy]  pull, then push
 *
 *   flags: --owner c15r · --dry-run · --take local|remote (settle conflicts) · --force
 *
 * Auth: PARC_TOKEN env, or a device-flow token JSON at /tmp/parc-token.json
 * (mint one: POST https://parc.land/auth/device, approve the user_code, then
 * exchange at /oauth/token with the device_code grant).
 *
 * ── THREE-WAY, NOT MIRROR ──
 *
 * This used to push every file and pull every file. A push therefore
 * overwrote whatever other agents had changed directly on the cell, and a
 * pull overwrote whatever you had changed locally — which is why drive's
 * CLAUDE.md grew a PULL BEFORE PUSH / COMMIT BEFORE YOU PULL ritual with a
 * `git diff` per file to work out, by hand, which side had moved.
 *
 * Now each file is compared three ways — the version both sides had at the
 * last sync (`cells/<name>/.cell-sync.json`, committed), the working tree, and
 * the cell — and only moves in the direction that actually changed. A file
 * both sides changed is a CONFLICT and neither copy is touched. The plan
 * itself is `scripts/cell-sync-plan.cjs`; see its header for the rule.
 *
 * ── WHAT A PUSH SENDS ──
 *
 * Only changed files, as ONE `cells.applyPatchSet`: every file carries the
 * version it is replacing (`ifVersion`), the whole patch carries the cell tree
 * it was planned against (`ifTreeVersion`), and the cells service applies all
 * of it or none of it. `--deploy` rides on the same call, so the deploy builds
 * exactly the tree that push produced — not whatever someone else wrote a
 * second later.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { contentVersion, treeVersionOf, isIgnored, isGenerated, plan, nextBase, SKIP } = require('./cell-sync-plan.cjs');

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

/** Extensions pushed as BYTES rather than as text. Kept in step with the
 *  service's own BINARY_TYPES table — anything here must be a type the service
 *  will store with a non-text content type, or the round trip breaks in the
 *  middle: pushed as base64, read back as UTF-8. */
const BINARY_RE = /\.(png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|mp3|ogg|wav|mp4|webm|pdf|zip|wasm)$/i;

/**
 * A BIG FILE GOES UP IN PIECES. A tool call carries its whole body in one
 * signed request, and somewhere just past a megabyte that request starts
 * coming back `403 The request signature we calculated does not match` —
 * measured on @c15r/drive: 1,000,000 bytes wrote fine and 1,020,000 did not.
 * So a text file whose JSON-escaped body exceeds this is STAGED: uploaded in
 * chunks to a scratch path, then moved over its real path inside the patch
 * set — so the swap is atomic and a push that dies half way leaves a stray
 * staging file, never a truncated main.ts. (The old script appended the
 * chunks straight onto the live file.)
 */
const CHUNK = 600000;
/** Keep each patch-set request comfortably under the same cliff. */
const BATCH_BYTES = 700000;
const BATCH_CHANGES = 200;

/** Repo-side entries that are not cell source: dot-files (the cells service
 *  rejects them as path segments anyway), dependency trees, each cell's
 *  devtools/ (local harnesses — e.g. canvas's headless-repro), and native/.
 *
 *  NATIVE IS NOT SERVABLE, AND CANNOT BE STORED EITHER. Electron and Capacitor
 *  scaffolding is built locally and shipped through the app stores; the cell
 *  only ever serves the web client. It also cannot be pushed at all: an
 *  appiconset contains `AppIcon-512@2x.png`, and cells.writeFile allows only
 *  [A-Za-z0-9._-] in a path segment. So every deploy failed outright the
 *  moment the packaging landed — not for one cell, for anyone deploying it.
 *
 *  The same set now also guards PULL (cell-sync-plan.cjs `isIgnored`): the
 *  cell still holds `devtools/` copies from before this rule, and a pull used
 *  to write them over the working tree on every cycle. */
function* walk(dir, top = true) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || (top && SKIP.has(name)) || name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p, false);
    else yield p;
  }
}

/** The bytes a local file will be STORED as: binaries verbatim, text as the UTF-8 of its string. */
function storedBytes(abs, path) {
  return BINARY_RE.test(path) ? readFileSync(abs) : Buffer.from(readFileSync(abs, 'utf8'), 'utf8');
}

// ─── the three states ────────────────────────────────────────────────

/** The working tree: path → version, for every file a push would send. */
function localState(localRoot) {
  const files = {};
  if (!existsSync(localRoot)) return files;
  for (const abs of walk(localRoot)) {
    const path = relative(localRoot, abs).split('\\').join('/');
    if (isIgnored(path) || isGenerated(path)) continue;
    files[path] = contentVersion(storedBytes(abs, path));
  }
  return files;
}

/**
 * Kernel-SDK vendor overlay (ADR-0076): a server-side https import hangs the
 * forge bundler (ADR-0017), so cells that use shared kernel modules import
 * `./vendor/<module>.js` instead — and push materializes each referenced
 * module from its canonical source, cells/kernel/static/<module>.js. Git keeps
 * ONE source; copies exist only on the cell (pull never writes vendor/).
 * Only the IMPORT SPECIFIER form (`./vendor/<module>.js`) names a kernel-SDK
 * module — a bare `vendor/…` substring can be part of an unrelated URL
 * (home's self-hosted three bundle lives at …/public/vendor/….js).
 */
function vendorOverlay(localRoot, local) {
  const sdkRoot = join(process.cwd(), 'cells', 'kernel', 'static');
  const referenced = new Set();
  for (const path of Object.keys(local)) {
    if (!/\.(ts|tsx|js|mjs)$/.test(path)) continue;
    const src = readFileSync(join(localRoot, path), 'utf8');
    for (const m of src.matchAll(/\.\/vendor\/([\w-]+\.js)/g)) referenced.add(m[1]);
  }
  const out = {};
  for (const mod of referenced) out[`vendor/${mod}`] = readFileSync(join(sdkRoot, mod), 'utf8');
  return out;
}

/**
 * The cell: path → version for its whole src/ tree, plus the treeVersion that
 * names exactly that listing. The listing is paged, so it is checked against
 * `cells.status` — a file written mid-listing would otherwise produce a mix of
 * two trees that never existed, and the push's ifTreeVersion would be a lie.
 */
async function remoteState() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const status = await call('read', 'cells.status', { owner, name });
    const files = {};
    const meta = {};
    let cursor;
    do {
      const page = await call('read', 'cells.listFiles', { owner, name, view: 'meta', limit: 100, ...(cursor ? { cursor } : {}) });
      for (const f of page.files) {
        files[f.path] = f.version;
        meta[f.path] = f;
      }
      cursor = page.nextCursor;
    } while (cursor);
    if (treeVersionOf(files) === status.treeVersion) return { cellId: status.cellId, treeVersion: status.treeVersion, files, meta, status };
  }
  throw new Error('the cell kept changing while it was being listed (3 attempts) — another agent is writing; retry shortly');
}

const baseFile = (localRoot) => join(localRoot, '.cell-sync.json');

/** The last sync: what both sides agreed on. Committed with the cell, so the next agent inherits it. */
function readBase(localRoot) {
  try {
    return JSON.parse(readFileSync(baseFile(localRoot), 'utf8'));
  } catch {
    return null;
  }
}

function writeBase(localRoot, cellId, treeVersion, files) {
  mkdirSync(localRoot, { recursive: true });
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(
    baseFile(localRoot),
    JSON.stringify({ cell: `${owner}/${name}`, cellId, treeVersion, syncedAt: new Date().toISOString(), files: sorted }, null, 2) + '\n',
  );
}

/** Paths under the cell with uncommitted git changes (empty when not in a git repo). */
function gitDirty(localRoot) {
  try {
    const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', localRoot], { encoding: 'utf8' });
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    const dirty = new Set();
    for (const line of out.split('\n').filter(Boolean)) {
      const p = line.slice(3).replace(/^"|"$/g, '').split(' -> ').pop();
      dirty.add(relative(localRoot, join(top, p)).split('\\').join('/'));
    }
    return dirty;
  } catch {
    return new Set();
  }
}

/**
 * ADR-0099: the deploy's provenance from git — `description` (why) and
 * `source` (where from). `--message "<why>"` wins. Otherwise, ONLY when the
 * cell directory is clean, the subject of the last commit touching it: with
 * uncommitted changes (the usual push-then-commit order) that subject names
 * the PREVIOUS change, so it is not borrowed — the deploy goes undescribed and
 * a hint says so. `source` names the commit, suffixed `+dirty` when the tree
 * being deployed is not what git recorded. Best-effort: outside git, or on any
 * git error, both are simply omitted.
 */
function deployProvenance(localRoot) {
  const out = {};
  const message = flag('--message') ?? flag('-m');
  if (message) out.description = message;
  try {
    const sha = execFileSync('git', ['log', '-1', '--format=%H', '--', localRoot], { encoding: 'utf8' }).trim();
    const dirty = gitDirty(localRoot).size > 0;
    if (!sha) return out;
    if (!out.description && !dirty) {
      const subject = execFileSync('git', ['log', '-1', '--format=%s', '--', localRoot], { encoding: 'utf8' }).trim();
      if (subject) out.description = subject;
    }
    let repo = '';
    try {
      const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
      const m = url.match(/github\.com[:/]([^/]+\/[^/.]+?)(?:\.git)?$/) ?? url.match(/\/git\/([^/]+\/[^/.]+?)(?:\.git)?$/);
      repo = m ? m[1] : '';
    } catch {
      /* no origin */
    }
    out.source = `git:${repo ? `${repo}@` : ''}${sha}${dirty ? '+dirty' : ''}`;
  } catch {
    /* not a git checkout */
  }
  if (!out.description) console.log('(no deploy description — pass --message "<why>" so the deploy fact says why; ADR-0099)');
  return out;
}

/**
 * FIRST SYNC ONLY: settle direction from git history instead of guessing.
 *
 * With no base, a file that differs on the two sides is a conflict — but very
 * often the cell is simply BEHIND: it holds a version that git had at some
 * earlier commit, and git has moved on (someone committed without deploying).
 * drive's CLAUDE.md found that by hand ("git diff <the commit before yours> --
 * <file>: an empty diff means the cell is behind"). This does the same search
 * mechanically: if the cell's bytes equal ANY of the file's last 200 committed
 * versions, the last sync is taken to be that version — so the plan says push.
 * It also catches a file git has deleted but the cell still holds, which a
 * base-less pull would otherwise resurrect. Content never seen in git is left
 * alone: that is work that exists only on the cell.
 */
function inferBaseFromHistory(localRoot, candidates) {
  const inferred = {};
  if (!candidates.length) return inferred;
  let top;
  try {
    top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return inferred;
  }
  try {
    if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8', cwd: top }).trim() === 'true') {
      console.warn('(shallow clone: history is truncated, so fewer files can be shown to be "cell behind git" — `git fetch --unshallow` for a sharper first sync)');
    }
  } catch {
    /* old git: no such flag */
  }
  const specs = [];
  for (const e of candidates) {
    const repoPath = relative(top, join(localRoot, e.path)).split('\\').join('/');
    let shas = [];
    try {
      shas = execFileSync('git', ['log', '-n', '200', '--format=%H', '--', repoPath], { encoding: 'utf8', cwd: top }).split('\n').filter(Boolean);
    } catch {
      continue;
    }
    for (const sha of shas) specs.push({ path: e.path, remote: e.remote, spec: `${sha}:${repoPath}` });
  }
  if (!specs.length) return inferred;
  // One `git cat-file --batch` for every (commit, file) pair: "<sha> <type> <size>\n<bytes>\n" each.
  const out = execFileSync('git', ['cat-file', '--batch'], { cwd: top, input: specs.map((s) => s.spec).join('\n') + '\n', maxBuffer: 1 << 30 });
  let at = 0;
  for (const s of specs) {
    const nl = out.indexOf(0x0a, at);
    const header = out.subarray(at, nl).toString('utf8');
    at = nl + 1;
    const m = /^\S+ blob (\d+)$/.exec(header);
    if (!m) continue; // "<spec> missing" — the path did not exist at that commit
    const size = Number(m[1]);
    const version = contentVersion(out.subarray(at, at + size));
    at += size + 1;
    if (version === s.remote && inferred[s.path] === undefined) inferred[s.path] = version;
  }
  return inferred;
}

// ─── reporting ───────────────────────────────────────────────────────

const short = (v) => (v ? v.replace(/^(sha256|tree):/, '').slice(0, 10) : '—');
function list(label, entries, fmt = (e) => e.path ?? e) {
  if (!entries.length) return;
  console.log(`  ${label.padEnd(14)} ${entries.length}`);
  for (const e of entries.slice(0, 15)) console.log(`      ${fmt(e)}`);
  if (entries.length > 15) console.log(`      … ${entries.length - 15} more`);
}
/** Absent on one side means deleted there if the last sync had it, else new on the other. */
const describe = (e) => {
  if (e.local === undefined) return `${e.path}  (${e.base ? 'deleted here' : 'new on the cell'})`;
  if (e.remote === undefined) return `${e.path}  (${e.base ? 'deleted on the cell' : 'new here'})`;
  return e.path;
};

async function gather() {
  const localRoot = join(process.cwd(), 'cells', name);
  const base = readBase(localRoot);
  const remote = await remoteState();
  const local = localState(localRoot);
  // The base every later step works from: the recorded one, or on a first
  // sync whatever git history can prove. It must be THIS that the next
  // .cell-sync.json is built from — building it from "no base" would forget
  // the inference and a later plan would pull a git-deleted file back.
  let effectiveBase = base?.files ?? null;
  let p = plan(local, remote.files, effectiveBase);
  let behind = [];
  if (!base) {
    const candidates = [...p.conflict, ...p.pull.filter((e) => e.local === undefined)];
    const inferred = inferBaseFromHistory(localRoot, candidates);
    behind = Object.keys(inferred);
    if (behind.length) {
      effectiveBase = inferred;
      p = plan(local, remote.files, effectiveBase);
    }
  }
  const vendor = vendorOverlay(localRoot, local);
  const vendorPush = Object.entries(vendor)
    .filter(([path, content]) => remote.files[path] !== contentVersion(Buffer.from(content, 'utf8')))
    .map(([path, content]) => ({ path, content, remote: remote.files[path] }));
  return { localRoot, base, effectiveBase, remote, local, p, vendorPush, behind: new Set(behind) };
}

function report(g) {
  const { base, remote, p, vendorPush } = g;
  const d = remote.status.deployed;
  console.log(`@${owner}/${name}  cell ${short(remote.treeVersion)}  ${remote.status.files} files`);
  console.log(`  last sync     ${base ? `${short(base.treeVersion)} at ${base.syncedAt}` : 'none — the first sync settles differences with --take'}`);
  console.log(`  deployed      ${d?.treeVersion ? `${short(d.treeVersion)}${remote.status.dirty ? ' (cell source has moved on since)' : ' (= cell source)'}` : 'not from a pinned snapshot yet'}`);
  list('↓ to pull', p.pull, describe);
  list('↑ to push', p.push, (e) => `${describe(e)}${g.behind.has(e.path) ? '  (cell behind git: matches an earlier commit)' : ''}`);
  list('✗ conflict', p.conflict, (e) =>
    base ? describe(e) : `${describe(e)}  (the cell's copy is in no commit here — cell ahead, or diverged)`,
  );
  list('↑ vendor', vendorPush);
  console.log(`  = in sync      ${p.inSync.length}`);
  list('· ignored', p.ignoredRemote, (x) => `${x}  (on the cell only; never synced — cells.deleteFile to remove)`);
}

// ─── pull ────────────────────────────────────────────────────────────

async function doPull(g) {
  const { localRoot, remote, p } = g;
  const pulls = [...p.pull];
  let conflicts = p.conflict;
  if (flag('--take') === 'remote') {
    // Taking the cell's side over a file you changed: refuse where that
    // change is not even committed yet, unless forced — it would be gone.
    const dirty = gitDirty(localRoot);
    const unsafe = conflicts.filter((c) => dirty.has(c.path));
    if (unsafe.length && !flags.includes('--force')) {
      console.error(`✗ --take remote would overwrite uncommitted local edits (commit them, or --force):\n${unsafe.map((c) => `    ${c.path}`).join('\n')}`);
      process.exit(2);
    }
    pulls.push(...conflicts);
    conflicts = [];
  }
  if (flags.includes('--dry-run')) {
    list('↓ would pull', pulls, describe);
    list('✗ conflict', conflicts, describe);
    return { conflicts };
  }
  for (const e of pulls) {
    const dest = join(localRoot, e.path);
    if (e.remote === undefined) {
      if (existsSync(dest)) unlinkSync(dest);
      console.log('deleted', e.path, '(deleted on the cell)');
      continue;
    }
    // `whole: true` because a PULL genuinely wants the entire file. Without it
    // the substrate's 60KB read budget refuses anything larger.
    const res = await call('read', 'cells.readFile', { owner, name, path: e.path, whole: true });
    // BYTES COME BACK AS BYTES: a PNG through `writeFileSync(dest, string)`
    // would be UTF-8 of a decode, and bigger than the original.
    const body = res.encoding === 'base64' ? Buffer.from(res.content, 'base64') : Buffer.from(res.content, 'utf8');
    if (contentVersion(body) !== e.remote) {
      throw new Error(`${e.path} changed on the cell while pulling — rerun`);
    }
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body);
    console.log('pulled', e.path, `(${body.length}b${res.encoding === 'base64' ? ', bytes' : ''})`);
  }
  const local = localState(localRoot);
  const files = nextBase(local, remote.files, g.effectiveBase);
  // Freeze the tree just synced against, so `diff` can compare to it later.
  // Harmless if someone wrote meanwhile: the base still names what was read.
  await call('act', 'cells.snapshot', { owner, name, ifTreeVersion: remote.treeVersion }).catch((err) => {
    console.warn(`(could not snapshot ${short(remote.treeVersion)}: ${err.message.slice(0, 120)})`);
  });
  writeBase(localRoot, remote.cellId, remote.treeVersion, files);
  console.log(`✓ ${pulls.length} pulled, ${conflicts.length} conflict(s) left — base ${short(remote.treeVersion)}`);
  if (pulls.length) console.log('  commit what came in (other agents\' work is often only on the cell): git add cells/' + name);
  return { conflicts };
}

// ─── push ────────────────────────────────────────────────────────────

function stagedPath(runId, path) {
  return `sync-staging/${runId}/${path}`;
}

/** One patch-set change (or a staged move) per pushed file. */
function buildChanges(g, pushes, runId) {
  const changes = [];
  const staged = [];
  for (const e of pushes) {
    const abs = join(g.localRoot, e.path);
    if (e.local === undefined) {
      changes.push({ op: 'delete', path: e.path, ifVersion: e.remote });
      continue;
    }
    const guard = e.remote === undefined ? { ifAbsent: true } : { ifVersion: e.remote };
    if (BINARY_RE.test(e.path)) {
      // ONE CALL, NO CHUNKING, for binary: two independently-decoded base64
      // chunks only concatenate correctly when the first is a multiple of four
      // characters. Base64 is 4/3 of the file, so the ~1MB cliff caps a binary
      // asset at about 750KB — and it FAILS LOUDLY rather than silently.
      const b64 = readFileSync(abs).toString('base64');
      if (b64.length > CHUNK * 1.6) throw new Error(`${e.path} is ${readFileSync(abs).length}b — too large to push as one signed request`);
      changes.push({ op: 'write', path: e.path, content: b64, encoding: 'base64', ...guard });
      continue;
    }
    const content = readFileSync(abs, 'utf8');
    if (JSON.stringify(content).length > CHUNK) {
      staged.push({ path: e.path, content, version: e.local, staging: stagedPath(runId, e.path) });
      changes.push({ op: 'move', from: stagedPath(runId, e.path), to: e.path, overwrite: e.remote !== undefined });
      continue;
    }
    changes.push({ op: 'write', path: e.path, content, ...guard });
  }
  for (const v of g.vendorPush) {
    changes.push({ op: 'write', path: v.path, content: v.content, ...(v.remote ? { ifVersion: v.remote } : { ifAbsent: true }) });
  }
  return { changes, staged };
}

function batches(changes) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const c of changes) {
    const n = JSON.stringify(c).length;
    if (cur.length && (size + n > BATCH_BYTES || cur.length >= BATCH_CHANGES)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(c);
    size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function uploadStaged(s) {
  let version;
  for (let at = 0; at < s.content.length || at === 0; at += CHUNK) {
    const piece = s.content.slice(at, at + CHUNK);
    const res =
      at === 0
        ? await call('act', 'cells.writeFile', { owner, name, path: s.staging, content: piece, ifAbsent: true })
        : await call('act', 'cells.appendToFile', { owner, name, path: s.staging, content: piece, ifVersion: version, ifExists: true });
    version = res.version;
  }
  if (version !== s.version) throw new Error(`staged ${s.path} came out as ${short(version)}, expected ${short(s.version)}`);
}

async function cleanupStaged(staged) {
  for (const s of staged) await call('act', 'cells.deleteFile', { owner, name, path: s.staging }).catch(() => {});
}

async function waitForDeploy(cellId, version) {
  process.stdout.write(`deploying ${cellId} v${version}`);
  const deadline = Date.now() + 180_000;
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const cell = await call('read', 'cells.get', { cellId });
    const d = cell.deploy ?? {};
    // The request's version IS the build's version now, so wait for ours.
    if (d.version && d.version !== version && Number(d.version) > Number(version)) {
      console.log(`\n↷ superseded by a newer deploy v${d.version} (${d.phase}) — that one is the one to watch`);
      return;
    }
    if (d.version === version && d.phase === 'DEPLOYED') {
      console.log(`\n✓ deployed ${cellId} v${version} — tree ${short(d.treeVersion)} · recorded as cells/${cellId}/deploy/${d.version ?? version}`);
      return;
    }
    if (d.version === version && d.phase === 'FAILED') {
      console.error(`\n✗ deploy failed: ${d.error ?? 'unknown error'}`);
      process.exit(1);
    }
    if (Date.now() > deadline) {
      // A deploy that never leaves DEPLOYING is usually the deployer out of
      // memory: nothing records it. Re-issue with cells.deploy {treeVersion}.
      console.error(`\n✗ deploy still ${d.phase ?? 'pending'} after 180s — check platform.logs {service:"cells"}; re-issue with cells.deploy {cellId, treeVersion: "${d.treeVersion ?? ''}"}`);
      process.exit(1);
    }
    process.stdout.write('.');
  }
}

async function doPush(g) {
  const { localRoot, remote, p } = g;
  const deploy = flags.includes('--deploy');
  if (p.pull.length && !flags.includes('--force')) {
    // PULL BEFORE PUSH, enforced: pushing now would deploy a tree that was
    // never built or checked locally — yours plus changes you have not seen.
    console.error(`✗ the cell has ${p.pull.length} change(s) you have not pulled — run pull (or sync) first, or --force:`);
    for (const e of p.pull.slice(0, 15)) console.error(`    ${describe(e)}`);
    process.exit(2);
  }
  const pushes = [...p.push];
  if (p.conflict.length) {
    if (flag('--take') !== 'local') {
      console.error(`✗ ${p.conflict.length} conflict(s) — changed both here and on the cell since the last sync. Nothing pushed.`);
      for (const e of p.conflict.slice(0, 15)) console.error(`    ${describe(e)}`);
      console.error('  inspect: cell-sync diff <name> --view patch --prefix <path> · settle: --take local | pull --take remote');
      process.exit(2);
    }
    pushes.push(...p.conflict);
  }
  const runId = Date.now().toString(36);
  const { changes, staged } = buildChanges(g, pushes, runId);

  if (!changes.length) {
    console.log('✓ nothing to push');
    if (deploy) {
      const started = await call('act', 'cells.deploy', { owner, name, treeVersion: remote.treeVersion, ...deployProvenance(localRoot) });
      await waitForDeploy(started.cellId, started.version);
    }
    return;
  }

  if (flags.includes('--dry-run')) {
    // Staged files cannot ride a dry run (their bodies are what the staging
    // is for), so they are checked as simple presence and listed.
    const probe = changes.filter((c) => c.op !== 'move');
    for (const s of staged) console.log(`  (staged on a real run: ${s.path}, ${s.content.length} chars)`);
    for (const b of batches(probe)) {
      const res = await call('act', 'cells.applyPatchSet', { owner, name, changes: b, ifTreeVersion: remote.treeVersion, dryRun: true });
      for (const c of res.conflicts ?? []) console.log(`  ✗ ${c.path}: ${c.error}`);
      for (const f of res.files ?? []) console.log(`  ${f.status} ${f.path}${f.added !== undefined ? `  +${f.added} -${f.removed}` : ''}`);
      if (res.diff) console.log(res.diff);
      if (res.truncated) console.log(`  (diff truncated; omitted: ${(res.omitted ?? []).join(', ')})`);
    }
    return;
  }

  let tree = remote.treeVersion;
  const pushedRemote = { ...remote.files };
  try {
    if (staged.length) {
      for (const s of staged) await uploadStaged(s);
      // The staging uploads changed the tree; confirm they are the ONLY change,
      // so the patch set's tree guard still covers everything planned against.
      const expected = treeVersionOf({ ...remote.files, ...Object.fromEntries(staged.map((s) => [s.staging, s.version])) });
      const now = (await call('read', 'cells.status', { owner, name })).treeVersion;
      if (now !== expected) throw new Error('TREE_CONFLICT: the cell changed while large files were staging — rerun');
      tree = expected;
    }
    const groups = batches(changes);
    if (groups.length > 1) console.log(`(${groups.length} patch sets — each is atomic, the push as a whole is not)`);
    for (let i = 0; i < groups.length; i++) {
      const last = i === groups.length - 1;
      const res = await call('act', 'cells.applyPatchSet', {
        owner,
        name,
        changes: groups[i],
        ifTreeVersion: tree,
        snapshot: last,
        deploy: last && deploy,
        ...(last && deploy ? deployProvenance(localRoot) : {}),
      });
      tree = res.treeVersion;
      for (const f of res.files ?? []) {
        if (f.status === 'D') delete pushedRemote[f.path];
        else pushedRemote[f.path] = f.version;
        if (f.path.startsWith('sync-staging/')) continue; // the staging copy leaving, not a change of yours
        const lines = f.movedFrom ? '  (staged upload)' : f.added !== undefined ? `  +${f.added} -${f.removed}` : '';
        console.log(`pushed ${f.status} ${f.path}${lines}`);
      }
      for (const s of staged) delete pushedRemote[s.staging];
      if (res.concurrentChanges) console.log('  (other files changed on the cell during the push — the next status will show them to pull)');
      if (last && res.deploy) {
        writeBase(localRoot, remote.cellId, tree, nextBase(localState(localRoot), pushedRemote, g.effectiveBase));
        await waitForDeploy(remote.cellId, res.deploy.version);
      }
    }
  } catch (err) {
    await cleanupStaged(staged);
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
  writeBase(localRoot, remote.cellId, tree, nextBase(localState(localRoot), pushedRemote, g.effectiveBase));
  console.log(`✓ ${changes.length} change(s) pushed — cell ${short(tree)}${deploy ? '' : ' (no deploy — pass --deploy)'}`);
}

// ─── main ────────────────────────────────────────────────────────────

const [, , cmd, name, ...flags] = process.argv;
function flag(f) {
  const i = flags.indexOf(f);
  return i === -1 ? undefined : flags[i + 1];
}
const owner = flag('--owner') ?? 'c15r';
if (!cmd || !name) {
  console.error('usage: cell-sync.mjs <status|diff|pull|push|sync> <cellName> [--owner c15r] [--deploy [--message "<why>"]] [--dry-run] [--take local|remote] [--force]');
  process.exit(1);
}
const take = flag('--take');
if (take !== undefined && take !== 'local' && take !== 'remote') {
  console.error('--take must be local or remote');
  process.exit(1);
}

if (cmd === 'status') {
  report(await gather());
} else if (cmd === 'diff') {
  const base = readBase(join(process.cwd(), 'cells', name));
  if (!base) {
    console.error('no last sync recorded — run status/pull first');
    process.exit(1);
  }
  const view = flag('--view') ?? 'files';
  const d = await call('read', 'cells.diff', { owner, name, from: base.treeVersion, to: 'current', view, ...(flag('--prefix') ? { prefix: flag('--prefix') } : {}) });
  console.log(`cell changes since the last sync (${short(d.from.treeVersion)} → ${short(d.to.treeVersion)}): +${d.counts.added} ~${d.counts.modified} -${d.counts.deleted}${d.lines ? `, +${d.lines.added}/-${d.lines.removed} lines` : ''}`);
  for (const f of d.files ?? []) console.log(`  ${f.status} ${f.path}${f.added !== undefined ? `  +${f.added} -${f.removed}` : ''}`);
  if (d.patch) console.log(d.patch);
  if (d.truncated) console.log(`(truncated — narrow with --prefix; omitted: ${d.omitted.join(', ')})`);
} else if (cmd === 'pull') {
  const g = await gather();
  report(g);
  const { conflicts } = await doPull(g);
  if (conflicts.length) process.exit(2);
} else if (cmd === 'push') {
  const g = await gather();
  report(g);
  await doPush(g);
} else if (cmd === 'sync') {
  const g = await gather();
  report(g);
  const { conflicts } = await doPull(g);
  if (flags.includes('--dry-run')) process.exit(0);
  if (conflicts.length && flag('--take') !== 'local') process.exit(2);
  // Re-read after the pull: the push must be planned against the tree as it is now.
  await doPush(await gather());
} else {
  console.error(`unknown command "${cmd}"`);
  process.exit(1);
}

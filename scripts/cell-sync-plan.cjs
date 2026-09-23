/**
 * cell-sync-plan — the pure half of cell-sync: content identity and the
 * three-way plan. No network, no filesystem; `cell-sync.mjs` gathers the three
 * states and hands them here, and tests/cell-sync-plan.test.ts drives it.
 *
 * The three states, per path:
 *   base    the version both sides agreed on at the last sync (.cell-sync.json)
 *   local   the working tree
 *   remote  the cell's src/ tree now
 *
 * Every path falls into exactly one bucket, and the rule is the whole design:
 *
 *   local == remote            in sync (even if both moved to the same bytes)
 *   local == base, remote moved   PULL   — someone else changed the cell
 *   remote == base, local moved   PUSH   — you changed it
 *   both moved, differently       CONFLICT — neither side is overwritten
 *
 * "Moved" includes created and deleted, so a file deleted locally is deleted
 * on the cell, and a file deleted on the cell is deleted locally — which the
 * old push-everything / pull-everything script could never do (a local
 * delete came straight back on the next pull). With no base yet, nothing is
 * ever deleted: an absent version equals an absent base, so a one-sided file
 * is an addition in the direction it exists, and a two-sided difference is a
 * conflict for a human (`--take`) to settle.
 */
'use strict';

const { createHash } = require('node:crypto');

/** Content version — the same `sha256:<hex>` over stored bytes the cells service reports. */
function contentVersion(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** Tree version — the service's formula: sha256 of sorted "<path>\t<version>\n" lines. */
function treeVersionOf(files) {
  const lines = Object.entries(files)
    .map(([path, version]) => `${path}\t${version}\n`)
    .sort();
  return `tree:${createHash('sha256').update(lines.join('')).digest('hex')}`;
}

/** Top-level directories that are repo-side only and never cell source. */
const SKIP = new Set(['node_modules', 'devtools', 'native']);

/**
 * Paths the sync never moves in either direction. Applied to BOTH sides now:
 * the old script skipped these on push only, so every pull wrote the cell's
 * stale `devtools/` copies back over the working tree.
 */
function isIgnored(path) {
  const segs = path.split('/');
  return SKIP.has(segs[0])
    || segs.some((s) => s.startsWith('.') || s === 'node_modules')
    || segs[0] === 'sync-staging'
    || path.endsWith('.log');
}

/** Generated at push time from cells/kernel/static (ADR-0076) — push-only, never pulled. */
function isGenerated(path) {
  return path.startsWith('vendor/');
}

/**
 * The three-way plan.
 *
 * @param {Record<string,string>} local   path → version (tracked, non-ignored, non-generated)
 * @param {Record<string,string>} remote  path → version (the whole cell tree)
 * @param {Record<string,string>|null} base  path → version at the last sync, or null (never synced)
 * @returns {{pull: Entry[], push: Entry[], conflict: Entry[], inSync: string[], ignoredRemote: string[]}}
 *   where Entry = {path, base?, local?, remote?}
 */
function plan(local, remote, base) {
  const out = { pull: [], push: [], conflict: [], inSync: [], ignoredRemote: [] };
  const paths = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base ?? {})]);
  for (const path of [...paths].sort()) {
    if (isIgnored(path)) {
      if (remote[path] !== undefined) out.ignoredRemote.push(path);
      continue;
    }
    if (isGenerated(path)) continue;
    const l = local[path];
    const r = remote[path];
    const b = base ? base[path] : undefined;
    const entry = { path, ...(b ? { base: b } : {}), ...(l ? { local: l } : {}), ...(r ? { remote: r } : {}) };
    if (l === r) out.inSync.push(path);
    else if (l === b) out.pull.push(entry);
    else if (r === b) out.push.push(entry);
    else out.conflict.push(entry);
  }
  return out;
}

/**
 * The base after a sync: every path whose two sides now agree records that
 * version; a path still in conflict keeps its old base, so the next plan
 * still sees both sides as moved and keeps refusing to guess.
 */
function nextBase(local, remote, base) {
  const next = {};
  const paths = new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base ?? {})]);
  for (const path of paths) {
    if (isIgnored(path) || isGenerated(path)) continue;
    const l = local[path];
    const r = remote[path];
    if (l === r) {
      if (l !== undefined) next[path] = l;
    } else if (base && base[path] !== undefined) {
      next[path] = base[path];
    }
  }
  return next;
}

module.exports = { contentVersion, treeVersionOf, isIgnored, isGenerated, plan, nextBase, SKIP };

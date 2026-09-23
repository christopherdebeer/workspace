# Cell storage — the S3 common layer (multi-file cells, deploy-on-update, blob data)

Gives every dynamic cell an **S3 namespace** for *source* (multi-file authoring →
build → deploy) and *data* (blobs too big/binary for DynamoDB), exposed through
the `read`/`act` gateway. It's the "val.town developer model on AWS": edit files,
deploy on save, per-cell namespace — plus a per-user blob store inside a cell.

It generalizes what forge already had: a shared **code bucket** where it dropped
`cells/<id>/<uuid>.zip`. We turn that build-artifact dump into a real source +
data layer.

## Two namespaces, different rules

| | **Source** (`src/`) | **Data** (`data/`) |
| --- | --- | --- |
| Granularity | **per cell** (code is shared by all the cell's callers) | **per cell, per caller** (`data/<cell>/<user>/…`) |
| Purpose | multi-file TypeScript → bundle → deploy | blobs / files (DynamoDB item cap is 400 KB) |
| On change | **triggers a build+deploy** (explicit by default) | never deploys |
| Isolation | forge-mediated; ownership-gated | forge-mediated; partitioned by **caller** identity |

The correction worth stating: **source is per-cell, not per-user** — a cell's code
is one thing. "Per user per cell" applies to the **data** layer, and (like the
workspace substrate scoping DynamoDB by `ctx.identity`) **per-user data isolation
is app/forge-enforced, not IAM-enforced**.

## One common bucket, prefix-scoped

One platform bucket (the existing `CodeBucket`), prefixed — **not** bucket-per-cell
(the ~1000-buckets/account ceiling, and teardown). Prefixes + IAM conditions are
S3's isolation unit (this mirrors the existing single shared code bucket, vs the
per-cell *tables*, which are separate for clean teardown).

```
s3://<CodeBucket>/
  cells/<cellId>/src/<path>           ← multi-file source (authoring)
  cells/<cellId>/build/<ts>.zip       ← built artifact (Lambda deploys from here)
  cells/<cellId>/data/<user>/<key>    ← per-caller blob store
```

## v1 is forge-mediated (no IAM change)

forge already holds `s3:*` (ReadWrite) on the bucket and `lambda:UpdateFunctionCode`
on `cell-*`. So **all S3 access goes through forge**, authorized by cell ownership
exactly like `callCell`. This keeps the blast-radius proof unchanged (only forge
touches S3) and needs **no permission-boundary / cell-template change**.

> **v2 (noted, not built):** let a cell's *own role* read/write its
> `cells/<id>/data/*` prefix directly at runtime (so a cell can serve its own
> files without a round-trip through forge). That extends the permission boundary
> with an S3 statement scoped to the cell's prefix — additive, same isolation
> shape as the per-cell table grant.
>
> **Built, for one namespace (ADR-0095).** The direct-role S3 grant now exists,
> scoped to a *third* prefix: `public/@<owner>/<slug>/~/*`. A cell that declares
> `publicNamespace` owns a CDN-fronted static prefix and is the **cache-miss
> handler** for it — CloudFront reads S3 first and falls through to the cell only
> when the object is absent, so a hit never wakes a Lambda. The boundary caps
> every cell at the `public/@*/~/*` shape; the cell template narrows the inline
> grant to that cell's own prefix. The `data/` prefix above is unchanged and
> still forge-mediated.

## The file vocabulary (on `read`/`act`)

```
read("forge.listFiles",   { cellId, prefix?, glob?, limit?, cursor?, view?: "paths"|"meta" })
read("forge.readFile",    { cellId, path, startLine?, endLine?, offset?, length?, encoding? })
read("forge.searchFiles", { cellId, query, regex?, caseSensitive?, prefix?, glob?, contextLines?, maxMatches?, cursor? })
act ("forge.writeFile",   { cellId, path, content, encoding?, ifVersion?, ifAbsent?, deploy? })
act ("forge.replaceInFile",{ cellId, path, old_str, new_str, replace_all?, expectedOccurrences?, matchIndex?, ifVersion?, dryRun?, deploy? })
act ("forge.appendToFile",{ cellId, path, content, ifVersion?, ifExists?, ifAbsent?, deploy? })
act ("forge.deleteFile",  { cellId, path, ifVersion?, deploy? })
read("forge.readFiles",   { cellId, files: [{ path, startLine?, endLine? }], maxBytes? })
read("forge.status",      { cellId })                 → treeVersion, dirty vs deployed
act ("forge.snapshot",    { cellId, ifTreeVersion? }) → immutable tree:<hash>
act ("forge.applyPatchSet",{ cellId, changes: [...], ifTreeVersion?, dryRun?, snapshot?, deploy? })
act ("forge.moveFile",    { cellId, from, to, ifVersion?, overwrite?, ifTreeVersion? })
read("forge.diff",        { cellId, from?, to?, view?: "summary"|"files"|"patch", prefix?, glob? })
act ("forge.deploy",      { cellId, treeVersion? })   // pinned: builds exactly that snapshot
act ("forge.putData",   { cellId, key, content, user? })   // data/<caller>/…
read("forge.getData",   { cellId, key, user? })
read("forge.listData",  { cellId, user? })
```
A cell can also be targeted by `owner` + `name` instead of `cellId`. So a cell is
authored, built, deployed, and given a blob store entirely through the gateway —
no `cdk deploy`, no reconnect.

## Versioned, ranged source access

Source files are observable and mutable as versioned state, not opaque blobs:

- **Every read reports a `version`** — `sha256:<hex>` of the stored bytes —
  plus `bytes`, `lines`, `contentType`, `etag`, `modifiedAt`. `listFiles`
  (`view:"meta"`) and `searchFiles` report it too.
- **Every mutation accepts it back as `ifVersion`** and fails with
  `VERSION_CONFLICT` (nothing written) if the file moved since it was read — the
  same proof-of-read idea ADR-0066 gave workspace facts. `ifAbsent` (create
  only) and `ifExists` (append never creates) guard typo'd paths.
- **Read-modify-write commits are conditional PUTs** pinned to the S3 ETag that
  was read (`If-Match`, or `If-None-Match: *` when the file was absent), so a
  concurrent writer yields a conflict rather than a lost update even when the
  caller passed no `ifVersion`. Deletes with `ifVersion` are check-then-delete
  (S3 has no conditional DELETE on general-purpose buckets).
- **`replaceInFile` refuses ambiguity before writing**: `old_str` must occur
  exactly `expectedOccurrences` times (default 1 unless `replace_all` or
  `matchIndex`); `dryRun` returns the prospective hunks.
- **Ranged reads** (`startLine`/`endLine`, or `offset`/`length`) are capped at
  ~48KB — under the substrate's 60KB read guard — and return `truncated` plus
  `nextStartLine`/`nextOffset`. A read with no range is still the whole file.
- **`searchFiles`** scans the tree server-side (binaries skipped by stored
  content type) and returns `path:line:column` hits with optional context, so
  finding a symbol in a 2.5 MB `main.ts` no longer means moving it through MCP.

## The source tree as a unit

Per-file versions make one edit safe. The tree layer makes the whole source a
unit (`services/cells/source-tree.ts`, `source-patch.ts`, `source-diff.ts`):

```
cells/<id>/src/<path>                 mutable authoring surface (unchanged)
cells/<id>/blobs/<sha256>             immutable content, stored once per version
cells/<id>/snapshots/<treehash>.json  immutable manifest: path → version + contentType
cells/<id>/tree/index.json            cache: path → {etag, version} (revalidated by ETag)
cells/<id>/tree/lock.json             patch-set commit lock + rollback journal
```

- **`treeVersion`** = `tree:sha256(sorted "<path>\t<contentVersion>\n")` — paths
  and content only, never timestamps or ETags, so the same source always has
  the same identity. `cells.status` computes it with one LIST plus a GET for
  each file whose ETag moved since the cache saw it; it stays correct for
  writes from any path (importSrc, cell-sync, other agents).
- **Snapshots** freeze a tree: server-side copies into `blobs/` pinned to the
  ETag each version was hashed from (`CopySourceIfMatch`), then a manifest. An
  unchanged file is never copied twice.
- **`applyPatchSet`** is the multi-file edit: `write | replace | append |
  delete | move` changes with the single-file preconditions (which read the
  tree *before* the patch set) plus `ifTreeVersion` for the whole tree. Every
  change is validated first — a dry run returns *all* conflicts, per-file
  +/- lines, one combined unified diff and the projected treeVersion. A real
  run takes the per-cell lock, re-validates, stores the base content in
  `blobs/`, writes a journal into the lock, then commits each file with a
  conditional PUT. If any write loses a race, every write already made is
  rolled back; if the Lambda dies mid-commit, the next lock holder replays the
  journal backwards (restoring each path still at the dead commit's version).
  The guarantee is to the author — all or nothing, never onto a tree it did
  not name; readers can see the sub-second commit window (S3 has no
  multi-object transaction). `moveFile` is a one-change patch set.
- **Deploys are source-pinned.** `cells.deploy` (and every fused `deploy:true`)
  snapshots at request time — or takes an explicit `treeVersion` — and the
  worker bundles that snapshot, not live `src/`. The request's version names
  the build; a redelivered event for a finished deploy is skipped, an event
  superseded by a newer request is skipped, and a bundle that finishes after a
  newer request re-checks the registry and does not repoint the Lambda.
  `lastDeployed {version, treeVersion, deployedAt}` records what is live.
- **`cells.diff`** compares `current`, `deployed` or any `tree:<hash>`
  (summary / files / patch views, filtered by prefix/glob) without shipping
  source through MCP. **`readFiles`** assembles several files or line ranges
  under one shared byte budget.

Not yet: deploy jobs with stages and logs (`getDeploy`), a
`cell.deploy.failed` event, a validate-without-deploy step, a symbol index,
a change feed, and garbage collection of unreferenced blobs/snapshots.

## Multi-file build = the "bundled imports" gap, closed

`docs/dynamic-cells.md` listed this open: *"v1 transpiles a single self-contained
module; bundling imported modules is next."* `forge.deploy` now reads the `src/`
tree from S3 and **`esbuild`-bundles** it (an in-memory virtual-FS plugin resolves
`./relative.ts` imports against the tree; bare/npm imports stay external) into one
`index.js`, zips it, and `UpdateFunctionCode`s the cell. forge already ships
`esbuild-wasm`, so this is an extension of the existing transpile, not a new dep.
Promotion to tier-1 also gets cleaner: copy the `src/` tree into the repo.

`createCell` is unchanged for callers (still takes `code`) but now also seeds
`src/index.ts` with that source, so any cell is immediately editable + redeployable.

## Deploy-on-update: explicit commit (default) vs auto

- **Explicit (default).** Author writes files, then `act("forge.deploy")` reads the
  current `src/` tree, bundles, deploys. Atomic (never mid-edit), no debounce,
  `git push`-like. `writeFile({ deploy: true })` is the one-shot convenience.
- **Auto (a later dev mode).** S3 `PutObject` on `…/src/*` → EventBridge → **SQS
  debounce/coalesce** → builder. Only ever fires on `src/` (never `data/`), and
  coalesces a multi-file save into one build. Not in v1.

## Safety

- **Path traversal blocked** — every `path`/`key` is normalized and rejected if it
  contains `..` or escapes the cell prefix (only `[A-Za-z0-9._/-]`).
- **`src/` vs `data/` split is hard** — only `src/` deploys; data writes never
  build.
- **Per-user data is forge-enforced** — keyed by `ctx.identity`; reading another
  user's data requires being the cell **owner**.
- **Ownership-gated** — every file/data op authorizes the caller against the cell's
  `owner`/`grants`, identical to `callCell`.
- **Secrets** never go in `src/`; use the env mechanism.

## Principals are human usernames

`<user>` (and a cell's `<owner>` in `@<owner>/<cell>`) is the caller's **username**,
not an account UUID. The auth cell exposes the human handle as the principal —
`validateBearer` resolves the account id → username, while the UUID stays the
durable anchor for credentials + token storage (token-management commands resolve
the handle back to the account id). So **dispatch addresses, substrate scopes, and
these S3 prefixes are all readable** — `@alice/notes`, scope `alice`, `data/alice/…`
— rather than `@cb47e675-…/…`. Renaming a handle is a future one-shot migration;
the account UUID is the stable join key. (Done in this PR; fixed while there's
almost no UUID-keyed data — retrofitting addressing later is painful.)

## Where it sits in the storage picture

Per `docs/sync-learnings.md` / `substrate-gaps.md`: DynamoDB stays the structured
fact + coordination floor; **S3 is the blob/file + source tier** (a fact's value
can become an S3 pointer). The Athena/Iceberg "lake" tier, if added, lives under a
separate `lake/<cellId>/` prefix in the same bucket.

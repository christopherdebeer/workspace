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

## The file vocabulary (on `read`/`act`)

```
read("forge.listFiles", { cellId })                 → src/ tree (paths)
read("forge.readFile",  { cellId, path })           → file content
act ("forge.writeFile", { cellId, path, content, deploy? })   // writes src/, optional deploy
act ("forge.deleteFile",{ cellId, path })
act ("forge.deploy",    { cellId })                 // bundle src/ → UpdateFunctionCode
act ("forge.putData",   { cellId, key, content, user? })   // data/<caller>/…
read("forge.getData",   { cellId, key, user? })
read("forge.listData",  { cellId, user? })
```
A cell can also be targeted by `owner` + `name` instead of `cellId`. So a cell is
authored, built, deployed, and given a blob store entirely through the gateway —
no `cdk deploy`, no reconnect.

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

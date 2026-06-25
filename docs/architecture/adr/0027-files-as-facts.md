# ADR-0027 — Files as facts + the public system corpus

- **Status:** Accepted (Increment 1 shipped — the docs corpus; Increments 2–3 proposed). A `file` fact
  type makes an S3 object (or a repo source/doc file) a first-class, queryable, linkable, shareable
  substrate citizen, and the repo's own docs are upserted into a **public, read-only, shared-by-all**
  corpus.
- **Date:** 2026-06-25
- **Context:** Investigation (this session) found S3 objects are reachable only through `cells.*` tools
  (`writeFile`/`readFile`/`listFiles` over `cells/<id>/src/`, `putData`/`getData`/`listData` over
  `cells/<id>/data/<user>/`), with **app-enforced** (not IAM) isolation and **no `file` fact type**. So
  files cannot be queried with `workspace.query`, linked into the graph, made salient, or shared by the
  grant model. Separately, the repo's own `docs/` (and source) live only in git — invisible to the
  substrate, so an agent can't `query` or link the very design notes that govern it. The substrate
  already has everything needed to fix both: a fact floor (ADR-0013), the Reference projection
  (ADR-0003/0016) for auto-linking, the organ write path (`substrate.write.requested`), and a `public`
  share audience that folds into every `recall`.
- **Depends on:** ADR-0013 (fact floor — a file is just a fact), ADR-0003/0016 (Reference projection &
  first-class edges — auto-linking from key structure / embedded refs), ADR-0007 (Grant axis — the
  `public` audience is the sharing primitive), ADR-0023 (`write:type:file` / `read:type:file` give the
  corpus a narrow grantable scope).

---

## Decisions

### 1. A `file` is a fact — a thin pointer, never a copy of the bytes

Type `file`, keyed `file/<path>` (e.g. `file/docs/machine.md`, `file/docs/architecture/adr/0019-….md`).
Value is metadata + an access handle, not the payload by default:

```
{ path, contentType, bytes, sha,         // identity + integrity
  content?,                              // inline ONLY for small text (docs) — makes `contains` search work
  s3Key? | url?,                         // the access handle for binary / large objects
  source }                               // provenance: "docs-sync" | "s3:PutObject" | …
```

Small text (markdown docs) stores `content` inline so `workspace.query({ contains })` is full-text over
it; binary/large objects carry `s3Key`/`url` and no inline body. The type declares a `markdown` render
hint (`cells/home/types.json`) so a `file` opens like any other fact.

### 2. The repo docs become a public, read-only, shared-by-all corpus (Increment 1 — shipped)

`scripts/docs-sync.mjs` walks `docs/**/*.md`, builds one `file/docs/<relpath>` fact each (inline
markdown, `sha`, tags `['file','docs', …'adr']`), upserts them idempotently (deterministic keys), and
`workspace.share`s the `file/docs/*` prefix to **`public` (read)**. This answers the three questions
directly:

- **Shared by all?** — one canonical copy in the owner's slice, shared `public`; every viewer's `recall`
  folds it in (no per-user duplication). *(Multiplayer evolution: move the corpus to a dedicated
  `@system` principal; the public-share model is unchanged. Deferred — single-owner today.)*
- **Default?** — yes; the `public` fold surfaces it automatically, and salience/elision keep it from
  crowding personal facts.
- **Read-only?** — yes; `public` shares are read-only by construction (`handlers.ts` rejects
  public-write), so only the platform writer (`docs-sync`) mutates the corpus. A user may **link** their
  own facts to a corpus `file` (cross-slice link to a public fact) but cannot edit it.

The script is re-runnable on doc changes (mirrors `cell-sync.mjs`); `sha` lets a later pass skip
unchanged files.

### 3. Linking — manual now, automatic via the projection

`workspace.link(fact, rel, file/<path>)` works the instant file facts exist (manual). Automatic linking
needs no new code: the **Reference projection** (ADR-0003/0016) derives edges from key structure and
embedded refs — a fact whose value mentions a `file/…` key projects a `references` edge; a `file` under
`file/cells/<id>/…` can derive a `containedBy` edge to the cell via a `keyEdges` rule. So files
participate in `neighbors`/`$graph`/centrality for free once the rules are declared.

### 4. Listing & searching ride `workspace.query` — no new tool for the common case

Once files are facts, "list/search files" is `workspace.query({ type:'file', prefix, contains })` — type
filter + key-prefix + substring search + cursor, all already implemented. The thin `cells.listFiles`/
`listData` S3-prefix listers remain for cell authoring. (Optional cheap adds, separate: a
`workspace.stats` count-by-type/tag; `cells.listFiles({ contains })`. True file *content* search beyond
`contains` would need a search index — out of scope.)

## Consequences

- The substrate's own design docs are now queryable/linkable/shareable facts — an agent can `query
  type=file` or `contains:"macaroon"` and link a decision to the ADR that governs it.
- `file` is the single representation for "a file" whether it originates from S3, a cell's `src/`, or the
  repo — Increments 2–3 reuse the same type.
- The corpus is bounded and safe: read-only, public, single-writer, deterministic keys (idempotent
  re-sync), inline content only for small text.

## Increments

- **1 — Docs corpus (shipped):** `file` type + `docs-sync.mjs` + public share. Pure substrate writes; no
  new AWS infra, no cell redeploy required for the facts (render hint lands with the next `home` deploy).
- **2 — S3 → file fact auto-mirror (proposed):** an S3 EventBridge notification on the `CodeBucket`
  (`data/` prefix) → the existing `substrate.write.requested` organ path → upsert/retire a `file` fact
  per object. ~1 rule + a handler branch. Scope it (opt-in per cell / `data/` only) so build artifacts
  aren't fact-ified.
- **3 — Cell-source manifests (proposed):** on `cell.deployed`, project a `file`-typed source manifest so
  `cells/<id>/src/` is queryable, completing "any file is a fact."

## Open / follow-ups

- **Which prefixes to mirror** in Increment 2 (all `data/`? opt-in?) — volume vs completeness.
- **Source beyond docs** — "not limited to docs": ingest `cells/**`/`services/**` as `file/src/…`? Large;
  better served by Increment 3 (manifests) + on-demand `readFile` than by inlining every source file.
- **`@system` principal** for true multiplayer (vs the owner-slice + public-share used now).
- **Content search** beyond substring `contains` (a real index) if the corpus grows.

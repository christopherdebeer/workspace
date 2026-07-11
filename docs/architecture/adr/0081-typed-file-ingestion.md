# ADR-0081 — Typed file ingestion: the put seam infers, the type's manager enriches

- **Status:** Proposed 2026-07-11 (buffer — owner-directed design, feedback before build).
- **Depends on:** ADR-0027 (docs-sync), ADR-0057 (collections family), ADR-0073/0077
  (the organ that could backfill), the substrate-native-artifact finding
  (`kb/substrate-native-artifacts` — the same seam used as the artifact workaround).
- **Owner direction (verbatim intent):** don't manually weave the files — step back
  and fix HOW files enter. Putting a file should infer type from extension/MIME so a
  markdown put or an image binary becomes an appropriately TYPED fact; the type's
  managing cell (e.g. `@c15r/lit` for markdown) then parses content for links/edges
  and populates the substrate.

## Context (grounded)

- `scripts/docs-sync.mjs` (deploy.yml) writes every `docs/**.md` as
  `file/docs/<relpath>` with **one flat `type: 'file'`** — 165 live facts. The key
  IS the path; the markdown still carries its relative links
  (`compose.md` → `[breathe.md](./breathe.md)`), but nothing reads them: the tending
  audit has counted these as the chronic unlinked backlog (~396) for weeks.
- Type is where ALL behaviour hangs — `$types` (open/edit/render, manager),
  `_config/typography` letterforms, home-graph affordances. A flat `file` type makes
  every document inert regardless of content.
- The same put seam served as the **substrate-native artifact workaround**
  (public HTML blobs) — untyped there too.
- `@c15r/lit` already decomposes markdown links for RENDERING; the knowledge of what
  a markdown file references exists in code but never becomes edges.

## Sketch

1. **Infer type at the put seam.** A small extension/MIME → type table applied by
   docs-sync AND any file-put tool (`cells.putData`, future `workspace.putFile`):
   `.md → doc` (managed by `@c15r/lit`), images → `image`, `.html` (public) →
   `artifact`, structured data → `data`; unknown stays `file`. The table is CONFIG
   (`_config/ingestion`), not code — the `_config/typography` precedent; the
   vocabulary evolves at runtime.
2. **The type's manager enriches, reactively.** `@c15r/lit` registers a
   subscription on doc-typed writes: parse markdown links (same decomposition it
   renders with), resolve relative paths against the fact's own path-key, and
   materialize authored `references` edges to sibling file facts + wiki-links to
   `kb/*`. Enrichment is a REACTION to ingestion — never a manual batch weave.
   (Images: the image manager can later extract dimensions/EXIF the same way.)
3. **Folders are collections.** The put seam knows the path: emit a member edge to
   a per-folder collection fact (`folder/docs/architecture/adr` …, ADR-0057 shape).
   The home graph's container-constellation pass then names folder regions with
   ZERO renderer changes.
4. **Backfill = re-put, not weave.** Existing 165 facts migrate by re-running
   docs-sync under the new table (idempotent, sha-keyed); the organ may propose
   retypes for non-docs files as suggestions.

## Why now (buffer rationale)

The map now surfaces places (constellations from membership) and the tending organ
is scored on linkage delta — both starve while the largest fact family enters
untyped and unlinked. Fixing the seam converts the chronic backlog into structure
as a side-effect of the next deploy.

## Open questions

- `doc` vs a distinct `markdown` type (lit currently manages `doc`?) — align with
  `$types` before build.
- Wiki-link syntax (`[[...]]`) resolution rules against non-file keys.
- Should folder collections be capped by depth (top 2–3 levels) to avoid
  one-file folders becoming noise places?

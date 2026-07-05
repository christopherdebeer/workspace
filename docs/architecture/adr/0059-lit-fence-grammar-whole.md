# ADR-0059 — The lit fence grammar, whole: declaration with a round-trip

- **Status:** Inc 1 shipped 2026-07-04 (lit v1783206702586, SSR live-verified
  on doc:sn-demo) — full grammar + serializer in `cells/lit/fence.ts` (pure,
  10 pinned tests incl. dotlit's own parser.lit example); output cells render
  as labelled bands and never re-execute; `md !warn`-family admonitions;
  `#tag` reconciliation + `doc-block` type fix in saveCell. One deliberate
  deviation, documented in fence.ts: dotlit's serializer wasn't a fixpoint
  (`< txt source.jsx` re-parsed wrong); ours is — sources detected by shape.
  Inc 2 (outbox) and Inc 3 (scoped live-sync) open.
- **Depends on:** ADR-0053 (outbox — lit adopts it here), ADR-0055 (scoped
  feeds — lit's live sync arrives here), ADR-0054 (members read). Levels up
  `@c15r/lit` against the verified dotlit source (`parser/codeblocks.js`,
  `metaToString`), continuing `docs/dotlit-review.md` §1 and
  `docs/lit-substrate-authoring.md` §3.

## Context (grounded — verified against both codebases this session)

dotlit's fence line is a complete declared vocabulary with a faithful
serializer (`codeblocks.js parseMeta`/`metaToString`):

```
[>] lang [filename|uri] !directive… attr=val… #tag… [< source-meta] [> output-meta]
```

Verified nuances lit's current `parseFence` (`client/main.tsx:213-230`) lacks:

- **Leading `>` = an OUTPUT cell** (`isOutput`): `>img out.svg attached=true
  updated=1625694616836`, `>md !warn`, `>search`. lit doesn't recognize the
  form at all — dotlit corpora (and our own hoisted docs) contain them.
- **`< src` and `> out` are recursively parsed metas**, not bare tokens:
  `> img influences.svg` means `output = {lang:'img', filename:'…'}`. lit
  parses them into `fence.in/out` as strings and then **never reads them**
  (verified: zero consumers).
- **filename vs uri** distinction (position-1 token; `http`/`//` = uri),
  escaped spaces in tokens, unknown-token collection.
- **No serializer.** dotlit's `metaToString` round-trips the grammar; lit can
  parse (half of) a fence but cannot write one back, so no code path can
  MODIFY a declaration (attach provenance, toggle a directive) without
  hand-splicing strings.
- **`#tag` tokens are parsed and dropped** — they never reach the fact's tags,
  though the fact model has real tags a query can hit.
- **Declared-vs-written type drift**: `types.json` declares prose as
  `doc-block`; `saveCell` writes `type:'cell'` (`main.tsx:108`). The declared
  vocabulary and the code disagree — and "cell" collides with parc.land's
  deployable-cell noun (open decision #4 in `lit-substrate-authoring.md`).
- **Plumbing parity**: lit predates ADR-0053/0055 — no outbox (ad-hoc
  optimistic writes), no live sync at all (verified: zero `changes` calls
  despite the design doc listing it as MVP).

## Decision

**One grammar, parsed AND serialized, shared by both halves of the cell.**

1. `parseFence`/`fenceToString` move to `shared.tsx` and implement the full
   dotlit grammar: leading `>` (output cells), recursive `<`/`>` metas,
   filename/uri, escaped spaces, directives/attrs/tags/unknowns. Round-trip
   is property-tested (`fenceToString(parseFence(s)) ≈ s` on the corpus).
   `data-fence` (already preserved on both halves) is the transport.
2. **The fence line is the declaration; save reconciles it into the graph**
   (the syncCellLinks pattern): `#tags` → fact tags (add/remove diff);
   declarations stay readable as plain text in `content` — the substrate
   indexes what the text declares. `attrs`/`directives` are NOT copied into
   the fact value (one source of truth: the fence).
3. **Naming lands (open decision #4): the prose type is `doc-block`** — the
   declared vocabulary wins over the code's `'cell'`, freeing "cell" for
   deployable cells. `saveCell` writes `type:'doc-block'`; readers treat
   `'cell'` as a legacy alias (query both during migration; a tending sweep
   can retype stragglers later). Key prefix `cell:` stays (keys are opaque;
   renaming keys would break links).
4. **lit joins the sync seam**: writes route through the kernel outbox
   (ADR-0053 — echo windows, retry, priming), and the doc view tails
   `workspace.changes` with `scope: {prefixes: ['cell:', 'out:', 'doc:',
   '_doc/<docId>/'], ops: ['write','supersede']}` (ADR-0055) on the canvas's
   adaptive cadence — remote edits (an agent appending cells, a run
   completing) appear without reload, at ~0 bytes/tick idle.
5. **Output cells render as members of their source**: a `>lang …` fence
   directly after a code fence displays as that cell's output band
   (dotlit's `attached` grouping, `cells-v3.js:40`) — inert content for now;
   ADR-0060 makes execution PRODUCE them as facts.

## Increments

1. Grammar + serializer in shared, round-trip tests; `#tag` reconciliation
   on save; `doc-block` type fix (write-side + read-alias).
2. Outbox adoption for saveCell/writeOrder/saveDocMeta/renderer writes.
3. Scoped live-sync tick for the open doc; `>`-fence output-band rendering.

## Costs & open questions

- Grammar in shared runs on the server too — SSR must never execute anything
  (it only classifies for rendering); the executable paths remain
  client-only behind `isAuthed`.
- Tag reconciliation makes a fence edit a 2-write save (fact + tags ride the
  same remember) — the outbox coalesces, and tags-carrying writes already
  bypass value-dedupe (ADR-0053).
- Open (buffer): should `viewer=`/`repl=` attrs ALSO become typed links
  (`rendersWith`/`executesWith`) for graph visibility? Leaning yes but in
  ADR-0060 where execution gets its provenance story.

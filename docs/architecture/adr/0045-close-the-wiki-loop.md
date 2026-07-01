# ADR-0045 — Close the wiki loop: automatic corpus, every source compiles, the lattice as live structure

- **Status:** Shipped + live-verified 2026-07-01 (all three decisions). One follow-on open (§Open).
- **Date:** 2026-07-01
- **Depends on:** ADR-0027 (files as facts — the docs corpus), ADR-0040 (the wiki compile loop),
  ADR-0030/0031/0032 (semantic index → inferred `similarTo` edges → ratifiable suggestions),
  ADR-0003 (embedded-ref edge derivation), ADR-0044 (the distillation laws — L1 declare-once, L4
  structure-over-knobs, L5 verify-live all apply here).

---

## The finding (read from the live substrate, not the docs)

Three nascent features of the Karpathy-LLM-wiki direction were each **working but incomplete**, and each
incompleteness was the same shape — a manual or partial step where the platform should close the loop:

1. **The docs corpus was 6 days stale.** `file/docs/*` (ADR-0027) is upserted by a *manual* `docs-sync`
   run; the last run was 2026-06-25, so **ADRs 0029–0044 — sixteen decision records, including the ones
   governing the running system — were invisible to the substrate** that they govern. Worse, the script
   re-ingested every doc unconditionally, so automating it naively would have bumped ~90 revisions per
   deploy (phantom trajectory activity corrupting salience).
2. **The compile loop only heard one ingest path.** `_subscriptions/wiki.compile` (ADR-0040, live and
   proven — it produced `kb/lattice-of-mental-models-and-wiki`, surviving a mid-run anthropic→openai
   provider fallback) matches `{type:"reading"}` only. The `source` type — the other named ingest shape
   in ADR-0040's own capture design — never fired it.
3. **The mental-model lattice was trapped in a blob.** ~70 models (Farnam Street's latticework) lived
   *inside* `reading/farnam-street-mental-models`'s markdown content — one fact, one embedding. The
   whole point of the earlier mental-models exploration ("semantic linking automatically surfacing
   models beside otherwise-unlinked facts — lenses applied automatically") was structurally impossible:
   the vector index (ADR-0030) embeds *facts*, so a list inside one fact can never be individually
   similar to anything.

## Decisions (all shipped)

### 1. The docs corpus syncs on every deploy, change-detected

`scripts/docs-sync.mjs` gained **sha change-detection** (read the live corpus's `sha`s via one paged
`workspace.query`, ingest only new/changed; a failed read degrades to the full idempotent ingest, never
to a skipped sync), and `deploy.yml` gained a post-CDK step that runs `docs-sync --commit` — gated on a
`PARC_TOKEN` repo secret (a narrow non-expiring `read:workspace write:workspace` token, label
`docs-sync-ci`), `continue-on-error` so a sync hiccup never fails a deploy. **Live proof:** the catch-up
run ingested exactly the 20 new/changed of 88 files (ADRs 0029–0044 among them); the immediate second
run ingested **0** ("corpus already current"). The substrate now always carries the ADRs that govern it,
one deploy behind at most.

### 2. Every ingest shape compiles

Registered `_subscriptions/wiki.compile.source` — the `{type:"source"}` twin of `wiki.compile`, same
deliver (`@c15r/models.agent`), same one-grounded-claim contract. Both named ingest paths of ADR-0040
now feed the wiki. (Deliberately **not** compiling `file` facts: the docs corpus is *reference*
material, not captured sources — auto-compiling ~90 docs would flood `kb/` with synthesis spam. An
agent citing a doc in a claim's `support` is the right way corpus facts enter the graph.)

### 3. The latticework becomes live structure — the lens mechanism is decomposition, not new machinery

Declared a **`mental-model` type** (🧭, managed by `@c15r/home`; `{name, gloss, category, source}` with
`source` a `ref` field, `rel:"from"`) and decomposed the Farnam Street reading into **70 individual
`model/<slug>` facts** (parsed mechanically from the reading's own content; deterministic keys,
idempotent ingest; tagged by discipline). This is L4 (structure over knobs) verbatim: **no new
mechanism was built.** The existing machinery did the rest, verified live within seconds of ingest:

- the **stream indexer embedded each model** and `platform/vectors` materialized `similarTo` edges
  (e.g. `model/second-order-thinking ↔ model/first-principles-thinking`, score 0.38);
- the declared `ref` field projects a derived **`from` edge to the source reading** (ADR-0003, strength
  0.6) — provenance as graph, not prose;
- each model is now **ratifiable** (ADR-0032): an inferred model↔fact edge can graduate to a typed,
  authored one when it earns it.

The "lens" the mental-models exploration wanted **is** this: as new knowledge/decision/claim facts are
written, the indexer wires the semantically-nearest models beside them automatically — inversion shows
up next to a failure post-mortem, second-order-thinking next to a consequential decision — surfacing in
`neighbors`, `$graph`, salience centrality, and every reader (home, lit backlinks, the card) with zero
surface changes.

## Consequences

- **The wiki loop is closed end-to-end as platform behavior:** repo docs → corpus facts (automatic,
  per-deploy) · captures/sources → grounded `kb/` claims (both types, reactive) · the lattice →
  individually-embedded lens facts (decomposed, self-linking). Each stage is declared vocabulary +
  existing organs — no new services.
- **Trajectory hygiene preserved:** change-detection means an idle deploy writes nothing; the corpus
  no longer trades freshness against salience pollution.
- **The lattice is extensible by capture:** ingest another models source (as `reading` or `source`),
  decompose to `model/<slug>` facts, and both the compile loop and the lens wiring pick it up — the
  Farnam seeding script is the worked example, not a special case.

## Open

- **Two lattice categories missing:** the Farnam extraction notes *Military and War* and *Human Nature
  and Judgment* were truncated at capture (~30 models). Re-extract from the canonical URL and ingest —
  pure capture work, the pipeline is ready.
- **Ratification ergonomics** (ADR-0032 Inc 3) now has a concrete population to serve: model↔fact
  suggestions are exactly the edges a human would enjoy typing (`applies-to`, `explains`,
  `warned-about`). Revisit when tending surfaces them.
- **docs corpus → compile, selectively?** If a *specific* doc deserves wiki synthesis (a new ADR, say),
  an explicit re-tag or a capture citing it is the path — keep the blanket exclusion.

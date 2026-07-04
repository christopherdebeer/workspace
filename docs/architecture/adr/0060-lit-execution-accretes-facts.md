# ADR-0060 — lit execution accretes facts: outputs with provenance, never inline

- **Status:** Inc 1 shipped 2026-07-04 (viewers v1783207497234, lit
  v1783207606823; SSR live-verified on doc:sn-demo) — fence-declared `> out`
  targets auto-persist every completed run (error text included, tagged
  'error'; previous output superseded unless `!keep`; explicit `> lang key`
  writes THAT fact); `out:<src>:<ts>` members render as attached output
  bands with linked provenance on BOTH halves (parity contract held).
  Inc 2 (`_repls` ladder) and Inc 3 (gated exec=onload) open.
- **Depends on:** ADR-0059 (the grammar carries the declarations), ADR-0053
  (writes ride the outbox), `docs/declarative-actions-vs-code-cells.md` (the
  execution gradient: reef → organ). Verified against dotlit
  `components/Cell.jsx:82-133` and the live lit/run/models/viewers seams.

## Context (grounded)

dotlit's execution model, verified at source:

- Run a cell → the result is **appended to the document** as an output cell:
  ` ```>txt attached=true updated=<ts> [!error] ` — content with provenance
  (what produced it, when, did it fail). With a declared target
  (`> img out.svg`) the result is written to the FILESYSTEM and the appended
  cell **transcludes it by reference** (` ```>img … < out.svg `) — dotlit
  reached for reference-over-copy even for outputs, inside markdown.
- `attached=true` is structural: the parser folds an attached output into
  the PRECEDING cell (`cells-v3.js:40`) — source + outputs are one unit.
- The repl ladder: `repl=` attr → per-document repl plugin → builtin. Plus
  `exec=onload` (auto-run at open), `!error` marking, ``` → ••• escaping
  (an artifact of outputs living inside fences).
- And the bug that defines the ceiling (their own TODO): outputs and
  transclusions "persisted inline" — copies drift. Files-as-store could not
  give outputs an identity.

lit already has half the substrate answer deployed: the viewers repl writes
`out:<cellKey>:<ts>` facts `produced-by` the cell, and `onOutput`/
`onAgentOutput` place them as doc members. What's missing is the DECLARED
half — `> out` targets, attachment rendering, `!error`, the repl ladder as
data — and closure of the drift class.

## Decision

**Execution is a substrate event: source fact → executor → output fact +
placement + link. The document accretes references, never bodies.**

1. **`> out` targets become fact addresses.** `repl=uml > mermaid` (bare) =
   output fact minted as `out:<cellKey>:<ts>` typed by the output meta's
   lang; `> img key:...` (explicit key) = write THAT fact (CAS-guarded).
   The placement lands directly after the source (`seqBetween`), the link is
   `source --produces--> out` (both already the deployed pattern; this makes
   the fence's declaration drive them).
2. **Attachment is adjacency + link, rendered as one unit.** A doc view
   folds `produces`-linked members that sit adjacent to their source into
   dotlit's source+output cell group (collapse toggles together; output band
   shows `via · updatedAt`, terracotta edge when the run errored). No
   `attached=true` attr is written — provenance lives in `_meta`/links,
   which is what the attr was faking in text.
3. **`!error` is honest**: a failed run still writes the output fact (the
   error text IS the output) with `tags: ['error']` — visible, linkable,
   tendable; the ••• escaping hack dissolves because outputs are facts, not
   fence bodies.
4. **The executor ladder is declared, not hardcoded** (`repl=` resolution):
   `repl=server|run` → `@c15r/run`; `repl=agent`/`agent` lang →
   `@c15r/models.agent`; a `_repls/<name>` fact (source, like
   `_renderers/*`) → client module via the ctx SDK (ADR-0056 — same
   provenance gate); else the builtin js repl. dotlit's per-document repl
   plugins map to `!plugin type=repl of=<name>` fences registering
   `_repls/<name>` — the scope ladder from dotlit-review §2, on facts.
5. **`exec=onload` is gated**: auto-run only for owner-authored cells
   (ADR-0056's provenance rule), never for anonymous readers, never during
   SSR. It exists for live-document dashboards; the gate keeps it from being
   an XSS-on-open.

## Increments

1. `> out` targets + placement/link wiring through the declared grammar;
   attachment rendering (source+output group); `!error`/tags.
2. `_repls/<name>` registry + `repl=` ladder resolution via ctx (0056).
3. `exec=onload` behind the provenance gate; a doc that auto-runs shows a
   run-badge tally in its header.

## Costs & open questions

- Output facts accumulate (`out:<cellKey>:<ts>` per run). Policy: a new run
  SUPERSEDES the previous output fact by default (`supersede(prev, by:new)`)
  — history stays walkable; `!keep` opts out (append-only accretion).
- Cross-principal execution stays deferred (grants-to-principals,
  `docs/scope-grants.md`) — run-as-owner only, unchanged.
- Open: should `executesWith`/`rendersWith` links be written from `repl=`/
  `viewer=` attrs (graph visibility of the toolchain)? Proposed yes, at save
  time, same reconciliation as tags (from ADR-0059's open question).

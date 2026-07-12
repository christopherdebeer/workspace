# ADR-0083 — Async, chunked decomposeMarkdown (the reindex pattern, applied to lit)

- **Status:** Proposed 2026-07-12 (buffer — root cause fully diagnosed and grounded live,
  fix sketched by direct analogy to a pattern already shipped; not yet built).
- **Depends on:** ADR-0081 (typed file ingestion — `@c15r/lit.decomposeMarkdown`, the tool this
  fixes), ADR-0030/0031 (`workspace.reindex` — the async/chunked/continuation-event pattern this
  ADR proposes reusing, not inventing), ADR-0082 (the sibling RFC on `workspace.project`'s
  monolith-fact problem — a different symptom of the same "one synchronous call over unbounded
  work" shape).
- **Context doc:** this session's live incident chasing `decomposeMarkdown` failures on large docs
  (`docs/ancestor/sync/agency-and-identity.md`, 99 blocks; `sigma-calculus.md`, 92; `breathe.md`,
  61) during the ADR-0081 corpus backfill.

## The question

`@c15r/lit.decomposeMarkdown` (`cells/lit/tools.ts`) turns one markdown source into `doc` +
`doc-block` + `doc-order` facts + edges, as ONE synchronous call: read existing state, write every
fact, reconcile every block's links, return. For a large doc this exceeds both the platform's request
timeout and the Lambda's own execution budget, and — critically — does so **silently and
inconsistently**: some docs land fully, some partially, some not at all, depending on exactly where
the clock runs out. Should this become async and chunked, the way `workspace.reindex` already is?

## Findings (grounded — this session, live diagnosis)

1. **The ~30s gateway ceiling applies to EVERY `gw()` call inside decomposeMarkdown, not just the
   outer request.** `tools.ts`'s `gw()` helper (wrapping the vendored `gwCall`) hits
   `https://parc.land/mcp` for every sub-operation — each `workspace.ingest` chunk, each
   `workspace.neighbors`/`workspace.unlink` in the edge-reconciliation loop. CloudFront's
   `FunctionUrlOrigin` default origin timeout (~30s, no override — `platform/infra/
   service-router.ts:178-181`, the same ceiling ADR-0081's home-cell incident hit) applies to each
   of these inner calls independently of the lit cell's own configured Lambda `timeoutSeconds`.
2. **`workspace.ingest` writes facts sequentially, at a measured ~0.85s/fact.** (`services/
   workspace/commands-write.ts`'s `ingest` handler: `for (const f of input.facts) { await
   state.put(...) }` — no batching, no parallelism, by design: "intake should not storm the bus.")
   A 100-fact ingest chunk is therefore ~85s of server-side work — comfortably past the 30s ceiling
   on THAT SPECIFIC inner `gw()` call, which throws uncaught partway through
   `decomposeMarkdown`'s `for` loop over chunks, aborting the whole run.
3. **Neither a bigger Lambda timeout nor a bare chunk-size fix solves this alone — confirmed by
   process of elimination, live:**
   - Bumping the lit cell's own `timeoutSeconds` 60→300s (`cells.configureCell`) changed nothing —
     the *outer* Lambda had headroom the *inner* gateway calls never got to use, because those inner
     calls die at ~30s regardless of how long the invoking Lambda is willing to wait.
   - Chunking `workspace.ingest` calls to ≤100 facts (fixing the command's own hard 100-fact cap)
     was necessary but insufficient — a 100-fact chunk (~85s) still exceeds the inner 30s ceiling.
   - Shrinking chunks to 30 facts (~25s, under the ceiling) got further but still didn't converge
     for the two largest docs (99 and 92 blocks — total fact counts of ~199 and ~185, meaning ~7 and
     ~6 chunks respectively, each individually now safe, but the *sum* across chunks plus the
     edge-reconciliation pass still risks the outer call's own accumulated wall-clock and leaves no
     margin for retry/backoff).
4. **Partial, silent failure is the worse problem — worse than slowness itself.** A doc that gets
   "most of the way" leaves the substrate in an inconsistent state indistinguishable, from the
   outside, from a fully-decomposed doc: some `doc-block`s exist without their `doc-order`
   decoration (invisible to `workspace.members`, exactly ADR-0081's home-cell incident), or —
   observed live on a re-run — STALE decorations survive because a partial run's block set differs
   from a later run's and nothing reconciles the difference (`breathe.md` ended up with 70 order
   decorations for 61 actual blocks after two partial retries). There is no status the caller can
   check, no resumability, and no idempotent convergence guarantee for a doc large enough to hit any
   of the ceilings above.
5. **`workspace.reindex` already solved this exact shape of problem, for a similar reason.**
   ADR-0030/0031's `reindex` command (`commands-search.ts`'s `reindex` + `createReindexHandler`)
   embeds "hundreds of Titan calls — far over the ~30s edge cap AND the 60s Lambda" by NOT trying to
   do it synchronously at all: `reindex` writes a `_reindex/<scope>` status fact, emits ONE
   `workspace.reindex.requested` event, and returns immediately (`{status: 'started', poll:
   statusKey}`). `createReindexHandler` — an EventBridge handler, not a synchronous command —
   processes exactly one bounded page per invocation and, if not done, updates the status fact and
   emits a fresh continuation event with an updated cursor, chaining itself. The caller polls
   `peek(statusKey)` for `{status, phase, indexed, edges}`. No single invocation, ever, does more
   than one bounded unit of work — the ~30s/60s ceilings become irrelevant because nothing tries to
   exceed them.

## Sketch (decisions, tentative — mirrors reindex's shape, not inventing a new one)

1. **`decomposeMarkdown` becomes async + chunked**, the same three-part shape as `reindex`:
   - **Dispatch** (synchronous, fast): write a `_decompose/<docKey>` status fact
     (`{status:'running', phase:'blocks'|'order'|'links', done, total, startedAt}`), emit one
     `lit.decompose.requested` event (`{path, content, phase, cursor, ...}`), return
     `{status:'started', poll: statusKey}` immediately — the same contract shape `reindex` already
     established, so callers (`docs-sync.mjs`, the `_subscriptions/*` reaction) don't need a new
     mental model.
   - **Chunk handler** (an EventBridge handler, not the `/_tools/decomposeMarkdown` HTTP path):
     processes ONE bounded batch (e.g. the existing 30-fact `workspace.ingest` chunk) per
     invocation, updates the status fact, and either emits the next continuation event (more work
     remains) or marks `status:'done'`. Phases run in sequence — blocks+order facts first (the part
     that actually fixes visibility), edge reconciliation last (already the lower-priority, "best
     effort" phase per the existing code's own framing) — so a doc that only gets partway still has
     its membership correct, unlike today's all-or-nothing failure mode.
   - **Idempotent resume, not silent partial state:** because chunk N always starts from a
     `workspace.query({prefix, cursor})` over what's already written (mirroring `reindex`'s own
     cursor-resume design) rather than assuming a from-scratch run, a doc interrupted mid-chunk (a
     cold start, a transient error) resumes correctly on the next scheduled/triggered continuation —
     no more stale-duplicate accumulation like `breathe.md`'s.
2. **Small docs stay fast.** The dispatch step can synchronously fast-path a doc whose total fact
   count fits in one chunk (the overwhelming majority — only ~5 of 155 in this corpus needed more
   than one), so `docs-sync.mjs`'s existing bounded-concurrency loop barely changes behavior for the
   common case; only the long tail of large docs gets the async treatment.
3. **`docs-sync.mjs` polls, like `reindex`'s callers already do.** Instead of
   `call('act', '@c15r/lit.decomposeMarkdown', ...)` awaiting one synchronous response, it dispatches
   and polls `_decompose/<docKey>` until `status:'done'` (bounded retries/backoff, same shape as any
   `reindex` poller) — a mechanical change to the script's `decomposeAll`, not a redesign.

## Why now (buffer rationale)

The bug this ADR fixes isn't hypothetical: it left 4 real docs in inconsistent, silently-broken
states this session, after three separate mitigation attempts (Lambda timeout bump, 100-fact
chunking, 30-fact chunking) each failed to fully converge — the pattern of failure (works for most
docs, breaks unpredictably for the largest, no visibility into why) is exactly what an async/chunked
redesign eliminates by construction, the same way it already eliminated the equivalent problem for
`reindex`. Doing it now, while the diagnosis is fresh and grounded in specific measured numbers
(~0.85s/fact, ~30s ceiling, exact doc sizes that fail), avoids re-deriving this the next time a large
doc (or a growing corpus of medium docs) trips the same ceiling.

## Open questions

- Should `docs-sync.mjs`'s bulk migration path (`--commit --force` over the whole corpus) use the
  same async/poll contract for every doc, or only fall back to it when a doc's fact count exceeds
  the single-chunk threshold (Sketch item 2)? The latter keeps the common-case script simpler; the
  former is more uniform and never needs a "which path does this doc take" branch.
- `reindex`'s continuation events are scoped `{scope}`, one reindex-in-flight per scope at a time
  (a status fact keyed by scope). `decomposeMarkdown` is per-DOC, not per-scope — many docs could be
  mid-decompose concurrently (exactly what `docs-sync.mjs`'s `DECOMPOSE_CONCURRENCY=4` already does).
  Does the status-fact key need to be `_decompose/<docKey>` (one per doc, naturally supporting
  concurrent docs), or does a shared concurrency limiter need to move from the client
  (`docs-sync.mjs`'s worker pool) to the server (bounding how many decompose chains run at once)?
- Cleanup for docs already left inconsistent by this session's partial runs (`breathe.md`'s stale
  duplicate order decorations, and whatever partial state `agency-and-identity`/`sigma-calculus`/
  `adaptive-salience` are currently in) — a one-off supersede pass once the async path lands, or
  does the async path's own idempotent-resume logic naturally self-heal them on its first run?

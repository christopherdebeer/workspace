# Linking without unlinking

*2026-07-29 — the content-lifecycle audit, and what opening the queue found that counting it missed.*

## The question

> "we are accruing content but not organising and maintaining content just adding and
> linking"

The audit that followed produced a set of numbers that all pointed the same way:

| | |
|---|---|
| facts in the slice | 7,652 |
| elided (below the salience floor) | 6,053 · 79% |
| from `docs-sync` → `lit` decompose | 5,588 · 73% |
| authored semantic edges | 376 |
| inferred semantic edges | 33,105 · **1:88** |
| suggestions pending | 15,482 |
| ratifications per consolidation cycle | 5 |
| new suggestions per day | +169 · **34:1** |
| contested pairs / ever adjudicated | 2,662 / 65 |
| backlog, 20 days | 1,014 → 5,382 |

Read together these say: *inflow overwhelms throughput at every organ.* The obvious
remedies follow from that reading — gate the decompose fan-out at the ingest seam, give
elided facts a decay path, raise the ratification cap. The first was flagged as a product
call, because it means deciding that some documentation should not become facts at all.

That reading was wrong, and every remedy that followed from it would have been wasted work.

## What opening the queue found

`suggestions({genuineOnly:true})` — the filtered view, the one that has already dropped
byte-identical pairs, same-source pairs, runtime plumbing, leases and presence rows —
returned 9,901 candidates. **The top twelve by cosine contained zero genuine connections.**

Two led at 0.99997:

```
doc-block:docs/dynamic-cells/9      "## Architecture"
doc-block:docs/workspace-ec2/1      "## Architecture"
  --similarTo 0.9999-->  doc-block:docs/ancestor/sync/frontend-unify/4
```

Block 4 of `frontend-unify` is a TypeScript snippet — a `renderToString` /
`ServerStyleSheet` example. A markdown heading and a code block do not have a cosine of
0.99997 under any working embedder.

Three reads settled what was happening:

1. **The index is healthy.** `query("## Architecture")` ranks the two heading blocks at
   relevance 1.0 and does not return block 4 at all. The vectors are right.
2. **Block 4's own outbound edges are healthy.** All five, written 2026-07-22, score
   0.51–0.55, all to code siblings in the same document. Correct and current.
3. **Only the inbound edges are wrong**, and they were written 2026-07-11 and 07-12.

## The mechanism

`refreshSimilarEdges` reconciles `mine = existing.filter(e => e.from === key)`. Outbound
only.

`doc-block` keys encode **ordinal position** — `doc-block:<path>/<i>`. Re-decomposing a
document silently changes what a stable key contains. On 2026-07-11, ordinal 4 of
`frontend-unify` held a heading, and a `similarTo` edge to it from another heading was
true. On 2026-07-22 the document was re-synced and ordinal 4 became code. Block 4's
outbound edges were reconciled that day. The inbound claims were not — and nothing will
ever revisit them, because a peer re-evaluates its edges only when the *peer* is
re-indexed, which for a settled fact may be never.

**A `similarTo` edge asserts something symmetric and is maintained from one side.** That
is the entire defect.

It compounds in three ways:

1. The frozen score is a **maximum** — the pair was near-identical when the edge was
   written — so stale edges systematically outrank honest ones and own the queue head.
   The curation surface shows its worst data first, by construction.
2. These edges feed `centrality`, a salience signal. Facts have been drawing standing
   from kinship that no longer exists.
3. `contested` reads the same candidate set.

This is the user's sentence in mechanical form. The system links, and never un-links.

## The fix

`reconcileInbound` (`platform/runtime/similar-edges.ts`), on one rule: **correct what we
can measure, delete only what we can disprove.**

When a fact is re-indexed we hold its fresh k-NN. For each inferred edge pointing *at* it:

- **peer is in the fresh matches** → we know the current cosine. Rewrite the score,
  preserving `createdAt` — this is the same claim re-measured, not a new one.
- **peer is absent and the stored score is above the horizon's floor** → impossible. Were
  that score true, the peer would have ranked inside the window we just looked at. Delete;
  the peer re-asserts on its own next pass if the kinship is still real.
- **peer is absent and the score is at or below the floor** → unfalsifiable from here.
  Leave it alone.

The third case is load-bearing. k-NN is not symmetric: a peer legitimately holds this fact
in its top-k while this fact does not hold the peer in its own. Treating that asymmetry as
staleness would quietly collapse the graph to mutual-kNN and take `centrality` with it.
The reconciler only ever acts on a contradiction it can actually demonstrate.

One widened k-NN (`INBOUND_HORIZON = 25`) serves both directions; outbound selection still
slices to `sim.k`, so the neighbour set is unchanged. A wider horizon makes the reconciler
*more* conservative — a lower floor means fewer edges are provably impossible — while
letting more peers land in the measurable branch and be corrected rather than guessed at.

Wired into both writers: the live stream indexer, where a fact reaches `puts` only when its
embeddable text changed — exactly the moment its inbound claims became unverified — and the
batch `reindex` replay, which walks every fact and so pays off the accumulated debt in one
pass.

## The method note

The audit numbers were all real, and the story they told was false. "15,482 pending against
5 per cycle" is a throughput problem, and it invited throughput remedies: rate-limit
ingest, decay the tail, raise the cap. None of them would have touched this. Gating the
decompose fan-out — the change flagged as needing a product decision — would have reduced
the *volume* of a queue whose *contents* were the actual defect.

Counting a queue describes its size. Opening it finds out what is in it. Two `peek` calls
were worth more than the entire census.

The open lifecycle questions — elided facts with no decay path (ADR-0079, still unbuilt),
the wiki compile loop starved by triggers on the two smallest types, a capture organ with
five genuine uses — remain open, and should be re-measured after a full reindex rather than
argued from the pre-fix numbers.

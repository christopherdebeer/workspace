# ADR-0072 — The `_contested` view: a two-stage contradiction read

- **Status:** Proposed 2026-07-09 (buffer — feedback welcome before build). C7 of the
  second contraction wave (ADR-0067); enters the buffer now that its dependencies
  (C3 edges, C6 reward) are built.
- **Context doc:** [`docs/cerebellar-loop.md`](../../cerebellar-loop.md) — Primitive 1
  (the full design); [`compose.md`](../compose.md) §7.
- **Depends on:** ADR-0069 (edges — the `contradicts` rel rides the same EdgeRecord),
  ADR-0070 (reward — contested endpoints get a salience lift), ADR-0030/0031/0032
  (the vector index + `suggestionCandidates`), ADR-0011 (views).
- **Continues:** ADR-0040/0045 (the self-maintaining wiki — this is the "detect
  contradictions" promise, made a standing read).

---

## Context (grounded)

Two facts can assert opposing claims and sit peacefully in the same slice — nothing
surfaces the tension. The machinery to *find candidates* already exists:
`suggestionCandidates` (`platform/runtime/similar-edges.ts`) computes
semantically-near pairs with no authored edge, and `registerView`/`view`
(`services/workspace/views.ts`) evaluate stored queries. What's missing is the
*adjudication* — "near AND divergent" is not expressible in a CEL predicate — and
the standing read that consumers (the consolidation organ, a human "tensions"
panel) can act on.

```mermaid
flowchart TD
  subgraph before["BEFORE — tension is invisible"]
    A["fact a: 'X is true'"]
    B["fact b: 'X is false'"]
    NEAR["similarTo(a,b) — the index sees kinship, not conflict"]
    A -. cosine .- B
  end
  subgraph after["AFTER — a standing contradiction read"]
    S1["Stage A · candidate pre-filter<br/>similarTo ≥ θ · no authored edge · same type/entity"]
    S2["Stage B · metered adjudication (models.agent)<br/>verdict: contradict · subsumes · duplicate · independent"]
    OUT["contested/&lt;hash&gt; fact + a--contradicts--&gt;b edge<br/>checked/&lt;hash&gt; marker (idempotent)"]
    S1 ==&gt; S2 ==&gt; OUT
  end
  before ==close the gap==&gt; after
```

## Sketch (decisions, tentative)

Per `cerebellar-loop.md` Primitive 1, unchanged in substance:

1. **Stage A — a `registerView` (`_views/contested`)**: emit pairs `(a, b)` where
   `similarTo(a,b) ≥ θ`, no authored edge connects them (either direction), same
   type or shared tag, both current. Reuses `suggestionCandidates` — no re-embedding.
   Output: bounded, salience-ranked `{a, b, cosine, sharedTags}`.
2. **Stage B — metered adjudication**: a bounded `@c15r/models.agent` pass classifies
   each candidate `verdict ∈ {contradict, subsumes, duplicate, independent}`:
   - `contradict` → write `contested/<hash(a,b)>` `{a, b, why}` + an authored
     `a --contradicts--> b` edge (the C4 causal-rel down-payment, zero schema);
   - `duplicate` → a supersede candidate for the consolidation organ (C8);
   - `subsumes` → propose a `refines` edge;
   - `independent` → a `checked/<hash>` marker carrying both input `version`s
     (ADR-0066 content hashes), so the pair is never re-adjudicated until either
     fact actually changes — **idempotent by construction**.
3. **Consumers**: the consolidation organ (C8) resolves or escalates; a "tensions"
   panel on `@c15r/home`; and **salience** — a `contested/*` fact writes a `reward`
   (ADR-0070) onto both endpoints so the tension surfaces to a person.

## Why now (buffer rationale)

C7 is the gate to C8 (the consolidation organ needs semantic debt to act on), and
both its dependencies just landed: the `contradicts` rel has a home in the composed
edge query (ADR-0069) and the endpoint-lift has a score seam (ADR-0070). Sketching
it now keeps C8's design honest — the organ should consume a *real* contested read,
not a hypothesized one.

## Behaviour-preservation (the gate)

Stage A is a pure read (a view evaluation) — no gate needed beyond correctness
tests. Stage B writes only *new* facts/edges/markers — the gate is **idempotence**
(re-running with unchanged inputs writes nothing new; the `checked/*` versions
hold) and **metering** (top-N candidates per cycle by cosine × combined salience;
never unbounded).

## Open questions
1. θ (the cosine floor): start at the `suggestions` default or higher? Proposal:
   higher — contradiction candidates should be *close*, not merely related.
2. Stage B's model budget: per-cycle N and which model tier. Proposal: N=10,
   the cheap tier; escalate ambiguous verdicts to a stronger model rather than
   raising the default spend.
3. Does `contested/*` belong in the slice or under a `_contested/` system prefix?
   Proposal: the slice (`contested/`) — it is knowledge about the corpus, not
   plumbing; tending should see it.

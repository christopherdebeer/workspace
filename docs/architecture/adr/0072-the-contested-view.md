# ADR-0072 — The `_contested` view: a two-stage contradiction read

- **Status:** Accepted 2026-07-09 — Inc 1 shipped, deployed to prod (run 29011714951),
  Stage B adjudicated live (verdicts written, idempotence verified). C7 of the second
  contraction wave (ADR-0067).
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
1. θ (the cosine floor): start at the `suggestions` default or higher? **Decided
   (Inc 1): higher — `minScore` default 0.5, caller-tunable.**
2. Stage B's model budget: per-cycle N and which model tier. **Partly decided:
   the read meters at `limit` 1–50 (default 10)**; the tier/escalation policy
   belongs to the C8 organ ADR.
3. Does `contested/*` belong in the slice or under a `_contested/` system prefix?
   **Decided (Inc 1): the slice (`contested/`)** — knowledge about the corpus, not
   plumbing; tending sees it. The `checked/*` markers likewise live in the slice
   (type `adjudication`).

## Implementation log

- **2026-07-09 — Inc 1 shipped.** `workspace.contested` (a read command in
  `commands-search.ts`, beside `suggestions`): candidates = `suggestionCandidates`
  (inferred `similarTo`, score-desc) ∩ both-live ∩ cosine ≥ `minScore` ∩ no authored
  edge (`authoredPairs` asserted, not just assumed from write-time dedup) ∩ same type
  OR shared tag ∩ not noise (`_` keys + the suggestions runtime-type filter) ∩ no
  current `checked/<hash>` marker with matching content-hash versions. Each candidate
  carries `hash` (= `contentHash(pairKey(a,b))`), labels/types/sharedTags, and both
  facts' `versions` so the adjudicator writes the marker without recomputation.
- **Refinement vs the sketch:** a **dedicated derived read**, not a `registerView` —
  pair-computation over the edge set is not expressible in the view query/reduce
  language; the read sits in the `suggestions`/`attention` family instead (the same
  family `adaptive-salience.md`'s `_contested` synthetic view pointed at). Stage B
  needs **no new write surface**: verdicts land via existing `remember`/`link`
  (the `hint` field teaches the protocol inline).
- **Gate green.** `tests/contested-read.test.ts` — common-ground precondition
  (same type or shared tag), cosine floor, authored-pair exclusion, noise filter,
  `checked/<hash>` idempotence, **version-drift re-open**, limit-vs-total. Full
  suite 596 green.
- **Deployed to prod + Stage B run live (2026-07-09).** The first live read returned
  436 candidates. Two adjudicated with existing verbs, both exit paths proven:
  - **duplicate (real find):** `inbox/arch-2023-11-17-1` ↔ `inbox/arch-2023-11-18-1`
    — the same capture (newhouseb/clownfish) archived twice on consecutive days,
    cosine 0.99997. Verdict marker written; the later copy **superseded by** the
    earlier (`migrateLinks`) — the pair left the read *structurally* (both-live
    filter), the first live consolidation action of the wave.
  - **independent:** a `machine/tending` run ↔ its own trigger — two roles of one
    execution, related plumbing, not divergent claims. `checked/<hash>` marker
    written; re-read showed `checked: 1` and the pair gone — **idempotence verified
    live** (total 436 → 434 via the two distinct exit paths).
- **Live finding → filter hardened, then de-hardcoded (owner aside).** The first
  read was ~90% machine-vocabulary pairs (run/trigger/node clustering at cosine
  ≈0.9999 by *format*). First fix widened the compiled noise set — which the owner
  correctly flagged as **hardcoding one slice's type names into the platform**.
  Final form: the noise set resolves from a slice-declared **`_config/suggestions`**
  fact (`{ noiseTypes?, admitTypes? }`) merged over the built-in floor — open-ended,
  per-slice, no redeploy; shared by `contested` *and* `suggestions`; gated in
  `tests/contested-read.test.ts`. The principle is recorded as wave discipline in
  `compose.md` §8. Rides the next deploy; exactly the calibration data the C8 organ
  ADR (0073) wanted.

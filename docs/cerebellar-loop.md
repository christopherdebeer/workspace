# Closing the cerebellar loop — the consolidation organ and the `_contested` view

> A build-ready design, in the spirit of [`substrate-gaps.md`](./substrate-gaps.md):
> Evidence → Missing primitive → Shape, grounded in primitives that already exist.
> It specifies the first two moves from
> [`cognitive-substrate.md`](./cognitive-substrate.md) §6 — the cerebellum the
> substrate measures with but does not yet close.
>
> *July 2026*

## The problem, restated in one paragraph

The substrate already has correction *primitives* — `attention` (what's stale /
unlinked / dangling), `tend` (an audit with a `delta` vs the prior run), `ratify`
(promote an inferred `similarTo` edge to an authored one), `pruneSimilar`,
`supersede`+`migrateLinks`. What it lacks is a *loop*: something that acts on the
backlog and is **scored on moving it**. The live evidence is the `machine/tending`
audit — three consecutive runs reporting `stale≈195` flat and `unlinked` *growing*
(391→396) "despite two weave dispatches." The organ perceives drift and reports it;
nothing closes the arc. Two primitives close it, in order.

---

## Primitive 1 — the `_contested` view (contradiction detection)

**Why first.** The consolidation organ (below) needs a read of *what is wrong* to
act on. `attention` already gives structural debt (unlinked / dangling). The
missing signal is *semantic* debt: two facts that quietly disagree. The wiki's
headline promise — "the LLM detects contradictions" — is unbuilt here too.

**Evidence it's tractable.** The vector index already computes semantic proximity
(`platform/runtime/vectors.ts`, `similar-edges.ts`) and `suggestions` already
surfaces near-neighbour pairs that lack an authored edge. `registerView` +
`view(id)` already evaluate a stored query against the slice
(`services/workspace/views.ts`, `descriptors.ts`). `adaptive-salience.md` already
posits a `_contested` synthetic view as precedent. The pieces exist; nothing wires
them into a contradiction read.

**Missing primitive.** A two-stage view — a cheap structural pre-filter that an
LLM pass adjudicates — because "divergent claim" is not expressible in a CEL
predicate alone.

### Shape

**Stage A — candidate pre-filter (a `registerView`).** Cheap, deterministic,
standing. Emit pairs `(a, b)` that are *worth checking*:

```
_views/contested = {
  id: "contested",
  query: { type: ["knowledge","decision","mental-model","concept"] },
  reduce: "pairs where similarTo(a,b) ≥ θ
           AND no authored edge connects a,b (either direction)
           AND same type OR shared entity/tag
           AND a,b both current (not superseded)",
  render: "list"
}
```

The `similarTo ≥ θ` + `no authored edge` half is exactly what `suggestions`
already computes — reuse `suggestionCandidates` (`similar-edges.ts`) rather than
re-embedding. Output: a bounded, salience-ranked candidate list, each entry
`{ a, b, cosine, sharedTags }`.

**Stage B — adjudication (a bounded `@c15r/models.agent` pass).** For each
candidate, one cheap classification call over the two fact bodies:

```
verdict ∈ { contradict, subsumes, duplicate, independent }
```

- `contradict` → write a `contested/<hash(a,b)>` fact `{ a, b, why, verdict }` and
  an authored `contradicts` edge `a --contradicts--> b` (the causal-edge-layer
  down-payment).
- `duplicate` → hand to the consolidation organ as a `supersede` candidate.
- `subsumes` → propose a `refines`/`elaborates` edge.
- `independent` → record the negative so the pair isn't re-adjudicated every cycle
  (a `checked/<hash>` marker with the input `version`s; re-open only if either
  fact's `version` changes).

**Consumers.** (1) the consolidation organ, which resolves or escalates; (2) a
human "tensions" panel on `@c15r/home`; (3) salience — a `contested` fact raises
the salience of both endpoints so a person actually sees the tension.

**Guardrails.** Stage B is metered (top-N candidates per cycle by cosine ×
combined salience); the `checked/<hash>` markers make it *idempotent* and stop it
re-billing the same pairs — the failure mode `adaptive-salience.md` warns about
(agents re-doing settled work).

---

## Primitive 2 — the consolidation organ (the closed loop)

**Evidence.** `machine/tending` exists (`machine/tending`, entry `Audit`, context
`[tending/latest, kb/b27cf397005a4f]`) and runs daily, but its protocol
(`kb/b27cf397005a4f`) is explicitly *observe-and-dispatch*: "its power comes from
knowing when to hand off — not from doing more work itself." The dispatched
specialists (`weave` for unlinked, `fix`, `improve`) are themselves agent runs, and
the audit shows they aren't denting the trend. There is no organ whose *job* is to
reduce the backlog and whose *score* is the reduction.

**Missing primitive.** A bounded, serialized organ (a `cell`, or a `machine` with a
`work` rail) that each cycle turns a slice of measured debt into repair, and emits
a **delta it is accountable for**.

### Shape

A cell `@c15r/consolidate` (or a `machine/consolidation`) with one `run` cycle:

```
1. OBSERVE   a = attention()            // stale, unlinked, dangling (uncapped)
             c = changes({ sinceSeq })  // what moved since last cycle
             k = view("contested")      // semantic debt (Primitive 1)

2. SELECT    a bounded work-slice (e.g. ≤ 20 items/cycle), highest leverage first:
             - unlinked, high-salience facts        → propose link / ratify
             - suggestions() above a confidence bar  → ratify (inferred → authored)
             - dangling edges                        → unlink or supersede+migrateLinks
             - contested:duplicate                   → supersede (keep the higher-standing)
             - contested:contradict                  → escalate (never auto-resolve)

3. ACT       apply the safe subset directly; file the rest as proposals
             (a `proposal/*` fact a human or a higher-trust run ratifies)

4. SCORE     backlogₜ = |stale| + |unlinked| + |dangling| + |contested|
             delta     = backlogₜ₋₁ − backlogₜ         // POSITIVE = progress
             write consolidation/latest { backlog, delta, actions, escalations }
             feed `delta` into `_config/salience` as a reward term (see below)
```

**The reward hook (this is the point).** Today `_config/salience` weights are
hand-tuned and static (`state.ts`, `parseSalienceConfig`). The organ's `delta` is
the first *earned* signal in the system: a vocabulary/edge whose ratification
reduced backlog is worth more than one that didn't. Concretely — actions that move
the delta positive raise the `standing` contribution of the facts they touched;
churn that doesn't move it decays. This is the missing `R(s,a,s′)` from
`adaptive-salience.md`, wired to the one metric the substrate already computes.

**Autonomy ladder (safety).** Three tiers, gated by the scope grammar:

| Action | Confidence | Autonomy |
| --- | --- | --- |
| `ratify` a `similarTo` above a high bar | high | direct |
| `link` an unlinked high-salience fact to an obvious anchor | medium | direct, logged |
| `supersede` a duplicate | medium | direct if standing-gap is clear, else propose |
| resolve a `contradict` | — | **always escalate** — never auto-resolve a contradiction |

**Why it converges where `tend` doesn't.** `tend` dispatches specialists and hopes;
the consolidation organ *is* the specialist, runs every cycle, acts on a bounded
slice, and — crucially — is measured on `delta`, not on "ran successfully." A run
that reports the same backlog twice is, by its own score, a failure. That is the
difference between a cerebellum that fires and one that reaches the muscle.

### Reuse map (nothing new in the core)

| Need | Existing primitive | File |
| --- | --- | --- |
| structural debt | `attention` | `services/workspace/descriptors.ts` |
| trajectory delta | `tend` audit + `changes` | `descriptors.ts` |
| promote a hint | `ratify` / `suggestions` | `services/workspace/actions.ts`, `similar-edges.ts` |
| repair on retire | `supersede` + `migrateLinks` | `descriptors.ts` |
| the loop body | a `cell` or `machine` `work` rail | `cells/machine`, `services/cells` |
| the reward | `_config/salience` term | `platform/runtime/state.ts` |
| semantic debt | the `_contested` view | Primitive 1 |

## Sequencing & done-criteria

1. **`_contested` view** — Stage A ships as a `registerView` (a day); Stage B as a
   metered `models.agent` pass. *Done when* `view("contested")` returns adjudicated
   pairs and re-runs are idempotent (`checked/*` markers hold).
2. **Consolidation organ** — *Done when* `consolidation/latest.delta` is positive
   across three consecutive cycles on the current backlog (the exact failure the
   2026-07-08 audit records), and the reward term measurably lifts the salience of
   facts whose consolidation stuck.

Both are pure tier-2 builds (a declared view + a cell), no platform-core edit —
the test `substrate.md` sets for a primitive being the right one.

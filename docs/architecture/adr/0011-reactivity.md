# ADR-0011 — Reactivity: a Subscription is a Collection over the change stream

- **Status:** Proposed (two-forward buffer)
- **Date:** 2026-06-20
- **Context:** [`breathe.md`](../breathe.md) Wave 10 — reactivity is not a new primitive;
  a Subscription is a standing predicate that fires an Action, evaluated over *writes*
  instead of *state*.
- **Depends on:** ADR-0001 (`_subscriptions/<id>` is a Declaration kind), ADR-0005
  (Collections — the same predicate, over state), ADR-0004 (the predicate is the
  Projection's `select`).

---

## Context (grounded)

A subscription is **data, not code** (`services/workspace/subscriptions.ts`): a fact at
`_subscriptions/<id>` holding `{ match, invoke|deliver, params }`, interpreted by one small
fixed reactor. On every fact write, the reactor tests `match` against the changed fact:

- `match.type` — the written fact's type,
- `match.keyPrefix` — its key prefix,
- `match.cel` — a CEL predicate over the changed fact.

…and on a hit invokes a **declared Action** (`invoke`, in-slice) or **delivers** to a cell
tool (`deliver`, as the slice owner), with `params` templated from the event. Reactions fire
declared Actions, so the whole reactive layer stays inspectable — no opaque callbacks
(this is what lets `@c15r/machine`'s auto-rails advance purely by registering vocabulary).
`fact.written` is re-emitted for each reactive write, bounded by a depth cap (loop bound).

Now compare a **Collection** (ADR-0005). Its intensional membership is *also* a predicate
over facts — `type` / `tag` / `prefix` / CEL — evaluated by `Projection.select`. The two
predicates are **the same language**; they differ only in *what they range over*:

| | predicate ranges over | yields |
|---|---|---|
| **Collection** (ADR-0005) | the current **state** (facts now) | the member set |
| **Subscription** (this ADR) | the **change stream** (each write) | an Action firing |

A view answers "which facts match, now?"; a subscription answers "fire when a fact comes
to match." Spatial vs temporal — one primitive, two streams.

## Decision (sketch — to detail when it reaches the front)

Name **Reactivity** the *temporal* evaluation of the Collection predicate: a Subscription
is `{ when: <predicate>, then: <Action> }` where `when` is exactly a Collection's
membership predicate evaluated against writes, and `then` is a declared Action (ADR-0001).

```mermaid
flowchart TD
  PRED["one predicate language<br/>type · tag · prefix · CEL (ADR-0004 select)"]
  PRED --> COLL["over STATE → Collection members (ADR-0005)<br/>read(\"workspace.members\")"]
  PRED --> SUB["over the CHANGE STREAM → Subscription<br/>fact.written ⟶ match ⟶ Action"]
  SUB --> ACT["declared Action (invoke) · cell tool (deliver)"]
  ACT -->|writes facts| WROTE["fact.written (depth-capped)"]
  WROTE -. re-enters .-> SUB
```

- **Share the predicate evaluator.** `match` (type/keyPrefix/cel) and a Collection's
  `query` (type/tag/prefix/cel) should compile through one `select`/predicate path
  (ADR-0004), so "matches a view" and "triggers a subscription" can never drift in
  semantics. Today they're two hand-rolled testers of the same shape.
- **The Action is the `then`.** Reactivity adds no execution primitive — it reuses declared
  Actions (and `deliver` for cell tools). The reactor is the only fixed code; everything
  else is vocabulary (Declarations), exactly like the rest of the system.
- **Boundedness is intrinsic, not bolted on.** The depth cap that stops write→react→write
  loops is the temporal analogue of a Collection's page limit — both keep a standing
  predicate from running away. State that as the invariant.

## Consequences
- "View vs subscription" collapses to **predicate × {state, changes}** — the same way
  ADR-0005 collapsed "view vs doc vs board vs tag" to Collection × {intensional,
  extensional}. One predicate, evaluated two ways.
- A reviewer learns the trigger language once and it transfers between recall filters,
  view membership, and subscription matches.
- Auto-rails, tending escalation, and any "when X then Y" are uniformly **two Declarations**
  (a Subscription + an Action), inspectable in `$catalog`/`$graph`.

## Out of scope / open
- The reactor stays a fixed tier-1 component (it must — something has to run the loop);
  this ADR names *what it evaluates*, not a rewrite of how.
- Whether a Subscription should be able to range over the **derived** projection (fire when
  a *derived* edge appears, e.g. a claim gains enough `supports` to cross a threshold) — or
  stay limited to authored writes. Defer; it needs the projection to be incrementally
  evaluable, which it isn't yet.
- Ordering/at-least-once vs exactly-once delivery semantics under the depth cap — document
  the current behaviour when it reaches the front.

# ADR-0007 — The Grant axis, made explicit

- **Status:** Proposed (two-forward buffer)
- **Date:** 2026-06-19
- **Context:** [`breathe.md`](../breathe.md) Wave 11 — Grant/Scope is the orthogonal
  authority axis that *gates* the nouns; it is not one of them.
- **Depends on:** nothing (orthogonal); informs every read/act.

---

## Context (grounded)

Authority is enforced at **three** layers, in three places:

1. **Token scope** — `enforceScope` at the gateway (`services/gateway/service.ts:275`)
   checks a capability's required scope against the caller's.
2. **Grant visibility** — `share`/`group`/`requestGrant` (`handlers.ts:1016–1187`) decide
   what appears in a viewer's `recall` (own slice ∪ granted subsets) and who may
   write-through (`requireWriteThrough`).
3. **Partition isolation** — DynamoDB `LeadingKeys` per scope (`substrate-table.ts`) — IAM
   can't read another scope's partition at all.

These are correct but *implicit*: there's no single place that answers "who may do what to
this fact?", and the three layers are reasoned about separately. The breathe map names Grant
an axis but the code doesn't expose it as one.

## Decision (sketch — to detail when it reaches the front)

Name the **Grant axis** as the one authority surface that gates **Fact · Reference ·
Declaration**, with a single conceptual check `may(principal, verb, resource)` resolving the
three layers in order (scope → grant → partition). No new enforcement — a *naming +
surfacing* contraction so authority is inspectable, not a fourth scattered concern.

```mermaid
flowchart TD
  P["principal (token · scopes)"] --> CHK["may(principal, verb, resource)"]
  CHK --> L1["1 · scope (enforceScope)"]
  CHK --> L2["2 · grant (share/group/requestGrant)"]
  CHK --> L3["3 · partition (IAM LeadingKeys)"]
  L1 & L2 & L3 -.gates.-> N["Fact · Reference · Declaration"]
```

- A read like `read("$grants")` (mirroring `$catalog`/`$types`/`$graph`) returns *what the
  caller may see and do* — the authority self-model surface, completing the set.
- `requestGrant`/`approveGrant` already make the axis *negotiable* as data; this just names it.

## Consequences
- The four self-model surfaces line up: `$catalog` (capabilities), `$types` (vocabulary),
  `$graph` (references), `$grants` (authority).
- A reviewer can answer "why can/can't X touch Y?" from one place instead of three.

## Out of scope / open
- No change to the enforcement itself (it works); this is inspectability + naming.
- Whether `may(...)` becomes a real shared function or stays a documented contract over the
  existing three checks — decide when it reaches the front.
- Cells' `ssrReads`/`callerWrites` (declared, bounded substrate access) are a Grant-adjacent
  facet of the **Cell** axis — relate them here vs. in a Cell ADR.

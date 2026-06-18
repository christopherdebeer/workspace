# Agent API friction — second ergonomics review, grounded + plan (2026-06-18)

> A second agent (Claude Sonnet 4.6) drove the parc.land gateway through use and
> filed friction notes on the `whoami`/`read`/`act` surface and the
> `workspace.*` vocabulary. This doc grounds each note against the **current
> implementation**, marks what the first review (`2026-06-12-mcp-agent-
> ergonomics-review.md`) already shipped, and lays out a ranked plan of attack.
>
> Touch-point map for the surface under review:
> - gateway verbs + `$catalog`/`$types`: `services/gateway/service.ts`
> - workspace vocabulary + tool descriptors: `services/workspace/handlers.ts`
> - state primitive (recall/query/shape/changes): `platform/runtime/state.ts`
> - storage (GSI/scan for query): `platform/runtime/dynamo-state-store.ts`
> - type resolver (the `$types` data): `platform/ui/vocab.ts`, `docs/type-vocabulary.md`

## Scorecard — feedback vs. current implementation

| # | Feedback | Status | Where |
| - | --- | --- | --- |
| 1 | `recall` overflows context; want `limit:50` default + type-count header | **partial** — values already elide to `{key,type,score}` stubs (review 1), but there is no entry cap and no type summary | `handlers.ts:1238` (recall), `state.ts:shape`, `RecallInput` `handlers.ts:139` |
| 2 | `$namespaces` catalog for key prefixes (`kb/`, `blk:`, `el:`, `_canvas/`, `_doc/`) | **not done** | new gateway sentinel; data from `vocab.ts` `typeSignals` + a registry |
| 3 | Richer `query` filters (`score>`, `updatedAt<`, `linkCount=0`) | **not done** — filters are type/tag/prefix only | `QueryOptions` `state.ts:527`, `query` `handlers.ts:1289`, store `dynamo-state-store.ts:204` |
| 4 | Batch `peek` (`keys: string[]`) | **not done** — single key only | `peek` `handlers.ts:1271`, `PeekInput` `handlers.ts:148` |
| 5 | `beginSession`/`endSession` provenance trail for ad-hoc agents | **not done** — flagged as a gap in review 1 addendum #5 | new workspace commands |
| 6 | `workspace.head` — cheap change-feed baseline (seq, no facts) | **ALREADY DONE / stale** — `changes({sinceSeq:"head"})` returns `{events:[], seq}` | `handlers.ts:1342`, `changes` schema `handlers.ts:656` |
| 7 | Consistent error schema `{error, code, hint?}` | **partial** — string prefixes exist (`grant_denied:`, `not_found:`, `precondition_failed`, `scope_offer:`/`scope_denied:`) but no structured envelope | thrown as `Error` across `handlers.ts`; framed at `define-mcp-service.ts`/gateway |
| 8 | `$types` is UI-intent only; want a machine-readable **value schema** per type | **not done** — handlers cover open/edit/render/create; no data shape | `buildTypes` `service.ts:298`, `type-vocabulary.md` |

Net: one item (#6) is already shipped and the feedback is stale; one (#1) is
half-shipped and needs finishing; the other six are real, open work.

## The plan, ranked by leverage ÷ cost

### Tier A — cheap, additive, non-breaking (do first)

**A1. Finish recall's context budget (#1).** Add `limit` to `RecallInput`
(default ~50) that caps the number of **full** focus/peripheral entries; the
overflow demotes into the existing `elided` stub array rather than shipping full
values. Add a `summary` block to the result: `{ total, byType: {type: count},
focus, peripheral, elided }` — the header the agent asked for, so it can orient
without reading entries. Implementation is in `state.ts:shape` (the tiering pass
already ranks by score; truncate the full-value tier at `limit` and stub the
rest) and `handlers.ts:1238` passes the option through. Pure-additive: existing
callers that omit `limit` keep today's behavior unless we choose to make 50 the
default (a behavior change — see open decision below).

**A2. Batch `peek` (#4).** Accept `keys: string[]` (keep `key` for back-compat).
Return `{ entries: { key → Entry|null } }` for the multi-key form. One loop over
`state.get` in `handlers.ts:1271`; grant check applies per key when `owner` is
set. Add the array form to the `peek` tool descriptor + `resultSchema`.

**A3. `$namespaces` discovery (#2).** New gateway sentinel mirroring `$types`.
Derive the table from (a) `vocab.ts` `typeSignals` (type → key-prefix → tag,
already "most specific first") and (b) the cell-declared type registry, plus a
curated floor for the structural `_`-namespaces (`_canvas/`, `_actions/`,
`_views/`, `_types/`, `_renderers/`, `_groups/`, `_grants/`). Returns
`{ namespaces: { prefix: { meaning, type?, manager?, system? } }, hint }`.
Lives next to `buildTypes` in `service.ts`; no new storage.

### Tier B — moderate, mostly additive

**B1. Per-type value schema in `$types` (#8).** Extend the type-handler
declaration with an optional `schema` (a shallow JSON-Schema-ish shape of
`value`) and surface it through `buildTypes` (`service.ts:298`). Add a `shape`/
`schema` intent to the resolver's intent vocabulary (`type-vocabulary.md` §4 is
explicitly "small, open, standardised" and list-friendly, so this is in-scope).
Seed schemas for the types the corpus actually uses (`doc`, canvas element,
`capture`, `cell`, `agent-run`). The agent's ask — "how do I read the value of
this fact as structured data" — becomes `types[T].schema`.

**B2. Structured error envelope (#7).** Formalize the existing prose conventions
into `{ code, message, hint? }`. Cheapest faithful path: a small `WorkspaceError`
(code + hint) thrown by handlers, caught and serialized at the gateway/MCP
framing boundary (`define-mcp-service.ts`), preserving the human message. Codes
already in use become the enum: `grant_denied`, `not_found`,
`precondition_failed`, `scope_offer`, `scope_denied`, `invalid_argument`,
`read_act_mismatch`, `unknown_capability`. This is the guardrail the first review
asked for in the *input* direction (`resultSchema`) applied to the *failure*
direction.

### Tier C — heavier, needs design

**C1. Query predicate filters (#3).** The highest-value, highest-cost item.
`QueryOptions` (`state.ts:527`) gains a small predicate set — e.g.
`updatedBefore`/`updatedAfter` (ISO), `minScore`/`maxScore`, `unlinked:true`
(linkCount=0). Type stays GSI-served; the predicates apply as a post-filter in
both stores (`dynamo-state-store.ts:204` and the memory store) **before** paging,
so `total`/`nextCursor` stay honest and the agent stops burning context on
client-side discard. Keep it deliberately small — a filter grammar, not a query
language. `unlinked` needs the edge index, which `attention` already computes;
reuse that path.

**C2. Agent session entity (#5).** A first-class, lightweight provenance trail:
`act("workspace.beginSession", { purpose })` → writes `agent/session/<id>` and
returns the key; `act("workspace.endSession", { key, summary })` supersedes/closes
it. This is the agent-facing half of the run/audit gap review 1 named (addendum
#5) — deliberately *lighter* than the legacy `run_start/complete` machinery
(no dispatch, no parent linkage) so an exploring agent can leave a trace in two
calls. Design question: relationship to the existing legacy `workspace_run_*`
MCP and whether sessions should auto-link the facts written during them.

### Already shipped — close out

**#6 (`workspace.head`).** No work: `read("workspace.changes", {sinceSeq:"head"})`
already returns `{events: [], seq}` cheaply (`handlers.ts:1342`). The fix is
*discoverability*, not capability — the `changes` description already documents
it; consider surfacing "establish a baseline with sinceSeq:'head'" in the
gateway `instructions` so the next agent finds it without reading source.

## Open decisions (worth a human call before building)

1. **recall default.** Make `limit:50` the *default* (changes the flagship read's
   behavior, but directly serves the bounded-observer tenet) vs. opt-in (safe,
   but the agent still gets bitten on the first call). Recommendation: default it,
   since the elided overflow is fully recoverable via `expand`/`peek`/`query`.
2. **Error envelope blast radius.** Wrapping at the MCP boundary touches every
   cell's failures uniformly; scoping it to workspace first is lower-risk but
   leaves cell-tool errors inconsistent. Recommendation: workspace-first, then
   lift to the boundary once the code enum stabilizes.
3. **Session semantics (#5).** Pure provenance fact vs. auto-linking writes made
   during the session. Recommendation: start as pure provenance; auto-linking is
   a salience/graph concern that overlaps the open "salience v2" work.

## Suggested sequencing

Land Tier A together (one PR — all additive, all touch the same descriptors),
then B1+B2, then take C1 and C2 as separate designed changes. A is the bulk of
the felt friction (recall weight, batch peek, namespace orientation) at the
lowest risk; #6 needs only a doc nudge.

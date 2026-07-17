# Platform Overview

parc.land is a serverless multi-project personal-productivity substrate whose animating commitment is **no graduation**: the environment a user thinks in is the environment they build in, and the environment an agent operates in is the same environment a human edits. Every authoring artifact — a document, a board placement, a renderer plug-in, a declared action, even Lambda source — is a first-class fact in one shared store.

This document is the front door to the reference set. The subsystem docs live under `platform-reference/`; the irreducible-core argument lives in `platform-core.md`; the compound-vs-conflict audit lives in `platform-reference/coherence-audit.md`; and the positive mirror of "what is NOT core" lives in `platform-derivatives.md`.

## The three cores + one edge realisation

The whole substrate reduces to **one representation, one read pipeline, one execution axis** — three cores — with one piece of AWS-edge plumbing named alongside because it *realises* (does not *constitute*) the substrate's public HTTP face. The separating test is portability: if AWS edge primitives changed tomorrow, the edge contract would change while the three cores would not.

| Core | One-line | Primary evidence |
|---|---|---|
| **Fact** | A `{value,_meta}` row at `(scope,key)`: monotonic, server-stamped (writer/seq/revision/createdAt), supersede-not-delete, CAS-guarded (`ifRevision`/`ifAbsent`/`ifVersion`), carrying read-time timers (lease/reveal) and a TTL-bounded per-scope **trajectory** shadow written by the same `put`. The key-prefix **scope IS the IAM principal IS the OAuth target** — authority is `dynamodb:LeadingKeys`, not an interpreter. | `platform/runtime/state.ts` (`EntryMeta`, `put`, `appendTrajectory`) · `platform/infra/substrate-table.ts:21-66` · `services/cells/cell-template.ts:64-88` · ADR-0013 / ADR-0007 |
| **Projection pipeline** | The single read pipeline `select → score → shape → present` every command is a preset of. Score = the Salience blend (recency·velocity·attention·standing·centrality, plus relevance + reward), `[0,1]`, never stored. Reactivity is the same `select` over the change-stream (View ≡ Subscription). The grant gate `may(principal,verb,resource) = applicableGrants ∩ token.scope` is a Projection preset at every PEP. | `platform/runtime/state.ts` (`signalsFor`/`callSalience`/`shapeEntries`) · `platform/runtime/selector.ts:36` · `platform/runtime/present.ts:52` · ADR-0004/0006/0010/0011/0012 |
| **Cell axis** | The only execution/isolation organ: an IAM-isolated Lambda + scratch table + scope + `describeTypes` publish seam + bounded substrate grants (`ssrReads`/`callerWrites`) + IAM-attested event source (`events:source = cell-<id>`) + browser-origin isolation (`<owner>-<name>.on.parc.land`) + `x-cell-caller` (token never reaches tier-2) + permission-boundary-capped role + async write-shape. Every Type manager, renderer, and action handler resolves to a Cell; the gateway and auth services ARE Cells. | `services/cells/cell-template.ts` · `platform/infra/dynamic-cell-control-plane.ts` · `services/gateway/service.ts:894` (`defineMcpService`) · ADR-0008 |
| **Edge HTTP contract** *(named-alongside)* | The three Lambda@Edge transforms that make CloudFront + an IAM-auth Function URL stand in for an API gateway: (1) origin-request signer hashes the body into `x-amz-content-sha256` and injects `x-forwarded-authorization` for all methods; (2) origin-response restores `WWW-Authenticate` (401 discovery, RFC 9728); (3) `x-forwarded-authorization` preserves the viewer bearer past the OAC `Authorization` overwrite. AWS-stack-specific realisation, not constitution. | `platform/infra/service-router.ts` (`ORIGIN_SIGNER_SRC`, `WWW_AUTH_FIX_SRC`) · `platform/runtime/define-service.ts` |

## Tenets

Four commitments thread the codebase (project `CLAUDE.md` + `architecture.md §1`):

1. **Mobile-first React, composable components.** Cells bundle a shared, inline-styled, React-only widget kit (`platform/ui/index.tsx`) via esbuild; surfaces are isomorphic (`renderToString` server + `hydrateRoot` client) using the cell's own React.
2. **AWS-native (CDK IaC).** Every construct — `SubstrateTable`, `HttpServiceCell`, `ServiceRouter`, `PlatformEventBus`, `DynamicCellControlPlane` — is composable CDK; the whole platform is wired in `lib/platform-stack.ts`.
3. **TypeScript front and back.** One language across runtime, services, cells, and client.
4. **MCP-native.** Every capability is reachable through one stable three-tool MCP surface (`whoami`/`read`/`act`), where new vocabulary appears in `target` arguments rather than new tool names — so a UI control and an agent invocation share one wire and one identity.

Two cross-cutting disciplines fall out of the cores: **reference-not-copy** (authoring tools place existing facts via decorations `_doc/<id>/<key>`, `_canvas/<board>/<key>` rather than embedding copies) and **authority-by-infrastructure** (per-cell IAM `LeadingKeys` + permission boundary, not an interpreter check).

## Core mental model

- **One representation.** Strip Fact and nothing stands. Vocabulary (`view`/`action`/`subscription`/`type`/`renderer`/`config`) rides `_<ns>/<id>` Facts; authored edges are `EDGE#` Facts; the grant request/answer inbox is `_grants/requests|answers/` Facts. (The *live* grant index `GRANT#`/`GRANTBY#`/`MEMBER#` is a parallel DDB key shape, not a Fact — the one nuance `platform-core.md` flags.)
- **One resolver per concept.** The breathe invariant ("every primitive used, none re-implemented" — the "3NF for architecture") means components USE but never RE-IMPLEMENT a primitive. The coherence audit is exactly the check of whether that invariant holds at each seam.
- **Capability-as-data.** The substrate describes itself in its own primitives: `$catalog`/`$types`/`$graph`/`$grants`/`$cells`/`$identity` are Projection presets over reserved `_<ns>/` prefixes; capabilities themselves are projected as `_caps/<target>` Facts (ADR-0052/0085).

## Request lifecycle — a READ

An agent (or the home SPA, on the same wire) issues `POST /mcp` with a bearer, calling `read(target, input)`:

1. **Edge.** CloudFront + OAC sign the request; the origin-request Lambda@Edge injects `x-forwarded-authorization` so the viewer bearer survives the OAC `Authorization` overwrite (`service-router.ts`).
2. **Identity.** The gateway Cell's `resolveHttpIdentity` (`platform/runtime/define-service.ts`) trusts only the validated Bearer, calls the auth Cell's `validateToken`, and produces `Identity {user, scopes, grantScopes, tokenId, posture}`.
3. **Resolve.** `resolveTarget` (`services/gateway/service.ts`) turns the dotted `target` into a dispatchable capability (tier-1 `workspace`/`cells`/`auth`, or tier-2 `@owner/cell.tool`, or a `$`-sentinel self-model surface), fetching only that target's provider describe.
4. **Enforce (PEP).** `enforceScope` checks the capability's declared scope against the caller: `allow` / `scope_offer` (self-serve widen within the grant ceiling) / `scope_denied` (needs a wider credential). `enforceInput` validates the declared `inputSchema` at the same choke point.
5. **Forward → Projection.** `cap.forward` routes into the workspace command (`recall`/`query`/`peek`/`changes`/…), which is a preset of the `state.ts` projection pipeline: `matchesSelector` select → `callSalience` score (with grant fan-out folded in for `recall`/`search`) → `shapeEntries` tiering → inline present-facet resolution via `affordancesForTypes`.
6. **Return.** The R1 envelope ships focus/peripheral/elided entries plus an inline `types` affordance map. `read` refuses `kind:'act'` capabilities.

## Request lifecycle — a WRITE

`act('workspace.remember', {...})` (or a cell tool terminating in a write):

1. **Edge + identity + PEP** as above (`act` refuses `kind:'read'`; the body-signing transform makes the POST body authenticate end-to-end).
2. **Command.** `commands-write.ts` (`remember`/`ingest`/`supersede`) calls `state.put`/`state.supersede`/`state.link` directly. `put` allocates a monotonic seq, increments revision, server-stamps `writer` (leaf-act delegation via `as`/`via`), preserves `createdAt`/`firstSeq`, records CAS preconditions atomically as a DynamoDB `ConditionExpression`, and — inside the same call — appends the trajectory event (`appendTrajectory`, `state.ts:1746`).
3. **Fan-out.** Two propagation substrates diverge here (see the coherence audit's `write-fanout` seam): the **DynamoDB stream** automatically drives the vector indexer and the analytics archiver (`createSubstrateWriteHandler`-style stream consumers in `lib/platform-stack.ts`); the hand-emitted **EventBridge `workspace.fact.written`** (from `commands-write.ts` and ~10 sites) drives the reaction reactor, which matches `_subscriptions/<id>` via the shared `matchesSelector`, mints a per-run scoped agent token, and invokes the declared action or delivers to a cell tool as the slice owner (bounded fixpoint, `maxDepth` default 50).
4. **Async cases.** Work exceeding the ~30s edge cap follows the pending-marker shape: write a pending fact → self-dispatch (`lambda:InvokeFunction Event` on own ARN) → terminal write → caller polls `workspace.changes`.

## The subsystem docs

See the index below (section 2 of this set) for the twelve `platform-reference/` subsystem docs and the coherence audit. Read `platform-core.md` for the defended reduction, and `platform-derivatives.md` for the positive map of every derived capability back to the core it compounds on.
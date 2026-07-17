# Services — Gateway, Dispatch, Archiver, Indexer

**Subsystem reference for engineers who must use and modify the platform's edge tier.**

Repo root: `/Users/cdbeer/dev/workspace`. Source files:

- `services/gateway/service.ts` — the MCP gateway (`defineMcpService`, owns `/mcp`)
- `services/gateway/validate.ts` — membrane input validation
- `services/gateway/widgets.ts` — MCP-Apps card + cell-renderer federation
- `services/dispatch/service.ts` — tier-2 HTTP ingress, SSR read-proxy, caller-write delegation
- `services/substrate-archiver/handler.ts` — DynamoDB-stream analytics mirror
- `services/vector-indexer/handler.ts` — DynamoDB-stream vector index + similarTo edges + layout patch

---

## What this subsystem is

This is the platform's **edge**: the four tier-1 services that turn the substrate's internal primitives (Fact, Projection, Cell, Edge HTTP) into the surfaces external participants actually touch.

- **Gateway** *is a Cell* that owns `/mcp` — the single authenticated MCP surface. It exposes exactly three tools (`whoami`/`read`/`act`), is the platform's **PEP** (policy enforcement point), projects the substrate's self-model (`$catalog`/`$types`/`$graph`/`$grants`/`$cells`), and hosts the conversation-render card.
- **Dispatch** is the tier-2 HTTP ingress: it routes `/@<owner>/<name>/*` browser navigations to cells via forge (`cells.call`), and adds the two substrate seams a public cell can never hold a token to use — the **SSR read-proxy** and **caller-write delegation**.
- **Archiver** and **Indexer** are two independent consumers on the `SubstrateTable` DynamoDB stream. The archiver mirrors every fact mutation to a Firehose/Athena analytics lake; the indexer embeds each live fact into its slice's vector index, reconciles inferred `similarTo` edges, and patches the semantic-layout projection.

Everything here reduces onto the four cores: the gateway and dispatch are **Cells** whose whole job is running **Projection** presets and threading **Fact** provenance; the stream consumers are pure functions over the **Fact** change-stream; the browser/conversation faces are realized by the **Edge HTTP** contract.

> ⚠ **Coherence — dispatch header comment is stale.** `services/dispatch/service.ts:1-9` documents a `/d/*` CloudFront behaviour and `/d/<cellId>/<rest>` paths, but the actual routing (`parsePath`, `service.ts:29-37`; route table `service.ts:434-447`) is `/@<owner>/<name>/<rest>`. The comment predates the `@owner/name` addressing scheme. Fix the header when you next touch the file — the code is correct, the doc-comment is not.

---

## 1. Stable three-verb MCP surface (whoami / read / act)

**What it does.** The gateway exposes exactly three MCP tools and puts *all* platform capability in the `target` argument, not the tool list. A new cell, command, or dynamic-cell tool becomes callable the instant it exists — no `tools/list` change, no client reconnect (named-tool aggregation could not give this: clients cache tools at connect). `read` observes (side-effect-free), `act` mutates; each refuses to cross the read/act boundary with a teaching error.

**Public API** (`services/gateway/service.ts`).

```ts
export const handler = defineMcpService({
  name: 'gateway', mcpPath: '/mcp',
  events: { emits: ['capability.invoked'] },
  serverInfo, instructions, tools, capabilities, resources, http,
});
const tools: Record<string, McpToolDefinition> = { whoami, read, act }; // :806
async function read(input: DispatchInput, ctx: ServiceContext): Promise<unknown>;  // :529
async function act(input: DispatchInput, ctx: ServiceContext): Promise<unknown>;   // :641
async function whoamiTool(_input, ctx): Promise<{ user; scopes; grant?; actor?; posture?; participants? }>; // :745
// READ_SCHEMA (:787) / ACT_SCHEMA (:799) — additionalProperties:false; act requires `target`
function info(req): ServiceHttpResponse;        // GET /mcp        (:877)
function whoamiHttp(req, ctx): ServiceHttpResponse; // GET /mcp/whoami (:867)
```

**Data model.** Wire: `read({ target?, input?, as? })` / `act({ target, input?, as? })`. A `target` is a dotted address: `<cell>.<command>` for tier-1 (`workspace.recall`) or `@<owner>/<cell>.<tool>` for tier-2 (`@alice/notes.add`). `GET /mcp` returns `{ resource, authorization_servers, transport:'streamable-http', mcp_endpoint, name, tools:['whoami','read','act'], note }`. `whoamiHttp` returns 200 `{user,scopes}`, 401 + `WWW-Authenticate` when unauthenticated, or 503 `retry-after:2` when auth is degraded (`ctx.identity.degraded` — never discards a credential that was never checked).

**Invariants & edge cases.**
- `read` is `readOnlyHint:true`; `act` is `readOnlyHint:false` with **no** `destructiveHint:false` (because `cells.delete` is genuinely destructive; `service.ts:850-851`).
- Kind mismatch is refused both ways: `cap.kind !== 'read'` in `read` throws "…may mutate — invoke it with act" (`:633`); the mirror check in `act` (`:647`).
- The tool list never changes as capabilities are added — only the resolvable target space grows.
- Unauthenticated MCP calls get 401 + `WWW-Authenticate` pointing at `/.well-known/oauth-protected-resource/mcp` (`unauthorized`, `:147`) so clients can discover the auth server.
- `serverInfo`, a self-introducing `instructions` block (`:904-909`), and `GET /mcp` + `GET /mcp/whoami` are the discovery routes.

**Reduces to → cell + projection.** The gateway is a **Cell** (`defineMcpService` — an IAM-isolated Lambda listing `auth` in `allow[]`, its own origin, its own describe seam). `read` and `act` are the two **Projection** presets of one capability registry (`read` observes, `act` effects); it introduces no storage primitive of its own.

**Connections.** Depends on `platform/runtime` (`defineMcpService`, `withIdentity`, `hasScope`, `ServiceContext`) and the auth cell (identity arrives pre-validated via `allow[]`).

**ADRs.** ADR-0028, ADR-0033, ADR-0085, ADR-0086.

---

## 2. Capability resolution & dispatch (resolveTarget → enforceScope → enforceInput → forward)

**What it does.** The per-request pipeline that turns a dotted `target` into a dispatchable capability and forwards it, fetching **only** what that target needs (its provider's `describe`, not the whole registry). For `@owner/cell.tool` it calls `cells.describeCellTools` and forwards via `cells.callCellTool`; for `<cell>.<command>` it validates the cell is in `PROVIDERS`, calls that provider's `describeTools`, and forwards via `serviceClient(cell).command`. Both `read` and `act` route the same way: `resolveTarget` → kind-check → `enforceScope` (with any-of `scopeFamily`) → `enforceInput` → `cap.forward` → `touchCapability` → `withRender(withInputWarnings(...))`.

**Public API** (`services/gateway/service.ts`).

```ts
async function resolveTarget(ctx, target): Promise<Capability | null>; // :163
interface Capability { target; kind:'read'|'act'; description; inputSchema; scope; scopeFamily?; ui?; forward } // :100
const PROVIDERS = ['workspace', 'cells', 'auth'] as const; // :54
interface ProviderTool  // tier-1 descriptor (:67)
interface CellTool      // tier-2 descriptor (:82)
```

**Data model.** `resolveTarget` parses `@owner/name.tool` (slash-index + last-dot split, `:166-172`) or `cell.command` (first-dot split, `:190-193`). Tier-1 forward = `ctx.serviceClient(cell).command(command, input ?? {})`; tier-2 forward = `ctx.serviceClient('cells').command('callCellTool', { owner, name, tool, args })`. Returns `null` (→ `Unknown capability: <target>` error) for unaddressable targets.

**Invariants & edge cases.**
- Only cells in `PROVIDERS` (`workspace`/`cells`/`auth`) are dispatchable as tier-1; `auth` contributes only its token vocabulary (`tokens`/`mint`/`revoke`) — OAuth plumbing stays on auth's own HTTP routes (`:52-53`).
- A target resolves from the provider's live describe, so it is dispatchable the instant the provider advertises it.
- `cap.forward` uses Mode-1 `serviceClient` (bypasses another gateway hop); the gateway PEP is the only scope gate on the dispatch.

**Reduces to → cell + projection.** One capability registry resolved per request from the same describe seams the cells already publish; `read`/`act` are two Projection presets over it. The resolution boundary is the Cell axis's `describeTypes`/`describeTools` publish seam viewed from the consumer side — no new primitive.

**Connections.** `cells` service (`describeCellTools`, `callCellTool`); `workspace`/`auth` `describeTools`.

**ADRs.** ADR-0028.

---

## 3. The capability catalog ($catalog) — a projection with progressive disclosure

**What it does.** `read('$catalog')` (or an omitted target) aggregates every provider's `describeTools` + the dynamic-cell `describeCellTools` into one menu, filtered to the caller's scopes (advertise only what the token may use). Progressive disclosure by default (ADR-0033): a bare `$catalog` returns `summarizeCatalog` — capabilities grouped by cell, one abbreviation-aware first-sentence line each (capped at 120 chars), with `DEPRECATED` aliases collapsed to a name-only `deprecated` list. Four narrowing options, each failing loud on an unknown key.

**Public API** (`services/gateway/service.ts`).

```ts
async function buildCatalog(ctx): Promise<CatalogEntry[]>; // :210 — filtered by !c.scope || hasScope(ctx.identity, c.scope) (:250)
function summarizeCatalog(caps): { cells:[{cell,count,capabilities}], deprecated?, hint }; // :298
function firstSentence(text): string;  // :264 (abbreviation-aware: e.g./i.e./etc/vs/cf)
function summaryLine(text): string;     // :284
const CATALOG_SUMMARY_MAX = 120;        // :283
const FULL_BUDGET = 60_000;             // :586 — bytes of the DELIVERED indented payload
const overBudget = (r) => JSON.stringify(r, null, 2).length > FULL_BUDGET; // :587
```

**Data model.** `CatalogEntry { target, kind, description, inputSchema, resultSchema?, scope, disclosure?, ui?{form?} }` (`:114`). Grouped shape: `{ cells:[{ cell, count, capabilities:[{target,kind,summary}] }], deprecated:[target], hint }`. The full-dump budget is measured on the **indented** (indent-2) serialization — the MCP layer pretty-prints (~1.5× compact) — so an over-budget dump (whole, or a single large cell like `workspace` ~74 KB delivered) throws with the way to narrow, never a silent truncation.

Four narrowing options (all in `read`, `:534-612`):
- `{ resolve:'<target>' }` → `{ capability }`, one full contract (`:549`);
- `{ detail:'full'|'schemas' }` → every schema, budget-guarded (`:572`);
- `{ detail:'full', cell:'<name>' }` → one cell's schemas, still budget-guarded (`:588`);
- `{ for:'<factKey>' }` / `{ forType:'<type>' }` → the contextual menu (see §4, `:557`).

**Invariants & edge cases.**
- Scope-filter is presentation, not authority: a denied capability is simply not advertised.
- Any unknown `$catalog` option throws naming the valid ones — `KNOWN = {detail, for, forType, resolve, cell}` (`:539`). This is the W3f membrane principle: a swallowed narrow read must never widen to the whole menu.
- `DEPRECATED`-prefixed descriptions collapse to a name-only `deprecated` array (still callable, still in `detail:full`; `:311-314`).

**Reduces to → projection + fact.** A `Projection.select` over the union of every cell's published capability descriptors, scored by scope-filter (`hasScope`) and shaped by progressive disclosure. ADR-0085 makes the reduction to **Fact** explicit: capabilities *are* facts (`_caps/<target>` at `(scope,key)`), and `$catalog` is "degrading to the query it structurally already is." Today the gateway still computes the tier-1 half live (the 80-vs-121 split-brain ADR-0085 documents), so it partly reintroduces a bespoke aggregation the fact-projection is meant to absorb.

**Connections.** Shares `ProviderTool`/`CellTool` descriptors with capability resolution (§2); `workspace`/`cells`/`auth` describe seams.

**ADRs.** ADR-0033 (progressive disclosure), ADR-0085 (capability-as-fact), ADR-0049 (contextual menu).

---

## 4. Contextual capability menu ($catalog {for}/{forType}) — ADR-0049

**What it does.** `read('$catalog', { for:'<factKey>' })` or `{ forType:'<type>' }` returns a few-KB menu shaped by what the caller is holding, instead of the whole surface. Capabilities are **inferred by type**: the fact's type signals (declared type → key prefix → tag prefixes — the same `typeSignals` ladder the render floor walks) resolve to type declarations; each declaration's manager cell contributes its tools **with full schemas** (the escalation tier, small because scoped); the generally-applicable workspace verbs (`CORE_FACT_VERBS`) ride along as one-liners. With `{ for }`, the gateway peeks the fact first to read its `_meta.{type,tags}`.

**Public API** (`services/gateway/service.ts`).

```ts
export function buildContextualCatalog(
  caps: CatalogEntry[],
  types: Record<string, unknown>,
  subject: { key?; type?; meta?:{ type?; tags? } },
): { for, signals, types, capabilities, workspace, hint }; // :360
const CORE_FACT_VERBS = new Set([  // :332
  'workspace.peek','workspace.neighbors','workspace.members','workspace.link',
  'workspace.unlink','workspace.remember','workspace.supersede','workspace.share']);
function managerCell(ref): string | null; // :345 — normalises 'c15r/machine' → '@c15r/machine'
// typeSignals({ key, _meta }) from platform/ui/vocab
```

**Data model.** Returns `{ for, signals:[type], types:{ <type>:{icon,label,manager,handlers} }, capabilities:[CatalogEntry filtered to manager cells], workspace:[{target,kind,summary} for CORE_FACT_VERBS], hint }`. `{ for }` triggers a `workspace.peek` to read the subject's `_meta` (`:561`).

**Invariants & edge cases.**
- No new authority: the contextual catalog is a **filter** over what the token could already call.
- Manager cells are derived from matched type declarations only; a type with no manager contributes nothing beyond the workspace verbs (`:381-384`).

**Reduces to → projection + fact.** A `Projection.select` preset that joins Fact-stored `_types/<t>` declarations (via `typeSignals`) to the capability set, filtered to the matched types' manager cells. Reduces to projection over fact — the join fact→type→manager→that-cell's-tools that ADR-0049 says already exists as data across `$types`/`$cells`, precomputed here in one read.

**Connections.** `buildTypes` (§5), `buildCatalog` (§3), `workspace.peek`, `platform/ui/vocab` `typeSignals`.

**ADRs.** ADR-0049, ADR-0044, ADR-0029.

---

## 5. Self-model surfaces ($types / $graph / $grants / $cells) + platform.logs

**What it does.** Sentinel `read` targets that expose the substrate's model of itself as data.
- `$types` (`buildTypes`, `:490`) merges the canonical global type vocabulary (`cells.describeTypes`) under the caller's per-user `_types/` slice overrides via the shared `buildTypeVocabulary` library (ADR-0044 Inc 2 — one resolver shared with cell SSR).
- `$graph` forwards to `workspace.graph` (`:617`).
- `$grants` forwards to `workspace.grants` (`:620`).
- `$cells` forwards to `cells.contracts` (`:623`).
- `platform.logs` (admin, gated on `platform:admin`) tails a tier-1 service's CloudWatch logs via `cells.platformLogs` (`:627-630`).

**Public API** (`services/gateway/service.ts`).

```ts
async function buildTypes(ctx): Promise<{ types, hint }>; // :490 — buildTypeVocabulary(global.types, slice.entries)
const TYPES='$types', GRAPH='$graph', GRANTS='$grants', CELLS='$cells', PLATFORM_LOGS='platform.logs'; // :59-63
const PLATFORM_ADMIN_SCOPE = 'platform:admin'; // :65
// in read(): GRAPH → workspace.graph; GRANTS → workspace.grants; CELLS → cells.contracts
```

**Data model.** `$types` keys are bare type names → `{ icon, label, manager, handlers, fields?, present? }`. `$cells` → `{ cells:[{ address, name, owner, status, public, description, publishes[], backs[], substrate:{ ssrReads[], callerWrites[] } }], hint }`. `platform.logs` forwards `{ service }` to `cells.platformLogs` after `enforceScope(platform:admin)`.

**Invariants & edge cases.**
- `buildTypes` fails closed for anonymous callers on the slice read — they simply get the global vocabulary (canonical half is unauthenticated-friendly; `:493-503`).
- `platform.logs` is the only self-model surface gated by scope; the rest are scope-agnostic projections.
- The merge is a shared library (`buildTypeVocabulary`), so `$types` is no longer wire-only — cell SSR uses the same resolver.

> ⚠ **Coherence — `$graph` currently errors on the deployed instance (conflicts).** `read('$graph')` forwards to `workspace.graph` (`services/gateway/service.ts:617`), but `workspace.graph` is DEPRECATED (ADR-0069; the working unified form is `workspace.edges`) and errors "Unhandled" on the live instance while `$cells`/`$types`/`$grants` work. This is a real source↔deployment divergence: the gateway's third self-model surface is broken. Related, and higher-severity — see the coherence callout in §5b below: even the replacement (`workspace.edges` / bare `edges()`) shares an **unbounded-projection** footgun.

> ⚠ **Coherence — `$graph` has no size guard (high, conflicts).** Unlike the `$catalog` `detail:full` branch (which has an `overBudget` guard, `service.ts:587-611`), the `$graph` branch (`service.ts:617`) returns `workspace.graph({})` with no limit. `graph`, `$graph`, bare `edges()`, and `links` all funnel through the same `state.graph`/`scopeEdges` path that returns ALL edges when `limit===undefined` (`services/workspace/shape.ts:162`; `commands-graph.ts:205-213,269-274,307`). The in-code ADR-0081 comment (`commands-graph.ts:279-283`) confirms the unbounded projection already caused a silent CloudFront 30 s / 6 MB failure in the home cell. **Fix:** give the whole-projection framing a default page limit (with `nextCursor`) so `$graph` and bare `edges()` are safe at corpus scale; the deprecation of `graph` is cosmetic — the operational break is the missing default bound, inherited by the ADR-0069 replacement. (The specific live figure "29018 edges" is a runtime observation, not verifiable from the repo; the argument does not depend on it.)

> ⚠ **Coherence — present-facet resolution is documented against a dead function (medium, mis-citation).** `platform-core.md:190,291` cites `resolvePresent` (`platform/runtime/present.ts:52`) and a call site at `service.ts:335-339` — but `service.ts:335-339` is the `CORE_FACT_VERBS` Set, unrelated to present, and `resolvePresent`/`resolveLabel` have **zero call sites** in `services/` or `cells/`. The gateway actually resolves the present facet at `service.ts:509` via `buildTypeVocabulary` → `resolveType` (`type-vocabulary.ts:42-49`, `type-schema.ts:175-189`), which attaches `resolved.present`. **The server present path genuinely converges** through `resolveType`/`buildTypeVocabulary` (gateway `$types`, workspace read/search/graph envelopes, cell SSR all use it) — the divergence is confined to client per-fact resolution and the orphaned `resolvePresent` name. **Fix:** update the docs/ADR-0012 to name `resolveType`'s present facet as the real present core, and either wire in or delete `resolvePresent`.

**Reduces to → projection + fact + cell.** Each surface is a `Projection.select` over Fact-stored declarations: `$types` over `_types/*` merged with the global registry; `$grants` over the grant index; `$graph` over the Reference/edge projection; `$cells` over the Cell-axis contracts (`describeTypes` publish seam). ADR-0085 §5 frames these as "a self-model computed out-of-band that could be read through the model" — projection+fact today with bespoke sentinel dispatch.

**Connections.** `cells` (`describeTypes`, `contracts`, `platformLogs`); `workspace` (`query _types/`, `graph`, `grants`); `platform/runtime` `buildTypeVocabulary`.

**ADRs.** ADR-0044, ADR-0069, ADR-0007, ADR-0008, ADR-0085.

---

## 6. Scope enforcement (the PEP): teaching denials with incremental authorization

**What it does.** `enforceScope` is the gateway's policy enforcement point — every capability's declared scope is checked against the caller before forwarding, distinguishing three cases as a **teaching** denial:
1. Effective scope covers it → allow.
1b. An any-of `scopeFamily` gate (e.g. `write:type:*`) satisfied by `holdsUnder` → allow, letting the provider's handler refine per the concrete request.
2. Within the token's grant ceiling but not the session's active focus → `scope_offer`: a self-serve widen via `auth.requestScope`, no re-consent (incremental authorization).
3. Outside the grant ceiling entirely → `scope_denied`, returning a ready `/oauth/authorize` elevation URL (passkey → approve → wider token) or the `auth.mintToken` path.

**Public API** (`services/gateway/service.ts`).

```ts
function enforceScope(ctx, target, scope, family?): void; // :455
// hasScope / hasGrantScope / holdsUnder  (platform/runtime)
// ServiceAuthError — scope_offer / scope_denied teaching messages
```

**Data model.** Reads `ctx.identity.{ scopes, grantScopes, tokenId }`. `scope_denied` builds `${PUBLIC_BASE_URL}/oauth/authorize?scope=<s>&elevate=<tokenId>` (`:472-475`). Applied in `read`/`act` only when `cap.scope` is set, passing `cap.scopeFamily` (`:634`, `:648`).

**Invariants & edge cases.**
- A token is a **ceiling** — `scope_denied` means the credential itself is too narrow (needs re-consent or a wider mint); `scope_offer` means the session merely narrowed and can self-widen.
- `scopeFamily` is an any-of gate: a coarse token satisfies `scope` directly; a family-member token passes via `holdsUnder` and the handler refines; a token with neither falls to offer/denied.
- The same `enforceScope` runs on widget-initiated calls proxied by the MCP-Apps host — no ambient authority leaks into widgets (ADR-0034).

> ⚠ **Coherence — authority grammar is cleanly single-sourced (info, compounds).** Scope-pattern math lives only in `platform/runtime/auth.ts` (`matchesScope`/`hasScope`/`hasGrantScope`/`holdsUnder`/`requireScope`, `:166-314`); the gateway `enforceScope` (`service.ts:455`) funnels through the shared predicates (imports `:35-36`) with no bespoke matching. This is the convergent backbone the seam should have — keep scope math in `auth.ts`, do not let a second implementation leak in.

**Reduces to → cell + fact.** Reduces to the Cell core's identity axis (scope = IAM principal = OAuth target). The three-way decision reads the token's effective scopes vs its grant ceiling (`grantScopes`) — both carried on `ctx.identity`, Fact-backed authority state. It is the constitutional realization of "the grant gate is a projection preset over the grant index" at the dispatch choke point.

**Connections.** auth cell (`requestScope`, `mintToken`, `/oauth/authorize`); `platform/runtime` identity.

**ADRs.** ADR-0022, ADR-0024.

---

## 7. Membrane input validation (enforceInput / validate.ts)

**What it does.** Server-side enforcement of each capability's **declared** `inputSchema` at the gateway dispatch choke point (wave-5, the W3f principle: "a silently-ignored input is worse than an error"). Two tiers: **violations** (missing required key, wrong type, enum/oneOf miss) fail fast with schema feedback and the accepted-keys list; **unrecognised keys** let the call proceed (stale-schema clients and undocumented aliases must not break) but come back as a `_inputWarnings` note on the result. The checker is a deliberately **tolerant** JSON-Schema subset — it only flags what it is sure about and passes anything it does not model.

**Public API** (`services/gateway/validate.ts` + `service.ts`).

```ts
export function validateInput(input, schema): InputValidation { errors, ignored }; // validate.ts:75
export function acceptedKeys(schema): string[];                                     // validate.ts:108
export function withInputWarnings(result, ignored, target, schema): unknown;        // validate.ts:119
function enforceInput(target, input, schema): InputValidation;                      // service.ts:660 (throws on errors)
```

**Data model.** `InputValidation { errors:string[], ignored:string[] }`. `matches()` is tolerant (`validate.ts:56`): no `type` → pass; `integer` accepts `number`; `enum`/`oneOf` checked. `withInputWarnings` appends `{ _inputWarnings:[string] }` to **object** results only (non-objects have nowhere to carry it; `validate.ts:121`).

**Invariants & edge cases.**
- Only object contracts are modelled (`s.type` must be `'object'` or absent; `validate.ts:78`); unknown-key detection only runs when the schema enumerates `properties` (`validate.ts:92`).
- Runs **after** `dispatchContext`, so the membrane `as` key is already stripped and never counts as unrecognised (`service.ts:659-660`).
- A false "invalid" would be worse than the silence it replaces — the checker errs toward passing.
- **Motivating bug** (from `validate.ts` header): `changes({since})` — the real key is `sinceSeq` — returned the default page as if the filter applied. This validator makes that a loud error (violation) or a warning (unrecognised) instead.

**Reduces to → projection.** It reintroduces its own local machinery (a JSON-Schema validator subset) rather than a substrate primitive, but it is a guard bolted onto the **Projection** dispatch pipeline: it consumes the capability descriptor's `inputSchema` (part of the projection's published contract) and shapes the result (the `_inputWarnings` annotation is a present-stage decoration). It reuses no substrate storage.

**Connections.** Consumes capability `inputSchema` from `resolveTarget` (§2).

**ADRs.** ADR-0085.

---

## 8. Embodied participant threading (`as`) + ambient-frame presence — ADR-0086

**What it does.** `read`/`act` accept an optional `as` participant key: a short, self-declared name for the embodied actor within one connection (`steward/weave`, `membrane-probe/CI-d1`). `dispatchContext` validates it loudly against `PARTICIPANT_RE` and threads it via a derived context (`withIdentity` — identity patched *and* `serviceClient` rebuilt) so it lands as provenance beside `via` on writes and in usage telemetry — **never as authority**. A second slot honors `input.as` as a fallback for clients whose cached tool schema predates the `as` deploy, and **always** strips it before forwarding. whoami's ambient frame (`livePresence`) reads live `_presence/*` leases in the caller's slice — who else is acting right now, through what verb — with lapsed leases already excluded at read (the timer *is* the liveness).

**Public API** (`services/gateway/service.ts`).

```ts
function dispatchContext(input, ctx): ServiceContext;  // :426 — withIdentity(ctx, { participant: as })
const PARTICIPANT_RE = /^[\w@][\w@/.:-]{0,63}$/;        // :411
async function livePresence(ctx): Promise<PresenceRow[] | undefined>; // :719 — query prefix '_presence/', limit 12
interface PresenceRow { participant; actor?; lastTarget?; lastSeen?; until? }; // :705
const AS_PROP // :782 — on both READ_SCHEMA and ACT_SCHEMA
```

**Data model.** `_presence/<participant>` fact value `{ participant, actor?, lastTarget? }`, with `_meta.updatedAt` (→`lastSeen`) and `_meta.timer.expiresAt` (→`until`). `whoamiTool` returns `{ user, scopes, grant?, actor?, posture?, participants? }` (`:764`). A participant may adopt its own posture via `_posture/<participant>` `{ goal?, lens?, salience? }` (documented on `AS_PROP`).

**Invariants & edge cases.**
- The participant key **never** touches authority: writer stays the verified principal, scopes stay the token's; no read filter/grant/guard conditions on `as`. This is *the* invariant to guard in review (ADR-0086 Cost).
- An invalid `as` is rejected loudly with a teaching message (`:434-438`).
- `input.as` is stripped in both slots before forwarding (`:431`) — leaking it downstream would grow every handler an accidental parameter.
- The ambient frame is decoration, never a failure — `livePresence` returns `undefined` on any error and arrives as a few thin rows (limit 12), not a roster dump.
- `grant` is surfaced in whoami **only when it differs** from `scopes` (`grantDiffers`, `:759`) — otherwise a byte-identical echo.

**Reduces to → fact + cell.** Reduces to **Fact**: presence is `_presence/<participant>` — a keyed `{value,_meta}` row with a delete-effect timer (the TTL-bounded shadow / lease physics), and the participant key rides where `via` rides on the fact's `_meta`. The threading itself is a **Cell**-axis identity decoration (`withIdentity` on `ServiceContext`). Presence is "just a fact with a short lease" (ADR-0086).

**Connections.** `platform/runtime` `withIdentity`; `workspace.query` (`_presence/*`); `capability.invoked` event carries `participant` (§9).

**ADRs.** ADR-0086, ADR-0074, ADR-0050.

---

## 9. Capability salience touch (capability.invoked → _caps/<target>) — ADR-0085

**What it does.** Every *successful* `read`/`act` dispatch touches the target's capability fact by emitting a `capability.invoked` platform event, which the workspace applies as one actor-classed counter bump on `_caps/<target>` in the **caller's** scope (the ADR-0050 touch primitive, absent-key-safe). Invocation feeds salience: a verb you drive daily accrues velocity/standing and floats into the recall focus band while the long tail elides. Best-effort by design — a salience signal must never fail the dispatch it measures. Only real capability dispatches touch; the self-model surfaces (`$catalog`/`$types`/…) are projections, not invocations.

**Public API** (`services/gateway/service.ts`).

```ts
async function touchCapability(ctx, target, kind): Promise<void>; // :685
ctx.events.emit('capability.invoked', { scope, target, kind, actor?, participant? }); // :688
defineMcpService({ events: { emits: ['capability.invoked'] } }); // :899
```

**Data model.** Event `{ scope: identity.user, target, kind, actor?: identity.actor, participant?: identity.participant }`. Applied downstream as a counter bump on `_caps/<target>` (facts written by platform/cells via `cells:capability`, shape `{ name, summary, schemaRef, cell, kind, target }`).

**Invariants & edge cases.**
- Best-effort: a failed emit is caught and warned, never propagated (`:699-701`) — the dispatch succeeds regardless.
- Anonymous callers (no `identity.user`) are a no-op (early return, `:686`).
- A target whose `_caps` fact doesn't exist in this scope (e.g. a granted foreign cell's tool, whose fact lives in the owner's slice) is a silent downstream no-op — firing unconditionally is safe.
- Self-model reads are **not** touched (they are projections, not invocations) — recording them would make salience a mirror of orientation reads (ADR-0050's own caution).
- ADR-0086 coherence cost: on one connection all participants share one `_caps` row unless `as` distinguishes them — which is why the event carries `participant`.

**Reduces to → fact.** Reduces directly to **Fact**: `_caps/<target>` is a keyed `{value,_meta}` row whose attention counters (standing/velocity) are the read-time-timer/actor-classed accrual of the Fact core. The gateway only emits the event; the workspace's touch is the monotonic server-stamped counter bump. ADR-0085's thesis is "a capability is a fact like any other" — this is the wire that makes it true.

**Connections.** `workspace` (`ObservedState.touch` / counter path); `platform` events.

**ADRs.** ADR-0085, ADR-0050, ADR-0086.

---

## 10. MCP-Apps conversation card + cell-renderer federation (widgets.ts) — ADR-0034/0039

**What it does.** The gateway serves the `ui://parc/card` resource — a self-contained sandboxed-iframe widget that renders a `read`/`act` result's `structuredContent` in the conversation, using the same `platform/ui` render vocabulary as the home cell (esbuilt to `app.js`, inlined into an HTML shell, with a minimal fallback that still does the MCP-Apps handshake). The card is bound statically to `whoami`/`read`/`act` via `_meta.ui.resourceUri` (parc has only 3 tools, so per-target binding is impossible — the card resolves per-type rendering at runtime). `withRender` stamps a capability's declared renderer onto its object result as `_render` (the per-tool analogue of a type's `handlers.render`). **Federation hop** (ADR-0039): a cell-authored renderer addressed `ui://@owner/name/<path>` is resolved server-side by fetching the owning cell's served asset over `cells.call` (TTL-cached), so a type's conversational renderer is authored + deployed by its cell with no platform `cdk deploy`.

**Public API** (`services/gateway/widgets.ts` + `service.ts`).

```ts
export const CARD_URI = 'ui://parc/card', UI_MIME = 'text/html;profile=mcp-app'; // :16-17
export function resolveUiResource(uri, ctx?): UiResource | Promise<UiResource|null> | null; // :194
export function listUiResources(): {...}[]; // :215
async function resolveCellRenderer(uri, ctx): Promise<UiResource|null>; // :162
const CELL_RENDERER_RE = /^ui:\/\/@([^/]+)\/([^/]+)\/(.+)$/; const CELL_RENDERER_TTL_MS = 60_000; // :158-159
function withRender(result, cap): unknown;  // service.ts:524 — stamps _render on objects only
defineMcpService({ capabilities:{ extensions:{ 'io.modelcontextprotocol/ui':{ mimeTypes:[UI_MIME] } } }, resources:{ read, list } }); // :914-918
```

**Data model.** `resolveUiResource(CARD_URI)` returns `{ uri, mimeType:UI_MIME, text:cardHtml(), _meta:{ ui:{ csp:{ resourceDomains:['https://cdn.jsdelivr.net'] }, preferredFrameSize:{width:'100%',height:'560px'} }, 'mcpui.dev/ui-preferred-frame-size':['100%','560px'] } }`. `withRender` adds `{ _render:{ renderer, as: cap.ui.as ?? cap.target } }` to object results only. Cell renderer resolves via `cells.call { owner, name, method:'GET', path:'/'+path }`, honoring `statusCode < 400` and `isBase64Encoded` (`widgets.ts:169-183`).

**Invariants & edge cases.**
- Widget runs in a sandboxed iframe on a separate/opaque origin with no ambient parc.land session (ADR-0034 security model); it reaches the gateway only via the host `resources/read` + `tools/call` proxy, under the same `enforceScope`.
- `withRender` stamps only objects (arrays/scalars pass through, `:525`); a renderer-less capability is unchanged.
- `act` **also** binds the card (not just `read`) — else an act result's widget never fires (`service.ts:855-861`); the card handles mutation results additively, never replacing the model's text channel.
- No live server push (Function URL / CloudFront ~30 s cap) — widgets poll `workspace.changes` or re-invoke.
- The federation resolver falls back to `null` on any failure (`widgets.ts:185-187`) — the card degrades to the type's render hint.

**Reduces to → projection + cell + edge-http.** Reduces to the **Projection** present stage (the Affordance/render shape) projected to a sixth surface, the conversation — ADR-0034 frames MCP-Apps as "a second renderer of an existing declaration." The federation hop reduces to the **Cell** axis (`cells.call` over the origin-isolated cell HTTP face) and the **Edge HTTP** contract (the host proxies `resources/read` to the gateway with the connection's auth over CloudFront + Function URL).

**Connections.** `cells.call` (federation fetch); `platform/ui` render vocab; `services/gateway/client/main.ts` → `app.js`.

**ADRs.** ADR-0034, ADR-0035, ADR-0039, ADR-0041, ADR-0036, ADR-0037.

---

## 11. Dispatch tier-2 HTTP ingress & cell routing (/@<owner>/<name>/*)

**What it does.** Dispatch owns a single CloudFront behaviour so every dynamic cell is reachable by path without its own build-time behaviour. It parses `/@<owner>/<name>/<rest>`, resolves the cell, and proxies the call to forge (`cells.call`) — which holds the invoke permission and registry — so dispatch never reads another cell's data directly, preserving the cell boundary. Anonymous GET/HEAD flow through so PUBLIC cells can serve pages/assets to a plain browser (`cells.call` is the gate); everything else requires an authenticated caller. A `DISPATCH_DEFAULT_CELL` env (the "home demotion") routes unmatched apex paths to a default tier-2 cell, making the platform's face itself a userland surface. Cell responses pass through faithfully (headers/content-type, body encoding, status).

**Public API** (`services/dispatch/service.ts`).

```ts
export const handler = defineService({ name:'dispatch', commands:{},
  http:[ GET/HEAD/POST/PUT/DELETE /@*, GET/HEAD /* ] }); // :431-448
async function route(req, ctx): Promise<ServiceHttpResponse>; // :321
function parsePath(rawPath): { owner, name, subPath } | null; // :29
// forward: ctx.serviceClient('cells').command('call', { owner, name, method, path, query, body, ssrData? }) — :375
```

**Data model.** Route regex `/^\/@([^/]+)\/([^/]+)(\/.*)?$/` (`:30`). `CallCellResult { statusCode, body, headers?, isBase64Encoded? }` (`:20`). `/@*` routes are registered **before** `/*` catch-alls so cell paths win; apex catch-alls only reach `route` when `DISPATCH_DEFAULT_CELL` is set (`:335-340`).

**Invariants & edge cases.**
- Dispatch never reads another cell's table — it proxies via `cells.call` (forge holds registry + invoke permission).
- Anonymous callers reach only public cells (`cells.call` is the gate); anonymous non-GET/HEAD gets 401 (`:326-329`).
- Cell responses pass through faithfully; a cell failure degrades to 502 (`:421-428`).

**Reduces to → cell + edge-http.** Reduces to the **Edge HTTP** contract (it IS the tier-2 ingress that makes CloudFront + IAM-auth Function URLs realise the cell public HTTP face) compounding the **Cell** axis (it proxies to forge/`cells.call` rather than touching a cell's table — the origin-isolation + invoke-permission boundary). Realisation, not constitution.

**Connections.** `cells` service (`call`, `ssrReadsFor`, `callerWritesFor`); CloudFront behaviour `/@*` (+ apex when `DISPATCH_DEFAULT_CELL`).

**ADRs.** ADR-0008.

---

## 12. Dispatch SSR read-proxy (server-render as the caller)

**What it does.** For an authenticated top-level navigation (a non-asset path — root `/` plus deep-link paths a cell's `ssr.json` scopes via `paths`), dispatch runs the cell's **declared** substrate reads AS THE CALLER and hands the shaped results to `cells.call` → injected as `event.ssrData`, so the cell server-renders real content while **never** receiving a token. Dispatch's service client carries the validated identity (cookie → token on a top-level navigation), so each read is scoped/shaped exactly as over MCP. Route patterns support literal/`:name`/`*rest` tokens with URL-decoded param substitution into `${name}` read inputs, plus optional `where` regex validation on captured params. Only the read-only targets in `SSR_READ_TARGETS` are proxied — a write target is refused (a security boundary: `ssr.json` is authored by the OWNER but executes as the CALLER, so a write would be a CSRF-style write into the victim's slice).

**Public API** (`services/dispatch/service.ts`).

```ts
export function selectSsrReads(reads: SsrRead[], subPath): SsrRead[]; // :120
async function runSsrReads(reads, ctx): Promise<Record<string,unknown>>; // :161
function matchSsrPath(pattern, path): Record<string,string> | null; // :86
function substituteSsrParams(input, params): ...; // :105
function paramsSatisfy(where, params): boolean;   // :66
const SSR_READ_TARGETS = new Set([...]); // :142 — workspace.query/changes/peek/recall/views/links/attention/neighbors/shared/grantRequests, cells.list/describeTypes/describeTools/get, auth.tokens
interface SsrRead { as, target, input?, paths?, where? } // :39
```

**Data model.** `ssr.json` reads keyed by `as`; results collected into `ssrData:{ <as>:result }` passed to `cells.call`. `workspace.changes { recent:N }` resolves to the head→window two-step (`changes { sinceSeq:'head' }` then `{ sinceSeq: max(0, seq-N), limit:N }`, `:174-179`). Patterns: `/m/:slug` + input `{ prefix:'machine/${slug}/node/' }`.

**Invariants & edge cases.**
- Only `SSR_READ_TARGETS` are run — gated to read-only commands **explicitly** (not by service, `:142-148`), so the proxy can never mutate; a non-listed target is warned and skipped (`:166-168`).
- Reads run as the caller and **degrade** on failure (the section just loads client-side, `:181-183`).
- A cell declaring no `paths` behaves exactly as before (root-only) — backward compatible (`:123`).
- A malformed author `where` regex falls back to permissive — a typo never breaks SSR (`:73-75`).
- SSR only runs for `GET`/`HEAD` on a non-asset path (`!parsed.subPath.includes('.')`, `:359`).
- **Live-confirmed:** `machine` declares 7 ssrReads (`workspace.query`×6 + `workspace.peek`); `home`/`home-next` declare `cells.describeTypes` — the exact declared-read seam this proxy runs.

**Reduces to → cell + projection + edge-http.** Reduces to the **Cell** axis's declared `ssrReads` seam (the cell declares read intent; the platform runs it) executed as **Projection.select** presets over the caller's slice, delivered through the **Edge HTTP** contract (SSR on a browser navigation). forge can't do this itself (forge↔workspace is a CDK dependency cycle); dispatch has no back-edge — a structural reason this lives in dispatch, not a new primitive.

**Connections.** `cells.ssrReadsFor`, `cells.call`; `workspace` read commands; the caller's cookie→token identity.

**ADRs.** ADR-0020, ADR-0008.

---

## 13. Dispatch caller-write delegation (x-parc-writes — the write twin of the SSR proxy)

**What it does.** A cell can ASK dispatch to persist facts into the CALLER's slice (or, with `owner` + a declared `crossSlice` intent, into another slice the caller holds a write-grant on) by setting an `x-parc-writes` response header (a JSON array of `{ key, value, type?, tags?, via?, owner? }`). Dispatch applies them AS THE CALLER via `workspace.remember`, never handing the cell a token, then strips the header so it never reaches the browser. The cell stays declarative — it expresses write intent; the platform decides whether the caller is allowed. **Three guards enforced here** (Mode-1 `serviceClient` bypasses the gateway PEP, so this IS the `scope(caller, write)` act boundary): (1) the caller must hold `write:workspace`; (2) each write must fall under a prefix the cell **declared** in `ssr.json` `writes` and match its optional type bound (+ crossSlice opt-in); (3) reserved namespaces are always refused and the batch is capped at 16.

**Public API** (`services/dispatch/service.ts`).

```ts
export async function applyCallerWrites(raw, manifest: CallerWriteIntent[], cellAddress, ctx): Promise<WriteOutcome>; // :256
function parseRequestedWrites(raw): RequestedWrite[]; // :233
const RESERVED_WRITE_PREFIXES = ['_actions/','_views/','_grants/','_groups/','_public/']; // :209
const MAX_CALLER_WRITES = 16, WRITES_HEADER = 'x-parc-writes'; // :210-211
interface CallerWriteIntent { keyPrefix, types?, crossSlice? } // :213
interface RequestedWrite { key, value, type?, tags?, via?, owner? } // :221
```

**Data model.** `cells.callerWritesFor` returns `{ writes: CallerWriteIntent[] }`. Applied via `workspace.remember { key, value, type?, tags?, owner?(crossSlice), via: w.via ?? cellAddress }` (`:303-310`). Response headers set: `x-parc-writes-applied:<n>`, `x-parc-writes-refused:<n>`, or `x-parc-writes-denied:'scope'` (`:406-409`).

**Invariants & edge cases.**
- **Guard 1 (security-critical):** no `write:workspace` scope → whole batch denied (`denied:true`), nothing written; anonymous callers never write (header dropped, `:262-267`, `:394`).
- **Guard 2:** each write must match a declared `keyPrefix` (+ type bound, + crossSlice opt-in) — consented surface, not arbitrary (`:288-293`).
- **Guard 3:** reserved namespaces always refused; batch capped at 16 (`:277-281`, `:294`).
- crossSlice write-through is finally bounded at the act by `requireWriteThrough` (the caller's own grant, inside `workspace.remember`); a `grant_denied` throws and is counted as refused, never silently dropped (`:299-315`).
- **Live-confirmed:** `starter` declares callerWrites `[{keyPrefix:'note:'}, {keyPrefix:'shared/', crossSlice:true}]` — own-slice + a cross-slice-opted prefix.

> ⚠ **Coherence — cell tier does ownership, not scope math (info, compounds).** The cell tier checks identity/ownership (`caller === OWNER`, `x-cell-caller`; e.g. `cells/starter/index.ts:99-100`), never scope or grant math, and cross-slice writes funnel back through the ONE write-through guard rather than reimplementing it. This is convergent-by-design (ADR-0008): the cell DECLARES an `x-parc-writes` intent, dispatch validates it against the manifest `keyPrefix`/`crossSlice` (`service.ts:288-293`), then calls `workspace.remember` whose `requireWriteThrough` is the single grant authority. Note: because it terminates in `requireWriteThrough`, any workspace group-write bug is inherited by the caller-write path — fixing it upstream fixes both.

**Reduces to → cell + fact.** Reduces to the **Cell** axis's declared `callerWrites` seam (bounded substrate grant — the cell declares a keyPrefix; the platform gates it) writing **Fact** rows via `workspace.remember` (server-stamped, supersede-not-delete, provenance-carrying via `via`). crossSlice write-through is bounded at the act by the caller's own grant (`requireWriteThrough`) — the grant projection over the fact index.

**Connections.** `cells.callerWritesFor`; `workspace.remember` (+ `requireWriteThrough`); `hasScope('write:workspace')`.

**ADRs.** ADR-0008.

---

## 14. Substrate archiver — the analytics/durable-archive stream mirror

**What it does.** A DynamoDB-stream consumer on `SubstrateTable` (alongside the vector indexer): each fact create/update/remove is flattened to one JSON row and forwarded to Kinesis Firehose, which lands it gzip'd + date-partitioned in the lake bucket for Athena. It never makes an access decision and never writes back to the substrate — it only mirrors facts outward, running OFF the stream (not inside the write), so a failure here cannot perturb the write path or the reactor. `planArchiveRows` is the pure, testable core; it filters to facts (`sk = 'KEY#…'`, skipping `EDGE#`/`TRAJ#`/`SEQ#` partitions) and reads `OldImage` on `REMOVE`.

**Public API** (`services/substrate-archiver/handler.ts`).

```ts
export function planArchiveRows(event: StreamEvent, archivedAt): FactRow[]; // :98
export interface FactRow { scope,key,type,tags,revision,seq,first_seq,writer,via,
  superseded,superseded_by,created_at,updated_at,timer_expires_at,timer_effect,
  event_name,value_json,archived_at }  // :47
export async function handler(event): Promise<void>; // :123 — Firehose.putRecordBatch, PUT_CHUNK=500 (:115)
```

**Data model.** Reads `FactItem` off the unmarshalled `NewImage` (or `OldImage` on `REMOVE`, `:104-107`). Emits newline-delimited `FactRow` JSON to `FIREHOSE_STREAM`; `value` serialized as `value_json` string (`:88`). Filters `sk.startsWith('KEY#')` (`:109`).

**Invariants & edge cases.**
- Never makes an access decision, never writes back to the substrate — outward mirror only.
- Runs off the stream so a failure cannot perturb the write path or reactor.
- No `FIREHOSE_STREAM` env → no-op (lane not configured, safe; `:124-125`).
- Partial Firehose delivery is logged and continued (`:137-146`); dupes are acceptable in an append-only analytics lake (a thrown error would re-forward the whole batch).

**Reduces to → fact.** Reduces to the **Fact** core: a read-only downstream consumer of the Fact change-stream (the supersede-not-delete monotonic log the substrate table emits). The analytics lake is a projection of fact history into a columnar form; it adds no primitive. It is deliberately outside the projection pipeline (no salience/scope shaping — it mirrors raw stored attributes).

> ⚠ **Coherence — two parallel "a fact changed" fan-out mechanisms (medium, conflicts).** Exactly two `DynamoEventSource` consumers attach to `substrate.table` — `vectorIndexer` (`lib/platform-stack.ts:206-214`) and `archiver` (`:240-248`), both `StartingPosition.LATEST`. But the **reaction** path is a different substrate: `FactReactionRoute` (`platform-stack.ts:269`) is an EventBridge rule on the logical `workspace.fact.written` event emitted via `putEvents` (`platform/runtime/events.ts:42-48`), **not** off the table stream. So there are two parallel propagation mechanisms selected inconsistently: indexer/archiver via the DynamoDB stream; reactions/reindex/capability-touch via EventBridge. No shared helper unifies them. **Fix:** adopt the stream as the canonical fan-out for reactions too, collapsing `workspace.fact.written` into a stream-derived signal — one origin for all paths.

**Connections.** `SubstrateTable` DynamoDB stream; Kinesis Firehose → lake bucket; Athena (downstream).

**ADRs.** ADR-0013, ADR-0007.

---

## 15. Vector indexer — index-on-write, similarTo edge reconciliation, layout patch

**What it does.** The live, incremental half of semantic indexing (ADR-0030 Inc 2): a second `SubstrateTable` stream consumer that embeds each fact create/update and upserts it into its slice's vector index (`indexForScope`), removing it on `REMOVE`/supersession. It never makes an access decision — the index is a candidate generator re-checked authoritatively at search time. `planStreamWork` is the pure core: filters to facts, drops on remove/supersession, **drops ephemeral facts** (a delete-effect timer — a lease/presence row — must never enter the index, else it mints `similarTo` kinship between coordination artefacts), and sha-skips a metadata-only rewrite. Per batch it also: reconciles inferred `similarTo` edges (`refreshSimilarEdges`/`dropSimilarEdges`, written directly through the raw store per ADR-0031), and incrementally patches the semantic-layout fact (`_home/embed2d`) coords via the persisted PCA basis (`projectVector`) — sharded (ADR-0082) or legacy-monolith, CAS'd with retry-on-lost-race.

**Public API** (`services/vector-indexer/handler.ts`).

```ts
export function planStreamWork(event): Map<string, IndexPlan>; // :74 — IndexPlan { scope, puts, removes }
export async function patchProjection(store, scope, puts, removes): Promise<void>; // :191 (PATCH_ATTEMPTS=4, :190)
async function patchShard(state, scope, shardKey, delta): Promise<void>; // :262
// embeddableText / metadataForFact / indexForScope / selectNeighbors / refreshSimilarEdges /
// dropSimilarEdges / projectVector / LAYOUT_KEY  (platform/runtime)
const DIM = Number(process.env.VECTOR_DIM ?? (process.env.VECTOR_EMBEDDER === 'bedrock' ? 1024 : 256)); // :60
```

**Data model.** `VectorRecord { key, vector, metadata }`. `similarTo` edges reconciled against `edgeStore.listEdges(scope)` with `sim.{k,minScore,strength}` (`:147-153`). Layout: `_home/embed2d` `{ basis, norm, coords, shards? }` (type `graph-layout`) or per-shard `{ coords }` (type `graph-layout-shard`); coords are `[x,y,z]` from `projectVector`. CAS via `ifVersion`/`ifAbsent` (`StatePreconditionError` → jittered retry, `:253-255`).

**Invariants & edge cases.**
- Never makes an access decision — index is a candidate generator re-checked at search time (ADR-0030 Decision 1).
- Ephemeral facts (`timerEffect==='delete'`) and superseded/removed facts are dropped from the index (`:94-109`) — a vocabulary-free rule (the timer IS the declaration); this fixed timer-deleted leases holding the top-19 contested slots at 0.99 cosine.
- similarTo/layout passes are best-effort — a failure must not poison the stream batch (vectors already committed, `:154-156`, `:170-172`).
- `patchProjection` is CAS'd + **retried** on lost race (the ADR-0081 bulk-backfill "cylinder halo" incident: hundreds of racing stream batches lost nearly every patch); the final lost race propagates so a dropped patch is VISIBLE in logs, not silent (`:249-256`).
- No vectors backend / no map yet → no-op (safe, `:122`, `:199`); pre-basis projection is skipped until a full `project()` runs (`:201`).

> ⚠ **Coherence — index-membership fork between stream and reindex (high, conflicts).** The stream indexer drops EVERY delete-timer fact unconditionally (`handler.ts:106`), but the admin `reindex` worker sources rows via `state.query` (`commands-search.ts:763`) and its embeddable filter checks only `!!e.text` (`:764-766`) with no `timerEffect` gate. `state.query` drops timer-*expired* rows but `isTimerLive` returns true for a still-**live** delete-timer fact (`state.ts:185-189`). So a full reindex re-embeds and wires `similarTo` edges over LIVE delete-timer leases/presence rows that the stream path never admits; those re-admitted leases leak into search's authoritative re-read (`commands-search.ts:389-390`, via `state.get`) and recall (`commands-read.ts:44-57`), while contested/suggestions are protected (they re-check). **Fix:** funnel both writers through one shared `shouldIndex(fact)` predicate (or extend `embeddableText` to take `timerEffect` and return null for delete-timer facts). Bounded blast radius: live (not lapsed) leases, admin-triggered reindex only.

> ⚠ **Coherence — dimension source duplicated + latent divergence (medium, conflicts).** `DIM` at `handler.ts:60` duplicates the `vectorsFromEnv` formula (`s3-vectors-store.ts:236-240`), but `handler.ts:60` uses strict `process.env.VECTOR_EMBEDDER === 'bedrock'` while `vectorsFromEnv` lowercases first. So `VECTOR_EMBEDDER=Bedrock` (capital B) resolves `DIM=256` while the embedder is `BedrockEmbedder(1024)` — an index-name skew (`indexForScope` returns `slice-${scope}-d${dim}`) AND a dimension mismatch on the first put. The module-level `DIM` exists because `planStreamWork` is pure and has no access to the `vectors` object; the handler-body use at `:133` genuinely could read `vectors.embedder.dimension` and does not. **Fix:** after `const vectors = vectorsFromEnv()`, thread `vectors.embedder.dimension` as the single dimension source and pass `dim` into `planStreamWork(event, dim)`. Latent in production only because `lib/platform-stack.ts:136` pins `VECTOR_DIM='1024'` on both Lambdas.

> ⚠ **Coherence — reindex re-embeds to get the query vector (low, conflicts).** `commands-search.ts:787` re-embeds on the reindex *edges* phase purely to obtain the query vector (the index is already full), whereas the stream path reuses `putVecs` (`handler.ts:136,149`) with no re-embed. Bounded to the infrequent reindex/backfill path (honestly commented at `:787`), not the per-write hot path. Structurally forced: the edges phase is a separate bounded Lambda invocation that no longer holds the vectors, and `VectorStore` offers no keyed `get` (only `query`/`list`, `vectors.ts:44-53`). **Fix (optional):** add `get(index, keys[])` to `VectorStore` and have reindex read stored vectors instead of re-embedding.

> ⚠ **Coherence — vector-filter key vocabulary is not shared (low, conflicts).** `metadataForFact` writes `{ type, tag }` metadata keys (`vectors.ts:185-191`) but search's filter builder uses literal keys `filter.type`/`filter.tag` (`commands-search.ts:353-355`) with no shared constant. Because S3 Vectors filters are equality, a metadata-key rename would make **scoped** searches (`{type:X}`) match zero documents (returning empty), while unscoped searches are unaffected; the authoritative re-read cannot recover results the filter already excluded. Latent today (keys agree). **Fix:** export `VECTOR_FILTER_KEYS = {type, tag}` from `vectors.ts` and reference it from both writer and reader.

> ⚠ **Coherence — the similarTo edge invariants ARE convergent (info, compounds).** Every writer/consumer funnels through `SIMILAR_REL`/`SIMILAR_WRITER` + `selectNeighbors` (`vectors.ts:144-152`) and `refreshSimilarEdges`/`dropSimilarEdges` (`similar-edges.ts:37-85`). Stream indexer (`handler.ts:149-153`) and reindex (`commands-search.ts:789-791`) call them with identical `topK` (`sim.k+1`) and shared `similarConfig()` knobs; prune/suggestions/contested/ratify all identify inferred edges by the same rel+writer pair. This is the model of how the seam should behave — bring the embed-membership and dimension decisions up to this same single-source discipline. (Live: `workspace.edges` returns real `similarTo` edges stamped `writer=platform/vectors`, confirming the edge-reconciliation pass is live end-to-end.)

**Reduces to → fact + projection.** Reduces to **Fact** (the derived `similarTo` edges and layout coords are themselves facts/edges written back through the store — `EdgeRecord.score` holds cosine) and **Projection** (the vector index is the score/select substrate the semantic-search stage reads; the layout is the present-stage spatial projection). It compounds on the Fact change-stream and feeds projection; the vector store is an out-of-substrate candidate cache, always re-checked against facts.

**Connections.** `SubstrateTable` stream; `platform/runtime/s3-vectors-store` (`vectorsFromEnv`); `dynamo-state-store-v3` (raw edge/layout writes); `workspace.project` (creates the basis).

**ADRs.** ADR-0030, ADR-0031, ADR-0047, ADR-0082, ADR-0081, ADR-0069.

---

## Gotchas / non-obvious behavior

1. **The `$graph` self-model surface is broken on the live instance.** `read('$graph')` forwards to the DEPRECATED `workspace.graph` (`service.ts:617`), which errors "Unhandled" while `workspace.edges` (ADR-0069) is the working form. And even the replacement path has no size guard (unbounded projection — ADR-0081). `$cells`/`$types`/`$grants` work.

2. **The `$catalog` full-dump budget is measured on the INDENTED payload** (`FULL_BUDGET = 60_000`, `overBudget` uses `JSON.stringify(r, null, 2)`, `service.ts:586-587`). The MCP layer pretty-prints (~1.5× compact), so a compact measure let `workspace` (~74 KB delivered) slip the guard and overflow anyway. Preserve the indented measurement if you touch this.

3. **`as` is stripped in TWO slots** (top-level `input.as` and nested `input.input.as`, `service.ts:427-432`) and always removed before forwarding. Never let it reach a capability handler — no schema owns it, and leaking it grows every handler an accidental parameter. It must never gate authority.

4. **Unknown `$catalog` options and invalid `as` keys fail LOUD** (W3f). A swallowed narrow read that widens to the whole menu, or a silently-ignored participant key, is the exact failure the membrane principle legislates against.

5. **Membrane validation is deliberately tolerant** (`validate.ts`): it only errors on what it's sure about (declared primitive type, enum, required, oneOf-with-no-branch) and passes anything it doesn't model. `integer` accepts `number`; unknown keys warn (`_inputWarnings` on object results only) rather than block. A false "invalid" would be worse than the silence it replaces.

6. **`act` must bind the card too**, not just `read` (`service.ts:855-861`) — the host only renders a widget for a tool declaring `_meta.ui.resourceUri`. Without this an act-kind capability's `_render` stamp is invisible.

7. **The SSR read-proxy is gated by an EXPLICIT allowlist, not by service.** `SSR_READ_TARGETS` (`dispatch/service.ts:142`) enumerates read-only commands; adding a write command to `workspace` does not make it SSR-reachable, and must not — SSR executes owner-authored `ssr.json` as the navigating caller (CSRF surface).

8. **Caller-write delegation is the real `scope(caller, write)` boundary**, because Mode-1 `serviceClient` bypasses the gateway PEP. All three guards live in `applyCallerWrites` (`dispatch/service.ts:256`), and the cross-slice case is finally bounded by `requireWriteThrough` inside `workspace.remember`.

9. **Both stream consumers no-op safely when unconfigured** — archiver returns if `FIREHOSE_STREAM` is unset (`archiver:124`); indexer returns if `vectorsFromEnv()` is null (`indexer:122`). Neither can perturb the write path (they run off the stream).

10. **The indexer's ephemeral-fact rule is vocabulary-free** — it keys off `timerEffect === 'delete'` (`indexer:106`), not type names. A lease/presence row never enters the vector index. The reindex worker does NOT yet apply the same rule (see the high-severity coherence callout in §15).

11. **`DISPATCH_DEFAULT_CELL` changes routing semantics.** Unset: dispatch 404s any non-`/@` path. Set to `owner/name`: the apex `/*` catch-alls (registered AFTER `/@*` so cell paths still win) route unmatched paths to that default cell — the platform's face becomes a tier-2 userland surface.

12. **`patchProjection` propagates the final lost CAS race** (`indexer:253`). Earlier design silently no-op'd on conflict and lost ~800 coordinates under the ADR-0081 backfill storm; now a genuinely dropped patch is visible in logs. Retry with jitter (`PATCH_ATTEMPTS=4`) converges storms; only the last failure surfaces.

13. **The dispatch header doc-comment is stale** (`/d/*` / `/d/<cellId>`), the code is `/@<owner>/<name>` — see the callout at the top of this document.
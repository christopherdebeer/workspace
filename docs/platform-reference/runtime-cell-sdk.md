# Runtime — Cell SDK & Service Definition

> Reference for engineers who **use** and **modify** the parc.land cell runtime.
> Everything below is grounded in the source under `platform/runtime/` and the
> verified capability inventory for this subsystem. Path:line pointers are exact
> as of this writing; re-check line numbers before relying on them for a patch.

## The platform in one breath

The parc.land substrate reduces to three core primitives plus one edge primitive:

- **Fact** — keyed `{value, _meta}` rows in one DynamoDB table; `scope` = IAM
  principal = OAuth target. Every read and write is gated by a `dynamodb:LeadingKeys`
  condition on the scope.
- **Projection pipeline** — the single read pipeline: `select → score → shape → present`.
- **Cell axis** — IAM-isolated Lambdas that publish vocabulary, back affordances,
  and receive bounded substrate grants.
- **Edge HTTP contract** (edge plumbing) — the three Lambda@Edge transforms that
  restore the viewer bearer (`x-forwarded-authorization`), carry back
  `WWW-Authenticate`, and enforce the CloudFront/OAC realisation constraints.

Every capability in this document is tagged with a **"Reduces to:"** line naming
which core primitive(s) it compounds on.

## What this subsystem is

This subsystem **is the Cell axis's authoring and runtime SDK.** It is the thin,
in-Lambda contract that every parc.land cell is built on: the layer that turns a
bag of TypeScript command handlers into a deployed Cell with its faces —

- an **HTTP / Function-URL** face (`POST /<service>/<command>`, `GET /<service>/_manifest`),
- a **direct service-to-service** face (a `CommandEnvelope` invoke),
- an **EventBridge subscriber** face (`events.handles[detailType]`),
- and, for tool-serving cells, an **MCP JSON-RPC** face (`POST /mcp`).

It reduces almost entirely to the **Cell** primitive: `defineService` /
`defineMcpService` **are** the runtime constitution of a Cell's Lambda (ADR-0008),
and `createCellReader` is the seam (ADR-0042) that lets a cell run the SAME
projection pipeline the gateway runs — against its own IAM-scoped slice — instead
of hand-rolling raw DynamoDB. Three capabilities lean on the other cores:

- `resolveHttpIdentity` **consumes** the edge-http contract and turns it into a
  Fact-scope-bearing `Identity`;
- `createServiceClient` / `CommandEnvelope` is the **wire** that carries that
  identity across cell hops so downstream Fact operations resolve under the right
  principal;
- `createCellReader` reduces straight to the **projection pipeline** over
  Fact-stored rows.

Live grounding (from the deployment snapshot): 17 deployed cells, all
`defineMcpService`-shaped MCP servers behind the apex `/mcp`. `home` / `home-next`
/ `machine` declare the `ssrReads` (`cells.describeTypes`, `workspace.query/peek`)
that this SDK's reader and service-client mediate; `starter` is the only cell
declaring `callerWrites`. One live coherence signal to keep in mind:
`workspace.graph` errors "Unhandled" and is listed deprecated while
`workspace.edges` (the unified Reference projection) works — so
`CellReader.graph()` binds to a `state.graph()` verb the deployed gateway no
longer honours (see Gotchas).

### File map

| File | Role |
|---|---|
| `platform/runtime/define-service.ts` | The cell runtime handler; identity resolution; `withIdentity` |
| `platform/runtime/define-mcp-service.ts` | MCP JSON-RPC server over `defineService`; tool/resource machinery; `mcpResult` |
| `platform/runtime/service-client.ts` | Mode-1 inter-cell command client; `CommandEnvelope` |
| `platform/runtime/cell-reader.ts` | `createCellReader` — read-only projection bound to one slice |
| `platform/runtime/cell-sdk.ts` | `@parc/runtime/cell` — the lean, cell-safe bundle boundary |
| `platform/runtime/logger.ts` | Structured single-line JSON logger |
| `platform/runtime/types.ts` | `ServiceContext`, `ServiceDefinition`, HTTP/command wire types |
| `platform/runtime/config.ts` | `PlatformConfig` / `loadConfig` (env-backed) |
| `platform/runtime/index.ts` | Runtime barrel (service authors import from here) |

---

## 1. `defineService` — the cell runtime handler

**What it does.** `defineService(definition)` (`define-service.ts:239`) is the
single runtime entry point that wraps a `ServiceDefinition` (name, version,
commands, `events.handles`, raw `http` routes) into ONE Lambda handler that
understands three invocation styles by structurally sniffing the event:

1. **EventBridge domain event** (Mode 2, subscriber side) — has `detail-type` +
   `source` + `detail` and no `requestContext` (`define-service.ts:310`). Routed
   to `events.handles[detailType]` with a **scopeless** bus-sourced identity
   (`{ scopes: [] }`, `define-service.ts:321`). The handler receives
   `{ source, detailType }` in `meta`.
2. **Direct `CommandEnvelope`** (Mode 1) — has `__command` (`isCommandEnvelope`,
   `define-service.ts:35`). Reconstructs `Identity` from the envelope
   (`define-service.ts:334`) and returns a `CommandResult` `{ ok, result }` or
   `{ ok, error }`.
3. **Function-URL HTTP event** (payload format 2.0) — `POST /<service>/<command>`
   dispatch, `GET /<service>/_manifest` discovery, `OPTIONS → 204`, plus any
   matched raw `http` routes (OAuth / `.well-known`) (`define-service.ts:362`+).

It assembles a `ServiceContext` once per request via `buildContext`
(`define-service.ts:257`) — logger, events, serviceClient, config, identity,
correlationId, traceId — and threads correlation/trace through the
`x-correlation-id` / `x-amzn-trace-id` headers (`define-service.ts:366`). The
handler carries its `ServiceManifest` as a property for infra synthesis and tests
(`define-service.ts:439`).

**Public API.**

```ts
function defineService(definition: ServiceDefinition):
  ((event: FunctionUrlEvent | CommandEnvelope)
    => Promise<FunctionUrlResponse | CommandResult | void>)
  & { manifest: ServiceManifest };

interface ServiceDefinition {
  name: string;
  version?: string;                                   // defaults to "1.0.0"
  commands: Record<string, RegisteredCommand>;
  events?: { emits?: string[]; handles?: Record<string, EventBridgeHandler> };
  http?: HttpRoute[];                                 // matched BEFORE command dispatch
}

type RegisteredCommand = CommandHandler<never, unknown>;
type CommandHandler<I, O> = (input: I, ctx: ServiceContext) => Promise<O> | O;
type EventBridgeHandler =
  (detail: Record<string, unknown>, ctx: ServiceContext,
   meta: { source: string; detailType: string }) => Promise<void> | void;

class UnknownCommandError extends Error { readonly statusCode = 404; } // define-service.ts:509
```

**Data model / wire shapes.**

- `FunctionUrlEvent` (payload format 2.0, trimmed): `rawPath`,
  `requestContext.http.method`, `headers`, `body` + `isBase64Encoded`, `cookies`
  out. See `types.ts:113`.
- `CommandResult { ok: boolean; result?; error? }` (`types.ts:135`).
- `ServiceManifest { name; version; routes: ['/<name>/*', ...httpPrefixes];
  commands: string[]; events: { emits } }` (built at `define-service.ts:249`).
- Error → HTTP status mapping (`define-service.ts:426`): `UnknownCommandError → 404`,
  `ServiceAuthError → 401`, else `500`. Bad JSON body → `400`
  (`define-service.ts:418`).
- `defineService` owns no DynamoDB of its own — a service cell's facts live in the
  shared substrate table (via `workspace`) or a cell's own scratch table
  (`config.tableName`).

**Invariants & edge cases.**

- Command dispatch is **POST-only** and requires a non-empty tail; `GET` is
  reserved for `_manifest`; identity is resolved BEFORE dispatch
  (`define-service.ts:368`).
- A raw `http` route is matched **before** command dispatch; a `path` ending in
  `*` matches by prefix (`matchRoute`, `define-service.ts:451`).
- Bus events carry **no caller identity** — trust derives solely from the
  IAM-attested event `source`; the context is built with `{ scopes: [] }`.
- A thrown handler error in the **bus branch propagates** (lets Lambda async-retry,
  `define-service.ts:328`); the HTTP and direct branches catch and shape the error.
- Base URL for raw routes prefers `PUBLIC_BASE_URL`, falling back to
  `x-forwarded-host` / `host` (`buildHttpRequest`, `define-service.ts:469`) —
  because the viewer `Host` is stripped across the CloudFront/OAC hop.
- Any `setCookies` produced by edge silent-refresh are prepended to a raw route's
  own cookies (`define-service.ts:386`).

**Reduces to:** **Cell.** This IS the constitution of the Cell axis's Lambda face
(ADR-0008): it realises "IAM-isolated Lambda + `describeTypes` publish seam + async
write-shape" as executable dispatch. It is not itself reducible to another core —
it is the runtime half of what "a cell" means. The bus branch trusting the
IAM-attested `source`, and the direct branch reconstructing `Identity` from the
envelope, are both cell-axis attestation mechanics.

**Connections.** Depends on `logger`, `events`, `config`, `auth`
(`Identity`/`ServiceAuthError`), `service-client`, `manifest`. Every cell command
in the live catalog (`workspace.*`, `cells.*`, `auth.*`, and tier-2 `@c15r/*`
tools) runs through this handler.

**Motivating ADRs.** ADR-0008 *cell-axis*; ADR-0042 *govern-cell-core-seam*.

---

## 2. `resolveHttpIdentity` — bearer/cookie/refresh identity resolution (the cell-side PEP wiring)

**What it does.** `resolveHttpIdentity` (`define-service.ts:141`) establishes
request `Identity` for an HTTP call by validating a bearer — and **never** trusting
client-supplied `x-auth-*` headers (CloudFront forwards all viewer headers, so
they are forgeable). It:

1. Reads `Authorization` OR the edge-preserved `x-forwarded-authorization`
   (CloudFront OAC overwrites `Authorization` with its SigV4 signature), and
   extracts a `Bearer` (`define-service.ts:149`).
2. For SSR navigations that carry only cookies, narrowly honours the `parc_session`
   cookie — but ONLY when `serviceName === 'dispatch'`, method is `GET`/`HEAD`, and
   `Sec-Fetch-Dest === 'document'` (a genuine top-level navigation, unforgeable
   from JS) (`cookieAllowed`, `define-service.ts:161`).
3. Invokes the auth cell's `validateToken` command; a validated token becomes
   `Identity` via `identityFromValidated` (`define-service.ts:122`, `:178`).
4. Performs **edge silent-refresh**: on a safe top-level nav with a valid
   `parc_refresh` cookie, calls `auth.refreshSession` to re-mint an access token and
   returns `Set-Cookie` strings to re-prime the browser (`define-service.ts:186`).
5. On an auth-service **error** (cold start, throttle, mid-deploy), resolves
   *anonymous-but-degraded* (`{ ...ANONYMOUS, degraded: true }`,
   `define-service.ts:208`) so seams answer retryable `503 auth_unavailable`, not
   `invalid_token`.

`withIdentity(ctx, patch)` (`define-service.ts:219`) rebuilds the `serviceClient`
when patching identity (e.g. the ADR-0086 `participant` key) — because envelope
options are captured at context construction and a bare `ctx.identity` mutation
would never reach downstream services.

**Public API.**

```ts
// module-private (not exported): the HTTP identity resolver
function resolveHttpIdentity(
  headers: Record<string, string | undefined> | undefined,
  serviceName: string,
  method?: string,
): Promise<{ identity: Identity; setCookies?: string[] }>;

function identityFromValidated(validated: ValidatedToken): Identity;   // define-service.ts:122

export function withIdentity(ctx: ServiceContext, patch: Partial<Identity>): ServiceContext;

interface Identity {                     // from ./auth
  user?: string; actor?: ActorClass; scopes: string[];
  grantScopes?: string[]; tokenId?: string;
  participant?: string; posture?; act?; degraded?: boolean;
}
```

`identityFromHeaders` is exported from the barrel (`index.ts:15`) but is **not
wired** on the HTTP path today — it exists for a future trusted-edge authorizer.

**Data model / wire shapes.**

- `ValidatedToken { userId; scope; effectiveScope?; tokenId?; clientId;
  posture?; act? }` (`define-service.ts:55`).
- `RefreshedSession { userId; scope; effectiveScope; tokenId; setCookies[] }`
  (`define-service.ts:71`).
- Cookies: `parc_session` (short-lived access), `parc_refresh` (long-lived)
  (`define-service.ts:82`).
- `scopes` = `effectiveScope` split; `grantScopes` = `scope` (the grant ceiling)
  split; both split on `/[\s,]+/` (`define-service.ts:123`).
- `actor = clientId || act ? 'agent' : 'human'` (ADR-0022 × ADR-0050 mediation,
  `define-service.ts:137`) — a DCR-minted client token weighs as `agent`; a
  first-party session (incl. cookie silent-refresh) is the `human`.

**Invariants & edge cases.**

- Client `x-auth-*` headers are **NEVER** trusted on the HTTP path.
- The gateway (`/mcp`) stays **bearer-only**; a cookie is accepted only on
  `serviceName === 'dispatch'` + safe method + `Sec-Fetch-Dest: document`, and
  never authorizes a mutation.
- The auth cell resolves **anonymous for its own routes** (it cannot self-validate,
  `define-service.ts:170`); a cell whose registry lacks `auth` resolves anonymous
  (`define-service.ts:173`).
- Auth-service error ⇒ `Identity.degraded = true` ⇒ seams must answer
  `503 auth_unavailable` (retryable), never `invalid_token`.
- The bearer reaches only this tier-1 hop; dynamic cells receive `x-cell-caller`,
  never the token.

**Reduces to:** **Edge-http · Cell · Fact.** This is where the edge-http contract
is **consumed** — it reads exactly the `x-forwarded-authorization` the Lambda@Edge
transform restored, completing the OAC-body-signing / `WWW-Authenticate` triad. It
reduces to **Cell** (the auth cell is invoked as a peer via the registry; a cell
not listing `auth` in `allow[]` gets anonymous) and ultimately to **Fact** (the
resulting `Identity.scopes` = IAM/OAuth target = the `LeadingKeys` scope gating
every downstream Fact read/write). The cookie-narrowing rules are a self-contained
CSRF-defence primitive.

**Connections.** Depends on the auth cell (`validateToken`, `refreshSession`),
`createServiceClient`, `config.registry`, and the edge-http transforms.

**Motivating ADRs.** ADR-0008 *cell-axis*; ADR-0022 (mediation, actor class);
ADR-0024 (delegation / `act`); ADR-0074 (posture); ADR-0086 (participant key).

---

## 3. `createServiceClient` + `CommandEnvelope` — Mode 1 synchronous inter-cell commands

**What it does.** The request/response Lambda-invoke client (communication Mode 1),
`service-client.ts`. `createServiceClient(options)` (`service-client.ts:86`)
returns `serviceClient(target)` which resolves a peer service name to its Lambda
function name via the injected `registry`, **throwing** `ServiceInvokeError`
(`"…is it listed in allow[]?"`) when absent (`service-client.ts:89`). Each
`.command(name, payload)` packs a `CommandEnvelope` carrying `__command` / `payload`
/ `correlationId` PLUS the full propagated identity — `user`, `scopes` (effective),
`grantScopes` (ceiling), `tokenId`, `actor`, `posture`, `act` (delegation chain),
`participant` — so the callee reconstructs the same principal the edge validated and
applies the `effective = grants ∩ token` ceiling with correct attention/attribution.

The AWS Lambda SDK client is **lazily required** (`getClient`, `service-client.ts:78`)
— never loaded at import — and injectable via `__setLambda` for tests. A reply of
`{ ok: false, error }` (or a `FunctionError`) is unwrapped to a thrown
`ServiceInvokeError` (`service-client.ts:119`, `:129`).

**Public API.**

```ts
function createServiceClient(options: ServiceClientOptions):
  (target: string) => ServiceHandle;

interface ServiceHandle {
  command<T = unknown>(name: string, payload: unknown): Promise<T>;
}

interface CommandEnvelope {
  __command: string; payload: unknown; correlationId?: string;
  user?: string; scopes?: string[]; grantScopes?: string[];
  tokenId?: string; actor?: ActorClass; posture?: PrincipalPosture;
  act?: ActClaim; participant?: string;
}

interface ServiceClientOptions {
  registry: Record<string, string>; correlationId?: string;
  user?: string; scopes?: string[]; grantScopes?: string[];
  tokenId?: string; actor?; posture?; act?; participant?: string;
}

class ServiceInvokeError extends Error { readonly service: string; }
function __setLambda(stub: Lambda | undefined): void;   // test seam
```

**Data model / wire shapes.** The envelope is `JSON.stringify`'d as the invoke
`Payload` with `InvocationType: 'RequestResponse'` (`service-client.ts:111`). The
reply is parsed as `{ ok; result?; error? }`; a `FunctionError` or `ok === false`
⇒ `ServiceInvokeError`. `participant` (ADR-0086) is **provenance-grade only** —
"it must NEVER carry authority — no filter, grant, or guard may condition on it"
(`service-client.ts:44`).

**Invariants & edge cases.**

- A target not in the registry throws — a cell can only reach peers it declared in
  `allow[]` (the registry is the `allow[]` materialisation).
- `scopes` are trusted on the same basis as `user`: only allow-listed peers can
  invoke, and the originating cell (the gateway = PEP) validated the bearer
  (`service-client.ts:20`).
- The SDK is required lazily; importing the module never forces `aws-sdk` to load.
- `participant` is provenance only — real delegation uses child tokens (ADR-0024).

**Reduces to:** **Cell · Fact.** It is the cell-to-cell command wire, gated by the
registry (the `allow[]` materialisation of the Cell axis's bounded-grants seam,
ADR-0008). It reduces to **Fact** because the propagated
`scopes`/`grantScopes`/`act`/`posture` are the authority + provenance inputs that
resolve every downstream Fact operation under the leaf principal (`LeadingKeys`).
The envelope is the direct-invoke twin of `resolveHttpIdentity`'s HTTP identity —
same `Identity` fields, different transport.

**Connections.** Depends on `config.registry` (`SERVICE_REGISTRY`) and `auth`
(`ActorClass` / `PrincipalPosture` / `ActClaim` types). Consumed by
`define-service.ts` (`buildContext`, `withIdentity`) and by `resolveHttpIdentity`
(to call the auth cell).

**Motivating ADRs.** ADR-0022, ADR-0024, ADR-0074, ADR-0086.

---

## 4. `ServiceContext` — the per-invocation cell capability surface (`ctx`)

**What it does.** `ServiceContext` (`types.ts:15`) is the single object handed to
every command / http / event handler, assembled once per request by `buildContext`
(`define-service.ts:257`). It bundles the platform capabilities so handlers never
reach for globals:

- `logger` — a correlation/trace-bound structured logger;
- `events` — EventBridge emit (Mode 2);
- `serviceClient` — Mode 1 peer invoke, **pre-loaded with THIS request's identity**;
- `config` — `PlatformConfig` (registry + `eventBusName` + table names);
- `identity` — the resolved `Identity`;
- `correlationId`, `traceId`.

This is the **capability boundary** of a cell handler — the ambient authority a
command runs with.

**Public API.**

```ts
interface ServiceContext {
  logger: Logger;
  events: Events;
  serviceClient: (name: string) => ServiceHandle;
  config: PlatformConfig;
  identity: Identity;
  correlationId: string;
  traceId: string;
}
```

**Data model / behaviour.**

- `ctx.events.emit(detailType, detail)` puts events to `config.eventBusName`
  (a no-op when unset — see `events.ts`).
- The `serviceClient` is built with `identity.scopes` (effective) and `grantScopes`
  (ceiling), each guarded by `.length ? … : undefined` so an empty set propagates
  as *absent* rather than an empty array (`define-service.ts:277`).
- `PlatformConfig` (`config.ts`) distinguishes `tableName` (the cell's own private
  scratch table) from `substrateTableName` (the shared observed-state store, when
  granted).

**Invariants & edge cases.**

- `serviceClient` is captured at context construction **with the request's
  identity** — mutating `ctx.identity` in place would NOT reach downstream
  services. Use `withIdentity` to rebuild (see §2).
- The **bus-event** context is built with `identity { scopes: [] }` — a bus
  handler starts scopeless and trusts `meta.source` (`define-service.ts:321`).

**Reduces to:** **Cell.** `ctx` is the bounded ambient-authority surface of a
Cell's handler — logger/events/serviceClient/config/identity are precisely the
platform seams a cell is allowed to touch. `serviceClient` is pre-bound to the
request identity so any Fact operation a handler performs downstream inherits the
caller's scope. Not a separate primitive; it is the shape of "what a cell handler
can do."

**Connections.** Depends on `logger`, `events`, `service-client`, `config`. Every
cell command in the live catalog executes with exactly this surface.

**Motivating ADR.** ADR-0008 *cell-axis*.

---

## 5. `defineMcpService` — MCP JSON-RPC tool server over `defineService`

**What it does.** `defineMcpService(def)` (`define-mcp-service.ts:225`) layers a
Streamable-HTTP MCP endpoint (default `POST /mcp`) on top of `defineService`,
speaking JSON-RPC 2.0 methods `initialize` / `ping` / `tools/list` / `tools/call` /
`resources/list` / `resources/read`. It:

- Auto-generates `tools/list` from declared `McpToolDefinition` entries (name,
  description, title, `inputSchema` default `{ type: 'object' }`, `outputSchema`,
  `annotations`, `_meta.ui` binding) (`define-mcp-service.ts:285`).
- Registers each **static** tool ALSO as a directly-invocable command
  (`define-mcp-service.ts:401`), so peers can call it over Mode 1.
- Enforces auth at the HTTP layer per the MCP authorization spec
  (`endpoint`, `define-mcp-service.ts:352`): `requireAuth` (default `true`) with
  no valid bearer ⇒ `401 + WWW-Authenticate: Bearer resource_metadata=…` (the RFC
  9728 PRM URL inserts `/.well-known/oauth-protected-resource` before the resource
  path, `unauthorized`, `define-mcp-service.ts:183`); a **degraded** identity ⇒
  `503 auth_unavailable` + `retry-after` (`define-mcp-service.ts:359`).
- Scope-filters tools: advertised only if `entitled` (no scope or `hasScope`,
  `define-mcp-service.ts:237`), and enforced via `requireScope` at call time —
  authorization failures surface as `isError` tool results, not transport errors
  (`define-mcp-service.ts:311`, `:321`).
- Applies **credentialless** CORS reflecting only origins under
  `MCP_CORS_ORIGIN_SUFFIX` (e.g. `.on.parc.land`) for host-isolated cells
  (`corsHeaders`, `define-mcp-service.ts:334`).

This is the shape every one of the 17 live cells presents at the apex `/mcp`.

**Public API.**

```ts
function defineMcpService(def: McpServiceDefinition): /* defineService handler */;

interface McpServiceDefinition {
  name: string; version?: string; mcpPath?: string;          // mcpPath default '/mcp'
  capabilities?: Record<string, unknown>;
  resources?: {
    read: (uri: string, ctx: ServiceContext) => Promise<McpResourceContents | null> | McpResourceContents | null;
    list?: (ctx: ServiceContext) => Promise<McpResourceDescriptor[]> | McpResourceDescriptor[];
  };
  serverInfo?: { name: string; version: string; title?: string };
  instructions?: string;
  requireAuth?: boolean;                                     // default true
  tools: Record<string, McpToolDefinition>;
  resolveTools?: (ctx: ServiceContext) => Promise<Record<string, McpToolDefinition>>;
  http?: HttpRoute[];
  commands?: Record<string, RegisteredCommand>;
  events?: { emits?: string[] };
}

interface McpToolDefinition<Input = never, Output = unknown> {
  description: string; title?: string;
  inputSchema?: Record<string, unknown>;                     // default { type: 'object' }
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;                     // readOnlyHint / destructiveHint / …
  scope?: string;                                            // enforced via requireScope
  handler: (input: Input, ctx: ServiceContext) => Promise<Output> | Output;
  ui?: { resourceUri: string; visibility?: string[] };       // MCP-Apps binding (§8)
}

const PROTOCOL_VERSION = '2025-06-18';                       // define-mcp-service.ts:27
```

**Data model / wire shapes (JSON-RPC 2.0 over POST).**

- `initialize` → `{ protocolVersion; capabilities: { tools: {}, resources?:
  { listChanged: false }, ...def.capabilities }; serverInfo; instructions? }`
  (`define-mcp-service.ts:252`). The client may pin `protocolVersion`; otherwise
  the server default is echoed.
- `tools/list` entries carry `name` / `title` / `description` / `inputSchema` /
  `outputSchema` / `annotations` / `_meta.ui`.
- Notifications (no `id`) → no body (`202` ack, `define-mcp-service.ts:396`).
- Batch arrays supported; notification responses are dropped
  (`define-mcp-service.ts:385`).
- Every RPC reply carries `cache-control: no-store` (`NO_STORE`,
  `define-mcp-service.ts:168`).
- Parse failures → JSON-RPC `-32700`; unknown method → `-32601`.

**Invariants & edge cases.**

- `requireAuth` default `true` ⇒ unauthenticated (non-degraded) ⇒ `401 +
  WWW-Authenticate` PRM; degraded ⇒ `503 auth_unavailable`.
- A tool is advertised only if the caller is entitled (scope filter) and enforced
  with `requireScope` at call — so `tools/list` is a **capability projection over
  the caller's scopes.**
- The `resources` capability is declared ONLY when `resources.read` is provided,
  and never advertises `subscribe` (no SSE under CloudFront, ADR-0034).
- Every **static** tool doubles as a command; **dynamic** (`resolveTools`) tools
  are per-request and are NOT registered as commands.
- CORS reflects only `https` origins ending in `MCP_CORS_ORIGIN_SUFFIX`; unset ⇒
  no CORS. Credentialless (bearer header, never cookie) → no CSRF surface.

**Reduces to:** **Cell · Edge-http.** It is a preset of `defineService` (it
literally `return defineService({...})`, `define-mcp-service.ts:406`) that fixes
the HTTP face to be MCP-shaped — the standard external face of a Cell. It reduces
to **Edge-http** in that its `401 + WWW-Authenticate` is the payload the edge
`WWW-Authenticate`-restoration transform carries back to the viewer, and its
no-SSE-under-CloudFront constraint is dictated by the edge realisation. The
tool-list/call machinery is MCP-protocol glue, not a new platform primitive.

**Connections.** Depends on `defineService`, `auth` (`requireScope` / `hasScope`),
and `types`.

**Motivating ADRs.** ADR-0034 *mcp-apps*; ADR-0033 *progressive-disclosure*;
ADR-0008 *cell-axis*.

---

## 6. `resolveTools` — per-request dynamic tool aggregation (MCP gateway)

**What it does.** `resolveTools(ctx)` (a hook on `McpServiceDefinition`,
`define-mcp-service.ts:152`) lets a cell act as an MCP **gateway**. It is called
once per `tools/list` AND once per `tools/call` (`allTools`,
`define-mcp-service.ts:231`) to produce a `Record` of tools merged OVER the static
`tools`, resolved with the caller's identity (e.g. only the cells they own or were
granted). Merged tools are subject to the same scope filtering (`entitled`) and
enforcement (`requireScope`) as static ones. This is how the apex `/mcp` presents
`workspace` + `cells` + `auth` core tools alongside a caller's tier-2 `@c15r/*`
cell tools as one federated surface (`cells.call` is the "invoke a dynamic cell you
own or were granted, over this same connection" verb).

**Public API.**

```ts
resolveTools?: (ctx: ServiceContext) => Promise<Record<string, McpToolDefinition>>;

// internal composition:
allTools(ctx) = { ...def.tools, ...(await def.resolveTools?.(ctx)) };   // :231
entitled(tool, ctx) = !tool.scope || hasScope(ctx.identity, tool.scope); // :237
```

**Data model.** No persistent shape — dynamic tools are computed per request from
`ctx.identity` (typically by listing the caller's owned/granted cells and
reflecting their tool manifests).

**Invariants & edge cases.**

- Called once per `tools/list` **and** once per `tools/call` — a tool must resolve
  consistently across the two, or a listed tool will fail at call.
- Dynamic tools get identical scope filtering/enforcement as static; they are NOT
  registered as directly-invocable commands.

**Reduces to:** **Cell · Projection.** It composes other cells' tool surfaces
through the gateway cell, honouring per-caller grants (the Cell axis's grant gate).
It also reduces to **Projection** in spirit: the `entitled()` filter over the
caller's identity is a projection-preset gate ("select tools where caller holds
scope") — the same grant-gate-as-projection-preset shape the core uses over the
grant index. It introduces no storage of its own.

**Connections.** Depends on `defineMcpService`, `auth` (`hasScope`), and the
`cells` cell (for real gateway aggregation).

**Motivating ADRs.** ADR-0034 *mcp-apps*; ADR-0008 *cell-axis*.

---

## 7. `mcpResult` / rich tool-result channel split (text-vs-data)

**What it does.** `mcpResult(data, { text? })` (`define-mcp-service.ts:99`) tags a
`McpToolResult` (`{ __mcp: 'tool-result', data, text? }`). `toContent(value)`
(`define-mcp-service.ts:202`) then renders it into the MCP call reply as
`content: [{ type: 'text', text }]` plus `structuredContent` (the object `data` a
client or MCP-Apps widget consumes directly). A plain returned value still works —
a non-array object becomes both the text block (JSON) and `structuredContent`;
arrays/scalars stay text-only (`structuredContent` must be a JSON object). This is
the same succinct-text-vs-full-data split ADR-0033 made for `recall`, generalised
to every tool: a cell returns a terse summary to the model and the full payload to
the widget in one call.

**Public API.**

```ts
function mcpResult(data: unknown, opts?: { text?: string }): McpToolResult;

interface McpToolResult {
  readonly __mcp: 'tool-result';
  data: unknown;      // → structuredContent, and (unless text set) the text block
  text?: string;      // model-facing override; defaults to JSON.stringify(data, null, 2)
}

// internal:
function toContent(value): { content; structuredContent?; _meta?; isError? };
```

**Data model / wire shapes.** Reply:
`{ content: [{ type: 'text', text }], structuredContent?: object, _meta?, isError? }`.
`text` defaults to `JSON.stringify(data, null, 2)`; `structuredContent` is set only
when `data` is a non-array object.

**Invariants & edge cases.**

- `structuredContent` is emitted only for **non-array objects** (the spec requires
  a JSON object) — an array or scalar result stays text-only.
- A rich result's `text` overrides the default JSON; the widget binding lives on
  the tool **definition** (`ui`), not on the result.
- A thrown tool error is wrapped as `{ ...toContent(message), isError: true }` —
  a tool error, not a transport error (`define-mcp-service.ts:321`).

**Reduces to:** **Cell · Projection.** It is part of the MCP HTTP face's result
shaping (Cell). It echoes the projection pipeline's **PRESENT** stage — text-vs-data
is a present-stage concern (what the model sees vs what the client renders), the
same shaping the core applies in `select → score → shape → present`. It is a
formatting primitive local to the MCP layer, not new storage.

**Connections.** Local to `define-mcp-service.ts`.

**Motivating ADRs.** ADR-0033 *progressive-disclosure*; ADR-0034 *mcp-apps*.

---

## 8. MCP resources & MCP-Apps widget binding

**What it does.** Two related surfaces (both ADR-0034):

1. **Resource serving.** `McpServiceDefinition.resources.read(uri, ctx)`
   resolves a URI (e.g. a `ui://` MCP-Apps widget) to `McpResourceContents`;
   optional `resources.list(ctx)` enumerates descriptors. Providing `read` makes
   the server declare the `resources` capability and answer `resources/read` — a
   missing `uri` → `-32602`, an unfound URI → `-32602`
   (`define-mcp-service.ts:273`). Without a `read` handler, `resources/read` →
   `-32601` (`define-mcp-service.ts:274`).
2. **Tool → widget binding.** `McpToolDefinition.ui { resourceUri; visibility? }`
   binds a STATIC `ui://` resource to a tool: it surfaces in `tools/list` as
   `_meta.ui.resourceUri` (default `visibility ['model','app']`,
   `define-mcp-service.ts:301`); the host preloads and renders it, and the call's
   `structuredContent` reaches the widget via the host's
   `ui/notifications/tool-result` channel.

This is how `canvas.scene` (an assembled board scene for a federated `ui://`
renderer/embed) and `canvas`'s `backs: [embed, open, render]` affordances are
realised.

**Public API.**

```ts
resources?: {
  read: (uri: string, ctx: ServiceContext) => Promise<McpResourceContents | null> | McpResourceContents | null;
  list?: (ctx: ServiceContext) => Promise<McpResourceDescriptor[]> | McpResourceDescriptor[];
};

interface McpResourceContents {
  uri: string; mimeType?: string;
  text?: string;    // HTML for a ui:// widget
  blob?: string;    // base64 for binary
  _meta?: Record<string, unknown>;   // e.g. { ui: { csp: { resourceDomains: [...] } } }
}

interface McpResourceDescriptor { uri: string; name?; title?; mimeType?; description?; }

// on a tool:
ui?: { resourceUri: string; visibility?: string[] };
```

**Data model / wire shapes.** `resources/read` reply:
`{ contents: [{ uri; mimeType?; text?; blob?; _meta? }] }`
(`define-mcp-service.ts:279`). `tools/list` `_meta.ui = { resourceUri; visibility }`.

**Invariants & edge cases.**

- `resources` capability is declared only when `resources.read` is present; never
  advertises `subscribe` (no SSE under CloudFront).
- The widget binding is static on the tool def (advertised in `tools/list`); the
  call result carries only `content` + `structuredContent`.
- CSP / `resourceDomains` ride in `_meta.ui.csp` — an edge-http (CloudFront)
  constraint.

**Reduces to:** **Cell · Edge-http.** Resource serving and the tool→widget binding
are extensions of the Cell's MCP HTTP face. The CSP / `resourceDomains` constraint
and the no-`subscribe` rule are dictated by the CloudFront edge realisation. The
`ui://` federation is the client-side face of the Cell axis's origin-isolation, not
a new core.

**Connections.** Local to `define-mcp-service.ts`.

**Motivating ADR.** ADR-0034 *mcp-apps*.

---

## 9. `createCellReader` — cell-SSR read pipeline bound to the cell's own slice

**What it does.** `createCellReader(store, scope, defaults?)` (`cell-reader.ts:102`)
is the canonical way a cell reads the shared substrate from its OWN Lambda (SSR, an
organ, a scheduled job) WITHOUT a gateway round-trip. It binds
`createObservedState(store)` to one scope and `typeRules`, exposing the SAME
`select → score → shape` / reference-derivation / membership / salience pipeline
the workspace handler runs. Cells stop hand-rolling raw
`STATE#<owner>` / `KEY#` / `gsi-*` queries (the six-fold duplication ADR-0042
catalogued across lit/canvas/starter SSR + machine/models/run bindings).

It is **store-injected** (pure, unit-testable against the memory store; the cell
supplies whichever DDB client its runtime bundles) and **read-only by
construction**: it surfaces `peek` (raw single fact), `list` (cheap prefix-scoped
unranked live records), `query` (salience-ranked projection), `byType`,
`neighbors`, `members`, `graph` — but deliberately NOT the attention-recording
`get`/`read` (recording a write from an SSR read path would need write IAM and
would inflate salience on every page view).

`typeRules` is OPTIONAL: with it, key-encoded / structural / embedded edges (a doc's
`_doc/<doc>/<block>` decoration → `inDoc` membership) resolve; without it the reader
still returns real salience-scored facts + authored edges (strictly better than raw
DDB) but extensional membership resolves empty.

**Public API.**

```ts
function createCellReader(
  store: StateStore,
  scope: string,                 // the cell owner's partition — process.env.CELL_OWNER
  defaults?: CellReaderDefaults,
): CellReader;

interface CellReaderDefaults {
  typeRules?: Record<string, TypeRules>;   // enables key-encoded/structural/embedded edges
  salience?: SalienceOptions;              // instance base policy
}

interface CellReader {
  peek(key: string): Promise<StateRecord | null>;
  list(prefix?: string): Promise<StateRecord[]>;          // cheap, raw, unranked
  query(opts?: QueryOptions): Promise<QueryResult>;       // salience-ranked (heavy)
  byType(type: string, opts?: QueryOptions): Promise<QueryResult>;
  neighbors(key: string, opts?: NeighborsOptions): Promise<NeighborsResult>;
  members(key: string): Promise<MembersResult>;
  graph(): Promise<{ edges: AnnotatedEdge[] }>;
  readonly state: ObservedState;
  readonly scope: string;
}
```

Typical SSR usage (from `cell-sdk.ts` header):

```ts
import { createCellReader, createDynamoStateStore } from '@parc/runtime/cell';
const read = createCellReader(createDynamoStateStore(TABLE), OWNER, { typeRules });
const doc = await read.peek('doc:welcome');
const { members } = await read.members('doc:welcome');
```

**Data model / wire shapes.** Reads substrate rows `pk = STATE#<owner>`,
`sk = KEY#<key>` (`{value, _meta}`). `list` uses `begins_with KEY#<prefix>`
(namespace-scoped, pushed to the store's partition query, `cell-reader.ts:117`) and
filters `r.superseded` and dead timers via `isTimerLive` (`cell-reader.ts:118`).
`query` computes salience over the WHOLE slice (trajectory + all edges) — heavier
than `list`. `members` needs `typeRules` for key-encoded membership (doc blocks
ordered by decoration `seq`). Every ranked method passes
`opts?.typeRules ?? typeRules` so a per-call override beats the bound default
(`cell-reader.ts:120`–`124`).

**Invariants & edge cases.**

- **Read-only by construction** — `get`/`read` (attention-recording) are NOT
  exposed; safe under a `dynamodb:LeadingKeys` read-only role.
- `list` filters superseded + dead timers; prefix is pushed to the store partition
  query so a small namespace never scans the whole slice. Prefer `list` over
  `query` on a large slice — `query` scanning the whole trajectory + every edge can
  **time out an SSR Lambda** (and even a prefix-less whole-slice `list` can — pass a
  prefix).
- Without `typeRules`, key-encoded / structural / embedded edges + membership
  resolve **empty** (authored edges are still returned).
- `opts.typeRules` on a call overrides the bound default.

**Reduces to:** **Projection · Fact · Cell.** It is a thin bind of the SAME
`createObservedState` pipeline (`select → score → shape`) to a fixed scope —
`query`/`byType`/`neighbors`/`members`/`graph` are direct pass-throughs to
`state.query`/`neighbors`/`members`/`graph`. It reduces to **Fact** in that
`peek`/`list` read the `{value, _meta}` rows at `(scope, key)` directly. It reduces
to **Cell** in that the binding target is `process.env.CELL_OWNER` — the cell's
IAM-scoped partition — so the reader IS the Cell axis's bounded `ssrReads` seam made
ergonomic. It is NOT a new resolver; it is the projection pipeline with the
attention-writing methods amputated for read-only IAM safety.

**Connections.** Depends on `state` (`createObservedState`, `isTimerLive`), a
`StateStore` (`dynamo-state-store-v3` or memory), and `buildTypeVocabulary` (to
assemble `typeRules`). Used by `home` / `home-next` / `machine` SSR
(the `ssrReads` declarants).

**Motivating ADRs.** ADR-0042 *govern-cell-core-seam*; ADR-0044 (store
consolidation); ADR-0017 *cell-substrate-access*; ADR-0069.

---

## 10. `@parc/runtime/cell` — the lean cell-safe SDK bundle boundary

**What it does.** `cell-sdk.ts` is a curated entry (`@parc/runtime/cell`) that
re-exports ONLY the pure pipeline modules + the v3 DynamoDB store, deliberately
excluding the v2 `aws-sdk` store and the heavy vector machinery the
`platform/runtime` barrel carries — so a forge-deployed cell's bundle stays lean
and Node-20-correct (v2 `aws-sdk` isn't ambient on the cell runtime; vectors are
heavy). It exports `createCellReader` (the one entry a cell SSR usually needs),
`createDynamoStateStore` (= v3, under the plain name), the pipeline primitives
(`createObservedState`, `computeScore`, `deriveBackboneEdges`, `extractTypeRules`,
`resolvePresent` / `resolveLabel`, `resolveType` / `mergeTypeDecl` /
`parseTypeSchema`, `buildTypeVocabulary`, `matchesSelector`, `layer`), and the
render types. The forge bundler (`services/cells/transpile.ts`) resolves this module
from disk as a server-bundled package.

**Public API (module surface).**

```ts
export { createCellReader } from './cell-reader';
export type { CellReader, CellReaderDefaults } from './cell-reader';
export { createDynamoStateStoreV3 as createDynamoStateStore } from './dynamo-state-store-v3';
export {
  createObservedState, createMemoryStateStore, computeScore,
  deriveBackboneEdges, extractTypeRules,
} from './state';
export { resolvePresent, resolveLabel } from './present';
export { resolveType, mergeTypeDecl, parseTypeSchema, missingRequired, schemaHints } from './type-schema';
export { buildTypeVocabulary } from './type-vocabulary';
export { matchesSelector } from './selector';
export { layer } from './resolution';
// + render/state/type types (ObservedState, StateStore, TypeRules, Affordance, Type, …)
```

**Data model.** N/A — a module surface. The v2 store is "deliberately unreachable
from here" (ADR-0044 Inc 1 deleted it; v3 is the one DynamoDB `StateStore`).

**Invariants & edge cases.**

- **Never** re-exports the v2 store or vectors (would break the Node-20 cell
  bundle).
- `createDynamoStateStore` resolves `@aws-sdk/*` from the runtime lazily, keeping
  import time SDK-free.

**Reduces to:** **Cell.** It is a packaging / bundle-boundary decision specific to
the Cell axis's Lambda runtime (lean, v3-only, vector-free) — the delivery vehicle
for every other capability here. It re-exports, it does not implement; the
reductions of what it exports are documented under `createCellReader` (§9) and the
projection/present/type-schema cores it forwards.

**Connections.** Depends on `cell-reader`, `state`, `present`, `type-schema`,
`type-vocabulary`, `selector`, `resolution`, `dynamo-state-store-v3`. Consumed by
`services/cells/transpile.ts` (the forge bundler).

**Motivating ADRs.** ADR-0042 *govern-cell-core-seam* (delivery option (a));
ADR-0044 (store consolidation).

> Note: `index.ts` (the `platform/runtime` barrel) exports the SAME reader/store
> (`index.ts:84`, `:89`) but ALSO the v2-adjacent vector machinery — the barrel is
> for the platform's own services (workspace, vector-indexer); `@parc/runtime/cell`
> is the lean surface for forge-deployed cells.

---

## 11. Structured logger — correlation/trace-bound single-line JSON logging

**What it does.** `createLogger(context)` (`logger.ts:42`) emits single-line JSON to
stdout in a fixed shape (`service`, `level`, `message`, `time`, plus
`correlationId`/`traceId`/`requestId` + arbitrary fields) so every cell produces
uniform, CloudWatch-queryable logs without a logging framework. It is
level-thresholded via the `LOG_LEVEL` env (`debug < info < warn < error`, default
`info`, `logger.ts:37`). `child(context)` returns a logger with additional bound
context. `defineService` binds one per request with `service` / `correlationId` /
`traceId` (`define-service.ts:263`); handlers log via `ctx.logger`.

**Public API.**

```ts
function createLogger(context: LogContext): Logger;

interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  child(context: Partial<LogContext>): Logger;
}

interface LogContext { service: string; requestId?: string; traceId?: string; correlationId?: string; }
interface LogRecord extends LogContext { level: LogLevel; message: string; time: string; [k: string]: unknown; }
```

**Data model / wire shapes (stdout).**
`{ service, correlationId?, traceId?, requestId?, level, message, time: ISO8601, ...fields }\n`.
`LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }`.

**Invariants & edge cases.**

- A line below the configured threshold is dropped (no emit, `logger.ts:46`).
- Correlation/trace are bound once per request and threaded through every line.

**Reduces to:** **Cell.** A bound platform capability inside `ServiceContext` —
part of a cell handler's ambient surface. It is genuinely a small standalone utility
(no dependency on Fact/projection/edge cores) but exists only to serve the Cell
runtime's observability, so it compounds on **Cell**.

**Connections.** No dependencies; consumed by `define-service.ts`.

**Motivating ADR.** ADR-0008 *cell-axis*.

---

## Gotchas / non-obvious behavior

- **`CellReader.graph()` is ahead of the deployed gateway.** `graph()` (and by the
  same path `neighbors()` / `members()`) binds to `state.graph()`, but the deployed
  gateway's `workspace.graph` errors "Unhandled" and is marked deprecated, while the
  unified `workspace.edges` (Reference projection) is what works. The reader's
  `graph()` surface is drifting from the deployed edge verb — prefer `neighbors` /
  the edges projection for parity, and verify `state.graph` behaviour before relying
  on the reader's `graph()`.
- **`query` can time out an SSR Lambda.** `query` / `byType` compute salience over
  the WHOLE slice (trajectory + every edge). On a large slice this blows the SSR
  budget. Use `list(prefix)` (cheap, partition-scoped, unranked) unless you actually
  need the ranking — and always pass a prefix even to `list` on a big slice.
- **No `typeRules` ⇒ empty membership.** `members()` and derived
  (key-encoded/structural/embedded) edges resolve **empty** without bound
  `typeRules`. Authored edges and salience-scored facts still return, so a reader
  with no `typeRules` is silently *partial*, not broken — a subtle correctness trap
  for doc-block / collection membership.
- **`peek`/`list` are RAW.** `peek` returns the stored record with no salience and
  no attention write; `list` is unranked. Neither records attention — that is by
  design (SSR read-only IAM), but it means a page render never bumps salience.
- **Mutating `ctx.identity` in place does nothing downstream.** The `serviceClient`
  captures identity at context construction. To propagate a patched identity (e.g.
  the ADR-0086 `participant` key), you MUST call `withIdentity(ctx, patch)`, which
  rebuilds the client.
- **Empty scope set propagates as *absent*, not `[]`.** `buildContext` /
  `withIdentity` guard scopes with `.length ? … : undefined` — a caller with zero
  effective scopes propagates *no* `scopes` field, not an empty array. Downstream
  code distinguishing "no scopes claimed" from "empty scopes" should key off
  presence.
- **Bus handlers start scopeless and trust `source`.** An EventBridge branch builds
  `identity { scopes: [] }`. Never condition a bus handler's authority on
  `ctx.identity`; trust the IAM-attested `meta.source` only. Also: a thrown error in
  the bus branch **propagates** (to trigger Lambda async-retry), unlike HTTP/direct
  which catch and shape.
- **`x-auth-*` headers are never trusted; `x-forwarded-authorization` is the real
  bearer.** CloudFront OAC overwrites `Authorization` with its SigV4 signature, so
  the runtime reads the viewer bearer from `x-forwarded-authorization`. Do not add
  code that trusts client `x-auth-*` headers on the HTTP path.
- **Cookie auth is razor-scoped.** The `parc_session` cookie is honoured ONLY on
  `serviceName === 'dispatch'` + `GET`/`HEAD` + `Sec-Fetch-Dest: document`. A
  cell's `fetch()` (`empty`) or `<iframe>` (`iframe`) is never honoured, and a
  cookie never authorizes a mutation. The gateway `/mcp` stays bearer-only.
- **Degraded ≠ invalid.** When the auth cell errors, identity resolves
  `degraded: true` (anonymous) and seams must answer retryable `503
  auth_unavailable`, NOT `401 invalid_token` — a `401` makes clients discard a
  credential that was never actually checked.
- **`participant` carries provenance, never authority.** ADR-0086's `participant`
  key is propagated on the envelope for provenance stamps only. No filter, grant, or
  guard may condition on it; real delegation uses child tokens (ADR-0024).
- **Static tools are commands; dynamic tools are not.** Every `def.tools` entry is
  ALSO registered as a directly-invocable Mode-1 command. `resolveTools` (gateway)
  tools are per-request and are NOT registered — a peer cannot Mode-1 invoke a
  dynamic tool by name.
- **`tools/list` is a per-caller projection.** The advertised tool set is filtered
  by `entitled` over the caller's scopes AND enforced by `requireScope` at call. A
  tool the caller can't use simply isn't listed — do not treat the list as a static
  catalog.
- **`structuredContent` only for non-array objects.** A tool returning an array or
  scalar yields text-only content; only a non-array object populates
  `structuredContent` (spec requires a JSON object). Wrap list payloads in an object
  if a widget needs `structuredContent`.
- **`resolveTools` runs twice per call cycle.** Once for `tools/list`, once for
  `tools/call`. A tool must resolve consistently across both, or a listed tool will
  404 (`-32602 Unknown tool`) at call time.
- **The AWS SDK is lazy everywhere it matters.** `service-client.ts` (`getClient`)
  and the v3 store require `aws-sdk` / `@aws-sdk/*` lazily. Importing these modules
  at cell cold-start does not force the SDK to load — keep it that way, and use
  `__setLambda` for tests.
- **`@parc/runtime/cell` vs the barrel.** Cells must import from
  `@parc/runtime/cell` (`cell-sdk.ts`), NOT the `platform/runtime` barrel — the
  barrel pulls in vectors and would bloat/break the Node-20 cell bundle. The barrel
  is for the platform's own services.

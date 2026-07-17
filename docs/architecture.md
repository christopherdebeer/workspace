# parc.land Substrate Architecture

## 1. Vision & Tenets

The parc.land substrate is a serverless multi-project platform that treats **shared observed state as the spine** and treats **every authoring artifact — documents, boards, plugins, executable code, even Lambda source — as a first-class fact** in that same store. The design's animating commitment is *no graduation*: the environment a user thinks in is the environment they build in, and the environment an agent operates in is the same environment a human edits.

Three cross-cutting tenets thread the codebase:

- **Reference, not copy.** A cell, a placement, a renderer plug-in, a transpiled output, a declared action — every artifact is `{value, _meta}` in an owner's slice; authoring tools place existing facts via decorations (`_doc/<id>/<key>`, `_canvas/<board>/<key>`) rather than embedding copies. The shared `@c15r/kernel` module at `cells/kernel/client/main.ts` is the same lesson at the runtime layer: cells import the kernel by URL rather than vendoring auth/MCP logic.
- **Authority is enforced by infrastructure, not by interpreter.** Per-cell IAM roles carry `dynamodb:LeadingKeys` conditions on `STATE#<owner>` (`services/cells/cell-template.ts`), the cell permission boundary at `platform/infra/dynamic-cell-control-plane.ts` caps every dynamic cell to its own resources, and the auth cell mints scopes that are a *ceiling, never a floor* (`services/auth/oauth.ts` `cellCeiling`).
- **Surface↔MCP duality.** Every capability is reachable through one stable three-tool MCP surface (`whoami` / `read` / `act` at `services/gateway/service.ts`), where new vocabulary appears in `target` arguments rather than new tool names — so a UI control and an agent invocation share one wire and one identity. Service authors never import the AWS SDK directly; they write against `defineService` / `defineMcpService` in `platform/runtime/`.

The Brazil/CDK build, the per-cell origin isolation, and the substrate's supersede-not-delete discipline all serve those three tenets.

### 1.x AWS SDK access — capability-only, with a v2/v3 platform/userland split

A platform-wide tenet: **service and cell authors NEVER import an AWS SDK directly.** Reach AWS through the runtime context (`ctx.events`, `ctx.serviceClient`, `ctx.config`, `ctx.identity`, `ctx.logger`) and the substrate primitives (`createObservedState`, the `StateStore` contract). The runtime is the capability boundary; bypassing it bypasses identity propagation, scope ceilings, correlation IDs, and the test injection seams. (See `platform/CLAUDE.md:25-29`, `platform/runtime/index.ts:4-6`, `services/CLAUDE.md`.)

#### Capabilities the runtime exposes

| Capability | Provider | File |
|---|---|---|
| `events.emit(detailType, detail)` (Mode 2) | `createEvents` | `platform/runtime/events.ts` |
| `serviceClient(name).command(name, payload)` (Mode 1) | `createServiceClient` | `platform/runtime/service-client.ts` |
| `logger`, `config`, `identity`, `correlationId`, `traceId` | `defineService` | `platform/runtime/types.ts:15-24` |
| `StateStore` (substrate persistence) | `createObservedState` over an injected store | `platform/runtime/state.ts`, `platform/runtime/dynamo-state-store.ts` |

A third communication mode (SQS queues) is wired per-service in infra, not exposed through `ctx`.

#### Lazy-init + injection seam (mandatory pattern for new platform/service modules)

Any platform or service module that must construct an SDK client follows the same three-part shape:

```ts
import type { Lambda } from 'aws-sdk';

let client: Lambda | undefined;
export function __setLambda(stub: Lambda | undefined): void { client = stub; }
function getClient(): Lambda {
  if (!client) {
    const AWS = require('aws-sdk') as typeof import('aws-sdk');
    client = new AWS.Lambda();
  }
  return client;
}
```

- `import type` only at the top — never a value-import — so the SDK is not pulled in at module load.
- A module-level singleton + `getClient()` on first use — keeps cold-start cheap for handlers that don't hit AWS on every path.
- An exported `__setX` injector — unit tests substitute the singleton without touching `require`.

Modules following this pattern: `service-client.ts` (`__setLambda`), `events.ts` (`__setEventBridge`), `services/cells/provisioner.ts` (`__setCloudFormation`/`__setS3`/`__setLambda`/`__setCloudWatchLogs`), `services/cells/registry.ts` (`__setDocumentClient`). The injectors are re-exported from `platform/runtime/index.ts` for service tests.

**Exception** (factory-as-seam): `platform/runtime/dynamo-state-store.ts` and `services/auth/dynamo-store.ts` construct `new DynamoDB.DocumentClient()` eagerly inside their `createX(tableName)` factories. Tests don't call these factories — they substitute `createMemoryStateStore` / `memory-store.ts` instead — so the factory function itself is the injection seam. New code should prefer the explicit `__setX` shape; this exception exists only because the `import { DynamoDB } from 'aws-sdk'` value-import already loads the SDK, making lazy-`require` inside the factory cosmetic.

#### v2 vs v3: split is platform vs userland, not module-by-module

The substrate currently runs **two SDKs side-by-side**, on a clean axis:

- **Platform + first-class services (`platform/`, `services/`):** AWS SDK **v2** (`aws-sdk@^2.1692.0`). Bundled into each Lambda's zip by `HttpServiceCell` (`platform/infra/http-service-cell.ts:111-122`) — `runtime: NODEJS_20_X` no longer ships v2 in the image, so `bundling: { externalModules: [] }` forces every dep into the artifact. Used in: `service-client.ts`, `events.ts`, `dynamo-state-store.ts`, `provisioner.ts`, `registry.ts`, `services/auth/dynamo-store.ts`.
- **Userland cells (`/cells/*`):** AWS SDK **v3** (`@aws-sdk/client-*`). The cell transpiler (`services/cells/transpile.ts:222,280`) marks `@aws-sdk` as `external`, expecting it provided by the Lambda runtime. v3 is also typically constructed eagerly at module scope in cells (e.g. `cells/models/index.ts:26-31`) because cell handlers are tiny and the lazy-singleton ceremony adds no value at userland scale.

When in doubt — code lives under `platform/` or `services/` → v2 + lazy + `__setX`; code lives under `/cells/` → v3 + eager top-level construction is acceptable.

#### Open migration risks

1. **Node 20 dropped bundled SDK v2.** Every platform/service Lambda already pays the bundle-size cost (`http-service-cell.ts:120-122`). When the runtime moves to Node 22+, or AWS removes v2 from npm, the seven v2 import sites must migrate to `@aws-sdk/client-*` packages. The `__setX` seams insulate tests, but value-imports of `DynamoDB.DocumentClient.AttributeMap` and `AWSError` propagate types into call sites and need a v3 compatibility shim.
2. **Inconsistent injection seams.** `dynamo-state-store.ts` and `services/auth/dynamo-store.ts` rely on factory-as-seam while `services/cells/registry.ts` (an analogous case) exposes `__setDocumentClient`. The spec should pick one shape for new code and schedule retrofits.
3. **`@aws-sdk` external-by-default in cells** assumes the Lambda image continues to ship v3. If AWS narrows the bundled set, the transpiler's externalisation rule (`transpile.ts:280`) becomes a deploy-time hazard for userland cells; cells that name a `@aws-sdk/*` package must either move it into `imports.json` (esm.sh-bundled) or the cell loader must pin a v3 layer.

A new cell author MUST read this section before constructing any AWS client and SHOULD treat any direct `import … from 'aws-sdk'` or `import … from '@aws-sdk/...'` inside `platform/` or `services/` as a code-review red flag absent the lazy + `__setX` shape above.

## 2. System Topology

A single CloudFront distribution fronts the platform. The apex hosts the auth cell, the gateway (`/mcp`), the home SPA, and dispatch (`/@*`); a parallel cell-namespace distribution serves user-authored cells on `<owner>-<name>.on.parc.land` host-isolated origins. Every origin is a Lambda Function URL locked to the distribution by Origin Access Control with a Lambda@Edge body-signer (`platform/infra/service-router.ts`).

```mermaid
flowchart TB
  Browser["Browser / MCP client"]
  ApexCF["CloudFront — apex<br/>parc.land"]
  CellCF["CloudFront — cell-namespace<br/>*.on.parc.land"]
  EdgeSigner["Lambda@Edge<br/>OriginSignerRole<br/>+ WwwAuthEdge"]
  HostRewrite["CloudFront Function<br/>CellHostRewrite<br/>Host → /@owner/name"]
  ApexRedir["CloudFront Function<br/>CellApexRedirect<br/>nav → cell subdomain"]

  Auth["auth cell<br/>OAuth 2.1 + WebAuthn"]
  Gateway["gateway cell<br/>POST /mcp<br/>whoami | read | act"]
  Home["home cell<br/>SPA shell"]
  Dispatch["dispatch cell<br/>/@&lt;owner&gt;/&lt;name&gt;"]
  Workspace["workspace cell<br/>substrate vocabulary"]
  Cells["cells (forge)<br/>control plane<br/>NO public route"]

  Tier2["Tier-2 user cells<br/>cell-&lt;cellId&gt; Lambda<br/>own DDB + IAM-bounded role"]

  Bus["EventBridge<br/>platform-bus"]
  Substrate[("SubstrateTable<br/>STATE# / EDGE# / TRAJ# / SEQ# / GRANT#")]
  CodeBucket[("S3 CodeBucket<br/>cells/&lt;id&gt;/{src,build,data}")]

  Browser --> ApexCF
  Browser --> CellCF
  ApexCF -->|ALL_VIEWER except Host| EdgeSigner
  CellCF --> HostRewrite
  HostRewrite --> EdgeSigner
  ApexCF -->|/@owner/name nav| ApexRedir
  ApexRedir -.302.-> CellCF

  EdgeSigner --> Auth
  EdgeSigner --> Gateway
  EdgeSigner --> Home
  EdgeSigner --> Dispatch
  EdgeSigner --> Tier2

  Dispatch -->|cells.call<br/>x-cell-caller| Cells
  Cells -->|invoke<br/>cell-&lt;id&gt;| Tier2
  Gateway --> Workspace
  Gateway --> Cells
  Gateway --> Auth
  Workspace <--> Substrate
  Tier2 -->|read STATE#&lt;owner&gt;<br/>LeadingKeys| Substrate
  Tier2 -->|substrate.write.requested<br/>source=cell-&lt;id&gt;| Bus
  Bus --> Workspace
  Cells -->|create/update<br/>cell-* CFN stacks| Tier2
  Cells <--> CodeBucket
```

The flow is: a viewer request enters CloudFront with its bearer in `Authorization`; OAC overwrites that header with a SigV4 signature, so the edge function copies the bearer into `X-Forwarded-Authorization` (`platform/infra/service-router.ts` invariants). Function URLs are `AWS_IAM` by default — the only way to reach origin is through CloudFront. The cell-namespace distribution rewrites `<owner>-<name>.on.parc.land` to `/@<owner>/<name>` so dispatch can resolve and proxy via `cells.call`.

### 2.1.5 Type Vocabulary Resolution

`platform/ui/vocab.ts` is a *pure resolver runtime* — not just the manifest schema for `_types/<type>` facts. It is the one function every surface and agent shares to answer: "given this fact and an intent (`open` / `edit` / `create` / `render` / `embed` / `preview`), where does it go?" It is consumed at runtime by the home cell (`cells/home/client/app.tsx`) for routing fact lists, by the lit cell for embed/render, and is the migration target for the kernel client's pre-vocab `hrefOf` (`cells/kernel/client/main.ts:396-422`).

#### 2.1.5.1 Type-signal precedence

`typeSignals(fact)` (`platform/ui/vocab.ts:80-91`) emits signals most-specific first:

1. `_meta.type` paired with `match = deriveId(fact.key)` (the part after a `prefix:` or `prefix/` in the key, else the key itself).
2. The key prefix: `prefixOf(fact.key)` splits on the first `:` or `/` (whichever comes first); e.g. `doc:foo` yields `{type:"doc", match:"foo"}`, `inbox/x` yields `{type:"inbox", match:"x"}`.
3. Each `_meta.tags` entry's prefix in tag order; e.g. `canvas:slice` yields `{type:"canvas", match:"slice"}`.

`resolve(fact, intent, decls)` walks signals in this order and returns the first signal whose declaration produces a fully-templated handler. `declFor(fact, decls)` walks the same signals but ignores intent — it returns the governing `TypeDecl` for presentation (icon/label).

#### 2.1.5.2 `applyTemplate` placeholder semantics

`applyTemplate(tmpl, ctx)` (`platform/ui/vocab.ts:118-136`) substitutes:

| Placeholder       | Source              | Encoding                                |
|-------------------|---------------------|-----------------------------------------|
| `${id}`           | `deriveId(fact.key)`| `encodeURIComponent`                    |
| `${key}`          | `fact.key`          | `encodeURIComponent`                    |
| `${type}`         | the matched signal  | `encodeURIComponent`                    |
| `${match}`        | the matched signal  | `encodeURIComponent`                    |
| `${value.<path>}` | `pathInto(fact.value, path)` then `String(v)` | RAW (no encoding) — these are often full addresses |

If any placeholder substitutes empty (missing/null/empty-string), the function returns `null` and that handler is treated as inapplicable.

#### 2.1.5.3 Fall-through chain

`decl.handlers[intent]` may be a single handler or an ordered array (`asList`, `vocab.ts:138`). On a `null` from `applyTemplate`, `resolve` proceeds to the next handler in the array, then to the next type signal. This is how alternatives like `capture → [day-log-when-dated, input-cell-otherwise]` work without imperative branching:

```ts
capture: { handlers: { open: [
  { surface: '/@c15r/lit?doc=log:${value.captured}' }, // resolves only when value.captured is set
  { surface: '/@c15r/input' },                          // fallback
] } }
```

#### 2.1.5.4 `declFor` vs `resolve`

| Function   | Returns          | Used for                                                                       |
|------------|------------------|--------------------------------------------------------------------------------|
| `declFor`  | `TypeDecl \| null` | Presentation metadata (icon, label) where no intent is involved (`typeIcon`, `factTitle`) |
| `resolve`  | `TypeHandler \| null` | Intent routing (`open` / `edit` / `create` / `render` / `embed` / `preview`) — handler returned with templates already substituted |

#### 2.1.5.5 `cellRef` and origin-aware materialization

Handlers declare a *cell-relative* `path` (preferred form). The cell is implicit (`decl.manager`) unless the handler overrides with `cell: 'owner/name'` or `cell: '/name'` (inherits manager's owner). `resolve` parses that into `cellRef: {owner, name}` via `parseCellRef` (`vocab.ts:144-152`) and returns it alongside the templated `path`. The CONSUMER materializes the URL via the kernel client's `cellUrl(owner, name, rest)` (`cells/kernel/client/main.ts:113-119`):

- On a cell host (`<owner>-<name>.on.parc.land`), `cellUrl` emits a sibling subdomain URL (each cell stays on its own origin).
- On the apex, `cellUrl` emits the `/@owner/name${rest}` path.

This means **no apex URL is baked into a type declaration** — the same handler renders correctly on the apex, on a cell subdomain, and for any owner. Legacy handlers may instead carry `surface` (a full templated URL — e.g. value-derived `${value.address}`), `act` (an `act` target like `@c15r/lit.create`), `renderer` (a `_renderers/<type>` fact key), or `hint` (a built-in render kind such as `markdown`/`metric`); these are localized as-is by the consumer.

#### 2.1.5.6 Source-vendoring sync pipeline

`platform/ui/*` is delivered to cells **as build-time source**, not a runtime URL or shared bundle. `scripts/sync-platform-ui.mjs` copies the canonical sources into each consuming cell:

| Canonical source         | Targets                                                          |
|--------------------------|------------------------------------------------------------------|
| `platform/ui/index.tsx`  | `cells/starter/shared/ui.tsx`, `cells/home/shared/ui.tsx`        |
| `platform/ui/vocab.ts`   | `cells/home/shared/vocab.ts`                                     |

Each generated file is prepended with a fixed header:

```text
/* GENERATED — synced from <src> by scripts/sync-platform-ui.mjs.
 * Do NOT edit here; edit <src> and re-run the sync. Source-bundled so the
 * cell renders platform/ui isomorphically with its own React. */
```

Rationale: the kit must be **isomorphic** (server `renderToString` + client `hydrateRoot`) using the cell's *own* React, with no React peering. Vendoring source — rather than publishing a shared package or loading from a URL — is the robust delivery while forge lacks a library-build mode that can emit bare-external React. Workflow: edit `platform/ui/*`; run `node scripts/sync-platform-ui.mjs`; commit the regenerated cell copies alongside the canonical change.

#### 2.1.5.7 Why `vocab.ts` is synced to `home` but not `starter`

The sync map enumerates targets explicitly. `vocab.ts` is vendored only where the resolver is consumed at runtime: today, only `cells/home` calls `resolve`/`declFor` to route fact lists. `cells/starter` consumes only the React component kit (`index.tsx`); it does not route facts, so it has no need for the resolver. The kernel cell currently uses its own inline `decl.href`-template fallback in `hrefOf` and does not vendor `vocab.ts`. Open question: consolidate by either (a) syncing `vocab.ts` to every cell that hosts fact viewers and migrating kernel `hrefOf` to call `resolve`, or (b) keeping `vocab.ts` vendored only where it's actually used and accepting two coexisting routing surfaces.

#### 2.1.5.8 Per-user `_types/<type>` override merge in the gateway

The gateway's read-virtual `$types` target (`services/gateway/service.ts:291-318`, `buildTypes`) assembles the merged vocabulary as data:

1. **Canonical layer** — `cells.describeTypes` returns the global declarations published by managing cells at deploy time (the cell registry's view). Read in parallel; fails open to `{types:{}}` on error so anonymous callers still get a vocabulary.
2. **Per-user override layer** — when `ctx.identity.user` is set, `workspace.query({prefix:'_types/', limit:200})` returns the caller's `_types/<type>` facts. Anonymous callers skip this read entirely. Both reads fail open.
3. **Merge precedence (user wins)** — `types = {...canonical}; for (e of slice) types[e.key.slice('_types/'.length)] = e.value;`. The user's `_types/<type>` value REPLACES the canonical value at the same type key (no shallow-merge of fields).

End-to-end precedence chain consumed by home:

```
DEFAULT_TYPE_DECLS  (built-in bootstrap, services/home/client/type-decls.ts)
       ↓ overridden by
canonical / describeTypes  (cell-registry global handlers)
       ↓ overridden by
_types/<type>  (per-user facts)
```

`typeDeclsFrom` (`cells/home/client/app.tsx:932-935`) layers the merged `$types` map over `DEFAULT_TYPE_DECLS`, applying `normalizeDecl` to up-convert legacy `{icon, titlePath, href}` decls into the new `{icon, label, manager, handlers}` shape so old `_types/<type>` facts keep working through the migration.

#### 2.1.5.9 Type signatures (informative)

```ts
type Intent = 'open' | 'edit' | 'create' | 'render' | 'embed' | 'preview';

interface TypeHandler {
  path?: string;       // cell-relative, templated; preferred
  cell?: string;       // 'owner/name' or '/name' — overrides decl.manager
  surface?: string;    // full templated URL (legacy / value-derived)
  act?: string;        // declared act target (creates / custom verbs)
  renderer?: string;   // _renderers/<type> fact key
  hint?: string;       // built-in render kind ('markdown' / 'metric' / ...)
  cellRef?: { owner: string; name: string }; // populated by resolve()
}

interface TypeDecl {
  manager?: string;    // 'owner/name' — type lifecycle owner; default cell for path handlers
  icon?: string;
  label?: string;      // dot-path into fact.value for human label
  handlers?: Partial<Record<Intent, TypeHandler | TypeHandler[]>>;
}

function declFor(fact, decls): TypeDecl | null;
function resolve(fact, intent, decls): TypeHandler | null;  // path resolves to {cellRef, path}; surface resolves raw
function applyTemplate(tmpl, ctx): string | null;            // null on any empty placeholder → fall through
function typeSignals(fact): Array<{type, match}>;            // _meta.type > key-prefix > tag-prefixes
function deriveId(key): string;                              // suffix after first ':' or '/'
```

## 3. Core Platform

### 3.1 Runtime — `platform/runtime`

The runtime is the in-Lambda library every service cell imports. Its single entry, `defineService` (`platform/runtime/define-service.ts`), returns one Lambda handler that multiplexes three event shapes by inspection: EventBridge bus events (`detail-type` + `source` + `detail` and no `requestContext`), direct invokes carrying a `CommandEnvelope`, and Function URL HTTP. It auto-implements `GET /<svc>/_manifest`, `OPTIONS`, and `POST /<svc>/<command>`, plus raw HTTP routes registered by the cell.

`defineMcpService` (`platform/runtime/define-mcp-service.ts`) sugars over `defineService` to add a JSON-RPC 2.0 endpoint at `/mcp` speaking `initialize` / `ping` / `tools/list` / `tools/call`, scope-filtering tools the caller is entitled to, and emitting RFC 9728 `WWW-Authenticate` headers on 401.

The substrate primitive lives in `platform/runtime/state.ts` (~1095 lines): `ObservedState` over an injected `StateStore`, with `put` (CAS via `ifRevision`/`ifAbsent`), `get`/`read` (salience-shaped, `lens`/`elision`), `query`, `link`/`unlink`/`neighbors`/`edges`, `changes`, `attention`, `supersede`, plus the salience scoring (recency, velocity, attention, standing, centrality) at scale `[0,1]` with weights summing to ≤1. The DynamoDB-backed implementation is `platform/runtime/dynamo-state-store.ts`; an in-memory store backs tests.

The scope grammar — `workspace:<owner>:<keyPrefix|*>:<read|write>`, `cell:<owner>/<name>:<tool|*>`, `platform:<verb>` — is implemented in `platform/runtime/auth.ts` with `matchesScope`, `intersectScopes`, and `impliesScope` (the back-compat bridge between coarse `workspace:read` and granular `read:workspace`). `Identity` carries `{user, scopes, grantScopes?, tokenId?}`; `requireUser`/`requireScope` throw `ServiceAuthError` (mapped to 401 by the HTTP layer).

A load-bearing carve-out lives in `platform/runtime/define-service.ts`: the `parc_session` cookie is honoured **only** when `serviceName === 'dispatch'`, method ∈ {GET, HEAD}, AND `Sec-Fetch-Dest: document`. This is the path that lets a signed-in visitor's cell SSR without exposing the bearer to dynamic cells.

### 3.2 Infrastructure — `platform/infra`

`platform/infra` ships composable CDK constructs that turn a service definition into deployable AWS resources, plus the shared platform primitives. The directional dependency rule is strict: `infra/` may import `manifest.ts` but never `runtime/` (CLAUDE.md tenet).

- `HttpServiceCell` (`platform/infra/http-service-cell.ts`) bundles a `NodejsFunction` + Function URL + IAM + logs + optional DynamoDB into one cell unit; method `allow(target)` rewrites the registry env in place, monotonically extending peer access.
- `ServiceRouter` (`platform/infra/service-router.ts`) builds the apex CloudFront distribution and the optional cell-namespace distribution. Caching is `CACHING_DISABLED` on every behaviour. It ships two inline Lambda@Edge functions (in `us-east-1` only, code as JS string constants because they must co-locate with the distribution): an origin-request body signer adding `x-amz-content-sha256` (OAC SigV4 doesn't hash bodies), and an origin-response WWW-Authenticate un-remapper (Function URLs remap that header).
- `PlatformEventBus` (`platform/infra/event-bus.ts`) provides `routeTo(id, fn, detailTypes, sourcePrefix?)`. The `sourcePrefix` is the IAM-attested provenance check — `'cell-'` for dynamic-cell-emitted events, `'cells'` for forge itself.
- `SubstrateTable` (`platform/infra/substrate-table.ts`) is the shared blackboard table — `pk`/`sk` plus two GSIs (`gsi-in`, `gsi-type`) — promoted to stack-level infra peer of the event bus. Every GSI partition key repeats the scope so `dynamodb:LeadingKeys` covers index reads.
- `DynamicCellControlPlane` (`platform/infra/dynamic-cell-control-plane.ts`) emits the platform-wide cell `permissionBoundary` ManagedPolicy and the shared `CodeBucket` (S3, blocked-public, PUT-CORS only from `https://parc.land`); `grantControlPlane(forge)` is the pivot of the dynamic-cell trust model — the only call that grants `iam:CreateRole` (conditioned on the boundary), CFN, Lambda, and DynamoDB control-plane permissions in the `cell-*` namespace.

### 3.3 Stack Wiring — `lib/platform-stack.ts`

`lib/platform-stack.ts` is the wiring document for the whole serverless platform. It instantiates the substrate table and event bus, the `DynamicCellControlPlane`, the `ServiceRouter`, and seven `HttpServiceCell`s — `auth`, `workspace`, `home`, `gateway`, `cells` (forge — route-less), `dispatch`. Cell-to-cell IAM grants are explicit and least-privilege:

- `workspace.allow(auth)`, `workspace.allow(cells)` — workspace calls auth to validate tokens and forge to resolve cell owners.
- `gateway.allow(auth/cells/workspace)` — the MCP PEP needs all three providers.
- `dispatch.allow(auth/cells/workspace)` — to route, proxy SSR reads, and apply caller-writes.
- `cellHostRouter` is dispatch — so host-isolated cells rewrite onto `/@<owner>/<name>`.

A daily EventBridge cron at 06:30 UTC injects `workspace.tend.requested` into the workspace cell.

### 3.4 Service Cells (one subsection each)

#### auth — `services/auth`

The substrate's identity primitive: a self-contained OAuth 2.1 authorization server (RFC 9728 PRM, RFC 8414 ASM, RFC 7591 DCR, PKCE S256, RFC 8628 device grant, RFC 7009 revocation) plus a WebAuthn passkey IdP. Implemented across `services/auth/service.ts`, `services/auth/oauth.ts`, `services/auth/webauthn.ts`, `services/auth/store.ts`, `services/auth/dynamo-store.ts`, and the React consent SPA at `services/auth/client/main.tsx`. Tokens are persisted only as `sha256(token)` base64url; the raw token is shown once at mint. Refresh tokens live in their own row with independent (longer) TTL so refresh works after the access row TTL-deletes. The `validateToken` command is the substrate-internal bridge that `define-service.ts` calls to turn a bearer into `ctx.identity`.

A load-bearing isolation primitive is `cellCeiling` (`services/auth/oauth.ts`): when a redirect_uri is `<owner>-<name>.<CELL_DOMAIN_SUFFIX>`, the issued token's scope is capped to `['workspace:read','workspace:write','cell:<owner>/<name>:*']` — never `platform:*`, never another cell. Admin-prefixed scopes (`platform:`, `cells:create`) are filtered server-side at consent time against `AUTH_ADMIN_USERNAMES`.

#### cells (forge) — `services/cells`

Forge is the platform's reflexive control plane: a backend tool-provider with **no public route** (`routes: []` in `lib/platform-stack.ts`) that mints, edits, deploys, and invokes user-owned dynamic cells at runtime. Each cell becomes its own real Lambda + DynamoDB table + IAM-bounded role, provisioned via per-cell CloudFormation stacks named `cell-<cellId>` (`services/cells/cell-template.ts`). `cellId = slugify(name) + '-' + sha256(owner:slug).slice(0,8)` is deterministic and ARN-scopable.

The registry (`services/cells/registry.ts`) is the self-model: `pk = CELL#<cellId>` for profile rows, `pk = OWNER#<owner>` for the owner index. Source code lives at `cells/<cellId>/src/<path>` in the shared `CodeBucket`, built artifacts at `cells/<cellId>/build/<version>.zip`, per-caller data blobs at `cells/<cellId>/data/<user>/<key>`. Path safety is enforced in `services/cells/cell-files.ts` via `cleanPath` (rejects `..`/`.` and unsafe segments) — this is the keystone of forge-mediated isolation.

Heavy bundling work (esbuild-wasm with esm.sh dep resolution, server-bundled allowlist hard-coded to `react`/`react-dom`/`scheduler`) is moved off the synchronous request path: `cells.deploy` records `phase=DEPLOYING`, emits `cell.deploy.requested`, and returns immediately; `onDeployRequested` runs the bundle and writes terminal `DEPLOYED|FAILED`. This is designed around the ~30s edge timeout. See §11 for the platform-wide asynchrony model and §9.7 for the full deploy-pipeline operational semantics.

##### 3.4.x Reactions (subscriptions → declared actions)

A **subscription** is the substrate's reaction primitive: data, not code, that turns any fact write into a guarded invocation of a declared action. The reactor is generic; reactivity is something a slice opts into by registering vocabulary, not a behaviour the platform special-cases. This is what lets a tier-2 cell (e.g. `@c15r/machine`) be a reactive concept system without any platform change — the cell ships an action whose `if` guard reads its own state and a subscription tying that action to writes in its key namespace.

###### Subscription definition
A subscription is a fact at `_subscriptions/<id>` (reserved prefix `SUBSCRIPTIONS_PREFIX = '_subscriptions/'`, type `'subscription'`):

```
SubscriptionDefinition {
  id:        string                     // no '/' allowed
  match: {                              // AND of present clauses
    type?:      string                  // fact.type === match.type
    keyPrefix?: string                  // fact.key.startsWith(...)
    cel?:       string                  // CEL over { key, value, meta }, must eval true
  }                                     // ≥1 clause required; cel parsed at registration
  invoke:    string                     // declared action id (same slice)
  params?:   Record<string, string>     // templates (see below)
  maxDepth?: number                     // loop bound, default 50
  label?:    string
}
```

Param templates use the placeholders `${key}`, `${keySuffix}`, `${scope}`, `${value}`, `${value.<dotpath>}`. A template that is *exactly one* placeholder preserves the source's JSON type (raw value passthrough, `undefined → null`); mixed templates string-interpolate (non-strings JSON-stringified). `keySuffix` is the key with `match.keyPrefix` stripped, or the whole key if no `keyPrefix`.

###### Vocabulary
Three commands, gated by the same `write:workspace` / `read:workspace` verb scopes as the rest of the substrate:

- `registerSubscription({ subscription })` — validates the definition (id present, no `/`, ≥1 match clause, CEL parses) and writes it as a fact in the caller's slice.
- `subscriptions()` — list (prefix scan over `_subscriptions/`, recency-ranked, capped at 200).
- `deleteSubscription({ id })` — supersedes the fact; throws `not_found` if absent.

System keys (`_`-prefixed) are excluded from `recall` shaping and `attention` by the same convention the reactor honours.

###### The reactor (bounded fixpoint)
Every fact write emits `workspace.fact.written { scope, key, revision }`. The workspace service's reactor consumes this event and runs:

1. **System-key skip.** If `!scope || !key || key.startsWith('_')`, return. Vocabulary writes (subscriptions, actions, views, tending audit) never trigger reactions.
2. **List + load.** Read `_subscriptions/*` for the slice. Load the changed fact; skip if absent or superseded.
3. **Match.** Filter subscriptions by `match` (type / keyPrefix / CEL). CEL is *total* — any evaluation error is treated as `false`, so a malformed runtime value cannot crash the reactor.
4. **Depth cap.** For each hit, if `revision > (sub.maxDepth ?? 50)`, log and skip. The triggering fact's revision counts the chain length (a run fact's revision equals the number of transitions), so this is a generic loop bound on auto-advance chains.
5. **Invoke.** Resolve params from the event and call the declared action under the synthetic identity `{ user: 'platform/reaction', scopes: [] }`. The action's own `if`/`enabled` guards decide whether it actually fires; `precondition_failed` / `action_disabled` are the *expected* no-op (e.g. an auto-rail whose `from` ≠ the run's current node) and silently swallowed. Any other error is a real fault (logged, not propagated — the bus consumer must not crash).
6. **Re-emit.** For every write the action produced, emit a fresh `workspace.fact.written`. Downstream subscriptions chain off these, giving a bounded fixpoint: the chain converges when no rail's guard holds, or terminates at the depth cap.

Reactions invoke *declared actions only* — bounded, auditable, slice-local writes — so the entire loop stays in the declarative tier. There is no opaque callback surface; a subscription cannot run code.

###### Source attestation
Reactions only fire on first-party fact events. The EventBridge rule that delivers `workspace.fact.written` to the workspace function pins `source = 'workspace'`. Each dynamic cell's IAM policy pins `events:source = cell-<cellId>`, so a cell cannot forge a `workspace.fact.written`. Cell writes flow through the separate `substrate.write.requested` event (source `cell-*`, validated by the substrate-write handler), which after applying the fact emits a `workspace.fact.written` *as the workspace itself* — the single chokepoint where the reactor actually fires. The reactor handler does not need to re-check the source; the bus rule is the enforcement.

###### Two ways subscriptions are registered
- **User vocabulary.** A caller invokes `workspace.registerSubscription` from their slice. Tagged with the caller's chosen tags; `via` defaults to `'registerSubscription'`.
- **Cell-required vocabulary (organ path).** A cell emits `substrate.write.requested` with `key: '_subscriptions/<id>'`. The substrate-write handler resolves the cell's owner, attributes the writer to `@<owner>/<cellName>`, validates and registers the subscription, and tags it `cell-required`. This is the same "two kinds of seeding" rule that governs `_actions/*` and `_views/*` — versioned with the cell, refreshed on redeploy.

###### Reactor non-goals
- The reactor does not deliver events across slices: a subscription only sees writes to its own slice. Cross-slice reactivity is expressed by sharing + having the grantee's slice subscribe.
- The reactor does not retry. A reaction is exactly-once-per-event from the bus's perspective; the action's preconditions and CAS writes are the durability story.
- The reactor does not inspect the writer. Reaction writes are stamped `platform/reaction` and audited as such.

###### Worked example: a reactive machine in two facts
1. Action: `{ id: 'A-to-B', if: [{ key: 'run/${params.run}', path: 'node', op: 'eq', value: 'A' }], writes: [{ key: 'run/${params.run}', value: { node: 'B' }, type: 'run' }] }`
2. Subscription: `{ id: 'r-A-to-B', match: { keyPrefix: 'run/' }, invoke: 'A-to-B', params: { run: '${keySuffix}' } }`

Now `remember({ key: 'run/r1', value: { node: 'A' }, type: 'run' })` sends the run to its terminal state by transitive re-emission, capped by `maxDepth`. The platform learnt nothing about machines.

#### dispatch — `services/dispatch`

A single CloudFront `/@*` behaviour that resolves `/@<owner>/<name>(/<rest>)?` and proxies to `cells.call`. Stateless; `commands: {}`. Two trust-boundary roles beyond routing:

- **SSR read-proxy.** Cells declare `ssr.json` reads; dispatch runs them as the validated caller (allowlisted to `SSR_READ_TARGETS` — workspace.* / cells.* / `auth.tokens`, never write targets) and shapes results into the cell's `event.ssrData`. Cells never see a token.
- **Caller-writes.** Cells return `x-parc-writes` (JSON `{key,value,type?,tags?,via?,owner?}[]`, capped at 16); `applyCallerWrites` enforces three guards in order — caller has `write:workspace` scope, key falls under the cell's manifest `keyPrefix`, reserved namespaces (`_actions/_views/_grants/_groups/_public/`) always refused. Cross-slice writes require both `crossSlice:true` in the manifest *and* a workspace grant covering the target slice. Response side-channel: `x-parc-writes-applied`/`refused`/`denied:scope`.

Anonymous callers: GET/HEAD only, SSR skipped, `x-parc-writes` parsed-then-dropped.

#### gateway — `services/gateway`

The single authenticated MCP surface (`POST /mcp`), advertised by the auth cell's `/.well-known/oauth-protected-resource/mcp` (RFC 9728). Exposes a deliberately minimal three-tool surface — `whoami`, `read`, `act` — where all platform capability lives in the `target` argument. Targets are tier-1 (`<cell>.<command>` for the hard-coded providers `workspace`, `cells`, `auth`) or tier-2 (`@<owner>/<cell>.<tool>` resolved via `cells.describeCellTools`).

Two sentinel targets: `$catalog` (capability menu, scope-filtered, `{detail:'summary'}` for grouped one-line view) and `$types` (canonical type vocabulary merged with per-user `_types/` overrides — see §2.1.5.8). The read/act boundary is type-checked: `read` refuses `kind:'act'` capabilities; `act` refuses `kind:'read'`. The three-tier scope failure model — allow / `scope_offer` (within grant ceiling, self-serve `auth.requestScope`) / `scope_denied` (outside ceiling, re-consent required) — runs on every dispatched call (`enforceScope` in `services/gateway/service.ts`).

#### home — `services/home`

The platform's front-door static-server cell. The Lambda backend is intentionally trivial: three routes (`/`, `/index.html`, `/app.js`) serving an HTML shell + an esbuild-bundled React SPA. Almost the entire cell *is* its browser bundle (~2200-line `services/home/client/main.tsx`). The SPA is a public OAuth client doing DCR + PKCE against the platform's own auth cell, caching `client_id` in localStorage. It speaks the same `mcpCall(verb, target, input)` → `POST /mcp` an MCP agent would — the design invariant is "same wire as an agent."

Phase-3 customisation persists `_home/layout` to the user's slice, so home itself is reshaped through the substrate vocabulary rather than code (note: a parallel tier-2 home cell exists at `cells/home`, intended as the eventual replacement once `DISPATCH_DEFAULT_CELL` points at it).

#### workspace — `services/workspace`

The flagship "room" service: turns the shared substrate into per-user *rooms* (each user's slice = scope = identity). It owns the canonical vocabulary — `remember` / `recall` / `peek` / `query` / `link` / `neighbors` / `changes` / `attention` / `supersede` / `ingest` — plus the declarative no-code tier (`registerAction` / `invoke`, `registerView` / `view`, `registerSubscription`) and the sharing/grants layer (`share` / `unshare` / `group` / `requestGrant` / `approveGrant` / `denyGrant`). Reserved key namespaces: `_actions/<id>`, `_views/<id>`, `_subscriptions/<id>`, `_groups/<name>`, `_public/<pattern>`, `_grants/requests/...`, `_grants/answers/...`.

Reactive event handlers project cell lifecycle into the substrate (`cell.create.requested` / `cell.deployed` / etc.), apply organ writes (`substrate.write.requested`), run reaction subscriptions (with `maxDepth=50` bounded fixpoint — see §3.4.x), and execute scheduled tend passes. CEL expressions in actions/views/subscriptions are parsed at registration so a bad expression never gets stored. Ingest is capped at 100 facts per call.

The organ-write handler enforces source attestation: `meta.source` must start with `cell-` (IAM-pinned `events:source`), and the cell's owner is resolved through `cells.resolveCell` — never trusted from the event body.

## 4. Substrate Concepts

### 4.1 Capability & Consent

Two layered authorities compose, deliberately. The OAuth scope is the *consent ceiling* a client receives when acting AS the human inside that human's own slice — kept coarse (`workspace:read`/`workspace:write`/`cells:create`) because, within your own slice, the consequential axis is read-vs-write. The substrate grant grammar is fine-grained and runtime-mutable for the cases that need precision (cross-slice reads/writes, per-tool cell access): `workspace:<owner>:<keyPrefix|*>:<read|write>` and `cell:<owner>/<name>:<tool|*>`. **Effective access is `grants(principal) ∩ token.scope`** — tokens can only narrow, only owner-issued grants can widen.

The shipped vocabulary is documented in `docs/capability-consent.md` and `docs/scope-grants.md`; enforcement is split across `platform/runtime/auth.ts` (pure scope algebra), `services/auth/oauth.ts` (consent-time grant lifetime clamped to `grantCeilingSecs`), `services/gateway/service.ts` (per-call PEP), `services/workspace/grants.ts` (substrate grant store, dual-indexed `GRANT#<grantee>` / `GRANTBY#<owner>`), `services/cells/service.ts` (`authorizeAccess` + per-tool grants), and `services/dispatch/service.ts` (`applyCallerWrites`). Incremental authorization narrows within the grant via `auth.focusScope`/`requestScope` without re-consent; only widening past the ceiling triggers a fresh consent flow.

#### 4.1.x Data model — additions for groups & public projections

Add these item shapes to the substrate table layout, alongside the existing fact / typed-fact / edge / GRANT / GRANTBY rows:

**Group membership reverse index (off-scan grant resolution).**

| pk | sk | attrs | written by |
| --- | --- | --- | --- |
| `MEMBER#<principal>` | `<owner>#<group>` | `owner`, `group`, `principal` | `addMember` / `removeMember` (`grants.ts:173-180`) |

The membership row exists so the read path can answer "which `(owner, group)` pairs does this principal belong to?" with one indexed `Query pk = MEMBER#<principal>`. It is the **enforcement projection** of `_groups/<name>` facts; the fact is the record, the index is the materialised view (the same fact-vs-index discipline applied to grants and types).

**`_groups/<name>` fact — authoritative audience record.**

Stored in the **owner's** slice as a normal observed-state fact (`scope = owner`, `key = _groups/<name>`, `via = "groups:set"`, `type = "group"`, `tags = ["groups"]`). Value shape:

```ts
interface GroupValue {
  members: string[]; // sorted; excludes the owner and excludes `public`
  label?: string;
  note?: string;
}
```

`_groups/` is a reserved namespace: organ (event-driven) writes into it are refused (`handlers.ts:1811-1816`), and write-through grants may not cover it (`handlers.ts:1153`). Sharing/visibility authority is the caller's, never a cell's.

**`_public/<pattern>` fact — owner-visible projection of public shares.**

Parallel to the membership index, public shares are reflected into the owner's own slice as `_public/<keyPattern>` facts (`scope = owner`, `key = _public/<pattern>`, `value = { pattern, sharedAt }`, `via = "share:public"`, `type = "public-share"`, `tags = ["public"]`). The cross-owner `/mcp` read path enforces public access through the `GRANT#public` index; the `_public/` projection exists so the owner's *own* cells — which read their slice under an IAM scope blind to the grant table — can learn which of their keys are public (e.g. a renderer that must serve only public docs). `_public/` is reserved on the same terms as `_groups/`.

#### 4.1.y `_groups/` membership reconcile

When `workspace.group` writes a `_groups/<name>` fact, it reconciles the membership index against the prior membership in one pass:

1. Read the existing fact (if any) and form `before = set(existing.members)`.
2. Compute `next` from `members` (wholesale) or by patching `existing.members` with `add` / `remove`.
3. Drop the owner from `next` (owners are implicitly in every audience they define).
4. Drop `public` from `next` (the reserved universal audience is not a regular member).
5. `state.put` the new `_groups/<name>` fact with the sorted member list.
6. For each `p ∈ next \ before`, `addMember(owner, name, p)`.
7. For each `p ∈ before \ next`, `removeMember(owner, name, p)`.

The fact write and the symmetric-difference index updates together are the whole "set the audience" operation; partial failure is bounded by the substrate's normal observed-state write semantics (one fact, one row per added/removed member).

#### 4.1.z `group:<name>` resolution at recall time

A grantee of the form `group:<name>` resolves at recall/peek time through the membership index, never by scanning the owner's slice. The applicable-grants fan-out (`grants.ts:98-117`) is:

1. Always: `listForGrantee("public")` — the universal audience.
2. If the caller is authenticated:
   a. `listForGrantee(<viewer>)` — direct grants to this principal.
   b. `listMemberships(<viewer>)` — every `(owner, group)` the viewer belongs to (one indexed Query on `MEMBER#<viewer>`).
   c. For each membership `(owner, group)`: `listForGrantee("group:" + group)`, **filtered to `g.owner === owner`** so a `group:eng` grant only resolves for the owner whose group enrolled this viewer — group names are scoped to the defining owner, not global.
3. Dedupe by `(owner, grantee, key)` and drop any grant whose owner is the viewer themselves.

`recall` (`handlers.ts:1304-1331`) folds each resulting grant into the viewer's merged view as `<owner>/<key>` (whole-slice and trailing-`*` prefix forms walk the granted owner's slice; bare keys are a single `state.get`). Every step on the read path is an indexed query — there is no slice scan keyed by group membership.

The owner+public exclusion is what makes the resolution sound: enrolling an owner as a member of their own group would fold their slice into itself; enrolling `public` would create an alias for the universal audience under a custom name and break the "every caller belongs to `public`" invariant.

#### 4.1.w workspace.group / workspace.groups MCP tools

Two declared targets manage audiences (`handlers.ts:1017-1056`, `1582-1625`):

- **`workspace.group`** (`act`, `kind: "act"`). Input: `{ name, members?, add?, remove?, label?, note? }`. Defines or patches `_groups/<name>` and reconciles the membership index per §4.1.y. Group `name` must be a bare handle (no `/`, no leading `_`). Output: the resolved `{ name, members[], label?, note? }`.
- **`workspace.groups`** (`read`). Input: none. Lists the caller's audiences by querying `prefix: _groups/, rankBy: recency, limit: 200` over their own slice. Output: `{ groups: [{ name, members[], label?, note? }] }`.

Sharing to a group is `workspace.share { to: "group:<name>", key?, mode? }`; the gateway puts a `GRANT#group:<name>` row that the recall fan-out (above) resolves through the `MEMBER#<principal>` index for any member.

#### 4.1.v Grant request/approval inbox flow

The substrate exposes a complete escalation loop on top of the grant-store primitive: when a caller hits a `grant_denied` they ask the resource owner for access, the owner resolves the request, and the outcome lands in the requester's slice as an observable fact. This is the only place the platform performs cross-slice writes on its own (twice — once for the request, once for the answer), and the surface is built from facts and the existing `share` / `cells.grant` primitives — no new notification channel.

Reserved namespace (`services/workspace/grant-requests.ts`):
- `_grants/` — never writable through grants or write-through. The reserved-namespace guard in `requireWriteThrough` (`handlers.ts:1153`) rejects caller writes to `_grants/`, `_actions/`, `_views/`, `_groups/`, `_public/`.
- `_grants/requests/<requester>/<resource>` — pending requests live in the OWNER's slice.
- `_grants/answers/<owner>/<resource>` — outcomes live in the REQUESTER's slice.

Resource grammar (`parseResource`, `grant-requests.ts:41`). Throws a teaching error showing both forms on malformed input:
- `workspace:<owner>:<keyPattern>:<read|write>` — `keyPattern` is a fact key, a `prefix/*`, or `*` (whole slice); `mode` MUST be `read` or `write`. Examples: `workspace:alice:notes/*:write`, `workspace:alice:*:read`.
- `cell:<owner>/<name>:<tool|*>` — `tool` is a bare tool name, a trailing-`*` pattern, or `*`. Example: `cell:alice/regwatch:review`.

Deterministic single-open-request guarantee. `requestKey(requester, resource)` is fully determined by `(requester, resource)`, so a second `workspace.requestGrant` for the same pair `put`s the same key and bumps revision instead of piling up duplicates. The same key revives a previously-denied request (its revision history is preserved). Cross-slice spoofing is prevented by the platform writing the request fact itself with `ctx.identity = requester`, so `_meta.writer` is the requester — provenance is the anti-spoofing.

Value shapes (`grant-requests.ts:84`):
- `GrantRequestValue = { requester, resource, note?, status: 'pending'|'approved'|'denied', requestedAt, resolvedAt?, reason? }`, fact `type:'grant-request'`, tag `grants`, lives in owner's slice.
- `GrantAnswerValue = { resource, status: 'approved'|'denied', by, at, reason? }`, fact `type:'grant-answer'`, tag `grants`, lives in requester's slice.
- `NOTE_MAX = 500`. `requestGrant.note` and `denyGrant.reason` are silently truncated to the first 500 chars (not rejected) at `handlers.ts:1633` and `handlers.ts:1699`.

Lifecycle:
1. **`workspace.requestGrant({ resource, note? })`** (`handlers.ts:1627`).
   - Refuses self-requests (`parsed.owner === requester` → "you own this resource — grant it directly").
   - Performs the cross-slice `state.put` into `parsed.owner`'s slice at `requestKey(requester, resource)`, server-stamped with the requester's identity.
   - Emits `workspace.grant.requested { owner, requester, resource }`.
   - Returns `{ requested:true, owner, resource, key }`.
2. **`workspace.grantRequests()`** (`handlers.ts:1654`) returns the caller's two-sided inbox:
   - `incoming`: `_grants/requests/*` from the caller's own slice (where they are the resource owner), filtered to `status === 'pending'`.
   - `answers`: every `_grants/answers/*` fact in the caller's slice (outcomes of requests they made).
3. **`workspace.approveGrant({ key })`** (`handlers.ts:1669`).
   - Owner-only guard via `pendingRequest()`: the fact must exist at a `_grants/requests/` key, be live (not superseded), have `status:'pending'`, and `parseResource(resource).owner === caller`.
   - Routes by family:
     - `workspace` family → `grants.put({ owner, grantee:requester, key:keyPattern, mode, createdAt })` (the same primitive `share` uses).
     - `cell` family → `ctx.serviceClient('cells').command('grant', { owner, name:cellName, principal:requester, tools:[tool] })`. When `tool === '*'`, `tools` is omitted so the cells registry interprets it as every tool.
   - Then `resolveRequest(..., 'approved')`.
4. **`workspace.denyGrant({ key, reason? })`** (`handlers.ts:1696`).
   - Same guard, then `resolveRequest(..., 'denied', reason)` with `reason` truncated to 500 chars. No grant is created.
5. **`resolveRequest()`** (`handlers.ts:1188`) is symmetric and **supersede-not-delete**:
   - Re-`put`s the request fact with `status`, `resolvedAt`, optional `reason` (preserves the body in trajectory) and then `state.supersede`s it so it leaves the pending inbox but stays in history.
   - Performs the second cross-slice write — the answer projection — into the requester's slice at `answerKey(owner, resource)`, server-stamped with the owner's identity.
   - Emits `workspace.grant.resolved { owner, requester, resource, status }`.

Teaching surface: every `grant_denied` error from `peek` and write-through carries the request grammar pre-formed, e.g. `Request one: act("workspace.requestGrant", { resource: "workspace:alice:inbox/x:read" })` (`handlers.ts:1160, 1346`). The grammar is the same string the request takes and the denial suggests — one vocabulary, two surfaces.

Cross-slice write authority recap: the substrate has exactly two platform-internal cross-slice writes — `requestGrant` (owner's slice, writer=requester) and `resolveRequest`'s answer projection (requester's slice, writer=owner). All other cross-slice writes go through grant-mediated write-through, which `requireWriteThrough` (`handlers.ts:1147`) refuses for the reserved `_grants/`, `_actions/`, `_views/`, `_groups/`, `_public/` namespaces.

### 4.2 Cell Isolation

A cell is a tenant whose blast radius equals the trust boundary at every layer simultaneously — origin, credential, IAM, storage, capability — and the layers nest. Documented in `docs/cell-origin-isolation.md`; enforced across:

- **Origin.** Untrusted user cells run on `<owner>-<name>.on.parc.land`, separate from the trusted shell at `parc.land`. The cell-namespace CloudFront distribution rewrites the host to a path; the apex `/@<owner>/<name>` redirects browser navigations to the cell subdomain (`CellApexRedirect` in `platform/infra/service-router.ts`).
- **Credential.** Cells receive only an `x-cell-caller` header (validated identity string), never the bearer. Per-cell tokens minted via `cellCeiling` are stored only in the cell's own per-origin `localStorage`. The `parc_session` cookie is host-only (no `Domain`) so it never leaks to a sibling cell.
- **IAM.** Each cell is its own Lambda + DynamoDB table + IAM role under the `permissionBoundary` from `platform/infra/dynamic-cell-control-plane.ts`. Forge's `iam:CreateRole` is conditioned on `iam:PermissionsBoundary == permissionBoundary.arn`, so the boundary is mandatory.
- **Substrate read-scoping.** The boundary grants `Get/Query/BatchGet` on the substrate table conditioned by `dynamodb:LeadingKeys` to the owner's `STATE#`, `TRAJ#`, `SEQ#`, `IN#…#*`, `TYPE#…#*` partitions only (`services/cells/cell-template.ts`).
- **WebAuthn pinning.** RP ID stays `parc.land` (so passkeys are portable across cell subdomains via the registrable-suffix rule), but `expectedOrigin` is pinned to a shell allowlist — cell subdomains are explicitly rejected.

#### 4.2.X ObservedState — Salience Scoring

Salience is a per-key, read-time score in `[0,1]` computed from five normalised signals derived in one pass over the scope's trajectory and edges. It is the substrate's only attention-shaping primitive: it ranks `query()` results, drives the focus/peripheral/elided tiers in `read()`/`shape()`, and is exposed on every `Entry._meta` (`score`, plus `velocity`, `standing`, `centrality` term breakdowns).

**Signal formulas** (`platform/runtime/state.ts:416-437`, `scoreParts`):

| Signal | Formula | Inputs | Default saturation |
| --- | --- | --- | --- |
| recency | `2^(-age / halfLifeMs)` where `age = max(0, now - record.updatedAt)` | record `updatedAt` | halfLife = 7 d |
| velocity | `min(windowWrites / velocitySaturation, 1)` | window writes | 5 writes / 1 h window |
| attention | `min(windowReads / attentionSaturation, 1)` | window reads | 5 reads / 1 h window |
| standing | `min(log1p(lifetime) / log1p(standingSaturation), 1)` where `lifetime = lifetimeReads + lifetimeWrites` (incl. seeds) | lifetime touches + import seeds | 20 touches |
| centrality | `min(degree / centralitySaturation, 1)` where `degree = in + out edges` | edge count | 5 edges |

`score = clamp01(Σ weightᵢ · signalᵢ)`. Recency uses the record's stored `updatedAt`, NOT the trajectory — recency keeps decaying past the trajectory TTL.

**Default weights and constants** (`resolveSalience`, lines 303-324):

| Param | Default | Notes |
| --- | --- | --- |
| recencyWeight | 0.35 | Tuned 2026-06-15 over imported corpus |
| velocityWeight | 0.10 | Bursty, mostly redundant with recency |
| attentionWeight | 0.15 | Reads — what a used workspace accrues |
| standingWeight | 0.30 | Earned floor for old, loved facts |
| centralityWeight | 0.10 | Graph degree |
| halfLifeMs | 7 d | Personal-workspace cadence |
| windowMs | 1 h | Burst window for velocity/attention |
| focusThreshold | 0.5 | ≥ → focus tier |
| elideThreshold | 0.1 | < → elided tier |

Default weights sum to exactly 1.00. Score and thresholds remain meaningful only if `Σ weights ≤ 1`; raw overrides are not auto-normalised (escape hatch — caller owns it).

**Trajectory TTL vs half-life decoupling.** `TRAJECTORY_TTL_SEC = 86400` (24 h, `platform/runtime/dynamo-state-store.ts:32`) bounds the scope-level trajectory scan that `signalsFor` performs from `seq=0` on every shaped read; the comment at the constant calls this "comfortably beyond the salience window" — i.e. it covers the 1 h `windowMs`, not the 7 d half-life. Velocity / attention are intrinsically bounded to the 1 h window so the 24 h TTL does not lose information for them. Standing's `lifetime` count IS truncated by the TTL, which is mitigated via the `seedReads`/`seedWrites` import-priors mechanism (below). Recency, since it reads from `record.updatedAt`, is unaffected by trajectory TTL.

**Named lenses** (`SalienceLens`, `LENS_PRESETS`, lines 335-354). Each preset overrides weights (and, for `recent`, `halfLifeMs`); all sum to 1.0:

| Lens | recency | velocity | attention | standing | centrality | Other |
| --- | --- | --- | --- | --- | --- | --- |
| salience (default) | 0.35 | 0.10 | 0.15 | 0.30 | 0.10 | — |
| recent | 0.60 | 0.15 | 0.10 | 0.10 | 0.05 | halfLife = 1 d |
| connected | 0.25 | 0.05 | 0.10 | 0.20 | 0.40 | — |
| durable | 0.20 | 0.05 | 0.10 | 0.50 | 0.15 | — |
| active | 0.30 | 0.25 | 0.25 | 0.10 | 0.10 | — |

Resolution order: `instance defaults ← lens preset ← raw override` (`callSalience`, lines 357-362). A lens recomputes the score (so it shifts BOTH ranking AND focus/peripheral/elided tiers), unlike `query.rankBy` which only reorders an already-scored set.

**Tier rules** (`tierFor`, lines 475-479; `shapeEntries`, lines 706-733):

1. `score ≥ focusThreshold` → `focus` (full value + meta).
2. `score ≥ elideThreshold` → `peripheral` (full value + meta).
3. else → `elided`: with `elision: 'auto'` (default), value AND `_meta` are withheld, replaced by an `ElidedStub { key, type, score }` listed in `_shaping.elided` (score-descending). With `elision: 'none'`, every entry retains its value regardless of tier.
4. Promotion: any key in `ReadOptions.expand` is forced to `focus` regardless of score.
5. Per-read `focusThreshold`/`elideThreshold` overrides take precedence over instance/lens thresholds.

**Import-priors (`seedReads` / `seedWrites`)** — `WriteInput.import` (lines 503-508), `StateRecord.seedReads`/`seedWrites` (lines 194-201), folded in `wrap` (lines 666-678). On import, a caller passes legacy cumulative read/write counts; these are stored on the record and added to `lifetimeReads`/`lifetimeWrites` at score time, ONLY for the `standing` term — never the burst window. Imports also preserve `createdAt`/`updatedAt`, so recency reflects true age. Effect: a ported fact arrives with its earned standing intact, and standing survives the 24 h trajectory TTL because it has a permanent floor in the seed values. Seeds never decay; they are a one-time prior.

**`read()` vs `shape()` distinction.**
- `read(scope, opts)` (lines 824-843): runs `store.list(scope)` + `signalsFor(scope, …)` (full trajectory + edge scan from `seq 0`), `wrap`s every live record under the resolved `callSalience(s, lens, override)` so scores are recomputed under the lens, then runs `shapeEntries`. Also appends a scope-level `read` trajectory event (`key: null`).
- `shape(entries, opts)` (lines 818-822): pure re-tiering of an already-scored set. A lens here CANNOT recompute scores (the trajectory isn't on hand); it only adjusts thresholds via the resolved lens settings. Used to merge multiple scopes (own + granted) and shape the union once.

**Read amplification.** Every shaped `read()`/`query()`/`neighbors()` triggers one `signalsFor()` call, which reads the trajectory from `seq=0` and lists all edges — `O(scope trajectory size + edge count)`. The 24 h TTL bounds the trajectory partition. Bulk paths build the signals map once and share it across `wrap` calls; `get()` (single-key) currently pays a full scan per call. This cost is the documented price of computing the cumulative `standing` term faithfully.

**Public surface for tuning / instrumentation.** Exported: `computeScore`, `scoreParts`, `buildSignals`, `KeySignals`, `ScoreParts`, `EMPTY_SIGNALS`, `SalienceOptions`, `SalienceLens`, `ReadOptions`, `tierFor`-equivalent thresholds via `_meta.score` + `_shaping`. Not exported (intentionally private to the substrate closure): `signalsFor`, `wrap`, `shapeEntries`, `resolveSalience`, `callSalience`, `LENS_PRESETS`, `tierFor`. Per-fact `_meta` exposes `score`, `velocity` (writes/min over window), `standing`, `centrality` rounded to 4 d.p. for downstream debugging.

#### 4.2.Y Lazy fact timers (`timer.effect: 'delete' | 'enable'`)

Every fact MAY carry a single timer set at write time. Timers are evaluated lazily at read — there is no scheduler — and serve two distinct effects:

- `effect: 'delete'` (the **lease** / visibility-timeout). The fact is live now and vanishes at expiry. This is the substrate's only deliberate exception to "supersede, don't delete": the writer is declaring the fact ephemeral. After expiry the row is filtered out of every read path (see below) for a 24-hour grace period, after which DynamoDB TTL physically removes the husk.
- `effect: 'enable'` (the **reveal** / cooldown release). The fact is dormant until expiry, then live. The row is durable; only its visibility is delayed. No TTL is ever attached to an enable-timer fact.

**Input shape.** `timer: { ms?: number; at?: string; effect: 'delete' | 'enable' }`. Exactly one of `ms` (relative, positive) or `at` (absolute ISO) is required; both or neither is rejected at write time.

**Liveness.** A fact is live iff `!timer || (effect === 'delete' ? now < expiresAt : now >= expiresAt)`. Liveness is computed identically by every read path: `get`, `read`, `query`, `neighbors`, `link.fromExists`/`toExists`, and `attention.{stale, unlinked, dangling}`. Two paths are intentionally timer-agnostic: `changes(sinceSeq)` (the trajectory is the truth log; subscribers see the original write event regardless of timer state) and the raw `edges(scope)` projection.

**CAS interaction (the load-bearing detail).** Conditional writes (`ifAbsent`, `ifRevision`) evaluate against the **live** view, not the physical row. An expired-delete fact therefore counts as ABSENT for `ifAbsent` and as revision 0 for `ifRevision`. This is what makes a lease claim crash-safe: a writer takes the slot with `{ ifAbsent: true, timer: { ms: L, effect: 'delete' } }`, and if the writer crashes without releasing, the next claimant after `now > expiresAt` simply wins the same `ifAbsent` precondition.

The semantic CAS layer is paired with a **physical CAS guard** at the storage layer (DynamoDB `ConditionExpression` on the actual stored `revision`). The physical row is preserved across a lapsed lease — the new write inherits the previous `firstSeq` and gets `revision = prev.revision + 1` — so the re-claim is atomic against any concurrent claimant. Callers can rely on the revision being monotonic across the lapse (e.g. for downstream reconciliation).

**TTL and the 24-hour grace.** When and only when `effect === 'delete'`, the storage layer attaches a row TTL of `expiresAt + 24h`. The grace exists because the read-time filter must still resolve the previous `revision` for an `ifAbsent` re-claim shortly after expiry; after 24 hours any rational caller has either re-claimed (incrementing past the husk) or moved on. Enable-effect timers never receive a TTL — the fact is permanent, only visibility is gated.

**What this primitive enables.** Distributed coordination on the substrate without an external broker: leases (`ifAbsent` + `delete`), scheduled reveals / cooldowns (`enable`), and the canonical task-queue claim pattern (declarative `claim-task` action: `ifAbsent: true` + `timer: { ms: leaseMs, effect: 'delete' }`). Higher-level vocabulary (the declarative actions tier) composes the primitive without re-implementing it.

**Out of scope.** Timer renewal/heartbeat is not a primitive — a renewing writer simply rewrites with a fresh timer (which it can predicate with `ifRevision` to detect a lease it lost during a stall).

### 4.3 Substrate Storage

The storage substrate is one scope-partitioned DynamoDB table (the *blackboard*) plus one shared S3 bucket prefixed per cell. Designed in `docs/substrate-storage.md` and `docs/cell-storage-s3.md`. The load-bearing trick is that **bounded scopes turn a KV store into a substrate**: every operation the architecture needs (recall a slice, CAS, timers, type/tag filter, neighbours, change feed, salience rank) is a single `Query pk=STATE#<scope>` — sometimes via `gsi-in` / `gsi-type` — and **scope authority becomes an IAM `LeadingKeys` condition** rather than an interpreter check.

Item families on `SubstrateTable`:
- Facts: `pk = STATE#<scope>`, `sk = KEY#<key>` — durable; supersede, don't delete.
- Edges: `pk = STATE#<scope>`, `sk = EDGE#<from>|<rel>|<to>` (no `|` allowed in segments — `EDGE_DELIM`).
- Trajectory: `pk = TRAJ#<scope>`, `sk = <iso>#<seq>` — TTL'd at ~24h (`TRAJECTORY_TTL_SEC`).
- Seq counter: `pk = SEQ#<scope>`, `sk = A` — atomic `ADD seq :one`.
- Grants: `pk = GRANT#<grantee>` / `pk = GRANTBY#<owner>` — sharing index.
- Group memberships: `pk = MEMBER#<principal>`, `sk = <owner>#<group>` — see §4.1.x.

Reads-direct, writes-mediated for organs (v1): the boundary caps dynamic cells at substrate **read** only; writes flow through `substrate.write.requested` events that workspace applies in the cell owner's slice. The reference implementation is `cells/reef-writer/index.ts`. The S3 layer mirrors the asymmetry: `cells/<id>/src/*` is per-cell (deploys), `cells/<id>/data/<user>/*` is per-cell-per-caller (never deploys).

### 4.4 MCP & Tools

The substrate's external invocation contract is one authenticated `POST /mcp` JSON-RPC 2.0 endpoint (MCP 2025-06-18). Documented in `docs/mcp-spec-alignment.md` and `docs/remote-mcp-implementation.md`; implemented in `platform/runtime/define-mcp-service.ts` with the gateway as the canonical application.

Three meta-tools — `whoami`, `read`, `act` — are stable; capability lives in `target`. `tools/list` enumerates *only* the meta-tools, but `read('$catalog')` returns the live capability menu so new tier-1 commands and tier-2 tools are discoverable without a client reconnect. Provider contract: each tier-1 cell implements `describeTools` returning `{name, description, inputSchema, resultSchema?, scope, kind:'read'|'act'}`; the cells service additionally implements `describeCellTools`/`describeTypes`/`callCellTool` to aggregate dynamic-cell tools, validated against `SAFE_TOOL_NAME` and capped at `MAX_TOOL_CELLS = 25`.

CORS is credentialless and origin-suffix-bound (`MCP_CORS_ORIGIN_SUFFIX = .on.parc.land`); RFC 9728 protected-resource discovery returns 401 + `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"` on unauthenticated calls. Streamable HTTP server→client features (subscriptions, `tools/list_changed`, sampling) are deliberately not implemented — Lambda Function URLs can't hold long streams; `workspace.changes(sinceSeq:'head')` polling substitutes. See §11 for the full asynchrony model.

### 4.5 Authoring Runtime

The substrate's commitment that authoring artifacts (documents, blocks, boards, placements, renderer plug-ins, executable code, agent prompts, declared actions/views, and even cell source) are first-class facts — edited and executed in the same environment they live in. Documented in `docs/lit-substrate-authoring.md`, `docs/declarative-actions-vs-code-cells.md`, and `docs/narrative-surface.md`.

The item seam is `fact × renderer × placement`, where `placement` is `_canvas/<board>/<key>` for boards (`cells/canvas`) and `_doc/<docId>/<cellKey>` for documents (`cells/lit`). Two execution gradients run on it:

- **Declarative tier (the *reef*).** `_actions/<id>` and `_views/<id>` are facts with structured DSL (CEL on top), interpreted by the workspace cell over a bounded write footprint with `${params.*}` / `${self}` / `${now}` substitution. No deploy. Decidable activation via `enabled`/`if`. Implemented in `services/workspace/actions.ts` and `services/workspace/views.ts`. See §4.5.1 for the full DSL.
- **Code tier (*organs*).** `cells.writeFile`/`replaceInFile`/`deploy` mints a real Lambda+table+IAM role from TypeScript+JSX source. The `@c15r/run` cell is a substrate-native JS executor; `@c15r/models.agent` is the generative tier with the substrate as toolbox. Outputs are facts by construction — `out:<cellKey>:<ts>` with `produced-by` links; lit/canvas place existing facts via decorations rather than embedding copies. The dotlit drift-bug-class is closed structurally.

Isomorphic React (one `shared.tsx`, `renderToString` server + `hydrateRoot` client, one pinned `imports.json` for both bundlers) is the surface-unification mechanic — a single declaration renders to the human projection AND, via `defineMcpService`, the agent affordance.

#### 4.5.1 Declarative vocabulary — actions and views

The declarative tier is the workspace's no-code action/view DSL. **It is data, not code:** every declaration is stored as a fact in the caller's slice (`_actions/<id>` and `_views/<id>`) and evaluated by a small, fixed interpreter at invoke/read time. Because the write footprint is *declared*, it is bounded, auditable before execution, and contested-target detection is a registry scan.

CEL is **opt-in inside conditions and view filters**, not the surface language. Parse errors surface at registration; a non-boolean CEL result fails the predicate.

##### 4.5.1.1 Storage and constants

| Constant | Value | Source |
|---|---|---|
| `ACTIONS_PREFIX` | `'_actions/'` | `services/workspace/actions.ts` |
| `VIEWS_PREFIX` | `'_views/'` | `services/workspace/views.ts` |

Each registration is a `state.put` with:
- action: `key=_actions/<id>`, `type='action'`, default `via='registerAction'`
- view: `key=_views/<id>`, `type='view'`, default `via='registerView'`

`RegisterOptions { via?, tags? }` lets a tier-2 organ tag its own vocabulary `cell-required` so it reads as program (refreshed on redeploy), not organic, caller-authored vocabulary. Caller registrations use the defaults.

##### 4.5.1.2 ActionDefinition

```
ActionDefinition {
  id: string                          // required; MUST NOT contain "/"
  description?: string
  if?: DeclaredCondition[]            // AND'd preconditions
  enabled?: DeclaredCondition[]       // AND'd availability gate
  writes: DeclaredWrite[]             // REQUIRED, non-empty
  params?: Record<string, ParamSpec>
}

DeclaredCondition =                   // two interchangeable forms, one shape
  | { key: string, path?: string,
      op: 'exists'|'absent'|'eq'|'ne'|'gt'|'lt', value?: unknown }
  | { cel: string, key?: string }     // CEL bindings: {params, self, now, key?, exists?, value?}

DeclaredWrite { key: string, value?: unknown,
                ifAbsent?: boolean, timer?: FactTimer,
                type?: string, tags?: string[] }

ParamSpec { type?: 'string'|'number'|'boolean'|'object'|'any',
            description?, enum?, required? }
```

##### 4.5.1.3 Validation (`validateDefinition`)

At registration the substrate enforces, and rejects with an error otherwise:

1. `id` is a non-empty string and contains no `/`.
2. `writes` is a non-empty array; every write has a string `key`.
3. **No write may target the `_actions/` prefix** — actions cannot rewrite their own vocabulary.
4. For each `if`/`enabled` entry:
   - CEL form: `c.cel` is parsed via `celParse` at registration time; broken expressions are rejected before storage. `key`, if present, must be a string.
   - Structured form: `key` is a string; `op` ∈ `{exists, absent, eq, ne, gt, lt}`; `eq/ne/gt/lt` require a `value`.

(Note: no validation prohibits *reading* `_actions/` keys from conditions; only *writing* is gated.)

##### 4.5.1.4 Substitution language

Single regex, single pass, three placeholder forms only:

```
${params.<name>}    where <name> matches [A-Za-z0-9_]+
${self}             the invoking identity's user
${now}              new Date().toISOString() at invoke time
```

**Substituted content is never re-expanded.** Unknown `${...}` shapes pass through unchanged.

Two helpers, with a deliberate asymmetry that the substrate relies on:

| Helper | Domain | Undefined param becomes | Type behavior |
|---|---|---|---|
| `substituteString` | strings only | empty string `''` | non-string values JSON.stringify'd |
| `substituteDeep` | strings/arrays/objects | `null` | a string that is **exactly** `${params.x}` keeps the param's JSON type |

`substituteString` is applied to write keys; `substituteDeep` to write values. Conditions use `substituteString` on `key` and `substituteDeep` on `value` before structured comparison.

##### 4.5.1.5 Invoke (`invoke`)

1. Load `_actions/<id>`. Missing/superseded → `ActionInvokeError('not_found')`.
2. Validate params: `required` first, then `type` (skipped for `'any'`), then `enum` via deep equality. Failure → `'invalid_param'`.
3. Evaluate `enabled` AND'd. First false → `'action_disabled'` (with the predicate detail).
4. Evaluate `if` AND'd. First false → `'precondition_failed'` (with detail).
5. Apply each write in declared order via `state.put`, with `via='action:<id>'` and per-write `type, tags, ifAbsent, timer` propagated.

**Writes are NOT atomic as a batch.** Per-write `ifAbsent` is the only atomic primitive; combined with `timer` it expresses an atomic, lease-bound, crash-safe claim. Each successful write also fires `workspace.fact.written` so subscriptions react to manual invokes the same way they react to reactive chains.

`ActionInvokeError` codes: `precondition_failed | action_disabled | invalid_param | not_found`.

##### 4.5.1.6 Contested-target detection

`register` returns `RegisterResult { action, contested: Array<{ target, actions[] }> }`. The registry scans all other registered actions (excluding the same id), indexes their declared write keys, and reports overlaps where two or more actions declare a write to the same (un-substituted) key template. **Conflict is surfaced, not blocked** — the substrate's stance is to hold the tension visibly. The caller is expected to reconcile.

##### 4.5.1.7 ViewDefinition

```
ViewDefinition {
  id: string                          // required; MUST NOT contain "/"
  description?: string
  query: QueryOptions                 // REQUIRED — the substrate's query primitive, stored as data
  reduce?: 'list' | 'count' | 'latest' | 'sum'   // default 'list'
  path?: string                       // dot-path into each value, used by 'sum'
  filter?: string                     // CEL over { key, value, meta }, applied before reduce
  render?: RenderHint
}

RenderHint { type: 'metric' | 'table' | 'feed' | 'list' | 'markdown',
             label?: string, [extra]: unknown }
```

(Earlier drafts named `top_n`/`group` reducers and a `form` render hint — neither is implemented; the canonical set is the one above.)

##### 4.5.1.8 Validation (`validateView`)

- `id` non-empty, no `/`.
- `query` is an object.
- `reduce` ∈ the four reducers if present.
- `filter` parses as CEL at registration time (`celParse`); broken expressions cannot be registered.
- `render.type` is a string if `render` is present.

##### 4.5.1.9 Evaluate (`view`)

1. Load `_views/<id>`. Missing/superseded → not_found.
2. Run `state.query(scope, def.query)`.
3. **Implicit privacy filter:** if `def.query.prefix` is unset, drop entries whose key starts with `_actions/` or `_views/`. A view with an explicit prefix can introspect the vocabulary; a generic view cannot leak it.
4. If `filter` set, evaluate the CEL expression per-entry over `{ key, value, meta }`. Any throw or non-`true` result excludes the entry — **a view stays total**.
5. Apply reducer:
   - `list` → the (filtered, ranked) entries array.
   - `count` → `entries.length`.
   - `latest` → entry with greatest `_meta.updatedAt`, or `null`.
   - `sum` → numeric sum over `resolvePath(value, path)`; non-numbers skipped.

Returns `ViewResult { id, description?, render: RenderHint | null, value, count }`.

##### 4.5.1.10 Command surface and verb-scope defaulting

The cell exposes the DSL through these tools (kind shown):

| Tool | Kind | Default scope |
|---|---|---|
| `registerAction`, `deleteAction`, `invoke` | act | `write:workspace` |
| `actions` | read | `read:workspace` |
| `registerView`, `deleteView` | act | `write:workspace` |
| `views`, `view` | read | `read:workspace` |
| `tend` | act | `workspace:admin` (explicit) |

A tool that omits `scope` is gated by its `kind` at gateway time: `kind: 'read'` → `read:workspace`, `kind: 'act'` → `write:workspace`. Slice isolation still applies inside each handler; the verb gate is layered on top. Legacy coarse tokens (`workspace:read`, `workspace:write`) imply the verb scopes via `impliesScope`.

## 5. Userland Cells

Tier-2 cells live under `cells/<name>/`. Each is its own Lambda + DynamoDB table + IAM-bounded role, addressable at `/@<owner>/<cell>` (apex) or `<owner>-<cell>.on.parc.land` (host-isolated origin).

| Cell | Purpose | Key capabilities used |
|---|---|---|
| `kernel` (`@c15r/kernel`) | Shared client ESM (`/app.js`) imported by all tier-2 cells: origin-aware OAuth (PKCE, single `parc.session.*` namespace), `/mcp` `read`/`act` client, `cellAddress`/`cellUrl`, `loadTypes`, theme tokens, fact title/href routing. | Apex `/oauth/*`, `/mcp` `workspace.query`, `parc_session` cookie mirroring on cell hosts. |
| `home` (cells/home — tier-2) | Auth-aware SSR front door with anonymous landing + signed-in dashboard (greeting, capture, workspace window, cells console, identity & grants, field computer). Layout is data (`_home/layout` fact). | 11 SSR reads via `ssr.json`, `read`/`act` for everything, `workspace.remember` for layout writes. |
| `lit` (`@c15r/lit`) | Narrative surface — literate-markdown authoring where a doc is a VIEW over `cell:` facts (membership/order in `_doc/`). Isomorphic SSR + hydrated React, dotlit fence meta-grammar, `[[wikilinks]]` as substrate edges, `_renderers/<type>` viewer plug-ins. | `workspace.query/remember/link/unlink/neighbors/view`, `@c15r/run.exec`, `@c15r/models.agent/.fetch`, `@c15r/viewers` ESM. |
| `canvas` (`@c15r/canvas` — `🌲`) | Spatial substrate projection — pannable/zoomable 2D canvas where geometry is `_canvas/<board>/el:<id>` placement decoration. SSR-first paint with byte-equal hydration; zero-JS `?embed=1` thumbnail mode. | `workspace.remember/link/unlink/supersede/peek`, direct DDB `STATE#<owner>` read via LeadingKeys IAM scope. |
| `input` | Capture-only PWA share_target / iOS Shortcut / bookmarklet at `/@c15r/input` — every share becomes an `inbox/<ts>` capture fact with a `log:<YYYY-MM-DD>` daily-log edge. | `workspace.remember` (capture + daily log via `ifAbsent`), `workspace.link` rel='on', `workspace.query`. |
| `models` (`@c15r/models`) | Generative-tier executor cell — custodies provider API keys (Anthropic/OpenAI/Google) collocated with the raw-HTTP clients that spend them; exposes text/image/agent loops as MCP tools. Async via Lambda self-invoke + JOB# items. | Cell-private DDB for SECRET#/JOB#, EventBridge `substrate.write.requested` (organ path), substrate read for `agent` tool calls. |
| `viewers` (`@c15r/viewers`) | Pure-tier executor — deterministic content-to-DOM transformers (json/csv/mermaid/style/repl) served as one ESM module, used by canvas (ElementView), lit (`renderFence`), and any direct importer. `_renderers/<type>` re-exports adopt them in one line. | `__parcAct('@c15r/run.exec')`, `workspace.remember` for repl output→fact button. |
| `run` (`@c15r/run`) | Code-tier executor — runs JS/TS in the cell's own Lambda with substrate-native `parc.read/query/emit`. Async via self-invoke for >30s. | `@aws-sdk/client-dynamodb` LeadingKeys-scoped read, EventBridge organ-write path, lambda:InvokeFunction self-only. |
| `regwatch` (`@c15r/regwatch`) | UK regulatory monitoring inbox — Claude Code scheduled collector ingests publications, classifies them, presents as a mobile-first review inbox; Emily (State Street) is the grantee-reviewer. First multi-principal cell. | `workspace.query` for `_types/`, `cells.grant {tools:[...]}` for per-tool reviewer access. |
| `reef-writer` | 23-line reference implementation of the organ→reef write path. Single `report` tool emits `substrate.write.requested` for any owner-slice key. | EventBridge with `events:source = cell-<id>` IAM-pinned. |
| `starter` (`@c15r/starter`) | Canonical cell template — minimal notes app exercising every userland mechanic (kernel auth, platform/ui, types.json, viewers, isomorphic SSR, caller-writes via `ssr.json` writes manifest). The reference exemplar for capability-consent. | `workspace.query` for SSR list, `x-parc-writes` for caller-write delegation, declares `note:` (own-slice) + `shared/` (cross-slice) prefixes. |

## 6. Trust & Security Model

The trust posture composes the layers from §4.2 with the consent layer from §4.1.

**Origin isolation.** Two web origins, deliberately. The trusted shell (`parc.land`) hosts auth, gateway, home, dispatch. Untrusted user cells live on `<owner>-<name>.on.parc.land` — a separate origin under one wildcard cert, so same-origin `localStorage` is structurally unable to read shell-session tokens. The apex 302-redirects browser navigations of `/@<owner>/<name>` to the cell subdomain (`CellApexRedirect`) so interactive cell pages execute on their own origin; sub-resources and non-browser clients pass through. RP ID stays `parc.land` (passkey portability via registrable-suffix rule); cell origins are kept out by an enforced `expectedOrigin` allowlist (`services/auth/webauthn.ts`). The `parc_session` cookie is host-only — never `Domain=.parc.land`.

**Capability scopes.** Effective access = `grants(principal) ∩ token.scope`, monotonically. The OAuth scope (set at consent) is a coarse ceiling for in-slice action; the substrate grant grammar (`workspace:<owner>:<keyPrefix|*>:<read|write>`, `cell:<owner>/<name>:<tool|*>`) is fine-grained and runtime-mutable for cross-slice and per-tool delegation. Three-tier failure model (`services/gateway/service.ts` `enforceScope`): `scope_offer` (within grant ceiling, self-serve `auth.requestScope`) vs `scope_denied` (outside ceiling, requires re-consent). When a cell is the OAuth `redirect_uri`, `cellCeiling` (`services/auth/oauth.ts`) caps the issued token to `[workspace:read, workspace:write, cell:<owner>/<name>:*]`.

**Auth primitive.** The auth cell is the single source of truth for token validity; every peer calls `auth.validateToken` via `serviceClient`. Tokens are stored only as `sha256(token)` base64url. Refresh rows have independent (longer) TTL. WebAuthn passkeys back the human-visible identity (see §7.7 for the full ceremony spec). Cells never receive a token: dispatch forwards an `x-cell-caller` header carrying validated identity, never the bearer (`services/cells/service.ts` `cells.call`). Identity propagates on Mode-1 command envelopes through the runtime's `serviceClient`; trust derives from the IAM-attested allow-list grant (`cell.allow(target)`).

**Provenance.** Writer identity is server-stamped from validated `Identity`, never client-supplied. EventBridge `events:source` is IAM-pinned per cell role (`cell-<cellId>`), so subscribers — including the workspace organ-write handler — can trust attribution without re-validating bearers. The substrate write handler refuses any event whose `meta.source` doesn't start with `cell-`, then resolves owner through `cells.resolveCell` rather than the event payload.

**Ambient cookie defence.** The `parc_session` cookie is honoured **only** when `serviceName === 'dispatch'`, method ∈ {GET, HEAD}, AND `Sec-Fetch-Dest: document` (top-level navigation). This closes the cross-origin confused-deputy read; mutations and `/mcp` calls always require an explicit bearer.

## 7. Data Model

**S3 layout (single shared `CodeBucket`, prefix-scoped per cell):**
- `cells/<cellId>/src/<path>` — multi-file authored source (TypeScript+JSX, `imports.json`, `types.json`, `ssr.json`); writes deploy.
- `cells/<cellId>/build/<version>.zip` — esbuild-bundled Lambda artifact.
- `cells/<cellId>/data/<user>/<key>` — per-cell, per-caller blob store; never deploys; `public/...` web-served for public cells. Path-traversal-blocked via `cleanPath` (`services/cells/cell-files.ts`).

**DynamoDB tables:**
- `SubstrateTable` (shared, scope-partitioned): item families documented in §4.3 — `STATE#<scope>` for facts and edges, `TRAJ#<scope>` for trajectory (TTL ~24h), `SEQ#<scope>` for the atomic counter, `GRANT#<grantee>` / `GRANTBY#<owner>` for sharing, `MEMBER#<principal>` for group membership reverse index. Two GSIs (`gsi-in`, `gsi-type`) repeat the scope so `LeadingKeys` covers index reads. Streams `NEW_AND_OLD_IMAGES` enabled; TTL on `ttl` attribute.
- Per-cell DynamoDB tables (one per `HttpServiceCell` with `persistence: { dynamo: true }` and per dynamic cell): `pk` + `sk` schema, PAY_PER_REQUEST, optional Streams, optional TTL. Currently used by `auth` (USER#/CRED#/CHAL#/CLIENT#/CODE#/SESS#/TOKEN#/REFRESH#/DEV#/DEVUC#), `cells` (registry: CELL#/OWNER#), `models` (SECRET#/JOB#), `regwatch` (ITEM#/REVIEW#/SOURCE#/PROMPT#/NOTE#), `run` (JOB#).
- `WorkspaceEc2Stack` SSM parameters at `/workspace/*` — unrelated to platform; personal dev box.

**Cell storage primitives (`services/cells/cell-files.ts`):** `srcPrefix(id)`, `srcKey(id, path)`, `buildKey(id, version)`, `dataPrefix(id)`, `dataKey(id, user, key)` — every path passes through `cleanPath`.

**Substrate fact-typed read shape (`Entry`):** `{value, _meta: {revision, seq, writer, via, createdAt, updatedAt, writers, superseded?, supersededBy?, type?, tags?, timer?, score?, velocity?, standing?, centrality?, elided?}}`.

### 7.x Per-cell DynamoDB tables (organ-private storage)

Every dynamic (tier-2) cell is provisioned with its OWN single-table DynamoDB resource by the cell template (`services/cells/cell-template.ts`). This per-cell table is operationally distinct from the shared substrate table and serves a different purpose: organ-private scratch and side-channels that should NOT be visible to the reef. The spec distinguishes the two stores throughout §7 — facts go on the substrate; rows go on the cell's own table.

#### 7.x.1 Table shape and IAM scoping

- Schema: `pk` (HASH, S) + `sk` (RANGE, S), `PAY_PER_REQUEST`, no GSIs by default. Stable resource name `cell-<cellId>` so the IAM role can ARN-pin its grants.
- IAM grant pattern (the `OwnTable` statement): the cell role gets the full read+write DDB verb-set, but ONLY against `[<ownTableArn>, <ownTableArn>/index/*]`. No cross-table writes anywhere — a cell that needs another cell's data MUST go through that cell's tools (synchronous) or the event bus (asynchronous). The substrate, when injected, is read-only and gated by an IAM `dynamodb:LeadingKeys` condition pinning the cell to its owner's `STATE#/TRAJ#/SEQ#/IN#/TYPE#` partitions. The whole role is capped by the managed permissions boundary, so policy drift cannot escape the cell.
- Substrate writes are NEVER direct — they go through `events:PutEvents` with `events:source` IAM-pinned to the cell's service name, so a downstream substrate-write handler can trust the `Source` field as machine-attested provenance.

#### 7.x.2 Cell-private vs substrate (visibility rule)

The two stores answer different questions:

- The substrate table holds FACTS: `{value, _meta}`-shaped rows under `STATE#<owner>/KEY#<key>` (and the `TRAJ#/SEQ#/IN#/TYPE#` indexes). Facts are visible to home, attention, tend, and any other cell with the owner's slice grant. Provenance is server-stamped (`writer`, `revision`, etc.).
- A cell's own table holds ROWS: organ scratch with whatever schema the cell needs. Rows are invisible outside the cell — no other cell, no surface, no projection sees them unless the cell explicitly emits a fact. Examples observed in the codebase:
  - Auth cell: `USER#<id>`, `CRED#<credId>`, `CHAL#<id>`, `SESS#<id>`, `TOKEN#<hash>`, `USERTOK#<userId>/<id>`, `DEVUC#<userCode>` — identity and credential material.
  - Models cell: `SECRET#<provider>/v1` (provider API keys, write-only — no readback path), `JOB#<jobId>/v1` and `JOB#<jobId>/c<i>` (async job state and result chunks).
  - Regwatch cell: `ITEM/<collected_at>#<id>`, `ITEMID/<id>`, `URL/<url>` (dedupe guard), `REVIEW/<item_id>`, `SOURCE/<id>`, `PROMPT/<name>#v<NNNN>`, `NOTE/<created_at>#<id>`, `NOTEID/<id>` — application data that has not yet been promoted to facts.
  - Run cell: `JOB#<jobId>/v1`.

This is operational — and a design tension: rows that stay on the cell's table are invisible to the reef. They cannot be linked, salience-ranked, day-logged, or projected without an explicit emit.

#### 7.x.3 The 400KB item cap and the chunking pattern

DynamoDB caps a single item at 400KB. When a cell stores blob-shaped output that may exceed this (e.g. base64-encoded images), it MUST chunk across sibling rows under the same partition. The reference pattern (`cells/models/index.ts`):

- Use `pk: JOB#<jobId>` for both the envelope (`sk: v1`) and the chunks (`sk: c0`, `c1`, …).
- A conservative chunk budget of 300 KB of payload per row leaves headroom for attribute names, the JSON envelope, and DDB overhead.
- Record the `chunks` count on the envelope row; the read path concatenates `c0..c<chunks-1>` to reassemble. Anything materially larger than this should go to S3 (see `docs/cell-storage-s3.md`) with a pointer on the row, not a multi-megabyte chunked DDB blob.

#### 7.x.4 TTL strategies (and the table-config gap)

DynamoDB TTL is OPT-IN at the table level. The current `cell-template.ts` provisions the table without a `TimeToLiveSpecification`, which means a `ttl` attribute written by cell code is a no-op until TTL is enabled out-of-band. The spec MUST either:

- require the cell template to enable TTL on the `ttl` attribute (the recommended fix — cells already write `ttl` consistently); or
- declare TTL is per-cell out-of-band and document the operational consequence.

Observed retention strategies (treat as defaults the spec endorses, not hardcoded values):

- Short job retention (1 hour): models cell `JOB#` envelopes and `c<i>` chunks; run cell `JOB#` envelopes. Async-job state is ephemeral; the durable outcome is the substrate fact emitted on success, not the row.
- Per-artifact natural expiry: auth cell's `CHAL#`, `SESS#`, `TOKEN#`, `USERTOK#`, `DEVUC#`, refresh-token rows — `ttl` is computed from the artifact's `expiresAt`.
- Indefinite: regwatch's `ITEM`/`REVIEW`/`SOURCE`/`PROMPT`/`NOTE` rows have no TTL; the cell is the application's durable store until items are promoted to facts.

#### 7.x.5 Promotion: when cell-private state should become substrate facts

A cell starts as an organ — code with private rows. The spec endorses the "organ-not-reef" promotion ladder (cf. `docs/regwatch-port.md` §7) and identifies the signals that say a cell is overdue to promote state to facts:

1. The cell's data wants to be linked, projected onto home/attention/tend, or appear in salience — but is invisible because rows are not facts.
2. The cell's actions are simple enough to express as declared writes (CEL guard + write footprint) rather than imperative tool code.
3. A second principal needs structured access to a subset of the data with attribution and history — and the cell's row schema cannot express per-principal versioning (e.g. one-row-per-item REVIEW collapses to "latest reviewer wins").
4. The cell-private vocabulary is not discoverable: home/attention/tend cannot show it without a bespoke projection.

The promotion path is incremental and non-destructive:

1. Cheap reef projection: emit summary facts (`<cell>/inbox-count`, stub facts per important row linking back to the cell) through the organ event path so the cell surfaces in home/attention/tend without changing its storage.
2. Per-principal history: rekey shared rows (e.g. `REVIEW/<id>#<principal>`) before a second principal arrives.
3. Demote actions to declared vocabulary: replace imperative tool calls with declarative actions over fact targets (gated on write-through grants landing).
4. Items as facts: the full promotion — the cell becomes an ingest-only organ writing typed facts; surfaces become registered views; the dashboard becomes a themed projection.

#### 7.x.6 Design rules for cell authors

Cell authors MUST:

- Treat their per-cell table as private organ scratch, not as a place to hide platform state. If the data wants to be seen by other cells or surfaces, emit it as a fact.
- Never attempt cross-table writes (the IAM policy will deny them). Substrate writes go through the event path with `Source` IAM-pinned to the cell.
- Chunk any value that may exceed ~300 KB across `pk-shared/sk-numbered` rows or punt to S3; do not assume a single-row write will succeed for arbitrary payloads.
- Write a `ttl` attribute on any row that is ephemeral, and assume the platform enables TTL on that attribute; design cell logic to tolerate row absence after the TTL window.
- Prefer write-only patterns for credentials and other secrets (no readback path), and rely on IAM-scoped reads as the only barrier — the table itself does not encrypt at the row level.

### 7.7 WebAuthn passkey ceremonies (concrete)

The auth cell exposes four routes — `POST /webauthn/{register,authenticate}/{options,verify}` — implemented over `@simplewebauthn/server` and backed by the `AuthStore` interface (DynamoDB in prod, in-memory for tests/local). Cryptographic correctness is delegated to the library; the substrate's responsibility is to pin the right RP id and origin set, persist challenges and credentials with the right shape, and prevent cross-cell passkey theft.

**RP ID resolution (`rpIdOf`).** The RP id is the *registrable-suffix-collapsed* hostname. When `WEBAUTHN_RP_ID` (e.g. `parc.land`) is configured, any request whose `hostname` equals it or ends with `.{rpId}` collapses to that stable value; everything else passes through as the bare hostname. This collapse is what gives passkeys portability across `*.parc.land` cells: a passkey registered on `home.parc.land` can be asserted from `alice-notes.on.parc.land` because both resolve to RP id `parc.land`.

**Origin pinning (`allowedOrigins`) — the asymmetric defense.** Because `parc.land` is a registrable suffix of every cell host, a hostile cell subdomain could otherwise mount a WebAuthn ceremony the browser would happily complete (the browser only enforces RP id ⊆ origin's registrable domain). The substrate MUST therefore pin `expectedOrigin` to a *shell allowlist* — the union of `PUBLIC_BASE_URL` (the shell origin) and `WEBAUTHN_EXPECTED_ORIGINS` (comma/space-separated extras: apex/www/CloudFront bootstrap variants). Cell subdomains MUST NOT appear on this list and are rejected at verify time. When neither env var is set, the verifier falls back to the request origin (local/bootstrap convenience). The asymmetry is deliberate and load-bearing:

| Surface | Scope | Mechanism |
|---|---|---|
| Credential portability (RP ID) | Any `*.<rpId>` host | `rpIdOf` registrable-suffix collapse |
| Ceremony execution (origin) | Shell origin(s) only | `allowedOrigins` explicit allowlist |

This pairing — portable credential, pinned ceremony — is the substrate's primary anti-phishing posture for cells. See cell-origin-isolation.md §4.4.

**Registration ceremony (`/webauthn/register/{options,verify}`).**
1. `options`: validate `username` against `^[a-z0-9]+$` and length 1–64 (it becomes the owner segment of `<owner>-<cell>.on.parc.land`; the host→cell rewrite splits on the first hyphen, so hyphens are reserved). Reject duplicates with 409. Mint `userId = uuid`, resolve `rpId = rpIdOf(req)`, call `generateRegistrationOptions({ rpName, rpID, userName, userID, attestationType: 'none', authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' } })`. Persist `{challengeId, options.challenge, type: 'registration', userId}` with `CHALLENGE_TTL_MS = 5 min`. Return `{options, challengeId, userId, username}`.
2. `verify`: load challenge by id; reject if missing/expired/wrong-type. Call `verifyRegistrationResponse({ expectedChallenge, expectedOrigin: allowedOrigins(req), expectedRPID: rpId })`. On success, persist the user, persist the credential capturing `{id, userId, publicKey, counter, transports, deviceType, backedUp, rpId}`, delete the challenge, mint a session, emit `auth.user.registered`.

**Authentication ceremony (`/webauthn/authenticate/{options,verify}`).**
1. `options`: if `username` provided, look up user and call `getCredentialsByUserId(user.id, rpId)` to seed `allowCredentials` (id + transports only — see "by-user index" invariant below). Call `generateAuthenticationOptions({ rpID, userVerification: 'preferred', allowCredentials })`. Persist challenge with `type: 'authentication'`. Return `{options, challengeId}`.
2. `verify`: load challenge; load credential by `response.id` via `getCredentialById` (the *full* record at `CRED#{id}`). Call `verifyAuthenticationResponse({ expectedChallenge, expectedOrigin: allowedOrigins(req), expectedRPID: rpId, credential: { id, publicKey, counter, transports } })`. On success, write back the new counter via `updateCredentialCounter` and mint a session. Counter rollback / replay detection is delegated to `@simplewebauthn/server` (which throws when the asserted counter is ≤ stored counter). The substrate's only counter-related responsibility is to persist the new value monotonically.

**Persistence shapes.**
- Challenge: `pk=CHAL#{id}, sk=fixed`, attrs `{id, challenge, type ∈ {registration, authentication}, userId|null, expiresAt, ttl}`. TTL = `CHALLENGE_TTL_MS = 5 minutes`. DDB native TTL drops the row server-side; `getChallenge` also gates on `isExpired` so a row that has not yet been swept still reads as expired.
- Credential (primary record): `pk=CRED#{id}, sk=fixed`, attrs `{id, userId, publicKey: b64url, counter, transports?, deviceType?, backedUp?, rpId?}`.
- Credential (by-user index): `pk=USER#{userId}, sk=CRED#{id}`, attrs `{id, userId, transports?, rpId?}` — **no public key, no counter**.

**Critical invariant — the by-user index is enumeration-only.** `getCredentialsByUserId` returns `{ id, transports, rpId, publicKey: new Uint8Array(), counter: 0 }` from the index rows. These records MUST be used only to populate `allowCredentials` (where the verifier consumes only `id` and `transports`). Handing them to `verifyAuthenticationResponse` would silently disable signature verification (zero key, zero counter ⇒ counter-rollback check is also defeated). The verify path MUST therefore re-fetch the full record via `getCredentialById`. The in-memory store happens to return full records from this call, which can mask divergence in tests; implementers SHOULD treat the dynamo-store contract (stub records) as canonical, or split the API into `listCredentialDescriptorsByUserId` (enumeration) vs `getCredentialsByUserId` (full).

**rpId filtering and the credential portability boundary.** `getCredentialsByUserId` filters index rows by `rpId === requestRpId || rpId == null`. The `null` clause is a legacy escape for credentials saved before the column existed; new writes always stamp the registrable-suffix-collapsed `rpId`. Strict equality is correct *iff* every registration resolves through `rpIdOf` (which it does — see registration ceremony, step 1). Implementations MUST NOT register a credential under a non-collapsed hostname when `WEBAUTHN_RP_ID` is set, or those credentials will be invisible to subsequent `allowCredentials` lookups from sibling hosts.

**Configuration (env).**
- `WEBAUTHN_RP_ID` — stable RP id (e.g. `parc.land`). Unset ⇒ per-request hostname (local/bootstrap).
- `PUBLIC_BASE_URL` — canonical shell URL; its `protocol://host` is the primary `expectedOrigin`.
- `WEBAUTHN_EXPECTED_ORIGINS` — comma/space-separated additional origins permitted to complete ceremonies (apex/www/CloudFront variants).
- `SERVER_NAME` — passed through to `rpName` in registration options.

**Library boundary.** `@simplewebauthn/server` owns: challenge encoding, attestation parsing, COSE key handling, signature verification, and signature-counter monotonicity. The substrate owns: RP id collapse, origin allowlist, challenge/credential persistence, and the by-user/by-id storage split. The WebAuthn module is intentionally excluded from unit tests (no native/ESM dependency required); coverage is via integration tests against the in-memory store.

## 8. Lifecycle of a Cell

Authoring → packaging → deployment → invocation flows entirely through forge (`services/cells/`).

1. **Author.** Through the gateway's `act('cells.create', {name, code})` — or, for authenticated users, via `cells.writeFile`/`replaceInFile`/`appendToFile`/`importSrc` for multi-file editing. Source lands in `cells/<cellId>/src/<path>` in the `CodeBucket`. Path safety enforced by `cleanPath`. `cellId = slugify(name) + '-' + sha256(owner:slug).slice(0,8)`. The registry record (`pk=CELL#<cellId>`) is created with `status: CREATING`, plus an `OWNER#<owner>` index row.

2. **Package.** `cells.deploy` (or `writeFile {deploy:true}`) records `phase: DEPLOYING` and emits `cell.deploy.requested` (`source: cells`) on the platform event bus. The `CellDeployRoute` in `lib/platform-stack.ts` routes the event back to forge — moving heavy bundle work off the synchronous request path. `onDeployRequested` runs `transpileCell` / `bundleFiles` (esbuild-wasm with the server-bundled allowlist `react`/`react-dom`/`scheduler`, esm.sh-resolved deps cached at `/tmp/cell-dep-cache`), reads `client/imports.json`, `types.json`, `ssr.json` manifests, produces `cells/<cellId>/build/<version>.zip`, then writes terminal `phase: DEPLOYED|FAILED` to the registry. (See §9.7 for full deploy-pipeline operational semantics.)

3. **Deploy.** A per-cell CloudFormation stack `cell-<cellId>` (`services/cells/cell-template.ts`) provisions: an IAM role with `cell-<cellId>` name and the platform `permissionBoundary` attached (Forge's `iam:CreateRole` is conditioned on this exact ARN); inline policies for own-table CRUD, own-log-group writes, `events:PutEvents` pinned to `events:source = cell-<cellId>`, optional `SubstrateOwnScopeRead` with `dynamodb:LeadingKeys` over the owner's substrate partitions; a per-cell DynamoDB table (`pk`/`sk`, PAY_PER_REQUEST); a Lambda function (`cell-<cellId>`, nodejs20.x, the bundled artifact, env: `CELL_ID`, `CELL_OWNER`, `SERVICE_NAME`, `TABLE_NAME`, `EVENT_BUS_NAME`, optional `SUBSTRATE_TABLE`). `OnFailure: DELETE` so failed creates don't leak resources. The registry transitions to `status: ACTIVE`. A reconciliation invariant (`getCell`/`listCells`) refreshes status only for non-terminal records.

4. **Invoke.** Three paths, all gated by `authorizeAccess(record, user, tool?)` (owner OR full grant OR per-tool grant matching) on every call:
   - **HTTP via dispatch.** Browser hits `/@<owner>/<name>(/<rest>)?` (apex) or `<owner>-<name>.on.parc.land` (rewritten to `/@<owner>/<name>`). Dispatch resolves the cell, runs `ssr.json` reads as the caller (allowlisted to `SSR_READ_TARGETS`) and shapes them into `event.ssrData`, calls `cells.call` with `x-cell-caller`. The cell renders, optionally returns `x-parc-writes`; dispatch applies via `applyCallerWrites` with the three guards from §3.4.
   - **MCP via gateway.** `act('@<owner>/<cell>.<tool>', input)` resolves through `cells.describeCellTools`/`callCellTool`. Per-tool grants narrow further; non-owner callers see a `disclosure` block (declared reads, declared writes, cross-slice intent) attached to catalog entries.
   - **Direct invoke (peer cells).** Mode-1 `serviceClient` from a tier-1 cell holding `caller.allow(target)`; identity propagates via `CommandEnvelope`. Used for `workspace.allow(cells)`, `gateway.allow(cells)`, etc.

   Cells emit substrate writes via `substrate.write.requested` events with `events:source` IAM-pinned; the workspace organ-write handler resolves owner through the registry and applies the write in the owner's slice with attested provenance. Cells with `persistence: { dynamo: true }` write to their own table directly.

   On `cells.delete`: registry `status: DELETING` → forge tears down the per-cell CFN stack (DynamoDB table, IAM role, Lambda function vanish atomically). Source remains in the `CodeBucket` until explicit cleanup. Owner-only.

Promotion path (tier-2 → tier-1): a userland cell graduates by moving its declaration into `lib/platform-stack.ts` as an `HttpServiceCell`. Runtime-provisioned and CDK-declared resources are intentionally identical, so isolation guarantees survive promotion unchanged.

## 9. Operational Subsystems

### 9.7 Cell deploy pipeline (CellDeployRoute) operational semantics

`cells.deploy` (and every fused `deploy:true` edit — `writeFile`/`replaceInFile`/`appendToFile`) MUST run the bundle off the synchronous request path. The control flow is:

1. **Request side.** `requestDeploy` SHALL:
   - Mint `version = Date.now().toString()`.
   - Persist `deploy = { phase: 'DEPLOYING', version, requestedAt: ISO8601 }` to the registry record (blind `UpdateExpression`; no conditional-write fence).
   - Emit `cell.deploy.requested { cellId, owner, name, version }` on the platform bus with source = `"cells"`.
   - Return synchronously to the caller with the `DEPLOYING` marker and instruction to poll `cells.get`.

2. **Routing.** A single EventBridge rule `CellDeployRoute` SHALL deliver matching events to the forge Lambda:
   - `eventPattern.detailType = ["cell.deploy.requested"]`
   - `eventPattern.source` MUST be a `prefix` match on `"cells"` (the literal forge service name). This is a security boundary: dynamic cells emit with IAM-pinned source `cell-<id>`, which `prefix("cells")` does not match (the `-` separator breaks the prefix). Forge therefore consumes only its own emissions; a dynamic cell cannot forge a deploy request for itself or anyone else.

3. **Worker side (`onDeployRequested`).** Upon delivery, forge SHALL:
   - Re-load the registry record by `cellId` from the event detail; ignore the event's `version` field (it is not load-bearing — see Idempotency).
   - List `cells/<cellId>/src/` on S3 and bundle the **latest** source tree (server bundle via `bundleFiles`, optional client bundle via `bundleClientFiles` if a `client/main.{ts,tsx}` exists, plus verbatim `static/*` files).
   - Mint a *new* `version = Date.now()` for the resulting package (distinct from the request's version).
   - Upload the package, call `updateFunctionCode` against the cell's Lambda, and emit `cell.deployed` with the worker's version.
   - Persist terminal phase: on success, `deploy = { phase: 'DEPLOYED', version: <worker's version>, requestedAt }`; on caught error, `deploy = { phase: 'FAILED', version: <request's version>, requestedAt, error: <Error.message> }`.

#### 9.7.y Delivery, idempotency, and retry semantics

- **At-least-once delivery.** EventBridge → Lambda async invocation is at-least-once. If `onDeployRequested` throws, AWS Lambda retries the asynchronous invocation per its async-retry policy (default: up to 2 additional attempts with backoff). No dead-letter queue or `onFailure` destination is configured at the rule or function level today; persistent failure after the retry budget is silently dropped from the bus side, and is observable to the caller only via the registry's terminal `FAILED` phase (set by the *last* attempt that reached the `catch` branch).
- **No content-pinned idempotency.** The worker does not consult `detail.version`; redelivery of the same event re-bundles from whatever is in S3 *now*. Implication: a redelivery after a subsequent `writeFile` will deploy the newer source, not the source that existed at original request time. The version stamped on the resulting package is the *worker's* `Date.now()`, so successful redeliveries produce monotonically increasing package versions.
- **Concurrent deploys for the same cell are not serialized.** Two `cells.deploy` calls in rapid succession both transition `deploy.phase` to `DEPLOYING`, both fan out as separate worker invocations, both bundle, and both call `updateFunctionCode`. The terminal `setDeploy` write is last-writer-wins, and may not correspond to the bundle that AWS ultimately serves. Authors who require ordered deploys MUST wait for `phase ∈ {DEPLOYED, FAILED}` before issuing the next `deploy`.
- **Multiple `cell.deployed` emissions per logical deploy are possible.** `cell.deployed` is emitted *inside* `deployCell`, before the terminal `setDeploy`. A successful first attempt followed by a redelivery (e.g. due to a downstream timeout in the registry write) emits `cell.deployed` twice with two different versions. Subscribers (notably the workspace projection of cell pointer facts) MUST be idempotent on `(cellId, version)`.

#### 9.7.z Failure surfacing

- Failure is **pull-only**: callers poll `cells.get` and observe `record.deploy.phase = 'FAILED'` with `error` carrying the throwing exception's message. Common error shapes:
  - `Cell source failed to bundle: <esbuild diagnostic>` (compile error in user code).
  - `Cell client failed to bundle: <esbuild diagnostic>` (client-bundle error).
  - `dependency fetch <esm.sh URL> → <status>` (esm.sh outage or 404 on a declared dep).
  - `client/imports.json is not valid JSON` (bad import map).
- There is **no `cell.deploy.failed` bus event** in the current contract. (Adding one is a forward-compatible extension; until then, push-side observers cannot distinguish "deploy in flight" from "deploy permanently failed" without polling.)
- An esm.sh outage manifests as a `dependency fetch …` error on the *first* uncached fetch; subsequent attempts hit `/tmp/cell-dep-cache` *only* if the prior fetch succeeded for that pinned URL on the same warm container. There is no negative caching and no exponential backoff inside `fetchCached`.

#### 9.7.w Resource budget and dependency cache

- The forge Lambda is provisioned with `memorySize: 512` MiB and `timeoutSeconds: 120`. A single bundle attempt (cold cache: esm.sh fetches for every declared dep, then `bundleFiles` server pass, then `bundleClientFiles` client pass, then `uploadPackage` to S3, then `updateFunctionCode`) MUST complete within 120 s; exceeding this surfaces as a Lambda timeout, which is treated as a transient async failure and retried per §9.7.y.
- The dependency cache lives at `${os.tmpdir()}/cell-dep-cache/<sha1(url)>` (i.e. Lambda `/tmp`, 512 MiB, per-execution-environment). It survives **warm** invocations of the same forge container and is wiped on cold start. Cache entries have no TTL and no integrity check beyond URL identity; cache key is `sha1(esm.sh URL)`, and the URL embeds the dep version, so a version bump produces a fresh key (stale entries simply leak until container recycle). Write failures (e.g. `/tmp` full) are swallowed and the bundle proceeds uncached.

#### 9.7.v `SERVER_BUNDLED` allowlist (`react`, `react-dom`, `scheduler`)

- Bare imports inside a cell's server bundle are externalized by default (provided by the Lambda runtime — node builtins, the bundled `@aws-sdk`). The hard-coded allowlist `SERVER_BUNDLED = { 'react', 'react-dom', 'scheduler' }` is the exception: these names resolve via `require.resolve` against **forge's own** `node_modules`, and esbuild inlines them into the cell's `index.js`.
- The packages physically exist in forge's deployment artifact via `lib/platform-stack.ts` `bundlingNodeModules: ['esbuild-wasm', 'react', 'react-dom']` (`scheduler` is a transitive of `react-dom`, picked up by Node resolution). The choice to ship them in forge — rather than fetch them from esm.sh like every other declared dep — is deliberate:
  1. **Hydration consistency.** The cell's *client* bundle keeps `react`/`react-dom` external and the browser fetches them from esm.sh at the version pinned in `client/imports.json`. The *server* bundle binds React from forge's installed copy. SSR `renderToString` output hydrates without flash only when those two versions agree, so cell authors MUST pin `client/imports.json` to forge's installed React version. (This coupling is currently undocumented and brittle across forge upgrades — open: either expose forge's pinned versions to cells via `cells.describeRuntime`, or move React to esm.sh on the server too.)
  2. **Supply-chain narrowing.** The SSR path runs author code with platform credentials adjacent to it (the cell's IAM role); pinning React to a forge-installed, audited version reduces the per-deploy attack surface on the SSR critical path.
- Adding a package to `SERVER_BUNDLED` requires both an entry in the `Set` literal in `services/cells/transpile.ts` **and** an entry in `bundlingNodeModules` in the forge cell construction — the allowlist is not configuration; it is code, and changing it requires a forge redeploy.

#### 9.7.u Open issues to track

1. **No idempotency key on the deploy request.** A redelivery does not know which logical request it is satisfying. Recommended: include `version` in the consumer's contract — either dedupe on `(cellId, version)` against the registry's current `deploy.version`, or record a `deploy.attemptId` and skip redeliveries whose attemptId is already terminal.
2. **No DLQ or `cell.deploy.failed` event.** A persistent failure after the async-retry budget is invisible to push subscribers. Recommended: wire an `onFailure` SQS DLQ on the cells function (or a dedicated EventBridge rule target), and emit `cell.deploy.failed { cellId, version, error }` from the worker's `catch` block in addition to the registry write.
3. **No serialization across concurrent deploys.** Recommended: a conditional `setDeploy` that fences on the prior `version` (write-if-version-matches), or a per-cell deploy lease.
4. **Hidden React-version coupling.** See §9.7.v(1). Either expose forge's installed React versions through a discovery command or move all server deps to esm.sh.

## 11. Asynchrony model

The substrate runs on Lambda Function URLs behind CloudFront. The CloudFront → Function-URL edge caps every synchronous round trip at **~30 seconds** (origin read timeout) and does not hold response streams on the URL path today. This is not a tunable: raising the Lambda timeout (`cells.configureCell`, clamp 10–300s) lets a single invocation run longer, but the edge will still 502 while the work completes silently behind it.

This single constraint is the forcing function behind several architectural choices that are otherwise scattered across §4.4 (MCP transport), §3.4 (the gateway), §5 (the userland cells), and §4.3 (the change feed). This section gathers them.

### 11.1 What MCP server→client features are deliberately absent

The MCP spec (2025-06-18) defines a Streamable-HTTP transport in which the client opens a long-lived GET/SSE stream alongside its JSON-RPC POSTs. A Lambda Function URL cannot hold that stream. The substrate's `defineMcpService` therefore exposes only the request/response leg of the transport, advertises `capabilities: { tools: {} }` in `initialize`, and **does not implement** the following spec features:

| Feature | Spec method / capability | Substrate substitute |
|---|---|---|
| Resource subscriptions | `resources/subscribe`, `notifications/resources/updated` | `workspace.changes(sinceSeq)` polling |
| Tool list aliveness | `tools.listChanged`, `notifications/tools/list_changed` | Catalog-as-data — `read("$catalog")` is always live; three meta-tools (`whoami`/`read`/`act`) so a new capability never requires a `tools/list` refresh |
| Progress | `notifications/progress` | Job records (`{phase|status, version, requestedAt, error?}`) read with `cells.get` / `<cell>.fetch` |
| Cancellation | `notifications/cancelled` | None — async jobs run to terminal status; cancellation is deferred |
| Sampling (server→client model calls) | `sampling/createMessage` | Models cell with co-located provider keys; the substrate does not ask the client's model to do work |
| Roots | `roots/list`, `roots/list_changed` | Not applicable — the substrate's "roots" are `parc://<owner>/<key>` and discovered through `read("$catalog")` |
| Logging notifications | `notifications/message` | CloudWatch + `cells.logs` tool |

These are **architectural absences**, not gaps to be filled at the existing layer. They will only return as outbound notifications if the transport moves (§11.5).

### 11.2 The change feed: substrate-native subscription substitute

Every slice exposes a monotonic event log via `workspace.changes`:

- `read("workspace.changes", { sinceSeq: "head" })` returns `{events: [], seq: N}` — the current head, in one round trip, to bootstrap a tail cursor.
- `read("workspace.changes", { sinceSeq: N, limit })` returns events with `seq > N` plus the new head, so a poller advances and resumes idempotently.
- Event ops are `write | read | supersede | link`, all keyed in the slice's namespace.

This is the substitute for `notifications/resources/updated`. It is also the actual primitive every client uses — dispatch's SSR bootstrap, the home and canvas client UIs, and the canvas CRDT remote-merge poller all read it. The polling cost is bounded (a single keyed query) and the cursor is durable (a `seq` number), so a client can disconnect, reconnect, and pick up exactly where it left off — properties an SSE stream does **not** give you.

### 11.3 The canonical async pattern

Three substrate components do work that exceeds the edge cap. They converge on one shape:

```
caller → tool: returns a marker {phase|status: pending, id, factKey?}
              ↓ writes a pending record (registry / JOB#)
              ↓ schedules the long work, then returns
                 (a) emit an EventBridge event routed back to self, or
                 (b) lambda:InvokeFunction Event-type on the cell's own ARN
                 ─ peers stay mediated through the gateway; self-invoke is
                   the narrowest possible IAM grant ─
[asynchronously] long work runs, writes terminal {phase|status: done|failed, …}
caller → poll  read/<tool>.fetch / cells.get → terminal state
```

Concrete instances:

| Instance | Marker store | Dispatch | Terminal write | Caller polls |
|---|---|---|---|---|
| `cells.create` | registry record `status: CREATING` | EventBridge `cell.create.requested` (CloudFormation does the work) | `reconcileStatus` maps stack status to `ACTIVE`/`FAILED` on read | `cells.get` |
| `cells.deploy` | registry `deploy.phase: DEPLOYING` | EventBridge `cell.deploy.requested` routed back to forge | `onDeployRequested` writes `DEPLOYED`/`FAILED` with `version`/`error` | `cells.get` |
| `models.run async`, `models.agent`, `run.exec async` | DDB `JOB#<id>` row in the cell's own table | `lambda:InvokeFunction` Event on cell's own ARN with `{__job}` payload | Self-invocation runs the work and writes `{status: done|error, …}` | `<cell>.fetch({jobId})` |

Two reliability rules are encoded in the implementation and SHOULD be carried forward by any new async tool:

- **`removeUndefinedValues` on the DocumentClient.** A successful job result legitimately carries undefined fields; without this option the marshaller's failure masks the real result and the caller sees DynamoDB advice instead of their work.
- **A persistence failure must not impersonate the work.** If the result computes but the save fails, the job's `error` field is prefixed `failed to persist result: …` so the user is not told their Fibonacci function returned a marshaller error.

Results that exceed DynamoDB's 400KB item cap chunk into `c0..cN` rows at 300KB per chunk and reassemble at `fetch` time. This is the async-substrate equivalent of streaming a multi-MB response.

### 11.4 Sync vs async budget

The platform exposes three nested ceilings:

| Ceiling | Value | Source | Implication |
|---|---|---|---|
| Edge synchronous round trip | ~30s | CloudFront origin read timeout | Any tool call that **may** take >30s MUST be async. |
| Cell Lambda timeout | 10–300s (default 10) | `cells.configureCell`, clamp `[10, 300]` | Useful only for fire-and-poll work *inside* the async leg. >30s helps the work finish, never the synchronous response. |
| DynamoDB item size | 400KB / 300KB chunks | DDB hard limit / `CHUNK` constant | Async results > 300KB chunk; the change feed and registry rows stay well under. |

A tool author SHOULD answer four questions before exposing a synchronous handler:

1. Is the worst-case latency comfortably under 30s on a cold start? (Edge time, not Lambda time.)
2. Is the response payload bounded under ~6MB (Lambda response cap) and under ~1MB request bodies (edge OAC cap, see `putData{presign:true}` for the workaround)?
3. Does the work need to be observable in flight? If yes, write progress to the change feed (a `progress/<id>` fact) instead of relying on `notifications/progress`.
4. Does it need cancellation? If yes, defer — there is no cancellation primitive; design the work to be re-runnable instead.

If the answer to (1) or (2) is no, the tool MUST follow §11.3.

### 11.5 Migration: when (or if) a long-stream-capable transport lands

Candidate transports are API Gateway WebSocket, AppSync subscriptions, or non-Lambda compute (Fargate/ECS) terminating CloudFront. The migration is intentionally additive:

1. **Enable inbound stream**: add a `GET /mcp` handler in `defineMcpService` returning an SSE stream keyed by the client's session id; keep the POST leg unchanged.
2. **Advertise added capabilities** in `initialize`: `resources: { subscribe: true, listChanged: true }`, `tools: { listChanged: true }`, `prompts: { listChanged: true }`, `logging: {}`.
3. **Bridge from change feed to notifications**: a server-side fan-out reads the slice's `workspace.changes` cursor and emits `notifications/resources/updated` for `parc://<owner>/<key>` URIs the client subscribed to. The change feed remains the source of truth — streaming is the projection.
4. **Bridge from registry phases to progress**: `cells.deploy` and the cell async jobs already publish phase transitions; emit `notifications/progress` from those transitions instead of (in addition to) requiring a poll on `cells.get` / `fetch`.
5. **Catalog deltas**: emit `notifications/tools/list_changed` on `cell.deployed`, `cell.shared`, `cell.delete.requested`, and the meta-tool catalog rebuild. The three-meta-tool surface stays — this just removes the catalog-staleness mitigation that is its current cost.

Three things do **not** migrate:

- The change feed itself remains the substrate's spine; streaming is a projection of it, not a replacement. Durable cursors, replay, and reconnect-without-re-bootstrap are properties of polling that streaming does not give you.
- The self-invoke / EventBridge-routed JOB pattern remains for any unit of work that exceeds the request handler's natural lifetime (model loops, large bundles, CFN deploys). "Async by construction" is a property of "facts by construction" and outlives the transport.
- Sampling stays out. The substrate's executor tier (`@c15r/models`) holds provider keys co-located with the code that spends them; routing model calls back to the client violates that custody model.

### 11.6 Open question

Cancellation. With no held stream there is no `notifications/cancelled` to receive, and DDB job rows do not currently surface a "cancel requested" flag. For long agent runs the budget today is purely the per-run `maxTurns` and per-call `maxTokens` clamps. A future increment should add a `cancelRequested: true` flag on the JOB# row, polled by the worker between turns; this is independent of transport and does not require streaming to land.
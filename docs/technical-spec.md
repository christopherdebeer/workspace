# parc.land Substrate — Technical Specification

> Audience: an engineer implementing or extending a cell, or maintaining the runtime.
> Status: reflects the codebase at `/Users/cdbeer/dev/workspace`. All claims are backed by the 26 module cards.

---

## 1. Runtime Contract

The runtime is an in-Lambda library that hosts cell execution. Every cell is a Lambda function whose handler is produced by `defineService` (or its MCP-aware sugar `defineMcpService`) from `platform/runtime`. The runtime multiplexes three event shapes into one entry point and bundles per-request capabilities into a `ServiceContext`.

### 1.1 Entry Signature

`platform/runtime/define-service.ts` exposes:

```ts
defineService(definition: ServiceDefinition): LambdaHandler & { manifest: ServiceManifest };

interface ServiceDefinition {
  name: string;
  version?: string;
  commands: Record<string, CommandHandler>;
  events?: { emits?: string[]; handles?: Record<string, EventBridgeHandler> };
  http?: HttpRoute[];
}
```

The returned handler has its computed `ServiceManifest` attached as a property (`handler.manifest`) for CDK synth and tests (`platform/runtime/index.ts` re-exports `ServiceManifest`/`ServiceRegistry`/`ManifestEvents` from `../manifest`).

### 1.2 Request Multiplexing

The handler inspects each invocation event and dispatches by shape:

| Shape | Detection | Path |
|---|---|---|
| **EventBridge** | has `detail-type` + `source` + `detail`, no `requestContext` | routed to `events.handles[detailType]` |
| **CommandEnvelope** (Mode-1 direct invoke) | has `__command` field | routed to `commands[__command]` |
| **Function URL HTTP** | otherwise | routed via `http[]` and the auto-implemented OpenAPI-style routes |

`CommandEnvelope` shape (carried on direct invokes, propagated by `service-client.ts`):

```ts
interface CommandEnvelope {
  __command: string;
  payload: unknown;
  correlationId?: string;
  user?: string;
  scopes?: string[];
  grantScopes?: string[];
  tokenId?: string;
}
```

Identity (`user`, `scopes`, `grantScopes`, `tokenId`) is propagated peer-to-peer; trust derives from the caller being in the registry (the peer was IAM-allow-listed via `cell.allow(target)`). The runtime does **not** re-validate the bearer on internal hops.

### 1.3 Auto-Implemented HTTP Routes

For every service, the runtime answers:

- `GET /<service>/_manifest` — manifest discovery
- `OPTIONS *` — `204` (CORS preflight)
- `POST /<service>/<command>` — JSON in, JSON out wrapped as `{ ok, result }`

Raw `http` routes (e.g. `/oauth/*`, `/.well-known/*`, `/mcp`) are matched first, with `*`-suffix prefix matching.

### 1.4 ServiceContext

Each command handler receives a `ServiceContext` carrying:

```ts
interface ServiceContext {
  identity: Identity;            // { user?, scopes[], grantScopes?, tokenId? }
  config: PlatformConfig;        // typed env access; never read process.env directly
  logger: Logger;                // structured single-line JSON to stdout
  events: Events;                // { emit(detailType, detail) } via EventBridge
  serviceClient: (target) => { command<T>(name, payload): Promise<T> };
  state?: ObservedState;         // substrate primitive (workspace cell)
}
```

This is the only public surface a cell author touches. A core tenet (`platform/CLAUDE.md`) is that **service authors never import the AWS SDK directly** — runtime exposes `events`, `serviceClient`, and a `StateStore` contract instead. See §1.9 for the full AWS SDK access policy.

### 1.5 Identity Resolution (`resolveHttpIdentity`)

For HTTP requests, the runtime materializes `Identity` exclusively from a validated `Authorization: Bearer` token:

1. Read bearer from `Authorization` or `X-Forwarded-Authorization` (because CloudFront OAC overwrites the literal `Authorization` with its SigV4 signature — see §6).
2. Call `auth.validateToken({ token })` over the service registry, **unless** `serviceName === AUTH_SERVICE_NAME` (default `'auth'`) — avoids recursion.
3. Materialize `{ user, scopes, grantScopes, tokenId }`. Anonymous identity is `{ user: undefined, scopes: [] }`.

**Cookie carve-out (load-bearing).** A `parc_session` cookie is honoured as a credential **only when**:

- `serviceName === 'dispatch'`, AND
- method ∈ `{GET, HEAD}`, AND
- `Sec-Fetch-Dest: document` (genuine top-level navigation).

This closes the CSRF surface for `/mcp` and mutations while letting a signed-in visitor's cell SSR without exposing the bearer to dynamic cells.

`identityFromHeaders` is currently dormant — kept for a future trusted-edge authorizer.

### 1.6 Lifecycle Hooks

The runtime has no formal `init`/`destroy` hooks. Lazy-initialization pattern is enforced for AWS SDK clients:

- `service-client.ts` and `events.ts` use lazy-require with `__setLambda(stub)` / `__setEventBridge(stub)` injectors for tests.
- `dynamo-state-store.ts` constructs `DynamoDB.DocumentClient` eagerly inside `createDynamoStateStore` (factory-as-seam — see §1.9).

### 1.7 Error Mapping

| Error | HTTP | Wire |
|---|---|---|
| `UnknownCommandError` | 404 | `{ ok: false, error }` |
| `ServiceAuthError` | 401 | with `WWW-Authenticate` for MCP |
| `StatePreconditionError` | (callers map) | `'precondition_failed'` → 409 |
| `ServiceInvokeError` | thrown by `serviceClient` on `ok:false` or FunctionError |

The command result envelope from a direct invoke is **always** `{ ok: boolean, result?, error? }`.

### 1.8 Environment

Consumed env vars (`platform/runtime/config.ts`):

- `SERVICE_NAME` (required)
- `SERVICE_REGISTRY` (JSON map of service → Lambda function name)
- `EVENT_BUS_NAME`, `TABLE_NAME`, `SUBSTRATE_TABLE`
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`
- `AUTH_SERVICE_NAME` (default `'auth'`)
- `PUBLIC_BASE_URL`, `MCP_CORS_ORIGIN_SUFFIX`, `LOG_LEVEL`

Cells that need typed config call `loadConfig() → PlatformConfig` and `getString(key, fallback?)`/`getOptional(key)`.

### 1.9 AWS SDK Access — Capability-Only, with a v2/v3 Platform/Userland Split

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

- **Platform + first-class services (this repo's `platform/`, `services/`):** AWS SDK **v2** (`aws-sdk@^2.1692.0`). Bundled into each Lambda's zip by `HttpServiceCell` (`platform/infra/http-service-cell.ts:111-122`) — `runtime: NODEJS_20_X` no longer ships v2 in the image, so `bundling: { externalModules: [] }` forces every dep into the artifact. Used in: `service-client.ts`, `events.ts`, `dynamo-state-store.ts`, `provisioner.ts`, `registry.ts`, `services/auth/dynamo-store.ts`.
- **Userland cells (`/cells/*`):** AWS SDK **v3** (`@aws-sdk/client-*`). The cell transpiler (`services/cells/transpile.ts:222,280`) marks `@aws-sdk` as `external`, expecting it provided by the Lambda runtime. v3 is also typically constructed eagerly at module scope in cells (e.g. `cells/models/index.ts:26-31`) because cell handlers are tiny and the lazy-singleton ceremony adds no value at userland scale.

When in doubt — code lives under `platform/` or `services/` → v2 + lazy + `__setX`; code lives under `/cells/` → v3 + eager top-level construction is acceptable.

#### Open migration risks

1. **Node 20 dropped bundled SDK v2.** Every platform/service Lambda already pays the bundle-size cost (`http-service-cell.ts:120-122`). When the runtime moves to Node 22+, or AWS removes v2 from npm, the seven v2 import sites above must migrate to `@aws-sdk/client-*` packages. The `__setX` seams insulate tests, but value-imports of `DynamoDB.DocumentClient.AttributeMap` and `AWSError` propagate types into call sites and need a v3 compatibility shim.
2. **Inconsistent injection seams.** `dynamo-state-store.ts` and `services/auth/dynamo-store.ts` rely on factory-as-seam while `services/cells/registry.ts` (an analogous case) exposes `__setDocumentClient`. The spec should pick one shape for new code and schedule retrofits.
3. **`@aws-sdk` external-by-default in cells** assumes the Lambda image continues to ship v3. If AWS narrows the bundled set, the transpiler's externalisation rule (`transpile.ts:280`) becomes a deploy-time hazard for userland cells; cells that name a `@aws-sdk/*` package must either move it into `imports.json` (esm.sh-bundled) or the cell loader must pin a v3 layer.

A new cell author MUST read this section before constructing any AWS client and SHOULD treat any direct `import … from 'aws-sdk'` or `import … from '@aws-sdk/...'` inside `platform/` or `services/` as a code-review red flag absent the lazy + `__setX` shape above.

**See:** `platform/runtime/index.ts`, `platform/runtime/define-service.ts`, `platform/runtime/auth.ts`, `platform/CLAUDE.md`.

---

## 2. Cell Manifest Format

A cell is described by three orthogonal manifests (every file optional, all data-driven). They are **not** a single `cell.json` — each governs a different facet.

### 2.1 `types.json` — Type Vocabulary Registration

Declares which substrate fact types this cell *manages* and how the platform's type-vocabulary resolver (`platform/ui/vocab.ts`) routes them.

Schema:

```ts
interface TypeDecl {
  manager?: string;                                  // e.g. "@c15r/lit"
  icon?: string;                                     // single grapheme
  label?: string;                                    // value-path expression
  handlers?: Partial<Record<Intent, TypeHandler | TypeHandler[]>>;
}

type Intent = 'open' | 'edit' | 'create' | 'render' | 'embed' | 'preview';

interface TypeHandler {
  path?: string;                                     // template, ${id}/${key}/${type}/${match}/${value.*}
  cell?: { owner: string; name: string };
  surface?: string;                                  // 'apex' | 'cell-host'
  act?: string;
  renderer?: string;
  hint?: 'markdown' | 'table' | 'feed' | 'metric' | 'form';
}
```

**Real example — `cells/canvas/types.json`:**

```json
{
  "canvas": {
    "icon": "🌲",
    "manager": "@c15r/canvas",
    "handlers": {
      "open":  { "path": "?canvas=${match}" },
      "embed": { "path": "?canvas=${match}&embed=1" }
    }
  }
}
```

**Real example — `cells/lit/types.json`:**

```json
{
  "doc":       { "icon": "📄", "manager": "@c15r/lit",
                 "handlers": { "open": { "path": "?doc=${match}" },
                               "edit": { "path": "?doc=${match}&edit=1" },
                               "render": { "hint": "markdown" } } },
  "doc-block": { "icon": "🧱", "manager": "@c15r/lit" },
  "doc-order": { "icon": "🔢", "manager": "@c15r/lit" }
}
```

**Real example — `cells/home/client/type-decls.ts` (the platform-owned `cell` type, default vocabulary).**

Resolver invariants (`platform/ui/vocab.ts`):

- Type-signal precedence: `_meta.type` > key prefix (`doc:foo` → `doc`) > each tag's prefix.
- `applyTemplate` URL-encodes `${id}/${key}/${type}/${match}` and inserts `${value.*}` raw.
- `applyTemplate` returns `null` if any placeholder is empty — the alternatives chain in `resolve` falls through to the next handler.
- `resolve` returns a structured `{ cellRef, path }`; the consumer (e.g. the kernel's `cellUrl`) materializes the origin.

See §2.5 for the full resolver runtime contract.

### 2.2 `ssr.json` — SSR Reads + Caller-Writes Manifest

Declares two arrays consumed at deploy time and persisted on the registry record:

```ts
interface SsrManifest {
  reads?: Array<{
    as: string;                  // key in event.ssrData
    target: string;              // <service>.<command>, must be in SSR_READ_TARGETS allowlist
    input?: Record<string, unknown>;
  }>;
  writes?: Array<{
    keyPrefix: string;           // e.g. "note:" or "shared/"
    types?: string[];            // optional type allowlist
    crossSlice?: boolean;        // requires recipient grant
  }>;
}
```

**Real example — `cells/home/ssr.json`:** declares 11 reads (`workspace.peek _home/layout`, `workspace.query`, `workspace.attention`, `workspace.views`, `workspace.edges`, `workspace.changes`, `cells.describeTypes`, `cells.list`, `auth.tokens`, `workspace.shared`, `workspace.grantRequests`).

**Real example — `cells/starter/ssr.json`:**

```json
{
  "writes": [
    { "keyPrefix": "note:", "types": ["note"] },
    { "keyPrefix": "shared/", "types": ["note"], "crossSlice": true }
  ]
}
```

`SSR_READ_TARGETS` is hardcoded in `services/dispatch/service.ts` (workspace reads + `cells.*` + `auth.tokens`). Write targets are refused regardless of grants. Caller-writes batch is capped at `MAX_CALLER_WRITES = 16`.

### 2.3 `client/imports.json` — Pinned ESM Bundling

Pins exact versions of npm modules so server SSR (Node target via esm.sh) and client (browser ESM externals) emit byte-identical output. Read by `services/cells/transpile.ts`. Allowlist of server-bundled modules: `react`, `react-dom`, `scheduler` (must live in forge's own `node_modules`).

**Real example — `cells/lit/client/imports.json`:** pins `react@18.3.1`, `react-dom@18.3.1`, `marked@12.0.2`, `xstate@4.38.3`, `d3-force@3.0.0`.

### 2.4 Tier-1 vs Tier-2 Manifests

- **Tier-1 cells** (`services/*`): the *manifest* is the `ServiceDefinition` argument to `defineService`, plus the CDK declaration in `lib/platform-stack.ts` (name, routes, persistence, allow-grants).
- **Tier-2 cells** (`cells/*`): the manifest is the per-cell `CellRecord` in the cells-registry DynamoDB table (see §8 — fields: `cellId`, `name`, `owner`, `grants[]`, `toolGrants{}`, `types[]`, `ssrReads[]`, `callerWrites[]`, `status`, `deploy{}`).

There is **no** `package.json` inside cell directories. The build/deploy system (forge — `services/cells/transpile.ts`) discovers files by convention (`index.ts`/`shared.tsx`/`client/main.tsx`/`static/index.html`/`types.json`/`ssr.json`/`client/imports.json`).

### 2.5 Type Vocabulary Resolution (`platform/ui/vocab.ts`)

`platform/ui/vocab.ts` is a *pure resolver runtime* — not just the manifest schema for `_types/<type>` facts. It is the one function every surface and agent shares to answer: "given this fact and an intent (`open` / `edit` / `create` / `render` / `embed` / `preview`), where does it go?" It is consumed at runtime by the home cell (`cells/home/client/app.tsx`) for routing fact lists, by the lit cell for embed/render, and is the migration target for the kernel client's pre-vocab `hrefOf` (`cells/kernel/client/main.ts:396-422`).

#### 2.5.1 Type-signal precedence

`typeSignals(fact)` (`platform/ui/vocab.ts:80-91`) emits signals most-specific first:

1. `_meta.type` paired with `match = deriveId(fact.key)` (the part after a `prefix:` or `prefix/` in the key, else the key itself).
2. The key prefix: `prefixOf(fact.key)` splits on the first `:` or `/` (whichever comes first); e.g. `doc:foo` yields `{type:"doc", match:"foo"}`, `inbox/x` yields `{type:"inbox", match:"x"}`.
3. Each `_meta.tags` entry's prefix in tag order; e.g. `canvas:slice` yields `{type:"canvas", match:"slice"}`.

`resolve(fact, intent, decls)` walks signals in this order and returns the first signal whose declaration produces a fully-templated handler. `declFor(fact, decls)` walks the same signals but ignores intent — it returns the governing `TypeDecl` for presentation (icon/label).

#### 2.5.2 `applyTemplate` placeholder semantics

`applyTemplate(tmpl, ctx)` (`platform/ui/vocab.ts:118-136`) substitutes:

| Placeholder       | Source              | Encoding                                |
|-------------------|---------------------|-----------------------------------------|
| `${id}`           | `deriveId(fact.key)`| `encodeURIComponent`                    |
| `${key}`          | `fact.key`          | `encodeURIComponent`                    |
| `${type}`         | the matched signal  | `encodeURIComponent`                    |
| `${match}`        | the matched signal  | `encodeURIComponent`                    |
| `${value.<path>}` | `pathInto(fact.value, path)` then `String(v)` | RAW (no encoding) — these are often full addresses |

If any placeholder substitutes empty (missing/null/empty-string), the function returns `null` and that handler is treated as inapplicable.

#### 2.5.3 Fall-through chain

`decl.handlers[intent]` may be a single handler or an ordered array (`asList`, `vocab.ts:138`). On a `null` from `applyTemplate`, `resolve` proceeds to the next handler in the array, then to the next type signal. This is how alternatives like `capture → [day-log-when-dated, input-cell-otherwise]` work without imperative branching:

```ts
capture: { handlers: { open: [
  { surface: '/@c15r/lit?doc=log:${value.captured}' }, // resolves only when value.captured is set
  { surface: '/@c15r/input' },                          // fallback
] } }
```

#### 2.5.4 `declFor` vs `resolve`

| Function   | Returns          | Used for                                                                       |
|------------|------------------|--------------------------------------------------------------------------------|
| `declFor`  | `TypeDecl \| null` | Presentation metadata (icon, label) where no intent is involved (`typeIcon`, `factTitle`) |
| `resolve`  | `TypeHandler \| null` | Intent routing (`open` / `edit` / `create` / `render` / `embed` / `preview`) — handler returned with templates already substituted |

#### 2.5.5 `cellRef` and origin-aware materialization

Handlers declare a *cell-relative* `path` (preferred form). The cell is implicit (`decl.manager`) unless the handler overrides with `cell: 'owner/name'` or `cell: '/name'` (inherits manager's owner). `resolve` parses that into `cellRef: {owner, name}` via `parseCellRef` (`vocab.ts:144-152`) and returns it alongside the templated `path`. The CONSUMER materializes the URL via the kernel client's `cellUrl(owner, name, rest)` (`cells/kernel/client/main.ts:113-119`):

- On a cell host (`<owner>-<name>.on.parc.land`), `cellUrl` emits a sibling subdomain URL (each cell stays on its own origin).
- On the apex, `cellUrl` emits the `/@owner/name${rest}` path.

This means **no apex URL is baked into a type declaration** — the same handler renders correctly on the apex, on a cell subdomain, and for any owner. Legacy handlers may instead carry `surface` (a full templated URL — e.g. value-derived `${value.address}`), `act` (an `act` target like `@c15r/lit.create`), `renderer` (a `_renderers/<type>` fact key), or `hint` (a built-in render kind such as `markdown`/`metric`); these are localized as-is by the consumer.

#### 2.5.6 Source-vendoring sync pipeline

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

#### 2.5.7 Why `vocab.ts` is synced to `home` but not `starter`

The sync map enumerates targets explicitly. `vocab.ts` is vendored only where the resolver is consumed at runtime: today, only `cells/home` calls `resolve`/`declFor` to route fact lists. `cells/starter` consumes only the React component kit (`index.tsx`); it does not route facts, so it has no need for the resolver. The kernel cell currently uses its own inline `decl.href`-template fallback in `hrefOf` and does not vendor `vocab.ts`. Open question: consolidate by either (a) syncing `vocab.ts` to every cell that hosts fact viewers and migrating kernel `hrefOf` to call `resolve`, or (b) keeping `vocab.ts` vendored only where it's actually used and accepting two coexisting routing surfaces.

#### 2.5.8 Per-user `_types/<type>` override merge in the gateway

The gateway's read-virtual `$types` target (`services/gateway/service.ts:291-318`, `buildTypes`) assembles the merged vocabulary as data:

1. **Canonical layer** — `cells.describeTypes` returns the global declarations published by managing cells at deploy time (the cell registry's view). Read in parallel; fails open to `{types:{}}` on error so anonymous callers still get a vocabulary.
2. **Per-user override layer** — when `ctx.identity.user` is set, `workspace.query({prefix:'_types/', limit:200})` returns the caller's `_types/<type>` facts. Anonymous callers skip this read entirely. Both reads fail open.
3. **Merge precedence (user wins)** — `types = {...canonical}; for (e of slice) types[e.key.slice('_types/'.length)] = e.value;`. The user's `_types/<type>` value REPLACES the canonical value at the same type key (no shallow-merge of fields).

End-to-end precedence chain consumed by home:

```
DEFAULT_TYPE_DECLS  (built-in bootstrap, cells/home/services/home/client/type-decls.ts)
       ↓ overridden by
canonical / describeTypes  (cell-registry global handlers)
       ↓ overridden by
_types/<type>  (per-user facts)
```

`typeDeclsFrom` (`cells/home/client/app.tsx:932-935`) layers the merged `$types` map over `DEFAULT_TYPE_DECLS`, applying `normalizeDecl` to up-convert legacy `{icon, titlePath, href}` decls into the new `{icon, label, manager, handlers}` shape so old `_types/<type>` facts keep working through the migration.

#### 2.5.9 Type signatures (informative)

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

---

## 3. Capability & Consent Protocol

The platform composes **two layered authorities**:

1. **OAuth scope ceiling** (set at human consent, the trust ceiling for a client acting AS the human).
2. **Substrate grant grammar** (fine-grained, runtime-mutable data, used for cross-slice access and bounded delegation).

Effective access = `grants(principal) ∩ token.scope`. Tokens can only narrow; only owner-issued grants can widen.

### 3.1 Scope Vocabulary

Advertised in `lib/platform-stack.ts` via `AUTH_SCOPES`:

| Coarse | Granular | Admin |
|---|---|---|
| `workspace:read` | `read:workspace` | `platform:*` |
| `workspace:write` | `write:workspace` | `platform:cells:create` |
| `workspace:admin` | `cells:create` | (gated by `AUTH_ADMIN_USERNAMES`) |

Resource grammar (`platform/runtime/auth.ts`):

```
workspace:<owner>:<keyPrefix|*>:<read|write>
cell:<owner>/<name>:<tool|*>
platform:<verb>
```

`impliesScope` is one-way: `workspace:read ⊇ read:workspace`, `platform:* ⊇ cells:create`. Granular never implies coarse.

### 3.2 Declaration

A cell declares its scope requirements in three places:

1. **MCP tool descriptors** (`describeTools`) — each tool carries `scope: string | null` + `kind: 'read' | 'act'`. Workspace's `describeTools` defaults to `read:workspace` (kind=read) or `write:workspace` (kind=act); `tend` is `workspace:admin`.
2. **Cell capability** (`cells.create` requires `cells:create` scope).
3. **Caller-writes manifest** (`ssr.json#writes` — narrows the keys/types/cross-slice a cell may delegate).

Browser clients request the scope set at sign-in. `services/home/client/auth.ts` `DEFAULT_SCOPE = 'read:workspace write:workspace cells:create'`.

### 3.3 Grant Acquisition

Three OAuth 2.1 paths (all in `services/auth/oauth.ts`):

1. **Authorization code + PKCE S256** (`/oauth/register` DCR → `/oauth/authorize` consent SPA → `/oauth/token`). Single-use codes (`consumeAuthCode` flips `used` under `ConditionExpression used = false`).
2. **Refresh** (`/oauth/token grant_type=refresh_token`) — refresh row carries its own longer TTL (30d) independent of access (see §7).
3. **Device grant** (RFC 8628) — `/auth/device` + `/auth/device/approve`.

Substrate grants (workspace cell) are minted by:

- `workspace.share` / `cells.grant` — owner directly grants.
- `workspace.requestGrant {resource, note?}` → owner approves with `workspace.approveGrant {id}` → cell-family resources route to `cells.grant` (see §3.9).

### 3.4 Consent-Time Clamping

`handleConsent` (`services/auth/oauth.ts`):

- Filters requested scopes by `grantableScopes(user)` — admin scopes only granted to `AUTH_ADMIN_USERNAMES`.
- User-chosen lifetime clamped to `[MIN_GRANT_SECS=300, refreshExpirySecs]`.
- **Cell-host clamp**: when redirect_uri is `<owner>-<name>.<CELL_DOMAIN_SUFFIX>`, scopes are capped to `['workspace:read', 'workspace:write', 'cell:<owner>/<name>:*']` — never `platform:*` or other cells' scopes.

### 3.5 Enforcement Points

| Layer | Where | What |
|---|---|---|
| **Edge** | `define-service.ts resolveHttpIdentity` | Bearer→Identity via `auth.validateToken` |
| **MCP gateway** | `services/gateway/service.ts enforceScope` | Per-tool scope check, three-tier outcome |
| **Workspace** | `services/workspace/handlers.ts requireWriteThrough` | Cross-slice writes require `grantCovers(g.key, key)` |
| **Cells** | `services/cells/service.ts authorizeAccess` | Owner-or-grantee + per-tool wildcard match |
| **Dispatch** | `services/dispatch/service.ts applyCallerWrites` | `write:workspace` scope + cell's manifest + reserved-prefix denylist + 16-write cap |

### 3.6 Three-Tier Scope Failure (gateway)

```
allow                              caller has effective scope
scope_offer  (within grant)        instructs auth.requestScope (self-serve widen, no re-consent)
scope_denied (outside grant)       instructs human re-consent or auth.mintToken
```

`grant_denied` errors carry the ready-made next call (`workspace.requestGrant {resource}`), so denials are teaching affordances.

### 3.7 Identity Propagation

`platform/runtime/service-client.ts` propagates `{user, scopes, grantScopes, tokenId}` on every Mode-1 envelope. EventBridge-delivered events carry **no** caller identity (`scopes:[]`); trust derives from the IAM-attested event `source`.

Cells **never receive a token**. They receive `x-cell-caller` (validated identity string) only.

### 3.8 Reserved Namespaces (always refused on caller-writes)

`_actions/`, `_views/`, `_grants/`, `_groups/`, `_public/` — system vocabulary, written only by the workspace cell or owner-only commands.

### 3.9 Grant Request/Approval Inbox Flow

The substrate exposes a complete escalation loop on top of the grant-store primitive: when a caller hits a `grant_denied` they ask the resource owner for access, the owner resolves the request, and the outcome lands in the requester's slice as an observable fact. This is the only place the platform performs cross-slice writes on its own (twice — once for the request, once for the answer), and the surface is built from facts and the existing `share` / `cells.grant` primitives — no new notification channel.

#### 3.9.1 Reserved namespace

Defined in `services/workspace/grant-requests.ts`:

- `_grants/` — never writable through grants or write-through. The reserved-namespace guard in `requireWriteThrough` (`handlers.ts:1153`) rejects caller writes to `_grants/`, `_actions/`, `_views/`, `_groups/`, `_public/`.
- `_grants/requests/<requester>/<resource>` — pending requests live in the OWNER's slice.
- `_grants/answers/<owner>/<resource>` — outcomes live in the REQUESTER's slice.

#### 3.9.2 Resource grammar (`parseResource`)

`parseResource` throws a teaching error showing both forms on malformed input:

- `workspace:<owner>:<keyPattern>:<read|write>` — `keyPattern` is a fact key, a `prefix/*`, or `*` (whole slice); `mode` MUST be `read` or `write`. Examples: `workspace:alice:notes/*:write`, `workspace:alice:*:read`.
- `cell:<owner>/<name>:<tool|*>` — `tool` is a bare tool name, a trailing-`*` pattern, or `*`. Example: `cell:alice/regwatch:review`.

#### 3.9.3 Deterministic single-open-request guarantee

`requestKey(requester, resource)` is fully determined by `(requester, resource)`, so a second `workspace.requestGrant` for the same pair `put`s the same key and bumps revision instead of piling up duplicates. The same key revives a previously-denied request (its revision history is preserved). Cross-slice spoofing is prevented by the platform writing the request fact itself with `ctx.identity = requester`, so `_meta.writer` is the requester — provenance is the anti-spoofing.

#### 3.9.4 Value shapes

- `GrantRequestValue = { requester, resource, note?, status: 'pending'|'approved'|'denied', requestedAt, resolvedAt?, reason? }`, fact `type:'grant-request'`, tag `grants`, lives in owner's slice.
- `GrantAnswerValue = { resource, status: 'approved'|'denied', by, at, reason? }`, fact `type:'grant-answer'`, tag `grants`, lives in requester's slice.
- `NOTE_MAX = 500`. `requestGrant.note` and `denyGrant.reason` are silently truncated to the first 500 chars (not rejected) at `handlers.ts:1633` and `handlers.ts:1699`.

#### 3.9.5 Lifecycle

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

#### 3.9.6 Teaching surface

Every `grant_denied` error from `peek` and write-through carries the request grammar pre-formed, e.g. `Request one: act("workspace.requestGrant", { resource: "workspace:alice:inbox/x:read" })` (`handlers.ts:1160, 1346`). The grammar is the same string the request takes and the denial suggests — one vocabulary, two surfaces.

#### 3.9.7 Cross-slice write authority recap

The substrate has exactly two platform-internal cross-slice writes — `requestGrant` (owner's slice, writer=requester) and `resolveRequest`'s answer projection (requester's slice, writer=owner). All other cross-slice writes go through grant-mediated write-through, which `requireWriteThrough` (`handlers.ts:1147`) refuses for the reserved `_grants/`, `_actions/`, `_views/`, `_groups/`, `_public/` namespaces.

**See:** `docs/capability-consent.md`, `docs/scope-grants.md`, `platform/runtime/auth.ts`, `services/auth/oauth.ts`, `services/gateway/service.ts`, `services/workspace/grant-requests.ts`.

---

## 4. Storage API

### 4.1 Substrate Table (DynamoDB)

One shared, scope-partitioned table (`SubstrateTable` in `platform/infra/substrate-table.ts`) holds four item families:

| Family | pk | sk | TTL |
|---|---|---|---|
| Fact | `STATE#<scope>` | `KEY#<key>` | none (durable) |
| Edge | `STATE#<scope>` | `EDGE#<from>\|<rel>\|<to>` | none |
| Trajectory | `TRAJ#<scope>` | `<iso>#<seq>` (12-pad seq) | `at + 86400s` |
| Seq counter | `SEQ#<scope>` | `'A'` | none |
| Grant | `GRANT#<grantee>` / `GRANTBY#<owner>` | `<owner>#<key>` / `<grantee>#<key>` | none |
| Group membership | `MEMBER#<principal>` | `<owner>#<group>` | none |

GSIs (every gsi-pk repeats the scope so `dynamodb:LeadingKeys` covers index reads):

```
gsi-in    gsi1pk = IN#<scope>#<to>      gsi1sk = <rel>|<from>      (inbound edges)
gsi-type  gsi2pk = TYPE#<scope>#<type>  gsi2sk = <updatedAt>       (typed/recency)
```

Streams `NEW_AND_OLD_IMAGES` enabled. TTL on `ttl` attribute. `EDGE_DELIM = '|'` — segments must not contain `|` (asserted by `assertEdgePart`).

#### 4.1.1 Group membership and `_public/` projection

The substrate's group primitive is implemented as a record/index pair: a `_groups/<name>` fact in the owner's slice (the authoritative record of audience membership) plus a `MEMBER#<principal>` reverse-index row keyed by the principal (the off-scan lookup the read path needs).

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

**`_groups/` membership reconcile.** When `workspace.group` writes a `_groups/<name>` fact, it reconciles the membership index against the prior membership in one pass:

1. Read the existing fact (if any) and form `before = set(existing.members)`.
2. Compute `next` from `members` (wholesale) or by patching `existing.members` with `add` / `remove`.
3. Drop the owner from `next` (owners are implicitly in every audience they define).
4. Drop `public` from `next` (the reserved universal audience is not a regular member).
5. `state.put` the new `_groups/<name>` fact with the sorted member list.
6. For each `p ∈ next \ before`, `addMember(owner, name, p)`.
7. For each `p ∈ before \ next`, `removeMember(owner, name, p)`.

The fact write and the symmetric-difference index updates together are the whole "set the audience" operation; partial failure is bounded by the substrate's normal observed-state write semantics (one fact, one row per added/removed member).

**`group:<name>` resolution at recall time.** A grantee of the form `group:<name>` resolves at recall/peek time through the membership index, never by scanning the owner's slice. The applicable-grants fan-out (`grants.ts:98-117`) is:

1. Always: `listForGrantee("public")` — the universal audience.
2. If the caller is authenticated:
   a. `listForGrantee(<viewer>)` — direct grants to this principal.
   b. `listMemberships(<viewer>)` — every `(owner, group)` the viewer belongs to (one indexed Query on `MEMBER#<viewer>`).
   c. For each membership `(owner, group)`: `listForGrantee("group:" + group)`, **filtered to `g.owner === owner`** so a `group:eng` grant only resolves for the owner whose group enrolled this viewer — group names are scoped to the defining owner, not global.
3. Dedupe by `(owner, grantee, key)` and drop any grant whose owner is the viewer themselves.

`recall` (`handlers.ts:1304-1331`) folds each resulting grant into the viewer's merged view as `<owner>/<key>` (whole-slice and trailing-`*` prefix forms walk the granted owner's slice; bare keys are a single `state.get`). Every step on the read path is an indexed query — there is no slice scan keyed by group membership.

**`workspace.group` / `workspace.groups` MCP tools** (`handlers.ts:1017-1056`, `1582-1625`):

- **`workspace.group`** (`act`, `kind: "act"`). Input: `{ name, members?, add?, remove?, label?, note? }`. Defines or patches `_groups/<name>` and reconciles the membership index. Group `name` must be a bare handle (no `/`, no leading `_`). Output: the resolved `{ name, members[], label?, note? }`.
- **`workspace.groups`** (`read`). Input: none. Lists the caller's audiences by querying `prefix: _groups/, rankBy: recency, limit: 200` over their own slice. Output: `{ groups: [{ name, members[], label?, note? }] }`.

Sharing to a group is `workspace.share { to: "group:<name>", key?, mode? }`; the gateway puts a `GRANT#group:<name>` row that the recall fan-out resolves through the `MEMBER#<principal>` index for any member.

### 4.2 ObservedState Primitive

`platform/runtime/state.ts` (`createObservedState(store, salience?)`) implements:

```ts
interface ObservedState {
  put(scope, key, value, opts): WriteResult;            // ifRevision/ifAbsent CAS, type, tags, timer
  get(scope, key): Entry | null;
  read(scope, opts): ReadResult;                        // tiered (focus/peripheral/elided), lensed
  shape(entries, opts): ShapingSummary;
  query(scope, opts): QueryResult;                      // type/tag/prefix, cursor, salience|recency
  link(scope, from, rel, to, strength?): LinkResult;
  unlink(scope, from, rel, to): void;
  neighbors(scope, key, opts): NeighborsResult;
  edges(scope, from): EdgeRecord[];
  changes(scope, sinceSeq): ChangesResult;
  attention(scope, opts): AttentionResult;
  supersede(scope, key, value, opts): void;             // migrateLinks
}
```

CAS is enforced atomically by DynamoDB `ConditionExpression` (`attribute_not_exists(pk)` / `revision = :rev`). An expired `delete`-effect timer counts as **absent** so `ifAbsent` reclaims are crash-safe (see §4.2.2).

#### 4.2.1 Salience Scoring (expanded)

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

#### 4.2.2 Lazy fact timers (`timer.effect: 'delete' | 'enable'`)

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

### 4.3 IAM Authority

Every dynamic cell role gets a `dynamodb:LeadingKeys` condition (set in `services/cells/cell-template.ts SubstrateOwnScopeRead`):

```
LeadingKeys = STATE#<owner>, TRAJ#<owner>, SEQ#<owner>, IN#<owner>#*, TYPE#<owner>#*
```

— covers table **and GSIs**. Σ-calculus scope authority is enforced by AWS, not the interpreter.

The platform-managed permission boundary (`DynamicCellControlPlane.permissionBoundary`) caps dynamic cells at substrate **read** only. **Substrate writes flow through `substrate.write.requested` events** routed by the platform event bus; the workspace cell's `createSubstrateWriteHandler` applies them in the cell-owner's slice with provenance.

### 4.4 S3 Cell-Storage Layout

One shared `CodeBucket` (provisioned by `DynamicCellControlPlane`, encryption S3_MANAGED, BlockPublicAccess BLOCK_ALL, CORS `PUT` from `https://parc.land`):

```
cells/<cellId>/src/<path>            # multi-file source (per-cell, deploys)
cells/<cellId>/build/<version>.zip   # built Lambda artifact
cells/<cellId>/<uuid>.zip            # initial create code
cells/<cellId>/data/<user>/<key>     # per-cell, per-caller blob layer
cells/<cellId>/data/<user>/public/.. # web-served for public cells
```

`cleanPath` (`services/cells/cell-files.ts`) rejects `..`/`.` and unsafe segments — segments must match `^[A-Za-z0-9][A-Za-z0-9._-]*$`.

**Asymmetry (deliberate):** source is per-cell (code shared by callers); data is per-cell-per-caller. Source writes deploy; data writes never deploy.

In v1 only forge holds `s3:*` on `CodeBucket`. Per-user data isolation in S3 is forge/app-enforced, not IAM-enforced.

### 4.5 Signed URL Flow

For browser uploads, `services/cells/provisioner.ts presignPut(cellId, path)` returns a presigned PUT URL. Bucket CORS allows `PUT` from `https://parc.land` only.

### 4.6 Quotas (current)

- DynamoDB items: 400 KB cap per item — `@c15r/models` job results above 400 KB are chunked across `c<i>` items (300 KB b64 chunks) and reassembled on fetch.
- Caller-writes batch: 16.
- Trajectory partition: bounded by 24h TTL (`TRAJECTORY_TTL_SEC`).
- Cells' `describeCellTools` aggregation: capped at `MAX_TOOL_CELLS = 25`.
- Workspace `ingest`: 100 facts/call.
- Tool name: `^[a-zA-Z0-9_-]{1,64}$`.

### 4.7 Declarative Vocabulary — Actions and Views

The declarative tier is the workspace's no-code action/view DSL. **It is data, not code:** every declaration is stored as a fact in the caller's slice (`_actions/<id>` and `_views/<id>`) and evaluated by a small, fixed interpreter at invoke/read time. Because the write footprint is *declared*, it is bounded, auditable before execution, and contested-target detection is a registry scan.

CEL is **opt-in inside conditions and view filters**, not the surface language. Parse errors surface at registration; a non-boolean CEL result fails the predicate.

#### 4.7.1 Storage and constants

| Constant | Value | Source |
|---|---|---|
| `ACTIONS_PREFIX` | `'_actions/'` | `services/workspace/actions.ts` |
| `VIEWS_PREFIX` | `'_views/'` | `services/workspace/views.ts` |

Each registration is a `state.put` with:
- action: `key=_actions/<id>`, `type='action'`, default `via='registerAction'`
- view: `key=_views/<id>`, `type='view'`, default `via='registerView'`

`RegisterOptions { via?, tags? }` lets a tier-2 organ tag its own vocabulary `cell-required` so it reads as program (refreshed on redeploy), not organic, caller-authored vocabulary. Caller registrations use the defaults.

#### 4.7.2 ActionDefinition

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

#### 4.7.3 Validation (`validateDefinition`)

At registration the substrate enforces, and rejects with an error otherwise:

1. `id` is a non-empty string and contains no `/`.
2. `writes` is a non-empty array; every write has a string `key`.
3. **No write may target the `_actions/` prefix** — actions cannot rewrite their own vocabulary.
4. For each `if`/`enabled` entry:
   - CEL form: `c.cel` is parsed via `celParse` at registration time; broken expressions are rejected before storage. `key`, if present, must be a string.
   - Structured form: `key` is a string; `op` ∈ `{exists, absent, eq, ne, gt, lt}`; `eq/ne/gt/lt` require a `value`.

(Note: no validation prohibits *reading* `_actions/` keys from conditions; only *writing* is gated.)

#### 4.7.4 Substitution language

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

#### 4.7.5 Invoke (`invoke`)

1. Load `_actions/<id>`. Missing/superseded → `ActionInvokeError('not_found')`.
2. Validate params: `required` first, then `type` (skipped for `'any'`), then `enum` via deep equality. Failure → `'invalid_param'`.
3. Evaluate `enabled` AND'd. First false → `'action_disabled'` (with the predicate detail).
4. Evaluate `if` AND'd. First false → `'precondition_failed'` (with detail).
5. Apply each write in declared order via `state.put`, with `via='action:<id>'` and per-write `type, tags, ifAbsent, timer` propagated.

**Writes are NOT atomic as a batch.** Per-write `ifAbsent` is the only atomic primitive; combined with `timer` it expresses an atomic, lease-bound, crash-safe claim. Each successful write also fires `workspace.fact.written` so subscriptions react to manual invokes the same way they react to reactive chains.

`ActionInvokeError` codes: `precondition_failed | action_disabled | invalid_param | not_found`.

#### 4.7.6 Contested-target detection

`register` returns `RegisterResult { action, contested: Array<{ target, actions[] }> }`. The registry scans all other registered actions (excluding the same id), indexes their declared write keys, and reports overlaps where two or more actions declare a write to the same (un-substituted) key template. **Conflict is surfaced, not blocked** — the substrate's stance is to hold the tension visibly. The caller is expected to reconcile.

#### 4.7.7 ViewDefinition

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

#### 4.7.8 Validation (`validateView`)

- `id` non-empty, no `/`.
- `query` is an object.
- `reduce` ∈ the four reducers if present.
- `filter` parses as CEL at registration time (`celParse`); broken expressions cannot be registered.
- `render.type` is a string if `render` is present.

#### 4.7.9 Evaluate (`view`)

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

#### 4.7.10 Command surface and verb-scope defaulting

The cell exposes the DSL through these tools (kind shown):

| Tool | Kind | Default scope |
|---|---|---|
| `registerAction`, `deleteAction`, `invoke` | act | `write:workspace` |
| `actions` | read | `read:workspace` |
| `registerView`, `deleteView` | act | `write:workspace` |
| `views`, `view` | read | `read:workspace` |
| `tend` | act | `workspace:admin` (explicit) |

A tool that omits `scope` is gated by its `kind` at gateway time: `kind: 'read'` → `read:workspace`, `kind: 'act'` → `write:workspace`. Slice isolation still applies inside each handler; the verb gate is layered on top. Legacy coarse tokens (`workspace:read`, `workspace:write`) imply the verb scopes via `impliesScope`.

### 4.8 Reactions (subscriptions → declared actions)

A **subscription** is the substrate's reaction primitive: data, not code, that turns any fact write into a guarded invocation of a declared action. The reactor is generic; reactivity is something a slice opts into by registering vocabulary, not a behaviour the platform special-cases. This is what lets a tier-2 cell (e.g. `@c15r/machine`) be a reactive concept system without any platform change — the cell ships an action whose `if` guard reads its own state and a subscription tying that action to writes in its key namespace.

#### 4.8.1 Subscription definition

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

#### 4.8.2 Vocabulary

Three commands, gated by the same `write:workspace` / `read:workspace` verb scopes as the rest of the substrate:

- `registerSubscription({ subscription })` — validates the definition (id present, no `/`, ≥1 match clause, CEL parses) and writes it as a fact in the caller's slice.
- `subscriptions()` — list (prefix scan over `_subscriptions/`, recency-ranked, capped at 200).
- `deleteSubscription({ id })` — supersedes the fact; throws `not_found` if absent.

System keys (`_`-prefixed) are excluded from `recall` shaping and `attention` by the same convention the reactor honours.

#### 4.8.3 The reactor (bounded fixpoint)

Every fact write emits `workspace.fact.written { scope, key, revision }`. The workspace service's reactor consumes this event and runs:

1. **System-key skip.** If `!scope || !key || key.startsWith('_')`, return. Vocabulary writes (subscriptions, actions, views, tending audit) never trigger reactions.
2. **List + load.** Read `_subscriptions/*` for the slice. Load the changed fact; skip if absent or superseded.
3. **Match.** Filter subscriptions by `match` (type / keyPrefix / CEL). CEL is *total* — any evaluation error is treated as `false`, so a malformed runtime value cannot crash the reactor.
4. **Depth cap.** For each hit, if `revision > (sub.maxDepth ?? 50)`, log and skip. The triggering fact's revision counts the chain length (a run fact's revision equals the number of transitions), so this is a generic loop bound on auto-advance chains.
5. **Invoke.** Resolve params from the event and call the declared action under the synthetic identity `{ user: 'platform/reaction', scopes: [] }`. The action's own `if`/`enabled` guards decide whether it actually fires; `precondition_failed` / `action_disabled` are the *expected* no-op (e.g. an auto-rail whose `from` ≠ the run's current node) and silently swallowed. Any other error is a real fault (logged, not propagated — the bus consumer must not crash).
6. **Re-emit.** For every write the action produced, emit a fresh `workspace.fact.written`. Downstream subscriptions chain off these, giving a bounded fixpoint: the chain converges when no rail's guard holds, or terminates at the depth cap.

Reactions invoke *declared actions only* — bounded, auditable, slice-local writes — so the entire loop stays in the declarative tier. There is no opaque callback surface; a subscription cannot run code.

#### 4.8.4 Source attestation

Reactions only fire on first-party fact events. The EventBridge rule that delivers `workspace.fact.written` to the workspace function pins `source = 'workspace'`. Each dynamic cell's IAM policy pins `events:source = cell-<cellId>`, so a cell cannot forge a `workspace.fact.written`. Cell writes flow through the separate `substrate.write.requested` event (source `cell-*`, validated by the substrate-write handler), which after applying the fact emits a `workspace.fact.written` *as the workspace itself* — the single chokepoint where the reactor actually fires. The reactor handler does not need to re-check the source; the bus rule is the enforcement.

#### 4.8.5 Two ways subscriptions are registered

- **User vocabulary.** A caller invokes `workspace.declare({ kind: "subscription", def })` from their slice (ADR-0068; the old `registerSubscription` spelling is retired). Tagged with the caller's chosen tags; `via` defaults to `'registerSubscription'`.
- **Cell-required vocabulary (organ path).** A cell emits `substrate.write.requested` with `key: '_subscriptions/<id>'`. The substrate-write handler resolves the cell's owner, attributes the writer to `@<owner>/<cellName>`, validates and registers the subscription, and tags it `cell-required`. This is the same "two kinds of seeding" rule that governs `_actions/*` and `_views/*` — versioned with the cell, refreshed on redeploy.

#### 4.8.6 Reactor non-goals

- The reactor does not deliver events across slices: a subscription only sees writes to its own slice. Cross-slice reactivity is expressed by sharing + having the grantee's slice subscribe.
- The reactor does not retry. A reaction is exactly-once-per-event from the bus's perspective; the action's preconditions and CAS writes are the durability story.
- The reactor does not inspect the writer. Reaction writes are stamped `platform/reaction` and audited as such.

#### 4.8.7 Worked example: a reactive machine in two facts

1. Action: `{ id: 'A-to-B', if: [{ key: 'run/${params.run}', path: 'node', op: 'eq', value: 'A' }], writes: [{ key: 'run/${params.run}', value: { node: 'B' }, type: 'run' }] }`
2. Subscription: `{ id: 'r-A-to-B', match: { keyPrefix: 'run/' }, invoke: 'A-to-B', params: { run: '${keySuffix}' } }`

Now `remember({ key: 'run/r1', value: { node: 'A' }, type: 'run' })` sends the run to its terminal state by transitive re-emission, capped by `maxDepth`. The platform learnt nothing about machines.

**See:** `docs/substrate-storage.md`, `docs/cell-storage-s3.md`, `platform/runtime/state.ts`, `platform/runtime/dynamo-state-store.ts`, `platform/infra/substrate-table.ts`, `services/workspace/actions.ts`, `services/workspace/views.ts`, `services/workspace/subscriptions.ts`.

---

## 5. MCP Surface

The platform exposes one authenticated MCP endpoint on the apex: `POST /mcp` (the `gateway` cell). MCP version `2025-06-18`. Transport: Streamable HTTP (no GET/SSE stream — see §11).

### 5.1 Three-Tool Surface

Capability lives in the `target` argument so new cells/commands appear instantly without a `tools/list` change or client reconnect:

```ts
whoami() → { user, scopes, grant }                      // readOnlyHint:true
read({ target?, input? })                               // readOnlyHint:true
act({ target, input })                                  // readOnlyHint:false (destructiveHint deliberately unset)
```

Sentinel targets:
- `read('$catalog')` — capability menu (full schemas) or `{detail:'summary'}` for grouped one-line view.
- `read('$types')` — type vocabulary, canonical (from `cells.describeTypes`) merged under per-user `_types/<type>` overrides (`workspace.query prefix:'_types/' limit:200`).

### 5.2 Target Grammar

```
<cell>.<command>             # tier-1, first '.' splits.    PROVIDERS = ['workspace','cells','auth']
@<owner>/<cell>.<tool>       # tier-2, first '/' after '@' splits owner; LAST '.' splits tool
```

### 5.3 Tool Registration

Each tier-1 cell implements `describeTools` returning `{tools: McpToolDefinition[]}`:

```ts
interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  resultSchema?: JSONSchema;
  scope: string | null;       // null = no scope required
  kind: 'read' | 'act';
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
}
```

The cells service additionally implements:

- `describeCellTools` — aggregates tier-2 dynamic-cell tools (capped 25, scope-filtered, attaches `disclosure {author, reads, writes?, note}` when caller != owner).
- `describeTypes` — global type vocabulary.
- `callCellTool` — forwards a tier-2 invocation to the cell's `/_tools/<name>`.

### 5.4 `defineMcpService` Primitive

`platform/runtime/define-mcp-service.ts` is sugar over `defineService` that any cell can use:

```ts
defineMcpService({
  name, version?,
  commands, events?, http?,
  tools?: McpToolDefinition[],                            // static
  resolveTools?: (ctx) => Promise<McpToolDefinition[]>,   // per-request (gateway uses this)
  requireAuth?: boolean,                                  // default true
  mcpPath?: string,                                       // default '/mcp'
  instructions?: string                                   // server self-introduction
})
```

It speaks JSON-RPC 2.0: `initialize` / `ping` / `tools/list` / `tools/call`. Static tools are also registered as directly-invocable commands; `resolveTools(ctx)` results are merged per request but **not** registered as commands.

### 5.5 Dynamic Cell HTTP Convention

Tier-2 cells answer:

- `GET /_tools` → `{ tools: McpToolDefinition[] }` (advertise)
- `POST /_tools/<name>` → JSON in/out (invoke)

Identity is delivered via `x-cell-caller` (validated by dispatch); the cell never sees the bearer.

### 5.6 Auth Discovery (RFC 9728)

Unauthenticated `POST /mcp` returns:

```
401 Unauthorized
WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp", error="..."
```

Clients then fetch `/.well-known/oauth-protected-resource[/*]` to discover the auth server. The authorization server itself advertises via `/.well-known/oauth-authorization-server` (RFC 8414).

### 5.7 CORS

Reflective for origins matching `MCP_CORS_ORIGIN_SUFFIX` (e.g. `.on.parc.land`). Credentialless: bearer in `Authorization`, never the cookie. Unset suffix → no CORS headers.

### 5.8 Server `instructions`

Sent on `initialize` — tells agents to prefer `workspace.query` over `workspace.recall` and to start with `read('$catalog', {detail:'summary'})`.

### 5.9 Error Wrapping

`tools/call` swallows handler errors as `{isError: true, content: [...]}` rather than JSON-RPC errors. Intentional — so the client can show errors to the model. Currently elides `ServiceAuthError` vs business errors uniformly.

**See:** `services/gateway/service.ts`, `platform/runtime/define-mcp-service.ts`, `docs/mcp-spec-alignment.md`.

---

## 6. Routing & Origin Isolation

### 6.1 CloudFront Topology

Two distributions provisioned by `platform/infra/service-router.ts`:

1. **Apex distribution** — serves `parc.land` plus configured `domainNames`.
2. **Cell-namespace distribution** (optional) — serves the wildcard `*.<cellDomain>` (e.g. `*.on.parc.land`). Built only when `cellHostRouter` + `cellDomainNames` + `cellCertificate` are set.

Per-cell origin reuse: a cell with multiple routes shares ONE `FunctionUrlOrigin`.

### 6.2 Behaviours

For each cell registered in `lib/platform-stack.ts`, the apex distribution gets a behaviour matching the cell's declared `routes`:

| Cell | Routes | Notes |
|---|---|---|
| home | `[]` | router default — catch-all GET |
| auth | `/oauth/*`, `/.well-known/*`, `/auth/*`, `/webauthn/*` | |
| workspace | (no public route — peer-only) | |
| gateway | `/mcp`, `/mcp/*` | |
| dispatch | `/@*` | tier-2 ingress |
| cells (forge) | (no public route — peer-only) | |

All behaviours: `CACHING_DISABLED`, `forwardAllViewerHeadersExceptHost`, `cors.allowedOrigins=['*']` when `publicFunctionUrl=true`.

### 6.3 Function URLs

Default `authType=AWS_IAM`; only `publicFunctionUrl=true` produces `authType=NONE`. Direct public access is otherwise blocked — only CloudFront-via-OAC can reach origins.

### 6.4 Lambda@Edge — Critical

Two inline JS functions ship in `service-router.ts` (us-east-1 only):

1. **Origin-request body signer** — adds `x-amz-content-sha256` + `x-forwarded-authorization` for POST/PUT/PATCH/DELETE (1 MB body cap). Exists because OAC SigV4 doesn't hash the body before signing IAM-protected Function URL requests, and because OAC overwrites the literal `Authorization` header — origins **must** read `X-Forwarded-Authorization` for bearer tokens (MCP/OAuth).
2. **Origin-response WWW-Authenticate un-remapper** — Lambda Function URLs remap that header; this restores it for RFC 9728 to work.

Construct id `OriginSignerRole` and `WwwAuthEdge` are intentionally preserved across refactors (replicas linger for hours).

### 6.5 CloudFront Functions (cell-namespace distribution)

1. **CellHostRewrite** — viewer-request: parses `<owner>-<name>.<cellDomain>` Host header, rewrites URI to `/@<owner>/<name>` for dispatch. Splits on the **first** hyphen — owner labels MUST NOT contain `-` (cell names may).
2. **CellApexRedirect** — apex `/@<owner>/<name>` navigations (Sec-Fetch-Dest in `{document, iframe, frame}`) get `302` to the cell subdomain. Sub-resources and non-browser clients pass through, so cell pages execute on their own origin while sub-resources stay on apex.

### 6.6 Subdomain Strategy

`<owner>-<name>.<cellDomain>` — single DNS label encoding (owner, name) under one `*.on.parc.land` wildcard cert. Username regex `^[a-z0-9]+$` (no hyphens) keeps the first-hyphen split unambiguous. Cell names may contain `-`. The combined label must satisfy ≤ 63 chars / `[a-z0-9-]` / no leading-trailing hyphen.

### 6.7 Trust Boundaries

- **Origin = trust boundary.** Trusted shell (`parc.land`) and untrusted cells (`<owner>-<name>.on.parc.land`) run on different web origins; same-origin localStorage reads defeat any token scoping.
- **Cookie scope.** `parc_session` is host-only (no `Domain` attribute), HttpOnly, Secure, SameSite=Lax. MUST never become `Domain=.parc.land`.
- **WebAuthn pinning.** RP ID = `parc.land` (registrable suffix, so passkeys are portable across cell subdomains via the suffix rule). `expectedOrigin` is pinned to a shell allowlist (`PUBLIC_BASE_URL` + `WEBAUTHN_EXPECTED_ORIGINS`); cell subdomains are rejected.

### 6.8 CORS Summary

| Endpoint | Origin policy | Credentials |
|---|---|---|
| `/mcp` | reflects `*.on.parc.land` (`MCP_CORS_ORIGIN_SUFFIX`) | bearer only, no cookie |
| `/oauth/register`, `/oauth/token` | reflects `*.on.parc.land` | none |
| `/app.js` (cells/kernel, cells/viewers) | `Access-Control-Allow-Origin: *` | none (public, credential-free) |
| Other auth routes | same-origin | cookie ok |

**See:** `platform/infra/service-router.ts`, `docs/cell-origin-isolation.md`, `cells/kernel/client/main.ts`.

---

## 7. Auth Service Contract

Self-contained OAuth 2.1 server + WebAuthn passkey IdP, ported from `c15r/mcp-auth`. The single source of truth for token validity.

### 7.1 OAuth 2.1 Endpoints

All on `services/auth/service.ts`:

| Endpoint | RFC | Purpose |
|---|---|---|
| `GET /.well-known/oauth-protected-resource[/*]` | 9728 | PRM discovery |
| `GET /.well-known/oauth-authorization-server` | 8414 | AS metadata (`scopesSupported`, granular + coarse) |
| `POST /oauth/register` | 7591 | Dynamic client registration (DCR), CORS for cell origins |
| `GET /oauth/authorize` | — | React consent SPA |
| `POST /oauth/consent` | — | Consent submission |
| `POST /oauth/token` | 6749/7636 | `authorization_code` / `refresh_token` / `device_code`, PKCE S256, CORS |
| `POST /oauth/revoke` | 7009 | Idempotent (always 200) |
| `POST /auth/grantable` | — | Consent-page metadata: scopes/catalog/clientName/maxGrantSecs |
| `POST /webauthn/register/{options,verify}` | — | Passkey registration |
| `POST /webauthn/authenticate/{options,verify}` | — | Passkey assertion |
| `POST /auth/device` | 8628 | Device-code init |
| `POST /auth/device/approve` | 8628 | User code approval |

### 7.2 Token Shape

```ts
interface MintedToken {
  id: string;                  // tokenId
  token: string;               // raw, returned ONCE at mint
  scope: string;               // immutable grant ceiling
  expiresAt?: string;          // ISO; optional for non-expiring deployments
}

interface ValidatedToken {
  user: string;
  scope: string;               // grant ceiling (immutable)
  effectiveScope: string;      // mutable session focus, ⊆ scope
  tokenId: string;
}
```

Storage: `TOKEN#<sha256(token) base64url>` — raw tokens are never stored. Per-user index: `USERTOK#<userId>` sk=`<tokenId>`.

Token prefixes (cosmetic): `client_`, `secret_`, `sess_`, `authz_`, `tok_`, `ref_`, `dev_`.

### 7.3 Refresh Architecture (deviation)

Refresh tokens live in their own `REFRESH#<refreshHash>` row with **independent**, longer TTL (`REFRESH_TTL_MS = 30d`). Refresh works after the access row has been TTL-deleted by Dynamo. Rotation revokes both old; refresh consumes its row. Revoking by token value handles either form.

### 7.4 Session Model

| Channel | Where | When honoured |
|---|---|---|
| `Authorization: Bearer` | All authenticated endpoints | Always |
| `X-Forwarded-Authorization` | Edge-restored bearer (OAC clobbers `Authorization`) | Read by `resolveHttpIdentity` |
| `parc_session` cookie | HttpOnly, Secure, SameSite=Lax, Max-Age=3600 | **Only** dispatch service, GET/HEAD, `Sec-Fetch-Dest: document` |
| `x-cell-caller` header | Set by dispatch / cells.callCell | Identity carried to cells (no token) |

### 7.5 Scope Vocabulary (auth.* MCP tools)

Aggregated by gateway as `auth.*`:

```
auth.tokens()              → TokenSummary[]                    (read)
auth.mintToken(...)        → MintedToken                       (act, ceiling = minter's effective)
auth.revokeToken({tokenId})                                    (act)
auth.labelToken({tokenId, label})                              (act)
auth.scope()               → { effective, grant }              (read)
auth.focusScope({scopes})  → narrow effective                  (act)
auth.requestScope({scopes})→ { effective, grant, granted, denied }  (act, widens within ceiling)
auth.validateToken({token})→ ValidatedToken | null             (substrate-internal bridge)
```

`auth.validateToken` is the bridge that turns a bearer into `ctx.identity`, called from `define-service.ts resolveHttpIdentity`. The auth cell **does not self-validate** (`define-service` skips this hop when `serviceName === AUTH_SERVICE_NAME`).

### 7.6 Cell-Host Scope Ceiling (`cellCeiling`)

When `redirect_uri` is `<owner>-<name>.<CELL_DOMAIN_SUFFIX>`, minted scope is capped to:

```
['workspace:read', 'workspace:write', 'cell:<owner>/<name>:*']
```

Never `platform:*`, never other cells' scopes.

### 7.7 WebAuthn Passkey Ceremonies

The auth cell exposes four routes — `POST /webauthn/{register,authenticate}/{options,verify}` — implemented over `@simplewebauthn/server` and backed by the `AuthStore` interface (DynamoDB in prod, in-memory for tests/local). Cryptographic correctness is delegated to the library; the substrate's responsibility is to pin the right RP id and origin set, persist challenges and credentials with the right shape, and prevent cross-cell passkey theft.

**RP ID resolution (`rpIdOf`).** The RP id is the *registrable-suffix-collapsed* hostname. When `WEBAUTHN_RP_ID` (e.g. `parc.land`) is configured, any request whose `hostname` equals it or ends with `.{rpId}` collapses to that stable value; everything else passes through as the bare hostname. This collapse is what gives passkeys portability across `*.parc.land` cells: a passkey registered on `home.parc.land` can be asserted from `alice-notes.on.parc.land` because both resolve to RP id `parc.land`.

**Origin pinning (`allowedOrigins`) — the asymmetric defense.** Because `parc.land` is a registrable suffix of every cell host, a hostile cell subdomain could otherwise mount a WebAuthn ceremony the browser would happily complete (the browser only enforces RP id ⊆ origin's registrable domain). The substrate MUST therefore pin `expectedOrigin` to a *shell allowlist* — the union of `PUBLIC_BASE_URL` (the shell origin) and `WEBAUTHN_EXPECTED_ORIGINS` (comma/space-separated extras: apex/www/CloudFront bootstrap variants). Cell subdomains MUST NOT appear on this list and are rejected at verify time. When neither env var is set, the verifier falls back to the request origin (local/bootstrap convenience). The asymmetry is deliberate and load-bearing:

| Surface | Scope | Mechanism |
|---|---|---|
| Credential portability (RP ID) | Any `*.<rpId>` host | `rpIdOf` registrable-suffix collapse |
| Ceremony execution (origin) | Shell origin(s) only | `allowedOrigins` explicit allowlist |

This pairing — portable credential, pinned ceremony — is the substrate's primary anti-phishing posture for cells. See `docs/cell-origin-isolation.md` §4.4.

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

### 7.8 TTLs

```
CHALLENGE_TTL_MS = 5m
CODE_TTL_MS      = 10m   (auth code, single-use)
SESSION_TTL_MS   = 15m   (consent session)
DEVICE_TTL_MS    = 15m
REFRESH_TTL_MS   = 30d
```

### 7.9 Username Discipline

Regex `^[a-z0-9]+$` — single DNS label, no hyphens (so the cell-host rewrite can split on the first hyphen). The auth user UUID stays the durable credential anchor; the username is the human-readable handle exposed in `ctx.identity.user`.

**See:** `services/auth/service.ts`, `services/auth/oauth.ts`, `services/auth/store.ts`, `services/auth/dynamo-store.ts`, `services/auth/webauthn.ts`.

---

## 8. Cell Inventory

### 8.1 Tier-1 (Kernel — declared in CDK)

#### `auth`

- **Purpose:** OAuth 2.1 + WebAuthn IdP; single source of truth for token validity.
- **Capabilities used:** owns its store; peers (`workspace`, `gateway`, `dispatch`) `allow(auth)` for `validateToken`.
- **Public surface:** `/oauth/*`, `/.well-known/*`, `/webauthn/*`, `/auth/*`, `/auth/app.js`. Persistence: own DDB table.
- **Manifest excerpt:** `HttpServiceCell({ name:'auth', persistence:{ dynamo:true, dynamoTtl:true }, clientEntry: services/auth/client/main.tsx })`.
- **Dependencies:** `@simplewebauthn/server`, `@simplewebauthn/browser`, `aws-sdk DynamoDB.DocumentClient`.

#### `workspace`

- **Purpose:** Flagship room provider over the substrate. Owns the canonical vocabulary (remember/recall/peek/query/link/neighbors/changes/attention/supersede/ingest), declarative tier (actions/views/subscriptions), sharing/grants, reactive event handlers.
- **Capabilities used:** `SubstrateTable.grantReadWrite`. Calls `cells.resolveCell` for organ-write owner resolution.
- **Public surface:** none (peer-only). Commands surfaced via `gateway`.
- **Emits:** `workspace.fact.written`, `workspace.shared`, `workspace.action.invoked`, `workspace.tended`, `workspace.ingested`, `workspace.grant.requested`, `workspace.grant.resolved`.
- **Handles:** `substrate.write.requested` (organ writes, source-prefix `cell-`), `workspace.tend.requested` (cron 06:30 UTC, `detail:{scopes:['c15r']}`), `workspace.fact.written` (reaction reactor, maxDepth=50), `cell.create.requested|deployed|files.changed|delete.requested` (lifecycle projection, source `cells`).
- **Dependencies:** `@marcbachmann/cel-js`, `aws-sdk DynamoDB.DocumentClient`.

#### `gateway`

- **Purpose:** Single authenticated MCP endpoint and policy enforcement point. Three-tool surface (`whoami`/`read`/`act`).
- **Capabilities used:** `gateway.allow(auth/cells/workspace)`.
- **Public surface:** `POST /mcp`, `GET /mcp`, `GET /mcp/whoami`. CORS via `MCP_CORS_ORIGIN_SUFFIX`.
- **Dependencies:** `defineMcpService`, hard-coded `PROVIDERS = ['workspace','cells','auth']`.

#### `cells` (forge — control plane)

- **Purpose:** Mints, inspects, edits, deploys, shares, invokes user-owned tier-2 cells. Owns the registry, brokers all per-cell S3 access, holds the only IAM principals that can provision `cell-*` infrastructure. Async deploy via `cell.deploy.requested` event.
- **Capabilities used:** `DynamicCellControlPlane.grantControlPlane(forge)`. CDK `bundlingNodeModules: ['esbuild-wasm','react','react-dom']`, memory 512, timeout 120.
- **Public surface:** none (no routes). Reached only via allow-listed Mode-1 invokes from `gateway`/`dispatch`/`workspace`.
- **MCP tools surfaced via `describeTools`:** `create` (scope `cells:create`), `list`, `get`, `call`, `grant`, `revoke`, `delete`, `logs`, `writeFile`, `replaceInFile`, `appendToFile`, `readFile`, `listFiles`, `deleteFile`, `deploy`, `putData`, `getData`, `listData`.
- **Internal commands:** `resolveCell`, `ssrReadsFor`, `callerWritesFor`, `describeCellTools`, `callCellTool`, `describeTypes`.
- **Dependencies:** `aws-sdk` v2 `CloudFormation`/`S3`/`Lambda`/`CloudWatchLogs`/`DynamoDB.DocumentClient`, `esbuild-wasm`.

#### `dispatch`

- **Purpose:** `/@<owner>/<name>` userland tier-2 ingress. Trust boundary that turns a validated identity into SSR read-proxy + caller-write proxy.
- **Capabilities used:** `dispatch.allow(auth/cells/workspace)`. Used as `cellHostRouter` for cell-namespace distribution.
- **Public surface:** `GET|HEAD|POST|PUT|DELETE /@*`. `commands: {}` (purely HTTP).
- **Notable:** the only service where the cookie-auth path is honoured; sets `x-parc-writes-applied`/`refused`/`denied` response headers; honours `DISPATCH_DEFAULT_CELL` for unmatched paths.

#### `home`

- **Purpose:** Apex SPA — static HTML shell + esbuild-bundled `app.js`. Router default. (Being demoted to a userland tier-2 cell — `cells/home` — but tier-1 version still ships.)
- **Public surface:** `GET /`, `GET /index.html`, `GET /app.js`. Anything else → 405.
- **Manifest excerpt:** `HttpServiceCell({ name:'home', routes:[], clientEntry: services/home/client/main.tsx })`.

### 8.2 Tier-2 (Userland — provisioned at runtime by forge)

#### `cells/canvas` (`@c15r/canvas`)

- **Purpose:** Spatial projection of the substrate. Pannable/zoomable 2D canvas where geometry is `_canvas/<cid>/<key>` placement decoration; same fact appears on many boards.
- **Manifest:** `types.json` registers `canvas` (icon 🌲, manager `@c15r/canvas`, handlers `open/embed`).
- **Public surface:** `GET /` (SSR board/view, optional `?embed=1` zero-JS thumbnail), `GET /app.js`, `GET /style.css`. 405 read-only.
- **Capabilities used:** `STATE#<owner>` reads via LeadingKeys; writes via the kernel's `/mcp` (`workspace.remember`/`link`/`unlink`/`supersede`).
- **Deps:** `@c15r/kernel`, AWS SDK v3 (lazy), `xstate@4.38.3`, `d3-force@3.0.0`, marked, CodeMirror, mermaid (CDN, lazy).

#### `cells/home` (`@c15r/home`, tier-2 variant)

- **Purpose:** Two-faced front door — anonymous landing + signed-in dashboard. Auth-aware SSR (no anonymous-shell flash) via dispatch's `x-cell-caller`.
- **Manifest:** `ssr.json` declares 11 reads. `_home/layout` fact persists per-user section ordering.
- **Public surface:** `GET /`, `GET /app.js`. Sub-paths via `/@c15r/home/_data/...` for painted assets.
- **Deps:** `@c15r/kernel`, `react@18.3.1`, `marked@12.0.2`.

#### `cells/input` (`@c15r/input`)

- **Purpose:** Universal capture — PWA share_target / iOS Shortcut / desktop bookmarklet → substrate fact. Only GET. Captures land at `inbox/<base36-ts><rand3>` with type `capture`, day-tagged `log:<YYYY-MM-DD>`, edge `rel:'on'` to `log:<day>`.
- **Manifest:** `types.json` registers `capture` (manager `@c15r/input`, open delegates to `?doc=log:<value.captured>`).
- **Public surface:** `GET /`, `GET /app.js`, `GET /manifest.webmanifest` (PWA `share_target`), `GET /icon.svg`. Capture entry: `GET /@c15r/input?url=&title=&text=` or `?input=...`.
- **Deps:** `@c15r/kernel`.

#### `cells/kernel` (`@c15r/kernel`)

- **Purpose:** Shared client kernel ESM module imported by every tier-2 surface. Auth (PKCE OAuth, single `parc.session.*` namespace), MCP `read`/`act` client, origin/cell-host topology helpers, boot narration, theme tokens, fact `titleOf`/`hrefOf`.
- **Public surface:** `GET /app.js` (`application/javascript`, `Cache-Control: max-age=60`, ACAO `*`), `GET /` (HTML stub).
- **Exports:** `ensureAuth`, `login`, `signOut`, `requestScopes`, `isAuthed`, `accessToken`, `authFetch`, `cellAddress`, `cellUrl`, `mcp`, `read`, `act`, `bootStatus`, `bootFail`, `moduleAlive`, `loadTypes`, `titleOf`, `hrefOf`, `injectTheme`.

#### `cells/lit` (`@c15r/lit`)

- **Purpose:** Narrative authoring surface. A doc is a VIEW over substrate cell-facts (membership + order in `_doc/<id>/<cellKey>` decorations). Isomorphic SSR + hydrated React, dotlit-style fence meta-grammar, `[[wikilinks]]` as substrate edges, author-defined `_renderers/<type>` plugins, outputs-as-cells.
- **Manifest:** `types.json` registers `doc`/`doc-block`/`doc-order`. `client/imports.json` pins react/react-dom/marked/xstate/d3-force.
- **Public surface:** `GET /` (SSR doc-list / doc view, `?doc=`/`&edit=1`/`?doc=log:...`), `GET /app.js`. 405 read-only.
- **Capabilities:** `STATE#<owner>` reads via LeadingKeys; depends on `@c15r/viewers`, `@c15r/run`, `@c15r/models`, `@c15r/canvas`, `@c15r/input`.

#### `cells/models` (`@c15r/models`)

- **Purpose:** Generative-tier executor. Custodies provider API keys (Anthropic/OpenAI/Google). Exposes text/VLM/image generation + agentic loop whose toolbox is the substrate (machine-attested provenance via `Source = cell-models-<hash>`).
- **Manifest:** owns DDB table (SECRET#/JOB# items). Self-invoke for async jobs.
- **MCP tools:** `setProvider` (owner-only, write-only), `listProviders`, `run` (sync or async), `agent` (always async, with grants `{read, write}`), `fetch`.
- **Public surface:** `GET /_tools`, `POST /_tools/<name>`, `GET /`, `GET /secrets`.

#### `cells/reef-writer`

- **Purpose:** 23-line reference implementation of the organ-to-reef write path. Single MCP tool `report` emits `substrate.write.requested` with IAM-pinned `Source=cell-<id>` so the workspace handler lands the fact in the cell-owner's slice.
- **Public surface:** `GET /_tools`, `POST /_tools/report`. No persistence.

#### `cells/regwatch` (`@c15r/regwatch`)

- **Purpose:** UK-FCA regulatory monitoring inbox. First multi-user cell (owner + grantee reviewer). Items as DDB rows (not yet substrate facts — port noted as "organ-not-reef").
- **Manifest:** owns DDB table (ITEM/REVIEW/SOURCE/PROMPT/NOTE pk/sk patterns).
- **MCP tools:** 17 tools (`get_instructions`, `list_items`, `review`, `flag`, `post_note`, `resolve_note`, `ingest` (owner), `add_source`, `update_source`, `save_prompt`, `migrate`, ...).
- **Public surface:** `GET /` (mobile inbox SPA), `GET /app.js`, `GET /_tools`, `POST /_tools/<name>`. Address `regwatch-b0393000`.

#### `cells/run` (`@c15r/run`)

- **Purpose:** Code-tier executor. Server-side JS/TS execution with substrate-native `parc.read/query/emit` bindings. Async submit→self-invoke→fetch pattern.
- **Manifest:** owns DDB table (JOB# items, TTL=3600s). Self-invoke IAM grant on own ARN only.
- **MCP tools:** `exec({code, lang?, input?, async?})` (kind=act), `fetch({jobId})` (kind=read).
- **Public surface:** `GET /_tools`, `POST /_tools/<name>`.

#### `cells/starter` (`@c15r/starter`)

- **Purpose:** Canonical reference cell — exercises the full stack (isomorphic SSR, kernel auth, platform/ui, types.json `note` type, viewers, caller-writes for own-slice + cross-slice).
- **Manifest:** `types.json` registers `note`. `ssr.json` declares own-slice `note:` and cross-slice `shared/` writes.
- **Public surface:** `GET /`, `GET /app.js`, `POST /note`/`/notes`, `HEAD /`. Other methods 405.

#### `cells/viewers` (`@c15r/viewers`)

- **Purpose:** Pure-tier executor. Single ESM module of deterministic content-to-DOM transformers (json/csv/mermaid/style) + repl ElementView. Mounted by canvas (ElementView contract) and lit (`renderFence`).
- **Public surface:** `GET /` (landing), `GET /app.js` (ACAO `*`, cache 60s). 405 otherwise.
- **Exports:** `json`, `csv`, `mermaid`, `style`, `repl`, `renderFence(host, lang, code, ownerId?)`, `fenceLangs`.

### 8.3 Per-Cell Standard Pattern

Every tier-2 cell follows: `index.ts` (Lambda handler, no JSX) + optional `shared.tsx` (isomorphic) + `client/main.{ts,tsx}` (browser bundle to `app.js`) + `static/index.html` (HTML shell) + `client/imports.json` (pinned deps) + `types.json` + `ssr.json`.

### 8.4 Per-Cell DynamoDB Tables (Organ-Private Storage)

Every dynamic (tier-2) cell is provisioned with its OWN single-table DynamoDB resource by the cell template (`services/cells/cell-template.ts`). This per-cell table is operationally distinct from the shared substrate table and serves a different purpose: organ-private scratch and side-channels that should NOT be visible to the reef.

#### 8.4.1 Table shape and IAM scoping

- Schema: `pk` (HASH, S) + `sk` (RANGE, S), `PAY_PER_REQUEST`, no GSIs by default. Stable resource name `cell-<cellId>` so the IAM role can ARN-pin its grants.
- IAM grant pattern (the `OwnTable` statement): the cell role gets the full read+write DDB verb-set, but ONLY against `[<ownTableArn>, <ownTableArn>/index/*]`. No cross-table writes anywhere — a cell that needs another cell's data MUST go through that cell's tools (synchronous) or the event bus (asynchronous). The substrate, when injected, is read-only and gated by an IAM `dynamodb:LeadingKeys` condition pinning the cell to its owner's `STATE#/TRAJ#/SEQ#/IN#/TYPE#` partitions. The whole role is capped by the managed permissions boundary, so policy drift cannot escape the cell.
- Substrate writes are NEVER direct — they go through `events:PutEvents` with `events:source` IAM-pinned to the cell's service name, so a downstream substrate-write handler can trust the `Source` field as machine-attested provenance.

#### 8.4.2 Cell-private vs substrate (visibility rule)

The two stores answer different questions:

- The substrate table holds FACTS: `{value, _meta}`-shaped rows under `STATE#<owner>/KEY#<key>` (and the `TRAJ#/SEQ#/IN#/TYPE#` indexes). Facts are visible to home, attention, tend, and any other cell with the owner's slice grant. Provenance is server-stamped (`writer`, `revision`, etc.).
- A cell's own table holds ROWS: organ scratch with whatever schema the cell needs. Rows are invisible outside the cell — no other cell, no surface, no projection sees them unless the cell explicitly emits a fact. Examples observed in the codebase:
  - Auth cell: `USER#<id>`, `CRED#<credId>`, `CHAL#<id>`, `SESS#<id>`, `TOKEN#<hash>`, `USERTOK#<userId>/<id>`, `DEVUC#<userCode>` — identity and credential material.
  - Models cell: `SECRET#<provider>/v1` (provider API keys, write-only — no readback path), `JOB#<jobId>/v1` and `JOB#<jobId>/c<i>` (async job state and result chunks).
  - Regwatch cell: `ITEM/<collected_at>#<id>`, `ITEMID/<id>`, `URL/<url>` (dedupe guard), `REVIEW/<item_id>`, `SOURCE/<id>`, `PROMPT/<name>#v<NNNN>`, `NOTE/<created_at>#<id>`, `NOTEID/<id>` — application data that has not yet been promoted to facts.
  - Run cell: `JOB#<jobId>/v1`.

This is operational — and a design tension: rows that stay on the cell's table are invisible to the reef. They cannot be linked, salience-ranked, day-logged, or projected without an explicit emit.

#### 8.4.3 The 400KB item cap and the chunking pattern

DynamoDB caps a single item at 400KB. When a cell stores blob-shaped output that may exceed this (e.g. base64-encoded images), it MUST chunk across sibling rows under the same partition. The reference pattern (`cells/models/index.ts`):

- Use `pk: JOB#<jobId>` for both the envelope (`sk: v1`) and the chunks (`sk: c0`, `c1`, …).
- A conservative chunk budget of 300 KB of payload per row leaves headroom for attribute names, the JSON envelope, and DDB overhead.
- Record the `chunks` count on the envelope row; the read path concatenates `c0..c<chunks-1>` to reassemble. Anything materially larger than this should go to S3 (see `docs/cell-storage-s3.md`) with a pointer on the row, not a multi-megabyte chunked DDB blob.

#### 8.4.4 TTL strategies (and the table-config gap)

DynamoDB TTL is OPT-IN at the table level. The current `cell-template.ts` provisions the table without a `TimeToLiveSpecification`, which means a `ttl` attribute written by cell code is a no-op until TTL is enabled out-of-band. The spec MUST either:

- require the cell template to enable TTL on the `ttl` attribute (the recommended fix — cells already write `ttl` consistently); or
- declare TTL is per-cell out-of-band and document the operational consequence.

Observed retention strategies (treat as defaults the spec endorses, not hardcoded values):

- Short job retention (1 hour): models cell `JOB#` envelopes and `c<i>` chunks; run cell `JOB#` envelopes. Async-job state is ephemeral; the durable outcome is the substrate fact emitted on success, not the row.
- Per-artifact natural expiry: auth cell's `CHAL#`, `SESS#`, `TOKEN#`, `USERTOK#`, `DEVUC#`, refresh-token rows — `ttl` is computed from the artifact's `expiresAt`.
- Indefinite: regwatch's `ITEM`/`REVIEW`/`SOURCE`/`PROMPT`/`NOTE` rows have no TTL; the cell is the application's durable store until items are promoted to facts.

#### 8.4.5 Promotion: when cell-private state should become substrate facts

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

#### 8.4.6 Design rules for cell authors

Cell authors MUST:

- Treat their per-cell table as private organ scratch, not as a place to hide platform state. If the data wants to be seen by other cells or surfaces, emit it as a fact.
- Never attempt cross-table writes (the IAM policy will deny them). Substrate writes go through the event path with `Source` IAM-pinned to the cell.
- Chunk any value that may exceed ~300 KB across `pk-shared/sk-numbered` rows or punt to S3; do not assume a single-row write will succeed for arbitrary payloads.
- Write a `ttl` attribute on any row that is ephemeral, and assume the platform enables TTL on that attribute; design cell logic to tolerate row absence after the TTL window.
- Prefer write-only patterns for credentials and other secrets (no readback path), and rely on IAM-scoped reads as the only barrier — the table itself does not encrypt at the row level.

---

## 9. Build & Deploy

### 9.1 CDK Stack Topology (`bin/workspace.ts`)

Three top-level stacks:

1. **`PlatformStack`** (us-east-1, pinned in `bin/workspace.ts`) — wires the entire platform.
2. **`WorkspaceEc2Stack`** (eu-west-2) — personal Tailscale-only Ubuntu 24.04 t3.medium dev EC2; retained 100 GB data volume. Excluded from CI synth (AMI lookup needs live AWS).
3. **`InlineLambdaStack`** — intentionally empty (legacy teardown placeholder).

Stack id is `PlatformStack` for production, `PlatformStack-<env>` otherwise. Event bus is `platform-bus` for production, `platform-bus-<envName>` otherwise. `PUBLIC_BASE_URL` MUST NOT be derived from `router.distribution.distributionDomainName` — that creates a circular CFN dep.

### 9.2 Construct Composition (`lib/platform-stack.ts`)

```
PlatformStack
├── SubstrateTable                       (shared DDB blackboard)
├── PlatformEventBus                     (platform-bus)
├── DynamicCellControlPlane              (S3 codeBucket + CellBoundary ManagedPolicy)
├── HttpServiceCell × 7
│   ├── auth        (persistence: dynamo+ttl, clientEntry)
│   ├── workspace   (allow(auth, cells))
│   ├── home        (clientEntry, routes:[])
│   ├── gateway     (routes:[/mcp,/mcp/*], allow(auth, cells, workspace))
│   ├── cells/forge (memory:512, timeout:120, persistence:dynamo,
│   │                bundlingNodeModules:[esbuild-wasm,react,react-dom])
│   ├── dispatch    (routes:[/@*], allow(auth, cells, workspace))
│   └── (forge implicit inside DynamicCellControlPlane)
├── eventBus.routeTo                     (substrate.write.requested→workspace [source 'cell-'],
│                                         workspace.tend.requested cron 06:30 UTC,
│                                         workspace.fact.written→workspace [source 'workspace'],
│                                         cell.* lifecycle→workspace [source 'cells'],
│                                         cell.deploy.requested→cells [source 'cells'])
└── ServiceRouter                         (apex CloudFront + optional cell-namespace distribution)
```

### 9.3 Package Boundaries

`platform/CLAUDE.md` enforces a one-way dep graph:

```
lib/ (CDK stacks)  →  platform/infra  →  platform/manifest
                                       ↘
                                         platform/runtime  →  platform/manifest
                                       (infra never imports runtime)
```

Service cells import only from `'../../platform/runtime'`. Cells deep-import `platform/runtime/dynamo-state-store` (intentionally segregated — not re-exported from index).

### 9.4 HttpServiceCell Bundling

`platform/infra/http-service-cell.ts` injects an esbuild `commandHook` that synchronously shells out to `node -e "require('esbuild').buildSync(...)"` to bundle `clientEntry` into `app.js` adjacent to the Lambda handler. Loaders: `.jpg/.png/.webp → dataurl` so painted assets are inlined. `externalModules: []` (everything bundled). `bundlingNodeModules` adds modules into the Lambda asset for cells (cells service uses this for `esbuild-wasm`/`react`/`react-dom`).

### 9.5 Permission Boundary Pivot

`DynamicCellControlPlane.grantControlPlane(forge)` is the single call that:

- Grants forge `iam:CreateRole` **conditioned on** `iam:PermissionsBoundary == permissionBoundary.arn` — so every cell role MUST carry the boundary.
- Grants forge `cloudformation:*` on `cell-*`, `s3:*` on the codeBucket, `lambda:UpdateFunctionCode` on `cell-*`, `dynamodb:CreateTable` on `cell-*`, `logs:*` on `/aws/lambda/cell-*`.
- Injects env: `CELL_CODE_BUCKET`, `CELL_PERMISSION_BOUNDARY_ARN`, `CELL_EVENT_BUS_NAME/ARN`, `CELL_ACCOUNT_ID`, `CELL_REGION`, `CELL_SUBSTRATE_TABLE_NAME/ARN`.

The boundary caps every cell to: own table, own log group, events:PutEvents to the shared bus pinned to `events:source=cell-<id>`, `lambda:InvokeFunction` only on explicitly-granted peers, and read-only LeadingKeys-conditioned access to its owner's substrate slice.

### 9.6 Service-to-Service IAM

`HttpServiceCell.allow(target)` grants `lambda:InvokeFunction` and rewrites `SERVICE_REGISTRY` env in place (monotonically extended). Wired in `lib/platform-stack.ts`:

```
workspace.allow(auth, cells)
gateway.allow(auth, cells, workspace)
dispatch.allow(auth, cells, workspace)
forge holds invoke perms on cell-* via control-plane grant
```

### 9.7 Tier-2 Cell Provisioning (forge)

A `cells.create` call:

1. Slugifies name; `cellId = slug + '-' + sha256(owner:slug).slice(0,8)`.
2. Uploads initial code `cells/<cellId>/<uuid>.zip` to codeBucket.
3. Deploys per-cell CloudFormation stack `cell-<cellId>` with: `AWS::Lambda::Function` (FunctionName=`cell-<cellId>`, nodejs20.x, MemorySize=128, Timeout=p.timeoutSeconds??10), `AWS::DynamoDB::Table` (PAY_PER_REQUEST), `AWS::IAM::Role` (RoleName=`cell-<cellId>`, PermissionsBoundary set, inline policy: OwnLogs/OwnTable/InvokeSelf/PublishEvents pinned to `events:source = cell-<cellId>`, optional `SubstrateOwnScopeRead`).
4. Stack uses `OnFailure: DELETE` so orphan records can be reclaimed.

#### 9.7.1 The deploy event-driven worker (`onDeployRequested`)

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

#### 9.7.2 Delivery, idempotency, and retry semantics

- **At-least-once delivery.** EventBridge → Lambda async invocation is at-least-once. If `onDeployRequested` throws, AWS Lambda retries the asynchronous invocation per its async-retry policy (default: up to 2 additional attempts with backoff). No dead-letter queue or `onFailure` destination is configured at the rule or function level today; persistent failure after the retry budget is silently dropped from the bus side, and is observable to the caller only via the registry's terminal `FAILED` phase (set by the *last* attempt that reached the `catch` branch).
- **No content-pinned idempotency.** The worker does not consult `detail.version`; redelivery of the same event re-bundles from whatever is in S3 *now*. Implication: a redelivery after a subsequent `writeFile` will deploy the newer source, not the source that existed at original request time. The version stamped on the resulting package is the *worker's* `Date.now()`, so successful redeliveries produce monotonically increasing package versions.
- **Concurrent deploys for the same cell are not serialized.** Two `cells.deploy` calls in rapid succession both transition `deploy.phase` to `DEPLOYING`, both fan out as separate worker invocations, both bundle, and both call `updateFunctionCode`. The terminal `setDeploy` write is last-writer-wins, and may not correspond to the bundle that AWS ultimately serves. Authors who require ordered deploys MUST wait for `phase ∈ {DEPLOYED, FAILED}` before issuing the next `deploy`.
- **Multiple `cell.deployed` emissions per logical deploy are possible.** `cell.deployed` is emitted *inside* `deployCell`, before the terminal `setDeploy`. A successful first attempt followed by a redelivery (e.g. due to a downstream timeout in the registry write) emits `cell.deployed` twice with two different versions. Subscribers (notably the workspace projection of cell pointer facts) MUST be idempotent on `(cellId, version)`.

#### 9.7.3 Failure surfacing

- Failure is **pull-only**: callers poll `cells.get` and observe `record.deploy.phase = 'FAILED'` with `error` carrying the throwing exception's message. Common error shapes:
  - `Cell source failed to bundle: <esbuild diagnostic>` (compile error in user code).
  - `Cell client failed to bundle: <esbuild diagnostic>` (client-bundle error).
  - `dependency fetch <esm.sh URL> → <status>` (esm.sh outage or 404 on a declared dep).
  - `client/imports.json is not valid JSON` (bad import map).
- There is **no `cell.deploy.failed` bus event** in the current contract. (Adding one is a forward-compatible extension; until then, push-side observers cannot distinguish "deploy in flight" from "deploy permanently failed" without polling.)
- An esm.sh outage manifests as a `dependency fetch …` error on the *first* uncached fetch; subsequent attempts hit `/tmp/cell-dep-cache` *only* if the prior fetch succeeded for that pinned URL on the same warm container. There is no negative caching and no exponential backoff inside `fetchCached`.

#### 9.7.4 Resource budget and dependency cache

- The forge Lambda is provisioned with `memorySize: 512` MiB and `timeoutSeconds: 120`. A single bundle attempt (cold cache: esm.sh fetches for every declared dep, then `bundleFiles` server pass, then `bundleClientFiles` client pass, then `uploadPackage` to S3, then `updateFunctionCode`) MUST complete within 120 s; exceeding this surfaces as a Lambda timeout, which is treated as a transient async failure and retried per §9.7.2.
- The dependency cache lives at `${os.tmpdir()}/cell-dep-cache/<sha1(url)>` (i.e. Lambda `/tmp`, 512 MiB, per-execution-environment). It survives **warm** invocations of the same forge container and is wiped on cold start. Cache entries have no TTL and no integrity check beyond URL identity; cache key is `sha1(esm.sh URL)`, and the URL embeds the dep version, so a version bump produces a fresh key (stale entries simply leak until container recycle). Write failures (e.g. `/tmp` full) are swallowed and the bundle proceeds uncached.

#### 9.7.5 `SERVER_BUNDLED` allowlist (`react`, `react-dom`, `scheduler`)

- Bare imports inside a cell's server bundle are externalized by default (provided by the Lambda runtime — node builtins, the bundled `@aws-sdk`). The hard-coded allowlist `SERVER_BUNDLED = { 'react', 'react-dom', 'scheduler' }` is the exception: these names resolve via `require.resolve` against **forge's own** `node_modules`, and esbuild inlines them into the cell's `index.js`.
- The packages physically exist in forge's deployment artifact via `lib/platform-stack.ts` `bundlingNodeModules: ['esbuild-wasm', 'react', 'react-dom']` (`scheduler` is a transitive of `react-dom`, picked up by Node resolution). The choice to ship them in forge — rather than fetch them from esm.sh like every other declared dep — is deliberate:
  1. **Hydration consistency.** The cell's *client* bundle keeps `react`/`react-dom` external and the browser fetches them from esm.sh at the version pinned in `client/imports.json`. The *server* bundle binds React from forge's installed copy. SSR `renderToString` output hydrates without flash only when those two versions agree, so cell authors MUST pin `client/imports.json` to forge's installed React version. (This coupling is currently undocumented and brittle across forge upgrades — open: either expose forge's pinned versions to cells via `cells.describeRuntime`, or move React to esm.sh on the server too.)
  2. **Supply-chain narrowing.** The SSR path runs author code with platform credentials adjacent to it (the cell's IAM role); pinning React to a forge-installed, audited version reduces the per-deploy attack surface on the SSR critical path.
- Adding a package to `SERVER_BUNDLED` requires both an entry in the `Set` literal in `services/cells/transpile.ts` **and** an entry in `bundlingNodeModules` in the forge cell construction — the allowlist is not configuration; it is code, and changing it requires a forge redeploy.

### 9.8 GitHub Actions Deploy Path

The CI workflow only synths `PlatformStack(-staging)`; `WorkspaceEc2Stack` is excluded from CI synth. Custom domain handling: if `certificateArn` is given the cert is imported; otherwise CDK creates a DNS-validated cert and the deploy blocks until ISSUED — must not be run unattended (manual CNAME on Namecheap required).

### 9.9 Asset Pipeline Notes

- `platform/ui/*.{ts,tsx}` is **source-vendored** into cells via `scripts/sync-platform-ui.mjs` (copies into `cells/<cell>/shared/ui.tsx` + `vocab.ts`). Generated copies carry a `/* GENERATED — synced from platform/ui/... */` header. Edits go upstream; sync is manual.
- Cell `app.js` is read at runtime via `readFileSync(__dirname + '/app.js')` — bundling must place `app.js` next to the Lambda handler.

---

## 10. Open Questions

Aggregated from all card `open_questions`, deduped, grouped.

### 10.1 Runtime / SDK

- **`createDynamoStateStore` not re-exported from `platform/runtime/index.ts`** — workspace deep-imports it. Intentional API segregation or oversight?
- **`identityFromHeaders`** — dead code today; keep, deprecate, or document the trusted-edge model that re-activates it?
- **`PUBLIC_BASE_URL`** is read by the runtime but absent from `PlatformConfig`. Move into typed config?
- **`turso` config** is exposed in `PlatformConfig` but no runtime code consumes it. Who reads it and why is it in the runtime layer?
- **`AUTH_SERVICE_NAME`** is configurable but no deployment uses anything other than `'auth'`. Real use-case?

### 10.2 Substrate Semantics

- **`changes(scope, sinceSeq)`** does `recentTrajectory(scope, 0)` then filters in memory — O(scope-trajectory) per call. Mandate sk-range query?
- **`gsi2sk = updatedAt`** can collide within a millisecond. Should it include `seq` for total ordering?
- **`shape()`** can only re-tier (not recompute scores). Spec calls this out (§4.2.1) as "shape is for cross-scope merges, read is for in-scope ranking".
- **`createSubstrateWriteHandler`** — read-after-write consistency within the same Lambda invocation?
- **Tend schedule** hardcodes `scopes:['c15r']` — single-tenant; how does this scale?
- **`applicableGrants`** does N full slice reads for wildcard grants — caching plan?
- **Cross-scope writes** (grants) are currently mediated; when does an in-process trusted `ctx.substrate` direct-write become safe, and what does "trusted" mean in IAM terms?
- **GSI for cross-scope discovery** ("what was shared with me?") — does the grantee role get a second `LeadingKeys` clause for `GRANT#<self>`?
- **Username rename** is a one-shot migration — substrate scopes, S3 prefixes, dispatch addresses all embed the username. Migration shape (atomic vs piecewise) undefined.

### 10.3 Auth & Scope

- **`requestScope` self-serve elevation** assumes `auth.requestScope` is exposed by `auth.describeTools`; if not, the `scope_offer` message dead-ends.
- **`refresh resets effective to grant`** — known limitation; threat model that determines acceptability?
- **Stateless scope-elevation URL** (pre-filled `/oauth/authorize?scope=current ∪ missing`) is unbuilt.
- **Webhook ingress** is undecided (long-lived narrow-scope bearer / ingress cell with HMAC / declared `_triggers/`).
- **Per-caller (vs per-cell) grants** (the "grants-to-principals" design) — Bedrock named as first beneficiary; no concrete model yet.
- **Grants-as-facts** (single `_grants/<id>` substrate-as-fact store) is deferred — workspace grants live on dual-index `GrantStore`, cell grants on registry record.
- **Per-key-prefix write-narrowing of cell tokens** (the "declared(cell) intersection" half) is designed but unenforced.
- **Granular OAuth strings** beyond `read:workspace`/`write:workspace`/`cells:create` (e.g. `write:type:note`, `act:@owner/cell.tool`) — not implemented; trigger condition to re-open?
- **Hot-path cost of grant checks** joining token validation on every gateway call — measurements/budget?
- **∩ semantics with wildcards** (`workspace:*:read ∩ workspace:c15r/inbox:* = workspace:c15r/inbox:*:read`) — does `intersectScopePatterns` cover the full algebra?
- **Disclosure UI** for third-party-cell `disclosure {author, reads, writes, note}` block is exposed via `describeCellTools` but not yet rendered.
- **`cellCeiling` parses `<owner>-<name>`** by splitting on the first hyphen — cell names with hyphens (e.g. `me-too-cell`) are fine, but the rule should be specced.
- **Non-expiring deployment branch** issues access tokens with no refresh and a max-age cookie of 30 days — what if grant is shorter?
- **`handleConsent`** silently drops scopes the user can't grant — should an admin-scope request from a non-admin be 403?
- **`approveDeviceCode` 409** behaviour — make idempotent?
- **`scopeMeta auth:` prefix** is treated as admin but no scopes use it — reserved or obsolete?
- **`DEVUC#` rows** persist after device-code consumption — intentional?
- **`handleAuthOptions` rpId match** is strict, does not honour the registrable-suffix rule. Verified at §7.7 to be the correct behaviour given consistent `rpIdOf` resolution at registration.

### 10.4 MCP / Gateway

- **Resources/Prompts/Completions** are assessed-but-not-adopted; deferred until a second MCP client demands.
- **`structuredContent` and runtime validation of `resultSchema`** not yet implemented; results returned as JSON-as-text.
- **Tier-1 PROVIDERS list** is hard-coded. How does a new tier-1 cell join the gateway?
- **Tool aggregation truncation/partial-failure signal** — `MAX_TOOL_CELLS=25` bound and silent skip-on-error — how to surface?
- **`tools/call` swallows errors uniformly** as `isError`; should `ServiceAuthError` distinguish?
- **TOOLS map omits `importSrc`/`configureCell`** while the commands array lists them — manifest mismatch?
- **`catalogCells`** is "currently uncalled since the home `/_catalog` retired" — remove or expose?
- **`describeStack` swallows ValidationError** — conflates "doesn't exist" with bad params; can let `createCell` overwrite a healthy record under malformed input.
- **Anonymous `$catalog` for the public-cells directory** is blocked at the gateway (401 before dispatch); needs an anonymous-catalog path.

### 10.5 Routing / Origin Isolation

- **Move to a separate registrable domain** (e.g. `parc-usercontent.land`) — structural site-isolation vs current enforcement-based posture.
- **Reserve `--` as cell-name separator** vs registry-lookup-by-full-label (currently lookup is canonical).
- **`ServiceRouter` `cellDomain`** uses the first `cellDomainNames` only — contract for multiple wildcards?
- **`cells.codeBucket` CORS** hardcodes `https://parc.land` — should follow deployed `domainNames`?
- **HttpServiceCell `externalModules: []`** comment refers to v2 — still correct under Node 20 with v3 included?
- **Lambda@Edge `currentVersion`** pinning — runbook for the "replicas linger for hours" problem?
- **`HttpServiceCell.allow()`** rewrites `SERVICE_REGISTRY` per call — order-of-grant determinism?

### 10.6 Build & Deploy

- **`SubstrateTable` defaults to `RemovalPolicy.DESTROY`** — what gates flip to `RETAIN` in production? PlatformStack never passes `retain`.
- **`InlineLambdaStack`** "step two delete" trigger/criteria — undocumented owner.
- **`AMI lookup` for `WorkspaceEc2Stack`** picks up newer Canonical AMIs and may replace the instance — pin via SSM?
- **WorkspaceEc2Stack RETAIN data volume** has no tagging/lifecycle for orphan cleanup.
- **When `cellDomain` is unset**, gateway/auth env vars (`MCP_CORS_ORIGIN_SUFFIX`, `CELL_DOMAIN_SUFFIX`) are absent — defensive behaviour?
- **`cells` service `bundlingNodeModules`** versions of react/react-dom — coordinated with cell-author runtime? See §9.7.5 "Hidden React-version coupling".
- **Cell `app.js` build pipeline** — where does the bundler config that emits `app.js` next to `index.ts` live, per cell? Convention vs explicit step.
- **Auto-deploy on `s3:PutObject src/*`** (debounced builder via EventBridge→SQS) is noted but not built.
- **forge.promote credentialing** for emit-promotion-event + repo GitHub Action is unimplemented.
- **Orphan cleanup** of registry vs actual stacks; cells whose owner is gone.
- **Provisioning latency UX** (CreateStack + table-active is seconds-to-tens-of-seconds) — undecided contract.
- **No idempotency key on the deploy request.** Recommended fix: include `version` in the consumer's contract, or record a `deploy.attemptId` and skip redeliveries whose attemptId is already terminal.
- **No DLQ or `cell.deploy.failed` event.** A persistent failure after the async-retry budget is invisible to push subscribers.
- **No serialization across concurrent deploys.** Recommended: a conditional `setDeploy` that fences on the prior `version`, or a per-cell deploy lease.
- **Per-cell DDB tables lack `TimeToLiveSpecification`** in `cell-template.ts`, making cells' `ttl` writes a no-op until enabled out-of-band (see §8.4.4).

### 10.7 Cell Authoring

- **`cell` name collision** (deployable app vs doc-fragment in lit) — rename pending.
- **Run-as-caller for non-owner** (cross-principal `@c15r/run`) deferred to grants-to-principals.
- **First-open SSR for private docs** flashes "loading…" — needs dispatch passing session→x-cell-caller on every navigation.
- **`main.css` not served** by lit (only inlined `CRITICAL_CSS` reaches readers).
- **Plugin trust** (renderer-fact JS in reader's page; inline `<script>` in `html` facts) — sandbox decision before cross-owner sharing.
- **Edge-to-edge endpoints** (canvas meta-edges) don't map to substrate links; reify-as-fact noted but not built.
- **Realtime co-editing**: Yjs/WebRTC vs substrate `changes()` polling — boundary undecided.
- **Renderer-ladder `_renderers/foo` trust** — same as inline-HTML question.
- **Auto-layout salience-ordered tray** spec not finalized.
- **Public, signed-out canvas embeds** need read-grant or server-rendered SVG snapshot.
- **`canvas-002` hard-coded default** — placeholder or actual?
- **Rooms (multi-writer shared scopes)** explicitly deferred — access-control model when writers come from multiple owners.
- **Surface-declaration shape** — the single declaration that yields both an MCP tool and a `platform/ui` component (sync's view + render-hint).
- **CEL sandbox cost over DynamoDB** — `top_n()` on large collections; per-view evaluate-on-read vs materialize-on-write.
- **Bundled imports beyond `./relative.ts`** — full authoring parity with tier-1 cells.
- **regwatch reef projection** (`regwatch/inbox-count` fact, per-item facts) not yet implemented; cell invisible to home/attention/tend.
- **regwatch single-reviewer assumption** baked into `REVIEW pk/sk` — rekey before second reviewer.
- **regwatch `body_md` S3 offload** mentioned but not implemented.
- **regwatch migration tool URL allowlist** — owner-only mitigates but is the URL parameter itself a concern?
- **models cell webhook ingress** undecided (long-lived narrow bearer / ingress cell / declared triggers).
- **models per-caller grants** deferred.
- **models Google agent/tool-calling** support deferred.
- **models DEFAULTS list** pins specific model names — cell config or platform-managed?
- **models job TTL = 1h** but transcripts also persist as facts — retention mismatch?
- **models `x-cell-caller`** spec — how is the platform setting/verifying this; how is "anonymous" distinguished from spoofed?
- **run cell timeout/clamp** — Lambda configured timeout bounds it but exec sets no internal deadline.
- **run cell sandboxing** — `new Function(...)` shares Lambda globals/env with user code; is the IAM role tight enough?
- **run cell `_types/output` viewer wiring** — registration site for `out:` facts unclear.
- **run cell job TTL=3600s vs poll-after-expiry UX** — expired vs typo'd jobId indistinguishable.
- **run cell rate-limit/concurrency cap** on self-invoke fan-out.
- **`OWNER='c15r'` default** — single-tenant; provisioner wiring for other principals undefined.
- **TS support in run cell** is nominal (no type-stripping).
- **viewers cell build pipeline** — how `client/main.ts` becomes `app.js`.
- **viewers cell capability declaration** — does the cell declare `workspace.remember`/`@c15r/run.exec` requirements anywhere, or are they ambient via the host page?
- **viewers ACAO `*`** — safe given pure presentation code, but should the platform impose a tighter allowlist upstream?
- **viewers `el._factKey`** distinct from `el.id` — relationship between an element id and its underlying fact key undefined.
- **input cell schema canonicalisation** — `inbox/<ts><rand>`, daily log shape, `rel:'on'` edge — userland convention or platform-spec'd?
- **input cell kernel URL pinning** — `https://parc.land/@c15r/kernel/app.js` — stable contract or relative import?
- **PWA share_target path stability** — `/@c15r/input` must not break across redeploys.
- **kernel versioning/SRI** — is the 60s cache + "fail-loud-on-loop" the entire upgrade safety story?
- **Legacy token keys** (`parc.canvas.tokens` etc.) adoption — when can the adopt-once block retire?
- **`parc.session.tokens` localStorage** as long-term posture vs BroadcastChannel/IndexedDB.
- **DISPATCH_DEFAULT_CELL** owner/name with `/` cannot be expressed; grammar enforced upstream?
- **`502` from dispatch** leaks raw upstream error string — redact in non-debug?
- **Anonymous-shell flash**: home Phase 2b public-cells directory unimplemented; SSR vs client-only commitment pending.
- **`DEFAULT_SCOPE`** in home client requests `cells:create` for every sign-in — narrow per-user?
- **Hardcoded cell paths** (`/@c15r/lit`, `/@c15r/canvas`) in home tie owner-specific defaults — data-drive?
- **`loadTypeDecls`/`typeIcon`** exported from main.tsx but unused outside services/home — vestigial?
- **`/app.js` cache** (process-local + 300s public cache) — stale after deploy; ETag/version-stamped URL?
- **Per-room vs per-slice surfaces** when rooms land.
- **Offline/caching story** — `workspace.changes(sinceSeq:'head')` as invalidation signal not built.
- **dotlit `_actions/_views` DSL** — single-pass substitution; spec for nested params under CEL upgrade.
- **Streams→EventBridge change-feed fan-out** not built; cutover plan from poll-based undefined.
- **S3 cell-storage v2** — let cell role read/write its own `data/*` prefix; what blocks the symmetric grant?
- **Phase-4 status discrepancy** in capability-consent.md — ledger says "outstanding", below says "shipped". Code is implemented — which is canonical?
- **`cell:<id>` and `note` types in starter** — capability declaration source for this cell?
- **Kernel auth flow** — does sign-in implicitly grant lit's required scopes, or require a second consent prompt?
- **`html`-typed-fact `<script>` execution** — sandbox decision before sharing.
- **Plugins' `_renderers/foo` trust model** — agent-`remember`-able plugin facts.
- **Resolver consolidation** — sync `vocab.ts` to every cell that hosts viewers and migrate kernel `hrefOf` to `resolve`, vs keeping vocab vendoring narrow (§2.5.7).

### 10.8 Documentation Drift

- **`/d/*` doc-comment in dispatch** is stale lore; the implemented surface is `/@*`.
- **`docs/remote-mcp-implementation.md`** is older and partially superseded (single-tool DynamoDB Lambda vs current gateway/provider/dynamic-cell architecture).
- **`platform/ui` brief description** ("Platform-level UI shell — router, host page") does not match the code (component kit + vocab resolver; router is in `platform/infra`).

---

## 11. Asynchrony Model

The substrate runs on Lambda Function URLs behind CloudFront. The CloudFront → Function-URL edge caps every synchronous round trip at **~30 seconds** (origin read timeout) and does not hold response streams on the URL path today. This is not a tunable: raising the Lambda timeout (`cells.configureCell`, clamp 10–300s) lets a single invocation run longer, but the edge will still 502 while the work completes silently behind it.

This single constraint is the forcing function behind several architectural choices that are otherwise scattered across §5 (the gateway), §8 (cells), and §4 (the change feed). This section gathers them.

### 11.1 What MCP server→client features are deliberately absent

The MCP spec (2025-06-18) defines a Streamable-HTTP transport in which the client opens a long-lived GET/SSE stream alongside its JSON-RPC POSTs. A Lambda Function URL cannot hold that stream. The substrate's `defineMcpService` therefore exposes only the request/response leg of the transport, advertises `capabilities: { tools: {} }` in `initialize`, and **does not implement** the following spec features:

| Feature | Spec method / capability | Substrate substitute |
|---|---|---|
| Resource subscriptions | `resources/subscribe`, `notifications/resources/updated` | `workspace.changes(sinceSeq)` polling |
| Tool list aliveness | `tools.listChanged`, `notifications/tools/list_changed` | Catalog-as-data — `read("$catalog")` is always live; three meta-tools (`whoami`/`read`/`act`) so a new capability never requires a `tools/list` refresh |
| Progress | `notifications/progress` | Job records (`{phase\|status, version, requestedAt, error?}`) read with `cells.get` / `<cell>.fetch` |
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

---

*End of specification.*
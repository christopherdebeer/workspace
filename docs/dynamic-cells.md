# Dynamic Cells — A Reflexive Two-Tier Platform

> **Naming update:** the control-plane cell is now named **`cells`** (was
> `forge`), and its tools use bare verbs — `cells.create`, `cells.call`,
> `cells.deploy`, `cells.logs`, … (was `forge.createCell`, etc.). This doc still
> says "forge" in prose; read it as `cells`. See `docs/platform-cells.md`.


This document describes how the platform extends from a fixed set of
build-time service cells into a **reflexive** platform: one that can create new,
capability-scoped, user-owned cells *at runtime, through its own API*, and later
graduate the good ones into reviewed infrastructure.

It is a design document. Nothing here is built yet; it exists to be reviewed on
its own before code lands. It builds directly on the architecture in
[`serverless-platform.md`](./serverless-platform.md) and reuses its primitives
unchanged wherever possible.

## The thesis

The platform should be able to grow itself. An agent (or a user) should be able
to call a tool — *through the platform* — and have a new, isolated, observable,
shareable cell come to life, without a `cdk deploy` and without anyone editing
infrastructure. The cells that prove themselves should then have a clean path to
becoming first-class, reviewed platform primitives.

This produces a closed loop:

```
   author a cell  ──►  it runs (isolated, scoped, observable)  ──►  it proves useful
        ▲                                                                   │
        │                                                                   ▼
   reviewed in git/CDK  ◄──  promote (open a PR)  ◄──────────────────  graduate
```

## Two tiers, by necessity

There are two tiers, and the split is deliberate — not an accident of
implementation.

### Tier 1 — the kernel (git + CDK, build-time)

The stable, reviewed core. Everything in `lib/platform-stack.ts` today: the
router, the auth cell, the event bus, the example cells. It is changed only
through pull requests and `cdk deploy`. It is **universal** (applies to all
users) and **slow to change** (by design — review is the point). Tier 1 provides
the *primitives*.

### Tier 2 — userland (dynamic cells, runtime)

Cells created at runtime by the control plane. They are:

- **user-owned** — minted by a principal, private to that principal by default;
- **permission-expandable** — the owner can grant other users access (sharing);
- **built from the same primitives** tier 1 provides (the same runtime library,
  the same resource shape);
- **fast to change** — created/updated/destroyed live, as data;
- **promotable** — a proven dynamic cell can be codified into tier 1.

> **Private-and-dynamic → reviewed-and-universal.** That promotion path is the
> reason the two tiers are worth having. Tier 2 is where ideas are tried cheaply;
> tier 1 is where the proven ones are made permanent and shared with everyone.

## The key idea: every primitive becomes runtime-multiplexed

Today each platform primitive exists in a **per-cell, build-time** form: one
CloudFront behavior per cell, one Lambda per cell, one table per cell — all
synthesized by CDK. For tier 2 to *inherit* these primitives, each must also have
a **data-driven, multi-tenant** form that tier 1 provides once and userland
shares.

| Primitive      | Tier-1 today (build-time)                    | Tier-2 form (runtime)                                                   |
| -------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| Routing        | one CloudFront behavior per cell route       | a single `/@*` behavior → a **dispatcher** that routes `/@<owner>/<cell>` |
| Execution      | a bundled Lambda per cell                    | a **per-cell Lambda**, provisioned at runtime by the control plane      |
| Isolation      | one IAM role per cell                        | one IAM role per cell **under a permission boundary** (the safety cap)  |
| Persistence    | one DynamoDB table per cell                  | one DynamoDB table per cell (same; see "Cell state")                    |
| Auth / caps    | scopes in a validated bearer token           | a **scope grammar** for userland + owner-granted sharing                |
| Self-model     | `CfnOutput` manifests → `/_catalog`          | a **registry table** both tiers register in; the catalog merges them    |
| Events / MCP   | per cell                                     | unchanged — identity/source is the `cellId`                             |

The two primitives that already generalize cleanly (EventBridge events and the
MCP transport via `defineMcpService`) are why this is reachable at all. The two
that needed a decision were **execution/isolation** and **routing**.

## The execution model: Lambda + IAM *is* the sandbox

The hard question for any "run user-defined cells" platform is isolation. The
usual answers are an in-process sandbox (isolated-vm, QuickJS), per-tenant
infrastructure, or offloading to an external runtime. We take a different one:

> **A dynamic cell is its own real Lambda, with its own scoped IAM role, and its
> own DynamoDB table.** Isolation is provided by AWS — the function/account/role
> boundary — not by an in-process sandbox we have to build and secure.

This is deliberate and has three consequences that make it the right call:

1. **Strong isolation without building a sandbox.** Two dynamic cells cannot see
   each other's memory, credentials, or data — they are separate Lambdas with
   separate roles. The OS/account boundary does the work.
2. **AWS-native** (platform tenet): no third-party execution substrate.
3. **Promotion is nearly free** — see below — because a runtime-provisioned
   `Lambda + Table + Role` and the CDK-declared version of the same thing are
   *the same resources*.

The control plane's blast radius is capped to exactly two resource types: a
Lambda and a table (plus the cell's scoped role). It cannot create anything else.

### "Still CDK? But runtime?"

Both — at different layers, and that distinction is the whole trick:

- **Tier 1 is authored and deployed with CDK at build time**: the control plane,
  the dispatcher, the event bus, the registry table, the permission boundary,
  and — crucially — **the cell template itself**.
- **The cell template is authored once in CDK and emitted at build as a
  parameterized CloudFormation template** (parameters: `cellId`, `owner`,
  `codeS3Key`, `requiredScopes`). The control plane deploys *instances* of that
  template at runtime via `CreateStack`. You never leave CDK as the authoring
  model; you only defer *when* an instance is deployed.

This avoids running `cdk synth` (jsii + `node_modules`) in the request path,
while keeping a single CDK definition that serves both tiers. Per-cell
CloudFormation stacks also give lifecycle management for free: delete-stack is a
clean teardown, tags carry ownership, and a failed create rolls back.

## Architecture

```
                                  parc.land
                                     │
                                     ▼
                            CloudFront Router
          ┌──────────────┬───────────┼─────────────────┐
   tier-1 behaviours  /mcp (gateway)  │            /@*  (one behaviour)
   (auth, docs, …)        │           │                 │
                          ▼           │                 ▼
              MCP gateway (resource)  │           dispatch cell
              aggregates + scope-     │          (/@<owner>/<cell>)
              filters + forwards      │                 │
                          └─────────┐ │ ┌───────────────┘
                                    ▼ ▼ ▼
                                   forge  (backend, no public route)
                              (control plane)
              ┌──────────────────────┼──────────┐
              ▼                       ▼          ▼
        CreateStack            Registry table   S3
     (per-cell template)     (the self-model)  (code)
              │
              ▼
      Lambda + Table + Role   (the dynamic cell, under the boundary)
```

### Components

**`/mcp` gateway (the `resource` cell)**
The single authenticated MCP surface (and the OAuth-protected resource the auth
cell advertises). It is a `defineMcpService` exposing a deliberately tiny,
**stable** tool list — `whoami`, `read`, `act` — where all capability lives in the
*arguments*, not the tool names. It is the **policy enforcement point**: each
capability's scope is checked here against the caller before forwarding, and the
backend receives only the caller's `user` and authorises by ownership.

**Why `read`/`act` instead of one named tool per capability.** Named MCP tools are
cached by clients at connect, so a newly added capability (a new cell, a new
command) does not appear until the client *reconnects*. A stable two-verb surface
sidesteps that entirely: the tool list never changes, so a capability is callable
the instant it exists — **true dynamism, no reconnect**. It also mirrors the
substrate's own read/put duality, lifted to the whole platform: `read` observes,
`act` effects.

```
read({ target?, input? })   // side-effect-free. target "$catalog" (or omitted)
                            //   → the capability menu, as data, always current
act ({ target, input? })    // may mutate
```

A `target` is a **dotted address**, resolved per request from one capability
registry:

- `<cell>.<command>` — **tier-1** kernel cells, an explicit reviewed allow-list
  (`PROVIDERS = ['workspace','forge']`), reached by name over an allow-listed
  invoke. e.g. `workspace.recall`, `forge.createCell`.
- `@<owner>/<cell>.<tool>` — **tier-2** dynamic cells, **registry-driven**: the
  gateway resolves via `forge.describeCellTools` (which enumerates the caller's
  accessible ACTIVE cells, or one cell given an owner+name selector) and forwards
  via `forge.callCellTool`, authorised by ownership. So a cell **created at runtime
  is callable through `act`/`read` with no gateway change and no `cdk deploy`** —
  and, because the tool list is fixed, with no reconnect either.

Each capability declares `kind: 'read' | 'act'`; the gateway routes `read` to
read-kind targets (plus the `$catalog`) and `act` to act-kind targets, refusing to
cross the boundary. `read("$catalog")` returns the menu scope-filtered to what the
caller may use.

**The cell-tool convention** (deliberately tiny, opt-in — how a dynamic cell joins
the surface):
  - `GET  /_tools`        → `{ tools: [{ name, description, inputSchema, scope?, kind? }] }`
  - `POST /_tools/<name>` → (JSON body = arguments) → the tool's result

A cell that doesn't answer `/_tools` simply contributes nothing. Discovery is
capped (`MAX_TOOL_CELLS`) and, for the catalog, probes cells live; caching each
cell's manifest in the registry is the obvious next optimisation. (`callCell`
remains the lower-level generic invoke; `act` is the policy-enforced, registry-
addressed surface over it.)

**`forge` — the control plane (backend tool-provider, no public route)**
Reachable only via allow-listed invokes (from the gateway and `dispatch`). It
exposes `describeTools` (so the gateway can discover its tools) plus the handlers:

- `createCell(name, code)` — **transpile** the submitted TypeScript (`esbuild-wasm`),
  zip + upload to S3, write the registry row, `CreateStack` from the cell
  template. Live when the stack reaches `CREATE_COMPLETE`.
- `getCell` / `listCells` / `deleteCell`.
- `callCell({ cellId | owner+name, method, path, body })` — invoke the cell over
  the *same* MCP connection (no second session); also the target `dispatch`
  proxies to. Authorised by ownership/grant on the caller's `user`.
- `grantCapability(cellId, principal)` — sharing (expand permissions).
- `cellLogs({ cellId | owner+name, since?, limit?, filter? })` — tail the cell's
  CloudWatch logs (observability as a tool; forge has scoped read on
  `/aws/lambda/cell-*`).
- `resolveCell(cellId)` — internal command for `dispatch` (not an MCP tool).
- `promote(cellId)` — (planned) open a PR that codifies the cell into tier-1 CDK.

Cells are authored in **TypeScript** (so a cell is written the same way as a
tier-1 cell, making promotion a copy rather than a port); `forge` transpiles with
`esbuild-wasm` — portable WASM shipped in its Lambda asset — before packaging.

`forge` holds the *only* IAM permissions in the platform that can provision: it
can manage `cloudformation` `cell-*` stacks, read/write the code bucket, write
the registry table, and `iam:CreateRole` **only with the permission boundary
attached** (the condition that makes the blast radius provable).

**The cell template (`services/forge/cell-template.ts`)**
Defines one dynamic cell: a Lambda (code from S3), a DynamoDB table, and an
execution role with the permission boundary — emitted as a CloudFormation
template, authored once and instantiated per cell at runtime via `CreateStack`.

**The permission boundary (tier-1 managed policy) — the security crux**
Attached to every dynamic-cell role. It caps what *any* cell can ever do,
regardless of what code runs inside it:

- read/write **only its own table** (scoped to that table's ARN);
- write **only its own** log group;
- `events:PutEvents` to the shared bus;
- `lambda:InvokeFunction` on **only explicitly-granted** peer cells.

Because `forge` may only create roles that carry this boundary, "the control
plane can only ever make a constrained Lambda + table" is an enforced property,
not a convention.

**The registry table (`forge`'s own DynamoDB table) — the self-model**
`cellId → { owner, name, functionName, stackName, grants[], status, … }`. The
runtime, data-backed half of the platform's self-description. Other cells never
read it directly — they ask `forge`, preserving the cell boundary: `dispatch`
asks via `resolveCell`, and the `home` cell merges the caller's cells into
`/_catalog` via `forge.catalogCells` (scoped to cells the caller owns or was
granted, so it never leaks other owners' private cells).

**`dispatch` — userland routing (`services/dispatch`)**
Owns a single route, `['/@*']`, so it slots into the existing `ServiceRouter`
with no router changes (the router generates one behavior from its manifest).
For `/@<owner>/<cell>/<rest>` it requires a bearer identity, then proxies to
`forge.callCell` (Mode 1 command) — which holds the registry and the invoke
permission — rather than reading another cell's table or invoking the cell
itself. Userland routing is therefore **one behavior plus data dispatch** — not
one behavior per cell (which would be build-time infrastructure).

### Reused unchanged

- **Auth / scopes** — identity is derived from a validated bearer token exactly
  as in `define-service.ts`; scopes live in the token's `scope` string.
- **Events** — a dynamic cell emits to the shared bus with `source = cellId`.
- **MCP** — a dynamic cell can itself be a `defineMcpService`, reachable at
  `/@<owner>/<cell>/mcp`.
- **The runtime library** — a dynamic cell is authored with the *same*
  `defineService` / `defineMcpService` as a tier-1 cell.

## Capabilities and sharing (the scope grammar)

Define the userland scope namespace now, because tokens encode it and sharing
depends on it; retrofitting addressing is painful.

- Kernel scopes: `platform:*`. **Creating** a cell requires
  `platform:cells:create` (enforced on `createCell`).
- **Sharing = granting principals.** A cell starts private to its owner
  (`grants = [owner]`). The owner calls `grantCapability(cellId, principal)` to
  add a user to `grants[]`; `callCell`/`dispatch` authorise the caller's identity
  (`ctx.identity.user`) against owner-or-`grants` on every invocation. This works
  over both the MCP path and a direct invoke (where only the user, not scopes,
  propagates). Per-cell *scope* grammar (`cell:<owner>:<name>:<verb>`) is the
  planned next step for finer-grained, scope-based sharing.

## Promotion: from userland to kernel

Because a dynamic cell is authored with the same runtime library and provisions
the same resources as a tier-1 cell, graduating it is almost mechanical:

`forge.promote(cellId)` opens a pull request that adds an
`HttpServiceCell({ name, entry })` to `lib/platform-stack.ts`, pointing at the
**same code module** already stored in S3. Review happens in git; on merge,
`cdk deploy` makes it a permanent, universal primitive. Runtime-provisioned and
CDK-declared are the same resources — promotion just moves the declaration under
review. No rewrite.

## Cell state

Each dynamic cell gets **its own DynamoDB table** (provisioned inside its stack).
Rationale:

- the permission boundary becomes **resource-based and trivial** — "this table
  ARN only" — rather than a condition on a partition key;
- teardown is "drop the stack" (which drops the table);
- it is **isomorphic to a promoted tier-1 cell**, which also owns its table —
  reinforcing the promotion path.

The trade-off is the per-region DynamoDB table quota (~2500, raisable). If a
single owner ever needs an extreme number of cells, a shared-table-partitioned
mode can be added later as an option; per-cell tables are the right default for
clean isolation and simple promotion.

## Security summary

The entire safety argument rests on three facts, all enforced by IAM:

1. **Only `forge` can provision**, and only `Lambda + Table + Role` on
   cell-tagged stacks.
2. **`forge` can only mint roles that carry the permission boundary**
   (`iam:CreateRole` is conditioned on it).
3. **The boundary caps every cell** to its own table, its own logs, bus
   publication, and explicitly-granted peers — so even fully arbitrary code
   inside a dynamic cell cannot exceed it.

Isolation between tenants is the Lambda/account boundary; capability scoping is
the boundary policy plus the dispatcher's scope check; auditing is the `forge`
mutation log.

## First vertical slice (implemented)

The slice that proves the whole loop end-to-end is built (`services/forge`,
`services/dispatch`, the `/mcp` gateway in `services/resource`,
`platform/infra/dynamic-cell-control-plane.ts`, wired in `lib/platform-stack.ts`,
unit-tested in `tests/forge-cell.test.ts` / `tests/resource-cell.test.ts` /
`tests/dispatch-cell.test.ts`):

1. **Permission boundary + code bucket** (`DynamicCellControlPlane`) and the
   scoped grant to `forge`.
2. **Cell template** (`cell-template.ts`) — the per-cell CFN stack.
3. **`forge`** backend provider: `createCell` / `getCell` / `listCells` /
   `callCell` / `grantCapability` / `deleteCell` / `describeTools`, authoring
   cells in TypeScript.
4. **`/mcp` gateway** (`resource`) aggregating + scope-filtering + forwarding.
5. **`dispatch` cell** on `/@*`.

Result: an MCP `tools/call` to `createCell` at `/mcp` → scope-checked at the
gateway → forwarded to `forge` → a `CreateStack` → an owner-isolated cell live at
`/@<owner>/<cell>` and invocable via `callCell` over the same connection. The
reflexive loop, with isolation provided by Lambda + IAM rather than a sandbox.

### End-to-end validation — round-trip proven live ✓

`https://parc.land/mcp` is live and an MCP client **connects, authenticates**,
and has now exercised the full reflexive loop over MCP: `createCell`
(`hello-parc`) → `getCell` polled to `ACTIVE` → `callCell` returned the cell's
JSON `{ hello, cell }` from its own isolated Lambda+table → `cellLogs` read that
invocation's CloudWatch logs back through MCP. The `/@<owner>/<cell>` dispatch
route is wired and enforces the bearer (an unauthenticated `GET` returns `401`).
**A cell created via MCP returned a response via MCP** — the loop is closed.

### Connecting an MCP client — the auth path (hard-won; don't re-derive)

Getting a strict MCP client (Claude.ai) to connect required four fixes beyond
the basic OAuth/passkey flow. All are in the code now; documented so the next
session doesn't rediscover them:

1. **RFC 9728 path-suffixed PRM.** Clients fetch protected-resource metadata at
   `/.well-known/oauth-protected-resource/mcp` (well-known path *before* the
   resource path), not just the bare path. The auth cell serves both
   (`services/auth/service.ts`), and the `401 WWW-Authenticate` points at the
   suffixed URL.
2. **CloudFront OAC clobbers `Authorization`.** OAC SigV4-signs the origin
   request and **overwrites the viewer's `Authorization` header** with its
   signature — so bearer tokens never reach the cell. The origin-request
   Lambda@Edge (`platform/infra/service-router.ts`) copies the viewer bearer into
   `x-forwarded-authorization` before OAC runs, and the runtime
   (`define-service.ts`) reads the bearer from either header. **This is the bug
   that made every `/mcp` call 401 with a valid token** (`hadBearer:false`).
3. **Scope picker + admin gating.** Claude.ai's OAuth never requests custom
   scopes, so the React consent screen (`services/auth/client/main.tsx`) lets the
   user pick scopes. `platform:*` is admin-gated (`AUTH_ADMIN_USERNAMES=c15r`),
   enforced at consent (`oauth.ts grantableScopes`) — so only `c15r` can grant
   `platform:cells:create`.
4. **Passkey recovery.** A credential registered under older code / a different
   RP can't be matched (`Unknown credential`); recovery is to delete the
   `UNAME#<user>` item and re-register. WebAuthn verify errors now self-describe
   (`webauthn.ts` logs + returns expected RP/origin).

End-to-end tracing logs (`[oauth] token:`, `[mcp] 401 …`, `[auth] bearer …`) are
in place across the token endpoint, gateway, and identity resolver.

## Status / handoff (for the next session)

- **Deployed & green** on `parc.land` (account `018159942401`, us-east-1) via the
  `Deploy CDK` GitHub workflow; branch work is on PR #112 → `main`.
- **Done:** the aggregating `/mcp` gateway, routeless `forge` backend, `/@*`
  dispatch, permission boundary + code bucket, the cell template, the React
  authorize page + scope picker, the four connect fixes above, and `cellLogs`.
- **Done since:** the live `createCell`/`getCell`/`callCell`/`cellLogs` round-trip
  (validated against `https://parc.land/mcp`), and the **`/_catalog` merge** —
  `home` now surfaces the caller's own + granted dynamic cells beside the static
  tier-1 manifests (`forge.catalogCells`, scoped per caller).
- **Next:** implement `forge.promote` (open the CDK PR). The remaining design
  decision is how `forge` authenticates to GitHub from the runtime Lambda
  (favoured approach: emit a promotion event + repo GitHub Action, keeping
  repo-write credentials out of the cell runtime).

## Open questions / future work

- **Provisioning latency & UX** — `CreateStack` + table-active is
  seconds-to-tens-of-seconds; cell *creation* is async ("creating…" → "live"),
  while code *updates* (`UpdateFunctionCode`) are fast. Decide the UX contract.
- **Quotas** — Lambda count (soft, raisable), CloudFormation stacks (~2000/region),
  DynamoDB tables (~2500/region). Fine at small scale; revisit before high
  cell-count owners.
- **Bundled imports** — v1 transpiles a single self-contained TS module; bundling
  imported modules (so cells can `import` the platform runtime via a layer or a
  virtual module) is the next step toward full authoring parity with tier-1 cells.
- **Catalog merge** — ✓ done. `home`'s `/_catalog` merges the caller's own +
  granted dynamic cells (`forge.catalogCells`) beside the static tier-1
  manifests.
- **Promotion** — implement `forge.promote` (open the CDK PR).
- **Orphan cleanup** — reconciling the registry against actual stacks; deleting
  cells whose owner is gone.
- **Declarative cells** — a higher-level "composition of existing primitives"
  cell (no arbitrary code) can later ride on top of this substrate as a
  convenience tier; the IAM-isolated model already makes arbitrary code safe, so
  it is not a prerequisite.

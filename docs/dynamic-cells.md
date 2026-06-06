# Dynamic Cells — A Reflexive Two-Tier Platform

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
                    ┌────────────────┼─────────────────────┐
        tier-1 behaviours            │              /@*  (one behaviour)
        (auth, documents, …)         │                      │
                                     ▼                      ▼
                                  forge  ◄── MCP ──►   dispatch cell
                            (control plane)         (/@<owner>/<cell> →
                                     │               forge.callCell)
              ┌──────────────────────┼──────────┐            │
              ▼                       ▼          ▼            ▼
        CreateStack            Registry table   S3      per-cell Lambda
     (per-cell template)     (the self-model)  (code)   + per-cell table
              │                                          (under permission
              ▼                                            boundary)
      Lambda + Table + Role
      (the dynamic cell)
```

### Components

**`forge` — the control plane (tier-1 cell, MCP)**
A normal `HttpServiceCell` whose handler is a `defineMcpService`. It is the
*inward* API — the reflexive seam. Tools:

- `createCell(name, code)` — **transpile** the submitted TypeScript (`esbuild-wasm`),
  zip + upload to S3, write the registry row, `CreateStack` from the cell
  template. Live when the stack reaches `CREATE_COMPLETE`.
- `getCell` / `listCells` / `deleteCell`.
- `callCell({ cellId | owner+name, method, path, body })` — invoke the cell over
  the *same* MCP connection (no second session); also the target `dispatch`
  proxies to.
- `grantCapability(cellId, principal)` — sharing (expand permissions).
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
read it directly — they ask `forge` (`resolveCell`), preserving the cell
boundary. (Merging it into `/_catalog` is a planned follow-up.)

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
`services/dispatch`, `platform/infra/dynamic-cell-control-plane.ts`, wired in
`lib/platform-stack.ts`, unit-tested in `tests/forge-cell.test.ts` +
`tests/dispatch-cell.test.ts`):

1. **Permission boundary + code bucket** (`DynamicCellControlPlane`) and the
   scoped grant to `forge`.
2. **Cell template** (`cell-template.ts`) — the per-cell CFN stack.
3. **`forge` cell** (MCP): `createCell` / `getCell` / `listCells` / `callCell` /
   `grantCapability` / `deleteCell`, authoring cells in TypeScript.
4. **`dispatch` cell** on `/@*`.

Result: an MCP `tools/call` to `forge.createCell` → a `CreateStack` → a
capability-scoped, owner-isolated cell live at `/@<owner>/<cell>` and invocable
via `forge.callCell` over the same MCP connection. The reflexive loop, with
isolation provided by Lambda + IAM rather than a sandbox.

### End-to-end validation (acceptance test)

The deployed acceptance test: connect an MCP client to
`https://parc.land/forge/mcp`, authorised (via the auth cell's OAuth) with a
token carrying `platform:cells:create`; call `forge.createCell` to provision a
cell; poll `getCell` until `ACTIVE`; then `forge.callCell` it over the **same**
connection — and/or `GET https://parc.land/@<owner>/<cell>`.

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
- **Catalog merge** — surface registry cells in `/_catalog` alongside the static
  tier-1 manifests.
- **Promotion** — implement `forge.promote` (open the CDK PR).
- **Orphan cleanup** — reconciling the registry against actual stacks; deleting
  cells whose owner is gone.
- **Declarative cells** — a higher-level "composition of existing primitives"
  cell (no arbitrary code) can later ride on top of this substrate as a
  convenience tier; the IAM-isolated model already makes arbitrary code safe, so
  it is not a prerequisite.

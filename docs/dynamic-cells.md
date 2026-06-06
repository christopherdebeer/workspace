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
| Routing        | one CloudFront behavior per cell route       | a single `/d/*` behavior → a **dispatcher** that routes by `cellId`     |
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
                              app.example.com
                                     │
                                     ▼
                            CloudFront Router
                    ┌────────────────┼─────────────────────┐
        tier-1 behaviours            │                 /d/*  (one behaviour)
        (auth, documents, …)         │                      │
                                     ▼                      ▼
                                  forge  ◄── MCP ──►   dispatch cell
                            (control plane)            (resolve cellId,
                                     │                  scope check, invoke)
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

- `createCell(name, code, manifest, requiredScopes)` — upload `code` to S3, write
  the registry row, `CreateStack` from the cell template. Live when the stack
  reaches `CREATE_COMPLETE`.
- `updateCell` / `getCell` / `listCells` / `deleteCell`.
- `grantCapability(cellId, principal | scope)` — sharing (expand permissions).
- `promote(cellId)` — open a PR that codifies the cell into tier-1 CDK.

`forge` holds the *only* IAM permissions in the platform that can provision: it
can `cloudformation:*` on cell-tagged stacks, `s3:PutObject` to the code bucket,
write the registry table, and `iam:CreateRole` **only with the permission
boundary attached** (the condition that makes the blast radius provable). Every
mutation is appended to an audit log.

**The cell template (tier-1 CDK construct → parameterized CFN template)**
Defines one dynamic cell: a Lambda (code from S3), a DynamoDB table, and an
execution role with the permission boundary. Authored once; instantiated per
cell at runtime.

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

**The registry table (tier-1 DynamoDB) — the self-model**
`cellId → { owner, functionName, tableName, routes, requiredScopes, grants[],
status }`. The runtime, data-backed half of the platform's self-description. The
catalog (`/_catalog`) merges these rows with the static tier-1 manifests, so both
tiers are described uniformly.

**`dispatch` — userland routing (tier-1 cell)**
Owns a single route, `['/d/*']`, so it slots into the existing `ServiceRouter`
with no router changes (the router generates one behavior from its manifest).
For `/d/<cellId>/...` it resolves `cellId` in the registry, checks the caller's
token scopes (`ctx.identity.scopes`) against the cell's `requiredScopes + grants`
using the existing auth path, invokes the cell's Lambda, and returns the
response. Userland routing is therefore **one behavior plus data dispatch** —
not one behavior per cell (which would be build-time infrastructure).

### Reused unchanged

- **Auth / scopes** — identity is derived from a validated bearer token exactly
  as in `define-service.ts`; scopes live in the token's `scope` string.
- **Events** — a dynamic cell emits to the shared bus with `source = cellId`.
- **MCP** — a dynamic cell can itself be a `defineMcpService`, reachable at
  `/d/<cellId>/mcp`.
- **The runtime library** — a dynamic cell is authored with the *same*
  `defineService` / `defineMcpService` as a tier-1 cell.

## Capabilities and sharing (the scope grammar)

Define the userland scope namespace now, because tokens encode it and sharing
depends on it; retrofitting addressing is painful.

- Kernel scopes: `platform:*` (e.g. `platform:cells:create`).
- Userland scopes: `cell:<owner>:<name>:<verb>` (e.g.
  `cell:alice:notes:invoke`).
- **Sharing = granting scopes.** A cell starts private to its owner. The owner
  calls `grantCapability` to add a principal or scope to the cell's `grants[]`;
  `dispatch` enforces caller scopes against `requiredScopes + grants` on every
  invocation. This is the "permission-expandable to more users" property.

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

## First vertical slice (proposed build order)

The smallest change set that proves the whole loop end-to-end:

1. **Registry table + permission boundary** (CDK, in `PlatformStack`).
2. **Cell template** — CDK construct emitted as a parameterized CFN template.
3. **`forge` cell** with `createCell` / `getCell` / `listCells` (MCP).
4. **`dispatch` cell** on `/d/*`.
5. **Catalog merge** — `/_catalog` shows dynamic cells alongside tier-1 ones.

Result: an MCP `tools/call` to `forge.createCell` → a `CreateStack` → a
capability-scoped, owner-isolated cell live at `/d/<id>/mcp` → visible in the
catalog → promotable to CDK. The reflexive loop, with isolation provided by
Lambda + IAM rather than a sandbox.

## Open questions / future work

- **Provisioning latency & UX** — `CreateStack` + table-active is
  seconds-to-tens-of-seconds; cell *creation* is async ("creating…" → "live"),
  while code *updates* (`UpdateFunctionCode`) are fast. Decide the UX contract.
- **Quotas** — Lambda count (soft, raisable), CloudFormation stacks (~2000/region),
  DynamoDB tables (~2500/region). Fine at small scale; revisit before high
  cell-count owners.
- **Code delivery & validation** — how user code is supplied (zip/module), and
  what static checks run before `CreateStack`.
- **Orphan cleanup** — reconciling the registry against actual stacks; deleting
  cells whose owner is gone.
- **Declarative cells** — a higher-level "composition of existing primitives"
  cell (no arbitrary code) can later ride on top of this substrate as a
  convenience tier; the IAM-isolated model already makes arbitrary code safe, so
  it is not a prerequisite.

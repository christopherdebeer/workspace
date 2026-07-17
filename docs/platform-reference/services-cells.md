# Services — Cell Provisioning & Transpile (`forge`)

> Reference for engineers who **use** and **modify** the cell control plane.
> Grounded in `services/cells/*` and the live `$cells` self-model captured from
> the deployed `https://parc.land/mcp` (17 cells, principal `c15r`). Path:line
> pointers are exact at time of writing; line numbers drift, symbol names don't.

This subsystem is the machinery of the **Cell axis** core primitive. Where the
Cell axis (as a concept) says "userland code runs as IAM-isolated Lambdas that
publish vocabulary, back affordances, and get bounded substrate grants," this
service — internally named **`forge`** — is what *mints, packages, provisions,
deploys, invokes, and self-describes* those cells at runtime. Every capability
here **reduces to the Cell axis**; the ones that touch storage also reduce to
**Fact** (the registry and the per-cell table are Fact-shaped single tables), and
the self-model reads (`describeTypes`, `cellContracts`) reduce to **Projection**
(they are `read` presets over the registry).

`forge` is itself a tier-1 `HttpServiceCell` (`defineService({ name: 'cells' })`)
— it is a Cell that makes Cells. It owns exactly one table (its registry) and
never lets any other cell read that table directly: peers call its `resolveCell`
command, preserving the cell boundary (`registry.ts:6-8`).

---

## Capability: The cell registry (runtime self-model)

**What it does.** Records every dynamic (tier-2) cell so the platform can
describe itself at runtime: owner, name, Lambda/stack names, grants, declared
type vocabulary, declared substrate access, and stack/deploy status. This is the
table behind `read("$cells")` and the source `describeTypes` aggregates.

**Public API** (`services/cells/registry.ts`):

```ts
type CellStatus = 'CREATING' | 'ACTIVE' | 'FAILED' | 'DELETING';
type DeployPhase = 'DEPLOYING' | 'DEPLOYED' | 'FAILED';

interface CellRecord {
  cellId: string; name: string; owner: string; description: string | null;
  functionName: string; stackName: string;
  grants: string[];                              // principals who may invoke (always incl. owner)
  toolGrants?: Record<string, string[]>;         // principal → tool-name patterns (exact or `list_*`)
  public: boolean;                               // accepts anonymous GETs via dispatch
  types?: Array<Record<string, unknown>>;        // from types.json — the GLOBAL type vocabulary
  ssrReads?: Array<{ as; target; input?; paths?; where? }>;   // declared reads forge runs AS CALLER
  callerWrites?: Array<{ keyPrefix; types?; crossSlice? }>;   // declared writes dispatch applies AS CALLER
  status: CellStatus; deploy?: DeployState;
  timeoutSeconds?: number; memoryMb?: number;
  createdAt: string; updatedAt: string;
}

interface CellRegistry {
  put(record): Promise<void>;
  get(cellId): Promise<CellRecord | null>;
  listByOwner(owner): Promise<CellRecord[]>;
  listAccessibleBy(principal): Promise<CellRecord[]>;  // owns OR granted
  listActive(): Promise<CellRecord[]>;                 // ALL active — type decls are public
  setStatus(cellId, status); setDeploy(cellId, deploy);
  addGrant(cellId, principal, tools?); removeGrant(cellId, principal);
}
createRegistry(tableName: string): CellRegistry
```

**Data model.** Single-table `pk`/`sk` on forge's own DynamoDB table
(`registry.ts:10-13`):
- `CELL#<cellId>` / `A` → the `CellRecord`
- `OWNER#<owner>` / `CELL#<cellId>` → owner index for `listByOwner`

**Invariants & edge cases.**
- `grants` **always includes the owner**; `removeGrant` refuses to drop the owner
  (`registry.ts:268`).
- `addGrant` with a `tools` list writes a *per-tool* grant and removes the
  principal from the all-tools `grants[]`; without `tools` it promotes to full
  access and clears any per-tool entry (`registry.ts:250-260`). Re-granting
  replaces (can narrow).
- `listAccessibleBy` and `listActive` are **Scans** (paged to completion) — there
  is no grant-by-principal index. The registry is bounded by the per-region cell
  quota, so a Scan is the deliberate trade-off; revisit with a GSI if cell counts
  grow (`registry.ts:180-201`).
- `types` live on the **global** registry table (one table), not a per-user slice
  — so every user *and the anonymous landing* resolve a fact's open/edit/render
  path identically (`registry.ts:51-56`). Type declarations describe *how* to
  open a fact, not *whether* you may — hence public.

**Reduces to:** **Fact** (a Fact-shaped `pk`/`sk` single table) + **Cell axis**
(it is the axis's bookkeeping). ADR-0008 (Cell axis) — `read("$cells")` ships
from here.

> ⚠ **Coherence — uses AWS SDK v2.** `registry.ts:14` imports `aws-sdk` (v2
> `DocumentClient`), while the substrate state store uses v3. This is the
> known SDK-version split flagged in the coherence audit (`state-store-backends`
> seam): not a codec fork, but a maintenance seam — a v2→v3 migration must touch
> `registry.ts`, `grants.ts`, and the auth dynamo-store together.

---

## Capability: `describeTypes` — the global type-vocabulary aggregation

**What it does.** Aggregates every ACTIVE cell's `types.json` declarations into
one `{ types: Record<type, decl> }` map. This is the source seam behind the
runtime `$types` self-model (`buildTypeVocabulary` in `platform/runtime/`
consumes it) and the anonymous landing's ability to render any fact.

**Public API** (`services/cells/service.ts:1416`):

```ts
async function describeTypes(_input, ctx): Promise<{ types: Record<string, unknown> }>
```

**Behavior.** Reads `registry.listActive()`, sorts by `cellId` for determinism,
and for each declared type: skips reserved `_`-prefixed types, injects a
`manager` field defaulting to the declaring cell's address `@<owner>/<name>`
(`service.ts:1420-1427`). Last writer wins on type-name collision (sorted order
makes that deterministic).

**Live cross-check.** The deployed `$types` returned **50 types** managed across
13 capability-bearing cells (e.g. `canvas`/`canvas-element`/`canvas-placement`
→ `@c15r/canvas`; `machine-rail`/`machine-node` → `@c15r/machine`). This
confirms the aggregation ships and matches source.

**Reduces to:** **Projection** (a read preset over registry Facts) + **Cell axis**
(the vocabulary originates from cells). ADR-0008; docs/type-vocabulary.md.

---

## Capability: `cellContracts` — the Cell axis as a self-model surface (`$cells`)

**What it does.** Powers `read("$cells")`. For each cell the caller can reach,
returns its **contract**: what it *publishes* (types → `$types`), what it *backs*
(affordance intents its types name it for — open/edit/render/create), and its
declared *substrate access* (`ssrReads` targets + `callerWrites` prefixes).

**Public API** (`service.ts:1442`):

```ts
async function cellContracts(_input, ctx): Promise<{ cells: CellContract[]; hint: string }>
```

Each entry: `{ address, name, owner, status, public, shared?, description?,
publishes[], backs[], substrate: { ssrReads[], callerWrites[] } }`
(`service.ts:1463-1477`).

**Live cross-check.** `live/cells.json` shows the real deployed shapes — e.g.
`canvas` publishes `[canvas, canvas-element, canvas-placement]` and backs
`[embed, open, render]` with empty substrate grants; the `consolidate` organ
(ADR-0073) is present and non-public. **17 cells are deployed and ACTIVE.**

> ⚠ **Coherence — the `home`/`home-next` render-host fork (live).** `$cells`
> confirms **both `home` and `home-next` are deployed and ACTIVE**, alongside
> `kernel`, `viewers`, `starter`, `demo`, and `parcland-shell`. This subsystem
> does not *cause* the fork (it faithfully records whatever is deployed), but it
> is where the fork is *observable*: two cells back overlapping surfaces. See the
> `render-hosts` seam in `coherence-audit.md` — verdict PARTIAL, the recommended
> resolution is to collapse `home-next` into `home` once migration completes.

**Reduces to:** **Projection** (read preset, filtered by `listAccessibleBy`) +
**Cell axis**. ADR-0008. Mirrors `$grants` — the two orthogonal axes (infra vs
authority) made legible.

---

## Capability: `ssrReadsFor` / `callerWritesFor` — declared bounded substrate grants

**What it does.** Expose a cell's declared substrate access so **dispatch** can
run it. `ssrReads` are substrate reads forge runs **as the authenticated caller**
(shaped salience/vocab, no token handed to the cell) and injects into the cell's
invocation, so a tier-2 cell server-renders real content without ever holding a
credential. `callerWrites` are the write twin (Phase 4): write intents dispatch
applies **as the caller**, bounded to declared key prefixes.

**Public API** (`service.ts:563`, `:579`):

```ts
async function ssrReadsFor(input: { owner?; name?; cellId? }, ctx): Promise<{ reads: [...] }>
async function callerWritesFor(input: { owner?; name?; cellId? }, ctx): Promise<{ writes: [...] }>
```

Both are metadata-only, public-cell reads (dispatch gates the navigation itself).

**Data model.** Declared in the cell's `ssr.json` at deploy time:
`{ reads: [{ as, target, input?, paths?, where? }], writes: [{ keyPrefix,
types?, crossSlice? }] }`, persisted onto the `CellRecord` each deploy
(`service.ts:987-1011`, `registry.ts:57-72`).

**Invariants.**
- The cell **never receives a bearer token** — SSR reads are executed by forge's
  own service client under the caller's identity and the *results* are injected.
- Caller-writes are enforced by dispatch as `requested ⊆ declared ∧
  scope(caller, write)` at the act boundary (`registry.ts:65-71`). `crossSlice`
  is opt-in per write intent.
- Live example: `starter` declares `callerWrites` with `keyPrefix: 'note:'` — a
  cell that can write notes into the caller's slice without a credential.

**Reduces to:** **Cell axis** (the bounded-grant property of a cell) +
**Fact** (writes terminate in `state.put` under the caller's scope). ADR-0042
(govern the cell↔core seam); docs/capability-consent.md; docs/dynamic-cells.md.

---

## Capability: `invokeCell` / `callCell` — mediated invocation with `x-cell-caller`

**What it does.** The only path from the platform into a tier-2 cell's Lambda.
`callCell` authorizes, then calls `invokeCell`, which synchronously invokes the
cell's Function with an HTTP-shaped event.

**Public API** (`service.ts:462`; `invokeCell` from `provisioner.ts`):

```ts
async function callCell(input: CallCellInput, ctx): Promise<unknown>
// → invokeCell({ functionName, event: { version:'2.0', rawPath, headers, body, ...ssrData } })
```

**The load-bearing invariant — the token never reaches a tier-2 cell.** The
invocation event carries `headers: { 'x-cell-caller': ctx.identity.user ??
'anonymous' }` and **no bearer** (`service.ts:523`). The cell learns *who* is
calling as an IAM-attested header (forge is trusted to set it), not by holding a
credential. SSR-read results ride in the event as `ssrData` (`service.ts:527-530`).

**Authorization** (`service.ts:469-480`).
- A `public` cell allows anonymous `GET`/`HEAD` (web-facing pages/assets through
  dispatch); everything else requires an owner-or-granted authenticated caller.
- A tool call names its tool in the path (`/_tools/<tool>`); per-tool grants
  (`toolGrants`) apply via `authorizeAccess`.
- Non-`ACTIVE` cells reject invocation (`service.ts:506`).
- `public/` blobs under a user's data space stream **straight from S3** (no
  Lambda hop) with immutable caching (`service.ts:486-503`).

**Reduces to:** **Cell axis** (`x-cell-caller`, mediated peers, origin trust).
ADR-0008; ADR-0028 (gateway/dispatch tool proxy). The synchronous-command twin
of the bus's `events:source` attestation.

---

## Capability: Cell minting & CloudFormation provisioning (`cell-template` + `provisioner`)

**What it does.** `createCell` mints a `CellRecord` and provisions a real,
isolated AWS stack: a Lambda + a DynamoDB table + a scoped IAM role — the *same
resource shape* a tier-1 `HttpServiceCell` produces. Isolation comes from the
Lambda/account boundary and the role's **permission boundary**, not an in-process
sandbox (`cell-template.ts:1-14`).

**Public API.**

```ts
// cell-template.ts
cellResourceName(cellId): string   // → `cell-<cellId>`  (stable, ARN-scopable)
cellStackName(cellId): string      // → `cell-<cellId>`
buildCellTemplate(p: CellTemplateParams): Record<string, unknown>  // one CFN template per cell

// provisioner.ts
deployStack(stackName, template): Promise<void>   // CreateStack
updateStack(stackName, template): Promise<void>   // UpdateStack
uploadCode(p) / uploadPackage(p): Promise<void>   // → S3
```

**The IAM shape** every cell role carries (`cell-template.ts:113-187`) — this is
the enforced form of the Cell axis's safety claims:

| Statement | Grants | The invariant it encodes |
|---|---|---|
| `PermissionsBoundary: boundaryArn` | (cap) | The role can **never exceed the boundary**, no matter what any inline policy grants — the hard cap on tier-2 code. |
| `OwnTable` | full R/W on `cell-<id>` table + indexes | The cell's private scratch store. |
| `OwnLogs` | own log group only | Diagnostics, scoped by ARN. |
| `InvokeSelf` | `lambda:InvokeFunction` on **own ARN only** | The async work pattern — a tool returns a `jobId` fast, the cell re-invokes *itself* for the long work. Peers stay mediated through forge. |
| `PublishEvents` | `events:PutEvents` with `Condition: events:source == cell-<id>` | The cell can only emit AS itself, so subscribers can **trust `source` as IAM-attested identity**. |
| `SubstrateOwnScopeRead` (optional) | read on the shared substrate | Scoped by `dynamodb:LeadingKeys` to `STATE#<owner>` / `TRAJ#<owner>` / `SEQ#<owner>` / `IN#<owner>#*` / `TYPE#<owner>#*` — an organ observes the reef but **only its own slice**. Writes stay mediated. |

**The `LeadingKeys` note.** The GSI partition keys deliberately *repeat* the
owner scope (`IN#<owner>#*`, `TYPE#<owner>#*`) precisely so this one condition
covers index reads too — Σ-calculus scope authority enforced by IAM, not an
interpreter (`cell-template.ts:63-88`; cross-ref `platform/infra/substrate-table.ts`).

**Reduces to:** **Cell axis** (this *is* the axis's provisioning) + **Fact** (the
`LeadingKeys` condition is the enforcement of Fact's scope=principal key rule).
ADR-0008; ADR-0007 (grant axis / partition layer).

---

## Capability: Transpile & bundle (author source → deployable artifact)

**What it does.** Turns a cell's multi-file TypeScript/JS source into a deployable
Lambda bundle plus an optional browser bundle, using esbuild.

**Public API** (`services/cells/transpile.ts`):

```ts
transpileCell(source: string): Promise<string>                       // single-file TS → JS
bundleFiles(files, entry, imports?): Promise<string>                 // server bundle (node target)
bundleClientFiles(files, clientEntry, imports?): Promise<string>     // browser bundle (esm.sh externals)
resolveBareImport(spec, imports?): string                            // pin a bare import to a URL
```

**The isomorphic-dependency invariant.** One import map
(`client/imports.json`) declares the cell's npm deps for **both** bundlers: the
server inlines them from esm.sh (node target), the client fetches them from
esm.sh in the browser — same pins, so an isomorphic cell runs the byte-identical
dependency on both sides (`service.ts:933-944`).

**Reduces to:** **Cell axis** (build step of the axis). This is deploy-time
tooling — no substrate primitive touched directly.

---

## Capability: Deploy — async bundle via the pending-marker pattern

**What it does.** `deploy` bundles the cell's source and updates its Lambda code.
Bundling can outlast the synchronous edge timeout (~30s), so deploy is
**async-by-construction** using the substrate's canonical async write-shape.

**Flow** (`service.ts:1079-1149`, `registry.ts:18-30`):
1. `requestDeploy` writes a **pending marker** — `setDeploy({ phase:'DEPLOYING',
   version, requestedAt })` — and emits `cell.deploy.requested`, returning fast
   with `{ deploying: true, deploy, message: 'poll get until DEPLOYED/FAILED' }`.
2. `onDeployRequested` is the event-driven worker (the event routes back to forge;
   `source` is IAM-pinned to `cells`). It runs the heavy `deployCell` off the
   request path.
3. `deployCell` bundles server + client, uploads the package to S3
   (`buildKey(cellId, version)`), calls `updateFunctionCode`, and **persists the
   deploy's `types.json` and `ssr.json`** onto the registry record
   (`service.ts:1013-1024`).
4. On completion it records the terminal phase (`DEPLOYED`/`FAILED`) and emits
   `cell.deployed`. Callers poll `getCell` until `deploy.phase` is terminal.

**Invariant.** Each deploy **re-persists or clears** the declared types, SSR
reads, and caller-writes — the registry always reflects the *currently deployed*
contract, never a stale one (`service.ts:1019-1022`).

**Reduces to:** **Cell axis** sub-claim 6 (the async write-shape) + **Fact**
(pending marker and terminal state are Fact writes; `cell.deploy.requested` is
the self-dispatch). ADR-0008; ADR-0076 (vendor cell jobs). This is the exact
pending-marker → self-dispatch → terminal-write → caller-polls shape documented
as the substrate's async contract.

---

## Capability: Cell file store & S3 layout (`cell-files`)

**What it does.** Defines the shared-bucket S3 key layout for cell source, built
artifacts, and per-caller blob data, with path-traversal defense.

**Public API** (`services/cells/cell-files.ts`):

```ts
cleanPath(path): string                        // normalise + reject traversal / unsafe chars
srcPrefix(cellId) / srcKey(cellId, path)       // cells/<cellId>/src/<path>       — deployable source
buildKey(cellId, version)                      // cells/<cellId>/build/<v>.zip    — built artifact
dataPrefix(cellId, user) / dataKey(...)        // cells/<cellId>/data/<user>/<key> — per-caller blobs
```

**Invariant — the isolation keystone.** `cleanPath` enforces
`^[A-Za-z0-9][A-Za-z0-9._-]*$` per segment and rejects `.`/`..`, so a file/data
op can **never escape the cell's prefix** — the keystone of the forge-mediated
isolation in v1 (`cell-files.ts:11-26`). `tar.ts`/`zip.ts` pack the artifact.

**Reduces to:** **Cell axis** (the axis's storage expressed in S3) + **Fact**
(the per-cell prefix is Fact's scope key rule expressed in the object store).
docs/cell-storage-s3.md.

---

## Gotchas / non-obvious behavior

- **No teardown of the primitive path (ADR-0014).** Cells are provisioned and
  deployed, but there is no per-request teardown — a cell is a standing resource,
  and promotion tier-2 → tier-1 uses the same resource shape.
- **The registry is the only place with the whole picture.** Peers must go
  through `resolveCell` (an internal, non-MCP command used by dispatch) — never
  read forge's table directly. Breaking this breaks the cell boundary.
- **`types` are global; everything else is per-owner-scoped.** Type declarations
  live on the one registry table and are world-readable (they say *how*, not
  *whether*). Do not move them into a slice.
- **`x-cell-caller` is trust-by-forge, not by token.** A tier-2 cell must treat
  `x-cell-caller` as its identity input and do ownership comparisons against it;
  it must never expect a bearer. (Confirmed across all deployed cells' index.ts.)
- **Deploy is fire-and-poll.** A `deploy` call that returns `{ deploying: true }`
  has *not* finished — poll `get` for `deploy.phase`. A synchronous-looking
  success is only the marker write.
- **`InvokeSelf` is the async engine, and it is own-ARN-only.** A cell cannot
  invoke a peer directly; long work is a self-invoke, peer work is mediated
  through forge. This is what keeps the blast radius per-cell.
- **AWS SDK v2 here, v3 in the state store.** `registry.ts` and `provisioner.ts`
  use v2; a migration is a cross-file change (coherence audit, `state-store-backends`).
- **`listAccessibleBy`/`listActive` Scan.** Fine at current cell counts; add a
  GSI before the registry grows large.

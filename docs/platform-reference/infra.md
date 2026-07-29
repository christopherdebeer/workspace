# Infra — CDK Constructs, Control Plane & Edge HTTP

## What this subsystem is

This is the **build-time (tier-1) CDK layer** of the parc.land substrate platform: the composable constructs that turn a service definition into a deployable *cell*, plus the shared routing, eventing, and storage every cell rides on. It is the *physical realisation* of three of the four core primitives — it provisions the hardware, then gets out of the way. No business logic lives here; the router is deliberately "dumb", and the runtime counterpart (`state.ts`, the projection pipeline) lives in `platform/runtime` and is out of scope.

The subsystem realises three cores:

- **Fact** (`fact`) — provisioned physically as the one scope-partitioned `SubstrateTable` (`platform/infra/substrate-table.ts`). The `STATE#/KEY#` + `TRAJ#` key layout, plus GSIs that repeat scope for `dynamodb:LeadingKeys`, *is* the Fact floor.
- **Cell axis** (`cell`) — the `HttpServiceCell` (build-time cell) + `DynamicCellControlPlane` (the IAM-enforced tier-2 provisioning cap) + `TableFactory` (per-cell scratch) + `PlatformEventBus` (attested cross-cell transport).
- **Edge HTTP contract** (`edge-http`) — the three Lambda@Edge/CloudFront transforms in `ServiceRouter` that make CloudFront + an IAM-auth Function URL behave as a real public MCP/HTTP face. Realisation, not constitution.

The **projection pipeline** (`projection`) core has *no* physical construct here — it is pure runtime. That is the honest boundary of this subsystem: it lays the reef and the plumbing; the reactive topology in `PlatformStack` (`lib/platform-stack.ts`) is where discrete constructs are wired into the self-maintaining substrate.

A key architectural through-line: **reads are direct, writes are mediated.** Tier-1 cells get unconditioned `grantReadWriteData` on the substrate; dynamic (tier-2) cells get only `dynamodb:LeadingKeys`-scoped *read*, and their writes flow as source-attested `substrate.write.requested` events applied by the workspace organ.

---

## SubstrateTable — the one scope-partitioned Fact store

**File:** `platform/infra/substrate-table.ts`

### What it does

Provisions the platform's single shared observed-state store — the "blackboard". One DynamoDB table: `pk`/`sk`, `PAY_PER_REQUEST`, `NEW_AND_OLD_IMAGES` streams (always on — the change-feed substrate), TTL on the `ttl` attribute, and point-in-time recovery. The **partition prefix is the authority boundary**: the key layout is designed so IAM `dynamodb:LeadingKeys` conditions scope a principal to its own partitions. Two GSIs both *repeat the scope* in their partition key so LeadingKeys covers index reads too.

### Public API

```ts
export interface SubstrateTableProps {
  retain?: boolean; // default false → RemovalPolicy.DESTROY; flip for prod
}

export class SubstrateTable extends Construct {
  readonly table: dynamodb.Table;
  constructor(scope: Construct, id: string, props?: SubstrateTableProps);
  // grantReadWriteData(cell.fn) + injects SUBSTRATE_TABLE env (tier-1 cells)
  grantReadWrite(cell: HttpServiceCell): void;
}
```

### Data model

`pk` (S) + `sk` (S). Everything is one table, scope-partitioned:

| Row | pk | sk |
|---|---|---|
| facts | `STATE#<scope>` | `KEY#<key>` |
| edges | `STATE#<scope>` | `EDGE#<from>#<rel>#<to>` |
| trajectory | `TRAJ#<scope>` | `<iso>#<seq>` (TTL via `ttl`) |
| seq counter | `SEQ#<scope>` | `A` |
| grants | `GRANT#<grantee>` / `GRANTBY#<owner>` | — |

- **gsi-in** (`substrate-table.ts:59-64`): `gsi1pk=IN#<scope>#<to>`, `gsi1sk=<rel>#<from>`, `ProjectionType.ALL` — inbound edges.
- **gsi-type** (`substrate-table.ts:65-70`): `gsi2pk=TYPE#<scope>#<type>`, `gsi2sk=<updatedAt>`, `ProjectionType.ALL` — typed/recency reads.

Streams `NEW_AND_OLD_IMAGES`; TTL attr `ttl`; PITR on (`pointInTimeRecovery: true`, `substrate-table.ts:55`).

### Invariants & edge cases

- The partition prefix is the authority boundary; **every GSI pk repeats the scope** (documented at `substrate-table.ts:36-37`) so LeadingKeys covers index reads — this is a *discipline contract* the link/query primitives must honour, not something DynamoDB enforces on writes.
- Streams are always enabled (`stream: NEW_AND_OLD_IMAGES`, `substrate-table.ts:51`).
- `grantReadWrite` gives tier-1 (reviewed) cells **unconditioned** `grantReadWriteData`; dynamic cells get LeadingKeys-scoped READ only, via the boundary + cell template (writes stay mediated).
- `removalPolicy` defaults DESTROY (`props?.retain ? RETAIN : DESTROY`, `substrate-table.ts:49`); flip `retain` for prod. PITR is the DR half the analytics lane's permanent archive complements.

**Reduces to:** `fact`. This *is* the physical Fact primitive — the `{value,_meta}` row at `(scope,key)` with monotonic supersede-not-delete and a TTL'd trajectory shadow is exactly the `STATE#`/`KEY#` + `TRAJ#` layout provisioned here. `scope = IAM principal = OAuth target` is realised by the LeadingKeys-covering key design. It does not reintroduce a primitive: the runtime applier (`state.ts` `put`/`appendTrajectory`) rides on this construct, which only shapes storage + indexes + streams + DR.

**Connections:** target of `SubstrateTable.grantReadWrite(cell)` for tier-1 cells; its `.table.tableArn` feeds `DynamicCellControlPlane.SubstrateRead` and the cell-template's LeadingKeys; its stream is consumed by the vector-indexer and substrate-archiver (both wired in `PlatformStack`).

**ADRs:** ADR-0013 (Fact floor), ADR-0007 (Grant axis / LeadingKeys), ADR-0016 (edges first-class), ADR-0017 (cell substrate access).

---

## Edge HTTP contract — the three Lambda@Edge/CloudFront transforms

**File:** `platform/infra/service-router.ts`

### What it does

Makes a CloudFront distribution in front of an **IAM-auth Lambda Function URL** behave as a real public HTTP/MCP face. `ServiceRouter` builds one shared `FunctionUrlOriginAccessControl` (`Signing.SIGV4_ALWAYS`, `service-router.ts:169`) and attaches, on **every** behaviour, two Lambda@Edge functions running on a shared role assumable by both `lambda` and `edgelambda` (`service-router.ts:188-196`):

1. **ORIGIN_SIGNER** (`ORIGIN_SIGNER_SRC`, `service-router.ts:19-44`) — origin-request, `includeBody: true`. Two jobs:
   - Computes `x-amz-content-sha256` over the body so OAC's SigV4 covers `POST/PUT/PATCH/DELETE` payloads. Without it every POST 403s at the Function URL.
   - Copies the viewer `Authorization` into `x-forwarded-authorization` **before** OAC overwrites `Authorization` with its own signature — the fix for the bug where every `/mcp` call 401'd with a valid token.
2. **WWW_AUTH_FIX** (`WWW_AUTH_FIX_SRC`, `service-router.ts:52-63`) — origin-response. Renames `x-amzn-remapped-www-authenticate` back to `WWW-Authenticate` so RFC 9728 / MCP clients see the literal header on a 401.

### Public API (internal wire, not exported types)

```ts
const ORIGIN_SIGNER_SRC = `…`;                 // inline Node20 (service-router.ts:19)
const WWW_AUTH_FIX_SRC  = `…`;                 // inline Node20 (service-router.ts:52)
new cloudfront.FunctionUrlOriginAccessControl(this, 'Oac', { signing: SIGV4_ALWAYS });
// behaviorFor(cell): BehaviorOptions with
//   allowedMethods:      AllowedMethods.ALLOW_ALL
//   cachePolicy:         CachePolicy.CACHING_DISABLED
//   originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER
//   edgeLambdas: [ ORIGIN_REQUEST includeBody, ORIGIN_RESPONSE ]
```

### Data model

Wire-level, not stored. Adds `x-amz-content-sha256` (hex sha256 of the body, or sha256 of an empty buffer); mirrors `Authorization` → `X-Forwarded-Authorization`; renames `x-amzn-remapped-www-authenticate` → `WWW-Authenticate`.

### Invariants & edge cases

- ORIGIN_SIGNER only hashes bodies for `POST/PUT/PATCH/DELETE`; `GET/HEAD/etc.` pass through (`service-router.ts:33-35`) — OAC already signs empty bodies.
- `origin-request` `includeBody` **caps the body at 1 MB** (noted at `service-router.ts:17`) — S3 presigned PUT is the large-upload escape hatch (see the control plane's code bucket CORS).
- Both edge functions live in `us-east-1` (this stack), so a plain `Function` + `currentVersion` suffices — no cross-region `EdgeFunction`.
- The edge role keeps construct id `'OriginSignerRole'` deliberately (`service-router.ts:188`): Lambda@Edge replicas linger for hours, so renaming would orphan/replace.
- WWW-Authenticate restoration **must** be Lambda@Edge (a CloudFront Function can't write that read-only response header — `service-router.ts:216-218`).
- Host must not reach the SigV4-signed origin: `ALL_VIEWER_EXCEPT_HOST_HEADER` (`service-router.ts:237`).

**Reduces to:** `edge-http`. This is verbatim the edge-http core: OAC body-signing + WWW-Authenticate restoration + x-forwarded-authorization. Explicitly *realisation, not constitution* — the transforms exist only to reconcile CloudFront-OAC + IAM Function URL semantics with the MCP/OAuth wire contract. It also compounds on `cell`, since it is what exposes each `HttpServiceCell`'s Function URL.

**Connections:** consumes `HttpServiceCell.functionUrl` as the origin; OAC auto-adds `lambda:InvokeFunctionUrl` scoped to the distribution.

**ADRs:** documented in `docs/serverless-platform.md` (Security posture) and `docs/dynamic-cells.md` §Connecting an MCP client (connect fixes 1-4).

---

## HttpServiceCell — the built-time Cell

**File:** `platform/infra/http-service-cell.ts`

### What it does

A self-contained tier-1 service cell as a sub-50-line construct instantiation. It bundles a `NodejsFunction` (Node20, esbuild from `entry`), a Function URL defaulting to `AWS_IAM` auth, a 1-week-retention log group, an optional per-cell DynamoDB table (via `TableFactory`), optional event-bus publish grant, and a published `ServiceManifest` (as a `CfnOutput`). When `clientEntry` is set, an `afterBundling` esbuild hook (`http-service-cell.ts:133-138`) also builds a browser SPA into `app.js` inside the *same* Lambda asset (image imports → data URIs) — a self-contained SPA with no separate build pipeline.

### Public API

```ts
export interface CellPersistence { dynamo?: boolean; dynamoTtl?: boolean; turso?: boolean; }

export interface HttpServiceCellProps {
  name: string; entry: string; clientEntry?: string;
  routes: string[]; commands?: string[]; emits?: string[];
  persistence?: CellPersistence; eventBus?: PlatformEventBus;
  version?: string; environment?: Record<string, string>;
  memorySize?: number;        // default 256
  timeoutSeconds?: number;    // default 15
  bundlingNodeModules?: string[];
  publicFunctionUrl?: boolean; // default false → AWS_IAM
}

export class HttpServiceCell extends Construct {
  readonly serviceName: string;
  readonly fn: NodejsFunction;
  readonly functionUrl: lambda.FunctionUrl;
  readonly table?: dynamodb.Table;
  readonly manifest: ServiceManifest;
  allow(target: HttpServiceCell): void; // one-directional least-privilege invoke
}
```

### Data model

Manifest wire shape: `{ name, version, routes[], commands[], events: { emits[] } }`. Env injected: `SERVICE_NAME`, `EVENT_BUS_NAME?`, `TABLE_NAME?`, `TURSO_ENABLED?`, `SUBSTRATE_TABLE?` (via `SubstrateTable.grantReadWrite`), `SERVICE_REGISTRY` (JSON name→functionName, grown by `allow()`).

### Invariants & edge cases

- Function URL defaults to `AWS_IAM` (`http-service-cell.ts:151-154`) — direct public invoke is closed; the only way in is CloudFront OAC. `publicFunctionUrl: true` opts back to `NONE` + CORS for dev.
- `clientEntry` SPA ships inside the same Lambda asset via the `afterBundling` esbuild hook; image imports become data URIs — no separate build pipeline or routes. Keep assets small; they ride every download.
- `allow()` is **one-directional** least-privilege: `target.fn.grantInvoke(this.fn)` + injects the peer into this cell's `SERVICE_REGISTRY` (`http-service-cell.ts:189-193`). Function-URL IAM auth is independent of this Invoke grant.
- Cells never share a table across the cell boundary (a `TableFactory` invariant): per-cell tables are organ scratch; the substrate table is shared truth.

**Reduces to:** `cell`, `edge-http`. This is the tier-1 (build-time, reviewed) form of the Cell axis: IAM-isolated Lambda + scratch table + scope + manifest publish seam + bounded grants + origin isolation. It compounds on `edge-http` because its Function URL is reachable only through the `ServiceRouter`'s OAC + edge transforms. It is the same shape a tier-2 forge-provisioned cell has, which is why promotion (tier2→tier1) is "a copy not a port".

**Connections:** `TableFactory` (optional persistence), `PlatformEventBus` (optional emit grant), `ServiceRouter` (exposes `functionUrl`), `SubstrateTable.grantReadWrite` (tier-1 substrate access).

**ADRs:** ADR-0008 (Cell axis), ADR-0017 (cell substrate access), `docs/serverless-platform.md`.

---

## DynamicCellControlPlane — permission boundary + provisioning grant (the tier-2 safety cap)

**File:** `platform/infra/dynamic-cell-control-plane.ts`

### What it does

Provides the two shared pieces the `cells`/forge control plane needs to provision *user-owned dynamic cells* at runtime:

1. An **S3 code bucket** (`dynamic-cell-control-plane.ts:48-63`): block-all-public, S3-managed encryption, CORS PUT from `https://parc.land` for browser presigned uploads.
2. The **CellBoundary IAM ManagedPolicy** (`dynamic-cell-control-plane.ts:67-117`) — the permission boundary every dynamic-cell role must carry.

`grantControlPlane(forge)` grants forge the *only* provisioning permissions in the platform — cloudformation `cell-*/*`, code-bucket RW, and crucially `iam:CreateRole` on `role/cell-*` **conditioned on** `iam:PermissionsBoundary == the boundary ARN** (`dynamic-cell-control-plane.ts:154-163`) — plus `iam:PassRole` (to lambda only), lambda/dynamodb `cell-*` management, and scoped read of `cell-*` logs (the `cellLogs` tool).

### Public API

```ts
export interface DynamicCellControlPlaneProps {
  eventBus: PlatformEventBus;
  substrateTable?: SubstrateTable;
}

export class DynamicCellControlPlane extends Construct {
  readonly codeBucket: s3.Bucket;
  readonly permissionBoundary: iam.ManagedPolicy;
  grantControlPlane(forge: HttpServiceCell): void;
}
```

### Data model

CellBoundary statements: `OwnLogs` (`cell-*` log groups), `CellTables` (`GetItem`…`BatchWriteItem` on `table/cell-*` + `/index/*`), `PublishEvents` (bus arn), `InvokeCellPeers` (`function:cell-*`), and — when a `substrateTable` is passed — `SubstrateRead` (`GetItem/Query/BatchGetItem` on the substrate table + `/index/*`).

The cell-template (`services/cells/cell-template.ts:68-88`) narrows `SubstrateRead` per-cell with `Condition ForAllValues:StringLike dynamodb:LeadingKeys = [ STATE#<owner>, TRAJ#<owner>, SEQ#<owner>, IN#<owner>#*, TYPE#<owner>#* ]`, and creates the cell role with `PermissionsBoundary = boundaryArn` (`cell-template.ts:119`). Each cell's `PublishEvents` is source-pinned: `Condition StringEquals events:source == <cell name>` (`cell-template.ts:175`).

Env injected into forge: `CELL_CODE_BUCKET`, `CELL_PERMISSION_BOUNDARY_ARN`, `CELL_EVENT_BUS_NAME`, `CELL_EVENT_BUS_ARN`, `CELL_ACCOUNT_ID`, `CELL_REGION`, and (if substrate wired) `CELL_SUBSTRATE_TABLE_NAME`/`_ARN`.

### Invariants & edge cases

- **The security crux:** forge's `iam:CreateRole` is conditioned `StringEquals iam:PermissionsBoundary == boundary ARN` — forge can *only* mint roles carrying the boundary (`dynamic-cell-control-plane.ts:159-161`).
- Only forge can provision, and only Lambda + Table + Role on `cell-*` / `cell-*-stacks` — blast radius capped to two resource types + the scoped role.
- `PassRole` is conditioned `iam:PassedToService == lambda.amazonaws.com` (`dynamic-cell-control-plane.ts:185`).
- The boundary caps dynamic cells to **READ** on the substrate; writes stay mediated through the workspace organ path.
- `logs:DescribeLogGroups` can't be resource-scoped, so platform-log discovery stays account-wide read-only metadata (handled in `PlatformStack`, `platform-stack.ts:467-473`, for the `platform.logs` tool).

**Reduces to:** `cell`, `fact`. This is the provisioning + isolation machinery of the Cell axis: it makes "the control plane can only ever create a permission-bounded Lambda + table + role" an IAM-enforced property, not a convention. It compounds on `fact` because the boundary's `SubstrateRead` statement (narrowed per-cell by the template's LeadingKeys) gives organs read access to the Fact reef — the reads-direct/writes-mediated split.

**Connections:** `PlatformEventBus`, `SubstrateTable` (optional read cap), `HttpServiceCell` (forge = `CellsService`), `services/cells/cell-template.ts` (renders the per-cell LeadingKeys role).

**ADRs:** ADR-0008 (Cell axis), ADR-0017 (cell substrate access), ADR-0007 (Grant / LeadingKeys), `docs/dynamic-cells.md` §Security summary.

---

## Cell-origin isolation — host-isolated cell namespace distribution

**File:** `platform/infra/service-router.ts` (`cellDistribution` path)

### What it does

An **additive, optional** second CloudFront distribution serving user cells from their own per-cell subdomain (`<owner>-<name>.on.parc.land`) so each cell is a distinct browser origin that cannot read the shell's `localStorage`/cookie. It reuses the existing dispatch path-routing with no backend change:

- A viewer-request CloudFront Function **CELL_HOST_REWRITE** (`service-router.ts:103-118`) rewrites the per-cell host `<owner>-<name>.<domain>` → `/@<owner>/<name>` (splitting on the **first** hyphen; idempotent so a cell's own `/app.js` path isn't double-prefixed).
- On the APEX distribution, **CELL_APEX_REDIRECT** (`service-router.ts:129-144`) 302-redirects only **navigations** (`Sec-Fetch-Dest` document/iframe/frame) of `/@<owner>/<name>` to the cell subdomain — sub-resources and non-browser clients pass through.

Both distributions share the OAC + the two Lambda@Edge transforms. Unset (`no cellDomain`) ⇒ zero new resources; the apex distribution is untouched.

### Public API

```ts
const CELL_HOST_REWRITE_SRC = `…`;                    // JS_2_0 viewer-request
const CELL_APEX_REDIRECT_SRC = (cellDomain: string) => `…`; // JS_2_0 viewer-request 302

interface ServiceRouterProps {
  cellHostRouter?: HttpServiceCell;   // the dispatch cell
  cellDomainNames?: string[];         // ["*.on.parc.land"]
  cellCertificate?: acm.ICertificate; // us-east-1
}
readonly cellDistribution?: cloudfront.Distribution;
```

Wired via `PlatformStackProps.cellDomain` (live: `PLATFORM_CELL_DOMAIN=on.parc.land`).

### Data model

No stored data. Host label `<owner>-<name>` resolves to `/@<owner>/<name>`. Redirect `Location = https://<owner>-<name>.<cellDomain><rest><qs>`. The owner label must be hyphen-free (registration enforces `^[a-z0-9]+$`) since the split is on the first hyphen.

### Invariants & edge cases

- Additive & gated: unset `cellDomain` ⇒ nothing changes, synth adds zero resources; the apex distribution is never mutated (`platform-stack.ts:441-451`).
- Only navigational loads move origin (Sec-Fetch-Dest gate); absent `Sec-Fetch-Dest` (non-browser) passes through — **fail-open for machines** (`service-router.ts:133`).
- Host rewrite is idempotent to avoid double-prefixing the cell's own asset paths (`service-router.ts:113`).
- `cellDistribution` is attached to the dispatch cell (`cellHostRouter`) only; requires `cellDomainNames` wildcard + a us-east-1 cert.

**Reduces to:** `edge-http`, `cell`. Compounds on `edge-http` — more CloudFront-Function/Lambda@Edge machinery layered on the same OAC + Function-URL realisation. Compounds on `cell` — the goal is per-cell origin isolation, making the browser origin equal the cell trust boundary (the delivery half of the scoped-token model). It reuses, not reinvents: same dispatch cell, same OAC, same body-signer/www-auth transforms.

**Connections:** dispatch `HttpServiceCell` (`cellHostRouter`); the shared OAC + edge transforms; ACM wildcard cert `*.on.parc.land`; the auth `cellCeiling` / kernel `cellAddress` scoped-token handoff (in `services/*`).

**ADRs:** `docs/cell-origin-isolation.md` §4-§7, ADR-0043 (govern cross-cell UI embedding).

---

## PlatformEventBus — shared bus with source-prefix attestation (Mode 2)

**File:** `platform/infra/event-bus.ts`

### What it does

A single shared EventBridge bus carrying domain events between cells (communication Mode 2). Services emit with their own name as event `Source`; `grantPutEvents` grants publish; `routeTo(id, fn, detailTypes, sourcePrefix?)` attaches a subscriber Rule narrowed by `detailType` and, critically, an optional **source prefix**. The source prefix is the attestation mechanism: dynamic cells' role policies pin `events:source` to their own `cell-<id>`, so a rule keyed `sourcePrefix: 'cell-'` trusts only real dynamic-cell emitters, while `'workspace'`/`'cells'`/`'gateway'` prefixes admit only first-party tier-1 emitters (a `cell-<id>` source never matches those).

### Public API

```ts
export interface PlatformEventBusProps { busName?: string; }

export class PlatformEventBus extends Construct {
  readonly bus: events.EventBus;
  grantPutEvents(grantee: iam.IGrantable): iam.Grant;
  routeTo(id: string, fn: lambda.IFunction, detailTypes: string[], sourcePrefix?: string): events.Rule;
}
```

`routeTo` builds an `events.Rule` with `eventPattern: { detailType: detailTypes, ...(sourcePrefix ? { source: Match.prefix(sourcePrefix) } : {}) }` (`event-bus.ts:44-53`).

### Data model

EventBridge events: `{ Source, DetailType, Detail }`. Bus name `platform-bus` (prod) / `platform-bus-<env>`. Rules match `detailType ∈ set` AND (`sourcePrefix` ? `source begins_with prefix`). No table.

### Invariants & edge cases

- The event `Source` is **IAM-attested**: each dynamic cell's role pins `events:PutEvents` to `events:source = cell-<cellId>` (`cell-template.ts:175`), so `'cell-'` rules can't be spoofed, and `'cells'`/`'workspace'`/`'gateway'` prefixes exclude dynamic cells.
- The bus + the router are intentionally the *only* cross-service infrastructure.
- The organ owner is resolved via the cells registry (`cells.resolveCell`), never from the event body (a client-supplied user would be impersonation — rejected design; see `platform-stack.ts:396-397`).

**Reduces to:** `cell`, `fact`. Compounds on `cell`: the bus is the one cross-cell infrastructure besides the router, and source-prefix attestation enforces the cell boundary's identity at the subscriber. Compounds on `fact`: `routeTo('SubstrateWriteRoute', workspace, ['substrate.write.requested'], 'cell-')` is precisely the seam that turns an organ's attested event into a provenance-stamped Fact applied in the owner's slice. It is not a new primitive — transient transport whose only durable consequence is a Fact write.

> ⚠ **Coherence — write-fanout (medium, conflicts).** There are **two parallel "a fact changed" propagation mechanisms** selected inconsistently. The physical DynamoDB stream fans out automatically to two consumers configured purely in CDK (`lib/platform-stack.ts:206-214` vectorIndexer, `240-248` archiver, both `StartingPosition.LATEST`). The reaction path is a *different* substrate: `FactReactionRoute` (`platform-stack.ts:269`) is an EventBridge rule on the logical `workspace.fact.written` event the workspace emits via `putEvents` (`platform/runtime/events.ts:42-48`), not off the table stream. No shared helper unifies them. **Recommendation:** adopt the stream as the canonical fan-out for reactions too (make `FactReactionRoute` a stream consumer), collapsing `workspace.fact.written` into a stream-derived signal — one origin for all five paths (reactions, reindex, capability-touch, indexer, archiver).

**Connections:** `HttpServiceCell` (grantPutEvents / route targets), `services/workspace` (the applier), `services/cells` (registry owner resolution).

**ADRs:** ADR-0011 (Reactivity), ADR-0017, `docs/substrate-storage.md` §phase 4.

---

## SubstrateAnalyticsLane — durable archive + SQL read surface off the stream

**File:** `platform/infra/analytics-lane.ts`

### What it does

The analytical/archival read lane DynamoDB's access model can't serve, plus a permanent TTL-free archive of the trajectory. A second consumer on the SubstrateTable stream (the `substrate-archiver` Lambda, wired in `PlatformStack`) flattens each fact change and `PutRecordBatch`es to a Kinesis Firehose DirectPut stream, which buffers (60s / 64MB) and lands gzip newline-JSON in a **RETAINED** lake bucket under Hive-partitioned `facts/dt=YYYY-MM-DD/`. A Glue table catalogs it via **partition projection** (no crawler / MSCK ever) so Athena queries the whole substrate with SQL through a workgroup pinned to a lifecycle-expired results bucket.

### Public API

```ts
export interface SubstrateAnalyticsLaneProps { envName: string; account: string; region: string; }

export class SubstrateAnalyticsLane extends Construct {
  readonly lakeBucket: s3.Bucket;      // RETAINED
  readonly resultsBucket: s3.Bucket;   // 14-day expiry
  readonly deliveryStreamName: string; readonly deliveryStreamArn: string;
  readonly database: glue.CfnDatabase; readonly workgroup: athena.CfnWorkGroup;
  readonly databaseName: string;       // substrate_<env>
  readonly workgroupName: string;      // substrate-<env>
  grantPutRecords(fn: lambda.Function): void; // → FIREHOSE_STREAM env
  grantQuery(fn: lambda.Function): void;      // → ATHENA_WORKGROUP + ATHENA_DATABASE env
}
```

### Data model

Glue table `facts` columns: `scope`, `key`, `type`, `tags(array<string>)`, `revision(bigint)`, `seq(bigint)`, `first_seq(bigint)`, `writer`, `via`, `superseded(bool)`, `superseded_by`, `created_at`, `updated_at`, `timer_expires_at`, `timer_effect`, `event_name`, `value_json(string)`, `archived_at` (`analytics-lane.ts:134-153`). Partition key `dt` (projected date `2024-01-01`→`NOW`, `yyyy-MM-dd`, 1 DAY). `JsonSerDe`, `ignore.malformed.json`. S3: `s3://parc-substrate-lake-<env>-<account>/facts/dt=…/`.

### Invariants & edge cases

- Lake bucket is RETAINED (truth-at-rest, `analytics-lane.ts:64`); results bucket expires at 14 days (`analytics-lane.ts:74`).
- Partition projection means no crawler / MSCK is ever run (`analytics-lane.ts:165-171`).
- Runs entirely off the stream — isolated from the write path; the archiver no-ops when `FIREHOSE_STREAM` is unset.
- The workgroup enforces the output location (`enforceWorkGroupConfiguration: true`), so callers never pass one.
- `glue:GetDatabases` (plural) is required for `information_schema`/`SHOW` introspection (wave-5 W5-3: the capability looked dead when probed via `information_schema` without it — `analytics-lane.ts:242-247`).

**Reduces to:** `fact`. A derived, read-only projection of the Fact stream into columnar/queryable form; the lake IS the trajectory made permanent (the DR/analytics half PITR complements). Every row is a flattened Fact envelope. **Honest note:** `grantQuery` is a broad cross-slice read surface (the whole lake, no per-slice partitioning yet), so the tool is admin-gated — a place where the Fact primitive's LeadingKeys isolation is *not yet* mirrored in the analytics lane (`analytics-lane.ts:227-228`).

**Connections:** SubstrateTable stream (source), `substrate-archiver` Lambda (`platform-stack.ts:228-248`), `workspace.fn` (`grantQuery` for the `workspace.athena` tool, `platform-stack.ts:239`).

**ADRs:** ADR-0044 (distill the substrate), `docs/substrate-analytics.md`, `docs/substrate-storage.md`.

---

## TableFactory — standardised per-cell scratch tables

**File:** `platform/infra/table-factory.ts`

### What it does

A static factory for the standardised per-cell DynamoDB table: `pk`/`sk` single-table schema, `PAY_PER_REQUEST`, optional `NEW_AND_OLD_IMAGES` stream and optional TTL on `ttl`, tagged `platform:service=<name>`, DESTROY by default. This is the organ-scratch half of the storage story (facts→substrate, scratch→your table, blobs→S3): every cell owns its own table and never shares one across the cell boundary.

### Public API

```ts
export interface PlatformTableProps {
  serviceName: string; retain?: boolean; stream?: boolean; ttl?: boolean;
}
export class TableFactory {
  static standardTable(scope: Construct, id: string, props: PlatformTableProps): dynamodb.Table;
}
```

### Data model

`pk` (S) + `sk` (S), `PAY_PER_REQUEST`, `stream?` `NEW_AND_OLD_IMAGES`, `ttl?` attr `ttl`. Used by the auth cell (`dynamo + dynamoTtl` for auth codes/sessions/challenges) and the cells/forge registry table.

### Invariants & edge cases

- Services own their own table; never shared across the cell boundary — the microservices discipline correct for organ scratch, **not** for truth (`table-factory.ts:9-11`).
- DESTROY default (`props.retain ? RETAIN : DESTROY`, `table-factory.ts:37`).

**Reduces to:** `cell`. The per-cell isolated scratch table is part of the Cell axis definition (scratch table + scope). Deliberately **not** the Fact primitive — `docs/substrate-storage.md` is explicit that per-cell tables are correct for *organ working state* (encapsulated, invisible) and would be the anti-thesis architecture if applied to shared truth. A distinct, legitimately non-Fact storage role, not a re-implementation of the substrate.

**Connections:** `HttpServiceCell.persistence` (its only caller).

**ADRs:** `docs/substrate-storage.md` (organ scratch vs reef), `docs/serverless-platform.md` §Persistence.

---

## Manifest + least-privilege registry (ServiceManifest, cell.allow, ServiceRouter behaviour generation)

**Files:** `platform/manifest.ts`, `platform/infra/http-service-cell.ts`, `platform/infra/service-router.ts`

### What it does

The manifest-driven discovery + routing + Mode-1 invoke fabric. `ServiceManifest` (`{ name, version, routes, commands, events.emits }`) is a **CDK/SDK-free** neutral contract that both the infra layer (to generate CloudFront behaviours + IAM) and the runtime (to validate dispatch) share. `ServiceRouter` generates one CloudFront behaviour per manifest route (one origin per cell, reused across its routes), with a designated `defaultCell` for `/*`. `cell.allow(peer)` grants one-directional least-privilege `lambda:InvokeFunction` and injects the peer into `SERVICE_REGISTRY` (name→functionName JSON) so `serviceClient` resolves peers with no hardcoded ARNs.

### Public API

```ts
export interface ManifestEvents { emits: string[]; }
export interface ServiceManifest {
  name: string; version: string; routes: string[]; commands: string[]; events: ManifestEvents;
}
export type ServiceRegistry = Record<string, string>;

HttpServiceCell.allow(target: HttpServiceCell): void;

interface ServiceRouterProps {
  cells: HttpServiceCell[]; defaultCell?: HttpServiceCell;
  domainNames?: string[]; certificate?: acm.ICertificate;
}
```

### Data model

Manifest emitted as a `CfnOutput` per cell (JSON, `http-service-cell.ts:174-177`). `SERVICE_REGISTRY` env = JSON name→functionName. CloudFront `additionalBehaviors` keyed by route pattern; `defaultBehavior` for the default cell (skips its own `/*` to avoid a duplicate — `service-router.ts:267`).

### Invariants & edge cases

- `allow()` is one-directional least-privilege (`grantInvoke` on target for caller); Function-URL IAM auth is independent of this Invoke grant.
- The router is "dumb": TLS + routing + caching only; behaviours are purely generated from manifests — adding a service needs no router edits beyond passing the cell.
- `forge`/`cells` is **routeless** (`routes: []`, `platform-stack.ts:355`) — a backend tool-provider reached only via allow-listed invokes, never fronted by CloudFront.
- Router requires ≥1 cell (`service-router.ts:161-163`); `defaultCell` defaults to `cells[0]`.

**Reduces to:** `cell`, `edge-http`. Compounds on `cell`: the manifest is the built-time publish/contract seam of the Cell axis (the tier-1 analogue of the runtime `$cells` `publishes`/`backs`), and `allow()` is the explicit cross-cell least-privilege invoke edge. Compounds on `edge-http`: route→behaviour generation turns a cell's declared routes into CloudFront ingress. Metadata + IAM plumbing that composes cells behind the edge — not a new primitive.

**Connections:** `HttpServiceCell`, `ServiceRouter`, the runtime `serviceClient` (consumer of `SERVICE_REGISTRY`).

**ADRs:** `docs/serverless-platform.md` §Communication modes, `docs/dynamic-cells.md` (routeless forge).

---

## Stack composition & reactive topology (PlatformStack wiring)

**Files:** `lib/platform-stack.ts`, `lib/inline-lambda-stack.ts`, `platform/infra/index.ts`

### What it does

The single build-time assembly that instantiates and wires every construct above into the live platform: the substrate table + event bus as stack-level primitives; the `auth` / `workspace` / `gateway` / `dispatch` / `cells`(forge) cells; the `DynamicCellControlPlane`; the `SubstrateAnalyticsLane` + `substrate-archiver`; the `vector-indexer` (stream consumer, ADR-0030); the `ServiceRouter` (+ optional cell distribution); and the full EventBridge routing + scheduled-rule topology. It also carries operationally load-bearing tuning and cross-cutting IAM.

### Public API

```ts
export interface PlatformStackProps extends cdk.StackProps {
  envName?: string; publicBaseUrl?: string;
  domainNames?: string[]; certificateArn?: string; cellDomain?: string;
}
export class PlatformStack extends cdk.Stack { … }

// Routing topology (eventBus.routeTo):
//   'SubstrateWriteRoute'   substrate.write.requested   src 'cell-'    → workspace
//   'CellLifecycleRoute'    cell.* lifecycle            src 'cells'    → workspace (pointer facts)
//   'FactReactionRoute'     workspace.fact.written      src 'workspace'→ workspace (reactor)
//   'ReindexRoute'          workspace.reindex.requested src 'workspace'→ workspace
//   'CapabilityTouchRoute'  capability.invoked          src 'gateway'  → workspace (_caps touch)
//   'CellDeployRoute'       cell.deploy.requested       src 'cells'    → cells (async bundle)
// Schedules:
//   TendSchedule       cron(min 30, hour 6) → workspace.tend.requested   { scopes:['c15r'] }
//   MachineTickSchedule rate(1 min)         → machine.tick.requested     { scopes:['c15r'] }
```

### Data model

Routing topology as above. Cross-cutting IAM: `s3vectors:*` (resource `*`), `bedrock:InvokeModel` on the Titan model, platform-log read scoped by stack-name wildcard. Env injected: `PUBLIC_BASE_URL`, `WEBAUTHN_RP_ID`, `MCP_CORS_ORIGIN_SUFFIX`, `CELL_DOMAIN_SUFFIX`, `DISPATCH_DEFAULT_CELL='c15r/home'` (`platform-stack.ts:390`).

### Invariants & edge cases

- Substrate table + event bus are **stack-level primitives** (peers), not cell-private (`platform-stack.ts:70,77`).
- `PUBLIC_BASE_URL` is deliberately **not** derived from the distribution domain — doing so would create a CloudFormation circular dependency (edge fns → distribution → their Function URLs), which is exactly how the first staging deploy failed (`platform-stack.ts:490-497`). Set it explicitly; for a new env, deploy-read-redeploy.
- The router fronts only `auth`/`workspace`/`gateway`/`dispatch`; `forge`(cells) is routeless; apex `/*` → dispatch → `c15r/home`.
- `InlineLambdaStack` is intentionally emptied — step one of a two-step teardown of the legacy inline MCP/auth Lambda (`inline-lambda-stack.ts`).

> ⚠ **Coherence — write-fanout (medium, conflicts).** Only **two** `DynamoEventSource` consumers attach to the substrate stream (`platform-stack.ts:206-214`, `240-248`) — no third. Reactions/reindex/capability-touch instead ride EventBridge (`FactReactionRoute` at `platform-stack.ts:269`). This is a genuine single-source-of-truth split with no unifying helper. **Recommendation:** make the stream the canonical fan-out for reactions too, collapsing `workspace.fact.written` into a stream-derived signal. *(Evidence caveat: the "6509 facts / live edges.json" snapshot is a runtime artifact, not tracked in the repo; the mechanism claim stands regardless — the indexer does write similarTo edges at `services/vector-indexer/handler.ts:126-150`.)*

> ⚠ **Coherence — embed-orchestration (medium, conflicts).** The vector-index dimension is computed by two duplicated formulas: `services/vector-indexer/handler.ts:60` uses strict `process.env.VECTOR_EMBEDDER === 'bedrock'` while `platform/runtime/s3-vectors-store.ts:236` lowercases first. In the current deploy this is **latent** only because `lib/platform-stack.ts:136` pins `VECTOR_DIM:'1024'` and `VECTOR_EMBEDDER:'bedrock'` on *both* the workspace (`:164`) and indexer (`:197`) Lambdas, so both formulas read the same literal. The divergence activates if someone edits one default in isolation, or sets `VECTOR_EMBEDDER=Bedrock` (capital B) — then DIM resolves to 256 while the embedder is 1024-dim, skewing the index name (`slice-<scope>-d<dim>`) and causing a dimension-mismatch on first put. **Recommendation:** drop the module-level DIM formula and thread `vectors.embedder.dimension` (the single source every query site uses) into the pure `planStreamWork(event, dim)`.

> ⚠ **Coherence — write-fanout (info, scoping clarification).** ADR-0053's client shadow-state seam (`createOutbox`/`createProjection` in `cells/kernel/client/main.ts:541,677`) merely *polls* the pre-existing `workspace.changes` server feed — it consumes server fan-out, it does not make server propagation single-origin. Don't conflate it with the server-side "one origin" decision above.

**Reduces to:** `cell`, `fact`, `edge-http`. This is the *composition root*, not a primitive — it reduces to all three cores by instantiating them (SubstrateTable = `fact`; cells + control plane = `cell`; router + edge transforms = `edge-http`). Its own added value is the reactive **topology** (which events route where, source-attested) that turns discrete primitives into the self-maintaining substrate — every arrow is a `routeTo` over the bus landing in a Fact write. The `workspace.graph` 2GB/120s bump (`platform-stack.ts:150-158`) is a live coherence signal that the derived-edge projection is not yet bounded; the source acknowledges the real fix is bounding the projection, not the memory hotfix.

**Connections:** all constructs in `platform/infra`; `services/*` (entries); runtime `state.ts` (the applier the routes feed).

**ADRs:** ADR-0030/0031 (semantic search / similarTo edges), ADR-0069 (one edge query — `workspace.edges`), ADR-0085 (capabilities-are-facts / usage→salience), ADR-0011 (Reactivity).

---

## Gotchas / non-obvious behaviour

- **Function URLs are IAM-auth by default and unreachable except through CloudFront OAC.** A raw Function URL 403s on direct invoke; `publicFunctionUrl: true` is the only dev opt-out. If a POST 403s through CloudFront, the ORIGIN_SIGNER edge function (or its `includeBody`) is the suspect.
- **The 1 MB edge body cap is real.** `origin-request includeBody` truncates at 1 MB; large uploads must use the S3 presigned-PUT path (the control-plane code bucket's CORS exists for this).
- **Edge construct ids are load-bearing.** `OriginSignerRole` keeps its id on purpose — Lambda@Edge replicas linger for hours, so renaming orphans/replaces them. `WwwAuthEdge` got a *new* id precisely because CFN can't change a resource's type in place (it was previously a CloudFront Function).
- **Scope must repeat in every GSI pk** or LeadingKeys silently stops covering index reads — this is a *discipline* the write path must honour; nothing in `SubstrateTable` enforces it.
- **`iam:CreateRole` conditioned on `iam:PermissionsBoundary` is the entire tier-2 security argument.** If you touch `grantControlPlane`, do not weaken that condition — it is what makes "arbitrary cell code cannot exceed the boundary" provable.
- **Source prefixes are exclusion filters, not just inclusion.** `'cells'` matches the forge service but *not* `cell-<id>` dynamic cells (the prefix `cell-` is a superstring of neither `cells` nor `cell`). Choose prefixes with the exclusion in mind.
- **Owner labels must be hyphen-free.** Cell-origin host rewrite splits on the *first* hyphen; registration enforces `^[a-z0-9]+$` on owners for exactly this reason.
- **The analytics lake has no per-slice isolation yet.** `grantQuery` opens the whole lake; the `workspace.athena` tool is admin-gated to compensate. LeadingKeys isolation is not mirrored in the analytics lane.
- **`PUBLIC_BASE_URL` must be set explicitly, never derived from the distribution.** Deriving it creates a CloudFormation circular dependency — new environments require deploy → read output → set var → redeploy.
- **The full derived-edge projection is the known fragile seam.** (Its old verb name `workspace.graph` is retired — ADR-0069 — but the seam is the same.) The projection runs server-side with no cursor regardless of caller limit; the 2 GB / 120 s workspace bump (and 512 MB / 150 s gateway, which must outlast it) are hotfixes, not the fix.
- **Two "a fact changed" mechanisms coexist.** The DynamoDB stream feeds the indexer + archiver; EventBridge `workspace.fact.written` feeds reactions/reindex/capability-touch. They are selected inconsistently and share no origin (see the coherence callouts).
- **`InlineLambdaStack` is deliberately empty.** Do not add resources — it exists only so CloudFormation can delete the legacy inline Lambda's resources in a controlled teardown.
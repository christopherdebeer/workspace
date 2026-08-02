import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as awsevents from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import {
  HttpServiceCell,
  ServiceRouter,
  PlatformEventBus,
  DynamicCellControlPlane,
  SubstrateTable,
  SubstrateAnalyticsLane,
} from '../platform/infra';

export interface PlatformStackProps extends cdk.StackProps {
  /**
   * Deployment environment, e.g. "production" or "staging". Namespaces the
   * resources that must be account/region-unique (currently the event bus) so
   * multiple environments can coexist. Defaults to "production".
   */
  envName?: string;
  /**
   * Public base URL the platform is served from, e.g. "https://app.parc.land".
   * Sets the auth cell's OAuth issuer + WebAuthn RP id so they stay correct
   * across the CloudFront/OAC hop. Defaults to the CloudFront distribution's
   * own domain when omitted.
   */
  publicBaseUrl?: string;
  /** CloudFront alternate domain names (CNAMEs), e.g. ["app.parc.land"]. */
  domainNames?: string[];
  /** ARN of an ACM certificate in us-east-1 covering `domainNames`. */
  certificateArn?: string;
  /**
   * Namespace label for host-isolated user cells, e.g. "on.parc.land". When set,
   * a second CloudFront distribution serves cells from `<owner>-<name>.<cellDomain>`
   * (each its own browser origin — see docs/cell-origin-isolation.md), fronted by a
   * CDK-managed, DNS-validated `*.<cellDomain>` cert. Unset ⇒ nothing changes.
   */
  cellDomain?: string;
}

/**
 * Serverless multi-project platform stack.
 *
 * Demonstrates the architecture: a single CloudFront router in front of many
 * independent service cells, a shared event bus, and direct (least-privilege)
 * service-to-service invocation. Each new service is a sub-50-line
 * `HttpServiceCell` instantiation.
 */
export class PlatformStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: PlatformStackProps) {
    super(scope, id, props);

    const envName = props?.envName ?? 'production';
    cdk.Tags.of(this).add('platform:env', envName);

    // When running from compiled JS in dist/lib, ascend two dirs to the repo
    // root to locate the (TypeScript) service entry code for bundling.
    const serviceEntry = (name: string): string =>
      path.join(__dirname, '..', '..', 'services', name, 'service.ts');

    // The bus name must be unique per account/region, so suffix non-prod envs.
    const busName = envName === 'production' ? 'platform-bus' : `platform-bus-${envName}`;
    const eventBus = new PlatformEventBus(this, 'EventBus', { busName });

    // The substrate table — the platform's shared observed-state store (the
    // blackboard), a stack-level primitive with the same status as the event
    // bus. Scope-partitioned; the workspace cell is its room provider, and
    // dynamic cells get LeadingKeys-scoped read access through the permission
    // boundary. See docs/substrate-storage.md.
    const substrate = new SubstrateTable(this, 'Substrate');

    // Auth primitive: WebAuthn passkeys + OAuth 2.1 + scoped tokens (ported from
    // c15r/mcp-auth). Owns the auth_* data; peers consume it via tokens, never
    // by reading its table. PUBLIC_BASE_URL keeps OAuth issuer/rpId stable
    // across the CloudFront/OAC hop (set to the platform's public domain).
    const auth = new HttpServiceCell(this, 'AuthService', {
      name: 'auth',
      entry: serviceEntry('auth'),
      // The authorize/consent page is a React SPA bundled from client/main.tsx.
      clientEntry: path.join(__dirname, '..', '..', 'services', 'auth', 'client', 'main.tsx'),
      routes: ['/auth/*', '/oauth/*', '/webauthn/*', '/.well-known/*'],
      persistence: { dynamo: true, dynamoTtl: true },
      commands: ['validateToken', 'mintToken', 'listTokens', 'tokens', 'revokeToken', 'describeTools'],
      emits: ['auth.user.registered', 'auth.token.minted', 'auth.token.revoked'],
      eventBus,
      environment: {
        AUTH_SERVER_NAME: 'workspace',
        // Advertised scopes (docs/capability-consent.md). Coarse buckets stay for
        // back-compat (existing clients request them); the granular vocabulary —
        // read:workspace / write:workspace / cells:create — lets new clients
        // request precise capabilities. Admin scopes (`platform:*`, and
        // `cells:create`, gated below) are grantable only to AUTH_ADMIN_USERNAMES,
        // enforced at consent. The picker shows each client only what it requested
        // ∩ what the user may grant.
        AUTH_SCOPES:
          'workspace:read workspace:write workspace:admin platform:cells:create platform:* read:workspace write:workspace cells:create',
        AUTH_ADMIN_USERNAMES: 'c15r',
        // cell creation stays admin-gated: the granular `cells:create` carries no
        // `platform:` prefix, so name it explicitly alongside the prefix default.
        AUTH_ADMIN_SCOPE_PREFIXES: 'platform: cells:create',
      },
      // PUBLIC_BASE_URL / WEBAUTHN_RP_ID are set below, once the router (and thus
      // the public domain) exists.
    });

    // (Retired: the `documents` + `render` example cells — bootstrap-era demos of
    // defineService persistence + peer sync-calls, superseded by `workspace` (real
    // substrate persistence) and `cells` (the real reflexive example). See
    // docs/platform-cells.md.)

    // The first flagship room over the observed-state substrate: each user's
    // workspace is their slice of the one Substrate ({ value, _meta } facts with
    // provenance + salience). The workspace is the substrate's *room provider* —
    // vocabulary, sharing, shaping — over the shared substrate table; it owns no
    // private storage. See docs/substrate.md + docs/substrate-storage.md.
    // Semantic search (ADR-0030): one vector bucket per env/account, created at
    // RUNTIME by the workspace + indexer Lambdas (create-if-absent, §3a). Shared
    // by the workspace cell (query/reindex) and the stream indexer (live updates).
    const vectorBucket = `parc-vectors-${envName}-${this.account}`;
    const titanModelArn = `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`;
    // Embedding backend (ADR-0030 Inc 4): Bedrock Titan Text Embeddings v2 (1024-dim,
    // cosine). Model access now auto-enables on first invoke (the Bedrock model-access
    // page is retired), so this needs no manual activation. Switching the embedder
    // re-namespaces indexes by dimension (slice-<scope>-d1024), so the old 256-dim
    // hashing index is orphaned and `reindex` repopulates the new one — see indexForScope.
    // VECTOR_SIMILAR_MIN_SCORE=0.25 (ADR-0032 Inc 3): a *suggestion* model can afford a
    // lower cosine floor than auto-materialized salience could — more candidates, low
    // cost, the human filters via `suggestions`/`ratify`. (Default would be 0.35.)
    const vectorEnv = { VECTOR_BUCKET: vectorBucket, VECTOR_REGION: this.region, VECTOR_EMBEDDER: 'bedrock', VECTOR_DIM: '1024', VECTOR_SIMILAR_MIN_SCORE: '0.25' };

    const workspace = new HttpServiceCell(this, 'WorkspaceService', {
      name: 'workspace',
      entry: serviceEntry('workspace'),
      routes: ['/workspace/*'],
      commands: ['remember', 'ingest', 'recall', 'peek', 'query', 'search', 'reindex', 'pruneSimilar', 'suggestions', 'ratify', 'link', 'unlink', 'neighbors', 'links', 'changes', 'attention', 'tend', 'registerAction', 'actions', 'deleteAction', 'invoke', 'registerView', 'views', 'view', 'deleteView', 'registerSubscription', 'subscriptions', 'deleteSubscription', 'supersede', 'share', 'unshare', 'shared', 'group', 'groups', 'requestGrant', 'grantRequests', 'approveGrant', 'denyGrant', 'athena', 'describeTools'],
      // `workspace.fact.written` is NOT in this list: the FactFanout stream
      // consumer below is its one origin (Source `workspace`), not this cell.
      emits: ['workspace.shared', 'workspace.action.invoked', 'workspace.tended', 'workspace.ingested', 'workspace.grant.requested', 'workspace.grant.resolved'],
      eventBus,
      // The hot write path: each put recomputes salience, so ingest is CPU-bound.
      // Telemetry (2026-06-25) showed 256 MB → ~84% mem use and 6–15 s batches that
      // tripped the 15 s timeout, surfacing as gateway 502s. Lambda CPU scales with
      // memory; 1 GB (~4× CPU) brings a 4-fact batch to a couple seconds. 60 s
      // timeout gives margin for the daily tending pass over a large slice.
      // Bumped again (2026-07-11, ADR-0081 migration aftermath): the whole-projection edge read
      // computes the FULL derived edge projection server-side regardless of any
      // caller-side limit (unlike `query`, it has no cursor to page through) —
      // once the slice crossed a few thousand facts this alone started 502ing.
      // 2 GB (~8x baseline CPU) + 120 s gives the same headroom the write path
      // already has for a slice this size; the real fix (bounding the edge
      // projection itself) is a follow-up, not a hotfix.
      memorySize: 2048,
      timeoutSeconds: 120,
      // Semantic search backend (ADR-0030). The bucket + per-slice indexes are
      // created at RUNTIME, create-if-absent (§3a — no CDK for them); only the
      // bucket name + region are wired here. VECTOR_EMBEDDER defaults to the
      // deterministic hashing embedder; flip to `bedrock` (Increment 4) once Titan
      // model access is enabled — a config change, no redeploy of code.
      environment: vectorEnv,
    });
    substrate.grantReadWrite(workspace);
    // S3 Vectors (runtime data plane) + Bedrock embeddings (Increment 4) for the
    // workspace Lambda. Resource '*' for s3vectors: the vector-bucket ARN format is
    // pinned at runtime by create-if-absent and this is a single-owner deployment;
    // tighten to the bucket ARN once confirmed live. Bedrock granted now so enabling
    // Titan is a pure config flip (VECTOR_EMBEDDER=bedrock), no IAM redeploy.
    workspace.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3vectors:*'],
        resources: ['*'],
      }),
    );
    workspace.fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [titanModelArn],
      }),
    );

    // Live vector indexer (ADR-0030 Increment 2): the dormant SubstrateTable stream's
    // first consumer. Each fact create/update is embedded + upserted into its slice
    // index; supersession/delete removes it. A standalone Lambda off the stream — no
    // hot-path cost, and a failure here can't perturb the write path or the reactor.
    const vectorIndexer = new NodejsFunction(this, 'VectorIndexer', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', '..', 'services', 'vector-indexer', 'handler.ts'),
      handler: 'handler',
      // 1024: the ADR-0092 public-projection rebuild reads the layout manifest
      // + all shards in one invocation on top of the embed/edge pass — 512 left
      // no headroom (and doubles CPU, so batches clear faster).
      memorySize: 1024,
      timeout: cdk.Duration.seconds(60),
      logRetention: logs.RetentionDays.ONE_WEEK,
      // Plus SUBSTRATE_TABLE so the indexer can write inferred similarTo edges (ADR-0031).
      environment: { ...vectorEnv, SUBSTRATE_TABLE: substrate.table.tableName },
      bundling: { externalModules: [] }, // bundle the SDKs (not in the Node 20 image)
    });
    vectorIndexer.addToRolePolicy(new iam.PolicyStatement({ actions: ['s3vectors:*'], resources: ['*'] }));
    vectorIndexer.addToRolePolicy(new iam.PolicyStatement({ actions: ['bedrock:InvokeModel'], resources: [titanModelArn] }));
    // Inferred similarTo edges (ADR-0031): the indexer reconciles edges in each fact's
    // own scope partition directly. Read+write on the substrate table; the stream
    // already grants read on the source. (Platform component, like the workspace reactor.)
    substrate.table.grantReadWriteData(vectorIndexer);
    vectorIndexer.addEventSource(
      new DynamoEventSource(substrate.table, {
        startingPosition: lambda.StartingPosition.LATEST, // index from now forward; `reindex` backfills history
        batchSize: 100,
        maxBatchingWindow: cdk.Duration.seconds(10),
        retryAttempts: 3,
        bisectBatchOnError: true,
      }),
    );
    // Analytics + durable-archive lane (docs/substrate-analytics.md): a SECOND
    // consumer on the SubstrateTable stream (alongside the vector indexer)
    // flattens each fact change and forwards it to Kinesis Firehose, which lands
    // newline-JSON in S3 (gzip, date-partitioned), catalogued in Glue via
    // partition projection so Athena queries the whole substrate with SQL — the
    // ad-hoc/analytical surface DynamoDB's access model can't serve, plus a
    // permanent (TTL-free) archive of the trajectory. Isolated from the write
    // path (runs off the stream); no-ops until FIREHOSE_STREAM is set.
    const analytics = new SubstrateAnalyticsLane(this, 'SubstrateAnalytics', {
      envName,
      account: this.account,
      region: this.region,
    });
    const archiver = new NodejsFunction(this, 'SubstrateArchiver', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', '..', 'services', 'substrate-archiver', 'handler.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(60),
      logRetention: logs.RetentionDays.ONE_WEEK,
      bundling: { externalModules: [] }, // bundle the SDK (not in the Node 20 image)
    });
    analytics.grantPutRecords(archiver);
    // The admin-gated `workspace.athena` SQL surface reads the lake via Athena.
    analytics.grantQuery(workspace.fn);
    // The admin-gated `workspace.metrics` surface reads the platform's own
    // CloudWatch metrics (docs/cost-review-2026-07.md: the bill review had no
    // eye on infra consumption from inside the membrane). Read-only actions;
    // CloudWatch metrics APIs are account-scoped, hence resources: ['*'].
    workspace.fn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['cloudwatch:GetMetricData', 'cloudwatch:ListMetrics'], resources: ['*'] }),
    );
    archiver.addEventSource(
      new DynamoEventSource(substrate.table, {
        startingPosition: lambda.StartingPosition.LATEST, // archive from now forward
        batchSize: 200,
        maxBatchingWindow: cdk.Duration.seconds(30),
        retryAttempts: 3,
        bisectBatchOnError: true,
      }),
    );

    // The ONE physical origin of "a fact changed": a THIRD stream consumer that
    // announces every genuine fact write as `workspace.fact.written` (Source
    // `workspace` — the same envelope FactReactionRoute has always consumed).
    // Before this, the event was hand-emitted at ~10 write sites and a new
    // write path that forgot the emit silently broke reactions while the
    // stream-riding consumers (indexer, archiver) kept working. Now whatever
    // writes the table announces — the emit cannot be forgotten.
    const factFanout = new NodejsFunction(this, 'FactFanout', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '..', '..', 'services', 'fact-fanout', 'handler.ts'),
      handler: 'handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: { EVENT_BUS_NAME: eventBus.bus.eventBusName },
      bundling: { externalModules: [] }, // bundle the SDK (not in the Node 20 image)
    });
    eventBus.grantPutEvents(factFanout);
    factFanout.addEventSource(
      new DynamoEventSource(substrate.table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 50, // reactions want promptness — no batching window
        retryAttempts: 3,
        bisectBatchOnError: true,
      }),
    );
    // EVENT-DRIVEN WAIT WAKES (2026-08-01 cost review): the fanout already
    // holds every stream record's full image, so it can see a machine run
    // enter `waiting` with zero extra reads and mint a ONE-SHOT EventBridge
    // Scheduler entry that fires machine.tick.requested at the deadline —
    // queue-triggered check-ins instead of a continuous poll. The schedule
    // targets the platform bus (never the Lambda directly: a bus ARN is not
    // self-referential, and the route below is the one consumer).
    const waitSchedulerRole = new iam.Role(this, 'MachineWaitSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    eventBus.grantPutEvents(waitSchedulerRole);
    factFanout.addEnvironment('MACHINE_WAIT_SCHEDULER_ROLE_ARN', waitSchedulerRole.roleArn);
    factFanout.addEnvironment('MACHINE_WAIT_EVENT_BUS_ARN', eventBus.bus.eventBusArn);
    factFanout.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['scheduler:CreateSchedule', 'scheduler:UpdateSchedule'], resources: ['*'] }),
    );
    factFanout.addToRolePolicy(new iam.PolicyStatement({ actions: ['iam:PassRole'], resources: [waitSchedulerRole.roleArn] }));
    eventBus.routeTo('MachineWaitWakeRoute', workspace.fn, ['machine.tick.requested'], 'platform.machine-tick');

    // The organ-to-reef write path: dynamic cells (source IAM-pinned to their
    // cell-<id>) emit substrate.write.requested; the workspace applies the
    // fact in the owner's slice. See docs/substrate-storage.md.
    eventBus.routeTo('SubstrateWriteRoute', workspace.fn, ['substrate.write.requested'], 'cell-');
    // Platform reflected in the substrate: cell lifecycle events (source pinned
    // to the cells service — dynamic cells emit as `cell-<id>`, which this
    // prefix does not match) project into `cells/<cellId>` pointer facts in the
    // owner's slice, making cells queryable/linkable like any other fact.
    eventBus.routeTo(
      'CellLifecycleRoute',
      workspace.fn,
      ['cell.create.requested', 'cell.deployed', 'cell.files.changed', 'cell.delete.requested', 'cell.data.changed'],
      'cells',
    );
    // The reaction reactor: deliver every fact change back to the workspace so
    // the slice's `_subscriptions/*` can invoke matching declared actions. The
    // source is pinned to `workspace` — emitted by the FactFanout stream
    // consumer above (the one origin), so only first-party fact events drive
    // reactions. This is the generic primitive reactive machines ride on.
    eventBus.routeTo('FactReactionRoute', workspace.fn, ['workspace.fact.written'], 'workspace');
    // The async, chunked semantic-search reindex (ADR-0030/0031): the command dispatches
    // a `workspace.reindex.requested` event and the handler chains continuation events to
    // itself (source 'workspace'), one bounded page per invocation, off the 30s edge.
    eventBus.routeTo('ReindexRoute', workspace.fn, ['workspace.reindex.requested'], 'workspace');
    // ADR-0085 Inc 0 (usage → salience): the gateway announces every successful
    // read/act dispatch as `capability.invoked` (source pinned to the gateway —
    // only the real dispatch path may claim a capability was used); the workspace
    // applies it as one actor-classed touch on the `_caps/<target>` fact.
    eventBus.routeTo('CapabilityTouchRoute', workspace.fn, ['capability.invoked'], 'gateway');
    // Autonomous tending (the legacy workspace's signature loop): a daily
    // schedule delivers workspace.tend.requested; the handler distills
    // attention() into a tending/latest audit fact per scope.
    new awsevents.Rule(this, 'TendSchedule', {
      schedule: awsevents.Schedule.cron({ minute: '30', hour: '6' }),
      targets: [
        new eventTargets.LambdaFunction(workspace.fn, {
          event: awsevents.RuleTargetInput.fromObject({
            'detail-type': 'workspace.tend.requested',
            source: 'platform.tend',
            detail: { scopes: ['c15r'] },
          }),
        }),
      ],
    });
    // The machine tick, demoted to an HOURLY safety net + reaper (2026-08-01
    // cost review): the old 1-minute cron read every machine-run fact 43k
    // times a month — ~$16/mo of DynamoDB, the entire idle floor — to guard
    // waits that fire a few times a day. Precision wakes are EVENT-DRIVEN now:
    // the fact fanout creates a one-shot EventBridge Scheduler entry the
    // moment a run enters `waiting` (see MachineWaitSchedulerRole below), so
    // this cron only catches leaked runs (the reaper) and any wake a schedule
    // failed to deliver.
    new awsevents.Rule(this, 'MachineTickSchedule', {
      schedule: awsevents.Schedule.rate(cdk.Duration.hours(1)),
      targets: [
        new eventTargets.LambdaFunction(workspace.fn, {
          event: awsevents.RuleTargetInput.fromObject({
            'detail-type': 'machine.tick.requested',
            source: 'platform.machine-tick',
            detail: { scopes: ['c15r'] },
          }),
        }),
      ],
    });

    // (Retired 2026-06-21: the tier-1 `home` SPA service. The platform face is now the
    // tier-2 `@c15r/home` cell, served at the apex via dispatch's DISPATCH_DEFAULT_CELL —
    // the "home demotion". See services/dispatch + docs/serverless-platform.md.)

    // The MCP gateway: owns `/mcp` (the protected resource the auth cell
    // advertises) and exposes the stable read/act surface, forwarding to the
    // owning cell. See docs/dynamic-cells.md.
    const gateway = new HttpServiceCell(this, 'GatewayService', {
      name: 'gateway',
      entry: serviceEntry('gateway'),
      // The MCP-Apps card widget (ADR-0034/0035): esbuilt to `app.js` beside the
      // handler, inlined by `widgets.ts` into the `ui://parc/card` resource. Uses the
      // shared `platform/ui` render vocabulary + marked.
      clientEntry: path.join(__dirname, '..', '..', 'services', 'gateway', 'client', 'main.ts'),
      // Both the bare resource identifier (`/mcp`, advertised in the PRM) and its
      // sub-paths. CloudFront's `/mcp/*` pattern does not match the bare `/mcp`.
      routes: ['/mcp', '/mcp/*'],
      eventBus,
      // The gateway forwards (synchronously invokes) the workspace cell and waits,
      // so its timeout must outlast the workspace's; 256 MB also throttled its own
      // resolveTarget/scope work. Raise to 512 MB / 60 s so a slow downstream batch
      // no longer surfaces as a CloudFront 502 (telemetry 2026-06-25).
      // Bumped again (2026-07-11, alongside the workspace 60s→120s bump for
      // the whole-projection edge read): must stay outlasting workspace's timeout or this
      // service becomes the new bottleneck at exactly the same failure mode.
      memorySize: 512,
      timeoutSeconds: 150,
    });

    // ── Reflexive control plane (dynamic cells, tier 2) ──────────────
    // `forge` is the inward MCP API: it provisions user-owned dynamic cells at
    // runtime (each its own Lambda + table + permission-bounded role) and invokes
    // them. `dispatch` is the single `/@*` ingress that routes `/@<owner>/<cell>`
    // to forge. See docs/dynamic-cells.md.
    const controlPlane = new DynamicCellControlPlane(this, 'DynamicCells', {
      eventBus,
      substrateTable: substrate,
    });

    // forge is a backend tool-provider (no public route): the /mcp gateway and
    // dispatch reach it via allow-listed invokes. It provisions and invokes
    // dynamic cells; the gateway enforces tool scopes before forwarding.
    const cells = new HttpServiceCell(this, 'CellsService', {
      name: 'cells',
      entry: serviceEntry('cells'),
      routes: [],
      persistence: { dynamo: true },
      commands: ['create', 'list', 'get', 'call', 'grant', 'revoke', 'delete', 'logs', 'describeTools', 'catalogCells', 'describeCellTools', 'callCellTool', 'describeTypes', 'writeFile', 'replaceInFile', 'appendToFile', 'readFile', 'listFiles', 'deleteFile', 'deploy', 'putData', 'getData', 'listData'],
      emits: ['cell.create.requested', 'cell.shared', 'cell.unshared', 'cell.delete.requested', 'cell.deployed', 'cell.files.changed', 'cell.data.changed'],
      eventBus,
      // esbuild-wasm transpiles submitted TypeScript cells; install (don't bundle)
      // it so its .wasm ships in the asset. react/react-dom ship too so the cell
      // bundler can inline a server renderer (renderToString) into a cell's
      // index.js for isomorphic SSR — see transpile.ts SERVER_BUNDLED.
      bundlingNodeModules: ['esbuild-wasm', 'react', 'react-dom'],
      memorySize: 512,
      // The bundle (esm.sh dep fetches + esbuild) runs off the request path as an
      // event-driven invocation now (cell.deploy.requested → onDeployRequested),
      // so nothing in front caps it — give a cold cache headroom.
      timeoutSeconds: 120,
    });
    controlPlane.grantControlPlane(cells);
    // Async deploy: forge emits `cell.deploy.requested` and consumes it as a
    // fresh event-driven invocation, so bundling never rides the synchronous
    // request/edge timeout. Source-pinned to `cells` (the forge service emits as
    // `cells`; dynamic cells emit as `cell-<id>`, which this prefix excludes).
    eventBus.routeTo('CellDeployRoute', cells.fn, ['cell.deploy.requested'], 'cells');

    const dispatch = new HttpServiceCell(this, 'DispatchService', {
      name: 'dispatch',
      entry: serviceEntry('dispatch'),
      routes: ['/@*'],
      eventBus,
    });
    // The "home demotion" (retiring the tier-1 SPA): with dispatch as the router default
    // (below), an unmatched apex GET `/` routes here; dispatch's catch-all HTTP route now
    // reaches its handler, which forwards to this default cell — the platform face is a
    // tier-2 cell. (The first attempt 404'd because dispatch's in-Lambda router only
    // matched `/@*`; fixed in services/dispatch with apex catch-alls + dispatch tests.)
    // Stage 2 (done, apex verified): the tier-1 HomeService + services/home are removed.
    dispatch.fn.addEnvironment('DISPATCH_DEFAULT_CELL', 'c15r/home');

    // Any cell that protects routes asks the auth service to validate the
    // bearer token (the in-cell alternative to edge validation).
    workspace.allow(auth);
    // The substrate-write handler resolves an emitting cell's owner through
    // the registry (cells.resolveCell) — never from the event body.
    workspace.allow(cells);
    gateway.allow(auth);
    dispatch.allow(auth);
    // The /mcp gateway aggregates + forwards forge's tools; dispatch proxies
    // cell invocations through forge (which holds the registry and invoke
    // permission). Neither reads forge's table directly.
    gateway.allow(cells);
    dispatch.allow(cells);
    // The gateway also aggregates the workspace cell's tools (remember/recall/
    // share/…): it calls workspace.describeTools and forwards tools/call to it.
    gateway.allow(workspace);
    // SSR proxy (docs/dynamic-cells.md): for an authenticated navigation, dispatch
    // reads the substrate AS THE CALLER (its service client carries the validated
    // identity) and hands the shaped results to cells.call, which forwards them to
    // the cell — so a public cell server-renders real content without ever holding
    // a token. dispatch (not forge) does this: forge↔workspace would be a CDK
    // dependency cycle (workspace already calls cells.resolveCell), but dispatch
    // has no back-edge.
    dispatch.allow(workspace);
    // (home no longer validates tokens or reads the registry server-side — its SPA
    // is a read/act client over /mcp — so it needs no allow() grants.)

    // Single public entrypoint, behaviours generated from manifests. Optionally
    // fronted by a custom domain (CloudFront alias + ACM cert in us-east-1).
    let certificate: acm.ICertificate | undefined;
    if (props?.certificateArn) {
      certificate = acm.Certificate.fromCertificateArn(this, 'RouterCert', props.certificateArn);
    } else if (props?.domainNames && props.domainNames.length > 0) {
      // CDK-managed, DNS-validated cert. With external DNS (Namecheap) you must
      // add the ACM validation CNAME(s) manually; the deploy waits until the
      // cert is ISSUED, so roll a domain out via workflow_dispatch/local (not an
      // unattended merge) and add the CNAME promptly.
      certificate = new acm.Certificate(this, 'RouterCert', {
        domainName: props.domainNames[0],
        subjectAlternativeNames: props.domainNames.slice(1),
        validation: acm.CertificateValidation.fromDns(),
      });
    }

    // Host-isolated cell namespace (docs/cell-origin-isolation.md). A CDK-managed,
    // DNS-validated wildcard cert covers `*.<cellDomain>`; the deploy waits until
    // it is ISSUED, so add the ACM validation CNAME on Namecheap while it waits.
    let cellCertificate: acm.ICertificate | undefined;
    let cellDomainNames: string[] | undefined;
    if (props?.cellDomain) {
      cellDomainNames = [`*.${props.cellDomain}`];
      cellCertificate = new acm.Certificate(this, 'CellCert', {
        domainName: `*.${props.cellDomain}`,
        validation: acm.CertificateValidation.fromDns(),
      });
      // Let a host-isolated cell call the apex /mcp cross-origin with its bearer.
      gateway.fn.addEnvironment('MCP_CORS_ORIGIN_SUFFIX', `.${props.cellDomain}`);
      // Cap tokens minted for a cell-host redirect to the cell ceiling (model A).
      auth.fn.addEnvironment('CELL_DOMAIN_SUFFIX', `.${props.cellDomain}`);
    }

    // platform.logs (admin diagnostics, gated platform:admin at the gateway): let the
    // cells service read the TIER-1 services' CloudWatch logs. Scoped by STACK-NAME
    // wildcard (no per-function ARN → no gateway↔cells dependency cycle); the cells
    // handler discovers the exact auto-named group by prefix. DescribeLogGroups can't be
    // resource-scoped, so it stays account-wide (read-only metadata). Redaction is in-handler.
    cells.fn.addEnvironment('PLATFORM_STACK_NAME', this.stackName);
    const platformLogGroups = `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/${this.stackName}-*`;
    cells.fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ReadPlatformLogs',
        actions: ['logs:FilterLogEvents', 'logs:GetLogEvents', 'logs:DescribeLogStreams'],
        resources: [platformLogGroups, `${platformLogGroups}:*`],
      }),
    );
    cells.fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'DiscoverPlatformLogGroups',
        actions: ['logs:DescribeLogGroups'],
        resources: [`arn:aws:logs:${this.region}:${this.account}:log-group:*`],
      }),
    );

    const router = new ServiceRouter(this, 'Router', {
      // forge is a routeless backend, so it is not fronted by CloudFront.
      cells: [auth, workspace, gateway, dispatch],
      // Apex `/*` → dispatch → DISPATCH_DEFAULT_CELL (c15r/home). Rollback = `home`.
      defaultCell: dispatch,
      domainNames: props?.domainNames,
      certificate,
      // dispatch already path-routes `/@<owner>/<name>`; the cell distribution
      // rewrites `<owner>-<name>.<cellDomain>` hosts onto that path.
      cellHostRouter: dispatch,
      cellDomainNames,
      cellCertificate,
    });

    // Make the auth cell self-consistent with the public origin via an explicit
    // public base URL (the custom domain). Without it the cell derives URLs
    // from the forwarded Host across the OAC hop — acceptable for a fresh
    // environment's first deploy. Deliberately NOT derived from
    // `router.distribution.distributionDomainName`: the origin functions would
    // then reference the distribution that references their Function URLs — a
    // CloudFormation circular dependency (this is exactly how the first
    // PlatformStack-staging deploy failed). For a new environment: deploy once,
    // read the distribution domain from the outputs, set the repo var, redeploy.
    if (props?.publicBaseUrl) {
      const webauthnRpId = new URL(props.publicBaseUrl).hostname;
      auth.fn.addEnvironment('PUBLIC_BASE_URL', props.publicBaseUrl);
      auth.fn.addEnvironment('WEBAUTHN_RP_ID', webauthnRpId);
      // The resource cell derives its metadata/challenge URLs from req.url, which
      // honours PUBLIC_BASE_URL across the OAC hop (where the viewer Host is lost).
      gateway.fn.addEnvironment('PUBLIC_BASE_URL', props.publicBaseUrl);
    }
  }
}

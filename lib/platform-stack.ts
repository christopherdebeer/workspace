import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as awsevents from 'aws-cdk-lib/aws-events';
import * as eventTargets from 'aws-cdk-lib/aws-events-targets';
import {
  HttpServiceCell,
  ServiceRouter,
  PlatformEventBus,
  DynamicCellControlPlane,
  SubstrateTable,
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
        // Advertised scopes; `platform:*` are admin-gated to AUTH_ADMIN_USERNAMES,
        // enforced at consent. The picker shows each user only what they may grant.
        AUTH_SCOPES: 'workspace:read workspace:write workspace:admin platform:cells:create platform:*',
        AUTH_ADMIN_USERNAMES: 'c15r',
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
    const workspace = new HttpServiceCell(this, 'WorkspaceService', {
      name: 'workspace',
      entry: serviceEntry('workspace'),
      routes: ['/workspace/*'],
      commands: ['remember', 'ingest', 'recall', 'peek', 'query', 'link', 'unlink', 'neighbors', 'links', 'changes', 'attention', 'tend', 'registerAction', 'actions', 'deleteAction', 'invoke', 'registerView', 'views', 'view', 'deleteView', 'supersede', 'share', 'unshare', 'shared', 'group', 'groups', 'requestGrant', 'grantRequests', 'approveGrant', 'denyGrant', 'describeTools'],
      emits: ['workspace.fact.written', 'workspace.shared', 'workspace.action.invoked', 'workspace.tended', 'workspace.ingested', 'workspace.grant.requested', 'workspace.grant.resolved'],
      eventBus,
    });
    substrate.grantReadWrite(workspace);
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
      ['cell.create.requested', 'cell.deployed', 'cell.files.changed', 'cell.delete.requested'],
      'cells',
    );
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

    // Self-documenting front-end: a mobile-first React SPA served at `/` (the
    // router default). Its browser bundle is built from client/main.tsx by
    // esbuild at deploy time and shipped in the Lambda asset.
    const home = new HttpServiceCell(this, 'HomeService', {
      name: 'home',
      entry: serviceEntry('home'),
      clientEntry: path.join(__dirname, '..', '..', 'services', 'home', 'client', 'main.tsx'),
      routes: [],
      eventBus,
    });

    // The MCP gateway: owns `/mcp` (the protected resource the auth cell
    // advertises) and exposes the stable read/act surface, forwarding to the
    // owning cell. See docs/dynamic-cells.md.
    const gateway = new HttpServiceCell(this, 'GatewayService', {
      name: 'gateway',
      entry: serviceEntry('gateway'),
      // Both the bare resource identifier (`/mcp`, advertised in the PRM) and its
      // sub-paths. CloudFront's `/mcp/*` pattern does not match the bare `/mcp`.
      routes: ['/mcp', '/mcp/*'],
      eventBus,
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
      emits: ['cell.create.requested', 'cell.shared', 'cell.unshared', 'cell.delete.requested', 'cell.deployed', 'cell.files.changed'],
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

    const router = new ServiceRouter(this, 'Router', {
      // forge is a routeless backend, so it is not fronted by CloudFront.
      cells: [home, auth, workspace, gateway, dispatch],
      defaultCell: home,
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
      home.fn.addEnvironment('PUBLIC_BASE_URL', props.publicBaseUrl);
    }
  }
}

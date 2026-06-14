import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { HttpServiceCell } from './http-service-cell';

/**
 * Lambda@Edge (origin-request) source. CloudFront OAC signs origin requests with
 * SigV4, but for an IAM-protected Function URL it does NOT hash the request body
 * for POST/PUT/PATCH — it expects an `x-amz-content-sha256` header, and Lambda
 * rejects unsigned payloads. So every POST 403s. This runs just before OAC
 * signing, hashes the (unmodified) body, and sets that header so the signature
 * covers the payload. GET/HEAD/etc. pass through (OAC already signs empty
 * bodies). Note: origin-request includeBody caps the body at 1 MB.
 */
const ORIGIN_SIGNER_SRC = `'use strict';
const crypto = require('crypto');
exports.handler = (event, _ctx, callback) => {
  const request = event.Records[0].cf.request;
  // OAC SigV4-signs the origin request and OVERWRITES the viewer's Authorization
  // header with its signature — clobbering bearer tokens (MCP/OAuth resources).
  // Preserve the viewer's Authorization in a side header the origin reads instead.
  const auth = request.headers['authorization'];
  if (auth && auth.length) {
    request.headers['x-forwarded-authorization'] = [
      { key: 'X-Forwarded-Authorization', value: auth[0].value },
    ];
  }
  const m = request.method;
  if (m !== 'POST' && m !== 'PUT' && m !== 'PATCH' && m !== 'DELETE') {
    return callback(null, request);
  }
  const body = request.body || {};
  const buf = body.data
    ? Buffer.from(body.data, body.encoding === 'base64' ? 'base64' : 'utf8')
    : Buffer.alloc(0);
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  request.headers['x-amz-content-sha256'] = [{ key: 'x-amz-content-sha256', value: hash }];
  callback(null, request);
};
`;

/**
 * Lambda@Edge (origin-response) source. Lambda Function URLs remap
 * `WWW-Authenticate` to `x-amzn-remapped-www-authenticate`; this renames it back
 * so RFC 9728 / MCP clients see the literal header on a 401. (A CloudFront
 * Function can't — that response header is read-only there.)
 */
const WWW_AUTH_FIX_SRC = `'use strict';
exports.handler = (event, _ctx, callback) => {
  const response = event.Records[0].cf.response;
  const h = response.headers;
  const remapped = h['x-amzn-remapped-www-authenticate'];
  if (remapped && remapped.length) {
    h['www-authenticate'] = [{ key: 'WWW-Authenticate', value: remapped[0].value }];
    delete h['x-amzn-remapped-www-authenticate'];
  }
  callback(null, response);
};
`;

export interface ServiceRouterProps {
  /** All cells to expose. Their manifest routes become CloudFront behaviours. */
  cells: HttpServiceCell[];
  /**
   * Cell that handles unmatched paths. Defaults to the first cell. In a fuller
   * deployment this would be a static-site/frontend origin.
   */
  defaultCell?: HttpServiceCell;
  /**
   * Custom alternate domain names (CNAMEs) for the distribution, e.g.
   * ["app.parc.land"]. Requires `certificate`.
   */
  domainNames?: string[];
  /** ACM certificate (must be in us-east-1) covering `domainNames`. */
  certificate?: acm.ICertificate;

  // ── cell-origin isolation (docs/cell-origin-isolation.md) ──
  // An OPTIONAL second distribution that serves user cells from their own
  // per-cell subdomain (`<owner>-<name>.on.parc.land`), so each cell is a
  // distinct browser origin and cannot read the shell's localStorage/cookie.
  // Additive: unset ⇒ nothing changes; set ⇒ a separate distribution is created
  // and the existing apex one is untouched.
  /** The cell that routes `/@<owner>/<name>` requests (i.e. `dispatch`). */
  cellHostRouter?: HttpServiceCell;
  /** Wildcard alternate domain(s) for the cell distribution, e.g. ["*.on.parc.land"]. */
  cellDomainNames?: string[];
  /** ACM cert (us-east-1) covering `cellDomainNames`. */
  cellCertificate?: acm.ICertificate;
}

/**
 * Viewer-request CloudFront Function (cell distribution only): rewrite the
 * per-cell host `<owner>-<name>.<…>` to the `/@<owner>/<name>` path the
 * `dispatch` cell already understands — so host-isolated cells reuse the exact
 * path-routing with no backend change. The owner label must not contain `-`
 * (cell names may); split on the FIRST hyphen. A label with no hyphen is left
 * untouched.
 */
const CELL_HOST_REWRITE_SRC = `function handler(event) {
  var req = event.request;
  var host = (req.headers.host && req.headers.host.value) || '';
  var label = host.split('.')[0];
  var i = label.indexOf('-');
  if (i > 0) {
    var prefix = '/@' + label.substring(0, i) + '/' + label.substring(i + 1);
    // Idempotent: assets reference the cell's apex path (/@owner/name/app.js), so
    // skip the prepend when the URI is already this cell's path — otherwise it
    // double-prefixes and 404s (the cell's own /app.js, /style.css, …).
    if (req.uri !== prefix && req.uri.indexOf(prefix + '/') !== 0) {
      req.uri = prefix + req.uri;
    }
  }
  return req;
}`;

/**
 * The single public ingress: one CloudFront distribution that path-routes to
 * each service cell's Function URL. The router stays intentionally "dumb" — it
 * does TLS, caching, and path routing, but holds no business logic. Its
 * behaviours are generated from service manifests, so adding a service needs no
 * router edits beyond passing the new cell in.
 */
export class ServiceRouter extends Construct {
  readonly distribution: cloudfront.Distribution;
  /** The cell-namespace distribution (`*.on.parc.land`), when configured. */
  readonly cellDistribution?: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: ServiceRouterProps) {
    super(scope, id);

    if (props.cells.length === 0) {
      throw new Error('ServiceRouter requires at least one cell');
    }
    const defaultCell = props.defaultCell ?? props.cells[0];

    // One shared Origin Access Control: CloudFront signs every origin request
    // with SigV4 so the IAM-protected Function URLs accept it. CDK auto-adds the
    // matching `lambda:InvokeFunctionUrl` permission, scoped to this distribution.
    const oac = new cloudfront.FunctionUrlOriginAccessControl(this, 'Oac', {
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    });

    // Build one origin per cell and reuse it across that cell's behaviours, so a
    // cell that owns several routes does not get duplicate origins/permissions.
    const originByCell = new Map<HttpServiceCell, cloudfront.IOrigin>(
      props.cells.map((cell) => [
        cell,
        origins.FunctionUrlOrigin.withOriginAccessControl(cell.functionUrl, {
          originAccessControl: oac,
        }),
      ]),
    );

    // Shared role for the edge functions: assumable by both Lambda and
    // Lambda@Edge, basic execution (logs) only. Keeps the original construct id
    // ('OriginSignerRole') so it isn't replaced/deleted — the existing replicated
    // body-signer still references it, and Lambda@Edge replicas linger for hours.
    const edgeRole = new iam.Role(this, 'OriginSignerRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('lambda.amazonaws.com'),
        new iam.ServicePrincipal('edgelambda.amazonaws.com'),
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Origin-request Lambda@Edge that injects `x-amz-content-sha256` so OAC's
    // SigV4 signature covers the body (without it, every POST/PUT 403s). Lives in
    // us-east-1 (this stack), so a plain Function + version suffices — no
    // cross-region EdgeFunction needed.
    const originSigner = new lambda.Function(this, 'OriginSigner', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(ORIGIN_SIGNER_SRC),
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      role: edgeRole,
    });

    // Origin-response Lambda@Edge that restores the `WWW-Authenticate` header.
    // Lambda Function URLs remap a denylist of response headers by prefixing
    // `x-amzn-remapped-` — including `WWW-Authenticate` — and RFC 9728 / MCP
    // clients read the literal header to discover the auth server from a 401.
    // A CloudFront Function can't do this (that header is read-only there), so
    // it must be Lambda@Edge. (New construct id: the previous attempt used a
    // CloudFront Function under id 'RestoreWwwAuthenticate'; CFN can't change a
    // resource's type in place, so this gets a distinct id.)
    const wwwAuthFix = new lambda.Function(this, 'WwwAuthEdge', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(WWW_AUTH_FIX_SRC),
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      role: edgeRole,
    });

    // Function URL origins must not receive the viewer Host header (SigV4 signs
    // the origin host), so forward everything except Host. Dynamic APIs are not
    // cached. The edge functions run on every behaviour so POST signing and the
    // WWW-Authenticate fix apply platform-wide.
    const behaviorFor = (cell: HttpServiceCell): cloudfront.BehaviorOptions => ({
      origin: originByCell.get(cell)!,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      edgeLambdas: [
        {
          functionVersion: originSigner.currentVersion,
          eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
          includeBody: true,
        },
        {
          functionVersion: wwwAuthFix.currentVersion,
          eventType: cloudfront.LambdaEdgeEventType.ORIGIN_RESPONSE,
        },
      ],
    });

    const additionalBehaviors: Record<string, cloudfront.BehaviorOptions> = {};
    for (const cell of props.cells) {
      for (const route of cell.manifest.routes) {
        if (cell === defaultCell && route === '/*') continue;
        additionalBehaviors[route] = behaviorFor(cell);
      }
    }

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: behaviorFor(defaultCell),
      additionalBehaviors,
      domainNames: props.domainNames,
      certificate: props.certificate,
      comment: 'Serverless multi-project platform router',
    });

    new cdk.CfnOutput(this, 'DistributionDomain', {
      value: this.distribution.distributionDomainName,
      description: 'Public CloudFront domain for the platform',
    });

    // ── cell-namespace distribution (host-isolated user cells) ──
    // Additive and self-contained: a separate distribution for `*.on.parc.land`
    // that rewrites the per-cell host to `/@<owner>/<name>` (the CloudFront
    // Function above) and forwards to `dispatch`, reusing the OAC + body-signer.
    // The existing apex distribution is untouched. Cells served here are a
    // distinct origin — the security goal — so their *clients* must derive owner
    // from the host (a follow-up); SSR already uses the cell's CELL_OWNER env.
    if (props.cellHostRouter && props.cellDomainNames?.length && props.cellCertificate) {
      const cellOrigin = origins.FunctionUrlOrigin.withOriginAccessControl(props.cellHostRouter.functionUrl, {
        originAccessControl: oac,
      });
      const hostRewrite = new cloudfront.Function(this, 'CellHostRewrite', {
        code: cloudfront.FunctionCode.fromInline(CELL_HOST_REWRITE_SRC),
        runtime: cloudfront.FunctionRuntime.JS_2_0,
        comment: 'Rewrite <owner>-<name>.<domain> to /@<owner>/<name> for dispatch',
      });
      this.cellDistribution = new cloudfront.Distribution(this, 'CellDistribution', {
        defaultBehavior: {
          origin: cellOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [
            { function: hostRewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
          ],
          edgeLambdas: [
            { functionVersion: originSigner.currentVersion, eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST, includeBody: true },
            { functionVersion: wwwAuthFix.currentVersion, eventType: cloudfront.LambdaEdgeEventType.ORIGIN_RESPONSE },
          ],
        },
        domainNames: props.cellDomainNames,
        certificate: props.cellCertificate,
        comment: 'Cell-namespace router (host-isolated user cells)',
      });
      new cdk.CfnOutput(this, 'CellDistributionDomain', {
        value: this.cellDistribution.distributionDomainName,
        description: 'CloudFront domain for the cell namespace (point *.on.parc.land here)',
      });
    }
  }
}

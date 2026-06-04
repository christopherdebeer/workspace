import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import type * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { HttpServiceCell } from './http-service-cell';

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
}

/**
 * The single public ingress: one CloudFront distribution that path-routes to
 * each service cell's Function URL. The router stays intentionally "dumb" — it
 * does TLS, caching, and path routing, but holds no business logic. Its
 * behaviours are generated from service manifests, so adding a service needs no
 * router edits beyond passing the new cell in.
 */
export class ServiceRouter extends Construct {
  readonly distribution: cloudfront.Distribution;

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

    // Function URL origins must not receive the viewer Host header (SigV4 signs
    // the origin host), so forward everything except Host. Dynamic APIs are not
    // cached.
    const behaviorFor = (cell: HttpServiceCell): cloudfront.BehaviorOptions => ({
      origin: originByCell.get(cell)!,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
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
  }
}

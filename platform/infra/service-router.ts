import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { HttpServiceCell } from './http-service-cell';

export interface ServiceRouterProps {
  /** All cells to expose. Their manifest routes become CloudFront behaviours. */
  cells: HttpServiceCell[];
  /**
   * Cell that handles unmatched paths. Defaults to the first cell. In a fuller
   * deployment this would be a static-site/frontend origin.
   */
  defaultCell?: HttpServiceCell;
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

    const originFor = (cell: HttpServiceCell): origins.HttpOrigin =>
      new origins.HttpOrigin(cell.functionUrlDomain, {
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      });

    // Function URL origins must not receive the viewer Host header, so forward
    // everything except Host. Dynamic APIs are not cached.
    const behaviorFor = (cell: HttpServiceCell): cloudfront.BehaviorOptions => ({
      origin: originFor(cell),
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
      comment: 'Serverless multi-project platform router',
    });

    new cdk.CfnOutput(this, 'DistributionDomain', {
      value: this.distribution.distributionDomainName,
      description: 'Public CloudFront domain for the platform',
    });
  }
}

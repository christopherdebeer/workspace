import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { TableFactory } from './table-factory';
import { PlatformEventBus } from './event-bus';
import type { ServiceManifest } from '../manifest';

export interface CellPersistence {
  /** Provision a standard DynamoDB table owned by this cell. */
  dynamo?: boolean;
  /**
   * Mark the cell as using Turso/libSQL for relational data. The connection
   * string and auth token are expected via `environment` (typically sourced
   * from Secrets Manager at deploy time) — Turso is an external service, so the
   * platform does not provision it.
   */
  turso?: boolean;
}

export interface HttpServiceCellProps {
  /** Stable service name; must match the runtime `defineService({ name })`. */
  name: string;
  /** Absolute path to the service's runtime entry module (exports `handler`). */
  entry: string;
  /** CloudFront path patterns owned by the service, e.g. ["/documents/*"]. */
  routes: string[];
  /** Commands advertised in the manifest. */
  commands?: string[];
  /** Events advertised in the manifest. */
  emits?: string[];
  persistence?: CellPersistence;
  /** Shared event bus to grant publish access to. */
  eventBus?: PlatformEventBus;
  /** Service contract version. */
  version?: string;
  /** Extra environment variables (e.g. Turso connection settings). */
  environment?: Record<string, string>;
  /** Memory size in MB (default 256). */
  memorySize?: number;
  /** Timeout in seconds (default 15). */
  timeoutSeconds?: number;
  /**
   * Make the Function URL publicly invokable (`authType: NONE`) instead of the
   * default IAM auth. The default cell is reachable only via CloudFront, which
   * signs requests with SigV4 through Origin Access Control. Set this to true
   * only for local/dev or deliberately public endpoints.
   * @default false
   */
  publicFunctionUrl?: boolean;
}

/**
 * A self-contained Service Cell: Lambda + Function URL + IAM role + log group,
 * optional DynamoDB table, event-bus access, and a published manifest. All
 * infrastructure required to operate one service lives inside the cell, so a
 * new service is a sub-50-line construct instantiation.
 */
export class HttpServiceCell extends Construct {
  readonly serviceName: string;
  readonly fn: NodejsFunction;
  readonly functionUrl: lambda.FunctionUrl;
  readonly table?: dynamodb.Table;
  readonly manifest: ServiceManifest;

  /** name -> function name of peers this cell is allowed to invoke. */
  private readonly registry: Record<string, string> = {};

  constructor(scope: Construct, id: string, props: HttpServiceCellProps) {
    super(scope, id);
    this.serviceName = props.name;

    const environment: Record<string, string> = {
      SERVICE_NAME: props.name,
      ...props.environment,
    };

    if (props.eventBus) {
      environment.EVENT_BUS_NAME = props.eventBus.bus.eventBusName;
    }
    if (props.persistence?.turso) {
      environment.TURSO_ENABLED = 'true';
    }

    if (props.persistence?.dynamo) {
      this.table = TableFactory.standardTable(this, 'Table', { serviceName: props.name });
      environment.TABLE_NAME = this.table.tableName;
    }

    this.fn = new NodejsFunction(this, 'Function', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: props.entry,
      handler: 'handler',
      memorySize: props.memorySize ?? 256,
      timeout: cdk.Duration.seconds(props.timeoutSeconds ?? 15),
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment,
      bundling: {
        // Bundle the AWS SDK (v2) used by the runtime; it is not present in the
        // Node.js 20 Lambda image by default.
        externalModules: [],
      },
    });

    this.table?.grantReadWriteData(this.fn);
    props.eventBus?.grantPutEvents(this.fn);

    // By default the Function URL requires IAM auth: the only way in is through
    // CloudFront, which signs requests with SigV4 via Origin Access Control
    // (wired in ServiceRouter). This closes off direct public access to the
    // raw URL. `publicFunctionUrl` opts a cell back into unauthenticated access.
    this.functionUrl = this.fn.addFunctionUrl({
      authType: props.publicFunctionUrl
        ? lambda.FunctionUrlAuthType.NONE
        : lambda.FunctionUrlAuthType.AWS_IAM,
      // CORS only applies to direct browser calls; behind CloudFront the browser
      // talks to the distribution, not the URL. Harmless to keep for dev use.
      cors: props.publicFunctionUrl
        ? {
            allowedOrigins: ['*'],
            allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
            allowedHeaders: ['content-type', 'authorization', 'x-correlation-id'],
          }
        : undefined,
    });

    this.manifest = {
      name: props.name,
      version: props.version ?? '1.0.0',
      routes: props.routes,
      commands: props.commands ?? [],
      events: { emits: props.emits ?? [] },
    };

    new cdk.CfnOutput(this, 'Manifest', {
      value: JSON.stringify(this.manifest),
      description: `Service manifest for ${props.name}`,
    });
    new cdk.CfnOutput(this, 'Url', {
      value: this.functionUrl.url,
      description: `Function URL for ${props.name}`,
    });
  }

  /**
   * Allow this cell to synchronously invoke `target` (communication Mode 1).
   * Grants least-privilege `lambda:InvokeFunction` and adds the peer to this
   * cell's runtime service registry.
   */
  allow(target: HttpServiceCell): void {
    target.fn.grantInvoke(this.fn);
    this.registry[target.serviceName] = target.fn.functionName;
    this.fn.addEnvironment('SERVICE_REGISTRY', JSON.stringify(this.registry));
  }
}

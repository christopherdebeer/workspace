import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

/**
 * Standardised DynamoDB table for service cells.
 *
 * Every platform table uses the same single-table-friendly key schema
 * (`pk` partition + `sk` sort) and on-demand billing, so high-scale mutable
 * state, event sourcing, and job queues can share one shape. Services own
 * their own table; they never share one across the cell boundary.
 */
export interface PlatformTableProps {
  /** Logical service name, used for tagging/identification. */
  serviceName: string;
  /**
   * Retain data on stack deletion. Defaults to false (DESTROY) to match the
   * repository's existing non-production posture.
   */
  retain?: boolean;
  /** Enable DynamoDB Streams (e.g. for event sourcing fan-out). */
  stream?: boolean;
  /**
   * Enable TTL on the `ttl` attribute (epoch seconds). Items with a `ttl` in
   * the past are auto-deleted — used for challenges, auth codes, sessions, and
   * expiring tokens.
   */
  ttl?: boolean;
}

export class TableFactory {
  static standardTable(scope: Construct, id: string, props: PlatformTableProps): dynamodb.Table {
    const table = new dynamodb.Table(scope, id, {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: props.retain ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      stream: props.stream ? dynamodb.StreamViewType.NEW_AND_OLD_IMAGES : undefined,
      timeToLiveAttribute: props.ttl ? 'ttl' : undefined,
    });
    cdk.Tags.of(table).add('platform:service', props.serviceName);
    return table;
  }
}

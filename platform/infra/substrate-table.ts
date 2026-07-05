import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { HttpServiceCell } from './http-service-cell';

export interface SubstrateTableProps {
  /**
   * Retain the table (and its facts) on stack deletion. Defaults to false to
   * match the repository's non-production posture — flip for production, since
   * this table is the platform's shared truth.
   */
  retain?: boolean;
}

/**
 * The substrate table — the platform's shared observed-state store (the
 * "blackboard"). One table, scope-partitioned; authority is a *scope within*
 * the substrate, not a separate database. Stack-level infrastructure with the
 * same status as the event bus. See `docs/substrate-storage.md`.
 *
 * Key layout (the partition prefix IS the authority boundary — IAM
 * `dynamodb:LeadingKeys` conditions scope a principal to its prefixes):
 *
 *   facts        pk=`STATE#<scope>`        sk=`KEY#<key>`
 *   edges        pk=`STATE#<scope>`        sk=`EDGE#<from>#<rel>#<to>`
 *   trajectory   pk=`TRAJ#<scope>`         sk=`<iso>#<seq>`        (TTL'd)
 *   seq counter  pk=`SEQ#<scope>`          sk=`A`
 *   grants       pk=`GRANT#<grantee>` / `GRANTBY#<owner>`           (sharing)
 *
 * Global secondary indexes (provisioned now; the key conventions below are the
 * contract for the link/query primitives that land on them):
 *
 *   gsi-in    gsi1pk=`IN#<scope>#<to>`     gsi1sk=`<rel>#<from>`   inbound edges
 *   gsi-type  gsi2pk=`TYPE#<scope>#<type>` gsi2sk=`<updatedAt>`    typed/recency reads
 *
 * Every GSI partition key repeats the scope so LeadingKeys conditions cover
 * index reads too. Streams are enabled as the change-feed substrate.
 */
export class SubstrateTable extends Construct {
  readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string, props?: SubstrateTableProps) {
    super(scope, id);

    this.table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: props?.retain ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      // Continuous backups (restore to any second in the last 35 days) — the
      // DR half of the durability story the analytics lane complements. The
      // lane gives a permanent, queryable archive; PITR gives one-click restore.
      pointInTimeRecovery: true,
    });
    cdk.Tags.of(this.table).add('platform:service', 'substrate');

    this.table.addGlobalSecondaryIndex({
      indexName: 'gsi-in',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    this.table.addGlobalSecondaryIndex({
      indexName: 'gsi-type',
      partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
  }

  /**
   * Grant a tier-1 cell full read/write on the substrate and inject
   * `SUBSTRATE_TABLE` (surfaced as `ctx.config.substrateTableName`). Tier-1
   * cells are reviewed code, so they get unconditioned access; dynamic cells
   * get LeadingKeys-scoped read via the permission boundary + cell template.
   */
  grantReadWrite(cell: HttpServiceCell): void {
    this.table.grantReadWriteData(cell.fn);
    cell.fn.addEnvironment('SUBSTRATE_TABLE', this.table.tableName);
  }
}

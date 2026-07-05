import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import type * as lambda from 'aws-cdk-lib/aws-lambda';

export interface SubstrateAnalyticsLaneProps {
  /** Deployment environment label, namespaces the Glue DB / Athena workgroup / buckets. */
  envName: string;
  /** Account id (for globally-unique bucket names). */
  account: string;
  /** Region (for the Firehose stream ARN grant). */
  region: string;
}

/**
 * The substrate analytics + archive lane — the ad-hoc / analytical read surface
 * DynamoDB's access model can't serve, plus a permanent (TTL-free) archive of
 * the trajectory. A second consumer on the SubstrateTable stream (the
 * `substrate-archiver` Lambda) flattens each fact change and forwards it here;
 * Firehose buffers and lands newline-delimited JSON (gzip, date-partitioned) in
 * the lake bucket, which a Glue table catalogs (partition projection — no
 * crawler) so Athena can query the whole substrate with SQL.
 *
 * The lake bucket is RETAINED: it is the durable at-rest record. See
 * `docs/substrate-analytics.md`.
 */
export class SubstrateAnalyticsLane extends Construct {
  /** The durable data lake (RETAINED) — `s3://<lake>/facts/dt=YYYY-MM-DD/…`. */
  readonly lakeBucket: s3.Bucket;
  /** Athena query-results bucket (ephemeral, lifecycle-expired). */
  readonly resultsBucket: s3.Bucket;
  /** Firehose delivery stream name — injected into the archiver as `FIREHOSE_STREAM`. */
  readonly deliveryStreamName: string;
  /** Firehose delivery stream ARN — the target of the archiver's PutRecordBatch grant. */
  readonly deliveryStreamArn: string;
  /** Glue database + `facts` table (catalog for Athena). */
  readonly database: glue.CfnDatabase;
  /** Athena workgroup pinned to the results bucket. */
  readonly workgroup: athena.CfnWorkGroup;

  constructor(scope: Construct, id: string, props: SubstrateAnalyticsLaneProps) {
    super(scope, id);
    const { envName, account } = props;

    // ---- Buckets ----------------------------------------------------------
    // The lake is truth-at-rest: retain it across stack deletion (like the EC2
    // data volume + the production substrate table).
    this.lakeBucket = new s3.Bucket(this, 'Lake', {
      bucketName: `parc-substrate-lake-${envName}-${account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Query results are disposable — expire them so they don't accrete cost.
    this.resultsBucket = new s3.Bucket(this, 'Results', {
      bucketName: `parc-substrate-athena-${envName}-${account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: cdk.Duration.days(14) }],
    });

    // ---- Firehose delivery stream ----------------------------------------
    const logGroup = new logs.LogGroup(this, 'FirehoseLogs', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const logStream = new logs.LogStream(this, 'FirehoseLogStream', {
      logGroup,
      logStreamName: 'S3Delivery',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
    });
    this.lakeBucket.grantReadWrite(firehoseRole);
    firehoseRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:PutLogEvents'],
      resources: [logGroup.logGroupArn],
    }));

    const deliveryStreamName = `substrate-facts-${envName}`;
    const stream = new firehose.CfnDeliveryStream(this, 'Stream', {
      deliveryStreamName,
      deliveryStreamType: 'DirectPut',
      extendedS3DestinationConfiguration: {
        bucketArn: this.lakeBucket.bucketArn,
        roleArn: firehoseRole.roleArn,
        // Hive-style partition folder Athena's partition projection resolves.
        prefix: 'facts/dt=!{timestamp:yyyy-MM-dd}/',
        errorOutputPrefix: 'errors/!{firehose:error-output-type}/dt=!{timestamp:yyyy-MM-dd}/',
        // At personal-workspace volume the 60s interval wins → near-live in S3.
        bufferingHints: { intervalInSeconds: 60, sizeInMBs: 64 },
        compressionFormat: 'GZIP',
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: logGroup.logGroupName,
          logStreamName: logStream.logStreamName,
        },
      },
    });
    stream.node.addDependency(firehoseRole);
    this.deliveryStreamName = deliveryStreamName;
    this.deliveryStreamArn = cdk.Stack.of(this).formatArn({
      service: 'firehose',
      resource: 'deliverystream',
      resourceName: deliveryStreamName,
    });

    // ---- Glue catalog (partition projection — no crawler) -----------------
    this.database = new glue.CfnDatabase(this, 'Database', {
      catalogId: account,
      databaseInput: { name: `substrate_${envName}` },
    });

    // Flattened fact envelope. `value_json` keeps the arbitrary fact body as a
    // JSON string reachable via Athena's json_extract; everything queryable is a
    // real column. `dt` is the (projected) partition key, not a stored column.
    const columns: glue.CfnTable.ColumnProperty[] = [
      { name: 'scope', type: 'string' },
      { name: 'key', type: 'string' },
      { name: 'type', type: 'string' },
      { name: 'tags', type: 'array<string>' },
      { name: 'revision', type: 'bigint' },
      { name: 'seq', type: 'bigint' },
      { name: 'first_seq', type: 'bigint' },
      { name: 'writer', type: 'string' },
      { name: 'via', type: 'string' },
      { name: 'superseded', type: 'boolean' },
      { name: 'superseded_by', type: 'string' },
      { name: 'created_at', type: 'string' },
      { name: 'updated_at', type: 'string' },
      { name: 'timer_expires_at', type: 'string' },
      { name: 'timer_effect', type: 'string' },
      { name: 'event_name', type: 'string' },
      { name: 'value_json', type: 'string' },
      { name: 'archived_at', type: 'string' },
    ];

    const table = new glue.CfnTable(this, 'FactsTable', {
      catalogId: account,
      databaseName: `substrate_${envName}`,
      tableInput: {
        name: 'facts',
        tableType: 'EXTERNAL_TABLE',
        partitionKeys: [{ name: 'dt', type: 'string' }],
        parameters: {
          classification: 'json',
          // Partition projection: Athena computes partitions from the query,
          // so no crawler / MSCK REPAIR is ever needed.
          'projection.enabled': 'true',
          'projection.dt.type': 'date',
          'projection.dt.range': '2024-01-01,NOW',
          'projection.dt.format': 'yyyy-MM-dd',
          'projection.dt.interval': '1',
          'projection.dt.interval.unit': 'DAYS',
          'storage.location.template':
            `s3://${this.lakeBucket.bucketName}/facts/dt=\${dt}/`,
        },
        storageDescriptor: {
          location: `s3://${this.lakeBucket.bucketName}/facts/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
            parameters: { 'ignore.malformed.json': 'true' },
          },
          columns,
        },
      },
    });
    table.addDependency(this.database);

    // ---- Athena workgroup -------------------------------------------------
    this.workgroup = new athena.CfnWorkGroup(this, 'Workgroup', {
      name: `substrate-${envName}`,
      recursiveDeleteOption: true,
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: false,
        resultConfiguration: {
          outputLocation: `s3://${this.resultsBucket.bucketName}/results/`,
        },
      },
    });

    new cdk.CfnOutput(this, 'LakeBucketName', { value: this.lakeBucket.bucketName });
    new cdk.CfnOutput(this, 'GlueDatabase', { value: `substrate_${envName}` });
    new cdk.CfnOutput(this, 'AthenaWorkgroup', { value: `substrate-${envName}` });
  }

  /**
   * Grant a stream-consumer Lambda permission to forward records, and inject the
   * stream name as `FIREHOSE_STREAM` (the archiver no-ops when it is unset).
   */
  grantPutRecords(fn: lambda.Function): void {
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['firehose:PutRecord', 'firehose:PutRecordBatch'],
      resources: [this.deliveryStreamArn],
    }));
    fn.addEnvironment('FIREHOSE_STREAM', this.deliveryStreamName);
  }
}

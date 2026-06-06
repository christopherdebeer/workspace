import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { HttpServiceCell } from './http-service-cell';
import { PlatformEventBus } from './event-bus';

export interface DynamicCellControlPlaneProps {
  /** Shared event bus dynamic cells may publish to. */
  eventBus: PlatformEventBus;
}

/**
 * Tier-1 substrate for runtime-provisioned dynamic cells (see
 * `docs/dynamic-cells.md`). Provides the two shared pieces the control plane
 * (`forge`) needs — an S3 bucket for cell code and the IAM **permission
 * boundary** every cell role must carry — and grants `forge` the tightly-scoped
 * permission to provision `cell-*` stacks, and nothing else.
 *
 * The safety argument: only `forge` can provision; it can only create roles that
 * carry this boundary (`iam:CreateRole` is conditioned on it); and the boundary
 * caps every cell to its own `cell-*` table, logs, and the bus — so even
 * arbitrary cell code cannot exceed it.
 */
export class DynamicCellControlPlane extends Construct {
  readonly codeBucket: s3.Bucket;
  readonly permissionBoundary: iam.ManagedPolicy;
  private readonly eventBus: PlatformEventBus;

  constructor(scope: Construct, id: string, props: DynamicCellControlPlaneProps) {
    super(scope, id);
    this.eventBus = props.eventBus;

    const stack = cdk.Stack.of(this);
    const fnArn = `arn:aws:lambda:${stack.region}:${stack.account}:function:cell-*`;
    const tableArn = `arn:aws:dynamodb:${stack.region}:${stack.account}:table/cell-*`;
    const logArn = `arn:aws:logs:${stack.region}:${stack.account}:log-group:/aws/lambda/cell-*`;

    this.codeBucket = new s3.Bucket(this, 'CodeBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // The cap on every dynamic cell role: it can only ever touch its own
    // `cell-*` table, its own logs, the shared bus, and `cell-*` peers.
    this.permissionBoundary = new iam.ManagedPolicy(this, 'CellBoundary', {
      description: 'Permission boundary capping every dynamic cell to the cell-* namespace',
      statements: [
        new iam.PolicyStatement({
          sid: 'OwnLogs',
          actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [logArn, `${logArn}:*`],
        }),
        new iam.PolicyStatement({
          sid: 'CellTables',
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Query',
            'dynamodb:Scan',
            'dynamodb:BatchGetItem',
            'dynamodb:BatchWriteItem',
          ],
          resources: [tableArn, `${tableArn}/index/*`],
        }),
        new iam.PolicyStatement({
          sid: 'PublishEvents',
          actions: ['events:PutEvents'],
          resources: [this.eventBus.bus.eventBusArn],
        }),
        new iam.PolicyStatement({
          sid: 'InvokeCellPeers',
          actions: ['lambda:InvokeFunction'],
          resources: [fnArn],
        }),
      ],
    });
  }

  /**
   * Grant `forge` the scoped permission to provision dynamic cells, and inject
   * the env it needs. This is the only principal in the platform that can create
   * `cell-*` infrastructure.
   */
  grantControlPlane(forge: HttpServiceCell): void {
    const stack = cdk.Stack.of(this);
    const fn = forge.fn;
    const account = stack.account;
    const region = stack.region;

    const stackArn = `arn:aws:cloudformation:${region}:${account}:stack/cell-*/*`;
    const roleArn = `arn:aws:iam::${account}:role/cell-*`;
    const fnArn = `arn:aws:lambda:${region}:${account}:function:cell-*`;
    const tableArn = `arn:aws:dynamodb:${region}:${account}:table/cell-*`;

    this.codeBucket.grantReadWrite(fn);

    // CloudFormation manages the per-cell stack lifecycle.
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cloudformation:CreateStack',
          'cloudformation:UpdateStack',
          'cloudformation:DeleteStack',
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:GetTemplate',
        ],
        resources: [stackArn],
      }),
    );

    // The crux: forge may only create cell roles that carry the boundary.
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'CreateBoundedRole',
        actions: ['iam:CreateRole'],
        resources: [roleArn],
        conditions: {
          StringEquals: { 'iam:PermissionsBoundary': this.permissionBoundary.managedPolicyArn },
        },
      }),
    );
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ManageCellRoles',
        actions: [
          'iam:DeleteRole',
          'iam:GetRole',
          'iam:GetRolePolicy',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:TagRole',
          'iam:UntagRole',
        ],
        resources: [roleArn],
      }),
    );
    // CloudFormation passes the cell role to Lambda when creating the function.
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'PassCellRole',
        actions: ['iam:PassRole'],
        resources: [roleArn],
        conditions: { StringEquals: { 'iam:PassedToService': 'lambda.amazonaws.com' } },
      }),
    );

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ManageCellFunctions',
        actions: [
          'lambda:CreateFunction',
          'lambda:DeleteFunction',
          'lambda:GetFunction',
          'lambda:UpdateFunctionCode',
          'lambda:UpdateFunctionConfiguration',
          'lambda:InvokeFunction',
          'lambda:TagResource',
          'lambda:ListTags',
        ],
        resources: [fnArn],
      }),
    );

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'ManageCellTables',
        actions: [
          'dynamodb:CreateTable',
          'dynamodb:DeleteTable',
          'dynamodb:DescribeTable',
          'dynamodb:UpdateTable',
          'dynamodb:TagResource',
        ],
        resources: [tableArn],
      }),
    );

    forge.fn.addEnvironment('CELL_CODE_BUCKET', this.codeBucket.bucketName);
    forge.fn.addEnvironment('CELL_PERMISSION_BOUNDARY_ARN', this.permissionBoundary.managedPolicyArn);
    forge.fn.addEnvironment('CELL_EVENT_BUS_NAME', this.eventBus.bus.eventBusName);
    forge.fn.addEnvironment('CELL_EVENT_BUS_ARN', this.eventBus.bus.eventBusArn);
    forge.fn.addEnvironment('CELL_ACCOUNT_ID', account);
    forge.fn.addEnvironment('CELL_REGION', region);
  }
}

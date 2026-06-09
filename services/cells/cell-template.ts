/**
 * The cell template — authored once, deployed at runtime.
 *
 * A dynamic (tier-2) cell is a real AWS Lambda + DynamoDB table + scoped IAM
 * role, the same resource shape a tier-1 `HttpServiceCell` produces. The control
 * plane (`forge`) builds this CloudFormation template per cell and deploys it as
 * an isolated stack via `CreateStack`. Isolation comes from the Lambda/account
 * boundary and the role's **permission boundary**, not from an in-process
 * sandbox — see `docs/dynamic-cells.md`.
 *
 * Stable, predictable resource names (`cell-<cellId>`) let the permission
 * boundary and the role policy scope to this one cell's table, logs, and
 * function by ARN.
 */

export interface CellTemplateParams {
  /** Sanitised, unique cell identifier. */
  cellId: string;
  /** Owning principal (the user who minted the cell). */
  owner: string;
  /** S3 bucket holding the cell's code zip. */
  codeBucket: string;
  /** S3 key of the cell's code zip. */
  codeKey: string;
  /** ARN of the managed permission boundary every cell role must carry. */
  boundaryArn: string;
  /** Shared event bus the cell may publish to. */
  eventBusName: string;
  eventBusArn: string;
  region: string;
  accountId: string;
  memorySize?: number;
  timeoutSeconds?: number;
  /**
   * The shared substrate table (the platform's observed-state store). When
   * present, the cell role gets *read* access scoped — via a
   * `dynamodb:LeadingKeys` condition — to the owner's partitions, so an organ
   * can observe the reef but only its own slice. Writes stay mediated.
   */
  substrateTable?: { name: string; arn: string };
}

/** Deployment resource name for a cell: stable, predictable, ARN-scopable. */
export function cellResourceName(cellId: string): string {
  return `cell-${cellId}`;
}

/** CloudFormation stack name for a cell. */
export function cellStackName(cellId: string): string {
  return `cell-${cellId}`;
}

/**
 * Build the per-cell CloudFormation template. Values are inlined per cell rather
 * than passed as CFN `Parameters` — `forge` generates one template per cell, so
 * the single authoring site here is what "authored once" means in practice.
 */
export function buildCellTemplate(p: CellTemplateParams): Record<string, unknown> {
  const name = cellResourceName(p.cellId);
  const tableArn = `arn:aws:dynamodb:${p.region}:${p.accountId}:table/${name}`;
  const logArn = `arn:aws:logs:${p.region}:${p.accountId}:log-group:/aws/lambda/${name}:*`;

  // Read-only observation of the owner's slice of the shared substrate. The
  // LeadingKeys condition scopes every table *and* index read to partitions
  // whose leading key carries the owner's scope (the GSI pks repeat the scope
  // for exactly this reason — see platform/infra/substrate-table.ts). This is
  // Σ-calculus scope authority enforced by IAM rather than an interpreter.
  const substrateStatements = p.substrateTable
    ? [
        {
          Sid: 'SubstrateOwnScopeRead',
          Effect: 'Allow',
          Action: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:BatchGetItem'],
          Resource: [p.substrateTable.arn, `${p.substrateTable.arn}/index/*`],
          Condition: {
            'ForAllValues:StringLike': {
              'dynamodb:LeadingKeys': [
                `STATE#${p.owner}`,
                `TRAJ#${p.owner}`,
                `SEQ#${p.owner}`,
                `IN#${p.owner}#*`,
                `TYPE#${p.owner}#*`,
              ],
            },
          },
        },
      ]
    : [];

  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: `Dynamic cell ${p.cellId} (owner ${p.owner})`,
    Resources: {
      CellTable: {
        Type: 'AWS::DynamoDB::Table',
        Properties: {
          TableName: name,
          BillingMode: 'PAY_PER_REQUEST',
          AttributeDefinitions: [
            { AttributeName: 'pk', AttributeType: 'S' },
            { AttributeName: 'sk', AttributeType: 'S' },
          ],
          KeySchema: [
            { AttributeName: 'pk', KeyType: 'HASH' },
            { AttributeName: 'sk', KeyType: 'RANGE' },
          ],
          Tags: [
            { Key: 'platform:cell', Value: p.cellId },
            { Key: 'platform:owner', Value: p.owner },
          ],
        },
      },
      CellRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          RoleName: name,
          // The cap: this role can never exceed the boundary, no matter what the
          // inline policy (or any future change) grants.
          PermissionsBoundary: p.boundaryArn,
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Principal: { Service: 'lambda.amazonaws.com' },
                Action: 'sts:AssumeRole',
              },
            ],
          },
          Policies: [
            {
              PolicyName: 'cell-scoped',
              PolicyDocument: {
                Version: '2012-10-17',
                Statement: [
                  {
                    Sid: 'OwnLogs',
                    Effect: 'Allow',
                    Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                    Resource: logArn,
                  },
                  {
                    Sid: 'OwnTable',
                    Effect: 'Allow',
                    Action: [
                      'dynamodb:GetItem',
                      'dynamodb:PutItem',
                      'dynamodb:UpdateItem',
                      'dynamodb:DeleteItem',
                      'dynamodb:Query',
                      'dynamodb:Scan',
                      'dynamodb:BatchGetItem',
                      'dynamodb:BatchWriteItem',
                    ],
                    Resource: [tableArn, `${tableArn}/index/*`],
                  },
                  {
                    Sid: 'PublishEvents',
                    Effect: 'Allow',
                    Action: ['events:PutEvents'],
                    Resource: p.eventBusArn,
                  },
                  ...substrateStatements,
                ],
              },
            },
          ],
          Tags: [
            { Key: 'platform:cell', Value: p.cellId },
            { Key: 'platform:owner', Value: p.owner },
          ],
        },
      },
      CellFunction: {
        Type: 'AWS::Lambda::Function',
        DependsOn: 'CellRole',
        Properties: {
          FunctionName: name,
          Runtime: 'nodejs20.x',
          Handler: 'index.handler',
          Role: { 'Fn::GetAtt': ['CellRole', 'Arn'] },
          Code: { S3Bucket: p.codeBucket, S3Key: p.codeKey },
          MemorySize: p.memorySize ?? 128,
          Timeout: p.timeoutSeconds ?? 10,
          Environment: {
            Variables: {
              CELL_ID: p.cellId,
              CELL_OWNER: p.owner,
              SERVICE_NAME: name,
              TABLE_NAME: name,
              EVENT_BUS_NAME: p.eventBusName,
              ...(p.substrateTable ? { SUBSTRATE_TABLE: p.substrateTable.name } : {}),
            },
          },
          Tags: [
            { Key: 'platform:cell', Value: p.cellId },
            { Key: 'platform:owner', Value: p.owner },
          ],
        },
      },
    },
    Outputs: {
      FunctionName: { Value: { Ref: 'CellFunction' } },
      FunctionArn: { Value: { 'Fn::GetAtt': ['CellFunction', 'Arn'] } },
      TableName: { Value: { Ref: 'CellTable' } },
    },
  };
}

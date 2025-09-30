import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'path';

export class InlineLambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Auth table for WebAuthn credentials and tokens
    // Keep same construct ID 'Table' for backward compatibility
    const authTable = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT for production
    });

    // User KV store table - separate from auth data for security
    // This table is exposed via MCP with per-user namespacing
    const kvTable = new dynamodb.Table(this, 'KVStoreTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT for production
    });

    // Add Lambda function from WorkspaceStack
    const fn = new NodejsFunction(this, 'WorkspaceFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      // When executing the stack from the compiled JavaScript in "dist/lib",
      // "__dirname" resolves to "dist/lib". Ascend two directories to reach
      // the repository root so the Lambda source can be located correctly.
      entry: path.join(__dirname, '..', '..', 'lambda', 'index.ts'),
      handler: 'handler',
      environment: {
        TABLE_NAME: authTable.tableName,
        KV_TABLE_NAME: kvTable.tableName,
      },
      bundling: {
        // Remove aws-sdk from external modules to bundle it for Node.js 20
        // externalModules: ['aws-sdk'],
      },
    });

    // Grant Lambda permissions to read/write both tables
    authTable.grantReadWriteData(fn);
    kvTable.grantReadWriteData(fn);

    // Add Function URL for HTTP access
    const fnUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // Output Function URL for frontend configuration
    new cdk.CfnOutput(this, 'FunctionUrl', {
      value: fnUrl.url,
    });
  }
}

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'path';

export class WorkspaceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'WorkspaceTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT for production!
    });


    const fn = new NodejsFunction(this, 'WorkspaceFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      // When executing the stack from the compiled JavaScript in "dist/lib",
      // "__dirname" resolves to "dist/lib". Ascend two directories to reach
      // the repository root so the Lambda source can be located correctly.
      entry: path.join(__dirname, '..', '..', 'lambda', 'index.ts'),
      handler: 'handler',
      environment: {
        TABLE_NAME: table.tableName,
      },
      bundling: {
        externalModules: ['aws-sdk'],
      },
    });

    table.grantReadWriteData(fn);

    const fnUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    // Extract domain from Function URL for WebAuthn RPID
    const urlParts = cdk.Fn.split('/', fnUrl.url);
    const protocol = cdk.Fn.select(0, urlParts); // https:
    const domain = cdk.Fn.select(2, urlParts); // xyz.lambda-url.region.on.aws
    
    // Update Lambda environment with WebAuthn configuration
    fn.addEnvironment('RP_ID', domain);
    fn.addEnvironment('ORIGIN', cdk.Fn.sub('${protocol}//${domain}', {
      protocol: protocol,
      domain: domain
    }));

    new cdk.CfnOutput(this, 'FunctionUrl', {
      value: fnUrl.url,
    });
  }
}

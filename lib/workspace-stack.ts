import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

export class WorkspaceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'WorkspaceTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT for production!
    });

    new s3.Bucket(this, 'WorkspaceBucket', {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const fn = new lambda.Function(this, 'WorkspaceFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
        const AWS = require('aws-sdk');
        const db = new AWS.DynamoDB.DocumentClient();
        exports.handler = async (event) => {
          console.log("Request:", event);
          return {
            statusCode: 200,
            body: JSON.stringify({ event })
          };
          const TableName = process.env.TABLE_NAME;
          const result = await db.put({
            TableName,
            Item: {
              id: new Date().toISOString(),
              message: "Hello from Lambda"
            }
          }).promise();
          return {
            statusCode: 200,
            body: JSON.stringify({ success: true })
          };
        };
      `),
      environment: {
        TABLE_NAME: table.tableName,
      }
    });

    table.grantReadWriteData(fn);

    const fnUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new cdk.CfnOutput(this, 'FunctionUrl', {
      value: fnUrl.url,
    });
  }
}

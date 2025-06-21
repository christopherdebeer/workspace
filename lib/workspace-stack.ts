import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

export class WorkspaceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'WorkspaceTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT for production!
    });

    const websiteBucket = new s3.Bucket(this, 'WorkspaceBucket', {
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'index.html',
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: false,
        blockPublicPolicy: false,
        ignorePublicAcls: false,
        restrictPublicBuckets: false,
      }),
      publicReadAccess: true,
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


    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [
        // When the stack is executed from the compiled JavaScript in the "dist"
        // directory, "__dirname" resolves to "dist/lib". The original path
        // used ".." which results in "dist/frontend". The frontend assets live
        // in the repository root under "frontend", so we need to go two levels
        // up from the compiled directory to reach the correct location.
        s3deploy.Source.asset(path.join(__dirname, '..', '..', 'frontend'), {
          bundling: {
            image: cdk.DockerImage.fromRegistry('node:18'),
            local: {
              tryBundle(outputDir: string) {
                try {
                  execSync('npm ci', {
                    cwd: path.join(__dirname, '..', '..', 'frontend'),
                    stdio: 'inherit',
                  });
                  execSync('npm run build', {
                    cwd: path.join(__dirname, '..', '..', 'frontend'),
                    stdio: 'inherit',
                  });
                  fs.cpSync(
                    path.join(__dirname, '..', '..', 'frontend', 'dist'),
                    outputDir,
                    { recursive: true }
                  );
                  return true;
                } catch {
                  return false;
                }
              },
            },
            command: [
              'bash',
              '-c',
              [
                'npm ci',
                'npm run build',
                'cp -r dist/* /asset-output/'
              ].join(' && ')
            ],
            environment: {
              HOME: '/tmp',
              npm_config_cache: '/tmp/.npm',
            },
          },
        }),
      ],
      destinationBucket: websiteBucket,
      destinationKeyPrefix: 'webapp',
    });

    const fnUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new cdk.CfnOutput(this, 'FunctionUrl', {
      value: fnUrl.url,
    });

    new cdk.CfnOutput(this, 'WebsiteUrl', {
      value: websiteBucket.bucketWebsiteUrl,
      exportName: 'WorkspaceWebsiteUrl',
    });

    new cdk.CfnOutput(this, 'WebsiteBucketName', {
      value: websiteBucket.bucketName,
    });
  }
}

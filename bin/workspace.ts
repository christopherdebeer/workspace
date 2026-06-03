#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InlineLambdaStack } from '../lib/inline-lambda-stack';
import { WorkspaceEc2Stack } from '../lib/workspace-ec2-stack';
import { PlatformStack } from '../lib/platform-stack';

const app = new cdk.App();
new InlineLambdaStack(app, 'InlineLambdaStack');
new PlatformStack(app, 'PlatformStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'eu-west-2',
  },
});
new WorkspaceEc2Stack(app, 'WorkspaceEc2Stack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-west-2',
  },
});

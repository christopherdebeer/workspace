#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InlineLambdaStack } from '../lib/inline-lambda-stack';
import { WorkspaceEc2Stack } from '../lib/workspace-ec2-stack';

const app = new cdk.App();
new InlineLambdaStack(app, 'InlineLambdaStack');
new WorkspaceEc2Stack(app, 'WorkspaceEc2Stack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'eu-west-2',
  },
});

#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { WorkspaceEc2Stack } from '../lib/workspace-ec2-stack';
import { PlatformStack } from '../lib/platform-stack';

const app = new cdk.App();

// Deployment environment for the platform. `production` keeps the canonical
// stack/resource names; any other value (e.g. `staging`) gets a namespaced,
// independently-deployable copy. Select with `-c env=staging` or PLATFORM_ENV.
const platformEnv = (app.node.tryGetContext('env') as string | undefined) ?? process.env.PLATFORM_ENV ?? 'production';
const platformStackId = platformEnv === 'production' ? 'PlatformStack' : `PlatformStack-${platformEnv}`;
new PlatformStack(app, platformStackId, {
  envName: platformEnv,
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

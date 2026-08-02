#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InlineLambdaStack } from '../lib/inline-lambda-stack';
import { PlatformStack } from '../lib/platform-stack';

const app = new cdk.App();

// Emptied legacy stack, kept in the app so `cdk deploy --all` tears down its
// (now-removed) resources via CloudFormation. Remove in a later cleanup pass.
new InlineLambdaStack(app, 'InlineLambdaStack');

// Deployment environment for the platform. `production` keeps the canonical
// stack/resource names; any other value (e.g. `staging`) gets a namespaced,
// independently-deployable copy. Select with `-c env=staging` or PLATFORM_ENV.
const platformEnv = (app.node.tryGetContext('env') as string | undefined) ?? process.env.PLATFORM_ENV ?? 'production';
const platformStackId = platformEnv === 'production' ? 'PlatformStack' : `PlatformStack-${platformEnv}`;

const ctx = (k: string): string | undefined => (app.node.tryGetContext(k) as string | undefined) || undefined;
const domains = ctx('domains') ?? process.env.PLATFORM_DOMAINS;

new PlatformStack(app, platformStackId, {
  envName: platformEnv,
  publicBaseUrl: ctx('publicBaseUrl') ?? process.env.PLATFORM_PUBLIC_BASE_URL,
  domainNames: domains ? domains.split(',').map((d) => d.trim()).filter(Boolean) : undefined,
  certificateArn: ctx('certArn') ?? process.env.PLATFORM_CERT_ARN,
  cellDomain: ctx('cellDomain') ?? process.env.PLATFORM_CELL_DOMAIN,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    // Platform (and its CloudFront/ACM) live in us-east-1; pin it so a differing
    // CDK_DEFAULT_REGION can't create a duplicate stack in another region.
    region: 'us-east-1',
  },
});
// (Retired 2026-08-01: WorkspaceEc2Stack — the eu-west-2 Tailscale dev box.
// Unused, and its idle EBS was ~$13/mo (July cost review). The deploy
// workflow's one-time "Retire the workspace EC2 stack" step snapshots the
// data volume, deletes the CloudFormation stack, and removes the RETAINed
// volume; the step is idempotent and a no-op once the stack is gone.)

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * InlineLambdaStack — intentionally emptied (teardown in progress).
 *
 * This stack previously hosted the legacy MCP + WebAuthn/OAuth Lambda and its
 * two DynamoDB tables (auth + KV), now superseded by the platform service cells
 * (the `auth` cell handles passkeys/OAuth). It is kept in the app with **no
 * resources** as step one of a two-step teardown: deploying this empty stack
 * lets CloudFormation delete the old resources in a controlled, pipeline-driven
 * way rather than orphaning the stack. The tables used RemovalPolicy.DESTROY, so
 * their data is removed on this deploy — expected.
 *
 * Step two (later, once the resources are confirmed gone): delete this class,
 * drop it from bin/workspace.ts, and run `cdk destroy InlineLambdaStack`.
 */
export class InlineLambdaStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
  }
}

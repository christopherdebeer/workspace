/**
 * The provisioner — the runtime half of "CDK, but deployed at runtime".
 *
 * Wraps the AWS calls `forge` makes to bring a dynamic cell to life: upload the
 * code zip to S3, deploy the per-cell CloudFormation stack, query its status,
 * invoke the cell's Lambda, and tear it down. Clients are created lazily and are
 * injectable so the control-plane logic is unit-testable without AWS.
 */
import type { CloudFormation, S3, Lambda } from 'aws-sdk';
import { zipStore } from './zip';

let cfnClient: CloudFormation | undefined;
let s3Client: S3 | undefined;
let lambdaClient: Lambda | undefined;

export function __setCloudFormation(stub: CloudFormation | undefined): void {
  cfnClient = stub;
}
export function __setS3(stub: S3 | undefined): void {
  s3Client = stub;
}
export function __setLambda(stub: Lambda | undefined): void {
  lambdaClient = stub;
}

function aws(): typeof import('aws-sdk') {
  return require('aws-sdk') as typeof import('aws-sdk');
}
function cfn(): CloudFormation {
  if (!cfnClient) cfnClient = new (aws().CloudFormation)();
  return cfnClient;
}
function s3(): S3 {
  if (!s3Client) s3Client = new (aws().S3)();
  return s3Client;
}
function lambda(): Lambda {
  if (!lambdaClient) lambdaClient = new (aws().Lambda)();
  return lambdaClient;
}

export interface UploadCodeParams {
  bucket: string;
  key: string;
  /** The cell's `index.js` source. */
  code: string;
}

/** Package the cell's source into a zip and upload it to S3. */
export async function uploadCode(p: UploadCodeParams): Promise<void> {
  const body = zipStore([{ name: 'index.js', content: p.code }]);
  await s3()
    .putObject({ Bucket: p.bucket, Key: p.key, Body: body, ContentType: 'application/zip' })
    .promise();
}

/** Create the per-cell CloudFormation stack from a template. */
export async function deployStack(stackName: string, template: Record<string, unknown>): Promise<void> {
  await cfn()
    .createStack({
      StackName: stackName,
      TemplateBody: JSON.stringify(template),
      // The template names the cell's IAM role, so CFN requires this capability.
      Capabilities: ['CAPABILITY_NAMED_IAM'],
      Tags: [{ Key: 'platform:managed-by', Value: 'forge' }],
      OnFailure: 'DELETE',
    })
    .promise();
}

export interface StackState {
  status: string;
  outputs: Record<string, string>;
}

/** Describe a cell stack: its status and outputs (empty if it doesn't exist). */
export async function describeStack(stackName: string): Promise<StackState | null> {
  try {
    const res = await cfn().describeStacks({ StackName: stackName }).promise();
    const stack = res.Stacks?.[0];
    if (!stack) return null;
    const outputs: Record<string, string> = {};
    for (const o of stack.Outputs ?? []) {
      if (o.OutputKey && o.OutputValue) outputs[o.OutputKey] = o.OutputValue;
    }
    return { status: stack.StackStatus ?? 'UNKNOWN', outputs };
  } catch (err) {
    if ((err as { code?: string }).code === 'ValidationError') return null; // no such stack
    throw err;
  }
}

export async function deleteStack(stackName: string): Promise<void> {
  await cfn().deleteStack({ StackName: stackName }).promise();
}

export interface InvokeCellParams {
  functionName: string;
  /** A Lambda Function URL (payload v2) event. */
  event: unknown;
}

export interface InvokeCellResult {
  statusCode: number;
  /** Parsed JSON body when possible, else the raw string. */
  body: unknown;
}

/** Synchronously invoke a cell's Lambda with a Function-URL-shaped event. */
export async function invokeCell(p: InvokeCellParams): Promise<InvokeCellResult> {
  const res = await lambda()
    .invoke({
      FunctionName: p.functionName,
      InvocationType: 'RequestResponse',
      Payload: JSON.stringify(p.event),
    })
    .promise();

  if (res.FunctionError) {
    const raw = typeof res.Payload === 'string' ? res.Payload : res.Payload?.toString();
    throw new Error(`Cell invocation failed: ${raw ?? res.FunctionError}`);
  }

  const raw = typeof res.Payload === 'string' ? res.Payload : res.Payload?.toString();
  if (!raw) return { statusCode: 502, body: 'Empty response from cell' };

  // A cell returns a Function-URL response: { statusCode, headers, body }.
  let parsed: { statusCode?: number; body?: string };
  try {
    parsed = JSON.parse(raw) as { statusCode?: number; body?: string };
  } catch {
    return { statusCode: 200, body: raw };
  }
  let body: unknown = parsed.body;
  if (typeof parsed.body === 'string') {
    try {
      body = JSON.parse(parsed.body);
    } catch {
      body = parsed.body;
    }
  }
  return { statusCode: parsed.statusCode ?? 200, body };
}

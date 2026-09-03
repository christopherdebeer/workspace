/**
 * The provisioner — the runtime half of "CDK, but deployed at runtime".
 *
 * Wraps the AWS calls `forge` makes to bring a dynamic cell to life: upload the
 * code zip to S3, deploy the per-cell CloudFormation stack, query its status,
 * invoke the cell's Lambda, and tear it down. Clients are created lazily and are
 * injectable so the control-plane logic is unit-testable without AWS.
 */
import type { CloudFormation, S3, Lambda, CloudWatchLogs } from 'aws-sdk';
import { zipStore } from './zip';

let cfnClient: CloudFormation | undefined;
let s3Client: S3 | undefined;
let lambdaClient: Lambda | undefined;
let logsClient: CloudWatchLogs | undefined;

export function __setCloudFormation(stub: CloudFormation | undefined): void {
  cfnClient = stub;
}
export function __setS3(stub: S3 | undefined): void {
  s3Client = stub;
}
export function __setLambda(stub: Lambda | undefined): void {
  lambdaClient = stub;
}
export function __setCloudWatchLogs(stub: CloudWatchLogs | undefined): void {
  logsClient = stub;
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
function cwLogs(): CloudWatchLogs {
  if (!logsClient) logsClient = new (aws().CloudWatchLogs)();
  return logsClient;
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

export interface UploadPackageParams {
  bucket: string;
  key: string;
  /**
   * Files for the deployment package (handler + client bundle + static assets).
   * A Buffer entry ships verbatim — that is how a `static/` icon, font or sound
   * reaches /var/task intact rather than as UTF-8 replacement characters.
   */
  files: Array<{ name: string; content: string | Buffer }>;
}

/** Upload a multi-file deployment package (the tier-2 mirror of home's asset). */
export async function uploadPackage(p: UploadPackageParams): Promise<void> {
  const body = zipStore(p.files);
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

/** Update an existing cell stack in place (config changes — timeout, memory). */
export async function updateStack(stackName: string, template: Record<string, unknown>): Promise<void> {
  try {
    await cfn()
      .updateStack({
        StackName: stackName,
        TemplateBody: JSON.stringify(template),
        Capabilities: ['CAPABILITY_NAMED_IAM'],
      })
      .promise();
  } catch (err) {
    if (/No updates are to be performed/i.test((err as Error).message ?? '')) return;
    throw err;
  }
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
  /** The cell's own response headers (content-type etc.), passed through. */
  headers?: Record<string, string>;
  /** Set when the cell returned a base64-encoded binary body. */
  isBase64Encoded?: boolean;
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
  let parsed: { statusCode?: number; headers?: Record<string, string>; body?: string; isBase64Encoded?: boolean };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return { statusCode: 200, body: raw };
  }
  let body: unknown = parsed.body;
  // Binary bodies stay verbatim (base64); text bodies parse to JSON when they are.
  if (typeof parsed.body === 'string' && !parsed.isBase64Encoded) {
    try {
      body = JSON.parse(parsed.body);
    } catch {
      body = parsed.body;
    }
  }
  return {
    statusCode: parsed.statusCode ?? 200,
    body,
    headers: parsed.headers,
    isBase64Encoded: parsed.isBase64Encoded,
  };
}

export interface CellLogEvent {
  timestamp: number;
  message: string;
}

export interface GetCellLogsParams {
  /** Cell function name; its log group is `/aws/lambda/<functionName>`. */
  functionName: string;
  /** Lower time bound (epoch ms). Defaults to 15 minutes ago. */
  startTimeMs?: number;
  /** Max events to return. Defaults to 100. */
  limit?: number;
  /** Optional CloudWatch Logs filter pattern. */
  filterPattern?: string;
}

/** Tail a CloudWatch log group by exact name. Shared by cell logs (group
 *  `/aws/lambda/<fn>`) and platform logs (a discovered group). */
export async function getLogsByGroupName(
  logGroupName: string,
  p: { startTimeMs?: number; limit?: number; filterPattern?: string } = {},
): Promise<CellLogEvent[]> {
  const limit = p.limit ?? 100;
  const startTime = p.startTimeMs ?? Date.now() - 15 * 60 * 1000;
  // CloudWatch `filterLogEvents` returns events chronologically from `startTime`,
  // and a single call capped at `limit` yields the OLDEST N in the window — never
  // the recent tail (the silent reason a live tail showed minutes-stale lines).
  // Page to the end (bounded) and return the most-recent `limit`. For extreme
  // volumes that exceed the page budget, narrow with `since`/`filter`.
  const MAX_PAGES = 20;
  const PER_PAGE = 1000;
  try {
    const all: CellLogEvent[] = [];
    let nextToken: string | undefined;
    let pages = 0;
    do {
      const res = await cwLogs()
        .filterLogEvents({ logGroupName, startTime, limit: PER_PAGE, filterPattern: p.filterPattern, nextToken })
        .promise();
      for (const e of res.events ?? []) {
        const message = (e.message ?? '').replace(/\s+$/, '');
        if (message.length) all.push({ timestamp: e.timestamp ?? 0, message });
      }
      nextToken = res.nextToken;
    } while (nextToken && ++pages < MAX_PAGES);
    return all.slice(-limit); // the most-recent `limit` events (chronological asc)
  } catch (err) {
    // No log group yet (never invoked) → no logs, not an error.
    if ((err as { code?: string }).code === 'ResourceNotFoundException') return [];
    throw err;
  }
}

/** Tail a cell's Lambda logs via CloudWatch (observability as a tool). */
export async function getCellLogs(p: GetCellLogsParams): Promise<CellLogEvent[]> {
  return getLogsByGroupName(`/aws/lambda/${p.functionName}`, p);
}

/** Newest log group matching a prefix — platform Lambdas are CFN-auto-named, so
 *  `platform.logs` resolves `/aws/lambda/<stack>-<Service>Function…` by prefix. */
export async function findLogGroup(prefix: string): Promise<string | null> {
  const res = await cwLogs().describeLogGroups({ logGroupNamePrefix: prefix, limit: 50 }).promise();
  const groups = (res.logGroups ?? [])
    .filter((g): g is { logGroupName: string; creationTime?: number } => typeof g.logGroupName === 'string')
    .sort((a, b) => (b.creationTime ?? 0) - (a.creationTime ?? 0));
  return groups[0]?.logGroupName ?? null;
}

// ─── S3 object store (the cell common layer) ─────────────────────────
// forge brokers all cell S3 access; it already holds ReadWrite on the bucket.

/** Write an object (a source file, a blob, or a built zip). */
export async function putObject(bucket: string, key: string, body: string | Buffer, contentType = 'application/octet-stream'): Promise<void> {
  await s3().putObject({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }).promise();
}

/** Read an object as a UTF-8 string, or `null` if it does not exist. */
export async function getObject(bucket: string, key: string): Promise<string | null> {
  try {
    const res = await s3().getObject({ Bucket: bucket, Key: key }).promise();
    const body = res.Body;
    if (body == null) return '';
    return typeof body === 'string' ? body : Buffer.from(body as Uint8Array).toString('utf-8');
  } catch (err) {
    const e = err as { code?: string; statusCode?: number };
    if (e.code === 'NoSuchKey' || e.code === 'NotFound' || e.statusCode === 404) return null;
    throw err;
  }
}

/** Read an object's raw bytes + content type (binary blobs), or `null`. */
export async function getObjectRaw(bucket: string, key: string): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    const res = await s3().getObject({ Bucket: bucket, Key: key }).promise();
    const body = res.Body;
    return {
      body: body == null ? Buffer.alloc(0) : typeof body === 'string' ? Buffer.from(body) : Buffer.from(body as Uint8Array),
      contentType: res.ContentType ?? 'application/octet-stream',
    };
  } catch (err) {
    const e = err as { code?: string; statusCode?: number };
    if (e.code === 'NoSuchKey' || e.code === 'NotFound' || e.statusCode === 404) return null;
    throw err;
  }
}

/** List all object keys under a prefix (paginated to completion). */
export async function listObjects(bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3()
      .listObjectsV2({ Bucket: bucket, Prefix: prefix, ContinuationToken: token })
      .promise();
    for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Presigned PUT URL — the browser uploads bytes straight to S3. */
export function presignPut(bucket: string, key: string, contentType: string, expiresSec = 300): string {
  return s3().getSignedUrl('putObject', {
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    Expires: expiresSec,
  });
}

/** Delete one object. */
export async function deleteObject(bucket: string, key: string): Promise<void> {
  await s3().deleteObject({ Bucket: bucket, Key: key }).promise();
}

/** Point a cell's Lambda at a new code zip in S3 (the deploy-on-update step). */
export async function updateFunctionCode(functionName: string, bucket: string, key: string): Promise<void> {
  await lambda().updateFunctionCode({ FunctionName: functionName, S3Bucket: bucket, S3Key: key }).promise();
}

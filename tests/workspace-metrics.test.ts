/**
 * workspace.metrics — the admin-gated CloudWatch metrics surface (the infra
 * sibling of athena). Pins the guarantees that matter: only `platform:*` may
 * call it, the input shape is validated before any SDK touch, and backend
 * errors are scrubbed of infra identifiers. The CloudWatch SDK is stubbed via
 * the runner seam.
 */
import {
  createMetricsCommand,
  normalizeMetricsInput,
  sanitizeMetricsError,
  __setMetricsRunner,
  type MetricsResult,
} from '../services/workspace/commands-metrics';
import type { ServiceContext } from '../platform/runtime';

const ctxWith = (scopes: string[]): ServiceContext =>
  ({ identity: { user: 'c15r', scopes } } as unknown as ServiceContext);

const OK: MetricsResult = { series: [{ label: 'x', timestamps: [], values: [], sum: 0 }] };

afterEach(() => __setMetricsRunner(null));

describe('normalizeMetricsInput', () => {
  it('requires list or queries', () => {
    expect(() => normalizeMetricsInput(undefined)).toThrow(/list.*queries/s);
    expect(() => normalizeMetricsInput({})).toThrow();
    expect(() => normalizeMetricsInput({ queries: [] })).toThrow();
  });
  it('rejects both modes at once', () => {
    expect(() =>
      normalizeMetricsInput({ list: { namespace: 'AWS/Lambda' }, queries: [{ namespace: 'AWS/Lambda', metricName: 'Duration' }] }),
    ).toThrow(/not both/);
  });
  it('clamps hours to [1, 336] and caps queries at 10', () => {
    expect(normalizeMetricsInput({ list: { namespace: 'AWS/DynamoDB' }, hours: 9000 }).hours).toBe(336);
    expect(normalizeMetricsInput({ list: { namespace: 'AWS/DynamoDB' }, hours: 0 }).hours).toBe(1);
    const q = { namespace: 'AWS/Lambda', metricName: 'Duration' };
    expect(() => normalizeMetricsInput({ queries: Array.from({ length: 11 }, () => q) })).toThrow(/at most 10/);
  });
  it('requires namespace and metricName on every query', () => {
    expect(() => normalizeMetricsInput({ queries: [{ namespace: '', metricName: 'Duration' }] })).toThrow(/namespace/);
  });
});

describe('sanitizeMetricsError', () => {
  it('keeps the missing-action signal, drops identifiers', () => {
    const clean = sanitizeMetricsError(
      new Error(
        'User: arn:aws:sts::018159942401:assumed-role/ws is not authorized to perform: cloudwatch:GetMetricData',
      ),
    );
    expect(clean.message).toMatch(/cloudwatch:GetMetricData/);
    expect(clean.message).not.toMatch(/arn:aws/i);
    expect(clean.message).not.toMatch(/018159942401/);
  });
  it('scrubs ARNs and account ids from other backend errors', () => {
    const clean = sanitizeMetricsError(new Error('boom at arn:aws:cloudwatch:us-east-1:018159942401:x for 018159942401'));
    expect(clean.message).not.toMatch(/arn:aws/i);
    expect(clean.message).not.toMatch(/018159942401/);
  });
});

describe('metrics command', () => {
  const { metrics } = createMetricsCommand();

  it('rejects a caller without platform:*', async () => {
    __setMetricsRunner(async () => OK);
    await expect(metrics({ list: { namespace: 'AWS/DynamoDB' } }, ctxWith([]))).rejects.toThrow();
    await expect(
      metrics({ list: { namespace: 'AWS/DynamoDB' } }, ctxWith(['workspace:admin', 'read:workspace'])),
    ).rejects.toThrow();
  });

  it('runs for a platform:* admin and passes the normalised input to the runner', async () => {
    let seen: unknown = null;
    __setMetricsRunner(async (input) => {
      seen = input;
      return OK;
    });
    const res = await metrics(
      { queries: [{ namespace: 'AWS/DynamoDB', metricName: 'ConsumedReadCapacityUnits' }], hours: 999 },
      ctxWith(['platform:*']),
    );
    expect(res).toEqual(OK);
    expect((seen as { hours: number }).hours).toBe(336);
  });

  it('validates input even for an admin', async () => {
    __setMetricsRunner(async () => OK);
    await expect(metrics({}, ctxWith(['platform:*']))).rejects.toThrow();
  });
});

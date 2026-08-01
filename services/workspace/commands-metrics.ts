/**
 * `workspace.metrics` — an admin-gated CloudWatch metrics surface, the
 * infra-side sibling of `workspace.athena` (which sees the lake, i.e. what the
 * substrate DID; this sees what the infra SPENT doing it). Motivated by the
 * July 2026 bill review (docs/cost-review-2026-07.md): the account's own
 * consumption metrics were unreachable from an agent session, so root-causing
 * 1.29B DynamoDB reads meant guessing from code. Now the membrane can ask.
 *
 * AUTHORITY: account-wide infra telemetry, so gated on `platform:*` — declared
 * on the descriptor (gateway-enforced) AND re-checked here (a direct service
 * invoke bypasses the gateway). Read-only by construction: the only calls are
 * ListMetrics and GetMetricData.
 */
import { requireScope } from '../../platform/runtime';
import type { ServiceContext } from '../../platform/runtime';

export interface MetricQuerySpec {
  namespace: string;
  metricName: string;
  /** Dimension name → value, e.g. { TableName: "substrate-production" }. */
  dimensions?: Record<string, string>;
  /** CloudWatch stat: Sum | Average | Maximum | Minimum | SampleCount | p99 … (default Sum). */
  stat?: string;
  /** Period in seconds (min 60, default 3600). */
  period?: number;
  label?: string;
}
export interface MetricsInput {
  /** Discovery: enumerate metrics (and their dimension sets) in a namespace. */
  list?: { namespace: string; metricName?: string };
  /** Up to 10 GetMetricData series. */
  queries?: MetricQuerySpec[];
  /** Lookback window in hours (default 24, max 336 = 14 days). */
  hours?: number;
}
export interface MetricsSeries {
  label: string;
  timestamps: string[];
  values: number[];
  sum: number;
}
export interface MetricsResult {
  series?: MetricsSeries[];
  metrics?: Array<{ namespace: string; name: string; dimensions: Record<string, string> }>;
  window?: { start: string; end: string; periodSec: number };
}

/** Injectable runner (tests stub this; production uses CloudWatch). */
export type MetricsRunner = (input: MetricsInput) => Promise<MetricsResult>;

let runner: MetricsRunner | null = null;
/** Test seam — inject a fake runner (the platform SDK-injection convention). */
export function __setMetricsRunner(r: MetricsRunner | null): void {
  runner = r;
}

/** Same membrane hygiene as athena (wave-5 W5-3): keep the missing-action
 *  teaching signal, drop role ARNs / account ids. */
export function sanitizeMetricsError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const authMiss = /not authorized to perform:?\s*([\w:*]+)/i.exec(msg);
  if (authMiss || /access\s*denied|AccessDenied/i.test(msg)) {
    const action = authMiss?.[1];
    return new Error(
      `metrics backend is missing an IAM permission${action ? ` (${action})` : ''} — the CloudWatch grant needs updating; this is an infra grant gap, not a fault in your query.`,
    );
  }
  const scrubbed = msg
    .replace(/arn:aws:[^\s"')]+/gi, '[redacted-arn]')
    .replace(/\b\d{12}\b/g, '[redacted-account]');
  return new Error(scrubbed);
}

/** Validate + normalise the input shape. Throws on nonsense. Exported for tests. */
export function normalizeMetricsInput(input: MetricsInput | undefined): Required<Pick<MetricsInput, 'hours'>> & MetricsInput {
  if (!input || (!input.list && !input.queries?.length)) {
    throw new Error('pass `list: {namespace}` to discover metrics, or `queries: [...]` to fetch series');
  }
  if (input.list && input.queries?.length) throw new Error('pass `list` OR `queries`, not both');
  const hours = Math.min(Math.max(input.hours ?? 24, 1), 336);
  if (input.queries) {
    if (input.queries.length > 10) throw new Error('at most 10 queries per call');
    for (const q of input.queries) {
      if (!q.namespace || !q.metricName) throw new Error('each query needs `namespace` and `metricName`');
    }
  }
  return { ...input, hours };
}

/** The production runner — CloudWatch v3 SDK, lazily imported (no SDK at module load). */
async function cloudwatchRunner(input: MetricsInput): Promise<MetricsResult> {
  try {
    return await cloudwatchRunnerRaw(input);
  } catch (err) {
    throw sanitizeMetricsError(err);
  }
}

async function cloudwatchRunnerRaw(input: MetricsInput): Promise<MetricsResult> {
  const { CloudWatchClient, GetMetricDataCommand, ListMetricsCommand } = await import('@aws-sdk/client-cloudwatch');
  const client = new CloudWatchClient({});
  const norm = normalizeMetricsInput(input);

  if (norm.list) {
    const out = await client.send(
      new ListMetricsCommand({
        Namespace: norm.list.namespace,
        ...(norm.list.metricName ? { MetricName: norm.list.metricName } : {}),
      }),
    );
    const metrics = (out.Metrics ?? []).slice(0, 200).map((m) => ({
      namespace: m.Namespace ?? '',
      name: m.MetricName ?? '',
      dimensions: Object.fromEntries((m.Dimensions ?? []).map((d) => [d.Name ?? '', d.Value ?? ''])),
    }));
    return { metrics };
  }

  const end = new Date();
  const start = new Date(end.getTime() - norm.hours * 3600_000);
  const queries = norm.queries ?? [];
  const period = Math.max(60, queries[0]?.period ?? 3600);
  const out = await client.send(
    new GetMetricDataCommand({
      StartTime: start,
      EndTime: end,
      ScanBy: 'TimestampAscending',
      MetricDataQueries: queries.map((q, i) => ({
        Id: `m${i}`,
        Label: q.label ?? `${q.namespace}/${q.metricName}`,
        MetricStat: {
          Metric: {
            Namespace: q.namespace,
            MetricName: q.metricName,
            Dimensions: Object.entries(q.dimensions ?? {}).map(([Name, Value]) => ({ Name, Value })),
          },
          Period: Math.max(60, q.period ?? period),
          Stat: q.stat ?? 'Sum',
        },
        ReturnData: true,
      })),
    }),
  );
  const series: MetricsSeries[] = (out.MetricDataResults ?? []).map((r) => {
    const values = (r.Values ?? []).map((v) => Number(v));
    return {
      label: r.Label ?? r.Id ?? '',
      timestamps: (r.Timestamps ?? []).map((t) => new Date(t).toISOString()),
      values,
      sum: values.reduce((s, v) => s + v, 0),
    };
  });
  return { series, window: { start: start.toISOString(), end: end.toISOString(), periodSec: period } };
}

export function createMetricsCommand(): {
  metrics: (input: MetricsInput | undefined, ctx: ServiceContext) => Promise<MetricsResult>;
} {
  return {
    metrics: async (input, ctx) => {
      // Belt-and-suspenders: the gateway enforces the descriptor's `platform:*`
      // scope, but a direct service invoke would not — so enforce again here.
      requireScope(ctx.identity, 'platform:*');
      const norm = normalizeMetricsInput(input);
      return (runner ?? cloudwatchRunner)(norm);
    },
  };
}

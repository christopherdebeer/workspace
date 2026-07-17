/**
 * `workspace.athena` — an admin-gated SQL surface over the substrate analytics
 * lake (docs/substrate-analytics.md). Runs a read-only Athena query in the
 * `substrate-<env>` workgroup and returns rows.
 *
 * AUTHORITY: this reads the WHOLE lake (every scope's facts), so it is gated on
 * `platform:*` — declared on the descriptor (the gateway enforces it) AND
 * re-checked here with `requireScope` (a direct service invoke bypasses the
 * gateway). This coarse admin gate is the deliberate interim until the lake is
 * partitioned per-slice; at that point the gate can relax to run under the
 * caller's own grants. Read-only: only WITH/SELECT/SHOW/DESCRIBE/EXPLAIN, single
 * statement — the surface can observe the substrate, never mutate the catalog.
 */
import { requireScope } from '../../platform/runtime';
import type { ServiceContext } from '../../platform/runtime';

export interface AthenaInput {
  sql: string;
  /** Row cap (1–1000, default 100). */
  maxRows?: number;
}
export interface AthenaResult {
  columns: string[];
  rows: Array<Record<string, string | null>>;
  rowCount: number;
  /** Bytes scanned (Athena billing signal). */
  scannedBytes?: number;
  queryExecutionId: string;
}

const READONLY = /^\s*(with|select|show|describe|desc|explain)\b/i;

/** Guard the SQL surface: read-only verbs, single statement. Throws otherwise. */
export function assertReadOnlySql(sql: string): void {
  const trimmed = (sql ?? '').trim();
  if (!trimmed) throw new Error('sql is required');
  if (!READONLY.test(trimmed)) {
    throw new Error('only read-only queries are allowed (WITH / SELECT / SHOW / DESCRIBE / EXPLAIN)');
  }
  // Reject a second statement (anything after an interior semicolon). A single
  // trailing semicolon is fine.
  const withoutTrailing = trimmed.replace(/;\s*$/, '');
  if (withoutTrailing.includes(';')) throw new Error('only a single statement is allowed');
}

/** Injectable query runner (tests stub this; production uses Athena). */
export type AthenaRunner = (
  sql: string,
  opts: { workgroup: string; database: string; maxRows: number },
) => Promise<AthenaResult>;

let runner: AthenaRunner | null = null;
/** Test seam — inject a fake runner (mirrors the platform SDK-injection convention). */
export function __setAthenaRunner(r: AthenaRunner | null): void {
  runner = r;
}

/**
 * Redact infra internals from a backend error before it crosses the membrane
 * (wave-5 W5-3): a raw AWS authorization failure carries the service's own IAM
 * role ARN and account id (`arn:aws:sts::018159942401:assumed-role/…`), which
 * leaked straight to the caller. Keep the teaching signal (which action is
 * missing), drop the identifiers. A permission failure here is an infra grant
 * gap, not a query the caller can fix — say so.
 */
export function sanitizeAthenaError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const authMiss = /not authorized to perform:?\s*([\w:*]+)/i.exec(msg);
  if (authMiss || /access\s*denied|AccessDenied/i.test(msg)) {
    const action = authMiss?.[1];
    return new Error(
      `athena backend is missing an IAM permission${action ? ` (${action})` : ''} — the analytics-lake grant needs updating; this is an infra grant gap, not a fault in your query.`,
    );
  }
  // Any other backend error: scrub ARNs and bare 12-digit account ids, keep the rest.
  const scrubbed = msg
    .replace(/arn:aws:[^\s"')]+/gi, '[redacted-arn]')
    .replace(/\b\d{12}\b/g, '[redacted-account]');
  return new Error(scrubbed);
}

/** The production runner — Athena v3 SDK, lazily imported (no SDK at module load). */
async function athenaRunner(
  sql: string,
  opts: { workgroup: string; database: string; maxRows: number },
): Promise<AthenaResult> {
  try {
    return await athenaRunnerRaw(sql, opts);
  } catch (err) {
    throw sanitizeAthenaError(err);
  }
}

async function athenaRunnerRaw(
  sql: string,
  opts: { workgroup: string; database: string; maxRows: number },
): Promise<AthenaResult> {
  const { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } =
    await import('@aws-sdk/client-athena');
  const client = new AthenaClient({});
  const started = await client.send(
    new StartQueryExecutionCommand({
      QueryString: sql,
      WorkGroup: opts.workgroup,
      QueryExecutionContext: { Database: opts.database },
    }),
  );
  const id = started.QueryExecutionId;
  if (!id) throw new Error('athena did not return a query execution id');

  const deadline = Date.now() + 50_000; // stay under the 60s Lambda timeout
  let scannedBytes: number | undefined;
  for (;;) {
    const ex = await client.send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
    const state = ex.QueryExecution?.Status?.State;
    if (state === 'SUCCEEDED') {
      scannedBytes = ex.QueryExecution?.Statistics?.DataScannedInBytes;
      break;
    }
    if (state === 'FAILED' || state === 'CANCELLED') {
      throw new Error(`athena query ${state}: ${ex.QueryExecution?.Status?.StateChangeReason ?? 'no reason'}`);
    }
    if (Date.now() > deadline) throw new Error('athena query timed out (50s)');
    await new Promise((r) => setTimeout(r, 800));
  }

  const out = await client.send(
    new GetQueryResultsCommand({ QueryExecutionId: id, MaxResults: Math.min(opts.maxRows + 1, 1000) }),
  );
  const rowsRaw = out.ResultSet?.Rows ?? [];
  const columns = (rowsRaw[0]?.Data ?? []).map((d) => d.VarCharValue ?? '');
  const rows = rowsRaw.slice(1).map((r) => {
    const obj: Record<string, string | null> = {};
    (r.Data ?? []).forEach((d, i) => {
      obj[columns[i] ?? `col${i}`] = d.VarCharValue ?? null;
    });
    return obj;
  });
  return { columns, rows, rowCount: rows.length, scannedBytes, queryExecutionId: id };
}

export function createAthenaCommand(): {
  athena: (input: AthenaInput | undefined, ctx: ServiceContext) => Promise<AthenaResult>;
} {
  return {
    athena: async (input, ctx) => {
      // Belt-and-suspenders: the gateway enforces the descriptor's `platform:*`
      // scope, but a direct service invoke would not — so enforce again here.
      requireScope(ctx.identity, 'platform:*');
      const sql = input?.sql ?? '';
      assertReadOnlySql(sql);
      const workgroup = process.env.ATHENA_WORKGROUP;
      const database = process.env.ATHENA_DATABASE;
      if (!workgroup || !database) throw new Error('athena backend not configured (ATHENA_WORKGROUP/ATHENA_DATABASE unset)');
      const maxRows = Math.min(Math.max(input?.maxRows ?? 100, 1), 1000);
      return (runner ?? athenaRunner)(sql, { workgroup, database, maxRows });
    },
  };
}

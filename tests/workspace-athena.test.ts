/**
 * workspace.athena — the admin-gated SQL surface over the analytics lake.
 *
 * Pins the two guarantees that matter: only `platform:*` may call it, and only
 * read-only single statements run. The Athena SDK is stubbed via the runner seam.
 */
import { createAthenaCommand, assertReadOnlySql, __setAthenaRunner, type AthenaResult } from '../services/workspace/commands-athena';
import type { ServiceContext } from '../platform/runtime';

const ctxWith = (scopes: string[]): ServiceContext =>
  ({ identity: { user: 'c15r', scopes } } as unknown as ServiceContext);

const OK: AthenaResult = { columns: ['key'], rows: [{ key: 'goal/x' }], rowCount: 1, queryExecutionId: 'q1' };

afterEach(() => __setAthenaRunner(null));

describe('assertReadOnlySql', () => {
  it('accepts read-only verbs (incl. leading whitespace + CTE)', () => {
    expect(() => assertReadOnlySql('SELECT 1')).not.toThrow();
    expect(() => assertReadOnlySql('  with x as (select 1) select * from x')).not.toThrow();
    expect(() => assertReadOnlySql('SHOW TABLES')).not.toThrow();
    expect(() => assertReadOnlySql('SELECT 1;')).not.toThrow(); // trailing ; ok
  });
  it('rejects mutation / DDL / multi-statement / empty', () => {
    for (const bad of ['INSERT INTO t VALUES (1)', 'DROP TABLE facts', 'CREATE TABLE t AS SELECT 1', 'UPDATE t SET a=1', 'MSCK REPAIR TABLE facts', 'SELECT 1; DROP TABLE facts', '', '   ']) {
      expect(() => assertReadOnlySql(bad)).toThrow();
    }
  });
});

describe('athena command', () => {
  const { athena } = createAthenaCommand();

  beforeEach(() => {
    process.env.ATHENA_WORKGROUP = 'substrate-test';
    process.env.ATHENA_DATABASE = 'substrate_test';
  });

  it('rejects a caller without platform:*', async () => {
    __setAthenaRunner(async () => OK);
    await expect(athena({ sql: 'SELECT 1' }, ctxWith([]))).rejects.toThrow();
    await expect(athena({ sql: 'SELECT 1' }, ctxWith(['workspace:admin', 'read:workspace']))).rejects.toThrow();
  });

  it('rejects non-read-only SQL even for an admin', async () => {
    __setAthenaRunner(async () => OK);
    await expect(athena({ sql: 'DROP TABLE facts' }, ctxWith(['platform:*']))).rejects.toThrow(/read-only/);
  });

  it('runs for a platform:* admin and passes clamped maxRows through', async () => {
    let seen: { workgroup: string; database: string; maxRows: number } | null = null;
    __setAthenaRunner(async (_sql, opts) => {
      seen = opts;
      return OK;
    });
    const res = await athena({ sql: 'SELECT key FROM facts', maxRows: 9000 }, ctxWith(['platform:*']));
    expect(res).toEqual(OK);
    expect(seen).toEqual({ workgroup: 'substrate-test', database: 'substrate_test', maxRows: 1000 });
  });

  it('errors when the backend is unconfigured', async () => {
    delete process.env.ATHENA_WORKGROUP;
    __setAthenaRunner(async () => OK);
    await expect(athena({ sql: 'SELECT 1' }, ctxWith(['platform:*']))).rejects.toThrow(/not configured/);
  });
});

/**
 * @c15r/kernel/cell-jobs — the shared async-job choreography (ADR-0076, C5;
 * joins substrate.js in the kernel SDK, ADR-0017).
 *
 * The `submit fast → putJob(pending) → self-invoke → work → putJob(done|error)
 * → poll fetch` pattern the run and models cells each hand-rolled (the edge
 * caps synchronous round trips at ~30s; async self-invocations don't). ONE
 * source for the protocol — the JOB# row shape, the TTL, the chunking for
 * results past DynamoDB's item cap, the `{__job}` self-invoke envelope — with
 * the cell's AWS clients injected as three tiny ops (exactly substrate.js's
 * adapter pattern), so this module stays SDK-free: bundles anywhere,
 * unit-tests without AWS.
 *
 * Served verbatim at /@c15r/kernel/cell-jobs.js; server-side cells consume it
 * via the `cell-sync push` overlay as `vendor/cell-jobs.js` (see
 * gateway-client.js for why not a https import).
 */

/** b64 chars per chunk item — safely under DynamoDB's 400KB item cap. */
export const JOB_CHUNK = 300 * 1024;
const JOB_TTL_SECS = 3600;

/**
 * @typedef {object} JobOps  What the host cell provides — thin adapters over
 * its own ddb/lambda clients.
 * @property {(item: Record<string, unknown>) => Promise<void>} put  Put one raw item into the cell's table.
 * @property {(key: {pk: string, sk: string}) => Promise<Record<string, unknown> | undefined>} get  Get one raw item, or undefined.
 * @property {(payload: unknown) => Promise<void>} invokeSelf  Async-invoke the cell's own function (InvocationType Event).
 */

/**
 * @param {JobOps} ops
 * @param {number} [ttlSecs]
 */
export function cellJobs(ops, ttlSecs = JOB_TTL_SECS) {
  const ttl = () => Math.floor(Date.now() / 1000) + ttlSecs;
  return {
    /** Merge-write the job's v1 row (status/input/result live here).
     * @param {string} jobId @param {Record<string, unknown>} patch */
    async putJob(jobId, patch) {
      await ops.put({ pk: `JOB#${jobId}`, sk: 'v1', ttl: ttl(), ...patch });
    },
    /** The job's v1 row, or undefined. @param {string} jobId */
    async getJob(jobId) {
      return ops.get({ pk: `JOB#${jobId}`, sk: 'v1' });
    },
    /** Submit: write `pending` (+ any extra fields) and self-invoke `{__job: jobId}`.
     * @param {string} jobId @param {Record<string, unknown>} record */
    async submit(jobId, record) {
      await ops.put({ pk: `JOB#${jobId}`, sk: 'v1', ttl: ttl(), status: 'pending', ...record });
      await ops.invokeSelf({ __job: jobId });
    },
    /** Store an oversized string result as chunk rows; returns the chunk count.
     * @param {string} jobId @param {string} data */
    async putChunks(jobId, data) {
      const count = Math.ceil(data.length / JOB_CHUNK);
      for (let i = 0; i < count; i++) {
        await ops.put({ pk: `JOB#${jobId}`, sk: `c${i}`, ttl: ttl(), data: data.slice(i * JOB_CHUNK, (i + 1) * JOB_CHUNK) });
      }
      return count;
    },
    /** Reassemble `putChunks` output. @param {string} jobId @param {number} count */
    async getChunks(jobId, count) {
      let out = '';
      for (let i = 0; i < count; i++) {
        const item = await ops.get({ pk: `JOB#${jobId}`, sk: `c${i}` });
        out += (item && typeof item.data === 'string' ? item.data : '');
      }
      return out;
    },
  };
}

import { BENCH_K, createRoadProfileKernel } from './roadprofile';

interface ProfileJob {
  id: number;
  n: number;
  dense: Float64Array;
  candidates: Float64Array;
  maxGrade: number;
  p0: number | null;
  p1: number | null;
  pins: Float64Array;
}

interface ProfileReply {
  id: number;
  profile?: Float64Array;
  workerMs?: number;
  error?: string;
}

interface Pending {
  at: number;
  bytes: number;
  resolve: (result: RoadProfileResult) => void;
  reject: (error: Error) => void;
}

export interface RoadProfileResult {
  profile: number[];
  workerMs: number;
  waitMs: number;
  bytes: number;
}

export interface RoadProfileWorkerStats {
  jobs: number;
  failures: number;
  bytes: number;
  workerMs: number;
  waitMs: number;
  lastWorkerMs: number;
  lastWaitMs: number;
}

/**
 * The production cell emits one app.js, so the worker is a Blob. Its numerical
 * kernel is not copied: the compiled source of the same factory used on the
 * main thread is installed in the worker.
 */
export function roadProfileWorkerSource(): string {
  return [
    "'use strict';",
    `const core = (${createRoadProfileKernel.toString()})();`,
    'self.onmessage = (event) => {',
    '  const job = event.data;',
    '  try {',
    '    const dense = new Array(job.n);',
    '    const candidates = new Array(job.n);',
    '    for (let i = 0; i < job.n; i++) {',
    '      dense[i] = [job.dense[i * 2], job.dense[i * 2 + 1]];',
    '      const row = new Array(core.BENCH_K);',
    '      for (let k = 0; k < core.BENCH_K; k++) row[k] = job.candidates[i * core.BENCH_K + k];',
    '      candidates[i] = row;',
    '    }',
    '    let pins;',
    '    if (job.pins.length) {',
    '      pins = new Array(job.n);',
    '      for (let i = 0; i < job.n; i++) pins[i] = Number.isNaN(job.pins[i]) ? null : job.pins[i];',
    '    }',
    '    const t0 = performance.now();',
    '    const solved = core.solveChain(dense, candidates, job.maxGrade, job.p0, job.p1, pins);',
    '    const profile = Float64Array.from(solved);',
    '    self.postMessage({ id: job.id, profile, workerMs: performance.now() - t0 }, [profile.buffer]);',
    '  } catch (error) {',
    "    self.postMessage({ id: job.id, error: String(error && error.stack || error) });",
    '  }',
    '};',
  ].join('\n');
}

export class RoadProfileWorker {
  private worker: Worker | null = null;
  private disabled = false;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  readonly stats: RoadProfileWorkerStats = {
    jobs: 0,
    failures: 0,
    bytes: 0,
    workerMs: 0,
    waitMs: 0,
    lastWorkerMs: 0,
    lastWaitMs: 0,
  };

  solve(
    dense: Array<[number, number]>,
    candidates: number[][],
    maxGrade: number,
    p0: number | null,
    p1: number | null,
    pins?: Array<number | null>,
  ): Promise<RoadProfileResult> {
    let worker: Worker;
    try {
      worker = this.ensureWorker();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }

    const n = dense.length;
    const flatDense = new Float64Array(n * 2);
    const flatCandidates = new Float64Array(n * BENCH_K);
    const flatPins = pins ? new Float64Array(n) : new Float64Array(0);
    for (let i = 0; i < n; i++) {
      flatDense[i * 2] = dense[i][0];
      flatDense[i * 2 + 1] = dense[i][1];
      for (let k = 0; k < BENCH_K; k++) flatCandidates[i * BENCH_K + k] = candidates[i][k];
      if (pins) flatPins[i] = pins[i] === null ? Number.NaN : pins[i] as number;
    }

    const id = this.nextId++;
    const bytes = flatDense.byteLength + flatCandidates.byteLength + flatPins.byteLength;
    const job: ProfileJob = {
      id, n, dense: flatDense, candidates: flatCandidates,
      maxGrade, p0, p1, pins: flatPins,
    };
    return new Promise<RoadProfileResult>((resolve, reject) => {
      this.pending.set(id, { at: performance.now(), bytes, resolve, reject });
      try {
        worker.postMessage(job, [flatDense.buffer, flatCandidates.buffer, flatPins.buffer]);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  dispose(): void {
    this.fail(new Error('road profile worker disposed'));
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    if (this.disabled || typeof Worker !== 'function') throw new Error('road profile worker unavailable');
    const url = URL.createObjectURL(new Blob([roadProfileWorkerSource()], { type: 'application/javascript' }));
    try {
      const worker = new Worker(url, { name: 'drive-road-profile' });
      worker.onmessage = (event: MessageEvent<ProfileReply>) => this.receive(event.data);
      worker.onerror = (event: ErrorEvent) => this.fail(new Error(event.message || 'road profile worker failed'));
      worker.onmessageerror = () => this.fail(new Error('road profile worker message failed'));
      this.worker = worker;
      return worker;
    } catch (error) {
      this.disabled = true;
      throw error;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private receive(reply: ProfileReply): void {
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    this.pending.delete(reply.id);
    if (reply.error || !reply.profile) {
      this.stats.failures++;
      pending.reject(new Error(reply.error ?? 'road profile worker returned no profile'));
      return;
    }
    const waitMs = performance.now() - pending.at;
    const workerMs = reply.workerMs ?? 0;
    this.stats.jobs++;
    this.stats.bytes += pending.bytes;
    this.stats.workerMs += workerMs;
    this.stats.waitMs += waitMs;
    this.stats.lastWorkerMs = workerMs;
    this.stats.lastWaitMs = waitMs;
    pending.resolve({ profile: Array.from(reply.profile), workerMs, waitMs, bytes: pending.bytes });
  }

  private fail(error: Error): void {
    this.disabled = true;
    this.stats.failures++;
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

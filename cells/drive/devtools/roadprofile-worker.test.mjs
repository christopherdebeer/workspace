/**
 * The Blob worker must execute the same numerical kernel as the synchronous
 * fallback. Node's worker_threads gets a tiny Web Worker compatibility shim so
 * this test exercises the exact source the browser receives.
 *
 *   node cells/drive/devtools/roadprofile-worker.test.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'roadprofile-worker-'));
const profileBuild = join(tmp, 'roadprofile.mjs');
const workerBuild = join(tmp, 'roadprofile-worker.mjs');
for (const [src, out] of [
  [join(HERE, '../client/roadprofile.ts'), profileBuild],
  [join(HERE, '../client/roadprofile-worker.ts'), workerBuild],
]) {
  execFileSync('npx', ['esbuild', src, '--bundle', '--format=esm', `--outfile=${out}`],
    { cwd: ROOT, stdio: 'pipe' });
}
const P = await import(pathToFileURL(profileBuild).href);
const W = await import(pathToFileURL(workerBuild).href);

const source = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
self.postMessage = (value, transfer) => parentPort.postMessage(value, transfer);
parentPort.on('message', (data) => self.onmessage({ data }));
${W.roadProfileWorkerSource()}
`;
const worker = new Worker(source, { eval: true });
let nextId = 1;
const pending = new Map();
worker.on('message', (reply) => {
  const settle = pending.get(reply.id);
  if (!settle) return;
  pending.delete(reply.id);
  reply.error ? settle.reject(new Error(reply.error)) : settle.resolve(reply);
});
worker.on('error', (error) => {
  for (const settle of pending.values()) settle.reject(error);
  pending.clear();
});

function runWorker(dense, candidates, maxGrade, p0, p1, pins) {
  const n = dense.length;
  const flatDense = new Float64Array(n * 2);
  const flatCandidates = new Float64Array(n * P.BENCH_K);
  const flatPins = pins ? new Float64Array(n) : new Float64Array(0);
  for (let i = 0; i < n; i++) {
    flatDense[i * 2] = dense[i][0];
    flatDense[i * 2 + 1] = dense[i][1];
    for (let k = 0; k < P.BENCH_K; k++) flatCandidates[i * P.BENCH_K + k] = candidates[i][k];
    if (pins) flatPins[i] = pins[i] === null ? Number.NaN : pins[i];
  }
  const id = nextId++;
  const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  worker.postMessage({
    id, n, dense: flatDense, candidates: flatCandidates,
    maxGrade, p0, p1, pins: flatPins,
  }, [flatDense.buffer, flatCandidates.buffer, flatPins.buffer]);
  return result;
}

let bad = 0;
const check = (name, condition, saw) => {
  if (!condition) bad++;
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${name}${condition ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

for (const n of [192, 640]) {
  const dense = Array.from({ length: n }, (_, i) => [i * 12, Math.sin(i / 23) * 30]);
  const sample = (x, z) => 80 + x * 0.002
    + Math.sin(x * 0.019 + z * 0.031) * 2.4 + Math.cos(z * 0.07) * 0.8;
  const candidates = dense.map((_, i) => P.latCands(dense, i, sample));
  const pins = new Array(n).fill(null);
  pins[Math.floor(n * 0.55)] = candidates[Math.floor(n * 0.55)][P.BENCH_C] - 0.7;
  const p0 = candidates[0][P.BENCH_C] - 0.4;
  const p1 = candidates[n - 1][P.BENCH_C] + 0.3;
  const expected = P.solveChain(dense, candidates, 0.12, p0, p1, pins);
  const reply = await runWorker(dense, candidates, 0.12, p0, p1, pins);
  const got = Array.from(reply.profile);
  let worst = 0;
  for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(got[i] - expected[i]));
  check(`${n} stations match the synchronous profile exactly`, worst === 0, { worst });
  check(`${n} stations report worker execution time`, reply.workerMs >= 0, reply.workerMs);
}

await worker.terminate();
console.log(bad ? `${bad} FAILED` : 'all good');
if (bad) process.exitCode = 1;

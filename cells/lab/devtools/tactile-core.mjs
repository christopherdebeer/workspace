/**
 * Tactile's reader core, compiled from the firmware itself.
 *
 *   TACTILE=/path/to/tactile node cells/lab/devtools/tactile-core.mjs
 *
 * 1. Compiles firmware/main/afterword.c (unchanged) with a freestanding libc
 *    shim (devtools/tactile/libc) to WebAssembly and writes it, base64, with
 *    its provenance, to client/tactile/core.gen.ts.
 * 2. Compiles the firmware's own host regression (tests/afterword.c) against
 *    the same shim and runs it here, so the browser core passes the tests the
 *    device ships with.
 * 3. Builds the same core natively (gcc + libm) and drives both through one
 *    scripted handling trace, requiring identical frames and state, so the
 *    shim's numerics cannot drift from a real C library unnoticed.
 *
 * The simulator never re-implements the interaction: change the firmware,
 * rerun this, and the phone runs the new device.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CELL = join(here, '..');
const TACTILE = process.env.TACTILE ?? join(CELL, '../../../tactile');
const SHIM = join(here, 'tactile');
const source = join(TACTILE, 'firmware/main/afterword.c');
if (!existsSync(source)) throw new Error(`no firmware at ${source} (set TACTILE=<tactile checkout>)`);
const work = mkdtempSync(join(tmpdir(), 'tactile-core-'));
const git = (...a) => { try { return execFileSync('git', ['-C', TACTILE, ...a], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } };
const version = readFileSync(join(TACTILE, 'firmware/version.txt'), 'utf8').trim();

const EXPORTS = ['sim_gravity', 'sim_gyro', 'sim_note', 'sim_frame', 'sim_state', 'sim_frame_field', 'sim_init', 'sim_tick',
  'sim_restart_tutorial', 'sim_stage_name', 'aw_set_pace_ms', 'aw_pace_ms', 'aw_set_inversions', 'aw_fixation_index'];
const wasmFlags = ['--target=wasm32', '-O2', '-std=c11', '-ffreestanding', '-nostdlib', '-fno-builtin-printf',
  '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', '-I', join(SHIM, 'libc'), '-I', join(TACTILE, 'firmware/main'),
  `-DTACTILE_VERSION="${version}"`, '-Wl,--no-entry', '-Wl,--allow-undefined', '-Wl,--export-memory'];

// 1. the core
const core = join(work, 'core.wasm');
execFileSync('clang', [...wasmFlags, ...EXPORTS.map((e) => `-Wl,--export=${e}`), '-o', core,
  source, join(SHIM, 'glue.c'), join(SHIM, 'libc/libc.c')], { stdio: 'inherit' });
const bytes = readFileSync(core);

// 2. the firmware's own regression, on the shim
const testWasm = join(work, 'test.wasm');
execFileSync('clang', [...wasmFlags.filter((f) => f !== '-Wl,--no-entry'), '-Wno-return-type', '-Wl,--export=main', '-Wl,--entry=main', '-o', testWasm,
  join(TACTILE, 'tests/afterword.c'), source, join(SHIM, 'libc/libc.c')], { stdio: 'inherit' });
{
  let memory;
  const text = (p, n) => new TextDecoder().decode(new Uint8Array(memory.buffer, p, n ?? new Uint8Array(memory.buffer, p).indexOf(0)));
  const { instance } = await WebAssembly.instantiate(readFileSync(testWasm), { env: {
    sim_print: (p, n) => console.log(`  firmware test: ${text(p, n)}`),
    sim_assert_failed: (e, f, l) => { throw new Error(`firmware test failed in wasm: ${text(e)} (${text(f)}:${l})`); },
  } });
  memory = instance.exports.memory;
  instance.exports.main();
}

// 3. native parity on one handling trace
const { build } = await import('esbuild');
const coreJs = join(work, 'core.mjs');
await build({ entryPoints: [join(CELL, 'client/tactile/core.ts')], bundle: true, format: 'esm', platform: 'node', outfile: coreJs, logLevel: 'warning' });
const { Core } = await import(coreJs);
const wasmCore = await Core.load(bytes);
const native = join(work, 'native');
execFileSync('gcc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-Wno-unused-parameter', `-DTACTILE_VERSION="${version}"`,
  '-I', join(TACTILE, 'firmware/main'), '-o', native, join(SHIM, 'trace.c'), join(SHIM, 'glue.c'), source, '-lm'], { stdio: 'inherit' });
const trace = scriptedTrace();
const expected = execFileSync(native, { input: trace.map((s) => s.join(' ')).join('\n') + '\n', encoding: 'utf8', maxBuffer: 64 << 20 }).trim().split('\n');
wasmCore.init({ pace: 440, invertRoll: false, invertPitch: false, tutorialDone: false, note: '', now: 0 });
let mismatches = 0;
trace.forEach(([now, gx, gy, gz, wx, wy, wz], i) => {
  const out = wasmCore.tick(now, [gx, gy, gz], [wx, wy, wz], true);
  const line = [out.frame.section, out.frame.word, out.frame.after, out.frame.hint,
    out.state.rate.toFixed(4), out.state.stage, +out.state.focused, +out.state.latched].join('|');
  if (line !== expected[i] && mismatches++ < 5) console.error(`  tick ${i}: wasm ${line}\n          gcc  ${expected[i]}`);
});
const words = new Set(expected.map((l) => l.split('|')[1]));
if (mismatches) throw new Error(`wasm and native cores disagree on ${mismatches}/${trace.length} ticks`);
console.log(`  parity: ${trace.length} ticks identical to native gcc (${words.size} distinct words, stages reached: ${[...new Set(expected.map((l) => l.split('|')[5]))].join(' ')})`);

const out = join(CELL, 'client/tactile/core.gen.ts');
writeFileSync(out, `/* Generated by devtools/tactile-core.mjs: do not edit. */
/** firmware/main/afterword.c from christopherdebeer/tactile, compiled unchanged to WebAssembly */
export const CORE = {
  firmware: ${JSON.stringify(version)},
  commit: ${JSON.stringify(git('rev-parse', '--short', 'HEAD'))},
  source: ${JSON.stringify(createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 16))},
  /** the reader's tuning, as #defined in afterword.c (radians, ms, multipliers) */
  constants: ${JSON.stringify(Object.fromEntries([...readFileSync(source, 'utf8').matchAll(/^#define ([A-Z_]+) (-?[0-9.]+)f?$/gm)].map((m) => [m[1], +m[2]])))},
  wasm: ${JSON.stringify(bytes.toString('base64'))},
};
`);
console.log(`wrote ${out}: ${bytes.length} bytes of wasm, firmware ${version} @ ${git('rev-parse', '--short', 'HEAD')}`);

/** A minute of handling through the tutorial and into the narrative, at the firmware's 50 Hz. */
function scriptedTrace() {
  const rows = [];
  let t = 1000, roll = 0, pitch = 0;
  const g = 9.81;
  const push = (ms, targetRoll, targetPitch) => {
    for (let k = 0; k < ms; k += 20) {
      const r0 = roll, p0 = pitch;
      roll += (targetRoll - roll) * 0.12; pitch += (targetPitch - pitch) * 0.12;
      // device frame: x right, y up the screen, z out of it; clockwise roll is +roll
      const up = [-Math.sin(roll) * Math.cos(pitch), Math.cos(roll) * Math.cos(pitch), Math.sin(pitch)];
      const w = [(pitch - p0) / 0.02, 0, -(roll - r0) / 0.02];
      t += 20;
      rows.push([t, ...up.map((v) => +(v * g).toFixed(5)), ...w.map((v) => +v.toFixed(5))]);
    }
  };
  push(1000, 0, 0);                                     // settle: neutral captured
  for (const [r, p, ms] of [[0.5, 0, 1800], [0, 0, 800], [-0.5, 0, 3500], [0, 0, 800], [0.5, 0, 1800], [0, 0, 800],
    [-0.5, 0, 1200], [0, 0, 1500], [0, 0, 800], [0, 0.5, 900], [0, 0, 800], [0, -0.5, 900], [0, 0, 1500],
    [0, 0, 4000], [-0.4, 0, 1600], [0, 0, 1200], [0, 0.5, 900], [0, 0, 1000], [0, -0.5, 900], [0, 0, 1200],
    [0.3, 0.2, 900], [0, 0, 2000]]) push(ms, r, p);
  return rows;
}

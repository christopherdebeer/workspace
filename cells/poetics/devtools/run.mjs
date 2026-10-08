#!/usr/bin/env node
/**
 * run — one exploratory round of the poetics harness, with small subagents as
 * the subjects.
 *
 *   node cells/poetics/devtools/run.mjs [--set source-authority-v1] [--model haiku]
 *        [--placement system|user] [--reps 3] [--conditions a,b,c] [--tasks x,y]
 *        [--concurrency 4] [--run <id>] [--dry-run]
 *
 * Every trial is a FRESH headless session (`claude -p`): no prior turns, no
 * tools, no MCP servers, no repo CLAUDE.md (cwd is an empty scratch dir), the
 * default system prompt replaced by the composition under test (placement
 * `system`) or by a neutral line with the composition prepended to the user
 * turn (placement `user`). One turn, then the output is scored by
 * lib/score.cjs. The model is recorded as the CLI reports it (the canonical id
 * from modelUsage), with usage, cost and latency per trial.
 *
 * Output: static/data/runs/<run>/manifest.json (what was run: the set, every
 * condition's full text, every task, the model asked for, the CLI version) and
 * trials-<condition>.json (every trial with its output and score). A run id
 * defaults to <date>-<model>-<placement>; pass --run to add to an existing one
 * (new reps are appended; a trial already present for condition×task×rep is
 * skipped, so a stopped run can be resumed).
 *
 * Then: node cells/poetics/devtools/aggregate.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { score } = require('./lib/score.cjs');

const here = dirname(fileURLToPath(import.meta.url));
const CELL = join(here, '..');
const STATIC = join(CELL, 'static');
const SCRATCH = process.env.POETICS_SCRATCH || join(process.env.TMPDIR || '/tmp', 'poetics-subject');

// ─── args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return dflt;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const SET = flag('set', 'source-authority-v1');
const MODEL = flag('model', 'haiku');
const PLACEMENT = flag('placement', 'system');
const REPS = Number(flag('reps', 3));
const CONCURRENCY = Number(flag('concurrency', 4));
const DRY = flag('dry-run', false) === true;
const ONLY_CONDITIONS = flag('conditions', '') ? String(flag('conditions', '')).split(',') : null;
const ONLY_TASKS = flag('tasks', '') ? String(flag('tasks', '')).split(',') : null;
const BUDGET_PER_TRIAL_USD = Number(flag('budget', 0.05));
if (!['system', 'user'].includes(PLACEMENT)) throw new Error('--placement must be system or user');

// ─── materials ───────────────────────────────────────────────────────
function frontmatter(src) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(src);
  if (!m) return { meta: {}, body: src.trim() };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2];
  }
  return { meta, body: m[2].trim() };
}

function loadConditions(set) {
  const dir = join(STATIC, 'conditions', set);
  if (!existsSync(dir)) throw new Error(`no condition set at ${dir}`);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const { meta, body } = frontmatter(readFileSync(join(dir, f), 'utf8'));
      return { id: meta.id || f.replace(/\.md$/, ''), role: meta.role || 'form', note: meta.note || '', text: body };
    });
}

function loadTasks() {
  const dir = join(STATIC, 'tasks');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
}

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** The user turn: the task's instruction and source. With user placement, the composition leads. */
function userTurn(task, condition) {
  const body = `${task.instruction}\n\n${task.source}`;
  return PLACEMENT === 'user' && condition.id !== 'none' ? `${condition.text}\n\n${body}` : body;
}
const NEUTRAL = 'You are a helpful assistant.';
function systemPrompt(condition) {
  return PLACEMENT === 'system' ? condition.text : NEUTRAL;
}

// ─── the subject ─────────────────────────────────────────────────────
function cliVersion() {
  try {
    return execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** One fresh session. Resolves to the CLI's JSON result (never rejects on a model error — that is a trial outcome). */
function cast(system, prompt) {
  return new Promise((resolve) => {
    const started = Date.now();
    const argv = [
      '-p',
      '--model', MODEL,
      '--no-session-persistence',
      '--max-turns', '1',
      '--tools', '',
      '--strict-mcp-config',
      '--max-budget-usd', String(BUDGET_PER_TRIAL_USD),
      '--system-prompt', system,
      '--output-format', 'json',
      prompt,
    ];
    const child = spawn('claude', argv, { cwd: SCRATCH, env: { ...process.env, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 180_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      let json = null;
      try {
        json = JSON.parse(out);
      } catch {
        /* not JSON: a crash */
      }
      resolve({ json, raw: json ? undefined : out.slice(0, 2000), stderr: err.slice(0, 2000), exitCode: code, wallMs: Date.now() - started });
    });
  });
}

function trialFrom(cond, task, rep, res, system, prompt) {
  const j = res.json;
  const models = j && j.modelUsage ? Object.keys(j.modelUsage) : [];
  const output = j && !j.is_error && typeof j.result === 'string' ? j.result : '';
  const s = score(task, output);
  return {
    id: `${cond.id}~${task.id}~${rep}`,
    condition: cond.id,
    task: task.id,
    family: task.family,
    rep,
    placement: PLACEMENT,
    modelRequested: MODEL,
    model: models[0] || null,
    systemSha: sha(system),
    promptSha: sha(prompt),
    output,
    isError: !j || !!j.is_error || res.exitCode !== 0,
    error: !j ? `no JSON (exit ${res.exitCode}): ${res.stderr || res.raw || ''}`.slice(0, 500) : j.is_error ? String(j.result).slice(0, 500) : undefined,
    usage: j && j.usage ? {
      input: j.usage.input_tokens,
      cacheCreation: j.usage.cache_creation_input_tokens,
      cacheRead: j.usage.cache_read_input_tokens,
      output: j.usage.output_tokens,
    } : null,
    costUsd: j ? j.total_cost_usd : null,
    apiMs: j ? j.duration_api_ms : null,
    wallMs: res.wallMs,
    at: new Date().toISOString(),
    score: s.score,
    components: s.components,
    detail: s.detail,
  };
}

// ─── the round ───────────────────────────────────────────────────────
async function main() {
  mkdirSync(SCRATCH, { recursive: true });
  const conditions = loadConditions(SET).filter((c) => !ONLY_CONDITIONS || ONLY_CONDITIONS.includes(c.id));
  const tasks = loadTasks().filter((t) => !ONLY_TASKS || ONLY_TASKS.includes(t.id));
  const day = new Date().toISOString().slice(0, 10);
  const runId = String(flag('run', `${day}-${MODEL}-${PLACEMENT}`));
  const dir = join(STATIC, 'data', 'runs', runId);
  mkdirSync(dir, { recursive: true });

  const manifestPath = join(dir, 'manifest.json');
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8'))
    : {
        id: runId,
        set: SET,
        model: MODEL,
        placement: PLACEMENT,
        neutralSystem: PLACEMENT === 'user' ? NEUTRAL : undefined,
        createdAt: new Date().toISOString(),
        cli: cliVersion(),
        host: 'claude-code remote container',
        subject: 'claude -p, fresh session per trial, one turn, no tools, no MCP, no CLAUDE.md',
        conditions: [],
        tasks: [],
        reps: 0,
        notes: [],
      };
  // (materials are recorded in full: a later reader needs the exact text, not a name)
  for (const c of conditions) if (!manifest.conditions.find((x) => x.id === c.id)) manifest.conditions.push({ ...c, sha: sha(c.text) });
  for (const t of tasks) if (!manifest.tasks.find((x) => x.id === t.id)) manifest.tasks.push(t);
  manifest.reps = Math.max(manifest.reps || 0, REPS);

  const trialsOf = {};
  for (const c of conditions) {
    const p = join(dir, `trials-${c.id}.json`);
    trialsOf[c.id] = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : [];
  }
  const have = new Set(Object.values(trialsOf).flat().map((t) => t.id));

  // Interleave conditions so a drift in the model over the run's minutes lands on all of them alike.
  const queue = [];
  for (let rep = 1; rep <= REPS; rep++)
    for (const t of tasks)
      for (const c of conditions) if (!have.has(`${c.id}~${t.id}~${rep}`)) queue.push({ c, t, rep });

  console.log(`run ${runId}: ${conditions.length} conditions × ${tasks.length} tasks × ${REPS} reps = ${conditions.length * tasks.length * REPS} trials (${queue.length} to do), model ${MODEL}, placement ${PLACEMENT}`);
  if (DRY) {
    for (const c of conditions) console.log(`\n── ${c.id} (${c.role}) ──\n${systemPrompt(c)}`);
    console.log(`\n── user turn, ${tasks[0].id} under ${conditions[0].id} ──\n${userTurn(tasks[0], conditions[0])}`);
    return;
  }

  let done = 0;
  let spent = 0;
  const save = () => {
    for (const c of conditions) writeFileSync(join(dir, `trials-${c.id}.json`), JSON.stringify(trialsOf[c.id], null, 1) + '\n');
    manifest.updatedAt = new Date().toISOString();
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  };
  const worker = async () => {
    while (queue.length) {
      const { c, t, rep } = queue.shift();
      const system = systemPrompt(c);
      const prompt = userTurn(t, c);
      const res = await cast(system, prompt);
      const trial = trialFrom(c, t, rep, res, system, prompt);
      trialsOf[c.id].push(trial);
      done++;
      spent += trial.costUsd || 0;
      const mark = trial.isError ? 'ERR ' : `${trial.score.toFixed(2)} `;
      console.log(`${String(done).padStart(4)} ${mark}${trial.id.padEnd(28)} ${trial.model || '-'} ${trial.apiMs ?? '-'}ms $${(trial.costUsd ?? 0).toFixed(4)}${trial.isError ? `  ${trial.error}` : ''}`);
      if (done % 8 === 0) save();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  save();
  console.log(`\ndone: ${done} trials, $${spent.toFixed(4)} → ${dir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

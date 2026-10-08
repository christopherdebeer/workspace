#!/usr/bin/env node
/**
 * aggregate — from the committed trials to what the cell shows.
 *
 *   node cells/poetics/devtools/aggregate.mjs
 *
 * For every run under static/data/runs/<run>/ it writes summary.json beside
 * the trials (per condition: n, mean score and sd, the component means, error
 * count, token and cost means; per condition × family: n and mean; the
 * pre-specified contrasts as differences of means with a seeded bootstrap 95%
 * interval), then static/data/index.json listing the runs with their
 * headlines. It also copies docs/poetics-exploratory-programme.md into
 * static/programme.md so the cell serves the programme as it is in git.
 *
 * The contrasts are the questions the round was run to answer, fixed before
 * the data (see the programme doc). Anything else a reader wants is in the
 * trials.
 *
 * Every trial is RE-SCORED from its stored output first (the output is the
 * datum; the score is derived), so a change to lib/score.cjs reaches every
 * published number on the next aggregate, and the summary records which
 * scorer version produced it.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mean, sd, bootstrapDelta, round } = require('./lib/stats.cjs');
const { score, SCORER_VERSION } = require('./lib/score.cjs');

const here = dirname(fileURLToPath(import.meta.url));
const CELL = join(here, '..');
const STATIC = join(CELL, 'static');
const RUNS = join(STATIC, 'data', 'runs');
const REPO = join(CELL, '..', '..');

/** The pre-specified contrasts: [a, b, what a difference would mean]. */
const CONTRASTS = [
  ['plain', 'none', 'Does stating the intention help at all? (advice vs no advice)'],
  ['sigil', 'plain', 'Does the sigil form add to the same advice in prose?'],
  ['sigil', 'sigil-swap', 'Does the particular mark matter, or only the binding? (⊙ vs ⟁)'],
  ['decor', 'plain', 'Do meaningless symbols cost or help? (decoration control)'],
  ['compressed', 'plain', 'Does notation keep the obligations as well as prose?'],
  ['refrain', 'plain', 'Does cadence and recurrence add to prose?'],
  ['composite', 'plain', 'Do the forms combine without interfering?'],
  ['composite', 'sigil', 'Does adding arrows/precedence/indent to the sigil change anything?'],
];

const COMPONENTS = ['retention', 'noInvention', 'lengthOk', 'support', 'restraint', 'correction'];

function summarise(runDir) {
  const manifest = JSON.parse(readFileSync(join(runDir, 'manifest.json'), 'utf8'));
  const taskById = Object.fromEntries(manifest.tasks.map((t) => [t.id, t]));
  const trials = [];
  for (const f of readdirSync(runDir)) {
    if (!/^trials-.*\.json$/.test(f)) continue;
    const ts = JSON.parse(readFileSync(join(runDir, f), 'utf8'));
    for (const t of ts) {
      const task = taskById[t.task];
      if (!task || t.isError) continue;
      const s = score(task, t.output);
      t.score = s.score;
      t.components = s.components;
      t.detail = s.detail;
    }
    writeFileSync(join(runDir, f), JSON.stringify(ts, null, 1) + '\n');
    trials.push(...ts);
  }
  const conditions = manifest.conditions.map((c) => c.id);
  const families = [...new Set(manifest.tasks.map((t) => t.family))].sort();
  const ok = (t) => !t.isError;

  const byCondition = {};
  for (const c of conditions) {
    const ts = trials.filter((t) => t.condition === c);
    const good = ts.filter(ok);
    const scores = good.map((t) => t.score);
    const comp = {};
    for (const k of COMPONENTS) {
      const xs = good.map((t) => t.components && t.components[k]).filter((x) => typeof x === 'number');
      if (xs.length) comp[k] = { mean: round(mean(xs)), n: xs.length };
    }
    byCondition[c] = {
      n: ts.length,
      errors: ts.length - good.length,
      score: { mean: round(mean(scores)), sd: round(sd(scores)), min: round(Math.min(...scores)), max: round(Math.max(...scores)) },
      components: comp,
      inventionRate: round(mean(good.map((t) => (t.detail && Array.isArray(t.detail.inventions) ? (t.detail.inventions.length ? 1 : 0) : NaN)).filter(Number.isFinite))),
      inputTokens: round(mean(good.map((t) => (t.usage ? (t.usage.input || 0) + (t.usage.cacheCreation || 0) + (t.usage.cacheRead || 0) : NaN)).filter(Number.isFinite)), 0),
      outputTokens: round(mean(good.map((t) => (t.usage ? t.usage.output : NaN)).filter(Number.isFinite)), 0),
      costUsd: round(mean(good.map((t) => t.costUsd).filter(Number.isFinite)), 5),
      apiMs: round(mean(good.map((t) => t.apiMs).filter(Number.isFinite)), 0),
      models: [...new Set(good.map((t) => t.model).filter(Boolean))],
    };
  }

  const byConditionFamily = {};
  for (const c of conditions) {
    byConditionFamily[c] = {};
    for (const f of families) {
      const xs = trials.filter((t) => t.condition === c && t.family === f && ok(t)).map((t) => t.score);
      byConditionFamily[c][f] = { n: xs.length, mean: round(mean(xs)) };
    }
  }
  const byConditionTask = {};
  for (const c of conditions) {
    byConditionTask[c] = {};
    for (const t of manifest.tasks) {
      const xs = trials.filter((x) => x.condition === c && x.task === t.id && ok(x)).map((x) => x.score);
      byConditionTask[c][t.id] = { n: xs.length, mean: round(mean(xs)) };
    }
  }

  const contrasts = CONTRASTS.filter(([a, b]) => conditions.includes(a) && conditions.includes(b)).map(([a, b, question]) => {
    const A = trials.filter((t) => t.condition === a && ok(t)).map((t) => t.score);
    const B = trials.filter((t) => t.condition === b && ok(t)).map((t) => t.score);
    const all = bootstrapDelta(A, B);
    const perFamily = {};
    for (const f of families) {
      const Af = trials.filter((t) => t.condition === a && t.family === f && ok(t)).map((t) => t.score);
      const Bf = trials.filter((t) => t.condition === b && t.family === f && ok(t)).map((t) => t.score);
      perFamily[f] = bootstrapDelta(Af, Bf);
    }
    return { a, b, question, ...all, perFamily, clear: Number.isFinite(all.lo) && (all.lo > 0 || all.hi < 0) };
  });

  const summary = {
    id: manifest.id,
    scorerVersion: SCORER_VERSION,
    set: manifest.set,
    model: manifest.model,
    models: [...new Set(trials.map((t) => t.model).filter(Boolean))],
    placement: manifest.placement,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    reps: manifest.reps,
    n: trials.length,
    errors: trials.filter((t) => !ok(t)).length,
    costUsd: round(trials.reduce((a, t) => a + (t.costUsd || 0), 0), 4),
    conditions,
    families,
    tasks: manifest.tasks.map((t) => t.id),
    byCondition,
    byConditionFamily,
    byConditionTask,
    contrasts,
  };
  writeFileSync(join(runDir, 'summary.json'), JSON.stringify(summary, null, 1) + '\n');
  return summary;
}

function main() {
  const runs = existsSync(RUNS) ? readdirSync(RUNS).filter((d) => statSync(join(RUNS, d)).isDirectory() && existsSync(join(RUNS, d, 'manifest.json'))).sort() : [];
  const index = { generatedAt: new Date().toISOString(), runs: [] };
  for (const r of runs) {
    const s = summarise(join(RUNS, r));
    const ranked = Object.entries(s.byCondition).sort((a, b) => b[1].score.mean - a[1].score.mean);
    index.runs.push({
      id: s.id,
      set: s.set,
      model: s.model,
      models: s.models,
      placement: s.placement,
      createdAt: s.createdAt,
      n: s.n,
      errors: s.errors,
      costUsd: s.costUsd,
      conditions: s.conditions,
      best: ranked[0] ? { condition: ranked[0][0], mean: ranked[0][1].score.mean } : null,
      floor: s.byCondition.none ? s.byCondition.none.score.mean : null,
      plain: s.byCondition.plain ? s.byCondition.plain.score.mean : null,
      clearContrasts: s.contrasts.filter((c) => c.clear).map((c) => `${c.a}−${c.b} ${c.delta > 0 ? '+' : ''}${c.delta}`),
    });
    console.log(`${s.id}: n=${s.n} errors=${s.errors} $${s.costUsd} · ${ranked.map(([c, v]) => `${c} ${v.score.mean}`).join(' · ')}`);
  }
  writeFileSync(join(STATIC, 'data', 'index.json'), JSON.stringify(index, null, 1) + '\n');
  const programme = join(REPO, 'docs', 'poetics-exploratory-programme.md');
  if (existsSync(programme)) copyFileSync(programme, join(STATIC, 'programme.md'));
  console.log(`index: ${index.runs.length} run(s)`);
}

main();

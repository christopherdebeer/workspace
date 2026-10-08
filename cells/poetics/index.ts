import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { esc, frontmatter, markdown } from './md';

/**
 * `@c15r/poetics` — the poetics-of-instruction lab: specimens, the conditions under test, the
 * proxy tasks, every trial a round produced, and the analysis, as one public cell.
 *
 * The Lambda serves what is in this package and nothing else. All content under static/ is written
 * by the harness in git (cells/poetics/devtools/) and arrives by deploy; the cell computes nothing
 * at request time but HTML. Routes:
 *
 *   /                         the index: the proposition, the runs and their headlines, the materials
 *   /programme                the exploratory programme (docs/poetics-exploratory-programme.md, copied in)
 *   /specimen/<id>            an archived specimen, rendered, with its provenance
 *   /conditions/<set>         a condition set: every composition under test, with its role and note
 *   /task/<id>                a proxy task: the instruction, the source, what is scored
 *   /run/<id>                 a round's analysis: the reading (if written), per condition, per family/task, the contrasts
 *   /run/<id>/<condition>     every trial of one condition in that round: output, score, what was missed
 *   /data/…                   the raw JSON (index.json, runs/<id>/{manifest,summary,trials-*}.json)
 *   /_tools                   read tools for agents (slot 5): specimens · conditions · tasks · runs · run · trials
 *
 * git truth: cells/poetics/ (README.md).
 */

type Json = Record<string, unknown>;
const here = (rel: string) => join(__dirname, rel);
const read = (rel: string) => readFileSync(here(rel), 'utf8');
const exists = (rel: string) => existsSync(here(rel));
const readJson = <T = Json>(rel: string): T => JSON.parse(read(rel)) as T;
const SAFE = /^[A-Za-z0-9._-]+$/;

/* ── materials ──────────────────────────────────────────────────────── */

interface Specimen { id: string; title: string; meta: Record<string, string>; body: string }
interface Condition { id: string; role: string; note: string; text: string }
interface Task { id: string; family: string; cohort?: string; title?: string; instruction: string; source: string; checks: Json }
interface Stat { mean: number; sd?: number; min?: number; max?: number; n?: number }
interface ConditionSummary {
  n: number; errors: number; score: Stat; components: Record<string, Stat>; inventionRate: number;
  inputTokens: number; outputTokens: number; costUsd: number; apiMs: number; models: string[];
}
interface Delta { delta: number; lo: number; hi: number }
interface Contrast { a: string; b: string; question: string; delta: number; lo: number; hi: number; n: [number, number]; clear: boolean; perFamily: Record<string, Delta>; perCohort?: Record<string, Delta> }
interface Summary {
  id: string; scorerVersion?: number; set: string; model: string; models: string[]; placement: string; createdAt: string; updatedAt?: string; reps: number;
  n: number; errors: number; costUsd: number; costTotalUsd?: number; conditions: string[]; families: string[]; cohorts?: string[]; tasks: string[]; taskCohort?: Record<string, string>;
  byCondition: Record<string, ConditionSummary>;
  byConditionFamily: Record<string, Record<string, { n: number; mean: number }>>;
  byConditionTask: Record<string, Record<string, { n: number; mean: number }>>;
  contrasts: Contrast[];
}
interface Trial {
  id: string; condition: string; task: string; family: string; rep: number; model: string | null; output: string; isError: boolean; error?: string;
  usage: { input: number; cacheCreation: number; cacheRead: number; output: number } | null; costUsd: number | null; apiMs: number | null;
  score: number; components: Record<string, number>; detail: Json;
}
interface RunIndex { generatedAt: string; runs: Array<{ id: string; model: string; models: string[]; placement: string; createdAt: string; n: number; errors: number; costUsd: number; conditions: string[]; best: { condition: string; mean: number } | null; floor: number | null; plain: number | null; clearContrasts: string[]; clearHeldOut?: string[] }> }

function specimens(): Specimen[] {
  if (!exists('static/specimens')) return [];
  return readdirSync(here('static/specimens')).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const { meta, body } = frontmatter(read(`static/specimens/${f}`));
    const id = meta.id || f.replace(/\.md$/, '');
    return { id, title: meta.title || id, meta, body };
  });
}
function conditionSets(): string[] {
  return exists('static/conditions') ? readdirSync(here('static/conditions')).sort() : [];
}
function conditions(set: string): Condition[] {
  if (!SAFE.test(set) || !exists(`static/conditions/${set}`)) return [];
  return readdirSync(here(`static/conditions/${set}`)).filter((f) => f.endsWith('.md')).sort().map((f) => {
    const { meta, body } = frontmatter(read(`static/conditions/${set}/${f}`));
    return { id: meta.id || f.replace(/\.md$/, ''), role: meta.role || 'form', note: meta.note || '', text: body };
  });
}
function tasks(): Task[] {
  if (!exists('static/tasks')) return [];
  return readdirSync(here('static/tasks')).filter((f) => f.endsWith('.json')).sort().map((f) => readJson<Task>(`static/tasks/${f}`));
}
function runIndex(): RunIndex {
  return exists('static/data/index.json') ? readJson<RunIndex>('static/data/index.json') : { generatedAt: '', runs: [] };
}
function summary(run: string): Summary | null {
  return SAFE.test(run) && exists(`static/data/runs/${run}/summary.json`) ? readJson<Summary>(`static/data/runs/${run}/summary.json`) : null;
}
function reading(run: string): string | null {
  return SAFE.test(run) && exists(`static/data/runs/${run}/reading.md`) ? read(`static/data/runs/${run}/reading.md`) : null;
}
function trials(run: string, condition: string): Trial[] | null {
  return SAFE.test(run) && SAFE.test(condition) && exists(`static/data/runs/${run}/trials-${condition}.json`) ? readJson<Trial[]>(`static/data/runs/${run}/trials-${condition}.json`) : null;
}

/* ── the look ───────────────────────────────────────────────────────── */

const HEAD = (title: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="Poetics of instruction: specimens, compositions under test, proxy tasks, trials and analysis.">
<style>
  :root { --paper: #f6f3ec; --ink: #1c1a16; --soft: #6d675b; --rule: #1c1a16; --faint: #e6e1d5; --mark: #7a3b12; --good: #2f6b4f; --bad: #9a3a2a; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --paper: #13120f; --ink: #ebe6da; --soft: #978f80; --rule: #ebe6da; --faint: #26241f; --mark: #e0a070; --good: #8fd1ad; --bad: #f0a090; color-scheme: dark; } }
  :root[data-theme="dark"] { --paper: #13120f; --ink: #ebe6da; --soft: #978f80; --rule: #ebe6da; --faint: #26241f; --mark: #e0a070; --good: #8fd1ad; --bad: #f0a090; color-scheme: dark; }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.6 Georgia, "Iowan Old Style", "Palatino Linotype", serif; padding: max(16px, env(safe-area-inset-top)) 16px max(32px, env(safe-area-inset-bottom)); }
  a { color: inherit; text-underline-offset: 3px; }
  a:hover { color: var(--mark); }
  .mono, code, pre, table, .k { font: 13px/1.5 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; }
  header.bar, main, footer { max-width: 78ch; margin: 0 auto; }
  header.bar { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; border-bottom: 1px solid var(--rule); padding-bottom: 8px; flex-wrap: wrap; }
  header.bar a { text-decoration: none; }
  header.bar nav a { margin-left: 12px; color: var(--soft); }
  h1 { font-size: 24px; margin: 22px 0 6px; font-weight: normal; letter-spacing: -.01em; }
  h2 { font-size: 15px; margin: 34px 0 8px; padding-top: 10px; border-top: 1px solid var(--rule); text-transform: uppercase; letter-spacing: .08em; font-weight: normal; }
  h3, h4 { font-size: 15px; margin: 22px 0 6px; font-weight: normal; font-style: italic; }
  p, li { max-width: 78ch; }
  .muted { color: var(--soft); }
  .k { color: var(--soft); }
  code { background: var(--faint); padding: 0 .3ch; }
  pre { border: 1px solid var(--rule); padding: 10px 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
  pre code { background: none; padding: 0; }
  pre.comp { background: var(--faint); border-color: var(--faint); }
  blockquote { margin: 12px 0; padding: 0 0 0 14px; border-left: 2px solid var(--soft); color: var(--soft); }
  .scroll { overflow-x: auto; margin: 10px 0; }
  table { border-collapse: collapse; min-width: 100%; }
  th, td { border-bottom: 1px solid var(--faint); padding: 4px 8px; text-align: left; vertical-align: top; white-space: nowrap; }
  th { color: var(--soft); font-weight: normal; border-bottom: 1px solid var(--rule); }
  td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
  .good { color: var(--good); } .bad { color: var(--bad); }
  .bar-cell { position: relative; } .bar-cell span { position: absolute; left: 0; top: 50%; height: 60%; transform: translateY(-50%); background: var(--faint); z-index: -1; }
  .cards { display: grid; gap: 12px; grid-template-columns: 1fr; margin: 12px 0; }
  @media (min-width: 640px) { .cards { grid-template-columns: 1fr 1fr; } }
  .card { border: 1px solid var(--rule); padding: 10px 12px; }
  .card h3 { margin: 0 0 4px; font-style: normal; }
  .card p { margin: 4px 0; }
  .trial { border: 1px solid var(--rule); padding: 10px 12px; margin: 14px 0; }
  .trial .head { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .trial pre { margin: 8px 0 0; }
  details summary { cursor: pointer; color: var(--soft); }
  .tag { display: inline-block; border: 1px solid var(--soft); border-radius: 999px; padding: 0 .7ch; color: var(--soft); font-size: 12px; margin-left: 6px; vertical-align: middle; }
  footer { margin-top: 48px; padding-top: 10px; border-top: 1px solid var(--faint); color: var(--soft); font-size: 13px; }
</style>
</head>
<body>`;

const bar = (crumb = '') => `<header class="bar"><a href="/"><strong>poetics</strong></a>${crumb ? `<span class="muted">${crumb}</span>` : ''}<nav><a href="/programme">programme</a><a href="/#runs">runs</a><a href="/#materials">materials</a><a href="/_tools">tools</a></nav></header>`;
const FOOT = `<footer>@c15r/poetics · git truth cells/poetics/ · every number on these pages is recomputed from the committed trials by <code>devtools/aggregate.mjs</code>; the trials are fresh one-turn sessions of a small model, scored by a program. A round is a screen, not a confirmation.</footer></body></html>`;
const page = (title: string, crumb: string, body: string) => `${HEAD(title)}\n${bar(crumb)}\n<main>\n${body}\n</main>\n${FOOT}`;

const f3 = (x: number | undefined | null) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : '–');
const f2 = (x: number | undefined | null) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(2) : '–');
const int = (x: number | undefined | null) => (typeof x === 'number' && Number.isFinite(x) ? String(Math.round(x)) : '–');
const usd = (x: number | undefined | null) => (typeof x === 'number' && Number.isFinite(x) ? `$${x.toFixed(x < 0.01 ? 5 : 3)}` : '–');
const barCell = (x: number | undefined) => `<td class="n bar-cell"><span style="width:${Math.round((x ?? 0) * 100)}%"></span>${f3(x)}</td>`;
const signed = (x: number) => (x > 0 ? `+${f3(x)}` : f3(x));

/* ── pages ──────────────────────────────────────────────────────────── */

function indexPage(): string {
  const idx = runIndex();
  const sp = specimens();
  const sets = conditionSets();
  const ts = tasks();
  const runs = idx.runs.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const runRows = runs.map((r) => `<tr><td><a href="/run/${esc(r.id)}">${esc(r.id)}</a></td><td>${esc(r.models.join(', ') || r.model)}</td><td>${esc(r.placement)}</td><td class="n">${r.n}${r.errors ? ` <span class="bad">(${r.errors} err)</span>` : ''}</td><td class="n">${f3(r.floor)}</td><td class="n">${f3(r.plain)}</td><td>${r.best ? `${esc(r.best.condition)} <span class="k">${f3(r.best.mean)}</span>` : '–'}</td><td>${r.clearContrasts.length ? esc(r.clearContrasts.join(' · ')) : '<span class="muted">none</span>'}${r.clearHeldOut?.length ? `<br><span class="k">held out: ${esc(r.clearHeldOut.join(' · '))}</span>` : ''}</td><td class="n">${usd(r.costUsd)}</td></tr>`).join('');
  const famCount = ts.reduce<Record<string, number>>((m, t) => ((m[t.family] = (m[t.family] || 0) + 1), m), {});
  return page('poetics', '', `
<h1>Poetics of instruction</h1>
<p>Can the <em>form</em> of a prompt — a sigil, a refrain, a notation — carry an intention through a language model better than the same intention in plain prose? This cell holds the lab: the specimens the question came from, the compositions under test, the proxy tasks that score them, every trial, and the analysis. Nothing here is a claim yet. The <a href="/programme">programme</a> says what a result would look like.</p>
<p class="muted">Subject: a small model in a fresh one-turn session per trial, no tools, no prior context. Scored by a program (<code>devtools/lib/score.cjs</code>). The brief this follows is <code>docs/poetics-of-instruction.md</code> in the workspace repo.</p>

<h2 id="runs">Runs</h2>
${runs.length ? `<div class="scroll"><table><thead><tr><th>run</th><th>model</th><th>placement</th><th class="n">trials</th><th class="n">none</th><th class="n">plain</th><th>best</th><th>clear contrasts</th><th class="n">cost</th></tr></thead><tbody>${runRows}</tbody></table></div>
<p class="muted">none = the floor (task alone); plain = the intention in prose; best = the condition with the highest mean score. A contrast is clear when its bootstrap 95% interval excludes zero. Means are over all trials in the round; open a run for the per-family and per-task tables, which is where the real reading is.</p>` : '<p class="muted">No rounds yet. <code>node cells/poetics/devtools/run.mjs</code> runs one.</p>'}

<h2 id="materials">Materials</h2>
<div class="cards">
${sp.map((s) => `<article class="card"><h3><a href="/specimen/${esc(s.id)}">${esc(s.title)}</a><span class="tag">${esc(s.meta.kind || 'specimen')}</span></h3><p class="muted">${esc(s.meta.status || '')}</p></article>`).join('')}
${sets.map((s) => `<article class="card"><h3><a href="/conditions/${esc(s)}">${esc(s)}</a><span class="tag">conditions</span></h3><p class="muted">${conditions(s).length} compositions, content-matched; the floor, the baseline, the forms and the controls.</p></article>`).join('')}
<article class="card"><h3>Tasks<span class="tag">${ts.length}</span></h3><p class="muted">${Object.entries(famCount).map(([f, n]) => `${f} ×${n}`).join(' · ')}</p><p>${ts.map((t) => `<a href="/task/${esc(t.id)}">${esc(t.id)}</a>`).join(' · ')}</p></article>
</div>

<h2>Reading the lab</h2>
<ul>
<li>A <strong>specimen</strong> is a composition as found, with its provenance. It is archived, not executed.</li>
<li>A <strong>condition</strong> is a composition under test. In a set, every condition carries the same obligations; only the form differs. Controls (a symbol swap, meaningless decoration, no composition at all) sit beside the forms.</li>
<li>A <strong>task</strong> is a cheap text proxy for the obligations a specimen carries, with a deterministic scorer. Each family separates acting from abstaining, so excessive fallback cannot pass as fidelity.</li>
<li>A <strong>run</strong> is one round: every condition × every task × a few reps, interleaved, one model, one placement. Its summary is recomputed from its trials; its contrasts were fixed before the data.</li>
</ul>
<p>Agents: <a href="/_tools"><code>/_tools</code></a> lists read tools for all of this (<code>@c15r/poetics.runs</code>, <code>.run</code>, <code>.trials</code>, <code>.specimens</code>, <code>.conditions</code>, <code>.tasks</code>); <a href="/data/index.json"><code>/data/</code></a> is the raw JSON.</p>`);
}

function programmePage(): string {
  if (!exists('static/programme.md')) return page('programme', 'programme', '<h1>Programme</h1><p class="muted">Not copied in yet: <code>node cells/poetics/devtools/aggregate.mjs</code> copies docs/poetics-exploratory-programme.md here.</p>');
  const doc = markdown(frontmatter(read('static/programme.md')).body);
  return page(doc.title || 'programme', 'programme', doc.html);
}

function specimenPage(id: string): string | null {
  const s = specimens().find((x) => x.id === id);
  if (!s) return null;
  const meta = Object.entries(s.meta).filter(([k]) => k !== 'id' && k !== 'title');
  return page(s.title, `specimen · ${esc(s.id)}`, `<h1>${esc(s.title)}</h1>
<div class="scroll"><table><tbody>${meta.map(([k, v]) => `<tr><th>${esc(k)}</th><td style="white-space:normal">${esc(v)}</td></tr>`).join('')}</tbody></table></div>
${markdown(s.body).html}`);
}

function conditionsPage(set: string): string | null {
  const cs = conditions(set);
  if (!cs.length) return null;
  const order = ['floor', 'baseline', 'form', 'control'];
  cs.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.id.localeCompare(b.id));
  return page(set, `conditions · ${esc(set)}`, `<h1>${esc(set)}</h1>
<p>Every composition here carries the same obligations; what differs is the form. A reader comparing two should be able to see the shared content in each. The text shown is the exact system prompt a trial received (or, with user placement, the exact text prepended to its first turn).</p>
${cs.map((c) => `<h3 id="${esc(c.id)}">${esc(c.id)}<span class="tag">${esc(c.role)}</span></h3><p class="muted">${esc(c.note)}</p><pre class="comp">${esc(c.text)}</pre>`).join('')}`);
}

function taskPage(id: string): string | null {
  const t = tasks().find((x) => x.id === id);
  if (!t) return null;
  return page(t.id, `task · ${esc(t.id)}`, `<h1>${esc(t.title || t.id)}<span class="tag">${esc(t.family)}</span>${t.cohort ? `<span class="tag">${esc(t.cohort)}${t.cohort === 'r2' ? ' · held out' : ''}</span>` : ''}</h1>
<h3>Instruction</h3><pre>${esc(t.instruction)}</pre>
<h3>Source</h3><pre>${esc(t.source)}</pre>
<h3>What is scored</h3><pre>${esc(JSON.stringify(t.checks, null, 2))}</pre>
<p class="muted">The subject receives the instruction, a blank line, then the source, as one user turn. The checks are not shown to it.</p>`);
}

function runPage(id: string): string | null {
  const s = summary(id);
  if (!s) return null;
  const comps = ['retention', 'noInvention', 'lengthOk', 'support', 'restraint', 'correction'].filter((k) => s.conditions.some((c) => s.byCondition[c]?.components[k]));
  const order = s.conditions.slice().sort((a, b) => (s.byCondition[b]?.score.mean ?? 0) - (s.byCondition[a]?.score.mean ?? 0));
  const condRows = order.map((c) => {
    const b = s.byCondition[c];
    return `<tr><td><a href="/run/${esc(s.id)}/${esc(c)}">${esc(c)}</a></td><td class="n">${b.n}${b.errors ? ` <span class="bad">(${b.errors})</span>` : ''}</td>${barCell(b.score.mean)}<td class="n k">${f3(b.score.sd)}</td>${comps.map((k) => `<td class="n">${b.components[k] ? f2(b.components[k].mean) : '<span class="k">·</span>'}</td>`).join('')}<td class="n">${f2(b.inventionRate)}</td><td class="n k">${int(b.inputTokens)}</td><td class="n k">${int(b.outputTokens)}</td><td class="n k">${usd(b.costUsd)}</td></tr>`;
  }).join('');
  const famHead = s.families.map((f) => `<th class="n">${esc(f)}</th>`).join('');
  const famRows = order.map((c) => `<tr><td>${esc(c)}</td>${s.families.map((f) => barCell(s.byConditionFamily[c]?.[f]?.mean)).join('')}</tr>`).join('');
  const taskHead = s.tasks.map((t) => `<th class="n"><a href="/task/${esc(t)}">${esc(t)}</a>${s.taskCohort?.[t] === 'r2' ? '<span class="k"> ∗</span>' : ''}</th>`).join('');
  const taskRows = order.map((c) => `<tr><td>${esc(c)}</td>${s.tasks.map((t) => barCell(s.byConditionTask[c]?.[t]?.mean)).join('')}</tr>`).join('');
  const cohorts = (s.cohorts ?? []).length > 1 ? s.cohorts! : [];
  const dcell = (p: Delta | undefined) => { const clear = p && Number.isFinite(p.lo) && (p.lo > 0 || p.hi < 0); return `<td class="n ${clear ? (p!.delta > 0 ? 'good' : 'bad') : 'k'}">${p ? signed(p.delta) : '–'}</td>`; };
  const contrastRows = s.contrasts.map((k) => `<tr><td>${esc(k.a)} − ${esc(k.b)}</td><td class="n ${k.clear ? (k.delta > 0 ? 'good' : 'bad') : ''}">${signed(k.delta)}</td><td class="n k">[${f3(k.lo)}, ${f3(k.hi)}]</td>${cohorts.map((c) => dcell(k.perCohort?.[c])).join('')}${s.families.map((f) => dcell(k.perFamily[f])).join('')}<td style="white-space:normal" class="muted">${esc(k.question)}</td></tr>`).join('');
  const rd = reading(id);
  return page(s.id, `run · ${esc(s.id)}`, `<h1>${esc(s.id)}</h1>
<p class="muted">model ${esc(s.models.join(', ') || s.model)} · placement <strong>${esc(s.placement)}</strong> · set <a href="/conditions/${esc(s.set)}">${esc(s.set)}</a> · ${s.n} trials (${s.reps} reps × ${s.tasks.length} tasks × ${s.conditions.length} conditions)${s.errors ? ` · <span class="bad">${s.errors} errors</span>` : ''} · ${usd(s.costUsd)}${typeof s.costTotalUsd === 'number' && s.costTotalUsd !== s.costUsd ? ` subject (${usd(s.costTotalUsd)} with the CLI's auxiliary call)` : ''} · ${esc(s.createdAt.slice(0, 16).replace('T', ' '))}${s.scorerVersion ? ` · scorer v${s.scorerVersion}` : ''}</p>
${rd ? `<h2>Reading</h2>${markdown(frontmatter(rd).body).html}` : ''}

<h2>Contrasts</h2>
<p>Fixed before the round. Difference of mean score, with a seeded bootstrap 95% interval over trials; coloured when the interval excludes zero. Per-family columns are the same contrast within one task family (six trials a side, so read them as hints).</p>
<div class="scroll"><table><thead><tr><th>contrast</th><th class="n">Δ score</th><th class="n">95%</th>${cohorts.map((c) => `<th class="n">${esc(c)}${c === 'r2' ? ' (held out)' : ''}</th>`).join('')}${famHead}<th>question</th></tr></thead><tbody>${contrastRows}</tbody></table></div>${cohorts.length ? '<p class="muted">r1 are the tasks round one\'s conditions were read against; r2 were written afterwards and held out. A contrast that holds on r2 was not fitted to its tasks.</p>' : ''}

<h2>By condition</h2>
<div class="scroll"><table><thead><tr><th>condition</th><th class="n">n</th><th class="n">score</th><th class="n">sd</th>${comps.map((k) => `<th class="n">${esc(k)}</th>`).join('')}<th class="n">invented</th><th class="n">in tok</th><th class="n">out tok</th><th class="n">cost</th></tr></thead><tbody>${condRows}</tbody></table></div>
<p class="muted">Components are means where the family defines them (· where it does not). <em>invented</em> is the share of trials with at least one capitalised word or number not in the source. Input tokens include the composition: the price of a form sits beside its effect. Tokens are the subject model's where the runner could separate them; with a haiku subject the CLI's auxiliary haiku call merges into the same count and overstates it.</p>

<h2>By family</h2>
<div class="scroll"><table><thead><tr><th>condition</th>${famHead}</tr></thead><tbody>${famRows}</tbody></table></div>

<h2>By task</h2>
<div class="scroll"><table><thead><tr><th>condition</th>${taskHead}</tr></thead><tbody>${taskRows}</tbody></table></div>
<p class="muted">Each cell is ${s.reps} trials${cohorts.length ? '; ∗ marks a held-out (r2) task' : ''}. Open a condition above to read every output and what the scorer missed in it. Raw: <a href="/data/runs/${esc(s.id)}/summary.json">summary.json</a> · <a href="/data/runs/${esc(s.id)}/manifest.json">manifest.json</a> (the exact text of every condition and task).</p>`);
}

function trialsPage(run: string, condition: string): string | null {
  const s = summary(run);
  const ts = trials(run, condition);
  if (!s || !ts) return null;
  const cond = (() => { try { return readJson<{ conditions: Condition[] }>(`static/data/runs/${run}/manifest.json`).conditions.find((c) => c.id === condition); } catch { return undefined; } })();
  const sorted = ts.slice().sort((a, b) => a.task.localeCompare(b.task) || a.rep - b.rep);
  const detail = (t: Trial) => {
    const d = t.detail as { missing?: string[]; inventions?: string[]; gaps?: Array<{ n: number; want: string; got: string | null; ok: boolean }>; lines?: Array<{ role: string; want: string; got: string | null; ok: boolean }>; words?: number; maxWords?: number };
    const bits: string[] = [];
    if (d.missing?.length) bits.push(`<span class="bad">missing:</span> ${d.missing.map(esc).join(', ')}`);
    if (d.inventions?.length) bits.push(`<span class="bad">invented:</span> ${d.inventions.map(esc).join(', ')}`);
    if (typeof d.words === 'number') bits.push(`words ${d.words}${d.maxWords ? ` / ${d.maxWords}` : ''}`);
    if (d.gaps) bits.push(d.gaps.map((g) => `<span class="${g.ok ? 'good' : 'bad'}">gap ${g.n}</span> ${esc(g.got ?? '∅')}${g.ok ? '' : ` <span class="k">(want ${esc(g.want)})</span>`}`).join(' · '));
    if (d.lines) bits.push(d.lines.map((l, i) => `<span class="${l.ok ? 'good' : 'bad'}">${esc(l.role)} ${i + 1}</span>`).join(' '));
    return bits.length ? `<p class="mono">${bits.join('<br>')}</p>` : '';
  };
  return page(`${run} · ${condition}`, `<a href="/run/${esc(run)}">${esc(run)}</a> · ${esc(condition)}`, `<h1>${esc(condition)} <span class="muted">in ${esc(run)}</span></h1>
${cond ? `<p class="muted">${esc(cond.note)}</p><pre class="comp">${esc(cond.text)}</pre>` : ''}
<p class="muted">${sorted.length} trials · mean ${f3(s.byCondition[condition]?.score.mean)} · each is a fresh session; the output is shown as returned, the scorer's reading beneath it.</p>
${sorted.map((t) => `<article class="trial"><div class="head"><span><a href="/task/${esc(t.task)}">${esc(t.task)}</a> <span class="k">rep ${t.rep}</span></span><span class="mono ${t.isError ? 'bad' : ''}">${t.isError ? 'error' : `score ${f3(t.score)}`} · ${esc(t.model || '–')} · ${t.apiMs ?? '–'} ms · ${usd(t.costUsd)}</span></div>
<p class="mono k">${Object.entries(t.components).map(([k, v]) => `${esc(k)} ${f2(v)}`).join(' · ')}</p>
${t.isError ? `<pre class="bad">${esc(t.error || 'error')}</pre>` : `<pre>${esc(t.output)}</pre>`}
${detail(t)}</article>`).join('')}`);
}

/* ── tools (slot 5) ─────────────────────────────────────────────────── */

const TOOLS = [
  { name: 'specimens', kind: 'read', description: 'The archived specimens: id, title, provenance and status, with the full text.', inputSchema: { type: 'object', properties: {} } },
  { name: 'conditions', kind: 'read', description: 'A condition set: every composition under test with its role (floor/baseline/form/control), note and exact text.', inputSchema: { type: 'object', properties: { set: { type: 'string', description: 'default: source-authority-v1' } } } },
  { name: 'tasks', kind: 'read', description: 'The proxy tasks: family, instruction, source and the checks the scorer applies.', inputSchema: { type: 'object', properties: {} } },
  { name: 'runs', kind: 'read', description: 'Every round with its headline: model, placement, trials, the floor and plain means, the best condition, and which pre-specified contrasts came out clear.', inputSchema: { type: 'object', properties: {} } },
  { name: 'run', kind: 'read', description: "One round's summary: per condition (score, components, tokens, cost), per condition × family and × task, and the contrasts with bootstrap intervals.", inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'trials', kind: 'read', description: 'Every trial of one condition in a round: output, score, components, and what the scorer missed.', inputSchema: { type: 'object', properties: { run: { type: 'string' }, condition: { type: 'string' } }, required: ['run', 'condition'] } },
];

function tool(name: string, args: Json): { statusCode: number; body: unknown } {
  const str = (k: string, d = '') => (typeof args[k] === 'string' ? (args[k] as string) : d);
  switch (name) {
    case 'specimens': return { statusCode: 200, body: { specimens: specimens().map((s) => ({ id: s.id, title: s.title, ...s.meta, text: s.body })) } };
    case 'conditions': { const set = str('set', 'source-authority-v1'); const cs = conditions(set); return cs.length ? { statusCode: 200, body: { set, conditions: cs } } : { statusCode: 404, body: { error: `no condition set "${set}"`, sets: conditionSets() } }; }
    case 'tasks': return { statusCode: 200, body: { tasks: tasks() } };
    case 'runs': return { statusCode: 200, body: runIndex() };
    case 'run': { const s = summary(str('id')); return s ? { statusCode: 200, body: s } : { statusCode: 404, body: { error: 'no such run', runs: runIndex().runs.map((r) => r.id) } }; }
    case 'trials': { const ts = trials(str('run'), str('condition')); return ts ? { statusCode: 200, body: { run: str('run'), condition: str('condition'), trials: ts } } : { statusCode: 404, body: { error: 'no such run/condition' } }; }
    default: return { statusCode: 404, body: { error: `no tool "${name}"`, tools: TOOLS.map((t) => t.name) } };
  }
}

/* ── handler ────────────────────────────────────────────────────────── */

const res = (statusCode: number, type: string, body: string, cache = 'no-cache') => ({ statusCode, headers: { 'content-type': type, 'cache-control': cache }, body });
const html = (body: string | null, status = 200) => (body === null ? res(404, 'text/html; charset=utf-8', page('not here', '', '<h1>Not here</h1><p>Nothing at this address. The lab is at <a href="/">/</a>.</p>')) : res(status, 'text/html; charset=utf-8', body));
const json = (statusCode: number, body: unknown) => res(statusCode, 'application/json; charset=utf-8', JSON.stringify(body));

export const handler = async (event: { rawPath?: string; requestContext?: { http?: { method?: string } }; body?: string }) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = ((event.rawPath ?? '/').replace(/^\/@[^/]+\/poetics(?=\/|$)/, '') || '/').replace(/\/+$/, '') || '/';
  try {
    if (method === 'GET' && path === '/_tools') return json(200, { cell: '@c15r/poetics', tools: TOOLS });
    if (method === 'POST' && path.startsWith('/_tools/')) {
      let args: Json = {};
      try { args = event.body ? (JSON.parse(event.body) as Json) : {}; } catch { return json(400, { error: 'invalid JSON body' }); }
      const { statusCode, body } = tool(path.slice('/_tools/'.length), args);
      return json(statusCode, body);
    }
    if (method !== 'GET' && method !== 'HEAD') return json(405, { error: 'read-only' });
    if (path === '/' || path === '/index.html') return html(indexPage());
    if (path === '/programme') return html(programmePage());
    if (path.startsWith('/data/')) {
      const rel = path.slice('/data/'.length);
      if (!rel.split('/').every((seg) => SAFE.test(seg)) || !rel.endsWith('.json') || !exists(`static/data/${rel}`)) return json(404, { error: 'no such data file' });
      return res(200, 'application/json; charset=utf-8', read(`static/data/${rel}`));
    }
    let m: RegExpExecArray | null;
    if ((m = /^\/specimen\/([A-Za-z0-9._-]+)$/.exec(path))) return html(specimenPage(m[1]));
    if ((m = /^\/conditions\/([A-Za-z0-9._-]+)$/.exec(path))) return html(conditionsPage(m[1]));
    if (path === '/conditions') { const sets = conditionSets(); return sets.length ? { statusCode: 302, headers: { location: `/conditions/${sets[0]}` }, body: '' } : html(null); }
    if ((m = /^\/task\/([A-Za-z0-9._-]+)$/.exec(path))) return html(taskPage(m[1]));
    if ((m = /^\/run\/([A-Za-z0-9._-]+)$/.exec(path))) return html(runPage(m[1]));
    if ((m = /^\/run\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(path))) return html(trialsPage(m[1], m[2]));
    return html(null);
  } catch (err) {
    return res(500, 'text/plain; charset=utf-8', `poetics: ${(err as Error).message}`, 'no-store');
  }
};

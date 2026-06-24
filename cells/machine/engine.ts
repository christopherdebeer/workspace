/**
 * @c15r/machine — the pure execution core (functional core / imperative shell).
 *
 * Everything here is PURE: no AWS, no I/O, no `emit`, no React, no env. It is the
 * single source of truth for how a machine maps to substrate vocabulary and how a
 * run advances — `index.ts` is the thin shell that routes HTTP and applies these
 * results via the organ path. Being pure makes this the unit-tested core
 * (`tests/machine-engine.test.ts`); the lost-field / missing-child / barrier bugs
 * that bit in live runs are exactly the class a tested reducer catches.
 *
 * Why a generator rather than an in-memory interpreter (e.g. XState, like canvas'
 * gesture machine): a run's state lives in substrate FACTS and advances via
 * independent, stateless Lambda reactions — there is no durable host to hold an
 * interpreter between events. The core PROJECTS the machine to declared actions +
 * `deliver` subscriptions and computes the deterministic writes the cell emits.
 *
 * NB: a cell CAN read the substrate directly (a scoped DDB read; @c15r/models does
 * this) — the earlier note here that it "cannot" was wrong (see ADR-0017). The
 * stateless `step()` below is the consequence: it advances the deterministic `auto`
 * prefix IN-PROCESS (pure, CEL-guarded, no per-hop fact-write) and yields only at the
 * non-deterministic rails — see ADR-0018. See docs/machine.md (the canonical design doc).
 */

import { evaluate as celEvaluate } from '@marcbachmann/cel-js';

/** DyGram's relationship arrows → substrate edge relations (faithful to DyGram's
 *  arrow semantics). These are the *relationship* rels — rail *execution* mode is
 *  a separate, substrate-only concept (`railsFrom`). */
export const ARROW_RELS = {
  '->': 'flows-to',
  '-->': 'depends-on',
  '=>': 'causes',
  '<|--': 'inherits',
  '*-->': 'composes',
  'o-->': 'aggregates',
  '<-->': 'relates',
};

/** A safe `_actions/` / key id segment — ids must not contain "/". */
export const seg = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * Rails from arrows (when not declared explicitly). This arrow→mode mapping is a
 * substrate-only design choice, NOT a DyGram port: DyGram has no rail-mode enum
 * and infers auto-vs-agent from node-type/out-degree/annotations (its `=>` is
 * causation *styling*). We make mode explicit: `->` auto, `=>` agent, `~>` task,
 * `~>>` work (the last two our own rail arrows). See docs/machine.md.
 */
export function railsFrom(arrows, explicit) {
  if (Array.isArray(explicit) && explicit.length) {
    return explicit.map((r) => ({
      from: r.from,
      to: r.to,
      mode: ['agent', 'task', 'work', 'section', 'vote', 'catch', 'wait'].includes(r.mode) ? r.mode : 'auto',
      ...(r.condition ? { condition: r.condition } : {}),
      // Progressive disclosure (Agent-Skills Level-1): a one-line "when to use
      // this branch" descriptor surfaced to the decider without the full body.
      ...(r.when ? { when: r.when } : {}),
      // A `work` rail SPAWNS an agent — it carries the brief the spawned
      // @owner/models.agent runs with. (`task` parks a claimable hand-off.)
      ...(r.prompt ? { prompt: r.prompt } : {}),
      ...(r.grants ? { grants: r.grants } : {}),
      ...(typeof r.maxTurns === 'number' ? { maxTurns: r.maxTurns } : {}),
      // Soft per-step wall-clock budget (ms) — bounds a work agent below the
      // models cell's Lambda ceiling (see cells/models AGENT_BUDGET_MS).
      ...(typeof r.maxMs === 'number' ? { maxMs: r.maxMs } : {}),
      // A `wait` rail's duration ("30s"/"5m"/"1h"/"2d" or ms) — the stepper parks
      // the run for this long (an internal deadline) before taking the rail.
      ...(r.for !== undefined ? { for: r.for } : {}),
      // The agent's tool allowlist (docs/machine.md).
      ...(Array.isArray(r.tools) ? { tools: r.tools } : {}),
      ...(r.scope ? { scope: r.scope } : {}),
      // Parallel-branching config: section → `sections` [{to, when?}] then synthesise
      // to `to` (join); vote → `branch` sampled `samples`× then consensus to `to`.
      ...(Array.isArray(r.sections) ? { sections: r.sections } : {}),
      ...(r.branch ? { branch: r.branch } : {}),
      ...(typeof r.samples === 'number' ? { samples: r.samples } : {}),
      // Optional extra instruction for the join agent's synthesis/tally step —
      // e.g. where the branch findings live and how to combine them.
      ...(r.synthesis ? { synthesis: r.synthesis } : {}),
    }));
  }
  const rails = [];
  for (const e of arrows) {
    if (e.arrow === '->') rails.push({ from: e.from, to: e.to, mode: 'auto' });
    else if (e.arrow === '=>') rails.push({ from: e.from, to: e.to, mode: 'agent' });
    else if (e.arrow === '~>') rails.push({ from: e.from, to: e.to, mode: 'task' });
    else if (e.arrow === '~>>') rails.push({ from: e.from, to: e.to, mode: 'work' });
  }
  return rails;
}

/** Number of samples a vote rail fans out (clamped 2..7). */
export const voteCount = (r) => Math.max(2, Math.min(7, r.samples || 3));

/** Parse a `wait` rail's `for` into milliseconds: a number is ms; a string is
 *  `<n><unit>` with unit ms|s|m|h|d (default ms). Unparseable → 0 (no wait). */
export function durationMs(d) {
  if (typeof d === 'number') return Number.isFinite(d) && d > 0 ? d : 0;
  const m = /^\s*(\d+)\s*(ms|s|m|h|d)?\s*$/.exec(String(d ?? ''));
  if (!m) return 0;
  return Number(m[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2] || 'ms']);
}

/**
 * Keys nest under the machine's namespace so a whole machine — identity, nodes,
 * rails, runs, claims — lists/deletes by one `machine/<name>/` prefix. The rail
 * key encodes from→to with `~` (a separator `seg` strips, so it's unambiguous);
 * the `machine-rail` type's keyEdges rule projects it into a node→node graph edge
 * (ADR-0003/0016) — see types.json. The identity is the bare `machine/<name>`.
 */
export const mkey = {
  machine: (m) => `machine/${seg(m)}`,
  node: (m, n) => `machine/${seg(m)}/node/${seg(n)}`,
  rail: (m, from, to) => `machine/${seg(m)}/rail/${seg(from)}~${seg(to)}`,
  run: (m, run) => `machine/${seg(m)}/run/${run}`,
  claim: (m, run, at) => `machine/${seg(m)}/run/${run}/claim/${seg(at)}`,
  trigger: (m, run) => `machine/${seg(m)}/trigger/${run}`,
};

/** The entry node: the first with no incoming rail (or the first node). */
export const entryOf = (nodes, rails) => {
  const hasIn = (node) => rails.some((r) => r.to === node);
  return (nodes.find((n) => !hasIn(n.name)) ?? nodes[0])?.name;
};

/**
 * Assemble the in-memory `{ name, title, entry, nodes, rails }` the pure engine
 * consumes from the DECOMPOSED facts the substrate stores: the `machine/<name>`
 * identity + its `machine-node/*` + `machine-rail/*` facts (each `{key,value}` or
 * a bare value). The decomposition is the storage shape; this is the assembly the
 * stepper/projection run on — so the rest of the core is unchanged. Pure.
 */
export function assembleMachine(identity, nodeFacts, railFacts) {
  const idv = (identity && identity.value) || identity || {};
  const nodes = (nodeFacts || []).map((f) => {
    const v = (f && f.value) || f || {};
    return { name: v.name, ...(v.title ? { title: v.title } : {}), ...(v.kind ? { kind: v.kind } : {}) };
  });
  const rails = railsFrom([], (railFacts || []).map((f) => (f && f.value) || f));
  return { name: idv.name ?? idv.title, title: idv.title ?? idv.name, entry: idv.entry ?? entryOf(nodes, rails), nodes, rails };
}

/**
 * The fan of organ writes that DEFINES a machine in decomposed form: the identity
 * fact + one `machine-node` fact per node + one `machine-rail` fact per rail. The
 * shell emits each through the organ path (precedent: spawnChildrenWrites). Pure.
 */
export function decomposeWrites(name, nodes, rails, extra) {
  const tags = ['machine', `machine:${name}`];
  const writes = [
    {
      key: mkey.machine(name),
      value: { title: (extra && extra.title) || name, entry: entryOf(nodes, rails), ...(extra && extra.kind ? { kind: extra.kind } : {}), ...(extra && extra.source ? { source: extra.source } : {}) },
      type: 'machine',
      tags: [...tags, 'dygram'],
    },
  ];
  for (const n of nodes) {
    writes.push({
      key: mkey.node(name, n.name),
      value: { machine: name, name: n.name, ...(n.title ? { title: n.title } : {}), ...(n.kind ? { kind: n.kind } : {}) },
      type: 'machine-node',
      tags,
    });
  }
  for (const r of rails) {
    writes.push({ key: mkey.rail(name, r.from, r.to), value: { machine: name, ...r }, type: 'machine-rail', tags });
  }
  return writes;
}

/**
 * Static analysis over a machine's rail graph — the DyGram-style structural
 * checks our projection otherwise skips. Pure / no I/O. Errors are breakages (a
 * run can't start, a rail points nowhere); warnings are smells (unreachable,
 * orphan, cycle, no terminal). section/vote SPAWN their branch targets, so those
 * implied edges are followed for reachability.
 */
export function validateMachine(nodes, rails) {
  const names = new Set((nodes || []).map((n) => n && n.name).filter(Boolean));
  const errors = [];
  const warnings = [];

  for (const r of rails) {
    if (r.from && !names.has(r.from)) errors.push({ code: 'dangling-rail', message: `rail "${r.from}" → "${r.to}": no node named "${r.from}"` });
    if (r.to && !names.has(r.to)) errors.push({ code: 'dangling-rail', message: `rail "${r.from}" → "${r.to}": no node named "${r.to}"` });
  }

  const adj = new Map();
  const indeg = new Map();
  for (const n of names) { adj.set(n, []); indeg.set(n, 0); }
  const link = (from, to) => { if (names.has(from) && names.has(to)) { adj.get(from).push(to); indeg.set(to, indeg.get(to) + 1); } };
  for (const r of rails) {
    link(r.from, r.to);
    if (r.mode === 'section') for (const s of r.sections || []) link(r.from, s.to);
    if (r.mode === 'vote' && r.branch) link(r.from, r.branch);
  }
  const entries = [...names].filter((n) => indeg.get(n) === 0);
  const terminals = [...names].filter((n) => adj.get(n).length === 0);

  const seen = new Set();
  const stack = [...entries];
  while (stack.length) { const n = stack.pop(); if (seen.has(n)) continue; seen.add(n); for (const m of adj.get(n)) stack.push(m); }
  for (const n of names) if (!seen.has(n)) warnings.push({ code: 'unreachable', message: `node "${n}" is unreachable from any entry` });

  const touched = new Set();
  for (const r of rails) {
    if (names.has(r.from)) touched.add(r.from);
    if (names.has(r.to)) touched.add(r.to);
    if (r.mode === 'section') for (const s of r.sections || []) if (names.has(s.to)) touched.add(s.to);
    if (r.mode === 'vote' && names.has(r.branch)) touched.add(r.branch);
  }
  for (const n of names) if (!touched.has(n) && names.size > 1) warnings.push({ code: 'orphan', message: `node "${n}" has no rails (unreachable by execution)` });

  const color = new Map();
  const cycles = [];
  const dfs = (n, path) => {
    color.set(n, 1);
    for (const m of adj.get(n)) {
      if (color.get(m) === 1) cycles.push([...path, n, m].join(' → '));
      else if (!color.get(m)) dfs(m, [...path, n]);
    }
    color.set(n, 2);
  };
  for (const n of names) if (!color.get(n)) dfs(n, []);
  for (const c of cycles) warnings.push({ code: 'cycle', message: `transition cycle ${c} — a reactive machine could loop; add a condition/guard` });

  if (names.size && entries.length === 0) errors.push({ code: 'no-entry', message: 'no entry node (every node has an incoming rail) — a run cannot start' });
  if (names.size && terminals.length === 0) warnings.push({ code: 'no-terminal', message: 'no terminal node (every node has an outgoing rail) — a run never reaches done' });

  return { ok: errors.length === 0, errors, warnings, stats: { nodes: names.size, rails: rails.length, entries, terminals, cyclic: cycles.length > 0 } };
}

/**
 * The declared actions a machine needs in the STEPPER model (ADR-0018): just two
 * kinds — `start` (seed a run at the entry; the itrigger/trigger subscriptions and
 * the trigger_run tool invoke it) and `decide-<from>` per agent/task node (the
 * model records its chosen branch as a claim and advances; the run change then
 * re-triggers `step`). The per-auto-rail advance actions are GONE — `step` walks
 * the deterministic prefix in-process. Run/claim keys nest under `machine/<name>/`.
 */
export function projectActions(name, nodes, rails) {
  const m = seg(name);
  const runKey = mkey.run(name, '${params.run}');
  const tags = ['machine', `machine:${name}`];
  const hasOut = (node) => rails.some((r) => r.from === node);
  const entry = entryOf(nodes, rails);
  const actions = [];

  if (entry) {
    actions.push({
      id: `machine.${m}.start`,
      description: `Start a run of "${name}" at ${entry}. Optional \`text\` is the trigger-context body (a Claude-Routine-style payload) stored on the run so the entry node's agent sees it.`,
      params: {
        run: { type: 'string', required: true, description: `Run id → ${mkey.run(name, '<run>')}` },
        text: { type: 'string', required: false, description: 'Trigger context body — visible to the entry agent' },
      },
      writes: [{ key: runKey, value: { machine: name, node: entry, status: 'running', startedAt: '${now}', text: '${params.text}' }, type: 'machine-run', tags, ifAbsent: true }],
    });
  }

  const isDecision = (x) => x.mode === 'agent' || x.mode === 'task';
  for (const from of [...new Set(rails.filter(isDecision).map((x) => x.from))]) {
    const branchRails = rails.filter((x) => isDecision(x) && x.from === from);
    const branches = branchRails.map((x) => x.to);
    const menu = branchRails.map((x) => (x.when ? `${x.to} — ${x.when}` : x.to)).join('; ');
    const decisionStatus = branches.every((b) => !hasOut(b)) ? 'done' : 'running';
    actions.push({
      id: `machine.${m}.decide-${seg(from)}`,
      description: `Decision at ${from}: record the chosen branch as a claim and advance. Branches: ${menu}.`,
      params: {
        run: { type: 'string', required: true },
        to: { type: 'string', required: true, enum: branches, description: 'The chosen branch' },
        statement: { type: 'string', description: 'Why this branch — becomes the claim' },
        confidence: { type: 'number', description: 'Calibrated belief 0..1' },
      },
      if: [{ key: runKey, path: 'node', op: 'eq', value: from }],
      writes: [
        { key: mkey.claim(name, '${params.run}', from), value: { statement: '${params.statement}', confidence: '${params.confidence}', machine: name, at: from, chose: '${params.to}' }, type: 'claim', tags: ['claim', 'machine', 'dygram'] },
        { key: runKey, value: { machine: name, node: '${params.to}', status: decisionStatus, at: '${now}', via: `${from}=>decision` }, type: 'machine-run', tags },
      ],
    });
  }
  return actions;
}

/**
 * The subscriptions a machine needs in the STEPPER model (ADR-0018) — far fewer
 * than the old per-rail projection, and with ONE model primitive (an agent):
 *  - ONE `step` subscription: every run change delivers to @owner/machine.step,
 *    which walks the deterministic prefix in-process, spawns section/vote children,
 *    and runs the join barrier. Replaces all the auto-rail invokes + fan + join.
 *  - one DECIDE deliver per AGENT node → @owner/models.agent: a decide is just an
 *    agent with a FIXED choice set — the cell builds the branch menu + write
 *    template, the agent records the claim + advances. No bespoke models.decide;
 *    `models` stays generic (it never reads a machine).
 *  - one WORK deliver per WORK node → @owner/models.agent (open tool-loop).
 *  - a `task` node gets NO model delivery — it parks for a human, who drives it
 *    via the projected `decide-<from>` action (the open-tasks queue).
 * `context` keys (from the machine identity) are surfaced to the decider. Run +
 * claim keys nest under `machine/<name>/run/`, so a single write grant covers both.
 */
export function projectSubscriptions(name, rails, owner, context) {
  const m = seg(name);
  const runPrefix = `machine/${m}/run/`;
  const subs = [projectStepSubscription(name, owner)];
  const tags = (kind) => ['machine', `machine:${name}`, kind];
  const ctx = Array.isArray(context) && context.length
    ? `First read these context facts for grounding: ${context.join(', ')}.\n\n`
    : '';

  for (const from of [...new Set(rails.filter((x) => x.mode === 'agent').map((x) => x.from))]) {
    const branches = rails.filter((x) => x.mode === 'agent' && x.from === from);
    const menu = branches.map((b) => (b.when ? `- ${b.to} — when ${b.when}` : `- ${b.to}`)).join('\n');
    // The decision's real-tool allowlist (for assessment) + write scope (the branch
    // rails' scope.write, e.g. a weave repair) UNION the run namespace (claim/advance).
    const branchTools = [...new Set(branches.flatMap((b) => (Array.isArray(b.tools) ? b.tools : [])))];
    const branchWrite = [...new Set(branches.flatMap((b) => (b.scope && Array.isArray(b.scope.write) ? b.scope.write : [])))];
    const claimKey = `machine/${m}/run/\${keySuffix}/claim/${seg(from)}`;
    const runKeyTpl = `machine/${m}/run/\${keySuffix}`;
    const prompt =
      `Decide at node "${from}" of machine ${JSON.stringify(name)} (run \${keySuffix}). ${ctx}` +
      `First substrate_read "${runKeyTpl}" (you'll need its current \`trace\` array). Then choose exactly ONE branch:\n${menu}\n\n` +
      `1) Record your reasoning as a CLAIM — write "${claimKey}" = {"statement":"<why, one sentence>","confidence":<0..1>,"chose":"<the chosen branch>","at":${JSON.stringify(from)},"machine":${JSON.stringify(name)}} (type claim, tags ["claim","machine","dygram"]).\n` +
      `2) ADVANCE the run — write "${runKeyTpl}" back UNCHANGED except: "node":"<the chosen branch>", "status":"running", "via":${JSON.stringify(`${from}=>decision`)}, and APPEND {"node":"<the chosen branch>","via":${JSON.stringify(`${from}=>decision`)}} to its existing \`trace\` array (keep all prior trace entries). type machine-run, tags ["machine",${JSON.stringify(`machine:${name}`)}]. The stepper settles terminality from there.`;
    subs.push({
      id: `machine.${m}.decide-${seg(from)}`,
      match: { keyPrefix: runPrefix, cel: `value.node == ${JSON.stringify(from)} && value.status == "running"` },
      deliver: `@${owner}/models.agent`,
      params: {
        prompt,
        grants: { read: true, write: [runPrefix, ...branchWrite] },
        ...(branchTools.length ? { tools: branchTools } : {}),
        maxTurns: 5,
        factKey: `machine/${m}/decide/\${keySuffix}`,
        tags: tags('decide'),
        // Catch: if the decide agent hard-fails (provider down, budget), mark the
        // run failed at this node so a `catch` rail can route it (else it parks).
        onError: { key: `machine/${m}/run/\${keySuffix}`, value: { machine: name, node: from, status: 'failed', via: `${from}!!error` }, type: 'machine-run', tags: tags('decide') },
      },
    });
  }
  for (const r of rails.filter((x) => x.mode === 'work')) {
    const runKeyTpl = `machine/${m}/run/\${keySuffix}`;
    const advance = `When the work is complete, advance the run by writing fact "${runKeyTpl}" = {"machine":${JSON.stringify(name)},"node":${JSON.stringify(r.to)},"status":"done","via":${JSON.stringify(`${r.from}~>>work`)}} (type machine-run, tags ["machine",${JSON.stringify(`machine:${name}`)}]).`;
    const prompt = (r.prompt ? `${r.prompt}\n\n` : `Do the work for node "${r.from}" of machine "${name}", run \${keySuffix}.\n\n`) + advance;
    subs.push({
      id: `machine.${m}.work-${seg(r.from)}`,
      match: { keyPrefix: runPrefix, cel: `value.node == ${JSON.stringify(r.from)} && value.status == "running"` },
      deliver: `@${owner}/models.agent`,
      params: {
        prompt,
        grants: r.grants ?? { read: true, write: [runPrefix] },
        ...(Array.isArray(r.tools) ? { tools: r.tools } : {}),
        ...(typeof r.maxTurns === 'number' ? { maxTurns: r.maxTurns } : {}),
        ...(typeof r.maxMs === 'number' ? { maxMs: r.maxMs } : {}),
        factKey: `machine/${m}/work/\${keySuffix}`,
        tags: ['machine', `machine:${name}`, 'work'],
        // Catch: a hard-failed or budget-exhausted work agent marks the run failed
        // at this node so a `catch` rail recovers it (else the run parks here).
        onError: { key: runKeyTpl, value: { machine: name, node: r.from, status: 'failed', via: `${r.from}!!error` }, type: 'machine-run', tags: ['machine', `machine:${name}`] },
      },
    });
  }
  return subs;
}

/**
 * The deterministic writes a section/vote fan emits — the parent's wait-state
 * plus ONE child run per branch (each its own organ write, so each reliably
 * re-triggers its work/decide delivery). Pure: the shell passes `at` and emits
 * each returned write through the organ path.
 */
export function spawnChildrenWrites(run, machine, spec, at) {
  const tags = ['machine', `machine:${machine}`];
  const isVote = spec.kind === 'vote';
  const base = mkey.run(machine, run);
  const parent = {
    key: base,
    value: { machine, node: spec.node, status: isVote ? 'voting' : 'sectioning', join: spec.join, via: `${spec.node}~fan`, at },
    type: 'machine-run',
    tags,
  };
  const children = [];
  if (isVote) {
    const k = Math.max(2, Math.min(7, spec.samples || 3));
    parent.value.count = k; // expected sibling count — the barrier waits for it
    for (let i = 0; i < k; i++) {
      children.push({
        key: `${base}#${i}`,
        value: { machine, node: spec.branch, parent: run, kind: 'vote', status: 'running', at },
        type: 'machine-run',
        tags: [...tags, 'parallel-child'],
      });
    }
  } else {
    parent.value.count = (spec.branches || []).length; // expected siblings
    for (const t of spec.branches || []) {
      children.push({
        key: `${base}§${seg(t)}`,
        value: { machine, node: t, parent: run, kind: 'section', status: 'running', at },
        type: 'machine-run',
        tags: [...tags, 'parallel-child'],
      });
    }
  }
  return [parent, ...children];
}

// Note: progressive disclosure (the old `disclose` tool) was pruned — a driving
// agent reads `machine/<m>` directly; rails already carry `when` descriptors and
// the `decide-<from>` action descriptions surface the branch menu. See docs/machine.md.

/**
 * The single reactive subscription for the stateless-stepper model (ADR-0018):
 * every change to one of this machine's runs delivers the run to `machine.step`,
 * which walks the deterministic prefix in-process and emits at most one advance.
 * This REPLACES the old per-auto-rail invoke subs + the fan/join subs — `step`
 * itself spawns section/vote children and runs the deterministic join barrier.
 * The agent/task/work deliveries (projectSubscriptions) still stand alongside it:
 * `step` parks a run at those yield nodes and the model-delivery sub acts.
 */
export function projectStepSubscription(name, owner) {
  return {
    id: `machine.${seg(name)}.step`,
    match: { keyPrefix: `machine/${seg(name)}/run/`, cel: `value.status == "running" || value.status == "done" || value.status == "failed"` },
    deliver: `@${owner}/machine.step`,
    params: { run: '${keySuffix}', machine: name },
  };
}

/** Build the spawn spec a section/vote `step` yield implies (fed to spawnChildrenWrites). */
export function specFromYield(y) {
  const choice = (y.choices || [])[0] || {};
  return y.kind === 'vote'
    ? { node: y.node, join: choice.to, kind: 'vote', branch: choice.branch, samples: choice.samples }
    : { node: y.node, join: choice.to, kind: 'section', branches: (choice.sections || []).map((s) => s.to) };
}

/** The parent run id of a section (`§`) or vote (`#`) child key, or null if not a child. */
export function parentOf(runId) {
  for (const sep of ['§', '#']) {
    const i = runId.indexOf(sep);
    if (i > 0) return { parent: runId.slice(0, i), sep };
  }
  return null;
}

/**
 * The deterministic join barrier (ADR-0018) — PURE. Given the parent's current
 * value and the sibling runs read from the substrate, decide whether to advance.
 * Idempotent: only a parent still waiting (`sectioning`/`voting`) advances, and
 * only once every expected sibling is `done`. Returns the parent advance write,
 * or a `{ waiting }` status (the cell emits the write; reading is the shell's job).
 */
export function barrierAdvance(parentId, parentValue, siblings, machine, now) {
  const status = parentValue?.status;
  if (status !== 'sectioning' && status !== 'voting') return { advance: null, reason: 'parent-not-waiting' };
  const join = parentValue.join;
  if (!join) return { advance: null, reason: 'no-join' };
  const expected = typeof parentValue.count === 'number' ? parentValue.count : siblings.length;
  const done = siblings.filter((s) => s.value && s.value.status === 'done');
  if (siblings.length < expected || done.length < expected) {
    return { advance: null, reason: 'waiting', done: done.length, expected };
  }
  const rails = machineRails(machine);
  const jTerminal = !rails.some((r) => r.from === join);
  const kind = status === 'voting' ? 'vote' : 'section';
  return {
    advance: {
      key: mkey.run(parentValue.machine, parentId),
      value: { machine: parentValue.machine, node: join, status: jTerminal ? 'done' : 'running', via: `${parentValue.node}~${kind}-join`, at: now },
      type: 'machine-run',
      tags: ['machine', `machine:${parentValue.machine}`],
    },
    done: done.length,
    expected,
  };
}

/** The rails a machine def carries (already computed by define_machine), or
 *  derived from arrows as a fallback. Pure. */
export function machineRails(machine) {
  if (Array.isArray(machine?.rails) && machine.rails.length) return machine.rails;
  return railsFrom(machine?.arrows || [], undefined);
}

/** Evaluate a rail's optional CEL `condition` against the run fact value. The
 *  binding mirrors the substrate convention (`value.<path>`, as in subscription
 *  `match.cel` and action `if.cel`) and adds time: `now` (ISO-8601 string) and
 *  `nowMs` (epoch ms) — so a rail can gate on a deadline/elapsed window, e.g.
 *  `value.deadline < now` (ISO strings compare lexicographically) or
 *  `nowMs - value.startedMs > 300000`. An undefined condition is vacuously true;
 *  a throwing/invalid condition is treated as false (the rail does not fire). */
export function railHolds(rail, run, nowIso) {
  if (!rail || rail.condition == null || rail.condition === '') return true;
  const now = nowIso ?? run?.at ?? null;
  const nowMs = now ? Date.parse(now) : null;
  try {
    return celEvaluate(rail.condition, { value: run, key: `machine-run/${run?.run ?? ''}`, meta: null, now, nowMs }) === true;
  } catch {
    return false;
  }
}

/** A yield choice surfaced to the driver/decider at a non-deterministic node —
 *  carries just enough of the rail to make (or deliver) the decision. */
const choiceOf = (r) => ({
  to: r.to,
  mode: r.mode,
  ...(r.for !== undefined ? { for: r.for } : {}),
  ...(r.when ? { when: r.when } : {}),
  ...(r.prompt ? { prompt: r.prompt } : {}),
  ...(r.branch ? { branch: r.branch } : {}),
  ...(Array.isArray(r.sections) ? { sections: r.sections } : {}),
  ...(typeof r.samples === 'number' ? { samples: r.samples } : {}),
});

/**
 * The stateless stepper — the heart of ADR-0017. PURE: state IS the run fact
 * value (`{ machine, node, status, ... }`); given the machine def it advances the
 * run *in-process* along deterministic `auto` rails (evaluating each rail's CEL
 * `condition`), emitting NO intermediate fact-writes, until it reaches one of:
 *
 *   - a TERMINAL node (no outgoing rails)        → `{ run: <status:done>, yield: null }`
 *   - a non-deterministic node (any non-auto rail: agent/task/work/section/vote)
 *                                                 → `{ run, yield: { kind, node, choices } }`
 *   - a deterministic STALL (every auto rail's condition is false)
 *                                                 → `{ run, yield: { kind: 'blocked', node, choices } }`
 *   - a CYCLE (auto rails loop past the node budget)
 *                                                 → `{ run, yield: { kind: 'cycle', node, choices } }`
 *
 * The returned `run` is the advanced fact value the caller persists (one write,
 * the latest revision of `machine-run/<run>` — not one per hop). `path` is the
 * node trail walked this step (for trajectory/debug). `yield === null` means the
 * run completed; otherwise the caller (a DRIVING agent, or a REACTIVE deliver to
 * a model) makes the decision at `yield.node` and re-steps. Determinism — the
 * `auto` prefix and the join barrier — never needs a model or a fact cascade.
 */
export function step(run, machine, nowIso) {
  const rails = machineRails(machine);
  const at = nowIso ?? run?.at ?? null;
  let cur = { ...run };
  let node = run?.node;
  const path = [node];
  // The execution trace lives on the run (so the UI can show HOW it ran). step is
  // the single keeper: it fires on every run change, so a model-written advance the
  // prior step didn't see is captured here as the new tail. Idempotent (no dup tail).
  const trace = Array.isArray(run?.trace) ? run.trace.slice() : [];
  const mark = (n, via) => { if (!trace.length || trace[trace.length - 1].node !== n) trace.push({ node: n, ...(via ? { via } : {}), at }); };
  mark(node, run?.via);
  const out = (status, y) => ({ run: { ...cur, node, status, at, trace }, yield: y, path });
  // Cycle budget: every node may be entered at most once along a single
  // deterministic walk (auto rails should not revisit without a guard).
  const budget = (Array.isArray(machine?.nodes) ? machine.nodes.length : rails.length) + 1;
  const seen = new Set([node]);

  for (let i = 0; i < budget; i++) {
    const outgoing = rails.filter((r) => r.from === node);
    if (outgoing.length === 0) return out('done', null); // terminal — the run is done
    // Catch (error handling): a run that FAILED at this node takes its `catch`
    // rail — resetting to `running` and continuing from the handler — so a failed
    // work/agent step routes to recovery instead of parking. With no catch rail
    // the failure is terminal: yield `kind:'failed'`. The error rides on the run.
    if (cur.status === 'failed') {
      const caught = outgoing.find((r) => r.mode === 'catch');
      if (!caught) return out('failed', { kind: 'failed', node, choices: outgoing.map(choiceOf) });
      node = caught.to;
      cur = { ...cur, node, status: 'running', via: `${caught.from}!!catch` };
      path.push(node);
      mark(node, cur.via);
      if (seen.has(node)) return out('blocked', { kind: 'cycle', node, choices: rails.filter((r) => r.from === node).map(choiceOf) });
      seen.add(node);
      continue;
    }
    // On the happy path a `catch` rail is inert (it only fires on failure above).
    const normal = outgoing.filter((r) => r.mode !== 'catch');
    if (normal.length === 0) return out('done', null); // only a catch rail + not failed → nothing forward
    // A `wait` rail parks the run until an internal deadline the stepper manages:
    // first entry stamps `waitUntil = now + for` and yields `kind:'wait'` (status
    // `waiting`, which the step sub does NOT match — no busy-loop); a later step
    // past the deadline clears it and advances. The cell schedules the re-step.
    const waitRail = normal.find((r) => r.mode === 'wait');
    if (waitRail) {
      const nowMsLocal = at ? Date.parse(at) : Date.now();
      const untilMs = cur.waitUntil ? Date.parse(cur.waitUntil) : null;
      if (untilMs != null && nowMsLocal >= untilMs) {
        node = waitRail.to;
        cur = { ...cur, node, via: `${waitRail.from}~wait`, waitUntil: undefined };
        path.push(node);
        mark(node, cur.via);
        if (seen.has(node)) return out('blocked', { kind: 'cycle', node, choices: rails.filter((r) => r.from === node).map(choiceOf) });
        seen.add(node);
        continue;
      }
      const deadlineMs = untilMs ?? nowMsLocal + durationMs(waitRail.for);
      cur = { ...cur, waitUntil: new Date(deadlineMs).toISOString() };
      return out('waiting', { kind: 'wait', node, until: cur.waitUntil, choices: normal.map(choiceOf) });
    }
    const deterministic = normal.every((r) => r.mode === 'auto');
    if (!deterministic) {
      // A decision lives here — yield to the driver/model. The run sits at `node`.
      const kind = (normal.find((r) => r.mode !== 'auto') || normal[0]).mode;
      return out('running', { kind, node, choices: normal.map(choiceOf) });
    }
    // All auto: take the first rail whose condition holds (declaration order).
    // `at` (the step's now) feeds time-aware guards — deadlines/elapsed windows.
    const chosen = normal.find((r) => railHolds(r, cur, at));
    if (!chosen) return out('blocked', { kind: 'blocked', node, choices: normal.map(choiceOf) });
    node = chosen.to;
    cur = { ...cur, node, via: `${chosen.from}->${chosen.to}` };
    path.push(node);
    mark(node, cur.via);
    if (seen.has(node)) {
      // Re-entered a node along auto rails — a guardless loop. Stop rather than spin.
      return out('blocked', { kind: 'cycle', node, choices: rails.filter((r) => r.from === node).map(choiceOf) });
    }
    seen.add(node);
  }
  return out('blocked', { kind: 'cycle', node, choices: rails.filter((r) => r.from === node).map(choiceOf) });
}
